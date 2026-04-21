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
import { fmt, fmtPP }    from './money.js';

const SVG_NS = 'http://www.w3.org/2000/svg';

// Monotonic ID generator for SVG <defs> (gradients, filters) so
// multiple charts on one page don't collide.
let _svgDefCounter = 0;
function nextDefId(prefix) { return `${prefix}-${++_svgDefCounter}`; }

function svg(tag, attrs = {}) {
  const el = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null) continue;
    el.setAttribute(k, String(v));
  }
  return el;
}

// Round a max-value upwards to a "nice" gridline step.
function niceMax(rawMax) {
  if (rawMax <= 0) return 1;
  const mag = Math.pow(10, Math.floor(Math.log10(rawMax)));
  const normalized = rawMax / mag;
  let nice;
  if (normalized <= 1)      nice = 1;
  else if (normalized <= 2) nice = 2;
  else if (normalized <= 5) nice = 5;
  else                      nice = 10;
  return nice * mag;
}

// Shell used by chart cards: mint-ish card surface + optional left-border
// accent + header slot + body slot. Returns { card, header, body } so the
// caller can append title / legend / chart bits directly.
function buildCardShell({ accent = T.mint, minHeight = 280 } = {}) {
  const card = document.createElement('div');
  card.style.cssText = `
    position: relative;
    background: ${T.card};
    border-radius: ${T.r.md}px;
    padding: 16px 18px;
    min-height: ${minHeight}px;
    box-sizing: border-box;
    overflow: hidden;
    display: flex;
    flex-direction: column;
    gap: 10px;
  `;
  const stripe = document.createElement('div');
  stripe.style.cssText = `
    position: absolute;
    left: 0; top: 0; bottom: 0;
    width: 4px;
    background: ${accent};
    border-radius: 2px 0 0 2px;
  `;
  card.appendChild(stripe);

  const header = document.createElement('div');
  header.style.cssText = `
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
  `;
  card.appendChild(header);

  const body = document.createElement('div');
  body.style.cssText = `flex: 1; min-height: 0; display: flex; flex-direction: column;`;
  card.appendChild(body);

  return { card, header, body };
}

// Generic eyebrow label element.
function buildEyebrow(text) {
  const el = document.createElement('div');
  el.textContent = text;
  el.style.cssText = `
    font-family: ${T.font.mono};
    font-size: ${T.fs.sm}px;
    letter-spacing: 2px;
    color: ${T.textMuted};
    font-weight: 700;
    text-transform: uppercase;
  `;
  return el;
}

// Mono mini-label (sub / caption) element.
function buildMonoLabel(text, { size = T.fs.sm, color = T.textDim, letterSpacing = 1 } = {}) {
  const el = document.createElement('div');
  el.textContent = text;
  el.style.cssText = `
    font-family: ${T.font.mono};
    font-size: ${size}px;
    color: ${color};
    letter-spacing: ${letterSpacing}px;
    text-transform: uppercase;
  `;
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

// ─── buildLineCard ──────────────────────────────────────────────────
// Multi-series line chart inside a card shell. Each series defines its
// own color + stroke style + marker behavior.
//
//   {
//     title,       // "Sales Trend"
//     subtitle,    // optional small caption under title
//     accent,      // left-border color
//     xLabels,     // ["11a","12p",...] — one per index across all series
//     series: [
//       { name, values, color, dashed, markers },
//       ...
//     ],
//     formatY,     // (n) => string for Y-axis tick labels (default fmt compact)
//     height,      // chart SVG height (default 200)
//     peakGlow,    // glow the max point across all series (default true)
//     glowColor,   // defaults to T.gold
//   }
export function buildLineCard(opts) {
  const {
    title,
    subtitle,
    accent    = T.mint,
    xLabels   = [],
    series    = [],
    formatY   = (n) => fmt(n, { dp: 0, compact: true }),
    height    = 200,
    peakGlow  = true,
    glowColor = T.gold,
  } = opts;

  const { card, header, body } = buildCardShell({ accent });

  // Header: title (+ optional subtitle) on left, legend chips on right
  const left = document.createElement('div');
  left.style.cssText = 'display: flex; flex-direction: column; gap: 4px;';
  if (title) left.appendChild(buildEyebrow(title));
  if (subtitle) left.appendChild(buildMonoLabel(subtitle, {
    size: T.fs.xs, color: T.textDim, letterSpacing: 1.2,
  }));
  header.appendChild(left);

  const legend = document.createElement('div');
  legend.style.cssText = 'display: flex; gap: 14px; align-items: center;';
  for (const s of series) {
    const chip = document.createElement('div');
    chip.style.cssText = `
      display: inline-flex; align-items: center; gap: 6px;
      font-family: ${T.font.mono}; font-size: ${T.fs.xs}px;
      letter-spacing: 1.5px; text-transform: uppercase;
      color: ${T.textMuted}; font-weight: 700;
    `;
    const swatch = document.createElement('span');
    swatch.style.cssText = `
      display: inline-block; width: 10px; height: 10px;
      background: ${s.color}; border-radius: 2px;
      ${s.dashed ? `outline: 1px dashed ${s.color}; background: transparent;` : ''}
    `;
    chip.appendChild(swatch);
    const label = document.createElement('span');
    label.textContent = s.name;
    chip.appendChild(label);
    legend.appendChild(chip);
  }
  header.appendChild(legend);

  // Chart SVG
  const chartWrap = document.createElement('div');
  chartWrap.style.cssText = 'flex: 1; min-height: 0;';
  body.appendChild(chartWrap);

  const hasData = series.length > 0 && series.some(s => (s.values || []).length > 0);
  if (!hasData) {
    const empty = document.createElement('div');
    empty.textContent = 'No data';
    empty.style.cssText = `
      display: flex; align-items: center; justify-content: center;
      height: ${height}px;
      font-family: ${T.font.mono}; font-size: ${T.fs.sm}px;
      color: ${T.textDim}; letter-spacing: 2px; text-transform: uppercase;
    `;
    chartWrap.appendChild(empty);
    return card;
  }

  const padL = 42, padR = 12, padT = 12, padB = 26;
  const vbW = 720, vbH = height;
  const plotW = vbW - padL - padR;
  const plotH = vbH - padT - padB;
  const n = Math.max(...series.map(s => (s.values || []).length), 1);
  const rawMax = Math.max(0.001, ...series.flatMap(s => s.values || []));
  const yMax = niceMax(rawMax);
  const xAt = (i) => padL + (n === 1 ? plotW / 2 : (plotW * i) / (n - 1));
  const yAt = (v) => padT + (1 - v / yMax) * plotH;

  const root = svg('svg', {
    viewBox: `0 0 ${vbW} ${vbH}`,
    preserveAspectRatio: 'none',
    xmlns: SVG_NS,
  });
  root.style.cssText = `display: block; width: 100%; height: ${height}px;`;

  // Y-axis gridlines + tick labels (5 bands)
  const yTicks = 5;
  for (let i = 0; i <= yTicks; i++) {
    const v = (yMax * i) / yTicks;
    const y = yAt(v);
    root.appendChild(svg('line', {
      x1: padL, x2: padL + plotW, y1: y, y2: y,
      stroke: T.well, 'stroke-width': 1,
    }));
    const lbl = svg('text', {
      x: padL - 6, y: y + 3,
      'text-anchor': 'end',
      'font-family': T.font.mono,
      'font-size': 9,
      fill: T.textDim,
      'letter-spacing': 1,
    });
    lbl.textContent = formatY(v);
    root.appendChild(lbl);
  }

  // X-axis labels
  for (let i = 0; i < xLabels.length; i++) {
    const x = xAt(i);
    const lbl = svg('text', {
      x, y: vbH - 8,
      'text-anchor': 'middle',
      'font-family': T.font.mono,
      'font-size': 9,
      fill: T.textDim,
      'letter-spacing': 1,
    });
    lbl.textContent = xLabels[i];
    root.appendChild(lbl);
  }

  // Series polylines + markers
  let peak = { v: -Infinity, x: 0, y: 0, color: glowColor };
  for (const s of series) {
    const vals = s.values || [];
    const pts = vals.map((v, i) => ({ x: xAt(i), y: yAt(v), v }));
    const line = svg('polyline', {
      points: pts.map(p => `${p.x},${p.y}`).join(' '),
      fill: 'none',
      stroke: s.color,
      'stroke-width': 2,
      'stroke-linecap': 'round',
      'stroke-linejoin': 'round',
      'vector-effect': 'non-scaling-stroke',
    });
    if (s.dashed) line.setAttribute('stroke-dasharray', '5,4');
    root.appendChild(line);

    if (s.markers) {
      for (const p of pts) {
        root.appendChild(svg('rect', {
          x: p.x - 3, y: p.y - 3, width: 6, height: 6,
          fill: s.color,
        }));
      }
    }
    for (const p of pts) {
      if (p.v > peak.v) peak = { v: p.v, x: p.x, y: p.y, color: s.color };
    }
  }

  // Peak glow
  if (peakGlow && isFinite(peak.v)) {
    root.appendChild(svg('rect', {
      x: peak.x - 7, y: peak.y - 7, width: 14, height: 14,
      fill: withAlpha(glowColor, 0.35),
    }));
    root.appendChild(svg('rect', {
      x: peak.x - 4, y: peak.y - 4, width: 8, height: 8,
      fill: glowColor,
    }));
  }

  chartWrap.appendChild(root);
  return card;
}

// ─── buildCOBGauge ──────────────────────────────────────────────────
// Semicircle gauge for Cost-of-Business %. Three-band sweep (green /
// yellow / red) with a needle pointing at the current value, a big
// readout below, a PASS/WARN/CRIT status line, and an optional bottom
// strip showing Labor $, Hours, and Target.
//
// Input percentages are in 0..100 (matching the backend's
// labor-summary.cob_percent shape), NOT fractions.
//
//   {
//     pct,         // current value (0..100)
//     warnAt = 28, // boundary green → yellow (0..100)
//     critAt = 35, // boundary yellow → red (0..100)
//     max    = 50, // end of gauge (0..100)
//     labor,       // optional $ amount (number)
//     hours,       // optional hours (number)
//   }
export function buildCOBGauge(opts) {
  const {
    pct,
    warnAt = 28,
    critAt = 35,
    max    = 50,
    labor,
    hours,
  } = opts;

  const { card, header, body } = buildCardShell({ accent: T.mint });
  header.appendChild(buildEyebrow('Cost of Business'));

  // SVG gauge
  const vbW = 320, vbH = 200;
  const cx = vbW / 2, cy = 150, r = 115;
  const bandStroke = 14;

  const root = svg('svg', {
    viewBox: `0 0 ${vbW} ${vbH}`,
    xmlns: SVG_NS,
  });
  root.style.cssText = `display: block; width: 100%; height: 160px;`;

  // Angle: 180° = leftmost (0% value), 0° = rightmost (max value).
  // Sweeps counter-clockwise in screen-visible terms (over the top).
  const angleFor = (p) => {
    const clamped = Math.max(0, Math.min(max, p));
    return 180 - 180 * (clamped / max);
  };
  const pointAt = (angleDeg) => {
    const rad = (angleDeg * Math.PI) / 180;
    return { x: cx + r * Math.cos(rad), y: cy - r * Math.sin(rad) };
  };

  // Draw a band arc from angle θ1 to θ2 (in degrees, both in [0..180]).
  // Uses small-segment polyline to side-step SVG arc sweep quirks.
  function drawBand(deg1, deg2, color) {
    const steps = Math.max(4, Math.ceil(Math.abs(deg2 - deg1) / 3));
    const pts = [];
    for (let s = 0; s <= steps; s++) {
      const t = s / steps;
      const a = deg1 + (deg2 - deg1) * t;
      const p = pointAt(a);
      pts.push(`${p.x.toFixed(2)},${p.y.toFixed(2)}`);
    }
    root.appendChild(svg('polyline', {
      points: pts.join(' '),
      fill: 'none',
      stroke: color,
      'stroke-width': bandStroke,
      'stroke-linecap': 'butt',
    }));
  }

  // Bands — remember angle DECREASES as pct increases (180° @ 0% → 0° @ max).
  drawBand(180,           angleFor(warnAt), T.greenUp);         // green zone
  drawBand(angleFor(warnAt), angleFor(critAt), T.warning);      // yellow zone
  drawBand(angleFor(critAt), 0,               T.verm);          // red zone

  // Tick labels (0%, warnAt%, critAt%, max%)
  const tickValues = [0, warnAt, critAt, max];
  for (const v of tickValues) {
    const p = pointAt(angleFor(v));
    // Label sits just outside the band, pulled radially outward.
    const outward = 16;
    const rad = (angleFor(v) * Math.PI) / 180;
    const tx = cx + (r + outward) * Math.cos(rad);
    const ty = cy - (r + outward) * Math.sin(rad) + 3;
    const lbl = svg('text', {
      x: tx, y: ty,
      'text-anchor': 'middle',
      'font-family': T.font.mono,
      'font-size': 9,
      fill: T.textDim,
      'letter-spacing': 1,
    });
    lbl.textContent = `${v}%`;
    root.appendChild(lbl);
  }

  // Needle
  const tip = pointAt(angleFor(pct));
  const innerR = 12;
  const innerAngleRad = (angleFor(pct) * Math.PI) / 180;
  const nx = cx + innerR * Math.cos(innerAngleRad);
  const ny = cy - innerR * Math.sin(innerAngleRad);
  root.appendChild(svg('line', {
    x1: nx, y1: ny, x2: tip.x, y2: tip.y,
    stroke: T.text,
    'stroke-width': 2,
    'stroke-linecap': 'round',
  }));
  // Pivot
  root.appendChild(svg('circle', {
    cx, cy, r: 6,
    fill: T.text,
  }));
  root.appendChild(svg('circle', {
    cx, cy, r: 3,
    fill: T.card,
  }));

  body.appendChild(root);

  // Determine zone color + status
  let zoneColor, statusText;
  if (pct <= warnAt) {
    zoneColor = T.greenUp;
    statusText = 'Pass';
  } else if (pct <= critAt) {
    zoneColor = T.warning;
    statusText = `Warn · ${fmtPP((pct - warnAt) / 100)} above target`;
  } else {
    zoneColor = T.verm;
    statusText = `Crit · ${fmtPP((pct - warnAt) / 100)} above target`;
  }

  // Big readout
  const readout = document.createElement('div');
  readout.style.cssText = `
    text-align: center;
    font-size: 32px;
    font-weight: 700;
    color: ${zoneColor};
    line-height: 1;
    margin-top: -14px;
  `;
  readout.textContent = `${pct.toFixed(1)}%`;
  body.appendChild(readout);

  // Status line
  const status = document.createElement('div');
  status.style.cssText = `
    text-align: center;
    margin-top: 6px;
    font-family: ${T.font.mono};
    font-size: ${T.fs.sm}px;
    letter-spacing: 1.5px;
    text-transform: uppercase;
    color: ${zoneColor};
    font-weight: 700;
  `;
  status.textContent = statusText;
  body.appendChild(status);

  // Bottom strip
  if (labor != null || hours != null) {
    const strip = document.createElement('div');
    strip.style.cssText = `
      margin-top: 12px;
      padding-top: 10px;
      border-top: 1px solid ${T.well};
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 8px;
      text-align: center;
    `;
    const makeCell = (lbl, val) => {
      const cell = document.createElement('div');
      const l = document.createElement('div');
      l.textContent = lbl;
      l.style.cssText = `
        font-family: ${T.font.mono}; font-size: ${T.fs.xs}px;
        color: ${T.textDim}; letter-spacing: 1.5px;
        text-transform: uppercase; margin-bottom: 3px;
      `;
      const v = document.createElement('div');
      v.textContent = val;
      v.style.cssText = `
        font-family: ${T.font.mono}; font-size: ${T.fs.base}px;
        color: ${T.text}; font-weight: 700;
      `;
      cell.appendChild(l);
      cell.appendChild(v);
      return cell;
    };
    strip.appendChild(makeCell('Labor', labor != null ? fmt(labor, { dp: 0 }) : '—'));
    strip.appendChild(makeCell('Hours', hours != null ? hours.toFixed(1) : '—'));
    strip.appendChild(makeCell('Target', `${warnAt}%`));
    body.appendChild(strip);
  }

  return card;
}

// ─── buildStackedArea ───────────────────────────────────────────────
// Multi-layer stacked area chart. Each layer is filled with a vertical
// gradient (more opaque at top, softer at bottom) on top of the layer
// below it. The top edge (cumulative total) is stroked and marked.
//
//   {
//     title,               // "Hourly Composition"
//     subtitle,
//     accent,              // left-border color (T.mint)
//     xLabels,             // ["11:00","12:00",...]
//     layers: [            // bottom-to-top
//       { name, values, color },
//       ...
//     ],
//     formatY,
//     height,              // chart SVG height
//     topStrokeColor,      // top-edge line color (default: T.cyan)
//     topMarkers,          // bool, default true
//     peakGlow,            // bool, default true — glow the top-edge max
//     glowColor,           // default: T.gold
//   }
export function buildStackedArea(opts) {
  const {
    title,
    subtitle,
    accent         = T.mint,
    xLabels        = [],
    layers         = [],
    formatY        = (n) => fmt(n, { dp: 0, compact: true }),
    height         = 220,
    topStrokeColor = T.cyan,
    topMarkers     = true,
    peakGlow       = true,
    glowColor      = T.gold,
  } = opts;

  const { card, header, body } = buildCardShell({ accent, minHeight: 280 });

  // Header: title + subtitle
  const left = document.createElement('div');
  left.style.cssText = 'display: flex; flex-direction: column; gap: 4px;';
  if (title) left.appendChild(buildEyebrow(title));
  if (subtitle) left.appendChild(buildMonoLabel(subtitle, {
    size: T.fs.xs, color: T.textDim, letterSpacing: 1.2,
  }));
  header.appendChild(left);

  // Legend chips (top-right)
  const legend = document.createElement('div');
  legend.style.cssText = 'display: flex; gap: 14px; align-items: center; flex-wrap: wrap;';
  for (const L of layers) {
    const chip = document.createElement('div');
    chip.style.cssText = `
      display: inline-flex; align-items: center; gap: 6px;
      font-family: ${T.font.mono}; font-size: ${T.fs.xs}px;
      letter-spacing: 1.5px; text-transform: uppercase;
      color: ${T.textMuted}; font-weight: 700;
    `;
    const sw = document.createElement('span');
    sw.style.cssText = `
      display: inline-block; width: 10px; height: 10px;
      background: ${L.color}; border-radius: 2px;
    `;
    chip.appendChild(sw);
    const lbl = document.createElement('span');
    lbl.textContent = L.name;
    chip.appendChild(lbl);
    legend.appendChild(chip);
  }
  header.appendChild(legend);

  // Chart body
  const chartWrap = document.createElement('div');
  chartWrap.style.cssText = 'flex: 1; min-height: 0;';
  body.appendChild(chartWrap);

  const n = Math.max(...layers.map(L => (L.values || []).length), 0);
  if (n === 0 || layers.length === 0) {
    const empty = document.createElement('div');
    empty.textContent = 'No data';
    empty.style.cssText = `
      display: flex; align-items: center; justify-content: center;
      height: ${height}px;
      font-family: ${T.font.mono}; font-size: ${T.fs.sm}px;
      color: ${T.textDim}; letter-spacing: 2px; text-transform: uppercase;
    `;
    chartWrap.appendChild(empty);
    return card;
  }

  // Compute cumulative sums per x: cum[k][i] = sum of layers[0..k].values[i]
  const cum = [];
  for (let k = 0; k < layers.length; k++) {
    const prev = k === 0 ? new Array(n).fill(0) : cum[k - 1];
    const vals = layers[k].values || [];
    const row = [];
    for (let i = 0; i < n; i++) {
      row.push(prev[i] + (Number(vals[i]) || 0));
    }
    cum.push(row);
  }
  const topTotals = cum[cum.length - 1];
  const rawMax = Math.max(0.001, ...topTotals);
  const yMax = niceMax(rawMax);

  const padL = 44, padR = 14, padT = 12, padB = 26;
  const vbW = 1120, vbH = height;
  const plotW = vbW - padL - padR;
  const plotH = vbH - padT - padB;
  const xAt = (i) => padL + (n === 1 ? plotW / 2 : (plotW * i) / (n - 1));
  const yAt = (v) => padT + (1 - v / yMax) * plotH;

  const root = svg('svg', {
    viewBox: `0 0 ${vbW} ${vbH}`,
    preserveAspectRatio: 'none',
    xmlns: SVG_NS,
  });
  root.style.cssText = `display: block; width: 100%; height: ${height}px;`;

  // Gradient defs — one per layer
  const defs = svg('defs', {});
  const gradIds = [];
  for (let k = 0; k < layers.length; k++) {
    const id = nextDefId('stacked-grad');
    gradIds.push(id);
    const grad = svg('linearGradient', {
      id, x1: 0, y1: 0, x2: 0, y2: 1,
    });
    grad.appendChild(svg('stop', {
      offset: '0%',
      'stop-color': layers[k].color,
      'stop-opacity': 0.55,
    }));
    grad.appendChild(svg('stop', {
      offset: '100%',
      'stop-color': layers[k].color,
      'stop-opacity': 0.25,
    }));
    defs.appendChild(grad);
  }
  root.appendChild(defs);

  // Gridlines + Y tick labels
  const yTicks = 5;
  for (let i = 0; i <= yTicks; i++) {
    const v = (yMax * i) / yTicks;
    const y = yAt(v);
    root.appendChild(svg('line', {
      x1: padL, x2: padL + plotW, y1: y, y2: y,
      stroke: T.well, 'stroke-width': 1,
    }));
    const lbl = svg('text', {
      x: padL - 6, y: y + 3,
      'text-anchor': 'end',
      'font-family': T.font.mono,
      'font-size': 9,
      fill: T.textDim,
      'letter-spacing': 1,
    });
    lbl.textContent = formatY(v);
    root.appendChild(lbl);
  }

  // Stacked layer polygons (bottom up)
  for (let k = 0; k < layers.length; k++) {
    const topRow = cum[k];
    const bottomRow = k === 0 ? new Array(n).fill(0) : cum[k - 1];
    const topPts    = topRow.map((v, i)    => `${xAt(i)},${yAt(v)}`);
    const botPts    = bottomRow.map((v, i) => `${xAt(i)},${yAt(v)}`).reverse();
    const polyPts = [...topPts, ...botPts].join(' ');
    root.appendChild(svg('polygon', {
      points: polyPts,
      fill: `url(#${gradIds[k]})`,
      stroke: 'none',
    }));
  }

  // Top-edge stroke (cumulative total line)
  const topEdgePts = topTotals.map((v, i) => `${xAt(i)},${yAt(v)}`).join(' ');
  root.appendChild(svg('polyline', {
    points: topEdgePts,
    fill: 'none',
    stroke: topStrokeColor,
    'stroke-width': 2,
    'stroke-linecap': 'round',
    'stroke-linejoin': 'round',
    'vector-effect': 'non-scaling-stroke',
  }));

  // Top-edge markers
  let peakIdx = 0;
  for (let i = 0; i < topTotals.length; i++) {
    if (topTotals[i] > topTotals[peakIdx]) peakIdx = i;
  }
  if (topMarkers) {
    for (let i = 0; i < topTotals.length; i++) {
      const x = xAt(i), y = yAt(topTotals[i]);
      if (peakGlow && i === peakIdx) continue; // drawn separately with glow
      root.appendChild(svg('rect', {
        x: x - 3, y: y - 3, width: 6, height: 6,
        fill: topStrokeColor,
      }));
    }
  }
  if (peakGlow && topTotals.length > 0) {
    const x = xAt(peakIdx), y = yAt(topTotals[peakIdx]);
    root.appendChild(svg('rect', {
      x: x - 7, y: y - 7, width: 14, height: 14,
      fill: withAlpha(glowColor, 0.35),
    }));
    root.appendChild(svg('rect', {
      x: x - 4, y: y - 4, width: 8, height: 8,
      fill: glowColor,
    }));
  }

  // X-axis labels
  for (let i = 0; i < xLabels.length; i++) {
    const x = xAt(i);
    const lbl = svg('text', {
      x, y: vbH - 8,
      'text-anchor': 'middle',
      'font-family': T.font.mono,
      'font-size': 9,
      fill: T.textDim,
      'letter-spacing': 1,
    });
    lbl.textContent = xLabels[i];
    root.appendChild(lbl);
  }

  chartWrap.appendChild(root);
  return card;
}

// ─── buildTenderBar ─────────────────────────────────────────────────
// Horizontal proportional split bar for tender composition. N segments
// fill a single track, each proportional to its `amount`. Labels live
// beneath the track (one column per segment).
//
//   {
//     title,
//     subtitle,
//     accent,               // left-border color
//     segments: [
//       { label, amount, count?, color, sub? },
//       ...
//     ],
//     formatAmount,         // (n) => string, default fmt
//   }
export function buildTenderBar(opts) {
  const {
    title,
    subtitle,
    accent       = T.mint,
    segments     = [],
    formatAmount = (n) => fmt(n, { dp: 0 }),
  } = opts;

  const { card, header, body } = buildCardShell({ accent, minHeight: 220 });

  const left = document.createElement('div');
  left.style.cssText = 'display: flex; flex-direction: column; gap: 4px;';
  if (title) left.appendChild(buildEyebrow(title));
  if (subtitle) left.appendChild(buildMonoLabel(subtitle, {
    size: T.fs.xs, color: T.textDim, letterSpacing: 1.2,
  }));
  header.appendChild(left);

  const total = segments.reduce((s, x) => s + (Number(x.amount) || 0), 0);
  const totalEl = document.createElement('div');
  totalEl.style.cssText = `
    font-family: ${T.font.mono};
    font-size: ${T.fs.base}px;
    color: ${T.text};
    font-weight: 700;
    letter-spacing: 1px;
  `;
  totalEl.textContent = formatAmount(total);
  header.appendChild(totalEl);

  // Proportional bar
  const bar = document.createElement('div');
  bar.style.cssText = `
    display: flex;
    height: 24px;
    width: 100%;
    border-radius: ${T.r.sm}px;
    overflow: hidden;
    background: ${T.well};
    margin-top: 12px;
  `;
  for (const s of segments) {
    const amt = Number(s.amount) || 0;
    const pct = total > 0 ? (amt / total) * 100 : 0;
    if (pct <= 0) continue;
    const seg = document.createElement('div');
    seg.style.cssText = `
      width: ${pct.toFixed(3)}%;
      background: ${s.color};
      height: 100%;
    `;
    bar.appendChild(seg);
  }
  body.appendChild(bar);

  // Legend row underneath, one column per segment
  const grid = document.createElement('div');
  grid.style.cssText = `
    display: grid;
    grid-template-columns: repeat(${Math.max(1, segments.length)}, 1fr);
    gap: 14px;
    margin-top: 14px;
  `;
  for (const s of segments) {
    const amt = Number(s.amount) || 0;
    const pct = total > 0 ? (amt / total) * 100 : 0;
    const cell = document.createElement('div');
    cell.style.cssText = 'display: flex; flex-direction: column; gap: 3px; min-width: 0;';

    const labelRow = document.createElement('div');
    labelRow.style.cssText = `
      display: flex; align-items: center; gap: 6px;
      font-family: ${T.font.mono}; font-size: ${T.fs.xs}px;
      letter-spacing: 1.5px; text-transform: uppercase;
      color: ${T.textMuted}; font-weight: 700;
    `;
    const sw = document.createElement('span');
    sw.style.cssText = `width: 10px; height: 10px; background: ${s.color}; border-radius: 2px;`;
    labelRow.appendChild(sw);
    const lbl = document.createElement('span');
    lbl.textContent = s.label;
    labelRow.appendChild(lbl);
    cell.appendChild(labelRow);

    const amtEl = document.createElement('div');
    amtEl.style.cssText = `
      font-family: ${T.font.mono}; font-size: ${T.fs.lg}px;
      color: ${s.color}; font-weight: 700;
    `;
    amtEl.textContent = formatAmount(amt);
    cell.appendChild(amtEl);

    const subEl = document.createElement('div');
    subEl.style.cssText = `
      font-family: ${T.font.mono}; font-size: ${T.fs.xs}px;
      color: ${T.textDim}; letter-spacing: 1px;
    `;
    const countPart = (s.count != null) ? `${s.count} checks · ` : '';
    subEl.textContent = `${countPart}${pct.toFixed(1)}%`;
    cell.appendChild(subEl);

    grid.appendChild(cell);
  }
  body.appendChild(grid);

  return card;
}

// ─── buildHeatmap ───────────────────────────────────────────────────
// 2-D intensity grid. Each cell's alpha is val/max (clamped to a
// minimum so empty cells are still faintly visible). The max cell
// gets a gold stroke outline + soft glow. Row/column labels sit
// along the left and top edges.
//
//   {
//     title,
//     subtitle,
//     accent,
//     rowLabels,        // ["MON","TUE",...]
//     colLabels,        // ["11a","12p",...]
//     matrix,           // [[v,v,v,...], ...] rows × cols
//     formatValue,      // (n) => string, default Math.round
//     cellColor,        // default T.cyan
//     glowColor,        // default T.gold
//     peakGlow,         // default true
//   }
export function buildHeatmap(opts) {
  const {
    title,
    subtitle,
    accent      = T.mint,
    rowLabels   = [],
    colLabels   = [],
    matrix      = [],
    formatValue = (n) => String(Math.round(n)),
    cellColor   = T.cyan,
    glowColor   = T.gold,
    peakGlow    = true,
  } = opts;

  const { card, header, body } = buildCardShell({ accent, minHeight: 280 });

  const left = document.createElement('div');
  left.style.cssText = 'display: flex; flex-direction: column; gap: 4px;';
  if (title) left.appendChild(buildEyebrow(title));
  if (subtitle) left.appendChild(buildMonoLabel(subtitle, {
    size: T.fs.xs, color: T.textDim, letterSpacing: 1.2,
  }));
  header.appendChild(left);

  const rows = matrix.length;
  const cols = rows > 0 ? matrix[0].length : 0;
  if (rows === 0 || cols === 0) {
    const empty = document.createElement('div');
    empty.textContent = 'No data';
    empty.style.cssText = `
      display: flex; align-items: center; justify-content: center;
      height: 180px;
      font-family: ${T.font.mono}; font-size: ${T.fs.sm}px;
      color: ${T.textDim}; letter-spacing: 2px; text-transform: uppercase;
    `;
    body.appendChild(empty);
    return card;
  }

  // Find max + peak cell
  let maxV = 0, peakR = 0, peakC = 0;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const v = Number(matrix[r][c]) || 0;
      if (v > maxV) { maxV = v; peakR = r; peakC = c; }
    }
  }

  // Layout: fixed row-label gutter + col-label gutter; cells scale to fit
  const rowLabelW = 38;
  const colLabelH = 20;
  const cellH = 26;
  const cellGap = 3;
  const cellW = 54;                             // baseline; will be stretched via viewBox
  const vbW = rowLabelW + cols * (cellW + cellGap);
  const vbH = colLabelH + rows * (cellH + cellGap) + 24;

  const root = svg('svg', {
    viewBox: `0 0 ${vbW} ${vbH}`,
    preserveAspectRatio: 'xMidYMid meet',
    xmlns: SVG_NS,
  });
  root.style.cssText = `display: block; width: 100%; max-height: 240px;`;

  // Column header labels
  for (let c = 0; c < cols; c++) {
    const cx = rowLabelW + c * (cellW + cellGap) + cellW / 2;
    const lbl = svg('text', {
      x: cx, y: colLabelH - 6,
      'text-anchor': 'middle',
      'font-family': T.font.mono,
      'font-size': 9,
      fill: T.textDim,
      'letter-spacing': 1,
    });
    lbl.textContent = colLabels[c] || '';
    root.appendChild(lbl);
  }

  // Row labels + cells
  for (let r = 0; r < rows; r++) {
    const cy = colLabelH + r * (cellH + cellGap) + cellH / 2;
    const rowLbl = svg('text', {
      x: rowLabelW - 8, y: cy + 3,
      'text-anchor': 'end',
      'font-family': T.font.mono,
      'font-size': 9,
      fill: T.textMuted,
      'letter-spacing': 1.5,
      'font-weight': 700,
    });
    rowLbl.textContent = (rowLabels[r] || '').toString().toUpperCase().slice(0, 3);
    root.appendChild(rowLbl);

    for (let c = 0; c < cols; c++) {
      const v = Number(matrix[r][c]) || 0;
      const intensity = maxV > 0 ? v / maxV : 0;
      const alpha = 0.05 + 0.95 * intensity;
      const x = rowLabelW + c * (cellW + cellGap);
      const y = colLabelH + r * (cellH + cellGap);
      root.appendChild(svg('rect', {
        x, y,
        width: cellW, height: cellH,
        fill: withAlpha(cellColor, alpha),
        rx: 2, ry: 2,
      }));
    }
  }

  // Peak outline + glow
  if (peakGlow && maxV > 0) {
    const x = rowLabelW + peakC * (cellW + cellGap);
    const y = colLabelH + peakR * (cellH + cellGap);
    // Outer glow rect
    root.appendChild(svg('rect', {
      x: x - 2, y: y - 2,
      width: cellW + 4, height: cellH + 4,
      fill: 'none',
      stroke: withAlpha(glowColor, 0.35),
      'stroke-width': 3,
      rx: 3, ry: 3,
    }));
    // Solid outline
    root.appendChild(svg('rect', {
      x, y,
      width: cellW, height: cellH,
      fill: 'none',
      stroke: glowColor,
      'stroke-width': 1.4,
      rx: 2, ry: 2,
    }));
  }

  // Peak callout below the grid
  const callout = svg('text', {
    x: rowLabelW, y: vbH - 6,
    'font-family': T.font.mono,
    'font-size': 10,
    fill: T.textMuted,
    'letter-spacing': 1.5,
    'font-weight': 700,
  });
  const peakRowName = (rowLabels[peakR] || '').toString().toUpperCase().slice(0, 3);
  const peakColName = (colLabels[peakC] || '').toString().toUpperCase();
  callout.textContent = `PEAK · ${peakRowName} ${peakColName} · ${formatValue(maxV)}`;
  root.appendChild(callout);

  body.appendChild(root);
  return card;
}

// ─── buildHistogram ─────────────────────────────────────────────────
// Vertical bar chart of discrete bucket counts. Each bucket is
// { label, count }. Opacity of each bar scales with its count so the
// distribution shape reads at a glance; the mode (max-count) bar is
// drawn at full opacity with a soft glow and a count label above it.
//
// Optional marker draws a vertical dashed line at a fractional bucket
// index (e.g. 2.5 = between bucket 2 and 3), with a small pill label
// at the top.
//
//   {
//     title, subtitle, accent,
//     buckets: [{ label, count }, ...],
//     barColor,       // default T.cyan
//     markerColor,    // default T.gold
//     marker,         // optional: { atFractionalIndex, label }
//     height,         // chart SVG height (default 180)
//   }
export function buildHistogram(opts) {
  const {
    title,
    subtitle,
    accent      = T.mint,
    buckets     = [],
    barColor    = T.cyan,
    markerColor = T.gold,
    marker,
    height      = 180,
  } = opts;

  const { card, header, body } = buildCardShell({ accent, minHeight: 260 });

  const left = document.createElement('div');
  left.style.cssText = 'display: flex; flex-direction: column; gap: 4px;';
  if (title) left.appendChild(buildEyebrow(title));
  if (subtitle) left.appendChild(buildMonoLabel(subtitle, {
    size: T.fs.xs, color: T.textDim, letterSpacing: 1.2,
  }));
  header.appendChild(left);

  const chartWrap = document.createElement('div');
  chartWrap.style.cssText = 'flex: 1; min-height: 0;';
  body.appendChild(chartWrap);

  if (!buckets.length) {
    const empty = document.createElement('div');
    empty.textContent = 'No data';
    empty.style.cssText = `
      display: flex; align-items: center; justify-content: center;
      height: ${height}px;
      font-family: ${T.font.mono}; font-size: ${T.fs.sm}px;
      color: ${T.textDim}; letter-spacing: 2px; text-transform: uppercase;
    `;
    chartWrap.appendChild(empty);
    return card;
  }

  const n = buckets.length;
  const maxCount = Math.max(1, ...buckets.map(b => Number(b.count) || 0));
  const modeIdx  = buckets.reduce((best, b, i) =>
    (Number(b.count) || 0) > (Number(buckets[best].count) || 0) ? i : best, 0);

  const padL = 28, padR = 14, padT = 20, padB = 24;
  const vbW = 460, vbH = height;
  const plotW = vbW - padL - padR;
  const plotH = vbH - padT - padB;
  const barW  = plotW / n;
  const innerBarW = Math.max(2, barW * 0.72);

  const root = svg('svg', {
    viewBox: `0 0 ${vbW} ${vbH}`,
    preserveAspectRatio: 'none',
    xmlns: SVG_NS,
  });
  root.style.cssText = `display: block; width: 100%; height: ${height}px;`;

  // Baseline
  root.appendChild(svg('line', {
    x1: padL, y1: padT + plotH, x2: padL + plotW, y2: padT + plotH,
    stroke: T.well, 'stroke-width': 1,
  }));

  // Bars
  for (let i = 0; i < n; i++) {
    const count = Number(buckets[i].count) || 0;
    const h = (count / maxCount) * plotH;
    const x = padL + i * barW + (barW - innerBarW) / 2;
    const y = padT + plotH - h;
    const isMode = i === modeIdx;
    const alpha = isMode ? 1.0 : Math.max(0.3, count / maxCount);

    if (isMode) {
      // Soft glow behind mode bar
      root.appendChild(svg('rect', {
        x: x - 2, y: y - 2,
        width: innerBarW + 4, height: h + 2,
        fill: withAlpha(barColor, 0.35),
      }));
    }
    root.appendChild(svg('rect', {
      x, y, width: innerBarW, height: h,
      fill: withAlpha(barColor, alpha),
    }));

    // Count label above mode bar
    if (isMode && count > 0) {
      const lbl = svg('text', {
        x: x + innerBarW / 2, y: y - 4,
        'text-anchor': 'middle',
        'font-family': T.font.mono,
        'font-size': 9,
        fill: barColor,
        'font-weight': 700,
        'letter-spacing': 1,
      });
      lbl.textContent = String(count);
      root.appendChild(lbl);
    }

    // Bucket label below
    const xlbl = svg('text', {
      x: x + innerBarW / 2,
      y: padT + plotH + 14,
      'text-anchor': 'middle',
      'font-family': T.font.mono,
      'font-size': 9,
      fill: T.textDim,
      'letter-spacing': 1,
    });
    xlbl.textContent = buckets[i].label || '';
    root.appendChild(xlbl);
  }

  // Optional marker (median / average line)
  if (marker && typeof marker.atFractionalIndex === 'number') {
    const f = Math.max(0, Math.min(n - 1, marker.atFractionalIndex));
    const mx = padL + (f + 0.5) * barW;
    root.appendChild(svg('line', {
      x1: mx, y1: padT - 6, x2: mx, y2: padT + plotH,
      stroke: markerColor,
      'stroke-width': 1.5,
      'stroke-dasharray': '4,3',
    }));
    if (marker.label) {
      // Pill label at top
      const pillPad = 4;
      const labelStr = marker.label;
      const approxWidth = labelStr.length * 5.4 + pillPad * 2;
      const pillX = Math.max(padL, Math.min(padL + plotW - approxWidth, mx - approxWidth / 2));
      root.appendChild(svg('rect', {
        x: pillX, y: 2,
        width: approxWidth, height: 14,
        rx: 3, ry: 3,
        fill: withAlpha(markerColor, 0.18),
        stroke: markerColor,
        'stroke-width': 1,
      }));
      const txt = svg('text', {
        x: pillX + approxWidth / 2, y: 12,
        'text-anchor': 'middle',
        'font-family': T.font.mono,
        'font-size': 9,
        fill: markerColor,
        'font-weight': 700,
        'letter-spacing': 1,
      });
      txt.textContent = labelStr;
      root.appendChild(txt);
    }
  }

  chartWrap.appendChild(root);
  return card;
}

// ─── buildMiniTable ─────────────────────────────────────────────────
// Compact columnar table. No sort/paging — just a static list.
// Each column defines a cell(row) function that returns
// { text, color?, weight? }, letting the caller control per-cell
// styling (tip% color-coding, amount color, etc.).
//
//   {
//     title, subtitle, accent,
//     columns: [
//       { label, align: 'left'|'right', width: '2fr', cell: (row) => {text, color?, weight?} },
//       ...
//     ],
//     rows: [row, ...],
//     footer,   // optional bottom-strip string
//   }
export function buildMiniTable(opts) {
  const {
    title,
    subtitle,
    accent   = T.mint,
    columns  = [],
    rows     = [],
    footer,
  } = opts;

  const { card, header, body } = buildCardShell({ accent, minHeight: 260 });

  const left = document.createElement('div');
  left.style.cssText = 'display: flex; flex-direction: column; gap: 4px;';
  if (title) left.appendChild(buildEyebrow(title));
  if (subtitle) left.appendChild(buildMonoLabel(subtitle, {
    size: T.fs.xs, color: T.textDim, letterSpacing: 1.2,
  }));
  header.appendChild(left);

  const gridCols = columns.map(c => c.width || '1fr').join(' ');
  const baseRowCss = `
    display: grid;
    grid-template-columns: ${gridCols};
    gap: 10px;
    align-items: baseline;
    padding: 8px 0;
  `;

  // Header row
  const headRow = document.createElement('div');
  headRow.style.cssText = `
    ${baseRowCss}
    border-bottom: 1px solid ${T.well};
    padding-top: 4px;
  `;
  for (const col of columns) {
    const cell = document.createElement('div');
    cell.textContent = col.label || '';
    cell.style.cssText = `
      font-family: ${T.font.mono};
      font-size: ${T.fs.xs}px;
      letter-spacing: 1.5px;
      color: ${T.textDim};
      font-weight: 700;
      text-transform: uppercase;
      text-align: ${col.align || 'left'};
    `;
    headRow.appendChild(cell);
  }
  body.appendChild(headRow);

  // Data rows
  if (!rows.length) {
    const empty = document.createElement('div');
    empty.textContent = 'No data';
    empty.style.cssText = `
      padding: 24px 0;
      text-align: center;
      font-family: ${T.font.mono};
      font-size: ${T.fs.sm}px;
      color: ${T.textDim};
      letter-spacing: 2px;
      text-transform: uppercase;
    `;
    body.appendChild(empty);
  } else {
    for (const row of rows) {
      const rowEl = document.createElement('div');
      rowEl.style.cssText = `
        ${baseRowCss}
        border-bottom: 1px solid ${withAlpha(T.text, 0.04)};
      `;
      for (const col of columns) {
        const cellData = col.cell ? col.cell(row) : { text: '' };
        const cell = document.createElement('div');
        cell.textContent = (cellData && cellData.text != null) ? cellData.text : '';
        cell.style.cssText = `
          font-family: ${T.font.mono};
          font-size: ${T.fs.base}px;
          text-align: ${col.align || 'left'};
          color: ${(cellData && cellData.color) || T.text};
          font-weight: ${(cellData && cellData.weight) != null ? cellData.weight : 400};
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        `;
        rowEl.appendChild(cell);
      }
      body.appendChild(rowEl);
    }
  }

  if (footer) {
    const footEl = document.createElement('div');
    footEl.textContent = footer;
    footEl.style.cssText = `
      margin-top: 12px;
      padding-top: 10px;
      border-top: 1px solid ${T.well};
      font-family: ${T.font.mono};
      font-size: ${T.fs.xs}px;
      color: ${T.textDim};
      letter-spacing: 1.5px;
      text-transform: uppercase;
    `;
    body.appendChild(footEl);
  }

  return card;
}
