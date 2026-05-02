// ═══════════════════════════════════════════════════
//  KINDpos Terminal — Close Day · Checks Viewer (Vz2.0)
//
//  Transactional scene opened from close-day's ALL CHECKS pill. Focused
//  on the day's OPEN checks — the blockers preventing lock. Shares the
//  3-col frame with close-day / server-checkout:
//
//    HEADER  breadcrumb + day counts
//    LEFT    260w   receipt preview (same renderer as close-day)
//    MIDDLE  flex   Active Checks — large tappable rows
//    RIGHT   240w   Actions — SELECT ALL, TRANSFER/PRINT/VOID, CLOSE CHECK
//
//  Every action routes through the same backend endpoints close-day uses.
//  After any mutation we refetch + rebuild. CLOSE CHECK hops to
//  check-overview with returnLanding set back to manager-landing so the
//  server can complete payment and land cleanly.
//
//  Self-contained: helpers are duplicated from close-day rather than
//  shared to keep this scene decoupled. If the duplication grows beyond
//  helpers + renderCheckPreview, extract a shared module.
// ═══════════════════════════════════════════════════

import { defineScene, SceneManager }  from '../scene-manager.js';
import { T }                          from '../../common/tokens.js';
import {
  buildPillButton,
  buildStaticCard,
  hexToRgba,
}                                      from '../theme-manager.js';
import { showToast }                   from '../components.js';
import { fetchWithTimeout }            from '../net.js';

// ─────────────────────────────────────────────────
//  LAYOUT CONSTANTS — matches close-day-checks-viewer.svg
// ─────────────────────────────────────────────────

var LEFT_W   = 260;
var RIGHT_W  = 240;
var PAD      = 10;
var PAD_TOP  = 8;

// ─────────────────────────────────────────────────
//  HELPERS — duplicated from close-day for independence
// ─────────────────────────────────────────────────

function fmt(n) {
  n = n || 0;
  var abs = Math.abs(n).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return (n < 0 ? '\u2212$' : '$') + abs;
}

function checkNumDisplay(chk) {
  var raw = String(chk.checkLabel || chk.checkId || '');
  if (!raw) return '';
  if (/^[#A-Za-z]/.test(raw)) return raw;
  return '#' + raw;
}

// Synthesize a consistent, readable check label from order_id. Same
// helper lives in close-day.js — if you change one, change both (or
// extract to a shared module). Extracts the last digit run so prefixed
// ids like "order_27" give "C-027" not "C-ORD".
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

function formatTime(t) {
  if (!t) return '';
  if (typeof t !== 'string' || (t.indexOf('T') === -1 && t.indexOf(':') <= 2)) return t;
  var d = new Date(t);
  if (isNaN(d.getTime())) return t;
  var h = d.getHours();
  var m = d.getMinutes();
  var ampm = h >= 12 ? 'pm' : 'am';
  h = h % 12 || 12;
  return h + ':' + (m < 10 ? '0' : '') + m + ampm;
}

// How long a check has been open, in minutes. Parses the raw ISO stamp
// and returns the delta from now. null if unparseable.
function minutesOpen(rawCreatedAt) {
  if (!rawCreatedAt) return null;
  var d = new Date(rawCreatedAt);
  if (isNaN(d.getTime())) return null;
  return Math.max(0, Math.floor((Date.now() - d.getTime()) / 60000));
}

// Age color ramp — <30m normal, 30-60m warning, >60m critical.
function ageColor(minutes) {
  if (minutes == null) return T.text;
  if (minutes >= 60) return T.verm;
  if (minutes >= 30) return T.warning;
  return T.text;
}

// Per-server color palette — matches manager-landing/SRV_PALETTE exactly
// so Dorothy looks like Dorothy across every screen. Deterministic hash
// from server_id to a palette index; falls back to T.elec if no id.
var SRV_PALETTE = [
  '#38bdf8', // sky
  '#a78bfa', // violet
  '#fb923c', // peach
  '#34d399', // emerald
  '#facc15', // yellow
  '#f472b6', // pink
  '#e879f9', // fuchsia
  '#4ade80', // green
];
function serverColor(server_id) {
  if (!server_id) return T.elec;
  var s = String(server_id);
  var hash = 0;
  for (var i = 0; i < s.length; i++) {
    hash = ((hash << 5) - hash + s.charCodeAt(i)) | 0;
  }
  return SRV_PALETTE[Math.abs(hash) % SRV_PALETTE.length];
}

// ─────────────────────────────────────────────────
//  DATA FETCH — merges d.checks + /api/v1/orders same as close-day
// ─────────────────────────────────────────────────

function fetchChecksState() {
  return Promise.all([
    fetchWithTimeout('/api/v1/orders/day-summary', {}, 8000).then(function(r) { if (!r.ok) throw new Error(r.status); return r.json(); }).catch(function() { return {}; }),
    fetchWithTimeout('/api/v1/orders', {}, 8000).then(function(r) { if (!r.ok) throw new Error(r.status); return r.json(); }).catch(function() { return []; }),
    fetchWithTimeout('/api/v1/config/store', {}, 8000).then(function(r) { if (!r.ok) throw new Error(r.status); return r.json(); }).catch(function() { return {}; }),
  ]).then(function(results) {
    var d         = results[0] || {};
    var rawOrders = Array.isArray(results[1]) ? results[1] : [];
    var store     = results[2] || {};

    var rawById = {};
    rawOrders.forEach(function(o) { rawById[o.order_id] = o; });
    var summaryById = {};
    (d.checks || []).forEach(function(c) {
      var id = c.checkId || c.check_id || c.order_id;
      if (id) summaryById[id] = c;
    });
    var allIds = {};
    rawOrders.forEach(function(o) { allIds[o.order_id] = true; });
    (d.checks || []).forEach(function(c) {
      var id = c.checkId || c.check_id || c.order_id;
      if (id) allIds[id] = true;
    });

    var checks = Object.keys(allIds).map(function(id) {
      var raw = rawById[id] || {};
      var sum = summaryById[id] || {};
      var status = sum.status || (raw.status === 'paid' ? 'closed' : raw.status) || 'unknown';
      var method = sum.method || raw.payment_method || null;
      var tip    = sum.tip != null ? sum.tip : raw.tip_amount;
      var label  = synthCheckLabel(id);

      return {
        checkId:       id,
        checkLabel:    label,
        tableLabel:    raw.table_label || raw.customer_name || sum.tableLabel || sum.table_label || '',
        status:        status,
        method:        method,
        amount:        (sum.amount != null) ? sum.amount : (raw.total_amount || raw.total || 0),
        tip:           tip,
        adjusted:      (sum.adjusted != null) ? sum.adjusted : false,
        server_id:     raw.server_id   || sum.server_id   || '',
        server_name:   raw.server_name || sum.server_name || '',
        guests:        raw.guest_count || raw.seat_count || raw.covers || sum.guests || sum.guest_count || 0,
        time:          formatTime(raw.created_at || sum.time || ''),
        rawCreatedAt:  raw.created_at || '',
        itemCount:     (raw.items || []).length,
      };
    });

    var openChecks   = checks.filter(function(c) { return c.status === 'open'; });
    var closedChecks = checks.filter(function(c) { return c.status === 'closed'; });

    return {
      openChecks:     openChecks,
      closedChecks:   closedChecks,
      totalCount:     checks.length,
      allOrders:      rawOrders,
      restaurantName: (store.info && store.info.restaurant_name) || store.name || 'KINDpos',
    };
  });
}

// ─────────────────────────────────────────────────
//  HEADER — breadcrumb + day counts
// ─────────────────────────────────────────────────

function buildHeader(data) { /* audit: SM2 remnant — COMPLEX, manual migration required */
  var wrap = document.createElement('div');
  wrap.style.cssText = [
    'flex-shrink:0;display:flex;align-items:center;gap:14px;',
    'padding:10px 18px;box-sizing:border-box;height:56px;',
    'background:' + T.card + ';border-left:4px solid ' + T.lavender + ';',
    'border-radius:10px;',
  ].join('');

  // Crumb + title stack
  var crumbWrap = document.createElement('div');
  crumbWrap.style.cssText = 'flex:1;display:flex;flex-direction:column;gap:1px;min-width:0;';

  var crumb = document.createElement('div');
  crumb.style.cssText = 'font-family:' + T.fb + ';font-size:10px;color:' + T.text + ';opacity:0.4;letter-spacing:1.2px;' + ";font-weight:" + T.fwBold + ";";
  crumb.textContent = 'CLOSE DAY  /';
  crumbWrap.appendChild(crumb);

  var title = document.createElement('div');
  title.style.cssText = 'font-family:' + T.fh + ';font-size:16px;font-weight:700;color:' + T.text + ';letter-spacing:1.5px;';
  title.textContent = 'OPEN CHECKS';
  crumbWrap.appendChild(title);

  wrap.appendChild(crumbWrap);

  // Right side: counts
  var countsWrap = document.createElement('div');
  countsWrap.style.cssText = 'flex-shrink:0;display:flex;flex-direction:column;gap:1px;text-align:right;';

  var openCount = document.createElement('div');
  openCount.style.cssText = 'font-family:' + T.fb + ';font-size:12px;font-weight:700;color:' + T.verm + ';letter-spacing:0.5px;';
  openCount.textContent = data.openChecks.length + ' OPEN';
  countsWrap.appendChild(openCount);

  var totalLine = document.createElement('div');
  totalLine.style.cssText = 'font-family:' + T.fb + ';font-size:11px;color:' + T.text + ';opacity:0.35;letter-spacing:0.5px;' + ";font-weight:" + T.fwBold + ";";
  totalLine.textContent = data.closedChecks.length + ' closed  \u2022  ' + data.totalCount + ' total today';
  countsWrap.appendChild(totalLine);

  wrap.appendChild(countsWrap);
  return wrap;
}

// ─────────────────────────────────────────────────
//  LEFT — Receipt Preview (identical render to close-day)
// ─────────────────────────────────────────────────

function buildReceiptCol(data, selectedChecks, allOrders, handlers) {
  selectedChecks = selectedChecks || [];
  var showing = selectedChecks.length > 0;

  var col = document.createElement('div');
  col.style.cssText = [
    'flex-shrink:0;width:' + LEFT_W + 'px;',
    'background:' + T.card + ';border-left:4px solid ' + T.elec + ';',
    'border-radius:10px;padding:14px 16px;box-sizing:border-box;',
    'display:flex;flex-direction:column;gap:10px;',
  ].join('');

  var hdr = document.createElement('div');
  hdr.style.cssText = 'display:flex;justify-content:space-between;align-items:baseline;flex-shrink:0;gap:6px;';
  var hdrTitle = document.createElement('span');
  hdrTitle.style.cssText = 'font-family:' + T.fh + ';font-size:12px;font-weight:700;color:' + T.text + ';letter-spacing:1.8px;';
  hdrTitle.textContent = showing ? 'CHECK PREVIEW' : 'RECEIPT PREVIEW';
  hdr.appendChild(hdrTitle);

  if (showing) {
    var dismiss = document.createElement('span');
    dismiss.style.cssText = [
      'font-family:' + T.fb + ';font-size:18px;color:' + T.text + ';opacity:0.55;',
      'cursor:pointer;user-select:none;-webkit-user-select:none;',
      'pointer-events:auto;touch-action:manipulation;',
      'padding:0 6px;line-height:1;',
    ].join('') + ";font-weight:" + T.fwBold + ";";
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
    showing ? '' : 'border:1px dashed ' + hexToRgba(T.border, 0.6) + ';',
  ].join('') + ";font-weight:" + T.fwBold + ";";

  if (!showing) {
    paper.appendChild(buildReceiptEmptyState());
  } else {
    renderCheckPreview(paper, selectedChecks, allOrders);
  }
  col.appendChild(paper);

  // Note: no action stack here — actions live in the right column for
  // this scene, which is the whole point of the viewer.
  return col;
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
  hint.style.cssText = 'font-family:' + T.fb + ';font-size:11px;color:' + T.text + ';text-align:center;line-height:1.5;' + ";font-weight:" + T.fwBold + ";";
  hint.innerHTML = 'tap a check row<br/>to pin it here';

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
    // Server color from fullOrder first (authoritative), fall back to chk
    var srvCol = serverColor((fullOrder && fullOrder.server_id) || chk.server_id);

    if (isMulti) {
      var sub = document.createElement('div');
      sub.style.cssText = 'font-family:' + T.fh + ';font-size:11px;color:' + srvCol + ';letter-spacing:0.5px;margin-top:' + (idx === 0 ? '0' : '8px') + ';margin-bottom:2px;' + ";font-weight:" + T.fwBold + ";";
      sub.textContent = checkNumDisplay(chk) + (fullOrder && fullOrder.server_name ? ' \u00B7 ' + fullOrder.server_name.split(' ')[0].toUpperCase() : '');
      paper.appendChild(sub);
    } else if (fullOrder && fullOrder.server_name) {
      var srvLbl = document.createElement('div');
      srvLbl.style.cssText = 'font-family:' + T.fb + ';font-size:11px;color:' + srvCol + ';letter-spacing:0.5px;margin-bottom:4px;' + ";font-weight:" + T.fwBold + ";";
      srvLbl.textContent = fullOrder.server_name.toUpperCase();
      paper.appendChild(srvLbl);
    }

    if (!isMulti) {
      var metaRow = document.createElement('div');
      metaRow.style.cssText = 'display:flex;justify-content:space-between;font-family:' + T.fb + ';font-size:11px;color:' + T.text + ';opacity:0.55;margin-bottom:4px;' + ";font-weight:" + T.fwBold + ";";
      var mL = document.createElement('span');
      mL.textContent = chk.guests ? (chk.guests + ' guest' + (chk.guests > 1 ? 's' : '')) : '\u00A0';
      var mR = document.createElement('span');
      mR.textContent = chk.time ? ('opened ' + chk.time) : '';
      metaRow.appendChild(mL);
      metaRow.appendChild(mR);
      paper.appendChild(metaRow);
    }

    var items = (fullOrder && fullOrder.items) || [];
    if (items.length === 0) {
      var empty = document.createElement('div');
      empty.style.cssText = 'font-family:' + T.fb + ';font-size:11px;color:' + T.text + ';opacity:0.5;font-style:italic;padding:6px 0;' + ";font-weight:" + T.fwBold + ";";
      empty.textContent = isMulti ? 'no items' : 'no items on this check';
      paper.appendChild(empty);
    } else {
      var showCap = isMulti ? 3 : items.length;
      items.slice(0, showCap).forEach(function(item) {
        var row = document.createElement('div');
        row.style.cssText = [
          'display:flex;justify-content:space-between;gap:8px;',
          'padding:3px 0;border-bottom:1px solid ' + hexToRgba(T.text, 0.06) + ';',
        ].join('');
        var nm = document.createElement('span');
        nm.style.cssText = 'font-family:' + T.fb + ';font-size:11px;color:' + T.text + ';' + ";font-weight:" + T.fwBold + ";";
        nm.textContent = (item.qty && item.qty > 1 ? item.qty + '\u00D7 ' : '') + (item.name || item.display_name || 'Item');
        var pr = document.createElement('span');
        pr.style.cssText = 'font-family:' + T.fb + ';font-size:11px;color:' + T.gold + ';flex-shrink:0;' + ";font-weight:" + T.fwBold + ";";
        pr.textContent = fmt((item.price || item.amount || 0) * (item.qty || 1));
        row.appendChild(nm);
        row.appendChild(pr);
        paper.appendChild(row);
      });
      if (items.length > showCap) {
        var more = document.createElement('div');
        more.style.cssText = 'font-family:' + T.fb + ';font-size:10px;color:' + T.text + ';opacity:0.55;padding-top:2px;' + ";font-weight:" + T.fwBold + ";";
        more.textContent = '+ ' + (items.length - showCap) + ' more';
        paper.appendChild(more);
      }
    }

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

    if (!isMulti) {
      var stamp = document.createElement('div');
      var stampColor = chk.status === 'open' ? T.verm : (chk.status === 'closed' ? T.greenWarm : T.warning);
      stamp.style.cssText = 'margin-top:10px;padding-top:6px;font-family:' + T.fb + ';font-size:10px;color:' + stampColor + ';letter-spacing:3px;text-align:center;opacity:0.7;' + ";font-weight:" + T.fwBold + ";";
      stamp.textContent = '\u2014  ' + (chk.status || 'open').toUpperCase() + '  \u2014';
      paper.appendChild(stamp);
    }
  });
}

// ─────────────────────────────────────────────────
//  MIDDLE — Active Checks list (flex:1, fills remaining width)
// ─────────────────────────────────────────────────

function buildChecksListCol(data, handlers, sceneState) {
  var col = document.createElement('div');
  col.style.cssText = [
    'flex:1;min-width:0;',
    'background:' + T.card + ';border-left:4px solid ' + T.verm + ';',
    'border-radius:10px;padding:14px 16px;box-sizing:border-box;',
    'display:flex;flex-direction:column;gap:10px;',
  ].join('');

  // Header row
  var hdr = document.createElement('div');
  hdr.style.cssText = 'flex-shrink:0;display:flex;justify-content:space-between;align-items:baseline;';

  var title = document.createElement('div');
  title.style.cssText = 'font-family:' + T.fh + ';font-size:13px;font-weight:700;color:' + T.text + ';letter-spacing:1.8px;';
  title.textContent = 'ACTIVE CHECKS';
  hdr.appendChild(title);

  var selCount = document.createElement('div');
  selCount.style.cssText = 'font-family:' + T.fb + ';font-size:11px;color:' + T.elec + ';letter-spacing:0.5px;' + ";font-weight:" + T.fwBold + ";";
  selCount.textContent = sceneState.selectedCheckIds.length + ' of ' + data.openChecks.length + ' selected';
  hdr.appendChild(selCount);

  col.appendChild(hdr);

  // Scrollable rows
  var list = document.createElement('div');
  list.style.cssText = 'flex:1;overflow-y:auto;touch-action:pan-y;overscroll-behavior:contain;display:flex;flex-direction:column;gap:8px;padding-right:2px;';

  if (data.openChecks.length === 0) {
    list.appendChild(buildEmptyState());
  } else {
    data.openChecks.forEach(function(chk) {
      list.appendChild(buildCheckRow(chk, handlers, sceneState));
    });
  }
  col.appendChild(list);

  // Bottom hint
  var hint = document.createElement('div');
  hint.style.cssText = 'flex-shrink:0;text-align:center;font-family:' + T.fb + ';font-size:11px;color:' + T.text + ';opacity:0.3;font-style:italic;' + ";font-weight:" + T.fwBold + ";";
  hint.textContent = 'tap a check to add to preview  \u2022  actions operate on selection';
  col.appendChild(hint);

  return col;
}

function buildEmptyState() {
  var wrap = document.createElement('div');
  wrap.style.cssText = 'flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:8px;opacity:0.5;';

  var title = document.createElement('div');
  title.style.cssText = 'font-family:' + T.fh + ';font-size:16px;font-weight:700;color:' + T.greenWarm + ';letter-spacing:1.5px;';
  title.textContent = 'ALL CLEAR';

  var hint = document.createElement('div');
  hint.style.cssText = 'font-family:' + T.fb + ';font-size:12px;color:' + T.text + ';' + ";font-weight:" + T.fwBold + ";";
  hint.textContent = 'no open checks remaining \u2014 ready to lock';

  wrap.appendChild(title);
  wrap.appendChild(hint);
  return wrap;
}

function buildCheckRow(chk, handlers, sceneState) {
  var selected = sceneState.selectedCheckIds.indexOf(chk.checkId) !== -1;
  var minutes  = minutesOpen(chk.rawCreatedAt);
  var srvCol   = serverColor(chk.server_id);

  var card = buildStaticCard({ accent: selected ? T.elec : srvCol });
  card._staticCardTappableAllowed = true;
  card.addEventListener('pointerup', function() { if (handlers.onToggleCheck) handlers.onToggleCheck(chk); });
  card.style.flexShrink = '0';
  card.style.display = 'flex';
  card.style.alignItems = 'center';
  card.style.gap = '12px';
  card.style.padding = '12px 14px';
  card.style.minHeight = '88px';

  // Selection checkbox — stays T.elec (selection is a UI state, not a server state)
  var check = document.createElement('div');
  check.style.cssText = [
    'flex-shrink:0;width:26px;height:26px;border-radius:50%;',
    'display:flex;align-items:center;justify-content:center;',
    'font-family:' + T.fh + ';font-size:14px;font-weight:700;',
    selected
      ? 'background:' + T.elec + ';color:' + T.well + ';'
      : 'background:transparent;border:1.5px solid ' + T.border + ';color:transparent;',
  ].join('');
  check.textContent = selected ? '\u2713' : '';
  card.appendChild(check);

  // Info stack (flex:1)
  var info = document.createElement('div');
  info.style.cssText = 'flex:1;display:flex;flex-direction:column;gap:2px;min-width:0;';

  // Top: CHECK # + table
  var top = document.createElement('div');
  top.style.cssText = 'display:flex;align-items:baseline;gap:8px;';

  var ckNo = document.createElement('span');
  ckNo.style.cssText = 'font-family:' + T.fh + ';font-size:16px;font-weight:700;color:' + T.text + ';';
  ckNo.textContent = checkNumDisplay(chk);
  top.appendChild(ckNo);

  if (chk.tableLabel) {
    var tbl = document.createElement('span');
    tbl.style.cssText = 'font-family:' + T.fb + ';font-size:13px;color:' + T.text + ';opacity:0.6;' + ";font-weight:" + T.fwBold + ";";
    tbl.textContent = '\u00B7  ' + chk.tableLabel;
    top.appendChild(tbl);
  }
  info.appendChild(top);

  // Server name — colored to match the accent
  if (chk.server_name) {
    var srv = document.createElement('div');
    srv.style.cssText = 'font-family:' + T.fb + ';font-size:12px;color:' + srvCol + ';font-weight:700;';
    srv.textContent = chk.server_name;
    info.appendChild(srv);
  }

  // Meta: guests/items + age open
  var meta = document.createElement('div');
  meta.style.cssText = 'display:flex;align-items:baseline;gap:8px;font-family:' + T.fb + ';font-size:11px;' + ";font-weight:" + T.fwBold + ";";

  var metaParts = [];
  if (chk.guests)    metaParts.push(chk.guests + ' guest' + (chk.guests > 1 ? 's' : ''));
  if (chk.itemCount) metaParts.push(chk.itemCount + ' item' + (chk.itemCount > 1 ? 's' : ''));

  var metaPrimary = document.createElement('span');
  metaPrimary.style.cssText = 'color:' + T.text + ';opacity:0.55;';
  metaPrimary.textContent = metaParts.join('  \u2022  ');
  meta.appendChild(metaPrimary);

  if (minutes != null) {
    var age = document.createElement('span');
    var col = ageColor(minutes);
    var warn = minutes >= 30;
    age.style.cssText = 'color:' + col + ';opacity:' + (warn ? 1 : 0.55) + ';font-weight:' + (warn ? 700 : 400) + ';';
    age.textContent = '\u00B7  ' + minutes + 'm open';
    meta.appendChild(age);
  }

  info.appendChild(meta);
  card.appendChild(info);

  // Amount — gold, large
  var amt = document.createElement('div');
  amt.style.cssText = 'flex-shrink:0;font-family:' + T.fh + ';font-size:24px;font-weight:700;color:' + T.gold + ';';
  amt.textContent = fmt(chk.amount || 0);
  card.appendChild(amt);

  return card;
}

// ─────────────────────────────────────────────────
//  RIGHT — Actions column
//  SELECT ALL → counter → action stack → CLOSE CHECK primary (bottom)
// ─────────────────────────────────────────────────

function buildActionsCol(data, handlers, sceneState) {
  var selectedChecks = data.openChecks.filter(function(c) {
    return sceneState.selectedCheckIds.indexOf(c.checkId) !== -1;
  });
  var hasSelection    = selectedChecks.length > 0;
  var singleSelection = selectedChecks.length === 1;
  var allSelected     = data.openChecks.length > 0 && sceneState.selectedCheckIds.length === data.openChecks.length;

  var col = document.createElement('div');
  col.style.cssText = [
    'flex-shrink:0;width:' + RIGHT_W + 'px;',
    'background:' + T.card + ';border-left:4px solid ' + T.lavender + ';',
    'border-radius:10px;padding:14px 16px;box-sizing:border-box;',
    'display:flex;flex-direction:column;gap:10px;',
  ].join('');

  var label = document.createElement('div');
  label.style.cssText = 'font-family:' + T.fh + ';font-size:13px;font-weight:700;color:' + T.text + ';letter-spacing:1.8px;flex-shrink:0;';
  label.textContent = 'ACTIONS';
  col.appendChild(label);

  // BACK pill (app header also has a back, but having one here is clearer)
  var backBtn = buildPillButton({
    label:  '\u2039 BACK',
    variant: 'ghost',
    shape: 'chamfer',
    onClick: function() { if (handlers.onBack) handlers.onBack(); },
  });
  backBtn.style.cssText += 'width:100%;box-sizing:border-box;padding:10px 14px;font-size:12px;';
  col.appendChild(backBtn);

  // SELECT ALL / DESELECT ALL
  var selectAllBtn = buildPillButton({
    label:  (allSelected ? 'DESELECT ALL' : 'SELECT ALL') + '  \u00B7  ' + data.openChecks.length,
    variant: 'ghost',
    shape: 'chamfer',
    onClick: function() { if (handlers.onToggleAll) handlers.onToggleAll(); },
  });
  selectAllBtn.style.cssText += 'width:100%;box-sizing:border-box;padding:10px 14px;font-size:11px;';
  if (data.openChecks.length === 0) selectAllBtn.style.cssText += 'opacity:0.4;pointer-events:none;';
  col.appendChild(selectAllBtn);

  // Selection counter well
  var counter = document.createElement('div');
  counter.style.cssText = [
    'padding:9px 14px;box-sizing:border-box;',
    'background:' + T.well + ';border-radius:8px;flex-shrink:0;',
    'font-family:' + T.fb + ';font-size:13px;color:' + (hasSelection ? T.elec : T.text) + ';',
    'letter-spacing:0.5px;text-align:center;',
    hasSelection ? '' : 'opacity:0.4;',
  ].join('') + ";font-weight:" + T.fwBold + ";";
  counter.textContent = sceneState.selectedCheckIds.length + ' of ' + data.openChecks.length + ' selected';
  col.appendChild(counter);

  // Group label
  var groupLabel = document.createElement('div');
  groupLabel.style.cssText = 'font-family:' + T.fb + ';font-size:10px;color:' + T.text + ';opacity:0.5;letter-spacing:1.2px;margin-top:6px;flex-shrink:0;' + ";font-weight:" + T.fwBold + ";";
  groupLabel.textContent = 'ACT ON SELECTION';
  col.appendChild(groupLabel);

  // Action stack
  var actStack = document.createElement('div');
  actStack.style.cssText = 'display:flex;flex-direction:column;gap:6px;flex-shrink:0;';

  var transferLabel = selectedChecks.length > 1 ? 'Transfer  \u00B7  ' + selectedChecks.length : 'Transfer';
  var transferBtn = buildPillButton({
    label:   transferLabel + '  \u203A',
    color:   T.elec,
    darkBg:  T.elecDk,
    shape:   'chamfer',
    onClick: function() { if (handlers.onTransferChecks) handlers.onTransferChecks(selectedChecks); },
  });
  transferBtn.style.cssText += 'width:100%;box-sizing:border-box;padding:10px 14px;font-size:12px;';
  if (!hasSelection) transferBtn.style.cssText += 'opacity:0.4;pointer-events:none;';
  actStack.appendChild(transferBtn);

  var printBtn = buildPillButton({
    label:  'Print Receipt  \u203A',
    color:  T.greenWarm,
    darkBg: T.greenWarmDk,
    shape:  'chamfer',
    onClick: function() { if (handlers.onPrintCheck) handlers.onPrintCheck(selectedChecks); },
  });
  printBtn.style.cssText += 'width:100%;box-sizing:border-box;padding:10px 14px;font-size:12px;';
  if (!hasSelection) printBtn.style.cssText += 'opacity:0.4;pointer-events:none;';
  actStack.appendChild(printBtn);

  var voidBtn = buildPillButton({
    label:  'Void  \u00B7  MGR PIN  \u203A',
    color:  T.verm,
    darkBg: T.vermDk,
    shape:  'chamfer',
    onClick: function() { if (handlers.onVoidCheck) handlers.onVoidCheck(selectedChecks); },
  });
  voidBtn.style.cssText += 'width:100%;box-sizing:border-box;padding:10px 14px;font-size:12px;';
  if (!hasSelection) voidBtn.style.cssText += 'opacity:0.4;pointer-events:none;';
  actStack.appendChild(voidBtn);

  col.appendChild(actStack);

  // Spacer pushes primary CTA to bottom
  var spacer = document.createElement('div');
  spacer.style.cssText = 'flex:1;';
  col.appendChild(spacer);

  // Primary CTA — CLOSE CHECK (only active on single-select)
  var primaryEnabled = singleSelection;
  var primaryBtn = buildPillButton({
    label:  'Close Check  \u203A',
    color:  T.greenWarm,
    darkBg: T.greenWarmDk,
    shape:  'chamfer',
    onClick: function() {
      if (!primaryEnabled) return;
      if (handlers.onCloseCheck) handlers.onCloseCheck(selectedChecks);
    },
  });
  primaryBtn.style.cssText += 'width:100%;box-sizing:border-box;padding:14px;font-size:15px;font-weight:700;flex-shrink:0;';
  if (!primaryEnabled) primaryBtn.style.cssText += 'opacity:0.4;pointer-events:none;';
  col.appendChild(primaryBtn);

  var subtitle = document.createElement('div');
  subtitle.style.cssText = 'font-family:' + T.fb + ';font-size:10px;color:' + T.text + ';opacity:0.55;text-align:center;flex-shrink:0;' + ";font-weight:" + T.fwBold + ";";
  if (singleSelection) {
    subtitle.textContent = 'opens payment  \u00B7  ' + checkNumDisplay(selectedChecks[0]);
  } else if (selectedChecks.length > 1) {
    subtitle.textContent = 'select just one to pay';
  } else {
    subtitle.textContent = 'select a check to pay';
  }
  col.appendChild(subtitle);

  return col;
}

// ═══════════════════════════════════════════════════
//  SCENE DEFINITION
// ═══════════════════════════════════════════════════

defineScene({
  name: 'close-day-checks-viewer',
  state: {
    data:              null,
    selectedCheckIds:  [],
    startTime:         null,
    _busy:             false,
    _pendingTimer:     null,
  },

  render: function(container, params, state) {
    params = params || {};
    state.startTime = state.startTime || Date.now();
    state._alive = true;

    if (window._header && window._header.setBackHandler) {
      window._header.setBackHandler(function() {
        SceneManager.closeTransactional('close-day-checks-viewer');
      });
    }

    container.style.cssText = [
      'width:100%;height:100%;',
      'display:flex;flex-direction:column;gap:' + T.colGapSm + 'px;',
      'padding:' + PAD_TOP + 'px ' + PAD + 'px ' + PAD + 'px ' + PAD + 'px;',
      'box-sizing:border-box;overflow:hidden;',
      'background:' + T.bg + ';',
    ].join('');

    function refreshData() {
      fetchChecksState().then(function(newData) {
        if (!state._alive) return;
        state.data = newData;
        rebuild();
      }).catch(function(err) {
        if (!state._alive) return;
        console.error('[close-day-checks-viewer] fetch failed:', err);
        showToast('Checks data unavailable', { bg: T.verm });
      });
    }

    function rebuild() {
      if (!state.data) return;
      container.innerHTML = '';

      container.appendChild(buildHeader(state.data)); /* audit: SM2 remnant — COMPLEX, manual migration required */

      var body = document.createElement('div');
      body.style.cssText = 'flex:1;display:flex;gap:' + T.colGapSm + 'px;min-height:0;overflow:hidden;';

      // Stale-cleanup: if a check got paid/voided externally, drop it.
      state.selectedCheckIds = state.selectedCheckIds.filter(function(id) {
        return state.data.openChecks.some(function(c) { return c.checkId === id; });
      });
      var selectedChecks = state.selectedCheckIds.map(function(id) {
        return state.data.openChecks.find(function(c) { return c.checkId === id; });
      }).filter(Boolean);

      body.appendChild(buildReceiptCol(state.data, selectedChecks, state.data.allOrders, handlers));
      body.appendChild(buildChecksListCol(state.data, handlers, state));
      body.appendChild(buildActionsCol(state.data, handlers, state));

      container.appendChild(body);
    }

    // ── Handlers ──
    var handlers = {
      onBack: function() {
        if (params.onBack) params.onBack();
        else SceneManager.closeTransactional('close-day-checks-viewer');
      },

      onToggleCheck: function(chk) {
        var id = chk.checkId;
        var idx = state.selectedCheckIds.indexOf(id);
        if (idx !== -1) state.selectedCheckIds.splice(idx, 1);
        else            state.selectedCheckIds.push(id);
        rebuild();
      },

      onToggleAll: function() {
        if (state.selectedCheckIds.length === state.data.openChecks.length) {
          state.selectedCheckIds = [];
        } else {
          state.selectedCheckIds = state.data.openChecks.map(function(c) { return c.checkId; });
        }
        rebuild();
      },

      onDismissPreview: function() {
        state.selectedCheckIds = [];
        rebuild();
      },

      onTransferChecks: function(checks) {
        if (state._busy) return;
        state._busy = true;
        SceneManager.interrupt('co-transfer-picker', {
          checks: checks,
          currentEmpId: params.managerId,
          onConfirm: function(destServer) {
            SceneManager.closeInterrupt('co-transfer-picker');
            var transfers = checks.map(function(chk) {
              return fetchWithTimeout('/api/v1/orders/' + chk.checkId + '/transfer', {
                method:  'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  to_server_id:   destServer.id,
                  from_server_id: chk.server_id || params.managerId,
                }),
              }, 8000).then(function(r) { return { chk: chk, ok: r.ok, status: r.status }; })
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
                  code === 404 ? 'Transfer endpoint pending \u2014 backend work needed' : 'Transfer failed \u2014 try again',
                  { bg: T.verm }
                );
              }
              state.selectedCheckIds = [];
              state._busy = false;
              refreshData();
            });
          },
          onCancel: function() { state._busy = false; SceneManager.closeInterrupt('co-transfer-picker'); },
        });
      },

      onPrintCheck: function(checks) {
        if (state._busy) return;
        state._busy = true;
        var label = checks.length > 1 ? checks.length + ' checks' : checkNumDisplay(checks[0]);
        showToast('Printing ' + label + '\u2026', { bg: T.greenWarm });

        var prints = checks.map(function(chk) {
          return fetchWithTimeout('/api/v1/checks/' + chk.checkId + '/print', {
            method:  'POST',
            headers: { 'Content-Type': 'application/json' },
            body:    JSON.stringify({ kind: 'guest' }),
          }, 8000).then(function(r) { return { chk: chk, ok: r.ok, status: r.status }; })
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
              code === 404 ? 'Print endpoint pending \u2014 backend work needed' : 'Print failed \u2014 check printer',
              { bg: T.verm }
            );
          }
          state._busy = false;
        });
      },

      onCloseCheck: function(checks) {
        // Single-check payment flow only — combined-payment isn't built yet.
        if (checks.length !== 1) {
          showToast('Select a single check to pay', { bg: T.warning });
          return;
        }
        var chk = checks[0];
        SceneManager.mountWorking('check-overview', {
          checkId:       chk.checkId,
          checkLabel:    chk.checkLabel,
          employeeId:    params.managerId,
          employeeName:  params.managerName,
          returnLanding: 'manager-landing',
        });
      },

      onVoidCheck: function(checks) {
        if (state._busy) return;
        state._busy = true;
        // Destructive: manager PIN → reason-required confirm → POST per check.
        SceneManager.interrupt('co-manager-pin', {
          onConfirm: function() {
            SceneManager.closeInterrupt('co-manager-pin');
            state._pendingTimer = setTimeout(function() {
              state._pendingTimer = null;
              SceneManager.interrupt('co-void-confirm', {
                checks: checks,
                onConfirm: function(reason) {
                  SceneManager.closeInterrupt('co-void-confirm');
                  var voids = checks.map(function(chk) {
                    return fetchWithTimeout('/api/v1/orders/' + chk.checkId + '/void', {
                      method:  'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({
                        reason: reason,
                        manager_pin_verified: true,
                      }),
                    }, 8000).then(function(r) { return { chk: chk, ok: r.ok, status: r.status }; })
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
                        code === 404 ? 'Void endpoint pending \u2014 backend work needed' : 'Void failed \u2014 try again',
                        { bg: T.verm }
                      );
                    }
                    state.selectedCheckIds = [];
                    state._busy = false;
                    refreshData();
                  });
                },
                onCancel: function() { state._busy = false; SceneManager.closeInterrupt('co-void-confirm'); },
              });
            }, 80);
          },
          onCancel: function() { state._busy = false; SceneManager.closeInterrupt('co-manager-pin'); },
        });
      },
    };

    state.__testHandlers = handlers;  // test seam — production code never reads this
    refreshData();
  },

  unmount: function(state) {
    state._alive = false;
    if (state && state._pendingTimer) {
      clearTimeout(state._pendingTimer);
      state._pendingTimer = null;
    }
    if (window._header && window._header.setBackHandler) {
      window._header.setBackHandler(null);
    }
  },
});