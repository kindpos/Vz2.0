// Tests for terminal/charts.js — pure math helpers and buildStatCard API.
//
// _normalize, _linePath, _areaPath are pure functions (no DOM, no tokens).
// buildStatCard tests verify the returned control API (setValue, setDelta, setState).

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../common/tokens.js', () => ({
  T: {
    green: '#86efac', gold: '#f59e0b', verm: '#e8472a',
    lavender: '#c4b5fd', elec: '#00e5ff', greenWarm: '#86efac',
    text: '#ddd', well: '#22252a', card: '#2d3139', border: '#4a4f57',
    positive: '#86efac', warning: '#f59e0b',
    fb: 'sans-serif', fh: 'serif', fwBold: '700',
    fsB2: '14px', fsB3: '13px', fsB4: '12px', fsH3: '20px',
  },
}));

vi.mock('./theme-manager.js', () => ({
  hexToRgba: (c) => c,
  darkenHex: (c) => c,
}));

import { _normalize, _linePath, _areaPath, buildStatCard, buildSparkline } from './charts.js';

// ── _normalize ────────────────────────────────────────────────────────────────

describe('_normalize', () => {
  it('maps min to 0 and max to 1 for a distinct-value array', () => {
    const result = _normalize([0, 5, 10]);
    expect(result[0]).toBeCloseTo(0);
    expect(result[1]).toBeCloseTo(0.5);
    expect(result[2]).toBeCloseTo(1);
  });

  it('returns all zeros when all values are equal (zero-range guard)', () => {
    expect(_normalize([3, 3, 3])).toEqual([0, 0, 0]);
  });

  it('handles a single-element array', () => {
    expect(_normalize([42])).toEqual([0]);
  });

  it('handles negative values correctly', () => {
    const result = _normalize([-4, 0, 4]);
    expect(result[0]).toBeCloseTo(0);
    expect(result[1]).toBeCloseTo(0.5);
    expect(result[2]).toBeCloseTo(1);
  });

  it('handles an already-normalized [0,1] input', () => {
    const result = _normalize([0, 1]);
    expect(result[0]).toBeCloseTo(0);
    expect(result[1]).toBeCloseTo(1);
  });
});

// ── _linePath ─────────────────────────────────────────────────────────────────

describe('_linePath', () => {
  it('starts with "M" for the first point', () => {
    const d = _linePath([0, 10], 100, 40);
    expect(d.startsWith('M')).toBe(true);
  });

  it('uses "L" for subsequent points', () => {
    const d = _linePath([0, 5, 10], 100, 40);
    const parts = d.split(' ');
    expect(parts[0]).toMatch(/^M/);
    expect(parts[1]).toMatch(/^L/);
    expect(parts[2]).toMatch(/^L/);
  });

  it('produces exactly N segments for N data points', () => {
    const data = [1, 2, 3, 4, 5];
    const d = _linePath(data, 200, 50);
    expect(d.split(' ')).toHaveLength(data.length);
  });

  it('first point x is 0.0, last point x equals vbW', () => {
    const d = _linePath([0, 10], 100, 40);
    const parts = d.split(' ');
    const firstX = parseFloat(parts[0].slice(1).split(',')[0]);
    const lastX  = parseFloat(parts[parts.length - 1].slice(1).split(',')[0]);
    expect(firstX).toBeCloseTo(0);
    expect(lastX).toBeCloseTo(100);
  });

  it('higher data values produce lower y (inverted axis)', () => {
    // With data=[0, 10], first point is min (should have max y), last is max (min y)
    const d = _linePath([0, 10], 100, 40, 4, 2);
    const parts = d.split(' ');
    const firstY = parseFloat(parts[0].slice(1).split(',')[1]);
    const lastY  = parseFloat(parts[parts.length - 1].slice(1).split(',')[1]);
    expect(firstY).toBeGreaterThan(lastY); // lower value → larger y
  });
});

// ── _areaPath ─────────────────────────────────────────────────────────────────

describe('_areaPath', () => {
  it('ends with Z (closed path)', () => {
    const d = _areaPath([0, 5, 10], 100, 40);
    expect(d.endsWith('Z')).toBe(true);
  });

  it('contains the vbW,vbH corner point to close the area', () => {
    const d = _areaPath([0, 10], 100, 40);
    expect(d).toContain('L100,40');
  });

  it('contains the 0,vbH corner point to close the area', () => {
    const d = _areaPath([0, 10], 100, 40);
    expect(d).toContain('L0,40');
  });
});

// ── buildStatCard ─────────────────────────────────────────────────────────────

describe('buildStatCard', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('returns an object with wrap, setValue, setDelta, setState', () => {
    const card = buildStatCard({ title: 'SALES', value: '$100', color: '#86efac' });
    expect(card.wrap).toBeInstanceOf(HTMLElement);
    expect(typeof card.setValue).toBe('function');
    expect(typeof card.setDelta).toBe('function');
    expect(typeof card.setState).toBe('function');
  });

  it('setValue() updates the value element text', () => {
    const { wrap, setValue } = buildStatCard({ title: 'TIPS', value: '$50' });
    document.body.appendChild(wrap);
    setValue('$75');
    // The value element is a div containing the value
    const divs = [...wrap.querySelectorAll('div')];
    expect(divs.some(d => d.textContent === '$75')).toBe(true);
  });

  it('setDelta() updates the delta element text', () => {
    const { wrap, setDelta } = buildStatCard({ title: 'CHECKS', value: '12', delta: '▲ 2' });
    document.body.appendChild(wrap);
    setDelta('▼ 5');
    const divs = [...wrap.querySelectorAll('div')];
    expect(divs.some(d => d.textContent === '▼ 5')).toBe(true);
  });

  it('setState("warning") applies a border to the wrap', () => {
    const { wrap, setState } = buildStatCard({ title: 'OPEN', value: '3' });
    setState('warning');
    expect(wrap.style.border).toBeTruthy();
  });

  it('setState("normal") clears the border', () => {
    const { wrap, setState } = buildStatCard({ title: 'OPEN', value: '3' });
    setState('warning');
    setState('normal');
    // normal state uses rgba border, boxShadow is none
    expect(wrap.style.boxShadow).toBe('none');
  });

  it('title is uppercased in the header', () => {
    const { wrap } = buildStatCard({ title: 'net sales', value: '$0' });
    const spans = [...wrap.querySelectorAll('span')];
    expect(spans.some(s => s.textContent === 'NET SALES')).toBe(true);
  });
});

// ── buildSparkline ────────────────────────────────────────────────────────────

describe('buildSparkline', () => {
  it('returns a div wrapping an SVG element', () => {
    const wrap = buildSparkline({ data: [1, 2, 3, 4, 5], color: '#86efac' });
    expect(wrap.tagName).toBe('DIV');
    expect(wrap.querySelector('svg')).not.toBeNull();
  });

  it('SVG contains two path elements (area + line)', () => {
    const wrap = buildSparkline({ data: [1, 2, 3, 4, 5, 6, 7], color: '#86efac' });
    const paths = wrap.querySelectorAll('path');
    expect(paths.length).toBe(2);
  });
});
