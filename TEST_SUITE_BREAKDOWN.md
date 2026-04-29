# KINDpos Test Suite Breakdown

## Conventions

- **Tests** — what the test is asserting (behaviour / invariant)
- **Method** — how it sets up state and exercises the code
- **Pass** — the concrete assertion(s) that must hold

---

# Backend Tests

## `conftest.py`
> Shared test fixtures providing EventLedger, PrinterManager with 4 mock printers, and DiagnosticCollector

conftest.py contains only fixture definitions, no individual test functions.

---

## `test_adjust_tip_on_order.py`
> Regression tests for order-scoped tip-adjust endpoint including precision gates and event emission

### `test_first_tip_adjust_emits_event_with_zero_previous`
| | |
|---|---|
| **Tests** | First tip adjustment on a confirmed card payment records a TIP_ADJUSTED event with 0.00 previous_tip |
| **Method** | Direct route handler call after seeding order + payment via ledger events |
| **Pass** | Response success=True, tip_amount matches request, previous_tip=0.00; event exists with 2dp precision |

### `test_second_adjust_surfaces_rounded_previous_tip`
| | |
|---|---|
| **Tests** | Re-adjusting a tip returns the previous tip as a 2dp Decimal (M2 fix: previous_tip is money_rounded) |
| **Method** | Direct route handler call; perform two tip adjustments sequentially |
| **Pass** | Second adjustment response previous_tip equals first adjustment's tip_amount (rounded); ledger event payload preserves 2dp |

### `test_negative_tip_rejected`
| | |
|---|---|
| **Tests** | Negative tip amounts are rejected at the API boundary |
| **Method** | Direct route handler call with negative tip_amount in request |
| **Pass** | HTTPException with status 400, detail contains "negative" |

### `test_tip_with_more_than_two_decimal_places_rejected`
| | |
|---|---|
| **Tests** | Tip amounts with 3+ decimal places are rejected by _validate_2dp |
| **Method** | Direct route handler call with Decimal("1.234") |
| **Pass** | HTTPException with status 400, detail contains "decimal places" |

### `test_missing_order_returns_404`
| | |
|---|---|
| **Tests** | Attempting to adjust tip on non-existent order returns 404 |
| **Method** | Direct route handler call with invalid order_id |
| **Pass** | HTTPException with status 404 |

### `test_missing_payment_returns_404`
| | |
|---|---|
| **Tests** | Attempting to adjust tip on non-existent payment returns 404 with payment_id in message |
| **Method** | Direct route handler call with valid order_id but invalid payment_id |
| **Pass** | HTTPException with status 404, detail contains payment_id |

### `test_pending_payment_rejected`
| | |
|---|---|
| **Tests** | Tip adjustment is only allowed on CONFIRMED payments; pending status is rejected |
| **Method** | Direct route handler call after seeding order + payment_initiated (not confirmed) |
| **Pass** | HTTPException with status 400, detail contains "confirmed" |

---

## `test_api_orders_extended.py`
> Extended order API endpoint tests for list operations, reopen, close_batch, merge, and day history

### `test_list_active_orders`
| | |
|---|---|
| **Tests** | GET /api/v1/orders/active returns open orders with items |
| **Method** | HTTP request via TestClient after creating multiple orders with items |
| **Pass** | Status 200, response is list with len >= 2 |

### `test_list_open_orders`
| | |
|---|---|
| **Tests** | GET /api/v1/orders/open returns orders with status='open' |
| **Method** | HTTP request via TestClient after creating order with item |
| **Pass** | Status 200, all returned orders have status='open' |

### `test_reopen_closed_order`
| | |
|---|---|
| **Tests** | POST /api/v1/orders/{id}/reopen transitions a paid+closed order back to open |
| **Method** | HTTP request via TestClient; verify closed state first, then reopen |
| **Pass** | Status 200, reopen response status='open'; prior state was 'closed' |

### `test_close_batch`
| | |
|---|---|
| **Tests** | POST /api/v1/orders/close-batch settles paid orders and returns order_count |
| **Method** | HTTP request via TestClient after creating and paying multiple orders |
| **Pass** | Status 200, success=True, order_count >= 2 |

### `test_merge_orders_moves_items_and_voids_sources`
| | |
|---|---|
| **Tests** | POST /api/v1/orders/{target}/merge moves items from source to target and voids sources |
| **Method** | HTTP request via TestClient with source_ids and approved_by |
| **Pass** | Status 200, merged order contains all items from sources, source orders have status='voided' |

### `test_merge_requires_approved_by`
| | |
|---|---|
| **Tests** | Merge request without approved_by is rejected with 403 |
| **Method** | HTTP request via TestClient without approved_by parameter |
| **Pass** | Status 403 |

### `test_merge_rejects_self`
| | |
|---|---|
| **Tests** | Merging an order into itself is rejected |
| **Method** | HTTP request via TestClient with source_ids containing target order_id |
| **Pass** | Status 400 |

### `test_merge_rejects_non_open_source`
| | |
|---|---|
| **Tests** | Cannot merge a non-open source order (e.g., paid/closed) |
| **Method** | HTTP request via TestClient with closed source order |
| **Pass** | Status 400 |

### `test_get_day_history`
| | |
|---|---|
| **Tests** | GET /api/v1/orders/day-history returns list of daily summaries after close-day |
| **Method** | HTTP request via TestClient after paying order and closing day |
| **Pass** | Status 200, response is list with len >= 1, each entry has closed_at and date fields |

---

## `test_api_routes.py`
> Comprehensive API route integration tests covering orders, payments, config, menu, staff, hardware, and financial precision

### `test_create_order`
| | |
|---|---|
| **Tests** | POST /api/v1/orders creates a new order with correct initial state |
| **Method** | HTTP request via TestClient with order metadata |
| **Pass** | Status 201, response contains order_id, status='open', financial fields are 0.00, items=[], check_number starts with C- |

### `test_get_order_not_found`
| | |
|---|---|
| **Tests** | GET /api/v1/orders/{id} returns 404 for non-existent order |
| **Method** | HTTP request via TestClient with invalid order_id |
| **Pass** | Status 404 |

### `test_seats_persist_without_items`
| | |
|---|---|
| **Tests** | Seat numbers set on order creation persist after logout and item addition |
| **Method** | HTTP request via TestClient; create with seats, GET, add item, verify seats unchanged |
| **Pass** | Status 200 on all requests, seat_numbers match across round-trips, other seats preserved |

### `test_seats_rejects_empty_list`
| | |
|---|---|
| **Tests** | Seat list cannot be set to empty (prevents ghosting seated checks) |
| **Method** | HTTP request via TestClient with seat_numbers=[] |
| **Pass** | Status 422 on both POST and PUT |

### `test_seats_rejects_non_positive`
| | |
|---|---|
| **Tests** | Seat numbers must be >= 1; 0 and negatives are rejected |
| **Method** | HTTP request via TestClient with invalid seat numbers |
| **Pass** | Status 422 on POST and PUT |

### `test_seats_updated_does_not_orphan_items`
| | |
|---|---|
| **Tests** | If seat update would orphan items, projection unions item-referenced seats back in |
| **Method** | HTTP request via TestClient; add item to seat 2, update seats to [1] only |
| **Pass** | Status 200, response seat_numbers union to [1,2], item still present on seat 2 |

### `test_create_order_is_idempotent`
| | |
|---|---|
| **Tests** | Retrying POST /orders with same Idempotency-Key returns same order, not duplicate C-NNN |
| **Method** | HTTP request via TestClient with Idempotency-Key header |
| **Pass** | Status 201 both times, order_id and check_number identical; fresh key creates new order |

### `test_add_item_is_idempotent`
| | |
|---|---|
| **Tests** | Retrying POST /orders/{id}/items with same Idempotency-Key dedupes the item |
| **Method** | HTTP request via TestClient with Idempotency-Key header on item POST |
| **Pass** | Status 200 both times, single item in order (not two), same item_id returned |

### `test_add_item_different_keys_create_distinct_items`
| | |
|---|---|
| **Tests** | Different Idempotency-Keys with same body create separate items |
| **Method** | HTTP request via TestClient with two distinct Idempotency-Key values |
| **Pass** | Status 200 both times, order has 2 items with different item_ids |

### `test_add_item_duplicate_does_not_emit_orphan_modifier_events`
| | |
|---|---|
| **Tests** | Deduped item (duplicate Idempotency-Key) does not emit orphan MODIFIER_APPLIED events |
| **Method** | HTTP request via TestClient; POST item with modifiers twice using same Idempotency-Key |
| **Pass** | Status 200 both times, single item with single modifier (projection matches expected state) |

### `test_seated_empty_check_shows_on_landing`
| | |
|---|---|
| **Tests** | A check with seats but no items appears in GET /orders lists |
| **Method** | HTTP request via TestClient; create seated order without items |
| **Pass** | Status 200, order appears in both /orders and /orders/open lists |

### `test_add_items_and_send`
| | |
|---|---|
| **Tests** | Adding items and sending to kitchen emits ITEM_SENT events and updates projection |
| **Method** | HTTP request via TestClient; create, add items, POST send |
| **Pass** | Status 200 all requests, send response sent_count matches items, ledger contains ITEM_SENT events |

### `test_full_order_lifecycle`
| | |
|---|---|
| **Tests** | Create → add item → initiate payment → confirm → close — happy path |
| **Method** | HTTP request via TestClient through all steps |
| **Pass** | All requests 200/201, final status='closed', ledger contains all expected event types |

### `test_close_order_with_balance_fails`
| | |
|---|---|
| **Tests** | Cannot close an order with unpaid balance |
| **Method** | HTTP request via TestClient; try to close order with items but no payment |
| **Pass** | Status 400, detail contains "balance due" |

### `test_void_order`
| | |
|---|---|
| **Tests** | Voiding an order marks status='voided' and emits ORDER_VOIDED event |
| **Method** | HTTP request via TestClient with reason and approved_by |
| **Pass** | Status 200, response status='voided', ledger contains ORDER_VOIDED with correct payload |

### `test_list_and_filter_orders`
| | |
|---|---|
| **Tests** | GET /api/v1/orders?status_filter=X filters by status |
| **Method** | HTTP request via TestClient; create open and voided orders, filter each |
| **Pass** | All requests 200, filter=open returns 1 order, filter=voided returns 1 order, no filter returns 2 |

### `test_remove_item`
| | |
|---|---|
| **Tests** | DELETE /orders/{id}/items/{item_id} removes item from order |
| **Method** | HTTP request via TestClient; create, add item, delete item |
| **Pass** | All requests 200, final order items=[] |

### `test_modify_item`
| | |
|---|---|
| **Tests** | PATCH /orders/{id}/items/{item_id} updates quantity and subtotal |
| **Method** | HTTP request via TestClient; create, add item with quantity=1, PATCH quantity=3 |
| **Pass** | Status 200, quantity=3, subtotal reflects 3x price |

### `test_apply_modifier`
| | |
|---|---|
| **Tests** | POST modifier adds to item and adjusts subtotal |
| **Method** | HTTP request via TestClient; create, add item, POST modifier |
| **Pass** | Status 200, item has 1 modifier, subtotal = base + modifier_price |

### `test_cash_payment_route`
| | |
|---|---|
| **Tests** | POST /api/v1/payments/cash processes cash and emits PAYMENT_INITIATED + PAYMENT_CONFIRMED |
| **Method** | HTTP request via TestClient after creating order with item |
| **Pass** | Status 200, success=True, ledger contains payment events with 2dp precision |

### `test_cash_payment_never_emits_tip_adjusted`
| | |
|---|---|
| **Tests** | Cash payments never emit TIP_ADJUSTED; cash tips declared at clock-out |
| **Method** | HTTP request via TestClient; POST cash payment |
| **Pass** | Status 200, response has no 'tip' field, ledger has no TIP_ADJUSTED events |

### `test_tip_adjust_route`
| | |
|---|---|
| **Tests** | POST /api/v1/payments/tip-adjust on confirmed payment emits TIP_ADJUSTED |
| **Method** | HTTP request via TestClient; cash pay then tip adjust |
| **Pass** | Status 200, success=True, tip_amount matches request, previous_tip=0.0 |

### `test_tip_adjust_nonexistent_order`
| | |
|---|---|
| **Tests** | Tip adjust on missing order returns 404 |
| **Method** | HTTP request via TestClient with invalid order_id |
| **Pass** | Status 404 |

### `test_get_terminal_bundle`
| | |
|---|---|
| **Tests** | GET /api/v1/config/terminal-bundle returns full config bundle |
| **Method** | HTTP request via TestClient |
| **Pass** | Status 200, response contains store, employees, roles, menu, floor_plan, hardware, bundle_version=1 |

### `test_update_store_info`
| | |
|---|---|
| **Tests** | POST /api/v1/config/store/info writes STORE_INFO_UPDATED event |
| **Method** | HTTP request via TestClient with store info fields |
| **Pass** | Status 200, status='ok', ledger contains STORE_INFO_UPDATED event with correct payload |

### `test_86_and_restore_menu_item`
| | |
|---|---|
| **Tests** | POST 86 then restore emits correct event types |
| **Method** | HTTP request via TestClient with item_id |
| **Pass** | Status 200 both requests, ledger contains MENU_ITEM_86D then MENU_ITEM_RESTORED events |

### `test_get_store_config`
| | |
|---|---|
| **Tests** | GET /api/v1/config/store returns projected config |
| **Method** | HTTP request via TestClient |
| **Pass** | Status 200 |

### `test_push_config_changes`
| | |
|---|---|
| **Tests** | POST /api/v1/config/push batch writes config events |
| **Method** | HTTP request via TestClient with event array |
| **Pass** | Status 200, events_written matches input count, ledger contains events |

### `test_get_menu_empty`
| | |
|---|---|
| **Tests** | GET /api/v1/menu returns empty menu state on fresh ledger |
| **Method** | HTTP request via TestClient |
| **Pass** | Status 200, categories=[], items=[] |

### `test_get_categories_and_items`
| | |
|---|---|
| **Tests** | Seeding menu events and GETting /categories and /items returns them |
| **Method** | HTTP request via TestClient after appending menu events to ledger |
| **Pass** | Status 200 both requests, response lists contain seeded category and item |

### `test_clock_in_and_out`
| | |
|---|---|
| **Tests** | Clock in employee, verify clocked-in list, clock out, verify removed |
| **Method** | HTTP request via TestClient for all three operations |
| **Pass** | Status 200 all requests, clocked-in list shows employee after in and not after out, ledger events present |

### `test_get_servers_roster`
| | |
|---|---|
| **Tests** | GET /api/v1/servers returns roster (empty on fresh ledger) |
| **Method** | HTTP request via TestClient |
| **Pass** | Status 200, response contains 'servers' key |

### `test_hardware_status`
| | |
|---|---|
| **Tests** | GET /api/v1/hardware/status returns online status and endpoints |
| **Method** | HTTP request via TestClient |
| **Pass** | Status 200, status='online', 'default_subnet' and 'endpoints' in response |

### `test_hardware_test_connection`
| | |
|---|---|
| **Tests** | POST /api/v1/hardware/test-connection tests TCP connectivity |
| **Method** | HTTP request via TestClient with IP and port |
| **Pass** | Status 200, status in ('online', 'unreachable'), ip and port in response |

### `test_financial_2dp_precision`
| | |
|---|---|
| **Tests** | All financial values in order response have 2dp precision |
| **Method** | HTTP request via TestClient; create order with tricky prices |
| **Pass** | Status 200, subtotal/tax/total all have 2dp in response and ledger events |

### `test_day_summary`
| | |
|---|---|
| **Tests** | GET /api/v1/orders/day-summary returns aggregates |
| **Method** | HTTP request via TestClient after creating and closing order |
| **Pass** | Status 200, closed_orders >= 1, total_sales > 0 |

### `test_close_day`
| | |
|---|---|
| **Tests** | POST /api/v1/orders/close-day writes DAY_CLOSED event |
| **Method** | HTTP request via TestClient |
| **Pass** | Status 200, success=True, summary present, ledger contains DAY_CLOSED event |

### `test_health_check`
| | |
|---|---|
| **Tests** | GET /health returns healthy status |
| **Method** | HTTP request via TestClient |
| **Pass** | Status 200, status='healthy', app='KINDpos' |

---

## `test_append_batch.py`
> Tests for EventLedger.append_batch() atomicity, hash chain continuity, and concurrent append behavior

### `test_append_batch_returns_all_events`
| | |
|---|---|
| **Tests** | append_batch returns a list with all input events and sequence_number set |
| **Method** | Direct ledger method call with list of 5 events |
| **Pass** | Results len=5, all have sequence_number != None |

### `test_append_batch_hash_chain_continuity`
| | |
|---|---|
| **Tests** | Hash chain remains valid after batch append |
| **Method** | Direct ledger method call; append batch, then verify_chain |
| **Pass** | verify_chain returns (True, None) |

### `test_append_batch_after_single_appends`
| | |
|---|---|
| **Tests** | Hash chain valid when batch is appended after single append() calls |
| **Method** | Direct ledger method calls; 3 single appends then batch of 5 |
| **Pass** | verify_chain returns (True, None), count_events=8 |

### `test_append_batch_empty_list`
| | |
|---|---|
| **Tests** | append_batch([]) returns empty list |
| **Method** | Direct ledger method call with empty list |
| **Pass** | Results == [] |

### `test_append_batch_sequence_numbers_contiguous`
| | |
|---|---|
| **Tests** | Batch sequence numbers are contiguous after prior event |
| **Method** | Direct ledger method calls; append 1 single event, then batch of 5 |
| **Pass** | Batch sequence numbers are [2, 3, 4, 5, 6] |

### `test_concurrent_appends_no_duplicate_sequence`
| | |
|---|---|
| **Tests** | 10 concurrent append() calls produce unique sequence numbers |
| **Method** | asyncio.gather 10 append tasks |
| **Pass** | All sequence_numbers unique, sorted list matches [1..10] |

### `test_count_events`
| | |
|---|---|
| **Tests** | count_events returns correct total |
| **Method** | Direct ledger method calls; append 5 events, count |
| **Pass** | count=5 |

### `test_get_latest_sequence`
| | |
|---|---|
| **Tests** | get_latest_sequence returns the highest sequence_number |
| **Method** | Direct ledger method calls; append 3 events, get latest |
| **Pass** | latest=3 |

---

## `test_auth_routes.py`
> Tests for PIN verification, session tokens, rate limiting, and role-gate dependency for auth routes

### `test_correct_pin_returns_token_and_roles`
| | |
|---|---|
| **Tests** | Correct PIN returns valid=True with token and role_ids |
| **Method** | Direct route handler call with VerifyPinRequest after seeding employee |
| **Pass** | valid=True, employee_id/name match, roles=['server','trainer'], token is 20+ char string |

### `test_wrong_pin_returns_valid_false_no_token`
| | |
|---|---|
| **Tests** | Wrong PIN returns valid=False without issuing token |
| **Method** | Direct route handler call with incorrect PIN |
| **Pass** | Result == {valid: False}, _sessions dict empty |

### `test_inactive_employee_cannot_authenticate`
| | |
|---|---|
| **Tests** | Inactive employee record does not authenticate even with correct PIN |
| **Method** | Direct route handler call on inactive employee |
| **Pass** | valid=False |

### `test_successful_auth_does_not_count_toward_rate_limit`
| | |
|---|---|
| **Tests** | Successful logins don't increment rate-limit failure counter |
| **Method** | Direct route handler call; 10 successful logins with same PIN |
| **Pass** | _attempts[client_host] == [] (empty, no failures recorded) |

### `test_429_after_max_failed_attempts`
| | |
|---|---|
| **Tests** | Fifth failed login within window triggers 429 on sixth attempt (even correct PIN) |
| **Method** | Direct route handler call; 5 wrong PINs, then 6th request |
| **Pass** | First 5 return {valid: False}, 6th raises HTTPException with status 429 |

### `test_rate_limit_is_per_client`
| | |
|---|---|
| **Tests** | Rate limit counts failures from a single client IP, not globally |
| **Method** | Direct route handler call; fail from IP A, succeed from IP B |
| **Pass** | IP A 429s after MAX_ATTEMPTS, IP B succeeds on next attempt |

### `test_rate_limit_window_expires`
| | |
|---|---|
| **Tests** | Failed attempts older than WINDOW_SECONDS don't count toward limit |
| **Method** | Direct route handler call with monkeypatched time.monotonic |
| **Pass** | After fast-forwarding past WINDOW_SECONDS, rate limit is cleared and login succeeds |

### `test_get_current_session_accepts_valid_bearer`
| | |
|---|---|
| **Tests** | Valid Bearer token in Authorization header is accepted |
| **Method** | Direct dependency call with token in header |
| **Pass** | Session returned with employee_id and roles |

### `test_get_current_session_rejects_missing_header`
| | |
|---|---|
| **Tests** | Missing Authorization header raises 401 |
| **Method** | Direct dependency call without auth header |
| **Pass** | HTTPException with status 401 |

### `test_get_current_session_rejects_bogus_token`
| | |
|---|---|
| **Tests** | Invalid token string raises 401 |
| **Method** | Direct dependency call with garbage token |
| **Pass** | HTTPException with status 401 |

### `test_get_current_session_rejects_non_bearer_scheme`
| | |
|---|---|
| **Tests** | Only Bearer scheme accepted; Basic or token= are rejected |
| **Method** | Direct dependency call with non-Bearer auth header |
| **Pass** | HTTPException raised |

### `test_token_expires_past_ttl`
| | |
|---|---|
| **Tests** | Tokens hard-TTL at TOKEN_TTL_SECONDS (8 hours) |
| **Method** | Direct dependency call with monkeypatched time.monotonic |
| **Pass** | Before TTL succeeds, after TTL raises 401 |

### `test_role_match_passes`
| | |
|---|---|
| **Tests** | require_role dependency allows sessions with matching role |
| **Method** | Direct call to extracted check function from Depends(require_role(...)) |
| **Pass** | Function returns without raising |

### `test_role_mismatch_403s`
| | |
|---|---|
| **Tests** | require_role dependency rejects sessions without required role |
| **Method** | Direct call to extracted check function with mismatched role |
| **Pass** | HTTPException with status 403 |

### `test_empty_role_list_denies`
| | |
|---|---|
| **Tests** | Session with no roles cannot satisfy any require_role check |
| **Method** | Direct call to extracted check function with empty roles |
| **Pass** | HTTPException raised |

### `test_logout_invalidates_only_that_token`
| | |
|---|---|
| **Tests** | logout removes only the specified token from _sessions, leaves others |
| **Method** | Direct route handler call with Bearer token in header |
| **Pass** | Specified token evicted from _sessions, other tokens remain |

### `test_logout_with_no_header_is_a_no_op`
| | |
|---|---|
| **Tests** | logout without Authorization header is safe no-op |
| **Method** | Direct route handler call without auth header |
| **Pass** | Result == {ok: True}, all tokens remain in _sessions |

### `test_logout_with_unknown_token_is_a_no_op`
| | |
|---|---|
| **Tests** | logout with invalid token is safe no-op |
| **Method** | Direct route handler call with garbage Bearer token |
| **Pass** | Result == {ok: True} |

---

## `test_cash_and_tip_flows.py`
> Tests for cash payment and tip adjustment flows including event emission and financial precision

### `test_cash_payment_success`
| | |
|---|---|
| **Tests** | Cash payment emits PAYMENT_INITIATED and PAYMENT_CONFIRMED with 2dp precision |
| **Method** | Direct payment route handler call after seeding order with item |
| **Pass** | success=True, ledger contains both payment events with correct amount in 2dp |

### `test_cash_payment_never_emits_tip_adjusted`
| | |
|---|---|
| **Tests** | Cash payments never emit TIP_ADJUSTED; cash tips declared at clock-out |
| **Method** | Direct payment route handler call |
| **Pass** | success=True, ledger has no TIP_ADJUSTED events |

### `test_cash_payment_auto_closes_order`
| | |
|---|---|
| **Tests** | Order status transitions to 'closed' when fully paid via cash |
| **Method** | Direct payment route handler call with exact total (including tax) |
| **Pass** | Order status='closed', ORDER_CLOSED event exists in ledger |

### `test_tip_adjustment_success`
| | |
|---|---|
| **Tests** | Adjusting tip on confirmed payment emits TIP_ADJUSTED event |
| **Method** | Direct tip adjust route handler call after cash payment |
| **Pass** | success=True, tip_amount matches request, previous_tip=0.0, TIP_ADJUSTED event in ledger |

### `test_tip_adjustment_cumulative`
| | |
|---|---|
| **Tests** | Second tip adjustment records previous tip amount correctly |
| **Method** | Direct tip adjust route handler call twice sequentially |
| **Pass** | Second call previous_tip equals first adjustment amount, both TIP_ADJUSTED events in ledger |

### `test_tip_adjustment_failures`
| | |
|---|---|
| **Tests** | Tip adjust rejects non-existent order and payment |
| **Method** | Direct tip adjust route handler call with invalid order_id or payment_id |
| **Pass** | HTTPException with status 404 for both cases |

### `test_precision_gate_2dp`
| | |
|---|---|
| **Tests** | Precision gate rejects non-2dp monetary values at ledger level |
| **Method** | Direct ledger append call with non-2dp amount |
| **Pass** | ValueError raised; properly rounded 2dp amounts succeed |

---

## `test_chaos_probe.py`
> Tests validating fixes for vulnerabilities found in chaos integrity probe (AV-series findings)

### `test_paid_order_rejects_new_payment`
| | |
|---|---|
| **Tests** | Once fully paid, an order rejects additional payments (status != 'open') |
| **Method** | Event ledger projection; create order, pay full amount, verify status |
| **Pass** | After payment order.status='paid' and order.is_fully_paid=True |

### `test_double_payment_events_detectable`
| | |
|---|---|
| **Tests** | If two PAYMENT_CONFIRMED events land, projection reflects both |
| **Method** | Event ledger projection; append two payment events, project order |
| **Pass** | order.payments has len=2 (API must prevent this but projection tracks both) |

### `test_negative_tip_reduces_batch_total`
| | |
|---|---|
| **Tests** | Negative tip event would reduce computed tip total (API must reject) |
| **Method** | Event ledger projection; append negative TIP_ADJUSTED event |
| **Pass** | Ledger accepts event; projection behavior documented (API guard is critical) |

### `test_tip_adjust_request_rejects_negative`
| | |
|---|---|
| **Tests** | TipAdjustRequest model allows negative but endpoint must reject |
| **Method** | Direct Pydantic model instantiation |
| **Pass** | Model accepts negative (validation at endpoint level) |

### `test_add_item_request_rejects_zero_quantity`
| | |
|---|---|
| **Tests** | AddItemRequest Pydantic validation rejects quantity=0 |
| **Method** | Direct Pydantic model instantiation with quantity=0 |
| **Pass** | ValidationError raised |

### `test_add_item_request_rejects_negative_quantity`
| | |
|---|---|
| **Tests** | AddItemRequest Pydantic validation rejects negative quantity |
| **Method** | Direct Pydantic model instantiation with quantity=-1 |
| **Pass** | ValidationError raised |

### `test_modify_item_request_rejects_zero_quantity`
| | |
|---|---|
| **Tests** | ModifyItemRequest Pydantic validation rejects quantity=0 |
| **Method** | Direct Pydantic model instantiation with quantity=0 |
| **Pass** | ValidationError raised |

### `test_duplicate_modifier_not_stacked`
| | |
|---|---|
| **Tests** | Applying same modifier twice does not double the price |
| **Method** | Event ledger projection; append MODIFIER_APPLIED twice with same modifier_id |
| **Pass** | Projected item.modifiers has len=1 (deduped by modifier_id) |

### `test_different_modifiers_both_applied`
| | |
|---|---|
| **Tests** | Different modifiers are both applied |
| **Method** | Event ledger projection; append two MODIFIER_APPLIED events with different modifier_ids |
| **Pass** | Projected item.modifiers has len=2 |

### `test_empty_order_has_no_items`
| | |
|---|---|
| **Tests** | Order with no items has items list empty (API endpoint rejects send) |
| **Method** | Event ledger projection; create order without items |
| **Pass** | order.items == [] |

### `test_batch_with_no_orders_produces_no_events`
| | |
|---|---|
| **Tests** | With no closed/paid orders, batch should not emit settlement events |
| **Method** | Event ledger projection; get all orders, filter by status |
| **Pass** | No orders with status in ('closed', 'paid') |

### `test_validate_2dp_rejects_3dp`
| | |
|---|---|
| **Tests** | _validate_2dp raises HTTPException for 3+ decimal places |
| **Method** | Direct function call with 3dp value |
| **Pass** | HTTPException with status 400, detail contains "2 decimal places" |

### `test_validate_2dp_accepts_valid`
| | |
|---|---|
| **Tests** | _validate_2dp passes for 0, 1, or 2 decimal places |
| **Method** | Direct function call with various valid precisions |
| **Pass** | No exception raised |

### `test_hash_chain_integrity_after_operations`
| | |
|---|---|
| **Tests** | After multiple operations, the hash chain remains intact |
| **Method** | Event ledger method call; verify_chain after create/add/pay |
| **Pass** | verify_chain returns (True, None) |

---

## `test_check_state_validity.py`
> Tests for order state validity, projection correctness, and guard logic

### `test_reopened_order_appears_in_open_orders`
| | |
|---|---|
| **Tests** | An order that was closed then reopened appears in get_open_orders |
| **Method** | Event ledger function call; create → close → reopen → get_open_orders |
| **Pass** | order_id in returned open list |

### `test_reopened_then_closed_not_in_open`
| | |
|---|---|
| **Tests** | An order reopened then closed again does NOT appear in get_open_orders |
| **Method** | Event ledger function call; create → close → reopen → close → get_open_orders |
| **Pass** | order_id NOT in returned open list |

### `test_voided_order_not_in_open`
| | |
|---|---|
| **Tests** | A voided order does not appear in get_open_orders |
| **Method** | Event ledger function call; create → void → get_open_orders |
| **Pass** | order_id NOT in returned open list |

### `test_plain_open_order_in_open`
| | |
|---|---|
| **Tests** | A freshly created order appears in get_open_orders |
| **Method** | Event ledger function call; create → get_open_orders |
| **Pass** | order_id in returned open list |

### `test_projection_agrees_with_ledger_open_orders`
| | |
|---|---|
| **Tests** | Projected open orders match get_open_orders results |
| **Method** | Event ledger function and projection call; compare results |
| **Pass** | Ledger and projected open sets equal |

### `test_split_child_order_fetchable_by_correlation`
| | |
|---|---|
| **Tests** | Child order from split-by-seat must be fetchable via get_events_by_correlation |
| **Method** | Event ledger method call after creating ORDER_CREATED with correlation_id set |
| **Pass** | get_events_by_correlation returns events including ORDER_CREATED, projection succeeds |

### `test_split_child_without_correlation_id_fails`
| | |
|---|---|
| **Tests** | Without correlation_id on CREATE, child order can't be fetched individually |
| **Method** | Event ledger method call with ORDER_CREATED missing correlation_id |
| **Pass** | get_events_by_correlation doesn't return CREATE event, projection returns None |

### `test_no_printed_status_in_projections`
| | |
|---|---|
| **Tests** | Projection system never produces 'printed' status (invalid status) |
| **Method** | Event ledger projection call on order with items |
| **Pass** | order.status in ('open', 'paid', 'closed', 'voided'), never 'printed' |

### `test_double_close_does_not_produce_duplicate_events`
| | |
|---|---|
| **Tests** | Closing already-closed order doesn't append another ORDER_CLOSED event |
| **Method** | Event ledger method calls; close twice, count ORDER_CLOSED events |
| **Pass** | Exactly 1 ORDER_CLOSED event in ledger (guard logic prevents second) |

### `test_paid_order_not_in_open_after_close`
| | |
|---|---|
| **Tests** | A paid-then-closed order does not appear in get_open_orders |
| **Method** | Event ledger function and method calls; pay, close, get_open_orders |
| **Pass** | order_id NOT in returned open list after close |

---

## `test_close_day_extended.py`
> Extended close-day tests covering empty-day, auto-void, auto-close, cash reconciliation, and day boundary

### `test_close_day_empty`
| | |
|---|---|
| **Tests** | Closing empty day emits DAY_CLOSED with zeroed totals |
| **Method** | Direct route handler call with no orders |
| **Pass** | Response summary all zeros, DAY_CLOSED event in ledger |

### `test_close_day_auto_voids_unpaid_order`
| | |
|---|---|
| **Tests** | Open unpaid order is auto-voided at close-day |
| **Method** | Direct route handler call after creating unpaid order |
| **Pass** | ORDER_VOIDED event emitted, reason contains "Auto-voided", total_sales=0.00 |

### `test_close_day_auto_closes_paid_open_order`
| | |
|---|---|
| **Tests** | Fully paid but not explicitly closed order is closed at day-end |
| **Method** | Direct route handler call after creating paid order (status='paid', not closed) |
| **Pass** | ORDER_CLOSED event emitted, summary orders_closed_now >= 1 |

### `test_close_day_only_counts_paid_orders_in_sales`
| | |
|---|---|
| **Tests** | Total sales include paid orders and exclude voided ones |
| **Method** | Direct route handler call with one paid and one unpaid order |
| **Pass** | total_sales equals paid order total only, total_orders=2, payment_count=1 |

### `test_close_day_cash_counted_exact_match`
| | |
|---|---|
| **Tests** | actual_cash_counted == cash_expected → over_short is zero |
| **Method** | Direct route handler call with CloseDayRequest matching expected cash |
| **Pass** | summary over_short=0.00 |

### `test_close_day_cash_over`
| | |
|---|---|
| **Tests** | actual_cash_counted > cash_expected → positive over_short |
| **Method** | Direct route handler call with over-counted cash |
| **Pass** | summary over_short equals difference (positive) |

### `test_close_day_cash_short`
| | |
|---|---|
| **Tests** | actual_cash_counted < cash_expected → negative over_short |
| **Method** | Direct route handler call with under-counted cash |
| **Pass** | summary over_short equals difference (negative) |

### `test_close_day_boundary_excludes_next_day_events`
| | |
|---|---|
| **Tests** | Orders created after DAY_CLOSED don't appear in next close summary |
| **Method** | Direct route handler call; close day 1, create order, close day 2 |
| **Pass** | Day 2 summary total_orders=1 (only ord_d2) |

### `test_close_day_emits_batch_submitted_and_day_closed`
| | |
|---|---|
| **Tests** | Closing always emits BATCH_SUBMITTED and DAY_CLOSED atomically |
| **Method** | Direct route handler call; verify event sequence |
| **Pass** | Both events in ledger, BATCH_SUBMITTED.sequence < DAY_CLOSED.sequence |

---

## `test_config_routes.py`
> Tests for config endpoint routes covering push, single-shot updates, role CRUD, and employee creation

### `test_empty_list_writes_nothing`
| | |
|---|---|
| **Tests** | push_changes with empty list writes no events |
| **Method** | Direct route handler call with changes=[] |
| **Pass** | status='ok', events_written=0, event_ids=[] |

### `test_single_store_change_persists`
| | |
|---|---|
| **Tests** | store.* events route correctly and persist to ledger |
| **Method** | Direct route handler call with PendingChange(store.info_updated) |
| **Pass** | events_written=1, ledger contains STORE_INFO_UPDATED with payload |

### `test_mixed_sections_infer_all_section_tags`
| | |
|---|---|
| **Tests** | Batch with mixed store/employee/tipout/menu events infers all sections |
| **Method** | Direct route handler call with 4 PendingChanges across sections |
| **Pass** | events_written=4, ledger contains one event of each type |

### `test_batch_writes_atomically`
| | |
|---|---|
| **Tests** | Multiple changes all land via append_batch — no partial writes |
| **Method** | Direct route handler call with 5 employee events |
| **Pass** | events_written=5, ledger contains all 5 EMPLOYEE_CREATED events |

### `test_unknown_event_type_raises`
| | |
|---|---|
| **Tests** | Unparseable event type raises ValueError |
| **Method** | Direct route handler call with invalid event_type |
| **Pass** | ValueError raised |

### `test_update_store_info_emits_event`
| | |
|---|---|
| **Tests** | update_store_info emits single STORE_INFO_UPDATED event |
| **Method** | Direct route handler call with StoreInfo |
| **Pass** | status='ok', ledger contains STORE_INFO_UPDATED |

### `test_update_cc_rate_persists`
| | |
|---|---|
| **Tests** | update_cc_rate emits STORE_CC_PROCESSING_RATE_UPDATED |
| **Method** | Direct route handler call with CCProcessingRate |
| **Pass** | status='ok', ledger event payload rate_percent matches |

### `test_item_86_and_restore_roundtrip`
| | |
|---|---|
| **Tests** | 86 an item then restore — both events land in order |
| **Method** | Direct route handler calls for 86 and restore |
| **Pass** | Both event types in ledger, items have same item_id |

### `test_create_update_delete_role_cycle`
| | |
|---|---|
| **Tests** | Create, update, and delete role emit corresponding events |
| **Method** | Direct route handler calls for all three operations |
| **Pass** | Three event types in ledger (CREATED, UPDATED, DELETED) with correct payloads |

### `test_create_employee_emits_event_with_full_payload`
| | |
|---|---|
| **Tests** | create_employee emits EMPLOYEE_CREATED with hashed PIN |
| **Method** | Direct route handler call with Employee |
| **Pass** | status='ok', ledger event PIN is hashed (not plaintext), other fields match |

### `test_create_employee_with_pin_also_emits_staff_pin_changed`
| | |
|---|---|
| **Tests** | create_employee with PIN also emits STAFF_PIN_CHANGED |
| **Method** | Direct route handler call with Employee having pin |
| **Pass** | Two event types: EMPLOYEE_CREATED and STAFF_PIN_CHANGED, latter has no PIN material |

### `test_create_employee_without_pin_does_not_emit_staff_pin_changed`
| | |
|---|---|
| **Tests** | create_employee without PIN skips STAFF_PIN_CHANGED |
| **Method** | Direct route handler call with Employee without pin |
| **Pass** | STAFF_PIN_CHANGED events == [] |

### `test_employee_updated_pin_is_hashed`
| | |
|---|---|
| **Tests** | employee.updated via /push hashes PIN before ledger append |
| **Method** | Direct route handler call with push_changes including plaintext PIN |
| **Pass** | Ledger event PIN is hashed, verify_pin_hash confirms correctness |

### `test_already_hashed_pin_is_not_rehashed`
| | |
|---|---|
| **Tests** | ensure_hashed_pin is idempotent with pre-hashed input |
| **Method** | Direct route handler call with already-hashed PIN in payload |
| **Pass** | verify_pin_hash still works on the round-tripped hash |

### `test_employee_updated_without_pin_is_untouched`
| | |
|---|---|
| **Tests** | Partial update without pin field doesn't invent one |
| **Method** | Direct route handler call with employee.updated missing pin |
| **Pass** | Ledger event payload has no 'pin' key, events_written=1 |

### `test_non_employee_events_pass_through_unchanged`
| | |
|---|---|
| **Tests** | Hash hook only touches employee.* events; stray pin in other events unchanged |
| **Method** | Direct route handler call with store.info_updated containing pin field |
| **Pass** | Ledger event pin field == "1234" (plaintext, unchanged) |

---

## `test_config_services.py`
> Tests for StoreConfigService projecting store configuration from event streams

### `test_default_config`
| | |
|---|---|
| **Tests** | Fresh service returns default config with restaurant_name='KINDpos' |
| **Method** | Direct service method call on empty ledger |
| **Pass** | config.info.restaurant_name == 'KINDpos' |

### `test_store_info_updated`
| | |
|---|---|
| **Tests** | STORE_INFO_UPDATED event updates config projection |
| **Method** | Direct service method call after appending event to ledger |
| **Pass** | config.info matches event payload |

### `test_tax_rule_created`
| | |
|---|---|
| **Tests** | STORE_TAX_RULE_CREATED event creates tax rule in projection |
| **Method** | Direct service method call after appending event to ledger |
| **Pass** | config.tax_rules has len=1, name and rate_percent match |

### `test_tax_rule_updated`
| | |
|---|---|
| **Tests** | STORE_TAX_RULE_UPDATED event updates rule in projection |
| **Method** | Direct service method call after create then update events |
| **Pass** | config.tax_rules[0].rate_percent updated to new value |

### `test_tax_rule_deleted`
| | |
|---|---|
| **Tests** | STORE_TAX_RULE_DELETED event removes rule from projection |
| **Method** | Direct service method call after create then delete events |
| **Pass** | config.tax_rules == [] |

### `test_cc_processing_rate`
| | |
|---|---|
| **Tests** | STORE_CC_PROCESSING_RATE_UPDATED event updates cc rate in projection |
| **Method** | Direct service method call after appending event to ledger |
| **Pass** | config.cc_processing.rate_percent matches event payload |

### `test_multiple_store_info_updates`
| | |
|---|---|
| **Tests** | Multiple STORE_INFO_UPDATED events merge; last wins, others persist |
| **Method** | Direct service method call after appending two info events |
| **Pass** | restaurant_name from second event (last wins), phone from first (persists) |

---

## `test_daily_workflow.py`
> Full daily workflow integration test covering clock in/out, orders, payments, tips, batch, and close-day

### `test_full_daily_workflow`
| | |
|---|---|
| **Tests** | Complete day of service: clock in → create/pay/tip orders → batch → clock out → close day |
| **Method** | Event ledger method calls in sequence; project orders and verify event trail |
| **Pass** | Both orders status='closed', all event types present, tips recorded, DAY_CLOSED event exists, new-day is clean |

---

## `test_daily_workflow_extended.py`
> Extended daily workflow tests for edge cases: split payment, partial payment, double-close, void-after-payment, reopen, item removal

### `test_split_payment_two_halves_clears_balance`
| | |
|---|---|
| **Tests** | Two cash payments each covering half the total → fully paid |
| **Method** | Event ledger projection; create order, add item, append two payments |
| **Pass** | order.is_fully_paid=True, balance_due=0.00, status in ('paid','closed') |

### `test_split_payment_each_payment_tracked_separately`
| | |
|---|---|
| **Tests** | Each payment in a split is visible in order.payments list |
| **Method** | Event ledger projection; create order, append two payment events |
| **Pass** | Both payment_ids in order.payments with status='confirmed' |

### `test_partial_payment_leaves_correct_balance_due`
| | |
|---|---|
| **Tests** | Paying 50% leaves balance_due equal to other 50% |
| **Method** | Event ledger projection; create order, append 50% payment |
| **Pass** | balance_due == (total - partial_amount), is_fully_paid=False |

### `test_partial_payment_status_stays_open`
| | |
|---|---|
| **Tests** | Order with only partial payment stays 'open', not 'paid' |
| **Method** | Event ledger projection; create order, append 30% payment |
| **Pass** | order.status == 'open' |

### `test_double_order_closed_stays_closed`
| | |
|---|---|
| **Tests** | Appending ORDER_CLOSED twice is idempotent — status remains 'closed' |
| **Method** | Event ledger projection; append ORDER_CLOSED twice |
| **Pass** | order.status == 'closed' |

### `test_order_voided_after_payment_status_is_voided`
| | |
|---|---|
| **Tests** | ORDER_VOIDED event overrides 'paid' status → 'voided' |
| **Method** | Event ledger projection; create, pay, void |
| **Pass** | order.status == 'voided' |

### `test_order_voided_unpaid_status_is_voided`
| | |
|---|---|
| **Tests** | Voiding unpaid open order → status becomes 'voided' |
| **Method** | Event ledger projection; create, void |
| **Pass** | order.status == 'voided' |

### `test_reopen_paid_order_reverts_to_open`
| | |
|---|---|
| **Tests** | ORDER_REOPENED on paid (not yet closed) order puts it back to 'open' |
| **Method** | Event ledger projection; create, pay (status='paid'), reopen |
| **Pass** | order.status == 'open' |

### `test_reopen_closed_order_reverts_to_open`
| | |
|---|---|
| **Tests** | ORDER_REOPENED on closed order → 'open' |
| **Method** | Event ledger projection; create, pay, close, reopen |
| **Pass** | order.status == 'open' |

### `test_item_removed_reduces_subtotal`
| | |
|---|---|
| **Tests** | After ITEM_REMOVED, order subtotal drops by removed item's price |
| **Method** | Event ledger projection; create, add 2 items, remove 1 |
| **Pass** | subtotal == (remaining item price), items len=1 |

### `test_item_removed_adjusts_total_with_tax`
| | |
|---|---|
| **Tests** | Total after item removal reflects correct subtotal + tax |
| **Method** | Event ledger projection; create, add 2 items, remove 1 |
| **Pass** | total == (remaining subtotal * (1 + TAX_RATE)), rounded |

### `test_multiple_orders_do_not_cross_contaminate`
| | |
|---|---|
| **Tests** | Events from order A do not appear in order B's projection |
| **Method** | Event ledger projection call on all events for both orders |
| **Pass** | Each order subtotal matches its own items, item_ids don't cross |

### `test_project_orders_returns_all_open_orders`
| | |
|---|---|
| **Tests** | project_orders called on full event stream returns all orders |
| **Method** | Event ledger method call project_orders(all_events) |
| **Pass** | Returned dict has 3 orders |

### `test_project_orders_closed_order_included_in_dict`
| | |
|---|---|
| **Tests** | project_orders includes closed orders — callers filter by status |
| **Method** | Event ledger method call project_orders on closed order |
| **Pass** | Closed order in returned dict with status='closed' |

### `test_order_with_no_items_has_zero_subtotal`
| | |
|---|---|
| **Tests** | Order with no items has zero subtotal and is fully paid |
| **Method** | Event ledger projection; create order without items |
| **Pass** | subtotal=0.00, total=0.00, is_fully_paid=True |

---

## `test_day_cash_routes.py`
> Tests for cash-control endpoints recording float updates, drops, and payouts with audit fields

### `test_update_cash_float_emits_event_and_tracks_previous`
| | |
|---|---|
| **Tests** | update_cash_float emits DAY_CASH_FLOAT_UPDATED and tracks previous value |
| **Method** | Direct route handler call twice sequentially |
| **Pass** | First call previous_float=0.00, second previous_float equals first amount, events in ledger |

### `test_record_cash_drop_emits_event_with_audit_fields`
| | |
|---|---|
| **Tests** | record_cash_drop emits event with approved_by and deposit_ref |
| **Method** | Direct route handler call with CashDropRequest |
| **Pass** | Ledger event payload contains all audit fields |

### `test_record_cash_payout_requires_recipient`
| | |
|---|---|
| **Tests** | Pydantic Field(min_length=1) rejects empty recipient |
| **Method** | Direct Pydantic model instantiation with recipient="" |
| **Pass** | ValidationError raised |

### `test_record_cash_payout_emits_event`
| | |
|---|---|
| **Tests** | record_cash_payout emits DAY_CASH_PAYOUT event |
| **Method** | Direct route handler call with CashPayoutRequest |
| **Pass** | Ledger event in payload with amount, recipient, category |

### `test_multiple_float_resets_last_value_wins`
| | |
|---|---|
| **Tests** | Float is assignment not accumulation; final value counts |
| **Method** | Direct route handler calls; three updates then _compute_cash_variance |
| **Pass** | expected_in_drawer equals last float (200), not sum |

### `test_multiple_drops_accumulate`
| | |
|---|---|
| **Tests** | Each drop is subtracted; they are cumulative unlike float |
| **Method** | Direct route handler calls; set float, two drops, compute variance |
| **Pass** | drops='175.00', expected_in_drawer = float - sum(drops) |

### `test_payout_category_is_optional`
| | |
|---|---|
| **Tests** | Payout category field is not required |
| **Method** | Direct route handler call without category field |
| **Pass** | success=True, ledger event payload.category is None |

### `test_cash_sales_accumulate_card_excluded`
| | |
|---|---|
| **Tests** | Multiple cash payments stack; card payments invisible to variance |
| **Method** | Direct route handler call via push_changes with mixed payment methods |
| **Pass** | cash_sales = sum of cash only, expected_in_drawer reflects cash only |

### `test_refund_reduces_expected`
| | |
|---|---|
| **Tests** | A cash refund reduces expected drawer total |
| **Method** | Direct route handler call via push_changes with payment then refund |
| **Pass** | cash_refunds='15.00', expected_in_drawer = sales - refunds |

### `test_empty_recipient_rejected_at_model_level`
| | |
|---|---|
| **Tests** | Pydantic validation rejects blank recipient before handler runs |
| **Method** | Direct Pydantic model instantiation with recipient="" |
| **Pass** | ValidationError or ValueError raised |

---

## `test_day_close_lock.py`
> Concurrency tests for _day_close_lock ensuring create_order blocks while day-close is snapshotting

### `test_create_order_blocks_while_close_lock_held`
| | |
|---|---|
| **Tests** | create_order returns 409 (day-close-in-progress) when _day_close_lock is held |
| **Method** | Direct route handler call with lock manually acquired |
| **Pass** | HTTPException status 409, detail contains "day close" |

### `test_create_order_proceeds_when_lock_free`
| | |
|---|---|
| **Tests** | With lock untouched, create_order succeeds |
| **Method** | Direct route handler call with lock free |
| **Pass** | Returns response with valid order_id and status='open' |

### `test_create_order_unblocks_after_lock_release`
| | |
|---|---|
| **Tests** | Lock blocks briefly in one task, second task blocks then succeeds after release |
| **Method** | asyncio concurrency; hold lock in task A, fire create_order from task B |
| **Pass** | Task B gets 409 while lock held, succeeds with new order after lock releases |

---

## `test_dejavoo_spin.py`
> Tests for DejavooSPInAdapter XML building and response parsing

### `test_build_xml_sale`
| | |
|---|---|
| **Tests** | _build_xml('Sale', {...}) produces valid DVSPIn XML with TransType and auth fields |
| **Method** | Direct adapter method call with Sale params |
| **Pass** | XML parses, has TransType, PaymentType, Tip, auth fields; no old 'function' element |

### `test_build_xml_no_params`
| | |
|---|---|
| **Tests** | _build_xml('GetStatus') produces valid XML with TransType and no Amount |
| **Method** | Direct adapter method call without params |
| **Pass** | XML parses, TransType='GetStatus', Amount=None |

### `test_parse_response_approved`
| | |
|---|---|
| **Tests** | _parse_response with approved root returns APPROVED TransactionResult |
| **Method** | Direct adapter method call with ET.Element response root |
| **Pass** | status=APPROVED, auth_code/token/card_brand/last_four/transaction_id match |

### `test_parse_response_declined`
| | |
|---|---|
| **Tests** | _parse_response with declined root returns DECLINED |
| **Method** | Direct adapter method call with declined response |
| **Pass** | status=DECLINED |

### `test_parse_response_none`
| | |
|---|---|
| **Tests** | _parse_response(None, ...) returns ERROR with CONN_FAIL |
| **Method** | Direct adapter method call with None root |
| **Pass** | status=ERROR, error_code='CONN_FAIL' |

### `test_initial_status_offline`
| | |
|---|---|
| **Tests** | Freshly created adapter starts with OFFLINE status |
| **Method** | Direct adapter instantiation |
| **Pass** | adapter.status == OFFLINE |

### `test_connect_sets_status`
| | |
|---|---|
| **Tests** | connect() with mocked _send sets status based on response |
| **Method** | Direct adapter method call with mocked _send |
| **Pass** | Returns True, status=IDLE, config set |

### `test_connect_offline_when_unreachable`
| | |
|---|---|
| **Tests** | connect() returns False and sets OFFLINE when device unreachable |
| **Method** | Direct adapter method call with _send returning None |
| **Pass** | Returns False, status=OFFLINE |

---

## `test_dejavoo_spin_extended.py`
> Extended DejavooSPInAdapter tests covering close_batch, check_status, adjust_tip, network errors, and ExtData extraction

### `test_close_batch_approved`
| | |
|---|---|
| **Tests** | close_batch with approved response returns SUCCESS with batch details |
| **Method** | Direct adapter method call with mocked _send returning approved XML |
| **Pass** | status=SUCCESS, batch_id, transaction_count, total_amount match |

### `test_close_batch_failed_response`
| | |
|---|---|
| **Tests** | close_batch with declined response returns FAILED |
| **Method** | Direct adapter method call with mocked declined response |
| **Pass** | status=FAILED |

### `test_close_batch_send_returns_none`
| | |
|---|---|
| **Tests** | close_batch handles _send returning None |
| **Method** | Direct adapter method call with mocked _send returning None |
| **Pass** | status=FAILED, error_code='BATCH_ERR' |

### `test_close_batch_non_numeric_count`
| | |
|---|---|
| **Tests** | Non-numeric BatchCount falls back to 0, doesn't raise |
| **Method** | Direct adapter method call with malformed BatchCount |
| **Pass** | transaction_count=0, amount parses correctly |

### `test_close_batch_non_decimal_amount`
| | |
|---|---|
| **Tests** | Non-decimal BatchAmount falls back to 0.00, doesn't raise |
| **Method** | Direct adapter method call with malformed BatchAmount |
| **Pass** | transaction_count parses, total_amount=Decimal('0.00') |

### `test_close_batch_send_raises`
| | |
|---|---|
| **Tests** | Exception from _send returns BATCH_ERR result, not unhandled raise |
| **Method** | Direct adapter method call with _send raising |
| **Pass** | status=FAILED, error_code='BATCH_ERR' |

### `test_check_status_approved_sets_idle`
| | |
|---|---|
| **Tests** | check_status with Approved response sets IDLE |
| **Method** | Direct adapter method call with mocked _send |
| **Pass** | Returns IDLE |

### `test_check_status_busy_sets_processing`
| | |
|---|---|
| **Tests** | check_status with Busy response sets PROCESSING |
| **Method** | Direct adapter method call with Busy response |
| **Pass** | Returns PROCESSING |

### `test_check_status_other_response_sets_online`
| | |
|---|---|
| **Tests** | check_status with other response sets ONLINE |
| **Method** | Direct adapter method call with generic response |
| **Pass** | Returns ONLINE |

### `test_check_status_none_sets_offline`
| | |
|---|---|
| **Tests** | check_status with None returns OFFLINE |
| **Method** | Direct adapter method call with _send returning None |
| **Pass** | Returns OFFLINE |

### `test_check_status_sacred_state_skips_send`
| | |
|---|---|
| **Tests** | In AWAITING_CARD state, check_status returns immediately without calling _send |
| **Method** | Direct adapter method call with status=AWAITING_CARD |
| **Pass** | Returns AWAITING_CARD, _send not called |

### `test_adjust_tip_exception_returns_tip_adj_err`
| | |
|---|---|
| **Tests** | adjust_tip exception returns ERROR with TIP_ADJ_ERR |
| **Method** | Direct adapter method call with _send raising |
| **Pass** | status=ERROR, error_code='TIP_ADJ_ERR' |

### `test_send_timeout_returns_none`
| | |
|---|---|
| **Tests** | TimeoutException from _send returns None and emits DEV-002 |
| **Method** | Direct adapter method call with httpx.TimeoutException |
| **Pass** | Returns None, DEV-002 in diag_calls |

### `test_send_connect_error_returns_none`
| | |
|---|---|
| **Tests** | ConnectError from _send returns None and emits DEV-003 |
| **Method** | Direct adapter method call with httpx.ConnectError |
| **Pass** | Returns None, DEV-003 in diag_calls |

### `test_parse_response_ext_data_card_fields`
| | |
|---|---|
| **Tests** | _parse_response extracts card_brand and last_four from ExtData when main fields absent |
| **Method** | Direct adapter method call with response containing ExtData |
| **Pass** | card_brand and last_four match ExtData values |

---

## `test_dejavoo_spin_lockdown.py`
> Lockdown tests for DejavooSPInAdapter state machine, concurrency discipline, and XML safety

### `test_concurrent_sales_serialize`
| | |
|---|---|
| **Tests** | Concurrent initiate_sale calls serialize on _tx_lock |
| **Method** | asyncio.gather two initiate_sale calls with mocked slow _send |
| **Pass** | Execution order shows first call completes before second starts (no interleaving) |

### `test_initiate_sale_rejects_when_awaiting_card`
| | |
|---|---|
| **Tests** | initiate_sale in AWAITING_CARD state returns DEVICE_BUSY |
| **Method** | Direct adapter method call with status=AWAITING_CARD |
| **Pass** | status=ERROR, error_code='DEVICE_BUSY' |

### `test_initiate_refund_rejects_when_processing`
| | |
|---|---|
| **Tests** | initiate_refund in PROCESSING state returns DEVICE_BUSY |
| **Method** | Direct adapter method call with status=PROCESSING |
| **Pass** | status=ERROR, error_code='DEVICE_BUSY' |

### `test_initiate_void_rejects_when_awaiting`
| | |
|---|---|
| **Tests** | initiate_void in AWAITING_CARD state returns DEVICE_BUSY |
| **Method** | Direct adapter method call with status=AWAITING_CARD |
| **Pass** | status=ERROR, error_code='DEVICE_BUSY' |

### `test_cancel_runs_while_sale_in_flight`
| | |
|---|---|
| **Tests** | cancel_transaction runs without blocking on _tx_lock while sale in flight |
| **Method** | asyncio concurrency; initiate_sale holds lock, cancel fires in parallel |
| **Pass** | cancel_fired.is_set() before sale completes, cancel timeout doesn't fire |

### `test_send_exception_preserves_awaiting_card_state`
| | |
|---|---|
| **Tests** | Mid-transaction exception preserves status (not reset to IDLE) |
| **Method** | Direct adapter method call with _send raising |
| **Pass** | status == AWAITING_CARD after exception |

### `test_ampersand_is_escaped`
| | |
|---|---|
| **Tests** | RefId containing & is XML-escaped |
| **Method** | Direct adapter method call _build_xml with RefId='a&b' |
| **Pass** | XML parses without error, RefId element text='a&b' |

### `test_angle_brackets_escaped`
| | |
|---|---|
| **Tests** | RefId containing angle brackets is XML-escaped |
| **Method** | Direct adapter method call with RefId='<script>' |
| **Pass** | XML parses, RefId element text='<script>' |

### `test_escape_survives_auth_fields`
| | |
|---|---|
| **Tests** | XML escaping applied to auth fields (RegisterId, TPN, AuthKey) |
| **Method** | Direct adapter method call with escaped chars in auth config |
| **Pass** | XML parses, auth fields contain correct unescaped text |

---

## `test_demo_seeder.py`
> Tests for demo data seeder verifying idempotency and data creation

### `test_seeds_on_empty_db`
| | |
|---|---|
| **Tests** | Seeder creates EMPLOYEE_CREATED events on empty ledger |
| **Method** | Direct seeder function call on fresh ledger |
| **Pass** | EMPLOYEE_CREATED events > 0 |

### `test_idempotent`
| | |
|---|---|
| **Tests** | Calling seeder twice produces same event count (idempotent) |
| **Method** | Direct seeder function call twice on same ledger |
| **Pass** | Event count same after second call, both calls > 0 |

### `test_seeds_restaurant_config`
| | |
|---|---|
| **Tests** | Seeder creates STORE_INFO_UPDATED event |
| **Method** | Direct seeder function call on fresh ledger |
| **Pass** | STORE_INFO_UPDATED events == 1 |

---

## `test_discount_endpoint.py`
> Endpoint tests for POST /orders/{order_id}/discount covering precision gates, guards, and accumulation

### `test_happy_path_emits_event_and_reduces_balance`
| | |
|---|---|
| **Tests** | Discount endpoint emits DISCOUNT_APPROVED and reduces order total |
| **Method** | Direct route handler call with ApplyDiscountRequest |
| **Pass** | discount_total matches request, total reduced by discount + tax, event in ledger |

### `test_precision_gate_rejects_3dp_amount`
| | |
|---|---|
| **Tests** | Precision gate rejects 3+ decimal place amounts |
| **Method** | Direct route handler call with 3dp discount |
| **Pass** | HTTPException status 400, detail contains "2 decimal" |

### `test_rejects_when_payment_pending`
| | |
|---|---|
| **Tests** | Discount blocked when order has pending payment |
| **Method** | Direct route handler call after appending PAYMENT_INITIATED |
| **Pass** | HTTPException status 400, detail contains "pending" |

### `test_rejects_on_closed_order`
| | |
|---|---|
| **Tests** | Cannot apply discount to closed order |
| **Method** | Direct route handler call after appending ORDER_CLOSED |
| **Pass** | HTTPException status 400 |

### `test_multiple_discounts_accumulate`
| | |
|---|---|
| **Tests** | Two separate discounts sum (current behavior; no single-discount cap) |
| **Method** | Direct route handler call twice sequentially |
| **Pass** | Second call discount_total = sum of both, total adjusted accordingly |

---

## `test_entomology_correlation.py`
> Reverse correlation tests for diagnostic event linking (RC-01 through RC-05)

### `test_rc01_reverse_correlate_links`
| | |
|---|---|
| **Tests** | reverse_correlate links matching events by device identifier |
| **Method** | Direct collector method call; record event with device_ip in context, reverse correlate |
| **Pass** | reverse_correlate returns 1, event found via get_events with new correlation_id |

### `test_rc02_skip_already_correlated`
| | |
|---|---|
| **Tests** | reverse_correlate skips already-correlated events |
| **Method** | Direct collector method call on pre-correlated event |
| **Pass** | reverse_correlate returns 0 |

### `test_rc03_time_window`
| | |
|---|---|
| **Tests** | reverse_correlate respects time window; old events excluded |
| **Method** | Direct collector method call with backdated event; default 5 minute window |
| **Pass** | reverse_correlate returns 0 for 10-minute-old event |

### `test_rc04_custom_window`
| | |
|---|---|
| **Tests** | reverse_correlate accepts custom minutes_back parameter |
| **Method** | Direct collector method call with 3-minute-old event and variable windows |
| **Pass** | 2-minute window misses event, 5-minute window finds it |

### `test_rc05_update_correlation_id`
| | |
|---|---|
| **Tests** | update_correlation_id links specific event by diagnostic_id |
| **Method** | Direct collector method call; record uncorrelated event, update_correlation_id |
| **Pass** | success=True, event found via get_events with new correlation_id; second update returns False |
Now I'll generate the formatted markdown documentation:

## `conftest.py`
> Shared test fixtures providing EventLedger, PrinterManager, and DiagnosticCollector for all tests

This file is a fixture configuration file without test functions. It provides:
- `ledger` fixture: Fresh EventLedger with temporary SQLite database
- `manager` fixture: PrinterManager with 4 mock printers (thermal receipt/bar, impact kitchen)
- `collector` fixture: DiagnosticCollector with temporary database

---
## `test_entomology_collector.py`
> Tests for DiagnosticCollector: recording, hash chaining, queries, adaptive heartbeat, and singleton behavior.

### `test_c01_record_returns_event`
| | |
|---|---|
| **Tests** | record() returns a DiagnosticEvent with correct category, severity, and event_code |
| **Method** | Direct async call to collector.record() with test parameters; validates returned object type and attributes |
| **Pass** | Returned event is DiagnosticEvent instance; category, severity, event_code match input |

### `test_c02_record_auto_id`
| | |
|---|---|
| **Tests** | record() auto-generates diagnostic_id (UUID format) |
| **Method** | Record event; validate diagnostic_id length equals 36 (UUID format) |
| **Pass** | diagnostic_id has length 36 |

### `test_c03_record_auto_timestamp`
| | |
|---|---|
| **Tests** | record() auto-generates timestamp within current time bounds |
| **Method** | Capture before/after UTC timestamps; record event; verify timestamp falls within range |
| **Pass** | Event timestamp >= before timestamp AND <= after timestamp |

### `test_c04_first_event_genesis_hash`
| | |
|---|---|
| **Tests** | First event uses GENESIS_HASH as prev_hash |
| **Method** | Record first event to empty collector; check prev_hash |
| **Pass** | event.prev_hash == GENESIS_HASH |

### `test_c05_hash_chain`
| | |
|---|---|
| **Tests** | Hash chain links consecutive events (e2.prev_hash == e1.hash) |
| **Method** | Record two events sequentially; verify second event's prev_hash equals first event's hash |
| **Pass** | e2.prev_hash == e1.hash |

### `test_c06_hash_chain_verifiable`
| | |
|---|---|
| **Tests** | Hash chain integrity over 5 events: each event links to previous |
| **Method** | Record 5 events; verify chain from genesis through all events |
| **Pass** | events[0].prev_hash == GENESIS_HASH; events[i].prev_hash == events[i-1].hash for all i |

### `test_c07_hash_computation`
| | |
|---|---|
| **Tests** | Hash is computed correctly using diagnostic_hash() function |
| **Method** | Record event; recompute hash using same inputs; compare |
| **Pass** | event.hash == expected hash from compute_diagnostic_hash() |

### `test_c08_record_persists`
| | |
|---|---|
| **Tests** | record() persists events to SQLite DB |
| **Method** | Record event; call count_events(); verify count increased |
| **Pass** | count_events() returns 1 |

### `test_c09_record_with_correlation`
| | |
|---|---|
| **Tests** | record() accepts and stores correlation_id |
| **Method** | Record event with correlation_id parameter; check event.correlation_id |
| **Pass** | event.correlation_id == provided correlation_id |

### `test_c10_record_no_correlation`
| | |
|---|---|
| **Tests** | record() without correlation_id sets it to None |
| **Method** | Record event without correlation_id; check field is None |
| **Pass** | event.correlation_id is None |

### `test_c11_terminal_id`
| | |
|---|---|
| **Tests** | record() stores terminal_id from collector configuration |
| **Method** | Record event; check event.terminal_id matches fixture config |
| **Pass** | event.terminal_id == "terminal-test-01" |

### `test_c12_multiple_records`
| | |
|---|---|
| **Tests** | Multiple records increment event count correctly |
| **Method** | Record 10 events in loop; call count_events() |
| **Pass** | count_events() returns 10 |

### `test_c13_get_events_all`
| | |
|---|---|
| **Tests** | get_events() returns all events when no filters applied |
| **Method** | Record 3 events; call get_events(); check returned list length |
| **Pass** | len(events) == 3 |

### `test_c14_get_events_by_category`
| | |
|---|---|
| **Tests** | get_events(category=X) filters to specified category |
| **Method** | Record DEVICE and NETWORK events; query by DEVICE category; verify only DEVICE returned |
| **Pass** | len(events) == 1; all events have category == DEVICE |

### `test_c15_get_events_by_severity`
| | |
|---|---|
| **Tests** | get_events(severity=X) filters to specified severity |
| **Method** | Record ERROR and INFO events; query by ERROR severity; verify only ERROR returned |
| **Pass** | len(events) == 1; event.severity == ERROR |

### `test_c16_get_events_by_event_code`
| | |
|---|---|
| **Tests** | get_events(event_code=X) filters to specified event code |
| **Method** | Record DEV-001 and DEV-002; query by DEV-001; verify only DEV-001 returned |
| **Pass** | len(events) == 1; event.event_code == "DEV-001" |

### `test_c17_get_events_by_time_range`
| | |
|---|---|
| **Tests** | get_events(since=, until=) filters by timestamp bounds |
| **Method** | Record event now; query with since past and until future; then query with future since |
| **Pass** | First query returns 1 event; second query (future since) returns 0 events |

### `test_c18_get_events_by_correlation`
| | |
|---|---|
| **Tests** | get_events(correlation_id=X) filters by correlation ID |
| **Method** | Record correlated and uncorrelated events; query by correlation_id |
| **Pass** | len(events) == 1; event.correlation_id matches filter |

### `test_c19_get_events_limit`
| | |
|---|---|
| **Tests** | get_events(limit=N) limits result count to N |
| **Method** | Record 10 events; query with limit=3 |
| **Pass** | len(events) == 3 |

### `test_c20_get_events_by_severity_min`
| | |
|---|---|
| **Tests** | get_events_by_severity_min(ERROR) returns ERROR and CRITICAL events |
| **Method** | Record all 4 severity levels; query with min=ERROR |
| **Pass** | len(events) == 2 (ERROR + CRITICAL); all events have severity >= ERROR |

### `test_c21_severity_min_with_time`
| | |
|---|---|
| **Tests** | get_events_by_severity_min() respects since/until time filters |
| **Method** | Record CRITICAL event; query with min=CRITICAL and time bounds |
| **Pass** | len(events) == 1; event within time range |

### `test_c22_get_all_events_ordered`
| | |
|---|---|
| **Tests** | get_all_events_ordered() returns events in chronological order |
| **Method** | Record 5 events; get_all_events_ordered(); verify timestamps are non-decreasing |
| **Pass** | len(events) == 5; events[i].timestamp <= events[i+1].timestamp for all i |

### `test_c23_count_events_empty`
| | |
|---|---|
| **Tests** | count_events() returns 0 for empty collector |
| **Method** | Call count_events() on fresh collector with no records |
| **Pass** | count == 0 |

### `test_c24_active_heartbeat_interval`
| | |
|---|---|
| **Tests** | ACTIVE_HEARTBEAT_INTERVAL_S constant equals 60 |
| **Method** | Check constant value |
| **Pass** | ACTIVE_HEARTBEAT_INTERVAL_S == 60 |

### `test_c25_off_hours_heartbeat_interval`
| | |
|---|---|
| **Tests** | OFF_HOURS_HEARTBEAT_INTERVAL_S constant equals 900 |
| **Method** | Check constant value |
| **Pass** | OFF_HOURS_HEARTBEAT_INTERVAL_S == 900 |

### `test_c26_cooldown_minutes`
| | |
|---|---|
| **Tests** | COOLDOWN_MINUTES constant equals 30 |
| **Method** | Check constant value |
| **Pass** | COOLDOWN_MINUTES == 30 |

### `test_c27_notify_order_activates`
| | |
|---|---|
| **Tests** | notify_order_created() sets _service_active flag to True |
| **Method** | Check initial state False; call notify_order_created(); check state becomes True |
| **Pass** | _service_active transitions from False to True |

### `test_c28_notify_cancels_cooldown`
| | |
|---|---|
| **Tests** | notify_order_created() cancels previous cooldown task and creates new one |
| **Method** | Call notify_order_created() twice; verify first task is cancelled/done and second task differs |
| **Pass** | first_task.cancelled() or first_task.done(); second_task is not first_task |

### `test_c29_heartbeat_loop_returns_task`
| | |
|---|---|
| **Tests** | start_heartbeat_loop() returns active asyncio.Task |
| **Method** | Call start_heartbeat_loop(); check return type and state |
| **Pass** | returns asyncio.Task; task.done() is False |

### `test_c30_close_cancels_heartbeat`
| | |
|---|---|
| **Tests** | close() cancels heartbeat task |
| **Method** | Start heartbeat task; call close(); verify task is done |
| **Pass** | task.done() is True |

### `test_c31_context_manager`
| | |
|---|---|
| **Tests** | DiagnosticCollector context manager opens/closes cleanly |
| **Method** | Use async with DiagnosticCollector(...) as coll; record event; verify db closes after exit |
| **Pass** | Event recorded inside context; coll._db is None after exit |

---

## `test_entomology_excel_report.py`
> Unit tests for Excel bug-report generator (build_bug_report_workbook) — pure, no DB.

### `test_all_expected_sheets_present`
| | |
|---|---|
| **Tests** | Workbook contains all 10 expected sheet names |
| **Method** | Build workbook with empty events; check sheetnames list |
| **Pass** | wb.sheetnames == expected list (Summary, Current Snapshot, DEVICE/NETWORK/SYSTEM/PERIPHERAL/RECOVERY/SEC/FIN/UI Issues) |

### `test_empty_categories_still_render_headers_and_placeholder`
| | |
|---|---|
| **Tests** | Empty event categories still render headers and placeholder text |
| **Method** | Build workbook with no events; reload with openpyxl; check row 1 headers and row 2 placeholders in category sheets |
| **Pass** | Row 1 column 1 contains "timestamp (UTC)"; row 2 contains placeholder starting with "No " |

### `test_device_sheet_contains_event_rows_grouped_by_code`
| | |
|---|---|
| **Tests** | DEVICE Issues sheet groups events by event_code with count; includes all messages |
| **Method** | Create events DEV-001 (2x), DEV-002 (1x), NET-007; build workbook; check DEVICE sheet |
| **Pass** | Sheet contains "DEV-001 (2)" and "DEV-002 (1)" divider rows; column E contains all message text; NET-007 not present |

### `test_summary_counts_matrix`
| | |
|---|---|
| **Tests** | Summary sheet shows correct total issue count |
| **Method** | Create 3 mixed-category events; find "Total issues" row in Summary sheet |
| **Pass** | Total issues row shows "3" |

### `test_snapshot_sheet_has_probes_and_metrics`
| | |
|---|---|
| **Tests** | Current Snapshot sheet renders probe status and system metrics |
| **Method** | Build workbook with snapshot data; check Probes header, database row, and System metrics header |
| **Pass** | Cell contains "Probes"; "database" probe and "PASS" status visible; "System metrics" header found |

---

## `test_entomology_integration.py`
> End-to-end tests: record → query → report, high volume, hash chain integrity, full day simulation.

### `test_i01_end_to_end`
| | |
|---|---|
| **Tests** | End-to-end workflow: record event → query by code → generate HTML report |
| **Method** | Record DEV-001 event; query for DEV-001; generate report; verify all components |
| **Pass** | Query returns 1 matching event; report HTML contains DEV-001 and message text; filename ends with .html |

### `test_i02_mixed_categories`
| | |
|---|---|
| **Tests** | Multiple event categories (DEVICE, NETWORK, SYSTEM, PERIPHERAL, RECOVERY) recorded and reported |
| **Method** | Record events from all 5 categories; verify count; generate report; check all codes appear |
| **Pass** | count_events() == 5; report HTML contains all event codes |

### `test_i03_high_volume`
| | |
|---|---|
| **Tests** | System handles 500 events without error |
| **Method** | Record 500 events in loop; count events; get all events ordered |
| **Pass** | count_events() == 500; get_all_events_ordered() returns 500 events |

### `test_i04_hash_chain_integrity`
| | |
|---|---|
| **Tests** | Hash chain remains valid over 100 events with correct links and hashes |
| **Method** | Record 100 events; verify genesis; verify each event's prev_hash links to previous; recompute hashes |
| **Pass** | events[0].prev_hash == GENESIS_HASH; all chain links correct; all computed hashes match stored |

### `test_i05_correlation_chain`
| | |
|---|---|
| **Tests** | Correlation chain (DEV error → NET retry → REC success) records and reports correctly |
| **Method** | Record 3 correlated events across categories; query by correlation_id; generate report |
| **Pass** | get_events(correlation_id) returns 3 events; report HTML contains "Resolved" |

### `test_i06_full_day_simulation`
| | |
|---|---|
| **Tests** | Realistic day of events (off-hours heartbeats, device errors, peripherals, retries) |
| **Method** | Record 4 off-hours heartbeats, device error/recovery, printer failure/failover, active heartbeats; generate report |
| **Pass** | count_events() == 18; report HTML valid; contains DEV-001, PER-001, REC-004 |

### `test_i07_report_after_retention`
| | |
|---|---|
| **Tests** | Retention cycle (archive old events) followed by report on recent events |
| **Method** | Create old and recent events; run retention; verify count reduced; generate report |
| **Pass** | Old events archived; count_events() == 3 (recent); report shows DEV-001 |

### `test_i08_concurrent_recording`
| | |
|---|---|
| **Tests** | Concurrent asyncio.gather() recording doesn't corrupt hash chain |
| **Method** | Spawn 3 concurrent record_batch coroutines (20 events each); verify count and chain integrity |
| **Pass** | count_events() == 60; hash chain valid; events[0].prev_hash == GENESIS_HASH; all links correct |

---

## `test_entomology_ledger_gaps.py`
> Tests for GET /entomology/ledger-gaps and LEDGER_GAP_NODES dataset.

### `test_node_count_matches_audit`
| | |
|---|---|
| **Tests** | LEDGER_GAP_NODES dataset contains exactly 118 nodes |
| **Method** | Check length of constant list |
| **Pass** | len(LEDGER_GAP_NODES) == 118 |

### `test_node_ids_unique`
| | |
|---|---|
| **Tests** | All node IDs (LG-##) are unique |
| **Method** | Extract IDs; check set size equals list size |
| **Pass** | len(ids) == len(set(ids)) |

### `test_node_ids_follow_lg_pattern`
| | |
|---|---|
| **Tests** | All node IDs match LG-### pattern (LG- prefix, digits) |
| **Method** | Validate each node id with regex/string checks |
| **Pass** | All IDs start with "LG-"; suffix is numeric |

### `test_status_and_severity_values_valid`
| | |
|---|---|
| **Tests** | All nodes have status in {IMPLEMENTED, RENAMED, PARTIAL, FACTORY-ONLY, MISSING} and severity in {CRITICAL, HIGH, MEDIUM, LOW} |
| **Method** | Check each node's status and severity against valid sets |
| **Pass** | All status values in VALID_STATUSES; all severity values in VALID_SEVERITIES |

### `test_every_aggregate_known`
| | |
|---|---|
| **Tests** | All nodes' aggregate field references known aggregate from AGGREGATE_ORDER |
| **Method** | Check each node's aggregate is in AGGREGATE_ORDER |
| **Pass** | All aggregates are known |

### `test_related_ids_all_resolve`
| | |
|---|---|
| **Tests** | All related_ids in nodes reference existing node IDs |
| **Method** | Build set of all IDs; validate each related_id exists in set |
| **Pass** | All related_ids resolve to existing nodes |

### `test_aggregate_summary_shape`
| | |
|---|---|
| **Tests** | aggregate_summary() returns correct structure with totals and distributions |
| **Method** | Call aggregate_summary(); validate keys and totals |
| **Pass** | "total" == 118; by_status/by_severity keys are subsets of valid values; sums match 118 |

### `test_ledger_gaps_endpoint_returns_full_dataset`
| | |
|---|---|
| **Tests** | GET /api/v1/entomology/ledger-gaps returns full 118 nodes with summary |
| **Method** | HTTP GET to route; check status and response structure |
| **Pass** | status_code == 200; "nodes" length == 118; summary.total == 118 |

---

## `test_entomology_model.py`
> Tests for DiagnosticCategory, DiagnosticSeverity, DiagnosticEvent, hash computation, validation.

### `test_m01_category_enum_values`
| | |
|---|---|
| **Tests** | DiagnosticCategory enum contains all 8 values |
| **Method** | Check set of enum values |
| **Pass** | Enum values == {DEVICE, NETWORK, SYSTEM, PERIPHERAL, RECOVERY, UI, FIN, SEC} |

### `test_m02_severity_enum_values`
| | |
|---|---|
| **Tests** | DiagnosticSeverity enum contains all 4 values |
| **Method** | Check set of enum values |
| **Pass** | Enum values == {INFO, WARNING, ERROR, CRITICAL} |

### `test_m03_severity_ordering`
| | |
|---|---|
| **Tests** | Severity ordering: INFO < WARNING < ERROR < CRITICAL |
| **Method** | Use < operator on enum values |
| **Pass** | All comparisons return True |

### `test_m04_severity_le_ge`
| | |
|---|---|
| **Tests** | Severity supports <=, >= operators |
| **Method** | Test <= and >= operators on enum values |
| **Pass** | Comparisons work correctly (INFO <= INFO, INFO <= WARNING, CRITICAL >= ERROR) |

### `test_m05_severity_comparison_with_non_severity`
| | |
|---|---|
| **Tests** | Severity comparison with non-severity type returns NotImplemented |
| **Method** | Compare severity to string; check return value |
| **Pass** | __lt__, __le__, __gt__, __ge__ all return NotImplemented for invalid types |

### `test_m06_diagnostic_event_valid`
| | |
|---|---|
| **Tests** | DiagnosticEvent creates valid instance with all fields |
| **Method** | Construct event with all parameters; validate attributes |
| **Pass** | All attributes match input values |

### `test_m07_diagnostic_event_defaults`
| | |
|---|---|
| **Tests** | DiagnosticEvent auto-generates diagnostic_id (UUID) and sets correlation_id to None |
| **Method** | Construct without diagnostic_id; check auto-generated UUID and None correlation_id |
| **Pass** | diagnostic_id length == 36; correlation_id is None; timestamp is not None |

### `test_m08_invalid_category`
| | |
|---|---|
| **Tests** | Invalid category string raises ValidationError |
| **Method** | Construct event with invalid category; expect exception |
| **Pass** | ValidationError raised |

### `test_m09_invalid_severity`
| | |
|---|---|
| **Tests** | Invalid severity string raises ValidationError |
| **Method** | Construct event with invalid severity; expect exception |
| **Pass** | ValidationError raised |

### `test_m10_context_must_be_dict`
| | |
|---|---|
| **Tests** | context must be dict; string raises ValidationError |
| **Method** | Construct event with string context; expect exception |
| **Pass** | ValidationError raised |

### `test_m11_event_code_format_valid`
| | |
|---|---|
| **Tests** | Event code pattern validates PREFIX-CODE format (e.g., DEV-001, SYS-HEARTBEAT) |
| **Method** | Test pattern matching on valid codes |
| **Pass** | Pattern matches valid codes |

### `test_m11_event_code_format_invalid`
| | |
|---|---|
| **Tests** | Invalid event code (missing - or wrong format) raises ValidationError |
| **Method** | Construct event with "bad-format" code; expect exception |
| **Pass** | ValidationError raised |

### `test_m12_hash_deterministic`
| | |
|---|---|
| **Tests** | compute_diagnostic_hash() is deterministic and returns 64-char SHA-256 hex |
| **Method** | Call hash function twice with same args; check equality and length |
| **Pass** | h1 == h2; len(h1) == 64 |

### `test_m13_hash_different_inputs`
| | |
|---|---|
| **Tests** | Different inputs produce different hashes |
| **Method** | Hash two sets with only message field different |
| **Pass** | h1 != h2 |

### `test_m14_constants`
| | |
|---|---|
| **Tests** | GENESIS_HASH and DEFAULT_RETENTION_DAYS constants |
| **Method** | Check constant values |
| **Pass** | GENESIS_HASH == "KIND_DIAGNOSTIC_GENESIS"; DEFAULT_RETENTION_DAYS == 90 |

---

## `test_entomology_new_hooks.py`
> Tests for newly-wired entomology hooks (SYS-003/004/005, FIN-006, SEC-004, PER-007).

### `test_sys003_disk_threshold_emits_warning`
| | |
|---|---|
| **Tests** | Disk usage above 85% threshold emits SYS-003 WARNING event |
| **Method** | Mock _collect_system_metrics to return 92.5% disk; call _collect_heartbeat(); query SYS-003 events |
| **Pass** | len(events) == 1; severity == WARNING; context["disk_used_pct"] == 92.5; context["threshold"] == 85.0 |

### `test_sys004_memory_threshold_emits_warning`
| | |
|---|---|
| **Tests** | Memory usage above threshold emits SYS-004 WARNING event |
| **Method** | Mock _collect_system_metrics to return 91.2% memory; call _collect_heartbeat(); query SYS-004 |
| **Pass** | len(events) == 1; context["memory_used_pct"] == 91.2 |

### `test_sys005_cpu_temp_threshold_emits_warning`
| | |
|---|---|
| **Tests** | CPU temp above threshold emits SYS-005 WARNING event |
| **Method** | Mock _collect_system_metrics to return 82°C; call _collect_heartbeat(); query SYS-005 |
| **Pass** | len(events) == 1; context["cpu_temp_c"] == 82.0 |

### `test_heartbeat_below_thresholds_emits_nothing_derived`
| | |
|---|---|
| **Tests** | All metrics below thresholds emit only SYS-HEARTBEAT, not SYS-003/004/005 |
| **Method** | Mock low metrics; call _collect_heartbeat(); query all event codes |
| **Pass** | SYS-HEARTBEAT count == 1; SYS-003/004/005 counts == 0 |

### `test_per007_helper_records_warning_when_collector_present`
| | |
|---|---|
| **Tests** | _report_drawer_failure() helper records PER-007 WARNING when collector is wired |
| **Method** | Override module-level collector; call helper; query PER-007; validate context fields |
| **Pass** | len(events) == 1; severity == WARNING; context includes printer_id and opened_by |

### `test_per007_helper_noops_when_collector_missing`
| | |
|---|---|
| **Tests** | _report_drawer_failure() doesn't raise when collector is None |
| **Method** | Set collector to None; call helper |
| **Pass** | No exception raised |

---

## `test_entomology_reboot.py`
> Tests for SYS-007 reboot marker events, context, and gap detection.

### `test_b01_sys007_records`
| | |
|---|---|
| **Tests** | SYS-007 reboot marker event records correctly |
| **Method** | Record SYS-007 with pre-shutdown context |
| **Pass** | event.event_code == "SYS-007"; category == SYSTEM |

### `test_b02_sys007_context_fields`
| | |
|---|---|
| **Tests** | SYS-007 context contains scheduled_time, uptime_hours, pending_jobs |
| **Method** | Record SYS-007; check context keys |
| **Pass** | All three keys present in context |

### `test_b03_gap_detection`
| | |
|---|---|
| **Tests** | Gap between SYS-007 pre-shutdown and post-boot heartbeat is detectable |
| **Method** | Record SYS-007; then heartbeat; get all events ordered |
| **Pass** | Both events recorded; events ordered correctly; can identify gap |

### `test_b04_multiple_reboots`
| | |
|---|---|
| **Tests** | Multiple SYS-007 events across 3 days tracked |
| **Method** | Record SYS-007 three times with day offset in context |
| **Pass** | get_events(event_code="SYS-007") returns 3 events |

### `test_b05_reboot_with_pending_jobs`
| | |
|---|---|
| **Tests** | SYS-007 with non-zero pending_jobs can elevate to WARNING severity |
| **Method** | Record SYS-007 with pending_jobs=3 and WARNING severity |
| **Pass** | severity == WARNING; context["pending_jobs"] == 3 |

---

## `test_entomology_registry.py`
> Tests for EVENT_CODE_REGISTRY completeness and consistency.

### `test_r01_registry_count`
| | |
|---|---|
| **Tests** | EVENT_CODE_REGISTRY contains exactly 61 codes |
| **Method** | Check dictionary length |
| **Pass** | len(EVENT_CODE_REGISTRY) == 61 |

### `test_r10_security_codes`
| | |
|---|---|
| **Tests** | SEC- prefix codes present (6 codes) |
| **Method** | Filter codes by prefix; count |
| **Pass** | 6 SEC- codes found |

### `test_r11_financial_codes`
| | |
|---|---|
| **Tests** | FIN- prefix codes present (8 codes) |
| **Method** | Filter codes by prefix; count |
| **Pass** | 8 FIN- codes found |

### `test_r12_ui_codes`
| | |
|---|---|
| **Tests** | UI- prefix codes present (11 codes) |
| **Method** | Filter codes by prefix; count |
| **Pass** | 11 UI- codes found |

### `test_r02_no_duplicates`
| | |
|---|---|
| **Tests** | All registry codes are unique |
| **Method** | Extract keys; check set size == list size |
| **Pass** | len(codes) == len(set(codes)) |

### `test_r03_all_codes_match_pattern`
| | |
|---|---|
| **Tests** | All codes match PREFIX-CODE regex pattern |
| **Method** | Validate each code against pattern |
| **Pass** | All codes match EVENT_CODE_PATTERN |

### `test_r04_descriptions_non_empty`
| | |
|---|---|
| **Tests** | All codes have non-empty string descriptions |
| **Method** | Check each value is string and len > 0 |
| **Pass** | All descriptions are non-empty strings |

### `test_r05_device_codes`
| | |
|---|---|
| **Tests** | DEV- prefix codes present (6 codes) |
| **Method** | Filter codes by prefix; count |
| **Pass** | 6 DEV- codes found |

### `test_r06_network_codes`
| | |
|---|---|
| **Tests** | NET- prefix codes present (8 codes) |
| **Method** | Filter codes by prefix; count |
| **Pass** | 8 NET- codes found |

### `test_r07_system_codes`
| | |
|---|---|
| **Tests** | SYS- prefix codes present (8 codes) |
| **Method** | Filter codes by prefix; count |
| **Pass** | 8 SYS- codes found |

### `test_r08_peripheral_codes`
| | |
|---|---|
| **Tests** | PER- prefix codes present (7 codes) |
| **Method** | Filter codes by prefix; count |
| **Pass** | 7 PER- codes found |

### `test_r09_recovery_codes`
| | |
|---|---|
| **Tests** | REC- prefix codes present (7 codes) |
| **Method** | Filter codes by prefix; count |
| **Pass** | 7 REC- codes found |

---

## `test_entomology_report.py`
> Tests for EntomologyReportGenerator: Layer 1 (scorecards), Layer 2 (patterns), Layer 3 (timeline).

### `test_l1_01_generate_returns_tuple`
| | |
|---|---|
| **Tests** | generate() returns (html_string, filename_string) |
| **Method** | Call generate() on populated collector |
| **Pass** | html is str; filename is str and ends with .html |

### `test_l1_02_html_structure`
| | |
|---|---|
| **Tests** | HTML output has valid structure (DOCTYPE, html tags, style block) |
| **Method** | Generate report; check for required HTML elements |
| **Pass** | HTML contains <!DOCTYPE html>, <html>, </html>, <style> tags |

### `test_l1_03_all_scorecards`
| | |
|---|---|
| **Tests** | Report includes scorecards for all 5 diagnostic categories |
| **Method** | Generate report with mixed events; check HTML for all category names |
| **Pass** | All category.value strings appear in HTML |

### `test_l1_04_scorecard_counts`
| | |
|---|---|
| **Tests** | Scorecards display event counts |
| **Method** | Generate report; check for "events" keyword |
| **Pass** | "events" appears in HTML |

### `test_l1_05_severity_badges`
| | |
|---|---|
| **Tests** | Severity badges (INFO, WARN, ERR, CRIT) appear in report |
| **Method** | Generate report with mixed severity events; check HTML |
| **Pass** | "INFO", "WARN", "ERR", "CRIT" all present |

### `test_l1_06_health_color_critical`
| | |
|---|---|
| **Tests** | CRITICAL severity events trigger red health color |
| **Method** | Record CRITICAL event; generate report; check for CRITICAL color hex |
| **Pass** | SEVERITY_COLORS["CRITICAL"] appears in HTML |

### `test_l1_07_health_color_info`
| | |
|---|---|
| **Tests** | INFO-only events use green health color |
| **Method** | Record only INFO event; generate report; check for INFO color hex |
| **Pass** | SEVERITY_COLORS["INFO"] appears in HTML |

### `test_l1_08_top5_table`
| | |
|---|---|
| **Tests** | Report includes "Top 5 Issues" table with <table> tag |
| **Method** | Seed mixed events; generate report; check for heading and table |
| **Pass** | "Top 5 Issues" and "<table" present in HTML |

### `test_l1_09_active_resolved`
| | |
|---|---|
| **Tests** | Report shows "active issues" and "resolved" summary |
| **Method** | Generate report; search for keywords |
| **Pass** | "active issues" and "resolved" appear in HTML |

### `test_l1_10_empty_report`
| | |
|---|---|
| **Tests** | Empty event collector still generates valid HTML report |
| **Method** | Generate on empty collector |
| **Pass** | HTML valid; filename ends with .html |

### `test_l1_11_site_name`
| | |
|---|---|
| **Tests** | Site name appears in report HTML and filename |
| **Method** | Generate with site_name="TestStore"; check output |
| **Pass** | "TestStore" in HTML and filename |

### `test_l1_12_terminal_filter`
| | |
|---|---|
| **Tests** | generate(terminal_ids=[...]) filters events to specified terminals |
| **Method** | Generate with terminal_ids parameter; check filtered output |
| **Pass** | terminal ID appears in HTML |

### `test_l1_13_report_window`
| | |
|---|---|
| **Tests** | REPORT_WINDOW_DAYS constant equals 7 |
| **Method** | Check constant |
| **Pass** | REPORT_WINDOW_DAYS == 7 |

### `test_l1_14_layer1_section`
| | |
|---|---|
| **Tests** | Report contains Layer 1 System Health Summary section |
| **Method** | Generate report; search for section heading |
| **Pass** | "Layer 1" and "System Health Summary" in HTML |

### `test_l2_01_layer2_section`
| | |
|---|---|
| **Tests** | Report contains Layer 2 Pattern Analysis section |
| **Method** | Generate report; search for section |
| **Pass** | "Layer 2" and "Pattern Analysis" in HTML |

### `test_l2_02_recurring_clusters`
| | |
|---|---|
| **Tests** | 5 identical DEV-001 events detected as recurring cluster |
| **Method** | Record DEV-001 five times; generate report; check for clustering |
| **Pass** | "Recurring Issue Clusters", "DEV-001", "5 occurrences" in HTML |

### `test_l2_03_no_recurring`
| | |
|---|---|
| **Tests** | Single unique event shows "No recurring issues" message |
| **Method** | Record one INFO event; generate report |
| **Pass** | "No recurring issues" in HTML |

### `test_l2_04_hour_histogram`
| | |
|---|---|
| **Tests** | Report renders Hour of Day Distribution histogram |
| **Method** | Record events; generate report; check for histogram markers |
| **Pass** | "Hour of Day Distribution" and "hist-bar" in HTML |

### `test_l2_05_peripheral_timeline_section`
| | |
|---|---|
| **Tests** | Report includes Peripheral Health Timeline section |
| **Method** | Generate report; search for section |
| **Pass** | "Peripheral Health Timeline" in HTML |

### `test_l2_06_peripheral_with_data`
| | |
|---|---|
| **Tests** | Peripheral timeline renders heartbeat peripheral status data |
| **Method** | Record heartbeat with peripherals dict; generate report |
| **Pass** | MAC address and "Uptime:" in HTML |

### `test_l2_07_correlation_chains`
| | |
|---|---|
| **Tests** | Report includes Correlation Chains section |
| **Method** | Generate report; search for section |
| **Pass** | "Correlation Chains" in HTML |

### `test_l2_08_resolved_unresolved_chains`
| | |
|---|---|
| **Tests** | Error → Recovery correlation chain shows as "Resolved" |
| **Method** | Record correlated DEV error + REC success; generate report |
| **Pass** | "Resolved" appears in HTML |

### `test_l2_09_escalation_section`
| | |
|---|---|
| **Tests** | Report includes Escalation Candidates section |
| **Method** | Generate report; search for section |
| **Pass** | "Escalation Candidates" in HTML |

### `test_l2_10_escalation_detected`
| | |
|---|---|
| **Tests** | Increasing trend in DEV-001 across 3 days flagged as INCREASING escalation |
| **Method** | Record DEV-001: 1 day 1, 2 on day 2, 3 on day 3; backdate events; generate report |
| **Pass** | "INCREASING" in HTML |

### `test_l2_11_no_escalation`
| | |
|---|---|
| **Tests** | Single event shows "No escalating trends" message |
| **Method** | Record one event; generate report |
| **Pass** | "No escalating trends" in HTML |

### `test_l2_12_cluster_sources`
| | |
|---|---|
| **Tests** | Recurring cluster shows multiple sources (AdapterA, AdapterB) |
| **Method** | Record DEV-001 from two sources; generate report; check Sources field |
| **Pass** | Both adapter names and "Sources:" label in HTML |

### `test_l3_01_layer3_section`
| | |
|---|---|
| **Tests** | Report contains Layer 3 Event Timeline section |
| **Method** | Generate report; search for section |
| **Pass** | "Layer 3" and "Event Timeline" in HTML |

### `test_l3_02_default_warning_filter`
| | |
|---|---|
| **Tests** | Timeline defaults to WARNING+ (excludes INFO heartbeats) |
| **Method** | Record INFO and ERROR events; generate report; check timeline content |
| **Pass** | Error event appears; INFO message not shown in main timeline |

### `test_l3_03_full_timeline_toggle`
| | |
|---|---|
| **Tests** | Report includes toggle to show all events including INFO |
| **Method** | Generate report; search for toggle text |
| **Pass** | "Show all events" in HTML |

### `test_l3_04_severity_colors`
| | |
|---|---|
| **Tests** | All severity colors appear as HTML color codes in timeline |
| **Method** | Generate report; check for all color values |
| **Pass** | All SEVERITY_COLORS values in HTML |

### `test_l3_05_context_expandable`
| | |
|---|---|
| **Tests** | Event context appears as expandable JSON in timeline |
| **Method** | Record event with context dict; generate report; check for JSON display |
| **Pass** | "Context", "context-json", and context values in HTML |

### `test_l3_06_heartbeat_collapsing`
| | |
|---|---|
| **Tests** | Multiple consecutive heartbeats collapsed into summary in full timeline |
| **Method** | Record 4 heartbeats; generate report; check for collapsing display |
| **Pass** | "heartbeats" and "all healthy" in HTML |

### `test_l3_07_correlation_links`
| | |
|---|---|
| **Tests** | Correlated events show link to correlation ID in timeline |
| **Method** | Record correlated event; generate report; check for correlation ID display |
| **Pass** | "Correlated:" and partial correlation ID in HTML |

### `test_l3_08_empty_timeline`
| | |
|---|---|
| **Tests** | Empty events list shows "No events" placeholder |
| **Method** | Generate on empty collector; check timeline |
| **Pass** | "No events" in HTML |

### `test_l3_09_timeline_shows_source`
| | |
|---|---|
| **Tests** | Timeline rows display event source (adapter name) |
| **Method** | Record event with source "DejavooSPInAdapter"; generate report |
| **Pass** | "DejavooSPInAdapter" in HTML |

### `test_l3_10_timeline_shows_code`
| | |
|---|---|
| **Tests** | Timeline rows display event code (NET-007) |
| **Method** | Record NET-007 event; generate report |
| **Pass** | "NET-007" in HTML |

---

## `test_entomology_routes.py`
> Integration tests for entomology API routes (/snapshot, /issues, /report.xlsx).

### `test_snapshot_requires_auth`
| | |
|---|---|
| **Tests** | GET /api/v1/entomology/snapshot returns 401 without authentication |
| **Method** | Call unauthed_client.get("/api/v1/entomology/snapshot") |
| **Pass** | resp.status_code == 401 |

### `test_issues_requires_auth`
| | |
|---|---|
| **Tests** | GET /api/v1/entomology/issues returns 401 without authentication |
| **Method** | Call unauthed_client.get("/api/v1/entomology/issues") |
| **Pass** | resp.status_code == 401 |

### `test_report_requires_auth`
| | |
|---|---|
| **Tests** | GET /api/v1/entomology/report.xlsx returns 401 without authentication |
| **Method** | Call unauthed_client.get("/api/v1/entomology/report.xlsx") |
| **Pass** | resp.status_code == 401 |

### `test_snapshot_shape`
| | |
|---|---|
| **Tests** | /snapshot returns JSON with terminal_id, generated_at, probes, system_metrics |
| **Method** | HTTP GET with auth; validate response structure |
| **Pass** | status 200; body contains all required keys; system_metrics has memory/disk/cpu/uptime |

### `test_issues_filters_by_severity_and_groups`
| | |
|---|---|
| **Tests** | /issues filters out INFO events (default WARNING+); groups by category and event_code |
| **Method** | Record INFO, WARNING, CRITICAL events; GET with ?days=1; validate grouping |
| **Pass** | total == 2; groups dict has all 5 categories; DEVICE has DEV-001; SYSTEM empty (INFO filtered); NETWORK has NET-007 |

### `test_report_xlsx_returns_valid_workbook`
| | |
|---|---|
| **Tests** | /report.xlsx returns valid Excel workbook with event data |
| **Method** | Record DEV-001; GET /report.xlsx?days=7; parse with openpyxl |
| **Pass** | status 200; content-type is xlsx; sheets include Summary and DEVICE Issues; message appears in column E |

### `test_issues_rejects_invalid_days`
| | |
|---|---|
| **Tests** | /issues rejects days=0 and days=9999 with 422 |
| **Method** | Call GET with invalid days values |
| **Pass** | status_code == 422 for both |

### `test_issues_respects_min_severity`
| | |
|---|---|
| **Tests** | ?min_severity=INFO returns INFO+ events; default WARNING+ filters INFO |
| **Method** | Record INFO (UI-007) and WARNING (UI-001) events; call with default, min_severity=INFO, case-insensitive, invalid |
| **Pass** | default returns 1 event; INFO+ returns 2; case-insensitive works; invalid falls back to WARNING (1 event) |

### `test_sec004_emitted_when_replay_claims_this_terminal`
| | |
|---|---|
| **Tests** | SEC-004 event emitted when sync/config/events/replay batch contains self-claimed terminal_id |
| **Method** | POST replay event with terminal_id == settings.terminal_id; query SEC-004 |
| **Pass** | SEC-004 event recorded; context["local_terminal_id"] and "self_claim_count" present |

### `test_sec004_quiet_when_replay_claims_only_foreign_ids`
| | |
|---|---|
| **Tests** | SEC-004 not emitted for legitimate Overseer-origin replays (foreign terminal_ids) |
| **Method** | POST replay event with terminal_id == "OVERSEER"; query SEC-004 |
| **Pass** | No SEC-004 events recorded |

---

## `test_entomology_storage.py`
> Tests for SQLite schema, indexes, query operations, retention lifecycle.

### `test_s01_table_exists`
| | |
|---|---|
| **Tests** | diagnostic_events table exists after collector initialization |
| **Method** | Call table_exists() |
| **Pass** | returns True |

### `test_s02_indexes_created`
| | |
|---|---|
| **Tests** | Expected indexes created (timestamp, category, severity, event_code, correlation) |
| **Method** | Call get_indexes(); check for expected index names |
| **Pass** | Expected set is subset of actual indexes |

### `test_s03_wal_mode`
| | |
|---|---|
| **Tests** | SQLite uses WAL journal mode for concurrency |
| **Method** | Execute PRAGMA journal_mode; check result |
| **Pass** | result == "wal" |

### `test_s04_data_survives_reconnect`
| | |
|---|---|
| **Tests** | Event persisted to disk survives collector reconnect |
| **Method** | Record event; close collector; reopen same DB; count events |
| **Pass** | count == 1 after reconnect |

### `test_s05_hash_chain_after_reconnect`
| | |
|---|---|
| **Tests** | Hash chain remains valid across reconnect; e2.prev_hash == e1.hash |
| **Method** | Record e1; close; reopen; record e2; verify link |
| **Pass** | e2.prev_hash == e1.hash |

### `test_s06_retention_exports`
| | |
|---|---|
| **Tests** | run_retention() exports old events (>90 days) to JSON archive file |
| **Method** | Record event; backdate to 100 days ago; run_retention(90 days); verify JSON file exists |
| **Pass** | Archive file path returned; JSON contains event; message matches |

### `test_s07_retention_deletes`
| | |
|---|---|
| **Tests** | run_retention() deletes archived events from DB |
| **Method** | Record and backdate; run_retention(); count events |
| **Pass** | count == 0 after retention |

### `test_s08_retention_keeps_recent`
| | |
|---|---|
| **Tests** | run_retention() keeps recent events (< retention days) |
| **Method** | Record old and recent events; run_retention(); count remaining |
| **Pass** | count == 1; remaining event is recent one |

### `test_s09_retention_nothing_to_archive`
| | |
|---|---|
| **Tests** | run_retention() returns None when no events older than threshold |
| **Method** | Run retention on collector with no old events |
| **Pass** | result is None |

### `test_s10_archive_json_structure`
| | |
|---|---|
| **Tests** | Archive JSON contains all event fields in correct format |
| **Method** | Archive old event; parse JSON; check record keys |
| **Pass** | Record has all expected keys (diagnostic_id, timestamp, category, severity, context, prev_hash, hash, etc.) |

### `test_s11_archive_filename`
| | |
|---|---|
| **Tests** | Archive filename format includes site name and timestamp |
| **Method** | Run retention with site_name="TestSite"; check filename |
| **Pass** | Filename starts with "TestSite_diag_archive_"; ends with .json |

### `test_s12_retention_idempotent`
| | |
|---|---|
| **Tests** | Multiple retention runs are idempotent (second run returns None) |
| **Method** | Run retention twice on same DB; check second result |
| **Pass** | First run returns archive path; second run returns None |

### `test_s13_row_to_event_roundtrip`
| | |
|---|---|
| **Tests** | Event round-trips through DB (original == restored from storage) |
| **Method** | Record event; query it back; compare all fields |
| **Pass** | All fields match (diagnostic_id, category, severity, source, message, context, hashes, correlation_id) |

### `test_s14_creates_parent_dir`
| | |
|---|---|
| **Tests** | Collector creates parent directories for DB file if missing |
| **Method** | Initialize with nested path; check directory created |
| **Pass** | nested directory exists after collector init |

---

## `test_ephemeral_log.py`
> Tests for ephemeral_log (non-chained SQLite log for printer, drawer, retry events).

### `test_append_persists_to_disk`
| | |
|---|---|
| **Tests** | append() writes event row to SQLite that persists |
| **Method** | Append PRINTER_STATUS_CHANGED event; read directly from DB |
| **Pass** | Row exists; event_type matches |

### `test_append_without_connect_raises`
| | |
|---|---|
| **Tests** | append() on disconnected log raises RuntimeError |
| **Method** | Create EphemeralLog without connect(); call append() |
| **Pass** | RuntimeError raised with "not connected" message |

### `test_many_appends_ordered_by_timestamp`
| | |
|---|---|
| **Tests** | Rapid 10 appends land in chronological order when queried |
| **Method** | Append 10 events with 1-second intervals; query ordered by timestamp |
| **Pass** | All 10 rows present and ordered chronologically |

### `test_purge_deletes_rows_older_than_cutoff`
| | |
|---|---|
| **Tests** | purge_before(cutoff) deletes events older than cutoff date |
| **Method** | Append 2 old, 1 new events; purge before 1 day ago; count remaining |
| **Pass** | deleted == 2; remaining == 1 (new event only) |

### `test_purge_with_nothing_to_delete_returns_zero`
| | |
|---|---|
| **Tests** | purge_before() returns 0 when all events are recent |
| **Method** | Append recent event; purge with old cutoff; check result |
| **Pass** | deleted == 0 |

### `test_purge_without_connect_raises`
| | |
|---|---|
| **Tests** | purge_before() on disconnected log raises RuntimeError |
| **Method** | Create EphemeralLog; call purge_before() without connect |
| **Pass** | RuntimeError raised |

### `test_aenter_opens_and_aexit_closes`
| | |
|---|---|
| **Tests** | async with context manager opens and closes cleanly |
| **Method** | Use context manager; check _db state before/after; verify append fails post-exit |
| **Pass** | _db is not None inside; _db is None after exit; subsequent append raises |

### `test_includes_printer_status`
| | |
|---|---|
| **Tests** | PRINTER_STATUS_CHANGED and PRINTER_ERROR in EPHEMERAL_EVENT_TYPES |
| **Method** | Check set membership |
| **Pass** | Both EventTypes in EPHEMERAL_EVENT_TYPES |

### `test_includes_drawer_events`
| | |
|---|---|
| **Tests** | DRAWER_OPENED and DRAWER_OPEN_FAILED in EPHEMERAL_EVENT_TYPES |
| **Method** | Check set membership |
| **Pass** | Both EventTypes in EPHEMERAL_EVENT_TYPES |

### `test_excludes_financial_events`
| | |
|---|---|
| **Tests** | Financial events (PAYMENT_CONFIRMED, ORDER_CLOSED, TIP_ADJUSTED, etc.) NOT in ephemeral routing |
| **Method** | Check set membership for all financial event types |
| **Pass** | None of the financial event types are in EPHEMERAL_EVENT_TYPES |

---

## `test_escpos_formatter.py`
> Tests for ESCPOSFormatter — translates template commands to raw ESC/POS bytes.

### `test_empty_commands`
| | |
|---|---|
| **Tests** | Empty command list returns just INIT bytes |
| **Method** | format([]) |
| **Pass** | result == INIT |

### `test_text_basic`
| | |
|---|---|
| **Tests** | Simple text command embeds content and line feed |
| **Method** | format([{'type': 'text', 'content': 'Hello'}]) |
| **Pass** | b'Hello' in result; LF in result |

### `test_text_bold`
| | |
|---|---|
| **Tests** | bold=True sets bit 3 (0x08) in ESC ! n byte |
| **Method** | Format bold text; find ESC ! sequence; check mode byte |
| **Pass** | mode_byte & 0x08 == 0x08 |

### `test_text_center_aligned`
| | |
|---|---|
| **Tests** | align='center' includes ALIGN_CENTER command |
| **Method** | Format centered text; check for ALIGN_CENTER bytes |
| **Pass** | ALIGN_CENTER in result |

### `test_text_right_aligned`
| | |
|---|---|
| **Tests** | align='right' includes ALIGN_RIGHT command |
| **Method** | Format right-aligned text; check for ALIGN_RIGHT bytes |
| **Pass** | ALIGN_RIGHT in result |

### `test_text_double_width_height`
| | |
|---|---|
| **Tests** | double_width=True + double_height=True sets bits 0x20 + 0x10 = 0x30 |
| **Method** | Format with both flags; check mode byte |
| **Pass** | mode_byte & 0x30 == 0x30 |

### `test_text_red`
| | |
|---|---|
| **Tests** | red=True wraps text with COLOR_RED before and COLOR_BLACK after |
| **Method** | Format red text; check color bytes before and after |
| **Pass** | COLOR_RED before text; COLOR_BLACK after text |

### `test_text_reverse`
| | |
|---|---|
| **Tests** | reverse=True wraps text with REVERSE_ON/OFF |
| **Method** | Format reverse text; check for REVERSE_ON before and REVERSE_OFF after |
| **Pass** | REVERSE_ON before text; REVERSE_OFF after text |

### `test_text_font_b`
| | |
|---|---|
| **Tests** | font='b' sets bit 0 (0x01) in mode byte |
| **Method** | Format with font='b'; check mode byte |
| **Pass** | mode_byte & 0x01 == 0x01 |

### `test_feed`
| | |
|---|---|
| **Tests** | feed type with lines=3 outputs 3 LF bytes |
| **Method** | format([{'type': 'feed', 'lines': 3}]) |
| **Pass** | After INIT, result contains LF * 3 |

### `test_divider`
| | |
|---|---|
| **Tests** | divider outputs specified char repeated for 80mm paper width |
| **Method** | format([{'type': 'divider', 'char': '='}]) |
| **Pass** | b'=' * 33 in result; b'=' * 43 not in result |

### `test_divider_resets_print_mode`
| | |
|---|---|
| **Tests** | divider includes ESC ! 0x00 (normal mode reset) before chars |
| **Method** | Format divider; find mode reset and divider chars in output |
| **Pass** | ESC ! 0x00 appears before divider characters |

### `test_cut_full`
| | |
|---|---|
| **Tests** | cut type (full) includes CUT_FULL bytes |
| **Method** | format([{'type': 'cut'}]) |
| **Pass** | CUT_FULL in result |

### `test_cut_partial`
| | |
|---|---|
| **Tests** | cut type with partial=True includes CUT_PARTIAL bytes |
| **Method** | format([{'type': 'cut', 'partial': True}]) |
| **Pass** | CUT_PARTIAL in result |

### `test_safe_encode_unicode`
| | |
|---|---|
| **Tests** | Non-ASCII characters (em-dash) replaced with safe ASCII (hyphen) |
| **Method** | format with em-dash; check encoded result |
| **Pass** | b'dash-here' in result |

### `test_paper_width_58mm`
| | |
|---|---|
| **Tests** | 58mm paper width reduces chars_per_line to 33 |
| **Method** | Create formatter with paper_width=58; format divider |
| **Pass** | chars_per_line == 33; divider has 33 dashes |

---

## `test_event_ledger.py`
> Test Event Ledger and Projections — full workflow with order state recovery.

### `test_event_ledger`
| | |
|---|---|
| **Tests** | End-to-end ledger test: order creation → items → modifiers → payment → close → recovery |
| **Method** | Create order; add items + modifiers; remove item; project state; process payment; close order; replay events |
| **Pass** | All calculations verified (subtotal, tax, total); hash chain valid; state recovered equals original after crash simulation |

---

## `test_financial_invariants.py`
> Unit tests for financial invariants — all checks get pass/fail/boundary cases.

### `test_pass_with_only_gross`
| | |
|---|---|
| **Tests** | P&L identity: gross - voids - discounts - refunds == net (simple case) |
| **Method** | check_pnl_identity(gross=100, all_deductions=0, net=100) |
| **Pass** | result.ok is True; result.diff == 0.0 |

### `test_pass_with_all_deductions`
| | |
|---|---|
| **Tests** | P&L identity: 100 - 20 - 5 - 2 == 73 |
| **Method** | check_pnl_identity(gross=100, voids=20, discounts=5, refunds=2, net=73) |
| **Pass** | result.ok is True |

### `test_fail_detects_missing_void`
| | |
|---|---|
| **Tests** | P&L identity fails when void amount missing from net |
| **Method** | check_pnl_identity(gross=100, voids=20, net=100) — net should be 80 |
| **Pass** | result.ok is False; result.diff ≈ 20.0 |

### `test_tolerance_allows_rounding_drift`
| | |
|---|---|
| **Tests** | 0.01 difference accepted within tolerance |
| **Method** | check_pnl_identity(gross=100, net=100.01) |
| **Pass** | result.ok is True |

### `test_tolerance_rejects_beyond_cent`
| | |
|---|---|
| **Tests** | 0.02 difference rejected (exceeds tolerance) |
| **Method** | check_pnl_identity(gross=100, net=100.02) |
| **Pass** | result.ok is False |

### `test_assert_raises_on_violation`
| | |
|---|---|
| **Tests** | assert_pnl_identity() raises InvariantViolation on mismatch |
| **Method** | Call with mismatched values |
| **Pass** | InvariantViolation raised; name="pnl_identity"; diff ≈ -15.0 |

### `test_cash_only`
| | |
|---|---|
| **Tests** | Tender reconciliation: cash_total + card_total == net_sales + tax_collected |
| **Method** | check_tender_reconciliation(cash=100, card=0, net=95, tax=5) |
| **Pass** | result.ok is True |

### `test_mixed_tender`
| | |
|---|---|
| **Tests** | Tender reconciliation with both cash and card |
| **Method** | check_tender_reconciliation(cash=50, card=55, net=100, tax=5) |
| **Pass** | result.ok is True |

### `test_fail_on_missing_tender`
| | |
|---|---|
| **Tests** | Tender reconciliation detects missing tender (short cash) |
| **Method** | check_tender_reconciliation(cash=50, card=0, net=100, tax=5) |
| **Pass** | result.ok is False; diff ≈ -55.0 |

### `test_tips_pass`
| | |
|---|---|
| **Tests** | Tips partition: card_tips + cash_tips == total_tips |
| **Method** | check_tips_partition(total=30, card=25, cash=5) |
| **Pass** | result.ok is True |

### `test_tips_fail_missing_cash`
| | |
|---|---|
| **Tests** | Tips partition detects missing cash tips |
| **Method** | check_tips_partition(total=30, card=25, cash=0) |
| **Pass** | result.ok is False; diff ≈ 5.0 |

### `test_cash_expected_pass`
| | |
|---|---|
| **Tests** | Cash expected: cash_sales - card_tips == cash_expected |
| **Method** | check_cash_expected(cash_sales=100, card_tips=20, cash_expected=80) |
| **Pass** | result.ok is True |

### `test_cash_expected_fail_wrong_formula`
| | |
|---|---|
| **Tests** | Detects POS bug: using cash_sales + cash_tips instead of cash_sales - card_tips |
| **Method** | check_cash_expected(cash_sales=100, card_tips=20, cash_expected=100) |
| **Pass** | result.ok is False; diff ≈ 20.0 |

### `test_over_short_on_target`
| | |
|---|---|
| **Tests** | Over/Short matches when actual_counted == cash_expected |
| **Method** | check_over_short(expected=100, actual=100, over_short=0) |
| **Pass** | result.ok is True |

### `test_over_short_over`
| | |
|---|---|
| **Tests** | Over/Short correctly reports overage |
| **Method** | check_over_short(expected=100, actual=102.50, over_short=2.50) |
| **Pass** | result.ok is True |

### `test_over_short_short`
| | |
|---|---|
| **Tests** | Over/Short correctly reports shortage |
| **Method** | check_over_short(expected=100, actual=97.25, over_short=-2.75) |
| **Pass** | result.ok is True |

### `test_over_short_fail_wrong_sign`
| | |
|---|---|
| **Tests** | Over/Short detects sign mismatch |
| **Method** | check_over_short(expected=100, actual=95, over_short=5.0) — should be -5.0 |
| **Pass** | result.ok is False; diff ≈ 10.0 |

### `test_batch_settlement_includes_tips`
| | |
|---|---|
| **Tests** | Batch settlement: card_sales + card_tips == settlement |
| **Method** | check_batch_settlement(card_sales=500, card_tips=75, settlement=575) |
| **Pass** | result.ok is True |

### `test_batch_settlement_fail_excludes_tips`
| | |
|---|---|
| **Tests** | Detects settlement that excludes tips |
| **Method** | check_batch_settlement(card_sales=500, card_tips=75, settlement=500) |
| **Pass** | result.ok is False; diff ≈ -75.0 |

### `test_all_2dp_pass_clean`
| | |
|---|---|
| **Tests** | All values exactly at 2 decimal places pass |
| **Method** | check_all_2dp({"a": 1.00, "b": 2.50, "c": -5.25}) |
| **Pass** | result.ok is True |

### `test_all_2dp_pass_with_none`
| | |
|---|---|
| **Tests** | None values ignored in 2DP check |
| **Method** | check_all_2dp({"a": 1.00, "b": None}) |
| **Pass** | result.ok is True |

### `test_all_2dp_fail_float_drift`
| | |
|---|---|
| **Tests** | IEEE 754 float drift (0.1 + 0.2 = 0.30000000000000004) detected |
| **Method** | check_all_2dp({"sum": 0.1 + 0.2}) |
| **Pass** | result.ok is False |

### `test_all_2dp_fail_three_decimal`
| | |
|---|---|
| **Tests** | Three decimal places rejected |
| **Method** | check_all_2dp({"price": 1.234}) |
| **Pass** | result.ok is False; "price" in message |

### `test_all_2dp_pass_decimal_type`
| | |
|---|---|
| **Tests** | Decimal type values at exactly 2DP pass |
| **Method** | check_all_2dp({"a": Decimal("1.00"), "b": Decimal("2.50")}) |
| **Pass** | result.ok is True |

### `test_all_2dp_fail_decimal_three_dp`
| | |
|---|---|
| **Tests** | Decimal with 3DP rejected |
| **Method** | check_all_2dp({"a": Decimal("1.234")}) |
| **Pass** | result.ok is False |

### `test_day_close_balanced`
| | |
|---|---|
| **Tests** | Fully balanced day (all invariants pass) |
| **Method** | check_day_close with known-balanced payload |
| **Pass** | All results have ok=True |

### `test_day_close_bad_net_fails_pnl`
| | |
|---|---|
| **Tests** | Bad net_sales value fails pnl_identity check only |
| **Method** | check_day_close with net_sales=90 (wrong); verify pnl_identity in failures |
| **Pass** | At least 1 result with ok=False; pnl_identity in failed names |

### `test_day_close_optional_cash_fields`
| | |
|---|---|
| **Tests** | Optional cash_expected/over_short can be None without failing |
| **Method** | check_day_close with those fields None |
| **Pass** | No exception; checks still pass |

### `test_day_close_assert_raises`
| | |
|---|---|
| **Tests** | assert_day_close raises on first failure |
| **Method** | assert_day_close with bad net_sales |
| **Pass** | InvariantViolation raised |

### `test_day_close_real_world_scenario`
| | |
|---|---|
| **Tests** | Real user-reported scenario: $11 order, $40 voids, $11.55 cash, $0.55 tax |
| **Method** | check_day_close with user-provided values |
| **Pass** | All checks pass |

### `test_gate_empty`
| | |
|---|---|
| **Tests** | gate([]) returns empty list |
| **Method** | Call gate with empty input |
| **Pass** | Returns [] |

### `test_gate_all_passing`
| | |
|---|---|
| **Tests** | gate() with all-passing results returns unchanged |
| **Method** | gate with 2 passing results |
| **Pass** | Returns 2 results; all ok |

### `test_gate_not_strict`
| | |
|---|---|
| **Tests** | gate(strict=False) returns failures without raising |
| **Method** | gate with failing result and strict=False |
| **Pass** | Returns result; not ok; no exception |

### `test_gate_strict_raises`
| | |
|---|---|
| **Tests** | gate(strict=True) raises InvariantViolation on first failure |
| **Method** | gate with failing result and strict=True |
| **Pass** | InvariantViolation raised with correct name |

### `test_gate_raises_first_not_second`
| | |
|---|---|
| **Tests** | Multiple failures: gate raises first one only |
| **Method** | gate with r1(pnl_identity) and r2(tender_reconciliation) both failing |
| **Pass** | Raises pnl_identity violation |

### `test_max_abs_diff_empty`
| | |
|---|---|
| **Tests** | max_abs_diff([]) returns Decimal("0.00") |
| **Method** | Call with empty list |
| **Pass** | Returns Decimal("0.00") |

### `test_max_abs_diff_all_zero`
| | |
|---|---|
| **Tests** | All results with diff=0 return 0 |
| **Method** | max_abs_diff with all-passing results |
| **Pass** | Returns Decimal("0") |

### `test_max_abs_diff_single_negative`
| | |
|---|---|
| **Tests** | Single negative diff: abs value returned |
| **Method** | max_abs_diff([result with diff=-5.00]) |
| **Pass** | Returns Decimal("5.00") |

### `test_max_abs_diff_largest_of_several`
| | |
|---|---|
| **Tests** | Returns largest absolute value from multiple failures |
| **Method** | max_abs_diff with diffs -5, 15, -3 |
| **Pass** | Returns Decimal("15.00") |

---

## `test_half_placement_utils.py`
> Tests for half placement utility functions (half pizza modifier support).

### `test_no_half_mods`
| | |
|---|---|
| **Tests** | has_half_modifiers() returns False for standard modifiers (no prefix) |
| **Method** | Call with list of simple modifiers |
| **Pass** | returns False |

### `test_left_mod`
| | |
|---|---|
| **Tests** | has_half_modifiers() returns True for prefix='Left' |
| **Method** | Call with modifier containing "Left" prefix |
| **Pass** | returns True |

### `test_right_mod`
| | |
|---|---|
| **Tests** | has_half_modifiers() returns True for prefix='Right' |
| **Method** | Call with modifier containing "Right" prefix |
| **Pass** | returns True |

### `test_string_mods`
| | |
|---|---|
| **Tests** | has_half_modifiers() returns False for string-only list |
| **Method** | Call with list of strings (not dicts) |
| **Pass** | returns False |

### `test_empty`
| | |
|---|---|
| **Tests** | has_half_modifiers([]) returns False |
| **Method** | Call with empty list |
| **Pass** | returns False |

### `test_whole_only`
| | |
|---|---|
| **Tests** | get_half_modifiers() with whole-only modifiers returns (whole_list, [], []) |
| **Method** | Call with 2 whole modifiers |
| **Pass** | len(whole)==2, left==[], right==[] |

### `test_left_only`
| | |
|---|---|
| **Tests** | get_half_modifiers() with left-only modifier returns in left list |
| **Method** | Call with 1 left modifier |
| **Pass** | len(left)==1; display_name and display_price match half price |

### `test_right_only`
| | |
|---|---|
| **Tests** | get_half_modifiers() with right-only modifier returns in right list |
| **Method** | Call with 1 right modifier |
| **Pass** | len(right)==1; display properties correct |

### `test_whole_plus_left_extra`
| | |
|---|---|
| **Tests** | Whole + Left same modifier: left entry marked is_extra=True with "Xtra" prefix |
| **Method** | Call with same modifier twice (whole and left) |
| **Pass** | left[0]["is_extra"]==True; display_name=="Xtra Pepperoni" |

### `test_whole_plus_right_extra`
| | |
|---|---|
| **Tests** | Whole + Right same modifier: right entry marked is_extra=True |
| **Method** | Call with same modifier twice (whole and right) |
| **Pass** | right[0]["is_extra"]==True; display_name=="Xtra Sausage" |

### `test_mixed`
| | |
|---|---|
| **Tests** | Complex case: 2 whole, 2 left (1 extra), 1 right; all categorized correctly |
| **Method** | Call with mixed modifiers |
| **Pass** | Counts correct; Pepperoni extra marked; Sausage not extra; Mushrooms not extra |

### `test_free_half_price`
| | |
|---|---|
| **Tests** | half_price=None renders as display_price=None (free modifier) |
| **Method** | Call with modifier having half_price=None |
| **Pass** | display_price is None |

---

## `test_hardware_ledger_emissions.py`
> Tests for ledger events emitted by /hardware/devices routes.

### `test_save_device_emits_printer_configured_on_new_mac`
| | |
|---|---|
| **Tests** | Saving new printer device emits PRINTER_CONFIGURED event |
| **Method** | Call save_device(); query ledger for PRINTER_CONFIGURED |
| **Pass** | 1 event emitted; payload["mac"] and categories correct |

### `test_resaving_same_categories_emits_no_event`
| | |
|---|---|
| **Tests** | Saving device with unchanged categories emits no new event |
| **Method** | Save same categories twice; check event counts |
| **Pass** | 1 PRINTER_CONFIGURED; 0 PRINTER_ASSIGNMENT_CHANGED |

### `test_changing_categories_emits_assignment_changed`
| | |
|---|---|
| **Tests** | Changing printer categories emits PRINTER_ASSIGNMENT_CHANGED |
| **Method** | Save "drinks"; re-save "drinks,desserts"; query for ASSIGNMENT_CHANGED |
| **Pass** | 1 ASSIGNMENT_CHANGED event; previous and new categories in payload |

### `test_delete_device_emits_printer_removed`
| | |
|---|---|
| **Tests** | Deleting device emits PRINTER_REMOVED event |
| **Method** | Save device; delete it; query ledger |
| **Pass** | 1 PRINTER_REMOVED; payload has MAC, name, type |

### `test_delete_unknown_mac_emits_nothing`
| | |
|---|---|
| **Tests** | Deleting non-existent MAC emits no event |
| **Method** | Delete unknown MAC |
| **Pass** | No PRINTER_REMOVED events |

### `test_card_reader_save_emits_payment_processor_configured`
| | |
|---|---|
| **Tests** | Saving card_reader device type emits PAYMENT_PROCESSOR_CONFIGURED |
| **Method** | Save card_reader device; query ledger |
| **Pass** | 1 PAYMENT_PROCESSOR_CONFIGURED; payload has MAC, register_id; NO tpn/auth_key (credentials hidden) |

---

## `test_hardware_routes_extended.py`
> Extended hardware route tests (list_devices, list_kitchen_printers, _tcp_probe, _probe_spin, _probe_host).

### `test_list_devices_empty`
| | |
|---|---|
| **Tests** | GET /api/v1/hardware/devices returns empty list initially |
| **Method** | HTTP GET to route |
| **Pass** | status 200; response == [] |

### `test_list_devices_after_save`
| | |
|---|---|
| **Tests** | GET /api/v1/hardware/devices returns saved device |
| **Method** | POST device; GET list; check response |
| **Pass** | 1 device returned; MAC and IP match |

### `test_list_kitchen_printers_empty`
| | |
|---|---|
| **Tests** | GET /api/v1/hardware/kitchen-printers returns empty initially |
| **Method** | HTTP GET to route |
| **Pass** | status 200; response == [] |

### `test_list_kitchen_printers_with_categories`
| | |
|---|---|
| **Tests** | Kitchen printers with categories show categories_list as array |
| **Method** | POST printer with categories="Food,Grill"; GET kitchen-printers; check categories_list |
| **Pass** | 1 printer; categories_list == ["Food", "Grill"] |

### `test_tcp_probe_connection_refused`
| | |
|---|---|
| **Tests** | _tcp_probe catches ConnectionRefusedError and returns False |
| **Method** | Mock socket.connect to raise error; call _tcp_probe |
| **Pass** | returns False |

### `test_probe_spin_returns_register_id`
| | |
|---|---|
| **Tests** | _probe_spin() extracts RegisterId from SPIn XML response |
| **Method** | Mock httpx response with XML; call _probe_spin |
| **Pass** | result["register_id"] == "REG01" |

### `test_probe_spin_on_error_returns_empty`
| | |
|---|---|
| **Tests** | _probe_spin() returns {} on ConnectError without raising |
| **Method** | Mock httpx to raise ConnectError; call _probe_spin |
| **Pass** | returns {} |

### `test_probe_host_classifies_printer`
| | |
|---|---|
| **Tests** | _probe_host() identifies device as printer when port 9100 open |
| **Method** | Mock _tcp_probe to return True for port 9100; call _probe_host |
| **Pass** | result["type"] == "printer"; result["port"] == 9100 |

### `test_probe_host_no_open_ports_returns_none`
| | |
|---|---|
| **Tests** | _probe_host() returns None when all ports closed |
| **Method** | Mock _tcp_probe to always return False; call _probe_host |
| **Pass** | returns None |

---

## `test_hash_chain_tamper.py`
> Hash Chain Tamper Detection Tests — verifies verify_chain() catches tampering.

### `test_intact_chain_passes`
| | |
|---|---|
| **Tests** | verify_chain() returns (True, None) for valid 6-event chain |
| **Method** | Insert 6 events; call verify_chain() |
| **Pass** | is_valid == True; invalid_seq == None |

### `test_tampered_hash_detected`
| | |
|---|---|
| **Tests** | verify_chain() detects when event's checksum was modified |
| **Method** | Insert 5 events; overwrite 3rd event's checksum; call verify_chain() |
| **Pass** | is_valid == False; invalid_seq == 3rd event's sequence number |

### `test_tampered_data_detected`
| | |
|---|---|
| **Tests** | verify_chain() detects when event's payload was modified |
| **Method** | Insert 5 events; overwrite 4th event's payload; call verify_chain() |
| **Pass** | is_valid == False; invalid_seq == 4th event's sequence number |

### `test_deleted_middle_event_detected`
| | |
|---|---|
| **Tests** | verify_chain() detects when middle event was deleted |
| **Method** | Insert 5 events; DELETE 3rd event; call verify_chain() |
| **Pass** | is_valid == False; invalid_seq == 4th event's sequence number (chain breaks at successor) |

### `test_empty_ledger_passes`
| | |
|---|---|
| **Tests** | Empty ledger passes verification without error |
| **Method** | Call verify_chain() on fresh ledger |
| **Pass** | is_valid == True; invalid_seq == None |

---

## `test_invariants_property.py`
> Property-style randomized tests for financial invariants (100 seeds).

### `test_invariants_hold_on_random_day`
| | |
|---|---|
| **Tests** | Every canonical identity holds across 100 randomized day scenarios |
| **Method** | Generate random order stream (seed-based); project state; call _aggregate_orders (which runs strict gate); validate invariants |
| **Pass** | All P&L, tender, tips checks pass for all 100 seeds |

### `test_empty_day_passes`
| | |
|---|---|
| **Tests** | Empty day (no orders) satisfies all financial identities |
| **Method** | Call _aggregate_orders([], {}); run all day_close checks |
| **Pass** | All checks pass |

### `test_all_voided_day_passes`
| | |
|---|---|
| **Tests** | Day where all 4 orders voided still balances |
| **Method** | Generate 4 voided orders; aggregate; validate |
| **Pass** | gross=80, void=80, net=0, cash+card=0 |

### `test_strict_mode_raises_on_injected_bad_state`
| | |
|---|---|
| **Tests** | Strict gate raises InvariantViolation when bad totals injected |
| **Method** | Run check_day_close with deliberately mismatched values; route through gate(strict=True) |
| **Pass** | InvariantViolation raised |

---

## `test_kindnostic_cli.py`
> KINDnostic CLI output formatting tests (--verbose, --json, --probe flags).

### `test_pass_line_contains_status_and_name`
| | |
|---|---|
| **Tests** | _format_result_line() for PASS status includes "PASS", probe name, duration |
| **Method** | Format PASS result with 42ms duration |
| **Pass** | "PASS", "dummy", "42ms" all in output |

### `test_fail_line_contains_message`
| | |
|---|---|
| **Tests** | _format_result_line() for FAIL includes message text |
| **Method** | Format FAIL result with message |
| **Pass** | "FAIL" and message text in output |

### `test_category_shown`
| | |
|---|---|
| **Tests** | Category (CRITICAL) appears in formatted output |
| **Method** | Format with CRITICAL category |
| **Pass** | "CRITICAL" in output |

### `test_includes_metadata`
| | |
|---|---|
| **Tests** | _format_verbose() displays metadata dict (events_checked, chain_valid) |
| **Method** | Format verbose with metadata |
| **Pass** | "events_checked", "500", "chain_valid" in output |

### `test_no_metadata_still_works`
| | |
|---|---|
| **Tests** | _format_verbose() works without metadata |
| **Method** | Format without metadata |
| **Pass** | Probe name in output; no exception |

### `test_ready_summary`
| | |
|---|---|
| **Tests** | _format_summary() shows pass count, status, total time |
| **Method** | Format 2 PASS results with "READY" outcome |
| **Pass** | "2 passed", "READY", "30ms" in output |

### `test_blocked_summary`
| | |
|---|---|
| **Tests** | _format_summary() shows failure/warning counts and "BLOCKED" status |
| **Method** | Format 1 FAIL and 1 WARN result |
| **Pass** | "1 failed", "1 warned", "BLOCKED" in output |

### `test_valid_json`
| | |
|---|---|
| **Tests** | _format_json() produces valid JSON with boot_id, outcome, probes, summary |
| **Method** | Format single PASS result as JSON |
| **Pass** | Parses as JSON; has expected keys; counts correct |

### `test_includes_failures`
| | |
|---|---|
| **Tests** | JSON output includes failure details (message) |
| **Method** | Format FAIL result as JSON |
| **Pass** | "failed": 1; payload["probes"][0]["message"] == "broken" |

### `test_pass_gets_green`
| | |
|---|---|
| **Tests** | Color output for PASS includes green ANSI code (0x1b[32m) |
| **Method** | Format with color=True and PASS status |
| **Pass** | "\033[32m" (green code) in output |

### `test_warn_gets_yellow`
| | |
|---|---|
| **Tests** | Color output for WARN includes yellow ANSI code (0x1b[33m) |
| **Method** | Format with color=True and WARN status |
| **Pass** | "\033[33m" (yellow code) in output |

### `test_fail_gets_red`
| | |
|---|---|
| **Tests** | Color output for FAIL includes red ANSI code (0x1b[31m) |
| **Method** | Format with color=True and FAIL status |
| **Pass** | "\033[31m" (red code) in output |

### `test_run_all_json_output`
| | |
|---|---|
| **Tests** | run_all() with json_output=True produces valid JSON; outcome=="READY" |
| **Method** | Call run_all(json_output=True); capture stdout; parse JSON |
| **Pass** | status 0; JSON parses; outcome=="READY" |

### `test_run_single_dummy`
| | |
|---|---|
| **Tests** | run_single_probe("dummy") returns exit 0; JSON contains probe |
| **Method** | Call with --probe dummy flag |
| **Pass** | exit 0; JSON has 1 probe named "dummy" |

### `test_run_single_unknown_returns_2`
| | |
|---|---|
| **Tests** | run_single_probe("nonexistent_probe") returns exit 2; stderr shows "Unknown" |
| **Method** | Call with unknown probe name |
| **Pass** | exit 2; "Unknown probe" in stderr |

### `test_run_single_shows_available`
| | |
|---|---|
| **Tests** | Unknown probe shows list of available probes |
| **Method** | Call with invalid probe |
| **Pass** | "dummy" appears in stderr list |

### `test_run_single_with_verbose`
| | |
|---|---|
| **Tests** | run_single_probe("dummy", verbose=True) shows details |
| **Method** | Call with --verbose flag |
| **Pass** | exit 0; "dummy" in stdout |

---

## `test_kindnostic_display.py`
> KINDnostic Display + Boot UX tests (HTML rendering, PIN validation, boot display server).

### `test_contains_progress_bar`
| | |
|---|---|
| **Tests** | render_progress() HTML shows progress bar with percentage and probe name |
| **Method** | render_progress(3, 10, "hash_chain_integrity") |
| **Pass** | "progress-fill", "30%", "hash_chain_integrity" in HTML |

### `test_shows_probe_count`
| | |
|---|---|
| **Tests** | Progress screen shows [5/15] format |
| **Method** | render_progress(5, 15, "ssd_health") |
| **Pass** | "[5/15]" in HTML |

### `test_zero_total_no_crash`
| | |
|---|---|
| **Tests** | render_progress(0, 0) handles zero denominator |
| **Method** | render_progress(0, 0, "init") |
| **Pass** | "0%" in HTML; no exception |

### `test_auto_refresh`
| | |
|---|---|
| **Tests** | Progress HTML includes auto-refresh meta tag |
| **Method** | render_progress(1, 5, "test") |
| **Pass** | 'http-equiv="refresh"' in HTML |

### `test_contains_checkmark`
| | |
|---|---|
| **Tests** | render_success() shows checkmark or ✓ symbol |
| **Method** | render_success() |
| **Pass** | "&#10003;" or "✓" in HTML |

### `test_contains_redirect`
| | |
|---|---|
| **Tests** | Success screen redirects to localhost:8000 |
| **Method** | render_success() |
| **Pass** | "http://localhost:8000" in HTML |

### `test_no_warnings_no_badge`
| | |
|---|---|
| **Tests** | Success without warnings has no warning badge |
| **Method** | render_success() without warnings |
| **Pass** | "warning(s)" not in HTML |

### `test_warnings_shown`
| | |
|---|---|
| **Tests** | Success with warnings shows badge and details |
| **Method** | render_success(warnings=[...]) with 2 warnings |
| **Pass** | "warning-badge", "2 warning(s)", probe names, messages in HTML |

### `test_contains_support_code`
| | |
|---|---|
| **Tests** | render_failure() shows support code (KN-HC-0404) and failure details |
| **Method** | render_failure([{"probe": "hash_chain_integrity", "message": "Chain broken"}], "KN-HC-0404") |
| **Pass** | Code, probe name, message all in HTML |

### `test_contains_override_form`
| | |
|---|---|
| **Tests** | Failure screen includes manager override PIN form |
| **Method** | render_failure([...], "KN-XX-0101") |
| **Pass** | 'action="/override"', 'name="pin"', "Manager Override" in HTML |

### `test_contains_call_support`
| | |
|---|---|
| **Tests** | Failure screen includes "Call Support" button |
| **Method** | render_failure([...], "KN-XX-0101") |
| **Pass** | "Call Support" in HTML |

### `test_pin_error_shown`
| | |
|---|---|
| **Tests** | PIN error message displayed with "pin-error" class |
| **Method** | render_failure([...], "KN-XX-0101", pin_error="Invalid manager PIN") |
| **Pass** | Error message and "pin-error" class in HTML |

### `test_cannot_accept_orders_message`
| | |
|---|---|
| **Tests** | Failure screen informs user system cannot accept orders |
| **Method** | render_failure([...], "KN-XX-0101") |
| **Pass** | "cannot accept orders" in HTML |

### `test_empty_warnings_returns_empty`
| | |
|---|---|
| **Tests** | render_warning_indicator([]) returns empty string |
| **Method** | render_warning_indicator([]) |
| **Pass** | returns "" |

### `test_shows_warning_count`
| | |
|---|---|
| **Tests** | Warning indicator shows count and badge |
| **Method** | render_warning_indicator([{"probe": "p1", "message": "m1"}, {"probe": "p2", "message": "m2"}]) |
| **Pass** | "2 boot warning(s)", "warning-badge" in HTML |

### `test_valid_manager_pin`
| | |
|---|---|
| **Tests** | validate_manager_pin("1234") returns employee_id for active manager with matching PIN |
| **Method** | Create ledger with manager; call validate_manager_pin |
| **Pass** | returns "alex" |

### `test_server_pin_rejected`
| | |
|---|---|
| **Tests** | Server role PIN rejected (non-manager) |
| **Method** | validate_manager_pin("5678") for server employee |
| **Pass** | returns None |

### `test_wrong_pin_rejected`
| | |
|---|---|
| **Tests** | Wrong PIN returns None |
| **Method** | validate_manager_pin("9999") with wrong PIN |
| **Pass** | returns None |

### `test_inactive_manager_rejected`
| | |
|---|---|
| **Tests** | Inactive manager PIN rejected |
| **Method** | validate_manager_pin with active=False manager |
| **Pass** | returns None |

### `test_no_ledger_returns_none`
| | |
|---|---|
| **Tests** | validate_manager_pin returns None when ledger DB doesn't exist |
| **Method** | Set KINDPOS_DB_PATH to non-existent path; call function |
| **Pass** | returns None |

### `test_initial_state`
| | |
|---|---|
| **Tests** | BootDisplayState() starts in "initializing" state |
| **Method** | Create BootDisplayState() |
| **Pass** | "initializing" in current_screen; override_completed == False |

### `test_set_progress`
| | |
|---|---|
| **Tests** | set_progress(3, 10, "hash_chain") updates screen with percentage and probe |
| **Method** | Call set_progress() |
| **Pass** | "30%" and "hash_chain" in current_screen |

### `test_set_success`
| | |
|---|---|
| **Tests** | set_success() transitions to success screen |
| **Method** | Call set_success() |
| **Pass** | Checkmark or success message in current_screen |

### `test_set_failure`
| | |
|---|---|
| **Tests** | set_failure([...], "KN-HC-0404") shows failure screen with code |
| **Method** | Call set_failure() |
| **Pass** | "KN-HC-0404" and "override" in current_screen |

### `test_handle_override_success`
| | |
|---|---|
| **Tests** | handle_override("1234") with valid PIN returns True; sets override state |
| **Method** | Set failure; call handle_override with correct manager PIN |
| **Pass** | returns True; override_completed == True; override_employee == "alex" |

### `test_handle_override_bad_pin`
| | |
|---|---|
| **Tests** | handle_override("9999") with wrong PIN returns False; shows error |
| **Method** | Call with wrong PIN |
| **Pass** | returns False; override_completed == False; pin_error contains "Invalid" |

### `test_server_starts_and_serves`
| | |
|---|---|
| **Tests** | BootDisplay HTTP server starts on OS-assigned port and serves root |
| **Method** | Create, start, GET /; check response |
| **Pass** | status 200; "KINDnostic" in HTML |

### `test_status_endpoint`
| | |
|---|---|
| **Tests** | /status endpoint returns JSON with outcome and override flag |
| **Method** | Set outcome; GET /status; parse JSON |
| **Pass** | "outcome": "READY"; "override": False |

### `test_context_manager`
| | |
|---|---|
| **Tests** | BootDisplay context manager auto starts/stops |
| **Method** | Use with BootDisplay(...) as display; GET /; verify status |
| **Pass** | status 200 |

### `test_warnings_endpoint`
| | |
|---|---|
| **Tests** | /warnings endpoint renders warning details |
| **Method** | Set warnings; GET /warnings; check HTML |
| **Pass** | Probe name and message in response |
Now I have all the test files read. Let me compile the formatted markdown documentation:

## `test_entomology_collector.py`
> Tests for DiagnosticCollector: recording, hash chaining, queries, adaptive heartbeat, and singleton behavior.

### `test_c01_record_returns_event`
| | |
|---|---|
| **Tests** | DiagnosticEvent is returned from record() with correct category, severity, and event_code |
| **Method** | Direct async call to collector.record() with sample event parameters |
| **Pass** | Returned object is DiagnosticEvent instance with matching category, severity, event_code |

### `test_c02_record_auto_id`
| | |
|---|---|
| **Tests** | Recorded event has auto-generated diagnostic_id in UUID format |
| **Method** | Call collector.record() and check diagnostic_id length |
| **Pass** | diagnostic_id length equals 36 (UUID string length) |

### `test_c03_record_auto_timestamp`
| | |
|---|---|
| **Tests** | Recorded event has auto-generated timestamp within acceptable time bounds |
| **Method** | Direct async call; capture before/after UTC timestamps; compare with event.timestamp |
| **Pass** | event.timestamp falls within [before, after] bounds |

### `test_c04_first_event_genesis_hash`
| | |
|---|---|
| **Tests** | First event uses GENESIS_HASH as prev_hash (immutable chain origin) |
| **Method** | Direct collector.record() call on fresh collector |
| **Pass** | event.prev_hash == GENESIS_HASH |

### `test_c05_hash_chain`
| | |
|---|---|
| **Tests** | Hash chain links subsequent events (e2.prev_hash == e1.hash) |
| **Method** | Record two events sequentially, compare prev_hash to prior hash |
| **Pass** | e2.prev_hash equals e1.hash |

### `test_c06_hash_chain_verifiable`
| | |
|---|---|
| **Tests** | Complete hash chain over 5 events maintains link integrity |
| **Method** | Record 5 events, iterate chain verifying each prev_hash matches prior hash, first links to genesis |
| **Pass** | All chain links verified; events[0].prev_hash == GENESIS_HASH; events[i].prev_hash == events[i-1].hash for all i>0 |

### `test_c07_hash_computation`
| | |
|---|---|
| **Tests** | Event hash is computed deterministically via compute_diagnostic_hash() |
| **Method** | Record event, recompute hash from event fields, compare |
| **Pass** | event.hash equals independently-computed expected hash |

### `test_c08_record_persists`
| | |
|---|---|
| **Tests** | Recorded event persists to SQLite |
| **Method** | Record event, call count_events() |
| **Pass** | count_events() returns 1 |

### `test_c09_record_with_correlation`
| | |
|---|---|
| **Tests** | Event stores correlation_id when provided |
| **Method** | Direct record() call with correlation_id kwarg |
| **Pass** | event.correlation_id equals provided id |

### `test_c10_record_no_correlation`
| | |
|---|---|
| **Tests** | Event correlation_id is None when not provided |
| **Method** | Record without correlation_id, check field |
| **Pass** | event.correlation_id is None |

### `test_c11_terminal_id`
| | |
|---|---|
| **Tests** | Event stores terminal_id from collector config |
| **Method** | Record event, check terminal_id field |
| **Pass** | event.terminal_id == "terminal-test-01" (from collector fixture) |

### `test_c12_multiple_records`
| | |
|---|---|
| **Tests** | Multiple record() calls increment count |
| **Method** | Record 10 events, call count_events() |
| **Pass** | count_events() returns 10 |

### `test_c13_get_events_all`
| | |
|---|---|
| **Tests** | get_events() returns all recorded events |
| **Method** | Record 3 events, call get_events() without filters |
| **Pass** | get_events() returns list of length 3 |

### `test_c14_get_events_by_category`
| | |
|---|---|
| **Tests** | get_events(category=...) filters by category |
| **Method** | Record DEVICE and NETWORK events, query DEVICE category |
| **Pass** | Only 1 DEVICE event returned; all results have correct category |

### `test_c15_get_events_by_severity`
| | |
|---|---|
| **Tests** | get_events(severity=...) filters by severity level |
| **Method** | Record ERROR and INFO events, query ERROR severity |
| **Pass** | Only 1 ERROR event returned; all results match severity |

### `test_c16_get_events_by_event_code`
| | |
|---|---|
| **Tests** | get_events(event_code=...) filters by event code |
| **Method** | Record DEV-001 and DEV-002, query DEV-001 |
| **Pass** | Only 1 DEV-001 event returned |

### `test_c17_get_events_by_time_range`
| | |
|---|---|
| **Tests** | get_events(since=..., until=...) filters by timestamp bounds |
| **Method** | Record event at now, query with past/future bounds, with future-only bounds |
| **Pass** | Event returned for past-to-future range; empty list for future-only range |

### `test_c18_get_events_by_correlation`
| | |
|---|---|
| **Tests** | get_events(correlation_id=...) filters by correlation ID |
| **Method** | Record with and without correlation_id, query by id |
| **Pass** | Only the correlated event returned |

### `test_c19_get_events_limit`
| | |
|---|---|
| **Tests** | get_events(limit=...) respects result limit |
| **Method** | Record 10 events, query with limit=3 |
| **Pass** | Exactly 3 events returned |

### `test_c20_get_events_by_severity_min`
| | |
|---|---|
| **Tests** | get_events_by_severity_min() returns events at or above threshold |
| **Method** | Record all severity levels (INFO/WARNING/ERROR/CRITICAL), query with ERROR minimum |
| **Pass** | Returns only ERROR and CRITICAL (2 events) |

### `test_c21_severity_min_with_time`
| | |
|---|---|
| **Tests** | get_events_by_severity_min() respects time filters |
| **Method** | Record CRITICAL event, query with severity_min + time range |
| **Pass** | 1 event returned matching time + severity constraints |

### `test_c22_get_all_events_ordered`
| | |
|---|---|
| **Tests** | get_all_events_ordered() returns events in ascending timestamp order |
| **Method** | Record 5 events, get all, verify timestamp sequence |
| **Pass** | Events in list are ordered by timestamp (each timestamp >= prior) |

### `test_c23_count_events_empty`
| | |
|---|---|
| **Tests** | count_events() returns 0 on fresh collector |
| **Method** | Call count_events() on unused collector |
| **Pass** | Returns 0 |

### `test_c24_active_heartbeat_interval`
| | |
|---|---|
| **Tests** | ACTIVE_HEARTBEAT_INTERVAL_S constant has expected value |
| **Method** | Direct constant check |
| **Pass** | ACTIVE_HEARTBEAT_INTERVAL_S == 60 |

### `test_c25_off_hours_heartbeat_interval`
| | |
|---|---|
| **Tests** | OFF_HOURS_HEARTBEAT_INTERVAL_S constant has expected value |
| **Method** | Direct constant check |
| **Pass** | OFF_HOURS_HEARTBEAT_INTERVAL_S == 900 |

### `test_c26_cooldown_minutes`
| | |
|---|---|
| **Tests** | COOLDOWN_MINUTES constant has expected value |
| **Method** | Direct constant check |
| **Pass** | COOLDOWN_MINUTES == 30 |

### `test_c27_notify_order_activates`
| | |
|---|---|
| **Tests** | notify_order_created() sets _service_active flag to True |
| **Method** | Check _service_active before/after notify_order_created() call |
| **Pass** | _service_active is False initially, becomes True after call |

### `test_c28_notify_cancels_cooldown`
| | |
|---|---|
| **Tests** | Successive notify_order_created() calls cancel prior cooldown task |
| **Method** | Call notify_order_created() twice, compare _cooldown_task references and cancellation state |
| **Pass** | First task is cancelled/done; second task is different object |

### `test_c29_heartbeat_loop_returns_task`
| | |
|---|---|
| **Tests** | start_heartbeat_loop() returns an asyncio.Task |
| **Method** | Call start_heartbeat_loop(), check return type and completion state |
| **Pass** | Returns asyncio.Task instance; task.done() is False |

### `test_c30_close_cancels_heartbeat`
| | |
|---|---|
| **Tests** | close() cancels the heartbeat task |
| **Method** | Start heartbeat loop, call close(), check task.done() |
| **Pass** | Task is done after close() |

### `test_c31_context_manager`
| | |
|---|---|
| **Tests** | DiagnosticCollector works as async context manager; _db is None after exit |
| **Method** | Use async with statement, record event inside, check _db state after exit |
| **Pass** | Event recorded successfully; _db is None after context exit |

---
## `test_kindnostic_probes_critical.py`
> Tests for all 5 CRITICAL probes: hash_chain_integrity, precision_gate, database_integrity, database_writable, schema_version

### `test_pass_healthy_chain`
| | |
|---|---|
| **Tests** | Hash chain integrity across 5 valid events with correct checksums and previous_checksum links |
| **Method** | Direct probe call on healthy SQLite event ledger DB |
| **Pass** | Status.PASS, events_checked=5, chain_valid=True |

### `test_pass_empty_ledger`
| | |
|---|---|
| **Tests** | Empty ledger (no events) is not considered integrity failure |
| **Method** | Probe on freshly created empty DB |
| **Pass** | Status.PASS, events_checked=0 |

### `test_pass_no_db_file`
| | |
|---|---|
| **Tests** | Missing DB file (fresh system) is not an integrity failure |
| **Method** | Probe with KINDPOS_DB_PATH pointing to nonexistent file |
| **Pass** | Status.PASS |

### `test_fail_tampered_checksum`
| | |
|---|---|
| **Tests** | Chain breaks when checksum is directly overwritten in SQLite |
| **Method** | Insert 5 events, manually update one checksum to 'deadbeef', replay chain |
| **Pass** | Status.FAIL, failed_sequence=3 |

### `test_fail_tampered_payload`
| | |
|---|---|
| **Tests** | Chain breaks when event payload is modified after insertion |
| **Method** | Insert 5 events, corrupt payload on sequence 2, verify chain check detects mismatch |
| **Pass** | Status.FAIL, failed_sequence=2 |

### `test_fail_broken_chain_link`
| | |
|---|---|
| **Tests** | Chain breaks when previous_checksum field is corrupted |
| **Method** | Insert 5 events, overwrite previous_checksum on sequence 4 with 'wrong', replay |
| **Pass** | Status.FAIL, failed_sequence=4 |

### `test_category_is_critical`
| | |
|---|---|
| **Tests** | Probe categorization is CRITICAL not HIGH/LOW |
| **Method** | Direct probe call, check category field |
| **Pass** | result.category == Category.CRITICAL |

### `test_pass_healthy_db`
| | |
|---|---|
| **Tests** | Precision gate succeeds on healthy DB with no drift detected |
| **Method** | Probe executes decimal precision test transactions on healthy DB |
| **Pass** | Status.PASS, values_tested=8, drift_detected=False |

### `test_pass_no_db_file` (precision_gate)
| | |
|---|---|
| **Tests** | Missing DB is not a precision failure |
| **Method** | Probe with missing DB path |
| **Pass** | Status.PASS |

### `test_rollback_leaves_no_trace`
| | |
|---|---|
| **Tests** | Probe cleanup: no temporary tables left behind after rollback |
| **Method** | Run probe, query sqlite_master for tables, verify no _precision_test table exists |
| **Pass** | No _precision_test table in sqlite_master |

### `test_category_is_critical` (precision_gate)
| | |
|---|---|
| **Tests** | Probe categorization is CRITICAL |
| **Method** | Direct probe call |
| **Pass** | result.category == Category.CRITICAL |

### `test_pass_healthy_dbs`
| | |
|---|---|
| **Tests** | Database integrity check passes on 3 healthy DBs (event, hardware, diagnostic) |
| **Method** | Probe all three configured DBs |
| **Pass** | Status.PASS |

### `test_skips_missing_dbs`
| | |
|---|---|
| **Tests** | Missing DB files don't cause failure — all skipped gracefully |
| **Method** | Probe with all DB paths pointing to nonexistent files |
| **Pass** | Status.PASS, all entries in metadata.checked have status='skipped' |

### `test_fail_corrupted_db`
| | |
|---|---|
| **Tests** | Corrupted DB file (byte overwrite) causes integrity failure |
| **Method** | Corrupt event_ledger.db by writing zeros at offset 100, run probe |
| **Pass** | Status.FAIL |

### `test_category_is_critical` (database_integrity)
| | |
|---|---|
| **Tests** | Probe is CRITICAL |
| **Method** | Direct call |
| **Pass** | result.category == Category.CRITICAL |

### `test_pass_healthy_dbs` (database_writable)
| | |
|---|---|
| **Tests** | All DBs are writable |
| **Method** | Probe on healthy DBs |
| **Pass** | Status.PASS, all entries in metadata.checked have status='writable' or 'skipped' |

### `test_skips_missing_dbs` (database_writable)
| | |
|---|---|
| **Tests** | Missing DBs are skipped, not failed |
| **Method** | Probe with nonexistent paths |
| **Pass** | Status.PASS |

### `test_fail_unwritable_db`
| | |
|---|---|
| **Tests** | Probe detects unwritable DB (directory instead of file) |
| **Method** | Point DB path to a directory, run probe |
| **Pass** | Status.FAIL, failures include event_ledger |

### `test_category_is_critical` (database_writable)
| | |
|---|---|
| **Tests** | Probe is CRITICAL |
| **Method** | Direct call |
| **Pass** | result.category == Category.CRITICAL |

### `test_pass_correct_schemas`
| | |
|---|---|
| **Tests** | Schema versions are correct (events, devices, boot_results, boot_summary tables exist) |
| **Method** | Probe on healthy DBs with proper schema |
| **Pass** | Status.PASS |

### `test_fail_missing_table`
| | |
|---|---|
| **Tests** | Probe detects missing required table (DROP TABLE events) |
| **Method** | Drop events table, run probe |
| **Pass** | Status.FAIL, failures include event_ledger |

### `test_skips_missing_dbs` (schema_version)
| | |
|---|---|
| **Tests** | Missing DBs are skipped, not failed |
| **Method** | Probe with nonexistent paths |
| **Pass** | Status.PASS |

### `test_category_is_critical` (schema_version)
| | |
|---|---|
| **Tests** | Probe is CRITICAL |
| **Method** | Direct call |
| **Pass** | result.category == Category.CRITICAL |

## `test_kindnostic_probes_high_low.py`
> Tests for all 9 HIGH/LOW probes: printers (2), hardware (3), system (4)

### `test_pass_no_hardware_db`
| | |
|---|---|
| **Tests** | Receipt printer probe passes when hardware DB doesn't exist |
| **Method** | Probe with missing hardware config DB |
| **Pass** | Status.PASS, configured=False |

### `test_pass_no_printers_configured`
| | |
|---|---|
| **Tests** | Probe passes when hardware DB is empty (no printers configured) |
| **Method** | Create empty hardware DB, run probe |
| **Pass** | Status.PASS |

### `test_warn_unreachable`
| | |
|---|---|
| **Tests** | Probe warns when receipt printer is unreachable |
| **Method** | Configure printer in DB, mock TCP check to return False |
| **Pass** | Status.WARN, message contains 'unreachable' |

### `test_pass_reachable`
| | |
|---|---|
| **Tests** | Probe passes when receipt printer is reachable |
| **Method** | Configure printer, mock TCP check returns True |
| **Pass** | Status.PASS, reachable=True |

### `test_category_is_high`
| | |
|---|---|
| **Tests** | Receipt printer probe is HIGH category |
| **Method** | Direct call |
| **Pass** | result.category == Category.HIGH |

### `test_pass_no_hardware_db` (kitchen_printer)
| | |
|---|---|
| **Tests** | Kitchen printer probe passes when hardware DB missing |
| **Method** | Probe with missing hardware DB |
| **Pass** | Status.PASS |

### `test_warn_unreachable` (kitchen_printer)
| | |
|---|---|
| **Tests** | Probe warns when kitchen printer unreachable |
| **Method** | Configure printer, mock TCP check returns False |
| **Pass** | Status.WARN |

### `test_pass_reachable` (kitchen_printer)
| | |
|---|---|
| **Tests** | Probe passes when kitchen printer reachable |
| **Method** | Configure printer, mock TCP check returns True |
| **Pass** | Status.PASS |

### `test_pass_sufficient_space`
| | |
|---|---|
| **Tests** | SSD health passes when free space is sufficient |
| **Method** | Probe on real filesystem |
| **Pass** | Status.PASS, free_mb > 0 |

### `test_warn_low_space`
| | |
|---|---|
| **Tests** | Probe warns when disk free space is low (< 200MB) |
| **Method** | Mock disk_usage to return 100MB free / 32GB total |
| **Pass** | Status.WARN, message contains 'Low disk space' |

### `test_pass_missing_path`
| | |
|---|---|
| **Tests** | Missing data path doesn't cause SSD health failure |
| **Method** | Point to nonexistent path |
| **Pass** | Status.PASS |

### `test_category_is_high` (ssd_health)
| | |
|---|---|
| **Tests** | SSD health is HIGH category |
| **Method** | Direct call |
| **Pass** | result.category == Category.HIGH |

### `test_pass_current_time`
| | |
|---|---|
| **Tests** | Clock sync passes when system time is current (2025-2035 range) |
| **Method** | Direct probe call on real system time |
| **Pass** | Status.PASS |

### `test_warn_year_too_old`
| | |
|---|---|
| **Tests** | Probe warns when system year is before 2026 |
| **Method** | Mock datetime to 2020-01-01 |
| **Pass** | Status.WARN, message contains 'year < 2026' |

### `test_warn_year_too_new`
| | |
|---|---|
| **Tests** | Probe warns when system year is after 2035 |
| **Method** | Mock datetime to 2040-06-15 |
| **Pass** | Status.WARN, message contains 'year > 2035' |

### `test_category_is_high` (clock_sync)
| | |
|---|---|
| **Tests** | Clock sync is HIGH category |
| **Method** | Direct call |
| **Pass** | result.category == Category.HIGH |

### `test_pass_no_framebuffer`
| | |
|---|---|
| **Tests** | Display resolution passes on non-Pi (no framebuffer device) |
| **Method** | Mock os.path.exists to return False for framebuffer |
| **Pass** | Status.PASS, framebuffer=False |

### `test_pass_correct_resolution`
| | |
|---|---|
| **Tests** | Probe passes when display is 1024x600 (expected for POS Pi) |
| **Method** | Create mock framebuffer virtual_size file with 1024,600 |
| **Pass** | Status.PASS, width=1024, height=600 |

### `test_warn_wrong_resolution`
| | |
|---|---|
| **Tests** | Probe warns when display is wrong resolution (1920x1080 instead of 1024x600) |
| **Method** | Mock framebuffer with 1920,1080 |
| **Pass** | Status.WARN, message contains '1920x1080' |

### `test_category_is_high` (display_resolution)
| | |
|---|---|
| **Tests** | Display resolution is HIGH category |
| **Method** | Direct call |
| **Pass** | result.category == Category.HIGH |

### `test_pass_no_db`
| | |
|---|---|
| **Tests** | Entomology heartbeat passes when diagnostic DB missing |
| **Method** | Probe with missing DB |
| **Pass** | Status.PASS |

### `test_pass_with_events`
| | |
|---|---|
| **Tests** | Probe passes when diagnostic events are present |
| **Method** | Create diagnostic DB with one event, run probe |
| **Pass** | Status.PASS, event_count=1 |

### `test_category_is_low`
| | |
|---|---|
| **Tests** | Entomology heartbeat is LOW category |
| **Method** | Direct call |
| **Pass** | result.category == Category.LOW |

### `test_pass_no_interfaces`
| | |
|---|---|
| **Tests** | Network interface probe passes on non-Pi (no eth0/wlan0) |
| **Method** | Mock os.path.exists to return False |
| **Pass** | Status.PASS, has_ip=False |

### `test_category_is_low` (network_interface)
| | |
|---|---|
| **Tests** | Network interface is LOW category |
| **Method** | Direct call |
| **Pass** | result.category == Category.LOW |

### `test_pass_no_db` (last_boot_result)
| | |
|---|---|
| **Tests** | Last boot result passes when no diagnostic DB (first boot) |
| **Method** | Probe with missing DB |
| **Pass** | Status.PASS, previous_boot=None |

### `test_pass_previous_clean`
| | |
|---|---|
| **Tests** | Probe passes when last boot was successful (all PASS, no failures) |
| **Method** | Create boot_summary with outcome='READY', passed=5, warned=0, failed=0 |
| **Pass** | Status.PASS |

### `test_warn_previous_failures`
| | |
|---|---|
| **Tests** | Probe warns when previous boot had failures |
| **Method** | Create boot_summary with failed=2, outcome='BLOCKED' |
| **Pass** | Status.WARN, message contains '2 failure(s)' |

### `test_category_is_low` (last_boot_result)
| | |
|---|---|
| **Tests** | Last boot result is LOW category |
| **Method** | Direct call |
| **Pass** | result.category == Category.LOW |

### `test_pass_no_ledger`
| | |
|---|---|
| **Tests** | Uptime probe passes when event ledger missing (fresh system) |
| **Method** | Probe with missing DB |
| **Pass** | Status.PASS |

### `test_pass_recent_close`
| | |
|---|---|
| **Tests** | Probe passes when last DAY_CLOSED was <48 hours ago |
| **Method** | Insert DAY_CLOSED event 2 hours ago, run probe |
| **Pass** | Status.PASS, hours_since_close < 48 |

### `test_warn_long_offline`
| | |
|---|---|
| **Tests** | Probe warns when terminal hasn't closed day for 72 hours |
| **Method** | Insert DAY_CLOSED event 72 hours ago |
| **Pass** | Status.WARN, message contains '72' or 'hours' |

### `test_pass_no_close_events`
| | |
|---|---|
| **Tests** | Probe passes when no DAY_CLOSED events exist (first day) |
| **Method** | Create empty event ledger, run probe |
| **Pass** | Status.PASS |

### `test_category_is_low` (uptime_since_last_close)
| | |
|---|---|
| **Tests** | Uptime is LOW category |
| **Method** | Direct call |
| **Pass** | result.category == Category.LOW |

## `test_kindnostic_runner.py`
> Validates probe discovery, execution ordering, timeout enforcement, exception handling, and end-to-end pipeline with storage

### `test_discover_finds_dummy_probe`
| | |
|---|---|
| **Tests** | discover_probes returns list including probe_dummy |
| **Method** | Direct discovery scan |
| **Pass** | 'probe_dummy' in names |

### `test_discover_returns_category`
| | |
|---|---|
| **Tests** | Each discovered probe includes its Category |
| **Method** | Scan results for probe_dummy entry |
| **Pass** | probe_dummy has category == Category.LOW |

### `test_dummy_probe_returns_pass`
| | |
|---|---|
| **Tests** | run_probe executes a probe and returns (result, duration_ms) |
| **Method** | Direct probe execution |
| **Pass** | result.status == Status.PASS, duration_ms >= 0 |

### `test_critical_timeout_produces_fail`
| | |
|---|---|
| **Tests** | CRITICAL probe timing out becomes FAIL (not WARN) |
| **Method** | Mock slow probe, run with 0.1s timeout |
| **Pass** | result.status == Status.FAIL, message contains 'timed out' |

### `test_high_timeout_produces_warn`
| | |
|---|---|
| **Tests** | HIGH probe timing out becomes WARN (not FAIL) |
| **Method** | Mock slow probe, run with 0.1s timeout |
| **Pass** | result.status == Status.WARN, message contains 'timed out' |

### `test_low_timeout_produces_warn`
| | |
|---|---|
| **Tests** | LOW probe timing out becomes WARN |
| **Method** | Mock slow probe, run with 0.1s timeout |
| **Pass** | result.status == Status.WARN |

### `test_probe_exception_produces_fail`
| | |
|---|---|
| **Tests** | Uncaught exception in probe becomes FAIL |
| **Method** | Mock probe that raises RuntimeError |
| **Pass** | result.status == Status.FAIL, message contains exception text |

### `test_discover_probes_returns_sorted`
| | |
|---|---|
| **Tests** | Discovered probes are sorted by Category (CRITICAL, HIGH, LOW) |
| **Method** | Direct discovery call |
| **Pass** | categories == sorted(categories) |

### `test_run_all_returns_zero_with_dummy`
| | |
|---|---|
| **Tests** | Full run_all pipeline returns exit code 0 (ready to boot) |
| **Method** | Execute runner's main entry point |
| **Pass** | exit_code == 0 |

### `test_run_all_writes_to_storage`
| | |
|---|---|
| **Tests** | run_all persists boot summary and per-probe results to DB |
| **Method** | Execute run_all, query boot_results and boot_summary tables |
| **Pass** | summary is not None, summary.outcome='READY', total_probes >= 1, results >= 1 |

### `test_critical_fail_returns_one`
| | |
|---|---|
| **Tests** | A failed CRITICAL probe blocks boot (exit code 1, outcome BLOCKED) |
| **Method** | Mock a failing CRITICAL probe, execute run_all |
| **Pass** | exit_code == 1, summary.outcome='BLOCKED' |

### `test_high_fail_returns_zero`
| | |
|---|---|
| **Tests** | A failed HIGH probe does not block boot (exit code still 0) |
| **Method** | Mock a failing HIGH probe, execute run_all |
| **Pass** | exit_code == 0 |

## `test_kindnostic_session4.py`
> Entomology integration, boot history, probe trends, and alert queue

### `test_get_boot_history_empty`
| | |
|---|---|
| **Tests** | Boot history is empty when no boots recorded |
| **Method** | Query BootStorage on fresh DB |
| **Pass** | get_boot_history() == [] |

### `test_get_boot_history_returns_recent_first`
| | |
|---|---|
| **Tests** | Boot history is ordered most recent first |
| **Method** | Record 5 boots, query with n=3 |
| **Pass** | len(history)==3, history[0].boot_id='boot-4', history[2].boot_id='boot-2' |

### `test_get_boot_history_respects_limit`
| | |
|---|---|
| **Tests** | Boot history respects limit parameter |
| **Method** | Record 10 boots, query with n=5 |
| **Pass** | len(history) == 5 |

### `test_get_probe_trend_empty`
| | |
|---|---|
| **Tests** | Probe trend is empty when no results recorded |
| **Method** | Query BootStorage |
| **Pass** | get_probe_trend('dummy') == [] |

### `test_get_probe_trend_returns_history`
| | |
|---|---|
| **Tests** | Probe trend shows all boots for a given probe (most recent first) |
| **Method** | Record 5 results for receipt_printer_reachable, alternating PASS/WARN |
| **Pass** | len(trend)==5, trend[0].boot_id='boot-4' |

### `test_get_probe_trend_filters_by_name`
| | |
|---|---|
| **Tests** | Trend query filters by exact probe name |
| **Method** | Record results for two different probes, query each |
| **Pass** | dummy_trend has 1 entry, chain_trend has 1 entry, no cross-contamination |

### `test_writes_boot_diagnostic_event`
| | |
|---|---|
| **Tests** | write_boot_diagnostic emits one diagnostic event per boot |
| **Method** | Call write_boot_diagnostic with 2 probe results, query diagnostic_events table |
| **Pass** | diagnostic_id is non-empty, event exists in DB |

### `test_event_has_correct_fields`
| | |
|---|---|
| **Tests** | BOOT_DIAGNOSTIC event contains correct category, severity, code, context |
| **Method** | Emit boot diagnostic with a CRITICAL FAIL, query event |
| **Pass** | category='SYSTEM', severity='CRITICAL', code='SYS-BOOT-DIAG', context.failed=1 |

### `test_severity_info_for_clean_boot`
| | |
|---|---|
| **Tests** | Boot outcome READY yields severity=INFO |
| **Method** | write_boot_diagnostic with one PASS result |
| **Pass** | severity='INFO' |

### `test_severity_warning_for_warns`
| | |
|---|---|
| **Tests** | Boot outcome READY with a WARN probe yields severity=WARNING |
| **Method** | write_boot_diagnostic with one WARN result |
| **Pass** | severity='WARNING' |

### `test_hash_chain_is_valid`
| | |
|---|---|
| **Tests** | Multiple BOOT_DIAGNOSTIC events form a valid hash chain (prev_hash links) |
| **Method** | Emit 3 diagnostics, query all, verify each stored_prev == computed prev_hash |
| **Pass** | Chain is contiguous, checksums recompute correctly, no broken links |

### `test_independent_from_event_ledger`
| | |
|---|---|
| **Tests** | Diagnostic chain starts with GENESIS_HASH, not event ledger checksum |
| **Method** | Query first diagnostic event's prev_hash |
| **Pass** | prev_hash == GENESIS_HASH |

### `test_no_alert_when_all_pass`
| | |
|---|---|
| **Tests** | AlertQueue does not enqueue when all probes pass |
| **Method** | Call enqueue with all PASS results |
| **Pass** | alert_id is None |

### `test_enqueues_on_critical_fail`
| | |
|---|---|
| **Tests** | AlertQueue enqueues when CRITICAL probe fails |
| **Method** | Call enqueue with CRITICAL FAIL result |
| **Pass** | alert_id is not None, severity='CRITICAL', summary contains probe code |

### `test_enqueues_on_high_warn`
| | |
|---|---|
| **Tests** | AlertQueue enqueues when HIGH probe warns |
| **Method** | Call enqueue with HIGH WARN result |
| **Pass** | alert_id is not None, severity='WARNING' |

### `test_mark_sent`
| | |
|---|---|
| **Tests** | mark_sent removes alert from unsent queue |
| **Method** | Enqueue alert, mark_sent, query unsent |
| **Pass** | len(unsent)==0 after marking |

### `test_increment_attempts`
| | |
|---|---|
| **Tests** | increment_attempts increments retry counter |
| **Method** | Enqueue, increment twice, query |
| **Pass** | unsent[0].attempts == 2 |

### `test_flush_no_webhook_returns_zero`
| | |
|---|---|
| **Tests** | flush with no webhook_url parameter does not send alerts |
| **Method** | Enqueue alert, call flush() without webhook_url |
| **Pass** | sent == 0 |

### `test_flush_sends_and_marks`
| | |
|---|---|
| **Tests** | flush with webhook_url sends queued alerts and marks them sent |
| **Method** | Enqueue alert, mock HTTP POST to succeed, flush with URL |
| **Pass** | sent==1, unsent==[] after |

### `test_flush_handles_network_error`
| | |
|---|---|
| **Tests** | flush gracefully handles network failure (OSError) |
| **Method** | Enqueue alert, mock urlopen to raise OSError, flush |
| **Pass** | sent==0, unsent==1, attempts incremented |

### `test_run_all_writes_entomology_event`
| | |
|---|---|
| **Tests** | Full run_all execution writes BOOT_DIAGNOSTIC to diagnostic_events |
| **Method** | Execute run_all, query diagnostic_events for SYS-BOOT-DIAG |
| **Pass** | 1 BOOT_DIAGNOSTIC event present |

### `test_run_all_creates_alert_queue_table`
| | |
|---|---|
| **Tests** | run_all initializes alert_queue table |
| **Method** | Execute run_all, query sqlite_master for alert_queue table |
| **Pass** | alert_queue table exists |

## `test_kindnostic_storage.py`
> Validates BootStorage: table creation, record_result, record_summary, get_last_boot_summary, WAL mode, and data persistence

### `test_tables_created_on_connect`
| | |
|---|---|
| **Tests** | BootStorage context manager creates boot_results and boot_summary tables |
| **Method** | Connect, query sqlite_master |
| **Pass** | boot_results and boot_summary in table names |

### `test_wal_mode_enabled`
| | |
|---|---|
| **Tests** | SQLite WAL mode is enabled (durability + concurrency) |
| **Method** | Query PRAGMA journal_mode |
| **Pass** | mode == 'wal' |

### `test_record_result_inserts`
| | |
|---|---|
| **Tests** | record_result inserts a probe result row |
| **Method** | Insert one result, query boot_results |
| **Pass** | 1 row exists with correct boot_id, probe_name, status, duration_ms |

### `test_record_summary_and_get_last`
| | |
|---|---|
| **Tests** | record_summary and get_last_boot_summary roundtrip correctly |
| **Method** | Record summary, query |
| **Pass** | Retrieved summary has correct boot_id, passed, warned, failed, outcome |

### `test_get_last_summary_returns_most_recent`
| | |
|---|---|
| **Tests** | get_last_boot_summary returns the latest boot (by insertion order) |
| **Method** | Record boot-old then boot-new, query |
| **Pass** | summary.boot_id=='boot-new', outcome=='BLOCKED' |

### `test_get_last_summary_empty_db`
| | |
|---|---|
| **Tests** | get_last_boot_summary returns None on empty DB |
| **Method** | Query on fresh DB |
| **Pass** | result is None |

### `test_data_survives_reconnect`
| | |
|---|---|
| **Tests** | Data written in one BootStorage session persists across reconnect |
| **Method** | Write summary, close, reopen, query |
| **Pass** | Data is still present and correct |

## `test_kindnostic_support_codes.py`
> Validates support code format, known probe mappings, and fallback behavior

### `test_code_format_matches_pattern`
| | |
|---|---|
| **Tests** | Support code matches regex ^KN-[A-Z]{2}-\d{4}$ |
| **Method** | Generate code for arbitrary probe |
| **Pass** | Code matches pattern |

### `test_known_probe_codes`
| | |
|---|---|
| **Tests** | All known probes map to their expected 2-letter prefixes |
| **Method** | Generate code for each CRITICAL/HIGH/LOW probe |
| **Pass** | Each starts with correct KN-XX- prefix (HC, PG, DI, DW, SV, RP, KP, SD, CK, DR, DU) |

### `test_unknown_probe_falls_back`
| | |
|---|---|
| **Tests** | Unknown probe name generates code using first two letters (KN-MY-) |
| **Method** | Generate code for 'mystery_probe' |
| **Pass** | Starts with 'KN-MY-' |

### `test_mmdd_matches_today`
| | |
|---|---|
| **Tests** | Code MMDD suffix matches current date |
| **Method** | Generate code, extract MMDD, compare to today |
| **Pass** | MMDD == datetime.now().strftime('%m%d') |

### `test_register_custom_probe`
| | |
|---|---|
| **Tests** | register_probe adds custom probe to mapping |
| **Method** | Register 'custom_check' with 'CC', generate code |
| **Pass** | Code starts with 'KN-CC-' |

## `test_kindnostic_types.py`
> Validates Status enum, Category enum (with ordering), and ProbeResult dataclass

### `test_status_has_three_members`
| | |
|---|---|
| **Tests** | Status enum has exactly PASS, WARN, FAIL members |
| **Method** | Check set of Status members |
| **Pass** | set(Status) == {PASS, WARN, FAIL} |

### `test_status_values`
| | |
|---|---|
| **Tests** | Status values are string representations |
| **Method** | Check .value of each member |
| **Pass** | PASS.value=='PASS', WARN.value=='WARN', FAIL.value=='FAIL' |

### `test_status_is_str`
| | |
|---|---|
| **Tests** | Status is a StrEnum (inherits from str) |
| **Method** | isinstance check, equality with string |
| **Pass** | isinstance(Status.PASS, str), Status.PASS == 'PASS' |

### `test_category_has_three_members`
| | |
|---|---|
| **Tests** | Category enum has CRITICAL, HIGH, LOW members |
| **Method** | Check set of members |
| **Pass** | set(Category) == {CRITICAL, HIGH, LOW} |

### `test_category_values`
| | |
|---|---|
| **Tests** | Category values are string representations |
| **Method** | Check .value |
| **Pass** | CRITICAL.value=='CRITICAL', HIGH.value=='HIGH', LOW.value=='LOW' |

### `test_category_is_str`
| | |
|---|---|
| **Tests** | Category is a StrEnum |
| **Method** | isinstance check |
| **Pass** | isinstance(Category.CRITICAL, str), Category.CRITICAL == 'CRITICAL' |

### `test_category_ordering_lt`
| | |
|---|---|
| **Tests** | Category < operator is well-defined (CRITICAL < HIGH < LOW) |
| **Method** | Compare pairs with < |
| **Pass** | CRITICAL < HIGH, HIGH < LOW, CRITICAL < LOW |

### `test_category_ordering_gt`
| | |
|---|---|
| **Tests** | Category > operator works correctly |
| **Method** | Compare pairs with > |
| **Pass** | LOW > HIGH, HIGH > CRITICAL |

### `test_category_ordering_le_ge`
| | |
|---|---|
| **Tests** | Category <=, >= operators work |
| **Method** | Compare with <= and >= |
| **Pass** | CRITICAL <= CRITICAL, CRITICAL <= HIGH, LOW >= LOW, LOW >= HIGH |

### `test_category_sorted`
| | |
|---|---|
| **Tests** | sorted() on Category list respects ordering |
| **Method** | Sort [LOW, CRITICAL, HIGH] |
| **Pass** | sorted == [CRITICAL, HIGH, LOW] |

### `test_probe_result_fields`
| | |
|---|---|
| **Tests** | ProbeResult dataclass fields round-trip correctly |
| **Method** | Create ProbeResult with all fields, verify retrieval |
| **Pass** | All fields have expected values |

### `test_probe_result_defaults`
| | |
|---|---|
| **Tests** | ProbeResult defaults message=None, metadata=None |
| **Method** | Create with only required fields |
| **Pass** | message is None, metadata is None |

### `test_probe_result_frozen`
| | |
|---|---|
| **Tests** | ProbeResult is immutable (frozen dataclass) |
| **Method** | Try to mutate status field |
| **Pass** | FrozenInstanceError raised |

## `test_labor_summary.py`
> Tests for labor reporting (GET /reports/labor-summary, GET /reports/hourly-compare)

### `test_single_clocked_in_employee`
| | |
|---|---|
| **Tests** | Single clocked-in employee surfaces with hours > 0 and clocked_in status |
| **Method** | Emit USER_LOGGED_IN (120 min ago), call get_labor_summary |
| **Pass** | 1 employee, hours 1.9-2.1, clock_out is None |

### `test_clocked_in_and_out_records_correct_hours`
| | |
|---|---|
| **Tests** | LOGIN then LOGOUT yields finite hours, records clock_in and clock_out |
| **Method** | Emit LOGIN (90 min ago) + LOGOUT now, call route |
| **Pass** | hours 1.4-1.6, both clock_in and clock_out non-None |

### `test_wage_math_with_hourly_rate`
| | |
|---|---|
| **Tests** | gross_pay = hours × hourly_rate; included in total_labor |
| **Method** | Seed employee with $18/hr, clock in/out 60 min, check math |
| **Pass** | gross_pay == hours × $18, total_labor == gross_pay |

### `test_missing_rate_uses_zero_not_fabricated_default`
| | |
|---|---|
| **Tests** | Employee without EMPLOYEE_CREATED event contributes $0 labor (not $15 fabricated default) |
| **Method** | Clock in/out employee with no rate event |
| **Pass** | hourly_rate=$0, gross_pay=$0 |

### `test_net_sales_surfaces_alongside_labor`
| | |
|---|---|
| **Tests** | Labor summary exposes daily net_sales as denominator for Labor % KPI |
| **Method** | Clock in employee, create order with $42 sale, call route |
| **Pass** | net_sales == $42 |

### `test_tips_attributed_to_server`
| | |
|---|---|
| **Tests** | TIP_ADJUSTED events on a server's orders flow into their tips field |
| **Method** | Create order for emp_F, add $3 tip via TIP_ADJUSTED |
| **Pass** | emp.tips==$3, card_tips_total==$3 |

### `test_empty_day_has_no_employees_no_crash`
| | |
|---|---|
| **Tests** | With zero events, endpoint returns valid empty payload |
| **Method** | Call get_labor_summary on empty ledger |
| **Pass** | employees==[], total_hours==$0, total_labor==$0 |

### `test_ot_buffer_and_status_under_warning_threshold`
| | |
|---|---|
| **Tests** | Server view: under 35 hours weekly → ot_status='ok', buffer = 40 - weekly |
| **Method** | Clock in ~1 hour, call server-view route |
| **Pass** | ot_status=='ok', ot_buffer ≈ 40 - weekly_hours |

### `test_clock_in_out_strings_formatted_HHMM`
| | |
|---|---|
| **Tests** | Server view returns HH:MM strings for clock times |
| **Method** | Clock in/out, call server view |
| **Pass** | clock_in length==5, format HH:MM; clock_out non-None |

### `test_hourly_net_subtracts_discount`
| | |
|---|---|
| **Tests** | _hourly_for_date subtracts discounts from net_sales (not gross subtotal) |
| **Method** | Create order subtotal=$30, discount=$5, call _hourly_for_date |
| **Pass** | Hourly net_sales sum == $25 |

### `test_voided_orders_excluded_from_hourly`
| | |
|---|---|
| **Tests** | Voided orders contribute zero to hourly series |
| **Method** | Create order $99, emit ORDER_VOIDED, call _hourly_for_date |
| **Pass** | Hourly sum == $0 |

### `test_hourly_empty_range_returns_zero_per_hour`
| | |
|---|---|
| **Tests** | With no orders, every configured hour has net_sales=0 (never None) |
| **Method** | Call _hourly_for_date on empty ledger, open_hour=11, close_hour=14 |
| **Pass** | 4 hours returned, all have net_sales=$0, all have 'hour' field |

### `test_hourly_compare_router_returns_today_and_last_week`
| | |
|---|---|
| **Tests** | hourly_compare endpoint returns both today and last_week arrays |
| **Method** | Call hourly_compare(date=TODAY) |
| **Pass** | Result has 'today' (list) and 'last_week' (list) keys |

## `test_ledger_concurrency.py`
> Stress tests for EventLedger concurrency: unique sequence numbers, hash chain integrity, idempotency, atomicity

### `test_50_concurrent_appends_get_unique_sequence_numbers`
| | |
|---|---|
| **Tests** | 50 concurrent appends via asyncio.gather produce unique seq numbers 1-50 |
| **Method** | Fire 50 appends concurrently, collect sequence_numbers |
| **Pass** | len(seqs)==50, len(set(seqs))==50, min==1, max==50 |

### `test_sequence_numbers_are_contiguous`
| | |
|---|---|
| **Tests** | Sequence numbers form a contiguous sequence (no gaps) |
| **Method** | Append 30 events concurrently, sort seqs, verify a[i+1]==a[i]+1 |
| **Pass** | No gaps between consecutive sequence numbers |

### `test_hash_chain_holds_under_concurrent_load`
| | |
|---|---|
| **Tests** | After 40 concurrent appends, hash chain is valid (previous_checksum links, checksums recompute) |
| **Method** | Append 40, replay chain, verify prev links and checksum recomputes |
| **Pass** | All previous_checksum fields match chain links, all checksums verify |

### `test_same_key_hammered_concurrently_stores_exactly_once`
| | |
|---|---|
| **Tests** | 10 parallel appends with same idempotency_key: one winner, 9 return None |
| **Method** | Fire 10 appends with shared key via gather() |
| **Pass** | 1 non-None result, 9 None results, ledger has exactly 1 event |

### `test_distinct_keys_all_succeed`
| | |
|---|---|
| **Tests** | No collision → all 15 appends succeed |
| **Method** | Fire 15 appends, each with distinct idempotency_key |
| **Pass** | 15 non-None winners |

### `test_batch_appends_contiguous_sequence_numbers`
| | |
|---|---|
| **Tests** | append_batch(10 events) receives seqs [1..10] in order |
| **Method** | Call append_batch, check results |
| **Pass** | seqs == [1, 2, ..., 10] |

### `test_batch_rejects_any_non_2dp_monetary_event_before_writing`
| | |
|---|---|
| **Tests** | Precision gate runs on batch *before* INSERT; one bad row prevents all writes |
| **Method** | Batch [good_event, bad_3dp_price], append_batch raises |
| **Pass** | ValueError raised, ledger count == 0 (not 1) |

### `test_append_and_append_batch_interleaved`
| | |
|---|---|
| **Tests** | Mix singles + batch under concurrent load: all unique contiguous seqs, valid chain |
| **Method** | Fire 10 singles + 2 batches of 5 concurrently (20 events total) |
| **Pass** | seqs == [1..20], chain is valid |

### `test_unsynced_events_include_every_append`
| | |
|---|---|
| **Tests** | get_unsynced_events returns all newly appended events |
| **Method** | Append 5, query unsynced |
| **Pass** | len(unsynced)==5 |

### `test_mark_synced_removes_from_unsynced`
| | |
|---|---|
| **Tests** | mark_synced([event_ids]) removes them from unsynced query |
| **Method** | Append 3, sync first 2, query |
| **Pass** | Only 1 event remains in unsynced |

## `test_ledger_crash_recovery.py`
> Verifies SQLite WAL-based recovery: uncommitted events discarded, committed events survive, hash chain valid after recovery

### `test_uncommitted_event_not_present_after_crash`
| | |
|---|---|
| **Tests** | Append event 1 (succeeds), event 2 (commit fails), reopen DB: only event 1 survives |
| **Method** | Append event 0, patch commit to raise, append event 1 (fails), reopen |
| **Pass** | count==1, chain valid |

### `test_committed_events_survive_crash`
| | |
|---|---|
| **Tests** | Write 10 events, close (simulates crash), reopen: all 10 intact |
| **Method** | Append 10, close context, reopen context |
| **Pass** | count==10, chain valid |

### `test_next_write_after_failed_write_has_correct_hash`
| | |
|---|---|
| **Tests** | After failed write, next successful write chains from last committed (no sequence gap) |
| **Method** | Append event 0 (ok), event 1 (commit fails), rollback, append event 2 (ok) |
| **Pass** | count==2, event 2 previous_checksum == event 0 checksum, no gap |

### `test_verify_chain_after_unclean_shutdown`
| | |
|---|---|
| **Tests** | Write events, force unclean close (no graceful shutdown), reopen: WAL recovery restores chain |
| **Method** | Append 5, directly close connection (no graceful shutdown), reopen |
| **Pass** | count==5, chain valid |

## `test_ledger_robustness.py`
> Covers idempotency, append_batch atomicity, hash-chain verification, day-boundary mechanics, get_events_by_type filtering

### `test_idempotency_duplicate_append_returns_none`
| | |
|---|---|
| **Tests** | Second event with same idempotency_key is blocked; append returns None |
| **Method** | Append evt1, then evt2 (same idem key) |
| **Pass** | first is not None, second is None |

### `test_idempotency_no_duplicate_row`
| | |
|---|---|
| **Tests** | After blocked duplicate, only one event with that key in store |
| **Method** | Append evt1, evt2 (blocked), count ORDER_CREATED |
| **Pass** | count==1 |

### `test_idempotency_lookup_by_key`
| | |
|---|---|
| **Tests** | get_event_by_idempotency_key returns stored event for that key |
| **Method** | Append event, fetch by key |
| **Pass** | Fetched event has correct sequence_number and event_type |

### `test_append_batch_all_events_inserted`
| | |
|---|---|
| **Tests** | append_batch inserts every event atomically |
| **Method** | Batch 3 events, check results and ledger count |
| **Pass** | len(results)==3, all non-None, count==3 |

### `test_append_batch_sequence_numbers_are_monotonic`
| | |
|---|---|
| **Tests** | Batch events have strictly increasing, unique sequence numbers |
| **Method** | Batch 2 events, check seqs |
| **Pass** | seqs == sorted(seqs), all unique |

### `test_verify_chain_clean_ledger`
| | |
|---|---|
| **Tests** | Fresh ledger passes verify_chain |
| **Method** | Append 5, verify |
| **Pass** | valid==True, invalid_seq==None |

### `test_verify_chain_detects_corruption`
| | |
|---|---|
| **Tests** | Manually overwriting checksum is detected by verify_chain |
| **Method** | Append 2, tamper with seq 2 checksum, reopen, verify |
| **Pass** | valid==False, invalid_seq is not None |

### `test_get_last_day_close_sequence_starts_at_zero`
| | |
|---|---|
| **Tests** | Before any DAY_CLOSED event, boundary == 0 |
| **Method** | Query on fresh ledger |
| **Pass** | boundary==0 |

### `test_get_last_day_close_sequence_after_close`
| | |
|---|---|
| **Tests** | After DAY_CLOSED, boundary equals its sequence number |
| **Method** | Append 2 events, DAY_CLOSED, query |
| **Pass** | boundary == close_evt.sequence_number |

### `test_get_events_since_boundary_excludes_pre_close`
| | |
|---|---|
| **Tests** | get_events_since(boundary) returns only events AFTER boundary |
| **Method** | Create day 1 events, close, create day 2 events, query since boundary |
| **Pass** | Only day 2 events appear |

### `test_get_events_by_type_filters_correctly`
| | |
|---|---|
| **Tests** | get_events_by_type filters to exact type |
| **Method** | Append 2 ORDER_CREATED + 1 ITEM_ADDED, query each |
| **Pass** | order_events==2, item_events==1 |

### `test_count_events_reflects_appends`
| | |
|---|---|
| **Tests** | count_events returns actual event count |
| **Method** | Append 3 events, count |
| **Pass** | count==3 |

## `test_menu_projection.py`
> Tests for menu projection — building MenuState from event streams

### `test_empty_events`
| | |
|---|---|
| **Tests** | Projecting empty event list yields empty MenuState |
| **Method** | project_menu([]) |
| **Pass** | categories==[], items==[] |

### `test_batch_categories`
| | |
|---|---|
| **Tests** | CATEGORIES_BATCH_CREATED event populates categories |
| **Method** | Emit batch with 2 categories |
| **Pass** | len(categories)==2, categories[0].name=='Appetizers' |

### `test_batch_items`
| | |
|---|---|
| **Tests** | ITEMS_BATCH_CREATED event populates items |
| **Method** | Emit batch with 2 items |
| **Pass** | len(items)==2 |

### `test_restaurant_configured`
| | |
|---|---|
| **Tests** | RESTAURANT_CONFIGURED event sets restaurant metadata |
| **Method** | Emit event with name and address |
| **Pass** | state.restaurant.restaurant_name=='Test Grill' |

### `test_modern_category_created`
| | |
|---|---|
| **Tests** | MENU_CATEGORY_CREATED adds category |
| **Method** | Emit event |
| **Pass** | len(categories)==1, name=='Desserts' |

### `test_modern_item_created`
| | |
|---|---|
| **Tests** | MENU_ITEM_CREATED adds item |
| **Method** | Emit event |
| **Pass** | len(items)==1, name=='Cake' |

### `test_item_updated`
| | |
|---|---|
| **Tests** | MENU_ITEM_UPDATED replaces item fields |
| **Method** | CREATE + UPDATE with new price |
| **Pass** | items[0].price==14.00 |

### `test_item_deleted`
| | |
|---|---|
| **Tests** | MENU_ITEM_DELETED removes item |
| **Method** | CREATE + DELETE |
| **Pass** | items==[] |

### `test_category_updated`
| | |
|---|---|
| **Tests** | MENU_CATEGORY_UPDATED replaces category |
| **Method** | CREATE + UPDATE with new name |
| **Pass** | categories[0].name=='Appetizers' |

### `test_category_deleted`
| | |
|---|---|
| **Tests** | MENU_CATEGORY_DELETED removes category |
| **Method** | CREATE + DELETE |
| **Pass** | categories==[] |

### `test_category_deleted_orphans_items_without_removing_them`
| | |
|---|---|
| **Tests** | Deleting a category doesn't auto-delete its items |
| **Method** | CREATE category, CREATE item in it, DELETE category |
| **Pass** | categories==[], items==1 |

### `test_items_by_category`
| | |
|---|---|
| **Tests** | items_by_category groups items by category field |
| **Method** | Create 3 items: 2 Entrees, 1 Sides |
| **Pass** | items_by_category['Entrees']==2, items_by_category['Sides']==1 |

### `test_modifier_group_lifecycle`
| | |
|---|---|
| **Tests** | MODIFIER_GROUP_CREATED/UPDATED/DELETED work end-to-end |
| **Method** | CREATE, UPDATE, DELETE modifier groups |
| **Pass** | Final state has 0 modifier groups |

### `test_category_sort_order`
| | |
|---|---|
| **Tests** | Categories are sorted by display_order (not insertion order) |
| **Method** | CREATE categories with display_order 30, 10, 20 (in that order) |
| **Pass** | Returned order is Apps (10), Entrees (20), Desserts (30) |

### `test_86_flag_carries_through`
| | |
|---|---|
| **Tests** | MENU_ITEM_86D sets is_86ed=True on existing item |
| **Method** | CREATE item, 86D it |
| **Pass** | items[0].is_86ed==True |

### `test_restore_clears_86`
| | |
|---|---|
| **Tests** | MENU_ITEM_RESTORED clears is_86ed back to False |
| **Method** | CREATE, 86D, RESTORED |
| **Pass** | items[0].is_86ed==False |

### `test_86_on_unknown_item_is_noop`
| | |
|---|---|
| **Tests** | 86ing nonexistent item doesn't create phantom record |
| **Method** | Emit MENU_ITEM_86D for item_id that doesn't exist |
| **Pass** | items==[] |

## `test_money_round.py`
> Tests for app.core.money.money_round() — ROUND_HALF_UP to 2 decimal places

### `test_rounds_half_up`
| | |
|---|---|
| **Tests** | Rounding half-up: 0.005→0.01, 0.015→0.02, 10.005→10.01 |
| **Method** | Direct call to money_round |
| **Pass** | Values match expected Decimal with ROUND_HALF_UP |

### `test_exact_values_unchanged`
| | |
|---|---|
| **Tests** | Already-2dp values pass through unchanged |
| **Method** | money_round on 1.00, 10.50, 99.99 |
| **Pass** | Values match exactly |

### `test_zero`
| | |
|---|---|
| **Tests** | Zero in any form rounds to 0.00 |
| **Method** | money_round(0), money_round(0.0), money_round(0.00) |
| **Pass** | All == Decimal('0.00') |

### `test_negative_values`
| | |
|---|---|
| **Tests** | Negative values round with HALF_UP (magnitude rounds up) |
| **Method** | money_round(-1.005), money_round(-10.50) |
| **Pass** | -1.005→-1.01, -10.50→-10.50 |

### `test_integers`
| | |
|---|---|
| **Tests** | Integers become 2dp Decimals |
| **Method** | money_round(5), money_round(100) |
| **Pass** | Both == Decimal with .00 |

### `test_many_decimals`
| | |
|---|---|
| **Tests** | Many decimal places truncate correctly |
| **Method** | money_round(10.3333333), money_round(2.6666666) |
| **Pass** | 10.33, 2.67 |

### `test_float_precision_trap`
| | |
|---|---|
| **Tests** | Float precision handled: 2.675 (IEEE→2.67499...) becomes 2.68 via Decimal(str()) |
| **Method** | money_round(2.675) |
| **Pass** | == Decimal('2.68') |

### `test_large_amounts`
| | |
|---|---|
| **Tests** | Large amounts round correctly |
| **Method** | money_round(99999.99), money_round(100000.005) |
| **Pass** | 99999.99, 100000.01 |

### `test_very_small`
| | |
|---|---|
| **Tests** | Sub-1cp amounts: 0.001→0.00, 0.009→0.01 |
| **Method** | Direct calls |
| **Pass** | Values match |

## `test_new_shift_routes.py`
> Tests for server shift routes: finalize_checkout and transfer_shift_order

### `test_finalize_checkout_route`
| | |
|---|---|
| **Tests** | finalize_checkout endpoint returns success=True |
| **Method** | Direct route handler call with request |
| **Pass** | response == {"success": True} |

### `test_transfer_route`
| | |
|---|---|
| **Tests** | transfer_shift_order emits ORDER_TRANSFERRED event |
| **Method** | Call route, query events |
| **Pass** | ORDER_TRANSFERRED event exists with correct order_id and server_id |

## `test_orders_and_reporting_gaps.py`
> Coverage for close_batch, close_day, void_order guards, and sales summary reporting

### `test_close_batch_fully_paid_order_gets_closed`
| | |
|---|---|
| **Tests** | close_batch emits ORDER_CLOSED for fully-paid open order |
| **Method** | Seed paid order, call close_batch |
| **Pass** | success=True, orders_closed_now >= 1, order.status='closed' |

### `test_close_batch_unpaid_order_gets_voided`
| | |
|---|---|
| **Tests** | close_batch emits ORDER_VOIDED with 'batch close' reason for unpaid |
| **Method** | Seed unpaid order, call close_batch |
| **Pass** | success=True, ORDER_VOIDED event with reason containing 'batch close' |

### `test_close_batch_empty_day_returns_no_transactions_status`
| | |
|---|---|
| **Tests** | close_batch with no orders returns status='no_transactions' |
| **Method** | Call on empty ledger |
| **Pass** | success=True, status=='no_transactions' |

### `test_close_batch_mixed_orders`
| | |
|---|---|
| **Tests** | close_batch closes paid orders and voids unpaid ones independently |
| **Method** | Seed one paid, one unpaid, call close_batch |
| **Pass** | Paid→closed, unpaid→voided |

### `test_close_day_fully_paid_order_gets_closed`
| | |
|---|---|
| **Tests** | close_day emits ORDER_CLOSED for fully-paid order |
| **Method** | Seed paid order, call close_day |
| **Pass** | success=True, order.status='closed' |

### `test_close_day_unpaid_order_gets_voided`
| | |
|---|---|
| **Tests** | close_day emits ORDER_VOIDED with 'day close' reason |
| **Method** | Seed unpaid order, call close_day |
| **Pass** | ORDER_VOIDED with reason containing 'day close' |

### `test_close_day_emits_day_closed_event`
| | |
|---|---|
| **Tests** | close_day emits a DAY_CLOSED event as day boundary |
| **Method** | Call close_day, query for DAY_CLOSED events |
| **Pass** | len(DAY_CLOSED_events) >= 1 |

### `test_void_order_403_without_approved_by`
| | |
|---|---|
| **Tests** | void_order with empty approved_by raises HTTP 403 |
| **Method** | Call void_order(approved_by='') |
| **Pass** | HTTPException 403, detail contains 'approval' |

### `test_void_order_400_already_voided`
| | |
|---|---|
| **Tests** | Voiding an already-voided order raises HTTP 400 |
| **Method** | Void order twice |
| **Pass** | HTTPException 400, detail contains 'voided' |

### `test_void_order_400_already_closed`
| | |
|---|---|
| **Tests** | Voiding a closed order raises HTTP 400 |
| **Method** | Close order, try void |
| **Pass** | HTTPException 400, detail contains 'closed' |

### `test_void_order_happy_path_emits_order_voided`
| | |
|---|---|
| **Tests** | Voiding open order succeeds, emits ORDER_VOIDED |
| **Method** | Seed open order, void it |
| **Pass** | response.status='voided', ORDER_VOIDED event exists |

### `test_void_order_404_for_missing_order`
| | |
|---|---|
| **Tests** | Voiding nonexistent order raises HTTP 404 |
| **Method** | void_order on no-such-order |
| **Pass** | HTTPException 404 |

### `test_sales_summary_returns_expected_shape`
| | |
|---|---|
| **Tests** | GET /reports/sales-summary returns all required keys |
| **Method** | HTTP GET, check response JSON structure |
| **Pass** | All required keys present (date, net_sales, gross_sales, etc.) |

### `test_sales_summary_counts_closed_orders`
| | |
|---|---|
| **Tests** | Closed orders are counted in total_checks and net_sales |
| **Method** | Seed closed order $40, query summary |
| **Pass** | total_checks >= 1, net_sales >= $40 |

### `test_sales_summary_server_filter_isolates_one_server`
| | |
|---|---|
| **Tests** | ?server_id= filter returns only that server's orders |
| **Method** | Seed two servers with $30 and $50 orders, filter by server_id=srv-A |
| **Pass** | total_checks=1, net_sales==$30 |

### `test_sales_summary_empty_day_returns_zeros`
| | |
|---|---|
| **Tests** | Empty day aggregation returns zeros, not nulls or errors |
| **Method** | Query on empty ledger |
| **Pass** | total_checks=0, net_sales==$0, hourly_sales==[] |

### `test_tip_avg_includes_zero_tip_payments_in_denominator`
| | |
|---|---|
| **Tests** | Tip average correctly includes $0 tips: ($5+$0)/2 = $2.50 (not $5) |
| **Method** | Create two paid orders, one with $5 tip, one with no tip |
| **Pass** | tip_avg == $2.50 |

### `test_merge_target_closed_concurrently_returns_409`
| | |
|---|---|
| **Tests** | Merge detects race: target was open at validation, closed before write loop |
| **Method** | Validate target open, close it externally, merge fails |
| **Pass** | HTTPException 400 or 409 |

## `test_orders_mutations.py`
> Tests for order mutations: merge, discount, split_by_seat, split_evenly, void

### `test_merge_copies_items_and_voids_source`
| | |
|---|---|
| **Tests** | Merge copies source items to target (new item_ids), voids source |
| **Method** | Create target + source, merge_orders(target, [source]) |
| **Pass** | target.subtotal==$23, source.status='voided' |

### `test_merge_preserves_modifiers`
| | |
|---|---|
| **Tests** | Source modifiers' prices carry over in merge |
| **Method** | Merge order with modifier ($10 item + $3 mod) |
| **Pass** | target.subtotal==$18 ($5 + $10 + $3) |

### `test_merge_multiple_sources`
| | |
|---|---|
| **Tests** | Merge handles multiple source orders |
| **Method** | Merge 2 sources into target |
| **Pass** | target.subtotal==$6 ($1+$2+$3) |

### `test_merge_emits_check_merged_on_target_and_sources`
| | |
|---|---|
| **Tests** | Merge emits CHECK_MERGED event on target + each source with shared operation_id |
| **Method** | Merge, query CHECK_MERGED events |
| **Pass** | Target has 1 event (role='target'), each source has 1 (role='source'), all same operation_id |

### `test_merge_source_check_merged_precedes_void`
| | |
|---|---|
| **Tests** | Source timeline: ORDER_CREATED → CHECK_MERGED → ORDER_VOIDED (in order) |
| **Method** | Merge, query source events sorted by seq |
| **Pass** | merged_idx < void_idx |

### `test_merge_rejects_self`
| | |
|---|---|
| **Tests** | Cannot merge order into itself |
| **Method** | merge_orders(oSelf, [oSelf]) |
| **Pass** | HTTPException 400 |

### `test_merge_requires_manager_approval`
| | |
|---|---|
| **Tests** | Merge requires approved_by (non-empty) |
| **Method** | merge_orders with approved_by='' |
| **Pass** | HTTPException 403 |

### `test_merge_rejects_closed_source`
| | |
|---|---|
| **Tests** | Cannot merge a closed/paid source |
| **Method** | Close source order, try merge |
| **Pass** | HTTPException 400, detail contains 'only open orders' |

### `test_merge_rejects_source_with_confirmed_payment`
| | |
|---|---|
| **Tests** | Cannot merge source with confirmed-but-not-closed payment |
| **Method** | Create source with PAYMENT_CONFIRMED (no ORDER_CLOSED), merge |
| **Pass** | HTTPException 400 |

### `test_merge_target_must_be_open`
| | |
|---|---|
| **Tests** | Cannot merge into closed/voided target |
| **Method** | Close target, try merge |
| **Pass** | HTTPException 400 |

### `test_discount_reduces_total`
| | |
|---|---|
| **Tests** | Discount reduces order subtotal and total |
| **Method** | $30 order, $3 discount |
| **Pass** | subtotal==$27, discount_total==$3, total==$27 |

### `test_cannot_discount_closed_order`
| | |
|---|---|
| **Tests** | Cannot discount a closed order |
| **Method** | Close order, try apply_discount |
| **Pass** | HTTPException 400 |

### `test_discount_blocked_while_payment_pending`
| | |
|---|---|
| **Tests** | Cannot discount while PAYMENT_INITIATED but not CONFIRMED (card reader in progress) |
| **Method** | Emit PAYMENT_INITIATED (no CONFIRMED), try discount |
| **Pass** | HTTPException 400, detail contains 'pending' |

### `test_splits_items_into_per_seat_child_orders`
| | |
|---|---|
| **Tests** | split_by_seat creates child orders for each seat, moves items from parent |
| **Method** | Create parent with 2 seated items ($10, $20), split |
| **Pass** | 2 child orders, child1.subtotal==$10, child2==$20, parent.subtotal==$0 |

### `test_modifiers_carry_over_to_split_children`
| | |
|---|---|
| **Tests** | Regression pin: split preserves modifier prices |
| **Method** | Split item with $2.50 modifier |
| **Pass** | Child subtotal == $17.50 ($15+$2.50) |

### `test_split_specific_seats_only`
| | |
|---|---|
| **Tests** | split_by_seat(seats=[1]) splits only seat 1, leaves seat 2 on parent |
| **Method** | Create 2-seat order, split with seats=[1] |
| **Pass** | 1 child order (seat 1), parent retains seat 2 item ($8) |

### `test_no_seated_items_400s`
| | |
|---|---|
| **Tests** | Nothing to split raises HTTP 400 |
| **Method** | split_by_seat on unseated items |
| **Pass** | HTTPException 400 |

### `test_split_emits_check_split_on_parent_and_children`
| | |
|---|---|
| **Tests** | CHECK_SPLIT emitted on parent + each child with shared operation_id |
| **Method** | Split, query CHECK_SPLIT events |
| **Pass** | Parent has 1 (role='parent'), each child has 1 (role='child'), same op_id |

### `test_check_split_does_not_affect_projection`
| | |
|---|---|
| **Tests** | CHECK_SPLIT is audit-only; replaying doesn't change Order projection |
| **Method** | Split, project parent and children |
| **Pass** | Projections match item-move semantics regardless of CHECK_SPLIT |

### `test_cannot_split_closed_order`
| | |
|---|---|
| **Tests** | Cannot split a closed order |
| **Method** | Close order, try split |
| **Pass** | HTTPException 400 |

### `test_clean_division_three_ways`
| | |
|---|---|
| **Tests** | split_evenly($30, 3 ways) → per_person=$10, last_person=$10 |
| **Method** | Direct call |
| **Pass** | Values match, sum == $30 |

### `test_remainder_goes_to_last_person`
| | |
|---|---|
| **Tests** | split_evenly($10, 3 ways): per_person=$3.33, last=$3.34, identity holds |
| **Method** | Direct call |
| **Pass** | per_person==$3.33, last==$3.34, (2 × 3.33) + 3.34 == $10 |

### `test_cannot_split_voided_order`
| | |
|---|---|
| **Tests** | Cannot split evenly on voided order |
| **Method** | Void order, try split_evenly |
| **Pass** | HTTPException 400 |

### `test_void_sets_status_and_records_reason`
| | |
|---|---|
| **Tests** | void_order sets status='voided' and records reason in void_reason field |
| **Method** | Void order, project |
| **Pass** | status='voided', void_reason='customer changed mind' |

### `test_double_void_rejected`
| | |
|---|---|
| **Tests** | Voiding already-voided order is 400 |
| **Method** | Void twice |
| **Pass** | HTTPException 400 |

### `test_void_requires_approver`
| | |
|---|---|
| **Tests** | Void requires approved_by (non-empty) |
| **Method** | void_order with approved_by='' |
| **Pass** | HTTPException 403 |

### `test_adding_86d_item_returns_409`
| | |
|---|---|
| **Tests** | add_item rejects 86'd items (409 conflict) |
| **Method** | 86 item, try add_item |
| **Pass** | HTTPException 409, detail contains '86' |

### `test_adding_restored_item_succeeds`
| | |
|---|---|
| **Tests** | MENU_ITEM_RESTORED flips is_86ed back, add_item works |
| **Method** | 86 item, restore it, add_item succeeds |
| **Pass** | Order has item, subtotal==$4 |

### `test_ad_hoc_item_not_in_menu_still_added`
| | |
|---|---|
| **Tests** | Items not in config (manual corrections) add normally (no 86 guard) |
| **Method** | add_item with unknown menu_item_id |
| **Pass** | subtotal==$0.50 |

### `test_available_item_still_added_normally`
| | |
|---|---|
| **Tests** | Control: normal (non-86'd) items add as before |
| **Method** | add_item on available item |
| **Pass** | subtotal==$15 |

## `test_overpayment_guard.py`
> Regression tests for overpayment drift ($0.40 on $8 order bug caught by invariant gate)

### `test_cash_overpayment_clamped_no_tip`
| | |
|---|---|
| **Tests** | Cash $8.40 on $8 order clamps to $8 sale; $0.40 is customer change, not recorded |
| **Method** | process_cash_payment with overage |
| **Pass** | payment.amount==$8, tip==$0, fully_paid=True, invariant passes |

### `test_cash_exact_payment_records_no_tip`
| | |
|---|---|
| **Tests** | Exact payment records no tip |
| **Method** | process_cash_payment exact amount |
| **Pass** | amount==$8, tip==$0 |

### `test_cash_price_exact`
| | |
|---|---|
| **Tests** | Customer pays advertised cash price; dual-pricing discount closes gap |
| **Method** | 4% discount enabled, pay $9.60 on $10 item (cash price) |
| **Pass** | fully_paid=True, discount==$0.40, invariant passes |

### `test_cash_at_card_price_no_discount`
| | |
|---|---|
| **Tests** | Paying card price in cash doesn't trigger discount (naive_discount <= 0) |
| **Method** | Pay $10 cash on $10 item (card price) |
| **Pass** | fully_paid=True, discount==$0, no dual-pricing applied |

### `test_cash_overpaid_above_card_price`
| | |
|---|---|
| **Tests** | Paying $11 on $10 order: no discount, clamped to $10, $1 overage is change |
| **Method** | Pay $11 cash |
| **Pass** | payment==$10, tip==$0, fully_paid=True, invariant passes |

### `test_cash_underpaid_partial`
| | |
|---|---|
| **Tests** | Underpayment with dual-pricing: discount caps at amount × rate/(1-rate), partial OK |
| **Method** | Pay $5 cash on $10 order (4% discount) |
| **Pass** | payment==$5, no clamp, balance_due > 0, invariant passes |

## `test_overseer_config_extended.py`
> Covers gaps: floorplan sections, layout, terminals, printers, routing matrix

### `test_get_floorplan_sections_empty`
| | |
|---|---|
| **Tests** | Empty floorplan sections returns [] |
| **Method** | Query on fresh ledger |
| **Pass** | result == [] |

### `test_get_floorplan_sections_create_and_update`
| | |
|---|---|
| **Tests** | FLOORPLAN_SECTION_CREATED + UPDATED rounds trip (last-write-wins) |
| **Method** | Emit CREATE (name='Patio'), UPDATE (name='Back Patio') |
| **Pass** | 1 section with name='Back Patio' |

### `test_get_floorplan_sections_delete_removes`
| | |
|---|---|
| **Tests** | FLOORPLAN_SECTION_DELETED removes section |
| **Method** | CREATE + DELETE |
| **Pass** | All remaining sections != s2 |

### `test_get_floorplan_layout_default_when_empty`
| | |
|---|---|
| **Tests** | Empty layout returns default canvas (1200x800) |
| **Method** | Query on fresh ledger |
| **Pass** | canvas={'width': 1200, 'height': 800}, tables/structures/fixtures==[] |

### `test_get_floorplan_layout_last_event_wins`
| | |
|---|---|
| **Tests** | Last FLOORPLAN_LAYOUT_UPDATED wins |
| **Method** | Emit UPDATE with 800x600, then UPDATE with 1920x1080 |
| **Pass** | canvas={'width': 1920, 'height': 1080} |

### `test_get_terminals_empty`
| | |
|---|---|
| **Tests** | Empty terminals list |
| **Method** | Query on fresh ledger |
| **Pass** | result == [] |

### `test_get_terminals_merge_update`
| | |
|---|---|
| **Tests** | TERMINAL_REGISTERED + TERMINAL_UPDATED (last-write-wins) |
| **Method** | CREATE (name='Front'), UPDATE (name='Front Register') |
| **Pass** | 1 terminal with name='Front Register' |

### `test_get_printers_empty`
| | |
|---|---|
| **Tests** | Empty printers list |
| **Method** | Query on fresh ledger |
| **Pass** | result == [] |

### `test_get_printers_basic`
| | |
|---|---|
| **Tests** | PRINTER_REGISTERED populates printer config |
| **Method** | Emit event with printer_id, name, station, IP, MAC |
| **Pass** | 1 printer with printer_id='p1', station='kitchen' |

### `test_get_routing_matrix_empty`
| | |
|---|---|
| **Tests** | Empty routing matrix returns {} |
| **Method** | Query on fresh ledger |
| **Pass** | matrix.matrix == {} |

### `test_get_routing_matrix_last_event_wins`
| | |
|---|---|
| **Tests** | Last ROUTING_MATRIX_UPDATED wins (food→[p1], then food→[p1,p2], drinks→[p3]) |
| **Method** | Emit two UPDATE events |
| **Pass** | matrix={'food': ['p1', 'p2'], 'drinks': ['p3']} |

## `test_overseer_config_projection.py`
> Projection determinism: last-write-wins, DELETE wipes, CREATE→UPDATE→DELETE→CREATE, cache invalidation

### `test_empty_ledger_returns_empty`
| | |
|---|---|
| **Tests** | Empty ledger → empty roles list |
| **Method** | Query on fresh ledger |
| **Pass** | result == [] |

### `test_create_then_query_returns_role`
| | |
|---|---|
| **Tests** | EMPLOYEE_ROLE_CREATED populates role |
| **Method** | Emit event, query |
| **Pass** | 1 role with role_id='r_server' |

### `test_update_replaces_entry`
| | |
|---|---|
| **Tests** | Later CREATED or UPDATED for same role_id overwrites (last-write-wins by sequence) |
| **Method** | CREATE (name='Server'), UPDATE (name='Head Server') |
| **Pass** | 1 role with name='Head Server' |

### `test_delete_removes_entry`
| | |
|---|---|
| **Tests** | EMPLOYEE_ROLE_DELETED removes role |
| **Method** | CREATE + DELETE |
| **Pass** | result == [] |

### `test_delete_then_recreate_restores`
| | |
|---|---|
| **Tests** | CREATE → DELETE → CREATE with same ID = 1 entry, no ghost state |
| **Method** | CREATE ('First'), DELETE, CREATE ('Second') |
| **Pass** | 1 role with name='Second' |

### `test_create_update_delete_semantics` (employees)
| | |
|---|---|
| **Tests** | Employees follow same CRUD semantics as roles |
| **Method** | CREATE, UPDATE hourly_rate, DELETE |
| **Pass** | Final state: 0 employees |

### `test_inactive_employees_still_surfaced`
| | |
|---|---|
| **Tests** | active=False doesn't delete employee; only explicit DELETE removes |
| **Method** | CREATE with active=False |
| **Pass** | Employee still present in list |

### `test_create_and_delete` (tipout)
| | |
|---|---|
| **Tests** | TIPOUT_RULE_CREATED + DELETED |
| **Method** | CREATE, DELETE |
| **Pass** | Final state: 0 rules |

### `test_categories_field_round_trips`
| | |
|---|---|
| **Tests** | Categories field survives event roundtrip (empty by default, populated when specified) |
| **Method** | CREATE with categories=['Beer', 'Wine', 'Liquor'] |
| **Pass** | Rule has categories==['Beer', 'Wine', 'Liquor'] |

### `test_repeated_calls_hit_cache`
| | |
|---|---|
| **Tests** | No new writes → identical result object returned (cache hit) |
| **Method** | Query twice, check object identity |
| **Pass** | first is second |

### `test_new_write_invalidates_cache`
| | |
|---|---|
| **Tests** | After new event, next call re-projects (different object) |
| **Method** | Query, write new event, query |
| **Pass** | first is not second, second has 2 entries |

### `test_category_create_and_update_roundtrip`
| | |
|---|---|
| **Tests** | MENU_CATEGORY_CREATED + UPDATED (last-write-wins) |
| **Method** | CREATE (name='Pizza'), UPDATE (name='Pizzas') |
| **Pass** | cats[0].name='Pizzas' |

### `test_category_delete_removes_entry`
| | |
|---|---|
| **Tests** | MENU_CATEGORY_DELETED removes category |
| **Method** | CREATE + DELETE |
| **Pass** | result == [] |

### `test_category_delete_then_recreate`
| | |
|---|---|
| **Tests** | CREATE → DELETE → CREATE = 1 entry, no ghost |
| **Method** | CREATE ('First'), DELETE, CREATE ('Second') |
| **Pass** | 1 category with name='Second' |

### `test_menu_item_create_update_delete`
| | |
|---|---|
| **Tests** | MENU_ITEM_CREATED + UPDATED + DELETED (full lifecycle) |
| **Method** | CREATE (name='Burger', price=$12), UPDATE (name='Big Burger', price=$14), DELETE |
| **Pass** | Final: 0 items |

### `test_menu_item_86_sets_is_86ed_true`
| | |
|---|---|
| **Tests** | MENU_ITEM_86D sets is_86ed=True without removing item |
| **Method** | CREATE, 86D |
| **Pass** | 1 item with is_86ed=True |

### `test_menu_item_restored_clears_is_86ed`
| | |
|---|---|
| **Tests** | MENU_ITEM_RESTORED flips is_86ed back to False |
| **Method** | CREATE, 86D, RESTORED |
| **Pass** | item.is_86ed=False |

### `test_86_event_for_unknown_item_is_a_noop`
| | |
|---|---|
| **Tests** | 86ing nonexistent item doesn't crash or create phantom |
| **Method** | 86D non-existent item_id |
| **Pass** | result == [] |

### `test_86_state_survives_an_update`
| | |
|---|---|
| **Tests** | UPDATE after 86 resets is_86ed to False (current behaviour — pin it) |
| **Method** | CREATE, 86D, UPDATE |
| **Pass** | name='Soup (new)', is_86ed=False |

## `test_payment_health.py`
> Tests for PaymentHealthMonitor: lifecycle, status change detection, sacred state skip

### `test_start_stop`
| | |
|---|---|
| **Tests** | Monitor start/stop cycle completes cleanly |
| **Method** | Create monitor, start, sleep, stop |
| **Pass** | _polling_task is done after stop |

### `test_detects_status_change`
| | |
|---|---|
| **Tests** | Status change emits DEVICE_STATUS_CHANGED event |
| **Method** | Set device to OFFLINE, call _handle_status_change |
| **Pass** | 1 DEVICE_STATUS_CHANGED event with correct payload |

### `test_sacred_state_skipped`
| | |
|---|---|
| **Tests** | Device in sacred state (AWAITING_CARD) is skipped by _poll_loop |
| **Method** | Set device to AWAITING_CARD, run monitor briefly |
| **Pass** | No DEVICE_STATUS_CHANGED events emitted |

## `test_payment_manager.py`
> Tests for PaymentManager + MockPaymentDevice: device registry, sales, declines, idempotency, timeouts, errors

### `test_register_device`
| | |
|---|---|
| **Tests** | Device registration and terminal mapping work |
| **Method** | register_device, map_terminal_to_device, get_device_for_terminal |
| **Pass** | Retrieved device matches registered |

### `test_unmapped_terminal_returns_none`
| | |
|---|---|
| **Tests** | Query unmapped terminal returns None |
| **Method** | get_device_for_terminal on unknown terminal |
| **Pass** | result is None |

### `test_approved_sale`
| | |
|---|---|
| **Tests** | Approved card sale emits PAYMENT_INITIATED + CONFIRMED |
| **Method** | Call initiate_sale on MockPaymentDevice |
| **Pass** | Status.APPROVED, PAYMENT_INITIATED and CONFIRMED events |

### `test_declined_sale`
| | |
|---|---|
| **Tests** | Declined card emits PAYMENT_INITIATED + DECLINED |
| **Method** | Set device to DECLINE_ALWAYS, initiate_sale |
| **Pass** | Status.DECLINED, PAYMENT_DECLINED event |

### `test_no_device_mapped`
| | |
|---|---|
| **Tests** | Sale with no device returns ERROR with NO_DEVICE code |
| **Method** | initiate_sale without device mapped |
| **Pass** | Status.ERROR, error_code='NO_DEVICE' |

### `test_duplicate_blocked`
| | |
|---|---|
| **Tests** | Same transaction_id submitted twice: second returns cached result |
| **Method** | initiate_sale with fixed transaction_id twice |
| **Pass** | Both return APPROVED, only 1 PAYMENT_CONFIRMED event |

### `test_timeout_handling`
| | |
|---|---|
| **Tests** | Device timeout enforced (manager has 90s internal timeout) |
| **Method** | Set device delay to 200s, initiate_sale with timeout override |
| **Pass** | Status.TIMEOUT or asyncio.TimeoutError |

### `test_error_mode`
| | |
|---|---|
| **Tests** | MockPaymentDevice ERROR_BY_CATEGORY returns ERROR with category |
| **Method** | Set error mode with PaymentErrorCategory.DEVICE |
| **Pass** | Status.ERROR, PAYMENT_ERROR event |

### `test_cancel_mode`
| | |
|---|---|
| **Tests** | CANCEL mode returns CANCELLED |
| **Method** | Set mode to CANCEL, initiate_sale |
| **Pass** | Status.CANCELLED, PAYMENT_CANCELLED event |

### `test_sequence`
| | |
|---|---|
| **Tests** | SPECIFIC_SEQUENCE mode plays scripted outcomes |
| **Method** | Set sequence [APPROVED, DECLINED, APPROVED], 3 sales |
| **Pass** | Results match sequence; 2 CONFIRMED, 1 DECLINED |

### `test_connect_and_status`
| | |
|---|---|
| **Tests** | Device connect lifecycle |
| **Method** | Create device, connect, check status |
| **Pass** | Initial=OFFLINE, after connect=IDLE, config loaded |

### `test_disconnect`
| | |
|---|---|
| **Tests** | Disconnect succeeds, status → OFFLINE |
| **Method** | Connect device, disconnect |
| **Pass** | Status=OFFLINE |

### `test_sacred_state_blocks_disconnect`
| | |
|---|---|
| **Tests** | Cannot disconnect during sacred state (AWAITING_CARD) |
| **Method** | Start slow sale (enters AWAITING_CARD), disconnect |
| **Pass** | disconnect returns False |

### `test_refund`
| | |
|---|---|
| **Tests** | Refund operation succeeds |
| **Method** | Call device.initiate_refund |
| **Pass** | Status.APPROVED |

### `test_void`
| | |
|---|---|
| **Tests** | Void operation succeeds |
| **Method** | Call device.initiate_void |
| **Pass** | Status.APPROVED |

### `test_close_batch`
| | |
|---|---|
| **Tests** | Batch close settles multiple transactions |
| **Method** | Process 3 sales, close_batch |
| **Pass** | transaction_count=3, status=SUCCESS |

### `test_device_info`
| | |
|---|---|
| **Tests** | get_device_info returns device metadata |
| **Method** | Call device.get_device_info() |
| **Pass** | Info contains 'model' and 'serial' |

### `test_capabilities`
| | |
|---|---|
| **Tests** | get_capabilities lists supported operations |
| **Method** | Call device.get_capabilities() |
| **Pass** | Capabilities include SALE, REFUND, VOID |

### `test_full_audit_trail`
| | |
|---|---|
| **Tests** | Full payment lifecycle produces correct event chain |
| **Method** | Two sales (one approved, one declined), check ledger |
| **Pass** | 2 INITIATED, 1 CONFIRMED, 1 DECLINED |

## `test_payment_precision.py`
> Tests for split/multi-tender, refunds, tip adjustments — edge cases with zero coverage

### `test_cash_discount_only_on_first_payment`
| | |
|---|---|
| **Tests** | Dual-pricing discount applied only on first cash payment |
| **Method** | Split payment (two cash pays), check DISCOUNT_APPROVED count |
| **Pass** | No new discount after second payment |

### `test_cash_overpayment_emits_change_event`
| | |
|---|---|
| **Tests** | Overpayment emits SEAT_OVERPAYMENT_RESOLVED with resolution='change' |
| **Method** | Overpay cash, query event |
| **Pass** | Event exists, resolution='change', amount==$10 |

### `test_cash_exact_payment_no_change_event`
| | |
|---|---|
| **Tests** | Exact payment produces no overpayment event |
| **Method** | Pay exact amount |
| **Pass** | No SEAT_OVERPAYMENT_RESOLVED events |

### `test_cash_payment_closes_order_when_fully_paid`
| | |
|---|---|
| **Tests** | Full cash payment auto-closes order |
| **Method** | Pay full amount in cash |
| **Pass** | status='closed', ORDER_CLOSED event |

### `test_refund_full`
| | |
|---|---|
| **Tests** | Full refund emits PAYMENT_REFUNDED with correct amount |
| **Method** | Create paid order, refund full amount |
| **Pass** | success=True, refund_amount matches, PAYMENT_REFUNDED event |

### `test_refund_partial`
| | |
|---|---|
| **Tests** | Partial refund records requested amount only |
| **Method** | Refund $25 of $100 payment |
| **Pass** | refund_amount==$25 |

### `test_refund_over_limit_rejected`
| | |
|---|---|
| **Tests** | Refund > payment amount raises 400 |
| **Method** | Try to refund more than paid |
| **Pass** | HTTPException 400 |

### `test_refund_cumulative_limit`
| | |
|---|---|
| **Tests** | Two partial refunds cannot exceed original payment total |
| **Method** | Refund half, then try to refund half + $0.01 |
| **Pass** | Second refund raises 400 |

### `test_refund_requires_approved_by`
| | |
|---|---|
| **Tests** | Refund without approved_by raises 403 |
| **Method** | process_refund with approved_by='' |
| **Pass** | HTTPException 403 |

### `test_tip_adjust_first_tip_emits_seat_tip_added`
| | |
|---|---|
| **Tests** | First tip write emits SEAT_TIP_ADDED event |
| **Method** | adjust_tip on paid order, check events |
| **Pass** | SEAT_TIP_ADDED event present |

### `test_tip_adjust_override_does_not_emit_seat_tip_added`
| | |
|---|---|
| **Tests** | Overriding existing tip does NOT emit another SEAT_TIP_ADDED |
| **Method** | adjust_tip twice, count SEAT_TIP_ADDED |
| **Pass** | 1 event (only first write) |

### `test_tip_adjust_zero_first_tip_no_seat_event`
| | |
|---|---|
| **Tests** | First tip amount $0.00 does not emit SEAT_TIP_ADDED |
| **Method** | adjust_tip($0) first |
| **Pass** | No SEAT_TIP_ADDED events |

### `test_tip_adjust_negative_tip_rejected`
| | |
|---|---|
| **Tests** | Negative tip raises 400 |
| **Method** | adjust_tip with negative amount |
| **Pass** | HTTPException 400 |

### `test_tip_adjust_records_previous_tip`
| | |
|---|---|
| **Tests** | TIP_ADJUSTED payload includes previous_tip for audit trail |
| **Method** | adjust_tip twice ($10 then $15), check payloads |
| **Pass** | First TIP_ADJUSTED previous_tip=$0, second previous_tip=$10 |

## `test_payment_routes_gaps.py`
> Coverage for /sale, /batch-settle, /cash, /tip-adjust, /refund guards (gaps 🔴1-3)

### `test_sale_already_fully_paid_rejected`
| | |
|---|---|
| **Tests** | Sale on already-paid order returns 400 |
| **Method** | Pay cash first, then try card sale |
| **Pass** | HTTPException 400, detail contains 'fully paid' |

### `test_sale_inflight_guard_returns_409`
| | |
|---|---|
| **Tests** | FIN-002: unresolved PAYMENT_INITIATED (with transaction_id in payload) blocks second sale |
| **Method** | Append PAYMENT_INITIATED with transaction_id, try sale |
| **Pass** | HTTPException 409, detail contains 'in progress' |

### `test_sale_overage_clamped_to_tip`
| | |
|---|---|
| **Tests** | Overage-as-tip: amount > balance_due routes excess to TIP_ADJUSTED |
| **Method** | Request $25 on $20 order |
| **Pass** | Status.APPROVED, TIP_ADJUSTED event with tip=$5 |

### `test_sale_auto_closes_fully_paid_order`
| | |
|---|---|
| **Tests** | Approved sale fully paying order emits ORDER_CLOSED |
| **Method** | Sale for full balance |
| **Pass** | ORDER_CLOSED event |

### `test_batch_settle_mock_device_returns_mock_flag`
| | |
|---|---|
| **Tests** | batch_settle with fallback mock device returns using_mock=True |
| **Method** | Call batch_settle |
| **Pass** | success=True, using_mock=True, batch_id='MOCK' |

### `test_cash_payment_missing_order_returns_404`
| | |
|---|---|
| **Tests** | /cash on nonexistent order_id returns 404 |
| **Method** | process_cash_payment('no-order') |
| **Pass** | HTTPException 404 |

### `test_cash_payment_on_closed_order_returns_400`
| | |
|---|---|
| **Tests** | /cash on closed order returns 400 |
| **Method** | Close order, try cash payment |
| **Pass** | HTTPException 400, detail contains 'closed' |

### `test_cash_payment_on_voided_order_returns_400`
| | |
|---|---|
| **Tests** | /cash on voided order returns 400 |
| **Method** | Void order, try cash |
| **Pass** | HTTPException 400, detail contains 'voided' |

### `test_cash_payment_already_fully_paid_returns_400`
| | |
|---|---|
| **Tests** | Double-tap guard: second cash payment after order auto-closed returns 400 |
| **Method** | Pay cash (auto-closes), pay again |
| **Pass** | HTTPException 400, detail contains 'closed' or 'fully paid' |

### `test_tip_adjust_negative_tip_returns_400`
| | |
|---|---|
| **Tests** | /tip-adjust negative amount returns 400 |
| **Method** | adjust_tip(-$1) |
| **Pass** | HTTPException 400, detail contains 'negative' |

### `test_tip_adjust_order_not_found_returns_404`
| | |
|---|---|
| **Tests** | /tip-adjust on nonexistent order returns 404 |
| **Method** | adjust_tip('no-order') |
| **Pass** | HTTPException 404 |

### `test_tip_adjust_payment_not_found_returns_404`
| | |
|---|---|
| **Tests** | /tip-adjust with payment_id not on order returns 404 |
| **Method** | adjust_tip(valid_order, ghost_payment) |
| **Pass** | HTTPException 404 |

### `test_tip_adjust_non_confirmed_payment_returns_400`
| | |
|---|---|
| **Tests** | /tip-adjust on pending (unconfirmed) payment returns 400 |
| **Method** | Seed order with PAYMENT_INITIATED but not CONFIRMED, adjust_tip |
| **Pass** | HTTPException 400, detail contains 'confirmed' |

### `test_refund_without_approved_by_returns_403`
| | |
|---|---|
| **Tests** | /refund missing approved_by returns 403 |
| **Method** | process_refund(approved_by='') |
| **Pass** | HTTPException 403, detail contains 'approval' |

### `test_refund_order_not_found_returns_404`
| | |
|---|---|
| **Tests** | /refund on nonexistent order returns 404 |
| **Method** | process_refund('no-order') |
| **Pass** | HTTPException 404 |

### `test_refund_payment_not_found_returns_404`
| | |
|---|---|
| **Tests** | /refund with payment_id not on order returns 404 |
| **Method** | process_refund(valid_order, ghost_payment) |
| **Pass** | HTTPException 404 |

### `test_refund_non_confirmed_payment_returns_400`
| | |
|---|---|
| **Tests** | /refund on pending payment returns 400 |
| **Method** | Seed PAYMENT_INITIATED (no CONFIRMED), refund |
| **Pass** | HTTPException 400, detail contains 'confirmed' |

### `test_refund_over_amount_returns_400`
| | |
|---|---|
| **Tests** | /refund amount exceeds original payment returns 400 |
| **Method** | process_refund($50 on $20 payment) |
| **Pass** | HTTPException 400, detail contains 'exceed' |

### `test_refund_happy_path_emits_cash_refund_due`
| | |
|---|---|
| **Tests** | Full refund on confirmed payment emits PAYMENT_REFUNDED, returns success |
| **Method** | process_refund full amount |
| **Pass** | success=True, PAYMENT_REFUNDED event |
