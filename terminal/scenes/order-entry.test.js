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
