# Seat Checks, Subchecks & the Probe Subsystem

Authoritative reference for how KINDpos models seats on an order, how items are
grouped by seat for display and print, how `split-by-seat` materializes child
orders in the event ledger, how payments attach back to the main check, and
what "probe" actually means in this repo.

Every claim below cites `path:line` in the working tree so the doc can be
re-verified mechanically.

---

## TL;DR

- There is **no `subcheck` entity** in this codebase. `rg -i "subcheck"` → 0 hits.
- What gets colloquially called a "subcheck" is one of two distinct things:
  1. **In-order seat grouping** — one `Order` with items carrying `seat_number`, rendered as per-seat groups on one receipt and in the UI. No separate entity.
  2. **Split-by-seat child orders** — `POST /api/v1/orders/{id}/split-by-seat` creates real, independent `Order` entities (one per seat), each retrievable on its own.
- "Probe" in this repo means **diagnostics only** (printer reachability, hardware discovery). It is not a check-lifecycle concept.

---

## 1. Data Model

Event-sourced, no SQL migrations. Current state is projected from events.

### `Order` — `backend/app/core/projections.py:65-171`

```python
@dataclass
class Order:
    order_id: str
    check_number: Optional[str] = None
    ...
    seat_numbers: list[int] = field(default_factory=list)   # :84
    items: list[OrderItem] = field(default_factory=list)    # :86
    payments: list[Payment] = field(default_factory=list)   # :87
```

- `seat_numbers` is the authoritative seat layout on the check. Set by `ORDER_CREATED` / `SEATS_UPDATED`, auto-extended when an `ITEM_ADDED` lands on a seat not yet listed (legacy replay compat — `projections.py:81-84`).
- `paid_seats` property (`projections.py:154-161`) derives the seats covered by **confirmed** payments: union of `Payment.seat_numbers` where `status == "confirmed"`.

### `OrderItem` — `backend/app/core/projections.py:24-45`

- `seat_number: Optional[int]` (line 34). Each item is attached to at most one seat; `None` means unseated.

### `Payment` — `backend/app/core/projections.py:48-62`

- `seat_numbers: list[int]` (line 62). A single payment can cover one seat, several seats, or none (whole-check payment).

### Event types — `backend/app/core/events.py:39-179`

Relevant to seats/checks:

| Event | Line | Role |
|---|---|---|
| `ORDER_CREATED` | 48 | Opens an order; emitted for both parents and split children. |
| `ORDER_CLOSED` | 49 | Finalizes an order after payment. |
| `ORDER_VOIDED` | 51 | Used by merge to retire source orders. |
| `SEATS_UPDATED` | 54 | Mutates `Order.seat_numbers` directly. |
| `CHECK_SPLIT` | 57 | Audit event emitted per affected order during split-by-seat (see §3). |
| `CHECK_MERGED` | 58 | Audit event emitted per affected order during merge (see §4). |
| `ITEM_ADDED` | 61 | Carries `seat_number` in payload. |
| `ITEM_REMOVED` | 62 | Used by split-by-seat to drop items from the parent. |
| `MODIFIER_APPLIED` | 65 | Separate event, re-emitted when items move between orders. |
| `PAYMENT_INITIATED` / `PAYMENT_CONFIRMED` | 94-95 | Carry `seat_numbers` in payload. |

`CHECK_SPLIT` and `CHECK_MERGED` are audit events emitted alongside the state-mutating events above — they do not themselves mutate `Order` state. `SEAT_MOVED` / `ITEM_MOVED` do not exist; items moving between orders use `ITEM_ADDED` + `ITEM_REMOVED`.

---

## 2. Seat Grouping Inside One Order (no new entity)

When an order has multiple seats, items are grouped per seat at render time
both in the terminal UI and in printed receipts/tickets. The order itself
remains a single entity — no per-seat record is created.

### Frontend pure helpers — `terminal/scenes/seats.js`

The file is contract-only: no DOM, no fetch, no global state. All seat math
lives here so it can be unit-tested (`seats.js:16-17`).

| Helper | Line | Contract |
|---|---|---|
| `seatSubtotal(seat)` | 26 | `qty × (effectivePrice ‖ price)` summed over items on one seat. Note: uses `‖` — effectivePrice of `0` intentionally falls back to base price (`:24`). |
| `checkSubtotal(seats, paidSeats)` | 37 | Sum of `seatSubtotal` across **unpaid** seats only. Does **not** include tax. |
| `activeSeatCount(seats, paidSeats)` | 48 | Count of seats with no payment attached. |
| `layoutModeFor(count)` | 62 | `'A'` (≤4 seats, full tiles) or `'B'` (≥5, recap + scrolling grid). |
| `orderToSeats(order, minSeats)` | 77 | Convert backend `Order` → `[{id, number, items}]`. Seeds from `order.seat_numbers` so empty seats still render, attaches items by `seat_number`, pads up to `minSeats`. Returns seats sorted by number. |
| `toggleSeatSelection(selected, paidSeats, seatId)` | 141 | Paid seats never toggle. Returns a **new** map (immutable update). |
| `toggleItemSelection(selectedItems, seatIdx, itemIdx)` | 153 | Key format `'seatIdx:itemIdx'`. Returns a new map. |
| `selectAllUnpaid(seats, paidSeats)` | 162 | Fresh map with every unpaid seat marked `true`. |
| `collectSelectedItemRefs(selectedItems)` | 176 | Decode the flat key format back into `{ seatIdx, itemIdx }` refs. |

### Print-time seat grouping (templates)

Receipts and kitchen tickets bucket items by seat for layout only. Same order,
same receipt — seat headers are just visual separators.

- **Guest receipt** — `backend/app/printing/templates/guest_receipt.py:129-147`
  - Builds `seat_groups: Dict[str, List[Dict]]` keyed by `item['seat']` (default bucket `'_default'`).
  - `show_seats = len(seat_groups) > 1 or '_default' not in seat_groups` (`:140`) — single-seat checks skip the `--- Seat N ---` headers.
- **Kitchen ticket** — `backend/app/printing/templates/kitchen_ticket.py:175-271`
  - `_group_by_seat(items)` at `:265-271` — same grouping pattern.
  - `SEAT N` header printed in bold when more than one seat or any seat is explicit (`:190-194`).
  - Red dividers between seat blocks on red-capable printers (`:256-261`).

---

## 3. Split-by-Seat — Real Child Orders

**Endpoint:** `POST /api/v1/orders/{order_id}/split-by-seat` —
`backend/app/api/routes/orders.py:1932-2041`.

**Request** (`orders.py:1928`):
```python
class SplitBySeatRequest(BaseModel):
    seats: Optional[list[int]] = None   # specific seats, or None for all
```

**Response** (`orders.py:2037-2041`):
```json
{
  "success": true,
  "parent_order_id": "order_abc",
  "child_orders": [
    {"order_id": "order_new1", "seat": 1, "item_count": 2},
    {"order_id": "order_new2", "seat": 2, "item_count": 1}
  ]
}
```

### Guarantees and invariants

- Parent `status` must be `"open"` — closed/voided parents 400 (`orders.py:1945-1949`).
- Items without a `seat_number` stay on the parent (`:1955-1956`).
- If `request.seats` is set, only those seats split; others stay on parent (`:1957-1958`).
- At least one seated item must match, otherwise 400 `"No items with seat numbers found to split"` (`:1961-1965`).

### Event sequence per child seat (`orders.py:1967-2029`)

For each seat in sorted order, a new `order_id` is minted (`order_<uuid8>` at `:1969`) and these events are appended:

1. `ORDER_CREATED` for the child (`:1973-1982`). **Critical trick:** `correlation_id` is explicitly overridden to the child's own `order_id` (`:1981`) so `get_events_by_correlation(child_id)` returns the child's events. Without this, split children would 404 on direct lookup — see the in-code comment at `:1970-1972`.
2. For every item moving to this seat:
   - `ITEM_ADDED` on the child with a fresh `item_id` (`:1994-2006`).
   - `MODIFIER_APPLIED` on the child for each modifier on the item (`:2008-2020`). **This is load-bearing:** a previous bug silently dropped modifiers because `item_added` has no `modifiers` kwarg — see the comment at `:1987-1993` and the regression test `test_modifiers_carry_over_to_split_children` in `backend/tests/test_orders_mutations.py:374`.
   - `ITEM_REMOVED` on the **parent** with reason `"Split to seat N check"` (`:2023-2029`).

### Why child orders are real entities, not UI grouping

`backend/tests/test_orders_mutations.py:347-371` (`test_splits_items_into_per_seat_child_orders`) proves it: after split, each child is independently projectable with `project_order(await ledger.get_events_by_correlation(child_id))`. Each one has its own subtotal, its own status, and will show up in `list_open_orders`. The parent's subtotal drops to `0.00` once all seated items are moved.

This is the difference from the UI-only grouping in §2. Section 2 is layout. Section 3 is ledger.

### First-class audit event — `CHECK_SPLIT`

After the per-child loop completes, `split-by-seat` emits one `CHECK_SPLIT` per affected order — one on the parent (`role="parent"`) and one on each child (`role="child"`, carrying that child's `seat`). All emissions share an `operation_id` so the full split can be reassembled across timelines. See `backend/app/api/routes/orders.py:2068-2093` (emission) and `backend/app/core/events.py:783-815` (factory).

```json
{
  "operation_id": "op_<uuid8>",
  "role": "parent" | "child",
  "parent_order_id": "...",
  "child_order_ids": ["...", "..."],
  "seat": <int | null>
}
```

`seat` is present only on `role="child"` emissions. The projection ignores `CHECK_SPLIT` — state still comes exclusively from `ORDER_CREATED` / `ITEM_ADDED` / `ITEM_REMOVED` / `MODIFIER_APPLIED`. Test coverage: `test_split_emits_check_split_on_parent_and_children` and `test_check_split_does_not_affect_projection` in `backend/tests/test_orders_mutations.py`.

### Frontend caller

- `terminal/scenes/check-overview.js:1471-1502` — `_callSplitBySeat(state, seatNumbers)` posts to the endpoint, toasts the new order IDs from `res.body.child_orders[].order_id`, and re-fetches the parent so its missing items disappear from the view.
- Tool bar wiring: `MANAGE_TOOLS` list at `check-overview.js:1260-1264` (`move`, `split`, `merge`).
- Split is a two-tap commit: first tap enters split mode, seeds recipients; second tap commits via `_enterManageSplit` → `_commitManageSplit` (see comments at `:1433-1444`).
- `_mergeToNewCheck` at `:1511-1557` uses split-by-seat under the hood for the "+CHECK" action — arbitrary item selections get moved onto a fresh seat, then that single seat is split off.

---

## 4. Merge — Collapsing Orders Back

**Endpoint:** `POST /api/v1/orders/{order_id}/merge` —
`backend/app/api/routes/orders.py:1356-1451`.

**Request** (`orders.py:1350-1353`):
```python
class MergeOrderRequest(BaseModel):
    source_ids: list[str] = Field(..., min_length=1)
    approved_by: Optional[str] = None
```

### Preconditions (`orders.py:1366-1410`)

- `approved_by` must be non-empty — manager approval required; 403 otherwise (`:1366-1370`).
- Target must be `open` (`:1372-1377`).
- Every source must be `open` (`:1391-1395`).
- No source may have a confirmed payment — "void or refund first" 400 (`:1396-1400`).
- Self-merge rejected (`:1382-1386`).
- Duplicate source IDs silently deduped (`:1387-1389`).
- Target is **re-fetched immediately before the write loop** (`:1403-1410`) to detect a concurrent close and 409 instead of silently merging into a closed check.

### Event sequence per source (`orders.py:1412-1448`)

For each source, in order:

1. For every item on the source:
   - `ITEM_ADDED` on the target with a fresh `item_id`, preserving `seat_number` (`:1414-1427`).
   - `MODIFIER_APPLIED` on the target for every modifier (`:1428-1440`).
2. `ORDER_VOIDED` on the source with reason `"Merged into {target_id}"` (`:1442-1448`).

Response: a fresh `OrderResponse` built from the re-projected target (`:1450-1451`).

Tests: `backend/tests/test_orders_mutations.py:104-266` (`TestMergeOrders`) — covers item copy, modifier preservation, multi-source, self-merge rejection, manager-approval requirement, closed-source rejection, confirmed-payment rejection, and target-must-be-open.

### First-class audit event — `CHECK_MERGED`

`merge_orders` emits one `CHECK_MERGED` per affected order: one on each source (`role="source"`) emitted **before** that source's `ORDER_VOIDED` so the source timeline stays monotone (alive → merged → voided), and one on the target (`role="target"`) after the loop. All share an `operation_id`. See `backend/app/api/routes/orders.py:1414-1482` (emission) and `backend/app/core/events.py:818-846` (factory).

```json
{
  "operation_id": "op_<uuid8>",
  "role": "target" | "source",
  "target_order_id": "...",
  "source_order_ids": ["...", "..."],
  "approved_by": "<manager_id>"
}
```

The projection ignores `CHECK_MERGED` — state still comes from `ITEM_ADDED` (target) + `ORDER_VOIDED` (source). Test coverage: `test_merge_emits_check_merged_on_target_and_sources` and `test_merge_source_check_merged_precedes_void` in `backend/tests/test_orders_mutations.py`.

---

## 5. Split-Evenly — Payment Math, No New Orders

**Endpoint:** `POST /api/v1/orders/{order_id}/split-evenly` —
`backend/app/api/routes/orders.py:2048-2079`.

This is **not** analogous to split-by-seat. It creates no child orders and no
events. It computes the per-person amount so the frontend can run N individual
payments against the same `order_id`.

**Request** (`orders.py:2044-2045`):
```python
class SplitEvenlyRequest(BaseModel):
    num_ways: int = Field(ge=2, le=20)
```

**Response** (`orders.py:2072-2079`):
```json
{
  "success": true,
  "order_id": "order_abc",
  "total": 60.00,
  "num_ways": 3,
  "per_person": 20.00,
  "last_person": 20.00
}
```

- Order status must be `open` or `closed`; voided orders 400 (`:2061-2065`).
- `last_person = total - per_person × (num_ways - 1)` absorbs rounding drift (`:2070`).
- Tests: `backend/tests/test_orders_mutations.py:456-508` (`TestSplitEvenly`) — clean division, remainder, voided rejection.

---

## 6. Payments — Grouping Back Into the Main Check

A single `Order` can carry N `Payment` rows, each with its own `seat_numbers`.
The union of confirmed-payment seats is the set of "paid" seats.

### Frontend resolution — `terminal/scenes/payment.js:905-956`

Payment scene accepts two param shapes (legacy + current):

- Legacy SM2: `sceneData.seatNumbers = [1, 2, 3]` (`:911-913`).
- Vz2.0 check-overview: `sceneData.seats = [{seatId, number, items}, ...]` → number extracted (`:914-919`).

If seats are resolved, `seat_numbers: [...]` is forwarded on both payment paths:

- Cash: `POST /payments/cash` with `cashBody.seat_numbers` (`:921-933`).
- Card: `POST /payments/sale` with `saleBody.seat_numbers` (`:940-956`).

The leading comment (`:906-910`) is the canonical explanation: without
`seat_numbers` on the payment, check-overview can't color seats gold as paid on
return.

### Backend derivation — `backend/app/core/projections.py:154-161`

```python
@property
def paid_seats(self) -> list[int]:
    seats = set()
    for p in self.payments:
        if p.status == "confirmed" and p.seat_numbers:
            seats.update(p.seat_numbers)
    return sorted(seats)
```

- Only **confirmed** payments count — pending, failed, cancelled, timed-out, errored are ignored.
- Union semantics: two payments covering `[1, 2]` and `[2, 3]` yield `paid_seats = [1, 2, 3]`.
- Payments with empty `seat_numbers` (whole-check payment or legacy data) contribute nothing to `paid_seats` even if they fully settle the balance.

Tests: `backend/tests/test_seat_payments.py:142-268` (`TestSeatPaymentProjection`) covers single-seat, multi-payment, multi-seat-single-payment, failed-not-paid, pending-not-paid, backwards-compat empty, dedup, and sort.

### Receipt aggregation

Payments are receipt-per-payment, not receipt-per-seat: a single guest receipt
is generated per confirmed payment, and within that receipt items are grouped
by seat when the receipt covers more than one seat (§2,
`guest_receipt.py:129-147`). Two card payments on a three-seat check therefore
produce two guest receipts.

---

## 7. Probe — Disambiguation

**"Probe" in this codebase is diagnostics only.** It is not a payment, not a
pre-authorization, not a receipt preview, not a check-lifecycle step. Two
subsystems use the word:

### KINDnostic probes — `kindnostic/probes/printers.py`

- `probe_receipt_printer_reachable()` at `:58-89` — TCP connect to the receipt printer IP/port read from `hardware_config.db`. Returns a `ProbeResult` with `status=PASS/WARN` and `{ip, port, reachable}` metadata.
- `probe_kitchen_printer_reachable()` at `:92-...` — same pattern for the kitchen printer.
- Harness: `kindnostic/runner.py` discovers and runs probes at boot.

### Hardware discovery endpoint — `backend/app/api/routes/hardware.py`

- `_tcp_probe(host, port, timeout)` — raw TCP connectivity test.
- `_probe_host(ip, mac, ports, timeout)` — async probe with a port list.
- `POST /api/v1/hardware/probe` at `:631-649` — `ProbeRequest { ip, port=9100 }` returns `{found, model, mac, protocol, type, port}`. Used for discovering/identifying card readers and printers on the network.

### Why it's in this doc

Two repo-root markdown files use "probe" in the colloquial "audit" sense and
have nothing to do with seats or checks: `PROBE_REPORT.md` (stability audit
findings) and `LANDING_PROBE_PROMPT.md` (bug-hunt task for landing scenes).
Readers wiring "probe check" to a runtime concept should stop here — the
runtime meaning is hardware health, nothing more.

---

## 8. Glossary

| Colloquial term | Actual concept in code |
|---|---|
| "subcheck" | Not a thing. Either §2 (in-order seat grouping) or §3 (split-by-seat child order), depending on context. Grep will return zero hits. |
| "seat check" | Ambiguous. On a multi-seat order it usually refers to the per-seat section of one printed receipt (§2). After `split-by-seat` it refers to a child `Order` (§3). |
| "child check" | A child `Order` produced by `split-by-seat` (§3). The only hits in code are comments in `terminal/scenes/check-overview.js:1356, 1543`. |
| "main check" | The parent `Order`. After a split, the parent still exists and holds any unseated items. |
| "+CHECK" button | UI shortcut that calls `split-by-seat` under the hood — either directly (whole seats selected) or by first moving arbitrary item selections onto a fresh seat (`check-overview.js:1511-1557`). |
| "split evenly" | Payment math only (§5). No new orders. |
| "probe check" | **Not a concept.** "Probe" = diagnostics (§7). |

---

## 9. Verification

### Tests

```
pytest backend/tests/test_orders_mutations.py::TestSplitBySeat -q
pytest backend/tests/test_orders_mutations.py::TestMergeOrders -q
pytest backend/tests/test_orders_mutations.py::TestSplitEvenly -q
pytest backend/tests/test_seat_payments.py -q
pytest backend/tests/test_check_state_validity.py -q
```

Key test functions referenced in this doc:

- `test_splits_items_into_per_seat_child_orders` — `test_orders_mutations.py:347` — proves children are real ledger entities.
- `test_modifiers_carry_over_to_split_children` — `test_orders_mutations.py:374` — regression for the `MODIFIER_APPLIED` replay.
- `test_split_specific_seats_only` — `test_orders_mutations.py:391` — `seats=[...]` selects subset.
- `test_merge_preserves_modifiers` — `test_orders_mutations.py:128`.
- `test_merge_rejects_source_with_confirmed_payment` — `test_orders_mutations.py:214`.
- `TestSeatPaymentProjection` — `test_seat_payments.py:142` — the full `paid_seats` derivation.

### Grep sentinels

```
rg -n -i "subcheck" .        # MUST remain 0 hits
rg -n "split-by-seat" .      # endpoint + callers
rg -n "paid_seats" backend/app
rg -n "seat_groups" backend/app/printing
rg -n "check\.split|check\.merged" backend/   # §3 and §4 audit events
```

### Manual end-to-end

1. Create a 2-seat order with items on each seat.
2. `curl -X POST /api/v1/orders/{id}/split-by-seat -d '{"seats": null}'` — response returns two `child_orders[].order_id`.
3. `curl /api/v1/orders/{child_id}` for each child — each is independently fetchable, each carries its own subtotal.
4. `curl /api/v1/orders/{parent_id}` — parent remains but its seated items are gone.
5. In the terminal UI, on a 2-seat check, tap MANAGE → SPLIT with a seat's items selected → confirm the child appears as a separate check and the parent refreshes without those items.
6. Pay one seat with card; on return, verify that seat renders gold (paid) on the overview and that `Payment.seat_numbers` matches the seat(s) tendered.






