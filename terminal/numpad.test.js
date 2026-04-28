// Tests for terminal/numpad.js — buildNumpad() public API and key interactions.
// Runs entirely in jsdom; no network or real hardware required.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { buildNumpad } from './numpad.js';

vi.mock('../common/tokens.js', () => ({
  T: {
    green: '#86efac', greenWarm: '#86efac', greenWarmDk: '#4ade80',
    verm: '#e8472a', vermDk: '#c03d22', well: '#22252a', bg: '#383c42',
    fb: 'sans-serif', fh: 'serif', fwBold: '700',
  },
  chamfer: () => 'polygon(0 0, 100% 0, 100% 100%, 0 100%)',
}));

vi.mock('./theme-manager.js', () => ({
  lightenHex: (c) => c,
  darkenHex:  (c) => c,
  hexToRgba:  (c) => c,
}));

// ── Helpers ──────────────────────────────────────────────────────────────────

function findKey(pad, labelText) {
  for (const div of pad.querySelectorAll('div')) {
    const child = div.firstElementChild;
    if (child && child.textContent === labelText && div.style.cursor === 'pointer') {
      return div;
    }
  }
  return null;
}

function tap(el) {
  el.dispatchEvent(new Event('pointerdown', { bubbles: true }));
  el.dispatchEvent(new Event('pointerup',   { bubbles: true }));
}

function tapDigits(pad, ...digits) {
  digits.forEach((d) => tap(findKey(pad, String(d))));
}

function getDisplay(pad) {
  // The display is the first div descendant with letter-spacing styling
  for (const el of pad.querySelectorAll('div')) {
    if (el.style.letterSpacing) return el;
  }
  return null;
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('buildNumpad — public API', () => {
  it('getPin() starts empty', () => {
    const pad = buildNumpad({});
    expect(pad.getPin()).toBe('');
  });

  it('pressing a digit appends to the pin', () => {
    const pad = buildNumpad({ masked: false });
    tap(findKey(pad, '5'));
    expect(pad.getPin()).toBe('5');
  });

  it('pressing multiple digits builds the pin in order', () => {
    const pad = buildNumpad({ masked: false });
    tapDigits(pad, 1, 2, 3);
    expect(pad.getPin()).toBe('123');
  });

  it('maxDigits caps input at the configured limit', () => {
    const pad = buildNumpad({ maxDigits: 3 });
    tapDigits(pad, 1, 2, 3, 4, 5);
    expect(pad.getPin()).toBe('123');
  });

  it('setPin() sets the internal pin and re-renders', () => {
    const pad = buildNumpad({ masked: false });
    pad.setPin('4321');
    expect(pad.getPin()).toBe('4321');
  });

  it('clear() empties the pin', () => {
    const pad = buildNumpad({});
    tapDigits(pad, 1, 2, 3);
    pad.clear();
    expect(pad.getPin()).toBe('');
  });
});

describe('buildNumpad — display rendering', () => {
  it('masked display shows diamond chars for each digit', () => {
    const pad = buildNumpad({ masked: true });
    tapDigits(pad, 1, 2, 3);
    const display = getDisplay(pad);
    expect(display.textContent).toBe('◆ ◆ ◆');
  });

  it('unmasked display shows the raw digits', () => {
    const pad = buildNumpad({ masked: false });
    tapDigits(pad, 4, 2);
    const display = getDisplay(pad);
    expect(display.textContent).toBe('42');
  });

  it('displayFormat callback overrides default rendering', () => {
    const format = (pin) => pin.replace(/./g, '*');
    const pad = buildNumpad({ masked: false, displayFormat: format });
    tapDigits(pad, 1, 2, 3);
    const display = getDisplay(pad);
    expect(display.textContent).toBe('***');
  });

  it('custom maskChar replaces the default diamond', () => {
    const pad = buildNumpad({ masked: true, maskChar: '#' });
    tapDigits(pad, 1, 2);
    const display = getDisplay(pad);
    expect(display.textContent).toBe('# #');
  });
});

describe('buildNumpad — submit behaviour', () => {
  it('onSubmit fires with the current pin', () => {
    const onSubmit = vi.fn();
    const pad = buildNumpad({ onSubmit });
    tapDigits(pad, 7, 8, 9);
    tap(findKey(pad, '>>>'));
    expect(onSubmit).toHaveBeenCalledWith('789');
  });

  it('onSubmit is blocked when canSubmit returns false', () => {
    const onSubmit = vi.fn();
    const pad = buildNumpad({ onSubmit, canSubmit: () => false });
    tapDigits(pad, 1);
    tap(findKey(pad, '>>>'));
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('submit is blocked when pin is empty (default canSubmit)', () => {
    const onSubmit = vi.fn();
    const pad = buildNumpad({ onSubmit });
    tap(findKey(pad, '>>>'));
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('custom submitLabel appears on the submit key', () => {
    const pad = buildNumpad({ submitLabel: 'GO' });
    expect(findKey(pad, 'GO')).not.toBeNull();
  });
});

describe('buildNumpad — clear key behaviour', () => {
  it('short press removes the last digit', () => {
    const pad = buildNumpad({});
    tapDigits(pad, 1, 2, 3);
    tap(findKey(pad, 'clr'));
    expect(pad.getPin()).toBe('12');
  });

  it('short press on empty pin does nothing', () => {
    const pad = buildNumpad({});
    tap(findKey(pad, 'clr'));
    expect(pad.getPin()).toBe('');
  });

  it('long press (500ms) clears the entire pin', () => {
    vi.useFakeTimers();
    const pad = buildNumpad({});
    tapDigits(pad, 1, 2, 3, 4);

    const clr = findKey(pad, 'clr');
    clr.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    vi.advanceTimersByTime(500);
    clr.dispatchEvent(new Event('pointerup', { bubbles: true }));

    expect(pad.getPin()).toBe('');
    vi.useRealTimers();
  });
});

describe('buildNumpad — onChange callback', () => {
  it('onChange fires on every digit press with updated pin', () => {
    const onChange = vi.fn();
    const pad = buildNumpad({ onChange });
    tapDigits(pad, 1, 2);
    expect(onChange).toHaveBeenNthCalledWith(1, '1');
    expect(onChange).toHaveBeenNthCalledWith(2, '12');
  });

  it('onChange fires on clear with the remaining pin', () => {
    const onChange = vi.fn();
    const pad = buildNumpad({ onChange });
    tapDigits(pad, 5, 6);
    onChange.mockClear();
    tap(findKey(pad, 'clr'));
    expect(onChange).toHaveBeenCalledWith('5');
  });
});

describe('buildNumpad — setError and setHint', () => {
  it('setError shows a message and resets after 1200ms', () => {
    vi.useFakeTimers();
    const pad = buildNumpad({});
    tapDigits(pad, 1, 2, 3);
    const display = getDisplay(pad);

    pad.setError('Wrong PIN');
    expect(display.textContent).toBe('Wrong PIN');

    vi.advanceTimersByTime(1200);
    expect(pad.getPin()).toBe('');
    vi.useRealTimers();
  });

  it('setHint shows hint text; next digit press clears it', () => {
    const pad = buildNumpad({ masked: false });
    const display = getDisplay(pad);

    pad.setHint('Enter code');
    expect(display.textContent).toBe('Enter code');

    tap(findKey(pad, '9'));
    expect(display.textContent).toBe('9');
  });

  it('onCancel button fires the callback when provided', () => {
    const onCancel = vi.fn();
    const pad = buildNumpad({ onCancel });
    const xBtn = [...pad.querySelectorAll('div')].find(
      (el) => el.textContent === 'X' && el.style.cursor === 'pointer',
    );
    expect(xBtn).toBeDefined();
    xBtn.dispatchEvent(new Event('pointerup', { bubbles: true }));
    expect(onCancel).toHaveBeenCalled();
  });
});
