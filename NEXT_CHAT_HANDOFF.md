# Next Chat Handoff — Ledger-consumer wiring

Paste this as the first user message in a fresh Claude session. Claude
will then explore the repo, load the current state, and propose a plan.

---

## Context

A previous session spent nine phases hardening the KINDpos event ledger.
Start and finish:

| | Start | Now |
| --- | --- | --- |
| IMPLEMENTED nodes | 11 | **88** |
| MISSING nodes | 70 | **5** |
| `EventType` enum entries | ~63 | 178 |
| Backend tests passing | 1188 | 1247 |

Everything is merged to `main`. The audit dataset that drives the
`/entomology` Event Ledger Gaps tab is at
`backend/app/services/ledger_gap_report.py`; the rolling log of every
phase (what shipped, where it's wired, why) is at
`LEDGER_GAPS_PROGRESS.md`.

**What "done" means today:** every core-POS event has an emission path.
Many are emitted by live route code (payments, orders, day close,
printer admin, etc.). Many others are "dark-shipped" — the `EventType`
+ factory live and the event round-trips through `/config/push`, but
nothing in the overseer UI actually sends them yet.

## Your job (two tracks)

Wire the dark-shipped events end-to-end:

### Track 1 — UI surfaces that emit the dark-shipped events

The overseer / terminal UIs need to start sending the events we've
dark-shipped. High-value candidates:

- **Category lifecycle** — `category.deactivated` / `category.reactivated`
  (soft-delete distinct from hard `menu.category_deleted`).
- **Item lifecycle** — `item.price_changed`, `item.deactivated`,
  `item.reactivated` (alongside the existing `menu.item_updated`).
- **Modifier CRUD** — `modifier.created` / `updated` / `price_changed` /
  `deactivated` / `reactivated` / `86ed` / `86_cleared` (seven events).
- **Specials** — `special.created` / `updated` / `activated` /
  `deactivated`.
- **Tipout pipeline** — `tipout.calculated` (emit after shift-end calc),
  `tipout.adjusted` (manager override UI), `tipout.distributed`
  (payroll-run confirm).
- **Cash control UI** — surface the `/day/cash/float`, `/drop`,
  `/payout` routes (they exist, no UI yet).
- **Seat-level discounts + comps** — `seat.discount_applied` /
  `seat.discount_voided` / `seat.comped` (split-check audit).
- **Discount catalog CRUD** — LG-87 / 88 / 89 still MISSING; overseer
  needs a discount admin UI that emits `discount.created` / `updated` /
  `deactivated` / `reactivated` (add these enum entries first, then
  wire).

Skip break tracking (LG-64/65) unless asked — the previous session
user explicitly deferred it.

### Track 2 — Projections + reports that consume the events

Events are only valuable if something reads them. High-leverage
projections / reports to build:

- **Per-seat balance** — projections today track `order.balance_due`
  and `paid_seats` at order level only. Build a `seat_balance(order)`
  that uses `seat.item_added` (seat_number on item), `seat.discount_applied`,
  `seat.payment_applied` (via `payment.confirmed.seat_numbers`),
  `seat.payment_voided`, `seat.paid`. Audit-anchor for split-check
  disputes.
- **Tipout calculator** — read `tipout.rule_created/updated` for the
  active ruleset, `tipout.calculated` for the canonical result, apply
  `tipout.adjusted` overrides, and confirm against
  `tipout.distributed`. Replace any spreadsheet-based tipout flow.
- **Comp / discount reporting** — read `discount.approved`,
  `discount.voided`, `seat.comped` with `comp_category`; produce a
  daily comp log by employee with reason breakdown.
- **Cash variance at day close** — read `day.cash_float_updated`,
  `day.cash_drop`, `day.cash_payout`, sum confirmed cash
  `payment.confirmed` (method=cash), subtract `payment.refunded`, and
  compare against operator's counted cash in `_do_close_day`. Surface
  in the day-summary response.
- **Settlement drift alert** — read `batch.settlement_failed` events
  in the `/entomology` dashboard; surface alongside the existing
  FIN-003 diagnostic so invariants are visible without going into the
  Excel bug report.

## Concrete starting points

1. Read `backend/app/services/ledger_gap_report.py` end-to-end — this
   is the canonical list of every event with status + site citation.
2. Read `LEDGER_GAPS_PROGRESS.md` for the phase-by-phase history.
3. Read `backend/app/core/events.py` — 178 `EventType` entries, each
   with a factory function documenting its payload.
4. `backend/app/api/routes/config.py:push_changes` is the fan-in point
   for the dark-shipped events. `parse_event_type` already accepts any
   `EventType` enum member.
5. Existing wire-level examples:
   - Route wiring: `orders.py:patch_order` (emits
     `check.table_changed` conditionally), `payment_routes.py` auto-
     close (emits `seat.paid` per seat on whole-order close),
     `hardware.py:save_device` (emits `printer.configured` or
     `payment.processor_configured` based on device type).
   - Projection hookup: `core/projections.py` ORDER_CLOSED branch,
     `core/menu_projection.py` for category/item state.

## Rules of engagement

- **Branch per phase, PR per branch.** Don't merge to `main` without
  an explicit "merge to main" instruction.
- **Small chunks.** Prefer 3–10 events per branch over 30.
- **Test every emission.** Follow the Phase 4f/4g pattern:
  tests in `backend/tests/test_phaseNN_*.py` that round-trip events
  through the intended emission path.
- **Flip the gap dataset** when you close a node. The `/entomology`
  tab reads `ledger_gap_report.py` directly; inaccurate dataset = tab
  lies to operators.
- **Append to `LEDGER_GAPS_PROGRESS.md`** with a changelog entry per
  phase (newest at top of the `## Changelog` section).
- **Run full backend pytest** before pushing each phase (~60 s, 1247
  baseline). Skip `tests/test_dejavoo_spin*.py` per the existing
  pattern.
- Atomic-batch any multi-event emission flow (the Phase 1 atomicity
  contract is load-bearing).
- For UI surfaces: if the UI doesn't exist yet, propose a minimal
  endpoint or component; don't build huge admin panels speculatively.

## Expected shape of a session

1. Re-read `LEDGER_GAPS_PROGRESS.md` and `ledger_gap_report.py`.
2. Propose a phase (scope in `AskUserQuestion` if open).
3. Branch off `origin/main`.
4. Implement + test + update the gap dataset + append to progress log.
5. Commit with a descriptive message, push, report back.
6. Wait for merge instruction before touching `main`.

## Open questions the previous session left

- Should RENAMED nodes (18) emit the spec-aligned name alongside the
  existing code-local name, or should the spec be updated to accept
  the code names? (Pattern precedent from Phase 3a: the 86-events
  emit both — `menu.item_86d` + `item.86ed` atomically.)
- When `tipout.calculated` becomes a real (not dark-ship) emission,
  where should the calculation live? Candidate locations:
  `backend/app/services/` new `tipout_service.py`, triggered from
  day-close, or from a dedicated `/tipout/calculate` route. The
  previous session did not pick one.
- `seat.course_fired` (LG-27 PARTIAL) still emits per-item via
  `item.sent`. Adding a course-firing UX is a feature decision, not
  an audit gap.

## Pointers

- Backend: `/home/user/Vz2.0/backend/`
- Event ledger core: `backend/app/core/event_ledger.py` (append,
  append_batch, hash chain, queries)
- Event definitions: `backend/app/core/events.py`
- Projections: `backend/app/core/projections.py`,
  `backend/app/core/menu_projection.py`
- Dataset feeding the /entomology tab:
  `backend/app/services/ledger_gap_report.py`
- Live gap endpoint: `backend/app/api/routes/entomology.py` →
  `GET /entomology/ledger-gaps`
- UI tab: `entomology/index.html`, `entomology/src/app.js`,
  `entomology/styles/main.css` (filter controls already there for
  aggregate / status / severity / search).

Good luck. Keep chunks small and avoid timeouts.
