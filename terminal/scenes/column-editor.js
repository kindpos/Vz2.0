import { SceneManager, defineScene } from '../scene-manager.js';
import { T } from '../../common/tokens.js';
import {
  buildPillButton,
  buildChamferButton,
  hexToRgba,
  darkenHex,
  lightenHex,
} from '../theme-manager.js';
import { showToast } from '../components.js';
import { entReport } from '../entomology-client.js';
import '../styles.js';

function fmt(n) {
  return '$' + (Number(n) || 0).toFixed(2);
}

// Normalise seat labels — "S-001" → "S1"
function formatSeatLabel(label) {
  var m = label.match(/^S-?0*(\d+)$/i);
  return m ? 'S' + m[1] : label;
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
      });
    }
    copy.push({ id: sc.id, label: sc.label, items: items });
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
    total += sp + (myIdx === tgts.length - 1 ? rem : 0); // remainder → last target
  }
  return total;
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
//  Log + mode helpers
// ─────────────────────────────────────────────────────

function pushLog(label, state) {
  state.actionLog.push({ label: label, columns: deepCopyColumns(state.columns) });
  if (state.undoBtnEl) state.undoBtnEl.setDisabled(false);
}

function clearMode(state) {
  state.mode          = null;
  state.selectedItems = [];
  state.splitTargets  = [];
  state.mergeTarget   = null;
  renderColumns(state);
  renderFooterToolbar(state);
}

// ─────────────────────────────────────────────────────
//  Interaction handlers
// ─────────────────────────────────────────────────────

function toggleSplitTarget(colIdx, state) {
  var found = state.splitTargets.indexOf(colIdx);
  if (found >= 0) state.splitTargets.splice(found, 1);
  else            state.splitTargets.push(colIdx);
  renderColumns(state);
  renderFooterToolbar(state);
}

function handleItemTap(colIdx, itemIdx, state) {
  // In split mode tapping an item targets the column, not the item
  if (state.mode === 'split') {
    toggleSplitTarget(colIdx, state);
    return;
  }
  if (state.mode === 'merge') return;

  var found = -1;
  for (var i = 0; i < state.selectedItems.length; i++) {
    if (state.selectedItems[i].colIdx === colIdx &&
        state.selectedItems[i].itemIdx === itemIdx) {
      found = i; break;
    }
  }
  if (found >= 0) state.selectedItems.splice(found, 1);
  else            state.selectedItems.push({ colIdx: colIdx, itemIdx: itemIdx });

  // Auto-activate MOVE on first item tap
  if (state.selectedItems.length > 0 && state.mode === null) state.mode = 'move';
  if (state.selectedItems.length === 0)                       state.mode = null;

  renderColumns(state);
  renderFooterToolbar(state);
}

function handleBodyTap(colIdx, state) {
  if (state.mode === 'split') {
    toggleSplitTarget(colIdx, state);
  } else if (state.mode === 'merge') {
    // Defer to CONFIRM — just record the target
    state.mergeTarget = colIdx;
    renderColumns(state);
    renderFooterToolbar(state);
  } else if (state.mode === 'move') {
    if (state.selectedItems.length > 0) doMove(colIdx, state);
    else showToast('Select items first', { bg: T.gold });
  }
}

function handleHeaderTap(colIdx, state) {
  var col = state.columns[colIdx];
  if (!col) return;
  // Toggle selection of all items in this column
  for (var ii = 0; ii < col.items.length; ii++) {
    var found = -1;
    for (var si = 0; si < state.selectedItems.length; si++) {
      if (state.selectedItems[si].colIdx === colIdx && state.selectedItems[si].itemIdx === ii) {
        found = si; break;
      }
    }
    if (found < 0) {
      // Not selected, add it
      state.selectedItems.push({ colIdx: colIdx, itemIdx: ii });
    } else {
      // Already selected, remove it
      state.selectedItems.splice(found, 1);
    }
  }
  // Auto-activate MOVE if items are selected
  if (state.selectedItems.length > 0 && state.mode === null) {
    state.mode = 'move';
  } else if (state.selectedItems.length === 0) {
    state.mode = null;
  }
  renderColumns(state);
  renderFooterToolbar(state);
}

function handleConfirm(state) {
  if (state.mode === 'split' &&
      state.selectedItems.length > 0 &&
      state.splitTargets.length >= 2) {
    doSplit(state);
  } else if (state.mode === 'merge' && state.mergeTarget !== null) {
    doMerge(state.mergeTarget, state);
  }
  if (state.onSave) state.onSave(state.columns);
  SceneManager.closeTransactional('column-editor');
}

// ─────────────────────────────────────────────────────
//  Move / Split / Merge / Void
// ─────────────────────────────────────────────────────

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
  renderFooterToolbar(state);
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
    var item     = extracted[ei].item;
    var source   = extracted[ei].source;
    var dSet     = {};
    for (var tt = 0; tt < state.splitTargets.length; tt++) dSet[state.splitTargets[tt]] = true;
    if (Object.keys(dSet).length === 0) dSet[source] = true;
    var targets  = Object.keys(dSet).map(Number);
    var n        = targets.length;
    var modSum   = Array.isArray(item.mods)
      ? item.mods.reduce(function(a, m) { return a + (m.price || 0); }, 0) : 0;
    var eff      = (item.price || 0) + modSum;
    var sp       = Math.round(eff / n * 100) / 100;
    var rem      = Math.round((eff - sp * n) * 100) / 100;
    var splitRef = item.item_id || ('sr-' + Date.now() + '-' + ei);
    for (var t = 0; t < n; t++) {
      var splitItem = {
        name:         item.name,
        qty:          item.qty,
        price:        sp + (t === n - 1 ? rem : 0),   // remainder → last target
        menu_item_id: item.menu_item_id,
        category:     item.category,
        mods:         [],
        notes:        item.notes,
        _splitRef:    splitRef,
      };
      if (t === n - 1 && item.item_id) splitItem.item_id = item.item_id;
      state.columns[targets[t]].items.push(splitItem);
    }
    entReport({
      code: 'UI-012', level: 'INFO', source: 'column-editor.split',
      message: 'Item split across ' + n + ' seat(s): ' + item.name,
      ctx: { split_ref: splitRef, item_name: item.name, seat_count: n },
    });
  }
  clearMode(state);
}

function doMerge(targetColIdx, state) {
  pushLog('Merged into ' + state.columns[targetColIdx].label, state);
  var target = state.columns[targetColIdx];
  for (var ci = 0; ci < state.columns.length; ci++) {
    if (ci === targetColIdx) continue;
    for (var ii = 0; ii < state.columns[ci].items.length; ii++) {
      target.items.push(state.columns[ci].items[ii]);
    }
  }
  var refsIn = {};
  for (var ri = 0; ri < target.items.length; ri++) {
    var ref = target.items[ri]._splitRef;
    if (ref) refsIn[ref] = (refsIn[ref] || 0) + 1;
  }
  var refKeys = Object.keys(refsIn);
  for (var rk = 0; rk < refKeys.length; rk++) {
    if (refsIn[refKeys[rk]] > 1) {
      entReport({
        code: 'UI-013', level: 'INFO', source: 'column-editor.merge',
        message: 'Split item recombined: ' + refKeys[rk],
        ctx: { split_ref: refKeys[rk] },
      });
    }
  }
  target.items = _collapseSplitGroups(target.items);
  state.columns = [target];
  clearMode(state);
}

function handleVoidSelected(state) {
  if (state.selectedItems.length === 0) return;
  pushLog('Voided items', state);
  var sorted = state.selectedItems.slice().sort(function(a, b) {
    return a.colIdx !== b.colIdx ? b.colIdx - a.colIdx : b.itemIdx - a.itemIdx;
  });
  for (var i = 0; i < sorted.length; i++) {
    var col = state.columns[sorted[i].colIdx];
    if (col) col.items.splice(sorted[i].itemIdx, 1);
  }
  clearMode(state);
}

// ─────────────────────────────────────────────────────
//  Seat management
// ─────────────────────────────────────────────────────

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
  state.visibleColIds.push(newCol.id);
  showToast('Added ' + newCol.label, { bg: T.green });
  renderColumns(state);
  renderSeatSelector(state);
}

// ─────────────────────────────────────────────────────
//  Undo
// ─────────────────────────────────────────────────────

function handleUndo(state) {
  if (state.actionLog.length === 0) return;
  var entry = state.actionLog.pop();
  state.columns       = entry.columns;
  state.selectedItems = [];
  state.splitTargets  = [];
  state.mergeTarget   = null;
  state.mode          = null;
  if (state.undoBtnEl) state.undoBtnEl.setDisabled(state.actionLog.length === 0);
  renderColumns(state);
  renderFooterToolbar(state);
}

function handleUndoAll(state) {
  if (!state.snapshot) return;
  state.columns       = deepCopyColumns(state.snapshot);
  state.actionLog     = [];
  state.selectedItems = [];
  state.splitTargets  = [];
  state.mergeTarget   = null;
  state.mode          = null;
  if (state.undoBtnEl) state.undoBtnEl.setDisabled(true);
  renderColumns(state);
  renderFooterToolbar(state);
}

// ─────────────────────────────────────────────────────
//  Hint + status text
// ─────────────────────────────────────────────────────

function getColHint(colIdx, state) {
  var n = state.selectedItems.length;
  var hasSelHere = state.selectedItems.some(function(s) { return s.colIdx === colIdx; });
  if (state.mode === 'move') {
    return hasSelHere ? 'Moving from this seat' : 'Tap to move selected items here';
  }
  if (state.mode === 'split') {
    var pos = state.splitTargets.indexOf(colIdx);
    if (pos < 0) return 'Tap to add as split target';
    return pos === state.splitTargets.length - 1
      ? 'Split target (receives remainder)'
      : 'Split target ' + (pos + 1);
  }
  if (state.mode === 'merge') {
    return state.mergeTarget === colIdx
      ? 'Everything merges into this seat'
      : 'Tap header to merge into this seat';
  }
  if (n > 0) return n + ' item' + (n !== 1 ? 's' : '') + ' selected — choose an action below';
  return 'Tap items or seat header to select';
}

function getStatusText(state) {
  var n = state.selectedItems.length;
  var t = state.splitTargets.length;
  if (state.mode === 'move') {
    return n + ' item' + (n !== 1 ? 's' : '') + ' selected · tap any column to move them';
  }
  if (state.mode === 'split') {
    if (t === 0) return n + ' item' + (n !== 1 ? 's' : '') + ' selected · tap seats to split across';
    return n + ' item' + (n !== 1 ? 's' : '') + ' · splitting across ' + t + ' seat' + (t !== 1 ? 's' : '');
  }
  if (state.mode === 'merge') {
    if (state.mergeTarget === null) return 'Tap a seat header to merge everything into';
    var lbl = state.columns[state.mergeTarget] ? state.columns[state.mergeTarget].label : '';
    return 'Tap CONFIRM to merge into ' + lbl;
  }
  if (n > 0) return n + ' item' + (n !== 1 ? 's' : '') + ' selected — choose an action below';
  return 'Tap items or a seat header to select';
}

// ─────────────────────────────────────────────────────
//  Act-button builder — matches Mode A action bar style
// ─────────────────────────────────────────────────────

function buildActBtn(opts) {
  var o      = opts || {};
  var btn    = document.createElement('div');
  var bg     = o.bg     || T.card;
  var dk     = o.dk     || T.moonDk;
  var shadow = '0 4px 0 ' + dk;

  btn.style.height         = o.height   || '46px';
  btn.style.padding        = o.padding  || '0 16px';
  btn.style.border         = o.border   || 'none';
  btn.style.borderRadius   = '10px';
  btn.style.background     = bg;
  btn.style.boxShadow      = o.ghost ? ('0 3px 0 ' + dk) : shadow;
  btn.style.color          = o.color    || T.text;
  btn.style.fontFamily     = T.fh;
  btn.style.fontWeight     = T.fwBold;
  btn.style.fontSize       = o.fontSize || T.fsB3;
  btn.style.letterSpacing  = '0.04em';
  btn.style.display        = 'flex';
  btn.style.alignItems     = 'center';
  btn.style.justifyContent = 'center';
  btn.style.cursor         = 'pointer';
  btn.style.pointerEvents  = 'auto';
  btn.style.touchAction    = 'manipulation';
  btn.style.userSelect     = 'none';
  btn.style.flexShrink     = '0';
  btn.style.transition     = 'transform 0.07s, box-shadow 0.07s';
  btn.style.gap            = '6px';
  if (o.minWidth) btn.style.minWidth = o.minWidth;

  if (o.label !== undefined) btn.textContent = o.label;

  // Press animation
  var baseShadow  = btn.style.boxShadow;
  var pressShadow = '0 1px 0 ' + dk;

  btn.addEventListener('pointerdown', function() {
    btn.style.transform  = 'translateY(3px)';
    btn.style.boxShadow  = pressShadow;
  });
  var _release = function() {
    btn.style.transform = 'none';
    btn.style.boxShadow = baseShadow;
  };
  btn.addEventListener('pointerup',     _release);
  btn.addEventListener('pointerleave',  _release);
  btn.addEventListener('pointercancel', _release);

  // Expose helpers for dynamic re-styling
  btn._baseShadow  = baseShadow;
  btn._pressShadow = pressShadow;
  btn.restyle = function(newBg, newDk, newColor) {
    btn.style.background = newBg;
    btn.style.color      = newColor || T.well;
    baseShadow           = '0 4px 0 ' + newDk;
    pressShadow          = '0 1px 0 ' + newDk;
    btn.style.boxShadow  = baseShadow;
    btn._baseShadow  = baseShadow;
    btn._pressShadow = pressShadow;
  };

  return btn;
}

// ─────────────────────────────────────────────────────
//  Column rendering
// ─────────────────────────────────────────────────────

function renderColumns(state) {
  var area = state.columnsArea;
  while (area.firstChild) area.removeChild(area.firstChild);
  state.colEls = [];
  for (var ci = 0; ci < state.columns.length; ci++) {
    area.appendChild(buildColumn(ci, state));
  }
}

function buildColumn(colIdx, state) {
  var col         = state.columns[colIdx];
  var isSplitTgt  = state.mode === 'split' && state.splitTargets.indexOf(colIdx) >= 0;
  var isMergeTgt  = state.mode === 'merge' && state.mergeTarget === colIdx;
  var accentColor = isSplitTgt ? T.elec : isMergeTgt ? T.greenWarm : T.green;
  var numColor    = isSplitTgt ? T.elec : isMergeTgt ? T.greenWarm : T.green;

  // ── Card ──────────────────────────────────────────
  var card = document.createElement('div');
  card.style.flex            = '1';
  card.style.minWidth        = '0';
  card.style.display         = 'flex';
  card.style.flexDirection   = 'column';
  card.style.overflowY       = 'auto';
  card.style.overflowX       = 'hidden';
  card.style.background      = T.card;
  card.style.borderRadius    = T.chamferCard + 'px';
  card.style.borderTop       = '3px solid ' + lightenHex(T.bg, 0.08);
  card.style.borderLeft      = '4px solid ' + accentColor;
  card.style.borderRight     = '3px solid ' + darkenHex(T.bg, 0.2);
  card.style.borderBottom    = '3px solid ' + darkenHex(T.bg, 0.2);
  card.style.scrollbarWidth  = 'none';
  card.style.msOverflowStyle = 'none';
  if (isSplitTgt) card.style.boxShadow = '0 0 0 1px ' + T.elec;
  if (isMergeTgt) card.style.boxShadow = '0 0 0 1px ' + T.greenWarm;

  // Column tap for MOVE / SPLIT / MERGE
  (function(idx) {
    var h = function(e) {
      if (e.target.closest('[data-item-row]')) return;
      if (e.target.closest('[data-col-header]')) return;
      // Body tap: in MOVE mode, move items; in other modes, do nothing; in null mode, do nothing
      if (state.mode === 'move') {
        handleBodyTap(idx, state);
      }
    };
    card.addEventListener('pointerup', h);
    state.listeners.push({ el: card, event: 'pointerup', handler: h });
  })(colIdx);

  // ── Header ────────────────────────────────────────
  var hdr = document.createElement('div');
  hdr.style.position      = 'sticky';
  hdr.style.top           = '0';
  hdr.style.zIndex        = '2';
  hdr.style.background    = T.well;
  hdr.style.padding       = '8px 12px';
  hdr.style.borderBottom  = '2px solid ' + darkenHex(T.bg, 0.2);
  hdr.style.cursor        = 'pointer';
  hdr.style.pointerEvents = 'auto';
  hdr.style.touchAction   = 'manipulation';
  hdr.style.flexShrink    = '0';

  var hdrTop = document.createElement('div');
  hdrTop.style.display        = 'flex';
  hdrTop.style.alignItems     = 'baseline';
  hdrTop.style.justifyContent = 'space-between';

  // Left: S# + subtotal (matches Mode A seat header)
  var hdrLeft = document.createElement('div');
  hdrLeft.style.display    = 'flex';
  hdrLeft.style.alignItems = 'baseline';
  hdrLeft.style.gap        = '8px';

  var seatNum = document.createElement('span');
  seatNum.textContent      = formatSeatLabel(col.label);
  seatNum.style.fontFamily = T.fh;
  seatNum.style.fontWeight = T.fwBold;
  seatNum.style.fontSize   = '24px';
  seatNum.style.color      = numColor;

  var seatSbtl = document.createElement('span');
  seatSbtl.textContent      = fmt(sumColumn(colIdx, state));
  seatSbtl.style.fontFamily = T.fb;
  seatSbtl.style.fontWeight = T.fwBold;
  seatSbtl.style.fontSize   = '17px';
  seatSbtl.style.color      = T.gold;

  hdrLeft.appendChild(seatNum);
  hdrLeft.appendChild(seatSbtl);

  var count = col.items.length;
  var itemCount = document.createElement('span');
  itemCount.textContent      = count === 0 ? 'empty' : count + ' item' + (count !== 1 ? 's' : '');
  itemCount.style.fontFamily = T.fb;
  itemCount.style.fontSize   = T.fsB4;
  itemCount.style.color      = T.moon;

  hdrTop.appendChild(hdrLeft);
  hdrTop.appendChild(itemCount);
  hdr.appendChild(hdrTop);

  hdr.dataset.colHeader = '1';

  (function(idx) {
    var h = function(e) {
      e.stopPropagation();
      // In MOVE/null modes: toggle selection of all items in the column
      // In SPLIT/MERGE modes: perform the mode action (toggle split target, set merge target)
      if (state.mode === 'move' || state.mode === null) {
        handleHeaderTap(idx, state);
      } else {
        handleBodyTap(idx, state);
      }
    };
    hdr.addEventListener('pointerup', h);
    state.listeners.push({ el: hdr, event: 'pointerup', handler: h });
  })(colIdx);

  card.appendChild(hdr);

  // ── Item list ─────────────────────────────────────
  var itemList = document.createElement('div');
  itemList.style.padding       = '6px 8px 8px';
  itemList.style.display       = 'flex';
  itemList.style.flexDirection = 'column';
  itemList.style.gap           = '5px';

  // Split preview cards
  if (isSplitTgt && state.splitTargets.length >= 2) {
    var total  = state.splitTargets.length;
    var isLast = state.splitTargets[total - 1] === colIdx;
    state.selectedItems.forEach(function(sel) {
      var srcItem = state.columns[sel.colIdx] && state.columns[sel.colIdx].items[sel.itemIdx];
      if (!srcItem) return;
      var baseCents  = Math.round((srcItem.price || 0) * (srcItem.qty || 1) * 100);
      var share      = Math.floor(baseCents / total);
      var priceCents = isLast ? share + (baseCents - share * total) : share;

      var pc = document.createElement('div');
      pc.style.border       = '1.5px dashed ' + T.elec;
      pc.style.borderRadius = '8px';
      pc.style.padding      = '5px 9px';

      var lbl = document.createElement('div');
      lbl.textContent      = 'split preview';
      lbl.style.fontFamily = T.fb;
      lbl.style.fontSize   = T.fsB4;
      lbl.style.fontStyle  = 'italic';
      lbl.style.color      = T.elec;
      lbl.style.marginBottom = '2px';

      var pr = document.createElement('div');
      pr.style.display = 'flex'; pr.style.justifyContent = 'space-between';

      var nm = document.createElement('span');
      nm.textContent = srcItem.name;
      nm.style.fontFamily = T.fb; nm.style.fontSize = T.fsB3; nm.style.color = T.text;

      var pv = document.createElement('span');
      pv.textContent = fmt(priceCents / 100);
      pv.style.fontFamily = T.fb; pv.style.fontWeight = T.fwBold;
      pv.style.fontSize = T.fsB3; pv.style.color = T.elec;

      pr.appendChild(nm); pr.appendChild(pv);
      pc.appendChild(lbl); pc.appendChild(pr);
      itemList.appendChild(pc);
    });
  }

  // Real items
  if (col.items.length === 0) {
    var emptyEl = document.createElement('div');
    emptyEl.textContent        = 'empty';
    emptyEl.style.textAlign    = 'center';
    emptyEl.style.padding      = '20px 0';
    emptyEl.style.fontFamily   = T.fb;
    emptyEl.style.fontSize     = T.fsB3;
    emptyEl.style.color        = T.moon;
    emptyEl.style.fontStyle    = 'italic';
    itemList.appendChild(emptyEl);
  } else {
    for (var ii = 0; ii < col.items.length; ii++) {
      var item = col.items[ii];
      var nameText = (item.qty > 1 ? item.qty + 'x ' : '') + item.name;

      var isSelected = false;
      for (var si = 0; si < state.selectedItems.length; si++) {
        if (state.selectedItems[si].colIdx === colIdx && state.selectedItems[si].itemIdx === ii) {
          isSelected = true; break;
        }
      }

      var highlightColor = isSelected ? T.green : (isSplitTgt ? T.elec : (isMergeTgt ? T.greenWarm : null));

      var row = document.createElement('div');
      row.style.display       = 'flex';
      row.style.alignItems    = 'center';
      row.style.padding       = '7px 8px';
      row.style.borderBottom  = '1px solid ' + T.border;
      row.style.borderRadius  = '4px';
      row.style.cursor        = 'pointer';
      row.style.pointerEvents = 'auto';
      row.style.touchAction   = 'manipulation';
      row.style.userSelect    = 'none';
      row.dataset.itemRow     = '1';
      if (highlightColor) row.style.background = hexToRgba(highlightColor, 0.12);

      var nameSpan = document.createElement('span');
      nameSpan.textContent    = nameText;
      nameSpan.style.flex     = '1';
      nameSpan.style.minWidth = '0';
      nameSpan.style.fontFamily = T.fb;
      nameSpan.style.fontSize   = T.fsB3;
      nameSpan.style.color      = highlightColor || T.text;

      var priceSpan = document.createElement('span');
      priceSpan.textContent      = fmt(item.qty * item.price);
      priceSpan.style.marginLeft = '8px';
      priceSpan.style.flexShrink = '0';
      priceSpan.style.fontFamily = T.fb;
      priceSpan.style.fontWeight = T.fwBold;
      priceSpan.style.fontSize   = T.fsB3;
      priceSpan.style.color      = highlightColor || T.gold;

      row.appendChild(nameSpan);
      row.appendChild(priceSpan);

      (function(cIdx, iIdx) {
        var h = function(e) { e.stopPropagation(); handleItemTap(cIdx, iIdx, state); };
        row.addEventListener('pointerup', h);
        state.listeners.push({ el: row, event: 'pointerup', handler: h });
      })(colIdx, ii);

      itemList.appendChild(row);
    }
  }

  card.appendChild(itemList);

  state.colEls.push({ el: card, hdr: hdr, itemList: itemList });
  return card;
}

// ─────────────────────────────────────────────────────
//  Footer toolbar
// ─────────────────────────────────────────────────────

function renderFooterToolbar(state) {
  var row = state.toolRowEl;
  if (!row) return;
  while (row.firstChild) row.removeChild(row.firstChild);

  var hasSel = state.selectedItems.length > 0;

  // Update hint bar
  if (state.hintBarEl) state.hintBarEl.textContent = getStatusText(state);

  // ── Left grid: MOVE / SPLIT / MERGE ──────────────
  var leftGrid = document.createElement('div');
  leftGrid.style.flex                  = '0 0 auto';
  leftGrid.style.width                 = '380px';
  leftGrid.style.display               = 'grid';
  leftGrid.style.gridTemplateColumns   = 'repeat(3, 1fr)';
  leftGrid.style.gap                   = '6px';

  var tools = [
    { id: 'move',  label: 'MOVE',  accent: T.green,    accentDk: T.greenDk  },
    { id: 'split', label: 'SPLIT', accent: T.elec,     accentDk: T.elecDk   },
    { id: 'merge', label: 'MERGE', accent: T.gold,     accentDk: T.goldDk   },
  ];

  tools.forEach(function(tool) {
    var isActive = state.mode === tool.id;
    var btn = buildChamferButton({
      label:    tool.label,
      accent:   isActive ? tool.accent : T.card,
      accentDk: isActive ? tool.accentDk : T.moonDk,
      isPrimary: false,
      fontSize: T.fsB3,
    });

    // Face styling: active = flooded, inactive = colored text on dark
    var faceEl = btn.children[0];
    if (faceEl) {
      faceEl.style.fontSize = T.fsB3;
      if (isActive) {
        faceEl.style.background = tool.accent;
        faceEl.style.color = T.well;
      } else {
        faceEl.style.background = '';
        faceEl.style.color = tool.accent;
      }
    }

    btn.addEventListener('pointerup', function() {
      if (state.mode === tool.id) { clearMode(state); return; }
      state.mode         = tool.id;
      state.splitTargets = [];
      state.mergeTarget  = null;
      renderColumns(state);
      renderFooterToolbar(state);
    });
    leftGrid.appendChild(btn);
  });

  row.appendChild(leftGrid);

  // Divider
  var divEl = document.createElement('div');
  divEl.style.width      = '1px';
  divEl.style.background = T.border;
  divEl.style.flexShrink = '0';
  divEl.style.margin     = '4px 0';
  row.appendChild(divEl);

  // ── Right grid: UNDO / CANCEL / CONFIRM ──────────
  var rightGrid = document.createElement('div');
  rightGrid.style.flex                = '1';
  rightGrid.style.display             = 'flex';
  rightGrid.style.gap                 = '6px';
  rightGrid.style.alignItems          = 'stretch';

  // UNDO button
  var undoBtn = buildChamferButton({
    label:  'UNDO',
    accent: T.text,
    accentDk: darkenHex(T.card, 0.4),
    isPrimary: false,
  });
  undoBtn.style.position = 'relative';
  undoBtn.style.width = '96px';
  undoBtn.style.flexShrink = '0';
  var undoFace = undoBtn.children[0];
  if (undoFace) {
    undoFace.style.fontSize = T.fsB3;
  }
  if (undoFace && state.actionLog.length > 0) {
    var badge = document.createElement('span');
    badge.textContent         = state.actionLog.length;
    badge.style.position      = 'absolute';
    badge.style.top           = '-6px';
    badge.style.right         = '-6px';
    badge.style.background    = T.elec;
    badge.style.color         = T.well;
    badge.style.borderRadius  = T.pillRadius;
    badge.style.fontFamily    = T.fb;
    badge.style.fontSize      = T.fsB4;
    badge.style.fontWeight    = T.fwBold;
    badge.style.padding       = '1px 5px';
    badge.style.pointerEvents = 'none';
    badge.style.zIndex        = '2';
    undoFace.appendChild(badge);
  }
  state.undoBtnEl = undoBtn;
  undoBtn.setDisabled = function(val) {
    var badge = undoFace.querySelector('span:last-child');
    if (badge) badge.style.display = val ? 'none' : 'block';
  };
  undoBtn.addEventListener('pointerup', function() {
    if (state.actionLog.length > 0) handleUndo(state);
  });
  state.listeners.push({ el: undoBtn, event: 'pointerup', handler: function() { if (state.actionLog.length > 0) handleUndo(state); } });
  rightGrid.appendChild(undoBtn);

  // RESET with long-press fill animation
  var resetBtn = buildChamferButton({
    label:  'RESET',
    accent: T.verm,
    accentDk: T.vermDk,
    isPrimary: false,
  });
  resetBtn.style.width = '96px';
  resetBtn.style.flexShrink = '0';
  var resetFace = resetBtn.children[0];
  resetFace.style.fontSize = T.fsB3;
  resetFace.style.position = 'relative';
  var undoFill = document.createElement('div');
  undoFill.style.position        = 'absolute';
  undoFill.style.inset           = '0';
  undoFill.style.background      = T.verm;
  undoFill.style.opacity         = '0.85';
  undoFill.style.transformOrigin = 'left center';
  undoFill.style.transform       = 'scaleX(0)';
  undoFill.style.transition      = 'none';
  undoFill.style.borderRadius    = 'inherit';
  undoFill.style.pointerEvents   = 'none';
  undoFill.style.zIndex          = '2';
  var undoFillWrap = document.createElement('div');
  undoFillWrap.style.position     = 'absolute';
  undoFillWrap.style.inset        = '0';
  undoFillWrap.style.overflow     = 'hidden';
  undoFillWrap.style.borderRadius = 'inherit';
  undoFillWrap.style.pointerEvents = 'none';
  undoFillWrap.appendChild(undoFill);
  resetFace.appendChild(undoFillWrap);
  var labelSpan = resetFace.querySelector('span:first-child');
  if (labelSpan) labelSpan.style.zIndex = '3';
  function _triggerReset() {
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
  var lpDown = function() {
    state._lpTimer = setTimeout(function() { state._lpTimer = null; _triggerReset(); }, 600);
  };
  var lpUp = function() {
    if (state._lpTimer !== null) { clearTimeout(state._lpTimer); state._lpTimer = null; clearMode(state); }
  };
  var lpLeave = function() {
    if (state._lpTimer !== null) { clearTimeout(state._lpTimer); state._lpTimer = null; }
    _cancelFill();
  };
  resetBtn.addEventListener('pointerdown',   lpDown);
  resetBtn.addEventListener('pointerup',     lpUp);
  resetBtn.addEventListener('pointerleave',  lpLeave);
  resetBtn.addEventListener('pointercancel', lpLeave);
  state.listeners.push({ el: resetBtn, event: 'pointerdown',   handler: lpDown  });
  state.listeners.push({ el: resetBtn, event: 'pointerup',     handler: lpUp    });
  state.listeners.push({ el: resetBtn, event: 'pointerleave',  handler: lpLeave });
  state.listeners.push({ el: resetBtn, event: 'pointercancel', handler: lpLeave });
  rightGrid.appendChild(resetBtn);

  // CONFIRM
  var confirmBtn = buildChamferButton({
    label: 'CONFIRM',
    accent: T.greenWarm,
    accentDk: T.greenWarmDk,
    isPrimary: true,
    fontSize: T.fsB3,
  });
  confirmBtn.style.flex = '1';
  confirmBtn.style.minWidth = '120px';
  var confirmFace = confirmBtn.children[0];
  if (confirmFace) {
    confirmFace.style.fontSize = T.fsB2;
  }
  confirmBtn.addEventListener('pointerup', function() { handleConfirm(state); });
  state.listeners.push({ el: confirmBtn, event: 'pointerup', handler: function() { handleConfirm(state); } });
  rightGrid.appendChild(confirmBtn);

  row.appendChild(rightGrid);
}

// ─────────────────────────────────────────────────────
//  Seat selector
// ─────────────────────────────────────────────────────

function renderSeatSelector(state) {
  var container = state.seatSelectorEl;
  if (!container) return;
  while (container.firstChild) container.removeChild(container.firstChild);

  var params       = state._params;
  var manySeats    = state.allColumns.length > 5;
  // In grid mode tiles are smaller; in strip mode they use standard act-btn height
  var tileHeight   = manySeats ? '28px' : '46px';
  var tileFontSize = manySeats ? '12px' : T.fsB3;

  function makeSeatTile(seat) {
    var active = state.visibleColIds.indexOf(seat.id) >= 0;
    var tile = buildChamferButton({
      label:    formatSeatLabel(seat.label),
      accent:   T.green,
      accentDk: T.greenDk,
      isPrimary: false,
      height:   tileHeight,
      fontSize: tileFontSize,
    });
    tile.style.width = '56px';
    tile.style.flexShrink = '0';

    // If active, flood the face
    if (active) {
      var face = tile.children[0];
      if (face) {
        face.style.background = T.green;
        face.style.color = T.well;
      }
    }

    var h = function() {
      var idx = state.visibleColIds.indexOf(seat.id);
      if (idx >= 0) {
        if (state.visibleColIds.length <= 1) return;
        state.visibleColIds.splice(idx, 1);
        state.columns = state.columns.filter(function(c) { return c.id !== seat.id; });
        state.selectedItems = state.selectedItems.filter(function(s) {
          return state.columns[s.colIdx] !== undefined;
        });
        state.splitTargets = []; state.mergeTarget = null;
      } else {
        var src = (params.columns || []).filter(function(c) { return c.id === seat.id; })[0];
        if (src) {
          state.columns.push(deepCopyColumns([src])[0]);
          state.visibleColIds.push(seat.id);
        }
      }
      renderColumns(state);
      renderSeatSelector(state);
      renderFooterToolbar(state);
    };
    tile.addEventListener('pointerup', h);
    state.listeners.push({ el: tile, event: 'pointerup', handler: h });
    return tile;
  }

  // ALL tile
  var allActive = state.visibleColIds.length === state.allColumns.length;
  var allTile = buildChamferButton({
    label:    'ALL',
    accent:   T.moon,
    accentDk: T.moonDk,
    isPrimary: false,
    height:   tileHeight,
    fontSize: tileFontSize,
  });
  allTile.style.width = '56px';
  allTile.style.flexShrink = '0';

  // If active, flood the face
  if (allActive) {
    var allFace = allTile.children[0];
    if (allFace) {
      allFace.style.background = T.moon;
      allFace.style.color = T.moonText;
    }
  }

  var allH = function() {
    if (state.visibleColIds.length < state.allColumns.length) {
      state.visibleColIds = state.allColumns.map(function(c) { return c.id; });
      state.columns = deepCopyColumns(state._params.columns || []);
    } else {
      if (state.allColumns.length > 0) {
        state.visibleColIds = [state.allColumns[0].id];
        state.columns = deepCopyColumns([(state._params.columns || [])[0] || state.allColumns[0]]);
      }
    }
    state.selectedItems = []; state.splitTargets = []; state.mergeTarget = null;
    renderColumns(state);
    renderSeatSelector(state);
    renderFooterToolbar(state);
  };
  allTile.addEventListener('pointerup', allH);
  state.listeners.push({ el: allTile, event: 'pointerup', handler: allH });

  // + add tile
  var addTile = buildChamferButton({
    label:    '+',
    accent:   T.green,
    accentDk: T.greenDk,
    isPrimary: false,
    height:   tileHeight,
    fontSize: manySeats ? '18px' : T.fsB2,
  });
  addTile.style.width = '56px';
  addTile.style.flexShrink = '0';
  var addH = function() { handleAddSeat(state); };
  addTile.addEventListener('pointerup', addH);
  state.listeners.push({ el: addTile, event: 'pointerup', handler: addH });

  if (manySeats) {
    // Grid mode: tiles go directly into the grid container
    state.allColumns.forEach(function(seat) {
      container.appendChild(makeSeatTile(seat));
    });
    container.appendChild(allTile);
    container.appendChild(addTile);
  } else {
    // Strip mode: tiles + separator + ALL + +
    state.allColumns.forEach(function(seat) {
      container.appendChild(makeSeatTile(seat));
    });
    var sep = document.createElement('div');
    sep.style.width      = '1px';
    sep.style.height     = '32px';
    sep.style.background = T.border;
    sep.style.flexShrink = '0';
    sep.style.margin     = '0 2px';
    container.appendChild(sep);
    container.appendChild(allTile);
    container.appendChild(addTile);
  }
}

// ─────────────────────────────────────────────────────
//  Seat row (footer row 1)
// ─────────────────────────────────────────────────────

function buildSeatRow(state, params) {
  var manySeats = state.allColumns.length > 5;
  var bevelLt   = lightenHex(T.bg, 0.08);
  var bevelDk   = darkenHex(T.bg, 0.2);

  var row = document.createElement('div');
  row.style.flex        = '1';
  row.style.display     = 'flex';
  row.style.alignItems  = 'center';
  row.style.gap         = '7px';

  if (!manySeats) {
    // ── Strip: horizontal scrolling ──
    var strip = document.createElement('div');
    strip.style.flex            = '1';
    strip.style.display         = 'flex';
    strip.style.gap             = '6px';
    strip.style.overflowX       = 'auto';
    strip.style.scrollbarWidth  = 'none';
    strip.style.msOverflowStyle = 'none';
    strip.style.alignItems      = 'center';
    strip.style.flexShrink      = '0';
    strip.style.overflow        = 'visible';
    state.seatSelectorEl = strip;
    renderSeatSelector(state);
    row.appendChild(strip);
  }
  // In grid mode: seatSelectorEl will be set by buildSeatGridOverlay

  return row;
}

// ─────────────────────────────────────────────────────
//  Seat grid overlay — floats above the bottom bar
//  Position: absolute, bottom 122px, width 70%, z-index 5
// ─────────────────────────────────────────────────────

function buildSeatGridOverlay(state, params) {
  var bevelLt = lightenHex(T.bg, 0.08);
  var bevelDk = darkenHex(T.bg, 0.2);

  var overlay = document.createElement('div');
  overlay.style.position     = 'absolute';
  overlay.style.bottom       = '122px';   // bar(116px) + gap(6px)
  overlay.style.left         = '8px';
  overlay.style.width        = '70%';
  overlay.style.zIndex       = '5';
  overlay.style.background   = T.well;
  overlay.style.borderTop    = '3px solid ' + bevelLt;
  overlay.style.borderLeft   = '3px solid ' + bevelLt;
  overlay.style.borderRight  = '3px solid ' + bevelDk;
  overlay.style.borderBottom = '3px solid ' + bevelDk;
  overlay.style.borderRadius = T.chamferCard + 'px';
  overlay.style.overflow     = 'hidden';
  overlay.style.boxShadow    = '0 -6px 20px rgba(0,0,0,0.45)';

  var grid = document.createElement('div');
  grid.style.display             = 'grid';
  grid.style.gridTemplateColumns = 'repeat(10, 1fr)';
  grid.style.gap                 = '4px';
  grid.style.padding             = '6px';
  grid.style.overflowY           = 'auto';
  grid.style.maxHeight           = '134px';   // 4 rows × 28px + 3 gaps + padding
  grid.style.scrollbarWidth      = 'none';
  grid.style.msOverflowStyle     = 'none';
  grid.style.touchAction         = 'pan-y';
  grid.style.pointerEvents       = 'auto';

  state.seatSelectorEl = grid;
  renderSeatSelector(state);
  overlay.appendChild(grid);
  return overlay;
}

// ─────────────────────────────────────────────────────
//  Bottom bar shell (wraps seat row + tool row)
// ─────────────────────────────────────────────────────

function buildBottomBar(state, params) {
  var bar = document.createElement('div');
  bar.style.height      = '128px';
  bar.style.flexShrink  = '0';
  bar.style.background  = T.well;
  bar.style.borderTop   = '2px solid ' + T.border;
  bar.style.display     = 'flex';
  bar.style.flexDirection = 'column';
  bar.style.padding     = '6px 8px 10px';
  bar.style.gap         = '6px';
  bar.style.overflow    = 'visible';

  // Row 1: seat strip (or just DISC/VOID in grid mode)
  bar.appendChild(buildSeatRow(state, params));

  // Row 2: tool row (populated by renderFooterToolbar)
  var toolRow = document.createElement('div');
  toolRow.style.height      = '60px';
  toolRow.style.flexShrink  = '0';
  toolRow.style.display     = 'flex';
  toolRow.style.alignItems  = 'stretch';
  toolRow.style.gap         = '8px';
  toolRow.style.overflow    = 'visible';
  state.toolRowEl = toolRow;
  bar.appendChild(toolRow);

  return bar;
}

// ─────────────────────────────────────────────────────
//  Header
// ─────────────────────────────────────────────────────

function buildHeader(state, params) {
  var hdr = document.createElement('div');
  hdr.style.height         = T.headerH + 'px';   // matches Mode A
  hdr.style.flexShrink     = '0';
  hdr.style.background     = T.well;
  hdr.style.borderBottom   = '2px solid ' + T.border;
  hdr.style.display        = 'flex';
  hdr.style.alignItems     = 'center';
  hdr.style.padding        = '0 12px';
  hdr.style.gap            = '10px';

  var checkLabel = document.createElement('span');
  var orderNum   = params.checkNumber || '';
  checkLabel.textContent      = 'CHECK #' + orderNum;
  checkLabel.style.fontFamily = T.fh;
  checkLabel.style.fontWeight = T.fwBold;
  checkLabel.style.fontSize   = T.fsB2;
  checkLabel.style.color      = T.green;
  checkLabel.style.letterSpacing = '0.06em';
  checkLabel.style.flex       = '1';
  hdr.appendChild(checkLabel);

  return hdr;
}

// ─────────────────────────────────────────────────────
//  Manager PIN overlay
// ─────────────────────────────────────────────────────

function openPinOverlay(forAction, state) {
  var scrim = document.createElement('div');
  scrim.style.position       = 'absolute';
  scrim.style.inset          = '0';
  scrim.style.zIndex         = '20';
  scrim.style.background     = hexToRgba(T.well, 0.88);
  scrim.style.display        = 'flex';
  scrim.style.alignItems     = 'center';
  scrim.style.justifyContent = 'center';

  var card = document.createElement('div');
  card.style.position        = 'relative';
  card.style.backgroundColor = T.well;
  card.style.borderRadius    = '12px';
  card.style.borderLeft      = '5px solid ' + T.gold;
  card.style.borderTop       = '5px solid ' + lightenHex(T.bg, 0.08);
  card.style.borderRight     = '5px solid ' + darkenHex(T.bg, 0.2);
  card.style.borderBottom    = '5px solid ' + darkenHex(T.bg, 0.2);
  card.style.boxShadow       = 'inset 0 1px 0 rgba(255,255,255,0.06), 3px 5px 0 rgba(0,0,0,0.55)';
  card.style.width           = '340px';
  card.style.padding         = '20px 22px 22px';
  card.style.display         = 'flex';
  card.style.flexDirection   = 'column';
  card.style.gap             = '14px';
  card.style.boxSizing       = 'border-box';

  var title = document.createElement('div');
  title.textContent         = 'MANAGER PIN';
  title.style.fontFamily    = T.fh;
  title.style.fontWeight    = T.fwBold;
  title.style.fontSize      = T.fsB3;
  title.style.letterSpacing = '0.18em';
  title.style.color         = T.gold;
  title.style.textAlign     = 'center';
  card.appendChild(title);

  var sub = document.createElement('div');
  sub.textContent      = 'Required for ' + forAction;
  sub.style.fontFamily = T.fb;
  sub.style.fontSize   = T.fsB4;
  sub.style.fontStyle  = 'italic';
  sub.style.color      = T.moon;
  sub.style.textAlign  = 'center';
  sub.style.marginTop  = '-8px';
  card.appendChild(sub);

  var dotsRow = document.createElement('div');
  dotsRow.style.display        = 'flex';
  dotsRow.style.gap            = '10px';
  dotsRow.style.justifyContent = 'center';
  var dots = [];
  for (var d = 0; d < 4; d++) {
    var dot = document.createElement('div');
    dot.style.width = '14px'; dot.style.height = '14px';
    dot.style.borderRadius = '50%';
    dot.style.background   = T.card;
    dot.style.border       = '1px solid ' + T.border;
    dotsRow.appendChild(dot); dots.push(dot);
  }
  card.appendChild(dotsRow);

  function updateDots(entry) {
    dots.forEach(function(dot, i) {
      dot.style.background = i < entry.length ? T.gold : T.card;
      dot.style.border     = '1px solid ' + (i < entry.length ? darkenHex(T.gold, 0.3) : T.border);
    });
  }

  var entry  = '';
  var numpad = document.createElement('div');
  numpad.style.display             = 'grid';
  numpad.style.gridTemplateColumns = 'repeat(3, 1fr)';
  numpad.style.gap                 = '6px';

  ['1','2','3','4','5','6','7','8','9','CLR','0','ENT'].forEach(function(k) {
    var btn = buildActBtn({
      label:    k,
      bg:       T.card,
      dk:       k === 'ENT' ? T.greenWarmDk : k === 'CLR' ? T.vermDk : T.moonDk,
      color:    k === 'CLR' ? T.verm : k === 'ENT' ? T.greenWarm : T.green,
      border:   'none',
      height:   '44px',
      ghost:    false,
    });
    btn.addEventListener('pointerup', function() {
      if (k === 'CLR') { entry = ''; }
      else if (k === 'ENT') {
        if (entry.length >= 4) {
          scrim.parentNode && scrim.parentNode.removeChild(scrim);
          if (forAction === 'discount') {
            var p = state._params;
            if (p && p.onDiscount) p.onDiscount(state.selectedItems);
            showToast('Discount applied', { bg: T.lavender });
            clearMode(state);
          } else { handleVoidSelected(state); }
        }
        return;
      } else if (entry.length < 4) { entry += k; }
      updateDots(entry);
    });
    numpad.appendChild(btn);
  });
  card.appendChild(numpad);

  var cancelBtn = buildActBtn({
    label:  'CANCEL',
    bg:     T.card,
    dk:     T.moonDk,
    color:  T.moon,
    border: '1px solid ' + T.border,
    ghost:  true,
    height: '38px',
  });
  cancelBtn.addEventListener('pointerup', function() {
    scrim.parentNode && scrim.parentNode.removeChild(scrim);
  });
  card.appendChild(cancelBtn);

  scrim.appendChild(card);
  state.columnsArea.parentNode.appendChild(scrim);
}

// ─────────────────────────────────────────────────────
//  Scene definition
// ─────────────────────────────────────────────────────

defineScene({
  name: 'column-editor',

  state: {
    listeners:      [],
    columns:        [],
    allColumns:     [],
    visibleColIds:  [],
    mode:           null,
    selectedItems:  [],
    splitTargets:   [],
    mergeTarget:    null,
    colEls:         [],
    columnsArea:    null,
    toolRowEl:      null,
    seatSelectorEl: null,
    hintBarEl:      null,
    onSave:         null,
    actionLog:      [],
    snapshot:       null,
    _lpTimer:       null,
    _params:        null,
  },

  render: function(container, params, state) {
    state._params       = params;
    state.allColumns    = params.allColumns || deepCopyColumns(params.columns || []);
    state.visibleColIds = params.focusedIds
      ? params.focusedIds.slice()
      : (state.allColumns.length > 0 ? [state.allColumns[0].id] : []);
    state.mergeTarget   = null;
    state.onSave        = params.onSave || null;
    state.mode          = null;
    state.selectedItems = [];
    state.splitTargets  = [];
    state.actionLog     = [];
    state._lpTimer      = null;

    state.columns = deepCopyColumns(
      (params.columns || []).filter(function(c) {
        return state.visibleColIds.indexOf(c.id) >= 0;
      })
    );
    if (state.columns.length === 0 && params.columns && params.columns.length > 0) {
      state.columns       = deepCopyColumns([params.columns[0]]);
      state.visibleColIds = [params.columns[0].id];
    }
    state.snapshot = deepCopyColumns(state.columns);

    var root = document.createElement('div');
    root.style.position      = 'absolute';
    root.style.inset         = '0';
    root.style.background    = T.bg;
    root.style.zIndex        = String(T.zTransactional);
    root.style.display       = 'flex';
    root.style.flexDirection = 'column';
    root.style.overflow      = 'hidden';
    container.appendChild(root);

    root.appendChild(buildHeader(state, params));

    // ── Hint bar ─────────────────────────────────────
    var hintBar = document.createElement('div');
    hintBar.style.height      = '28px';
    hintBar.style.flexShrink  = '0';
    hintBar.style.background  = T.well;
    hintBar.style.borderBottom = '1px solid ' + darkenHex(T.bg, 0.2);
    hintBar.style.display     = 'flex';
    hintBar.style.alignItems  = 'center';
    hintBar.style.padding     = '0 14px';
    hintBar.style.fontFamily  = T.fb;
    hintBar.style.fontSize    = T.fsB4;
    hintBar.style.fontStyle   = 'italic';
    hintBar.style.color       = T.text;
    hintBar.textContent       = getStatusText(state);
    state.hintBarEl = hintBar;
    root.appendChild(hintBar);

    var colsArea = document.createElement('div');
    colsArea.style.flex          = '1';
    colsArea.style.minHeight     = '0';
    colsArea.style.display       = 'flex';
    colsArea.style.flexDirection = 'row';
    colsArea.style.gap           = '8px';
    colsArea.style.padding       = '8px';
    colsArea.style.overflow      = 'hidden';
    colsArea.style.background    = T.bg;
    state.columnsArea = colsArea;
    root.appendChild(colsArea);

    root.appendChild(buildBottomBar(state, params));

    // In grid mode: seat selector floats above the bar as an overlay
    if (state.allColumns.length > 5) {
      root.appendChild(buildSeatGridOverlay(state, params));
    }

    renderColumns(state);
    renderFooterToolbar(state);
  },

  unmount: function(state) {
    if (state._lpTimer !== null) { clearTimeout(state._lpTimer); state._lpTimer = null; }
    for (var i = 0; i < state.listeners.length; i++) {
      var l = state.listeners[i];
      l.el.removeEventListener(l.event, l.handler);
    }
    state.listeners = [];
  },
});