// ═══════════════════════════════════════════════════
//  KINDpos Terminal — Server Landing  (Vz2.0)
//  Nice. Dependable. Yours.
// ═══════════════════════════════════════════════════

import { defineScene, SceneManager } from '../scene-manager.js';
import { T }                          from '../../common/tokens.js';
import {
  buildStaticCard,
  buildNavCard,
  buildActionCard,
  buildPillButton,
  buildSectionLabel,
  hexToRgba,
  darkenHex,
} from '../theme-manager.js';
import {
  buildSalesOverview,
  buildStatCard,
  buildTipSparkBg,
} from '../charts.js';
import { buildNumpad } from '../numpad.js';
import { fetchWithTimeout } from '../net.js';
import { showToast } from '../components.js';

// ── Input guard + double-tap window ──────────────
const DOUBLE_TAP_MS = 300;    // second tap must land within this window to open

// ── Filter cycle ──────────────────────────────────
const FILTER_CYCLE   = { OPEN: 'CLOSED', CLOSED: 'VOID', VOID: 'OPEN' };
const FILTER_DISPLAY = { OPEN: 'ACTIVE', CLOSED: 'CLOSED', VOID: 'VOID' };
const FILTER_COLORS = {
  OPEN:   { color: T.green, dark: T.greenDk },
  CLOSED: { color: T.gold,  dark: T.goldDk  },
  VOID:   { color: T.verm,  dark: T.vermDk  },
};

// ── Helpers ───────────────────────────────────────
function fmt(n) {
  n = n || 0;
  const abs = Math.abs(n).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return (n < 0 ? '\u2212$' : '$') + abs;
}

function checkNum(order) {
  return order.check_number || (`C-${String(order.order_id).slice(0, 3).toUpperCase()}`);
}

function ordersByFilter(allOrders, filter) {
  return (allOrders || []).filter((o) => {
    if (filter === 'OPEN')   return o.status === 'open';
    if (filter === 'CLOSED') return o.status === 'closed' || o.status === 'paid';
    if (filter === 'VOID')   return o.status === 'voided';
    return false;
  });
}

function getClosedChecks(salesData) {
  return ((salesData || {}).checks || []).filter((c) => c.status === 'closed');
}

function fmtTurnTime(minutes) {
  if (!minutes) return '0:00';
  const m = Math.floor(minutes);
  const s = Math.round((minutes - m) * 60);
  return m + `:${String(s).padStart(2, '0')}`;
}

function orderAgeMinutes(order) {
  let ts = order.opened_at || order.created_at;
  if (!ts) return 0;
  return Math.round((Date.now() - new Date(ts).getTime()) / 60000);
}

function ageColor(minutes) {
  if (minutes > 90) return T.verm;
  if (minutes > 45) return T.gold;
  return T.green;
}

// ── Data fetching ─────────────────────────────────
function fetchAllData(state) {
  const sid = encodeURIComponent((state.emp || {}).id || '');
  return Promise.all([
    fetchWithTimeout(`/api/v1/orders/day-summary?server_id=${sid}`, {}, 10000)
      .then((r) => r.ok ? r.json() : Promise.reject(r.status)).catch(() => { return {}; }),
    fetchWithTimeout(`/api/v1/orders?server_id=${sid}`, {}, 10000)
      .then((r) => r.ok ? r.json() : Promise.reject(r.status)).catch(() => []),
    fetchWithTimeout(`/api/v1/server/shift/table-stats?server_id=${sid}`, {}, 10000)
      .then((r) => r.ok ? r.json() : Promise.reject(r.status)).catch(() => { return {}; }),
    fetchWithTimeout(`/api/v1/server/shift/checkout-status?server_id=${sid}`, {}, 10000)
      .then((r) => r.ok ? r.json() : Promise.reject(r.status)).catch(() => { return { openChecks: 0, unadjustedTips: 0 }; }),
    fetchWithTimeout('/api/v1/config/tipout', {}, 10000)
      .then((r) => r.ok ? r.json() : Promise.reject(r.status)).catch(() => []),
  ]).then((results) => {
    const _rawSales = results[0] || {};
    // Attach sparkData from dayparts for sparkline rendering.
    const _parts = _rawSales.dayparts || [];
    if (_parts.length > 0) {
      const _pts = _parts.map((p) => p.sales || 0);
      while (_pts.length < 7) { _pts.push(_pts[_pts.length - 1] || 0); }
      _rawSales.sparkData = _pts.slice(0, 7);
    }
    state.salesData = _rawSales;
    state.allOrders      = Array.isArray(results[1]) ? results[1] : [];
    state.tableStats     = results[2] || {};
    state.checkoutStatus = results[3] || { openChecks: 0, unadjustedTips: 0 };
    const rules = Array.isArray(results[4]) ? results[4] : [];
    state.tipoutRate = rules.reduce((s, r) => s + (r.percentage || 0), 0) / 100;
  });
}

// ── Check tile ────────────────────────────────────
function buildCheckTile(order, isSelected, onClick) {
  let age = orderAgeMinutes(order);
  const tc  = isSelected ? T.gold : ageColor(age);

  let tile = buildActionCard({
    accent:  tc,
    onClick: onClick,
  });
  tile.style.width          = '110px';
  tile.style.height         = '90px';
  tile.style.flexShrink     = '0';
  tile.style.display        = 'flex';
  tile.style.flexDirection  = 'column';
  tile.style.justifyContent = 'space-between';
  tile.style.padding        = '10px 12px';
  tile.style.position       = 'relative';
  tile.style.boxSizing      = 'border-box';
  tile.style.background     = isSelected
    ? hexToRgba(T.gold, 0.10)
    : hexToRgba(tc, 0.04);
  tile.style.boxShadow      = isSelected
    ? `0 0 12px ${hexToRgba(T.gold, 0.20)}`
    : `0 0 6px ${hexToRgba(tc, 0.15)}`;

  let idEl = document.createElement('div');
  idEl.textContent   = checkNum(order);
  idEl.style.cssText = `font-family:${T.fh};font-size:14px;font-weight:700;color:${(isSelected ? T.gold : T.text)};letter-spacing:0.06em;`;

  const guestEl = document.createElement('div');
  let guests = order.seat_count || order.guest_count || order.covers || 1;
  guestEl.textContent   = `x${guests}`;
  guestEl.style.cssText = `font-family:${T.fb};font-size:11px;font-weight:${T.fwBold};color:${T.moon};`;

  const totalEl = document.createElement('div');
  let total = order.total != null
    ? fmt(parseFloat(order.total) || 0)
    : fmt((order.total_cents || 0) / 100);
  totalEl.textContent   = total;
  totalEl.style.cssText = `font-family:${T.fh};font-size:16px;font-weight:700;color:${T.gold};text-shadow:0 0 8px ${hexToRgba(T.gold, 0.35)};`;

  // Time badge — bottom-right corner
  if (age > 0) {
    const badge = document.createElement('div');
    let ageStr = age < 60
      ? age + 'm'
      : Math.floor(age / 60) + `:${String(age % 60).padStart(2, '0')}`;
    badge.textContent   = ageStr;
    badge.style.cssText = [
      'position:absolute;bottom:7px;right:8px;',
      `font-family:${T.fb};font-size:9px;font-weight:700;`,
      `color:${tc};letter-spacing:0.06em;`,
      `background:${hexToRgba(tc, 0.12)};`,
      `border:1px solid ${hexToRgba(tc, 0.35)};`,
      'border-radius:4px;padding:1px 4px;',
      'pointer-events:none;',
    ].join('');
    tile.appendChild(badge);
  }

  tile.appendChild(idEl);
  tile.appendChild(guestEl);
  tile.appendChild(totalEl);
  return tile;
}

function buildNewCheckTile(onClick) {
  const tile = buildActionCard({
    accent: T.groups.landing.tileAccent,
    onClick: onClick
  });
  tile.style.width          = '110px';
  tile.style.height         = '90px';
  tile.style.flexShrink     = '0';
  tile.style.display        = 'flex';
  tile.style.alignItems     = 'center';
  tile.style.justifyContent = 'center';
  tile.style.background     = 'transparent';
  tile.style.border         = `1px dashed ${hexToRgba(T.groups.landing.newCheckBorder, 0.5)}`;

  const plus = document.createElement('span');
  plus.style.cssText = `font-family:${T.fh};font-size:32px;color:${hexToRgba(T.groups.landing.newCheckBorder, 0.6)};pointer-events:none;;font-weight:${T.fwBold};`;
  plus.textContent = '+';
  tile.appendChild(plus);

  return tile;
}


// ── Check preview content ─────────────────────────
function _buildCheckPreview(orders) {
  const wrap = document.createElement('div');

  let total = orders.reduce((s, o) => s + (Number(o.total) || 0), 0);
  const hdr = document.createElement('div');
  hdr.style.cssText = `display:flex;justify-content:space-between;align-items:baseline;padding-bottom:8px;border-bottom:2px solid ${T.green};margin-bottom:8px;`;
  const hLabel = document.createElement('div');
  hLabel.style.cssText = `font-family:${T.fh};font-size:14px;font-weight:700;color:${T.green};letter-spacing:0.08em;`;
  hLabel.textContent   = orders.length > 1 ? orders.length + ' CHECKS' : checkNum(orders[0]);
  const hTotal = document.createElement('div');
  hTotal.style.cssText = `font-family:${T.fh};font-size:14px;font-weight:700;color:${T.gold};`;
  hTotal.textContent   = fmt(total);
  hdr.appendChild(hLabel);
  hdr.appendChild(hTotal);
  wrap.appendChild(hdr);

  orders.forEach((order) => {
    if (orders.length > 1) {
      const sub = document.createElement('div');
      sub.style.cssText = `font-family:${T.fh};font-size:11px;color:${T.green};letter-spacing:0.06em;margin-top:4px;margin-bottom:4px;;font-weight:${T.fwBold};`;
      sub.textContent   = checkNum(order);
      wrap.appendChild(sub);
    }

    const seatMap = {};
    const seatOrder = [];
    (order.items || []).forEach((item) => {
      const sn = item.seat_number || 1;
      if (!seatMap[sn]) { seatMap[sn] = []; seatOrder.push(sn); }
      seatMap[sn].push(item);
    });
    seatOrder.sort((a, b) => a - b);

    seatOrder.forEach((sn) => {
      const seatSubtotal = seatMap[sn].reduce((s, it) => s + (parseFloat(it.price) || 0), 0);
      const seatHdr = document.createElement('div');
      seatHdr.style.cssText = [
        'display:flex;align-items:center;gap:8px;',
        `background:${T.card};border-radius:6px;`,
        `border:1px solid ${T.green};border-top:2px solid ${T.green};`,
        'padding:4px 8px 4px 10px;',
        'margin-top:6px;margin-bottom:4px;',
        'cursor:pointer;touch-action:manipulation;',
      ].join('');
      const seatNum = document.createElement('span');
      seatNum.style.cssText = `font-family:${T.fh};font-size:24px;font-weight:700;color:${T.green};line-height:1;min-width:28px;`;
      seatNum.textContent = `S${sn}`;
      const seatLbl = document.createElement('span');
      seatLbl.style.cssText = `font-family:${T.fb};font-size:9px;font-weight:700;color:${hexToRgba(T.text, 0.35)};letter-spacing:0.16em;align-self:flex-end;padding-bottom:3px;`;
      seatLbl.textContent = 'SEAT';
      const spacer = document.createElement('span');
      spacer.style.cssText = 'flex:1;';
      const seatTot = document.createElement('span');
      seatTot.style.cssText = `font-family:${T.fb};font-size:11px;font-weight:700;color:${T.gold};`;
      seatTot.textContent = fmt(seatSubtotal);
      const chevron = document.createElement('span');
      chevron.style.cssText = `font-size:10px;color:${hexToRgba(T.text, 0.4)};margin-left:4px;;font-weight:${T.fwBold};`;
      chevron.textContent = '▾';
      seatHdr.appendChild(seatNum);
      seatHdr.appendChild(seatLbl);
      seatHdr.appendChild(spacer);
      seatHdr.appendChild(seatTot);
      seatHdr.appendChild(chevron);

      const seatBody = document.createElement('div');
      seatBody.style.display = 'none';

      seatHdr.addEventListener('click', () => {
        const open = seatBody.style.display !== 'none';
        seatBody.style.display = open ? 'none' : 'block';
        chevron.textContent = open ? '▾' : '▴';
      });

      wrap.appendChild(seatHdr);
      wrap.appendChild(seatBody);

      seatMap[sn].forEach((item) => {
        let card = document.createElement('div');
        card.style.cssText = `background:${T.card};border:1px solid ${T.moon};border-top:2px solid ${T.moon};border-radius:6px;margin-bottom:5px;margin-left:14px;overflow:hidden;`;

        // Item row
        let row = document.createElement('div');
        row.style.cssText = 'display:flex;align-items:center;gap:6px;padding:8px 10px 6px;';
        const nm = document.createElement('span');
        nm.style.cssText = `flex:1;font-family:${T.fb};font-size:12px;font-weight:700;color:${T.text};`;
        nm.textContent   = item.name || 'Item';
        const pr = document.createElement('span');
        pr.style.cssText = `font-family:${T.fb};font-size:12px;font-weight:700;color:${T.gold};flex-shrink:0;margin-left:12px;`;
        pr.textContent   = fmt(item.price || 0);
        row.appendChild(nm);
        row.appendChild(pr);
        card.appendChild(row);

        // Modifier lines
        const mods = Array.isArray(item.mods) ? item.mods : [];
        if (mods.length > 0) {
          const modList = document.createElement('div');
          modList.style.cssText = 'padding:0 10px 7px 16px;display:flex;'
            + 'flex-direction:column;gap:2px;';
          mods.forEach((mod) => {
            const modRow = document.createElement('div');
            modRow.style.cssText = 'display:flex;align-items:center;gap:4px;';
            const arrow = document.createElement('span');
            arrow.textContent   = '↳';
            arrow.style.cssText = `font-family:${T.fb};font-size:10px;color:${T.moon};flex-shrink:0;`;
            const modNm = document.createElement('span');
            modNm.style.cssText = `flex:1;font-family:${T.fb};font-size:11px;color:${T.moon};`;
            modNm.textContent = mod.name || mod.label || '';
            const modPr = document.createElement('span');
            modPr.style.cssText = `font-family:${T.fb};font-size:11px;color:${T.moon};flex-shrink:0;`;
            modPr.textContent = (mod.price && mod.price !== 0)
              ? fmt(mod.price)
              : '';
            modRow.appendChild(arrow);
            modRow.appendChild(modNm);
            if (modPr.textContent) modRow.appendChild(modPr);
            modList.appendChild(modRow);
          });
          card.appendChild(modList);
        }

        seatBody.appendChild(card);
      });
    });
  });

  return wrap;
}

// ── Tip row ───────────────────────────────────────
function buildTipRow(chk, onTap, isActive) {
  const adjusted = chk.adjusted;
  let row = document.createElement('div');
  row.style.cssText = [
    'display:flex;align-items:center;gap:10px;',
    'padding:8px 6px;border-radius:6px;cursor:pointer;',
    'touch-action:manipulation;pointer-events:auto;',
    `border-left:3px solid ${(isActive ? T.elec : 'transparent')};`,
    'box-sizing:border-box;',
    `background:${(adjusted ? hexToRgba(T.green, 0.06) : 'transparent')};`,
    'transition:background 0.12s;',
  ].join('');

  const dot = document.createElement('div');
  dot.style.cssText = [
    'width:8px;height:8px;border-radius:50%;flex-shrink:0;transition:all 0.12s;',
    `background:${(adjusted ? T.green : 'transparent')};`,
    `border:1.5px solid ${(adjusted ? T.green : T.border)};`,
    `box-shadow:${(adjusted ? '0 0 6px ' + T.green : 'none')};`,
  ].join('');

  const idEl = document.createElement('div');
  idEl.textContent   = chk.checkLabel || checkNum({ order_id: chk.checkId }) || 'CHK';
  idEl.style.cssText = `font-family:${T.fh};font-size:12px;color:${T.text};flex:1;letter-spacing:0.06em;;font-weight:${T.fwBold};`;

  const amtEl = document.createElement('div');
  amtEl.textContent   = fmt(chk.amount || 0);
  amtEl.style.cssText = `font-family:${T.fb};font-size:11px;color:${T.text};opacity:0.7;;font-weight:${T.fwBold};`;

  const tipEl = document.createElement('div');
  tipEl.textContent   = adjusted ? fmt(chk.tip || 0) : '—';
  tipEl.style.cssText = `font-family:${T.fb};font-size:11px;min-width:44px;text-align:right;color:${(adjusted ? T.green : T.border)};;font-weight:${T.fwBold};`;

  row.appendChild(dot);
  row.appendChild(idEl);
  row.appendChild(amtEl);
  row.appendChild(tipEl);

  row.addEventListener('pointerdown',  () => { row.style.background = hexToRgba(T.green, 0.1); });
  row.addEventListener('pointerup',    () => {
    row.style.background = adjusted ? hexToRgba(T.green, 0.06) : 'transparent';
    if (onTap) onTap(chk);
  });
  row.addEventListener('pointerleave', () => {
    row.style.background = adjusted ? hexToRgba(T.green, 0.06) : 'transparent';
  });
  return row;
}

// ═══════════════════════════════════════════════════
//  SCENE
// ═══════════════════════════════════════════════════

defineScene({
  name: 'server-landing',

  state: {
    filter:      'OPEN',
    allOrders:   [],
    salesData:   {},
    tableStats:  {},
    checkoutStatus: { openChecks: 0, unadjustedTips: 0 },
    tipoutRate:  0,
    selectedIds: [],
    selectedAt:  {},        // id → timestamp of when that id was first selected
    emp:         null,
    _refreshing:     false,
    _voidPending:    false,
    _voidPendingKey: null,
    _printing:       false,
    el:              null,

    // Refs to live-update DOM elements
    _refs: {},
  },

  render: (container, params, state) => {
    state.emp = params.staff || params.emp || params || {};
    state.el  = container;
    state._inputIgnoreUntil = Date.now() + 200;

    // ── Root grid ──────────────────────────────────
    const root = document.createElement('div');
    root.style.cssText = [
      'position:absolute;inset:0;',
      `background:${T.bg};`,
      'display:grid;',
      'grid-template-columns:300px 1fr 1fr;',
      'grid-template-rows:1fr 250px;',
      'gap:10px;padding:8px 10px 32px;',
      'box-sizing:border-box;overflow:visible;',
      `font-family:${T.fb};`,
    ].join('') + `;font-weight:${T.fwBold};`;
    container.appendChild(root);

    // ─────────────────────────────────────────────
    //  LEFT COLUMN (spans both rows)
    // ─────────────────────────────────────────────
    const leftCol = document.createElement('div');
    leftCol.style.cssText = 'grid-column:1;grid-row:1/3;display:flex;flex-direction:column;gap:10px;overflow:visible;';
    root.appendChild(leftCol);

    // ── Tip queue (always visible) ──
    const tipOuter = document.createElement('div');
    tipOuter.style.cssText = 'flex:1;position:relative;overflow:visible;display:flex;flex-direction:column;';
    leftCol.appendChild(tipOuter);

    const tipResult = buildStaticCard({ accent: T.groups.landing.infoAccent });
    tipResult.style.flex          = '1';
    tipResult.style.display       = 'flex';
    tipResult.style.flexDirection = 'column';
    tipResult.style.overflow      = 'hidden';
    tipResult.style.position      = 'relative';
    tipOuter.appendChild(tipResult);

    // Tip accumulation sparkline background
    const tipSparkBg = buildTipSparkBg({ data: [0] });
    tipResult.insertBefore(tipSparkBg.el, tipResult.firstChild);

    let tipFilter     = 'UNADJ';
    let activeCheckId = null;
    let tipScrim      = null;
    let tipNumpadCard = null;

    // Tips header
    const tipHdr = document.createElement('div');
    tipHdr.style.cssText = `padding:12px 14px 8px;border-bottom:1px solid ${hexToRgba(T.border, 0.4)};flex-shrink:0;`;

    const tipHdrRow = document.createElement('div');
    tipHdrRow.style.cssText = 'display:flex;justify-content:space-between;align-items:baseline;margin-bottom:4px;';
    const tipHdrLabel = buildSectionLabel('Tip Queue', T.text);
    tipHdrRow.appendChild(tipHdrLabel);

    const tipTabs = document.createElement('div');
    tipTabs.style.cssText = 'display:flex;gap:10px;align-items:center;';

    const tabUnadj = document.createElement('div');
    tabUnadj.textContent = 'UNADJ';
    tabUnadj.style.cssText = `font-family:${T.fb};font-size:${T.fsB3};color:${T.green};border-bottom:2px solid ${T.green};touch-action:manipulation;pointer-events:auto;cursor:pointer;padding-bottom:2px;;font-weight:${T.fwBold};`;

    const tabAdj = document.createElement('div');
    tabAdj.textContent = 'ADJ';
    tabAdj.style.cssText = `font-family:${T.fb};font-size:${T.fsB3};color:${T.moon};border-bottom:2px solid transparent;touch-action:manipulation;pointer-events:auto;cursor:pointer;padding-bottom:2px;;font-weight:${T.fwBold};`;

    tipTabs.appendChild(tabUnadj);
    tipTabs.appendChild(tabAdj);
    tipHdrRow.appendChild(tipTabs);
    tipHdr.appendChild(tipHdrRow);

    const tipsTotal = document.createElement('div');
    tipsTotal.style.cssText = `font-family:${T.fh};font-size:28px;font-weight:700;color:${T.gold};text-shadow:0 0 14px ${hexToRgba(T.gold, 0.4)};`;
    tipsTotal.textContent = '$0.00';
    tipHdr.appendChild(tipsTotal);

    // Take-home line — gross tips minus tipout
    const takeHomeLine = document.createElement('div');
    takeHomeLine.style.cssText = `font-family:${T.fb};font-size:11px;font-weight:700;color:${T.greenWarm};letter-spacing:0.08em;margin-top:2px;`;
    takeHomeLine.textContent = 'after tipout $0.00';
    tipHdr.appendChild(takeHomeLine);

    tipResult.appendChild(tipHdr);

    // Scrollable tip rows
    const tipList = document.createElement('div');
    tipList.style.cssText = 'flex:1;overflow-y:auto;min-height:0;padding:6px 10px;display:flex;flex-direction:column;gap:2px;';
    tipResult.appendChild(tipList);

    // Unadj chip — sits below tip list, hidden when count is 0
    const unadjChip = document.createElement('div');
    unadjChip.style.cssText = 'display:none;align-items:center;gap:6px;'
      + 'padding:0 14px 8px;flex-shrink:0;';
    const unadjDot = document.createElement('div');
    unadjDot.style.cssText = `width:6px;height:6px;border-radius:50%;background:${T.verm};flex-shrink:0;`;
    const unadjText = document.createElement('span');
    unadjText.style.cssText = `font-family:${T.fb};font-size:10px;font-weight:700;color:${T.verm};letter-spacing:0.1em;`;
    unadjText.textContent = '0 UNADJ REMAINING';
    unadjChip.appendChild(unadjDot);
    unadjChip.appendChild(unadjText);
    tipResult.appendChild(unadjChip);

    // Checkout pill — always enabled, lavender variant
    const checkoutBtn = buildPillButton({ label: 'CHECKOUT', color: T.lavender, darkBg: darkenHex(T.lavender, 0.35) });

    // Check preview — absolutely covers tipResult when a tile is selected
    const previewSlide = document.createElement('div');
    previewSlide.style.cssText = [
      'z-index:2;position:absolute;inset:0;',
      `background:${T.card};`,
      `border-left:4px solid ${T.groups.landing.infoAccent};`,
      'border-radius:10px;',
      'box-shadow:0 4px 16px rgba(0,0,0,0.28);',
      'padding:12px 14px;',
      'display:none;flex-direction:column;',
      'overflow:hidden;',
    ].join('');
    tipOuter.appendChild(previewSlide);

    const prevContent = document.createElement('div');
    prevContent.style.cssText = 'flex:1;min-height:0;overflow-y:auto;touch-action:pan-y;pointer-events:auto;';
    previewSlide.appendChild(prevContent);

    const prevActions = document.createElement('div');
    prevActions.style.cssText = [
      'display:flex;flex-direction:column;gap:8px;',
      'flex-shrink:0;padding-top:10px;margin-top:8px;',
      `border-top:1px solid ${hexToRgba(T.border, 0.3)};`,
    ].join('');
    previewSlide.appendChild(prevActions);

    // ─────────────────────────────────────────────
    //  CHECK GRID (cols 2-3, row 1)
    // ─────────────────────────────────────────────
    const gridResult = buildStaticCard({ accent: T.groups.landing.infoAccent });
    gridResult.style.gridColumn = '2/4';
    gridResult.style.gridRow    = '1';
    gridResult.style.height     = '100%';
    gridResult.style.display    = 'flex';
    gridResult.style.flexDirection = 'column';
    root.appendChild(gridResult);

    const tileGrid = document.createElement('div');
    tileGrid.style.cssText = 'display:flex;flex-wrap:wrap;gap:10px;align-content:flex-start;flex:1;min-height:0;overflow-y:auto;touch-action:pan-y;pointer-events:auto;padding:14px 14px 10px;';
    gridResult.appendChild(tileGrid);

    // Grid footer — urgency legend left, filter pill right
    const gridFooter = document.createElement('div');
    gridFooter.style.cssText = [
      'display:flex;justify-content:space-between;align-items:center;',
      'padding:6px 14px 10px;flex-shrink:0;',
      'border-top:1px solid rgba(255,255,255,0.06);',
    ].join('');
    gridResult.appendChild(gridFooter);

    // Urgency legend
    const legendEl = document.createElement('div');
    legendEl.style.cssText = 'display:flex;gap:14px;align-items:center;';
    const LEGEND = [
      { label: '<45m',   color: T.green },
      { label: '45–90m', color: T.gold  },
      { label: '>90m',   color: T.verm  },
    ];
    LEGEND.forEach((entry) => {
      const item = document.createElement('div');
      item.style.cssText = 'display:flex;align-items:center;gap:5px;';
      const swatch = document.createElement('div');
      swatch.style.cssText = [
        'width:8px;height:8px;border-radius:2px;',
        `background:${hexToRgba(entry.color, 0.25)};`,
        `border:1px solid ${hexToRgba(entry.color, 0.6)};`,
      ].join('');
      let lbl = document.createElement('span');
      lbl.textContent   = entry.label;
      lbl.style.cssText = `font-family:${T.fb};font-size:9px;font-weight:700;color:${hexToRgba(entry.color, 0.7)};letter-spacing:0.1em;`;
      item.appendChild(swatch);
      item.appendChild(lbl);
      legendEl.appendChild(item);
    });
    gridFooter.appendChild(legendEl);

    // OPEN/CLOSED/VOID pill filter — right side of footer
    const filterBtn = buildPillButton({ label: 'ACTIVE', color: T.green, darkBg: T.greenDk, fontSize: T.fsB3 });
    filterBtn.style.pointerEvents = 'auto';
    gridFooter.appendChild(filterBtn);

    // ─────────────────────────────────────────────
    //  FLOOR STATUS (col 2, row 2)
    // ─────────────────────────────────────────────
    const statsResult = buildStaticCard({ accent: T.elec });
    statsResult.style.gridColumn    = '2';
    statsResult.style.gridRow       = '2';
    statsResult.style.display       = 'flex';
    statsResult.style.flexDirection = 'column';
    root.appendChild(statsResult);

    const statsLbl = buildSectionLabel('Floor Status', T.text);
    statsLbl.style.marginBottom = '8px'; statsLbl.style.fontSize = '13px';
    statsResult.appendChild(statsLbl);

    const statsGrid = document.createElement('div');
    statsGrid.style.cssText = 'display:grid;grid-template-columns:1fr 1fr;gap:8px;flex:1;min-height:0;overflow:hidden;';
    statsResult.appendChild(statsGrid);

    const scTables  = buildStatCard({ title: 'Tables',   value: '0',    color: T.elec,  delta: '' });
    const scGuests  = buildStatCard({ title: 'Guests',   value: '0',    color: T.text,  delta: '' });
    const scOldest  = buildStatCard({ title: 'Oldest',   value: '0:00', color: T.green, delta: '' });
    const scTurn    = buildStatCard({ title: 'Avg Turn', value: '0:00', color: T.moon,  delta: '' });
    [scTables, scGuests, scOldest, scTurn].forEach((s) => { statsGrid.appendChild(s.wrap); });

    // ─────────────────────────────────────────────
    //  MY SHIFT (col 3, row 2)
    // ─────────────────────────────────────────────
    const shiftResult = buildStaticCard({ accent: T.gold });
    shiftResult.style.gridColumn    = '3';
    shiftResult.style.gridRow       = '2';
    shiftResult.style.display       = 'flex';
    shiftResult.style.flexDirection = 'column';
    root.appendChild(shiftResult);

    // Header row: MY SHIFT label + CHECKOUT pill
    const shiftHdr = document.createElement('div');
    shiftHdr.style.cssText = 'display:flex;justify-content:space-between;'
      + 'align-items:center;margin-bottom:6px;flex-shrink:0;';
    const shiftLbl = buildSectionLabel('MY SHIFT', T.text);
    shiftLbl.style.marginBottom = '0';
    shiftLbl.style.fontSize     = '13px';
    shiftHdr.appendChild(shiftLbl);
    // Checkout pill lives here now
    checkoutBtn.style.fontSize = '11px';
    checkoutBtn.style.padding  = '6px 14px';
    shiftHdr.appendChild(checkoutBtn);
    shiftResult.appendChild(shiftHdr);

    // Hero: estimated take-home
    const shiftHeroWrap = document.createElement('div');
    shiftHeroWrap.style.cssText = 'margin-bottom:6px;flex-shrink:0;';
    const shiftHeroLbl = document.createElement('div');
    shiftHeroLbl.textContent   = 'EST. TAKE-HOME';
    shiftHeroLbl.style.cssText = `font-family:${T.fb};font-size:9px;font-weight:700;color:${T.moon};letter-spacing:0.14em;margin-bottom:2px;`;
    const shiftHeroVal = document.createElement('div');
    shiftHeroVal.textContent   = '$0.00';
    shiftHeroVal.style.cssText = `font-family:${T.fh};font-size:32px;font-weight:700;color:${T.greenWarm};line-height:1;text-shadow:0 0 14px ${hexToRgba(T.greenWarm, 0.35)};`;
    shiftHeroWrap.appendChild(shiftHeroLbl);
    shiftHeroWrap.appendChild(shiftHeroVal);
    shiftResult.appendChild(shiftHeroWrap);

    // Data rows: ADJ TIPS / TIPOUT / CASH OUT
    const shiftRows = document.createElement('div');
    shiftRows.style.cssText = 'display:flex;flex-direction:column;gap:4px;flex:1;';

    function _makeShiftRow(label, value, color) {
      let row = document.createElement('div');
      row.style.cssText = 'display:flex;justify-content:space-between;align-items:center;'
        + `padding:4px 0;border-bottom:1px solid ${hexToRgba(T.border, 0.25)};`;
      const lbl = document.createElement('span');
      lbl.textContent   = label;
      lbl.style.cssText = `font-family:${T.fb};font-size:10px;font-weight:700;color:${T.moon};letter-spacing:0.1em;`;
      const val = document.createElement('span');
      val.textContent   = value;
      val.style.cssText = `font-family:${T.fh};font-size:14px;font-weight:700;color:${color};`;
      row.appendChild(lbl);
      row.appendChild(val);
      row._valEl = val;
      return row;
    }

    const shiftRowAdjTips = _makeShiftRow('ADJ TIPS',  '$0.00', T.gold);
    const shiftRowTipout  = _makeShiftRow('TIPOUT',     '$0.00', T.warning);
    const shiftRowCashOut = _makeShiftRow('CASH OUT',   '$0.00', T.gold);
    shiftRows.appendChild(shiftRowAdjTips);
    shiftRows.appendChild(shiftRowTipout);
    shiftRows.appendChild(shiftRowCashOut);
    shiftResult.appendChild(shiftRows);

    // Unadj warning chip for MY SHIFT
    const shiftUnadjChip = document.createElement('div');
    shiftUnadjChip.style.cssText = 'display:none;align-items:center;gap:5px;margin-top:6px;flex-shrink:0;';
    const shiftUnadjDot = document.createElement('div');
    shiftUnadjDot.style.cssText = 'width:5px;height:5px;border-radius:50%;'
      + `background:${T.warning};flex-shrink:0;`;
    const shiftUnadjText = document.createElement('span');
    shiftUnadjText.style.cssText = `font-family:${T.fb};font-size:9px;font-weight:700;color:${T.warning};letter-spacing:0.1em;`;
    shiftUnadjText.textContent = '0 TIPS UNADJUSTED';
    shiftUnadjChip.appendChild(shiftUnadjDot);
    shiftUnadjChip.appendChild(shiftUnadjText);
    shiftResult.appendChild(shiftUnadjChip);

    // Store refs for live updates
    state._refs = {
      tileGrid,
      tipList, tipsTotal, takeHomeLine, unadjChip, unadjText,
      tipResult, checkoutBtn, filterBtn,
      tipSparkBg, scTables, scGuests, scOldest, scTurn,
      previewSlide, prevContent, prevActions,
      shiftHeroVal, shiftRowAdjTips, shiftRowTipout,
      shiftRowCashOut, shiftUnadjChip, shiftUnadjText,
    };

    // ─────────────────────────────────────────────
    //  RENDER FUNCTIONS
    // ─────────────────────────────────────────────

    function renderTiles() {
      let r = state._refs;
      r.tileGrid.innerHTML = '';
      const visible = ordersByFilter(state.allOrders, state.filter);
      visible.forEach((order) => {
        const id       = order.order_id;
        let selected = state.selectedIds.indexOf(id) !== -1;
        r.tileGrid.appendChild(buildCheckTile(order, selected, () => {
          if (state._inputIgnoreUntil > Date.now()) return;
          const lastTap = state.selectedAt[id] || 0;
          if (lastTap && Date.now() - lastTap <= DOUBLE_TAP_MS) {
            state._inputIgnoreUntil = Date.now() + 200;
            delete state.selectedAt[id];
            SceneManager.mountWorking('check-overview', {
              checkId:       order.order_id,
              returnLanding: 'server-landing',
              employeeId:    state.emp ? state.emp.id   : null,
              employeeName:  state.emp ? state.emp.name : null,
              pin:           state.emp ? state.emp.pin  : null,
            });
            return;
          }
          const idx = state.selectedIds.indexOf(id);
          if (idx === -1) {
            state.selectedIds.push(id);
          } else {
            state.selectedIds.splice(idx, 1);
          }
          state.selectedAt[id] = Date.now();
          renderTiles();
          renderPreview();
        }));
      });
      if (state.filter === 'OPEN') {
        r.tileGrid.appendChild(buildNewCheckTile(() => {
          SceneManager.mountWorking('check-overview', {
            checkId:       null,
            returnLanding: 'server-landing',
            employeeId:    state.emp ? state.emp.id   : null,
            employeeName:  state.emp ? state.emp.name : null,
            pin:           state.emp ? state.emp.pin  : null,
          });
        }));
      }
      if (visible.length === 0 && state.filter !== 'OPEN') {
        let empty = document.createElement('div');
        empty.textContent   = `No ${state.filter.toLowerCase()} checks`;
        empty.style.cssText = `font-family:${T.fb};font-size:14px;color:${T.border};letter-spacing:0.14em;padding:8px 4px;;font-weight:${T.fwBold};`;
        r.tileGrid.appendChild(empty);
      }
    }

    function renderPreview() {
      let r = state._refs;
      r.prevContent.innerHTML = '';
      r.prevActions.innerHTML = '';

      if (state.selectedIds.length === 0) {
        r.previewSlide.style.display = 'none';
        return;
      }

      const selected = state.allOrders.filter((o) => state.selectedIds.indexOf(o.order_id) !== -1);
      if (selected.length === 0) {
        r.previewSlide.style.display = 'none';
        return;
      }

      const single = selected.length === 1;
      let total  = selected.reduce((s, o) => s + (parseFloat(o.total) || (o.total_cents || 0) / 100), 0);

      // ── Header row: label + × close ──
      const hdrRow = document.createElement('div');
      hdrRow.style.cssText = 'display:flex;justify-content:space-between;'
        + 'align-items:center;margin-bottom:8px;';

      const hdrLabel = buildSectionLabel('Check Preview');
      hdrLabel.style.marginBottom = '0';
      hdrRow.appendChild(hdrLabel);

      const closeBtn = document.createElement('div');
      closeBtn.textContent   = '×';
      closeBtn.style.cssText = `font-family:${T.fb};font-size:18px;font-weight:700;color:${T.moon};cursor:pointer;pointer-events:auto;touch-action:manipulation;line-height:1;padding:0 2px;`;
      closeBtn.addEventListener('pointerup', () => {
        state.selectedIds = [];
        state.selectedAt  = {};
        renderTiles();
        renderPreview();
      });
      hdrRow.appendChild(closeBtn);
      r.prevContent.appendChild(hdrRow);

      // ── Content: items (single) or check list (multi) ──
      // Single: _buildCheckPreview renders its own header + items.
      // Multi: render a summary header + one row per check.
      if (single) {
        r.prevContent.appendChild(_buildCheckPreview(selected));
      } else {
        selected.forEach((o) => {
          const row = document.createElement('div');
          row.style.cssText = [
            'display:flex;align-items:center;gap:8px;',
            'padding:7px 10px;border-radius:6px;margin-bottom:4px;',
            `background:${hexToRgba(T.gold, 0.06)};`,
            `border:1px solid ${hexToRgba(T.gold, 0.2)};`,
          ].join('');
          const info = document.createElement('div');
          info.style.cssText = 'flex:1;';
          const cNum = document.createElement('div');
          cNum.textContent   = checkNum(o);
          cNum.style.cssText = `font-family:${T.fh};font-size:13px;font-weight:700;color:${T.gold};letter-spacing:0.06em;`;
          const cSub = document.createElement('div');
          const guests = o.seat_count || o.guest_count || o.covers || 1;
          let age    = orderAgeMinutes(o);
          const ageStr = age < 60
            ? age + 'm'
            : Math.floor(age / 60) + `:${String(age % 60).padStart(2, '0')}`;
          cSub.textContent   = `x${guests} · ${ageStr}`;
          cSub.style.cssText = `font-family:${T.fb};font-size:10px;font-weight:700;color:${T.moon};margin-top:1px;`;
          info.appendChild(cNum);
          info.appendChild(cSub);
          const cTotal = document.createElement('div');
          cTotal.textContent   = fmt(parseFloat(o.total) || (o.total_cents || 0) / 100);
          cTotal.style.cssText = `font-family:${T.fh};font-size:14px;font-weight:700;color:${T.gold};`;
          row.appendChild(info);
          row.appendChild(cTotal);
          r.prevContent.appendChild(row);
        });
      }

      // ── Options bar ──
      const opts = single
        ? [
            { label: 'MANAGE',   color: T.elec,      dark: T.elecDk,      span: 2 },
            { label: 'PRINT',    color: T.greenWarm,  dark: T.greenWarmDk, span: 1 },
            { label: 'PAY',      color: T.gold,       dark: T.goldDk,      span: 1 },
            { label: 'DISCOUNT', color: T.elec,       dark: T.elecDk,      span: 1 },
            { label: 'VOID',     color: T.verm,       dark: T.vermDk,      span: 1 },
          ]
        : [
            { label: 'MANAGE',              color: T.elec,      dark: T.elecDk,      span: 2 },
            { label: `PRINT ${selected.length}`, color: T.greenWarm, dark: T.greenWarmDk, span: 1 },
            { label: 'PAY',                 color: T.gold,       dark: T.goldDk,      span: 1 },
            { label: 'DISCOUNT',            color: T.elec,       dark: T.elecDk,      span: 1 },
            { label: 'VOID',                color: T.verm,       dark: T.vermDk,      span: 1 },
          ];

      const divider = document.createElement('div');
      divider.style.cssText = `border-top:1px solid ${hexToRgba(T.border, 0.3)};margin-top:8px;padding-top:10px;display:grid;grid-template-columns:1fr 1fr;gap:7px;`;

      opts.forEach((op) => {
        const btn = buildPillButton({
          label:  op.label,
          color:  op.color,
          darkBg: op.dark,
        });
        btn.style.fontSize   = '11px';
        btn.style.padding    = '8px 4px';
        btn.style.boxShadow  = `0 3px 0 ${op.dark}`;
        if (op.span === 2) btn.style.gridColumn = '1 / -1';
        if (op.color === T.verm) btn.style.color = '#fff';

        btn.addEventListener('pointerup', () => {
          if (op.label === 'MANAGE') {
            const cols = selected.map((o) => {
              return {
                id:    o.order_id,
                label: checkNum(o),
                items: (o.items || []).map((it) => {
                  return {
                    name:    it.name || 'Item',
                    qty:     it.qty  || 1,
                    price:   parseFloat(it.price) || 0,
                    item_id: it.item_id,
                  };
                }),
              };
            });
            SceneManager.openTransactional('column-editor', {
              columns:      cols,
              checkNumber:  single ? checkNum(selected[0]) : selected.length + ' checks',
              returnScene:  'server-landing',
              onSave: (updatedCols) => {
                refresh();
              },
            });
          }
          if (op.label === 'PAY') {
            if (!single) {
              showToast('Select one check to pay', { bg: T.gold, duration: 1800 });
              return;
            }
            SceneManager.mountWorking('check-overview', {
              checkId:       selected[0].order_id,
              returnLanding: 'server-landing',
              employeeId:    state.emp ? state.emp.id   : null,
              employeeName:  state.emp ? state.emp.name : null,
              pin:           state.emp ? state.emp.pin  : null,
              autoPay:       true,
            });
            return;
          }

          if (op.label.indexOf('PRINT') === 0) {
            if (state._printing) return;
            state._printing = true;
            const printIds = selected.map((o) => o.order_id);
            let printed = 0, failed = 0;
            function _finishPrint() {
              if (printed + failed !== printIds.length) return;
              state._printing = false;
              showToast(
                failed === 0
                  ? `Printed ${printed} receipt${(printed === 1 ? '' : 's')}`
                  : printed + ` printed, ${failed} failed`,
                { bg: failed === 0 ? T.green : T.gold, duration: 2000 }
              );
            }
            showToast(
              `Printing ${printIds.length} receipt${(printIds.length === 1 ? '' : 's')}…`,
              { bg: T.green, duration: 1200 }
            );
            printIds.forEach((orderId) => {
              fetchWithTimeout(
                `/api/v1/orders/${orderId}/print/receipt`,
                { method: 'POST' }, 8000
              ).then((r) => {
                if (r.ok) printed++; else failed++;
                _finishPrint();
              }).catch(() => {
                failed++;
                _finishPrint();
              });
            });
            return;
          }

          if (op.label === 'DISCOUNT') {
            if (!single) {
              showToast('Select one check to discount', { bg: T.elec, duration: 1800 });
              return;
            }
            SceneManager.mountWorking('check-overview', {
              checkId:        selected[0].order_id,
              returnLanding:  'server-landing',
              employeeId:     state.emp ? state.emp.id   : null,
              employeeName:   state.emp ? state.emp.name : null,
              pin:            state.emp ? state.emp.pin  : null,
              autoDiscount:   true,
            });
            return;
          }

          if (op.label === 'VOID') {
            const voidIds  = state.selectedIds.slice().sort().join(',');
            const voidMsg  = single
              ? `Void ${checkNum(selected[0])}?`
              : `Void ${selected.length} checks?`;

            if (!state._voidPending || state._voidPendingKey !== voidIds) {
              showToast(voidMsg + ' — tap again to confirm', { bg: T.verm, duration: 3000 });
              state._voidPending    = true;
              state._voidPendingKey = voidIds;
              setTimeout(() => {
                state._voidPending    = false;
                state._voidPendingKey = null;
              }, 3000);
              return;
            }

            // Second tap confirmed — void each selected check
            state._voidPending    = false;
            state._voidPendingKey = null;
            const toVoid  = selected.slice();
            let voided  = 0, vFailed = 0;
            function _finishVoid() {
              if (voided + vFailed !== toVoid.length) return;
              if (voided > 0) {
                state.selectedIds = [];
                state.selectedAt  = {};
                refresh();
              }
              showToast(
                vFailed === 0
                  ? `Voided ${voided} check${(voided === 1 ? '' : 's')}`
                  : voided + ` voided, ${vFailed} failed`,
                { bg: vFailed === 0 ? T.green : T.gold, duration: 2000 }
              );
            }
            showToast(voidMsg.replace('?', '…'), { bg: T.verm, duration: 1200 });
            toVoid.forEach((o) => {
              fetchWithTimeout(
                `/api/v1/orders/${o.order_id}/void`,
                {
                  method:  'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body:    JSON.stringify({
                    pin:         state.emp ? state.emp.pin : '',
                    reason:      'server void',
                    approved_by: state.emp ? (state.emp.id || state.emp.employee_id) : null,
                  }),
                }, 10000
              ).then((r) => {
                if (r.ok) voided++; else vFailed++;
                _finishVoid();
              }).catch(() => {
                vFailed++;
                _finishVoid();
              });
            });
            return;
          }
        });

        divider.appendChild(btn);
      });

      r.prevActions.appendChild(divider);
      r.previewSlide.style.display = 'flex';
    }

    function renderTipQueue() {
      let r      = state._refs;
      let checks = getClosedChecks(state.salesData);
      r.tipList.innerHTML = '';

      if (checks.length === 0) {
        const empty = document.createElement('div');
        empty.textContent   = 'No closed checks yet';
        empty.style.cssText = `font-family:${T.fb};font-size:14px;color:${T.border};text-align:center;padding:16px 0;letter-spacing:0.12em;;font-weight:${T.fwBold};`;
        r.tipList.appendChild(empty);
        r.tipsTotal.textContent = '$0.00';
        return;
      }

      let total    = 0;
      let unadj    = 0;
      const filtered = [];
      checks.forEach((chk) => {
        if (chk.adjusted) total += (Number(chk.tip) || 0);
        else unadj++;
        if (tipFilter === 'UNADJ' && !chk.adjusted) filtered.push(chk);
        if (tipFilter === 'ADJ'   &&  chk.adjusted) filtered.push(chk);
      });

      filtered.forEach((chk) => {
        r.tipList.appendChild(buildTipRow(chk, (c) => {
          openTipNumpad(c);
        }, chk.checkId === activeCheckId));
      });

      if (filtered.length === 0) {
        const emptyFilter = document.createElement('div');
        emptyFilter.textContent   = `No ${tipFilter.toLowerCase()} checks`;
        emptyFilter.style.cssText = `font-family:${T.fb};font-size:14px;color:${T.border};text-align:center;padding:16px 0;letter-spacing:0.12em;;font-weight:${T.fwBold};`;
        r.tipList.appendChild(emptyFilter);
      }

      r.tipsTotal.textContent = fmt(total);

      // Take-home line
      let takeHome = total - (total * state.tipoutRate);
      r.takeHomeLine.textContent = `after tipout ${fmt(takeHome)}`;

      // Unadj chip
      if (unadj > 0) {
        r.unadjText.textContent   = unadj + ' UNADJ REMAINING';
        r.unadjChip.style.display = 'flex';
      } else {
        r.unadjChip.style.display = 'none';
      }

      r.tipResult.setAccent(unadj > 0 ? T.verm : T.groups.landing.infoAccent);
    }

    function renderFloorStatus() {
      const ts = state.tableStats || {};
      let r  = state._refs;

      r.scTables.setValue(ts.tableCount != null ? String(ts.tableCount) : '0');
      r.scGuests.setValue(ts.guestCount != null ? String(ts.guestCount) : '0');

      // OLDEST — find the maximum age among open orders
      const openOrders = (state.allOrders || []).filter((o) => o.status === 'open');
      let maxAge = 0;
      openOrders.forEach((o) => {
        const age = orderAgeMinutes(o);
        if (age > maxAge) maxAge = age;
      });
      const oldestStr = maxAge < 60
        ? maxAge + 'm'
        : Math.floor(maxAge / 60) + `:${String(maxAge % 60).padStart(2, '0')}`;
      const oldestColor = ageColor(maxAge);
      r.scOldest.setValue(maxAge > 0 ? oldestStr : '—');
      r.scOldest.setColor(oldestColor);

      // AVG TURN
      r.scTurn.setValue(ts.avgTurnMinutes ? fmtTurnTime(ts.avgTurnMinutes) : '0:00');

      // Update tip sparkline with cumulative tip data if available
      const closedChecks = ((state.salesData.checks || [])).filter((c) => c.status === 'closed');
      if (closedChecks.length > 1) {
        const cumulative = [];
        let running = 0;
        closedChecks.forEach((c) => { running += Number(c.tip) || 0; cumulative.push(running); });
        r.tipSparkBg.update(cumulative);
      }
    }

    function renderMyShift() {
      const r   = state._refs;
      const sd  = state.salesData || {};
      let checks = ((sd.checks || [])).filter((c) => c.status === 'closed');

      let adjTips = 0;
      let unadj   = 0;
      checks.forEach((c) => {
        if (c.adjusted) adjTips += (Number(c.tip) || 0);
        else unadj++;
      });

      const tipoutAmt = adjTips * (state.tipoutRate || 0);
      const takeHome  = adjTips - tipoutAmt;
      const cashOut   = Number(sd.cash_sales || sd.cash_total) || 0;
      const tipoutPct = Math.round((state.tipoutRate || 0) * 100);

      r.shiftHeroVal.textContent           = fmt(takeHome);
      r.shiftRowAdjTips._valEl.textContent = fmt(adjTips);
      r.shiftRowTipout._valEl.textContent  = `−${fmt(tipoutAmt).slice(1)}`;
      r.shiftRowTipout._valEl.style.color  = T.warning;

      // Update tipout label to show percentage
      r.shiftRowTipout.querySelector('span').textContent = `TIPOUT (${tipoutPct}%)`;

      r.shiftRowCashOut._valEl.textContent = fmt(cashOut);

      if (unadj > 0) {
        r.shiftUnadjText.textContent   = unadj + ' TIPS UNADJUSTED';
        r.shiftUnadjChip.style.display = 'flex';
      } else {
        r.shiftUnadjChip.style.display = 'none';
      }
    }

    // ─────────────────────────────────────────────
    //  FLOATING TIP NUMPAD
    // ─────────────────────────────────────────────
    function closeTipNumpad() {
      if (tipScrim     && tipScrim.parentNode)      tipScrim.parentNode.removeChild(tipScrim);
      if (tipNumpadCard && tipNumpadCard.parentNode) tipNumpadCard.parentNode.removeChild(tipNumpadCard);
      tipScrim      = null;
      tipNumpadCard = null;
      activeCheckId = null;
    }

    function openTipNumpad(chk) {
      if (activeCheckId === chk.checkId) {
        closeTipNumpad();
        renderTipQueue();
        return;
      }

      closeTipNumpad();
      activeCheckId = chk.checkId;
      renderTipQueue();

      // Scrim
      const scrim = document.createElement('div');
      scrim.style.cssText = [
        'position:fixed;inset:0;',
        `background:${T.scrimWorking};`,
        `z-index:${T.zWorking};`,
      ].join('');
      scrim.addEventListener('pointerup', () => {
        closeTipNumpad();
        renderTipQueue();
      });
      document.body.appendChild(scrim);
      tipScrim = scrim;

      // Floating card
      const card = document.createElement('div');
      card.style.cssText = [
        'position:fixed;',
        `left:${T.pcLeftW}px;`,
        'width:260px;',
        'top:50%;transform:translateY(-50%);',
        `z-index:${T.zTransactional};`,
        `background:${T.card};`,
        'border-radius:10px;',
        `border-left:3px solid ${T.elec};`,
        'padding:12px;',
        'box-sizing:border-box;',
        'display:flex;flex-direction:column;gap:8px;',
      ].join('');
      document.body.appendChild(card);
      tipNumpadCard = card;

      // Check label
      const checkLbl = document.createElement('div');
      checkLbl.textContent   = chk.checkLabel || checkNum({ order_id: chk.checkId }) || 'CHK';
      checkLbl.style.cssText = `font-family:${T.fb};font-size:${T.fsB3};color:${T.moon};letter-spacing:0.1em;text-align:center;;font-weight:${T.fwBold};`;
      card.appendChild(checkLbl);

      // Pre-populate cents string for ADJ tab
      const startCents = (tipFilter === 'ADJ' && chk.adjusted && chk.tip)
        ? String(Math.round(chk.tip * 100)) : '';

      // buildNumpad — keys sized to fit 233px inner width
      // keyW=67: 67×3 + 8×2 + 8×2 + 5×2 = 233px
      const numpad = buildNumpad({
        masked:        false,
        displayColor:  T.gold,
        digitColor:    T.green,
        clearColor:    T.verm,
        submitColor:   T.greenWarm,
        submitLabel:   'ENT',
        maxDigits:     6,
        displayH:      55,
        keyW:          67,
        keyH:          65,
        keyGap:        8,
        cardPad:       8,
        gap:           10,
        displayFormat: (p) => `$${(parseInt(p || '0', 10) / 100).toFixed(2)}`,
        canSubmit: () => true,
        onSubmit: (pin) => {
          const tipVal = parseInt(pin || '0', 10) / 100;
          const checks = state.salesData.checks || [];
          let target = null;
          for (let i = 0; i < checks.length; i++) {
            if (checks[i].checkId === chk.checkId || checks[i].id === chk.checkId) {
              target = checks[i];
              break;
            }
          }
          const prevTip = target ? target.tip : undefined;
          const prevAdj = target ? target.adjusted : undefined;
          if (target) { target.tip = tipVal; target.adjusted = true; }
          closeTipNumpad();
          renderTipQueue();
          fetchWithTimeout(`/api/v1/checks/${chk.checkId}/tip`, {
            method:  'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body:    JSON.stringify({ tip: tipVal, adjusted: true }),
          }, 10000).catch(() => {
            if (target) { target.tip = prevTip; target.adjusted = prevAdj; }
            showToast('Tip update failed — please try again', { bg: T.verm, duration: 3000 });
            if (state.el) renderTipQueue();
          });
        },
        onCancel: () => {
          closeTipNumpad();
          renderTipQueue();
        },
      });

      if (startCents) numpad.setPin(startCents);
      card.appendChild(numpad);
    }

    // ─────────────────────────────────────────────
    //  FILTER TOGGLE
    // ─────────────────────────────────────────────
    filterBtn.addEventListener('pointerup', () => {
      state.filter      = FILTER_CYCLE[state.filter];
      state.selectedIds = [];
      state.selectedAt  = {};
      const fc = FILTER_COLORS[state.filter];
      state._refs.filterBtn.textContent = FILTER_DISPLAY[state.filter] || state.filter;
      state._refs.filterBtn.setColor(fc.color, fc.dark);
      renderTiles();
    });

    // ─────────────────────────────────────────────
    //  TIP QUEUE TABS
    // ─────────────────────────────────────────────
    tabUnadj.addEventListener('pointerup', () => {
      tipFilter = 'UNADJ';
      tabUnadj.style.color        = T.green;
      tabUnadj.style.borderBottom = `2px solid ${T.green}`;
      tabAdj.style.color          = T.moon;
      tabAdj.style.borderBottom   = '2px solid transparent';
      renderTipQueue();
    });

    tabAdj.addEventListener('pointerup', () => {
      tipFilter = 'ADJ';
      tabAdj.style.color          = T.green;
      tabAdj.style.borderBottom   = `2px solid ${T.green}`;
      tabUnadj.style.color        = T.moon;
      tabUnadj.style.borderBottom = '2px solid transparent';
      renderTipQueue();
    });

    // ─────────────────────────────────────────────
    //  CHECKOUT
    //  The button label + color in updateCheckout() communicates blocker
    //  state ("N Unadj" / "Open Checks" / "Checkout"), but navigation is
    //  always permitted — server-checkout owns the blocker resolution UI
    //  (banner, open-checks card, unadjusted-tips card). Gating access
    //  here would prevent the server from reaching the very scene that
    //  resolves the blockers.
    // ─────────────────────────────────────────────
    checkoutBtn.addEventListener('pointerup', () => {
      SceneManager.mountWorking('server-checkout', { staff: state.emp });
    });

    // ─────────────────────────────────────────────
    //  DATA + REFRESH
    // ─────────────────────────────────────────────
    function refresh() {
      if (state._refreshing || !state.el) return;
      state._refreshing = true;
      fetchAllData(state).then(() => {
        state._refreshing = false;
        if (!state.el) return;
        const alive = {};
        (state.allOrders || []).forEach((o) => { alive[o.order_id] = true; });
        state.selectedIds = (state.selectedIds || []).filter((id) => alive[id]);
        Object.keys(state.selectedAt || {}).forEach((id) => {
          if (!alive[id]) delete state.selectedAt[id];
        });
        try { renderTiles();    } catch(e) { console.warn('[sl] renderTiles threw:', e); }
        try { renderPreview();  } catch(e) { console.warn('[sl] renderPreview threw:', e); }
        try { renderTipQueue(); } catch(e) { console.warn('[sl] renderTipQueue threw:', e); }
        try { renderFloorStatus(); } catch(e) { console.warn('[sl] renderFloorStatus threw:', e); }
        try { renderMyShift(); } catch(e) { console.warn('[sl] renderMyShift threw:', e); }
      }).catch(() => { state._refreshing = false; });
    }

    // Initial load
    refresh();

    // Scene bus events
    SceneManager.on('order:updated', refresh);
    SceneManager.on('order:closed',  refresh);
    SceneManager.on('tip:adjusted',  refresh);

    return function cleanup() {
      state.el = null;
      closeTipNumpad();
      SceneManager.off('order:updated', refresh);
      SceneManager.off('order:closed',  refresh);
      SceneManager.off('tip:adjusted',  refresh);
    };
  },
});