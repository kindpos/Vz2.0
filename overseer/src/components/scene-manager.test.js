// Tests for overseer/src/components/scene-manager.js — pins the navigation-
// trap fix from commit 17df848.
//
// Bug that existed before the fix:
//   SceneManager called scene.unmount() with no arguments, but every overseer
//   cleanup was registered as `unmount: (container) => cleanupXxx(container)`
//   and crashed on `container.innerHTML = ''` when container was undefined.
//   The exception escaped _unmountWorkingInternal without clearing
//   _workingScene, so the next mountWorking re-threw. Navigation was
//   permanently trapped across the whole Overseer.
//
// Fixes pinned here:
//   1. scene.unmount(container) receives the stored container, not ().
//   2. A throwing unmount is caught and does not block the next mountWorking.
//   3. A throwing cleanup is also caught; the container is still removed
//      and _workingScene is still cleared.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

function makeScene(name, overrides) {
  const handle = {
    mountCalls: 0,
    unmountCalls: 0,
    cleanupCalls: 0,
    unmountArg: undefined,
    lastParams: null,
  };
  const scene = {
    name,
    mount: (_container, params) => {
      handle.mountCalls += 1;
      handle.lastParams = params;
      return () => { handle.cleanupCalls += 1; };
    },
    unmount: (container) => {
      handle.unmountCalls += 1;
      handle.unmountArg = container;
    },
    ...overrides,
  };
  return { scene, handle };
}

function setupOverseerLayers() {
  document.body.innerHTML = '';
  const layers = {};
  for (const id of ['gate', 'working', 'transactional', 'interrupt', 'summary', 'header']) {
    const el = document.createElement('div');
    el.id = `layer-${id}`;
    document.body.appendChild(el);
    layers[id] = el;
  }
  return layers;
}

describe('overseer/src/components/scene-manager', () => {
  let SceneManager;
  let layers;

  beforeEach(async () => {
    vi.resetModules();
    layers = setupOverseerLayers();
    ({ SceneManager } = await import('./scene-manager.js'));
    SceneManager.init({ layers });
  });

  afterEach(() => {
    document.body.innerHTML = '';
    vi.restoreAllMocks();
  });

  it('scene.unmount receives the stored container argument (not undefined)', () => {
    const { scene, handle } = makeScene('w-a');
    SceneManager.register(scene);

    SceneManager.mountWorking('w-a');
    const mountedContainer = layers.working.querySelector('[data-scene="w-a"]');
    expect(mountedContainer).not.toBeNull();

    SceneManager.unmountWorking('w-a');

    expect(handle.unmountCalls).toBe(1);
    expect(handle.unmountArg).toBe(mountedContainer);
  });

  it('a throwing unmount does NOT block the next mountWorking (navigation stays unblocked)', () => {
    // Silence the expected console.error so the test output stays clean.
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const { scene: buggy } = makeScene('w-buggy', {
      unmount: () => { throw new Error('cleanup crashed'); },
    });
    const { scene: next, handle: nextHandle } = makeScene('w-next');
    SceneManager.register(buggy);
    SceneManager.register(next);

    SceneManager.mountWorking('w-buggy');
    // This used to trap navigation. Now the exception is swallowed inside
    // _unmountWorkingInternal so the next mount proceeds.
    SceneManager.mountWorking('w-next');

    expect(nextHandle.mountCalls).toBe(1);
    expect(SceneManager.getActiveWorking()).toBe('w-next');
    errSpy.mockRestore();
  });

  it('a throwing cleanup is also caught; container still removed, _workingScene cleared', () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    // Scene whose cleanup function (returned from mount) throws.
    const scene = {
      name: 'w-bad-cleanup',
      mount: () => { return () => { throw new Error('cleanup exploded'); }; },
      unmount: () => {},
    };
    const { scene: next, handle: nextHandle } = makeScene('w-fresh');
    SceneManager.register(scene);
    SceneManager.register(next);

    SceneManager.mountWorking('w-bad-cleanup');
    const container = layers.working.querySelector('[data-scene="w-bad-cleanup"]');
    expect(container).not.toBeNull();

    SceneManager.mountWorking('w-fresh');

    // The orphaned container must be gone so the next scene's render isn't
    // stacking on top of it.
    expect(layers.working.querySelector('[data-scene="w-bad-cleanup"]')).toBeNull();
    expect(nextHandle.mountCalls).toBe(1);
    expect(SceneManager.getActiveWorking()).toBe('w-fresh');
    errSpy.mockRestore();
  });
});
