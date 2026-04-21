// ═══════════════════════════════════════════════════
//  KINDpos Terminal — Scene Manager v3
//  Layer Stack Architecture: Gate / Working / Transactional / Interrupt
//  Nice. Dependable. Yours.
// ═══════════════════════════════════════════════════

import { T, onThemeChange } from './tokens.js';

// ── Scene Registry ───────────────────────────────
const _scenes = {};

// ── Layer State ──────────────────────────────────
let _gateScene = null;          // { name, cleanup }
let _workingScene = null;       // { name, cleanup }
const _transactionalStack = []; // [{ name, cleanup, scrim, frame }]
let _interruptScene = null;     // { name, cleanup, scrim, onConfirm, onCancel }

// ── DOM Containers ───────────────────────────────
let _layerGate = null;
let _layerWorking = null;
let _layerTransactional = null;
let _layerSummary = null;
let _layerInterrupt = null;
let _headerBar = null;

// ── Event Bus ────────────────────────────────────
const _bus = {};

// ── Transition Hooks ─────────────────────────────
const _transitionHooks = [];

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

// ═══════════════════════════════════════════════════
//  INIT — Build Root Canvas
// ═══════════════════════════════════════════════════

function init(config) {
  // Overseer mode — accept pre-resolved layer elements directly
  if (config && config.layers) {
    _layerWorking       = config.layers.working       || null;
    _layerTransactional = config.layers.transactional || null;
    _layerInterrupt     = config.layers.interrupt     || null;
    _layerGate          = config.layers.gate          || null;
    _layerSummary       = config.layers.summary       || null;
    _headerBar          = config.layers.header        || null;
    return;
  }

  // Terminal mode — original init path
  var terminal = document.getElementById('terminal');
  if (!terminal) {
    console.error('SceneManager.init: #terminal not found');
    return;
  }

  // Grab existing header (already in DOM via index.html)
  _headerBar = document.getElementById('header');

  // Grab layer containers (already in DOM via index.html)
  _layerWorking = document.getElementById('layer-working');
  _layerTransactional = document.getElementById('layer-transactional');
  _layerSummary = document.getElementById('order-summary');
  _layerInterrupt = document.getElementById('layer-interrupt');
  _layerGate = document.getElementById('layer-gate');

  _applyLayerGeometry();

  // Re-apply geometry when theme changes
  onThemeChange(function() { _applyLayerGeometry(); });
}

var _summaryVisible = false;

function _applyLayerGeometry() {
  var hH = T.headerH + 'px';
  var bodyH = 'calc(100% - ' + hH + ')';
  var summaryW = T.pcLeftW;
  var sceneLeft = _summaryVisible ? (summaryW + T.colGapSm) + 'px' : '0';
  var sceneW = _summaryVisible ? 'calc(100% - ' + sceneLeft + ')' : '100%';

  // Summary panel — fixed left column
  if (_layerSummary) {
    _layerSummary.style.top = hH;
    _layerSummary.style.left = '0';
    _layerSummary.style.width = summaryW + 'px';
    _layerSummary.style.height = bodyH;
    _layerSummary.style.zIndex = T.zSummary;
  }

  // Scene layers — shifted right when summary visible, full width when hidden
  [_layerWorking, _layerTransactional, _layerInterrupt].forEach(function(el) {
    if (!el) return;
    el.style.top = hH;
    el.style.left = sceneLeft;
    el.style.width = sceneW;
    el.style.height = bodyH;
  });

  // Gate — always full width (covers summary too)
  if (_layerGate) {
    _layerGate.style.top = hH;
    _layerGate.style.left = '0';
    _layerGate.style.width = '100%';
    _layerGate.style.height = bodyH;
  }

  // Z-indexes
  if (_layerWorking)       _layerWorking.style.zIndex = T.zWorking;
  if (_layerTransactional) _layerTransactional.style.zIndex = T.zTransactional;
  if (_layerSummary)       _layerSummary.style.zIndex = T.zSummary;
  if (_layerInterrupt)     _layerInterrupt.style.zIndex = T.zInterrupt;
  if (_layerGate)          _layerGate.style.zIndex = T.zGate;
}

// ═══════════════════════════════════════════════════
//  GATE LAYER
// ═══════════════════════════════════════════════════

function openGate(sceneName) {
  var scene = _scenes[sceneName];
  if (!scene) return console.error('SceneManager.openGate: scene "' + sceneName + '" not registered');

  // Build scrim — full block
  var scrim = document.createElement('div');
  scrim.className = 'layer-scrim layer-scrim-gate';
  scrim.style.cssText = 'position:absolute;inset:0;background:' + T.scrimGate + ';';
  _layerGate.appendChild(scrim);

  // Build content container
  var container = document.createElement('div');
  container.className = 'layer-content';
  container.dataset.scene = sceneName;
  container.style.cssText = 'position:absolute;inset:0;';
  _layerGate.appendChild(container);

  // Make gate layer intercept all input
  _layerGate.style.pointerEvents = 'auto';

  // Mount scene
  var cleanup = scene.mount(container, {});
  _gateScene = { name: sceneName, cleanup: cleanup, scrim: scrim, container: container };
}

function closeGate(sceneName) {
  if (!_gateScene || _gateScene.name !== sceneName) return;

  var scene = _scenes[_gateScene.name];
  if (scene && scene.unmount) scene.unmount();
  if (typeof _gateScene.cleanup === 'function') _gateScene.cleanup();

  // Clear DOM
  _gateScene.container.remove();
  _gateScene.scrim.remove();

  // Restore gate layer to non-blocking
  _layerGate.style.pointerEvents = 'none';

  _gateScene = null;
  _emit('gate:closed');
}

// ═══════════════════════════════════════════════════
//  WORKING LAYER
// ═══════════════════════════════════════════════════

function mountWorking(sceneName, params) {
  if (params === undefined) params = {};

  var scene = _scenes[sceneName];
  if (!scene) return console.error('SceneManager.mountWorking: scene "' + sceneName + '" not registered');

  // Fire transition hooks
  _transitionHooks.forEach(function(fn) { fn(); });

  // Unmount existing working scene first
  if (_workingScene) {
    _unmountWorkingInternal();
  }

  // Clear any orphaned containers from async scenes
  if (_layerWorking) {
    while (_layerWorking.firstChild) _layerWorking.removeChild(_layerWorking.firstChild);
  }

  // Build content container
  var container = document.createElement('div');
  container.className = 'layer-content';
  container.dataset.scene = sceneName;
  container.style.cssText = 'position:absolute;inset:0;';
  _layerWorking.appendChild(container);

  // Mount scene
  var cleanup = scene.mount(container, params);
  _workingScene = { name: sceneName, cleanup: cleanup, container: container };

  _emit('working:mounted', { sceneName: sceneName });
}

function unmountWorking(sceneName) {
  if (!_workingScene || _workingScene.name !== sceneName) return;
  _unmountWorkingInternal();
  _emit('working:unmounted', { sceneName: sceneName });
}

function _unmountWorkingInternal() {
  if (!_workingScene) return;

  var scene = _scenes[_workingScene.name];
  if (scene && scene.unmount) scene.unmount();
  if (typeof _workingScene.cleanup === 'function') _workingScene.cleanup();

  _workingScene.container.remove();
  _workingScene = null;
}

// ═══════════════════════════════════════════════════
//  TRANSACTIONAL LAYER
// ═══════════════════════════════════════════════════

function openTransactional(sceneName, params) {
  if (params === undefined) params = {};

  var scene = _scenes[sceneName];
  if (!scene) return console.error('SceneManager.openTransactional: scene "' + sceneName + '" not registered');

  // Fire transition hooks
  _transitionHooks.forEach(function(fn) { fn(); });

  // Build scrim — 60% dim, bgDark
  var scrim = document.createElement('div');
  scrim.className = 'layer-scrim layer-scrim-transactional';
  scrim.style.cssText = 'position:absolute;inset:0;background:' + T.scrimWorking + ';';
  _layerTransactional.appendChild(scrim);

  // Build frame container with mint border
  var frame = document.createElement('div');
  frame.className = 'layer-frame layer-frame-transactional';
  frame.style.cssText = 'position:absolute;inset:0;border:2px solid ' + T.frameTransactional + ';';
  _layerTransactional.appendChild(frame);

  // Build content container inside frame
  var container = document.createElement('div');
  container.className = 'layer-content';
  container.dataset.scene = sceneName;
  container.style.cssText = 'width:100%;height:100%;position:relative;';
  frame.appendChild(container);

  // Make transactional layer intercept input
  _layerTransactional.style.pointerEvents = 'auto';

  // Apply enter animation
  frame.classList.add('layer-transactional-enter');
  requestAnimationFrame(function() {
    requestAnimationFrame(function() {
      frame.classList.remove('layer-transactional-enter');
    });
  });

  // Mount scene
  var cleanup = scene.mount(container, params);
  var entry = { name: sceneName, cleanup: cleanup, scrim: scrim, frame: frame, container: container };
  _transactionalStack.push(entry);

  _emit('transactional:opened', { sceneName: sceneName });
}

function closeTransactional(sceneName) {
  // Find the entry in the stack
  var idx = -1;
  for (var i = _transactionalStack.length - 1; i >= 0; i--) {
    if (_transactionalStack[i].name === sceneName) {
      idx = i;
      break;
    }
  }
  if (idx === -1) return;

  var entry = _transactionalStack[idx];

  // Unmount scene
  var scene = _scenes[entry.name];
  if (scene && scene.unmount) scene.unmount();
  if (typeof entry.cleanup === 'function') entry.cleanup();

  // Remove DOM
  entry.frame.remove();
  entry.scrim.remove();

  // Remove from stack
  _transactionalStack.splice(idx, 1);

  // If stack is empty, restore pointer events
  if (_transactionalStack.length === 0) {
    _layerTransactional.style.pointerEvents = 'none';
  }

  _emit('transactional:closed', { sceneName: sceneName });
}

function closeAllTransactional() {
  // Close from top to bottom
  while (_transactionalStack.length > 0) {
    var entry = _transactionalStack.pop();
    var scene = _scenes[entry.name];
    if (scene && scene.unmount) scene.unmount();
    if (typeof entry.cleanup === 'function') entry.cleanup();
    entry.frame.remove();
    entry.scrim.remove();
  }

  _layerTransactional.style.pointerEvents = 'none';
}

// ═══════════════════════════════════════════════════
//  INTERRUPT LAYER
// ═══════════════════════════════════════════════════

function interruptFn(sceneName, opts) {
  if (!opts) opts = {};
  if (_interruptScene) {
    console.warn('SceneManager.interrupt: interrupt already active, ignoring');
    return;
  }

  var scene = _scenes[sceneName];
  if (!scene) return console.error('SceneManager.interrupt: scene "' + sceneName + '" not registered');

  var onConfirm = opts.onConfirm || null;
  var onCancel = opts.onCancel || null;
  var params = opts.params || {};

  // Build scrim — 85% dim over everything
  var scrim = document.createElement('div');
  scrim.className = 'layer-scrim layer-scrim-interrupt';
  scrim.style.cssText = 'position:absolute;inset:0;background:' + T.scrimInterrupt + ';';
  _layerInterrupt.appendChild(scrim);

  // Build frame container
  var frame = document.createElement('div');
  frame.className = 'layer-frame layer-frame-interrupt';
  frame.style.cssText = 'position:absolute;inset:0;display:flex;align-items:center;justify-content:center;border:3px solid #fbb03b;';
  _layerInterrupt.appendChild(frame);

  // Build content container
  var container = document.createElement('div');
  container.className = 'layer-content';
  container.dataset.scene = sceneName;
  frame.appendChild(container);

  // Make interrupt layer block all input
  _layerInterrupt.style.pointerEvents = 'auto';

  // Apply enter animation
  frame.classList.add('layer-interrupt-enter');
  requestAnimationFrame(function() {
    requestAnimationFrame(function() {
      frame.classList.remove('layer-interrupt-enter');
    });
  });

  // Wrap callbacks to auto-resolve interrupt
  var wrappedConfirm = function(value) {
    resolveInterrupt(sceneName);
    if (onConfirm) onConfirm(value);
  };
  var wrappedCancel = function() {
    resolveInterrupt(sceneName);
    if (onCancel) onCancel();
  };

  // Mount scene — pass onConfirm/onCancel as params
  var mountParams = {};
  var keys = Object.keys(params);
  for (var i = 0; i < keys.length; i++) {
    mountParams[keys[i]] = params[keys[i]];
  }
  mountParams.onConfirm = wrappedConfirm;
  mountParams.onCancel = wrappedCancel;

  var cleanup = scene.mount(container, mountParams);
  _interruptScene = {
    name: sceneName,
    cleanup: cleanup,
    scrim: scrim,
    frame: frame,
    container: container,
  };

  _emit('interrupt:opened', { sceneName: sceneName });
}

function resolveInterrupt(sceneName) {
  if (!_interruptScene) return;
  if (sceneName && _interruptScene.name !== sceneName) return;

  var scene = _scenes[_interruptScene.name];
  var name = _interruptScene.name;
  if (scene && scene.unmount) scene.unmount();
  if (typeof _interruptScene.cleanup === 'function') _interruptScene.cleanup();

  _interruptScene.frame.remove();
  _interruptScene.scrim.remove();

  _layerInterrupt.style.pointerEvents = 'none';
  _interruptScene = null;

  _emit('interrupt:resolved', { sceneName: name });
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
  _bus[event] = _bus[event].filter(function(h) { return h !== handler; });
}

function _emit(event, data) {
  if (!_bus[event]) return;
  var handlers = _bus[event].slice();
  for (var i = 0; i < handlers.length; i++) {
    try { handlers[i](data); } catch (e) { console.error('Event handler error:', event, e); }
  }
}

// Public emit for scene-to-scene communication
function emit(event, data) {
  _emit(event, data);
}

// ═══════════════════════════════════════════════════
//  SUMMARY LAYER
// ═══════════════════════════════════════════════════

function showSummary() {
  if (!_layerSummary) return;
  _summaryVisible = true;
  _layerSummary.style.display = 'flex';
  _applyLayerGeometry();
  _emit('summary:shown');
}

function hideSummary() {
  if (!_layerSummary) return;
  _summaryVisible = false;
  _layerSummary.style.display = 'none';
  _applyLayerGeometry();
  _emit('summary:hidden');
}

function getSummaryLayer() {
  return _layerSummary;
}

// ═══════════════════════════════════════════════════
//  GETTERS
// ═══════════════════════════════════════════════════

function getActiveWorking() {
  return _workingScene ? _workingScene.name : null;
}

function getTransactionalStack() {
  return _transactionalStack.map(function(e) { return e.name; });
}

function hasInterrupt() {
  return _interruptScene !== null;
}

// ═══════════════════════════════════════════════════
//  TRANSITION HOOKS (backward compat — keyboard etc.)
// ═══════════════════════════════════════════════════

function onBeforeTransition(fn) {
  _transitionHooks.push(fn);
}

// ═══════════════════════════════════════════════════
//  PUBLIC API
// ═══════════════════════════════════════════════════

export const SceneManager = {
  register:              register,
  init:                  init,

  // Gate
  openGate:              openGate,
  closeGate:             closeGate,

  // Working
  mountWorking:          mountWorking,
  unmountWorking:        unmountWorking,

  // Transactional
  openTransactional:     openTransactional,
  closeTransactional:    closeTransactional,
  closeAllTransactional: closeAllTransactional,

  // Interrupt
  interrupt:             interruptFn,
  resolveInterrupt:      resolveInterrupt,

  // Summary
  showSummary:           showSummary,
  hideSummary:           hideSummary,
  getSummaryLayer:       getSummaryLayer,

  // Event bus
  on:                    on,
  off:                   off,
  emit:                  emit,

  // Getters
  getActiveWorking:      getActiveWorking,
  getTransactionalStack: getTransactionalStack,
  hasInterrupt:          hasInterrupt,

  // Hooks
  onBeforeTransition:    onBeforeTransition,
};

// ═══════════════════════════════════════════════════
//  defineScene — SM2 higher-level API
//  Compact scene format with auto-managed state and event cleanup
// ═══════════════════════════════════════════════════

function _deepCopy(obj) {
  if (obj === null || typeof obj !== 'object') return obj;
  if (Array.isArray(obj)) {
    var arr = [];
    for (var i = 0; i < obj.length; i++) arr.push(_deepCopy(obj[i]));
    return arr;
  }
  var copy = {};
  var keys = Object.keys(obj);
  for (var j = 0; j < keys.length; j++) {
    copy[keys[j]] = _deepCopy(obj[keys[j]]);
  }
  return copy;
}

function _registerSubScene(name, subDef) {
  if (!subDef || !subDef.render) {
    console.error('defineScene: sub-scene "' + name + '" must have a render function');
    return;
  }
  SceneManager.register({
    name: name,
    mount: function(container, params) {
      if (params === undefined) params = {};
      return subDef.render(container, params);
    },
    unmount: function() {
      if (subDef.unmount) subDef.unmount();
    },
  });
}

export function defineScene(def) {
  if (!def || !def.name) {
    console.error('defineScene: scene must have a name');
    return;
  }
  if (!def.render) {
    console.error('defineScene: scene "' + def.name + '" must have a render function');
    return;
  }

  var defaultState = def.state ? _deepCopy(def.state) : {};
  var currentState = null;
  var boundEvents = [];

  var scene = {
    name: def.name,
    mount: function(container, params) {
      if (params === undefined) params = {};
      currentState = _deepCopy(defaultState);
      if (def.events) {
        var eventKeys = Object.keys(def.events);
        for (var i = 0; i < eventKeys.length; i++) {
          var evName = eventKeys[i];
          var handler = def.events[evName];
          SceneManager.on(evName, handler);
          boundEvents.push({ event: evName, handler: handler });
        }
      }
      return def.render(container, params, currentState);
    },
    unmount: function() {
      for (var i = 0; i < boundEvents.length; i++) {
        SceneManager.off(boundEvents[i].event, boundEvents[i].handler);
      }
      boundEvents = [];
      if (def.unmount) def.unmount(currentState);
      currentState = null;
    },
  };

  SceneManager.register(scene);

  if (def.interrupts) {
    var intKeys = Object.keys(def.interrupts);
    for (var j = 0; j < intKeys.length; j++) {
      _registerSubScene(intKeys[j], def.interrupts[intKeys[j]]);
    }
  }
  if (def.transactionals) {
    var trKeys = Object.keys(def.transactionals);
    for (var k = 0; k < trKeys.length; k++) {
      _registerSubScene(trKeys[k], def.transactionals[trKeys[k]]);
    }
  }

  return scene;
}
