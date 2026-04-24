// ═══════════════════════════════════════════════════
//  KINDpos — Shared Theme Builders  (Vz2.0)
//  Design primitives shared across terminal, overseer, entomology.
//  Nice. Dependable. Yours.
// ═══════════════════════════════════════════════════
//
//  tokens.js owns the raw palette + geometry.
//  common/theme.js owns the shared construction primitives:
//   color utilities, the card affordance tiers, the well inset, and
//   generic data-display helpers (section label, hero number, data
//   row, divider).
//
//  POS-specific chrome (pill buttons, numpad keys, PIN rows, float
//  buttons) stays in terminal/theme-manager.js.
//
//  Usage:
//    import { buildCard, buildStaticCard, lightenHex, darkenHex,
//             hexToRgba } from '../common/theme.js';
// ═══════════════════════════════════════════════════

import { T, chamfer } from './tokens.js';

// ═══════════════════════════════════════════════════
//  COLOR UTILITIES
// ═══════════════════════════════════════════════════

export function lightenHex(hex, pct) {
  var r = parseInt(hex.slice(1, 3), 16);
  var g = parseInt(hex.slice(3, 5), 16);
  var b = parseInt(hex.slice(5, 7), 16);
  return '#' + [
    Math.min(255, Math.round(r + (255 - r) * pct)),
    Math.min(255, Math.round(g + (255 - g) * pct)),
    Math.min(255, Math.round(b + (255 - b) * pct)),
  ].map(function(c) { return c.toString(16).padStart(2, '0'); }).join('');
}

export function darkenHex(hex, pct) {
  var r = parseInt(hex.slice(1, 3), 16);
  var g = parseInt(hex.slice(3, 5), 16);
  var b = parseInt(hex.slice(5, 7), 16);
  var f = 1 - pct;
  return '#' + [Math.round(r * f), Math.round(g * f), Math.round(b * f)]
    .map(function(c) { return c.toString(16).padStart(2, '0'); }).join('');
}

export function hexToRgba(hex, alpha) {
  var r = parseInt(hex.slice(1, 3), 16);
  var g = parseInt(hex.slice(3, 5), 16);
  var b = parseInt(hex.slice(5, 7), 16);
  return 'rgba(' + r + ',' + g + ',' + b + ',' + alpha + ')';
}

// ═══════════════════════════════════════════════════
//  CARD BUILDER
//  Left accent bar + chamfer clip-path.
//  Returns { wrap, card }
//   wrap — outer div, overflow:visible (float buttons clear the edge)
//   card — inner div, clipped + styled
//
//  opts:
//    accent      — border-left color (default: T.green)
//    bg          — background (default: T.card)
//    padding     — inner padding (default: '14px 16px')
//    width / height / flex
//    chamferSize — clip-path px (default: T.chamferCard)
//    cssText     — extra styles for inner card
// ═══════════════════════════════════════════════════

export function buildCard(opts) {
  var o      = opts || {};
  var accent = o.accent  || T.green;
  var bg     = o.bg      || T.card;
  var pad    = o.padding || '14px 16px';
  var cham   = o.chamferSize != null ? o.chamferSize : T.chamferCard;

  var wrap = document.createElement('div');
  wrap.style.position      = 'relative';
  wrap.style.overflow      = 'visible';
  wrap.style.display       = 'flex';
  wrap.style.flexDirection = 'column';
  if (o.flex)   wrap.style.flex   = o.flex;
  if (o.width)  wrap.style.width  = o.width;
  if (o.height) wrap.style.height = o.height;

  var card = document.createElement('div');
  card.style.flex       = '1';
  card.style.background = bg;
  card.style.clipPath   = cham > 0 ? chamfer(cham) : 'none';
  card.style.borderLeft = T.accentBarW + ' solid ' + accent;
  card.style.padding    = pad;
  card.style.boxSizing  = 'border-box';
  card.style.overflow   = 'hidden';
  card.style.boxShadow  = '0 4px 16px rgba(0,0,0,0.28)';
  if (o.cssText) card.style.cssText += o.cssText;

  wrap.appendChild(card);
  return { wrap: wrap, card: card };
}

// ═══════════════════════════════════════════════════
//  KINDpos Card Affordance System
// ═══════════════════════════════════════════════════
//
//  Three tiers — pick the one that matches the interaction:
//
//    buildStaticCard(opts)  — Tier 1, DISPLAY-ONLY panel.
//                             cursor:default, no tap chrome, no press
//                             animation. NEVER attach click/pointerup
//                             listeners; nothing will visually confirm
//                             the tap and touch devices may swallow it.
//                             Use for read-only data surfaces
//                             (COB panel, Sales card, totals cards).
//
//    buildNavCard(opts)     — Tier 2, drill-down / navigable card.
//                             Adds hover shadow, chevron, and a
//                             pointerdown-translate press. Extends
//                             buildStaticCard internally and wires its
//                             own pointer listeners — safe to click
//                             via opts.onClick.
//
//    buildActionCard(opts)  — Tier 3, primary tappable card.
//                             cursor:pointer, pointer-events:auto,
//                             touch-action:manipulation, raised/pressed
//                             shadow animation. The right choice for
//                             grid tiles, check tiles, seat tiles —
//                             anything whose whole surface is a button.
//
//  The wrong choice isn't a type error; it's a silent-tap bug that
//  only surfaces on touch. See check-overview Mode B seat tiles
//  (fixed 1913d94): buildStaticCard silently ignored taps on the
//  card body because it has no touch-action:manipulation chrome.
// ═══════════════════════════════════════════════════

/**
 * buildStaticCard(opts) — Tier 1, read-only display panel.
 *
 * DO NOT attach click / pointerup / pointerdown listeners to the
 * returned element — this builder is display-only. Use buildActionCard
 * for tappable surfaces or buildNavCard for drill-down navigation.
 *
 * Dev-time guard: the returned element's addEventListener is wrapped
 * to log a console.warn when an interactive event type is attached
 * externally, so the mistake surfaces during development instead of
 * being rediscovered on a touch device.
 */
export function buildStaticCard(opts) {
  var o = opts || {};
  var accent = o.accent || T.green;

  var el = document.createElement('div');
  el.style.position = 'relative';
  el.style.backgroundColor = T.well;
  el.style.borderRadius = '12px';
  el.style.borderLeft = '5px solid ' + lightenHex(T.bg, 0.08);
  el.style.borderTop = '5px solid ' + lightenHex(T.bg, 0.08);
  el.style.borderRight = '5px solid ' + darkenHex(T.bg, 0.2);
  el.style.borderBottom = '5px solid ' + darkenHex(T.bg, 0.2);
  el.style.boxShadow = 'inset 0 1px 0 rgba(255,255,255,0.06), 3px 5px 0 rgba(0,0,0,0.55)';
  el.style.cursor = 'default';
  el.style.padding = '16px 18px 14px 20px';
  el.style.boxSizing = 'border-box';
  if (o.width) el.style.width = o.width;

  var bar = document.createElement('div');
  bar.style.position = 'absolute';
  bar.style.left = '0';
  bar.style.top = '12px';
  bar.style.bottom = '12px';
  bar.style.width = T.accentBarW || '4px';
  bar.style.borderRadius = '0 2px 2px 0';
  bar.style.backgroundColor = accent;
  bar.style.boxShadow = '0 0 10px ' + hexToRgba(accent, 0.5);
  el.appendChild(bar);

  el.accentBar = bar;
  el.setAccent = function(color) {
    el.accentBar.style.backgroundColor = color;
    el.accentBar.style.boxShadow = '0 0 10px ' + hexToRgba(color, 0.5);
  };

  // Dev guard — warn if a consumer attaches an interactive listener to
  // a display-only card. buildNavCard (and any other internal extender)
  // sets _staticCardTappableAllowed = true before wiring its own
  // pointerdown/pointerup so the warning only fires for external misuse.
  var _origAdd = el.addEventListener.bind(el);
  var _warned = false;
  el.addEventListener = function(type, listener, options) {
    if (!_warned && !el._staticCardTappableAllowed
        && (type === 'click' || type === 'pointerup' || type === 'pointerdown')) {
      _warned = true;
      // eslint-disable-next-line no-console
      console.warn(
        '[theme-manager] buildStaticCard is a display-only panel; ' +
        'attaching "' + type + '" will not give the tile a tap cursor, ' +
        'touch-action chrome, or the press animation. Use buildActionCard ' +
        'for tappable cards or buildNavCard for drill-down navigation.'
      );
    }
    return _origAdd(type, listener, options);
  };

  return el;
}

/**
 * buildNavCard(opts) — Tier 2, drill-down / navigable
 */
export function buildNavCard(opts) {
  var o = opts || {};
  var accent = o.accent || T.green;
  var el = buildStaticCard(o);
  // Opt out of buildStaticCard's tappable-listener guard — buildNavCard
  // legitimately attaches pointerdown/pointerup for its own press
  // animation, and consumers may also attach a click via opts.onClick.
  el._staticCardTappableAllowed = true;
  el.style.cursor = 'pointer';
  el.style.transition = 'transform 0.1s ease, box-shadow 0.1s ease';

  var showChevron = o.showChevron !== false;
  var chevron;
  if (showChevron) {
    chevron = document.createElement('div');
    chevron.textContent = '›';
    chevron.style.position = 'absolute';
    chevron.style.right = '14px';
    chevron.style.bottom = '13px';
    chevron.style.fontFamily = T.fb;
    chevron.style.fontSize = '11px';
    chevron.style.color = T.border;
    chevron.style.opacity = '0.6';
    chevron.style.transition = 'all 0.1s ease';
    el.appendChild(chevron);
    el.chevron = chevron;
  }

  var baseShadow = 'inset 0 1px 0 rgba(255,255,255,0.06), 3px 5px 0 rgba(0,0,0,0.55)';
  var hoverShadow = baseShadow + ', 0 0 18px ' + hexToRgba(accent, 0.12);
  var activeShadow = '1px 3px 0 rgba(0,0,0,0.55)';

  el.addEventListener('mouseenter', function() {
    el.style.transform = 'translateY(-1px)';
    el.style.boxShadow = hoverShadow;
    if (chevron) {
      chevron.style.opacity = '1';
      chevron.style.color = accent;
      chevron.style.transform = 'translateX(2px)';
    }
  });

  el.addEventListener('mouseleave', function() {
    el.style.transform = 'none';
    el.style.boxShadow = baseShadow;
    if (chevron) {
      chevron.style.opacity = '0.6';
      chevron.style.color = T.border;
      chevron.style.transform = 'none';
    }
  });

  el.addEventListener('pointerdown', function() {
    el.style.transform = 'translateY(2px)';
    el.style.boxShadow = activeShadow;
  });

  el.addEventListener('pointerup', function() {
    el.style.transform = 'translateY(-1px)';
    el.style.boxShadow = hoverShadow;
  });

  return el;
}

/**
 * buildActionCard(opts) — Tier 3, raised key / primary action
 */
export function buildActionCard(opts) {
  var o = opts || {};
  var accent = o.accent || T.green;

  var el = document.createElement('div');
  el.style.position = 'relative';
  el.style.backgroundColor = T.card;
  el.style.borderRadius = '14px';
  el.style.cursor = 'pointer';
  el.style.padding = '16px 18px 14px 20px';
  el.style.boxSizing = 'border-box';
  el.style.transition = 'transform 0.07s ease, box-shadow 0.07s ease';
  el.style.pointerEvents = 'auto';
  el.style.touchAction = 'manipulation';
  if (o.width) el.style.width = o.width;

  var bar = document.createElement('div');
  bar.style.position = 'absolute';
  bar.style.left = '0';
  bar.style.top = '12px';
  bar.style.bottom = '12px';
  bar.style.width = T.accentBarW || '4px';
  bar.style.borderRadius = '0 2px 2px 0';
  bar.style.backgroundColor = accent;
  bar.style.boxShadow = '0 0 10px ' + hexToRgba(accent, 0.5);
  el.appendChild(bar);

  el.accentBar = bar;
  el.setAccent = function(color) {
    el.accentBar.style.backgroundColor = color;
    el.accentBar.style.boxShadow = '0 0 10px ' + hexToRgba(color, 0.5);
  };

  var baseShadow = '0 7px 0 ' + darkenHex(T.card, 0.35) + ', inset 0 1px 0 rgba(255,255,255,0.10), 0 10px 24px rgba(0,0,0,0.45)';
  var hoverShadow = '0 8px 0 ' + darkenHex(T.card, 0.35) + ', inset 0 1px 0 rgba(255,255,255,0.10), 0 12px 26px rgba(0,0,0,0.5), 0 0 20px ' + hexToRgba(accent, 0.10);
  var activeShadow = '0 3px 0 ' + darkenHex(T.card, 0.35) + ', inset 0 1px 0 rgba(255,255,255,0.06), 0 4px 10px rgba(0,0,0,0.4)';

  el.style.boxShadow = baseShadow;

  el.addEventListener('mouseenter', function() {
    el.style.boxShadow = hoverShadow;
  });

  el.addEventListener('mouseleave', function() {
    el.style.boxShadow = baseShadow;
    el.style.transform = 'none';
  });

  el.addEventListener('pointerdown', function() {
    el.style.transform = 'translateY(4px)';
    el.style.boxShadow = activeShadow;
  });

  el.addEventListener('pointerup', function() {
    el.style.transform = 'none';
    el.style.boxShadow = hoverShadow;
  });

  if (o.onClick) {
    el.addEventListener('pointerup', o.onClick);
  }

  return el;
}

// ═══════════════════════════════════════════════════
//  WELL BUILDER
//  Inset panel — numpad chassis, data panels, PIN field
// ═══════════════════════════════════════════════════

export function buildWell(opts) {
  var o      = opts || {};
  var accent = o.accent || null;

  var el = document.createElement('div');
  el.style.background = o.bg || T.well;
  el.style.clipPath   = chamfer(o.chamferSize != null ? o.chamferSize : T.chamferWell);
  el.style.padding    = o.padding || '20px';
  el.style.boxSizing  = 'border-box';
  if (accent) el.style.borderLeft = T.accentBarW + ' solid ' + hexToRgba(accent, 0.4);
  if (o.width)  el.style.width  = o.width;
  if (o.height) el.style.height = o.height;
  return el;
}

// ═══════════════════════════════════════════════════
//  SECTION LABEL BUILDER
//  Small spaced uppercase label
// ═══════════════════════════════════════════════════

export function buildSectionLabel(text, accent) {
  var el = document.createElement('div');
  el.textContent         = text;
  el.style.fontFamily    = T.fb;
  el.style.fontSize      = T.fsB3;
  el.style.fontWeight    = T.fwMed;
  el.style.color         = accent || T.green;
  el.style.letterSpacing = '0.2em';
  el.style.textTransform = 'uppercase';
  return el;
}

// ═══════════════════════════════════════════════════
//  HERO NUMBER BUILDER
//  Large display number — use T.gold for money always
// ═══════════════════════════════════════════════════

export function buildHeroNumber(value, color) {
  var el = document.createElement('div');
  el.textContent         = value;
  el.style.fontFamily    = T.fh;
  el.style.fontSize      = T.fsHero;
  el.style.fontWeight    = T.fwBold;
  el.style.color         = color || T.gold;
  el.style.letterSpacing = '0.04em';
  el.style.lineHeight    = '1';
  el.style.textShadow    = '0 0 16px ' + hexToRgba(color || T.gold, 0.35);
  return el;
}

// ═══════════════════════════════════════════════════
//  DATA ROW BUILDER
//  Label + value pair. Returns row element with
//  setValue(v) and setColor(c) helpers.
// ═══════════════════════════════════════════════════

export function buildDataRow(labelText, valueText, valueColor) {
  var row = document.createElement('div');
  row.style.display        = 'flex';
  row.style.justifyContent = 'space-between';
  row.style.alignItems     = 'baseline';
  row.style.padding        = '4px 0';
  row.style.borderBottom   = '1px solid rgba(90,95,102,0.3)';

  var lbl = document.createElement('span');
  lbl.textContent         = labelText;
  lbl.style.fontFamily    = T.fb;
  lbl.style.fontSize      = T.fsB3;
  lbl.style.color         = T.text;
  lbl.style.letterSpacing = '0.1em';
  lbl.style.textTransform = 'uppercase';

  var val = document.createElement('span');
  val.textContent      = valueText;
  val.style.fontFamily = T.fb;
  val.style.fontSize   = T.fsB1;
  val.style.fontWeight = T.fwMed;
  val.style.color      = valueColor || T.text;
  if (valueColor) val.style.textShadow = '0 0 8px ' + hexToRgba(valueColor, 0.35);

  row.appendChild(lbl);
  row.appendChild(val);
  row.setValue = function(v) { val.textContent = v; };
  row.setColor = function(c) {
    val.style.color      = c;
    val.style.textShadow = '0 0 8px ' + hexToRgba(c, 0.35);
  };
  return row;
}

// ═══════════════════════════════════════════════════
//  DIVIDER BUILDER
// ═══════════════════════════════════════════════════

export function buildDivider(margin) {
  var el = document.createElement('div');
  el.style.height     = '1px';
  el.style.background = T.border;
  el.style.opacity    = '0.5';
  el.style.margin     = margin || '16px 0';
  return el;
}
