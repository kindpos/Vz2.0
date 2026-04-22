# KINDpos — Frontend Test Harness Plan

**Audience:** next session picking up JS testing.
**State as of this writing:** zero JS tests in the repo. Backend sits at 1063 passing pytest. Every frontend regression we've caught in the stability arc is pinned only by code review, not by a test that would scream if it came back.

This doc exists so the next session can pick the harness, wire the first 20–30 tests, and have a credible coverage story without re-reading the whole probe arc.

**Branch to develop on:** whatever the current session is assigned — don't start a new branch just to scaffold tests. The scaffold + a first batch of tests is one PR.

---

## What's already true

- No `package.json`, no `vitest.config.*`, no `jest.config.*`, no `playwright.config.*` anywhere in `/home/user/Vz2.0`.
- The frontend is vanilla ES modules, no build step. `terminal/` and `overseer/src/` both `import`/`export` natively.
- FastAPI serves the frontend as `StaticFiles` at `/` (terminal) and `/overseer` (overseer), and the JS `fetch`es against `/api/v1/*` on the same origin.
- The terminal and overseer already share one contract-style helper (`auth-client.js`, `entomology-client.js`) that each have explicit `export function` surfaces — easy to unit-test in isolation.

---

## Recommended harness

**Pick Vitest + jsdom.** Rationale:

- ES-modules-native (no transpile step, matches how the code runs in the browser)
- JSDOM bundled, good enough for 95% of our DOM assertions (scene mount / unmount, fetch interceptor behavior, modal teardown)
- Fast; `vi.mock()` is ergonomic for stubbing `fetch`
- Playwright-compatible if you later want a real-browser layer for the scenes that touch `pointerdown`/`pointerup` edge cases

**Skip** Jest (transpile overhead for ES modules), Mocha (older ergonomics), and plain `node --test` (no DOM by default).

Minimum scaffold:

```bash
# Add a package.json at repo root (or /terminal or /overseer — your call)
npm init -y
npm i -D vitest jsdom @vitest/ui
```

Create `vitest.config.js`:
```js
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'jsdom',
    globals: true,
    include: ['terminal/**/*.test.js', 'overseer/**/*.test.js'],
  },
});
```

`npm test` should Just Work. No Babel, no build.

---

## What to test first — ranked by pin-the-regression value

Each item below has a real bug we already fixed. The test should fail if that fix is reverted.

### 1. `terminal/auth-client.js` — fetch interceptor behavior
**What's in there now:** `setToken` / `getToken` / `clearToken` / `getSession` + a `window.fetch` interceptor that auto-attaches `Authorization: Bearer <token>` to `/api/*` requests.

**Tests to write:**
- `setToken(data)` → `getToken()` returns `data.token`
- `clearToken()` after a set → `getToken()` returns `null`
- `installAuthFetchInterceptor()` is idempotent (second call is a no-op)
- Interceptor **does** add `Authorization` for `/api/*` when a token is stored
- Interceptor **does not** add `Authorization` for non-/api/ URLs
- Interceptor **does not clobber** a caller-supplied `Authorization` header
- Interceptor **does not throw** when `sessionStorage.setItem` raises (private mode / quota)
- Queue-on-offline + drain-on-`online` event (same contract lives in `entomology-client.js` — share a helper)

**Why this matters:** if the interceptor regresses, every Overseer config write silently 401s in production.

### 2. `overseer/src/services/auth-client.js` — same as above, plus PIN prompt on 401
Mirror the terminal tests, plus:
- On 401 → `promptManagerPin` fires, calls `/api/v1/auth/verify-pin` via the **unwrapped** fetch (mock `_originalFetch`), stores the returned token, retries the original request **once**
- On 403 → same flow with "Manager role required" prompt text
- `_pinPromptInFlight` dedupes concurrent 401s — two parallel requests both hitting 401 result in one prompt

### 3. `terminal/scene-manager.js` — the interrupt callback + closeInterrupt alias
**Bug we fixed last arc:** user's `onConfirm` in `SceneManager.interrupt('x', { onConfirm: fn })` was silently clobbered by `wrappedConfirm` — 21 call sites across `server-checkout.js` and `close-day-checks-viewer.js` never fired their callbacks.

**Tests to write:**
- `SceneManager.interrupt('scene', { onConfirm: fn })` — sub-scene's `params.onConfirm(data)` must call user's `fn(data)` with the data
- Same for `onCancel`
- `SceneManager.closeInterrupt` is an exported alias of `resolveInterrupt` (both work)
- Opening an interrupt when one is already open **tears down the first** (no DOM leak)
- `openGate` stacking behavior (same fix)
- `_transitionHooks` — the disposer returned by `onBeforeTransition(fn)` removes the hook
- `_emit` doesn't propagate handler throws; logs + emits `UI-002` via `entReport` (stub `entReport`)

### 4. `terminal/entomology-client.js` — offline queue + keepalive
- `entReport` returns a Promise that always resolves (never throws)
- Rejects UI-only contract — any non-UI-* code is dropped client-side (defense in depth; the backend also 400s)
- Queues in-memory when `navigator.onLine === false`
- Drains queue on the `online` event, at most `_QUEUE_MAX` items
- `fetch` options include `keepalive: true` so unload-time reports survive

### 5. `overseer/src/data/sample-payroll.js` — `totalWages` / `totalTips` populated
**Bug we fixed:** the dashboard showed `$0.00` for wages + tips because those two fields were never set on `laborSummary`.

**Tests to write:**
- Fixture with 3 employees → `laborSummary.totalWages === Σ grossPay`, rounded to 2dp
- Same for `totalTips === Σ tips`
- Empty employees → both are `0`, not `undefined`
- Loader-failure path preserves the shape (no `undefined` reaching `fmt$`)

### 6. `overseer/src/sections/labor-reports.js` — per-employee overtime
**Bug we fixed twice:** overtime is a weekly concept (`weekly_hours - 40`), not daily. Once at the KPI, once on the row.

**Tests to write:**
- Employee with `hours: 8, weekly_hours: 50` → row shows `10` hours OT
- Employee with `hours: 50, weekly_hours: 30` → row shows `0` hours OT (daily not counted)
- KPI and row agree

### 7. `terminal/scenes/order-entry.js` — no "null Pepperoni" on kitchen ticket
**Bug we fixed last arc:** a modifier picked before the server tapped ADD/NO/EXTRA had `prefix: null`; raw concat → `"null Pepperoni"` on the kitchen ticket.

**Tests to write:**
- Modifier with `prefix: null` renders as bare label in preview (`commitModifierPanelItem` logic can be called directly)
- Modifier with `prefix: 'ADD'` renders as `"ADD Pepperoni"`
- Modifier with `prefix: 'NO'` has `price: 0` and `charged: false` regardless of `m.price`

### 8. `terminal/scenes/login.js` — 429 surfaces distinctly
**Bug we fixed:** 429 (rate-limited) used to show "INVALID PIN", identical to a wrong-PIN entry. Managers retyped correct PINs thinking they were typo'd.

**Tests to write:**
- Mock `fetch('/api/v1/auth/verify-pin')` → 429 → numpad shows "TOO MANY ATTEMPTS"
- → 200 with `valid: false` → "INVALID PIN"
- → 200 with `valid: true` → `setToken` called, onSuccess fired
- Double-submit: `state.locked` gate blocks second `_attemptLogin` while first is in flight

### 9. `terminal/scenes/check-overview.js` — discount flow
**Bug we fixed:** discount was a TODO-stub; now POSTs to `/api/v1/orders/{id}/discount`.

**Tests to write:**
- `_applyDiscount(state, 10, itemRefs, [], 'mgr_A')` fires the POST with correct `discount_type: '10%'`, `amount`, `item_ids`, `approved_by`
- 400 from backend → toast with server detail, **no** local state mutation
- Success → `order:updated` emitted, `refreshOrder` called
- Amount is `Number(x.toFixed(2))` — never 3dp

### 10. `overseer/src/sections/employees.js` — PIN-reset sends the real PIN
**Bug we fixed:** the reset modal sent `new_pin_hash: 'SHA256_SIMULATED'` — a literal string.

**Tests to write:**
- Reset flow with custom PIN → `emitEvent('employee.updated', ...)` called with `pin: '1234'`
- Auto-generate flow → `pin` is a string matching `/^\d{4,6}$/`
- Edit flow (non-reset) → `employee.updated` payload **does not contain** `pin` (critical: preserves the backend hash)

---

## What NOT to test (don't over-scope)

- **Visual regressions.** No pixel-diffing. Out of scope; too much maintenance cost.
- **Real-device HTTP.** Don't hit the backend from Vitest. Stub `window.fetch` or swap it via `vi.stubGlobal`.
- **Full user flows across scenes.** That's Playwright's job in a later phase. Unit-test the scene modules in isolation first.
- **Dead code.** `modifier-panel.js` was deleted last round; don't resurrect it.
- **Styling / theming.** `tokens.js`, `theme-manager.js` — trust them.
- **The backend tests you already have.** Don't duplicate the day-close-lock test in JS; the Python suite covers it.

---

## Where tests should live

Two reasonable layouts; pick one:

**Option A — colocated** (matches probe-report mental model):
```
terminal/
  auth-client.js
  auth-client.test.js
  scene-manager.js
  scene-manager.test.js
  scenes/
    login.js
    login.test.js
    check-overview.js
    check-overview.test.js
overseer/
  src/
    services/
      auth-client.js
      auth-client.test.js
    sections/
      labor-reports.js
      labor-reports.test.js
```

**Option B — sibling `__tests__`**:
```
terminal/
  __tests__/
    auth-client.test.js
    scene-manager.test.js
    ...
```

Colocated (Option A) is easier for the audit workflow — probe a file and see its test right next to it. Vitest handles both.

---

## Mocks / fixtures that will keep recurring

**Stubbed `fetch`**:
```js
beforeEach(() => {
  global.fetch = vi.fn();
});
afterEach(() => {
  vi.restoreAllMocks();
});
```

**Minimal `SceneManager` stub** (for scene tests that don't want the full module loaded):
```js
vi.mock('../scene-manager.js', () => ({
  SceneManager: {
    interrupt: vi.fn(),
    closeInterrupt: vi.fn(),
    emit: vi.fn(),
    on: vi.fn(),
    off: vi.fn(),
    mountWorking: vi.fn(),
    closeGate: vi.fn(),
  },
}));
```

**`showToast` stub** (every scene calls it):
```js
vi.mock('../components.js', () => ({
  showToast: vi.fn(),
}));
```

**`sessionStorage`** works in JSDOM out of the box. `window.fetch` does **not** — always stub it.

---

## Event codes reference (for tests that trip ENT paths)

The entomology event codes the frontend can trigger via `entReport`:

| Code | Level | Meaning | Where it fires |
|------|-------|---------|----------------|
| `UI-001` | WARNING | Interrupt / gate stacked; prior torn down | `scene-manager.js` `interruptFn`, `openGate` |
| `UI-002` | ERROR | Bus handler / scene callback threw; other handlers still ran | `scene-manager.js` `_emit`, `interruptFn` (onConfirm/onCancel) |
| `UI-003` | INFO | Double-submit blocked by scene lock | `server-checkout.js` `onFinalize` |
| `UI-004` | — | **Reserved** (was: unguarded fetch fallback detection) | — |
| `UI-005` | WARNING | ADD ITEMS refused — `state.order` still null after refresh await | `check-overview.js` `_gotoOrderEntry` |
| `UI-006` | WARNING | Recall path lost `seatNumbers`; falling back to `[1]` | `order-entry.js` `assignSeatsIfNeeded` |
| `UI-007` | INFO | Dead-end tap (button bailed on preconditions) — PRINT/RESEND/PAY/VOID/DISC, delete-paid-seat | `check-overview.js` ×8 |
| `UI-008` | INFO | Seat-assign picker CONFIRM trace (which items → which seats) | `order-entry.js` `assignSeatsIfNeeded` |
| `UI-009` | WARNING/ERROR | `persistSeats` backend error (POST/PUT failure, malformed response, missing `order_id`) | `check-overview.js` `persistSeats` |
| `UI-010` | INFO | Seat-assign picker opened (pairs with UI-008 confirm) | `order-entry.js` `assignSeatsIfNeeded` |
| `UI-011` | ERROR | Uncaught `window.error` or `unhandledrejection` (global bridge) | `entomology-client.js` |

If your test is asserting "this path should record an `entReport`", mock it and spy:
```js
vi.mock('../entomology-client.js', () => ({ entReport: vi.fn() }));
```

### Backend event codes (for context)

The backend emits the remaining 50 codes in the registry via
`DiagnosticCollector.record(...)`. Full canonical list lives in
`backend/app/models/diagnostic_event.py:189` (`EVENT_CODE_REGISTRY`).

Codes with an actual emit site today (i.e. not just reserved):

| Code | Level | Category | Where it fires |
|------|-------|----------|----------------|
| `DEV-001` | ERROR | DEVICE | `diagnostic_collector.py` (sample entry on seed) |
| `DEV-002` | WARNING | DEVICE | `dejavoo_spin.py` — SPIn request timed out |
| `DEV-003` | WARNING | DEVICE | `dejavoo_spin.py` — SPIn device unreachable (connect/network error) |
| `DEV-004` | WARNING | DEVICE | `dejavoo_spin.py` — malformed / unexpected SPIn response |
| `FIN-001` | WARNING | FIN | `orders.py` — 2dp precision gate rejected a monetary value |
| `FIN-002` | WARNING | FIN | `payment_routes.py` — in-flight double-charge guard blocked a concurrent sale |
| `FIN-003` | ERROR | FIN | `orders.py` — day-close invariant check failed |
| `FIN-004` | ERROR | FIN | `payment_routes.py` — batch settlement drift (ledger vs processor) |
| `FIN-005` | WARNING | FIN | `payment_routes.py` — overpayment clamped at route layer |
| `FIN-006` | WARNING | FIN | `payment_routes.py` — tip adjustment on a payment confirmed before the last day-close |
| `FIN-007` | WARNING | FIN | `orders.py` — new-order creation blocked (day close in progress) |
| `FIN-008` | WARNING | FIN | `startup_sweep.py` — orphaned PAYMENT_INITIATED resolved at startup |
| `PER-001` | WARNING/ERROR | PERIPHERAL | `print_dispatcher.py` — generic socket / OS error on a job send |
| `PER-002` | WARNING/ERROR | PERIPHERAL | `print_dispatcher.py` — printer refused the connection |
| `PER-003` | WARNING/ERROR | PERIPHERAL | `print_dispatcher.py` — print job send timed out |
| `PER-007` | WARNING | PERIPHERAL | `printer_manager.py` — cash drawer open failed |
| `SEC-001` | WARNING | SEC | `auth.py` — PIN rate-limit triggered |
| `SEC-002` | ERROR | SEC | `printing.py` ×2 — path-traversal attempt blocked on `/print/test` |
| `SEC-003` | INFO | SEC | `sync.py` — config events replay invoked |
| `SEC-004` | WARNING | SEC | `sync.py` — replay batch claims this terminal's own id (self-impersonation) |
| `SEC-005` | WARNING | SEC | `auth.py` ×2 + `reporting.py` — auth / manager required but no valid token |
| `SEC-006` | ERROR | SEC | `auth.py` + `reporting.py` — manager role missing / cross-server access blocked |
| `SYS-001` | ERROR | SYSTEM | `main.py` HTTP catch-all — ledger precision/idempotency `ValueError` |
| `SYS-003` | WARNING | SYSTEM | `diagnostic_collector.py` — disk usage > 85% (derived from heartbeat) |
| `SYS-004` | WARNING | SYSTEM | `diagnostic_collector.py` — memory usage > 85% |
| `SYS-005` | WARNING | SYSTEM | `diagnostic_collector.py` — CPU temperature > 75°C |
| `SYS-006` | ERROR | SYSTEM | `main.py` HTTP catch-all — any other unhandled exception |
| `SYS-HEARTBEAT` | INFO | SYSTEM | `diagnostic_collector.py` — periodic ambient health snapshot |

**Still reserved** (declared, not wired — needs new infra to detect meaningfully):
- `DEV-005` / `DEV-006` — payment terminal reboot + generic status transition; needs a status-watcher with de-bounce.
- `NET-001..008` — a dedicated network-health monitor would be the emit point; route-level fetch calls use their own timeouts today.
- `PER-004` (queue overflow), `PER-005` (printer status change), `PER-006` (failover triggered) — failover + queue-depth monitoring don't exist yet.
- `REC-001..007` — the retry-success / failover-activated / deferred-mode events need a recovery pipeline that doesn't exist.
- `SYS-002` — ledger integrity check; the hash chain is in place but no scheduled verifier trips it.
- `SYS-007` — scheduled-reboot pre-shutdown marker; no 4am cron integration.
- `UI-004` — reserved; was "unguarded fetch fallback detection".

---

## Priority order for a first day's work

If you have 4 hours, do these in order:

1. **Scaffold** — `package.json`, `vitest.config.js`, first `npm test` passes on an empty suite
2. **`terminal/auth-client.js`** — 6 tests, covers the most-used module in the codebase
3. **`overseer/src/services/auth-client.js`** — 5 tests (reuse patterns from #2)
4. **`terminal/scene-manager.js`** — 8 tests (the interrupt callback + closeInterrupt alias + gate stacking)
5. **`terminal/scenes/login.js`** — 4 tests (429 distinguishability, double-submit lock, token persistence)

That's ~25 tests, all pinning real regressions we fixed. After that, `check-overview.js` discount flow and the Overseer payroll rollups are the next productive targets.

---

## Appendix — where things currently live

- Backend suite: `backend/tests/`, `1063 passed, 3 skipped`, run with `cd backend && python3 -m pytest tests/ -q --ignore=tests/test_entomology_excel_report.py`
- The stability probe history: `PROBE_REPORT.md` (read the "Red Flag Patterns" section — same patterns repeat in the frontend, and that list is a decent static analysis checklist you can turn into assertions)
- The 8 Excel sheets the entomology bug report produces: `backend/app/services/entomology_report.py` — useful to understand the categories you may cross-reference from JS tests
- Backend coverage notes: `COVERAGE_AUDIT.md`
