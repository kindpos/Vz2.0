// ═══════════════════════════════════════════════════
//  KINDpos Terminal — Pizza Builder Overlay
//  Interrupt overlay for building a pizza from scratch
//  Size → Specials / Prep / Toppings + Half placement
//  Nice. Dependable. Yours.
// ═══════════════════════════════════════════════════

import { T } from '../common/tokens.js';
import { buildPillButton, hexToRgba, darkenHex } from './theme-manager.js';
import { SceneManager } from './scene-manager.js';
import { PREFIXES as UNI_PREFIXES } from './menu-data/universal-modifiers.js';

// ── HexNav stub (the hex-engine module was purged on 2026-03-31) ─────
// This keeps pizza-builder-overlay.js loadable; users attempting to
// open the pizza builder will see a toast instead of a hard crash.
// When HexNav is restored (or replaced), swap this stub for a real
// import at the top of the file.
function HexNav(host, _opts) {
  var msg = document.createElement('div');
  msg.style.cssText = [
    'position:absolute;inset:0;',
    'display:flex;align-items:center;justify-content:center;',
    'padding:24px;text-align:center;',
    'font-family:' + T.fb + ';',
    'font-size:' + T.fsB2 + ';',
    'color:' + T.gold + ';',
    'opacity:0.85;',
  ].join('');
  msg.textContent = 'Pizza Builder unavailable — HexNav not installed.';
  host.appendChild(msg);
  this._msg = msg;
}
HexNav.prototype.destroy = function() {
  if (this._msg && this._msg.parentNode) this._msg.parentNode.removeChild(this._msg);
};

// ── Pizza builder HexNav categories ──────────────
var PIZZA_BUILDER_DATA = [];

// ── Prefix definitions (mirrors order-entry) ─────
var PREFIXES = [
  { id: 'add',     label: 'Add',     color: T.greenWarm,  textColor: '#1a2a1a' },
  { id: 'no',      label: 'No',      color: T.verm,      textColor: '#fff'    },
  { id: 'on-side', label: 'On Side', color: T.gold,     textColor: '#1a1000' },
  { id: 'extra',   label: 'Extra',   color: T.elec,     textColor: '#001a1a' },
  { id: 'sub',     label: 'Sub',     color: T.lavender, textColor: '#1a0030' },
];


/**
 * Show the pizza builder overlay.
 *
 * @param {object}      sizeItem     — the size item from MENU_DATA (label, price)
 * @param {Array|null}  builderData  — dynamic HexNav data from API, or null for fallback
 * @returns {Promise<{name, unitPrice, mods[], category}>}  the built pizza
 */
export function showPizzaBuilderOverlay(sizeItem, builderData) {
  var data = (builderData && builderData.length > 0) ? builderData : PIZZA_BUILDER_DATA;
  return new Promise(function(resolve, reject) {
    SceneManager.interrupt('pizza-builder', {
      onConfirm: function(result) { resolve(result); },
      onCancel: function() { reject(new Error('Interrupt cancelled')); },
      params: { sizeItem: sizeItem, builderData: data },
    });
  });
}

SceneManager.register({
  name: 'pizza-builder',
  mount: function(container, params) {
    _buildOverlay(container, params.sizeItem, params.builderData, params.onConfirm, params.onCancel);
  },
  unmount: function() {},
});

function _buildOverlay(el, sizeItem, builderData, onConfirm, onCancel) {
  // ── State ──
  var activePrefix = 'add';
  var activePlacement = 'whole';
  var appliedMods = []; // [{ prefixLabel, modLabel, placement, price }]
  var builderNav = null;

  var panel = document.createElement('div');
  panel.style.cssText = [
    'width:98%;max-width:1100px;height:95%;',
    'background:' + T.bg + ';',
    'border-left:8px solid ' + T.catColor('PIZZA') + ';',
    'border-radius:' + T.chamferCard + 'px;',
    'box-shadow:0 12px 48px rgba(0,0,0,0.6);',
    'display:flex;flex-direction:column;',
    'font-family:' + T.fb + ';',
    'overflow:hidden;',
  ].join('');

  // ═══ PREFIX + PLACEMENT — built here, appended to bottom bar later ═══
  var prefixBtns = {};

  function refreshPrefixes() {
    PREFIXES.forEach(function(p) {
      var btn = prefixBtns[p.id];
      var isActive = activePrefix === p.id;
      btn.style.background = isActive ? p.color : T.card;
      btn.style.color = isActive ? p.textColor : p.color;
    });
  }

  // ═══ MAIN BODY: HexNav (left) + Right panel (mods log + placement) ═══
  var body = document.createElement('div');
  body.style.cssText = 'flex:1;display:flex;overflow:hidden;min-height:0;';

  var hexArea = document.createElement('div');
  hexArea.style.cssText = 'flex:1;position:relative;overflow:hidden;';
  body.appendChild(hexArea);

  // ═══ RIGHT PANEL: Mods log only ═══
  var rightPanel = document.createElement('div');
  rightPanel.style.cssText = [
    'width:200px;flex-shrink:0;display:flex;flex-direction:column;',
    'background:' + T.well + ';',
    'border-left:2px solid ' + T.border + ';',
  ].join('');

  // Applied mods log
  var logWrap = document.createElement('div');
  logWrap.style.cssText = [
    'flex:1;overflow-y:auto;scrollbar-width:none;-ms-overflow-style:none;',
    'padding:6px 8px;',
    'background:' + T.well + ';border:1px solid ' + T.border + ';',
    'border-radius:6px;box-shadow:inset 0 2px 4px rgba(0,0,0,0.35);',
  ].join('');
  renderLog();
  rightPanel.appendChild(logWrap);

  var pizzaColor = T.catColor('PIZZA');
  var placeBtns = {};
  var placeSegments = [
    { id: '1st-half', label: '1st' },
    { id: 'whole',    label: 'Whole' },
    { id: '2nd-half', label: '2nd' },
  ];

  function refreshPlacement() {
    placeSegments.forEach(function(seg) {
      var btn = placeBtns[seg.id];
      var isActive = activePlacement === seg.id;
      btn.style.background = isActive ? pizzaColor : T.card;
      btn.style.color = isActive ? '#1a0a0a' : pizzaColor;
    });
  }

  body.appendChild(rightPanel);
  panel.appendChild(body);

  // ═══ BOTTOM AREA: prefix row + action row ═══
  var bottomArea = document.createElement('div');
  bottomArea.style.cssText = [
    'flex-shrink:0;background:' + T.well + ';',
    'border-top:2px solid ' + T.catColor('PIZZA') + ';',
    'display:flex;flex-direction:column;gap:2px;padding:2px 4px;',
  ].join('');

  // ── PREFIX ROW ──
  var prefixRow = document.createElement('div');
  prefixRow.style.cssText = 'display:flex;gap:4px;';
  PREFIXES.forEach(function(p) {
    var isActive = activePrefix === p.id;
    var btn = document.createElement('div');
    btn.style.cssText = [
      'flex:1;height:30px;display:flex;align-items:center;justify-content:center;',
      'font-family:' + T.fh + ';font-size:20px;cursor:pointer;',
      'background:' + (isActive ? p.color : T.card) + ';',
      'color:' + (isActive ? p.textColor : p.color) + ';',
      'border:2px solid ' + p.color + ';',
      'transition:background 80ms,color 80ms;',
    ].join('');
    btn.textContent = p.label;
    btn.addEventListener('pointerup', function(e) {
      e.stopPropagation();
      activePrefix = p.id;
      refreshPrefixes();
    });
    prefixBtns[p.id] = btn;
    prefixRow.appendChild(btn);
  });
  bottomArea.appendChild(prefixRow);

  // ── ACTION ROW ──
  var bottomBar = document.createElement('div');
  bottomBar.style.cssText = 'display:flex;gap:4px;';

  // CANCEL
  var cancelBtn = buildPillButton({
    label: 'CANCEL',
    color: T.card,
    darkBg: darkenHex(T.card, 0.4),
    textColor: T.green,
    fontSize: T.fsB3,
    onClick: function() {
      if (builderNav) builderNav.destroy();
      onCancel();
    },
  });
  cancelBtn.style.flex = '1';
  cancelBtn.style.height = '34px';
  cancelBtn.style.fontFamily = T.fb;
  bottomBar.appendChild(cancelBtn);

  // UNDO
  var undoBtn = buildPillButton({
    label: 'UNDO',
    color: T.card,
    darkBg: darkenHex(T.card, 0.4),
    textColor: T.verm,
    fontSize: T.fsB3,
    onClick: function() {
      if (appliedMods.length === 0) return;
      appliedMods.pop();
      renderLog();
    },
  });
  undoBtn.style.flex = '1';
  undoBtn.style.height = '34px';
  undoBtn.style.fontFamily = T.fb;
  bottomBar.appendChild(undoBtn);

  // ADD TO ORDER
  var addBtn = buildPillButton({
    label: 'ADD',
    color: T.card,
    darkBg: darkenHex(T.card, 0.4),
    textColor: T.green,
    fontSize: T.fsB3,
    onClick: function() {
      if (builderNav) builderNav.destroy();
      // Build the result
      var mods = appliedMods.map(function(m) {
        var modName = m.prefixLabel + ' ' + m.modLabel;
        var halfSide = null;
        if (m.placement === '1st-half') halfSide = 'Left';
        else if (m.placement === '2nd-half') halfSide = 'Right';
        return {
          name: modName,
          price: m.price || 0,
          charged: (m.price || 0) > 0,
          prefix: halfSide,
        };
      });
      onConfirm({
        name: sizeItem.label,
        unitPrice: sizeItem.price,
        mods: mods,
        category: 'pizza',
      });
    },
  });
  addBtn.style.flex = '2';
  addBtn.style.height = '34px';
  bottomBar.appendChild(addBtn);

  // Placement bar (bottom-right)
  var placeBar = document.createElement('div');
  placeBar.style.cssText = 'display:flex;align-items:center;gap:0;flex:2;';

  placeSegments.forEach(function(seg, i) {
    if (i > 0) {
      var divider = document.createElement('div');
      divider.style.cssText = 'width:2px;height:28px;background:' + pizzaColor + ';flex-shrink:0;';
      placeBar.appendChild(divider);
    }
    var isActive = activePlacement === seg.id;
    var btn = document.createElement('div');
    btn.style.cssText = [
      'flex:1;height:34px;display:flex;align-items:center;justify-content:center;',
      'font-family:' + T.fh + ';font-size:20px;cursor:pointer;',
      'background:' + (isActive ? pizzaColor : T.card) + ';',
      'color:' + (isActive ? '#1a0a0a' : pizzaColor) + ';',
      'border-top:2px solid ' + pizzaColor + ';',
      'border-bottom:2px solid ' + pizzaColor + ';',
      'transition:background 80ms,color 80ms;',
    ].join('');
    if (i === 0) btn.style.borderLeft = '2px solid ' + pizzaColor;
    if (i === placeSegments.length - 1) btn.style.borderRight = '2px solid ' + pizzaColor;
    btn.textContent = seg.label;
    btn.addEventListener('pointerup', function(e) {
      e.stopPropagation();
      activePlacement = seg.id;
      refreshPlacement();
    });
    placeBtns[seg.id] = btn;
    placeBar.appendChild(btn);
  });
  bottomBar.appendChild(placeBar);

  bottomArea.appendChild(bottomBar);
  panel.appendChild(bottomArea);
  el.appendChild(panel);

  // ── Init HexNav after DOM layout ──
  requestAnimationFrame(function() {
    requestAnimationFrame(function() {
      builderNav = new HexNav(hexArea, {
        data: builderData,
        scale: 1.0,
        onSelect: function(item) {
          handleModSelect(item);
        },
      });
    });
  });

  // ── Mod selection handler ──
  function handleModSelect(item) {
    var prefix = PREFIXES.find(function(p) { return p.id === activePrefix; });
    if (!prefix) return;

    var price = item.price || 0;
    // Half toppings cost half price (if price exists)
    if (activePlacement !== 'whole' && price > 0) {
      price = Math.round(price * 50) / 100; // half price
    }

    appliedMods.push({
      prefixId: prefix.id,
      prefixLabel: prefix.label,
      modId: item.id || item.label,
      modLabel: item.label,
      placement: activePlacement,
      price: price,
    });
    renderLog();
  }

  // ── Log renderer ──
  function renderLog() {
    logWrap.innerHTML = '';
    if (appliedMods.length === 0) {
      var empty = document.createElement('div');
      empty.style.cssText = 'font-family:' + T.fb + ';font-size:26px;color:' + hexToRgba(T.text, 0.6) + ';text-align:center;padding:2px 0;';
      empty.textContent = 'Tap a topping or special to build your pizza';
      logWrap.appendChild(empty);
      return;
    }
    appliedMods.forEach(function(entry, idx) {
      var row = document.createElement('div');
      row.style.cssText = 'display:flex;justify-content:space-between;align-items:center;font-family:' + T.fb + ';font-size:26px;color:' + T.gold + ';line-height:1.2;cursor:pointer;';
      var placementTag = '';
      if (entry.placement === '1st-half') placementTag = ' [1st]';
      else if (entry.placement === '2nd-half') placementTag = ' [2nd]';
      var nameSpan = document.createElement('span');
      nameSpan.style.cssText = 'flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;';
      nameSpan.textContent = entry.prefixLabel + ' ' + entry.modLabel + placementTag;
      row.appendChild(nameSpan);
      if (entry.price > 0) {
        var priceSpan = document.createElement('span');
        priceSpan.style.cssText = 'flex-shrink:0;margin:0 4px;';
        priceSpan.textContent = '+$' + entry.price.toFixed(2);
        row.appendChild(priceSpan);
      }
      var removeSpan = document.createElement('span');
      removeSpan.textContent = '\u2715';
      removeSpan.style.cssText = 'color:' + T.verm + ';flex-shrink:0;font-size:24px;padding:0 2px;';
      row.appendChild(removeSpan);
      row.addEventListener('pointerup', (function(i) {
        return function() {
          appliedMods.splice(i, 1);
          renderLog();
        };
      })(idx));
      logWrap.appendChild(row);
    });

    // RESET button
    if (appliedMods.length > 1) {
      var resetRow = document.createElement('div');
      resetRow.style.cssText = 'margin-top:4px;padding:3px 0;text-align:center;font-family:' + T.fh + ';font-size:22px;color:' + T.verm + ';cursor:pointer;border:2px solid ' + T.verm + ';background:' + T.card + ';';
      resetRow.textContent = 'RESET ALL';
      resetRow.addEventListener('pointerup', function() {
        appliedMods.length = 0;
        renderLog();
      });
      logWrap.appendChild(resetRow);
    }
    logWrap.scrollTop = logWrap.scrollHeight;
  }
}