# Tip Pools — Feature Proposal

Spec-capture doc for a future session. Describes what's missing,
where to build it, and which existing patterns to mimic so the
work lands quickly.

Read this doc first, then read `CONFIGURABLE_SETTINGS.md` for the
adjacent knobs backlog.

---

## Current state

### What exists today

- **Tipout Rules** (`overseer/src/sections/payroll-attendance.js`,
  Tipout tab): role-to-role percentage hand-offs.
  "Server sends 2 % of Net Sales to Busser."
  Emits `tipout.rule_created` / `_updated` / `_deleted`.
  Reads/writes `/api/v1/config/tipout`.
- **Per-employee tips** are already tracked on the shift record
  (`shift.tips`, `shift.tipout`, `shift.netTips` in
  `overseer/src/data/sample-payroll.js`).

### What's missing

Tip **pooling** is a different mechanism than tipout rules:

| Mechanism | Example | Today |
|---|---|---|
| Tipout rule | Server hands 2 % of their Net Sales to Busser | ✅ Built |
| **Tip pool** | All bartenders combine tips, split by hours / evenly | ❌ Not built |

No UI, no data model, no events. The only two backend references
are:

- `backend/app/services/print_context_builder.py:417` — explicit
  stub with a comment: *"Deferred: check staff config for pool
  membership. If server is in a pool, set tip_pool = { name, tips_collected }."*
- `backend/app/api/routes/reporting.py:783` — misleading variable
  name. `tip_pool = total_tips - tipout_deducted`. That's "tips
  left over after tipouts", not a pool split.

---

## Proposed shape

### Location

New **Tip Pools** tab in Payroll & Attendance (5th tab, to the
right of Shift Templates).

Wire identically to the existing four tabs in
`overseer/src/sections/payroll-attendance.js`:

```js
const TABS = [
    { id: 'clock',      label: 'Clock Records'     },
    { id: 'payroll',    label: 'Payroll Periods'   },
    { id: 'tipout',     label: 'Tipout Rules'      },
    { id: 'templates',  label: 'Shift Templates'   },
    { id: 'pools',      label: 'Tip Pools'         },  // new
];
```

Add `renderPoolsTab` to `TAB_RENDERERS`.

### Data model

A tip pool carries:

```ts
{
    pool_id:       string,
    name:          string,               // "Bar Pool"
    role_ids:      string[],             // ['bartender', 'bar_back']
    split_method:  'hours' | 'even',
    schedule?: {                         // optional daypart scoping
        start: 'HH:MM',                  // e.g. '17:00'
        end:   'HH:MM',                  // e.g. '02:00'
        days?: ('mon'|'tue'|...)[],
    },
    active: boolean,
}
```

### Split semantics

- **`even`** — each active member receives `pool_total / member_count`.
- **`hours`** — each active member receives
  `pool_total × (member_hours / Σ member_hours)`.

"Member" = any employee who worked a shift during the pool's window
while holding one of the pool's `role_ids`. Hours come from the
same `WEEKLY_TIMECARDS` data the Week Grid uses.

### Frontend UI (Tip Pools tab)

Mirrors the Roles page layout (`overseer/src/sections/staff-roles.js`):

- **Card grid** of pools (one card each):
  - Pool name (big heading)
  - Role chips (sourced from the existing `_roleChip` helper in
    payroll-attendance.js)
  - Split-method pill (`HOURS` or `EVEN`, monospace caps)
  - Active/Inactive badge
  - Optional schedule line ("Dinner · 5–10 PM")
- **Toolbar:** pool count + primary `+ New Pool`.
- **Edit modal** (`openModal` + forms.js primitives):
  - `field` → Name
  - `buildChipTray` → member roles (sourced from the live ROLES list —
    same source Tipout Rules uses)
  - `chipGroup` (single) → Split method: `Hours` / `Even`
  - `checkboxChip` → Active (default on)
  - Optional schedule: two `_buildTimeField` inputs + day-of-week
    chipGroup (multi). Skip if time-out-of-scope for v1.
  - Footer: ghost Cancel · danger Delete (edit only) · primary Create/Save

Reuse every existing forms.js primitive — no new UI components
needed. The whole tab should be ~300–400 lines in
`payroll-attendance.js` (comparable to the existing Tipout Rules
implementation, which is ~450 lines).

### Events

Match the `employee.role_*` / `tipout.rule_*` naming:

- `tipout.pool_created`
- `tipout.pool_updated`
- `tipout.pool_deleted`

Payload keys match the data model above. Session-local state until
the backend projection lands — `pushChanges` with
`.catch(() => {})` so frontend keeps working even when the backend
silently drops the events, same pattern as Shift Templates.

### Backend follow-up

Two pieces, both separate commits after the frontend ships:

1. **Projection**: a new service reading `tipout.pool_*` events
   and exposing `GET /api/v1/config/tip_pools`. Pattern:
   `backend/app/services/overseer_config_service.py` (see how it
   handles `employee.role_*`).
2. **Receipt integration**: fill in the deferred stub at
   `backend/app/services/print_context_builder.py:417`. Look up
   every pool the current server's role is in, sum the pool's
   tips for the shift window, compute the split based on pool
   method, emit `tip_pool` object on the receipt context:

   ```python
   tip_pool = {
       "name": pool.name,
       "method": pool.split_method,        # 'hours' | 'even'
       "tips_collected": <sum from shift>,
       "share": <this server's cut>,
   }
   ```

---

## Open questions to decide before coding

1. **Multiple pools per role?** Can a bartender be in both a "Bar
   Pool" *and* a "Weekend Incentive Pool" at the same time? If
   yes, split order matters. Default proposal: allow overlap;
   each shift's tips route through every matching pool (rare in
   practice but unambiguous).

2. **What counts as pool-eligible tips?** All tips the employee
   received, or only credit-card tips? Cash tips are sometimes
   kept by the server. Default proposal: all tips, with a future
   `include_cash_tips: bool` setting.

3. **Interaction with Tipout Rules.** Does pool math run before
   or after tipout deductions? Common convention: tipouts come
   off first, remaining goes into pools. Default proposal:
   **tipouts first, then pools**, matching how the existing
   `tip_pool = total - tipout_deducted` calculation in
   `reporting.py` implicitly orders things.

4. **Hourly split — which hours count?** Clocked hours, or only
   hours within the pool's schedule window? Default proposal:
   **only hours overlapping the pool's window** (otherwise a
   dinner-pool member who clocked in at breakfast gets an
   unfair share).

5. **Display on Payroll Periods.** Should the employee
   breakdown table add a `Pool Share` column? Default proposal:
   yes, optional column that appears only when the location has
   at least one active pool.

6. **Receipt behavior.** Does the server see the pool breakdown
   on their checkout receipt? Default proposal: yes — show
   `POOL:  $XX.XX (share of $YYY.YY)` under the tip section.

---

## Critical files for the next session

### Read first (existing patterns to mimic)

- `overseer/src/sections/payroll-attendance.js` — the
  `renderTipoutTab` implementation is the closest template
  structurally. The `buildTipoutTable` / `openTipoutRuleModal` /
  `confirmDeleteTipoutRule` trio maps one-to-one onto
  `renderPoolsTab` / `buildPoolsGrid` / `openPoolModal` /
  `confirmDeletePool`.
- `overseer/src/sections/staff-roles.js` — closest UI analog
  (card grid + edit modal with two tabs). Pool edit modal is
  simpler (one tab, no permissions) but the grid layout and
  edit/delete flow are identical.
- `overseer/src/ui/forms.js` — all the primitives:
  `openModal`, `field`, `chipGroup`, `checkboxChip`,
  `buildChipTray`, `button`, `showToast`.

### Modify

- `overseer/src/sections/payroll-attendance.js` — add the tab
  entry + renderer + modal trio. Update `TABS` array and
  `TAB_RENDERERS` map.

### Create (optional)

- Nothing. Everything lives inside the single
  `payroll-attendance.js` file, following the same pattern the
  other four tabs use.

---

## Sequencing

A reasonable chunking for a follow-up session:

1. **Chunk 1 — data + tab scaffold.** Module-level
   `_tipPools` state, `renderPoolsTab` entry, empty card grid,
   `+ New Pool` button that toasts a stub.
2. **Chunk 2 — edit modal.** `openPoolModal(pool | null)` with
   name, roles chip-tray, split-method chipGroup, active
   checkbox. Emit `tipout.pool_*` events.
3. **Chunk 3 — card render.** Replace the empty grid with real
   pool cards (name, roles, split method, active badge). Click
   → edit.
4. **Chunk 4 — schedule window.** Optional. Adds the time-of-day
   fields + day-of-week chipGroup if v1 needs scoping.
5. **Chunk 5 — Payroll Periods integration.** Add the optional
   `Pool Share` column to the employee breakdown table.

Each chunk ~50–150 lines of diff. Expect the whole feature to
land in 3–5 commits.

---

## One-line TL;DR

*Tip pools = role-groups that share tips and split them by the
chosen method (even or by hours). UI lands as a 5th tab in
Payroll & Attendance, mirroring the Tipout Rules + Roles patterns
that already exist.*
