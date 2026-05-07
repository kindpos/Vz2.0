// Tests for overseer/src/sections/labor-reports.js — pins the "federal
// overtime = weekly_hours > 40, not daily" contract at BOTH places it lives:
// the KPI card and the per-employee row. An earlier round fixed the KPI math
// but left the row computing OT from daily `hours`; these tests keep both in
// lockstep regardless of how the Nostalgia-themed DOM is wired.
//
// OT math is embedded in the module-local `renderHero()` / `renderBreakdown()`
// functions. We drive it through the exported `buildLaborReportsScene(container)`
// entry point with a mocked `fetch`, then inspect the rendered DOM to verify
// the displayed hours.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// The scene imports buildDatePicker — stub it so tests don't require the real
// date-picker component's DOM footprint.
vi.mock('../components/date-picker.js', () => ({
  buildDatePicker: () => document.createElement('div'),
}));

const jsonResponse = (body, status = 200) => {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

// fetch mock — the scene hits three endpoints: labor-summary (required),
// config/employees and config/roles (optional, used for the MGR badge).
// We return the labor-summary payload and empty arrays for the other two.
const installFetchMock = (laborPayload) => {
  const fetchMock = vi.fn((url) => {
    if (typeof url === 'string' && url.includes('/reports/labor-summary')) {
      return Promise.resolve(jsonResponse(laborPayload));
    }
    // employees / roles
    return Promise.resolve(jsonResponse([]));
  });
  window.fetch = fetchMock;
  return fetchMock;
}

const mount = async (container, laborPayload) => {
  const fetchMock = installFetchMock(laborPayload);

  const { buildLaborReportsScene } = await import('./labor-reports.js');
  buildLaborReportsScene(container);

  // renderAll is fire-and-forget; wait for the employee breakdown region
  // to be populated (i.e. stops saying "Loading…").
  await vi.waitFor(() => {
    expect(container.textContent).toMatch(/Employee Breakdown/i);
    expect(container.textContent).not.toMatch(/Loading…/);
  }, { timeout: 2000 });

  return { fetchMock };
}

// Find the Overtime KPI stat card and return its big-number value. The hero
// row lives in #region-hero and each card contains a mono-caps eyebrow
// ("OVERTIME") above a 36px value element (the only child with font-size:36px).
const kpiOvertimeValue = (container) => {
  const hero = container.querySelector('#region-hero');
  if (!hero) return null;
  for (const card of hero.children) {
    if (!/overtime/i.test(card.textContent)) continue;
    // Grab every element in the card and pick the first with the big 36px
    // value font-size; that's the number buildStatCard renders.
    for (const el of card.querySelectorAll('*')) {
      if ((el.getAttribute('style') || '').includes('font-size: 36px')) {
        return el.textContent.trim();
      }
    }
  }
  return null;
}

// Find the OT cell for a given employee in the breakdown mini-table.
// buildMiniTable lays each row out as a grid whose cells carry only the
// `display: grid` container; each cell is an inner <div> with a <span>
// for the text. The breakdown columns are:
//   0 Employee · 1 In · 2 Out · 3 Today · 4 OT · 5 Rate · 6 Gross
const rowOvertime = (container, name) => {
  const scope = container.querySelector('#region-breakdown') || container;
  const rows = scope.querySelectorAll('div[style*="grid-template-columns"]');
  for (const row of rows) {
    // Skip header rows (no employee names, but they start with the column
    // labels). Match only rows whose first cell text exactly contains the
    // employee name.
    if (!row.textContent.includes(name)) continue;
    const cells = row.children;
    if (cells.length < 7) continue;    // not a breakdown data row
    // Each cell's visible text is the first <span> inside it.
    const otCell = cells[4];
    const span = otCell && otCell.querySelector('span');
    if (span) return span.textContent.trim();
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
        { id: 'e1', name: 'Alice', hours: 8, weekly_hours: 50, hourly_rate: 15, gross_pay: 120 },
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
        { id: 'e2', name: 'Bob', hours: 50, weekly_hours: 30, hourly_rate: 18, gross_pay: 900 },
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
        { id: 'e1', name: 'Alice', hours: 8, weekly_hours: 50, hourly_rate: 15, gross_pay: 120 },
        { id: 'e3', name: 'Cara',  hours: 9, weekly_hours: 45, hourly_rate: 20, gross_pay: 180 },
        { id: 'e4', name: 'Dan',   hours: 4, weekly_hours: 20, hourly_rate: 16, gross_pay: 64 },
      ],
      net_sales: 2000,
    });

    expect(rowOvertime(container, 'Alice')).toBe('10.00h');
    expect(rowOvertime(container, 'Cara')).toBe('5.00h');
    expect(rowOvertime(container, 'Dan')).toBe('—');
    expect(kpiOvertimeValue(container)).toBe('15.00h');
  });
});
