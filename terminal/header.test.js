// Tests for the exported pure helpers in terminal/header.js.
// buildHeader itself is not tested here — it mounts a live DOM ticker.
// greetingFor, fmtTime, and fmtDate are pure and fully covered below.

import { describe, it, expect, vi } from 'vitest';

vi.mock('../common/tokens.js', () => ({
  T: {
    green: '#86efac', verm: '#e8472a', text: '#ddd', well: '#22252a',
    border: '#4a4f57', card: '#2d3139', fb: 'sans-serif', fh: 'serif',
    fwBold: '700', fsB2: 14, pillRadius: '8px',
    transitionFast: '0.1s ease',
  },
}));
vi.mock('./theme-manager.js', () => ({
  buildPillButton: ({ label, onClick } = {}) => {
    const btn = document.createElement('button');
    btn.textContent = label || '';
    if (onClick) btn.addEventListener('pointerup', onClick);
    return btn;
  },
}));
vi.mock('./net.js',         () => ({ fetchWithTimeout: vi.fn() }));
vi.mock('./auth-client.js', () => ({ getToken: vi.fn(() => null), clearToken: vi.fn() }));

import { greetingFor, fmtTime, fmtDate } from './header.js';

// ── greetingFor ───────────────────────────────────────────────────────────────

describe('greetingFor', () => {
  it('returns Good Evening before 5am (h=4)', () => {
    expect(greetingFor(4)).toBe('Good Evening');
  });

  it('returns Good Morning at exactly 5am', () => {
    expect(greetingFor(5)).toBe('Good Morning');
  });

  it('returns Good Morning at 11am (just before noon)', () => {
    expect(greetingFor(11)).toBe('Good Morning');
  });

  it('returns Good Afternoon at exactly noon (h=12)', () => {
    expect(greetingFor(12)).toBe('Good Afternoon');
  });

  it('returns Good Afternoon at 4pm (h=16)', () => {
    expect(greetingFor(16)).toBe('Good Afternoon');
  });

  it('returns Good Evening at exactly 5pm (h=17)', () => {
    expect(greetingFor(17)).toBe('Good Evening');
  });

  it('returns Good Evening at midnight (h=0)', () => {
    expect(greetingFor(0)).toBe('Good Evening');
  });

  it('returns Good Evening at 11pm (h=23)', () => {
    expect(greetingFor(23)).toBe('Good Evening');
  });
});

// ── fmtTime ───────────────────────────────────────────────────────────────────

describe('fmtTime', () => {
  function dt(h, m) {
    const d = new Date(2026, 0, 1, h, m, 0);
    return d;
  }

  it('formats midnight as 12:00 AM', () => {
    expect(fmtTime(dt(0, 0))).toBe('12:00 AM');
  });

  it('formats 12:00 as 12:00 PM (noon)', () => {
    expect(fmtTime(dt(12, 0))).toBe('12:00 PM');
  });

  it('formats 13:00 as 1:00 PM', () => {
    expect(fmtTime(dt(13, 0))).toBe('1:00 PM');
  });

  it('formats 23:59 as 11:59 PM', () => {
    expect(fmtTime(dt(23, 59))).toBe('11:59 PM');
  });

  it('pads single-digit minutes with a leading zero', () => {
    expect(fmtTime(dt(9, 5))).toBe('9:05 AM');
  });

  it('formats 1:00 AM correctly', () => {
    expect(fmtTime(dt(1, 0))).toBe('1:00 AM');
  });
});

// ── fmtDate ───────────────────────────────────────────────────────────────────

describe('fmtDate', () => {
  it('formats Thursday January 1 2026', () => {
    // Jan 1, 2026 is a Thursday
    expect(fmtDate(new Date(2026, 0, 1))).toBe('THU · JAN 1');
  });

  it('formats Sunday December 27 2026', () => {
    // Dec 27, 2026 is a Sunday
    expect(fmtDate(new Date(2026, 11, 27))).toBe('SUN · DEC 27');
  });

  it('formats Wednesday April 1 2026', () => {
    // April 1, 2026 is a Wednesday
    expect(fmtDate(new Date(2026, 3, 1))).toBe('WED · APR 1');
  });

  it('includes the numeric date in the output', () => {
    const d = new Date(2026, 5, 15); // June 15
    expect(fmtDate(d)).toContain('15');
  });
});
