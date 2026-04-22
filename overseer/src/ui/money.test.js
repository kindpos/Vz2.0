// Unit tests for overseer/src/ui/money.js formatters.
//
// These are pure functions with no side effects; no mocking needed.

import { describe, it, expect } from 'vitest';
import { fmt, fmtPct, fmtInt, fmtPP } from './money.js';

describe('fmt', () => {
  it('formats a typical dollar amount with comma separator', () => {
    expect(fmt(38417.22)).toBe('$38,417.22');
  });

  it('formats zero', () => {
    expect(fmt(0)).toBe('$0.00');
  });

  it('treats null as zero', () => {
    expect(fmt(null)).toBe('$0.00');
  });

  it('treats undefined as zero', () => {
    expect(fmt(undefined)).toBe('$0.00');
  });

  it('formats negative values with a minus sign', () => {
    expect(fmt(-50)).toBe('-$50.00');
  });

  it('signed:true prepends + for positive values', () => {
    expect(fmt(2976.14, { signed: true })).toBe('+$2,976.14');
  });

  it('signed:true keeps minus for negative values', () => {
    expect(fmt(-50, { signed: true })).toBe('-$50.00');
  });

  it('signed:true shows no sign for zero', () => {
    expect(fmt(0, { signed: true })).toBe('$0.00');
  });

  it('compact:true abbreviates 1k–9.9k with one decimal', () => {
    expect(fmt(3800, { compact: true })).toBe('$3.8k');
  });

  it('compact:true abbreviates >= 10k with no decimal', () => {
    expect(fmt(38417.22, { compact: true })).toBe('$38k');
  });

  it('compact:true abbreviates exactly 10k with no decimal', () => {
    expect(fmt(10000, { compact: true })).toBe('$10k');
  });

  it('compact:true leaves sub-1000 values unabbreviated', () => {
    expect(fmt(999.99, { compact: true })).toBe('$999.99');
  });

  it('dp:0 suppresses decimal places', () => {
    expect(fmt(1842, { dp: 0 })).toBe('$1,842');
  });

  it('dp:0 still applies comma separator', () => {
    expect(fmt(1234567, { dp: 0 })).toBe('$1,234,567');
  });

  it('small value below 1 formats correctly', () => {
    expect(fmt(0.5)).toBe('$0.50');
  });
});

describe('fmtPct', () => {
  it('converts a fraction to a percentage string', () => {
    expect(fmtPct(0.184)).toBe('18.4%');
  });

  it('formats zero fraction as 0.0%', () => {
    expect(fmtPct(0)).toBe('0.0%');
  });

  it('treats null as zero', () => {
    expect(fmtPct(null)).toBe('0.0%');
  });

  it('signed:true prepends + for positive fractions', () => {
    expect(fmtPct(0.10, { signed: true })).toBe('+10.0%');
  });

  it('signed:true keeps minus for negative fractions', () => {
    expect(fmtPct(-0.05, { signed: true })).toBe('-5.0%');
  });

  it('signed:true shows no sign for zero', () => {
    expect(fmtPct(0, { signed: true })).toBe('0.0%');
  });

  it('dp:2 increases decimal precision', () => {
    expect(fmtPct(0.1234, { dp: 2 })).toBe('12.34%');
  });
});

describe('fmtInt', () => {
  it('comma-groups a large integer', () => {
    expect(fmtInt(1842)).toBe('1,842');
  });

  it('formats a small integer with no separator', () => {
    expect(fmtInt(42)).toBe('42');
  });

  it('rounds a float to the nearest integer', () => {
    expect(fmtInt(1842.7)).toBe('1,843');
  });

  it('formats negative integers with a minus sign', () => {
    expect(fmtInt(-5)).toBe('-5');
  });

  it('signed:true prepends + for positive values', () => {
    expect(fmtInt(1500, { signed: true })).toBe('+1,500');
  });

  it('treats null as zero', () => {
    expect(fmtInt(null)).toBe('0');
  });
});

describe('fmtPP', () => {
  it('formats a negative delta as negative pp (signed by default)', () => {
    expect(fmtPP(-0.003)).toBe('-0.3pp');
  });

  it('formats a positive delta with + (signed by default)', () => {
    expect(fmtPP(0.01)).toBe('+1.0pp');
  });

  it('formats zero as 0.0pp with default signed:true', () => {
    expect(fmtPP(0)).toBe('0.0pp');
  });

  it('signed:false suppresses the + prefix', () => {
    expect(fmtPP(0.05, { signed: false })).toBe('5.0pp');
  });

  it('treats null as zero', () => {
    expect(fmtPP(null)).toBe('0.0pp');
  });
});
