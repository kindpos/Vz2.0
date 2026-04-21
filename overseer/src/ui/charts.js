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
