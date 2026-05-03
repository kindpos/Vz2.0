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

// ── Input guard + double-tap window ──────────────
var DOUBLE_TAP_MS = 300;    // second tap must land within this window to open

// ── Filter cycle ──────────────────────────────────
var FILTER_CYCLE   = { OPEN: 'CLOSED', CLOSED: 'VOID', VOID: 'OPEN' };
var FILTER_DISPLAY = { OPEN: 'ACTIVE', CLOSED: 'CLOSED', VOID: 'VOID' };
var FILTER_COLORS = {
  OPEN:   { color: T.green, dark: T.greenDk },
  CLOSED: { color: T.gold,  dark: T.goldDk  },
  VOID:   { color: T.verm,  dark: T.vermDk  },
};

// ── Helpers ───────────────────────────────────────
function fmt(n) {
  n = n || 0;
  var abs = Math.abs(n).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return (n < 0 ? '\u2212$' : '$') + abs;
}

function checkNum(order) {
  return order.check_number || ('C-' + String(order.order_id).slice(0, 3).toUpperCase());
}

function ordersByFilter(allOrders, filter) {
  return (allOrders || []).filter(function(o) {
    if (filter === 'OPEN')   return o.status === 'open';
    if (filter === 'CLOSED') return o.status === 'closed' || o.status === 'paid';
    if (filter === 'VOID')   return o.status === 'voided';
    return false;
  });
}

function getClosedChecks(salesData) {
  return ((salesData || {}).checks || []).filter(function(c) {
    return c.status === 'closed';
  });
}

function fmtTurnTime(minutes) {
  if (!minutes) return '0:00';
  var m = Math.floor(minutes);
  var s = Math.round((minutes - m) * 60);
  return m + ':' + String(s).padStart(2, '0');
}

function orderAgeMinutes(order) {
  var ts = order.opened_at || order.created_at;
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
  var sid = encodeURIComponent((state.emp || {}).id || '');
  return Promise.all([
    fetchWithTimeout('/api/v1/orders/day-summary?server_id=' + sid, {}, 10000)
      .then(function(r) { return r.ok ? r.json() : Promise.reject(r.status); }).catch(function() { return {}; }),
    fetchWithTimeout('/api/v1/orders?server_id=' + sid, {}, 10000)
      .then(function(r) { return r.ok ? r.json() : Promise.reject(r.status); }).catch(function() { return []; }),
    fetchWithTimeout('/api/v1/server/shift/table-stats?server_id=' + sid, {}, 10000)
      .then(function(r) { return r.ok ? r.json() : Promise.reject(r.status); }).catch(function() { return {}; }),
    fetchWithTimeout('/api/v1/server/shift/checkout-status?server_id=' + sid, {}, 10000)
      .then(function(r) { return r.ok ? r.json() : Promise.reject(r.status); }).catch(function() { return { openChecks: 0, unadjustedTips: 0 }; }),
    fetchWithTimeout('/api/v1/config/tipout', {}, 10000)
      .then(function(r) { return r.ok ? r.json() : Promise.reject(r.status); }).catch(function() { return []; }),
  ]).then(function(results) {
    var _rawSales = results[0] || {};
    // Attach sparkData from dayparts for sparkline rendering.
    var _parts = _rawSales.dayparts || [];
    if (_parts.length > 0) {
      var _pts = _parts.map(function(p) { return p.sales || 0; });
      while (_pts.length < 7) { _pts.push(_pts[_pts.length - 1] || 0); }
      _rawSales.sparkData = _pts.slice(0, 7);
    }
    state.salesData = _rawSales;
    state.allOrders      = Array.isArray(results[1]) ? results[1] : [];
    state.tableStats     = results[2] || {};
    state.checkoutStatus = results[3] || { openChecks: 0, unadjustedTips: 0 };
    var rules = Array.isArray(results[4]) ? results[4] : [];
    state.tipoutRate = rules.reduce(function(s, r) { return s + (r.percentage || 0); }, 0) / 100;
  });
}

// ── Check tile ────────────────────────────────────
function buildCheckTile(order, isSelected, onClick) {
  var age = orderAgeMinutes(order);
  var tc  = isSelected ? T.gold : ageColor(age);

  var tile = buildActionCard({
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
    ? '0 0 12px ' + hexToRgba(T.gold, 0.20)
    : '0 0 6px '  + hexToRgba(tc, 0.15);

  var idEl = document.createElement('div');
  idEl.textContent   = checkNum(order);
  idEl.style.cssText = 'font-family:' + T.fh + ';font-size:14px;font-weight:700;'
    + 'color:' + (isSelected ? T.gold : T.text) + ';letter-spacing:0.06em;';

  var guestEl = document.createElement('div');
  var guests = order.seat_count || order.guest_count || order.covers || 1;
  guestEl.textContent   = 'x' + guests;
  guestEl.style.cssText = 'font-family:' + T.fb + ';font-size:11px;font-weight:'
    + T.fwBold + ';color:' + T.moon + ';';

  var totalEl = document.createElement('div');
  var total = order.total != null
    ? fmt(parseFloat(order.total) || 0)
    : fmt((order.total_cents || 0) / 100);
  totalEl.textContent   = total;
  totalEl.style.cssText = 'font-family:' + T.fh + ';font-size:16px;font-weight:700;'
    + 'color:' + T.gold + ';text-shadow:0 0 8px ' + hexToRgba(T.gold, 0.35) + ';';

  // Time badge — bottom-right corner
  if (age > 0) {
    var badge = document.createElement('div');
    var ageStr = age < 60
      ? age + 'm'
      : Math.floor(age / 60) + ':' + String(age % 60).padStart(2, '0');
    badge.textContent   = ageStr;
    badge.style.cssText = [
      'position:absolute;bottom:7px;right:8px;',
      'font-family:' + T.fb + ';font-size:9px;font-weight:700;',
      'color:' + tc + ';letter-spacing:0.06em;',
      'background:' + hexToRgba(tc, 0.12) + ';',
      'border:1px solid ' + hexToRgba(tc, 0.35) + ';',
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
  var tile = buildActionCard({
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
  tile.style.border         = '1px dashed ' + hexToRgba(T.groups.landing.newCheckBorder, 0.5);

  var plus = document.createElement('span');
  plus.style.cssText = 'font-family:' + T.fh + ';font-size:32px;color:' + hexToRgba(T.groups.landing.newCheckBorder, 0.6) + ';pointer-events:none;' + ";font-weight:" + T.fwBold + ";";
  plus.textContent = '+';
  tile.appendChild(plus);

  return tile;
}


// ── Check preview content ─────────────────────────
function _buildCheckPreview(orders) {
  var wrap = document.createElement('div');

  var total = orders.reduce(function(s, o) { return s + (o.total || 0); }, 0);
  var hdr = document.createElement('div');
  hdr.style.cssText = 'display:flex;justify-content:space-between;align-items:baseline;padding-bottom:8px;border-bottom:2px solid ' + T.green + ';margin-bottom:8px;';
  var hLabel = document.createElement('div');
  hLabel.style.cssText = 'font-family:' + T.fh + ';font-size:14px;font-weight:700;color:' + T.green + ';letter-spacing:0.08em;';
  hLabel.textContent   = orders.length > 1 ? orders.length + ' CHECKS' : checkNum(orders[0]);
  var hTotal = document.createElement('div');
  hTotal.style.cssText = 'font-family:' + T.fh + ';font-size:14px;font-weight:700;color:' + T.gold + ';';
  hTotal.textContent   = fmt(total);
  hdr.appendChild(hLabel);
  hdr.appendChild(hTotal);
  wrap.appendChild(hdr);

  orders.forEach(function(order) {
    if (orders.length > 1) {
      var sub = document.createElement('div');
      sub.style.cssText = 'font-family:' + T.fh + ';font-size:11px;color:' + T.green + ';letter-spacing:0.06em;margin-top:4px;margin-bottom:4px;' + ";font-weight:" + T.fwBold + ";";
      sub.textContent   = checkNum(order);
      wrap.appendChild(sub);
    }

    var seatMap = {};
    var seatOrder = [];
    (order.items || []).forEach(function(item) {
      var sn = item.seat_number || 1;
      if (!seatMap[sn]) { seatMap[sn] = []; seatOrder.push(sn); }
      seatMap[sn].push(item);
    });
    seatOrder.sort(function(a, b) { return a - b; });

    seatOrder.forEach(function(sn) {
      var seatSubtotal = seatMap[sn].reduce(function(s, it) { return s + (parseFloat(it.price) || 0); }, 0);
      var seatHdr = document.createElement('div');
      seatHdr.style.cssText = [
        'display:flex;align-items:center;gap:8px;',
        'background:' + T.card + ';border-radius:6px;',
        'border:1px solid ' + T.green + ';border-top:2px solid ' + T.green + ';',
        'padding:4px 8px 4px 10px;',
        'margin-top:6px;margin-bottom:4px;',
        'cursor:pointer;touch-action:manipulation;',
      ].join('');
      var seatNum = document.createElement('span');
      seatNum.style.cssText = 'font-family:' + T.fh + ';font-size:24px;font-weight:700;color:' + T.green + ';line-height:1;min-width:28px;';
      seatNum.textContent = 'S' + sn;
      var seatLbl = document.createElement('span');
      seatLbl.style.cssText = 'font-family:' + T.fb + ';font-size:9px;font-weight:700;color:' + hexToRgba(T.text, 0.35) + ';letter-spacing:0.16em;align-self:flex-end;padding-bottom:3px;';
      seatLbl.textContent = 'SEAT';
      var spacer = document.createElement('span');
      spacer.style.cssText = 'flex:1;';
      var seatTot = document.createElement('span');
      seatTot.style.cssText = 'font-family:' + T.fb + ';font-size:11px;font-weight:700;color:' + T.gold + ';';
      seatTot.textContent = fmt(seatSubtotal);
      var chevron = document.createElement('span');
      chevron.style.cssText = 'font-size:10px;color:' + hexToRgba(T.text, 0.4) + ';margin-left:4px;' + ";font-weight:" + T.fwBold + ";";
      chevron.textContent = '▾';
      seatHdr.appendChild(seatNum);
      seatHdr.appendChild(seatLbl);
      seatHdr.appendChild(spacer);
      seatHdr.appendChild(seatTot);
      seatHdr.appendChild(chevron);

      var seatBody = document.createElement('div');
      seatBody.style.display = 'none';

      seatHdr.addEventListener('click', function() {
        var open = seatBody.style.display !== 'none';
        seatBody.style.display = open ? 'none' : 'block';
        chevron.textContent = open ? '▾' : '▴';
      });

      wrap.appendChild(seatHdr);
      wrap.appendChild(seatBody);

      seatMap[sn].forEach(function(item) {
        var card = document.createElement('div');
        card.style.cssText = 'background:' + T.card + ';border:1px solid ' + T.moon + ';border-top:2px solid ' + T.moon + ';border-radius:6px;margin-bottom:5px;margin-left:14px;overflow:hidden;';
        var row = document.createElement('div');
        row.style.cssText = 'display:flex;align-items:center;gap:6px;padding:8px 10px;';
        var nm = document.createElement('span');
        nm.style.cssText = 'flex:1;font-family:' + T.fb + ';font-size:12px;font-weight:700;color:' + T.text + ';';
        nm.textContent   = item.name || 'Item';
        var pr = document.createElement('span');
        pr.style.cssText = 'font-family:' + T.fb + ';font-size:12px;font-weight:700;color:' + T.gold + ';flex-shrink:0;margin-left:12px;';
        pr.textContent   = fmt(item.price || 0);
        row.appendChild(nm);
        row.appendChild(pr);
        card.appendChild(row);
        seatBody.appendChild(card);
      });
    });
  });

  return wrap;
}

// ── Tip row ───────────────────────────────────────
function buildTipRow(chk, onTap, isActive) {
  var adjusted = chk.adjusted;
  var row = document.createElement('div');
  row.style.cssText = [
    'display:flex;align-items:center;gap:10px;',
    'padding:8px 6px;border-radius:6px;cursor:pointer;',
    'touch-action:manipulation;pointer-events:auto;',
    'border-left:3px solid ' + (isActive ? T.elec : 'transparent') + ';',
    'box-sizing:border-box;',
    'background:' + (adjusted ? hexToRgba(T.green, 0.06) : 'transparent') + ';',
    'transition:background 0.12s;',
  ].join('');

  var dot = document.createElement('div');
  dot.style.cssText = [
    'width:8px;height:8px;border-radius:50%;flex-shrink:0;transition:all 0.12s;',
    'background:' + (adjusted ? T.green : 'transparent') + ';',
    'border:1.5px solid ' + (adjusted ? T.green : T.border) + ';',
    'box-shadow:' + (adjusted ? '0 0 6px ' + T.green : 'none') + ';',
  ].join('');

  var idEl = document.createElement('div');
  idEl.textContent   = chk.checkLabel || checkNum({ order_id: chk.checkId }) || 'CHK';
  idEl.style.cssText = 'font-family:' + T.fh + ';font-size:12px;color:' + T.text + ';flex:1;letter-spacing:0.06em;' + ";font-weight:" + T.fwBold + ";";

  var amtEl = document.createElement('div');
  amtEl.textContent   = fmt(chk.amount || 0);
  amtEl.style.cssText = 'font-family:' + T.fb + ';font-size:11px;color:' + T.text + ';opacity:0.7;' + ";font-weight:" + T.fwBold + ";";

  var tipEl = document.createElement('div');
  tipEl.textContent   = adjusted ? fmt(chk.tip || 0) : '—';
  tipEl.style.cssText = 'font-family:' + T.fb + ';font-size:11px;min-width:44px;text-align:right;color:' + (adjusted ? T.green : T.border) + ';' + ";font-weight:" + T.fwBold + ";";

  row.appendChild(dot);
  row.appendChild(idEl);
  row.appendChild(amtEl);
  row.appendChild(tipEl);

  row.addEventListener('pointerdown',  function() { row.style.background = hexToRgba(T.green, 0.1); });
  row.addEventListener('pointerup',    function() {
    row.style.background = adjusted ? hexToRgba(T.green, 0.06) : 'transparent';
    if (onTap) onTap(chk);
  });
  row.addEventListener('pointerleave', function() {
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
    _refreshing: false,
    el:          null,

    // Refs to live-update DOM elements
    _refs: {},
  },

  render: function(container, params, state) {
    state.emp = params.staff || params.emp || params || {};
    state.el  = container;
    state._inputIgnoreUntil = Date.now() + 200;

    // ── Root grid ──────────────────────────────────
    var root = document.createElement('div');
    root.style.cssText = [
      'position:absolute;inset:0;',
      'background:' + T.bg + ';',
      'display:grid;',
      'grid-template-columns:300px 1fr 1fr;',
      'grid-template-rows:1fr 250px;',
      'gap:10px;padding:8px 10px 32px;',
      'box-sizing:border-box;overflow:visible;',
      'font-family:' + T.fb + ';',
    ].join('') + ";font-weight:" + T.fwBold + ";";
    container.appendChild(root);

    // ─────────────────────────────────────────────
    //  LEFT COLUMN (spans both rows)
    // ─────────────────────────────────────────────
    var leftCol = document.createElement('div');
    leftCol.style.cssText = 'grid-column:1;grid-row:1/3;display:flex;flex-direction:column;gap:10px;overflow:visible;';
    root.appendChild(leftCol);

    // ── Tip queue (always visible) ──
    var tipOuter = document.createElement('div');
    tipOuter.style.cssText = 'flex:1;position:relative;overflow:visible;display:flex;flex-direction:column;';
    leftCol.appendChild(tipOuter);

    var tipResult = buildStaticCard({ accent: T.groups.landing.infoAccent });
    tipResult.style.flex          = '1';
    tipResult.style.display       = 'flex';
    tipResult.style.flexDirection = 'column';
    tipResult.style.overflow      = 'hidden';
    tipResult.style.position      = 'relative';
    tipOuter.appendChild(tipResult);

    // Tip accumulation sparkline background
    var tipSparkBg = buildTipSparkBg({ data: [0] });
    tipResult.insertBefore(tipSparkBg.el, tipResult.firstChild);

    var tipFilter     = 'UNADJ';
    var activeCheckId = null;
    var tipScrim      = null;
    var tipNumpadCard = null;

    // Tips header
    var tipHdr = document.createElement('div');
    tipHdr.style.cssText = 'padding:12px 14px 8px;border-bottom:1px solid ' + hexToRgba(T.border, 0.4) + ';flex-shrink:0;';

    var tipHdrRow = document.createElement('div');
    tipHdrRow.style.cssText = 'display:flex;justify-content:space-between;align-items:baseline;margin-bottom:4px;';
    var tipHdrLabel = buildSectionLabel('Tip Queue', T.text);
    tipHdrRow.appendChild(tipHdrLabel);

    var tipTabs = document.createElement('div');
    tipTabs.style.cssText = 'display:flex;gap:10px;align-items:center;';

    var tabUnadj = document.createElement('div');
    tabUnadj.textContent = 'UNADJ';
    tabUnadj.style.cssText = 'font-family:' + T.fb + ';font-size:' + T.fsB3 + ';color:' + T.green + ';border-bottom:2px solid ' + T.green + ';touch-action:manipulation;pointer-events:auto;cursor:pointer;padding-bottom:2px;' + ";font-weight:" + T.fwBold + ";";

    var tabAdj = document.createElement('div');
    tabAdj.textContent = 'ADJ';
    tabAdj.style.cssText = 'font-family:' + T.fb + ';font-size:' + T.fsB3 + ';color:' + T.moon + ';border-bottom:2px solid transparent;touch-action:manipulation;pointer-events:auto;cursor:pointer;padding-bottom:2px;' + ";font-weight:" + T.fwBold + ";";

    tipTabs.appendChild(tabUnadj);
    tipTabs.appendChild(tabAdj);
    tipHdrRow.appendChild(tipTabs);
    tipHdr.appendChild(tipHdrRow);

    var tipsTotal = document.createElement('div');
    tipsTotal.style.cssText = 'font-family:' + T.fh + ';font-size:28px;font-weight:700;color:' + T.gold + ';text-shadow:0 0 14px ' + hexToRgba(T.gold, 0.4) + ';';
    tipsTotal.textContent   = '$0.00';
    tipHdr.appendChild(tipsTotal);
    tipResult.appendChild(tipHdr);

    // Scrollable tip rows
    var tipList = document.createElement('div');
    tipList.style.cssText = 'flex:1;overflow-y:auto;min-height:0;padding:6px 10px;display:flex;flex-direction:column;gap:2px;';
    tipResult.appendChild(tipList);

    // Checkout pill — always enabled, greenWarm variant
    var checkoutBtn = buildPillButton({ label: 'CHECKOUT', color: T.lavender, darkBg: darkenHex(T.lavender, 0.35) });
    checkoutBtn.style.marginTop = '10px';
    checkoutBtn.style.padding   = '10px 28px';
    tipResult.appendChild(checkoutBtn);

    // Check preview — absolutely covers tipResult when a tile is selected
    var previewSlide = document.createElement('div');
    previewSlide.style.cssText = [
      'z-index:2;position:absolute;inset:0;',
      'background:' + T.card + ';',
      'border-left:4px solid ' + T.groups.landing.infoAccent + ';',
      'border-radius:10px;',
      'box-shadow:0 4px 16px rgba(0,0,0,0.28);',
      'padding:12px 14px;',
      'display:none;flex-direction:column;',
      'overflow:hidden;',
    ].join('');
    tipOuter.appendChild(previewSlide);

    var prevLabel = buildSectionLabel('Check Preview');
    prevLabel.style.marginBottom = '10px';
    previewSlide.appendChild(prevLabel);

    var prevContent = document.createElement('div');
    prevContent.style.cssText = 'flex:1;min-height:0;overflow-y:auto;touch-action:pan-y;pointer-events:auto;';
    previewSlide.appendChild(prevContent);

    var prevActions = document.createElement('div');
    prevActions.style.cssText = [
      'display:flex;flex-direction:column;gap:8px;',
      'flex-shrink:0;padding-top:10px;margin-top:8px;',
      'border-top:1px solid ' + hexToRgba(T.border, 0.3) + ';',
    ].join('');
    previewSlide.appendChild(prevActions);

    // ─────────────────────────────────────────────
    //  CHECK GRID (cols 2-3, row 1)
    // ─────────────────────────────────────────────
    var gridResult = buildStaticCard({ accent: T.groups.landing.infoAccent });
    gridResult.style.gridColumn = '2/4';
    gridResult.style.gridRow    = '1';
    gridResult.style.height     = '100%';
    gridResult.style.display    = 'flex';
    gridResult.style.flexDirection = 'column';
    root.appendChild(gridResult);

    var tileGrid = document.createElement('div');
    tileGrid.style.cssText = 'display:flex;flex-wrap:wrap;gap:10px;align-content:flex-start;flex:1;min-height:0;overflow-y:auto;touch-action:pan-y;pointer-events:auto;padding:14px 14px 10px;';
    gridResult.appendChild(tileGrid);

    // Grid footer — urgency legend left, filter pill right
    var gridFooter = document.createElement('div');
    gridFooter.style.cssText = [
      'display:flex;justify-content:space-between;align-items:center;',
      'padding:6px 14px 10px;flex-shrink:0;',
      'border-top:1px solid rgba(255,255,255,0.06);',
    ].join('');
    gridResult.appendChild(gridFooter);

    // Urgency legend
    var legendEl = document.createElement('div');
    legendEl.style.cssText = 'display:flex;gap:14px;align-items:center;';
    var LEGEND = [
      { label: '<45m',   color: T.green },
      { label: '45–90m', color: T.gold  },
      { label: '>90m',   color: T.verm  },
    ];
    LEGEND.forEach(function(entry) {
      var item = document.createElement('div');
      item.style.cssText = 'display:flex;align-items:center;gap:5px;';
      var swatch = document.createElement('div');
      swatch.style.cssText = [
        'width:8px;height:8px;border-radius:2px;',
        'background:' + hexToRgba(entry.color, 0.25) + ';',
        'border:1px solid ' + hexToRgba(entry.color, 0.6) + ';',
      ].join('');
      var lbl = document.createElement('span');
      lbl.textContent   = entry.label;
      lbl.style.cssText = 'font-family:' + T.fb + ';font-size:9px;font-weight:700;'
        + 'color:' + hexToRgba(entry.color, 0.7) + ';letter-spacing:0.1em;';
      item.appendChild(swatch);
      item.appendChild(lbl);
      legendEl.appendChild(item);
    });
    gridFooter.appendChild(legendEl);

    // OPEN/CLOSED/VOID pill filter — right side of footer
    var filterBtn = buildPillButton({ label: 'ACTIVE', color: T.green, darkBg: T.greenDk, fontSize: T.fsB3 });
    filterBtn.style.pointerEvents = 'auto';
    gridFooter.appendChild(filterBtn);

    // ─────────────────────────────────────────────
    //  TABLE STATS (col 2, row 2)
    // ─────────────────────────────────────────────
    var statsResult = buildStaticCard({ accent: T.elec });
    statsResult.style.gridColumn = '2';
    statsResult.style.gridRow    = '2';
    statsResult.style.display    = 'flex';
    statsResult.style.flexDirection = 'column';
    root.appendChild(statsResult);

    var statsLbl = buildSectionLabel('Table Stats', T.text);
    statsLbl.style.marginBottom = '8px'; statsLbl.style.fontSize = '16px';
    statsResult.appendChild(statsLbl);

    var statsGrid = document.createElement('div');
    statsGrid.style.cssText = 'display:grid;grid-template-columns:1fr 1fr;gap:8px;flex:1;min-height:0;overflow:hidden;';
    statsResult.appendChild(statsGrid);

    var scGuests = buildStatCard({ title: 'Guests',  value: '0',     color: T.text, delta: '' });
    var scAvg    = buildStatCard({ title: 'Chk Avg', value: '$0.00', color: T.gold, delta: '' });
    var scTables = buildStatCard({ title: 'Tables',  value: '0',     color: T.elec, delta: '' });
    var scTurn   = buildStatCard({ title: 'Turn',    value: '0:00',  color: T.elec, delta: '' });
    [scGuests, scAvg, scTables, scTurn].forEach(function(s) { statsGrid.appendChild(s.wrap); });

    // ─────────────────────────────────────────────
    //  SALES OVERVIEW (col 3, row 2)
    // ─────────────────────────────────────────────
    var salesResult = buildStaticCard({ accent: T.gold });
    salesResult.style.gridColumn = '3';
    salesResult.style.gridRow    = '2';
    salesResult.style.display    = 'flex';
    salesResult.style.flexDirection = 'column';
    root.appendChild(salesResult);

    var salesLbl = buildSectionLabel('Sales Overview', T.text);
    salesLbl.style.marginBottom = '6px'; salesLbl.style.fontSize = '16px';
    salesResult.appendChild(salesLbl);

    var srvSalesOverview = buildSalesOverview({ netSales: 0, cash: 0, card: 0 });
    salesResult.appendChild(srvSalesOverview.wrap);

    // Store refs for live updates
    state._refs = {
      tileGrid,
      tipList, tipsTotal, tipResult, checkoutBtn, filterBtn,
      tipSparkBg, scGuests, scAvg, scTables, scTurn, srvSalesOverview,
      previewSlide, prevContent, prevActions,
    };

    // ─────────────────────────────────────────────
    //  RENDER FUNCTIONS
    // ─────────────────────────────────────────────

    function renderTiles() {
      var r = state._refs;
      r.tileGrid.innerHTML = '';
      var visible = ordersByFilter(state.allOrders, state.filter);
      visible.forEach(function(order) {
        var id       = order.order_id;
        var selected = state.selectedIds.indexOf(id) !== -1;
        r.tileGrid.appendChild(buildCheckTile(order, selected, function() {
          if (state._inputIgnoreUntil > Date.now()) return;
          var lastTap = state.selectedAt[id] || 0;
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
          var idx = state.selectedIds.indexOf(id);
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
        r.tileGrid.appendChild(buildNewCheckTile(function() {
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
        var empty = document.createElement('div');
        empty.textContent   = 'No ' + state.filter.toLowerCase() + ' checks';
        empty.style.cssText = 'font-family:' + T.fb + ';font-size:14px;color:' + T.border + ';letter-spacing:0.14em;padding:8px 4px;' + ";font-weight:" + T.fwBold + ";";
        r.tileGrid.appendChild(empty);
      }
    }

    function renderPreview() {
      var r = state._refs;
      r.prevContent.innerHTML = '';
      r.prevActions.innerHTML = '';

      if (state.selectedIds.length === 0) {
        r.previewSlide.style.display = 'none';
        return;
      }

      var selected = state.allOrders.filter(function(o) {
        return state.selectedIds.indexOf(o.order_id) !== -1;
      });
      if (selected.length === 0) {
        r.previewSlide.style.display = 'none';
        return;
      }

      var single = selected.length === 1;
      var total  = selected.reduce(function(s, o) {
        return s + (parseFloat(o.total) || (o.total_cents || 0) / 100);
      }, 0);

      // ── Header row: label + × close ──
      var hdrRow = document.createElement('div');
      hdrRow.style.cssText = 'display:flex;justify-content:space-between;'
        + 'align-items:center;margin-bottom:8px;';

      var hdrLabel = buildSectionLabel('Check Preview');
      hdrLabel.style.marginBottom = '0';
      hdrRow.appendChild(hdrLabel);

      var closeBtn = document.createElement('div');
      closeBtn.textContent   = '×';
      closeBtn.style.cssText = 'font-family:' + T.fb + ';font-size:18px;font-weight:700;'
        + 'color:' + T.moon + ';cursor:pointer;pointer-events:auto;'
        + 'touch-action:manipulation;line-height:1;padding:0 2px;';
      closeBtn.addEventListener('pointerup', function() {
        state.selectedIds = [];
        state.selectedAt  = {};
        renderTiles();
        renderPreview();
      });
      hdrRow.appendChild(closeBtn);
      r.prevContent.appendChild(hdrRow);

      // ── Summary header: check label(s) + total ──
      var sumHdr = document.createElement('div');
      sumHdr.style.cssText = 'display:flex;justify-content:space-between;'
        + 'align-items:baseline;padding-bottom:8px;'
        + 'border-bottom:2px solid ' + T.green + ';margin-bottom:8px;';

      var sumLabel = document.createElement('span');
      sumLabel.textContent   = single ? checkNum(selected[0]) : selected.length + ' CHECKS';
      sumLabel.style.cssText = 'font-family:' + T.fh + ';font-size:14px;font-weight:700;'
        + 'color:' + T.green + ';letter-spacing:0.08em;';

      var sumTotal = document.createElement('span');
      sumTotal.textContent   = fmt(total);
      sumTotal.style.cssText = 'font-family:' + T.fh + ';font-size:14px;font-weight:700;'
        + 'color:' + T.gold + ';';

      sumHdr.appendChild(sumLabel);
      sumHdr.appendChild(sumTotal);
      r.prevContent.appendChild(sumHdr);

      // ── Content: items (single) or check list (multi) ──
      if (single) {
        r.prevContent.appendChild(_buildCheckPreview(selected));
      } else {
        selected.forEach(function(o) {
          var row = document.createElement('div');
          row.style.cssText = [
            'display:flex;align-items:center;gap:8px;',
            'padding:7px 10px;border-radius:6px;margin-bottom:4px;',
            'background:' + hexToRgba(T.gold, 0.06) + ';',
            'border:1px solid ' + hexToRgba(T.gold, 0.2) + ';',
          ].join('');
          var info = document.createElement('div');
          info.style.cssText = 'flex:1;';
          var cNum = document.createElement('div');
          cNum.textContent   = checkNum(o);
          cNum.style.cssText = 'font-family:' + T.fh + ';font-size:13px;font-weight:700;'
            + 'color:' + T.gold + ';letter-spacing:0.06em;';
          var cSub = document.createElement('div');
          var guests = o.seat_count || o.guest_count || o.covers || 1;
          var age    = orderAgeMinutes(o);
          var ageStr = age < 60
            ? age + 'm'
            : Math.floor(age / 60) + ':' + String(age % 60).padStart(2, '0');
          cSub.textContent   = 'x' + guests + ' · ' + ageStr;
          cSub.style.cssText = 'font-family:' + T.fb + ';font-size:10px;font-weight:700;'
            + 'color:' + T.moon + ';margin-top:1px;';
          info.appendChild(cNum);
          info.appendChild(cSub);
          var cTotal = document.createElement('div');
          cTotal.textContent   = fmt(parseFloat(o.total) || (o.total_cents || 0) / 100);
          cTotal.style.cssText = 'font-family:' + T.fh + ';font-size:14px;font-weight:700;'
            + 'color:' + T.gold + ';';
          row.appendChild(info);
          row.appendChild(cTotal);
          r.prevContent.appendChild(row);
        });
      }

      // ── Options bar ──
      var opts = single
        ? [
            { label: 'MANAGE',   color: T.elec,      dark: T.elecDk,      span: 2 },
            { label: 'PRINT',    color: T.greenWarm,  dark: T.greenWarmDk, span: 1 },
            { label: 'PAY',      color: T.gold,       dark: T.goldDk,      span: 1 },
            { label: 'DISCOUNT', color: T.elec,       dark: T.elecDk,      span: 1 },
            { label: 'VOID',     color: T.verm,       dark: T.vermDk,      span: 1 },
          ]
        : [
            { label: 'MANAGE',              color: T.elec,      dark: T.elecDk,      span: 2 },
            { label: 'PRINT ' + selected.length, color: T.greenWarm, dark: T.greenWarmDk, span: 1 },
            { label: 'PAY',                 color: T.gold,       dark: T.goldDk,      span: 1 },
            { label: 'DISCOUNT',            color: T.elec,       dark: T.elecDk,      span: 1 },
            { label: 'VOID',                color: T.verm,       dark: T.vermDk,      span: 1 },
          ];

      var divider = document.createElement('div');
      divider.style.cssText = 'border-top:1px solid ' + hexToRgba(T.border, 0.3)
        + ';margin-top:8px;padding-top:10px;'
        + 'display:grid;grid-template-columns:1fr 1fr;gap:7px;';

      opts.forEach(function(op) {
        var btn = buildPillButton({
          label:  op.label,
          color:  op.color,
          darkBg: op.dark,
        });
        btn.style.fontSize   = '11px';
        btn.style.padding    = '8px 4px';
        btn.style.boxShadow  = '0 3px 0 ' + op.dark;
        if (op.span === 2) btn.style.gridColumn = '1 / -1';
        if (op.color === T.verm) btn.style.color = '#fff';

        btn.addEventListener('pointerup', function() {
          if (op.label === 'MANAGE') {
            var cols = selected.map(function(o) {
              return {
                id:    o.order_id,
                label: checkNum(o),
                items: (o.items || []).map(function(it) {
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
              onSave: function(updatedCols) {
                refresh();
              },
            });
          }
          // PAY, PRINT, DISCOUNT, VOID — wired in future prompts
        });

        divider.appendChild(btn);
      });

      r.prevActions.appendChild(divider);
      r.previewSlide.style.display = 'flex';
    }

    function renderTipQueue() {
      var r      = state._refs;
      var checks = getClosedChecks(state.salesData);
      r.tipList.innerHTML = '';

      if (checks.length === 0) {
        var empty = document.createElement('div');
        empty.textContent   = 'No closed checks yet';
        empty.style.cssText = 'font-family:' + T.fb + ';font-size:14px;color:' + T.border + ';text-align:center;padding:16px 0;letter-spacing:0.12em;' + ";font-weight:" + T.fwBold + ";";
        r.tipList.appendChild(empty);
        r.tipsTotal.textContent = '$0.00';
        return;
      }

      var total    = 0;
      var unadj    = 0;
      var filtered = [];
      checks.forEach(function(chk) {
        if (chk.adjusted) total += (chk.tip || 0);
        else unadj++;
        if (tipFilter === 'UNADJ' && !chk.adjusted) filtered.push(chk);
        if (tipFilter === 'ADJ'   &&  chk.adjusted) filtered.push(chk);
      });

      filtered.forEach(function(chk) {
        r.tipList.appendChild(buildTipRow(chk, function(c) {
          openTipNumpad(c);
        }, chk.checkId === activeCheckId));
      });

      if (filtered.length === 0) {
        var emptyFilter = document.createElement('div');
        emptyFilter.textContent   = 'No ' + tipFilter.toLowerCase() + ' checks';
        emptyFilter.style.cssText = 'font-family:' + T.fb + ';font-size:14px;color:' + T.border + ';text-align:center;padding:16px 0;letter-spacing:0.12em;' + ";font-weight:" + T.fwBold + ";";
        r.tipList.appendChild(emptyFilter);
      }

      r.tipsTotal.textContent = fmt(total);
      r.tipResult.setAccent(unadj > 0 ? T.verm : T.groups.landing.infoAccent);
    }

    function renderStats() {
      var ts = state.tableStats || {};
      var sd = state.salesData  || {};
      var r  = state._refs;

      r.scGuests.setValue(ts.guestCount   != null ? String(ts.guestCount)   : '0');
      r.scAvg.setValue(ts.checkAvg        != null ? fmt(ts.checkAvg)        : '$0.00');
      r.scTables.setValue(ts.tableCount   != null ? String(ts.tableCount)   : '0');
      r.scTurn.setValue(ts.avgTurnMinutes ? fmtTurnTime(ts.avgTurnMinutes)   : '0:00');

      r.srvSalesOverview.update(
        sd.net_sales  || 0,
        sd.cash_sales || sd.cash_total || 0,
        sd.card_sales || sd.card_total || 0,
        sd.net_sales > 0 ? '▲ vs yesterday' : '',
        sd.sparkData  || null
      );

      // Update tip sparkline with cumulative tip data if available
      var closedChecks = ((sd.checks || [])).filter(function(c) { return c.status === 'closed'; });
      if (closedChecks.length > 1) {
        var cumulative = [];
        var running = 0;
        closedChecks.forEach(function(c) { running += c.tip || 0; cumulative.push(running); });
        r.tipSparkBg.update(cumulative);
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
      var scrim = document.createElement('div');
      scrim.style.cssText = [
        'position:fixed;inset:0;',
        'background:' + T.scrimWorking + ';',
        'z-index:' + T.zWorking + ';',
      ].join('');
      scrim.addEventListener('pointerup', function() {
        closeTipNumpad();
        renderTipQueue();
      });
      document.body.appendChild(scrim);
      tipScrim = scrim;

      // Floating card
      var card = document.createElement('div');
      card.style.cssText = [
        'position:fixed;',
        'left:' + T.pcLeftW + 'px;',
        'width:260px;',
        'top:50%;transform:translateY(-50%);',
        'z-index:' + T.zTransactional + ';',
        'background:' + T.card + ';',
        'border-radius:10px;',
        'border-left:3px solid ' + T.elec + ';',
        'padding:12px;',
        'box-sizing:border-box;',
        'display:flex;flex-direction:column;gap:8px;',
      ].join('');
      document.body.appendChild(card);
      tipNumpadCard = card;

      // Check label
      var checkLbl = document.createElement('div');
      checkLbl.textContent   = chk.checkLabel || checkNum({ order_id: chk.checkId }) || 'CHK';
      checkLbl.style.cssText = 'font-family:' + T.fb + ';font-size:' + T.fsB3 + ';color:' + T.moon + ';letter-spacing:0.1em;text-align:center;' + ";font-weight:" + T.fwBold + ";";
      card.appendChild(checkLbl);

      // Pre-populate cents string for ADJ tab
      var startCents = (tipFilter === 'ADJ' && chk.adjusted && chk.tip)
        ? String(Math.round(chk.tip * 100)) : '';

      // buildNumpad — keys sized to fit 233px inner width
      // keyW=67: 67×3 + 8×2 + 8×2 + 5×2 = 233px
      var numpad = buildNumpad({
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
        displayFormat: function(p) {
          return '$' + (parseInt(p || '0', 10) / 100).toFixed(2);
        },
        canSubmit: function() { return true; },
        onSubmit: function(pin) {
          var tipVal = parseInt(pin || '0', 10) / 100;
          var checks = state.salesData.checks || [];
          var target = null;
          for (var i = 0; i < checks.length; i++) {
            if (checks[i].checkId === chk.checkId || checks[i].id === chk.checkId) {
              target = checks[i];
              break;
            }
          }
          var prevTip = target ? target.tip : undefined;
          var prevAdj = target ? target.adjusted : undefined;
          if (target) { target.tip = tipVal; target.adjusted = true; }
          closeTipNumpad();
          renderTipQueue();
          fetchWithTimeout('/api/v1/checks/' + chk.checkId + '/tip', {
            method:  'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body:    JSON.stringify({ tip: tipVal, adjusted: true }),
          }, 10000).catch(function() {
            if (target) { target.tip = prevTip; target.adjusted = prevAdj; }
            showToast('Tip update failed — please try again', { bg: T.verm, duration: 3000 });
            if (state.el) renderTipQueue();
          });
        },
        onCancel: function() {
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
    filterBtn.addEventListener('pointerup', function() {
      state.filter      = FILTER_CYCLE[state.filter];
      state.selectedIds = [];
      state.selectedAt  = {};
      var fc = FILTER_COLORS[state.filter];
      state._refs.filterBtn.textContent = FILTER_DISPLAY[state.filter] || state.filter;
      state._refs.filterBtn.setColor(fc.color, fc.dark);
      renderTiles();
    });

    // ─────────────────────────────────────────────
    //  TIP QUEUE TABS
    // ─────────────────────────────────────────────
    tabUnadj.addEventListener('pointerup', function() {
      tipFilter = 'UNADJ';
      tabUnadj.style.color        = T.green;
      tabUnadj.style.borderBottom = '2px solid ' + T.green;
      tabAdj.style.color          = T.moon;
      tabAdj.style.borderBottom   = '2px solid transparent';
      renderTipQueue();
    });

    tabAdj.addEventListener('pointerup', function() {
      tipFilter = 'ADJ';
      tabAdj.style.color          = T.green;
      tabAdj.style.borderBottom   = '2px solid ' + T.green;
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
    checkoutBtn.addEventListener('pointerup', function() {
      SceneManager.mountWorking('server-checkout', { staff: state.emp });
    });

    // ─────────────────────────────────────────────
    //  DATA + REFRESH
    // ─────────────────────────────────────────────
    function refresh() {
      if (state._refreshing || !state.el) return;
      state._refreshing = true;
      fetchAllData(state).then(function() {
        state._refreshing = false;
        if (!state.el) return;
        var alive = {};
        (state.allOrders || []).forEach(function(o) { alive[o.order_id] = true; });
        state.selectedIds = (state.selectedIds || []).filter(function(id) { return alive[id]; });
        Object.keys(state.selectedAt || {}).forEach(function(id) {
          if (!alive[id]) delete state.selectedAt[id];
        });
        try { renderTiles();    } catch(e) { console.warn('[sl] renderTiles threw:', e); }
        try { renderPreview();  } catch(e) { console.warn('[sl] renderPreview threw:', e); }
        try { renderTipQueue(); } catch(e) { console.warn('[sl] renderTipQueue threw:', e); }
        try { renderStats(); } catch(e) { console.warn('[sl] renderStats threw:', e); }
      }).catch(function() { state._refreshing = false; });
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