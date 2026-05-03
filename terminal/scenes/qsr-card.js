// ═══════════════════════════════════════════════════
//  KINDpos Terminal — QSR Card Tender Scene  (Vz2.0)
//
//  Two-column layout — same frame as qsr-cash:
//    LEFT   T.pcLeftW(340px)  — frozen recap (identical to qsr-cash)
//    RIGHT  683px             — card tender surface
//
//  Right surface (top to bottom):
//    Charge block  — 'CHARGING TO CARD' label + amount hero in T.elec
//                    (NOT T.gold — this is a card charge amount)
//    Reader zone   — dashed T.elec border box, concentric tap rings,
//                    'Tap · Insert · Swipe' prompt, reader status dot
//    Cancel button — T.verm border, T.verm text, full width
//
//  Reader integration (Chunk 2):
//    Initiates payment via existing Dejavoo/payment service
//    Waits for response (polling or event-driven per integration pattern)
//    Response carries tip_amount set by customer on reader screen
//    On success → POST /api/v1/orders/{id}/payments then qsr-complete
//    On cancel  → abort reader request + mountWorking('qsr-order', …)
//
//  Nice. Dependable. Yours.
// ═══════════════════════════════════════════════════

import { defineScene, SceneManager } from '../scene-manager.js';
import { T } from '../../common/tokens.js';
import { hexToRgba, darkenHex } from '../theme-manager.js';

// Local lighten helper — avoids adding theme-manager mock entries downstream.
function _lighten(hex, pct) {
  var r = parseInt(hex.slice(1, 3), 16);
  var g = parseInt(hex.slice(3, 5), 16);
  var b = parseInt(hex.slice(5, 7), 16);
  return '#' + [
    Math.min(255, Math.round(r + (255 - r) * pct)),
    Math.min(255, Math.round(g + (255 - g) * pct)),
    Math.min(255, Math.round(b + (255 - b) * pct)),
  ].map(function(c) { return c.toString(16).padStart(2, '0'); }).join('');
}
import { showToast } from '../components.js';
import { fmt } from './checkout-core.js';
import { fetchWithTimeout } from '../net.js';
import { entReport } from '../entomology-client.js';

// ─────────────────────────────────────────────────
//  LAYOUT CONSTANTS
// ─────────────────────────────────────────────────

var RECAP_W   = T.pcLeftW;
var RIGHT_W   = T.appW - RECAP_W - 1;
var CONTENT_H = T.appH - T.headerH;

var FS_LABEL  = '10px';
var FS_BODY   = '14px';
var FS_HERO   = T.fsHero;   // 56px — charge amount
var FS_PROMPT = '14px';     // 'Tap · Insert · Swipe'
var FS_STATUS = '11px';     // reader status line

// ─────────────────────────────────────────────────
//  STATE
// ─────────────────────────────────────────────────

var state = {
  order:            null,   // full order payload from qsr-order
  chargeAmount:     0,      // order.total — what the reader charges
  readerPending:    false,  // true while waiting for reader response
  cancelFn:         null,   // set by reader integration in Chunk 2
  _submitting:      false,  // true from first POST until response resolves
  idempotencyKey:   null,   // current payment's idempotency key for retry/check
  recoveryActive:   false,  // true when recovery screen is displayed
};

var els = {};

// ─────────────────────────────────────────────────
//  LOCAL FORMAT HELPERS
// ─────────────────────────────────────────────────

function fmtMoney(n) {
  return '$' + (n || 0).toFixed(2);
}

function ticketLabel(n) {
  var s = String(n || 1);
  while (s.length < 3) s = '0' + s;
  return 'QS-' + s;
}

function moneyRound(x) {
  return Math.round(x * 100) / 100;
}

// ─────────────────────────────────────────────────
//  UI BUILDERS
// ─────────────────────────────────────────────────

// Frozen recap — same token pattern as qsr-cash, no cash discount branch.
// Card path shows card total only (TOTAL label, T.gold value).
function buildFrozenRecap(order) {
  var FS_ITEM  = '14px';
  var FS_MOD   = '11px';
  var FS_PRICE = '14px';

  var panel = document.createElement('div');
  panel.style.cssText = [
    'position:absolute;',
    'left:0;top:' + T.headerH + 'px;',
    'width:' + RECAP_W + 'px;',
    'height:' + CONTENT_H + 'px;',
    'background:' + T.card + ';',
    'border-right:1px solid ' + T.border + ';',
    'display:flex;flex-direction:column;',
    'overflow:hidden;',
  ].join('');

  // Lock tint overlay
  var tint = document.createElement('div');
  tint.style.cssText = [
    'position:absolute;inset:0;',
    'background:' + T.well + ';',
    'opacity:0.12;',
    'pointer-events:none;z-index:5;',
  ].join('');
  panel.appendChild(tint);

  // Sub-header
  var subHeader = document.createElement('div');
  subHeader.style.cssText = [
    'height:44px;flex-shrink:0;',
    'background:' + T.well + ';',
    'border-bottom:2px solid ' + darkenHex(T.bg, 0.2) + ';',
    'display:flex;align-items:center;justify-content:space-between;',
    'padding:8px 12px;z-index:1;box-sizing:border-box;',
  ].join('');

  var orderLabel = document.createElement('span');
  orderLabel.style.cssText = [
    'font-family:' + T.fh + ';font-size:' + T.fsB2 + ';',
    'font-weight:' + T.fwBold + ';color:' + T.green + ';',
    'letter-spacing:0.15em;text-transform:uppercase;',
  ].join('');
  orderLabel.textContent = 'ORDER';

  var rightHead = document.createElement('div');
  rightHead.style.cssText = 'display:flex;flex-direction:column;align-items:flex-end;gap:2px;';

  var ticketEl = document.createElement('span');
  ticketEl.style.cssText = [
    'font-family:' + T.fb + ';font-size:' + FS_LABEL + ';',
    'color:' + T.moon + ';letter-spacing:1px;',
  ].join('') + ";font-weight:" + T.fwBold + ";";
  ticketEl.textContent = ticketLabel(order.ticketNumber);

  var lockedEl = document.createElement('span');
  lockedEl.style.cssText = [
    'font-family:' + T.fb + ';font-size:' + FS_MOD + ';',
    'color:' + T.moon + ';',
  ].join('') + ";font-weight:" + T.fwBold + ";";
  lockedEl.textContent = 'locked';

  rightHead.appendChild(ticketEl);
  rightHead.appendChild(lockedEl);
  subHeader.appendChild(orderLabel);
  subHeader.appendChild(rightHead);
  panel.appendChild(subHeader);

  // Item list (display only — no tap handlers)
  var itemList = document.createElement('div');
  itemList.style.cssText = [
    'flex:1;overflow-y:auto;',
    'padding:8px 12px;',
    'display:flex;flex-direction:column;gap:6px;',
    'min-height:0;z-index:1;',
  ].join('');

  var items = order.items || [];
  if (items.length === 0) {
    var ph = document.createElement('div');
    ph.style.cssText = [
      'font-family:' + T.fb + ';font-size:' + FS_MOD + ';',
      'color:' + T.moon + ';text-align:center;padding:20px;',
    ].join('') + ";font-weight:" + T.fwBold + ";";
    ph.textContent = 'No items';
    itemList.appendChild(ph);
  } else {
    var bevelLt = _lighten(T.bg, 0.08);
    var bevelDk = darkenHex(T.bg, 0.2);
    items.forEach(function(item) {
      var row = document.createElement('div');
      row.style.cssText = [
        'display:flex;flex-direction:column;justify-content:center;gap:2px;',
        'background:' + T.well + ';',
        'border-radius:8px;',
        'border-top:2px solid ' + bevelLt + ';',
        'border-right:2px solid ' + bevelDk + ';',
        'border-bottom:2px solid ' + bevelDk + ';',
        'border-left:3px solid ' + T.moon + ';',
        'padding:6px 10px;flex-shrink:0;',
      ].join('');

      var topRow = document.createElement('div');
      topRow.style.cssText = 'display:flex;align-items:center;justify-content:space-between;gap:6px;';

      var nameEl = document.createElement('span');
      nameEl.style.cssText = [
        'font-family:' + T.fb + ';font-size:' + FS_ITEM + ';',
        'font-weight:' + T.fwBold + ';color:' + T.text + ';',
        'flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;',
      ].join('');
      nameEl.textContent = (item.qty > 1 ? item.qty + '× ' : '') + item.name;

      var priceEl = document.createElement('span');
      priceEl.style.cssText = [
        'font-family:' + T.fb + ';font-size:' + FS_PRICE + ';',
        'font-weight:' + T.fwBold + ';color:' + (item.price > 0 ? T.gold : T.moon) + ';',
        'flex-shrink:0;white-space:nowrap;',
      ].join('');
      priceEl.textContent = item.price > 0 ? fmtMoney(item.price * (item.qty || 1)) : '—';

      topRow.appendChild(nameEl);
      topRow.appendChild(priceEl);
      row.appendChild(topRow);

      if (item.mods && item.mods.length) {
        var modEl = document.createElement('span');
        modEl.style.cssText = [
          'font-family:' + T.fb + ';font-size:' + FS_MOD + ';',
          'font-weight:' + T.fwBold + ';color:' + T.moon + ';',
        ].join('');
        modEl.textContent = item.mods.join(', ');
        row.appendChild(modEl);
      }

      itemList.appendChild(row);
    });
  }
  panel.appendChild(itemList);

  // Divider
  var div1 = document.createElement('div');
  div1.style.cssText = 'height:1px;background:' + T.border + ';flex-shrink:0;margin:0 12px;z-index:1;';
  panel.appendChild(div1);

  // Totals block
  var totalsBlock = document.createElement('div');
  totalsBlock.style.cssText = [
    'padding:8px 12px 4px;',
    'display:flex;flex-direction:column;gap:4px;flex-shrink:0;z-index:1;',
  ].join('');

  function makeTotRow(lbl, val, lblColor, valColor, valBold, valFs) {
    var r = document.createElement('div');
    r.style.cssText = 'display:flex;justify-content:space-between;align-items:center;';
    var l = document.createElement('span');
    l.style.cssText = [
      'font-family:' + T.fb + ';font-size:' + FS_ITEM + ';',
      'color:' + (lblColor || T.moon) + ';',
    ].join('') + ";font-weight:" + T.fwBold + ";";
    l.textContent = lbl;
    var v = document.createElement('span');
    v.style.cssText = [
      'font-family:' + (valBold ? T.fh : T.fb) + ';',
      'font-size:' + (valFs || FS_ITEM) + ';',
      'font-weight:' + (valBold ? T.fwBold : T.fwReg) + ';',
      'color:' + (valColor || T.gold) + ';',
    ].join('');
    v.textContent = val;
    r.appendChild(l);
    r.appendChild(v);
    return r;
  }

  var subtotal = 0;
  items.forEach(function(it) { subtotal += it.price * (it.qty || 1); });
  var tax   = moneyRound(subtotal * (order.taxRate || 0));
  var total = moneyRound(subtotal + tax);

  totalsBlock.appendChild(makeTotRow('Subtotal', fmtMoney(subtotal)));
  totalsBlock.appendChild(makeTotRow(
    'Tax ' + ((order.taxRate || 0) * 100).toFixed(2) + '%',
    fmtMoney(tax)
  ));

  var totDivider = document.createElement('div');
  totDivider.style.cssText = 'height:1px;background:' + T.border + ';margin:4px 0;';
  totalsBlock.appendChild(totDivider);

  // Card path: always show TOTAL (no discount branch)
  totalsBlock.appendChild(makeTotRow(
    'TOTAL', fmtMoney(total),
    T.text, T.gold, true, '20px'
  ));

  panel.appendChild(totalsBlock);

  // Back to menu link — aborts reader if in flight
  var backLink = document.createElement('div');
  backLink.style.cssText = [
    'margin-top:auto;',
    'padding:10px 12px 12px;',
    'flex-shrink:0;z-index:1;',
    'cursor:pointer;pointer-events:auto;touch-action:manipulation;',
  ].join('');
  var backText = document.createElement('span');
  backText.style.cssText = [
    'font-family:' + T.fb + ';font-size:' + FS_LABEL + ';',
    'color:' + T.moon + ';',
  ].join('') + ";font-weight:" + T.fwBold + ";";
  backText.textContent = '← back to menu';
  backLink.appendChild(backText);

  backLink.addEventListener('pointerup', function() {
    if (state.cancelFn) state.cancelFn();
    SceneManager.mountWorking('qsr-order', {
      items:            state.order.items,
      ticketNumber:     state.order.ticketNumber,
      ticketName:       state.order.ticketName,
      cashDiscountRate: state.order.cashDiscountRate,
    });
  });

  panel.appendChild(backLink);
  return panel;
}

// Charge block — top of right surface
function buildChargeBlock() {
  var el = document.createElement('div');
  el.style.cssText = [
    'padding:' + T.scenePad + 'px;',
    'text-align:center;',
    'border-bottom:1px solid ' + T.border + ';',
    'flex-shrink:0;',
  ].join('');

  var label = document.createElement('div');
  label.style.cssText = [
    'font-family:' + T.fb + ';font-size:' + FS_LABEL + ';',
    'font-weight:' + T.fwBold + ';color:' + T.moon + ';',
    'letter-spacing:2px;margin-bottom:10px;text-transform:uppercase;',
  ].join('');
  label.textContent = 'CHARGING TO CARD';

  // Amount hero — T.elec (card payment amount — NOT T.gold)
  var amount = document.createElement('div');
  amount.style.cssText = [
    'font-family:' + T.fh + ';font-size:' + FS_HERO + ';',
    'font-weight:800;color:' + T.elec + ';',
    'line-height:1;',
  ].join('');
  amount.textContent = fmtMoney(state.chargeAmount);
  els.chargeAmountEl = amount;

  el.appendChild(label);
  el.appendChild(amount);
  return el;
}

// Reader zone — dashed card-present prompt area
function buildReaderZone() {
  var zone = document.createElement('div');
  zone.style.cssText = [
    'margin:' + T.scenePad + 'px;',
    'flex:1;',
    'border-radius:' + T.chamferCard + 'px;',
    'border:1.5px dashed ' + T.elec + ';',
    'background:' + T.well + ';',
    'display:flex;flex-direction:column;',
    'align-items:center;justify-content:center;',
    'gap:12px;',
    'position:relative;',
  ].join('');
  els.readerZone = zone;

  // Concentric tap rings via box-shadow
  var rings = document.createElement('div');
  rings.style.cssText = [
    'width:40px;height:40px;border-radius:50%;',
    'border:2px solid ' + T.elec + ';',
    'box-shadow:',
    '0 0 0 14px ' + hexToRgba(T.elec, 0.35) + ',',
    '0 0 0 28px ' + hexToRgba(T.elec, 0.2) + ',',
    '0 0 0 44px ' + hexToRgba(T.elec, 0.1) + ';',
    'display:flex;align-items:center;justify-content:center;',
  ].join('');

  var arc = document.createElement('div');
  arc.style.cssText = 'font-size:18px;color:' + T.elec + ';' + ";font-weight:" + T.fwBold + ";";
  arc.textContent = '⌁';
  rings.appendChild(arc);

  var prompt = document.createElement('div');
  prompt.style.cssText = [
    'font-family:' + T.fb + ';font-size:' + FS_PROMPT + ';',
    'font-weight:' + T.fwBold + ';color:' + T.elec + ';',
    'margin-top:24px;',
  ].join('');
  prompt.textContent = 'Tap · Insert · Swipe';

  var sub = document.createElement('div');
  sub.style.cssText = [
    'font-family:' + T.fb + ';font-size:' + FS_BODY + ';',
    'color:' + T.moon + ';',
  ].join('') + ";font-weight:" + T.fwBold + ";";
  sub.textContent = 'Present card to reader';

  // Status row
  var statusRow = document.createElement('div');
  statusRow.style.cssText = 'display:flex;align-items:center;gap:6px;';

  var dot = document.createElement('div');
  dot.style.cssText = [
    'width:8px;height:8px;border-radius:50%;',
    'background:' + T.elec + ';',
  ].join('');
  els.statusDot = dot;

  var statusText = document.createElement('span');
  statusText.style.cssText = [
    'font-family:' + T.fb + ';font-size:' + FS_STATUS + ';',
    'color:' + T.elec + ';',
  ].join('') + ";font-weight:" + T.fwBold + ";";
  statusText.textContent = 'Reader ready';
  els.statusText = statusText;

  statusRow.appendChild(dot);
  statusRow.appendChild(statusText);

  zone.appendChild(rings);
  zone.appendChild(prompt);
  zone.appendChild(sub);
  zone.appendChild(statusRow);

  return zone;
}

// Cancel button — T.verm ghost, full width
function buildCancelButton() {
  var btn = document.createElement('div');
  btn.style.cssText = [
    'margin:0 ' + T.scenePad + 'px ' + T.scenePad + 'px;',
    'height:44px;border-radius:' + T.chamferBtn + 'px;',
    'border:1.5px solid ' + T.verm + ';',
    'background:' + T.card + ';',
    'display:flex;align-items:center;justify-content:center;',
    'cursor:pointer;pointer-events:auto;touch-action:manipulation;',
    'flex-shrink:0;',
  ].join('');

  var label = document.createElement('span');
  label.style.cssText = [
    'font-family:' + T.fb + ';font-size:' + FS_BODY + ';',
    'font-weight:' + T.fwBold + ';color:' + T.verm + ';',
  ].join('');
  label.textContent = 'Cancel';

  btn.appendChild(label);
  btn.addEventListener('pointerup', function() { handleCancel(); });
  els.cancelBtn = btn;
  return btn;
}

function buildRightSurface() {
  var el = document.createElement('div');
  el.style.cssText = [
    'position:absolute;',
    'left:' + (RECAP_W + 1) + 'px;',
    'top:' + T.headerH + 'px;',
    'width:' + RIGHT_W + 'px;',
    'height:' + CONTENT_H + 'px;',
    'background:' + T.bg + ';',
    'display:flex;flex-direction:column;',
    'overflow:hidden;',
  ].join('');

  el.appendChild(buildChargeBlock());
  el.appendChild(buildReaderZone());
  el.appendChild(buildCancelButton());

  els.rightSurface = el;
  return el;
}

// ─────────────────────────────────────────────────
//  READER STATUS
// ─────────────────────────────────────────────────

function setReaderStatus(text, color) {
  if (els.statusDot)  els.statusDot.style.background  = color;
  if (els.statusText) {
    els.statusText.style.color = color;
    els.statusText.textContent = text;
  }
}

// ─────────────────────────────────────────────────
//  PAYMENT RECOVERY SCREEN
// ─────────────────────────────────────────────────

function buildRecoveryScreen() {
  var container = document.createElement('div');
  container.style.cssText = [
    'position:absolute;',
    'left:' + (RECAP_W + 1) + 'px;',
    'top:' + T.headerH + 'px;',
    'width:' + RIGHT_W + 'px;',
    'height:' + CONTENT_H + 'px;',
    'background:' + T.bg + ';',
    'display:flex;flex-direction:column;',
    'padding:' + T.scenePad + 'px;',
    'box-sizing:border-box;',
    'z-index:10;',
  ].join('');

  // Title
  var title = document.createElement('div');
  title.style.cssText = [
    'font-family:' + T.fh + ';',
    'font-size:24px;font-weight:' + T.fwBold + ';',
    'color:' + T.warning + ';',
    'margin-bottom:16px;',
  ].join('');
  title.textContent = 'Payment Status Unknown';
  container.appendChild(title);

  // Body text
  var body = document.createElement('div');
  body.style.cssText = [
    'font-family:' + T.fb + ';',
    'font-size:14px;color:' + T.text + ';',
    'line-height:1.5;margin-bottom:24px;',
  ].join('');
  body.textContent = 'The payment request timed out. The charge may or may not have been processed.';
  container.appendChild(body);

  // Spacer
  var spacer = document.createElement('div');
  spacer.style.cssText = 'flex:1;';
  container.appendChild(spacer);

  // Button row — three buttons, stacked vertically
  var buttonRow = document.createElement('div');
  buttonRow.style.cssText = 'display:flex;flex-direction:column;gap:10px;flex-shrink:0;';

  // CHECK ORDER STATUS button
  var checkBtn = document.createElement('div');
  checkBtn.style.cssText = [
    'height:44px;border-radius:' + T.chamferBtn + 'px;',
    'border:1.5px solid ' + T.green + ';',
    'background:' + hexToRgba(T.green, 0.18) + ';',
    'display:flex;align-items:center;justify-content:center;',
    'cursor:pointer;pointer-events:auto;touch-action:manipulation;',
  ].join('');
  var checkLabel = document.createElement('span');
  checkLabel.style.cssText = [
    'font-family:' + T.fb + ';font-size:14px;',
    'font-weight:' + T.fwBold + ';color:' + T.green + ';',
  ].join('');
  checkLabel.textContent = 'CHECK ORDER STATUS';
  checkBtn.appendChild(checkLabel);
  checkBtn.addEventListener('pointerup', handleCheckOrderStatus);

  // TRY AGAIN button
  var retryBtn = document.createElement('div');
  retryBtn.style.cssText = [
    'height:44px;border-radius:' + T.chamferBtn + 'px;',
    'border:1.5px solid ' + T.elec + ';',
    'background:' + hexToRgba(T.elec, 0.18) + ';',
    'display:flex;align-items:center;justify-content:center;',
    'cursor:pointer;pointer-events:auto;touch-action:manipulation;',
  ].join('');
  var retryLabel = document.createElement('span');
  retryLabel.style.cssText = [
    'font-family:' + T.fb + ';font-size:14px;',
    'font-weight:' + T.fwBold + ';color:' + T.elec + ';',
  ].join('');
  retryLabel.textContent = 'TRY AGAIN';
  retryBtn.appendChild(retryLabel);
  retryBtn.addEventListener('pointerup', handlePaymentRetry);

  // CANCEL button
  var cancelBtn = document.createElement('div');
  cancelBtn.style.cssText = [
    'height:44px;border-radius:' + T.chamferBtn + 'px;',
    'border:1.5px solid ' + T.verm + ';',
    'background:' + T.card + ';',
    'display:flex;align-items:center;justify-content:center;',
    'cursor:pointer;pointer-events:auto;touch-action:manipulation;',
  ].join('');
  var cancelLabel = document.createElement('span');
  cancelLabel.style.cssText = [
    'font-family:' + T.fb + ';font-size:14px;',
    'font-weight:' + T.fwBold + ';color:' + T.verm + ';',
  ].join('');
  cancelLabel.textContent = 'CANCEL';
  cancelBtn.appendChild(cancelLabel);
  cancelBtn.addEventListener('pointerup', handleRecoveryCancel);

  buttonRow.appendChild(checkBtn);
  buttonRow.appendChild(retryBtn);
  buttonRow.appendChild(cancelBtn);
  container.appendChild(buttonRow);

  return container;
}

// ─────────────────────────────────────────────────
//  READER PAYMENT FLOW  — Pattern A (backend-mediated)
//
//  POST /api/v1/payments/sale — backend drives the Dejavoo reader
//  synchronously, returns TransactionResult when the customer completes
//  the transaction (or times out / declines). AbortController lets the
//  operator cancel mid-wait.
//
//  Ledger recording (payment_confirmed + order_closed) is handled by
//  the backend sale endpoint — no second POST is needed from the frontend.
// ─────────────────────────────────────────────────

function initiateReaderPayment() {
  if (!state.order) return;
  if (state._submitting || state.readerPending) return;
  state._submitting = true;

  state.readerPending = true;
  setReaderStatus('Processing…', T.warning);
  if (els.cancelBtn) els.cancelBtn.style.pointerEvents = 'none';

  var controller = new AbortController();
  state.cancelFn = function() {
    controller.abort();
    state.readerPending = false;
    state._submitting = false;
  };

  var orderId = state.order.orderId;
  // Reuse idempotency key if retrying, otherwise generate new one
  var txId = state.idempotencyKey || ('qsr-card-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8));
  state.idempotencyKey = txId;
  var payload = {
    order_id:        orderId || '',
    amount:          state.chargeAmount,
    terminal_id:     'T-001',   // default mapping registered in payment_routes
    idempotency_key: txId,
  };

  fetch('/api/v1/payments/sale', {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify(payload),
    signal:  controller.signal,
  })
  .then(function(res) {
    if (!res.ok) {
      return res.json().then(function(e) {
        throw new Error(e.detail || 'Payment request failed (' + res.status + ')');
      });
    }
    return res.json();
  })
  .then(function(result) {
    handlePaymentResponse(result);
  })
  .catch(function(err) {
    if (err && err.name === 'AbortError') {
      // Cancelled by operator — navigation away already handled by cancelFn caller
      return;
    }
    state._submitting = false;
    state.readerPending = false;

    // Network timeout/error: show recovery screen instead of silent failure
    entReport({
      code: 'QSR_PAYMENT_TIMEOUT',
      source: 'qsr-card',
      message: err.message || 'Payment request timeout',
      ctx: {
        orderId: state.order.orderId || '',
        idempotencyKey: state.idempotencyKey || '',
      },
      level: 'warn',
    });

    showRecoveryScreen();
  });
}

function handlePaymentResponse(result) {
  state.readerPending = false;
  state._submitting = false;

  if (!result || result.status !== 'APPROVED') {
    var msg = (result && result.processor_message) || 'Payment declined';
    setReaderStatus(msg, T.verm);
    if (els.cancelBtn) els.cancelBtn.style.pointerEvents = 'auto';
    return;
  }

  setReaderStatus('Approved', T.green);

  // tip_amount is handled by the backend (overage-as-tip logic).
  // We record the card details for the complete scene display only.
  var tipAmount = moneyRound(
    (result.tip_amount !== undefined ? result.tip_amount : 0)
  );

  var settled = moneyRound(state.chargeAmount + tipAmount);

  // Update hero to show final settled amount if tip was added
  if (tipAmount > 0 && els.chargeAmountEl) {
    els.chargeAmountEl.textContent = fmtMoney(settled);
  }

  postPaymentToLedger({
    method:         'card',
    amount:         state.chargeAmount,
    tip_amount:     tipAmount,
    settled_amount: settled,
    card_last4:     result.last_four          || '',
    card_brand:     result.card_brand         || '',
    auth_code:      result.authorization_code || '',
    transaction_id: result.transaction_id     || '',
    tax:            state.order.tax           || 0,
  });
}

function postPaymentToLedger(payload) {
  // The backend's /api/v1/payments/sale already wrote payment_confirmed and
  // order_closed to the ledger. Route directly to the complete scene.
  // If there was no orderId (pre-persist flow), same path applies.
  routeToComplete(payload);
}

function routeToComplete(paymentPayload) {
  SceneManager.mountWorking('qsr-complete', {
    order:         state.order,
    paymentMethod: 'card',
    tipAmount:     paymentPayload.tip_amount   || 0,
    cardLast4:     paymentPayload.card_last4   || '',
    cardBrand:     paymentPayload.card_brand   || '',
    changeDue:     0,
  });
}

// ─────────────────────────────────────────────────
//  RECOVERY SCREEN HANDLERS
// ─────────────────────────────────────────────────

function showRecoveryScreen() {
  if (els.rightSurface) els.rightSurface.style.display = 'none';
  var recoveryEl = buildRecoveryScreen();
  document.querySelector('[data-scene="qsr-card"]')?.appendChild(recoveryEl);
  state.recoveryActive = true;
  els.recoveryScreen = recoveryEl;
}

function hideRecoveryScreen() {
  if (els.recoveryScreen) {
    els.recoveryScreen.remove();
    els.recoveryScreen = null;
  }
  if (els.rightSurface) els.rightSurface.style.display = 'flex';
  state.recoveryActive = false;
}

function handleCheckOrderStatus() {
  var orderId = state.order.orderId;
  if (!orderId) {
    showToast('Order ID not found');
    return;
  }

  fetchWithTimeout('/api/v1/orders/' + orderId, {}, 10000)
    .then(function(res) {
      if (!res.ok) {
        showToast('Failed to check order status');
        return;
      }
      return res.json();
    })
    .then(function(orderData) {
      if (!orderData) return;

      // Check if a confirmed payment exists matching the idempotency_key
      var payments = orderData.payments || [];
      var confirmedPayment = payments.find(function(p) {
        return p.status === 'confirmed' && p.idempotency_key === state.idempotencyKey;
      });

      if (confirmedPayment) {
        // Payment succeeded — route to complete
        hideRecoveryScreen();
        routeToComplete({
          tip_amount:  confirmedPayment.tip_amount || 0,
          card_last4:  confirmedPayment.card_last4 || '',
          card_brand:  confirmedPayment.card_brand || '',
        });
      } else {
        // Payment not found — still unclear
        showToast('Payment status: Not confirmed. Try again or contact support.');
      }
    })
    .catch(function(err) {
      showToast('Could not reach server to check status');
    });
}

function handlePaymentRetry() {
  hideRecoveryScreen();
  // Reset reader UI state
  state.readerPending = false;
  state._submitting = false;
  setReaderStatus('Retrying…', T.warning);
  if (els.cancelBtn) els.cancelBtn.style.pointerEvents = 'none';
  // Retry with same idempotency key (safe due to idempotency guard)
  initiateReaderPayment();
}

function handleRecoveryCancel() {
  hideRecoveryScreen();
  showToast('Payment cancelled. Verify with manager if card was charged.');
  SceneManager.mountWorking('qsr-order', {
    items:            state.order.items,
    ticketNumber:     state.order.ticketNumber,
    ticketName:       state.order.ticketName,
    cashDiscountRate: state.order.cashDiscountRate,
  });
}

// ─────────────────────────────────────────────────
//  CANCEL HANDLER
// ─────────────────────────────────────────────────

function handleCancel() {
  if (state.cancelFn) state.cancelFn();
  SceneManager.mountWorking('qsr-order', {
    items:            state.order.items,
    ticketNumber:     state.order.ticketNumber,
    ticketName:       state.order.ticketName,
    cashDiscountRate: state.order.cashDiscountRate,
  });
}

// ─────────────────────────────────────────────────
//  SCENE REGISTRATION
// ─────────────────────────────────────────────────

defineScene('qsr-card', {
  mount: function(container, params) {
    state.order         = (params && params.order) || {};
    state.chargeAmount  = Number(state.order.total) || 0;
    state.readerPending = false;
    state.cancelFn      = null;
    state._submitting   = false;
    state.idempotencyKey = null;
    state.recoveryActive = false;

    var recapEl = buildFrozenRecap(state.order);
    var rightEl = buildRightSurface();
    container.appendChild(recapEl);
    container.appendChild(rightEl);

    initiateReaderPayment();
  },

  unmount: function() {
    if (state.cancelFn) state.cancelFn();
    state.cancelFn      = null;
    state.readerPending = false;
    hideRecoveryScreen();
    els = {};
  },
});
