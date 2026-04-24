// ═══════════════════════════════════════════════════
//  KINDpos Terminal — Manager Landing  (Vz2.0)
//  Nice. Dependable. Yours.
// ═══════════════════════════════════════════════════

import { defineScene, SceneManager } from '../scene-manager.js';
import { T }                          from '../../common/tokens.js';
import { entReport }                  from '../entomology-client.js';
import {
  buildStaticCard,
  buildNavCard,
  buildActionCard,
  buildPillButton,
  buildSectionLabel,
  hexToRgba,
  lightenHex,
  darkenHex,
} from '../theme-manager.js';
import { showToast } from '../components.js';
import {
  buildSalesOverview,
  buildLineCard,
  buildCOBCard,
} from '../charts.js';

// ── Input-ignore window ───────────────────────────
// Suppress bleed-through taps on the next scene or on the freshly rendered
// tile grid after a scene push. Scene pushes set this to Date.now()+200;
// handlers bail while the flag is in the future.
var _inputIgnoreUntil = 0;

// ── Helpers ───────────────────────────────────────
function fmt(n) {
  n = n || 0;
  var abs = Math.abs(n).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return (n < 0 ? '\u2212$' : '$') + abs;
}

function checkNum(order) {
  return order.check_number || ('C-' + String(order.order_id).slice(0, 3).toUpperCase());
}

function ordersByFilter(allOrders, filter, serverId) {
  return (allOrders || []).filter(function(o) {
    var statusOk = false;
    if (filter === 'OPEN')   statusOk = o.status === 'open';
    if (filter === 'CLOSED') statusOk = o.status === 'closed' || o.status === 'paid';
    if (filter === 'VOID')   statusOk = o.status === 'voided';
    if (!statusOk) return false;
    if (serverId && o.server_id !== serverId) return false;
    return true;
  });
}

// ── Filter cycles ─────────────────────────────────
var STATUS_CYCLE  = { OPEN: 'CLOSED', CLOSED: 'VOID', VOID: 'OPEN' };
var STATUS_COLORS = {
  OPEN:   { color: T.green, dark: T.greenDk },
  CLOSED: { color: T.gold,  dark: T.goldDk  },
  VOID:   { color: T.verm,  dark: T.vermDk  },
};

// ── Data fetching ─────────────────────────────────
function fetchAllData(state) {
  var today = new Date();
  var dateStr = today.getFullYear() + '-' +
    String(today.getMonth() + 1).padStart(2, '0') + '-' +
    String(today.getDate()).padStart(2, '0');

  return Promise.all([
    fetch('/api/v1/orders/day-summary')
      .then(function(r) { return r.ok ? r.json() : Promise.reject(r.status); }).catch(function() { return {}; }),
    fetch('/api/v1/orders')
      .then(function(r) { return r.ok ? r.json() : Promise.reject(r.status); }).catch(function() { return []; }),
    fetch('/api/v1/servers/clocked-in')
      .then(function(r) { return r.ok ? r.json() : Promise.reject(r.status); }).catch(function() { return { staff: [] }; }),
    fetch('/api/v1/reports/labor-summary?date=' + dateStr)
      .then(function(r) { return r.ok ? r.json() : Promise.reject(r.status); }).catch(function() { return {}; }),
  ]).then(function(results) {
    var daySummary  = results[0] || {};
    var orders      = Array.isArray(results[1]) ? results[1] : [];
    var staffResult = results[2] || {};
    var laborData   = results[3] || {};

    _wireSalesData(state, daySummary, orders, laborData);
    _wireOrders(state, orders);
    _wireStaffData(state, staffResult, orders, laborData);
    _wireCloseDayData(state, daySummary);
    _wireServerColors(state, staffResult);
  });
}

function _wireSalesData(state, day, orders, labor) {
  // Build sparkline from dayparts (AM / PM / Late), padded to 7 points.
  var sparkData = null;
  var parts = day.dayparts || [];
  if (parts.length > 0) {
    var pts = parts.map(function(p) { return p.sales || 0; });
    while (pts.length < 7) { pts.push(pts[pts.length - 1] || 0); }
    sparkData = pts.slice(0, 7);
  }

  state.salesData = {
    net_sales:     day.net_sales    || 0,
    cash_total:    day.cash_total   || 0,
    card_total:    day.card_total   || 0,
    avg_check:     day.check_avg    || day.avg_check || 0,
    total_covers:  day.guest_count  || 0,
    active_checks: (orders || []).filter(function(o) { return o.status === 'open'; }).length,
    labor_cob:     labor.cob_percent || 0,
    labor_hours:   labor.total_hours || 0,
    labor_cost:    labor.labor_cost  || 0,
    staff_count:   labor.staff_count || 0,
    sparkData:     sparkData,
  };
}

function _wireOrders(state, orders) {
  state.allOrders = (orders || []).map(function(o) {
    return {
      order_id:      o.order_id,
      check_number:  o.check_number || ('C-' + String(o.order_id).slice(0, 3).toUpperCase()),
      server_id:     o.server_id   || '',
      server_name:   o.server_name || '',
      customer_name: o.customer_name || o.table || '',
      status:        o.status,
      items:         o.items    || [],
      payments:      o.payments || [],
      total:         o.total    || o.subtotal || 0,
      seat_count:    o.seat_count || o.covers || o.guest_count || 1,
    };
  });
}

function _wireStaffData(state, staffResult, orders, laborData) {
  var staff = (staffResult.staff || []);
  var laborStaff = (laborData || {}).staff_details || (laborData || {}).staff || [];

  state.staffData = {
    servers: staff.map(function(s) {
      var myOrders  = (orders || []).filter(function(o) { return o.server_id === s.employee_id; });
      var open      = myOrders.filter(function(o) { return o.status === 'open'; });
      var closed    = myOrders.filter(function(o) { return o.status === 'closed' || o.status === 'paid'; });
      var unadj = 0;
      closed.forEach(function(o) {
        (o.payments || []).forEach(function(p) {
          if (p.method === 'card' && p.status === 'confirmed' && !p.tip_adjusted) unadj++;
        });
      });

      var lab = laborStaff.find(function(l) { return l.employee_id === s.employee_id; });
      var hours = (lab && typeof lab.hours === 'number') ? lab.hours : 1;

      return {
        id:             s.employee_id,
        name:           s.employee_name || s.name || '',
        open_tables:    open.length,
        closed_checks:  closed.length,
        unadj_tips:     unadj,
        checked_out:    false,
        hours:          hours,
      };
    }),
  };
}

function _wireCloseDayData(state, day) {
  var servers = ((state.staffData || {}).servers || []);
  var pending = servers.filter(function(s) { return !s.checked_out; }).length;
  var allOut  = servers.length > 0 && pending === 0;
  // Use the backend-computed count from day-summary — it correctly checks
  // whether a TIP_ADJUSTED event exists per payment. The per-server
  // p.tip_amount == null check was always false (API returns 0.0, not null).
  var unadj  = typeof day.unadjusted_tips === 'number' ? day.unadjusted_tips : 0;
  var allAdj  = unadj === 0;
  state.closeDayData = {
    all_checked_out:   allOut,
    pending_count:     pending,
    all_tips_adjusted: allAdj,
    unadjusted_count:  unadj,
    batch_ready:       allOut && allAdj,
  };
}

function _wireServerColors(state, staffResult) {
  var staff = staffResult.staff || [];
  state.serverColorMap = {};
  staff.forEach(function(s, i) {
    state.serverColorMap[s.employee_id] = T.srvPalette[i % T.srvPalette.length];
  });
}

// ── Check tile ────────────────────────────────────
function _buildCheckTile(order, isSelected, srvColor, onClick, onLongPress, filterColor) {
  var tile = buildActionCard({
    accent: isSelected ? T.gold : (filterColor || srvColor || T.moon)
  });
  tile.style.width          = '140px';
  tile.style.height         = '120px';
  tile.style.flexShrink     = '0';
  tile.style.display        = 'flex';
  tile.style.flexDirection  = 'column';
  tile.style.alignItems     = 'center';
  tile.style.justifyContent = 'center';
  tile.style.gap            = '4px';
  tile.style.padding        = '10px 12px';
  tile.style.textAlign      = 'center';
  tile.style.background     = isSelected ? hexToRgba(T.gold, 0.12) : T.card;
  tile.style.pointerEvents  = 'auto';
  tile.style.touchAction    = 'manipulation';

  var idEl = document.createElement('div');
  idEl.textContent   = checkNum(order);
  idEl.style.cssText = 'font-family:' + T.fh + ';font-size:18px;font-weight:700;color:' + (isSelected ? T.gold : T.text) + ';letter-spacing:0.06em;';

  var srvEl = document.createElement('div');
  var srvName = (order.server_name || order.server_id || '').split(' ')[0].toUpperCase();
  srvEl.textContent   = srvName;
  srvEl.style.cssText = 'font-family:' + T.fb + ';font-size:12px;color:' + (srvColor || T.elec) + ';opacity:0.9;letter-spacing:0.04em;';

  var cvrEl = document.createElement('div');
  cvrEl.textContent   = 'x' + (order.seat_count || 1);
  cvrEl.style.cssText = 'font-family:' + T.fb + ';font-size:12px;color:' + T.text + ';opacity:0.55;';

  var amtEl = document.createElement('div');
  amtEl.textContent   = fmt(order.total || 0);
  amtEl.style.cssText = 'font-family:' + T.fh + ';font-size:22px;font-weight:700;color:' + T.gold + ';text-shadow:0 0 8px ' + hexToRgba(T.gold, 0.3) + ';margin-top:2px;';

  tile.appendChild(idEl);
  tile.appendChild(srvEl);
  tile.appendChild(cvrEl);
  tile.appendChild(amtEl);

  // Tap unselected → select. Tap already-selected → onClick (opens overview).
  // Long-press (550ms) → ensure selected, then onLongPress (opens edit panel).
  var lpTimer      = null;
  var didLongPress = false;
  var armed        = false;

  tile.addEventListener('pointerdown', function(e) {
    if (_inputIgnoreUntil > Date.now()) return;   // scene-push bleed-through guard
    armed        = true;
    didLongPress = false;
    lpTimer = window.setTimeout(function() {
      if (!armed) return;
      didLongPress = true;
      lpTimer      = null;
      if (e && e.preventDefault) e.preventDefault();  // suppress synthetic click
      if (onLongPress) onLongPress(order);
    }, 550);
  });

  tile.addEventListener('pointerup', function(e) {
    if (lpTimer) { clearTimeout(lpTimer); lpTimer = null; }
    var wasLong = didLongPress;
    armed        = false;
    didLongPress = false;
    if (wasLong) {
      // Consume touchend so no ghost tap fires on the next scene
      if (e && e.preventDefault)  e.preventDefault();
      if (e && e.stopPropagation) e.stopPropagation();
      return;
    }
    if (onClick) onClick();
  });

  tile.addEventListener('pointerleave', function() {
    if (lpTimer) { clearTimeout(lpTimer); lpTimer = null; }
    armed        = false;
    didLongPress = false;
  });
  tile.addEventListener('pointercancel', function() {
    if (lpTimer) { clearTimeout(lpTimer); lpTimer = null; }
    armed        = false;
    didLongPress = false;
  });

  return tile;
}

function _buildNewTile(onClick) {
  var tile = document.createElement('div');
  tile.style.cssText = 'width:110px;height:90px;flex-shrink:0;border:1px dashed ' + hexToRgba(T.green, 0.4) + ';border-radius:10px;display:flex;align-items:center;justify-content:center;cursor:pointer;transition:background 0.1s;';
  var plus = document.createElement('span');
  plus.style.cssText = 'font-family:' + T.fh + ';font-size:28px;color:' + hexToRgba(T.green, 0.5) + ';pointer-events:none;';
  plus.textContent = '+';
  tile.appendChild(plus);
  tile.addEventListener('pointerdown',  function() { tile.style.background = hexToRgba(T.green, 0.08); });
  tile.addEventListener('pointerup',    function() { tile.style.background = 'transparent'; if (onClick) onClick(); });
  tile.addEventListener('pointerleave', function() { tile.style.background = 'transparent'; });
  return tile;
}

// ── Check preview ─────────────────────────────────
function _buildPreview(orders, allOrders) {
  var wrap = document.createElement('div');
  wrap.style.cssText = 'display:flex;flex-direction:column;gap:4px;';

  var total = orders.reduce(function(s, o) { return s + (o.total || 0); }, 0);
  var hdr = document.createElement('div');
  hdr.style.cssText = 'display:flex;justify-content:space-between;align-items:baseline;padding-bottom:6px;border-bottom:1px solid ' + hexToRgba(T.border, 0.4) + ';margin-bottom:4px;';
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
      sub.style.cssText = 'font-family:' + T.fh + ';font-size:11px;color:' + T.green + ';letter-spacing:0.06em;margin-top:4px;';
      sub.textContent   = checkNum(order) + (order.server_name ? ' · ' + order.server_name.split(' ')[0] : '');
      wrap.appendChild(sub);
    } else if (order.server_name) {
      var srvLbl = document.createElement('div');
      srvLbl.style.cssText = 'font-family:' + T.fb + ';font-size:11px;color:' + T.elec + ';margin-bottom:4px;';
      srvLbl.textContent   = order.server_name.toUpperCase();
      wrap.appendChild(srvLbl);
    }

    (order.items || []).slice(0, 3).forEach(function(item) {
      var row = document.createElement('div');
      row.style.cssText = 'display:flex;justify-content:space-between;padding:3px 0;border-bottom:1px solid ' + hexToRgba(T.border, 0.2) + ';';
      var nm  = document.createElement('span'); nm.style.cssText  = 'font-family:' + T.fb + ';font-size:11px;color:' + T.text + ';'; nm.textContent  = item.name || 'Item';
      var pr  = document.createElement('span'); pr.style.cssText  = 'font-family:' + T.fb + ';font-size:11px;color:' + T.gold + ';';  pr.textContent  = fmt(item.price || 0);
      row.appendChild(nm); row.appendChild(pr);
      wrap.appendChild(row);
    });
    if ((order.items || []).length > 3) {
      var more = document.createElement('div');
      more.style.cssText = 'font-family:' + T.fb + ';font-size:10px;color:' + T.text + ';opacity:0.5;padding-top:2px;';
      more.textContent   = '+ ' + (order.items.length - 3) + ' more';
      wrap.appendChild(more);
    }
  });

  return wrap;
}

// ── Server checkout tile ──────────────────────────
// `state` is the scene state object; _buildServerRow used to read it from
// the closure, but it's a module-level function so the reference was
// undefined at call time — every renderServerList call threw
// "ReferenceError: state is not defined" and the list stayed empty.
// Thread state in explicitly so the color map is reachable.
function _buildServerRow(state, srv, onClick) {
  var srvColor = state.serverColorMap[srv.id] || T.elec;
  var isDone = srv.checked_out;

  var tile = buildActionCard({
    accent:      srvColor,
    showChevron: false,
    onClick:     null,
  });

  tile.style.width          = '140px';
  tile.style.height         = '90px';
  tile.style.flexShrink     = '0';
  tile.style.display        = 'flex';
  tile.style.flexDirection  = 'column';
  tile.style.alignItems     = 'center';
  tile.style.justifyContent = 'center';
  tile.style.gap            = '4px';
  tile.style.padding        = '10px 12px';
  tile.style.textAlign      = 'center';

  tile.addEventListener('pointerup', function() {
    if (onClick) onClick(srv);
  });

  // Server name
  var name = document.createElement('div');
  name.style.cssText = 'font-family:' + T.fh + ';font-size:16px;font-weight:700;color:' + T.text + ';';
  name.textContent   = srv.name.split(' ')[0].toUpperCase();
  tile.appendChild(name);

  // Status
  var status = document.createElement('div');
  status.style.cssText = 'font-family:' + T.fb + ';font-size:10px;font-weight:700;letter-spacing:0.04em;';
  if (isDone) {
    status.style.color = T.elec;
    status.textContent = 'CHECKED OUT';
  } else {
    status.style.color = (srv.open_tables > 0 || srv.unadj_tips > 0) ? T.verm : T.green;
    status.textContent = srv.open_tables + ' OPEN \u00B7 ' + srv.unadj_tips + ' UNADJ';
  }
  tile.appendChild(status);

  return tile;
}

// ═══════════════════════════════════════════════════
//  SCENE
// ═══════════════════════════════════════════════════

defineScene({
  name: 'manager-landing',

  state: {
    emp:             null,
    allOrders:       [],
    salesData:       null,
    staffData:       null,
    closeDayData:    null,
    serverColorMap:  {},
    filter:          'OPEN',
    filteredServer:  null,  // null = ALL SERVERS
    selectedIds:     [],
    _refreshing:     false,
    el:              null,
    _refs:           {},
  },

  render: function(container, params, state) {
    state.emp = params.staff || params.emp || params || {};
    state.el  = container;

    // Suppress any tap that lands in the first 200ms of this scene —
    // the previous scene's touchend can fall through onto a freshly rendered
    // tile and fire onClick before the user sees the new screen.
    _inputIgnoreUntil = Date.now() + 200;

    // ── Root grid ──────────────────────────────────
    var root = document.createElement('div');
    root.style.cssText = [
      'position:absolute;inset:0;background:' + T.bg + ';',
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
    leftCol.style.cssText = 'grid-column:1;grid-row:1/3;display:flex;flex-direction:column;justify-content:flex-end;gap:10px;overflow:visible;';
    root.appendChild(leftCol);

    // ── Heatmap + Check Preview share same space ──
    // Preview is absolutely positioned over heatmap, appears on tile select
    var topSlot = document.createElement('div');
    topSlot.style.cssText = 'flex:1;position:relative;overflow:hidden;border-radius:10px;';
    topSlot.style.borderLeft   = '5px solid ' + lightenHex(T.bg, 0.08);
    topSlot.style.borderTop    = '5px solid ' + lightenHex(T.bg, 0.08);
    topSlot.style.borderRight  = '5px solid ' + darkenHex(T.bg, 0.2);
    topSlot.style.borderBottom = '5px solid ' + darkenHex(T.bg, 0.2);
    topSlot.style.boxShadow    = 'inset 0 1px 0 rgba(255,255,255,0.06), 3px 5px 0 rgba(0,0,0,0.55)';
    topSlot.style.background   = T.well;
    topSlot.style.borderRadius = '12px';
    leftCol.appendChild(topSlot);

    // ── Revenue Line Card (replaces heatmap placeholder) ──
    var lineCardInst = buildLineCard({
      label:    '7-Day Revenue',
      value:    '$0.00',
      delta:    '',
      thisWeek: [0,0,0,0,0,0,0],
      lastWeek: [0,0,0,0,0,0,0],
    });
    lineCardInst.wrap.style.cssText += 'position:absolute;inset:0;z-index:1;';
    topSlot.appendChild(lineCardInst.wrap);

    // Check preview (absolutely positioned over heatmap, hidden by default)
    var previewSlide = document.createElement('div');
    previewSlide.style.cssText = [
      'z-index:2;',
      'position:absolute;inset:0;',
      'background:' + T.card + ';',
      'border-left:4px solid ' + T.green + ';',
      'border-radius:10px;',
      'box-shadow:0 4px 16px rgba(0,0,0,0.28);',
      'padding:12px 14px;',
      'display:none;flex-direction:column;',
      'overflow:hidden;',
    ].join('');
    topSlot.appendChild(previewSlide);

    var prevLabel = buildSectionLabel('Check Preview');
    prevLabel.style.marginBottom = '10px';
    previewSlide.appendChild(prevLabel);

    var prevContent = document.createElement('div');
    prevContent.style.flex = '1';
    previewSlide.appendChild(prevContent);

    // Action buttons grid
    var actGrid = document.createElement('div');
    actGrid.style.cssText = 'display:none;grid-template-columns:1fr 1fr;gap:5px;margin-top:8px;';
    var _prevOps = [
      { label: 'Print',    color: T.greenWarm, dark: T.greenWarmDk },
      { label: 'Pay',      color: T.gold,      dark: T.goldDk      },
      { label: 'Discount', color: T.elec,      dark: T.elecDk      },
      { label: 'Void',     color: T.verm,      dark: T.vermDk      },
    ];
    _prevOps.forEach(function(op) {
      var b = buildPillButton({ label: op.label, color: op.color, darkBg: op.dark,
        onClick: function() { _handleEditAction(op.label, state); },
      });
      b.style.cssText += 'font-size:14px;padding:8px 10px;';
      actGrid.appendChild(b);
    });
    previewSlide.appendChild(actGrid);

    // Dummy wrap ref for backward compat
    var prevResult = { wrap: previewSlide, card: previewSlide };

    // ── Sales Overview (flex — takes remaining space) ──
    var salesOuter = document.createElement('div');
    salesOuter.style.cssText = 'flex-shrink:0;height:250px;position:relative;overflow:visible;display:flex;flex-direction:column;';
    leftCol.appendChild(salesOuter);

    var salesResult = buildStaticCard({ accent: T.gold });
    salesResult.style.flex    = '1';
    salesResult.style.padding = '20px 16px';
    salesResult.style.display = 'flex';
    salesResult.style.flexDirection = 'column';
    salesResult.style.gap = '18px';
    salesResult.style.height = '100%';
    salesOuter.appendChild(salesResult);

    var salesLabel = buildSectionLabel('Sales Overview', T.text);
    salesLabel.style.fontSize = '16px';
    salesResult.appendChild(salesLabel);

    var salesOverview = buildSalesOverview({ netSales: 0, cash: 0, card: 0 });
    salesResult.appendChild(salesOverview.wrap);

    // ─────────────────────────────────────────────
    //  CHECK GRID (cols 2-3, row 1)
    // ─────────────────────────────────────────────
    // ── Check grid (cols 2-3, row 1) ──
    var gridOuter = document.createElement('div');
    gridOuter.style.cssText = 'grid-column:2/4;grid-row:1;position:relative;overflow:hidden;';
    root.appendChild(gridOuter);

    var gridResult = buildStaticCard({ accent: STATUS_COLORS['OPEN'].color });
    gridResult.style.height    = '100%';
    gridResult.style.padding   = '0';
    gridResult.style.minHeight = '0';
    gridResult.style.boxSizing = 'border-box';
    gridResult.style.overflow  = 'hidden';
    gridResult.style.display   = 'flex';
    gridResult.style.flexDirection = 'column';
    gridOuter.appendChild(gridResult);

    var tileGrid = document.createElement('div');
    tileGrid.style.cssText = 'display:flex;flex-wrap:wrap;gap:10px;align-content:flex-start;flex:1;min-height:0;padding:14px 14px 10px;overflow-y:auto;scrollbar-width:none;';
    gridResult.appendChild(tileGrid);

    // Filter footer — sits inside the card at the bottom right
    var filterFooter = document.createElement('div');
    filterFooter.style.cssText = [
      'display:flex;align-items:center;justify-content:space-between;',
      'padding:8px 14px 10px;flex-shrink:0;',
      'border-top:1px solid rgba(255,255,255,0.06);',
    ].join('');
    gridResult.appendChild(filterFooter);

    // Left side of footer: Edit/Close button (hidden until selection)
    var footerLeft = document.createElement('div');
    footerLeft.style.cssText = 'display:flex;align-items:center;';
    filterFooter.appendChild(footerLeft);

    // Right side of footer: filter tabs
    var footerRight = document.createElement('div');
    footerRight.style.cssText = 'display:flex;align-items:center;gap:8px;';
    filterFooter.appendChild(footerRight);

    // Edit panel — appended to root, covers full bottom area cols 2-3
    var editPanel = document.createElement('div');
    editPanel.style.cssText = [
      'position:absolute;',
      'left:320px;right:10px;bottom:10px;',
      'height:270px;',
      'background:' + T.card + ';',
      'border:2px solid ' + T.gold + ';',
      'border-radius:10px;',
      'padding:22px;',
      'display:grid;grid-template-columns:repeat(3,1fr);align-content:center;gap:18px;',
      'transform:translateY(calc(100% + 20px));',
      'transition:transform 0.22s ease;',
      'z-index:20;',
    ].join('');
    root.appendChild(editPanel);

    // Grouped by color family: cyan row (structural/modifier ops), green row (output/access)
    var _editOps = [
      { label: 'Merge',    color: T.elec,   dark: T.elecDk   },
      { label: 'Split',    color: T.elec,   dark: T.elecDk   },
      { label: 'Discount', color: T.elec,   dark: T.elecDk   },
      { label: 'Transfer', color: T.green,  dark: T.greenDk  },
      { label: 'Print',    color: T.green,  dark: T.greenDk  },
      { label: 'Open',     color: T.green,  dark: T.greenDk  },
    ];

    _editOps.forEach(function(op) {
      var b = buildPillButton({
        label:   op.label,
        color:   op.color,
        darkBg:  op.dark,
        onClick: function() { _handleEditAction(op.label, state); },
      });
      b.style.cssText += 'width:100%;font-size:18px;padding:16px 8px;text-align:center;letter-spacing:0.1em;';
      editPanel.appendChild(b);
    });

    // Edit panel dispatcher — central router for all edit-panel button actions.
    // Called with the button label ('Merge'|'Split'|'Discount'|'Transfer'|'Print'|'Open')
    // and the landing's mutable state object (so we can read selectedIds + emp).
    function _handleEditAction(label, st) {
      var ids = st.selectedIds || [];
      if (ids.length === 0) {
        showToast('Select a check first', { bg: T.verm, duration: 1800 });
        return;
      }

      if (label === 'Open' || label === 'Pay') {
        var orderId = ids[0];
        SceneManager.mountWorking('check-overview', {
          checkId:       orderId,
          returnLanding: 'manager-landing',
          employeeId:    st.emp ? st.emp.id   : null,
          employeeName:  st.emp ? st.emp.name : null,
          pin:           st.emp ? st.emp.pin  : null,
        });
        return;
      }

      if (label === 'Split') {
        // Split operates on a single check. Open it and auto-trigger the
        // column-editor (edit-seats) flow. check-overview reads autoSplit
        // after initial render.
        if (ids.length > 1) {
          showToast('Select only one check to split', { bg: T.verm, duration: 1800 });
          return;
        }
        SceneManager.mountWorking('check-overview', {
          checkId:       ids[0],
          returnLanding: 'manager-landing',
          employeeId:    st.emp ? st.emp.id   : null,
          employeeName:  st.emp ? st.emp.name : null,
          pin:           st.emp ? st.emp.pin  : null,
          autoSplit:     true,
        });
        return;
      }

      if (label === 'Print') {
        if (st._printing) return;
        st._printing = true;
        // Fire a receipt print for each selected check.
        var printed = 0, failed = 0;
        function finish() {
          if (printed + failed !== ids.length) return;
          st._printing = false;
          showToast(
            failed === 0
              ? 'Printed ' + printed + ' receipt' + (printed === 1 ? '' : 's')
              : printed + ' printed, ' + failed + ' failed',
            { bg: failed === 0 ? T.green : T.gold, duration: 2000 }
          );
        }
        ids.forEach(function(orderId) {
          fetch('/api/v1/orders/' + orderId + '/print/receipt', { method: 'POST' })
            .then(function(r) {
              if (r.ok) printed++;
              else      failed++;
              finish();
            })
            .catch(function() { failed++; finish(); });
        });
        showToast('Printing ' + ids.length + ' receipt' + (ids.length === 1 ? '' : 's') + '…', { bg: T.green, duration: 1200 });
        return;
      }

      if (label === 'Void') {
        if (!st.emp || (!st.emp.id && !st.emp.employee_id)) {
          showToast('Manager approval required', { bg: T.verm, duration: 2000 });
          return;
        }
        // Display the human-facing check_number (C-001), not the raw
        // order_id UUID. `checkNum()` falls back to a derived short id
        // if the order hasn't yet received its check_number from the
        // ledger.
        var orderById = {};
        (st.allOrders || []).forEach(function(o) { orderById[o.order_id] = o; });
        var confirmMsg;
        if (ids.length === 1) {
          var o0 = orderById[ids[0]];
          confirmMsg = 'Void check ' + (o0 ? checkNum(o0) : ids[0]) + '?';
        } else {
          confirmMsg = 'Void ' + ids.length + ' checks?';
        }
        // Track which check IDs the pending confirmation is for.  If the
        // selection changes between tap-1 and tap-2 the old token becomes
        // stale and the second tap is treated as a new first tap — preventing
        // the bypass: [tap Void on A] → [switch to B] → [tap Void on B fires].
        var voidKey = ids.slice().sort().join(',');
        var pendingMatch = st._voidPending && st._voidPendingKey === voidKey;
        if (!pendingMatch) {
          showToast(confirmMsg + ' — tap again to confirm', { bg: T.verm, duration: 3000 });
          clearTimeout(st._voidPendingTimer);
          st._voidPending      = true;
          st._voidPendingKey   = voidKey;
          st._voidPendingTimer = setTimeout(function() {
            st._voidPending    = false;
            st._voidPendingKey = null;
          }, 3000);
          return;
        }
        clearTimeout(st._voidPendingTimer);
        st._voidPending    = false;
        st._voidPendingKey = null;
        var voided = 0, vFailed = 0;
        ids.forEach(function(orderId) {
          fetch('/api/v1/orders/' + orderId + '/void', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ approved_by: st.emp.employee_id || st.emp.id, reason: 'Manager void from landing' }),
          }).then(function(r) {
            if (r.ok) voided++;
            else       vFailed++;
            if (voided + vFailed === ids.length) {
              showToast(
                vFailed === 0
                  ? 'Voided ' + voided + ' check' + (voided === 1 ? '' : 's')
                  : voided + ' voided, ' + vFailed + ' failed',
                { bg: vFailed === 0 ? T.green : T.gold, duration: 2000 }
              );
              st.selectedIds = [];
              refresh();
            }
          }).catch(function() { vFailed++; });
        });
        return;
      }

      if (label === 'Merge') {
        if (ids.length < 2) {
          showToast('Select 2+ checks to merge', { bg: T.verm, duration: 2000 });
          return;
        }
        var approver = st.emp ? (st.emp.employee_id || st.emp.id) : null;
        if (!approver) {
          showToast('Manager approval required', { bg: T.verm, duration: 2000 });
          return;
        }
        if (st._merging) return;
        st._merging = true;
        // First selected = target, rest = sources
        var targetId  = ids[0];
        var sourceIds = ids.slice(1);
        showToast('Merging ' + sourceIds.length + ' check(s) into ' + targetId + '…', { bg: T.elec, duration: 1500 });
        fetch('/api/v1/orders/' + targetId + '/merge', {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify({ source_ids: sourceIds, approved_by: approver }),
        }).then(function(r) {
          return r.json().then(function(data) {
            st._merging = false;
            if (r.ok) {
              showToast('Merged into ' + targetId, { bg: T.green, duration: 2000 });
              st.selectedIds = [];
              refresh();
            } else {
              showToast(data.detail || 'Merge failed', { bg: T.verm, duration: 2500 });
            }
          });
        }).catch(function() {
          st._merging = false;
          showToast('Merge failed — check connection', { bg: T.verm, duration: 2000 });
        });
        return;
      }

      // Discount / Transfer — dedicated flows not yet spec'd.
      showToast(label + ' — coming soon', { bg: T.gold, duration: 1800 });
    }

    // Filter tabs inside the card footer — reduced to 32px height to match new tile style
    var serverBtn = buildPillButton({ label: 'ALL SERVERS', color: T.elec, darkBg: T.elecDk, fontSize: T.fsB3, padding: '8px 16px' });
    serverBtn._color = T.elec; serverBtn._dark = T.elecDk;
    serverBtn.setColor = function(c, d) {
      serverBtn._color = c; serverBtn._dark = d;
      serverBtn.style.background = c;
      serverBtn.style.boxShadow  = '0 6px 0 ' + d;
    };
    footerRight.appendChild(serverBtn);

    var filterBtn = buildPillButton({ label: 'OPEN', color: T.green, darkBg: T.greenDk, fontSize: T.fsB3, padding: '8px 16px' });
    filterBtn.setColor = function(c, d) {
      filterBtn.style.background = c;
      filterBtn.style.boxShadow  = '0 6px 0 ' + d;
    };
    footerRight.appendChild(filterBtn);

    // Edit float button — bottom-left, appears when a tile is selected
    var editBtn = buildPillButton({ label: 'OPTIONS', color: T.green, darkBg: T.greenDk, fontSize: T.fsB3 });
    editBtn.style.opacity       = '0';
    editBtn.style.pointerEvents = 'none';
    editBtn.style.transition    = 'opacity 0.15s ease';
    // setColor replaces internal press/release handlers so hover doesn't revert
    editBtn._btnColor = T.green;
    editBtn._btnDark  = T.greenDk;
    editBtn.setColor = function(c, d) {
      editBtn._btnColor = c;
      editBtn._btnDark  = d;
      editBtn.style.background = c;
      editBtn.style.boxShadow  = '0 6px 0 ' + d;
      editBtn.style.color      = (c === T.verm) ? '#fff' : T.well;
    };
    // Override press/release to use live _btnColor/_btnDark
    editBtn.addEventListener('pointerdown', function() {
      editBtn.style.background = editBtn._btnDark;
      editBtn.style.color      = editBtn._btnColor;
      editBtn.style.boxShadow  = 'none';
      editBtn.style.transform  = 'translateY(1px)';
    });
    var _editRel = function() {
      editBtn.style.background = editBtn._btnColor;
      editBtn.style.color      = (editBtn._btnColor === T.verm) ? '#fff' : T.well;
      editBtn.style.boxShadow  = '0 6px 0 ' + editBtn._btnDark;
      editBtn.style.transform  = '';
    };
    editBtn.addEventListener('pointerup',    _editRel);
    editBtn.addEventListener('pointerleave', _editRel);
    footerLeft.appendChild(editBtn);

    // ─────────────────────────────────────────────
    //  COB / LABOR (col 2, row 2)
    // ─────────────────────────────────────────────
    var cobResult = buildStaticCard({ accent: T.gold });
    cobResult.style.gridColumn     = '2';
    cobResult.style.gridRow        = '2';
    cobResult.style.padding        = '12px 14px';
    cobResult.style.display        = 'flex';
    cobResult.style.flexDirection  = 'column';
    cobResult.style.justifyContent = 'space-between';
    root.appendChild(cobResult);

    var cobLabel = buildSectionLabel('Labor / COB', T.text);
    cobLabel.style.fontSize = '16px';
    cobResult.appendChild(cobLabel);

    var cobInst = buildCOBCard();
    cobResult.appendChild(cobInst.wrap);

    // ─────────────────────────────────────────────
    //  SERVER CHECKOUTS (col 3, row 2)
    // ─────────────────────────────────────────────
    var chkOuter = document.createElement('div');
    chkOuter.style.cssText = 'grid-column:3;grid-row:2;position:relative;overflow:visible;display:flex;flex-direction:column;';
    root.appendChild(chkOuter);

    var chkResult = buildStaticCard({ accent: T.elec });
    chkResult.style.flex          = '1';
    chkResult.style.padding       = '12px 14px';
    chkResult.style.display       = 'flex';
    chkResult.style.flexDirection = 'column';
    chkOuter.appendChild(chkResult);

    var chkLabel = buildSectionLabel('Server Checkouts', T.text);
    chkLabel.style.fontSize = '16px';
    chkLabel.style.marginBottom = '6px';
    chkResult.appendChild(chkLabel);

    var serverList = document.createElement('div');
    serverList.style.cssText = 'display:flex;flex-wrap:wrap;gap:8px;align-content:flex-start;flex:1;overflow:hidden;padding:4px 0;';
    chkResult.appendChild(serverList);

    // Close Day pill — lives in card footer, no float positioning
    var closeDayBtn = buildPillButton({ label: 'CLOSE DAY', color: T.elec, darkBg: T.elecDk });
    closeDayBtn.style.padding = '10px 28px';

    var closeDayWrap = document.createElement('div');
    closeDayWrap.style.cssText = 'display:flex;justify-content:flex-end;margin-top:8px;flex-shrink:0;';
    closeDayWrap.appendChild(closeDayBtn);
    chkResult.appendChild(closeDayWrap);

    // Store all live-update refs
    state._refs = {
      tileGrid, previewSlide, prevContent, actGrid,
      salesOverview, lineCardInst, cobInst, salesOuter,
      serverList, serverBtn, filterBtn, closeDayBtn, editBtn, editPanel, tileGrid,
    };

    // ─────────────────────────────────────────────
    //  RENDER FUNCTIONS
    // ─────────────────────────────────────────────

    function renderTiles() {
      var r = state._refs;
      r.tileGrid.innerHTML = '';
      var visible = ordersByFilter(state.allOrders, state.filter, state.filteredServer);
      visible.forEach(function(order) {
        var id = order.order_id;
        var selected = state.selectedIds.indexOf(id) !== -1;
        var srvColor = state.serverColorMap[order.server_id] || T.elec;
        var _fc = STATUS_COLORS[state.filter] || {};

        // Tap unselected → add to selection.
        // Tap already-selected → push check-overview for that check.
        // Long-press → ensure selection contains the tile, then open edit panel.
        var onClick = function() {
          if (_inputIgnoreUntil > Date.now()) return;
          var idx = state.selectedIds.indexOf(id);
          if (idx === -1) {
            state.selectedIds.push(id);
            renderTiles();
            renderPreview();
          } else {
            _inputIgnoreUntil = Date.now() + 200;
            SceneManager.mountWorking('check-overview', {
              checkId:       order.order_id,
              returnLanding: 'manager-landing',
              employeeId:    state.emp ? state.emp.id   : null,
              employeeName:  state.emp ? state.emp.name : null,
              pin:           state.emp ? state.emp.pin  : null,
            });
          }
        };
        var onLongPress = function(ord) {
          if (state.selectedIds.indexOf(ord.order_id) === -1) {
            state.selectedIds.push(ord.order_id);
          }
          renderTiles();
          renderPreview();
          _openEditPanel();
        };

        r.tileGrid.appendChild(_buildCheckTile(order, selected, srvColor, onClick, onLongPress, _fc.color));
      });
      if (state.filter === 'OPEN') {
        var newTile = document.createElement('div');
        newTile.style.cssText = [
          'width:140px;height:120px;flex-shrink:0;',
          'border:1px dashed ' + hexToRgba(T.green, 0.5) + ';',
          'border-radius:10px;',
          'display:flex;align-items:center;justify-content:center;',
          'cursor:pointer;transition:background 0.1s;',
          'pointer-events:auto;touch-action:manipulation;',
        ].join('');
        var plus = document.createElement('span');
        plus.style.cssText = 'font-family:' + T.fh + ';font-size:36px;color:' + hexToRgba(T.green, 0.6) + ';pointer-events:none;';
        plus.textContent = '+';
        newTile.appendChild(plus);
        newTile.addEventListener('pointerdown',  function() {
          if (_inputIgnoreUntil > Date.now()) return;
          newTile.style.background = hexToRgba(T.green, 0.08);
        });
        newTile.addEventListener('pointerup',    function() {
          if (_inputIgnoreUntil > Date.now()) return;
          newTile.style.background = 'transparent';
          _inputIgnoreUntil = Date.now() + 200;
          SceneManager.mountWorking('check-overview', {
            checkId:       null,
            returnLanding: 'manager-landing',
            employeeId:    state.emp ? state.emp.id   : null,
            employeeName:  state.emp ? state.emp.name : null,
            pin:           state.emp ? state.emp.pin  : null,
          });
        });
        newTile.addEventListener('pointerleave', function() { newTile.style.background = 'transparent'; });
        r.tileGrid.appendChild(newTile);
      }
      if (visible.length === 0 && state.filter !== 'OPEN') {
        var empty = document.createElement('div');
        empty.textContent   = 'No ' + state.filter.toLowerCase() + ' checks';
        empty.style.cssText = 'font-family:' + T.fb + ';font-size:14px;color:' + T.border + ';letter-spacing:0.14em;padding:8px 4px;';
        r.tileGrid.appendChild(empty);
      }
    }

    function renderPreview() {
      var r = state._refs;
      r.prevContent.innerHTML = '';
      r.actGrid.style.display = 'none';

      if (state.selectedIds.length === 0) {
        r.previewSlide.style.display       = 'none';
        r.editBtn.style.opacity            = '0';
        r.editBtn.style.pointerEvents      = 'none';
        _editPanelOpen = false;
        r.editPanel.style.transform        = 'translateY(110%)';
        r.editBtn.textContent              = 'OPTIONS';
        r.editBtn.setColor(T.green, T.greenDk);
        r.salesOuter.style.opacity       = '1';
        r.salesOuter.style.pointerEvents = 'auto';
        return;
      }

      var selected = state.allOrders.filter(function(o) {
        return state.selectedIds.indexOf(o.order_id) !== -1;
      });
      if (selected.length > 0) r.prevContent.appendChild(_buildPreview(selected, state.allOrders));
      r.actGrid.style.display            = 'grid';
      r.previewSlide.style.display       = 'flex';
      r.previewSlide.style.opacity       = '1';
      r.editBtn.style.opacity            = '1';
      r.editBtn.style.pointerEvents      = 'auto';
    }

    function renderSales() {
      var sd = state.salesData || {};
      var r  = state._refs;
      r.salesOverview.update(
        sd.net_sales  || 0,
        sd.cash_total || 0,
        sd.card_total || 0,
        sd.net_sales > 0 ? '▲ vs last week' : '',
        sd.sparkData  || null
      );
      r.lineCardInst.update(
        fmt(sd.net_sales || 0),
        sd.net_sales > 0 ? '▲ vs last week' : '',
        sd.sparkData  || null,
        null
      );
    }

    function renderCOB() {
      var sd      = state.salesData || {};
      var servers = ((state.staffData || {}).servers || []);
      var pct     = sd.labor_cob || 0;
      state._refs.cobInst.update(
        pct,
        sd.staff_count  || 0,
        sd.labor_hours  || 0,
        sd.labor_cost   || 0,
        servers.map(function(s, i) {
          return {
            name:  s.name,
            hours: s.hours || 0,
            color: state.serverColorMap[s.id] || T.srvPalette[i % T.srvPalette.length],
          };
        })
      );
    }

    function renderGate() {
      var r  = state._refs;
      var cd = state.closeDayData || {};
      // Close Day is always tappable — the Finalize gate lives inside
      // close-day.js. Color still communicates readiness at a glance.
      if (cd.batch_ready) {
        r.closeDayBtn.setColor(T.elec, T.elecDk);
        r.closeDayBtn.style.opacity = '1';
      } else if (!cd.all_checked_out) {
        r.closeDayBtn.setColor(T.gold, T.goldDk);
        r.closeDayBtn.style.opacity = '1';
      } else {
        // Checked out but tips outstanding
        r.closeDayBtn.setColor(T.verm, T.vermDk);
        r.closeDayBtn.style.opacity = '1';
      }
    }

    function renderServerList() {
      var r       = state._refs;
      var servers = ((state.staffData || {}).servers || []);
      r.serverList.innerHTML = '';
      if (servers.length === 0) {
        var empty = document.createElement('div');
        empty.textContent   = 'No servers clocked in';
        empty.style.cssText = 'font-family:' + T.fb + ';font-size:13px;color:' + T.border + ';letter-spacing:0.12em;text-align:center;padding:8px 0;grid-column:1/-1;';
        r.serverList.appendChild(empty);
        return;
      }
      // Sort: active first, checked out last
      var sorted = servers.slice().sort(function(a, b) {
        if (a.checked_out && !b.checked_out) return 1;
        if (!a.checked_out && b.checked_out) return -1;
        return 0;
      });
      sorted.forEach(function(srv) {
        r.serverList.appendChild(_buildServerRow(state, srv, function(s) {
          SceneManager.mountWorking('server-checkout', { staff: s, fromManager: true });
        }));
      });
    }

    function renderServerFilter() {
      var r       = state._refs;
      var servers = ((state.staffData || {}).servers || []);
      if (!state.filteredServer) {
        r.serverBtn.textContent = 'ALL SERVERS';
        r.serverBtn.setColor(T.elec, T.elecDk);
        return;
      }
      var srv = servers.find(function(s) { return s.id === state.filteredServer; });
      if (srv) {
        var name = srv.name.split(' ')[0].toUpperCase();
        var color = state.serverColorMap[srv.id] || T.elec;
        r.serverBtn.textContent = name;
        r.serverBtn.setColor(color, darkenHex(color, 0.35));
      }
    }

    // Edit panel — open/close helpers. Both the OPTIONS button and the
    // long-press path on a check tile call _openEditPanel so the UI is
    // defined exactly once.
    var _editPanelOpen = false;
    function _openEditPanel() {
      if (state.selectedIds.length === 0) return;
      _editPanelOpen = true;
      var r = state._refs;
      r.editPanel.style.transform     = 'translateY(0)';
      editBtn.textContent             = 'CLOSE';
      editBtn.setColor(T.verm, T.vermDk);
      salesOuter.style.opacity        = '0.25';
      salesOuter.style.pointerEvents  = 'none';
      r.serverBtn.style.opacity       = '0.3';
      r.filterBtn.style.opacity       = '0.3';
      r.serverBtn.style.pointerEvents = 'none';
      r.filterBtn.style.pointerEvents = 'none';
    }
    function _closeEditPanel() {
      _editPanelOpen = false;
      var r = state._refs;
      r.editPanel.style.transform     = 'translateY(110%)';
      editBtn.textContent             = 'OPTIONS';
      editBtn.setColor(T.green, T.greenDk);
      salesOuter.style.opacity        = '1';
      salesOuter.style.pointerEvents  = 'auto';
      r.serverBtn.style.opacity       = '1';
      r.filterBtn.style.opacity       = '1';
      r.serverBtn.style.pointerEvents = 'auto';
      r.filterBtn.style.pointerEvents = 'auto';
    }
    editBtn.addEventListener('pointerup', function() {
      if (state.selectedIds.length === 0) return;
      if (_editPanelOpen) _closeEditPanel();
      else                _openEditPanel();
    });

    // ─────────────────────────────────────────────
    //  FILTER HANDLERS
    // ─────────────────────────────────────────────

    filterBtn.addEventListener('pointerup', function() {
      state.filter      = STATUS_CYCLE[state.filter];
      state.selectedIds = [];
      var fc = STATUS_COLORS[state.filter];
      state._refs.filterBtn.textContent = state.filter;
      state._refs.filterBtn.setColor(fc.color, fc.dark);
      gridResult.setAccent(fc.color);
      renderTiles();
      renderPreview();
    });

    serverBtn.addEventListener('pointerup', function() {
      var servers = ((state.staffData || {}).servers || []);
      if (servers.length === 0) return;
      // Build cycle: null → server[0] → server[1] → ... → null
      var ids = [null].concat(servers.map(function(s) { return s.id; }));
      var cur = ids.indexOf(state.filteredServer);
      state.filteredServer = ids[(cur + 1) % ids.length];
      state.selectedIds    = [];
      renderTiles();
      renderPreview();
      renderServerFilter();
    });

    // ─────────────────────────────────────────────
    //  CLOSE DAY
    // ─────────────────────────────────────────────
    // Close Day always opens — the gate lives on the Finalize action inside
    // close-day.js, not here. Blocking entry was preventing managers from
    // seeing WHY close day couldn't proceed. (UI-022)
    closeDayBtn.addEventListener('pointerup', function() {
      entReport({
        code:    'UI-022',
        source:  'manager-landing.closeDayBtn',
        message: 'Close Day opened',
        ctx: {
          batch_ready:       (state.closeDayData || {}).batch_ready     || false,
          pending_count:     (state.closeDayData || {}).pending_count   || 0,
          unadjusted_count:  (state.closeDayData || {}).unadjusted_count || 0,
        },
        level: 'INFO',
      });
      SceneManager.openTransactional('close-day', { staff: state.emp });
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
        // Reconcile selection against the truthful order set so pill actions
        // never fire on orders closed/voided from another terminal.
        var alive = {};
        (state.allOrders || []).forEach(function(o) { alive[o.order_id] = true; });
        state.selectedIds = (state.selectedIds || []).filter(function(id) { return alive[id]; });
        try { renderSales();        } catch(e) { console.warn('[ml] renderSales threw:', e); }
        try { renderGate();         } catch(e) { console.warn('[ml] renderGate threw:', e); }
        try { renderCOB();          } catch(e) { console.warn('[ml] renderCOB threw:', e); }
        try { renderServerList();   } catch(e) { console.warn('[ml] renderServerList threw:', e); }
        try { renderServerFilter(); } catch(e) { console.warn('[ml] renderServerFilter threw:', e); }
        try { renderTiles();        } catch(e) { console.warn('[ml] renderTiles threw:', e); }
        try { renderPreview();      } catch(e) { console.warn('[ml] renderPreview threw:', e); }
      }).catch(function() { state._refreshing = false; });
    }

    refresh();

    var _onUpdate = function() { refresh(); };
    SceneManager.on('order:updated', _onUpdate);
    SceneManager.on('order:closed',  _onUpdate);
    SceneManager.on('tip:adjusted',  _onUpdate);

    return function cleanup() {
      state.el = null;
      clearTimeout(state._voidPendingTimer);
      SceneManager.off('order:updated', _onUpdate);
      SceneManager.off('order:closed',  _onUpdate);
      SceneManager.off('tip:adjusted',  _onUpdate);
    };
  },
});