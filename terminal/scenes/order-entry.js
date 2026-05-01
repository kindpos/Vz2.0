// ═══════════════════════════════════════════════════
//  KINDpos Terminal — Order Entry Scene (Vz2.0)
//  Item entry tool — child of check-overview
//  Nice. Dependable. Yours.
// ═══════════════════════════════════════════════════
/**
 * FLOW MAP — CHECK & SEAT INTEGRITY
 * 
 * 1. Entry (New Check):
 *    - User taps "NEW CHECK" on server-landing.
 *    - check-overview.js mounts with checkId: null.
 *    - UI shows "NEW CHECK". No backend record exists yet.
 * 
 * 2. Entry (Add Items):
 *    - User taps "ADD ITEMS" in check-overview.
 *    - Navigation to order-entry.js happens with currentOrderId=null.
 *    - Order is NOT created yet (Fixed: premature POST removed from check-overview).
 * 
 * 3. Order Entry:
 *    - User adds items to the local 'ticket' array.
 *    - If User taps "SEND":
 *        - Step 1: POST /orders (created only now).
 *        - Step 2: POST /orders/:id/items for each item.
 *        - Step 3: POST /orders/:id/send (kitchen confirm).
 *    - If User taps "BACK":
 *        - handleClose() mounts check-overview.
 *        - If no items were sent, no order was ever created on backend. (Fixed)
 * 
 * 4. Landing Page:
 *    - server-landing.js fetches /orders?server_id=...
 *    - Backend filters out any checks with status='open' but 0 items. (Fixed)
 * 
 * 5. Seat Integrity:
 *    - Seats are derived from order.items in check-overview.js.
 *    - Voided or empty checks do not occupy seats or affect table stats. (Fixed)
 */

import { SceneManager, defineScene } from '../scene-manager.js';
import { T } from '../../common/tokens.js';
import { buildCard, buildStaticCard, buildPillButton, hexToRgba, lightenHex, darkenHex, buildDataRow } from '../theme-manager.js';
import { showToast } from '../components.js';
import { OrderSummary } from '../order-summary.js';
import { showKeyboard, hideKeyboard } from '../keyboard.js';
import { showHalfPlacementOverlay } from '../half-placement-overlay.js';
import { showPizzaBuilderOverlay } from '../pizza-builder-overlay.js';
import { PREFIXES as UNI_PREFIXES, getModHexData, hasPizzaCategory, PIZZA_PLACEMENTS, MOD_COLORS } from '../menu-data/universal-modifiers.js';
import { computeTotals } from '../pricing.js';
import { fetchWithTimeout } from '../net.js';
import { entReport } from '../entomology-client.js';
import { formatModifierLabel } from '../modifier-label.js';
import { buildCheckOverviewParams } from './transitions.js';

var PAD      = 16;
var GAP      = 16;
var BTN_H    = 50;
var OVERLAP  = 18;

// Pricing rates come from frontend/js/pricing.js — one source of truth
// for TAX_RATE / CASH_DISCOUNT across every scene, so a stale copy can't
// leak into a payment amount.

// ── API ───────────────────────────────────────────
var API = '/api/v1';

// ── Order ID — one per transaction, reset on fresh enter ──
var currentOrderId = null;
var _header = null;
var isSending = false;   // guard against concurrent handleSend calls

// Flip the in-flight flag AND re-render the bottom bar so the SAVE/SEND
// buttons dim + swap their labels while the POST chain runs. Without this,
// a user who taps SEND gets no visual feedback, taps again, and sees every
// subsequent tap silently swallowed by the isSending guard.
function setSending(v) {
  isSending = v;
  try { if (typeof rebuildBottomBar === 'function') rebuildBottomBar(); }
  catch (e) { /* rebuildBottomBar can throw if the scene is mid-teardown */ }
}

function _idemKey() {
  return 'ik_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);
}
var currentCheckNumber = null;
var currentCustomerName = null;
// Per-scene idempotency key for POST /orders. If SEND/SAVE fails after
// the backend already created the order (e.g. client timeout), retrying
// with the same key causes the ledger to return the same event instead
// of minting a duplicate C-NNN. Cleared once currentOrderId is set.
var createOrderIdemKey = null;

function _handleNameTap() {
  if (!currentOrderId) {
    showToast('Send items first to name this check', { bg: T.gold, duration: 2000 });
    return;
  }
  SceneManager.interrupt('oe-name-input', {
    onConfirm: function(name) {
      fetchWithTimeout(API + '/orders/' + currentOrderId, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ customer_name: name }),
      }, 15000).then(function(r) {
        if (r.ok) {
          currentCustomerName = name;
          OrderSummary.update({ customerName: name });
          showToast(name ? 'Named: ' + name : 'Name cleared', { bg: T.greenWarm, duration: 1500 });
        } else { showToast('Name update failed', { bg: T.verm }); }
      }).catch(function() { showToast('Name update failed', { bg: T.verm }); });
    },
    onCancel: function() {},
    checkLabel: currentCheckNumber || 'check',
    currentName: currentCustomerName || '',
  });
}

// ── Pizza builder data (populated by API or fallback) ──
var PIZZA_BUILDER_DATA = null;

// ── Menu data (loaded from API on scene entry) ──
var MENU_DATA = [];

var MOD_DATA = [];

// ── Per-item included-modifier lookup (from hidden "included_<item_id>" groups) ──
var INCLUDED_BY_ITEM = {};

// ── Overseer-authored modifier wiring (source of truth when present) ──
var MODIFIER_GROUPS = [];          // raw groups (non-hidden) keyed by group_id
var MODIFIER_MASTER = {};          // modifier_id → { name, price }
var ITEM_TO_CATEGORY = {};         // item_id → category_id

// ── Fetch menu from API and transform to HexNav format ──
// The legacy MandatoryAssignment / UniversalAssignment model was retired.
// Its behavior (min/max selections, owner_item_id, category_id) now lives
// on each ModifierGroup, and the per-item / per-category wiring is baked
// into `item.mandatory_group_ids` and `category.universal_group_ids` in
// the /menu response. Those two fields are what _refreshModPanel and
// buildKindModPanel actually consume (see line ~2453). The previous
// /config/*-assignments endpoints were removed from the backend; the
// frontend was still calling them and logging 404s on every menu load.
var _menuFetched = false;

function fetchMenuFromAPI() {
  return fetchWithTimeout(API + '/menu', {}, 15000)
    .then(function(r) { if (!r.ok) throw new Error(r.status); return r.json(); })
    .then(function(menu) {
    if (!menu.categories || !menu.items) return;

    // Build items_by_category keyed by category_id (lowercase)
    var itemsByCatId = {};
    ITEM_TO_CATEGORY = {};
    menu.categories.forEach(function(cat) { itemsByCatId[cat.category_id] = []; });
    menu.items.forEach(function(item) {
      // Match item.category (name like "Pizza") to category
      var cat = menu.categories.find(function(c) {
        return c.name === item.category || c.category_id === item.category || c.category_id === item.category_id;
      });
      if (cat) {
        if (!itemsByCatId[cat.category_id]) itemsByCatId[cat.category_id] = [];
        itemsByCatId[cat.category_id].push(item);
        var iid = item.item_id || item.id;
        if (iid) ITEM_TO_CATEGORY[iid] = cat.category_id;
      }
    });

    // Transform categories + items into HexNav MENU_DATA
    MENU_DATA = menu.categories.map(function(cat) {
      var catItems = (itemsByCatId[cat.category_id] || [])
        .sort(function(a, b) { return (a.display_order || 999) - (b.display_order || 999); })
        .map(function(item) {
          var hexItem = { label: item.name, price: item.price, id: item.item_id || item.id };
          if (item.pizza_size) hexItem.pizzaSize = true;
          if (item.mods) hexItem.requiredMods = item.mods;
          // Preserve new-model modifier wiring authored in Overseer.
          // mandatoryGroupIds → groups forced at order entry (pizza size, etc).
          // includedModifierIds → atoms pre-applied to the check on add.
          if (item.mandatory_group_ids && item.mandatory_group_ids.length > 0) {
            hexItem.mandatoryGroupIds = item.mandatory_group_ids.slice();
          }
          if (item.included_modifier_ids && item.included_modifier_ids.length > 0) {
            hexItem.includedModifierIds = item.included_modifier_ids.slice();
          }
          return hexItem;
        });
      // Prefer the user-set color from the Overseer; fall back to theme token
      var catColor = cat.color || cat.hex_color || T.catColor(cat.label || cat.name.toUpperCase()) || hexToRgba(T.text, 0.6);
      var textColor = _textColorForHex(catColor);
      return {
        id: cat.category_id,
        label: cat.label || cat.name.toUpperCase(),
        color: catColor,
        textColor: textColor,
        pizzaBuilder: cat.pizza_builder || false,
        enablePlacement: cat.enable_placement === true,
        // Universal groups attach at the category level — every item in this
        // category gets these as OPT-tab options at order entry.
        universalGroupIds: (cat.universal_group_ids || []).slice(),
        subcats: [{ id: cat.category_id + '-items', label: cat.name, items: catItems }],
      };
    });

    // Build per-item included-modifier lookup from hidden "included_<item_id>" groups.
    // Each entry is shape { id, label } — matches buildKindModPanel's includedItems contract.
    INCLUDED_BY_ITEM = {};
    MODIFIER_GROUPS = [];
    MODIFIER_MASTER = {};
    (menu.modifier_groups || []).forEach(function(g) {
      // Always index modifiers into MODIFIER_MASTER so later lookups
      // resolve atom names/prices even for atoms inside hidden groups.
      (g.modifiers || []).forEach(function(m) {
        if (m.modifier_id && !MODIFIER_MASTER[m.modifier_id]) {
          MODIFIER_MASTER[m.modifier_id] = { name: m.name, price: parseFloat(m.price) || 0 };
        }
      });
      if (g.hidden) {
        // Legacy hidden "included_<item_id>" groups — still honored for items
        // that haven't been migrated yet. menu-categories.js emits
        // modifier.group_deleted on first save to clean these up.
        if (g.owner_item_id) {
          var mods = (g.modifiers || []).map(function(m) { return { id: m.modifier_id, label: m.name }; });
          if (mods.length > 0) INCLUDED_BY_ITEM[g.owner_item_id] = mods;
        }
        return;
      }
      MODIFIER_GROUPS.push(g);
    });

    // New-model pass: walk items directly and build INCLUDED_BY_ITEM
    // from item.included_modifier_ids. This overrides any legacy hidden-group
    // entry with the authoritative Overseer-authored list.
    (menu.items || []).forEach(function(item) {
      var iid = item.item_id || item.id;
      var ids = item.included_modifier_ids || [];
      if (!iid || ids.length === 0) return;
      var mods = ids.map(function(mid) {
        var master = MODIFIER_MASTER[mid];
        return { id: mid, label: master ? master.name : mid };
      });
      INCLUDED_BY_ITEM[iid] = mods;
    });

    // Extract pizza builder modifier groups
    if (menu.modifier_groups) {
      var builderGroups = menu.modifier_groups
        .filter(function(g) { return g.builder; })
        .sort(function(a, b) { return (a.display_order || 999) - (b.display_order || 999); });

      if (builderGroups.length > 0) {
        PIZZA_BUILDER_DATA = builderGroups.map(function(g) {
          var subcats;
          if (g.subcats && g.subcats.length > 0) {
            // Group has explicit subcategories (e.g. Prep → Crust, Temp, Sauce, Cut)
            subcats = g.subcats.map(function(sc) {
              return {
                id: sc.id,
                label: sc.name,
                items: (sc.modifiers || []).map(function(m) {
                  return { label: m.name, id: m.modifier_id, price: m.price || 0 };
                }),
              };
            });
          } else {
            // Flat modifiers → single subcat
            subcats = [{ id: g.group_id + '-items', label: g.name, items:
              (g.modifiers || []).map(function(m) {
                return { label: m.name, id: m.modifier_id, price: m.price || 0 };
              }),
            }];
          }
          return {
            id: g.group_id,
            label: g.name.toUpperCase(),
            color: g.color || T.green,
            textColor: g.text_color || T.well,
            subcats: subcats,
          };
        });
      }
    }

    _menuFetched = true;
    // Refresh snake grid if already mounted
    if (_gridEl) renderSnakeGrid();
  }).catch(function(err) {
    console.warn('[KINDpos] Menu fetch failed, using fallback:', err);
  });
}

function _textColorForHex(hex) {
  // Simple luminance check to pick dark or light text
  var r = parseInt(hex.slice(1, 3), 16);
  var g = parseInt(hex.slice(3, 5), 16);
  var b = parseInt(hex.slice(5, 7), 16);
  var lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return lum > 0.5 ? T.well : T.text;
}

// ── Combo flow state ─────────────────────────────
var comboFlow    = null;  // { step: 'side'|'drink', ticketItem: ref }

// ── Scene state ───────────────────────────────────
var ticket       = [];    // [{ id, name, unitPrice, mods:[{name,price,charged}], selected, sent }]
var ticketSeq    = 0;     // monotonic ID counter
var sceneParams  = {};
var modHistory   = [];    // [{inst, mod}] — undo stack for modifier additions
var _bottomBar   = null;  // DOM ref for bottom action bar
var _mainArea    = null;  // DOM ref for right panel
var _activeSeats    = new Set();   // currently selected seat numbers
var _seatList       = [];          // seat numbers in the overview selection
var _allSeatList    = [];          // all seat numbers in the party
var _seatTab        = 'selected';  // 'selected' | 'unselected'
var _seatSelectorEl = null;        // DOM ref for the inline seat card
var _prevSeats       = new Set();   // snapshot of _activeSeats at last item add (for RECALL)
var _autoSwitchArmed = false;       // true after item add → next seat tap does exclusive replace

// ── Snake nav state ───────────────────────────────
var snakeState = {
  view:   'cats',  // 'personal'|'cats'|'subcats'|'items'
  crumbs: [],      // [{ id, label, color }]
  catId:  null,
  subId:  null,
};
var favorites    = [];   // item ids for personal tab
var _gridEl      = null; // inner grid DOM container
var _gridWrap    = null; // collapsible grid wrapper
var _snakeStrip  = null; // crumb-only strip shown when mod panel open
var _expandedItems = {}; // item id → true when mod rows are expanded
var _collapsedSeats = new Set(); // seat numbers collapsed in multi-seat s-card view (default: all expanded)

// ── Modifier Panel (slide-up) ─────────────────────
var _modPanel      = null;   // buildKindModPanel instance
var _modPanelItem  = null;   // ticket preview item for active panel
var _modPanelCatColor = null; // cat color of the item being modified — used by _appendModPreview
var _modPanelOpen  = false;  // drives grid collapse animation

// ── Inject invisible scrollbar style ──
(function() {
  if (document.getElementById('co-scroll-style')) return;
  var s = document.createElement('style');
  s.id = 'co-scroll-style';
  s.textContent = '.co-scroll::-webkit-scrollbar{display:none}';
  document.head.appendChild(s);
})();

(function() {
  if (document.getElementById('oe-seat-scroll-style')) return;
  var s = document.createElement('style');
  s.id = 'oe-seat-scroll-style';
  s.textContent = '._oe-seat-scroll::-webkit-scrollbar{display:none}';
  document.head.appendChild(s);
})();

// ── Batch Modifier Session ───────────────────────
var modifierSession = {
  active: false,
  selectedItems: [],
  activePrefix: null,
  activePlacement: null,
  appliedMods: [],
  panelEl: null,
  hasPizza: false,
};

// ── Prefix definitions ────────────────────────────
var PREFIXES = [
  { id: 'add',     label: 'ADD',     color: T.greenWarm, textColor: T.well },
  { id: 'extra',   label: 'EXTRA',   color: T.elec,      textColor: T.well },
  { id: 'no',      label: 'NO',      color: T.verm,      textColor: T.text },
  { id: 'on-side', label: 'ON SIDE', color: T.gold,      textColor: T.well },
  { id: 'lite',    label: 'LITE',    color: T.gold,      textColor: T.well },
];

defineScene({
  name: 'order-entry',

  state: {},

  render: function(container, params) {
    params = params || {};
    var staff = params.staff || params.emp || {};

    // 2. Body container — fills the entire screen
    var body = document.createElement('div');
    var offset = '0';
    body.style.cssText = 'position:absolute;left:' + offset + ';right:0;top:0;bottom:0;overflow:hidden;display:flex;flex-direction:column;';
    container.appendChild(body);

    ticket         = [];
    ticketSeq      = 0;
    sceneParams    = params;
    currentOrderId = null;
    isSending      = false;
    currentCheckNumber = null;
    currentCustomerName = null;
    createOrderIdemKey = null;
    modHistory     = [];
    modifierSession = { active: false, selectedItems: [], activePrefix: null, activePlacement: null, appliedMods: [], panelEl: null, hasPizza: false };
    _bottomBar     = null;
    _mainArea      = null;
    _modPanel      = null;
    _modPanelItem  = null;
    _modPanelCatColor = null;
    _modPanelOpen  = false;
    _gridEl        = null;
    _gridWrap      = null;
    _snakeStrip    = null;
    _expandedItems = {};
    _collapsedSeats = new Set();
    snakeState     = { view:'cats', crumbs:[], catId:null, subId:null };
    favorites      = [];
    _allSeatList = (params.seatNumbers && params.seatNumbers.length > 0)
      ? params.seatNumbers.slice()
      : [1];
    _seatList = (params.selectedSeatNumbers && params.selectedSeatNumbers.length > 0)
      ? params.selectedSeatNumbers.slice()
      : [_allSeatList[0]];
    _activeSeats    = new Set(_seatList);
    _prevSeats       = new Set();
    _autoSwitchArmed = false;
    _seatTab        = 'selected';
    _seatSelectorEl = null;

    container.style.cssText = 'position:absolute;inset:0;overflow:hidden;';

    // Show persistent order summary panel (left column)
    // Lock _renderItems so stale check-overview updates can't write into our ticket list.
    // totalsMode 'building' suppresses card/cash price rows — order-entry is for adding items,
    // payment math lives in check-overview. (Requires OrderSummary to honor the flag.)
    OrderSummary.show({
      title: 'ITEM RECAP',
      checkId: params.recallCheckNumber || '',
      customerName: '',
      items: [],
      subtotal: 0,
      tax: 0,
      cardTotal: 0,
      cashPrice: 0,
      totalsMode: 'building',
      onNameTap: _handleNameTap,
      showBack: true,
      onBack: handleClose
    });
    OrderSummary.lockItemRender();

    var mainArea = buildMain(body, params);
    body.appendChild(mainArea);

    if (!_menuFetched) fetchMenuFromAPI().catch(function() { console.error('[KINDpos] Menu fetch failed on mount'); });

    if (params.recallOrderId) {
      currentOrderId = params.recallOrderId;
      currentCheckNumber = params.recallCheckNumber || null;
      recallFromBackend(params.recallOrderId);
    }

    if (window._header && window._header.setBackHandler) {
      window._header.setBackHandler(handleClose);
    }
  },

  unmount: function() {
    // Fire-and-forget auto-save for unexpected unmounts (logout, force
    // scene swap). handleClose() already awaits, so when BACK is used
    // this is a no-op (everything is already flushed). The fetch body
    // is built synchronously so the in-flight request survives the
    // scene teardown.
    try {
      var hasUnsent = ticket.some(function(inst) { return !inst.sent; });
      if (hasUnsent && !isSending) handleSaveOnly();
    } catch (_) { /* best-effort only */ }

    if (window._header && window._header.setBackHandler) {
      window._header.setBackHandler(null);
    }
    OrderSummary.unlockItemRender();
    OrderSummary.hide();
    if (_modPanel) { _modPanel.destroy(); _modPanel = null; }
    _modPanelItem  = null;
    _modPanelCatColor = null;
    _modPanelOpen  = false;
    ticket         = [];
    ticketSeq      = 0;
    modHistory     = [];
    modifierSession = { active: false, selectedItems: [], activePrefix: null, activePlacement: null, appliedMods: [], panelEl: null, hasPizza: false };
    comboFlow      = null;
    currentOrderId = null;
    isSending      = false;
    currentCheckNumber = null;
    currentCustomerName = null;
    createOrderIdemKey = null;
    _bottomBar     = null;
    _mainArea      = null;
    _gridEl        = null;
    _gridWrap      = null;
    _snakeStrip    = null;
    _expandedItems = {};
    _collapsedSeats = new Set();
    snakeState     = { view:'cats', crumbs:[], catId:null, subId:null };
    favorites      = [];
    _activeSeats    = new Set();
    _seatList       = [];
    _allSeatList    = [];
    _seatTab        = 'selected';
    _seatSelectorEl = null;
    _prevSeats       = new Set();
    _autoSwitchArmed = false;
    _menuFetched   = false;
  },

  interrupts: {
    'qty-edit': {
      render: function(container, params) {
        var inner      = (params && params.params) || {};
        var itemName   = inner.itemName || '';
        var startQty   = Math.max(1, parseInt(inner.currentQty, 10) || 1);
        var qty        = startQty;

        container.style.cssText = 'width:100%;height:100%;display:flex;align-items:center;justify-content:center;';

        var shell = buildStaticCard({ accent: T.groups.composite.shellAccent });
        shell.style.display       = 'flex';
        shell.style.flexDirection = 'column';
        shell.style.gap           = '14px';
        shell.style.minWidth      = '420px';
        shell.style.maxWidth      = '520px';
        shell.style.padding       = '20px 28px 28px 32px';
        var panel = shell;

        var title = document.createElement('div');
        title.style.cssText = [
          'font-family:' + T.fh + ';',
          'font-size:' + T.fsB2 + ';',
          'font-weight:' + T.fwBold + ';',
          'color:' + T.green + ';',
          'letter-spacing:0.2em;',
          'text-transform:uppercase;',
          'text-align:center;',
        ].join('');
        title.textContent = 'EDIT QUANTITY';
        panel.appendChild(title);

        if (itemName) {
          var subtitle = document.createElement('div');
          subtitle.style.cssText = [
            'font-family:' + T.fb + ';font-size:' + T.fsB3 + ';',
            'color:' + T.text + ';text-align:center;',
            'white-space:nowrap;overflow:hidden;text-overflow:ellipsis;',
          ].join('');
          subtitle.textContent = itemName;
          panel.appendChild(subtitle);
        }

        // Stepper row: [ − ]  ( qty )  [ + ]
        var stepper = document.createElement('div');
        stepper.style.cssText = 'display:flex;align-items:center;justify-content:center;gap:16px;margin:6px 0 4px;';

        // Stepper −/+: neutral elec cyan so they don't blend with the
        // card bg and don't claim primary-action color.
        var minusBtn = buildPillButton({
          label: '−',
          variant: T.groups.composite.stepper,
          fontSize: T.fsB1,
        });
        minusBtn.style.width  = '64px';
        minusBtn.style.height = '56px';
        minusBtn.style.borderRadius = '14px';
        minusBtn.style.flexShrink = '0';

        var qtyReadout = document.createElement('div');
        qtyReadout.style.cssText = [
          'min-width:80px;text-align:center;',
          'font-family:' + T.fb + ';font-size:' + T.fsB1 + ';',
          'font-weight:' + T.fwBold + ';color:' + T.gold + ';',
          'pointer-events:none;',
        ].join('');

        var plusBtn = buildPillButton({
          label: '+',
          variant: T.groups.composite.stepper,
          fontSize: T.fsB1,
        });
        plusBtn.style.width  = '64px';
        plusBtn.style.height = '56px';
        plusBtn.style.borderRadius = '14px';
        plusBtn.style.flexShrink = '0';

        stepper.appendChild(minusBtn);
        stepper.appendChild(qtyReadout);
        stepper.appendChild(plusBtn);
        panel.appendChild(stepper);

        // Button hierarchy: CANCEL (verm destructive) + CONFIRM (mint
        // primary). Matching 14px radius + flex-centered text so the
        // pair reads as one family with the check-overview action bar.
        var bottomBar = document.createElement('div');
        bottomBar.style.cssText = 'display:flex;gap:10px;margin-top:8px;';

        var cancelBtn = buildPillButton({
          label: 'CANCEL',
          variant: T.groups.composite.cancel,
          fontSize: T.fsB2,
          onClick: function() { params.onCancel(); },
        });
        cancelBtn.style.flex = '1';
        cancelBtn.style.height = '48px';
        cancelBtn.style.borderRadius = '14px';
        cancelBtn.style.display = 'flex';
        cancelBtn.style.alignItems = 'center';
        cancelBtn.style.justifyContent = 'center';

        var confirmBtn = buildPillButton({
          label: 'CONFIRM',
          variant: T.groups.composite.confirm,
          fontSize: T.fsB2,
          onClick: function() {
            if (qty === startQty) return;
            params.onConfirm(qty);
          },
        });
        confirmBtn.style.flex = '1';
        confirmBtn.style.height = '48px';
        confirmBtn.style.borderRadius = '14px';
        confirmBtn.style.display = 'flex';
        confirmBtn.style.alignItems = 'center';
        confirmBtn.style.justifyContent = 'center';

        bottomBar.appendChild(cancelBtn);
        bottomBar.appendChild(confirmBtn);
        panel.appendChild(bottomBar);
        container.appendChild(shell);

        function paint() {
          qtyReadout.textContent = String(qty);
          minusBtn.style.opacity = qty > 1 ? '1' : '0.35';
          var dirty = qty !== startQty;
          confirmBtn.style.color       = dirty ? T.green   : hexToRgba(T.text, 0.45);
          confirmBtn.style.borderColor = dirty ? T.green   : T.card;
        }

        minusBtn.addEventListener('pointerup', function(e) {
          e.stopPropagation();
          if (qty > 1) { qty -= 1; paint(); }
        });
        plusBtn.addEventListener('pointerup', function(e) {
          e.stopPropagation();
          qty += 1;
          paint();
        });

        container.addEventListener('pointerup', function(e) {
          if (e.target === container) { params.onCancel(); }
        });

        paint();
      },
      unmount: function() {},
    },
    'oe-name-input': {
      render: function(container, params) {
        showKeyboard({
          placeholder: 'Enter name',
          initialValue: params.currentName || '',
          maxLength: 40,
          onDone: function(val) {
            params.onConfirm(val.trim());
          },
          onDismiss: function() {
            params.onCancel();
          },
          dismissOnDone: true,
        });
      },
      unmount: function() { hideKeyboard(); },
    },

    'oe-open-item': {
      render: function(container, params) {
        container.style.cssText = 'width:100%;height:100%;display:flex;align-items:center;justify-content:center;';
        container.addEventListener('pointerup', function(e) {
          if (e.target === container) params.onCancel();
        });

        var shell = buildStaticCard({ accent: T.gold });
        Object.assign(shell.style, {
          display: 'flex', flexDirection: 'column', gap: '14px',
          minWidth: '340px', maxWidth: '420px',
          padding: '20px 24px 24px',
        });

        var title = document.createElement('div');
        title.style.cssText = 'font-family:' + T.fh + ';font-size:' + T.fsB2 + ';font-weight:' + T.fwBold + ';color:' + T.gold + ';letter-spacing:0.2em;text-transform:uppercase;text-align:center;';
        title.textContent = 'OPEN ITEM';
        shell.appendChild(title);

        // ── Name ──
        var nameInput = document.createElement('input');
        Object.assign(nameInput.style, {
          width: '100%', boxSizing: 'border-box',
          background: hexToRgba(T.text, 0.06), border: '1px solid ' + hexToRgba(T.text, 0.18),
          borderRadius: '10px', color: T.text,
          fontFamily: T.fb, fontSize: T.fsB3,
          padding: '10px 12px', outline: 'none',
        });
        nameInput.placeholder = 'Item name (required)';
        nameInput.maxLength = 50;
        shell.appendChild(nameInput);

        // ── Category ──
        var catSelect = document.createElement('select');
        Object.assign(catSelect.style, {
          width: '100%', boxSizing: 'border-box',
          background: hexToRgba(T.text, 0.06), border: '1px solid ' + hexToRgba(T.text, 0.18),
          borderRadius: '10px', color: T.text,
          fontFamily: T.fb, fontSize: T.fsB3,
          padding: '10px 12px', outline: 'none',
          appearance: 'none',
        });
        var catPlaceholder = document.createElement('option');
        catPlaceholder.value = '';
        catPlaceholder.textContent = 'Select category…';
        catPlaceholder.disabled = true;
        catPlaceholder.selected = true;
        catSelect.appendChild(catPlaceholder);
        MENU_DATA.forEach(function(cat) {
          var opt = document.createElement('option');
          opt.value = cat.id;
          opt.textContent = cat.label || cat.id;
          catSelect.appendChild(opt);
        });
        shell.appendChild(catSelect);

        // ── Price display ──
        var _cents = 0;
        var priceDisplay = document.createElement('div');
        Object.assign(priceDisplay.style, {
          textAlign: 'center', fontFamily: T.fb,
          fontSize: '2rem', fontWeight: T.fwBold, color: T.gold,
          letterSpacing: '0.05em',
        });
        function _refreshPrice() { priceDisplay.textContent = '$' + (_cents / 100).toFixed(2); }
        _refreshPrice();
        shell.appendChild(priceDisplay);

        // ── Digit pad ──
        var pad = document.createElement('div');
        pad.style.cssText = 'display:grid;grid-template-columns:repeat(3,1fr);gap:8px;';
        [7,8,9,4,5,6,1,2,3,'⌫',0,'✓'].forEach(function(key) {
          var btn = document.createElement('button');
          Object.assign(btn.style, {
            padding: '14px 0', borderRadius: '10px', border: 'none',
            background: (key === '✓') ? T.greenWarm : hexToRgba(T.text, 0.08),
            color: (key === '✓') ? T.moonText : T.text,
            fontFamily: T.fb, fontSize: T.fsB2, fontWeight: T.fwBold,
            cursor: 'pointer',
          });
          btn.textContent = String(key);
          btn.addEventListener('pointerup', function(e) {
            e.stopPropagation();
            if (key === '⌫') {
              _cents = Math.floor(_cents / 10);
            } else if (key === '✓') {
              _commit();
              return;
            } else {
              if (_cents < 9999999) _cents = _cents * 10 + Number(key);
            }
            _refreshPrice();
          });
          pad.appendChild(btn);
        });
        shell.appendChild(pad);

        // ── Buttons ──
        var btnRow = document.createElement('div');
        btnRow.style.cssText = 'display:flex;gap:10px;margin-top:4px;';
        var cancelBtn = buildPillButton({ label: 'CANCEL', variant: T.groups.composite.cancel, fontSize: T.fsB2, onClick: function() { params.onCancel(); } });
        cancelBtn.style.flex = '1'; cancelBtn.style.height = '48px';
        var addBtn = buildPillButton({ label: 'ADD ITEM', variant: T.groups.composite.confirm, fontSize: T.fsB2, onClick: _commit });
        addBtn.style.flex = '1'; addBtn.style.height = '48px';
        btnRow.appendChild(cancelBtn);
        btnRow.appendChild(addBtn);
        shell.appendChild(btnRow);

        container.appendChild(shell);
        nameInput.focus();

        function _commit() {
          var name = nameInput.value.trim();
          if (!name) { nameInput.style.borderColor = T.verm; return; }
          if (!catSelect.value) { catSelect.style.borderColor = T.verm; return; }
          params.onConfirm({ label: name, price: _cents / 100, categoryId: catSelect.value });
        }
      },
      unmount: function() {},
    },
  },

  // Test seam — exposes internal state and functions for unit tests.
  // Only referenced in *.test.js; never called by production code.
  __handlers: {
    get ticket()                { return ticket; },
    set ticket(v)               { ticket = v; },
    get currentOrderId()        { return currentOrderId; },
    set currentOrderId(v)       { currentOrderId = v; },
    get createOrderIdemKey()    { return createOrderIdemKey; },
    set createOrderIdemKey(v)   { createOrderIdemKey = v; },
    get isSending()             { return isSending; },
    handleSend:                 function() { return handleSend(); },
    handleSaveOnly:             function() { return handleSaveOnly(); },
    recallFromBackend:          function(id) { return recallFromBackend(id); },
    get modifierSession()       { return modifierSession; },
    set modifierSession(v)      { modifierSession = v; },
    applyModifier:              function(mod) { return applyModifier(mod); },
  },
});

// ── TOTALS HELPER ─────────────────────────────────
function _fmtPrice(n) {
  var v = Number(n);
  if (!isFinite(v)) v = 0;
  return '$' + v.toFixed(2);
}

// Pre-send display totals only — items in `ticket` have not reached the server
// yet, so there is no authoritative server total to trust. These values are
// shown as a live preview and are superseded by server-confirmed totals once
// the order is saved/sent.
function computeTicketTotals() {
  var subtotal = 0;
  var counts = {};
  var summaryItems = [];  // item summary for ORDER RECAP
  ticket.forEach(function(inst) {
    var modTotal = inst.mods.reduce(function(s, m) { return s + Number(m.price || 0); }, 0);
    var lineTotal = Number(inst.unitPrice || 0) + modTotal;
    counts[inst.name] = counts[inst.name] || { unitPrice: inst.unitPrice, qty: 0 };
    counts[inst.name].qty += 1;
    subtotal += lineTotal;
    summaryItems.push({
      name: inst.name,
      unitPrice: lineTotal,
      qty: 1,
      sent: inst.sent,
      mods: inst.mods.filter(function(m) { return m.charged || m.name; }),
    });
  });
  var t = computeTotals(subtotal);
  return { counts: counts, summaryItems: summaryItems, subtotal: t.subtotal, tax: t.tax, cardTotal: t.cardTotal, cashPrice: t.cashPrice };
}


// ── FAVORITES API ─────────────────────────────────
function loadFavorites() {
  var empId = sceneParams.employeeId;
  if (!empId) return;
  fetchWithTimeout(API + '/favorites?employee_id=' + empId, {}, 10000)
    .then(function(r) { return r.ok ? r.json() : { item_ids: [] }; })
    .then(function(data) {
      favorites = data.item_ids || [];
      if (snakeState.view === 'personal') renderSnakeGrid();
    })
    .catch(function() { favorites = []; });
}

function saveFavorites() {
  var empId = sceneParams.employeeId;
  if (!empId) return;
  fetchWithTimeout(API + '/favorites', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ employee_id: empId, item_ids: favorites }),
  }, 10000).catch(function() {});
}

function toggleFavorite(itemId) {
  var idx = favorites.indexOf(itemId);
  if (idx >= 0) {
    favorites.splice(idx, 1);
    showToast('Removed from Personal', { bg: T.card, duration: 1200 });
  } else {
    favorites.push(itemId);
    showToast('★ Added to Personal', { bg: T.gold, duration: 1200 });
  }
  saveFavorites();
  renderSnakeGrid();
}

// ── SNAKE NAV TILE BUILDERS ────────────────────────

function _tileStyle(color, filled, extraCss) {
  var bg = filled ? color : T.card;
  var darkBg = darkenHex(bg, 0.2);
  return [
    'display:flex;flex-direction:column;justify-content:center;align-items:center;',
    'min-height:120px;padding:12px 10px;box-sizing:border-box;',
    'border-radius:' + T.chamferCard + 'px;cursor:pointer;user-select:none;',
    'pointer-events:auto;touch-action:manipulation;',
    'border-left:' + T.accentBarW + ' solid ' + color + ';',
    'background:' + bg + ';',
    'box-shadow:0 6px 0 ' + darkBg + ';',
    'transition:transform 80ms,box-shadow 80ms;',
    extraCss || '',
  ].join('');
}

function _applyPress(el, color, filled) {
  var bg = filled ? color : T.card;
  var darkBg = darkenHex(bg, 0.2);
  el.addEventListener('pointerdown', function() {
    el.style.transform = 'translateY(1px)';
    el.style.boxShadow = 'none';
  });
  el.addEventListener('pointerup', function() {
    el.style.transform = '';
    el.style.boxShadow = '0 6px 0 ' + darkBg;
  });
  el.addEventListener('pointerleave', function() {
    el.style.transform = '';
    el.style.boxShadow = '0 6px 0 ' + darkBg;
  });
}

function buildCrumbTile(crumb, isLast) {
  var el = document.createElement('div');
  el.style.cssText = _tileStyle(crumb.color, true);
  el.style.position = 'relative';

  if (!isLast) {
    var back = document.createElement('div');
    back.style.cssText = 'position:absolute;top:6px;right:8px;font-size:10px;color:rgba(0,0,0,0.4);font-family:' + T.fb + ';pointer-events:none;';
    back.textContent = '◂';
    el.appendChild(back);
  }

  var lbl = document.createElement('span');
  lbl.style.cssText = 'font-family:' + T.fh + ';font-weight:700;font-size:' + T.fsB1 + ';color:' + (isLast ? T.well : hexToRgba(T.text, 0.75)) + ';letter-spacing:1px;text-align:center;pointer-events:none;';
  lbl.textContent = crumb.label;
  el.appendChild(lbl);

  _applyPress(el, crumb.color, true);
  return el;
}

function buildCatTile(cat) {
  var el = document.createElement('div');
  el.style.cssText = _tileStyle(cat.color, false);

  var lbl = document.createElement('span');
  lbl.style.cssText = 'font-family:' + T.fh + ';font-weight:700;font-size:' + T.fsB1 + ';color:' + cat.color + ';letter-spacing:1.5px;text-align:center;pointer-events:none;';
  lbl.textContent = cat.label;
  el.appendChild(lbl);

  _applyPress(el, cat.color, false);
  return el;
}

function buildSubcatTile(sub, color) {
  var el = document.createElement('div');
  el.style.cssText = _tileStyle(color, false, 'opacity:0.9;');

  var lbl = document.createElement('span');
  lbl.style.cssText = 'font-family:' + T.fh + ';font-weight:700;font-size:' + T.fsB1 + ';color:' + color + ';letter-spacing:1px;text-align:center;pointer-events:none;';
  lbl.textContent = sub.label;
  el.appendChild(lbl);

  _applyPress(el, color, false);
  return el;
}

function buildItemTile(item, catColor, isFav) {
  var el = document.createElement('div');
  el.style.cssText = _tileStyle(catColor, false, 'justify-content:space-between;align-items:flex-start;position:relative;');

  if (isFav) {
    var star = document.createElement('div');
    star.style.cssText = 'position:absolute;top:7px;right:8px;color:' + T.gold + ';font-size:14px;pointer-events:none;';
    star.textContent = '★';
    el.appendChild(star);
  }

  var name = document.createElement('span');
  name.style.cssText = 'font-family:' + T.fh + ';font-weight:700;font-size:14px;color:' + T.text + ';letter-spacing:0.3px;line-height:1.3;padding-right:' + (isFav ? '18px' : '0') + ';pointer-events:none;';
  name.textContent = item.label;
  el.appendChild(name);

  var price = document.createElement('span');
  price.style.cssText = 'font-family:' + T.fb + ';font-size:15px;color:' + T.gold + ';font-weight:700;margin-top:6px;pointer-events:none;';
  price.textContent = '$' + (typeof item.price === 'number' ? item.price.toFixed(2) : item.price);
  el.appendChild(price);

  _applyPress(el, catColor, false);
  return el;
}

// ── SNAKE NAV GRID RENDERER ────────────────────────

function renderSnakeGrid() {
  if (!_gridEl) return;
  _gridEl.innerHTML = '';
  var frag = document.createDocumentFragment();

  var view   = snakeState.view;
  var crumbs = snakeState.crumbs;
  var catId  = snakeState.catId;
  var subId  = snakeState.subId;

  // ── PERSONAL TAB ──
  if (view === 'personal') {
    var pCrumb = { id: 'personal', label: 'PERSONAL', color: T.green };
    var pTile = buildCrumbTile(pCrumb, true);
    pTile.addEventListener('pointerup', function() {
      snakeState.view   = 'cats';
      snakeState.crumbs = [];
      snakeState.catId  = null;
      snakeState.subId  = null;
      renderSnakeGrid();
    });
    _gridEl.appendChild(pTile);
    _renderPersonalGrid();
    return;
  }

  // ── Crumb tiles (inline, same grid) ──
  if (view !== 'cats') {
    crumbs.forEach(function(crumb, i) {
      var tile = buildCrumbTile(crumb, i === crumbs.length - 1);
      tile.addEventListener('pointerup', function() { _crumbTap(i); });
      _gridEl.appendChild(tile);
    });
  }

  // ── Category home ──
  if (view === 'cats') {
    // Inject PERSONAL as first tile
    var personalCat = { id: 'personal', label: 'PERSONAL', color: T.green };
    var pTile = buildCatTile(personalCat);
    pTile.addEventListener('pointerup', function() {
      snakeState.view = 'personal';
      snakeState.crumbs = [];
      snakeState.catId = null;
      snakeState.subId = null;
      renderSnakeGrid();
    });
    _gridEl.appendChild(pTile);

    MENU_DATA.forEach(function(cat) {
      var tile = buildCatTile(cat);
      tile.addEventListener('pointerup', function() { _selectCat(cat); });
      _gridEl.appendChild(tile);
    });
    return;
  }

  // ── Subcategory ──
  var menuCat = MENU_DATA.find(function(c) { return c.id === catId; });
  if (!menuCat) return;
  var subcats = menuCat.subcats;

  if (view === 'subcats' && subcats && subcats.length > 1) {
    subcats.forEach(function(sub) {
      var tile = buildSubcatTile(sub, menuCat.color);
      tile.addEventListener('pointerup', function() { _selectSubcat(sub, menuCat); });
      _gridEl.appendChild(tile);
    });
    return;
  }

  // ── Items ──
  var itemList = [];
  if (subId) {
    var sub = (subcats || []).find(function(s) { return s.id === subId; });
    if (sub) itemList = sub.items || [];
  } else {
    (subcats || []).forEach(function(s) { itemList = itemList.concat(s.items || []); });
  }

  itemList.forEach(function(item) {
    var isFav = favorites.indexOf(item.id) >= 0;
    var tile = buildItemTile(item, menuCat.color, isFav);
    _bindItemTile(tile, item, menuCat);
    frag.appendChild(tile);
  });
  _gridEl.appendChild(frag);
}

function _bindItemTile(tile, item, menuCat) {
  var longPressTimer = null;
  var didLong = false;
  var _tapping = false;

  tile.addEventListener('pointerdown', function() {
    didLong = false;
    longPressTimer = setTimeout(function() {
      didLong = true;
      if (item.id) toggleFavorite(item.id);
    }, 600);
  });

  tile.addEventListener('pointerup', function() {
    clearTimeout(longPressTimer);
    if (!didLong && !_tapping) {
      _tapping = true;
      handleItemSelect(item);
      requestAnimationFrame(function() { _tapping = false; });
    }
  });

  tile.addEventListener('pointerleave', function() {
    clearTimeout(longPressTimer);
  });

  tile.addEventListener('pointercancel', function() {
    clearTimeout(longPressTimer);
  });
}

function _renderPersonalGrid() {
  // Open Item tile — always present at the top of Personal
  var openTile = document.createElement('div');
  openTile.style.cssText = _tileStyle(T.gold, false, 'justify-content:space-between;align-items:flex-start;');
  var openLabel = document.createElement('span');
  openLabel.style.cssText = 'font-family:' + T.fh + ';font-weight:700;font-size:14px;color:' + T.text + ';letter-spacing:0.3px;pointer-events:none;';
  openLabel.textContent = 'Open Item';
  var openIcon = document.createElement('span');
  openIcon.style.cssText = 'font-family:' + T.fb + ';font-size:18px;color:' + T.gold + ';font-weight:700;margin-top:4px;pointer-events:none;';
  openIcon.textContent = '+';
  openTile.appendChild(openLabel);
  openTile.appendChild(openIcon);
  _applyPress(openTile, T.gold, false);
  openTile.addEventListener('pointerup', function() {
    SceneManager.interrupt('oe-open-item', {
      onConfirm: function(result) {
        var menuCat = MENU_DATA.find(function(c) { return c.id === result.categoryId; });
        addToTicket({
          label: result.label,
          price: result.price,
          id:    null,
          selectedMods: [],
        });
        // Override category on the ticket item just added (last in array)
        if (ticket.length > 0) ticket[ticket.length - 1].category = result.categoryId;
        SceneManager.closeInterrupt('oe-open-item');
      },
      onCancel: function() {
        SceneManager.closeInterrupt('oe-open-item');
      },
    });
  });
  _gridEl.appendChild(openTile);

  if (favorites.length === 0) {
    var empty = document.createElement('div');
    empty.style.cssText = [
      'grid-column:1/-1;display:flex;flex-direction:column;',
      'align-items:center;justify-content:center;height:200px;gap:10px;',
      'font-family:' + T.fh + ';font-size:13px;color:' + hexToRgba(T.text, 0.6) + ';text-align:center;',
    ].join('');
    empty.innerHTML = '<div style="font-size:35px;color:' + T.gold + ';opacity:0.5;pointer-events:none;">★</div><span style="pointer-events:none;">Hold any item to add it here</span>';
    _gridEl.appendChild(empty);
    return;
  }

  // Group by category, preserving MENU_DATA order
  MENU_DATA.forEach(function(cat) {
    var catItems = [];
    favorites.forEach(function(favId) {
      (cat.subcats || []).forEach(function(sub) {
        (sub.items || []).forEach(function(item) {
          if (item.id === favId) catItems.push(item);
        });
      });
    });
    if (catItems.length === 0) return;

    // Category header spanning full grid
    var hdr = document.createElement('div');
    hdr.style.cssText = [
      'grid-column:1/-1;display:flex;align-items:center;gap:8px;',
      'margin-top:4px;margin-bottom:2px;',
    ].join('');
    var hdrLabel = document.createElement('span');
    hdrLabel.style.cssText = 'font-family:' + T.fh + ';font-weight:700;font-size:10px;color:' + cat.color + ';letter-spacing:2px;pointer-events:none;';
    hdrLabel.textContent = cat.label;
    var hdrLine = document.createElement('div');
    hdrLine.style.cssText = 'height:1px;flex:1;background:linear-gradient(to right,' + cat.color + '44,transparent);pointer-events:none;';
    hdr.appendChild(hdrLabel);
    hdr.appendChild(hdrLine);
    _gridEl.appendChild(hdr);

    catItems.forEach(function(item) {
      var tile = buildItemTile(item, cat.color, true);
      _bindItemTile(tile, item, cat);
      _gridEl.appendChild(tile);
    });
  });
}

// ── SNAKE NAV ACTIONS ──────────────────────────────

function _selectCat(cat) {
  var hasSubs = cat.subcats && cat.subcats.length > 1;
  snakeState.crumbs = [{ id: cat.id, label: cat.label, color: cat.color }];
  snakeState.catId  = cat.id;
  snakeState.subId  = null;
  snakeState.view   = hasSubs ? 'subcats' : 'items';
  renderSnakeGrid();
}

function _selectSubcat(sub, menuCat) {
  snakeState.crumbs.push({ id: sub.id, label: sub.label, color: menuCat.color });
  snakeState.subId = sub.id;
  snakeState.view  = 'items';
  renderSnakeGrid();
}

function _crumbTap(idx) {
  if (idx === 0 && snakeState.crumbs.length === 1) {
    // Back to category home
    snakeState.view   = 'cats';
    snakeState.crumbs = [];
    snakeState.catId  = null;
    snakeState.subId  = null;
  } else if (idx === 0) {
    // Back to subcats
    snakeState.crumbs = snakeState.crumbs.slice(0, 1);
    snakeState.subId  = null;
    snakeState.view   = 'subcats';
  }
  renderSnakeGrid();
}

// ── MAIN AREA ─────────────────────────────────────
function buildMain(parentEl, params) {
  var main = document.createElement('div');
  main.style.cssText = 'flex:1;display:flex;flex-direction:column;min-height:0;';
  _mainArea = main;

  // ── Collapsible grid wrapper ──────────────────────
  var gridWrap = document.createElement('div');
  gridWrap.style.cssText = 'flex:1;min-height:0;overflow-y:auto;';
  _gridWrap = gridWrap;

  var grid = document.createElement('div');
  grid.style.cssText = [
    'display:grid;',
    'grid-template-columns:repeat(auto-fill,minmax(140px,1fr));',
    'gap:6px;padding:10px;',
  ].join('');
  _gridEl = grid;
  gridWrap.appendChild(grid);
  main.appendChild(gridWrap);

  // ── Snake strip (crumbs only, shown when mod panel open) ──
  var snakeStrip = document.createElement('div');
  snakeStrip.style.cssText = [
    'display:none;flex-wrap:wrap;gap:6px;align-items:center;',
    'padding:8px 10px;border-bottom:1px solid rgba(255,255,255,0.06);',
    'flex-shrink:0;position:relative;z-index:10;',
  ].join('');
  _snakeStrip = snakeStrip;
  main.appendChild(snakeStrip);

  // Note: buildKindModPanel mounts directly onto _mainArea as an absolute overlay
  // (position:relative is set on main to contain it)

  // ── Seat selector card (above bottom bar) ─────────
  if (_seatList.length > 0) {
    _seatSelectorEl = buildSeatSelectorCard();
    main.appendChild(_seatSelectorEl);
  }

  // ── Bottom action bar ─────────────────────────────
  _bottomBar = document.createElement('div');
  _bottomBar.style.cssText = 'display:grid;grid-template-columns:repeat(5,1fr);grid-auto-rows:auto;gap:4px;flex-shrink:0;margin-top:auto;';
  main.appendChild(_bottomBar);

  // Load menu data + favorites, then render grid
  requestAnimationFrame(function() {
    if (!_menuFetched) {
      fetchMenuFromAPI().then(function() { renderSnakeGrid(); }).catch(function() { console.error('[KINDpos] Menu fetch failed'); renderSnakeGrid(); });
    } else {
      renderSnakeGrid();
    }
    loadFavorites();
  });

  return main;
}

// ── SEAT SELECTOR CARD ────────────────────────────
// 8-col scrollable grid of every seat on the check. Active seats (in
// _activeSeats) render as filled green pills; inactive as outlined green.
// "+" tile at the end adds a new seat and selects it. ALL/NONE pills in
// the header bulk-toggle the entire grid. No SELECTED/UNSELECTED tabs,
// no RECALL — those belonged to the old check-isolated mental model.
function buildSeatSelectorCard() {
  var bevelLt = lightenHex(T.bg, 0.08);

  // Wrapper card: bevel-chromed well, no accent bar (the seat tiles carry
  // the color signal themselves).
  var card = document.createElement('div');
  card.style.cssText = [
    'flex-shrink:0;',
    'margin:0 ' + PAD + 'px ' + GAP + 'px;',
    'background:' + T.well + ';',
    'border:1px solid ' + bevelLt + ';',
    'border-radius:10px;',
    'display:flex;flex-direction:column;',
    'overflow:hidden;',
  ].join('');

  // ── Header: SEATS label + ALL/NONE pills ──────────
  var header = document.createElement('div');
  header.style.cssText = [
    'display:flex;align-items:center;gap:8px;',
    'padding:8px 12px 6px;',
  ].join('');

  var lbl = document.createElement('span');
  lbl.style.cssText = [
    'font-family:' + T.fb + ';',
    'font-size:' + T.fsB4 + ';',
    'font-weight:' + T.fwBold + ';',
    'color:' + T.green + ';',
    'letter-spacing:0.15em;',
    'flex:1;',
  ].join('');
  lbl.textContent = 'SEATS';
  header.appendChild(lbl);

  // Outlined-pill builder for ALL/NONE — small, transparent fill, colored border + text.
  function _buildBulkPill(label, color) {
    var el = document.createElement('div');
    el.style.cssText = [
      'padding:3px 12px;',
      'border:1.5px solid ' + color + ';',
      'border-radius:6px;',
      'background:transparent;',
      'color:' + color + ';',
      'font-family:' + T.fh + ';font-size:' + T.fsB4 + ';font-weight:' + T.fwBold + ';',
      'letter-spacing:0.15em;',
      'cursor:pointer;user-select:none;',
      'pointer-events:auto;touch-action:manipulation;',
      'transition:opacity 0.1s;',
    ].join('');
    el.textContent = label;
    el.addEventListener('pointerdown', function() { el.style.opacity = '0.6'; });
    var _rel = function() { el.style.opacity = '1'; };
    el.addEventListener('pointerup', _rel);
    el.addEventListener('pointerleave', _rel);
    el.addEventListener('pointercancel', _rel);
    return el;
  }

  var allBtn  = _buildBulkPill('ALL',  T.green);
  var noneBtn = _buildBulkPill('NONE', T.moon);
  header.appendChild(allBtn);
  header.appendChild(noneBtn);
  card.appendChild(header);

  // ── Body: 8-col scrollable grid ───────────────────
  // grid-auto-rows fixes row height at 40px; max-height shows ~3 rows; scrolls beyond.
  var body = document.createElement('div');
  body.className = '_oe-seat-scroll';
  body.style.cssText = [
    'display:grid;grid-template-columns:repeat(8,1fr);',
    'grid-auto-rows:40px;gap:4px;',
    'padding:6px 8px 8px;',
    'max-height:140px;overflow-y:auto;',
    '-webkit-overflow-scrolling:touch;overscroll-behavior:contain;touch-action:pan-y;',
  ].join('');
  card.appendChild(body);

  function _buildSeatPill(sn, isActive) {
    var pill = document.createElement('div');
    pill.style.cssText = [
      'display:flex;align-items:center;justify-content:center;',
      'border-radius:8px;',
      'font-family:' + T.fh + ';font-weight:' + T.fwBold + ';',
      'font-size:' + T.fsB2 + ';',
      'cursor:pointer;user-select:none;',
      'pointer-events:auto;touch-action:manipulation;',
      'transition:transform 0.07s;',
      isActive
        ? 'background:' + T.green + ';color:' + T.well + ';box-shadow:0 2px 0 ' + T.greenDk + ';'
        : 'background:transparent;color:' + T.green + ';border:1.5px solid ' + T.green + ';',
    ].join('');
    pill.textContent = 'S' + sn;
    pill.addEventListener('pointerdown', function() { pill.style.transform = 'translateY(1px)'; });
    var _rel = function() { pill.style.transform = ''; };
    pill.addEventListener('pointerup',     _rel);
    pill.addEventListener('pointerleave',  _rel);
    pill.addEventListener('pointercancel', _rel);
    return pill;
  }

  function _buildAddTile() {
    var tile = document.createElement('div');
    tile.style.cssText = [
      'display:flex;align-items:center;justify-content:center;',
      'border-radius:8px;',
      'background:transparent;',
      'border:1.5px dashed ' + T.moon + ';',
      'color:' + T.moon + ';',
      'font-family:' + T.fh + ';font-weight:400;font-size:24px;',
      'cursor:pointer;user-select:none;',
      'pointer-events:auto;touch-action:manipulation;',
    ].join('');
    tile.textContent = '+';
    return tile;
  }

  function repaintSeats() {
    body.innerHTML = '';
    _allSeatList.forEach(function(sn) {
      var isActive = _activeSeats.has(sn);
      var pill = _buildSeatPill(sn, isActive);
      pill.addEventListener('pointerup', (function(seatNum) {
        return function() {
          // Auto-switch: after items just added, first tap on a different
          // seat replaces the active set rather than toggling.
          if (_autoSwitchArmed) {
            _autoSwitchArmed = false;
            _activeSeats = new Set([seatNum]);
            repaintSeats();
            renderTicket();
            return;
          }
          if (_activeSeats.has(seatNum)) _activeSeats.delete(seatNum);
          else _activeSeats.add(seatNum);
          repaintSeats();
          renderTicket();
        };
      })(sn));
      body.appendChild(pill);
    });

    // Add-seat tile after all populated cells
    var addTile = _buildAddTile();
    addTile.addEventListener('pointerup', function() {
      var usedSeats = {};
      _allSeatList.forEach(function(sn) { usedSeats[sn] = true; });
      var newSeat = 1;
      while (usedSeats[newSeat]) newSeat++;
      if (newSeat > 99) { showToast('Maximum 99 seats', { bg: T.gold }); return; }
      _allSeatList.push(newSeat);
      _seatList.push(newSeat);
      _activeSeats.add(newSeat);
      _autoSwitchArmed = false;
      repaintSeats();
      renderTicket();
    });
    body.appendChild(addTile);
  }

  allBtn.addEventListener('pointerup', function() {
    _allSeatList.forEach(function(sn) { _activeSeats.add(sn); });
    _autoSwitchArmed = false;
    repaintSeats();
    renderTicket();
  });

  noneBtn.addEventListener('pointerup', function() {
    _activeSeats.clear();
    _autoSwitchArmed = false;
    repaintSeats();
    renderTicket();
  });

  repaintSeats();
  card._repaintSeats = repaintSeats;
  // Called by _pushToAllSeats after items land — refresh pill states (in
  // case auto-switch armed) and any future add-seat hints.
  card._onItemAdded = function() { repaintSeats(); };
  return card;
}

// ── BOTTOM BAR — SAVE / SEND ────────────────────
// Only the default SAVE/SEND pair surfaces in the current UI. The
// modifier-session (CANCEL/UNDO/DONE) and item-selected (DESELECT/
// MODIFY/SEND) branches were removed; their underlying state
// plumbing remains in place for future resurfacing.
function rebuildBottomBar() {
  if (!_bottomBar) return;
  _bottomBar.innerHTML = '';
  _bottomBar.style.cssText = 'display:grid;grid-template-columns:repeat(5,1fr);grid-auto-rows:auto;gap:4px;flex-shrink:0;margin-top:4px;';

  var hasUnsent = ticket.some(function(i) { return !i.sent; });

  var doneLabel = isSending ? 'SENDING…' : 'DONE';

  var doneBtn = buildPillButton({
    label:    doneLabel,
    variant:  'mint',
    disabled: isSending,
    fontSize: '22px',
  });
  doneBtn.style.gridColumn = '4 / span 2';
  doneBtn.style.height = '60px';
  doneBtn.style.width = '60%';
  doneBtn.style.justifySelf = 'center';
  doneBtn.style.margin = '2px 0 10px';
  doneBtn.addEventListener('pointerup', function() {
    if (isSending) return;
    if (!hasUnsent) { handleClose(); return; }
    (async function() {
      try { await handleSend(); } catch (e) { return; }
      handleClose();
    })();
  });

  _bottomBar.appendChild(doneBtn);
}

function clearModifierSelection() {
  modifierSession.selectedItems = [];
  ticket.forEach(function(i) { i.selected = false; });
  renderTicket();
  rebuildBottomBar();
}

// ── MODIFIER SESSION ─────────────────────────────
function openModifierSession() {
  if (modifierSession.active) return;
  // Filter to unsent items only
  var ids = modifierSession.selectedItems;
  var items = ticket.filter(function(i) { return ids.indexOf(i.id) !== -1 && !i.sent; });
  if (items.length === 0) {
    showToast('No unsent items selected', { bg: hexToRgba(T.text, 0.45), duration: 2000 });
    return;
  }
  modifierSession.active = true;
  modifierSession.selectedItems = items.map(function(i) { return i.id; });
  modifierSession.activePrefix = null;
  modifierSession.activePlacement = null;
  modifierSession.appliedMods = [];

  // Detect pizza items for placement
  var catIds = [];
  items.forEach(function(i) {
    if (i.category && catIds.indexOf(i.category) === -1) catIds.push(i.category);
  });
  modifierSession.hasPizza = hasPizzaCategory(catIds);
  modifierSession._catIds = catIds;

  // Collapse snake grid, show modifier panel
  if (_gridWrap) _gridWrap.style.display = 'none';

  var panel = buildModifierPanel(catIds);
  modifierSession.panelEl = panel;
  if (_mainArea && _bottomBar) {
    _mainArea.insertBefore(panel, _bottomBar);
  }

  // Init HexNav after panel is in the DOM so it gets correct dimensions
  if (panel._initHexNav) panel._initHexNav();

  rebuildBottomBar();
  renderTicket();
}

function buildPlacementBar() {
  var plColor = MOD_COLORS.pizza.color;
  var plText  = MOD_COLORS.pizza.textColor;
  var dimText = hexToRgba(T.text, 0.6);

  var container = document.createElement('div');
  container.style.cssText = [
    'flex-shrink:0;height:44px;display:flex;align-items:stretch;',
    'background:' + T.well + ';border-radius:' + T.pillRadius + ';',
    'overflow:hidden;border:1px solid ' + T.border + ';',
  ].join('');

  var segments = {};
  var order = ['left', 'whole', 'right'];

  order.forEach(function(id, i) {
    var pl = PIZZA_PLACEMENTS.find(function(p) { return p.id === id; });
    if (!pl) return;
    var isActive = modifierSession.activePlacement === id;

    if (i > 0) {
      var div = document.createElement('div');
      div.style.cssText = 'width:1px;background:' + T.border + ';flex-shrink:0;align-self:stretch;';
      container.appendChild(div);
    }

    var seg = document.createElement('div');
    seg.style.cssText = [
      'flex:' + (id === 'whole' ? '2' : '1') + ';',
      'display:flex;align-items:center;justify-content:center;',
      'font-family:' + T.fh + ';font-size:13px;font-weight:700;letter-spacing:1px;',
      'background:' + (isActive ? plColor : 'transparent') + ';',
      'color:' + (isActive ? plText : dimText) + ';',
      'cursor:pointer;transition:all 120ms;',
    ].join('');
    seg.textContent = pl.label.toUpperCase();

    seg.addEventListener('pointerup', function(e) {
      e.stopPropagation();
      modifierSession.activePlacement = id;
      refreshPlacementBar();
    });

    container.appendChild(seg);
    segments[id] = seg;
  });

  return { wrap: container, segments: segments, plColor: plColor, plText: plText, dimText: dimText };
}

function refreshPlacementBar() {
  var panel = modifierSession.panelEl;
  if (!panel || !panel._placeBar) return;
  var bar = panel._placeBar;

  ['left', 'whole', 'right'].forEach(function(id) {
    var seg = bar.segments[id];
    if (!seg) return;
    var isActive = modifierSession.activePlacement === id;
    seg.style.background = isActive ? bar.plColor : 'transparent';
    seg.style.color = isActive ? bar.plText : bar.dimText;
  });
}

function buildModifierPanel(catIds) {
  var panel = document.createElement('div');
  panel.style.cssText = [
    'flex:1;display:flex;flex-direction:column;gap:4px;',
    'background:' + T.card + ';',
    'border-left:' + T.accentBarW + ' solid ' + T.gold + ';',
    'border-radius:' + T.chamferCard + 'px;',
    'box-shadow:0 4px 16px rgba(0,0,0,0.28);',
    'padding:10px;overflow:hidden;',
    'margin:0 10px 10px;',
    'padding-bottom:' + OVERLAP + 'px;',
  ].join('');

  // ── PREFIX ROW ──
  var prefixRow = document.createElement('div');
  prefixRow.style.cssText = 'display:flex;gap:6px;flex-shrink:0;';
  panel._prefixBtns = {};

  UNI_PREFIXES.forEach(function(p) {
    var isActive = modifierSession.activePrefix === p.id;
    var pDef = PREFIXES.find(function(x) { return x.id === p.id; }) || {};
    var pColor = pDef.color || T.card;
    var pTextColor = pDef.textColor || T.text;

    var btn = buildPillButton({
      label: p.label,
      color: isActive ? pColor : T.card,
      fontSize: '26px',
      onClick: function(e) {
        // e.stopPropagation(); // buildPillButton uses addEventListener internally or wraps it
        modifierSession.activePrefix = (modifierSession.activePrefix === p.id) ? null : p.id;
        refreshModifierPanel();
      }
    });
    btn.style.color = isActive ? pTextColor : pColor;
    btn.style.fontFamily = T.fh;
    btn.style.flex = '1';
    btn.style.height = '44px';

    panel._prefixBtns[p.id] = btn;
    prefixRow.appendChild(btn);
  });
  panel.appendChild(prefixRow);

  // ── PIZZA PLACEMENT CARD — wide chamfered bar with 3 segments ──
  if (modifierSession.hasPizza) {
    if (!modifierSession.activePlacement) modifierSession.activePlacement = 'whole';
    var placeBar = buildPlacementBar();
    panel._placeBar = placeBar;
    panel.appendChild(placeBar.wrap);
  }

  // ── MODIFIER BUTTON GRID (replaces HexNav) ──
  var modData = getModHexData(catIds || []);
  panel._modData = modData;

  // Category tab bar
  var catTabBar = document.createElement('div');
  catTabBar.style.cssText = 'display:flex;gap:4px;flex-shrink:0;';
  panel._catTabBtns = {};
  var activeCatId = modData.length > 0 ? modData[0].id : null;
  panel._activeCatId = activeCatId;

  modData.forEach(function(cat) {
    var isActive = cat.id === activeCatId;
    var catBtn = document.createElement('div');
    catBtn.style.cssText = [
      'flex:1;height:34px;display:flex;align-items:center;justify-content:center;',
      'font-family:' + T.fh + ';font-size:20px;cursor:pointer;',
      'border:2px solid ' + cat.color + ';',
      'background:' + (isActive ? cat.color : T.card) + ';',
      'color:' + (isActive ? cat.textColor : cat.color) + ';',
      'transition:background 80ms,color 80ms;',
    ].join('');
    catBtn.textContent = cat.label;
    catBtn.addEventListener('pointerup', function(e) {
      e.stopPropagation();
      panel._activeCatId = cat.id;
      refreshModCatTabs(panel);
      renderModButtonGrid(panel);
    });
    panel._catTabBtns[cat.id] = catBtn;
    catTabBar.appendChild(catBtn);
  });
  panel.appendChild(catTabBar);

  // Scrollable button grid
  var gridWrap = document.createElement('div');
  gridWrap.style.cssText = 'flex:1;overflow-y:auto;overflow-x:hidden;scrollbar-width:none;-ms-overflow-style:none;';
  var grid = document.createElement('div');
  grid.style.cssText = 'display:grid;grid-template-columns:repeat(3,1fr);gap:6px;padding:4px;';
  gridWrap.appendChild(grid);
  panel._modGrid = grid;
  panel.appendChild(gridWrap);

  // Init: no deferred HexNav needed
  panel._initHexNav = function() {
    renderModButtonGrid(panel);
  };

  // ── APPLIED MODS LOG ──
  var logWrap = document.createElement('div');
  logWrap.style.cssText = [
    'max-height:100px;overflow-y:auto;scrollbar-width:none;-ms-overflow-style:none;',
    'background:' + T.well + ';padding:4px 8px;flex-shrink:0;',
    'border:1px solid ' + T.border + ';border-radius:6px;',
    'box-shadow:inset 0 2px 4px rgba(0,0,0,0.35);',
  ].join('');
  panel._log = logWrap;
  panel.appendChild(logWrap);

  // Init log
  renderAppliedModsLog(panel);

  return panel;
}

function applyModifier(mod) {
  if (!modifierSession.activePrefix) {
    showToast('Select a prefix first', { bg: hexToRgba(T.text, 0.45), duration: 2000 });
    return;
  }
  var prefix = UNI_PREFIXES.find(function(p) { return p.id === modifierSession.activePrefix; });
  if (!prefix) return;

  var placement = modifierSession.hasPizza ? (modifierSession.activePlacement || 'whole') : null;
  var modName = prefix.label + ' ' + mod.label;
  var modRefs = [];

  // Determine price based on prefix: ADD/EXTRA use modifier price, others are free
  var chargesPrice = prefix.id === 'add' || prefix.id === 'extra';
  var modPrice = chargesPrice ? (mod.price || 0) : 0;
  var charged = chargesPrice && modPrice > 0;

  modifierSession.selectedItems.forEach(function(id) {
    var inst = ticket.find(function(i) { return i.id === id; });
    if (!inst) return;
    var isPizza = inst.category === 'pizza';
    var halfSide = null;
    if (isPizza && placement === 'left') halfSide = 'Left';
    else if (isPizza && placement === 'right') halfSide = 'Right';

    var modObj = { name: modName, price: modPrice, charged: charged, prefix: halfSide };
    inst.mods.push(modObj);
    modRefs.push({ inst: inst, mod: modObj });
  });

  var logLabel = modName + (charged ? ' +$' + modPrice.toFixed(2) : '');
  modifierSession.appliedMods.push({
    prefixId: prefix.id,
    prefixLabel: prefix.label,
    modId: mod.id || mod.label,
    modLabel: mod.label,
    placement: placement,
    affectedItemIds: modifierSession.selectedItems.slice(),
    modRefs: modRefs,
    logLabel: logLabel,
  });

  renderTicket();
  refreshModifierPanel();
}

function refreshModifierPanel() {
  var panel = modifierSession.panelEl;
  if (!panel) return;

  // Refresh prefix button states
  UNI_PREFIXES.forEach(function(p) {
    var btn = panel._prefixBtns[p.id];
    if (!btn) return;
    var isActive = modifierSession.activePrefix === p.id;
    var pDef = PREFIXES.find(function(x) { return x.id === p.id; }) || {};
    var pColor = pDef.color || T.card;
    var pTextColor = pDef.textColor || T.text;
    var inner = btn.firstElementChild || btn.querySelector('div');
    if (inner) {
      inner.style.background = isActive ? pColor : T.card;
      inner.style.color = isActive ? pTextColor : pColor;
    }
  });

  // Refresh placement bar (pizza)
  refreshPlacementBar();

  // Refresh applied mods log
  renderAppliedModsLog(panel);
}

function refreshModCatTabs(panel) {
  if (!panel || !panel._catTabBtns || !panel._modData) return;
  panel._modData.forEach(function(cat) {
    var btn = panel._catTabBtns[cat.id];
    if (!btn) return;
    var isActive = panel._activeCatId === cat.id;
    btn.style.background = isActive ? cat.color : T.card;
    btn.style.color = isActive ? cat.textColor : cat.color;
  });
}

function renderModButtonGrid(panel) {
  var grid = panel._modGrid;
  if (!grid) return;
  grid.innerHTML = '';

  var activeCat = null;
  (panel._modData || []).forEach(function(cat) {
    if (cat.id === panel._activeCatId) activeCat = cat;
  });
  if (!activeCat) return;

  var catColor = activeCat.color;
  var catText = activeCat.textColor;

  // Flatten all items from all subcats
  (activeCat.subcats || []).forEach(function(sub) {
    (sub.items || []).forEach(function(item) {
      var btn = document.createElement('div');
      btn.style.cssText = [
        'display:flex;align-items:center;justify-content:center;',
        'height:52px;cursor:pointer;',
        'font-family:' + T.fb + ';font-size:22px;font-weight:bold;',
        'text-align:center;word-break:break-word;',
        'background:' + T.card + ';',
        'color:' + catText + ';',
        'border:2px solid ' + catColor + ';',
        'transition:background 80ms;',
        'touch-action:manipulation;pointer-events:auto;',
      ].join('');
      btn.textContent = item.label;

      btn.addEventListener('pointerdown', function() {
        btn.style.background = catColor;
        btn.style.color = activeCat.textColor === catText ? T.text : catText;
      });
      btn.addEventListener('pointerup', function() {
        btn.style.background = T.card;
        btn.style.color = catText;
        applyModifier(item);
      });
      btn.addEventListener('pointerleave', function() {
        btn.style.background = T.card;
        btn.style.color = catText;
      });

      grid.appendChild(btn);
    });
  });
}

function renderAppliedModsLog(panel) {
  var log = panel._log;
  if (!log) return;
  log.innerHTML = '';

  if (modifierSession.appliedMods.length === 0) {
    var empty = document.createElement('div');
    empty.style.cssText = 'font-family:' + T.fb + ';font-size:30px;color:' + hexToRgba(T.text, 0.6) + ';text-align:center;padding:4px 0;';
    empty.textContent = 'No modifiers applied';
    log.appendChild(empty);
    return;
  }

  modifierSession.appliedMods.forEach(function(entry, idx) {
    var row = document.createElement('div');
    row.style.cssText = 'display:flex;justify-content:space-between;align-items:center;font-family:' + T.fb + ';font-size:30px;color:' + T.gold + ';line-height:1.2;';
    var label = document.createElement('span');
    label.textContent = entry.logLabel || (entry.prefixLabel + ' \u2192 ' + entry.modLabel);
    row.appendChild(label);
    var removeBtn = document.createElement('span');
    removeBtn.textContent = '\u2715';
    removeBtn.style.cssText = 'color:' + T.verm + ';cursor:pointer;padding:0 4px;font-size:28px;flex-shrink:0;touch-action:manipulation;pointer-events:auto;';
    removeBtn.addEventListener('pointerup', (function(i) {
      return function(e) {
        e.stopPropagation();
        var removed = modifierSession.appliedMods.splice(i, 1)[0];
        removed.modRefs.forEach(function(ref) {
          var mIdx = ref.inst.mods.indexOf(ref.mod);
          if (mIdx !== -1) ref.inst.mods.splice(mIdx, 1);
        });
        renderTicket();
        refreshModifierPanel();
      };
    })(idx));
    row.appendChild(removeBtn);
    log.appendChild(row);
  });

  // RESET button to clear all applied modifiers
  if (modifierSession.appliedMods.length > 0) {
    var resetBtn = buildPillButton({
      label: 'RESET ALL',
      color: T.verm,
      fontSize: '11px',
      onClick: function() {
        cancelSession();
      }
    });
    resetBtn.style.marginTop = '6px';
    resetBtn.style.width = '100%';
    log.appendChild(resetBtn);
  }

  log.scrollTop = log.scrollHeight;
}

function undoLastMod() {
  if (modifierSession.appliedMods.length === 0) return;
  var last = modifierSession.appliedMods.pop();

  // Remove the mod from all affected items
  last.modRefs.forEach(function(ref) {
    var idx = ref.inst.mods.indexOf(ref.mod);
    if (idx !== -1) ref.inst.mods.splice(idx, 1);
  });

  // Reset prefix if no more mods
  if (modifierSession.appliedMods.length === 0) {
    modifierSession.activePrefix = null;
  }

  renderTicket();
  refreshModifierPanel();
}

function cancelSession() {
  // Roll back ALL mods in reverse order
  while (modifierSession.appliedMods.length > 0) {
    var entry = modifierSession.appliedMods.pop();
    entry.modRefs.forEach(function(ref) {
      var idx = ref.inst.mods.indexOf(ref.mod);
      if (idx !== -1) ref.inst.mods.splice(idx, 1);
    });
  }
  // Close modifier panel if open so _modPanelItem doesn't leak
  if (_modPanel) closeModifierPanel();
  endModifierSession();
}

function finalizeSession() {
  // Mods are already on ticket items — just close the session
  endModifierSession();
}

function endModifierSession() {
  modifierSession.active = false;
  modifierSession.activePrefix = null;
  modifierSession.activePlacement = null;
  modifierSession.appliedMods = [];
  modifierSession.hasPizza = false;

  // Remove panel
  if (modifierSession.panelEl && modifierSession.panelEl.parentNode) {
    modifierSession.panelEl.parentNode.removeChild(modifierSession.panelEl);
  }
  modifierSession.panelEl = null;

  // Clear selection
  modifierSession.selectedItems = [];
  ticket.forEach(function(i) { i.selected = false; });

  // Restore grid
  if (_gridWrap) _gridWrap.style.display = '';

  renderTicket();
  rebuildBottomBar();
}


// ── KIND MODIFIER PANEL — inline replacement for modifier-panel.js ────────
// Builds our Vz2.0 modifier UI directly. Returns { destroy() }.

var _PREFIX_DEFS = [
  { id:'ADD',     label:'ADD',     color: null },  // T.greenWarm
  { id:'EXTRA',   label:'EXTRA',   color: null },  // T.elec
  { id:'NO',      label:'NO',      color: null },  // T.verm
  { id:'ON SIDE', label:'ON SIDE', color: null },  // T.gold
  { id:'LITE',    label:'LITE',    color: null },  // T.gold
];

var _PLACE_DEFS = [
  { id:'LEFT',  label:'½ LEFT'  },
  { id:'WHOLE', label:'WHOLE'   },
  { id:'RIGHT', label:'RIGHT ½' },
];

function _prefixColor(id) {
  if (id === 'ADD')     return T.greenWarm;
  if (id === 'EXTRA')   return T.elec;
  if (id === 'NO')      return T.verm;
  if (id === 'ON SIDE') return T.gold;
  if (id === 'LITE')    return T.gold;
  return T.card;
}

function buildKindModPanel(container, item, modConfig, catColor, enablePlacement, callbacks) {
  modConfig = modConfig || {};
  var includedItems   = modConfig.includedItems   || [];
  var mandatoryGroups = modConfig.mandatoryGroups || [];
  var optionalGroups  = modConfig.optionalGroups  || [];
  var isPizza = !!enablePlacement;

  // ── State ──────────────────────────────────────────
  var inclState  = {};   // mod.id  → 'NO'|'ON SIDE'
  var optState   = {};   // optId   → { prefix, placement }
  var mandState  = {};   // groupKey → { key, label, price }
  var activePrefix = 'ADD';
  var activePlacement = 'WHOLE';

  // ── Root overlay ────────────────────────────────────
  var ov = document.createElement('div');
  ov.style.cssText = [
    'flex:1;min-height:0;',
    'background:' + T.bg + ';',
    'display:flex;flex-direction:column;',
    'overflow:hidden;',
  ].join('');

  // strip is rendered by openModifierPanel as a separate _mainArea flex child
  var itemPx = typeof item.price === 'number' ? item.price : 0;

  // ── Scrollable content ──────────────────────────────
  var scroll = document.createElement('div');
  scroll.style.cssText = 'flex:1;overflow-y:auto;padding:8px 14px 10px;';
  ov.appendChild(scroll);

  // ── DONE button ─────────────────────────────────────
  var doneWrap = document.createElement('div');
  doneWrap.style.cssText = 'flex-shrink:0;padding:8px 14px 10px;';
  var doneBtn = buildPillButton({ label: 'DONE — ADD TO CHECK', color: T.green, textColor: T.well });
  doneBtn.style.width = '100%';
  doneBtn.style.fontSize = '16px';
  doneBtn.addEventListener('pointerup', function() { callbacks.onSend(_buildActiveItem()); });
  doneBtn.disabled = mandatoryGroups.some(function(g) { return !mandState[g.key]; });
  doneWrap.appendChild(doneBtn);
  ov.appendChild(doneWrap);

  // ── Helpers ─────────────────────────────────────────
  function sectionLabel(text, color) {
    var d = document.createElement('div');
    d.style.cssText = [
      'display:flex;align-items:center;gap:8px;',
      'font-family:' + T.fb + ';font-size:10px;color:' + color + ';',
      'letter-spacing:2px;margin-bottom:8px;margin-top:4px;',
    ].join('');
    var t = document.createElement('span');
    t.textContent = text;
    t.style.cssText = 'pointer-events:none;';
    var line = document.createElement('div');
    line.style.cssText = 'height:1px;flex:1;background:' + color + '33;pointer-events:none;';
    d.appendChild(t);
    d.appendChild(line);
    return d;
  }

  function pill(label, bg, active, onClick) {
    var el = buildPillButton({
      label: label,
      color: active ? bg : T.card,
      darkBg: true,
      onClick: onClick
    });
    Object.assign(el.style, {
      padding:      '8px 16px',
      fontSize:     '13px',
      height:       'auto', // let padding define it or set an explicit height if needed
      border:       '1px solid ' + (active ? bg : 'rgba(255,255,255,0.1)'),
      boxShadow:    (active ? '0 4px 0 ' + hexToRgba(bg, 0.5) : '0 3px 0 ' + T.moonDk),
      whiteSpace:   'nowrap',
      width:        'auto',
    });
    return el;
  }

  function pillWrap() {
    var d = document.createElement('div');
    d.style.cssText = 'display:flex;flex-wrap:wrap;gap:7px;margin-bottom:12px;';
    return d;
  }

  // ── Build active item for commit ─────────────────────
  function _buildActiveItem() {
    var pricingDriverKey = modConfig.pricingDriverKey;
    var pricingDriverValue = pricingDriverKey ? (mandState[pricingDriverKey] ? mandState[pricingDriverKey].key : null) : null;

    var optMods = [];
    Object.keys(optState).forEach(function(optId) {
      var s = optState[optId];
      if (!s) return;
      // Find the option def
      var found = null;
      optionalGroups.forEach(function(g) {
        (g.options || []).forEach(function(o) {
          if ((o.id || o.key) === optId) found = o;
        });
      });
      if (!found) return;

      var resolvedPrice = found.price || 0;
      if (pricingDriverValue && found.priceByOption && found.priceByOption[pricingDriverValue] !== undefined) {
        resolvedPrice = found.priceByOption[pricingDriverValue];
      }

      var placeMap = { 'LEFT': '1st', 'RIGHT': '2nd', 'WHOLE': null };
      optMods.push({
        prefix:    s.prefix,
        label:     found.label,
        price:     resolvedPrice,
        placement: placeMap[s.placement] || null,
      });
    });

    var removals = Object.keys(inclState).filter(function(id) {
      return inclState[id] === 'NO';
    });

    // Build mandatory selections map
    var mandSel = {};
    Object.keys(mandState).forEach(function(k) {
      var s = mandState[k];
      var grp = mandatoryGroups.find(function(g) { return g.key === k; });
      var opt = grp ? (grp.options || []).find(function(o) { return (o.key || o.id) === s.key; }) : null;

      var resolvedPrice = s.price;
      if (opt && pricingDriverValue && opt.priceByOption && opt.priceByOption[pricingDriverValue] !== undefined) {
        resolvedPrice = opt.priceByOption[pricingDriverValue];
      }
      mandSel[k] = { key: s.key, label: s.label, price: resolvedPrice };
    });

    // Build preview mods for ticket
    var previewMods = [];

    // 1. Mandatory selections (e.g. Size, Crust)
    Object.keys(mandSel).forEach(function(k) {
      var s = mandSel[k];
      previewMods.push({ name: s.label, price: s.price || 0, charged: (s.price > 0), prefix: null });
    });

    // 2. Included items (Pre-applied) — show even if not modified, unless removed
    includedItems.forEach(function(inc) {
      if (removals.indexOf(inc.id) === -1) {
        var state = inclState[inc.id] || null;
        var label = (state === 'ON SIDE' ? 'ON SIDE ' : '') + inc.label;
        previewMods.push({ name: label, price: 0, charged: false, prefix: null });
      }
    });

    // 3. Removals (NO X)
    removals.forEach(function(rid) {
      var inc = includedItems.find(function(i) { return i.id === rid; });
      if (inc) previewMods.push({ name: 'NO ' + inc.label, price: 0, charged: false, prefix: null });
    });

    // 4. Optional modifiers
    optMods.forEach(function(m) {
      var halfSide = m.placement === '1st' ? 'Left' : m.placement === '2nd' ? 'Right' : null;
      var charged = (m.prefix === 'ADD' || m.prefix === 'EXTRA') && m.price > 0;
      // `activePrefix` starts as null (line 1312) and stays null until
      // the server taps ADD/NO/EXTRA/etc. A modifier picked before any
      // prefix is chosen previously rendered as "null Pepperoni" on
      // both the preview and (via commitModifierPanelItem) the kitchen
      // ticket. formatModifierLabel handles the null-prefix fallback
      // so the commit path (below) and this preview stay in lockstep.
      var displayName = formatModifierLabel(m.prefix, m.label);
      previewMods.push({ name: displayName, price: charged ? m.price : 0, charged: charged, prefix: halfSide });
    });

    callbacks.onUpdate({ itemLabel: item.label, basePrice: itemPx, mods: previewMods });

    return {
      itemLabel:           item.label,
      basePrice:           itemPx,
      mandatorySelections: mandSel,
      optionalModifiers:   optMods,
      includedRemovals:    removals,
      allergens:           [],
      allergenNote:        '',
      note:                '',
    };
  }

  // ── Render content sections ──────────────────────────
  function renderContent() {
    var savedTop = scroll.scrollTop;
    scroll.innerHTML = '';

    // ── SNAKE BREADCRUMB CARD — matches grid tile style ──
    var snakeCard = document.createElement('div');
    snakeCard.style.cssText = [
      'display:flex;gap:6px;align-items:stretch;',
      'margin-bottom:12px;',
    ].join('');

    // Crumb tiles — filled, same style as buildCrumbTile
    snakeState.crumbs.forEach(function(crumb) {
      var tile = document.createElement('div');
      tile.style.cssText = [
        'display:flex;align-items:center;justify-content:center;',
        'padding:10px 14px;border-radius:10px;min-height:95px;',
        'background:' + crumb.color + ';',
        'border-left:4px solid ' + crumb.color + ';',
        'box-shadow:0 4px 0 ' + hexToRgba(crumb.color, 0.55) + ';',
        'font-family:' + T.fh + ';font-weight:700;font-size:22px;',
        'color:' + T.well + ';letter-spacing:1px;pointer-events:none;',
      ].join('');
      tile.textContent = crumb.label;
      snakeCard.appendChild(tile);
    });

    // Item tile — same style as buildItemTile but filled, tap to cancel
    var itemTile = document.createElement('div');
    itemTile.style.cssText = [
      'display:flex;flex-direction:column;justify-content:center;',
      'padding:10px 14px;border-radius:10px;cursor:pointer;',
      'background:' + catColor + ';',
      'border-left:4px solid ' + catColor + ';',
      'box-shadow:0 4px 0 ' + hexToRgba(catColor, 0.55) + ';',
      'pointer-events:auto;touch-action:manipulation;',
      'min-height:95px;min-width:120px;',
    ].join('');
    var icn = document.createElement('span');
    icn.style.cssText = 'font-family:' + T.fh + ';font-weight:700;font-size:22px;color:' + T.well + ';pointer-events:none;';
    icn.textContent = item.label;
    var icp = document.createElement('span');
    icp.style.cssText = 'font-family:' + T.fb + ';font-size:14px;color:rgba(255,255,255,0.75);margin-top:4px;pointer-events:none;';
    icp.textContent = '$' + itemPx.toFixed(2);
    itemTile.appendChild(icn);
    itemTile.appendChild(icp);
    itemTile.addEventListener('pointerup', function() { callbacks.onCancel(); });
    snakeCard.appendChild(itemTile);
    scroll.appendChild(snakeCard);

    // ── MANDATORY GROUPS ──
    mandatoryGroups.forEach(function(g) {
      var mandHdr = sectionLabel('REQUIRED — ' + g.label, T.verm);
      mandHdr.dataset.mandkey = g.key;
      scroll.appendChild(mandHdr);
      var wrap = pillWrap();
      (g.options || []).forEach(function(opt) {
        var sel = mandState[g.key] && mandState[g.key].key === (opt.key || opt.id);
        var p = pill(opt.label, T.verm, sel, function() {
          if (sel) { delete mandState[g.key]; }
          else { mandState[g.key] = { key: opt.key || opt.id, label: opt.label, price: opt.price || 0 }; }
          doneBtn.disabled = mandatoryGroups.some(function(g) { return !mandState[g.key]; });
          renderContent();
          var nextUnsatisfied = mandatoryGroups.find(function(g) { return !mandState[g.key]; });
          if (nextUnsatisfied) {
            var nextEl = scroll.querySelector('[data-mandkey="' + nextUnsatisfied.key + '"]');
            if (nextEl) {
              requestAnimationFrame(function() {
                nextEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
              });
            }
          }
        });
        wrap.appendChild(p);
      });
      scroll.appendChild(wrap);
    });

    // ── INCLUDED ──
    if (includedItems.length > 0) {
      scroll.appendChild(sectionLabel('INCLUDED', hexToRgba(T.text, 0.6)));
      var inclWrap = document.createElement('div');
      inclWrap.style.cssText = 'display:flex;flex-direction:column;gap:7px;margin-bottom:12px;';
      includedItems.forEach(function(inc) {
        var state = inclState[inc.id] || null;
        var row = document.createElement('div');
        row.style.cssText = 'display:flex;align-items:center;gap:6px;flex-wrap:wrap;';
        var lbl = document.createElement('span');
        lbl.style.cssText = 'font-family:' + T.fb + ';font-size:13px;color:' + T.text + ';white-space:nowrap;flex:1 0 auto;';
        lbl.textContent = inc.label;
        row.appendChild(lbl);
        var noActive = state === 'NO';
        var noBtn = pill('NO', T.verm, noActive, function() {
          if (inclState[inc.id] === 'NO') delete inclState[inc.id]; else inclState[inc.id] = 'NO';
          renderContent();
        });
        noBtn.style.touchAction = 'manipulation';
        noBtn.style.pointerEvents = 'auto';
        row.appendChild(noBtn);
        var sideActive = state === 'ON SIDE';
        var sideBtn = pill('ON SIDE', T.gold, sideActive, function() {
          if (inclState[inc.id] === 'ON SIDE') delete inclState[inc.id]; else inclState[inc.id] = 'ON SIDE';
          renderContent();
        });
        sideBtn.style.touchAction = 'manipulation';
        sideBtn.style.pointerEvents = 'auto';
        row.appendChild(sideBtn);
        inclWrap.appendChild(row);
      });
      scroll.appendChild(inclWrap);
    }

    // ── OPTIONS ──
    if (optionalGroups.length > 0) {
      scroll.appendChild(sectionLabel('OPTIONS', T.greenWarm));

      // Prefix toolbar
      var pfxWrap = document.createElement('div');
      pfxWrap.style.cssText = 'display:flex;gap:6px;flex-wrap:wrap;margin-bottom:8px;';
      _PREFIX_DEFS.forEach(function(pfx) {
        var isActive = activePrefix === pfx.id;
        var pc = _prefixColor(pfx.id);
        var btn = document.createElement('div');
        btn.style.cssText = [
          'padding:5px 14px;border-radius:999px;cursor:pointer;',
          'user-select:none;pointer-events:auto;touch-action:manipulation;',
          'font-family:' + T.fb + ';font-weight:700;font-size:11px;letter-spacing:1px;',
          'color:' + T.well + ';',
          'background:' + (isActive ? pc : T.card) + ';',
          'border:1px solid ' + (isActive ? pc : 'rgba(255,255,255,0.1)') + ';',
          'box-shadow:' + (isActive ? '0 3px 0 ' + hexToRgba(pc, 0.55) : '0 2px 0 ' + T.moonDk) + ';',
          'transition:all 100ms;white-space:nowrap;',
        ].join('');
        btn.textContent = pfx.label;
        btn.addEventListener('pointerup', function() {
          activePrefix = pfx.id;
          renderContent();
        });
        pfxWrap.appendChild(btn);
      });
      scroll.appendChild(pfxWrap);

      // Placement bar — pizza only
      if (isPizza) {
        var placeBar = document.createElement('div');
        placeBar.style.cssText = [
          'display:flex;gap:3px;margin-bottom:10px;',
          'background:' + T.well + ';border-radius:10px;padding:3px;',
        ].join('');
        _PLACE_DEFS.forEach(function(pl) {
          var isActive = activePlacement === pl.id;
          var seg = document.createElement('div');
          seg.style.cssText = [
            'flex:' + (pl.id === 'WHOLE' ? 2 : 1) + ';text-align:center;',
            'padding:7px 8px;border-radius:8px;cursor:pointer;',
            'pointer-events:auto;touch-action:manipulation;',
            'font-family:' + T.fb + ';font-weight:700;font-size:10px;letter-spacing:1px;',
            'color:' + (isActive ? T.well : hexToRgba(T.text, 0.6)) + ';',
            'background:' + (isActive ? catColor : 'transparent') + ';',
            'box-shadow:' + (isActive ? '0 3px 0 ' + hexToRgba(catColor, 0.55) : 'none') + ';',
            'transition:all 120ms;',
          ].join('');
          seg.textContent = pl.label;
          seg.addEventListener('pointerup', function() {
            activePlacement = pl.id;
            renderContent();
          });
          placeBar.appendChild(seg);
        });
        scroll.appendChild(placeBar);
      }

      // Option pills for each optional group
      optionalGroups.forEach(function(g) {
        if (g.label) scroll.appendChild(sectionLabel(g.label, T.greenWarm));
        var optWrap = pillWrap();
        (g.options || []).forEach(function(opt) {
          var optId = opt.id || opt.key;
          var s     = optState[optId] || null;
          var isActive = !!s;
          var bg    = isActive ? _prefixColor(s.prefix) : T.card;
          var lbl   = isActive ? '[' + s.prefix + ']' + (s.placement !== 'WHOLE' ? '[' + s.placement + ']' : '') + ' ' + opt.label : opt.label;
          var p = pill(lbl, bg, isActive, function() {
            if (isActive) { delete optState[optId]; }
            else { optState[optId] = { prefix: activePrefix, placement: activePlacement }; }
            renderContent();
          });
          optWrap.appendChild(p);
        });
        scroll.appendChild(optWrap);
      });

      // Show a message if no groups configured (pizza fallback)
      if (optionalGroups.length === 0 && includedItems.length === 0 && mandatoryGroups.length === 0) {
        var msg = document.createElement('div');
        msg.style.cssText = 'font-family:' + T.fh + ';font-size:13px;color:' + hexToRgba(T.text, 0.6) + ';text-align:center;padding:24px 0;';
        msg.textContent = 'No modifiers configured — tap DONE to add';
        scroll.appendChild(msg);
      }
    } else if (optionalGroups.length === 0 && includedItems.length === 0 && mandatoryGroups.length === 0) {
      var msg2 = document.createElement('div');
      msg2.style.cssText = 'font-family:' + T.fh + ';font-size:13px;color:' + hexToRgba(T.text, 0.6) + ';text-align:center;padding:24px 0;';
      msg2.textContent = 'No modifiers configured — tap DONE to add';
      scroll.appendChild(msg2);
    }

    requestAnimationFrame(function() { scroll.scrollTop = savedTop; });
    _buildActiveItem();
  }

  renderContent();
  container.appendChild(ov);

  return {
    destroy: function() {
      if (ov.parentNode) ov.parentNode.removeChild(ov);
    },
  };
}


// ── MODIFIER PANEL (overlay on _mainArea) ─────────
function openModifierPanel(item, modConfig, catColor, enablePlacement) {
  if (_modPanel) closeModifierPanel();
  if (!_mainArea) return;

  _modPanelOpen = true;
  _modPanelCatColor = catColor || T.green;

  // Hide grid, seat selector, and bottom bar; snake strip stays hidden
  if (_gridWrap)       _gridWrap.style.display       = 'none';
  if (_snakeStrip)     { _snakeStrip.innerHTML = ''; _snakeStrip.style.display = 'none'; }
  if (_seatSelectorEl) _seatSelectorEl.style.display = 'none';
  if (_bottomBar)      _bottomBar.style.display      = 'none';
  _mainArea.style.border = 'none';

  _modPanel = buildKindModPanel(_mainArea, item, modConfig, catColor, enablePlacement, {
    onUpdate: function(outputItem) { _modPanelItem = outputItem; renderTicket(); },
    onSend:   function(activeItem) { commitModifierPanelItem(item, activeItem, modConfig); },
    onCancel: function()           { closeModifierPanel(); },
  });
  renderTicket();
}

function _buildSnakeStrip(item, catColor) {
  if (!_snakeStrip) return;
  _snakeStrip.innerHTML = '';
  _snakeStrip.style.display = 'flex';

  // Crumb tiles
  snakeState.crumbs.forEach(function(crumb) {
    var chip = document.createElement('div');
    chip.style.cssText = [
      'background:' + crumb.color + ';border-radius:8px;',
      'border-left:4px solid ' + crumb.color + ';',
      'padding:6px 16px;font-family:' + T.fh + ';',
      'font-weight:700;font-size:14px;color:' + T.well + ';letter-spacing:1px;',
      'pointer-events:none;',
    ].join('');
    chip.textContent = crumb.label;
    _snakeStrip.appendChild(chip);
  });

  // Item chip — tap to cancel
  var itemChip = document.createElement('div');
  itemChip.style.cssText = [
    'background:' + catColor + ';border-radius:8px;',
    'border-left:4px solid ' + catColor + ';',
    'padding:6px 16px;font-family:' + T.fh + ';',
    'font-weight:700;font-size:14px;color:' + T.well + ';letter-spacing:1px;',
    'display:flex;align-items:center;gap:8px;cursor:pointer;',
    'pointer-events:auto;touch-action:manipulation;',
    'box-shadow:0 0 12px ' + hexToRgba(catColor, 0.5) + ';',
  ].join('');
  var itemName = document.createElement('span');
  itemName.style.cssText = 'pointer-events:none;';
  itemName.textContent = item.label;
  var itemPrice = document.createElement('span');
  itemPrice.style.cssText = 'font-family:' + T.fb + ';font-size:13px;color:rgba(255,255,255,0.7);pointer-events:none;';
  itemPrice.textContent = '$' + (typeof item.price === 'number' ? item.price.toFixed(2) : '0.00');
  itemChip.appendChild(itemName);
  itemChip.appendChild(itemPrice);
  itemChip.addEventListener('pointerup', function() { closeModifierPanel(); });
  _snakeStrip.appendChild(itemChip);
}

function closeModifierPanel() {
  if (_modPanel) {
    _modPanel.destroy();
    _modPanel = null;
  }
  _modPanelItem = null;
  _modPanelCatColor = null;
  _modPanelOpen = false;

  // Restore grid and seat selector
  if (_gridWrap)       _gridWrap.style.display       = '';
  if (_snakeStrip)     { _snakeStrip.innerHTML = ''; _snakeStrip.style.display = 'none'; }
  if (_seatSelectorEl) _seatSelectorEl.style.display = '';
  if (_mainArea)       _mainArea.style.border        = '';

  renderTicket();

  requestAnimationFrame(function() {
    if (_bottomBar) _bottomBar.style.display = '';
    rebuildBottomBar();
  });
}



function commitModifierPanelItem(originalItem, activeItem, modConfig) {
  if (!_modPanelOpen) return;
  _modPanelOpen = false;
  modConfig = modConfig || {};
  // Build ticket item from modifier panel state
  var mands = activeItem.mandatorySelections;
  var mandPrice = 0;
  Object.keys(mands).forEach(function(k) {
    mandPrice += mands[k].price || 0;
  });

  // Mandatory selections as modifier lines
  var mods = [];
  var mandGroups = modConfig.mandatoryGroups || [];
  mandGroups.forEach(function(g) {
    if (mands[g.key]) {
      mods.push({
        name: mands[g.key].label,
        price: mands[g.key].price || 0,
        charged: (mands[g.key].price || 0) > 0,
        prefix: null,
      });
    }
  });

  // Optional modifiers — map placement to Left/Right prefix
  activeItem.optionalModifiers.forEach(function(m) {
    var charged = m.prefix !== 'NO' && m.price > 0;
    var halfSide = m.placement === '1st' ? 'Left' : m.placement === '2nd' ? 'Right' : null;
    // `m.prefix` is null if the modifier was picked before the server
    // tapped ADD/NO/EXTRA. formatModifierLabel treats null as
    // "unprefixed" rather than concatenating literal "null ".
    // Previously shipped "null Pepperoni" to the kitchen ticket.
    var displayName = formatModifierLabel(m.prefix, m.label);
    var parentMod = {
      name: displayName,
      price: m.prefix === 'NO' ? 0 : m.price,
      charged: charged,
      prefix: halfSide,
      children: [],
    };
    // Special exclusions as child mods (indented on ticket)
    if (m.special && m.exclusions && m.exclusions.length > 0) {
      m.exclusions.forEach(function(ex) {
        parentMod.children.push({ name: 'NO ' + ex, price: 0, charged: false });
      });
    }
    mods.push(parentMod);
  });

  // Included removals
  var includedItems = modConfig.includedItems || [];
  activeItem.includedRemovals.forEach(function(rid) {
    var incl = includedItems.find(function(i) { return i.id === rid; });
    if (incl) {
      mods.push({ name: 'NO ' + incl.label, price: 0, charged: false, prefix: null });
    }
  });

  // Allergens
  var ALLERGEN_LABELS = {
    nuts: 'Nuts', shellfish: 'Shellfish', gluten: 'Gluten', dairy: 'Dairy',
    soy: 'Soy', eggs: 'Eggs', fish: 'Fish',
  };
  activeItem.allergens.forEach(function(aId) {
    var label = ALLERGEN_LABELS[aId] || aId;
    mods.push({ name: '\u26A0 ALLERGEN: ' + label, price: 0, charged: false, prefix: null });
  });
  if (activeItem.allergenNote) {
    mods.push({ name: '\u26A0 ALLERGEN: ' + activeItem.allergenNote, price: 0, charged: false, prefix: null });
  }

  // Note
  if (activeItem.note) {
    mods.push({ name: '\uD83D\uDCDD ' + activeItem.note, price: 0, charged: false, prefix: null });
  }

  var ticketItem = {
    id:        ++ticketSeq,
    menu_item_id: originalItem.id,
    idemKey:   _idemKey(),
    name:      activeItem.itemLabel,
    unitPrice: activeItem.basePrice,
    mods:      mods,
    selected:  false,
    sent:      false,
    category:  snakeState.catId,
    // Preserve modifier panel data for ledger
    _modPanelData: {
      mandatory: mands,
      optionalModifiers: activeItem.optionalModifiers,
      includedRemovals: activeItem.includedRemovals,
      allergens: activeItem.allergens,
      allergenNote: activeItem.allergenNote,
      note: activeItem.note,
    },
  };

  _pushToAllSeats(ticketItem);
  closeModifierPanel();
}

// ── TAB SWITCHING ─────────────────────────────────
function switchTab(tab) {
  // No-op — navigation handled by snake nav
}


// ── TICKET ────────────────────────────────────────
// Build modifier config from Overseer-authored new-model wiring on MENU_DATA.
// Reads mandatoryGroupIds off the item and universalGroupIds off the category,
// then expands each referenced group into an option list.
// Returns null when no modifiers are configured — caller falls back to
// hardcoded configs for unmigrated items.
function resolveBackendModifierConfig(itemId, catId) {
  if (!itemId && !catId) return null;

  // Locate the MENU_DATA item + category to read new-model fields.
  var menuCat = catId ? MENU_DATA.find(function(c) { return c.id === catId; }) : null;
  var menuItem = null;
  if (menuCat) {
    (menuCat.subcats || []).some(function(sc) {
      menuItem = (sc.items || []).find(function(i) { return i.id === itemId; });
      return !!menuItem;
    });
  }
  // Fallback: scan all categories (item may be orphaned from catId)
  if (!menuItem && itemId) {
    MENU_DATA.some(function(c) {
      (c.subcats || []).some(function(sc) {
        menuItem = (sc.items || []).find(function(i) { return i.id === itemId; });
        return !!menuItem;
      });
      if (menuItem && !menuCat) menuCat = c;
      return !!menuItem;
    });
  }

  var mandatoryGroupIds = (menuItem && menuItem.mandatoryGroupIds) || [];
  var universalGroupIds = (menuCat && menuCat.universalGroupIds) || [];

  var mandatoryGroups = [];
  var pricingDriverKey = null;
  mandatoryGroupIds.forEach(function(gid) {
    var grp = MODIFIER_GROUPS.find(function(g) { return g.group_id === gid; });
    if (!grp) return;
    var drivesPricing = !!grp.drives_pricing;
    var entry = {
      key: gid,
      label: (grp.name || '').toUpperCase(),
      drivesPricing: drivesPricing,
      min: grp.min_selections || 0,
      max: grp.max_selections || 1,
      options: (grp.modifiers || []).map(function(m) {
        var priceByOption = (m.price_by_option && Object.keys(m.price_by_option).length > 0) ? m.price_by_option : null;
        var subatomicIds  = (m.included_modifier_ids && m.included_modifier_ids.length > 0) ? m.included_modifier_ids.slice() : null;
        return {
          key: m.modifier_id,
          id: m.modifier_id,
          label: m.name,
          price: parseFloat(m.price) || 0,
          priceByOption: priceByOption,
          includedModifierIds: subatomicIds,
        };
      }),
    };
    if (drivesPricing && !pricingDriverKey) pricingDriverKey = gid;
    mandatoryGroups.push(entry);
  });

  var optionalGroups = [];
  universalGroupIds.forEach(function(gid) {
    var grp = MODIFIER_GROUPS.find(function(g) { return g.group_id === gid; });
    if (!grp) return;
    optionalGroups.push({
      key: grp.group_id,
      label: (grp.name || '').toUpperCase(),
      min: grp.min_selections || 0,
      max: grp.max_selections || 99,
      options: (grp.modifiers || []).map(function(m) {
        var priceByOption = (m.price_by_option && Object.keys(m.price_by_option).length > 0) ? m.price_by_option : null;
        return {
          id: m.modifier_id,
          label: m.name,
          price: parseFloat(m.price) || 0,
          priceByOption: priceByOption,
        };
      }),
    });
  });

  if (mandatoryGroups.length === 0 && optionalGroups.length === 0) return null;
  return {
    mandatoryGroups: mandatoryGroups,
    optionalGroups: optionalGroups,
    includedItems: [],  // Caller overlays INCLUDED_BY_ITEM[itemId] if present
    pricingDriverKey: pricingDriverKey,
  };
}

function _pushToAllSeats(item) {
  var seatArr = Array.from(_activeSeats);
  if (seatArr.length === 0) seatArr = [_seatList[0] || 1];
  item.seat_number = seatArr[0];
  ticket.push(item);
  for (var si = 1; si < seatArr.length; si++) {
    var clone = Object.assign({}, item);
    clone.id = ++ticketSeq;
    clone.idemKey = _idemKey();
    clone.seat_number = seatArr[si];
    clone.mods = (item.mods || []).map(function(m) { return Object.assign({}, m); });
    if (item._modPanelData) clone._modPanelData = Object.assign({}, item._modPanelData);
    ticket.push(clone);
  }
  // Snapshot current seats (overwrites any previous) and arm auto-switch.
  _prevSeats = new Set(_activeSeats);
  _autoSwitchArmed = true;
  if (_seatSelectorEl && typeof _seatSelectorEl._onItemAdded === 'function') {
    _seatSelectorEl._onItemAdded();
  }
}

function getMenuCat(id) {
  return MENU_DATA.find(function(c) { return c.id === id; });
}

function getModCat(id) {
  return MOD_DATA.find(function(c) { return c.id === id; });
}

function handleItemSelect(item) {
  var name  = item.label || item;
  var price = typeof item.price === 'number' ? item.price : 0;

  // ── Combo flow: picking side or soda ──
  if (comboFlow) {
    if (comboFlow.step === 'side') {
      comboFlow.ticketItem.mods.push({ name: name, price: 0, charged: false });
      comboFlow.step = 'drink';
      // Navigate snake to drinks
      var drinksCat = getMenuCat('drinks');
      if (drinksCat) _selectCat(drinksCat);
      renderTicket();
      rebuildBottomBar();
      return;
    }
    if (comboFlow.step === 'drink') {
      comboFlow.ticketItem.mods.push({ name: name, price: 0, charged: false });
      comboFlow = null;
      // Return to category home
      snakeState = { view:'cats', crumbs:[], catId:null, subId:null };
      renderSnakeGrid();
      renderTicket();
      rebuildBottomBar();
      return;
    }
  }

  // ── Start combo flow if selected from COMBO category ──
  if (snakeState.catId === 'combo') {
    var comboMods = [];
    if (item.selectedMods) {
      item.selectedMods.forEach(function(sm) {
        comboMods.push({ name: sm.label, price: sm.price || 0, charged: sm.price > 0 });
      });
    }
    var ticketItem = {
      id:        ++ticketSeq,
      menu_item_id: item.id,
      idemKey:   _idemKey(),
      name:      'Combo ' + name,
      unitPrice: price,
      mods:      comboMods,
      selected:  false,
      sent:      false,
      category:  'combo',
    };
    _pushToAllSeats(ticketItem);
    comboFlow = { step: 'side', ticketItem: ticketItem };
    var sidesCat = getMenuCat('sides');
    if (sidesCat) _selectCat(sidesCat);
    renderTicket();
    rebuildBottomBar();
    return;
  }

  // ── Pizza builder: size tap opens the overlay ──
  if (item.pizzaSize) {
    showPizzaBuilderOverlay(item, PIZZA_BUILDER_DATA).then(function(result) {
      var pizzaItem = {
        id:        ++ticketSeq,
        menu_item_id: item.id,
        idemKey:   _idemKey(),
        name:      result.name,
        unitPrice: result.unitPrice,
        mods:      result.mods || [],
        selected:  false,
        sent:      false,
        category:  'pizza',
      };
      _pushToAllSeats(pizzaItem);
      renderTicket();
      rebuildBottomBar();
    }).catch(function() { /* cancelled */ });
    return;
  }

  // ── Modifier panel: resolve config from backend assignments ──
  var catId = snakeState.catId;
  if (!catId && item.id) catId = ITEM_TO_CATEGORY[item.id] || null;

  var backendConfig = resolveBackendModifierConfig(item.id, catId);
  var overseerIncluded = item.id ? INCLUDED_BY_ITEM[item.id] : null;

  if (backendConfig || (overseerIncluded && overseerIncluded.length > 0)) {
    var effectiveConfig = backendConfig ? Object.assign({}, backendConfig) : {};
    if (overseerIncluded && overseerIncluded.length > 0) {
      effectiveConfig.includedItems = overseerIncluded;
    }
    var catColor = catId ? T.catColor(catId.toUpperCase()) : T.green;
    var menuCat = catId ? getMenuCat(catId) : null;
    var enablePlacement = menuCat ? !!menuCat.enablePlacement : false;
    openModifierPanel(item, effectiveConfig, catColor, enablePlacement);
    return;
  }

  // ── Pizza fallback: always open modifier panel for pizza categories ──
  var menuCatForFallback = catId ? getMenuCat(catId) : null;
  if (menuCatForFallback && (menuCatForFallback.enablePlacement || menuCatForFallback.pizzaBuilder)) {
    var fallbackConfig = { mandatoryGroups: [], optionalGroups: [], includedItems: [] };
    openModifierPanel(item, fallbackConfig, menuCatForFallback.color, true);
    return;
  }

  addToTicket(item);
}

function addToTicket(item) {
  var name  = item.label || item;
  var price = typeof item.price === 'number' ? item.price : 0;

  // Empty-seat guard: if no seats are active, the new item has nowhere to
  // route. Toast and bail rather than silently routing to seat 1 — the
  // user explicitly hit NONE and we should respect that intent.
  if (_activeSeats.size === 0 && !modifierSession.active) {
    showToast('Pick a seat first', { bg: T.gold, duration: 2000 });
    return;
  }

  if (modifierSession.active) {
    // Apply modifier to all selected instances
    var selected = ticket.filter(function(i) { return i.selected; });
    if (selected.length === 0) {
      showToast('Select an item first', { bg: hexToRgba(T.text, 0.45), duration: 2000 });
      return;
    }

    // Check if current modifier category has half_placement
    var modCatId = snakeState.catId;
    var modCat = modCatId ? getModCat(modCatId) : null;
    if (modCat && modCat.half_placement) {
      var halfPrice = typeof item.half_price === 'number' ? item.half_price : null;
      // Use first selected item for overlay context
      var targetInst = selected[0];
      showHalfPlacementOverlay(targetInst.name, name, price, halfPrice, targetInst.mods)
        .then(function(result) {
          selected.forEach(function(inst) {
            // Re-selection: if same mod on other side, move it
            var otherSide = result.side === 'Left' ? 'Right' : 'Left';
            for (var i = inst.mods.length - 1; i >= 0; i--) {
              if (inst.mods[i].name === name && inst.mods[i].prefix === otherSide) {
                inst.mods.splice(i, 1);
              }
            }
            var modPrice = halfPrice != null ? halfPrice : 0;
            var mod = { name: name, price: modPrice, half_price: halfPrice, charged: modPrice > 0, prefix: result.side };
            inst.mods.push(mod);
            modHistory.push({ inst: inst, mod: mod });
          });
          renderTicket();
          rebuildBottomBar();
        })
        .catch(function() { /* cancelled */ });
      return;
    }

    var pfx = PREFIXES.find(function(p) { return p.id === modifierSession.activePrefix; });
    var modName = (pfx ? pfx.label + ' ' : '') + name;
    var charged = price > 0;
    selected.forEach(function(inst) {
      var mod = { name: modName, price: price, charged: charged, prefix: null };
      inst.mods.push(mod);
      modHistory.push({ inst: inst, mod: mod });
    });
  } else {
    // New item instance
    var mods = [];
    if (item.selectedMods) {
      item.selectedMods.forEach(function(sm) {
        mods.push({ name: sm.label, price: sm.price || 0, charged: sm.price > 0 });
      });
    }
    _pushToAllSeats({
      id:        ++ticketSeq,
      menu_item_id: item.id,
      idemKey:   _idemKey(),
      name:      name,
      unitPrice: price,
      mods:      mods,
      selected:  false,
      sent:      false,
      category:  snakeState.catId,
    });
  }
  renderTicket();
  rebuildBottomBar();
}

// Resolve an item instance to its category accent color.
// Reads inst.category (set on every instance by addToTicket and recallFromBackend)
// → MENU_DATA[catId].color (set by fetchMenuFromAPI from Overseer cat.color).
// T.moon fallback covers unfetched menu, recalled items predating per-cat
// colors, and orphan rows after a category delete.
function _catColorForItem(inst) {
  if (!inst || !inst.category) return T.moon;
  var cat = getMenuCat(inst.category);
  return (cat && cat.color) || T.moon;
}

// Build a mod tree under an item card: vertical stem + horizontal branches
// + bevel pills. Variants change pill border color/style only — the
// stem/branch stays T.text in default+sent so the tree-structure reading
// holds across all states.
//   variant 'default' — bevel pill borders (unsent items)
//   variant 'sent'    — rgba(T.green, 0.4) pill borders
//   variant 'preview' — dashed cat-color pill borders + dashed stem/branch
function _buildModTree(mods, opts) {
  opts = opts || {};
  var variant = opts.variant || 'default';
  var catColor = opts.catColor || T.green;
  var bevelLt = lightenHex(T.bg, 0.08);
  var bevelDk = darkenHex(T.bg, 0.2);

  var tree = document.createElement('div');
  tree.style.cssText = [
    'position:relative;',
    'display:flex;flex-direction:column;gap:3px;',
    'margin-top:4px;margin-left:10px;',
    'padding-left:16px;',
  ].join('');

  // Stem — vertical line down the left of the tree. Stops 12px before the
  // tree bottom so the last branch's horizontal segment terminates the line.
  var stem = document.createElement('div');
  if (variant === 'preview') {
    stem.style.cssText = 'position:absolute;left:5px;top:0;bottom:12px;width:0;border-left:2px dashed ' + T.text + ';';
  } else {
    stem.style.cssText = 'position:absolute;left:6px;top:0;bottom:12px;width:2px;background:' + T.text + ';';
  }
  tree.appendChild(stem);

  mods.forEach(function(mod) {
    var entry = document.createElement('div');
    entry.style.cssText = 'position:relative;display:flex;align-items:center;gap:5px;';

    // Branch — horizontal segment from stem to pill
    var branch = document.createElement('div');
    if (variant === 'preview') {
      branch.style.cssText = 'position:absolute;left:-10px;top:50%;width:10px;height:0;border-top:2px dashed ' + T.text + ';';
    } else {
      branch.style.cssText = 'position:absolute;left:-10px;top:50%;width:10px;height:2px;background:' + T.text + ';';
    }
    entry.appendChild(branch);

    // Pill
    var pill = document.createElement('div');
    var pillStyles = [
      'flex:1;min-width:0;',
      'display:flex;align-items:baseline;justify-content:space-between;gap:6px;',
      'padding:3px 8px;',
      'background:' + T.card + ';',
      'border-radius:6px;',
    ];
    if (variant === 'sent') {
      pillStyles.push('border:1px solid ' + hexToRgba(T.green, 0.4));
    } else if (variant === 'preview') {
      pillStyles.push('border:1px dashed ' + hexToRgba(catColor, 0.6));
    } else {
      pillStyles.push('border-top:1px solid ' + bevelLt);
      pillStyles.push('border-left:1px solid ' + bevelLt);
      pillStyles.push('border-right:1px solid ' + bevelDk);
      pillStyles.push('border-bottom:1px solid ' + bevelDk);
    }
    pill.style.cssText = pillStyles.join(';') + ';';

    var modName = document.createElement('span');
    modName.style.cssText = [
      'font-family:' + T.fb + ';',
      'font-size:' + T.fsB4 + ';',
      'font-style:italic;',
      'color:' + T.text + ';',
      'overflow:hidden;text-overflow:ellipsis;white-space:nowrap;',
      'min-width:0;flex:1;',
    ].join('');
    modName.textContent = mod.name;
    pill.appendChild(modName);

    if (mod.charged && Number(mod.price) > 0) {
      var modPrice = document.createElement('span');
      modPrice.style.cssText = [
        'font-family:' + T.fb + ';',
        'font-size:' + T.fsB4 + ';',
        'font-weight:' + T.fwBold + ';',
        'color:' + T.gold + ';',
        'flex-shrink:0;',
      ].join('');
      modPrice.textContent = '+$' + (Number(mod.price) || 0).toFixed(2);
      pill.appendChild(modPrice);
    }

    entry.appendChild(pill);
    tree.appendChild(entry);
  });

  return tree;
}

function _buildItemSubCard(inst, isMultiSeat) {
  var sent = !!inst.sent;
  var catColor = _catColorForItem(inst);
  var bevelLt = lightenHex(T.bg, 0.08);
  var bevelDk = darkenHex(T.bg, 0.2);

  var modTotal = (inst.mods || []).reduce(function(s, m) { return s + (Number(m.price) || 0); }, 0);
  var totalPrice = (Number(inst.unitPrice) || 0) + modTotal;
  var qty = inst.qty || 1;
  var displayName = qty > 1 ? qty + '× ' + inst.name : inst.name;

  // Wrapper — flex row containing item-block (card + mod tree) + optional
  // chevron column for sent items.
  var wrapper = document.createElement('div');
  wrapper.style.cssText = [
    'display:flex;align-items:stretch;gap:8px;',
    'margin-bottom:5px;',
    isMultiSeat ? 'margin-left:8px;' : '',
  ].join('');

  // Item block — vertical stack of card + (optional) mod tree
  var block = document.createElement('div');
  block.style.cssText = 'flex:1;min-width:0;display:flex;flex-direction:column;';

  // ── Card body ────────────────────────────────────
  var card = document.createElement('div');
  if (sent) {
    // All-4 green border (Mode B treatment from check-overview)
    card.style.cssText = [
      'background:' + T.well + ';',
      'border:2px solid ' + T.green + ';',
      'border-left-width:3px;',
      'border-radius:8px;',
      'padding:6px 10px;',
      'box-shadow:0 2px 0 ' + T.greenDk + ';',
    ].join('');
  } else {
    // Bevel chrome with cat-color left border
    card.style.cssText = [
      'background:' + T.well + ';',
      'border-top:2px solid ' + bevelLt + ';',
      'border-right:2px solid ' + bevelDk + ';',
      'border-bottom:2px solid ' + bevelDk + ';',
      'border-left:3px solid ' + catColor + ';',
      'border-radius:8px;',
      'padding:6px 10px;',
    ].join('');
  }

  // Main row: name + price + (× delete for unsent)
  var mainRow = document.createElement('div');
  mainRow.style.cssText = 'display:flex;align-items:center;gap:6px;';

  var nameEl = document.createElement('span');
  nameEl.style.cssText = [
    'font-family:' + T.fb + ';',
    'font-weight:' + T.fwBold + ';',
    'font-size:' + T.fsB3 + ';',
    'color:' + T.text + ';',
    'flex:1;min-width:0;',
    'overflow:hidden;text-overflow:ellipsis;white-space:nowrap;',
  ].join('');
  nameEl.textContent = displayName;
  mainRow.appendChild(nameEl);

  var priceEl = document.createElement('span');
  priceEl.style.cssText = [
    'font-family:' + T.fb + ';',
    'font-weight:' + T.fwBold + ';',
    'font-size:' + T.fsB3 + ';',
    'color:' + T.gold + ';',
    'flex-shrink:0;',
  ].join('');
  priceEl.textContent = _fmtPrice(totalPrice);
  mainRow.appendChild(priceEl);

  if (!sent) {
    var xBtn = document.createElement('div');
    xBtn.style.cssText = [
      'width:22px;height:22px;flex-shrink:0;',
      'display:flex;align-items:center;justify-content:center;',
      'border-radius:4px;background:' + T.verm + ';',
      'color:#fff;font-family:' + T.fb + ';font-size:15px;font-weight:' + T.fwBold + ';',
      'cursor:pointer;pointer-events:auto;touch-action:manipulation;',
    ].join('');
    xBtn.textContent = '×';
    xBtn.addEventListener('pointerup', (function(instance) {
      return function(e) {
        e.stopPropagation();
        var idx = ticket.indexOf(instance);
        if (idx !== -1) ticket.splice(idx, 1);
        delete _expandedItems[instance.id];
        renderTicket();
        rebuildBottomBar();
      };
    })(inst));
    mainRow.appendChild(xBtn);
  }

  card.appendChild(mainRow);
  block.appendChild(card);

  // ── Mod tree below card ──────────────────────────
  if ((inst.mods || []).length > 0) {
    block.appendChild(_buildModTree(inst.mods, {
      variant: sent ? 'sent' : 'default',
      catColor: catColor,
    }));
  }

  wrapper.appendChild(block);

  // ── Sent: chevron column to right ────────────────
  if (sent) {
    var chevCol = document.createElement('div');
    chevCol.style.cssText = [
      'flex:0 0 auto;min-width:48px;',
      'display:flex;flex-direction:column;',
      'align-items:center;justify-content:center;',
      'padding-left:4px;gap:4px;',
    ].join('');

    var chev = document.createElement('span');
    chev.style.cssText = [
      'font-family:' + T.fb + ';',
      'font-weight:' + T.fwBold + ';',
      'font-size:18px;',
      'color:' + T.green + ';',
      'letter-spacing:0.08em;line-height:1;',
    ].join('');
    chev.textContent = '>>>';
    chevCol.appendChild(chev);

    if (inst.sent_at) {
      var stamp = document.createElement('span');
      stamp.style.cssText = [
        'font-family:' + T.fb + ';',
        'font-size:11px;',
        'color:' + T.text + ';',
        'font-style:italic;',
      ].join('');
      stamp.textContent = inst.sent_at;
      chevCol.appendChild(stamp);
    }

    wrapper.appendChild(chevCol);
  }

  return wrapper;
}

function renderTicket() {
  if (SceneManager.getActiveWorking() !== 'order-entry') return;
  var list = document.getElementById('ticket-list');
  if (!list) return;
  list.innerHTML = '';

  // In check-overview mode, only show unsent items
  var displayTicket = ticket;
  if (sceneParams.returnScene === 'check-overview') {
    displayTicket = ticket.filter(function(inst) { return !inst.sent; });
  }

  // Filter to items whose seat_number is in _activeSeats
  if (_activeSeats.size > 0) {
    displayTicket = displayTicket.filter(function(inst) {
      return _activeSeats.has(inst.seat_number);
    });
  }

  if (displayTicket.length === 0 && !_modPanelItem) {
    var hint = document.createElement('div');
    hint.style.cssText = 'padding:20px 8px;font-family:' + T.fb + ';font-size:' + T.fsB3 + ';color:' + hexToRgba(T.text, 0.6) + ';text-align:center;';
    hint.textContent = 'Tap items to add';
    list.appendChild(hint);
    _appendModPreview(list);
    _updateTicketTotals(displayTicket);
    return;
  }

  if (_activeSeats.size > 1) {
    // Multi-seat: each seat rendered as collapsible s-card
    // (matches check-overview Mode B). Default state is open;
    // _collapsedSeats tracks any user-collapsed seats.
    var bevelDk = darkenHex(T.bg, 0.2);
    var seatOrder = Array.from(_activeSeats).sort(function(a, b) { return a - b; });
    seatOrder.forEach(function(sn) {
      var seatItems = displayTicket.filter(function(i) { return i.seat_number === sn; });
      var seatSubtotal = seatItems.reduce(function(s, i) {
        return s + (Number(i.unitPrice) || 0) + (i.mods || []).reduce(function(ms, m) { return ms + (Number(m.price) || 0); }, 0);
      }, 0);
      var isOpen = !_collapsedSeats.has(sn);

      var sCard = document.createElement('div');
      sCard.style.cssText = [
        'border-bottom:1px solid ' + bevelDk + ';',
        'border-left:3px solid ' + T.green + ';',
        'margin-bottom:5px;',
      ].join('');

      var sHdr = document.createElement('div');
      sHdr.style.cssText = [
        'display:flex;align-items:baseline;justify-content:space-between;',
        'padding:8px 12px;background:' + T.well + ';',
        'cursor:pointer;user-select:none;',
        'pointer-events:auto;touch-action:manipulation;',
      ].join('');

      var sHdrLeft = document.createElement('div');
      sHdrLeft.style.cssText = 'display:flex;align-items:baseline;gap:8px;';
      var sNum = document.createElement('span');
      sNum.style.cssText = 'font-family:' + T.fh + ';font-weight:' + T.fwBold + ';font-size:20px;color:' + T.green + ';';
      sNum.textContent = 'S' + sn;
      var sSbtl = document.createElement('span');
      sSbtl.style.cssText = 'font-family:' + T.fb + ';font-weight:' + T.fwBold + ';font-size:' + T.fsB4 + ';color:' + T.gold + ';';
      sSbtl.textContent = _fmtPrice(seatSubtotal);
      sHdrLeft.appendChild(sNum);
      sHdrLeft.appendChild(sSbtl);
      sHdr.appendChild(sHdrLeft);

      var sChev = document.createElement('span');
      sChev.style.cssText = [
        'font-family:' + T.fb + ';font-size:16px;color:' + T.moon + ';',
        'transition:transform 0.15s;display:inline-block;',
        'transform:' + (isOpen ? 'rotate(90deg)' : 'rotate(0deg)') + ';',
      ].join('');
      sChev.textContent = '▸';
      sHdr.appendChild(sChev);

      sHdr.addEventListener('pointerup', (function(seatNum) {
        return function() {
          if (_collapsedSeats.has(seatNum)) _collapsedSeats.delete(seatNum);
          else _collapsedSeats.add(seatNum);
          renderTicket();
        };
      })(sn));

      sCard.appendChild(sHdr);

      var itemsWrap = document.createElement('div');
      itemsWrap.style.cssText = [
        'overflow:hidden;',
        'max-height:' + (isOpen ? '5000px' : '0') + ';',
        'transition:max-height 0.2s ease;',
      ].join('');

      var itemsInner = document.createElement('div');
      itemsInner.style.cssText = 'padding:6px 8px 8px;display:flex;flex-direction:column;';

      seatItems.forEach(function(inst) {
        itemsInner.appendChild(_buildItemSubCard(inst, false));
      });

      itemsWrap.appendChild(itemsInner);
      sCard.appendChild(itemsWrap);
      list.appendChild(sCard);
    });
  } else {
    // Single seat — items render flush, no header
    displayTicket.forEach(function(inst) {
      list.appendChild(_buildItemSubCard(inst, false));
    });
  }

  _appendModPreview(list);
  _updateTicketTotals(displayTicket);
}

function _appendModPreview(list) {
  if (!_modPanelItem) return;
  // Remove ALL stale previews (may lack data-mod-preview from interrupted renders)
  var children = list.children;
  for (var ri = children.length - 1; ri >= 0; ri--) {
    if (children[ri].textContent.indexOf('\u270E') !== -1) {
      list.removeChild(children[ri]);
    }
  }

  var previewMods = (_modPanelItem.mods || []);
  var previewModTotal = previewMods.reduce(function(s, m) { return s + Number(m.price || 0); }, 0);
  var previewPrice = (_modPanelItem.basePrice || 0) + previewModTotal;
  var catColor = _modPanelCatColor || T.green;
  var fsMod = T.fsB3;

  // ── Wrapper: dashed cat-color border on all 4 sides, transparent fill,
  // marker text (\u270E pencil) inside the name so renderTicket can scrub
  // stale previews on next pass. Price stays gold per money rule.
  var pc = document.createElement('div');
  pc.setAttribute('data-mod-preview', '1');
  pc.style.cssText = [
    'flex-shrink:0;margin-bottom:5px;',
    'background:' + T.well + ';',
    'border:1.5px dashed ' + catColor + ';',
    'border-radius:8px;',
    'padding:6px 10px;',
  ].join('');

  // Main row: pencil + name + price
  var pRow = document.createElement('div');
  pRow.style.cssText = 'display:flex;align-items:center;gap:6px;';
  var pName = document.createElement('span');
  pName.style.cssText = [
    'font-family:' + T.fb + ';',
    'font-weight:' + T.fwBold + ';',
    'font-size:' + T.fsB3 + ';',
    'color:' + T.text + ';',
    'flex:1;min-width:0;',
    'overflow:hidden;text-overflow:ellipsis;white-space:nowrap;',
  ].join('');
  pName.textContent = '\u270E ' + _modPanelItem.itemLabel;
  var pPrice = document.createElement('span');
  pPrice.style.cssText = [
    'font-family:' + T.fb + ';',
    'font-weight:' + T.fwBold + ';',
    'font-size:' + T.fsB3 + ';',
    'color:' + T.gold + ';',
    'flex-shrink:0;',
  ].join('');
  pPrice.textContent = '$' + previewPrice.toFixed(2);
  pRow.appendChild(pName);
  pRow.appendChild(pPrice);
  pc.appendChild(pRow);

  // Partition into whole / left / right
  var wholeMods = [];
  var leftMods = [];
  var rightMods = [];
  for (var pi = 0; pi < previewMods.length; pi++) {
    var pm = previewMods[pi];
    if (pm.prefix === 'Left') leftMods.push(pm);
    else if (pm.prefix === 'Right') rightMods.push(pm);
    else wholeMods.push(pm);
  }

  // Whole mods → preview-variant mod tree (dashed cat-color pills + dashed stem/branch)
  if (wholeMods.length > 0) {
    pc.appendChild(_buildModTree(wholeMods, { variant: 'preview', catColor: catColor }));
    // Exclusion children (e.g. "NO Ketchup" under "ADD Cheeseburger")
    // — preserved from legacy preview; rendered as italic verm rows below the tree.
    wholeMods.forEach(function(m) {
      if (m.children && m.children.length > 0) {
        m.children.forEach(function(child) {
          var childRow = document.createElement('div');
          childRow.style.cssText = [
            'margin-left:36px;padding:2px 8px;',
            'font-family:' + T.fb + ';font-size:' + T.fsB4 + ';',
            'font-style:italic;color:' + T.verm + ';',
          ].join('');
          childRow.textContent = child.name;
          pc.appendChild(childRow);
        });
      }
    });
  }

  // Half-table for pizza left/right mods — preserved as-is; the placement UX
  // doesn't have a clean tree-pattern equivalent yet, so it lives outside
  // the new mod-tree treatment for now.
  if (leftMods.length > 0 || rightMods.length > 0) {
    var inst = { sent: false, mods: _modPanelItem.mods };
    pc.appendChild(buildHalfTable(leftMods, rightMods, fsMod, inst));
  }

  list.appendChild(pc);
}

function _updateTicketTotals(filteredTicket) {
  // When a filtered view is active, compute totals from visible items only.
  var subtotal = 0;
  var src = filteredTicket || ticket;
  src.forEach(function(inst) {
    var modTotal = (inst.mods || []).reduce(function(s, m) { return s + (Number(m.price) || 0); }, 0);
    subtotal += (Number(inst.unitPrice) || 0) + modTotal;
  });
  if (_modPanelItem) {
    var previewMods = (_modPanelItem.mods || []);
    var previewModTotal = previewMods.reduce(function(s, m) { return s + (Number(m.price) || 0); }, 0);
    subtotal += (_modPanelItem.basePrice || 0) + previewModTotal;
  }
  var t = computeTotals(subtotal);
  OrderSummary.update({
    checkId: currentCheckNumber || '',
    skipItems: true,
    subtotal: t.subtotal,
    tax: t.tax,
    cardTotal: t.cardTotal,
    cashPrice: t.cashPrice,
    totalsMode: 'building',
  });
}

// ── Swipe-to-delete wrapper ──────────────────────
function _wrapSwipeDelete(innerEl, onDelete) {
  var THRESHOLD = 60;
  var BTN_W = 70;

  var wrap = document.createElement('div');
  wrap.style.cssText = 'position:relative;overflow:hidden;flex-shrink:0;';

  // Delete button behind
  var delBtn = document.createElement('div');
  delBtn.style.cssText = 'position:absolute;right:0;top:0;bottom:0;width:' + BTN_W + 'px;display:flex;align-items:center;justify-content:center;background:' + T.verm + ';color:' + T.text + ';font-family:' + T.fh + ';font-size:' + T.fsB3 + ';letter-spacing:1px;cursor:pointer;user-select:none;';
  delBtn.textContent = 'DELETE';
  wrap.appendChild(delBtn);

  // Inner content on top
  innerEl.style.position = 'relative';
  innerEl.style.zIndex = '1';
  innerEl.style.transition = 'transform 150ms ease-out';
  wrap.appendChild(innerEl);

  var startX = 0;
  var currentX = 0;
  var swiping = false;
  var revealed = false;

  innerEl.addEventListener('pointerdown', function(e) {
    startX = e.clientX;
    currentX = 0;
    swiping = true;
    innerEl.style.transition = 'none';
  });

  innerEl.addEventListener('pointermove', function(e) {
    if (!swiping) return;
    var dx = e.clientX - startX;
    if (dx > 0) dx = 0; // no right swipe
    if (dx < -BTN_W) dx = -BTN_W;
    currentX = dx;
    innerEl.style.transform = 'translateX(' + dx + 'px)';
  });

  innerEl.addEventListener('pointerup', function() {
    if (!swiping) return;
    swiping = false;
    innerEl.style.transition = 'transform 150ms ease-out';
    if (currentX < -THRESHOLD) {
      // Reveal delete
      innerEl.style.transform = 'translateX(-' + BTN_W + 'px)';
      revealed = true;
    } else {
      innerEl.style.transform = 'translateX(0)';
      revealed = false;
    }
  });

  innerEl.addEventListener('pointerleave', function() {
    if (!swiping) return;
    swiping = false;
    innerEl.style.transition = 'transform 150ms ease-out';
    if (currentX < -THRESHOLD) {
      innerEl.style.transform = 'translateX(-' + BTN_W + 'px)';
      revealed = true;
    } else {
      innerEl.style.transform = 'translateX(0)';
      revealed = false;
    }
  });

  delBtn.addEventListener('pointerup', function() {
    onDelete();
  });

  return wrap;
}


// ── SEPARATOR + MOD ROW helpers ───────────────────
function buildSeparator() {
  var sep = document.createElement('div');
  sep.style.cssText = 'padding:0 8px;font-family:' + T.fb + ';font-size:' + T.fsB3 + ';color:' + T.greenDk + ';letter-spacing:2px;overflow:hidden;white-space:nowrap;line-height:1;';
  sep.textContent = '- - - - - - - - - - - - - - - - - -';
  return sep;
}

function buildModRow(name, price, dark, showPrice) {
  var row = document.createElement('div');
  row.style.cssText = [
    'display:flex;justify-content:space-between;',
    'padding:2px 8px 2px 20px;',
    'font-family:' + T.fb + ';font-size:' + T.fsB3 + ';font-weight:bold;',
    'color:' + (dark ? T.well : T.gold) + ';',
  ].join('');
  var n = document.createElement('span');
  n.textContent = name;
  var p = document.createElement('span');
  p.textContent = price > 0 ? '+$' + price.toFixed(2) : '$0.00';
  row.appendChild(n);
  row.appendChild(p);
  return row;
}

function buildModRowSized(name, price, fontSize, onRemove) {
  var row = document.createElement('div');
  row.style.cssText = [
    'display:flex;align-items:center;',
    'padding:1px 8px 1px 16px;',
    'font-family:' + T.fb + ';font-size:' + fontSize + ';font-weight:bold;',
    'color:' + T.green + ';',
  ].join('');
  // Remove button (shown for unsent items)
  if (onRemove) {
    var x = document.createElement('span');
    x.style.cssText = [
      'flex-shrink:0;width:22px;height:22px;margin-right:4px;',
      'display:flex;align-items:center;justify-content:center;',
      'font-size:14px;color:' + T.verm + ';cursor:pointer;',
      'border:1px solid ' + T.verm + ';clip-path:polygon(3px 0%,calc(100% - 3px) 0%,100% 3px,100% calc(100% - 3px),calc(100% - 3px) 100%,3px 100%,0% calc(100% - 3px),0% 3px);',
    ].join('');
    x.textContent = '\u2715';
    x.addEventListener('pointerup', function(e) {
      e.stopPropagation();
      onRemove();
    });
    row.appendChild(x);
  }
  var n = document.createElement('span');
  n.style.cssText = 'flex:1;';
  n.textContent = name;
  var p = document.createElement('span');
  p.style.cssText = 'flex-shrink:0;color:' + T.gold + ';';
  p.textContent = price > 0 ? '+$' + price.toFixed(2) : '';
  row.appendChild(n);
  if (price > 0) row.appendChild(p);
  return row;
}

function buildHalfTable(leftMods, rightMods, fontSize, removableInst) {
  var table = document.createElement('div');
  table.style.cssText = 'padding:2px 8px;';

  // Divider
  var divTop = document.createElement('div');
  divTop.style.cssText = 'display:flex;border-bottom:1px solid ' + T.greenDk + ';margin-bottom:1px;';
  var hdrL = document.createElement('div');
  hdrL.style.cssText = 'flex:1;font-family:' + T.fb + ';font-size:' + fontSize + ';font-weight:bold;color:' + T.gold + ';text-align:center;';
  hdrL.textContent = '1ST';
  var hdrSep = document.createElement('div');
  hdrSep.style.cssText = 'width:1px;background:' + T.greenDk + ';margin:0 4px;';
  var hdrR = document.createElement('div');
  hdrR.style.cssText = 'flex:1;font-family:' + T.fb + ';font-size:' + fontSize + ';font-weight:bold;color:' + T.gold + ';text-align:center;';
  hdrR.textContent = '2ND';
  divTop.appendChild(hdrL);
  divTop.appendChild(hdrSep);
  divTop.appendChild(hdrR);
  table.appendChild(divTop);

  function _makeRemoveBtn(mod) {
    var x = document.createElement('span');
    x.style.cssText = [
      'flex-shrink:0;width:18px;height:18px;margin:0 2px;',
      'display:inline-flex;align-items:center;justify-content:center;',
      'font-size:11px;color:' + T.verm + ';cursor:pointer;',
      'border:1px solid ' + T.verm + ';clip-path:polygon(3px 0%,calc(100% - 3px) 0%,100% 3px,100% calc(100% - 3px),calc(100% - 3px) 100%,3px 100%,0% calc(100% - 3px),0% 3px);',
    ].join('');
    x.textContent = '\u2715';
    x.addEventListener('pointerup', function(e) {
      e.stopPropagation();
      var mi = removableInst.mods.indexOf(mod);
      if (mi !== -1) removableInst.mods.splice(mi, 1);
      renderTicket();
      rebuildBottomBar();
    });
    return x;
  }

  // Rows — zip left and right
  var maxRows = Math.max(leftMods.length, rightMods.length);
  for (var i = 0; i < maxRows; i++) {
    var row = document.createElement('div');
    row.style.cssText = 'display:flex;align-items:center;';

    var cellL = document.createElement('div');
    cellL.style.cssText = 'flex:1;display:flex;align-items:center;font-family:' + T.fb + ';font-size:' + fontSize + ';color:' + T.green + ';padding:0 4px;';
    if (removableInst && leftMods[i]) cellL.appendChild(_makeRemoveBtn(leftMods[i]));
    var lText = document.createElement('span');
    lText.textContent = leftMods[i] ? stripPlacementPrefix(leftMods[i].name) : '';
    cellL.appendChild(lText);

    if (leftMods[i] && leftMods[i].priceDelta) {
      var lp = leftMods[i].priceDelta;
      var lpRow = buildDataRow('', (lp > 0 ? '+$' : '-$') + Math.abs(lp).toFixed(2), T.gold);
      lpRow.style.flex = '1';
      lpRow.style.border = 'none';
      lpRow.style.padding = '0 0 0 8px';
      cellL.appendChild(lpRow);
    }

    var sep = document.createElement('div');
    sep.style.cssText = 'width:1px;align-self:stretch;background:' + T.greenDk + ';margin:0 4px;flex-shrink:0;';

    var cellR = document.createElement('div');
    cellR.style.cssText = 'flex:1;display:flex;align-items:center;justify-content:flex-end;font-family:' + T.fb + ';font-size:' + fontSize + ';color:' + T.green + ';padding:0 4px;';

    if (rightMods[i] && rightMods[i].priceDelta) {
      var rp = rightMods[i].priceDelta;
      var rpRow = buildDataRow('', (rp > 0 ? '+$' : '-$') + Math.abs(rp).toFixed(2), T.gold);
      rpRow.style.flex = '1';
      rpRow.style.border = 'none';
      rpRow.style.padding = '0 8px 0 0';
      cellR.appendChild(rpRow);
    }

    var rText = document.createElement('span');
    rText.textContent = rightMods[i] ? stripPlacementPrefix(rightMods[i].name) : '';
    cellR.appendChild(rText);
    if (removableInst && rightMods[i]) cellR.appendChild(_makeRemoveBtn(rightMods[i]));

    row.appendChild(cellL);
    row.appendChild(sep);
    row.appendChild(cellR);
    table.appendChild(row);

    // Render children (exclusions) for specials in half-table
    var lChildren = (leftMods[i] && leftMods[i].children) ? leftMods[i].children : [];
    var rChildren = (rightMods[i] && rightMods[i].children) ? rightMods[i].children : [];
    var maxChildren = Math.max(lChildren.length, rChildren.length);
    for (var ci = 0; ci < maxChildren; ci++) {
      var cRow = document.createElement('div');
      cRow.style.cssText = 'display:flex;align-items:center;';
      var cL = document.createElement('div');
      cL.style.cssText = 'flex:1;font-family:' + T.fb + ';font-size:' + (parseInt(fontSize) - 4) + 'px;color:' + T.verm + ';font-style:italic;padding:0 4px 0 20px;';
      cL.textContent = lChildren[ci] ? lChildren[ci].name : '';
      var cSep = document.createElement('div');
      cSep.style.cssText = 'width:1px;align-self:stretch;background:' + T.greenDk + ';margin:0 4px;flex-shrink:0;';
      var cR = document.createElement('div');
      cR.style.cssText = 'flex:1;font-family:' + T.fb + ';font-size:' + (parseInt(fontSize) - 4) + 'px;color:' + T.verm + ';font-style:italic;padding:0 4px 0 20px;text-align:right;';
      cR.textContent = rChildren[ci] ? rChildren[ci].name : '';
      cRow.appendChild(cL);
      cRow.appendChild(cSep);
      cRow.appendChild(cR);
      table.appendChild(cRow);
    }
  }

  // Bottom divider
  var divBot = document.createElement('div');
  divBot.style.cssText = 'border-top:1px solid ' + T.greenDk + ';margin-top:1px;';
  table.appendChild(divBot);

  return table;
}

function stripPlacementPrefix(name) {
  return name;
}

// ── QUANTITY EDITOR ─────────────────────────────
function showQtyEditor(itemName, instances) {
  SceneManager.interrupt('qty-edit', {
    onConfirm: function(newQty) {
      var currentQty = instances.length;
      if (newQty === currentQty || newQty < 1) return;
      if (newQty > currentQty) {
        // Add more instances (clone from first)
        var template = instances[0];
        for (var i = 0; i < newQty - currentQty; i++) {
          ticket.push({
            id:        ++ticketSeq,
            menu_item_id: template.menu_item_id,
            idemKey:   _idemKey(),
            name:      template.name,
            unitPrice: template.unitPrice,
            mods:      template.mods.map(function(m) { return { name: m.name, price: m.price, charged: m.charged, prefix: m.prefix }; }),
            selected:  false,
            sent:      false,
            category:  template.category,
            seat_number: template.seat_number,
          });
        }
      } else {
        // Remove from the end (unsent only)
        var toRemove = currentQty - newQty;
        for (var j = instances.length - 1; j >= 0 && toRemove > 0; j--) {
          var idx = ticket.indexOf(instances[j]);
          if (idx !== -1) { ticket.splice(idx, 1); toRemove--; }
        }
      }
      renderTicket();
      rebuildBottomBar();
    },
    onCancel: function() {},
    params: { itemName: itemName, currentQty: instances.length },
  });
}

function _buildItemPayload(inst) {
  var payload = {
    menu_item_id: inst.menu_item_id || inst.name.toLowerCase().replace(/\s+/g, '_'),
    name:         inst.name,
    price:        Number(inst.unitPrice) || 0,
    quantity:     1,
    category:     inst.category || 'general',
    seat_number:  inst.seat_number || 1,
    modifiers:    inst.mods.map(function(m) {
      return {
        name: m.name, price: m.price, modifier_price: m.price,
        charged: m.charged, prefix: m.prefix || null,
        half_price: m.half_price != null ? m.half_price : null,
      };
    }),
  };

  // Include modifier panel data for atomic ledger write (ORDER_ITEM_ADDED)
  if (inst._modPanelData) {
    var mpd = inst._modPanelData;
    // Backend expects list[str] ("{group_id}:{option_key}"); mpd.mandatory
    // is the terminal-side object map {group_id: {key,label,price}}. Flatten
    // so the ledger can audit which groups were picked without losing the
    // group→choice mapping. Label/price already ride along in `modifiers[]`.
    var mand = mpd.mandatory;
    if (mand && typeof mand === 'object' && !Array.isArray(mand)) {
      payload.mandatory_selections = Object.keys(mand).map(function(gid) {
        var sel = mand[gid];
        var key = (sel && sel.key) || '';
        return gid + ':' + key;
      });
    } else {
      payload.mandatory_selections = mand || [];
    }
    payload.included_removals = mpd.includedRemovals;
    payload.allergens = mpd.allergens;
    payload.allergen_note = mpd.allergenNote || '';
    payload.note = mpd.note || '';
    payload.optional_modifiers = mpd.optionalModifiers.map(function(m) {
      return { prefix: m.prefix, modifier_id: m.modifierId, label: m.label, price: m.price };
    });
  }

  console.log('POST payload:', payload);
  return payload;
}

async function handleSaveOnly() {
  if (ticket.length === 0) return;
  if (isSending) return;

  var unsentInstances = ticket.filter(function(inst) { return !inst.sent; });
  if (unsentInstances.length === 0) return;

  setSending(true);

  try {
    // Step 1 — create order if needed
    if (!currentOrderId) {
      if (!createOrderIdemKey) createOrderIdemKey = _idemKey();
      var createRes = await fetchWithTimeout(API + '/orders', {
        method: 'POST',
        headers: {
          'Content-Type':    'application/json',
          'Idempotency-Key': createOrderIdemKey,
        },
        body: JSON.stringify({
          guest_count:   (sceneParams.seatNumbers && sceneParams.seatNumbers.length) || 1,
          seat_numbers:  sceneParams.seatNumbers || null,
          customer_name: null,
          server_id:     sceneParams.employeeId || null,
          server_name:   sceneParams.employeeName || null,
        }),
      }, 15000);
      if (!createRes.ok) throw new Error('Order create failed: ' + createRes.status);
      var created = await createRes.json();
      if (!created || !created.order_id) throw new Error('Invalid order response — missing order_id');
      currentOrderId = created.order_id;
      currentCheckNumber = created.check_number;
    }

    // Step 2 — post unsent items (seat already assigned per-item).
    // Skip items with a backendItemId: they were saved in a prior session and
    // already exist on the backend — re-posting with a new idemKey would create
    // duplicates when the user later calls handleSend.
    var itemPromises = [];
    for (var ui = 0; ui < unsentInstances.length; ui++) {
      var inst = unsentInstances[ui];
      if (inst.backendItemId) continue;
      itemPromises.push({ inst: inst, promise: fetchWithTimeout(API + '/orders/' + currentOrderId + '/items', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Idempotency-Key': inst.idemKey || _idemKey() },
        body: JSON.stringify(_buildItemPayload(inst)),
      }, 15000)});
    }
    if (itemPromises.length === 0) return;
    var results = await Promise.allSettled(itemPromises.map(function(p) { return p.promise; }));
    var anyFailed = false;
    results.forEach(function(r, idx) {
      if (r.status !== 'fulfilled' || !r.value.ok) {
        anyFailed = true;
      }
      // Do NOT mark sent:true — items are saved to the order but have not
      // been fired to the kitchen (sent_at is null on the backend).
      // Keeping sent:false means a subsequent SEND will include them
      // intentionally rather than silently firing them via /send.
    });
    if (anyFailed) throw new Error('Some items failed to save');

    showToast('Items saved', { bg: T.greenWarm, duration: 1500 });
    if (currentOrderId) SceneManager.emit('order:updated', { orderId: currentOrderId });
  } catch (err) {
    console.warn('[KINDpos] Save failed:', err);
    showToast('Save failed', { bg: T.verm });
    throw err;
  } finally {
    setSending(false);
  }
}

async function handleSend() {
  if (ticket.length === 0) return;
  if (isSending) return;

  var unsentInstances = ticket.filter(function(inst) { return !inst.sent; });

  // All items already sent — resend to kitchen only
  if (unsentInstances.length === 0 && currentOrderId) {
    setSending(true);
    try {
      await fetchWithTimeout(API + '/orders/' + currentOrderId + '/send', { method: 'POST' }, 15000);
      fetchWithTimeout(API + '/print/ticket/' + currentOrderId, { method: 'POST' }, 15000)
        .then(function(r) { if (!r.ok) throw new Error('HTTP ' + r.status); })
        .catch(function(err) {
          console.warn('[KINDpos] Kitchen print failed:', err);
          showToast('Kitchen ticket print failed — check printer');
        });
      showToast('Resent to kitchen', { bg: T.greenWarm, duration: 2000 });
    } catch (err) {
      console.warn('[KINDpos] Resend failed:', err);
      showToast('Resend failed', { bg: T.verm, duration: 2000 });
    } finally {
      setSending(false);
    }
    return;
  }

  setSending(true);
  var totals = computeTicketTotals();

  try {
    // Step 1 — create order on first send, reuse on subsequent sends
    if (!currentOrderId) {
      if (!createOrderIdemKey) createOrderIdemKey = _idemKey();
      var createRes = await fetchWithTimeout(API + '/orders', {
        method: 'POST',
        headers: {
          'Content-Type':    'application/json',
          'Idempotency-Key': createOrderIdemKey,
        },
        body: JSON.stringify({
          guest_count:   (sceneParams.seatNumbers && sceneParams.seatNumbers.length) || 1,
          seat_numbers:  sceneParams.seatNumbers || null,
          customer_name: null,
          server_id:     sceneParams.employeeId || null,
          server_name:   sceneParams.employeeName || null,
        }),
      }, 15000);
      if (!createRes.ok) throw new Error('Order create failed: ' + createRes.status);
      var created = await createRes.json();
      if (!created || !created.order_id) throw new Error('Invalid order response — missing order_id');
      currentOrderId = created.order_id;   // use the backend-generated ID
      currentCheckNumber = created.check_number;
    }

    // Step 2 — post unsent instances (seat already assigned per-item).
    // Skip items with a backendItemId: they were saved in a prior session and
    // already exist on the backend. Re-posting with a new idemKey would create
    // duplicates. The /send call in step 3 fires them to the kitchen regardless.
    var itemPromises = [];
    for (var ui = 0; ui < unsentInstances.length; ui++) {
      var inst = unsentInstances[ui];
      if (inst.backendItemId) continue;
      itemPromises.push({ inst: inst, promise: fetchWithTimeout(API + '/orders/' + currentOrderId + '/items', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Idempotency-Key': inst.idemKey || _idemKey() },
        body: JSON.stringify(_buildItemPayload(inst)),
      }, 15000)});
    }
    var results = await Promise.allSettled(itemPromises.map(function(p) { return p.promise; }));
    var anyFailed = false;
    results.forEach(function(r, idx) {
      if (r.status === 'fulfilled' && r.value.ok) {
        itemPromises[idx].inst.sent = true;
      } else {
        anyFailed = true;
        console.warn('[KINDpos] Item POST failed:', itemPromises[idx].inst.name,
          r.status === 'rejected' ? r.reason : 'HTTP ' + r.value.status);
      }
    });
    if (anyFailed) {
      renderTicket();
      throw new Error('Some items failed to send');
    }

    // Step 3 — send to kitchen + trigger kitchen ticket print. Must check
    // r.ok: fetch resolves for 4xx/5xx too, so without this guard a 500
    // here would let us fall through to line 3586 and mark every item
    // `sent` even though kitchen never got them — UI and ledger diverge.
    var sendRes = await fetchWithTimeout(API + '/orders/' + currentOrderId + '/send', { method: 'POST' }, 15000);
    if (!sendRes.ok) {
      renderTicket();
      throw new Error('Send to kitchen failed: HTTP ' + sendRes.status);
    }

    // Mark remaining items as sent (order-level confirmation)
    ticket.forEach(function(inst) { inst.sent = true; });

    // Fire kitchen print — non-blocking, dispatcher handles retry
    fetchWithTimeout(API + '/print/ticket/' + currentOrderId, { method: 'POST' }, 15000)
      .then(function(r) { if (!r.ok) throw new Error('HTTP ' + r.status); })
      .catch(function(err) {
        console.warn('[KINDpos] Kitchen print failed:', err);
        showToast('Kitchen ticket print failed — check printer');
      });

  } catch (err) {
    console.warn('[KINDpos] Send failed:', err);
    throw err;
  } finally {
    setSending(false);
  }

  // Update UI — SEND becomes RESEND, ticket shows sent state
  renderTicket();
  rebuildBottomBar();

  // Notify other scenes (server-landing, etc.) that this check just
  // changed state so any subscribed tile refreshes.
  if (currentOrderId) SceneManager.emit('order:updated', { orderId: currentOrderId });

  // Reset hex nav — ticket stays visible for PAY

}

// ── CLOSE (X button) ────────────────────────────
// Auto-saves unsent items before navigating. Any items the server typed
// are persisted to the backend (without kitchen-send) so they survive
// BACK, logout, or an unexpected scene swap.
async function handleClose() {
  var hasUnsent = ticket.some(function(inst) { return !inst.sent; });
  if (hasUnsent) {
    try {
      await handleSaveOnly();
    } catch (err) {
      // Swallow — user's intent is to leave; surface a soft warning so
      // they know work MAY be unsaved but don't block navigation.
      console.warn('[KINDpos] Auto-save on close failed:', err);
      showToast('Items may not have saved — check the order', { bg: T.verm, duration: 2500 });
    }
  }
  OrderSummary.hide();
  // Param shape lives in scenes/transitions.js so the order-entry and
  // check-overview sides of the handoff share one source of truth.
  SceneManager.mountWorking('check-overview', buildCheckOverviewParams(currentOrderId, sceneParams));
}

// ── RECALL FROM BACKEND (open saved check) ──────
function recallFromBackend(orderId) {
  // 15s abort guard matches handleSend/handleSaveOnly. Without it, a
  // hung backend on scene entry leaves the ticket list blank forever
  // with no error surfaced.
  fetchWithTimeout(API + '/orders/' + orderId, {}, 15000)
    .then(function(r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    })
    .then(function(order) {
      if (SceneManager.getActiveWorking() !== 'order-entry') return;
      currentOrderId = order.order_id;
      currentCheckNumber = order.check_number || null;
      if (currentCheckNumber) {
        OrderSummary.update({ checkId: currentCheckNumber });
      }

      // Convert backend items to frontend ticket format.
      // Backend Decimals serialize as JSON strings ("12.50"), so every
      // price field arriving here is a string. Coerce to Number at the
      // boundary — downstream code (renderTicket, sending, totals) all
      // assume numeric prices and `.toFixed()` them.
      ticket = (order.items || []).filter(function(item) {
        return !item.voided;
      }).map(function(item) {
        ticketSeq += 1;
        // Prefer server-computed effective_price (post-mods/discounts);
        // base `price` is 0 for combos/pizzas where value lives in mods.
        var rawUnit = item.effective_price != null ? item.effective_price : item.price;
        var unit = Number(rawUnit);
        if (!Number.isFinite(unit)) unit = 0;
        return {
          id:           ticketSeq,
          backendItemId: item.item_id,  // prevents re-POST on subsequent handleSend/handleSaveOnly
          menu_item_id: item.menu_item_id,
          idemKey:      _idemKey(),
          name:      item.name,
          unitPrice: unit,
          mods:      (item.modifiers || []).map(function(m) {
            var rawPrice = m.modifier_price != null ? m.modifier_price : m.price;
            var p = Number(rawPrice);
            if (!Number.isFinite(p)) p = 0;
            return {
              name:       m.name,
              price:      p,
              charged:    (m.prefix !== 'NO') && p > 0,
              prefix:     m.prefix || null,
              half_price: m.half_price != null ? m.half_price : null,
            };
          }),
          selected:  false,
          sent:      !!(item.sent_at),  // true only if actually kitchen-fired
          category:  item.category || null,
          seat_number: item.seat_number || null,
        };
      });

      renderTicket();
      rebuildBottomBar();

      // Populate the left panel with the existing check's sent items so the
      // cashier can see what's already on the check while adding new ones.
      // All recalled items are sent:true (set above). Filter to the selected
      // seat when exactly one seat was chosen before entering add-items mode.
      if (sceneParams.returnScene === 'check-overview') {
        var selSeats = sceneParams.selectedSeatNumbers || [];
        var sentItems = ticket;

        if (selSeats.length === 1) {
          sentItems = sentItems.filter(function(i) {
            return i.seat_number === selSeats[0];
          });
        }

        var leftItems = [];
        if (selSeats.length !== 1 && sentItems.length > 0) {
          var seatGroups = {};
          var seatOrder  = [];
          sentItems.forEach(function(i) {
            var sn = i.seat_number || 1;
            if (!seatGroups[sn]) { seatGroups[sn] = []; seatOrder.push(sn); }
            seatGroups[sn].push(i);
          });
          seatOrder.sort(function(a, b) { return a - b; });
          seatOrder.forEach(function(sn) {
            var seatTot = seatGroups[sn].reduce(function(s, i) {
              return s + (i.unitPrice || 0);
            }, 0);
            leftItems.push({ seatHeader: true, seatId: 'SEAT ' + sn, seatTotal: seatTot });
            seatGroups[sn].forEach(function(i) { leftItems.push(i); });
          });
        } else {
          leftItems = sentItems;
        }

        OrderSummary.unlockItemRender();
        OrderSummary.update({ items: leftItems });
        OrderSummary.lockItemRender();
      }
    })
    .catch(function(err) {
      console.warn('[KINDpos] Failed to recall order:', err);
      showToast('Failed to load saved check', { bg: T.verm, duration: 2000 });
    });
}