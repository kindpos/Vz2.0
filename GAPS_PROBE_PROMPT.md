# Probe Prompt — Remaining Gaps (post check-overview session)

You are running a hardening session against the KINDpos terminal codebase on
branch `claude/validate-kindpos-refactor-6kF3I`. The previous probe session
fixed all seven check-overview.js bug candidates and added 19 tests (10 → 29).
Three items were explicitly deferred and are the primary targets here, plus a
separate scene (`close-day-checks-viewer.js`) with its own known bug list.

Current stability rating: **B+**. Goal: close enough gaps to argue for A-.

---

## Suites and how to run them

```bash
# Frontend fast loop
npx vitest run terminal/scenes/check-overview.test.js
npx vitest run terminal/scenes/close-day-checks-viewer.test.js   # may not exist yet

# Full frontend
npx vitest run

# Backend (canonical — must use --rootdir)
cd backend && PYTHONPATH=. .venv/bin/pytest --rootdir=. --ignore=tests/test_dejavoo_spin*.py -q tests/
```

Running pytest from the repo root without `--rootdir=backend/` silently skips
~102 async tests — always run from inside `backend/`.

---

## Target 1 — check-overview.js: three deferred items

These were explicitly deferred at the end of the last session.

### 1a — `_commitManageMove` and `_commitManageMergeCheck` untested (MEDIUM)

**File:** `terminal/scenes/check-overview.js` (~lines 1450–1560, verify)  
Both functions issue PATCH / POST network calls to persist MANAGE-mode mutations.
Neither has any test coverage. A regression here would silently corrupt seat
assignments with no observable test failure.

**What to do:**
- Read the functions end-to-end to understand the request shape.
- Write at least two tests each:
  - Happy path: correct endpoint called, correct body shape, seats updated.
  - Error path: fetch returns `ok:false` → error toast shown, state not mutated.
- If either function uses raw `fetch` instead of `fetchWithTimeout`, fix it.
- If either lacks an `.ok` guard, add one (same pattern as the Bug 2 fix).

---

### 1b — `openSeatPaymentInterrupt` void-payment flow (LOW)

**File:** `terminal/scenes/check-overview.js` (~lines 3999, 4010, verify)  
Two raw `fetch` calls inside `openSeatPaymentInterrupt` have no `.ok` guard and
no timeout wrapper — silent failures, same failure mode as Bug 2 in the last
session.

**What to do:**
- Verify both calls are still raw `fetch` (not already fixed).
- For each confirmed raw-fetch: write a failing test (mock returns `ok:false`,
  assert toast shown), then fix the production code, then confirm green.
- If already using `fetchWithTimeout` with `.ok` guards, add a regression-lock
  test confirming the guard is exercised.

---

### 1c — `handlePay` routing guard paths (LOW)

**File:** `terminal/scenes/check-overview.js` (~lines 3294–3390, verify)  
`handlePay` has multiple early-return guards (busy flag, empty seat summary,
no items selected, already-paid seats). None are tested.

**What to do:**
- Write tests for each guard:
  - `state._busy` set → no `SceneManager.mountWorking` call.
  - All selected seats already in `paidSeats` → toast shown, no navigation.
  - No items in selected seats → toast shown, no navigation.
- You do not need to test the full payment scene mount — mocking
  `SceneManager.mountWorking` and asserting call count / args is sufficient.

---

## Target 2 — close-day-checks-viewer.js (MEDIUM overall)

**File:** `terminal/scenes/close-day-checks-viewer.js`  
This scene has multiple known bugs that were deferred in the original audit. It
likely has no or very few tests. Read the file end-to-end first.

Known issues to confirm and fix:

| # | Issue | Location (approx) | Severity |
|---|---|---|---|
| A | Unguarded raw `fetch` calls | ~lines 133, 877, 911, 966 | MEDIUM |
| B | Inverted `tip-adjusted` logic | ~line 171 | MEDIUM |
| C | Rebuild-time listener leaks | ~lines 273, 624 | MEDIUM |
| D | Multi-check action buttons lack `_busy` locks | various | MEDIUM |
| E | Escaped `setTimeout` in `onVoidCheck` — fires after unmount | verify | MEDIUM |

**Process for each confirmed bug:**
1. Write a failing test that reproduces it.
2. Fix the production code.
3. Confirm the test goes green.

**For Bug E specifically**, use `vi.useFakeTimers()` — same pattern as the
void-item timer fix in check-overview.js (Bug 1 last session).

**For Bug B (inverted logic):** Read the tip-adjusted condition carefully before
writing the test. Confirm the current output is wrong by reasoning through the
expected behavior, then write the test against the correct expected output, then
fix.

If a test file doesn't exist for this scene, create
`terminal/scenes/close-day-checks-viewer.test.js` following the same mock shape
as `check-overview.test.js` exactly:

```js
vi.mock('../scene-manager.js', () => ({
  SceneManager: { interrupt: vi.fn(), on: vi.fn(), off: vi.fn(), emit: vi.fn() },
  defineScene: (def) => { registeredScenes.push(def); return def; },
}));

vi.mock('../theme-manager.js', () => ({
  buildCard:       () => ({ wrap: document.createElement('div'), card: document.createElement('div') }),
  buildStaticCard: () => { const el = document.createElement('div'); el.setAccent = vi.fn(); return el; },
  buildActionCard: ({ onClick } = {}) => { const el = document.createElement('div'); if (onClick) el.addEventListener('pointerup', onClick); el.setAccent = vi.fn(); return el; },
  buildPillButton: ({ label } = {}) => { const el = document.createElement('button'); el.textContent = label || ''; return el; },
  hexToRgba: (c) => c, darkenHex: (c) => c, lightenHex: (c) => c,
}));

vi.mock('../net.js', () => ({
  fetchWithTimeout: vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve({}) })),
}));

vi.mock('../components.js', () => ({
  showToast: vi.fn(),
  buildGap:  () => document.createElement('div'),
}));
```

Use `vi.resetModules()` in `beforeEach`.

---

## Target 3 — `_transitionHooks` listener leak in scene-manager.js (MEDIUM)

**File:** `terminal/scene-manager.js:409` (verify line)  
`_transitionHooks` is append-only — there is no `removeBeforeTransition(fn)`
API. Scenes that register a before-transition hook and then unmount leak the
hook permanently. On a long-running terminal session this accumulates stale
closures.

**What to do:**
- Read the relevant section of `scene-manager.js`.
- Confirm the leak exists (no removal path).
- Fix: add a `removeBeforeTransition(fn)` function that splices the hook by
  reference — same pattern as `SceneManager.off()` for event listeners.
- Write a test: register a hook, remove it, trigger a transition, assert the
  hook was not called.
- Do NOT add this to check-overview.js or close-day-checks-viewer.js — fix it
  at the source in scene-manager.js.

---

## Scope constraints

- **Only touch:**
  - `terminal/scenes/check-overview.js`
  - `terminal/scenes/check-overview.test.js`
  - `terminal/scenes/close-day-checks-viewer.js`
  - `terminal/scenes/close-day-checks-viewer.test.js` (create if absent)
  - `terminal/scene-manager.js`
  - `terminal/scene-manager.test.js` (create or extend)
  - `STABILITY_REPORT.md`
- **Do not touch** backend files, other scene files, or any other frontend module.
- No new production abstractions beyond what each fix requires.
- Suite must be green at commit time: `npx vitest run` → 0 failures,
  `cd backend && python -m pytest` → untouched and green.

---

## Deliverables

One commit on `claude/probe-remaining-gaps-<short-id>` containing:

1. Source fixes only for bugs confirmed by a failing test.
2. Updated / new test files with net-positive test counts.
3. A new **"Session — remaining-gaps probe (2026-04-25)"** section appended to
   `STABILITY_REPORT.md`, matching the prior bug-table format:
   - **Bugs found + fixed** (`#`, `Bug`, `File:line`, `Severity`, `Fix`)
   - **Tests added** (`Surface`, `Tests`, `Notes`)
   - **Remaining risks, deferred** callout for anything still out of scope
   - Updated overall stability rating (argue for A- if warranted)

Branch pushed. No PR.
