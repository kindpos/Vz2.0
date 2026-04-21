/* ============================================
   KINDpos Overseer — chart primitives

   Sibling to ui/forms.js. DOM-built builders that return
   HTMLElement / SVGElement nodes (not HTML strings). Each
   builder has no side effects beyond constructing the node.

   Exports so far:
     buildSparkline(values, opts)              → SVGElement
     buildStatCard({ label, accent, value,
                     valueColor, valueSuffix,
                     sub, spark })             → HTMLElement

   More builders (buildLineCard, buildStackedArea, buildHeatmap,
   buildHistogram, buildStackedBar, buildCOBGauge, buildMiniTable)
   are added as subsequent phases need them.
   ============================================ */

import { T, withAlpha } from './tokens.js';

const SVG_NS = 'http://www.w3.org/2000/svg';

function svg(tag, attrs = {}) {
  const el = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null) continue;
    el.setAttribute(k, String(v));
  }
  return el;
}

// ─── buildSparkline ─────────────────────────────────────────────────
// Small area+line sparkline with square data points. The peak index
// gets a soft glow behind its square. If peakColor is omitted, the
// peak re-uses `color`.
export function buildSparkline(values, opts = {}) {
  const {
    color     = T.cyan,
    peakColor,
    height    = 40,
    width     = 60,
    glowPeak  = true,
    pad       = 4,
  } = opts;

  const root = svg('svg', {
    viewBox: `0 0 ${width} ${height}`,
    preserveAspectRatio: 'none',
    xmlns: SVG_NS,
  });
  root.style.display = 'block';
  root.style.width = `${width}px`;
  root.style.height = `${height}px`;
  root.style.flexShrink = '0';

  if (!values || values.length === 0) return root;

  const maxV = Math.max(...values, 0.0001);
  const minV = Math.min(...values, maxV);
  const span = Math.max(maxV - minV, 0.0001);
  const n = values.length;
  const xStep = (width - pad * 2) / Math.max(1, n - 1);
  const pts = values.map((v, i) => {
    const x = pad + i * xStep;
    const y = pad + ((maxV - v) / span) * (height - pad * 2);
    return { x, y, v, i };
  });
  const peakIdx = pts.reduce((best, p) => p.v > pts[best].v ? p.i : best, 0);
  const pkColor = peakColor || color;

  // Area fill below the line
  const areaPoints = [
    `${pad},${height - pad}`,
    ...pts.map(p => `${p.x},${p.y}`),
    `${width - pad},${height - pad}`,
  ].join(' ');
  root.appendChild(svg('polygon', {
    points: areaPoints,
    fill: withAlpha(color, 0.12),
  }));

  // Stroked line
  root.appendChild(svg('polyline', {
    points: pts.map(p => `${p.x},${p.y}`).join(' '),
    fill: 'none',
    stroke: color,
    'stroke-width': 1.5,
    'vector-effect': 'non-scaling-stroke',
  }));

  // Glow behind peak (a larger semi-transparent square)
  if (glowPeak) {
    const pk = pts[peakIdx];
    root.appendChild(svg('rect', {
      x: pk.x - 5,
      y: pk.y - 5,
      width: 10,
      height: 10,
      fill: withAlpha(pkColor, 0.35),
    }));
  }

  // Solid square data points (6×6 on peak, 4×4 elsewhere)
  for (const p of pts) {
    const isPeak = p.i === peakIdx;
    const size = isPeak ? 6 : 4;
    root.appendChild(svg('rect', {
      x: p.x - size / 2,
      y: p.y - size / 2,
      width: size,
      height: size,
      fill: isPeak ? pkColor : color,
    }));
  }

  return root;
}

// ─── buildStatCard ──────────────────────────────────────────────────
// Returns an HTMLElement: a single hero card.
//
//   { label, accent, value, valueColor, valueSuffix, sub, spark }
//
// - label:        eyebrow text, e.g. "Net Sales"
// - accent:       left-border color (T.gold for money, T.cyan, T.mint, …)
// - value:        pre-formatted big number, e.g. "$38,417.22" or "1,842"
// - valueColor:   color for the big number; defaults to T.text
// - valueSuffix:  optional small-tone suffix (the "%" on tip-% card)
// - sub:          small mono text below the big number
// - spark:        { values, color, peakColor? } — omit to skip sparkline
//
// Cards are sized to flex into a repeat(4, 1fr) grid; min-height 118.
export function buildStatCard(opts) {
  const {
    label,
    accent      = T.gold,
    value,
    valueColor  = T.text,
    valueSuffix = '',
    sub         = '',
    spark,
  } = opts;

  const card = document.createElement('div');
  card.className = 'sales-stat-card';
  card.style.cssText = `
    position: relative;
    background: ${T.card};
    border-radius: ${T.r.md}px;
    padding: 16px 18px;
    min-height: 118px;
    box-sizing: border-box;
    overflow: hidden;
  `;

  // Left-border accent stripe
  const stripe = document.createElement('div');
  stripe.style.cssText = `
    position: absolute;
    left: 0; top: 0; bottom: 0;
    width: 4px;
    background: ${accent};
    border-radius: 2px 0 0 2px;
  `;
  card.appendChild(stripe);

  // Top row: eyebrow label (left) + sparkline (right)
  const topRow = document.createElement('div');
  topRow.style.cssText = `
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    gap: 12px;
    margin-bottom: 8px;
  `;
  const eyebrow = document.createElement('div');
  eyebrow.textContent = label;
  eyebrow.style.cssText = `
    font-family: ${T.font.mono};
    font-size: ${T.fs.sm}px;
    letter-spacing: 2px;
    color: ${T.textMuted};
    font-weight: 700;
    text-transform: uppercase;
    line-height: 1.2;
  `;
  topRow.appendChild(eyebrow);
  if (spark && spark.values && spark.values.length) {
    topRow.appendChild(buildSparkline(spark.values, {
      color: spark.color || accent,
      peakColor: spark.peakColor,
      height: 40,
      width: 60,
    }));
  }
  card.appendChild(topRow);

  // Big number row
  const bigRow = document.createElement('div');
  bigRow.style.cssText = `
    display: flex;
    align-items: baseline;
    gap: 4px;
    line-height: 1;
    margin-bottom: 8px;
  `;
  const bigNum = document.createElement('div');
  bigNum.textContent = value;
  bigNum.style.cssText = `
    font-size: 36px;
    font-weight: 700;
    color: ${valueColor};
  `;
  bigRow.appendChild(bigNum);
  if (valueSuffix) {
    const suf = document.createElement('div');
    suf.textContent = valueSuffix;
    suf.style.cssText = `
      font-size: 18px;
      font-weight: 700;
      color: ${T.textDim};
    `;
    bigRow.appendChild(suf);
  }
  card.appendChild(bigRow);

  // Sub line
  if (sub) {
    const subEl = document.createElement('div');
    subEl.textContent = sub;
    subEl.style.cssText = `
      font-family: ${T.font.mono};
      font-size: ${T.fs.sm}px;
      color: ${T.textMuted};
      letter-spacing: 0.5px;
    `;
    card.appendChild(subEl);
  }

  return card;
}
