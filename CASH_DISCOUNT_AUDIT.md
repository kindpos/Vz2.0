# KINDpos Cash Discount — Audit Summary

## TL;DR

Cash dual-pricing **ships and works**, but it rides on the generic `DISCOUNT_APPROVED` event channel. A parallel `Payment.cash_discount_amount` channel exists in the projection but is **never written** by any route — it's wired up and forgotten. The two channels would **double-count** if both ever fire on the same order.

---

## Section-by-Section

### 1. Config Model — Mostly Missing
- ❌ No `CASH_DISCOUNT_RATE_SET` event type.
- ❌ No `CashDiscountConfig` pydantic model.
- ❌ No `POST /store/cash-discount-rate` route.
- ❌ `store_config_service.py` never mutates `cash_discount_rate` from any event.
- ❌ `overseer_config_service.py` has zero cash-discount references.
- ✅ `settings.cash_discount_rate` (env-var, default `0.0`) at `config.py:46`.
- ⚠️ `StoreConfigBundle.cash_discount_rate` field exists (`config_events.py:65`) but is decorative — always 0.0.
- ⚠️ `GET /pricing` reads from a magic `cash_discount_rate` key inside `STORE_CC_PROCESSING_RATE_UPDATED` payloads (`config.py:127-128`), but the `CCProcessingRate` model doesn't include that field.

### 2. Payment Route — Discount-Channel
**File:** `payment_routes.py:490-519`

Computes cash discount on **first cash tender only**:
```python
naive_discount = order.total - request.amount
max_discount   = request.amount * rate / (1 - rate)
cash_discount  = max(0, min(naive_discount, max_discount))
```
Emits as `DISCOUNT_APPROVED` with `discount_type="cash_dual_pricing"`. Re-projects so `order.total` shrinks before payment confirmation. **Does NOT pass `cash_discount_amount` to `payment_confirmed`** — the factory doesn't even accept that parameter.

### 3. Projection Layer — Two Parallel Models

| Field/Property | Source | Currently Populated? |
|---|---|---|
| `Payment.cash_discount_amount` (`:64`) | PAYMENT_CONFIRMED payload | ❌ never (routes don't emit) |
| `Order.cash_discount_total` (`:201-215`) | Σ payments' cash_discount_amount | ❌ always 0.00 |
| `Order.total` (`:217-221`) | subtotal + tax + surcharge | ✅ reflects cash discount via the discount channel |
| `Order.amount_paid` (`:225-230`) | Σ p.amount + service_charge | ✅ correct (no cash-discount term) |
| `Order.balance_due` (`:233-242`) | total − amount_paid − **cash_discount_total** | ⚠️ subtracts always-zero operand — works today, would **double-count** if payment channel ever activates |

### 4. Receipt Template — Generic
**File:** `guest_receipt.py:255-278`

Cash dual-pricing renders as a plain `DISCOUNT: -$x.xx` line, **indistinguishable from a manager comp**. No template branch reads `discount_type`. No "CASH PRICE / CARD PRICE" parallel display. No "TAXABLE AMOUNT" line. `print_context_builder.py` doesn't pass `cash_discount_amount` to the receipt context (grep returns zero matches).

### 5. Financial Invariants — Correct Under Current Model
- `check_tender_reconciliation`: `Cash + Card = Net + Tax` ✅ correct because cash payments are at the post-discount price and the discount flows into `Net` via `DISCOUNT_APPROVED`.
- Identity 6 (`financial_invariants.py:471-481`): `balance_due = total − amount_paid − cash_discount_total` — same double-count risk as Section 3.
- **If the payment-channel model is ever activated, both `check_tender_reconciliation` and Identity 6 need updating.**

### 6. Test Coverage — Concentrated in One File
- ✅ **5 cash-discount tests** in `test_overpayment_guard.py::TestDualPricingGuard` (`:160-330`) — exact, at-card-price, overpaid, underpaid, all asserting tender reconciliation.
- ✅ `test_payment_precision.py::test_cash_discount_only_on_first_payment` (`:109-143`) — skipped unless `KINDPOS_CASH_DISCOUNT_RATE` env var is set.
- ✅ `test_projections.py::test_cash_discount_amount_propagates_from_payload` (`:410-425`) — exercises the *unused* payment-channel wiring only.
- ❌ No receipt-template tests for cash discount.
- ❌ Property-test (`test_invariants_property.py`) doesn't construct `cash_dual_pricing` scenarios.
- ⚠️ ~15 other test files explicitly **disable** cash discount in fixtures.

---

## Gap Map

### ✅ Exists (Production)
- `settings.cash_discount_rate` env var
- Cash dual-pricing math + discount cap (`payment_routes.py:490-519`)
- Discount emission as `DISCOUNT_APPROVED`
- Re-projection after discount emission
- Generic `DISCOUNT:` line on receipts
- Day-level aggregation correctness via `discount_total`
- `GET /pricing` exposes the rate

### ⚠️ Partial (Wired But Dead / Inconsistent)
- `Payment.cash_discount_amount` — declared, never written
- `Order.cash_discount_total` — always zero in practice; docstring describes an un-implemented model
- `Order.balance_due` cash-discount subtraction — math present, operand always zero, **double-count hazard**
- `StoreConfigBundle.cash_discount_rate` — defaulted, never projected from events
- `check_order_identities` Identity 6 — same double-count hazard
- `_MONETARY_KEYS` includes `cash_discount_amount` (post-Tier-1) but no factory emits the key
- `base_payment.py` adapter validates `cash_discount_amount` but `payment_routes.py` bypasses the adapter on the cash-discount path

### ❌ Missing Entirely
- `CASH_DISCOUNT_RATE_SET` event type
- `CashDiscountConfig` pydantic model
- `POST /store/cash-discount-rate` route
- Projection of `cash_discount_rate` from events in `store_config_service.py`
- Any Overseer-side cash-discount knowledge
- `cash_discount_amount` parameter on `payment_confirmed` factory
- Dedicated `CASH DISCOUNT` line on `guest_receipt.py` (distinct from manager DISCOUNT)
- `TAXABLE AMOUNT` line showing post-discount, pre-tax base
- `cash_discount_amount` / `cash_discount_rate` in receipt context
- Day-level invariants for the payment-channel model
- Tests for cash_dual_pricing + manager-discount coexistence on one order
- Cash dual-pricing scenarios in property-style invariant tests
- Receipt-template tests for cash discount
- Documentation declaring which channel (discount vs payment) is the source of truth

---

## Recommendation Vector

**Option A (formalize what ships):** Drop the dead payment-channel. Remove `Payment.cash_discount_amount`, `Order.cash_discount_total`, Identity 6's term. Add `CASH_DISCOUNT_RATE_SET` event + route + projection. Add receipt template branch on `discount_type == "cash_dual_pricing"`. Lowest churn.

**Option B (switch to payment-channel):** Stop emitting `DISCOUNT_APPROVED` for cash dual-pricing; instead pass `cash_discount_amount` through `payment_confirmed`. Update `Order.total` or `Order.amount_paid` to consume it. Update `check_tender_reconciliation` accordingly. Higher churn but cleaner separation between "manager discount" and "tender-class discount."
