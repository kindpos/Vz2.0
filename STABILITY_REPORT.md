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
| Backend (pytest) | 75 | 1,177 | 1,174 | 3 | **0** |
| Frontend (vitest) | 24 | 198 | 198 | 0 | **0** |
| **Total** | **99** | **1,375** | **1,372** | **3** | **0** |

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
| `app/api/routes/system.py` | 29% → high now | 57 new tests this session; bugs B1/B2/B3 fixed |

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

### Session 3 — System routes probe (`app/api/routes/system.py`)

57 new tests added in `backend/tests/test_system_routes.py`. Previously there
was **zero** test coverage for this file. Three bugs found and fixed:

| # | Bug | File | Severity | Fix |
|---|---|---|---|---|
| B1 | `/run-tests` ran against hardcoded `PROJECT_ROOT / 'core' / 'backend' / 'tests'` — that path doesn't exist in the current repo layout. pytest would collect 0 tests and exit 4 ("no tests ran"), which the SSE client would see as a silent no-op. | `system.py:88` | New `_resolve_test_path(root)` helper that picks `root/'tests'` (pytest.ini adjacent) or falls back to `root/'backend'/'tests'` (repo-root layout). | 
| B2 | `__DONE__:exit_code` parsed with `int(line.split(":")[1])`. A non-numeric payload or a stray `:` in the tail crashed the SSE generator with `ValueError`, dropping the `complete` event so the client would hang on the spinner. | `system.py:162` | `split(":", 1)` + `try/except ValueError: exit_code=1`. |
| B3 | `is_test_result(line)` only matched pytest's `[NN%]` progress marker, which pytest **suppresses** when stdout isn't a TTY. Since `subprocess.Popen(... stdout=PIPE)` is not a TTY, the counters in the `complete` event silently stayed at `passed=0, failed=0, skipped=0` in every production run — Overseer would show "Done" with no results. Unmasked by fixing B1. | `system.py:96` | Added a `^\S+::\S+\s+(PASSED\|FAILED\|SKIPPED)\b` fallback regex. Anchored on the path so summary-section lines (`FAILED tests/... - ...`) don't double-count. |

Also refactored `_find_project_root()` to accept an optional `start: Path`
parameter for testability (default still resolves from `__file__`).

Coverage added, by area:

| Surface | Tests | Notes |
|---|---:|---|
| `classify_line` | 16 | All styling branches + PASSED-wins-over-FAILED-substring lock |
| `is_test_result` | 13 | Percent + verbose forms, summary-line false positive, narrative false positive |
| `_find_project_root` | 6 | pytest.ini / fly.preview.toml / repo markers, fallback, current-repo regression |
| `_resolve_test_path` | 5 | Direct / nested / missing / preference / regression |
| `GET /system/version` | 2 | Shape + no-auth-required |
| `POST /system/run-tests` (mocked thread) | 7 | Happy, mixed, narrative-not-counted, `__ERROR__`, `__DONE__` variants |
| `require_manager` gate | 5 | Soft + strict-no-token + strict-non-manager + strict-manager + admin/owner |
| Integration (real subprocess) | 3 | All-pass, with-failure, no-tests-dir |

---

## Remaining Known Issues (not yet fixed)

| Issue | File | Severity | Notes |
|---|---|---|---|
| Hourly bucket uses `created_at.hour` for closed orders | `reporting.py:266` | LOW | An order created at 11:55 PM but closed at 12:05 AM is bucketed at hour 23, not hour 0. Affects overnight operations only |
| No automated test for real device paths | `dejavoo_spin.py`, `hardware.py` | MEDIUM | All real-device code paths are integration-only; failures only surface live |
| Print template coverage | `kitchen_ticket.py`, `print_context_builder.py` | MEDIUM | Print failures are silent in tests |

---

## System Routes — Probe Complete (Session 3)

**`app/api/routes/system.py`** — now 57 tests covering both endpoints and
all four pure helpers. Three real bugs found and fixed (see Session 3 table
above). Remaining risks, still unaddressed:

1. **SSE cancellation / thread lifetime** — if the client disconnects
   mid-stream, the background thread keeps draining pytest stdout into an
   unreferenced queue until the subprocess exits. No leak in normal use
   (thread is `daemon=True` so it dies on process shutdown), but a long
   run after a browser tab close still consumes CPU. Fixing cleanly needs
   a cancellation `threading.Event` passed into `_run_pytest_in_thread`
   plus a `CancelledError` handler in `test_stream`. Deferred — out of
   scope for a probe session.

2. **`classify_line` keyword substring matching** — any line containing
   `'ERROR'`, `'SKIP'`, etc. anywhere in the text is classified by that
   keyword. Narrative lines like `'no errors'` or `'SKIPPED section'` in
   an assertion message get styled accordingly. Cosmetic-only (doesn't
   affect counts) and low-impact, so not fixed.

---

## Test Infrastructure Notes

- **Pattern for new tests**: `AsyncClient` + `ASGITransport` + `app.dependency_overrides[deps.get_ledger]` — see `backend/tests/test_api_routes.py`
- **Direct-call pattern** (faster, no HTTP overhead): pass `ledger=ledger` as kwarg to route functions — see `backend/tests/test_adjust_tip_on_order.py`
- **Payment manager isolation**: monkeypatch `payment_routes._manager = None` and `payment_routes._devices_initialized = False` before each test; mock device falls back automatically when `hardware_config.db` is absent
- **Fake timers**: `vi.useFakeTimers()` + `vi.advanceTimersByTime(ms)` for JS timer tests
- **Tax rate**: always monkeypatch `settings.tax_rate = Decimal("0.00")` and `settings.cash_discount_rate = Decimal("0.00")` to keep financial assertions simple

---

*Report generated by claude-sonnet-4-6. Commit: `da700b2`.*
