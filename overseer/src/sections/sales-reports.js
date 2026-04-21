/* ============================================
   KINDpos Overseer — Sales Reports scene (v2)

   Weekly Sales landing. Replaces the previous Daily Flash
   drill-down chain (sections/reporting.js) under the same
   `sales-reports` nav id.

   Current state:
     - Scene shell (header, toolbar, sub-tabs)
     - Region 1: hero stat row (Net Sales / Covers / Avg Check / Tip %)
       fed by GET /api/v1/reports/sales-summary?date=today
     - Remaining regions (trend, composition, tender, heatmap,
       histogram, top-items, top-servers) will be added in
       subsequent phases as their data sources are wired.

   No fabricated numbers — every value on screen comes from the
   backend response (or a loading/error placeholder).

   Style reference: sections/home.js.
   ============================================ */

import { T }                from '../ui/tokens.js';
import {
  buildStatCard,
  buildLineCard,
  buildCOBGauge,
  buildStackedArea,
  buildTenderBar,
  buildHeatmap,
  buildHistogram,
  buildMiniTable,
} from '../ui/charts.js';
import { fmt, fmtPct, fmtInt, fmtPP } from '../ui/money.js';

// ─── Module state ────────────────────────────────────────────────────
let _currentContainer = null;
let _abortController  = null;

// ─── Utilities ───────────────────────────────────────────────────────
function today() {
  return new Date().toISOString().slice(0, 10);
}

function daysAgo(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
}

function todayLabel() {
  const d = new Date();
  const days = ['SUN','MON','TUE','WED','THU','FRI','SAT'];
  const months = ['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'];
  return `${days[d.getDay()]} · ${months[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
}

// Format an hour-of-day integer (0..23) as a short ampm label.
function formatHour(h) {
  const n = Number(h);
  if (!Number.isFinite(n)) return String(h || '');
  if (n === 0)  return '12a';
  if (n < 12)   return `${n}a`;
  if (n === 12) return '12p';
  return `${n - 12}p`;
}

// ─── Fetch ───────────────────────────────────────────────────────────
async function fetchJson(url, signal) {
  const res = await fetch(url, { signal });
  if (!res.ok) throw new Error(`${url} ${res.status}`);
  return res.json();
}

function fetchSummary(signal) {
  return fetchJson(`/api/v1/reports/sales-summary?date=${today()}`, signal);
}
function fetchLastWeekSummary(signal) {
  return fetchJson(`/api/v1/reports/sales-summary?date=${daysAgo(7)}`, signal);
}
function fetchHourlyCompare(signal) {
  return fetchJson(`/api/v1/reports/hourly-compare?date=${today()}`, signal);
}
function fetchLabor(signal) {
  return fetchJson(`/api/v1/reports/labor-summary?date=${today()}`, signal);
}
function fetchEmployees(signal) {
  return fetchJson(`/api/v1/config/employees`, signal);
}
function fetchRoles(signal) {
  return fetchJson(`/api/v1/config/roles`, signal);
}

// Cross-reference employees ↔ roles into a lookup map so the servers
// table can badge non-server rows (managers) and dim their tip%.
//
//   { [employee_id]: { isManager: bool, roleName: string } }
//
// "Manager" is detected via role.permission_level (backend uses
// "Standard" / "Elevated" / "Manager"). If either feed is missing
// we return an empty map and the table simply has no badges.
function buildRoleMap(employees, roles) {
  const rolesById = new Map();
  for (const r of (roles || [])) rolesById.set(r.role_id, r);
  const map = new Map();
  for (const e of (employees || [])) {
    const eRoles = (e.role_ids || []).map(id => rolesById.get(id)).filter(Boolean);
    const isManager = eRoles.some(r =>
      (r.permission_level || '').toLowerCase() === 'manager'
    );
    const roleName = eRoles.map(r => r.name).filter(Boolean).join(', ');
    map.set(e.employee_id, { isManager, roleName });
  }
  return map;
}

// ─── Layout ──────────────────────────────────────────────────────────
function buildLayout(container) {
  container.innerHTML = `
    <style>
      .sales-wrapper {
        padding: 30px 32px;
        color: ${T.text};
        font-family: ${T.font.body};
      }

      /* ── Header row ─────────────────────────────────────────── */
      .sales-header {
        display: flex;
        justify-content: space-between;
        align-items: flex-end;
        margin-bottom: 24px;
        gap: 24px;
      }
      .sales-header-left { min-width: 0; }
      .sales-eyebrow {
        font-family: ${T.font.mono};
        font-size: ${T.fs.md}px;
        letter-spacing: 3px;
        color: ${T.mint};
        font-weight: 700;
        text-transform: uppercase;
        margin-bottom: 8px;
      }
      .sales-title {
        font-size: ${T.fs.hero}px;
        font-weight: 700;
        line-height: 1;
        margin-bottom: 8px;
      }
      .sales-subtitle {
        font-family: ${T.font.mono};
        font-size: ${T.fs.md}px;
        letter-spacing: 2px;
        color: ${T.textMuted};
      }

      /* ── Toolbar (range picker, compare chip, export) ───────── */
      .sales-toolbar {
        display: flex;
        gap: 10px;
        align-items: center;
        flex-shrink: 0;
      }
      .sales-chip {
        display: inline-flex;
        align-items: center;
        gap: 8px;
        padding: 8px 14px;
        border-radius: ${T.r.sm}px;
        border: 1px solid var(--chip-border);
        color: var(--chip-color);
        background: transparent;
        font-family: ${T.font.mono};
        font-size: ${T.fs.sm}px;
        letter-spacing: 1.5px;
        text-transform: uppercase;
        font-weight: 700;
        white-space: nowrap;
        cursor: default;
      }
      .sales-chip-range {
        --chip-border: ${T.mint};
        --chip-color: ${T.mint};
      }
      .sales-chip-compare {
        --chip-border: ${T.lavender};
        --chip-color: ${T.lavender};
      }
      .sales-chip-caret {
        font-size: 9px;
        opacity: 0.7;
      }
      .sales-export {
        padding: 8px 18px;
        border-radius: ${T.r.pill}px;
        border: none;
        background: ${T.gold};
        color: #1a1d21;
        font-family: ${T.font.mono};
        font-size: ${T.fs.sm}px;
        letter-spacing: 1.8px;
        text-transform: uppercase;
        font-weight: 700;
        white-space: nowrap;
        cursor: default;
      }

      /* ── Sub-tab strip ──────────────────────────────────────── */
      .sales-subtabs {
        display: flex;
        gap: 0;
        border-bottom: 1px solid ${T.well};
        margin-bottom: 24px;
      }
      .sales-subtab {
        padding: 12px 20px;
        font-family: ${T.font.mono};
        font-size: ${T.fs.md}px;
        letter-spacing: 2px;
        font-weight: 700;
        text-transform: uppercase;
        color: ${T.textMuted};
        border-bottom: 2px solid transparent;
        margin-bottom: -1px;
        cursor: default;
      }
      .sales-subtab.active {
        color: ${T.mint};
        border-bottom-color: ${T.mint};
      }

      /* ── Regions ─────────────────────────────────────────────── */
      .sales-regions {
        min-height: 400px;
      }
      .sales-row {
        display: grid;
        gap: 16px;
        margin-bottom: 24px;
      }
      .sales-row-hero             { grid-template-columns: repeat(4, 1fr); }
      .sales-row-trend-cob        { grid-template-columns: 2fr 1fr; }
      .sales-row-composition      { grid-template-columns: 1fr; }
      .sales-row-tender-heatmap   { grid-template-columns: 1fr 2fr; }
      .sales-row-bottom           { grid-template-columns: 1.4fr 1fr 1fr; }

      .sales-region-loading, .sales-region-empty, .sales-region-error {
        padding: 28px 20px;
        text-align: center;
        font-family: ${T.font.mono};
        font-size: ${T.fs.sm}px;
        letter-spacing: 2px;
        color: ${T.textMuted};
        text-transform: uppercase;
        background: ${T.card};
        border-radius: ${T.r.md}px;
        min-height: 118px;
        display: flex;
        align-items: center;
        justify-content: center;
      }
      .sales-region-error { color: ${T.verm}; }
      .sales-state {
        padding: 60px 20px;
        text-align: center;
        font-family: ${T.font.mono};
        font-size: ${T.fs.base}px;
        letter-spacing: 2px;
        color: ${T.textMuted};
        text-transform: uppercase;
      }
      .sales-state-error { color: ${T.verm}; }
    </style>

    <div class="sales-wrapper">
      <div class="sales-header">
        <div class="sales-header-left">
          <div class="sales-eyebrow">Reporting</div>
          <div class="sales-title">Sales</div>
          <div class="sales-subtitle">Today's revenue, covers, and check averages</div>
        </div>
        <div class="sales-toolbar">
          <div class="sales-chip sales-chip-range" role="button" aria-disabled="true">
            <span>${todayLabel()}</span>
            <span class="sales-chip-caret">▾</span>
          </div>
          <div class="sales-chip sales-chip-compare" role="button" aria-disabled="true">
            <span>vs Last week</span>
            <span class="sales-chip-caret">▾</span>
          </div>
          <button class="sales-export" type="button" aria-disabled="true">Export</button>
        </div>
      </div>

      <div class="sales-subtabs">
        <div class="sales-subtab active">Overview</div>
        <div class="sales-subtab">Dayparts</div>
        <div class="sales-subtab">Servers</div>
        <div class="sales-subtab">Payments</div>
        <div class="sales-subtab">Tips</div>
        <div class="sales-subtab">Voids &amp; Comps</div>
      </div>

      <div class="sales-regions" id="sales-regions">
        <div class="sales-row sales-row-hero" id="region-hero">
          <div class="sales-region-loading">Loading…</div>
          <div class="sales-region-loading">Loading…</div>
          <div class="sales-region-loading">Loading…</div>
          <div class="sales-region-loading">Loading…</div>
        </div>
        <div class="sales-row sales-row-trend-cob" id="region-trend-cob">
          <div class="sales-region-loading">Loading…</div>
          <div class="sales-region-loading">Loading…</div>
        </div>
        <div class="sales-row sales-row-composition" id="region-composition">
          <div class="sales-region-loading">Loading…</div>
        </div>
        <div class="sales-row sales-row-tender-heatmap" id="region-tender-heatmap">
          <div class="sales-region-loading">Loading…</div>
          <div class="sales-region-loading">Loading…</div>
        </div>
        <div class="sales-row sales-row-bottom" id="region-bottom">
          <div class="sales-region-loading">Loading…</div>
          <div class="sales-region-loading">Loading…</div>
          <div class="sales-region-loading">Loading…</div>
        </div>
      </div>
    </div>
  `;
}

// ─── Render helpers ─────────────────────────────────────────────────
function regionEl(container, id) {
  return container.querySelector(`#${id}`);
}

function renderRegionError(row, err, opts = {}) {
  const { cells = 1 } = opts;
  row.innerHTML = '';
  for (let i = 0; i < cells; i++) {
    const cell = document.createElement('div');
    cell.className = 'sales-region-error';
    cell.textContent = err.message ? `Error · ${err.message}` : 'Error';
    row.appendChild(cell);
  }
}

// ─── Delta helpers ──────────────────────────────────────────────────
// Compute week-over-week delta for a positive-better metric (net, covers,
// avg check, tip%). Returns null if the prior-period value is missing or
// zero (can't compute a fraction). Otherwise returns a shape consumable
// by buildStatCard's `delta` prop: { text, direction, color, note }.
function pctDelta(curr, prev, opts = {}) {
  const { fmtFn = fmtPct, note = 'vs last week' } = opts;
  if (prev == null || !Number.isFinite(Number(prev)) || Number(prev) === 0) return null;
  const c = Number(curr) || 0;
  const p = Number(prev);
  const frac = (c - p) / p;
  const direction = frac > 0.0005 ? 'up' : frac < -0.0005 ? 'down' : 'flat';
  const color = direction === 'up'   ? T.greenUp
              : direction === 'down' ? T.warning
              : T.textDim;
  return {
    text: fmtFn(frac, { signed: true }),
    direction,
    color,
    note,
  };
}

// Percentage-point delta (for metrics where the value is already a
// percentage, like tip %). 18.4% → 18.1% is -0.3pp, NOT -1.6%.
function ppDelta(currFrac, prevFrac, opts = {}) {
  const { note = 'vs last week' } = opts;
  if (prevFrac == null || !Number.isFinite(Number(prevFrac))) return null;
  const diff = Number(currFrac) - Number(prevFrac);
  const direction = diff > 0.0001 ? 'up' : diff < -0.0001 ? 'down' : 'flat';
  const color = direction === 'up'   ? T.greenUp
              : direction === 'down' ? T.warning
              : T.textDim;
  return {
    text: fmtPP(diff, { signed: true }),
    direction,
    color,
    note,
  };
}

// ─── Region renderers ───────────────────────────────────────────────
function renderHero(container, data, lastWeek) {
  const row = regionEl(container, 'region-hero');
  if (!row) return;
  row.innerHTML = '';

  const hourlyNet = (data.hourly_sales || []).map(h => Number(h.net) || 0);
  const tipPctFrac = (Number(data.net_sales) > 0)
    ? Number(data.tips_collected) / Number(data.net_sales)
    : 0;
  const lwTipPctFrac = (lastWeek && Number(lastWeek.net_sales) > 0)
    ? Number(lastWeek.tips_collected) / Number(lastWeek.net_sales)
    : null;

  row.appendChild(buildStatCard({
    label: 'Net Sales',
    accent: T.gold,
    value: fmt(Number(data.net_sales) || 0),
    valueColor: T.gold,
    sub: `${fmtInt(data.total_checks || 0)} checks · ${fmtInt(data.total_guests || 0)} guests`,
    spark: { values: hourlyNet, color: T.gold },
    delta: lastWeek ? pctDelta(data.net_sales, lastWeek.net_sales) : null,
  }));

  row.appendChild(buildStatCard({
    label: 'Covers',
    accent: T.cyan,
    value: fmtInt(data.total_guests || 0),
    valueColor: T.cyan,
    sub: `${fmtInt(data.total_checks || 0)} checks`,
    spark: { values: (data.hourly_sales || []).map(h => Number(h.checks) || 0), color: T.cyan },
    delta: lastWeek ? pctDelta(data.total_guests, lastWeek.total_guests) : null,
  }));

  row.appendChild(buildStatCard({
    label: 'Avg Check',
    accent: T.gold,
    value: fmt(Number(data.check_avg) || 0),
    valueColor: T.gold,
    sub: 'net ÷ checks',
    spark: {
      values: (data.hourly_sales || []).map(h => {
        const c = Number(h.checks) || 0;
        return c > 0 ? (Number(h.net) || 0) / c : 0;
      }),
      color: T.gold,
    },
    delta: lastWeek ? pctDelta(data.check_avg, lastWeek.check_avg) : null,
  }));

  row.appendChild(buildStatCard({
    label: 'Tip %',
    accent: T.mint,
    value: fmtPct(tipPctFrac).replace('%', ''),
    valueColor: T.mint,
    valueSuffix: '%',
    sub: `${fmt(Number(data.tips_collected) || 0)} collected`,
    spark: {
      values: (data.hourly_sales || []).map(h => Number(h.net) || 0),
      color: T.mint,
    },
    delta: (lwTipPctFrac != null) ? ppDelta(tipPctFrac, lwTipPctFrac) : null,
  }));
}

function renderComposition(container, data) {
  const row = regionEl(container, 'region-composition');
  if (!row) return;
  row.innerHTML = '';

  const hourly = data.hourly_sales || [];
  if (!hourly.length) {
    const cell = document.createElement('div');
    cell.className = 'sales-region-empty';
    cell.textContent = 'No hourly data';
    row.appendChild(cell);
    return;
  }

  const xLabels = hourly.map(h => String(h.hour));
  const food  = hourly.map(h => Number(h.food)  || 0);
  const drink = hourly.map(h => Number(h.drink) || 0);
  const other = hourly.map(h => Number(h.other) || 0);

  row.appendChild(buildStackedArea({
    title: 'Revenue Composition',
    subtitle: 'Hourly net by category',
    accent: T.mint,
    xLabels,
    layers: [
      { name: 'Food',  values: food,  color: T.cyan     },
      { name: 'Drink', values: drink, color: T.gold     },
      { name: 'Other', values: other, color: T.lavender },
    ],
  }));
}

// Parse a backend tip-bucket range like "$0-3" or "$20+" into structured
// fields so the histogram builder has both the label AND numeric bounds
// for marker placement.
function parseTipBucket(b) {
  const m = /\$(\d+)(?:-(\d+)|\+)/.exec(String(b.range || ''));
  const count = Number(b.count) || 0;
  if (!m) return { label: String(b.range || ''), low: 0, high: null, count };
  const low = Number(m[1]);
  const openEnded = m[2] == null;
  const high = openEnded ? null : Number(m[2]);
  return {
    label: openEnded ? `$${low}+` : `$${low}`,
    low, high, count,
  };
}

// Find the fractional bucket index that contains `value` — used to
// place the median/average marker on the histogram.
function bucketIndexForValue(buckets, value) {
  const v = Number(value) || 0;
  for (let i = 0; i < buckets.length; i++) {
    const b = buckets[i];
    if (b.high == null) return i;                  // open-ended trailing bucket
    if (v < b.high) {
      const span = b.high - b.low;
      const frac = span > 0 ? (v - b.low) / span : 0.5;
      return i + Math.min(Math.max(frac - 0.5, -0.5), 0.5);
    }
  }
  return buckets.length - 1;
}

function renderBottomRow(container, data, roleMap) {
  const roles = roleMap || new Map();
  const row = regionEl(container, 'region-bottom');
  if (!row) return;
  row.innerHTML = '';

  // ─── Histogram: tip distribution (stand-in for check-size distribution
  //     which isn't exposed by /sales-summary) ──────────────────────────
  const rawBuckets = (data.tip_buckets || []).map(parseTipBucket);
  const avgIdx = bucketIndexForValue(rawBuckets, Number(data.tip_avg) || 0);
  row.appendChild(buildHistogram({
    title: 'Tip Distribution',
    subtitle: 'Tips per check · today',
    accent: T.mint,
    buckets: rawBuckets,
    barColor: T.cyan,
    markerColor: T.gold,
    marker: (data.tip_avg != null)
      ? { atFractionalIndex: avgIdx, label: `AVG ${fmt(Number(data.tip_avg) || 0, { dp: 2 })}` }
      : null,
  }));

  // ─── Top items table ──────────────────────────────────────────────────
  const items = (data.top_items || []).slice(0, 6);
  row.appendChild(buildMiniTable({
    title: 'Top Items',
    subtitle: 'By revenue · today',
    accent: T.mint,
    columns: [
      {
        label: 'Item', align: 'left', width: '2fr',
        cell: (r) => ({ text: r.name || '—' }),
      },
      {
        label: 'Qty', align: 'right', width: '0.7fr',
        cell: (r) => ({ text: fmtInt(r.count || 0), color: T.textDim }),
      },
      {
        label: 'Revenue', align: 'right', width: '1fr',
        cell: (r) => ({
          text: fmt(Number(r.revenue) || 0, { dp: 0 }),
          color: T.gold,
          weight: 700,
        }),
      },
    ],
    rows: items,
    footer: items.length
      ? `▸ ${(data.top_items || []).length} items · top ${items.length} shown`
      : '',
  }));

  // ─── Top servers table ────────────────────────────────────────────────
  const servers = (data.top_servers || []).slice(0, 6);
  const tipColorFor = (pctFrac) => {
    if (pctFrac == null)         return T.textDim;
    if (pctFrac >= 0.20)         return T.greenUp;
    if (pctFrac <  0.17)         return T.warning;
    return T.text;
  };
  row.appendChild(buildMiniTable({
    title: 'Top Servers',
    subtitle: 'By revenue · today',
    accent: T.mint,
    columns: [
      {
        label: 'Server', align: 'left', width: '1.6fr',
        cell: (r) => {
          const role = roles.get(r.server_id);
          return {
            text: r.name || '—',
            badge: (role && role.isManager) ? { text: 'MGR' } : null,
          };
        },
      },
      {
        label: 'Tip %', align: 'right', width: '0.8fr',
        cell: (r) => {
          const role = roles.get(r.server_id);
          // Managers don't work the floor → tip% isn't meaningful for them
          if (role && role.isManager) {
            return { text: '—', color: T.textDim };
          }
          const rev = Number(r.revenue) || 0;
          const tipFrac = rev > 0 ? (Number(r.tips) || 0) / rev : null;
          return tipFrac == null
            ? { text: '—', color: T.textDim }
            : { text: fmtPct(tipFrac), color: tipColorFor(tipFrac), weight: 700 };
        },
      },
      {
        label: 'Net', align: 'right', width: '1.2fr',
        cell: (r) => ({
          text: fmt(Number(r.revenue) || 0, { dp: 0 }),
          color: T.gold,
          weight: 700,
        }),
      },
    ],
    rows: servers,
  }));
}

function renderTenderHeatmap(container, data) {
  const row = regionEl(container, 'region-tender-heatmap');
  if (!row) return;
  row.innerHTML = '';

  // Tender mix — today's cash vs card from sales-summary
  row.appendChild(buildTenderBar({
    title: 'Tender Mix',
    subtitle: 'Today · cash vs card',
    accent: T.mint,
    segments: [
      {
        label: 'Card',
        amount: Number(data.card_total) || 0,
        count:  Number(data.card_count) || 0,
        color:  T.cyan,
      },
      {
        label: 'Cash',
        amount: Number(data.cash_total) || 0,
        count:  Number(data.cash_count) || 0,
        color:  T.gold,
      },
    ],
  }));

  // Heatmap — 7 days × hours of check counts from peak_hours
  const ph = data.peak_hours || [];
  const rowLabels = ph.map(r => r.day);
  const hourSet = new Set();
  for (const r of ph) {
    for (const h of (r.hours || [])) hourSet.add(Number(h.hour));
  }
  const hours = Array.from(hourSet).sort((a, b) => a - b);
  const colLabels = hours.map(formatHour);
  const matrix = ph.map(r => {
    const byHour = new Map((r.hours || []).map(h => [Number(h.hour), Number(h.value) || 0]));
    return hours.map(h => byHour.get(h) || 0);
  });

  row.appendChild(buildHeatmap({
    title: 'Peak Hours',
    subtitle: 'Covers by day × hour · 7-day window',
    accent: T.mint,
    rowLabels,
    colLabels,
    matrix,
    formatValue: (n) => `${Math.round(n)} covers`,
  }));
}

function renderTrendCob(container, { hourly, labor }) {
  const row = regionEl(container, 'region-trend-cob');
  if (!row) return;
  row.innerHTML = '';

  // Trend line card
  if (hourly) {
    const xLabels = (hourly.today || []).map(h => h.hour);
    const todayVals = (hourly.today || []).map(h => Number(h.net_sales) || 0);
    const lastWeekVals = (hourly.last_week || []).map(h => Number(h.net_sales) || 0);
    row.appendChild(buildLineCard({
      title: 'Hourly Trend',
      subtitle: 'Today vs same weekday last week',
      accent: T.mint,
      xLabels,
      series: [
        { name: 'Today',     values: todayVals,    color: T.cyan,     markers: true,  dashed: false },
        { name: 'Last week', values: lastWeekVals, color: T.lavender, markers: false, dashed: true  },
      ],
    }));
  } else {
    const cell = document.createElement('div');
    cell.className = 'sales-region-empty';
    cell.textContent = 'Trend data unavailable';
    row.appendChild(cell);
  }

  // COB gauge card
  if (labor) {
    row.appendChild(buildCOBGauge({
      pct:   Number(labor.cob_percent) || 0,
      labor: Number(labor.total_labor) || 0,
      hours: Number(labor.total_hours) || 0,
    }));
  } else {
    const cell = document.createElement('div');
    cell.className = 'sales-region-empty';
    cell.textContent = 'Labor data unavailable';
    row.appendChild(cell);
  }
}

// ─── Public API ──────────────────────────────────────────────────────
export function buildSalesReportsScene(container) {
  _currentContainer = container;
  buildLayout(container);

  _abortController = new AbortController();
  const signal = _abortController.signal;
  const still = () => _currentContainer === container;

  // All region fetches run in parallel. Each region renders as soon
  // as the data it depends on arrives — no region blocks on another.
  //   - sales-summary (today)    → composition, tender/heatmap, histogram, top-items
  //   - sales-summary (today-7d) → hero deltas (waits on today too)
  //   - employees + roles        → MGR badges on top-servers (waits on today too)
  const todayPromise    = fetchSummary(signal);
  const lastWeekPromise = fetchLastWeekSummary(signal).catch(err => {
    if (err.name === 'AbortError') throw err;
    console.warn('[sales-reports] last-week summary unavailable:', err);
    return null; // hero renders without deltas
  });
  const rolesPromise = Promise.allSettled([
    fetchEmployees(signal),
    fetchRoles(signal),
  ]).then(([empRes, roleRes]) => {
    if (signal.aborted) return new Map();
    const employees = empRes.status  === 'fulfilled' ? empRes.value  : [];
    const roles     = roleRes.status === 'fulfilled' ? roleRes.value : [];
    if (empRes.status  === 'rejected') console.warn('[sales-reports] /config/employees unavailable:', empRes.reason);
    if (roleRes.status === 'rejected') console.warn('[sales-reports] /config/roles unavailable:',     roleRes.reason);
    return buildRoleMap(employees, roles);
  });

  todayPromise
    .then(data => {
      if (!still()) return;
      renderComposition(container, data);
      renderTenderHeatmap(container, data);
      lastWeekPromise.then(lw => {
        if (!still()) return;
        renderHero(container, data, lw);
      });
      rolesPromise.then(roleMap => {
        if (!still()) return;
        renderBottomRow(container, data, roleMap);
      });
    })
    .catch(err => {
      if (err.name === 'AbortError') return;
      console.error('[sales-reports] sales-summary error:', err);
      if (!still()) return;
      renderRegionError(regionEl(container, 'region-hero'),            err, { cells: 4 });
      renderRegionError(regionEl(container, 'region-composition'),     err, { cells: 1 });
      renderRegionError(regionEl(container, 'region-tender-heatmap'),  err, { cells: 2 });
      renderRegionError(regionEl(container, 'region-bottom'),          err, { cells: 3 });
    });

  // Trend + COB row — hourly-compare + labor-summary, rendered together
  // once both settle (either success or failure). Either source being
  // unavailable shows the individual card's "unavailable" placeholder.
  Promise.allSettled([fetchHourlyCompare(signal), fetchLabor(signal)])
    .then(([hourlyRes, laborRes]) => {
      if (!still()) return;
      if (signal.aborted) return;
      const hourly = hourlyRes.status === 'fulfilled' ? hourlyRes.value : null;
      const labor  = laborRes.status  === 'fulfilled' ? laborRes.value  : null;
      if (hourlyRes.status === 'rejected') console.error('[sales-reports] hourly-compare error:', hourlyRes.reason);
      if (laborRes.status === 'rejected')  console.error('[sales-reports] labor-summary error:', laborRes.reason);
      renderTrendCob(container, { hourly, labor });
    });
}

export function cleanupSalesReports() {
  if (_abortController) {
    _abortController.abort();
    _abortController = null;
  }
  _currentContainer = null;
}
