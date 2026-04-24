# Event Ledger Gap — Progress Log

Tracks the LG-## gap clusters across phased work. Source of truth for node
inventory is `backend/app/services/ledger_gap_report.py` (surfaced in the
`/entomology` Event Ledger Gaps tab).

## Snapshot

| Phase | Theme | Cluster | Nodes | Status |
| --- | --- | --- | --- | --- |
| 1 | CRITICAL atomicity | CHECK/SEAT/DAY multi-event ops | 8 | **DONE** |
| 2 | Missing CRITICAL | `check.opened`, `seat.paid`, `day.opened`, real clock.in/out | ~6 | **DONE** |
| 3a | HIGH payload fixes + renames | item.86ed/cleared, tip adjusted_by, item.removed voided_by, discount.approved discount_id | 5 | **DONE** |
| 3b | HIGH severity MISSING | Seat-granular events, compliance, batch lifecycle | ~55 | pending |
| 4 | FACTORY-ONLY wiring | Emitters for declared factories | 13 → 5 | audit-corrected in 3b; remaining 5 need new endpoints |
| 5 | RENAMED consolidation | Align code ↔ spec names | 20 | pending |
| 6 | PARTIAL payload fixes | Fill missing payload fields on implemented events | ~11 | pending |
| 7 | MEDIUM / LOW severity | Remaining nodes | ~41 | pending |

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
