// ═══════════════════════════════════════════════════
//  KINDpos Terminal — Design Tokens  (Vz2.0)
//  Theme: Nostalgia
//  Nice. Dependable. Yours.
// ═══════════════════════════════════════════════════
//
//  Single source of truth for all visual values.
//  theme-manager.js imports from here and owns construction.
//  scene-manager.js imports from here for geometry + z-indexes.
//
//  Rules:
//   1. No hardcoded values anywhere outside this file — ever.
//   2. Store theme applied at runtime via setTheme() / applyStoreTheme().
//   3. Category colors must never duplicate a semantic color.
// ═══════════════════════════════════════════════════

export const T = {

  // ── Surfaces ──────────────────────────────────────
  bg:       '#383c42',   // Shell / scene background (slate)
  card:     '#2e3236',   // Card surface — darker than bg for contrast
  well:     '#22252a',   // Inset well / numpad chassis / deep inset

  // ── System green (structural — never data) ────────
  green:    '#86efac',   // KINDpos primary — borders, headers, system UI
  greenDk:  '#1a5c2e',   // Shadow / press state

  // ── Warm green (action / confirm) ─────────────────
  greenWarm:   '#4ade80',  // ENT key, submit, confirm, save
  greenWarmDk: '#166534',  // Shadow / press state

  // ── Gold (money — ALWAYS and ONLY) ────────────────
  gold:     '#e8c84e',   // All monetary values
  goldDk:   '#7a5c00',   // Shadow / press state

  // ── Vermillion (destructive) ──────────────────────
  verm:     '#e8472a',   // CLR key, void, delete, critical
  vermDk:   '#6b1a0e',   // Shadow / press state

  // ── Electric cyan (card/credit payments only) ─────
  elec:     '#22d3ee',   // Card payment amounts
  elecDk:   '#0e6b7a',   // Shadow / press state

  moon:     '#7e8896',
  moonDk:   '#4a5059',
  moonText: '#22252a',  // label color on moon fill

   // ── Chart semantic colors ─────────────────────────
  lavender:   '#b48efa',   // Last week / comparison period — never use for current data
  positive:   '#4ade80',   // Positive delta indicator (up arrows, gains)
  warning:    '#fbbf24',   // Warning threshold (COB 28%, unadj tips, etc.)

  // ── Server identity palette ───────────────────────
  // Distinct, high-contrast hues for per-server UI tagging (server list
  // tiles, check-by-server color bars). Rotates modulo its length; order
  // is cosmetic. Not semantic — treat positions as opaque.
  srvPalette: [
    '#38bdf8', // sky
    '#a78bfa', // violet
    '#fb923c', // peach
    '#34d399', // emerald
    '#facc15', // yellow
    '#f472b6', // pink
    '#e879f9', // fuchsia
    '#4ade80', // green
  ],

  // ── Seat identity palette ─────────────────────────
  // Per-seat accent color — seat tiles, check-overview seat rows, the
  // seat-assign interrupt's S1/S2/S3 buttons. Distinct from the
  // action-bar palette (gold, greenWarm, verm, elec, lavender, moon) so
  // a selected seat never looks like a PAY / ADD ITEMS / VOID / PRINT /
  // DISC / EDIT button. Rotates modulo length for larger parties.
  seatPalette: [
    '#38bdf8', // sky
    '#fb923c', // peach
    '#f472b6', // pink
    '#34d399', // emerald
    '#facc15', // yellow
    '#e879f9', // fuchsia
    '#818cf8', // indigo
    '#fb7185', // rose
  ],

  // ── Chart structure ───────────────────────────────
  chartWell:  '#1e2124',   // Chart container background (deeper than well)
  gridLine:   '#2a2d32',   // Chart grid lines
  axisText:   'rgba(255,255,255,0.5)', // X/Y axis labels

  // ── COB thresholds ────────────────────────────────
  cobWarn:    0.28,        // COB warning threshold (28%)
  cobCrit:    0.35,        // COB critical threshold (35%)

  // ── Text ──────────────────────────────────────────
  text:     '#e8eaed',   // Primary text — full brightness always
  // No dim text by design. Hierarchy = size + weight.

  // ── Borders / structural ──────────────────────────
  border:   '#5a5f66',   // Inactive borders, dividers, separators

  // ── Typography ────────────────────────────────────
  fh:       'Outfit, sans-serif',          // Headings
  fb:       'JetBrains Mono, monospace',   // Body / UI / data

  // Font sizes — use these, never hardcode
  fsHero:   '56px',   // Hero numbers, scene titles
  fsH2:     '44px',   // Section headings, large card values
  fsH3:     '32px',   // Card headings, sub-section
  fsH4:     '26px',   // Label headings, tile IDs
  fsB1:     '24px',   // Primary body, data rows
  fsB2:     '20px',   // Secondary body, labels, buttons
  fsB3:     '16px',    // Tertiary, timestamps
  fsB4:     '14px',    // Micro labels, version stamps

  // Font weights
  fwReg:    '400',
  fwMed:    '500',
  fwBold:   '700',
  fwNormal: '700',   // intentional — all UI text is bold by design

  // ── Layout ────────────────────────────────────────
  appW:     1024,
  appH:     600,
  headerH:  52,        // New Nostalgia header height (fixed)
  scenePad: 24,
  colGap:   20,
  colGapSm: 12,
  pcLeftW:  340,       // Left column width (tips panel)

  // ── Geometry ──────────────────────────────────────
  chamferCard:   10,    // Cards and panels
  chamferBtn:    6,
  chamferWell:   10,    // Inset wells, numpad chassis
  chamferKey:    12,    // Numpad keys
  chamferPin:    10,    // PIN input boxes
  chamferSmall:  6,    // Small chips, badges
  chamferFloat:  10,    // Float buttons (OPEN/CLOSED, CHECKOUT)
  accentBarW:    '4px', // Left accent bar width on cards
  pillRadius:    '999px', // Pill buttons

  // Animation durations
  transitionFast:  'all 0.07s ease',
  transitionMed:   'all 0.2s ease',

  // ── Scrims ────────────────────────────────────────
  scrimWorking:     'rgba(44, 47, 52, 0.70)',
  scrimInterrupt:   'rgba(44, 47, 52, 0.88)',
  scrimGate:        'rgba(44, 47, 52, 1.00)',

  // ── Frame colors (tier borders) ───────────────────
  frameTransactional:     '#86efac',   // green — overlay frame

  // ── Layer z-indexes ───────────────────────────────
  zWorking:       10,
  zTransactional: 20,
  zSummary:       25,
  zInterrupt:     30,
  zGate:          100,

  // ── Store theme (defaults — overridden at runtime) ─
  storeName:    'Store Name',
  terminalId:   'Terminal 01',
  storePrimary:    '#86efac',   // defaults to system green
  storePrimaryDk:  '#1a5c2e',
  storeSecondary:  '#e8c84e',   // defaults to gold
  storeSecondaryDk:'#7a5c00',
  storeTertiary:   '#22d3ee',   // defaults to elec
  storeTertiaryDk: '#0e6b7a',
  storeLogoUrl:    null,

  // ── Category colors (operator-configurable) ────────
  // Must never duplicate a semantic color.
  // All receive glow: box-shadow 0 0 8px {color}55
  categoryPalette: {
    'PIZZA':    '#f97316',   // orange
    'APPS':     '#a78bfa',   // violet
    'SUBS':     '#38bdf8',   // sky blue
    'SIDES':    '#fb923c',   // peach
    'DRINKS':   '#e879f9',   // fuchsia
    'DESSERTS': '#f472b6',   // pink
    'SAUCES':   '#facc15',   // yellow
  },

  // ── Role colors ────────────────────────────────────
  roles: {
    manager:   '#f97316',   // orange
    server:    '#38bdf8',   // sky
    busser:    '#a78bfa',   // violet
    bartender: '#34d399',   // emerald
    host:      '#facc15',   // yellow
    cook:      '#f472b6',   // pink
    cashier:   '#22d3ee',   // electric cyan (T.elec)
  },
};

// ── Category color helper ─────────────────────────
T.catColor = function(category) {
  var key = (category || '').toUpperCase();
  return T.categoryPalette[key] || T.categoryPalette[category] || T.green;
};

// ── Group semantic tokens (Layer 2) ──────────────────
// Per-family edit points. Defaults map to current primitives — no visual change.
// Change a group token to retune one family; change the primitive to cascade everywhere.
T.groups = {

  // manager-landing + server-landing
  landing: {
    tileAccent:        T.green,       // check-tile left accent bar
    infoAccent:        T.green,       // sales overview / tips card accent
    srvChipAccent:     'srvPalette',  // dynamic sentinel — rotates per server
    newCheckBorder:    T.green,       // dashed new-check tile outline
  },

  // co-zero-confirm, co-void-confirm, co-finalize-confirm
  confirmation: {
    shellAccentDanger: T.verm,        // zero / void shell accent
    shellAccentOk:     T.green,       // finalize shell accent
    cancel:            'ghost',       // CANCEL pill variant
    confirmAffirm:     'mint',        // OK-style CONFIRM variant
    confirmDelete:     'verm',        // destructive CONFIRM variant
  },

  // co-transfer-picker, co-discount-picker, disc-select, server-picker, co-item-menu
  picker: {
    shellAccent:       T.elec,        // neutral-action shell accent
    shellAccentAuth:   T.gold,        // auth-flavor pickers (disc-select)
    cancel:            'ghost',
    apply:             'elec',
    optionDefault:     'ghost',       // option pills — no semantic color
    optionSelected:    T.elec,        // selected-tile border color
  },

  // co-manager-pin, disc-pin, seat-count
  auth: {
    shellAccent:       T.gold,        // decision / auth flavor
  },

  // seat-assign, qty-edit
  composite: {
    shellAccent:       T.green,
    selectAll:         'elec',        // helper variant
    cancel:            'verm',        // destructive exit
    confirm:           'mint',        // primary CTA variant
    stepper:           'elec',        // qty-edit -/+ variant
  },

  // buildDenomTile, split-select fraction tiles
  paymentPreset: {
    tileAccent:        T.green,       // buildActionCard accent bar
    tapFlashFill:      T.green,       // bg during the pointerup flash
    tapFlashLabel:     T.well,        // label color during the flash
  },

  // check-overview main bottom action bar
  actionBar: {
    disc:              T.lavender,
    void:              T.verm,
    pay:               T.gold,
    addItems:          T.greenWarm,
    editSeats:         T.moon,
    print:             T.elec,
    radius:            '14px',
  },

  // seat tiles — seat-assign rows, check-overview picker grid
  selectionGrid: {
    unselectedBg:      T.moon,
    unselectedFg:      'seatPalette', // dynamic sentinel — seatPalette[(sn-1)%8]
    selectedBg:        'seatPalette', // dynamic sentinel — same index
    selectedFg:        T.moonText,
    radius:            '14px',
  },
};

// ── Chamfer clip-path generator ───────────────────
export function chamfer(px) {
  var c = (px != null ? px : T.chamferCard);
  return (
    'polygon(' +
    c + 'px 0%, ' +
    'calc(100% - ' + c + 'px) 0%, ' +
    '100% ' + c + 'px, ' +
    '100% calc(100% - ' + c + 'px), ' +
    'calc(100% - ' + c + 'px) 100%, ' +
    c + 'px 100%, ' +
    '0% calc(100% - ' + c + 'px), ' +
    '0% ' + c + 'px)'
  );
}

// ═══════════════════════════════════════════════════
//  THEME SYSTEM
//  setTheme — apply overrides (store config, Overseer broadcast)
//  resetTheme — restore Nostalgia defaults
//  applyStoreTheme — convenience wrapper for store config
//  onThemeChange — register a listener (SceneManager uses this)
// ═══════════════════════════════════════════════════

// Snapshot defaults at load time
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
      T[keys[i]] = T[keys[i]] || {};
      var oKeys = Object.keys(val);
      for (var k = 0; k < oKeys.length; k++) {
        T[keys[i]][oKeys[k]] = val[oKeys[k]];
      }
    } else {
      T[keys[i]] = val;
    }
  }
  _notifyListeners();
}

export function resetTheme() {
  var keys = Object.keys(_defaults);
  for (var i = 0; i < keys.length; i++) {
    T[keys[i]] = _defaults[keys[i]];
  }
  var oKeys = Object.keys(_defaultObjects);
  for (var j = 0; j < oKeys.length; j++) {
    T[oKeys[j]] = JSON.parse(JSON.stringify(_defaultObjects[oKeys[j]]));
  }
  _notifyListeners();
}

/**
 * Apply store-specific theme at runtime.
 * Called on boot after loading store config from API,
 * and again whenever Overseer broadcasts a theme change.
 *
 * @param {object} storeConfig
 * @param {string} storeConfig.storeName
 * @param {string} storeConfig.terminalId
 * @param {string} storeConfig.storePrimary      - Main store accent color
 * @param {string} storeConfig.storePrimaryDk    - Dark variant
 * @param {string} storeConfig.storeSecondary
 * @param {string} storeConfig.storeSecondaryDk
 * @param {string} storeConfig.storeTertiary
 * @param {string} storeConfig.storeTertiaryDk
 * @param {string|null} storeConfig.storeLogoUrl
 */
export function applyStoreTheme(storeConfig) {
  if (!storeConfig) return;
  setTheme(storeConfig);
}

export function getThemeDefaults() {
  return Object.assign({}, _defaults);
}

function _notifyListeners() {
  for (var i = 0; i < _themeListeners.length; i++) {
    try { _themeListeners[i](T); } catch (e) { console.error('Theme listener error:', e); }
  }
}