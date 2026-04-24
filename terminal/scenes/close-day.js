// ═══════════════════════════════════════════════════
//  KINDpos Terminal — Close Day Scene (Vz2.0)
//
//  Store-scope EOD reconciliation. Shares 3-col frame with server-
//  checkout (close day is basically the store-scope version of the
//  server checkout flow).
//
//    BANNER  conditional blocker bar, full width
//    LEFT    260w   receipt preview of pinned selection
//    MIDDLE  484w   adaptive card stack
//    RIGHT   236w   actions + blockers + lock snapshot + LOCK DAY
//
//  Middle stack (adaptive):
//    Sales         compact, always — hero + today/lastwk vertical bars
//    Open Checks   inline blocker, verm — only when openChecks > 0
//    Tips          UNADJ/ADJ filter tabs, yellow when unadj > 0
//    Cash          direct count + BYPASS, collapsed when blocked
//    CC Batch      SETTLE step, blocked while tips unadjusted
//    Delivery      placeholder (deferred to premium)
//
//  Gate cascade:  unadj tips → SETTLE enables
//                 open checks + unsettled batch → LOCK disabled
//
//  LOCK writes the immutable close-day event via POST
//  /api/v1/orders/close-day. Flow mirrors server-checkout's finalize
//  exactly: co-manager-pin → co-finalize-confirm → POST.
//
//  Nice. Dependable. Yours.
// ═══════════════════════════════════════════════════

import { defineScene, SceneManager }  from '../scene-manager.js';
import { T }                          from '../../common/tokens.js';
import {
  buildStaticCard,
  buildNavCard,
  buildActionCard,
  buildPillButton,
  buildSectionLabel,
  hexToRgba,
  darkenHex,
}                                      from '../theme-manager.js';
import { showToast }                   from '../components.js';

// ─────────────────────────────────────────────────
//  LAYOUT CONSTANTS — matched to server-checkout
// ─────────────────────────────────────────────────

var LEFT_W   = 260;
var RIGHT_W  = 236;
var PAD      = 14;
var PAD_TOP  = 8;    // reduce top padding per UI audit

// Font scale (aligned to tokens fsB4=14 / fsB3=16 / fsB2=20)
var FS_LABEL   = '13px';
var FS_META    = '13px';
var FS_BODY    = '15px';
var FS_AMOUNT  = '17px';
var FS_HERO    = '28px';
var FS_PILL    = '13px';
var FS_PILL_LG = '15px';
var FS_RECEIPT = '11px';

// ─────────────────────────────────────────────────
//  HELPERS
// ─────────────────────────────────────────────────

function fmt(n) {
  n = n || 0;
  var abs = Math.abs(n).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return (n < 0 ? '\u2212$' : '$') + abs;
}

function fmtPct(delta) {
  if (delta == null || !isFinite(delta)) return '\u2014';
  var sign = delta > 0 ? '\u25B2' : (delta < 0 ? '\u25BC' : '\u00B7');
  return sign + ' ' + Math.abs(delta).toFixed(1) + '%';
}

function deltaColor(delta) {
  if (delta == null || !isFinite(delta) || delta === 0) return T.text;
  return delta > 0 ? T.greenWarm : T.verm;
}

// Check label normalizer. The backend ships check labels in mixed formats:
// day-summary pre-formats as "C-001" style, raw orders may return bare
// numerics like "27", and some endpoints return "#21" already prefixed.
// Rule: if the value already starts with a non-digit (#, C, letters), use
// it as-is. Only prepend "#" to bare numerics.
function checkNumDisplay(chk) {
  var raw = String(chk.checkLabel || chk.checkId || '');
  if (!raw) return '';
  if (/^[#A-Za-z]/.test(raw)) return raw;
  return '#' + raw;
}

// Synthesize a consistent, readable check label from the order_id.
// Extracts the last run of digits, normalizes leading zeros, then pads
// to 3. Handles all these forms uniformly:
//   "27"          → "C-027"
//   "0027"        → "C-027"   (leading zeros stripped)
//   "order_27"    → "C-027"   (prefixed)
//   "ord-abc-5"   → "C-005"   (uuid-ish with trailing seq)
//   "1234"        → "C-1234"  (>3 digits = no artificial padding)
//   "abc-def"     → "C-ABC"   (no digits — first 3 chars fallback)
// Backend check_number fields are ignored — this is the source of truth
// for display so every screen shows the same value for the same order.
function synthCheckLabel(id) {
  var s = String(id || '');
  if (!s) return 'C-???';
  var digits = s.match(/\d+/g);
  if (digits && digits.length) {
    var num = String(parseInt(digits[digits.length - 1], 10));
    while (num.length < 3) num = '0' + num;
    return 'C-' + num;
  }
  return 'C-' + s.slice(0, 3).toUpperCase();
}

// Time normalizer. /api/v1/orders ships created_at as full ISO-8601
// ("2026-04-19T20:23:07.353556Z") which is unreadable for humans.
// day-summary's d.checks ship pre-formatted strings ("7:23pm"). Accept
// either — parse ISO to h:mm a, pass through anything else.
function formatTime(t) {
  if (!t) return '';
  // Pre-formatted: no ISO markers, return as-is.
  if (typeof t !== 'string' || (t.indexOf('T') === -1 && t.indexOf(':') <= 2)) return t;
  var d = new Date(t);
  if (isNaN(d.getTime())) return t;
  var h = d.getHours();
  var m = d.getMinutes();
  var ampm = h >= 12 ? 'pm' : 'am';
  h = h % 12 || 12;
  return h + ':' + (m < 10 ? '0' : '') + m + ampm;
}

// ─────────────────────────────────────────────────
//  DATA FETCH
//  Same calls as server-checkout but UNSCOPED (store-wide).
// ─────────────────────────────────────────────────

function fetchCloseDayState(params) {
  var today = new Date();

  return Promise.all([
    fetch('/api/v1/orders/day-summary').then(function(r) { return r.json(); }).catch(function() { return {}; }),
    fetch('/api/v1/config/tipout').then(function(r) { return r.json(); }).catch(function() { return []; }),
    fetch('/api/v1/config/store').then(function(r) { return r.json(); }).catch(function() { return {}; }),
    fetch('/api/v1/orders').then(function(r) { return r.json(); }).catch(function() { return []; }),
    // Last-week comparison — API doesn't expose this yet per charts.js notes.
    // Falling back to 0; when the endpoint lands, replace with e.g.
    //   /api/v1/orders/day-summary?date=<today-7d> → .net_sales
    Promise.resolve({ net_sales: 0 }),
  ]).then(function(results) {
    var d         = results[0] || {};
    var rules     = Array.isArray(results[1]) ? results[1] : [];
    var store     = results[2] || {};
    var rawOrders = Array.isArray(results[3]) ? results[3] : [];
    var lastWeek  = results[4] || {};

    var netSales  = d.net_sales || 0;
    var cardTips  = d.card_tips || 0;
    var cashTips  = d.cash_tips || 0;
    var grossTips = cardTips + cashTips;

    // ── Tip-out calc (preserved from pre-rebuild close-day.js) ──
    // TipoutRule.calculation_base supports "Net Sales", "Gross Tips",
    // "Net Tips". When a Net Sales rule has `categories` populated, the
    // basis narrows to those categories only.
    var catTotals = {};
    (d.categories || []).forEach(function(c) {
      if (c && c.name) catTotals[c.name] = c.total || 0;
    });
    var totalTipOut = 0;
    rules.forEach(function(r) {
      var base = r.calculation_base || 'Net Sales';
      var basis;
      if (base === 'Gross Tips' || base === 'Net Tips') {
        basis = grossTips;
      } else if (Array.isArray(r.categories) && r.categories.length) {
        basis = r.categories.reduce(function(sum, cat) { return sum + (catTotals[cat] || 0); }, 0);
      } else {
        basis = netSales;
      }
      totalTipOut += basis * (r.percentage || 0) / 100;
    });
    totalTipOut = parseFloat(totalTipOut.toFixed(2));

    // ── Check lists ──
    // Merge d.checks (day-summary's authoritative status/method/adjusted
    // flags) with rawOrders (which carry server_name, items, and full
    // order metadata). Manager-landing bypasses d.checks entirely for this
    // reason; we want its richer metadata but also the summary's computed
    // `adjusted` field, so we merge by order_id.
    var rawById = {};
    rawOrders.forEach(function(o) { rawById[o.order_id] = o; });
    var summaryById = {};
    (d.checks || []).forEach(function(c) {
      var id = c.checkId || c.check_id || c.order_id;
      if (id) summaryById[id] = c;
    });
    // Union of IDs from both sources so nothing is dropped
    var allIds = {};
    rawOrders.forEach(function(o) { allIds[o.order_id] = true; });
    (d.checks || []).forEach(function(c) {
      var id = c.checkId || c.check_id || c.order_id;
      if (id) allIds[id] = true;
    });

    var checks = Object.keys(allIds).map(function(id) {
      var raw = rawById[id] || {};
      var sum = summaryById[id] || {};

      // status — normalize "paid" → "closed" (backend uses paid; UI uses closed)
      var status = sum.status || (raw.status === 'paid' ? 'closed' : raw.status) || 'unknown';
      var method = sum.method || raw.payment_method || null;
      var tip    = sum.tip != null ? sum.tip : raw.tip_amount;

      // Check label — always synthesized from order_id so every screen in
      // the app displays the same label for the same order. Backend
      // check_number / checkLabel fields are ignored because they arrive
      // in mixed formats ("27", "#21", "C-001") and managers need one
      // consistent reference.
      var label = synthCheckLabel(id);

      return {
        checkId:     id,
        checkLabel:  label,
        tableLabel:  raw.table_label  || raw.customer_name || sum.tableLabel || sum.table_label || '',
        status:      status,
        method:      method,
        amount:      (sum.amount != null) ? sum.amount : (raw.total_amount || raw.total || 0),
        tip:         tip,
        adjusted:    (sum.adjusted != null) ? sum.adjusted : (tip != null),
        server_id:   raw.server_id   || sum.server_id   || '',
        server_name: raw.server_name || sum.server_name || '',
        guests:      raw.guest_count || raw.seat_count  || raw.covers || sum.guests || sum.guest_count || 0,
        time:        formatTime(raw.created_at || sum.time || ''),
      };
    });

    var openChecks       = checks.filter(function(c) { return c.status === 'open'; });
    var closedCardChecks = checks.filter(function(c) { return c.status === 'closed' && c.method === 'card'; });
    var unadjustedChecks = closedCardChecks.filter(function(c) { return !c.adjusted; });
    var adjustedChecks   = closedCardChecks.filter(function(c) { return  c.adjusted; });

    // Last-week comparison for the Sales vertical bars
    var lastWeekSales = lastWeek.net_sales || 0;
    var salesDelta    = null;
    if (lastWeekSales > 0) salesDelta = ((netSales - lastWeekSales) / lastWeekSales) * 100;

    return {
      // Identity
      date:          (today.getMonth() + 1) + '/' + today.getDate() + '/' + String(today.getFullYear()).slice(2),
      dateLong:      today.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' }).toUpperCase(),
      timeLong:      today.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }),
      restaurantName: (store.info && store.info.restaurant_name) || store.name || 'KINDpos',
      managerName:   params.managerName || (params.staff && params.staff.name) || 'Manager',
      managerId:     (params.staff && (params.staff.id || params.staff.employee_id)) || null,

      // Revenue
      grossSales:    d.gross_sales    || 0,
      voidsTotal:    d.void_total     || 0, voidsCount: d.void_count     || 0,
      discTotal:     d.discount_total || 0, discCount:  d.discount_count || 0,
      netSales:      netSales,
      taxCollected:  d.tax_total      || 0,
      lastWeekSales: lastWeekSales,
      salesDelta:    salesDelta,

      // Payments
      cashSales:     d.cash_total || 0, cashCount: d.cash_count || 0,
      cardSales:     d.card_total || 0, cardCount: d.card_count || 0,
      totalPayments: (d.cash_total || 0) + (d.card_total || 0),

      // Tips
      totalTips:     d.total_tips || grossTips,
      cardTips:      cardTips,
      cashTips:      cashTips,
      totalTipOut:   totalTipOut,

      // Categories (for Sales detail — expansion TBD)
      categories:    d.categories || [],

      // Check stats
      totalChecks:   d.total_checks || checks.length,
      avgCheck:      d.avg_check    || (checks.length ? netSales / checks.length : 0),
      covers:        d.guest_count  || 0,
      dayparts:      d.dayparts     || [],

      // Check lists (for blockers + preview)
      checks:            checks,
      openChecks:        openChecks,
      closedCardChecks:  closedCardChecks,
      unadjustedChecks:  unadjustedChecks,
      adjustedChecks:    adjustedChecks,

      // CC Batch
      batchTransactions: d.card_count || 0,
      batchTotal:        d.card_total || 0,

      // Cash drawer
      cashExpected:     (d.cash_total || 0) - (d.cash_tips || 0),

      // Full order records — receipt preview looks up items/subtotal/tax
      // here. Matches server-checkout's pattern at renderCheckPreview.
      allOrders:        rawOrders,

      // Raw reference for the recap panel
      daySummary:       d,
    };
  });
}

// ─────────────────────────────────────────────────
//  BLOCKER BANNER (top, full width — conditional)
// ─────────────────────────────────────────────────

function buildBlockerBanner(state) {
  var openCount  = state.openChecks.length;
  var unadjCount = state.unadjustedChecks.length;
  var total      = openCount + unadjCount;
  if (total === 0) return null;

  var wrap = buildStaticCard({ accent: T.verm });
  wrap.style.cssText += [
    'flex-shrink:0;display:flex;align-items:center;gap:14px;',
    'padding:10px 18px;box-sizing:border-box;',
  ].join('');

  var icon = document.createElement('div');
  icon.style.cssText = [
    'width:28px;height:28px;border-radius:6px;flex-shrink:0;',
    'background:' + hexToRgba(T.verm, 0.18) + ';',
    'display:flex;align-items:center;justify-content:center;',
    'font-family:' + T.fb + ';font-size:16px;font-weight:700;color:' + T.verm + ';',
  ].join('');
  icon.textContent = '!';

  var textCol = document.createElement('div');
  textCol.style.cssText = 'flex:1;display:flex;flex-direction:column;gap:3px;min-width:0;';

  var title = document.createElement('div');
  title.style.cssText = 'font-family:' + T.fh + ';font-size:' + FS_LABEL + ';font-weight:700;color:' + T.verm + ';letter-spacing:1.8px;';
  title.textContent = total + ' BLOCKER' + (total > 1 ? 'S' : '') + ' \u2014 RESOLVE BEFORE LOCK';

  var summary = document.createElement('div');
  summary.style.cssText = 'font-family:' + T.fb + ';font-size:' + FS_BODY + ';color:' + T.text + ';';
  var parts = [];
  if (openCount)  parts.push(openCount  + ' open check'       + (openCount  > 1 ? 's' : ''));
  if (unadjCount) parts.push(unadjCount + ' unadjusted CC tip' + (unadjCount > 1 ? 's' : ''));
  summary.textContent = parts.join(' \u2022 ');

  textCol.appendChild(title);
  textCol.appendChild(summary);

  // Date/time chip (same silhouette as server-checkout's FLSA chip)
  var chip = document.createElement('div');
  chip.style.cssText = [
    'flex-shrink:0;padding:7px 18px;border-radius:999px;',
    'background:' + T.well + ';',
    'font-family:' + T.fb + ';font-size:' + FS_META + ';color:' + T.lavender + ';',
    'letter-spacing:0.5px;',
  ].join('');
  chip.textContent = state.dateLong + '  \u2022  ' + state.timeLong;

  wrap.appendChild(icon);
  wrap.appendChild(textCol);
  wrap.appendChild(chip);
  return wrap;
}

// ─────────────────────────────────────────────────
//  LEFT COLUMN — Receipt Preview
//  Replicates server-checkout's renderCheckPreview. Looks up the full
//  order in allOrders for items + subtotal + tax. Handles multi-select
//  (stacked sub-headers, 3-item cap per check + "+N more").
// ─────────────────────────────────────────────────

function buildReceiptCol(state, selectedChecks, allOrders, handlers) {
  selectedChecks = selectedChecks || [];
  var showing = selectedChecks.length > 0;
  var isMulti = selectedChecks.length > 1;

  var col = buildStaticCard({ accent: T.green });
  col.style.cssText += [
    'flex-shrink:0;width:' + LEFT_W + 'px;',
    'padding:14px 16px;box-sizing:border-box;',
    'display:flex;flex-direction:column;gap:10px;',
  ].join('');

  // Header — title + dismiss × when a selection is pinned
  var hdr = document.createElement('div');
  hdr.style.cssText = 'display:flex;justify-content:space-between;align-items:baseline;flex-shrink:0;gap:6px;';
  var hdrTitle = buildSectionLabel(showing ? 'CHECK PREVIEW' : 'SALES RECAP', T.text);
  hdr.appendChild(hdrTitle);

  if (showing) {
    var dismiss = document.createElement('span');
    dismiss.style.cssText = [
      'font-family:' + T.fb + ';font-size:18px;color:' + T.text + ';opacity:0.55;',
      'cursor:pointer;user-select:none;-webkit-user-select:none;',
      'pointer-events:auto;touch-action:manipulation;',
      'padding:0 6px;line-height:1;',
    ].join('');
    dismiss.textContent = '\u00D7';
    dismiss.addEventListener('pointerup', function() {
      if (handlers && handlers.onDismissPreview) handlers.onDismissPreview();
    });
    hdr.appendChild(dismiss);
  }
  col.appendChild(hdr);

  var paper = document.createElement('div');
  paper.style.cssText = [
    'flex:1;min-height:0;overflow-y:auto;touch-action:pan-y;overscroll-behavior:contain;',
    'background:' + (showing ? T.well : 'transparent') + ';',
    'border-radius:6px;',
    'padding:' + (showing ? '14px 14px' : '0') + ';box-sizing:border-box;',
    'font-family:' + T.fb + ';',
    'display:flex;flex-direction:column;',
  ].join('');

  if (!showing) {
    paper.appendChild(_buildSalesRecapPreview(state.daySummary));
  } else {
    renderCheckPreview(paper, selectedChecks, allOrders);
  }
  col.appendChild(paper);

  // Action stack — only when at least one check is selected. Matches
  // server-checkout's receipt col: full-width TRANSFER + 2x2 grid of
  // PRINT / PAY / DISCOUNT / VOID. All handlers receive the full
  // selectedChecks array; single-select is just an array of length 1.
  if (showing) {
    var actStack = document.createElement('div');
    actStack.style.cssText = 'flex-shrink:0;display:flex;flex-direction:column;gap:6px;';

    var transferBtn = buildPillButton({
      label:  isMulti ? 'Transfer ' + selectedChecks.length + ' Checks' : 'Transfer',
      color:  T.elec,
      darkBg: T.elecDk,
      onClick: function() {
        if (handlers && handlers.onTransferChecks) handlers.onTransferChecks(selectedChecks);
      },
    });
    transferBtn.style.cssText += 'font-size:14px;padding:10px 14px;width:100%;box-sizing:border-box;';
    actStack.appendChild(transferBtn);

    var actGrid = document.createElement('div');
    actGrid.style.cssText = 'display:grid;grid-template-columns:1fr 1fr;gap:6px;';

    var ops = [
      { label: 'Print',    color: T.greenWarm, dark: T.greenWarmDk, key: 'onPrintCheck'    },
      { label: 'Pay',      color: T.gold,      dark: T.goldDk,      key: 'onCloseCheck'    },
      { label: 'Discount', color: T.elec,      dark: T.elecDk,      key: 'onDiscountCheck' },
      { label: 'Void',     color: T.verm,      dark: T.vermDk,      key: 'onVoidCheck'     },
    ];

    ops.forEach(function(op) {
      var btn = buildPillButton({
        label:  op.label,
        color:  op.color,
        darkBg: op.dark,
        onClick: function() {
          if (handlers && handlers[op.key]) handlers[op.key](selectedChecks);
        },
      });
      btn.style.cssText += 'font-size:14px;padding:8px 10px;';
      actGrid.appendChild(btn);
    });

    actStack.appendChild(actGrid);
    col.appendChild(actStack);
  }

  return col;
}

/**
 * Structured receipt-style preview of the day's totals.
 * Pure function. Uses T.* tokens for all styling.
 */
function _buildSalesRecapPreview(data) {
  if (!data || Object.keys(data).length === 0) {
    var empty = document.createElement('div');
    empty.style.cssText = 'flex:1;display:flex;align-items:center;justify-content:center;font-family:' + T.fb + ';font-size:11px;color:' + T.text + ';letter-spacing:1px;';
    empty.textContent = 'AWAITING DATA';
    return empty;
  }

  var wrap = document.createElement('div');
  wrap.style.cssText = 'display:flex;flex-direction:column;justify-content:space-between;height:100%;';

  var buildRow = function(label, value, color) {
    var row = document.createElement('div');
    row.style.cssText = 'display:flex;justify-content:space-between;gap:10px;';
    var l = document.createElement('div');
    l.style.cssText = 'font-family:' + T.fb + ';font-size:10px;color:' + T.text + ';';
    l.textContent = label;
    var v = document.createElement('div');
    v.style.cssText = 'font-family:' + T.fb + ';font-size:10px;color:' + (color || T.text) + ';';
    v.textContent = value;
    row.appendChild(l);
    row.appendChild(v);
    return row;
  };

  var buildSect = function(text, color) {
    var h = document.createElement('div');
    h.style.cssText = 'background:' + T.well + ';padding:2px 6px;margin-bottom:6px;';
    var t = document.createElement('div');
    t.style.cssText = 'font-family:' + T.fb + ';font-size:9px;font-weight:700;color:' + (color || T.green) + ';text-transform:uppercase;letter-spacing:1px;';
    t.textContent = text;
    h.appendChild(t);
    return h;
  };

  // Header block
  var header = document.createElement('div');
  header.style.cssText = 'display:flex;flex-direction:column;align-items:center;';
  
  var storeName = document.createElement('div');
  storeName.style.cssText = 'font-family:' + T.fh + ';font-size:18px;font-weight:700;color:' + T.text + ';text-align:center;';
  storeName.textContent = (T.storeName || 'Store Name').toUpperCase();
  
  var dateLine = document.createElement('div');
  dateLine.style.cssText = 'font-family:' + T.fb + ';font-size:10px;color:' + T.text + ';text-align:center;margin-top:2px;';
  dateLine.textContent = new Date().toLocaleDateString('en-US', { month: '2-digit', day: '2-digit', year: 'numeric' });
  
  var divider = document.createElement('div');
  divider.style.cssText = 'height:1px;background:' + T.border + ';width:100%;margin-top:10px;';
  
  header.appendChild(storeName);
  header.appendChild(dateLine);
  header.appendChild(divider);
  wrap.appendChild(header);

  // Revenue block
  var rev = document.createElement('div');
  rev.appendChild(buildSect('REVENUE', T.gold));
  rev.appendChild(buildRow('Gross Sales', fmt(data.gross_sales || 0), T.gold));
  
  if ((data.voids_total || data.void_total || 0) > 0) {
    rev.appendChild(buildRow('Voids (' + (data.voids_count || data.void_count || 0) + ')', fmt(data.voids_total || data.void_total), T.verm));
  }
  if ((data.discounts_total || data.discount_total || 0) > 0) {
    rev.appendChild(buildRow('Discounts (' + (data.discounts_count || data.discount_count || 0) + ')', fmt(data.discounts_total || data.discount_total), T.verm));
  }
  
  var revDiv = document.createElement('div');
  revDiv.style.cssText = 'height:1px;background:' + T.border + ';margin:6px 0;opacity:0.3;';
  rev.appendChild(revDiv);
  
  var netRow = buildRow('NET SALES', fmt(data.net_sales || 0), T.gold);
  netRow.children[0].style.fontWeight = '700';
  netRow.children[0].style.fontSize = '11px';
  netRow.children[1].style.fontWeight = '700';
  netRow.children[1].style.fontSize = '11px';
  rev.appendChild(netRow);
  
  rev.appendChild(buildRow('Tax', fmt(data.tax_collected || data.tax_total || 0), T.gold));
  wrap.appendChild(rev);

  // Payments block
  var pay = document.createElement('div');
  pay.appendChild(buildSect('PAYMENTS', T.elec));
  pay.appendChild(buildRow('Cash (' + (data.cash_count || 0) + ')', fmt(data.cash_total || 0), T.gold));
  pay.appendChild(buildRow('Card (' + (data.card_count || 0) + ')', fmt(data.card_total || 0), T.elec));
  
  var payDiv = document.createElement('div');
  payDiv.style.cssText = 'height:1px;background:' + T.border + ';margin:6px 0;opacity:0.3;';
  pay.appendChild(payDiv);
  
  if ((data.total_tips || 0) > 0) {
    pay.appendChild(buildRow('Tips', fmt(data.total_tips), T.gold));
  }
  wrap.appendChild(pay);

  // Check Stats block
  var stats = document.createElement('div');
  stats.appendChild(buildSect('CHECK STATS', T.green));
  stats.appendChild(buildRow('Checks', data.check_count || data.total_checks || 0));
  stats.appendChild(buildRow('Avg Check', fmt(data.avg_check || 0), T.gold));
  if ((data.guest_count || 0) > 0) {
    stats.appendChild(buildRow('Covers', data.guest_count));
  }
  wrap.appendChild(stats);

  return wrap;
}

function buildReceiptEmptyState() {
  var wrap = document.createElement('div');
  wrap.style.cssText = 'flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:8px;opacity:0.45;';

  var icon = document.createElement('div');
  icon.style.cssText = [
    'width:36px;height:46px;border:1.5px solid ' + T.border + ';border-radius:3px;',
    'display:flex;flex-direction:column;justify-content:center;gap:4px;padding:6px 5px;',
  ].join('');
  [1, 1, 0.6].forEach(function(w) {
    var l = document.createElement('div');
    l.style.cssText = 'height:2px;background:' + T.border + ';width:' + (w * 100) + '%;';
    icon.appendChild(l);
  });

  var title = document.createElement('div');
  title.style.cssText = 'font-family:' + T.fh + ';font-size:12px;font-weight:700;color:' + T.text + ';letter-spacing:1.2px;';
  title.textContent = 'NOTHING SELECTED';

  var hint = document.createElement('div');
  hint.style.cssText = 'font-family:' + T.fb + ';font-size:11px;color:' + T.text + ';text-align:center;line-height:1.5;';
  hint.innerHTML = 'tap a check or tip row<br/>to pin it here';

  wrap.appendChild(icon);
  wrap.appendChild(title);
  wrap.appendChild(hint);
  return wrap;
}

function renderCheckPreview(paper, checks, allOrders) {
  var isMulti = checks.length > 1;
  var grandTotal = checks.reduce(function(s, c) { return s + (c.amount || 0); }, 0);

  // Header — "N CHECKS" + grand total on multi, check label + amount on single.
  var hdrRow = document.createElement('div');
  hdrRow.style.cssText = [
    'display:flex;justify-content:space-between;align-items:baseline;',
    'padding-bottom:8px;border-bottom:1px solid ' + hexToRgba(T.text, 0.1) + ';margin-bottom:4px;',
  ].join('');
  var hLabel = document.createElement('div');
  hLabel.style.cssText = 'font-family:' + T.fh + ';font-size:13px;font-weight:700;color:' + T.elec + ';letter-spacing:1px;';
  if (isMulti) {
    hLabel.textContent = checks.length + ' CHECKS';
  } else {
    hLabel.textContent = (checks[0].tableLabel ? checks[0].tableLabel + ' \u2022 ' : '') + checkNumDisplay(checks[0]);
  }
  var hTotal = document.createElement('div');
  hTotal.style.cssText = 'font-family:' + T.fh + ';font-size:14px;font-weight:700;color:' + T.gold + ';';
  hTotal.textContent = fmt(grandTotal);
  hdrRow.appendChild(hLabel);
  hdrRow.appendChild(hTotal);
  paper.appendChild(hdrRow);

  checks.forEach(function(chk, idx) {
    var fullOrder = (allOrders || []).find(function(o) {
      return o.order_id === (chk.checkId || chk.check_id);
    });

    if (isMulti) {
      // Sub-header per check when multiple selected
      var sub = document.createElement('div');
      sub.style.cssText = 'font-family:' + T.fh + ';font-size:11px;color:' + T.elec + ';letter-spacing:0.5px;margin-top:' + (idx === 0 ? '0' : '8px') + ';margin-bottom:2px;';
      sub.textContent = checkNumDisplay(chk) + (fullOrder && fullOrder.server_name ? ' \u00B7 ' + fullOrder.server_name.split(' ')[0].toUpperCase() : '');
      paper.appendChild(sub);
    } else if (fullOrder && fullOrder.server_name) {
      // Single-check: server name gets its own labeled row up top
      var srvLbl = document.createElement('div');
      srvLbl.style.cssText = 'font-family:' + T.fb + ';font-size:11px;color:' + T.elec + ';letter-spacing:0.5px;margin-bottom:4px;';
      srvLbl.textContent = fullOrder.server_name.toUpperCase();
      paper.appendChild(srvLbl);
    }

    if (!isMulti) {
      var metaRow = document.createElement('div');
      metaRow.style.cssText = 'display:flex;justify-content:space-between;font-family:' + T.fb + ';font-size:11px;color:' + T.text + ';opacity:0.55;margin-bottom:4px;';
      var mL = document.createElement('span');
      mL.textContent = chk.guests ? (chk.guests + ' guest' + (chk.guests > 1 ? 's' : '')) : '\u00A0';
      var mR = document.createElement('span');
      mR.textContent = chk.time ? ('opened ' + chk.time) : '';
      metaRow.appendChild(mL);
      metaRow.appendChild(mR);
      paper.appendChild(metaRow);
    }

    // Item rows — pulled from the full order record when present.
    var items = (fullOrder && fullOrder.items) || [];
    if (items.length === 0) {
      var empty = document.createElement('div');
      empty.style.cssText = 'font-family:' + T.fb + ';font-size:11px;color:' + T.text + ';opacity:0.5;font-style:italic;padding:6px 0;';
      empty.textContent = isMulti ? 'no items' : 'no items on this check';
      paper.appendChild(empty);
    } else {
      // Cap items per check on multi-select so the paper doesn't
      // stretch forever — 3 + "+N more".
      var showCap = isMulti ? 3 : items.length;
      items.slice(0, showCap).forEach(function(item) {
        var row = document.createElement('div');
        row.style.cssText = [
          'display:flex;justify-content:space-between;gap:8px;',
          'padding:3px 0;border-bottom:1px solid ' + hexToRgba(T.text, 0.06) + ';',
        ].join('');
        var nm = document.createElement('span');
        nm.style.cssText = 'font-family:' + T.fb + ';font-size:11px;color:' + T.text + ';';
        nm.textContent = (item.qty && item.qty > 1 ? item.qty + '\u00D7 ' : '') + (item.name || item.display_name || 'Item');
        var pr = document.createElement('span');
        pr.style.cssText = 'font-family:' + T.fb + ';font-size:11px;color:' + T.gold + ';flex-shrink:0;';
        pr.textContent = fmt((item.price || item.amount || 0) * (item.qty || 1));
        row.appendChild(nm);
        row.appendChild(pr);
        paper.appendChild(row);
      });
      if (items.length > showCap) {
        var more = document.createElement('div');
        more.style.cssText = 'font-family:' + T.fb + ';font-size:10px;color:' + T.text + ';opacity:0.55;padding-top:2px;';
        more.textContent = '+ ' + (items.length - showCap) + ' more';
        paper.appendChild(more);
      }
    }

    // Per-check totals — single-select only; multi shows the grand total in the header.
    if (!isMulti && fullOrder) {
      var sep = document.createElement('div');
      sep.style.cssText = 'height:1px;background:' + hexToRgba(T.text, 0.1) + ';margin:6px 0 2px;';
      paper.appendChild(sep);

      var addTotalRow = function(label, val, emphasis) {
        var r = document.createElement('div');
        r.style.cssText = [
          'display:flex;justify-content:space-between;padding:2px 0;',
          'font-family:' + T.fb + ';font-size:' + (emphasis ? '12px' : '11px') + ';',
          'color:' + T.text + ';opacity:' + (emphasis ? 1 : 0.65) + ';',
          emphasis ? 'font-weight:700;' : '',
        ].join('');
        var rL = document.createElement('span');
        rL.textContent = label;
        var rR = document.createElement('span');
        rR.style.cssText = 'color:' + T.gold + ';font-weight:' + (emphasis ? 700 : 400) + ';';
        rR.textContent = fmt(val);
        r.appendChild(rL);
        r.appendChild(rR);
        paper.appendChild(r);
      };

      if (fullOrder.subtotal != null) addTotalRow('subtotal', fullOrder.subtotal);
      if (fullOrder.tax != null && fullOrder.tax > 0) addTotalRow('tax', fullOrder.tax);
      addTotalRow('TOTAL', fullOrder.total || chk.amount || 0, true);
    }

    // Status stamp at the bottom on single-select
    if (!isMulti) {
      var stamp = document.createElement('div');
      var stampColor = chk.status === 'open' ? T.verm : (chk.status === 'closed' ? T.greenWarm : T.warning);
      stamp.style.cssText = 'margin-top:10px;padding-top:6px;font-family:' + T.fb + ';font-size:10px;color:' + stampColor + ';letter-spacing:3px;text-align:center;opacity:0.7;';
      stamp.textContent = '\u2014  ' + (chk.status || 'open').toUpperCase() + '  \u2014';
      paper.appendChild(stamp);
    }
  });
}

// ─────────────────────────────────────────────────
//  MIDDLE COLUMN — Adaptive card stack
// ─────────────────────────────────────────────────

function buildMiddleCol(data, handlers, state, rebuild) {
  var col = document.createElement('div');
  col.style.cssText = 'flex:1;display:flex;flex-direction:column;gap:10px;min-height:0;overflow:hidden;';

  var hasOpen  = data.openChecks.length > 0;
  var hasUnadj = data.unadjustedChecks.length > 0;
  var blocked  = hasOpen || hasUnadj;

  function addToggleHandler(card, cardKey) {
    // skip the accent bar (first child)
    var header = card.children[1] || card.firstChild;
    if (!header) return;
    header.style.cursor = 'pointer';
    header.style.userSelect = 'none';
    header.style.webkitUserSelect = 'none';
    header.style.pointerEvents = 'auto';
    header.style.touchAction = 'manipulation';
    header.addEventListener('pointerup', function(e) {
      e.stopPropagation();
      state.expandedCard = (state.expandedCard === cardKey) ? null : cardKey;
      rebuild();
    });
  }

  function wrapCard(card, cardKey) {
    var isExpanded = (state.expandedCard === cardKey);
    var wrapper = document.createElement('div');
    if (isExpanded) {
      wrapper.style.cssText = 'flex:1;min-height:0;display:flex;flex-direction:column;';
      card.style.flex = '1';
      card.style.minHeight = '0';
    } else {
      wrapper.style.cssText = 'flex-shrink:0;';
    }
    addToggleHandler(card, cardKey);
    wrapper.appendChild(card);
    return wrapper;
  }

  // Sales — always present, compact
  col.appendChild(buildSalesCard(data, blocked));

  // Open Checks — always renders
  var isExpanded = (state.expandedCard === 'open-checks');
  col.appendChild(wrapCard(
    isExpanded
      ? buildOpenChecksCard(data, handlers, state.selectedCheckIds)
      : buildOpenChecksCollapsed(data, handlers),
    'open-checks'
  ));

  // Tips — always present whenever there are closed card checks. Yellow
  // blocker when unadj > 0, otherwise a gold review card (EDIT rows).
  if (data.closedCardChecks.length > 0) {
    var isExpanded = (state.expandedCard === 'tips');
    col.appendChild(wrapCard(
      isExpanded
        ? buildTipsCard(data, handlers, state.tipFilter)
        : buildTipsCollapsed(data),
      'tips'
    ));
  }

  // Cash — full when clear, collapsed one-liner when blocked
  var isExpanded = (state.expandedCard === 'cash');
  var cashCard = isExpanded
    ? (blocked ? buildCashCollapsed(data, state) : buildCashFull(data, handlers, state))
    : buildCashCardCollapsed(data, state);
  col.appendChild(wrapCard(cashCard, 'cash'));

  // CC Batch — full when tips clear, collapsed "BLOCKED" when unadjusted tips
  var isExpanded = (state.expandedCard === 'cc-batch');
  var batchCard = isExpanded
    ? ((blocked && hasUnadj) ? buildCCBatchCollapsed(data, 'BLOCKED', 'resolve tips first') : buildCCBatchFull(data, handlers, state))
    : buildCCBatchCardCollapsed(data, state);
  col.appendChild(wrapCard(batchCard, 'cc-batch'));

  // Delivery — always collapsed placeholder in lite
  col.appendChild(buildDeliveryCard());

  return col;
}

// ── Base card shell ──
function buildBaseCard(opts) {
  opts = opts || {};
  var card = buildStaticCard({ accent: opts.accent || T.green });
  if (opts.stroke) card.style.border = '1.5px solid ' + opts.stroke;
  card.style.opacity = opts.dimmed ? '0.55' : '1';
  card.style.transition = 'opacity 0.2s';
  card.style.padding = '12px 16px';
  card.style.display = 'flex';
  card.style.flexDirection = 'column';
  card.style.gap = '8px';
  card.style.flexShrink = '0';

  return card;
}

// ── Sales (compact — hero + today/lastwk vertical bars) ──
function buildSalesCard(state, dimmed) {
  var card = buildBaseCard({ accent: T.gold, dimmed: false });

  var row = document.createElement('div');
  row.style.cssText = 'display:flex;align-items:center;gap:14px;';

  // Left: label + hero + meta
  var left = document.createElement('div');
  left.style.cssText = 'flex:1;min-width:0;display:flex;flex-direction:column;gap:2px;';

  var label = document.createElement('div');
  label.style.cssText = 'font-family:' + T.fh + ';font-size:12px;font-weight:700;color:' + T.text + ';letter-spacing:1.8px;';
  label.textContent = 'SALES';
  left.appendChild(label);

  var hero = document.createElement('div');
  hero.style.cssText = 'font-family:' + T.fh + ';font-size:' + FS_HERO + ';font-weight:700;color:' + T.gold + ';line-height:1.1;margin-top:2px;';
  hero.textContent = fmt(state.netSales);
  left.appendChild(hero);

  var meta = document.createElement('div');
  meta.style.cssText = 'font-family:' + T.fb + ';font-size:11px;color:' + T.text + ';opacity:0.55;';
  meta.textContent = state.totalChecks + ' check' + (state.totalChecks === 1 ? '' : 's') +
    '  \u2022  avg ' + fmt(state.avgCheck) +
    '  \u2022  tax ' + fmt(state.taxCollected);
  left.appendChild(meta);

  row.appendChild(left);

  // Middle: vertical bars (today / last week)
  var bars = buildSalesBars(state);
  row.appendChild(bars);

  // Right: delta
  var deltaCol = document.createElement('div');
  deltaCol.style.cssText = 'flex-shrink:0;display:flex;flex-direction:column;align-items:flex-end;gap:2px;min-width:72px;';

  var dVal = document.createElement('div');
  dVal.style.cssText = 'font-family:' + T.fb + ';font-size:12px;font-weight:700;color:' + deltaColor(state.salesDelta) + ';';
  dVal.textContent = fmtPct(state.salesDelta);

  var dLbl = document.createElement('div');
  dLbl.style.cssText = 'font-family:' + T.fb + ';font-size:9px;color:' + T.text + ';opacity:0.4;letter-spacing:0.5px;';
  dLbl.textContent = 'vs last wk';

  deltaCol.appendChild(dVal);
  deltaCol.appendChild(dLbl);
  row.appendChild(deltaCol);

  card.appendChild(row);
  return card;
}

function buildSalesBars(state) {
  var wrap = document.createElement('div');
  wrap.style.cssText = 'flex-shrink:0;display:flex;align-items:flex-end;gap:6px;height:40px;';

  // Scale to the max of (today, lastwk) so the taller bar is always 100%.
  var max = Math.max(state.netSales, state.lastWeekSales);
  var todayH = max > 0 ? Math.max(4, (state.netSales     / max) * 40) : 4;
  var lastH  = max > 0 ? Math.max(4, (state.lastWeekSales / max) * 40) : 0;

  var todayBar = buildSalesBar(todayH, T.elec);
  var lastBar  = buildSalesBar(lastH,  T.lavender);

  wrap.appendChild(todayBar);
  wrap.appendChild(lastBar);
  return wrap;
}

function buildSalesBar(h, color) {
  var rail = document.createElement('div');
  rail.style.cssText = [
    'width:20px;height:40px;position:relative;',
    'background:' + hexToRgba(color, 0.15) + ';border-radius:2px;',
  ].join('');
  var fill = document.createElement('div');
  fill.style.cssText = [
    'position:absolute;left:0;right:0;bottom:0;',
    'height:' + h + 'px;',
    'background:' + color + ';border-radius:2px;',
  ].join('');
  rail.appendChild(fill);
  return rail;
}

// ─────────────────────────────────────────────────
//  COLLAPSED CARD PREVIEWS
// ─────────────────────────────────────────────────

function buildOpenChecksCollapsed(state, handlers) {
  var card = buildBaseCard({ accent: T.verm });

  var hdr = document.createElement('div');
  hdr.style.cssText = 'display:flex;align-items:center;gap:10px;flex-shrink:0;';

  var icon = document.createElement('div');
  icon.style.cssText = [
    'width:18px;height:18px;border-radius:4px;flex-shrink:0;',
    'background:' + hexToRgba(T.verm, 0.18) + ';',
    'display:flex;align-items:center;justify-content:center;',
    'font-family:' + T.fb + ';font-size:14px;font-weight:700;color:' + T.verm + ';',
  ].join('');
  icon.textContent = '!';

  var title = document.createElement('span');
  title.style.cssText = 'flex:1;font-family:' + T.fh + ';font-size:' + FS_LABEL + ';font-weight:700;color:' + T.verm + ';letter-spacing:1.8px;';
  title.textContent = 'OPEN CHECKS \u2022 ' + state.openChecks.length;

  hdr.appendChild(icon);
  hdr.appendChild(title);

  if (state.openChecks.length > 0) {
    var sel = document.createElement('span');
    sel.style.cssText = 'font-family:' + T.fb + ';font-size:11px;color:' + T.text + ';opacity:0.55;letter-spacing:0.3px;';
    sel.textContent = state.openChecks.length + ' checks';
    hdr.appendChild(sel);
  }

  card.appendChild(hdr);

  if (state.openChecks.length > 0) {
    var list = document.createElement('div');
    list.style.cssText = 'display:flex;flex-direction:column;gap:4px;';
    state.openChecks.slice(0, 2).forEach(function(chk) {
      var row = document.createElement('div');
      row.style.cssText = 'display:flex;justify-content:space-between;align-items:baseline;';
      
      var left = document.createElement('div');
      left.style.cssText = 'display:flex;gap:6px;align-items:baseline;font-family:' + T.fb + ';font-size:13px;color:' + T.text + ';';
      
      var ckNo = document.createElement('span');
      ckNo.style.fontWeight = '700';
      ckNo.textContent = checkNumDisplay(chk);
      left.appendChild(ckNo);
      
      if (chk.tableLabel) {
        var tbl = document.createElement('span');
        tbl.style.opacity = '0.55';
        tbl.style.fontSize = '11px';
        tbl.textContent = '\u00B7 ' + chk.tableLabel;
        left.appendChild(tbl);
      }
      row.appendChild(left);
      
      var amt = document.createElement('div');
      amt.style.cssText = 'font-family:' + T.fh + ';font-size:13px;font-weight:700;color:' + T.gold + ';';
      amt.textContent = fmt(chk.amount || 0);
      row.appendChild(amt);
      
      list.appendChild(row);
    });
    card.appendChild(list);
  }

  if (state.openChecks.length > 2) {
    var more = document.createElement('div');
    more.style.cssText = 'font-family:' + T.fb + ';font-size:11px;color:' + T.text + ';opacity:0.45;padding-top:4px;';
    more.textContent = '\u2026and ' + (state.openChecks.length - 2) + ' more';
    card.appendChild(more);
  }

  return card;
}

function buildTipsCollapsed(state) {
  var hasUnadj = state.unadjustedChecks.length > 0;
  var accent = hasUnadj ? T.warning : T.gold;
  var card = buildBaseCard({ accent: accent });

  var hdr = document.createElement('div');
  hdr.style.cssText = 'display:flex;align-items:center;gap:10px;flex-shrink:0;';

  var icon = document.createElement('div');
  icon.style.cssText = [
    'width:18px;height:18px;border-radius:4px;flex-shrink:0;',
    'background:' + hexToRgba(accent, 0.18) + ';',
    'display:flex;align-items:center;justify-content:center;',
    'font-family:' + T.fb + ';font-size:14px;font-weight:700;color:' + accent + ';',
  ].join('');
  icon.textContent = hasUnadj ? '!' : '\u2713';

  var title = document.createElement('span');
  title.style.cssText = 'flex:1;font-family:' + T.fh + ';font-size:' + FS_LABEL + ';font-weight:700;color:' + accent + ';letter-spacing:1.8px;';
  title.textContent = hasUnadj
    ? 'UNADJUSTED TIPS \u2022 ' + state.unadjustedChecks.length
    : 'TIPS \u2022 ALL ADJUSTED';
  hdr.appendChild(icon);
  hdr.appendChild(title);
  card.appendChild(hdr);

  if (hasUnadj) {
    var list = document.createElement('div');
    list.style.cssText = 'display:flex;flex-direction:column;gap:6px;';
    state.unadjustedChecks.slice(0, 2).forEach(function(chk) {
      var row = document.createElement('div');
      row.style.cssText = 'display:flex;justify-content:space-between;align-items:baseline;padding:6px 10px;background:' + T.well + ';border-radius:6px;font-family:' + T.fb + ';font-size:13px;color:' + T.text + ';';
      
      var left = document.createElement('div');
      left.style.cssText = 'display:flex;gap:6px;align-items:baseline;';
      
      var name = document.createElement('span');
      name.style.fontWeight = '700';
      name.textContent = chk.server_name || 'Server';
      left.appendChild(name);
      
      var ck = document.createElement('span');
      ck.style.opacity = '0.5';
      ck.style.fontSize = '11px';
      ck.textContent = checkNumDisplay(chk);
      left.appendChild(ck);
      
      row.appendChild(left);
      
      var amt = document.createElement('div');
      amt.style.fontWeight = '700';
      amt.textContent = fmt(chk.amount || 0);
      row.appendChild(amt);
      
      list.appendChild(row);
    });
    card.appendChild(list);

    if (state.unadjustedChecks.length > 2) {
      var more = document.createElement('div');
      more.style.cssText = 'font-family:' + T.fb + ';font-size:11px;color:' + T.text + ';opacity:0.45;padding-top:4px;';
      more.textContent = '\u2026and ' + (state.unadjustedChecks.length - 2) + ' more';
      card.appendChild(more);
    }
  } else {
    var dim = document.createElement('div');
    dim.style.cssText = 'font-family:' + T.fb + ';font-size:12px;color:' + T.text + ';opacity:0.45;font-style:italic;padding:4px 0;';
    dim.textContent = 'all tips adjusted';
    card.appendChild(dim);
  }

  return card;
}

function buildCashCardCollapsed(state, sceneState) {
  var card = buildBaseCard({ accent: T.greenWarm });

  var hdr = document.createElement('div');
  hdr.style.cssText = 'display:flex;align-items:center;gap:10px;flex-shrink:0;';
  hdr.appendChild(cardLabel('CASH'));
  hdr.appendChild(flexSpacer());
  hdr.appendChild(statusChip(cashStatusLabel(sceneState), cashStatusColor(sceneState)));
  card.appendChild(hdr);

  var info = document.createElement('div');
  info.style.cssText = 'display:flex;justify-content:space-between;align-items:baseline;font-family:' + T.fb + ';font-size:13px;';
  
  var lbl = document.createElement('span');
  lbl.style.color = T.text;
  lbl.style.opacity = '0.75';
  lbl.textContent = 'Expected';
  
  var val = document.createElement('span');
  val.style.fontWeight = '700';
  val.style.color = T.gold;
  val.textContent = fmt(state.cashExpected);
  
  info.appendChild(lbl);
  info.appendChild(val);
  card.appendChild(info);

  return card;
}

function buildCCBatchCardCollapsed(state, sceneState) {
  var card = buildBaseCard({ accent: T.elec });

  var hdr = document.createElement('div');
  hdr.style.cssText = 'display:flex;align-items:center;gap:10px;flex-shrink:0;';
  hdr.appendChild(cardLabel('CC BATCH'));
  hdr.appendChild(flexSpacer());
  hdr.appendChild(statusChip(
    sceneState.batchSettled ? 'SETTLED' : 'PENDING',
    sceneState.batchSettled ? T.greenWarm : T.warning
  ));
  card.appendChild(hdr);

  card.appendChild(kvRow('Transactions', String(state.batchTransactions)));
  card.appendChild(kvRow('Batch Total', fmt(state.batchTotal), { valueColor: T.gold, valueWeight: 700 }));

  return card;
}

// ── Open Checks (inline blocker — tappable rows, pin to preview) ──
function buildOpenChecksCard(state, handlers, selectedCheckIds) {
  selectedCheckIds = selectedCheckIds || [];
  var card = buildBaseCard({ accent: T.verm });
  card.dataset.cardKey = 'open-checks';

  // Header — icon + title + hint
  var hdr = document.createElement('div');
  hdr.style.cssText = 'display:flex;align-items:center;gap:10px;flex-shrink:0;';

  var icon = document.createElement('div');
  icon.style.cssText = [
    'width:18px;height:18px;border-radius:4px;flex-shrink:0;',
    'background:' + hexToRgba(T.verm, 0.18) + ';',
    'display:flex;align-items:center;justify-content:center;',
    'font-family:' + T.fb + ';font-size:14px;font-weight:700;color:' + T.verm + ';',
  ].join('');
  icon.textContent = '!';

  var title = document.createElement('span');
  title.style.cssText = 'flex:1;font-family:' + T.fh + ';font-size:' + FS_LABEL + ';font-weight:700;color:' + T.verm + ';letter-spacing:1.8px;';
  title.textContent = 'OPEN CHECKS \u2022 ' + state.openChecks.length;

  var sel = document.createElement('span');
  sel.style.cssText = 'font-family:' + T.fb + ';font-size:11px;color:' + T.text + ';opacity:0.55;letter-spacing:0.3px;';
  sel.textContent = selectedCheckIds.length + ' of ' + state.openChecks.length + ' selected';

  hdr.appendChild(icon);
  hdr.appendChild(title);
  hdr.appendChild(sel);
  card.appendChild(hdr);

  // Rows list
  var list = document.createElement('div');
  list.style.cssText = 'display:flex;flex-direction:column;gap:6px;max-height:240px;overflow-y:auto;touch-action:pan-y;overscroll-behavior:contain;';
  state.openChecks.forEach(function(chk) {
    var id = chk.checkId || chk.check_id;
    var selected = selectedCheckIds.indexOf(id) !== -1;
    list.appendChild(buildOpenCheckRow(chk, handlers, selected));
  });
  card.appendChild(list);

  return card;
}

function buildOpenCheckRow(chk, handlers, selected) {
  var row = document.createElement('div');
  row.style.cssText = [
    'display:flex;align-items:center;gap:10px;',
    'padding:8px 10px;border-radius:6px;',
    selected
      ? 'background:' + hexToRgba(T.elec, 0.12) + ';border:1.5px solid ' + T.elec + ';'
      : 'background:' + T.well + ';border:1.5px solid transparent;',
    'cursor:pointer;user-select:none;-webkit-user-select:none;',
    'pointer-events:auto;touch-action:manipulation;',
    'transition:background 0.1s, border-color 0.1s;',
  ].join('');

  // Selection circle
  var mark = document.createElement('div');
  mark.style.cssText = [
    'flex-shrink:0;width:22px;height:22px;border-radius:999px;',
    'display:flex;align-items:center;justify-content:center;',
    'font-family:' + T.fb + ';font-size:13px;font-weight:700;',
    selected
      ? 'background:' + T.elec + ';color:' + T.well + ';'
      : 'background:transparent;border:1.5px solid ' + T.border + ';color:transparent;',
  ].join('');
  mark.textContent = selected ? '\u2713' : '';
  row.appendChild(mark);

  // Info
  var info = document.createElement('div');
  info.style.cssText = 'flex:1;display:flex;flex-direction:column;gap:1px;min-width:0;';

  var topLine = document.createElement('div');
  topLine.style.cssText = 'display:flex;align-items:baseline;gap:6px;';

  var ckNo = document.createElement('span');
  ckNo.style.cssText = 'font-family:' + T.fh + ';font-size:13px;font-weight:700;color:' + T.text + ';';
  ckNo.textContent = checkNumDisplay(chk);
  topLine.appendChild(ckNo);

  if (chk.tableLabel) {
    var tbl = document.createElement('span');
    tbl.style.cssText = 'font-family:' + T.fb + ';font-size:11px;color:' + T.text + ';opacity:0.55;';
    tbl.textContent = '\u00B7  ' + chk.tableLabel;
    topLine.appendChild(tbl);
  }
  info.appendChild(topLine);

  var botLine = document.createElement('div');
  botLine.style.cssText = 'display:flex;align-items:baseline;gap:8px;font-family:' + T.fb + ';font-size:11px;';

  if (chk.server_name) {
    var srv = document.createElement('span');
    srv.style.cssText = 'color:' + T.elec + ';font-weight:700;';
    srv.textContent = chk.server_name;
    botLine.appendChild(srv);
  }

  var age = document.createElement('span');
  // Age color — yellow flag at 30m+, just normal otherwise. We don't have
  // a reliable "opened at" timestamp without more backend plumbing, so
  // show the raw time string for now.
  age.style.cssText = 'color:' + T.text + ';opacity:0.6;';
  age.textContent = chk.time || '';
  botLine.appendChild(age);

  info.appendChild(botLine);
  row.appendChild(info);

  // Amount
  var amt = document.createElement('div');
  amt.style.cssText = 'flex-shrink:0;font-family:' + T.fh + ';font-size:15px;font-weight:700;color:' + T.gold + ';';
  amt.textContent = fmt(chk.amount || 0);
  row.appendChild(amt);

  row.addEventListener('pointerup', function() {
    if (handlers.onSelectCheck) handlers.onSelectCheck(chk);
  });

  return row;
}

// ── Tips (filterable UNADJ / ADJ) ──
function buildTipsCard(state, handlers, tipFilter) {
  var hasUnadj = state.unadjustedChecks.length > 0;
  var accent = hasUnadj ? T.warning : T.gold;

  var card = buildBaseCard({ accent: accent });
  card.dataset.cardKey = 'unadjusted-tips';

  // Resolve filter — default to unadjusted when any, adjusted when all done
  var filter = tipFilter || (hasUnadj ? 'unadjusted' : 'adjusted');

  // Header
  var hdr = document.createElement('div');
  hdr.style.cssText = 'display:flex;align-items:center;gap:10px;flex-shrink:0;flex-wrap:wrap;';

  var icon = document.createElement('div');
  icon.style.cssText = [
    'width:18px;height:18px;border-radius:4px;flex-shrink:0;',
    'background:' + hexToRgba(accent, 0.18) + ';',
    'display:flex;align-items:center;justify-content:center;',
    'font-family:' + T.fb + ';font-size:14px;font-weight:700;color:' + accent + ';',
  ].join('');
  icon.textContent = hasUnadj ? '!' : '\u2713';

  var title = document.createElement('span');
  title.style.cssText = 'flex:1;font-family:' + T.fh + ';font-size:' + FS_LABEL + ';font-weight:700;color:' + accent + ';letter-spacing:1.8px;';
  title.textContent = hasUnadj
    ? 'UNADJUSTED TIPS \u2022 ' + state.unadjustedChecks.length
    : 'TIPS \u2022 ALL ADJUSTED';

  hdr.appendChild(icon);
  hdr.appendChild(title);
  hdr.appendChild(buildTipFilterTabs(filter, state.unadjustedChecks.length, state.adjustedChecks.length, handlers));

  if (hasUnadj && tipFilter !== 'adjusted') {
    var zeroBtn = buildZeroRemainingBtn(handlers);
    hdr.appendChild(zeroBtn);
  }

  card.appendChild(hdr);

  // Row list
  var list = document.createElement('div');
  list.style.cssText = 'display:flex;flex-direction:column;gap:6px;max-height:240px;overflow-y:auto;touch-action:pan-y;overscroll-behavior:contain;';
  var showing = (filter === 'adjusted') ? state.adjustedChecks : state.unadjustedChecks;
  showing.forEach(function(chk) {
    list.appendChild(buildTipRow(chk, filter, handlers));
  });
  if (!showing.length) {
    var empty = document.createElement('div');
    empty.style.cssText = 'font-family:' + T.fb + ';font-size:12px;color:' + T.text + ';opacity:0.45;text-align:center;padding:10px 0;font-style:italic;';
    empty.textContent = filter === 'adjusted' ? 'no adjusted tips yet' : 'all tips adjusted \u2014 ready to settle';
    list.appendChild(empty);
  }
  card.appendChild(list);

  return card;
}

function buildTipFilterTabs(active, unadjCount, adjCount, handlers) {
  var wrap = document.createElement('div');
  wrap.style.cssText = 'display:flex;gap:6px;flex-shrink:0;';
  wrap.appendChild(makeTipTab('unadjusted', 'UNADJ', unadjCount, T.warning, active, handlers));
  wrap.appendChild(makeTipTab('adjusted',   'ADJ',   adjCount,   T.gold,     active, handlers));
  return wrap;
}

function makeTipTab(key, label, count, activeColor, activeFilter, handlers) {
  var active = activeFilter === key;
  var pill = document.createElement('div');
  pill.style.cssText = [
    'padding:4px 10px;border-radius:999px;',
    'font-family:' + T.fh + ';font-size:11px;font-weight:700;letter-spacing:1px;',
    'cursor:pointer;user-select:none;-webkit-user-select:none;',
    'pointer-events:auto;touch-action:manipulation;',
    active
      ? 'background:' + activeColor + ';color:' + T.well + ';'
      : 'background:transparent;color:' + T.text + ';opacity:0.65;border:1px solid ' + hexToRgba(T.text, 0.2) + ';',
  ].join('');
  pill.textContent = label + ' ' + count;
  pill.addEventListener('pointerup', function(e) {
    e.stopPropagation();
    if (handlers.onTipFilterChange) handlers.onTipFilterChange(key);
  });
  return pill;
}

function buildZeroRemainingBtn(handlers) {
  var btn = buildPillButton({
    label:    'ZERO REMAINING',
    color:    darkenHex(T.warning, 0.25),
    darkBg:   darkenHex(T.warning, 0.5),
    fontSize: '11px',
    padding:  '6px 14px'
  });

  var _timer = null;
  var _fired = false;

  btn.addEventListener('pointerdown', function(e) {
    e.stopPropagation();
    _fired = false;
    btn.style.transition = 'background-color 550ms linear';
    btn.style.backgroundColor = T.warning;
    _timer = setTimeout(function() {
      _fired = true;
      btn.style.transition = T.transitionFast;
      btn.style.backgroundColor = darkenHex(T.warning, 0.25);
      if (handlers.onZeroRemaining) handlers.onZeroRemaining();
    }, 550);
  });

  var _cancel = function() {
    if (_fired) return;
    clearTimeout(_timer);
    btn.style.transition = T.transitionFast;
    btn.style.backgroundColor = darkenHex(T.warning, 0.25);
  };

  btn.addEventListener('pointerup',     _cancel);
  btn.addEventListener('pointerleave',  _cancel);
  btn.addEventListener('pointercancel', _cancel);

  return btn;
}

function buildTipRow(chk, mode, handlers) {
  var row = document.createElement('div');
  row.style.cssText = [
    'display:flex;gap:10px;align-items:center;',
    'padding:8px 10px;background:' + T.well + ';border-radius:6px;',
    'pointer-events:auto;touch-action:manipulation;',
  ].join('');

  var info = document.createElement('div');
  info.style.cssText = 'flex:1;display:flex;flex-direction:column;gap:1px;min-width:0;';

  var topLine = document.createElement('div');
  topLine.style.cssText = 'display:flex;align-items:baseline;gap:6px;font-family:' + T.fb + ';font-size:13px;';
  var name = document.createElement('span');
  name.style.cssText = 'font-weight:700;color:' + T.text + ';';
  name.textContent = chk.server_name || 'Server';
  topLine.appendChild(name);
  var ckNo = document.createElement('span');
  ckNo.style.cssText = 'color:' + T.text + ';opacity:0.55;';
  ckNo.textContent = '\u00B7  ' + checkNumDisplay(chk);
  topLine.appendChild(ckNo);
  info.appendChild(topLine);

  var botLine = document.createElement('div');
  botLine.style.cssText = 'font-family:' + T.fb + ';font-size:11px;color:' + T.text + ';opacity:0.55;';
  botLine.textContent = 'closed' + (chk.time ? ' ' + chk.time : '') + (chk.cardBrand ? '  \u2022  ' + chk.cardBrand : '');
  info.appendChild(botLine);

  row.appendChild(info);

  // Subtotal + tip column
  var nums = document.createElement('div');
  nums.style.cssText = 'flex-shrink:0;display:flex;flex-direction:column;align-items:flex-end;gap:1px;';
  var sub = document.createElement('div');
  sub.style.cssText = 'font-family:' + T.fb + ';font-size:12px;color:' + T.gold + ';font-weight:700;';
  sub.textContent = fmt(chk.amount || 0);
  var tip = document.createElement('div');
  if (mode === 'adjusted') {
    tip.style.cssText = 'font-family:' + T.fb + ';font-size:11px;color:' + T.greenWarm + ';';
    tip.textContent = 'tip ' + fmt(chk.tip || 0);
  } else {
    tip.style.cssText = 'font-family:' + T.fb + ';font-size:11px;color:' + T.warning + ';';
    tip.textContent = 'tip \u2014 pending';
  }
  nums.appendChild(sub);
  nums.appendChild(tip);
  row.appendChild(nums);

  // Action pill
  var pill;
  if (mode === 'adjusted') {
    pill = buildPillButton({
      label:   'EDIT',
      variant: 'ghost',
      fontSize: '11px',
      padding: '8px 18px',
      onClick: function() { if (handlers.onEditTip) handlers.onEditTip(chk); },
    });
  } else {
    pill = buildPillButton({
      label:   'ADJUST',
      color:   T.warning,
      darkBg:  darkenHex(T.warning, 0.35),
      fontSize: '11px',
      padding: '8px 18px',
      onClick: function() { if (handlers.onAdjustTip) handlers.onAdjustTip(chk); },
    });
  }
  row.appendChild(pill);

  return row;
}

// ── Cash: full card (direct entry + BYPASS) ──
function buildCashFull(state, handlers, sceneState) {
  var card = buildBaseCard({ accent: T.greenWarm });

  var hdr = document.createElement('div');
  hdr.style.cssText = 'display:flex;align-items:center;gap:10px;';
  hdr.appendChild(cardLabel('CASH'));
  hdr.appendChild(flexSpacer());
  hdr.appendChild(statusChip(cashStatusLabel(sceneState), cashStatusColor(sceneState)));
  card.appendChild(hdr);

  // Expected row
  card.appendChild(kvRow('EXPECTED IN DRAWER', fmt(state.cashExpected), { valueColor: T.gold, valueSize: FS_AMOUNT, labelTiny: true }));

  // Counted row — label + input + BYPASS pill
  var cntRow = document.createElement('div');
  cntRow.style.cssText = 'display:flex;align-items:center;gap:8px;';
  var cntLbl = document.createElement('span');
  cntLbl.style.cssText = 'font-family:' + T.fb + ';font-size:13px;color:' + T.text + ';opacity:0.75;flex:1;';
  cntLbl.textContent = 'Counted';
  cntRow.appendChild(cntLbl);

  var input = document.createElement('input');
  input.type = 'text';
  input.inputMode = 'decimal';
  input.placeholder = '$0.00';
  input.value = sceneState.cashCounted != null && sceneState.cashCounted !== 'bypass'
    ? fmt(sceneState.cashCounted)
    : '';
  input.style.cssText = [
    'width:140px;height:30px;box-sizing:border-box;padding:0 10px;',
    'background:' + T.well + ';border:1px solid ' + hexToRgba(T.border, 0.5) + ';',
    'border-radius:6px;',
    'font-family:' + T.fb + ';font-size:13px;font-weight:700;color:' + T.text + ';',
    'text-align:right;outline:none;',
    sceneState.cashCounted === 'bypass' ? 'opacity:0.4;' : '',
  ].join('');
  input.disabled = sceneState.cashCounted === 'bypass';
  input.addEventListener('change', function() {
    var n = parseFloat(String(input.value).replace(/[^0-9.\-]/g, ''));
    if (!isNaN(n)) {
      if (handlers.onCashInput) handlers.onCashInput(n);
    }
  });
  input.addEventListener('keydown', function(e) { if (e.key === 'Enter') input.blur(); });
  cntRow.appendChild(input);

  var bypass = buildPillButton({
    label:   sceneState.cashCounted === 'bypass' ? 'COUNTED' : 'BYPASS',
    variant: 'ghost',
    padding: '8px 20px',
    onClick: function() { if (handlers.onCashBypass) handlers.onCashBypass(); },
  });
  cntRow.appendChild(bypass);
  card.appendChild(cntRow);

  // Variance row
  var variance = cashVariance(state, sceneState);
  var varColor = variance === 0 ? T.greenWarm : (Math.abs(variance) > 5 ? T.verm : T.warning);
  var varText = sceneState.cashCounted === 'bypass'
    ? '\u2014 bypassed \u2014'
    : (sceneState.cashCounted == null ? '—' : '\u00B1 ' + fmt(Math.abs(variance)));
  card.appendChild(kvRow('Variance', varText, { valueColor: varColor, valueWeight: 700, valueSize: '14px' }));

  return card;
}

function cashVariance(state, sceneState) {
  if (sceneState.cashCounted == null || sceneState.cashCounted === 'bypass') return 0;
  return parseFloat((sceneState.cashCounted - state.cashExpected).toFixed(2));
}

function cashStatusLabel(sceneState) {
  if (sceneState.cashCounted === 'bypass') return 'BYPASSED';
  if (sceneState.cashCounted != null)      return 'DONE';
  return 'PENDING';
}

function cashStatusColor(sceneState) {
  if (sceneState.cashCounted === 'bypass') return T.lavender;
  if (sceneState.cashCounted != null)      return T.greenWarm;
  return T.warning;
}

// ── Cash: collapsed one-liner ──
function buildCashCollapsed(state, sceneState) {
  var card = buildBaseCard({ accent: T.greenWarm });
  card.style.padding = '10px 16px';

  var row = document.createElement('div');
  row.style.cssText = 'display:flex;align-items:center;gap:10px;';
  row.appendChild(cardLabel('CASH'));
  row.appendChild(statusChip(cashStatusLabel(sceneState), cashStatusColor(sceneState)));
  row.appendChild(flexSpacer());

  var summary = document.createElement('span');
  summary.style.cssText = 'font-family:' + T.fb + ';font-size:12px;color:' + T.text + ';opacity:0.75;';
  if (sceneState.cashCounted === 'bypass') {
    summary.textContent = 'bypassed  \u2022  expected ' + fmt(state.cashExpected);
  } else if (sceneState.cashCounted != null) {
    var v = cashVariance(state, sceneState);
    summary.textContent = 'counted ' + fmt(sceneState.cashCounted) + '  \u2022  \u00B1 ' + fmt(Math.abs(v));
  } else {
    summary.textContent = 'expected ' + fmt(state.cashExpected) + '  \u2022  not counted';
  }
  row.appendChild(summary);

  card.appendChild(row);
  return card;
}

// ── CC Batch: full card (SETTLE step) ──
function buildCCBatchFull(state, handlers, sceneState) {
  var card = buildBaseCard({ accent: T.elec });

  var hdr = document.createElement('div');
  hdr.style.cssText = 'display:flex;align-items:center;gap:10px;';
  hdr.appendChild(cardLabel('CC BATCH'));
  hdr.appendChild(flexSpacer());
  if (sceneState.batchSettled) {
    hdr.appendChild(statusChip('SETTLED', T.greenWarm));
  } else {
    hdr.appendChild(statusChip('PENDING', T.warning));
  }
  card.appendChild(hdr);

  card.appendChild(kvRow('Transactions', String(state.batchTransactions)));
  card.appendChild(kvRow('Batch Total', fmt(state.batchTotal), { valueColor: T.gold, valueWeight: 700 }));

  // SETTLE button — or SETTLED stamp
  if (sceneState.batchSettled) {
    var stamp = document.createElement('div');
    stamp.style.cssText = [
      'margin-top:4px;padding:8px 0;text-align:center;',
      'background:' + hexToRgba(T.greenWarm, 0.12) + ';border-radius:6px;',
      'font-family:' + T.fh + ';font-size:11px;font-weight:700;color:' + T.greenWarm + ';letter-spacing:1.5px;',
    ].join('');
    stamp.textContent = '\u2713  SETTLED';
    card.appendChild(stamp);
  } else {
    var btnWrap = document.createElement('div');
    btnWrap.style.cssText =
      'display:flex;justify-content:center;margin-top:8px;';

    var btn = buildPillButton({
      label:   'SETTLE BATCH',
      variant: 'elec',
      shape:   'chamfer',
      fontSize: FS_PILL_LG,
      padding: '12px 28px',
      onClick: function() { if (handlers.onSettleBatch) handlers.onSettleBatch(); },
    });
    btn.style.letterSpacing = '1.5px';
    btnWrap.appendChild(btn);
    card.appendChild(btnWrap);
  }

  return card;
}

// ── CC Batch: collapsed one-liner ──
function buildCCBatchCollapsed(state, chipText, summary) {
  var card = buildBaseCard({ accent: T.elec });
  card.style.padding = '10px 16px';

  var row = document.createElement('div');
  row.style.cssText = 'display:flex;align-items:center;gap:10px;';
  row.appendChild(cardLabel('CC BATCH'));
  row.appendChild(statusChip(chipText, T.verm));
  row.appendChild(flexSpacer());

  var s = document.createElement('span');
  s.style.cssText = 'font-family:' + T.fb + ';font-size:12px;color:' + T.text + ';opacity:0.55;';
  s.textContent = state.batchTransactions + ' txns  \u2022  ' + fmt(state.batchTotal) + '  \u2022  ' + summary;
  row.appendChild(s);

  card.appendChild(row);
  return card;
}

// ── Delivery: placeholder ──
function buildDeliveryCard() {
  var card = buildBaseCard({ accent: T.lavender });
  card.style.padding = '10px 16px';

  var row = document.createElement('div');
  row.style.cssText = 'display:flex;align-items:center;gap:10px;';
  row.appendChild(cardLabel('DELIVERY INFO'));
  row.appendChild(statusChip('PLACEHOLDER', T.lavender));
  row.appendChild(flexSpacer());

  var s = document.createElement('span');
  s.style.cssText = 'font-family:' + T.fb + ';font-size:12px;color:' + T.text + ';opacity:0.4;font-style:italic;';
  s.textContent = 'deferred to premium';
  row.appendChild(s);

  card.appendChild(row);
  return card;
}

// ── Small shared atoms ──
function cardLabel(text) {
  var el = document.createElement('span');
  el.style.cssText = 'font-family:' + T.fh + ';font-size:' + FS_LABEL + ';font-weight:700;color:' + T.text + ';letter-spacing:1.8px;flex-shrink:0;';
  el.textContent = text;
  return el;
}

function flexSpacer() {
  var el = document.createElement('div');
  el.style.cssText = 'flex:1;';
  return el;
}

function statusChip(text, color) {
  var el = document.createElement('span');
  el.style.cssText = [
    'padding:3px 10px;border-radius:999px;',
    'background:' + hexToRgba(color, 0.13) + ';border:1px solid ' + color + ';',
    'font-family:' + T.fh + ';font-size:10px;font-weight:700;color:' + color + ';letter-spacing:1px;',
    'flex-shrink:0;',
  ].join('');
  el.textContent = text;
  return el;
}

function kvRow(label, value, opts) {
  opts = opts || {};
  var row = document.createElement('div');
  row.style.cssText = 'display:flex;justify-content:space-between;align-items:baseline;';

  var l = document.createElement('span');
  l.style.cssText = 'font-family:' + T.fb + ';font-size:' + (opts.labelTiny ? '11px' : '13px') + ';color:' + T.text + ';opacity:' + (opts.labelTiny ? 0.5 : 0.75) + ';letter-spacing:' + (opts.labelTiny ? '1.2px' : '0') + ';';
  l.textContent = label;

  var v = document.createElement('span');
  v.style.cssText = 'font-family:' + T.fb + ';font-size:' + (opts.valueSize || '13px') + ';font-weight:' + (opts.valueWeight || 400) + ';color:' + (opts.valueColor || T.text) + ';';
  v.textContent = value;

  row.appendChild(l);
  row.appendChild(v);
  return row;
}

// ─────────────────────────────────────────────────
//  RIGHT COLUMN — Actions
// ─────────────────────────────────────────────────

function buildActionsCol(state, handlers, sceneState) {
  var blocked = state.openChecks.length + state.unadjustedChecks.length > 0;
  var lockReady = !blocked && sceneState.batchSettled && sceneState.cashCounted != null;

  var col = buildStaticCard({ accent: T.lavender });
  col.style.cssText += [
    'flex-shrink:0;width:' + RIGHT_W + 'px;',
    'padding:14px 16px;box-sizing:border-box;',
    'display:flex;flex-direction:column;gap:10px;',
  ].join('');

  var title = cardLabel('ACTIONS');
  col.appendChild(title);

  // BACK pill
  var backBtn = buildPillButton({
    variant: 'ghost',
    shape: 'chamfer',
    fontSize: FS_PILL_LG,
    padding: '10px 14px',
    onClick: function() { if (handlers.onBack) handlers.onBack(); },
  });
  backBtn.textContent = 'BACK';
  col.appendChild(backBtn);

  // ALL CHECKS pill
  var allBtn = buildPillButton({
    variant: 'ghost',
    shape: 'chamfer',
    fontSize: FS_PILL_LG,
    padding: '10px 14px',
    onClick: function() { if (handlers.onAllChecks) handlers.onAllChecks(); },
  });
  allBtn.textContent = 'ALL CHECKS  \u00B7  ' + state.totalChecks;
  col.appendChild(allBtn);

  // BLOCKERS queue (when blocked)
  if (blocked) {
    col.appendChild(buildBlockerQueue(state, handlers));
  }

  // LOCK SNAPSHOT (dimmed while blocked)
  col.appendChild(buildLockSnapshot(state, sceneState, !lockReady));

  // Flex spacer to push LOCK DAY to the bottom
  col.appendChild(flexSpacer());

  // LOCK DAY mega-pill
  col.appendChild(buildLockDayPill({
    blocked: blocked,
    lockReady: lockReady,
    openCount: state.openChecks.length,
    unadjCount: state.unadjustedChecks.length,
    batchSettled: sceneState.batchSettled,
    cashCounted: sceneState.cashCounted,
    onClick: function() { if (handlers.onLockDay) handlers.onLockDay(); },
  }));

  return col;
}

function buildBlockerQueue(state, handlers) {
  var wrap = document.createElement('div');
  wrap.style.cssText = [
    'flex-shrink:0;background:' + T.well + ';border-radius:8px;padding:10px 12px;',
    'display:flex;flex-direction:column;gap:6px;',
  ].join('');

  var title = document.createElement('div');
  title.style.cssText = 'font-family:' + T.fh + ';font-size:11px;font-weight:700;color:' + T.verm + ';letter-spacing:1.5px;';
  title.textContent = 'BLOCKERS';
  wrap.appendChild(title);

  if (state.openChecks.length > 0) {
    wrap.appendChild(buildBlockerQueueRow({
      accent: T.verm,
      label:  state.openChecks.length + ' open check' + (state.openChecks.length > 1 ? 's' : ''),
      cardKey: 'open-checks',
      onJump: handlers.onJumpToCard,
    }));
  }
  if (state.unadjustedChecks.length > 0) {
    wrap.appendChild(buildBlockerQueueRow({
      accent: T.warning,
      label:  state.unadjustedChecks.length + ' unadj CC tip' + (state.unadjustedChecks.length > 1 ? 's' : ''),
      cardKey: 'unadjusted-tips',
      onJump: handlers.onJumpToCard,
    }));
  }

  return wrap;
}

function buildBlockerQueueRow(opts) {
  var row = document.createElement('div');
  row.style.cssText = [
    'display:flex;align-items:center;gap:8px;',
    'padding:6px 10px;background:' + T.bg + ';border-radius:6px;',
    'cursor:pointer;user-select:none;-webkit-user-select:none;',
    'pointer-events:auto;touch-action:manipulation;',
  ].join('');

  var dot = document.createElement('div');
  dot.style.cssText = 'width:6px;height:6px;border-radius:999px;background:' + opts.accent + ';flex-shrink:0;';
  row.appendChild(dot);

  var lbl = document.createElement('div');
  lbl.style.cssText = 'flex:1;font-family:' + T.fb + ';font-size:11px;font-weight:700;color:' + T.text + ';';
  lbl.textContent = opts.label;
  row.appendChild(lbl);

  var arrow = document.createElement('div');
  arrow.style.cssText = 'font-family:' + T.fh + ';font-size:10px;font-weight:700;color:' + opts.accent + ';';
  arrow.textContent = '\u2191';
  row.appendChild(arrow);

  row.addEventListener('pointerup', function() {
    if (opts.onJump) opts.onJump(opts.cardKey);
  });
  return row;
}

function buildLockSnapshot(state, sceneState, dimmed) {
  var wrap = document.createElement('div');
  wrap.style.cssText = 'flex-shrink:0;display:flex;flex-direction:column;gap:6px;opacity:' + (dimmed ? 0.4 : 1) + ';transition:opacity 0.2s;';

  var label = document.createElement('div');
  label.style.cssText = 'font-family:' + T.fb + ';font-size:10px;color:' + T.text + ';opacity:0.6;letter-spacing:1.2px;';
  label.textContent = 'THE LOCK SNAPSHOT';
  wrap.appendChild(label);

  var countedCash = sceneState.cashCounted === 'bypass'
    ? state.cashExpected
    : (sceneState.cashCounted != null ? sceneState.cashCounted : state.cashExpected);

  [
    { label: 'Net Sales',     value: fmt(state.netSales),     color: T.gold, bold: true },
    { label: 'Cash Counted',  value: fmt(countedCash),        color: T.gold, bold: true },
    { label: 'CC Batch',      value: fmt(state.batchTotal),   color: T.text, bold: true },
    { label: 'Total Tips',    value: fmt(state.totalTips),    color: T.text, bold: true },
  ].forEach(function(item) {
    var row = document.createElement('div');
    row.style.cssText = 'display:flex;justify-content:space-between;align-items:baseline;font-family:' + T.fb + ';font-size:12px;';
    var l = document.createElement('span');
    l.style.cssText = 'color:' + T.text + ';opacity:0.75;';
    l.textContent = item.label;
    var v = document.createElement('span');
    v.style.cssText = 'color:' + item.color + ';font-weight:' + (item.bold ? 700 : 400) + ';';
    v.textContent = item.value;
    row.appendChild(l);
    row.appendChild(v);
    wrap.appendChild(row);
  });

  return wrap;
}

function buildLockDayPill(opts) {
  var disabled = !opts.lockReady;

  // Build the "why disabled" subtitle
  var reason = '';
  if (disabled) {
    if (opts.blocked) {
      var n = opts.openCount + opts.unadjCount;
      reason = 'resolve ' + n + ' blocker' + (n > 1 ? 's' : '') + ' first';
    } else if (!opts.batchSettled) {
      reason = 'settle batch first';
    } else if (opts.cashCounted == null) {
      reason = 'count drawer first';
    }
  }

  var btn = buildPillButton({
    label: '\uD83D\uDD12  LOCK DAY',
    variant: disabled ? 'ghost' : 'goGreen',
    disabled: disabled,
    shape: 'chamfer',
    fontSize: FS_PILL_LG,
    padding: '12px 14px',
    onClick: opts.onClick,
  });
  btn.style.height = '58px';
  btn.style.flexDirection = 'column';
  if (disabled) btn.style.opacity = '0.45';
  else btn.style.boxShadow = '0 3px 0 ' + darkenHex(T.greenWarm, 0.5);

  if (reason) {
    var sub = document.createElement('div');
    sub.style.cssText = 'font-family:' + T.fb + ';font-size:10px;color:' + T.verm + ';opacity:0.75;font-weight:normal;letter-spacing:0;text-transform:none;';
    sub.textContent = reason;
    btn.appendChild(sub);
  }

  return btn;
}

// ═══════════════════════════════════════════════════
//  SCENE DEFINITION
// ═══════════════════════════════════════════════════

defineScene({
  name: 'close-day',
  state: {
    data:              null,
    tipFilter:         null,        // 'unadjusted' | 'adjusted'
    cashCounted:       null,        // null | number | 'bypass'
    batchSettled:      false,
    selectedCheckIds:  [],
    startTime:         null,
    expandedCard:      undefined,
    _defaultSet:       false,
  },

  render: function(container, params, state) {
    params = params || {};
    state.startTime = state.startTime || Date.now();

    // close-day owns the esc button while it's the visible transactional.
    // close-day-checks-viewer opens on top and sets its own handler (then
    // clears it on unmount), so re-apply ours whenever a child transactional
    // closes — otherwise esc would silently lose its target.
    function applyBack() {
      if (window._header && window._header.setBackHandler) {
        window._header.setBackHandler(function() {
          SceneManager.closeTransactional('close-day');
        });
      }
    }
    function _onChildClosed(evt) {
      if (evt && evt.sceneName !== 'close-day') applyBack();
    }
    applyBack();
    SceneManager.on('transactional:closed', _onChildClosed);
    state._onChildClosed = _onChildClosed;

    container.style.cssText = [
      'width:100%;height:100%;',
      'display:flex;flex-direction:column;gap:' + T.colGapSm + 'px;',
      'padding:' + PAD_TOP + 'px ' + PAD + 'px ' + PAD + 'px ' + PAD + 'px;',
      'box-sizing:border-box;overflow:hidden;',
      'background:' + T.bg + ';',
    ].join('');

    function refreshScene() {
      fetchCloseDayState(params).then(function(newData) {
        state.data = newData;
        if (!state._defaultSet) {
          state._defaultSet = true;
          if (newData.openChecks.length > 0)
            state.expandedCard = 'open-checks';
          else if (newData.unadjustedChecks.length > 0)
            state.expandedCard = 'tips';
          else if (!state.batchSettled)
            state.expandedCard = 'cc-batch';
          else
            state.expandedCard = null;
        }
        rebuild();
      }).catch(function(err) {
        console.error('[close-day] fetch failed:', err);
        showToast('Close day data unavailable', { bg: T.verm });
      });
    }

    function rebuild() {
      if (!state.data) return;
      container.innerHTML = '';

      // Optional blocker banner
      var banner = buildBlockerBanner(state.data);
      if (banner) container.appendChild(banner);

      // 3-col row
      var body = document.createElement('div');
      body.style.cssText = 'flex:1;display:flex;gap:' + T.colGapSm + 'px;min-height:0;overflow:hidden;';

      // Stale-cleanup on selection (check got paid elsewhere, etc.)
      state.selectedCheckIds = state.selectedCheckIds.filter(function(id) {
        return state.data.openChecks.some(function(c) { return (c.checkId || c.check_id) === id; });
      });
      var selectedChecks = state.selectedCheckIds.map(function(id) {
        return state.data.openChecks.find(function(c) { return (c.checkId || c.check_id) === id; });
      }).filter(Boolean);

      body.appendChild(buildReceiptCol(state.data, selectedChecks, state.data.allOrders, handlers));
      body.appendChild(buildMiddleCol(state.data, handlers, state, rebuild));
      body.appendChild(buildActionsCol(state.data, handlers, state));

      container.appendChild(body);
    }

    // ── Handlers ──
    var handlers = {
      onBack: function() {
        SceneManager.closeTransactional('close-day');
      },

      onAllChecks: function() {
        // Opens the full-day checks viewer transactional. The viewer fetches
        // its own state on mount, so we only pass auth context and a
        // return-callback. When the viewer closes, we refresh so any
        // transfers/prints/voids done in there show up here immediately.
        SceneManager.openTransactional('close-day-checks-viewer', {
          managerId:    state.data.managerId,
          managerName:  state.data.managerName,
          onBack: function() {
            SceneManager.closeTransactional('close-day-checks-viewer');
            refreshScene();
          },
        });
      },

      onSelectCheck: function(chk) {
        var id = chk.checkId || chk.check_id;
        var idx = state.selectedCheckIds.indexOf(id);
        if (idx !== -1) state.selectedCheckIds.splice(idx, 1);
        else            state.selectedCheckIds.push(id);
        rebuild();
      },

      onTipFilterChange: function(filter) {
        state.tipFilter = filter;
        rebuild();
      },

      onAdjustTip: function(chk) {
        // Reuse server-checkout's single-adjust transactional.
        SceneManager.openTransactional('co-adjust-single', {
          check: chk,
          onDone: function() { refreshScene(); },
        });
      },

      onEditTip: function(chk) {
        SceneManager.openTransactional('co-adjust-single', {
          check: chk,
          initialTip: chk.tip,
          mode: 'edit',
          onDone: function() { refreshScene(); },
        });
      },

      onZeroRemaining: function() {
        var checks = state.data.unadjustedChecks;
        if (!checks || !checks.length) return;

        var posts = checks.map(function(chk) {
          return fetch(
            '/api/v1/orders/' + (chk.checkId || chk.check_id) + '/tip',
            {
              method:  'PATCH',
              headers: { 'Content-Type': 'application/json' },
              body:    JSON.stringify({ tip_amount: 0 }),
            }
          )
          .then(function(r) {
            return { ok: r.ok, status: r.status };
          })
          .catch(function() {
            return { ok: false, status: 0 };
          });
        });

        Promise.all(posts).then(function(results) {
          var ok     = results.filter(function(r) { return  r.ok; });
          var failed = results.filter(function(r) { return !r.ok; });
          if (failed.length === 0) {
            showToast(
              ok.length + ' tip' + (ok.length > 1 ? 's' : '') + ' zeroed',
              { bg: T.greenWarm }
            );
          } else if (ok.length > 0) {
            showToast(
              ok.length + ' zeroed, ' + failed.length + ' failed',
              { bg: T.warning }
            );
          } else {
            showToast('Failed — try again', { bg: T.verm });
          }
          refreshScene();
        });
      },

      onCashInput: function(n) {
        state.cashCounted = n;
        rebuild();
      },

      onCashBypass: function() {
        state.cashCounted = state.cashCounted === 'bypass' ? null : 'bypass';
        rebuild();
      },

      onSettleBatch: function() {
        // Gate — if unadjusted tips exist, never proceed.
        if (state.data.unadjustedChecks.length > 0) {
          showToast('Adjust all tips before settling the batch', { bg: T.verm });
          return;
        }
        showToast('Settling batch\u2026', { bg: T.elec });
        fetch('/api/v1/payments/batch-settle', { method: 'POST' })
          .then(function(r) {
            if (r.ok) {
              state.batchSettled = true;
              showToast('Batch settled', { bg: T.greenWarm });
              rebuild();
            } else if (r.status === 404) {
              showToast('Settle endpoint pending — backend work needed', { bg: T.warning });
            } else {
              showToast('Settle failed (' + r.status + ') — try again', { bg: T.verm });
            }
          })
          .catch(function() {
            showToast('Settle unavailable — check connection', { bg: T.verm });
          });
      },

      onLockDay: function() {
        // Full lock flow, mirrors server-checkout's onFinalize:
        //   co-manager-pin  →  co-finalize-confirm  →  POST
        SceneManager.interrupt('co-manager-pin', {
          onConfirm: function() {
            SceneManager.closeInterrupt('co-manager-pin');
            setTimeout(function() {
              var countedCash = state.cashCounted === 'bypass'
                ? state.data.cashExpected
                : (state.cashCounted != null ? state.cashCounted : state.data.cashExpected);

              SceneManager.interrupt('co-finalize-confirm', {
                // Reusing the existing interrupt verbatim — its labels read
                // "TAKE-HOME / CASH EXPECTED" which map naturally onto the
                // store totals (net sales / cash counted). Parameterizing
                // labels is a separate refactor.
                takeHome:     state.data.netSales,
                cashExpected: countedCash,
                employeeName: state.data.managerName,
                onConfirm: function() {
                  SceneManager.closeInterrupt('co-finalize-confirm');
                  doLockDay(countedCash);
                },
                onCancel: function() {
                  SceneManager.closeInterrupt('co-finalize-confirm');
                },
              });
            }, 80);
          },
          onCancel: function() {
            SceneManager.closeInterrupt('co-manager-pin');
          },
        });
      },

      onJumpToCard: function(cardKey) {
        var target = container.querySelector('[data-card-key="' + cardKey + '"]');
        if (!target) return;
        target.scrollIntoView({ behavior: 'smooth', block: 'start' });
        var original = target.style.boxShadow;
        target.style.transition = 'box-shadow 0.3s ease';
        target.style.boxShadow = '0 0 0 3px ' + hexToRgba(T.text, 0.35);
        setTimeout(function() { target.style.boxShadow = original || ''; }, 600);
      },

      // ── Selection-scoped actions (match server-checkout exactly) ──

      onDismissPreview: function() {
        state.selectedCheckIds = [];
        rebuild();
      },

      onTransferChecks: function(checks) {
        // Open server picker → on confirm, POST transfer for each selection.
        // Partial-failure aware: if some transfers fail, we surface the count
        // and refetch so the UI reflects whatever succeeded.
        SceneManager.interrupt('co-transfer-picker', {
          checks: checks,
          currentEmpId: state.data.managerId,
          onConfirm: function(destServer) {
            SceneManager.closeInterrupt('co-transfer-picker');

            var transfers = checks.map(function(chk) {
              return fetch('/api/v1/orders/' + (chk.checkId || chk.check_id) + '/transfer', {
                method:  'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  to_server_id:   destServer.id,
                  from_server_id: chk.server_id || state.data.managerId,
                }),
              }).then(function(r) { return { chk: chk, ok: r.ok, status: r.status }; })
                .catch(function()  { return { chk: chk, ok: false, status: 0 }; });
            });

            Promise.all(transfers).then(function(results) {
              var ok     = results.filter(function(r) { return  r.ok; });
              var failed = results.filter(function(r) { return !r.ok; });

              if (ok.length > 0 && failed.length === 0) {
                showToast('Transferred ' + ok.length + (ok.length === 1 ? ' check' : ' checks') + ' to ' + destServer.name, { bg: T.elec });
              } else if (ok.length > 0 && failed.length > 0) {
                showToast(ok.length + ' transferred, ' + failed.length + ' failed', { bg: T.warning });
              } else {
                var code = failed[0] && failed[0].status;
                showToast(
                  code === 404 ? 'Transfer endpoint pending — backend work needed' : 'Transfer failed — try again',
                  { bg: T.verm }
                );
              }
              state.selectedCheckIds = [];
              refreshScene();
            });
          },
          onCancel: function() { SceneManager.closeInterrupt('co-transfer-picker'); },
        });
      },

      onPrintCheck: function(checks) {
        // Print is a routine action — no manager gate. One request per check.
        var label = checks.length > 1 ? checks.length + ' checks' : checkNumDisplay(checks[0]);
        showToast('Printing ' + label + '\u2026', { bg: T.greenWarm });

        var prints = checks.map(function(chk) {
          return fetch('/api/v1/checks/' + (chk.checkId || chk.check_id) + '/print', {
            method:  'POST',
            headers: { 'Content-Type': 'application/json' },
            body:    JSON.stringify({ kind: 'guest' }),
          }).then(function(r) { return { chk: chk, ok: r.ok, status: r.status }; })
            .catch(function()  { return { chk: chk, ok: false, status: 0 }; });
        });

        Promise.all(prints).then(function(results) {
          var ok     = results.filter(function(r) { return  r.ok; });
          var failed = results.filter(function(r) { return !r.ok; });

          if (ok.length > 0 && failed.length === 0) {
            showToast('Printed ' + ok.length + (ok.length === 1 ? ' check' : ' checks'), { bg: T.greenWarm });
          } else if (ok.length > 0 && failed.length > 0) {
            showToast(ok.length + ' printed, ' + failed.length + ' failed', { bg: T.warning });
          } else {
            var code = failed[0] && failed[0].status;
            showToast(
              code === 404 ? 'Print endpoint pending — backend work needed' : 'Print failed — check printer',
              { bg: T.verm }
            );
          }
        });
      },

      onCloseCheck: function(checks) {
        // "Pay" in the action grid → jump into the single-check payment flow
        // via check-overview. Multi-select pay doesn't have a combined flow
        // yet, so we surface that instead of silently picking the first.
        if (checks.length === 1) {
          var chk = checks[0];
          SceneManager.mountWorking('check-overview', {
            checkId:      chk.checkId || chk.check_id,
            checkLabel:   chk.checkLabel || chk.check_label,
            employeeId:   state.data.managerId,
            employeeName: state.data.managerName,
            returnLanding: 'manager-landing',
          });
        } else {
          showToast('Combined payment for ' + checks.length + ' checks — Phase D', { bg: T.gold });
        }
      },

      onDiscountCheck: function(checks) {
        // Destructive: manager PIN → discount picker → POST per check.
        SceneManager.interrupt('co-manager-pin', {
          onConfirm: function() {
            SceneManager.closeInterrupt('co-manager-pin');
            setTimeout(function() {
              SceneManager.interrupt('co-discount-picker', {
                checks: checks,
                onConfirm: function(discount) {
                  SceneManager.closeInterrupt('co-discount-picker');

                  var discounts = checks.map(function(chk) {
                    return fetch('/api/v1/orders/' + (chk.checkId || chk.check_id) + '/discount', {
                      method:  'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({
                        type:  discount.type,
                        value: discount.value,
                        manager_pin_verified: true,
                      }),
                    }).then(function(r) { return { chk: chk, ok: r.ok, status: r.status }; })
                      .catch(function()  { return { chk: chk, ok: false, status: 0 }; });
                  });

                  Promise.all(discounts).then(function(results) {
                    var ok     = results.filter(function(r) { return  r.ok; });
                    var failed = results.filter(function(r) { return !r.ok; });
                    var lbl    = discount.type === 'comp'
                      ? 'Comp'
                      : discount.type === 'percent'
                        ? discount.value + '% off'
                        : '$' + discount.value + ' off';

                    if (ok.length > 0 && failed.length === 0) {
                      showToast(lbl + ' applied to ' + ok.length + (ok.length === 1 ? ' check' : ' checks'), { bg: T.elec });
                    } else if (ok.length > 0 && failed.length > 0) {
                      showToast(ok.length + ' discounted, ' + failed.length + ' failed', { bg: T.warning });
                    } else {
                      var code = failed[0] && failed[0].status;
                      showToast(
                        code === 404 ? 'Discount endpoint pending — backend work needed' : 'Discount failed — try again',
                        { bg: T.verm }
                      );
                    }
                    state.selectedCheckIds = [];
                    refreshScene();
                  });
                },
                onCancel: function() { SceneManager.closeInterrupt('co-discount-picker'); },
              });
            }, 80);
          },
          onCancel: function() { SceneManager.closeInterrupt('co-manager-pin'); },
        });
      },

      onVoidCheck: function(checks) {
        // Destructive: manager PIN → reason-required confirm → POST per check.
        SceneManager.interrupt('co-manager-pin', {
          onConfirm: function() {
            SceneManager.closeInterrupt('co-manager-pin');
            setTimeout(function() {
              SceneManager.interrupt('co-void-confirm', {
                checks: checks,
                onConfirm: function(reason) {
                  SceneManager.closeInterrupt('co-void-confirm');

                  var voids = checks.map(function(chk) {
                    return fetch('/api/v1/orders/' + (chk.checkId || chk.check_id) + '/void', {
                      method:  'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({
                        reason: reason,
                        manager_pin_verified: true,
                      }),
                    }).then(function(r) { return { chk: chk, ok: r.ok, status: r.status }; })
                      .catch(function()  { return { chk: chk, ok: false, status: 0 }; });
                  });

                  Promise.all(voids).then(function(results) {
                    var ok     = results.filter(function(r) { return  r.ok; });
                    var failed = results.filter(function(r) { return !r.ok; });

                    if (ok.length > 0 && failed.length === 0) {
                      showToast('Voided ' + ok.length + (ok.length === 1 ? ' check' : ' checks'), { bg: T.verm });
                    } else if (ok.length > 0 && failed.length > 0) {
                      showToast(ok.length + ' voided, ' + failed.length + ' failed', { bg: T.warning });
                    } else {
                      var code = failed[0] && failed[0].status;
                      showToast(
                        code === 404 ? 'Void endpoint pending — backend work needed' : 'Void failed — try again',
                        { bg: T.verm }
                      );
                    }
                    state.selectedCheckIds = [];
                    refreshScene();
                  });
                },
                onCancel: function() { SceneManager.closeInterrupt('co-void-confirm'); },
              });
            }, 80);
          },
          onCancel: function() { SceneManager.closeInterrupt('co-manager-pin'); },
        });
      },
    };

    function doLockDay(countedCash) {
      var payload = {
        manager_pin_verified: true,
        manager_id:           state.data.managerId,
        net_sales:            state.data.netSales,
        gross_sales:          state.data.grossSales,
        void_total:           state.data.voidsTotal,
        discount_total:       state.data.discTotal,
        tax_total:            state.data.taxCollected,
        cash_expected:        state.data.cashExpected,
        cash_counted:         countedCash,
        cash_variance:        parseFloat((countedCash - state.data.cashExpected).toFixed(2)),
        cash_bypassed:        state.cashCounted === 'bypass',
        cc_batch_total:       state.data.batchTotal,
        cc_batch_transactions: state.data.batchTransactions,
        batch_settled:        state.batchSettled,
        total_tips:           state.data.totalTips,
        card_tips:            state.data.cardTips,
        cash_tips:            state.data.cashTips,
        total_tip_out:        state.data.totalTipOut,
        total_checks:         state.data.totalChecks,
        covers:               state.data.covers,
      };

      fetch('/api/v1/orders/close-day', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(payload),
      }).then(function(r) {
        if (r.ok) {
          showToast('Day locked', { bg: T.greenWarm });
          SceneManager.closeTransactional('close-day');
        } else if (r.status === 404) {
          showToast('Close-day endpoint pending — backend work needed', { bg: T.warning });
        } else if (r.status === 409) {
          showToast('Day already locked — check manager-landing', { bg: T.warning });
        } else {
          showToast('Lock failed (' + r.status + ') — try again', { bg: T.verm });
        }
      }).catch(function() {
        showToast('Lock unavailable — check connection', { bg: T.verm });
      });
    }

    refreshScene();

    // Refresh when something changes under us (another terminal closes a
    // check, a tip gets adjusted elsewhere, etc.)
    var _onUpdate = function() { refreshScene(); };
    SceneManager.on('order:updated', _onUpdate);
    SceneManager.on('order:closed',  _onUpdate);
    SceneManager.on('tip:adjusted',  _onUpdate);

    return function cleanup() {
      SceneManager.off('order:updated', _onUpdate);
      SceneManager.off('order:closed',  _onUpdate);
      SceneManager.off('tip:adjusted',  _onUpdate);
      if (state._onChildClosed) {
        SceneManager.off('transactional:closed', state._onChildClosed);
        state._onChildClosed = null;
      }
      if (window._header && window._header.setBackHandler) {
        window._header.setBackHandler(null);
      }
    };
  },
});