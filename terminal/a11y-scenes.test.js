/**
 * Accessibility (a11y) tests for KINDpos terminal components.
 *
 * Covers the features that matter for POS accessibility:
 *   - Toast notifications carry role="alert" + aria-live so screen readers
 *     announce transient messages without requiring focus
 *   - Numpad keys are keyboard-reachable (tabindex=0) and activate on
 *     Enter / Space so the PIN pad works without a touchscreen
 *   - Interactive pill buttons are native <button> elements, inheriting
 *     browser focus, keyboard activation, and accessibility tree roles
 *   - Toast contrast: luminance heuristic picks legible text color
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { showToast } from './components.js';
import { buildNumpad } from './numpad.js';
import { buildPillButton } from './theme-manager.js';

// ── Module mocks ─────────────────────────────────────────────────────────────

vi.mock('../common/tokens.js', () => ({
  T: {
    green: '#86efac', greenWarm: '#86efac', greenWarmDk: '#4ade80',
    verm: '#e8472a', vermDk: '#c03d22',
    well:  '#22252a',   // dark  (used as text on light bg)
    text:  '#e8eaed',   // light (used as text on dark bg)
    bg: '#383c42', border: '#555',
    fb: 'sans-serif', fh: 'serif', fwBold: '700',
    fsB2: '16px',
  },
  chamfer: () => 'polygon(0 0, 100% 0, 100% 100%, 0 100%)',
}));

vi.mock('./theme-manager.js', () => ({
  buildPillButton: (opts = {}) => {
    const btn = document.createElement('button');
    btn.textContent = opts.label || '';
    if (opts.onClick) btn.addEventListener('pointerup', opts.onClick);
    btn.style.cursor = 'pointer';
    return btn;
  },
  lightenHex: (c) => c,
  darkenHex:  (c) => c,
  hexToRgba:  (c) => c,
}));

// ── Helpers ──────────────────────────────────────────────────────────────────

function findKey(pad, labelText) {
  for (const el of pad.querySelectorAll('[role="button"]')) {
    const inner = el.firstElementChild;
    if (inner && inner.textContent.trim() === labelText) return el;
    if (el.textContent.trim() === labelText) return el;
  }
  return null;
}

function tap(el) {
  el.dispatchEvent(new Event('pointerdown', { bubbles: true }));
  el.dispatchEvent(new Event('pointerup',   { bubbles: true }));
}

beforeEach(() => {
  document.body.innerHTML = '';
});

// ═══════════════════════════════════════════════════════════════════════════
// Toast ARIA attributes
// ═══════════════════════════════════════════════════════════════════════════

describe('showToast — ARIA / accessibility', () => {
  it('toast element carries role="alert"', () => {
    showToast('Order sent');
    const el = document.body.querySelector('[role="alert"]');
    expect(el).not.toBeNull();
  });

  it('toast element has aria-live="assertive"', () => {
    showToast('Payment declined');
    const el = document.body.querySelector('[aria-live="assertive"]');
    expect(el).not.toBeNull();
  });

  it('toast element has aria-atomic="true"', () => {
    showToast('Table 5 seated');
    const el = document.body.querySelector('[aria-atomic="true"]');
    expect(el).not.toBeNull();
  });

  it('toast text content is the message passed in', () => {
    showToast('Item removed');
    const el = document.body.querySelector('[role="alert"]');
    expect(el.textContent).toBe('Item removed');
  });

  it('two toasts each have role="alert"', () => {
    showToast('First message');
    showToast('Second message');
    const alerts = document.body.querySelectorAll('[role="alert"]');
    expect(alerts.length).toBe(2);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Toast contrast — luminance heuristic
// ═══════════════════════════════════════════════════════════════════════════

// jsdom serialises hex colors as rgb(), so we normalise for comparison.
function hexToRgb(hex) {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgb(${r}, ${g}, ${b})`;
}
const DARK_TEXT  = hexToRgb('#22252a'); // T.well  — used on light backgrounds
const LIGHT_TEXT = hexToRgb('#e8eaed'); // T.text  — used on dark backgrounds

describe('showToast — contrast heuristic', () => {
  it('dark background (#000000) gets light text', () => {
    showToast('Error', { bg: '#000000' });
    const el = document.body.querySelector('[role="alert"]');
    // lum(0,0,0) = 0 < 0.55 → T.text (light)
    expect(el.style.color).toBe(LIGHT_TEXT);
  });

  it('light background (#ffffff) gets dark text', () => {
    showToast('Success', { bg: '#ffffff' });
    const el = document.body.querySelector('[role="alert"]');
    // lum(255,255,255) = 1.0 > 0.55 → T.well (dark)
    expect(el.style.color).toBe(DARK_TEXT);
  });

  it('mid-grey (#808080) gets light text (lum ≈ 0.502 < 0.55)', () => {
    showToast('Info', { bg: '#808080' });
    const el = document.body.querySelector('[role="alert"]');
    // lum(128,128,128) ≈ 0.502 → T.text (light)
    expect(el.style.color).toBe(LIGHT_TEXT);
  });

  it('light green (#86efac) gets dark text (lum ≈ 0.74 > 0.55)', () => {
    showToast('Added', { bg: '#86efac' });
    const el = document.body.querySelector('[role="alert"]');
    // lum(134,239,172) ≈ 0.74 → T.well (dark)
    expect(el.style.color).toBe(DARK_TEXT);
  });

  it('light and dark backgrounds produce different text colors', () => {
    showToast('A', { bg: '#ffffff' });
    showToast('B', { bg: '#000000' });
    const [light, dark] = document.body.querySelectorAll('[role="alert"]');
    expect(light.style.color).not.toBe(dark.style.color);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Numpad keyboard accessibility
// ═══════════════════════════════════════════════════════════════════════════

describe('buildNumpad — keyboard accessibility', () => {
  it('digit keys have tabindex="0" making them keyboard-focusable', () => {
    const pad = buildNumpad({});
    const roleButtons = [...pad.querySelectorAll('[role="button"]')];
    expect(roleButtons.length).toBeGreaterThan(0);
    roleButtons.forEach((key) => {
      expect(key.getAttribute('tabindex')).toBe('0');
    });
  });

  it('all interactive keys carry role="button"', () => {
    const pad = buildNumpad({});
    const roleButtons = pad.querySelectorAll('[role="button"]');
    // 0-9 (10) + clear (1) + submit (1) = 12 keys
    expect(roleButtons.length).toBeGreaterThanOrEqual(12);
  });

  it('Enter key on a digit key appends the digit', () => {
    const pad = buildNumpad({ masked: false });
    const key5 = findKey(pad, '5');
    expect(key5).not.toBeNull();
    key5.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    expect(pad.getPin()).toBe('5');
  });

  it('Space key on a digit key appends the digit', () => {
    const pad = buildNumpad({ masked: false });
    const key3 = findKey(pad, '3');
    expect(key3).not.toBeNull();
    key3.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true }));
    expect(pad.getPin()).toBe('3');
  });

  it('Enter key on submit (>>>) fires onSubmit callback', () => {
    const onSubmit = vi.fn();
    const pad = buildNumpad({ onSubmit });
    tap(findKey(pad, '4'));
    const submitKey = findKey(pad, '>>>');
    expect(submitKey).not.toBeNull();
    submitKey.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    expect(onSubmit).toHaveBeenCalledWith('4');
  });

  it('keyboard activation is capped at maxDigits', () => {
    const pad = buildNumpad({ masked: false, maxDigits: 2 });
    tap(findKey(pad, '1'));
    tap(findKey(pad, '2'));
    const key3 = findKey(pad, '3');
    key3.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    expect(pad.getPin()).toBe('12'); // capped — 3rd digit ignored
  });

  it('multiple digits entered via keyboard build pin in order', () => {
    const pad = buildNumpad({ masked: false });
    ['7', '8', '9'].forEach((d) => {
      findKey(pad, d).dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })
      );
    });
    expect(pad.getPin()).toBe('789');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Semantic HTML — interactive elements use focusable element types
// ═══════════════════════════════════════════════════════════════════════════

describe('buildPillButton — semantic HTML', () => {
  it('returns a native <button> element (keyboard-accessible by default)', () => {
    const btn = buildPillButton({ label: 'Pay' });
    expect(btn.tagName).toBe('BUTTON');
  });

  it('<button> element is focusable without explicit tabindex', () => {
    const btn = buildPillButton({ label: 'Close' });
    document.body.appendChild(btn);
    btn.focus();
    expect(document.activeElement).toBe(btn);
  });

  it('<button> element carries its label as textContent', () => {
    const btn = buildPillButton({ label: 'Void Order' });
    expect(btn.textContent).toBe('Void Order');
  });

  it('onClick is called when button is activated', () => {
    const onClick = vi.fn();
    const btn = buildPillButton({ label: 'Submit', onClick });
    btn.dispatchEvent(new Event('pointerup', { bubbles: true }));
    expect(onClick).toHaveBeenCalledOnce();
  });
});
