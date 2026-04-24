# Event Ledger Gap — Progress Log

Tracks the LG-## gap clusters across phased work. Source of truth for node
inventory is `backend/app/services/ledger_gap_report.py` (surfaced in the
`/entomology` Event Ledger Gaps tab).

## Current state

| Status | Count | % | Notes |
| --- | --- | --- | --- |
| IMPLEMENTED | 93 | 79% | Emission wired in routes and/or via `/config/push` |
| RENAMED | 18 | 15% | Code emits under a different name than the spec (audit-equivalent) |
| PARTIAL | 4 | 3% | Covered but with a known caveat (see per-node `drop_risk`) |
| FACTORY-ONLY | 1 | 1% | `menu.import_rolled_back` awaits rollback endpoint |
| **MISSING** | **2** | **2%** | See list below |
| **Total** | **118** | | |

Events in `EventType` enum: **~182** (from ~63 at start).
Backend tests: **1275 passing** (from 1247 at start).

## Phases shipped

| Phase | Theme | Events touched | Status |
| --- | --- | --- | --- |
| 1 | CRITICAL atomicity | 8 multi-event flows routed through `append_batch` | **DONE** |
| 2 | Missing CRITICAL events | `check.opened`, `seat.paid`, `day.opened`, real `clock.in/out`, `staff.pin_changed` | **DONE** |
| 3a | HIGH payload fixes + spec-rename emissions | `item.86ed`/`86_cleared`, `tip adjusted_by`, `item.removed voided_by`, `discount.approved discount_id` | **DONE** |
| 3b | Dataset audit correction | 8 nodes flipped `FACTORY-ONLY → IMPLEMENTED` | **DONE** |
| 3c | Printer admin flow | `printer.configured` / `removed` / `assignment_changed` | **DONE** |
| 3d | Card-reader admin | `payment.processor_configured` (PCI anchor) | **DONE** |
| 3e | PARTIAL-node cleanup | LG-14/15/16 merge+split re-classified IMPLEMENTED | **DONE** |
| 4a | Cash control | `/day/cash/float`, `/drop`, `/payout` routes | **DONE** |
| 4c | Financial accuracy | `discount.voided`, `seat.overpayment_resolved`, `seat.tip_added` | **DONE** |
| 4d | Settlement failure | `batch.settlement_failed` on invariant drift | **DONE** |
| 4e | Menu import | `menu.import_started` / `completed` / `failed` envelope on `/config/push` | **DONE** |
| 4f | Modifier CRUD | 7 new `modifier.*` events | **DONE** |
| 4g | Micromods | 9 new `micromod.*` events (dark-ship) | **DONE** |
| 5 | Catalog completeness + table change | `check.table_changed`, `item.price_changed`, `item.deactivated/reactivated`, `special.*` | **DONE** |
| 6 | Staff + config completeness | 11 `staff.*` / `clock.edit` / `shift.deleted` / `category.*` / `security.setting_updated` events | **DONE** |
| 7 | Day + batch lifecycle | 7 `check.day_locked` / `day.locked/reopened` / `batch.opened/settlement_initiated/reopened` events | **DONE** |
| 8 | Seat financial + tipout pipeline | `seat.discount_*`, `seat.comped`, `seat.payment_voided`, `tipout.calculated/adjusted/distributed` | **DONE** |
| 9 | Seat-transfer family (dark-ship) | 12 per-seat / cross-check / whole-seat / split-merge / reopen events | **DONE** |
| 10 | Discount catalog CRUD | `discount.created` / `updated` / `deactivated` / `reactivated` (closes LG-87/88/89) | **DONE** |
| 11 | Tipout rule factory + wiring | `tipout.rule_created/updated` factories added, LG-96/97 FACTORY-ONLY→IMPLEMENTED | **DONE** |

## Still MISSING (2 nodes)

| LG | Event | Severity | Why |
| --- | --- | --- | --- |
| LG-64 | `break.started` | HIGH | User-deferred during Phase 4 scoping (labor-compliance only, non-blocking) |
| LG-65 | `break.ended` | HIGH | Mirror of LG-64 |

Every other event is either emitted, renamed from the spec but audit-equivalent, or dark-shipped (enum + factory + `/config/push` round-trip test) ready to go live the moment a producer sends it.

---

## Phase 10 — Discount catalog CRUD (branch `claude/ledger-discount-catalog-phase10`)

**Date**: 2026-04-24  
**Closes**: LG-87 (`discount.created`), LG-88 (`discount.updated`), LG-89 (`discount.deactivated` + `discount.reactivated`)  
**MISSING → IMPLEMENTED**: 3 nodes (LG-89 maps to 2 events; 4 new EventType entries total)

### What shipped

| Event | EventType | Site |
| --- | --- | --- |
| `discount.created` | `DISCOUNT_CREATED` | `events.py:discount_created, config.py:push_changes` |
| `discount.updated` | `DISCOUNT_UPDATED` | `events.py:discount_updated, config.py:push_changes` |
| `discount.deactivated` | `DISCOUNT_DEACTIVATED` | `events.py:discount_deactivated, config.py:push_changes` |
| `discount.reactivated` | `DISCOUNT_REACTIVATED` | `events.py:discount_reactivated, config.py:push_changes` |

### Key decisions

- Distinct `discount.deactivated` and `discount.reactivated` events (following the established `category.*` / `item.*` pattern) instead of a single combined event.
- All four events route through `/config/push`; added `discount.*` → `"discounts"` section inference in `push_changes`.
- Factory payloads: `discount_created` carries `discount_id`, `name`, `discount_type`, `amount`, `applies_to`, `created_by`, `requires_approval`, `auto_apply`. Distinct from order-level `discount.approved` which tracks applications, not catalog definitions.
- `push_changes` is a raw pass-through (no factory defaults applied server-side) — optional fields like `requires_approval` are absent when not sent, consistent with all other dark-shipped events.

### Test file

`tests/test_phase10_discount_catalog.py` — 9 tests, all passing.

---

## Phase 11 — Tipout rule factory + wiring (branch `claude/ledger-tipout-rules-phase11`)

**Date**: 2026-04-24  
**Closes**: LG-96 (`tipout.rule_created`), LG-97 (`tipout.rule_updated`)  
**FACTORY-ONLY → IMPLEMENTED**: 2 nodes

### What shipped

The `TIPOUT_RULE_CREATED` and `TIPOUT_RULE_UPDATED` enum entries have existed since Phase 8 but lacked factory functions, making them un-emittable from application code (only raw `create_event` calls worked). This phase adds proper factories.

| Event | EventType | Site |
| --- | --- | --- |
| `tipout.rule_created` | `TIPOUT_RULE_CREATED` | `events.py:tipout_rule_created, config.py:push_changes` |
| `tipout.rule_updated` | `TIPOUT_RULE_UPDATED` | `events.py:tipout_rule_updated, config.py:push_changes` |

### Key decisions

- `tipout.rule_created` payload: `rule_id`, `name`, `pool_id`, `role_ids` (list), `percentage` (string Decimal), `effective_date` (ISO-8601), `created_by`.
- `tipout.rule_updated` payload: `rule_id`, `fields_changed` (dict of changed fields), `updated_by`. No full-snapshot approach — consumers replay the changed fields.
- No config.py changes needed: `tipout.*` already maps to the `"employees"` section in `push_changes`.
- `percentage` stored as string via `money_round` to avoid float drift, consistent with all other financial fields.

### Test file

`tests/test_phase11_tipout_rules.py` — 6 tests, all passing.

---

## Phase 12 — Per-seat balance projection (branch `claude/ledger-seat-balance-phase12`)

**Date**: 2026-04-24  
**Track 2 — Consumes events**: ITEM_ADDED, ITEM_REMOVED, SEAT_DISCOUNT_APPLIED, SEAT_DISCOUNT_VOIDED, SEAT_COMPED, PAYMENT_CONFIRMED (seat_numbers), SEAT_PAYMENT_VOIDED, SEAT_PAID

### What shipped

**New dataclass** `SeatBalance` in `projections.py`: tracks `items`, `discounts`, `seat_payments`, `is_paid`, `is_comped` per seat. Computes `item_subtotal`, `discount_total`, `amount_paid`, `balance_due`.

**Extended `Order` dataclass**: `seat_balances: dict[int, SeatBalance]` populated by `project_order()` as seat-scoped events are replayed.

**New endpoint** `GET /orders/{order_id}/seats`: returns per-seat breakdown for split-check audits — item subtotal, discounts, payment slices, balance due, comped/paid flags.

**Bugfix in `push_changes`**: seat-scoped events pushed via `/config/push` now have `correlation_id` auto-wired from `payload.order_id`. Previously these events were stored with `correlation_id=None` and invisible to `get_events_by_correlation(order_id)`.

**Payment distribution**: `PAYMENT_CONFIRMED` with `seat_numbers` distributes a pro-rated slice to each seat's `seat_payments` (equal split across seats covered by the payment).

### Test file

`tests/test_phase12_seat_balance.py` — 11 tests, all passing.

---

## Phase 1 — CRITICAL atomicity (branch `claude/ledger-atomicity-phase1`)

Goal: route every multi-event operation through `EventLedger.append_batch`
so a mid-flow crash cannot leave partial state in the ledger.

Contract (verified via `event_ledger.py:249-321`):
- Single writer lock held across the whole batch.
- Single `conn.commit()` after all inserts; mid-batch exception propagates
  and no prior inserts are visible.
- Hash chain is computed correctly across batch members.

| ID | Flow | Site | Verdict | Status |
| --- | --- | --- | --- | --- |
| LG-04 | Check close / `payment.confirmed` + `order.closed` | `payment_routes.py:363-486` | straight `append_batch` swap | **DONE** |
| LG-05 | Check void / refunds + `order.voided` | `orders.py:1266-1345` | device voids first, then one `append_batch` for refunds + void | **DONE** |
| LG-14 | Check merge target / items + modifiers + `check.merged` | `orders.py:1358-1482` | one big `append_batch` for the whole merge | **DONE** |
| LG-15 | Check absorb (source side of merge) | `orders.py:1419-1469` | same batch as LG-14 (source `check.merged` + `order.voided` interleaved with items) | **DONE** |
| LG-16 | Check split / child create + items + parent remove + splits | `orders.py:1963-2097` | one big `append_batch` across all seats | **DONE** |
| LG-22 | Seat item add / `item.added` + `modifier.applied × N` | `orders.py:824-926` | pre-flight idempotency check, then whole thing as one `append_batch` | **DONE** |
| LG-32 | `payment.confirmed` + `order.closed` (credit sale path) | `payment_routes.py:212-349` | straight `append_batch` swap (partial — LG-32 deep fix deferred to Phase 2) | **DONE** |
| LG-53 | Day close / per-order closes + `batch.submitted` + `day.closed` | `orders.py:1766-1952` | conservative: batch the boundary pair only | **DONE** |

Test files to extend (no new parallel suites):
- `tests/test_cash_and_tip_flows.py`, `tests/test_payment_routes_gaps.py`,
  `tests/test_overpayment_guard.py`, `tests/test_seat_payments.py`
- `tests/test_orders_mutations.py`, `tests/test_api_routes.py`
- `tests/test_daily_workflow.py`, `tests/test_day_close_lock.py`
- `tests/test_append_batch.py` (add atomicity-failure cases)

---

## Phase 2 — Missing CRITICAL events (branch `claude/ledger-missing-crit-phase2`)

| ID | Event | Emission site | Status |
| --- | --- | --- | --- |
| LG-01 | `check.opened` | `orders.py:create_order, split_by_seat` (batched with `order.created`) | **DONE** |
| LG-37 | `seat.paid` | `payment_routes.py` auto-close (cash + credit paths); one per seat | **DONE** |
| LG-48 | `day.opened` | `orders.py:create_order` (first event of the day) | **DONE** |
| LG-62 | `clock.in` | `staff.py:clock_in` (batched with `user.logged_in`) | **DONE** |
| LG-63 | `clock.out` | `staff.py:clock_out` (batched with `user.logged_out`) | **DONE** |
| LG-59 | `staff.pin_changed` | `config.py:create_employee` when a PIN is set (no hash in payload) | **DONE** |

---

## Phase 3+ — deferred

Full detail in `backend/app/services/ledger_gap_report.py`. Surface it in
the `/entomology` → Event Ledger Gaps tab.

---

## Changelog

- 2026-04-24 — Phase 14: Settlement drift alert in /entomology.
  New `GET /entomology/settlement-drift` endpoint reads all
  `batch.settlement_failed` events from the ledger and returns them
  newest-first with `sequence`, `timestamp`, `reason`, `recon_diff`,
  and `failed_invariants`. 4 new tests in
  `tests/test_phase14_settlement_drift.py`. Branch:
  `claude/ledger-settlement-drift-phase14`.

- 2026-04-24 — Phase 13: Cash variance projection at day close.
  New `GET /day/cash/variance` endpoint in `day_cash.py` reads
  DAY_CASH_FLOAT_UPDATED, DAY_CASH_DROP, DAY_CASH_PAYOUT, and
  cash-method PAYMENT_CONFIRMED / PAYMENT_REFUNDED events since the
  last `day.closed` boundary to compute expected cash in the drawer.
  Returns `float`, `cash_sales`, `cash_refunds`, `drops`, `payouts`,
  and `expected_in_drawer`. 8 new tests in
  `tests/test_phase13_cash_variance.py`. Branch:
  `claude/ledger-cash-variance-phase13`.

- 2026-04-24 — Phase 9: seat-transfer family dark-shipped. Twelve
  new `EventType` entries with matching factories, all emittable
  via `/config/push`:
  - `check.seat_added` / `check.seat_removed` / `check.seat_relabeled`
    (LG-06 / 07 / 08) -- per-seat identity on a check, distinct from
    the coarse `seats.updated`.
  - `check.seat_sent_out` / `check.seat_received` (LG-17 / 18) --
    cross-check seat transfer, correlation via `source_order_id` /
    `target_order_id`.
  - `seat.item_transferred_out` / `seat.item_received` (LG-24 / 25) --
    item-level seat-to-seat moves; target_order_id is optional so the
    same factories cover intra-check and cross-check moves.
  - `seat.transferred_out` / `seat.transferred_in` (LG-38 / 39) --
    whole-seat moves (all items + payments + tips as a unit).
  - `seat.split_from` / `seat.merged_into` (LG-40 / 41) -- per-seat
    splits and merges so 'split the wine bill' is replayable.
  - `seat.reopened` (LG-42) -- undo for seat.paid without reopening
    the whole check.
  The underlying product features are coming later; this phase lands
  the schema so the rollout doesn't require a follow-up events-table
  migration. 6 round-trip tests cover every event.
- 2026-04-24 — Phase 8: seat-scoped financial audit + tipout calc
  lifecycle. Seven new `EventType` entries with matching factories;
  all emittable via `/config/push`:
  - `seat.discount_applied` / `seat.discount_voided` / `seat.comped`
    (LG-28 / 29 / 30) -- per-seat discount audit on split-check
    tables. `seat.comped` carries `comp_category` so comp-reporting
    can filter cleanly.
  - `seat.payment_voided` (LG-33) -- seat-scoped payment void
    distinct from order-level `payment.refunded`.
  - `tipout.calculated` / `tipout.adjusted` / `tipout.distributed`
    (LG-99 / 100 / 101) -- full tipout pipeline: math result with
    per-recipient breakdown, manager overrides, and pay-out anchor.
    `tipout_id` is the correlation_id across the three events.
  5 round-trip tests.
- 2026-04-24 — Phase 7: day + batch lifecycle completeness. Seven
  new `EventType` entries plus factories, all emittable via
  `/config/push`:
  - `check.day_locked` (LG-19) -- per-order lock marker so
    post-close mutations are flaggable.
  - `day.flash_report_generated` (LG-52) -- midday snapshot anchor
    with report_id + window bounds + top-line total.
  - `day.locked` / `day.reopened` (LG-54 / 55) -- authoritative
    freeze + high-friction reopen.
  - `batch.opened` / `batch.settlement_initiated` / `batch.reopened`
    (LG-91 / 92 / 95) -- full settlement-batch state machine;
    batch_id becomes the correlation_id so payments bin back to
    their originating batch cleanly.
  4 new round-trip tests.
- 2026-04-24 — Phase 6: staff + config dark-ship completeness.
  Eleven new `EventType` entries plus factories, all emittable
  via `/config/push`:
  - `staff.updated` / `staff.role_changed` / `staff.deactivated` /
    `staff.reactivated` (LG-57 / 58 / 60 / 61).
  - `clock.edit` / `shift.deleted` (LG-66 / 67) -- wage-dispute
    and shift-correction audit anchors.
  - `category.deactivated` / `category.reactivated` (LG-71 / 72) --
    soft-delete distinct from `MENU_CATEGORY_DELETED`.
  - `tipout.rule_deactivated` (LG-98) -- soft-delete distinct from
    `TIPOUT_RULE_DELETED`.
  - `security.setting_updated` (LG-109, HIGH) -- PCI/SOX compliance
    anchor with setting_key + previous_value + new_value, string
    values so secrets never land on the ledger.
  Also reclassified LG-103 (`tax.rate_updated`) and LG-104
  (`terminal.settings_updated`) from MISSING/FACTORY-ONLY to
  RENAMED -- both are already emittable via `/config/push` under
  the existing `STORE_TAX_RULE_*` and `TERMINAL_UPDATED` names.
  8 new tests; 1227 backend tests green.
- 2026-04-24 — Phase 5: menu-catalog completeness + table-change
  audit. New event types:
  - `check.table_changed` (HIGH-value quick win) wired into PATCH
    `/orders/{id}` when the `table` field differs from the current
    value; emitted inside the same `append_batch` as any other
    simultaneous field patches. Same-table PATCH is a no-op.
  - `item.price_changed` (HIGH) -- dedicated price-delta event with
    previous_price + new_price so historical-pricing replay survives
    without re-projecting the full menu catalog.
  - `item.deactivated` / `item.reactivated` (MEDIUM) -- soft-delete
    lifecycle for menu items.
  - `special.created` / `special.updated` / `special.activated` /
    `special.deactivated` (MEDIUM) -- four new events so
    happy-hour / daily-special windows are replayable.
  All dark-shipped events flow via `/config/push`; the table-change
  event wires into the existing orders route. 5 new tests. 1224
  backend tests green. LG-10 / 75 / 76 / 77 / 86 flipped to
  IMPLEMENTED.
- 2026-04-24 — Phase 4e: menu-import lifecycle wired around
  `/config/push`. Any batch containing `menu.*`, `category.*`,
  `modifier.*`, `restaurant.configured`, or `*_batch_created` events
  now lands inside a `menu.import_started` → ... → `menu.import_completed`
  envelope sharing an `import_id`. On a failed `append_batch`, a
  standalone `menu.import_failed` is emitted before the error
  propagates (nothing menu-related committed — this event is the sole
  record). `menu.import_rolled_back` is dark-shipped: enum + factory
  live, emission awaits an overseer rollback endpoint. LG-110 / 111 /
  112 flipped to IMPLEMENTED; LG-113 flipped to FACTORY-ONLY with a
  note. 3 new tests; 1209 backend tests green.
- 2026-04-24 — Phase 4g: micromod.* dark-shipped. 9 new EventType
  entries (`micromod.created` / `updated` / `price_changed` /
  `deactivated` / `reactivated` / `assigned_to_modifier` /
  `unassigned_from_modifier` / `86ed` / `86_cleared`) plus matching
  factories. Events flow through `/config/push` (no new endpoint
  surface). The product does not surface micromods yet -- this lands
  the schema so the overseer rollout can emit without a follow-up
  events-table migration. 5 round-trip tests pin emission + payload
  shape. LG-85 flipped to IMPLEMENTED.
- 2026-04-24 — Phase 4f: modifier CRUD ledgered. Seven new
  `EventType` entries (`modifier.created`, `modifier.updated`,
  `modifier.price_changed`, `modifier.deactivated`,
  `modifier.reactivated`, `modifier.86ed`, `modifier.86_cleared`)
  with matching factories. Events flow through the existing
  `/config/push` overseer batch route -- no new endpoint surface --
  so the moment the overseer UI sends them they land in the ledger.
  `modifier.price_changed` carries `previous_price` + `new_price`
  for historical-pricing replay; `modifier.updated` carries
  `fields_changed` so projections can apply minimal diffs. 5 new
  tests pin emission and payload shape. LG-80 / 81 / 82 / 83 / 84
  flipped to IMPLEMENTED.
- 2026-04-24 — Phase 4d: `batch.settlement_failed` now emitted in the
  `_do_close_day` append_batch alongside `batch.submitted` + `day.closed`
  whenever the close-day invariant gate reports failures. Payload
  carries `reason`, `recon_diff`, and a list of `failed_invariants`
  (capped at 8) so replayers can distinguish a clean close from a
  drifted one without mining the diagnostic store. 2 new tests pin the
  failure and happy paths. LG-94 flipped to IMPLEMENTED.
- 2026-04-24 — Phase 4c: financial-accuracy cluster landed on
  `claude/ledger-financial-accuracy-phase4c`.
  - LG-13 `discount.voided` — new `POST /orders/{id}/discount/void`
    route voids the most recent discount (or one by `discount_id`);
    projection removes the matching entry from `order.discounts`.
  - LG-34 `seat.overpayment_resolved` — emitted in the cash
    auto-close batch when the request amount clamps down to balance
    (`resolution="change"`) and in the credit route when the overage
    was routed to tip (`resolution="tip"`).
  - LG-35 `seat.tip_added` — emitted alongside
    `payment.tip_adjusted` on first tip (when `previous_tip == 0`
    and `tip_amount > 0`). Zero-amount settlement sweeps don't
    re-fire.
  - 4 new tests under `tests/test_phase4c_emissions.py`; 1200
    backend tests green.
- 2026-04-24 — Phase 1 kicked off on branch `claude/ledger-atomicity-phase1`;
  reconnaissance complete.
- 2026-04-24 — LG-04 + LG-32: cash and credit routes in
  `backend/app/api/routes/payment_routes.py` now emit
  `payment.initiated` + `payment.confirmed` + (optional) `order.closed`
  (cash) and `payment.tip_adjusted` + (optional) `order.closed` (credit)
  as one `ledger.append_batch`. Close decision is predicted via a
  synthetic projection before any append lands. 50 payment/daily tests
  green. Remaining LG-32 work (fully atomic `payment.confirmed` +
  `order.closed` across the `manager.initiate_sale` boundary) deferred
  to Phase 2.
- 2026-04-24 — LG-53: `batch.submitted` + `day.closed` now emitted via
  one `append_batch` at the end of `_do_close_day`. Per-order
  close/void loop left as independent appends (each is idempotent via
  projection; loop-mid-crash only leaves some orders open for the next
  close attempt). 4 day-close tests green.
- 2026-04-24 — LG-14 + LG-15: `merge_orders` in
  `backend/app/api/routes/orders.py` now collects every event
  (target `item.added`/`modifier.applied`, source `check.merged`,
  source `order.voided`, target `check.merged`) into a single
  `append_batch`. Items can no longer be copied to the target while
  sources stay alive on crash. 68 order mutation / api route tests
  green.
- 2026-04-24 — LG-05: `void_order` now runs device voids first
  (502 on failure, no ledger writes) and then emits `cash_refund_due`
  per confirmed cash payment plus `order.voided` as one
  `append_batch`. Partial-refund ghosts on crash are eliminated.
- 2026-04-24 — LG-22: `add_item` does a pre-flight
  `ledger.get_event_by_idempotency_key` dedup check, then emits
  `item.added` plus every inline `modifier.applied` as one
  `append_batch`. Closes the "crash between item and modifier append
  permanently loses modifiers on retry" hole in the previous
  split-append model. 77 mutation / extended-api tests green.
- 2026-04-24 — LG-16: `split_by_seat` now collects every event (child
  `order.created`, per-item `item.added`/`modifier.applied`, parent
  `item.removed`, parent + child `check.split`) into a single
  `append_batch`. A crash mid-split can no longer leave a child with
  some items while the parent still owns them. 132 mutation / api /
  extended / pos-system tests green. Phase 1 atomicity cluster
  complete.
- 2026-04-24 — Phase 2 kicked off on branch
  `claude/ledger-missing-crit-phase2` with 6 new CRITICAL event types.
- 2026-04-24 — LG-59 `staff.pin_changed` emitted on employee creation
  with a PIN; payload carries no PIN material. 16 config-route tests
  green (14 existing + 2 new).
- 2026-04-24 — LG-01 `check.opened` added to EventType and wired into
  `create_order` (batched with `order.created`) and `split_by_seat`
  (per child order). Projection unchanged; audit-only. 132
  mutation / api / extended / pos-system tests green.
- 2026-04-24 — LG-48 `day.opened` emitted as the leading event of the
  `create_order` batch when `get_events_since(last_day_close, 1)` is
  empty, anchoring the business-day boundary atomically with the
  first order.
- 2026-04-24 — LG-62 / LG-63 `clock.in` / `clock.out` emitted in an
  `append_batch` alongside `user.logged_in` / `user.logged_out` in
  the staff clock routes.
- 2026-04-24 — LG-37 `seat.paid` emitted once per seat in the
  auto-close batch (both cash and credit paths); seat set is the
  union of `order.seat_numbers` and distinct seat numbers on items.
- 2026-04-24 — Phase 3a (payload fixes + renames) landed on
  `claude/ledger-high-phase3a`:
  - LG-36: `payment.tip_adjusted` payload now accepts optional
    `adjusted_by`; `/tip-adjust` request schema extended.
  - LG-23: `item.removed` payload accepts optional `voided_by`;
    `/orders/{id}/items/{id}?voided_by=` supported.
  - LG-90: `discount.approved` payload accepts optional
    `discount_id`; catalog-scoped applications now survive renames.
  - LG-78 / LG-79: `/menu/86` and `/menu/restore` now emit
    `item.86ed` / `item.86_cleared` in one `append_batch` with the
    legacy `menu.item_86d` / `menu.item_restored`.
- 2026-04-24 — Phase 4a: cash control ledgered. New route group
  `/day/cash/float`, `/day/cash/drop`, `/day/cash/payout`, all
  manager-gated via `require_manager`. Three new `EventType` entries
  (`DAY_CASH_FLOAT_UPDATED`, `DAY_CASH_DROP`, `DAY_CASH_PAYOUT`) and
  matching factories. Float route auto-derives `previous_float` from
  the last float event since the previous `day.closed` so clients
  don't have to track it. 4 new tests; LG-49 / LG-50 / LG-51 flipped
  to IMPLEMENTED.
- 2026-04-24 — Phase 3d: card reader admin flow now ledgered.
  `POST /hardware/devices` with `type="card_reader"` emits
  `payment.processor_configured` (LG-108, PCI/SOX audit anchor).
  Payload carries `mac`, `ip`, `name`, and `register_id` but
  deliberately excludes `tpn` and `auth_key` so the audit record
  cannot leak credentials. Printer and card-reader emission paths are
  now correctly divided (card readers no longer mis-fire
  printer.configured). 1 new test; 1196 backend tests green.
- 2026-04-24 — Phase 3c: printer admin flow now ledgered. `POST
  /hardware/devices` emits `printer.configured` (new MAC) or
  `printer.assignment_changed` (existing MAC, category list changed);
  `DELETE /hardware/devices/{mac}` emits `printer.removed` with the
  device's pre-delete name/type. New factories + enum entries added;
  5 hardware-ledger tests cover all three paths plus the
  no-change-no-event case. LG-105 / LG-106 / LG-107 flipped to
  IMPLEMENTED.
- 2026-04-24 — Phase 3b (dataset audit correction). A thorough
  reconnaissance against `backend/app/core/adapters/printer_manager.py`
  and `backend/app/api/routes/orders.py` revealed eight nodes
  previously tagged `FACTORY-ONLY` in the ledger-gap dataset are
  actually wired and emit from production code paths today:
  - LG-03 `check.reopened` (`orders.py:reopen_order`)
  - LG-09 `check.server_transferred` (`orders.py:patch_order`, `server_shift.py`)
  - LG-11 `check.cover_count_updated` (`orders.py:patch_order`)
  - LG-20 `check.named` (`orders.py:patch_order`)
  - LG-114 ticket print lifecycle (`printer_manager.py`)
  - LG-115 print retry / reroute (`printer_manager.py`)
  - LG-116 drawer open events (`printer_manager.py`)
  - LG-117 printer health family (`printer_manager.py`)
  Dataset updated to `IMPLEMENTED` with accurate `site` citations.
  No code changes — this was the audit correcting itself. Dataset
  counts now: 27 IMPLEMENTED, 16 RENAMED, 4 PARTIAL, 5 FACTORY-ONLY,
  66 MISSING (of 118 total).
