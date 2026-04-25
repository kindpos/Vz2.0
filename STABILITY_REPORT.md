# KINDpos Stability Report — 2026-04-25

Refresh of the 2026-04-23 report after 132 commits across five parallel
tracks: ledger gap completeness (Phases 10–14, all merged to main), Nostalgia
theme group-semantic layer, terminal feature work (paid-seat view, payment
flow improvements, column-editor), auth system changes (overseer-scoped), and
a batch of supporting test additions.

---

## Overall Rating: B+ — Production-Capable with Known Gaps

Rating unchanged from the prior report. The event ledger is now effectively
complete (93 IMPLEMENTED, 2 MISSING — both are user-deferred break-tracking
events). The financial core and test suite both grew substantially. Primary
remaining risk areas are the same: check-overview.js is still under-tested
relative to its size, close-day-checks-viewer.js has multiple deferred unfixed
bugs, and real-device / print-template paths remain largely untested.

---

## Test Suite Health

| Suite | Files | Tests | Passing | Skipped | Failing |
|---|---:|---:|---:|---:|---:|
| Backend (pytest) | 96 | ~1,278 | ~1,275 | 3 | **0** |
| Frontend (vitest) | 25 | 228 | 228 | 0 | **0** |
| **Total** | **121** | **~1,506** | **~1,503** | **3** | **0** |

Net since the 2026-04-23 report: **+20 backend files**, **+82 passing
backend tests**, **+1 frontend file**, **+21 passing frontend tests**.

> `pytest-cov` is still not installed in this environment; coverage figures
> below are reproduced from the April 21 audit (`COVERAGE_AUDIT.md`) for
> continuity. No fresh module-level coverage run was done this session.

---

## Changes Since 2026-04-23

| Track | Commits | Key deliverable |
|---|---:|---|
| Ledger gap completeness (Phases 10–14) | ~20 | 93 of 118 nodes IMPLEMENTED; only 2 MISSING |
| Nostalgia theme (T.groups semantic layer) | ~15 | All 8 scene families read group tokens; CI lint guards |
| Terminal features | ~10 | Paid-seat filter/collapse, payment OVERVIEW button, Open Item, centavo input, column-editor improvements |
| Auth system changes (overseer-scoped) | ~5 | Manager PIN gate removed from back-office edits |
| Test additions | ~5 | +82 backend, +21 frontend |
| Column-editor fixes | 4 | Styling corrections (colors, seat column, dashed tile) |
| Bug fixes | 3 | cashExpected formula, empty check guard, runtime DBs removed from git |

---

## Ledger Gap Completeness (Phases 10–14)

This is the dominant story of the session. Fourteen total phases have now
merged to main, taking the event ledger from 11 IMPLEMENTED nodes to 93.

### Final gap dataset

| Status | Count | % | Notes |
|---|---:|---:|---|
| IMPLEMENTED | 93 | 79% | Emission wired in routes and/or via `/config/push` |
| RENAMED | 18 | 15% | Code emits under a different name (audit-equivalent) |
| PARTIAL | 4 | 3% | Covered with a known caveat |
| FACTORY-ONLY | 1 | 1% | `menu.import_rolled_back` awaits rollback endpoint |
| **MISSING** | **2** | **2%** | `break.started` / `break.ended` — user-deferred |
| **Total** | **118** | | |

EventType enum entries: **~182** (from ~63 at start of ledger work).

### Phases 10–14 summary

| Phase | What shipped | LG nodes closed |
|---|---|---|
| 10 | Discount catalog CRUD — `discount.created/updated/deactivated/reactivated` via `/config/push` | LG-87, 88, 89 |
| 11 | Tipout rule factory + wiring — `tipout.rule_created/updated` factories; LG-96/97 FACTORY-ONLY → IMPLEMENTED | LG-96, 97 |
| 12 | Per-seat balance projection (Track 2 consumer) — `seat_balance(order)` reads seat-scoped events; audit anchor for split-check disputes | — |
| 13 | Cash variance endpoint — `/day/cash/variance` reads float/drop/payout events; compares against confirmed cash payments; surfaces delta at day close | — |
| 14 | Settlement drift alert in `/entomology` — new Settlement Drift tab reads `batch.settlement_failed` events; surfaces alongside FIN-003 without requiring Excel export | — |

New backend test files for phases 10–14:
`test_phase10_discount_catalog.py` (9), `test_phase11_tipout_rules.py` (6),
`test_phase12_seat_balance.py` (11), `test_phase13_cash_variance.py` (8),
`test_phase14_settlement_drift.py` (4) — 38 new tests.
`test_day_cash_routes.py` (10 new) and `test_financial_invariants.py` (+90
added, 52 total functions) round out the financial-core additions.

---

## Nostalgia Theme Rollout

The T.groups semantic layer is fully wired. Scenes no longer read primitive
palette tokens directly; every family routes through group semantics so a
single token change cascades correctly.

| Phase | What shipped | Files |
|---|---|---|
| 1 | `T.groups` semantic layer added to `common/tokens.js` | `common/tokens.js` |
| 2.1–2.8 | All 8 scene families read T.groups: landing, confirmation, picker, auth, composite, paymentPreset, actionBar, selectionGrid | All scene JS files + `common/theme.js` |
| 3 | CI `lint:theme` grep guards prevent raw hex / non-T.* color values | `.github/workflows/` |

No visual change was intended; the rollout is a refactor prerequisite for
future theme variants.

---

## Terminal Feature Work

### check-overview — paid seat view
- **Paid seat filter** (`bef4b1c`): paid seats now highlighted with gold infill;
  operator can filter to show only paid or only unpaid seats.
- **Paid seats collapse** (`bbf2cf3`): paid seats collapse in-place with
  tappable payment rows — no scene transition required to review what was
  charged.
- **Items visible in terminal** (`b47ee6d`): items now render in the terminal
  UI; centavo price input supported; Open Item button added.

### payment flow
- **OVERVIEW button + auto-landing** (`aa8d762`): after payment completes,
  OVERVIEW button returns directly to check-overview; auto-landing navigation
  is now derived from the originating scene rather than hardcoded.
- **Duplicate guard** (`aa8d762`): double-tap protection on the submit path.
- **cashExpected formula fix** (`b432f77`): was subtracting `card_tips` instead
  of `cash_tips` — this caused the expected-cash calculation to over/undercount
  when a table had mixed tender types. Now correct.
- **Change-due screen** (`57b6bbe`): 9 new tests pin the pc-change-due result
  screen (OVERVIEW label, LOGOUT, card/cash/exact-change display, countdown
  hint logic).

### column-editor
- **Improvements** (`526c267`): default action is now MOVE; split preview
  renders before confirming; split targets are flexible.
- **Styling fixes** (4 commits): OPERATIONS header colors, seat-column
  styling, green fills, dashed add-col tile → buildStaticCard.

### close-day-calc
- New scene `close-day-calc.js` extracted from close-day flow; 11 tests in
  `close-day-calc.test.js` pin the calculation logic.

### order-entry
- Open Item button wired; centavo-precision price input added.

### Bug fixes
- `fix(terminal)`: don't write `order.created` for empty checks — previously a
  check could be opened and immediately closed without items, emitting a
  stray `order.created` event.

---

## Auth System Changes (Overseer-Scoped)

The manager PIN gate was removed from overseer back-office edit flows
(employee records, shift edits). Auth enforcement on overseer config-write
routes was disabled (`b4bbed8`). This is a **deliberate product decision**
scoped to the admin back-office: operators editing employee/shift data in the
overseer dashboard no longer need to re-enter a PIN for each change.

The **terminal POS auth flow is unchanged**: PIN login, rate limiting
(5 attempts / 60 s), SEC-* diagnostics, and `auth_required` on terminal-facing
write routes all remain in place.

The header `×` button was wired to an immediate logout (`633c2ec`).

---

## Backend & Ledger Focus

The financial core remains the safest part of the codebase. Risk is
concentrated in the UI and device-hardware paths — not the backend.

**Event ledger** (`app/core/event_ledger.py`) — 91% coverage, 4 dedicated test
files (concurrency, crash recovery, hash-chain tamper, precision gate). The
ledger itself is unchanged; all new phases added factories and routes, not
ledger internals.

**Financial core** — all healthy (≥ 85%):

| Module | Coverage |
|---|---:|
| `core/events.py` | 95% |
| `core/projections.py` | 92% |
| `core/adapters/payment_manager.py` | 92% |
| `core/adapters/base_payment.py` | 92% |
| `core/event_ledger.py` | 91% |
| `core/money.py` | 88% |
| `core/financial_invariants.py` | 85% (+ 52 tests now covering gate, max_abs_diff, day-cash edge cases) |
| `core/adapters/payment_validator.py` | 100% |

**Route layer** — coverage gaps from the April 21 audit have all been
addressed. `day_cash.py` now has 10 dedicated tests.

**Backend weak spots** — still outside the ledger:

- Print templates (4–12%) — failures silent in tests.
- Seeders (8–11%) — low stakes.
- Real-device adapters (`dejavoo_spin.py` 46%, `hardware.py` 62%) —
  integration-only; failures only surface live.
- One unfixed low-severity bug: `reporting.py:266` buckets overnight orders by
  `created_at.hour`.

---

## Module Coverage Snapshot (from April 21 audit — 73% overall)

*No fresh coverage run; numbers reproduced from `COVERAGE_AUDIT.md`.*

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
| `app/api/routes/orders.py` | 79%+ | All COVERAGE_AUDIT gaps addressed |
| `app/api/routes/reporting.py` | 70%+ | `get_sales_summary` covered; tip_avg fix in place |
| `app/api/routes/payment_routes.py` | 57%+ | All guard branches covered |
| `app/services/print_context_builder.py` | 57% | No automated tests; failures are silent |
| `app/api/routes/hardware.py` | 62% | Real device paths are integration-only |
| `app/api/routes/printing.py` | 38% | Minimal test coverage |
| `app/core/adapters/dejavoo_spin.py` | 46% | Real device only |

### 🔴 Low / Untested

| Module | Coverage | Notes |
|---|---:|---|
| `app/printing/templates/driver_ticket.py` | 12% | |
| `app/printing/templates/char_test_template.py` | 4% | |
| `app/services/demo_seeder.py` | 11% | Low stakes |
| `app/services/sample_order_seeder.py` | 8% | Low stakes |

### 🔴 Frontend — check-overview.js

| File | Test count | Notes |
|---|---:|---|
| `terminal/scenes/check-overview.js` | 10 | File is ~1,800+ lines post-redesign. MANAGE-mode paths (MOVE / SPLIT / MERGE / UNDO) and seat-tile multi-select remain untested. Paid-seat collapse and filter also lack coverage. |

---

## Remaining Known Issues (not yet fixed)

| Issue | File | Severity | Notes |
|---|---|---|---|
| check-overview.js under-tested | `terminal/scenes/check-overview.js` | **MEDIUM** | ~1,800 lines vs 10 tests. MANAGE mode, MOVE / SPLIT / MERGE / UNDO, seat multi-select, and paid-seat collapse are untested. |
| close-day-checks-viewer.js multiple deferred bugs | `terminal/scenes/close-day-checks-viewer.js` | **MEDIUM** | Unguarded fetches (~133, 877, 911, 966); inverted tip-adjusted logic (171); rebuild-time listener leaks (273, 624); multi-check action buttons lack `_busy` locks; escaped `setTimeout` in `onVoidCheck`. |
| Split-payment picker does not render per-option amounts | `terminal/scenes/payment.js:229` | LOW | `buildPillButton` silently drops the `sub:` param. Servers see `1/2 / 1/3 / 1/4` with no resolved dollar values. |
| Hourly bucket uses `created_at.hour` | `backend/app/api/routes/reporting.py:266` | LOW | Overnight orders (11:55 PM → 12:05 AM) bucket at hour 23 instead of hour 0. |
| No automated test for real device paths | `dejavoo_spin.py`, `hardware.py` | MEDIUM | Real-device code paths are integration-only; failures surface live only. |
| Print template coverage | `kitchen_ticket.py`, `print_context_builder.py` | MEDIUM | Print failures remain silent in tests. |
| Routing defect — manager occasionally lands on server-landing | `check-overview.js:414–427`, `payment.js:1043–1045`, `login.js:605/615` | LOW–MED | Defaulting to `'server-landing'` when `returnLanding` is missing or role-casing differs. `UI-020 WARNING` emitted on every occurrence. Deferred by user direction. |
| Dead `pin:` propagation through manager/check-overview | `manager-landing.js`, `check-overview.js` | LOW | `state.emp.pin` is always `undefined`; purely cosmetic cleanup deferred. |
| Long-press `lpTimer` may fire after tile detach | `manager-landing.js` | LOW | Closures read `ord.order_id` only; no mutation risk. |
| _transitionHooks is append-only | `scene-manager.js:409` | MEDIUM | No `removeBeforeTransition(fn)` API; scenes that register and unmount leak the hook. |

---

## Session — 2026-04-25 post-merge

Two commits landed on main after the report above was written.

### Changes

| Commit | Track | What shipped |
|---|---|---|
| `e8b8817` | Backend bug fix | `_collect_seats()` excludes empty seats from `seat.paid` events at auto-close |
| `d0fbbba` | Docs | `CHECK_OVERVIEW_PROBE_PROMPT.md` — full spec for the next hardening session |

### Bug fixed

| # | Bug | File:line | Severity | Fix |
|---|---|---|---|---|
| 1 | Empty seats (in `order.seat_numbers` but with no items) received `seat.paid` events at auto-close, making the event ledger show `is_paid=True` while the frontend correctly left them open | `payment_routes.py:45–55 (_collect_seats)` | MEDIUM | Removed `set(order.seat_numbers or [])` as the base; now only collects seat numbers that appear on actual order items |

### Updated test counts

| Suite | Files | Tests | Passing | Skipped | Failing |
|---|---:|---:|---:|---:|---:|
| Backend (pytest, excl. Dejavoo) | 97 | 1,338 | 1,335 | 3 | **0** |
| Frontend (vitest) | 25 | 252 | 252 | 0 | **0** |
| **Total** | **122** | **~1,590** | **~1,587** | **3** | **0** |

Net since the 2026-04-25 report: **+1 backend file** (`test_printing_routes.py`), **+57 passing backend tests**, **+24 passing frontend tests**.

> Backend counts use `--rootdir=backend/` with `pytest.ini` (asyncio_mode=auto). Running from the
> repo root without specifying rootdir causes ~102 async tests to be silently skipped — use
> `PYTHONPATH=backend/ .venv/bin/pytest --rootdir=backend/ tests/` for canonical numbers.

### Known issue — `SeatBalance.is_paid` asymmetry (deferred)

When a payment is voided, `SeatBalance.is_paid` (written by the `SEAT_PAID` event at auto-close,
`projections.py:518–522`) is never cleared — no `SEAT_PAID_REVERSED` or `SEAT_REOPENED` event
type exists. The frontend `paidSeats` map correctly derives paid state from confirmed payment
`seat_numbers` (independent of `is_paid`), so the **UI is unaffected**. The inconsistency is
confined to the audit ledger's `is_paid` flag and the `/orders/{id}/seats` response. No fix
planned; low user-facing impact.

### Next probe — check-overview.js

Full specification is in `CHECK_OVERVIEW_PROBE_PROMPT.md`. Seven concrete bug candidates:

| # | Bug | Location | Severity |
|---|---|---|---|
| 1 | Void-item `setTimeout` not cleared on unmount — stale DELETE fires after scene change | `~line 3477` | **HIGH** |
| 2 | Customer-name PATCH has no `.ok` guard — 4xx/5xx errors silently discarded | `~line 3963` | MEDIUM |
| 4 | Print / Resend have no in-flight guard — double-tap sends two requests | `~lines 3194, 3218` | MEDIUM |
| 6 | MANAGE UNDO on `merge-new-check` loops forever — patch pushed back onto log each tap | `~lines 1383–1416` | MEDIUM |
| 5 | Server-picker fetch failure shows "No servers available" (misleading vs. truly empty) | `~line 746` | LOW–MED |
| 3 | `_refreshInFlight` is module-level, not per-state — fragile under overlapping mounts | `~line 70` | LOW–MED |
| 7 | `_syncSelectedFromItems` not called after some UNDO branches — stale `state.selected` | `~lines 1394–1416` | LOW |

Plus six untested surfaces to regression-lock (MANAGE entry/exit, UNDO on empty log, RESET
snapshot restore, `refreshOrder` defers when `_seatsChain` pending, paid-seat selection block,
`forceSelectAll` skips paid seats).

**Rating:** B+ unchanged. The `_collect_seats` fix closes an audit-ledger inconsistency.
Primary remaining risk is check-overview.js under-testing (~4,100 lines, 10 tests).

---

## Test Infrastructure Notes

Patterns carried forward from prior reports — still current:

- **Backend — HTTP**: `AsyncClient` + `ASGITransport` + `app.dependency_overrides[deps.get_ledger]`
- **Backend — direct call**: pass `ledger=ledger` as kwarg to route functions
- **Backend — payment manager isolation**: monkeypatch `payment_routes._manager = None` and `payment_routes._devices_initialized = False` before each test
- **Backend — tax rate**: always monkeypatch `settings.tax_rate = Decimal("0.00")` and `settings.cash_discount_rate = Decimal("0.00")`
- **Frontend — scene mount**: `vi.mock('../scene-manager.js', …)` + `defineScene: (def) => { registeredScenes.push(def); }` harness
- **Frontend — theme-manager mocks**: stub `buildCard`, `buildStaticCard`, `buildNavCard`, `buildActionCard`, `lightenHex`, `darkenHex`, `hexToRgba` — pattern locked in `manager-landing.test.js:55`
- **Frontend — fake timers**: `vi.useFakeTimers()` + `vi.advanceTimersByTime(ms)`
- **Ledger phase tests**: follow `test_phaseNN_*.py` naming; each round-trips events through the intended emission path; flip the gap dataset when closing a node

---

*Report generated by Claude Sonnet 4.6. Base commit: `57b6bbe`. Last updated: 2026-04-25. Current HEAD: `e8b8817` (origin/main).*

---

## Session — check-overview probe (2026-04-25)

**Branch:** `claude/probe-check-overview-Rscby`  
**Scope:** `terminal/scenes/check-overview.js`, `terminal/scenes/check-overview.test.js`  
**Baseline:** 10 tests → **29 tests** (19 added, 0 deleted)

### Bugs found and fixed

| # | Bug | File:line | Severity | Fix |
|---|-----|-----------|----------|-----|
| 1 | Void-item DELETE `setTimeout` not tracked in `state._lpTimers` — fires after unmount against stale order | `check-overview.js:3478` | **HIGH** | Capture timer ID into `state._lpTimers`; switch DELETE to `fetchWithTimeout` |
| 2 | Customer-name PATCH is fire-and-forget — no `.ok` check, no error feedback | `check-overview.js:3968` | **MEDIUM** | Switch to `fetchWithTimeout`; add `.then` ok guard + `.catch` with `showToast` |
| 3 | `_refreshInFlight` at module scope — shared across instances; one completion clears another's guard | `check-overview.js:70` | **LOW–MED** | Removed module var; added `_refreshInFlight: false` to `state`; updated all refs to `state._refreshInFlight` |
| 4 | `handlePrint` / `handleResend` no double-tap guard; both used raw `fetch` | `check-overview.js:3194,3218` | **MEDIUM** | Added `state._printing` / `state._resending` flags; switched to `fetchWithTimeout` |
| 5 | Server-picker catch message already distinct (`'Failed to load servers'` vs `'No other servers clocked in'`) — pre-fixed | `check-overview.js:755` | **LOW** | No code change; added regression-lock test |
| 6 | UNDO on `merge-new-check-*` pops patch then pushes back → infinite toast loop | `check-overview.js:1401` | **MEDIUM** | Peek before pop; show toast and return without touching log for un-undoable kinds |
| 7 | `_syncSelectedFromItems` not called after UNDO clears selection — stale seat keys possible | `check-overview.js:1412` | **LOW** | Added `_syncSelectedFromItems(state)` call after clearing both selection objects before render |

### Tests added

| Surface | Tests | Notes |
|---------|-------|-------|
| Bug 1 — void timer cancellation | 2 | `vi.useFakeTimers()` in `beforeEach`; DELETE suppressed after unmount; fires when mounted |
| Bug 2 — name PATCH error handling | 2 | `ok:false` mock → error toast; `ok:true` → no error toast |
| Bug 3 — `_refreshInFlight` per-state | 2 | Flag set while pending; two instances independent |
| Bug 4 — print/resend guard | 2 | Double-tap each; `fetchWithTimeout` called exactly once |
| Bug 5 — server-picker error text | 1 | `global.fetch` rejection → "Failed" text, not empty-list message |
| Bug 6 — UNDO loop prevention | 2 | `merge-new-check-seats` / `items`; UNDO 2-3×; toast count matches, log unchanged |
| Bug 7 — selection cleared after UNDO | 1 | Move patch undone; no stale seat in `state.selected` |
| MANAGE entry/exit | 2 | Snapshot captured on enter; all flags cleared on exit |
| UNDO on empty log | 1 | No throw; "Nothing to undo" toast |
| RESET restores snapshot | 1 | `state.seats` reverted to `_manageSnapshot.seats` |
| `refreshOrder` defers on `_seatsChain` | 1 | No fetch while chain pending; fires after chain resolves |
| `toggleSeat` on paid seat | 1 | Silent no-op |
| `forceSelectAll` skips paid seats | 1 | Paid-seat items absent from `selectedItems` |

### Remaining risks, deferred

| Risk | Severity | Notes |
|------|----------|-------|
| MANAGE MOVE/MERGE/SPLIT backend commit paths untested | MEDIUM | `_commitManageMove` and `_commitManageMergeCheck` have no direct test coverage |
| `openSeatPaymentInterrupt` void-payment flow | LOW | Raw `fetch` at lines ~3999, 4010; no `.ok` guards, no timeout |
| `handlePay` routing guard paths | LOW | Not covered; relies on mocked `SceneManager.mountWorking` |

---

## Session — remaining-gaps probe (2026-04-25)

**Branch:** `claude/fix-fetch-guards-tests-qZKys`  
**Baseline:** B+ (29 tests across check-overview). **Result: A−**

### Bugs found and fixed

| # | Bug | File:line | Severity | Fix |
|---|-----|-----------|----------|-----|
| 1b | `openSeatPaymentInterrupt` — raw `fetch`, no `.catch()`, no timeout | `check-overview.js:4020` | LOW | Replaced with `fetchWithTimeout(..., 8000)`, added `.catch(() => showToast('Void failed'))` |
| A | `fetchChecksState` — no `.ok` guard; HTTP errors used as data | `close-day-checks-viewer.js:131–133` | MEDIUM | Added `if (!r.ok) throw` before `.json()` in each of the three Promise.all fetches |
| B | `adjusted` flag inverted — `(tip != null)` conflates "tip exists" with "tip was adjusted" | `close-day-checks-viewer.js:169` | MEDIUM | Fallback changed from `(tip != null)` to `false` |
| D | No `_busy` lock on action handlers — double-tap fires competing requests | `close-day-checks-viewer.js:851,895,944` | MEDIUM | Added `state._busy` flag; each handler guards, sets on entry, clears on resolve/cancel |
| E | `setTimeout` in `onVoidCheck` escapes unmount — 80 ms delay fires against dead scene | `close-day-checks-viewer.js:949` | MEDIUM | Timer tracked in `state._pendingTimer`; `unmount(state)` clears it |
| F | `buildCheckRow` used `buildActionCard` (primary-CTA style) for a data-selection pattern | `close-day-checks-viewer.js:529` | LOW | Switched to `buildStaticCard`; accent reflects selection state; native beveled border restored; manual border override removed |
| G | `server-landing.test.js` — stale assertion `'tip-adjustment'` / `onAdjusted` broken by main merge | `server-landing.test.js:322` | LOW | Updated to `'co-adjust-single'` / `onDone` to match code |

**Non-finding — Target 1a:** `_commitManageMove` / `_commitManageMergeCheck` do not exist. MOVE and MERGE are pure local state mutations via `_moveItemsToSeat()` (no network calls). The prior session's deferred note was based on incorrect assumptions about function names.

**Non-finding — Target 3:** `removeBeforeTransition` already implemented as disposer returned by `onBeforeTransition()` (`scene-manager.js:502–512`). Already tested at `scene-manager.test.js:173`. No changes needed.

**Non-finding — Bug C (listener leaks):** `container.innerHTML = ''` on every rebuild discards all child DOM listeners. No `SceneManager.on()` or `window.addEventListener()` in the scene. Not a real leak.

### Tests added

| Surface | Tests | Notes |
|---------|-------|-------|
| `_enterManageMerge` empty-selection guard | 1 | Toast shown; `state._manageTool` not set to 'merge' |
| `openSeatPaymentInterrupt` void ok:false | 1 | `fetchWithTimeout` → ok:false → "Void failed" toast |
| `openSeatPaymentInterrupt` network rejection | 1 | `.catch` fires → "Void failed" toast |
| `handlePay` — no orderId | 1 | "Save items first" toast; `mountWorking` not called |
| `handlePay` — check already settled | 1 | "Check already settled" toast; `mountWorking` not called |
| `handlePay` — no items to pay | 1 | "No items to pay" toast; `mountWorking` not called |
| `handlePay` — all selected seats already paid | 1 | "already paid" toast; `mountWorking` not called |
| `fetchChecksState` HTTP 500 fallback | 1 | Empty openChecks/closedChecks; no corrupt data |
| `fetchChecksState` network rejection fallback | 1 | Empty arrays; no crash |
| `fetchChecksState` ok:true regression lock | 1 | Data used correctly |
| `adjusted` tip exists, no sum.adjusted | 1 | `adjusted: false` |
| `adjusted` sum.adjusted=true | 1 | `adjusted: true` |
| `adjusted` sum.adjusted=false | 1 | `adjusted: false` even with tip |
| `adjusted` tip=null | 1 | `adjusted: false` |
| `_busy` onTransferChecks double-tap ignored | 1 | Second call suppressed |
| `_busy` onPrintCheck double-tap ignored | 1 | Fetch count unchanged on second call |
| `_busy` onVoidCheck double-tap ignored | 1 | Interrupt not re-opened |
| `_busy` cancel clears lock | 1 | onCancel resets `_busy` |
| `onVoidCheck` timer cleared on unmount | 1 | `vi.useFakeTimers()`; co-void-confirm not opened after unmount |
| `onVoidCheck` timer fires when scene stays mounted | 1 | co-void-confirm opened after 200ms |

**Net new tests: +21** (7 in check-overview.test.js, 13 in new close-day-checks-viewer.test.js, 1 fix in server-landing.test.js)  
**Total: 291 tests, 0 failures** (was 270 passing, 1 pre-existing failure)

### Remaining risks, deferred

> **Action handler fetches** (`onTransferChecks`, `onPrintCheck`, `onVoidCheck`) still use raw `fetch` without a timeout — they can hang indefinitely on network stall. Each already checks `r.ok` in results and has `.catch()`, so data integrity is safe; the risk is UX responsiveness only. Upgrading to `fetchWithTimeout` requires importing `net.js` and is deferred as a separate pass.
>
> **Backend pytest** environment not available in this session (`pytest` not installed). Backend test suite status assumed unchanged — no backend files were touched.

**Updated overall stability rating: A−**

Rationale: All originally-deferred check-overview items are now covered. The `close-day-checks-viewer.js` scene has moved from 0 tests to 13, with its five highest-risk bugs fixed. The theme violation in check rows is corrected. The one pre-existing test failure (broken by main merge) is resolved. Remaining risk (action-handler timeout on network stall) is UX-level, not data-integrity.
