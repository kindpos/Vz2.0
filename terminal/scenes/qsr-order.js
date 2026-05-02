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

var RECAP_W    = T.pcLeftW;              // 340 — left panel, fixed
var RIGHT_W    = T.appW - RECAP_W - 1;  // 683 — right working surface
var FAV_H      = 88;                     // Favorites strip height
var CAT_W      = 160;                    // Category column width
var GRID_W     = RIGHT_W - CAT_W - 1;   // Item grid width
var CONTENT_H  = T.appH - T.headerH;    // 548 — below header

// TODO: replace with GET /api/v1/menu/categories once menus are populated
var MOCK_MENU = [
  {
    key: 'BURGERS', label: 'Burgers', color: '#fb923c',
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
    key: 'SIDES', label: 'Sides', color: '#facc15',
    items: [
      { itemKey: 'fries-sm',   name: 'Fries (Sm)',    price: 3.50, popularity: 1 },
      { itemKey: 'fries-lg',   name: 'Fries (Lg)',    price: 4.50, popularity: 2 },
      { itemKey: 'rings',      name: 'Onion Rings',   price: 5.00, popularity: 3 },
      { itemKey: 'coleslaw',   name: 'Coleslaw',      price: 2.50, popularity: 4 },
    ],
  },
  {
    key: 'DRINKS', label: 'Drinks', color: '#e879f9',
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
  discountRowEl: null,
  discountValEl: null,
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

function moneyRound(x) { return Math.round(x * 100) / 100; }

function totalDiscountPct(item) {
  return (item.discounts || []).reduce(function(sum, d) {
    return sum + (d.pct || 0);
  }, 0);
}

function discountedPrice(item) {
  var pct = totalDiscountPct(item);
  if (pct <= 0) return item.price;
  return moneyRound(item.price * (1 - pct / 100));
}

function computeTotals() {
  var subtotal = 0;
  for (var i = 0; i < state.items.length; i++) {
    subtotal += discountedPrice(state.items[i]) * (state.items[i].qty || 1);
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
//  DISCOUNT SUB-CARD
// ─────────────────────────────────────────────────

function buildDiscountSubCard(item, itemIdx) {
  var wrap = document.createElement('div');
  wrap.style.marginTop     = '2px';
  wrap.style.marginLeft    = '8px';
  wrap.style.background    = T.well;
  wrap.style.borderRadius  = '6px';
  wrap.style.border        = '1px solid ' + hexToRgba(T.lavender, 0.45);
  wrap.style.borderLeft    = '3px solid ' + hexToRgba(T.lavender, 0.55);
  wrap.style.padding       = '4px 8px';
  wrap.style.display       = 'flex';
  wrap.style.flexDirection = 'column';

  var discounts = item.discounts || [];
  discounts.forEach(function(d, di) {
    if (di > 0) {
      var divider = document.createElement('div');
      divider.style.cssText = 'height:1px;background:' + T.border + ';margin:3px 0;';
      wrap.appendChild(divider);
    }

    var row = document.createElement('div');
    row.style.cssText = 'display:flex;justify-content:space-between;align-items:center;gap:8px;';

    var left = document.createElement('div');
    left.style.cssText = 'display:flex;flex-direction:column;gap:2px;flex:1;min-width:0;';

    var namePct = document.createElement('span');
    namePct.style.cssText = [
      'font-family:' + T.fb + ';',
      'font-size:' + T.fsB4 + ';',
      'font-weight:' + T.fwBold + ';',
      'color:' + T.lavender + ';',
    ].join('');
    namePct.textContent = (d.name || d.label || 'Discount') + '  ' + (d.pct || 0) + '%';

    var savings = document.createElement('span');
    savings.style.cssText = [
      'font-family:' + T.fb + ';',
      'font-size:10px;',
      'font-weight:' + T.fwBold + ';',
      'color:' + T.moon + ';',
    ].join('');
    savings.textContent = '−' + fmt(moneyRound(item.price * (d.pct || 0) / 100));

    left.appendChild(namePct);
    left.appendChild(savings);

    var removeBtn = document.createElement('div');
    removeBtn.style.cssText = [
      'width:18px;height:18px;',
      'border-radius:4px;',
      'background:' + T.verm + ';',
      'display:flex;align-items:center;justify-content:center;',
      'cursor:pointer;pointer-events:auto;touch-action:manipulation;',
      'font-family:' + T.fb + ';font-size:10px;font-weight:' + T.fwBold + ';',
      'color:#fff;',
      'flex-shrink:0;',
    ].join('');
    removeBtn.textContent = '✕';

    ;(function(capturedIdx) {
      removeBtn.addEventListener('pointerup', function(e) {
        e.stopPropagation();
        removeDiscount(itemIdx, capturedIdx);
      });
    })(di);

    row.appendChild(left);
    row.appendChild(removeBtn);
    wrap.appendChild(row);
  });

  return wrap;
}

// ─────────────────────────────────────────────────
//  ITEM ROW
// ─────────────────────────────────────────────────

function buildItemRow(item, idx, isSelected) {
  var hasDiscount = !!(item.discounts && item.discounts.length > 0);
  var bevelLt = _lighten(T.bg, 0.08);
  var bevelDk = darkenHex(T.bg, 0.2);

  var card = document.createElement('div');
  card.style.cssText = [
    'position:relative;',
    'display:flex;flex-direction:column;justify-content:center;gap:2px;',
    'background:' + (isSelected ? T.green : T.well) + ';',
    'border-radius:8px;',
    'border-top:2px solid '    + (isSelected ? T.greenDk : bevelLt) + ';',
    'border-right:2px solid '  + (isSelected ? T.greenDk : bevelDk) + ';',
    'border-bottom:2px solid ' + (isSelected ? T.greenDk : bevelDk) + ';',
    'border-left:3px solid '   + (isSelected ? T.greenDk : (hasDiscount ? T.lavender : T.moon)) + ';',
    'padding:6px 10px;',
    'box-shadow:' + (isSelected ? '0 2px 0 ' + T.greenDk : 'none') + ';',
    'pointer-events:auto;touch-action:manipulation;cursor:pointer;flex-shrink:0;',
  ].join('');

  // Top row: name + price (qty rendered inline as "qty× name")
  // padding-right reserves space for the absolute ✕ remove button.
  var topRow = document.createElement('div');
  topRow.style.cssText = 'display:flex;align-items:center;justify-content:space-between;gap:6px;padding-right:28px;';

  var nameEl = document.createElement('span');
  nameEl.style.cssText = [
    'font-family:' + T.fb + ';',
    'font-size:' + FS_ITEM + ';',
    'font-weight:' + T.fwBold + ';',
    'color:' + (isSelected ? T.well : T.text) + ';',
    'flex:1;min-width:0;',
    'white-space:nowrap;overflow:hidden;text-overflow:ellipsis;',
  ].join('');
  nameEl.textContent = (item.qty > 1 ? item.qty + '× ' : '') + item.name;

  var priceArea = document.createElement('div');
  priceArea.style.cssText = 'display:flex;flex-direction:column;align-items:flex-end;flex-shrink:0;white-space:nowrap;';

  if (hasDiscount && !isSelected) {
    var origPrice = document.createElement('span');
    origPrice.style.cssText = [
      'font-family:' + T.fb + ';',
      'font-size:' + T.fsB4 + ';',
      'font-weight:' + T.fwBold + ';',
      'color:' + T.moon + ';',
      'text-decoration:line-through;',
    ].join('');
    origPrice.textContent = fmt(item.price * (item.qty || 1));

    var discPrice = document.createElement('span');
    discPrice.style.cssText = [
      'font-family:' + T.fb + ';',
      'font-size:' + FS_PRICE + ';',
      'font-weight:' + T.fwBold + ';',
      'color:' + T.lavender + ';',
    ].join('');
    discPrice.textContent = fmt(discountedPrice(item) * (item.qty || 1));

    priceArea.appendChild(origPrice);
    priceArea.appendChild(discPrice);
  } else {
    var priceEl = document.createElement('span');
    priceEl.style.cssText = [
      'font-family:' + T.fb + ';',
      'font-size:' + FS_PRICE + ';',
      'font-weight:' + T.fwBold + ';',
      'color:' + (isSelected ? T.well : (item.price > 0 ? T.gold : T.moon)) + ';',
      'white-space:nowrap;',
    ].join('');
    priceEl.textContent = item.price > 0 ? fmtMoney(item.price * (item.qty || 1)) : '—';
    priceArea.appendChild(priceEl);
  }

  topRow.appendChild(nameEl);
  topRow.appendChild(priceArea);
  card.appendChild(topRow);

  // ✕ remove button — absolute top-right of card
  var removeBtn = document.createElement('div');
  removeBtn.style.cssText = [
    'position:absolute;top:6px;right:6px;',
    'width:20px;height:20px;',
    'border-radius:4px;',
    'background:' + T.verm + ';',
    'display:flex;align-items:center;justify-content:center;',
    'cursor:pointer;pointer-events:auto;touch-action:manipulation;',
    'font-family:' + T.fb + ';font-size:11px;font-weight:' + T.fwBold + ';',
    'color:#fff;',
    'opacity:0.85;',
    'flex-shrink:0;',
  ].join('');
  removeBtn.textContent = '✕';
  removeBtn.addEventListener('pointerup', function(e) {
    e.stopPropagation();
    removeItem(idx);
  });
  card.appendChild(removeBtn);

  // Wrap card (and optional mod tree) in a flex column block.
  var block = document.createElement('div');
  block.dataset.itemIdx = idx;
  block.style.display = 'flex';
  block.style.flexDirection = 'column';
  block.appendChild(card);
  if (hasDiscount) block.appendChild(buildDiscountSubCard(item, idx));

  // Snake mod tree — rendered below the card, not inside it.
  if (item.mods && item.mods.length > 0) {
    var tree = document.createElement('div');
    tree.style.cssText = [
      'position:relative;',
      'display:flex;flex-direction:column;',
      'gap:0px;',
      'margin-top:2px;',
      'margin-left:12px;',
      'padding-bottom:2px;',
    ].join('');

    // Vertical trunk line
    var trunk = document.createElement('div');
    trunk.style.cssText = [
      'position:absolute;',
      'left:10px;top:0;',
      'width:1.5px;',
      'height:calc(100% - 10px);',
      'background:' + T.border + ';',
      'opacity:0.55;',
    ].join('');
    tree.appendChild(trunk);

    item.mods.forEach(function(mod) {
      var modRow = document.createElement('div');
      modRow.style.cssText = [
        'display:flex;align-items:center;',
        'gap:6px;',
        'padding:3px 0 3px 28px;',
        'position:relative;',
      ].join('');

      // Horizontal branch line
      var branch = document.createElement('div');
      branch.style.cssText = [
        'position:absolute;left:10px;top:50%;',
        'width:14px;height:1.5px;',
        'background:' + T.border + ';',
        'opacity:0.55;',
      ].join('');
      modRow.appendChild(branch);

      // Color-coded label by prefix
      var modLabel = document.createElement('span');
      modLabel.style.cssText = [
        'font-family:' + T.fb + ';',
        'font-weight:' + T.fwBold + ';',
        'font-size:11px;',
      ].join('');

      var text = typeof mod === 'string' ? mod : (mod.name || mod.label || '');
      var upper = text.toUpperCase();
      if (upper.startsWith('NO ') || upper.startsWith('REMOVE ') || upper.startsWith('– ')) {
        modLabel.style.color = T.verm;
      } else if (upper.startsWith('ADD ') || upper.startsWith('EXTRA ') || upper.startsWith('+ ')) {
        modLabel.style.color = T.green;
      } else {
        modLabel.style.color = T.moon;
      }
      modLabel.textContent = text;
      modRow.appendChild(modLabel);
      tree.appendChild(modRow);
    });

    block.appendChild(tree);
  }

  return block;
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
    'border-bottom:2px solid ' + darkenHex(T.bg, 0.2) + ';',
    'display:flex;align-items:center;',
    'justify-content:space-between;',
    'padding:8px 12px;',
    'box-sizing:border-box;',
  ].join('');

  var orderLabel = document.createElement('span');
  orderLabel.style.cssText = [
    'font-family:' + T.fh + ';',
    'font-size:' + T.fsB2 + ';',
    'font-weight:' + T.fwBold + ';',
    'color:' + T.green + ';',
    'letter-spacing:0.15em;',
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
  ].join('') + ";font-weight:" + T.fwBold + ";";
  ticketNum.textContent = ticketLabel(state.ticketNumber);
  ticketWrap.appendChild(ticketNum);

  if (state.ticketName) {
    var nameTag = document.createElement('span');
    nameTag.style.cssText = [
      'font-family:' + T.fb + ';',
      'font-size:' + FS_MOD + ';',
      'color:' + T.moon + ';',
    ].join('') + ";font-weight:" + T.fwBold + ";";
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

  // ── c) Clear-all link row ───────────────────────
  // (Per-item void is now the ✕ button on each row; this row keeps
  //  only the "clear all" link.)
  var voidRow = document.createElement('div');
  voidRow.style.cssText = [
    'display:flex;align-items:center;gap:6px;',
    'padding:4px 12px;',
    'flex-shrink:0;',
    'min-height:22px;',
  ].join('');

  var clearLink = document.createElement('span');
  clearLink.style.cssText = [
    'font-family:' + T.fb + ';',
    'font-size:' + FS_MOD + ';',
    'color:' + T.moon + ';',
    'cursor:pointer;pointer-events:auto;',
  ].join('') + ";font-weight:" + T.fwBold + ";";
  clearLink.textContent = 'clear all';

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
    ].join('') + ";font-weight:" + T.fwBold + ";";
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

  var discountRowEl = document.createElement('div');
  discountRowEl.style.cssText = 'display:none;justify-content:space-between;align-items:center;';
  var discLbl = document.createElement('span');
  discLbl.style.cssText = [
    'font-family:' + T.fb + ';',
    'font-size:' + FS_ITEM + ';',
    'color:' + T.lavender + ';',
  ].join('') + ";font-weight:" + T.fwBold + ";";
  discLbl.textContent = 'Discount';
  var discVal = document.createElement('span');
  discVal.style.cssText = [
    'font-family:' + T.fb + ';',
    'font-size:' + FS_ITEM + ';',
    'font-weight:' + T.fwBold + ';',
    'color:' + T.lavender + ';',
  ].join('');
  discountRowEl.appendChild(discLbl);
  discountRowEl.appendChild(discVal);
  els.discountRowEl = discountRowEl;
  els.discountValEl = discVal;
  totalsBlock.appendChild(discountRowEl);

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

  function makePayBtn(label, bg, dk, labelColor, subColor, extraStyles) {
    var wrap = document.createElement('div');
    wrap.style.cssText = [
      'flex:1;min-width:0;',
      'display:flex;flex-direction:column;align-items:center;gap:2px;',
      'background:' + bg + ';',
      'border-radius:10px;',
      'padding:8px 4px 6px;',
      'cursor:pointer;pointer-events:auto;touch-action:manipulation;',
      'box-shadow:0 4px 0 ' + dk + ';',
      'transition:transform 0.07s, box-shadow 0.07s;',
      extraStyles || '',
    ].join('');

    var lbl = document.createElement('span');
    lbl.style.cssText = [
      'font-family:' + T.fh + ';',
      'font-size:' + FS_BTN + ';',
      'font-weight:' + T.fwBold + ';',
      'color:' + labelColor + ';',
      'letter-spacing:0.05em;',
    ].join('');
    lbl.textContent = label;

    var sub = document.createElement('span');
    sub.style.cssText = [
      'font-family:' + T.fb + ';',
      'font-size:' + FS_MOD + ';',
      'color:' + subColor + ';',
      'font-weight:' + T.fwBold + ';',
    ].join('');
    sub.textContent = '$0.00';

    wrap.appendChild(lbl);
    wrap.appendChild(sub);
    wrap._subEl = sub;

    wrap.addEventListener('pointerdown', function() {
      wrap.style.transform = 'translateY(3px)';
      wrap.style.boxShadow = '0 1px 0 ' + dk;
    });
    var releasePay = function() {
      wrap.style.transform = 'translateY(0)';
      wrap.style.boxShadow = '0 4px 0 ' + dk;
    };
    wrap.addEventListener('pointerup',     releasePay);
    wrap.addEventListener('pointerleave',  releasePay);
    wrap.addEventListener('pointercancel', releasePay);

    return wrap;
  }

  var cashBtn  = makePayBtn(
    'CASH',  T.greenWarm, darkenHex(T.greenWarm, 0.25),
    T.well, T.well
  );
  var cardBtn  = makePayBtn(
    'CARD',  T.elec, darkenHex(T.elec, 0.25),
    T.well, T.well
  );
  var splitBtn = makePayBtn(
    'SPLIT', T.card, darkenHex(T.card, 0.25),
    T.text, T.moon,
    'border:1.5px solid ' + T.border + ';'
  );

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

  function makeActionBtn(label, bg, dk, textColor) {
    var wrap = document.createElement('div');
    wrap.style.cssText = [
      'flex:1;min-width:0;',
      'position:relative;',
      'display:flex;flex-direction:column;align-items:center;gap:2px;',
      'background:' + bg + ';',
      'border:none;',
      'border-radius:8px;',
      'padding:8px 4px 6px;',
      'cursor:pointer;pointer-events:auto;touch-action:manipulation;',
      'box-shadow:0 3px 0 ' + dk + ';',
      'transition:transform 0.07s, box-shadow 0.07s;',
      'overflow:hidden;',
    ].join('');

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
      'color:' + T.well + ';',
      'opacity:0.7;',
      'font-weight:' + T.fwBold + ';',
    ].join('');
    sub.textContent = 'order level';

    wrap.appendChild(lbl);
    wrap.appendChild(sub);
    wrap._subEl = sub;

    wrap.addEventListener('pointerdown', function() {
      wrap.style.transform = 'translateY(2px)';
      wrap.style.boxShadow = '0 1px 0 ' + dk;
    });
    var releaseAct = function() {
      wrap.style.transform = 'translateY(0)';
      wrap.style.boxShadow = '0 3px 0 ' + dk;
    };
    wrap.addEventListener('pointerup',     releaseAct);
    wrap.addEventListener('pointerleave',  releaseAct);
    wrap.addEventListener('pointercancel', releaseAct);

    return wrap;
  }

  var discBtn = makeActionBtn(
    'DISCOUNT',
    T.lavender,
    darkenHex(T.lavender, 0.45),
    T.well
  );
  var voidBtn = makeActionBtn(
    'VOID',
    T.verm,
    T.vermDk,
    '#fff'
  );
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
    ].join('') + ";font-weight:" + T.fwBold + ";";
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

  var totalDiscountAmt = state.items.reduce(function(sum, item) {
    var pct = totalDiscountPct(item);
    if (pct <= 0) return sum;
    return moneyRound(sum + moneyRound(item.price * (item.qty || 1) * pct / 100));
  }, 0);
  if (els.discountRowEl) {
    if (totalDiscountAmt > 0) {
      els.discountRowEl.style.display = 'flex';
      els.discountValEl.textContent   = '−' + fmt(totalDiscountAmt);
    } else {
      els.discountRowEl.style.display = 'none';
    }
  }

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

  // DISCOUNT / VOID subtitle reflects context (item-level vs order-level).
  // No accent bar — the filled button style replaces it.
  if (els.discBtn) {
    var discSub;
    if (state.selectedIdxs.length > 0) {
      var allHaveDiscounts = state.selectedIdxs.every(function(i) {
        return state.items[i] && (state.items[i].discounts || []).length > 0;
      });
      discSub = allHaveDiscounts ? 'add / remove' : 'item selected';
    } else {
      discSub = 'order level';
    }
    els.discBtn._subEl.textContent = discSub;
  }
  if (els.voidBtn) {
    els.voidBtn._subEl.textContent = hasSel ? 'item selected' : 'order level';
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
  ].join('') + ";font-weight:" + T.fwBold + ";";
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
    ].join('') + ";font-weight:" + T.fwBold + ";";
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

function _buildCategoryTile(cat) {
  var isActive = cat.key === state.activeCategory;
  var catColor = cat.color || T.moon;
  var darkText = darkenHex(catColor, 0.5);

  var tile = document.createElement('div');
  tile.dataset.categoryKey = cat.key;

  var styles = [
    'height:70px;',
    'border-radius:8px;',
    'flex-shrink:0;',
    'cursor:pointer;pointer-events:auto;touch-action:manipulation;',
    'display:flex;flex-direction:column;align-items:center;justify-content:center;',
    'gap:2px;',
    'transition:' + T.transitionFast + ';',
    'box-sizing:border-box;',
  ];

  if (isActive) {
    styles.push('background:' + catColor + ';');
    styles.push('border:none;');
  } else {
    styles.push('background:' + T.card + ';');
    styles.push('border:1px solid ' + T.border + ';');
    styles.push('border-left:4px solid ' + catColor + ';');
  }

  tile.style.cssText = styles.join('');

  var labelEl = document.createElement('span');
  labelEl.style.cssText = [
    'font-family:' + T.fh + ';',
    'font-weight:' + T.fwBold + ';',
    'font-size:15px;',
    'color:' + (isActive ? darkText : catColor) + ';',
    'text-align:center;',
    'text-transform:uppercase;',
  ].join('');
  labelEl.textContent = cat.label;

  var countEl = document.createElement('span');
  countEl.style.cssText = [
    'font-family:' + T.fb + ';',
    'font-weight:' + T.fwBold + ';',
    'font-size:10px;',
    'color:' + (isActive ? darkText : T.moon) + ';',
    'text-align:center;',
  ].join('');
  countEl.textContent = (cat.items || []).length + ' items';

  tile.appendChild(labelEl);
  tile.appendChild(countEl);
  return tile;
}

function buildCategoryColumn(categories, favH) {
  var fH = typeof favH === 'number' ? favH : FAV_H;
  var col = document.createElement('div');
  col.style.cssText = [
    'position:absolute;',
    'left:0;top:' + fH + 'px;',
    'width:' + CAT_W + 'px;',
    'height:' + (CONTENT_H - fH) + 'px;',
    'overflow-y:auto;',
    'display:flex;flex-direction:column;gap:8px;',
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
    col.appendChild(_buildCategoryTile(cat));
  });

  var filler = document.createElement('div');
  filler.style.cssText = 'flex:1;background:' + T.well + ';';
  col.appendChild(filler);

  return col;
}

// ─────────────────────────────────────────────────
//  ITEM GRID
// ─────────────────────────────────────────────────

// Returns the active category and its index in state.categories.
function _findActiveCategory() {
  for (var i = 0; i < state.categories.length; i++) {
    if (state.categories[i].key === state.activeCategory) {
      return { cat: state.categories[i], idx: i };
    }
  }
  return { cat: null, idx: 0 };
}

// Distribute items into grid-row chunks anchored at `anchorIdx`.
// Returns an array of { rowOffset, items[] } where rowOffset 0 is the
// anchor row, positive rows go down, negative rows go up.
function distributeItems(items, cols, anchorIdx, totalRows) {
  var chunks = [];
  if (!items || items.length === 0) return chunks;

  chunks.push({ rowOffset: 0, items: items.slice(0, cols) });
  var i = cols;

  var downOffset = 0;
  var upOffset = -1;
  var goingDown = true;
  var safety = 0;

  while (i < items.length && safety++ < 1000) {
    var chunk = items.slice(i, i + cols);
    if (goingDown) {
      var nextDown = downOffset + 1;
      if (anchorIdx + nextDown < totalRows) {
        chunks.push({ rowOffset: nextDown, items: chunk });
        downOffset = nextDown;
        i += cols;
      } else if (anchorIdx + upOffset < 0) {
        break;
      }
      goingDown = false;
    } else {
      if (anchorIdx + upOffset >= 0) {
        chunks.push({ rowOffset: upOffset, items: chunk });
        upOffset--;
        i += cols;
      } else if (anchorIdx + downOffset + 1 >= totalRows) {
        break;
      }
      goingDown = true;
    }
  }
  return chunks;
}

function _buildItemTile(item, cat) {
  var catColor = (cat && cat.color) || T.green;
  var tile = document.createElement('div');
  tile.dataset.itemKey = item.itemKey || item.key || item.name;
  tile.style.cssText = [
    'background:' + T.well + ';',
    'border:2px solid ' + catColor + ';',
    'border-radius:8px;',
    'height:70px;',
    'display:flex;flex-direction:column;align-items:center;justify-content:center;',
    'gap:2px;',
    'padding:4px 8px;',
    'box-sizing:border-box;',
    'cursor:pointer;pointer-events:auto;touch-action:manipulation;',
    'transition:' + T.transitionFast + ';',
    'overflow:hidden;',
  ].join('');

  var nameEl = document.createElement('span');
  nameEl.style.cssText = [
    'font-family:' + T.fh + ';',
    'font-weight:' + T.fwBold + ';',
    'font-size:14px;',
    'color:' + T.text + ';',
    'text-align:center;',
    'line-height:1.2;',
    'word-break:break-word;',
  ].join('');
  nameEl.textContent = item.name;

  var priceEl = document.createElement('span');
  priceEl.style.cssText = [
    'font-family:' + T.fb + ';',
    'font-weight:' + T.fwBold + ';',
    'font-size:13px;',
    'color:' + (item.price > 0 ? T.gold : T.moon) + ';',
    'text-align:center;',
  ].join('');
  priceEl.textContent = item.price > 0 ? fmt(item.price) : '—';

  tile.appendChild(nameEl);
  tile.appendChild(priceEl);

  // Tap flash
  tile.addEventListener('pointerdown', function() {
    tile.style.background = hexToRgba(T.green, 0.15);
  });
  var restoreTile = function() {
    setTimeout(function() { tile.style.background = T.well; }, 120);
  };
  tile.addEventListener('pointerup',    restoreTile);
  tile.addEventListener('pointerleave', restoreTile);
  tile.addEventListener('pointercancel',restoreTile);

  return tile;
}

function _renderItemGridContents(grid, items, cat, anchorIdx) {
  grid.innerHTML = '';

  if ((items || []).length === 0) {
    grid.style.display = 'flex';
    grid.style.alignItems = 'center';
    grid.style.justifyContent = 'center';
    grid.style.flexDirection = 'column';
    grid.style.gap = '12px';
    grid.style.gridTemplateColumns = '';
    grid.style.gridAutoRows = '';

    var emptyIcon = document.createElement('div');
    emptyIcon.style.cssText = [
      'width:48px;height:48px;border-radius:50%;',
      'border:2px dashed ' + T.border + ';',
      'display:flex;align-items:center;justify-content:center;',
      'font-family:' + T.fb + ';font-size:20px;color:' + T.moon + ';',
      'font-weight:' + T.fwBold + ';',
    ].join('');
    emptyIcon.textContent = '?';

    var emptyLine1 = document.createElement('span');
    emptyLine1.style.cssText = 'font-family:' + T.fb + ';font-size:' + FS_BODY + ';color:' + T.moon + ';font-weight:' + T.fwBold + ';';
    emptyLine1.textContent = 'No items in this category';

    var emptyLine2 = document.createElement('span');
    emptyLine2.style.cssText = 'font-family:' + T.fb + ';font-size:12px;color:' + T.border + ';font-weight:' + T.fwBold + ';';
    emptyLine2.textContent = 'Add items in Overseer → Menu';

    grid.appendChild(emptyIcon);
    grid.appendChild(emptyLine1);
    grid.appendChild(emptyLine2);
    return;
  }

  grid.style.display = 'grid';
  grid.style.gridTemplateColumns = 'repeat(3,1fr)';
  grid.style.gridAutoRows = '70px';
  grid.style.gap = '8px';
  grid.style.alignItems = '';
  grid.style.justifyContent = '';
  grid.style.flexDirection = '';

  var totalRows = state.categories.length || 1;
  var chunks = distributeItems(items, 3, anchorIdx, totalRows);

  chunks.forEach(function(chunk) {
    var rowAbs = anchorIdx + chunk.rowOffset + 1; // 1-indexed
    chunk.items.forEach(function(item, colIdx) {
      var tile = _buildItemTile(item, cat);
      tile.style.gridRowStart = String(rowAbs);
      tile.style.gridColumnStart = String(colIdx + 1);
      grid.appendChild(tile);
    });
  });
}

function buildItemGrid(items, favH, anchorIdx, cat) {
  var fH = typeof favH === 'number' ? favH : FAV_H;
  var idx = typeof anchorIdx === 'number' ? anchorIdx : 0;

  var grid = document.createElement('div');
  els.itemGrid = grid;

  grid.style.cssText = [
    'position:absolute;',
    'left:' + (CAT_W + 1) + 'px;',
    'top:' + fH + 'px;',
    'width:' + GRID_W + 'px;',
    'height:' + (CONTENT_H - fH) + 'px;',
    'box-sizing:border-box;',
    'overflow-y:auto;',
    'padding:6px;',
  ].join('');

  _renderItemGridContents(grid, items, cat, idx);
  return grid;
}

// ─────────────────────────────────────────────────
//  REPAINT HELPERS (for switchCategory)
// ─────────────────────────────────────────────────

function repaintItemGrid(items, cat, anchorIdx) {
  if (!els.itemGrid) return;
  var idx = typeof anchorIdx === 'number' ? anchorIdx : 0;
  _renderItemGridContents(els.itemGrid, items, cat, idx);
}

function repaintCategoryColumn() {
  if (!els.categoryColumn) return;
  // Keep divider (first child), replace category tiles
  var divider = els.categoryColumn.firstChild;
  els.categoryColumn.innerHTML = '';
  if (divider) els.categoryColumn.appendChild(divider);

  state.categories.forEach(function(cat) {
    els.categoryColumn.appendChild(_buildCategoryTile(cat));
  });

  var filler = document.createElement('div');
  filler.style.cssText = 'flex:1;background:' + T.well + ';';
  els.categoryColumn.appendChild(filler);
}

// ─────────────────────────────────────────────────
//  STATE MANAGEMENT
// ─────────────────────────────────────────────────

function handleItemTap(itemKey) {
  var activeCat = state.categories.find(function(c) {
    return c.key === state.activeCategory;
  });
  var item = activeCat && activeCat.items.find(function(i) {
    return (i.itemKey || i.key || i.name) === itemKey;
  });
  if (!item) return;

  var hasModifiers = item.modifier_groups && item.modifier_groups.length > 0;

  if (hasModifiers) {
    SceneManager.openTransactional('item-detail', {
      item: {
        name:            item.name,
        unitPrice:       parseFloat(item.price || 0),
        itemKey:         item.itemKey || item.key || item.name,
        modifier_groups: item.modifier_groups,
        mods:            [],
      },
      onConfirm: function(configuredItem) {
        addItem(configuredItem);
      },
    });
  } else {
    addItem({
      name:    item.name,
      price:   parseFloat(item.price || 0),
      itemKey: item.itemKey || item.key || item.name,
      mods:    [],
    });
  }
}

function addItem(itemKeyOrObj) {
  var found = null;
  var configuredItem = null;

  // If itemKeyOrObj is a string, look it up; otherwise use it directly as configured item
  if (typeof itemKeyOrObj === 'string') {
    var itemKey = itemKeyOrObj;
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

    configuredItem = {
      name:    found.name,
      price:   found.price || 0,
      itemKey: itemKey,
      mods:    [],
    };
  } else {
    configuredItem = itemKeyOrObj;
  }

  // Merge with last item if same key and no mods
  var last = state.items[state.items.length - 1];
  var lastItemKey = last ? (last.itemKey || last.name) : null;
  var thisKey = configuredItem.itemKey || configuredItem.name;

  if (last && lastItemKey === thisKey &&
      (!last.mods || last.mods.length === 0) &&
      (!configuredItem.mods || configuredItem.mods.length === 0) &&
      (!last.discounts || last.discounts.length === 0)) {
    last.qty += 1;
  } else {
    state.items.push({
      name:      configuredItem.name,
      price:     parseFloat(configuredItem.price || 0),
      mods:      configuredItem.mods || [],
      discounts: [],
      qty:       1,
      itemKey:   thisKey,
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

function removeItem(idx) {
  state.items.splice(idx, 1);
  state.selectedIdxs = state.selectedIdxs
    .filter(function(i) { return i !== idx; })
    .map(function(i) { return i > idx ? i - 1 : i; });
  renderRecap();
}

function removeDiscount(itemIdx, discountIdx) {
  if (!state.items[itemIdx]) return;
  state.items[itemIdx].discounts.splice(discountIdx, 1);
  renderRecap();
}

function switchCategory(key) {
  state.activeCategory = key;
  var found = _findActiveCategory();
  repaintItemGrid(found.cat ? found.cat.items : [], found.cat, found.idx);
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
  handleItemTap(tile.dataset.itemKey);
}

function _onFavTap(e) {
  var tile = e.target.closest('[data-item-key]');
  if (!tile) return;
  handleItemTap(tile.dataset.itemKey);
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
      handleDiscount();
    });
  }

  // Void button
  if (els.voidBtn) {
    els.voidBtn.addEventListener('pointerup', function() {
      if (!state.items.length) return;
      handleVoid();
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
//  DISCOUNT HANDLER
// ─────────────────────────────────────────────────

function handleDiscount() {
  var targetIdxs = state.selectedIdxs.length > 0
    ? state.selectedIdxs.slice()
    : state.items.map(function(_, i) { return i; });

  if (targetIdxs.length === 0) {
    showToast('Add items before applying a discount');
    return;
  }

  SceneManager.openInterrupt('manager-pin', {
    context:   'discount',
    onConfirm: function(employeeId) {
      SceneManager.openInterrupt('disc-select', {
        approvedBy: employeeId,
        onConfirm:  function(discount) {
          applyDiscount(discount, targetIdxs);
        },
        onCancel: function() {},
      });
    },
    onCancel: function() {},
  });
}

function applyDiscount(discount, targetIdxs) {
  targetIdxs.forEach(function(idx) {
    var item = state.items[idx];
    if (!item) return;
    var alreadyApplied = (item.discounts || []).some(function(d) {
      return d.id === discount.id;
    });
    if (alreadyApplied) return;
    if (!item.discounts) item.discounts = [];
    item.discounts.push({ id: discount.id, name: discount.name, pct: discount.pct });
  });
  renderRecap();
}

// ─────────────────────────────────────────────────
//  VOID HANDLER
// ─────────────────────────────────────────────────

function handleVoid() {
  var targetIdxs = state.selectedIdxs.length > 0
    ? state.selectedIdxs.slice()
    : state.items.map(function(_, i) { return i; });

  if (targetIdxs.length === 0) {
    showToast('Select items to void, or tap VOID with no selection to void the order');
    return;
  }

  var firstItem = state.items[targetIdxs[0]];
  if (!firstItem) return;

  SceneManager.openInterrupt('manager-pin', {
    context:   'void',
    onConfirm: function(employeeId) {
      SceneManager.openInterrupt('void-reason', {
        item:       { name: firstItem.name, price: firstItem.price },
        approvedBy: employeeId,
        onConfirm:  function(reason) {
          executeVoid(targetIdxs, reason, employeeId);
        },
        onCancel: function() {},
      });
    },
    onCancel: function() {},
  });
}

function executeVoid(targetIdxs, reason, approvedBy) {
  var orderId = state.order && state.order.orderId;

  targetIdxs.slice().sort(function(a, b) { return b - a; }).forEach(function(idx) {
    if (orderId && state.items[idx]) {
      var itemId = state.items[idx].itemId || state.items[idx].itemKey;
      fetchWithTimeout(
        '/api/v1/orders/' + orderId + '/items/' + itemId,
        {
          method: 'DELETE',
          body:   JSON.stringify({ reason: reason, approved_by: approvedBy }),
        },
        5000
      ).catch(function() {
        showToast('Void recorded locally — sync may be needed');
      });
    }
    state.items.splice(idx, 1);
  });

  state.selectedIdxs = [];
  renderRecap();
  showToast('Item voided');
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
  var initialCat = categories.length > 0 ? categories[0] : null;
  rightEl.appendChild(buildItemGrid(
    initialCat ? initialCat.items : [],
    favH,
    0,
    initialCat
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
        // Priority: API-returned color → palette key lookup → neutral grey.
        var color = cat.color
          || cat.hex_color
          || T.categoryPalette[key]
          || T.moon;
        var rawItems = itemsByCategory[cat.category_id] || [];
        var items = rawItems.map(function(it) {
          return {
            itemKey:    it.item_id,
            name:       it.name,
            price:      parseFloat(it.price || 0),
            popularity: parseFloat(it.display_order || 0),
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
    els.discountRowEl  = null;
    els.discountValEl  = null;
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
