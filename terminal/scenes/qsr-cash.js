// ═══════════════════════════════════════════════════
//  KINDpos Terminal — QSR Cash Tender Scene  (Vz2.0)
//
//  Two-column layout — same frame as qsr-order:
//    LEFT   T.pcLeftW(340px)  — frozen recap (read-only, dimmed)
//    RIGHT  683px             — cash tender surface
//
//  Right surface zones (top to bottom):
//    Total block  — card total (T.moon small) + cash total hero (T.gold)
//                   cash discount line (T.green, only when rate > 0)
//    Tendered row — T.well input display, running tendered amount
//    Quick amounts — EXACT + dynamic bill presets above cashTotal
//    Numpad        — 3×4 grid (T.chamferKey rx=12)
//    Change due    — T.gold hero, right of numpad, updates live
//
//  Finance:
//    cashDiscountAmount = moneyRound(total × cashDiscountRate)
//    cashTotal          = moneyRound(total − cashDiscountAmount)
//    changeDue          = moneyRound(tendered − cashTotal)
//    moneyRound(x)      = Math.round(x × 100) / 100
//
//  ENT confirms:
//    POST /api/v1/orders/{orderId}/payments with:
//      method, amount (cashTotal), tendered, change_due,
//      cash_discount_rate, cash_discount_amount, tip_amount: 0
//    On success → SceneManager.mountWorking('qsr-complete', { … })
//
//  Nice. Dependable. Yours.
// ═══════════════════════════════════════════════════

import { defineScene, SceneManager } from '../scene-manager.js';
import { T } from '../../common/tokens.js';
import {
  buildStaticCard,
  buildPillButton,
  buildSectionLabel,
  hexToRgba,
  darkenHex,
} from '../theme-manager.js';

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

// Numpad occupies left 380px of right surface
// Change-due panel occupies remaining right side
var NP_W      = 380;
var CD_W      = RIGHT_W - NP_W;         // 303

var FS_LABEL  = '10px';
var FS_BODY   = '14px';
var FS_HERO   = T.fsHero;    // 56px — cashTotal + changeDue heroes
var FS_DISC   = '13px';      // discount line
var FS_BTN    = '14px';      // button labels (Outfit)
var FS_KEY    = '26px';      // numpad digit labels

// ─────────────────────────────────────────────────
//  STATE
// ─────────────────────────────────────────────────

var state = {
  order:              null,   // full order payload from qsr-order
  total:              0,      // card total (from order.total)
  cashDiscountRate:   0,      // from order.cashDiscountRate
  cashDiscountAmount: 0,      // computed: moneyRound(total × rate)
  cashTotal:          0,      // computed: moneyRound(total − discount)
  tenderedRaw:        '',     // string — numpad input buffer e.g. '3000'
  tendered:           0,      // float — tenderedRaw / 100
  changeDue:          0,      // float — moneyRound(tendered − cashTotal)
};

var els = {};   // DOM refs populated in mount()

// ─────────────────────────────────────────────────
//  FINANCE HELPERS
// ─────────────────────────────────────────────────

function moneyRound(x) {
  return Math.round(x * 100) / 100;
}

function computeCash() {
  state.cashDiscountAmount = moneyRound(state.total * state.cashDiscountRate);
  state.cashTotal          = moneyRound(state.total - state.cashDiscountAmount);
}

function computeChange() {
  if (state.tendered >= state.cashTotal) {
    state.changeDue = moneyRound(state.tendered - state.cashTotal);
  } else {
    state.changeDue = 0;
  }
}

// Compute tendered float from raw string buffer.
// Buffer stores cents as integer string: '3000' = $30.00
function parseTendered(raw) {
  if (!raw || raw === '') return 0;
  return moneyRound(parseInt(raw, 10) / 100);
}

// Build quick-amount preset list from cashTotal.
// Always includes EXACT, then first 3 common bill denominations >= cashTotal.
function buildPresets(cashTotal) {
  var bills = [1, 2, 5, 10, 20, 50, 100];
  var presets = [{ label: 'EXACT', amount: cashTotal, isExact: true }];
  var count = 0;
  for (var i = 0; i < bills.length && count < 3; i++) {
    var bill = bills[i];
    if (bill > cashTotal) {
      presets.push({ label: '$' + bill, amount: bill, isExact: false });
      count++;
    }
  }
  return presets;
}

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

// ─────────────────────────────────────────────────
//  FROZEN RECAP (left panel — read-only)
// ─────────────────────────────────────────────────

function buildFrozenRecap(order) {
  var FS_ITEM = '14px';
  var FS_MOD  = '11px';
  var FS_PRICE = '14px';
  var FS_TOTAL = '24px';

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

  // Item list (no tap handlers — display only)
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

  var hasDiscount = state.cashDiscountRate > 0;
  var cardTotalLabel = hasDiscount ? 'Card Total' : 'TOTAL';
  totalsBlock.appendChild(makeTotRow(
    cardTotalLabel, fmtMoney(total),
    hasDiscount ? T.moon : T.text, T.gold, !hasDiscount, hasDiscount ? FS_ITEM : '20px'
  ));

  if (hasDiscount) {
    var discRow = document.createElement('div');
    discRow.style.cssText = [
      'display:flex;justify-content:space-between;align-items:center;',
      'margin-top:4px;',
    ].join('');
    var discLabel = document.createElement('span');
    discLabel.style.cssText = [
      'font-family:' + T.fb + ';font-size:' + FS_MOD + ';color:' + T.green + ';',
    ].join('') + ";font-weight:" + T.fwBold + ";";
    discLabel.textContent = 'Cash discount −' + (state.cashDiscountRate * 100).toFixed(1) + '%';
    var discVal = document.createElement('span');
    discVal.style.cssText = [
      'font-family:' + T.fb + ';font-size:' + FS_MOD + ';color:' + T.green + ';',
    ].join('') + ";font-weight:" + T.fwBold + ";";
    discVal.textContent = '−' + fmtMoney(state.cashDiscountAmount);
    discRow.appendChild(discLabel);
    discRow.appendChild(discVal);
    totalsBlock.appendChild(discRow);

    // CASH TOTAL hero
    var cashHeroRow = document.createElement('div');
    cashHeroRow.style.cssText = [
      'display:flex;justify-content:space-between;align-items:center;margin-top:6px;',
    ].join('');
    var cashLbl = document.createElement('span');
    cashLbl.style.cssText = [
      'font-family:' + T.fh + ';font-size:' + FS_ITEM + ';',
      'font-weight:' + T.fwBold + ';color:' + T.text + ';',
      'letter-spacing:1px;text-transform:uppercase;',
    ].join('');
    cashLbl.textContent = 'CASH TOTAL';
    var cashVal = document.createElement('span');
    cashVal.style.cssText = [
      'font-family:' + T.fh + ';font-size:' + FS_TOTAL + ';',
      'font-weight:' + T.fwBold + ';color:' + T.gold + ';',
    ].join('');
    cashVal.textContent = fmtMoney(state.cashTotal);
    cashHeroRow.appendChild(cashLbl);
    cashHeroRow.appendChild(cashVal);
    totalsBlock.appendChild(cashHeroRow);
  }

  panel.appendChild(totalsBlock);

  // Back to menu link
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
    SceneManager.mountWorking('qsr-order', {
      items:           state.order.items,
      ticketNumber:    state.order.ticketNumber,
      ticketName:      state.order.ticketName,
      cashDiscountRate: state.cashDiscountRate,
    });
  });

  panel.appendChild(backLink);

  return panel;
}

// ─────────────────────────────────────────────────
//  TOTAL BLOCK (right surface, top)
// ─────────────────────────────────────────────────

function buildTotalBlock() {
  var block = document.createElement('div');
  block.style.cssText = [
    'padding:' + T.scenePad + 'px;',
    'display:flex;flex-direction:column;align-items:center;gap:4px;',
    'flex-shrink:0;',
  ].join('');

  var hasDiscount = state.cashDiscountRate > 0;

  if (hasDiscount) {
    var cardLabel = document.createElement('span');
    cardLabel.style.cssText = [
      'font-family:' + T.fb + ';font-size:' + FS_LABEL + ';',
      'color:' + T.moon + ';letter-spacing:2px;text-transform:uppercase;',
    ].join('') + ";font-weight:" + T.fwBold + ";";
    cardLabel.textContent = 'CARD PRICE';
    block.appendChild(cardLabel);

    var cardVal = document.createElement('span');
    cardVal.style.cssText = [
      'font-family:' + T.fb + ';font-size:' + FS_BODY + ';',
      'font-weight:' + T.fwReg + ';color:' + T.moon + ';',
    ].join('');
    cardVal.textContent = fmtMoney(state.total);
    block.appendChild(cardVal);

    var discBadge = document.createElement('span');
    discBadge.style.cssText = [
      'font-family:' + T.fb + ';font-size:' + FS_DISC + ';',
      'color:' + T.green + ';',
    ].join('') + ";font-weight:" + T.fwBold + ";";
    discBadge.textContent = (state.cashDiscountRate * 100).toFixed(1) +
      '% cash discount  −' + fmtMoney(state.cashDiscountAmount);
    block.appendChild(discBadge);

    var divider = document.createElement('div');
    divider.style.cssText = 'height:1px;width:100%;background:' + T.border + ';margin:4px 0;';
    block.appendChild(divider);
  }

  var cashTotalLabel = document.createElement('span');
  cashTotalLabel.style.cssText = [
    'font-family:' + T.fb + ';font-size:' + FS_LABEL + ';',
    'color:' + T.moon + ';letter-spacing:2px;text-transform:uppercase;',
  ].join('') + ";font-weight:" + T.fwBold + ";";
  cashTotalLabel.textContent = 'CASH TOTAL';
  block.appendChild(cashTotalLabel);

  var cashTotalHero = document.createElement('span');
  cashTotalHero.style.cssText = [
    'font-family:' + T.fh + ';font-size:' + FS_HERO + ';',
    'font-weight:800;color:' + T.gold + ';',
    'line-height:1;',
  ].join('');
  cashTotalHero.textContent = fmtMoney(state.cashTotal);
  els.cashTotalEl = cashTotalHero;
  block.appendChild(cashTotalHero);

  return block;
}

// ─────────────────────────────────────────────────
//  TENDERED ROW
// ─────────────────────────────────────────────────

function buildTenderedRow() {
  var row = document.createElement('div');
  row.style.cssText = [
    'margin:0 ' + T.scenePad + 'px;',
    'background:' + T.well + ';',
    'border:1px solid ' + T.border + ';',
    'border-radius:' + T.chamferCard + 'px;',
    'padding:10px 16px;',
    'display:flex;justify-content:space-between;align-items:center;',
    'flex-shrink:0;',
  ].join('');

  var label = document.createElement('span');
  label.style.cssText = [
    'font-family:' + T.fb + ';font-size:' + FS_BODY + ';',
    'color:' + T.moon + ';',
  ].join('') + ";font-weight:" + T.fwBold + ";";
  label.textContent = 'Tendered';

  var display = document.createElement('span');
  display.style.cssText = [
    'font-family:' + T.fb + ';font-size:22px;',
    'font-weight:' + T.fwBold + ';color:' + T.text + ';',
  ].join('');
  display.textContent = '—';
  els.tenderedDisplay = display;

  row.appendChild(label);
  row.appendChild(display);
  return row;
}

// ─────────────────────────────────────────────────
//  QUICK AMOUNTS
// ─────────────────────────────────────────────────

function buildQuickAmounts(presets) {
  var wrap = document.createElement('div');
  wrap.style.cssText = [
    'padding:8px ' + T.scenePad + 'px 4px;',
    'display:flex;flex-direction:column;gap:6px;flex-shrink:0;',
  ].join('');

  var sectionLbl = document.createElement('span');
  sectionLbl.style.cssText = [
    'font-family:' + T.fb + ';font-size:' + FS_LABEL + ';',
    'color:' + T.green + ';letter-spacing:2px;text-transform:uppercase;',
  ].join('') + ";font-weight:" + T.fwBold + ";";
  sectionLbl.textContent = 'QUICK AMOUNTS';
  wrap.appendChild(sectionLbl);

  var tilesRow = document.createElement('div');
  tilesRow.style.cssText = 'display:flex;gap:8px;';
  els.quickRow = tilesRow;

  presets.forEach(function(p) {
    var tile = document.createElement('div');
    tile.dataset.presetAmount = p.amount;
    if (p.isExact) {
      tile.style.cssText = [
        'flex:1;',
        'background:' + T.well + ';',
        'border:1.5px solid ' + T.greenWarm + ';',
        'border-radius:' + T.chamferBtn + 'px;',
        'padding:8px 6px;',
        'display:flex;flex-direction:column;align-items:center;gap:2px;',
        'cursor:pointer;pointer-events:auto;touch-action:manipulation;',
      ].join('');
      var topLine = document.createElement('span');
      topLine.style.cssText = [
        'font-family:' + T.fb + ';font-size:10px;',
        'font-weight:' + T.fwBold + ';color:' + T.greenWarm + ';',
        'text-transform:uppercase;',
      ].join('');
      topLine.textContent = 'EXACT';
      var botLine = document.createElement('span');
      botLine.style.cssText = [
        'font-family:' + T.fb + ';font-size:' + FS_BODY + ';',
        'color:' + T.greenWarm + ';',
      ].join('') + ";font-weight:" + T.fwBold + ";";
      botLine.textContent = fmtMoney(p.amount);
      tile.appendChild(topLine);
      tile.appendChild(botLine);
    } else {
      tile.style.cssText = [
        'flex:1;',
        'background:' + T.well + ';',
        'border:1px solid ' + T.border + ';',
        'border-radius:' + T.chamferBtn + 'px;',
        'padding:8px 6px;',
        'display:flex;align-items:center;justify-content:center;',
        'cursor:pointer;pointer-events:auto;touch-action:manipulation;',
      ].join('');
      var lbl = document.createElement('span');
      lbl.style.cssText = [
        'font-family:' + T.fb + ';font-size:' + FS_BODY + ';',
        'font-weight:' + T.fwBold + ';color:' + T.text + ';',
      ].join('');
      lbl.textContent = p.label;
      tile.appendChild(lbl);
    }
    tilesRow.appendChild(tile);
  });

  wrap.appendChild(tilesRow);
  return wrap;
}

// ─────────────────────────────────────────────────
//  NUMPAD
// ─────────────────────────────────────────────────

function buildNumpad() {
  var numpadTop = 0; // positioned within bottom section — top:0 of its parent

  var np = document.createElement('div');
  np.style.cssText = [
    'position:absolute;',
    'left:' + T.scenePad + 'px;',
    'top:' + numpadTop + 'px;',
    'width:' + (NP_W - T.scenePad * 2) + 'px;',
    'display:grid;',
    'grid-template-columns:repeat(3,1fr);',
    'gap:8px;',
  ].join('');
  els.numpad = np;

  var rows = [
    ['7', '8', '9'],
    ['4', '5', '6'],
    ['1', '2', '3'],
    ['CLR', '0', 'ENT'],
  ];

  var bevelLt = _lighten(T.bg, 0.08);
  var bevelDk = darkenHex(T.bg, 0.2);
  var digitDk = darkenHex(T.well, 0.3);

  rows.forEach(function(row) {
    row.forEach(function(k) {
      var key = document.createElement('div');
      key.dataset.key = k;
      var dk;

      key.style.cssText = [
        'min-height:66px;',
        'border-radius:' + T.chamferKey + 'px;',
        'display:flex;align-items:center;justify-content:center;',
        'cursor:pointer;pointer-events:auto;touch-action:manipulation;',
        'transition:transform 0.07s, box-shadow 0.07s;',
      ].join('');

      var lbl = document.createElement('span');

      if (k === 'CLR') {
        dk = darkenHex(T.verm, 0.25);
        key.style.cssText += [
          'background:' + T.well + ';',
          'border:1.5px solid ' + T.verm + ';',
          'box-shadow:0 3px 0 ' + dk + ';',
        ].join('');
        lbl.style.cssText = [
          'font-family:' + T.fb + ';font-size:' + FS_BTN + ';',
          'font-weight:' + T.fwBold + ';color:' + T.verm + ';',
          'text-transform:uppercase;letter-spacing:0.05em;',
        ].join('');
        lbl.textContent = 'CLR';
      } else if (k === 'ENT') {
        dk = darkenHex(T.greenWarm, 0.25);
        key.style.cssText += [
          'background:' + T.greenWarm + ';',
          'box-shadow:0 3px 0 ' + dk + ';',
        ].join('');
        lbl.style.cssText = [
          'font-family:' + T.fb + ';font-size:' + FS_BTN + ';',
          'font-weight:' + T.fwBold + ';color:' + T.well + ';',
          'text-transform:uppercase;letter-spacing:0.05em;',
        ].join('');
        lbl.textContent = 'ENT';
      } else {
        dk = digitDk;
        key.style.cssText += [
          'background:' + T.well + ';',
          'border-top:2px solid ' + bevelLt + ';',
          'border-right:2px solid ' + bevelDk + ';',
          'border-bottom:2px solid ' + bevelDk + ';',
          'border-left:2px solid ' + bevelLt + ';',
          'box-shadow:0 3px 0 ' + dk + ';',
        ].join('');
        lbl.style.cssText = [
          'font-family:' + T.fh + ';font-size:' + FS_KEY + ';',
          'font-weight:' + T.fwBold + ';color:' + T.green + ';',
        ].join('');
        lbl.textContent = k;
      }

      // Press handlers — translate + reduce shadow on press, restore on release
      (function(_dk) {
        key.addEventListener('pointerdown', function() {
          key.style.transform = 'translateY(2px)';
          key.style.boxShadow = '0 1px 0 ' + _dk;
        });
        var release = function() {
          key.style.transform = 'translateY(0)';
          key.style.boxShadow = '0 3px 0 ' + _dk;
        };
        key.addEventListener('pointerup',     release);
        key.addEventListener('pointerleave',  release);
        key.addEventListener('pointercancel', release);
      })(dk);

      key.appendChild(lbl);
      np.appendChild(key);
    });
  });

  return np;
}

// ─────────────────────────────────────────────────
//  CHANGE DUE PANEL
// ─────────────────────────────────────────────────

function buildChangeDue() {
  var cd = document.createElement('div');
  cd.style.cssText = [
    'position:absolute;',
    'right:' + T.scenePad + 'px;',
    'top:0;',
    'width:' + (CD_W - T.scenePad * 2) + 'px;',
    'display:flex;flex-direction:column;',
    'align-items:center;justify-content:center;',
    'height:100%;',
  ].join('');

  var cdLabel = document.createElement('span');
  cdLabel.style.cssText = [
    'font-family:' + T.fb + ';font-size:' + FS_LABEL + ';',
    'font-weight:' + T.fwBold + ';color:' + T.moon + ';',
    'letter-spacing:2px;text-transform:uppercase;',
    'margin-bottom:8px;',
  ].join('');
  cdLabel.textContent = 'CHANGE DUE';

  var cdValue = document.createElement('span');
  cdValue.style.cssText = [
    'font-family:' + T.fh + ';font-size:' + FS_HERO + ';',
    'font-weight:800;color:' + T.gold + ';',
    'line-height:1;',
  ].join('');
  cdValue.textContent = '—';
  els.changeDueEl = cdValue;

  var entHint = document.createElement('span');
  entHint.style.cssText = [
    'font-family:' + T.fb + ';font-size:' + FS_LABEL + ';',
    'color:' + T.moon + ';',
    'margin-top:10px;',
  ].join('') + ";font-weight:" + T.fwBold + ";";
  entHint.textContent = 'ENT to confirm';
  els.entHint = entHint;

  cd.appendChild(cdLabel);
  cd.appendChild(cdValue);
  cd.appendChild(entHint);
  return cd;
}

// ─────────────────────────────────────────────────
//  RIGHT SURFACE ASSEMBLY
// ─────────────────────────────────────────────────

function buildRightSurface() {
  var rightEl = document.createElement('div');
  rightEl.style.cssText = [
    'position:absolute;',
    'left:' + (RECAP_W + 1) + 'px;',
    'top:' + T.headerH + 'px;',
    'width:' + RIGHT_W + 'px;',
    'height:' + CONTENT_H + 'px;',
    'background:' + T.bg + ';',
    'overflow:hidden;',
    'display:flex;flex-direction:column;',
  ].join('');
  els.rightSurface = rightEl;

  // a) Total block
  rightEl.appendChild(buildTotalBlock());

  // b) Tendered row
  var tendRow = buildTenderedRow();
  tendRow.style.marginBottom = '4px';
  rightEl.appendChild(tendRow);

  // c) Quick amounts
  rightEl.appendChild(buildQuickAmounts(buildPresets(state.cashTotal)));

  // d) Divider
  var divider = document.createElement('div');
  divider.style.cssText = [
    'height:1px;',
    'background:' + T.border + ';',
    'margin:6px 0;',
    'flex-shrink:0;',
  ].join('');
  rightEl.appendChild(divider);

  // e+f) Bottom section — numpad left, change-due right
  var bottomSection = document.createElement('div');
  bottomSection.style.cssText = [
    'flex:1;',
    'position:relative;',
    'min-height:0;',
  ].join('');

  bottomSection.appendChild(buildNumpad());
  bottomSection.appendChild(buildChangeDue());
  rightEl.appendChild(bottomSection);

  return rightEl;
}

// ─────────────────────────────────────────────────
//  INTERACTION
// ─────────────────────────────────────────────────

function renderTendered() {
  state.tendered = parseTendered(state.tenderedRaw);
  computeChange();
  els.tenderedDisplay.textContent =
    state.tenderedRaw ? fmtMoney(state.tendered) : '—';
  els.changeDueEl.textContent =
    state.tendered >= state.cashTotal ? fmtMoney(state.changeDue) : '—';
}

function handleKey(key) {
  if (key === 'CLR') {
    state.tenderedRaw = '';
    renderTendered();
    return;
  }
  if (key === 'ENT') {
    handleConfirm();
    return;
  }
  // Digit: append to buffer, max 7 chars ($99,999.99)
  if (state.tenderedRaw.length < 7) {
    state.tenderedRaw += key;
    renderTendered();
  }
}

function handlePreset(amount) {
  // Convert dollar amount to cent string for the buffer
  state.tenderedRaw = String(Math.round(amount * 100));
  renderTendered();
}

function handleConfirm() {
  // Guard: tendered must cover cashTotal
  if (state.tendered < state.cashTotal) {
    showToast('Tendered amount is less than cash total');
    return;
  }

  var orderId = state.order && state.order.orderId;

  var payload = {
    method:               'cash',
    amount:               state.cashTotal,
    tendered:             state.tendered,
    change_due:           state.changeDue,
    tip_amount:           0,
    cash_discount_rate:   state.cashDiscountRate,
    cash_discount_amount: state.cashDiscountAmount,
    tax:                  state.order.tax || 0,
  };

  if (orderId) {
    // Disable numpad during POST to prevent double-submit
    els.numpad.style.pointerEvents = 'none';

    fetchWithTimeout(
      '/api/v1/orders/' + orderId + '/payments',
      {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(payload),
      },
      8000
    )
    .then(function(res) { return res.json(); })
    .then(function(data) {
      if (data.ok === false) {
        showToast(data.detail || 'Payment failed');
        els.numpad.style.pointerEvents = 'auto';
        return;
      }
      routeToComplete();
    })
    .catch(function() {
      showToast('Network error — please try again');
      els.numpad.style.pointerEvents = 'auto';
    });
  } else {
    // No orderId yet — route directly; complete scene handles persistence
    routeToComplete();
  }
}

function routeToComplete() {
  SceneManager.mountWorking('qsr-complete', {
    order:              state.order,
    cashTotal:          state.cashTotal,
    tendered:           state.tendered,
    changeDue:          state.changeDue,
    cashDiscountRate:   state.cashDiscountRate,
    cashDiscountAmount: state.cashDiscountAmount,
    paymentMethod:      'cash',
  });
}

function wireHandlers() {
  // Numpad delegation
  els.numpad.addEventListener('pointerup', function(e) {
    var key = e.target.closest('[data-key]');
    if (!key) return;
    handleKey(key.dataset.key);
  });

  // Quick amounts delegation
  els.quickRow.addEventListener('pointerup', function(e) {
    var tile = e.target.closest('[data-preset-amount]');
    if (!tile) return;
    handlePreset(parseFloat(tile.dataset.presetAmount));
  });
}

// ─────────────────────────────────────────────────
//  SCENE REGISTRATION
// ─────────────────────────────────────────────────

defineScene('qsr-cash', {
  mount: function(container, params) {
    state.order            = (params && params.order) || {};
    state.total            = Number(state.order.total) || 0;
    state.cashDiscountRate = Number(state.order.cashDiscountRate) || 0;
    state.tenderedRaw      = '';
    state.tendered         = 0;
    state.changeDue        = 0;

    computeCash();

    var recapEl = buildFrozenRecap(state.order);
    var rightEl = buildRightSurface();
    container.appendChild(recapEl);
    container.appendChild(rightEl);

    wireHandlers();
  },

  unmount: function() {
    els = {};
  },
});
