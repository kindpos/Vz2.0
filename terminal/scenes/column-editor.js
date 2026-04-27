import { SceneManager, defineScene } from '../scene-manager.js';
import { T } from '../../common/tokens.js';
import {
  buildStaticCard,
  buildPillButton,
  buildSectionLabel,
  hexToRgba,
  darkenHex,
} from '../theme-manager.js';
import { showToast } from '../components.js';
import { entReport } from '../entomology-client.js';
import '../styles.js';

function fmt(n) {
  return '$' + (n || 0).toFixed(2);
}

// ─────────────────────────────────────────────────────
//  Utility helpers
// ─────────────────────────────────────────────────────

function deepCopyColumns(columns) {
  var copy = [];
  for (var ci = 0; ci < columns.length; ci++) {
    var sc = columns[ci];
    var items = [];
    for (var ii = 0; ii < sc.items.length; ii++) {
      var it = sc.items[ii];
      items.push({
        name:         it.name,
        qty:          it.qty,
        price:        it.price,
        item_id:      it.item_id,
        menu_item_id: it.menu_item_id,
        category:     it.category,
        mods:         Array.isArray(it.mods) ? it.mods.slice() : [],
        notes:        it.notes,
        _splitRef:    it._splitRef,
        isNewCheck:   it.isNewCheck,
      });
    }
    copy.push({ id: sc.id, label: sc.label, items: items, isNewCheck: sc.isNewCheck });
  }
  return copy;
}

function sumColumn(colIdx, state) {
  var col = state.columns[colIdx];
  var t = 0;
  for (var ii = 0; ii < col.items.length; ii++) t += col.items[ii].qty * col.items[ii].price;
  return t;
}

function projectedColTotal(colIdx, state) {
  var col = state.columns[colIdx];
  var total = 0;
  for (var ii = 0; ii < col.items.length; ii++) {
    var sel = false;
    for (var si = 0; si < state.selectedItems.length; si++) {
      if (state.selectedItems[si].colIdx === colIdx && state.selectedItems[si].itemIdx === ii) {
        sel = true; break;
      }
    }
    if (!sel) total += col.items[ii].qty * col.items[ii].price;
  }
  for (var si2 = 0; si2 < state.selectedItems.length; si2++) {
    var s = state.selectedItems[si2];
    var src = state.columns[s.colIdx].items[s.itemIdx];
    var dSet = {};
    for (var tt = 0; tt < state.splitTargets.length; tt++) dSet[state.splitTargets[tt]] = true;
    if (Object.keys(dSet).length === 0) dSet[s.colIdx] = true;
    var tgts = Object.keys(dSet).map(Number);
    var myIdx = tgts.indexOf(colIdx);
    if (myIdx < 0) continue;
    var modSum = Array.isArray(src.mods)
      ? src.mods.reduce(function(a, m) { return a + (m.price || 0); }, 0) : 0;
    var eff  = (src.price || 0) + modSum;
    var sp   = Math.round(eff / tgts.length * 100) / 100;
    var rem  = Math.round((eff - sp * tgts.length) * 100) / 100;
    total += sp + (myIdx === 0 ? rem : 0);
  }
  return total;
}

function pushLog(label, state) {
  state.actionLog.push({ label: label, columns: deepCopyColumns(state.columns) });
}

function clearMode(state) {
  state.mode         = null;
  state.selectedItems = [];
  state.splitTargets  = [];
  if (state.statusEl) state.statusEl.textContent = '';
  renderOpsBar(state);
  renderColumns(state);
}

function clearSelection(state) {
  state.selectedItems = [];
  state.splitTargets  = [];
  renderColumns(state);
}

function updatePreviewTotals(state) {
  if (state.mode !== 'split') return;
  for (var ci = 0; ci < state.colEls.length; ci++) {
    var refs = state.colEls[ci];
    if (!refs) continue;
    refs.hdrTotal.textContent = state.selectedItems.length === 0
      ? fmt(sumColumn(ci, state))
      : '~' + fmt(projectedColTotal(ci, state));
  }
}

function _collapseSplitGroups(items) {
  var out = [], byRef = {};
  for (var i = 0; i < items.length; i++) {
    var it  = items[i];
    var ref = it._splitRef;
    if (ref && byRef[ref] !== undefined) {
      var tgt = out[byRef[ref]];
      tgt.price = Math.round((tgt.price + (it.price || 0)) * 100) / 100;
      if (!tgt.item_id && it.item_id) tgt.item_id = it.item_id;
    } else {
      if (ref) byRef[ref] = out.length;
      out.push({
        name: it.name, qty: it.qty, price: it.price,
        item_id: it.item_id, menu_item_id: it.menu_item_id,
        category: it.category, mods: it.mods, notes: it.notes,
        _splitRef: ref || undefined,
      });
    }
  }
  return out;
}

// ─────────────────────────────────────────────────────
//  Operation handlers
// ─────────────────────────────────────────────────────

function handleItemTap(colIdx, itemIdx, state) {
  if (state.mode === 'merge') return;
  var found = -1;
  for (var i = 0; i < state.selectedItems.length; i++) {
    if (state.selectedItems[i].colIdx === colIdx && state.selectedItems[i].itemIdx === itemIdx) {
      found = i; break;
    }
  }
  if (found >= 0) state.selectedItems.splice(found, 1);
  else            state.selectedItems.push({ colIdx: colIdx, itemIdx: itemIdx });
  if (state.mode === 'split') updatePreviewTotals(state);
  renderColumns(state);
}

function handleColTap(colIdx, state) {
  if (state.mode === 'split')                                    toggleSplitTarget(colIdx, state);
  else if (state.mode === 'merge')                               doMerge(colIdx, state);
  else if (state.selectedItems.length > 0)                      doMove(colIdx, state);
}

function toggleSplitTarget(colIdx, state) {
  var found = state.splitTargets.indexOf(colIdx);
  if (found >= 0) state.splitTargets.splice(found, 1);
  else            state.splitTargets.push(colIdx);
  if (state.statusEl)
    state.statusEl.textContent =
      'Select items · tap columns to target (' + state.splitTargets.length + ')';
  updatePreviewTotals(state);
  renderColumns(state);
}

function doMove(targetColIdx, state) {
  pushLog('Moved to ' + state.columns[targetColIdx].label, state);
  var sorted = state.selectedItems.slice().sort(function(a, b) {
    return a.colIdx !== b.colIdx ? b.colIdx - a.colIdx : b.itemIdx - a.itemIdx;
  });
  var moved = [];
  for (var i = 0; i < sorted.length; i++) {
    moved.push(state.columns[sorted[i].colIdx].items.splice(sorted[i].itemIdx, 1)[0]);
  }
  moved.reverse();
  for (var mi = 0; mi < moved.length; mi++) state.columns[targetColIdx].items.push(moved[mi]);
  state.selectedItems = [];
  renderColumns(state);
}

function doMerge(targetColIdx, state) {
  pushLog('Merged into ' + state.columns[targetColIdx].label, state);
  var target = state.columns[targetColIdx];
  var allBefore = target.items.slice();
  for (var ci = 0; ci < state.columns.length; ci++) {
    if (ci === targetColIdx) continue;
    for (var ii = 0; ii < state.columns[ci].items.length; ii++) {
      target.items.push(state.columns[ci].items[ii]);
    }
  }
  // Emit diagnostic for each split group recombined
  var refsIn = {};
  for (var ri = 0; ri < target.items.length; ri++) {
    var ref = target.items[ri]._splitRef;
    if (ref) refsIn[ref] = (refsIn[ref] || 0) + 1;
  }
  var refKeys = Object.keys(refsIn);
  for (var rk = 0; rk < refKeys.length; rk++) {
    if (refsIn[refKeys[rk]] > 1) {
      entReport({ code: 'UI-013', level: 'INFO', source: 'column-editor.merge',
        message: 'Split item recombined: ' + refKeys[rk],
        ctx: { split_ref: refKeys[rk] } });
    }
  }
  target.items = _collapseSplitGroups(target.items);
  state.columns = [target];
  clearMode(state);
}

function doSplit(state) {
  if (state.selectedItems.length === 0) return;
  pushLog('Split', state);
  var bySource = {};
  for (var si = 0; si < state.selectedItems.length; si++) {
    var sel = state.selectedItems[si];
    if (!bySource[sel.colIdx]) bySource[sel.colIdx] = [];
    bySource[sel.colIdx].push(sel.itemIdx);
  }
  var extracted = [];
  var srcKeys = Object.keys(bySource);
  for (var k = 0; k < srcKeys.length; k++) {
    var cidx = Number(srcKeys[k]);
    var idxs = bySource[cidx].slice().sort(function(a, b) { return b - a; });
    for (var ii = 0; ii < idxs.length; ii++) {
      extracted.push({ item: state.columns[cidx].items.splice(idxs[ii], 1)[0], source: cidx });
    }
  }
  for (var ei = 0; ei < extracted.length; ei++) {
    var item   = extracted[ei].item;
    var source = extracted[ei].source;
    var dSet   = {};
    for (var tt = 0; tt < state.splitTargets.length; tt++) dSet[state.splitTargets[tt]] = true;
    if (Object.keys(dSet).length === 0) dSet[source] = true;
    var targets = Object.keys(dSet).map(Number);
    var n = targets.length;
    var modSum  = Array.isArray(item.mods)
      ? item.mods.reduce(function(a, m) { return a + (m.price || 0); }, 0) : 0;
    var eff     = (item.price || 0) + modSum;
    var sp      = Math.round(eff / n * 100) / 100;
    var rem     = Math.round((eff - sp * n) * 100) / 100;
    var splitRef = item.item_id || ('sr-' + Date.now() + '-' + ei);
    for (var t = 0; t < n; t++) {
      var splitItem = {
        name: item.name, qty: item.qty,
        price: sp + (t === 0 ? rem : 0),
        menu_item_id: item.menu_item_id, category: item.category,
        mods: [], notes: item.notes, _splitRef: splitRef,
      };
      if (t === 0 && item.item_id) splitItem.item_id = item.item_id;
      state.columns[targets[t]].items.push(splitItem);
    }
    entReport({ code: 'UI-012', level: 'INFO', source: 'column-editor.split',
      message: 'Item split across ' + n + ' seat(s): ' + item.name,
      ctx: { split_ref: splitRef, item_name: item.name, seat_count: n } });
  }
  clearMode(state);
}

function handleAddSeat(state) {
  var used = {};
  for (var ci = 0; ci < state.columns.length; ci++) {
    var m = state.columns[ci].label.match(/^S-?0*(\d+)$/i);
    if (m) used[parseInt(m[1], 10)] = true;
  }
  var n = 1;
  while (used[n]) n++;
  var newCol = { id: 'NEW-' + n, label: 'S-' + String(n).padStart(3, '0'), items: [] };
  state.columns.push(newCol);
  if (state.mode === 'split') {
    state.splitTargets.push(state.columns.length - 1);
    if (state.statusEl)
      state.statusEl.textContent =
        'Select items · tap columns to target (' + state.splitTargets.length + ')';
  }
  showToast('Added ' + newCol.label, { bg: T.green });
  renderColumns(state);
}

function handleAddCheck(state) {
  if (state.selectedItems.length === 0) {
    showToast('Select items first', { bg: T.gold });
    return;
  }
  var n = state.columns.length + 1;
  var label = 'CHK-' + String(n).padStart(3, '0');
  pushLog('New check ' + label, state);
  var sorted = state.selectedItems.slice().sort(function(a, b) {
    return a.colIdx !== b.colIdx ? b.colIdx - a.colIdx : b.itemIdx - a.itemIdx;
  });
  var items = [];
  for (var i = 0; i < sorted.length; i++) {
    items.push(state.columns[sorted[i].colIdx].items.splice(sorted[i].itemIdx, 1)[0]);
  }
  items.reverse();
  state.columns.push({ id: 'NEW-CHK-' + n, label: label, items: items, isNewCheck: true });
  state.selectedItems = [];
  showToast('Created ' + label, { bg: T.greenWarm });
  renderColumns(state);
}

function handleUndo(state) {
  if (state.actionLog.length === 0) return;
  var entry = state.actionLog.pop();
  state.columns      = entry.columns;
  state.selectedItems = [];
  state.splitTargets  = [];
  state.mode          = null;
  renderOpsBar(state);
  renderColumns(state);
}

function handleUndoAll(state) {
  if (!state.snapshot) return;
  state.columns      = deepCopyColumns(state.snapshot);
  state.actionLog    = [];
  state.selectedItems = [];
  state.splitTargets  = [];
  state.mode          = null;
  renderOpsBar(state);
  renderColumns(state);
}

function handleConfirm(state) {
  if (state.mode === 'split' && state.selectedItems.length > 0 && state.splitTargets.length > 0) {
    doSplit(state);
  }
  if (state.onSave) state.onSave(state.columns);
  SceneManager.closeTransactional('column-editor');
}

// ─────────────────────────────────────────────────────
//  renderColumns(state)
//
//  Clears columnsArea and rebuilds every column card +
//  the add card. Also re-wires all item / header taps.
// ─────────────────────────────────────────────────────
function renderColumns(state) {
  var area = state.columnsArea;
  while (area.firstChild) area.removeChild(area.firstChild);
  state.colEls = [];
  for (var ci = 0; ci < state.columns.length; ci++) {
    area.appendChild(buildColumn(ci, state));
  }
  area.appendChild(buildAddCard(state));
}

// ─────────────────────────────────────────────────────
//  buildColumn(colIdx, state) → card element
//
//  Renders one column card: header + scrollable item list.
//  Registers the card refs in state.colEls[colIdx].
//  Wires header tap (handleColTap) and item taps (handleItemTap).
// ─────────────────────────────────────────────────────
function buildColumn(colIdx, state) {
  var col      = state.columns[colIdx];
  var accent   = T.seatPalette[colIdx % T.seatPalette.length];
  var isTarget = state.mode === 'split' && state.splitTargets.indexOf(colIdx) >= 0;
  var nTargets = state.splitTargets.length;

  // ── Card shell ────────────────────────────────────
  var card = buildStaticCard({ accent: accent });
  card.style.padding       = '0';
  card.style.display       = 'flex';
  card.style.flexDirection = 'column';
  card.style.overflow      = 'hidden';
  card.style.minWidth      = '220px';
  card.style.maxWidth      = '300px';
  card.style.flexShrink    = '0';

  // ── Header ────────────────────────────────────────
  var hdr = document.createElement('div');
  hdr.style.background     = T.well;
  hdr.style.height         = '32px';
  hdr.style.display        = 'flex';
  hdr.style.alignItems     = 'center';
  hdr.style.justifyContent = 'space-between';
  hdr.style.padding        = '0 14px';
  hdr.style.flexShrink     = '0';
  hdr.style.cursor         = 'pointer';
  hdr.style.pointerEvents  = 'auto';
  hdr.style.touchAction    = 'manipulation';

  var hdrLabel = buildSectionLabel(col.label, T.green);
  hdrLabel.style.flex = '1';
  hdr.appendChild(hdrLabel);

  var colTotal = col.items.reduce(function(s, it) { return s + it.qty * it.price; }, 0);
  var hdrTotal = document.createElement('span');
  hdrTotal.textContent      = fmt(colTotal);
  hdrTotal.style.fontFamily = T.fb;
  hdrTotal.style.fontSize   = T.fsB3;
  hdrTotal.style.fontWeight = T.fwBold;
  hdrTotal.style.color      = T.gold;
  hdrTotal.style.flexShrink = '0';
  hdr.appendChild(hdrTotal);

  // Wire header tap
  (function(idx) {
    var h = function() { handleColTap(idx, state); };
    hdr.addEventListener('pointerup', h);
    state.listeners.push({ el: hdr, event: 'pointerup', handler: h });
  })(colIdx);

  card.appendChild(hdr);

  // ── Item list ─────────────────────────────────────
  var itemList = document.createElement('div');
  itemList.className             = 'co-scroll';
  itemList.style.flex            = '1';
  itemList.style.minHeight       = '0';
  itemList.style.overflowY       = 'auto';
  itemList.style.scrollbarWidth  = 'none';
  itemList.style.msOverflowStyle = 'none';
  itemList.style.display         = 'flex';
  itemList.style.flexDirection   = 'column';
  itemList.style.padding         = '6px';

  if (col.items.length === 0) {
    var emptyEl = document.createElement('div');
    emptyEl.textContent          = 'Empty';
    emptyEl.style.flex           = '1';
    emptyEl.style.display        = 'flex';
    emptyEl.style.alignItems     = 'center';
    emptyEl.style.justifyContent = 'center';
    emptyEl.style.fontFamily     = T.fb;
    emptyEl.style.fontSize       = T.fsB3;
    emptyEl.style.color          = T.moon;
    itemList.appendChild(emptyEl);
  } else {
    for (var ii = 0; ii < col.items.length; ii++) {
      var item = col.items[ii];
      var nameText = (item.qty > 1 ? item.qty + 'x ' : '') + item.name;

      var isSelected = false;
      for (var si = 0; si < state.selectedItems.length; si++) {
        if (state.selectedItems[si].colIdx === colIdx && state.selectedItems[si].itemIdx === ii) {
          isSelected = true;
          break;
        }
      }

      var row = document.createElement('div');
      row.style.display       = 'flex';
      row.style.alignItems    = 'center';
      row.style.padding       = '6px 8px';
      row.style.cursor        = 'pointer';
      row.style.pointerEvents = 'auto';
      row.style.touchAction   = 'manipulation';
      row.style.userSelect    = 'none';

      var nameSpan = document.createElement('span');
      nameSpan.textContent    = nameText;
      nameSpan.style.flex     = '1';
      nameSpan.style.minWidth = '0';

      var priceSpan = document.createElement('span');
      priceSpan.textContent      = fmt(item.qty * item.price);
      priceSpan.style.marginLeft = '8px';
      priceSpan.style.flexShrink = '0';
      priceSpan.style.fontFamily = T.fb;
      priceSpan.style.fontSize   = T.fsB3;

      if (isTarget) {
        // Ghost row: column is a split destination
        row.style.background   = hexToRgba(T.elec, 0.05);
        row.style.borderBottom = '1px dashed ' + T.border;
        nameSpan.style.color   = T.text;
        priceSpan.style.color  = T.gold;

        var badge = document.createElement('span');
        badge.textContent      = '÷' + nTargets;
        badge.style.fontFamily = T.fh;
        badge.style.fontSize   = T.fsB4;
        badge.style.fontWeight = T.fwBold;
        badge.style.color      = T.elec;
        badge.style.marginLeft = '6px';
        badge.style.flexShrink = '0';

        row.appendChild(nameSpan);
        row.appendChild(badge);
        row.appendChild(priceSpan);

      } else if (isSelected) {
        // Staged for move / split
        row.style.opacity             = '0.45';
        row.style.borderBottom        = '1px solid ' + T.border;
        nameSpan.style.color          = T.text;
        nameSpan.style.textDecoration = 'line-through';
        priceSpan.style.color         = T.moon;

        row.appendChild(nameSpan);
        row.appendChild(priceSpan);

      } else {
        // Normal
        row.style.borderBottom = '1px solid ' + T.border;
        nameSpan.style.color   = T.text;
        priceSpan.style.color  = T.gold;

        row.appendChild(nameSpan);
        row.appendChild(priceSpan);
      }

      // Wire item tap
      (function(cIdx, iIdx) {
        var h = function() { handleItemTap(cIdx, iIdx, state); };
        row.addEventListener('pointerup', h);
        state.listeners.push({ el: row, event: 'pointerup', handler: h });
      })(colIdx, ii);

      itemList.appendChild(row);
    }
  }

  card.appendChild(itemList);

  state.colEls.push({
    el:       card,
    hdr:      hdr,
    hdrLabel: hdrLabel,
    hdrTotal: hdrTotal,
    itemList: itemList,
  });

  return card;
}

// ─────────────────────────────────────────────────────
//  buildAddCard(state) → card element
//
//  72px narrow card pinned to the right of the columns
//  area. Top half = + SEAT (T.green), bottom half =
//  + CHECK (T.gold), divided by a dashed gradient line.
// ─────────────────────────────────────────────────────
function buildAddCard(state) {
  // ── Card shell ────────────────────────────────────
  var card = document.createElement('div');
  card.style.width         = '72px';
  card.style.flexShrink    = '0';
  card.style.alignSelf     = 'stretch';
  card.style.background    = T.card;
  card.style.border        = '1px solid ' + T.border;
  card.style.borderRadius  = T.chamferCard + 'px';
  card.style.display       = 'flex';
  card.style.flexDirection = 'column';
  card.style.overflow      = 'hidden';

  // ── Zone factory ──────────────────────────────────
  function makeZone(plusColor, labelText, labelColor, onTap) {
    var zone = document.createElement('div');
    zone.style.flex           = '1';
    zone.style.display        = 'flex';
    zone.style.flexDirection  = 'column';
    zone.style.alignItems     = 'center';
    zone.style.justifyContent = 'center';
    zone.style.gap            = '4px';
    zone.style.cursor         = 'pointer';
    zone.style.pointerEvents  = 'auto';
    zone.style.touchAction    = 'manipulation';
    zone.style.userSelect     = 'none';

    zone.addEventListener('mouseenter', function() {
      zone.style.background = 'rgba(255,255,255,0.05)';
    });
    zone.addEventListener('mouseleave', function() {
      zone.style.background = '';
    });

    var plus = document.createElement('div');
    plus.textContent         = '+';
    plus.style.fontFamily    = T.fh;
    plus.style.fontSize      = T.fsH4;   // 26px
    plus.style.fontWeight    = T.fwBold;
    plus.style.color         = plusColor;
    plus.style.lineHeight    = '1';
    plus.style.pointerEvents = 'none';

    var lbl = document.createElement('div');
    lbl.textContent         = labelText;
    lbl.style.fontFamily    = T.fh;
    lbl.style.fontSize      = '8px';
    lbl.style.color         = labelColor;
    lbl.style.textAlign     = 'center';
    lbl.style.pointerEvents = 'none';

    zone.appendChild(plus);
    zone.appendChild(lbl);

    zone.addEventListener('pointerup', onTap);
    state.listeners.push({ el: zone, event: 'pointerup', handler: onTap });

    return zone;
  }

  // ── Top zone — + SEAT ─────────────────────────────
  card.appendChild(makeZone(
    T.green,
    'NEW SEAT',
    hexToRgba(T.green, 0.6),
    function() { handleAddSeat(state); }
  ));

  // ── Dashed divider ────────────────────────────────
  var divider = document.createElement('div');
  divider.style.height     = '1px';
  divider.style.flexShrink = '0';
  divider.style.background =
    'repeating-linear-gradient(to right, ' +
    T.border + ' 0, ' + T.border + ' 5px, ' +
    'transparent 5px, transparent 10px)';
  card.appendChild(divider);

  // ── Bottom zone — + CHECK ─────────────────────────
  card.appendChild(makeZone(
    T.gold,
    'NEW CHECK',
    hexToRgba(T.gold, 0.6),
    function() { handleAddCheck(state); }
  ));

  return card;
}

// ─────────────────────────────────────────────────────
//  renderOpsBar(state)
//
//  Clears and rebuilds state.opsPanel with the correct
//  pills for the current mode. Also (re)creates state.statusEl.
// ─────────────────────────────────────────────────────
function renderOpsBar(state) {
  var panel = state.opsPanel;
  while (panel.firstChild) panel.removeChild(panel.firstChild);

  // SPLIT — hidden while in split mode
  if (state.mode !== 'split') {
    var splitBtn = buildPillButton({
      label:    'SPLIT',
      color:    T.elec,
      darkBg:   T.elecDk,
      fontSize: T.fsB2,
    });
    splitBtn.addEventListener('pointerup', function() {
      state.mode          = 'split';
      state.selectedItems = [];
      state.splitTargets  = [];
      if (state.statusEl) state.statusEl.textContent = 'Select items · tap columns to target';
      renderOpsBar(state);
      renderColumns(state);
    });
    panel.appendChild(splitBtn);
  }

  // MERGE — neutral bg normally; gold when mode === 'merge'
  var mergeActive = state.mode === 'merge';
  var mergeBtn = buildPillButton({
    label:     'MERGE',
    color:     mergeActive ? T.gold  : T.card,
    darkBg:    mergeActive ? T.goldDk : darkenHex(T.card, 0.35),
    textColor: mergeActive ? T.well  : T.text,
    fontSize:  T.fsB2,
  });
  if (!mergeActive) mergeBtn.style.border = '1px solid ' + T.border;
  mergeBtn.addEventListener('pointerup', function() {
    state.mode = 'merge';
    if (state.statusEl) state.statusEl.textContent = 'Tap a column to merge all into it';
    renderOpsBar(state);
  });
  panel.appendChild(mergeBtn);

  // CANCEL — visible only when a mode is active (mode !== null)
  if (state.mode !== null) {
    var cancelBtn = buildPillButton({
      label:    'CANCEL',
      color:    T.verm,
      darkBg:   T.vermDk,
      fontSize: T.fsB2,
    });
    cancelBtn.addEventListener('pointerup', function() { clearMode(state); });
    panel.appendChild(cancelBtn);
  }

  // Status text — recreated each render; state.statusEl tracks the live node
  var statusEl = document.createElement('span');
  statusEl.style.fontFamily = T.fb;
  statusEl.style.fontSize   = '10px';
  statusEl.style.color      = hexToRgba(T.text, 0.6);
  statusEl.style.flex       = '1';
  statusEl.style.minWidth   = '0';
  state.statusEl = statusEl;
  panel.appendChild(statusEl);
}

// ─────────────────────────────────────────────────────
//  renderBottomCluster(state) → cluster element
//
//  Builds the UNDO + CONFIRM pill cluster and wires the
//  UNDO long-press (600 ms) fill animation + stubs.
// ─────────────────────────────────────────────────────
function renderBottomCluster(state) {
  function track(el, event, handler) {
    el.addEventListener(event, handler);
    state.listeners.push({ el: el, event: event, handler: handler });
  }

  var cluster = document.createElement('div');
  cluster.style.position = 'absolute';
  cluster.style.bottom   = '14px';
  cluster.style.right    = '14px';
  cluster.style.display  = 'flex';
  cluster.style.gap      = '8px';

  // ── UNDO pill ─────────────────────────────────────
  var undoBtn = buildPillButton({
    label:     'UNDO',
    color:     T.card,
    darkBg:    darkenHex(T.card, 0.35),
    textColor: T.text,
    fontSize:  T.fsB2,
  });
  undoBtn.style.border   = '1px solid ' + T.border;
  undoBtn.style.position = 'relative';
  undoBtn.style.overflow = 'hidden';

  // Wrap label text so it stacks above the fill layer
  var undoLabel = document.createElement('span');
  undoLabel.textContent    = 'UNDO';
  undoLabel.style.position = 'relative';
  undoLabel.style.zIndex   = '1';
  undoBtn.textContent      = '';
  undoBtn.appendChild(undoLabel);

  // Step counter badge
  if (state.actionLog.length > 0) {
    var cntBadge = document.createElement('span');
    cntBadge.textContent        = state.actionLog.length;
    cntBadge.style.position     = 'absolute';
    cntBadge.style.top          = '-6px';
    cntBadge.style.right        = '-6px';
    cntBadge.style.background   = T.elec;
    cntBadge.style.color        = T.well;
    cntBadge.style.borderRadius = T.pillRadius;
    cntBadge.style.fontFamily   = T.fb;
    cntBadge.style.fontSize     = T.fsB4;
    cntBadge.style.fontWeight   = T.fwBold;
    cntBadge.style.padding      = '1px 5px';
    cntBadge.style.pointerEvents = 'none';
    cntBadge.style.zIndex       = '2';
    undoBtn.appendChild(cntBadge);
  }

  // Long-press fill layer (scaleX 0 → 1, T.verm)
  var undoFill = document.createElement('div');
  undoFill.style.position        = 'absolute';
  undoFill.style.inset           = '0';
  undoFill.style.background      = T.verm;
  undoFill.style.transformOrigin = 'left center';
  undoFill.style.transform       = 'scaleX(0)';
  undoFill.style.transition      = 'none';
  undoFill.style.borderRadius    = T.pillRadius;
  undoFill.style.pointerEvents   = 'none';
  undoFill.style.zIndex          = '0';
  undoBtn.appendChild(undoFill);

  if (state.actionLog.length === 0) undoBtn.setDisabled(true);

  // Long-press interaction — stored in state so unmount can cancel it
  state._lpTimer = null;

  function _triggerUndoAll() {
    undoFill.style.transition = 'transform 0.2s linear';
    undoFill.style.transform  = 'scaleX(1)';
    setTimeout(function() {
      undoFill.style.transition = 'none';
      undoFill.style.transform  = 'scaleX(0)';
      handleUndoAll(state);
    }, 200);
  }

  function _cancelFill() {
    undoFill.style.transition = 'none';
    undoFill.style.transform  = 'scaleX(0)';
  }

  track(undoBtn, 'pointerdown', function() {
    if (undoBtn._disabled) return;
    state._lpTimer = setTimeout(function() {
      state._lpTimer = null;
      _triggerUndoAll();
    }, 600);
  });

  track(undoBtn, 'pointerup', function() {
    if (state._lpTimer !== null) {
      clearTimeout(state._lpTimer);
      state._lpTimer = null;
      handleUndo(state);
    }
  });

  track(undoBtn, 'pointerleave', function() {
    if (state._lpTimer !== null) {
      clearTimeout(state._lpTimer);
      state._lpTimer = null;
    }
    _cancelFill();
  });

  track(undoBtn, 'pointercancel', function() {
    if (state._lpTimer !== null) {
      clearTimeout(state._lpTimer);
      state._lpTimer = null;
    }
    _cancelFill();
  });

  cluster.appendChild(undoBtn);

  // ── CONFIRM pill ──────────────────────────────────
  var confirmBtn = buildPillButton({
    label:    'CONFIRM',
    color:    T.greenWarm,
    darkBg:   T.greenWarmDk,
    fontSize: T.fsB2,
  });
  confirmBtn.addEventListener('pointerup', function() { handleConfirm(state); });
  cluster.appendChild(confirmBtn);

  return cluster;
}

defineScene({
  name: 'column-editor',

  state: {
    listeners:     [],
    columns:       [],
    mode:          null,
    selectedItems: [],
    splitTargets:  [],
    colEls:        [],
    opsPanel:      null,
    columnsArea:   null,
    statusEl:      null,
    onSave:        null,
    actionLog:     [],
    snapshot:      null,
  },

  render: function(container, params, state) {
    // ── Init state from params ────────────────────────
    state.columns  = deepCopyColumns(params.columns || []);
    state.snapshot = deepCopyColumns(params.columns || []);
    state.onSave   = params.onSave || null;

    // ── Root ──────────────────────────────────────────
    var root = document.createElement('div');
    root.style.position      = 'absolute';
    root.style.inset         = '0';
    root.style.background    = T.bg;
    root.style.display       = 'flex';
    root.style.flexDirection = 'column';
    root.style.overflow      = 'hidden';
    container.appendChild(root);

    // ── Ops card ──────────────────────────────────────
    var opsCard = buildStaticCard({ accent: T.green });
    opsCard.style.margin        = '12px 12px 0';
    opsCard.style.flexShrink    = '0';
    opsCard.style.display       = 'flex';
    opsCard.style.flexDirection = 'column';

    opsCard.appendChild(buildSectionLabel('OPERATIONS', T.green));

    var opsBody = document.createElement('div');
    opsBody.style.display    = 'flex';
    opsBody.style.gap        = '10px';
    opsBody.style.alignItems = 'center';
    opsBody.style.flexWrap   = 'wrap';
    opsBody.style.marginTop  = '10px';
    state.opsPanel = opsBody;

    renderOpsBar(state);

    opsCard.appendChild(opsBody);
    root.appendChild(opsCard);

    // ── Columns area ──────────────────────────────────
    var colsArea = document.createElement('div');
    colsArea.style.flex            = '1';
    colsArea.style.margin          = '12px';
    colsArea.style.display         = 'flex';
    colsArea.style.gap             = '10px';
    colsArea.style.overflowX       = 'auto';
    colsArea.style.overflowY       = 'hidden';
    colsArea.style.scrollbarWidth  = 'none';
    colsArea.style.msOverflowStyle = 'none';
    state.columnsArea = colsArea;
    root.appendChild(colsArea);

    // ── Bottom-right cluster ──────────────────────────
    root.appendChild(renderBottomCluster(state));

    // ── Initial column render ─────────────────────────
    renderColumns(state);
  },

  unmount: function(state) {
    if (state._lpTimer !== null) {
      clearTimeout(state._lpTimer);
      state._lpTimer = null;
    }
    for (var i = 0; i < state.listeners.length; i++) {
      var l = state.listeners[i];
      l.el.removeEventListener(l.event, l.handler);
    }
    state.listeners = [];
  },
});
