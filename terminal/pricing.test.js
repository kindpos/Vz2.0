// Tests for terminal/pricing.js — the single source of truth for TAX_RATE
// and CASH_DISCOUNT. Four scenes used to keep their own copies of these
// constants; drift between them is why this module exists. These tests pin
// the numeric contract so a "small" refactor can't silently move money.
//
// On import the module fires off a fetch to /api/v1/config/pricing. Tests
// stub fetch before each dynamic import so the side-effect call is observed
// and the module starts from a known state.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('terminal/pricing', () => {
  let fetchMock;
  let originalFetch;

  beforeEach(() => {
    vi.resetModules();
    originalFetch = window.fetch;
    fetchMock = vi.fn();
    window.fetch = fetchMock;
  });

  afterEach(() => {
    window.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  // ── Defaults + loader ───────────────────────────────────────────

  it('defaults: 7% tax and 4% cash discount before /config/pricing resolves', async () => {
    // Never resolve — tests the pre-load default state.
    fetchMock.mockImplementation(() => new Promise(() => {}));

    const mod = await import('./pricing.js');

    expect(mod.getTaxRate()).toBe(0.07);
    expect(mod.getCashDiscount()).toBe(0.04);
    expect(mod.getRates()).toEqual({ taxRate: 0.07, cashDiscount: 0.04 });
  });

  it('ratesReady() resolves once /config/pricing responds; rates update from server', async () => {
    fetchMock.mockResolvedValue(jsonResponse({
      tax_rate: 0.0875,
      cash_discount_rate: 0.03,
    }));

    const mod = await import('./pricing.js');
    await mod.ratesReady();

    expect(mod.getTaxRate()).toBe(0.0875);
    expect(mod.getCashDiscount()).toBe(0.03);
    // Fetch happens exactly once — subsequent ratesReady() calls return the cached promise.
    await mod.ratesReady();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('load failure keeps defaults (no NaN, no undefined leaking into totals)', async () => {
    fetchMock.mockRejectedValue(new TypeError('NetworkError'));

    const mod = await import('./pricing.js');
    await mod.ratesReady();

    expect(mod.getTaxRate()).toBe(0.07);
    expect(mod.getCashDiscount()).toBe(0.04);
  });

  it('null fields in the response leave the existing rates untouched (partial payload)', async () => {
    fetchMock.mockResolvedValue(jsonResponse({
      tax_rate: null,
      cash_discount_rate: 0.05,
    }));

    const mod = await import('./pricing.js');
    await mod.ratesReady();

    expect(mod.getTaxRate()).toBe(0.07);       // unchanged
    expect(mod.getCashDiscount()).toBe(0.05);  // updated
  });

  // ── computeTotals ───────────────────────────────────────────────

  it('computeTotals at defaults: $100 subtotal → $7 tax, $107 card, $102.72 cash', async () => {
    fetchMock.mockImplementation(() => new Promise(() => {}));
    const mod = await import('./pricing.js');

    expect(mod.computeTotals(100)).toEqual({
      subtotal:  100,
      tax:       7,
      cardTotal: 107,
      // 107 * (1 - 0.04) = 102.72
      cashPrice: 102.72,
    });
  });

  it('computeTotals rounds every field to cents (no FP drift)', async () => {
    fetchMock.mockImplementation(() => new Promise(() => {}));
    const mod = await import('./pricing.js');

    // Subtotal that exercises FP: 19.99 * 0.07 = 1.3993 → 1.40
    const t = mod.computeTotals(19.99);
    expect(t.subtotal).toBe(19.99);
    expect(t.tax).toBe(1.40);
    expect(t.cardTotal).toBe(21.39);
    // Card total rounded pre-cash → 21.3893 * 0.96 = 20.533728 → 20.53
    expect(t.cashPrice).toBe(20.53);

    // No field exceeds 2dp.
    Object.values(t).forEach((v) => {
      expect(String(v).split('.')[1]?.length ?? 0).toBeLessThanOrEqual(2);
    });
  });

  it('computeTotals handles 0 subtotal without NaN', async () => {
    fetchMock.mockImplementation(() => new Promise(() => {}));
    const mod = await import('./pricing.js');
    expect(mod.computeTotals(0)).toEqual({ subtotal: 0, tax: 0, cardTotal: 0, cashPrice: 0 });
  });

  // ── totalsForOrder ──────────────────────────────────────────────

  it('totalsForOrder uses the backend-computed order.total + order.balance_due when present', async () => {
    fetchMock.mockImplementation(() => new Promise(() => {}));
    const mod = await import('./pricing.js');

    const t = mod.totalsForOrder({ total: 107, subtotal: 100, balance_due: 50 }, 0);

    expect(t.cardTotal).toBe(107);
    expect(t.subtotal).toBe(100);
    expect(t.tax).toBe(7);              // 107 - 100
    expect(t.balanceDue).toBe(50);
    expect(t.cashPrice).toBe(102.72);   // 107 * (1 - 0.04)
  });

  it('totalsForOrder derives subtotal from total/tax when only total is present', async () => {
    fetchMock.mockImplementation(() => new Promise(() => {}));
    const mod = await import('./pricing.js');

    // cardTotal = 107; derived subtotal = 107 / 1.07 = 100; derived tax = 7.
    const t = mod.totalsForOrder({ total: 107 }, 0);
    expect(t.subtotal).toBe(100);
    expect(t.tax).toBe(7);
    expect(t.balanceDue).toBe(107); // balance_due missing → falls back to cardTotal
  });

  it('totalsForOrder falls back to computeTotals(fallbackSubtotal) when order is missing', async () => {
    fetchMock.mockImplementation(() => new Promise(() => {}));
    const mod = await import('./pricing.js');

    expect(mod.totalsForOrder(null, 100)).toEqual(mod.computeTotals(100));
    expect(mod.totalsForOrder(undefined, 100)).toEqual(mod.computeTotals(100));
    expect(mod.totalsForOrder({}, 100)).toEqual(mod.computeTotals(100));
  });
});
