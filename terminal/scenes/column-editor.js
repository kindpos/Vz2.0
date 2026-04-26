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
    opsCard.style.margin      = '12px 12px 0';
    opsCard.style.flexShrink  = '0';
    opsCard.style.display     = 'flex';
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
