// Tests for overseer/src/data/sample-payroll.js — pins totalWages / totalTips
// in laborSummary. Previously both fields were never assigned, so every tips +
// wages KPI on the dashboard read $0.00 and the CSV export shipped undefined.
//
// PAYROLL_SUMMARY is `export let` and reassigned inside loadPayrollData(). The
// module namespace object (`import * as mod`) reads the live binding, so any
// post-load read returns the new value.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('overseer/src/data/sample-payroll', () => {
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

  it('loadPayrollData populates totalWages and totalTips (2dp rounded) from the per-employee rows', async () => {
    // 3 employees; use gross_pay so it flows through the mapper unchanged.
    // Sum(grossPay) = 150.00 + 240.50 + 800.25 = 1190.75
    // Sum(tips)     =  10.55 +  20.50 +   5.00 =   36.05
    fetchMock.mockResolvedValueOnce(jsonResponse({
      net_sales: 4000,
      employees: [
        { employee_id: 'e1', name: 'A', hours: 10, hourly_rate: 15.00, gross_pay: 150.00, tips: 10.55 },
        { employee_id: 'e2', name: 'B', hours: 20, hourly_rate: 12.00, gross_pay: 240.50, tips: 20.50 },
        { employee_id: 'e3', name: 'C', hours: 40, hourly_rate: 20.00, gross_pay: 800.25, tips:  5.00 },
      ],
    }));

    const mod = await import('./sample-payroll.js');
    await mod.loadPayrollData();

    expect(mod.PAYROLL_SUMMARY.laborSummary.totalWages).toBe(1190.75);
    expect(mod.PAYROLL_SUMMARY.laborSummary.totalTips).toBe(36.05);
    // Sanity: both totals are finite numbers, not undefined. Exports that read
    // these fields (payroll-tips.js summary cards) format via fmt$ — undefined
    // breaks the format call, 0 does not.
    expect(Number.isFinite(mod.PAYROLL_SUMMARY.laborSummary.totalWages)).toBe(true);
    expect(Number.isFinite(mod.PAYROLL_SUMMARY.laborSummary.totalTips)).toBe(true);
  });

  it('empty employees array → totalWages and totalTips are 0, not undefined', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ net_sales: 0, employees: [] }));

    const mod = await import('./sample-payroll.js');
    await mod.loadPayrollData();

    expect(mod.PAYROLL_SUMMARY.laborSummary.totalWages).toBe(0);
    expect(mod.PAYROLL_SUMMARY.laborSummary.totalTips).toBe(0);
  });

  it('loader-failure path preserves the numeric shape (no undefined reaching fmt$)', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('NetworkError'));

    const mod = await import('./sample-payroll.js');
    await mod.loadPayrollData();

    // On exception the catch block repopulates employees from the local
    // fixture (empty by default in tests since EMPLOYEES is mutable) and
    // leaves laborSummary at its initial values (all numeric zeros).
    const ls = mod.PAYROLL_SUMMARY.laborSummary;
    expect(ls).toBeDefined();
    expect(typeof ls.totalWages).toBe('number');
    expect(typeof ls.totalTips).toBe('number');
    expect(Number.isNaN(ls.totalWages)).toBe(false);
    expect(Number.isNaN(ls.totalTips)).toBe(false);
  });

  it('res.ok === false (e.g. 500) leaves the prior summary untouched (numeric shape preserved)', async () => {
    fetchMock.mockResolvedValueOnce(new Response('server error', { status: 500 }));

    const mod = await import('./sample-payroll.js');
    await mod.loadPayrollData();

    // Early-return path inside loadPayrollData: no reassignment at all.
    const ls = mod.PAYROLL_SUMMARY.laborSummary;
    expect(typeof ls.totalWages).toBe('number');
    expect(typeof ls.totalTips).toBe('number');
  });
});
