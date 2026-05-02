// ═══════════════════════════════════════════════════
//  KINDpos Terminal — QSR Order Scene  (Vz2.0)
//
//  Two-column layout:
//    LEFT   T.pcLeftW(340px)  — recap panel (always visible)
//    RIGHT  683px             — working surface (menu entry)
//
//  Left sub-zones:
//    Header bar (44px)        — ORDER label + ticket number
//    Item list (scrollable)   — line items with selection
//    Totals block             — subtotal, tax, total
//    Payment row              — CASH · CARD · SPLIT
//    Action row               — DISCOUNT · VOID (context-aware)
//
//  Right sub-zones:
//    Favorites strip (88px)   — top 5 items, full right width
//    Category column (160px)  — vertical tiles, category color fill when active
//    Item grid (remaining)    — 3-col tap-to-add tiles
//
//  Selection model:
//    Tap item → select (.sel). Tap again → deselect.
//    Tap recap background → clear all selection.
//    Multi-select supported.
//    DISCOUNT / VOID button labels shift to item-level when any item selected.
//
//  Payment handoff:
//    CASH  → SceneManager.mountWorking('qsr-cash')
//    CARD  → SceneManager.mountWorking('qsr-card')
//    SPLIT → SceneManager.openTransactional('qsr-split')
//
//  Discount / Void gate:
//    Both open SceneManager.openInterrupt('manager-pin', { onConfirm })
//    Discount onConfirm → SceneManager.openInterrupt('disc-select', { ... })
//    Void onConfirm    → confirm dialog → DELETE /api/v1/orders/{id}/items or order
//
//  Nice. Dependable. Yours.
// ═══════════════════════════════════════════════════

import { defineScene, SceneManager } from '../scene-manager.js';
import { T } from '../../common/tokens.js';
import {
  buildStaticCard,
  buildActionCard,
  buildPillButton,
  buildSectionLabel,
  hexToRgba,
  darkenHex,
} from '../theme-manager.js';
import { showToast } from '../components.js';
import { fmt } from './checkout-core.js';
import { fetchWithTimeout } from '../net.js';

// ─────────────────────────────────────────────────
//  LAYOUT CONSTANTS
// ─────────────────────────────────────────────────

var RECAP_W    = T.pcLeftW;              // 340 — left panel, fixed
var RIGHT_W    = T.appW - RECAP_W - 1;  // 683 — right working surface
var FAV_H      = 88;                     // Favorites strip height
var CAT_W      = 160;                    // Category column width
var GRID_W     = RIGHT_W - CAT_W - 1;   // Item grid width
var CONTENT_H  = T.appH - T.headerH;    // 548 — below header

// TODO: replace with GET /api/v1/menu/categories once menus are populated
var MOCK_MENU = [
  {
    key: 'BURGERS', label: 'Burgers', color: T.categoryPalette['PIZZA'] || T.moon,
    items: [
      { itemKey: 'burger-classic',   name: 'Classic Burger',   price: 12.50, popularity: 1 },
      { itemKey: 'burger-cheese',    name: 'Cheeseburger',     price: 13.50, popularity: 2 },
      { itemKey: 'burger-double',    name: 'Double Smash',     price: 15.00, popularity: 3 },
      { itemKey: 'burger-bacon',     name: 'Bacon Burger',     price: 14.50, popularity: 4 },
      { itemKey: 'burger-mushroom',  name: 'Mushroom Swiss',   price: 14.00, popularity: 5 },
      { itemKey: 'burger-veggie',    name: 'Veggie Burger',    price: 12.00, popularity: 6 },
    ],
  },
  {
    key: 'SIDES', label: 'Sides', color: T.categoryPalette['SIDES'] || T.moon,
    items: [
      { itemKey: 'fries-sm',   name: 'Fries (Sm)',    price: 3.50, popularity: 1 },
      { itemKey: 'fries-lg',   name: 'Fries (Lg)',    price: 4.50, popularity: 2 },
      { itemKey: 'rings',      name: 'Onion Rings',   price: 5.00, popularity: 3 },
      { itemKey: 'coleslaw',   name: 'Coleslaw',      price: 2.50, popularity: 4 },
    ],
  },
  {
    key: 'DRINKS', label: 'Drinks', color: T.categoryPalette['DRINKS'] || T.moon,
    items: [
      { itemKey: 'soda-sm',  name: 'Soda (Sm)',    price: 2.00, popularity: 1 },
      { itemKey: 'soda-lg',  name: 'Soda (Lg)',    price: 2.75, popularity: 2 },
      { itemKey: 'shake',    name: 'Milkshake',    price: 5.50, popularity: 3 },
      { itemKey: 'water',    name: 'Water',        price: 0.00, popularity: 4 },
      { itemKey: 'lemonade', name: 'Lemonade',     price: 3.00, popularity: 5 },
    ],
  },
];

var FS_LABEL   = '10px';   // Section labels (letter-spaced uppercase)
var FS_ITEM    = '14px';   // Item names in recap
var FS_MOD     = '11px';   // Modifier text in recap
var FS_PRICE   = '14px';   // Prices
var FS_TOTAL   = '24px';   // TOTAL hero (Outfit)
var FS_CAT     = '16px';   // Category tile labels (Outfit)
var FS_TILE    = '15px';   // Item grid tile names (Outfit)
var FS_BTN     = '14px';   // Payment + action button labels (Outfit)
var FS_BODY    = '14px';   // Body / empty-state text

// ─────────────────────────────────────────────────
//  STATE
// ─────────────────────────────────────────────────

var state = {
  items:            [],      // Array of { name, price, mods:[], qty, itemId }
  selectedIdxs:     [],      // Array of item indices currently selected
  activeCategory:   null,    // String — currently active category key
  categories:       [],      // Array of { key, label, color, items:[] }
  ticketNumber:     1,       // Daily sequence — displayed as QS-001
  ticketName:       '',      // Optional customer name
  orderId:          null,    // Set after first item POST
  taxRate:          0.08875, // Default — overridden by store config
  cashDiscountRate: 0.0,    // float — from StoreConfigBundle.cash_discount_rate
};

// ─────────────────────────────────────────────────
//  DOM ELEMENT REFERENCES
// ─────────────────────────────────────────────────

var els = {
  recapPanel:    null,
  itemList:      null,
  totalEl:       null,
  subtotalEl:    null,
  taxEl:         null,
  cashBtn:       null,
  cardBtn:       null,
  splitBtn:      null,
  discBtn:       null,
  voidBtn:       null,
  paySection:    null,
  voidLink:      null,
  categoryColumn: null,
  itemGrid:      null,
  favStrip:      null,
  rightSurface:  null,
};

// ─────────────────────────────────────────────────
//  HELPERS
// ─────────────────────────────────────────────────

function computeTotals() {
  var subtotal = 0;
  for (var i = 0; i < state.items.length; i++) {
    subtotal += state.items[i].price * state.items[i].qty;
  }
  var tax   = subtotal * state.taxRate;
  var total = subtotal + tax;
  return {
    subtotal: subtotal,
    tax:      tax,
    total:    total,
  };
}

function fmtMoney(n) {
  return '$' + n.toFixed(2);
}

function ticketLabel(n) {
  var s = String(n);
  while (s.length < 3) s = '0' + s;
  return 'QS-' + s;
}

// ─────────────────────────────────────────────────
//  ITEM ROW
// ─────────────────────────────────────────────────

function buildItemRow(item, idx, isSelected) {
  var rowW = RECAP_W - 24;

  var row = document.createElement('div');
  row.dataset.itemIdx = idx;
  row.style.cssText = [
    'position:relative;',
    'display:flex;',
    'align-items:stretch;',
    'min-height:44px;',
    'width:' + rowW + 'px;',
    'border-radius:' + T.chamferCard + 'px;',
    'background:' + (isSelected ? T.green : T.well) + ';',
    'overflow:hidden;',
    'pointer-events:auto;',
    'touch-action:manipulation;',
    'cursor:pointer;',
    'flex-shrink:0;',
  ].join('');

  // Left accent bar (unselected only)
  if (!isSelected) {
    var bar = document.createElement('div');
    bar.style.cssText = [
      'width:' + T.accentBarW + ';',
      'flex-shrink:0;',
      'background:' + T.green + ';',
      'border-radius:' + T.chamferCard + 'px 0 0 ' + T.chamferCard + 'px;',
    ].join('');
    row.appendChild(bar);
  }

  // Content area
  var content = document.createElement('div');
  content.style.cssText = [
    'flex:1;',
    'min-width:0;',
    'padding:8px 10px 8px 8px;',
    'display:flex;',
    'flex-direction:column;',
    'justify-content:center;',
    'gap:2px;',
  ].join('');

  // Top row: name + price
  var topRow = document.createElement('div');
  topRow.style.cssText = 'display:flex;align-items:flex-start;justify-content:space-between;gap:6px;';

  var nameEl = document.createElement('span');
  nameEl.style.cssText = [
    'font-family:' + T.fh + ';',
    'font-size:' + FS_ITEM + ';',
    'font-weight:' + T.fwBold + ';',
    'color:' + (isSelected ? T.moonText : T.text) + ';',
    'flex:1;min-width:0;',
    'white-space:nowrap;overflow:hidden;text-overflow:ellipsis;',
  ].join('');
  if (item.qty > 1) {
    nameEl.textContent = item.qty + '× ' + item.name;
  } else {
    nameEl.textContent = item.name;
  }

  var priceEl = document.createElement('span');
  priceEl.style.cssText = [
    'font-family:' + T.fb + ';',
    'font-size:' + FS_PRICE + ';',
    'font-weight:' + T.fwBold + ';',
    'color:' + (isSelected ? T.moonText : T.gold) + ';',
    'flex-shrink:0;',
    'white-space:nowrap;',
  ].join('');
  priceEl.textContent = fmtMoney(item.price * item.qty);

  topRow.appendChild(nameEl);
  topRow.appendChild(priceEl);
  content.appendChild(topRow);

  // Modifier line
  if (item.mods && item.mods.length) {
    var modEl = document.createElement('span');
    modEl.style.cssText = [
      'font-family:' + T.fb + ';',
      'font-size:' + FS_MOD + ';',
      'color:' + (isSelected ? T.greenDk : T.moon) + ';',
    ].join('');
    modEl.textContent = item.mods.join(', ');
    content.appendChild(modEl);
  }

  row.appendChild(content);

  // Selection checkmark (selected only)
  if (isSelected) {
    var check = document.createElement('div');
    check.style.cssText = [
      'position:absolute;',
      'top:8px;right:8px;',
      'width:16px;height:16px;',
      'border-radius:50%;',
      'background:' + T.well + ';',
      'display:flex;align-items:center;justify-content:center;',
      'font-size:10px;',
      'color:' + T.green + ';',
      'font-weight:' + T.fwBold + ';',
      'flex-shrink:0;',
    ].join('');
    check.textContent = '✓';
    row.appendChild(check);
  }

  return row;
}

// ─────────────────────────────────────────────────
//  RECAP PANEL
// ─────────────────────────────────────────────────

function buildRecapPanel() {
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
  els.recapPanel = panel;

  // ── a) Sub-header ──────────────────────────────
  var subHeader = document.createElement('div');
  subHeader.style.cssText = [
    'height:44px;',
    'flex-shrink:0;',
    'background:' + T.well + ';',
    'border-bottom:1px solid ' + T.border + ';',
    'display:flex;align-items:center;',
    'justify-content:space-between;',
    'padding:0 12px;',
  ].join('');

  var orderLabel = document.createElement('span');
  orderLabel.style.cssText = [
    'font-family:' + T.fb + ';',
    'font-size:' + FS_LABEL + ';',
    'font-weight:' + T.fwBold + ';',
    'color:' + T.green + ';',
    'letter-spacing:2px;',
    'text-transform:uppercase;',
  ].join('');
  orderLabel.textContent = 'ORDER';

  var ticketWrap = document.createElement('div');
  ticketWrap.style.cssText = 'display:flex;flex-direction:column;align-items:flex-end;gap:2px;';

  var ticketNum = document.createElement('span');
  ticketNum.style.cssText = [
    'font-family:' + T.fb + ';',
    'font-size:' + FS_LABEL + ';',
    'color:' + T.moon + ';',
    'letter-spacing:1px;',
  ].join('');
  ticketNum.textContent = ticketLabel(state.ticketNumber);
  ticketWrap.appendChild(ticketNum);

  if (state.ticketName) {
    var nameTag = document.createElement('span');
    nameTag.style.cssText = [
      'font-family:' + T.fb + ';',
      'font-size:' + FS_MOD + ';',
      'color:' + T.moon + ';',
    ].join('');
    nameTag.textContent = state.ticketName;
    ticketWrap.appendChild(nameTag);
  }

  subHeader.appendChild(orderLabel);
  subHeader.appendChild(ticketWrap);
  panel.appendChild(subHeader);

  // ── b) Item list ───────────────────────────────
  var itemList = document.createElement('div');
  itemList.style.cssText = [
    'flex:1;',
    'overflow-y:auto;',
    'padding:8px 12px;',
    'display:flex;flex-direction:column;gap:6px;',
    'min-height:0;',
  ].join('');
  els.itemList = itemList;
  panel.appendChild(itemList);

  // ── c) Void + clear link row ───────────────────
  var voidRow = document.createElement('div');
  voidRow.style.cssText = [
    'display:flex;align-items:center;gap:6px;',
    'padding:4px 12px;',
    'flex-shrink:0;',
    'min-height:22px;',
  ].join('');

  var voidLink = document.createElement('span');
  voidLink.style.cssText = [
    'font-family:' + T.fb + ';',
    'font-size:' + FS_MOD + ';',
    'color:' + T.verm + ';',
    'cursor:pointer;pointer-events:auto;',
    'opacity:0;transition:opacity 0.15s;',
  ].join('');
  voidLink.textContent = 'void item';
  els.voidLink = voidLink;

  var midDot = document.createElement('span');
  midDot.style.cssText = 'font-family:' + T.fb + ';font-size:' + FS_MOD + ';color:' + T.border + ';';
  midDot.textContent = '·';

  var clearLink = document.createElement('span');
  clearLink.style.cssText = [
    'font-family:' + T.fb + ';',
    'font-size:' + FS_MOD + ';',
    'color:' + T.moon + ';',
    'cursor:pointer;pointer-events:auto;',
  ].join('');
  clearLink.textContent = 'clear all';

  voidRow.appendChild(voidLink);
  voidRow.appendChild(midDot);
  voidRow.appendChild(clearLink);
  panel.appendChild(voidRow);

  // Wire clear all link
  clearLink.addEventListener('pointerup', function() {
    state.items        = [];
    state.selectedIdxs = [];
    renderRecap();
  });

  // ── d) Divider ─────────────────────────────────
  var divider = document.createElement('div');
  divider.style.cssText = 'height:1px;background:' + T.border + ';flex-shrink:0;margin:0 12px;';
  panel.appendChild(divider);

  // ── e) Totals block ────────────────────────────
  var totalsBlock = document.createElement('div');
  totalsBlock.style.cssText = [
    'padding:8px 12px 4px;',
    'display:flex;flex-direction:column;gap:4px;',
    'flex-shrink:0;',
  ].join('');

  function makeRow(labelText, valueText, isBold) {
    var r = document.createElement('div');
    r.style.cssText = 'display:flex;justify-content:space-between;align-items:center;';
    var lbl = document.createElement('span');
    lbl.style.cssText = [
      'font-family:' + T.fb + ';',
      'font-size:' + FS_ITEM + ';',
      'color:' + T.moon + ';',
    ].join('');
    lbl.textContent = labelText;
    var val = document.createElement('span');
    val.style.cssText = [
      'font-family:' + T.fb + ';',
      'font-size:' + FS_ITEM + ';',
      'font-weight:' + (isBold ? T.fwBold : T.fwReg) + ';',
      'color:' + T.gold + ';',
    ].join('');
    val.textContent = valueText;
    r.appendChild(lbl);
    r.appendChild(val);
    return { row: r, val: val };
  }

  var sub  = makeRow('Subtotal', '$0.00', false);
  var tax  = makeRow('Tax ' + (state.taxRate * 100).toFixed(2) + '%', '$0.00', false);
  els.subtotalEl = sub.val;
  els.taxEl      = tax.val;
  totalsBlock.appendChild(sub.row);
  totalsBlock.appendChild(tax.row);

  var totalDivider = document.createElement('div');
  totalDivider.style.cssText = 'height:1px;background:' + T.border + ';margin:4px 0;';
  totalsBlock.appendChild(totalDivider);

  var totalRow = document.createElement('div');
  totalRow.style.cssText = 'display:flex;justify-content:space-between;align-items:center;';
  var totalLabel = document.createElement('span');
  totalLabel.style.cssText = [
    'font-family:' + T.fh + ';',
    'font-size:' + FS_ITEM + ';',
    'font-weight:' + T.fwBold + ';',
    'color:' + T.text + ';',
    'letter-spacing:1px;',
    'text-transform:uppercase;',
  ].join('');
  totalLabel.textContent = 'TOTAL';
  var totalVal = document.createElement('span');
  totalVal.style.cssText = [
    'font-family:' + T.fh + ';',
    'font-size:' + FS_TOTAL + ';',
    'font-weight:' + T.fwBold + ';',
    'color:' + T.gold + ';',
  ].join('');
  totalVal.textContent = '$0.00';
  els.totalEl = totalVal;
  totalRow.appendChild(totalLabel);
  totalRow.appendChild(totalVal);
  totalsBlock.appendChild(totalRow);
  panel.appendChild(totalsBlock);

  // ── f) COLLECT PAYMENT label ───────────────────
  var paySection = document.createElement('div');
  paySection.style.cssText = [
    'padding:6px 12px 2px;',
    'flex-shrink:0;',
    'opacity:0;transition:opacity 0.15s;',
  ].join('');
  var payLabel = document.createElement('span');
  payLabel.style.cssText = [
    'font-family:' + T.fb + ';',
    'font-size:' + FS_LABEL + ';',
    'font-weight:' + T.fwBold + ';',
    'color:' + T.green + ';',
    'letter-spacing:2px;',
    'text-transform:uppercase;',
  ].join('');
  payLabel.textContent = 'COLLECT PAYMENT';
  paySection.appendChild(payLabel);
  els.paySection = paySection;
  panel.appendChild(paySection);

  // ── g) Payment button row ──────────────────────
  var payRow = document.createElement('div');
  payRow.style.cssText = [
    'display:flex;gap:6px;',
    'padding:4px 12px;',
    'flex-shrink:0;',
  ].join('');

  function makePayBtn(label, bg, darkBg, subColor) {
    var wrap = document.createElement('div');
    wrap.style.cssText = [
      'flex:1;min-width:0;',
      'display:flex;flex-direction:column;align-items:center;gap:2px;',
      'background:' + bg + ';',
      'border-radius:' + T.chamferBtn + 'px;',
      'padding:8px 4px 6px;',
      'cursor:pointer;pointer-events:auto;touch-action:manipulation;',
      'transition:' + T.transitionFast + ';',
    ].join('');

    var lbl = document.createElement('span');
    lbl.style.cssText = [
      'font-family:' + T.fh + ';',
      'font-size:' + FS_BTN + ';',
      'font-weight:' + T.fwBold + ';',
      'color:' + T.moonText + ';',
      'letter-spacing:0.05em;',
    ].join('');
    lbl.textContent = label;

    var sub = document.createElement('span');
    sub.style.cssText = [
      'font-family:' + T.fb + ';',
      'font-size:' + FS_MOD + ';',
      'color:' + subColor + ';',
    ].join('');
    sub.textContent = '$0.00';

    wrap.appendChild(lbl);
    wrap.appendChild(sub);
    wrap._subEl = sub;

    wrap.addEventListener('pointerdown', function() {
      wrap.style.opacity = '0.8';
    });
    wrap.addEventListener('pointerup', function() {
      wrap.style.opacity = '1';
    });
    wrap.addEventListener('pointerleave', function() {
      wrap.style.opacity = '1';
    });

    return wrap;
  }

  var cashBtn  = makePayBtn('CASH',  T.greenWarm, T.greenWarmDk, T.greenWarmDk);
  var cardBtn  = makePayBtn('CARD',  T.elec,      T.elecDk,      T.elecDk);
  var splitBtn = document.createElement('div');
  splitBtn.style.cssText = [
    'flex:1;min-width:0;',
    'display:flex;flex-direction:column;align-items:center;gap:2px;',
    'background:' + T.card + ';',
    'border:1.5px solid ' + T.border + ';',
    'border-radius:' + T.chamferBtn + 'px;',
    'padding:8px 4px 6px;',
    'cursor:pointer;pointer-events:auto;touch-action:manipulation;',
    'transition:' + T.transitionFast + ';',
  ].join('');
  var splitLbl = document.createElement('span');
  splitLbl.style.cssText = [
    'font-family:' + T.fh + ';',
    'font-size:' + FS_BTN + ';',
    'font-weight:' + T.fwBold + ';',
    'color:' + T.text + ';',
    'letter-spacing:0.05em;',
  ].join('');
  splitLbl.textContent = 'SPLIT';
  var splitSub = document.createElement('span');
  splitSub.style.cssText = [
    'font-family:' + T.fb + ';',
    'font-size:' + FS_MOD + ';',
    'color:' + T.moon + ';',
  ].join('');
  splitSub.textContent = '$0.00';
  splitBtn.appendChild(splitLbl);
  splitBtn.appendChild(splitSub);
  splitBtn._subEl = splitSub;
  splitBtn.addEventListener('pointerdown', function() { splitBtn.style.opacity = '0.8'; });
  splitBtn.addEventListener('pointerup',   function() { splitBtn.style.opacity = '1'; });
  splitBtn.addEventListener('pointerleave',function() { splitBtn.style.opacity = '1'; });

  els.cashBtn  = cashBtn;
  els.cardBtn  = cardBtn;
  els.splitBtn = splitBtn;

  payRow.appendChild(cashBtn);
  payRow.appendChild(cardBtn);
  payRow.appendChild(splitBtn);
  panel.appendChild(payRow);

  // ── h) Action button row ───────────────────────
  var actionRow = document.createElement('div');
  actionRow.style.cssText = [
    'display:flex;gap:6px;',
    'padding:4px 12px 10px;',
    'flex-shrink:0;',
  ].join('');

  function makeActionBtn(label, borderColor, textColor) {
    var wrap = document.createElement('div');
    wrap.style.cssText = [
      'flex:1;min-width:0;',
      'position:relative;',
      'display:flex;flex-direction:column;align-items:center;gap:2px;',
      'background:' + T.card + ';',
      'border:1.5px solid ' + borderColor + ';',
      'border-radius:' + T.chamferBtn + 'px;',
      'padding:8px 4px 6px 8px;',
      'cursor:pointer;pointer-events:auto;touch-action:manipulation;',
      'transition:' + T.transitionFast + ';',
      'overflow:hidden;',
    ].join('');

    // Left accent bar (shown when item selected)
    var accentBar = document.createElement('div');
    accentBar.style.cssText = [
      'position:absolute;left:0;top:0;bottom:0;',
      'width:' + T.accentBarW + ';',
      'background:' + T.green + ';',
      'opacity:0;transition:opacity 0.15s;',
    ].join('');
    wrap._accentBar = accentBar;
    wrap.appendChild(accentBar);

    var lbl = document.createElement('span');
    lbl.style.cssText = [
      'font-family:' + T.fh + ';',
      'font-size:' + FS_BTN + ';',
      'font-weight:' + T.fwBold + ';',
      'color:' + textColor + ';',
      'letter-spacing:0.05em;',
    ].join('');
    lbl.textContent = label;

    var sub = document.createElement('span');
    sub.style.cssText = [
      'font-family:' + T.fb + ';',
      'font-size:' + FS_MOD + ';',
      'color:' + T.moon + ';',
    ].join('');
    sub.textContent = 'order level';

    wrap.appendChild(lbl);
    wrap.appendChild(sub);
    wrap._subEl = sub;

    wrap.addEventListener('pointerdown', function() { wrap.style.opacity = '0.8'; });
    wrap.addEventListener('pointerup',   function() { wrap.style.opacity = '1'; });
    wrap.addEventListener('pointerleave',function() { wrap.style.opacity = '1'; });

    return wrap;
  }

  var discBtn = makeActionBtn('DISCOUNT', T.lavender, T.lavender);
  var voidBtn = makeActionBtn('VOID',     T.verm,     T.verm);
  els.discBtn = discBtn;
  els.voidBtn = voidBtn;

  actionRow.appendChild(discBtn);
  actionRow.appendChild(voidBtn);
  panel.appendChild(actionRow);

  // Initial paint
  renderRecap();

  return panel;
}

// ─────────────────────────────────────────────────
//  RENDER RECAP
// ─────────────────────────────────────────────────

function renderRecap() {
  if (!els.itemList) return;

  // Repaint item list
  els.itemList.innerHTML = '';
  if (state.items.length === 0) {
    var placeholder = document.createElement('div');
    placeholder.style.cssText = [
      'flex:1;display:flex;align-items:center;justify-content:center;',
      'font-family:' + T.fb + ';',
      'font-size:' + FS_MOD + ';',
      'color:' + T.moon + ';',
      'text-align:center;',
      'padding:20px;',
    ].join('');
    placeholder.textContent = 'Add items from the menu';
    els.itemList.appendChild(placeholder);
  } else {
    for (var i = 0; i < state.items.length; i++) {
      var isSelected = state.selectedIdxs.indexOf(i) !== -1;
      els.itemList.appendChild(buildItemRow(state.items[i], i, isSelected));
    }
  }

  // Recompute totals
  var t = computeTotals();
  els.subtotalEl.textContent = fmtMoney(t.subtotal);
  els.taxEl.textContent      = fmtMoney(t.tax);
  els.totalEl.textContent    = fmtMoney(t.total);

  // Update payment button subtitles
  var totalStr = fmtMoney(t.total);
  if (els.cashBtn  && els.cashBtn._subEl)  els.cashBtn._subEl.textContent  = totalStr;
  if (els.cardBtn  && els.cardBtn._subEl)  els.cardBtn._subEl.textContent  = totalStr;
  if (els.splitBtn && els.splitBtn._subEl) els.splitBtn._subEl.textContent = totalStr;

  var hasItems = state.items.length > 0;
  var hasSel   = state.selectedIdxs.length > 0;

  // Toggle payment + action row opacity based on items
  var payOpacity    = hasItems ? '1' : '0.35';
  var payPointer    = hasItems ? 'auto' : 'none';
  if (els.cashBtn)  { els.cashBtn.style.opacity  = payOpacity; els.cashBtn.style.pointerEvents  = payPointer; }
  if (els.cardBtn)  { els.cardBtn.style.opacity  = payOpacity; els.cardBtn.style.pointerEvents  = payPointer; }
  if (els.splitBtn) { els.splitBtn.style.opacity = payOpacity; els.splitBtn.style.pointerEvents = payPointer; }
  if (els.discBtn)  { els.discBtn.style.opacity  = payOpacity; els.discBtn.style.pointerEvents  = payPointer; }
  if (els.voidBtn)  { els.voidBtn.style.opacity  = payOpacity; els.voidBtn.style.pointerEvents  = payPointer; }

  // COLLECT PAYMENT label
  if (els.paySection) els.paySection.style.opacity = hasItems ? '1' : '0';

  // Void link (only when something is selected)
  if (els.voidLink) els.voidLink.style.opacity = hasSel ? '1' : '0';

  // DISCOUNT / VOID subtitle + accent bar based on selection
  if (els.discBtn) {
    els.discBtn._subEl.textContent   = hasSel ? 'item selected' : 'order level';
    els.discBtn._subEl.style.color   = hasSel ? T.green : T.moon;
    els.discBtn._accentBar.style.opacity = hasSel ? '1' : '0';
  }
  if (els.voidBtn) {
    els.voidBtn._subEl.textContent   = hasSel ? 'item selected' : 'order level';
    els.voidBtn._subEl.style.color   = hasSel ? T.green : T.moon;
    els.voidBtn._accentBar.style.opacity = hasSel ? '1' : '0';
  }
}

// ─────────────────────────────────────────────────
//  FAVORITES STRIP
// ─────────────────────────────────────────────────

function buildFavoritesStrip(categories) {
  // Gather top 5 items across all categories by popularity field
  var allItems = [];
  for (var ci = 0; ci < categories.length; ci++) {
    var cat = categories[ci];
    for (var ii = 0; ii < (cat.items || []).length; ii++) {
      allItems.push(cat.items[ii]);
    }
  }
  allItems.sort(function(a, b) {
    var pa = typeof a.popularity === 'number' ? a.popularity : 999;
    var pb = typeof b.popularity === 'number' ? b.popularity : 999;
    return pa - pb;
  });
  var favs = allItems.slice(0, 5);

  if (favs.length === 0) return null;

  var strip = document.createElement('div');
  strip.style.cssText = [
    'position:relative;',
    'height:' + FAV_H + 'px;',
    'width:100%;',
    'display:flex;gap:8px;',
    'padding:8px ' + T.scenePad + 'px;',
    'box-sizing:border-box;',
    'align-items:stretch;',
  ].join('');
  els.favStrip = strip;

  // FAVORITES label — positioned in strip top padding
  var favLabel = document.createElement('span');
  favLabel.style.cssText = [
    'position:absolute;',
    'top:2px;left:' + T.scenePad + 'px;',
    'font-family:' + T.fb + ';',
    'font-size:' + FS_LABEL + ';',
    'color:' + T.green + ';',
    'letter-spacing:2px;',
    'text-transform:uppercase;',
    'pointer-events:none;',
  ].join('');
  favLabel.textContent = 'FAVORITES';
  strip.appendChild(favLabel);

  favs.forEach(function(item) {
    var tile = document.createElement('div');
    tile.dataset.itemKey = item.itemKey || item.key || item.name;
    tile.style.cssText = [
      'flex:1;min-width:0;',
      'display:flex;flex-direction:column;align-items:center;justify-content:center;',
      'background:' + T.card + ';',
      'border-radius:' + T.chamferCard + 'px;',
      'border:1px solid ' + T.green + ';',
      'position:relative;',
      'overflow:hidden;',
      'cursor:pointer;pointer-events:auto;touch-action:manipulation;',
      'gap:2px;',
      'padding:4px;',
    ].join('');

    // Green top accent bar
    var topBar = document.createElement('div');
    topBar.style.cssText = [
      'position:absolute;top:0;left:0;right:0;',
      'height:' + T.accentBarW + ';',
      'background:' + T.green + ';',
      'border-radius:' + T.chamferCard + 'px ' + T.chamferCard + 'px 0 0;',
    ].join('');
    tile.appendChild(topBar);

    var nameEl = document.createElement('span');
    nameEl.style.cssText = [
      'font-family:' + T.fh + ';',
      'font-size:' + FS_TILE + ';',
      'font-weight:' + T.fwBold + ';',
      'color:' + T.text + ';',
      'text-align:center;',
      'line-height:1.2;',
      'word-break:break-word;',
      'margin-top:4px;',
    ].join('');
    nameEl.textContent = item.name;

    var priceEl = document.createElement('span');
    priceEl.style.cssText = [
      'font-family:' + T.fb + ';',
      'font-size:' + FS_MOD + ';',
      'color:' + T.gold + ';',
      'text-align:center;',
    ].join('');
    priceEl.textContent = fmtMoney(item.price || 0);

    tile.appendChild(nameEl);
    tile.appendChild(priceEl);
    strip.appendChild(tile);
  });

  return strip;
}

// ─────────────────────────────────────────────────
//  CATEGORY COLUMN
// ─────────────────────────────────────────────────

function buildCategoryColumn(categories, favH) {
  var fH = typeof favH === 'number' ? favH : FAV_H;
  var col = document.createElement('div');
  col.style.cssText = [
    'position:absolute;',
    'left:0;top:' + fH + 'px;',
    'width:' + CAT_W + 'px;',
    'height:' + (CONTENT_H - fH) + 'px;',
    'overflow-y:auto;',
    'display:flex;flex-direction:column;gap:6px;',
    'padding:6px;',
    'box-sizing:border-box;',
  ].join('');
  els.categoryColumn = col;

  // Vertical divider on right edge
  var divider = document.createElement('div');
  divider.style.cssText = [
    'position:absolute;',
    'right:0;top:0;',
    'width:1px;height:100%;',
    'background:' + T.border + ';',
    'opacity:0.4;',
    'pointer-events:none;',
  ].join('');
  col.appendChild(divider);

  categories.forEach(function(cat) {
    var isActive = cat.key === state.activeCategory;
    var catColor = cat.color || T.moon;

    var tile = document.createElement('div');
    tile.dataset.categoryKey = cat.key;
    tile.style.cssText = [
      'height:70px;',
      'border-radius:' + T.chamferCard + 'px;',
      'flex-shrink:0;',
      'position:relative;',
      'overflow:hidden;',
      'cursor:pointer;pointer-events:auto;touch-action:manipulation;',
      'display:flex;flex-direction:column;align-items:center;justify-content:center;',
      'gap:2px;',
      'transition:' + T.transitionFast + ';',
      isActive
        ? 'background:' + catColor + ';'
        : 'background:' + T.card + ';border:1px solid ' + T.border + ';',
    ].join('');

    // Left accent bar (inactive only)
    if (!isActive) {
      var bar = document.createElement('div');
      bar.style.cssText = [
        'position:absolute;left:0;top:0;bottom:0;',
        'width:' + T.accentBarW + ';',
        'background:' + catColor + ';',
        'border-radius:' + T.chamferCard + 'px 0 0 ' + T.chamferCard + 'px;',
      ].join('');
      tile.appendChild(bar);
    }

    var labelEl = document.createElement('span');
    labelEl.style.cssText = [
      'font-family:' + T.fh + ';',
      'font-size:' + FS_CAT + ';',
      'font-weight:' + T.fwBold + ';',
      'color:' + (isActive ? T.moonText : T.text) + ';',
      'text-align:center;',
      'z-index:1;',
    ].join('');
    labelEl.textContent = cat.label;

    var countEl = document.createElement('span');
    countEl.style.cssText = [
      'font-family:' + T.fb + ';',
      'font-size:' + FS_MOD + ';',
      'color:' + (isActive ? darkenHex(catColor, 0.4) : T.moon) + ';',
      'text-align:center;',
      'z-index:1;',
    ].join('');
    countEl.textContent = (cat.items || []).length + ' items';

    tile.appendChild(labelEl);
    tile.appendChild(countEl);
    col.appendChild(tile);
  });

  var filler = document.createElement('div');
  filler.style.cssText = 'flex:1;background:' + T.well + ';';
  col.appendChild(filler);

  return col;
}

// ─────────────────────────────────────────────────
//  ITEM GRID
// ─────────────────────────────────────────────────

function buildItemGrid(items, favH) {
  var fH = typeof favH === 'number' ? favH : FAV_H;
  var grid = document.createElement('div');
  els.itemGrid = grid;

  if ((items || []).length === 0) {
    grid.style.cssText = [
      'position:absolute;',
      'left:' + (CAT_W + 1) + 'px;',
      'top:' + fH + 'px;',
      'width:' + GRID_W + 'px;',
      'height:' + (CONTENT_H - fH) + 'px;',
      'display:flex;align-items:center;justify-content:center;',
      'flex-direction:column;gap:12px;',
      'box-sizing:border-box;',
    ].join('');

    var emptyIcon = document.createElement('div');
    emptyIcon.style.cssText = [
      'width:48px;height:48px;border-radius:50%;',
      'border:2px dashed ' + T.border + ';',
      'display:flex;align-items:center;justify-content:center;',
      'font-family:' + T.fb + ';font-size:20px;color:' + T.moon + ';',
    ].join('');
    emptyIcon.textContent = '?';

    var emptyLine1 = document.createElement('span');
    emptyLine1.style.cssText = 'font-family:' + T.fb + ';font-size:' + FS_BODY + ';color:' + T.moon + ';';
    emptyLine1.textContent = 'No items in this category';

    var emptyLine2 = document.createElement('span');
    emptyLine2.style.cssText = 'font-family:' + T.fb + ';font-size:12px;color:' + T.border + ';';
    emptyLine2.textContent = 'Add items in Overseer → Menu';

    grid.appendChild(emptyIcon);
    grid.appendChild(emptyLine1);
    grid.appendChild(emptyLine2);
    return grid;
  }

  grid.style.cssText = [
    'position:absolute;',
    'left:' + (CAT_W + 1) + 'px;',
    'top:' + fH + 'px;',
    'width:' + GRID_W + 'px;',
    'height:' + (CONTENT_H - fH) + 'px;',
    'display:grid;',
    'grid-template-columns:repeat(3,1fr);',
    'gap:8px;',
    'padding:8px;',
    'box-sizing:border-box;',
    'overflow-y:auto;',
    'align-content:start;',
  ].join('');

  (items || []).forEach(function(item) {
    var tile = document.createElement('div');
    tile.dataset.itemKey = item.itemKey || item.key || item.name;
    tile.style.cssText = [
      'border-radius:' + T.chamferCard + 'px;',
      'min-height:130px;',
      'background:' + T.card + ';',
      'border:1px solid ' + T.border + ';',
      'display:flex;flex-direction:column;align-items:center;justify-content:center;',
      'gap:6px;',
      'padding:12px 8px;',
      'box-sizing:border-box;',
      'cursor:pointer;pointer-events:auto;touch-action:manipulation;',
      'transition:' + T.transitionFast + ';',
    ].join('');

    var nameEl = document.createElement('span');
    nameEl.style.cssText = [
      'font-family:' + T.fh + ';',
      'font-size:' + FS_TILE + ';',
      'font-weight:' + T.fwBold + ';',
      'color:' + T.text + ';',
      'text-align:center;',
      'line-height:1.3;',
      'word-break:break-word;',
    ].join('');
    nameEl.textContent = item.name;

    var priceEl = document.createElement('span');
    priceEl.style.cssText = [
      'font-family:' + T.fb + ';',
      'font-size:' + FS_PRICE + ';',
      'color:' + T.gold + ';',
      'text-align:center;',
    ].join('');
    priceEl.textContent = fmtMoney(item.price || 0);

    tile.appendChild(nameEl);
    tile.appendChild(priceEl);

    // Tap flash
    tile.addEventListener('pointerdown', function() {
      tile.style.background = hexToRgba(T.green, 0.15);
    });
    var restoreTile = function() {
      setTimeout(function() { tile.style.background = T.card; }, 120);
    };
    tile.addEventListener('pointerup',    restoreTile);
    tile.addEventListener('pointerleave', restoreTile);
    tile.addEventListener('pointercancel',restoreTile);

    grid.appendChild(tile);
  });

  return grid;
}

// ─────────────────────────────────────────────────
//  REPAINT HELPERS (for switchCategory)
// ─────────────────────────────────────────────────

function repaintItemGrid(items) {
  if (!els.itemGrid) return;
  els.itemGrid.innerHTML = '';

  if ((items || []).length === 0) {
    els.itemGrid.style.display = 'flex';
    els.itemGrid.style.alignItems = 'center';
    els.itemGrid.style.justifyContent = 'center';
    els.itemGrid.style.flexDirection = 'column';
    els.itemGrid.style.gap = '12px';

    var emptyIcon = document.createElement('div');
    emptyIcon.style.cssText = [
      'width:48px;height:48px;border-radius:50%;',
      'border:2px dashed ' + T.border + ';',
      'display:flex;align-items:center;justify-content:center;',
      'font-family:' + T.fb + ';font-size:20px;color:' + T.moon + ';',
    ].join('');
    emptyIcon.textContent = '?';

    var emptyLine1 = document.createElement('span');
    emptyLine1.style.cssText = 'font-family:' + T.fb + ';font-size:' + FS_BODY + ';color:' + T.moon + ';';
    emptyLine1.textContent = 'No items in this category';

    var emptyLine2 = document.createElement('span');
    emptyLine2.style.cssText = 'font-family:' + T.fb + ';font-size:12px;color:' + T.border + ';';
    emptyLine2.textContent = 'Add items in Overseer → Menu';

    els.itemGrid.appendChild(emptyIcon);
    els.itemGrid.appendChild(emptyLine1);
    els.itemGrid.appendChild(emptyLine2);
    return;
  }

  els.itemGrid.style.display = 'grid';
  els.itemGrid.style.alignItems = '';
  els.itemGrid.style.justifyContent = '';
  els.itemGrid.style.flexDirection = '';
  els.itemGrid.style.gap = '8px';

  (items || []).forEach(function(item) {
    var tile = document.createElement('div');
    tile.dataset.itemKey = item.itemKey || item.key || item.name;
    tile.style.cssText = [
      'border-radius:' + T.chamferCard + 'px;',
      'min-height:130px;',
      'background:' + T.card + ';',
      'border:1px solid ' + T.border + ';',
      'display:flex;flex-direction:column;align-items:center;justify-content:center;',
      'gap:6px;',
      'padding:12px 8px;',
      'box-sizing:border-box;',
      'cursor:pointer;pointer-events:auto;touch-action:manipulation;',
      'transition:' + T.transitionFast + ';',
    ].join('');

    var nameEl = document.createElement('span');
    nameEl.style.cssText = [
      'font-family:' + T.fh + ';',
      'font-size:' + FS_TILE + ';',
      'font-weight:' + T.fwBold + ';',
      'color:' + T.text + ';',
      'text-align:center;',
      'line-height:1.3;',
      'word-break:break-word;',
    ].join('');
    nameEl.textContent = item.name;

    var priceEl = document.createElement('span');
    priceEl.style.cssText = [
      'font-family:' + T.fb + ';',
      'font-size:' + FS_PRICE + ';',
      'color:' + T.gold + ';',
      'text-align:center;',
    ].join('');
    priceEl.textContent = fmtMoney(item.price || 0);

    tile.appendChild(nameEl);
    tile.appendChild(priceEl);

    tile.addEventListener('pointerdown', function() {
      tile.style.background = hexToRgba(T.green, 0.15);
    });
    var restoreTile = function() {
      setTimeout(function() { tile.style.background = T.card; }, 120);
    };
    tile.addEventListener('pointerup',    restoreTile);
    tile.addEventListener('pointerleave', restoreTile);
    tile.addEventListener('pointercancel',restoreTile);

    els.itemGrid.appendChild(tile);
  });
}

function repaintCategoryColumn() {
  if (!els.categoryColumn) return;
  // Keep divider (first child), replace category tiles
  var divider = els.categoryColumn.firstChild;
  els.categoryColumn.innerHTML = '';
  if (divider) els.categoryColumn.appendChild(divider);

  state.categories.forEach(function(cat) {
    var isActive = cat.key === state.activeCategory;
    var catColor = cat.color || T.moon;

    var tile = document.createElement('div');
    tile.dataset.categoryKey = cat.key;
    tile.style.cssText = [
      'height:70px;',
      'border-radius:' + T.chamferCard + 'px;',
      'flex-shrink:0;',
      'position:relative;',
      'overflow:hidden;',
      'cursor:pointer;pointer-events:auto;touch-action:manipulation;',
      'display:flex;flex-direction:column;align-items:center;justify-content:center;',
      'gap:2px;',
      'transition:' + T.transitionFast + ';',
      isActive
        ? 'background:' + catColor + ';'
        : 'background:' + T.card + ';border:1px solid ' + T.border + ';',
    ].join('');

    if (!isActive) {
      var bar = document.createElement('div');
      bar.style.cssText = [
        'position:absolute;left:0;top:0;bottom:0;',
        'width:' + T.accentBarW + ';',
        'background:' + catColor + ';',
        'border-radius:' + T.chamferCard + 'px 0 0 ' + T.chamferCard + 'px;',
      ].join('');
      tile.appendChild(bar);
    }

    var labelEl = document.createElement('span');
    labelEl.style.cssText = [
      'font-family:' + T.fh + ';',
      'font-size:' + FS_CAT + ';',
      'font-weight:' + T.fwBold + ';',
      'color:' + (isActive ? T.moonText : T.text) + ';',
      'text-align:center;z-index:1;',
    ].join('');
    labelEl.textContent = cat.label;

    var countEl = document.createElement('span');
    countEl.style.cssText = [
      'font-family:' + T.fb + ';',
      'font-size:' + FS_MOD + ';',
      'color:' + (isActive ? darkenHex(catColor, 0.4) : T.moon) + ';',
      'text-align:center;z-index:1;',
    ].join('');
    countEl.textContent = (cat.items || []).length + ' items';

    tile.appendChild(labelEl);
    tile.appendChild(countEl);
    els.categoryColumn.appendChild(tile);
  });
}

// ─────────────────────────────────────────────────
//  STATE MANAGEMENT
// ─────────────────────────────────────────────────

function addItem(itemKey) {
  var found = null;
  for (var ci = 0; ci < state.categories.length; ci++) {
    var cat = state.categories[ci];
    for (var ii = 0; ii < (cat.items || []).length; ii++) {
      var it = cat.items[ii];
      var key = it.itemKey || it.key || it.name;
      if (key === itemKey) { found = it; break; }
    }
    if (found) break;
  }
  if (!found) return;

  // Merge with last item if same key and no mods
  var last = state.items[state.items.length - 1];
  var lastKey = last ? (last.itemKey || last.name) : null;
  if (last && lastKey === itemKey && (!last.mods || last.mods.length === 0)) {
    last.qty += 1;
  } else {
    state.items.push({
      name:    found.name,
      price:   found.price || 0,
      mods:    [],
      qty:     1,
      itemKey: itemKey,
    });
  }
  renderRecap();
}

function toggleItemSelection(idx) {
  var pos = state.selectedIdxs.indexOf(idx);
  if (pos !== -1) {
    state.selectedIdxs.splice(pos, 1);
  } else {
    state.selectedIdxs.push(idx);
  }
  renderRecap();
}

function clearSelection() {
  state.selectedIdxs = [];
  renderRecap();
}

function switchCategory(key) {
  state.activeCategory = key;
  var cat = null;
  for (var i = 0; i < state.categories.length; i++) {
    if (state.categories[i].key === key) { cat = state.categories[i]; break; }
  }
  repaintItemGrid(cat ? cat.items : []);
  repaintCategoryColumn();
  // Re-wire grid tap handler after repaint
  if (els.itemGrid) {
    els.itemGrid.removeEventListener('pointerup', _onGridTap);
    els.itemGrid.addEventListener('pointerup', _onGridTap);
  }
}

// ─────────────────────────────────────────────────
//  TAP HANDLERS (named so they can be re-wired)
// ─────────────────────────────────────────────────

function _onGridTap(e) {
  var tile = e.target.closest('[data-item-key]');
  if (!tile) return;
  addItem(tile.dataset.itemKey);
}

function _onFavTap(e) {
  var tile = e.target.closest('[data-item-key]');
  if (!tile) return;
  addItem(tile.dataset.itemKey);
}

function _onCatTap(e) {
  var tile = e.target.closest('[data-category-key]');
  if (!tile) return;
  switchCategory(tile.dataset.categoryKey);
}

function _onItemListTap(e) {
  var row = e.target.closest('[data-item-idx]');
  if (!row) { clearSelection(); return; }
  toggleItemSelection(parseInt(row.dataset.itemIdx, 10));
}

// ─────────────────────────────────────────────────
//  WIRE HANDLERS
// ─────────────────────────────────────────────────

function wireHandlers() {
  // Item list — selection
  if (els.itemList) {
    els.itemList.addEventListener('pointerup', _onItemListTap);
  }

  // Item grid — add item
  if (els.itemGrid) {
    els.itemGrid.addEventListener('pointerup', _onGridTap);
  }

  // Favorites strip — add item
  if (els.favStrip) {
    els.favStrip.addEventListener('pointerup', _onFavTap);
  }

  // Category column — switch category
  if (els.categoryColumn) {
    els.categoryColumn.addEventListener('pointerup', _onCatTap);
  }

  // Payment buttons
  if (els.cashBtn) {
    els.cashBtn.addEventListener('pointerup', function() {
      if (!state.items.length) return;
      SceneManager.mountWorking('qsr-cash', { order: buildOrderPayload() });
    });
  }
  if (els.cardBtn) {
    els.cardBtn.addEventListener('pointerup', function() {
      if (!state.items.length) return;
      SceneManager.mountWorking('qsr-card', { order: buildOrderPayload() });
    });
  }
  if (els.splitBtn) {
    els.splitBtn.addEventListener('pointerup', function() {
      if (!state.items.length) return;
      SceneManager.openTransactional('qsr-split', { order: buildOrderPayload() });
    });
  }

  // Discount button
  if (els.discBtn) {
    els.discBtn.addEventListener('pointerup', function() {
      if (!state.items.length) return;
      var isItemLevel = state.selectedIdxs.length > 0;
      SceneManager.openInterrupt('manager-pin', {
        reason: isItemLevel ? 'Discount item' : 'Discount order',
        onConfirm: function() {
          SceneManager.closeInterrupt('manager-pin');
          SceneManager.openInterrupt('disc-select', {
            orderId:       state.orderId,
            selectedItems: isItemLevel
              ? state.selectedIdxs.map(function(i) { return state.items[i]; })
              : state.items,
            onConfirm: function(discountPayload) {
              applyDiscount(discountPayload);
            },
          });
        },
        onCancel: function() {
          SceneManager.closeInterrupt('manager-pin');
        },
      });
    });
  }

  // Void button
  if (els.voidBtn) {
    els.voidBtn.addEventListener('pointerup', function() {
      if (!state.items.length) return;
      var isItemLevel = state.selectedIdxs.length > 0;
      var label = isItemLevel ? 'Void selected item(s)?' : 'Void entire order?';
      SceneManager.openInterrupt('manager-pin', {
        reason: label,
        onConfirm: function() {
          SceneManager.closeInterrupt('manager-pin');
          executeVoid(isItemLevel);
        },
        onCancel: function() {
          SceneManager.closeInterrupt('manager-pin');
        },
      });
    });
  }
}

// ─────────────────────────────────────────────────
//  ORDER PAYLOAD
// ─────────────────────────────────────────────────

function buildOrderPayload() {
  var t = computeTotals();
  return {
    orderId:      state.orderId,
    ticketNumber: state.ticketNumber,
    ticketName:   state.ticketName,
    items:        state.items,
    subtotal:     t.subtotal,
    tax:          t.tax,
    total:        t.total,
    taxRate:         state.taxRate,
    cashDiscountRate: state.cashDiscountRate,
  };
}

// ─────────────────────────────────────────────────
//  VOID EXECUTION
// ─────────────────────────────────────────────────

function executeVoid(isItemLevel) {
  if (isItemLevel) {
    // Remove selected items in reverse order to preserve indices
    var idxs = state.selectedIdxs.slice().sort(function(a, b) { return b - a; });
    idxs.forEach(function(idx) {
      state.items.splice(idx, 1);
    });
    state.selectedIdxs = [];
    renderRecap();
    showToast('Item(s) voided');

    // TODO: POST void to backend when orderId is set
    if (state.orderId) {
      // TODO: fetchWithTimeout('/api/v1/orders/' + state.orderId + '/items/void', ...)
    }
  } else {
    state.items        = [];
    state.selectedIdxs = [];
    state.orderId      = null;
    renderRecap();
    showToast('Order voided');

    // TODO: POST void to backend when orderId was set
  }
}

// ─────────────────────────────────────────────────
//  DISCOUNT APPLICATION (stub — wired via disc-select)
// ─────────────────────────────────────────────────

function applyDiscount(discountPayload) {
  // Applied server-side; refresh recap or show confirmation
  showToast('Discount applied');
  renderRecap();
}

// ─────────────────────────────────────────────────
//  RIGHT SURFACE
// ─────────────────────────────────────────────────

function buildRightSurface(categories) {
  var rightEl = document.createElement('div');
  rightEl.style.cssText = [
    'position:absolute;',
    'left:' + (RECAP_W + 1) + 'px;',
    'top:' + T.headerH + 'px;',
    'width:' + RIGHT_W + 'px;',
    'height:' + CONTENT_H + 'px;',
    'background:' + T.bg + ';',
    'overflow:hidden;',
    'position:relative;',
  ].join('');

  var favEl = buildFavoritesStrip(categories);
  var favH = favEl ? FAV_H : 0;

  if (favEl) {
    rightEl.appendChild(favEl);

    // Divider below favorites
    var divider = document.createElement('div');
    divider.style.cssText = [
      'position:absolute;',
      'top:' + favH + 'px;left:0;',
      'width:100%;height:1px;',
      'background:' + T.border + ';opacity:0.5;',
    ].join('');
    rightEl.appendChild(divider);
  }

  rightEl.appendChild(buildCategoryColumn(categories, favH));
  rightEl.appendChild(buildItemGrid(
    categories.length > 0 ? categories[0].items : [],
    favH
  ));

  els.rightSurface = rightEl;
  return rightEl;
}

// ─────────────────────────────────────────────────
//  DATA FETCH
// ─────────────────────────────────────────────────

function fetchMenuData() {
  return fetchWithTimeout('/api/v1/menu', {}, 10000)
    .then(function(r) { return r.json(); })
    .then(function(menu) {
      // Group flat items list by category_id
      var itemsByCategory = {};
      (menu.items || []).forEach(function(it) {
        var cid = it.category_id;
        if (!itemsByCategory[cid]) itemsByCategory[cid] = [];
        itemsByCategory[cid].push(it);
      });

      var cats = (menu.categories || []).slice();
      cats.sort(function(a, b) {
        return (a.display_order || 999) - (b.display_order || 999);
      });
      return cats.map(function(cat) {
        var key   = (cat.name || cat.category_id || '').toUpperCase();
        var color = T.categoryPalette[key] || T.moon;
        var rawItems = itemsByCategory[cat.category_id] || [];
        var items = rawItems.map(function(it) {
          return {
            itemKey:    it.item_id,
            name:       it.name,
            price:      it.price || 0,
            popularity: it.display_order || 0,
          };
        });
        return {
          key:   key,
          label: cat.label || cat.name,
          color: color,
          items: items,
        };
      });
    })
    .catch(function() {
      return MOCK_MENU;
    });
}

function fetchStoreConfig() {
  return fetchWithTimeout('/api/v1/config/store', {}, 10000)
    .then(function(r) { return r.json(); })
    .then(function(cfg) {
      if (cfg && typeof cfg.tax_rate === 'number') {
        state.taxRate = cfg.tax_rate;
      }
      state.cashDiscountRate = parseFloat(cfg && cfg.cash_discount_rate || 0);
    })
    .catch(function() {
      // keep default state.taxRate
    });
}

// ─────────────────────────────────────────────────
//  SCENE REGISTRATION
// ─────────────────────────────────────────────────

defineScene('qsr-order', {
  mount: async function(container, params) {
    // Reset state for new order
    state.items          = [];
    state.selectedIdxs   = [];
    state.activeCategory = null;
    state.orderId        = null;
    state.ticketNumber   = (params && params.ticketNumber) || 1;
    state.ticketName     = (params && params.ticketName)   || '';

    // Fetch menu + config in parallel
    var results    = await Promise.all([fetchMenuData(), fetchStoreConfig()]);
    var categories = results[0];

    state.categories    = categories;
    state.activeCategory = categories.length > 0 ? categories[0].key : null;

    // Build layout with real data
    var recapEl = buildRecapPanel();
    var rightEl = buildRightSurface(categories);
    container.appendChild(recapEl);
    container.appendChild(rightEl);

    // Wire all tap handlers
    wireHandlers();
  },

  unmount: function() {
    // Clean up any pending fetch references
    els.recapPanel     = null;
    els.itemList       = null;
    els.totalEl        = null;
    els.subtotalEl     = null;
    els.taxEl          = null;
    els.cashBtn        = null;
    els.cardBtn        = null;
    els.splitBtn       = null;
    els.discBtn        = null;
    els.voidBtn        = null;
    els.paySection     = null;
    els.voidLink       = null;
    els.categoryColumn = null;
    els.itemGrid       = null;
    els.favStrip       = null;
    els.rightSurface   = null;
  },
});
