# Event Ledger Gap — Progress Log

Tracks the LG-## gap clusters across phased work. Source of truth for node
inventory is `backend/app/services/ledger_gap_report.py` (surfaced in the
`/entomology` Event Ledger Gaps tab).

## Snapshot

| Phase | Theme | Cluster | Nodes | Status |
| --- | --- | --- | --- | --- |
| 1 | CRITICAL atomicity | CHECK/SEAT/DAY multi-event ops | 8 | **DONE** |
| 2 | Missing CRITICAL | `check.opened`, `seat.paid`, `day.opened`, real clock.in/out | ~6 | pending |
| 3 | HIGH severity MISSING | Seat-granular events, compliance, batch lifecycle | ~60 | pending |
| 4 | FACTORY-ONLY wiring | Emitters for declared factories | 13 | pending |
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

## Phase 2 — Missing CRITICAL events (pending)

| ID | Event | Source |
| --- | --- | --- |
| LG-01 | `check.opened` | currently fused into `order.created` |
| LG-37 | `seat.paid` | no per-seat paid marker |
| LG-48 | `day.opened` | day begins implicitly on first order |
| LG-62 | real `clock.in` (distinct from login) | `user.logged_in` today |
| LG-63 | real `clock.out` | `user.logged_out` today |
| LG-59 | `staff.pin_changed` | PCI/SOX audit gap |

---

## Phase 3+ — deferred

Full detail in `backend/app/services/ledger_gap_report.py`. Surface it in
the `/entomology` → Event Ledger Gaps tab.

---

## Changelog

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
