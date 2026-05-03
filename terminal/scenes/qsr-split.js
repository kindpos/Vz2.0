// ═══════════════════════════════════════════════════
//  KINDpos Terminal — QSR Split Payment Scene  (Vz2.0)
//
//  Transactional scene — sits above qsr-order at z=20.
//  Auto-closed when mountWorking('qsr-complete') is called.
//  Manual cancel via closeTransactional returns to qsr-order.
//
//  Left panel (persistent across all phases):
//    Order recap (read-only, T.green accent bars)
//    Completed payments list (grows with each confirmed payment)
//    Remaining balance hero (T.gold, updates after each payment)
//    Cancel link (bottom)
//
//  Right panel (phase-driven):
//    'select'      — remaining hero + amount input + CASH / CARD buttons
//    'cash-numpad' — inline numpad (amount locked to partial amount)
//    'card-reader' — inline reader prompt (initiates payment for partial amount)
//
//  On balance reaching 0:
//    SceneManager.mountWorking('qsr-complete', { … })
//    (mountWorking auto-closes all transactionals)
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

var RECAP_W   = T.pcLeftW;               // 340
var RIGHT_W   = T.appW - RECAP_W - 1;   // 683
var CONTENT_H = T.appH - T.headerH;     // 548

var NP_W      = 380;
var CD_W      = RIGHT_W - NP_W;         // 303

var FS_LABEL  = '10px';
var FS_BODY   = '14px';
var FS_ITEM   = '14px';
var FS_HERO   = T.fsHero;   // 56px
var FS_REMAIN = T.fsH2;     // 44px
var FS_BTN    = '14px';
var FS_KEY    = '26px';
var FS_STATUS = '11px';

// ─────────────────────────────────────────────────
//  STATE
// ─────────────────────────────────────────────────

var state = {
  order:               null,
  total:               0,
  cashDiscountRate:    0,
  remaining:           0,
  payments:            [],
  // { method, amount, tendered?, changeDue?,
  //   tip_amount?, cardLast4?, cardBrand? }
  phase:               'select',
  splitAmountRaw:      '',
  currentSplitAmount:  0,
  tenderedRaw:         '',
  tendered:            0,
  changeDue:           0,
  readerPending:       false,
  cancelFn:            null,
  equalSplitCount:     0,      // 0 = manual mode, 2+ = equal split active
  equalSplitAmounts:   [],     // pre-calculated per-person amounts (last absorbs rounding)
};

var els = {};

// ─────────────────────────────────────────────────
//  FINANCE HELPERS
// ─────────────────────────────────────────────────

function moneyRound(x) { return Math.round(x * 100) / 100; }

function computeRemaining() {
  var paid = state.payments.reduce(function(s, p) {
    return moneyRound(s + (Number(p.amount) || 0));
  }, 0);
  state.remaining = moneyRound(state.total - paid);
  if (state.remaining < 0) state.remaining = 0;
}

function parseTendered(raw) {
  if (!raw) return 0;
  return moneyRound(parseInt(raw, 10) / 100);
}

function buildCashPresets(amount) {
  var bills = [1, 2, 5, 10, 20, 50, 100];
  var presets = [{ label: 'EXACT', amount: amount, isExact: true }];
  var count = 0;
  for (var i = 0; i < bills.length && count < 3; i++) {
    if (bills[i] > amount) {
      presets.push({ label: '$' + bills[i], amount: bills[i] });
      count++;
    }
  }
  return presets;
}

function ticketLabel() {
  var n = (state.order && state.order.ticketNumber) || 1;
  var s = String(n);
  var out = '';
  while (out.length + s.length < 3) out += '0';
  return 'QS-' + out + s;
}

// ─────────────────────────────────────────────────
//  LEFT PANEL — PERSISTENT ACROSS ALL PHASES
// ─────────────────────────────────────────────────

function buildLeftPanel() {
  var panel = document.createElement('div');
  panel.style.cssText = [
    'position:absolute;left:0;top:' + T.headerH + 'px;',
    'width:' + RECAP_W + 'px;height:' + CONTENT_H + 'px;',
    'background:' + T.card + ';',
    'border-right:1px solid ' + T.border + ';',
    'display:flex;flex-direction:column;overflow:hidden;',
  ].join('');

  var hdr = document.createElement('div');
  hdr.style.cssText = [
    'height:44px;background:' + T.well + ';flex-shrink:0;',
    'border-bottom:2px solid ' + darkenHex(T.bg, 0.2) + ';',
    'display:flex;align-items:center;padding:8px 16px;',
    'justify-content:space-between;box-sizing:border-box;',
  ].join('');
  var hdrLabel = document.createElement('span');
  hdrLabel.style.cssText = 'font-family:' + T.fh + ';font-size:' + T.fsB2 +
    ';font-weight:' + T.fwBold + ';color:' + T.green + ';letter-spacing:0.15em;text-transform:uppercase;';
  hdrLabel.textContent = 'SPLIT  ' + ticketLabel();
  hdr.appendChild(hdrLabel);
  panel.appendChild(hdr);

  var splitProgressLabel = document.createElement('div');
  splitProgressLabel.style.cssText = [
    'padding:4px 16px;flex-shrink:0;',
    'font-family:' + T.fb + ';font-size:' + FS_LABEL + ';color:' + T.moon + ';',
  ].join('') + ";font-weight:" + T.fwBold + ";";
  splitProgressLabel.style.display = state.equalSplitCount >= 2 ? '' : 'none';
  splitProgressLabel.textContent = state.equalSplitCount >= 2
    ? 'Split ' + state.equalSplitCount + ' ways — ' +
      state.payments.length + ' of ' + state.equalSplitCount + ' paid'
    : '';
  els.splitProgressLabel = splitProgressLabel;
  panel.appendChild(splitProgressLabel);

  var itemList = document.createElement('div');
  itemList.style.cssText = [
    'padding:10px 12px;flex-shrink:0;',
    'display:flex;flex-direction:column;gap:5px;',
    'border-bottom:1px solid ' + T.border + ';',
  ].join('');
  var bevelLt = _lighten(T.bg, 0.08);
  var bevelDk = darkenHex(T.bg, 0.2);
  (state.order.items || []).forEach(function(item) {
    var row = document.createElement('div');
    row.style.cssText = [
      'background:' + T.well + ';',
      'border-radius:8px;',
      'border-top:2px solid ' + bevelLt + ';',
      'border-right:2px solid ' + bevelDk + ';',
      'border-bottom:2px solid ' + bevelDk + ';',
      'border-left:3px solid ' + T.moon + ';',
      'padding:6px 10px;display:flex;justify-content:space-between;align-items:center;',
    ].join('');
    var name = document.createElement('span');
    name.style.cssText = 'font-family:' + T.fb + ';font-size:' + FS_ITEM +
      ';font-weight:' + T.fwBold + ';color:' + T.text + ';';
    name.textContent = (item.qty > 1 ? item.qty + '× ' : '') + item.name;
    var price = document.createElement('span');
    price.style.cssText = 'font-family:' + T.fb + ';font-size:' + FS_ITEM +
      ';font-weight:' + T.fwBold + ';color:' + (item.price > 0 ? T.gold : T.moon) + ';flex-shrink:0;';
    price.textContent = item.price > 0 ? fmt(moneyRound(item.price * (item.qty || 1))) : '—';
    row.appendChild(name); row.appendChild(price);
    itemList.appendChild(row);
  });
  var totalRow = document.createElement('div');
  totalRow.style.cssText = 'display:flex;justify-content:space-between;padding:6px 0 0;';
  var totalLbl = document.createElement('span');
  totalLbl.style.cssText = 'font-family:' + T.fb + ';font-size:' + FS_BODY +
    ';font-weight:' + T.fwBold + ';color:' + T.text + ';';
  totalLbl.textContent = 'Total';
  var totalVal = document.createElement('span');
  totalVal.style.cssText = 'font-family:' + T.fb + ';font-size:' + FS_BODY +
    ';font-weight:' + T.fwBold + ';color:' + T.gold + ';';
  totalVal.textContent = fmt(state.total);
  totalRow.appendChild(totalLbl); totalRow.appendChild(totalVal);
  itemList.appendChild(totalRow);
  panel.appendChild(itemList);

  var paidList = document.createElement('div');
  paidList.style.cssText = [
    'padding:8px 12px;flex-shrink:0;',
    'display:flex;flex-direction:column;gap:4px;',
  ].join('');
  els.paidList = paidList;
  panel.appendChild(paidList);

  var divEl = document.createElement('div');
  divEl.style.cssText = 'height:1px;background:' + T.border + ';margin:0 12px;flex-shrink:0;';
  els.remainDivider = divEl;
  panel.appendChild(divEl);

  var remainWrap = document.createElement('div');
  remainWrap.style.cssText = 'padding:10px 16px;flex-shrink:0;';
  var remainLbl = document.createElement('div');
  remainLbl.style.cssText = 'font-family:' + T.fb + ';font-size:' + FS_LABEL +
    ';font-weight:' + T.fwBold + ';color:' + T.moon + ';letter-spacing:2px;margin-bottom:4px;';
  remainLbl.textContent = 'REMAINING';
  var remainVal = document.createElement('div');
  remainVal.style.cssText = 'font-family:' + T.fh + ';font-size:' + FS_REMAIN +
    ';font-weight:800;color:' + T.gold + ';';
  remainVal.textContent = fmt(state.remaining);
  els.remainVal = remainVal;
  remainWrap.appendChild(remainLbl);
  remainWrap.appendChild(remainVal);
  panel.appendChild(remainWrap);

  var spacer = document.createElement('div');
  spacer.style.flex = '1';
  panel.appendChild(spacer);

  var cancelLink = document.createElement('div');
  cancelLink.style.cssText = [
    'padding:12px 16px;font-family:' + T.fb + ';',
    'font-size:' + FS_LABEL + ';color:' + T.moon + ';',
    'cursor:pointer;pointer-events:auto;touch-action:manipulation;',
    'border-top:1px solid ' + T.border + ';',
  ].join('') + ";font-weight:" + T.fwBold + ";";
  cancelLink.textContent = '← cancel split';
  cancelLink.addEventListener('pointerup', function() { handleCancel(); });
  panel.appendChild(cancelLink);

  return panel;
}

function updateLeftPanel() {
  els.paidList.innerHTML = '';
  state.payments.forEach(function(p, i) {
    var row = document.createElement('div');
    row.style.cssText = [
      'display:flex;justify-content:space-between;align-items:center;',
      'background:' + T.well + ';',
      'border-radius:8px;',
      'border-top:2px solid ' + _lighten(T.bg, 0.08) + ';',
      'border-right:2px solid ' + darkenHex(T.bg, 0.2) + ';',
      'border-bottom:2px solid ' + darkenHex(T.bg, 0.2) + ';',
      'border-left:3px solid ' + T.greenWarm + ';',
      'padding:6px 10px;',
    ].join('');
    var lbl = document.createElement('span');
    lbl.style.cssText = 'font-family:' + T.fb + ';font-size:' + FS_BODY +
      ';color:' + T.greenWarm + ';' + ";font-weight:" + T.fwBold + ";";
    var methodLabel = p.method === 'card'
      ? ('Card' + (p.cardLast4 ? ' ····' + p.cardLast4 : ''))
      : 'Cash';
    lbl.textContent = 'Payment ' + (i + 1) + '  ' + methodLabel + '  ✓';
    var val = document.createElement('span');
    val.style.cssText = 'font-family:' + T.fb + ';font-size:' + FS_BODY +
      ';font-weight:' + T.fwBold + ';color:' + T.greenWarm + ';';
    val.textContent = fmt(p.amount);
    row.appendChild(lbl); row.appendChild(val);
    els.paidList.appendChild(row);
  });
  computeRemaining();
  els.remainVal.textContent = fmt(state.remaining);
  if (state.remaining <= 0) {
    els.remainVal.style.color = T.greenWarm;
    els.remainVal.textContent = 'Paid in full';
  }
  if (els.splitProgressLabel && state.equalSplitCount >= 2) {
    els.splitProgressLabel.textContent = 'Split ' + state.equalSplitCount + ' ways — ' +
      state.payments.length + ' of ' + state.equalSplitCount + ' paid';
    els.splitProgressLabel.style.display = '';
  }
}

// ─────────────────────────────────────────────────
//  CANCEL (full abort — left panel link)
// ─────────────────────────────────────────────────

function handleCancel() {
  if (state.cancelFn) { state.cancelFn(); state.cancelFn = null; }
  SceneManager.closeTransactional('qsr-split');
}

// ─────────────────────────────────────────────────
//  PHASE ROUTER
// ─────────────────────────────────────────────────

function renderPhase() {
  els.rightPanel.innerHTML = '';
  if (state.phase === 'select')      els.rightPanel.appendChild(buildSelectPhase());
  if (state.phase === 'cash-numpad') els.rightPanel.appendChild(buildCashNumpadPhase());
  if (state.phase === 'card-reader') {
    els.rightPanel.appendChild(buildCardReaderPhase());
    initiateCardPayment();
  }
}

// ─────────────────────────────────────────────────
//  SELECT PHASE
// ─────────────────────────────────────────────────

function getSplitAmount() {
  return state.splitAmountRaw ? parseTendered(state.splitAmountRaw) : state.remaining;
}

function handleSplitKey(key) {
  if (key === 'CLR') {
    state.splitAmountRaw = '';
  } else if (state.splitAmountRaw.length < 7) {
    state.splitAmountRaw += key;
  }
  var amt = getSplitAmount();
  if (els.splitAmountDisplay) els.splitAmountDisplay.textContent = fmt(amt);
  if (els.cashBtnSub)         els.cashBtnSub.textContent         = fmt(amt);
  if (els.cardBtnSub)         els.cardBtnSub.textContent         = fmt(amt);
}

function calcEqualSplit(n) {
  if (n < 2) return [];
  var base = moneyRound(Math.floor(state.total * 100 / n) / 100);
  var amounts = [];
  var allocated = 0;
  for (var i = 0; i < n - 1; i++) {
    amounts.push(base);
    allocated = moneyRound(allocated + base);
  }
  amounts.push(moneyRound(state.total - allocated));
  return amounts;
}

function getConfirmedAmount() {
  if (state.equalSplitCount >= 2) {
    var idx = state.payments.length;
    return state.equalSplitAmounts[idx] || state.remaining;
  }
  return state.splitAmountRaw
    ? parseTendered(state.splitAmountRaw)
    : state.remaining;
}

function buildSelectPhase() {
  var phase = document.createElement('div');
  phase.style.cssText = [
    'width:100%;height:100%;',
    'display:flex;flex-direction:column;align-items:center;',
    'justify-content:flex-start;padding-top:20px;',
    'box-sizing:border-box;overflow:hidden;',
  ].join('');

  var col = document.createElement('div');
  col.style.cssText = [
    'display:flex;flex-direction:column;align-items:center;gap:10px;',
    'width:320px;',
  ].join('');

  // a) Remaining hero
  var remBlock = document.createElement('div');
  remBlock.style.cssText = 'display:flex;flex-direction:column;align-items:center;gap:2px;';
  var remLbl = document.createElement('div');
  remLbl.style.cssText = 'font-family:' + T.fb + ';font-size:' + FS_LABEL +
    ';font-weight:' + T.fwBold + ';color:' + T.moon + ';letter-spacing:2px;';
  remLbl.textContent = 'REMAINING';
  var remAmt = document.createElement('div');
  remAmt.style.cssText = 'font-family:' + T.fh + ';font-size:' + FS_HERO +
    ';font-weight:800;color:' + T.gold + ';line-height:1;';
  remAmt.textContent = fmt(state.remaining);
  remBlock.appendChild(remLbl);
  remBlock.appendChild(remAmt);
  col.appendChild(remBlock);

  // --- Equal split section ---
  var equalSection = document.createElement('div');
  equalSection.style.cssText = 'display:flex;flex-direction:column;gap:6px;width:100%;';

  var eqLbl = document.createElement('div');
  eqLbl.style.cssText = 'font-family:' + T.fb + ';font-size:' + FS_LABEL +
    ';font-weight:' + T.fwBold + ';color:' + T.moon + ';letter-spacing:2px;';
  eqLbl.textContent = 'SPLIT EQUALLY';
  equalSection.appendChild(eqLbl);

  var stepRow = document.createElement('div');
  stepRow.style.cssText = 'display:flex;align-items:center;gap:8px;width:100%;';

  var minusBtn = document.createElement('div');
  minusBtn.style.cssText = [
    'width:40px;height:40px;border-radius:' + T.chamferBtn + 'px;',
    'background:' + T.well + ';border:1px solid ' + T.border + ';',
    'display:flex;align-items:center;justify-content:center;',
    'cursor:pointer;pointer-events:auto;touch-action:manipulation;',
  ].join('');
  var minusLbl = document.createElement('span');
  minusLbl.style.cssText = 'font-family:' + T.fb + ';font-size:18px;color:' + T.moon + ';' + ";font-weight:" + T.fwBold + ";";
  minusLbl.textContent = '−';
  minusBtn.appendChild(minusLbl);
  els.splitMinusBtn = minusBtn;

  var countDisplay = document.createElement('div');
  countDisplay.style.cssText = [
    'flex:1;text-align:center;',
    'font-family:' + T.fh + ';font-size:' + FS_BODY + ';',
    'font-weight:' + T.fwBold + ';color:' + T.text + ';',
  ].join('');
  countDisplay.textContent = state.equalSplitCount >= 2
    ? '÷ ' + state.equalSplitCount + ' ways'
    : '÷ — ways';
  els.splitCountDisplay = countDisplay;

  var plusBtn = document.createElement('div');
  plusBtn.style.cssText = [
    'width:40px;height:40px;border-radius:' + T.chamferBtn + 'px;',
    'background:' + T.well + ';border:1px solid ' + T.border + ';',
    'display:flex;align-items:center;justify-content:center;',
    'cursor:pointer;pointer-events:auto;touch-action:manipulation;',
  ].join('');
  var plusLbl = document.createElement('span');
  plusLbl.style.cssText = 'font-family:' + T.fb + ';font-size:18px;color:' + T.moon + ';' + ";font-weight:" + T.fwBold + ";";
  plusLbl.textContent = '+';
  plusBtn.appendChild(plusLbl);
  els.splitPlusBtn = plusBtn;

  stepRow.appendChild(minusBtn);
  stepRow.appendChild(countDisplay);
  stepRow.appendChild(plusBtn);
  equalSection.appendChild(stepRow);

  var perPersonDisplay = document.createElement('div');
  perPersonDisplay.style.cssText = 'font-family:' + T.fb + ';font-size:' + FS_BODY +
    ';color:' + T.gold + ';text-align:center;' + ";font-weight:" + T.fwBold + ";";
  perPersonDisplay.style.display = state.equalSplitCount >= 2 ? '' : 'none';
  perPersonDisplay.textContent = state.equalSplitCount >= 2
    ? '~' + fmt(state.equalSplitAmounts[0] || 0) + ' per person'
    : '';
  els.perPersonDisplay = perPersonDisplay;
  equalSection.appendChild(perPersonDisplay);

  var applyBtn = document.createElement('div');
  applyBtn.style.cssText = [
    'width:100%;min-height:40px;',
    'background:' + T.card + ';border:1.5px solid ' + T.green + ';',
    'border-radius:' + T.chamferBtn + 'px;',
    'display:flex;align-items:center;justify-content:center;',
    'cursor:pointer;pointer-events:auto;touch-action:manipulation;',
  ].join('');
  applyBtn.style.display = state.equalSplitCount >= 2 ? '' : 'none';
  var applyLbl = document.createElement('span');
  applyLbl.style.cssText = 'font-family:' + T.fb + ';font-size:' + FS_BTN +
    ';font-weight:' + T.fwBold + ';color:' + T.green + ';';
  applyLbl.textContent = 'USE EQUAL SPLIT';
  applyBtn.appendChild(applyLbl);
  els.applyBtn = applyBtn;
  equalSection.appendChild(applyBtn);

  var dividerWrap = document.createElement('div');
  dividerWrap.style.cssText = 'display:flex;align-items:center;gap:8px;width:100%;';
  var divLeft = document.createElement('div');
  divLeft.style.cssText = 'flex:1;height:1px;background:' + T.border + ';';
  var divLabel = document.createElement('span');
  divLabel.style.cssText = 'font-family:' + T.fb + ';font-size:' + FS_LABEL +
    ';color:' + T.moon + ';white-space:nowrap;' + ";font-weight:" + T.fwBold + ";";
  divLabel.textContent = 'OR ENTER AMOUNT';
  var divRight = document.createElement('div');
  divRight.style.cssText = 'flex:1;height:1px;background:' + T.border + ';';
  dividerWrap.appendChild(divLeft);
  dividerWrap.appendChild(divLabel);
  dividerWrap.appendChild(divRight);
  equalSection.appendChild(dividerWrap);

  col.appendChild(equalSection);

  function updateStepperState() {
    var n = state.equalSplitCount;
    var isMinDisabled = n <= 2;
    var isPlusDisabled = n >= 8;
    minusBtn.style.opacity      = isMinDisabled  ? '0.35' : '1';
    minusBtn.style.pointerEvents = isMinDisabled  ? 'none' : 'auto';
    plusBtn.style.opacity       = isPlusDisabled ? '0.35' : '1';
    plusBtn.style.pointerEvents  = isPlusDisabled ? 'none' : 'auto';
  }
  updateStepperState();

  function onEqualSplitChange() {
    var n = state.equalSplitCount;
    countDisplay.textContent = n >= 2 ? '÷ ' + n + ' ways' : '÷ — ways';
    var firstAmt = state.equalSplitAmounts[0] || 0;
    perPersonDisplay.textContent = n >= 2 ? '~' + fmt(firstAmt) + ' per person' : '';
    perPersonDisplay.style.display = n >= 2 ? '' : 'none';
    applyBtn.style.display = n >= 2 ? '' : 'none';
    updateStepperState();
    if (els.splitProgressLabel && n >= 2) {
      els.splitProgressLabel.textContent = 'Split ' + n + ' ways — ' +
        state.payments.length + ' of ' + n + ' paid';
      els.splitProgressLabel.style.display = '';
    }
  }

  minusBtn.addEventListener('pointerup', function() {
    if (state.equalSplitCount <= 2) return;
    state.equalSplitCount--;
    state.equalSplitAmounts = calcEqualSplit(state.equalSplitCount);
    onEqualSplitChange();
  });

  plusBtn.addEventListener('pointerup', function() {
    var newN = state.equalSplitCount < 2 ? 2 : state.equalSplitCount + 1;
    if (newN > 8) return;
    state.equalSplitCount = newN;
    state.equalSplitAmounts = calcEqualSplit(state.equalSplitCount);
    onEqualSplitChange();
  });

  applyBtn.addEventListener('pointerup', function() {
    var idx = state.payments.length;
    var amt = state.equalSplitAmounts[idx] !== undefined
      ? state.equalSplitAmounts[idx]
      : state.remaining;
    state.currentSplitAmount = amt;
    if (els.splitAmountDisplay) els.splitAmountDisplay.textContent = fmt(amt);
    if (els.cashBtnSub)         els.cashBtnSub.textContent         = fmt(amt);
    if (els.cardBtnSub)         els.cardBtnSub.textContent         = fmt(amt);
  });

  // b) THIS PAYMENT entry row
  var entryBlock = document.createElement('div');
  entryBlock.style.cssText = 'display:flex;flex-direction:column;gap:4px;width:100%;';
  var entryLbl = document.createElement('div');
  entryLbl.style.cssText = 'font-family:' + T.fb + ';font-size:' + FS_LABEL +
    ';font-weight:' + T.fwBold + ';color:' + T.moon + ';letter-spacing:2px;';
  entryLbl.textContent = 'THIS PAYMENT';
  var entryBox = document.createElement('div');
  entryBox.style.cssText = [
    'background:' + T.well + ';border:1px solid ' + T.border + ';',
    'border-radius:' + T.chamferCard + 'px;',
    'padding:10px 16px;',
    'display:flex;justify-content:space-between;align-items:center;',
  ].join('');
  var entryHint = document.createElement('span');
  entryHint.style.cssText = 'font-family:' + T.fb + ';font-size:' + FS_BODY +
    ';color:' + T.moon + ';' + ";font-weight:" + T.fwBold + ";";
  entryHint.textContent = 'Amount';
  var entryAmt = document.createElement('span');
  entryAmt.style.cssText = 'font-family:' + T.fb + ';font-size:22px;' +
    'font-weight:' + T.fwBold + ';color:' + T.text + ';';
  entryAmt.textContent = fmt(state.remaining);
  els.splitAmountDisplay = entryAmt;
  entryBox.appendChild(entryHint);
  entryBox.appendChild(entryAmt);
  entryBlock.appendChild(entryLbl);
  entryBlock.appendChild(entryBox);
  col.appendChild(entryBlock);

  // c) Mini-numpad (3-col, 50px keys, CLR + digits, no ENT)
  var miniNP = document.createElement('div');
  miniNP.style.cssText = 'display:grid;grid-template-columns:repeat(3,1fr);gap:6px;width:100%;';

  [['7','8','9'],['4','5','6'],['1','2','3'],['CLR','0','']].forEach(function(row) {
    row.forEach(function(k) {
      var key = document.createElement('div');
      if (k === '') {
        key.style.cssText = 'min-height:50px;visibility:hidden;';
        miniNP.appendChild(key);
        return;
      }
      key.style.cssText = [
        'min-height:50px;border-radius:' + T.chamferKey + 'px;',
        'display:flex;align-items:center;justify-content:center;',
        'cursor:pointer;pointer-events:auto;touch-action:manipulation;',
        'transition:' + T.transitionFast + ';',
      ].join('');
      var lbl = document.createElement('span');
      if (k === 'CLR') {
        key.style.cssText += 'background:' + T.well + ';border:1.5px solid ' + T.verm + ';';
        lbl.style.cssText = 'font-family:' + T.fb + ';font-size:' + FS_BTN +
          ';font-weight:' + T.fwBold + ';color:' + T.verm + ';letter-spacing:0.05em;';
        lbl.textContent = 'CLR';
      } else {
        key.style.cssText += 'background:' + T.well + ';border:1px solid ' + T.border + ';';
        lbl.style.cssText = 'font-family:' + T.fh + ';font-size:' + FS_KEY +
          ';font-weight:' + T.fwBold + ';color:' + T.green + ';';
        lbl.textContent = k;
      }
      key.addEventListener('pointerdown', function() { key.style.opacity = '0.7'; });
      var restore = function() { key.style.opacity = '1'; };
      key.addEventListener('pointerup', restore);
      key.addEventListener('pointerleave', restore);
      key.addEventListener('pointercancel', restore);
      key.addEventListener('pointerup', function() { handleSplitKey(k); });
      key.appendChild(lbl);
      miniNP.appendChild(key);
    });
  });
  col.appendChild(miniNP);

  // d) Payment method buttons (CASH / CARD)
  var cashBtn = document.createElement('div');
  cashBtn.style.cssText = [
    'width:100%;min-height:56px;background:' + T.greenWarm + ';',
    'border-radius:' + T.chamferBtn + 'px;',
    'display:flex;flex-direction:column;align-items:center;justify-content:center;gap:2px;',
    'cursor:pointer;pointer-events:auto;touch-action:manipulation;',
    'transition:' + T.transitionFast + ';',
  ].join('');
  var cashLbl = document.createElement('span');
  cashLbl.style.cssText = 'font-family:' + T.fh + ';font-size:' + FS_BTN +
    ';font-weight:' + T.fwBold + ';color:' + T.moonText + ';letter-spacing:0.05em;';
  cashLbl.textContent = 'CASH';
  var cashSub = document.createElement('span');
  cashSub.style.cssText = 'font-family:' + T.fb + ';font-size:12px;color:' + T.greenWarmDk + ';' + ";font-weight:" + T.fwBold + ";";
  cashSub.textContent = fmt(getSplitAmount());
  els.cashBtnSub = cashSub;
  cashBtn.appendChild(cashLbl);
  cashBtn.appendChild(cashSub);
  cashBtn.addEventListener('pointerdown', function() { cashBtn.style.opacity = '0.8'; });
  var rcash = function() { cashBtn.style.opacity = '1'; };
  cashBtn.addEventListener('pointerup', rcash);
  cashBtn.addEventListener('pointerleave', rcash);
  cashBtn.addEventListener('pointerup', function() {
    var amt = getConfirmedAmount();
    if (amt <= 0 || amt > state.remaining) { showToast('Invalid payment amount'); return; }
    state.currentSplitAmount = amt;
    state.tenderedRaw = '';
    state.tendered = 0;
    state.changeDue = 0;
    state.phase = 'cash-numpad';
    renderPhase();
  });
  col.appendChild(cashBtn);

  var cardBtn = document.createElement('div');
  cardBtn.style.cssText = [
    'width:100%;min-height:56px;background:' + T.elec + ';',
    'border-radius:' + T.chamferBtn + 'px;',
    'display:flex;flex-direction:column;align-items:center;justify-content:center;gap:2px;',
    'cursor:pointer;pointer-events:auto;touch-action:manipulation;',
    'transition:' + T.transitionFast + ';',
  ].join('');
  var cardLbl = document.createElement('span');
  cardLbl.style.cssText = 'font-family:' + T.fh + ';font-size:' + FS_BTN +
    ';font-weight:' + T.fwBold + ';color:' + T.moonText + ';letter-spacing:0.05em;';
  cardLbl.textContent = 'CARD';
  var cardSub = document.createElement('span');
  cardSub.style.cssText = 'font-family:' + T.fb + ';font-size:12px;color:' + T.elecDk + ';' + ";font-weight:" + T.fwBold + ";";
  cardSub.textContent = fmt(getSplitAmount());
  els.cardBtnSub = cardSub;
  cardBtn.appendChild(cardLbl);
  cardBtn.appendChild(cardSub);
  cardBtn.addEventListener('pointerdown', function() { cardBtn.style.opacity = '0.8'; });
  var rcard = function() { cardBtn.style.opacity = '1'; };
  cardBtn.addEventListener('pointerup', rcard);
  cardBtn.addEventListener('pointerleave', rcard);
  cardBtn.addEventListener('pointerup', function() {
    var amt = getConfirmedAmount();
    if (amt <= 0 || amt > state.remaining) { showToast('Invalid payment amount'); return; }
    state.currentSplitAmount = amt;
    state.phase = 'card-reader';
    renderPhase();
  });
  col.appendChild(cardBtn);

  phase.appendChild(col);
  return phase;
}

// ─────────────────────────────────────────────────
//  CASH-NUMPAD PHASE
// ─────────────────────────────────────────────────

function buildCashNumpadPhase() {
  var phase = document.createElement('div');
  phase.style.cssText = 'width:100%;height:100%;display:flex;flex-direction:column;overflow:hidden;';

  // Label strip
  var strip = document.createElement('div');
  strip.style.cssText = [
    'padding:6px ' + T.scenePad + 'px;flex-shrink:0;',
    'background:' + T.well + ';border-bottom:1px solid ' + T.border + ';',
    'display:flex;align-items:center;',
  ].join('');
  var stripLbl = document.createElement('span');
  stripLbl.style.cssText = 'font-family:' + T.fb + ';font-size:' + FS_LABEL +
    ';font-weight:' + T.fwBold + ';color:' + T.green + ';letter-spacing:2px;';
  stripLbl.textContent = 'COLLECTING CASH  (payment ' + (state.payments.length + 1) + ')';
  strip.appendChild(stripLbl);
  phase.appendChild(strip);

  // Amount due block (centered)
  var totalBlock = document.createElement('div');
  totalBlock.style.cssText = [
    'padding:12px ' + T.scenePad + 'px;',
    'display:flex;flex-direction:column;align-items:center;gap:4px;flex-shrink:0;',
  ].join('');
  var totalLbl = document.createElement('span');
  totalLbl.style.cssText = 'font-family:' + T.fb + ';font-size:' + FS_LABEL +
    ';color:' + T.moon + ';letter-spacing:2px;text-transform:uppercase;' + ";font-weight:" + T.fwBold + ";";
  totalLbl.textContent = 'AMOUNT DUE';
  var totalHero = document.createElement('span');
  totalHero.style.cssText = 'font-family:' + T.fh + ';font-size:' + FS_HERO +
    ';font-weight:800;color:' + T.gold + ';line-height:1;';
  totalHero.textContent = fmt(state.currentSplitAmount);
  totalBlock.appendChild(totalLbl);
  totalBlock.appendChild(totalHero);
  phase.appendChild(totalBlock);

  // Tendered row
  var tendRow = document.createElement('div');
  tendRow.style.cssText = [
    'margin:0 ' + T.scenePad + 'px 4px;',
    'background:' + T.well + ';border:1px solid ' + T.border + ';',
    'border-radius:' + T.chamferCard + 'px;padding:10px 16px;',
    'display:flex;justify-content:space-between;align-items:center;flex-shrink:0;',
  ].join('');
  var tendLbl = document.createElement('span');
  tendLbl.style.cssText = 'font-family:' + T.fb + ';font-size:' + FS_BODY +
    ';color:' + T.moon + ';' + ";font-weight:" + T.fwBold + ";";
  tendLbl.textContent = 'Tendered';
  var tendDisplay = document.createElement('span');
  tendDisplay.style.cssText = 'font-family:' + T.fb + ';font-size:22px;' +
    'font-weight:' + T.fwBold + ';color:' + T.text + ';';
  tendDisplay.textContent = '—';
  els.tenderedDisplay = tendDisplay;
  tendRow.appendChild(tendLbl);
  tendRow.appendChild(tendDisplay);
  phase.appendChild(tendRow);

  // Quick amounts
  var quickWrap = document.createElement('div');
  quickWrap.style.cssText = [
    'padding:6px ' + T.scenePad + 'px 4px;',
    'display:flex;flex-direction:column;gap:6px;flex-shrink:0;',
  ].join('');
  var quickLbl = document.createElement('span');
  quickLbl.style.cssText = 'font-family:' + T.fb + ';font-size:' + FS_LABEL +
    ';color:' + T.green + ';letter-spacing:2px;text-transform:uppercase;' + ";font-weight:" + T.fwBold + ";";
  quickLbl.textContent = 'QUICK AMOUNTS';
  quickWrap.appendChild(quickLbl);
  var tilesRow = document.createElement('div');
  tilesRow.style.cssText = 'display:flex;gap:8px;';
  buildCashPresets(state.currentSplitAmount).forEach(function(p) {
    var tile = document.createElement('div');
    if (p.isExact) {
      tile.style.cssText = [
        'flex:1;background:' + T.well + ';border:1.5px solid ' + T.greenWarm + ';',
        'border-radius:' + T.chamferBtn + 'px;padding:8px 6px;',
        'display:flex;flex-direction:column;align-items:center;gap:2px;',
        'cursor:pointer;pointer-events:auto;touch-action:manipulation;',
      ].join('');
      var tl = document.createElement('span');
      tl.style.cssText = 'font-family:' + T.fb + ';font-size:10px;' +
        'font-weight:' + T.fwBold + ';color:' + T.greenWarm + ';text-transform:uppercase;';
      tl.textContent = 'EXACT';
      var bl = document.createElement('span');
      bl.style.cssText = 'font-family:' + T.fb + ';font-size:' + FS_BODY + ';color:' + T.greenWarm + ';' + ";font-weight:" + T.fwBold + ";";
      bl.textContent = fmt(p.amount);
      tile.appendChild(tl); tile.appendChild(bl);
    } else {
      tile.style.cssText = [
        'flex:1;background:' + T.well + ';border:1px solid ' + T.border + ';',
        'border-radius:' + T.chamferBtn + 'px;padding:8px 6px;',
        'display:flex;align-items:center;justify-content:center;',
        'cursor:pointer;pointer-events:auto;touch-action:manipulation;',
      ].join('');
      var tl2 = document.createElement('span');
      tl2.style.cssText = 'font-family:' + T.fb + ';font-size:' + FS_BODY +
        ';font-weight:' + T.fwBold + ';color:' + T.text + ';';
      tl2.textContent = p.label;
      tile.appendChild(tl2);
    }
    tile.addEventListener('pointerup', function() {
      state.tenderedRaw = String(Math.round(p.amount * 100));
      renderCashDisplay();
    });
    tilesRow.appendChild(tile);
  });
  quickWrap.appendChild(tilesRow);
  phase.appendChild(quickWrap);

  // Divider
  var divider = document.createElement('div');
  divider.style.cssText = 'height:1px;background:' + T.border + ';margin:4px 0;flex-shrink:0;';
  phase.appendChild(divider);

  // Bottom section — numpad left, change-due right
  var bottom = document.createElement('div');
  bottom.style.cssText = 'flex:1;position:relative;min-height:0;';

  var np = document.createElement('div');
  np.style.cssText = [
    'position:absolute;left:' + T.scenePad + 'px;top:0;',
    'width:' + (NP_W - T.scenePad * 2) + 'px;',
    'display:grid;grid-template-columns:repeat(3,1fr);gap:8px;padding:4px 0;',
  ].join('');

  var npBevelLt = _lighten(T.bg, 0.08);
  var npBevelDk = darkenHex(T.bg, 0.2);
  var npDigitDk = darkenHex(T.well, 0.3);

  [['7','8','9'],['4','5','6'],['1','2','3'],['CLR','0','ENT']].forEach(function(row) {
    row.forEach(function(k) {
      var key = document.createElement('div');
      var dk;
      key.style.cssText = [
        'min-height:66px;border-radius:' + T.chamferKey + 'px;',
        'display:flex;align-items:center;justify-content:center;',
        'cursor:pointer;pointer-events:auto;touch-action:manipulation;',
        'transition:transform 0.07s, box-shadow 0.07s;',
      ].join('');
      var lbl = document.createElement('span');
      if (k === 'CLR') {
        dk = darkenHex(T.verm, 0.25);
        key.style.cssText += 'background:' + T.well + ';border:1.5px solid ' + T.verm + ';box-shadow:0 3px 0 ' + dk + ';';
        lbl.style.cssText = 'font-family:' + T.fb + ';font-size:' + FS_BTN +
          ';font-weight:' + T.fwBold + ';color:' + T.verm + ';letter-spacing:0.05em;';
        lbl.textContent = 'CLR';
      } else if (k === 'ENT') {
        dk = darkenHex(T.greenWarm, 0.25);
        key.style.cssText += 'background:' + T.greenWarm + ';box-shadow:0 3px 0 ' + dk + ';';
        lbl.style.cssText = 'font-family:' + T.fb + ';font-size:' + FS_BTN +
          ';font-weight:' + T.fwBold + ';color:' + T.well + ';letter-spacing:0.05em;';
        lbl.textContent = 'ENT';
      } else {
        dk = npDigitDk;
        key.style.cssText += [
          'background:' + T.well + ';',
          'border-top:2px solid ' + npBevelLt + ';',
          'border-right:2px solid ' + npBevelDk + ';',
          'border-bottom:2px solid ' + npBevelDk + ';',
          'border-left:2px solid ' + npBevelLt + ';',
          'box-shadow:0 3px 0 ' + dk + ';',
        ].join('');
        lbl.style.cssText = 'font-family:' + T.fh + ';font-size:' + FS_KEY +
          ';font-weight:' + T.fwBold + ';color:' + T.green + ';';
        lbl.textContent = k;
      }
      (function(_dk) {
        key.addEventListener('pointerdown', function() {
          key.style.transform = 'translateY(2px)';
          key.style.boxShadow = '0 1px 0 ' + _dk;
        });
        var restore = function() {
          key.style.transform = 'translateY(0)';
          key.style.boxShadow = '0 3px 0 ' + _dk;
        };
        key.addEventListener('pointerup', restore);
        key.addEventListener('pointerleave', restore);
        key.addEventListener('pointercancel', restore);
      })(dk);
      key.addEventListener('pointerup', function() { handleCashKey(k); });
      key.appendChild(lbl);
      np.appendChild(key);
    });
  });
  bottom.appendChild(np);

  var cd = document.createElement('div');
  cd.style.cssText = [
    'position:absolute;right:' + T.scenePad + 'px;top:0;',
    'width:' + (CD_W - T.scenePad * 2) + 'px;height:100%;',
    'display:flex;flex-direction:column;align-items:center;justify-content:center;',
  ].join('');
  var cdLbl = document.createElement('span');
  cdLbl.style.cssText = 'font-family:' + T.fb + ';font-size:' + FS_LABEL +
    ';font-weight:' + T.fwBold + ';color:' + T.moon + ';letter-spacing:2px;margin-bottom:8px;';
  cdLbl.textContent = 'CHANGE DUE';
  var cdVal = document.createElement('span');
  cdVal.style.cssText = 'font-family:' + T.fh + ';font-size:' + FS_HERO +
    ';font-weight:800;color:' + T.gold + ';line-height:1;';
  cdVal.textContent = '—';
  els.changeDueEl = cdVal;
  var entHint = document.createElement('span');
  entHint.style.cssText = 'font-family:' + T.fb + ';font-size:' + FS_LABEL +
    ';color:' + T.moon + ';margin-top:10px;' + ";font-weight:" + T.fwBold + ";";
  entHint.textContent = 'ENT to confirm';
  cd.appendChild(cdLbl); cd.appendChild(cdVal); cd.appendChild(entHint);
  bottom.appendChild(cd);

  phase.appendChild(bottom);
  return phase;
}

// ─────────────────────────────────────────────────
//  CASH-NUMPAD INTERACTION
// ─────────────────────────────────────────────────

function handleCashKey(key) {
  if (key === 'CLR') { state.tenderedRaw = ''; renderCashDisplay(); return; }
  if (key === 'ENT') { handleCashConfirm(); return; }
  if (state.tenderedRaw.length < 7) { state.tenderedRaw += key; renderCashDisplay(); }
}

function renderCashDisplay() {
  state.tendered = parseTendered(state.tenderedRaw);
  state.changeDue = state.tendered >= state.currentSplitAmount
    ? moneyRound(state.tendered - state.currentSplitAmount) : 0;
  if (els.tenderedDisplay) {
    els.tenderedDisplay.textContent = state.tenderedRaw ? fmt(state.tendered) : '—';
  }
  if (els.changeDueEl) {
    els.changeDueEl.textContent = state.tendered >= state.currentSplitAmount
      ? fmt(state.changeDue) : '—';
  }
}

function handleCashConfirm() {
  if (state.tendered < state.currentSplitAmount) {
    showToast('Tendered is less than this payment amount');
    return;
  }
  var payment = {
    method:    'cash',
    amount:    state.currentSplitAmount,
    tendered:  state.tendered,
    changeDue: moneyRound(state.tendered - state.currentSplitAmount),
    tax:       allocateTax(),
  };
  postPartialPayment(payment, function(ok) {
    if (!ok) return;
    state.payments.push(payment);
    updateLeftPanel();
    if (payment.changeDue > 0) {
      showToast('Change due: ' + fmt(payment.changeDue));
    }
    advanceAfterPayment();
  });
}

// ─────────────────────────────────────────────────
//  CARD-READER PHASE
// ─────────────────────────────────────────────────

function buildCardReaderPhase() {
  var phase = document.createElement('div');
  phase.style.cssText = 'width:100%;height:100%;display:flex;flex-direction:column;overflow:hidden;';

  // Label strip
  var strip = document.createElement('div');
  strip.style.cssText = [
    'padding:6px ' + T.scenePad + 'px;flex-shrink:0;',
    'background:' + T.well + ';border-bottom:1px solid ' + T.border + ';',
    'display:flex;align-items:center;',
  ].join('');
  var stripLbl = document.createElement('span');
  stripLbl.style.cssText = 'font-family:' + T.fb + ';font-size:' + FS_LABEL +
    ';font-weight:' + T.fwBold + ';color:' + T.green + ';letter-spacing:2px;';
  stripLbl.textContent = 'COLLECTING CARD  (payment ' + (state.payments.length + 1) + ')';
  strip.appendChild(stripLbl);
  phase.appendChild(strip);

  // Charge block
  var chargeBlock = document.createElement('div');
  chargeBlock.style.cssText = [
    'padding:' + T.scenePad + 'px;text-align:center;',
    'border-bottom:1px solid ' + T.border + ';flex-shrink:0;',
  ].join('');
  var chargeLabel = document.createElement('div');
  chargeLabel.style.cssText = [
    'font-family:' + T.fb + ';font-size:' + FS_LABEL + ';',
    'font-weight:' + T.fwBold + ';color:' + T.moon + ';',
    'letter-spacing:2px;margin-bottom:10px;text-transform:uppercase;',
  ].join('');
  chargeLabel.textContent = 'CHARGING TO CARD';
  var chargeAmt = document.createElement('div');
  chargeAmt.style.cssText = [
    'font-family:' + T.fh + ';font-size:' + FS_HERO + ';',
    'font-weight:800;color:' + T.elec + ';line-height:1;',
  ].join('');
  chargeAmt.textContent = fmt(state.currentSplitAmount);
  els.chargeAmountEl = chargeAmt;
  chargeBlock.appendChild(chargeLabel);
  chargeBlock.appendChild(chargeAmt);
  phase.appendChild(chargeBlock);

  // Reader zone
  var zone = document.createElement('div');
  zone.style.cssText = [
    'margin:' + T.scenePad + 'px;flex:1;',
    'border-radius:' + T.chamferCard + 'px;',
    'border:1.5px dashed ' + T.elec + ';',
    'background:' + T.well + ';',
    'display:flex;flex-direction:column;align-items:center;justify-content:center;',
    'gap:12px;position:relative;',
  ].join('');

  var rings = document.createElement('div');
  rings.style.cssText = [
    'width:40px;height:40px;border-radius:50%;',
    'border:2px solid ' + T.elec + ';',
    'box-shadow:',
    '0 0 0 14px ' + hexToRgba(T.elec, 0.35) + ',',
    '0 0 0 28px ' + hexToRgba(T.elec, 0.2)  + ',',
    '0 0 0 44px ' + hexToRgba(T.elec, 0.1)  + ';',
    'display:flex;align-items:center;justify-content:center;',
  ].join('');
  var arc = document.createElement('div');
  arc.style.cssText = 'font-size:18px;color:' + T.elec + ';' + ";font-weight:" + T.fwBold + ";";
  arc.textContent = '⌁';
  rings.appendChild(arc);

  var prompt = document.createElement('div');
  prompt.style.cssText = 'font-family:' + T.fb + ';font-size:' + FS_BODY +
    ';font-weight:' + T.fwBold + ';color:' + T.elec + ';margin-top:24px;';
  prompt.textContent = 'Tap · Insert · Swipe';

  var sub = document.createElement('div');
  sub.style.cssText = 'font-family:' + T.fb + ';font-size:' + FS_BODY + ';color:' + T.moon + ';' + ";font-weight:" + T.fwBold + ";";
  sub.textContent = 'Present card to reader';

  var statusRow = document.createElement('div');
  statusRow.style.cssText = 'display:flex;align-items:center;gap:6px;';
  var dot = document.createElement('div');
  dot.style.cssText = 'width:8px;height:8px;border-radius:50%;background:' + T.elec + ';';
  els.statusDot = dot;
  var statusText = document.createElement('span');
  statusText.style.cssText = 'font-family:' + T.fb + ';font-size:' + FS_STATUS +
    ';color:' + T.elec + ';' + ";font-weight:" + T.fwBold + ";";
  statusText.textContent = 'Reader ready';
  els.statusText = statusText;
  statusRow.appendChild(dot);
  statusRow.appendChild(statusText);

  zone.appendChild(rings);
  zone.appendChild(prompt);
  zone.appendChild(sub);
  zone.appendChild(statusRow);
  phase.appendChild(zone);

  // Cancel button — returns to 'select', does NOT close the transactional
  var cancelBtn = document.createElement('div');
  cancelBtn.style.cssText = [
    'margin:0 ' + T.scenePad + 'px ' + T.scenePad + 'px;',
    'height:44px;border-radius:' + T.chamferBtn + 'px;',
    'border:1.5px solid ' + T.verm + ';background:' + T.card + ';',
    'display:flex;align-items:center;justify-content:center;',
    'cursor:pointer;pointer-events:auto;touch-action:manipulation;flex-shrink:0;',
  ].join('');
  var cancelLbl = document.createElement('span');
  cancelLbl.style.cssText = 'font-family:' + T.fb + ';font-size:' + FS_BODY +
    ';font-weight:' + T.fwBold + ';color:' + T.verm + ';';
  cancelLbl.textContent = 'Cancel — try different method';
  cancelBtn.appendChild(cancelLbl);
  cancelBtn.addEventListener('pointerup', function() {
    if (state.cancelFn) { state.cancelFn(); state.cancelFn = null; }
    state.readerPending = false;
    state.phase = 'select';
    renderPhase();
  });
  els.cancelBtn = cancelBtn;
  phase.appendChild(cancelBtn);

  return phase;
}

function setReaderStatus(text, color) {
  if (els.statusDot)  els.statusDot.style.background  = color;
  if (els.statusText) {
    els.statusText.style.color = color;
    els.statusText.textContent = text;
  }
}

// ─────────────────────────────────────────────────
//  CARD READER INTEGRATION
// ─────────────────────────────────────────────────

function initiateCardPayment() {
  if (!state.order) return;

  state.readerPending = true;
  setReaderStatus('Processing…', T.warning);

  var controller = new AbortController();
  state.cancelFn = function() {
    controller.abort();
    state.readerPending = false;
    state.cancelFn = null;
  };

  var orderId = state.order.orderId || '';
  var payload = {
    order_id:    orderId,
    amount:      state.currentSplitAmount,
    terminal_id: 'T-001',
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
    state.cancelFn = null;
    handleCardResponse(result);
  })
  .catch(function(err) {
    if (err && err.name === 'AbortError') return;
    setReaderStatus(err.message || 'Connection error', T.verm);
    state.readerPending = false;
    state.cancelFn = null;
    showToast('Reader error — try again or use cash');
    if (els.cancelBtn) els.cancelBtn.style.pointerEvents = 'auto';
  });
}

function handleCardResponse(response) {
  state.readerPending = false;

  if (!response.success) {
    setReaderStatus(response.error_message || 'Payment declined', T.verm);
    if (els.cancelBtn) els.cancelBtn.style.pointerEvents = 'auto';
    return;
  }

  setReaderStatus('Approved', T.green);

  var tipAmount = moneyRound(response.tip_amount || 0);
  var payment = {
    method:         'card',
    amount:         state.currentSplitAmount,
    tip_amount:     tipAmount,
    cardLast4:      response.card_last4     || '',
    cardBrand:      response.card_brand     || '',
    auth_code:      response.auth_code      || '',
    transaction_id: response.transaction_id || '',
    tax:            allocateTax(),
  };

  postPartialPayment(payment, function(ok) {
    if (!ok) return;
    state.payments.push(payment);
    updateLeftPanel();
    advanceAfterPayment();
  });
}

// ─────────────────────────────────────────────────
//  PARTIAL PAYMENT POST
// ─────────────────────────────────────────────────

function postPartialPayment(payment, callback) {
  var orderId = state.order && state.order.orderId;
  if (!orderId) { callback(true); return; }

  fetchWithTimeout(
    '/api/v1/orders/' + orderId + '/payments',
    {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(payment),
    },
    8000
  )
  .then(function(res) { return res.json(); })
  .then(function(data) {
    if (data.ok === false) {
      showToast(data.detail || 'Payment failed');
      callback(false);
      return;
    }
    callback(true);
  })
  .catch(function() {
    showToast('Network error — payment may not have recorded');
    callback(false);
  });
}

// ─────────────────────────────────────────────────
//  TAX ALLOCATION  (proportional; last payment gets remainder)
// ─────────────────────────────────────────────────

function allocateTax() {
  var paidSoFar = state.payments.reduce(function(s, p) {
    return moneyRound(s + (Number(p.amount) || 0));
  }, 0);
  var isLast = moneyRound(paidSoFar + state.currentSplitAmount) >= state.total;
  if (isLast) {
    var allocatedSoFar = state.payments.reduce(function(s, p) {
      return moneyRound(s + (Number(p.tax) || 0));
    }, 0);
    return moneyRound((state.order.tax || 0) - allocatedSoFar);
  }
  var ratio = state.total > 0 ? state.currentSplitAmount / state.total : 0;
  return moneyRound((state.order.tax || 0) * ratio);
}

// ─────────────────────────────────────────────────
//  ADVANCE AFTER PAYMENT
// ─────────────────────────────────────────────────

function advanceAfterPayment() {
  computeRemaining();
  if (state.remaining <= 0) {
    routeToComplete();
  } else {
    state.splitAmountRaw     = '';
    state.currentSplitAmount = 0;
    state.tenderedRaw        = '';
    state.tendered           = 0;
    state.changeDue          = 0;
    state.phase              = 'select';
    if (state.equalSplitCount >= 2 && state.remaining > 0) {
      var nextIdx = state.payments.length;
      state.currentSplitAmount = nextIdx < state.equalSplitAmounts.length
        ? state.equalSplitAmounts[nextIdx]
        : state.remaining;
    }
    renderPhase();
  }
}

// ─────────────────────────────────────────────────
//  ROUTE TO COMPLETE
// ─────────────────────────────────────────────────

function routeToComplete() {
  var cashPayments = state.payments.filter(function(p) { return p.method === 'cash'; });
  var cardPayments = state.payments.filter(function(p) { return p.method === 'card'; });
  var totalTips    = state.payments.reduce(function(s, p) {
    return moneyRound(s + (p.tip_amount || 0));
  }, 0);
  var totalChange  = cashPayments.reduce(function(s, p) {
    return moneyRound(s + (p.changeDue || 0));
  }, 0);

  // mountWorking auto-closes all transactionals including qsr-split
  SceneManager.mountWorking('qsr-complete', {
    order:         state.order,
    paymentMethod: state.payments.length === 1 ? state.payments[0].method : 'split',
    payments:      state.payments,
    tipAmount:     totalTips,
    changeDue:     totalChange,
    cardLast4:     cardPayments.length === 1 ? cardPayments[0].cardLast4 : '',
    cardBrand:     cardPayments.length === 1 ? cardPayments[0].cardBrand : '',
    isSplit:       true,
    splitCount:    state.payments.length,
  });
}

// ─────────────────────────────────────────────────
//  SCENE REGISTRATION
// ─────────────────────────────────────────────────

defineScene('qsr-split', {
  mount: function(container, params) {
    var p = params || {};
    state.order              = p.order || {};
    state.total              = Number(state.order.total) || 0;
    state.cashDiscountRate   = Number(state.order.cashDiscountRate) || 0;
    state.payments           = [];
    state.phase              = 'select';
    state.splitAmountRaw     = '';
    state.currentSplitAmount = 0;
    state.tenderedRaw        = '';
    state.tendered           = 0;
    state.changeDue          = 0;
    state.readerPending      = false;
    state.cancelFn           = null;
    state.equalSplitCount    = 0;
    state.equalSplitAmounts  = [];

    computeRemaining();

    container.appendChild(buildLeftPanel());

    var rightEl = document.createElement('div');
    rightEl.style.cssText = [
      'position:absolute;',
      'left:' + (RECAP_W + 1) + 'px;top:' + T.headerH + 'px;',
      'width:' + RIGHT_W + 'px;height:' + CONTENT_H + 'px;',
      'background:' + T.bg + ';overflow:hidden;',
    ].join('');
    els.rightPanel = rightEl;
    container.appendChild(rightEl);

    renderPhase();
  },

  unmount: function() {
    if (state.cancelFn) { state.cancelFn(); state.cancelFn = null; }
    state.readerPending = false;
    els = {};
  },
});
