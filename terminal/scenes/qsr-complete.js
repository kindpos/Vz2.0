// ═══════════════════════════════════════════════════
//  KINDpos Terminal — QSR Complete Scene  (Vz2.0)
//
//  Two-column layout:
//    LEFT   T.pcLeftW(340px)  — receipt panel (paid state of recap)
//    RIGHT  683px             — completion surface
//
//  Left panel — receipt state:
//    T.greenWarm top accent bar (3px) — signals settled
//    Header: 'ORDER QS-XXX · PAID' in T.greenWarm
//    Item list (read-only, T.greenWarm accent bars)
//    Totals block
//    If cash + cashDiscountRate > 0: discount line in T.green
//    Payment line: 'Tendered cash' + T.greenWarm amount (cash)
//                  or 'Card ····XXXX' + T.elec amount (card)
//    Change line: shown only for cash path, T.greenWarm
//    If card + tipAmount > 0: 'Tip' line in T.elec
//    Receipt options: Print / Email / Skip (3 buttons)
//
//  Right panel — completion surface:
//    Success checkmark circle (T.greenWarm stroke)
//    Ticket number QS-XXX (T.moon)
//    CHANGE DUE block (cash path only):
//      Label 'CHANGE DUE' T.moon
//      Hero  fmt(changeDue) T.fh T.fsHero fwBold T.gold
//    Card confirmation block (card path only):
//      Card brand + last4 in T.elec
//      Tip amount if > 0
//    Kitchen ticket status indicator
//    Auto-reset progress bar (8s, T.green on T.well)
//    NEW ORDER button (T.greenWarm fill)
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

// ─────────────────────────────────────────────────
//  LAYOUT CONSTANTS
// ─────────────────────────────────────────────────

var RECAP_W      = T.pcLeftW;
var RIGHT_W      = T.appW - RECAP_W - 1;
var CONTENT_H    = T.appH - T.headerH;
var RESET_SECS   = 8;

var FS_LABEL     = '10px';
var FS_BODY      = '14px';
var FS_ITEM      = '14px';
var FS_TOTAL     = '24px';
var FS_CHANGE    = T.fsHero;
var FS_TICKET    = '11px';
var FS_BTN       = '14px';
var FS_BTN_MAIN  = '18px';

// ─────────────────────────────────────────────────
//  STATE
// ─────────────────────────────────────────────────

var state = {
  order:              null,
  paymentMethod:      'cash',
  cashTotal:          0,
  tendered:           0,
  changeDue:          0,
  cashDiscountRate:   0,
  cashDiscountAmount: 0,
  tipAmount:          0,
  cardLast4:          '',
  cardBrand:          '',
  isSplit:            false,
  payments:           [],
  splitCount:         0,
  resetTimer:         null,
  resetSecsLeft:      RESET_SECS,
};

var els = {};

// ─────────────────────────────────────────────────
//  HELPERS
// ─────────────────────────────────────────────────

function moneyRound(x) { return Math.round(x * 100) / 100; }

function ticketLabel() {
  var n = (state.order && state.order.ticketNumber) || 1;
  var s = String(n);
  while (s.length < 3) s = '0' + s;
  return 'QS-' + s;
}

// ─────────────────────────────────────────────────
//  LEFT — RECEIPT PANEL
// ─────────────────────────────────────────────────

function buildReceiptPanel() {
  var panel = document.createElement('div');
  panel.style.cssText = [
    'position:absolute;left:0;top:' + T.headerH + 'px;',
    'width:' + RECAP_W + 'px;height:' + CONTENT_H + 'px;',
    'background:' + T.card + ';',
    'border-right:1px solid ' + T.border + ';',
    'display:flex;flex-direction:column;overflow:hidden;',
  ].join('');

  // T.greenWarm top accent bar — settled state signal
  var topBar = document.createElement('div');
  topBar.style.cssText = 'height:3px;background:' + T.greenWarm + ';flex-shrink:0;';
  panel.appendChild(topBar);

  // Sub-header
  var hdr = document.createElement('div');
  hdr.style.cssText = [
    'height:44px;background:' + T.well + ';flex-shrink:0;',
    'border-bottom:2px solid ' + darkenHex(T.bg, 0.2) + ';',
    'display:flex;align-items:center;padding:8px 16px;',
    'justify-content:space-between;box-sizing:border-box;',
  ].join('');

  var hdrLabel = document.createElement('span');
  hdrLabel.style.cssText = [
    'font-family:' + T.fh + ';font-size:' + T.fsB2 + ';',
    'font-weight:' + T.fwBold + ';color:' + T.greenWarm + ';',
    'letter-spacing:0.15em;text-transform:uppercase;',
  ].join('');
  hdrLabel.textContent = 'ORDER  ' + ticketLabel() + '  ·  PAID';
  hdr.appendChild(hdrLabel);
  panel.appendChild(hdr);

  // Item list — read-only, T.greenWarm accent bars (settled state)
  var itemList = document.createElement('div');
  itemList.style.cssText = [
    'flex:1;overflow-y:auto;padding:10px 12px;',
    'display:flex;flex-direction:column;gap:6px;min-height:0;',
  ].join('');

  var items = (state.order && state.order.items) || [];

  if (items.length === 0) {
    var ph = document.createElement('div');
    ph.style.cssText = [
      'font-family:' + T.fb + ';font-size:' + FS_BODY + ';',
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
        'background:' + T.well + ';',
        'border-radius:8px;',
        'border-top:2px solid ' + bevelLt + ';',
        'border-right:2px solid ' + bevelDk + ';',
        'border-bottom:2px solid ' + bevelDk + ';',
        'border-left:3px solid ' + T.greenWarm + ';',
        'padding:6px 10px;display:flex;justify-content:space-between;',
        'align-items:flex-start;flex-shrink:0;',
      ].join('');

      var nameCol = document.createElement('div');
      nameCol.style.cssText = 'flex:1;min-width:0;';

      var name = document.createElement('div');
      name.style.cssText = [
        'font-family:' + T.fb + ';font-size:' + FS_ITEM + ';',
        'font-weight:' + T.fwBold + ';color:' + T.text + ';',
        'white-space:nowrap;overflow:hidden;text-overflow:ellipsis;',
      ].join('');
      name.textContent = (item.qty > 1 ? item.qty + '× ' : '') + item.name;
      nameCol.appendChild(name);

      if (item.mods && item.mods.length) {
        var mods = document.createElement('div');
        mods.style.cssText = [
          'font-family:' + T.fb + ';font-size:11px;',
          'color:' + T.moon + ';',
        ].join('') + ";font-weight:" + T.fwBold + ";";
        mods.textContent = item.mods.join('  ·  ');
        nameCol.appendChild(mods);
      }

      var price = document.createElement('div');
      price.style.cssText = [
        'font-family:' + T.fb + ';font-size:' + FS_ITEM + ';',
        'font-weight:' + T.fwBold + ';color:' + T.gold + ';',
        'flex-shrink:0;white-space:nowrap;margin-left:8px;',
      ].join('');
      price.textContent = fmt(moneyRound(item.price * (item.qty || 1)));

      row.appendChild(nameCol);
      row.appendChild(price);
      itemList.appendChild(row);
    });
  }

  panel.appendChild(itemList);

  // Totals divider
  var divider = document.createElement('div');
  divider.style.cssText = 'height:1px;background:' + T.border + ';margin:0 12px;flex-shrink:0;';
  panel.appendChild(divider);

  // Totals block
  var totals = document.createElement('div');
  totals.style.cssText = 'padding:10px 16px;flex-shrink:0;';

  function addRow(label, value, labelColor, valueColor, isBold) {
    var row = document.createElement('div');
    row.style.cssText = 'display:flex;justify-content:space-between;margin-bottom:4px;';

    var l = document.createElement('span');
    l.style.cssText = [
      'font-family:' + T.fb + ';font-size:' + FS_BODY + ';',
      'color:' + (labelColor || T.moon) + ';',
    ].join('') + ";font-weight:" + T.fwBold + ";";
    l.textContent = label;

    var v = document.createElement('span');
    v.style.cssText = [
      'font-family:' + T.fb + ';font-size:' + FS_BODY + ';',
      'color:' + (valueColor || T.gold) + ';',
      isBold ? 'font-weight:' + T.fwBold + ';' : '',
    ].join('');
    v.textContent = value;

    row.appendChild(l);
    row.appendChild(v);
    totals.appendChild(row);
  }

  addRow('Subtotal', fmt(state.order.subtotal || 0));
  addRow('Tax',      fmt(state.order.tax      || 0));

  // Divider before total
  var totDiv = document.createElement('div');
  totDiv.style.cssText = 'height:1px;background:' + T.border + ';margin:6px 0;';
  totals.appendChild(totDiv);

  addRow('Total', fmt(state.order.total || 0), T.text, T.gold, true);

  // Cash discount line (cash path + rate > 0)
  if (state.paymentMethod === 'cash' && state.cashDiscountRate > 0) {
    var discPct = (state.cashDiscountRate * 100).toFixed(1).replace(/\.0$/, '');
    addRow(
      'Cash discount −' + discPct + '%',
      '−' + fmt(state.cashDiscountAmount),
      T.green, T.green
    );
    addRow('Cash total', fmt(state.cashTotal), T.text, T.gold, true);
  }

  // Payment line
  if (state.paymentMethod === 'split') {
    (state.payments || []).forEach(function(p, i) {
      var methodLabel = p.method === 'card'
        ? ('Card' + (p.cardLast4 ? ' ····' + p.cardLast4 : ''))
        : 'Cash';
      addRow(
        'Payment ' + (i + 1) + '  ' + methodLabel,
        fmt(p.amount),
        T.moon,
        p.method === 'card' ? T.elec : T.greenWarm
      );
    });
    if (state.tipAmount > 0) {
      addRow('Tips', fmt(state.tipAmount), T.moon, T.elec);
    }
    if (state.changeDue > 0) {
      addRow('Total change', fmt(state.changeDue), T.moon, T.greenWarm);
    }
  } else if (state.paymentMethod === 'cash') {
    addRow('Tendered cash', fmt(state.tendered), T.moon, T.greenWarm);
    if (state.changeDue > 0) {
      addRow('Change', fmt(state.changeDue), T.text, T.greenWarm, true);
    }
  } else {
    var cardLabel = state.cardBrand
      ? (state.cardBrand + '  ····' + (state.cardLast4 || ''))
      : 'Card';
    addRow(cardLabel, fmt(state.order.total || 0), T.moon, T.elec);
    if (state.tipAmount > 0) {
      addRow('Tip', fmt(state.tipAmount), T.moon, T.elec);
    }
  }

  panel.appendChild(totals);

  // Receipt section label
  var receiptLabel = document.createElement('div');
  receiptLabel.style.cssText = [
    'font-family:' + T.fb + ';font-size:' + FS_LABEL + ';',
    'font-weight:' + T.fwBold + ';color:' + T.green + ';',
    'letter-spacing:2px;padding:0 16px 6px;flex-shrink:0;',
  ].join('');
  receiptLabel.textContent = 'RECEIPT';
  panel.appendChild(receiptLabel);

  // Receipt buttons
  var receiptRow = document.createElement('div');
  receiptRow.style.cssText = 'display:flex;gap:8px;padding:0 12px 12px;flex-shrink:0;';

  function makeReceiptBtn(label, onClick, isPrimary) {
    var btn = document.createElement('div');
    btn.style.cssText = [
      'flex:1;height:36px;border-radius:' + T.chamferBtn + 'px;',
      'display:flex;align-items:center;justify-content:center;',
      'cursor:pointer;pointer-events:auto;touch-action:manipulation;',
      isPrimary
        ? 'background:' + T.card + ';border:1px solid ' + T.green + ';'
        : 'background:' + T.well + ';border:1px solid ' + T.border + ';',
    ].join('');

    var lbl = document.createElement('span');
    lbl.style.cssText = [
      'font-family:' + T.fb + ';font-size:' + FS_BODY + ';',
      'font-weight:' + T.fwBold + ';',
      'color:' + (isPrimary ? T.text : T.moon) + ';',
    ].join('');
    lbl.textContent = label;

    btn.appendChild(lbl);
    btn.addEventListener('pointerup', onClick);
    return btn;
  }

  receiptRow.appendChild(makeReceiptBtn('Print', function() { handlePrint(); },  true));
  receiptRow.appendChild(makeReceiptBtn('Email', function() { handleEmail(); },  false));
  receiptRow.appendChild(makeReceiptBtn('Skip',  function() { /* no-op */ },     false));

  els.receiptRow = receiptRow;
  panel.appendChild(receiptRow);

  return panel;
}

// ─────────────────────────────────────────────────
//  RIGHT — COMPLETION SURFACE
// ─────────────────────────────────────────────────

function buildCompletionSurface() {
  var el = document.createElement('div');
  el.style.cssText = [
    'position:absolute;',
    'left:' + (RECAP_W + 1) + 'px;top:' + T.headerH + 'px;',
    'width:' + RIGHT_W + 'px;height:' + CONTENT_H + 'px;',
    'background:' + T.bg + ';',
    'display:flex;flex-direction:column;',
    'align-items:center;justify-content:center;',
    'gap:16px;',
  ].join('');

  // Success checkmark circle — T.greenWarm stroke
  var checkWrap = document.createElement('div');
  checkWrap.style.cssText = [
    'width:96px;height:96px;border-radius:50%;',
    'border:2.5px solid ' + T.greenWarm + ';',
    'display:flex;align-items:center;justify-content:center;',
    'flex-shrink:0;',
  ].join('');

  var check = document.createElement('div');
  check.style.cssText = 'font-size:40px;color:' + T.greenWarm + ';line-height:1;' + ";font-weight:" + T.fwBold + ";";
  check.textContent = '✓';
  checkWrap.appendChild(check);
  el.appendChild(checkWrap);

  // Ticket number — T.moon
  var ticket = document.createElement('div');
  ticket.style.cssText = [
    'font-family:' + T.fb + ';font-size:' + FS_TICKET + ';',
    'color:' + T.moon + ';letter-spacing:2px;',
  ].join('') + ";font-weight:" + T.fwBold + ";";
  ticket.textContent = ticketLabel();
  el.appendChild(ticket);

  // CHANGE DUE hero — cash path only, T.gold
  if (state.paymentMethod === 'cash') {
    var changeLbl = document.createElement('div');
    changeLbl.style.cssText = [
      'font-family:' + T.fb + ';font-size:' + FS_LABEL + ';',
      'font-weight:' + T.fwBold + ';color:' + T.moon + ';',
      'letter-spacing:2px;',
    ].join('');
    changeLbl.textContent = 'CHANGE DUE';
    el.appendChild(changeLbl);

    var changeHero = document.createElement('div');
    changeHero.style.cssText = [
      'font-family:' + T.fh + ';font-size:' + FS_CHANGE + ';',
      'font-weight:800;color:' + T.gold + ';line-height:1;',
    ].join('');
    changeHero.textContent = fmt(state.changeDue);
    el.appendChild(changeHero);
  }

  // Card confirmation block — card path only
  if (state.paymentMethod === 'card') {
    var cardInfo = document.createElement('div');
    cardInfo.style.cssText = 'text-align:center;';

    var cardLine = document.createElement('div');
    cardLine.style.cssText = [
      'font-family:' + T.fb + ';font-size:' + FS_BODY + ';',
      'color:' + T.elec + ';font-weight:' + T.fwBold + ';',
    ].join('');
    cardLine.textContent = state.cardBrand
      ? (state.cardBrand + '  ····' + state.cardLast4)
      : 'Card payment confirmed';
    cardInfo.appendChild(cardLine);

    if (state.tipAmount > 0) {
      var tipLine = document.createElement('div');
      tipLine.style.cssText = [
        'font-family:' + T.fb + ';font-size:' + FS_BODY + ';',
        'color:' + T.elec + ';margin-top:4px;',
      ].join('') + ";font-weight:" + T.fwBold + ";";
      tipLine.textContent = 'Tip  ' + fmt(state.tipAmount);
      cardInfo.appendChild(tipLine);
    }

    el.appendChild(cardInfo);
  }

  // Split confirmation block
  if (state.isSplit) {
    var splitInfo = document.createElement('div');
    splitInfo.style.cssText = 'text-align:center;';
    var splitLine = document.createElement('div');
    splitLine.style.cssText = [
      'font-family:' + T.fb + ';font-size:' + FS_BODY + ';',
      'color:' + T.greenWarm + ';font-weight:' + T.fwBold + ';',
    ].join('');
    splitLine.textContent = state.splitCount + '-way split complete';
    splitInfo.appendChild(splitLine);
    el.appendChild(splitInfo);
  }

  // Kitchen ticket status row
  var ktRow = document.createElement('div');
  ktRow.style.cssText = [
    'display:flex;align-items:center;gap:8px;',
    'background:' + T.well + ';border-radius:' + T.chamferSmall + 'px;',
    'padding:8px 16px;',
  ].join('');

  var ktDot = document.createElement('div');
  ktDot.style.cssText = [
    'width:8px;height:8px;border-radius:50%;',
    'background:' + T.moon + ';flex-shrink:0;',
  ].join('');

  var ktText = document.createElement('span');
  ktText.style.cssText = [
    'font-family:' + T.fb + ';font-size:' + FS_BODY + ';',
    'color:' + T.moon + ';',
  ].join('') + ";font-weight:" + T.fwBold + ";";
  ktText.textContent = 'Printing kitchen ticket…';

  els.ktDot  = ktDot;
  els.ktText = ktText;
  ktRow.appendChild(ktDot);
  ktRow.appendChild(ktText);
  el.appendChild(ktRow);

  // Auto-reset progress bar
  var progressWrap = document.createElement('div');
  progressWrap.style.cssText = [
    'width:320px;display:flex;flex-direction:column;align-items:center;gap:6px;',
  ].join('');

  var progressLabel = document.createElement('div');
  progressLabel.style.cssText = [
    'font-family:' + T.fb + ';font-size:' + FS_LABEL + ';',
    'color:' + T.moon + ';',
  ].join('') + ";font-weight:" + T.fwBold + ";";
  progressLabel.textContent = 'Auto-reset in ' + RESET_SECS + 's';
  els.progressLabel = progressLabel;

  var track = document.createElement('div');
  track.style.cssText = [
    'width:100%;height:3px;border-radius:2px;',
    'background:' + T.well + ';overflow:hidden;',
  ].join('');

  var bar = document.createElement('div');
  bar.style.cssText = [
    'height:100%;width:100%;',
    'background:' + T.green + ';',
    'transition:width 1s linear;',
  ].join('');
  els.progressBar = bar;

  track.appendChild(bar);
  progressWrap.appendChild(progressLabel);
  progressWrap.appendChild(track);
  el.appendChild(progressWrap);

  // NEW ORDER button — T.greenWarm fill
  var newOrderBtn = document.createElement('div');
  newOrderBtn.style.cssText = [
    'width:460px;height:56px;border-radius:' + T.chamferBtn + 'px;',
    'background:' + T.greenWarm + ';',
    'display:flex;align-items:center;justify-content:center;',
    'cursor:pointer;pointer-events:auto;touch-action:manipulation;',
  ].join('');

  var newOrderLbl = document.createElement('span');
  newOrderLbl.style.cssText = [
    'font-family:' + T.fh + ';font-size:' + FS_BTN_MAIN + ';',
    'font-weight:800;color:' + T.moonText + ';',
  ].join('');
  newOrderLbl.textContent = 'NEW ORDER';

  newOrderBtn.appendChild(newOrderLbl);
  newOrderBtn.addEventListener('pointerup', function() { resetToNewOrder(); });
  els.newOrderBtn = newOrderBtn;
  el.appendChild(newOrderBtn);

  return el;
}

// ─────────────────────────────────────────────────
//  KITCHEN TICKET
// ─────────────────────────────────────────────────

function setKitchenTicketStatus(success) {
  if (!els.ktDot || !els.ktText) return;
  if (success) {
    els.ktDot.style.background = T.greenWarm;
    els.ktText.style.color     = T.moon;
    els.ktText.textContent     = 'Kitchen ticket printed';
  } else {
    els.ktDot.style.background = T.verm;
    els.ktText.style.color     = T.verm;
    els.ktText.textContent     = 'Kitchen ticket failed — reprint?';
    els.ktText.style.pointerEvents  = 'auto';
    els.ktText.style.touchAction    = 'manipulation';
    els.ktText.style.cursor         = 'pointer';
    els.ktText.addEventListener('pointerup', function() {
      postKitchenTicket();
    }, { once: true });
  }
}

function postKitchenTicket() {
  var orderId = state.order && state.order.orderId;
  if (!orderId) {
    setKitchenTicketStatus(true);
    return;
  }

  fetchWithTimeout(
    '/api/v1/print/ticket/' + orderId,
    { method: 'POST' },
    5000
  )
  .then(function(res) { return res.json(); })
  .then(function(data) {
    setKitchenTicketStatus(data.ok !== false && data.status !== 'error');
  })
  .catch(function() {
    setKitchenTicketStatus(false);
  });
}

// ─────────────────────────────────────────────────
//  AUTO-RESET
// ─────────────────────────────────────────────────

function updateProgressBar() {
  if (!els.progressBar || !els.progressLabel) return;
  var pct = (state.resetSecsLeft / RESET_SECS) * 100;
  els.progressBar.style.width = pct + '%';
  els.progressLabel.textContent = state.resetSecsLeft > 0
    ? 'Auto-reset in ' + state.resetSecsLeft + 's'
    : 'Resetting…';
}

function startAutoReset() {
  state.resetSecsLeft = RESET_SECS;
  updateProgressBar();

  state.resetTimer = setInterval(function() {
    state.resetSecsLeft--;
    updateProgressBar();
    if (state.resetSecsLeft <= 0) {
      clearInterval(state.resetTimer);
      state.resetTimer = null;
      resetToNewOrder();
    }
  }, 1000);
}

// ─────────────────────────────────────────────────
//  RECEIPT ACTIONS
// ─────────────────────────────────────────────────

function handlePrint() {
  // Pause auto-reset while cashier interacts with receipt options
  if (state.resetTimer) {
    clearInterval(state.resetTimer);
    state.resetTimer = null;
    if (els.progressLabel) els.progressLabel.textContent = 'Paused';
    if (els.progressBar)   els.progressBar.style.width   = '0%';
  }

  var orderId = state.order && state.order.orderId;
  if (!orderId) { showToast('No order to print'); return; }

  fetchWithTimeout(
    '/api/v1/print/receipt/' + orderId,
    { method: 'POST' },
    5000
  )
  .then(function(res) { return res.json(); })
  .then(function(data) {
    showToast(data.status === 'queued' ? 'Receipt printing…' : 'Print failed');
  })
  .catch(function() { showToast('Print unavailable'); });
}

function handleEmail() {
  // Pause auto-reset while cashier interacts with receipt options
  if (state.resetTimer) {
    clearInterval(state.resetTimer);
    state.resetTimer = null;
    if (els.progressLabel) els.progressLabel.textContent = 'Paused';
    if (els.progressBar)   els.progressBar.style.width   = '0%';
  }

  // TODO: replace with a text-input interrupt scene when one exists
  var email = window.prompt('Email receipt to:');
  if (!email) return;
  if (!email.includes('@')) { showToast('Invalid email address'); return; }

  var orderId = state.order && state.order.orderId;
  if (!orderId) { showToast('No order to email'); return; }

  // TODO: wire to POST /api/v1/orders/{orderId}/receipt/email when endpoint exists
  showToast('Email receipt not yet configured on server');
}

function resetToNewOrder() {
  if (state.resetTimer) {
    clearInterval(state.resetTimer);
    state.resetTimer = null;
  }
  var nextTicket = ((state.order && state.order.ticketNumber) || 1) + 1;
  SceneManager.mountWorking('qsr-order', {
    ticketNumber:     nextTicket,
    cashDiscountRate: state.cashDiscountRate || (state.order && state.order.cashDiscountRate) || 0,
  });
}

// ─────────────────────────────────────────────────
//  SCENE REGISTRATION
// ─────────────────────────────────────────────────

defineScene('qsr-complete', {
  mount: function(container, params) {
    var p = params || {};
    state.order              = p.order              || {};
    state.paymentMethod      = p.paymentMethod      || 'cash';
    state.cashTotal          = p.cashTotal          || 0;
    state.tendered           = p.tendered           || 0;
    state.changeDue          = p.changeDue          || 0;
    state.cashDiscountRate   = p.cashDiscountRate   || 0;
    state.cashDiscountAmount = p.cashDiscountAmount || 0;
    state.tipAmount          = p.tipAmount          || 0;
    state.cardLast4          = p.cardLast4          || '';
    state.cardBrand          = p.cardBrand          || '';
    state.isSplit            = p.isSplit            || false;
    state.payments           = p.payments           || [];
    state.splitCount         = p.splitCount         || 0;
    state.resetSecsLeft      = RESET_SECS;
    state.resetTimer         = null;

    container.appendChild(buildReceiptPanel());
    container.appendChild(buildCompletionSurface());

    postKitchenTicket();
    startAutoReset();
  },

  unmount: function() {
    if (state.resetTimer) {
      clearInterval(state.resetTimer);
      state.resetTimer = null;
    }
    els = {};
  },
});
