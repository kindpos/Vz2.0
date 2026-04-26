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
//  Action stubs — logic implemented in a later pass
// ─────────────────────────────────────────────────────
function handleUndo(state) {}
function handleUndoAll(state) {}
function handleAddSeat(state) {}
function handleAddCheck(state) {}

// ─────────────────────────────────────────────────────
//  buildColumn(colIdx, state) → card element
//
//  Renders one column card: header + scrollable item list.
//  Registers the card refs in state.colEls[colIdx].
//  No event listeners — wired by the caller.
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
  panel.appendChild(mergeBtn);

  // CANCEL — visible only when a mode is active (mode !== null)
  if (state.mode !== null) {
    var cancelBtn = buildPillButton({
      label:    'CANCEL',
      color:    T.verm,
      darkBg:   T.vermDk,
      fontSize: T.fsB2,
    });
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

  // Long-press interaction
  var longPressTimer = null;

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
    longPressTimer = setTimeout(function() {
      longPressTimer = null;
      _triggerUndoAll();
    }, 600);
  });

  track(undoBtn, 'pointerup', function() {
    if (longPressTimer !== null) {
      clearTimeout(longPressTimer);
      longPressTimer = null;
      handleUndo(state);
    }
  });

  track(undoBtn, 'pointerleave', function() {
    if (longPressTimer !== null) {
      clearTimeout(longPressTimer);
      longPressTimer = null;
    }
    _cancelFill();
  });

  track(undoBtn, 'pointercancel', function() {
    if (longPressTimer !== null) {
      clearTimeout(longPressTimer);
      longPressTimer = null;
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
  },

  unmount: function(state) {
    for (var i = 0; i < state.listeners.length; i++) {
      var l = state.listeners[i];
      l.el.removeEventListener(l.event, l.handler);
    }
    state.listeners = [];
  },
});
