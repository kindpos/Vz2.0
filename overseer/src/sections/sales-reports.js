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
import { buildStatCard }    from '../ui/charts.js';
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
async function fetchSummary(signal) {
  const res = await fetch(`/api/v1/reports/sales-summary?date=${today()}`, { signal });
  if (!res.ok) {
    throw new Error(`sales-summary ${res.status}`);
  }
  return res.json();
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
      .sales-hero-row {
        display: grid;
        grid-template-columns: repeat(4, 1fr);
        gap: 16px;
        margin-bottom: 24px;
      }
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
        <div class="sales-state">Loading…</div>
      </div>
    </div>
  `;
}

// ─── Render ──────────────────────────────────────────────────────────
function regionsEl(container) {
  return container.querySelector('#sales-regions');
}

function renderHero(container, data) {
  const regions = regionsEl(container);
  if (!regions) return;
  regions.innerHTML = '';

  const hourlyNet = (data.hourly_sales || []).map(h => Number(h.net) || 0);
  const tipPctFrac = (Number(data.net_sales) > 0)
    ? Number(data.tips_collected) / Number(data.net_sales)
    : 0;

  const heroRow = document.createElement('div');
  heroRow.className = 'sales-hero-row';

  heroRow.appendChild(buildStatCard({
    label: 'Net Sales',
    accent: T.gold,
    value: fmt(Number(data.net_sales) || 0),
    valueColor: T.gold,
    sub: `${fmtInt(data.total_checks || 0)} checks · ${fmtInt(data.total_guests || 0)} guests`,
    spark: { values: hourlyNet, color: T.gold },
  }));

  heroRow.appendChild(buildStatCard({
    label: 'Covers',
    accent: T.cyan,
    value: fmtInt(data.total_guests || 0),
    valueColor: T.cyan,
    sub: `${fmtInt(data.total_checks || 0)} checks`,
    spark: { values: (data.hourly_sales || []).map(h => Number(h.checks) || 0), color: T.cyan },
  }));

  heroRow.appendChild(buildStatCard({
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

  heroRow.appendChild(buildStatCard({
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

  regions.appendChild(heroRow);
}

function renderError(container, err) {
  const regions = regionsEl(container);
  if (!regions) return;
  regions.innerHTML = `
    <div class="sales-state sales-state-error">
      Could not load sales data.<br/>
      <span style="opacity: 0.6; font-size: 11px; letter-spacing: 1px; text-transform: none;">${err.message || err}</span>
    </div>
  `;
}

// ─── Public API ──────────────────────────────────────────────────────
export function buildSalesReportsScene(container) {
  _currentContainer = container;
  buildLayout(container);

  _abortController = new AbortController();
  fetchSummary(_abortController.signal)
    .then(data => {
      if (_currentContainer === container) renderHero(container, data);
    })
    .catch(err => {
      if (err.name === 'AbortError') return;
      console.error('[sales-reports] Fetch error:', err);
      if (_currentContainer === container) renderError(container, err);
    });
}

export function cleanupSalesReports() {
  if (_abortController) {
    _abortController.abort();
    _abortController = null;
  }
  _currentContainer = null;
}
