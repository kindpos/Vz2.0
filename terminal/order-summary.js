// ═══════════════════════════════════════════════════
//  KINDpos Terminal — Persistent Order Summary Panel  (Vz2.0)
//  Left-column panel that persists across order + payment flow
//  Nice. Dependable. Yours.
// ═══════════════════════════════════════════════════

import { T } from '../common/tokens.js';
import { SceneManager } from './scene-manager.js';
import { hexToRgba, buildCard, buildSectionLabel, buildDataRow, buildDivider } from './theme-manager.js';

let _el = null;          // #order-summary container
let _card = null;        // buildCard return
let _itemScroll = null;  // scrollable item list
let _summaryBox = null;  // subtotal/discount/tax box
let _pricesBox = null;   // card/cash prices box
let _paidRow = null;     // dynamic paid row
let _remainRow = null;   // dynamic remaining row
let _checkIdEl = null;   // check ID display
let _nameEl = null;      // customer name display (tappable)
let _onNameTap = null;   // callback when check ID / name is tapped
let _splitBtn = null;    // split button ref
let _headerTitle = null; // header title element ref
let _backBtn = null;     // back button ref
let _onBack = null;      // callback for back button
let _colHead = null;     // column header container ref
let _summaryRowEl = null;// summary row (contains summary box + split btn)
let _mode = 'order';     // 'order' or 'checkout'
let _collapsible = false;
let _onItemTap = null;
let _onSeatHeaderTap = null;
const _expandedItems = {};
let _itemRenderLocked = false;
let _customTitle = null;
let _totalsMode = 'payment';  // 'payment' (default — sub/tax + card/cash) or 'building' (order-entry — sub/tax/total, no card/cash)

// Muted text helper — lowers T.text opacity for label/sub text.
function _muted() { return hexToRgba(T.text, 0.55); }

// Apply the Vz2.0 "inset well" look to a box (used for summary + prices panels).
function _applyWellStyle(box) {
  box.style.background   = T.well;
  box.style.borderLeft   = T.accentBarW + ` solid ${T.green}`;
  box.style.borderRadius = '8px';
  box.style.boxSizing    = 'border-box';
}

function _container() {
  if (!_el) _el = document.getElementById('order-summary');
  return _el;
}

// ═══════════════════════════════════════════════════
//  BUILD — One-time panel construction
// ═══════════════════════════════════════════════════

function _build() {
  let el = _container();
  if (!el) return;
  el.innerHTML = '';

  // Use buildCard for the main container
  const cardRes = buildCard({
    accent: T.green,
    padding: '0'
  });
  _card = cardRes.card;
  _card.style.display = 'flex';
  _card.style.flexDirection = 'column';
  _card.style.height = '100%';
  let wrap = cardRes.wrap;
  wrap.style.display = 'none';
  wrap.style.flexDirection = 'column';
  wrap.style.height = '100%';
  el.appendChild(wrap);

  // ── Header ──
  const header = document.createElement('div');
  header.style.cssText = [
    'padding:10px 14px;flex-shrink:0;',
    'display:flex;align-items:center;',
    'gap:8px;',
    `border-bottom:1px solid ${hexToRgba(T.green, 0.3)}`,
    `margin-left:${T.accentBarW}`, // Align with content to the right of the accent bar
  ].join('');

  _backBtn = document.createElement('div');
  _backBtn.style.cssText = [
    'display:none;flex-shrink:0;',
    `font-family:${T.fh};font-size:28px;`,
    `font-weight:${T.fwBold};color:${T.green};`,
    'cursor:pointer;user-select:none;',
    'padding:0 4px 0 0;line-height:1;margin-top:-2px;',
  ].join('');
  _backBtn.textContent = '‹';
  _backBtn.addEventListener('pointerup', () => {
    if (_onBack) _onBack();
  });
  header.appendChild(_backBtn);

  _headerTitle = buildSectionLabel('ITEM RECAP', T.green);
  _headerTitle.style.flex = '1';

  const checkWrap = document.createElement('div');
  checkWrap.style.cssText = 'display:flex;flex-direction:column;align-items:flex-end;cursor:pointer;min-width:0;touch-action:manipulation;';

  _checkIdEl = buildSectionLabel('', hexToRgba(T.text, 0.55));
  _checkIdEl.style.fontSize = T.fsB4;
  _checkIdEl.style.letterSpacing = '0.1em';

  _nameEl = document.createElement('div');
  _nameEl.style.cssText = [
    `font-family:${T.fb};`,
    `font-size:${T.fsB4};`,
    `color:${hexToRgba(T.text, 0.4)};`,
    'white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:140px;',
    'text-transform:uppercase;',
  ].join('') + `;font-weight:${T.fwBold};`;
  checkWrap.appendChild(_checkIdEl);
  checkWrap.appendChild(_nameEl);
  checkWrap.addEventListener('pointerup', () => {
    if (_onNameTap) _onNameTap();
  });
  header.appendChild(_headerTitle);
  header.appendChild(checkWrap);
  _card.appendChild(header);

  // ── Column headers ──
  _colHead = document.createElement('div');
  _colHead.style.cssText = [
    'display:grid;grid-template-columns:1fr 40px 68px;align-items:center;',
    'padding:6px 12px;',
    'flex-shrink:0;',
    `margin-left:${T.accentBarW}`,
  ].join('');

  let hdrItem = buildSectionLabel('ITEM', hexToRgba(T.text, 0.55));
  let hdrQty = buildSectionLabel('QTY', hexToRgba(T.text, 0.55));
  hdrQty.style.textAlign = 'right';
  let hdrPrice = buildSectionLabel('PRICE', hexToRgba(T.text, 0.55));
  hdrPrice.style.textAlign = 'right';

  _colHead.appendChild(hdrItem);
  _colHead.appendChild(hdrQty);
  _colHead.appendChild(hdrPrice);
  _card.appendChild(_colHead);
  _card.appendChild(buildDivider(`0 0 0 ${T.accentBarW}`));

  // ── Scrollable items ──
  _itemScroll = document.createElement('div');
  _itemScroll.id = 'ticket-list';
  _itemScroll.style.cssText = [
    'flex:1;min-height:0;overflow-y:auto;overflow-x:hidden;',
    'touch-action:pan-y;',
    'padding:4px 10px;',
    'scrollbar-width:none;-ms-overflow-style:none;',
    'display:flex;flex-direction:column;gap:4px;',
    `margin-left:${T.accentBarW}`,
  ].join('');
  // Kill the scrollbar on webkit
  _injectScrollStyle();
  _card.appendChild(_itemScroll);

  // ── Bottom: [Summary | Split] row ──
  _summaryRowEl = document.createElement('div');
  _summaryRowEl.style.cssText = [
    'flex-shrink:0;display:flex;gap:6px;',
    'padding:6px 8px;',
    `margin-left:${T.accentBarW}`,
    'flex-shrink:0;',
  ].join('');

  _summaryBox = document.createElement('div');
  _summaryBox.style.cssText = 'flex:1;padding:8px 12px;';
  _applyWellStyle(_summaryBox);
  _summaryRowEl.appendChild(_summaryBox);

  _splitBtn = null;
  _card.appendChild(_summaryRowEl);

  // ── Prices box ──
  _pricesBox = document.createElement('div');
  _pricesBox.style.cssText = [
    'flex-shrink:0;padding:8px 12px;margin:0 8px 8px;',
    `margin-left:calc(${T.accentBarW} + 8px)`,
    'flex-shrink:0;',
  ].join('');
  _applyWellStyle(_pricesBox);
  _card.appendChild(_pricesBox);
}

let _scrollStyleInjected = false;
function _injectScrollStyle() {
  if (_scrollStyleInjected) return;
  if (document.getElementById('os-scroll-style')) { _scrollStyleInjected = true; return; }
  let s = document.createElement('style');
  s.id = 'os-scroll-style';
  s.textContent = '#ticket-list::-webkit-scrollbar{display:none}';
  document.head.appendChild(s);
  _scrollStyleInjected = true;
}

// ═══════════════════════════════════════════════════
//  HELPERS
// ═══════════════════════════════════════════════════

function _modRow(mod) {
  const modRow = document.createElement('div');
  modRow.style.cssText = [
    'display:grid;grid-template-columns:1fr 72px;gap:0 6px;',
    'padding:0 0 1px 10px;',
    `font-family:${T.fb};`,
    `font-size:${T.fsB3};`,
    `color:${T.green};`,
  ].join('') + `;font-weight:${T.fwBold};`;
  const modName = document.createElement('div');
  modName.textContent = mod.name;
  modName.style.cssText = 'overflow:hidden;text-overflow:ellipsis;white-space:nowrap;';
  const modPrice = document.createElement('div');
  modPrice.style.cssText = `text-align:right;color:${T.gold};`;
  modPrice.textContent = mod.price > 0 ? `+$${mod.price.toFixed(2)}` : '';
  modRow.appendChild(modName);
  modRow.appendChild(modPrice);
  return modRow;
}

function _halfCell(mod) {
  const td = document.createElement('div');
  td.style.cssText = `flex:1;padding:1px 2px;color:${T.green};`;
  if (!mod) return td;
  const nameEl = document.createElement('div');
  nameEl.style.cssText = `overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:${(mod.price > 0 ? '12px' : '14px')};;font-weight:${T.fwBold};`;
  nameEl.textContent = mod.name;
  if (mod.price > 0) {
    const pr = document.createElement('span');
    pr.style.color = T.gold;
    pr.textContent = ` +$${mod.price.toFixed(2)}`;
    nameEl.appendChild(pr);
  }
  td.appendChild(nameEl);
  // Special exclusion children (secondary mods)
  if (mod.children && mod.children.length > 0) {
    for (let c = 0; c < mod.children.length; c++) {
      const childEl = document.createElement('div');
      childEl.style.cssText = `font-size:11px;color:${T.verm};font-style:italic;padding-left:4px;;font-weight:${T.fwBold};`;
      childEl.textContent = mod.children[c].name;
      td.appendChild(childEl);
    }
  }
  return td;
}

function _summaryRow(label, value, color, bold) {
  let row = buildDataRow(label, value, color || T.gold);
  if (bold) {
    const val = row.querySelector('span:last-child');
    if (val) val.style.fontWeight = T.fwBold;
  }
  return row;
}

function _renderItems(items) {
  if (!_itemScroll) return;
  if (_itemRenderLocked) return;
  const savedScroll = _itemScroll.scrollTop;
  _itemScroll.innerHTML = '';
  const isCollapsible = _collapsible;
  (items || []).forEach((item, itemIndex) => {
    // ── Seat header divider ──
    if (item.seatHeader) {
      let hdr = document.createElement('div');
      hdr.style.cssText = [
        'display:flex;align-items:center;gap:10px;',
        'padding:8px 10px;margin:8px 0 4px;',
        'cursor:pointer;user-select:none;touch-action:manipulation;',
        `background:${T.card};`,
        'border-radius:6px;',
        `border-bottom:1px dashed ${hexToRgba(T.green, 0.35)};`,
      ].join('');

      const seatNum = document.createElement('div');
      seatNum.style.cssText = [
        `font-family:${T.fh};font-size:32px;font-weight:${T.fwBold};`,
        `color:${T.green};line-height:1;min-width:36px;`,
      ].join('');
      // Extract number from "SEAT 1" or similar
      const numOnly = (item.seatId || '').replace(/\D/g, '');
      seatNum.textContent = numOnly || '?';

      const meta = document.createElement('div');
      meta.style.cssText = 'display:flex;flex-direction:column;gap:2px;flex:1;';

      let label = buildSectionLabel('SEAT', hexToRgba(T.text, 0.35));
      label.style.fontSize = '9px';
      label.style.letterSpacing = '0.15em';

      let total = document.createElement('div');
      total.style.cssText = `font-family:${T.fb};font-size:${T.fsB3};font-weight:${T.fwBold};color:${T.gold};`;
      total.textContent = `$${(item.seatTotal || 0).toFixed(2)}`;

      meta.appendChild(label);
      meta.appendChild(total);

      hdr.appendChild(seatNum);
      hdr.appendChild(meta);

      if (_onSeatHeaderTap && item.seatIdx != null) {
        ((idx) => {
          hdr.addEventListener('pointerup', () => {
            _onSeatHeaderTap(idx);
          });
        })(item.seatIdx);
      }
      _itemScroll.appendChild(hdr);
      return;
    }

    const mods = item.mods || [];
    const hasMods = mods.length > 0;

    // ── Item header row ──
    const isSel = !!item.selected;
    const row = buildDataRow('', '', isSel ? T.well : T.gold);
    row.style.padding = '4px 10px 2px';
    row.style.borderBottom = `1px solid ${hexToRgba(T.border, 0.4)}`;
    if (isSel) {
      row.style.background = T.gold;
      row.style.borderRadius = '6px';
    }
    if (isCollapsible) {
      row.style.cursor = 'pointer';
      row.style.userSelect = 'none';
      row.style.touchAction = 'manipulation';
    }

    // Customize the label part
    const lblContainer = row.querySelector('span:first-child');
    lblContainer.innerHTML = '';
    lblContainer.style.display = 'flex';
    lblContainer.style.alignItems = 'center';
    lblContainer.style.gap = '4px';
    lblContainer.style.color = isSel ? T.well : T.text;
    lblContainer.style.flex = '1';
    lblContainer.style.minWidth = '0';

    if (item.sent) {
      const check = document.createElement('span');
      check.textContent = '\u2713 ';
      check.style.color = T.greenWarm;
      lblContainer.appendChild(check);
      row.style.opacity = '0.55';
    }

    const qtyPrefix = document.createElement('span');
    qtyPrefix.textContent = (item.qty || 1) + '×';
    qtyPrefix.style.color = isSel ? T.well : hexToRgba(T.text, 0.55);
    qtyPrefix.style.fontSize = T.fsB3;
    lblContainer.appendChild(qtyPrefix);

    const nameSpan = document.createElement('span');
    nameSpan.textContent = item.name;
    nameSpan.style.overflow = 'hidden';
    nameSpan.style.textOverflow = 'ellipsis';
    nameSpan.style.whiteSpace = 'nowrap';
    lblContainer.appendChild(nameSpan);

    // Set the price
    row.setValue(`$${((item.unitPrice || 0) * (item.qty || 1)).toFixed(2)}`);

    // Info chevron only in collapsible mode
    let arrow = null;
    if (isCollapsible && hasMods) {
      arrow = document.createElement('span');
      arrow.style.cssText = `flex-shrink:0;margin-left:4px;font-size:14px;color:${_muted()};cursor:pointer;;font-weight:${T.fwBold};`;
      arrow.textContent = '›';
      arrow.addEventListener('pointerup', (e) => {
        e.stopPropagation();
        SceneManager.openTransactional('item-detail', { item });
      });
      row.appendChild(arrow);
    }

    _itemScroll.appendChild(row);

    // Attach tap handler for item selection + expand/collapse
    if (isCollapsible) {
      ((idx) => {
        row.addEventListener('pointerup', () => {
          if (_onItemTap) _onItemTap(idx);
        });
      })(itemIndex);
    }

    // ── Modifier detail container — always hidden in order-summary, use overlay ──
  });
  _itemScroll.scrollTop = savedScroll;
}

function _renderSummary(params) {
  if (!_summaryBox) return;
  _summaryBox.innerHTML = '';
  _summaryBox.appendChild(buildDataRow('Subtotal', `$${(params.subtotal || 0).toFixed(2)}`, T.gold));
  if (params.discount && params.discount > 0) {
    _summaryBox.appendChild(buildDataRow('Discount', `$${params.discount.toFixed(2)}`, T.gold));
  }
  _summaryBox.appendChild(buildDataRow('Tax', `$${(params.tax || 0).toFixed(2)}`, T.gold));

  // Building mode (order-entry): emphasize TOTAL inside the summary card
  // since the prices box is hidden. Use cardTotal when supplied (the result
  // of computeTotals — handles discount math correctly); fall back to a
  // local sum for callers that don't pass it.
  if (_totalsMode === 'building') {
    _summaryBox.appendChild(buildDivider('4px 0'));
    const total = (params.cardTotal != null)
      ? params.cardTotal
      : ((params.subtotal || 0) - (params.discount || 0) + (params.tax || 0));
    const totalRow = buildDataRow('Total', `$${total.toFixed(2)}`, T.gold);
    const totalVal = totalRow.querySelector('span:last-child');
    if (totalVal) {
      totalVal.style.fontSize = '17px';
      totalVal.style.fontWeight = T.fwBold;
    }
    _summaryBox.appendChild(totalRow);
  }

  _applyWellStyle(_summaryBox);
}

function _renderPrices(params) {
  if (!_pricesBox) return;

  // Building mode (order-entry): TOTAL lives in the summary box; the prices
  // box is unused. Hide the box entirely so it doesn't take vertical space.
  if (_totalsMode === 'building') {
    _pricesBox.style.display = 'none';
    _pricesBox.innerHTML = '';
    return;
  }
  _pricesBox.style.display = '';

  _pricesBox.innerHTML = '';
  _pricesBox.appendChild(buildDataRow('CARD PRICE', `$${(params.cardTotal || 0).toFixed(2)}`, T.elec));
  _pricesBox.appendChild(buildDataRow('CASH PRICE', `$${(params.cashPrice || 0).toFixed(2)}`, T.greenWarm));

  // Dynamic split-progress rows (hidden until partial payment)
  _paidRow = buildDataRow('Paid', '$0.00', T.elec);
  _paidRow.style.display = 'none';
  _pricesBox.appendChild(_paidRow);

  _remainRow = buildDataRow('Remaining', `$${(params.cardTotal || 0).toFixed(2)}`, T.elec);
  _remainRow.style.display = 'none';
  _pricesBox.appendChild(_remainRow);

  _applyWellStyle(_pricesBox);
}


// ═══════════════════════════════════════════════════
//  CHECKOUT MODE — configure panel for checkout/close-day
// ═══════════════════════════════════════════════════

function _configureForMode(mode) {
  _mode = mode;
  if (mode === 'checkout') {
    if (_headerTitle) _headerTitle.textContent = 'CHECKOUT RECAP';
    if (_colHead) _colHead.style.display = 'none';
    if (_splitBtn) _splitBtn.style.display = 'none';
    if (_summaryRowEl) _summaryRowEl.style.padding = '6px 8px 0';
  } else {
    if (_headerTitle) _headerTitle.textContent = _customTitle || 'ORDER RECAP';
    if (_colHead) {
      _colHead.style.display = 'grid';
      _colHead.style.gridTemplateColumns = '1fr 40px 68px';
      _colHead.innerHTML = '';

      const hdrItem = buildSectionLabel('ITEM', hexToRgba(T.text, 0.55));
      const hdrQty = buildSectionLabel('QTY', hexToRgba(T.text, 0.55));
      hdrQty.style.textAlign = 'right';
      const hdrPrice = buildSectionLabel('PRICE', hexToRgba(T.text, 0.55));
      hdrPrice.style.textAlign = 'right';

      _colHead.appendChild(hdrItem);
      _colHead.appendChild(hdrQty);
      _colHead.appendChild(hdrPrice);
    }
    if (_splitBtn) _splitBtn.style.display = '';
    if (_summaryRowEl) _summaryRowEl.style.padding = '6px 8px';
  }
}

function _renderCheckoutBreakdown(params) {
  if (!_itemScroll) return;
  _itemScroll.innerHTML = '';

  const sections = params.sections || [];
  for (let s = 0; s < sections.length; s++) {
    const sec = sections[s];

    const hdr = buildSectionLabel(sec.title, T.text);
    hdr.style.padding = '6px 0 2px';
    if (s > 0) {
      _itemScroll.appendChild(buildDivider('4px 0'));
    }
    _itemScroll.appendChild(hdr);

    const rows = sec.rows || [];
    for (let r = 0; r < rows.length; r++) {
      _itemScroll.appendChild(buildDataRow(rows[r].label, rows[r].value, T.gold));
    }
  }
}

function _renderCheckoutSummary(params) {
  if (!_summaryBox) return;
  _summaryBox.innerHTML = '';
  _summaryBox.appendChild(buildDataRow('Cash Sales', `$${(params.cashSales || 0).toFixed(2)}`, T.gold));
  _summaryBox.appendChild(buildDataRow('Tips', `$${(params.tips || 0).toFixed(2)}`, T.gold));
  _applyWellStyle(_summaryBox);
}

function _renderCashExpected(params) {
  if (!_pricesBox) return;
  _pricesBox.innerHTML = '';

  const label = buildSectionLabel('CASH EXPECTED', T.text);
  label.style.textAlign = 'center';
  label.style.marginBottom = '2px';
  _pricesBox.appendChild(label);

  const heroVal = `$${(params.cashExpected || 0).toFixed(2)}`;
  const hero = buildDataRow('', heroVal, T.gold);
  hero.style.borderBottom = 'none';
  const lblPart = hero.querySelector('span:first-child');
  if (lblPart) lblPart.style.display = 'none';
  const valPart = hero.querySelector('span:last-child');
  if (valPart) {
    valPart.style.width = '100%';
    valPart.style.textAlign = 'center';
    valPart.style.fontSize = T.fsH3;
    valPart.style.fontWeight = T.fwBold;
    valPart.style.padding = '4px 0';
  }
  hero.setAttribute('data-cash-expected', '1');
  _pricesBox.appendChild(hero);

  _applyWellStyle(_pricesBox);
}

// ═══════════════════════════════════════════════════
//  PUBLIC API
// ═══════════════════════════════════════════════════

export const OrderSummary = {

  show: (params) => {
    params = params || {};
    let el = _container();
    if (!el) return;

    if (!_itemScroll) _build();
    _collapsible = !!params.collapsible;
    _onItemTap = params.onItemTap || null;
    _onSeatHeaderTap = params.onSeatHeaderTap || null;
    _onBack = params.onBack || null;
    _totalsMode = params.totalsMode || 'payment';
    if (_backBtn) _backBtn.style.display = params.showBack ? 'block' : 'none';
    _customTitle = params.title || null;
    _configureForMode('order');

    if (_checkIdEl) _checkIdEl.textContent = params.checkId || '';
    if (_nameEl) _nameEl.textContent = params.customerName || '';
    _onNameTap = params.onNameTap || null;
    _itemRenderLocked = false;

    _renderItems(params.items);
    _renderSummary(params);
    _renderPrices(params);

    SceneManager.showSummary();

    // Ensure wrap is visible (it might have been hidden in _build)
    let wrap = el.querySelector('div');
    if (wrap) wrap.style.display = 'flex';
  },

  hide: () => {
    _onNameTap = null;
    _onItemTap = null;
    _onBack = null;
    if (_backBtn) _backBtn.style.display = 'none';
    SceneManager.hideSummary();
  },

  lockItemRender: () => { _itemRenderLocked = true; },
  unlockItemRender: () => { _itemRenderLocked = false; },

  showBack: (show) => {
    if (_backBtn) _backBtn.style.display = show ? 'block' : 'none';
  },

  setOnBack: (fn) => {
    _onBack = fn;
  },

  update: (params) => {
    params = params || {};
    if (_checkIdEl && params.checkId !== undefined) _checkIdEl.textContent = params.checkId;
    if (_nameEl && params.customerName !== undefined) _nameEl.textContent = params.customerName || '';
    if (params.onNameTap !== undefined) _onNameTap = params.onNameTap;
    if (params.onItemTap !== undefined) _onItemTap = params.onItemTap;
    if (params.onSeatHeaderTap !== undefined) _onSeatHeaderTap = params.onSeatHeaderTap;
    if (params.totalsMode !== undefined) _totalsMode = params.totalsMode;
    if (params.items && !params.skipItems) _renderItems(params.items);
    _renderSummary(params);
    _renderPrices(params);
  },

  updateSplit: (opts) => {
    opts = opts || {};
    if (_paidRow) {
      _paidRow.style.display = 'flex';
      _paidRow.setValue(`$${(opts.totalPaid || 0).toFixed(2)}`);
    }
    if (_remainRow) {
      _remainRow.style.display = 'flex';
      _remainRow.setValue(`$${(opts.remaining || 0).toFixed(2)}`);
    }
  },

  showCheckout: (params) => {
    params = params || {};
    const el = _container();
    if (!el) return;
    if (!_itemScroll) _build();
    // Reset totals mode so a stale 'building' from a previous order-entry
    // session can't leak into checkout's prices box (defensive — checkout
    // doesn't use _renderSummary/_renderPrices, but the box display:none
    // from 'building' mode WOULD persist if we don't unset it here).
    _totalsMode = 'payment';
    if (_pricesBox) _pricesBox.style.display = '';
    _configureForMode('checkout');

    if (_headerTitle && params.title) _headerTitle.textContent = params.title;
    if (_checkIdEl) _checkIdEl.textContent = params.label || '';

    _renderCheckoutBreakdown(params);
    _renderCheckoutSummary(params);
    _renderCashExpected(params);

    SceneManager.showSummary();

    // Ensure wrap is visible
    const wrap = el.querySelector('div');
    if (wrap) wrap.style.display = 'flex';
  },

  updateCheckout: (params) => {
    params = params || {};
    if (_headerTitle && params.title) _headerTitle.textContent = params.title;
    if (_checkIdEl && params.label !== undefined) _checkIdEl.textContent = params.label;
    if (params.checks) _renderCheckoutBreakdown(params);
    _renderCheckoutSummary(params);
    _renderCashExpected(params);
  },

  getElement: () => _container(),
};