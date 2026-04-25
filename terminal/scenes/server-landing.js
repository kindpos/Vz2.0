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

// ── Filter cycle ──────────────────────────────────
var FILTER_CYCLE  = { OPEN: 'CLOSED', CLOSED: 'VOID', VOID: 'OPEN' };
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

// ── Data fetching ─────────────────────────────────
function fetchAllData(state) {
  var sid = encodeURIComponent((state.emp || {}).id || '');
  return Promise.all([
    fetch('/api/v1/orders/day-summary?server_id=' + sid)
      .then(function(r) { return r.ok ? r.json() : Promise.reject(r.status); }).catch(function() { return {}; }),
    fetch('/api/v1/orders?server_id=' + sid)
      .then(function(r) { return r.ok ? r.json() : Promise.reject(r.status); }).catch(function() { return []; }),
    fetch('/api/v1/server/shift/table-stats?server_id=' + sid)
      .then(function(r) { return r.ok ? r.json() : Promise.reject(r.status); }).catch(function() { return {}; }),
    fetch('/api/v1/server/shift/checkout-status?server_id=' + sid)
      .then(function(r) { return r.ok ? r.json() : Promise.reject(r.status); }).catch(function() { return { openChecks: 0, unadjustedTips: 0 }; }),
    fetch('/api/v1/config/tipout')
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
function buildCheckTile(order, onClick) {
  var tile = buildActionCard({
    accent: T.border,
    onClick: onClick
  });
  tile.style.width          = '110px';
  tile.style.height         = '90px';
  tile.style.flexShrink     = '0';
  tile.style.display        = 'flex';
  tile.style.flexDirection  = 'column';
  tile.style.justifyContent = 'space-between';
  tile.style.padding        = '12px 14px';

  var idEl = document.createElement('div');
  idEl.textContent   = checkNum(order);
  idEl.style.cssText = 'font-family:' + T.fh + ';font-size:14px;font-weight:700;color:' + T.text + ';letter-spacing:0.06em;';

  var guestEl = document.createElement('div');
  var guests = order.seat_count || order.guest_count || order.covers || 1;
  guestEl.textContent   = 'x' + guests;
  guestEl.style.cssText = 'font-family:' + T.fb + ';font-size:12px;color:' + T.text + ';opacity:0.6;';

  var totalEl = document.createElement('div');
  var total = order.total != null ? fmt(order.total) : fmt((order.total_cents || 0) / 100);
  totalEl.textContent   = total;
  totalEl.style.cssText = 'font-family:' + T.fh + ';font-size:16px;font-weight:700;color:' + T.gold + ';text-shadow:0 0 8px ' + hexToRgba(T.gold, 0.35) + ';';

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
  plus.style.cssText = 'font-family:' + T.fh + ';font-size:32px;color:' + hexToRgba(T.groups.landing.newCheckBorder, 0.6) + ';pointer-events:none;';
  plus.textContent = '+';
  tile.appendChild(plus);

  return tile;
}


// ── Tip row ───────────────────────────────────────
function buildTipRow(chk, onTap) {
  var adjusted = chk.adjusted;
  var row = document.createElement('div');
  row.style.cssText = [
    'display:flex;align-items:center;gap:10px;',
    'padding:8px 6px;border-radius:6px;cursor:pointer;',
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
  idEl.style.cssText = 'font-family:' + T.fh + ';font-size:12px;color:' + T.text + ';flex:1;letter-spacing:0.06em;';

  var amtEl = document.createElement('div');
  amtEl.textContent   = fmt(chk.amount || 0);
  amtEl.style.cssText = 'font-family:' + T.fb + ';font-size:11px;color:' + T.text + ';opacity:0.7;';

  var tipEl = document.createElement('div');
  tipEl.textContent   = adjusted ? fmt(chk.tip || 0) : '—';
  tipEl.style.cssText = 'font-family:' + T.fb + ';font-size:11px;min-width:44px;text-align:right;color:' + (adjusted ? T.green : T.border) + ';';

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
    emp:         null,
    _refreshing: false,
    el:          null,

    // Refs to live-update DOM elements
    _refs: {},
  },

  render: function(container, params, state) {
    state.emp = params.staff || params.emp || params || {};
    state.el  = container;

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
    ].join('');
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

    // Tips header
    var tipHdr = document.createElement('div');
    tipHdr.style.cssText = 'padding:12px 14px 8px;border-bottom:1px solid ' + hexToRgba(T.border, 0.4) + ';flex-shrink:0;';

    var tipHdrRow = document.createElement('div');
    tipHdrRow.style.cssText = 'display:flex;justify-content:space-between;align-items:baseline;margin-bottom:4px;';
    var tipHdrLabel = buildSectionLabel('Tip Queue', T.text);
    var unadjBadge  = document.createElement('div');
    unadjBadge.style.cssText = 'font-family:' + T.fb + ';font-size:14px;color:' + T.verm+ ';letter-spacing:0.1em;display:none;';
    tipHdrRow.appendChild(tipHdrLabel);
    tipHdrRow.appendChild(unadjBadge);
    tipHdr.appendChild(tipHdrRow);

    var tipsTotal = document.createElement('div');
    tipsTotal.style.cssText = 'font-family:' + T.fh + ';font-size:28px;font-weight:700;color:' + T.gold + ';text-shadow:0 0 14px ' + hexToRgba(T.gold, 0.4) + ';';
    tipsTotal.textContent   = '$0.00';
    tipHdr.appendChild(tipsTotal);
    tipResult.appendChild(tipHdr);

    // Scrollable tip rows
    var tipList = document.createElement('div');
    tipList.style.cssText = 'flex:1;overflow-y:auto;padding:6px 10px;display:flex;flex-direction:column;gap:2px;';
    tipResult.appendChild(tipList);

    // Checkout pill — inside tip card footer, no float positioning
    var checkoutBtn = buildPillButton({ label: 'CHECKOUT', color: T.green, darkBg: T.greenDk });
    checkoutBtn.style.marginTop = '10px';
    checkoutBtn.style.width     = '100%';
    tipResult.appendChild(checkoutBtn);

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
    tileGrid.style.cssText = 'display:flex;flex-wrap:wrap;gap:10px;align-content:flex-start;height:100%;flex:1;overflow-y:auto;';
    gridResult.appendChild(tileGrid);

    // Filter footer row — inside grid card, no float positioning
    var gridFooter = document.createElement('div');
    gridFooter.style.cssText = [
      'display:flex;justify-content:flex-end;',
      'padding:8px 0 0;flex-shrink:0;',
      'border-top:1px solid rgba(255,255,255,0.06);',
    ].join('');
    gridResult.appendChild(gridFooter);

    // OPEN/CLOSED/VOID pill filter — sits in the grid card footer
    var filterBtn = buildPillButton({ label: 'OPEN', color: T.green, darkBg: T.greenDk, fontSize: T.fsB3 });
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
      tipList, tipsTotal, unadjBadge, tipResult, checkoutBtn, filterBtn,
      tipSparkBg, scGuests, scAvg, scTables, scTurn, srvSalesOverview,
    };

    // ─────────────────────────────────────────────
    //  RENDER FUNCTIONS
    // ─────────────────────────────────────────────

    function renderTiles() {
      var r = state._refs;
      r.tileGrid.innerHTML = '';
      var visible = ordersByFilter(state.allOrders, state.filter);
      visible.forEach(function(order) {
        r.tileGrid.appendChild(buildCheckTile(order, function() {
          SceneManager.mountWorking('check-overview', {
            checkId:       order.order_id,
            returnLanding: 'server-landing',
            employeeId:    state.emp ? state.emp.id   : null,
            employeeName:  state.emp ? state.emp.name : null,
            pin:           state.emp ? state.emp.pin  : null,
          });
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
        empty.style.cssText = 'font-family:' + T.fb + ';font-size:14px;color:' + T.border + ';letter-spacing:0.14em;padding:8px 4px;';
        r.tileGrid.appendChild(empty);
      }
    }


    function renderTips() {
      var r     = state._refs;
      var checks = getClosedChecks(state.salesData);
      r.tipList.innerHTML = '';

      if (checks.length === 0) {
        var empty = document.createElement('div');
        empty.textContent   = 'No closed checks yet';
        empty.style.cssText = 'font-family:' + T.fb + ';font-size:14px;color:' + T.border + ';text-align:center;padding:16px 0;letter-spacing:0.12em;';
        r.tipList.appendChild(empty);
        r.tipsTotal.textContent = '$0.00';
        r.unadjBadge.style.display = 'none';
        updateCheckout(0, checks.length);
        return;
      }

      var total  = 0;
      var unadj  = 0;
      checks.forEach(function(chk) {
        if (chk.adjusted) total += (chk.tip || 0);
        else unadj++;
        r.tipList.appendChild(buildTipRow(chk, function(c) {
          SceneManager.openTransactional('co-adjust-single', {
            check: c,
            onDone: function() { refresh(); },
          });
        }));
      });

      r.tipsTotal.textContent = fmt(total);
      r.tipResult.setAccent(unadj > 0 ? T.verm : T.groups.landing.infoAccent);
      r.unadjBadge.textContent   = unadj > 0 ? (unadj + ' unadj') : '';
      r.unadjBadge.style.display = unadj > 0 ? 'block' : 'none';

      updateCheckout(unadj, state.checkoutStatus.openChecks || ordersByFilter(state.allOrders, 'OPEN').length);
    }

    function updateCheckout(unadj, openCount) {
      var btn = state._refs.checkoutBtn;
      var canGo = openCount === 0 && unadj === 0;
      if (canGo) {
        btn.setColor(T.green, T.greenDk);
        btn.textContent = 'Checkout';
      } else if (unadj > 0) {
        btn.setColor(T.verm, T.vermDk);
        btn.textContent = unadj + ' Unadj';
      } else {
        btn.setColor(T.border, darkenHex(T.border, 0.3));
        btn.textContent = 'Open Checks';
      }
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
    //  FILTER TOGGLE
    // ─────────────────────────────────────────────
    filterBtn.addEventListener('pointerup', function() {
      state.filter      = FILTER_CYCLE[state.filter];
      var fc = FILTER_COLORS[state.filter];
      state._refs.filterBtn.textContent = state.filter;
      state._refs.filterBtn.setColor(fc.color, fc.dark);
      renderTiles();
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
        try { renderTiles(); } catch(e) { console.warn('[sl] renderTiles threw:', e); }
        try { renderTips();  } catch(e) { console.warn('[sl] renderTips threw:', e); }
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
      SceneManager.off('order:updated', refresh);
      SceneManager.off('order:closed',  refresh);
      SceneManager.off('tip:adjusted',  refresh);
    };
  },
});