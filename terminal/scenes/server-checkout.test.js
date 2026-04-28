// Tests for the exported fetchServerState() in terminal/scenes/server-checkout.js.
//
// fetchServerState aggregates four API calls and applies client-side data
// scrubbing. We mock fetchWithTimeout to control API responses and verify
// the scrubbing, math, and categorisation logic without any real network.

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mocks ─────────────────────────────────────────────────────────────────────

vi.mock('../../common/tokens.js', () => ({
  T: {
    green: '#86efac', greenDk: '#4ade80', greenWarm: '#86efac', greenWarmDk: '#4ade80',
    verm: '#e8472a', vermDk: '#c03d22', elec: '#00e5ff', elecDk: '#00b3cc',
    gold: '#f59e0b', text: '#ddd', well: '#22252a', bg: '#383c42',
    card: '#2d3139', border: '#4a4f57', lavender: '#c4b5fd', moon: '#8090a0',
    fb: 'sans-serif', fh: 'serif', fwBold: '700', fsB2: 14,
    pillRadius: '8px', transitionFast: '0.1s ease',
  },
}));
vi.mock('../scene-manager.js', () => ({
  SceneManager: { on: vi.fn(), off: vi.fn(), emit: vi.fn(), mountWorking: vi.fn(), openTransactional: vi.fn() },
  defineScene:   vi.fn(),
}));
vi.mock('../components.js',    () => ({ showToast: vi.fn() }));
vi.mock('../order-summary.js', () => ({ OrderSummary: { show: vi.fn(), hide: vi.fn(), update: vi.fn() } }));
vi.mock('../theme-manager.js', () => ({
  buildStaticCard: () => { const el = document.createElement('div'); el.setAccent = vi.fn(); return el; },
  buildNavCard:    () => document.createElement('div'),
  buildActionCard: () => { const el = document.createElement('div'); el.setAccent = vi.fn(); return el; },
  buildPillButton: ({ label } = {}) => { const b = document.createElement('button'); b.textContent = label || ''; b.setDisabled = vi.fn(); b.setColor = vi.fn(); return b; },
  hexToRgba: (c) => c,
  darkenHex:  (c) => c,
}));
vi.mock('./checkout-core.js', () => ({
  fmt:         (n) => '$' + Number(n).toFixed(2),
  detailRow:   () => document.createElement('div'),
  detailDivider: () => document.createElement('div'),
}));
vi.mock('../net.js', () => ({ fetchWithTimeout: vi.fn() }));

import { fetchServerState } from './server-checkout.js';
import { fetchWithTimeout }  from '../net.js';

// ── Helper ────────────────────────────────────────────────────────────────────

function resp(data) {
  return Promise.resolve({ json: () => Promise.resolve(data) });
}

function setupFetch({ summary = {}, tipout = [], store = {}, orders = [] } = {}) {
  fetchWithTimeout.mockImplementation((url) => {
    if (url.includes('day-summary')) return resp(summary);
    if (url.includes('/config/tipout')) return resp(tipout);
    if (url.includes('/config/store'))  return resp(store);
    if (url.includes('/orders?'))       return resp(orders);
    return resp({});
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

// ── Missing employee ID ───────────────────────────────────────────────────────

describe('fetchServerState — guard', () => {
  it('rejects immediately when employeeId is missing', async () => {
    await expect(fetchServerState({})).rejects.toThrow('missing employee id');
    expect(fetchWithTimeout).not.toHaveBeenCalled();
  });

  it('rejects when employeeId is an empty string', async () => {
    await expect(fetchServerState({ employeeId: '' })).rejects.toThrow('missing employee id');
  });
});

// ── Order scrubbing ───────────────────────────────────────────────────────────

describe('fetchServerState — order scrubbing', () => {
  it('keeps only orders whose server_id matches the employee', async () => {
    setupFetch({
      summary: { net_sales: 0, checks: [] },
      orders: [
        { order_id: 'o1', server_id: 'emp-1' },
        { order_id: 'o2', server_id: 'emp-2' }, // mismatched — dropped
        { order_id: 'o3' },                      // no server_id  — dropped
      ],
    });
    const result = await fetchServerState({ employeeId: 'emp-1' });
    expect(result.allOrders).toHaveLength(1);
    expect(result.allOrders[0].order_id).toBe('o1');
  });

  it('returns an empty allOrders array when all orders belong to other servers', async () => {
    setupFetch({
      summary: { net_sales: 0, checks: [] },
      orders: [{ order_id: 'o1', server_id: 'other' }],
    });
    const result = await fetchServerState({ employeeId: 'emp-1' });
    expect(result.allOrders).toHaveLength(0);
  });

  it('handles a non-array orders response gracefully (returns empty)', async () => {
    setupFetch({ summary: { net_sales: 0, checks: [] }, orders: null });
    const result = await fetchServerState({ employeeId: 'emp-1' });
    expect(result.allOrders).toHaveLength(0);
  });
});

// ── Check scrubbing (asymmetric) ──────────────────────────────────────────────

describe('fetchServerState — check scrubbing', () => {
  it('keeps checks with matching server_id and checks without any server_id', async () => {
    setupFetch({
      summary: {
        net_sales: 0,
        checks: [
          { checkId: 'c1', status: 'open', server_id: 'emp-1' }, // match — kept
          { checkId: 'c2', status: 'open', server_id: 'emp-2' }, // mismatch — dropped
          { checkId: 'c3', status: 'open' },                      // no server_id — kept (trusts URL)
        ],
      },
    });
    const result = await fetchServerState({ employeeId: 'emp-1' });
    expect(result.checks).toHaveLength(2);
    const ids = result.checks.map((c) => c.checkId);
    expect(ids).toContain('c1');
    expect(ids).toContain('c3');
    expect(ids).not.toContain('c2');
  });

  it('enriches checks with tableLabel from the matching order', async () => {
    setupFetch({
      summary: {
        net_sales: 0,
        checks: [{ checkId: 'ord-1', status: 'open' }],
      },
      orders: [{ order_id: 'ord-1', server_id: 'emp-1', table: 'Table 7' }],
    });
    const result = await fetchServerState({ employeeId: 'emp-1' });
    expect(result.checks[0].tableLabel).toBe('Table 7');
  });
});

// ── Tip-out math ──────────────────────────────────────────────────────────────

describe('fetchServerState — tip-out aggregation', () => {
  it('sums tipout percentages across all rules', async () => {
    setupFetch({
      summary: { net_sales: 1000, cash_total: 0, card_tips: 0, cash_tips: 0, checks: [] },
      tipout:  [{ percentage: 5 }, { percentage: 3 }],
    });
    const result = await fetchServerState({ employeeId: 'emp-1' });
    expect(result.tipOutRate).toBeCloseTo(0.08, 5);
    expect(result.tipOutTotal).toBeCloseTo(80, 5);
  });

  it('computes takeHome = (cardTips + cashTips) − tipOutTotal', async () => {
    setupFetch({
      summary: { net_sales: 1000, cash_total: 0, card_tips: 60, cash_tips: 20, checks: [] },
      tipout:  [{ percentage: 5 }],
    });
    const result = await fetchServerState({ employeeId: 'emp-1' });
    // tipOutTotal = 1000 * 0.05 = 50; takeHome = (60 + 20) - 50 = 30
    expect(result.takeHome).toBeCloseTo(30, 5);
  });

  it('computes cashExpected = cashSales − cardTips', async () => {
    setupFetch({
      summary: { net_sales: 500, cash_total: 200, card_tips: 40, cash_tips: 0, checks: [] },
    });
    const result = await fetchServerState({ employeeId: 'emp-1' });
    expect(result.cashExpected).toBeCloseTo(160, 5);
  });

  it('returns zero rate and tipOutTotal when no rules are defined', async () => {
    setupFetch({
      summary: { net_sales: 500, cash_total: 0, card_tips: 0, cash_tips: 0, checks: [] },
      tipout:  [],
    });
    const result = await fetchServerState({ employeeId: 'emp-1' });
    expect(result.tipOutRate).toBe(0);
    expect(result.tipOutTotal).toBe(0);
  });

  it('handles a rule with a null percentage as 0 (no NaN)', async () => {
    setupFetch({
      summary: { net_sales: 200, cash_total: 0, card_tips: 0, cash_tips: 0, checks: [] },
      tipout:  [{ percentage: null }, { percentage: 5 }],
    });
    const result = await fetchServerState({ employeeId: 'emp-1' });
    expect(Number.isNaN(result.tipOutTotal)).toBe(false);
    expect(result.tipOutTotal).toBeCloseTo(10, 5); // 200 * 0.05
  });
});

// ── Check categorisation ──────────────────────────────────────────────────────

describe('fetchServerState — check categorisation', () => {
  function checks() {
    return [
      { checkId: 'open-1',   status: 'open' },
      { checkId: 'unadj-1',  status: 'closed', method: 'card', adjusted: false },
      { checkId: 'adj-1',    status: 'closed', method: 'card', adjusted: true  },
      { checkId: 'cash-1',   status: 'closed', method: 'cash' },
    ];
  }

  it('openChecks contains only status=open checks', async () => {
    setupFetch({ summary: { net_sales: 0, checks: checks() } });
    const result = await fetchServerState({ employeeId: 'emp-1' });
    expect(result.openChecks).toHaveLength(1);
    expect(result.openChecks[0].checkId).toBe('open-1');
  });

  it('unadjustedChecks contains closed card checks without adjusted flag', async () => {
    setupFetch({ summary: { net_sales: 0, checks: checks() } });
    const result = await fetchServerState({ employeeId: 'emp-1' });
    expect(result.unadjustedChecks).toHaveLength(1);
    expect(result.unadjustedChecks[0].checkId).toBe('unadj-1');
  });

  it('adjustedChecks contains closed card checks with adjusted:true', async () => {
    setupFetch({ summary: { net_sales: 0, checks: checks() } });
    const result = await fetchServerState({ employeeId: 'emp-1' });
    expect(result.adjustedChecks).toHaveLength(1);
    expect(result.adjustedChecks[0].checkId).toBe('adj-1');
  });

  it('cash checks appear in none of the three special categories', async () => {
    setupFetch({ summary: { net_sales: 0, checks: checks() } });
    const result = await fetchServerState({ employeeId: 'emp-1' });
    const specialIds = [
      ...result.openChecks,
      ...result.unadjustedChecks,
      ...result.adjustedChecks,
    ].map((c) => c.checkId);
    expect(specialIds).not.toContain('cash-1');
  });

  it('no check appears in more than one special category', async () => {
    setupFetch({ summary: { net_sales: 0, checks: checks() } });
    const result = await fetchServerState({ employeeId: 'emp-1' });
    const all = [
      ...result.openChecks.map((c) => c.checkId),
      ...result.unadjustedChecks.map((c) => c.checkId),
      ...result.adjustedChecks.map((c) => c.checkId),
    ];
    expect(new Set(all).size).toBe(all.length); // no duplicates
  });
});

// ── Tipout config fallback ────────────────────────────────────────────────────

describe('fetchServerState — API resilience', () => {
  it('defaults to zero rate when the tipout endpoint fails', async () => {
    fetchWithTimeout.mockImplementation((url) => {
      if (url.includes('day-summary')) return resp({ net_sales: 100, checks: [] });
      if (url.includes('/config/tipout')) return Promise.reject(new Error('timeout'));
      return resp({});
    });
    const result = await fetchServerState({ employeeId: 'emp-1' });
    expect(result.tipOutTotal).toBe(0);
  });

  it('uses a fallback store name when the store endpoint fails', async () => {
    fetchWithTimeout.mockImplementation((url) => {
      if (url.includes('day-summary')) return resp({ net_sales: 0, checks: [] });
      if (url.includes('/config/store')) return Promise.reject(new Error('timeout'));
      return resp({});
    });
    const result = await fetchServerState({ employeeId: 'emp-1' });
    expect(result.restaurantName).toBe('KINDpos/lite');
  });
});
