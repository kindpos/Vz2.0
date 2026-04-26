// ═══════════════════════════════════════════════════
//  KINDpos Terminal — Server Checkout Scene
//  Three-column layout per locked mockup:
//    LEFT    Receipt Preview (260px, dimmed while blocked)
//    MIDDLE  Card stack — blockers expanded, non-blockers dim-collapsed
//    RIGHT   Actions + blocker queue + FLSA timer (236px)
//  Two blockers: open checks (verm) + unadjusted tips (yellow)
//  Nice. Dependable. Yours.
// ═══════════════════════════════════════════════════

import { T } from '../../common/tokens.js';
import { showToast } from '../components.js';
import { SceneManager, defineScene } from '../scene-manager.js';
import { OrderSummary } from '../order-summary.js';
import {
  buildStaticCard,
  buildNavCard,
  buildActionCard,
  buildPillButton,
  hexToRgba,
  darkenHex,
} from '../theme-manager.js';
import { fmt, detailRow, detailDivider } from './checkout-core.js';

// ─────────────────────────────────────────────────
//  LAYOUT CONSTANTS (match mockup exactly)
// ─────────────────────────────────────────────────

var LEFT_W   = 260;   // Receipt preview column
var RIGHT_W  = 236;   // Actions column
var PAD      = 14;    // Outer side/bottom padding
var PAD_TOP  = 8;     // reduce top padding per UI audit

// ─────────────────────────────────────────────────
//  TYPOGRAPHY — aligned to KINDpos token scale
//  fsB4=14px (micro labels), fsB3=16px (body), fsB2=20px (emphasis)
// ─────────────────────────────────────────────────

var FS_LABEL   = '13px';   // Uppercase letter-spaced section labels
var FS_META    = '13px';   // Dim meta text (opened 10:30pm, closed 11:22pm)
var FS_BODY    = '15px';   // Standard body text, row labels
var FS_AMOUNT  = '17px';   // Row-level monetary amounts
var FS_HERO    = '26px';   // Hero numbers (Take-Home, Cash Expected)
var FS_PILL    = '13px';   // Pill button labels
var FS_PILL_LG = '15px';   // Larger pill labels (BACK, PRINT, FINALIZE main)
var FS_RECEIPT = '11px';   // Receipt preview paper (intentionally small — it's a slip)

// ─────────────────────────────────────────────────
//  DATA FETCH
// ─────────────────────────────────────────────────

function fetchServerState(params) {
  var empId = params.employeeId || '';

  // Hard gate — we must have an employee ID. Without one, a bare
  // `?server_id=` query hits the backend's store-wide fallback and returns
  // every server's data. The scene surfaces this as an error state rather
  // than showing someone else's checks. Managers viewing a server always
  // have staff.id populated, so this path is never hit legitimately.
  if (!empId) {
    return Promise.reject(new Error('server-checkout: missing employee id'));
  }

  var summaryUrl = '/api/v1/orders/day-summary?server_id=' + encodeURIComponent(empId);
  var ordersUrl  = '/api/v1/orders?server_id=' + encodeURIComponent(empId);

  return Promise.all([
    fetch(summaryUrl).then(function(r) { return r.json(); }),
    fetch('/api/v1/config/tipout').then(function(r) { return r.json(); }).catch(function() { return []; }),
    fetch('/api/v1/config/store').then(function(r) { return r.json(); }).catch(function() { return {}; }),
    fetch(ordersUrl).then(function(r) { return r.json(); }).catch(function() { return []; }),
  ]).then(function(results) {
    var d = results[0] || {};
    var rules = Array.isArray(results[1]) ? results[1] : [];
    var store = results[2] || {};
    var rawOrders = Array.isArray(results[3]) ? results[3] : [];

    // Defensive client-side scrub — drop any order whose server_id doesn't
    // match ours. Trusts the backend filter as primary but prevents leaks
    // if the backend regresses or returns store-wide results.
    var allOrders = rawOrders.filter(function(o) {
      // If the record has no server_id at all, we can't verify — prefer
      // safety and drop it.
      if (!o.server_id) return false;
      return o.server_id === empId;
    });

    var rate = rules.reduce(function(s, r) { return s + (r.percentage || 0); }, 0) / 100;
    var netSales = d.net_sales || 0;
    var cashSales = d.cash_total || 0;
    var cardSales = d.card_sales || 0;
    var cardTips  = d.card_tips  || 0;
    var tipOutTotal = netSales * rate;
    var takeHome = (cardTips + (d.cash_tips || 0)) - tipOutTotal;
    var cashExpected = cashSales - cardTips;

    // Same defensive scrub on the checks summary. day-summary entries
    // don't always carry server_id (depends on backend version), so when
    // absent we trust the URL filter; when present, we verify.
    var allChecks = (d.checks || []).filter(function(c) {
      if (c.server_id && c.server_id !== empId) return false;
      return true;
    });
    var openChecks = allChecks.filter(function(c) { return c.status === 'open'; });
    var closedCardChecks = allChecks.filter(function(c) {
      return c.status === 'closed' && c.method === 'card';
    });
    var unadjustedChecks = closedCardChecks.filter(function(c) { return !c.adjusted; });
    var adjustedChecks   = closedCardChecks.filter(function(c) {  return c.adjusted;  });

    return {
      employeeId:    params.employeeId || '',
      employeeName:  params.employeeName || '',
      restaurantName: store.name || 'KINDpos/lite',
      terminalId:    store.terminal_id || 'terminal_01',

      // Aggregates
      netSales:      netSales,
      cashSales:     cashSales,
      cardSales:     cardSales,
      cardTips:      cardTips,
      tipOutRate:    rate,
      tipOutTotal:   tipOutTotal,
      takeHome:      takeHome,
      cashExpected:  cashExpected,
      checksClosed:  (d.total_closed || closedCardChecks.length + (allChecks.filter(function(c) { return c.status === 'closed' && c.method === 'cash'; }).length)),

      // Blocker data
      checks:             allChecks,
      openChecks:         openChecks,
      unadjustedChecks:   unadjustedChecks,
      adjustedChecks:     adjustedChecks,

      // Full order records — used to render check preview with items.
      // Indexed by order_id; checks in `openChecks`/etc. have a `checkId`
      // that matches `order_id` in this array.
      allOrders:          allOrders,

      // Raw tipout rules — needed by buildLeftCol for per-role breakdown.
      tipoutRules:        rules,
    };
  });
}

// ─────────────────────────────────────────────────
//  BLOCKER BANNER (top full-width)
//  Shown only when openChecks.length + unadjustedChecks.length > 0.
// ─────────────────────────────────────────────────

function buildBlockerBanner(state, startTime) {
  var blockerCount = state.openChecks.length + state.unadjustedChecks.length;
  if (blockerCount === 0) return null;

  var card = buildStaticCard({ accent: T.verm });
  card.style.flexShrink = '0';
  card.style.display = 'flex';
  card.style.alignItems = 'center';
  card.style.gap = '14px';
  card.style.padding = '10px 18px';

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
  title.textContent = blockerCount + ' BLOCKER' + (blockerCount > 1 ? 'S' : '') + ' \u2014 RESOLVE TO CHECK OUT';

  var summary = document.createElement('div');
  summary.style.cssText = 'font-family:' + T.fb + ';font-size:' + FS_BODY + ';color:' + T.text + ';';
  var parts = [];
  if (state.openChecks.length > 0) parts.push(state.openChecks.length + ' open check' + (state.openChecks.length > 1 ? 's' : ''));
  if (state.unadjustedChecks.length > 0) parts.push(state.unadjustedChecks.length + ' unadjusted CC tip' + (state.unadjustedChecks.length > 1 ? 's' : ''));
  summary.textContent = parts.join(' \u2022 ');

  textCol.appendChild(title);
  textCol.appendChild(summary);

  // FLSA timer — reassurance that they're still on the clock while resolving.
  var timer = document.createElement('div');
  timer.style.cssText = [
    'flex-shrink:0;padding:7px 18px;border-radius:999px;',
    'background:' + T.well + ';',
    'font-family:' + T.fb + ';font-size:' + FS_META + ';color:' + T.lavender + ';',
    'letter-spacing:0.5px;',
  ].join('');
  timer.dataset.flsa = '1';
  timer.textContent = 'still on the clock \u2022 0m 00s';
  var startedAt = startTime || Date.now();
  var tick = function() {
    if (!document.body.contains(timer)) return;
    var elapsed = Math.floor((Date.now() - startedAt) / 1000);
    var mins = Math.floor(elapsed / 60);
    var secs = elapsed % 60;
    timer.textContent = 'still on the clock \u2022 ' + mins + 'm ' + (secs < 10 ? '0' : '') + secs + 's';
    setTimeout(tick, 1000);
  };
  setTimeout(tick, 1000);

  card.appendChild(icon);
  card.appendChild(textCol);
  card.appendChild(timer);

  return card;
}

// ─────────────────────────────────────────────────
//  CHECK PREVIEW (rendered inside the left column when a row is selected)
//  Matches the information density of manager-landing's check preview.
//  `chk` is the summary row, `fullOrder` is the detailed record from
//  /api/v1/orders with an items array.
// ─────────────────────────────────────────────────

function renderCheckPreview(paper, checks, allOrders) {
  var isMulti = checks.length > 1;
  var grandTotal = checks.reduce(function(s, c) { return s + (c.amount || 0); }, 0);

  // Header row — "N CHECKS" + total when multi, else single check label
  var hdrRow = document.createElement('div');
  hdrRow.style.cssText = [
    'display:flex;justify-content:space-between;align-items:baseline;',
    'padding-bottom:8px;border-bottom:1px solid ' + hexToRgba(T.text, 0.1) + ';margin-bottom:4px;',
  ].join('');
  var hLabel = document.createElement('div');
  hLabel.style.cssText = 'font-family:' + T.fh + ';font-size:14px;font-weight:700;color:' + T.green + ';letter-spacing:1.2px;';
  if (isMulti) {
    hLabel.textContent = checks.length + ' CHECKS';
  } else {
    hLabel.textContent = (checks[0].tableLabel ? checks[0].tableLabel + ' \u2022 ' : '') + (checks[0].checkLabel || checks[0].checkId);
  }
  var hTotal = document.createElement('div');
  hTotal.style.cssText = 'font-family:' + T.fh + ';font-size:14px;font-weight:700;color:' + T.gold + ';';
  hTotal.textContent = fmt(grandTotal);
  hdrRow.appendChild(hLabel);
  hdrRow.appendChild(hTotal);
  paper.appendChild(hdrRow);

  checks.forEach(function(chk, idx) {
    var fullOrder = (allOrders || []).find(function(o) { return o.order_id === chk.checkId; });

    if (isMulti) {
      // Sub-header per check — check label + server in smaller type
      var sub = document.createElement('div');
      sub.style.cssText = 'font-family:' + T.fh + ';font-size:11px;color:' + T.green + ';letter-spacing:0.5px;margin-top:' + (idx === 0 ? '0' : '8px') + ';margin-bottom:2px;';
      sub.textContent = (chk.checkLabel || chk.checkId) + (fullOrder && fullOrder.server_name ? ' \u00B7 ' + fullOrder.server_name.split(' ')[0].toUpperCase() : '');
      paper.appendChild(sub);
    } else if (fullOrder && fullOrder.server_name) {
      var srvLbl = document.createElement('div');
      srvLbl.style.cssText = 'font-family:' + T.fb + ';font-size:11px;color:' + T.elec + ';letter-spacing:0.5px;margin-bottom:4px;';
      srvLbl.textContent = fullOrder.server_name.toUpperCase();
      paper.appendChild(srvLbl);
    }

    // Meta row (only for single — collapsed on multi to save space)
    if (!isMulti) {
      var metaRow = document.createElement('div');
      metaRow.style.cssText = 'display:flex;justify-content:space-between;font-family:' + T.fb + ';font-size:11px;color:' + hexToRgba(T.text, 0.6) + ';margin-bottom:4px;';
      var mL = document.createElement('span');
      mL.textContent = chk.guests ? (chk.guests + ' guest' + (chk.guests > 1 ? 's' : '')) : '\u00A0';
      var mR = document.createElement('span');
      mR.textContent = 'opened ' + (chk.time || 'recently');
      metaRow.appendChild(mL);
      metaRow.appendChild(mR);
      paper.appendChild(metaRow);
    }

    var items = (fullOrder && fullOrder.items) || [];

    if (items.length === 0) {
      var empty = document.createElement('div');
      empty.style.cssText = 'font-family:' + T.fb + ';font-size:11px;color:' + hexToRgba(T.text, 0.6) + ';font-style:italic;padding:6px 0;';
      empty.textContent = isMulti ? 'no items' : 'no items on this check';
      paper.appendChild(empty);
    } else {
      // Cap items per check on multi-select so the paper doesn't get
      // absurdly long — show first 3, then "+N more".
      var showCap = isMulti ? 3 : items.length;
      items.slice(0, showCap).forEach(function(item) {
        var row = document.createElement('div');
        row.style.cssText = [
          'display:flex;justify-content:space-between;gap:8px;',
          'padding:3px 0;border-bottom:1px solid ' + hexToRgba(T.text, 0.06) + ';',
        ].join('');
        var nm = document.createElement('span');
        nm.style.cssText = 'font-family:' + T.fb + ';font-size:11px;color:' + T.text + ';';
        nm.textContent = (item.qty && item.qty > 1 ? item.qty + '\u00D7 ' : '') + (item.name || 'Item');
        var pr = document.createElement('span');
        pr.style.cssText = 'font-family:' + T.fb + ';font-size:11px;color:' + T.gold + ';flex-shrink:0;';
        pr.textContent = fmt((item.price || 0) * (item.qty || 1));
        row.appendChild(nm);
        row.appendChild(pr);
        paper.appendChild(row);
      });
      if (items.length > showCap) {
        var more = document.createElement('div');
        more.style.cssText = 'font-family:' + T.fb + ';font-size:10px;color:' + hexToRgba(T.text, 0.6) + ';padding-top:2px;opacity:0.6;';
        more.textContent = '+ ' + (items.length - showCap) + ' more';
        paper.appendChild(more);
      }
    }

    // Per-check totals only on single-select view
    if (!isMulti && fullOrder) {
      var sep = document.createElement('div');
      sep.style.cssText = 'height:1px;background:' + hexToRgba(T.text, 0.1) + ';margin:6px 0 2px;';
      paper.appendChild(sep);

      var addTotalRow = function(label, val, emphasis) {
        var r = document.createElement('div');
        r.style.cssText = [
          'display:flex;justify-content:space-between;padding:2px 0;',
          'font-family:' + T.fb + ';font-size:' + (emphasis ? '12px' : '11px') + ';',
          'color:' + (emphasis ? T.text : hexToRgba(T.text, 0.6)) + ';',
          emphasis ? 'font-weight:700;' : '',
        ].join('');
        var rL = document.createElement('span');
        rL.textContent = label;
        var rR = document.createElement('span');
        rR.style.cssText = emphasis ? 'color:' + T.gold + ';font-weight:700;' : 'color:' + T.gold + ';';
        rR.textContent = fmt(val);
        r.appendChild(rL);
        r.appendChild(rR);
        paper.appendChild(r);
      };

      if (fullOrder.subtotal != null) addTotalRow('subtotal', fullOrder.subtotal);
      if (fullOrder.tax != null && fullOrder.tax > 0) addTotalRow('tax', fullOrder.tax);
      addTotalRow('TOTAL', fullOrder.total || chk.amount || 0, true);
    }
// ─────────────────────────────────────────────────
//  LEFT COLUMN — STATS + CASH EXPECTED
// ─────────────────────────────────────────────────

function buildLeftCol(state, handlers) {
  var wrapper = document.createElement('div');
  wrapper.style.cssText = [
    'flex-shrink:0;width:260px;',
    'display:flex;flex-direction:column;gap:6px;',
    'min-height:0;',
  ].join('');

  var card = document.createElement('div');
  card.style.cssText = [
    'background:' + T.card + ';',
    'border-left:3px solid ' + T.green + ';',
    'border-radius:6px;',
    'display:flex;flex-direction:column;',
    'flex:1;min-height:0;overflow:hidden;',
  ].join('');

  var colBody = document.createElement('div');
  colBody.style.cssText = [
    'flex:1;padding:16px 14px 10px;',
    'display:flex;flex-direction:column;',
    'overflow-y:auto;',
    'touch-action:pan-y;overscroll-behavior:contain;',
  ].join('');

  // 1. Take Home hero
  var heroWrap = document.createElement('div');
  heroWrap.style.cssText = [
    'background:rgba(0,0,0,0.2);border-radius:6px;',
    'padding:12px 10px;margin:0 -4px;',
    'display:flex;flex-direction:column;gap:2px;',
  ].join('');

  var heroLabel = document.createElement('div');
  heroLabel.style.cssText = [
    'font-family:' + T.fh + ';font-size:10px;font-weight:700;',
    'letter-spacing:2px;color:' + T.moon + ';text-transform:uppercase;',
  ].join('');
  heroLabel.textContent = 'TAKE HOME';

  var heroValue = document.createElement('div');
  heroValue.style.cssText = [
    'font-family:' + T.fb + ';font-size:32px;font-weight:700;',
    'color:' + T.greenWarm + ';line-height:1.1;',
  ].join('');
  heroValue.textContent = fmt(state.takeHome);

  var heroMeta = document.createElement('div');
  heroMeta.style.cssText = 'font-family:' + T.fb + ';font-size:11px;color:' + T.moon + ';';
  heroMeta.textContent = 'tips − tipout';

  heroWrap.appendChild(heroLabel);
  heroWrap.appendChild(heroValue);
  heroWrap.appendChild(heroMeta);
  colBody.appendChild(heroWrap);

  // 2. Divider
  colBody.appendChild(_leftColDivider());

  // 3. Card Tips
  colBody.appendChild(_leftColStat('CARD TIPS', fmt(state.cardTips), T.gold));

  // 4. Divider
  colBody.appendChild(_leftColDivider());

  // 5. Tip-Out
  var toSectionLabel = document.createElement('div');
  toSectionLabel.style.cssText = [
    'font-family:' + T.fh + ';font-size:10px;font-weight:700;',
    'letter-spacing:2px;color:' + T.moon + ';text-transform:uppercase;',
  ].join('');
  toSectionLabel.textContent = 'TIP-OUT';
  colBody.appendChild(toSectionLabel);

  var toBlock = document.createElement('div');
  toBlock.style.cssText = [
    'background:' + T.well + ';border-radius:5px;',
    'padding:8px 10px;',
    'display:flex;flex-direction:column;gap:6px;',
    'margin-top:2px;',
  ].join('');

  var tipoutRules = state.tipoutRules || [];
  tipoutRules.forEach(function(r) {
    var ruleRow = document.createElement('div');
    ruleRow.style.cssText = 'display:grid;grid-template-columns:auto 1fr auto;gap:6px;align-items:baseline;';
    var roleName = document.createElement('div');
    roleName.style.cssText = 'font-family:' + T.fb + ';font-size:12px;font-weight:700;color:' + T.text + ';';
    roleName.textContent = r.role || r.name || 'Role';
    var basis = document.createElement('div');
    basis.style.cssText = 'font-family:' + T.fb + ';font-size:10px;color:' + T.moon + ';';
    basis.textContent = (r.percentage || 0) + '% · ' + (r.category || r.basis || 'Net Sales');
    var ruleAmt = document.createElement('div');
    ruleAmt.style.cssText = 'font-family:' + T.fb + ';font-size:13px;font-weight:700;color:' + T.verm + ';';
    ruleAmt.textContent = '−' + fmt(((r.percentage || 0) / 100) * (state.netSales || 0));
    ruleRow.appendChild(roleName);
    ruleRow.appendChild(basis);
    ruleRow.appendChild(ruleAmt);
    toBlock.appendChild(ruleRow);
  });

  var toCrule = document.createElement('div');
  toCrule.style.cssText = 'height:1px;background:' + T.border + ';opacity:0.5;';
  toBlock.appendChild(toCrule);

  var toTotRow = document.createElement('div');
  toTotRow.style.cssText = 'display:flex;justify-content:space-between;align-items:baseline;';
  var toTotLabel = document.createElement('div');
  toTotLabel.style.cssText = [
    'font-family:' + T.fh + ';font-size:10px;font-weight:700;',
    'letter-spacing:1.5px;color:' + T.moon + ';text-transform:uppercase;',
  ].join('');
  toTotLabel.textContent = 'TOTAL';
  var toTotValue = document.createElement('div');
  toTotValue.style.cssText = 'font-family:' + T.fb + ';font-size:17px;font-weight:700;color:' + T.verm + ';';
  toTotValue.textContent = '−' + fmt(state.tipOutTotal);
  toTotRow.appendChild(toTotLabel);
  toTotRow.appendChild(toTotValue);
  toBlock.appendChild(toTotRow);
  colBody.appendChild(toBlock);

  // Adjust Rates pill
  var adjBtn = document.createElement('div');
  adjBtn.style.cssText = [
    'width:100%;box-sizing:border-box;border-radius:999px;',
    'border:1px solid ' + T.border + ';background:transparent;',
    'display:flex;align-items:center;justify-content:center;gap:5px;',
    'padding:6px 0;margin-top:7px;cursor:pointer;',
    'font-family:' + T.fh + ';font-size:10px;font-weight:700;',
    'letter-spacing:1.5px;color:' + T.moon + ';text-transform:uppercase;',
    'pointer-events:auto;touch-action:manipulation;',
    'transition:border-color 0.15s, color 0.15s;',
  ].join('');

  (function() {
    var ns = 'http://www.w3.org/2000/svg';
    var svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('width', '9');
    svg.setAttribute('height', '10');
    svg.setAttribute('viewBox', '0 0 9 10');
    svg.setAttribute('fill', 'none');
    svg.style.flexShrink = '0';
    var lockRect = document.createElementNS(ns, 'rect');
    lockRect.setAttribute('x', '1');
    lockRect.setAttribute('y', '4');
    lockRect.setAttribute('width', '7');
    lockRect.setAttribute('height', '5.5');
    lockRect.setAttribute('rx', '1');
    lockRect.setAttribute('fill', 'currentColor');
    var lockPath = document.createElementNS(ns, 'path');
    lockPath.setAttribute('d', 'M2.5 4V3a2 2 0 0 1 4 0v1');
    lockPath.setAttribute('stroke', 'currentColor');
    lockPath.setAttribute('stroke-width', '1.2');
    lockPath.setAttribute('fill', 'none');
    svg.appendChild(lockRect);
    svg.appendChild(lockPath);
    adjBtn.appendChild(svg);
  })();

  var adjText = document.createElement('span');
  adjText.textContent = 'Adjust Rates';
  adjBtn.appendChild(adjText);

  adjBtn.addEventListener('pointerenter', function() {
    adjBtn.style.borderColor = T.warning;
    adjBtn.style.color = T.warning;
  });
  adjBtn.addEventListener('pointerleave', function() {
    adjBtn.style.borderColor = T.border;
    adjBtn.style.color = T.moon;
  });
  adjBtn.addEventListener('pointerup', function() {
    if (handlers && handlers.onAdjustRates) handlers.onAdjustRates();
  });
  colBody.appendChild(adjBtn);

  // 6. Divider
  colBody.appendChild(_leftColDivider());

  // 7. Checks Closed
  colBody.appendChild(_leftColStat('CHECKS CLOSED', String(state.checksClosed), T.text));

  card.appendChild(colBody);

  // cash-footer
  var cashFooter = document.createElement('div');
  cashFooter.style.cssText = [
    'flex-shrink:0;',
    'border-top:1px solid ' + hexToRgba(T.gold, 0.35) + ';',
    'background:' + hexToRgba(T.gold, 0.06) + ';',
    'border-radius:0 0 6px 6px;',
    'padding:12px 14px 14px;',
    'display:flex;flex-direction:column;gap:6px;',
  ].join('');

  var cfLabel = document.createElement('div');
  cfLabel.style.cssText = [
    'font-family:' + T.fh + ';font-size:10px;font-weight:700;',
    'letter-spacing:2px;text-transform:uppercase;',
    'color:' + hexToRgba(T.gold, 0.75) + ';',
  ].join('');
  cfLabel.textContent = 'CASH EXPECTED';

  var cfAmount = document.createElement('div');
  cfAmount.style.cssText = [
    'font-family:' + T.fb + ';font-size:28px;font-weight:700;',
    'color:' + T.gold + ';line-height:1.1;',
  ].join('');
  cfAmount.textContent = fmt(state.cashExpected);

  var cfMath = document.createElement('div');
  cfMath.style.cssText = [
    'display:flex;flex-direction:row;gap:6px;align-items:baseline;',
    'font-family:' + T.fb + ';font-size:11px;',
  ].join('');

  [
    { text: fmt(state.cashSales), color: T.text, bold: true },
    { text: 'cash',               color: T.moon },
    { text: '−',             color: T.moon },
    { text: fmt(state.cardTips),  color: T.verm, bold: true },
    { text: 'tips',               color: T.moon },
  ].forEach(function(seg) {
    var s = document.createElement('span');
    s.style.color = seg.color;
    if (seg.bold) s.style.fontWeight = '700';
    s.textContent = seg.text;
    cfMath.appendChild(s);
  });

  cashFooter.appendChild(cfLabel);
  cashFooter.appendChild(cfAmount);
  cashFooter.appendChild(cfMath);
  card.appendChild(cashFooter);
  wrapper.appendChild(card);

  // Print pill
  var printPill = document.createElement('div');
  printPill.style.cssText = [
    'width:100%;border-radius:999px;padding:10px 0;',
    'background:' + T.elec + ';box-shadow:0 4px 0 ' + T.elecDk + ';',
    'font-family:' + T.fh + ';font-size:13px;font-weight:700;',
    'letter-spacing:2px;color:' + T.well + ';text-transform:uppercase;',
    'text-align:center;',
    'touch-action:manipulation;pointer-events:auto;cursor:pointer;',
    'user-select:none;-webkit-user-select:none;',
    'transition:filter 0.1s;flex-shrink:0;box-sizing:border-box;',
  ].join('');
  printPill.textContent = 'Print Slip';

  printPill.addEventListener('pointerenter', function() {
    printPill.style.filter = 'brightness(1.08)';
  });
  printPill.addEventListener('pointerdown', function() {
    printPill.style.transform = 'translateY(2px)';
    printPill.style.boxShadow = '0 2px 0 ' + T.elecDk;
  });
  var _printRelease = function() {
    printPill.style.transform = '';
    printPill.style.boxShadow = '0 4px 0 ' + T.elecDk;
    printPill.style.filter = '';
  };
  printPill.addEventListener('pointerup', function() {
    _printRelease();
    if (handlers && handlers.onPrintSlip) handlers.onPrintSlip();
  });
  printPill.addEventListener('pointerleave', _printRelease);
  printPill.addEventListener('pointercancel', _printRelease);

  wrapper.appendChild(printPill);
  return wrapper;
}

function _leftColDivider() {
  var d = document.createElement('div');
  d.style.cssText = 'height:1px;background:' + hexToRgba(T.text, 0.08) + ';margin:6px 0;flex-shrink:0;';
  return d;
}

function _leftColStat(label, value, valueColor) {
  var row = document.createElement('div');
  row.style.cssText = 'display:flex;flex-direction:column;gap:2px;';
  var lbl = document.createElement('div');
  lbl.style.cssText = [
    'font-family:' + T.fh + ';font-size:10px;font-weight:700;',
    'letter-spacing:2px;color:' + T.moon + ';text-transform:uppercase;',
  ].join('');
  lbl.textContent = label;
  var val = document.createElement('div');
  val.style.cssText = 'font-family:' + T.fb + ';font-size:17px;font-weight:700;color:' + valueColor + ';';
  val.textContent = value;
  row.appendChild(lbl);
  row.appendChild(val);
  return row;
}


// ─────────────────────────────────────────────────
//  CARD STACK HELPERS (middle column)
// ─────────────────────────────────────────────────

// Base card shell — border-left accent + optional stroke border.
function buildBaseCard(opts) {
  opts = opts || {};
  var card = buildStaticCard({ accent: opts.accent || T.green });
  if (opts.stroke) card.style.border = '1.5px solid ' + opts.stroke;
  card.style.opacity = opts.dimmed ? '0.45' : '1';
  card.style.transition = 'opacity 0.2s';
  card.style.padding = '12px 16px';
  card.style.display = 'flex';
  card.style.flexDirection = 'column';
  card.style.gap = '8px';
  card.style.flexShrink = '0';

  return card;
}

// ── Checks card — Active / All tab switcher ──
function buildChecksCard(state, handlers, activeTab, selectedCheckIds) {
  selectedCheckIds = selectedCheckIds || [];
  if (!activeTab) {
    activeTab = (state.openChecks && state.openChecks.length > 0) ? 'active' : 'all';
  }

  var hasOpen = state.openChecks.length > 0;
  var accentColor = hasOpen ? T.verm : T.elec;
  var allChecks = state.checks || [];

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

  // Tab pills
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

  tabBar.appendChild(makeTab('active', 'Active', state.openChecks.length, T.elec));
  tabBar.appendChild(makeTab('all', 'All', allChecks.length, T.moon));
  hdr.appendChild(tabBar);
  card.appendChild(hdr);

  // List
  var list = document.createElement('div');
  list.style.cssText = [
    'display:flex;flex-direction:column;gap:6px;',
    'max-height:280px;overflow-y:auto;',
    'touch-action:pan-y;overscroll-behavior:contain;',
  ].join('');

  if (activeTab === 'active') {
    state.openChecks.forEach(function(chk) {
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
  if (chk.guests) metaParts.push(chk.guests + ' guest' + (chk.guests > 1 ? 's' : ''));
  if (chk.time) metaParts.push('opened ' + chk.time);
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

  // Top row
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
  if (chk.time) metaParts.push('closed ' + chk.time);
  if (chk.tip != null) metaParts.push('tip ' + fmt(chk.tip));
  meta.textContent = metaParts.join(' · ');
  info.appendChild(meta);

  // Payment tag
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

  // Actions row
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

// ── Tips card — filterable between Unadjusted (blocker) and Adjusted (review)
// Shown whenever there are ANY closed-card checks. When there are unadjusted
// tips, this is the yellow blocker. When all tips are adjusted, it becomes a
// gold review card so the server can fix typos by tapping EDIT on any row.
function buildTipsCard(state, handlers, tipFilter) {
  var hasUnadj = state.unadjustedChecks.length > 0;
  var accentColor = hasUnadj ? T.warning : T.gold;

  var card = buildBaseCard({ accent: accentColor, stroke: accentColor });
  card.dataset.cardKey = 'unadjusted-tips';

  // Header row — icon + title + filter tabs on the right
  var hdr = document.createElement('div');
  hdr.style.cssText = 'display:flex;align-items:center;gap:10px;flex-shrink:0;flex-wrap:wrap;';

  var icon = document.createElement('div');
  icon.style.cssText = [
    'width:18px;height:18px;border-radius:4px;flex-shrink:0;',
    'background:' + hexToRgba(accentColor, 0.18) + ';',
    'display:flex;align-items:center;justify-content:center;',
    'font-family:' + T.fb + ';font-size:14px;font-weight:700;color:' + accentColor + ';',
  ].join('');
  icon.textContent = hasUnadj ? '!' : '\u2713';

  var title = document.createElement('span');
  title.style.cssText = 'flex:1;font-family:' + T.fh + ';font-size:13px;font-weight:700;color:' + accentColor + ';letter-spacing:1.8px;';
  if (hasUnadj) {
    title.textContent = 'UNADJUSTED TIPS \u2022 ' + state.unadjustedChecks.length;
  } else {
    title.textContent = 'TIPS \u2022 ALL ADJUSTED';
  }

  // Filter tabs — always visible whenever the card renders, so the
  // server always has the same mental model (unadj/adj counts + toggle)
  // regardless of whether there's still a blocker. "UNADJ 0" is useful
  // info on its own — tells the server at a glance that everything's done.
  var unadjCount = state.unadjustedChecks.length;
  var adjCount   = state.adjustedChecks.length;

  hdr.appendChild(icon);
  hdr.appendChild(title);
  hdr.appendChild(buildTipFilterTabs(tipFilter, unadjCount, adjCount, handlers));

  card.appendChild(hdr);

  // Row list — content depends on current filter
  var list = document.createElement('div');
  list.style.cssText = 'display:flex;flex-direction:column;gap:8px;max-height:240px;overflow-y:auto;touch-action:pan-y;overscroll-behavior:contain;';

  var showing = (tipFilter === 'adjusted') ? state.adjustedChecks : state.unadjustedChecks;
  var mode = (tipFilter === 'adjusted') ? 'adjusted' : 'unadjusted';

  showing.forEach(function(chk) {
    list.appendChild(buildTipRow(chk, mode, handlers));
  });

  card.appendChild(list);
  return card;
}

// Filter tab switcher — two pills, active one is filled, inactive is outlined.
function buildTipFilterTabs(activeFilter, unadjCount, adjCount, handlers) {
  var wrap = document.createElement('div');
  wrap.style.cssText = 'display:flex;gap:6px;flex-shrink:0;';

  var makeTab = function(key, label, count, activeColor) {
    var active = activeFilter === key || (activeFilter == null && key === 'unadjusted' && unadjCount > 0);
    var pill = document.createElement('div');
    pill.style.cssText = [
      'padding:4px 10px;border-radius:999px;',
      'font-family:' + T.fh + ';font-size:11px;font-weight:700;letter-spacing:1px;',
      'cursor:pointer;user-select:none;-webkit-user-select:none;',
      'pointer-events:auto;touch-action:manipulation;',
      active
        ? 'background:' + activeColor + ';color:' + T.well + ';'
        : 'background:transparent;color:' + hexToRgba(T.text, 0.6) + ';border:1px solid ' + hexToRgba(T.text, 0.2) + ';',
    ].join('');
    pill.textContent = label + ' ' + count;
    pill.addEventListener('pointerup', function(e) {
      e.stopPropagation();
      if (handlers.onTipFilterChange) handlers.onTipFilterChange(key);
    });
    return pill;
  };

  wrap.appendChild(makeTab('unadjusted', 'UNADJ', unadjCount, T.warning));
  wrap.appendChild(makeTab('adjusted',   'ADJ',   adjCount,   T.gold));
  return wrap;
}

// Row for a single check — renders different action button based on mode.
function buildTipRow(chk, mode, handlers) {
  var row = document.createElement('div');
  row.style.cssText = [
    'display:flex;gap:10px;align-items:center;',
    'padding:8px 12px;background:' + T.well + ';border-radius:8px;user-select:none;-webkit-user-select:none;touch-action:pan-y;',
  ].join('');

  var info = document.createElement('div');
  info.style.cssText = 'flex:1;display:flex;flex-direction:column;gap:2px;min-width:0;';
  var label = document.createElement('div');
  label.style.cssText = 'font-family:' + T.fb + ';font-size:14px;font-weight:700;color:' + T.text + ';';
  label.textContent = (chk.tableLabel ? chk.tableLabel + ' \u2022 ' : '') + 'Check ' + (chk.checkLabel || chk.checkId);
  var meta = document.createElement('div');
  meta.style.cssText = 'font-family:' + T.fb + ';font-size:13px;color:' + hexToRgba(T.text, 0.6) + ';';
  meta.textContent = 'closed ' + (chk.time || '') + (chk.cardBrand ? ' \u2022 ' + chk.cardBrand : '');
  info.appendChild(label);
  info.appendChild(meta);

  var amtCol = document.createElement('div');
  amtCol.style.cssText = 'flex-shrink:0;display:flex;flex-direction:column;align-items:flex-end;gap:2px;';
  var sub = document.createElement('div');
  sub.style.cssText = 'font-family:' + T.fb + ';font-size:14px;color:' + hexToRgba(T.text, 0.6) + ';';
  sub.innerHTML = '<span style="color:' + hexToRgba(T.text, 0.6) + ';margin-right:8px;">subtotal</span><span style="font-weight:700;color:' + T.gold + ';">' + fmt(chk.amount || 0) + '</span>';
  var tip = document.createElement('div');

  if (mode === 'adjusted') {
    // Show the actual tip amount already entered
    tip.style.cssText = 'font-family:' + T.fb + ';font-size:14px;color:' + T.green + ';';
    tip.innerHTML = '<span style="color:' + hexToRgba(T.text, 0.6) + ';margin-right:8px;">tip</span><span style="font-weight:700;color:' + T.green + ';">' + fmt(chk.tip || 0) + '</span>';
  } else {
    tip.style.cssText = 'font-family:' + T.fb + ';font-size:14px;color:' + T.warning + ';';
    tip.innerHTML = '<span style="color:' + T.warning + ';margin-right:8px;">tip</span><span style="font-weight:700;">\u2014 pending</span>';
  }

  amtCol.appendChild(sub);
  amtCol.appendChild(tip);

  var actionBtn;
  if (mode === 'adjusted') {
    actionBtn = buildRowPill({
      label: 'EDIT',
      variant: 'outline',
      width: 76,
      onClick: function() { if (handlers.onEditTip) handlers.onEditTip(chk); },
    });
  } else {
    actionBtn = buildRowPill({
      label: 'ADJUST',
      variant: 'yellow',
      width: 76,
      onClick: function() { if (handlers.onAdjustTip) handlers.onAdjustTip(chk); },
    });
  }

  row.appendChild(info);
  row.appendChild(amtCol);
  row.appendChild(actionBtn);
  return row;
}

// ── Compact pill button for row actions (32px tall) ──
function buildRowPill(opts) {
  var variant = opts.variant || 'elec';
  var bg, fg, stroke = null;
  if (variant === 'elec')     { bg = T.elec;   fg = T.well; }
  else if (variant === 'yellow')  { bg = T.warning; fg = T.well; }
  else if (variant === 'verm')    { bg = T.verm;   fg = T.text; }
  else if (variant === 'outline') { bg = T.bg;     fg = T.text; stroke = hexToRgba(T.text, 0.2); }
  else                            { bg = T.elec;   fg = T.well; }

  var wrap = document.createElement('div');
  wrap.style.cssText = [
    'flex-shrink:0;display:flex;align-items:center;justify-content:center;',
    'height:32px;width:' + (opts.width || 120) + 'px;',
    'background:' + bg + ';',
    stroke ? 'border:1px solid ' + stroke + ';' : '',
    'border-radius:999px;',
    'cursor:pointer;user-select:none;-webkit-user-select:none;',
    'pointer-events:auto;touch-action:manipulation;',
    'font-family:' + T.fh + ';font-size:14px;font-weight:700;letter-spacing:1.2px;color:' + fg + ';',
    'box-shadow:0 2px 0 rgba(0,0,0,0.25);',
  ].join('');
  wrap.textContent = opts.label;
  wrap.addEventListener('pointerup', function(e) {
    e.stopPropagation();
    if (opts.onClick) opts.onClick();
  });
  return wrap;
}

// ─────────────────────────────────────────────────
//  MIDDLE COLUMN — card stack
// ─────────────────────────────────────────────────

function buildMiddleCol(state, handlers, tipFilter, selectedCheckIds, activeTab) {
  selectedCheckIds = selectedCheckIds || [];
  var col = document.createElement('div');
  col.style.cssText = [
    'flex:1;display:flex;flex-direction:column;gap:' + T.colGapSm + 'px;',
    'min-width:0;min-height:0;',
    // Single scroll surface — whole column width is draggable/wheel-scrollable.
    // touch-action:pan-y tells the browser vertical panning is the intended
    // gesture anywhere in this container, so drag-to-scroll works on cards and
    // rows, not just on the scrollbar's 2px gutter.
    'overflow-y:auto;overflow-x:hidden;',
    'touch-action:pan-y;',
    '-webkit-overflow-scrolling:touch;',
    'overscroll-behavior:contain;',
  ].join('');

  var blocked = (state.openChecks.length + state.unadjustedChecks.length) > 0;

  col.appendChild(buildChecksCard(state, handlers, activeTab, selectedCheckIds));

  // Tips card — shown whenever there are any closed CC checks, either as
  // the yellow blocker (unadjusted) or gold review (all adjusted). The
  // filter tabs let the server flip between the two lists to fix typos.
  if (state.unadjustedChecks.length > 0 || state.adjustedChecks.length > 0) {
    col.appendChild(buildTipsCard(state, handlers, tipFilter));
  }

  return col;
}

// ─────────────────────────────────────────────────
//  RIGHT COLUMN — actions + blocker queue + timer
// ─────────────────────────────────────────────────

function buildActionsCol(state, handlers, startTime) {
  var blocked = (state.openChecks.length + state.unadjustedChecks.length) > 0;

  var col = buildStaticCard({ accent: T.green });
  col.style.cssText += [
    'flex-shrink:0;width:' + RIGHT_W + 'px;',
    'padding:14px 16px;box-sizing:border-box;',
    'display:flex;flex-direction:column;gap:10px;',
  ].join('');

  var title = document.createElement('div');
  title.style.cssText = 'font-family:' + T.fh + ';font-size:13px;font-weight:700;color:' + T.text + ';letter-spacing:1.8px;flex-shrink:0;';
  title.textContent = 'ACTIONS';
  col.appendChild(title);

  // Back button
  col.appendChild(buildPillButton({
    label: 'BACK TO FLOOR',
    variant: 'ghost',
    shape: 'chamfer',
    fontSize: FS_PILL_LG,
    padding: '10px 14px',
    onClick: function() { if (handlers.onBack) handlers.onBack(); },
  }));

  // Print Slip (disabled while blocked)
  col.appendChild(buildPillButton({
    label: 'PRINT SLIP',
    variant: blocked ? 'ghost' : 'ghost',
    disabled: blocked,
    shape: 'chamfer',
    fontSize: FS_PILL_LG,
    padding: '10px 14px',
    onClick: function() {
      if (blocked) return;
      if (handlers.onPrint) handlers.onPrint();
    },
  }));

  // Finalize — the big one.
  var finalizeBtn = buildPillButton({
    label: 'FINALIZE' + (blocked ? '' : ' CHECKOUT'),
    variant: blocked ? 'ghost' : 'goGreen',
    disabled: blocked,
    shape: 'chamfer',
    fontSize: FS_PILL_LG,
    padding: '12px 14px',
    onClick: function() {
      if (blocked) return;
      if (handlers.onFinalize) handlers.onFinalize();
    },
  });
  if (blocked) {
    finalizeBtn.style.opacity = '0.5';
    var sub = document.createElement('div');
    sub.style.cssText = 'font-family:' + T.fb + ';font-size:12px;color:' + hexToRgba(T.text, 0.6) + ';margin-top:2px;font-weight:normal;letter-spacing:0;text-transform:none;';
    sub.textContent = 'resolve ' + (state.openChecks.length + state.unadjustedChecks.length) + ' blockers first';
    finalizeBtn.appendChild(sub);
    finalizeBtn.style.flexDirection = 'column';
    finalizeBtn.style.height = '58px';
  } else {
    finalizeBtn.style.height = '58px';
    finalizeBtn.style.boxShadow = '0 3px 0 rgba(0,0,0,0.3)';
  }
  col.appendChild(finalizeBtn);

  // Blocker queue (when blocked)
  if (blocked) {
    col.appendChild(buildBlockerQueue(state, handlers));
  }

  // Flex spacer to push footer down
  var spacer = document.createElement('div');
  spacer.style.cssText = 'flex:1;';
  col.appendChild(spacer);

  // Footer — elapsed timer + FLSA indicator
  col.appendChild(buildTimerFooter(startTime));

  return col;
}

function buildActionPill(opts) {
  var variant = opts.variant || 'outline';
  var bg, fg, stroke, opacity = 1;
  if (variant === 'outline') {
    bg = T.well;
    fg = T.text;
    stroke = hexToRgba(T.text, 0.2);
  } else if (variant === 'disabled') {
    bg = T.well;
    fg = hexToRgba(T.text, 0.6);
    stroke = hexToRgba(T.text, 0.1);
    opacity = 0.4;
  } else {
    bg = T.well;
    fg = T.text;
    stroke = hexToRgba(T.text, 0.2);
  }

  var wrap = document.createElement('div');
  wrap.style.cssText = [
    'flex-shrink:0;display:flex;align-items:center;justify-content:center;',
    'height:44px;',
    'background:' + bg + ';border:1px solid ' + stroke + ';border-radius:999px;',
    'cursor:' + (variant === 'disabled' ? 'default' : 'pointer') + ';',
    'user-select:none;-webkit-user-select:none;',
    'pointer-events:auto;touch-action:manipulation;',
    'font-family:' + T.fh + ';font-size:12px;font-weight:700;letter-spacing:1.2px;color:' + fg + ';',
    'opacity:' + opacity + ';',
  ].join('');
  wrap.textContent = opts.label;
  wrap.addEventListener('pointerup', function() {
    if (opts.onClick) opts.onClick();
  });
  return wrap;
}

function buildFinalizePill(opts) {
  var blocked = !!opts.blocked;
  var bg = blocked ? T.well : T.green;
  var fg = blocked ? hexToRgba(T.text, 0.6) : T.well;
  var stroke = blocked ? hexToRgba(T.text, 0.1) : null;
  var opacity = blocked ? 0.5 : 1;

  var wrap = document.createElement('div');
  wrap.style.cssText = [
    'flex-shrink:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:2px;',
    'height:58px;',
    'background:' + bg + ';',
    stroke ? 'border:1px solid ' + stroke + ';' : '',
    'border-radius:999px;',
    'cursor:' + (blocked ? 'default' : 'pointer') + ';',
    'user-select:none;-webkit-user-select:none;',
    'pointer-events:auto;touch-action:manipulation;',
    'opacity:' + opacity + ';',
    blocked ? '' : 'box-shadow:0 3px 0 rgba(0,0,0,0.3);',
  ].join('');

  var main = document.createElement('div');
  main.style.cssText = 'font-family:' + T.fh + ';font-size:17px;font-weight:700;letter-spacing:1.5px;color:' + fg + ';';
  main.textContent = 'FINALIZE' + (blocked ? '' : ' CHECKOUT');
  wrap.appendChild(main);

  if (blocked) {
    var sub = document.createElement('div');
    sub.style.cssText = 'font-family:' + T.fb + ';font-size:12px;color:' + hexToRgba(T.text, 0.6) + ';';
    sub.textContent = 'resolve ' + opts.blockerCount + ' blocker' + (opts.blockerCount > 1 ? 's' : '') + ' first';
    wrap.appendChild(sub);
  }

  wrap.addEventListener('pointerup', function() {
    if (opts.onClick) opts.onClick();
  });
  return wrap;
}

function buildBlockerQueue(state, handlers) {
  var wrap = document.createElement('div');
  wrap.style.cssText = [
    'flex-shrink:0;background:' + T.well + ';border-radius:8px;padding:12px;',
    'display:flex;flex-direction:column;gap:8px;',
  ].join('');

  var title = document.createElement('div');
  title.style.cssText = 'font-family:' + T.fh + ';font-size:12px;font-weight:700;color:' + T.verm + ';letter-spacing:1.8px;';
  title.textContent = 'BLOCKER QUEUE';
  wrap.appendChild(title);

  if (state.openChecks.length > 0) {
    wrap.appendChild(buildBlockerQueueRow({
      accent: T.verm,
      kind: 'OPEN CHECK' + (state.openChecks.length > 1 ? 'S (' + state.openChecks.length + ')' : ''),
      detail: state.openChecks.length === 1
        ? (state.openChecks[0].tableLabel || 'Check') + ' \u2022 ' + fmt(state.openChecks[0].amount || 0)
        : fmt(state.openChecks.reduce(function(s, c) { return s + (c.amount || 0); }, 0)) + ' total',
      cardKey: 'open-checks',
      onClick: function() { if (handlers.onJumpToCard) handlers.onJumpToCard('open-checks'); },
    }));
  }

  if (state.unadjustedChecks.length > 0) {
    wrap.appendChild(buildBlockerQueueRow({
      accent: T.warning,
      kind: 'TIPS PENDING',
      detail: state.unadjustedChecks.length + ' CC txn' + (state.unadjustedChecks.length > 1 ? 's' : ''),
      cardKey: 'unadjusted-tips',
      onClick: function() { if (handlers.onJumpToCard) handlers.onJumpToCard('unadjusted-tips'); },
    }));
  }

  return wrap;
}

function buildBlockerQueueRow(opts) {
  var row = document.createElement('div');
  row.style.cssText = [
    'position:relative;padding:6px 8px 6px 12px;',
    'background:' + T.bg + ';border-radius:6px;',
    'display:flex;flex-direction:column;gap:2px;',
    // Tappable — lets server jump the middle column to the matching card.
    'cursor:pointer;user-select:none;-webkit-user-select:none;',
    'pointer-events:auto;touch-action:manipulation;',
    'transition:background 0.15s;',
  ].join('');
  row.addEventListener('pointerup', function() {
    if (opts.onClick) opts.onClick();
  });
  row.addEventListener('pointerenter', function() {
    row.style.background = hexToRgba(opts.accent, 0.08);
  });
  row.addEventListener('pointerleave', function() {
    row.style.background = T.bg;
  });

  var bar = document.createElement('div');
  bar.style.cssText = 'position:absolute;left:0;top:4px;bottom:4px;width:3px;border-radius:1.5px;background:' + opts.accent + ';';
  row.appendChild(bar);

  var kind = document.createElement('div');
  kind.style.cssText = 'font-family:' + T.fb + ';font-size:12px;font-weight:700;color:' + opts.accent + ';letter-spacing:0.5px;';
  kind.textContent = opts.kind;
  row.appendChild(kind);

  var detail = document.createElement('div');
  detail.style.cssText = 'font-family:' + T.fb + ';font-size:13px;color:' + T.text + ';';
  detail.textContent = opts.detail;
  row.appendChild(detail);

  return row;
}

function buildTimerFooter(startTime) {
  var started = startTime || Date.now();
  var wrap = document.createElement('div');
  wrap.style.cssText = 'flex-shrink:0;display:flex;flex-direction:column;gap:4px;padding:8px 0 0;border-top:1px solid ' + hexToRgba(T.text, 0.08) + ';';

  var row = document.createElement('div');
  row.style.cssText = 'display:flex;justify-content:space-between;font-family:' + T.fb + ';font-size:12px;color:' + hexToRgba(T.text, 0.6) + ';';
  var rowL = document.createElement('span'); rowL.textContent = 'elapsed';
  var rowR = document.createElement('span');
  rowR.style.color = T.green;
  rowR.style.fontWeight = '700';
  rowR.textContent = '0m 00s';
  row.appendChild(rowL);
  row.appendChild(rowR);
  wrap.appendChild(row);

  var flsa = document.createElement('div');
  flsa.style.cssText = 'font-family:' + T.fb + ';font-size:11px;color:' + T.green + ';';
  flsa.textContent = 'FLSA timer active';
  wrap.appendChild(flsa);

  // Live update elapsed
  var tick = function() {
    if (!document.body.contains(rowR)) return;
    var elapsed = Math.floor((Date.now() - started) / 1000);
    var m = Math.floor(elapsed / 60);
    var s = elapsed % 60;
    rowR.textContent = m + 'm ' + (s < 10 ? '0' : '') + s + 's';
    setTimeout(tick, 1000);
  };
  setTimeout(tick, 1000);

  return wrap;
}

// ═══════════════════════════════════════════════════
//  SCENE
// ═══════════════════════════════════════════════════

defineScene({
  name: 'server-checkout',
  state: {
    data: null,
    fromManager: false,
    startTime: null,
    tipFilter: null, // 'unadjusted' | 'adjusted' — resolved per-render based on data
    selectedCheckIds: [], // array of check IDs pinned to the preview panel
    activeTab: 'active',
    _refreshing: false,
    el: null,
  },
  render: function(container, params, state) {
    state.el = container;
    // ── Param normalization — accepts legacy { employeeId, employeeName }
    //    and new { staff, fromManager } shape from manager-landing.
    //    staff object may carry either `.id` or `.employee_id` depending
    //    on which flow populated it (login currently sets employee_id);
    //    check both. Matches manager-landing's defensive read at line 659.
    params = params || {};
    var employeeId   = params.employeeId
                       || (params.staff && (params.staff.id || params.staff.employee_id))
                       || null;
    var employeeName = params.employeeName
                       || (params.staff && params.staff.name)
                       || '';
    state.fromManager = !!params.fromManager;
    state.startTime   = state.startTime || Date.now();

    params = Object.assign({}, params, {
      employeeId:   employeeId,
      employeeName: employeeName,
    });

    // Hide OrderSummary — this scene owns its own left column now.
    OrderSummary.hide();

    if (window._header && window._header.setBackHandler) {
      window._header.setBackHandler(function() {
        var target = state.fromManager ? 'manager-landing' : 'server-landing';
        SceneManager.mountWorking(target, { staff: params.staff });
      });
    }

    container.style.cssText = [
      'width:100%;height:100%;',
      'display:flex;flex-direction:column;gap:' + T.colGapSm + 'px;',
      'padding:' + PAD_TOP + 'px ' + PAD + 'px ' + PAD + 'px ' + PAD + 'px;',
      'box-sizing:border-box;overflow:hidden;',
      'background:' + T.bg + ';',
    ].join('');

    function refresh() {
      if (state._refreshing || !state.el) return;
      state._refreshing = true;

      fetchServerState(params).then(function(newData) {
        state._refreshing = false;
        if (!state.el) return;
        state.data = newData;
        rebuild();
      }).catch(function(err) {
        state._refreshing = false;
        if (!state.el) return;

        // Most likely: missing employee id (backend auth didn't populate
        // state.emp.id at login). Surface clearly so the server doesn't
        // see someone else's checks by accident.
        container.innerHTML = '';
        var errPanel = document.createElement('div');
        errPanel.style.cssText = [
          'flex:1;display:flex;align-items:center;justify-content:center;',
          'padding:40px;text-align:center;',
        ].join('');
        var errCard = document.createElement('div');
        errCard.style.cssText = [
          'background:' + T.card + ';border:2px solid ' + T.verm + ';',
          'border-radius:12px;padding:28px 36px;max-width:420px;',
          'display:flex;flex-direction:column;gap:10px;align-items:center;',
        ].join('');
        var t = document.createElement('div');
        t.style.cssText = 'font-family:' + T.fh + ';font-size:14px;font-weight:700;color:' + T.verm + ';letter-spacing:2px;';
        t.textContent = 'CHECKOUT UNAVAILABLE';
        var m = document.createElement('div');
        m.style.cssText = 'font-family:' + T.fb + ';font-size:13px;color:' + T.text + ';line-height:1.5;';
        m.textContent = 'Your session is missing an employee ID. Log out and log back in to refresh it.';
        var d = document.createElement('div');
        d.style.cssText = 'font-family:' + T.fb + ';font-size:11px;color:' + hexToRgba(T.text, 0.6) + ';font-style:italic;margin-top:6px;';
        d.textContent = (err && err.message) || '';
        errCard.appendChild(t);
        errCard.appendChild(m);
        errCard.appendChild(d);
        errPanel.appendChild(errCard);
        container.appendChild(errPanel);
      });
    }

    function rebuild() {
      if (!state.data) return;
      container.innerHTML = '';

      // Optional blocker banner across the top
      var banner = buildBlockerBanner(state.data, state.startTime);
      if (banner) container.appendChild(banner);

      // 3-column row
      var body = document.createElement('div');
      body.style.cssText = 'flex:1;display:flex;gap:' + T.colGapSm + 'px;min-height:0;overflow:hidden;';

      var handlers = {
        onBack: function() {
          OrderSummary.hide();
          var target = state.fromManager ? 'manager-landing' : 'server-landing';
          SceneManager.mountWorking(target, { staff: params.staff });
        },
        onPrint: function() {
          // Print the server's shift summary slip (the "server checkout"
          // template — not a per-check receipt). Backend template per
          // memory: server_checkout.py is still pending, so expect 404
          // until it's added. The frontend call is correct — just swap
          // the template name if the endpoint needs adjustment.
          showToast('Printing slip\u2026', { bg: T.lavender });
          fetch('/api/v1/server/shift/print-checkout', {
            method:  'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              employee_id:   state.data.employeeId,
              employee_name: state.data.employeeName,
            }),
          }).then(function(r) {
            if (r.ok) {
              showToast('Slip printed', { bg: T.greenWarm });
            } else if (r.status === 404) {
              showToast('Print endpoint pending \u2014 server_checkout.py template needed', { bg: T.warning });
            } else {
              showToast('Print failed (' + r.status + ') \u2014 check printer', { bg: T.verm });
            }
          }).catch(function() {
            showToast('Print failed \u2014 check printer connection', { bg: T.verm });
          });
        },
        onFinalize: function() {
          // Full finalize flow: manager PIN → confirm totals → POST → return
          // to server-landing. On any backend error, stay on scene and surface
          // an actionable message — never give false success to the server.
          SceneManager.interrupt('co-manager-pin', {
            onConfirm: function(authData) {
              SceneManager.closeInterrupt('co-manager-pin');
              // Brief defer so the PIN interrupt unmounts before the next one
              // mounts — avoids visual overlap of the two panels.
              setTimeout(function() {
                SceneManager.interrupt('co-finalize-confirm', {
                  takeHome:     state.data.takeHome,
                  cashExpected: state.data.cashExpected,
                  employeeName: state.data.employeeName,
                  onConfirm: function() {
                    SceneManager.closeInterrupt('co-finalize-confirm');
                    // POST the finalize. Endpoint is stubbed — swap URL when
                    // backend lands. `/server/shift/finalize-checkout` matches
                    // the existing shift endpoint naming convention.
                    fetch('/api/v1/server/shift/finalize-checkout', {
                      method:  'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({
                        employee_id:          state.data.employeeId,
                        take_home:            state.data.takeHome,
                        cash_expected:        state.data.cashExpected,
                        manager_pin_verified: true,
                      }),
                    }).then(function(r) {
                      if (r.ok) {
                        showToast('Checkout finalized', { bg: T.green });
                        OrderSummary.hide();
                        SceneManager.mountWorking('server-landing', {
                          staff: {
                            id:   state.data.employeeId,
                            name: state.data.employeeName,
                          },
                        });
                      } else if (r.status === 404) {
                        // Endpoint not yet implemented on the backend.
                        showToast('Finalize endpoint pending — backend work needed', { bg: T.warning });
                      } else {
                        showToast('Finalize failed (' + r.status + ') — try again', { bg: T.verm });
                      }
                    }).catch(function() {
                      showToast('Finalize unavailable — ask your manager', { bg: T.verm });
                    });
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
        onAdjustTip: function(chk) {
          // Opens the single-check tip-adjust transactional from checkout-core.
          // On success, that scene calls onDone → we refresh → the card rebuilds
          // without this row (and collapses when the last unadjusted is cleared).
          SceneManager.openTransactional('co-adjust-single', {
            check: chk,
            onDone: function() { refresh(); },
          });
        },
        onEditTip: function(chk) {
          // Reopens the same single-adjust scene but with the existing tip
          // pre-filled so the server can fix a typo. The scene reads chk.tip
          // as the initial value when present.
          SceneManager.openTransactional('co-adjust-single', {
            check: chk,
            initialTip: chk.tip,
            mode: 'edit',
            onDone: function() { refresh(); },
          });
        },
        onTipFilterChange: function(filter) {
          // User tapped the UNADJ/ADJ filter tab — update state and rebuild.
          state.tipFilter = filter;
          rebuild();
        },
        onTransferChecks: function(checks) {
          // Open the server-picker interrupt. On confirm, POST transfer for
          // each selected check. All-or-nothing is not guaranteed — if a
          // mid-batch transfer fails, we surface the specific failure and
          // leave the successful ones in place.
          SceneManager.interrupt('co-transfer-picker', {
            checks: checks,
            currentEmpId: state.data.employeeId,
            onConfirm: function(destServer) {
              SceneManager.closeInterrupt('co-transfer-picker');

              var transfers = checks.map(function(chk) {
                return fetch('/api/v1/orders/' + (chk.checkId || chk.check_id) + '/transfer', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({
                    to_server_id: destServer.id,
                    from_server_id: state.data.employeeId,
                  }),
                }).then(function(r) {
                  return { chk: chk, ok: r.ok, status: r.status };
                }).catch(function() {
                  return { chk: chk, ok: false, status: 0 };
                });
              });

              Promise.all(transfers).then(function(results) {
                var ok = results.filter(function(r) { return r.ok; });
                var failed = results.filter(function(r) { return !r.ok; });

                if (ok.length > 0 && failed.length === 0) {
                  showToast(
                    'Transferred ' + ok.length + (ok.length === 1 ? ' check' : ' checks') + ' to ' + destServer.name,
                    { bg: T.elec }
                  );
                } else if (ok.length > 0 && failed.length > 0) {
                  showToast(
                    ok.length + ' transferred, ' + failed.length + ' failed',
                    { bg: T.warning }
                  );
                } else {
                  // All failed — likely the endpoint doesn't exist yet.
                  var code = failed[0] && failed[0].status;
                  showToast(
                    code === 404
                      ? 'Transfer endpoint pending \u2014 backend work needed'
                      : 'Transfer failed \u2014 try again',
                    { bg: T.verm }
                  );
                }

                // Clear selection and refetch either way so the UI reflects
                // whatever succeeded.
                state.selectedCheckIds = [];
                refresh();
              });
            },
            onCancel: function() {
              SceneManager.closeInterrupt('co-transfer-picker');
            },
          });
        },
        onCloseCheck: function(checks) {
          // When exactly one check selected, jump into check-overview for that
          // specific check so the server can finish the payment flow. When
          // multiple are selected, we don't have a combined-payment scene yet,
          // so surface a Phase D toast rather than silently picking the first.
          if (checks.length === 1) {
            var chk = checks[0];
            SceneManager.mountWorking('check-overview', {
              checkId:       chk.checkId    || chk.check_id,
              checkLabel:    chk.checkLabel || chk.check_label,
              employeeId:    state.data.employeeId,
              employeeName:  state.data.employeeName,
              returnLanding: state.fromManager ? 'manager-landing' : 'server-landing',
            });
          } else {
            showToast('Combined payment for ' + checks.length + ' checks — Phase D', { bg: T.gold });
          }
        },
        onPrintCheck: function(checks) {
          // Print is a routine action — no manager gate. Fires one request
          // per selected check. Backend endpoint TBD; 404 handled gracefully.
          var label = checks.length > 1 ? checks.length + ' checks' : (checks[0].checkLabel || checks[0].checkId);
          showToast('Printing ' + label + '\u2026', { bg: T.greenWarm });

          var prints = checks.map(function(chk) {
            return fetch('/api/v1/checks/' + (chk.checkId || chk.check_id) + '/print', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ kind: 'guest' }),
            }).then(function(r) {
              return { chk: chk, ok: r.ok, status: r.status };
            }).catch(function() {
              return { chk: chk, ok: false, status: 0 };
            });
          });

          Promise.all(prints).then(function(results) {
            var ok = results.filter(function(r) { return r.ok; });
            var failed = results.filter(function(r) { return !r.ok; });

            if (ok.length > 0 && failed.length === 0) {
              showToast('Printed ' + ok.length + (ok.length === 1 ? ' check' : ' checks'), { bg: T.greenWarm });
            } else if (ok.length > 0 && failed.length > 0) {
              showToast(ok.length + ' printed, ' + failed.length + ' failed', { bg: T.warning });
            } else {
              var code = failed[0] && failed[0].status;
              showToast(
                code === 404
                  ? 'Print endpoint pending \u2014 backend work needed'
                  : 'Print failed \u2014 check printer',
                { bg: T.verm }
              );
            }
          });
        },
        onDiscountCheck: function(checks) {
          // Discount requires manager authorization → PIN first, then picker.
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
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                          type: discount.type,
                          value: discount.value,
                          manager_pin_verified: true,
                        }),
                      }).then(function(r) {
                        return { chk: chk, ok: r.ok, status: r.status };
                      }).catch(function() {
                        return { chk: chk, ok: false, status: 0 };
                      });
                    });

                    Promise.all(discounts).then(function(results) {
                      var ok = results.filter(function(r) { return r.ok; });
                      var failed = results.filter(function(r) { return !r.ok; });
                      var discLabel = discount.type === 'comp'
                        ? 'Comp'
                        : discount.type === 'percent'
                          ? discount.value + '% off'
                          : '$' + discount.value + ' off';

                      if (ok.length > 0 && failed.length === 0) {
                        showToast(discLabel + ' applied to ' + ok.length + (ok.length === 1 ? ' check' : ' checks'), { bg: T.elec });
                      } else if (ok.length > 0 && failed.length > 0) {
                        showToast(ok.length + ' discounted, ' + failed.length + ' failed', { bg: T.warning });
                      } else {
                        var code = failed[0] && failed[0].status;
                        showToast(
                          code === 404
                            ? 'Discount endpoint pending \u2014 backend work needed'
                            : 'Discount failed \u2014 try again',
                          { bg: T.verm }
                        );
                      }

                      state.selectedCheckIds = [];
                      refresh();
                    });
                  },
                  onCancel: function() {
                    SceneManager.closeInterrupt('co-discount-picker');
                  },
                });
              }, 80);
            },
            onCancel: function() {
              SceneManager.closeInterrupt('co-manager-pin');
            },
          });
        },
        onVoidCheck: function(checks) {
          // Void is destructive + requires manager authorization → PIN first,
          // then a reason-required confirm. Fires one void per selected check.
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
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                          reason: reason,
                          manager_pin_verified: true,
                        }),
                      }).then(function(r) {
                        return { chk: chk, ok: r.ok, status: r.status };
                      }).catch(function() {
                        return { chk: chk, ok: false, status: 0 };
                      });
                    });

                    Promise.all(voids).then(function(results) {
                      var ok = results.filter(function(r) { return r.ok; });
                      var failed = results.filter(function(r) { return !r.ok; });

                      if (ok.length > 0 && failed.length === 0) {
                        showToast('Voided ' + ok.length + (ok.length === 1 ? ' check' : ' checks'), { bg: T.verm });
                      } else if (ok.length > 0 && failed.length > 0) {
                        showToast(ok.length + ' voided, ' + failed.length + ' failed', { bg: T.warning });
                      } else {
                        var code = failed[0] && failed[0].status;
                        showToast(
                          code === 404
                            ? 'Void endpoint pending \u2014 backend work needed'
                            : 'Void failed \u2014 try again',
                          { bg: T.verm }
                        );
                      }

                      state.selectedCheckIds = [];
                      refresh();
                    });
                  },
                  onCancel: function() {
                    SceneManager.closeInterrupt('co-void-confirm');
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
          // Smooth-scroll middle column to the target blocker card and flash
          // a brief highlight. Cards are tagged with data-card-key.
          var target = container.querySelector('[data-card-key="' + cardKey + '"]');
          if (!target) return;
          target.scrollIntoView({ behavior: 'smooth', block: 'start' });
          // Flash effect — quick outline pulse.
          var originalShadow = target.style.boxShadow;
          target.style.transition = 'box-shadow 0.3s ease';
          target.style.boxShadow = '0 0 0 3px ' + hexToRgba(T.text, 0.35);
          setTimeout(function() {
            target.style.boxShadow = originalShadow || '';
          }, 600);
        },
        onSelectCheck: function(chk) {
          // Toggle this check's id in the selection array. Tap to add, tap
          // again to remove. No cap on how many can be selected.
          var id = chk.checkId || chk.check_id;
          var idx = state.selectedCheckIds.indexOf(id);
          if (idx !== -1) {
            state.selectedCheckIds.splice(idx, 1);
          } else {
            state.selectedCheckIds.push(id);
          }
          rebuild();
        },
        onDismissPreview: function() {
          state.selectedCheckIds = [];
          rebuild();
        },
        onPrintSlip: function() {
          if (handlers.onPrint) handlers.onPrint();
        },
        onAdjustRates: function() {
          SceneManager.interrupt('co-manager-pin', {
            onConfirm: function() {
              SceneManager.closeInterrupt('co-manager-pin');
              showToast('Tipout rate adjustment — pending backend', { bg: T.warning });
            },
            onCancel: function() {
              SceneManager.closeInterrupt('co-manager-pin');
            },
          });
        },
        onTabChange: function(tab) {
          state.activeTab = tab;
          rebuild();
        },
        onReprintCheck: function(chk) {
          showToast('Reprinting ' + (chk.checkLabel || chk.checkId) + '…', { bg: T.elec });
        },
        onReopenCheck: function(chk) {
          SceneManager.interrupt('co-manager-pin', {
            onConfirm: function() {
              SceneManager.closeInterrupt('co-manager-pin');
              showToast('Reopening ' + (chk.checkLabel || chk.checkId) + ' — backend pending', { bg: T.warning });
              refresh();
            },
            onCancel: function() {
              SceneManager.closeInterrupt('co-manager-pin');
            },
          });
        },
      };

      // Resolve the active tip filter. Defaults to 'unadjusted' when there
      // are unadjusted tips (blocker case), 'adjusted' when all done. Scene
      // state overrides the default once the user explicitly taps a tab.
      var resolvedFilter = state.tipFilter;
      if (!resolvedFilter) {
        resolvedFilter = state.data.unadjustedChecks.length > 0 ? 'unadjusted' : 'adjusted';
      }

      // Stale-cleanup: drop any IDs that no longer correspond to an open
      // check (e.g. server paid one elsewhere, or refresh returned fewer).
      state.selectedCheckIds = state.selectedCheckIds.filter(function(id) {
        return state.data.openChecks.some(function(c) { return c.checkId === id; });
      });

      // Resolve the array of selected check objects in display order.
      var selectedChecks = state.selectedCheckIds.map(function(id) {
        return state.data.openChecks.find(function(c) { return c.checkId === id; });
      }).filter(Boolean);

      body.appendChild(buildLeftCol(state.data, handlers));
      body.appendChild(buildMiddleCol(state.data, handlers, resolvedFilter, state.selectedCheckIds, state.activeTab));
      body.appendChild(buildActionsCol(state.data, handlers, state.startTime));

      container.appendChild(body);
    }

    refresh();
    var poll = setInterval(refresh, 15000);

    return function cleanup() {
      state.el = null;
      clearInterval(poll);
      if (window._header && window._header.setBackHandler) {
        window._header.setBackHandler(null);
      }
    };
  },
});