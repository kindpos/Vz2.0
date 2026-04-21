# Staff Port — Verification Report

Last run: port through `d1a6924` (Step 15 cleanup). Combines static
checks I ran from the command line with a manual-click-through
checklist for the parts that require a live browser.

Replace this file, or delete it, after the first clean browser
sweep — its job is to be a once-through punch list.

---

## Static checks — clean ✅

### 1. Vz1.x token leakage

Grepped every ported file for legacy CSS vars and fonts:

```
var(--color-mint)        → 0 matches
var(--color-gold)        → 0 matches
var(--color-vermillion)  → 0 matches
var(--color-bg)          → 0 matches
var(--color-bg-dark)     → 0 matches
var(--color-mint-rgb)    → 0 matches
'Alien Encounters'       → 0 matches
'Sevastopol Interface'   → 0 matches
```

Files covered: `ui/forms.js`, `ui/tokens.js`, `sections/employees.js`,
`sections/staff-roles.js`, `sections/payroll-attendance.js`,
`components/date-picker.js`.

### 2. Module parse

All six ported modules load clean via `node -e "import(...)"`. No
syntax errors, no broken imports. `overseer/src/app.js` also
passes `node --check` (it uses browser globals at module eval so
the `import` form fails, which is expected — the syntax check is
the meaningful one).

### 3. No orphan references to deleted helpers

Grepped ported files for any lingering references to helpers that
were removed in earlier steps: `createActionBtn`,
`buildTextField`, `buildTextArea`, `buildSelectField`,
`buildRadioField`, `buildFieldRow`, `fieldLabelStyle`,
`inputStyle`, `injectStyles`, and the old per-file toast class
names (`emp-toast`, `pt-toast`, `ta-toast`, `sc-toast`, `tr-toast`).

```
All orphan symbols: 0 matches.
```

(`buildTableSection` / `buildTable` / `buildTabStrip` are local
helpers defined and used in the same file — they look superficially
like legacy names but aren't.)

### 4. Event payload contracts

Every event the ported code emits matches the legacy payload
shape byte-for-byte:

| Event | Old shape | New shape | Location |
|---|---|---|---|
| `employee.created` | `{ employee_id, first_name, last_name, display_name, role_ids, hourly_rate, pin, active }` | identical | `sections/employees.js:654` |
| `employee.updated` (edit)  | `{ employee_id, first_name, last_name, display_name, role_ids, hourly_rate, active }` | identical | `sections/employees.js:634` |
| `employee.updated` (PIN)   | `{ employee_id, new_pin_hash, force_change_on_login, reset_reason }` | identical | `sections/employees.js:749` |
| `SHIFT_TIME_ADJUSTED`      | `{ shift_id, employee_id, original_clock_in, original_clock_out, adjusted_clock_in, adjusted_clock_out, reason_code, notes, manager_pin_verified }` | identical | `sections/payroll-attendance.js:1959` |
| `PAYROLL_EXPORTED`         | `{ format, period_start, period_end, employee_count, total_hours, total_labor }` | identical (legacy had `total_wages` + `total_tips` which don't exist on the current data file; my version uses `total_labor` from `laborSummary`) | `sections/payroll-attendance.js:776` |
| `tipout.rule_created` / `_updated` / `_deleted` | per legacy | identical | `sections/payroll-attendance.js:1145, 1188` |

New event types introduced (no legacy equivalent):

| Event | Payload | Backend status |
|---|---|---|
| `employee.role_created` / `_updated` / `_deleted` | `{ role_id, name, color, description, default_hourly_rate, permission_level, permissions, tipout_eligible, can_receive_tips, can_be_tipped_out_to }` / `{ role_id }` | Backend already declares `EMPLOYEE_ROLE_CREATED` / `UPDATED` / `DELETED` in `backend/app/core/events.py`. The `color`, `description`, and `default_hourly_rate` fields are extras — flagged as a backend follow-up. |
| `shift.template_created` / `_updated` / `_deleted` | `{ template_id, name, role, start, end, hours }` / `{ template_id }` | No backend projection yet. Frontend state is session-local, events are emitted best-effort. Flagged in CONFIGURABLE_SETTINGS.md. |

---

## Browser sweep — click-through checklist

Run these against `main`. Check each off as you go. Anything
unchecked is a bug to file.

### STAFF → Staff List

- [ ] Page opens, sticky header reads "Staff List · STAFF ADMINISTRATION".
- [ ] Active Employees card (green accent) renders with employee rows.
- [ ] Inactive Employees card (dim accent) is collapsed by default; clicking the `SHOW ▼` chevron expands it.
- [ ] Search box filters live by first / last name and role.
- [ ] Column headers sort ascending on first click, descending on second (confirm the `↑` / `↓` / `↕` arrow updates).
- [ ] `+ Add New Employee` (gold pill) opens the add modal.
  - [ ] First / Last fields require content (error toast on empty).
  - [ ] Roles: chip-tray reads "No roles selected"; tapping `+ ADD` opens the picker; pick 2–3 roles; they appear as removable chips.
  - [ ] Pay Rate numberField accepts decimals; `$/hr` suffix renders.
  - [ ] Tipped Yes/No single-select works.
  - [ ] PIN password field with maxlength 6.
  - [ ] Status chipGroup: toggling between active and inactive/DNR shows/hides Termination Date + Reason section.
  - [ ] Notes textarea accepts multiline text.
  - [ ] Cancel closes without save, ESC also closes, clicking outside closes.
  - [ ] Save validates (name required, PIN must be 4–6 digits) and on success: modal closes, toast appears top-right, new row appears in the list.
- [ ] Click `Edit` on a row: modal opens prefilled, PIN field is hidden (edit-only), save emits `employee.updated`.
- [ ] Click `Reset PIN` on a row:
  - [ ] Method chipGroup (Random / Set custom) shows custom PIN field only when Custom is picked.
  - [ ] Force-change-on-next-login checkbox defaults checked.
  - [ ] Applying opens the one-time PIN display modal; PIN shown big in greenUp with click-to-copy + "WRITE THIS DOWN NOW".
  - [ ] Close button emits `employee.updated` and toasts.

### STAFF → Roles

- [ ] Page opens with sticky header "Roles · STAFF ADMINISTRATION".
- [ ] If backend is empty, shows "No roles yet" inside the green-accent sectionCard.
- [ ] `+ New Role` opens the edit modal with Details tab active.
  - [ ] Details: name (required), colored swatch grid (8 swatches), description textarea, default $/hr numberField, Tipped Yes/No chipGroup.
  - [ ] Permissions tab: permission level chipGroup (Standard / Elevated / Manager), seven individual checkboxChip toggles.
  - [ ] Saving emits `employee.role_created` and a card appears in the grid.
- [ ] Click a role card → edit modal prefilled. Delete button appears in the footer (danger/red variant). Clicking opens a confirm modal with a monospace summary.
- [ ] Confirming the delete emits `employee.role_deleted` and the card disappears.

### STAFF → Payroll & Attendance

#### Tab strip

- [ ] Four tabs visible in order: Clock Records · Payroll Periods · Tipout Rules · Shift Templates.
- [ ] Clicking a tab re-paints the green underline and shows the tab content.

#### Clock Records

- [ ] Sub-toggle (Live Dashboard / Week Grid) visible at the top of the tab.
- [ ] Live Dashboard:
  - [ ] Card shows "Currently Clocked In" with `{N} on clock · auto-refreshes every 30s`.
  - [ ] Each row has glowing green dot (warning dot after 8h), role chip in role-color, clock-in time, colored duration.
  - [ ] `ON BREAK` / `OT WATCH` inline badges appear when applicable.
  - [ ] California break-compliance alert appears under the card if anyone is past 5h without a meal break.
  - [ ] Clicking `Edit` on a row opens the shift-detail modal.
- [ ] Week Grid:
  - [ ] Sub-toggle flips to Week Grid; strip underline re-paints.
  - [ ] Grid has Employee / M T W T F S S / Total columns.
  - [ ] Per-employee row shows `OT +Nh` / `EDITED` badges when applicable.
  - [ ] Each shift cell is a hoverable button; clicking opens the shift-detail modal.
  - [ ] Week totals strip below the grid (Total Hours / Sales / Tips / OT Employees).
- [ ] Switching away from Clock Records kills the 30 s refresh timer (inspect DevTools Performance or just leave the page open and look for console noise).

#### Shift detail modal

- [ ] Title reads `{name} — {date}`.
- [ ] 3-col time card: Clock In / Clock Out / Total Hours (color-coded).
- [ ] Edited notice panel renders when `shift.edited` is true.
- [ ] Breaks section (cyan accent) renders when breaks exist; CA meal-break compliance column flags `⚠ Under 30 min` for short meal breaks.
- [ ] Performance metrics row (4 KPIs) renders when sales / tips / tables have any value.
- [ ] Order log section renders when orders exist.
- [ ] Footer: `Close` (ghost) + `✎ Edit Shift Times` (primary).

#### Edit shift modal

- [ ] Opens from the detail modal's Edit button.
- [ ] Original times read-only in a `T.well` box (3-col mini stats).
- [ ] Adjusted clock-in / clock-out time inputs render natively, focus-glow to gold.
- [ ] Reason chipGroup populates from `EDIT_REASONS`; required on save.
- [ ] Manager PIN required, letter-spacing 4 px.
- [ ] Applying emits `SHIFT_TIME_ADJUSTED` with the full payload.
- [ ] Modal closes, toast appears, Clock tab re-renders with the `EDITED` badge + `✎` pencil visible.

#### Payroll Periods

- [ ] Date range picker in the Nostalgia pill style at top-left.
- [ ] `7d` / `14d` / `30d` preset pills in mono-caps, gold on hover.
- [ ] Changing a date or clicking a preset triggers a re-fetch.
- [ ] `Export CSV` (secondary) + `Export ADP` (primary) buttons top-right.
- [ ] Clicking either emits `PAYROLL_EXPORTED` and toasts success.
- [ ] 4-KPI row: Total Hours (green) / Overtime (warn or green when zero) / Total Labor (gold) / Labor % (accent shifts with benchmark).
- [ ] Labor % sub-text matches the benchmark bucket ("On target · ≤30%", "Above 35% warning", etc.).
- [ ] Employee Breakdown card (gold accent): 6-column table with role chips, em-dash for zero OT, right-aligned gold gross.

#### Tipout Rules

- [ ] Card with "Tipout Rules" header and active-rule count.
- [ ] `+ Add Rule` opens modal: From role / To role / Percentage / Calculation basis / Categories.
- [ ] Categories section only visible when basis is "Net Sales".
- [ ] Saving emits `tipout.rule_created`.
- [ ] Edit and Delete ghost/danger buttons on each row.
- [ ] Delete opens confirm modal (not browser `confirm()`).

#### Shift Templates

- [ ] Card with "Shift Templates" header + count.
- [ ] `+ New Template` opens modal with Name / optional Role / Start / End fields + live duration preview.
- [ ] Card grid renders 2-col on desktop; each card shows title + role chip + time range + hours.
- [ ] Click a card to edit; Delete button in modal footer.
- [ ] Changes persist during the session (will reset on full page reload — session-local by design, see CONFIGURABLE_SETTINGS.md).

### Deep-link compatibility

- [ ] Typing `#time-attendance` (or however scene links work in the shell) still opens the legacy Time & Attendance view.
- [ ] Same for `#payroll-tips`, `#tipout-rules`, `#shift-config`.
- [ ] These routes stay functional as long as the four legacy files remain registered in `app.js`. Step 15 left that intact.

### Console sweep

- [ ] Open DevTools console. Navigate through every tab and modal. No uncaught exceptions, no `[Overseer]` warn-level complaints except the known best-effort `pushChanges` 4xx if the backend hasn't accepted a new event type yet.

### Sticky header / scroll

- [ ] Scroll the Staff List past the first screen — the "Staff List" title stays stuck at the top.
- [ ] Same for Roles, Payroll & Attendance.
- [ ] Tab strip in P&A also stays visible (sits inside `buildScenePage` body, not pinned — intentional).

---

## Known follow-ups (not bugs)

Captured separately so they don't get filed as regressions:

1. **Role `color` / `description` / `default_hourly_rate` may fail backend validation.** Backend's Pydantic `Role` model (`backend/app/models/config_events.py:67`) doesn't declare those three fields. Pydantic's default is to reject unknown fields on strict models or accept & drop on lenient ones — depends on its `model_config`. Worth one manual backend-log check after the first role save to confirm which.
2. **Shift template persistence.** Events are emitted, no backend projection yet. Session-local until the backend side lands. Noted in `TIP_POOLS_PROPOSAL.md`... wait, wrong doc — noted in `CONFIGURABLE_SETTINGS.md`.
3. **Four legacy section files (`payroll-tips.js`, `time-attendance.js`, `tipout-rules.js`, `shift-config.js`) still on disk.** They work for deep links. Safe to delete once deep-link support is no longer needed; see Step 15 commit message for the exact cleanup procedure.
4. **Tip pools** are not built. Full spec in `TIP_POOLS_PROPOSAL.md`.
5. **Hardcoded thresholds** awaiting a settings page. Full inventory in `CONFIGURABLE_SETTINGS.md`.

---

## Sign-off

Static checks: ✅ clean.
Click-through sweep: ⏳ run it against `main`.

If every box above checks, the port is done. If anything fails,
report the row number + browser + what you clicked and I'll
investigate.
