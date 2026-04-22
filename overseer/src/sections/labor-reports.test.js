// Tests for overseer/src/sections/labor-reports.js — pins the "federal
// overtime = weekly_hours > 40, not daily" contract at BOTH places it lives:
// the KPI card and the per-employee row. An earlier round fixed line 77 (KPI)
// and missed line 119 (row); these tests keep both in lockstep.
//
// OT math is embedded in the module-local `render()` closure. We drive it
// through the exported `buildLaborReportsScene(container)` entry point with a
// mocked `fetch`, then inspect the rendered DOM to verify the displayed hours.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// The scene imports buildDatePicker — stub it so tests don't require the real
// date-picker component's DOM footprint.
vi.mock('../components/date-picker.js', () => ({
  buildDatePicker: () => document.createElement('div'),
}));

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

async function mount(container, fetchPayload) {
  const fetchMock = vi.fn(() => Promise.resolve(jsonResponse(fetchPayload)));
  window.fetch = fetchMock;

  const { buildLaborReportsScene } = await import('./labor-reports.js');
  buildLaborReportsScene(container);

  // render() is kicked off as a fire-and-forget inside buildLaborReportsScene;
  // wait for the employee table to appear before asserting.
  await vi.waitFor(() => {
    expect(container.textContent).toMatch(/Employee/i);
  });
  return { fetchMock };
}

// Grab the value rendered inside the Overtime KPI card (the second of four).
function kpiOvertimeValue(container) {
  const cards = container.querySelectorAll('div');
  for (const card of cards) {
    // Cards contain a label div with "OVERTIME" (text-transform:uppercase on
    // the label) and a sibling value div.
    const label = card.querySelector('div');
    if (label && label.textContent.trim().toLowerCase() === 'overtime') {
      // Sibling value div is the next child of the same card.
      return card.children[1]?.textContent.trim();
    }
  }
  return null;
}

// Find the row for a given employee name and return the text in its Overtime
// cell (third grid column).
function rowOvertime(container, name) {
  const rows = container.querySelectorAll('div[style*="grid-template-columns"]');
  for (const row of rows) {
    if (row.textContent.includes(name)) {
      const cells = row.querySelectorAll('span');
      if (cells.length >= 3) return cells[2].textContent.trim();
    }
  }
  return null;
}

describe('overseer/src/sections/labor-reports', () => {
  let originalFetch;
  let container;

  beforeEach(() => {
    vi.resetModules();
    originalFetch = window.fetch;
    container = document.createElement('div');
    document.body.appendChild(container);
  });

  afterEach(() => {
    window.fetch = originalFetch;
    container.remove();
    vi.restoreAllMocks();
  });

  it('weekly_hours > 40 lights up per-employee OT (daily `hours` is irrelevant)', async () => {
    // Alice: weekly 50 → OT 10h. Daily `hours` is 8, which must NOT trigger OT.
    await mount(container, {
      employees: [
        { employee_id: 'e1', name: 'Alice', hours: 8, weekly_hours: 50, hourly_rate: 15 },
      ],
      net_sales: 1000,
    });

    expect(rowOvertime(container, 'Alice')).toBe('10.00h');
    expect(kpiOvertimeValue(container)).toBe('10.00h');
  });

  it('weekly_hours ≤ 40 shows no overtime, even when daily `hours` is huge', async () => {
    // Bob pulled one big shift today (50h) but his weekly total is 30h — no OT.
    // This is the specific regression: the row used to compute OT from daily
    // `hours` and would show "10.00h" here. It must show "—".
    await mount(container, {
      employees: [
        { employee_id: 'e2', name: 'Bob', hours: 50, weekly_hours: 30, hourly_rate: 18 },
      ],
      net_sales: 1000,
    });

    expect(rowOvertime(container, 'Bob')).toBe('—');
    expect(kpiOvertimeValue(container)).toBe('0.00h');
  });

  it('KPI OT total equals sum of per-employee OT across the roster', async () => {
    // Alice weekly 50 → 10 OT. Cara weekly 45 → 5 OT. Dan weekly 20 → 0 OT.
    // Total = 15 OT. This keeps KPI and rows in agreement across a roster.
    await mount(container, {
      employees: [
        { employee_id: 'e1', name: 'Alice', hours: 8, weekly_hours: 50, hourly_rate: 15 },
        { employee_id: 'e3', name: 'Cara',  hours: 9, weekly_hours: 45, hourly_rate: 20 },
        { employee_id: 'e4', name: 'Dan',   hours: 4, weekly_hours: 20, hourly_rate: 16 },
      ],
      net_sales: 2000,
    });

    expect(rowOvertime(container, 'Alice')).toBe('10.00h');
    expect(rowOvertime(container, 'Cara')).toBe('5.00h');
    expect(rowOvertime(container, 'Dan')).toBe('—');
    expect(kpiOvertimeValue(container)).toBe('15.00h');
  });
});
