# KINDpos Terminal — Navigation & Tap Interaction Audit

## Context

The KINDpos terminal is a touch-first POS surface. Intermittent screen freezes, dead taps, and back-navigation bugs have been reported. This audit is a **read-only** pass over `terminal/` — scene files, `scene-manager.js`, `app.js`, `theme-manager.js`, `sm2-shim.js`, interactive components — to catalogue the root causes before any fixes are scoped. **No code is modified.** The deliverable is the finding table below.

Sources: three parallel Explore-agent passes (Phase 1+4, Phase 2, Phase 3) plus my own verification reads against the cited line numbers. Where an agent finding did not match the source, I corrected or dropped it.

Issue-class legend: `Freeze Risk` · `Dead Tap` · `Listener Leak` · `Async Hang` · `Stack Corruption`

---

## Phase 1 — Scene Lifecycle

| File : line | Issue Class | Description |
|---|---|---|
| `terminal/scenes/server-checkout.js:192–200` | — (FALSE POSITIVE, noted for awareness) | Recursive `setTimeout(tick, 1000)` self-terminates via `document.body.contains(timer)` guard at line 193. One wasted tick after unmount; not a true leak. |
| `terminal/scenes/server-checkout.js:1261–1269` | — (FALSE POSITIVE, noted) | Same self-terminating `document.body.contains(rowR)` guard at line 1262. Not a true leak. |
| `terminal/scenes/check-overview.js:408` | — (FALSE POSITIVE, noted) | `setTimeout(..., 3000)` mutates `state._backConfirmed` on a scene-local state object. Harmless if unmount occurs first. |
| `terminal/scenes/payment.js:376 / 392` | Listener Leak | `_procAnimTimer = setInterval(..., 200)` inside `pc-card-processing` transactional. Its own `unmount()` clears it (L392), but parent `payment` scene's unmount (L183–188) does **not** call `closeAllTransactional()`. See Phase 4 finding on scene-manager. |
| `terminal/scenes/payment.js:535` | Listener Leak | `_changeDueTimer = setInterval(...)` inside `pc-change-due` transactional. Same orphan-on-working-switch risk as above; relies on scene-manager to close transactionals during working-scene switch, which it does not. |
| `terminal/scenes/login.js:484,499,513,522,542` | Freeze Risk | Timeclock overlay fetches (`/servers/clock-in`, `/clock-out`, status polls) use no `AbortController`. If the user closes the overlay (L306 `_closeOverlay`) or navigates away before the response, the stale callback still executes against removed DOM. Cross-listed under Phase 3. |
| `terminal/scenes/check-overview.js:368 / 512` | (OK) | Listeners are tracked in an array and removed in unmount at L512. Pattern is correct. |

**No issues found in:** `app.js`, `sm2-shim.js`, `close-day.js` (stub), `theme-manager.js` (no scene lifecycle), `column-editor.js`.

---

## Phase 2 — Tap / Touch Bug Patterns

| File : line | Issue Class | Description |
|---|---|---|
| `terminal/theme-manager.js:338–378` (`buildNumKey`) | Dead Tap | Numpad key builder sets `cursor:pointer` and `userSelect:none` but **not** `touch-action: manipulation` or `pointer-events: auto`. Every PIN pad, amount numpad, and seat numpad inherits a 300ms tap delay on touch devices. |
| `terminal/theme-manager.js:197 / 287 / 375` | Dead Tap | Pill/float/numkey builders attach `onClick` to `pointerup` (not `click`). If a user presses elsewhere and releases on the button, the action fires — and conversely, a press that starts on the button and releases outside fires nothing (no click synthesized). Minor tap-consistency bug across the whole UI. |
| `terminal/theme-manager.js:197` (`buildPillButton`) | Dead Tap | The onClick wrapper at L197 does **not** honor `btn._disabled`. The press/release visual handlers gate on `btn._disabled`, but `onClick` fires regardless — `setDisabled(true)` visually locks the button while still firing its handler. |
| `terminal/scenes/order-entry.js:893–908` (`_bindItemTile`) | Listener Leak | 600ms long-press `longPressTimer` cleared on `pointerup`/`pointerleave` but **not** on `pointercancel`/`touchcancel`. Multi-touch or OS gesture interrupt → ghost `toggleFavorite` after release. |
| `terminal/scenes/order-entry.js:~2959–2989` (group cart row) | Listener Leak | 500ms long-press timer missing `pointercancel` handler. Same ghost-fire pattern on row long-press. |
| `terminal/modifier-panel.js:809–827` | Listener Leak | 400ms `_holdTimer` on optional modifier cards cleared on `pointerup`/`pointerleave` only. Missing `pointercancel` → ghost fire of `showSpecialPopout` after cancelled hold. |
| `terminal/keyboard.js` (entire file) | Dead Tap | Zero occurrences of `touch-action`. Every key on the on-screen keyboard has a 300ms tap delay. |
| `terminal/order-summary.js` (entire file) | Dead Tap | Zero occurrences of `touch-action`. Row taps (seat/item rows) have 300ms delay. |
| `terminal/modifier-panel.js:829–831` | Dead Tap | Non-special optional cards wire `pointerup` only — no `cursor:pointer`, no `touch-action`, no `pointer-events:auto`. Tappable `div` without the tap affordances. |
| `terminal/scenes/login.js:326` (`_closeOverlay`) | Dead Tap | `hdrR.addEventListener('pointerup', _closeOverlay)` can race with the scene-unmount DOM removal (L636). Second `_closeOverlay` call after DOM is gone silently no-ops; no explicit guard. |

**Not found (checked and clean):** `numpad.js` correctly handles `pointercancel` (L66, 239); `category-grid.js` sets `touch-action` at one site.

> **Caveat:** Phase 2 agent returned an abbreviated transcript. The three order-entry / modifier-panel long-press findings are confirmed via direct reads of the cited lines. Other interactive files (`components.js`, `half-placement-overlay.js`, `pizza-builder-overlay.js`, `item-recap.js`, `header.js`) should be re-scanned in the fix phase for the same long-press-without-pointercancel pattern.

---

## Phase 3 — Async / Await Freeze Risk

| File : line | Issue Class | Description |
|---|---|---|
| `terminal/scenes/server-checkout.js:1559` (transfer checks) | Async Hang | `Promise.all(...)` over per-check fetches. **No `AbortController`, no timeout, no `.catch()`.** One hung check freezes the whole batch silently; no toast, no UI unlock. |
| `terminal/scenes/server-checkout.js:1630` (print checks) | Async Hang | Same pattern: unguarded `Promise.all` over fetches. Silent indefinite hang if any print endpoint is unreachable. |
| `terminal/scenes/server-checkout.js:1676` (discount checks) | Async Hang | Same pattern. No timeout, no catch. |
| `terminal/scenes/server-checkout.js:1741` (void checks) | Async Hang | Same pattern. Void batch can stall the finalize flow indefinitely. |
| `terminal/scenes/payment.js:978–988` (cash PAY) | Async Hang | `POST /payments/cash` — no `AbortController`, no timeout. Cash path has a catch (L1052) but waits on browser default timeout (~120s) before recovering. |
| `terminal/scenes/payment.js:1006–1025` (card PAY) | (OK — timeout present) | Card path correctly uses `AbortController` with 95s timeout (L992–993, cleared L1013). Verify 95s is operationally sensible. |
| `terminal/scenes/login.js:522–537` (clock-in) | Freeze Risk | Button disabled at L521, fetch at L522 has no timeout. Catch at L533 re-enables, but button visibly locked until browser timeout. |
| `terminal/scenes/login.js:542–554` (clock-out) | Freeze Risk | Same pattern as clock-in. |
| `terminal/scenes/check-overview.js:747–759` (manager PIN verify) | Freeze Risk | `/auth/verify-pin` fetch — no timeout. Numpad shows spinner; catch at L759 shows 'NETWORK ERROR' toast, but only after browser default timeout. |
| `terminal/scenes/order-entry.js:3447 / 3478` (`handleSaveOnly`) | Freeze Risk | `isSending = true` at L3441, finally resets at L3495. No AbortController on order create or item POST. Catch handles rejection but user sees "SENDING" lock for 120s if backend stalls. |
| `terminal/scenes/order-entry.js:3534 / 3566 / 3586` (`handleSend`) | Freeze Risk | Same pattern — three await points, no timeouts. Finally resets `isSending` correctly. |
| `terminal/scenes/server-checkout.js:1461–1492` (finalize checkout) | Freeze Risk | `_finalizing = true` guard, POST `/server/shift/finalize-checkout`. No timeout. Catch resets flag, but lock holds until browser timeout. |
| `terminal/scenes/checkout-core.js:402–429` (tip-adjust inline) | Freeze Risk | POST `/payments/tip-adjust` wrapped in `.then().catch()`. Catch shows toast but **does not null `_selected`** — user re-taps ENT and re-attempts the same stale check without knowing the prior failed. State-inconsistency dead-tap feel, not a true freeze. |

**Pattern summary:** Most async handlers have try/catch or `.then/.catch`, so the terminal does not silently freeze forever in JS terms — but none of these handlers time out faster than the browser's default (~120s). During those 120s the UI appears dead. The **Promise.all batches in server-checkout.js are the worst offenders** because they lack any catch at all.

---

## Phase 4 — Scene-Manager Stack Integrity

| File : line | Issue Class | Description |
|---|---|---|
| `terminal/scene-manager.js:189` (`mountWorking`) | Stack Corruption | `mountWorking()` calls `_unmountWorkingInternal()` but **does not** call `closeAllTransactional()`. If a working scene switch happens while a transactional is open (e.g., header back button during `pc-card-processing`), the transactional stays in `_transactionalStack` with its interval timer running and its DOM still in `_layerTransactional`. Re-entering the parent scene finds a stale overlay. |
| `terminal/scene-manager.js:203–216` (`unmountWorking`, `_unmountWorkingInternal`) | Stack Corruption | Symmetric gap: neither function touches transactionals or interrupts. Any working-scene tear-down leaves descendant layers orphaned unless the scene itself remembered to close them. |
| `terminal/scene-manager.js:318–327` (`interruptFn`) | (OK) | Stacking a new interrupt over an existing one correctly calls `resolveInterrupt()` (synchronous: unmount + cleanup + DOM remove at L400–415). No race as originally suspected. |
| `terminal/scene-manager.js:400–415` (`resolveInterrupt`) | (OK) | Single code path, synchronous, idempotent via `_interruptScene` null-check. Clean. |
| `terminal/scenes/check-overview.js:401–411` (back-nav guard) | (OK) | Double-back confirmation is correctly gated via `state._backConfirmed` + 3s reset. Pops to `_landing` via `mountWorking`, not via any push/pop that could mis-layer. |

**Conclusion:** The interrupt layer is sound. The weakness is at the **working layer**: nothing in `mountWorking`/`_unmountWorkingInternal` cleans up the transactional stack, so any back-navigation while a transactional is live orphans that overlay. This explains the most frequently reported "screen is stuck" symptom.

---

## Summary Counts

| Phase | Real findings | False positives (noted) |
|---|---|---|
| Phase 1 — Scene lifecycle | 3 | 3 |
| Phase 2 — Tap/touch | 10 | 0 |
| Phase 3 — Async freeze | 12 | 1 (card PAY OK) |
| Phase 4 — Scene-manager | 2 | 3 (OK) |
| **Total** | **27** | — |

## Top-3 Fix Priorities (for when fixes are scoped)

1. **`scene-manager.js:_unmountWorkingInternal` must call `closeAllTransactional()` and `resolveInterrupt()` before tearing down the working scene.** Single highest-impact fix — resolves every "orphan transactional" symptom including the pc-card-processing interval leak.
2. **`server-checkout.js` Promise.all batches (4 sites) need a timeout wrapper and a `.catch()` that shows a toast and unlocks state.** Without this, one dead backend endpoint freezes the whole manager batch flow.
3. **`theme-manager.js:buildNumKey` needs `touch-action: manipulation` and `pointer-events: auto`, and every long-press handler in `order-entry.js` / `modifier-panel.js` needs a `pointercancel` clear.** One-line-each tap-latency and ghost-fire fixes; highest visible UX impact.

---

## Verification Plan (for post-fix validation)

No code is being changed in this pass. If/when fixes land, verify as follows:

- **Orphan transactional:** open `payment` → trigger `pc-card-processing` → tap header back mid-processing → inspect `SceneManager.getTransactionalStack()` — should be empty.
- **Promise.all hangs:** block `POST /server/shift/print`, `/transfer`, `/discount`, `/void` at the proxy → confirm toast + UI unlock within 15s.
- **Tap latency:** enable Chromium touch emulation, run PIN pad entry, measure `pointerdown → handler` gap; target < 50ms.
- **Long-press ghost fire:** on a touch device, press-and-drag-out on an order-entry item tile, confirm no `toggleFavorite` call on `pointercancel`.
- **Working-layer switch:** `window._SM.go('server-landing')` while `pc-change-due` transactional is open; confirm DOM in `_layerTransactional` is cleared and `_changeDueTimer` interval is removed (`performance.getEntriesByType('measure')` or manual DevTools inspection).

---

## Critical Files Referenced

- `terminal/scene-manager.js` (L181–216, 265–292, 298–327, 400–415)
- `terminal/theme-manager.js` (L130–218 pill, L309–378 numkey)
- `terminal/scenes/server-checkout.js` (L1461, 1545, 1619, 1661, 1727)
- `terminal/scenes/payment.js` (L183–188, 376–395, 535, 978–1057)
- `terminal/scenes/order-entry.js` (L889–908, 3434–3620, long-press row at ~2959)
- `terminal/scenes/check-overview.js` (L368–512, 401–411, 747–759)
- `terminal/scenes/login.js` (L288–636)
- `terminal/modifier-panel.js` (L806–832)
- `terminal/keyboard.js`, `terminal/order-summary.js` (missing `touch-action`)

**No code changes are included in this plan — this is a findings-only audit as requested.**
