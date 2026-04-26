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
      nameSpan.textContent   = nameText;
      nameSpan.style.flex    = '1';
      nameSpan.style.minWidth = '0';

      var priceSpan = document.createElement('span');
      priceSpan.textContent       = fmt(item.qty * item.price);
      priceSpan.style.marginLeft  = '8px';
      priceSpan.style.flexShrink  = '0';
      priceSpan.style.fontFamily  = T.fb;
      priceSpan.style.fontSize    = T.fsB3;

      if (isTarget) {
        // Ghost row: column is a split destination
        row.style.background   = hexToRgba(T.elec, 0.05);
        row.style.borderBottom = '1px dashed ' + T.border;
        nameSpan.style.color   = T.text;
        priceSpan.style.color  = T.gold;

        var badge = document.createElement('span');
        badge.textContent        = '÷' + nTargets;
        badge.style.fontFamily   = T.fh;
        badge.style.fontSize     = T.fsB4;
        badge.style.fontWeight   = T.fwBold;
        badge.style.color        = T.elec;
        badge.style.marginLeft   = '6px';
        badge.style.flexShrink   = '0';

        row.appendChild(nameSpan);
        row.appendChild(badge);
        row.appendChild(priceSpan);

      } else if (isSelected) {
        // Staged for move / split
        row.style.opacity            = '0.45';
        row.style.borderBottom       = '1px solid ' + T.border;
        nameSpan.style.color         = T.text;
        nameSpan.style.textDecoration = 'line-through';
        priceSpan.style.color        = T.moon;

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

    var statusEl = document.createElement('div');
    statusEl.style.fontFamily = T.fb;
    statusEl.style.fontSize   = T.fsB3;
    statusEl.style.color      = hexToRgba(T.text, 0.75);
    statusEl.style.marginLeft = '8px';
    statusEl.style.flex       = '1';
    statusEl.style.minWidth   = '0';
    state.statusEl = statusEl;
    opsBody.appendChild(statusEl);

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
    var cluster = document.createElement('div');
    cluster.style.position = 'absolute';
    cluster.style.bottom   = '14px';
    cluster.style.right    = '14px';
    cluster.style.display  = 'flex';
    cluster.style.gap      = '8px';
    cluster.appendChild(buildPillButton({ label: '', color: T.card, darkBg: darkenHex(T.card, 0.4) }));
    cluster.appendChild(buildPillButton({ label: '', color: T.card, darkBg: darkenHex(T.card, 0.4) }));
    root.appendChild(cluster);
  },

  unmount: function(state) {},
});
