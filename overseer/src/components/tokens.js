// ═══════════════════════════════════════════════════
//  KINDpos Terminal — Design Tokens
//  Single source of truth for all visual values
//  Nice. Dependable. Yours.
// ═══════════════════════════════════════════════════

export const T = {
  bg:       '#333333',
  bgDark:   '#1a1a1a',
  bgLight:  '#5a5a5a',
  bgEdge:   '#151515',
  bg2:      '#222222',
  bg3:      '#2a2a2a',
  bg4:      '#2e2e2e',
  bg5:      '#262626',
  border:   '#444444',
  dimText:  '#555555',
  mutedText:'#888888',
  subtleText:'#999999',
  darkBtn:  '#3a3632',
  darkBtnL: '#564f48',
  darkBtnD: '#1e1b18',
  mint:     '#C6FFBB',
  mintEdgeL:'#e5ffe0',
  mintEdgeD:'#5a7a52',
  goGreen:  '#7ac943',
  greenL:   '#ade87a',
  greenD:   '#345a1c',
  red:      '#da331c',
  redL:     '#f26858',
  redD:     '#5e160c',
  gold:     '#fcbe40',
  goldL:    '#fdd67a',
  goldD:    '#7a5a18',
  cyan:     '#33ffff',
  cyanL:    '#88ffff',
  cyanD:    '#197a7a',
  lavender: '#b48efa',
  lavenderL:'#d0b8ff',
  lavenderD:'#5a3f7a',
  grayBtn:  '#aaaaaa',
  grayBtnL: '#cccccc',
  grayBtnD: '#555555',
  yellow:   '#ffff00',
  mintB:    '#7bed9f',
  redB:     '#ff4757',
  catProteins:  '#ff4757',
  catProteinsL: '#ff7a87',
  catProteinsD: '#7a1f28',
  catVegetables:'#C6FFBB',   // alias T.mint
  catBeverages: '#70a1ff',
  catBeveragesL:'#a0c4ff',
  catBeveragesD:'#354d7a',
  catSauces:    '#ffa502',
  catSaucesL:   '#ffc04d',
  catSaucesD:   '#7a5001',
  catDesserts:  '#b48efa',   // alias T.lavender
  catStarches:  '#7bed9f',
  catStarchesL: '#aff4c4',
  catStarchesD: '#3a7a4d',
  // Vz1.2 login/numpad tokens
  numpadChassis: '#87f79c',
  numpadChassisL:'#b8ffd0',
  numpadChassisD:'#2e8040',
  pinFieldBg:'#1a1a1a',
  pinDot:    '#fbb03b',
  digitColor:'#fbb03b',
  clrColor:  '#ff4422',
  submitColor:'#39b54a',
  sage:      '#6bc987',
  lime:      '#ccff33',
  electricPink:'#ff66cc',
  vermillion:'#ff4422',
  fh:   'Chakra Petch, sans-serif',
  fhr:  'Chakra Petch, sans-serif',
  fb:   'B612 Mono, monospace',
  fsQuick:  '70px',
  fsMgmt:   '60px',
  fsNumpad: '100px',
  fsHeader: '70px',
  fsClr:    '70px',
  fsSmall:  '25px',
  fsItem:   '35px',
  fsMod:    '35px',
  fsBtn:    '35px',
  fsBtnSm:  '30px',
  fsDenom:  '42px',
  fsMed:    '40px',
  fsCon:    '20px',
  fsConSm:  '18px',
  appW:     1024,
  appH:     600,
  headerH:  52,
  scenePad: 20,
  colGap:   20,
  colGapSm: 12,
  pcLeftW:  320,

  // Chart viewBox dimensions (internal coordinate space — SVG renders at width:100%)
  chartVB:       '500 240',   // standard panel chart (category bars, breakdowns)
  chartVBSm:     '500 200',   // short panel chart (trend lines)
  chartVBFull:   '900 380',   // expanded / drill-down chart
  chartW:        500,          // viewBox width (standard)
  chartH:        240,          // viewBox height (standard)
  chartHSm:      200,          // viewBox height (short)
  chartFullW:    900,          // viewBox width (expanded)
  chartFullH:    380,          // viewBox height (expanded)
  chartDonut:    160,          // donut diameter (square viewBox)
  chartPt:       8,            // data point marker size
  chartLblW:     70,           // axis label area (left pad)
  chartPadR:     8,            // right padding
  chartPadT:     10,           // top padding
  chartPadB:     32,           // bottom padding (axis labels)

  bevel:    7,
  bevelBtn: 4,
  chamfer:  8,
  shadowX:  3,
  shadowY:  4,

  // Scrim opacities
  scrimWorking:     'rgba(26, 26, 26, 0.60)',
  scrimInterrupt:   'rgba(26, 26, 26, 0.85)',
  scrimGate:        'rgba(26, 26, 26, 1.00)',

  // Layer z-indexes
  zWorking:         10,
  zTransactional:   20,
  zSummary:         25,
  zInterrupt:       30,
  zGate:            100,

  // Overlay frame colors
  frameTransactional:      '#C6FFBB',  // mint
  frameInterruptDecision:  '#fcbe40',  // gold
  frameInterruptCritical:  '#da331c',  // red
};

// Default palette: Terminal Glow
// This will become operator-configurable via Overseer settings
T.categoryPalette = {
  'PIZZA':  '#ff4757',
  'APPS':   '#ffd93d',
  'SUBS':   '#C6FFBB',
  'SIDES':  '#70a1ff',
  'DRINKS': '#ffa502',
};

T.catColor = (category) => T.categoryPalette[(category || '').toUpperCase()] || T.categoryPalette[category] || T.mint;

// Text hierarchy
T.textPrimary = '#f5f0e8';
T.textSecondary = '#b0a898';

// Role colors (configurable per location)
T.roles = {
  manager:   '#ff8800',
  server:    '#00aaff',
  busser:    '#cc44ff',
  bartender: '#00ddaa',
  host:      '#ffee00',
  cook:      '#ff4499',
};

// Confirm green
T.green = '#39b54a';

// Embossed Button System tokens
T.embDarkBg    = '#2c2926';
T.embGoldBg    = '#c07800';
T.embMintBg    = '#87f79c';
T.embVermBg    = '#aa1a00';
T.embCyanBg    = '#007a7a';
T.embGhostBg   = '#201e1b';
T.embGoldLabel = '#1a0e00';
T.embMintLabel = '#001a0a';
T.embCyanLabel = '#001a1a';
T.embVermLabel = '#ffffff';
T.embEdge      = '#111111';
T.embGoldEdge  = '#7a4400';
T.embMintEdge  = '#2e8040';
T.embCyanEdge  = '#005050';
T.embVermEdge  = '#5a0800';

export function chamfer(s) {
  var c = s || T.chamfer;
  return 'polygon(' + c + 'px 0%, calc(100% - ' + c + 'px) 0%, 100% ' + c + 'px, 100% calc(100% - ' + c + 'px), calc(100% - ' + c + 'px) 100%, ' + c + 'px 100%, 0% calc(100% - ' + c + 'px), 0% ' + c + 'px)';
}

export function bevelEdges(fillColor) {
  if (fillColor === T.bg)      return { light: T.bgLight,    dark: T.bgEdge    };
  if (fillColor === T.darkBtn) return { light: T.darkBtnL,   dark: T.darkBtnD  };
  if (fillColor === T.mint)    return { light: T.mintEdgeL,   dark: T.mintEdgeD };
  if (fillColor === T.numpadChassis) return { light: T.numpadChassisL, dark: T.numpadChassisD };
  if (fillColor === T.goGreen) return { light: T.greenL,      dark: T.greenD   };
  if (fillColor === T.gold)    return { light: T.goldL,       dark: T.goldD    };
  if (fillColor === T.red)     return { light: T.redL,        dark: T.redD     };
  if (fillColor === T.cyan)    return { light: T.cyanL,       dark: T.cyanD    };
  if (fillColor === T.lavender)return { light: T.lavenderL,   dark: T.lavenderD};
  if (fillColor === T.catProteins) return { light: T.catProteinsL, dark: T.catProteinsD };
  if (fillColor === T.catBeverages)return { light: T.catBeveragesL,dark: T.catBeveragesD};
  if (fillColor === T.catSauces)   return { light: T.catSaucesL,   dark: T.catSaucesD  };
  if (fillColor === T.catStarches) return { light: T.catStarchesL, dark: T.catStarchesD};
  if (fillColor === T.grayBtn) return { light: T.grayBtnL, dark: T.grayBtnD };
  if (fillColor === T.mintB)  return { light: '#aff4c4', dark: '#3a7a4d' };
  if (fillColor === T.redB)   return { light: '#ff7a87', dark: '#7a1f28' };
  if (fillColor === T.green)  return { light: '#6adc8a', dark: '#246b34' };
  return { light: T.bgLight, dark: T.bgEdge };
}

export function shadowColor(fillColor) {
  // Style D: dark buttons get mint shadow 55% opacity; colored buttons get dark shadow 80%
  if (fillColor === T.bg)       return 'rgba(198, 255, 187, 0.55)';
  if (fillColor === T.darkBtn)  return 'rgba(198, 255, 187, 0.55)';
  if (fillColor === T.mint)     return 'rgba(10, 10, 10, 0.8)';
  if (fillColor === T.numpadChassis) return 'rgba(0, 0, 0, 0.55)';
  if (fillColor === T.goGreen)  return 'rgba(10, 10, 10, 0.8)';
  if (fillColor === T.gold)     return 'rgba(10, 10, 10, 0.8)';
  if (fillColor === T.red)      return 'rgba(10, 10, 10, 0.8)';
  if (fillColor === T.cyan)     return 'rgba(10, 10, 10, 0.8)';
  if (fillColor === T.lavender) return 'rgba(10, 10, 10, 0.8)';
  if (fillColor === T.catProteins) return 'rgba(10, 10, 10, 0.8)';
  if (fillColor === T.catBeverages)return 'rgba(10, 10, 10, 0.8)';
  if (fillColor === T.catSauces)   return 'rgba(10, 10, 10, 0.8)';
  if (fillColor === T.catStarches) return 'rgba(10, 10, 10, 0.8)';
  if (fillColor === T.grayBtn) return 'rgba(10, 10, 10, 0.8)';
  if (fillColor === T.mintB)  return 'rgba(10, 10, 10, 0.8)';
  if (fillColor === T.redB)   return 'rgba(10, 10, 10, 0.8)';
  if (fillColor === T.green)  return 'rgba(10, 10, 10, 0.8)';
  return 'rgba(10, 10, 10, 0.8)';
}

// ═══════════════════════════════════════════════════
//  EMBOSSED BUTTON SYSTEM
//  Sunken-face / raised-rim model with scanline overlay
//  chamfer: 5px clip-path polygon (buttons + cards only)
// ═══════════════════════════════════════════════════

var _EMB_VARIANTS = {
  dark: {
    bg: T.embDarkBg, label: T.textPrimary,
    shadow: 'inset 0 2px 0 rgba(255,255,255,0.12),inset 0 -2px 0 rgba(0,0,0,0.60),inset 2px 0 0 rgba(255,255,255,0.05),inset -2px 0 0 rgba(0,0,0,0.30),inset 0 4px 8px rgba(0,0,0,0.50),0 2px 8px rgba(0,0,0,0.60),0 0 0 1px ' + T.embEdge,
    shadowActive: 'inset 0 2px 0 rgba(255,255,255,0.12),inset 0 -2px 0 rgba(0,0,0,0.60),inset 2px 0 0 rgba(255,255,255,0.05),inset -2px 0 0 rgba(0,0,0,0.30),inset 0 8px 16px rgba(0,0,0,0.50),0 2px 8px rgba(0,0,0,0.60),0 0 0 1px ' + T.embEdge,
  },
  gold: {
    bg: T.embGoldBg, label: T.embGoldLabel,
    shadow: 'inset 0 2px 0 rgba(255,225,150,0.45),inset 0 -2px 0 rgba(0,0,0,0.45),inset 0 4px 8px rgba(180,100,0,0.30),0 2px 10px rgba(0,0,0,0.60),0 0 16px rgba(251,176,59,0.20),0 0 0 1px ' + T.embGoldEdge,
    shadowActive: 'inset 0 2px 0 rgba(255,225,150,0.45),inset 0 -2px 0 rgba(0,0,0,0.45),inset 0 8px 16px rgba(180,100,0,0.30),0 2px 10px rgba(0,0,0,0.60),0 0 16px rgba(251,176,59,0.20),0 0 0 1px ' + T.embGoldEdge,
  },
  mint: {
    bg: T.embMintBg, label: T.embMintLabel,
    shadow: 'inset 0 2px 0 rgba(220,255,230,0.60),inset 0 -2px 0 rgba(0,0,0,0.35),inset 0 4px 8px rgba(0,80,20,0.20),0 2px 10px rgba(0,0,0,0.50),0 0 16px rgba(135,247,156,0.25),0 0 0 1px ' + T.embMintEdge,
    shadowActive: 'inset 0 2px 0 rgba(220,255,230,0.60),inset 0 -2px 0 rgba(0,0,0,0.35),inset 0 8px 16px rgba(0,80,20,0.20),0 2px 10px rgba(0,0,0,0.50),0 0 16px rgba(135,247,156,0.25),0 0 0 1px ' + T.embMintEdge,
  },
  cyan: {
    bg: T.embCyanBg, label: T.embCyanLabel,
    shadow: 'inset 0 2px 0 rgba(140,255,255,0.45),inset 0 -2px 0 rgba(0,0,0,0.45),inset 0 4px 8px rgba(0,80,80,0.30),0 2px 10px rgba(0,0,0,0.60),0 0 16px rgba(51,255,255,0.15),0 0 0 1px ' + T.embCyanEdge,
    shadowActive: 'inset 0 2px 0 rgba(140,255,255,0.45),inset 0 -2px 0 rgba(0,0,0,0.45),inset 0 8px 16px rgba(0,80,80,0.30),0 2px 10px rgba(0,0,0,0.60),0 0 16px rgba(51,255,255,0.15),0 0 0 1px ' + T.embCyanEdge,
  },
  vermillion: {
    bg: T.embVermBg, label: T.embVermLabel,
    shadow: 'inset 0 2px 0 rgba(255,160,140,0.35),inset 0 -2px 0 rgba(0,0,0,0.50),inset 0 4px 8px rgba(100,0,0,0.40),0 2px 10px rgba(0,0,0,0.60),0 0 16px rgba(255,68,34,0.15),0 0 0 1px ' + T.embVermEdge,
    shadowActive: 'inset 0 2px 0 rgba(255,160,140,0.35),inset 0 -2px 0 rgba(0,0,0,0.50),inset 0 8px 16px rgba(100,0,0,0.40),0 2px 10px rgba(0,0,0,0.60),0 0 16px rgba(255,68,34,0.15),0 0 0 1px ' + T.embVermEdge,
  },
  ghost: {
    bg: T.embGhostBg, label: T.textPrimary,
    shadow: 'inset 0 2px 0 rgba(255,255,255,0.08),inset 0 -2px 0 rgba(0,0,0,0.50),inset 0 4px 8px rgba(0,0,0,0.40),0 2px 8px rgba(0,0,0,0.50),0 0 0 1px rgba(135,247,156,0.20)',
    shadowActive: 'inset 0 2px 0 rgba(255,255,255,0.08),inset 0 -2px 0 rgba(0,0,0,0.50),inset 0 8px 16px rgba(0,0,0,0.40),0 2px 8px rgba(0,0,0,0.50),0 0 0 1px rgba(135,247,156,0.20)',
  },
};

var _EMB_SIZES = {
  sm: { h: '40px', w: '110px', fs: '18px', ls: '2px', pad: '4px 14px' },
  md: { h: '55px', w: '220px', fs: '22px', ls: '3px', pad: '6px 18px' },
  lg: { h: '62px', w: '220px', fs: '31px', ls: '3px', pad: '8px 22px' },
};

function _fillToVariant(fill) {
  if (fill === T.darkBtn || fill === T.bg) return 'dark';
  if (fill === T.gold) return 'gold';
  if (fill === T.mint || fill === T.goGreen || fill === T.green || fill === T.numpadChassis || fill === T.mintB) return 'mint';
  if (fill === T.cyan) return 'cyan';
  if (fill === T.red || fill === T.vermillion || fill === T.redB) return 'vermillion';
  return 'ghost';
}

function _injectEmbossedStyles() {
  if (document.getElementById('embossed-btn-styles')) return;
  var s = document.createElement('style');
  s.id = 'embossed-btn-styles';
  s.textContent =
    '.embossed-btn{position:relative;clip-path:polygon(5px 0%,calc(100% - 5px) 0%,100% 5px,100% calc(100% - 5px),calc(100% - 5px) 100%,5px 100%,0% calc(100% - 5px),0% 5px);cursor:pointer;user-select:none;-webkit-user-select:none;touch-action:manipulation;transition:transform 50ms,filter 50ms,box-shadow 50ms;box-sizing:border-box;border:none;outline:none;isolation:isolate;}' +
    '.embossed-btn-inner{position:relative;z-index:1;display:flex;align-items:center;justify-content:center;text-align:center;width:100%;height:100%;box-sizing:border-box;}';
  document.head.appendChild(s);
}

export function buildStyledButton(arg) {
  _injectEmbossedStyles();

  var isNewApi = (typeof arg === 'object' && arg !== null && arg.variant !== undefined);
  var variant, sizeKey, label, onClick, disabled;

  if (isNewApi) {
    variant = arg.variant || 'dark';
    sizeKey = arg.size || 'md';
    label = arg.label || '';
    onClick = arg.onClick || null;
    disabled = !!arg.disabled;
  } else {
    variant = _fillToVariant(arg || T.darkBtn);
    sizeKey = null;
    label = null;
    onClick = null;
    disabled = false;
  }

  var v = _EMB_VARIANTS[variant] || _EMB_VARIANTS.dark;
  var sz = sizeKey ? (_EMB_SIZES[sizeKey] || _EMB_SIZES.md) : null;

  var wrap = document.createElement('div');
  wrap.className = 'embossed-btn';
  wrap.style.background = v.bg;
  wrap.style.boxShadow = v.shadow;
  if (sz) {
    wrap.style.height = sz.h;
    wrap.style.minWidth = sz.w;
  }

  var inner = document.createElement('div');
  inner.className = 'embossed-btn-inner';
  inner.style.color = v.label;
  inner.style.fontFamily = isNewApi ? T.fhr : T.fb;
  inner.style.whiteSpace = 'pre-line';
  inner.style.padding = sz ? sz.pad : '8px 12px';
  if (isNewApi) {
    inner.style.textTransform = 'uppercase';
    inner.style.lineHeight = '1.05';
    if (sz) {
      inner.style.fontSize = sz.fs;
      inner.style.letterSpacing = sz.ls;
    }
  }
  if (label) inner.textContent = label;

  wrap.appendChild(inner);
  wrap._inner = inner;
  wrap._embV = v;
  wrap._edges = { light: '', dark: '' };
  wrap._shadow = '';
  wrap._bevel = 0;

  wrap.addEventListener('pointerenter', function() {
    if (wrap._embDisabled) return;
    wrap.style.filter = 'brightness(1.2)';
  });
  wrap.addEventListener('pointerdown', function() {
    if (wrap._embDisabled) return;
    wrap.style.transform = 'scale(0.97) translateY(1px)';
    wrap.style.boxShadow = wrap._embV.shadowActive;
  });
  wrap.addEventListener('pointerup', function() {
    if (wrap._embDisabled) return;
    wrap.style.transform = '';
    wrap.style.boxShadow = wrap._embV.shadow;
  });
  wrap.addEventListener('pointerleave', function() {
    if (wrap._embDisabled) return;
    wrap.style.filter = '';
    wrap.style.transform = '';
    wrap.style.boxShadow = wrap._embV.shadow;
  });

  if (onClick) wrap.addEventListener('pointerup', onClick);

  wrap._embDisabled = false;
  wrap.setDisabled = function(d) {
    wrap._embDisabled = d;
    wrap.style.opacity = d ? '0.35' : '';
    wrap.style.pointerEvents = d ? 'none' : '';
  };
  if (disabled) wrap.setDisabled(true);

  return { wrap: wrap, inner: inner };
}

export function applySunkenStyle(el) {
  var b = T.bevel;
  el.style.borderTop    = b + 'px solid ' + T.bgEdge;
  el.style.borderLeft   = b + 'px solid ' + T.bgEdge;
  el.style.borderBottom = b + 'px solid ' + T.bgLight;
  el.style.borderRight  = b + 'px solid ' + T.bgLight;
  el.style.clipPath = chamfer();
}

export function applyRaisedStyle(el, fillColor) {
  var fill = fillColor || T.darkBtn;
  var edges = bevelEdges(fill);
  var b = T.bevel;
  el.style.background = fill;
  el.style.borderTop    = b + 'px solid ' + edges.light;
  el.style.borderLeft   = b + 'px solid ' + edges.light;
  el.style.borderBottom = b + 'px solid ' + edges.dark;
  el.style.borderRight  = b + 'px solid ' + edges.dark;
  el.style.clipPath = chamfer(10);
}


// ═══════════════════════════════════════════════════
//  THEME SYSTEM
//  Snapshot defaults, apply overrides, notify listeners
// ═══════════════════════════════════════════════════

// Snapshot of every T key at load time (flat + object values)
var _defaults = {};
var _defaultObjects = {};
(function() {
  var keys = Object.keys(T);
  for (var i = 0; i < keys.length; i++) {
    var v = T[keys[i]];
    if (typeof v === 'function') continue;
    if (typeof v === 'object' && v !== null && !Array.isArray(v)) {
      _defaultObjects[keys[i]] = JSON.parse(JSON.stringify(v));
    } else {
      _defaults[keys[i]] = v;
    }
  }
})();

var _themeListeners = [];

export function onThemeChange(fn) {
  _themeListeners.push(fn);
}

export function setTheme(overrides) {
  if (!overrides) return;
  var keys = Object.keys(overrides);
  for (var i = 0; i < keys.length; i++) {
    var val = overrides[keys[i]];
    if (typeof val === 'object' && val !== null && !Array.isArray(val)) {
      // Merge objects (e.g. categoryPalette, roles)
      T[keys[i]] = T[keys[i]] || {};
      var oKeys = Object.keys(val);
      for (var k = 0; k < oKeys.length; k++) {
        T[keys[i]][oKeys[k]] = val[oKeys[k]];
      }
    } else {
      T[keys[i]] = val;
    }
  }
  // Recompute derived values
  _recomputeEmbossed();
  // Notify listeners (SceneManager re-applies geometry, etc.)
  for (var j = 0; j < _themeListeners.length; j++) {
    _themeListeners[j](T);
  }
}

export function resetTheme() {
  var keys = Object.keys(_defaults);
  for (var i = 0; i < keys.length; i++) {
    T[keys[i]] = _defaults[keys[i]];
  }
  // Restore object properties (categoryPalette, roles, etc.)
  var oKeys = Object.keys(_defaultObjects);
  for (var j = 0; j < oKeys.length; j++) {
    T[oKeys[j]] = JSON.parse(JSON.stringify(_defaultObjects[oKeys[j]]));
  }
  _recomputeEmbossed();
  for (var k = 0; k < _themeListeners.length; k++) {
    _themeListeners[k](T);
  }
}

export function getThemeDefaults() {
  return _defaults;
}

function _recomputeEmbossed() {
  // Refresh embossed variant table when theme colors change
  _EMB_VARIANTS.dark.bg = T.embDarkBg;
  _EMB_VARIANTS.dark.label = T.textPrimary;
  _EMB_VARIANTS.gold.bg = T.embGoldBg;
  _EMB_VARIANTS.gold.label = T.embGoldLabel;
  _EMB_VARIANTS.mint.bg = T.embMintBg;
  _EMB_VARIANTS.mint.label = T.embMintLabel;
  _EMB_VARIANTS.cyan.bg = T.embCyanBg;
  _EMB_VARIANTS.cyan.label = T.embCyanLabel;
  _EMB_VARIANTS.vermillion.bg = T.embVermBg;
  _EMB_VARIANTS.vermillion.label = T.embVermLabel;
  _EMB_VARIANTS.ghost.bg = T.embGhostBg;
  _EMB_VARIANTS.ghost.label = T.textPrimary;
}
