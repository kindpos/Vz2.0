// Tests for terminal/keyboard.js — showKeyboard / hideKeyboard / isKeyboardVisible.
//
// keyboard.js uses module-level state (_root, _visible, _opts, _input).
// vi.resetModules() in beforeEach gives each test a clean slate.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../common/tokens.js', () => ({
  T: {
    green:  '#86efac', verm: '#e8472a', text: '#ddd', well: '#22252a',
    border: '#4a4f57', card: '#2d3139', fb: 'sans-serif', fh: 'serif',
    fwBold: '700', fsB2: 14, fsB1: 16, pillRadius: '8px',
    transitionFast: '0.1s ease',
  },
}));

vi.mock('./theme-manager.js', () => ({
  buildStaticCard: () => {
    const el = document.createElement('div');
    el.setAccent = vi.fn();
    return el;
  },
  buildPillButton: ({ label, onClick } = {}) => {
    const btn = document.createElement('button');
    btn.textContent = label || '';
    if (onClick) btn.addEventListener('pointerup', onClick);
    return btn;
  },
}));

// Re-import fresh module before every test to reset module-level state.
let showKeyboard, hideKeyboard, isKeyboardVisible;

beforeEach(async () => {
  vi.resetModules();
  document.body.innerHTML = '';
  const mod = await import('./keyboard.js');
  showKeyboard     = mod.showKeyboard;
  hideKeyboard     = mod.hideKeyboard;
  isKeyboardVisible = mod.isKeyboardVisible;
});

afterEach(() => {
  document.body.innerHTML = '';
});

// ── Visibility state ──────────────────────────────────────────────────────────

describe('keyboard — visibility', () => {
  it('isKeyboardVisible() is false before any call', () => {
    expect(isKeyboardVisible()).toBe(false);
  });

  it('isKeyboardVisible() is true after showKeyboard()', () => {
    showKeyboard({});
    expect(isKeyboardVisible()).toBe(true);
  });

  it('isKeyboardVisible() is false after hideKeyboard()', () => {
    showKeyboard({});
    hideKeyboard();
    expect(isKeyboardVisible()).toBe(false);
  });

  it('hideKeyboard() is a no-op when the keyboard is already hidden', () => {
    expect(() => hideKeyboard()).not.toThrow();
    expect(isKeyboardVisible()).toBe(false);
  });
});

// ── DOM presence ──────────────────────────────────────────────────────────────

describe('keyboard — DOM attachment', () => {
  it('showKeyboard() appends the modal to document.body', () => {
    showKeyboard({});
    expect(document.body.children.length).toBeGreaterThan(0);
  });

  it('hideKeyboard() removes the modal from document.body', () => {
    showKeyboard({});
    hideKeyboard();
    expect(document.body.children.length).toBe(0);
  });

  it('second showKeyboard() call reuses the same root element', () => {
    showKeyboard({});
    const first = document.body.firstElementChild;
    hideKeyboard();
    showKeyboard({});
    const second = document.body.firstElementChild;
    expect(first).toBe(second);
  });
});

// ── Input initialisation ──────────────────────────────────────────────────────

describe('keyboard — input options', () => {
  it('sets the input value from initialValue', () => {
    showKeyboard({ initialValue: 'hello' });
    const input = document.body.querySelector('input');
    expect(input.value).toBe('hello');
  });

  it('clears the input value between calls (no carry-over)', () => {
    showKeyboard({ initialValue: 'first' });
    hideKeyboard();
    showKeyboard({});
    const input = document.body.querySelector('input');
    expect(input.value).toBe('');
  });

  it('sets maxLength when provided', () => {
    showKeyboard({ maxLength: 8 });
    const input = document.body.querySelector('input');
    expect(input.maxLength).toBe(8);
  });

  it('sets placeholder text', () => {
    showKeyboard({ placeholder: 'Type here' });
    const input = document.body.querySelector('input');
    expect(input.placeholder).toBe('Type here');
  });
});

// ── DONE button ───────────────────────────────────────────────────────────────

describe('keyboard — DONE callback', () => {
  it('onDone fires with the current input value when DONE is tapped', () => {
    const onDone = vi.fn();
    showKeyboard({ onDone });

    const input = document.body.querySelector('input');
    input.value = 'test value';

    const doneBtn = [...document.body.querySelectorAll('button')].find(
      (b) => b.textContent === 'DONE',
    );
    doneBtn.dispatchEvent(new Event('pointerup', { bubbles: true }));

    expect(onDone).toHaveBeenCalledWith('test value');
  });

  it('keyboard hides after DONE is tapped (dismissOnDone default)', () => {
    showKeyboard({ onDone: vi.fn() });
    const doneBtn = [...document.body.querySelectorAll('button')].find(
      (b) => b.textContent === 'DONE',
    );
    doneBtn.dispatchEvent(new Event('pointerup', { bubbles: true }));
    expect(isKeyboardVisible()).toBe(false);
  });

  it('keyboard stays visible when dismissOnDone:false', () => {
    showKeyboard({ onDone: vi.fn(), dismissOnDone: false });
    const doneBtn = [...document.body.querySelectorAll('button')].find(
      (b) => b.textContent === 'DONE',
    );
    doneBtn.dispatchEvent(new Event('pointerup', { bubbles: true }));
    expect(isKeyboardVisible()).toBe(true);
  });

  it('pressing Enter in the input fires onDone', () => {
    const onDone = vi.fn();
    showKeyboard({ onDone });

    const input = document.body.querySelector('input');
    input.value = 'enter test';
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));

    expect(onDone).toHaveBeenCalledWith('enter test');
  });
});

// ── CANCEL / dismiss ──────────────────────────────────────────────────────────

describe('keyboard — CANCEL and dismiss', () => {
  it('CANCEL button triggers onDismiss and hides the keyboard', () => {
    const onDismiss = vi.fn();
    showKeyboard({ onDismiss });

    const cancelBtn = [...document.body.querySelectorAll('button')].find(
      (b) => b.textContent === 'CANCEL',
    );
    cancelBtn.dispatchEvent(new Event('pointerup', { bubbles: true }));

    expect(onDismiss).toHaveBeenCalled();
    expect(isKeyboardVisible()).toBe(false);
  });

  it('Escape key triggers onDismiss and hides the keyboard', () => {
    const onDismiss = vi.fn();
    showKeyboard({ onDismiss });

    const input = document.body.querySelector('input');
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));

    expect(onDismiss).toHaveBeenCalled();
    expect(isKeyboardVisible()).toBe(false);
  });

  it('backdrop tap (pointerup directly on root) triggers onDismiss', () => {
    const onDismiss = vi.fn();
    showKeyboard({ onDismiss });

    const root = document.body.firstElementChild;
    const evt = new Event('pointerup', { bubbles: false });
    Object.defineProperty(evt, 'target', { value: root, configurable: true });
    root.dispatchEvent(evt);

    expect(onDismiss).toHaveBeenCalled();
    expect(isKeyboardVisible()).toBe(false);
  });
});
