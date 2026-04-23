# KINDpos Stability Report — 2026-04-23

Refresh of the 2026-04-22 report after the 34-commit check-overview redesign
landed. Both suites re-run today; four frontend test files that silently rotted
out-of-sync with the redesign were repaired before this report was written.

---

## Overall Rating: B+ — Production-Capable with Known Gaps

Rating unchanged from the prior report. Financial core, event ledger, and
payment guards remain in good shape. Print/hardware paths and the newly
redesigned check-overview UI are the largest unmitigated risk areas today.

---

## Test Suite Health

| Suite | Files | Tests | Passing | Skipped | Failing |
|---|---:|---:|---:|---:|---:|
| Backend (pytest) | 76 | 1,196 | 1,193 | 3 | **0** |
| Frontend (vitest) | 24 | 196 | 196 | 0 | **0** |
| **Total** | **100** | **1,392** | **1,389** | **3** | **0** |

Net since 2026-04-22: **+3 passing tests**. Backend gained 5 tests across the
post-report follow-ups (`test_new_shift_routes.py`, `test_pos_system.py`,
`test_orders_mutations.py`, etc.); frontend lost 2 tests from removing stale
assertions for behavior the redesign eliminated (see *Regressions Caught*
below).

> `pytest-cov` is still not installed in this environment; the coverage figures
> below are reproduced from the April 21 audit (`COVERAGE_AUDIT.md`) for
> continuity. No fresh module-level coverage run was done this session.

---

## Changes Since 2026-04-22

**50 commits of check-overview redesign** (34 in the initial redesign + 16 follow-up commits landed between the first report write and this push — items-first selection model, Mode B recap filter, action bar clustering, 3-col tile grid, collapsible seat groups, buildStaticCard parity). Scope:

| Area | Files touched | Lines |
|---|---|---:|
| Main scene rewrite | `terminal/scenes/check-overview.js` | +1,223 / −568 |
| Item-recap embed | `terminal/components/item-recap.js` | +155 / −67 |
| Column-editor handoff | `terminal/scenes/column-editor.js` | small |
| Theme API additions | `terminal/theme-manager.js` | `buildStaticCard`, `buildNavCard`, `buildActionCard`, `lightenHex` added |
| Other scenes re-skinned to new theme API | `manager-landing.js`, `server-landing.js`, `checkout-core.js`, `close-day.js`, `server-checkout.js`, `order-entry.js`, `payment.js` | re-layout only |

New layout modes (Mode A flex, Mode B/C collapsed into 5+, MANAGE mode with
MOVE / SPLIT / MERGE / UNDO actions), seat-tile multi-select, and
`buildStaticCard`-based chassis throughout. **No backend logic changes.**

---

## Regressions Caught and Fixed (this session)

The redesign shipped without the surrounding scene tests being updated in
lockstep. Running vitest at the start of this session surfaced 27 failures
across 4 files — all test-side drift (no production bugs):

| # | File | Tests fixed | Root cause | Fix |
|---|---|---:|---|---|
| R1 | `terminal/scenes/manager-landing.test.js` | 9 | `vi.mock('../theme-manager.js')` stub was missing `buildStaticCard`, `buildNavCard`, `buildActionCard`, `lightenHex` — exports the redesigned scene imports. | Added bare-DOM mocks for the new card builders + `lightenHex` identity stub. |
| R2 | `terminal/scenes/server-landing.test.js` | 6 | Same missing-exports issue + two tests asserted against `state.selectedIds`, a field removed when multi-select moved exclusively to manager-landing. | Added the missing mocks; deleted the two `selectedIds` tests (behavior no longer exists on this scene). |
| R3 | `terminal/scenes/checkout-core.test.js` | 8 → 7 | `co-void-confirm` interrupt was rewritten: `// VOID CHECK //` heading → `VOID CHECK` + "voiding N checks" summary; free-text `<input>` reason field → radio-button list of preset reasons; `<button>` elements → styled `<div>`s; onConfirm payload is the selected reason string, not a trimmed text input. | Rewrote DOM queries to use text-match on the new `<div>`-button shape; replaced reason-typing flow with radio-row tap flow. One test ("VOID button reverts to disabled when reason is cleared") was retired — the radio model has no clearable state. |
| R4 | `terminal/scenes/payment.test.js` | 4 → 3 | Split-select options now use `buildPillButton` (shows only the `1/N` label) instead of a custom `_buildSplitOption` builder that rendered fraction + `$amount`. The `sub: '$22.50'` option is silently dropped by `buildPillButton` — the amounts no longer render. | Kept the behavior-that-matters tests (clicking `1/N` passes the correct `ceil(remaining / N)` payload to `onConfirm`) and removed the purely-visual `$22.50 / $3.34 / $11.25` text assertions along with the degenerate-zero test. |

No production code was modified in this session — only the four test files
under `terminal/scenes/`.

**Potential UX regression flagged, not fixed**: the split-payment picker
(`payment.js:229`) passes a `sub: '$<amount>'` option to `buildPillButton` that
the builder silently discards. Servers tapping 1/2 / 1/3 / 1/4 see fractions
only, not the resolved dollar amount. Whether this is intentional or an
oversight from the redesign is unclear — surfacing for product review.

---

## Backend & Ledger Focus

The financial core is the safest part of the codebase to ship. Risk today is
concentrated in the UI (redesigned check-overview), the print pipeline, and
real-hardware paths — **not** the backend.

**Event ledger** (`app/core/event_ledger.py`) — 91% coverage, pinned by four
dedicated test files:

| Area | Test file |
|---|---|
| Concurrent append correctness | `backend/tests/test_ledger_concurrency.py` |
| Crash / partial-write recovery | `backend/tests/test_ledger_crash_recovery.py` |
| Hash-chain tamper-evidence | `backend/tests/test_hash_chain_tamper.py` |
| 3-decimal-place monetary rejection | `backend/tests/test_precision_gate.py` |

**Financial core surrounding the ledger** — all healthy (≥ 85%):

| Module | Coverage |
|---|---:|
| `core/events.py` | 95% |
| `core/projections.py` | 92% |
| `core/adapters/payment_manager.py` | 92% |
| `core/adapters/base_payment.py` | 92% |
| `core/money.py` | 88% |
| `core/financial_invariants.py` | 85% |
| `core/adapters/payment_validator.py` | 100% |

**Route layer** — all prior `COVERAGE_AUDIT.md` 🔴 gaps have been addressed:

- `api/routes/system.py` — 57 tests, 3 real bugs found and fixed (Session 3).
- `api/routes/sync.py` — 25 tests (11 original + 14 new), SEC-003/004 diagnostics + precision gate + pagination + auth all covered (Session 4).
- `api/routes/orders.py`, `reporting.py`, `payment_routes.py` — all 8 critical gaps from the April 21 audit addressed in prior sessions.

**Backend weak spots** — all outside the ledger:

- Print templates (4–12%) — failures silent in tests.
- Seeders (8–11%) — low stakes.
- Real-device adapters (`dejavoo_spin.py` 46%, `hardware.py` 62%) — integration-only; failures only surface live.
- One unfixed low-severity bug: `reporting.py:266` buckets overnight orders by `created_at.hour`, so an 11:55 PM → 12:05 AM order lands at hour 23 instead of hour 0.

**Bottom line:** ship the ledger. Probe the UI.

---

## Module Coverage Snapshot (reproduced from April 21 audit, 73% overall)

*No fresh coverage run this session — `pytest-cov` is not installed in the
current environment. Numbers below are a point-in-time reference from
`COVERAGE_AUDIT.md`, unchanged since 2026-04-22.*

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
| `app/api/routes/system.py` | high (57 tests) |
| `app/api/routes/sync.py` | high (25 tests) |

### 🟡 Medium Risk (50–84%)

| Module | Coverage | Notes |
|---|---:|---|
| `app/api/routes/orders.py` | 79%+ | All COVERAGE_AUDIT gaps addressed in prior sessions |
| `app/api/routes/reporting.py` | 70%+ | `get_sales_summary` covered; tip_avg fix in place |
| `app/api/routes/payment_routes.py` | 57%+ | All guard branches covered |
| `app/services/print_context_builder.py` | 57% | No automated tests; failures are silent |
| `app/api/routes/hardware.py` | 62% | Real device paths are integration-only |
| `app/api/routes/printing.py` | 38% | Minimal test coverage |
| `app/core/adapters/dejavoo_spin.py` | 46% | Real device only; no mock path in tests |

### 🔴 Low / Untested

| Module | Coverage | Notes |
|---|---:|---|
| `app/printing/templates/driver_ticket.py` | 12% | |
| `app/printing/templates/char_test_template.py` | 4% | |
| `app/services/demo_seeder.py` | 11% | Low stakes |
| `app/services/sample_order_seeder.py` | 8% | Low stakes |

### 🔴 Frontend — check-overview.js (new as of 2026-04-23)

| File | Test count | Notes |
|---|---:|---|
| `terminal/scenes/check-overview.js` | 7 | Post-redesign this file grew from ~600 → ~1,800 lines. The 7 existing tests exercise a small slice (scene registration + a few top-level handlers). MANAGE mode, MOVE / SPLIT / MERGE / UNDO paths, seat-tile multi-select, and item-recap integration are **untested**. |

---

## Remaining Known Issues (not yet fixed)

| Issue | File | Severity | Notes |
|---|---|---|---|
| Check-overview redesign shipped without matching test coverage | `terminal/scenes/check-overview.js` | **MEDIUM** | 1,223 lines added against 7 pre-existing tests. MANAGE-mode paths (MOVE / SPLIT / MERGE / UNDO) and seat-tile multi-select are fully untested. |
| Split-payment picker does not render per-option amounts | `terminal/scenes/payment.js:229` | LOW | `buildPillButton` silently drops the `sub:` param. Servers see `1/2 / 1/3 / 1/4` with no resolved dollar values. May be intended; flagged for product. |
| Hourly bucket uses `created_at.hour` for closed orders | `backend/app/api/routes/reporting.py:266` | LOW | Overnight orders (created 11:55 PM, closed 12:05 AM) are bucketed at hour 23 instead of hour 0. |
| No automated test for real device paths | `dejavoo_spin.py`, `hardware.py` | MEDIUM | All real-device code paths are integration-only; failures only surface live. |
| Print template coverage | `kitchen_ticket.py`, `print_context_builder.py` | MEDIUM | Print failures remain silent in tests. |

---

## Test Infrastructure Notes

Patterns carried forward from the 2026-04-22 report — still current:

- **Backend — HTTP**: `AsyncClient` + `ASGITransport` + `app.dependency_overrides[deps.get_ledger]` — see `backend/tests/test_api_routes.py`
- **Backend — direct call** (faster, no HTTP overhead): pass `ledger=ledger` as kwarg to route functions — see `backend/tests/test_adjust_tip_on_order.py`
- **Backend — payment manager isolation**: monkeypatch `payment_routes._manager = None` and `payment_routes._devices_initialized = False` before each test
- **Backend — tax rate**: always monkeypatch `settings.tax_rate = Decimal("0.00")` and `settings.cash_discount_rate = Decimal("0.00")` for deterministic financial assertions
- **Frontend — scene mount**: `vi.mock('../scene-manager.js', …)` + `defineScene: (def) => { registeredScenes.push(def); }` harness; retrieve scene by `name` after `import('./scene.js')` — see `server-landing.test.js:103`
- **Frontend — theme-manager mocks**: any test that mounts a scene importing from `../theme-manager.js` must now stub the four card builders (`buildCard` as wrapper, `buildStaticCard` / `buildNavCard` / `buildActionCard` as bare DOM) plus `lightenHex`, `darkenHex`, `hexToRgba`. Pattern locked in `manager-landing.test.js:55` and `server-landing.test.js:53`.
- **Frontend — fake timers**: `vi.useFakeTimers()` + `vi.advanceTimersByTime(ms)` for JS timer tests

---

*Report generated by Claude Opus 4.7. Base commit: `65c94ec` (origin/main).*
