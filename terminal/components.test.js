// Tests for terminal/components.js — showToast and buildRoleButton.
// Runs in jsdom; no real hardware or network needed.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../common/tokens.js', () => ({
  T: {
    verm:    '#e8472a',
    text:    '#dddddd',
    well:    '#22252a',
    card:    '#2d3139',
    fb:      'sans-serif',
    fh:      'serif',
    fwBold:  '700',
    fsB2:    14,
    fsH3:    24,
    transitionFast: '0.1s ease',
  },
}));

vi.mock('./theme-manager.js', () => ({
  lightenHex: (c) => c,
  hexToRgba:  (c) => c,
}));

import { showToast, buildRoleButton } from './components.js';

function rgb(hex) {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgb(${r}, ${g}, ${b})`;
}

// ── showToast ─────────────────────────────────────────────────────────────────

describe('showToast', () => {
  afterEach(() => {
    // Clean up any toasts appended to body
    document.body.innerHTML = '';
  });

  it('appends a div to document.body', () => {
    showToast('Hello world');
    expect(document.body.children.length).toBe(1);
  });

  it('sets the toast textContent to the message', () => {
    showToast('Test message');
    const toast = document.body.firstElementChild;
    expect(toast.textContent).toBe('Test message');
  });

  it('removes the toast after duration + fade (fake timers)', () => {
    vi.useFakeTimers();
    showToast('Bye', { duration: 100 });
    vi.advanceTimersByTime(100 + 250);
    expect(document.body.children.length).toBe(0);
    vi.useRealTimers();
  });

  it('applies a custom bg color to the toast style', () => {
    showToast('Notice', { bg: '#123456' });
    const toast = document.body.firstElementChild;
    expect(toast.style.background).toBe(rgb('#123456'));
  });

  it('uses T.verm as the default background', () => {
    showToast('Error');
    const toast = document.body.firstElementChild;
    expect(toast.style.background).toBe(rgb('#e8472a'));
  });
});

// ── buildRoleButton ───────────────────────────────────────────────────────────

describe('buildRoleButton', () => {
  it('returns a div (not a button)', () => {
    const wrap = buildRoleButton('Server', '#38bdf8', vi.fn());
    expect(wrap.tagName).toBe('DIV');
  });

  it('textContent is the uppercased role name', () => {
    const wrap = buildRoleButton('manager', '#38bdf8', vi.fn());
    expect(wrap.textContent).toBe('MANAGER');
  });

  it('_roleName reflects the roleName argument', () => {
    const wrap = buildRoleButton('Bartender', '#f59e0b', vi.fn());
    expect(wrap._roleName).toBe('Bartender');
  });

  it('_selected starts as false', () => {
    const wrap = buildRoleButton('Cook', '#f472b6', vi.fn());
    expect(wrap._selected).toBe(false);
  });

  it('onSelect is called with roleName on pointerup', () => {
    const onSelect = vi.fn();
    const wrap = buildRoleButton('Server', '#38bdf8', onSelect);
    wrap.dispatchEvent(new Event('pointerup', { bubbles: true }));
    expect(onSelect).toHaveBeenCalledWith('Server');
  });

  it('_resetVisual can be called without error in default (unselected) state', () => {
    const wrap = buildRoleButton('Host', '#34d399', vi.fn());
    expect(() => wrap._resetVisual()).not.toThrow();
  });

  it('_resetVisual applies selected styles when _selected is true', () => {
    const wrap = buildRoleButton('Manager', '#e8472a', vi.fn());
    wrap._selected = true;
    wrap._resetVisual();
    expect(wrap.style.background).toBe(rgb('#e8472a')); // roleColor
  });

  it('_resetVisual applies default card background when unselected', () => {
    const wrap = buildRoleButton('Server', '#38bdf8', vi.fn());
    wrap._selected = false;
    wrap._resetVisual();
    expect(wrap.style.background).toBe(rgb('#2d3139')); // T.card
  });
});
