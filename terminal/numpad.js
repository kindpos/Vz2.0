// ═══════════════════════════════════════════════════
//  KINDpos Terminal — Numpad Component  (Vz2.0)
//  Ported from original — faithful to the hardware feel
//  Nice. Dependable. Yours.
// ═══════════════════════════════════════════════════

import { T, chamfer } from '../common/tokens.js';
import { lightenHex, darkenHex, hexToRgba } from './theme-manager.js';

// ── Numpad dimensions ─────────────────────────────
const PAD = {
  displayH: 80,
  gap:      20,
  cardPad:  18,
  keyW:     110,
  keyH:     100,
  keyGap:   16,
};

// ── Internal key builder ──────────────────────────
// Pill-style: filled color, dark text, bottom shadow, thin chamfer
function _buildKey(opts) {
  const o      = opts || {};
  const bg     = o.bg     || T.green;
  const bgDk   = o.bgDk   || darkenHex(bg, 0.35);
  const textColor = o.textColor || T.well;
  const wrap = document.createElement('div');
  wrap.style.cssText = [
    `width:${o.w || PAD.keyW}px;`,
    `height:${o.h || PAD.keyH}px;`,
    `background:${bg};`,
    'border:none;',
    'border-radius:14px;',
    'display:flex;align-items:center;justify-content:center;',
    'cursor:pointer;user-select:none;',
    'pointer-events:auto;touch-action:manipulation;',
    'box-sizing:border-box;',
    `box-shadow:0 6px 0 ${bgDk}, inset 0 1px 0 rgba(255,255,255,0.2);`,
    'transition:transform 0.05s, box-shadow 0.05s;',
  ].join('');

  const label = document.createElement('div');
  label.style.cssText = [
    `font-family:${T.fh};`,
    `font-size:${o.fontSize || '44px'};`,
    `font-weight:${T.fwBold};`,
    `color:${textColor};`,
    'line-height:1;',
    'pointer-events:none;',
  ].join('');
  label.textContent = o.label || '';

  wrap.appendChild(label);

  // Keyboard accessibility — tab-reachable and Enter/Space activates
  wrap.setAttribute('tabindex', '0');
  wrap.setAttribute('role', 'button');
  if (o.ariaLabel) wrap.setAttribute('aria-label', o.ariaLabel);
  wrap.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      wrap.dispatchEvent(new Event('pointerdown', { bubbles: true }));
      wrap.dispatchEvent(new Event('pointerup',   { bubbles: true }));
    }
  });

  // Press state — pill sink
  wrap.addEventListener('pointerdown', () => {
    wrap.style.transform  = 'translateY(4px)';
    wrap.style.boxShadow  = `0 2px 0 ${bgDk}, inset 0 1px 0 rgba(255,255,255,0.1)`;
  });
  const _rel = () => {
    wrap.style.transform = '';
    wrap.style.boxShadow = `0 6px 0 ${bgDk}, inset 0 1px 0 rgba(255,255,255,0.2)`;
  };
  wrap.addEventListener('pointerup',     _rel);
  wrap.addEventListener('pointerleave',  _rel);
  wrap.addEventListener('pointercancel', _rel);

  return { wrap, label };
}

// ── Public builder ────────────────────────────────
export function buildNumpad(opts) {
  const o = opts || {};

  const maxDigits     = o.maxDigits     || 6;
  const masked        = o.masked        !== false;
  const onSubmit      = o.onSubmit      || function() {};
  const onChange      = o.onChange      || null;
  const displayFormat = o.displayFormat || null;
  const onCancel      = o.onCancel      || null;
  const submitLabel   = o.submitLabel   || '>>>';
  const canSubmit     = o.canSubmit     || function(p) { return p.length > 0; };
  const maskChar      = o.maskChar      || '\u25C6';

  // Color overrides
  const digitColor   = o.digitColor   || T.green;
  const clearColor   = o.clearColor   || T.verm;
  const submitColor  = o.submitColor  || T.greenWarm;
  const displayColor = o.displayColor || T.green;
  const chassisColor = o.chassisColor || T.well;
  const chassisLight = lightenHex(T.bg, 0.08);
  const chassisDark  = darkenHex(T.bg, 0.2);

  const keyW = o.keyW || PAD.keyW;
  const keyH = o.keyH || PAD.keyH;
  const keyGap  = o.keyGap  != null ? o.keyGap  : PAD.keyGap;
  const cardPad = o.cardPad != null ? o.cardPad : PAD.cardPad;
  const bevel   = 5;
  const cardH   = keyH * 4 + keyGap * 3 + cardPad * 2 + bevel * 2;

  let pin = '';
  let _submitCooldown = false;

  // ── Container ──────────────────────────────────
  const container = document.createElement('div');
  container.style.cssText = [
    'display:flex;flex-direction:column;',
    `gap:${o.gap != null ? o.gap : PAD.gap}px;`,
    'position:relative;',
    `width:${o.width || (keyW * 3 + keyGap * 2 + cardPad * 2 + bevel * 2)}px;`,
  ].join('');

  // ── Cancel button ───────────────────────────────
  if (onCancel) {
    const xBtn = document.createElement('div');
    xBtn.style.cssText = [
      'position:absolute;top:-18px;right:-18px;z-index:10;',
      'width:42px;height:42px;',
      `background:${T.well};`,
      `border:2px solid ${T.verm};`,
      `color:${T.verm};`,
      `font-family:${T.fb};font-size:20px;font-weight:${T.fwBold};`,
      'display:flex;align-items:center;justify-content:center;',
      'cursor:pointer;',
      `clip-path:${chamfer(6)};`,
    ].join('');
    xBtn.textContent = 'X';
    xBtn.addEventListener('pointerup', () => { onCancel(); });
    container.appendChild(xBtn);
  }

  // ── Display ─────────────────────────────────────
  const displayH = o.displayH || PAD.displayH;
  const displayWrap = document.createElement('div');
  displayWrap.style.cssText = [
    `width:100%;height:${displayH}px;`,
    'filter:drop-shadow(3px 4px 0px rgba(0,0,0,0.55));',
  ].join('');

  const display = document.createElement('div');
  display.style.cssText = `${[
    'width:100%;height:100%;box-sizing:border-box;',
    `background:${T.well};`,
    'display:flex;align-items:center;justify-content:center;',
    `font-family:${T.fb};`,
    'font-size:32px;',
    `color:${displayColor};`,
    'letter-spacing:10px;',
    `border-top:${bevel}px solid ${chassisColor};`,
    `border-left:${bevel}px solid ${chassisColor};`,
    `border-bottom:${bevel}px solid ${chassisColor};`,
    `border-right:${bevel}px solid ${chassisColor};`,
    'border-radius:14px;',
  ].join('')};font-weight:${T.fwBold};`;

  displayWrap.appendChild(display);
  container.appendChild(displayWrap);

  // ── Chassis ─────────────────────────────────────
  const cardWrap = document.createElement('div');
  cardWrap.style.cssText = [
    `width:100%;height:${cardH}px;`,
    `filter:drop-shadow(3px 4px 0px rgba(0,0,0,0.6)) drop-shadow(0 0 16px ${hexToRgba(chassisColor, 0.2)});`,
  ].join('');
  cardWrap.style.maxHeight = '85vh';
  cardWrap.style.overflowY = 'auto';

  const card = document.createElement('div');
  card.style.cssText = [
    'width:100%;height:100%;',
    `padding:${cardPad}px;`,
    'display:grid;',
    `grid-template-columns:repeat(3,${keyW}px);`,
    `grid-template-rows:repeat(4,${keyH}px);`,
    `gap:${keyGap}px;`,
    'box-sizing:border-box;',
    `background:${chassisColor};`,
    `border-top:${bevel}px solid ${chassisLight};`,
    `border-left:${bevel}px solid ${chassisLight};`,
    `border-bottom:${bevel}px solid ${chassisDark};`,
    `border-right:${bevel}px solid ${chassisDark};`,
    'border-radius:18px;',
  ].join('');

  cardWrap.appendChild(card);
  container.appendChild(cardWrap);

  // ── Keys ────────────────────────────────────────
  const layout = [
    { label: '1',         type: 'digit'  },
    { label: '2',         type: 'digit'  },
    { label: '3',         type: 'digit'  },
    { label: '4',         type: 'digit'  },
    { label: '5',         type: 'digit'  },
    { label: '6',         type: 'digit'  },
    { label: '7',         type: 'digit'  },
    { label: '8',         type: 'digit'  },
    { label: '9',         type: 'digit'  },
    { label: 'clr',       type: 'clear'  },
    { label: '0',         type: 'digit'  },
    { label: submitLabel, type: 'submit' },
  ];

  layout.forEach((key) => {
    let keyBg, keyBgDk, textColor, fontSize;
    if (key.type === 'clear') {
      keyBg = T.verm; keyBgDk = T.vermDk;
      textColor = T.well; fontSize = '38px';
    } else if (key.type === 'submit') {
      keyBg = T.greenWarm; keyBgDk = T.greenWarmDk;
      textColor = T.well; fontSize = '32px';
    } else {
      keyBg = T.green; keyBgDk = darkenHex(T.green, 0.35);
      textColor = T.well; fontSize = '44px';
    }

    const pair = _buildKey({ label: key.label, bg: keyBg, bgDk: keyBgDk, textColor, fontSize, w: keyW, h: keyH });

    if (key.type === 'clear') {
      let _clrTimer = null;
      let _clrFired = false;
      pair.wrap.addEventListener('pointerdown', () => {
        _clrFired = false;
        _clrTimer = setTimeout(() => {
          _clrFired = true;
          pin = '';
          _render();
          if (onChange) onChange(pin);
        }, 500);
      });
      pair.wrap.addEventListener('pointerup', () => {
        if (_clrTimer) { clearTimeout(_clrTimer); _clrTimer = null; }
        if (!_clrFired) {
          if (pin.length > 0) {
            pin = pin.slice(0, -1);
            _render();
            if (onChange) onChange(pin);
          }
        }
      });
      pair.wrap.addEventListener('pointercancel', () => {
        if (_clrTimer) { clearTimeout(_clrTimer); _clrTimer = null; }
      });
    } else {
      pair.wrap.addEventListener('pointerup', () => {
        if (key.type === 'digit') {
          if (pin.length < maxDigits) {
            container._clearHint();
            pin += key.label;
            _render();
            if (onChange) onChange(pin);
          }
        } else if (key.type === 'submit') {
          if (canSubmit(pin) && !_submitCooldown) {
            _submitCooldown = true;
            setTimeout(() => { _submitCooldown = false; }, 200);
            onSubmit(pin);
          }
        }
      });
    }

    card.appendChild(pair.wrap);
  });

  // ── Render ──────────────────────────────────────
  function _render() {
    if (displayFormat) {
      display.textContent = displayFormat(pin);
    } else if (masked) {
      display.textContent = pin.split('').map(() => maskChar).join(' ');
    } else {
      display.textContent = pin;
    }
  }

  // ── Public API ──────────────────────────────────
  container.clear   = () => { pin = ''; _render(); };
  container.getPin  = () => pin;
  container.setPin  = (d) => { pin = d || ''; _render(); };

  container.setError = (msg) => {
    display.textContent = msg || '';
    display.style.color = T.verm;
    setTimeout(() => {
      display.style.color = displayColor;
      pin = ''; _render();
    }, 1200);
  };

  let _hintActive = false;
  container.setHint = (msg, color) => {
    display.textContent = msg || '';
    display.style.color = color || T.green;
    _hintActive = true;
  };
  container._clearHint = () => {
    if (_hintActive) {
      _hintActive = false;
      display.style.color = displayColor;
      _render();
    }
  };

  _render();
  return container;
}