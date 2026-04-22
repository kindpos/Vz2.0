// Tests for terminal/modifier-label.js — pins the null-prefix fallback that
// keeps "null Pepperoni" off the kitchen ticket. The helper is used by the
// order-entry preview AND the commit path, so both must stay in lockstep.

import { describe, it, expect } from 'vitest';
import { formatModifierLabel } from './modifier-label.js';

describe('terminal/modifier-label', () => {
  it('null prefix → bare label (no literal "null" in the output)', () => {
    expect(formatModifierLabel(null, 'Pepperoni')).toBe('Pepperoni');
    expect(formatModifierLabel(undefined, 'Pepperoni')).toBe('Pepperoni');
    expect(formatModifierLabel('', 'Pepperoni')).toBe('Pepperoni');
  });

  it('populated prefix → "<prefix> <label>"', () => {
    expect(formatModifierLabel('ADD',   'Pepperoni')).toBe('ADD Pepperoni');
    expect(formatModifierLabel('NO',    'Onions')).toBe('NO Onions');
    expect(formatModifierLabel('EXTRA', 'Cheese')).toBe('EXTRA Cheese');
    expect(formatModifierLabel('SUB',   'Chicken')).toBe('SUB Chicken');
    expect(formatModifierLabel('LITE',  'Sauce')).toBe('LITE Sauce');
  });

  it('handles a null/undefined label defensively (never emits the string "null")', () => {
    expect(formatModifierLabel('ADD', null)).toBe('ADD ');
    expect(formatModifierLabel('ADD', undefined)).toBe('ADD ');
    expect(formatModifierLabel(null, null)).toBe('');
  });
});
