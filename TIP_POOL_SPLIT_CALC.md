# Tip Pool Split Calc — Design Notes

Companion to `TIP_POOLS_PROPOSAL.md`. Captures the business rules,
edge cases, and payroll-report implications that came out of the
design conversation after the frontend and clock-in opt-in shipped.

---

## Settled decisions

### Full pooling — no side tips
When an employee opts into a pool at clock-in, **100 % of their CC
tips for that shift flow into the pool**. They do not retain any
portion. Their taxable CC tip income for that shift is their pool
share — not their collected tips.

This eliminates the need for a `cc_tips_contributed` subtraction step.
The formula is simply:

```
pool_total      = Σ cc_tips across all opted-in members for the shift window

// Hours split
member_share    = pool_total × (member_hours / Σ member_hours)

// Even split
member_share    = pool_total / member_count
```

### Taxable CC tips on payroll
For a pooled employee:

```
taxable_cc_tips = member_share          (pool share replaces collected tips)
```

For a non-pooled employee (no `pool_memberships` on their clock-in):

```
taxable_cc_tips = cc_tips               (unchanged — their own collected tips)
```

The `Pool Share` column in the Payroll Periods breakdown is the
**authoritative** tip figure for pooled employees, not a supplement
to it.

### Export (CSV / ADP)
The tip field in both export formats must write `taxable_cc_tips`
(pool share for pooled, raw CC tips for non-pooled). Writing the
pre-pool figure would overstate tip income and produce incorrect W-2s.

---

## What needs to be built

### 1. Split calc service
New function (or method on `OverseerConfigService`) that, given a
date range:

1. Reads all `USER_LOGGED_IN` events in the window — each carries
   `pool_memberships: [pool_id, ...]` and `role`.
2. For each active pool, finds the opted-in members for the window.
3. Loads the `cc_tips` total for each member's shifts in the window
   (available from the existing labor-summary / reporting queries).
4. Sums the pool total and runs the split (hours or even).
5. Returns a map of `{ employee_id → pool_share }`.

Hours split requires clocked hours per member for the window —
already available from the same event replay that powers the
Week Grid.

### 2. Payroll report integration
- `GET /api/v1/reports/labor-summary` (and the Payroll Periods
  endpoint) — augment each employee record with:
  - `pool_share: Decimal | null` — null if not in any pool
  - `taxable_cc_tips: Decimal` — pool share if pooled, else raw
    cc_tips
- The `Pool Share` column in the Payroll Periods table
  (`buildPayrollTable` in `payroll-attendance.js`) already renders
  `emp.poolShare` or `—`. No frontend change needed once the
  backend supplies the value.

### 3. Export fix
`exportPayroll()` in `payroll-attendance.js` emits a
`PAYROLL_EXPORTED` event. The backend ADP/CSV formatter (wherever
it lives) must use `taxable_cc_tips` not raw `cc_tips` for the tip
column. Flag this as a **tax compliance requirement**, not a
cosmetic change.

### 4. Receipt integration
Fills the deferred stub at
`backend/app/services/print_context_builder.py:417`:

```python
tip_pool = {
    "name":           pool.name,
    "method":         pool.split_method,      # "hours" | "even"
    "tips_collected": pool_total,             # full pool pot
    "share":          member_share,           # this employee's cut
}
```

The receipt shows `POOL: $XX.XX (share of $YYY.YY)` under the tip
section so the employee can verify their share at checkout.

---

## Edge cases to resolve before coding

### Multiple pools in one shift
If an employee's role is in two active pools and they opted into
both, their CC tips are split between the pools in proportion to
each pool's size? Or does each pool get the full tip total (double-
counting)? **Decision needed.**

Suggested default: tips are allocated to pools in the order the
pools were created; once allocated, the remaining balance goes to
the next pool. In practice, roles are rarely in more than one pool,
so this is low priority.

### Partial shift overlap with pool schedule
If a pool runs 17:00–02:00 and the employee clocked in at 15:00,
does the hours-split denominator use their full shift hours or only
the hours that overlap the pool window?

`TIP_POOLS_PROPOSAL.md` already answered this:
**only overlapping hours count** (prevents breakfast-shift hours
inflating a dinner-pool share). The split calc must clip each
member's hours to the pool's schedule window before dividing.

### Employee clocks out mid-shift before pool closes
Their hours freeze at clock-out. Their CC tips up to that point
contribute to the pool. Normal — no special case needed.

### No opt-ins for a pool on a given day
Pool total is zero. No shares to distribute. Skip silently — do not
divide by zero.

### Cash tips
Cash tips stay with the employee regardless of pool membership.
Only CC tips pool. A future `include_cash_tips: bool` flag on the
pool model can revisit this (noted in `TIP_POOLS_PROPOSAL.md`).

---

## Critical files for the next session

| File | What to do |
|---|---|
| `backend/app/services/overseer_config_service.py` | Add `compute_pool_splits(start, end)` |
| `backend/app/api/routes/reporting.py` | Augment labor-summary employee records with `pool_share` + `taxable_cc_tips` |
| `backend/app/services/print_context_builder.py:417` | Fill the deferred tip-pool stub |
| `overseer/src/sections/payroll-attendance.js` | `buildPayrollTable` already wired — verify `emp.poolShare` flows through |
| Export formatter (CSV / ADP) | Use `taxable_cc_tips` for the tip column — **tax compliance** |

---

## One-line TL;DR

*Full pooling: 100 % of a member's CC tips go in, their split comes
back out as their sole taxable CC tip figure. The split calc feeds
the payroll report, the receipt, and the export — all three must
use the split result, not the raw collected tips.*
