/* ============================================
   KINDpos Overseer — Menu Performance (Nostalgia)

   Item sales velocity and revenue ranking, aggregated across a
   user-chosen date range. Pairs with Sales Reports (week view) and
   Labor Reports (day view) under the REPORTING nav group.

   Reads:
     GET /api/v1/reports/sales-summary?date=<YYYY-MM-DD> per day in range

   top_items entries carry { name, count, revenue, category } so we
   can roll categories up for the breakdown bar without a second fetch.
   ============================================ */

import { T } from '../ui/tokens.js';
import {
  buildStatCard,
  buildTenderBar,
  buildMiniTable,
} from '../ui/charts.js';
import { fmt, fmtPct, fmtInt } from '../ui/money.js';
import { buildDateRangePicker } from '../components/date-picker.js';

// ─── State ──────────────────────────────────────────────────────────
let _currentContainer = null;
let _startDate        = null;
let _endDate          = null;
let _abortController  = null;

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}
function daysAgoStr(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
}

function initDates() {
  _endDate   = todayStr();
  _startDate = daysAgoStr(6);
}

function prettyRange(start, end) {
  const s = new Date(`${start}T12:00:00`);
  const e = new Date(`${end}T12:00:00`);
  if (!Number.isFinite(s.getTime()) || !Number.isFinite(e.getTime())) return '';
  const m = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const left  = `${m[s.getMonth()]} ${s.getDate()}`;
  const right = `${m[e.getMonth()]} ${e.getDate()}, ${e.getFullYear()}`;
  return start === end
    ? right
    : `${left} – ${right}`;
}

// ─── Category palette ───────────────────────────────────────────────
// Borrowed from home.js CAT_COLORS so the menu page and the home
// dashboard agree on the "Pizza is red, Drinks are orange" shorthand.
const CAT_COLORS = {
  PIZZA:   '#ff4757',
  APPS:    '#fcbe40',
  SIDES:   '#3742fa',
  SUBS:    '#C6FFBB',
  DRINKS:  '#ff9f43',
};
const CAT_FALLBACKS = [T.cyan, T.gold, T.mint, T.lavender, T.greenUp, T.warning];
function colorForCategory(name, seenIndex) {
  if (!name) return CAT_FALLBACKS[seenIndex % CAT_FALLBACKS.length];
  const hit = CAT_COLORS[String(name).toUpperCase()];
  if (hit) return hit;
  return CAT_FALLBACKS[seenIndex % CAT_FALLBACKS.length];
}

// ─── Fetch + aggregate ──────────────────────────────────────────────
function enumerateDates(start, end) {
  const out = [];
  const s = new Date(`${start}T12:00:00`);
  const e = new Date(`${end}T12:00:00`);
  if (!Number.isFinite(s.getTime()) || !Number.isFinite(e.getTime()) || s > e) return out;
  const cur = new Date(s);
  for (let i = 0; i < 400 && cur <= e; i++) {
    out.push(cur.toISOString().slice(0, 10));
    cur.setDate(cur.getDate() + 1);
  }
  return out;
}

async function fetchDay(date, signal) {
  try {
    const res = await fetch(`/api/v1/reports/sales-summary?date=${date}`, { signal });
    if (!res.ok) return null;
    return await res.json();
  } catch (e) {
    if (e && e.name === 'AbortError') throw e;
    return null;
  }
}

function aggregateItems(dayResponses) {
  const byItem = new Map();
  for (const day of dayResponses) {
    if (!day || !Array.isArray(day.top_items)) continue;
    for (const it of day.top_items) {
      const name = it.name || it.item || 'Unknown';
      const prev = byItem.get(name) || {
        name,
        category: it.category || null,
        qty: 0,
        revenue: 0,
      };
      prev.qty     += Number(it.count || it.qty || 0);
      prev.revenue += Number(it.revenue || it.total || 0);
      // First non-empty category wins — items that land under multiple
      // categories across days are rare but we pick the first to keep
      // the rollup deterministic.
      if (!prev.category && it.category) prev.category = it.category;
      byItem.set(name, prev);
    }
  }
  return [...byItem.values()].sort((a, b) => b.revenue - a.revenue);
}

function rollupCategories(items) {
  const byCat = new Map();
  for (const it of items) {
    const key = it.category || 'Other';
    const prev = byCat.get(key) || { name: key, qty: 0, revenue: 0 };
    prev.qty     += it.qty;
    prev.revenue += it.revenue;
    byCat.set(key, prev);
  }
  return [...byCat.values()].sort((a, b) => b.revenue - a.revenue);
}

// ─── Layout ─────────────────────────────────────────────────────────
function buildLayout(container) {
  container.innerHTML = `
    <style>
      .menu-wrapper {
        padding: 30px 32px;
        color: ${T.text};
        font-family: ${T.font.body};
      }

      .menu-header {
        display: flex;
        justify-content: space-between;
        align-items: flex-end;
        margin-bottom: 24px;
        gap: 24px;
      }
      .menu-header-left { min-width: 0; }
      .menu-eyebrow {
        font-family: ${T.font.mono};
        font-size: ${T.fs.md}px;
        letter-spacing: 3px;
        color: ${T.mint};
        font-weight: 700;
        text-transform: uppercase;
        margin-bottom: 8px;
      }
      .menu-title {
        font-size: ${T.fs.hero}px;
        font-weight: 700;
        line-height: 1;
        margin-bottom: 8px;
      }
      .menu-subtitle {
        font-family: ${T.font.mono};
        font-size: ${T.fs.md}px;
        letter-spacing: 2px;
        color: ${T.textMuted};
      }
      .menu-toolbar {
        display: flex;
        gap: 10px;
        align-items: center;
        flex-shrink: 0;
      }

      .menu-regions { min-height: 400px; }
      .menu-row {
        display: grid;
        gap: 16px;
        margin-bottom: 24px;
      }
      .menu-row-hero    { grid-template-columns: repeat(4, 1fr); }
      .menu-row-single  { grid-template-columns: 1fr; }

      .menu-region-loading,
      .menu-region-empty,
      .menu-region-error {
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
      .menu-region-error { color: ${T.verm}; }
    </style>

    <div class="menu-wrapper">
      <div class="menu-header">
        <div class="menu-header-left">
          <div class="menu-eyebrow">Reporting</div>
          <div class="menu-title">Menu Performance</div>
          <div class="menu-subtitle" id="menu-subtitle"></div>
        </div>
        <div class="menu-toolbar" id="menu-toolbar"></div>
      </div>

      <div class="menu-regions">
        <div class="menu-row menu-row-hero" id="region-hero">
          <div class="menu-region-loading">Loading…</div>
          <div class="menu-region-loading">Loading…</div>
          <div class="menu-region-loading">Loading…</div>
          <div class="menu-region-loading">Loading…</div>
        </div>
        <div class="menu-row menu-row-single" id="region-categories">
          <div class="menu-region-loading">Loading…</div>
        </div>
        <div class="menu-row menu-row-single" id="region-ranking">
          <div class="menu-region-loading">Loading…</div>
        </div>
      </div>
    </div>
  `;

  const sub = container.querySelector('#menu-subtitle');
  if (sub) sub.textContent = prettyRange(_startDate, _endDate);

  const toolbar = container.querySelector('#menu-toolbar');
  if (toolbar) {
    toolbar.appendChild(buildDateRangePicker({
      start: _startDate,
      end: _endDate,
      onChange: ({ start, end }) => {
        _startDate = start;
        _endDate   = end;
        if (_abortController) _abortController.abort();
        renderAll(container);
      },
    }));
  }
}

function regionEl(container, id) {
  return container.querySelector(`#${id}`);
}

function renderRegionEmpty(row, msg, cells = 1) {
  if (!row) return;
  row.innerHTML = '';
  for (let i = 0; i < cells; i++) {
    const cell = document.createElement('div');
    cell.className = 'menu-region-empty';
    cell.textContent = msg;
    row.appendChild(cell);
  }
}

function renderRegionError(row, err, cells = 1) {
  if (!row) return;
  row.innerHTML = '';
  for (let i = 0; i < cells; i++) {
    const cell = document.createElement('div');
    cell.className = 'menu-region-error';
    cell.textContent = err && err.message ? `Error · ${err.message}` : 'Error';
    row.appendChild(cell);
  }
}

// ─── Region: hero KPIs ──────────────────────────────────────────────
function renderHero(container, items) {
  const row = regionEl(container, 'region-hero');
  if (!row) return;
  row.innerHTML = '';

  const totalRev = items.reduce((s, i) => s + i.revenue, 0);
  const totalQty = items.reduce((s, i) => s + i.qty, 0);
  const unique   = items.length;
  const top      = items[0] || null;
  const topShare = (top && totalRev > 0) ? top.revenue / totalRev : 0;

  row.appendChild(buildStatCard({
    label: 'Total Revenue',
    accent: T.gold,
    value: fmt(totalRev, { dp: 0 }),
    valueColor: T.gold,
    sub: `${prettyRange(_startDate, _endDate)}`,
  }));

  row.appendChild(buildStatCard({
    label: 'Items Sold',
    accent: T.cyan,
    value: fmtInt(totalQty),
    valueColor: T.cyan,
    sub: totalQty > 0
      ? `${fmt(totalRev / Math.max(1, totalQty), { dp: 2 })} avg / item`
      : '—',
  }));

  row.appendChild(buildStatCard({
    label: 'Unique Items',
    accent: T.mint,
    value: fmtInt(unique),
    valueColor: T.mint,
    sub: unique > 0 ? `${Math.min(unique, 10)} shown in ranking` : '—',
  }));

  row.appendChild(buildStatCard({
    label: 'Top Item',
    accent: T.lavender,
    value: top ? top.name : '—',
    valueColor: top ? T.text : T.textDim,
    sub: top
      ? `${fmt(top.revenue, { dp: 0 })} · ${fmtPct(topShare)} of total`
      : 'No items sold',
  }));
}

// ─── Region: revenue by category ────────────────────────────────────
function renderCategories(container, items) {
  const row = regionEl(container, 'region-categories');
  if (!row) return;
  row.innerHTML = '';

  const rollup = rollupCategories(items);
  if (!rollup.length) {
    renderRegionEmpty(row, 'No category data', 1);
    return;
  }

  const segments = rollup.map((c, i) => ({
    label: c.name,
    amount: c.revenue,
    count: c.qty,
    color: colorForCategory(c.name, i),
  }));

  row.appendChild(buildTenderBar({
    title: 'Revenue by Category',
    subtitle: 'Summed across the selected range',
    accent: T.mint,
    segments,
  }));
}

// ─── Region: item ranking ───────────────────────────────────────────
function renderRanking(container, items) {
  const row = regionEl(container, 'region-ranking');
  if (!row) return;
  row.innerHTML = '';

  if (!items.length) {
    renderRegionEmpty(row, 'No sales data in this date range', 1);
    return;
  }

  const totalRev = items.reduce((s, i) => s + i.revenue, 0);
  // Cap the visible ranking at 20 so the card stays scannable; total
  // unique count is surfaced in the hero KPIs either way.
  const ranked = items.slice(0, 20).map((it, i) => ({
    rank: i + 1,
    ...it,
    share: totalRev > 0 ? it.revenue / totalRev : 0,
  }));

  row.appendChild(buildMiniTable({
    title: 'Item Ranking',
    subtitle: `Top ${ranked.length} of ${items.length} · by revenue`,
    accent: T.gold,
    columns: [
      {
        label: '#', align: 'left', width: '0.4fr',
        cell: (r) => ({
          text: String(r.rank),
          color: r.rank <= 3 ? T.gold : T.textDim,
          weight: r.rank <= 3 ? 700 : 400,
        }),
      },
      {
        label: 'Item', align: 'left', width: '2fr',
        cell: (r) => ({ text: r.name || '—' }),
      },
      {
        label: 'Category', align: 'left', width: '1fr',
        cell: (r) => ({
          text: r.category || '—',
          color: r.category ? T.textMuted : T.textDim,
        }),
      },
      {
        label: 'Qty', align: 'right', width: '0.7fr',
        cell: (r) => ({ text: fmtInt(r.qty), color: T.textMuted }),
      },
      {
        label: 'Revenue', align: 'right', width: '1fr',
        cell: (r) => ({
          text: fmt(r.revenue, { dp: 0 }),
          color: T.gold,
          weight: 700,
        }),
      },
      {
        label: '% of Total', align: 'right', width: '0.8fr',
        cell: (r) => ({
          text: fmtPct(r.share),
          color: T.textMuted,
        }),
      },
    ],
    rows: ranked,
  }));
}

// ─── Orchestration ──────────────────────────────────────────────────
async function renderAll(container) {
  const sub = container.querySelector('#menu-subtitle');
  if (sub) sub.textContent = prettyRange(_startDate, _endDate);

  const hero       = regionEl(container, 'region-hero');
  const categories = regionEl(container, 'region-categories');
  const ranking    = regionEl(container, 'region-ranking');
  if (hero)       hero.innerHTML       = '<div class="menu-region-loading">Loading…</div>'.repeat(4);
  if (categories) categories.innerHTML = '<div class="menu-region-loading">Loading…</div>';
  if (ranking)    ranking.innerHTML    = '<div class="menu-region-loading">Loading…</div>';

  _abortController = new AbortController();
  const signal = _abortController.signal;
  const still  = () => _currentContainer === container;

  const dates = enumerateDates(_startDate, _endDate);
  if (!dates.length) {
    renderRegionEmpty(hero, 'Invalid date range', 4);
    renderRegionEmpty(categories, 'Invalid date range', 1);
    renderRegionEmpty(ranking, 'Invalid date range', 1);
    return;
  }

  let responses;
  try {
    responses = await Promise.all(dates.map(d => fetchDay(d, signal)));
  } catch (err) {
    if (err && err.name === 'AbortError') return;
    renderRegionError(hero, err, 4);
    renderRegionError(categories, err, 1);
    renderRegionError(ranking, err, 1);
    return;
  }

  if (!still() || signal.aborted) return;

  const items = aggregateItems(responses);
  renderHero(container, items);
  renderCategories(container, items);
  renderRanking(container, items);
}

// ─── Public API ─────────────────────────────────────────────────────
export function buildMenuPerformanceScene(container) {
  _currentContainer = container;
  initDates();
  buildLayout(container);
  renderAll(container).catch(err => {
    if (err && err.name === 'AbortError') return;
    console.error('[MenuPerformance] Mount error:', err);
  });
}

export function cleanupMenuPerformance(container) {
  if (_abortController) {
    _abortController.abort();
    _abortController = null;
  }
  if (container) container.innerHTML = '';
  _currentContainer = null;
}
