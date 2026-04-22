// Tests for terminal/scene-manager.js — pins the interrupt callback plumbing,
// the closeInterrupt alias, layer-stacking guards, transition hooks, and the
// _emit error-swallow path. Each of these is a regression already fixed in the
// code; this file keeps them fixed.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// Stub the entomology client so `entReport` is a spy. `vi.mock` is hoisted,
// and both scene-manager.js and this file resolve `./entomology-client.js` to
// the same module id.
vi.mock('./entomology-client.js', () => ({
  entReport: vi.fn(() => Promise.resolve()),
}));

function setupDom() {
  document.body.innerHTML = `
    <div id="terminal">
      <div id="header"></div>
      <div id="layer-working"></div>
      <div id="layer-transactional"></div>
      <div id="order-summary"></div>
      <div id="layer-interrupt"></div>
      <div id="layer-gate"></div>
    </div>
  `;
}

// A minimal scene factory. Returns the registration AND a handle that lets a
// test grab the params passed to mount — most notably the `wrappedConfirm` /
// `wrappedCancel` that the interrupt API injects.
function makeScene(name) {
  const handle = { mountCalls: 0, params: null, unmountCalls: 0, cleanupCalls: 0 };
  const scene = {
    name,
    mount: (_container, params) => {
      handle.mountCalls += 1;
      handle.params = params;
      return () => { handle.cleanupCalls += 1; };
    },
    unmount: () => { handle.unmountCalls += 1; },
  };
  return { scene, handle };
}

describe('terminal/scene-manager', () => {
  let SceneManager;
  let entReport;

  beforeEach(async () => {
    vi.resetModules();
    setupDom();
    ({ entReport } = await import('./entomology-client.js'));
    entReport.mockClear();
    ({ SceneManager } = await import('./scene-manager.js'));
    SceneManager.init();
  });

  afterEach(() => {
    document.body.innerHTML = '';
  });

  // ── interrupt callback plumbing ─────────────────────────────────

  it('interrupt with object-embedded onConfirm → user callback fires with forwarded args', () => {
    const { scene, handle } = makeScene('confirm-x');
    SceneManager.register(scene);
    const userFn = vi.fn();

    SceneManager.interrupt('confirm-x', { onConfirm: userFn, extra: 'data' });

    // The sub-scene got `wrappedConfirm`, not the user's `userFn`, but the extra
    // param must still be forwarded to the mount.
    expect(handle.params.extra).toBe('data');
    expect(typeof handle.params.onConfirm).toBe('function');
    expect(handle.params.onConfirm).not.toBe(userFn);

    // Sub-scene resolves with some payload; user's fn should receive it.
    handle.params.onConfirm('pin-ok', { employee: 'mgr1' });

    expect(userFn).toHaveBeenCalledTimes(1);
    expect(userFn).toHaveBeenCalledWith('pin-ok', { employee: 'mgr1' });
  });

  it('interrupt with positional callbacks → user callback fires with forwarded args', () => {
    const { scene, handle } = makeScene('confirm-y');
    SceneManager.register(scene);
    const userConfirm = vi.fn();
    const userCancel  = vi.fn();

    SceneManager.interrupt('confirm-y', { title: 'Void?' }, userConfirm, userCancel);

    handle.params.onConfirm('done');
    expect(userConfirm).toHaveBeenCalledWith('done');
  });

  it('interrupt onCancel wrapping forwards args the same way', () => {
    const { scene, handle } = makeScene('cancel-x');
    SceneManager.register(scene);
    const userCancel = vi.fn();

    SceneManager.interrupt('cancel-x', { onCancel: userCancel });
    handle.params.onCancel('user-backed-out');

    expect(userCancel).toHaveBeenCalledWith('user-backed-out');
  });

  // ── closeInterrupt alias ────────────────────────────────────────

  it('closeInterrupt is an exported alias that resolves the current interrupt (same as resolveInterrupt)', () => {
    const { scene, handle } = makeScene('int-alias');
    SceneManager.register(scene);

    SceneManager.interrupt('int-alias');
    expect(SceneManager.hasInterrupt()).toBe(true);

    // Invoke via the 20+-call-sites spelling.
    SceneManager.closeInterrupt('int-alias');

    expect(SceneManager.hasInterrupt()).toBe(false);
    expect(handle.unmountCalls).toBe(1);
    expect(handle.cleanupCalls).toBe(1);
  });

  // ── Stacking guards ─────────────────────────────────────────────

  it('opening an interrupt while one is open tears down the first and emits UI-001', () => {
    const { scene: sceneA, handle: a } = makeScene('int-a');
    const { scene: sceneB, handle: b } = makeScene('int-b');
    SceneManager.register(sceneA);
    SceneManager.register(sceneB);

    SceneManager.interrupt('int-a');
    SceneManager.interrupt('int-b');

    expect(a.unmountCalls).toBe(1);           // A torn down before B opened
    expect(b.mountCalls).toBe(1);              // B is now active
    const codes = entReport.mock.calls.map((c) => c[0].code);
    expect(codes).toContain('UI-001');
  });

  it('opening a gate while one is open tears down the first and emits UI-001', () => {
    const { scene: sceneA, handle: a } = makeScene('gate-a');
    const { scene: sceneB }             = makeScene('gate-b');
    SceneManager.register(sceneA);
    SceneManager.register(sceneB);

    SceneManager.openGate('gate-a');
    SceneManager.openGate('gate-b');

    expect(a.unmountCalls).toBe(1);
    const codes = entReport.mock.calls.map((c) => c[0].code);
    expect(codes).toContain('UI-001');
  });

  // ── onBeforeTransition disposer ─────────────────────────────────

  it('onBeforeTransition(fn) returns a disposer that removes the hook', () => {
    const hook = vi.fn();
    const dispose = SceneManager.onBeforeTransition(hook);
    expect(typeof dispose).toBe('function');

    const { scene } = makeScene('w-1');
    SceneManager.register(scene);

    SceneManager.mountWorking('w-1');
    expect(hook).toHaveBeenCalledTimes(1);

    dispose();

    SceneManager.mountWorking('w-1');
    expect(hook).toHaveBeenCalledTimes(1); // Still 1 — hook was removed.
  });

  // ── _unmountWorkingInternal tears down layers above ─────────────
  //
  // Pins the fix from df3877d: switching working scenes while a transactional
  // or interrupt was open used to orphan them in their layer with live timers
  // and an unreachable DOM node. Now unmountWorking first resolves the
  // interrupt (if any) and closes all transactionals before tearing down the
  // working scene itself.

  it('mounting a new working scene tears down any open interrupt first', () => {
    const { scene: work1, handle: w1 } = makeScene('w-old');
    const { scene: work2 } = makeScene('w-new');
    const { scene: intr } = makeScene('i-on-top');
    SceneManager.register(work1);
    SceneManager.register(work2);
    SceneManager.register(intr);

    SceneManager.mountWorking('w-old');
    SceneManager.interrupt('i-on-top');
    expect(SceneManager.hasInterrupt()).toBe(true);

    SceneManager.mountWorking('w-new');

    expect(SceneManager.hasInterrupt()).toBe(false); // no orphan interrupt
    expect(SceneManager.getActiveWorking()).toBe('w-new');
    expect(w1.unmountCalls).toBe(1);                 // old working cleaned up
  });

  it('mounting a new working scene closes all transactionals (no orphan timers)', () => {
    const { scene: work1 } = makeScene('w-old');
    const { scene: work2 } = makeScene('w-new');
    const { scene: tx1, handle: t1 } = makeScene('tx-one');
    const { scene: tx2, handle: t2 } = makeScene('tx-two');
    SceneManager.register(work1);
    SceneManager.register(work2);
    SceneManager.register(tx1);
    SceneManager.register(tx2);

    SceneManager.mountWorking('w-old');
    SceneManager.openTransactional('tx-one');
    SceneManager.openTransactional('tx-two');
    expect(SceneManager.getTransactionalStack()).toEqual(['tx-one', 'tx-two']);

    SceneManager.mountWorking('w-new');

    expect(SceneManager.getTransactionalStack()).toEqual([]);
    expect(t1.unmountCalls).toBe(1);
    expect(t2.unmountCalls).toBe(1);
  });

  // ── _emit error handling ────────────────────────────────────────

  it('_emit catches a throwing handler, emits UI-002, and other handlers still fire', () => {
    const handlerA = vi.fn(() => { throw new Error('boom'); });
    const handlerB = vi.fn();

    SceneManager.on('bus:test', handlerA);
    SceneManager.on('bus:test', handlerB);

    // Must not throw out of _emit.
    expect(() => SceneManager.emit('bus:test', { payload: 42 })).not.toThrow();

    expect(handlerA).toHaveBeenCalledTimes(1);
    expect(handlerB).toHaveBeenCalledTimes(1); // Second handler still ran.

    const ui002 = entReport.mock.calls.find((c) => c[0].code === 'UI-002');
    expect(ui002).toBeDefined();
    expect(ui002[0].source).toBe('scene-manager._emit');
    expect(ui002[0].ctx.event).toBe('bus:test');
  });
});
