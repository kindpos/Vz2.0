# KINDpos Test Suite Breakdown

## Conventions

- **Tests** — what the test is asserting (behaviour / invariant)
- **Method** — how it sets up state and exercises the code
- **Pass** — the concrete assertion(s) that must hold

---


## Table of Contents

### Backend Tests

- [`conftest.py`](#conftestpy)
- [`test_adjust_tip_on_order.py`](#test_adjust_tip_on_orderpy)
- [`test_api_orders_extended.py`](#test_api_orders_extendedpy)
- [`test_api_routes.py`](#test_api_routespy)
- [`test_append_batch.py`](#test_append_batchpy)
- [`test_auth_routes.py`](#test_auth_routespy)
- [`test_cash_and_tip_flows.py`](#test_cash_and_tip_flowspy)
- [`test_chaos_probe.py`](#test_chaos_probepy)
- [`test_check_state_validity.py`](#test_check_state_validitypy)
- [`test_close_day_extended.py`](#test_close_day_extendedpy)
- [`test_config_routes.py`](#test_config_routespy)
- [`test_config_services.py`](#test_config_servicespy)
- [`test_daily_workflow.py`](#test_daily_workflowpy)
- [`test_daily_workflow_extended.py`](#test_daily_workflow_extendedpy)
- [`test_day_cash_routes.py`](#test_day_cash_routespy)
- [`test_day_close_lock.py`](#test_day_close_lockpy)
- [`test_dejavoo_spin.py`](#test_dejavoo_spinpy)
- [`test_dejavoo_spin_extended.py`](#test_dejavoo_spin_extendedpy)
- [`test_dejavoo_spin_lockdown.py`](#test_dejavoo_spin_lockdownpy)
- [`test_demo_seeder.py`](#test_demo_seederpy)
- [`test_discount_endpoint.py`](#test_discount_endpointpy)
- [`test_entomology_correlation.py`](#test_entomology_correlationpy)
- [`test_entomology_collector.py`](#test_entomology_collectorpy)
- [`test_entomology_excel_report.py`](#test_entomology_excel_reportpy)
- [`test_entomology_integration.py`](#test_entomology_integrationpy)
- [`test_entomology_ledger_gaps.py`](#test_entomology_ledger_gapspy)
- [`test_entomology_model.py`](#test_entomology_modelpy)
- [`test_entomology_new_hooks.py`](#test_entomology_new_hookspy)
- [`test_entomology_reboot.py`](#test_entomology_rebootpy)
- [`test_entomology_registry.py`](#test_entomology_registrypy)
- [`test_entomology_report.py`](#test_entomology_reportpy)
- [`test_entomology_routes.py`](#test_entomology_routespy)
- [`test_entomology_storage.py`](#test_entomology_storagepy)
- [`test_ephemeral_log.py`](#test_ephemeral_logpy)
- [`test_escpos_formatter.py`](#test_escpos_formatterpy)
- [`test_event_ledger.py`](#test_event_ledgerpy)
- [`test_financial_invariants.py`](#test_financial_invariantspy)
- [`test_half_placement_utils.py`](#test_half_placement_utilspy)
- [`test_hardware_ledger_emissions.py`](#test_hardware_ledger_emissionspy)
- [`test_hardware_routes_extended.py`](#test_hardware_routes_extendedpy)
- [`test_hash_chain_tamper.py`](#test_hash_chain_tamperpy)
- [`test_invariants_property.py`](#test_invariants_propertypy)
- [`test_kindnostic_cli.py`](#test_kindnostic_clipy)
- [`test_kindnostic_display.py`](#test_kindnostic_displaypy)
- [`test_kindnostic_probes_critical.py`](#test_kindnostic_probes_criticalpy)
- [`test_kindnostic_probes_high_low.py`](#test_kindnostic_probes_high_lowpy)
- [`test_kindnostic_runner.py`](#test_kindnostic_runnerpy)
- [`test_kindnostic_session4.py`](#test_kindnostic_session4py)
- [`test_kindnostic_storage.py`](#test_kindnostic_storagepy)
- [`test_kindnostic_support_codes.py`](#test_kindnostic_support_codespy)
- [`test_kindnostic_types.py`](#test_kindnostic_typespy)
- [`test_labor_summary.py`](#test_labor_summarypy)
- [`test_ledger_concurrency.py`](#test_ledger_concurrencypy)
- [`test_ledger_crash_recovery.py`](#test_ledger_crash_recoverypy)
- [`test_ledger_robustness.py`](#test_ledger_robustnesspy)
- [`test_menu_projection.py`](#test_menu_projectionpy)
- [`test_money_round.py`](#test_money_roundpy)
- [`test_new_shift_routes.py`](#test_new_shift_routespy)
- [`test_orders_and_reporting_gaps.py`](#test_orders_and_reporting_gapspy)
- [`test_orders_mutations.py`](#test_orders_mutationspy)
- [`test_overpayment_guard.py`](#test_overpayment_guardpy)
- [`test_overseer_config_extended.py`](#test_overseer_config_extendedpy)
- [`test_overseer_config_projection.py`](#test_overseer_config_projectionpy)
- [`test_payment_health.py`](#test_payment_healthpy)
- [`test_payment_manager.py`](#test_payment_managerpy)
- [`test_payment_precision.py`](#test_payment_precisionpy)
- [`test_payment_routes_gaps.py`](#test_payment_routes_gapspy)
- [`test_payment_routes_hardware.py`](#test_payment_routes_hardwarepy)
- [`test_payment_routes_refund.py`](#test_payment_routes_refundpy)
- [`test_payment_sale_overage.py`](#test_payment_sale_overagepy)
- [`test_payment_validator.py`](#test_payment_validatorpy)
- [`test_phase10_discount_catalog.py`](#test_phase10_discount_catalogpy)
- [`test_phase11_tipout_rules.py`](#test_phase11_tipout_rulespy)
- [`test_phase12_seat_balance.py`](#test_phase12_seat_balancepy)
- [`test_phase13_cash_variance.py`](#test_phase13_cash_variancepy)
- [`test_phase14_settlement_drift.py`](#test_phase14_settlement_driftpy)
- [`test_phase4c_emissions.py`](#test_phase4c_emissionspy)
- [`test_phase4d_settlement_failure.py`](#test_phase4d_settlement_failurepy)
- [`test_phase4e_menu_import.py`](#test_phase4e_menu_importpy)
- [`test_phase4f_modifier_crud.py`](#test_phase4f_modifier_crudpy)
- [`test_phase4g_micromods.py`](#test_phase4g_micromodspy)
- [`test_phase4h_modifier_micromod_wiring.py`](#test_phase4h_modifier_micromod_wiringpy)
- [`test_phase5_catalog.py`](#test_phase5_catalogpy)
- [`test_phase6_staff_config.py`](#test_phase6_staff_configpy)
- [`test_phase7_day_batch.py`](#test_phase7_day_batchpy)
- [`test_phase8_seat_financial.py`](#test_phase8_seat_financialpy)
- [`test_phase9_seat_transfer.py`](#test_phase9_seat_transferpy)
- [`test_physical_integration.py`](#test_physical_integrationpy)
- [`test_pin_hash.py`](#test_pin_hashpy)
- [`test_pos_system.py`](#test_pos_systempy)
- [`test_precision_gate.py`](#test_precision_gatepy)
- [`test_print_context_builder.py`](#test_print_context_builderpy)
- [`test_print_context_builder_extended.py`](#test_print_context_builder_extendedpy)
- [`test_print_dispatcher.py`](#test_print_dispatcherpy)
- [`test_print_queue.py`](#test_print_queuepy)
- [`test_print_templates.py`](#test_print_templatespy)
- [`test_print_templates_money.py`](#test_print_templates_moneypy)
- [`test_printer_api.py`](#test_printer_apipy)
- [`test_printer_detector.py`](#test_printer_detectorpy)
- [`test_printer_manager_extended.py`](#test_printer_manager_extendedpy)
- [`test_printer_system.py`](#test_printer_systempy)
- [`test_printing_routes.py`](#test_printing_routespy)
- [`test_projections.py`](#test_projectionspy)
- [`test_projections_payment_lifecycle.py`](#test_projections_payment_lifecyclepy)
- [`test_reporting_extended.py`](#test_reporting_extendedpy)
- [`test_seat_payments.py`](#test_seat_paymentspy)
- [`test_server_shift.py`](#test_server_shiftpy)
- [`test_server_shift_extended.py`](#test_server_shift_extendedpy)
- [`test_staff_routes_extended.py`](#test_staff_routes_extendedpy)
- [`test_staff_routes_gaps.py`](#test_staff_routes_gapspy)
- [`test_startup_sweep.py`](#test_startup_sweeppy)
- [`test_sync_routes.py`](#test_sync_routespy)
- [`test_system_routes.py`](#test_system_routespy)

### Frontend Tests (Terminal)

- [`auth-client.test.js`](#auth-clienttestjs)
- [`category-grid.test.js`](#category-gridtestjs)
- [`charts.test.js`](#chartstestjs)
- [`components.test.js`](#componentstestjs)
- [`discount.test.js`](#discounttestjs)
- [`entomology-client.test.js`](#entomology-clienttestjs)
- [`half-placement-overlay.test.js`](#half-placement-overlaytestjs)
- [`header.test.js`](#headertestjs)
- [`keyboard.test.js`](#keyboardtestjs)
- [`modifier-label.test.js`](#modifier-labeltestjs)
- [`net.test.js`](#nettestjs)
- [`numpad.test.js`](#numpadtestjs)
- [`order-summary.test.js`](#order-summarytestjs)
- [`pricing.test.js`](#pricingtestjs)
- [`scene-manager.test.js`](#scene-managertestjs)
- [`theme-manager.test.js`](#theme-managertestjs)
- [`check-overview.test.js`](#check-overviewtestjs)
- [`checkout-core.test.js`](#checkout-coretestjs)
- [`close-day-calc.test.js`](#close-day-calctestjs)
- [`close-day-checks-viewer.test.js`](#close-day-checks-viewertestjs)
- [`close-day.test.js`](#close-daytestjs)
- [`column-editor.test.js`](#column-editortestjs)
- [`item-detail.test.js`](#item-detailtestjs)
- [`login.test.js`](#logintestjs)
- [`manager-landing.test.js`](#manager-landingtestjs)
- [`payment.test.js`](#paymenttestjs)
- [`seats.test.js`](#seatstestjs)
- [`server-checkout.test.js`](#server-checkouttestjs)
- [`server-landing.test.js`](#server-landingtestjs)
- [`transitions.test.js`](#transitionstestjs)

### Frontend Tests (Overseer)

- [`date-picker.test.js`](#date-pickertestjs)
- [`scene-manager.test.js`](#scene-managertestjs)
- [`sample-payroll.test.js`](#sample-payrolltestjs)
- [`employee-events.test.js`](#employee-eventstestjs)
- [`employees.test.js`](#employeestestjs)
- [`labor-reports.test.js`](#labor-reportstestjs)
- [`auth-client.test.js`](#auth-clienttestjs)
- [`config-push.test.js`](#config-pushtestjs)
- [`excel-parser.test.js`](#excel-parsertestjs)
- [`money.test.js`](#moneytestjs)

### New Tests (Added After Initial Breakdown)

- [`test_seats_coverage.py`](#test_seats_coveragepy)
- [`item-recap.test.js`](#item-recaptestjs)
- [`pizza-builder-overlay.test.js`](#pizza-builder-overlaytestjs)
- [`order-entry.test.js`](#order-entrytestjs)

---


---

## Scene Glossary

Cross-reference of test files by scene. Backend entries list only files whose routes are directly exercised by that scene. Links jump to the full breakdown entry.

| Symbol | Meaning |
|--------|---------|
| FE | Frontend test file |
| BE | Backend test file |

---

### `check-overview`
Seat-level order management: seat layout, item selection, discounts, payments, void items, split-by-seat.

| Role | Path | Tests |
|------|------|------:|
| FE | [`terminal/scenes/check-overview.test.js`](#check-overviewtestjs) | 57 |
| BE | [`backend/tests/test_check_state_validity.py`](#test_check_state_validitypy) | 10 |
| BE | [`backend/tests/test_seat_payments.py`](#test_seat_paymentspy) | 17 |
| BE | [`backend/tests/test_seats_coverage.py`](#test_seats_coveragepy) | 21 |

---

### `checkout-core`
Shared checkout utilities: void confirmation, PIN validation, tip adjust, finalize dialog.

| Role | Path | Tests |
|------|------|------:|
| FE | [`terminal/scenes/checkout-core.test.js`](#checkout-coretestjs) | 31 |
| BE | [`backend/tests/test_adjust_tip_on_order.py`](#test_adjust_tip_on_orderpy) | 7 |
| BE | [`backend/tests/test_cash_and_tip_flows.py`](#test_cash_and_tip_flowspy) | 7 |

---

### `close-day`
End-of-day workflow: cash drawer reconciliation, check viewer, day-close lock.

| Role | Path | Tests |
|------|------|------:|
| FE | [`terminal/scenes/close-day.test.js`](#close-daytestjs) | 38 |
| FE | [`terminal/scenes/close-day-calc.test.js`](#close-day-calctestjs) | 11 |
| FE | [`terminal/scenes/close-day-checks-viewer.test.js`](#close-day-checks-viewertestjs) | 19 |
| BE | [`backend/tests/test_close_day_extended.py`](#test_close_day_extendedpy) | 9 |
| BE | [`backend/tests/test_day_close_lock.py`](#test_day_close_lockpy) | 3 |
| BE | [`backend/tests/test_day_cash_routes.py`](#test_day_cash_routespy) | 16 |

---

### `column-editor`
Transactional scene for reordering/renaming table columns. Pure client-side UI — no backend routes exercised.

| Role | Path | Tests |
|------|------|------:|
| FE | [`terminal/scenes/column-editor.test.js`](#column-editortestjs) | 16 |

---

### `item-detail`
Per-item modifier editing (add/remove modifiers, quantity, notes) within an open order.

| Role | Path | Tests |
|------|------|------:|
| FE | [`terminal/scenes/item-detail.test.js`](#item-detailtestjs) | 12 |
| BE | [`backend/tests/test_api_routes.py`](#test_api_routespy) | 38 |
| BE | [`backend/tests/test_api_orders_extended.py`](#test_api_orders_extendedpy) | 9 |

---

### `login`
PIN entry and session establishment at the gate layer.

| Role | Path | Tests |
|------|------|------:|
| FE | [`terminal/scenes/login.test.js`](#logintestjs) | 4 |
| BE | [`backend/tests/test_auth_routes.py`](#test_auth_routespy) | 18 |
| BE | [`backend/tests/test_pin_hash.py`](#test_pin_hashpy) | 8 |

---

### `manager-landing`
Manager dashboard: staff overview, clock edits, shift management.

| Role | Path | Tests |
|------|------|------:|
| FE | [`terminal/scenes/manager-landing.test.js`](#manager-landingtestjs) | 18 |
| BE | [`backend/tests/test_staff_routes_extended.py`](#test_staff_routes_extendedpy) | 4 |
| BE | [`backend/tests/test_staff_routes_gaps.py`](#test_staff_routes_gapspy) | 7 |

---

### `order-entry`
Working scene for building a ticket: add items, recall order, send to kitchen, idempotency guards.

| Role | Path | Tests |
|------|------|------:|
| FE | [`terminal/scenes/order-entry.test.js`](#order-entrytestjs) | 13 |
| BE | [`backend/tests/test_api_routes.py`](#test_api_routespy) | 38 |
| BE | [`backend/tests/test_api_orders_extended.py`](#test_api_orders_extendedpy) | 9 |

---

### `payment`
Interrupt-layer payment flow: cash/card processing, split payments, idempotency keys, decline handling.

| Role | Path | Tests |
|------|------|------:|
| FE | [`terminal/scenes/payment.test.js`](#paymenttestjs) | 21 |
| BE | [`backend/tests/test_payment_routes_gaps.py`](#test_payment_routes_gapspy) | 23 |
| BE | [`backend/tests/test_payment_routes_hardware.py`](#test_payment_routes_hardwarepy) | 3 |
| BE | [`backend/tests/test_payment_routes_refund.py`](#test_payment_routes_refundpy) | 15 |
| BE | [`backend/tests/test_payment_sale_overage.py`](#test_payment_sale_overagepy) | 3 |
| BE | [`backend/tests/test_payment_validator.py`](#test_payment_validatorpy) | 13 |

---

### `seats`
Transactional seat-picker: assign items to seats, seat transfers, balance-due per seat.

| Role | Path | Tests |
|------|------|------:|
| FE | [`terminal/scenes/seats.test.js`](#seatstestjs) | 21 |
| BE | [`backend/tests/test_seats_coverage.py`](#test_seats_coveragepy) | 21 |
| BE | [`backend/tests/test_seat_payments.py`](#test_seat_paymentspy) | 17 |
| BE | [`backend/tests/test_phase9_seat_transfer.py`](#test_phase9_seat_transferpy) | 6 |
| BE | [`backend/tests/test_phase12_seat_balance.py`](#test_phase12_seat_balancepy) | 11 |

---

### `server-checkout`
Server end-of-shift receipt: sales summary, declared cash tips, clock-out.

| Role | Path | Tests |
|------|------|------:|
| FE | [`terminal/scenes/server-checkout.test.js`](#server-checkouttestjs) | 19 |
| BE | [`backend/tests/test_server_shift.py`](#test_server_shiftpy) | 18 |
| BE | [`backend/tests/test_server_shift_extended.py`](#test_server_shift_extendedpy) | 16 |

---

### `server-landing`
Server home screen: active orders, table stats, category sales.

| Role | Path | Tests |
|------|------|------:|
| FE | [`terminal/scenes/server-landing.test.js`](#server-landingtestjs) | 12 |
| BE | [`backend/tests/test_server_shift.py`](#test_server_shiftpy) | 18 |
| BE | [`backend/tests/test_server_shift_extended.py`](#test_server_shift_extendedpy) | 16 |

---

### `transitions`
SceneManager lifecycle: mount/unmount sequencing, working/transactional/interrupt layer teardown. Pure frontend — no backend routes.

| Role | Path | Tests |
|------|------|------:|
| FE | [`terminal/scenes/transitions.test.js`](#transitionstestjs) | 9 |

---

### `half-placement-overlay`
Pizza half-placement selection overlay. Pure UI — item persistence handled by `order-entry`.

| Role | Path | Tests |
|------|------|------:|
| FE | [`terminal/half-placement-overlay.test.js`](#half-placement-overlaytestjs) | 15 |

---

### `pizza-builder-overlay`
Pizza size/crust/topping configurator overlay. Pure UI — submits through `order-entry` routes.

| Role | Path | Tests |
|------|------|------:|
| FE | [`terminal/pizza-builder-overlay.test.js`](#pizza-builder-overlaytestjs) | 17 |

---

### `item-recap` *(component)*
Collapsible per-seat item list with selection, void, and modifier display. Pure UI component.

| Role | Path | Tests |
|------|------|------:|
| FE | [`terminal/components/item-recap.test.js`](#item-recaptestjs) | 36 |

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

## `test_payment_routes_hardware.py`
> Tests for hardware-adjacent payment endpoints (device reload, testing, diagnostics) with mock device fallback when no real hardware is present.

### `test_reload_devices_falls_back_to_mock`
| | |
|---|---|
| **Tests** | POST /reload-devices endpoint returns success with mock device when no hardware_config.db exists |
| **Method** | Calls POST /api/v1/payments/reload-devices via AsyncClient; no real hardware setup; asserts response status=200, reloaded=True, using_mock=True |
| **Pass** | HTTP 200, response.json()["reloaded"]=True, response.json()["using_mock"]=True, active_devices list non-empty |

### `test_test_device_mock_returns_ready`
| | |
|---|---|
| **Tests** | GET /test-device endpoint reports connected + ready status when mock device is loaded |
| **Method** | Calls GET /api/v1/payments/test-device; asserts response indicates mock device in ready state |
| **Pass** | HTTP 200, connected=True, using_mock=True, device="mock", status="ready" |

### `test_spin_diag_mock_path_returns_error`
| | |
|---|---|
| **Tests** | GET /spin-diag returns error dict (not 500) when no real card reader is available |
| **Method** | Calls GET /api/v1/payments/spin-diag; asserts response includes error message mentioning mock or lack of real hardware |
| **Pass** | HTTP 200, response.json() contains "error" key with string mentioning "mock" or "no real" |

---

## `test_payment_routes_refund.py`
> Tests for money-out payment routes: refund processing, bulk tip-zeroing, and batch settlement reconciliation.

### `test_full_refund_emits_payment_refunded_event`
| | |
|---|---|
| **Tests** | Full refund (amount=None) emits PAYMENT_REFUNDED event with the original payment amount |
| **Method** | Seeds a $25 closed order with payment confirmed; calls process_refund with amount=None; queries ledger for PAYMENT_REFUNDED events |
| **Pass** | result["success"]=True, result["refund_amount"]≈25.00, one PAYMENT_REFUNDED event in ledger with amount≈25.00 |

### `test_partial_refund_reduces_remaining_refundable`
| | |
|---|---|
| **Tests** | Multiple partial refunds aggregate; second refund amount may not exceed remaining refundable balance |
| **Method** | Seeds $40 order; refunds $10, then $25; asserts second refund succeeds at the requested $25 (within remaining $30) |
| **Pass** | First refund succeeds, second refund result["refund_amount"]≈25.00 |

### `test_refund_exceeding_remaining_rejected`
| | |
|---|---|
| **Tests** | Refund request exceeding total refundable balance (original payment) raises HTTP 400 |
| **Method** | Seeds $20 order; refunds $15; attempts to refund $10 more (total=$25 > $20); expects HTTPException |
| **Pass** | HTTPException raised with status_code=400, detail contains "exceeds remaining" |

### `test_refund_without_manager_approval_forbidden`
| | |
|---|---|
| **Tests** | Refund without approved_by (whitespace-only) raises HTTP 403 |
| **Method** | Calls process_refund with approved_by="   "; expects HTTPException |
| **Pass** | HTTPException raised with status_code=403 |

### `test_refund_on_missing_order_404s`
| | |
|---|---|
| **Tests** | Refund on non-existent order_id raises HTTP 404 |
| **Method** | Calls process_refund with order_id="nope" (never seeded); expects HTTPException |
| **Pass** | HTTPException raised with status_code=404 |

### `test_refund_on_missing_payment_404s`
| | |
|---|---|
| **Tests** | Refund on non-existent payment_id raises HTTP 404 |
| **Method** | Seeds order but references non-existent payment_id; expects HTTPException |
| **Pass** | HTTPException raised with status_code=404 |

### `test_refund_amount_must_be_positive`
| | |
|---|---|
| **Tests** | Refund amount=0.0 raises HTTP 400 (amount must be > 0) |
| **Method** | Calls process_refund with amount=0.0; expects HTTPException |
| **Pass** | HTTPException raised with status_code=400 |

### `test_zeros_only_card_payments_without_tip_adjusted`
| | |
|---|---|
| **Tests** | zero_unadjusted_tips emits TIP_ADJUSTED(tip_amount=0) only for card payments without prior tip adjustment |
| **Method** | Seeds three orders: card without tip (zero), card with tip (skip), cash (skip); calls zero_unadjusted_tips; checks TIP_ADJUSTED event count |
| **Pass** | zeroed_count=1, exactly two TIP_ADJUSTED events in ledger (one pre-existing, one newly zeroed) |

### `test_scope_by_server_id`
| | |
|---|---|
| **Tests** | zero_unadjusted_tips server_id parameter narrows zeroing to one server's orders |
| **Method** | Seeds unadjusted card payments for emp_A and emp_B; calls zero_unadjusted_tips(server_id="emp_A"); verifies only emp_A's payment is in TIP_ADJUSTED events |
| **Pass** | zeroed_count=1, TIP_ADJUSTED events contain only emp_A's payment_id |

### `test_empty_ledger_zeros_nothing`
| | |
|---|---|
| **Tests** | zero_unadjusted_tips on empty ledger returns zeroed_count=0 |
| **Method** | Calls zero_unadjusted_tips with no prior events; asserts result["zeroed_count"]=0 |
| **Pass** | zeroed_count=0 |

### `test_skips_orders_not_closed`
| | |
|---|---|
| **Tests** | zero_unadjusted_tips includes paid (auto-transitioned) orders, not just closed; unfinalized orders excluded |
| **Method** | Seeds open order with confirmed payment (no ORDER_CLOSED); calls zero_unadjusted_tips; asserts order is eligible (zeroed_count=1) |
| **Pass** | zeroed_count=1 (route filters to "closed"+"paid" statuses) |

### `test_no_device_returns_error`
| | |
|---|---|
| **Tests** | batch_settle with no registered payment device returns error dict (success=False), never raises |
| **Method** | Patches PaymentManager with fresh instance (no devices); calls batch_settle; asserts success=False with error message |
| **Pass** | success=False, error contains "No payment device" |

### `test_mock_device_returns_mock_success`
| | |
|---|---|
| **Tests** | batch_settle with mock device returns success=True, using_mock=True, batch_id="MOCK" |
| **Method** | Patches manager/devices_initialized to force mock setup; calls batch_settle |
| **Pass** | success=True, using_mock=True, batch_id="MOCK" |

### `test_reconciliation_matches_ledger_reports_invariant_ok`
| | |
|---|---|
| **Tests** | Batch settle with real device: processor total matches ledger (card_sales + card_tips) → invariant_ok=True, settlement_diff=0 |
| **Method** | Seeds $20 payment + $3 tip; installs fake device returning $23; calls batch_settle; asserts reconciliation matches |
| **Pass** | success=True, using_mock=False, invariant_ok=True, settlement_diff=0.00, ledger_card_sales=20.00, ledger_card_tips=3.00 |

### `test_reconciliation_drift_surfaces_invariant_failure`
| | |
|---|---|
| **Tests** | Batch settle with processor total != ledger sum: invariant_ok=False, settlement_diff non-zero, but request does not raise |
| **Method** | Seeds $20+$3=$23; fake device returns $25 (drift=+2); calls batch_settle; asserts drift surfaced without exception |
| **Pass** | using_mock=False, invariant_ok=False, settlement_diff=2.00, batch_id="BATCH-0001" (not raising) |

---

## `test_payment_sale_overage.py`
> Tests for overage-as-tip clamping: when card sale > balance_due, backend clamps sale and routes overage to TIP_ADJUSTED event, preserving financial invariants.

### `test_card_overage_clamped_and_emits_tip_adjusted`
| | |
|---|---|
| **Tests** | Card sale exceeding balance_due clamps to balance_due, emits TIP_ADJUSTED for overage, auto-closes order |
| **Method** | Seeds $10 order; posts $12.50 card sale; queries ledger for PAYMENT_CONFIRMED and TIP_ADJUSTED events |
| **Pass** | PAYMENT_CONFIRMED amount=10.00, TIP_ADJUSTED tip_amount=2.50 with same txn ID, ORDER_CLOSED event present |

### `test_card_exact_balance_emits_no_overage_tip`
| | |
|---|---|
| **Tests** | Card sale matching balance_due exactly emits no TIP_ADJUSTED, only PAYMENT_CONFIRMED and ORDER_CLOSED |
| **Method** | Seeds $10 order; posts exactly $10.00 card sale; queries for TIP_ADJUSTED events |
| **Pass** | TIP_ADJUSTED events empty list, ORDER_CLOSED present |

### `test_card_sale_on_already_fully_paid_rejected`
| | |
|---|---|
| **Tests** | Posting a second card sale on fully-paid order raises HTTP 400 |
| **Method** | Seeds $10 order; pays $10; attempts second $5 sale; expects HTTPException |
| **Pass** | HTTPException raised with status_code=400, detail contains "already fully paid" |

---

## `test_payment_validator.py`
> Tests for PaymentValidator: amount checks, tip ceilings, transaction limits, and device availability rules.

### `test_valid_transaction`
| | |
|---|---|
| **Tests** | Valid $50 transaction passes validation with VALID status |
| **Method** | Creates TransactionRequest(amount=50); calls validator.validate(); asserts status=VALID |
| **Pass** | result.status == ValidationStatus.VALID |

### `test_zero_amount_rejected`
| | |
|---|---|
| **Tests** | Transaction amount=0 is rejected per Rule 1 |
| **Method** | Creates request with amount=0; calls validate(); asserts REJECTED, rule="Rule 1" |
| **Pass** | status=REJECTED, rule="Rule 1" |

### `test_negative_amount_rejected`
| | |
|---|---|
| **Tests** | Negative transaction amount is rejected |
| **Method** | Creates request with amount=-10; calls validate(); asserts REJECTED |
| **Pass** | status=REJECTED |

### `test_negative_tip_rejected`
| | |
|---|---|
| **Tests** | Negative tip_amount is rejected per Rule 2 |
| **Method** | Creates request with tip=-5; calls validate(); asserts REJECTED, rule="Rule 2" |
| **Pass** | status=REJECTED, rule="Rule 2" |

### `test_negative_service_charge_rejected`
| | |
|---|---|
| **Tests** | Negative service_charge_amount is rejected per Rule 3 |
| **Method** | Creates request with service_charge=-1; calls validate(); asserts REJECTED, rule="Rule 3" |
| **Pass** | status=REJECTED, rule="Rule 3" |

### `test_exceeds_max_total`
| | |
|---|---|
| **Tests** | Transaction total exceeding max limit is rejected per Rule 4 |
| **Method** | Creates request with amount=9999, tip=2; calls validate(); asserts REJECTED, rule="Rule 4" |
| **Pass** | status=REJECTED, rule="Rule 4" |

### `test_tip_over_dollar_ceiling_needs_approval`
| | |
|---|---|
| **Tests** | Tip exceeding $100 dollar ceiling requires approval per Rule 5 |
| **Method** | Creates request with amount=50, tip=101; calls validate(); asserts NEEDS_APPROVAL, rule="Rule 5" |
| **Pass** | status=NEEDS_APPROVAL, rule="Rule 5" |

### `test_tip_over_percent_ceiling_needs_approval`
| | |
|---|---|
| **Tests** | Tip exceeding 50% of amount requires approval per Rule 5 |
| **Method** | Creates request with amount=20, tip=11 (55%); calls validate(); asserts NEEDS_APPROVAL, rule="Rule 5" |
| **Pass** | status=NEEDS_APPROVAL, rule="Rule 5" |

### `test_tip_within_both_ceilings_valid`
| | |
|---|---|
| **Tests** | Tip within both dollar ($100) and percent (50%) ceilings passes validation |
| **Method** | Creates request with amount=100, tip=40 (40%, under $100); calls validate(); asserts VALID |
| **Pass** | status=VALID |

### `test_device_offline_rejected`
| | |
|---|---|
| **Tests** | Offline device (status=OFFLINE) causes validation rejection per Rule 9 |
| **Method** | Creates mock device (defaults OFFLINE); calls validate with device; asserts REJECTED, rule="Rule 9" |
| **Pass** | status=REJECTED, rule="Rule 9" |

### `test_device_error_rejected`
| | |
|---|---|
| **Tests** | Device in ERROR status causes validation rejection |
| **Method** | Creates mock device, sets status=ERROR; calls validate; asserts REJECTED |
| **Pass** | status=REJECTED |

### `test_device_in_sacred_state_rejected`
| | |
|---|---|
| **Tests** | Device in PROCESSING state (sacred/busy) causes validation rejection per Rule 9 |
| **Method** | Creates mock device, sets status=PROCESSING; calls validate; asserts REJECTED, rule="Rule 9" |
| **Pass** | status=REJECTED, rule="Rule 9" |

### `test_no_device_still_valid`
| | |
|---|---|
| **Tests** | Transaction with device=None (no device passed) still passes validation |
| **Method** | Creates request, calls validate with device=None; asserts status=VALID |
| **Pass** | status=VALID |

---

## `test_phase10_discount_catalog.py`
> Tests for Phase 10 discount catalog CRUD events (created, updated, deactivated, reactivated) emitted via /config/push.

### `test_discount_created_roundtrip`
| | |
|---|---|
| **Tests** | discount.created event with full payload (name, percentage, applies_to, approval flags, created_by) lands in ledger |
| **Method** | Pushes PendingChange with event_type="discount.created"; queries ledger for DISCOUNT_CREATED events; asserts payload fields |
| **Pass** | One DISCOUNT_CREATED event, payload contains discount_id, name, percentage, requires_approval=True, auto_apply=False, created_by |

### `test_discount_created_minimal_payload`
| | |
|---|---|
| **Tests** | discount.created accepts minimal required fields; optional booleans omitted from payload when not sent |
| **Method** | Pushes PendingChange with only required fields (no requires_approval/auto_apply); asserts payload lacks those keys |
| **Pass** | One DISCOUNT_CREATED event, payload has discount_id/name/created_by but no requires_approval/auto_apply keys |

### `test_discount_updated_roundtrip`
| | |
|---|---|
| **Tests** | discount.updated event with fields_changed dict lands in ledger |
| **Method** | Pushes PendingChange with event_type="discount.updated"; asserts DISCOUNT_UPDATED event with fields_changed |
| **Pass** | One DISCOUNT_UPDATED event, payload["fields_changed"]["name"]="Happy Hour 25%", updated_by="mgr_alice" |

### `test_discount_deactivated_roundtrip`
| | |
|---|---|
| **Tests** | discount.deactivated event with deactivated_by and reason lands in ledger |
| **Method** | Pushes PendingChange with event_type="discount.deactivated"; asserts DISCOUNT_DEACTIVATED event with reason |
| **Pass** | One DISCOUNT_DEACTIVATED event, payload includes deactivated_by, reason="Promotion ended" |

### `test_discount_deactivated_no_reason`
| | |
|---|---|
| **Tests** | discount.deactivated accepts optional reason field; omitting reason does not error |
| **Method** | Pushes PendingChange without reason; queries ledger; asserts "reason" key absent from payload |
| **Pass** | One DISCOUNT_DEACTIVATED event, payload lacks "reason" key |

### `test_discount_reactivated_roundtrip`
| | |
|---|---|
| **Tests** | discount.reactivated event with reactivated_by lands in ledger |
| **Method** | Pushes PendingChange with event_type="discount.reactivated"; asserts DISCOUNT_REACTIVATED event |
| **Pass** | One DISCOUNT_REACTIVATED event, payload includes reactivated_by="mgr_bob" |

### `test_discount_full_lifecycle`
| | |
|---|---|
| **Tests** | Four discount events (created → updated → deactivated → reactivated) emitted in one push, all land in ledger |
| **Method** | Pushes all four PendingChanges for same discount_id; asserts result["events_written"]=4 and queries each event type |
| **Pass** | result["events_written"]=4, one event in ledger per type (created, updated, deactivated, reactivated) |

### `test_discount_section_inferred`
| | |
|---|---|
| **Tests** | discount.* events infer section automatically and write without error |
| **Method** | Pushes created/updated/deactivated for same discount; asserts result["events_written"]=4 (deactivated included) |
| **Pass** | result["events_written"]=4, no errors during push |

### `test_event_type_entries_exist`
| | |
|---|---|
| **Tests** | EventType enum contains all four new discount event type entries with correct values |
| **Method** | Asserts EventType enum members DISCOUNT_CREATED, DISCOUNT_UPDATED, DISCOUNT_DEACTIVATED, DISCOUNT_REACTIVATED exist with correct .value strings |
| **Pass** | All four assertions pass: DISCOUNT_CREATED.value="discount.created", etc. |

---

## `test_phase11_tipout_rules.py`
> Tests for Phase 11 tipout rule factories and wiring (rule_created, rule_updated events) emitted via /config/push.

### `test_tipout_rule_created_roundtrip`
| | |
|---|---|
| **Tests** | tipout.rule_created event with rule metadata (name, pool_id, role_ids, percentage, effective_date, created_by) lands in ledger |
| **Method** | Pushes PendingChange with event_type="tipout.rule_created"; queries ledger for TIPOUT_RULE_CREATED event; asserts payload fields |
| **Pass** | One TIPOUT_RULE_CREATED event, payload contains rule_id, name="Bar-to-barback 10%", pool_id, role_ids=["barback"], percentage="10.00", created_by |

### `test_tipout_rule_created_multiple_roles`
| | |
|---|---|
| **Tests** | tipout.rule_created role_ids can carry multiple role references as an array |
| **Method** | Pushes PendingChange with role_ids=["busser", "food_runner", "expo"]; asserts payload role_ids length=3 |
| **Pass** | One TIPOUT_RULE_CREATED event, len(payload["role_ids"])=3 |

### `test_tipout_rule_updated_roundtrip`
| | |
|---|---|
| **Tests** | tipout.rule_updated event with rule_id and fields_changed dict lands in ledger |
| **Method** | Pushes PendingChange with event_type="tipout.rule_updated"; asserts TIPOUT_RULE_UPDATED event with fields_changed |
| **Pass** | One TIPOUT_RULE_UPDATED event, payload["fields_changed"]["percentage"]="12.00", updated_by="mgr_alice" |

### `test_tipout_rule_full_lifecycle`
| | |
|---|---|
| **Tests** | Three tipout events (created → updated → deactivated) emitted in one push, all land in ledger |
| **Method** | Pushes created/updated/deactivated PendingChanges; asserts result["events_written"]=3; queries each event type |
| **Pass** | result["events_written"]=3, one event per type in ledger (created, updated, deactivated) |

### `test_tipout_rule_section_employees`
| | |
|---|---|
| **Tests** | tipout.rule_created and tipout.rule_updated events infer section (employees) and write without error |
| **Method** | Pushes created/updated events; asserts result["events_written"]=2, no errors |
| **Pass** | result["events_written"]=2, push succeeds |

### `test_event_type_entries_exist`
| | |
|---|---|
| **Tests** | EventType enum contains TIPOUT_RULE_CREATED and TIPOUT_RULE_UPDATED entries with correct values |
| **Method** | Asserts EventType enum members exist with correct .value strings |
| **Pass** | TIPOUT_RULE_CREATED.value="tipout.rule_created", TIPOUT_RULE_UPDATED.value="tipout.rule_updated" |

---
## `test_phase12_seat_balance.py`
> Verifies per-seat balance projections built from seat-scoped events and GET /orders/{id}/seats endpoint

### `test_seat_balance_dataclass_exists`
| | |
|---|---|
| **Tests** | SeatBalance dataclass initializes with correct default field values |
| **Method** | Direct instantiation; asserts all fields (seat_number, item_subtotal, discount_total, amount_paid, balance_due, is_paid, is_comped) match expected defaults |
| **Pass** | SeatBalance(seat_number=1) has item_subtotal=0.00, is_paid=False, is_comped=False, etc. |

### `test_item_added_populates_seat_balance`
| | |
|---|---|
| **Tests** | Item events with seat_number populate corresponding seat_balance entries in projected order |
| **Method** | Seed two-seat order via item_added events; project_order() replays events; assert seat_balances dict keys and item subtotals |
| **Pass** | Order has seat_balances[1] and seat_balances[2]; seat 1 item_subtotal=20.00, seat 2 item_subtotal=15.00 |

### `test_item_without_seat_not_in_seat_balances`
| | |
|---|---|
| **Tests** | Items without seat_number do not create seat_balance entries |
| **Method** | Seed order with item that omits seat_number; project_order() and check seat_balances dict |
| **Pass** | seat_balances is empty {} |

### `test_item_removed_updates_seat_balance`
| | |
|---|---|
| **Tests** | ITEM_REMOVED event zeroes items and item_subtotal for that seat |
| **Method** | Seed two-seat order; emit ITEM_REMOVED for seat 1 burger; project_order() |
| **Pass** | Seat 1 items=[], item_subtotal=0.00; seat 2 unchanged at 15.00 |

### `test_seat_discount_applied_reduces_balance`
| | |
|---|---|
| **Tests** | Seat discount application reduces balance_due and updates discount_total |
| **Method** | Seed order; push seat.discount_applied event; project_order(); assert discount_total and balance_due |
| **Pass** | Seat 1: item_subtotal=20.00, discount_total=5.00, balance_due=15.00 |

### `test_seat_discount_voided_restores_balance`
| | |
|---|---|
| **Tests** | Seat discount voiding returns discount_total to zero and restores balance_due |
| **Method** | Seed order; push seat.discount_applied then seat.discount_voided; project_order() |
| **Pass** | Seat 1: discount_total=0.00, balance_due=20.00 |

### `test_seat_comped_marks_is_comped`
| | |
|---|---|
| **Tests** | Seat comp event sets is_comped=True and stores comp_category |
| **Method** | Seed order; push seat.comped event for seat 2; project_order() |
| **Pass** | Seat 2: is_comped=True, comp_category='vip'; seat 1: is_comped=False |

### `test_seat_paid_marks_seat`
| | |
|---|---|
| **Tests** | Seat paid event sets is_paid=True for that seat only |
| **Method** | Seed order; push seat.paid event for seat 1; project_order() |
| **Pass** | Seat 1: is_paid=True; seat 2: is_paid=False |

### `test_payment_confirmed_distributes_to_seats`
| | |
|---|---|
| **Tests** | Payment confirmed event splits amount_paid across participating seats equally |
| **Method** | Seed two-seat order; emit payment_confirmed for 35.00 covering seats 1,2; project_order() |
| **Pass** | Seat 1: amount_paid=17.50; seat 2: amount_paid=17.50 |

### `test_seat_balances_endpoint`
| | |
|---|---|
| **Tests** | GET /orders/{id}/seats returns per-seat breakdown with items, subtotals, discounts |
| **Method** | Seed order; apply discount to seat 1; call orders_mod.get_seat_balances() |
| **Pass** | Response includes order_id, seats list with seat_number, item_subtotal, discount_total, balance_due, items array |

### `test_seat_balances_endpoint_empty_order`
| | |
|---|---|
| **Tests** | Order with no seat-scoped items returns empty seats list |
| **Method** | Seed order_created only (no item_added); call orders_mod.get_seat_balances() |
| **Pass** | result["seats"] == [] |

---

## `test_phase13_cash_variance.py`
> Verifies cash variance calculation by summing float, cash sales, drops, payouts, and refunds since last day.closed

### `test_cash_variance_empty_day`
| | |
|---|---|
| **Tests** | Empty ledger returns zero cash variance components |
| **Method** | Call _compute_cash_variance() with no prior events |
| **Pass** | All fields (float, cash_sales, cash_refunds, drops, payouts, expected_in_drawer) = 0.00 |

### `test_cash_variance_float_only`
| | |
|---|---|
| **Tests** | Float-only variance sums to expected_in_drawer |
| **Method** | Push day.cash_float_updated event for 200.00; call _compute_cash_variance() |
| **Pass** | float=200.00, expected_in_drawer=200.00 |

### `test_cash_variance_with_sales`
| | |
|---|---|
| **Tests** | Cash payment.confirmed adds to cash_sales component |
| **Method** | Push float=100 + payment.confirmed method='cash' for 45.50; call _compute_cash_variance() |
| **Pass** | float=100.00, cash_sales=45.50, expected_in_drawer=145.50 |

### `test_cash_variance_card_payments_ignored`
| | |
|---|---|
| **Tests** | Card payments do not contribute to cash_sales |
| **Method** | Push float=100 + payment.confirmed method='card' for 80.00; call _compute_cash_variance() |
| **Pass** | cash_sales=0.00, expected_in_drawer=100.00 |

### `test_cash_variance_drop_reduces`
| | |
|---|---|
| **Tests** | Cash drop subtracts from expected_in_drawer |
| **Method** | Push float=200 + day.cash_drop=150; call _compute_cash_variance() |
| **Pass** | drops=150.00, expected_in_drawer=50.00 |

### `test_cash_variance_payout_reduces`
| | |
|---|---|
| **Tests** | Cash payout subtracts from expected_in_drawer |
| **Method** | Push float=200 + day.cash_payout=30; call _compute_cash_variance() |
| **Pass** | payouts=30.00, expected_in_drawer=170.00 |

### `test_cash_variance_refund_reduces`
| | |
|---|---|
| **Tests** | Cash refund subtracts from expected_in_drawer despite being counted in sales |
| **Method** | Push float=100 + payment.confirmed cash 50 + payment.refunded cash 50; call _compute_cash_variance() |
| **Pass** | cash_sales=50.00, cash_refunds=50.00, expected_in_drawer=100.00 |

### `test_cash_variance_combined`
| | |
|---|---|
| **Tests** | Full scenario: float + sales - refunds - drops - payouts = expected |
| **Method** | Push float=200 + sales=75 + refund=10 + drop=100 + payout=20; call _compute_cash_variance() |
| **Pass** | expected_in_drawer = 200 + 75 - 10 - 100 - 20 = 145.00 |

---

## `test_phase14_settlement_drift.py`
> Surfaces batch.settlement_failed events in GET /entomology/settlement-drift for operator review

### `test_no_settlement_failures`
| | |
|---|---|
| **Tests** | Empty ledger returns zero failures |
| **Method** | Call get_settlement_drift() with session dict; assert count and failures list |
| **Pass** | count=0, failures=[] |

### `test_settlement_failure_surfaces`
| | |
|---|---|
| **Tests** | Single batch.settlement_failed event appears in endpoint response with all fields |
| **Method** | Push batch.settlement_failed; call get_settlement_drift(); inspect failure object |
| **Pass** | Response includes reason, recon_diff, failed_invariants list, timestamp |

### `test_multiple_failures_sorted_newest_first`
| | |
|---|---|
| **Tests** | Multiple failures are sorted newest-first (reverse chronological order) |
| **Method** | Push three batch.settlement_failed events sequentially; call get_settlement_drift(); check order |
| **Pass** | failures[0].reason='third drift', failures[-1].reason='first drift' |

### `test_settlement_failure_missing_optional_fields`
| | |
|---|---|
| **Tests** | Settlement failure with minimal payload defaults missing fields gracefully |
| **Method** | Push batch.settlement_failed with only reason field; call get_settlement_drift() |
| **Pass** | failure.reason='minimal event', recon_diff=None, failed_invariants=[] |

---

## `test_phase4c_emissions.py`
> Tests emission of discount.voided, seat.overpayment_resolved, and seat.tip_added events

### `test_void_discount_emits_discount_voided_and_refunds_amount`
| | |
|---|---|
| **Tests** | void_discount() emits DISCOUNT_VOIDED event with amount and approved_by metadata |
| **Method** | Seed order; apply_discount; call void_discount(); query ledger for DISCOUNT_VOIDED events |
| **Pass** | One DISCOUNT_VOIDED event with payload containing discount_id, voided_by, amount=2.00 |

### `test_void_discount_with_no_discount_returns_404`
| | |
|---|---|
| **Tests** | Voiding non-existent discount raises exception |
| **Method** | Seed order with no discount; call void_discount(); expect exception |
| **Pass** | Exception raised (404-like behavior) |

### `test_cash_overpayment_emits_overpayment_resolved_change`
| | |
|---|---|
| **Tests** | Cash payment exceeding balance emits seat.overpayment_resolved with resolution='change' |
| **Method** | Seed order 10.00; pay 15.00 cash (no dual pricing); query SEAT_OVERPAYMENT_RESOLVED |
| **Pass** | One SEAT_OVERPAYMENT_RESOLVED event with resolution='change' and amount > 0 |

### `test_first_tip_emits_seat_tip_added_but_second_does_not`
| | |
|---|---|
| **Tests** | First tip adjustment emits seat.tip_added; subsequent tips only emit tip_adjusted |
| **Method** | Seed payment; call adjust_tip() twice; query SEAT_TIP_ADDED and TIP_ADJUSTED |
| **Pass** | SEAT_TIP_ADDED count stays at 1 after both adjustments; TIP_ADJUSTED count=2 |

---

## `test_phase4d_settlement_failure.py`
> Verifies batch.settlement_failed emission when close-day invariants fail

### `test_close_day_emits_settlement_failed_when_invariants_fail`
| | |
|---|---|
| **Tests** | Failing invariant check emits batch.settlement_failed with reason, recon_diff, and failed_invariants list |
| **Method** | Monkeypatch invariant_gate to return failing InvariantResult; call _do_close_day(); query BATCH_SETTLEMENT_FAILED |
| **Pass** | One BATCH_SETTLEMENT_FAILED event with reason='day_close_invariants_failed', recon_diff=0.13, failed_invariants containing name='cash_plus_card_equals_net_plus_tax' |

### `test_close_day_clean_does_not_emit_settlement_failed`
| | |
|---|---|
| **Tests** | Clean close (no invariant failures) emits only BATCH_SUBMITTED and DAY_CLOSED, not BATCH_SETTLEMENT_FAILED |
| **Method** | Call _do_close_day() with no seeded failures; query event types |
| **Pass** | BATCH_SETTLEMENT_FAILED list is empty; BATCH_SUBMITTED and DAY_CLOSED each have count=1 |

---

## `test_phase4e_menu_import.py`
> Verifies menu.import_started / completed / failed lifecycle events around config push path

### `test_menu_push_wraps_started_and_completed`
| | |
|---|---|
| **Tests** | Menu batch is wrapped in MENU_IMPORT_STARTED and MENU_IMPORT_COMPLETED with matching import_id |
| **Method** | Push menu.item_created and menu.category_created via cfg.push_changes(); query event types |
| **Pass** | One MENU_IMPORT_STARTED with expected_event_count=2; one MENU_IMPORT_COMPLETED with event_count=2; both share same import_id |

### `test_non_menu_push_does_not_emit_import_envelope`
| | |
|---|---|
| **Tests** | Non-menu events do not trigger MENU_IMPORT_STARTED/COMPLETED wrapping |
| **Method** | Push employee.created; query MENU_IMPORT_STARTED and MENU_IMPORT_COMPLETED |
| **Pass** | Both event type queries return empty list [] |

### `test_menu_push_failure_emits_import_failed`
| | |
|---|---|
| **Tests** | Failure during menu batch append emits MENU_IMPORT_FAILED with error details and re-raises exception |
| **Method** | Monkeypatch ledger.append_batch to raise RuntimeError; call cfg.push_changes(); restore append_batch; query MENU_IMPORT_FAILED |
| **Pass** | One MENU_IMPORT_FAILED event with reason='forced batch failure', error_type='RuntimeError'; RuntimeError propagates; MENU_ITEM_CREATED list is empty |


---
## `test_phase4f_modifier_crud.py`
> Tests modifier CRUD events (created, updated, price_changed, deactivated, reactivated, 86ed, 86_cleared) flowing through /config/push

### `test_modifier_created_lands_in_ledger`
| | |
|---|---|
| **Tests** | Event type MODIFIER_CREATED is properly recorded with correct payload fields |
| **Method** | Push PendingChange with modifier.created event type, verify ledger contains event with modifier_id, name, and modifier_group_id |
| **Pass** | One MODIFIER_CREATED event recorded with exact payload fields matched |

### `test_modifier_price_changed_carries_delta`
| | |
|---|---|
| **Tests** | Price change event captures both previous and new price plus who changed it |
| **Method** | Push modifier.price_changed event, query ledger for MODIFIER_PRICE_CHANGED, assert delta fields present |
| **Pass** | Event contains previous_price, new_price, and changed_by fields |

### `test_modifier_86ed_and_cleared_roundtrip`
| | |
|---|---|
| **Tests** | 86ed (out-of-stock) and 86_cleared events complete roundtrip through ledger |
| **Method** | Push both modifier.86ed and modifier.86_cleared events, query for both types, verify counts and payloads |
| **Pass** | One MODIFIER_86ED and one MODIFIER_86_CLEARED event with matching reason and cleared_by fields |

### `test_modifier_deactivate_reactivate_roundtrip`
| | |
|---|---|
| **Tests** | Deactivate and reactivate lifecycle events complete roundtrip |
| **Method** | Push modifier.deactivated then modifier.reactivated, verify both event types present in ledger |
| **Pass** | One MODIFIER_DEACTIVATED and one MODIFIER_REACTIVATED event recorded |

### `test_modifier_updated_records_changed_fields`
| | |
|---|---|
| **Tests** | Updated event records which fields changed on a modifier |
| **Method** | Push modifier.updated event with fields_changed list, query ledger for MODIFIER_UPDATED |
| **Pass** | Event contains fields_changed array matching ["name", "sort_order"] |

---

## `test_phase4g_micromods.py`
> Tests micromod dark-ship events through /config/push as scaffolding for overseer rollout

### `test_micromod_created_lands_in_ledger`
| | |
|---|---|
| **Tests** | Micromod creation event records correctly in ledger with all payload fields |
| **Method** | Push micromod.created event, retrieve MICROMOD_CREATED from ledger, assert micromod_id, name, price, and modifier_id |
| **Pass** | One event recorded with micromod_id="micro_ranch" and modifier_id="mod_sauce_on_side" |

### `test_micromod_price_changed_carries_delta`
| | |
|---|---|
| **Tests** | Micromod price change event captures previous and new price |
| **Method** | Push micromod.price_changed event, query for MICROMOD_PRICE_CHANGED, verify delta |
| **Pass** | Event contains previous_price=0.50 and new_price=0.75 |

### `test_micromod_assignment_events_roundtrip`
| | |
|---|---|
| **Tests** | Micromod assignment and unassignment to modifiers complete roundtrip |
| **Method** | Push micromod.assigned_to_modifier then micromod.unassigned_from_modifier events |
| **Pass** | One MICROMOD_ASSIGNED_TO_MODIFIER and one MICROMOD_UNASSIGNED_FROM_MODIFIER event |

### `test_micromod_86_roundtrip`
| | |
|---|---|
| **Tests** | Micromod 86ed (out-of-stock) and 86_cleared events roundtrip |
| **Method** | Push both events, query for MICROMOD_86ED and MICROMOD_86_CLEARED types |
| **Pass** | One event of each type recorded with matching micromod_id |

### `test_micromod_deactivate_reactivate_roundtrip`
| | |
|---|---|
| **Tests** | Micromod deactivate/reactivate lifecycle events complete roundtrip |
| **Method** | Push micromod.deactivated then micromod.reactivated, verify both event types in ledger |
| **Pass** | One MICROMOD_DEACTIVATED and one MICROMOD_REACTIVATED event |

---

## `test_phase4h_modifier_micromod_wiring.py`
> Tests modifier lifecycle projection replay and micromod projection from events, plus broadcast signaling

### `test_modifier_86_reflected_in_projection`
| | |
|---|---|
| **Tests** | Modifier is_86d flag reflects 86ed event in projection |
| **Method** | Seed modifier.group_created, call get_modifier_groups(), verify is_86d=False; push modifier.86ed, re-fetch groups, verify is_86d=True |
| **Pass** | Projection updates is_86d flag from False to True after 86ed event |

### `test_modifier_86_cleared_restores_availability`
| | |
|---|---|
| **Tests** | 86_cleared event resets modifier is_86d flag back to False |
| **Method** | Seed group with 86ed event, push 86_cleared event, verify projection shows is_86d=False |
| **Pass** | Projection reflects is_86d=False after both 86ed and 86_cleared events |

### `test_modifier_deactivate_reactivate_reflected_in_projection`
| | |
|---|---|
| **Tests** | Modifier active flag toggles with deactivate/reactivate events |
| **Method** | Seed group, push deactivated event, verify active=False; push reactivated, verify active=True |
| **Pass** | Projection toggles active flag correctly through lifecycle |

### `test_modifier_price_change_reflected_in_projection`
| | |
|---|---|
| **Tests** | Modifier price updates in projection after price_changed event |
| **Method** | Seed group with price 1.50, push price_changed to 2.00, verify projection shows Decimal("2.00") |
| **Pass** | Projection price matches new_price from event |

### `test_get_micromods_empty_when_no_events`
| | |
|---|---|
| **Tests** | Micromod projection returns empty list with no events |
| **Method** | Create OverseerConfigService with empty ledger, call get_micromods() |
| **Pass** | Returns empty list |

### `test_micromod_created_appears_in_projection`
| | |
|---|---|
| **Tests** | Created micromod appears in projection with all fields and default state |
| **Method** | Push micromod.created event, call get_micromods(), verify all fields including active=True and is_86d=False |
| **Pass** | One micromod in projection with correct id, name, modifier_id, and default flags |

### `test_micromod_price_changed_updates_projection`
| | |
|---|---|
| **Tests** | Micromod price updates in projection after price_changed event |
| **Method** | Create micromod at 0.50, push price_changed to 0.75, verify projection price |
| **Pass** | Projection price equals Decimal("0.75") |

### `test_micromod_86_and_cleared_projection`
| | |
|---|---|
| **Tests** | Micromod is_86d flag toggles with 86ed and 86_cleared events |
| **Method** | Create micromod, push 86ed, verify is_86d=True; push 86_cleared, verify is_86d=False |
| **Pass** | Projection reflects is_86d state changes |

### `test_micromod_deactivate_reactivate_projection`
| | |
|---|---|
| **Tests** | Micromod active flag toggles with deactivate/reactivate events |
| **Method** | Create micromod, push deactivated, verify active=False; push reactivated, verify active=True |
| **Pass** | Projection toggles active flag correctly |

### `test_micromod_assign_unassign_projection`
| | |
|---|---|
| **Tests** | Micromod modifier_id updates with assign/unassign events |
| **Method** | Create micromod, push assigned_to_modifier, verify modifier_id set; push unassigned_from_modifier, verify modifier_id=None |
| **Pass** | modifier_id changes correctly through assignment lifecycle |

### `test_micromod_push_queues_modifiers_broadcast`
| | |
|---|---|
| **Tests** | Pushing micromod.* event queues "modifiers" broadcast section |
| **Method** | Push micromod.created, inspect bg.tasks for broadcast_config_update call, verify "modifiers" in sections arg |
| **Pass** | One task queued with "modifiers" in broadcast sections |

---

## `test_phase5_catalog.py`
> Tests check.table_changed wiring plus item and special events through /config/push

### `test_patch_table_emits_check_table_changed`
| | |
|---|---|
| **Tests** | Patching order table emits check.table_changed event with previous/new values |
| **Method** | Seed order with table="5", call patch_order with table="12", verify CHECK_TABLE_CHANGED event |
| **Pass** | Event contains previous_table="5", new_table="12", and changed_by="srv_alice" |

### `test_patch_same_table_emits_no_event`
| | |
|---|---|
| **Tests** | Patching to same table does not emit event |
| **Method** | Seed order with table="7", patch to table="7", verify no CHECK_TABLE_CHANGED events |
| **Pass** | Empty event list |

### `test_item_price_changed_lands_in_ledger`
| | |
|---|---|
| **Tests** | Item price change event records with previous and new price |
| **Method** | Push item.price_changed event via /config/push, query for ITEM_PRICE_CHANGED |
| **Pass** | Event contains previous_price=10.00 and new_price=11.50 |

### `test_item_deactivate_reactivate_roundtrip`
| | |
|---|---|
| **Tests** | Item deactivate and reactivate events complete roundtrip |
| **Method** | Push both item.deactivated and item.reactivated events, verify both types in ledger |
| **Pass** | One ITEM_DEACTIVATED and one ITEM_REACTIVATED event |

### `test_special_full_lifecycle_roundtrip`
| | |
|---|---|
| **Tests** | Special (promotion) lifecycle events all roundtrip: created, updated, activated, deactivated |
| **Method** | Push all four special.* events, verify each event type recorded in ledger |
| **Pass** | One event of each type (SPECIAL_CREATED, SPECIAL_UPDATED, SPECIAL_ACTIVATED, SPECIAL_DEACTIVATED) |

---

## `test_phase6_staff_config.py`
> Tests 11 staff, timecard, security, and configuration event types through /config/push

### `test_staff_updated_lands`
| | |
|---|---|
| **Tests** | Staff updated event records fields changed list |
| **Method** | Push staff.updated event with fields_changed, query for STAFF_UPDATED |
| **Pass** | Event contains fields_changed=["display_name", "hourly_rate"] |

### `test_staff_role_changed_carries_delta`
| | |
|---|---|
| **Tests** | Staff role change event captures previous and new role lists |
| **Method** | Push staff.role_changed with role deltas, verify event payload |
| **Pass** | Event contains previous_role_ids=["server"] and new_role_ids=["server", "shift_lead"] |

### `test_staff_deactivate_reactivate_roundtrip`
| | |
|---|---|
| **Tests** | Staff deactivate and reactivate events complete roundtrip |
| **Method** | Push both staff.deactivated and staff.reactivated events, verify both types |
| **Pass** | One STAFF_DEACTIVATED and one STAFF_REACTIVATED event |

### `test_clock_edit_records_before_and_after`
| | |
|---|---|
| **Tests** | Clock edit event records field, previous value, new value, and audit info |
| **Method** | Push clock.edit event with all details, query for CLOCK_EDIT |
| **Pass** | Event contains field="clock_out", edited_by="mgr_alice", and reason |

### `test_shift_deleted_records_audit`
| | |
|---|---|
| **Tests** | Shift deletion event records who deleted and why |
| **Method** | Push shift.deleted event, verify SHIFT_DELETED in ledger |
| **Pass** | Event contains deleted_by="mgr_alice" and reason |

### `test_category_deactivate_reactivate_roundtrip`
| | |
|---|---|
| **Tests** | Category deactivate and reactivate events complete roundtrip |
| **Method** | Push both category.deactivated and category.reactivated events |
| **Pass** | One CATEGORY_DEACTIVATED and one CATEGORY_REACTIVATED event |

### `test_tipout_rule_deactivated`
| | |
|---|---|
| **Tests** | Tipout rule deactivation event records rule ID and who deactivated |
| **Method** | Push tipout.rule_deactivated event, query for TIPOUT_RULE_DEACTIVATED |
| **Pass** | Event contains rule_id="rule_1" and deactivated_by="mgr_alice" |

### `test_security_setting_updated_records_delta`
| | |
|---|---|
| **Tests** | Security setting change records before/after values for compliance audit |
| **Method** | Push security.setting_updated with delta, query for SECURITY_SETTING_UPDATED |
| **Pass** | Event contains setting_key, previous_value="30", and new_value="15" |

---

## `test_phase7_day_batch.py`
> Tests 7 day and batch lifecycle events through /config/push

### `test_check_day_locked_roundtrip`
| | |
|---|---|
| **Tests** | Check day locked event records which event triggered the lock |
| **Method** | Push check.day_locked event, query for CHECK_DAY_LOCKED |
| **Pass** | Event contains order_id and locked_by_event="day.closed" |

### `test_flash_report_roundtrip`
| | |
|---|---|
| **Tests** | Flash report event records time window, sales total, and generator |
| **Method** | Push day.flash_report_generated event with window and sales data, verify ledger |
| **Pass** | Event contains window_start, window_end, total_sales=4250.00, and generated_by |

### `test_day_lock_reopen_roundtrip`
| | |
|---|---|
| **Tests** | Day lock and reopen events complete roundtrip with reason for reopening |
| **Method** | Push both day.locked and day.reopened events, verify both types |
| **Pass** | One DAY_LOCKED and one DAY_REOPENED event with reopened_by and reason fields |

### `test_batch_lifecycle_roundtrip`
| | |
|---|---|
| **Tests** | Batch opened, settlement initiated, and reopened events complete lifecycle |
| **Method** | Push all three batch.* events, query for each event type |
| **Pass** | One BATCH_OPENED, one BATCH_SETTLEMENT_INITIATED, and one BATCH_REOPENED event with matching fields |

---
## `test_phase8_seat_financial.py`
> Tests for seat-scoped financial events (discounts, comps, payment voids) and tipout calculation.

### `test_seat_discount_apply_void_roundtrip`
| | |
|---|---|
| **Tests** | Discount lifecycle: applying and voiding a seat discount persists correctly to ledger. |
| **Method** | Push `seat.discount_applied` then `seat.discount_voided` events via `/config/push`; query ledger for both event types. |
| **Pass** | One SEAT_DISCOUNT_APPLIED and one SEAT_DISCOUNT_VOIDED event exist with seat_number=2, amount=5.00. |

### `test_seat_comped_lands`
| | |
|---|---|
| **Tests** | Seat comp event (partial or full write-off) persists with all required fields. |
| **Method** | Push single `seat.comped` event via `/config/push` with comp_category; query ledger. |
| **Pass** | One SEAT_COMPED event exists with comp_category="guest_relations". |

### `test_seat_payment_voided_records_seat_scope`
| | |
|---|---|
| **Tests** | Per-seat payment void records scope (seat_number, payment_id) correctly. |
| **Method** | Push `seat.payment_voided` event with order_id, seat_number, payment_id; query ledger. |
| **Pass** | One SEAT_PAYMENT_VOIDED event with seat_number=1, payment_id="pay_abc". |

### `test_tipout_calculated_roundtrip`
| | |
|---|---|
| **Tests** | Tipout calculation (total amount, recipient breakdown, rule IDs) persists. |
| **Method** | Push `tipout.calculated` event with breakdown array; query ledger. |
| **Pass** | One TIPOUT_CALCULATED event with total_tipout=84.50. |

### `test_tipout_adjusted_and_distributed_roundtrip`
| | |
|---|---|
| **Tests** | Tipout adjustment (per-recipient override) and final distribution both persist. |
| **Method** | Push `tipout.adjusted` then `tipout.distributed` events; query ledger for both. |
| **Pass** | One TIPOUT_ADJUSTED and one TIPOUT_DISTRIBUTED event exist with recipient_count=2. |

---

## `test_phase9_seat_transfer.py`
> Tests for per-seat add/remove/relabel, cross-check transfers, item moves, whole-seat transfers, splits/merges, and reopens.

### `test_check_seat_add_remove_relabel`
| | |
|---|---|
| **Tests** | Per-seat lifecycle: add, relabel, remove persist independently. |
| **Method** | Push `check.seat_added`, `check.seat_relabeled`, `check.seat_removed` events; query ledger. |
| **Pass** | One event of each type exists in ledger. |

### `test_check_seat_cross_check_transfer`
| | |
|---|---|
| **Tests** | Cross-check transfer: sent_out and received events link via order IDs. |
| **Method** | Push `check.seat_sent_out` from o1→o2 and `check.seat_received` on o2; query both event types. |
| **Pass** | Sent event has target_order_id="o2", received event has source_order_id="o1". |

### `test_seat_item_transfer_roundtrip`
| | |
|---|---|
| **Tests** | Item-level transfer within same order: out and received events match on item_id and seat numbers. |
| **Method** | Push `seat.item_transferred_out` and `seat.item_received` events; query ledger. |
| **Pass** | Transferred_out event has item_id="it_steak", received event has source_seat_number=2. |

### `test_whole_seat_transfer_roundtrip`
| | |
|---|---|
| **Tests** | Whole-seat transfer across orders: transferred_out and transferred_in events. |
| **Method** | Push `seat.transferred_out` from o1→o2 and `seat.transferred_in` on o2; query ledger. |
| **Pass** | One SEAT_TRANSFERRED_OUT and one SEAT_TRANSFERRED_IN event exist. |

### `test_seat_split_and_merge`
| | |
|---|---|
| **Tests** | Seat split (one parent to child) and merge (child back to parent) both record correctly. |
| **Method** | Push `seat.split_from` and `seat.merged_into` events; query ledger. |
| **Pass** | Split event has child_seat_number=6, merged event has target_seat_number=2. |

### `test_seat_reopened_lands`
| | |
|---|---|
| **Tests** | Seat reopen event (for late dessert, etc.) persists with reason. |
| **Method** | Push `seat.reopened` event with reason; query ledger. |
| **Pass** | One SEAT_REOPENED event with reason="late dessert". |

---

## `test_physical_integration.py`
> Hardware integration tests gated by environment variables; require real devices on network.

### `test_spin_real_check_status`
| | |
|---|---|
| **Tests** | Dejavoo SPIn device connects and responds with valid status (IDLE/ONLINE/PROCESSING). |
| **Method** | Connect DejavooSPInAdapter to device from KINDPOS_TEST_SPIN_IP:SPIN_PORT; check status. |
| **Pass** | Connected=True, status in (IDLE, ONLINE, PROCESSING). Skipped if KINDPOS_TEST_SPIN_IP not set. |

### `test_spin_real_close_batch`
| | |
|---|---|
| **Tests** | Batch close on real device returns non-error status and non-empty batch_id. |
| **Method** | Connect adapter, call close_batch(), check result status and batch_id. |
| **Pass** | result.status in (SUCCESS, FAILED), result.batch_id is non-empty. Skipped if KINDPOS_TEST_SPIN_IP not set. |

### `test_printer_real_tcp_probe`
| | |
|---|---|
| **Tests** | Thermal receipt printer TCP port probe succeeds on live device. |
| **Method** | Call _tcp_probe(PRINTER_IP, PRINTER_PORT, 3.0 timeout). |
| **Pass** | result=True. Skipped if KINDPOS_TEST_PRINTER_IP not set. |

### `test_kitchen_printer_real_tcp_probe`
| | |
|---|---|
| **Tests** | Impact kitchen printer TCP port probe succeeds on live device. |
| **Method** | Call _tcp_probe(KITCHEN_IP, 9100, 3.0 timeout). |
| **Pass** | result=True. Skipped if KINDPOS_TEST_KITCHEN_IP not set. |

### `test_real_arp_scan_finds_hosts`
| | |
|---|---|
| **Tests** | ARP broadcast + cache scan finds at least one live host on subnet. |
| **Method** | Call _ping_broadcast(SUBNET), then _get_arp_hosts(SUBNET); verify hosts have ip and mac. |
| **Pass** | len(hosts) >= 1, each host has "ip" and "mac" keys. Skipped if KINDPOS_TEST_SUBNET not set. |

### `test_real_probe_host_classifies_printer`
| | |
|---|---|
| **Tests** | _probe_host classifies live thermal printer as "printer" on correct port. |
| **Method** | Call _probe_host(PRINTER_IP, None, ALL_SCAN_PORTS, 3.0); check type and port. |
| **Pass** | result is not None, result["type"]="printer", result["port"] in PRINTER_PORTS. Skipped if KINDPOS_TEST_PRINTER_IP not set. |

---

## `test_pin_hash.py`
> Unit tests for PBKDF2-tagged PIN hashing used by POST /auth/verify-pin.

### `test_hash_is_tagged`
| | |
|---|---|
| **Tests** | Hashed PIN starts with "$pbkdf2-sha256$" tag and is recognized as hashed. |
| **Method** | Call hash_pin("1234"), check prefix and is_hashed(). |
| **Pass** | Hash starts with "$pbkdf2-sha256$" and is_hashed() returns True. |

### `test_hash_is_nondeterministic`
| | |
|---|---|
| **Tests** | Each hash call produces distinct salt; two hashes of same PIN differ. |
| **Method** | Call hash_pin("1234") twice, compare results. |
| **Pass** | hash_pin("1234") != hash_pin("1234"). |

### `test_verify_roundtrip`
| | |
|---|---|
| **Tests** | Correct PIN verifies; wrong PIN and empty PIN both fail. |
| **Method** | Hash "1234", verify against "1234" (pass), "0000" (fail), "" (fail). |
| **Pass** | verify_pin_hash("1234", hash) is True; verify_pin_hash("0000", hash) and verify_pin_hash("", hash) are False. |

### `test_verify_accepts_legacy_plaintext`
| | |
|---|---|
| **Tests** | Verify accepts plaintext PINs (pre-migration ledger entries) alongside hashed. |
| **Method** | Call verify_pin_hash("1234", "1234") and verify_pin_hash("0000", "1234"). |
| **Pass** | verify_pin_hash("1234", "1234") is True; verify_pin_hash("0000", "1234") is False. |

### `test_verify_rejects_empty_stored`
| | |
|---|---|
| **Tests** | Empty stored PIN string is never valid. |
| **Method** | Call verify_pin_hash with various inputs against empty string. |
| **Pass** | verify_pin_hash("1234", "") and verify_pin_hash("", "") both return False. |

### `test_verify_rejects_malformed_tag`
| | |
|---|---|
| **Tests** | Malformed tagged hash (broken count or missing parts) does not silently fall through to plaintext. |
| **Method** | Call verify_pin_hash("1234", "$pbkdf2-sha256$not-a-number$x$y") and similar malformed hashes. |
| **Pass** | Both return False (do not match). |

### `test_ensure_hashed_pin_is_idempotent`
| | |
|---|---|
| **Tests** | Feeding already-hashed PIN returns it unchanged; result still verifies against original plaintext. |
| **Method** | Hash "1234" once, pass hash through ensure_hashed_pin again, compare. |
| **Pass** | ensure_hashed_pin(once) == ensure_hashed_pin(hash_result); verify_pin_hash("1234", result) is True. |

### `test_is_hashed_boundary`
| | |
|---|---|
| **Tests** | is_hashed() correctly distinguishes plaintext, plaintext numbers, and hashed PINs. |
| **Method** | Call is_hashed(""), is_hashed("1234"), is_hashed(hash_pin("1234")). |
| **Pass** | is_hashed("") and is_hashed("1234") are False; is_hashed(hash_pin("1234")) is True. |

---

## `test_pos_system.py`
> Comprehensive POS system tests covering financial accuracy, transaction flow, hardware integration, concurrency, reporting, resilience, and user permissions.

### `test_tax_on_single_item`
| | |
|---|---|
| **Tests** | Single-item tax calculation: $10.00 item × 0.07 = $0.70 tax, total $10.70. |
| **Method** | Create order, add $10 item, project order with 7% tax rate. |
| **Pass** | subtotal=$10.00, tax=$0.70, total=$10.70. |

### `test_tax_after_flat_discount`
| | |
|---|---|
| **Tests** | Tax applied after discount: $50 item − $5 discount, tax on $45 = $3.15, total $48.15. |
| **Method** | Add item, push DISCOUNT_APPROVED event, project order. |
| **Pass** | discount_total=$5.00, tax=$3.15, total=$48.15. |

### `test_tax_rounding_half_up`
| | |
|---|---|
| **Tests** | Tax rounding via ROUND_HALF_UP: $10.05 × 0.07 = 0.7035 → 0.70. |
| **Method** | Add $10.05 item, project with TAX_RATE=0.07. |
| **Pass** | tax=$0.70, total=$10.75. |

### `test_modifier_pricing_with_quantity`
| | |
|---|---|
| **Tests** | Modifier applies per-item-quantity: $10 item + $1.50 modifier, qty 2 = $23.00 subtotal. |
| **Method** | Add item qty 2, apply $1.50 modifier, project. |
| **Pass** | subtotal=$23.00. |

### `test_split_payment_balance_tracking`
| | |
|---|---|
| **Tests** | Balance due decreases correctly across multiple partial payments. |
| **Method** | Create order (total $53.50), pay $20, verify balance=$33.50; pay $33.50, verify balance=$0 and is_fully_paid. |
| **Pass** | amount_paid=$53.50, balance_due=$0.00, is_fully_paid=True. |

### `test_split_payment_three_way`
| | |
|---|---|
| **Tests** | Three payments totaling exact amount fully pay the order. |
| **Method** | Create order, make three $10.70 payments (card, card, cash), project. |
| **Pass** | amount_paid=$32.10, is_fully_paid=True, status="paid". |

### `test_overpayment_negative_balance`
| | |
|---|---|
| **Tests** | Cash overpayment results in negative balance (change owed). |
| **Method** | Create order total $5.35, pay $10 cash, project. |
| **Pass** | balance_due=−$4.65 (negative). |

### `test_penny_accumulation_100_items`
| | |
|---|---|
| **Tests** | 100 items at $0.01 each accumulate to exactly $1.00 (no floating-point drift). |
| **Method** | Add 100 items at $0.01 each, project. |
| **Pass** | subtotal=$1.00. |

### `test_discount_exceeding_subtotal_clamped`
| | |
|---|---|
| **Tests** | Discount larger than subtotal clamps taxable to 0; total becomes $0. |
| **Method** | Add $3 item, apply $5 discount, project. |
| **Pass** | discount_total=$5.00, tax=$0.00, total=$0.00. |

### `test_tip_precision_rounding`
| | |
|---|---|
| **Tests** | Fractional tip amounts round correctly via money_round(). |
| **Method** | Call money_round on 2.6666666, 2.665, 2.664. |
| **Pass** | 2.6666666→$2.67, 2.665→$2.67 (half-up), 2.664→$2.66. |

### `test_size_based_pricing_and_included_modifiers`
| | |
|---|---|
| **Tests** | Size-based modifier repricing and included (zero-price) modifiers both project correctly. |
| **Method** | Add Large Pizza $20, apply Pepperoni $3.50, apply Cheese $0; add Medium Pizza $15 with Pepperoni $2.50; project. |
| **Pass** | Large+mods=$23.50, full subtotal=$41.00. |

### `test_full_lifecycle`
| | |
|---|---|
| **Tests** | Complete order flow: create → add → send → pay → close. |
| **Method** | Seed events: ORDER_CREATED, ITEM_ADDED, ITEM_SENT, PAYMENT_INITIATED+CONFIRMED, ORDER_CLOSED. |
| **Pass** | Sequence of statuses: open → open → open → paid → closed; item.sent=True. |

### `test_void_order_with_reason`
| | |
|---|---|
| **Tests** | Voiding an order records reason, approval, and sets status="voided" with voided_at timestamp. |
| **Method** | Create order, add item, push ORDER_VOIDED event with reason and approved_by. |
| **Pass** | status="voided", void_reason="customer walked out", voided_at is not None. |

### `test_void_api_rejects_without_manager`
| | |
|---|---|
| **Tests** | void_order route rejects empty approved_by string with 403. |
| **Method** | Call void_order() with VoidOrderRequest(approved_by=""). |
| **Pass** | HTTPException with status_code=403. |

### `test_reopen_after_close`
| | |
|---|---|
| **Tests** | ORDER_REOPENED event changes status back to "open" and clears closed_at. |
| **Method** | Close order, append ORDER_REOPENED event, project. |
| **Pass** | status="open", closed_at=None. |

### `test_item_removed_reduces_subtotal`
| | |
|---|---|
| **Tests** | Removing an item from order reduces subtotal and item count. |
| **Method** | Add two items ($10 + $5), remove first, project. |
| **Pass** | subtotal=$5.00, len(items)=1. |

### `test_comp_as_discount`
| | |
|---|---|
| **Tests** | DISCOUNT_APPROVED with type=comp reduces order total. |
| **Method** | Add $14 wine, apply $14 comp discount, project. |
| **Pass** | discount_total=$14.00, total=$0.00. |

### `test_modifier_add_then_remove`
| | |
|---|---|
| **Tests** | Adding and removing same modifier (action="remove") leaves base item price only. |
| **Method** | Add $10 item, apply +$2 modifier, then apply same modifier with action="remove". |
| **Pass** | subtotal=$10.00 (after remove). |

### `test_payment_failed_not_counted`
| | |
|---|---|
| **Tests** | PAYMENT_FAILED event does not increase amount_paid or change order status. |
| **Method** | Create order, PAYMENT_INITIATED, then PAYMENT_FAILED. |
| **Pass** | amount_paid=0.00, payments[0].status="failed", order.status="open". |

### `test_refund_full_payment`
| | |
|---|---|
| **Tests** | Full refund on cash payment via process_refund() creates PAYMENT_REFUNDED event. |
| **Method** | Create order, pay $10.70 cash, call process_refund with full amount. |
| **Pass** | result["success"]=True, result["refund_amount"]=$10.70; one PAYMENT_REFUNDED event. |

### `test_refund_partial_amount`
| | |
|---|---|
| **Tests** | Partial refund of $5 on $10.70 payment succeeds. |
| **Method** | Create order, pay $10.70, refund $5. |
| **Pass** | result["refund_amount"]=$5.00. |

### `test_refund_exceeding_payment_rejected`
| | |
|---|---|
| **Tests** | Refunding more than original payment amount is rejected with 400. |
| **Method** | Create order, pay $10.70, try to refund $20. |
| **Pass** | HTTPException with status_code=400, "exceeds" in detail. |

### `test_refund_requires_manager_approval`
| | |
|---|---|
| **Tests** | Refund without manager approval (empty approved_by) rejected with 403. |
| **Method** | Create order, pay, call process_refund with approved_by="". |
| **Pass** | HTTPException with status_code=403. |

### `test_double_close_idempotent`
| | |
|---|---|
| **Tests** | Closing an already-closed order does not corrupt state. |
| **Method** | Create, pay, close, close again. |
| **Pass** | status="closed", total=$10.70 (unchanged). |

### `test_validator_rejects_zero_amount`
| | |
|---|---|
| **Tests** | PaymentValidator rejects zero/negative amount with ValidationStatus.REJECTED. |
| **Method** | Call validator.validate(TransactionRequest(amount=$0)). |
| **Pass** | result.status=REJECTED, "greater than zero" in result.reason. |

### `test_validator_rejects_negative_tip`
| | |
|---|---|
| **Tests** | Negative tip amount rejected with ValidationStatus.REJECTED. |
| **Method** | Call validator.validate(TransactionRequest(tip_amount=−$1)). |
| **Pass** | result.status=REJECTED, "negative" in result.reason. |

### `test_validator_tip_ceiling_needs_approval`
| | |
|---|---|
| **Tests** | Tip > 50% of sale (200% example) returns ValidationStatus.NEEDS_APPROVAL. |
| **Method** | Call validator.validate(TransactionRequest(amount=$100, tip_amount=$200)). |
| **Pass** | result.status=NEEDS_APPROVAL, "ceiling" or "approval" in reason. |

### `test_validator_device_offline_rejected`
| | |
|---|---|
| **Tests** | Payment validation fails if device is OFFLINE. |
| **Method** | Mock device with status=OFFLINE, call validator.validate(). |
| **Pass** | result.status=REJECTED, "unavailable" in reason. |

### `test_validator_sacred_state_rejected`
| | |
|---|---|
| **Tests** | Payment validation fails if device is in sacred state (in_sacred_state=True). |
| **Method** | Mock device with in_sacred_state=True, status=ONLINE, call validator.validate(). |
| **Pass** | result.status=REJECTED, "busy" in reason. |

### `test_print_queue_enqueue_and_retrieve`
| | |
|---|---|
| **Tests** | Print queue persists jobs to SQLite, marks sent/failed, and retries. |
| **Method** | Enqueue job, get_pending_jobs (expect 1), mark_sent, mark_failed, get_failed_jobs (expect 1), reset_for_retry. |
| **Pass** | Enqueued job_id exists; pending/failed counts correct; after retry attempt_count=0. |

### `test_concurrent_appends_unique_sequences`
| | |
|---|---|
| **Tests** | 20 concurrent appends all receive unique sequence numbers (no collisions). |
| **Method** | Create order, concurrently append 20 ITEM_ADDED events. |
| **Pass** | len(set(sequence_numbers)) == 20 (all unique). |

### `test_concurrent_appends_hash_chain_valid`
| | |
|---|---|
| **Tests** | Hash chain remains valid after concurrent writes. |
| **Method** | Concurrently append 20 items, call verify_chain(). |
| **Pass** | is_valid=True. |

### `test_rapid_fire_50_orders`
| | |
|---|---|
| **Tests** | Rapidly create 50 orders and verify projection includes all with correct subtotals. |
| **Method** | Create 50 orders with one $10 item each, project all events. |
| **Pass** | len(orders)==50; all have subtotal=$10.00. |

### `test_concurrent_payments_no_cross_contamination`
| | |
|---|---|
| **Tests** | Parallel payments on different orders don't bleed between orders. |
| **Method** | Create 5 orders, concurrently pay all, verify each has exactly one payment of $10.70. |
| **Pass** | Each order: amount_paid=$10.70, len(payments)==1. |

### `test_event_ordering_preserved`
| | |
|---|---|
| **Tests** | Events for same order replay in ascending sequence_number order. |
| **Method** | Add 10 items to order, retrieve events, check sequence_numbers are sorted. |
| **Pass** | seqs == sorted(seqs). |

### `test_high_volume_projection`
| | |
|---|---|
| **Tests** | 200+ events on one order project correctly (subtotal, item count). |
| **Method** | Add 200 items at $0.50 each, project. |
| **Pass** | subtotal=$100.00, len(items)==200. |

### `test_day_summary_totals_match_projections`
| | |
|---|---|
| **Tests** | Sum of projected order totals matches manual aggregation. |
| **Method** | Seed two closed orders, project all, sum totals. |
| **Pass** | Sum of closed/paid orders' totals matches order1.total + order2.total. |

### `test_voided_orders_excluded_from_net_sales`
| | |
|---|---|
| **Tests** | Voided orders do not count in net sales calculation. |
| **Method** | Seed two orders, void first, filter for non-voided. |
| **Pass** | Only one non-voided order remains (order 2). |

### `test_tip_report_matches_events`
| | |
|---|---|
| **Tests** | Sum of TIP_ADJUSTED event amounts matches reported tip total. |
| **Method** | Seed orders with tip on second, sum TIP_ADJUSTED payloads. |
| **Pass** | Sum of event tip_amounts == 12.40. |

### `test_server_filter_only_returns_their_orders`
| | |
|---|---|
| **Tests** | Filtering orders by server_id returns only that server's orders. |
| **Method** | Seed Alice (2 orders), Bob (1 order), filter by server_id. |
| **Pass** | Alice orders: 2, Bob orders: 1. |

### `test_batch_submitted_totals_match`
| | |
|---|---|
| **Tests** | BATCH_SUBMITTED event payload totals match order projections. |
| **Method** | Seed orders, push BATCH_SUBMITTED event with total_amount, cash_total, card_total. |
| **Pass** | Payload totals match order.total, order1.total (cash), order2.total (card). |

### `test_day_closed_boundary`
| | |
|---|---|
| **Tests** | Events after DAY_CLOSED not included in previous day query. |
| **Method** | Close day after two orders, create new order, query from last close sequence. |
| **Pass** | New order appears in post-boundary results; old orders do not. |

### `test_cash_vs_card_breakdown`
| | |
|---|---|
| **Tests** | cash_total + card_total equals sum of confirmed payments. |
| **Method** | Seed orders with mixed payment methods, sum confirmed payments by method. |
| **Pass** | cash + card == order1.total + order2.total. |

### `test_discount_reduces_net_sales`
| | |
|---|---|
| **Tests** | Discount reduces net sales: net = subtotal − discount. |
| **Method** | Add $50 item, apply $10 discount, project. |
| **Pass** | discount_total=$10.00; net (subtotal) = $40.00. |

### `test_committed_events_survive_reopen`
| | |
|---|---|
| **Tests** | Events committed to ledger survive close and reopen (normal shutdown resilience). |
| **Method** | Create order with item, close ledger, reopen, query events and project. |
| **Pass** | Events found, order projects correctly with subtotal=$10.00. |

### `test_hash_chain_valid_after_reopen`
| | |
|---|---|
| **Tests** | Hash chain remains valid after ledger close/reopen. |
| **Method** | Append 10 orders, close/reopen, verify_chain(). |
| **Pass** | is_valid=True. |

### `test_event_sync_tracking`
| | |
|---|---|
| **Tests** | mark_synced() and get_unsynced_events() track sync state correctly. |
| **Method** | Create order, get_unsynced_events (expect 2), mark_synced, get_unsynced_events (expect 0). |
| **Pass** | Initially 2 unsynced; after mark_synced, 0 unsynced. |

### `test_print_queue_survives_restart`
| | |
|---|---|
| **Tests** | Print queue jobs persist to SQLite and survive close/reopen. |
| **Method** | Enqueue job, close queue, reopen, get_pending_jobs. |
| **Pass** | Job found with same job_id. |

### `test_new_write_after_reopen_extends_chain`
| | |
|---|---|
| **Tests** | Writing new events after reopen correctly extends hash chain. |
| **Method** | Create order, close/reopen, add item, verify_chain(). |
| **Pass** | Chain valid, count==2 events. |

### `test_clock_in_creates_event`
| | |
|---|---|
| **Tests** | USER_LOGGED_IN event records employee_id. |
| **Method** | Append user_logged_in("emp-1", "Alice"), query by event type. |
| **Pass** | One USER_LOGGED_IN event with employee_id="emp-1". |

### `test_clock_out_creates_event`
| | |
|---|---|
| **Tests** | USER_LOGGED_OUT event is created after login. |
| **Method** | Append both USER_LOGGED_IN and USER_LOGGED_OUT, query both. |
| **Pass** | One of each event type. |

### `test_clocked_in_set_tracking`
| | |
|---|---|
| **Tests** | Replaying login/logout events computes clocked-in set correctly. |
| **Method** | Log in emp-1 and emp-2, log out emp-1; build clocked_in dict from sorted events. |
| **Pass** | emp-2 in clocked_in, emp-1 not in clocked_in. |

### `test_tip_ceiling_manager_approval_required`
| | |
|---|---|
| **Tests** | Tip ceiling validation: $200 tip on $100 sale returns NEEDS_APPROVAL. |
| **Method** | Call validator.validate(amount=$100, tip_amount=$200). |
| **Pass** | result.status=NEEDS_APPROVAL. |

### `test_void_approved_by_recorded_in_payload`
| | |
|---|---|
| **Tests** | ORDER_VOIDED event payload includes approved_by when provided. |
| **Method** | Void order with approved_by="mgr-42", query events. |
| **Pass** | Void event payload has approved_by="mgr-42". |

### `test_void_api_enforces_manager_approval`
| | |
|---|---|
| **Tests** | void_order route rejects empty/whitespace approved_by with 403; accepts valid manager ID. |
| **Method** | Call void_order with empty approved_by (expect 403), then with "mgr-1" (expect success). |
| **Pass** | Empty string → HTTPException(403); "mgr-1" → status="voided". |

---

## `test_precision_gate.py`
> Tests for monetary precision checking in EventLedger; verifies 2 decimal place enforcement.

### `test_check_monetary_precision_clean`
| | |
|---|---|
| **Tests** | Clean 2dp monetary values pass precision check. |
| **Method** | Call _check_monetary_precision({"price": 10.00, "amount": 5.50}). |
| **Pass** | Returns empty list []. |

### `test_check_monetary_precision_3dp`
| | |
|---|---|
| **Tests** | 3dp value (10.333) is flagged as bad precision. |
| **Method** | Call _check_monetary_precision({"price": 10.333}). |
| **Pass** | Returns list with one error containing "price=10.333". |

### `test_check_monetary_precision_multiple_bad`
| | |
|---|---|
| **Tests** | Multiple bad-precision keys are all flagged. |
| **Method** | Call _check_monetary_precision({"price": 1.111, "amount": 2.222}). |
| **Pass** | Returns list of 2 errors; both "price" and "amount" found. |

### `test_check_monetary_precision_non_monetary_keys_ignored`
| | |
|---|---|
| **Tests** | Non-monetary keys (e.g., quantity) with bad precision are not flagged. |
| **Method** | Call _check_monetary_precision({"name": "test", "quantity": 3.333}). |
| **Pass** | Returns empty list []. |

### `test_check_monetary_precision_integers_ok`
| | |
|---|---|
| **Tests** | Integer monetary values (e.g., price=10) pass (no decimal part). |
| **Method** | Call _check_monetary_precision({"price": 10}). |
| **Pass** | Returns empty list []. |

### `test_check_monetary_precision_none_values_ok`
| | |
|---|---|
| **Tests** | None values in monetary fields do not fail precision check. |
| **Method** | Call _check_monetary_precision({"price": None}). |
| **Pass** | Returns empty list []. |

### `test_ledger_rejects_bad_precision`
| | |
|---|---|
| **Tests** | EventLedger.append() rejects event with 3dp amount with ValueError. |
| **Method** | Create event with amount=10.333, call ledger.append(). |
| **Pass** | Raises ValueError("non-2dp monetary values..."); count_events()==0. |

### `test_ledger_accepts_valid_precision`
| | |
|---|---|
| **Tests** | EventLedger.append() accepts event with clean 2dp amount. |
| **Method** | Create event with amount=10.33, call ledger.append(). |
| **Pass** | Returns appended event with sequence_number >= 1; count_events()==1. |


---
## `test_print_context_builder.py`
> Tests receipt context builder for sales recap, server checkout, and guest receipts; pins monetary keys and invariants to prevent silent drift.

### `test_happy_path_cash_and_card`
| | |
|---|---|
| **Tests** | Two orders (cash + card payment) produce correct totals, tips, and P&L balance |
| **Method** | `build_sales_recap_context()` with seeded order ledger; asserts gross_sales, voids, refunds, discounts, net_sales, cash/card breakdown, tips, cash_expected, checks, avg_check |
| **Pass** | All money fields match expected values; P&L identity, tender reconciliation, and tips partition invariants all pass |

### `test_voided_orders_roll_into_voids_line`
| | |
|---|---|
| **Tests** | Regression fix: voided orders roll into both gross and voids so P&L identity holds |
| **Method** | One live order (5.00), one voided order (20.00); `build_sales_recap_context()` asserts voids_total=20, gross=25, net=5 |
| **Pass** | voids_total is 20 (not 0); P&L identity check_pnl_identity passes |

### `test_discount_and_refund_are_separate`
| | |
|---|---|
| **Tests** | Refunds and discounts must not collide—refunds go to refunds_total, not voids |
| **Method** | One order with 5.00 discount (paid 25.00), one with 10.00 refund (paid 40.00); asserts discounts=5, refunds=10, voids=0, net=55 |
| **Pass** | refunds_total and discounts_total are distinct; net is correctly 70 − 5 − 10 = 55 |

### `test_category_sales_are_grouped`
| | |
|---|---|
| **Tests** | Category sales list groups items and sorts by total descending |
| **Method** | One order with Pizza (12+12), Drinks (3); `build_sales_recap_context()` extracts category_sales list, builds dict by name |
| **Pass** | Pizza total=24 count=2, Drinks total=3 count=1; Pizza first (higher total) |

### `test_cash_expected_uses_canonical_formula`
| | |
|---|---|
| **Tests** | Cash Expected = Cash Sales − Card Tips (not gross − everything) |
| **Method** | One cash order (20), one card with tip (50 + 8 tip); `build_sales_recap_context()` asserts cash_expected=12 |
| **Pass** | cash_expected is 20 − 8 = 12 |

### `test_empty_day_does_not_explode`
| | |
|---|---|
| **Tests** | Zero orders produce valid printable context without errors |
| **Method** | No orders seeded; `build_sales_recap_context()` on empty ledger |
| **Pass** | Returns dict with total_checks=0, gross/net=0, avg_check=0, cash_expected=0 |

### `test_split_tender_order`
| | |
|---|---|
| **Tests** | One order paid by cash + card; each payment lands in correct bucket |
| **Method** | One 60.00 order: 25 cash, 35 card with 5 tip; `build_sales_recap_context()` asserts breakdown |
| **Pass** | cash_sales=25, card_sales=35, card_tips=5, cash_tips=0, total_tips=5 |

### `test_build_sales_recap_context_v2_open`
| | |
|---|---|
| **Tests** | v2 API: returns simplified dict with cob_status='Open' when no DAY_CLOSED event |
| **Method** | One closed order; `build_sales_recap_context("date")` with no day_closed event; asserts cob_status and Decimal fields |
| **Pass** | cob_status='Open', total_sales=Decimal("10.00"), cash_sales/card_sales/tips as Decimal |

### `test_build_sales_recap_context_v2_closed`
| | |
|---|---|
| **Tests** | v2 API: returns simplified dict with cob_status='Closed' from stored DAY_CLOSED event |
| **Method** | Seed DAY_CLOSED event with totals; `build_sales_recap_context(date)` asserts state comes from event |
| **Pass** | cob_status='Closed', all fields match event (100.00 sales, 30 cash, 70 card, 15 tips, 5 checks) |

### `test_happy_path_one_server`
| | |
|---|---|
| **Tests** | Server checkout for one server: two orders (cash + card), correct totals and cc_transactions |
| **Method** | Two orders under emp_A; `build_server_checkout_context(emp_A)` asserts sales, voids, tips, transactions |
| **Pass** | checks_closed=2, gross/net=30, cash=12, card=18, cc_tips=3, cc_transactions length=1 |

### `test_refunds_go_to_refunds_total_not_voids`
| | |
|---|---|
| **Tests** | Regression: refunds were mis-routed to voids_total in server checkout |
| **Method** | One order with 10.00 refund (40 gross); `build_server_checkout_context()` asserts refunds_total=10, voids=0, net=30 |
| **Pass** | refunds_total=10, voids_total=0, net_sales=30 |

### `test_voided_orders_owned_by_server_flow_into_voids`
| | |
|---|---|
| **Tests** | Server's voided checks land in their receipt's voids line |
| **Method** | Two orders under emp_A (one 15 live, one 25 voided); `build_server_checkout_context()` asserts voids, gross, net |
| **Pass** | voids_total=25, gross=40, net=15; P&L identity passes |

### `test_other_server_orders_excluded`
| | |
|---|---|
| **Tests** | Filtering by server_id is strict—another server's sales don't leak in |
| **Method** | emp_A order (10), emp_B order (100); `build_server_checkout_context(emp_A)` asserts only emp_A |
| **Pass** | checks_closed=1, gross_sales=10, cash_sales=10, card_sales=0 |

### `test_declared_cash_tips_flow_into_gross_tips`
| | |
|---|---|
| **Tests** | Server declares cash tips; gross_tips = cc_tips + declared_cash_tips |
| **Method** | One card order with 2.00 cc_tip; `build_server_checkout_context()` with declared_cash_tips=5; asserts gross_tips=7 |
| **Pass** | cc_tips_total=2, declared_cash_tips=5, gross_tips=7 |

### `test_clock_times_populate_shift_duration`
| | |
|---|---|
| **Tests** | CLOCK_IN / CLOCK_OUT events produce shift duration formatted as "Xh Ym" |
| **Method** | USER_LOGGED_IN + order + USER_LOGGED_OUT; `build_server_checkout_context()` asserts clock_in, clock_out, shift_duration |
| **Pass** | clock_in and clock_out not None, shift_duration contains "h" and "m" |

### `test_empty_server_day_is_safe`
| | |
|---|---|
| **Tests** | Server with no closed orders produces valid receipt context |
| **Method** | `build_server_checkout_context()` for non-existent server_id |
| **Pass** | checks_closed=0, gross/net sales=0, cc_transactions=[] |

### `test_build_server_checkout_context_v2`
| | |
|---|---|
| **Tests** | v2 API: returns simplified dict with checks as list of {check_number, total, tip} and clock times |
| **Method** | One card order under server; USER_LOGGED_IN/OUT; `build_server_checkout_context()` asserts checks list and Decimal fields |
| **Pass** | server_name='V2 Server', clock_in/out not None, checks is list with 1 item (number, total=10, tip=2) |

---

## `test_print_context_builder_extended.py`
> Extended tests for kitchen context, station filtering, reprint flag, not-found errors, and clock hours context.

### `test_kitchen_context_basic`
| | |
|---|---|
| **Tests** | Kitchen context renders order_id, station_name, ticket_type, and item list |
| **Method** | Seed order with Burger + Soda; `build_kitchen_context(oid, station_name)` asserts structure |
| **Pass** | order_id matches, station_name='Hot Line', ticket_type='ORIGINAL', items list has 2 elements |

### `test_kitchen_context_station_filter`
| | |
|---|---|
| **Tests** | station_categories filters items; matched items go to items, rest to companion_items |
| **Method** | Three items (Grill, Cold, Bar); `build_kitchen_context(station_categories=["Grill"])` asserts split |
| **Pass** | items has 1 (Steak), companion_items has 2 (Salad, Beer) |

### `test_kitchen_context_reprint_flag`
| | |
|---|---|
| **Tests** | is_reprint=True sets ticket_type to 'REPRINT' |
| **Method** | Seed order; `build_kitchen_context(is_reprint=True)` asserts ticket_type |
| **Pass** | ticket_type='REPRINT' |

### `test_kitchen_context_unknown_order_raises`
| | |
|---|---|
| **Tests** | Unknown order_id raises ValueError with "not found" message |
| **Method** | `build_kitchen_context("nonexistent-order-id")` |
| **Pass** | ValueError raised, message contains "not found" |

### `test_clock_hours_one_completed_shift`
| | |
|---|---|
| **Tests** | One completed shift (2 hours) produces clock_in, clock_out, duration, and daily_hours |
| **Method** | USER_LOGGED_IN (2h ago), USER_LOGGED_OUT (1h ago); `build_clock_hours_context()` asserts fields |
| **Pass** | clock_in/out not None, shift_duration="1h 0m", at least 1 daily_hours entry with hours != "--" |

### `test_clock_hours_no_shifts`
| | |
|---|---|
| **Tests** | No shifts produce clock_in=None, empty shift_duration, and all daily_hours blank |
| **Method** | `build_clock_hours_context()` for non-existent employee_id |
| **Pass** | clock_in=None, clock_out=None, shift_duration="", all daily_hours entries have hours="--" |

---

## `test_print_dispatcher.py`
> Tests background print queue drainer: render, printer resolution, job processing, retry logic, failure broadcasts, and lifecycle.

### `test_receipt_template_rendered_with_receipt_formatter`
| | |
|---|---|
| **Tests** | guest_receipt + receipt printer_type renders non-empty bytes |
| **Method** | `dispatcher._render("guest_receipt", ctx, printer_type="receipt")` with minimal guest receipt context |
| **Pass** | Returns bytes, len > 0 |

### `test_kitchen_template_rendered_with_kitchen_formatter`
| | |
|---|---|
| **Tests** | kitchen_ticket + kitchen printer_type renders non-empty bytes |
| **Method** | `dispatcher._render("kitchen_ticket", ctx, printer_type="kitchen")` with items |
| **Pass** | Returns bytes, len > 0 |

### `test_unknown_template_raises_value_error`
| | |
|---|---|
| **Tests** | Unknown template_id raises ValueError with "Unknown template" message |
| **Method** | `dispatcher._render("not_a_template", {}, printer_type="receipt")` |
| **Pass** | ValueError with "Unknown template" in message |

### `test_cross_bucket_fallback`
| | |
|---|---|
| **Tests** | Template found in other bucket (kitchen template requested as receipt) still renders |
| **Method** | `dispatcher._render("kitchen_ticket", ctx, printer_type="receipt")` exercises fallback lookup |
| **Pass** | Returns bytes, len > 0 |

### `test_legacy_default_keys`
| | |
|---|---|
| **Tests** | DEFAULT_RECEIPT and DEFAULT_KITCHEN resolve to hardcoded fallback IPs and correct types |
| **Method** | `dispatcher._resolve_printer("DEFAULT_RECEIPT")` and `("DEFAULT_KITCHEN")` asserts IP, port, type |
| **Pass** | DEFAULT_RECEIPT resolves to FALLBACK_IPS["DEFAULT_RECEIPT"], port=PRINTER_PORT, type="receipt"; same for kitchen |

### `test_db_lookup_returns_ip_port_type`
| | |
|---|---|
| **Tests** | Registered MAC in hardware_config.db returns row's ip, port, type |
| **Method** | Create hardware.db with device row (AA:BB:CC:DD:EE:FF → 10.0.0.42, 9100, kitchen); `_resolve_printer(mac)` |
| **Pass** | ip="10.0.0.42", port=9100, ptype="kitchen" |

### `test_db_row_missing_ip_uses_type_fallback`
| | |
|---|---|
| **Tests** | Device row with NULL IP falls back to type-based default IP |
| **Method** | hardware.db row (mac, NULL ip, 9100, kitchen); `_resolve_printer(mac)` |
| **Pass** | ip equals _TYPE_FALLBACK_IPS["kitchen"], ptype="kitchen" |

### `test_unknown_mac_raises`
| | |
|---|---|
| **Tests** | Unregistered MAC with no type heuristic raises ValueError "No IP found" |
| **Method** | Empty hardware.db; `_resolve_printer("DE:AD:BE:EF:00:01")` |
| **Pass** | ValueError raised, "No IP found" in message |

### `test_name_based_type_fallback`
| | |
|---|---|
| **Tests** | MAC string containing 'kitchen' or 'receipt' resolves via name heuristic |
| **Method** | `_resolve_printer("some-kitchen-printer")` with no hardware.db |
| **Pass** | ip=_TYPE_FALLBACK_IPS["kitchen"], ptype="kitchen" |

### `test_success_path_marks_completed`
| | |
|---|---|
| **Tests** | Happy path: mark_sent → render → resolve → send → mark_completed |
| **Method** | `dispatcher._process_job(job)` with valid guest_receipt context and fake _send; asserts queue calls |
| **Pass** | mark_sent and mark_completed in queue.names(), no mark_failed, sent_payloads has 1 entry |

### `test_transient_failure_resets_for_retry`
| | |
|---|---|
| **Tests** | Send raises ConnectionRefusedError → bump_attempt_for_retry, no mark_failed, no broadcast |
| **Method** | Fake _send raises; attempt_count=0; `_process_job()` with subscribe_failures() |
| **Pass** | mark_sent and bump_attempt_for_retry in names, no mark_failed, failures queue empty |

### `test_exceeds_max_attempts_marks_failed_and_broadcasts`
| | |
|---|---|
| **Tests** | attempt_count reaches MAX_ATTEMPTS and send fails → mark_failed + broadcast failure to subscribers |
| **Method** | attempt_count=MAX_ATTEMPTS−1, _send raises; `_process_job()` with subscribe_failures() |
| **Pass** | mark_failed in queue.names(), failure message in broadcast (type="print_failure", includes job_id and error) |

### `test_already_past_max_attempts_short_circuits`
| | |
|---|---|
| **Tests** | Job with attempt_count > MAX_ATTEMPTS marked failed without send attempt |
| **Method** | attempt_count=MAX_ATTEMPTS+5; `_process_job()` with fake _send tracking |
| **Pass** | send_attempts empty (no socket attempt), mark_failed called once, broadcast received |

### `test_render_failure_marks_failed_immediately`
| | |
|---|---|
| **Tests** | Template render ValueError (unknown template) marks FAILED immediately without retry |
| **Method** | template_id="bogus_template", attempt_count=0; `_process_job()` |
| **Pass** | mark_failed in names, bump_attempt_for_retry not in names |

### `test_subscribe_returns_new_queue`
| | |
|---|---|
| **Tests** | subscribe_failures() returns distinct queues added to _failure_subscribers |
| **Method** | Call subscribe_failures() twice, compare identity and membership |
| **Pass** | q1 is not q2, both in dispatcher._failure_subscribers |

### `test_unsubscribe_removes_queue`
| | |
|---|---|
| **Tests** | unsubscribe_failures(q) removes q from _failure_subscribers |
| **Method** | Subscribe, then unsubscribe; assert membership |
| **Pass** | q not in dispatcher._failure_subscribers after unsubscribe |

### `test_unsubscribe_unknown_queue_is_a_noop`
| | |
|---|---|
| **Tests** | Double-unsubscribe or unknown queue unsubscribe must not raise |
| **Method** | Create queue not from subscribe(), call unsubscribe_failures(q) |
| **Pass** | No exception |

### `test_broadcast_fans_out_to_all_subscribers`
| | |
|---|---|
| **Tests** | _broadcast_failure sends same message to all subscribed queues |
| **Method** | Subscribe 2 queues, broadcast failure dict with job_id/error |
| **Pass** | Both q1 and q2 receive identical message with correct job_id and error |

### `test_broadcast_drops_when_subscriber_queue_is_full`
| | |
|---|---|
| **Tests** | Slow subscriber (queue at maxsize) does not block dispatcher—broadcast drops |
| **Method** | Add slow queue to _failure_subscribers, fill it, broadcast |
| **Pass** | No QueueFull raised, slow queue still at size 1 (original item, not broadcast) |

### `test_start_then_stop_is_clean`
| | |
|---|---|
| **Tests** | start() schedules loop task, stop() cancels and awaits it |
| **Method** | `dispatcher.start()`, assert _task set and _running=True; `dispatcher.stop()` |
| **Pass** | After stop: _running=False, _task.done() |

### `test_stop_before_start_does_not_crash`
| | |
|---|---|
| **Tests** | stop() before start() is safe (no _task to cancel) |
| **Method** | `dispatcher.stop()` on fresh dispatcher |
| **Pass** | No exception, _running=False |

---

## `test_print_queue.py`
> Tests PrintJobQueue: enqueue/dequeue, status transitions, retry/recovery, and idempotency.

### `test_enqueue_returns_job_id`
| | |
|---|---|
| **Tests** | enqueue() returns a non-empty string job_id |
| **Method** | `queue.enqueue()` with standard kwargs |
| **Pass** | job_id is str, len > 0 |

### `test_enqueue_and_get_pending`
| | |
|---|---|
| **Tests** | Three enqueued jobs appear in get_pending_jobs() |
| **Method** | Enqueue 3 jobs with different order_ids; `get_pending_jobs()` |
| **Pass** | Returns list of 3 jobs |

### `test_mark_sent`
| | |
|---|---|
| **Tests** | mark_sent(job_id, attempt) excludes job from pending, sets status='sent' and attempt_count |
| **Method** | Enqueue, mark_sent(1); get_pending_jobs() and direct DB check |
| **Pass** | pending list empty, DB row status='sent' and attempt_count=1 |

### `test_mark_completed`
| | |
|---|---|
| **Tests** | mark_completed() removes job from pending (sent state) |
| **Method** | Enqueue, mark_sent, mark_completed; get_pending_jobs() |
| **Pass** | pending list empty |

### `test_mark_failed`
| | |
|---|---|
| **Tests** | mark_failed() moves job to failed and removes from pending |
| **Method** | Enqueue, mark_failed; get_failed_jobs() and get_pending_jobs() |
| **Pass** | failed list has 1 job, pending list empty |

### `test_reset_for_retry`
| | |
|---|---|
| **Tests** | reset_for_retry() changes failed job back to queued status |
| **Method** | Enqueue, mark_failed, reset_for_retry; get_pending_jobs() |
| **Pass** | pending has 1 job with status='queued' and attempt_count=0 |

### `test_dismiss_job`
| | |
|---|---|
| **Tests** | dismiss_job() removes job from both pending and failed |
| **Method** | Enqueue, dismiss_job; get_pending_jobs() and get_failed_jobs() |
| **Pass** | Both lists empty |

### `test_multiple_jobs_order`
| | |
|---|---|
| **Tests** | Jobs returned from pending in creation order (FIFO) |
| **Method** | Enqueue 3 jobs; get_pending_jobs() |
| **Pass** | Job order matches enqueue order |

### `test_completed_not_in_pending`
| | |
|---|---|
| **Tests** | Completed job excluded from pending, new pending job visible |
| **Method** | Enqueue 2 jobs, mark_sent/completed on first; get_pending_jobs() |
| **Pass** | Pending has 1 job with order_id='order-002' |

### `test_enqueue_idempotent_while_queued`
| | |
|---|---|
| **Tests** | Same (order, template, mac, copy) enqueued twice while queued returns same job_id |
| **Method** | enqueue(kwargs), enqueue(same kwargs); assert j1==j2, pending has 1 job |
| **Pass** | j1 == j2 (no duplicate), pending count = 1 |

### `test_enqueue_idempotent_while_sent`
| | |
|---|---|
| **Tests** | Same params enqueued while job in 'sent' status also returns existing job_id |
| **Method** | enqueue, mark_sent, enqueue(same); assert j1==j2 |
| **Pass** | j1 == j2 |

### `test_enqueue_not_idempotent_after_completed`
| | |
|---|---|
| **Tests** | Same params enqueued after job completes create new job (e.g. reprint) |
| **Method** | enqueue, mark_sent, mark_completed, enqueue(same); assert j1!=j2 |
| **Pass** | j1 != j2, pending has 1 job with j2's id |

### `test_recover_stale_sent_jobs`
| | |
|---|---|
| **Tests** | 'sent' jobs with stale last_attempt_at reset to 'queued' (crashed mid-send recovery) |
| **Method** | Enqueue, mark_sent, backdate last_attempt_at to 120s ago; recover_stale_sent_jobs(60) |
| **Pass** | recovered count = 1, pending has 1 job with status='queued' |

### `test_bump_attempt_for_retry_preserves_count`
| | |
|---|---|
| **Tests** | bump_attempt_for_retry resets status to 'queued' while keeping attempt_count |
| **Method** | Enqueue, mark_sent(2), bump_attempt_for_retry(2); get_pending_jobs() |
| **Pass** | Pending has 1 job, status='queued', attempt_count=2 (not reset to 0) |

### `test_recover_does_not_touch_recent_sent`
| | |
|---|---|
| **Tests** | Recent 'sent' jobs (still in-flight) not recovered by stale-job recovery |
| **Method** | Enqueue, mark_sent (no backdate); recover_stale_sent_jobs(60) |
| **Pass** | recovered count = 0, pending remains empty |

---

## `test_print_templates.py`
> Tests template rendering: BaseTemplate helpers, GuestReceiptTemplate, and KitchenTicketTemplate.

### `test_base_template_format_time`
| | |
|---|---|
| **Tests** | _format_time converts ISO timestamp to 12-hour time ("02:30 PM") |
| **Method** | BaseTemplate()._format_time("2025-06-15T14:30:00+00:00") |
| **Pass** | Returns "02:30 PM" |

### `test_base_template_format_time_none`
| | |
|---|---|
| **Tests** | _format_time returns "N/A" for None input |
| **Method** | BaseTemplate()._format_time(None) |
| **Pass** | Returns "N/A" |

### `test_base_template_format_datetime`
| | |
|---|---|
| **Tests** | _format_datetime converts ISO to "MM/DD/YYYY HH:MM AM/PM" |
| **Method** | BaseTemplate()._format_datetime("2025-06-15T14:30:00+00:00") |
| **Pass** | Returns "06/15/2025 02:30 PM" |

### `test_base_template_wrap_text`
| | |
|---|---|
| **Tests** | _wrap_text word-wraps text to given width |
| **Method** | _wrap_text("Hello world foo bar baz", width=12) |
| **Pass** | Returns list of 2+ lines, line 0 = "Hello world", line 1 contains "foo" |

### `test_base_template_reprint_header`
| | |
|---|---|
| **Tests** | render() with is_reprint=True includes "** REPRINT **" header |
| **Method** | BaseTemplate().render({'is_reprint': True, 'original_fired_at': '2025-06-15T14:30:00Z'}) |
| **Pass** | First command contains "** REPRINT **" |

### `test_guest_receipt_render_basic`
| | |
|---|---|
| **Tests** | GuestReceiptTemplate renders minimal guest receipt with restaurant, items, totals, cut |
| **Method** | GuestReceiptTemplate(80).render(_guest_receipt_context()) |
| **Pass** | Returns list of dicts; text commands include restaurant name; SUBTOTAL/TOTAL present; ends with cut |

### `test_guest_receipt_card_payment_has_tip_section`
| | |
|---|---|
| **Tests** | Card payment receipts include TIP: section |
| **Method** | render(payment_method='card') |
| **Pass** | Contents include "TIP:" |

### `test_guest_receipt_customer_dine_in_tip_suggestions`
| | |
|---|---|
| **Tests** | Customer copy, dine_in, card payment shows TIP SUGGESTIONS with 15%, 18%, 20% |
| **Method** | render(payment_method='card', copy_type='customer', order_type='dine_in', subtotal=100) |
| **Pass** | Contents include "TIP SUGGESTIONS:", "15%", "18%", "20%" |

### `test_guest_receipt_empty_items`
| | |
|---|---|
| **Tests** | Empty items list renders without error |
| **Method** | render(items=[]) |
| **Pass** | Returns list, ends with cut |

### `test_kitchen_ticket_render_basic`
| | |
|---|---|
| **Tests** | KitchenTicketTemplate renders order_id, station, items, modifiers, cut |
| **Method** | KitchenTicketTemplate(80).render(_kitchen_ticket_context()) |
| **Pass** | Returns list; text commands present; ends with cut |

### `test_kitchen_ticket_modifiers_string`
| | |
|---|---|
| **Tests** | String modifiers auto-detect prefix ([NO] Onion, [ADD] Jalapeño, [SUB] GF Bun) |
| **Method** | render(items=[{modifiers: ['No Onion', 'Add Jalapeño', 'Sub GF Bun']}]) |
| **Pass** | Text includes "1x Burger", "[NO] Onion", "[ADD] Jalapeño", "[SUB] GF Bun" |

### `test_kitchen_ticket_modifiers_dict`
| | |
|---|---|
| **Tests** | Dict modifiers with 'action' field render prefixes from action (add, remove, substitute) |
| **Method** | render(items=[{modifiers: [{'name': 'Extra Cheese', 'action': 'add'}, ...]}]) |
| **Pass** | Text includes "[ADD] Extra Cheese", "[NO] Pickles", "[SUB] Wheat Bun" |

### `test_kitchen_ticket_no_modifiers_clean`
| | |
|---|---|
| **Tests** | Items with empty modifiers list produce no indented blank lines |
| **Method** | render(items=[{modifiers: []}]) |
| **Pass** | Text includes "1x Plain Fries", no lines starting with 6-space indent |

### `test_separator_width_80mm`
| | |
|---|---|
| **Tests** | 80mm divider commands produce correct char width in formatter output |
| **Method** | KitchenTicketTemplate(80).render(), extract dividers, format with ESCPOSFormatter(80) |
| **Pass** | Dividers exist, formatted output contains expected character * 33 |

### `test_separator_width_58mm`
| | |
|---|---|
| **Tests** | 58mm divider commands produce correct char width in formatter output |
| **Method** | KitchenTicketTemplate(58).render(), extract dividers, format with ESCPOSFormatter(58) |
| **Pass** | Dividers exist, formatted output contains expected character * 32 |

---

## `test_print_templates_money.py`
> Tests money templates (SalesRecapTemplate, ServerCheckoutTemplate, ClockHoursTemplate, DeliveryReceiptTemplate) for all section headers, money values, and conditional logic.

### `test_happy_path_renders_every_section`
| | |
|---|---|
| **Tests** | All sections render: REVENUE/PAYMENTS/CATEGORY/STATS headers, money values, deductions as negative, cut |
| **Method** | SalesRecapTemplate().render(_balanced_ctx()) asserts text blob contents |
| **Pass** | Contains "REVENUE", "PAYMENTS", "SALES BY CATEGORY", "CHECK STATS", all money values, cut |

### `test_refund_line_only_appears_when_nonzero`
| | |
|---|---|
| **Tests** | Refunds row only appears if refunds_total > 0 |
| **Method** | render(refunds_total=0) and render(refunds_total=4.50) |
| **Pass** | Zero case: "Refunds" absent; nonzero: "Refunds" and "-$4.50" present |

### `test_voids_and_comps_gated_on_count_or_total`
| | |
|---|---|
| **Tests** | Zero voids and comps suppress both section labels |
| **Method** | render(voids_total=0, voids_count=0, comps_total=0, comps_count=0) |
| **Pass** | "Voids" and "Comps" absent |

### `test_category_sales_section_suppressed_when_empty`
| | |
|---|---|
| **Tests** | Empty category_sales list suppresses "SALES BY CATEGORY" section |
| **Method** | render(category_sales=[]) |
| **Pass** | "SALES BY CATEGORY" absent |

### `test_tip_total_only_rendered_when_nonzero`
| | |
|---|---|
| **Tests** | Tip Total section only appears if total_tips > 0 |
| **Method** | render(total_tips=0.0) |
| **Pass** | "Tip Total" absent |

### `test_period_header_uses_date_range_when_different`
| | |
|---|---|
| **Tests** | date_from != date_to renders "Period: YYYY-MM-DD - YYYY-MM-DD" |
| **Method** | render(date_from="2026-04-15", date_to="2026-04-17") |
| **Pass** | Text includes "Period: 2026-04-15 - 2026-04-17" |

### `test_money_line_formatter_both_signs`
| | |
|---|---|
| **Tests** | _money_line positive → "$X.XX", negative → "-$X.XX"; both same length |
| **Method** | tpl._money_line("Label", 12.50, 20) and _money_line("Label", -12.50, 20) |
| **Pass** | pos contains "Label" + "$12.50", neg contains "Label" + "-$12.50", len(pos)==len(neg) |

### `test_empty_context_does_not_crash` (SalesRecapTemplate)
| | |
|---|---|
| **Tests** | Empty dict renders printable skeleton without error |
| **Method** | SalesRecapTemplate().render({}) |
| **Pass** | Returns list, includes cut command |

### `test_reprint_header_appears_when_flagged`
| | |
|---|---|
| **Tests** | is_reprint=True and original_fired_at includes "REPRINT" in output |
| **Method** | render(is_reprint=True, original_fired_at="2026-04-17T18:30:00+00:00") |
| **Pass** | Text includes "REPRINT" |

### `test_happy_path_renders_all_sections` (ServerCheckoutTemplate)
| | |
|---|---|
| **Tests** | ServerCheckoutTemplate renders SALES SUMMARY, CHECK STATS, PAYMENT, TIPS, TIP-OUT sections |
| **Method** | ServerCheckoutTemplate().render(_ctx()) |
| **Pass** | Contains all section headers, money values, "Alice", "CASH EXPECTED", cut |

### `test_voids_and_comps_collapse_into_deductions`
| | |
|---|---|
| **Tests** | voids + comps + discounts combined into one "Voids / Comps" line with total deduction |
| **Method** | render(voids=3, comps=2, discounts=5) |
| **Pass** | Text includes "Voids / Comps" and "-$10.00" |

### `test_no_deductions_label_hidden`
| | |
|---|---|
| **Tests** | All zero voids/comps/discounts suppress "Voids / Comps" label |
| **Method** | render() with default zero deductions |
| **Pass** | "Voids / Comps" absent |

### `test_recap_mode_adds_card_detail_section`
| | |
|---|---|
| **Tests** | mode='recap' adds card type breakdown (Visa/MC) with totals |
| **Method** | render(mode="recap", card_types=[{"label": "Visa", "total": 80}, ...]) |
| **Pass** | Text includes "Visa", "MC", "Total Card" |

### `test_cash_expected_equals_cash_minus_cc_tips_in_box`
| | |
|---|---|
| **Tests** | Cash box shows: cash_sales − cc_tips = CASH EXPECTED |
| **Method** | render(cash_sales=100, cc_tips=25, cash_expected=75) |
| **Pass** | Text includes "$100.00", "-$25.00", "CASH EXPECTED", "$75.00" |

### `test_empty_context_does_not_crash` (ServerCheckoutTemplate)
| | |
|---|---|
| **Tests** | Empty dict renders without error |
| **Method** | ServerCheckoutTemplate().render({}) |
| **Pass** | Returns list, includes cut |

### `test_clock_out_renders_shift_duration`
| | |
|---|---|
| **Tests** | action='CLOCK OUT' includes shift duration, total hours, daily breakdown |
| **Method** | ClockHoursTemplate().render(_ctx()) with clock_out |
| **Pass** | Text includes "CLOCK OUT", "Alice Smith", "SHIFT HOURS: 8h 15m", "TOTAL HOURS: 24.75", daily entries |

### `test_clock_in_hides_duration_shows_in_progress`
| | |
|---|---|
| **Tests** | action='CLOCK IN' (no clock_out) shows "Shift in progress..." not duration |
| **Method** | render(action="CLOCK IN") without clock_out |
| **Pass** | Text includes "CLOCK IN", "Shift in progress", no "SHIFT HOURS" |

### `test_daily_breakdown_lines_appear`
| | |
|---|---|
| **Tests** | Daily hours breakdown renders labels and hour values |
| **Method** | render() with daily_hours list |
| **Pass** | Text includes "Mon 04/13", "Tue 04/14", "8.0" |

### `test_empty_daily_list_still_renders`
| | |
|---|---|
| **Tests** | Empty daily_hours list still renders total |
| **Method** | render(daily_hours=[]) |
| **Pass** | Text includes "TOTAL HOURS" |

### `test_empty_context_does_not_crash` (ClockHoursTemplate)
| | |
|---|---|
| **Tests** | Empty dict renders without error |
| **Method** | ClockHoursTemplate().render({}) |
| **Pass** | Returns list, includes cut |

### `test_cash_on_delivery_renders_amount_due_and_tip_signature_block`
| | |
|---|---|
| **Tests** | Cash payment status renders AMOUNT DUE, TIP, SIGNATURE blocks |
| **Method** | DeliveryReceiptTemplate().render(_ctx(payment_status="cash")) |
| **Pass** | Text includes restaurant, "CASH ON DELIVERY", check#, customer, address, "AMOUNT DUE", total, "TIP:", "SIGNATURE:" |

### `test_prepaid_shows_thank_you_no_amount_due_block`
| | |
|---|---|
| **Tests** | payment_status='prepaid' shows "PAID -- THANK YOU", no AMOUNT DUE or signature |
| **Method** | render(payment_status="prepaid") |
| **Pass** | Text includes "PREPAID", "PAID -- THANK YOU", no "AMOUNT DUE" or "SIGNATURE" |

### `test_card_on_delivery_matches_cash_block_shape`
| | |
|---|---|
| **Tests** | payment_status='card' renders "CARD ON DELIVERY" and AMOUNT DUE |
| **Method** | render(payment_status="card") |
| **Pass** | Text includes "CARD ON DELIVERY", "AMOUNT DUE", total |

### `test_totals_render_with_dollar_signs`
| | |
|---|---|
| **Tests** | Subtotal, delivery fee, tax, total all render with dollar signs |
| **Method** | render() with standard context |
| **Pass** | All four money values present in text |

### `test_delivery_fee_hidden_when_zero`
| | |
|---|---|
| **Tests** | Zero delivery_fee suppresses "Delivery Fee" line |
| **Method** | render(delivery_fee=0.0) |
| **Pass** | "Delivery Fee" absent |

### `test_item_modifier_lines_indented_under_item`
| | |
|---|---|
| **Tests** | Modifiers render indented under their items |
| **Method** | render() with items containing modifiers |
| **Pass** | Text includes "Large Pizza" and "No cheese" in order |

### `test_empty_items_list_still_renders`
| | |
|---|---|
| **Tests** | No items still renders totals section |
| **Method** | render(items=[]) |
| **Pass** | Text includes "TOTAL" |

---
## `test_printer_api.py`
> Tests for the /api/v1/hardware/* endpoints: SSE streaming network scan, device connectivity test, test print, device persistence, and hardware subsystem status.

### `test_scan_stream_emits_start_and_complete`
| | |
|---|---|
| **Tests** | SSE stream from GET /api/v1/hardware/scan/stream returns start and complete events. |
| **Method** | Makes GET request with ?ip parameter; parses SSE response into JSON objects; checks event types array. |
| **Pass** | Response status 200, events contain both 'start' and 'complete' type entries. |

### `test_scan_stream_start_has_mode`
| | |
|---|---|
| **Tests** | Start event in SSE stream includes the scan mode (direct vs sweep). |
| **Method** | Makes GET request with ?ip; parses SSE events; extracts start event and checks mode field. |
| **Pass** | start event has mode='direct'. |

### `test_scan_stream_direct_multiple_ips`
| | |
|---|---|
| **Tests** | Direct IP mode accepts comma-separated addresses and reports correct total count. |
| **Method** | Makes GET request with comma-separated ?ip values; parses SSE; checks total in start event. |
| **Pass** | Response 200, start event has mode='direct' and total=2 for two IPs. |

### `test_scan_stream_sweep_mode`
| | |
|---|---|
| **Tests** | Without ?ip parameter, scan runs in sweep mode (ARP discovery) instead of direct. |
| **Method** | Makes GET request without ?ip but with ?type parameter; parses SSE start event. |
| **Pass** | start event has mode='sweep' and total is a valid integer. |

### `test_test_requires_mac`
| | |
|---|---|
| **Tests** | POST /api/v1/hardware/test requires mac field. |
| **Method** | Makes POST with empty JSON body. |
| **Pass** | Response status 422 (validation error). |

### `test_test_unknown_mac_returns_not_saved`
| | |
|---|---|
| **Tests** | Testing connectivity on unknown (not saved) MAC returns success=false with message. |
| **Method** | Makes POST /api/v1/hardware/test with unknown MAC. |
| **Pass** | Response 200, success=false, message contains "not saved". |

### `test_test_saved_device_unreachable`
| | |
|---|---|
| **Tests** | Testing a saved device that is unreachable (bad IP) returns success=false. |
| **Method** | POST to /devices to save a device, then POST /test with its MAC; both use unreachable IP. |
| **Pass** | Response 200, success=false, mac echoed in response. |

### `test_test_print_requires_ip`
| | |
|---|---|
| **Tests** | POST /api/v1/hardware/test-print requires ip field. |
| **Method** | Makes POST with empty JSON body. |
| **Pass** | Response status 422. |

### `test_test_print_unreachable`
| | |
|---|---|
| **Tests** | Sending test print to unreachable IP returns success=false. |
| **Method** | Makes POST /api/v1/hardware/test-print with test IP and port. |
| **Pass** | Response 200, success=false. |

### `test_save_requires_fields`
| | |
|---|---|
| **Tests** | POST /api/v1/hardware/devices requires all fields (mac, ip, type, name, port). |
| **Method** | Makes POST with empty JSON body. |
| **Pass** | Response status 422. |

### `test_save_returns_device`
| | |
|---|---|
| **Tests** | POST /api/v1/hardware/devices echoes back the saved device with normalized MAC and timestamp. |
| **Method** | Makes POST with full device config including lowercase MAC; checks response. |
| **Pass** | Response 200, MAC is uppercase, name preserved, saved_at field present. |

### `test_save_upserts_by_mac`
| | |
|---|---|
| **Tests** | Saving a device with same MAC twice updates the record instead of creating duplicate. |
| **Method** | POST same MAC twice with different name; GET /devices to list. |
| **Pass** | GET returns exactly 1 device with updated name. |

### `test_devices_returns_list`
| | |
|---|---|
| **Tests** | GET /api/v1/hardware/devices returns JSON array. |
| **Method** | Makes GET request. |
| **Pass** | Response 200, body is a list. |

### `test_devices_empty_when_none_saved`
| | |
|---|---|
| **Tests** | GET /api/v1/hardware/devices returns empty list when no devices saved. |
| **Method** | Makes GET without saving any devices first. |
| **Pass** | Response 200, body is empty list. |

### `test_saved_devices_have_required_fields`
| | |
|---|---|
| **Tests** | Each saved device in the list has all required fields (mac, ip, type, name, port, saved_at). |
| **Method** | POST a device, then GET /devices; checks all fields present in response. |
| **Pass** | Response contains 1 device with all expected fields including timestamp. |

### `test_delete_removes_device`
| | |
|---|---|
| **Tests** | DELETE /api/v1/hardware/devices/:mac removes the device from the list. |
| **Method** | POST device, DELETE by MAC, then GET /devices. |
| **Pass** | DELETE returns 200 with deleted MAC, subsequent GET returns empty list. |

### `test_status_returns_online`
| | |
|---|---|
| **Tests** | GET /api/v1/hardware/status returns system status and subnet info. |
| **Method** | Makes GET request. |
| **Pass** | Response 200, contains status="online" and default_subnet field. |

---

## `test_printer_detector.py`
> Tests for the printer_detector.py module: data model, pure helper functions (OUI lookup, CIDR parsing, dedup), network helpers with monkeypatched sockets, network scanning with fake port discovery, scan summaries, and stubs that raise NotImplementedError.

### `test_defaults`
| | |
|---|---|
| **Tests** | DiscoveredPrinter fields without explicit values carry sensible defaults. |
| **Method** | Creates DiscoveredPrinter with only ip_address; checks other fields. |
| **Pass** | mac_address="unknown", open_ports=[], protocol="escpos", online_status=True, discovery_method="port_scan". |

### `test_infer_printer_type_kitchen`
| | |
|---|---|
| **Tests** | device_subtype='kitchen' maps to impact printer type. |
| **Method** | Creates DiscoveredPrinter with device_subtype='kitchen'; calls _infer_printer_type(). |
| **Pass** | Returns "impact". |

### `test_infer_printer_type_receipt`
| | |
|---|---|
| **Tests** | device_subtype='receipt' or None maps to thermal printer type. |
| **Method** | Creates DiscoveredPrinter with various device_subtype values; calls _infer_printer_type(). |
| **Pass** | All return "thermal". |

### `test_str_contains_key_fields`
| | |
|---|---|
| **Tests** | __str__ includes IP, MAC, and port list in string representation. |
| **Method** | Creates DiscoveredPrinter with specific IP, MAC, ports; converts to string; checks substring presence. |
| **Pass** | String contains IP, MAC, and port values. |

### `test_to_printer_config_dict_structure`
| | |
|---|---|
| **Tests** | to_printer_config_dict() exports dict with all required PrinterConfig keys. |
| **Method** | Creates DiscoveredPrinter; calls to_printer_config_dict(); checks key presence. |
| **Pass** | Dict contains printer_id, name, printer_type, role, connection_string, location_tag, _discovery_metadata. |

### `test_to_printer_config_dict_connection_string`
| | |
|---|---|
| **Tests** | connection_string format is tcp://<ip>:<port>. |
| **Method** | Creates DiscoveredPrinter with specific IP and port; calls to_printer_config_dict(). |
| **Pass** | connection_string equals "tcp://10.0.0.186:9100". |

### `test_to_printer_config_dict_fallback_port_9100`
| | |
|---|---|
| **Tests** | No open_ports falls back to port 9100 in connection_string. |
| **Method** | Creates DiscoveredPrinter with empty open_ports; checks connection_string. |
| **Pass** | connection_string contains ":9100". |

### `test_to_printer_config_dict_friendly_name_fallback`
| | |
|---|---|
| **Tests** | When friendly_name is None, name falls back to 'Printer at <ip>'. |
| **Method** | Creates DiscoveredPrinter with friendly_name=None; checks name field. |
| **Pass** | name contains the IP address. |

### `test_to_printer_config_dict_role_defaults_to_receipt`
| | |
|---|---|
| **Tests** | device_subtype=None produces role='receipt'. |
| **Method** | Creates DiscoveredPrinter with device_subtype=None; calls to_printer_config_dict(). |
| **Pass** | role='receipt'. |

### `test_to_printer_config_dict_metadata_fields`
| | |
|---|---|
| **Tests** | _discovery_metadata carries mac, manufacturer, and scan_id. |
| **Method** | Creates DiscoveredPrinter with those fields; checks metadata dict. |
| **Pass** | Metadata contains mac_address, manufacturer, and scan_id with correct values. |

### `test_known_epson_oui`
| | |
|---|---|
| **Tests** | _lookup_mac_manufacturer returns "Epson" for known Epson OUI. |
| **Method** | Creates PrinterDiscovery; calls _lookup_mac_manufacturer with Epson MAC. |
| **Pass** | Returns "Epson". |

### `test_known_volcora_oui`
| | |
|---|---|
| **Tests** | _lookup_mac_manufacturer returns "Volcora" for known Volcora OUI. |
| **Method** | Calls _lookup_mac_manufacturer with Volcora MAC. |
| **Pass** | Returns "Volcora". |

### `test_known_star_micronics_oui`
| | |
|---|---|
| **Tests** | _lookup_mac_manufacturer returns "Star Micronics" for known OUI. |
| **Method** | Calls _lookup_mac_manufacturer with Star Micronics MAC. |
| **Pass** | Returns "Star Micronics". |

### `test_unknown_oui_returns_none`
| | |
|---|---|
| **Tests** | Unknown OUI returns None. |
| **Method** | Calls _lookup_mac_manufacturer with non-existent MAC. |
| **Pass** | Returns None. |

### `test_unknown_mac_string_returns_none`
| | |
|---|---|
| **Tests** | Invalid MAC string returns None. |
| **Method** | Calls _lookup_mac_manufacturer with "unknown". |
| **Pass** | Returns None. |

### `test_empty_string_returns_none`
| | |
|---|---|
| **Tests** | Empty string MAC returns None. |
| **Method** | Calls _lookup_mac_manufacturer with "". |
| **Pass** | Returns None. |

### `test_short_mac_returns_none`
| | |
|---|---|
| **Tests** | MAC with fewer than 3 octets cannot build OUI key and returns None. |
| **Method** | Calls _lookup_mac_manufacturer with "AA:BB". |
| **Pass** | Returns None. |

### `test_slash_30_gives_two_hosts`
| | |
|---|---|
| **Tests** | _cidr_to_host_list("/30") returns 2 usable host IPs. |
| **Method** | Calls _cidr_to_host_list with "10.0.0.0/30"; checks length and contents. |
| **Pass** | Returns list with 2 IPs: 10.0.0.1 and 10.0.0.2. |

### `test_slash_24_gives_254_hosts`
| | |
|---|---|
| **Tests** | _cidr_to_host_list("/24") returns 254 usable host IPs. |
| **Method** | Calls _cidr_to_host_list with "192.168.1.0/24"; checks length. |
| **Pass** | Returns list with 254 IPs. |

### `test_network_address_excluded`
| | |
|---|---|
| **Tests** | Network address (.0) is excluded from host list. |
| **Method** | Calls _cidr_to_host_list with /30; checks that .0 is not present. |
| **Pass** | "10.0.0.0" not in list. |

### `test_broadcast_excluded`
| | |
|---|---|
| **Tests** | Broadcast address is excluded from host list. |
| **Method** | Calls _cidr_to_host_list with /30; checks that .3 is not present. |
| **Pass** | "10.0.0.3" not in list. |

### `test_invalid_cidr_returns_empty`
| | |
|---|---|
| **Tests** | Bad CIDR notation returns empty list without exception. |
| **Method** | Calls _cidr_to_host_list with "not-a-cidr". |
| **Pass** | Returns []. |

### `test_host_route_slash32_returns_single_host`
| | |
|---|---|
| **Tests** | /32 host route returns single IP as list. |
| **Method** | Calls _cidr_to_host_list with "10.0.0.1/32". |
| **Pass** | Returns ["10.0.0.1"]. |

### `test_single_printer_passes_through`
| | |
|---|---|
| **Tests** | _deduplicate with single printer passes it through unchanged. |
| **Method** | Creates one DiscoveredPrinter; calls _deduplicate with list. |
| **Pass** | Returns same list with one printer. |

### `test_same_ip_keeps_one`
| | |
|---|---|
| **Tests** | Two printers with same IP deduplicate to one. |
| **Method** | Creates two DiscoveredPrinter at same IP; calls _deduplicate. |
| **Pass** | Returns list with 1 printer. |

### `test_same_ip_prefers_enriched_with_manufacturer`
| | |
|---|---|
| **Tests** | When two records share IP, the one with manufacturer is preferred. |
| **Method** | Creates two DiscoveredPrinter at same IP, one with manufacturer; calls _deduplicate. |
| **Pass** | Returns 1 printer with manufacturer="Epson". |

### `test_same_ip_keeps_first_when_both_unenriched`
| | |
|---|---|
| **Tests** | Two bare records at same IP, first one wins by arrival order. |
| **Method** | Creates two DiscoveredPrinter at same IP with different hostnames; calls _deduplicate. |
| **Pass** | Returns 1 printer with hostname="host-a". |

### `test_different_ips_both_kept`
| | |
|---|---|
| **Tests** | Two printers with different IPs both kept after dedup. |
| **Method** | Creates two DiscoveredPrinter at different IPs; calls _deduplicate. |
| **Pass** | Returns list with 2 printers. |

### `test_empty_list_returns_empty`
| | |
|---|---|
| **Tests** | Deduplicating empty list returns empty. |
| **Method** | Calls _deduplicate with []. |
| **Pass** | Returns []. |

### `test_no_callback_is_noop`
| | |
|---|---|
| **Tests** | _emit with no callback registered is silent. |
| **Method** | Sets on_progress=None; calls _emit. |
| **Pass** | No exception raised. |

### `test_callback_receives_event_type_and_data`
| | |
|---|---|
| **Tests** | _emit invokes on_progress callback with event type and data. |
| **Method** | Sets on_progress to a tracking lambda; calls _emit; checks received tuple. |
| **Pass** | Callback received ("host_found", {"ip": "10.0.0.1"}). |

### `test_callback_error_is_swallowed`
| | |
|---|---|
| **Tests** | A buggy callback in on_progress doesn't crash the scanner. |
| **Method** | Sets on_progress to callback that raises RuntimeError; calls _emit. |
| **Pass** | No exception propagated from _emit. |

### `test_open_port_returns_true`
| | |
|---|---|
| **Tests** | _check_port returns True when socket.connect_ex returns 0 (open). |
| **Method** | Monkeypatches socket to mock; calls _check_port. |
| **Pass** | Returns True. |

### `test_closed_port_returns_false`
| | |
|---|---|
| **Tests** | _check_port returns False when socket.connect_ex returns non-zero (closed). |
| **Method** | Monkeypatches socket to return 111; calls _check_port. |
| **Pass** | Returns False. |

### `test_socket_error_returns_false`
| | |
|---|---|
| **Tests** | _check_port returns False on socket error without exception. |
| **Method** | Monkeypatches socket to raise socket.error; calls _check_port. |
| **Pass** | Returns False. |

### `test_successful_lookup_returns_hostname`
| | |
|---|---|
| **Tests** | _reverse_dns calls socket.gethostbyaddr and returns hostname. |
| **Method** | Monkeypatches socket.gethostbyaddr; calls _reverse_dns. |
| **Pass** | Returns "printer.local". |

### `test_herror_returns_none`
| | |
|---|---|
| **Tests** | _reverse_dns returns None on socket.herror. |
| **Method** | Monkeypatches socket.gethostbyaddr to raise socket.herror; calls _reverse_dns. |
| **Pass** | Returns None. |

### `test_gaierror_returns_none`
| | |
|---|---|
| **Tests** | _reverse_dns returns None on socket.gaierror. |
| **Method** | Monkeypatches socket.gethostbyaddr to raise socket.gaierror; calls _reverse_dns. |
| **Pass** | Returns None. |

### `test_returns_discovered_printers`
| | |
|---|---|
| **Tests** | scan_network returns whatever _port_scan_discovery yields. |
| **Method** | Monkeypatches _port_scan_discovery to return fake printer; calls scan_network. |
| **Pass** | Returns list with 1 printer at expected IP. |

### `test_discovered_printers_stored_on_instance`
| | |
|---|---|
| **Tests** | After scan_network, discovered_printers attribute is populated. |
| **Method** | Calls scan_network; checks scanner.discovered_printers. |
| **Pass** | discovered_printers contains 1 printer. |

### `test_empty_network_returns_empty_list`
| | |
|---|---|
| **Tests** | No printers found in network returns empty result without exception. |
| **Method** | Monkeypatches _port_scan_discovery to return []; calls scan_network. |
| **Pass** | Returns []. |

### `test_deduplication_applied_during_scan`
| | |
|---|---|
| **Tests** | Two printers at same IP are merged to one during scan. |
| **Method** | Monkeypatches _port_scan_discovery to return bare and enriched printer at same IP; calls scan_network. |
| **Pass** | Returns 1 printer with manufacturer="Epson". |

### `test_progress_callback_receives_scan_start_and_complete`
| | |
|---|---|
| **Tests** | on_progress callback receives at least scan_start and scan_complete events. |
| **Method** | Sets on_progress to track event types; calls scan_network; checks received types. |
| **Pass** | received_types contains "scan_start" and "scan_complete". |

### `test_default_method_is_port_scan`
| | |
|---|---|
| **Tests** | scan_network without methods= uses port_scan by default. |
| **Method** | Monkeypatches _port_scan_discovery to log calls; calls scan_network without methods; checks call log. |
| **Pass** | _port_scan_discovery was called once. |

### `test_before_any_scan_duration_is_none`
| | |
|---|---|
| **Tests** | Fresh scanner has no scan timestamps, duration_seconds is None. |
| **Method** | Creates fresh PrinterDiscovery; calls get_scan_summary(). |
| **Pass** | duration_seconds=None, printers_found=0, printers=[]. |

### `test_scan_id_present`
| | |
|---|---|
| **Tests** | get_scan_summary always includes scan_id starting with "scan_". |
| **Method** | Creates PrinterDiscovery; calls get_scan_summary(). |
| **Pass** | summary["scan_id"] starts with "scan_". |

### `test_after_scan_has_positive_duration`
| | |
|---|---|
| **Tests** | After completed scan, duration_seconds is >= 0. |
| **Method** | Monkeypatches _port_scan_discovery; calls scan_network; calls get_scan_summary(). |
| **Pass** | duration_seconds is not None and >= 0. |

### `test_after_scan_printers_listed`
| | |
|---|---|
| **Tests** | Discovered printers appear in summary with expected fields. |
| **Method** | Monkeypatches _port_scan_discovery to return fake printer; calls scan_network; checks summary. |
| **Pass** | printers_found=1, printers[0] has ip_address and manufacturer. |

### `test_mdns_raises_not_implemented`
| | |
|---|---|
| **Tests** | _mdns_discovery stub raises NotImplementedError. |
| **Method** | Calls _mdns_discovery(). |
| **Pass** | Raises NotImplementedError. |

### `test_snmp_raises_not_implemented`
| | |
|---|---|
| **Tests** | _snmp_discovery stub raises NotImplementedError. |
| **Method** | Calls _snmp_discovery(cidr). |
| **Pass** | Raises NotImplementedError. |

### `test_usb_raises_not_implemented`
| | |
|---|---|
| **Tests** | _usb_discovery stub raises NotImplementedError. |
| **Method** | Calls _usb_discovery(). |
| **Pass** | Raises NotImplementedError. |

---

## `test_printer_manager_extended.py`
> Tests for gap coverage: bar-role routing, target_printer_id override, Tier-3 emergency fallback, retry delay verification, status transition events, overheat health warnings, unregister, fallback assignment, and ready printer filtering.

### `test_bar_role_routing`
| | |
|---|---|
| **Tests** | Bar role job routes to printer-bar-01. |
| **Method** | Calls submit_job with target_role="bar"; checks result. |
| **Pass** | success=True, printer_id="printer-bar-01", rerouted_from=None. |

### `test_target_printer_id_override`
| | |
|---|---|
| **Tests** | target_printer_id overrides role-based routing. |
| **Method** | Calls submit_job with target_role="kitchen" but target_printer_id="printer-receipt-01"; checks result. |
| **Pass** | success=True, printer_id="printer-receipt-01", rerouted_from=None. |

### `test_tier3_emergency_fallback`
| | |
|---|---|
| **Tests** | When both IMPACT kitchen printers offline, Tier 3 finds THERMAL printer with matching role. |
| **Method** | Registers THERMAL kitchen printer; takes both IMPACT offline; submits job to primary; checks fallback. |
| **Pass** | success=True, rerouted_from="printer-kitchen-01", printer_id="printer-kitchen-thermal". |

### `test_retry_delay_zeroing`
| | |
|---|---|
| **Tests** | asyncio.sleep called exactly MAX_RETRIES-1 times with RETRY_DELAY during submit_job retry loop. |
| **Method** | Monkeypatches asyncio.sleep; registers printer that always fails; calls submit_job; checks sleep calls. |
| **Pass** | sleep_calls has length MAX_RETRIES-1, all values equal RETRY_DELAY. |

### `test_printer_status_transition_emits_event`
| | |
|---|---|
| **Tests** | check_all_printers emits PRINTER_STATUS_CHANGED when printer transitions ONLINE→OFFLINE. |
| **Method** | Sets printer._fail_mode directly; calls check_all_printers; queries ledger for event. |
| **Pass** | PRINTER_STATUS_CHANGED event exists with previous_status="online", new_status="offline". |

### `test_overheated_emits_health_warning`
| | |
|---|---|
| **Tests** | check_all_printers detects ONLINE→OVERHEATED and emits PRINTER_HEALTH_WARNING. |
| **Method** | Sets printer overheat state (_fail_mode, threshold, count); calls check_all_printers; queries ledger. |
| **Pass** | PRINTER_HEALTH_WARNING event exists with warning_type="overheating". |

### `test_unregister_printer`
| | |
|---|---|
| **Tests** | unregister_printer removes printer from registry. |
| **Method** | Registers extra printer; calls unregister_printer; checks get_all_printers and get_printer. |
| **Pass** | unregister_printer returns True, printer no longer in registry. |

### `test_assign_fallback_routes_correctly`
| | |
|---|---|
| **Tests** | assign_fallback emits PRINTER_FALLBACK_ASSIGNED and enables Tier-1 routing when primary offline. |
| **Method** | Calls assign_fallback; takes primary offline; submits job; checks result and ledger. |
| **Pass** | assign_fallback returns True, event emitted, job routed to backup with rerouted_from set. |

### `test_get_ready_printers_by_role`
| | |
|---|---|
| **Tests** | get_ready_printers_by_role filters offline printers but get_printers_by_role includes all. |
| **Method** | Sets kitchen-01 offline; calls get_ready_printers_by_role and get_printers_by_role for kitchen; checks counts. |
| **Pass** | get_ready_printers_by_role returns 1 (kitchen-02), get_printers_by_role returns 2. |

### `test_target_printer_id_nonexistent_falls_back_to_role`
| | |
|---|---|
| **Tests** | When target_printer_id refers to unregistered printer, falls back to role-based selection. |
| **Method** | Calls submit_job with target_printer_id="printer-does-not-exist"; checks result. |
| **Pass** | success=True, printer_id in ("printer-kitchen-01", "printer-kitchen-02"), rerouted_from=None. |

---

## `test_printer_system.py`
> Comprehensive test suite for the printer adapter system covering: basic printing (thermal/impact), double-print prevention, deliberate reprint, retry on failure, fallback tiers (designated backup and same type+role), all-fail queuing, queue recovery, cash drawer operations, maintenance reboot, health monitoring, custom roles, rush orders, delivery tickets, status summary, and event ledger audit trail with hash chain verification.

### `test_basic_printing`
| | |
|---|---|
| **Tests** | Kitchen ticket and receipt print normally via manager.submit_job. |
| **Method** | Creates kitchen ticket and receipt; calls submit_job for each; asserts success. |
| **Pass** | Both results have success=True. |

### `test_double_print_prevention`
| | |
|---|---|
| **Tests** | Duplicate job_id blocked on second attempt. |
| **Method** | Calls submit_job twice with identical ticket; checks first success and second blocked. |
| **Pass** | First result success=True, second result success=False with error_code="duplicate_blocked". |

### `test_deliberate_reprint`
| | |
|---|---|
| **Tests** | Deliberate reprint allowed when job_type=REPRINT and source_job_id references original. |
| **Method** | Submits original kitchen ticket; creates REPRINT job with source_job_id; submits reprint. |
| **Pass** | Both submit_job calls return success=True. |

### `test_retry_on_failure`
| | |
|---|---|
| **Tests** | Intermittent failure retried silently and succeeds on retry. |
| **Method** | Sets printer fail_mode="intermittent"; submits job; checks success. |
| **Pass** | result.success=True. |

### `test_fallback_tier1_designated`
| | |
|---|---|
| **Tests** | Primary printer fails, fallback uses designated backup (Tier 1). |
| **Method** | Calls assign_fallback; takes primary offline; submits job; checks rerouted_from. |
| **Pass** | success=True, rerouted_from="printer-kitchen-01", printer_id="printer-kitchen-02". |

### `test_fallback_tier2_same_type`
| | |
|---|---|
| **Tests** | No designated backup, discovers same type+role printer (Tier 2). |
| **Method** | Clears fallback, takes primary offline, targets primary; submits job. |
| **Pass** | success=True, rerouted to backup (Tier 2: same type+role). |

### `test_fallback_all_failed`
| | |
|---|---|
| **Tests** | All kitchen printers fail, job queued and error reported. |
| **Method** | Takes all kitchen printers offline; submits job; checks error_code and queue. |
| **Pass** | success=False, error_code="all_printers_failed", queued_jobs > 0. |

### `test_queue_retry`
| | |
|---|---|
| **Tests** | Queued jobs retry when printer recovers and succeed. |
| **Method** | Queues job by failing all printers; recovers printers; calls retry_queued_jobs. |
| **Pass** | Queued jobs after < before, some retries succeed. |

### `test_cash_drawer`
| | |
|---|---|
| **Tests** | open_drawer works via receipt printer, fails on kitchen printer (no drawer). |
| **Method** | Calls open_drawer without printer_id, then with printer_id="printer-kitchen-01". |
| **Pass** | First succeeds, second returns False. |

### `test_maintenance_reboot`
| | |
|---|---|
| **Tests** | maintenance_cycle reboots all printers successfully. |
| **Method** | Calls manager.maintenance_cycle(); checks result values. |
| **Pass** | All reboot results are True. |

### `test_health_check`
| | |
|---|---|
| **Tests** | check_all_printers detects online status and offline state changes. |
| **Method** | Calls check_all_printers; sets printer offline; calls again; verifies statuses. |
| **Pass** | After reboot all ONLINE, after set_fail_mode target is OFFLINE. |

### `test_custom_roles`
| | |
|---|---|
| **Tests** | Custom printer roles can be created, duplicates rejected. |
| **Method** | Calls create_custom_role three times, duplicate on fourth; checks get_available_roles. |
| **Pass** | New roles appear in list, duplicate returns False. |

### `test_rush_order`
| | |
|---|---|
| **Tests** | Rush order marked with priority=RUSH prints with emphasis. |
| **Method** | Creates rush ticket (is_rush=True); calls submit_job. |
| **Pass** | result.success=True. |

### `test_delivery_ticket`
| | |
|---|---|
| **Tests** | Delivery ticket with OrderContext.DELIVERY prints successfully. |
| **Method** | Creates delivery ticket; calls submit_job. |
| **Pass** | result.success=True. |

### `test_status_summary`
| | |
|---|---|
| **Tests** | get_status_summary returns terminal_id, printer counts, roles, and detailed printer list. |
| **Method** | Calls manager.get_status_summary(); checks structure. |
| **Pass** | total_printers=4, summary contains all expected keys and printer details. |

### `test_event_ledger_audit`
| | |
|---|---|
| **Tests** | Event ledger captured all events and hash chain integrity is valid. |
| **Method** | Gets event counts by type; verifies hash chain with ledger.verify_chain(). |
| **Pass** | Multiple event types recorded (>0 for each), verify_chain returns (True, None). |

---

## `test_printing_routes.py`
> Tests for /print/* endpoint handlers: SEC-002 path-traversal guard for /print/test (forward slash, backslash, dotdot rejection with diagnostic logging) and specialist endpoints (clock-hours, sales-recap, server-checkout, queue GET) with correct ticket_number and order_id shapes.

### `test_forward_slash_rejected`
| | |
|---|---|
| **Tests** | Path traversal with forward slash in template_name rejected by /print/test. |
| **Method** | Patches _record_diag and print_queue.enqueue; calls print_test with "../../etc/passwd"; catches HTTPException. |
| **Pass** | Raises HTTPException with status_code=400. |

### `test_backslash_rejected`
| | |
|---|---|
| **Tests** | Backslash path separator rejected by /print/test. |
| **Method** | Patches dependencies; calls print_test with backslash template; catches HTTPException. |
| **Pass** | Raises HTTPException with status_code=400. |

### `test_dotdot_without_slash_rejected`
| | |
|---|---|
| **Tests** | Dotdot (..) without slash rejected by /print/test. |
| **Method** | Patches dependencies; calls print_test with "..secret"; catches HTTPException. |
| **Pass** | Raises HTTPException with status_code=400. |

### `test_record_diag_called_on_traversal`
| | |
|---|---|
| **Tests** | _record_diag called with event_code="SEC-002" when traversal detected. |
| **Method** | Mocks _record_diag; patches print_queue; calls print_test with traversal attempt; checks mock call. |
| **Pass** | mock_diag.assert_awaited_once() passes, call_kwargs["event_code"]=="SEC-002". |

### `test_ticket_number_is_CLK`
| | |
|---|---|
| **Tests** | /print/clock-hours enqueues job with ticket_number="CLK". |
| **Method** | Patches PrintContextBuilder and print_queue.enqueue; calls print_clock_hours; checks enqueue kwargs. |
| **Pass** | result["status"]=="queued", call_kwargs["ticket_number"]=="CLK". |

### `test_order_id_prefixed_with_clock`
| | |
|---|---|
| **Tests** | /print/clock-hours enqueues with order_id prefixed "clock-emp-<id>-". |
| **Method** | Patches dependencies; calls print_clock_hours with employee_id="emp-99"; checks enqueue kwargs. |
| **Pass** | call_kwargs["order_id"] starts with "clock-emp-99-". |

### `test_ticket_number_is_RPT`
| | |
|---|---|
| **Tests** | /print/sales-recap enqueues job with ticket_number="RPT". |
| **Method** | Patches dependencies; calls print_sales_recap; checks enqueue kwargs. |
| **Pass** | result["status"]=="queued", call_kwargs["ticket_number"]=="RPT". |

### `test_order_id_prefixed_with_sales_recap`
| | |
|---|---|
| **Tests** | /print/sales-recap enqueues with order_id starting "sales-recap-". |
| **Method** | Patches dependencies; calls print_sales_recap; checks enqueue kwargs. |
| **Pass** | call_kwargs["order_id"] starts with "sales-recap-". |

### `test_ticket_number_is_CHK`
| | |
|---|---|
| **Tests** | /print/server-checkout enqueues job with ticket_number="CHK". |
| **Method** | Patches dependencies; calls print_server_checkout with server_id="srv-7"; checks enqueue kwargs. |
| **Pass** | result["status"]=="queued", call_kwargs["ticket_number"]=="CHK". |

### `test_order_id_prefixed_with_checkout`
| | |
|---|---|
| **Tests** | /print/server-checkout enqueues with order_id starting "checkout-srv-<id>-". |
| **Method** | Patches dependencies; calls print_server_checkout with server_id="srv-12"; checks enqueue kwargs. |
| **Pass** | call_kwargs["order_id"] starts with "checkout-srv-12-". |

### `test_returns_pending_and_failed_keys`
| | |
|---|---|
| **Tests** | GET /print/queue returns dict with "pending" and "failed" keys. |
| **Method** | Patches print_queue methods; calls get_queue; checks keys. |
| **Pass** | result contains "pending" and "failed". |

### `test_returns_populated_lists`
| | |
|---|---|
| **Tests** | GET /print/queue returns populated pending and failed job lists. |
| **Method** | Patches print_queue.get_pending_jobs and get_failed_jobs with fake jobs; calls get_queue. |
| **Pass** | result["pending"] and result["failed"] contain expected job dicts. |

---

## `test_projections.py`
> Tests for project_order() function: verifies order state correctly rebuilt from event sequences covering order creation, item add/remove/modify, modifiers, payments, status transitions, discounts, tax/total calculations, and edge cases.

### `test_empty_events_returns_none`
| | |
|---|---|
| **Tests** | project_order([]) returns None. |
| **Method** | Calls project_order with empty event list. |
| **Pass** | Returns None. |

### `test_order_created_basic`
| | |
|---|---|
| **Tests** | order_created event populates basic order fields. |
| **Method** | Calls project_order with single order_created event; checks fields. |
| **Pass** | order_id, table, server_id, server_name, status="open", guest_count all match. |

### `test_item_added_subtotal`
| | |
|---|---|
| **Tests** | item_added events sum correctly into subtotal. |
| **Method** | Creates order and adds two items; projects; checks subtotal and items length. |
| **Pass** | subtotal=15.50, len(items)=2. |

### `test_item_removed`
| | |
|---|---|
| **Tests** | item_removed event removes item from order. |
| **Method** | Creates order, adds item, removes it; projects. |
| **Pass** | len(items)=0. |

### `test_item_modified_quantity`
| | |
|---|---|
| **Tests** | item_modified event updates quantity and recalculates subtotal. |
| **Method** | Creates order, adds item, modifies quantity to 3; projects. |
| **Pass** | items[0].quantity=3, subtotal=30.00. |

### `test_modifier_applied`
| | |
|---|---|
| **Tests** | modifier_applied event adds modifier to item and updates subtotal. |
| **Method** | Creates order, adds item, applies modifier; projects. |
| **Pass** | subtotal=11.50, items[0].modifiers has 1 entry. |

### `test_modifier_removed`
| | |
|---|---|
| **Tests** | modifier_applied with action="remove" removes modifier. |
| **Method** | Applies modifier then removes it; projects. |
| **Pass** | len(modifiers)=0, subtotal=10.00. |

### `test_payment_initiated_and_confirmed`
| | |
|---|---|
| **Tests** | payment_initiated and payment_confirmed events create confirmed payment entry. |
| **Method** | Creates order, adds item, initiates payment, confirms it; projects. |
| **Pass** | len(payments)=1, payments[0].status="confirmed", amount_paid=10.70, is_fully_paid=True. |

### `test_payment_failed_status`
| | |
|---|---|
| **Tests** | PAYMENT_DECLINED event marks payment as failed with error. |
| **Method** | Creates order, initiates payment, sends PAYMENT_DECLINED event; projects. |
| **Pass** | payments[0].status="failed", payments[0].error="declined". |

### `test_order_closed_status`
| | |
|---|---|
| **Tests** | order_closed event sets status="closed" and closed_at timestamp. |
| **Method** | Creates order, closes it; projects. |
| **Pass** | status="closed", closed_at is not None. |

### `test_order_reopened`
| | |
|---|---|
| **Tests** | order_reopened event restores status="open" and clears closed_at. |
| **Method** | Creates order, closes, reopens; projects. |
| **Pass** | status="open", closed_at is None. |

### `test_order_voided`
| | |
|---|---|
| **Tests** | order_voided event sets status="voided" with reason and voided_at timestamp. |
| **Method** | Creates order, voids with reason; projects. |
| **Pass** | status="voided", void_reason="customer complaint", voided_at is not None. |

### `test_discount_applied`
| | |
|---|---|
| **Tests** | DISCOUNT_APPROVED event reduces subtotal and recalculates tax and total. |
| **Method** | Creates order with 50.00 item, applies 5.00 discount; projects. |
| **Pass** | discount_total=5.00, tax based on (50.00-5.00)*0.07=3.15, total=48.15. |

### `test_split_payment_balance_due`
| | |
|---|---|
| **Tests** | Multiple confirmed payments calculate correct balance_due. |
| **Method** | Creates 50.00 order, makes 20.00 and 10.00 payments; projects. |
| **Pass** | amount_paid=30.00, balance_due = total - 30.00. |

### `test_fully_paid_auto_status`
| | |
|---|---|
| **Tests** | When confirmed payments >= total, status auto-transitions to "paid". |
| **Method** | Creates order, projects to get total, then adds payment for full amount; projects. |
| **Pass** | status="paid", is_fully_paid=True. |

### `test_tip_adjusted`
| | |
|---|---|
| **Tests** | TIP_ADJUSTED event updates payment's tip_amount. |
| **Method** | Creates order, confirms payment, sends TIP_ADJUSTED event; projects. |
| **Pass** | payments[0].tip_amount=5.00. |

### `test_unknown_event_type_ignored`
| | |
|---|---|
| **Tests** | Unrecognized event type doesn't crash projection. |
| **Method** | Creates order with item, sends USER_LOGGED_IN event; projects. |
| **Pass** | Returns valid order with 1 item. |

### `test_tax_rate_override`
| | |
|---|---|
| **Tests** | project_order respects tax_rate parameter (0.10 in this case). |
| **Method** | Projects with tax_rate=0.10 on 10.00 item; checks tax and total. |
| **Pass** | tax=1.00, total=11.00. |


---
## `test_projections_payment_lifecycle.py`
> Payment lifecycle projection tests covering pending/failed payments, refunds, seat distribution, and order status transitions.

### `test_pending_payment_not_counted`
| | |
|---|---|
| **Tests** | Pending (initiated but unconfirmed) payments are excluded from amount_paid and do not trigger fully-paid status. |
| **Method** | Seeds order with $20 price, initiates payment without confirming, projects order and asserts is_fully_paid=False and amount_paid=$0. |
| **Pass** | order.is_fully_paid is False, order.amount_paid is $0.00, order.status is "open". |

### `test_failed_payment_not_counted`
| | |
|---|---|
| **Tests** | Failed (declined) payments are excluded from amount_paid accounting and mark payment status as failed. |
| **Method** | Seeds order, initiates then fails payment with error message, projects and asserts exclusion from totals. |
| **Pass** | order.amount_paid is $0.00, order.payments[0].status is "failed", order.status is "open". |

### `test_failed_then_repaid`
| | |
|---|---|
| **Tests** | Order can recover from a failed payment attempt with a subsequent successful payment to reach fully-paid state. |
| **Method** | Seeds order, initiates and fails first payment, initiates and confirms second payment, projects and checks both payments are recorded. |
| **Pass** | order.is_fully_paid is True, order.amount_paid matches full payment, exactly one confirmed and one failed payment present. |

### `test_partial_refund_after_confirmation`
| | |
|---|---|
| **Tests** | Refunds on confirmed payments do not alter the is_fully_paid flag or amount_paid; refunds are tracked separately. |
| **Method** | Confirms full payment, emits PAYMENT_REFUNDED event with partial amount, projects and verifies refund appears in order.refunds list. |
| **Pass** | order.is_fully_paid is True, order.amount_paid unchanged, order.refund_total matches refund amount. |

### `test_mixed_confirmed_and_failed`
| | |
|---|---|
| **Tests** | Only confirmed payments contribute to amount_paid when both confirmed and failed payments exist for the same order. |
| **Method** | Seeds $30 order, initiates two payments ($15 each), confirms one and fails the other, projects and asserts only confirmed counts. |
| **Pass** | order.amount_paid is $15.00 (confirmed only), order.is_fully_paid is False, one confirmed and one failed payment present. |

### `test_three_seat_uneven_distribution`
| | |
|---|---|
| **Tests** | Multi-seat payment distributes amount evenly with remainder to last seat, ensuring exact total. |
| **Method** | Creates 3-seat order with uneven prices, initiates/confirms $10 payment across all 3 seats, projects and validates seat amounts sum to $10. |
| **Pass** | Seats 1-2 each get $3.33, seat 3 gets remainder $3.34, total sum equals $10.00. |

### `test_seat_discount_and_payment`
| | |
|---|---|
| **Tests** | Seat discount reduces balance_due when combined with a confirmed payment on that seat. |
| **Method** | Adds item to seat 1 ($20), applies $5 discount, confirms $15 payment for seat 1, projects and verifies balance_due is zero. |
| **Pass** | seat_balance[1].balance_due is $0.00, discount_total is $5.00, amount_paid is $15.00. |

### `test_timed_out_and_cancelled_both_fail`
| | |
|---|---|
| **Tests** | PAYMENT_TIMED_OUT and PAYMENT_CANCELLED events both result in failed payment status. |
| **Method** | Seeds order, emits PAYMENT_TIMED_OUT for one payment and PAYMENT_CANCELLED for another via create_event, projects and asserts both show status failed. |
| **Pass** | All payments have status "failed", order.amount_paid is $0.00, order.status is "open". |

### `test_order_reverts_open_on_decline`
| | |
|---|---|
| **Tests** | Order status reverts from "paid" to "open" if a previously confirmed payment is later marked as failed. |
| **Method** | Confirms full payment reaching "paid" status, then emits payment_failed event, projects and verifies status reverted and amount_paid reset. |
| **Pass** | After failure, order.status is "open", order.is_fully_paid is False, order.amount_paid is $0.00. |

---

## `test_reporting_extended.py`
> Reporting route tests covering sales summaries, labor summaries, hourly comparisons, and security gates for server scope access.

### `test_empty_day_sales_summary`
| | |
|---|---|
| **Tests** | Sales summary on empty ledger returns zero totals for all numeric fields. |
| **Method** | Calls get_sales_summary with empty ledger and today's date, asserts all aggregates are zero or empty. |
| **Pass** | net_sales, gross_sales, tips_collected all $0.00, total_checks is 0, hourly_sales is empty list. |

### `test_single_order_hourly_aggregation`
| | |
|---|---|
| **Tests** | Sales summary aggregates single order amount into hourly buckets matching the order total. |
| **Method** | Seeds one order of $25, calls get_sales_summary, sums hourly bucket net values and validates sum equals order amount. |
| **Pass** | Hourly net sum equals order amount ($25), total_checks is 1, response includes hourly_sales list. |

### `test_sales_summary_with_tips`
| | |
|---|---|
| **Tests** | Tip adjustments are captured in tips_collected field of sales summary. |
| **Method** | Seeds order, emits tip_adjusted event with $5 tip, calls get_sales_summary and checks tips_collected. |
| **Pass** | response["tips_collected"] equals $5.00. |

### `test_labor_summary_empty`
| | |
|---|---|
| **Tests** | Labor summary on ledger with no clock events returns empty employee list and zero totals. |
| **Method** | Calls get_labor_summary on empty ledger, asserts employees list is empty and hour/labor totals are zero. |
| **Pass** | employees list is empty, total_hours and total_labor both $0.00. |

### `test_labor_summary_clock_events`
| | |
|---|---|
| **Tests** | Labor summary computes shift duration from clock-in/out events and populates employee records. |
| **Method** | Emits user_logged_in event 90 minutes before user_logged_out, calls get_labor_summary, asserts employee entry with ~1.5 hour duration. |
| **Pass** | Employee record found with name "Alice", hours approximately 1.5, clock_in and clock_out timestamps present. |

### `test_labor_summary_server_view`
| | |
|---|---|
| **Tests** | Labor summary with server_id parameter returns individual shift details for that server. |
| **Method** | Clocks in/out an employee (60 min duration), calls get_labor_summary with server_id, checks server-view fields. |
| **Pass** | today_hours approximately 1.0, clock_in and clock_out are not None, ot_status is "ok". |

### `test_hourly_compare_shape`
| | |
|---|---|
| **Tests** | hourly_compare endpoint returns correct response structure with today and last_week hourly data. |
| **Method** | Calls hourly_compare with empty ledger, validates response has "today" and "last_week" keys containing lists with hour and net_sales fields. |
| **Pass** | Response has "today" and "last_week" keys, both are lists, each entry has "hour" and "net_sales" keys. |

### `test_sec005_unauthenticated_server_scope`
| | |
|---|---|
| **Tests** | SEC-005 diagnostic event is emitted when server_id is provided without an auth session. |
| **Method** | Mocks request without auth header, calls get_sales_summary with server_id parameter, queries collector for SEC-005 events. |
| **Pass** | Request succeeds (auth_enforced=False), SEC-005 event(s) captured in collector with event_code="SEC-005". |

### `test_sec006_cross_server_access`
| | |
|---|---|
| **Tests** | SEC-006 diagnostic event is emitted when an authenticated employee requests data for a different server's scope. |
| **Method** | Creates bearer token for "emp_A", requests data for "emp_B", queries collector for SEC-006 events with context validation. |
| **Pass** | SEC-006 event captured, context shows requested_server_id="emp_B" and session_employee_id="emp_A". |

### `test_manager_bypasses_gate`
| | |
|---|---|
| **Tests** | Manager role bypasses the server-scope security gate and does not trigger SEC-006 event. |
| **Method** | Creates bearer token with "manager" role, requests other employee's data, queries collector for absence of SEC-006. |
| **Pass** | Request succeeds, no SEC-006 events emitted (empty list from collector). |

### `test_historical_date_query`
| | |
|---|---|
| **Tests** | Historical date queries (past dates) return zero totals without raising errors. |
| **Method** | Calls get_sales_summary with a date 7 days ago, validates all numeric fields are zero and date field matches input. |
| **Pass** | net_sales and gross_sales are $0.00, total_checks is 0, response["date"] matches input date. |

---

## `test_seat_payments.py`
> Seat-level payment tracking tests covering seat_numbers flow through events to projections and API responses.

### `test_payment_stores_seat_numbers`
| | |
|---|---|
| **Tests** | Confirmed payment with seat_numbers stores them on the Payment projection object. |
| **Method** | Creates order with 2-seat items, confirms payment for seat 1 only with seat_numbers=[1], projects and asserts payment.seat_numbers. |
| **Pass** | order.payments[0].seat_numbers equals [1], payment status is "confirmed". |

### `test_paid_seats_single_seat`
| | |
|---|---|
| **Tests** | Order.paid_seats aggregates seats from confirmed payments, returning single seat when one payment claims it. |
| **Method** | Adds 2-seat items, confirms payment for seat 1, projects and checks order.paid_seats. |
| **Pass** | order.paid_seats equals [1]. |

### `test_paid_seats_multiple_payments`
| | |
|---|---|
| **Tests** | Multiple separate seat payments accumulate into paid_seats, growing list with each confirmed payment. |
| **Method** | Creates 3-seat order, confirms payment for seat 1, then confirms payment for seat 2, projects and validates paid_seats after each. |
| **Pass** | After seat 1 payment: paid_seats=[1]; after seat 2 payment: paid_seats=[1,2]. |

### `test_paid_seats_multi_seat_single_payment`
| | |
|---|---|
| **Tests** | One payment can cover multiple seats simultaneously, and all covered seats appear in paid_seats. |
| **Method** | Adds 2-seat items, confirms single payment with seat_numbers=[1,2], projects and checks paid_seats. |
| **Pass** | order.paid_seats equals [1,2]. |

### `test_failed_payment_not_in_paid_seats`
| | |
|---|---|
| **Tests** | Seats from failed/declined payments are not included in paid_seats. |
| **Method** | Initiates and fails payment for seat 1 with seat_numbers=[1], projects and asserts paid_seats is empty. |
| **Pass** | order.paid_seats equals []. |

### `test_pending_payment_not_in_paid_seats`
| | |
|---|---|
| **Tests** | Seats from pending (initiated but not confirmed) payments do not appear in paid_seats. |
| **Method** | Initiates payment without confirming it with seat_numbers=[1], projects and asserts paid_seats is empty. |
| **Pass** | order.paid_seats equals []. |

### `test_payment_without_seat_numbers_backwards_compat`
| | |
|---|---|
| **Tests** | Legacy payments without seat_numbers do not crash and paid_seats remains empty. |
| **Method** | Confirms payment without providing seat_numbers parameter, projects and validates no error occurs. |
| **Pass** | order.paid_seats equals [], payment.seat_numbers equals [], amount_paid is correct. |

### `test_paid_seats_deduplicates`
| | |
|---|---|
| **Tests** | When same seat appears in multiple payments, paid_seats contains it once (deduplicated). |
| **Method** | Creates 1-seat order, makes two payments both claiming seat 1, projects and checks for single appearance. |
| **Pass** | order.paid_seats equals [1] (not [1,1]). |

### `test_paid_seats_sorted`
| | |
|---|---|
| **Tests** | paid_seats returns seats in ascending order regardless of payment order sequence. |
| **Method** | Pays seats in reverse order (3, then 1), projects and asserts returned list is sorted ascending. |
| **Pass** | order.paid_seats equals [1,3] (sorted despite payment order). |

### `test_cash_payment_with_seat_numbers`
| | |
|---|---|
| **Tests** | Cash payment API route accepts and persists seat_numbers in PAYMENT_INITIATED and PAYMENT_CONFIRMED events. |
| **Method** | POSTs to /api/v1/payments/cash with seat_numbers=[1], queries ledger for events and asserts payload. |
| **Pass** | PAYMENT_INITIATED and PAYMENT_CONFIRMED events have payload["seat_numbers"] == [1]. |

### `test_order_response_includes_paid_seats`
| | |
|---|---|
| **Tests** | OrderResponse includes paid_seats field populated after seat-specific payments. |
| **Method** | Creates order, pays seat 1 via API, GETs order and validates paid_seats in response JSON. |
| **Pass** | response["paid_seats"] equals [1]. |

### `test_order_response_paid_seats_empty_without_seat_numbers`
| | |
|---|---|
| **Tests** | OrderResponse.paid_seats is empty list for legacy payments without seat_numbers. |
| **Method** | Pays order via API without seat_numbers, GETs order and checks paid_seats field. |
| **Pass** | response["paid_seats"] equals []. |

### `test_payment_response_includes_seat_numbers`
| | |
|---|---|
| **Tests** | OrderResponse.payments[].seat_numbers field is populated from event payload. |
| **Method** | Pays seat 1, GETs order, finds confirmed payment and asserts seat_numbers field. |
| **Pass** | confirmed_payment["seat_numbers"] equals [1]. |

### `test_sequential_seat_payments_accumulate`
| | |
|---|---|
| **Tests** | Sequential seat payments accumulate in paid_seats, allowing partial payment and later completion. |
| **Method** | Creates 3-seat order, pays seat 1, GETs order and checks paid_seats=[1], pays seat 3, verifies paid_seats=[1,3]. |
| **Pass** | After each payment, paid_seats reflects only the seats with confirmed payments. |

### `test_seat_payments_when_cash_discount_disabled`
| | |
|---|---|
| **Tests** | Paying one seat with cash_discount_rate=0 does not auto-close the order, allowing other seats to pay later. |
| **Method** | Disables cash discount, creates 2-seat order, pays seat 1 for full amount, validates order stays open. |
| **Pass** | Order status remains "open", second seat payment succeeds, final paid_seats=[1,2]. |

### `test_void_payment_reopens_closed_order`
| | |
|---|---|
| **Tests** | Voiding the final payment on a fully-paid closed order reopens it for re-payment. |
| **Method** | Pays single seat causing auto-close, voids the payment, verifies order reopens to "open" status and paid_seats clears. |
| **Pass** | After void: order.status="open", paid_seats=[], subsequent re-payment succeeds. |

### `test_void_payment_accepts_json_body`
| | |
|---|---|
| **Tests** | Void payment endpoint accepts reason and approved_by fields in JSON request body. |
| **Method** | POSTs to void endpoint with JSON body containing reason and approved_by, queries ledger for PAYMENT_CANCELLED event. |
| **Pass** | PAYMENT_CANCELLED event payload contains exact reason and approved_by values from request. |

---

## `test_server_shift.py`
> Server shift landing page route tests covering sales-by-category, table-stats, and checkout-status endpoints with cash/card splits and server isolation.

### `test_cash_only_order_all_goes_to_cash`
| | |
|---|---|
| **Tests** | Cash-paid order revenue goes entirely to the cash column of sales-by-category response. |
| **Method** | Creates pizza order, pays with cash method, closes order, calls sales_by_category and asserts cash field. |
| **Pass** | response[0]["category"]="PIZZA", response[0]["cash"]≈20.00, response[0]["card"]≈0.00. |

### `test_card_only_order_all_goes_to_card`
| | |
|---|---|
| **Tests** | Card-paid order revenue goes entirely to the card column of sales-by-category response. |
| **Method** | Creates drinks order, pays with card method, closes order, calls sales_by_category and checks card field. |
| **Pass** | "DRINKS" category present with cash≈0.00, card≈6.00. |

### `test_mixed_tender_splits_fifty_fifty`
| | |
|---|---|
| **Tests** | Split-tender orders (multiple payments, different methods) split per-item revenue 50/50 between cash and card. |
| **Method** | Creates 1-item order, makes $6 cash and $6 card payments, closes, calls sales_by_category and validates split. |
| **Pass** | "SUBS" category has cash≈6.00, card≈6.00 (50/50 split). |

### `test_voided_orders_excluded`
| | |
|---|---|
| **Tests** | Voided orders do not contribute their revenue to any category totals. |
| **Method** | Creates and closes live order ($10), creates and voids separate order ($100), calls sales_by_category and sums. |
| **Pass** | Category total equals $10.00 (voided $100 excluded). |

### `test_uncategorized_items_bucketed_as_other`
| | |
|---|---|
| **Tests** | Items with no category are bucketed into "OTHER" category (uppercased). |
| **Method** | Adds uncategorized item (category=None), pays and closes, calls sales_by_category and finds "OTHER". |
| **Pass** | "OTHER" category present with revenue matching item price. |

### `test_sorted_desc_by_total`
| | |
|---|---|
| **Tests** | Categories are sorted in descending order by total revenue (cash + card). |
| **Method** | Creates order with 3 categories ($20 pizza, $8 wings, $4 soda), calls sales_by_category and checks order. |
| **Pass** | Category order is ["PIZZA", "APPS", "DRINKS"]. |

### `test_cross_server_isolation`
| | |
|---|---|
| **Tests** | Sales-by-category returns only the requested server's categories; other servers' data does not leak in. |
| **Method** | Creates $10 pizza for emp_A and $100 drinks for emp_B, calls sales_by_category for emp_A. |
| **Pass** | Result includes only "PIZZA", revenue total ≈$10.00 (emp_B's drinks excluded). |

### `test_guest_and_table_count`
| | |
|---|---|
| **Tests** | Table stats aggregates guest counts and table counts from closed orders matching server. |
| **Method** | Creates 2 orders (guests 2 and 4, both paid/closed), calls table_stats and checks totals. |
| **Pass** | guestCount=6, tableCount=2, checkAvg≈25.00 (50/2). |

### `test_voided_orders_dont_count`
| | |
|---|---|
| **Tests** | Voided orders do not contribute to guest counts, table counts, or check averages. |
| **Method** | Creates live order (2 guests, $20) and void order (8 guests, $500), calls table_stats. |
| **Pass** | guestCount=2, tableCount=1, checkAvg≈20.00 (void excluded). |

### `test_party_size_buckets_cap_at_4`
| | |
|---|---|
| **Tests** | Party sizes ≥4 are bucketed into the "4+" bucket; sizes 1-3 get individual buckets. |
| **Method** | Creates orders with guest_count=[1,2,4,6,10], calls table_stats and checks byPartySize buckets. |
| **Pass** | size=1 count=1, size=2 count=1, size=4 count=3 (includes 4, 6, 10). |

### `test_empty_shift_returns_zeros`
| | |
|---|---|
| **Tests** | Table stats for a server with no orders returns all counters at zero. |
| **Method** | Calls table_stats with nonexistent server_id, asserts all fields are zero/empty. |
| **Pass** | guestCount=0, tableCount=0, checkAvg≈0.0, byPartySize=[]. |

### `test_check_avg_deducts_discounts`
| | |
|---|---|
| **Tests** | Check average is calculated on net amount (subtotal minus discounts), not gross. |
| **Method** | Creates $30 order, applies $6 discount, pays $24, calls table_stats. |
| **Pass** | checkAvg≈24.00 (30−6, not 30). |

### `test_open_check_counted`
| | |
|---|---|
| **Tests** | Checkout status counts open (unpaid, unclosed) orders as openChecks blockers. |
| **Method** | Creates order without payment or close, calls checkout_status. |
| **Pass** | openChecks=1, unadjustedTips=0. |

### `test_closed_cash_order_has_no_unadjusted_tips`
| | |
|---|---|
| **Tests** | Cash payments never generate unadjusted-tip blockers (tips only tracked for card). |
| **Method** | Creates order, pays cash, closes, calls checkout_status. |
| **Pass** | openChecks=0, unadjustedTips=0. |

### `test_card_payment_without_tip_adjust_is_unadjusted`
| | |
|---|---|
| **Tests** | Card payment without a TIP_ADJUSTED event counts as a blocker on server's checkout readiness. |
| **Method** | Creates order, confirms card payment (no tip adjust), closes, calls checkout_status. |
| **Pass** | unadjustedTips=1 (card payment without explicit tip decision). |

### `test_tip_adjusted_to_zero_still_counts_as_adjusted`
| | |
|---|---|
| **Tests** | Explicit tip adjustment to $0 (e.g., "Zero All" button) clears the unadjusted flag. |
| **Method** | Creates order, confirms card payment, emits TIP_ADJUSTED with tip_amount=0, calls checkout_status. |
| **Pass** | unadjustedTips=0 (explicit $0 decision counts as adjusted). |

### `test_other_servers_orders_ignored`
| | |
|---|---|
| **Tests** | Checkout status for one server ignores open checks and tips from other servers. |
| **Method** | Creates open order for emp_B, calls checkout_status for emp_A. |
| **Pass** | openChecks=0, unadjustedTips=0 (emp_B's order ignored). |

### `test_returns_not_implemented`
| | |
|---|---|
| **Tests** | PATCH /tipout endpoint returns 501 Not Implemented to prevent silent failures in UI. |
| **Method** | Calls patch_tipout directly with TipOutRequest, expects HTTPException. |
| **Pass** | HTTPException raised with status_code=501. |

---

## `test_server_shift_extended.py`
> Extended server shift tests providing additional coverage for sales-by-category, table-stats, and checkout-status with Decimal precision.

### `test_sales_by_category_empty`
| | |
|---|---|
| **Tests** | Empty ledger returns empty category list from sales_by_category. |
| **Method** | Calls sales_by_category on ledger with no orders, asserts empty result. |
| **Pass** | result equals []. |

### `test_sales_by_category_single_category`
| | |
|---|---|
| **Tests** | Single cash-paid order produces one category entry with correct cash and zero card amounts. |
| **Method** | Creates and closes order with cash payment, calls sales_by_category. |
| **Pass** | Single category entry with category="FOOD", cash=Decimal("20.00"), card=Decimal("0.00"). |

### `test_sales_by_category_multiple_sorted_by_revenue`
| | |
|---|---|
| **Tests** | Multiple categories are returned sorted by total revenue in descending order. |
| **Method** | Creates order with food ($30) and drinks ($10) items, calls sales_by_category. |
| **Pass** | Result length=2, FOOD precedes DRINKS, FOOD cash > DRINKS cash. |

### `test_sales_by_category_excludes_other_servers`
| | |
|---|---|
| **Tests** | Sales-by-category is scoped to single server; other servers' data is completely excluded. |
| **Method** | Creates orders for SERVER_A ($18) and SERVER_B ($22), queries both separately. |
| **Pass** | SERVER_A result shows $18.00, SERVER_B result shows $22.00 (no cross-contamination). |

### `test_sales_by_category_card_payment_goes_to_card_column`
| | |
|---|---|
| **Tests** | Card-paid order revenue appears in card column, not cash. |
| **Method** | Creates and card-pays order with drinks, calls sales_by_category. |
| **Pass** | Category entry shows cash=Decimal("0.00"), card=Decimal("15.00"). |

### `test_table_stats_empty`
| | |
|---|---|
| **Tests** | Empty ledger returns zero counters and empty party-size buckets. |
| **Method** | Calls table_stats on ledger with no orders, asserts all fields zero/empty. |
| **Pass** | guestCount=0, tableCount=0, checkAvg=Decimal("0.00"), byPartySize=[]. |

### `test_table_stats_single_order`
| | |
|---|---|
| **Tests** | Single closed order contributes correct guest, table, and check average values. |
| **Method** | Creates 3-guest order ($30 total), closes, calls table_stats. |
| **Pass** | guestCount=3, tableCount=1, checkAvg=Decimal("30.00"). |

### `test_table_stats_party_size_bucketing`
| | |
|---|---|
| **Tests** | Party size 6 is bucketed into the size=4 group; individual size 6 bucket does not appear. |
| **Method** | Creates order with guest_count=6, calls table_stats. |
| **Pass** | byPartySize contains size=4 entry, does not contain size=6. |

### `test_table_stats_excludes_voided_orders`
| | |
|---|---|
| **Tests** | Voided or unpaid orders do not contribute to table stats. |
| **Method** | Creates unpaid order (status stays "open"), calls table_stats, asserts no error and reasonable state. |
| **Pass** | guestCount >= 0 (structural validity), no exception raised. |

### `test_checkout_status_no_orders`
| | |
|---|---|
| **Tests** | Empty ledger returns zero open checks and zero unadjusted tips. |
| **Method** | Calls checkout_status on empty ledger. |
| **Pass** | openChecks=0, unadjustedTips=0. |

### `test_checkout_status_open_check_counted`
| | |
|---|---|
| **Tests** | Open (unpaid, unclosed) order is counted as an open check blocker. |
| **Method** | Creates order with items but no payment/close, calls checkout_status. |
| **Pass** | openChecks=1. |

### `test_checkout_status_card_without_tip_is_unadjusted`
| | |
|---|---|
| **Tests** | Closed card payment without TIP_ADJUSTED event blocks checkout (unadjusted tip). |
| **Method** | Creates order, confirms card payment (no tip adjust), closes, calls checkout_status. |
| **Pass** | unadjustedTips=1, openChecks=0. |

### `test_checkout_status_adjusted_tip_not_counted`
| | |
|---|---|
| **Tests** | Card payment with an explicit TIP_ADJUSTED event does not count as unadjusted. |
| **Method** | Creates order, confirms card payment, emits tip_adjusted event, calls checkout_status. |
| **Pass** | unadjustedTips=0. |

### `test_checkout_status_cash_payment_never_unadjusted`
| | |
|---|---|
| **Tests** | Cash payments are never counted as needing tip adjustment, regardless of TIP_ADJUSTED presence. |
| **Method** | Creates order, confirms cash payment, closes, calls checkout_status. |
| **Pass** | unadjustedTips=0. |

### `test_checkout_status_excludes_other_servers`
| | |
|---|---|
| **Tests** | Checkout status is scoped to single server; other servers' blockers do not appear. |
| **Method** | Creates open order and unadjusted card payment for SERVER_B, queries SERVER_A. |
| **Pass** | SERVER_A returns openChecks=0, unadjustedTips=0 (SERVER_B's issues excluded). |

### `test_tipout_returns_501`
| | |
|---|---|
| **Tests** | PATCH /tipout endpoint raises HTTPException with 501 status (Not Implemented). |
| **Method** | Calls patch_tipout with TipOutRequest. |
| **Pass** | HTTPException raised with status_code=501. |

---

## `test_staff_routes_extended.py`
> Extended staff route tests covering cash tip declaration and clock-in/out state tracking via get_clocked_in endpoint.

### `test_declare_cash_tips`
| | |
|---|---|
| **Tests** | POST /declare-cash-tips records cash tip declaration and returns success response. |
| **Method** | POSTs to /api/v1/servers/declare-cash-tips with server_id and amount, asserts response structure. |
| **Pass** | response["success"]=True, response["server_id"]="srv-01", response["amount"]=50.0. |

### `test_get_clocked_in_empty`
| | |
|---|---|
| **Tests** | GET /clocked-in on empty ledger returns empty staff list. |
| **Method** | Calls get_clocked_in on ledger with no clock events, asserts staff list is empty. |
| **Pass** | response["staff"] is empty list. |

### `test_clocked_in_after_clock_in`
| | |
|---|---|
| **Tests** | After clock-in event, get_clocked_in includes the employee with correct id and name. |
| **Method** | POSTs to /clock-in, then GETs /clocked-in, validates staff entry. |
| **Pass** | staff list length=1, staff[0]["employee_id"]="emp-01", staff[0]["employee_name"]="Alice". |

### `test_clocked_in_after_clock_out`
| | |
|---|---|
| **Tests** | After clock-out following clock-in, get_clocked_in returns empty staff list. |
| **Method** | POSTs clock-in, then clock-out, then GETs /clocked-in. |
| **Pass** | response["staff"] is empty list. |


---
## `test_staff_routes_gaps.py`
> Tests edge cases and event emissions in staff routes: double clock-in rejection, missing clock-in rejection, event pairing, and cash tips validation

### `test_double_clock_in_rejected`
| | |
|---|---|
| **Tests** | Double clock-in is rejected with 400 status code |
| **Method** | POST /api/v1/servers/clock-in twice with same employee_id; asserts second request fails |
| **Pass** | Second response has status 400 with "already clocked in" in detail message |

### `test_clock_out_without_clock_in_rejected`
| | |
|---|---|
| **Tests** | Clock-out without prior clock-in is rejected with 400 |
| **Method** | POST /api/v1/servers/clock-out with employee_id that never clocked in; asserts rejection |
| **Pass** | Response has status 400 with "not clocked in" in detail message |

### `test_clock_in_emits_both_events`
| | |
|---|---|
| **Tests** | Clock-in emits both CLOCK_IN and USER_LOGGED_IN events |
| **Method** | POST /api/v1/servers/clock-in and check ledger for both event types with matching employee_id |
| **Pass** | Both event types present in ledger with the same employee_id |

### `test_clock_out_emits_both_events`
| | |
|---|---|
| **Tests** | Clock-out emits both CLOCK_OUT and USER_LOGGED_OUT events |
| **Method** | Clock-in first, then POST clock-out; verify both event types in ledger |
| **Pass** | Both CLOCK_OUT and USER_LOGGED_OUT events present with matching employee_id |

### `test_declare_cash_tips_negative_rejected`
| | |
|---|---|
| **Tests** | Negative cash tips amount is rejected with 400 |
| **Method** | POST /api/v1/servers/declare-cash-tips with amount=-5.0; asserts rejection |
| **Pass** | Response has status 400 with "negative" in detail message |

### `test_declare_cash_tips_too_many_decimals_rejected`
| | |
|---|---|
| **Tests** | Cash tips with >2 decimal places is rejected with 422 |
| **Method** | POST /api/v1/servers/declare-cash-tips with amount=10.001 (3dp); asserts rejection |
| **Pass** | Response has status 422 |

### `test_get_servers_empty`
| | |
|---|---|
| **Tests** | GET /servers returns empty list when no employees are configured |
| **Method** | GET /api/v1/servers on fresh ledger; asserts response shape and empty servers list |
| **Pass** | Status 200, response.json()["servers"] equals [] |

---

## `test_startup_sweep.py`
> Tests orphan payment timeout recovery: the startup sweep's job is ensuring no PAYMENT_INITIATED older than max_age_seconds remains unresolved

### `test_orphan_is_swept`
| | |
|---|---|
| **Tests** | A lone PAYMENT_INITIATED with no result event older than threshold gets resolved with PAYMENT_TIMED_OUT |
| **Method** | Emit PAYMENT_INITIATED with max_age_seconds=0 (force old); call sweep_orphan_initiated_payments and check ledger |
| **Pass** | Sweep returns 1, ledger contains PAYMENT_TIMED_OUT event with error_code="CRASH_RECOVERY_TIMEOUT" |

### `test_resolved_initiated_is_untouched`
| | |
|---|---|
| **Tests** | An INITIATED with existing CONFIRMED/DECLINED result is not re-resolved |
| **Method** | Emit PAYMENT_INITIATED + PAYMENT_CONFIRMED; call sweep with max_age_seconds=0; verify no timeout |
| **Pass** | Sweep returns 0, no PAYMENT_TIMED_OUT events created |

### `test_young_initiated_is_not_swept_prematurely`
| | |
|---|---|
| **Tests** | An INITIATED within the live window (younger than max_age_seconds) is skipped |
| **Method** | Emit PAYMENT_INITIATED; call sweep with max_age_seconds=600; verify sweep skips it |
| **Pass** | Sweep returns 0, no PAYMENT_TIMED_OUT events |

### `test_sweep_is_idempotent`
| | |
|---|---|
| **Tests** | Running sweep twice is idempotent; second pass does not double-resolve |
| **Method** | Emit PAYMENT_INITIATED; call sweep twice with max_age_seconds=0; verify counts |
| **Pass** | First sweep returns 1, second returns 0, ledger has exactly 1 PAYMENT_TIMED_OUT |

### `test_multiple_orphans_all_swept`
| | |
|---|---|
| **Tests** | Multiple orphan INITIATED events are all swept; resolved ones are skipped |
| **Method** | Emit 3 orphan + 1 resolved PAYMENT_INITIATED; call sweep; verify count and resolved set |
| **Pass** | Sweep returns 3, ledger has PAYMENT_TIMED_OUT for only the 3 orphans |

---

## `test_sync_routes.py`
> Tests LAN config sync between Overseer and Terminals: health check, config event filtering, cursor-based pagination, idempotency, and security diagnostics

### `test_heartbeat_shape`
| | |
|---|---|
| **Tests** | /sync/health returns correct shape |
| **Method** | Call sync_health(); assert response shape |
| **Pass** | Response equals {"status": "ok", "role": "overseer"} |

### `test_empty_ledger_returns_empty_list`
| | |
|---|---|
| **Tests** | Empty ledger returns empty config events list with prefixes |
| **Method** | Call get_config_events(since=0, limit=100) on empty ledger; assert response structure |
| **Pass** | events=[], count=0, latest_sequence=0, prefixes contains "store." and "menu." |

### `test_returns_only_config_events`
| | |
|---|---|
| **Tests** | Operational events (orders, payments) are filtered out; only config events returned |
| **Method** | Seed config + operational events; call get_config_events; verify types |
| **Pass** | Response includes employee.created and tipout.rule_created, excludes order.created |

### `test_since_cursor_filters_earlier_events`
| | |
|---|---|
| **Tests** | Since cursor filters events by sequence_number; only events after it are returned |
| **Method** | Seed two EMPLOYEE_CREATED events; call with since=first.sequence_number |
| **Pass** | Only second event returned, latest_sequence equals second event's sequence_number |

### `test_limit_capped_at_5000`
| | |
|---|---|
| **Tests** | Limit parameter is capped at 5000 even if caller requests more |
| **Method** | Call with limit=999_999; assert count is bounded |
| **Pass** | count <= 5000, no exception raised |

### `test_event_serialization_shape`
| | |
|---|---|
| **Tests** | Each event has correct wire-format keys and types for client consumption |
| **Method** | Seed STORE_TAX_RULE_CREATED; call get_config_events; inspect serialization |
| **Pass** | Event has event_id, sequence_number, timestamp (ISO string), terminal_id, event_type, payload |

### `test_applies_config_events`
| | |
|---|---|
| **Tests** | replay_config_events accepts valid config events and appends to ledger |
| **Method** | Call replay_config_events with employee.created wire event; verify applied=1 and ledger has it |
| **Pass** | Response equals {"applied": 1, "skipped": 0}, ledger contains the event |

### `test_skips_operational_events`
| | |
|---|---|
| **Tests** | Operational events (order.created) are rejected in replay, not applied |
| **Method** | Call replay_config_events with order.created; verify skipped=1 |
| **Pass** | Response equals {"applied": 0, "skipped": 1}, ledger untouched |

### `test_skips_events_missing_event_type`
| | |
|---|---|
| **Tests** | Malformed events without event_type key are skipped; batch continues |
| **Method** | Call replay with malformed event dict (no event_type); verify skipped=1 |
| **Pass** | Response equals {"applied": 0, "skipped": 1} |

### `test_idempotent_on_duplicate_event_id`
| | |
|---|---|
| **Tests** | Replaying same event_id twice is idempotent; second is skipped |
| **Method** | Replay same event twice; verify first applied=1, second applied=0, ledger has one copy |
| **Pass** | First returns {"applied": 1, "skipped": 0}, second returns applied=0, one event in ledger |

### `test_mixed_batch_partitions_correctly`
| | |
|---|---|
| **Tests** | Batch with config + operational + malformed events partitions correctly |
| **Method** | Call replay with mixed batch (2 config, 1 operational, 1 malformed); verify counters |
| **Pass** | Response equals {"applied": 2, "skipped": 2} |

### `test_empty_events_list_succeeds`
| | |
|---|---|
| **Tests** | Empty events list succeeds and returns zero counts |
| **Method** | Call replay with events=[]; assert response |
| **Pass** | Response equals {"applied": 0, "skipped": 0} |

### `test_missing_events_key_treated_as_empty`
| | |
|---|---|
| **Tests** | Missing events key in payload is treated as empty batch |
| **Method** | Call replay with payload={}; assert response |
| **Pass** | Response equals {"applied": 0, "skipped": 0} |

### `test_events_not_a_list_400s`
| | |
|---|---|
| **Tests** | events field must be a list; non-list raises HTTPException with 400 |
| **Method** | Call replay with events="not-a-list"; assert exception |
| **Pass** | HTTPException raised with status_code=400 |

### `test_sec003_fires_on_every_replay`
| | |
|---|---|
| **Tests** | SEC-003 diagnostic is emitted on every replay, even empty batches |
| **Method** | Replay empty batch; mock _record_diag; verify one call with event_code="SEC-003" |
| **Pass** | One SEC-003 diagnostic with batch_size=0 and claimed_terminal_ids=[] |

### `test_sec003_captures_claimed_terminal_ids`
| | |
|---|---|
| **Tests** | SEC-003 snapshot includes sorted, deduplicated list of claimed terminal_ids |
| **Method** | Replay 3 events from T-02, T-03, T-02; mock _record_diag; inspect diag context |
| **Pass** | SEC-003 has claimed_terminal_ids=["T-02", "T-03"] (sorted, dedup'd) and batch_size=3 |

### `test_sec004_fires_on_self_claim`
| | |
|---|---|
| **Tests** | SEC-004 WARNING is emitted when batch contains event claiming this terminal's ID |
| **Method** | Set settings.terminal_id="T-THIS"; replay batch with T-THIS and OVERSEER events; mock diag |
| **Pass** | SEC-004 diagnostic present with local_terminal_id="T-THIS", self_claim_count=1, batch_size=2 |

### `test_sec004_silent_when_no_self_claims`
| | |
|---|---|
| **Tests** | SEC-004 is silent when batch contains no claims from this terminal |
| **Method** | Set settings.terminal_id="T-THIS"; replay only OVERSEER events; verify no SEC-004 |
| **Pass** | No SEC-004 diagnostic in captured calls |

### `test_sec004_silent_when_settings_terminal_id_unset`
| | |
|---|---|
| **Tests** | SEC-004 is silent when settings.terminal_id is empty/unconfigured |
| **Method** | Set settings.terminal_id=""; replay with empty claims; verify no SEC-004 |
| **Pass** | No SEC-004 diagnostic in captured calls |

### `test_precision_error_counted_as_skipped`
| | |
|---|---|
| **Tests** | Monetary payload with 3+ decimal places triggers precision gate and counts as skipped |
| **Method** | Replay menu.item_created with price=10.123 (3dp); assert skipped=1 and ledger empty |
| **Pass** | Response equals {"applied": 0, "skipped": 1}, no events in ledger |

### `test_precision_error_doesnt_abort_remainder_of_batch`
| | |
|---|---|
| **Tests** | One precision error in batch does not abort good rows before/after |
| **Method** | Replay mixed batch: good + bad (3dp) + good; verify applied=2, skipped=1 |
| **Pass** | Response equals {"applied": 2, "skipped": 1} |

### `test_non_precision_valueerror_propagates`
| | |
|---|---|
| **Tests** | Non-precision ValueError (e.g., ledger corruption) is not swallowed; bubbles up |
| **Method** | Mock ledger.append to raise ValueError("Checksum mismatch"); call replay |
| **Pass** | ValueError propagates with "Checksum mismatch" message |

### `test_loop_skips_batch_of_only_op_events`
| | |
|---|---|
| **Tests** | Over-fetch loop skips batches that are entirely operational; advances to config |
| **Method** | Seed 5 operational + 1 config event; call get_config_events(limit=10) |
| **Pass** | Response contains the 1 config event; count=1 |

### `test_latest_sequence_echoes_since_when_no_config_events`
| | |
|---|---|
| **Tests** | When ledger is operational-only, latest_sequence echoes since parameter |
| **Method** | Seed 3 operational events; call get_config_events(since=0, then since=42) |
| **Pass** | Both calls return events=[], first latest_sequence=0, second latest_sequence=42 |

### `test_soft_mode_no_token_allows`
| | |
|---|---|
| **Tests** | With auth_enforced=False, missing bearer allows POST /replay (soft SEC-005) |
| **Method** | HTTP POST /api/v1/sync/config/events/replay without Authorization header; assert allowed |
| **Pass** | Status 200, response equals {"applied": 0, "skipped": 0} |

### `test_strict_mode_no_token_401`
| | |
|---|---|
| **Tests** | With auth_enforced=True, missing bearer blocks POST /replay with 401 |
| **Method** | HTTP POST /replay without Authorization in strict mode; assert rejected |
| **Pass** | Status 401 |

### `test_strict_mode_valid_bearer_passes`
| | |
|---|---|
| **Tests** | With auth_enforced=True, valid bearer with any role passes replay gate |
| **Method** | HTTP POST /replay with valid bearer token; assert allowed |
| **Pass** | Status 200, response equals {"applied": 0, "skipped": 0} |

### `test_health_and_get_events_need_no_auth`
| | |
|---|---|
| **Tests** | /health and /config/events endpoints are public; /replay is gated |
| **Method** | Set auth_enforced=True; HTTP GET /health and /config/events without bearer |
| **Pass** | Both return 200; health has status=ok, events has shape |

---

## `test_system_routes.py`
> Tests system route helpers, pytest integration, and auth gates: line classification, test result counting, project root discovery, test runner subprocess, and role-based access control

### `test_passed_keyword`
| | |
|---|---|
| **Tests** | Line containing "PASSED" keyword classifies as 'passed' style |
| **Method** | Call classify_line("test_foo PASSED"); assert result |
| **Pass** | Returns "passed" |

### `test_unicode_check_mark`
| | |
|---|---|
| **Tests** | Line with unicode ✓ classifies as 'passed' |
| **Method** | Call classify_line("✓ test_foo"); assert result |
| **Pass** | Returns "passed" |

### `test_bracketed_pass_tag`
| | |
|---|---|
| **Tests** | Line with [PASS] classifies as 'passed' |
| **Method** | Call classify_line("[PASS] test_foo"); assert result |
| **Pass** | Returns "passed" |

### `test_failed_keyword`
| | |
|---|---|
| **Tests** | Line containing "FAILED" keyword classifies as 'failed' |
| **Method** | Call classify_line("test_foo FAILED"); assert result |
| **Pass** | Returns "failed" |

### `test_error_keyword`
| | |
|---|---|
| **Tests** | Line containing "ERROR" classifies as 'failed' |
| **Method** | Call classify_line("ERROR collecting tests"); assert result |
| **Pass** | Returns "failed" |

### `test_skipped_keyword`
| | |
|---|---|
| **Tests** | Line containing "SKIPPED" classifies as 'skipped' |
| **Method** | Call classify_line("test_foo SKIPPED"); assert result |
| **Pass** | Returns "skipped" |

### `test_skip_substring`
| | |
|---|---|
| **Tests** | Line containing "SKIP" substring classifies as 'skipped' |
| **Method** | Call classify_line("SKIP reason=..."); assert result |
| **Pass** | Returns "skipped" |

### `test_equals_header`
| | |
|---|---|
| **Tests** | Line with === border classifies as 'header' |
| **Method** | Call classify_line("=== session starts ==="); assert result |
| **Pass** | Returns "header" |

### `test_dashes_header`
| | |
|---|---|
| **Tests** | Line with --- border classifies as 'header' |
| **Method** | Call classify_line("--- coverage ---"); assert result |
| **Pass** | Returns "header" |

### `test_summary_line`
| | |
|---|---|
| **Tests** | Line with result summary (e.g., "3 passed in 0.12s") classifies as 'summary' |
| **Method** | Call classify_line("3 passed in 0.12s"); assert result |
| **Pass** | Returns "summary" |

### `test_meta_platform`
| | |
|---|---|
| **Tests** | Line with "platform" keyword classifies as 'meta' |
| **Method** | Call classify_line("platform linux -- Python 3.11"); assert result |
| **Pass** | Returns "meta" |

### `test_meta_rootdir`
| | |
|---|---|
| **Tests** | Line with "rootdir:" classifies as 'meta' |
| **Method** | Call classify_line("rootdir: /home/user/Vz2.0/backend"); assert result |
| **Pass** | Returns "meta" |

### `test_meta_collected`
| | |
|---|---|
| **Tests** | Line with "collected" keyword classifies as 'meta' |
| **Method** | Call classify_line("collected 5 items"); assert result |
| **Pass** | Returns "meta" |

### `test_plain_text_is_normal`
| | |
|---|---|
| **Tests** | Plain text line classifies as 'normal' |
| **Method** | Call classify_line("some random line"); assert result |
| **Pass** | Returns "normal" |

### `test_empty_string_is_normal`
| | |
|---|---|
| **Tests** | Empty string classifies as 'normal' |
| **Method** | Call classify_line(""); assert result |
| **Pass** | Returns "normal" |

### `test_passed_wins_over_failed_substring`
| | |
|---|---|
| **Tests** | PASSED check runs before FAILED check; "test_failed_login PASSED" is 'passed' not 'failed' |
| **Method** | Call classify_line("test_failed_login PASSED"); assert result |
| **Pass** | Returns "passed" |

### `test_mid_percent`
| | |
|---|---|
| **Tests** | Line with [NN%] marker is counted as test result |
| **Method** | Call is_test_result("test_x PASSED  [ 57%]"); assert True |
| **Pass** | Returns True |

### `test_hundred_percent`
| | |
|---|---|
| **Tests** | Line with [100%] is counted as test result |
| **Method** | Call is_test_result("test_x PASSED  [100%]"); assert True |
| **Pass** | Returns True |

### `test_single_digit_padded`
| | |
|---|---|
| **Tests** | Line with padded single-digit percent is counted |
| **Method** | Call is_test_result("test_x PASSED [  1%]"); assert True |
| **Pass** | Returns True |

### `test_zero_percent`
| | |
|---|---|
| **Tests** | Line with [0%] is counted as test result |
| **Method** | Call is_test_result("test_x PASSED [  0%]"); assert True |
| **Pass** | Returns True |

### `test_no_percent`
| | |
|---|---|
| **Tests** | Line without [NN%] is not counted (e.g., metadata lines) |
| **Method** | Call is_test_result("collected 5 items"); assert False |
| **Pass** | Returns False |

### `test_time_bracket_not_percent`
| | |
|---|---|
| **Tests** | Line with time bracket [0.12s] is not counted as test result |
| **Method** | Call is_test_result("[0.12s]"); assert False |
| **Pass** | Returns False |

### `test_empty`
| | |
|---|---|
| **Tests** | Empty string is not a test result |
| **Method** | Call is_test_result(""); assert False |
| **Pass** | Returns False |

### `test_verbose_passed_no_percent`
| | |
|---|---|
| **Tests** | Verbose pytest format (subprocess.PIPE) without [NN%] is still counted as result |
| **Method** | Call is_test_result("tests/test_x.py::test_ok PASSED"); assert True |
| **Pass** | Returns True |

### `test_verbose_failed_no_percent`
| | |
|---|---|
| **Tests** | Verbose FAILED line without [NN%] is counted |
| **Method** | Call is_test_result("tests/test_x.py::test_bad FAILED"); assert True |
| **Pass** | Returns True |

### `test_verbose_skipped_no_percent`
| | |
|---|---|
| **Tests** | Verbose SKIPPED line without [NN%] is counted |
| **Method** | Call is_test_result("tests/test_x.py::test_x SKIPPED"); assert True |
| **Pass** | Returns True |

### `test_verbose_skipped_with_reason`
| | |
|---|---|
| **Tests** | Verbose SKIPPED with reason parenthetical is counted |
| **Method** | Call is_test_result("tests/test_x.py::test_x SKIPPED (needs net)"); assert True |
| **Pass** | Returns True |

### `test_summary_line_not_counted`
| | |
|---|---|
| **Tests** | Summary list line "FAILED <path>::<name>" is not double-counted as a result |
| **Method** | Call is_test_result("FAILED tests/test_x.py::test_bad - AssertionError"); assert False |
| **Pass** | Returns False |

### `test_narrative_with_doublecolon_not_counted`
| | |
|---|---|
| **Tests** | Narrative line with :: but no PASSED/FAILED/SKIPPED is not counted |
| **Method** | Call is_test_result("   at module::function in /some/path"); assert False |
| **Pass** | Returns False |

### `test_pytest_ini_marker`
| | |
|---|---|
| **Tests** | _find_project_root walks up from file and stops at pytest.ini |
| **Method** | Create tmp structure with pytest.ini at root; call _find_project_root(nested_file) |
| **Pass** | Returns root containing pytest.ini |

### `test_fly_preview_toml_marker`
| | |
|---|---|
| **Tests** | _find_project_root stops at fly.preview.toml marker |
| **Method** | Create tmp structure with fly.preview.toml at root; call _find_project_root(nested_file) |
| **Pass** | Returns root containing fly.preview.toml |

### `test_backend_frontend_siblings_marker`
| | |
|---|---|
| **Tests** | _find_project_root detects backend+frontend sibling dirs as repo root |
| **Method** | Create tmp structure with backend/ and frontend/ siblings; call on nested file |
| **Pass** | Returns root containing both directories |

### `test_pytest_ini_beats_repo_marker`
| | |
|---|---|
| **Tests** | pytest.ini at inner dir wins over backend+frontend further up (first-hit walk) |
| **Method** | Create structure with pytest.ini at backend/, backend+frontend at outer; call on nested file |
| **Pass** | Returns backend/ dir containing pytest.ini, not outer root |

### `test_no_markers_falls_back`
| | |
|---|---|
| **Tests** | With no markers anywhere, fallback path returns a valid Path without raising |
| **Method** | Create deep nested structure with no markers; call _find_project_root(deep_file) |
| **Pass** | Returns a Path instance; never raises or returns None |

### `test_current_repo_resolves_to_backend`
| | |
|---|---|
| **Tests** | Regression: real system.py resolves to backend/ directory with pytest.ini and tests/ |
| **Method** | Call _find_project_root() with no args (uses real file); verify structure |
| **Pass** | Returned path has pytest.ini and tests/ directory |

### `test_direct_tests_dir`
| | |
|---|---|
| **Tests** | _resolve_test_path returns tests/ when it exists directly under PROJECT_ROOT |
| **Method** | Create tmp with tests/ at root; call _resolve_test_path(root) |
| **Pass** | Returns root/tests |

### `test_nested_backend_tests`
| | |
|---|---|
| **Tests** | _resolve_test_path finds backend/tests/ layout when PROJECT_ROOT is repo root |
| **Method** | Create tmp with backend/tests/ structure; call _resolve_test_path(root) |
| **Pass** | Returns root/backend/tests |

### `test_no_tests_dir_returns_direct_path`
| | |
|---|---|
| **Tests** | Fallback: returns direct path even if it doesn't exist so pytest errors loudly |
| **Method** | Create tmp with no tests dir; call _resolve_test_path(root) |
| **Pass** | Returns root/tests (fallback path) |

### `test_direct_preferred_over_nested`
| | |
|---|---|
| **Tests** | Direct tests/ is preferred over nested backend/tests/ when both exist |
| **Method** | Create tmp with both layouts; call _resolve_test_path(root) |
| **Pass** | Returns root/tests (direct) not root/backend/tests |

### `test_regression_current_repo_resolves`
| | |
|---|---|
| **Tests** | End-to-end: PROJECT_ROOT + _resolve_test_path lands on real tests/ with files |
| **Method** | Call _resolve_test_path(PROJECT_ROOT) on current repo; verify directory exists and has test_*.py |
| **Pass** | Resolved path is a directory with at least one test_*.py file |

### `test_version_returns_app_version`
| | |
|---|---|
| **Tests** | GET /system/version returns settings.app_version in response |
| **Method** | HTTP GET /api/v1/system/version; verify response |
| **Pass** | Status 200, response equals {"version": "9.9.9-test"} (or configured version) |

### `test_version_needs_no_auth`
| | |
|---|---|
| **Tests** | Version endpoint is unauthenticated; flipping auth_enforced=True does not gate it |
| **Method** | Set auth_enforced=True; HTTP GET /system/version without bearer |
| **Pass** | Status 200, response has "version" key |

### `test_run_tests_happy_path`
| | |
|---|---|
| **Tests** | SSE stream with 2 PASSED tests produces passed=2, exit_code=0, correct event sequence |
| **Method** | Mock pytest with 2 PASSED results; stream SSE; parse events |
| **Pass** | start → 3× output (header + 2 results) → complete; complete has passed=2, failed=0, skipped=0, exit_code=0 |

### `test_run_tests_mixed_results`
| | |
|---|---|
| **Tests** | PASSED + FAILED + SKIPPED each bumps correct counter when line has [NN%] marker |
| **Method** | Mock pytest with mixed results; stream SSE; inspect complete event |
| **Pass** | complete has passed=2, failed=1, skipped=1, exit_code=1 |

### `test_run_tests_narrative_lines_dont_count`
| | |
|---|---|
| **Tests** | Lines with PASSED but no [NN%] marker are not counted (e.g., log messages) |
| **Method** | Mock pytest with narrative lines; stream SSE; verify counters at zero |
| **Pass** | complete has passed=0, failed=0, skipped=0; styling still applied to output |

### `test_run_tests_error_sentinel`
| | |
|---|---|
| **Tests** | __ERROR__:... prefix is stripped and line emitted with 'failed' style |
| **Method** | Mock pytest with __ERROR__:ValueError message; stream SSE |
| **Pass** | One output event with line="ValueError: something broke", style="failed", is_result=False |

### `test_run_tests_done_nonzero_exit`
| | |
|---|---|
| **Tests** | __DONE__:N propagates exit code N into complete event |
| **Method** | Mock __DONE__:N for various N (0, 1, 2, 5); stream SSE each; verify exit codes |
| **Pass** | Each complete event has exit_code matching N |

### `test_run_tests_done_non_numeric_payload`
| | |
|---|---|
| **Tests** | Non-numeric __DONE__ payload (e.g., "not-a-number") defaults to exit_code=1 |
| **Method** | Mock __DONE__:not-a-number; stream SSE |
| **Pass** | complete event has exit_code=1 (default) |

### `test_run_tests_done_with_extra_colon`
| | |
|---|---|
| **Tests** | __DONE__:N with extra colons (N:extra:junk) does not crash; defaults to exit_code=1 |
| **Method** | Mock __DONE__:42:extra:junk; stream SSE |
| **Pass** | complete event emitted with exit_code=1 (int() on "42:extra:junk" fails safely) |

### `test_run_tests_soft_mode_allows_anonymous`
| | |
|---|---|
| **Tests** | With auth_enforced=False, missing Authorization header records SEC-005 but allows POST |
| **Method** | Set auth_enforced=False; HTTP POST /system/run-tests without bearer; stream SSE |
| **Pass** | Stream opens, complete event emitted |

### `test_run_tests_strict_no_token_returns_401`
| | |
|---|---|
| **Tests** | With auth_enforced=True, missing bearer → 401 before handler runs |
| **Method** | Set auth_enforced=True; HTTP POST /system/run-tests without bearer |
| **Pass** | Response status 401 |

### `test_run_tests_strict_non_manager_returns_403`
| | |
|---|---|
| **Tests** | With auth_enforced=True, valid bearer for non-manager role → 403 |
| **Method** | Set auth_enforced=True; create bearer for "server" role; POST /run-tests |
| **Pass** | Response status 403 |

### `test_run_tests_strict_manager_passes`
| | |
|---|---|
| **Tests** | With auth_enforced=True, valid bearer for manager role opens stream |
| **Method** | Set auth_enforced=True; create bearer for "manager" role; stream POST /run-tests |
| **Pass** | Stream opens, complete event emitted with exit_code=0 |

### `test_run_tests_strict_admin_and_owner_pass`
| | |
|---|---|
| **Tests** | admin and owner roles both pass the manager gate |
| **Method** | Set auth_enforced=True; create bearers for admin and owner; POST each |
| **Pass** | Both requests return status 200 |

### `test_run_tests_integration_all_pass`
| | |
|---|---|
| **Tests** | Real pytest subprocess on tmp tests dir with passing test reports at least 1 pass, exit 0 |
| **Method** | Create tmp/tests/test_trivial.py with simple assert True; mount as PROJECT_ROOT; stream SSE |
| **Pass** | Stream has complete event with exit_code=0, passed >= 1, failed=0 |

### `test_run_tests_integration_with_failure`
| | |
|---|---|
| **Tests** | Real pytest subprocess with failing test reports failed >= 1 and non-zero exit |
| **Method** | Create tmp test with passing + failing tests; stream SSE |
| **Pass** | Stream has complete event with exit_code != 0, failed >= 1, passed >= 1 |

### `test_run_tests_integration_no_tests_dir`
| | |
|---|---|
| **Tests** | With no tests/ directory, pytest errors and stream terminates cleanly with non-zero exit |
| **Method** | Mount empty tmp as PROJECT_ROOT (no tests dir); stream SSE |
| **Pass** | Stream has complete event with exit_code != 0; does not hang |



---

# Frontend Tests (Terminal)

## `auth-client.test.js`
> Tests token-storage and fetch-interceptor contract to prevent silent 401s on /api/* requests

### `setToken → getToken roundtrip persists all fields`
| | |
|---|---|
| **Tests** | Token storage roundtrip persists token, employee_id, name, roles fields |
| **Method** | vi.resetModules() + dynamic import; sessionStorage.setItem/getItem |
| **Pass** | getToken() and getSession() return expected values after setToken() |

### `setToken with missing token is a no-op`
| | |
|---|---|
| **Tests** | setToken rejects null/undefined/{}/missing-token inputs |
| **Method** | Call setToken with falsy/incomplete values; check getToken() remains null |
| **Pass** | getToken() is null after invalid setToken calls |

### `clearToken removes the session; survives a throwing sessionStorage`
| | |
|---|---|
| **Tests** | clearToken removes token and gracefully handles sessionStorage.removeItem throw |
| **Method** | vi.spyOn sessionStorage.removeItem to throw; call clearToken in try/catch |
| **Pass** | clearToken() does not throw even when removeItem fails |

### `installAuthFetchInterceptor is idempotent (second call does not double-wrap)`
| | |
|---|---|
| **Tests** | Second call to installAuthFetchInterceptor returns without re-wrapping |
| **Method** | Import module (installs interceptor); call again; compare window.fetch references |
| **Pass** | window.fetch reference unchanged after second call |

### `attaches Authorization: Bearer <token> on /api/* requests when a token is stored`
| | |
|---|---|
| **Tests** | Stored token is injected as Authorization header on /api/* fetch calls |
| **Method** | setToken; call fetch('/api/v1/orders'); inspect fetchMock.mock.calls |
| **Pass** | init.headers.get('Authorization') equals 'Bearer abc123' |

### `does NOT attach Authorization for non-/api/ URLs`
| | |
|---|---|
| **Tests** | Non-/api/ URLs and external CDN requests do not receive Authorization header |
| **Method** | setToken; fetch non-API URLs; check mock call headers |
| **Pass** | Authorization header absent from /static/* and https://cdn.* requests |

### `does NOT clobber a caller-supplied Authorization header`
| | |
|---|---|
| **Tests** | Interceptor preserves caller-supplied Authorization header value |
| **Method** | setToken; fetch with explicit Authorization header; check mock call |
| **Pass** | Authorization header remains 'Bearer caller-override', not replaced |

---

## `category-grid.test.js`
> CategoryGrid component constructor and public API for tile-based navigation

### `CategoryGrid — State A > renders one tile per top-level category`
| | |
|---|---|
| **Tests** | Initial render creates one tile element for each category object |
| **Method** | Create CategoryGrid with 2-item data; count DOM tiles |
| **Pass** | tiles(container).length equals 2 |

### `CategoryGrid — State A > sorts categories alphabetically by default`
| | |
|---|---|
| **Tests** | Categories sort A-Z by label unless sort option override |
| **Method** | Create with unsorted data; read tileLabels() |
| **Pass** | tileLabels equals ['Apple', 'Mango', 'Zucchini'] |

### `CategoryGrid — State A > sort:"none" preserves insertion order`
| | |
|---|---|
| **Tests** | sort:'none' option disables alphabetic sort |
| **Method** | Create with sort:'none' and unordered data; check tile labels |
| **Pass** | tileLabels equals ['Zucchini', 'Apple'] |

### `CategoryGrid — State A > shows no tiles for empty data`
| | |
|---|---|
| **Tests** | Empty data array renders zero tiles |
| **Method** | Create with data:[] and count tiles |
| **Pass** | tiles(container).length equals 0 |

### `CategoryGrid — drill navigation > tapping a category tile switches to State B with back tile + children`
| | |
|---|---|
| **Tests** | Click category drills to State B: back tile + item children |
| **Method** | Create grid with nested items; tap category tile; read new labels |
| **Pass** | tileLabels contains 'Food' (back) and item names 'Burger', 'Fries' |

### `CategoryGrid — drill navigation > tapping the back tile returns to State A`
| | |
|---|---|
| **Tests** | Clicking back tile from State B returns to State A |
| **Method** | Drill to State B; tap back tile (label='Food'); check labels |
| **Pass** | tileLabels equals ['Food'] (only the category) |

### `CategoryGrid — drill navigation > tapping a leaf item fires onSelect with the item and empty mods`
| | |
|---|---|
| **Tests** | Clicking item in State B invokes onSelect callback |
| **Method** | Drill to State B; tap item; inspect onSelect mock call |
| **Pass** | onSelect called with item object and empty mods object |

### `CategoryGrid — drill navigation > renders price on item tiles when provided`
| | |
|---|---|
| **Tests** | Item price displays as second child element with $ prefix |
| **Method** | Drill to item; read burgerTile.children[1].textContent |
| **Pass** | Price element contains '$9.99' |

### `CategoryGrid — nav lock > lockNav() prevents tile clicks from navigating`
| | |
|---|---|
| **Tests** | lockNav() blocks tile click events and onSelect callback |
| **Method** | Call grid.lockNav(); tap tile; check onSelect not called and labels unchanged |
| **Pass** | onSelect not called and tileLabels still ['Food'] |

### `CategoryGrid — nav lock > unlockNav() re-enables navigation after lockNav()`
| | |
|---|---|
| **Tests** | unlockNav() restores navigation after lockNav() |
| **Method** | lockNav; unlockNav; tap category; check navigation works |
| **Pass** | tileLabels contains item 'Burger' |

### `CategoryGrid — public API > reset() returns to State A from State B`
| | |
|---|---|
| **Tests** | Calling reset() reverts drilled State B back to State A |
| **Method** | Drill to State B; call grid.reset(); check labels |
| **Pass** | tileLabels equals ['Food'] |

### `CategoryGrid — public API > setData() replaces data and resets to State A`
| | |
|---|---|
| **Tests** | setData() updates grid data and returns to State A |
| **Method** | Drill to State B; call setData with new category; check labels |
| **Pass** | tileLabels equals ['Drinks'] (new single category) |

### `CategoryGrid — public API > getCatId() returns null at State A`
| | |
|---|---|
| **Tests** | getCatId() returns null when no category drilled into |
| **Method** | Create grid; call getCatId(); check return value |
| **Pass** | getCatId() is null |

### `CategoryGrid — public API > getCatId() returns the drilled-into category id`
| | |
|---|---|
| **Tests** | getCatId() returns id of currently-drilled category |
| **Method** | Drill into category 'cat-food'; call getCatId() |
| **Pass** | getCatId() equals 'cat-food' |

### `CategoryGrid — public API > destroy() removes the grid from the DOM`
| | |
|---|---|
| **Tests** | destroy() removes grid root element from container |
| **Method** | Create grid; call destroy(); count children |
| **Pass** | container.children.length equals 0 |

### `CategoryGrid — public API > setColumns() updates the grid template columns`
| | |
|---|---|
| **Tests** | setColumns(n) updates grid CSS grid-template-columns |
| **Method** | Create grid with columns:3; call setColumns(5); check style |
| **Pass** | gridRoot.style.gridTemplateColumns equals 'repeat(5, 1fr)' |

### `CategoryGrid — public API > setSort() re-renders with the new sort order`
| | |
|---|---|
| **Tests** | setSort() changes sort mode and updates tile order |
| **Method** | Create with default (alpha) sort; call setSort('none'); check labels |
| **Pass** | tileLabels changes from ['Apple', 'Zucchini'] to ['Zucchini', 'Apple'] |

### `CategoryGrid — public API > showPickList() renders a back tile and the provided items`
| | |
|---|---|
| **Tests** | showPickList(label, colors, items) renders custom item list |
| **Method** | Create empty grid; call showPickList with items; check labels |
| **Pass** | tileLabels contains 'Sides', 'Mac', 'Slaw' |

### `CategoryGrid — modifier flow > tapping an item with requiredMods enters mod-groups view`
| | |
|---|---|
| **Tests** | Clicking item with requiredMods switches to mod-groups state |
| **Method** | Create with ITEM having requiredMods; drill and tap item; check labels |
| **Pass** | tileLabels contains 'Burger' (back) and 'Doneness' (group) |

### `CategoryGrid — modifier flow > DONE tile is absent before any group is satisfied`
| | |
|---|---|
| **Tests** | DONE button not rendered until all required modifier groups selected |
| **Method** | Drill to mod-groups view; check tileLabels |
| **Pass** | tileLabels does not contain 'DONE' |

### `CategoryGrid — modifier flow > tapping a group tile drills into its choices`
| | |
|---|---|
| **Tests** | Click modifier group to show its choice options |
| **Method** | Drill to mod-groups; tap 'Doneness' group; check labels |
| **Pass** | tileLabels contains 'Medium' and 'Well Done' |

### `CategoryGrid — modifier flow > picking a choice returns to groups view and shows DONE when all groups satisfied`
| | |
|---|---|
| **Tests** | Selecting a choice returns to groups view; DONE shown when all groups satisfied |
| **Method** | Drill to mod-groups; tap group; tap choice; check labels |
| **Pass** | tileLabels contains 'Medium' (updated group label) and 'DONE' |

### `CategoryGrid — modifier flow > single-select: picking a second choice replaces the first`
| | |
|---|---|
| **Tests** | Selecting a different choice in same group deselects the previous choice |
| **Method** | Select 'Medium'; tap group again; select 'Well Done'; check labels |
| **Pass** | tileLabels contains 'Well Done' but not 'Medium' |

### `CategoryGrid — modifier flow > tapping DONE fires onSelect with item + selectedMods then returns to State B`
| | |
|---|---|
| **Tests** | Click DONE button invokes onSelect with item + filled mods, returns to State B |
| **Method** | Drill to mods; select choices; tap DONE; inspect onSelect mock |
| **Pass** | onSelect called once with item and selectedMods array |

### `CategoryGrid — modifier flow > back tile in mod-groups cancels the flow and returns to State B`
| | |
|---|---|
| **Tests** | Clicking back tile in mod-groups returns to State B without invoking onSelect |
| **Method** | Drill to mods; tap back tile; check onSelect not called and labels |
| **Pass** | tileLabels shows item 'Burger' and onSelect not called |

### `CategoryGrid — modifier flow > item with requiredMods having no choices calls onSelect directly`
| | |
|---|---|
| **Tests** | Item with requiredMods that have zero choices skips mod UI and invokes onSelect |
| **Method** | Create with item having empty requiredMods.choices; tap item; check onSelect |
| **Pass** | onSelect called immediately with item and empty mods |

---

## `charts.test.js`
> Pure math helpers and buildStatCard/buildSparkline DOM factory API

### `_normalize > maps min to 0 and max to 1 for a distinct-value array`
| | |
|---|---|
| **Tests** | _normalize scales array values to [0,1] range |
| **Method** | Call _normalize([0, 5, 10]); check each element |
| **Pass** | result[0]≈0, result[1]≈0.5, result[2]≈1 |

### `_normalize > returns all zeros when all values are equal (zero-range guard)`
| | |
|---|---|
| **Tests** | _normalize returns [0, 0, 0] when input has zero range |
| **Method** | Call _normalize([3, 3, 3]); check equality |
| **Pass** | result equals [0, 0, 0] |

### `_normalize > handles a single-element array`
| | |
|---|---|
| **Tests** | _normalize processes single-element array |
| **Method** | Call _normalize([42]); check result |
| **Pass** | result equals [0] |

### `_normalize > handles negative values correctly`
| | |
|---|---|
| **Tests** | _normalize scales negative values within [0,1] range |
| **Method** | Call _normalize([-4, 0, 4]); check elements |
| **Pass** | result[0]≈0, result[1]≈0.5, result[2]≈1 |

### `_normalize > handles an already-normalized [0,1] input`
| | |
|---|---|
| **Tests** | _normalize passes through [0,1] input unchanged |
| **Method** | Call _normalize([0, 1]); check elements |
| **Pass** | result[0]≈0, result[1]≈1 |

### `_linePath > starts with "M" for the first point`
| | |
|---|---|
| **Tests** | _linePath SVG path starts with M (moveto) command |
| **Method** | Call _linePath([0, 10], 100, 40); check first character |
| **Pass** | d.startsWith('M') is true |

### `_linePath > uses "L" for subsequent points`
| | |
|---|---|
| **Tests** | _linePath uses L (lineto) for points after first |
| **Method** | Call _linePath([0, 5, 10], 100, 40); split by space and check parts |
| **Pass** | parts[1] and parts[2] start with 'L' |

### `_linePath > produces exactly N segments for N data points`
| | |
|---|---|
| **Tests** | _linePath output has one segment per data point |
| **Method** | Call with 5-element data; split and count parts |
| **Pass** | split(' ').length equals 5 |

### `_linePath > first point x is 0.0, last point x equals vbW`
| | |
|---|---|
| **Tests** | _linePath first x=0 and last x=vbW (viewBox width) |
| **Method** | Parse path coordinates; extract first and last x |
| **Pass** | firstX≈0, lastX≈100 (vbW) |

### `_linePath > higher data values produce lower y (inverted axis)`
| | |
|---|---|
| **Tests** | _linePath inverts y-axis: higher values → lower y coords |
| **Method** | Call with [0, 10]; parse y coords of first and last point |
| **Pass** | firstY > lastY (min value has larger y) |

### `_areaPath > ends with Z (closed path)`
| | |
|---|---|
| **Tests** | _areaPath SVG path ends with Z (closepath) command |
| **Method** | Call _areaPath([0, 5, 10], 100, 40); check last character |
| **Pass** | d.endsWith('Z') is true |

### `_areaPath > contains the vbW,vbH corner point to close the area`
| | |
|---|---|
| **Tests** | _areaPath includes bottom-right corner point to close path |
| **Method** | Call _areaPath([0, 10], 100, 40); check string |
| **Pass** | d contains 'L100,40' |

### `_areaPath > contains the 0,vbH corner point to close the area`
| | |
|---|---|
| **Tests** | _areaPath includes bottom-left corner point to close path |
| **Method** | Call _areaPath([0, 10], 100, 40); check string |
| **Pass** | d contains 'L0,40' |

### `buildStatCard > returns an object with wrap, setValue, setDelta, setState`
| | |
|---|---|
| **Tests** | buildStatCard returns card object with required control methods |
| **Method** | Call buildStatCard(); check properties exist and have correct type |
| **Pass** | wrap is HTMLElement; setValue/setDelta/setState are functions |

### `buildStatCard > setValue() updates the value element text`
| | |
|---|---|
| **Tests** | setValue() changes displayed value text |
| **Method** | Call setValue('$75'); query divs and check textContent |
| **Pass** | Some div contains textContent '$75' |

### `buildStatCard > setDelta() updates the delta element text`
| | |
|---|---|
| **Tests** | setDelta() changes displayed delta text |
| **Method** | Call setDelta('▼ 5'); query divs and check textContent |
| **Pass** | Some div contains textContent '▼ 5' |

### `buildStatCard > setState("warning") applies a border to the wrap`
| | |
|---|---|
| **Tests** | setState('warning') sets border style |
| **Method** | Call setState('warning'); check wrap.style.border |
| **Pass** | wrap.style.border is truthy |

### `buildStatCard > setState("normal") clears the border`
| | |
|---|---|
| **Tests** | setState('normal') clears border and sets normal appearance |
| **Method** | Call setState('warning') then setState('normal'); check styles |
| **Pass** | wrap.style.boxShadow equals 'none' |

### `buildStatCard > title is uppercased in the header`
| | |
|---|---|
| **Tests** | buildStatCard uppercases title in rendered header |
| **Method** | Create with title:'net sales'; query spans and check textContent |
| **Pass** | Some span contains 'NET SALES' |

### `buildSparkline > returns a div wrapping an SVG element`
| | |
|---|---|
| **Tests** | buildSparkline returns div container with SVG child |
| **Method** | Call buildSparkline(); check tagName and querySelector('svg') |
| **Pass** | wrap.tagName is 'DIV' and querySelector('svg') not null |

### `buildSparkline > SVG contains two path elements (area + line)`
| | |
|---|---|
| **Tests** | buildSparkline SVG has two paths (area fill + line stroke) |
| **Method** | Call buildSparkline(); count path elements |
| **Pass** | querySelectorAll('path').length equals 2 |

---

## `components.test.js`
> showToast and buildRoleButton DOM factory helpers

### `showToast > appends a div to document.body`
| | |
|---|---|
| **Tests** | showToast creates and appends toast element to body |
| **Method** | Call showToast('Hello world'); count body children |
| **Pass** | document.body.children.length equals 1 |

### `showToast > sets the toast textContent to the message`
| | |
|---|---|
| **Tests** | Toast element textContent matches message parameter |
| **Method** | Call showToast('Test message'); read firstElementChild.textContent |
| **Pass** | textContent equals 'Test message' |

### `showToast > removes the toast after duration + fade (fake timers)`
| | |
|---|---|
| **Tests** | Toast element removed from DOM after duration timeout plus fade time |
| **Method** | vi.useFakeTimers(); showToast with duration:100; advance 100+250ms |
| **Pass** | document.body.children.length equals 0 after timeout |

### `showToast > applies a custom bg color to the toast style`
| | |
|---|---|
| **Tests** | showToast applies custom background color to style |
| **Method** | Call showToast with bg:'#123456'; check toast.style.background |
| **Pass** | style.background equals rgb(18, 52, 86) |

### `showToast > uses T.verm as the default background`
| | |
|---|---|
| **Tests** | Toast defaults to T.verm (#e8472a) background |
| **Method** | Call showToast without bg option; check style.background |
| **Pass** | style.background equals rgb(232, 71, 42) |

### `buildRoleButton > returns a div (not a button)`
| | |
|---|---|
| **Tests** | buildRoleButton returns div element, not button element |
| **Method** | Call buildRoleButton(); check tagName |
| **Pass** | wrap.tagName equals 'DIV' |

### `buildRoleButton > textContent is the uppercased role name`
| | |
|---|---|
| **Tests** | buildRoleButton displays role name in uppercase |
| **Method** | Call buildRoleButton('manager', ...); check textContent |
| **Pass** | wrap.textContent equals 'MANAGER' |

### `buildRoleButton > _roleName reflects the roleName argument`
| | |
|---|---|
| **Tests** | buildRoleButton stores roleName in _roleName property |
| **Method** | Call buildRoleButton('Bartender', ...); check _roleName |
| **Pass** | wrap._roleName equals 'Bartender' |

### `buildRoleButton > _selected starts as false`
| | |
|---|---|
| **Tests** | buildRoleButton initializes _selected to false |
| **Method** | Call buildRoleButton(); check _selected property |
| **Pass** | wrap._selected equals false |

### `buildRoleButton > onSelect is called with roleName on pointerup`
| | |
|---|---|
| **Tests** | Dispatching pointerup event invokes onSelect callback with role name |
| **Method** | Create button; dispatchEvent(new Event('pointerup')); check onSelect mock |
| **Pass** | onSelect called with 'Server' |

### `buildRoleButton > _resetVisual can be called without error in default (unselected) state`
| | |
|---|---|
| **Tests** | _resetVisual() executes without throwing in unselected state |
| **Method** | Create button; call _resetVisual(); wrap in expect/not.toThrow |
| **Pass** | No exception thrown |

### `buildRoleButton > _resetVisual applies selected styles when _selected is true`
| | |
|---|---|
| **Tests** | _resetVisual() applies roleColor background when _selected=true |
| **Method** | Set _selected=true; call _resetVisual(); check background |
| **Pass** | wrap.style.background equals rgb(232, 71, 42) (roleColor) |

### `buildRoleButton > _resetVisual applies default card background when unselected`
| | |
|---|---|
| **Tests** | _resetVisual() applies T.card background when _selected=false |
| **Method** | Set _selected=false; call _resetVisual(); check background |
| **Pass** | wrap.style.background equals rgb(45, 49, 57) (T.card) |

---

## `discount.test.js`
> Amount math and request body shape for /api/v1/orders/{id}/discount

### `terminal/discount > computeDiscountAmount > 10% of a single $20 item → $2.00 (always 2dp)`
| | |
|---|---|
| **Tests** | computeDiscountAmount returns correctly rounded 2-decimal result |
| **Method** | Call computeDiscountAmount([{price:20, qty:1}], 10); check result |
| **Pass** | Result equals 2 |

### `terminal/discount > computeDiscountAmount > sums modifier prices into each line before applying pct`
| | |
|---|---|
| **Tests** | Modifier prices added to line subtotal before percentage applied |
| **Method** | Call with item having mods array; verify (price+mods)*qty*pct calculation |
| **Pass** | Result equals 1.95 |

### `terminal/discount > computeDiscountAmount > respects qty on each line`
| | |
|---|---|
| **Tests** | Quantity multiplier applied to line total |
| **Method** | Call with qty:3; verify price*qty*pct |
| **Pass** | Result equals 6 |

### `terminal/discount > computeDiscountAmount > rounds to exactly 2 decimal places (matches backend _validate_2dp)`
| | |
|---|---|
| **Tests** | Result rounds to exactly 2 decimal places, never more |
| **Method** | Call with various prices/percentages; verify decimal precision |
| **Pass** | String(result).split('.')[1].length <= 2 for all inputs |

### `terminal/discount > computeDiscountAmount > empty items → 0 (not NaN, not undefined)`
| | |
|---|---|
| **Tests** | computeDiscountAmount returns 0 for empty items array |
| **Method** | Call with [], 10; check result |
| **Pass** | Result equals 0 (not NaN or undefined) |

### `terminal/discount > computeDiscountAmount > lines missing price or qty default to safe zeros`
| | |
|---|---|
| **Tests** | Missing price/qty fields treated as 0, don't cause errors |
| **Method** | Call with items lacking price/qty; verify safe default behavior |
| **Pass** | Result equals 1 (safe defaults applied) |

### `terminal/discount > extractItemIds > returns only ids for lines that have been persisted (have item_id)`
| | |
|---|---|
| **Tests** | extractItemIds filters to only items with truthy item_id |
| **Method** | Call with mixed items; some with item_id, some without |
| **Pass** | Result equals ['a', 'b', 'c'] (empty/falsy IDs excluded) |

### `terminal/discount > extractItemIds > returns [] when nothing is persisted yet`
| | |
|---|---|
| **Tests** | extractItemIds returns empty array when no item_id present |
| **Method** | Call with items lacking item_id property |
| **Pass** | Result equals [] |

### `terminal/discount > buildDiscountBody > produces the exact wire shape the backend expects`
| | |
|---|---|
| **Tests** | buildDiscountBody returns object with correct key names and structure |
| **Method** | Call buildDiscountBody(10, 2.0, ['a','b'], 'mgr-pin-hash'); check keys/values |
| **Pass** | Result has discount_type, amount, reason, approved_by, item_ids with correct values |

### `terminal/discount > buildDiscountBody > approved_by falls back to null when omitted`
| | |
|---|---|
| **Tests** | approved_by set to null when undefined parameter passed |
| **Method** | Call buildDiscountBody with undefined approved_by; check result |
| **Pass** | result.approved_by equals null |

### `terminal/discount > buildDiscountBody > item_ids is null (not []) when no lines are persisted — backend has 400ed on empty arrays`
| | |
|---|---|
| **Tests** | item_ids set to null (not empty array) when no persisted IDs |
| **Method** | Call buildDiscountBody with empty IDs array; check result |
| **Pass** | result.item_ids equals null (not []) |

---

## `entomology-client.test.js`
> Offline queue + drain behavior, keepalive flag, never-throws contract

### `terminal/entomology-client > entReport returns a Promise that resolves (never throws) for valid input`
| | |
|---|---|
| **Tests** | entReport always returns resolvable Promise, never throws |
| **Method** | Call entReport(VALID); check instanceof Promise; await resolves |
| **Pass** | Promise resolves to defined value; fetchMock called once |

### `terminal/entomology-client > entReport with missing required fields resolves false and does NOT fetch`
| | |
|---|---|
| **Tests** | entReport rejects incomplete payloads (returns false, no fetch) |
| **Method** | Call with null, {}, missing source/message; check resolved value |
| **Pass** | Returns false; fetchMock not called |

### `terminal/entomology-client > entReport POSTs to /api/v1/entomology/client-event with keepalive: true`
| | |
|---|---|
| **Tests** | entReport sends POST with keepalive:true and correct body format |
| **Method** | Call entReport; inspect fetchMock.mock.calls[0] |
| **Pass** | URL is /api/v1/entomology/client-event, method is POST, keepalive is true |

### `terminal/entomology-client > when offline, entReport queues and does NOT fetch (resolves false)`
| | |
|---|---|
| **Tests** | entReport queues payloads when navigator.onLine=false, returns false |
| **Method** | Set navigator.onLine=false; call entReport twice; check fetchMock not called |
| **Pass** | fetchMock not called; entReport resolves false |

### `terminal/entomology-client > the 'online' event drains queued items`
| | |
|---|---|
| **Tests** | Queued items sent to server when 'online' event fires |
| **Method** | Go offline; queue 2 items; set online; dispatch 'online' event; check fetch |
| **Pass** | fetchMock called twice with queued event_codes |

---

## `half-placement-overlay.test.js`
> Mod-placement overlay for pizza-like half-and-half selections

### `half-placement overlay — header > header contains both itemName and modName`
| | |
|---|---|
| **Tests** | Overlay header displays both item and modifier names |
| **Method** | Call open() with itemName/modName; check header.textContent |
| **Pass** | Header contains 'Calzone' and 'Sausage' |

### `half-placement overlay — buttons > LEFT button calls onConfirm with { side: "Left" }`
| | |
|---|---|
| **Tests** | LEFT button dispatch invokes onConfirm with side:'Left' |
| **Method** | Open overlay; find and dispatch button('LEFT'); check onConfirm mock |
| **Pass** | onConfirm called with {side:'Left'} |

### `half-placement overlay — buttons > RIGHT button calls onConfirm with { side: "Right" }`
| | |
|---|---|
| **Tests** | RIGHT button dispatch invokes onConfirm with side:'Right' |
| **Method** | Open overlay; find and dispatch button('RIGHT'); check onConfirm mock |
| **Pass** | onConfirm called with {side:'Right'} |

### `half-placement overlay — buttons > CANCEL button calls onCancel`
| | |
|---|---|
| **Tests** | CANCEL button dispatch invokes onCancel callback |
| **Method** | Open overlay; find and dispatch button('CANCEL'); check onCancel mock |
| **Pass** | onCancel called |

### `half-placement overlay — column filtering > left column shows only mods with prefix="Left"`
| | |
|---|---|
| **Tests** | Left column renders only currentMods with prefix='Left' |
| **Method** | Open with mixed prefix mods; check document.body for 'Mushrooms' |
| **Pass** | Mushrooms (prefix='Left') appears in DOM |

### `half-placement overlay — column filtering > right column shows only mods with prefix="Right"`
| | |
|---|---|
| **Tests** | Right column renders only currentMods with prefix='Right' |
| **Method** | Open with Right-prefixed mods; click RIGHT; check onConfirm and DOM |
| **Pass** | Olives (prefix='Right') appears in DOM and onConfirm called |

### `half-placement overlay — column filtering > shows placeholder when a column has no mods`
| | |
|---|---|
| **Tests** | Empty columns display placeholder text |
| **Method** | Open with empty currentMods; check document.body.textContent |
| **Pass** | Contains 'Nothing on left' and 'Nothing on right' |

### `half-placement overlay — Xtra label > labels a mod as "Xtra" when the same mod is on the whole item`
| | |
|---|---|
| **Tests** | Half mod with whole-item counterpart displays "Xtra" prefix |
| **Method** | Open with Pepperoni whole + Pepperoni Left; check textContent |
| **Pass** | Document contains 'Xtra Pepperoni' |

### `half-placement overlay — Xtra label > does NOT label a mod as "Xtra" when it has no whole counterpart`
| | |
|---|---|
| **Tests** | Half mod without whole counterpart shows plain name, not "Xtra" |
| **Method** | Open with Mushrooms Left only; check textContent |
| **Pass** | Contains 'Mushrooms' but not 'Xtra Mushrooms' |

### `half-placement overlay — price display > uses half_price when provided and non-null`
| | |
|---|---|
| **Tests** | Mod with half_price property displays half_price, not price |
| **Method** | Open with mod having price:2.00, half_price:1.00; check textContent |
| **Pass** | Contains '$1.00' and not '$2.00' |

### `half-placement overlay — price display > falls back to price when half_price is null`
| | |
|---|---|
| **Tests** | Mod with null half_price displays price instead |
| **Method** | Open with mod having half_price:null; check textContent |
| **Pass** | Contains '$2.00' |

### `half-placement overlay — price display > omits price span when effective price is 0`
| | |
|---|---|
| **Tests** | Free mod ($0 effective price) has no price span rendered |
| **Method** | Open with price:0, half_price:null; check textContent |
| **Pass** | Does not contain '$0.00' |

### `showHalfPlacementOverlay — Promise wrapper > returns a Promise and calls SceneManager.interrupt`
| | |
|---|---|
| **Tests** | showHalfPlacementOverlay returns Promise and interrupts scene |
| **Method** | Call showHalfPlacementOverlay(); check return type and SceneManager.interrupt mock |
| **Pass** | Returns Promise; interrupt called with 'half-placement' and callbacks |

### `showHalfPlacementOverlay — Promise wrapper > resolves when the onConfirm callback is invoked`
| | |
|---|---|
| **Tests** | Promise resolves with onConfirm result when callback fired |
| **Method** | Call showHalfPlacementOverlay(); invoke onConfirm from mock; await promise |
| **Pass** | Promise resolves to {side:'Right'} |

### `showHalfPlacementOverlay — Promise wrapper > rejects when the onCancel callback is invoked`
| | |
|---|---|
| **Tests** | Promise rejects with error when onCancel callback fired |
| **Method** | Call showHalfPlacementOverlay(); invoke onCancel; await promise |
| **Pass** | Promise rejects with 'Interrupt cancelled' error |

---

## `header.test.js`
> Pure helper functions greetingFor, fmtTime, fmtDate

### `greetingFor > returns Good Evening before 5am (h=4)`
| | |
|---|---|
| **Tests** | greetingFor returns 'Good Evening' for hours before 5 |
| **Method** | Call greetingFor(4); check return value |
| **Pass** | Result equals 'Good Evening' |

### `greetingFor > returns Good Morning at exactly 5am`
| | |
|---|---|
| **Tests** | greetingFor returns 'Good Morning' at h=5 boundary |
| **Method** | Call greetingFor(5); check return value |
| **Pass** | Result equals 'Good Morning' |

### `greetingFor > returns Good Morning at 11am (just before noon)`
| | |
|---|---|
| **Tests** | greetingFor returns 'Good Morning' for h<12 |
| **Method** | Call greetingFor(11); check return value |
| **Pass** | Result equals 'Good Morning' |

### `greetingFor > returns Good Afternoon at exactly noon (h=12)`
| | |
|---|---|
| **Tests** | greetingFor returns 'Good Afternoon' at h=12 boundary |
| **Method** | Call greetingFor(12); check return value |
| **Pass** | Result equals 'Good Afternoon' |

### `greetingFor > returns Good Afternoon at 4pm (h=16)`
| | |
|---|---|
| **Tests** | greetingFor returns 'Good Afternoon' for 12<=h<17 |
| **Method** | Call greetingFor(16); check return value |
| **Pass** | Result equals 'Good Afternoon' |

### `greetingFor > returns Good Evening at exactly 5pm (h=17)`
| | |
|---|---|
| **Tests** | greetingFor returns 'Good Evening' at h=17 boundary |
| **Method** | Call greetingFor(17); check return value |
| **Pass** | Result equals 'Good Evening' |

### `greetingFor > returns Good Evening at midnight (h=0)`
| | |
|---|---|
| **Tests** | greetingFor returns 'Good Evening' for h=0 |
| **Method** | Call greetingFor(0); check return value |
| **Pass** | Result equals 'Good Evening' |

### `greetingFor > returns Good Evening at 11pm (h=23)`
| | |
|---|---|
| **Tests** | greetingFor returns 'Good Evening' for h=23 |
| **Method** | Call greetingFor(23); check return value |
| **Pass** | Result equals 'Good Evening' |

### `fmtTime > formats midnight as 12:00 AM`
| | |
|---|---|
| **Tests** | fmtTime converts h=0 to '12:00 AM' format |
| **Method** | Call fmtTime(new Date(0,0,1,0,0,0)); check return |
| **Pass** | Result equals '12:00 AM' |

### `fmtTime > formats 12:00 as 12:00 PM (noon)`
| | |
|---|---|
| **Tests** | fmtTime formats h=12 as '12:00 PM' |
| **Method** | Call fmtTime(new Date(0,0,1,12,0,0)); check return |
| **Pass** | Result equals '12:00 PM' |

### `fmtTime > formats 13:00 as 1:00 PM`
| | |
|---|---|
| **Tests** | fmtTime converts h=13 to 1:00 PM (12-hour format) |
| **Method** | Call fmtTime(new Date(0,0,1,13,0,0)); check return |
| **Pass** | Result equals '1:00 PM' |

### `fmtTime > formats 23:59 as 11:59 PM`
| | |
|---|---|
| **Tests** | fmtTime converts h=23 to 11:59 PM |
| **Method** | Call fmtTime(new Date(0,0,1,23,59,0)); check return |
| **Pass** | Result equals '11:59 PM' |

### `fmtTime > pads single-digit minutes with a leading zero`
| | |
|---|---|
| **Tests** | fmtTime zero-pads minutes (e.g., 9:05 not 9:5) |
| **Method** | Call fmtTime(new Date(0,0,1,9,5,0)); check return |
| **Pass** | Result equals '9:05 AM' |

### `fmtTime > formats 1:00 AM correctly`
| | |
|---|---|
| **Tests** | fmtTime formats h=1 as '1:00 AM' |
| **Method** | Call fmtTime(new Date(0,0,1,1,0,0)); check return |
| **Pass** | Result equals '1:00 AM' |

### `fmtDate > formats Thursday January 1 2026`
| | |
|---|---|
| **Tests** | fmtDate formats date as 'DOW · MON DD' (Jan 1 2026 is Thursday) |
| **Method** | Call fmtDate(new Date(2026,0,1)); check return |
| **Pass** | Result equals 'THU · JAN 1' |

### `fmtDate > formats Sunday December 27 2026`
| | |
|---|---|
| **Tests** | fmtDate handles Dec dates (Dec 27 2026 is Sunday) |
| **Method** | Call fmtDate(new Date(2026,11,27)); check return |
| **Pass** | Result equals 'SUN · DEC 27' |

### `fmtDate > formats Wednesday April 1 2026`
| | |
|---|---|
| **Tests** | fmtDate handles mid-year dates (April 1 2026 is Wednesday) |
| **Method** | Call fmtDate(new Date(2026,3,1)); check return |
| **Pass** | Result equals 'WED · APR 1' |

### `fmtDate > includes the numeric date in the output`
| | |
|---|---|
| **Tests** | fmtDate output contains date number |
| **Method** | Call fmtDate(June 15 2026); check output contains '15' |
| **Pass** | Result includes '15' |


---
## `keyboard.test.js`
> Tests for showKeyboard / hideKeyboard / isKeyboardVisible with DOM attachment and input options

### keyboard — visibility > isKeyboardVisible() is false before any call
| | |
|---|---|
| **Tests** | Initial visibility state is false before any keyboard function is invoked |
| **Method** | Direct assertion on isKeyboardVisible() return value; no DOM interaction |
| **Pass** | isKeyboardVisible() === false |

### keyboard — visibility > isKeyboardVisible() is true after showKeyboard()
| | |
|---|---|
| **Tests** | Visibility flag toggles to true when showKeyboard() is called |
| **Method** | Call showKeyboard({}), then assert isKeyboardVisible() |
| **Pass** | isKeyboardVisible() === true |

### keyboard — visibility > isKeyboardVisible() is false after hideKeyboard()
| | |
|---|---|
| **Tests** | Visibility flag returns to false after hideKeyboard() is invoked |
| **Method** | Call showKeyboard then hideKeyboard, assert false |
| **Pass** | isKeyboardVisible() === false |

### keyboard — visibility > hideKeyboard() is a no-op when the keyboard is already hidden
| | |
|---|---|
| **Tests** | hideKeyboard() does not throw and maintains false state when called on hidden keyboard |
| **Method** | Call hideKeyboard() without prior showKeyboard(); expect no throw; assert false |
| **Pass** | Function returns without error; isKeyboardVisible() === false |

### keyboard — DOM attachment > showKeyboard() appends the modal to document.body
| | |
|---|---|
| **Tests** | Modal DOM element is inserted into the DOM when showKeyboard() is called |
| **Method** | Call showKeyboard({}); check document.body.children.length > 0 |
| **Pass** | Body has child elements |

### keyboard — DOM attachment > hideKeyboard() removes the modal from document.body
| | |
|---|---|
| **Tests** | Modal DOM element is removed from the DOM when hideKeyboard() is called |
| **Method** | Call showKeyboard then hideKeyboard; check document.body.children.length === 0 |
| **Pass** | Body is empty |

### keyboard — DOM attachment > second showKeyboard() call reuses the same root element
| | |
|---|---|
| **Tests** | Root element is reused across multiple show/hide cycles (same object identity) |
| **Method** | Call showKeyboard, store firstElementChild, hideKeyboard, showKeyboard again, compare references |
| **Pass** | first === second (object identity match) |

### keyboard — input options > sets the input value from initialValue
| | |
|---|---|
| **Tests** | Input element receives value from initialValue option |
| **Method** | Call showKeyboard({ initialValue: 'hello' }); query input.value |
| **Pass** | input.value === 'hello' |

### keyboard — input options > clears the input value between calls (no carry-over)
| | |
|---|---|
| **Tests** | Previous input values do not persist to new showKeyboard() calls |
| **Method** | Call showKeyboard with initialValue, hideKeyboard, call showKeyboard without initialValue, query input |
| **Pass** | Second call's input.value === '' |

### keyboard — input options > sets maxLength when provided
| | |
|---|---|
| **Tests** | Input element maxLength attribute reflects the provided option |
| **Method** | Call showKeyboard({ maxLength: 8 }); query input.maxLength |
| **Pass** | input.maxLength === 8 |

### keyboard — input options > sets placeholder text
| | |
|---|---|
| **Tests** | Input placeholder attribute is set from option |
| **Method** | Call showKeyboard({ placeholder: 'Type here' }); query input.placeholder |
| **Pass** | input.placeholder === 'Type here' |

### keyboard — DONE callback > onDone fires with the current input value when DONE is tapped
| | |
|---|---|
| **Tests** | onDone callback is invoked with input value when DONE button receives pointerup event |
| **Method** | vi.fn() mock for onDone; find DONE button; dispatch pointerup; check mock call args |
| **Pass** | onDone called once with 'test value' |

### keyboard — DONE callback > keyboard hides after DONE is tapped (dismissOnDone default)
| | |
|---|---|
| **Tests** | Keyboard is hidden after DONE is tapped by default |
| **Method** | Call showKeyboard with onDone callback; dispatch pointerup on DONE button; check isKeyboardVisible() |
| **Pass** | isKeyboardVisible() === false |

### keyboard — DONE callback > keyboard stays visible when dismissOnDone:false
| | |
|---|---|
| **Tests** | Keyboard remains visible when dismissOnDone option is set to false |
| **Method** | Call showKeyboard({ onDone, dismissOnDone: false }); tap DONE; check isKeyboardVisible() |
| **Pass** | isKeyboardVisible() === true |

### keyboard — DONE callback > pressing Enter in the input fires onDone
| | |
|---|---|
| **Tests** | Enter key event on input triggers onDone callback with input value |
| **Method** | vi.fn() mock for onDone; dispatch KeyboardEvent with key 'Enter' on input element; check mock |
| **Pass** | onDone called once with 'enter test' |

### keyboard — CANCEL and dismiss > CANCEL button triggers onDismiss and hides the keyboard
| | |
|---|---|
| **Tests** | CANCEL button firing pointerup event triggers onDismiss callback and closes keyboard |
| **Method** | vi.fn() mock for onDismiss; find CANCEL button; dispatch pointerup; check mock and state |
| **Pass** | onDismiss called; isKeyboardVisible() === false |

### keyboard — CANCEL and dismiss > Escape key triggers onDismiss and hides the keyboard
| | |
|---|---|
| **Tests** | Escape key press on input triggers onDismiss callback and closes keyboard |
| **Method** | vi.fn() mock for onDismiss; dispatch KeyboardEvent with key 'Escape' on input; check both |
| **Pass** | onDismiss called; isKeyboardVisible() === false |

### keyboard — CANCEL and dismiss > backdrop tap (pointerup directly on root) triggers onDismiss
| | |
|---|---|
| **Tests** | Pointerup event on root modal element (not bubbled from child) triggers onDismiss |
| **Method** | vi.fn() mock for onDismiss; create pointerup event with target=root, non-bubbling; dispatch; check |
| **Pass** | onDismiss called; isKeyboardVisible() === false |

---

## `modifier-label.test.js`
> Tests for formatModifierLabel function to prevent literal "null" in kitchen tickets

### terminal/modifier-label > null prefix → bare label (no literal "null" in the output)
| | |
|---|---|
| **Tests** | Null, undefined, or empty prefix returns bare label without prefix text |
| **Method** | Call formatModifierLabel(prefix, 'Pepperoni') with null/undefined/'' prefixes; assert output |
| **Pass** | All three return 'Pepperoni' (no prefix included) |

### terminal/modifier-label > populated prefix → "<prefix> <label>"
| | |
|---|---|
| **Tests** | Non-null prefixes are formatted as space-separated prefix and label strings |
| **Method** | Call formatModifierLabel with various prefix strings ('ADD', 'NO', 'EXTRA', etc.) and labels |
| **Pass** | Returns 'ADD Pepperoni', 'NO Onions', 'EXTRA Cheese', 'SUB Chicken', 'LITE Sauce' |

### terminal/modifier-label > handles a null/undefined label defensively (never emits the string "null")
| | |
|---|---|
| **Tests** | Null or undefined label values do not produce literal "null" string in output |
| **Method** | Call formatModifierLabel(prefix, null) and formatModifierLabel(prefix, undefined); assert strings |
| **Pass** | formatModifierLabel('ADD', null) === 'ADD ' (space but no "null"); formatModifierLabel(null, null) === '' |

---

## `net.test.js`
> Tests for fetchWithTimeout function with AbortSignal timeout handling

### terminal/net fetchWithTimeout > passes url/opts through to fetch and resolves with the response
| | |
|---|---|
| **Tests** | URL and options are passed to fetch; response is resolved; AbortSignal is injected if missing |
| **Method** | vi.fn() mock for window.fetch returning Promise.resolve(Response); call fetchWithTimeout; inspect mock.calls |
| **Pass** | fetch called once with correct URL and method; init.signal is AbortSignal instance; response.status === 200 |

### terminal/net fetchWithTimeout > aborts the fetch when the timeout elapses (reject path)
| | |
|---|---|
| **Tests** | Timeout delay triggers AbortController.abort(), causing fetch to reject with AbortError |
| **Method** | vi.useFakeTimers(); mock fetch that listens for signal.abort; vi.advanceTimersByTime(15000); await rejection |
| **Pass** | capturedSignal.aborted === true; rejection error matches /abort/i |

### terminal/net fetchWithTimeout > defaults to 15s when no timeout is passed (does not fire before then)
| | |
|---|---|
| **Tests** | Default timeout is 15 seconds; does not abort before then; aborts after 15s |
| **Method** | vi.useFakeTimers(); call fetchWithTimeout without timeout arg; advance timers; check aborted flag |
| **Pass** | At 14999ms: aborted === false; at 15001ms: aborted === true |

### terminal/net fetchWithTimeout > caller-supplied signal is honored (fetchWithTimeout does not clobber it)
| | |
|---|---|
| **Tests** | Caller-provided AbortSignal is used unchanged instead of creating a new one |
| **Method** | Create AbortController; call fetchWithTimeout with signal in opts; check that fetch receives same signal |
| **Pass** | seenSignal === callerController.signal (object identity) |

---

## `numpad.test.js`
> Tests for buildNumpad public API with digit input, display rendering, and callbacks

### buildNumpad — public API > getPin() starts empty
| | |
|---|---|
| **Tests** | Initial PIN state is empty string before any digit is pressed |
| **Method** | Call buildNumpad({}); call getPin(); assert return value |
| **Pass** | getPin() === '' |

### buildNumpad — public API > pressing a digit appends to the pin
| | |
|---|---|
| **Tests** | Tapping a digit key appends that digit to the internal PIN |
| **Method** | Call buildNumpad({ masked: false }); tap key '5'; call getPin(); assert |
| **Pass** | getPin() === '5' |

### buildNumpad — public API > pressing multiple digits builds the pin in order
| | |
|---|---|
| **Tests** | Multiple digit taps accumulate in order in the PIN |
| **Method** | Call buildNumpad({ masked: false }); tap 1, 2, 3 in sequence; assert getPin() |
| **Pass** | getPin() === '123' |

### buildNumpad — public API > maxDigits caps input at the configured limit
| | |
|---|---|
| **Tests** | Tapping beyond maxDigits limit does not append further digits |
| **Method** | Call buildNumpad({ maxDigits: 3 }); tap 1, 2, 3, 4, 5; assert getPin() |
| **Pass** | getPin() === '123' (4 and 5 ignored) |

### buildNumpad — public API > setPin() sets the internal pin and re-renders
| | |
|---|---|
| **Tests** | setPin method accepts a string and updates internal state and display |
| **Method** | Call buildNumpad({ masked: false }); call setPin('4321'); call getPin(); assert |
| **Pass** | getPin() === '4321' |

### buildNumpad — public API > clear() empties the pin
| | |
|---|---|
| **Tests** | clear method resets PIN to empty string |
| **Method** | Call buildNumpad; tap digits 1, 2, 3; call clear(); call getPin() |
| **Pass** | getPin() === '' |

### buildNumpad — display rendering > masked display shows diamond chars for each digit
| | |
|---|---|
| **Tests** | With masked: true, display renders diamond character (◆) for each digit with spacing |
| **Method** | Call buildNumpad({ masked: true }); tap 1, 2, 3; query display div; check textContent |
| **Pass** | display.textContent === '◆ ◆ ◆' |

### buildNumpad — display rendering > unmasked display shows the raw digits
| | |
|---|---|
| **Tests** | With masked: false, display renders actual digit characters |
| **Method** | Call buildNumpad({ masked: false }); tap 4, 2; query display; check textContent |
| **Pass** | display.textContent === '42' |

### buildNumpad — display rendering > displayFormat callback overrides default rendering
| | |
|---|---|
| **Tests** | Custom displayFormat function is applied to transform PIN display text |
| **Method** | Call buildNumpad({ displayFormat: (pin) => pin.replace(/./g, '*') }); tap 1, 2, 3; check display |
| **Pass** | display.textContent === '***' |

### buildNumpad — display rendering > custom maskChar replaces the default diamond
| | |
|---|---|
| **Tests** | maskChar option changes the character used in masked display |
| **Method** | Call buildNumpad({ masked: true, maskChar: '#' }); tap 1, 2; check display |
| **Pass** | display.textContent === '# #' |

### buildNumpad — submit behaviour > onSubmit fires with the current pin
| | |
|---|---|
| **Tests** | onSubmit callback is invoked with current PIN when submit key (>>>) is tapped |
| **Method** | vi.fn() mock for onSubmit; call buildNumpad({ onSubmit }); tap digits 7, 8, 9; tap >>> button; check |
| **Pass** | onSubmit called once with '789' |

### buildNumpad — submit behaviour > onSubmit is blocked when canSubmit returns false
| | |
|---|---|
| **Tests** | canSubmit callback returning false prevents onSubmit from firing |
| **Method** | vi.fn() mock for both; call buildNumpad({ onSubmit, canSubmit: () => false }); tap digit and submit |
| **Pass** | onSubmit not called |

### buildNumpad — submit behaviour > submit is blocked when pin is empty (default canSubmit)
| | |
|---|---|
| **Tests** | Default canSubmit behavior blocks submission when PIN is empty |
| **Method** | vi.fn() mock for onSubmit; call buildNumpad({ onSubmit }); tap submit without any digits |
| **Pass** | onSubmit not called |

### buildNumpad — submit behaviour > custom submitLabel appears on the submit key
| | |
|---|---|
| **Tests** | submitLabel option text appears on the submit button instead of >>> |
| **Method** | Call buildNumpad({ submitLabel: 'GO' }); find key with text 'GO' |
| **Pass** | findKey(pad, 'GO') !== null |

### buildNumpad — clear key behaviour > short press removes the last digit
| | |
|---|---|
| **Tests** | Short press (pointerdown + pointerup) on clear button removes last digit from PIN |
| **Method** | Call buildNumpad; tap digits 1, 2, 3; tap 'clr' key; check getPin() |
| **Pass** | getPin() === '12' |

### buildNumpad — clear key behaviour > short press on empty pin does nothing
| | |
|---|---|
| **Tests** | Clear button tap on empty PIN leaves it empty (no error, no effect) |
| **Method** | Call buildNumpad; tap 'clr' without tapping any digits; check getPin() |
| **Pass** | getPin() === '' |

### buildNumpad — clear key behaviour > long press (500ms) clears the entire pin
| | |
|---|---|
| **Tests** | Holding clear button for 500ms clears the entire PIN at once |
| **Method** | vi.useFakeTimers(); call buildNumpad; tap digits 1, 2, 3, 4; pointerdown on 'clr', advance 500ms, pointerup |
| **Pass** | getPin() === '' |

### buildNumpad — onChange callback > onChange fires on every digit press with updated pin
| | |
|---|---|
| **Tests** | onChange callback fires after each digit tap with the updated PIN string |
| **Method** | vi.fn() mock for onChange; call buildNumpad({ onChange }); tap 1, 2; check nthCalledWith |
| **Pass** | onChange called with '1' on first tap, '12' on second tap |

### buildNumpad — onChange callback > onChange fires on clear with the remaining pin
| | |
|---|---|
| **Tests** | onChange callback fires after clear button tap with remaining PIN |
| **Method** | vi.fn() mock for onChange; call buildNumpad({ onChange }); tap 5, 6; clear mock; tap 'clr'; check |
| **Pass** | onChange called with '5' (remaining digit after backspace) |

### buildNumpad — setError and setHint > setError shows a message and resets after 1200ms
| | |
|---|---|
| **Tests** | setError displays error message in place of PIN; clears PIN and reverts display after 1200ms |
| **Method** | vi.useFakeTimers(); call buildNumpad; tap digits; call setError('Wrong PIN'); check display; advance 1200ms; check |
| **Pass** | display shows 'Wrong PIN'; after timeout getPin() === '' and display reverts |

### buildNumpad — setError and setHint > setHint shows hint text; next digit press clears it
| | |
|---|---|
| **Tests** | setHint displays hint message; tapping a digit clears hint and shows the digit |
| **Method** | Call buildNumpad({ masked: false }); call setHint('Enter code'); check display; tap '9'; check |
| **Pass** | display shows 'Enter code'; after digit tap display shows '9' |

### buildNumpad — setError and setHint > onCancel button fires the callback when provided
| | |
|---|---|
| **Tests** | Cancel button (X) taps trigger onCancel callback when provided |
| **Method** | vi.fn() mock for onCancel; call buildNumpad({ onCancel }); find X button; dispatch pointerup; check |
| **Pass** | onCancel called once |

---

## `order-summary.test.js`
> Tests for OrderSummary public API including show/hide, item rendering, and callbacks

### OrderSummary — show / hide > show() calls SceneManager.showSummary()
| | |
|---|---|
| **Tests** | OrderSummary.show() delegates visibility to SceneManager.showSummary() |
| **Method** | Mock SceneManager.showSummary via vi.mock; call OrderSummary.show({ items: [], ... }); check mock |
| **Pass** | SceneManager.showSummary called once |

### OrderSummary — show / hide > hide() calls SceneManager.hideSummary()
| | |
|---|---|
| **Tests** | OrderSummary.hide() delegates visibility to SceneManager.hideSummary() |
| **Method** | Mock SceneManager.hideSummary; call OrderSummary.hide(); check mock |
| **Pass** | SceneManager.hideSummary called once |

### OrderSummary — show / hide > show() makes the wrap element visible
| | |
|---|---|
| **Tests** | OrderSummary wrap element display style is set to 'flex' when show() is called |
| **Method** | Call OrderSummary.show({ items: [] }); query #order-summary > div; check style.display |
| **Pass** | wrap.style.display === 'flex' |

### OrderSummary — show / hide > show() resets itemRenderLocked so items render again
| | |
|---|---|
| **Tests** | show() clears render lock so items are re-rendered even after lockItemRender was called |
| **Method** | Call show with item; call lockItemRender; call show with different item; check item count |
| **Pass** | Second show re-renders items (count === 1 with new item) |

### OrderSummary — render lock > lockItemRender() prevents update() from re-rendering items
| | |
|---|---|
| **Tests** | lockItemRender() prevents OrderSummary.update() from re-rendering the item list |
| **Method** | Call show; call lockItemRender; call update with more items; check item element count unchanged |
| **Pass** | itemScroll.children.length === countBefore |

### OrderSummary — render lock > unlockItemRender() allows update() to re-render items
| | |
|---|---|
| **Tests** | unlockItemRender() re-enables item re-rendering in update() |
| **Method** | Call show; call lockItemRender; call unlockItemRender; call update with new items; check count |
| **Pass** | itemScroll.children.length === 2 (new items rendered) |

### OrderSummary — updateSplit > shows paid and remaining rows after updateSplit()
| | |
|---|---|
| **Tests** | updateSplit() makes "Paid" and "Remaining" rows visible (display !== 'none') |
| **Method** | Call show; check rows hidden initially; call updateSplit({ totalPaid, remaining }); check visible |
| **Pass** | paidRow.style.display === 'flex' and remainRow.style.display === 'flex' |

### OrderSummary — updateSplit > sets the correct dollar values on paid and remaining rows
| | |
|---|---|
| **Tests** | updateSplit() populates "Paid" and "Remaining" rows with formatted dollar amounts |
| **Method** | Call show; call updateSplit({ totalPaid: 25.5, remaining: 74.5 }); query row values; assert |
| **Pass** | paidRow value === '$25.50'; remainRow value === '$74.50' |

### OrderSummary — seat header tap > onSeatHeaderTap fires with seatIdx when a seat header is tapped
| | |
|---|---|
| **Tests** | Tapping a seat header row invokes onSeatHeaderTap callback with the seatIdx argument |
| **Method** | vi.fn() mock for onSeatHeaderTap; call show with collapsible: true and seat header item; tap header; check |
| **Pass** | onSeatHeaderTap called once with seatIdx 2 |

### OrderSummary — item tap > onItemTap fires with the item index when a collapsible item is tapped
| | |
|---|---|
| **Tests** | Tapping a collapsible item row invokes onItemTap with the item's forEach index |
| **Method** | vi.fn() mock for onItemTap; call show with collapsible: true and items; tap second item; check |
| **Pass** | onItemTap called once with index 1 |

### OrderSummary — item tap > non-collapsible items do not fire onItemTap
| | |
|---|---|
| **Tests** | When collapsible: false, tapping items does not invoke onItemTap |
| **Method** | vi.fn() mock for onItemTap; call show with collapsible: false; tap item; check |
| **Pass** | onItemTap not called |

### OrderSummary — back button > onBack fires when the back button is tapped
| | |
|---|---|
| **Tests** | Tapping the back button (‹ symbol) invokes onBack callback |
| **Method** | vi.fn() mock for onBack; call show with showBack: true and onBack; find and tap ‹ button; check |
| **Pass** | onBack called once |

### OrderSummary — update() > update({ items }) re-renders the item list when not locked
| | |
|---|---|
| **Tests** | OrderSummary.update() re-renders items when render lock is not active |
| **Method** | Call show; call update with more items; check item element count increases |
| **Pass** | itemScroll.children.length === 2 |

### OrderSummary — update() > update({ skipItems: true }) does not re-render items
| | |
|---|---|
| **Tests** | update() with skipItems: true skips item list re-rendering even with new items |
| **Method** | Call show; call update({ skipItems: true, items: [...] }); check item count unchanged |
| **Pass** | itemScroll.children.length === countBefore |

---

## `pricing.test.js`
> Tests for pricing module with TAX_RATE and CASH_DISCOUNT as single source of truth

### terminal/pricing > defaults: 7% tax and 4% cash discount before /config/pricing resolves
| | |
|---|---|
| **Tests** | Default tax rate is 7% and cash discount is 4% before server response arrives |
| **Method** | Mock fetch to never resolve; import pricing module; check getTaxRate, getCashDiscount, getRates |
| **Pass** | getTaxRate() === 0.07; getCashDiscount() === 0.04; getRates() === { taxRate: 0.07, cashDiscount: 0.04 } |

### terminal/pricing > ratesReady() resolves once /config/pricing responds; rates update from server
| | |
|---|---|
| **Tests** | ratesReady() promise resolves after /config/pricing response; rates update to server values |
| **Method** | Mock fetch with jsonResponse { tax_rate: 0.0875, cash_discount_rate: 0.03 }; await ratesReady(); check getters |
| **Pass** | getTaxRate() === 0.0875; getCashDiscount() === 0.03; fetch called exactly once on repeated ratesReady |

### terminal/pricing > load failure keeps defaults (no NaN, no undefined leaking into totals)
| | |
|---|---|
| **Tests** | Fetch rejection preserves defaults (does not set NaN or undefined) |
| **Method** | Mock fetch to reject with TypeError; import module; await ratesReady; check values |
| **Pass** | getTaxRate() === 0.07 (unchanged); getCashDiscount() === 0.04 (unchanged) |

### terminal/pricing > null fields in the response leave the existing rates untouched (partial payload)
| | |
|---|---|
| **Tests** | Null fields in server response do not overwrite existing rates (partial updates safe) |
| **Method** | Mock fetch with { tax_rate: null, cash_discount_rate: 0.05 }; await ratesReady; check both |
| **Pass** | getTaxRate() === 0.07 (unchanged); getCashDiscount() === 0.05 (updated) |

### terminal/pricing > computeTotals at defaults: $100 subtotal → $7 tax, $107 card, $102.72 cash
| | |
|---|---|
| **Tests** | computeTotals calculates correct totals with default 7% tax and 4% cash discount |
| **Method** | Mock fetch to never resolve (use defaults); call computeTotals(100); assert all fields |
| **Pass** | subtotal: 100; tax: 7; cardTotal: 107; cashPrice: 102.72 |

### terminal/pricing > computeTotals rounds every field to cents (no FP drift)
| | |
|---|---|
| **Tests** | All total fields are rounded to 2 decimal places (cents); no floating-point leakage |
| **Method** | Call computeTotals(19.99); inspect all returned fields for decimal places |
| **Pass** | subtotal: 19.99; tax: 1.40; cardTotal: 21.39; cashPrice: 20.53 (all ≤ 2dp) |

### terminal/pricing > computeTotals handles 0 subtotal without NaN
| | |
|---|---|
| **Tests** | computeTotals(0) returns valid totals (0) not NaN or undefined |
| **Method** | Call computeTotals(0); check return object values |
| **Pass** | Returns { subtotal: 0, tax: 0, cardTotal: 0, cashPrice: 0 } |

### terminal/pricing > totalsForOrder uses the backend-computed order.total + order.balance_due when present
| | |
|---|---|
| **Tests** | totalsForOrder trusts backend-computed order.total and balance_due fields when available |
| **Method** | Call totalsForOrder({ total: 107, subtotal: 100, balance_due: 50 }, 0); check all fields |
| **Pass** | cardTotal: 107; subtotal: 100; tax: 7; balanceDue: 50; cashPrice: 102.72 |

### terminal/pricing > totalsForOrder derives subtotal from total/tax when only total is present
| | |
|---|---|
| **Tests** | totalsForOrder computes missing subtotal as (total / (1 + tax_rate)) when only total provided |
| **Method** | Call totalsForOrder({ total: 107 }, 0); check derived subtotal and tax |
| **Pass** | subtotal: 100; tax: 7; balanceDue: 107 (falls back to cardTotal) |

### terminal/pricing > totalsForOrder falls back to computeTotals(fallbackSubtotal) when order is missing
| | |
|---|---|
| **Tests** | totalsForOrder(null|undefined|{}, fallbackSubtotal) delegates to computeTotals(fallbackSubtotal) |
| **Method** | Call totalsForOrder with null, undefined, {} and fallbackSubtotal 100; compare to computeTotals(100) |
| **Pass** | All three return same result as computeTotals(100) |

---

## `scene-manager.test.js`
> Tests for scene-manager interrupt/gate stacking, callback wrapping, layer teardown, and error handling

### terminal/scene-manager > interrupt with object-embedded onConfirm → user callback fires with forwarded args
| | |
|---|---|
| **Tests** | SceneManager.interrupt wraps user onConfirm and forwards arguments when sub-scene calls wrapped version |
| **Method** | Create scene with mount handler; call SceneManager.interrupt with onConfirm: vi.fn(); trigger wrapped callback; check |
| **Pass** | User onConfirm called once with same args passed to wrapped callback |

### terminal/scene-manager > interrupt with positional callbacks → user callback fires with forwarded args
| | |
|---|---|
| **Tests** | SceneManager.interrupt supports positional (confirm, cancel) callbacks in addition to object form |
| **Method** | Call interrupt(name, opts, userConfirm, userCancel); trigger wrapped onConfirm; check |
| **Pass** | userConfirm called with forwarded args |

### terminal/scene-manager > interrupt onCancel wrapping forwards args the same way
| | |
|---|---|
| **Tests** | onCancel callback receives same argument forwarding as onConfirm |
| **Method** | Call interrupt with onCancel: vi.fn(); trigger wrapped onCancel with arg; check |
| **Pass** | userCancel called with forwarded args |

### terminal/scene-manager > hasScene returns false for unregistered names and true after register
| | |
|---|---|
| **Tests** | hasScene() probe returns false for unregistered scene names, true after registration |
| **Method** | Call hasScene('nope'); register scene; call hasScene again with registered and unregistered names |
| **Pass** | First call false; after register true for registered, false for unregistered |

### terminal/scene-manager > closeInterrupt is an exported alias that resolves the current interrupt (same as resolveInterrupt)
| | |
|---|---|
| **Tests** | closeInterrupt is an alias for resolveInterrupt; both unmount and run cleanup |
| **Method** | Register scene; open interrupt; call closeInterrupt; check hasInterrupt, unmountCalls, cleanupCalls |
| **Pass** | hasInterrupt() === false; unmountCalls === 1; cleanupCalls === 1 |

### terminal/scene-manager > opening an interrupt while one is open tears down the first and emits UI-001
| | |
|---|---|
| **Tests** | Stacking two interrupts automatically tears down the first and emits UI-001 error code |
| **Method** | Register sceneA, sceneB; call interrupt twice; check unmountCalls on A, mountCalls on B; check entReport |
| **Pass** | sceneA unmountCalls === 1; sceneB mountCalls === 1; entReport includes UI-001 code |

### terminal/scene-manager > opening a gate while one is open tears down the first and emits UI-001
| | |
|---|---|
| **Tests** | Stacking two gates automatically tears down the first and emits UI-001 |
| **Method** | Register sceneA, sceneB; call openGate twice; check unmountCalls on A; check entReport |
| **Pass** | sceneA unmountCalls === 1; entReport includes UI-001 code |

### terminal/scene-manager > onBeforeTransition(fn) returns a disposer that removes the hook
| | |
|---|---|
| **Tests** | onBeforeTransition returns a disposer function that removes the hook from future transitions |
| **Method** | Call onBeforeTransition(hook); register scene; mountWorking; dispose(); mountWorking again; check calls |
| **Pass** | hook called once (before dispose); still 1 call after dispose (hook removed) |

### terminal/scene-manager > mounting a new working scene tears down any open interrupt first
| | |
|---|---|
| **Tests** | mountWorking automatically resolves any open interrupt before tearing down old working scene |
| **Method** | Mount work1; open interrupt; call mountWorking(work2); check hasInterrupt, getActiveWorking, unmountCalls |
| **Pass** | hasInterrupt() === false; getActiveWorking() === 'work2'; w1.unmountCalls === 1 |

### terminal/scene-manager > mounting a new working scene closes all transactionals (no orphan timers)
| | |
|---|---|
| **Tests** | mountWorking closes all open transactional scenes before switching working scenes |
| **Method** | Mount work1; open two transactionals; call mountWorking(work2); check transactionalStack and unmountCalls |
| **Pass** | getTransactionalStack() === []; t1.unmountCalls === 1; t2.unmountCalls === 1 |

### terminal/scene-manager > _emit catches a throwing handler, emits UI-002, and other handlers still fire
| | |
|---|---|
| **Tests** | _emit error-swallow path catches handler exceptions, emits UI-002, continues to other handlers |
| **Method** | Register two handlers (one throws); call emit; check both called; check entReport includes UI-002 |
| **Pass** | handlerA and handlerB both called; entReport includes UI-002 with source 'scene-manager._emit' |


---
## `theme-manager.test.js`
> Tests for button, numpad, and pin-entry UI components: buildPillButton, buildNumpadChassis, buildPinRow, buildPinBox

### `buildPillButton — element creation > returns a <button> element`
| | |
|---|---|
| **Tests** | Button element is created with correct tagName |
| **Method** | Direct property check of created element |
| **Pass** | `btn.tagName === 'BUTTON'` |

### `buildPillButton — element creation > sets textContent from label option`
| | |
|---|---|
| **Tests** | Label option is rendered as button text content |
| **Method** | Direct property assertion on button element |
| **Pass** | `btn.textContent === 'SAVE'` |

### `buildPillButton — element creation > default variant uses T.green as background`
| | |
|---|---|
| **Tests** | Default (no variant specified) applies green color background |
| **Method** | jsdom style property check with hex-to-rgb conversion helper |
| **Pass** | `btn.style.background === rgb('#86efac')` |

### `buildPillButton — variant mapping > verm variant sets T.verm background`
| | |
|---|---|
| **Tests** | 'verm' variant applies vermillion color |
| **Method** | Style property check on button with variant option |
| **Pass** | `btn.style.background === rgb('#e8472a')` |

### `buildPillButton — variant mapping > elec variant sets T.elec background`
| | |
|---|---|
| **Tests** | 'elec' variant applies electric blue color |
| **Method** | Style property check on button with variant option |
| **Pass** | `btn.style.background === rgb('#00e5ff')` |

### `buildPillButton — variant mapping > goGreen variant sets T.greenWarm background`
| | |
|---|---|
| **Tests** | 'goGreen' variant applies warm green color |
| **Method** | Style property check on button with variant option |
| **Pass** | `btn.style.background === rgb('#86efac')` |

### `buildPillButton — variant mapping > ghost variant sets transparent background`
| | |
|---|---|
| **Tests** | 'ghost' variant produces transparent background |
| **Method** | Style property check on button with variant option |
| **Pass** | `btn.style.background === 'transparent'` |

### `buildPillButton — setDisabled > setDisabled(true) sets opacity to 0.4`
| | |
|---|---|
| **Tests** | Disabling button reduces opacity to indicate inactive state |
| **Method** | Call setDisabled method and check style property |
| **Pass** | `btn.style.opacity === '0.4'` |

### `buildPillButton — setDisabled > setDisabled(true) sets pointerEvents to none`
| | |
|---|---|
| **Tests** | Disabling button blocks pointer events |
| **Method** | Call setDisabled method and check style property |
| **Pass** | `btn.style.pointerEvents === 'none'` |

### `buildPillButton — setDisabled > setDisabled(false) restores opacity to 1`
| | |
|---|---|
| **Tests** | Re-enabling button restores full opacity |
| **Method** | Call setDisabled twice and check final opacity |
| **Pass** | `btn.style.opacity === '1'` |

### `buildPillButton — setDisabled > setDisabled(false) restores pointerEvents to auto`
| | |
|---|---|
| **Tests** | Re-enabling button allows pointer events again |
| **Method** | Call setDisabled twice and check final style |
| **Pass** | `btn.style.pointerEvents === 'auto'` |

### `buildPillButton — setDisabled > disabled:true option applies disabled state at construction`
| | |
|---|---|
| **Tests** | Disabled option in constructor applies disabled state immediately |
| **Method** | Check internal _disabled flag and opacity style |
| **Pass** | `btn._disabled === true && btn.style.opacity === '0.4'` |

### `buildPillButton — onClick and disabled guard > onClick fires on pointerup`
| | |
|---|---|
| **Tests** | Click handler is triggered on pointer release |
| **Method** | Mock onClick callback, simulate tap event with pointerup |
| **Pass** | `onClick.toHaveBeenCalledOnce()` |

### `buildPillButton — onClick and disabled guard > onClick is blocked when button is disabled`
| | |
|---|---|
| **Tests** | Disabled button prevents click handler execution |
| **Method** | Mock onClick, disable button, simulate tap, check handler not called |
| **Pass** | `onClick.not.toHaveBeenCalled()` |

### `buildPillButton — setColor > setColor updates background and box-shadow`
| | |
|---|---|
| **Tests** | setColor method applies custom background color |
| **Method** | Call setColor with three hex values, check style |
| **Pass** | `btn.style.background === rgb('#ff0000')` |

### `buildNumpadChassis > returns a div containing 12 buttons (4 rows × 3 keys)`
| | |
|---|---|
| **Tests** | Numpad layout has exactly 12 button elements (4 rows, 3 columns) |
| **Method** | QuerySelector count of button children |
| **Pass** | `chassis.querySelectorAll('button').length === 12` |

### `buildNumpadChassis > onKey is called with the correct label on pointerup`
| | |
|---|---|
| **Tests** | Key press handler receives the correct button label |
| **Method** | Mock onKey callback, find '5' button, trigger pointerup event |
| **Pass** | `onKey.toHaveBeenCalledWith('5')` |

### `buildNumpadChassis > CLR and ENT keys are present`
| | |
|---|---|
| **Tests** | Special function buttons (CLR, ENT) exist in the numpad |
| **Method** | Get all button text content and check inclusion |
| **Pass** | Labels include both 'CLR' and 'ENT' |

### `buildNumpadChassis > digits 0-9 are all present`
| | |
|---|---|
| **Tests** | All numeric digits 0 through 9 are available as buttons |
| **Method** | Extract all button labels, loop 0-9, check each is present |
| **Pass** | All digits 0-9 found in labels array |

### `buildPinBox > returns { box, pip } — box is a div, pip is hidden by default`
| | |
|---|---|
| **Tests** | Pin box structure with hidden pip indicator by default |
| **Method** | Check tagName and display style property |
| **Pass** | `box.tagName === 'DIV' && pip.style.display === 'none'` |

### `buildPinBox > setFilled(true) shows the pip`
| | |
|---|---|
| **Tests** | Filling the pin box reveals the pip indicator |
| **Method** | Call box.setFilled(true) and check pip display |
| **Pass** | `pip.style.display === 'block'` |

### `buildPinBox > setFilled(false) hides the pip`
| | |
|---|---|
| **Tests** | Unfilling the pin box hides the pip indicator |
| **Method** | Call setFilled true then false, check display |
| **Pass** | `pip.style.display === 'none'` |

### `buildPinRow > setCount(0) leaves all 4 boxes unfilled`
| | |
|---|---|
| **Tests** | Zero count leaves all pin indicators hidden |
| **Method** | Call setCount(0), iterate boxes checking pip display |
| **Pass** | All `boxes[i].pip.style.display === 'none'` |

### `buildPinRow > setCount(2) fills the first 2 boxes and leaves the rest empty`
| | |
|---|---|
| **Tests** | Partial fill only affects specified number of boxes |
| **Method** | Call setCount(2), check first two pips show and last two hide |
| **Pass** | First two pips display 'block', last two 'none' |

### `buildPinRow > setCount(4) fills all 4 boxes`
| | |
|---|---|
| **Tests** | Full fill shows all four pin indicators |
| **Method** | Call setCount(4), iterate all boxes checking display |
| **Pass** | All `boxes[i].pip.style.display === 'block'` |

---

## `check-overview.test.js`
> Integration tests for check management: discount flow, seat persistence, item void handling, customer names, refresh state, print/resend guards, seat payments, pay navigation guards, and item management

### `terminal/scenes/check-overview — discount flow > DISC with nothing selected fires UI-007, shows toast, and opens no interrupt`
| | |
|---|---|
| **Tests** | Discount with no items selected triggers error code UI-007, shows user-facing toast, does not open discount flow |
| **Method** | Render with empty selectedItems, call handleDiscount, check interrupt not called, entReport called with UI-007 |
| **Pass** | `SceneManagerMock.interrupt.not.toHaveBeenCalled() && showToast called && entReport called with code UI-007` |

### `terminal/scenes/check-overview — discount flow > DISC with selected items opens disc-pin interrupt`
| | |
|---|---|
| **Tests** | Discount with items selected opens PIN entry interrupt |
| **Method** | Render with selectedItems set, call handleDiscount, verify interrupt called |
| **Pass** | `SceneManagerMock.interrupt.toHaveBeenCalledWith('disc-pin', {...})` |

### `terminal/scenes/check-overview — discount flow > disc-pin onConfirm triggers disc-select interrupt`
| | |
|---|---|
| **Tests** | Manager PIN confirmation proceeds to discount percentage selection |
| **Method** | Call handleDiscount, capture disc-pin interrupt, call onConfirm callback |
| **Pass** | disc-select interrupt found in calls with onConfirm function |

### `terminal/scenes/check-overview — discount flow > disc-select onConfirm calls fetchWithTimeout on the discount endpoint`
| | |
|---|---|
| **Tests** | Discount selection submits to server via POST to /orders/orderId/discount |
| **Method** | Full interrupt chain: handleDiscount → disc-pin confirm → disc-select confirm, check fetch |
| **Pass** | `fetchWithTimeout.toHaveBeenCalledWith(/discount/, {...method:'POST'}, ...)` |

### `terminal/scenes/check-overview — discount flow > disc-pin cancel does not open disc-select`
| | |
|---|---|
| **Tests** | Cancelling PIN entry stops discount flow early |
| **Method** | Call handleDiscount, find disc-pin interrupt, call onCancel |
| **Pass** | disc-select interrupt not found; discount endpoint not called |

### `terminal/scenes/check-overview — persistSeats > does NOT call fetch when orderId is null — empty check leaves no ledger event`
| | |
|---|---|
| **Tests** | Brand-new check (no orderId) does not persist to server |
| **Method** | Call _persistSeats with orderId null |
| **Pass** | `fetchWithTimeout.not.toHaveBeenCalled()` |

### `terminal/scenes/check-overview — persistSeats > PUTs seat layout when orderId is set`
| | |
|---|---|
| **Tests** | Established check persists seat numbers via PUT |
| **Method** | Call _persistSeats with orderId and seat data |
| **Pass** | `fetchWithTimeout.toHaveBeenCalledWith(/seats, {method:'PUT', body:...seat_numbers...})` |

### `terminal/scenes/check-overview — persistSeats > addSeat on a brand-new check does not trigger any fetch`
| | |
|---|---|
| **Tests** | Adding seat to new check updates local state without server call |
| **Method** | Call _addSeat with orderId null |
| **Pass** | `state.seats.length === 2 && fetchWithTimeout.not.toHaveBeenCalled()` |

### `terminal/scenes/check-overview — Bug 1: void-item timer cancelled on unmount > DELETE does not fire after scene unmounts before 4.2 s elapses`
| | |
|---|---|
| **Tests** | Void-item DELETE timer is cancelled when scene unmounts before timeout |
| **Method** | Fake timers, call handleVoid, unmount scene, advance 5s, check DELETE not called |
| **Pass** | `fetchWithTimeout.not.toHaveBeenCalledWith(/items/, {method:'DELETE'})` |

### `terminal/scenes/check-overview — Bug 1: void-item timer cancelled on unmount > DELETE fires when scene stays mounted past 4.2 s`
| | |
|---|---|
| **Tests** | Void-item DELETE timer fires if scene remains mounted past 4.2 seconds |
| **Method** | Fake timers, call handleVoid, advance 5s without unmount |
| **Pass** | `fetchWithTimeout.toHaveBeenCalledWith(/items/item-1, {method:'DELETE'})` |

### `terminal/scenes/check-overview — Bug 2: customer-name PATCH error handling > shows error toast when PATCH returns non-2xx`
| | |
|---|---|
| **Tests** | Customer name save failure (422) shows error toast |
| **Method** | Mock fetchWithTimeout returning {ok:false}, call openNameEditor, confirm name, check toast |
| **Pass** | `showToast.toHaveBeenCalledWith(...Could not save...)` |

### `terminal/scenes/check-overview — Bug 2: customer-name PATCH error handling > does not toast on success`
| | |
|---|---|
| **Tests** | Successful name save does not show error message and updates state |
| **Method** | Mock successful response, complete name edit flow |
| **Pass** | `showToast.not.toHaveBeenCalledWith(...Could not save...) && state.customerName === 'Good Name'` |

### `terminal/scenes/check-overview — Bug 3: _refreshInFlight is per-state > state._refreshInFlight starts false and becomes true while fetch is pending`
| | |
|---|---|
| **Tests** | Refresh flag transitions false→true during in-flight fetch |
| **Method** | Mock fetch to hang, call refreshOrder, check flag change |
| **Pass** | `state._refreshInFlight === true` after refreshOrder called |

### `terminal/scenes/check-overview — Bug 3: _refreshInFlight is per-state > two instances have independent _refreshInFlight flags`
| | |
|---|---|
| **Tests** | Multiple check instances maintain separate in-flight state |
| **Method** | Create stateA and stateB, hang A's fetch, complete B's, check flags independent |
| **Pass** | `stateA._refreshInFlight === true && stateB._refreshInFlight === false` |

### `terminal/scenes/check-overview — Bug 4: print/resend double-tap guard > handlePrint double-tap fires only one fetch`
| | |
|---|---|
| **Tests** | Rapid print calls are coalesced to single server request |
| **Method** | Call handlePrint twice, check fetch called once |
| **Pass** | `fetchWithTimeout.toHaveBeenCalledTimes(1)` to /print/receipt |

### `terminal/scenes/check-overview — Bug 4: print/resend double-tap guard > handleResend double-tap fires only one fetch`
| | |
|---|---|
| **Tests** | Rapid resend calls are coalesced to single server request |
| **Method** | Call handleResend twice, check fetch called once |
| **Pass** | `fetchWithTimeout.toHaveBeenCalledTimes(1)` to /resend |

### `terminal/scenes/check-overview — Bug 5: server-picker error message > fetch failure shows distinct error, not the empty-list message`
| | |
|---|---|
| **Tests** | Server picker fetch error shows "Failed" message, not "No servers" |
| **Method** | Mock global fetch rejection, render server-picker, await promise resolution |
| **Pass** | Container text contains 'Failed' but not 'No other servers clocked in' |

### `terminal/scenes/check-overview — selection and refresh regression locks > refreshOrder defers when _seatsChain is pending — does not drop the refresh`
| | |
|---|---|
| **Tests** | Refresh waits for seat persistence chain to complete |
| **Method** | Hang seat chain, call refreshOrder, complete chain, verify refresh fires |
| **Pass** | No fetch initially; fetch fires after chain resolved |

### `terminal/scenes/check-overview — selection and refresh regression locks > toggleSeat on a paid seat is a silent no-op`
| | |
|---|---|
| **Tests** | Clicking paid seat does not change selection |
| **Method** | Set paidSeats, call toggleSeat, check selected remains empty |
| **Pass** | `state.selected['S-001'] === undefined` |

### `terminal/scenes/check-overview — selection and refresh regression locks > forceSelectAll skips paid seats`
| | |
|---|---|
| **Tests** | Select-all operation excludes already-paid seats |
| **Method** | Set two seats, mark one paid, call forceSelectAll |
| **Pass** | `state.selectedItems['0:0'] === true && state.selectedItems['1:0'] === undefined` |

### `terminal/scenes/check-overview — openSeatPaymentInterrupt fetch guard > shows "Void failed" toast when void POST returns ok:false`
| | |
|---|---|
| **Tests** | Payment void failure (422) shows error toast and preserves state |
| **Method** | Mock POST {ok:false}, open seat payment, confirm void, check toast and state |
| **Pass** | `showToast called with 'Void failed' && state.paidSeats['S-001'] === true` |

### `terminal/scenes/check-overview — openSeatPaymentInterrupt fetch guard > shows "Void failed" toast on network rejection`
| | |
|---|---|
| **Tests** | Payment void network error shows error toast |
| **Method** | Mock fetchWithTimeout rejection, complete void flow |
| **Pass** | `showToast.toHaveBeenCalledWith('Void failed', ...)` |

### `terminal/scenes/check-overview — handlePay guards > shows toast and does not navigate when orderId is null`
| | |
|---|---|
| **Tests** | Pay action requires saved check (prevents navigation on new check) |
| **Method** | Call handlePay with orderId null |
| **Pass** | `showToast called with ...Save items first... && mountWorking not called` |

### `terminal/scenes/check-overview — handlePay guards > shows toast and does not navigate when check is already settled`
| | |
|---|---|
| **Tests** | Pay action prevents navigation on closed check |
| **Method** | Call handlePay with order.status === 'closed' |
| **Pass** | `showToast called with ...Check already settled... && mountWorking not called` |

### `terminal/scenes/check-overview — handlePay guards > shows toast and does not navigate when no seats have items`
| | |
|---|---|
| **Tests** | Pay action prevents navigation on empty check |
| **Method** | Call handlePay with all seats having empty items |
| **Pass** | `showToast called with ...No items to pay... && mountWorking not called` |

### `terminal/scenes/check-overview — handlePay guards > shows toast and does not navigate when all selected seats are already paid`
| | |
|---|---|
| **Tests** | Pay action prevents navigation when all selected seats already paid |
| **Method** | Set seat as paid and selected, call handlePay |
| **Pass** | `showToast called with ...already paid... && mountWorking not called` |

### `terminal/scenes/check-overview — _callSplitBySeat > happy path: POSTs to /split-by-seat and toasts child order id`
| | |
|---|---|
| **Tests** | Seat split POSTs successfully and toasts new order ID |
| **Method** | Mock successful response, call _callSplitBySeat |
| **Pass** | `fetchWithTimeout called with /split-by-seat POST && showToast shows new-999` |

### `terminal/scenes/check-overview — _callSplitBySeat > error path: ok:false toasts the detail message`
| | |
|---|---|
| **Tests** | Seat split server error message is shown to user |
| **Method** | Mock POST {ok:false, detail:'check is locked'}, call _callSplitBySeat |
| **Pass** | `showToast.toHaveBeenCalledWith(...check is locked...)` |

### `terminal/scenes/check-overview — _callSplitBySeat > no orderId guard: toasts "Save items first", no fetch`
| | |
|---|---|
| **Tests** | Split action requires saved check |
| **Method** | Call _callSplitBySeat with orderId null |
| **Pass** | `fetchWithTimeout.not.toHaveBeenCalled() && showToast called with ...Save items first...` |

### `terminal/scenes/check-overview — persistSeats / persistItemSeats > persistSeats PUTs seat numbers to /seats`
| | |
|---|---|
| **Tests** | Seat persistence sends seat number array via PUT |
| **Method** | Call _persistSeats on manage state |
| **Pass** | `fetchWithTimeout called with /seats PUT including seat_numbers:[1,2]` |

### `terminal/scenes/check-overview — persistSeats / persistItemSeats > persistSeats does nothing when orderId is null`
| | |
|---|---|
| **Tests** | Seat persistence is skipped for new checks |
| **Method** | Call _persistSeats with orderId null |
| **Pass** | `fetchWithTimeout.not.toHaveBeenCalled()` |

### `terminal/scenes/check-overview — persistSeats / persistItemSeats > persistItemSeats PATCHes each item that has item_id`
| | |
|---|---|
| **Tests** | Item persistence sends individual item updates |
| **Method** | Call _persistItemSeats with two items having item_id |
| **Pass** | `fetchWithTimeout.toHaveBeenCalledTimes(2) with /items/i-1 and /items/i-2` |

### `terminal/scenes/check-overview — persistSeats / persistItemSeats > persistItemSeats skips items without item_id`
| | |
|---|---|
| **Tests** | Draft items (no item_id) are not persisted |
| **Method** | Call _persistItemSeats with items missing item_id |
| **Pass** | `fetchWithTimeout.not.toHaveBeenCalled()` |

### `terminal/scenes/check-overview — persistSeats / persistItemSeats > persistItemSeats resolves even when a PATCH is rejected`
| | |
|---|---|
| **Tests** | Item persistence continues despite individual failures |
| **Method** | Mock PATCH rejection, call _persistItemSeats, expect resolution not rejection |
| **Pass** | Promise resolves with undefined despite network error |

### `terminal/scenes/check-overview — _moveItemsToSeat > moves item from S-001 to S-002: source loses it, target gains it`
| | |
|---|---|
| **Tests** | Item move transfers from source to target seat and clears selection |
| **Method** | Call _moveItemsToSeat with source/target indices |
| **Pass** | `source items length 0, target items length 1, selectedItems empty, selected empty` |

### `terminal/scenes/check-overview — _moveItemsToSeat > skipLog: true suppresses the log entry`
| | |
|---|---|
| **Tests** | Move with skipLog option does not record in manage log |
| **Method** | Call _moveItemsToSeat with skipLog:true, check log length |
| **Pass** | `state._manageLog.length === 0 && seat[1].items.length === 1` |

### `terminal/scenes/check-overview — _moveItemsToSeat > moving item to its own seat toasts "Already on" and returns 0`
| | |
|---|---|
| **Tests** | No-op move to same seat shows toast and returns zero |
| **Method** | Call _moveItemsToSeat to same seat |
| **Pass** | `result === 0 && showToast called with ...Already on... && items unchanged` |

---

## `checkout-core.test.js`
> Tests for checkout-core scene interrupts: co-void-confirm, fmt currency formatting, buildBlockerBanner, co-manager-pin, co-finalize-confirm, and co-adjust-single

### `terminal/scenes/checkout-core — co-void-confirm interrupt > renders the "VOID CHECK" title and a "voiding 1 check" summary for a single check`
| | |
|---|---|
| **Tests** | Single void displays correct title and count |
| **Method** | Mount interrupt with one check, check container text |
| **Pass** | Text contains 'VOID CHECK' and 'voiding 1 check' (singular) |

### `terminal/scenes/checkout-core — co-void-confirm interrupt > renders a "voiding N checks" summary for multiple checks`
| | |
|---|---|
| **Tests** | Multiple voids display correct plural count |
| **Method** | Mount interrupt with three checks, check text |
| **Pass** | Text contains 'voiding 3 checks' (plural) |

### `terminal/scenes/checkout-core — co-void-confirm interrupt > VOID button starts disabled (cursor:not-allowed) until a reason is chosen`
| | |
|---|---|
| **Tests** | VOID button is disabled until reason selected |
| **Method** | Mount interrupt, find VOID button, check cursor style |
| **Pass** | `voidBtn.style.cursor === 'not-allowed'` |

### `terminal/scenes/checkout-core — co-void-confirm interrupt > VOID button becomes enabled once a reason row is tapped`
| | |
|---|---|
| **Tests** | Selecting reason enables VOID button |
| **Method** | Mount, tap reason row, check VOID button cursor |
| **Pass** | `voidBtn.style.cursor === 'pointer'` |

### `terminal/scenes/checkout-core — co-void-confirm interrupt > onConfirm is called with the chosen reason when VOID is tapped`
| | |
|---|---|
| **Tests** | VOID submission passes selected reason to callback |
| **Method** | Mock onConfirm, select reason, tap VOID |
| **Pass** | `onConfirm.toHaveBeenCalledWith('Wrong order')` |

### `terminal/scenes/checkout-core — co-void-confirm interrupt > onConfirm is NOT called when no reason is selected and VOID is tapped`
| | |
|---|---|
| **Tests** | VOID without reason selection does not trigger callback |
| **Method** | Mock onConfirm, tap VOID without selecting reason |
| **Pass** | `onConfirm.not.toHaveBeenCalled()` |

### `terminal/scenes/checkout-core — co-void-confirm interrupt > CANCEL button calls onCancel`
| | |
|---|---|
| **Tests** | CANCEL button invokes cancel callback |
| **Method** | Mock onCancel, find and tap CANCEL button |
| **Pass** | `onCancel.toHaveBeenCalledTimes(1)` |

### `terminal/scenes/checkout-core — fmt > formats zero as $0.00`
| | |
|---|---|
| **Tests** | Zero amount formats as zero dollars |
| **Method** | Direct function call with 0 |
| **Pass** | `_fmt(0) === '$0.00'` |

### `terminal/scenes/checkout-core — fmt > formats a positive amount with two decimal places`
| | |
|---|---|
| **Tests** | Positive amounts show two decimal places |
| **Method** | Direct function call with 45 |
| **Pass** | `_fmt(45) === '$45.00'` |

### `terminal/scenes/checkout-core — fmt > adds a thousands comma for large values`
| | |
|---|---|
| **Tests** | Large amounts include thousands separator |
| **Method** | Direct function call with 1000 |
| **Pass** | `_fmt(1000) === '$1,000.00'` |

### `terminal/scenes/checkout-core — fmt > uses the minus sign (U+2212) for negative values`
| | |
|---|---|
| **Tests** | Negative amounts use Unicode minus, not hyphen |
| **Method** | Direct function call with -5.50 |
| **Pass** | `_fmt(-5.50) === '−$5.50'` (uses U+2212 minus) |

### `terminal/scenes/checkout-core — fmt > treats null/undefined as zero`
| | |
|---|---|
| **Tests** | Null and undefined values format as zero |
| **Method** | Direct function calls with null and undefined |
| **Pass** | `_fmt(null) === '$0.00' && _fmt(undefined) === '$0.00'` |

### `terminal/scenes/checkout-core — buildBlockerBanner > shows ALL CLEAR text when there are no messages`
| | |
|---|---|
| **Tests** | Empty message list shows all-clear state |
| **Method** | Call _buildBlockerBanner with empty array |
| **Pass** | Text contains 'ALL CLEAR' |

### `terminal/scenes/checkout-core — buildBlockerBanner > shows RESOLVE prefix when there are blocking messages`
| | |
|---|---|
| **Tests** | Messages are prefixed with RESOLVE directive |
| **Method** | Call _buildBlockerBanner with message array |
| **Pass** | Text contains 'RESOLVE' and 'Missing tips' |

### `terminal/scenes/checkout-core — buildBlockerBanner > joins multiple messages with " + "`
| | |
|---|---|
| **Tests** | Multiple messages are concatenated with plus separator |
| **Method** | Call _buildBlockerBanner with two messages |
| **Pass** | Text contains 'Missing tips + Unadjusted checks' |

### `terminal/scenes/checkout-core — co-manager-pin interrupt > renders a numpad into the container`
| | |
|---|---|
| **Tests** | PIN entry renders numpad component |
| **Method** | Mount interrupt, check container has children and numpad created |
| **Pass** | `container.children.length > 0 && numpadStore.el !== null` |

### `terminal/scenes/checkout-core — co-manager-pin interrupt > forwards onCancel to the numpad cancel callback`
| | |
|---|---|
| **Tests** | Numpad cancel button triggers interrupt's cancel |
| **Method** | Mock onCancel, call numpad's onCancel option |
| **Pass** | `onCancel.toHaveBeenCalledTimes(1)` |

### `terminal/scenes/checkout-core — co-manager-pin interrupt > calls onConfirm with the response data when the PIN is valid`
| | |
|---|---|
| **Tests** | Valid PIN submits auth response (employee_id, role) to callback |
| **Method** | Mock global fetch returning {valid:true, employee_id, role}, call numpad onSubmit |
| **Pass** | `onConfirm.toHaveBeenCalledWith({valid:true, employee_id:'mgr1', role:'manager'})` |

### `terminal/scenes/checkout-core — co-manager-pin interrupt > calls numpad.setError when the PIN is invalid`
| | |
|---|---|
| **Tests** | Invalid PIN response triggers error display on numpad |
| **Method** | Mock fetch {valid:false}, call numpad onSubmit |
| **Pass** | `numpad.setError.toHaveBeenCalledWith('Invalid PIN')` |

### `terminal/scenes/checkout-core — co-manager-pin interrupt > calls numpad.setError on network failure`
| | |
|---|---|
| **Tests** | Network error shows error message on numpad |
| **Method** | Mock fetch rejection, call numpad onSubmit |
| **Pass** | `numpad.setError.toHaveBeenCalledWith('PIN check failed')` |

### `terminal/scenes/checkout-core — co-finalize-confirm interrupt > displays the take-home amount formatted with fmt`
| | |
|---|---|
| **Tests** | Finalize screen shows takeHome amount formatted as currency |
| **Method** | Mount interrupt with takeHome amount, check text |
| **Pass** | Text contains '$87.50' |

### `terminal/scenes/checkout-core — co-finalize-confirm interrupt > displays the cash-expected amount formatted with fmt`
| | |
|---|---|
| **Tests** | Finalize screen shows cashExpected amount formatted as currency |
| **Method** | Mount interrupt with cashExpected amount, check text |
| **Pass** | Text contains '$32.00' |

### `terminal/scenes/checkout-core — co-finalize-confirm interrupt > CONFIRM button calls onConfirm`
| | |
|---|---|
| **Tests** | CONFIRM button triggers confirm callback |
| **Method** | Mock onConfirm, find CONFIRM button, trigger pointerup |
| **Pass** | `onConfirm.toHaveBeenCalledTimes(1)` |

### `terminal/scenes/checkout-core — co-finalize-confirm interrupt > CANCEL button calls onCancel`
| | |
|---|---|
| **Tests** | CANCEL button triggers cancel callback |
| **Method** | Mock onCancel, find CANCEL button, trigger pointerup |
| **Pass** | `onCancel.toHaveBeenCalledTimes(1)` |

### `terminal/scenes/checkout-core — co-adjust-single transactional > shows "ADJUST TIP" title in default mode`
| | |
|---|---|
| **Tests** | Default tip adjustment shows ADJUST TIP title |
| **Method** | Mount with default mode, check text |
| **Pass** | Text contains 'ADJUST TIP' |

### `terminal/scenes/checkout-core — co-adjust-single transactional > shows "EDIT TIP" title in edit mode`
| | |
|---|---|
| **Tests** | Edit mode shows EDIT TIP title |
| **Method** | Mount with mode:'edit', check text |
| **Pass** | Text contains 'EDIT TIP' |

### `terminal/scenes/checkout-core — co-adjust-single transactional > shows the formatted check amount`
| | |
|---|---|
| **Tests** | Check amount is displayed formatted as currency |
| **Method** | Mount with check.amount, check text |
| **Pass** | Text contains '$23.75' |

### `terminal/scenes/checkout-core — co-adjust-single transactional > shows the table label and check label in the info block`
| | |
|---|---|
| **Tests** | Table and check identifiers are shown |
| **Method** | Mount with table_label and check_label, check text |
| **Pass** | Text contains both 'T3' and '042' |

### `terminal/scenes/checkout-core — co-adjust-single transactional > shows the card brand when present`
| | |
|---|---|
| **Tests** | Card payment method is displayed |
| **Method** | Mount with card_brand, check text |
| **Pass** | Text contains 'VISA' |

### `terminal/scenes/checkout-core — co-adjust-single transactional > accepts camelCase check shape (checkId / checkLabel)`
| | |
|---|---|
| **Tests** | Check object accepts both snake_case and camelCase properties |
| **Method** | Mount with camelCase checkId/checkLabel |
| **Pass** | Text contains 'check label' |

### `terminal/scenes/checkout-core — co-adjust-single transactional > shows current tip row in edit mode when initialTip is provided`
| | |
|---|---|
| **Tests** | Edit mode displays existing tip amount |
| **Method** | Mount with mode:'edit' and initialTip |
| **Pass** | Text contains '$8.00' |

---

## `close-day-calc.test.js`
> Regression tests for close-of-day cash calculations: cash expected formula and cash variance computation

### `computeCashExpected > subtracts card_tips from cash_total — not cash_tips`
| | |
|---|---|
| **Tests** | Cash expected subtracts only card tips (CC tips paid from drawer, cash tips already in) |
| **Method** | Direct function call with {cash_total, card_tips, cash_tips} |
| **Pass** | `computeCashExpected({cash_total:500, card_tips:80, cash_tips:30}) === 420` |

### `computeCashExpected > does NOT subtract cash_tips (they remain in the drawer)`
| | |
|---|---|
| **Tests** | Cash tips are not subtracted from expected amount |
| **Method** | Direct function call with cash_tips but no card_tips |
| **Pass** | `computeCashExpected({cash_total:200, card_tips:0, cash_tips:50}) === 200` |

### `computeCashExpected > handles zero card_tips`
| | |
|---|---|
| **Tests** | Zero card tips returns cash total unchanged |
| **Method** | Direct function call with card_tips:0 |
| **Pass** | `computeCashExpected({cash_total:300, card_tips:0}) === 300` |

### `computeCashExpected > handles missing fields gracefully`
| | |
|---|---|
| **Tests** | Missing/null/undefined inputs default to zero |
| **Method** | Direct function calls with empty object, null, undefined |
| **Pass** | All return 0 |

### `computeCashExpected > result can be negative when card_tips exceed cash_total`
| | |
|---|---|
| **Tests** | Drawer shortage when card tips exceed cash on hand |
| **Method** | Direct function call with card_tips > cash_total |
| **Pass** | `computeCashExpected({cash_total:20, card_tips:50}) === -30` |

### `computeCashVariance > returns 0 when cashCounted is null (not yet counted)`
| | |
|---|---|
| **Tests** | Uncounted cash (null) shows zero variance |
| **Method** | Direct function call with null cashCounted |
| **Pass** | `computeCashVariance(400, null) === 0` |

### `computeCashVariance > returns 0 when cashCounted is "bypass"`
| | |
|---|---|
| **Tests** | Bypassed count shows zero variance |
| **Method** | Direct function call with 'bypass' string |
| **Pass** | `computeCashVariance(400, 'bypass') === 0` |

### `computeCashVariance > returns positive variance when drawer is over`
| | |
|---|---|
| **Tests** | Drawer surplus is returned as positive |
| **Method** | Direct function call with cashCounted > expected |
| **Pass** | `computeCashVariance(400, 415) === 15` |

### `computeCashVariance > returns negative variance when drawer is short`
| | |
|---|---|
| **Tests** | Drawer shortage is returned as negative |
| **Method** | Direct function call with cashCounted < expected |
| **Pass** | `computeCashVariance(400, 392.50) === -7.5` |

### `computeCashVariance > returns 0 when exact`
| | |
|---|---|
| **Tests** | Exact match shows zero variance |
| **Method** | Direct function call with equal amounts |
| **Pass** | `computeCashVariance(400, 400) === 0` |

### `computeCashVariance > rounds to 2 decimal places`
| | |
|---|---|
| **Tests** | Floating-point variance is rounded to cents |
| **Method** | Direct function call with 1/3 (0.3333...) |
| **Pass** | `computeCashVariance(0, 1/3) === 0.33` |


---
## `close-day-checks-viewer.test.js`
> Tests for close-day-checks-viewer scene covering bug fixes: .ok guard, inverted adjusted flag, _busy locks, and setTimeout cleanup

### `close-day-checks-viewer — Bug A: fetchChecksState .ok guard > falls back to empty data when all three fetches return HTTP 500`
| | |
|---|---|
| **Tests** | Verifies that HTTP 500 responses are caught and fallback to empty check arrays rather than corrupting state |
| **Method** | Mocks fetchWithTimeout to return `{ok: false, status: 500}`, calls scene render, flushes promises (6 times) |
| **Pass** | `state.data.openChecks` and `state.data.closedChecks` are both empty arrays |

### `close-day-checks-viewer — Bug A: fetchChecksState .ok guard > uses data normally when fetches return ok:true`
| | |
|---|---|
| **Tests** | Verifies successful fetch responses are parsed and populate state correctly |
| **Method** | Mocks fetchWithTimeout with three sequential `.ok: true` responses containing check summary, orders, and store data |
| **Pass** | State contains one check with correct checkId; restaurantName is set from store data |

### `close-day-checks-viewer — Bug A: fetchChecksState .ok guard > falls back gracefully when fetch rejects (network error)`
| | |
|---|---|
| **Tests** | Verifies network errors (Promise rejection) are caught and fallback to empty data |
| **Method** | Mocks fetchWithTimeout to reject with error, calls render, flushes promises |
| **Pass** | `state.data.openChecks` is empty array despite rejection |

### `close-day-checks-viewer — Bug B: tip-adjusted flag > adjusted is false when tip exists but sum.adjusted is not set`
| | |
|---|---|
| **Tests** | Verifies adjusted flag defaults to false when not explicitly set in summary |
| **Method** | Fetches check with tip=5 but no adjusted property, extracts first check from state |
| **Pass** | Check's `adjusted` property is `false` |

### `close-day-checks-viewer — Bug B: tip-adjusted flag > adjusted is true when sum.adjusted is explicitly true (regardless of tip)`
| | |
|---|---|
| **Tests** | Verifies explicitly-set true adjusted flag is preserved |
| **Method** | Fetches check with adjusted=true in summary data |
| **Pass** | Check's `adjusted` property is `true` |

### `close-day-checks-viewer — Bug B: tip-adjusted flag > adjusted is false when sum.adjusted is explicitly false`
| | |
|---|---|
| **Tests** | Verifies explicitly-set false adjusted flag is respected |
| **Method** | Fetches check with adjusted=false in summary data |
| **Pass** | Check's `adjusted` property is `false` |

### `close-day-checks-viewer — Bug B: tip-adjusted flag > adjusted is false when tip is null and sum.adjusted is not set`
| | |
|---|---|
| **Tests** | Verifies adjusted defaults to false when both tip and adjusted property are absent |
| **Method** | Fetches check with tip=null, no adjusted property |
| **Pass** | Check's `adjusted` property is `false` |

### `close-day-checks-viewer — Bug D: _busy guard > onTransferChecks ignores a second call while busy`
| | |
|---|---|
| **Tests** | Verifies _busy flag prevents concurrent handler execution for onTransferChecks |
| **Method** | Renders scene, calls onTransferChecks twice in succession, checks SceneManager.interrupt call count |
| **Pass** | Second call does not trigger new interrupt; _busy remains true after first call |

### `close-day-checks-viewer — Bug D: _busy guard > onPrintCheck ignores a second call while busy`
| | |
|---|---|
| **Tests** | Verifies _busy flag prevents concurrent handler execution for onPrintCheck |
| **Method** | Renders scene, calls onPrintCheck twice, counts fetchWithTimeout calls before/after |
| **Pass** | Fetch count does not increase on second call |

### `close-day-checks-viewer — Bug D: _busy guard > onVoidCheck ignores a second call while busy`
| | |
|---|---|
| **Tests** | Verifies _busy flag prevents concurrent handler execution for onVoidCheck |
| **Method** | Renders scene, calls onVoidCheck twice, checks that second call doesn't trigger interrupt |
| **Pass** | SceneManager.interrupt is not called for second invocation |

### `close-day-checks-viewer — Bug D: _busy guard > onTransferChecks clears _busy after cancel`
| | |
|---|---|
| **Tests** | Verifies _busy flag is cleared when transfer dialog is cancelled |
| **Method** | Calls onTransferChecks, finds co-transfer-picker interrupt, calls its onCancel |
| **Pass** | `state._busy` is reset to `false` |

### `close-day-checks-viewer — Bug E: onVoidCheck setTimeout cleanup > timer cleared on unmount — interrupt does not fire after scene unmounts`
| | |
|---|---|
| **Tests** | Verifies pending setTimeout is cleared on scene unmount to prevent orphaned callbacks |
| **Method** | Uses fake timers, triggers onVoidCheck flow through PIN confirmation, unmounts scene before timer fires, advances time 200ms |
| **Pass** | co-void-confirm interrupt is never opened; state._pendingTimer is null after unmount |

### `close-day-checks-viewer — Bug E: onVoidCheck setTimeout cleanup > timer fires normally when scene stays mounted`
| | |
|---|---|
| **Tests** | Verifies setTimeout fires normally when scene remains mounted |
| **Method** | Uses fake timers, triggers onVoidCheck → PIN confirmation → advances 200ms while mounted |
| **Pass** | co-void-confirm interrupt is found in SceneManager calls |

### `close-day-checks-viewer — action handlers use fetchWithTimeout > onTransferChecks ok:true — shows success toast and clears busy`
| | |
|---|---|
| **Tests** | Verifies successful transfer shows toast, uses fetchWithTimeout with 8s timeout, clears busy flag |
| **Method** | Renders with managerId, triggers onTransferChecks, confirms transfer picker with target server, flushes promises |
| **Pass** | fetchWithTimeout called with `/transfer` URL and 8000ms timeout; success toast shown; _busy is false |

### `close-day-checks-viewer — action handlers use fetchWithTimeout > onTransferChecks ok:false — shows error toast`
| | |
|---|---|
| **Tests** | Verifies failed transfer response shows error toast |
| **Method** | Mocks fetchWithTimeout to return `{ok: false, status: 500}`, triggers transfer flow, confirms dialog |
| **Pass** | Toast message contains "failed" |

### `close-day-checks-viewer — action handlers use fetchWithTimeout > onPrintCheck ok:true — shows printed toast and clears busy`
| | |
|---|---|
| **Tests** | Verifies successful print shows toast, uses fetchWithTimeout with 8s timeout, clears busy |
| **Method** | Renders scene, calls onPrintCheck with check, flushes promises |
| **Pass** | fetchWithTimeout called with `/print` URL and 8000ms timeout; success toast contains "Printed"; _busy is false |

### `close-day-checks-viewer — action handlers use fetchWithTimeout > onPrintCheck ok:false — shows error toast`
| | |
|---|---|
| **Tests** | Verifies failed print response shows error toast |
| **Method** | Mocks fetchWithTimeout `{ok: false}`, calls onPrintCheck, flushes |
| **Pass** | Toast message contains "failed" |

### `close-day-checks-viewer — action handlers use fetchWithTimeout > onVoidCheck confirm path ok:true — shows voided toast and clears busy`
| | |
|---|---|
| **Tests** | Verifies successful void through PIN confirmation shows toast, calls fetch, clears busy |
| **Method** | Uses fake timers, triggers onVoidCheck → confirms PIN → advances 200ms → confirms void reason, flushes |
| **Pass** | fetchWithTimeout called with `/void` URL and 8000ms timeout; toast contains "Voided"; _busy is false |

### `close-day-checks-viewer — action handlers use fetchWithTimeout > onVoidCheck confirm path ok:false — shows error toast`
| | |
|---|---|
| **Tests** | Verifies failed void response shows error toast |
| **Method** | Uses fake timers, mocks fetchWithTimeout `{ok: false, status: 500}`, triggers void flow through PIN and reason dialogs |
| **Pass** | Toast message contains "failed" |

---

## `close-day.test.js`
> Tests for exported pure helper functions in close-day.js (fmt, fmtPct, deltaColor, checkNumDisplay, synthCheckLabel, formatTime, cashStatusLabel, cashStatusColor)

### `fmt — dollar formatter > formats a positive decimal`
| | |
|---|---|
| **Tests** | Verifies dollar formatting of positive values with 2 decimal places |
| **Method** | Direct function call with numeric input |
| **Pass** | fmt(9.5) returns '$9.50' |

### `fmt — dollar formatter > formats zero`
| | |
|---|---|
| **Tests** | Verifies zero is formatted as $0.00 |
| **Method** | Direct function call with 0 |
| **Pass** | Returns '$0.00' |

### `fmt — dollar formatter > uses unicode minus for negative values`
| | |
|---|---|
| **Tests** | Verifies negative values use unicode minus sign instead of hyphen |
| **Method** | Direct function call with negative number |
| **Pass** | fmt(-5) returns '−$5.00' (unicode minus) |

### `fmt — dollar formatter > inserts thousands separator`
| | |
|---|---|
| **Tests** | Verifies comma is inserted in thousands positions |
| **Method** | Direct function call with 4+ digit number |
| **Pass** | fmt(1234.5) returns '$1,234.50' |

### `fmt — dollar formatter > treats null/undefined as 0`
| | |
|---|---|
| **Tests** | Verifies falsy inputs are coerced to zero |
| **Method** | Direct function calls with null and undefined |
| **Pass** | Both return '$0.00' |

### `fmtPct — percentage formatter > returns em-dash for null`
| | |
|---|---|
| **Tests** | Verifies null input renders as em-dash (no percentage) |
| **Method** | Direct function call with null |
| **Pass** | Returns '—' |

### `fmtPct — percentage formatter > returns em-dash for non-finite (Infinity)`
| | |
|---|---|
| **Tests** | Verifies Infinity values render as em-dash (undefined percentage) |
| **Method** | Direct function call with Infinity |
| **Pass** | Returns '—' |

### `fmtPct — percentage formatter > returns middle-dot for zero`
| | |
|---|---|
| **Tests** | Verifies zero delta shows neutral indicator |
| **Method** | Direct function call with 0 |
| **Pass** | Returns '· 0.0%' |

### `fmtPct — percentage formatter > shows up-arrow for positive delta`
| | |
|---|---|
| **Tests** | Verifies positive percentage shows up-arrow indicator |
| **Method** | Direct function call with positive number |
| **Pass** | fmtPct(5.1) returns '▲ 5.1%' |

### `fmtPct — percentage formatter > shows down-arrow for negative delta`
| | |
|---|---|
| **Tests** | Verifies negative percentage shows down-arrow indicator |
| **Method** | Direct function call with negative number |
| **Pass** | fmtPct(-3.2) returns '▼ 3.2%' |

### `deltaColor — picks color by sign > returns neutral text color for zero`
| | |
|---|---|
| **Tests** | Verifies zero delta uses neutral color |
| **Method** | Direct function call with 0 |
| **Pass** | Returns '#text' |

### `deltaColor — picks color by sign > returns neutral text color for null`
| | |
|---|---|
| **Tests** | Verifies null uses neutral color |
| **Method** | Direct function call with null |
| **Pass** | Returns '#text' |

### `deltaColor — picks color by sign > returns green for positive delta`
| | |
|---|---|
| **Tests** | Verifies positive deltas use success/green color |
| **Method** | Direct function call with positive number |
| **Pass** | deltaColor(1) returns '#green' |

### `deltaColor — picks color by sign > returns verm for negative delta`
| | |
|---|---|
| **Tests** | Verifies negative deltas use error/vermillion color |
| **Method** | Direct function call with negative number |
| **Pass** | deltaColor(-1) returns '#verm' |

### `deltaColor — picks color by sign > positive and negative return different colors`
| | |
|---|---|
| **Tests** | Verifies distinct colors for opposite deltas |
| **Method** | Direct function calls with 10 and -10, compares results |
| **Pass** | Two results are not equal |

### `checkNumDisplay — check label normalizer > passes through labels that start with #`
| | |
|---|---|
| **Tests** | Verifies '#' prefixed labels are returned unchanged |
| **Method** | Direct function call with {checkLabel: '#21'} |
| **Pass** | Returns '#21' |

### `checkNumDisplay — check label normalizer > passes through labels that start with C (e.g. C-001)`
| | |
|---|---|
| **Tests** | Verifies 'C-' prefixed labels are returned unchanged |
| **Method** | Direct function call with {checkLabel: 'C-001'} |
| **Pass** | Returns 'C-001' |

### `checkNumDisplay — check label normalizer > prepends # to bare numeric labels`
| | |
|---|---|
| **Tests** | Verifies bare numbers are prefixed with '#' |
| **Method** | Direct function call with {checkLabel: '27'} |
| **Pass** | Returns '#27' |

### `checkNumDisplay — check label normalizer > falls back to checkId when checkLabel absent`
| | |
|---|---|
| **Tests** | Verifies checkId is used when checkLabel is missing, with '#' prefix added |
| **Method** | Direct function call with {checkId: '42'} |
| **Pass** | Returns '#42' |

### `checkNumDisplay — check label normalizer > returns empty string when neither field is present`
| | |
|---|---|
| **Tests** | Verifies empty object returns empty string |
| **Method** | Direct function call with {} |
| **Pass** | Returns '' |

### `synthCheckLabel — synthesizes display label from order_id > pads bare numbers to 3 digits`
| | |
|---|---|
| **Tests** | Verifies short numbers are zero-padded to 3 digits with C- prefix |
| **Method** | Direct function call with '27' |
| **Pass** | Returns 'C-027' |

### `synthCheckLabel — synthesizes display label from order_id > strips leading zeros before padding`
| | |
|---|---|
| **Tests** | Verifies leading zeros are removed before re-padding to 3 digits |
| **Method** | Direct function call with '0027' |
| **Pass** | Returns 'C-027' |

### `synthCheckLabel — synthesizes display label from order_id > extracts trailing number from prefixed IDs`
| | |
|---|---|
| **Tests** | Verifies numeric suffix is extracted from prefixed IDs |
| **Method** | Direct function call with 'order_27' |
| **Pass** | Returns 'C-027' |

### `synthCheckLabel — synthesizes display label from order_id > uses last numeric group in compound IDs`
| | |
|---|---|
| **Tests** | Verifies trailing numeric group is extracted from multi-part IDs |
| **Method** | Direct function call with 'ord-abc-5' |
| **Pass** | Returns 'C-005' |

### `synthCheckLabel — synthesizes display label from order_id > does not pad numbers longer than 3 digits`
| | |
|---|---|
| **Tests** | Verifies 4+ digit numbers are not zero-padded |
| **Method** | Direct function call with '1234' |
| **Pass** | Returns 'C-1234' |

### `synthCheckLabel — synthesizes display label from order_id > falls back to uppercase first-3-chars when no digits`
| | |
|---|---|
| **Tests** | Verifies non-numeric IDs use first 3 uppercase characters |
| **Method** | Direct function call with 'abc-def' |
| **Pass** | Returns 'C-ABC' |

### `synthCheckLabel — synthesizes display label from order_id > returns C-??? for empty/falsy input`
| | |
|---|---|
| **Tests** | Verifies empty/null input renders as C-??? placeholder |
| **Method** | Direct function calls with '' and null |
| **Pass** | Both return 'C-???' |

### `formatTime — normalises time strings > returns empty string for falsy input`
| | |
|---|---|
| **Tests** | Verifies empty string and null are returned unchanged |
| **Method** | Direct function calls with '' and null |
| **Pass** | Both return '' |

### `formatTime — normalises time strings > passes through pre-formatted strings like "7:23pm"`
| | |
|---|---|
| **Tests** | Verifies already-formatted 12-hour times are unchanged |
| **Method** | Direct function call with '7:23pm' |
| **Pass** | Returns '7:23pm' |

### `formatTime — normalises time strings > passes through "20:23" (colon at position 2, no T marker)`
| | |
|---|---|
| **Tests** | Verifies 24-hour time format is unchanged |
| **Method** | Direct function call with '20:23' |
| **Pass** | Returns '20:23' |

### `formatTime — normalises time strings > converts ISO-8601 to 12-hour local time`
| | |
|---|---|
| **Tests** | Verifies ISO 8601 timestamps are converted to 12-hour local time |
| **Method** | Builds ISO string from known local Date (2:23pm), calls formatTime |
| **Pass** | Returns '2:23pm' |

### `formatTime — normalises time strings > returns invalid ISO strings unchanged`
| | |
|---|---|
| **Tests** | Verifies malformed date strings are not modified |
| **Method** | Direct function call with 'not-a-date' |
| **Pass** | Returns 'not-a-date' |

### `cashStatusLabel > returns PENDING when cashCounted is null`
| | |
|---|---|
| **Tests** | Verifies uncounted cash shows PENDING status |
| **Method** | Direct function call with {cashCounted: null} |
| **Pass** | Returns 'PENDING' |

### `cashStatusLabel > returns DONE when cashCounted is a number`
| | |
|---|---|
| **Tests** | Verifies counted cash amount shows DONE status |
| **Method** | Direct function call with {cashCounted: 150} |
| **Pass** | Returns 'DONE' |

### `cashStatusLabel > returns BYPASSED when cashCounted is "bypass"`
| | |
|---|---|
| **Tests** | Verifies bypass flag shows BYPASSED status |
| **Method** | Direct function call with {cashCounted: 'bypass'} |
| **Pass** | Returns 'BYPASSED' |

### `cashStatusColor > returns warning color when pending`
| | |
|---|---|
| **Tests** | Verifies pending cash status uses warning color |
| **Method** | Direct function call with {cashCounted: null} |
| **Pass** | Returns '#warn' |

### `cashStatusColor > returns green when done`
| | |
|---|---|
| **Tests** | Verifies completed cash count uses success color |
| **Method** | Direct function call with {cashCounted: 50} |
| **Pass** | Returns '#green' |

### `cashStatusColor > returns lavender when bypassed`
| | |
|---|---|
| **Tests** | Verifies bypassed cash status uses lavender color |
| **Method** | Direct function call with {cashCounted: 'bypass'} |
| **Pass** | Returns '#lav' |

---

## `column-editor.test.js`
> Integration tests for column-editor scene through render() and DOM event surface (Move, Split, Merge, Undo, UndoAll, AddSeat, AddCheck operations)

### `column-editor — Move > moves a selected item from col 0 to col 1`
| | |
|---|---|
| **Tests** | Verifies item is transferred from source column to target column on selection + header tap |
| **Method** | Mounts two columns, taps item in col 0, taps col 1 header to move |
| **Pass** | Col 0 has 0 items, col 1 has 1 item with name 'Burger' |

### `column-editor — Move > move is recorded in the action log`
| | |
|---|---|
| **Tests** | Verifies each move operation is recorded for undo tracking |
| **Method** | Performs a move operation, checks state.actionLog |
| **Pass** | actionLog has length 1 |

### `column-editor — Move > selected items are cleared after a move`
| | |
|---|---|
| **Tests** | Verifies selection state is reset after move completes |
| **Method** | Selects item, moves it, checks state.selectedItems |
| **Pass** | selectedItems array has length 0 |

### `column-editor — Split > splits a $10.00 item evenly across 2 seats → $5.00 each`
| | |
|---|---|
| **Tests** | Verifies price is divided evenly without remainder (even amount) |
| **Method** | Enters split mode, selects $10 item, marks both columns as targets, confirms split |
| **Pass** | Two items with $5.00 each; sum equals $10.00 |

### `column-editor — Split > assigns the cent remainder to the first seat on odd amounts`
| | |
|---|---|
| **Tests** | Verifies remainder penny goes to first target column on uneven division |
| **Method** | Splits $10.01 across 2 columns, compares prices |
| **Pass** | Higher price is $5.01 (first seat), lower is $5.00; sum is $10.01 |

### `column-editor — Split > split items share the same _splitRef`
| | |
|---|---|
| **Tests** | Verifies split items are linked via internal reference for later merge detection |
| **Method** | Splits item, checks _splitRef on both resulting items |
| **Pass** | Both items have truthy _splitRef and they are equal |

### `column-editor — Split > split across 3 seats: remainder lands on seat 0 only`
| | |
|---|---|
| **Tests** | Verifies division logic with 3+ targets distributes cleanly with remainder on first |
| **Method** | Splits $10 across 3 columns, verifies total and distribution |
| **Pass** | 3 items total; sum is approximately $10.00 |

### `column-editor — Merge > merges both columns into the target; result has one column`
| | |
|---|---|
| **Tests** | Verifies all columns are collapsed into selected target column |
| **Method** | Enters merge mode, taps col 1 header as target |
| **Pass** | Result has 1 column with 2 items |

### `column-editor — Merge > previously split items are recollapsed on merge`
| | |
|---|---|
| **Tests** | Verifies split items with matching _splitRef are recombined into single item at original price |
| **Method** | Creates 2 columns with split items (same _splitRef, $15 each), merges |
| **Pass** | Result has 1 column with 1 item at $30.00 |

### `column-editor — Undo > undo after a move restores the original column state`
| | |
|---|---|
| **Tests** | Verifies single undo reverses last move operation |
| **Method** | Moves item from col 0 to col 1, short-presses UNDO button |
| **Pass** | Col 0 has 1 item 'Soup', col 1 has 0 items |

### `column-editor — Undo > undo on an empty action log does nothing`
| | |
|---|---|
| **Tests** | Verifies undo is harmless when no operations have been performed |
| **Method** | Presses UNDO without any prior actions |
| **Pass** | Column state unchanged; actionLog has length 0 |

### `column-editor — Undo > undo-all (long press 600ms) restores original snapshot`
| | |
|---|---|
| **Tests** | Verifies 600ms long-press clears all actions and reverts to initial state |
| **Method** | Uses fake timers, performs 2 moves, long-presses UNDO for 600ms |
| **Pass** | actionLog is empty; col 0 has 1 item; col 1 has 0 items |

### `column-editor — Add seat > adds a new column with the next sequential seat number`
| | |
|---|---|
| **Tests** | Verifies new column is created with auto-incremented S-NNN label |
| **Method** | Taps NEW SEAT zone |
| **Pass** | State has 2 columns; new column label is 'S-002' |

### `column-editor — Add seat > skips already-used seat numbers`
| | |
|---|---|
| **Tests** | Verifies next seat number is correctly calculated from existing columns |
| **Method** | Starts with 2 columns (S-001, S-002), taps NEW SEAT |
| **Pass** | Third column label is 'S-003' |

### `column-editor — Add check > moves selected items into a new CHK column`
| | |
|---|---|
| **Tests** | Verifies selected items are moved to a new column marked as check |
| **Method** | Selects first of two items, taps NEW CHECK zone |
| **Pass** | 2 columns total; col 0 has 1 item (Beer); col 1 has 1 item (Wine) with isNewCheck=true |

### `column-editor — Add check > does nothing when no items are selected`
| | |
|---|---|
| **Tests** | Verifies NEW CHECK without selection shows error toast and does not modify state |
| **Method** | Taps NEW CHECK zone without selecting items |
| **Pass** | State has 1 column; showToast called with message containing "Select items" |

---

## `item-detail.test.js`
> Tests for item-detail scene render logic (price calculation, item name, modifier list, DONE button)

### `item-detail render — guard > returns without rendering when params.item is absent`
| | |
|---|---|
| **Tests** | Verifies render is guarded against missing item parameter |
| **Method** | Calls render with empty params object |
| **Pass** | Container has 0 children |

### `item-detail render — total price > shows unitPrice when there are no mods`
| | |
|---|---|
| **Tests** | Verifies price element displays base item price when no modifiers exist |
| **Method** | Renders burger (unitPrice: 9.99) with empty mods array |
| **Pass** | Second child element shows '$9.99' |

### `item-detail render — total price > totals unitPrice + sum of mod prices`
| | |
|---|---|
| **Tests** | Verifies total price is sum of item and modifier prices |
| **Method** | Renders pizza ($12) + 2 mods ($1.50, $0.75) |
| **Pass** | Price element shows '$14.25' |

### `item-detail render — total price > treats missing mod price as 0`
| | |
|---|---|
| **Tests** | Verifies undefined mod prices do not increment total |
| **Method** | Renders item with mod lacking price property |
| **Pass** | Price shows base item price only ($8.00) |

### `item-detail render — item name > displays the item name in the title element`
| | |
|---|---|
| **Tests** | Verifies first child element contains item name |
| **Method** | Renders item with name 'Cheeseburger' |
| **Pass** | First child has textContent 'Cheeseburger' |

### `item-detail render — modifier list > shows "No modifiers" when mods array is empty`
| | |
|---|---|
| **Tests** | Verifies empty mod array shows placeholder message |
| **Method** | Renders item with mods: [] |
| **Pass** | Third child shows 'No modifiers' |

### `item-detail render — modifier list > shows "No modifiers" when mods is absent`
| | |
|---|---|
| **Tests** | Verifies missing mods property shows placeholder message |
| **Method** | Renders item without mods property |
| **Pass** | Third child shows 'No modifiers' |

### `item-detail render — modifier list > displays mod name with prefix prepended`
| | |
|---|---|
| **Tests** | Verifies prefix and name are concatenated in modifier display |
| **Method** | Renders pizza with mod (name: 'Pepperoni', prefix: 'Extra') |
| **Pass** | Span in scroll container shows 'Extra Pepperoni' |

### `item-detail render — modifier list > displays mod name without prefix when prefix is absent`
| | |
|---|---|
| **Tests** | Verifies mod is displayed with name alone when prefix is missing |
| **Method** | Renders item with mod (name: 'Mushrooms', no prefix) |
| **Pass** | Span shows 'Mushrooms' |

### `item-detail render — modifier list > shows "+$X.XX" price only when mod price is greater than zero`
| | |
|---|---|
| **Tests** | Verifies mod prices are shown only for non-zero amounts |
| **Method** | Renders wrap with 2 mods: paid ($2.00) and free (price: 0) |
| **Pass** | Paid mod shows '+$2.00'; free mod shows '' |

### `item-detail render — modifier list > renders child exclusion rows indented under the parent mod`
| | |
|---|---|
| **Tests** | Verifies nested child mods (exclusions) are indented and displayed |
| **Method** | Renders pizza with parent mod (Half Topping) containing 2 child mods (No Mushrooms, No Onions) |
| **Pass** | Multiple indented div rows found containing "No Mushrooms" and "No Onions" |

### `item-detail render — DONE button > DONE button calls SceneManager.closeTransactional("item-detail")`
| | |
|---|---|
| **Tests** | Verifies DONE button closes the item-detail scene when clicked |
| **Method** | Renders item, finds button with text 'DONE', dispatches pointerup event |
| **Pass** | SceneManager.closeTransactional called with 'item-detail' |

---
## `login.test.js`
> Tests PIN verification, setToken flow, and double-submit guards with 429 vs "INVALID PIN" distinction

### `429 from verify-pin → numpad shows "TOO MANY ATTEMPTS" (distinct from invalid-PIN)`
| | |
|---|---|
| **Tests** | 429 response triggers rate-limit error message instead of generic PIN error |
| **Method** | Mock fetch to return 429 status; invoke numpad onSubmit callback; assert error message and cleared state |
| **Pass** | numpad.setError called with 'TOO MANY ATTEMPTS', setToken not called, state.locked is false |

### `200 with valid:false → numpad shows the default "INVALID PIN" message`
| | |
|---|---|
| **Tests** | Valid false response displays standard PIN error message |
| **Method** | Mock fetch to return 200 with {valid: false}; invoke numpad onSubmit; assert error display |
| **Pass** | numpad.setError called with 'INVALID PIN', setToken not called, state.locked is false |

### `200 with valid:true → setToken is called with the full response payload`
| | |
|---|---|
| **Tests** | Successful PIN verification passes full auth payload to setToken |
| **Method** | Mock fetch to return 200 with auth payload; invoke onSubmit; await async chain (fetch → json → setToken) |
| **Pass** | setTokenMock called once with entire response object including token, employee_id, name, roles |

### `state.locked gates double-submit: second call while first is in flight is a no-op`
| | |
|---|---|
| **Tests** | In-flight request guard prevents concurrent submissions using state.locked flag |
| **Method** | Mock fetch to never resolve; invoke onSubmit twice; measure fetch call count and token calls |
| **Pass** | state.locked set to true on first submit, second submit ignored, only one fetch made, setToken never called |

---

## `manager-landing.test.js`
> Integration tests for void/merge/print actions, filter cycling, order reconciliation, and double-tap detection

### `Void first tap sets _voidPending, shows toast, does NOT fetch`
| | |
|---|---|
| **Tests** | First tap on void button arms confirmation without network call |
| **Method** | Mount scene with test orders, set selectedIds, invoke pillHandlers['Void'](), assert state and toast |
| **Pass** | _voidPending and _voidPendingKey set, showToast called with "tap again" message, fetch not called |

### `Void second tap with same selection fires POST to /orders/{id}/void`
| | |
|---|---|
| **Tests** | Confirmation double-tap sends void request to correct endpoint |
| **Method** | Invoke Void twice on same selection; assert fetch called with POST and order ID in URL |
| **Pass** | fetch called once with /orders/order-a/void and method POST, _voidPending cleared |

### `changing selection between tap-1 and tap-2 resets confirmation (bypass fix)`
| | |
|---|---|
| **Tests** | Selection change between taps resets pending confirmation, prevents accidental void of wrong order |
| **Method** | Void tap-1 on order-a, change state.selectedIds to order-b, Void tap-2; assert no fetch and new key |
| **Pass** | fetch not called, _voidPendingKey now points to order-b, showToast called twice |

### `Void pending flag expires after 3 s`
| | |
|---|---|
| **Tests** | Pending confirmation window closes automatically after timeout |
| **Method** | Use fake timers; invoke Void once; advance time by 3001ms; assert flag cleared |
| **Pass** | _voidPending false after 3s, _voidPendingKey nulled |

### `Void with no manager emp shows error toast and does not fetch`
| | |
|---|---|
| **Tests** | Missing manager identity blocks void action |
| **Method** | Mount with state.emp = {}, invoke Void; assert toast and no fetch |
| **Pass** | showToast called with "Manager approval" message, fetch not called |

### `Merge with fewer than 2 checks selected shows error toast`
| | |
|---|---|
| **Tests** | Merge requires minimum 2 selections |
| **Method** | Mount with one selected order, invoke pillHandlers['Merge'](); assert error toast |
| **Pass** | showToast called with "2+" requirement message, fetch not called |

### `Merge in-flight guard: rapid double-tap fires only one POST`
| | |
|---|---|
| **Tests** | Concurrent merge requests blocked while first is in flight |
| **Method** | Mock fetch to never resolve; invoke Merge twice with 2+ selections; assert single fetch |
| **Pass** | fetch called once with /orders/.../merge and method POST |

### `filter cycles OPEN → CLOSED → VOID → OPEN and clears selectedIds each time`
| | |
|---|---|
| **Tests** | Filter cycles through three statuses and clears selection on each cycle |
| **Method** | Mount scene, set selectedIds, dispatch pointerup on filterBtn three times; assert state changes |
| **Pass** | state.filter changes OPEN → CLOSED → VOID → OPEN, selectedIds emptied each time |

### `cleanup cancels the void-pending timer so it cannot fire on stale state`
| | |
|---|---|
| **Tests** | Scene cleanup properly cancels pending void timer to prevent side effects on unmounted state |
| **Method** | Use fake timers; mount, arm void pending, call cleanup function, advance time; assert timer cancelled |
| **Pass** | cleanup is a function, timer does not fire on detached state after cleanup |

### `refresh() prunes selectedIds when an order vanishes from allOrders`
| | |
|---|---|
| **Tests** | Selection reconciliation removes IDs for orders that no longer exist |
| **Method** | Mount with order-a selected, mock fetch to return only order-b, trigger order:updated event; assert |
| **Pass** | allOrders contains only order-b, selectedIds emptied |

### `Print partial failure: toast fires even when one POST rejects`
| | |
|---|---|
| **Tests** | Print handles mixed success/failure across multiple orders |
| **Method** | Mount with 2 orders selected, mock fetch to reject one; invoke Print; await promises; assert toast |
| **Pass** | showToast called with "1 printed, 1 failed", _printing cleared |

### `Print in-flight guard: second tap during in-flight fetch does not fire another POST`
| | |
|---|---|
| **Tests** | Print prevents concurrent requests |
| **Method** | Mock fetch to never resolve; invoke Print twice; assert single fetch |
| **Pass** | fetch called once |

### `Print all-success: completion toast uses plural/singular correctly`
| | |
|---|---|
| **Tests** | Print displays correct grammar for completion count |
| **Method** | Mount with 2 selected orders, mock fetch ok:true; invoke Print; assert toast text |
| **Pass** | showToast called with "Printed 2 receipts" |

### `pill action does not fire a fetch for an order that vanished during refresh`
| | |
|---|---|
| **Tests** | Post-reconciliation void on empty selection shows appropriate error |
| **Method** | Mount, select order-a, refresh removes it, invoke Void twice; assert no void POST and error toast |
| **Pass** | fetch not called with /void endpoint, showToast called with "Select a check first" |

### `Merge 400 with {detail}: toast shows server detail and clears _merging`
| | |
|---|---|
| **Tests** | Merge error response with detail field displays server message |
| **Method** | Mount with 2+ selected, mock fetch to return 400 with {detail} body; invoke Merge; assert |
| **Pass** | showToast called with server detail text, _merging flag false |

### `Void partial failure: mixed success/fail toast fires and selection clears`
| | |
|---|---|
| **Tests** | Void with multiple orders handles partial failure and clears selection |
| **Method** | Mount with 2 selected, mock fetch to fail one; Void tap-1 then tap-2; await promises; assert |
| **Pass** | showToast called with "1 voided, 1 failed", selectedIds cleared |

### `double-tap within timeout opens check-overview`
| | |
|---|---|
| **Tests** | Rapid double-tap on tile launches order detail scene within 300ms window |
| **Method** | Use fake timers; mount, set allOrders, advance past 200ms guard, tap tile twice within 300ms; assert mountWorking |
| **Pass** | SceneManager.mountWorking called with 'check-overview' and order data |

### `double-tap after timeout deselects the tile instead of opening check-overview`
| | |
|---|---|
| **Tests** | Slow second tap toggles selection instead of opening scene |
| **Method** | Use fake timers; mount, advance past 200ms guard, tap once, advance 400ms, tap again; assert |
| **Pass** | order deselected, SceneManager.mountWorking not called |

---

## `payment.test.js`
> Split-select interrupt param shape validation and pc-change-due result screen behavior

### `renders the correct remaining balance in the sub-line`
| | |
|---|---|
| **Tests** | Split-select displays remaining balance passed via params |
| **Method** | Mount interrupt with remaining=45.00; check container textContent |
| **Pass** | textContent contains '$45.00' |

### `renders three split options (1/2, 1/3, 1/4)`
| | |
|---|---|
| **Tests** | Three fractional split buttons are rendered |
| **Method** | Mount interrupt; search container for option labels; assert all three found |
| **Pass** | findOption returns non-null for '1/2', '1/3', '1/4' |

### `1/2 option passes ceil(remaining / 2) to onConfirm`
| | |
|---|---|
| **Tests** | 1/2 split calculates and confirms correct amount |
| **Method** | Mount with remaining=45.00, vi.fn() onConfirm; dispatch pointerup on 1/2 option; assert call |
| **Pass** | onConfirm called with 22.50 |

### `1/3 option rounds the onConfirm payload up to the nearest cent`
| | |
|---|---|
| **Tests** | 1/3 split rounds up fractional cents |
| **Method** | Mount with remaining=10.00; tap 1/3; assert ceil rounding |
| **Pass** | onConfirm called with 3.34 (ceil of 3.333...) |

### `1/4 option passes ceil(remaining / 4) to onConfirm`
| | |
|---|---|
| **Tests** | 1/4 split calculates correct amount |
| **Method** | Mount with remaining=45.00; tap 1/4; assert call |
| **Pass** | onConfirm called with 11.25 |

### `shows OVERVIEW button (not NEW ORDER)`
| | |
|---|---|
| **Tests** | pc-change-due result screen has OVERVIEW action, not NEW ORDER |
| **Method** | Mount result screen; query buttons; extract textContent labels; assert presence/absence |
| **Pass** | labels includes 'OVERVIEW', does not include 'NEW ORDER' |

### `shows LOGOUT button`
| | |
|---|---|
| **Tests** | pc-change-due result displays logout option |
| **Method** | Mount result; query button labels |
| **Pass** | labels includes 'LOGOUT' |

### `shows "Payment Approved" for a card payment with no change`
| | |
|---|---|
| **Tests** | Card payment zero-change displays approval message |
| **Method** | Mount with paymentMode='card', change=0; check textContent |
| **Pass** | container textContent contains 'Payment Approved' |

### `shows change amount for a cash payment with change due`
| | |
|---|---|
| **Tests** | Cash payment displays change amount and label |
| **Method** | Mount with paymentMode='cash', change=5.25; check textContent |
| **Pass** | textContent contains '$5.25' and 'Change Due' |

### `shows "Exact Change" for a cash payment with zero change`
| | |
|---|---|
| **Tests** | Cash zero-change displays exact change message |
| **Method** | Mount with paymentMode='cash', change=0; check textContent |
| **Pass** | textContent contains 'Exact Change' |

### `shows auto-countdown hint when isLastPayment is true`
| | |
|---|---|
| **Tests** | Last payment in sequence displays return countdown |
| **Method** | Use fake timers; mount with isLastPayment=true; check for countdown pattern |
| **Pass** | textContent matches /returning to landing in \d+s/ |

### `does NOT show countdown hint when isLastPayment is false`
| | |
|---|---|
| **Tests** | Non-final payment omits countdown |
| **Method** | Use fake timers; mount with isLastPayment=false; assert no countdown text |
| **Pass** | textContent does not match /returning to landing/ |

### `countdown decrements every second when isLastPayment`
| | |
|---|---|
| **Tests** | Countdown timer updates each second |
| **Method** | Use fake timers; mount with isLastPayment=true; advance 1000ms twice; assert text changes |
| **Pass** | textContent shows '3s' initially, '2s' after 1s, '1s' after 2s |

### `OVERVIEW tap invokes closeAllTransactional via mocked SceneManager`
| | |
|---|---|
| **Tests** | OVERVIEW button is interactive (routes back to check view) |
| **Method** | Mount; find OVERVIEW button; dispatch pointerup; assert button content |
| **Pass** | button textContent is 'OVERVIEW' (routing test requires sceneData internals) |

---

## `seats.test.js`
> Seat and item selection, layout mode, backend-to-frontend shape conversion, subtotal math

### `seatSubtotal sums qty × price`
| | |
|---|---|
| **Tests** | Seat total correctly multiplies item quantities by prices |
| **Method** | Call seatSubtotal with test seat containing items array; assert numeric result |
| **Pass** | Returns 20 (2×5 + 1×10) |

### `seatSubtotal prefers effectivePrice over price (mods + discounts baked in)`
| | |
|---|---|
| **Tests** | Effective price (after mods/discounts) takes precedence over base price |
| **Method** | Call with items having both price and effectivePrice; assert uses effective |
| **Pass** | Returns 20 (1×12 + 1×8 using effectivePrice) |

### `seatSubtotal is 0 for an empty or missing items list`
| | |
|---|---|
| **Tests** | Safe fallback for empty or null seat data |
| **Method** | Call with {}, {items: []}, null, undefined; assert all return 0 |
| **Pass** | All cases return 0 |

### `checkSubtotal skips paid seats`
| | |
|---|---|
| **Tests** | Check total excludes seats marked as paid |
| **Method** | Call with 3 seats and paidSeats map; assert only unpaid summed |
| **Pass** | checkSubtotal(seats, {s2: true}) returns 40 (10 + 30, skips 20) |

### `activeSeatCount ignores paid seats`
| | |
|---|---|
| **Tests** | Active seat count excludes paid seats |
| **Method** | Call with 3 seats and paidSeats {b: true}; assert returns 2 |
| **Pass** | Returns 2, handles empty and null paidSeats as 3 |

### `layoutModeFor: 1-4 → A, 5+ → B`
| | |
|---|---|
| **Tests** | Layout mode selection based on active seat count |
| **Method** | Call with various counts; assert mode switches at 5 |
| **Pass** | 1-4 returns 'A', 5+ returns 'B' |

### `seeds from order.seat_numbers so empty seats are preserved`
| | |
|---|---|
| **Tests** | orderToSeats creates empty seat objects for all declared seat numbers |
| **Method** | Call with order containing seat_numbers [1,2,3] and no items; assert 3 seats |
| **Pass** | Returns 3 seats with numbers [1,2,3], all with empty items arrays |

### `attaches items to their seat_number; preserves seats with no items`
| | |
|---|---|
| **Tests** | Items routed to correct seat, empty seats retained |
| **Method** | Call with 3 seats and items on seats 1, 2; assert correct attachment and empty seat 3 |
| **Pass** | Seat 1 has Burger, seat 2 has Fries, seat 3 has empty items array |

### `creates a seat on-the-fly for an item whose seat_number is missing from seat_numbers (legacy replay)`
| | |
|---|---|
| **Tests** | Missing declared seats materialized from item routing, preventing data loss |
| **Method** | Call with seat_numbers=[1] but items on seats 1, 2, 5; assert all 3 seats created |
| **Pass** | Returns 3 seats [1, 2, 5] with items correctly routed |

### `pads to minSeats when the backend returns fewer`
| | |
|---|---|
| **Tests** | Fresh check creates minimum seat count |
| **Method** | Call orderToSeats with null and minSeats=1; empty order and minSeats=2; order with 1 seat and minSeats=3 |
| **Pass** | Returns 1, 2, 3 seats respectively |

### `returns seats sorted ascending by number even if backend sent them unsorted`
| | |
|---|---|
| **Tests** | Seat ordering normalized independent of API response order |
| **Method** | Call with seat_numbers [5,1,3]; assert output sorted |
| **Pass** | Returns seats ordered [1, 3, 5] |

### `uses effective_price when present; falls back to price (0 is treated as absent here, matching legacy behavior)`
| | |
|---|---|
| **Tests** | Effective price mapping in orderToSeats respects field name mismatch |
| **Method** | Call with item having price=10, effective_price=15; assert both fields set correctly |
| **Pass** | seat.items[0].price is 10, effectivePrice is 15 |

### `items with null / undefined / 0 seat_number default to seat 1`
| | |
|---|---|
| **Tests** | Items without explicit seat number land on seat 1 |
| **Method** | Call with items missing seat_number, with null, with 0; assert all on seat 1 |
| **Pass** | All items on seat 1 |

### `toggleSeatSelection adds an unselected seat`
| | |
|---|---|
| **Tests** | Toggle adds new seat to selection map |
| **Method** | Call with empty selection, empty paid map, seat 's1'; assert added |
| **Pass** | Returns {s1: true} |

### `toggleSeatSelection removes a selected seat`
| | |
|---|---|
| **Tests** | Toggle removes selected seat |
| **Method** | Call with {s1: true}; assert removed |
| **Pass** | Returns {} |

### `toggleSeatSelection is a no-op on paid seats (selection is only for pending work)`
| | |
|---|---|
| **Tests** | Paid seats cannot be toggled |
| **Method** | Call with paid map {s2: true}, attempt toggle s2; assert unchanged |
| **Pass** | Returns {s1: true} (only existing selection) |

### `toggleSeatSelection returns a NEW map (does not mutate the input)`
| | |
|---|---|
| **Tests** | Immutable selection updates |
| **Method** | Call and compare returned map identity to input; assert different objects |
| **Pass** | next !== prev, input unchanged, next has new seat |

### `toggleItemSelection toggles a "seatIdx:itemIdx" key`
| | |
|---|---|
| **Tests** | Item selection uses composite string key |
| **Method** | Toggle same key twice from empty; assert presence then absence |
| **Pass** | First returns {0:3: true}, second returns {} |

### `selectAllUnpaid marks every unpaid seat and nothing else`
| | |
|---|---|
| **Tests** | Select-all respects paid status |
| **Method** | Call with 3 seats, paid map {b: true}; assert a and c selected |
| **Pass** | Returns {a: true, c: true} |

### `collectSelectedItemRefs decodes the string keys back into {seatIdx, itemIdx}`
| | |
|---|---|
| **Tests** | Item selection keys deserialized correctly |
| **Method** | Call with {'0:3': true, '2:1': true}; assert decoded objects |
| **Pass** | Returns array with {seatIdx: 0, itemIdx: 3} and {seatIdx: 2, itemIdx: 1} |

### `collectSelectedItemRefs returns [] for empty / null / undefined`
| | |
|---|---|
| **Tests** | Safe fallback for missing selection state |
| **Method** | Call with {}, null, undefined; assert all return [] |
| **Pass** | All return empty array |

---

## `server-checkout.test.js`
> fetchServerState aggregation, scrubbing, tip-out math, check categorization, API resilience

### `rejects immediately when employeeId is missing`
| | |
|---|---|
| **Tests** | Guard condition prevents API calls without employee identity |
| **Method** | Call fetchServerState({}); assert rejection and no fetchWithTimeout calls |
| **Pass** | Promise rejects with 'missing employee id', fetchWithTimeout never called |

### `rejects when employeeId is an empty string`
| | |
|---|---|
| **Tests** | Empty employee ID treated as missing |
| **Method** | Call fetchServerState({employeeId: ''}); assert rejection |
| **Pass** | Promise rejects with 'missing employee id' |

### `keeps only orders whose server_id matches the employee`
| | |
|---|---|
| **Tests** | Order scrubbing filters by server ownership |
| **Method** | Mock fetch with 3 orders, one matching emp-1, two mismatched; call fetchServerState; assert |
| **Pass** | allOrders has length 1, contains only matching order |

### `returns an empty allOrders array when all orders belong to other servers`
| | |
|---|---|
| **Tests** | All-mismatched orders result in empty state |
| **Method** | Mock fetch with orders for 'other' server; call with 'emp-1'; assert empty |
| **Pass** | allOrders has length 0 |

### `handles a non-array orders response gracefully (returns empty)`
| | |
|---|---|
| **Tests** | Non-array orders response does not crash |
| **Method** | Mock fetch to return null orders; call fetchServerState; assert |
| **Pass** | allOrders has length 0 |

### `keeps checks with matching server_id and checks without any server_id`
| | |
|---|---|
| **Tests** | Check scrubbing asymmetric: match OR absent server_id kept |
| **Method** | Mock fetch with 3 checks (match, mismatch, none); call with emp-1; assert 2 kept |
| **Pass** | checks has length 2, contains c1 and c3 but not c2 |

### `enriches checks with tableLabel from the matching order`
| | |
|---|---|
| **Tests** | Check enrichment pulls table info from order cross-reference |
| **Method** | Mock fetch with check and order sharing ID; call; assert tableLabel set |
| **Pass** | result.checks[0].tableLabel is 'Table 7' |

### `sums tipout percentages across all rules`
| | |
|---|---|
| **Tests** | Tip-out rate aggregates all rules |
| **Method** | Mock tipout with [5%, 3%] rules and net_sales=1000; assert rate and total |
| **Pass** | tipOutRate ≈ 0.08 (8%), tipOutTotal ≈ 80 |

### `computes takeHome = (cardTips + cashTips) − tipOutTotal`
| | |
|---|---|
| **Tests** | Take-home calculation after tip-out deduction |
| **Method** | Mock with net_sales=1000, tips=80, tipout=5%; assert math |
| **Pass** | takeHome ≈ 30 (60 + 20 - 50) |

### `computes cashExpected = cashSales − cardTips`
| | |
|---|---|
| **Tests** | Expected cash balance accounts for card tips paid from cash |
| **Method** | Mock cash_total=200, card_tips=40; assert result |
| **Pass** | cashExpected ≈ 160 (200 - 40) |

### `returns zero rate and tipOutTotal when no rules are defined`
| | |
|---|---|
| **Tests** | Empty tipout rules yield zero rate |
| **Method** | Mock with empty tipout array; assert zero values |
| **Pass** | tipOutRate is 0, tipOutTotal is 0 |

### `handles a rule with a null percentage as 0 (no NaN)`
| | |
|---|---|
| **Tests** | Null percentage treated as 0, prevents NaN propagation |
| **Method** | Mock with [null, 5%] rules and net_sales=200; assert calculation |
| **Pass** | tipOutTotal ≈ 10 (200 * 0.05), not NaN |

### `openChecks contains only status=open checks`
| | |
|---|---|
| **Tests** | Check categorization: open status |
| **Method** | Mock with mixed status checks; call; assert openChecks filtered |
| **Pass** | openChecks has length 1, contains only open-1 |

### `unadjustedChecks contains closed card checks without adjusted flag`
| | |
|---|---|
| **Tests** | Check categorization: closed card, not adjusted |
| **Method** | Mock with mixed checks; call; assert unadjustedChecks filtered |
| **Pass** | unadjustedChecks has length 1, contains only unadj-1 |

### `adjustedChecks contains closed card checks with adjusted:true`
| | |
|---|---|
| **Tests** | Check categorization: closed card, adjusted |
| **Method** | Mock with mixed checks; call; assert adjustedChecks filtered |
| **Pass** | adjustedChecks has length 1, contains only adj-1 |

### `cash checks appear in none of the three special categories`
| | |
|---|---|
| **Tests** | Cash payment checks excluded from card-specific categories |
| **Method** | Mock with mixed checks; call; assert cash-1 not in any special list |
| **Pass** | specialIds does not contain 'cash-1' |

### `no check appears in more than one special category`
| | |
|---|---|
| **Tests** | Check categorization mutually exclusive |
| **Method** | Mock with mixed checks; collect all special category IDs; assert no duplicates |
| **Pass** | Unique count equals total count |

### `defaults to zero rate when the tipout endpoint fails`
| | |
|---|---|
| **Tests** | Tipout fetch failure gracefully falls back |
| **Method** | Mock tipout to reject; call fetchServerState; assert zero result |
| **Pass** | tipOutTotal is 0 |

### `uses a fallback store name when the store endpoint fails`
| | |
|---|---|
| **Tests** | Store name fetch failure uses hardcoded default |
| **Method** | Mock store endpoint to reject; call; assert fallback |
| **Pass** | restaurantName is 'KINDpos/lite' |

---

## `server-landing.test.js`
> Scene registration, checkout button, filter cycling, refresh guard, cleanup, tip adjustment, double-tap

### `registers as 'server-landing'`
| | |
|---|---|
| **Tests** | Scene registered with correct name |
| **Method** | Import module, query registeredScenes by name; assert defined |
| **Pass** | sceneDef is defined, sceneDef.name is 'server-landing' |

### `checkout button mounts server-checkout working scene`
| | |
|---|---|
| **Tests** | Checkout action launches checkout workflow |
| **Method** | Mount, dispatch pointerup on checkoutBtn; assert mountWorking called |
| **Pass** | SceneManager.mountWorking called with 'server-checkout' and staff data |

### `filter cycles OPEN → CLOSED → VOID → OPEN`
| | |
|---|---|
| **Tests** | Filter state cycles through three statuses |
| **Method** | Mount, dispatch pointerup on filterBtn three times; assert state progression |
| **Pass** | state.filter changes OPEN → CLOSED → VOID → OPEN |

### `_refreshing guard prevents a second concurrent fetch`
| | |
|---|---|
| **Tests** | In-flight refresh blocks event-driven refreshes |
| **Method** | Mount with never-resolving fetch, set _refreshing true, trigger event handler; assert no new fetch |
| **Pass** | Fetch call count unchanged after event handler |

### `cleanup nulls state.el and removes all SceneManager listeners`
| | |
|---|---|
| **Tests** | Proper teardown: element nulled and event handlers unregistered |
| **Method** | Mount, call cleanup, assert state and mock calls |
| **Pass** | state.el is null, SceneManager.off called 3 times (order:updated, order:closed, tip:adjusted) |

### `check tile double-tap passes pin to check-overview mountWorking params`
| | |
|---|---|
| **Tests** | PIN threaded through to detail view |
| **Method** | Mount with emp.pin, set allOrders, advance timers, render tiles, double-tap within window; assert |
| **Pass** | SceneManager.mountWorking called with 'check-overview' and pin in params |

### `render exception in renderTips does not prevent renderStats from running`
| | |
|---|---|
| **Tests** | Error isolation: renderTips exception does not block renderStats |
| **Method** | Mount, force renderTips to throw by nulling unadjBadge, trigger refresh event; assert renderStats ran |
| **Pass** | scGuests.setValue called after renderTips exception |

### `tip row pointerup opens inline tip-numpad (scrim + card appended to body)`
| | |
|---|---|
| **Tests** | Tip adjustment modal appears on tip row tap |
| **Method** | Mount, mock fetch with check data, dispatch pointerup on tipList first child; assert DOM growth |
| **Pass** | document.body.children.length increased by 2 (scrim + card) |

### `fetch rejection clears _refreshing so a subsequent refresh is not blocked`
| | |
|---|---|
| **Tests** | Error path releases refresh guard for retry |
| **Method** | Mount with rejecting fetch; await; set up new fetch; trigger event; assert second fetch fires |
| **Pass** | _refreshing is false after rejection, second fetch call count increases |

### `cleanup during in-flight refresh: state.el null-check blocks post-teardown render`
| | |
|---|---|
| **Tests** | Post-cleanup render prevented by state.el guard |
| **Method** | Mount with never-resolving fetch, call cleanup, resolve fetch, await; assert no post-cleanup render |
| **Pass** | scGuests.setValue not called (no render after cleanup) |

### `double-tap within timeout opens check-overview`
| | |
|---|---|
| **Tests** | Rapid tile double-tap within 300ms launches detail view |
| **Method** | Use fake timers; mount, advance past guard, tap tile twice within window; assert mountWorking |
| **Pass** | SceneManager.mountWorking called with 'check-overview' and checkId |

### `double-tap after timeout deselects the tile instead of opening check-overview`
| | |
|---|---|
| **Tests** | Slow second tap toggles selection instead of opening |
| **Method** | Use fake timers; mount, advance past guard, tap once, advance 400ms, tap again; assert |
| **Pass** | selectedIds does not contain order, SceneManager.mountWorking not called |

---

## `transitions.test.js`
> Check-overview ↔ order-entry parameter shape contracts

### `threads orderId, checkNumber, employee context, and returnTo`
| | |
|---|---|
| **Tests** | buildOrderEntryParams correctly maps all handoff fields |
| **Method** | Call with state (orderId, checkNumber, seats, selected) and params (ids, names, pin, returnLanding); assert output |
| **Pass** | recallOrderId, recallCheckNumber, employee fields, returnTo, returnParams all present and correct |

### `brand-new check (orderId null) → recallOrderId is null, not undefined`
| | |
|---|---|
| **Tests** | Fresh check safety: null fallback on nil order ID |
| **Method** | Call buildOrderEntryParams with orderId null; assert explicit null (not undefined) |
| **Pass** | recallOrderId is null, recallCheckNumber is null |

### `passes seat numbers in order so order-entry can restore the seat layout`
| | |
|---|---|
| **Tests** | Seat count preserved across transition |
| **Method** | Call with 3 seats [1, 2, 3]; assert seatNumbers array |
| **Pass** | seatNumbers is [1, 2, 3] |

### `selectedSeatNumbers contains only seats flagged in state.selected`
| | |
|---|---|
| **Tests** | Selected seat filtering |
| **Method** | Call with selected {a: true, c: true}; assert subset |
| **Pass** | selectedSeatNumbers is [1, 3] |

### `handles empty / undefined state without throwing`
| | |
|---|---|
| **Tests** | Safe handling of nil state |
| **Method** | Call buildOrderEntryParams(undefined, undefined) and ({}, {}); assert no throw and default values |
| **Pass** | No exception, seatNumbers [], selectedSeatNumbers [], recallOrderId null |

### `prefers currentOrderId (order POSTed during the session)`
| | |
|---|---|
| **Tests** | buildCheckOverviewParams prioritizes fresh order ID over recall |
| **Method** | Call with currentOrderId 'fresh-ord' and recallOrderId 'stale-ord'; assert preference |
| **Pass** | checkId is 'fresh-ord' |

### `falls back to sceneParams.recallOrderId if no order was POSTed (user left immediately)`
| | |
|---|---|
| **Tests** | Fallback to initial order when session produced no new order |
| **Method** | Call buildCheckOverviewParams(null, {recallOrderId: 'orig-ord'}); assert |
| **Pass** | checkId is 'orig-ord' |

### `checkId is null (never undefined) when neither id is available — brand-new empty check`
| | |
|---|---|
| **Tests** | New check safety: null not undefined |
| **Method** | Call buildCheckOverviewParams(null, {}); assert explicit null |
| **Pass** | checkId is null |

### `threads employee + PIN so check-overview does NOT re-prompt for manager PIN`
| | |
|---|---|
| **Tests** | Manager context preserved across transition |
| **Method** | Call with pin, employeeId, employeeName; assert all present in result |
| **Pass** | pin, employeeId, employeeName all threaded through |



---

# Frontend Tests (Overseer)

## `date-picker.test.js`
> Tests for the date picker and date range picker components covering navigation, input selection, and range presets.

### `buildDatePicker > renders prev / next / label in a wrapper`
| | |
|---|---|
| **Tests** | DOM structure contains three children: previous button (◀), formatted date label, and next button (▶) |
| **Method** | DOM queries on picker.children; textContent assertions on button/label elements |
| **Pass** | prev.textContent === '◀', next.textContent === '▶', label matches formatted date (Apr 22, 2026) |

### `buildDatePicker > next button is disabled when current date is today`
| | |
|---|---|
| **Tests** | Navigation is locked at current date; next button disabled when value equals today |
| **Method** | Set picker value to today's date, query next button disabled property |
| **Pass** | next.disabled === true |

### `buildDatePicker > prev shifts the date back 1 day and fires onChange`
| | |
|---|---|
| **Tests** | Clicking prev button decrements date by one day and invokes onChange callback |
| **Method** | vi.fn() mock for onChange, click prev button, check mock call and label text |
| **Pass** | onChange called with '2026-04-21', label text updates to Apr 21, 2026 |

### `buildDatePicker > next shifts the date forward 1 day when not at today`
| | |
|---|---|
| **Tests** | Clicking next button increments date until reaching today (then disabled); onChange fires per click |
| **Method** | Set value to 2 days ago, click next twice, track onChange calls and disabled state |
| **Pass** | First next call → onChange with 1 day ago, disabled still false; second call → onChange with today, disabled becomes true |

### `buildDatePicker > clicking the label swaps in a native date input focused at the current value`
| | |
|---|---|
| **Tests** | Label click replaces label span with <input type=date> showing current value |
| **Method** | DOM manipulation via click event, query picker.children[1] tagName and type |
| **Pass** | swapped element is INPUT, type='date', value='2026-04-22' |

### `buildDatePicker > picking a new date from the native input fires onChange and restores the label`
| | |
|---|---|
| **Tests** | Changing native input value triggers onChange and swaps input back to formatted label |
| **Method** | Click label to show input, set input.value, dispatch change event, inspect restored label |
| **Pass** | onChange called with '2026-04-15', label restored as SPAN with text matching Apr 15, 2026 |

### `buildDateRangePicker > renders two native date inputs, a separator, and 7d/14d/30d presets`
| | |
|---|---|
| **Tests** | DOM contains exactly 2 date inputs with correct initial values and 3 preset buttons |
| **Method** | DOM queries for input[type="date"] and button elements, textContent assertions |
| **Pass** | inputs.length === 2, inputs[0].value === '2026-04-15', inputs[1].value === '2026-04-22', button texts are ['7d', '14d', '30d'] |

### `buildDateRangePicker > editing start fires onChange with both ends`
| | |
|---|---|
| **Tests** | Changing start date fires onChange with object containing both start and end dates |
| **Method** | vi.fn() onChange mock, set startInput.value, dispatch change event |
| **Pass** | onChange called with { start: '2026-04-10', end: '2026-04-22' } |

### `buildDateRangePicker > editing end fires onChange with both ends`
| | |
|---|---|
| **Tests** | Changing end date fires onChange with object containing both start and end dates |
| **Method** | vi.fn() onChange mock, set endInput.value, dispatch change event |
| **Pass** | onChange called with { start: '2026-04-15', end: '2026-04-21' } |

### `buildDateRangePicker > auto-clamps end when start is moved past it`
| | |
|---|---|
| **Tests** | Moving start date after end automatically clamps end to start value |
| **Method** | Set startInput to '2026-04-25' after end='2026-04-22', check onChange and endInput.value |
| **Pass** | onChange called with { start: '2026-04-25', end: '2026-04-25' }, endInput.value updated to '2026-04-25' |

### `buildDateRangePicker > auto-clamps start when end is moved before it`
| | |
|---|---|
| **Tests** | Moving end date before start automatically clamps start to end value |
| **Method** | Set endInput to '2026-04-10' before start='2026-04-15', check onChange and startInput.value |
| **Pass** | onChange called with { start: '2026-04-10', end: '2026-04-10' }, startInput.value updated to '2026-04-10' |

### `buildDateRangePicker > presets anchor the range at today`
| | |
|---|---|
| **Tests** | Clicking 7d/14d/30d preset buttons sets range anchored at today (today as end, past as start) |
| **Method** | vi.fn() onChange mock, click each preset button, verify onChange calls and input values |
| **Pass** | 7d click → onChange { start: today-7d, end: today }, 14d click → { start: today-14d, end: today }, 30d click → { start: today-30d, end: today }; inputs reflect last (30d) press |

## `scene-manager.test.js`
> Tests for SceneManager navigation fix ensuring unmount receives container and throwing cleanup/unmount does not trap navigation.

### `scene-manager > scene.unmount receives the stored container argument (not undefined)`
| | |
|---|---|
| **Tests** | Scene unmount method called with the actual container DOM element, not undefined |
| **Method** | Register scene with mount/unmount lifecycle, mount then unmount, inspect handle.unmountArg |
| **Pass** | handle.unmountCalls === 1, handle.unmountArg === mountedContainer (DOM element) |

### `scene-manager > a throwing unmount does NOT block the next mountWorking (navigation stays unblocked)`
| | |
|---|---|
| **Tests** | Exception in unmount is caught; next mountWorking proceeds without rethrowing |
| **Method** | Mock console.error, register buggy scene with throwing unmount, mount it, mount next scene |
| **Pass** | nextHandle.mountCalls === 1, SceneManager.getActiveWorking() === 'w-next' (navigation unblocked) |

### `scene-manager > a throwing cleanup is also caught; container still removed, _workingScene cleared`
| | |
|---|---|
| **Tests** | Exception in cleanup function (returned from mount) is caught; orphaned container removed; next mount succeeds |
| **Method** | Register scene with cleanup that throws, mount it, mount next scene, check for stale container |
| **Pass** | querySelector for old container returns null, nextHandle.mountCalls === 1, SceneManager.getActiveWorking() === 'w-fresh' |

## `sample-payroll.test.js`
> Tests for payroll data loader ensuring totalWages and totalTips are computed and always numeric (never undefined).

### `sample-payroll > loadPayrollData populates totalWages and totalTips (2dp rounded) from the per-employee rows`
| | |
|---|---|
| **Tests** | Fetch resolves with employee payroll data; totalWages and totalTips summed from per-employee gross_pay and tips |
| **Method** | vi.fn() fetch mock returning JSON response, dynamic import of module, read PAYROLL_SUMMARY live binding |
| **Pass** | PAYROLL_SUMMARY.laborSummary.totalWages === 1190.75, totalTips === 36.05, both Number.isFinite() === true |

### `sample-payroll > empty employees array → totalWages and totalTips are 0, not undefined`
| | |
|---|---|
| **Tests** | Fetch resolves with empty employees array; totals default to 0, not undefined |
| **Method** | vi.fn() fetch mock with empty employees, import and loadPayrollData(), check PAYROLL_SUMMARY |
| **Pass** | totalWages === 0, totalTips === 0 |

### `sample-payroll > loader-failure path preserves the numeric shape (no undefined reaching fmt$)`
| | |
|---|---|
| **Tests** | Fetch rejects with error; catch block repopulates from local fixture; totals remain numeric zeros |
| **Method** | vi.fn() fetch mock rejecting TypeError, check laborSummary fields are numbers and not NaN |
| **Pass** | ls.totalWages and ls.totalTips are typeof 'number', Number.isNaN() === false for both |

### `sample-payroll > res.ok === false (e.g. 500) leaves the prior summary untouched (numeric shape preserved)`
| | |
|---|---|
| **Tests** | HTTP 500 response early-returns without reassigning summary; numeric shape preserved |
| **Method** | vi.fn() fetch mock returning 500 status, check PAYROLL_SUMMARY fields remain numeric |
| **Pass** | typeof ls.totalWages === 'number', typeof ls.totalTips === 'number' |

## `employee-events.test.js`
> Tests for employee event payload builders (PIN reset, employee update, employee create) ensuring correct wire format for /config/push.

### `buildPinResetPayload > sends the REAL new PIN (not a placeholder hash)`
| | |
|---|---|
| **Tests** | Payload contains actual PIN string, not placeholder like 'SHA256_SIMULATED' |
| **Method** | Call buildPinResetPayload('e42', '4321', true), inspect payload.pin and property absence |
| **Pass** | payload.pin === '4321', payload does not have new_pin_hash property |

### `buildPinResetPayload > includes the employee id, force flag, and a reason string`
| | |
|---|---|
| **Tests** | Payload structure matches backend expectation: employee_id, pin, force_change_on_login, reset_reason |
| **Method** | Call buildPinResetPayload with test employee id and pin, compare exact object shape |
| **Pass** | Result equals { employee_id: 'e1', pin: '1234', force_change_on_login: false, reset_reason: 'Manager-initiated reset' } |

### `buildPinResetPayload > coerces truthy/falsy force-change inputs to booleans`
| | |
|---|---|
| **Tests** | Various truthy/falsy values coerced to boolean force_change_on_login |
| **Method** | Call with undefined, null, and truthy (1) inputs, check resulting boolean |
| **Pass** | undefined → false, null → false, 1 → true |

### `buildPinResetPayload > accepts both auto-generated (4-digit) and custom (up to 6-digit) PINs`
| | |
|---|---|
| **Tests** | PIN parameter accepts 4–6 digit numeric strings |
| **Method** | Call with '1234' and '654321' PINs, match against /^\d{4,6}$/ regex |
| **Pass** | Both cases match regex /^\d{4,6}$/ |

### `buildEmployeeUpdatePayload (edit-without-reset) > does NOT include `pin` — preserves the existing hashed PIN on the backend`
| | |
|---|---|
| **Tests** | Update payload omits pin field to avoid overwriting server-side hash on edit-only path |
| **Method** | Call buildEmployeeUpdatePayload with employee object, check payload property |
| **Pass** | payload does not have pin property |

### `buildEmployeeUpdatePayload (edit-without-reset) > produces the exact shape /config/push consumes`
| | |
|---|---|
| **Tests** | Payload structure exactly matches /config/push endpoint expectations |
| **Method** | Call with sample employee { id, firstName, lastName, roles, payRate, status }, compare shape |
| **Pass** | Result equals { employee_id: 'e7', first_name: 'Mel', last_name: 'Manager', display_name: 'Mel Manager', role_ids: ['manager', 'server'], hourly_rate: 18.5, active: true } |

### `buildEmployeeUpdatePayload (edit-without-reset) > active flips to false for any non-active status`
| | |
|---|---|
| **Tests** | Employee status 'inactive' or 'do_not_rehire' maps to active: false |
| **Method** | Call with status variants, check active property |
| **Pass** | status='inactive' → active=false, status='do_not_rehire' → active=false |

### `buildEmployeeCreatePayload > carries the plaintext pin (hashed server-side by /config/push)`
| | |
|---|---|
| **Tests** | Create payload includes plaintext PIN which backend hashes; employee_id and active flags set |
| **Method** | Call with employee object and PIN string, check payload structure |
| **Pass** | payload.pin === '9876', payload.employee_id === 'e9', payload.active === true |

## `employees.test.js`
> Integration tests for PIN-reset modal in employee management section, pinning user flow from row button to payload generation.

### `PIN-reset modal > "Reset PIN" row button opens the PIN-reset modal`
| | |
|---|---|
| **Tests** | Clicking "Reset PIN" button on employee row invokes openModal with correct title |
| **Method** | Register employee section, mount onEnter, find "Reset PIN" button, click and inspect openModal call |
| **Pass** | openModal called once, modalArgs.title matches /Reset PIN/i |

### `PIN-reset modal > footer "Reset PIN" button (random method) calls buildPinResetPayload with a numeric PIN`
| | |
|---|---|
| **Tests** | Modal footer reset button calls buildPinResetPayload with employee id, generated PIN, and force-change flag |
| **Method** | vi.fn() mock of buildPinResetPayload, click row button to open modal, click footer reset button, inspect mock calls |
| **Pass** | buildPinResetPayloadMock called once with (empId='emp-01', pin matches /^\d{4,6}$/, forceChange=true) |

### `PIN-reset modal > invalid custom PIN (< 4 digits) shows validation toast, no buildPinResetPayload call`
| | |
|---|---|
| **Tests** | Entering custom PIN with < 4 digits shows error toast and does not invoke payload builder |
| **Method** | Mock chipGroup to return ['custom'], set custom input to '12', click reset button, check showToast and builder mock |
| **Pass** | showToast called with error message containing '4', buildPinResetPayloadMock not called |

## `labor-reports.test.js`
> Tests for overtime calculation in labor reports, pinning federal OT rule (weekly_hours > 40, not daily hours) at KPI and row level.

### `labor-reports > weekly_hours > 40 lights up per-employee OT (daily `hours` is irrelevant)`
| | |
|---|---|
| **Tests** | Employee with weekly 50 hours shows 10h OT, daily 8h does not trigger OT |
| **Method** | vi.fn() fetch mock returning labor payload, buildLaborReportsScene, query rowOvertime and kpiOvertimeValue |
| **Pass** | rowOvertime('Alice') === '10.00h', kpiOvertimeValue() === '10.00h' |

### `labor-reports > weekly_hours ≤ 40 shows no overtime, even when daily `hours` is huge`
| | |
|---|---|
| **Tests** | Employee with weekly 30 hours shows no OT despite pulling one 50h shift today |
| **Method** | vi.fn() fetch mock with employee {hours: 50, weekly_hours: 30}, query rowOvertime and kpiOvertimeValue |
| **Pass** | rowOvertime('Bob') === '—', kpiOvertimeValue() === '0.00h' |

### `labor-reports > KPI OT total equals sum of per-employee OT across the roster`
| | |
|---|---|
| **Tests** | Aggregate OT (Alice 10 + Cara 5 + Dan 0 = 15) matches KPI card and all rows in lockstep |
| **Method** | vi.fn() fetch mock with multi-employee roster, query rowOvertime per person and kpiOvertimeValue |
| **Pass** | Alice row '10.00h', Cara row '5.00h', Dan row '—', KPI '15.00h' |

## `auth-client.test.js`
> Tests for token storage and fetch interceptor, pinning overseer-specific session key and 401/403 pass-through (no retry).

### `auth-client > setToken/getToken/clearToken roundtrip under the overseer-specific storage key`
| | |
|---|---|
| **Tests** | Token lifecycle uses 'kindpos.overseer.session' key, independent from terminal's 'kindpos.session' |
| **Method** | Call setToken, getToken, clearToken; check sessionStorage keys |
| **Pass** | After setToken: getToken() === 'ov-abc', sessionStorage.getItem('kindpos.overseer.session') truthy, sessionStorage.getItem('kindpos.session') null; after clearToken: getToken() === null |

### `auth-client > attaches Authorization: Bearer <token> on /api/* when a token is stored`
| | |
|---|---|
| **Tests** | Fetch interceptor adds Authorization header with stored token for /api/* requests |
| **Method** | vi.fn() fetch mock, setToken, call window.fetch with /api route, inspect init.headers |
| **Pass** | init.headers.get('Authorization') === 'Bearer tok-1' |

### `auth-client > on 401, returns the response directly with no prompt and no retry`
| | |
|---|---|
| **Tests** | 401 response passes through without triggering PIN prompt or fetch retry |
| **Method** | vi.fn() fetch mock returning 401, spy window.prompt, call fetch, check spy and response |
| **Pass** | prompt not called, fetchMock called once, res.status === 401 |

### `auth-client > on 403, returns the response directly with no prompt and no retry`
| | |
|---|---|
| **Tests** | 403 response passes through without triggering PIN prompt or fetch retry |
| **Method** | vi.fn() fetch mock returning 403, spy window.prompt, call fetch, check spy and response |
| **Pass** | prompt not called, fetchMock called once, res.status === 403 |

## `config-push.test.js`
> Tests for single egress point of all config writes (/api/v1/config/push), pinning wire format and error handling.

### `config-push > empty events → no fetch, resolves { ok: true, events_written: 0 }`
| | |
|---|---|
| **Tests** | Null/undefined/empty array inputs short-circuit; no HTTP request made |
| **Method** | vi.fn() fetch mock, call pushChanges with [], null, undefined, check fetchMock and result |
| **Pass** | pushChanges([]) → { ok: true, events_written: 0 }, pushChanges(null/undefined) → same, fetchMock not called |

### `config-push > POSTs to /api/v1/config/push with an array of {event_type, payload} entries`
| | |
|---|---|
| **Tests** | POST request to correct endpoint with events array in JSON body; response.events_written returned |
| **Method** | vi.fn() fetch mock, call pushChanges with 2 events, inspect URL, method, content-type, and body |
| **Pass** | URL === '/api/v1/config/push', method === 'POST', headers['Content-Type'] === 'application/json', body matches input events array, result.events_written === 2 |

### `config-push > strips extraneous fields on events — only event_type + payload are sent`
| | |
|---|---|
| **Tests** | Input events with client_timestamp, retry_count, id are filtered; only event_type and payload POSTed |
| **Method** | vi.fn() fetch mock, call pushChanges with padded event, parse posted body |
| **Pass** | Posted body[0] === { event_type, payload }, no client_timestamp/retry_count/id properties |

### `config-push > non-ok response → { ok: false, error: "Server responded <status>" } (no throw)`
| | |
|---|---|
| **Tests** | HTTP 400 response returns error object without throwing; caller can retry |
| **Method** | vi.fn() fetch mock returning 400, call pushChanges, check result |
| **Pass** | result.ok === false, result.error matches /400/ |

### `config-push > network error → { ok: false, error: <message> } (no throw, callers can retry)`
| | |
|---|---|
| **Tests** | Fetch rejection (TypeError) returns error object without throwing; caller can retry |
| **Method** | vi.fn() fetch mock rejecting TypeError('NetworkError'), call pushChanges, check result |
| **Pass** | result.ok === false, result.error === 'NetworkError' |

## `excel-parser.test.js`
> Tests for menu template Excel parser, covering utility functions (parsePrice, splitList, norm, _parseMustAlsoPick), summary extraction, and full workbook parsing with XLSX mock.

### `parsePrice > parses a plain numeric string`
| | |
|---|---|
| **Tests** | Pure function converts numeric string to number |
| **Method** | Call parsePrice('5.99') |
| **Pass** | Returns 5.99 |

### `parsePrice > strips a leading dollar sign`
| | |
|---|---|
| **Tests** | Dollar sign prefix removed before parsing |
| **Method** | Call parsePrice('$12.50') |
| **Pass** | Returns 12.50 |

### `parsePrice > handles an integer string`
| | |
|---|---|
| **Tests** | Integer string parsed to number with .0 decimal |
| **Method** | Call parsePrice('10') |
| **Pass** | Returns 10.0 |

### `parsePrice > returns 0 for an empty string`
| | |
|---|---|
| **Tests** | Empty string defaults to 0 |
| **Method** | Call parsePrice('') |
| **Pass** | Returns 0.0 |

### `parsePrice > returns 0 for null / undefined`
| | |
|---|---|
| **Tests** | Nullish inputs default to 0 |
| **Method** | Call parsePrice(null) and parsePrice(undefined) |
| **Pass** | Both return 0.0 |

### `parsePrice > returns 0 for non-numeric text`
| | |
|---|---|
| **Tests** | Non-numeric string defaults to 0 |
| **Method** | Call parsePrice('N/A') |
| **Pass** | Returns 0.0 |

### `parsePrice > parses a negative price`
| | |
|---|---|
| **Tests** | Negative numeric string parsed correctly |
| **Method** | Call parsePrice('-2.00') |
| **Pass** | Returns -2.0 |

### `splitList > splits a comma-separated string into trimmed entries`
| | |
|---|---|
| **Tests** | CSV parsed and whitespace trimmed from each segment |
| **Method** | Call splitList('A, B, C') |
| **Pass** | Returns ['A', 'B', 'C'] |

### `splitList > drops blank segments from consecutive commas`
| | |
|---|---|
| **Tests** | Empty segments (,, or trailing comma) filtered out |
| **Method** | Call splitList('X,,Y') |
| **Pass** | Returns ['X', 'Y'] |

### `splitList > returns [] for an empty string`
| | |
|---|---|
| **Tests** | Empty string returns empty array |
| **Method** | Call splitList('') |
| **Pass** | Returns [] |

### `splitList > returns [] for null`
| | |
|---|---|
| **Tests** | Null input returns empty array |
| **Method** | Call splitList(null) |
| **Pass** | Returns [] |

### `splitList > handles a single item with no commas`
| | |
|---|---|
| **Tests** | Single item without delimiter returns array with one element |
| **Method** | Call splitList('Pepperoni') |
| **Pass** | Returns ['Pepperoni'] |

### `splitList > trims whitespace around each item`
| | |
|---|---|
| **Tests** | Leading/trailing whitespace removed from all segments |
| **Method** | Call splitList('  Cheese ,  Ham  ') |
| **Pass** | Returns ['Cheese', 'Ham'] |

### `norm > lowercases the input`
| | |
|---|---|
| **Tests** | String converted to lowercase |
| **Method** | Call norm('HELLO') |
| **Pass** | Returns 'hello' |

### `norm > strips trailing asterisk from header names`
| | |
|---|---|
| **Tests** | Asterisk suffix removed (common in Excel header conventions) |
| **Method** | Call norm('Item Name *') |
| **Pass** | Returns 'item name' |

### `norm > strips question marks`
| | |
|---|---|
| **Tests** | Question marks removed |
| **Method** | Call norm('Active?') |
| **Pass** | Returns 'active' |

### `norm > collapses multiple spaces into one`
| | |
|---|---|
| **Tests** | Consecutive spaces reduced to single space |
| **Method** | Call norm('Item  Name') |
| **Pass** | Returns 'item name' |

### `norm > strips parentheses`
| | |
|---|---|
| **Tests** | Parenthetical text removed |
| **Method** | Call norm('Price (Y/N)') |
| **Pass** | Returns 'price y/n' |

### `norm > strips newlines and normalises whitespace`
| | |
|---|---|
| **Tests** | Newlines removed and whitespace normalized |
| **Method** | Call norm('Price *\n($0.00 if free)') |
| **Pass** | Returns 'price $0.00 if free' |

### `_parseMustAlsoPick > returns [] for empty string`
| | |
|---|---|
| **Tests** | Empty string returns empty array |
| **Method** | Call _parseMustAlsoPick('') |
| **Pass** | Returns [] |

### `_parseMustAlsoPick > returns [] for null / undefined`
| | |
|---|---|
| **Tests** | Nullish inputs return empty array |
| **Method** | Call _parseMustAlsoPick(null) and _parseMustAlsoPick(undefined) |
| **Pass** | Both return [] |

### `_parseMustAlsoPick > parses a single item with price`
| | |
|---|---|
| **Tests** | Single item with parenthetical price parsed into name and price fields |
| **Method** | Call _parseMustAlsoPick('8" GF ($2.00)') |
| **Pass** | Returns [{ name: '8" GF', price: 2.0 }] |

### `_parseMustAlsoPick > parses multiple items separated by commas`
| | |
|---|---|
| **Tests** | CSV with price per item parsed into array of objects |
| **Method** | Call _parseMustAlsoPick('Small ($0.00), Large ($3.50)') |
| **Pass** | Returns [{ name: 'Small', price: 0.0 }, { name: 'Large', price: 3.5 }] |

### `_parseMustAlsoPick > falls back to name-only with price 0 for items without price parens`
| | |
|---|---|
| **Tests** | Items without price parentheses default to price 0 |
| **Method** | Call _parseMustAlsoPick('Plain item') |
| **Pass** | Returns [{ name: 'Plain item', price: 0.0 }] |

### `_parseMustAlsoPick > handles items with $-sign inside parens`
| | |
|---|---|
| **Tests** | Dollar sign inside price parens parsed correctly |
| **Method** | Call _parseMustAlsoPick('Sauce ($1.25)'), check price field |
| **Pass** | result[0].price === 1.25 |

### `_parseMustAlsoPick > filters out blank entries`
| | |
|---|---|
| **Tests** | Empty segments (trailing comma) do not produce zero-length name entries |
| **Method** | Call _parseMustAlsoPick('Cheese ($0.00)'), verify every entry has name.length > 0 |
| **Pass** | result.every(x => x.name.length > 0) === true |

### `getSummary > returns the restaurant name from restaurant_info`
| | |
|---|---|
| **Tests** | Extract restaurant name from nested restaurant_info dict |
| **Method** | Call getSummary({ restaurant_info: { 'Restaurant Name': 'Luigi's' } }) |
| **Pass** | result.restaurant_name === 'Luigi's' |

### `getSummary > returns Unknown when restaurant_info is empty`
| | |
|---|---|
| **Tests** | Missing/empty restaurant_info defaults to 'Unknown' |
| **Method** | Call getSummary({}) |
| **Pass** | result.restaurant_name === 'Unknown' |

### `getSummary > returns the tax rate from the first tax rule`
| | |
|---|---|
| **Tests** | Extract tax rate from first element of tax_rules array |
| **Method** | Call getSummary({ tax_rules: [{ rate: 0.08 }] }) |
| **Pass** | result.tax_rate === 0.08 |

### `getSummary > counts categories, items, staff, and discounts`
| | |
|---|---|
| **Tests** | Count array lengths for menu structure objects |
| **Method** | Call getSummary with populated categories, items, staff, discounts, option_groups, portion_options |
| **Pass** | categories_count===1, items_count===3, staff_count===2, discounts_count===1, choices_count===2, groups_count===1, portion_options_count===1 |

### `getSummary > defaults to 0 counts for missing arrays`
| | |
|---|---|
| **Tests** | Missing array fields default to 0 count |
| **Method** | Call getSummary({}) |
| **Pass** | categories_count===0, items_count===0, choices_count===0, tax_rate===0 |

### `parseMenuTemplate — error handling > returns success:false and error message when arrayBuffer() throws`
| | |
|---|---|
| **Tests** | File read failure returns error in result.errors array |
| **Method** | Mock file.arrayBuffer() to reject, call parseMenuTemplate(file) |
| **Pass** | result.success === false, result.errors includes message matching 'Failed to read file' |

### `parseMenuTemplate — error handling > returns success:false when required sheets are missing`
| | |
|---|---|
| **Tests** | Workbook without required sheet names returns error list |
| **Method** | Mock XLSX.read to return workbook with empty Sheets, call parseMenuTemplate |
| **Pass** | result.success === false, result.errors contains 'Missing sheet: RESTAURANT INFO', 'Missing sheet: CATEGORIES', 'Missing sheet: ITEMS' |

### `parseMenuTemplate — valid workbook > returns success:true when all required sheets are valid`
| | |
|---|---|
| **Tests** | Well-formed workbook with all required sheets returns success |
| **Method** | Mock XLSX.read and sheet_to_json for valid data, call parseMenuTemplate |
| **Pass** | result.success === true, result.errors.length === 0 |

### `parseMenuTemplate — valid workbook > parses restaurant name from RESTAURANT INFO`
| | |
|---|---|
| **Tests** | Extract restaurant name from RESTAURANT INFO sheet |
| **Method** | Mock sheets to return restaurant data, call parseMenuTemplate, check result.data |
| **Pass** | result.data.restaurant_info['Restaurant Name'] === 'Taco Town' |

### `parseMenuTemplate — valid workbook > parses category name and active flag from CATEGORIES`
| | |
|---|---|
| **Tests** | Extract category objects with name and active status |
| **Method** | Mock CATEGORIES sheet with category row, call parseMenuTemplate |
| **Pass** | result.data.categories.length === 1, categories[0].name === 'Tacos', categories[0].active === true |

### `parseMenuTemplate — valid workbook > parses item name and price from ITEMS`
| | |
|---|---|
| **Tests** | Extract menu items with name and price fields |
| **Method** | Mock ITEMS sheet with item row, call parseMenuTemplate |
| **Pass** | result.data.items.length === 1, items[0].name === 'Classic Taco', items[0].price === 4.99 |

### `parseMenuTemplate — valid workbook > parses staff member with role detection`
| | |
|---|---|
| **Tests** | Extract staff members with role and PIN fields |
| **Method** | Mock STAFF sheet with staff row, call parseMenuTemplate |
| **Pass** | result.data.staff.length === 1, staff[0].role === 'manager', staff[0].pin === '1234' |

### `parseMenuTemplate — valid workbook > derives tax rate from RESTAURANT INFO`
| | |
|---|---|
| **Tests** | Extract and convert tax rate from RESTAURANT INFO sheet |
| **Method** | Mock RESTAURANT INFO with tax rate row, call parseMenuTemplate |
| **Pass** | result.data.tax_rules[0].rate === 8.25 |

## `money.test.js`
> Pure formatter unit tests for currency, percentage, integer, and basis-point display functions.

### `fmt > formats a typical dollar amount with comma separator`
| | |
|---|---|
| **Tests** | Large number formatted with thousands separator and 2 decimal places |
| **Method** | Call fmt(38417.22) |
| **Pass** | Returns '$38,417.22' |

### `fmt > formats zero`
| | |
|---|---|
| **Tests** | Zero displays as $0.00 |
| **Method** | Call fmt(0) |
| **Pass** | Returns '$0.00' |

### `fmt > treats null as zero`
| | |
|---|---|
| **Tests** | Nullish values default to $0.00 |
| **Method** | Call fmt(null) |
| **Pass** | Returns '$0.00' |

### `fmt > treats undefined as zero`
| | |
|---|---|
| **Tests** | Undefined defaults to $0.00 |
| **Method** | Call fmt(undefined) |
| **Pass** | Returns '$0.00' |

### `fmt > formats negative values with a minus sign`
| | |
|---|---|
| **Tests** | Negative amount shows minus before dollar sign |
| **Method** | Call fmt(-50) |
| **Pass** | Returns '-$50.00' |

### `fmt > signed:true prepends + for positive values`
| | |
|---|---|
| **Tests** | signed option adds + prefix to positive numbers |
| **Method** | Call fmt(2976.14, { signed: true }) |
| **Pass** | Returns '+$2,976.14' |

### `fmt > signed:true keeps minus for negative values`
| | |
|---|---|
| **Tests** | signed option preserves minus for negatives |
| **Method** | Call fmt(-50, { signed: true }) |
| **Pass** | Returns '-$50.00' |

### `fmt > signed:true shows no sign for zero`
| | |
|---|---|
| **Tests** | signed option omits sign prefix for zero |
| **Method** | Call fmt(0, { signed: true }) |
| **Pass** | Returns '$0.00' |

### `fmt > compact:true abbreviates 1k–9.9k with one decimal`
| | |
|---|---|
| **Tests** | compact option shortens 1000–9999 to X.Xk notation |
| **Method** | Call fmt(3800, { compact: true }) |
| **Pass** | Returns '$3.8k' |

### `fmt > compact:true abbreviates >= 10k with no decimal`
| | |
|---|---|
| **Tests** | compact option shortens >= 10000 to Xk notation (no decimal) |
| **Method** | Call fmt(38417.22, { compact: true }) |
| **Pass** | Returns '$38k' |

### `fmt > compact:true abbreviates exactly 10k with no decimal`
| | |
|---|---|
| **Tests** | Boundary case at exactly 10000 uses no-decimal k notation |
| **Method** | Call fmt(10000, { compact: true }) |
| **Pass** | Returns '$10k' |

### `fmt > compact:true leaves sub-1000 values unabbreviated`
| | |
|---|---|
| **Tests** | compact option does not abbreviate amounts under 1000 |
| **Method** | Call fmt(999.99, { compact: true }) |
| **Pass** | Returns '$999.99' |

### `fmt > dp:0 suppresses decimal places`
| | |
|---|---|
| **Tests** | dp (decimal places) option set to 0 removes .XX suffix |
| **Method** | Call fmt(1842, { dp: 0 }) |
| **Pass** | Returns '$1,842' |

### `fmt > dp:0 still applies comma separator`
| | |
|---|---|
| **Tests** | dp:0 retains thousands grouping |
| **Method** | Call fmt(1234567, { dp: 0 }) |
| **Pass** | Returns '$1,234,567' |

### `fmt > small value below 1 formats correctly`
| | |
|---|---|
| **Tests** | Fractional amounts display with 2 decimal places |
| **Method** | Call fmt(0.5) |
| **Pass** | Returns '$0.50' |

### `fmtPct > converts a fraction to a percentage string`
| | |
|---|---|
| **Tests** | Decimal fraction multiplied by 100 and formatted as percentage |
| **Method** | Call fmtPct(0.184) |
| **Pass** | Returns '18.4%' |

### `fmtPct > formats zero fraction as 0.0%`
| | |
|---|---|
| **Tests** | Zero fraction displays as 0.0% |
| **Method** | Call fmtPct(0) |
| **Pass** | Returns '0.0%' |

### `fmtPct > treats null as zero`
| | |
|---|---|
| **Tests** | Null defaults to 0.0% |
| **Method** | Call fmtPct(null) |
| **Pass** | Returns '0.0%' |

### `fmtPct > signed:true prepends + for positive fractions`
| | |
|---|---|
| **Tests** | signed option adds + prefix to positive percentages |
| **Method** | Call fmtPct(0.10, { signed: true }) |
| **Pass** | Returns '+10.0%' |

### `fmtPct > signed:true keeps minus for negative fractions`
| | |
|---|---|
| **Tests** | signed option preserves minus for negative percentages |
| **Method** | Call fmtPct(-0.05, { signed: true }) |
| **Pass** | Returns '-5.0%' |

### `fmtPct > signed:true shows no sign for zero`
| | |
|---|---|
| **Tests** | signed option omits sign for zero percentage |
| **Method** | Call fmtPct(0, { signed: true }) |
| **Pass** | Returns '0.0%' |

### `fmtPct > dp:2 increases decimal precision`
| | |
|---|---|
| **Tests** | dp option increases decimal places from default 1 to 2 |
| **Method** | Call fmtPct(0.1234, { dp: 2 }) |
| **Pass** | Returns '12.34%' |

### `fmtInt > comma-groups a large integer`
| | |
|---|---|
| **Tests** | Large integer formatted with thousands separator |
| **Method** | Call fmtInt(1842) |
| **Pass** | Returns '1,842' |

### `fmtInt > formats a small integer with no separator`
| | |
|---|---|
| **Tests** | Integer under 1000 has no comma grouping |
| **Method** | Call fmtInt(42) |
| **Pass** | Returns '42' |

### `fmtInt > rounds a float to the nearest integer`
| | |
|---|---|
| **Tests** | Floating-point input rounded to nearest integer before formatting |
| **Method** | Call fmtInt(1842.7) |
| **Pass** | Returns '1,843' |

### `fmtInt > formats negative integers with a minus sign`
| | |
|---|---|
| **Tests** | Negative integer displays with minus sign |
| **Method** | Call fmtInt(-5) |
| **Pass** | Returns '-5' |

### `fmtInt > signed:true prepends + for positive values`
| | |
|---|---|
| **Tests** | signed option adds + prefix to positive integers |
| **Method** | Call fmtInt(1500, { signed: true }) |
| **Pass** | Returns '+1,500' |

### `fmtInt > treats null as zero`
| | |
|---|---|
| **Tests** | Null defaults to '0' |
| **Method** | Call fmtInt(null) |
| **Pass** | Returns '0' |

### `fmtPP > formats a negative delta as negative pp (signed by default)`
| | |
|---|---|
| **Tests** | Negative basis-point delta formatted as -X.Xpp (default signed) |
| **Method** | Call fmtPP(-0.003) |
| **Pass** | Returns '-0.3pp' |

### `fmtPP > formats a positive delta with + (signed by default)`
| | |
|---|---|
| **Tests** | Positive basis-point delta formatted as +X.Xpp (default signed) |
| **Method** | Call fmtPP(0.01) |
| **Pass** | Returns '+1.0pp' |

### `fmtPP > formats zero as 0.0pp with default signed:true`
| | |
|---|---|
| **Tests** | Zero basis points displays as 0.0pp without sign |
| **Method** | Call fmtPP(0) |
| **Pass** | Returns '0.0pp' |

### `fmtPP > signed:false suppresses the + prefix`
| | |
|---|---|
| **Tests** | signed:false option removes + prefix from positive values |
| **Method** | Call fmtPP(0.05, { signed: false }) |
| **Pass** | Returns '5.0pp' |

### `fmtPP > treats null as zero`
| | |
|---|---|
| **Tests** | Null defaults to '0.0pp' |
| **Method** | Call fmtPP(null) |
| **Pass** | Returns '0.0pp' |


---

# New Tests (Added After Initial Breakdown)

## `test_seats_coverage.py`
> Tests for seat-related coverage gaps including PUT /{order_id}/seats (update_seats route), SeatBalance.balance_due calculated property, and SEATS_UPDATED projection event handling

### `test_seat_numbers_written_to_projection`
| | |
|---|---|
| **Tests** | Seat list is persisted and readable via projection when update_seats is called |
| **Method** | Seeds order_created event; calls update_seats route with seat_numbers=[1, 2]; asserts response contains seat_numbers |
| **Pass** | Response.seat_numbers == [1, 2] |

### `test_deduplicates_and_sorts_seat_numbers`
| | |
|---|---|
| **Tests** | Duplicate or out-of-order input is normalized: [3,1,2,1] → [1,2,3] |
| **Method** | Seeds order_created event; calls update_seats with unsorted/duplicate seat_numbers [3, 1, 2, 1]; asserts normalized result |
| **Pass** | Response.seat_numbers == [1, 2, 3] (sorted, deduplicated) |

### `test_unions_with_existing_item_seats`
| | |
|---|---|
| **Tests** | Items on a seat survive a SEATS_UPDATED call; the seat is retained in the union of provided seats and item seats |
| **Method** | Seeds order_created and item_added on seat 4; calls update_seats with seat_numbers=[1, 2]; asserts result includes all three seats |
| **Pass** | Response.seat_numbers == [1, 2, 4] (union includes item's seat) |

### `test_guest_count_matches_seat_count`
| | |
|---|---|
| **Tests** | guest_count is updated to match the new seat count after update_seats |
| **Method** | Seeds order_created with guest_count=1; calls update_seats with 3 seat_numbers; asserts guest_count updated |
| **Pass** | Response.guest_count == 3 |

### `test_404_on_unknown_order`
| | |
|---|---|
| **Tests** | HTTPException 404 is raised when update_seats is called on a non-existent order |
| **Method** | Calls update_seats with non-existent order ID; expects HTTPException |
| **Pass** | HTTPException raised with status_code == 404 |

### `test_emits_seats_updated_event`
| | |
|---|---|
| **Tests** | A SEATS_UPDATED event is appended to the correlation timeline when update_seats completes |
| **Method** | Seeds order_created; calls update_seats; retrieves events by correlation ID; filters for SEATS_UPDATED event |
| **Pass** | Exactly one SEATS_UPDATED event exists with payload seat_numbers == [1, 2] |

### `test_balance_due_items_only`
| | |
|---|---|
| **Tests** | SeatBalance.balance_due correctly sums a single item's price |
| **Method** | Constructs SeatBalance with one item priced at 12.00; asserts balance_due property |
| **Pass** | balance_due == Decimal("12.00") |

### `test_balance_due_multiple_items`
| | |
|---|---|
| **Tests** | SeatBalance.balance_due correctly sums multiple items |
| **Method** | Constructs SeatBalance with items priced 10.00 and 5.50; asserts balance_due |
| **Pass** | balance_due == Decimal("15.50") |

### `test_balance_due_quantity_multiplied`
| | |
|---|---|
| **Tests** | SeatBalance.balance_due multiplies item price by quantity |
| **Method** | Constructs SeatBalance with item price 4.00 and quantity 3; asserts balance_due |
| **Pass** | balance_due == Decimal("12.00") (4.00 * 3) |

### `test_balance_due_reduced_by_discount`
| | |
|---|---|
| **Tests** | SeatBalance.balance_due subtracts discounts from item subtotal |
| **Method** | Constructs SeatBalance with item 20.00 and discount 5.00; asserts balance_due |
| **Pass** | balance_due == Decimal("15.00") (20.00 - 5.00) |

### `test_balance_due_reduced_by_confirmed_payment`
| | |
|---|---|
| **Tests** | SeatBalance.balance_due subtracts only confirmed payments |
| **Method** | Constructs SeatBalance with item 20.00 and confirmed payment 8.00; asserts balance_due |
| **Pass** | balance_due == Decimal("12.00") (20.00 - 8.00) |

### `test_balance_due_ignores_pending_payment`
| | |
|---|---|
| **Tests** | Only confirmed payments reduce balance; pending payments are ignored |
| **Method** | Constructs SeatBalance with item 10.00 and pending payment 10.00; asserts balance_due unchanged |
| **Pass** | balance_due == Decimal("10.00") (payment not deducted) |

### `test_balance_due_ignores_failed_payment`
| | |
|---|---|
| **Tests** | Only confirmed payments reduce balance; failed payments are ignored |
| **Method** | Constructs SeatBalance with item 10.00 and failed payment 10.00; asserts balance_due unchanged |
| **Pass** | balance_due == Decimal("10.00") (payment not deducted) |

### `test_balance_due_never_negative_on_overpayment`
| | |
|---|---|
| **Tests** | Overpayment clamps balance_due to zero, never goes negative |
| **Method** | Constructs SeatBalance with item 10.00 and confirmed payment 15.00; asserts clamped |
| **Pass** | balance_due == Decimal("0.00") (not negative) |

### `test_balance_due_discount_plus_payment`
| | |
|---|---|
| **Tests** | Discount and payment reductions stack correctly |
| **Method** | Constructs SeatBalance with item 30.00, discount 5.00, confirmed payment 10.00; asserts balance_due |
| **Pass** | balance_due == Decimal("15.00") (30 - 5 - 10) |

### `test_balance_due_zero_on_empty_seat`
| | |
|---|---|
| **Tests** | Empty SeatBalance returns zero balance_due |
| **Method** | Constructs SeatBalance with no items; asserts balance_due |
| **Pass** | balance_due == Decimal("0.00") |

### `test_replaces_seat_list`
| | |
|---|---|
| **Tests** | SEATS_UPDATED event overwrites the order's seat_numbers in projection |
| **Method** | Seeds order_created with seat_numbers=[1,2,3]; seeds SEATS_UPDATED to [4,5]; projects order from correlation events |
| **Pass** | Projected order.seat_numbers == [4, 5] |

### `test_unions_item_seats_not_in_new_list`
| | |
|---|---|
| **Tests** | Items on a seat are preserved in projection even if SEATS_UPDATED omits that seat |
| **Method** | Seeds order_created, item_added on seat 3, SEATS_UPDATED to [1,2]; projects order; asserts seat 3 retained |
| **Pass** | Projected order.seat_numbers includes 1, 2, and 3 (union of explicit seats and item seats) |

### `test_updates_guest_count_to_seat_count`
| | |
|---|---|
| **Tests** | guest_count is updated to reflect new seat count after SEATS_UPDATED projection |
| **Method** | Seeds order_created with guest_count=1, SEATS_UPDATED to [1,2,3,4]; projects order |
| **Pass** | Projected order.guest_count == 4 |

### `test_multiple_updates_last_wins`
| | |
|---|---|
| **Tests** | Multiple SEATS_UPDATED events result in last event's seats winning in projection |
| **Method** | Seeds order_created, two SEATS_UPDATED events ([1,2,3] then [1,2]); projects order |
| **Pass** | Projected order.seat_numbers == [1, 2] and guest_count == 2 (second update is final) |

### `test_seat_balance_created_for_each_seat`
| | |
|---|---|
| **Tests** | Items added after SEATS_UPDATED are correctly assigned to their seat buckets in SeatBalance |
| **Method** | Seeds order_created, SEATS_UPDATED to [1,2], item_added on seat 1 (12.00) and seat 2 (4.00); projects order |
| **Pass** | order.seat_balances[1].item_subtotal == Decimal("12.00") and order.seat_balances[2].item_subtotal == Decimal("4.00") |



---

## `item-recap.test.js`
> Tests for the item recap panel component that displays ordered items grouped by seat, with price calculations, item cards, modifications, and totals rendering.

### `buildItemRecap — structure > returns a DOM element`
| | |
|---|---|
| **Tests** | Verifies that buildItemRecap() returns an Element instance |
| **Method** | Direct instantiation with empty object, instanceOf assertion |
| **Pass** | Function returns an Element (DOM node) |

### `buildItemRecap — structure > renders one seat group per seat`
| | |
|---|---|
| **Tests** | Each seat in the order gets its own `.ir-seat-group` container |
| **Method** | Creates order with 2 seats, queries for `.ir-seat-group` elements |
| **Pass** | Exactly 2 seat groups rendered |

### `buildItemRecap — structure > renders item name in each card`
| | |
|---|---|
| **Tests** | Item names appear in the rendered DOM |
| **Method** | Creates item with name 'Tacos', checks textContent |
| **Pass** | 'Tacos' is found in element text |

### `buildItemRecap — structure > renders price as qty × price`
| | |
|---|---|
| **Tests** | Formatted price string appears for an item with price 8 and qty 1 |
| **Method** | Creates item with price $8.00, qty 1; checks textContent |
| **Pass** | '$8.00' appears in text |

### `buildItemRecap — structure > multiplies price by qty in the displayed amount`
| | |
|---|---|
| **Tests** | Total item price is qty × unit price (5 × 3 = 15) |
| **Method** | Creates item with price $5, qty 3; checks formatted total |
| **Pass** | '$15.00' appears in text |

### `buildItemRecap — structure > shows qty label when qty > 1`
| | |
|---|---|
| **Tests** | When qty is 3, a `.ir-qty` element displays '3×' |
| **Method** | Creates item with qty 3, queries for .ir-qty |
| **Pass** | .ir-qty element exists with textContent '3×' |

### `buildItemRecap — structure > omits qty label when qty is 1`
| | |
|---|---|
| **Tests** | No `.ir-qty` element when qty equals 1 |
| **Method** | Creates item with qty 1, queries for .ir-qty |
| **Pass** | .ir-qty element is null (not found) |

### `buildItemRecap — structure > shows seat number in seat header`
| | |
|---|---|
| **Tests** | Seat header displays 'S3' for seat number 3 |
| **Method** | Creates seat with seatNumber 3, queries .ir-seat-num |
| **Pass** | .ir-seat-num textContent is 'S3' |

### `buildItemRecap — structure > renders ORDER RECAP panel header by default`
| | |
|---|---|
| **Tests** | Default panel title is 'ORDER RECAP' |
| **Method** | Creates recap with no options, queries .ir-panel-title |
| **Pass** | .ir-panel-title textContent is 'ORDER RECAP' |

### `buildItemRecap — structure > hideHeader suppresses the panel header`
| | |
|---|---|
| **Tests** | Setting hideHeader option removes the panel title |
| **Method** | Calls with { hideHeader: true }, queries for .ir-panel-title |
| **Pass** | .ir-panel-title element is null |

### `buildItemRecap — item card interactions > unsent items render a × remove button`
| | |
|---|---|
| **Tests** | Unsent items (sent: false) show a .ir-xbtn remove button |
| **Method** | Creates item with sent: false, queries for .ir-xbtn |
| **Pass** | .ir-xbtn element exists (not null) |

### `buildItemRecap — item card interactions > sent items do not render a × remove button`
| | |
|---|---|
| **Tests** | Sent items (sent: true) have no remove button |
| **Method** | Creates item with sent: true, queries for .ir-xbtn |
| **Pass** | .ir-xbtn element is null |

### `buildItemRecap — item card interactions > sent items show a ✓ prefix in the name`
| | |
|---|---|
| **Tests** | Sent items display a checkmark (✓) before the name |
| **Method** | Creates sent item, queries .ir-iname textContent |
| **Pass** | .ir-iname text contains '✓' |

### `buildItemRecap — item card interactions > × button click calls onRemoveItem(seatIdx, itemIdx)`
| | |
|---|---|
| **Tests** | Clicking remove button invokes callback with correct indices (seatIdx=0, itemIdx=0) |
| **Method** | Mocks onRemoveItem, dispatches click event on .ir-xbtn |
| **Pass** | onRemoveItem called with (0, 0) |

### `buildItemRecap — item card interactions > × button click does not call onRemoveItem when callback is absent`
| | |
|---|---|
| **Tests** | Clicking remove button when no callback doesn't throw |
| **Method** | Omits onRemoveItem option, dispatches click on .ir-xbtn |
| **Pass** | No exception thrown |

### `buildItemRecap — item card interactions > row tap calls onItemTap(seatIdx, itemIdx)`
| | |
|---|---|
| **Tests** | Clicking item row invokes onItemTap callback with correct indices |
| **Method** | Mocks onItemTap, dispatches click event on .ir-item-row |
| **Pass** | onItemTap called with (0, 0) |

### `buildItemRecap — item card interactions > row tap toggles the .sel class`
| | |
|---|---|
| **Tests** | Clicking item row toggles selection state (.sel class) |
| **Method** | Clicks row twice, checks .sel class presence each time |
| **Pass** | First click adds .sel, second click removes it |

### `buildItemRecap — item card interactions > row tap does nothing when onItemTap is absent`
| | |
|---|---|
| **Tests** | Clicking item row when no callback doesn't throw |
| **Method** | Omits onItemTap option, dispatches click on .ir-item-row |
| **Pass** | No exception thrown |

### `buildItemRecap — item card interactions > chevron click opens item-detail transactional`
| | |
|---|---|
| **Tests** | Clicking chevron button opens item-detail scene via SceneManager.openTransactional |
| **Method** | Mocks SceneManager, dispatches click on .ir-chev, checks call |
| **Pass** | SceneManager.openTransactional called with 'item-detail' and item data |

### `buildItemRecap — item card interactions > itemSelected seeds the row with .sel if it returns true`
| | |
|---|---|
| **Tests** | If itemSelected callback returns true, row gets .sel class on render |
| **Method** | Passes itemSelected: () => true option, checks .ir-item-row class |
| **Pass** | .ir-item-row has .sel class initially |

### `buildItemRecap — seat header > non-collapsible header tap bulk-selects all item rows`
| | |
|---|---|
| **Tests** | Clicking seat header with 2 items selects all rows and calls onSeatHeaderTap(0, true) |
| **Method** | Mocks onSeatHeaderTap, dispatches click on .ir-seat-header |
| **Pass** | onSeatHeaderTap called with (0, true); all .ir-item-row have .sel class |

### `buildItemRecap — seat header > second non-collapsible header tap deselects all`
| | |
|---|---|
| **Tests** | Second click on seat header deselects all previously selected rows |
| **Method** | Clicks header twice, checks .sel class after second click |
| **Pass** | After second click, .sel class is removed from all rows |

### `buildItemRecap — seat header > collapsible header tap toggles .collapsed on the group`
| | |
|---|---|
| **Tests** | With collapsible: true, clicking header toggles .collapsed on .ir-seat-group |
| **Method** | Passes { collapsible: true }, clicks header, checks class |
| **Pass** | .collapsed toggles from false to true on click |

### `buildItemRecap — mods and halves > renders mod names`
| | |
|---|---|
| **Tests** | Modification names (e.g., 'Extra Cheese') appear in output |
| **Method** | Creates item with mod { name: 'Extra Cheese', price: 1.5 }, checks text |
| **Pass** | 'Extra Cheese' found in textContent |

### `buildItemRecap — mods and halves > renders halves grid with 1ST HALF / 2ND HALF headers`
| | |
|---|---|
| **Tests** | Half pizza toppings render with section headers and topping names |
| **Method** | Creates item with halves: { first: [...], second: [...] }, checks text |
| **Pass** | Text contains '1ST HALF', '2ND HALF', 'Pepperoni', 'Mushroom' |

### `buildItemRecap — totals block > totals block is appended when order.totals is set`
| | |
|---|---|
| **Tests** | When order.totals is provided, .ir-totals element is rendered |
| **Method** | Creates order with totals object, queries for .ir-totals |
| **Pass** | .ir-totals element exists (not null) |

### `buildItemRecap — totals block > totals block is absent when hideTotals is set`
| | |
|---|---|
| **Tests** | Setting hideTotals: true removes totals block even if totals data exists |
| **Method** | Passes { hideTotals: true } option, queries for .ir-totals |
| **Pass** | .ir-totals element is null |

### `buildItemRecapTotals > returns a .ir-totals element`
| | |
|---|---|
| **Tests** | buildItemRecapTotals() returns element with className 'ir-totals' |
| **Method** | Calls buildItemRecapTotals({}), checks className |
| **Pass** | element.className is exactly 'ir-totals' |

### `buildItemRecapTotals > renders SUBTOTAL with formatted value`
| | |
|---|---|
| **Tests** | Subtotal label and formatted price appear ($18.50) |
| **Method** | Calls with { subtotal: 18.5 }, checks textContent |
| **Pass** | Text contains 'SUBTOTAL' and '$18.50' |

### `buildItemRecapTotals > renders TAX with rate percentage when taxRate is provided`
| | |
|---|---|
| **Tests** | Tax label includes rate percentage (7%) when taxRate is provided |
| **Method** | Calls with { tax: 1.3, taxRate: 0.07 }, checks textContent |
| **Pass** | Text contains 'TAX (7%)' and '$1.30' |

### `buildItemRecapTotals > renders plain TAX label when taxRate is absent`
| | |
|---|---|
| **Tests** | Tax label omits rate percentage when taxRate is not provided |
| **Method** | Calls with { tax: 2 }, queries .ir-tl elements |
| **Pass** | One .ir-tl element has textContent exactly 'TAX' |

### `buildItemRecapTotals > renders TOTAL row`
| | |
|---|---|
| **Tests** | Total amount row displays correctly |
| **Method** | Calls with { total: 21.5 }, checks textContent |
| **Pass** | Text contains 'TOTAL' and '$21.50' |

### `buildItemRecapTotals > renders CASH row when cash is provided`
| | |
|---|---|
| **Tests** | Cash amount row displays when cash value is provided |
| **Method** | Calls with { total: 20, cash: 19.2 }, checks textContent |
| **Pass** | Text contains 'CASH' and '$19.20' |

### `buildItemRecapTotals > omits CASH row when cash is null`
| | |
|---|---|
| **Tests** | No CASH label appears when cash is null |
| **Method** | Calls with { total: 20, cash: null }, queries .ir-tl-strong |
| **Pass** | No .ir-tl-strong element has textContent 'CASH' |

### `buildItemRecapTotals > formats zero values as $0.00`
| | |
|---|---|
| **Tests** | Zero amounts format consistently as $0.00 |
| **Method** | Calls with all zeros, queries .ir-tv, counts $0.00 occurrences |
| **Pass** | At least 3 .ir-tv elements contain '$0.00' |

### `buildItemRecapTotals > style injection is idempotent (calling twice leaves one style tag)`
| | |
|---|---|
| **Tests** | Multiple calls don't duplicate #item-recap-styles style tag |
| **Method** | Calls buildItemRecapTotals() twice, counts #item-recap-styles tags |
| **Pass** | Exactly 1 style tag with id 'item-recap-styles' in document |

---

## `pizza-builder-overlay.test.js`
> Tests for the pizza builder overlay component that allows customization of pizza toppings with prefix (Add/No) and placement (1st/Whole/2nd) controls.

### `pizza-builder-overlay — _halfPriceAmount (pure formula) > halves an integer price`
| | |
|---|---|
| **Tests** | _halfPriceAmount(2) returns 1.00 |
| **Method** | Direct function call with integer input |
| **Pass** | Returns 1.00 |

### `pizza-builder-overlay — _halfPriceAmount (pure formula) > rounds a half-cent up to the nearest cent`
| | |
|---|---|
| **Tests** | _halfPriceAmount(1.25) rounds 0.625 cents to 0.63 |
| **Method** | Direct function call with 1.25 |
| **Pass** | Returns 0.63 |

### `pizza-builder-overlay — _halfPriceAmount (pure formula) > returns 0 for a free topping`
| | |
|---|---|
| **Tests** | _halfPriceAmount(0) returns 0 |
| **Method** | Direct function call with 0 |
| **Pass** | Returns 0 |

### `pizza-builder-overlay — _halfPriceAmount (pure formula) > handles fractional prices correctly`
| | |
|---|---|
| **Tests** | _halfPriceAmount(3.00) returns 1.50 exactly |
| **Method** | Direct function call with 3.00 |
| **Pass** | Returns 1.50 |

### `pizza-builder-overlay — showPizzaBuilderOverlay > calls SceneManager.interrupt with "pizza-builder"`
| | |
|---|---|
| **Tests** | showPizzaBuilderOverlay() registers pizza-builder interrupt with onConfirm/onCancel callbacks |
| **Method** | Calls function, checks SceneManager.interrupt mock |
| **Pass** | SceneManager.interrupt called with 'pizza-builder' and params object containing onConfirm, onCancel, and sizeItem |

### `pizza-builder-overlay — showPizzaBuilderOverlay > returns a Promise`
| | |
|---|---|
| **Tests** | showPizzaBuilderOverlay() return value is a Promise instance |
| **Method** | Calls function, checks return type |
| **Pass** | Result is instanceof Promise |

### `pizza-builder-overlay — showPizzaBuilderOverlay > promise resolves when onConfirm is called`
| | |
|---|---|
| **Tests** | Promise resolves with returned data when onConfirm callback is invoked |
| **Method** | Calls showPizzaBuilderOverlay(), gets onConfirm from mock, calls it with data, awaits promise |
| **Pass** | Promise resolves to object matching { category: 'pizza' } |

### `pizza-builder-overlay — showPizzaBuilderOverlay > promise rejects when onCancel is called`
| | |
|---|---|
| **Tests** | Promise rejects when onCancel callback is invoked |
| **Method** | Calls showPizzaBuilderOverlay(), gets onCancel from mock, calls it, expects promise rejection |
| **Pass** | Promise rejects with an error |

### `pizza-builder-overlay — mount DOM > renders prefix buttons (Add, No)`
| | |
|---|---|
| **Tests** | Prefix selection buttons for 'Add' and 'No' are rendered |
| **Method** | Mounts overlay, searches DOM for buttons with labels 'Add' and 'No' |
| **Pass** | Both findBtn(container, 'Add') and findBtn(container, 'No') return defined elements |

### `pizza-builder-overlay — mount DOM > renders placement buttons (1st, Whole, 2nd)`
| | |
|---|---|
| **Tests** | Placement selection buttons for '1st', 'Whole', and '2nd' are rendered |
| **Method** | Mounts overlay, searches DOM for buttons with those labels |
| **Pass** | All three buttons (1st, Whole, 2nd) are found |

### `pizza-builder-overlay — mount DOM > renders CANCEL, UNDO, ADD action buttons`
| | |
|---|---|
| **Tests** | Action buttons for cancel, undo, and add are rendered |
| **Method** | Mounts overlay, searches for buttons with labels 'CANCEL', 'UNDO', 'ADD' |
| **Pass** | All three action buttons are found |

### `pizza-builder-overlay — mount DOM > CANCEL button calls onCancel`
| | |
|---|---|
| **Tests** | Clicking CANCEL button invokes the onCancel callback |
| **Method** | Mocks onCancel, mounts overlay, dispatches pointerup on CANCEL button |
| **Pass** | onCancel mock has been called |

### `pizza-builder-overlay — mount DOM > ADD button calls onConfirm with correct shape`
| | |
|---|---|
| **Tests** | Clicking ADD button invokes onConfirm with pizza object (name, unitPrice, mods, category) |
| **Method** | Mocks onConfirm with sizeItem { label: 'Medium', price: 12 }, dispatches pointerup on ADD |
| **Pass** | onConfirm called with { name: 'Medium', unitPrice: 12, mods: [], category: 'pizza' } |

### `pizza-builder-overlay — mount DOM > UNDO is a no-op when no mods have been applied`
| | |
|---|---|
| **Tests** | Clicking UNDO when no mods exist doesn't throw an error |
| **Method** | Mounts overlay with empty builderData, dispatches pointerup on UNDO |
| **Pass** | No exception thrown |

### `pizza-builder-overlay — mount DOM > log shows empty-state message when no mods applied`
| | |
|---|---|
| **Tests** | Initial state displays 'Tap a topping' message |
| **Method** | Mounts overlay, checks textContent |
| **Pass** | Container text contains 'Tap a topping' |

### `pizza-builder-overlay — mount DOM > prefix tap changes the active prefix visual state (no throw)`
| | |
|---|---|
| **Tests** | Clicking prefix button (e.g., 'No') updates visual state without error |
| **Method** | Mounts overlay, dispatches pointerup on 'No' prefix button |
| **Pass** | No exception thrown |

### `pizza-builder-overlay — mount DOM > placement tap changes the active placement visual state (no throw)`
| | |
|---|---|
| **Tests** | Clicking placement button (e.g., '1st') updates visual state without error |
| **Method** | Mounts overlay, dispatches pointerup on '1st' placement button |
| **Pass** | No exception thrown |


---

## `order-entry.test.js`
> Tests for idempotency-critical paths in order-entry.js: recalled items preserve backendItemId, save/send operations skip already-persisted items, and order creation uses stable idempotency keys for retry safety.

### `idempotency guards > recallFromBackend > sets backendItemId from item.item_id on every recalled item`
| | |
|---|---|
| **Tests** | Each item in a recalled order has its `backendItemId` set from the response's `item_id` field |
| **Method** | Mocks fetchWithTimeout returning orderData with two items (bi-aaa, bi-bbb); calls recallFromBackend('ord-r1'); waits 20ms; inspects ticket array |
| **Pass** | ticket[0].backendItemId === 'bi-aaa' and ticket[1].backendItemId === 'bi-bbb' |

### `idempotency guards > recallFromBackend > marks items as sent when sent_at is set`
| | |
|---|---|
| **Tests** | Recalled items with a non-null sent_at timestamp are marked with sent=true |
| **Method** | Mocks fetchWithTimeout returning orderData with item having sent_at='2025-01-01T12:00:00'; calls recallFromBackend; waits 20ms |
| **Pass** | ticket[0].sent === true |

### `idempotency guards > recallFromBackend > sets currentOrderId from the response`
| | |
|---|---|
| **Tests** | currentOrderId is populated from the fetched order_id |
| **Method** | Mocks fetchWithTimeout returning order_id='ord-r3'; calls recallFromBackend('ord-r3'); waits 20ms |
| **Pass** | sceneDef.__handlers.currentOrderId === 'ord-r3' |

### `idempotency guards > recallFromBackend > does not populate ticket if scene is no longer active`
| | |
|---|---|
| **Tests** | When order-entry is no longer the active working scene, recallFromBackend does not write items to ticket |
| **Method** | Sets SceneManagerMock.getActiveWorking to return 'check-overview'; mocks fetch with one item; calls recallFromBackend; waits 20ms |
| **Pass** | ticket.length === 0 (guard prevented write) |

### `idempotency guards > handleSaveOnly > skips items that already have a backendItemId (the doubling-bug guard)`
| | |
|---|---|
| **Tests** | handleSaveOnly only POSTs items without a backendItemId, skipping already-persisted items to prevent duplicates |
| **Method** | Sets ticket to one item with backendItemId='bi-existing-001' and one local item (no backendItemId); calls handleSaveOnly(); filters fetch calls for '/items' |
| **Pass** | Only 1 POST to /items with body.name === 'Fries' (the local item) |

### `idempotency guards > handleSaveOnly > returns early without any fetch when all items have backendItemId`
| | |
|---|---|
| **Tests** | If all items already have backendItemId, handleSaveOnly makes no network requests |
| **Method** | Sets ticket to two items both with backendItemId; calls handleSaveOnly(); checks fetchWithTimeout calls |
| **Pass** | itemCalls.length === 0 (no fetch) |

### `idempotency guards > handleSaveOnly > does nothing when ticket is empty`
| | |
|---|---|
| **Tests** | handleSaveOnly is a no-op when ticket is empty |
| **Method** | Sets ticket to []; calls handleSaveOnly(); checks fetchWithTimeout |
| **Pass** | fetchWithTimeout was never called |

### `idempotency guards > handleSaveOnly > does nothing when all items are already sent`
| | |
|---|---|
| **Tests** | If all ticket items have sent=true, handleSaveOnly does not fetch |
| **Method** | Sets ticket to [localItem({ sent: true })]; calls handleSaveOnly() |
| **Pass** | fetchWithTimeout was never called |

### `idempotency guards > handleSend > skips items with backendItemId and only POSTs new items`
| | |
|---|---|
| **Tests** | handleSend only creates items via POST for items without backendItemId, then fires /send |
| **Method** | Sets ticket to backendItem + localItem; mocks successful responses; calls handleSend(); filters fetch calls for '/items' |
| **Pass** | Only 1 POST to /items with body.name === 'Fries' |

### `idempotency guards > handleSend > fires /send to kitchen even when all items have backendItemId`
| | |
|---|---|
| **Tests** | /send to kitchen is called even when no new items need to be POSTed |
| **Method** | Sets ticket to single backendItem; mocks one successful response; calls handleSend(); filters fetch calls for '/send' |
| **Pass** | sendCalls.length === 1 |

### `idempotency guards > handleSend > marks all items sent on success`
| | |
|---|---|
| **Tests** | All ticket items are marked sent=true after successful handleSend |
| **Method** | Sets ticket to localItem + backendItem; mocks three successful responses; calls handleSend() |
| **Pass** | ticket.every((i) => i.sent) === true |

### `idempotency guards > createOrderIdemKey > reuses the same key when order creation fails and is retried`
| | |
|---|---|
| **Tests** | The idempotency key for order creation remains stable across retries so the backend can deduplicate phantom duplicates |
| **Method** | First handleSend call mocks 503 failure, captures createOrderIdemKey; second call also mocks failure, captures key again; compares |
| **Pass** | keyAfterSecondAttempt === keyAfterFirstAttempt |

### `idempotency guards > createOrderIdemKey > clears createOrderIdemKey once order is successfully created`
| | |
|---|---|
| **Tests** | After successful order creation, currentOrderId is set (key is no longer needed) |
| **Method** | Sets ticket to localItem; mocks four successful responses including order creation returning order_id='ord-new'; calls handleSend() |
| **Pass** | sceneDef.__handlers.currentOrderId === 'ord-new' |


---

### `New tests in test_payment_routes_gaps.py`

#### `test_cash_payment_idempotent_on_retry`
| | |
|---|---|
| **Tests** | A repeated POST with the same `transaction_id` returns the original success payload and does not create a second PAYMENT_CONFIRMED event |
| **Method** | Creates order, processes cash payment with explicit transaction_id, retries with same request, verifies result and ledger event count |
| **Pass** | Both calls return success with same payment_id; ledger contains exactly one PAYMENT_CONFIRMED event |

#### `test_cash_payment_transaction_id_stored_in_confirm_event`
| | |
|---|---|
| **Tests** | The client-supplied transaction_id is recorded in the PAYMENT_CONFIRMED payload for idempotency lookups |
| **Method** | Creates order, processes cash payment with explicit transaction_id, retrieves PAYMENT_CONFIRMED event from ledger |
| **Pass** | PAYMENT_CONFIRMED event payload contains the supplied transaction_id |

#### `test_cash_payment_without_transaction_id_still_works`
| | |
|---|---|
| **Tests** | Omitting transaction_id (legacy clients) still processes payment normally without errors |
| **Method** | Creates order, processes cash payment with no transaction_id parameter, checks result and ledger |
| **Pass** | success=True; exactly one PAYMENT_CONFIRMED event created |

#### `test_cash_payment_different_transaction_ids_are_independent`
| | |
|---|---|
| **Tests** | Two payments with different transaction_ids on the same partial-pay order both succeed independently |
| **Method** | Creates order, processes two cash payments ($15 each) with different transaction_ids ("tx-A" and "tx-B"), counts PAYMENT_CONFIRMED events |
| **Pass** | Both payments succeed; ledger contains exactly two distinct PAYMENT_CONFIRMED events |

---

### `New tests in payment.test.js`

#### `cash: _pendingTxId is generated on the first CONFIRM tap`
| | |
|---|---|
| **Tests** | When user taps CONFIRM in cash mode, a transaction_id is generated and sent in POST body |
| **Method** | Mocks fetch success, calls handleConfirm(), inspects POST body of /payments/cash call |
| **Pass** | transaction_id in POST body is truthy and a string |

#### `cash: _pendingTxId is the same on retry after a network failure`
| | |
|---|---|
| **Tests** | After a failed payment attempt, retrying reuses the same pending transaction_id |
| **Method** | First attempt returns 500, captures transaction_id from body; second attempt succeeds, captures transaction_id; compares both |
| **Pass** | Second attempt's transaction_id matches first attempt's |

#### `cash: _pendingTxId is cleared after a successful payment`
| | |
|---|---|
| **Tests** | After successful payment, the pending transaction_id is nulled so the next payment gets a fresh one |
| **Method** | Calls handleConfirm with successful response, checks pendingTxId state |
| **Pass** | pendingTxId is null after success |

#### `cash: _pendingTxId survives a failed attempt (not cleared on failure)`
| | |
|---|---|
| **Tests** | After a failed payment attempt, the pending transaction_id persists so retry can reuse it |
| **Method** | Calls handleConfirm with 500 error response, checks pendingTxId remains set |
| **Pass** | pendingTxId is truthy after failure |

#### `card: _pendingTxId is sent in the POST body`
| | |
|---|---|
| **Tests** | In card mode, a transaction_id is generated and included in the POST body to /payments/sale |
| **Method** | Spies on fetch, calls handleConfirm() in card mode, finds /payments/sale call and inspects body |
| **Pass** | transaction_id in POST body is truthy |

#### `card: same _pendingTxId reused after a DECLINED response`
| | |
|---|---|
| **Tests** | After a DECLINED (402) card response, retrying reuses the same pending transaction_id |
| **Method** | First call returns 402 decline, second succeeds; compares transaction_id in both POST bodies |
| **Pass** | Both calls contain identical transaction_id values |

#### `confirmProcessing prevents a second concurrent CONFIRM`
| | |
|---|---|
| **Tests** | Tapping CONFIRM while a request is in flight prevents a second concurrent request |
| **Method** | First call mocks an unresolved promise, taps CONFIRM twice, lets microtask queue flush, counts /payments/cash calls |
| **Pass** | Only one POST to /payments/cash despite two tap events |

---

### `New tests in check-overview.test.js`

#### `handleAddItems > new check (no orderId): navigates immediately without any fetch`
| | |
|---|---|
| **Tests** | When orderId is null and order is null, handleAddItems navigates to order-entry without any refresh fetch |
| **Method** | Creates state with orderId:null, order:null, calls handleAddItems, checks fetch and SceneManager.mountWorking calls |
| **Pass** | No fetchWithTimeout calls; SceneManager.mountWorking called with 'order-entry' |

#### `handleAddItems > existing check already loaded (state.order set): navigates immediately`
| | |
|---|---|
| **Tests** | When order data is already in state, handleAddItems navigates without fetching |
| **Method** | Creates state with orderId and order object populated, calls handleAddItems |
| **Pass** | SceneManager.mountWorking called with 'order-entry'; no refresh fetch fired |

#### `handleAddItems > existing check not yet loaded: awaits refreshOrder before navigating`
| | |
|---|---|
| **Tests** | When orderId exists but order is null, handleAddItems fetches order data before navigating |
| **Method** | Mocks fetch returning order data, creates state with orderId but order null, calls handleAddItems |
| **Pass** | fetchWithTimeout called to /orders/{orderId}; SceneManager.mountWorking called after fetch |

#### `handleAddItems > refresh fails (order still null after await): blocks navigation, fires UI-005`
| | |
|---|---|
| **Tests** | When refresh fetch fails, navigation is blocked and UI-005 error code is reported |
| **Method** | Mocks fetch returning 500, calls handleAddItems with orderId set but order null |
| **Pass** | SceneManager.mountWorking not called; entReport fired with code:'UI-005'; error toast shown |

#### `handleAddItems > passes seat layout from state into buildOrderEntryParams`
| | |
|---|---|
| **Tests** | When navigating to order-entry, the current seat layout from state is passed to buildOrderEntryParams |
| **Method** | Creates state with seats array, calls handleAddItems, checks buildOrderEntryParams mock calls |
| **Pass** | buildOrderEntryParams called with state as first argument |

#### `seat grid rendering > Mode B renders a 300 px right-column tiles grid`
| | |
|---|---|
| **Tests** | In Mode B, a right-column tiles grid with 300px width and 3-column layout is created |
| **Method** | Calls renderSeatsGrid with mode 'B', searches rendered container for element with style.width='300px' and checks gridTemplateColumns |
| **Pass** | Found element with width:300px and gridTemplateColumns:'repeat(3, 1fr)' |

#### `seat grid rendering > Mode B renders exactly two columns (recap + tiles)`
| | |
|---|---|
| **Tests** | Mode B produces exactly two top-level columns: recap column and 300px tiles column |
| **Method** | Calls renderSeatsGrid with mode 'B', checks container.children length and widths |
| **Pass** | container has 2 children; first is not 300px, second is 300px |

#### `seat grid rendering > Mode A renders one element per seat plus the +SEAT add tile`
| | |
|---|---|
| **Tests** | Mode A creates individual seat elements; total is seat count + 1 add tile, no fixed-width tiles grid |
| **Method** | Calls renderSeatsGrid with mode 'A', verifies no 300px column, counts children |
| **Pass** | No 300px element; container.children.length === seats.length + 1 |

#### `seat grid rendering > Mode B places one compact tile per seat in the tiles grid`
| | |
|---|---|
| **Tests** | In Mode B, the tiles grid contains all seat tiles plus ALL SEATS and +SEAT buttons |
| **Method** | Calls renderSeatsGrid mode 'B', finds 300px tilesCol, counts children |
| **Pass** | tilesCol.children.length === 5 seats + 2 utility buttons |

#### `deleteSeat > blocks delete of a paid seat and fires UI-007`
| | |
|---|---|
| **Tests** | Attempting to delete a paid seat is blocked with toast and UI-007 error code |
| **Method** | Creates state with paidSeats['S-001']=true, calls deleteSeat, checks state.seats and error reporting |
| **Pass** | state.seats length unchanged; entReport called with code:'UI-007' |

#### `deleteSeat > blocks delete of a seat that still has items`
| | |
|---|---|
| **Tests** | Attempting to delete a seat that contains items is blocked with toast message |
| **Method** | Creates state where seat[0] has items array, calls deleteSeat |
| **Pass** | state.seats length unchanged; toast contains "items" |

#### `deleteSeat > blocks delete when it is the only remaining seat`
| | |
|---|---|
| **Tests** | Attempting to delete the final remaining seat is blocked with toast |
| **Method** | Creates state with single seat, calls deleteSeat |
| **Pass** | state.seats length unchanged; toast contains "only seat" |

#### `deleteSeat > removes seat from state.seats on valid delete`
| | |
|---|---|
| **Tests** | Valid seat deletion (unpaid, no items, not the only seat) removes it from state.seats |
| **Method** | Creates state with 2 seats, calls deleteSeat on first |
| **Pass** | state.seats.length === 1; remaining seat id is 'S-002' |

#### `deleteSeat > removes deleted seat from state.selected`
| | |
|---|---|
| **Tests** | When a seat is deleted, it is also removed from state.selected |
| **Method** | Creates state with selected['S-001']=true, deletes that seat |
| **Pass** | state.selected['S-001'] is undefined |

#### `deleteSeat > calls persistSeats to sync backend after valid delete`
| | |
|---|---|
| **Tests** | After valid seat deletion, persistSeats PUTs the new seat layout to the backend |
| **Method** | Creates state with orderId, calls deleteSeat, awaits promise, checks fetchWithTimeout |
| **Pass** | fetchWithTimeout called with PUT to /orders/{orderId}/seats |

#### `selection helpers > toggleItem delegates to toggleItemSelection with correct seat/item indices`
| | |
|---|---|
| **Tests** | toggleItem delegates to the seats module's toggleItemSelection with correct indices |
| **Method** | Mocks toggleItemSelection, calls sceneDef.__handlers.toggleItem(state, 0, 0) |
| **Pass** | toggleItemSelection called with ({}, 0, 0); state.selectedItems updated with return value |

#### `selection helpers > getSelectedSeatIds returns keys of state.selected`
| | |
|---|---|
| **Tests** | getSelectedSeatIds returns an array containing all keys from state.selected |
| **Method** | Creates state with selected containing two seat IDs, calls getSelectedSeatIds |
| **Pass** | Returns array ['S-001', 'S-002'] with length 2 |

#### `selection helpers > getSelectedSeatIds returns empty array when nothing selected`
| | |
|---|---|
| **Tests** | When state.selected is empty, getSelectedSeatIds returns an empty array |
| **Method** | Creates state with selected:{}, calls getSelectedSeatIds |
| **Pass** | Returns [] |

#### `selection helpers > getSelectedItemRefs delegates to collectSelectedItemRefs with state.selectedItems`
| | |
|---|---|
| **Tests** | getSelectedItemRefs delegates to collectSelectedItemRefs and returns seat/item index refs |
| **Method** | Creates state with selectedItems containing keys like '0:0' and '1:0', calls getSelectedItemRefs |
| **Pass** | Returns [{seatIdx:0, itemIdx:0}, {seatIdx:1, itemIdx:0}] |

#### `selection helpers > getSelectedItemRefs returns empty array when no items selected`
| | |
|---|---|
| **Tests** | When state.selectedItems is empty, getSelectedItemRefs returns an empty array |
| **Method** | Creates state with selectedItems:{}, calls getSelectedItemRefs |
| **Pass** | Returns [] |
