// Tests for the v3 excel parser + the menu-import event converter.
//
// Builds a complete in-memory KINDpos_Menu_Template_v3 workbook through
// the SheetJS XLSX global (mocked here), runs parseMenuTemplate, and
// then runs convertParsedDataToEvents. Verifies all 12 collections
// parse, the price_by_size shape on Pepperoni nests correctly, MOD
// GROUPS splits on the ▶ markers, and the emitted events come out in
// the documented dependency order.

import { describe, it, expect, vi, beforeEach } from 'vitest';

// XLSX is a global — set before importing the parser. The parser only
// references XLSX inside function bodies, so top-level wiring is enough.
const xlsxReadMock    = vi.fn();
const xlsxSheetToJson = vi.fn();
globalThis.XLSX = {
  read:  xlsxReadMock,
  utils: { sheet_to_json: xlsxSheetToJson },
};

import {
  parseMenuTemplate, getSummary,
  parsePrice, splitList, norm,
} from '../src/services/excel-parser.js';
import { convertParsedDataToEvents } from '../src/sections/menu-import.js';

// ─── Workbook fixture builder ────────────────────────────────────────────────
//
// Each sheet is a unique sentinel object; sheet_to_json dispatches based on
// identity so we can return per-sheet shapes (header:1 raw arrays for STORE
// INFO + MOD GROUPS, header-keyed objects with range:2 for everything else).

const SHEET_NAMES = [
  'STORE INFO', 'TAX RULES', 'SIZES', 'OPTIONS', 'OPTION GROUPS',
  'MODIFIERS', 'MICROMOD GROUPS', 'MOD GROUPS',
  'CATEGORIES', 'ITEMS', 'DISCOUNTS',
];

function makeWorkbook() {
  const sheets = {};
  for (const n of SHEET_NAMES) sheets[n] = { __name: n };
  return { Sheets: sheets };
}

// Header-keyed rows for sheets parsed via range:2.
const FIXTURE = {
  'STORE INFO': [
    ['Restaurant Name', "Tony's Pizzeria"],
    ['Address',         '101 Main St'],
    ['City',            'Austin'],
    ['State',           'TX'],
    ['ZIP Code',        '78701'],
    ['Phone',           '512-555-0100'],
  ],
  'TAX RULES': [
    { 'Tax Rule Name': 'Standard Sales', 'Rate': '8.25',
      'Dine-In': 'Y', 'Takeout': 'Y', 'Delivery': 'Y' },
  ],
  'SIZES': [
    { 'Size Name': 'Small',  'Price Adjustment': '0.00', 'Active': 'Y' },
    { 'Size Name': 'Medium', 'Price Adjustment': '3.00', 'Active': 'Y' },
    { 'Size Name': 'Large',  'Price Adjustment': '6.00', 'Active': 'Y' },
    { 'Size Name': 'XL',     'Price Adjustment': '9.00', 'Active': 'Y' },
  ],
  'OPTIONS': [
    { 'Option Name': 'Regular', 'Price Adjustment': '0.00',  'Negates Price (Y/N)': 'N', 'Active': 'Y' },
    { 'Option Name': 'Extra',   'Price Adjustment': '1.50',  'Negates Price (Y/N)': 'N', 'Active': 'Y' },
    { 'Option Name': 'Light',   'Price Adjustment': '-0.50', 'Negates Price (Y/N)': 'N', 'Active': 'Y' },
    { 'Option Name': 'None',    'Price Adjustment': '0.00',  'Negates Price (Y/N)': 'Y', 'Active': 'Y' },
  ],
  'OPTION GROUPS': [
    { 'Group Name': 'Standard Qty', 'Options': 'Regular, Extra, Light, None', 'Active': 'Y' },
  ],
  'MODIFIERS': [
    { 'Modifier Name': 'Pepperoni', 'Price': '1.50',
      'Price By Size': 'Pizza Size|Small:0.00, Pizza Size|Medium:0.25, Pizza Size|Large:0.50, Pizza Size|XL:0.75',
      'Active': 'Y' },
    { 'Modifier Name': 'Cheese', 'Price': '0.00', 'Price By Size': '', 'Active': 'Y' },
    // The four pizza-size modifiers — names must match the Sizes for the
    // pricing chain's active-size lookup to resolve.
    { 'Modifier Name': 'Small',  'Price': '0.00', 'Price By Size': '', 'Active': 'Y' },
    { 'Modifier Name': 'Medium', 'Price': '0.00', 'Price By Size': '', 'Active': 'Y' },
    { 'Modifier Name': 'Large',  'Price': '0.00', 'Price By Size': '', 'Active': 'Y' },
    { 'Modifier Name': 'XL',     'Price': '0.00', 'Price By Size': '', 'Active': 'Y' },
  ],
  'MICROMOD GROUPS': [
    { 'Group Name': 'Prep', 'MicroMods': 'Grilled, Fried, Crispy',
      'Attaches To': 'Pepperoni, Cheese', 'Active': 'Y' },
  ],
  'CATEGORIES': [
    { 'Category Name': 'Pizzas', 'Display Order': '1', 'Color': '',
      'Tax Rule': 'Standard Sales', 'Optional Groups': 'Toppings',
      'Enable Placement': 'Y', 'Active': 'Y' },
    { 'Category Name': 'Drinks', 'Display Order': '2', 'Color': '',
      'Tax Rule': 'Standard Sales', 'Optional Groups': '',
      'Enable Placement': 'N', 'Active': 'Y' },
  ],
  'ITEMS': [
    { 'Item Name': 'Pepperoni Pizza', 'Category': 'Pizzas', 'Price': '0.00',
      'Description': 'House special',
      'Included Mods': 'Cheese',
      'Mandatory Groups': 'Pizza Size',
      'Options Group Overrides': 'Toppings:Standard Qty',
      'Price By Size': 'Pizza Size|Small:12.99, Pizza Size|Medium:15.99, Pizza Size|Large:18.99, Pizza Size|XL:21.99',
      'Size Price Overrides': 'Toppings|Large:0.75',
      'Tax Rule': 'Standard Sales', 'SKU': 'P-001', 'Active': 'Y',
      'Prep Time': '12', 'Allergens': 'Gluten, Dairy', 'Notes': '' },
  ],
  'DISCOUNTS': [
    { 'Discount Name': 'Senior 10', 'Type': '%', 'Amount': '10',
      'Schedule': 'Always', 'Applies To': 'Entire Check',
      'Restrictions': '', 'Requires Approval': 'N', 'Reason Code': 'SENIOR',
      'Active': 'Y' },
  ],
};

// Raw-array rows for sheets read with header:1.
const RAW_ROWS = {
  'STORE INFO': FIXTURE['STORE INFO'],
  'MOD GROUPS': [
    // Row 1-2: title + instruction.
    ['KINDpos Menu — Mod Groups',                          '', '', '', '', '', '', ''],
    ['Use the section markers below to split mandatory ▶', '', '', '', '', '', '', ''],
    // Row 3: column headers.
    ['Group Name', 'Modifiers', 'Min Picks', 'Max Picks',
     'Drives Pricing', 'Default Option Group', 'Size Price Adjustments',
     'Active'],
    // Row 4: ▶ MANDATORY section marker.
    ['▶ MANDATORY GROUPS', '', '', '', '', '', '', ''],
    ['Pizza Size', 'Small, Medium, Large, XL', '1', '1', 'Y', '', '', 'Y'],
    // Row 6: ▶ OPTIONAL section marker.
    ['▶ OPTIONAL GROUPS', '', '', '', '', '', '', ''],
    ['Toppings', 'Pepperoni, Cheese', '0', '10', '', 'Standard Qty',
     'Small:0.00, Medium:0.25, Large:0.50, XL:0.75', 'Y'],
    // ⚠ region — anything past this line is operator notes, not data.
    ['⚠ STOP — operator notes below this line', '', '', '', '', '', '', ''],
    ['Notes about how to use this sheet…', '', '', '', '', '', '', ''],
  ],
};

beforeEach(() => {
  vi.clearAllMocks();
  xlsxReadMock.mockReturnValue(makeWorkbook());
  xlsxSheetToJson.mockImplementation((sheet, opts) => {
    if (!sheet || !sheet.__name) return [];
    const name = sheet.__name;
    // header:1 path — return raw arrays
    if (opts && opts.header === 1) {
      return RAW_ROWS[name] || [];
    }
    // range:2 path — return header-keyed objects
    return FIXTURE[name] || [];
  });
});

async function loadParsed() {
  const file = { arrayBuffer: () => Promise.resolve(new ArrayBuffer(0)) };
  return await parseMenuTemplate(file);
}

// ── Helper exports still work ───────────────────────────────────────────────

describe('helper exports', () => {
  it('parsePrice strips $ and parses', () => {
    expect(parsePrice('$12.50')).toBe(12.5);
    expect(parsePrice('')).toBe(0);
  });
  it('splitList trims and drops blanks', () => {
    expect(splitList('A, B,, C')).toEqual(['A', 'B', 'C']);
  });
  it('norm lowercases and strips decorators', () => {
    expect(norm('Item Name *')).toBe('item name');
  });
});

// ── parseMenuTemplate — all 12 collections ─────────────────────────────────

describe('parseMenuTemplate v3 — all collections', () => {
  it('parses STORE INFO from raw col-A/col-B pairs', async () => {
    const r = await loadParsed();
    expect(r.success).toBe(true);
    expect(r.data.restaurant_info['Restaurant Name']).toBe("Tony's Pizzeria");
    expect(r.data.restaurant_info['City']).toBe('Austin');
  });

  it('parses TAX RULES', async () => {
    const r = await loadParsed();
    expect(r.data.tax_rules).toHaveLength(1);
    expect(r.data.tax_rules[0]).toMatchObject({
      name: 'Standard Sales', rate: 8.25, dine_in: true, takeout: true, delivery: true,
    });
  });

  it('parses SIZES with Decimal-string price_adjustment', async () => {
    const r = await loadParsed();
    expect(r.data.sizes).toHaveLength(4);
    expect(r.data.sizes[0]).toMatchObject({
      size_id: 'small', name: 'Small', price_adjustment: '0.00', active: true,
    });
    expect(r.data.sizes[2]).toMatchObject({
      size_id: 'large', name: 'Large', price_adjustment: '6.00',
    });
  });

  it('parses OPTIONS with negates_price flag', async () => {
    const r = await loadParsed();
    expect(r.data.options).toHaveLength(4);
    expect(r.data.options.map(o => o.option_id))
      .toEqual(['regular', 'extra', 'light', 'none']);
    expect(r.data.options[1].price_adjustment).toBe('1.50');
    expect(r.data.options[3].negates_price).toBe(true);
  });

  it('parses OPTION GROUPS and splits Options by comma', async () => {
    const r = await loadParsed();
    expect(r.data.option_groups).toHaveLength(1);
    expect(r.data.option_groups[0]).toMatchObject({
      option_group_id: 'standard_qty', name: 'Standard Qty', active: true,
    });
    expect(r.data.option_groups[0].option_names)
      .toEqual(['Regular', 'Extra', 'Light', 'None']);
  });

  it('parses MODIFIERS and price_by_size into the correct nested shape', async () => {
    const r = await loadParsed();
    expect(r.data.modifiers.length).toBeGreaterThanOrEqual(2);
    const pep = r.data.modifiers.find(m => m.name === 'Pepperoni');
    expect(pep).toMatchObject({
      modifier_id: 'pepperoni',
      name: 'Pepperoni',
      price: '1.50',
      active: true,
    });
    expect(pep.price_by_size).toEqual({
      'Pizza Size': {
        Small:  '0.00',
        Medium: '0.25',
        Large:  '0.50',
        XL:     '0.75',
      },
    });
    // A modifier with no Price By Size still surfaces an empty map.
    const cheese = r.data.modifiers.find(m => m.name === 'Cheese');
    expect(cheese.price_by_size).toEqual({});
  });

  it('parses MICROMOD GROUPS and splits MicroMods + Attaches To', async () => {
    const r = await loadParsed();
    expect(r.data.micromod_groups).toHaveLength(1);
    expect(r.data.micromod_groups[0]).toMatchObject({
      group_name: 'Prep',
      micromod_names: ['Grilled', 'Fried', 'Crispy'],
      attaches_to:    ['Pepperoni', 'Cheese'],
      active: true,
    });
  });

  it('splits MOD GROUPS into mandatory vs optional via ▶ markers', async () => {
    const r = await loadParsed();
    const mg = r.data.mod_groups;
    expect(mg.mandatory).toHaveLength(1);
    expect(mg.optional).toHaveLength(1);
    expect(mg.mandatory[0]).toMatchObject({
      group_id: 'pizza_size',
      name: 'Pizza Size',
      modifiers: ['Small', 'Medium', 'Large', 'XL'],
      min: 1, max: 1,
      drives_pricing: true,
      active: true,
    });
    expect(mg.optional[0]).toMatchObject({
      group_id: 'toppings',
      name: 'Toppings',
      modifiers: ['Pepperoni', 'Cheese'],
      min: 0, max: 10,
      default_option_group_name: 'Standard Qty',
      active: true,
    });
    expect(mg.optional[0].size_price_adjustments).toEqual({
      Small: '0.00', Medium: '0.25', Large: '0.50', XL: '0.75',
    });
    // Stop marker (⚠) keeps operator notes out of the data.
    expect(mg.mandatory.some(g => g.name.includes('STOP'))).toBe(false);
    expect(mg.optional.some(g => g.name.includes('Notes'))).toBe(false);
  });

  it('parses CATEGORIES with enable_placement and optional_groups', async () => {
    const r = await loadParsed();
    expect(r.data.categories).toHaveLength(2);
    const pizzas = r.data.categories.find(c => c.name === 'Pizzas');
    expect(pizzas).toMatchObject({
      name: 'Pizzas', display_order: 1,
      tax_rule: 'Standard Sales',
      enable_placement: true,
      active: true,
    });
    expect(pizzas.optional_groups).toEqual(['Toppings']);
    const drinks = r.data.categories.find(c => c.name === 'Drinks');
    expect(drinks.enable_placement).toBe(false);
  });

  it('parses ITEMS with all three nested-override columns', async () => {
    const r = await loadParsed();
    expect(r.data.items).toHaveLength(1);
    const it = r.data.items[0];
    expect(it).toMatchObject({
      name: 'Pepperoni Pizza',
      category: 'Pizzas',
      price: '0.00',
      description: 'House special',
      included_mods: ['Cheese'],
      mandatory_groups: ['Pizza Size'],
      tax_rule: 'Standard Sales',
      sku: 'P-001',
      prep_time: 12,
      allergens: ['Gluten', 'Dairy'],
      active: true,
    });
    expect(it.option_group_overrides).toEqual({ Toppings: 'Standard Qty' });
    expect(it.price_by_size).toEqual({
      'Pizza Size': {
        Small: '12.99', Medium: '15.99', Large: '18.99', XL: '21.99',
      },
    });
    expect(it.size_price_overrides).toEqual({
      Toppings: { Large: '0.75' },
    });
  });

  it('parses DISCOUNTS', async () => {
    const r = await loadParsed();
    expect(r.data.discounts).toHaveLength(1);
    expect(r.data.discounts[0]).toMatchObject({
      name: 'Senior 10', type: '%', amount: 10,
      schedule: 'Always', applies_to: 'Entire Check',
      reason_code: 'SENIOR', requires_approval: false, active: true,
    });
  });
});

// ── getSummary surfaces the new counts ─────────────────────────────────────

describe('getSummary v3 counts', () => {
  it('reports counts for every new collection', async () => {
    const r = await loadParsed();
    const s = getSummary(r.data);
    expect(s.restaurant_name).toBe("Tony's Pizzeria");
    expect(s.sizes_count).toBe(4);
    expect(s.options_count).toBe(4);
    expect(s.option_groups_count).toBe(1);
    expect(s.modifiers_count).toBeGreaterThanOrEqual(2);
    expect(s.micromod_groups_count).toBe(1);
    expect(s.mandatory_groups_count).toBe(1);
    expect(s.optional_groups_count).toBe(1);
    expect(s.categories_count).toBe(2);
    expect(s.items_count).toBe(1);
  });
});

// ── convertParsedDataToEvents — emission order ────────────────────────────

describe('convertParsedDataToEvents — dependency-order emission', () => {
  function indexOfFirst(events, predicate) {
    return events.findIndex(predicate);
  }

  it('emits in store → sizes → options → option_groups → mod groups → modifiers → micromods → categories → items order', async () => {
    const r = await loadParsed();
    const events = convertParsedDataToEvents(r.data);
    const types  = events.map(e => e.event_type);

    // Each predicate finds the first occurrence of a type and orders verify.
    const i_store     = types.indexOf('store.info_updated');
    const i_size      = types.indexOf('size.created');
    const i_option    = types.indexOf('option.created');
    const i_optGrp    = types.indexOf('option_group.created');
    const i_optAdd    = types.indexOf('option_group.option_added');
    const i_modGrp    = types.indexOf('modifier.group_created');
    const i_modOgSet  = types.indexOf('modifier.group_option_group_set');
    const i_modCreate = types.indexOf('modifier.created');
    const i_modSize   = types.indexOf('modifier.size_pricing_set');
    const i_micro     = types.indexOf('micromod.created');
    const i_microAss  = types.indexOf('micromod.assigned_to_modifier');
    const i_cat       = types.indexOf('menu.category_created');
    const i_item      = types.indexOf('menu.item_created');
    const i_itemSize  = types.indexOf('menu.item_size_pricing_set');
    const i_itemOgOv  = types.indexOf('menu.item_option_group_override_set');
    const i_itemSpOv  = types.indexOf('menu.item_size_price_override_set');

    expect(i_store).toBeGreaterThanOrEqual(0);
    expect(i_size).toBeGreaterThan(i_store);
    expect(i_option).toBeGreaterThan(i_size);
    expect(i_optGrp).toBeGreaterThan(i_option);
    expect(i_optAdd).toBeGreaterThan(i_optGrp);
    expect(i_modGrp).toBeGreaterThan(i_optAdd);
    expect(i_modOgSet).toBeGreaterThan(i_modGrp);
    expect(i_modCreate).toBeGreaterThan(i_modGrp);
    expect(i_modSize).toBeGreaterThan(i_modCreate);
    expect(i_micro).toBeGreaterThan(i_modCreate);
    expect(i_microAss).toBeGreaterThan(i_micro);
    expect(i_cat).toBeGreaterThan(i_micro);
    expect(i_item).toBeGreaterThan(i_cat);
    expect(i_itemSize).toBeGreaterThan(i_item);
    expect(i_itemOgOv).toBeGreaterThan(i_item);
    expect(i_itemSpOv).toBeGreaterThan(i_item);
  });

  it('size.created precedes modifier.group_created', async () => {
    const r = await loadParsed();
    const events = convertParsedDataToEvents(r.data);
    const firstSize    = events.findIndex(e => e.event_type === 'size.created');
    const firstModGrp  = events.findIndex(e => e.event_type === 'modifier.group_created');
    expect(firstSize).toBeGreaterThanOrEqual(0);
    expect(firstModGrp).toBeGreaterThan(firstSize);
  });

  it('option_group.option_added comes after option.created', async () => {
    const r = await loadParsed();
    const events = convertParsedDataToEvents(r.data);
    const lastOption = events.map(e => e.event_type).lastIndexOf('option.created');
    const firstAdd   = events.findIndex(e => e.event_type === 'option_group.option_added');
    expect(lastOption).toBeGreaterThanOrEqual(0);
    expect(firstAdd).toBeGreaterThan(lastOption);
  });

  it('mandatory groups emit before optional groups', async () => {
    const r = await loadParsed();
    const events = convertParsedDataToEvents(r.data);
    const groupCreates = events.filter(e => e.event_type === 'modifier.group_created');
    expect(groupCreates).toHaveLength(2);
    expect(groupCreates[0].payload.drives_pricing).toBe(true);   // Pizza Size
    expect(groupCreates[1].payload.drives_pricing).toBe(false);  // Toppings
  });

  it('emits modifier.size_pricing_set with the right group_id and size map', async () => {
    const r = await loadParsed();
    const events = convertParsedDataToEvents(r.data);
    const sizing = events.find(
      e => e.event_type === 'modifier.size_pricing_set' &&
           e.payload.modifier_id === 'pepperoni'
    );
    expect(sizing).toBeTruthy();
    expect(sizing.payload.group_id).toBe('pizza_size');
    expect(sizing.payload.size_prices).toEqual({
      Small: '0.00', Medium: '0.25', Large: '0.50', XL: '0.75',
    });
  });

  it('item events carry resolved id references', async () => {
    const r = await loadParsed();
    const events = convertParsedDataToEvents(r.data);
    const item = events.find(e => e.event_type === 'menu.item_created');
    expect(item.payload.item_id).toBe('pepperoni_pizza');
    expect(item.payload.included_modifier_ids).toContain('cheese');
    expect(item.payload.mandatory_group_ids).toContain('pizza_size');

    const ogov = events.find(e => e.event_type === 'menu.item_option_group_override_set');
    expect(ogov.payload).toMatchObject({
      item_id: 'pepperoni_pizza',
      group_id: 'toppings',
      option_group_id: 'standard_qty',
    });

    const spov = events.find(e => e.event_type === 'menu.item_size_price_override_set');
    expect(spov.payload).toMatchObject({
      item_id: 'pepperoni_pizza',
      group_id: 'toppings',
      size_name: 'Large',
      price: '0.75',
    });
  });
});
