// Tests for terminal/theme-manager.js — buildPillButton, buildNumpadChassis, buildPinRow.
// Runs in jsdom; no real hardware or network needed.

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../common/tokens.js', () => ({
  T: {
    green:       '#86efac',
    greenDk:     '#4ade80',
    greenWarm:   '#86efac',
    greenWarmDk: '#4ade80',
    verm:        '#e8472a',
    vermDk:      '#c03d22',
    elec:        '#00e5ff',
    elecDk:      '#00b3cc',
    text:        '#dddddd',
    well:        '#22252a',
    bg:          '#383c42',
    card:        '#2d3139',
    border:      '#4a4f57',
    moon:        '#8090a0',
    fb:          'sans-serif',
    fh:          'serif',
    fwBold:      '700',
    pillRadius:  '8px',
    fsB1:        16,
    fsB2:        14,
    fsH3:        24,
    fsH4:        26,
    transitionFast: '0.1s ease',
    transitionMed:  '0.2s ease',
    chamferKey:  6,
    chamferPin:  4,
  },
  chamfer: (n) => 'polygon(' + n + 'px)',
}));

vi.mock('../common/theme.js', () => ({
  lightenHex:      (c) => c,
  darkenHex:       (c) => c,
  hexToRgba:       (c) => c,
  buildCard:       () => ({ wrap: document.createElement('div'), card: document.createElement('div') }),
  buildStaticCard: () => { const el = document.createElement('div'); el.setAccent = vi.fn(); return el; },
  buildNavCard:    () => document.createElement('div'),
  buildActionCard: () => { const el = document.createElement('div'); el.setAccent = vi.fn(); return el; },
  buildWell:       () => document.createElement('div'),
  buildSectionLabel: () => document.createElement('div'),
  buildHeroNumber:   () => document.createElement('div'),
  buildDataRow:      () => document.createElement('div'),
  buildDivider:      () => document.createElement('div'),
}));

import {
  buildPillButton, buildNumpadChassis, buildPinRow, buildPinBox,
} from './theme-manager.js';

// jsdom normalises hex colours to rgb() when reading el.style.background
function rgb(hex) {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgb(${r}, ${g}, ${b})`;
}

function tap(el) {
  el.dispatchEvent(new Event('pointerdown', { bubbles: true }));
  el.dispatchEvent(new Event('pointerup',   { bubbles: true }));
}

// ── buildPillButton ───────────────────────────────────────────────────────────

describe('buildPillButton — element creation', () => {
  it('returns a <button> element', () => {
    const btn = buildPillButton({});
    expect(btn.tagName).toBe('BUTTON');
  });

  it('sets textContent from label option', () => {
    const btn = buildPillButton({ label: 'SAVE' });
    expect(btn.textContent).toBe('SAVE');
  });

  it('default variant uses T.green as background', () => {
    const btn = buildPillButton({});
    expect(btn.style.background).toBe(rgb('#86efac'));
  });
});

describe('buildPillButton — variant mapping', () => {
  it('verm variant sets T.verm background', () => {
    const btn = buildPillButton({ variant: 'verm' });
    expect(btn.style.background).toBe(rgb('#e8472a'));
  });

  it('elec variant sets T.elec background', () => {
    const btn = buildPillButton({ variant: 'elec' });
    expect(btn.style.background).toBe(rgb('#00e5ff'));
  });

  it('goGreen variant sets T.greenWarm background', () => {
    const btn = buildPillButton({ variant: 'goGreen' });
    expect(btn.style.background).toBe(rgb('#86efac'));
  });

  it('ghost variant sets transparent background', () => {
    const btn = buildPillButton({ variant: 'ghost' });
    expect(btn.style.background).toBe('transparent');
  });
});

describe('buildPillButton — setDisabled', () => {
  it('setDisabled(true) sets opacity to 0.4', () => {
    const btn = buildPillButton({});
    btn.setDisabled(true);
    expect(btn.style.opacity).toBe('0.4');
  });

  it('setDisabled(true) sets pointerEvents to none', () => {
    const btn = buildPillButton({});
    btn.setDisabled(true);
    expect(btn.style.pointerEvents).toBe('none');
  });

  it('setDisabled(false) restores opacity to 1', () => {
    const btn = buildPillButton({});
    btn.setDisabled(true);
    btn.setDisabled(false);
    expect(btn.style.opacity).toBe('1');
  });

  it('setDisabled(false) restores pointerEvents to auto', () => {
    const btn = buildPillButton({});
    btn.setDisabled(true);
    btn.setDisabled(false);
    expect(btn.style.pointerEvents).toBe('auto');
  });

  it('disabled:true option applies disabled state at construction', () => {
    const btn = buildPillButton({ disabled: true });
    expect(btn._disabled).toBe(true);
    expect(btn.style.opacity).toBe('0.4');
  });
});

describe('buildPillButton — onClick and disabled guard', () => {
  it('onClick fires on pointerup', () => {
    const onClick = vi.fn();
    const btn = buildPillButton({ onClick });
    tap(btn);
    expect(onClick).toHaveBeenCalledOnce();
  });

  it('onClick is blocked when button is disabled', () => {
    const onClick = vi.fn();
    const btn = buildPillButton({ onClick });
    btn.setDisabled(true);
    tap(btn);
    expect(onClick).not.toHaveBeenCalled();
  });
});

describe('buildPillButton — setColor', () => {
  it('setColor updates background and box-shadow', () => {
    const btn = buildPillButton({});
    btn.setColor('#ff0000', '#cc0000', '#ffffff');
    expect(btn.style.background).toBe(rgb('#ff0000'));
  });
});

// ── buildNumpadChassis ────────────────────────────────────────────────────────

describe('buildNumpadChassis', () => {
  it('returns a div containing 12 buttons (4 rows × 3 keys)', () => {
    const chassis = buildNumpadChassis({});
    expect(chassis.querySelectorAll('button')).toHaveLength(12);
  });

  it('onKey is called with the correct label on pointerup', () => {
    const onKey = vi.fn();
    const chassis = buildNumpadChassis({ onKey });
    const fiveBtn = [...chassis.querySelectorAll('button')].find(
      (b) => b.textContent === '5',
    );
    fiveBtn.dispatchEvent(new Event('pointerup', { bubbles: true }));
    expect(onKey).toHaveBeenCalledWith('5');
  });

  it('CLR and ENT keys are present', () => {
    const chassis = buildNumpadChassis({});
    const labels = [...chassis.querySelectorAll('button')].map((b) => b.textContent);
    expect(labels).toContain('CLR');
    expect(labels).toContain('ENT');
  });

  it('digits 0-9 are all present', () => {
    const chassis = buildNumpadChassis({});
    const labels = [...chassis.querySelectorAll('button')].map((b) => b.textContent);
    for (let d = 0; d <= 9; d++) {
      expect(labels).toContain(String(d));
    }
  });
});

// ── buildPinBox ───────────────────────────────────────────────────────────────

describe('buildPinBox', () => {
  it('returns { box, pip } — box is a div, pip is hidden by default', () => {
    const { box, pip } = buildPinBox();
    expect(box.tagName).toBe('DIV');
    expect(pip.style.display).toBe('none');
  });

  it('setFilled(true) shows the pip', () => {
    const { box, pip } = buildPinBox();
    box.setFilled(true);
    expect(pip.style.display).toBe('block');
  });

  it('setFilled(false) hides the pip', () => {
    const { box, pip } = buildPinBox();
    box.setFilled(true);
    box.setFilled(false);
    expect(pip.style.display).toBe('none');
  });
});

// ── buildPinRow ───────────────────────────────────────────────────────────────

describe('buildPinRow', () => {
  // boxes[i] = { box, pip } — pip is the filled indicator inside each box

  it('setCount(0) leaves all 4 boxes unfilled', () => {
    const { boxes, setCount } = buildPinRow();
    setCount(0);
    boxes.forEach((b) => expect(b.pip.style.display).toBe('none'));
  });

  it('setCount(2) fills the first 2 boxes and leaves the rest empty', () => {
    const { boxes, setCount } = buildPinRow();
    setCount(2);
    expect(boxes[0].pip.style.display).toBe('block');
    expect(boxes[1].pip.style.display).toBe('block');
    expect(boxes[2].pip.style.display).toBe('none');
    expect(boxes[3].pip.style.display).toBe('none');
  });

  it('setCount(4) fills all 4 boxes', () => {
    const { boxes, setCount } = buildPinRow();
    setCount(4);
    boxes.forEach((b) => expect(b.pip.style.display).toBe('block'));
  });
});
