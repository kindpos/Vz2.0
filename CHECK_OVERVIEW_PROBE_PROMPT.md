# Probe Prompt — check-overview Scene

You are running a probe-and-harden session on the largest and most complex
scene in the KINDpos terminal:

- `terminal/scenes/check-overview.js` (~4,100 lines)
- `terminal/scenes/check-overview.test.js` (10 tests today)

This scene is the core per-check work surface: seat management, item selection,
MANAGE mode (MOVE / SPLIT / MERGE / UNDO), paid-seat collapse, discount flow,
payment routing, and server transfer. It shipped with almost no test coverage
after the 34-commit redesign in April 2026 and has grown significantly since.
A preliminary audit has identified seven concrete bug candidates described
below — your job is to reproduce each with a failing test, fix the code, and
watch it go green.

---

## Your job

1. **Read the source file end-to-end** and `check-overview.test.js` before
   touching anything. The audit below gives line references but code may have
   shifted — verify before patching.

2. **For every real bug you find**, write a failing test first, fix the
   production code, then confirm the test goes green. Tests are the proof of
   fix, not the other way round.

3. **For untested branches** that you encounter while reading (especially the
   MANAGE mode paths), add regression-lock tests for current behavior even if
   no bug exists. The April 2026 redesign silently rotted 27 tests before
   anyone noticed; lock the surface.

4. **Run the suite continuously.**
   ```
   npx vitest run terminal/scenes/check-overview.test.js
   ```
   for a fast loop; `npx vitest run` before committing to verify nothing else
   regressed.

5. **Append results to `STABILITY_REPORT.md`** as a new "Session — check-overview
   probe" section, matching the prior bug-table format exactly:
   - Bugs found + fixed (cols: `#`, `Bug`, `File:line`, `Severity`, `Fix`)
   - Tests added (cols: `Surface`, `Tests`, `Notes`)
   - A "Remaining risks, deferred" callout for anything out of scope.

6. **Commit and push** to `claude/probe-check-overview-<short-id>`. Do not
   open a PR.

---

## Known bug candidates (from preliminary audit — verify each)

These were identified by static analysis. Reproduce with a test before fixing.

### Bug 1 — Void-item DELETE fires after unmount (HIGH)

**Location:** ~line 3477  
After a void action, an undo window opens. When the window closes, a
`setTimeout(..., 4200)` fires a DELETE to
`/api/v1/orders/{id}/items/{iid}`. This timer is **not** tracked in
`state._lpTimers` and is **not** cancelled in the scene's `cleanup()`.
If the operator navigates away (e.g., taps PAY) before the 4.2 s elapses,
the scene unmounts but the fetch still fires against a potentially stale
order — and any error is silently swallowed.

**Reproduction:** Mount the scene, trigger a void, immediately call
`sceneDef.cleanup(state)`, then advance fake timers past 4.2 s and assert no
fetch was issued.

**Fix direction:** Track the timer ID in `state._lpTimers` (or a dedicated
`state._voidItemTimer`) and clear it in `cleanup()`.

---

### Bug 2 — Customer-name PATCH has no `.ok` guard (MEDIUM)

**Location:** ~line 3963 (inside the name-editor interrupt's `onConfirm`)  
```js
fetch(`/api/v1/orders/${state.orderId}`, { method: 'PATCH', ... })
  .then(r => r.json())  // no r.ok check
  .then(...)
```
A non-2xx response (e.g., 422 validation error, 500 server crash) is parsed
as data and silently discarded. The operator sees no error indication; the
name change is lost.

**Reproduction:** Mock `fetchWithTimeout` to return `{ ok: false, status: 422, json: () => ({detail:'bad'}) }`, trigger the name editor's confirm, assert a toast is shown.

**Fix direction:** Add `if (!r.ok) throw new Error(...)` before `.then(r => r.json())`, or restructure to `async/await` with a try-catch that calls `showToast`.

---

### Bug 3 — `_refreshInFlight` is a module-level global, not per-state (LOW–MED)

**Location:** ~line 70 (top of module, `var _refreshInFlight = false`)  
The in-flight guard for `refreshOrder` is declared at module scope. If two
check-overview instances were ever active simultaneously (e.g., during a
working-scene transition overlap), one instance's refresh completion could
clear the other's flag. In current usage, the SceneManager only mounts one
working scene at a time — but the architecture is fragile.

**Reproduction:** Mount two scene instances in sequence, start a refresh on
instance 1, assert that instance 2's flag is independent.

**Fix direction:** Move `_refreshInFlight` inside the `state` object (rename
to `state._refreshInFlight`), initialize in `state` definition, reference via
`state._refreshInFlight` throughout `refreshOrder`.

---

### Bug 4 — Print / Resend have no in-flight guard (MEDIUM)

**Locations:** ~lines 3194 (print receipt), 3218 (resend)  
Both handlers fire a POST on every tap with no guard flag. A rapid double-tap
sends two requests. The backend print queue deduplicates by `order_id`, so
double-print is unlikely — but the double-toast is visible and the double-POST
wastes a round-trip.

**Reproduction:** Mock `fetchWithTimeout`, call the handler twice in quick
succession, assert `fetchWithTimeout` was called exactly once.

**Fix direction:** Add a `state._printing` / `state._resending` flag (pattern
from `manager-landing.js:_printing`): set before fetch, clear in both the
success and failure paths.

---

### Bug 5 — Server-picker fetch failure silently empties the list (LOW–MED)

**Location:** ~line 746  
```js
fetch('/api/v1/servers/clocked-in')
  .then(r => r.json())
  .then(list => ...)
  .catch(function() { list.innerHTML = '<div>No servers available</div>'; })
```
A network error shows a misleading "No servers available" message with no
indication that the failure was transient. If the backend is temporarily
unreachable, the operator cannot distinguish "nobody clocked in" from "fetch
failed."

**Reproduction:** Mock the fetch to reject, trigger the server-picker
interrupt, assert the error message is distinguishable from the empty-list
message (e.g., "Could not load servers" vs "No servers clocked in").

**Fix direction:** Use separate messages:
`list.innerHTML = '<div class="err">Could not load servers — try again</div>'`
in the catch.

---

### Bug 6 — MANAGE mode UNDO "merge-new-check" cannot be undone but re-pushes the patch (MEDIUM)

**Location:** ~lines 1383–1416 (UNDO handler)  
When a `'merge-new-check-*'` patch is on top of the log, the UNDO handler
shows a toast saying it cannot undo and then pushes the patch **back onto the
log**. This means tapping UNDO repeatedly on an un-undoable action loops
forever: toast, push back, pop again, toast again.

**Reproduction:** Trigger a merge-to-new-check action to push a
`'merge-new-check-*'` patch into `state._manageLog`, then call the UNDO
handler twice in succession, assert the toast was shown twice and the log
length is unchanged (not growing).

**Fix direction:** Do not pop the patch before deciding it can't be undone, or
after pushing it back, do not pop it on the next call. Simplest: check
`patch.kind.startsWith('merge-new-check')` before popping — if so, show toast
without touching the stack.

---

### Bug 7 — `_syncSelectedFromItems` not called after `clearAllSelection` in UNDO path (LOW)

**Location:** ~lines 1394–1416 (`_undoMoveInverse`) and the broader UNDO dispatch  
`clearAllSelection()` wipes both `state.selectedItems` and `state.selected`.
In some UNDO branches (specifically after a move reversal), the seat-mirror
`state.selected` may not be re-derived from `state.selectedItems` before the
next render, leaving stale selections visible in the UI.

**Reproduction:** Set up a move action (item from S-001 to S-002), undo it,
assert `state.selected['S-001']` correctly reflects the restored item's seat
selection.

**Fix direction:** Call `_syncSelectedFromItems(state)` at the end of every
UNDO branch before the render call.

---

## Additional untested surfaces to lock

Even if no bugs are found, add regression tests for:

| Surface | Why it matters |
|---|---|
| MANAGE mode entry / exit | `enterManageMode` creates snapshot; `exitManageMode` must clear `_manageLog`, `_manageTool`, `_manageMode` |
| UNDO with empty log | Tapping UNDO with nothing in `_manageLog` should be a no-op, not a crash |
| RESET (long-press) restores snapshot | After MOVE, RESET should revert `state.seats` to `_manageSnapshot` |
| `refreshOrder` defers when `_seatsChain` is pending | Assert refresh is queued, not dropped, when a persist is in-flight |
| Paid-seat filter — selection is blocked | `toggleSeat` with a paid seat should silently no-op |
| `forceSelectAll` skips paid seats | Paid seat items must not appear in `selectedItems` after selectAll |

---

## Red-flag patterns to hunt beyond the list above

Carry forward the patterns from `PROBE_REPORT.md`:

- `fetch(...).then(r => r.json())` with no `.ok` check → silent failure
- `setTimeout` without a matching `clearTimeout` in `cleanup()` → stale fetch after unmount
- Flag set before `fetch`, cleared only in `.then(...)` without a `.catch(...)` clear → flag stuck forever on rejection
- `SceneManager.on(...)` without `.off(...)` in cleanup → listener leak
- Buttons with no `_busy`-style in-flight guard that trigger network writes
- `try { ... } catch {}` swallowing errors without logging

---

## Mock shape and test style

Match the patterns already in `check-overview.test.js` exactly:

```js
vi.mock('../scene-manager.js', () => ({
  SceneManager: { interrupt: vi.fn(), on: vi.fn(), off: vi.fn(), emit: vi.fn(), ... },
  defineScene: (def) => { registeredScenes.push(def); return def; },
}));

vi.mock('../theme-manager.js', () => ({
  buildCard:        () => ({ wrap: document.createElement('div'), card: document.createElement('div') }),
  buildStaticCard:  () => { const el = document.createElement('div'); el.setAccent = vi.fn(); return el; },
  buildActionCard:  ({ onClick } = {}) => { const el = document.createElement('div'); if (onClick) el.addEventListener('pointerup', onClick); el.setAccent = vi.fn(); return el; },
  buildPillButton:  ({ label } = {}) => { const el = document.createElement('button'); el.textContent = label || ''; return el; },
  hexToRgba: (c) => c,  darkenHex: (c) => c,  lightenHex: (c) => c,
}));

vi.mock('../net.js', () => ({
  fetchWithTimeout: vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve({}) })),
}));

vi.mock('../components.js', () => ({
  showToast: vi.fn(),
  buildGap:  () => document.createElement('div'),
}));
```

Use `vi.useFakeTimers()` for any test involving `setTimeout`, including Bug 1
(void-item DELETE) and Bug 4 in-flight guard teardown.

Use `vi.resetModules()` in `beforeEach` to get a fresh module instance per
test so `_refreshInFlight` / other module-level vars are reset.

---

## Scope constraints

- **Only touch:** `terminal/scenes/check-overview.js`,
  `terminal/scenes/check-overview.test.js`, and `STABILITY_REPORT.md`.
- **Do not touch** backend files, other scene files, or any other frontend
  module.
- No new production abstractions — fix the minimum code for each confirmed bug.
- No backwards-compat shims or dead-code renaming — delete what's dead.
- Suite must be green at commit time:
  `npx vitest run` → 0 failures, `cd backend && python -m pytest tests/ -q`
  should be untouched and green.

---

## Deliverables

One commit on `claude/probe-check-overview-<id>` containing:
- Updated `check-overview.test.js` (net-positive test count).
- Source fixes in `check-overview.js` only for bugs confirmed by a failing test.
- A new "Session — check-overview probe" section in `STABILITY_REPORT.md`.

Branch pushed. No PR.
