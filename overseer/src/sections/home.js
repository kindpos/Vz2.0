/* ============================================
   KINDpos Overseer — HOME scene
   Live dashboard in Vz2.0 Nostalgia styling.

   Fetches:
     GET /api/v1/reports/sales-summary?date=YYYY-MM-DD
     GET /api/v1/reports/labor-summary?date=YYYY-MM-DD
     GET /api/v1/reports/hourly-compare?date=YYYY-MM-DD

   Note: Nostalgia colors are hardcoded here rather than routed through
   CSS vars. The rest of Overseer still uses Vz1.x styling. When we do
   the shell restructure, these move into variables.css.
   ============================================ */

// ─── Nostalgia palette ───────────────────────────────────────────────
const C = {
  bg:         '#383c42',
  card:       '#2e3236',
  well:       '#22252a',
  gold:       '#f5a623',
  cyan:       '#22d3ee',
  green:      '#86efac',
  greenUp:    '#4ade80',
  lavender:   '#b48efa',
  verm:       '#e8472a',
  warning:    '#fbbf24',
  text:       '#e8eaed',
  textMuted:  'rgba(232,234,237,0.55)',
  textDim:    'rgba(232,234,237,0.4)',
  border:     'rgba(232,234,237,0.08)',
};

// ─── Category palette (matches demo_seed.json category colors) ───────
// Keep this in sync with the terminal's T.categoryPalette when possible.
// Lookup is case-insensitive — backend can return "Pizza" or "PIZZA".
const CAT_COLORS = {
  PIZZA:   '#ff4757',
  APPS:    '#fcbe40',
  SIDES:   '#3742fa',
  SUBS:    '#C6FFBB',
  DRINKS:  '#ff9f43',
};

const catColor = (name) => {
  if (!name) return C.lavender;
  return CAT_COLORS[String(name).toUpperCase()] || C.lavender;
}

const withAlpha = (hex, alpha) => {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

// ─── Inline card sparkline ────────────────────────────────────────
// Small trend chart intended to sit next to a stat card's big number.
// Renders a filled area + stroked line with square data points.
const buildCardSparkline = (values, color, options = {}) => {
  const { height = 56, showPoints = true } = options;
  if (!values || values.length === 0) {
    return `<div style="flex: 1; min-height: ${height}px;"></div>`;
  }
  const w = 260, h = height, pad = 4;
  // Normalize values — if all zero, render a flat line at the bottom
  const maxV = Math.max(...values, 0.01);
  const minV = 0;
  const n = values.length;
  const xStep = (w - pad * 2) / Math.max(1, n - 1);
  const pts = values.map((v, i) => {
    const x = pad + i * xStep;
    const y = pad + ((maxV - v) / (maxV - minV)) * (h - pad * 2);
    return { x, y };
  });
  const line = pts.map(p => `${p.x},${p.y}`).join(' ');
  // Build closed area polygon (line + bottom corners)
  const area = `${pad},${h - pad} ${line} ${w - pad},${h - pad}`;
  const squares = showPoints
    ? pts.map(p => `<rect x="${p.x - 2}" y="${p.y - 2}" width="4" height="4" fill="${color}"/>`).join('')
    : '';
  return `
    <svg viewBox="0 0 ${w} ${h}" xmlns="http://www.w3.org/2000/svg" preserveAspectRatio="none" style="flex: 1; min-width: 0; height: ${h}px;">
      <polygon points="${area}" fill="${withAlpha(color, 0.12)}"/>
      <polyline points="${line}" fill="none" stroke="${color}" stroke-width="2" vector-effect="non-scaling-stroke"/>
      ${squares}
    </svg>
  `;
}

// ─── Module state ────────────────────────────────────────────────────
let _chartInstance = null;
let _abortController = null;
let _currentContainer = null;

// ─── Utilities ───────────────────────────────────────────────────────
const today = () => new Date().toISOString().slice(0, 10);
;

function fmt$(n) {
  const v = n ?? 0;
  return '$' + v.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

function fmt$K(n) {
  const v = n ?? 0;
  if (v >= 10000) return '$' + (v / 1000).toFixed(1) + 'k';
  return '$' + Math.round(v).toLocaleString();
}

const fmtPct = (n) => (n ?? 0).toFixed(1) + '%';
;

const nowLabel = () => {
  const d = new Date();
  const days = ['SUNDAY','MONDAY','TUESDAY','WEDNESDAY','THURSDAY','FRIDAY','SATURDAY'];
  const months = ['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'];
  return `${days[d.getDay()]} · ${months[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()} · ${d.toLocaleTimeString([], {hour: 'numeric', minute: '2-digit'})}`;
}

// Split hourly sales into AM/PM/Late buckets.
// hourly_sales labels are 12-hour format like "11:00", "1:00", etc.
// without AM/PM info, so we use common restaurant conventions:
//   11 or 12 → AM (lunch)
//   1-4 → PM (afternoon/dinner)
//   5-11 → LATE (dinner/late)
const splitDayparts = (hourly_sales) => {
  const out = { am: 0, pm: 0, late: 0 };
  for (const h of (hourly_sales || [])) {
    const hourNum = parseInt(String(h.hour).split(':')[0], 10);
    if (hourNum === 11 || hourNum === 12) out.am += h.net;
    else if (hourNum >= 1 && hourNum <= 4) out.pm += h.net;
    else out.late += h.net;
  }
  return out;
}

// ─── Fetch ───────────────────────────────────────────────────────────
const fetchAll = async (signal) => {
  const date = today();
  const [salesRes, laborRes] = await Promise.all([
    fetch(`/api/v1/reports/sales-summary?date=${date}`, { signal }),
    fetch(`/api/v1/reports/labor-summary?date=${date}`, { signal }),
  ]);
  if (!salesRes.ok || !laborRes.ok) {
    throw new Error(`Fetch failed: sales=${salesRes.status} labor=${laborRes.status}`);
  }
  const sales = await salesRes.json();
  const labor = await laborRes.json();
  return { sales, labor };
}

// ─── Layout scaffold ─────────────────────────────────────────────────
const buildLayout = (container) => {
  container.innerHTML = `
    <style>
      .home-wrapper { padding: 30px 32px; color: ${C.text}; }
      .home-title-row { display: flex; justify-content: space-between; align-items: flex-end; margin-bottom: 30px; }
      .home-title { font-size: 34px; font-weight: 700; }
      .home-subtitle { font-size: 12px; letter-spacing: 2px; color: ${C.textMuted}; font-family: ui-monospace, monospace; margin-top: 6px; }
      .home-divider { border-bottom: 1px solid ${C.well}; margin-bottom: 24px; }

      .home-cards-row { display: grid; grid-template-columns: repeat(2, 1fr); gap: 24px; margin-bottom: 24px; }
      .home-row-mid { display: grid; grid-template-columns: 3fr 1fr; gap: 24px; margin-bottom: 24px; }
      .home-row-bottom { display: grid; grid-template-columns: 1fr 1fr; gap: 24px; margin-bottom: 24px; }

      .home-card {
        background: ${C.card};
        border-radius: 10px;
        padding: 24px;
        position: relative;
        min-height: 240px;
      }
      .home-card::before {
        content: '';
        position: absolute;
        left: 0; top: 0; bottom: 0;
        width: 4px;
        border-radius: 2px 0 0 2px;
        background: var(--accent, ${C.gold});
      }
      .home-card-tall { min-height: 340px; }

      .card-label {
        font-size: 13px; letter-spacing: 2.5px; font-weight: 700;
        color: ${C.textMuted}; text-transform: uppercase;
        font-family: ui-monospace, monospace;
        margin-bottom: 14px;
      }
      .card-big { font-size: 50px; font-weight: 700; margin-bottom: 10px; line-height: 1; }
      .card-big-med { font-size: 36px; font-weight: 700; margin-bottom: 6px; line-height: 1; }
      .card-sub { font-size: 14px; color: ${C.textMuted}; font-family: ui-monospace, monospace; }
      .card-delta-pos { color: ${C.greenUp}; }
      .card-delta-neg { color: ${C.verm}; }

      /* Stat-top row: big number + sub on left, sparkline fills right */
      .stat-top {
        display: flex;
        align-items: center;
        gap: 20px;
        margin-bottom: 4px;
      }
      .stat-top-left { flex-shrink: 0; }
      .stat-top-spark { flex: 1; min-width: 0; display: flex; align-items: center; }

      .card-separator { border-top: 1px solid ${C.well}; margin: 18px 0 14px 0; }
      .card-mini-label {
        font-size: 12px; letter-spacing: 2px; font-weight: 700;
        color: ${C.textDim}; text-transform: uppercase;
        font-family: ui-monospace, monospace;
        margin-bottom: 10px;
      }

      .daypart-row { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; font-family: ui-monospace, monospace; }
      .daypart-label { font-size: 13px; color: ${C.textMuted}; }
      .daypart-val { font-size: 18px; font-weight: 700; margin-top: 3px; }

      .row-line { display: flex; justify-content: space-between; font-family: ui-monospace, monospace; font-size: 15px; margin: 7px 0; align-items: baseline; }
      .row-line-left { color: ${C.text}; }
      .row-line-right { font-weight: 700; }

      .rank-list { display: flex; flex-direction: column; gap: 5px; margin-top: 8px; }
      .rank-row {
        position: relative;
        padding: 11px 14px;
        border-radius: 7px;
        overflow: hidden;
      }
      .rank-bar {
        position: absolute;
        left: 0; top: 0; bottom: 0;
        border-radius: 7px;
        z-index: 0;
      }
      .rank-content {
        position: relative;
        z-index: 1;
        display: grid;
        grid-template-columns: 28px 1fr auto;
        gap: 10px;
        align-items: baseline;
        font-family: ui-monospace, monospace;
        font-size: 15px;
      }
      .rank-num { color: ${C.textDim}; font-weight: 700; }
      .rank-label { color: ${C.text}; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .rank-value { color: ${C.gold}; font-weight: 700; white-space: nowrap; }

      .threshold-bar { position: relative; height: 10px; background: ${C.well}; border-radius: 5px; margin: 14px 0 8px 0; }
      .threshold-fill { height: 100%; border-radius: 5px; background: ${C.greenUp}; }
      .threshold-marker { position: absolute; top: -3px; width: 2px; height: 16px; }
      .threshold-caps { display: flex; justify-content: space-between; font-size: 10px; color: ${C.textMuted}; font-family: ui-monospace, monospace; }

      .chart-container { position: relative; height: 240px; margin-top: 8px; }

      .home-empty { padding: 24px 20px; text-align: center; color: ${C.textMuted}; font-size: 13px; }
      .home-state { padding: 60px 20px; text-align: center; color: ${C.textMuted}; font-size: 15px; font-family: ui-monospace, monospace; }
      .home-error { color: ${C.verm}; }

      .sparkline { display: block; width: 100%; height: 28px; margin-top: 8px; }
    </style>
    <div class="home-wrapper">
      <div class="home-title-row">
        <div>
          <div class="home-title">Today</div>
          <div class="home-subtitle" id="home-date-label">${nowLabel()}</div>
        </div>
      </div>
      <div class="home-divider"></div>
      <div id="home-content">
        <div class="home-state">Loading today's numbers...</div>
      </div>
    </div>
  `;
}

// ─── Card builders ───────────────────────────────────────────────────

const buildNetSalesCard = (sales) => {
  const dp = splitDayparts(sales.hourly_sales);
  const hourlyNet = (sales.hourly_sales || []).map(h => h.net);
  return `
    <div class="home-card" style="--accent: ${C.gold};">
      <div class="card-label">Net Sales</div>
      <div class="stat-top">
        <div class="stat-top-left">
          <div class="card-big" style="color: ${C.gold}; margin-bottom: 6px;">${fmt$(sales.net_sales)}</div>
          <div class="card-sub">${sales.total_checks} checks · ${sales.total_guests} guests</div>
        </div>
        <div class="stat-top-spark">${buildCardSparkline(hourlyNet, C.gold)}</div>
      </div>
      <div class="card-separator"></div>
      <div class="card-mini-label">By Daypart</div>
      <div class="daypart-row">
        <div>
          <div class="daypart-label">AM</div>
          <div class="daypart-val">${fmt$K(dp.am)}</div>
        </div>
        <div>
          <div class="daypart-label">PM</div>
          <div class="daypart-val" style="color: ${C.gold};">${fmt$K(dp.pm)}</div>
        </div>
        <div>
          <div class="daypart-label">LATE</div>
          <div class="daypart-val">${fmt$K(dp.late)}</div>
        </div>
      </div>
    </div>
  `;
}

const buildOpenChecksCard = (sales) => {
  const count = sales.open_checks ?? 0;
  const total = sales.open_total ?? 0;
  const oldest = sales.oldest_open_minutes;
  const hourlyChecks = (sales.hourly_sales || []).map(h => h.checks);

  // Build top 2 server summary from top_servers — but we want
  // open-check holders specifically. Endpoint doesn't differentiate,
  // so we just show the top two revenue servers as a proxy.
  const topTwo = (sales.top_servers || []).slice(0, 2);
  const heldBy = topTwo.length > 0
    ? topTwo.map(s =>
        `<div class="row-line"><span class="row-line-left">${s.name}</span><span class="row-line-right" style="color: ${C.cyan};">${s.checks} · ${fmt$(s.revenue)}</span></div>`
      ).join('')
    : `<div class="home-empty" style="padding: 12px 0;">No servers active</div>`;

  return `
    <div class="home-card" style="--accent: ${C.cyan};">
      <div class="card-label">Open Checks</div>
      <div class="stat-top">
        <div class="stat-top-left">
          <div class="card-big" style="color: ${C.cyan}; margin-bottom: 6px;">${count}</div>
          <div class="card-sub">${fmt$(total)} uncommitted${oldest !== null && oldest !== undefined ? ` · oldest ${oldest} min` : ''}</div>
        </div>
        <div class="stat-top-spark">${buildCardSparkline(hourlyChecks, C.cyan)}</div>
      </div>
      <div class="card-separator"></div>
      <div class="card-mini-label">Top Servers Today</div>
      ${heldBy}
    </div>
  `;
}

const buildLaborCard = (labor) => {
  const pct = labor.cob_percent ?? 0;
  // Cap visual fill at 100% but show the real number
  const fillPct = Math.min(100, pct);
  const targetLow = 28;  // yellow threshold
  const targetHigh = 35; // red threshold

  // Determine fill color based on where we are
  let fillColor = C.greenUp;
  if (pct >= targetHigh) fillColor = C.verm;
  else if (pct >= targetLow) fillColor = C.warning;

  // 7-day COB trend as the inline sparkline — colored by current level
  const trend = labor.cob_trend || [];
  const trendValues = trend.map(t => t.percent);
  const labels = trend.map(t => t.day.charAt(0)).join(' ');

  return `
    <div class="home-card" style="--accent: ${C.green};">
      <div class="card-label">Labor %</div>
      <div class="stat-top">
        <div class="stat-top-left">
          <div class="card-big-med" style="color: ${C.text}; margin-bottom: 6px;">${fmtPct(pct)}</div>
          <div class="card-sub">${labor.total_hours ?? 0} hrs · ${fmt$(labor.total_labor ?? 0)}</div>
        </div>
        <div class="stat-top-spark">${buildCardSparkline(trendValues, fillColor)}</div>
      </div>
      <div class="threshold-bar">
        <div class="threshold-fill" style="width: ${fillPct}%; background: ${fillColor};"></div>
        <div class="threshold-marker" style="left: ${targetLow}%; background: ${C.warning};"></div>
        <div class="threshold-marker" style="left: ${targetHigh}%; background: ${C.verm};"></div>
      </div>
      <div class="threshold-caps">
        <span>target ${targetLow}%</span>
        <span style="color: ${C.textDim}; letter-spacing: 2px;">${labels}</span>
        <span>cap ${targetHigh}%</span>
      </div>
    </div>
  `;
}

const buildCobSparkline = (trend, targetLow, targetHigh) => {
  if (!trend || trend.length === 0) {
    return `<div class="home-empty" style="padding: 12px 0;">No trend data</div>`;
  }
  const w = 180, h = 48, pad = 6;
  const values = trend.map(t => t.percent);
  const maxV = Math.max(Math.max(...values, targetHigh + 5), 50);
  const minV = 0;
  const xStep = (w - pad * 2) / Math.max(1, values.length - 1);
  const pts = values.map((v, i) => {
    const x = pad + i * xStep;
    const y = pad + ((maxV - v) / (maxV - minV)) * (h - pad * 2);
    return { x, y, v };
  });
  const poly = pts.map(p => `${p.x},${p.y}`).join(' ');
  const squares = pts.map((p, i) => {
    const isToday = i === pts.length - 1;
    const color = p.v >= targetHigh ? C.verm
                : p.v >= targetLow ? C.warning
                : (isToday ? C.warning : C.green);
    return `<rect x="${p.x - 2}" y="${p.y - 2}" width="4" height="4" fill="${color}"/>`;
  }).join('');
  const labels = trend.map((t, i) => {
    const x = pad + i * xStep;
    const isToday = i === trend.length - 1;
    const color = isToday ? C.warning : C.textDim;
    return `<text x="${x}" y="${h - 1}" text-anchor="middle" fill="${color}" font-size="8" font-family="ui-monospace, monospace" font-weight="${isToday ? 700 : 400}">${t.day.charAt(0)}</text>`;
  }).join('');
  return `
    <svg viewBox="0 0 ${w} ${h + 14}" xmlns="http://www.w3.org/2000/svg" class="sparkline" style="height: 62px;" preserveAspectRatio="none">
      <polyline points="${poly}" fill="none" stroke="${C.green}" stroke-width="2" vector-effect="non-scaling-stroke"/>
      ${squares}
      ${labels}
    </svg>
  `;
}

const buildAvgTicketCard = (sales) => {
  const avg = sales.check_avg ?? 0;

  // Sparkline: hourly avg ticket = net/checks per hour
  const hourlyAvg = (sales.hourly_sales || []).map(h =>
    h.checks > 0 ? h.net / h.checks : 0
  );

  return `
    <div class="home-card" style="--accent: ${C.lavender};">
      <div class="card-label">Avg Ticket</div>
      <div class="stat-top">
        <div class="stat-top-left">
          <div class="card-big" style="color: ${C.text}; margin-bottom: 6px;">${fmt$(avg)}</div>
          <div class="card-sub">${sales.total_checks} total checks</div>
        </div>
        <div class="stat-top-spark">${buildCardSparkline(hourlyAvg, C.lavender)}</div>
      </div>
    </div>
  `;
}

const buildRevenueChartCard = (hourly) => {
  return `
    <div class="home-card home-card-tall" style="--accent: ${C.gold};">
      <div class="card-label">Revenue — This Week vs Last Week</div>
      <div class="chart-container">
        <canvas id="home-revenue-chart"></canvas>
      </div>
    </div>
  `;
}

const buildTenderCard = (sales) => {
  const cash = sales.cash_total ?? 0;
  const card = sales.card_total ?? 0;
  const total = cash + card;
  const cashPct = total > 0 ? (cash / total) * 100 : 0;
  const cardPct = total > 0 ? (card / total) * 100 : 0;

  // Visual stacked bar (svg) — card on top, cash on bottom
  const barH = 140;
  const cardH = total > 0 ? (cardPct / 100) * barH : 0;
  const cashH = barH - cardH;

  return `
    <div class="home-card home-card-tall" style="--accent: ${C.green};">
      <div class="card-label">Tender Split</div>
      <div style="display: flex; gap: 20px; align-items: flex-end; margin-top: 20px;">
        <svg width="48" height="${barH}" xmlns="http://www.w3.org/2000/svg">
          <rect x="0" y="0" width="48" height="${cardH}" fill="${C.cyan}"/>
          <rect x="0" y="${cardH}" width="48" height="${cashH}" fill="${C.green}"/>
        </svg>
        <div style="flex: 1;">
          <div style="margin-bottom: 16px;">
            <div style="display: flex; align-items: center; gap: 6px;">
              <div style="width: 10px; height: 10px; background: ${C.cyan};"></div>
              <div class="card-mini-label" style="margin: 0;">CARD</div>
            </div>
            <div style="font-size: 20px; font-weight: 700; color: ${C.cyan}; margin-top: 4px; font-family: ui-monospace, monospace;">${fmt$(card)}</div>
            <div style="font-size: 10px; color: ${C.textDim}; font-family: ui-monospace, monospace;">${cardPct.toFixed(1)}%</div>
          </div>
          <div>
            <div style="display: flex; align-items: center; gap: 6px;">
              <div style="width: 10px; height: 10px; background: ${C.green};"></div>
              <div class="card-mini-label" style="margin: 0;">CASH</div>
            </div>
            <div style="font-size: 20px; font-weight: 700; color: ${C.green}; margin-top: 4px; font-family: ui-monospace, monospace;">${fmt$(cash)}</div>
            <div style="font-size: 10px; color: ${C.textDim}; font-family: ui-monospace, monospace;">${cashPct.toFixed(1)}%</div>
          </div>
        </div>
      </div>
    </div>
  `;
}

const buildTopCategoriesCard = (sales) => {
  const cats = (sales.category_breakdown || []).slice(0, 5);
  if (cats.length === 0) {
    return `
      <div class="home-card" style="--accent: ${C.cyan};">
        <div class="card-label">Top Categories Today</div>
        <div class="home-empty">No sales yet today</div>
      </div>
    `;
  }
  const maxRev = Math.max(...cats.map(c => c.net_sales), 1);
  const rows = cats.map((c, i) => {
    const pct = Math.max(4, (c.net_sales / maxRev) * 100);
    const barColor = withAlpha(catColor(c.category), 0.22);
    return `
      <div class="rank-row">
        <div class="rank-bar" style="width: ${pct}%; background: ${barColor};"></div>
        <div class="rank-content">
          <span class="rank-num">${i + 1}.</span>
          <span class="rank-label">${c.category} <span style="color: ${C.textDim}; margin-left: 6px; font-size: 13px;">${c.items_sold} items</span></span>
          <span class="rank-value">${fmt$(c.net_sales)} · ${c.pct.toFixed(1)}%</span>
        </div>
      </div>
    `;
  }).join('');
  return `
    <div class="home-card" style="--accent: ${C.cyan};">
      <div class="card-label">Top Categories Today</div>
      <div class="rank-list">${rows}</div>
    </div>
  `;
}

const buildTopServersCard = (sales) => {
  const servers = (sales.top_servers || []);
  if (servers.length === 0) {
    return `
      <div class="home-card" style="--accent: ${C.lavender};">
        <div class="card-label">Server Sales</div>
        <div class="home-empty">No servers active</div>
      </div>
    `;
  }
  const maxRev = Math.max(...servers.map(s => s.revenue), 1);
  const rows = servers.map((s, i) => {
    const pct = Math.max(4, (s.revenue / maxRev) * 100);
    return `
      <div class="rank-row">
        <div class="rank-bar" style="width: ${pct}%; background: rgba(180, 142, 250, 0.14);"></div>
        <div class="rank-content">
          <span class="rank-num">${i + 1}.</span>
          <span class="rank-label">${s.name}</span>
          <span class="rank-value">${fmt$(s.revenue)} · ${s.checks} checks</span>
        </div>
      </div>
    `;
  }).join('');
  return `
    <div class="home-card" style="--accent: ${C.lavender};">
      <div class="card-label">Server Sales</div>
      <div class="rank-list">${rows}</div>
    </div>
  `;
}

// ─── Chart.js revenue chart ──────────────────────────────────────────
const drawRevenueChart = (canvas, hourly) => {
  if (!window.Chart) {
    console.warn('[home] Chart.js not loaded — revenue chart unavailable');
    return;
  }
  if (_chartInstance) {
    try { _chartInstance.destroy(); } catch (e) {}
    _chartInstance = null;
  }

  const today = hourly.today || [];
  const lastWeek = hourly.last_week || [];
  const labels = today.map(h => h.hour);

  _chartInstance = new Chart(canvas, {
    type: 'line',
    data: {
      labels,
      datasets: [
        {
          label: 'Last Week',
          data: lastWeek.map(h => h.net_sales),
          borderColor: C.lavender,
          backgroundColor: 'transparent',
          borderDash: [5, 3],
          borderWidth: 1.5,
          pointRadius: 0,
          tension: 0.25,
          order: 2,
        },
        {
          label: 'This Week',
          data: today.map(h => h.net_sales),
          borderColor: C.cyan,
          backgroundColor: 'transparent',
          borderWidth: 2.5,
          pointStyle: 'rect',
          pointRadius: 4,
          pointBackgroundColor: C.cyan,
          tension: 0.25,
          order: 1,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          position: 'top',
          align: 'end',
          labels: {
            color: C.textMuted,
            font: { family: 'ui-monospace, monospace', size: 10 },
            usePointStyle: true,
            boxWidth: 10,
          },
        },
        tooltip: {
          backgroundColor: C.well,
          titleColor: C.text,
          bodyColor: C.text,
          borderColor: C.border,
          borderWidth: 1,
          callbacks: {
            label: (ctx) => ` ${ctx.dataset.label}: ${fmt$(ctx.parsed.y)}`,
          },
        },
      },
      scales: {
        x: {
          grid: { color: C.well, drawBorder: false },
          ticks: {
            color: C.textDim,
            font: { family: 'ui-monospace, monospace', size: 10 },
          },
        },
        y: {
          grid: { color: C.well, drawBorder: false },
          ticks: {
            color: C.textDim,
            font: { family: 'ui-monospace, monospace', size: 10 },
            callback: (v) => fmt$K(v),
          },
        },
      },
    },
  });
}

// ─── Render ──────────────────────────────────────────────────────────
const render = (container, data) => {
  const { sales, labor } = data;

  const contentEl = container.querySelector('#home-content');
  if (!contentEl) return;

  contentEl.innerHTML = `
    <div class="home-cards-row">
      ${buildNetSalesCard(sales)}
      ${buildOpenChecksCard(sales)}
      ${buildLaborCard(labor)}
      ${buildAvgTicketCard(sales)}
    </div>
  `;

  // No revenue chart on home anymore — moved to Sales Reports.
  // (Leaving Chart.js still loaded in index.html for when it returns in REPORTING.)
}

const renderError = (container, err) => {
  const contentEl = container.querySelector('#home-content');
  if (!contentEl) return;
  contentEl.innerHTML = `
    <div class="home-state home-error">
      Could not load dashboard data.<br/>
      <span style="opacity: 0.6; font-size: 12px;">${err.message || err}</span>
    </div>
  `;
}

// ─── Public API ──────────────────────────────────────────────────────
export function buildHomeScene(container) {
  _currentContainer = container;
  buildLayout(container);

  _abortController = new AbortController();
  fetchAll(_abortController.signal)
    .then(data => {
      if (_currentContainer === container) render(container, data);
    })
    .catch(err => {
      if (err.name === 'AbortError') return;
      console.error('[home] Fetch error:', err);
      if (_currentContainer === container) renderError(container, err);
    });
}

export function cleanupHome() {
  if (_abortController) {
    _abortController.abort();
    _abortController = null;
  }
  if (_chartInstance) {
    try { _chartInstance.destroy(); } catch (e) {}
    _chartInstance = null;
  }
  _currentContainer = null;
}