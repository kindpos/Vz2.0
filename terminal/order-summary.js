// ═══════════════════════════════════════════════════
//  KINDpos Terminal — Persistent Order Summary Panel  (Vz2.0)
//  Left-column panel that persists across order + payment flow
//  Nice. Dependable. Yours.
// ═══════════════════════════════════════════════════

import { T } from '../common/tokens.js';
import { SceneManager } from './scene-manager.js';
import { hexToRgba, buildCard, buildSectionLabel, buildDataRow, buildDivider } from './theme-manager.js';
import { entReport } from './entomology-client.js';

// All per-mount state lives in this object, replaced on each show()/showCheckout()
// so callbacks and mode flags from a previous mount cannot leak across remounts.
// Other public API methods (hide/update/etc.) read through this same reference.
let _state = null;

function _initState() {
  return {
    _el:                null,        // #order-summary container
    _card:              null,        // buildCard return
    _itemScroll:        null,        // scrollable item list
    _summaryBox:        null,        // subtotal/discount/tax box
    _pricesBox:         null,        // card/cash prices box
    _paidRow:           null,        // dynamic paid row
    _remainRow:         null,        // dynamic remaining row
    _checkIdEl:         null,        // check ID display
    _nameEl:            null,        // customer name display (tappable)
    _onNameTap:         null,        // callback when check ID / name is tapped
    _splitBtn:          null,        // split button ref
    _headerTitle:       null,        // header title element ref
    _backBtn:           null,        // back button ref
    _onBack:            null,        // callback for back button
    _colHead:           null,        // column header container ref
    _summaryRowEl:      null,        // summary row (contains summary box + split btn)
    _mode:              'order',     // 'order' or 'checkout'
    _collapsible:       false,
    _onItemTap:         null,
    _onSeatHeaderTap:   null,
    _expandedItems:     {},
    _itemRenderLocked:  false,
    _customTitle:       null,
    _totalsMode:        'payment',   // 'payment' (default — sub/tax + card/cash) or 'building' (order-entry — sub/tax/total, no card/cash)
  };
}

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
  if (!_state) _state = _initState();
  if (!_state._el) _state._el = document.getElementById('order-summary');
  return _state._el;
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
  _state._card = cardRes.card;
  _state._card.style.display = 'flex';
  _state._card.style.flexDirection = 'column';
  _state._card.style.height = '100%';
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

  _state._backBtn = document.createElement('div');
  _state._backBtn.style.cssText = [
    'display:none;flex-shrink:0;',
    `font-family:${T.fh};font-size:28px;`,
    `font-weight:${T.fwBold};color:${T.green};`,
    'cursor:pointer;user-select:none;',
    'padding:0 4px 0 0;line-height:1;margin-top:-2px;',
  ].join('');
  _state._backBtn.textContent = '‹';
  _state._backBtn.addEventListener('pointerup', () => {
    if (_state && _state._onBack) _state._onBack();
  });
  header.appendChild(_state._backBtn);

  _state._headerTitle = buildSectionLabel('ITEM RECAP', T.green);
  _state._headerTitle.style.flex = '1';

  const checkWrap = document.createElement('div');
  checkWrap.style.cssText = 'display:flex;flex-direction:column;align-items:flex-end;cursor:pointer;min-width:0;touch-action:manipulation;';

  _state._checkIdEl = buildSectionLabel('', hexToRgba(T.text, 0.55));
  _state._checkIdEl.style.fontSize = T.fsB4;
  _state._checkIdEl.style.letterSpacing = '0.1em';

  _state._nameEl = document.createElement('div');
  _state._nameEl.style.cssText = [
    `font-family:${T.fb};`,
    `font-size:${T.fsB4};`,
    `color:${hexToRgba(T.text, 0.4)};`,
    'white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:140px;',
    'text-transform:uppercase;',
  ].join('') + `;font-weight:${T.fwBold};`;
  checkWrap.appendChild(_state._checkIdEl);
  checkWrap.appendChild(_state._nameEl);
  checkWrap.addEventListener('pointerup', () => {
    if (_state && _state._onNameTap) _state._onNameTap();
  });
  header.appendChild(_state._headerTitle);
  header.appendChild(checkWrap);
  _state._card.appendChild(header);

  // ── Column headers ──
  _state._colHead = document.createElement('div');
  _state._colHead.style.cssText = [
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

  _state._colHead.appendChild(hdrItem);
  _state._colHead.appendChild(hdrQty);
  _state._colHead.appendChild(hdrPrice);
  _state._card.appendChild(_state._colHead);
  _state._card.appendChild(buildDivider(`0 0 0 ${T.accentBarW}`));

  // ── Scrollable items ──
  _state._itemScroll = document.createElement('div');
  _state._itemScroll.id = 'ticket-list';
  _state._itemScroll.style.cssText = [
    'flex:1;min-height:0;overflow-y:auto;overflow-x:hidden;',
    'touch-action:pan-y;',
    'padding:4px 10px;',
    'scrollbar-width:none;-ms-overflow-style:none;',
    'display:flex;flex-direction:column;gap:4px;',
    `margin-left:${T.accentBarW}`,
  ].join('');
  // Kill the scrollbar on webkit
  _injectScrollStyle();
  _state._card.appendChild(_state._itemScroll);

  // ── Bottom: [Summary | Split] row ──
  _state._summaryRowEl = document.createElement('div');
  _state._summaryRowEl.style.cssText = [
    'flex-shrink:0;display:flex;gap:6px;',
    'padding:6px 8px;',
    `margin-left:${T.accentBarW}`,
    'flex-shrink:0;',
  ].join('');

  _state._summaryBox = document.createElement('div');
  _state._summaryBox.style.cssText = 'flex:1;padding:8px 12px;';
  _applyWellStyle(_state._summaryBox);
  _state._summaryRowEl.appendChild(_state._summaryBox);

  _state._splitBtn = null;
  _state._card.appendChild(_state._summaryRowEl);

  // ── Prices box ──
  _state._pricesBox = document.createElement('div');
  _state._pricesBox.style.cssText = [
    'flex-shrink:0;padding:8px 12px;margin:0 8px 8px;',
    `margin-left:calc(${T.accentBarW} + 8px)`,
    'flex-shrink:0;',
  ].join('');
  _applyWellStyle(_state._pricesBox);
  _state._card.appendChild(_state._pricesBox);
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

const _PREFIX_RX = /^(NO|ADD|SUB|EXTRA|ON SIDE|LITE)\s+/;

function _parsePrefix(name) {
  if (!name) return { prefix: null, clean: '' };
  let m = name.match(_PREFIX_RX);
  if (!m) return { prefix: null, clean: name };
  return { prefix: m[1], clean: name.slice(m[0].length) };
}

function _adaptMod(raw) {
  let pp = _parsePrefix(raw.name || '');
  return {
    prefix:    pp.prefix,
    name:      pp.clean,
    mandatory: pp.prefix === null,
    upcharge:  raw.charged ? (Number(raw.price) || 0) : 0,
    microMods: (raw.children || []).map(_adaptMod),
  };
}

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
  const _modP = Number(mod.price) || 0; modPrice.textContent = _modP > 0 ? `+$${_modP.toFixed(2)}` : '';
  modRow.appendChild(modName);
  modRow.appendChild(modPrice);
  return modRow;
}

function _renderModLine(mod, categoryColor, indentLevel) {
  indentLevel = indentLevel || 0;
  const baseIndent = 16;
  const nestIndent = 12;
  const leftPad = baseIndent + (indentLevel * nestIndent);

  const line = document.createElement('div');
  line.style.cssText = [
    'display:flex;align-items:center;gap:6px;',
    `padding:2px 0 2px ${leftPad}px;`,
    `font-family:${T.fb};`,
    `font-size:${T.fsB4};`,
    `font-weight:${T.fwBold};`,
  ].join('');

  // Determine if mandatory (no prefix) or optional (has prefix)
  const isMandatory = mod.mandatory === true || mod.prefix === null;

  if (!isMandatory && mod.prefix) {
    // Optional mod: render mint ↳ arrow in green, text in moon
    const arrow = document.createElement('span');
    arrow.textContent = '↳ ';
    arrow.style.color = T.green;
    arrow.style.flexShrink = '0';
    line.appendChild(arrow);

    const modName = document.createElement('span');
    modName.textContent = mod.name;
    modName.style.color = T.moon;
    modName.style.overflow = 'hidden';
    modName.style.textOverflow = 'ellipsis';
    modName.style.whiteSpace = 'nowrap';
    modName.style.flex = '1';
    modName.style.minWidth = '0';
    line.appendChild(modName);
  } else {
    // Mandatory mod: render with category color, no arrow
    const modName = document.createElement('span');
    modName.textContent = mod.name;
    modName.style.color = categoryColor || T.green;
    modName.style.overflow = 'hidden';
    modName.style.textOverflow = 'ellipsis';
    modName.style.whiteSpace = 'nowrap';
    modName.style.flex = '1';
    modName.style.minWidth = '0';
    line.appendChild(modName);
  }

  // Add upcharge if present and > 0
  if (mod.upcharge && Number(mod.upcharge) > 0) {
    const upchargeSpan = document.createElement('span');
    upchargeSpan.textContent = `+$${(Number(mod.upcharge)).toFixed(2)}`;
    upchargeSpan.style.color = T.gold;
    upchargeSpan.style.flexShrink = '0';
    line.appendChild(upchargeSpan);
  }

  return line;
}

function _renderModLines(mods, categoryColor, indentLevel) {
  const container = document.createElement('div');
  if (!mods || mods.length === 0) return container;

  mods.forEach((raw) => {
    // Adapt the mod if it's in raw format (has a name field but no mandatory field)
    const mod = (raw.mandatory !== undefined)
      ? raw
      : _adaptMod(raw);

    container.appendChild(_renderModLine(mod, categoryColor, indentLevel));

    // Recursively render microMods if they exist
    if (mod.microMods && mod.microMods.length > 0) {
      container.appendChild(_renderModLines(mod.microMods, categoryColor, (indentLevel || 0) + 1));
    }
  });

  return container;
}

function _halfCell(mod) {
  const td = document.createElement('div');
  td.style.cssText = `flex:1;padding:1px 2px;color:${T.green};`;
  if (!mod) return td;
  const nameEl = document.createElement('div');
  const _hp = Number(mod.price) || 0;
  nameEl.style.cssText = `overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:${(_hp > 0 ? '12px' : '14px')};;font-weight:${T.fwBold};`;
  nameEl.textContent = mod.name;
  if (_hp > 0) {
    const pr = document.createElement('span');
    pr.style.color = T.gold;
    pr.textContent = ` +$${_hp.toFixed(2)}`;
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
  if (!_state || !_state._itemScroll) return;
  if (_state._itemRenderLocked) return;
  const savedScroll = _state._itemScroll.scrollTop;
  _state._itemScroll.innerHTML = '';
  const isCollapsible = _state._collapsible;
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
      total.textContent = `$${(Number(item.seatTotal) || 0).toFixed(2)}`;

      meta.appendChild(label);
      meta.appendChild(total);

      hdr.appendChild(seatNum);
      hdr.appendChild(meta);

      if (_state._onSeatHeaderTap && item.seatIdx != null) {
        ((idx) => {
          hdr.addEventListener('pointerup', () => {
            if (_state && _state._onSeatHeaderTap) _state._onSeatHeaderTap(idx);
          });
        })(item.seatIdx);
      }
      _state._itemScroll.appendChild(hdr);
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
      check.textContent = '✓ ';
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
    row.setValue(`$${((Number(item.unitPrice) || 0) * (Number(item.qty) || 1)).toFixed(2)}`);

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

    _state._itemScroll.appendChild(row);

    // Attach tap handler for item selection + expand/collapse
    if (isCollapsible) {
      ((idx) => {
        row.addEventListener('pointerup', () => {
          if (_state && _state._onItemTap) _state._onItemTap(idx);
        });
      })(itemIndex);
    }

    // ── Modifier lines ──
    if (hasMods) {
      const categoryColor = item.categoryColor || T.green;
      const modContainer = _renderModLines(mods, categoryColor, 0);
      _state._itemScroll.appendChild(modContainer);
    }
  });
  _state._itemScroll.scrollTop = savedScroll;
}

function _renderSummary(params) {
  if (!_state || !_state._summaryBox) return;
  _state._summaryBox.innerHTML = '';
  _state._summaryBox.appendChild(buildDataRow('Subtotal', `$${(Number(params.subtotal) || 0).toFixed(2)}`, T.gold));
  const _disc = Number(params.discount) || 0;
  if (_disc > 0) {
    _state._summaryBox.appendChild(buildDataRow('Discount', `$${_disc.toFixed(2)}`, T.gold));
  }
  _state._summaryBox.appendChild(buildDataRow('Tax', `$${(Number(params.tax) || 0).toFixed(2)}`, T.gold));

  // Building mode (order-entry): emphasize TOTAL inside the summary card
  // since the prices box is hidden. Use cardTotal when supplied (the result
  // of computeTotals — handles discount math correctly); fall back to a
  // local sum for callers that don't pass it.
  if (_state._totalsMode === 'building') {
    _state._summaryBox.appendChild(buildDivider('4px 0'));
    const total = (params.cardTotal != null)
      ? (Number(params.cardTotal) || 0)
      : ((Number(params.subtotal) || 0) - (Number(params.discount) || 0) + (Number(params.tax) || 0));
    const totalRow = buildDataRow('Total', `$${total.toFixed(2)}`, T.gold);
    const totalVal = totalRow.querySelector('span:last-child');
    if (totalVal) {
      totalVal.style.fontSize = '17px';
      totalVal.style.fontWeight = T.fwBold;
    }
    _state._summaryBox.appendChild(totalRow);
  }

  _applyWellStyle(_state._summaryBox);
}

function _renderPrices(params) {
  if (!_state || !_state._pricesBox) return;

  // Building mode (order-entry): TOTAL lives in the summary box; the prices
  // box is unused. Hide the box entirely so it doesn't take vertical space.
  if (_state._totalsMode === 'building') {
    _state._pricesBox.style.display = 'none';
    _state._pricesBox.innerHTML = '';
    return;
  }
  _state._pricesBox.style.display = '';

  _state._pricesBox.innerHTML = '';
  _state._pricesBox.appendChild(buildDataRow('CARD PRICE', `$${(Number(params.cardTotal) || 0).toFixed(2)}`, T.elec));
  _state._pricesBox.appendChild(buildDataRow('CASH PRICE', `$${(Number(params.cashPrice) || 0).toFixed(2)}`, T.greenWarm));

  // Dynamic split-progress rows (hidden until partial payment)
  _state._paidRow = buildDataRow('Paid', '$0.00', T.elec);
  _state._paidRow.style.display = 'none';
  _state._pricesBox.appendChild(_state._paidRow);

  _state._remainRow = buildDataRow('Remaining', `$${(Number(params.cardTotal) || 0).toFixed(2)}`, T.elec);
  _state._remainRow.style.display = 'none';
  _state._pricesBox.appendChild(_state._remainRow);

  _applyWellStyle(_state._pricesBox);
}


// ═══════════════════════════════════════════════════
//  CHECKOUT MODE — configure panel for checkout/close-day
// ═══════════════════════════════════════════════════

function _configureForMode(mode) {
  if (!_state) return;
  _state._mode = mode;
  if (mode === 'checkout') {
    if (_state._headerTitle) _state._headerTitle.textContent = 'CHECKOUT RECAP';
    if (_state._colHead) _state._colHead.style.display = 'none';
    if (_state._splitBtn) _state._splitBtn.style.display = 'none';
    if (_state._summaryRowEl) _state._summaryRowEl.style.padding = '6px 8px 0';
  } else {
    if (_state._headerTitle) _state._headerTitle.textContent = _state._customTitle || 'ORDER RECAP';
    if (_state._colHead) {
      _state._colHead.style.display = 'grid';
      _state._colHead.style.gridTemplateColumns = '1fr 40px 68px';
      _state._colHead.innerHTML = '';

      const hdrItem = buildSectionLabel('ITEM', hexToRgba(T.text, 0.55));
      const hdrQty = buildSectionLabel('QTY', hexToRgba(T.text, 0.55));
      hdrQty.style.textAlign = 'right';
      const hdrPrice = buildSectionLabel('PRICE', hexToRgba(T.text, 0.55));
      hdrPrice.style.textAlign = 'right';

      _state._colHead.appendChild(hdrItem);
      _state._colHead.appendChild(hdrQty);
      _state._colHead.appendChild(hdrPrice);
    }
    if (_state._splitBtn) _state._splitBtn.style.display = '';
    if (_state._summaryRowEl) _state._summaryRowEl.style.padding = '6px 8px';
  }
}

function _renderCheckoutBreakdown(params) {
  if (!_state || !_state._itemScroll) return;
  _state._itemScroll.innerHTML = '';

  const sections = params.sections || [];
  for (let s = 0; s < sections.length; s++) {
    const sec = sections[s];

    const hdr = buildSectionLabel(sec.title, T.text);
    hdr.style.padding = '6px 0 2px';
    if (s > 0) {
      _state._itemScroll.appendChild(buildDivider('4px 0'));
    }
    _state._itemScroll.appendChild(hdr);

    const rows = sec.rows || [];
    for (let r = 0; r < rows.length; r++) {
      _state._itemScroll.appendChild(buildDataRow(rows[r].label, rows[r].value, T.gold));
    }
  }
}

function _renderCheckoutSummary(params) {
  if (!_state || !_state._summaryBox) return;
  _state._summaryBox.innerHTML = '';
  _state._summaryBox.appendChild(buildDataRow('Cash Sales', `$${(Number(params.cashSales) || 0).toFixed(2)}`, T.gold));
  _state._summaryBox.appendChild(buildDataRow('Tips', `$${(Number(params.tips) || 0).toFixed(2)}`, T.gold));
  _applyWellStyle(_state._summaryBox);
}

function _renderCashExpected(params) {
  if (!_state || !_state._pricesBox) return;
  _state._pricesBox.innerHTML = '';

  const label = buildSectionLabel('CASH EXPECTED', T.text);
  label.style.textAlign = 'center';
  label.style.marginBottom = '2px';
  _state._pricesBox.appendChild(label);

  const heroVal = `$${(Number(params.cashExpected) || 0).toFixed(2)}`;
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
  _state._pricesBox.appendChild(hero);

  _applyWellStyle(_state._pricesBox);
}

// ═══════════════════════════════════════════════════
//  PUBLIC API
// ═══════════════════════════════════════════════════

export const OrderSummary = {

  show: (params) => {
    params = params || {};
    _state = _initState();  // fresh state per mount — payment.js pattern
    let el = _container();
    if (!el) {
      entReport({
        code:    'UI-040',
        source:  'OrderSummary.show',
        message: '#order-summary element not found in DOM',
      });
      return;
    }

    if (!_state._itemScroll) _build();
    _state._collapsible = !!params.collapsible;
    _state._onItemTap = params.onItemTap || null;
    _state._onSeatHeaderTap = params.onSeatHeaderTap || null;
    _state._onBack = params.onBack || null;
    _state._totalsMode = params.totalsMode || 'payment';
    if (_state._backBtn) _state._backBtn.style.display = params.showBack ? 'block' : 'none';
    _state._customTitle = params.title || null;
    _configureForMode('order');

    if (_state._checkIdEl) _state._checkIdEl.textContent = params.checkId || '';
    if (_state._nameEl) _state._nameEl.textContent = params.customerName || '';
    _state._onNameTap = params.onNameTap || null;
    _state._itemRenderLocked = false;

    _renderItems(params.items);
    _renderSummary(params);
    _renderPrices(params);

    SceneManager.showSummary();

    // Ensure wrap is visible (it might have been hidden in _build)
    let wrap = el.querySelector('div');
    if (wrap) wrap.style.display = 'flex';
  },

  hide: () => {
    if (_state) {
      _state._onNameTap = null;
      _state._onItemTap = null;
      _state._onBack = null;
      if (_state._backBtn) _state._backBtn.style.display = 'none';
    }
    SceneManager.hideSummary();
  },

  lockItemRender: () => { if (_state) _state._itemRenderLocked = true; },
  unlockItemRender: () => { if (_state) _state._itemRenderLocked = false; },

  showBack: (show) => {
    if (_state && _state._backBtn) _state._backBtn.style.display = show ? 'block' : 'none';
  },

  setOnBack: (fn) => {
    if (_state) _state._onBack = fn;
  },

  update: (params) => {
    params = params || {};
    if (!_state) return;
    if (_state._checkIdEl && params.checkId !== undefined) _state._checkIdEl.textContent = params.checkId;
    if (_state._nameEl && params.customerName !== undefined) _state._nameEl.textContent = params.customerName || '';
    if (params.onNameTap !== undefined) _state._onNameTap = params.onNameTap;
    if (params.onItemTap !== undefined) _state._onItemTap = params.onItemTap;
    if (params.onSeatHeaderTap !== undefined) _state._onSeatHeaderTap = params.onSeatHeaderTap;
    if (params.totalsMode !== undefined) _state._totalsMode = params.totalsMode;
    if (params.items && !params.skipItems) _renderItems(params.items);
    _renderSummary(params);
    _renderPrices(params);
  },

  updateSplit: (opts) => {
    opts = opts || {};
    if (!_state) return;
    if (_state._paidRow) {
      _state._paidRow.style.display = 'flex';
      _state._paidRow.setValue(`$${(Number(opts.totalPaid) || 0).toFixed(2)}`);
    }
    if (_state._remainRow) {
      _state._remainRow.style.display = 'flex';
      _state._remainRow.setValue(`$${(Number(opts.remaining) || 0).toFixed(2)}`);
    }
  },

  showCheckout: (params) => {
    params = params || {};
    _state = _initState();  // fresh state per mount — payment.js pattern
    const el = _container();
    if (!el) {
      entReport({
        code:    'UI-040',
        source:  'OrderSummary.showCheckout',
        message: '#order-summary element not found in DOM',
      });
      return;
    }
    if (!_state._itemScroll) _build();
    // Reset totals mode so a stale 'building' from a previous order-entry
    // session can't leak into checkout's prices box (defensive — checkout
    // doesn't use _renderSummary/_renderPrices, but the box display:none
    // from 'building' mode WOULD persist if we don't unset it here).
    _state._totalsMode = 'payment';
    if (_state._pricesBox) _state._pricesBox.style.display = '';
    _configureForMode('checkout');

    if (_state._headerTitle && params.title) _state._headerTitle.textContent = params.title;
    if (_state._checkIdEl) _state._checkIdEl.textContent = params.label || '';

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
    if (!_state) return;
    if (_state._headerTitle && params.title) _state._headerTitle.textContent = params.title;
    if (_state._checkIdEl && params.label !== undefined) _state._checkIdEl.textContent = params.label;
    if (params.checks) _renderCheckoutBreakdown(params);
    _renderCheckoutSummary(params);
    _renderCashExpected(params);
  },

  getElement: () => _container(),
};
