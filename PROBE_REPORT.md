# KINDpos Vz2.0 — Probe Report
**Branch:** `claude/analyze-probe-report-rQ4C4` (latest probe session)
**Last commit:** run `git rev-parse HEAD` to verify — do not trust this SHA after any push.
**Purpose:** Hand-off document for continuing the stability audit in a new session.

---

## Red Flag Patterns (quick reference card)

- `fetch(...).then(r => r.json())` with no `.ok` check → silent failure
- `p.tip_amount == null` style checks on fields that are always initialized
- Hardcoded `"terminal_01"` / `"T-001"` where `settings.terminal_id` should be used
- `height: 90px` fixed heights on log/scroll areas that overflow
- Missing `idempotency_key` on events that operators might trigger twice
- `try { ... } catch {}` that swallows errors without logging
- Static `order_id` in print queue enqueues — can dedup-swallow if first job is stuck
- `==` on secrets (PIN, token) — use `secrets.compare_digest` for timing safety
- Stub endpoints returning `{success: true}` without persisting — prefer HTTP 501
- `SceneManager.on(...)` without `.off(...)` in cleanup → listener leak across mount/unmount
- Sequential `Promise.all([...]).then(...)` writing `state.*` after possible unmount — guard with `if (!state.el) return`

## Entomology Event Codes (call this to monitor)

Call `app.api.routes.auth._record_diag(...)` from any route handler when you want the bug report to capture a critical event. Best-effort: no-op if collector isn't initialized, never raises.

| Prefix | Category | What it captures |
|--------|----------|------------------|
| `SEC-*` | `DiagnosticCategory.SEC` | Auth rate-limit hits, path-traversal attempts, unauthenticated replay invocations |
| `FIN-*` | `DiagnosticCategory.FIN` | 2dp rounding rejects, double-charge guard trips, batch drift, overpayment clamps, close-day invariant failures |
| `UI-*` | `DiagnosticCategory.UI` | Scene lifecycle bugs — interrupts stacking, post-unmount callbacks, double-submit locks |

Full registry in `backend/app/models/diagnostic_event.py`. All three new categories get their own sheet in the Excel bug report (`services/entomology_report.py`).

Current call sites (as of this probe):
- `auth.py:verify_pin` — `SEC-001` on 429
- `printing.py:print_test` — `SEC-002` on path traversal
- `sync.py:replay_config_events` — `SEC-003` on any invocation (endpoint has no auth)
- `payment_routes.py:initiate_sale` — `FIN-002` (409 double-charge guard) / `FIN-005` (overpayment clamp)
- `payment_routes.py:batch_settle` — `FIN-004` (ledger/processor drift)
- `orders.py:close_day` — `FIN-003` (close-day invariant failure)
- `orders.py:_validate_2dp` — `FIN-001` on any 2dp precision rejection (fire-and-forget from a sync helper)
- `main.py` catch-all — `SYS-001` (ledger precision/idempotency ValueError) / `SYS-006` (any other unhandled exception) — every 500 gets recorded before the response goes out
- `scene-manager.js:interruptFn` — `UI-001` when an interrupt is stacked over an existing one
- `server-checkout.js:onFinalize` — `UI-003` when a double-tap is blocked by the `_finalizing` lock

**Frontend → backend:** `terminal/entomology-client.js` exposes `entReport({ code, source, message, ctx, level })`. Fires against `POST /api/v1/entomology/client-event`, which is the only unauthenticated entomology route. It accepts **UI-\* codes only** — anyone attempting to forge SEC/FIN findings from a browser session gets a 400. Events are queued in-memory when offline and replayed on the `online` window event.

---

## System Architecture (Quick Reference)

| Layer | Tech | Key Facts |
|-------|------|-----------|
| Backend | FastAPI + SQLite (aiosqlite) | Event-sourced ledger; no ORM |
| Terminal UI | Vanilla ES modules | `defineScene()` pattern; no build step |
| Admin UI (Overseer) | Vanilla ES modules | Served as `StaticFiles` by FastAPI |
| Payment | Dejavoo SPIn over LAN HTTP | TCP to `http://{ip}:{port}/spin/cgi.html` |
| Printing | ESC/POS over raw TCP 9100 | Async print queue with retry |
| Identity | MAC address as primary key | IPs change, MACs don't |
| DB files | `event_ledger.db`, `hardware_config.db` | Separate SQLite files |

**Terminal ID default:** `"terminal_01"` (set in `backend/app/config.py`)
**Token system:** `overseer/src/ui/tokens.js` — `T.fs.*`, `T.cyan`, `T.gold`, `T.green`, `T.verm`, `T.well`, `T.card`, `T.border`, `withAlpha()`

---

## What Has Been Audited and Fixed

### Backend — `backend/app/`

| File | Status | Changes Made |
|------|--------|-------------|
| `api/routes/auth.py` | ✅ Audited + Fixed | Constant-time PIN comparison (`secrets.compare_digest`) — closes timing side-channel on LAN |
| `api/routes/staff.py` | ✅ Audited | Clock-in/out TOCTOU race flagged; `declare_cash_tips` `correlation_id=server_id` is linking only, not dedup (confirmed against `create_event`) |
| `api/routes/server_shift.py` | ✅ Audited + Fixed | `/tipout` PATCH now returns 501 (previously lied with `success: true` on an unpersisted stub); dead `tip_map` dropped from `/sales-by-category` |
| `api/routes/printing.py` | ✅ Audited + Fixed | Path-traversal guard on `/print/test` (`template_name` now rejected if it contains `..`, `/`, `\`, or escapes `fixtures/`); UTC timestamp suffix on `order_id` for clock-hours / sales-recap / server-checkout so a still-pending job doesn't dedup-swallow the next print |
| `api/routes/sync.py` | ✅ Audited | **Not fixed** — `/sync/config/events/replay` trusts caller-supplied `event_id`, `user_id`, `user_role`, `terminal_id`. Needs auth. Escalated below. |
| `api/routes/hardware.py` | ✅ Audited + Fixed | MAC regex fix, socket context managers, `terminal_id` from settings |
| `api/routes/payment_routes.py` | ✅ Audited + Fixed | In-flight double-charge guard (409), zero-unadjusted idempotency key, discount `money_round()` + `_validate_2dp`, `confirm_payment` 2dp guard |
| `api/routes/orders.py` | ✅ Audited + Fixed | `apply_discount` precision gate, `confirm_payment` 2dp guard, `tip_adjusted` field in `PaymentResponse` |
| `api/routes/reporting.py` | ✅ Audited + Fixed | Overnight shift hours bug (strptime date stripping), first-login overwrite |
| `core/adapters/payment_manager.py` | ✅ Audited | Idempotency only checks confirmed/declined (not in-flight — covered at route level) |
| `core/adapters/payment_validator.py` | ✅ Audited | No overpayment check (routes clamp instead); tip ceiling correct |
| `core/adapters/dejavoo_spin.py` | ✅ Audited + Fixed | Device timeout 120s → 60s (was > manager's 90s asyncio.wait_for) |
| `core/adapters/mock_payment.py` | ✅ Audited | Batch close always returns $0 total (dev/test drift); known limitation |
| `core/event_ledger.py` | ✅ Audited | `append()` returns `None` on idempotency hit — most callers handle this correctly |
| `core/projections.py` | ✅ Audited + Fixed | `TIP_ADJUSTED` handler now sets `payment.tip_adjusted = True`; added field to `Payment` dataclass |
| `core/financial_invariants.py` | ✅ Audited | `gate()` logs-only in prod (`strict=False`); vacuous P&L in close_day is intentional |
| `core/events.py` | ✅ Audited | `payment_confirmed` already `money_round(tax)`; `tip_adjusted` passes `**kwargs` to `create_event` |
| `printing/print_dispatcher.py` | ✅ Audited + Fixed | Wrong formatter routing, hardcoded port 9100, stale-job recovery on startup, `bump_attempt_for_retry` |
| `printing/print_queue.py` | ✅ Audited + Fixed | Idempotency on `enqueue()`, `get_pending_jobs` excludes 'sent', `recover_stale_sent_jobs`, `bump_attempt_for_retry` |
| `printing/escpos_formatter.py` | ✅ Audited + Fixed | Warning on non-ASCII char replacement |
| `services/print_context_builder.py` | ✅ Audited + Fixed | Clock-in first-login guard |
| `scanner/printer_detector.py` | ✅ Audited + Fixed | Socket context manager |

### Terminal UI — `terminal/`

| File | Status | Changes Made |
|------|--------|-------------|
| `scenes/payment.js` | ✅ Audited + Fixed | Double-submit guard (`confirmProcessing`), client-side `transaction_id` via `crypto.randomUUID()` |
| `scenes/order-entry.js` | ✅ Audited + Fixed | Unguarded `fetch()` calls hardened |
| `scenes/checkout-core.js` | ✅ Audited + Fixed | `zero-unadjusted` POST error handling |
| `scenes/check-overview.js` | ✅ Audited + Fixed | Clocked-in fetch error handling |
| `scenes/server-checkout.js` | ✅ Audited + Fixed | IIFE-scoped `_finalizing` flag prevents double-finalize |
| `scenes/manager-landing.js` | ✅ Audited + Fixed | Unadjusted tip counter was always 0 (`tip_amount == null` → `!tip_adjusted`); `_wireCloseDayData` now uses `day.unadjusted_tips` from backend |
| `scenes/close-day.js` | ✅ Audited | **Stub only** — "scene not yet built" placeholder; real EOD flow lives in `close-day-checks-viewer.js` |
| `scenes/close-day-checks-viewer.js` | ✅ Audited | **Not yet fixed** — unguarded fetches on lines ~133, 877, 911, 966; inverted tip-adjusted logic on line 171; rebuild-time listener leaks on lines 273, 624; multi-check action buttons (Transfer/Print/Void) lack `_busy` locks; escaped `setTimeout` in `onVoidCheck`. Findings catalogued; fixes deferred to avoid contaminating an instrumentation commit |
| `terminal/pricing.js` | ✅ Audited | Clean — single source of truth for tax/cash-discount rates, `_roundCents` matches backend `money_round`, fetch has `.ok` guard (line 38) and fallback catch. No findings. |
| `scenes/login.js` | ✅ Audited + Fixed | HTTP 429 (rate-limit) response now surfaces as "TOO MANY ATTEMPTS" instead of masquerading as "INVALID PIN"; still flags: session token from `/verify-pin` discarded (never attached to subsequent requests), hardcoded "T-001" terminal label |
| `scenes/server-landing.js` | ✅ Audited + Fixed | Removed dead `pin:` prop passed to `check-overview` (auth never returns PIN; the value was always `undefined`) |
| `scene-manager.js` | ✅ Audited + Fixed | `interrupt()` now tears down an existing interrupt before stacking a new one — previously `_interruptScene` was overwritten, leaking the prior frame/scrim and skipping its cleanup |

### Admin UI — `overseer/src/`

| File | Status | Changes Made |
|------|--------|-------------|
| `hardware/add-device-overlay.js` | ✅ Audited + Fixed | Scan log min/max-height, PRINT DEVICES / PAYMENT grouping, card reader cyan badge instead of broken KITCHEN dropdown |

---

## Known Issues NOT Fixed (Architectural / Deferred)

| Severity | Issue | File | Reason Deferred |
|----------|-------|------|-----------------|
| Critical | `/sync/config/events/replay` accepts caller-supplied `event_id` / `user_id` / `user_role` / `terminal_id` — attacker on LAN can forge audit attribution and pre-register `event_id`s to DoS legit future events | `sync.py:72-128` | Needs auth between terminals and Overseer; partial fix would break legit sync. **Instrumented with `SEC-003` so every call hits the bug report.** |
| Critical | `config.py:/push` accepts arbitrary `event_type` / `payload` from any caller with no auth — twin of the sync.py issue, but on the Overseer's own config write surface. Caller can synthesize `EMPLOYEE_CREATED`, `STORE_CC_PROCESSING_RATE_UPDATED`, `MENU_ITEM_86D`, etc. | `config.py:235-271` | Needs auth system |
| Critical | `config.py:/menu/86`, `/roles`, `/employees`, `/store/cc-rate` — 15+ config write endpoints unauthenticated; any LAN client can flip tax rate, disable menu items, or create employees | `config.py` | Needs auth system |
| High | `config.py:/terminal-bundle` returns `generated_at: "2026-03-24T14:30:00Z"` — hardcoded timestamp, never refreshed. A caching client would think the bundle is stale or never-updating | `config.py:357` | One-liner fix; deferred to avoid touching unrelated config plumbing this round |
| Critical | Auth missing on reporting endpoints (`?server_id=` leaks employee tip/labor data) | `reporting.py` | Needs auth system |
| Critical | `require_role` / `get_current_session` defined but only used by `entomology.py` — session tokens issued by `/auth/verify-pin` are discarded by frontend; no other route enforces auth | `auth.py`, all other routes | Needs coordinated rollout: frontend must persist token + send `Authorization: Bearer` on every write |
| High | Day-close race: orders created between `get_open_orders()` and `DAY_CLOSED` emission are orphaned | `orders.py:close_day` | Needs app-level mutex; invasive change |
| High | Clock-in/out TOCTOU — two concurrent POSTs for same employee both pass the `_clocked_in_ids` check, both append events | `staff.py:67-104` | Needs per-employee lock or idempotency key derived from `(employee_id, day)` |
| Medium | Refund `approved_by` is a free string, not server-verified | `payment_routes.py:process_refund` | Needs auth system |
| Medium | close_day invariant check uses synthetic zeros for voids/discounts/refunds | `orders.py` lines 1727-1731 | Intentional — documented in comment; full P&L decomposition needed |
| Medium | Batch settlement drift returns HTTP 200 with `invariant_ok: false` | `payment_routes.py:batch_settle` | Deliberate — blocking on drift would mask the actual settlement result |
| Medium | `_transitionHooks` is append-only; no removal API. Scenes that register a hook and unmount leak it | `scene-manager.js:409` | Needs a `removeBeforeTransition(fn)` API + audit of current callers |
| Medium | Dead `pin:` still propagated through `manager-landing.js` (4 sites) and `check-overview.js` (4 sites) into `order-entry` / `payment`. `state.emp.pin` is always `undefined` since `/verify-pin` does not return PIN | `manager-landing.js`, `check-overview.js` | Pure cleanup; deferred to avoid churn in unrelated scenes |
| Low | Mock batch close always succeeds with `total_amount = $0.00` | `mock_payment.py` | Test/dev concern; mock should track total |
| Low | Receipt print is fire-and-forget | `payment.js:queueReceipt` | Print queue retries handle it; toast shown on failure |
| Low | Per-server unadjusted tip count in manager-landing still approximate | `manager-landing.js:_wireStaffData` | Day-summary `unadjusted_tips` is now used for the gate; per-server breakdown needs server_id in the checks list |
| Low | Hardcoded `"T-001"` terminal label on login screen | `login.js:608` | Should read from `/hardware/terminal-info` or `settings.terminal_id` |

---

## Files NOT YET Audited

### Backend (Priority order)

| File | Lines | Why It Matters |
|------|-------|----------------|
| `api/routes/menu.py` | 41 | Menu fetch — probably simple |
| `api/routes/config.py` | unknown | Store config, tax rate, terminal settings |
| `services/print_context_builder.py` | 831 | Build context for all print templates — partially audited (clock-in fix done) |
| `printing/templates/*.py` | multiple | Kitchen ticket, guest receipt, server checkout, sales recap formatters |
| `core/menu_projection.py` | unknown | Menu state projection |
| `core/adapters/payment_health.py` | unknown | Device health monitoring |
| `core/adapters/printer_manager.py` | unknown | Printer device management |
| `reports/entomology_report.py` | unknown | Diagnostic report |

### Terminal UI (Priority order)

| File | Lines | Why It Matters |
|------|-------|----------------|
| `scenes/close-day-checks-viewer.js` | 997 | End-of-day checks review — real EOD logic (not `close-day.js`) |
| `order-summary.js` | 666 | Persistent order recap sidebar |
| `components/item-recap.js` | 693 | Item recap component used in check-overview |
| `pricing.js` | 110 | Price computation helpers |
| `scenes/column-editor.js` | unknown | Column/table configuration |

### Overseer Admin UI (Priority order)

| File | Why It Matters |
|------|----------------|
| `sections/payroll-tips.js` | Tip payout calculations — financial |
| `sections/labor-reports.js` | Labor cost display — uses reporting API |
| `sections/employees.js` | Employee CRUD |
| `sections/reporting.js` | Sales reporting display |
| `sections/printer-setup/*.js` | Printer config modals |
| `sections/time-attendance.js` | Clock-in/out display |
| `services/config-push.js` | Pushes config to terminals |

---

## Priority Probe Targets for Next Session

1. **`auth.py`** — Highest risk. PIN-based login with no rate limiting or lockout is the most likely critical-severity find.
2. **`server_shift.py` + `staff.py`** — Clock-in/out mutations; any double-clock-in or missing guard could corrupt labor reports.
3. **`printing.py`** — Receipt dispatch; look for fire-and-forget patterns and missing idempotency.
4. **`scene-manager.js`** — Core; any lifecycle bug (unmount not called, listener leak, interrupt stack corruption) affects every scene.
5. **`login.js`** — PIN entry; check for: PIN sent as plaintext, no lockout after N failures, role bypass.
6. **`server-landing.js`** — Order creation entry point; look for double-order creation, missing error handling on new-order POST.
7. **`sync.py`** — Check for event injection or replay vulnerabilities.
8. **`close-day-checks-viewer.js`** — Large, end-of-day flow; likely has UI bugs similar to what we found elsewhere.

---

## Probe Methodology

**For each file:**
1. Read the full file
2. Look for: unguarded fetch/await, missing `if (!r.ok)`, silent catch blocks, duplicate-submission vectors, financial math that isn't `money_round()`-wrapped, hardcoded IDs, race conditions between async calls
3. Check event emissions: does every mutation emit to the ledger? Are events idempotency-keyed where needed?
4. For terminal scenes: check `unmount` function clears all timers/listeners; check scene state variables are reset on re-mount

(Red flag patterns moved to top of the document as a quick-reference card.)

---

## Commit History (Recent)

```
e1168d3 Fix discount precision gate, tip_adjusted tracking, and unadjusted tip counter
3f1d4fd Fix four payment flow vulnerabilities found during probe
c9a3035 overseer: group scan results by type, expand log area, card reader badge
a5f223e check-overview: always render Mode C layout so recap shows at every seat count
...
```

**Working branch:** `claude/kindpos-network-setup-pzz50` (mirrors `main`)
**Push command:** `git push origin main && git push --force origin main:claude/kindpos-network-setup-pzz50`
