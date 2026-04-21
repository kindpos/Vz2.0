# Backend Coverage Audit — 2026-04-21

Follow-up audit after the financial-layer work shipped at `5b18221` and
the skipped-tests/warnings cleanup at `eb702cf`. Test suite baseline is
**992 passed / 3 skipped / 0 warnings / 0 failing**.

Audit branch: `claude/audit-financial-layer-IFOo9` (same as prior work).

---

## Phase 1 — Coverage baseline

Run:

```bash
cd backend
python -m pytest tests/ --cov=app --cov=bombard \
  --cov-report=term-missing --no-cov-on-fail -q
```

Result: **63% overall (6,416 of 10,137 stmts covered)**.

Headline numbers:

| Module | Stmts | Cover | Miss |
|---|---:|---:|---:|
| `bombard/simulation_engine.py` | 441 | **0%** | 441 |
| `bombard/validators.py` | 339 | **0%** | 339 |
| `app/services/sample_order_seeder.py` | 307 | 8% | 281 |
| `app/scanner/printer_detector.py` | 262 | 21% | 207 |
| `bombard/run_bombard.py` | 143 | 0% | 143 |
| `app/services/print_context_builder.py` | 356 | 57% | 154 |
| `app/api/routes/payment_routes.py` | 358 | 57% | 154 |
| `app/api/routes/reporting.py` | 507 | 70% | 153 |
| `app/api/routes/orders.py` | 729 | 79% | 150 |
| `app/api/routes/hardware.py` | 368 | 62% | 138 |
| `app/core/adapters/dejavoo_spin.py` | 179 | 46% | 97 |
| `app/printing/templates/char_test_template.py` | 93 | **4%** | 89 |
| `app/printing/templates/kitchen_ticket.py` | 250 | 66% | 85 |
| `app/printing/templates/driver_ticket.py` | 90 | 12% | 79 |
| `app/services/demo_seeder.py` | 81 | 11% | 72 |
| `app/api/routes/printing.py` | 115 | 38% | 71 |
| `app/printing/test_print.py` | 70 | **0%** | 70 |
| `app/api/routes/system.py` | 94 | 29% | 67 |

Financial primitives are healthy:

- `app/core/money.py` — 88%
- `app/core/financial_invariants.py` — 85%
- `app/core/projections.py` — 92%
- `app/core/events.py` — 95%
- `app/core/event_ledger.py` — 91%
- `app/core/adapters/payment_validator.py` — 100%
- `app/core/adapters/payment_manager.py` — 92%
- `app/core/adapters/base_payment.py` — 92%

---

## Phase 2 — Classified gaps

### 🔴 Critical financial — 8 gaps

Money-path code with plausible drift risk. All sit directly next to the
code we hardened in the main financial audit.

| # | File | Lines | What's uncovered |
|---|---|---|---|
| 🔴1 | `backend/app/api/routes/payment_routes.py` | 206-208, 218-296 | `/sale` endpoint — entire card-sale path including the overage-as-tip clamp (245-272) and auto-close-on-fully-paid (284-294). Zero tests. |
| 🔴2 | `backend/app/api/routes/payment_routes.py` | 679-722 | `/batch-settle` non-mock path — the C3 reconciliation + 2dp fix added in the main audit. Zero tests. The whole invariant gate is untested. |
| 🔴3 | `backend/app/api/routes/payment_routes.py` | 324, 327, 330, 334, 453, 459, 470, 594, 605 | Guard-clause branches on `/cash`, `/tip-adjust`, `/refund`: order-not-found, order-closed, already-fully-paid, non-confirmed payment, negative tip. |
| 🔴4 | `backend/app/api/routes/orders.py` | 1892-1946 | `adjust_tip_on_order` — order-scoped tip-adjust endpoint. Entire handler untested, including the M2 `money_round(previous_tip)` fix and device-sync block. |
| 🔴5 | `backend/app/api/routes/orders.py` | 1405-1430 | `close_batch` auto-close/auto-void loop for lingering open orders. |
| 🔴6 | `backend/app/api/routes/orders.py` | 1556-1577 | `close_day` auto-close/auto-void loop — same pattern at day-close. |
| 🔴7 | `backend/app/api/routes/orders.py` | 1127-1163 | `void_order` card-reversal loop — calls `device.initiate_void()` per confirmed card payment and emits `cash_refund_due` for cash ones. |
| 🔴8 | `backend/app/api/routes/reporting.py` | 359-555 | `get_sales_summary` body — hourly buckets, last-week compare, peak-hours heatmap, top items/servers, tip buckets, category breakdown, server-specific tipout + take-home. `_aggregate_orders` is gated underneath; the composition layer is not. |

**Headline:** C3 (`batch-settle`) and the M2 tip-adjust flow have ZERO
test coverage — they're production gates with unproven behavior.

### 🟠 Core state — 5 gaps

| # | File | Lines | Notes |
|---|---|---|---|
| 🟠1 | `backend/app/api/routes/orders.py` `patch_order` | 655-683 | PATCH /orders/{id}: server transfer, customer_name, guest_count. |
| 🟠2 | `backend/app/services/print_context_builder.py` tip-out | 375-413 | Tip-out preset branch in `build_server_checkout_context`. Only runs when `tip_out_presets` is configured (empty by default). Aggregator gate runs after — lower risk. |
| 🟠3 | `backend/app/api/routes/printing.py` | 34-253 | Printing endpoints: most of the router body. Exercised in-browser, not in pytest. |
| 🟠4 | `backend/app/api/routes/system.py` | 29% (67 missing) | System/health endpoints. |
| 🟠5 | `backend/app/api/routes/hardware.py` / `config.py` | 62% / 64% | Device scan/save + config CRUD — lots of branches on DB state. |

### 🟡 Adapter / I/O — 4 families

Hardware-only paths. Acceptable as-is, or mock-and-assert the XML
construction for targeted verification of the C4 `money_round` fixes.

| File | Lines | Notes |
|---|---|---|
| `backend/app/core/adapters/dejavoo_spin.py` | 59-194, 241-286 | Every transaction method (`initiate_sale`, `refund`, `void`, `adjust_tip`, `close_batch`, `_send`) uncovered. **All testable by monkey-patching `_send`** to verify XML construction — would lock in C4 at compile-time. |
| `backend/app/api/routes/payment_routes.py` real-device | 52-83, 109-114, 124-152, 158-195 | `_ensure_devices` real branch, `/reload-devices`, `/test-device`, `/spin-diag`. |
| `backend/app/scanner/printer_detector.py` | 21% | Hardware scan paths. |
| `backend/app/core/adapters/mock_thermal.py` / `mock_impact.py` | 70% / 75% | Error-injection branches used by chaos tests. |

### ⚪ Utility — accept

Presentation / template / error-text code. Gap is expected; tests
here would be brittle (assert on rendered bytes).

- `print_context_builder.py` receipt/kitchen/clock-hours builders (65-112, 153-195, 729-833)
- `app/printing/templates/guest_receipt.py` (74%)
- `app/printing/templates/kitchen_ticket.py` (66%)
- `app/api/routes/reporting.py` weekly-hours branches (645-691) — non-monetary labor hours (use `round(delta, 1)` intentionally)
- `app/core/financial_invariants.py` error-message branches — only hit in violation scenarios; the logic is fully exercised

### 🗑 Dead-code candidates — **this is the list the next chat should verify**

Each candidate was classified via full-repo grep for imports. The
rationale below is a first-pass assessment. The next chat should
confirm each one independently before deleting.

| # | Path | Stmts | First-pass rationale | Needs verification because… |
|---|---|---:|---|---|
| 🗑1 | `backend/app/core/adapters/test_payment_system.py` | 44 | Standalone `asyncio.run()` script. File lives under `app/` but its name starts with `test_` — appears to be a misplaced dev smoke-test. Grep `from app.core.adapters.test_payment_system` / `import test_payment_system` → **zero matches repo-wide**. | Worth confirming no tooling outside Python imports it (shell script, Makefile, Docker entrypoint, docs). |
| 🗑2 | `backend/app/printing/test_print.py` | 70 | Self-described standalone CLI (`# This allows running from project root: python core/backend/app/printing/test_print.py ...`). Grep for imports → **zero matches**. | Confirm no scripts/Makefile target invokes it. |
| 🗑3 | `backend/app/printing/templates/char_test_template.py` (`CharacterTestTemplate`) | 93 | Only importer in grep: the dead 🗑2 and the re-export in `app/printing/templates/__init__.py`. No code that actually **calls** `CharacterTestTemplate()` in production. | Verify `__init__.py` re-exports aren't consumed by any unlisted caller (dynamic dispatch, config-driven, frontend send). |
| 🗑4 | `backend/app/printing/templates/driver_ticket.py` (`DriverTicketTemplate`) | 90 | Same pattern — only re-exported in `__init__.py`. Grep for `DriverTicketTemplate(` or `'driver_ticket'` → only the class definition + `__init__.py`. | Same — check for dynamic template resolution (e.g. a map `{order_type: template_class}`). |
| 🗑5 | `backend/app/printing/templates/driver_receipt.py` (`DriverReceiptTemplate`) | 44 | Only importer: 🗑2 and `__init__.py`. | Same verification. |
| 🗑6 | `backend/app/printing/templates/delivery_kitchen.py` (`DeliveryKitchenTicketTemplate`) | 41 | Only importer: 🗑2 and `__init__.py`. Note: `DeliveryReceiptTemplate` (separate file) IS used. | Same — check for a template registry or FE-driven dispatch by name. |
| 🗑7 | `backend/app/printing/logo_utils.py` | 40 | Grep finds only its own docstring header + a **comment** in `escpos_formatter.py:171` ("Pre-baked GS v 0 bitmap bytes from logo_utils.logo_to_escpos_bytes()") — no executable reference. | Confirm no out-of-tree caller and no planned logo feature that references this module. |
| 🗑8 | `backend/app/models/printer_config.py` | 39 | Grep shows references in `app/scanner/printer_detector.py` and `app/api/routes/hardware.py`. **Needs deeper verification** — flagged as dead only because 0% coverage means nothing *runs* it in tests. Could still be live in production startup. | Read the two callers' usage sites and confirm whether the model is actually constructed/consumed, or just imported without use. |
| 🗑9 | `backend/bombard/*` (`mock_menu.py`, `run_bombard.py`, `simulation_engine.py`, `validators.py`) | 953 | Standalone simulation tool. Only internal imports (bombard/run_bombard imports other bombard modules). Not invoked by any pytest path. | **Recommend excluding from `--cov`, not deleting** — the simulation has value as a dev smoke tool. Action: add `[tool.coverage.run] omit = ["bombard/*"]` or drop `--cov=bombard` from audit runs. |

**Effective-coverage impact of dead-code cleanup:**

- 🗑1–🗑7 delete: **~422 stmts** removed from the tree. Test baseline unchanged. Coverage jumps from **63% → ~68%** just by removing uncovered dead code.
- 🗑9 excluded from coverage: another **~953 stmts** out of the denominator. Coverage lifts to **~74%**.

Combined, **effective coverage climbs 63% → ~74% before writing a single new test**.

---

## Running rollup

| Bucket | Gaps | Stmts | Action |
|---|---:|---:|---|
| 🔴 CRITICAL FINANCIAL | 8 | ~483 | Write targeted tests |
| 🟠 CORE STATE | 5 | ~349 | Write tests where fixtures exist |
| 🟡 ADAPTER / I/O | 4 | ~482 | Selective mocks for C4 XML verification |
| ⚪ UTILITY | many | ~300 | Accept |
| 🗑 DEAD | 9 | ~1,453 | Delete (🗑1-🗑8) or exclude (🗑9) |

---

## Suggested next-chat checklist (dead-code pass)

For each 🗑N entry:

1. **Re-run the grep** yourself to confirm no importers outside of:
   - the file itself (docstring examples)
   - `templates/__init__.py` re-exports (these follow the dead file if the class isn't called)
   - other dead files (🗑2 is the usual suspect)
2. **Check for dynamic dispatch** — search the whole repo (incl.
   frontend `/terminal/`, `/overseer/`, `/kindnostic/`) for string
   literals matching class names (`"DriverTicketTemplate"`) or module
   paths (`"driver_receipt"`). Python's `getattr`/`importlib` and
   JS-side API calls can bypass grep for symbol names.
3. **Check runtime entrypoints** — `Dockerfile`, `Makefile`, shell
   scripts in `scripts/`, CI workflows, `package.json` scripts, any
   `uvicorn`/`gunicorn` wrappers.
4. **For 🗑8 (`printer_config.py`)**: read the two callers and verify
   the model is actually used, not just imported.
5. **Delete in one commit per logical group** (all dead templates
   together, `test_print.py` + `test_payment_system.py` together),
   with a message that records what was verified.
6. **Re-run full test suite** (`pytest -q`) after each deletion — the
   992/0/0 baseline must hold.
7. **Re-run coverage** (`pytest --cov=app -q`) and log the new
   percentage in this file or the feature-branch history.

## For the 🔴 priorities (if working on tests, not deletes)

Start with these in order — lowest new-test count, highest invariant
confidence gained:

1. 🔴2 `/batch-settle` — one test that asserts mock-drift in the
   processor's returned total fails `check_batch_settlement` and the
   response reports `invariant_ok: False` with a non-zero
   `settlement_diff`. (Locks in C3.)
2. 🔴1 `/sale` overage-as-tip — one test that posts a card sale for
   $X > balance_due, asserts (a) the sale amount is clamped to
   balance_due, (b) a TIP_ADJUSTED event for `X - balance_due` lands
   in the ledger. (Locks in the behavior praised in Phase 2 of the
   main audit.)
3. 🔴4 `adjust_tip_on_order` — one test per guard branch + the happy
   path (`money_round(previous_tip)` from M2).

Each of these is a single-file unit test reusing existing
`conftest.py` fixtures (`ledger`, `client`). No new infrastructure
required.

---

## Test-suite baseline

```
992 passed, 3 skipped, 0 warnings, 0 failed
```

Remaining 3 skips are legitimate (guarded on `demo_seed.json`
existence in `test_demo_seeder.py`).

## Relevant prior audit history

- `5b18221` — financial-layer audit shipped (invariants + 2dp gates)
- `3679bc6` — `asyncio_mode = auto` in `pytest.ini`
- `eb702cf` — 2 test setup fixes + 5 `.dict()` → `model_dump()`
- `73e4389` — gitignore `.coverage` / `htmlcov/`
