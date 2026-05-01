// ═══════════════════════════════════════════════════
//  KINDpos Terminal — Theme Manager  (Vz2.0)
//  Terminal-specific chrome: pill buttons, float buttons, numpad,
//  PIN boxes. The shared design primitives (cards, wells, color
//  utilities, data-display helpers) live in common/theme.js and are
//  re-exported below so existing consumers keep working.
//  Nice. Dependable. Yours.
// ═══════════════════════════════════════════════════
//
//  tokens.js owns the raw values.
//  common/theme.js owns the shared construction primitives.
//  theme-manager.js owns POS-specific chrome.
//
//  Usage:
//    import { buildPillButton, buildNumKey, buildPinBox }
//      from './theme-manager.js';
//    // Or pull shared primitives through the re-export:
//    import { buildCard, hexToRgba } from './theme-manager.js';
//    // New code should prefer ../common/theme.js directly.
//
//  Rules:
//   1. Always call builders — never write inline styles in scenes.
//   2. Always pass colors from T — never hardcode hex in scenes.
//   3. buildCard() returns { wrap, card } — append wrap to DOM.
// ═══════════════════════════════════════════════════

import { T, chamfer } from '../common/tokens.js';
export { T };

// ─── Shared primitives (source: common/theme.js) ───
// Kept as re-exports so terminal consumers that import from
// './theme-manager.js' keep working. New code should import directly
// from '../common/theme.js'.
export {
  lightenHex,
  darkenHex,
  hexToRgba,
  buildCard,
  buildStaticCard,
  buildNavCard,
  buildActionCard,
  buildWell,
  buildSectionLabel,
  buildHeroNumber,
  buildDataRow,
  buildDivider,
} from '../common/theme.js';

// Internal use: the numpad chassis builds on buildWell, the pill and
// float buttons use darkenHex/hexToRgba for their press shadows.
import { buildWell, darkenHex, hexToRgba } from '../common/theme.js';

  // ═══════════════════════════════════════════════════
  //  PILL BUTTON BUILDER
  //  All interactive action buttons.
  //
  //  opts:
  //    label, color, darkBg, onClick, disabled, fontSize, width, variant, shape
  // ═══════════════════════════════════════════════════

  export function buildPillButton(opts) {
    var o      = opts || {};
    var color  = o.color;
    var darkBg = o.darkBg;
    var shape  = o.shape || 'pill'; // 'pill' or 'chamfer'

  if (o.variant === 'verm') {
    color  = T.verm;
    darkBg = T.vermDk;
  } else if (o.variant === 'elec') {
    color  = T.elec;
    darkBg = T.elecDk;
  } else if (o.variant === 'goGreen') {
    color  = T.greenWarm;
    darkBg = T.greenWarmDk;
  } else if (o.variant === 'mint') {
    color  = T.green;
    darkBg = T.greenDk;
  } else if (o.variant === 'ghost') {
    color  = 'transparent';
    darkBg = 'rgba(255,255,255,0.1)';
  } else if (!color) {
    color  = T.green;
    darkBg = T.greenDk;
  }
  if (!darkBg) darkBg = darkenHex(color, 0.2);

  var textColor = o.textColor
    || (o.variant === 'ghost' ? T.text
      : (color === T.verm || color === T.vermDk || o.variant === 'verm') ? '#fff'
      : T.well);

  var btn = document.createElement('button');
  btn.style.background    = color;
  btn.style.border        = o.variant === 'ghost' ? '1px solid ' + T.border : 'none';
  if (shape === 'chamfer') {
    btn.style.borderRadius = '0';
    btn.style.clipPath     = chamfer(o.chamferSize || 6);
  } else {
    btn.style.borderRadius = o.borderRadius || T.pillRadius;
  }
  btn.style.cursor        = 'pointer';
  btn.style.padding       = o.padding || '14px 32px';
  btn.style.fontFamily    = T.fh;
  btn.style.fontSize      = o.fontSize || T.fsB2;
  btn.style.fontWeight    = T.fwBold;
  btn.style.color         = textColor;
  btn.style.letterSpacing = '0.08em';
  btn.style.textTransform = 'uppercase';
  btn.style.boxShadow     = o.variant === 'ghost' ? 'none' : '0 6px 0 ' + darkBg;
  btn.style.transition    = T.transitionFast;
  btn.style.outline       = 'none';
  btn.style.whiteSpace    = 'nowrap';
  btn.style.userSelect    = 'none';
  btn.style.pointerEvents = 'auto';
  btn.style.touchAction   = 'manipulation';
  btn.style.zIndex        = '10';
  if (o.width) btn.style.width = o.width;
  if (o.label) btn.textContent = o.label;

  btn.addEventListener('pointerdown', function() {
    if (btn._disabled) return;
    btn.style.background = darkBg;
    btn.style.color      = o.variant === 'ghost' ? T.text : T.well;
    btn.style.boxShadow  = 'none';
    // Preserve existing transform (e.g. translateX(-50%) for centered buttons)
    const current = btn.style.transform || '';
    if (!current.includes('translateY(1px)')) {
      btn.style.transform = (current + ' translateY(1px)').trim();
    }
  });
  var _rel = function() {
    if (btn._disabled) return;
    btn.style.background = color;
    btn.style.color      = textColor;
    btn.style.boxShadow  = o.variant === 'ghost' ? 'none' : '0 6px 0 ' + darkBg;
    // Restore original transform by removing only the offset
    if (btn.style.transform) {
      btn.style.transform = btn.style.transform.replace('translateY(1px)', '').trim();
    }
  };
  btn.addEventListener('pointerup',     _rel);
  btn.addEventListener('pointerleave',  _rel);
  btn.addEventListener('pointercancel', _rel);
  if (o.onClick) {
    btn.addEventListener('pointerup', function(e) {
      if (btn._disabled) return;
      o.onClick(e);
    });
  }

  btn.setColor = function(newColor, newDark, newText) {
    color  = newColor;
    darkBg = newDark;
    textColor = newText || (color === T.verm ? '#fff' : T.well);
    btn.style.background = color;
    btn.style.color      = textColor;
    btn.style.boxShadow  = '0 6px 0 ' + darkBg;
  };

  btn._disabled = false;
  btn.setDisabled = function(d) {
    btn._disabled       = d;
    btn.style.opacity   = d ? '0.4'  : '1';
    btn.style.pointerEvents = d ? 'none' : 'auto';
    btn.style.cursor    = d ? 'not-allowed' : 'pointer';
  };
  if (o.disabled) btn.setDisabled(true);

  return btn;
}

// ═══════════════════════════════════════════════════
//  FLOAT BUTTON BUILDER
//  Straddles card border (OPEN/CLOSED toggle, CHECKOUT).
//  Caller positions it absolute on the outer wrap.
// ═══════════════════════════════════════════════════

export function buildFloatButton(opts) {
  var o      = opts || {};
  var color  = o.color;
  var darkBg = o.darkBg;

  if (o.variant === 'elec') {
    color  = T.elec;
    darkBg = T.elecDk;
  } else if (o.variant === 'verm') {
    color  = T.verm;
    darkBg = T.vermDk;
  } else if (!color) {
    color  = T.green;
    darkBg = T.greenDk;
  }
  if (!darkBg) darkBg = darkenHex(color, 0.2);

  var btn = document.createElement('button');
  btn.style.background    = color;
  btn.style.border        = 'none';
  btn.style.borderRadius  = T.pillRadius;
  btn.style.cursor        = 'pointer';
  btn.style.padding       = '14px 40px';
  btn.style.fontFamily    = T.fh;
  btn.style.fontSize      = T.fsB2;
  btn.style.fontWeight    = T.fwBold;
  var textColor = (color === T.verm) ? '#fff' : T.well;
  btn.style.color         = textColor;
  btn.style.letterSpacing = '0.12em';
  btn.style.textTransform = 'uppercase';
  btn.style.boxShadow     = '0 6px 0 ' + darkBg + ', 0 0 14px ' + hexToRgba(color, 0.3);
  btn.style.transition    = T.transitionFast;
  btn.style.outline       = 'none';
  btn.style.position      = 'relative';
  btn.style.zIndex        = '10';
  btn.style.userSelect    = 'none';
  btn.style.pointerEvents = 'auto';
  btn.style.touchAction   = 'manipulation';
  if (o.label) btn.textContent = o.label;

  btn.addEventListener('pointerdown', function() {
    btn.style.background = darkBg;
    btn.style.color      = color;
    btn.style.boxShadow  = 'none';
    // Preserve existing transform
    const current = btn.style.transform || '';
    if (!current.includes('translateY(1px)')) {
      btn.style.transform = (current + ' translateY(1px)').trim();
    }
  });
  var _rel = function() {
    btn.style.background = color;
    btn.style.color      = textColor;
    btn.style.boxShadow  = '0 6px 0 ' + darkBg + ', 0 0 14px ' + hexToRgba(color, 0.3);
    // Restore original transform
    if (btn.style.transform) {
      btn.style.transform = btn.style.transform.replace('translateY(1px)', '').trim();
    }
  };
  btn.addEventListener('pointerup',     _rel);
  btn.addEventListener('pointerleave',  _rel);
  btn.addEventListener('pointercancel', _rel);
  if (o.onClick) btn.addEventListener('pointerup', o.onClick);

  // Color swap — for cycling OPEN → CLOSED → VOID
  btn.setColor = function(newColor, newDark) {
    color  = newColor;
    darkBg = newDark;
    btn.style.background = color;
    btn.style.boxShadow  = '0 6px 0 ' + darkBg + ', 0 0 14px ' + hexToRgba(color, 0.3);
  };

  return btn;
}

// ═══════════════════════════════════════════════════
//  NUMPAD KEY BUILDER
//  Chamfer + filled color + dark text.
//  The original KINDpos numpad identity — preserved.
//
//  opts:
//    label, type ('digit'|'clr'|'ent'), onClick, height, width
// ═══════════════════════════════════════════════════

export function buildNumKey(opts) {
  var o    = typeof opts === 'string' ? { label: opts } : (opts || {});
  var type = o.type || 'digit';

  // Text color per key type — dark background, colored label
  var textColors = {
    digit: T.green,
    clr:   T.verm,
    ent:   T.greenWarm,
  };
  var textColor = o.color || textColors[type] || T.green;

  // Embossed shadow — raised 3D lift, same treatment as original
  var shadowRaised = [
    'inset 0 3px 0 rgba(255,255,255,0.10)',
    'inset 0 -3px 0 rgba(0,0,0,0.55)',
    'inset 0 6px 12px rgba(0,0,0,0.35)',
    '0 4px 10px rgba(0,0,0,0.5)',
    '0 0 0 1px rgba(0,0,0,0.3)',
  ].join(',');

  var shadowPressed = [
    'inset 0 2px 0 rgba(255,255,255,0.06)',
    'inset 0 -2px 0 rgba(0,0,0,0.55)',
    'inset 0 10px 20px rgba(0,0,0,0.50)',
    '0 1px 4px rgba(0,0,0,0.4)',
    '0 0 0 1px rgba(0,0,0,0.3)',
  ].join(',');

  var btn = document.createElement('button');
  btn.style.background    = T.well;       // dark key face
  btn.style.border        = 'none';
  btn.style.clipPath      = chamfer(T.chamferKey);
  btn.style.cursor        = 'pointer';
  btn.style.height        = o.height || '112px';
  btn.style.width         = o.width  || '100%';
  btn.style.fontFamily    = T.fh;
  btn.style.fontSize      = type === 'digit' ? '44px' : '26px';
  btn.style.fontWeight    = T.fwBold;
  btn.style.color         = textColor;    // colored label
  btn.style.letterSpacing = type === 'digit' ? '0.02em' : '0.08em';
  btn.style.textShadow    = '0 0 12px ' + textColor;
  btn.style.boxShadow     = shadowRaised;
  btn.style.transition    = T.transitionFast;
  btn.style.outline       = 'none';
  btn.style.userSelect    = 'none';
  btn.style.boxSizing     = 'border-box';
  btn.style.pointerEvents = 'auto';
  btn.style.touchAction   = 'manipulation';
  if (o.label) btn.textContent = o.label;

  btn.addEventListener('pointerdown', function() {
    btn.style.boxShadow = shadowPressed;
    // Preserve existing transform
    const current = btn.style.transform || '';
    if (!current.includes('translateY(3px)')) {
      btn.style.transform = (current + ' translateY(3px)').trim();
    }
  });
  var _rel = function() {
    btn.style.boxShadow = shadowRaised;
    // Restore original transform
    if (btn.style.transform) {
      btn.style.transform = btn.style.transform.replace('translateY(3px)', '').trim();
    }
  };
  btn.addEventListener('pointerup',     _rel);
  btn.addEventListener('pointerleave',  _rel);
  btn.addEventListener('pointercancel', _rel);
  if (o.onClick) btn.addEventListener('pointerup', o.onClick);

  return btn;
}

// ═══════════════════════════════════════════════════
//  NUMPAD CHASSIS BUILDER
//  Full numpad: well container + 4×3 key grid.
//  opts.onKey(label) called on each keypress.
//  Returns the chassis element.
// ═══════════════════════════════════════════════════

export function buildNumpadChassis(opts) {
  var o     = opts || {};
  var onKey = o.onKey || function() {};

  var chassis = buildWell({ padding: '10px' });
  chassis.style.display       = 'flex';
  chassis.style.flexDirection = 'column';
  chassis.style.gap           = '12px';

  var rows = [
    [{ label: '1', type: 'digit' }, { label: '2', type: 'digit' }, { label: '3', type: 'digit' }],
    [{ label: '4', type: 'digit' }, { label: '5', type: 'digit' }, { label: '6', type: 'digit' }],
    [{ label: '7', type: 'digit' }, { label: '8', type: 'digit' }, { label: '9', type: 'digit' }],
    [{ label: 'CLR', type: 'clr' }, { label: '0',   type: 'digit' }, { label: 'ENT', type: 'ent' }],
  ];

  rows.forEach(function(row) {
    var rowEl = document.createElement('div');
    rowEl.style.display             = 'grid';
    rowEl.style.gridTemplateColumns = 'repeat(3, 1fr)';
    rowEl.style.gap                 = '12px';
    row.forEach(function(k) {
      rowEl.appendChild(buildNumKey({
        label: k.label, type: k.type,
        onClick: (function(lbl) { return function() { onKey(lbl); }; })(k.label),
      }));
    });
    chassis.appendChild(rowEl);
  });

  return chassis;
}

// ═══════════════════════════════════════════════════
//  PIN BOX BUILDER
//  Returns { box, setFilled(bool) }
// ═══════════════════════════════════════════════════

export function buildPinBox() {
  var box = document.createElement('div');
  box.style.width          = '88px';
  box.style.height         = '88px';
  box.style.clipPath       = chamfer(T.chamferPin);
  box.style.background     = T.well;
  box.style.border         = '1.5px solid ' + T.border;
  box.style.display        = 'flex';
  box.style.alignItems     = 'center';
  box.style.justifyContent = 'center';
  box.style.boxSizing      = 'border-box';
  box.style.transition     = T.transitionMed;
  box.style.flexShrink     = '0';

  var pip = document.createElement('div');
  pip.style.width      = '20px';
  pip.style.height     = '20px';
  pip.style.clipPath   = chamfer(2);
  pip.style.background = T.green;
  pip.style.boxShadow  = '0 0 8px ' + T.green;
  pip.style.display    = 'none';
  box.appendChild(pip);

  box.setFilled = function(filled) {
    if (filled) {
      box.style.background = hexToRgba(T.green, 0.12);
      box.style.border     = '1.5px solid ' + T.green;
      box.style.boxShadow  = '0 0 12px ' + hexToRgba(T.green, 0.35);
      pip.style.display    = 'block';
    } else {
      box.style.background = T.well;
      box.style.border     = '1.5px solid ' + T.border;
      box.style.boxShadow  = 'none';
      pip.style.display    = 'none';
    }
  };

  return { box: box, pip: pip };
}

// ═══════════════════════════════════════════════════
//  PIN ROW BUILDER
//  4 boxes in a row. Returns { row, setCount(n) }
// ═══════════════════════════════════════════════════

export function buildPinRow() {
  var row = document.createElement('div');
  row.style.display        = 'flex';
  row.style.gap            = '20px';
  row.style.justifyContent = 'center';

  var boxes = [buildPinBox(), buildPinBox(), buildPinBox(), buildPinBox()];
  boxes.forEach(function(b) { row.appendChild(b.box); });

  return {
    row: row,
    boxes: boxes,
    setCount: function(n) {
      boxes.forEach(function(b, i) { b.box.setFilled(i < n); });
    },
  };
}
