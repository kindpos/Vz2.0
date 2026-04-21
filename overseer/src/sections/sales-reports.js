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
import { buildStatCard, buildLineCard, buildCOBGauge } from '../ui/charts.js';
import { fmt, fmtPct, fmtInt } from '../ui/money.js';

// ─── Module state ────────────────────────────────────────────────────
let _currentContainer = null;
let _abortController  = null;

// ─── Utilities ───────────────────────────────────────────────────────
function today() {
  return new Date().toISOString().slice(0, 10);
}

function todayLabel() {
  const d = new Date();
  const days = ['SUN','MON','TUE','WED','THU','FRI','SAT'];
  const months = ['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'];
  return `${days[d.getDay()]} · ${months[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
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
function fetchHourlyCompare(signal) {
  return fetchJson(`/api/v1/reports/hourly-compare?date=${today()}`, signal);
}
function fetchLabor(signal) {
  return fetchJson(`/api/v1/reports/labor-summary?date=${today()}`, signal);
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
      .sales-row-hero       { grid-template-columns: repeat(4, 1fr); }
      .sales-row-trend-cob  { grid-template-columns: 2fr 1fr; }

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

// ─── Region renderers ───────────────────────────────────────────────
function renderHero(container, data) {
  const row = regionEl(container, 'region-hero');
  if (!row) return;
  row.innerHTML = '';

  const hourlyNet = (data.hourly_sales || []).map(h => Number(h.net) || 0);
  const tipPctFrac = (Number(data.net_sales) > 0)
    ? Number(data.tips_collected) / Number(data.net_sales)
    : 0;

  row.appendChild(buildStatCard({
    label: 'Net Sales',
    accent: T.gold,
    value: fmt(Number(data.net_sales) || 0),
    valueColor: T.gold,
    sub: `${fmtInt(data.total_checks || 0)} checks · ${fmtInt(data.total_guests || 0)} guests`,
    spark: { values: hourlyNet, color: T.gold },
  }));

  row.appendChild(buildStatCard({
    label: 'Covers',
    accent: T.cyan,
    value: fmtInt(data.total_guests || 0),
    valueColor: T.cyan,
    sub: `${fmtInt(data.total_checks || 0)} checks`,
    spark: { values: (data.hourly_sales || []).map(h => Number(h.checks) || 0), color: T.cyan },
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

  // Hero row — sales-summary
  fetchSummary(signal)
    .then(data => { if (still()) renderHero(container, data); })
    .catch(err => {
      if (err.name === 'AbortError') return;
      console.error('[sales-reports] sales-summary error:', err);
      if (still()) renderRegionError(regionEl(container, 'region-hero'), err, { cells: 4 });
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
