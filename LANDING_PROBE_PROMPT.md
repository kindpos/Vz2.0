# Probe Prompt — Terminal Landing Scenes (Session 5)

You are running a probe-and-harden session on two frontend scenes in the KINDpos terminal:

- `terminal/scenes/manager-landing.js`
- `terminal/scenes/server-landing.js`

These are major scenes in the POS — the manager and server home screens where orders are filtered, voided, merged, tip-adjusted, and routed to checkout. The prior stability report (`STABILITY_REPORT.md`, Sessions 1–2) found 6 real bugs in these very files already (void bypass, double-submit merge, timer leak, error swallowing, tip_avg inflation, merge race). A 2026-04-22 check-overview redesign has since touched both scenes (theme-manager API additions, `selectedIds` removal from server-landing, new seat-tile layout). Time for a fresh probe.

## Your job

1. **Read both source files end-to-end** plus their current tests:
   - `terminal/scenes/manager-landing.test.js` (9 tests today)
   - `terminal/scenes/server-landing.test.js` (6 tests today)

2. **For every real bug you find**, add a failing test that reproduces it first, then fix the code, then watch the test go green. Prefer fixing over documenting.

3. **For every untested branch**, add a test that pins the current behavior — the last redesign silently rotted 27 tests for 3 weeks before they were repaired today. Regression locks matter.

4. **Run the suite continuously**. `npx vitest run terminal/scenes/manager-landing.test.js terminal/scenes/server-landing.test.js` for tight feedback; `npx vitest run` before committing.

5. **Append results to `STABILITY_REPORT.md`** as a new "Session 5 — Landing scenes probe" section, matching the Session 3 / Session 4 table format exactly:
   - Bugs found + fixed (cols: `#`, `Bug`, `File:line`, `Severity`, `Fix`)
   - Tests added (cols: `Surface`, `Tests`, `Notes`)
   - A short "Remaining risks, deferred" callout if anything was out-of-scope.

6. **Commit and push** to `claude/probe-landing-scenes-<short-id>`. Do not open a PR.

## Red-flag patterns to hunt for

Historical bug classes found in these files. Each has reproduced at least once.

1. **In-flight / double-submit guards.** Every user-triggered `fetch()` under a button handler must have an `_inflight`-style flag (`_merging`, `_voidPending`). Rapid double-tap without a guard = two requests. Grep every `fetch(` call in a handler.

2. **Race between validation and write.** Prior bug: merge target validated up front, concurrent payment closed it before the write loop ran. Look for any "validate → loop → write" pattern where the validated resource can mutate mid-loop.

3. **Timer cleanup.** `setTimeout` / `setInterval` handles must be cleared in the scene `cleanup()` hook. Prior bug: `_voidPendingTimer` fired after teardown and mutated detached state. Grep `setTimeout` / `setInterval` in the source, then confirm matching `clearTimeout` / `clearInterval` in the cleanup path.

4. **Event listener leaks.** `SceneManager.on(event, handler)` must be paired with `SceneManager.off(event, handler)` in cleanup. Unpaired `on`s leak across mounts.

5. **Error swallowing in fetch chains.** `fetch(url).then(r => r.json())` without an `r.ok` gate silently treats a 500 body as data. Dashboards show zeros. Grep `.then(r => r.json())` and flag any caller without `r.ok`.

6. **Stateful flag stuck-open.** Flags like `_refreshing` set before `fetch` and cleared in `.then(...)`: if the promise rejects, the flag stays set and blocks future refreshes forever. Every flag-set needs a `finally` or a matching clear in both success and failure paths.

7. **Selection / filter state drift.** `selectedIds` (manager-landing) and `filter` (OPEN/CLOSED/VOID) interact. Selection must clear on filter change. Check every filter-mutation path.

8. **Confirmation two-tap bypass.** Prior bug: void required two taps, but changing which checks were selected between tap 1 and tap 2 skipped confirmation entirely. Pattern: any "pending" state keyed by a mutable identifier.

9. **Button-enable state drift.** A button gated by a selection can stay enabled on stale state when the selection changes but the disabled flag doesn't re-evaluate.

10. **Dead code from the redesign.** The check-overview redesign removed `selectedIds` from server-landing. Look for residual handler branches or `_refs` entries referencing removed state.

## Style and scope constraints

- Test patterns are locked. Match the existing `vi.mock('../theme-manager.js', ...)` shape (see `manager-landing.test.js:55` — bare DOM for `buildStaticCard` / `buildNavCard` / `buildActionCard`, wrapper for `buildCard`, identity stubs for `lightenHex` / `darkenHex` / `hexToRgba`).
- No new production abstractions. If you're fixing a bug, change the minimum code needed. If the fix needs a helper, justify it in the commit message.
- No backwards-compat shims. Delete dead code; don't rename-with-underscore.
- Don't touch any file outside: the two `.js` scenes, their two `.test.js` files, and `STABILITY_REPORT.md`.
- Suite must be green at commit time. `npx vitest run` → 0 failures. Backend (`cd backend && python -m pytest tests/ -q`) should not regress — it shouldn't be touched.

## Deliverables

One commit on `claude/probe-landing-scenes-<id>` containing:
- Updated tests in the two test files (net-positive test count).
- Source fixes only for bugs you've landed a failing test for.
- A new "Session 5" section in `STABILITY_REPORT.md`.

Branch pushed. No PR.
