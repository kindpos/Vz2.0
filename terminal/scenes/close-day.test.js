// Tests for the exported pure helper functions in terminal/scenes/close-day.js.
// No scene mounting or fetch mocking needed — the helpers are side-effect-free.

import { describe, it, expect, vi } from 'vitest';

// ── Mock every import so the scene definition side-effect is harmless ─────────

vi.mock('../scene-manager.js', () => ({
  SceneManager: { on: vi.fn(), off: vi.fn(), emit: vi.fn() },
  defineScene:  vi.fn(),
}));
vi.mock('../net.js', () => ({ fetchWithTimeout: vi.fn() }));
vi.mock('../../common/tokens.js', () => ({
  T: {
    text:      '#text',
    greenWarm: '#green',
    verm:      '#verm',
    lavender:  '#lav',
    warning:   '#warn',
    moon:      '#moon',
    gold:      '#gold',
    border:    '#border',
    bg:        '#bg',
    card:      '#card',
    well:      '#well',
    green:     '#green2',
    elec:      '#elec',
    fb:        'sans-serif',
    fh:        'serif',
    fsB2:      14,
    fsB3:      12,
    fsB4:      10,
    fwBold:    '700',
    pillRadius: '8px',
  },
}));
vi.mock('../theme-manager.js', () => ({
  buildStaticCard:  () => { const el = document.createElement('div'); el.setAccent = vi.fn(); return el; },
  buildNavCard:     () => document.createElement('div'),
  buildActionCard:  () => { const el = document.createElement('div'); el.setAccent = vi.fn(); return el; },
  buildPillButton:  () => document.createElement('button'),
  buildSectionLabel: () => document.createElement('div'),
  hexToRgba:  (c) => c,
  darkenHex:  (c) => c,
  lightenHex: (c) => c,
}));
vi.mock('../components.js', () => ({ showToast: vi.fn() }));
vi.mock('./close-day-calc.js', () => ({
  computeCashExpected:  vi.fn(() => 0),
  computeCashVariance:  vi.fn(() => 0),
}));

import {
  fmt, fmtPct, deltaColor, checkNumDisplay,
  synthCheckLabel, formatTime, cashStatusLabel, cashStatusColor,
} from './close-day.js';

// ── fmt ───────────────────────────────────────────────────────────────────────

describe('fmt — dollar formatter', () => {
  it('formats a positive decimal', () => {
    expect(fmt(9.5)).toBe('$9.50');
  });

  it('formats zero', () => {
    expect(fmt(0)).toBe('$0.00');
  });

  it('uses unicode minus for negative values', () => {
    expect(fmt(-5)).toBe('−$5.00');
  });

  it('inserts thousands separator', () => {
    expect(fmt(1234.5)).toBe('$1,234.50');
  });

  it('treats null/undefined as 0', () => {
    expect(fmt(null)).toBe('$0.00');
    expect(fmt(undefined)).toBe('$0.00');
  });
});

// ── fmtPct ────────────────────────────────────────────────────────────────────

describe('fmtPct — percentage formatter', () => {
  it('returns em-dash for null', () => {
    expect(fmtPct(null)).toBe('—');
  });

  it('returns em-dash for non-finite (Infinity)', () => {
    expect(fmtPct(Infinity)).toBe('—');
  });

  it('returns middle-dot for zero', () => {
    expect(fmtPct(0)).toBe('· 0.0%');
  });

  it('shows up-arrow for positive delta', () => {
    expect(fmtPct(5.1)).toBe('▲ 5.1%');
  });

  it('shows down-arrow for negative delta', () => {
    expect(fmtPct(-3.2)).toBe('▼ 3.2%');
  });
});

// ── deltaColor ────────────────────────────────────────────────────────────────

describe('deltaColor — picks color by sign', () => {
  it('returns neutral text color for zero', () => {
    expect(deltaColor(0)).toBe('#text');
  });

  it('returns neutral text color for null', () => {
    expect(deltaColor(null)).toBe('#text');
  });

  it('returns green for positive delta', () => {
    expect(deltaColor(1)).toBe('#green');
  });

  it('returns verm for negative delta', () => {
    expect(deltaColor(-1)).toBe('#verm');
  });

  it('positive and negative return different colors', () => {
    expect(deltaColor(10)).not.toBe(deltaColor(-10));
  });
});

// ── checkNumDisplay ───────────────────────────────────────────────────────────

describe('checkNumDisplay — check label normalizer', () => {
  it('passes through labels that start with #', () => {
    expect(checkNumDisplay({ checkLabel: '#21' })).toBe('#21');
  });

  it('passes through labels that start with C (e.g. C-001)', () => {
    expect(checkNumDisplay({ checkLabel: 'C-001' })).toBe('C-001');
  });

  it('prepends # to bare numeric labels', () => {
    expect(checkNumDisplay({ checkLabel: '27' })).toBe('#27');
  });

  it('falls back to checkId when checkLabel absent', () => {
    expect(checkNumDisplay({ checkId: '42' })).toBe('#42');
  });

  it('returns empty string when neither field is present', () => {
    expect(checkNumDisplay({})).toBe('');
  });
});

// ── synthCheckLabel ───────────────────────────────────────────────────────────

describe('synthCheckLabel — synthesizes display label from order_id', () => {
  it('pads bare numbers to 3 digits', () => {
    expect(synthCheckLabel('27')).toBe('C-027');
  });

  it('strips leading zeros before padding', () => {
    expect(synthCheckLabel('0027')).toBe('C-027');
  });

  it('extracts trailing number from prefixed IDs', () => {
    expect(synthCheckLabel('order_27')).toBe('C-027');
  });

  it('uses last numeric group in compound IDs', () => {
    expect(synthCheckLabel('ord-abc-5')).toBe('C-005');
  });

  it('does not pad numbers longer than 3 digits', () => {
    expect(synthCheckLabel('1234')).toBe('C-1234');
  });

  it('falls back to uppercase first-3-chars when no digits', () => {
    expect(synthCheckLabel('abc-def')).toBe('C-ABC');
  });

  it('returns C-??? for empty/falsy input', () => {
    expect(synthCheckLabel('')).toBe('C-???');
    expect(synthCheckLabel(null)).toBe('C-???');
  });
});

// ── formatTime ────────────────────────────────────────────────────────────────

describe('formatTime — normalises time strings', () => {
  it('returns empty string for falsy input', () => {
    expect(formatTime('')).toBe('');
    expect(formatTime(null)).toBe('');
  });

  it('passes through pre-formatted strings like "7:23pm"', () => {
    expect(formatTime('7:23pm')).toBe('7:23pm');
  });

  it('passes through "20:23" (colon at position 2, no T marker)', () => {
    expect(formatTime('20:23')).toBe('20:23');
  });

  it('converts ISO-8601 to 12-hour local time', () => {
    // Build ISO string from a known local-time Date so the test is TZ-agnostic.
    const local = new Date(2026, 3, 19, 14, 23, 7); // 2:23pm local
    const iso   = local.toISOString();
    expect(formatTime(iso)).toBe('2:23pm');
  });

  it('returns invalid ISO strings unchanged', () => {
    expect(formatTime('not-a-date')).toBe('not-a-date');
  });
});

// ── cashStatusLabel / cashStatusColor ─────────────────────────────────────────

describe('cashStatusLabel', () => {
  it('returns PENDING when cashCounted is null', () => {
    expect(cashStatusLabel({ cashCounted: null })).toBe('PENDING');
  });

  it('returns DONE when cashCounted is a number', () => {
    expect(cashStatusLabel({ cashCounted: 150 })).toBe('DONE');
  });

  it('returns BYPASSED when cashCounted is "bypass"', () => {
    expect(cashStatusLabel({ cashCounted: 'bypass' })).toBe('BYPASSED');
  });
});

describe('cashStatusColor', () => {
  it('returns warning color when pending', () => {
    expect(cashStatusColor({ cashCounted: null })).toBe('#warn');
  });

  it('returns green when done', () => {
    expect(cashStatusColor({ cashCounted: 50 })).toBe('#green');
  });

  it('returns lavender when bypassed', () => {
    expect(cashStatusColor({ cashCounted: 'bypass' })).toBe('#lav');
  });
});
