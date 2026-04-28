// Tests for overseer/src/services/excel-parser.js.
//
// Covers:
//   - Pure helper exports: parsePrice, splitList, norm, _parseMustAlsoPick
//   - getSummary — counts from a parsed data object
//   - parseMenuTemplate — end-to-end via a mocked XLSX global
//
// XLSX is used as a global (no import) so we set globalThis.XLSX before
// any test function runs. The module only references XLSX inside function
// bodies (not at load time) so top-level assignment is sufficient.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const xlsxReadMock       = vi.fn();
const xlsxSheetToJson    = vi.fn();
globalThis.XLSX = {
  read:  xlsxReadMock,
  utils: { sheet_to_json: xlsxSheetToJson },
};

import {
  parseMenuTemplate, getSummary,
  parsePrice, splitList, norm, _parseMustAlsoPick,
} from './excel-parser.js';

beforeEach(() => {
  vi.clearAllMocks();
});

// ── parsePrice ────────────────────────────────────────────────────────────────

describe('parsePrice', () => {
  it('parses a plain numeric string', () => {
    expect(parsePrice('5.99')).toBe(5.99);
  });

  it('strips a leading dollar sign', () => {
    expect(parsePrice('$12.50')).toBe(12.50);
  });

  it('handles an integer string', () => {
    expect(parsePrice('10')).toBe(10.0);
  });

  it('returns 0 for an empty string', () => {
    expect(parsePrice('')).toBe(0.0);
  });

  it('returns 0 for null / undefined', () => {
    expect(parsePrice(null)).toBe(0.0);
    expect(parsePrice(undefined)).toBe(0.0);
  });

  it('returns 0 for non-numeric text', () => {
    expect(parsePrice('N/A')).toBe(0.0);
  });

  it('parses a negative price', () => {
    expect(parsePrice('-2.00')).toBe(-2.0);
  });
});

// ── splitList ─────────────────────────────────────────────────────────────────

describe('splitList', () => {
  it('splits a comma-separated string into trimmed entries', () => {
    expect(splitList('A, B, C')).toEqual(['A', 'B', 'C']);
  });

  it('drops blank segments from consecutive commas', () => {
    expect(splitList('X,,Y')).toEqual(['X', 'Y']);
  });

  it('returns [] for an empty string', () => {
    expect(splitList('')).toEqual([]);
  });

  it('returns [] for null', () => {
    expect(splitList(null)).toEqual([]);
  });

  it('handles a single item with no commas', () => {
    expect(splitList('Pepperoni')).toEqual(['Pepperoni']);
  });

  it('trims whitespace around each item', () => {
    expect(splitList('  Cheese ,  Ham  ')).toEqual(['Cheese', 'Ham']);
  });
});

// ── norm ──────────────────────────────────────────────────────────────────────

describe('norm', () => {
  it('lowercases the input', () => {
    expect(norm('HELLO')).toBe('hello');
  });

  it('strips trailing asterisk from header names', () => {
    expect(norm('Item Name *')).toBe('item name');
  });

  it('strips question marks', () => {
    expect(norm('Active?')).toBe('active');
  });

  it('collapses multiple spaces into one', () => {
    expect(norm('Item  Name')).toBe('item name');
  });

  it('strips parentheses', () => {
    expect(norm('Price (Y/N)')).toBe('price y/n');
  });

  it('strips newlines and normalises whitespace', () => {
    expect(norm('Price *\n($0.00 if free)')).toBe('price $0.00 if free');
  });
});

// ── _parseMustAlsoPick ────────────────────────────────────────────────────────

describe('_parseMustAlsoPick', () => {
  it('returns [] for empty string', () => {
    expect(_parseMustAlsoPick('')).toEqual([]);
  });

  it('returns [] for null / undefined', () => {
    expect(_parseMustAlsoPick(null)).toEqual([]);
    expect(_parseMustAlsoPick(undefined)).toEqual([]);
  });

  it('parses a single item with price', () => {
    expect(_parseMustAlsoPick('8" GF ($2.00)')).toEqual([
      { name: '8" GF', price: 2.0 },
    ]);
  });

  it('parses multiple items separated by commas', () => {
    const result = _parseMustAlsoPick('Small ($0.00), Large ($3.50)');
    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({ name: 'Small', price: 0.0 });
    expect(result[1]).toEqual({ name: 'Large', price: 3.5 });
  });

  it('falls back to name-only with price 0 for items without price parens', () => {
    const result = _parseMustAlsoPick('Plain item');
    expect(result).toEqual([{ name: 'Plain item', price: 0.0 }]);
  });

  it('handles items with $-sign inside parens', () => {
    const result = _parseMustAlsoPick('Sauce ($1.25)');
    expect(result[0].price).toBe(1.25);
  });

  it('filters out blank entries', () => {
    // Trailing comma that creates an empty segment
    const result = _parseMustAlsoPick('Cheese ($0.00)');
    expect(result.every((x) => x.name.length > 0)).toBe(true);
  });
});

// ── getSummary ────────────────────────────────────────────────────────────────

describe('getSummary', () => {
  it('returns the restaurant name from restaurant_info', () => {
    const data = { restaurant_info: { 'Restaurant Name': 'Luigi\'s' } };
    expect(getSummary(data).restaurant_name).toBe('Luigi\'s');
  });

  it('returns Unknown when restaurant_info is empty', () => {
    expect(getSummary({}).restaurant_name).toBe('Unknown');
  });

  it('returns the tax rate from the first tax rule', () => {
    const data = { tax_rules: [{ rate: 0.08 }] };
    expect(getSummary(data).tax_rate).toBe(0.08);
  });

  it('counts categories, items, staff, and discounts', () => {
    const data = {
      categories:      [{}],
      items:           [{}, {}, {}],
      staff:           [{}, {}],
      discounts:       [{}],
      option_groups:   { choices: [{}, {}], groups: [{}] },
      combo_specials:  [],
      portion_options: [{}],
    };
    const s = getSummary(data);
    expect(s.categories_count).toBe(1);
    expect(s.items_count).toBe(3);
    expect(s.staff_count).toBe(2);
    expect(s.discounts_count).toBe(1);
    expect(s.choices_count).toBe(2);
    expect(s.groups_count).toBe(1);
    expect(s.portion_options_count).toBe(1);
  });

  it('defaults to 0 counts for missing arrays', () => {
    const s = getSummary({});
    expect(s.categories_count).toBe(0);
    expect(s.items_count).toBe(0);
    expect(s.choices_count).toBe(0);
    expect(s.tax_rate).toBe(0);
  });
});

// ── parseMenuTemplate ─────────────────────────────────────────────────────────

describe('parseMenuTemplate — error handling', () => {
  it('returns success:false and error message when arrayBuffer() throws', async () => {
    const file = { arrayBuffer: () => Promise.reject(new Error('disk read error')) };
    const result = await parseMenuTemplate(file);
    expect(result.success).toBe(false);
    expect(result.errors.some((e) => e.includes('Failed to read file'))).toBe(true);
  });

  it('returns success:false when required sheets are missing', async () => {
    xlsxReadMock.mockReturnValue({ Sheets: {} });
    const file = { arrayBuffer: () => Promise.resolve(new ArrayBuffer(0)) };
    const result = await parseMenuTemplate(file);
    expect(result.success).toBe(false);
    expect(result.errors).toContain('Missing sheet: RESTAURANT INFO');
    expect(result.errors).toContain('Missing sheet: CATEGORIES');
    expect(result.errors).toContain('Missing sheet: ITEMS');
  });
});

describe('parseMenuTemplate — valid workbook', () => {
  const INFO_SHEET = {};
  const CAT_SHEET  = {};
  const ITEMS_SHEET = {};
  const STAFF_SHEET = {};

  beforeEach(() => {
    xlsxReadMock.mockReturnValue({
      Sheets: {
        'RESTAURANT INFO': INFO_SHEET,
        'CATEGORIES':      CAT_SHEET,
        'ITEMS':           ITEMS_SHEET,
        'STAFF':           STAFF_SHEET,
      },
    });

    xlsxSheetToJson.mockImplementation((sheet, opts) => {
      if (sheet === INFO_SHEET) {
        // header:1 → returns array of arrays
        return [
          ['Restaurant Name', 'Taco Town'],
          ['Address',         '1 Main St'],
          ['City',            'Dallas'],
          ['State',           'TX'],
          ['ZIP Code',        '75201'],
          ['Sales Tax Rate (%)', '8.25'],
        ];
      }
      if (sheet === CAT_SHEET) {
        return [{ 'Category Name': 'Tacos', 'Display Order': 1, 'Color Code': '#ff0', 'Active': 'Y' }];
      }
      if (sheet === ITEMS_SHEET) {
        return [{ 'Item Name': 'Classic Taco', 'Category': 'Tacos', 'Price': '4.99', 'Active': 'Y' }];
      }
      if (sheet === STAFF_SHEET) {
        return [
          { 'First Name': 'Maria', 'Last Name': 'Lopez', 'PIN': '1234', 'Role': 'Manager', 'Active': 'Y' },
        ];
      }
      return [];
    });
  });

  it('returns success:true when all required sheets are valid', async () => {
    const file = { arrayBuffer: () => Promise.resolve(new ArrayBuffer(0)) };
    const result = await parseMenuTemplate(file);
    expect(result.success).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('parses restaurant name from RESTAURANT INFO', async () => {
    const file = { arrayBuffer: () => Promise.resolve(new ArrayBuffer(0)) };
    const { data } = await parseMenuTemplate(file);
    expect(data.restaurant_info['Restaurant Name']).toBe('Taco Town');
  });

  it('parses category name and active flag from CATEGORIES', async () => {
    const file = { arrayBuffer: () => Promise.resolve(new ArrayBuffer(0)) };
    const { data } = await parseMenuTemplate(file);
    expect(data.categories).toHaveLength(1);
    expect(data.categories[0].name).toBe('Tacos');
    expect(data.categories[0].active).toBe(true);
  });

  it('parses item name and price from ITEMS', async () => {
    const file = { arrayBuffer: () => Promise.resolve(new ArrayBuffer(0)) };
    const { data } = await parseMenuTemplate(file);
    expect(data.items).toHaveLength(1);
    expect(data.items[0].name).toBe('Classic Taco');
    expect(data.items[0].price).toBe(4.99);
  });

  it('parses staff member with role detection', async () => {
    const file = { arrayBuffer: () => Promise.resolve(new ArrayBuffer(0)) };
    const { data } = await parseMenuTemplate(file);
    expect(data.staff).toHaveLength(1);
    expect(data.staff[0].role).toBe('manager');
    expect(data.staff[0].pin).toBe('1234');
  });

  it('derives tax rate from RESTAURANT INFO', async () => {
    const file = { arrayBuffer: () => Promise.resolve(new ArrayBuffer(0)) };
    const { data } = await parseMenuTemplate(file);
    expect(data.tax_rules[0].rate).toBe(8.25);
  });
});
