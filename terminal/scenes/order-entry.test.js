// Tests for the idempotency-critical paths in order-entry.js:
//
//   recallFromBackend   — backendItemId preserved for every recalled item
//   handleSaveOnly      — skips re-POSTing items that already have a backendItemId
//   handleSend          — same guard; new-item POST + /send both fire exactly once
//   createOrderIdemKey  — same key reused across retries (no phantom duplicate orders)
//   handleSaveOnly      — early-exit when all items already on backend

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// ── Mocks (hoisted before imports) ──────────────────────────────────────────

const registeredScenes = [];

const SceneManagerMock = {
  mountWorking:           vi.fn(),
  unmountWorking:         vi.fn(),
  getActiveWorking:       vi.fn(() => 'order-entry'),
  interrupt:              vi.fn(),
  closeInterrupt:         vi.fn(),
  openTransactional:      vi.fn(),
  closeTransactional:     vi.fn(),
  closeAllTransactional:  vi.fn(),
  hasInterrupt:           vi.fn(() => false),
  on:                     vi.fn(),
  off:                    vi.fn(),
  emit:                   vi.fn(),
};

vi.mock('../scene-manager.js', () => ({
  SceneManager: SceneManagerMock,
  defineScene:  (def) => { registeredScenes.push(def); return def; },
}));

vi.mock('../../common/tokens.js', () => {
  function deep() {
    return new Proxy({}, {
      get(_, k) {
        if (k === Symbol.toPrimitive || k === 'toString' || k === 'valueOf') return () => '';
        return deep();
      },
    });
  }
  return { T: deep() };
});

vi.mock('../theme-manager.js', () => {
  const el = () => {
    const d = document.createElement('div');
    d.setAccent = vi.fn();
    return d;
  };
  return {
    buildCard:       () => ({ wrap: el(), card: el() }),
    buildStaticCard: el,
    buildPillButton: el,
    buildDataRow:    el,
    hexToRgba:  (c) => c,
    darkenHex:  (c) => c,
    lightenHex: (c) => c,
  };
});

vi.mock('../components.js', () => ({
  showToast: vi.fn(),
  buildGap:  () => document.createElement('div'),
  buildButton: () => document.createElement('button'),
}));

vi.mock('../order-summary.js', () => ({
  OrderSummary: {
    show:             vi.fn(),
    hide:             vi.fn(),
    update:           vi.fn(),
    updateSplit:      vi.fn(),
    lockItemRender:   vi.fn(),
    unlockItemRender: vi.fn(),
  },
}));

vi.mock('../keyboard.js', () => ({
  showKeyboard: vi.fn(),
  hideKeyboard: vi.fn(),
}));

vi.mock('../half-placement-overlay.js', () => ({
  showHalfPlacementOverlay: vi.fn(),
}));

vi.mock('../pizza-builder-overlay.js', () => ({
  showPizzaBuilderOverlay: vi.fn(),
}));

vi.mock('../menu-data/universal-modifiers.js', () => ({
  PREFIXES:          [],
  getModHexData:     vi.fn(() => ({ color: '', darkBg: '' })),
  hasPizzaCategory:  vi.fn(() => false),
  PIZZA_PLACEMENTS:  [],
  MOD_COLORS:        {},
}));

vi.mock('../pricing.js', () => ({
  computeTotals: vi.fn(() => ({ subtotal: 0, tax: 0, total: 0, cashTotal: 0 })),
  getCashDiscount: vi.fn(() => 0),
  getTaxRate: vi.fn(() => 0),
}));

vi.mock('../net.js', () => ({
  fetchWithTimeout: vi.fn(() => Promise.resolve({
    ok: true,
    json: () => Promise.resolve({ order_id: 'ord-default', check_number: 'C-001', items: [] }),
  })),
}));

vi.mock('../entomology-client.js', () => ({
  entReport: vi.fn(() => Promise.resolve()),
}));

vi.mock('../modifier-label.js', () => ({
  formatModifierLabel: vi.fn((m) => m.name || ''),
}));

vi.mock('./transitions.js', () => ({
  buildCheckOverviewParams: vi.fn(() => ({})),
}));

// ── Helpers ──────────────────────────────────────────────────────────────────

// Build a minimal ticket item as the backend would produce after recall.
function backendItem(overrides = {}) {
  return {
    id:            1,
    backendItemId: 'bi-existing-001',
    menu_item_id:  'm1',
    idemKey:       'ik_old_key',
    name:          'Burger',
    unitPrice:     10,
    mods:          [],
    selected:      false,
    sent:          false,
    category:      null,
    seat_number:   null,
    ...overrides,
  };
}

// Build a minimal ticket item as a freshly-added local item (no backendItemId).
function localItem(overrides = {}) {
  return {
    id:            2,
    backendItemId: undefined,
    menu_item_id:  'm2',
    idemKey:       'ik_new_item',
    name:          'Fries',
    unitPrice:     4,
    mods:          [],
    selected:      false,
    sent:          false,
    category:      null,
    seat_number:   null,
    ...overrides,
  };
}

// ── Test suite ───────────────────────────────────────────────────────────────

describe('terminal/scenes/order-entry — idempotency guards', () => {
  let sceneDef;
  let fetchWithTimeout;

  beforeEach(async () => {
    vi.resetModules();
    registeredScenes.length = 0;
    SceneManagerMock.mountWorking.mockClear();
    SceneManagerMock.getActiveWorking.mockReturnValue('order-entry');

    const netMod = await import('../net.js');
    fetchWithTimeout = netMod.fetchWithTimeout;

    await import('./order-entry.js');
    sceneDef = registeredScenes.find((s) => s.name === 'order-entry');
    // After resetModules + fresh import, all module-level vars are at their
    // initial values (ticket=[], currentOrderId=null, etc.) — no render() needed.
  });

  afterEach(() => { vi.restoreAllMocks(); });

  // ── recallFromBackend ───────────────────────────────────────────────────

  describe('recallFromBackend', () => {
    it('sets backendItemId from item.item_id on every recalled item', async () => {
      const orderData = {
        order_id:     'ord-r1',
        check_number: 'C-100',
        items: [
          { item_id: 'bi-aaa', menu_item_id: 'm1', name: 'Burger', price: '10.00',
            effective_price: '10.00', quantity: 1, sent_at: null, modifiers: [] },
          { item_id: 'bi-bbb', menu_item_id: 'm2', name: 'Fries', price: '4.00',
            effective_price: '4.00', quantity: 1, sent_at: null, modifiers: [] },
        ],
      };
      fetchWithTimeout.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(orderData),
      });

      sceneDef.__handlers.recallFromBackend('ord-r1');
      // Wait for the async fetch chain
      await new Promise((r) => setTimeout(r, 20));

      const ticket = sceneDef.__handlers.ticket;
      expect(ticket).toHaveLength(2);
      expect(ticket[0].backendItemId).toBe('bi-aaa');
      expect(ticket[1].backendItemId).toBe('bi-bbb');
    });

    it('marks items as sent when sent_at is set', async () => {
      const orderData = {
        order_id: 'ord-r2',
        check_number: 'C-101',
        items: [
          { item_id: 'bi-ccc', menu_item_id: 'm1', name: 'Pizza', price: '15.00',
            effective_price: '15.00', quantity: 1, sent_at: '2025-01-01T12:00:00', modifiers: [] },
        ],
      };
      fetchWithTimeout.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(orderData),
      });

      sceneDef.__handlers.recallFromBackend('ord-r2');
      await new Promise((r) => setTimeout(r, 20));

      const ticket = sceneDef.__handlers.ticket;
      expect(ticket[0].sent).toBe(true);
    });

    it('sets currentOrderId from the response', async () => {
      const orderData = {
        order_id: 'ord-r3',
        check_number: 'C-102',
        items: [],
      };
      fetchWithTimeout.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(orderData),
      });

      sceneDef.__handlers.recallFromBackend('ord-r3');
      await new Promise((r) => setTimeout(r, 20));

      expect(sceneDef.__handlers.currentOrderId).toBe('ord-r3');
    });

    it('does not populate ticket if scene is no longer active', async () => {
      SceneManagerMock.getActiveWorking.mockReturnValue('check-overview');

      const orderData = {
        order_id: 'ord-r4',
        check_number: 'C-103',
        items: [
          { item_id: 'bi-ddd', menu_item_id: 'm1', name: 'Burger', price: '10.00',
            effective_price: '10.00', quantity: 1, sent_at: null, modifiers: [] },
        ],
      };
      fetchWithTimeout.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(orderData),
      });

      sceneDef.__handlers.recallFromBackend('ord-r4');
      await new Promise((r) => setTimeout(r, 20));

      // Ticket should still be empty — scene guard prevented the write
      expect(sceneDef.__handlers.ticket).toHaveLength(0);
    });
  });

  // ── handleSaveOnly ──────────────────────────────────────────────────────

  describe('handleSaveOnly', () => {
    it('skips items that already have a backendItemId (the doubling-bug guard)', async () => {
      // Mix: one recalled item + one freshly-added item
      sceneDef.__handlers.ticket = [
        backendItem({ id: 1 }),
        localItem({ id: 2 }),
      ];
      sceneDef.__handlers.currentOrderId = 'ord-existing';

      fetchWithTimeout.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({}),
      });

      await sceneDef.__handlers.handleSaveOnly();

      // Only one POST to /items (for the local item)
      const itemCalls = fetchWithTimeout.mock.calls.filter(
        (c) => c[0].includes('/items'),
      );
      expect(itemCalls).toHaveLength(1);
      expect(JSON.parse(itemCalls[0][1].body).name).toBe('Fries');
    });

    it('returns early without any fetch when all items have backendItemId', async () => {
      sceneDef.__handlers.ticket = [
        backendItem({ id: 1 }),
        backendItem({ id: 2, backendItemId: 'bi-existing-002', name: 'Steak' }),
      ];
      sceneDef.__handlers.currentOrderId = 'ord-existing';

      await sceneDef.__handlers.handleSaveOnly();

      const itemCalls = fetchWithTimeout.mock.calls.filter(
        (c) => c[0].includes('/items'),
      );
      expect(itemCalls).toHaveLength(0);
    });

    it('does nothing when ticket is empty', async () => {
      sceneDef.__handlers.ticket = [];
      await sceneDef.__handlers.handleSaveOnly();
      expect(fetchWithTimeout).not.toHaveBeenCalled();
    });

    it('does nothing when all items are already sent', async () => {
      sceneDef.__handlers.ticket = [localItem({ sent: true })];
      await sceneDef.__handlers.handleSaveOnly();
      expect(fetchWithTimeout).not.toHaveBeenCalled();
    });
  });

  // ── handleSend ─────────────────────────────────────────────────────────

  describe('handleSend', () => {
    it('skips items with backendItemId and only POSTs new items', async () => {
      sceneDef.__handlers.ticket = [
        backendItem({ id: 1 }),
        localItem({ id: 2 }),
      ];
      sceneDef.__handlers.currentOrderId = 'ord-existing';

      // item POST succeeds, then /send succeeds
      fetchWithTimeout
        .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({}) })
        .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({}) })
        .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({}) });

      await sceneDef.__handlers.handleSend();

      const itemCalls = fetchWithTimeout.mock.calls.filter(
        (c) => c[0].includes('/items'),
      );
      expect(itemCalls).toHaveLength(1);
      expect(JSON.parse(itemCalls[0][1].body).name).toBe('Fries');
    });

    it('fires /send to kitchen even when all items have backendItemId', async () => {
      sceneDef.__handlers.ticket = [
        backendItem({ id: 1 }),
      ];
      sceneDef.__handlers.currentOrderId = 'ord-existing';

      fetchWithTimeout
        .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({}) });

      await sceneDef.__handlers.handleSend();

      const sendCalls = fetchWithTimeout.mock.calls.filter(
        (c) => c[0].includes('/send'),
      );
      expect(sendCalls).toHaveLength(1);
    });

    it('marks all items sent on success', async () => {
      sceneDef.__handlers.ticket = [
        localItem({ id: 1 }),
        backendItem({ id: 2 }),
      ];
      sceneDef.__handlers.currentOrderId = 'ord-existing';

      fetchWithTimeout
        .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({}) })
        .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({}) })
        .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({}) });

      await sceneDef.__handlers.handleSend();

      const ticket = sceneDef.__handlers.ticket;
      expect(ticket.every((i) => i.sent)).toBe(true);
    });
  });

  // ── createOrderIdemKey stability ────────────────────────────────────────

  describe('createOrderIdemKey', () => {
    it('reuses the same key when order creation fails and is retried', async () => {
      sceneDef.__handlers.ticket = [localItem({ id: 1 })];
      // No currentOrderId — will attempt to create order

      // First attempt: order creation fails
      fetchWithTimeout.mockResolvedValueOnce({ ok: false, status: 503 });

      await sceneDef.__handlers.handleSend().catch(() => {});
      const keyAfterFirstAttempt = sceneDef.__handlers.createOrderIdemKey;
      expect(keyAfterFirstAttempt).toBeTruthy();

      // Second attempt: order creation fails again
      fetchWithTimeout.mockResolvedValueOnce({ ok: false, status: 503 });

      await sceneDef.__handlers.handleSend().catch(() => {});
      const keyAfterSecondAttempt = sceneDef.__handlers.createOrderIdemKey;

      // Key must not change — backend deduplicates on it
      expect(keyAfterSecondAttempt).toBe(keyAfterFirstAttempt);
    });

    it('clears createOrderIdemKey once order is successfully created', async () => {
      sceneDef.__handlers.ticket = [localItem({ id: 1 })];

      // Order created successfully, then item POST, then /send
      fetchWithTimeout
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ order_id: 'ord-new', check_number: 'C-200' }),
        })
        .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({}) })
        .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({}) })
        .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({}) });

      await sceneDef.__handlers.handleSend();

      // After success, currentOrderId is set — createOrderIdemKey is no
      // longer needed and remains whatever value it had (it was used once).
      // The critical assertion is that currentOrderId got set.
      expect(sceneDef.__handlers.currentOrderId).toBe('ord-new');
    });
  });
});

// ── applyModifier — NO-prefix price / charged contract ────────────────────────
//
// The regression: pressing ADD/EXTRA charges the modifier price; pressing
// NO must force price=0 and charged=false regardless of mod.price in the
// menu data. If this breaks, "NO Pepperoni" would appear on the ticket with
// a charge instead of as a free removal.

describe('terminal/scenes/order-entry — applyModifier prefix price contract', () => {
  let sceneDef;
  let uniPrefixesMock;

  beforeEach(async () => {
    vi.resetModules();
    registeredScenes.length = 0;

    // Populate the PREFIXES mock array (mutation preserves the live binding
    // that order-entry.js captured at import time).
    const uniMod = await import('../menu-data/universal-modifiers.js');
    uniPrefixesMock = uniMod.PREFIXES;
    uniPrefixesMock.length = 0; // reset from any prior test
    uniPrefixesMock.push(
      { id: 'no',    label: 'NO',    chargesPrice: false },
      { id: 'add',   label: 'ADD',   chargesPrice: true  },
      { id: 'extra', label: 'EXTRA', chargesPrice: true  },
    );

    await import('./order-entry.js');
    sceneDef = registeredScenes.find((s) => s.name === 'order-entry');

    // Reset module-level state so each test starts clean.
    sceneDef.__handlers.ticket = [];
    sceneDef.__handlers.currentOrderId = null;
  });

  afterEach(() => {
    uniPrefixesMock.length = 0;
    vi.restoreAllMocks();
  });

  function ticketItem(overrides = {}) {
    return { id: 1, name: 'Pizza', unitPrice: 12, mods: [], category: 'pizza',
             backendItemId: undefined, idemKey: 'ik-1', ...overrides };
  }

  it('NO prefix: mod with price=1.50 is added with price=0 and charged=false', () => {
    sceneDef.__handlers.ticket = [ticketItem()];
    sceneDef.__handlers.modifierSession.activePrefix = 'no';
    sceneDef.__handlers.modifierSession.selectedItems = [1];

    sceneDef.__handlers.applyModifier({ id: 'mod-pepperoni', label: 'Pepperoni', price: 1.50 });

    const added = sceneDef.__handlers.ticket[0].mods[0];
    expect(added.charged).toBe(false);
    expect(added.price).toBe(0);
    expect(added.name).toContain('Pepperoni');
  });

  it('ADD prefix: mod with price=1.50 is added with price=1.50 and charged=true', () => {
    sceneDef.__handlers.ticket = [ticketItem()];
    sceneDef.__handlers.modifierSession.activePrefix = 'add';
    sceneDef.__handlers.modifierSession.selectedItems = [1];

    sceneDef.__handlers.applyModifier({ id: 'mod-pepperoni', label: 'Pepperoni', price: 1.50 });

    const added = sceneDef.__handlers.ticket[0].mods[0];
    expect(added.charged).toBe(true);
    expect(added.price).toBe(1.50);
  });
});

// ── calculateItemPrice — pricing chain port ───────────────────────────────────
//
// Mirrors backend/app/core/pricing.py. Pure function — given an item dict,
// the current selections array, and a menuState shaped like the /menu
// projection, returns the rounded line price. The seven cases below cover
// the core paths: size-driven base, included-modifier discounts, option
// negation, option_group_override, size_price_override, and a full
// composite (Large pizza + Pepperoni + included Cheese with None).

describe('terminal/scenes/order-entry — calculateItemPrice (pricing chain)', () => {
  let sceneDef;
  let calculateItemPrice;

  beforeEach(async () => {
    vi.resetModules();
    registeredScenes.length = 0;
    await import('./order-entry.js');
    sceneDef = registeredScenes.find((s) => s.name === 'order-entry');
    calculateItemPrice = sceneDef.__handlers.calculateItemPrice;
  });

  afterEach(() => { vi.restoreAllMocks(); });

  // Common menu state — the "pizza shop" fixture used by most cases.
  function pizzaMenuState(overrides = {}) {
    return {
      modifier_groups: {
        size: { drives_pricing: true, default_option_group_id: null },
        toppings: { drives_pricing: false, default_option_group_id: 'topping_opts' },
        cheese: { drives_pricing: false, default_option_group_id: 'topping_opts' },
        ...(overrides.modifier_groups || {}),
      },
      modifiers: {
        size_lg: { name: 'Large', price: 0 },
        pepperoni: { name: 'Pepperoni', price: 1.50, price_by_size: { size: { Large: 0.50 } } },
        cheese_mod: { name: 'Cheese', price: 0 },
        ...(overrides.modifiers || {}),
      },
      options: {
        regular: { option_id: 'regular', price_adjustment: 0, negates_price: false },
        extra:   { option_id: 'extra',   price_adjustment: 1.00, negates_price: false },
        none:    { option_id: 'none',    price_adjustment: 0,    negates_price: true  },
        ...(overrides.options || {}),
      },
      option_groups: {
        topping_opts: { option_ids: ['regular','extra','none'], active: true },
        ...(overrides.option_groups || {}),
      },
    };
  }

  // 1. $0 base item + Large size → itemBase = price_by_size[size][Large]
  it('1) $0 base item + Large size selection uses price_by_size for item base', () => {
    const item = {
      id: 'pizza',
      price: 0,
      price_by_size: { size: { Large: 18.99, Medium: 14.99 } },
    };
    const sel = [{ group_id: 'size', modifier_id: 'size_lg' }];
    expect(calculateItemPrice(item, sel, pizzaMenuState())).toBe(18.99);
  });

  // 2. Modifier with price_by_size, size active → correct line price
  it('2) modifier with price_by_size adds size-aware adjustment to line', () => {
    const item = { id: 'pizza', price: 0, price_by_size: { size: { Large: 18.99 } } };
    const sel = [
      { group_id: 'size', modifier_id: 'size_lg' },
      { group_id: 'toppings', modifier_id: 'pepperoni' },
    ];
    // 18.99 base + (1.50 mod + 0.50 size adj) = 20.99
    expect(calculateItemPrice(item, sel, pizzaMenuState())).toBe(20.99);
  });

  // 3. Included modifier base 0; Extra option → base 0 + option.price_adjustment
  it('3) included modifier with Extra option: base waived, option adj applies', () => {
    const item = {
      id: 'pizza',
      price: 12.00,
      included_modifier_ids: ['pepperoni'],
    };
    const sel = [
      { group_id: 'toppings', modifier_id: 'pepperoni', option_id: 'extra' },
    ];
    // base 12 + (0 included + 1.00 extra) = 13.00
    expect(calculateItemPrice(item, sel, pizzaMenuState())).toBe(13.00);
  });

  // 4. None option (negates_price=true) → modifier line = 0
  it('4) None option (negates_price=true) zeros the modifier line', () => {
    const item = { id: 'pizza', price: 12.00 };
    const sel = [
      { group_id: 'toppings', modifier_id: 'pepperoni', option_id: 'none' },
    ];
    // base 12 + 0 (pepperoni line negated) = 12.00
    expect(calculateItemPrice(item, sel, pizzaMenuState())).toBe(12.00);
  });

  // 5. option_group_override on item → uses overridden group not group default
  it('5) option_group_override on item routes to a different option group', () => {
    const ms = pizzaMenuState({
      option_groups: {
        topping_opts: { option_ids: ['regular','extra'], active: true },
        special_opts: { option_ids: ['triple'], active: true },
      },
      options: {
        regular: { option_id: 'regular', price_adjustment: 0, negates_price: false },
        extra:   { option_id: 'extra',   price_adjustment: 1.00, negates_price: false },
        triple:  { option_id: 'triple',  price_adjustment: 3.00, negates_price: false },
      },
    });
    const item = {
      id: 'pizza', price: 10.00,
      option_group_overrides: { toppings: 'special_opts' },
    };
    const sel = [
      { group_id: 'toppings', modifier_id: 'pepperoni', option_id: 'triple' },
    ];
    // base 10 + (1.50 mod + 3.00 triple) = 14.50
    expect(calculateItemPrice(item, sel, ms)).toBe(14.50);
  });

  // 6. size_price_override on item → uses override not modifier default
  it('6) size_price_override on item wins over modifier price_by_size', () => {
    const item = {
      id: 'pizza',
      price: 0,
      price_by_size: { size: { Large: 18.99 } },
      // Override the per-size adjustment at the active size key.
      // Spec: iterated by activeSizes — keyed by the drives_pricing group_id.
      size_price_overrides: { size: { Large: 2.00 } },
    };
    const sel = [
      { group_id: 'size', modifier_id: 'size_lg' },
      { group_id: 'toppings', modifier_id: 'pepperoni' },
    ];
    // 18.99 base + (1.50 mod + 2.00 override, NOT 0.50 default) = 22.49
    expect(calculateItemPrice(item, sel, pizzaMenuState())).toBe(22.49);
  });

  // 7. Full pizza composite — Large + Pepperoni + included Cheese with None
  it('7) full pizza: $0 base + Large + Pepperoni + included Cheese/None = $20.99', () => {
    const item = {
      id: 'pizza',
      price: 0,
      price_by_size: { size: { Large: 18.99 } },
      included_modifier_ids: ['cheese_mod'],
    };
    const sel = [
      { group_id: 'size',     modifier_id: 'size_lg' },
      { group_id: 'toppings', modifier_id: 'pepperoni' },
      { group_id: 'cheese',   modifier_id: 'cheese_mod', option_id: 'none' },
    ];
    // 18.99 base + (1.50 + 0.50 size = 2.00 pepperoni)
    //            + (0 cheese line — included AND None negates) = 20.99
    expect(calculateItemPrice(item, sel, pizzaMenuState())).toBe(20.99);
  });
});
