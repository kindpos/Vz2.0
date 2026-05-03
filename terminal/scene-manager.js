// ═══════════════════════════════════════════════════
//  KINDpos Terminal — Scene Manager  (Vz2.0)
//  Layer Stack: Gate / Working / Transactional / Interrupt
//  Nice. Dependable. Yours.
// ═══════════════════════════════════════════════════
//
//  Architecture unchanged from v3 — proven in production.
//  Only change: imports from ./tokens.js (Nostalgia values).
//
//  Layer hierarchy (z-index low → high):
//    Working       (10)  — primary scene canvas
//    Transactional (20)  — overlays above working scene
//    Summary       (25)  — order summary panel (left column)
//    Interrupt     (30)  — blocks all input until resolved
//    Gate          (100) — full-screen blocks (login)
//
//  Usage:
//    import { SceneManager, defineScene } from './scene-manager.js';
//    SceneManager.init();
//    SceneManager.openGate('login');
// ═══════════════════════════════════════════════════

import { T, onThemeChange } from '../common/tokens.js';
import { entReport }         from './entomology-client.js';

// ── Scene Registry ────────────────────────────────
const _scenes = {};

// ── Layer State ───────────────────────────────────
let _gateScene        = null;   // { name, cleanup, scrim, container }
let _workingScene     = null;   // { name, cleanup, container }
const _transactionalStack = []; // [{ name, cleanup, scrim, frame, container }]
let _interruptScene   = null;   // { name, cleanup, scrim, frame, container }

// ── DOM Containers ────────────────────────────────
let _layerGate        = null;
let _layerWorking     = null;
let _layerTransactional = null;
let _layerSummary     = null;
let _layerInterrupt   = null;
let _headerBar        = null;

// ── Event Bus ─────────────────────────────────────
const _bus = {};

// ── Transition Hooks ──────────────────────────────
const _transitionHooks = [];

// ── Summary visibility ────────────────────────────
let _summaryVisible = false;

// ═══════════════════════════════════════════════════
//  REGISTRATION
// ═══════════════════════════════════════════════════

function register(scene) {
  if (!scene || !scene.name) {
    console.error('SceneManager.register: scene must have a name');
    return;
  }
  _scenes[scene.name] = scene;
}

function hasScene(name) {
  return !!(name && _scenes[name]);
}

// ═══════════════════════════════════════════════════
//  INIT — Wire DOM containers
// ═══════════════════════════════════════════════════

function init() {
  const terminal = document.getElementById('terminal');
  if (!terminal) {
    console.error('SceneManager.init: #terminal not found');
    return;
  }

  _headerBar          = document.getElementById('header');
  _layerWorking       = document.getElementById('layer-working');
  _layerTransactional = document.getElementById('layer-transactional');
  _layerSummary       = document.getElementById('order-summary');
  _layerInterrupt     = document.getElementById('layer-interrupt');
  _layerGate          = document.getElementById('layer-gate');

  _applyLayerGeometry();
  onThemeChange(() => { _applyLayerGeometry(); });
}

function _applyLayerGeometry() {
  const hH       = `${T.headerH}px`;
  const bodyH    = `calc(100% - ${hH})`;
  const summaryW = T.pcLeftW;
  const sceneLeft = _summaryVisible ? `${summaryW + T.colGapSm}px` : '0';
  const sceneW    = _summaryVisible ? `calc(100% - ${sceneLeft})` : '100%';

  if (_layerSummary) {
    _layerSummary.style.top    = hH;
    _layerSummary.style.left   = '0';
    _layerSummary.style.width  = `${summaryW}px`;
    _layerSummary.style.height = bodyH;
    _layerSummary.style.zIndex = T.zSummary;
  }

  [_layerWorking, _layerTransactional, _layerInterrupt].forEach((el) => {
    if (!el) return;
    el.style.top    = hH;
    el.style.left   = sceneLeft;
    el.style.width  = sceneW;
    el.style.height = bodyH;
  });

  // Gate — full screen (covers header too; login must not show header above it)
  if (_layerGate) {
    _layerGate.style.top    = '0';
    _layerGate.style.left   = '0';
    _layerGate.style.width  = '100%';
    _layerGate.style.height = '100%';
  }

  if (_layerWorking)       _layerWorking.style.zIndex       = T.zWorking;
  if (_layerTransactional) _layerTransactional.style.zIndex = T.zTransactional;
  if (_layerSummary)       _layerSummary.style.zIndex       = T.zSummary;
  if (_layerInterrupt)     _layerInterrupt.style.zIndex     = T.zInterrupt;
  if (_layerGate)          _layerGate.style.zIndex          = T.zGate;
}

// ═══════════════════════════════════════════════════
//  GATE LAYER  — login, full-screen blocks
// ═══════════════════════════════════════════════════

function openGate(sceneName) {
  const scene = _scenes[sceneName];
  if (!scene) return console.error(`SceneManager.openGate: "${sceneName}" not registered`);

  // Tear down a prior gate before stacking — otherwise the old one's DOM +
  // cleanup are leaked when _gateScene is reassigned.
  if (_gateScene) {
    entReport({
      code: 'UI-001',
      source: 'scene-manager.openGate',
      message: 'Gate stacked; prior torn down',
      ctx: { prior: _gateScene.name, next: sceneName },
      level: 'WARNING',
    });
    closeGate(_gateScene.name);
  }

  const scrim = document.createElement('div');
  scrim.className = 'layer-scrim layer-scrim-gate';
  scrim.style.cssText = `position:absolute;inset:0;background:${T.scrimGate};`;
  _layerGate.appendChild(scrim);

  const container = document.createElement('div');
  container.className = 'layer-content';
  container.dataset.scene = sceneName;
  container.style.cssText = 'position:absolute;inset:0;';
  _layerGate.appendChild(container);

  _layerGate.style.pointerEvents = 'auto';

  const cleanup = scene.mount(container, {});
  _gateScene = { name: sceneName, cleanup, scrim, container };
}

function closeGate(sceneName) {
  if (!_gateScene || _gateScene.name !== sceneName) return;

  const scene = _scenes[_gateScene.name];
  if (scene && scene.unmount) scene.unmount();
  if (typeof _gateScene.cleanup === 'function') _gateScene.cleanup();

  _gateScene.container.remove();
  _gateScene.scrim.remove();
  _layerGate.style.pointerEvents = 'none';
  _gateScene = null;

  _emit('gate:closed');
}

// ═══════════════════════════════════════════════════
//  WORKING LAYER  — primary scene canvas
// ═══════════════════════════════════════════════════

function mountWorking(sceneName, params) {
  if (params === undefined) params = {};

  const scene = _scenes[sceneName];
  if (!scene) return console.error(`SceneManager.mountWorking: "${sceneName}" not registered`);

  _transitionHooks.forEach((fn) => { fn(); });

  if (_workingScene) _unmountWorkingInternal();

  const container = document.createElement('div');
  container.className = 'layer-content';
  container.dataset.scene = sceneName;
  container.style.cssText = 'position:absolute;inset:0;';
  _layerWorking.appendChild(container);

  const cleanup = scene.mount(container, params);
  _workingScene = { name: sceneName, cleanup, container };

  _emit('working:mounted', { sceneName });
}

function unmountWorking(sceneName) {
  if (!_workingScene || _workingScene.name !== sceneName) return;
  _unmountWorkingInternal();
  _emit('working:unmounted', { sceneName });
}

function _unmountWorkingInternal() {
  if (!_workingScene) return;
  // Tear down layers above working first; their cleanup (intervals, listeners,
  // DOM) is owned by the working scene's lifetime. Without this, switching
  // working scenes while a transactional or interrupt is open orphans them
  // in their layer with live timers and unreachable DOM.
  if (_interruptScene) resolveInterrupt();
  if (_transactionalStack.length > 0) closeAllTransactional();
  const scene = _scenes[_workingScene.name];
  if (scene && scene.unmount) scene.unmount();
  if (typeof _workingScene.cleanup === 'function') _workingScene.cleanup();
  _workingScene.container.remove();
  _workingScene = null;
}

// ═══════════════════════════════════════════════════
//  TRANSACTIONAL LAYER  — overlays above working scene
// ═══════════════════════════════════════════════════

function openTransactional(sceneName, params) {
  if (params === undefined) params = {};

  const scene = _scenes[sceneName];
  if (!scene) return console.error(`SceneManager.openTransactional: "${sceneName}" not registered`);

  _transitionHooks.forEach((fn) => { fn(); });
  _emit('transactional:opening', { sceneName });

  const scrim = document.createElement('div');
  scrim.className = 'layer-scrim layer-scrim-transactional';
  scrim.style.cssText = `position:absolute;inset:0;background:${T.scrimInterrupt};`;
  _layerTransactional.appendChild(scrim);

  const frame = document.createElement('div');
  frame.className = 'layer-frame layer-frame-transactional';
  frame.style.cssText = 'position:absolute;inset:0;';
  _layerTransactional.appendChild(frame);

  const container = document.createElement('div');
  container.className = 'layer-content';
  container.dataset.scene = sceneName;
  container.style.cssText = 'width:100%;height:100%;position:relative;';
  frame.appendChild(container);

  _layerTransactional.style.pointerEvents = 'auto';

  frame.classList.add('layer-transactional-enter');
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      frame.classList.remove('layer-transactional-enter');
    });
  });

  const cleanup = scene.mount(container, params);
  _transactionalStack.push({
    name: sceneName, cleanup,
    scrim, frame, container,
  });

  _emit('transactional:opened', { sceneName });
}

function closeTransactional(sceneName) {
  let idx = -1;
  for (let i = _transactionalStack.length - 1; i >= 0; i--) {
    if (_transactionalStack[i].name === sceneName) { idx = i; break; }
  }
  if (idx === -1) return;

  const entry = _transactionalStack[idx];
  const scene = _scenes[entry.name];
  if (scene && scene.unmount) scene.unmount();
  if (typeof entry.cleanup === 'function') entry.cleanup();

  entry.frame.remove();
  entry.scrim.remove();
  _transactionalStack.splice(idx, 1);

  if (_transactionalStack.length === 0) {
    _layerTransactional.style.pointerEvents = 'none';
  }

  _emit('transactional:closed', { sceneName });
}

function closeAllTransactional() {
  while (_transactionalStack.length > 0) {
    closeTransactional(_transactionalStack[_transactionalStack.length - 1].name);
  }
}

// ═══════════════════════════════════════════════════
//  INTERRUPT LAYER  — blocks all input until resolved
// ═══════════════════════════════════════════════════

function interruptFn(sceneName, params, onConfirm, onCancel) {
  if (params === undefined) params = {};

  const scene = _scenes[sceneName];
  if (!scene) return console.error(`SceneManager.interrupt: "${sceneName}" not registered`);

  // Two calling styles are in the wild:
  //   positional:  interrupt('x', params, onConfirm, onCancel)
  //   object-embed: interrupt('x', { onConfirm, onCancel, ...params })
  // The object-embed form was silently broken: Object.assign overwrote the
  // caller's onConfirm with the wrapped one, and wrappedConfirm only looked
  // at the positional arg (undefined under object-embed). So the user's
  // callback never fired and the sub-scene's data was discarded. Pull the
  // user callbacks out of both places and forward any args the sub-scene
  // passes (e.g. the PIN result from co-manager-pin).
  const userConfirm = onConfirm || (params && params.onConfirm) || null;
  const userCancel  = onCancel  || (params && params.onCancel)  || null;

  // An interrupt already on screen must be torn down before we stack a new one,
  // otherwise its DOM + cleanup are leaked when _interruptScene is reassigned.
  if (_interruptScene) {
    entReport({
      code: 'UI-001',
      source: 'scene-manager.interrupt',
      message: 'Interrupt stacked; prior torn down',
      ctx: { prior: _interruptScene.name, next: sceneName },
      level: 'WARNING',
    });
    resolveInterrupt();
  }

  const scrim = document.createElement('div');
  scrim.className = 'layer-scrim layer-scrim-interrupt';
  scrim.style.cssText = `position:absolute;inset:0;background:${T.scrimInterrupt};`;
  _layerInterrupt.appendChild(scrim);

  // Frame is a transparent full-layer surface — captures input while an
  // interrupt is open. Legacy 2px rectangular border removed; the card
  // chrome is the scene's responsibility (see buildCard / co-manager-pin).
  const frame = document.createElement('div');
  frame.className = 'layer-frame layer-frame-interrupt';
  frame.style.cssText = 'position:absolute;inset:0;';
  _layerInterrupt.appendChild(frame);

  const container = document.createElement('div');
  container.className = 'layer-content';
  container.dataset.scene = sceneName;
  container.style.cssText = 'width:100%;height:100%;position:relative;';
  frame.appendChild(container);

  _layerInterrupt.style.pointerEvents = 'auto';

  // Forward arbitrary args so the sub-scene's payload (e.g. PIN data) reaches
  // the user's callback. Try/catch around the user call so a crashing handler
  // can't leave the interrupt half-torn-down; the error is reported but the
  // resolve still ran.
  const wrappedConfirm = function() {
    const args = Array.prototype.slice.call(arguments);
    resolveInterrupt(sceneName);
    if (userConfirm) {
      try { userConfirm.apply(null, args); }
      catch (e) {
        console.error('interrupt onConfirm threw:', e);
        entReport({
          code: 'UI-002',
          source: 'scene-manager.interrupt.onConfirm',
          message: 'Interrupt onConfirm raised',
          ctx: { scene: sceneName, error: String(e && e.message || e).slice(0, 200) },
          level: 'ERROR',
        });
      }
    }
  };
  const wrappedCancel = function() {
    const args = Array.prototype.slice.call(arguments);
    resolveInterrupt(sceneName);
    if (userCancel) {
      try { userCancel.apply(null, args); }
      catch (e) {
        console.error('interrupt onCancel threw:', e);
        entReport({
          code: 'UI-002',
          source: 'scene-manager.interrupt.onCancel',
          message: 'Interrupt onCancel raised',
          ctx: { scene: sceneName, error: String(e && e.message || e).slice(0, 200) },
          level: 'ERROR',
        });
      }
    }
  };

  const mountParams = Object.assign({}, params, {
    onConfirm: wrappedConfirm,
    onCancel:  wrappedCancel,
  });

  const cleanup = scene.mount(container, mountParams);
  _interruptScene = {
    name: sceneName, cleanup,
    scrim, frame, container,
  };

  _emit('interrupt:opened', { sceneName });
}

function resolveInterrupt(sceneName) {
  if (!_interruptScene) return;
  if (sceneName && _interruptScene.name !== sceneName) return;

  const scene = _scenes[_interruptScene.name];
  const name  = _interruptScene.name;
  if (scene && scene.unmount) scene.unmount();
  if (typeof _interruptScene.cleanup === 'function') _interruptScene.cleanup();

  _interruptScene.frame.remove();
  _interruptScene.scrim.remove();
  _layerInterrupt.style.pointerEvents = 'none';
  _interruptScene = null;

  _emit('interrupt:resolved', { sceneName: name });
}

// ═══════════════════════════════════════════════════
//  SUMMARY LAYER  — left column order panel
// ═══════════════════════════════════════════════════

function showSummary() {
  if (!_layerSummary) return;
  _summaryVisible = true;
  _layerSummary.style.display = 'flex';
  _layerSummary.style.pointerEvents = 'auto';
  _applyLayerGeometry();
  _emit('summary:shown');
}

function hideSummary() {
  if (!_layerSummary) return;
  _summaryVisible = false;
  _layerSummary.style.display = 'none';
  _layerSummary.style.pointerEvents = 'none';
  _applyLayerGeometry();
  _emit('summary:hidden');
}

function getSummaryLayer() {
  return _layerSummary;
}

// ═══════════════════════════════════════════════════
//  EVENT BUS
// ═══════════════════════════════════════════════════

function on(event, handler) {
  if (!_bus[event]) _bus[event] = [];
  _bus[event].push(handler);
}

function off(event, handler) {
  if (!_bus[event]) return;
  _bus[event] = _bus[event].filter((h) => h !== handler);
}

function _emit(event, data) {
  if (!_bus[event]) return;
  const handlers = _bus[event].slice();
  for (let i = 0; i < handlers.length; i++) {
    try { handlers[i](data); }
    catch (e) {
      console.error(`Event handler error [${event}]:`, e);
      // UI-002 — a bus handler threw. Usually because it's touching scene
      // state after the scene unmounted; worth surfacing in the bug report.
      entReport({
        code: 'UI-002',
        source: 'scene-manager._emit',
        message: `Bus handler raised on "${event}"`,
        ctx: { event, error: String(e && e.message || e).slice(0, 200) },
        level: 'ERROR',
      });
    }
  }
}

function emit(event, data) { _emit(event, data); }

// ═══════════════════════════════════════════════════
//  GETTERS
// ═══════════════════════════════════════════════════

function getActiveWorking()      { return _workingScene ? _workingScene.name : null; }
function getTransactionalStack() { return _transactionalStack.map((e) => e.name); }
function hasInterrupt()          { return _interruptScene !== null; }

// ═══════════════════════════════════════════════════
//  TRANSITION HOOKS
// ═══════════════════════════════════════════════════

function onBeforeTransition(fn) {
  _transitionHooks.push(fn);
  // Return a disposer so callers that care about cleanup can unregister.
  // Pre-existing callers that ignore the return value still work — the hook
  // just stays until reload. Added because _transitionHooks used to be
  // append-only and leaked hooks across scene lifetimes.
  return function removeBeforeTransition() {
    const idx = _transitionHooks.indexOf(fn);
    if (idx !== -1) _transitionHooks.splice(idx, 1);
  };
}

// ═══════════════════════════════════════════════════
//  PUBLIC API
// ═══════════════════════════════════════════════════

export const SceneManager = {
  register,
  hasScene,
  init,

  openGate,
  closeGate,

  mountWorking,
  unmountWorking,

  openTransactional,
  closeTransactional,
  closeAllTransactional,

  interrupt:        interruptFn,
  // `openInterrupt` is a symmetric alias for `interrupt`.
  openInterrupt:    interruptFn,
  resolveInterrupt,
  // `closeInterrupt` is the name 20+ call sites use; forward to the same
  // implementation so both spellings work. Prefer `resolveInterrupt` going
  // forward — it reflects that the interrupt is resolved (confirm/cancel),
  // not just closed.
  closeInterrupt:   resolveInterrupt,

  showSummary,
  hideSummary,
  getSummaryLayer,

  on,
  off,
  emit,

  getActiveWorking,
  getTransactionalStack,
  hasInterrupt,

  onBeforeTransition,
};

// ═══════════════════════════════════════════════════
//  defineScene — higher-level scene API
//  Auto-manages state, event cleanup, sub-scenes.
//
//  Usage:
//    defineScene({
//      name:   'login',
//      state:  { pin: [] },
//      events: { 'auth:success': (data) => { ... } },
//      render: (container, params, state) => {
//        // build DOM, return cleanup fn
//        return function cleanup() { ... };
//      },
//      interrupts:    { 'confirm-void': { render, unmount } },
//      transactionals:{ 'tip-adjust':  { render, unmount } },
//    });
// ═══════════════════════════════════════════════════

function _deepCopy(obj) {
  if (obj === null || typeof obj !== 'object') return obj;
  if (Array.isArray(obj)) {
    return obj.map((v) => _deepCopy(v));
  }
  const copy = {};
  const keys = Object.keys(obj);
  for (let j = 0; j < keys.length; j++) {
    copy[keys[j]] = _deepCopy(obj[keys[j]]);
  }
  return copy;
}

function _registerSubScene(name, subDef) {
  if (!subDef || !subDef.render) {
    console.error(`defineScene: sub-scene "${name}" must have a render function`);
    return;
  }
  SceneManager.register({
    name,
    mount: (container, params) => {
      if (params === undefined) params = {};
      return subDef.render(container, params);
    },
    unmount: () => {
      if (subDef.unmount) subDef.unmount();
    },
  });
}

export function defineScene(def, opts) {
  // Two-arg form: defineScene('name', { mount, unmount })
  // Used by qsr scenes — route directly to SceneManager.register.
  if (typeof def === 'string') {
    SceneManager.register(Object.assign({ name: def }, opts || {}));
    return;
  }
  if (!def || !def.name) {
    console.error('defineScene: scene must have a name');
    return;
  }
  if (!def.render) {
    console.error(`defineScene: "${def.name}" must have a render function`);
    return;
  }

  const defaultState = def.state ? _deepCopy(def.state) : {};
  let currentState = null;
  let boundEvents  = [];

  const scene = {
    name: def.name,
    mount: (container, params) => {
      if (params === undefined) params = {};
      currentState = _deepCopy(defaultState);

      if (def.events) {
        const evKeys = Object.keys(def.events);
        for (let i = 0; i < evKeys.length; i++) {
          const evName  = evKeys[i];
          const handler = def.events[evName];
          SceneManager.on(evName, handler);
          boundEvents.push({ event: evName, handler });
        }
      }

      return def.render(container, params, currentState);
    },
    unmount: () => {
      for (let i = 0; i < boundEvents.length; i++) {
        SceneManager.off(boundEvents[i].event, boundEvents[i].handler);
      }
      boundEvents = [];
      if (def.unmount) def.unmount(currentState);
      currentState = null;
    },
  };

  SceneManager.register(scene);

  if (def.interrupts) {
    const intKeys = Object.keys(def.interrupts);
    for (let j = 0; j < intKeys.length; j++) {
      _registerSubScene(intKeys[j], def.interrupts[intKeys[j]]);
    }
  }
  if (def.transactionals) {
    const trKeys = Object.keys(def.transactionals);
    for (let k = 0; k < trKeys.length; k++) {
      _registerSubScene(trKeys[k], def.transactionals[trKeys[k]]);
    }
  }

  return scene;
}