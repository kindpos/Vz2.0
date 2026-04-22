# KINDpos Stability Report — 2026-04-22

Generated after a two-session probe-and-harden pass covering all critical
financial paths, landing pages, and backend coverage gaps.

---

## Overall Rating: B+ — Production-Capable with Known Gaps

The financial core, event ledger, and payment guards are in good shape.
Print/hardware paths remain the largest unmitigated risk area.

---

## Test Suite Health

| Suite | Files | Tests | Passing | Skipped | Failing |
|---|---:|---:|---:|---:|---:|
| Backend (pytest) | 74 | 1,120 | 1,117 | 3 | **0** |
| Frontend (vitest) | 24 | 198 | 198 | 0 | **0** |
| **Total** | **98** | **1,318** | **1,315** | **3** | **0** |

> `pytest-cov` is not installed; the 73% coverage figure is from the April 21
> audit (`COVERAGE_AUDIT.md`). Financial core modules measured individually
> at that time.

---

## Module Coverage Snapshot (from April 21 audit, 73% overall)

### ✅ Healthy (≥ 85%)

| Module | Coverage |
|---|---:|
| `app/core/events.py` | 95% |
| `app/core/projections.py` | 92% |
| `app/core/adapters/payment_manager.py` | 92% |
| `app/core/adapters/base_payment.py` | 92% |
| `app/core/event_ledger.py` | 91% |
| `app/core/money.py` | 88% |
| `app/core/financial_invariants.py` | 85% |
| `app/core/adapters/payment_validator.py` | 100% |

### 🟡 Medium Risk (50–84%)

| Module | Coverage | Notes |
|---|---:|---|
| `app/api/routes/orders.py` | 79% → higher now | All 8 COVERAGE_AUDIT gaps addressed this session |
| `app/api/routes/reporting.py` | 70% → higher now | `get_sales_summary` now tested; tip_avg bug fixed |
| `app/api/routes/payment_routes.py` | 57% → higher now | All guard branches now tested |
| `app/services/print_context_builder.py` | 57% | No automated tests; failures are silent |
| `app/api/routes/hardware.py` | 62% | Real device paths are integration-only |
| `app/api/routes/printing.py` | 38% | Minimal test coverage |
| `app/core/adapters/dejavoo_spin.py` | 46% | Real device only; no mock path in tests |

### 🔴 Low / Untested

| Module | Coverage | Notes |
|---|---:|---|
| `app/api/routes/system.py` | 29% | **Target for next probe session** |
| `app/api/routes/sync.py` | unknown | Not audited |
| `app/printing/templates/driver_ticket.py` | 12% | |
| `app/printing/templates/char_test_template.py` | 4% | |
| `app/services/demo_seeder.py` | 11% | Low stakes |
| `app/services/sample_order_seeder.py` | 8% | Low stakes |

---

## Bugs Found and Fixed (this session)

### Session 1 — Landing page probe

| # | Bug | File | Severity | Fix |
|---|---|---|---|---|
| 1 | `_voidPendingKey` bypass — switching check selection between first and second void tap skipped the safety confirmation entirely | `manager-landing.js` | **HIGH** | Track pending key as sorted joined IDs; mismatch = new first tap |
| 2 | `_merging` double-submit — no in-flight guard on Merge action | `manager-landing.js` | **MEDIUM** | Added `_merging` flag; rapid second tap is swallowed |

### Session 2 — Backend coverage gaps

All 8 🔴 critical gaps from `COVERAGE_AUDIT.md` addressed:

| Gap | Area | Tests Added |
|---|---|---:|
| 🔴1 | `/sale` — overage-as-tip clamp, auto-close, FIN-002 in-flight guard, fully-paid guard | 4 |
| 🔴2 | `/batch-settle` — mock device fast path | 1 |
| 🔴3 | `/cash`, `/tip-adjust`, `/refund` guard branches | 14 |
| 🔴4 | `adjust_tip_on_order` — already covered by prior session | — |
| 🔴5 | `close_batch` auto-close/void loop | 4 |
| 🔴6 | `close_day` auto-close/void loop | 3 |
| 🔴7 | `void_order` — guards + happy path | 5 |
| 🔴8 | `get_sales_summary` — shape, counts, server filter, empty day | 4 |

### Session 2 — Continued probe

| # | Bug | File | Severity | Fix |
|---|---|---|---|---|
| 3 | `tip_avg` inflated — `$0`-tip payments excluded from denominator (`if tip > 0` guard), so average was computed over non-zero tips only | `reporting.py:284` | **MEDIUM** | Removed guard; all confirmed payments contribute |
| 4 | Merge race — target order could be closed by a concurrent payment between the initial validation and the write loop | `orders.py:1390` | **MEDIUM** | Re-fetch + re-validate target immediately before loop; returns 409 on conflict |
| 5 | `_voidPendingTimer` leak — timer not cleared on scene cleanup, could mutate detached state | `manager-landing.js:1194` | **LOW** | `clearTimeout(state._voidPendingTimer)` added to cleanup |
| 6 | `fetchAllData` swallows API errors — `r.json()` called without `r.ok` check; error body silently used as data, dashboard shows zeros with no indication of failure | `manager-landing.js`, `server-landing.js` | **LOW** | `r.ok ? r.json() : Promise.reject(r.status)` on all background fetches |

---

## Remaining Known Issues (not yet fixed)

| Issue | File | Severity | Notes |
|---|---|---|---|
| Hourly bucket uses `created_at.hour` for closed orders | `reporting.py:266` | LOW | An order created at 11:55 PM but closed at 12:05 AM is bucketed at hour 23, not hour 0. Affects overnight operations only |
| No automated test for real device paths | `dejavoo_spin.py`, `hardware.py` | MEDIUM | All real-device code paths are integration-only; failures only surface live |
| Print template coverage | `kitchen_ticket.py`, `print_context_builder.py` | MEDIUM | Print failures are silent in tests |

---

## System Routes — Next Probe Target

**`app/api/routes/system.py`** — 29% coverage, **zero test file exists**.

### What it does

| Endpoint | Auth | Description |
|---|---|---|
| `GET /api/v1/system/version` | None | Returns `settings.app_version` |
| `POST /api/v1/system/run-tests` | Manager-gated | Spawns a `subprocess.Popen` pytest run; streams output via Server-Sent Events (SSE) with `__DONE__:exit_code` sentinel |

### Known surface risks to probe

1. **`_find_project_root()`** — walks parent directories looking for `pytest.ini` or `fly.preview.toml`. What happens in a Docker container where the layout differs? Fallback is `p.parents[5]` which could silently point to the wrong directory, causing pytest to find 0 tests and return a false-green exit code.

2. **`_run_pytest_in_thread` test path** — hardcodes `PROJECT_ROOT / 'core' / 'backend' / 'tests'`. This path segment `'core'` does not exist in the current repo layout (`/home/user/Vz2.0/backend/tests/`). Likely always runs with 0 tests in the current environment.

3. **Queue/thread lifetime** — if the SSE client disconnects mid-stream, the background thread continues running and pushing to the queue forever. No cancellation mechanism.

4. **`require_manager` gate** — with `KINDPOS_AUTH_ENFORCED=false` (test default), the gate is soft. Should verify the gate is hard in production mode.

5. **`classify_line` / `is_test_result`** — regex-based output parsing. No tests. Edge cases: ANSI escape codes (stripped by `--color=no`), multi-line tracebacks, Windows line endings.

6. **Exit code handling** — `int(line.split(":")[1])` on `__DONE__:exit_code`. If pytest outputs a line starting with `__DONE__:` in a traceback, it would be misinterpreted.

---

## Test Infrastructure Notes

- **Pattern for new tests**: `AsyncClient` + `ASGITransport` + `app.dependency_overrides[deps.get_ledger]` — see `backend/tests/test_api_routes.py`
- **Direct-call pattern** (faster, no HTTP overhead): pass `ledger=ledger` as kwarg to route functions — see `backend/tests/test_adjust_tip_on_order.py`
- **Payment manager isolation**: monkeypatch `payment_routes._manager = None` and `payment_routes._devices_initialized = False` before each test; mock device falls back automatically when `hardware_config.db` is absent
- **Fake timers**: `vi.useFakeTimers()` + `vi.advanceTimersByTime(ms)` for JS timer tests
- **Tax rate**: always monkeypatch `settings.tax_rate = Decimal("0.00")` and `settings.cash_discount_rate = Decimal("0.00")` to keep financial assertions simple

---

*Report generated by claude-sonnet-4-6. Commit: `da700b2`.*
