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
import { computeCashExpected, computeCashVariance } from './close-day-calc.js';

// ─────────────────────────────────────────────────
//  LAYOUT CONSTANTS — matched to server-checkout
// ─────────────────────────────────────────────────

var LEFT_W   = 260;
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

      // Cash drawer: cash collected minus CC tips paid out to servers from drawer
      cashExpected:     computeCashExpected(d),

      // Full order records — receipt preview looks up items/subtotal/tax
      // here. Matches server-checkout's pattern at renderCheckPreview.
      allOrders:        rawOrders,

      // Raw reference for the recap panel
      daySummary:       d,
      tipoutRules:       rules,
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
//  LEFT COLUMN — Stats panel
// ─────────────────────────────────────────────────

function _leftColDivider() {
  var d = document.createElement('div');
  d.style.cssText = 'height:1px;background:' + T.border + ';opacity:0.4;margin:6px 0;flex-shrink:0;';
  return d;
}

function _leftColStat(label, value, valueColor, hero) {
  var wrap = document.createElement('div');
  wrap.style.cssText = 'display:flex;flex-direction:column;gap:2px;flex-shrink:0;';
  var lbl = document.createElement('div');
  lbl.style.cssText = [
    'font-family:' + T.fb + ';font-size:10px;font-weight:700;',
    'color:' + T.text + ';opacity:0.6;letter-spacing:1px;',
  ].join('');
  lbl.textContent = label;
  var val = document.createElement('div');
  val.style.cssText = [
    'font-family:' + T.fh + ';font-weight:700;line-height:1.1;',
    'font-size:' + (hero ? '32px' : '20px') + ';',
    'color:' + (valueColor || T.text) + ';',
  ].join('');
  val.textContent = value;
  wrap.appendChild(lbl);
  wrap.appendChild(val);
  return wrap;
}

function buildLeftCol(state, handlers) {
  var col = document.createElement('div');
  col.style.cssText = [
    'flex-shrink:0;width:' + LEFT_W + 'px;',
    'display:flex;flex-direction:column;',
    'background:' + T.card + ';',
    'border-left:3px solid ' + T.green + ';',
    'border-radius:6px;overflow:hidden;',
  ].join('');

  // ── Scrollable body ──
  var body = document.createElement('div');
  body.style.cssText = [
    'flex:1;overflow-y:auto;overflow-x:hidden;',
    'padding:14px 16px;box-sizing:border-box;',
    'display:flex;flex-direction:column;',
    'touch-action:pan-y;overscroll-behavior:contain;',
  ].join('');

  // Net Sales hero
  body.appendChild(_leftColStat('NET SALES', fmt(state.netSales), T.gold, true));
  body.appendChild(_leftColDivider());

  // CC Batch + Total Tips
  body.appendChild(_leftColStat('CC BATCH', fmt(state.batchTotal), T.elec));
  body.appendChild(_leftColStat('TOTAL TIPS', fmt(state.totalTips), T.gold));
  body.appendChild(_leftColDivider());

  // Tip-Out section
  var tipWrap = document.createElement('div');
  tipWrap.style.cssText = [
    'background:' + T.well + ';border-radius:4px;',
    'padding:8px 10px;display:flex;flex-direction:column;gap:4px;',
  ].join('');

  var rules = state.tipoutRules || [];
  var allAdj = state.unadjustedChecks.length === 0 && state.adjustedChecks.length > 0;

  if (rules.length > 0) {
    var grossTips = state.totalTips;
    rules.forEach(function(r) {
      var base  = r.calculation_base || 'Net Sales';
      var catTotals = {};
      (state.categories || []).forEach(function(c) {
        if (c && c.name) catTotals[c.name] = c.total || 0;
      });
      var basis;
      if (base === 'Gross Tips' || base === 'Net Tips') {
        basis = grossTips;
      } else if (Array.isArray(r.categories) && r.categories.length) {
        basis = r.categories.reduce(function(s, cat) { return s + (catTotals[cat] || 0); }, 0);
      } else {
        basis = state.netSales;
      }
      var rAmt = parseFloat((basis * (r.percentage || 0) / 100).toFixed(2));
      var row = document.createElement('div');
      row.style.cssText = 'display:flex;justify-content:space-between;align-items:baseline;';
      var rL = document.createElement('div');
      rL.style.cssText = 'font-family:' + T.fb + ';font-size:11px;color:' + T.text + ';';
      rL.textContent = (r.role_name || r.name || 'Tip-Out') + ' ' + (r.percentage || 0) + '%';
      var rR = document.createElement('div');
      rR.style.cssText = 'font-family:' + T.fb + ';font-size:11px;color:' + T.text + ';';
      rR.textContent = fmt(rAmt);
      row.appendChild(rL);
      row.appendChild(rR);
      tipWrap.appendChild(row);
    });
  }

  // Tip-out total + ADJ chip
  var totRow = document.createElement('div');
  totRow.style.cssText = [
    'display:flex;justify-content:space-between;align-items:center;',
    'margin-top:4px;padding-top:4px;',
    'border-top:1px solid ' + hexToRgba(T.border, 0.5) + ';',
  ].join('');
  var tL = document.createElement('div');
  tL.style.cssText = 'font-family:' + T.fb + ';font-size:12px;font-weight:700;color:' + T.text + ';';
  tL.textContent = 'TIP-OUT';
  var tR = document.createElement('div');
  tR.style.cssText = 'display:flex;align-items:center;gap:6px;';
  if (state.closedCardChecks && state.closedCardChecks.length > 0) {
    var adjChip = document.createElement('div');
    var adjColor = allAdj ? T.greenWarm : T.warning;
    adjChip.style.cssText = [
      'font-family:' + T.fh + ';font-size:9px;font-weight:700;',
      'padding:1px 5px;border-radius:3px;',
      'background:' + hexToRgba(adjColor, 0.15) + ';color:' + adjColor + ';',
    ].join('');
    adjChip.textContent = allAdj ? 'ADJ' : 'PENDING';
    tR.appendChild(adjChip);
  }
  var tV = document.createElement('div');
  tV.style.cssText = 'font-family:' + T.fb + ';font-size:12px;font-weight:700;color:' + T.text + ';';
  tV.textContent = fmt(state.totalTipOut);
  tR.appendChild(tV);
  totRow.appendChild(tL);
  totRow.appendChild(tR);
  tipWrap.appendChild(totRow);

  // Adjust Rates pill
  var adjBtn = document.createElement('div');
  adjBtn.style.cssText = [
    'margin-top:6px;padding:6px 10px;border-radius:6px;',
    'border:1.5px solid ' + T.border + ';cursor:pointer;',
    'display:flex;align-items:center;justify-content:center;gap:6px;',
    'font-family:' + T.fh + ';font-size:11px;font-weight:700;',
    'color:' + T.text + ';letter-spacing:0.8px;',
    'transition:border-color 0.15s,color 0.15s;',
  ].join('');
  adjBtn.innerHTML = '<svg width="10" height="12" viewBox="0 0 10 12" fill="none"><rect x="2" y="5" width="6" height="7" rx="1" stroke="currentColor" stroke-width="1.5"/><path d="M3 5V3.5a2 2 0 0 1 4 0V5" stroke="currentColor" stroke-width="1.5"/></svg> ADJUST RATES';
  adjBtn.addEventListener('pointerenter', function() {
    adjBtn.style.borderColor = T.warning;
    adjBtn.style.color = T.warning;
  });
  adjBtn.addEventListener('pointerleave', function() {
    adjBtn.style.borderColor = T.border;
    adjBtn.style.color = T.text;
  });
  adjBtn.addEventListener('click', function() {
    if (handlers.onAdjustRates) handlers.onAdjustRates();
  });
  tipWrap.appendChild(adjBtn);
  body.appendChild(tipWrap);
  body.appendChild(_leftColDivider());

  // Voids + Checks row
  var statsRow = document.createElement('div');
  statsRow.style.cssText = 'display:flex;gap:12px;';
  var voidsBlock = document.createElement('div');
  voidsBlock.style.cssText = 'flex:1;display:flex;flex-direction:column;gap:2px;';
  var voidsLbl = document.createElement('div');
  voidsLbl.style.cssText = 'font-family:' + T.fb + ';font-size:10px;font-weight:700;color:' + T.text + ';opacity:0.6;letter-spacing:1px;';
  voidsLbl.textContent = 'VOIDS';
  var voidsVal = document.createElement('div');
  voidsVal.style.cssText = 'font-family:' + T.fh + ';font-size:17px;font-weight:700;color:' + T.verm + ';';
  voidsVal.textContent = (state.voidsCount || 0) + (state.voidsTotal > 0 ? ' · ' + fmt(state.voidsTotal) : '');
  voidsBlock.appendChild(voidsLbl);
  voidsBlock.appendChild(voidsVal);
  statsRow.appendChild(voidsBlock);

  var checksBlock = document.createElement('div');
  checksBlock.style.cssText = 'flex:1;display:flex;flex-direction:column;gap:2px;';
  var checksLbl = document.createElement('div');
  checksLbl.style.cssText = 'font-family:' + T.fb + ';font-size:10px;font-weight:700;color:' + T.text + ';opacity:0.6;letter-spacing:1px;';
  checksLbl.textContent = 'CHECKS';
  var checksVal = document.createElement('div');
  checksVal.style.cssText = 'font-family:' + T.fh + ';font-size:17px;font-weight:700;color:' + T.text + ';';
  checksVal.textContent = String(state.totalChecks || 0);
  checksBlock.appendChild(checksLbl);
  checksBlock.appendChild(checksVal);
  statsRow.appendChild(checksBlock);
  body.appendChild(statsRow);

  // Covers
  if ((state.covers || 0) > 0) {
    body.appendChild(_leftColDivider());
    body.appendChild(_leftColStat('COVERS', String(state.covers), T.text));
  }

  col.appendChild(body);

  // Cash footer
  var cashFooter = document.createElement('div');
  cashFooter.style.cssText = [
    'flex-shrink:0;',
    'border-top:1.5px solid ' + T.gold + ';',
    'background:' + hexToRgba(T.gold, 0.06) + ';',
    'padding:10px 16px;box-sizing:border-box;',
  ].join('');
  var cashLbl = document.createElement('div');
  cashLbl.style.cssText = [
    'font-family:' + T.fh + ';font-size:10px;font-weight:700;',
    'letter-spacing:1.5px;color:' + T.text + ';margin-bottom:4px;',
  ].join('');
  cashLbl.textContent = 'CASH EXPECTED';
  var cashAmt = document.createElement('div');
  cashAmt.style.cssText = 'font-family:' + T.fh + ';font-size:28px;font-weight:700;color:' + T.gold + ';line-height:1;';
  cashAmt.textContent = fmt(state.cashExpected);
  var cashMath = document.createElement('div');
  cashMath.style.cssText = 'font-family:' + T.fb + ';font-size:10px;color:' + T.text + ';opacity:0.6;margin-top:3px;';
  cashMath.textContent = fmt(state.cashSales) + ' cash − ' + fmt(state.cardTips) + ' tips';
  cashFooter.appendChild(cashLbl);
  cashFooter.appendChild(cashAmt);
  cashFooter.appendChild(cashMath);
  col.appendChild(cashFooter);

  // Print Day Recap pill
  var printBtn = document.createElement('div');
  printBtn.style.cssText = [
    'flex-shrink:0;margin:8px 16px 14px;',
    'padding:10px 14px;border-radius:8px;cursor:pointer;',
    'background:' + T.elec + ';',
    'box-shadow:0 4px 0 ' + T.elecDk + ';',
    'font-family:' + T.fh + ';font-size:13px;font-weight:700;',
    'color:#fff;letter-spacing:1.2px;text-align:center;',
  ].join('');
  printBtn.textContent = 'PRINT DAY RECAP';
  printBtn.addEventListener('click', function() {
    if (handlers.onPrintDayRecap) handlers.onPrintDayRecap();
  });
  col.appendChild(printBtn);

  return col;
}


// ─────────────────────────────────────────────────
//  MIDDLE COLUMN — Adaptive card stack
// ─────────────────────────────────────────────────

function buildMiddleCol(data, handlers, sceneState) {
  var col = document.createElement('div');
  col.style.cssText = 'flex:1;display:flex;flex-direction:column;min-width:0;min-height:0;';

  var blocked   = (data.openChecks.length + data.unadjustedChecks.length) > 0;
  var lockReady = !blocked && sceneState.batchSettled && sceneState.cashCounted != null;

  // Card stack — scrollable
  var cardStack = document.createElement('div');
  cardStack.style.cssText = [
    'flex:1;overflow-y:auto;overflow-x:hidden;',
    'display:flex;flex-direction:column;gap:8px;padding-bottom:4px;',
    'touch-action:pan-y;',
    '-webkit-overflow-scrolling:touch;',
    'overscroll-behavior:contain;',
  ].join('');

  cardStack.appendChild(buildChecksCard(data, handlers, sceneState.activeTab, sceneState.selectedCheckIds));

  if (data.closedCardChecks.length > 0) {
    cardStack.appendChild(buildTipsCard(data, handlers, sceneState.tipFilter));
  }

  col.appendChild(cardStack);

  // Pinned Lock Day footer
  var footer = document.createElement('div');
  footer.style.cssText = 'flex-shrink:0;padding-top:8px;display:flex;flex-direction:column;gap:4px;';

  var lockBtn = document.createElement('div');
  if (lockReady) {
    lockBtn.style.cssText = [
      'padding:12px 16px;border-radius:8px;box-sizing:border-box;cursor:pointer;',
      'background:' + T.greenWarm + ';',
      'box-shadow:0 4px 0 ' + T.greenWarmDk + ';',
      'font-family:' + T.fh + ';font-size:' + FS_PILL_LG + ';font-weight:700;',
      'color:#1a1a1a;letter-spacing:1.4px;text-align:center;',
    ].join('');
    lockBtn.addEventListener('click', function() {
      if (handlers.onLockDay) handlers.onLockDay();
    });
  } else {
    lockBtn.style.cssText = [
      'padding:12px 16px;border-radius:8px;box-sizing:border-box;',
      'background:' + T.card + ';border:1.5px solid ' + T.border + ';',
      'opacity:0.55;cursor:not-allowed;',
      'font-family:' + T.fh + ';font-size:' + FS_PILL_LG + ';font-weight:700;',
      'color:' + T.text + ';letter-spacing:1.4px;text-align:center;',
    ].join('');
  }
  lockBtn.textContent = 'LOCK DAY';
  footer.appendChild(lockBtn);

  if (!lockReady) {
    var reason = document.createElement('div');
    var openN  = data.openChecks.length;
    var unadjN = data.unadjustedChecks.length;
    var reasonMsg;
    if (openN > 0) {
      reasonMsg = openN + ' open check' + (openN === 1 ? '' : 's') + ' must be closed';
    } else if (unadjN > 0) {
      reasonMsg = unadjN + ' tip' + (unadjN === 1 ? '' : 's') + ' need adjustment';
    } else if (!sceneState.batchSettled) {
      reasonMsg = 'settle batch first';
    } else {
      reasonMsg = 'count drawer first';
    }
    reason.style.cssText = [
      'font-family:' + T.fh + ';font-size:10px;font-weight:700;',
      'color:' + T.verm + ';text-align:center;letter-spacing:0.6px;',
    ].join('');
    reason.textContent = reasonMsg;
    footer.appendChild(reason);
  }

  col.appendChild(footer);
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
// ── Checks card (Active / All tabs) ──
function buildChecksCard(data, handlers, activeTab, selectedCheckIds) {
  selectedCheckIds = selectedCheckIds || [];
  if (!activeTab) {
    activeTab = (data.openChecks && data.openChecks.length > 0) ? 'active' : 'all';
  }

  var hasOpen = data.openChecks.length > 0;
  var accentColor = hasOpen ? T.verm : T.elec;
  var allChecks = data.checks || [];

  var card = buildBaseCard({ accent: accentColor });
  card.style.padding = '12px 14px';
  card.style.gap = '10px';

  // Header row
  var hdr = document.createElement('div');
  hdr.style.cssText = 'display:flex;align-items:center;gap:8px;flex-shrink:0;';

  if (hasOpen) {
    var icon = document.createElement('div');
    icon.style.cssText = [
      'width:18px;height:18px;border-radius:4px;flex-shrink:0;',
      'background:' + hexToRgba(T.verm, 0.18) + ';',
      'display:flex;align-items:center;justify-content:center;',
      'font-family:' + T.fb + ';font-size:14px;font-weight:700;color:' + T.verm + ';',
    ].join('');
    icon.textContent = '!';
    hdr.appendChild(icon);
  }

  var titleEl = document.createElement('span');
  titleEl.style.cssText = [
    'font-family:' + T.fh + ';font-size:11px;font-weight:700;',
    'letter-spacing:2px;text-transform:uppercase;',
    'color:' + accentColor + ';',
  ].join('');
  titleEl.textContent = 'CHECKS';
  hdr.appendChild(titleEl);

  var tabBar = document.createElement('div');
  tabBar.style.cssText = 'display:flex;gap:5px;flex-shrink:0;margin-left:auto;';
  var makeTab = function(key, label, count, activeColor) {
    var isActive = (activeTab === key);
    var pill = document.createElement('div');
    pill.style.cssText = [
      'padding:3px 9px;border-radius:999px;',
      'font-family:' + T.fh + ';font-size:10px;font-weight:700;letter-spacing:1px;',
      'cursor:pointer;user-select:none;-webkit-user-select:none;',
      'pointer-events:auto;touch-action:manipulation;',
      isActive
        ? 'background:' + activeColor + ';color:' + T.well + ';'
        : 'background:transparent;color:' + T.moon + ';border:1px solid rgba(255,255,255,0.15);',
    ].join('');
    pill.textContent = label + ' ' + count;
    pill.addEventListener('pointerup', function(e) {
      e.stopPropagation();
      if (handlers.onTabChange) handlers.onTabChange(key);
    });
    return pill;
  };
  tabBar.appendChild(makeTab('active', 'Active', data.openChecks.length, T.elec));
  tabBar.appendChild(makeTab('all', 'All', allChecks.length, T.moon));
  hdr.appendChild(tabBar);
  card.appendChild(hdr);

  var list = document.createElement('div');
  list.style.cssText = [
    'display:flex;flex-direction:column;gap:6px;',
    'max-height:280px;overflow-y:auto;',
    'touch-action:pan-y;overscroll-behavior:contain;',
  ].join('');

  if (activeTab === 'active') {
    data.openChecks.forEach(function(chk) {
      var selected = selectedCheckIds.indexOf(chk.checkId) !== -1;
      list.appendChild(_buildActiveCheckRow(chk, handlers, selected));
    });
  } else {
    allChecks.forEach(function(chk) {
      if (chk.status === 'closed') {
        list.appendChild(_buildClosedCheckRow(chk, handlers));
      } else {
        var selected = selectedCheckIds.indexOf(chk.checkId) !== -1;
        list.appendChild(_buildActiveCheckRow(chk, handlers, selected));
      }
    });
  }

  card.appendChild(list);
  return card;
}

function _buildActiveCheckRow(chk, handlers, isSelected) {
  var row = document.createElement('div');
  row.style.cssText = [
    'display:flex;gap:10px;align-items:center;',
    'padding:10px 12px;border-radius:6px;',
    isSelected
      ? 'border:1.5px solid ' + T.elec + ';background:' + hexToRgba(T.elec, 0.07) + ';'
      : 'border:1.5px solid transparent;background:' + T.well + ';',
    'cursor:pointer;pointer-events:auto;touch-action:manipulation;',
    'user-select:none;-webkit-user-select:none;',
  ].join('');

  var info = document.createElement('div');
  info.style.cssText = 'flex:1;display:flex;flex-direction:column;gap:2px;min-width:0;';

  var top = document.createElement('div');
  top.style.cssText = 'display:flex;gap:6px;align-items:baseline;flex-wrap:wrap;';
  var checkLbl = document.createElement('span');
  checkLbl.style.cssText = 'font-family:' + T.fb + ';font-size:13px;font-weight:700;color:' + T.text + ';';
  checkLbl.textContent = chk.checkLabel || ('Check ' + (chk.checkId || ''));
  top.appendChild(checkLbl);
  if (chk.tableLabel) {
    var tableLbl = document.createElement('span');
    tableLbl.style.cssText = 'font-family:' + T.fb + ';font-size:13px;color:' + T.moon + ';';
    tableLbl.textContent = chk.tableLabel;
    top.appendChild(tableLbl);
  }
  info.appendChild(top);

  var meta = document.createElement('div');
  meta.style.cssText = 'font-family:' + T.fb + ';font-size:11px;color:' + T.moon + ';';
  var metaParts = [];
  if (chk.server_name) metaParts.push(chk.server_name);
  if (chk.guests) metaParts.push(chk.guests + ' guest' + (chk.guests > 1 ? 's' : ''));
  if (chk.time)  metaParts.push('opened ' + chk.time);
  meta.textContent = metaParts.join(' · ');
  info.appendChild(meta);

  var amt = document.createElement('div');
  amt.style.cssText = 'font-family:' + T.fb + ';font-size:17px;font-weight:700;color:' + T.gold + ';flex-shrink:0;';
  amt.textContent = fmt(chk.amount || 0);

  row.appendChild(info);
  row.appendChild(amt);
  row.addEventListener('pointerup', function() {
    if (handlers.onSelectCheck) handlers.onSelectCheck(chk);
  });
  return row;
}

function _buildClosedCheckRow(chk, handlers) {
  var outer = document.createElement('div');
  outer.style.cssText = [
    'background:' + T.well + ';border-radius:6px;',
    'padding:10px 12px;',
    'display:flex;flex-direction:column;gap:6px;',
  ].join('');

  var topRow = document.createElement('div');
  topRow.style.cssText = 'display:flex;gap:10px;align-items:center;';

  var info = document.createElement('div');
  info.style.cssText = 'flex:1;display:flex;flex-direction:column;gap:2px;min-width:0;';

  var top = document.createElement('div');
  top.style.cssText = 'display:flex;gap:6px;align-items:baseline;flex-wrap:wrap;';
  var checkLbl = document.createElement('span');
  checkLbl.style.cssText = 'font-family:' + T.fb + ';font-size:13px;font-weight:700;color:' + T.text + ';';
  checkLbl.textContent = chk.checkLabel || ('Check ' + (chk.checkId || ''));
  top.appendChild(checkLbl);
  if (chk.tableLabel) {
    var tableLbl = document.createElement('span');
    tableLbl.style.cssText = 'font-family:' + T.fb + ';font-size:13px;color:' + T.moon + ';';
    tableLbl.textContent = chk.tableLabel;
    top.appendChild(tableLbl);
  }
  info.appendChild(top);

  var meta = document.createElement('div');
  meta.style.cssText = 'font-family:' + T.fb + ';font-size:11px;color:' + T.moon + ';';
  var metaParts = [];
  if (chk.server_name) metaParts.push(chk.server_name);
  if (chk.time)        metaParts.push('closed ' + chk.time);
  if (chk.tip != null) metaParts.push('tip ' + fmt(chk.tip));
  meta.textContent = metaParts.join(' · ');
  info.appendChild(meta);

  var isCard = chk.method !== 'cash';
  var tag = document.createElement('div');
  tag.style.cssText = [
    'flex-shrink:0;font-size:10px;border-radius:3px;padding:1px 5px;',
    'font-family:' + T.fb + ';',
    isCard
      ? 'background:' + hexToRgba(T.elec, 0.12) + ';color:' + T.elec + ';'
      : 'background:' + hexToRgba(T.greenWarm, 0.12) + ';color:' + T.greenWarm + ';',
  ].join('');
  tag.textContent = isCard
    ? (chk.cardBrand || 'Card') + (chk.cardLast4 ? ' ··· ' + chk.cardLast4 : '')
    : 'Cash';

  var amt = document.createElement('div');
  amt.style.cssText = 'font-family:' + T.fb + ';font-size:17px;font-weight:700;color:' + T.gold + ';flex-shrink:0;';
  amt.textContent = fmt(chk.amount || 0);

  topRow.appendChild(info);
  topRow.appendChild(tag);
  topRow.appendChild(amt);
  outer.appendChild(topRow);

  var actRow = document.createElement('div');
  actRow.style.cssText = 'display:flex;gap:6px;';

  var reprBtn = document.createElement('div');
  reprBtn.style.cssText = [
    'background:' + hexToRgba(T.greenWarm, 0.15) + ';',
    'color:' + T.greenWarm + ';',
    'border:1px solid ' + hexToRgba(T.greenWarm, 0.3) + ';',
    'font-family:' + T.fh + ';font-size:10px;font-weight:700;letter-spacing:1px;',
    'border-radius:999px;padding:4px 12px;',
    'cursor:pointer;pointer-events:auto;touch-action:manipulation;',
    'user-select:none;-webkit-user-select:none;',
  ].join('');
  reprBtn.textContent = 'Reprint';
  reprBtn.addEventListener('pointerup', function(e) {
    e.stopPropagation();
    if (handlers.onReprintCheck) handlers.onReprintCheck(chk);
  });

  var reopBtn = document.createElement('div');
  reopBtn.style.cssText = [
    'background:' + hexToRgba(T.verm, 0.12) + ';',
    'color:' + T.verm + ';',
    'border:1px solid ' + hexToRgba(T.verm, 0.3) + ';',
    'font-family:' + T.fh + ';font-size:10px;font-weight:700;letter-spacing:1px;',
    'border-radius:999px;padding:4px 12px;',
    'cursor:pointer;pointer-events:auto;touch-action:manipulation;',
    'user-select:none;-webkit-user-select:none;',
  ].join('');
  reopBtn.textContent = 'Reopen';
  reopBtn.addEventListener('pointerup', function(e) {
    e.stopPropagation();
    if (handlers.onReopenCheck) handlers.onReopenCheck(chk);
  });

  actRow.appendChild(reprBtn);
  actRow.appendChild(reopBtn);
  outer.appendChild(actRow);

  return outer;
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

function cashVariance(state, sceneState) {
  return computeCashVariance(state.cashExpected, sceneState.cashCounted);
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
    activeTab:          'active',
    startTime:         null,
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
      body.appendChild(buildLeftCol(state.data, handlers));
      body.appendChild(buildMiddleCol(state.data, handlers, state));

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

      onTabChange: function(tab) {
        state.activeTab = tab;
        rebuild();
      },

      onReprintCheck: function(chk) {
        // Reprint via server-checkout's print flow (check passed directly)
        if (!chk) return;
        showToast('Reprinting…', { bg: T.greenWarm });
        fetch('/api/v1/orders/' + (chk.checkId || chk.check_id) + '/receipt', { method: 'POST' })
          .then(function(r) {
            showToast(r.ok ? 'Reprinted' : 'Reprint failed', { bg: r.ok ? T.greenWarm : T.verm });
          })
          .catch(function() { showToast('Reprint unavailable', { bg: T.verm }); });
      },

      onReopenCheck: function(chk) {
        SceneManager.interrupt('co-manager-pin', {
          onConfirm: function() {
            SceneManager.closeInterrupt('co-manager-pin');
            fetch('/api/v1/orders/' + (chk.checkId || chk.check_id) + '/reopen', { method: 'POST' })
              .then(function(r) {
                showToast(r.ok ? 'Check reopened' : 'Reopen failed (' + r.status + ')', { bg: r.ok ? T.greenWarm : T.verm });
                refreshScene();
              })
              .catch(function() { showToast('Reopen unavailable', { bg: T.verm }); });
          },
          onCancel: function() { SceneManager.closeInterrupt('co-manager-pin'); },
        });
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