// ═══════════════════════════════════════════════════
//  KINDpos Terminal — Charts  (Vz2.0)
//  Chart + data visualization builders.
//  Nice. Dependable. Yours.
// ═══════════════════════════════════════════════════
//
//  Usage:
//    import {
//      buildStatCard, buildCashCardBar,
//      buildLineCard, buildCOBCard,
//      buildTipSparkBg,
//    } from '../charts.js';
//
//  Rules:
//   1. All colors come from T — never hardcode hex here.
//   2. All SVG paths use preserveAspectRatio="none" — responsive by default.
//   3. Square data points only — never circles.
//   4. Gold = money always. Lavender = last week / comparison always.
// ═══════════════════════════════════════════════════

import { T }                    from '../common/tokens.js';
import { hexToRgba, darkenHex } from './theme-manager.js';

// ── Internal: SVG namespace shorthand ────────────
const SVG_NS = 'http://www.w3.org/2000/svg';

function _svgEl(tag, attrs) {
  const el = document.createElementNS(SVG_NS, tag);
  if (attrs) Object.keys(attrs).forEach((k) => { el.setAttribute(k, attrs[k]); });
  return el;
}

// ── Internal: normalize data to 0-1 range ────────
export function _normalize(data) {
  const min = Math.min.apply(null, data);
  const max = Math.max.apply(null, data);
  const range = max - min || 1;
  return data.map((v) => (v - min) / range);
}

// ── Internal: build SVG path string from data ────
// Returns path 'd' attribute for a line across a viewBox
export function _linePath(data, vbW, vbH, padTop, padBot) {
  padTop = padTop || 4;
  padBot = padBot || 2;
  const norm = _normalize(data);
  const step = vbW / (norm.length - 1);
  return norm.map((v, i) => {
    const x = i * step;
    const y = padTop + (1 - v) * (vbH - padTop - padBot);
    return `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(' ');
}

// ── Internal: build area path (line + close to bottom) ─
export function _areaPath(data, vbW, vbH, padTop, padBot) {
  const line = _linePath(data, vbW, vbH, padTop, padBot);
  return `${line} L${vbW},${vbH} L0,${vbH}Z`;
}

// ═══════════════════════════════════════════════════
//  buildSparkline
//  Minimal inline sparkline — used inside stat cards.
//
//  opts:
//    data      — array of numbers (7+ points recommended)
//    color     — line + fill color (use T tokens)
//    height    — pixel height of container (default 30)
// ═══════════════════════════════════════════════════

export function buildSparkline(opts) {
  const o     = opts || {};
  const data  = o.data  || [0, 0, 0, 0, 0, 0, 0];
  const color = o.color || T.gold;
  const h     = o.height || 30;

  const wrap = document.createElement('div');
  wrap.style.cssText = `width:100%;height:${h}px;flex-shrink:0;`;

  const vbW = 200, vbH = h;
  const svg = _svgEl('svg', {
    viewBox:             `0 0 ${vbW} ${vbH}`,
    preserveAspectRatio: 'none',
    style:               'width:100%;height:100%;display:block;',
  });

  const gradId = `spark-grad-${Math.random().toString(36).slice(2, 7)}`;
  const defs   = _svgEl('defs');
  const grad   = _svgEl('linearGradient', { id: gradId, x1: '0', y1: '0', x2: '0', y2: '1' });
  const stop1  = _svgEl('stop', { offset: '0%',   'stop-color': color, 'stop-opacity': '0.25' });
  const stop2  = _svgEl('stop', { offset: '100%', 'stop-color': color, 'stop-opacity': '0'    });
  grad.appendChild(stop1);
  grad.appendChild(stop2);
  defs.appendChild(grad);
  svg.appendChild(defs);

  const linePath = _linePath(data, vbW, vbH, 4, 2);
  const areaPath = _areaPath(data, vbW, vbH, 4, 2);

  const area = _svgEl('path', { d: areaPath, fill: `url(#${gradId})`, stroke: 'none' });
  const line = _svgEl('path', { d: linePath, fill: 'none', stroke: color, 'stroke-width': '1.5', 'stroke-linecap': 'round' });

  svg.appendChild(area);
  svg.appendChild(line);
  wrap.appendChild(svg);
  return wrap;
}

// ═══════════════════════════════════════════════════
//  buildStatCard
//  Full stat card — header label + big number + delta + sparkline.
//  Supports normal, warning, and critical frame states.
//
//  opts:
//    title       — card label (uppercase monospace)
//    value       — display string ('$4,821', '142', etc.)
//    color       — big number color (use T.gold, T.elec, T.text, etc.)
//    delta       — string ('▲ 12%', '▼ 2%', '⚠ 3 pending', etc.)
//    deltaColor  — override (default: T.positive for ▲, T.verm for ▼)
//    sparkData   — array of numbers for sparkline
//    sparkColor  — sparkline color (defaults to color)
//    state       — 'normal' | 'warning' | 'critical'
//
//  Returns { wrap, setValue, setDelta, setState }
// ═══════════════════════════════════════════════════

export function buildStatCard(opts) {
  const o          = opts || {};
  const color      = o.color      || T.gold;
  const sparkColor = o.sparkColor || color;
  const state      = o.state      || 'normal';

  const wrap = document.createElement('div');
  wrap.style.cssText = [
    'display:flex;flex-direction:column;',
    `background:${T.card};`,
    'border-radius:10px;',
    'overflow:hidden;',
    'border:1px solid rgba(255,255,255,0.04);',
    'flex:1;',
  ].join('');

  // Header
  const hdr = document.createElement('div');
  hdr.style.cssText = [
    'display:flex;align-items:center;justify-content:space-between;',
    'padding:8px 12px;flex-shrink:0;',
    'border-bottom:1px solid rgba(255,255,255,0.05);',
  ].join('');

  const titleEl = document.createElement('span');
  titleEl.textContent   = (o.title || '').toUpperCase();
  titleEl.style.cssText = `font-family:${T.fb};font-size:9px;letter-spacing:2px;color:${T.border};;font-weight:${T.fwBold};`;

  const dot = document.createElement('div');
  dot.style.cssText = `width:7px;height:7px;border-radius:50%;background:${color};box-shadow:0 0 5px ${hexToRgba(color, 0.5)};`;

  hdr.appendChild(titleEl);
  hdr.appendChild(dot);
  wrap.appendChild(hdr);

  // Body
  const body = document.createElement('div');
  body.style.cssText = 'padding:8px 12px 4px;flex-shrink:0;';

  const valueEl = document.createElement('div');
  valueEl.textContent   = o.value || '—';
  valueEl.style.cssText = `font-family:${T.fh};font-size:24px;font-weight:700;line-height:1;color:${color};margin-bottom:3px;`;

  const deltaEl = document.createElement('div');
  deltaEl.textContent   = o.delta || '';
  deltaEl.style.cssText = `font-family:${T.fb};font-size:9px;color:${o.deltaColor || T.positive};margin-bottom:4px;;font-weight:${T.fwBold};`;

  body.appendChild(valueEl);
  body.appendChild(deltaEl);
  wrap.appendChild(body);

  // Sparkline
  const spark = buildSparkline({ data: o.sparkData || [0,0,0,0,0,0,0], color: sparkColor, height: 30 });
  spark.style.marginTop = 'auto';
  wrap.appendChild(spark);

  // State styling
  function _applyState(s) {
    if (s === 'warning') {
      wrap.style.border    = `1px solid ${T.warning}`;
      wrap.style.boxShadow = `0 0 0 1px ${hexToRgba(T.warning, 0.2)}`;
    } else if (s === 'critical') {
      wrap.style.border    = `1px solid ${T.verm}`;
      wrap.style.boxShadow = `0 0 0 1px ${hexToRgba(T.verm, 0.2)}`;
    } else {
      wrap.style.border    = '1px solid rgba(255,255,255,0.04)';
      wrap.style.boxShadow = 'none';
    }
  }
  _applyState(state);

  return {
    wrap,
    setValue: (v) => { valueEl.textContent = v; },
    setColor: (c) => {
      valueEl.style.color    = c;
      dot.style.background   = c;
      dot.style.boxShadow    = `0 0 5px ${hexToRgba(c, 0.5)}`;
    },
    setDelta: (d, c) => {
      deltaEl.textContent  = d;
      if (c) deltaEl.style.color = c;
    },
    setState: (s) => { _applyState(s); },
  };
}

// ═══════════════════════════════════════════════════
//  buildCashCardBar
//  Stacked horizontal bar showing cash vs card split.
//
//  opts:
//    cash   — cash total (number)
//    card   — card total (number)
//
//  Returns { wrap, update(cash, card) }
// ═══════════════════════════════════════════════════

export function buildCashCardBar(opts) {
  const o = opts || {};

  const wrap = document.createElement('div');
  wrap.style.cssText = 'flex-shrink:0;display:flex;flex-direction:column;gap:5px;';

  const labelRow = document.createElement('div');
  labelRow.style.cssText = 'display:flex;justify-content:space-between;align-items:baseline;';

  const lbl = document.createElement('span');
  lbl.textContent   = 'CASH / CARD';
  lbl.style.cssText = `font-family:${T.fb};font-size:9px;color:${T.border};letter-spacing:1px;;font-weight:${T.fwBold};`;

  const amounts = document.createElement('div');
  amounts.style.cssText = 'display:flex;gap:10px;';

  const cashAmt = document.createElement('span');
  cashAmt.style.cssText = `font-family:${T.fb};font-size:9px;color:${T.green};;font-weight:${T.fwBold};`;

  const cardAmt = document.createElement('span');
  cardAmt.style.cssText = `font-family:${T.fb};font-size:9px;color:${T.elec};;font-weight:${T.fwBold};`;

  amounts.appendChild(cashAmt);
  amounts.appendChild(cardAmt);
  labelRow.appendChild(lbl);
  labelRow.appendChild(amounts);
  wrap.appendChild(labelRow);

  // Bar track
  const track = document.createElement('div');
  track.style.cssText = 'display:flex;height:10px;border-radius:3px;overflow:hidden;gap:2px;';

  const cashFill = document.createElement('div');
  cashFill.style.cssText = `background:${T.green};border-radius:2px;box-shadow:0 0 8px ${hexToRgba(T.green, 0.35)};transition:width 0.4s ease;`;

  const cardFill = document.createElement('div');
  cardFill.style.cssText = `flex:1;background:${T.elec};border-radius:2px;box-shadow:0 0 8px ${hexToRgba(T.elec, 0.35)};`;

  track.appendChild(cashFill);
  track.appendChild(cardFill);
  wrap.appendChild(track);

  // Pct row
  const pctRow = document.createElement('div');
  pctRow.style.cssText = 'display:flex;justify-content:space-between;';

  const cashPct = document.createElement('span');
  cashPct.style.cssText = `font-family:${T.fb};font-size:8px;color:${T.green};opacity:0.7;;font-weight:${T.fwBold};`;

  const cardPct = document.createElement('span');
  cardPct.style.cssText = `font-family:${T.fb};font-size:8px;color:${T.elec};opacity:0.7;;font-weight:${T.fwBold};`;

  pctRow.appendChild(cashPct);
  pctRow.appendChild(cardPct);
  wrap.appendChild(pctRow);

  function fmt(n) {
    return `$${(n || 0).toFixed(0).replace(/\B(?=(\d{3})+(?!\d))/g, ',')}`;
  }

  function update(cash, card) {
    const total = (cash || 0) + (card || 0) || 1;
    const cp    = Math.round((cash / total) * 100);
    cashFill.style.width  = `${cp}%`;
    cashAmt.textContent   = `${fmt(cash)} cash`;
    cardAmt.textContent   = `${fmt(card)} card`;
    cashPct.textContent   = `${cp}%`;
    cardPct.textContent   = `${100 - cp}%`;
  }

  update(o.cash || 0, o.card || 0);

  return { wrap, update };
}

// ═══════════════════════════════════════════════════
//  buildSalesOverview
//  Full sales overview card content:
//  Net Sales stat card + Cash/Card breakdown bar.
//  Designed for the 250px bottom-left card in both landings.
//
//  opts:
//    netSales   — number
//    cash       — number
//    card       — number
//    netDelta   — string e.g. '▲ 12%'
//    sparkData  — array of numbers (7 points, daily net sales)
//
//  Returns { wrap, update(netSales, cash, card, netDelta, sparkData) }
//  Caller appends wrap to card.card.
// ═══════════════════════════════════════════════════

export function buildSalesOverview(opts) {
  const o = opts || {};

  const wrap = document.createElement('div');
  wrap.style.cssText = 'display:flex;flex-direction:column;gap:10px;flex:1;min-height:0;';

  // Net Sales stat card
  const netCard = buildStatCard({
    title:     'Net Sales',
    value:     '$0.00',
    color:     T.gold,
    delta:     '',
    sparkData: o.sparkData || [0,0,0,0,0,0,0],
  });
  netCard.wrap.style.flexShrink = '0';
  wrap.appendChild(netCard.wrap);

  // Cash / Card bar
  const bar = buildCashCardBar({ cash: o.cash || 0, card: o.card || 0 });
  wrap.appendChild(bar.wrap);

  function fmt(n) {
    const abs = Math.abs(n || 0).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    return (n < 0 ? '−$' : '$') + abs;
  }

  function update(netSales, cash, card, netDelta, sparkData) {
    netCard.setValue(fmt(netSales || 0));
    netCard.setDelta(netDelta || '', netDelta && netDelta[0] === '▼' ? T.verm : T.positive);
    bar.update(cash || 0, card || 0);
    // Re-render sparkline if new data provided
    if (sparkData && sparkData.length) {
      const oldSpark = netCard.wrap.lastElementChild;
      if (oldSpark) {
        const newSpark = buildSparkline({ data: sparkData, color: T.gold, height: 30 });
        newSpark.style.marginTop = 'auto';
        netCard.wrap.replaceChild(newSpark, oldSpark);
      }
    }
  }

  update(o.netSales, o.cash, o.card, o.netDelta, o.sparkData);

  return { wrap, update };
}

// ═══════════════════════════════════════════════════
//  buildLineCard
//  Expandable revenue trend card.
//  Collapsed: full-bleed background sparkline + big number.
//  Expanded: full chart with grid, axes, day labels, range tabs.
//
//  opts:
//    label      — card label ('7-Day Revenue')
//    value      — display string ('$4,821')
//    delta      — string ('▲ 12.4% vs last week')
//    thisWeek   — array of 7 numbers (Mon–Sun, today last)
//    lastWeek   — array of 7 numbers
//    days       — array of 7 labels (['Mon','Tue',...])
//
//  Returns { wrap, update(value, delta, thisWeek, lastWeek) }
// ═══════════════════════════════════════════════════

export function buildLineCard(opts) {
  const o = opts || {};
  const days = o.days || ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];

  const wrap = document.createElement('div');
  wrap.style.cssText = [
    'position:relative;width:100%;height:100%;',
    `background:${T.card};`,
    `border-left:4px solid ${T.border};`,
    'border-radius:10px;',
    'overflow:hidden;',
    'cursor:pointer;',
    'transition:border-color 0.2s;',
    'user-select:none;',
  ].join('');

  // ── Background sparkline (collapsed state) ──
  const bgWrap = document.createElement('div');
  bgWrap.style.cssText = 'position:absolute;inset:0;pointer-events:none;overflow:hidden;border-radius:10px;';

  const bgSvg = document.createElementNS(SVG_NS, 'svg');
  bgSvg.style.cssText        = 'width:100%;height:100%;';
  bgSvg.setAttribute('preserveAspectRatio', 'none');
  bgWrap.appendChild(bgSvg);
  wrap.appendChild(bgWrap);

  // ── Collapsed overlay ──
  const collapsed = document.createElement('div');
  collapsed.style.cssText = [
    'position:relative;z-index:1;',
    'padding:18px 20px;',
    'display:flex;align-items:flex-end;justify-content:space-between;',
    'height:100%;box-sizing:border-box;',
    'transition:opacity 0.25s ease;',
  ].join('');

  const colLeft = document.createElement('div');
  const colLabel = document.createElement('div');
  colLabel.style.cssText = `font-family:${T.fb};font-size:9px;letter-spacing:2px;text-transform:uppercase;color:rgba(255,255,255,0.4);margin-bottom:4px;;font-weight:${T.fwBold};`;
  colLabel.textContent   = o.label || '7-Day Revenue';

  const colValue = document.createElement('div');
  colValue.style.cssText = `font-family:${T.fh};font-size:30px;font-weight:800;color:${T.gold};line-height:1;`;

  const colDelta = document.createElement('div');
  colDelta.style.cssText = `font-family:${T.fb};font-size:10px;color:${T.positive};margin-top:3px;;font-weight:${T.fwBold};`;

  colLeft.appendChild(colLabel);
  colLeft.appendChild(colValue);
  colLeft.appendChild(colDelta);

  const colRight = document.createElement('div');
  colRight.style.textAlign = 'right';
  const colHint = document.createElement('div');
  colHint.textContent   = 'tap to expand ↕';
  colHint.style.cssText = `font-family:${T.fb};font-size:9px;color:rgba(255,255,255,0.18);;font-weight:${T.fwBold};`;
  colRight.appendChild(colHint);

  collapsed.appendChild(colLeft);
  collapsed.appendChild(colRight);
  wrap.appendChild(collapsed);

  // ── Expanded content ──
  const expanded = document.createElement('div');
  expanded.style.cssText = [
    'position:absolute;inset:0;z-index:2;',
    `background:${T.card};`,
    'border-radius:10px;',
    'display:flex;flex-direction:column;',
    'opacity:0;pointer-events:none;',
    'transition:opacity 0.25s ease;',
  ].join('');

  // Expanded header
  const expHdr = document.createElement('div');
  expHdr.style.cssText = 'display:flex;align-items:flex-start;justify-content:space-between;padding:16px 18px 12px;flex-shrink:0;';

  const expLeft = document.createElement('div');
  const expTitle = document.createElement('div');
  expTitle.textContent   = o.label || '7-Day Revenue';
  expTitle.style.cssText = `font-family:${T.fb};font-size:9px;letter-spacing:2px;text-transform:uppercase;color:${T.border};margin-bottom:5px;;font-weight:${T.fwBold};`;

  const expValue = document.createElement('div');
  expValue.style.cssText = `font-family:${T.fh};font-size:32px;font-weight:800;color:${T.gold};line-height:1;`;

  const expDelta = document.createElement('div');
  expDelta.style.cssText = `font-family:${T.fb};font-size:10px;color:${T.positive};margin-top:4px;;font-weight:${T.fwBold};`;

  expLeft.appendChild(expTitle);
  expLeft.appendChild(expValue);
  expLeft.appendChild(expDelta);

  const closeBtn = document.createElement('button');
  closeBtn.textContent   = 'CLOSE ↑';
  closeBtn.style.cssText = `${[
    `font-family:${T.fb};font-size:9px;letter-spacing:1px;`,
    `color:${T.border};background:rgba(255,255,255,0.07);`,
    'border:1px solid rgba(255,255,255,0.1);border-radius:4px;',
    'padding:5px 10px;cursor:pointer;',
  ].join('')};font-weight:${T.fwBold};`;

  expHdr.appendChild(expLeft);
  expHdr.appendChild(closeBtn);
  expanded.appendChild(expHdr);

  // Chart well
  const chartWell = document.createElement('div');
  chartWell.style.cssText = [
    'flex:1;margin:0 16px 12px;min-height:0;',
    `background:${T.well};`,
    'border-radius:6px;',
    'padding:10px 10px 20px;',
    'position:relative;overflow:hidden;',
  ].join('');
  expanded.appendChild(chartWell);

  const expSvg = document.createElementNS(SVG_NS, 'svg');
  expSvg.style.cssText        = 'width:100%;height:100%;overflow:visible;';
  expSvg.setAttribute('preserveAspectRatio', 'none');
  chartWell.appendChild(expSvg);

  // Footer: legend + range tabs
  const footer = document.createElement('div');
  footer.style.cssText = 'display:flex;align-items:center;justify-content:space-between;padding:0 16px 14px;flex-shrink:0;';

  const legend = document.createElement('div');
  legend.style.cssText = 'display:flex;gap:14px;';

  function _legendItem(label, color, dashed) {
    const item = document.createElement('div');
    item.style.cssText = 'display:flex;align-items:center;gap:5px;';
    const dot = document.createElement('div');
    dot.style.cssText = `width:8px;height:8px;border-radius:2px;background:${color};${dashed ? 'opacity:0.5;' : `box-shadow:0 0 5px ${hexToRgba(color, 0.4)};`}`;
    const lbl = document.createElement('span');
    lbl.textContent   = label;
    lbl.style.cssText = `font-family:${T.fb};font-size:9px;color:${T.border};;font-weight:${T.fwBold};`;
    item.appendChild(dot);
    item.appendChild(lbl);
    return item;
  }
  legend.appendChild(_legendItem('This Week', T.gold, false));
  legend.appendChild(_legendItem('Last Week', T.lavender, true));
  footer.appendChild(legend);

  const rangeTabs = document.createElement('div');
  rangeTabs.style.cssText = 'display:flex;gap:4px;';
  ['7D','30D','90D'].forEach((r, i) => {
    const tab = document.createElement('button');
    tab.textContent   = r;
    tab.style.cssText = `${[
      `font-family:${T.fb};font-size:9px;letter-spacing:1px;`,
      'padding:4px 9px;border-radius:4px;border:none;cursor:pointer;',
      `background:${i === 0 ? hexToRgba(T.green, 0.15) : 'rgba(255,255,255,0.06)'};`,
      `color:${i === 0 ? T.green : T.border};`,
      'transition:background 0.15s,color 0.15s;',
    ].join('')};font-weight:${T.fwBold};`;
    tab.addEventListener('pointerup', (e) => {
      e.stopPropagation();
      rangeTabs.querySelectorAll('button').forEach((t) => {
        t.style.background = 'rgba(255,255,255,0.06)';
        t.style.color      = T.border;
      });
      tab.style.background = hexToRgba(T.green, 0.15);
      tab.style.color      = T.green;
    });
    rangeTabs.appendChild(tab);
  });
  footer.appendChild(rangeTabs);
  expanded.appendChild(footer);
  wrap.appendChild(expanded);

  // ── Expand / collapse ──
  let _open = false;

  wrap.addEventListener('pointerup', () => {
    if (_open) return;
    _open = true;
    collapsed.style.opacity      = '0';
    collapsed.style.pointerEvents = 'none';
    expanded.style.opacity       = '1';
    expanded.style.pointerEvents = 'auto';
    wrap.style.cursor            = 'default';
  });

  closeBtn.addEventListener('pointerup', (e) => {
    e.stopPropagation();
    _open = false;
    collapsed.style.opacity       = '1';
    collapsed.style.pointerEvents = 'auto';
    expanded.style.opacity        = '0';
    expanded.style.pointerEvents  = 'none';
    wrap.style.cursor             = 'pointer';
  });

  // ── Render chart data ──
  function _renderBgSvg(thisWeek, lastWeek) {
    while (bgSvg.firstChild) bgSvg.removeChild(bgSvg.firstChild);
    const vbW = 480, vbH = 96;
    bgSvg.setAttribute('viewBox', `0 0 ${vbW} ${vbH}`);

    const gradId = `lc-bg-${Math.random().toString(36).slice(2, 6)}`;
    const defs   = _svgEl('defs');
    const grad   = _svgEl('linearGradient', { id: gradId, x1: '0', y1: '0', x2: '0', y2: '1' });
    grad.appendChild(_svgEl('stop', { offset: '0%',   'stop-color': T.gold, 'stop-opacity': '0.1' }));
    grad.appendChild(_svgEl('stop', { offset: '100%', 'stop-color': T.gold, 'stop-opacity': '0'   }));
    defs.appendChild(grad);
    bgSvg.appendChild(defs);

    // all data points pooled for shared scale
    const all = (thisWeek || []).concat(lastWeek || []);
    const min = Math.min.apply(null, all);
    const max = Math.max.apply(null, all);
    const range = max - min || 1;
    const pad = 8;

    function _pts(data) {
      return (data || []).map((v, i) => {
        const x = (i / (data.length - 1)) * vbW;
        const y = pad + (1 - (v - min) / range) * (vbH - pad * 2);
        return `${x.toFixed(1)},${y.toFixed(1)}`;
      });
    }

    const twPts = _pts(thisWeek || []);
    const lwPts = _pts(lastWeek || []);

    if (lwPts.length > 1) {
      bgSvg.appendChild(_svgEl('path', {
        d:            `M${lwPts.join(' L')}`,
        fill:         'none',
        stroke:       T.lavender,
        'stroke-width': '1',
        opacity:      '0.3',
        'stroke-dasharray': '5 4',
      }));
    }

    if (twPts.length > 1) {
      const twPath = `M${twPts.join(' L')}`;
      bgSvg.appendChild(_svgEl('path', {
        d: `${twPath} L${vbW},${vbH} L0,${vbH}Z`,
        fill: `url(#${gradId})`, stroke: 'none',
      }));
      bgSvg.appendChild(_svgEl('path', {
        d: twPath, fill: 'none', stroke: T.gold,
        'stroke-width': '1.5', opacity: '0.7',
      }));
    }
  }

  function _renderExpSvg(thisWeek, lastWeek) {
    while (expSvg.firstChild) expSvg.removeChild(expSvg.firstChild);
    const vbW = 440, vbH = 140;
    expSvg.setAttribute('viewBox', `0 0 ${vbW} ${vbH}`);

    const all = (thisWeek || []).concat(lastWeek || []);
    const min = Math.min.apply(null, all);
    const max = Math.max.apply(null, all);
    const range = max - min || 1;
    const leftPad = 32, rightPad = 8, topPad = 12, botPad = 20;
    const chartW = vbW - leftPad - rightPad;
    const chartH = vbH - topPad - botPad;

    const gradId = `lc-exp-${Math.random().toString(36).slice(2, 6)}`;
    const defs   = _svgEl('defs');
    const grad   = _svgEl('linearGradient', { id: gradId, x1: '0', y1: '0', x2: '0', y2: '1' });
    grad.appendChild(_svgEl('stop', { offset: '0%',   'stop-color': T.gold, 'stop-opacity': '0.2' }));
    grad.appendChild(_svgEl('stop', { offset: '100%', 'stop-color': T.gold, 'stop-opacity': '0'   }));
    defs.appendChild(grad);
    expSvg.appendChild(defs);

    // Grid lines + y labels
    [0.75, 0.5, 0.25].forEach((frac) => {
      const y = topPad + (1 - frac) * chartH;
      expSvg.appendChild(_svgEl('line', { x1: leftPad, y1: y, x2: vbW - rightPad, y2: y, stroke: T.gridLine, 'stroke-width': '1' }));
      const val = min + frac * range;
      const lbl = _svgEl('text', { x: leftPad - 4, y: y + 3, 'font-family': 'JetBrains Mono', 'font-size': '8', fill: T.axisText, 'text-anchor': 'end' });
      lbl.textContent = `$${val >= 1000 ? `${(val / 1000).toFixed(1)}k` : Math.round(val)}`;
      expSvg.appendChild(lbl);
    });

    function _pts(data) {
      return (data || []).map((v, i) => {
        const x = leftPad + (i / (data.length - 1)) * chartW;
        const y = topPad + (1 - (v - min) / range) * chartH;
        return { x, y };
      });
    }

    const twPts = _pts(thisWeek || []);
    const lwPts = _pts(lastWeek || []);

    // Day labels
    days.forEach((d, i) => {
      if (!twPts[i]) return;
      const lbl = _svgEl('text', { x: twPts[i].x, y: vbH - 4, 'font-family': 'JetBrains Mono', 'font-size': '9', fill: T.axisText, 'text-anchor': 'middle' });
      lbl.textContent = d;
      expSvg.appendChild(lbl);
    });

    function _ptStr(pts) {
      return pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
    }

    // Last week dashed
    if (lwPts.length > 1) {
      expSvg.appendChild(_svgEl('path', {
        d: _ptStr(lwPts), fill: 'none', stroke: T.lavender,
        'stroke-width': '1.5', 'stroke-dasharray': '5 4',
      }));
    }

    // This week area + line
    if (twPts.length > 1) {
      const twStr = _ptStr(twPts);
      const last  = twPts[twPts.length - 1];
      const first = twPts[0];
      expSvg.appendChild(_svgEl('path', {
        d: `${twStr} L${last.x.toFixed(1)},${topPad + chartH} L${first.x.toFixed(1)},${topPad + chartH}Z`,
        fill: `url(#${gradId})`, stroke: 'none',
      }));
      expSvg.appendChild(_svgEl('path', {
        d: twStr, fill: 'none', stroke: T.gold, 'stroke-width': '2',
      }));
      // Square data points
      twPts.slice(1).forEach((p) => {
        expSvg.appendChild(_svgEl('rect', { x: p.x - 3, y: p.y - 3, width: '6', height: '6', fill: T.gold }));
      });
    }
  }

  function update(value, delta, thisWeek, lastWeek) {
    colValue.textContent = value || '$0.00';
    colDelta.textContent = delta || '';
    expValue.textContent = value || '$0.00';
    expDelta.textContent = delta || '';

    const tw = thisWeek || [0,0,0,0,0,0,0];
    const lw = lastWeek || [0,0,0,0,0,0,0];
    _renderBgSvg(tw, lw);
    _renderExpSvg(tw, lw);
  }

  update(o.value, o.delta, o.thisWeek, o.lastWeek);

  return { wrap, update };
}

// ═══════════════════════════════════════════════════
//  buildCOBCard
//  COB % bar with threshold markers + per-server hour bars.
//  Replaces the simple cobBarFill in manager-landing.
//
//  opts:
//    (none — all values set via update())
//
//  Returns {
//    wrap,
//    update(cobPct, floorCount, hours, laborCost, servers)
//    // servers: [{ name, hours, color }]
//  }
// ═══════════════════════════════════════════════════

export function buildCOBCard(opts) {
  const wrap = document.createElement('div');
  wrap.style.cssText = 'display:flex;flex-direction:column;gap:10px;flex:1;min-height:0;';

  // Stats row
  const statsRow = document.createElement('div');
  statsRow.style.cssText = 'display:flex;justify-content:space-around;flex-shrink:0;';

  function _stat(val, label, color) {
    const el = document.createElement('div');
    const v  = document.createElement('div');
    v.style.cssText = `font-family:${T.fh};font-size:20px;font-weight:700;color:${color};`;
    v.textContent   = val;
    const l  = document.createElement('div');
    l.style.cssText = `font-family:${T.fb};font-size:10px;color:${T.text};opacity:0.6;letter-spacing:1px;text-transform:uppercase;margin-top:1px;;font-weight:${T.fwBold};`;
    l.textContent   = label;
    el.appendChild(v); el.appendChild(l);
    return { wrap: el, v };
  }

  const sCob   = _stat('0%',   'COB',     T.gold);
  const sFloor = _stat('0',    'Floor',   T.text);
  const sHours = _stat('0.0h', 'Hours',   T.elec);
  const sLabor = _stat('$0',   'Labor $', T.text);
  [sCob, sFloor, sHours, sLabor].forEach((s) => { statsRow.appendChild(s.wrap); });
  wrap.appendChild(statsRow);

  // COB main bar
  const cobSection = document.createElement('div');
  cobSection.style.cssText = 'flex-shrink:0;';

  const cobLabelRow = document.createElement('div');
  cobLabelRow.style.cssText = 'display:flex;justify-content:flex-end;gap:8px;margin-bottom:4px;';

  const warnLbl = document.createElement('span');
  warnLbl.textContent   = '▲28% warn';
  warnLbl.style.cssText = `font-family:${T.fb};font-size:8px;color:${T.warning};letter-spacing:1px;;font-weight:${T.fwBold};`;

  const critLbl = document.createElement('span');
  critLbl.textContent   = '▲35% crit';
  critLbl.style.cssText = `font-family:${T.fb};font-size:8px;color:${T.verm};letter-spacing:1px;;font-weight:${T.fwBold};`;

  cobLabelRow.appendChild(warnLbl);
  cobLabelRow.appendChild(critLbl);
  cobSection.appendChild(cobLabelRow);

  const cobTrack = document.createElement('div');
  cobTrack.style.cssText = 'height:8px;background:rgba(255,255,255,0.06);border-radius:2px;overflow:hidden;position:relative;';

  const cobFill = document.createElement('div');
  cobFill.style.cssText = 'height:100%;border-radius:2px;transition:width 0.4s ease,background 0.4s ease;';
  cobTrack.appendChild(cobFill);

  // Threshold marker lines (positioned over the track)
  const trackWrap = document.createElement('div');
  trackWrap.style.cssText = 'position:relative;';
  trackWrap.appendChild(cobTrack);

  [{ pct: 28, color: T.warning }, { pct: 35, color: T.verm }].forEach((t) => {
    const line = document.createElement('div');
    line.style.cssText = `position:absolute;top:-2px;bottom:-2px;width:1px;left:${t.pct}%;background:${hexToRgba(t.color, 0.5)};pointer-events:none;`;
    trackWrap.appendChild(line);
  });

  cobSection.appendChild(trackWrap);
  wrap.appendChild(cobSection);

  // Divider
  const div = document.createElement('div');
  div.style.cssText = 'height:1px;background:rgba(255,255,255,0.06);flex-shrink:0;';
  wrap.appendChild(div);

  // Server bars
  const serverBars = document.createElement('div');
  serverBars.style.cssText = 'display:flex;flex-direction:column;gap:6px;flex:1;justify-content:center;';
  wrap.appendChild(serverBars);

  function update(cobPct, floorCount, hours, laborCost, servers) {
    const pct = cobPct || 0;
    const barColor = pct >= (T.cobCrit * 100) ? T.verm : pct >= (T.cobWarn * 100) ? T.warning : T.green;

    sCob.v.textContent   = `${Math.round(pct)}%`;
    sCob.v.style.color   = barColor;
    sFloor.v.textContent = `${floorCount || 0}`;
    sHours.v.textContent = `${(hours || 0).toFixed(1)}h`;
    sLabor.v.textContent = `$${Math.round(laborCost || 0)}`;

    cobFill.style.width      = `${Math.min(pct, 100)}%`;
    cobFill.style.background = barColor;
    cobFill.style.boxShadow  = `0 0 6px ${hexToRgba(barColor, 0.4)}`;

    // Rebuild server bars
    serverBars.innerHTML = '';
    const maxH = Math.max.apply(null, (servers || []).map((s) => s.hours || 0)) || 1;
    (servers || []).forEach((srv) => {
      const row = document.createElement('div');
      row.style.cssText = 'display:flex;align-items:center;gap:8px;';

      const name = document.createElement('span');
      name.textContent   = (srv.name || '').split(' ')[0].toUpperCase();
      name.style.cssText = `font-family:${T.fb};font-size:9px;color:${T.border};width:52px;text-align:right;flex-shrink:0;;font-weight:${T.fwBold};`;

      const track = document.createElement('div');
      track.style.cssText = 'flex:1;height:8px;background:rgba(255,255,255,0.06);border-radius:2px;overflow:hidden;';

      const fill = document.createElement('div');
      fill.style.cssText = `height:100%;border-radius:2px;background:${srv.color || T.green};opacity:0.75;`;
      fill.style.width   = `${Math.round((srv.hours / maxH) * 100)}%`;
      track.appendChild(fill);

      const hrs = document.createElement('span');
      hrs.textContent   = `${(srv.hours || 0).toFixed(1)}h`;
      hrs.style.cssText = `font-family:${T.fb};font-size:9px;color:${T.border};width:28px;;font-weight:${T.fwBold};`;

      row.appendChild(name);
      row.appendChild(track);
      row.appendChild(hrs);
      serverBars.appendChild(row);
    });
  }

  update(0, 0, 0, 0, []);

  return { wrap, update };
}

// ═══════════════════════════════════════════════════
//  buildTipSparkBg
//  Subtle gold accumulation sparkline behind Tip Queue.
//  Appended as background to the tip card wrap element.
//
//  opts:
//    data — array of cumulative tip totals across the shift
//
//  Returns { el, update(data) }
// ═══════════════════════════════════════════════════

export function buildTipSparkBg(opts) {
  const o = opts || {};

  const el = document.createElement('div');
  el.style.cssText = 'position:absolute;inset:0;pointer-events:none;overflow:hidden;border-radius:10px;';

  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.style.cssText = 'position:absolute;bottom:0;left:0;width:100%;height:100%;';
  svg.setAttribute('preserveAspectRatio', 'none');
  el.appendChild(svg);

  function update(data) {
    while (svg.firstChild) svg.removeChild(svg.firstChild);
    if (!data || data.length < 2) return;

    const vbW = 300, vbH = 400;
    svg.setAttribute('viewBox', `0 0 ${vbW} ${vbH}`);

    const gradId = `tip-spark-${Math.random().toString(36).slice(2, 6)}`;
    const defs   = _svgEl('defs');
    const grad   = _svgEl('linearGradient', { id: gradId, x1: '0', y1: '0', x2: '0', y2: '1' });
    grad.appendChild(_svgEl('stop', { offset: '0%',   'stop-color': T.gold, 'stop-opacity': '0.06' }));
    grad.appendChild(_svgEl('stop', { offset: '100%', 'stop-color': T.gold, 'stop-opacity': '0'    }));
    defs.appendChild(grad);
    svg.appendChild(defs);

    const norm = _normalize(data);
    const pts  = norm.map((v, i) => ({ x: (i / (norm.length - 1)) * vbW, y: 10 + (1 - v) * (vbH - 10) }));
    const pathStr = pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');

    svg.appendChild(_svgEl('path', { d: `${pathStr} L${vbW},${vbH} L0,${vbH}Z`, fill: `url(#${gradId})`, stroke: 'none' }));
    svg.appendChild(_svgEl('path', { d: pathStr, fill: 'none', stroke: T.gold, 'stroke-width': '1', opacity: '0.2' }));
  }

  update(o.data || []);

  return { el, update };
}
