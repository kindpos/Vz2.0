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
 *    - Navigation to order-entry.js happens with state.currentOrderId=null.
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

const PAD      = 16;
const GAP      = 16;
const BTN_H    = 50;
const OVERLAP  = 18;

// Pricing rates come from frontend/js/pricing.js — one source of truth
// for TAX_RATE / CASH_DISCOUNT across every scene, so a stale copy can't
// leak into a payment amount.

// ── API ───────────────────────────────────────────
const API = '/api/v1';

// ── Order ID — one per transaction, reset on fresh enter ──
// Held in a per-mount state object so that a fresh render() always gets a
// clean reference and stale callbacks (e.g. interrupt onConfirm fired after
// unmount → remount) cannot accidentally write to a previous mount's state.
let state = { currentOrderId: null };
const _header = null;
let isSending = false;   // guard against concurrent handleSend calls

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
  return `ik_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}
let currentCheckNumber = null;
let currentCustomerName = null;
// Per-scene idempotency key for POST /orders. If SEND/SAVE fails after
// the backend already created the order (e.g. client timeout), retrying
// with the same key causes the ledger to return the same event instead
// of minting a duplicate C-NNN. Cleared once state.currentOrderId is set.
let createOrderIdemKey = null;

function _handleNameTap() {
  if (!state.currentOrderId) {
    showToast('Send items first to name this check', { bg: T.gold, duration: 2000 });
    return;
  }
  SceneManager.interrupt('oe-name-input', {
    onConfirm: (name) => {
      if (state.currentOrderId == null) {
        entReport({
          code:    'UI-031',
          source:  'order-entry._handleNameTap',
          message: 'PATCH skipped — currentOrderId is null/undefined',
          ctx:     { name },
        });
        return;
      }
      fetchWithTimeout(API + `/orders/${state.currentOrderId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ customer_name: name }),
      }, 15000).then((r) => {
        if (r.ok) {
          currentCustomerName = name;
          OrderSummary.update({ customerName: name });
          showToast(name ? `Named: ${name}` : 'Name cleared', { bg: T.greenWarm, duration: 1500 });
        } else { showToast('Name update failed', { bg: T.verm }); }
      }).catch(() => { showToast('Name update failed', { bg: T.verm }); });
    },
    onCancel: () => {},
    checkLabel: currentCheckNumber || 'check',
    currentName: currentCustomerName || '',
  });
}

// ── Pizza builder data (populated by API or fallback) ──
let PIZZA_BUILDER_DATA = null;

// ── Menu data (loaded from API on scene entry) ──
let MENU_DATA = [];

const MOD_DATA = [];

// ── Per-item included-modifier lookup (from hidden "included_<item_id>" groups) ──
let INCLUDED_BY_ITEM = {};

// ── Overseer-authored modifier wiring (source of truth when present) ──
let MODIFIER_GROUPS = [];          // raw groups (non-hidden) keyed by group_id
let MODIFIER_MASTER = {};          // modifier_id → { name, price }
let ITEM_TO_CATEGORY = {};         // item_id → category_id

// ── Fetch menu from API and transform to HexNav format ──
// The legacy MandatoryAssignment / UniversalAssignment model was retired.
// Its behavior (min/max selections, owner_item_id, category_id) now lives
// on each ModifierGroup, and the per-item / per-category wiring is baked
// into `item.mandatory_group_ids` and `category.universal_group_ids` in
// the /menu response. Those two fields are what _refreshModPanel and
// buildKindModPanel actually consume (see line ~2453). The previous
// /config/*-assignments endpoints were removed from the backend; the
// frontend was still calling them and logging 404s on every menu load.
let _menuFetched = false;

function fetchMenuFromAPI() {
  return fetchWithTimeout(API + '/menu', {}, 15000)
    .then((r) => { if (!r.ok) throw new Error(r.status); return r.json(); })
    .then((menu) => {
    if (!menu.categories || !menu.items) return;

    // Build items_by_category keyed by category_id (lowercase)
    const itemsByCatId = {};
    ITEM_TO_CATEGORY = {};
    menu.categories.forEach((cat) => { itemsByCatId[cat.category_id] = []; });
    menu.items.forEach((item) => {
      // Match item.category (name like "Pizza") to category
      let cat = menu.categories.find((c) => c.name === item.category || c.category_id === item.category || c.category_id === item.category_id);
      if (cat) {
        if (!itemsByCatId[cat.category_id]) itemsByCatId[cat.category_id] = [];
        itemsByCatId[cat.category_id].push(item);
        let iid = item.item_id || item.id;
        if (iid) ITEM_TO_CATEGORY[iid] = cat.category_id;
      }
    });

    // Transform categories + items into HexNav MENU_DATA
    MENU_DATA = menu.categories.map((cat) => {
      let catItems = (itemsByCatId[cat.category_id] || [])
        .sort((a, b) => (a.display_order || 999) - (b.display_order || 999))
        .map((item) => {
          const hexItem = { label: item.name, price: item.price, id: item.item_id || item.id };
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
      let catColor = cat.color || cat.hex_color || T.catColor(cat.label || cat.name.toUpperCase()) || hexToRgba(T.text, 0.6);
      const textColor = _textColorForHex(catColor);
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
    (menu.modifier_groups || []).forEach((g) => {
      // Always index modifiers into MODIFIER_MASTER so later lookups
      // resolve atom names/prices even for atoms inside hidden groups.
      (g.modifiers || []).forEach((m) => {
        if (m.modifier_id && !MODIFIER_MASTER[m.modifier_id]) {
          MODIFIER_MASTER[m.modifier_id] = { name: m.name, price: parseFloat(m.price) || 0 };
        }
      });
      if (g.hidden) {
        // Legacy hidden "included_<item_id>" groups — still honored for items
        // that haven't been migrated yet. menu-categories.js emits
        // modifier.group_deleted on first save to clean these up.
        if (g.owner_item_id) {
          let mods = (g.modifiers || []).map((m) => { return { id: m.modifier_id, label: m.name }; });
          if (mods.length > 0) INCLUDED_BY_ITEM[g.owner_item_id] = mods;
        }
        return;
      }
      MODIFIER_GROUPS.push(g);
    });

    // New-model pass: walk items directly and build INCLUDED_BY_ITEM
    // from item.included_modifier_ids. This overrides any legacy hidden-group
    // entry with the authoritative Overseer-authored list.
    (menu.items || []).forEach((item) => {
      const iid = item.item_id || item.id;
      let ids = item.included_modifier_ids || [];
      if (!iid || ids.length === 0) return;
      let mods = ids.map((mid) => {
        const master = MODIFIER_MASTER[mid];
        return { id: mid, label: master ? master.name : mid };
      });
      INCLUDED_BY_ITEM[iid] = mods;
    });

    // Extract pizza builder modifier groups
    if (menu.modifier_groups) {
      const builderGroups = menu.modifier_groups
        .filter((g) => g.builder)
        .sort((a, b) => (a.display_order || 999) - (b.display_order || 999));

      if (builderGroups.length > 0) {
        PIZZA_BUILDER_DATA = builderGroups.map((g) => {
          let subcats;
          if (g.subcats && g.subcats.length > 0) {
            // Group has explicit subcategories (e.g. Prep → Crust, Temp, Sauce, Cut)
            subcats = g.subcats.map((sc) => {
              return {
                id: sc.id,
                label: sc.name,
                items: (sc.modifiers || []).map((m) => {
                  return { label: m.name, id: m.modifier_id, price: m.price || 0 };
                }),
              };
            });
          } else {
            // Flat modifiers → single subcat
            subcats = [{ id: g.group_id + '-items', label: g.name, items:
              (g.modifiers || []).map((m) => {
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
  }).catch((err) => {
    console.warn('[KINDpos] Menu fetch failed, using fallback:', err);
  });
}

function _textColorForHex(hex) {
  // Simple luminance check to pick dark or light text
  const r = parseInt(hex.slice(1, 3), 16);
  let g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return lum > 0.5 ? T.well : T.text;
}

// ── Combo flow state ─────────────────────────────
let comboFlow    = null;  // { step: 'side'|'drink', ticketItem: ref }

// ── Scene state ───────────────────────────────────
let ticket       = [];    // [{ id, name, unitPrice, mods:[{name,price,charged}], selected, sent }]
let ticketSeq    = 0;     // monotonic ID counter
let sceneParams  = {};
let modHistory   = [];    // [{inst, mod}] — undo stack for modifier additions
let _bottomBar   = null;  // DOM ref for bottom action bar
let _mainArea    = null;  // DOM ref for right panel
let _activeSeats    = new Set();   // currently selected seat numbers
let _seatList       = [];          // seat numbers in the overview selection
let _allSeatList    = [];          // all seat numbers in the party
let _seatTab        = 'selected';  // 'selected' | 'unselected'
let _seatSelectorEl = null;        // DOM ref for the inline seat card
let _prevSeats       = new Set();   // snapshot of _activeSeats at last item add (for RECALL)
let _autoSwitchArmed = false;       // true after item add → next seat tap does exclusive replace

// ── Snake nav state ───────────────────────────────
let snakeState = {
  view:   'cats',  // 'personal'|'cats'|'subcats'|'items'
  crumbs: [],      // [{ id, label, color }]
  catId:  null,
  subId:  null,
};
let favorites    = [];   // item ids for personal tab
let _gridEl      = null; // inner grid DOM container
let _gridWrap    = null; // collapsible grid wrapper
let _snakeStrip  = null; // crumb-only strip shown when mod panel open
let _expandedItems = {}; // item id → true when mod rows are expanded
let _collapsedSeats = new Set(); // seat numbers collapsed in multi-seat s-card view (default: all expanded)

// ── Modifier Panel (slide-up) ─────────────────────
let _modPanel      = null;   // buildKindModPanel instance
let _modPanelItem  = null;   // ticket preview item for active panel
let _modPanelCatColor = null; // cat color of the item being modified — used by _appendModPreview
let _modPanelOpen  = false;  // drives grid collapse animation

// ── Inject invisible scrollbar style ──
(() => {
  if (document.getElementById('co-scroll-style')) return;
  let s = document.createElement('style');
  s.id = 'co-scroll-style';
  s.textContent = '.co-scroll::-webkit-scrollbar{display:none}';
  document.head.appendChild(s);
})();

(() => {
  if (document.getElementById('oe-seat-scroll-style')) return;
  let s = document.createElement('style');
  s.id = 'oe-seat-scroll-style';
  s.textContent = '._oe-seat-scroll::-webkit-scrollbar{display:none}';
  document.head.appendChild(s);
})();

// ── Batch Modifier Session ───────────────────────
// activeSizes: {group_id: size_name} — populated when the customer picks a
// modifier from a drives_pricing group. Reset to {} on every new item /
// modifier-session start. Read by calculateItemPrice() to apply size-aware
// item base + per-modifier price_by_size adjustments.
let modifierSession = {
  active: false,
  selectedItems: [],
  activePrefix: null,
  activePlacement: null,
  appliedMods: [],
  activeSizes: {},
  panelEl: null,
  hasPizza: false,
};

// ═══════════════════════════════════════════════════
//  PRICING CHAIN — JS port of backend/app/core/pricing.py
//
//  Pure function. selections is the array of current modifier picks:
//    [{ group_id, modifier_id, option_id?, micromods?: [] }]
//  menuState: {
//    modifier_groups: { id → { drives_pricing, default_option_group_id, ... } },
//    modifiers:       { id → { name, price, price_by_size? } },
//    options:         { id → { price_adjustment, negates_price, active? } },
//    option_groups:   { id → { option_ids[], active? } },
//    sizes:           { id → { name } }                    // optional
//  }
//  Returns: a JS number rounded to 2 decimal places (ROUND_HALF_UP).
// ═══════════════════════════════════════════════════
function calculateItemPrice(item, selections, menuState) {
  item = item || {};
  selections = selections || [];
  menuState = menuState || {};
  let groups   = menuState.modifier_groups || {};
  let mods     = menuState.modifiers       || {};
  let opts     = menuState.options         || {};
  let optGroups = menuState.option_groups  || {};

  // Step 1 — Resolve active sizes (group_id → size_name)
  const activeSizes = {};
  for (let i = 0; i < selections.length; i++) {
    let sel = selections[i];
    if (!sel || !sel.group_id || !sel.modifier_id) continue;
    let grp = groups[sel.group_id];
    if (grp && grp.drives_pricing) {
      const driverMod = mods[sel.modifier_id];
      if (driverMod) activeSizes[sel.group_id] = driverMod.name;
    }
  }

  // Step 2 — Item base price
  let itemBase = Number(item.price) || 0;
  const pbsItem = item.price_by_size || {};
  for (let gid in activeSizes) {
    if (!Object.prototype.hasOwnProperty.call(activeSizes, gid)) continue;
    const sizeName = activeSizes[gid];
    const grpMap = pbsItem[gid];
    if (grpMap && grpMap[sizeName] != null) {
      itemBase += Number(grpMap[sizeName]) || 0;
    }
  }

  // Step 3 — Per-modifier line prices
  const modifierLines = [];
  const includedSet = {};
  (item.included_modifier_ids || []).forEach((id) => { includedSet[id] = true; });

  for (let j = 0; j < selections.length; j++) {
    let s = selections[j];
    if (!s || !s.group_id || !s.modifier_id) continue;
    const g = groups[s.group_id];
    if (g && g.drives_pricing) continue; // size groups don't add a line price
    let mod = mods[s.modifier_id];
    if (!mod) continue;

    // Base — free if included on the item
    let base = includedSet[s.modifier_id] ? 0 : (Number(mod.price) || 0);

    // Size adjustment — item.size_price_overrides wins over mod.price_by_size
    const spo = item.size_price_overrides || {};
    const modPbs = mod.price_by_size || {};
    for (let gid2 in activeSizes) {
      if (!Object.prototype.hasOwnProperty.call(activeSizes, gid2)) continue;
      const sName = activeSizes[gid2];
      const ovGrp = spo[gid2];
      const override = (ovGrp && ovGrp[sName] != null) ? ovGrp[sName] : null;
      if (override != null) {
        base += Number(override) || 0;
      } else {
        const modGrp = modPbs[gid2];
        if (modGrp && modGrp[sName] != null) {
          base += Number(modGrp[sName]) || 0;
        }
      }
    }

    // Option adjustment — item override wins over group default
    if (s.option_id) {
      let ogOverrides = item.option_group_overrides || {};
      let optGroupId = ogOverrides[s.group_id];
      if (optGroupId == null && g) optGroupId = g.default_option_group_id;
      const optGroup = optGroupId ? optGroups[optGroupId] : null;
      if (optGroup && optGroup.active !== false) {
        let opt = opts[s.option_id];
        if (opt && opt.active !== false) {
          if (opt.negates_price) {
            modifierLines.push(0);
            continue;
          }
          base += Number(opt.price_adjustment) || 0;
        }
      }
    }

    modifierLines.push(base);
  }

  // Step 4 — micromods always $0.00 (already excluded above via group filter)

  // Step 5 — sum and round to 2dp (ROUND_HALF_UP equivalent for positive vals)
  let raw = itemBase;
  for (let k = 0; k < modifierLines.length; k++) raw += modifierLines[k];
  return Math.round(raw * 100) / 100;
}

// ═══════════════════════════════════════════════════
//  OPTIONS TIER UI (Prompt 2)
//
//  Visual layer between modifier selection and microMODs.
//  Resolved from modifier_groups[group_id].default_option_group_id
//  (or item.option_group_overrides[group_id] when set), filtered
//  to active option_ids in the resolved OptionGroup.
//
//  resolveOptionGroupForModifier(item, groupId, menuState)
//  shouldRenderOptionsRow(item, groupId, menuState)
//  buildOptionsRow({ item, groupId, modifierId, selectedOptionId,
//                    menuState, onSelect }) → HTMLElement
//  buildModifierBlock({ ...same plus label, includedModifierIds })
//      → tile + options row + (optional) microMODs row, in that order.
// ═══════════════════════════════════════════════════

function resolveOptionGroupForModifier(item, groupId, menuState) {
  if (!groupId || !menuState) return null;
  const groups = menuState.modifier_groups || {};
  let grp = groups[groupId];
  if (!grp) return null;
  if (grp.drives_pricing) return null; // size selectors don't get options
  const ogOverrides = (item && item.option_group_overrides) || {};
  let ogId = ogOverrides[groupId];
  if (ogId == null) ogId = grp.default_option_group_id;
  if (!ogId) return null;
  const optGroups = menuState.option_groups || {};
  let og = optGroups[ogId];
  if (!og || og.active === false) return null;
  let ids = og.option_ids || [];
  return ids.length > 0 ? og : null;
}

function shouldRenderOptionsRow(item, groupId, menuState) {
  return !!resolveOptionGroupForModifier(item, groupId, menuState);
}

// Theme tokens for each option label/state. Pure lookup — never mutates.
function _optionTheme(opt) {
  if (!opt) return { border: T.elec, text: T.elec };
  if (opt.negates_price) return { border: T.verm, text: T.verm };
  let name = (opt.name || '').toLowerCase().trim();
  if (name === 'regular')                  return { border: T.green, text: T.green };
  if (name === 'extra')                    return { border: T.gold,  text: T.gold  };
  if (name === 'light' || name === 'lite') return { border: T.moon,  text: T.moon  };
  if (name === 'on side' || name === 'mixed in') return { border: T.elec, text: T.elec };
  return { border: T.elec, text: T.elec };
}

function _optionPriceLabel(opt) {
  if (!opt || opt.negates_price) return '';
  let v = Number(opt.price_adjustment || 0);
  if (v > 0) return `+$${v.toFixed(2)}`;
  if (v < 0) return `−$${Math.abs(v).toFixed(2)}`;
  return '';
}

function _defaultSelectedOptionId(og, optionsMap) {
  let ids = (og && og.option_ids) || [];
  for (let i = 0; i < ids.length; i++) {
    const o = optionsMap[ids[i]];
    if (o && (o.name || '').toLowerCase() === 'regular') return o.option_id;
  }
  return null;
}

function buildOptionsRow(opts) {
  opts = opts || {};
  const item     = opts.item || {};
  const groupId  = opts.groupId;
  const menuState = opts.menuState || {};
  const onSelect = opts.onSelect || function() {};

  let row = document.createElement('div');
  row.dataset.optionsRow = '1';
  row.style.cssText = [
    'display:flex;flex-wrap:wrap;gap:6px;',
    'margin-top:6px;',
  ].join('');

  const og = resolveOptionGroupForModifier(item, groupId, menuState);
  if (!og) {
    row.dataset.empty = '1';
    row.style.display = 'none';
    return row;
  }

  const optionsMap = menuState.options || {};
  let ids = og.option_ids || [];
  let selectedOptionId = opts.selectedOptionId || null;
  if (!selectedOptionId) {
    selectedOptionId = _defaultSelectedOptionId(og, optionsMap);
  }
  row.dataset.selectedOptionId = selectedOptionId || '';

  ids.forEach((oid) => {
    let opt = optionsMap[oid];
    if (!opt || opt.active === false) return;
    const theme = _optionTheme(opt);
    let isSel = (opt.option_id === selectedOptionId);
    const priceLabel = _optionPriceLabel(opt);
    let label = priceLabel ? (opt.name + ` ${priceLabel}`) : opt.name;

    let pill = buildPillButton({
      label: label,
      // Selected pills fill with the theme color; unselected stay ghost-style.
      variant: isSel ? undefined : 'ghost',
      color: isSel ? theme.border : 'transparent',
      textColor: isSel ? T.well : theme.text,
      fontSize: '11px',
      onClick: () => { onSelect(opt.option_id); },
    });

    // Tag with data attributes for testability + post-style border so the
    // theme color shows through even when the pill is ghost-styled.
    pill.dataset.optionId   = opt.option_id;
    pill.dataset.optionName = opt.name || '';
    pill.dataset.themeBorder = theme.border;
    pill.dataset.themeText   = theme.text;
    pill.dataset.selected   = isSel ? '1' : '0';
    pill.dataset.priceLabel = priceLabel;
    pill.style.border = `1px solid ${theme.border}`;
    if (!isSel) pill.style.color = theme.text;

    row.appendChild(pill);
  });

  return row;
}

function buildModifierBlock(opts) {
  opts = opts || {};
  let wrap = document.createElement('div');
  wrap.dataset.modifierBlock = '1';
  wrap.dataset.modifierId = opts.modifierId || '';
  wrap.dataset.groupId    = opts.groupId    || '';

  // Modifier tile — minimal placeholder so the existing visual renderer
  // is untouched. Real renderModButtonGrid still owns the production tile
  // styling; this block exists for tests + future composition.
  let tile = document.createElement('div');
  tile.dataset.modifierTile = '1';
  tile.textContent = opts.label || '';
  wrap.appendChild(tile);

  // Options row — only renders for non-drives_pricing groups with a valid
  // OptionGroup. shouldRenderOptionsRow() returns false otherwise and
  // buildOptionsRow short-circuits to a hidden, empty row.
  const optionsRow = buildOptionsRow(opts);
  wrap.appendChild(optionsRow);

  // microMODs row — rendered AFTER the options row, never instead of it.
  // Shape: included_modifier_ids ($0 spec-only sub-picks) tagged onto the
  // modifier in the menu projection. Empty list = no row.
  const includedIds = opts.includedModifierIds || [];
  if (includedIds.length > 0) {
    const mmRow = document.createElement('div');
    mmRow.dataset.micromodsRow = '1';
    mmRow.style.cssText = 'display:flex;flex-wrap:wrap;gap:4px;margin-top:6px;';
    includedIds.forEach((id) => {
      let chip = document.createElement('span');
      chip.dataset.micromodId = id;
      chip.textContent = id;
      mmRow.appendChild(chip);
    });
    wrap.appendChild(mmRow);
  }

  return wrap;
}

// ── Prefix definitions ────────────────────────────
const PREFIXES = [
  { id: 'add',     label: 'ADD',     color: T.greenWarm, textColor: T.well },
  { id: 'extra',   label: 'EXTRA',   color: T.elec,      textColor: T.well },
  { id: 'no',      label: 'NO',      color: T.verm,      textColor: T.text },
  { id: 'on-side', label: 'ON SIDE', color: T.gold,      textColor: T.well },
  { id: 'lite',    label: 'LITE',    color: T.gold,      textColor: T.well },
];

defineScene({
  name: 'order-entry',

  state: {},

  render: (container, params) => {
    params = params || {};
    const staff = params.staff || params.emp || {};

    // 2. Body container — fills the entire screen
    let body = document.createElement('div');
    const offset = '0';
    body.style.cssText = `position:absolute;left:${offset};right:0;top:0;bottom:0;overflow:hidden;display:flex;flex-direction:column;`;
    container.appendChild(body);

    ticket         = [];
    ticketSeq      = 0;
    sceneParams    = params;
    state          = { currentOrderId: null };  // fresh state object per mount
    isSending      = false;
    currentCheckNumber = null;
    currentCustomerName = null;
    createOrderIdemKey = null;
    modHistory     = [];
    modifierSession = { active: false, selectedItems: [], activePrefix: null, activePlacement: null, appliedMods: [], activeSizes: {}, panelEl: null, hasPizza: false };
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
      : [];
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

    const mainArea = buildMain(body, params);
    body.appendChild(mainArea);

    if (!_menuFetched) fetchMenuFromAPI().catch(() => { console.error('[KINDpos] Menu fetch failed on mount'); });

    if (params.recallOrderId) {
      state.currentOrderId = params.recallOrderId;
      currentCheckNumber = params.recallCheckNumber || null;
      recallFromBackend(params.recallOrderId);
    }

    if (window._header && window._header.setBackHandler) {
      window._header.setBackHandler(handleClose);
    }
  },

  unmount: () => {
    // Fire-and-forget auto-save for unexpected unmounts (logout, force
    // scene swap). handleClose() already awaits, so when BACK is used
    // this is a no-op (everything is already flushed). The fetch body
    // is built synchronously so the in-flight request survives the
    // scene teardown.
    try {
      let hasUnsent = ticket.some((inst) => !inst.sent);
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
    modifierSession = { active: false, selectedItems: [], activePrefix: null, activePlacement: null, appliedMods: [], activeSizes: {}, panelEl: null, hasPizza: false };
    comboFlow      = null;
    state.currentOrderId = null;
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
      render: (container, params) => {
        let inner      = (params && params.params) || {};
        let itemName   = inner.itemName || '';
        const startQty   = Math.max(1, parseInt(inner.currentQty, 10) || 1);
        let qty        = startQty;

        container.style.cssText = 'width:100%;height:100%;display:flex;align-items:center;justify-content:center;';

        let shell = buildStaticCard({ accent: T.groups.composite.shellAccent });
        shell.style.display       = 'flex';
        shell.style.flexDirection = 'column';
        shell.style.gap           = '14px';
        shell.style.minWidth      = '420px';
        shell.style.maxWidth      = '520px';
        shell.style.padding       = '20px 28px 28px 32px';
        let panel = shell;

        let title = document.createElement('div');
        title.style.cssText = [
          `font-family:${T.fh};`,
          `font-size:${T.fsB2};`,
          `font-weight:${T.fwBold};`,
          `color:${T.green};`,
          'letter-spacing:0.2em;',
          'text-transform:uppercase;',
          'text-align:center;',
        ].join('');
        title.textContent = 'EDIT QUANTITY';
        panel.appendChild(title);

        if (itemName) {
          const subtitle = document.createElement('div');
          subtitle.style.cssText = [
            `font-family:${T.fb};font-size:${T.fsB3};`,
            `color:${T.text};text-align:center;`,
            'white-space:nowrap;overflow:hidden;text-overflow:ellipsis;',
          ].join('') + `;font-weight:${T.fwBold};`;
          subtitle.textContent = itemName;
          panel.appendChild(subtitle);
        }

        // Stepper row: [ − ]  ( qty )  [ + ]
        const stepper = document.createElement('div');
        stepper.style.cssText = 'display:flex;align-items:center;justify-content:center;gap:16px;margin:6px 0 4px;';

        // Stepper −/+: neutral elec cyan so they don't blend with the
        // card bg and don't claim primary-action color.
        const minusBtn = buildPillButton({
          label: '−',
          variant: T.groups.composite.stepper,
          fontSize: T.fsB1,
        });
        minusBtn.style.width  = '64px';
        minusBtn.style.height = '56px';
        minusBtn.style.borderRadius = '14px';
        minusBtn.style.flexShrink = '0';

        const qtyReadout = document.createElement('div');
        qtyReadout.style.cssText = [
          'min-width:80px;text-align:center;',
          `font-family:${T.fb};font-size:${T.fsB1};`,
          `font-weight:${T.fwBold};color:${T.gold};`,
          'pointer-events:none;',
        ].join('');

        const plusBtn = buildPillButton({
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
        const bottomBar = document.createElement('div');
        bottomBar.style.cssText = 'display:flex;gap:10px;margin-top:8px;';

        let cancelBtn = buildPillButton({
          label: 'CANCEL',
          variant: T.groups.composite.cancel,
          fontSize: T.fsB2,
          onClick: () => { params.onCancel(); },
        });
        cancelBtn.style.flex = '1';
        cancelBtn.style.height = '48px';
        cancelBtn.style.borderRadius = '14px';
        cancelBtn.style.display = 'flex';
        cancelBtn.style.alignItems = 'center';
        cancelBtn.style.justifyContent = 'center';

        const confirmBtn = buildPillButton({
          label: 'CONFIRM',
          variant: T.groups.composite.confirm,
          fontSize: T.fsB2,
          onClick: () => {
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
          const dirty = qty !== startQty;
          confirmBtn.style.color       = dirty ? T.green   : hexToRgba(T.text, 0.45);
          confirmBtn.style.borderColor = dirty ? T.green   : T.card;
        }

        minusBtn.addEventListener('pointerup', (e) => {
          e.stopPropagation();
          if (qty > 1) { qty -= 1; paint(); }
        });
        plusBtn.addEventListener('pointerup', (e) => {
          e.stopPropagation();
          qty += 1;
          paint();
        });

        container.addEventListener('pointerup', (e) => {
          if (e.target === container) { params.onCancel(); }
        });

        paint();
      },
      unmount: () => {},
    },
    'oe-name-input': {
      render: (container, params) => {
        showKeyboard({
          placeholder: 'Enter name',
          initialValue: params.currentName || '',
          maxLength: 40,
          onDone: (val) => {
            params.onConfirm(val.trim());
          },
          onDismiss: () => {
            params.onCancel();
          },
          dismissOnDone: true,
        });
      },
      unmount: () => { hideKeyboard(); },
    },

    'oe-open-item': {
      render: (container, params) => {
        container.style.cssText = 'width:100%;height:100%;display:flex;align-items:center;justify-content:center;';
        container.addEventListener('pointerup', (e) => {
          if (e.target === container) params.onCancel();
        });

        const shell = buildStaticCard({ accent: T.gold });
        Object.assign(shell.style, {
          display: 'flex', flexDirection: 'column', gap: '14px',
          minWidth: '340px', maxWidth: '420px',
          padding: '20px 24px 24px',
        });

        const title = document.createElement('div');
        title.style.cssText = `font-family:${T.fh};font-size:${T.fsB2};font-weight:${T.fwBold};color:${T.gold};letter-spacing:0.2em;text-transform:uppercase;text-align:center;`;
        title.textContent = 'OPEN ITEM';
        shell.appendChild(title);

        // ── Name ──
        const nameInput = document.createElement('input');
        Object.assign(nameInput.style, {
          fontWeight: T.fwBold,
          width: '100%', boxSizing: 'border-box',
          background: hexToRgba(T.text, 0.06), border: `1px solid ${hexToRgba(T.text, 0.18)}`,
          borderRadius: '10px', color: T.text,
          fontFamily: T.fb, fontSize: T.fsB3,
          padding: '10px 12px', outline: 'none',
        });
        nameInput.placeholder = 'Item name (required)';
        nameInput.maxLength = 50;
        shell.appendChild(nameInput);

        // ── Category ──
        const catSelect = document.createElement('select');
        Object.assign(catSelect.style, {
          fontWeight: T.fwBold,
          width: '100%', boxSizing: 'border-box',
          background: hexToRgba(T.text, 0.06), border: `1px solid ${hexToRgba(T.text, 0.18)}`,
          borderRadius: '10px', color: T.text,
          fontFamily: T.fb, fontSize: T.fsB3,
          padding: '10px 12px', outline: 'none',
          appearance: 'none',
        });
        const catPlaceholder = document.createElement('option');
        catPlaceholder.value = '';
        catPlaceholder.textContent = 'Select category…';
        catPlaceholder.disabled = true;
        catPlaceholder.selected = true;
        catSelect.appendChild(catPlaceholder);
        MENU_DATA.forEach((cat) => {
          let opt = document.createElement('option');
          opt.value = cat.id;
          opt.textContent = cat.label || cat.id;
          catSelect.appendChild(opt);
        });
        shell.appendChild(catSelect);

        // ── Price display ──
        let _cents = 0;
        const priceDisplay = document.createElement('div');
        Object.assign(priceDisplay.style, {
          textAlign: 'center', fontFamily: T.fb,
          fontSize: '2rem', fontWeight: T.fwBold, color: T.gold,
          letterSpacing: '0.05em',
        });
        function _refreshPrice() { priceDisplay.textContent = `$${(_cents / 100).toFixed(2)}`; }
        _refreshPrice();
        shell.appendChild(priceDisplay);

        // ── Digit pad ──
        const pad = document.createElement('div');
        pad.style.cssText = 'display:grid;grid-template-columns:repeat(3,1fr);gap:8px;';
        [7,8,9,4,5,6,1,2,3,'⌫',0,'✓'].forEach((key) => {
          let btn = document.createElement('button');
          Object.assign(btn.style, {
            padding: '14px 0', borderRadius: '10px', border: 'none',
            background: (key === '✓') ? T.greenWarm : hexToRgba(T.text, 0.08),
            color: (key === '✓') ? T.moonText : T.text,
            fontFamily: T.fb, fontSize: T.fsB2, fontWeight: T.fwBold,
            cursor: 'pointer',
          });
          btn.textContent = String(key);
          btn.addEventListener('pointerup', (e) => {
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
        const btnRow = document.createElement('div');
        btnRow.style.cssText = 'display:flex;gap:10px;margin-top:4px;';
        const cancelBtn = buildPillButton({ label: 'CANCEL', variant: T.groups.composite.cancel, fontSize: T.fsB2, onClick: () => { params.onCancel(); } });
        cancelBtn.style.flex = '1'; cancelBtn.style.height = '48px';
        const addBtn = buildPillButton({ label: 'ADD ITEM', variant: T.groups.composite.confirm, fontSize: T.fsB2, onClick: _commit });
        addBtn.style.flex = '1'; addBtn.style.height = '48px';
        btnRow.appendChild(cancelBtn);
        btnRow.appendChild(addBtn);
        shell.appendChild(btnRow);

        container.appendChild(shell);
        nameInput.focus();

        function _commit() {
          let name = nameInput.value.trim();
          if (!name) { nameInput.style.borderColor = T.verm; return; }
          if (!catSelect.value) { catSelect.style.borderColor = T.verm; return; }
          params.onConfirm({ label: name, price: _cents / 100, categoryId: catSelect.value });
        }
      },
      unmount: () => {},
    },
  },

  // Test seam — exposes internal state and functions for unit tests.
  // Only referenced in *.test.js; never called by production code.
  __handlers: {
    get ticket()                { return ticket; },
    set ticket(v)               { ticket = v; },
    get currentOrderId()        { return state.currentOrderId; },
    set currentOrderId(v)       { state.currentOrderId = v; },
    get createOrderIdemKey()    { return createOrderIdemKey; },
    set createOrderIdemKey(v)   { createOrderIdemKey = v; },
    get isSending()             { return isSending; },
    handleSend:                 () => handleSend(),
    handleSaveOnly:             () => handleSaveOnly(),
    recallFromBackend:          (id) => recallFromBackend(id),
    get modifierSession()       { return modifierSession; },
    set modifierSession(v)      { modifierSession = v; },
    applyModifier:              (mod) => applyModifier(mod),
    calculateItemPrice:         (item, selections, menuState) => calculateItemPrice(item, selections, menuState),
    resolveOptionGroupForModifier: (item, groupId, menuState) => resolveOptionGroupForModifier(item, groupId, menuState),
    shouldRenderOptionsRow:     (item, groupId, menuState) => shouldRenderOptionsRow(item, groupId, menuState),
    buildOptionsRow:            (opts) => buildOptionsRow(opts),
    buildModifierBlock:         (opts) => buildModifierBlock(opts),
  },
});

// ── TOTALS HELPER ─────────────────────────────────
function _fmtPrice(n) {
  let v = Number(n);
  if (!isFinite(v)) v = 0;
  return `$${v.toFixed(2)}`;
}

// Pre-send display totals only — items in `ticket` have not reached the server
// yet, so there is no authoritative server total to trust. These values are
// shown as a live preview and are superseded by server-confirmed totals once
// the order is saved/sent.
function computeTicketTotals() {
  let subtotal = 0;
  const counts = {};
  const summaryItems = [];  // item summary for ORDER RECAP
  ticket.forEach((inst) => {
    let modTotal = inst.mods.reduce((s, m) => s + Number(m.price || 0), 0);
    const lineTotal = Number(inst.unitPrice || 0) + modTotal;
    counts[inst.name] = counts[inst.name] || { unitPrice: inst.unitPrice, qty: 0 };
    counts[inst.name].qty += 1;
    subtotal += lineTotal;
    summaryItems.push({
      name: inst.name,
      unitPrice: lineTotal,
      qty: 1,
      sent: inst.sent,
      mods: inst.mods.filter((m) => m.charged || m.name),
    });
  });
  let t = computeTotals(subtotal);
  return { counts, summaryItems, subtotal: t.subtotal, tax: t.tax, cardTotal: t.cardTotal, cashPrice: t.cashPrice };
}


// ── FAVORITES API ─────────────────────────────────
function loadFavorites() {
  let empId = sceneParams.employeeId;
  if (!empId) return;
  fetchWithTimeout(API + `/favorites?employee_id=${empId}`, {}, 10000)
    .then((r) => { return r.ok ? r.json() : { item_ids: [] }; })
    .then((data) => {
      favorites = data.item_ids || [];
      if (snakeState.view === 'personal') renderSnakeGrid();
    })
    .catch(() => { favorites = []; });
}

function saveFavorites() {
  const empId = sceneParams.employeeId;
  if (!empId) return;
  fetchWithTimeout(API + '/favorites', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ employee_id: empId, item_ids: favorites }),
  }, 10000).catch(() => {});
}

function toggleFavorite(itemId) {
  let idx = favorites.indexOf(itemId);
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
  let bg = filled ? color : T.card;
  let darkBg = darkenHex(bg, 0.2);
  return [
    'display:flex;flex-direction:column;justify-content:center;align-items:center;',
    'min-height:120px;padding:12px 10px;box-sizing:border-box;',
    `border-radius:${T.chamferCard}px;cursor:pointer;user-select:none;`,
    'pointer-events:auto;touch-action:manipulation;',
    `border-left:${T.accentBarW} solid ${color};`,
    `background:${bg};`,
    `box-shadow:0 6px 0 ${darkBg};`,
    'transition:transform 80ms,box-shadow 80ms;',
    extraCss || '',
  ].join('');
}

function _applyPress(el, color, filled) {
  let bg = filled ? color : T.card;
  const darkBg = darkenHex(bg, 0.2);
  el.addEventListener('pointerdown', () => {
    el.style.transform = 'translateY(1px)';
    el.style.boxShadow = 'none';
  });
  el.addEventListener('pointerup', () => {
    el.style.transform = '';
    el.style.boxShadow = `0 6px 0 ${darkBg}`;
  });
  el.addEventListener('pointerleave', () => {
    el.style.transform = '';
    el.style.boxShadow = `0 6px 0 ${darkBg}`;
  });
}

function buildCrumbTile(crumb, isLast) {
  let el = document.createElement('div');
  el.style.cssText = _tileStyle(crumb.color, true);
  el.style.position = 'relative';

  if (!isLast) {
    const back = document.createElement('div');
    back.style.cssText = `position:absolute;top:6px;right:8px;font-size:10px;color:rgba(0,0,0,0.4);font-family:${T.fb};pointer-events:none;;font-weight:${T.fwBold};`;
    back.textContent = '◂';
    el.appendChild(back);
  }

  let lbl = document.createElement('span');
  lbl.style.cssText = `font-family:${T.fh};font-weight:700;font-size:${T.fsB1};color:${(isLast ? T.well : hexToRgba(T.text, 0.75))};letter-spacing:1px;text-align:center;pointer-events:none;`;
  lbl.textContent = crumb.label;
  el.appendChild(lbl);

  _applyPress(el, crumb.color, true);
  return el;
}

function buildCatTile(cat) {
  let el = document.createElement('div');
  el.style.cssText = _tileStyle(cat.color, false);

  let lbl = document.createElement('span');
  lbl.style.cssText = `font-family:${T.fh};font-weight:700;font-size:${T.fsB1};color:${cat.color};letter-spacing:1.5px;text-align:center;pointer-events:none;`;
  lbl.textContent = cat.label;
  el.appendChild(lbl);

  _applyPress(el, cat.color, false);
  return el;
}

function buildSubcatTile(sub, color) {
  let el = document.createElement('div');
  el.style.cssText = _tileStyle(color, false, 'opacity:0.9;');

  let lbl = document.createElement('span');
  lbl.style.cssText = `font-family:${T.fh};font-weight:700;font-size:${T.fsB1};color:${color};letter-spacing:1px;text-align:center;pointer-events:none;`;
  lbl.textContent = sub.label;
  el.appendChild(lbl);

  _applyPress(el, color, false);
  return el;
}

function buildItemTile(item, catColor, isFav) {
  let el = document.createElement('div');
  el.style.cssText = _tileStyle(catColor, false, 'justify-content:space-between;align-items:flex-start;position:relative;');

  if (isFav) {
    const star = document.createElement('div');
    star.style.cssText = `position:absolute;top:7px;right:8px;color:${T.gold};font-size:14px;pointer-events:none;;font-weight:${T.fwBold};`;
    star.textContent = '★';
    el.appendChild(star);
  }

  let name = document.createElement('span');
  name.style.cssText = `font-family:${T.fh};font-weight:700;font-size:14px;color:${T.text};letter-spacing:0.3px;line-height:1.3;padding-right:${(isFav ? '18px' : '0')};pointer-events:none;`;
  name.textContent = item.label;
  el.appendChild(name);

  let price = document.createElement('span');
  price.style.cssText = `font-family:${T.fb};font-size:15px;color:${T.gold};font-weight:700;margin-top:6px;pointer-events:none;`;
  price.textContent = `$${(Number(item.price) || 0).toFixed(2)}`;
  el.appendChild(price);

  _applyPress(el, catColor, false);
  return el;
}

// ── SNAKE NAV GRID RENDERER ────────────────────────

function renderSnakeGrid() {
  if (!_gridEl) return;
  _gridEl.innerHTML = '';
  const frag = document.createDocumentFragment();

  const view   = snakeState.view;
  const crumbs = snakeState.crumbs;
  let catId  = snakeState.catId;
  const subId  = snakeState.subId;

  // ── PERSONAL TAB ──
  if (view === 'personal') {
    const pCrumb = { id: 'personal', label: 'PERSONAL', color: T.green };
    let pTile = buildCrumbTile(pCrumb, true);
    pTile.addEventListener('pointerup', () => {
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
    crumbs.forEach((crumb, i) => {
      let tile = buildCrumbTile(crumb, i === crumbs.length - 1);
      tile.addEventListener('pointerup', () => { _crumbTap(i); });
      _gridEl.appendChild(tile);
    });
  }

  // ── Category home ──
  if (view === 'cats') {
    // Inject PERSONAL as first tile
    const personalCat = { id: 'personal', label: 'PERSONAL', color: T.green };
    const pTile = buildCatTile(personalCat);
    pTile.addEventListener('pointerup', () => {
      snakeState.view = 'personal';
      snakeState.crumbs = [];
      snakeState.catId = null;
      snakeState.subId = null;
      renderSnakeGrid();
    });
    _gridEl.appendChild(pTile);

    MENU_DATA.forEach((cat) => {
      let tile = buildCatTile(cat);
      tile.addEventListener('pointerup', () => { _selectCat(cat); });
      _gridEl.appendChild(tile);
    });
    return;
  }

  // ── Subcategory ──
  let menuCat = MENU_DATA.find((c) => c.id === catId);
  if (!menuCat) return;
  const subcats = menuCat.subcats;

  if (view === 'subcats' && subcats && subcats.length > 1) {
    subcats.forEach((sub) => {
      let tile = buildSubcatTile(sub, menuCat.color);
      tile.addEventListener('pointerup', () => { _selectSubcat(sub, menuCat); });
      _gridEl.appendChild(tile);
    });
    return;
  }

  // ── Items ──
  let itemList = [];
  if (subId) {
    let sub = (subcats || []).find((s) => s.id === subId);
    if (sub) itemList = sub.items || [];
  } else {
    (subcats || []).forEach((s) => { itemList = itemList.concat(s.items || []); });
  }

  itemList.forEach((item) => {
    const isFav = favorites.indexOf(item.id) >= 0;
    let tile = buildItemTile(item, menuCat.color, isFav);
    _bindItemTile(tile, item, menuCat);
    frag.appendChild(tile);
  });
  _gridEl.appendChild(frag);
}

function _bindItemTile(tile, item, menuCat) {
  let longPressTimer = null;
  let didLong = false;
  let _tapping = false;

  tile.addEventListener('pointerdown', () => {
    didLong = false;
    longPressTimer = setTimeout(() => {
      didLong = true;
      if (item.id) toggleFavorite(item.id);
    }, 600);
  });

  tile.addEventListener('pointerup', () => {
    clearTimeout(longPressTimer);
    if (!didLong && !_tapping) {
      _tapping = true;
      handleItemSelect(item);
      requestAnimationFrame(() => { _tapping = false; });
    }
  });

  tile.addEventListener('pointerleave', () => {
    clearTimeout(longPressTimer);
  });

  tile.addEventListener('pointercancel', () => {
    clearTimeout(longPressTimer);
  });
}

function _renderPersonalGrid() {
  // Open Item tile — always present at the top of Personal
  const openTile = document.createElement('div');
  openTile.style.cssText = _tileStyle(T.gold, false, 'justify-content:space-between;align-items:flex-start;');
  const openLabel = document.createElement('span');
  openLabel.style.cssText = `font-family:${T.fh};font-weight:700;font-size:14px;color:${T.text};letter-spacing:0.3px;pointer-events:none;`;
  openLabel.textContent = 'Open Item';
  const openIcon = document.createElement('span');
  openIcon.style.cssText = `font-family:${T.fb};font-size:18px;color:${T.gold};font-weight:700;margin-top:4px;pointer-events:none;`;
  openIcon.textContent = '+';
  openTile.appendChild(openLabel);
  openTile.appendChild(openIcon);
  _applyPress(openTile, T.gold, false);
  openTile.addEventListener('pointerup', () => {
    SceneManager.interrupt('oe-open-item', {
      onConfirm: (result) => {
        let menuCat = MENU_DATA.find((c) => c.id === result.categoryId);
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
      onCancel: () => {
        SceneManager.closeInterrupt('oe-open-item');
      },
    });
  });
  _gridEl.appendChild(openTile);

  if (favorites.length === 0) {
    let empty = document.createElement('div');
    empty.style.cssText = [
      'grid-column:1/-1;display:flex;flex-direction:column;',
      'align-items:center;justify-content:center;height:200px;gap:10px;',
      `font-family:${T.fh};font-size:13px;color:${hexToRgba(T.text, 0.6)};text-align:center;`,
    ].join('') + `;font-weight:${T.fwBold};`;
    empty.innerHTML = `<div style="font-size:35px;color:${T.gold};opacity:0.5;pointer-events:none;">★</div><span style="pointer-events:none;">Hold any item to add it here</span>`;
    _gridEl.appendChild(empty);
    return;
  }

  // Group by category, preserving MENU_DATA order
  MENU_DATA.forEach((cat) => {
    const catItems = [];
    favorites.forEach((favId) => {
      (cat.subcats || []).forEach((sub) => {
        (sub.items || []).forEach((item) => {
          if (item.id === favId) catItems.push(item);
        });
      });
    });
    if (catItems.length === 0) return;

    // Category header spanning full grid
    let hdr = document.createElement('div');
    hdr.style.cssText = [
      'grid-column:1/-1;display:flex;align-items:center;gap:8px;',
      'margin-top:4px;margin-bottom:2px;',
    ].join('');
    const hdrLabel = document.createElement('span');
    hdrLabel.style.cssText = `font-family:${T.fh};font-weight:700;font-size:10px;color:${cat.color};letter-spacing:2px;pointer-events:none;`;
    hdrLabel.textContent = cat.label;
    const hdrLine = document.createElement('div');
    hdrLine.style.cssText = `height:1px;flex:1;background:linear-gradient(to right,${cat.color}44,transparent);pointer-events:none;`;
    hdr.appendChild(hdrLabel);
    hdr.appendChild(hdrLine);
    _gridEl.appendChild(hdr);

    catItems.forEach((item) => {
      let tile = buildItemTile(item, cat.color, true);
      _bindItemTile(tile, item, cat);
      _gridEl.appendChild(tile);
    });
  });
}

// ── SNAKE NAV ACTIONS ──────────────────────────────

function _selectCat(cat) {
  const hasSubs = cat.subcats && cat.subcats.length > 1;
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
  const main = document.createElement('div');
  main.style.cssText = 'flex:1;display:flex;flex-direction:column;min-height:0;';
  _mainArea = main;

  // ── Collapsible grid wrapper ──────────────────────
  let gridWrap = document.createElement('div');
  gridWrap.style.cssText = 'flex:1;min-height:0;overflow-y:auto;';
  _gridWrap = gridWrap;

  let grid = document.createElement('div');
  grid.style.cssText = [
    'display:grid;',
    'grid-template-columns:repeat(auto-fill,minmax(140px,1fr));',
    'gap:6px;padding:10px;',
  ].join('');
  _gridEl = grid;
  gridWrap.appendChild(grid);
  main.appendChild(gridWrap);

  // ── Snake strip (crumbs only, shown when mod panel open) ──
  const snakeStrip = document.createElement('div');
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
  if (_allSeatList.length > 0) {
    _seatSelectorEl = buildSeatSelectorCard();
    main.appendChild(_seatSelectorEl);
  }

  // ── Bottom action bar ─────────────────────────────
  _bottomBar = document.createElement('div');
  _bottomBar.style.cssText = 'display:grid;grid-template-columns:repeat(5,1fr);grid-auto-rows:auto;gap:4px;flex-shrink:0;margin-top:auto;';
  main.appendChild(_bottomBar);

  // Load menu data + favorites, then render grid
  requestAnimationFrame(() => {
    if (!_menuFetched) {
      fetchMenuFromAPI().then(() => { renderSnakeGrid(); }).catch(() => { console.error('[KINDpos] Menu fetch failed'); renderSnakeGrid(); });
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
  let bevelLt = lightenHex(T.bg, 0.08);

  // Wrapper card: bevel-chromed well, no accent bar (the seat tiles carry
  // the color signal themselves).
  let card = document.createElement('div');
  card.style.cssText = [
    'flex-shrink:0;',
    `margin:0 ${PAD}px ${GAP}px;`,
    `background:${T.well};`,
    `border:1px solid ${bevelLt};`,
    'border-radius:10px;',
    'display:flex;flex-direction:column;',
    'overflow:hidden;',
  ].join('');

  // ── Header: SEATS label + ALL/NONE pills ──────────
  const header = document.createElement('div');
  header.style.cssText = [
    'display:flex;align-items:center;gap:8px;',
    'padding:8px 12px 6px;',
  ].join('');

  let lbl = document.createElement('span');
  lbl.style.cssText = [
    `font-family:${T.fb};`,
    `font-size:${T.fsB4};`,
    `font-weight:${T.fwBold};`,
    `color:${T.green};`,
    'letter-spacing:0.15em;',
    'flex:1;',
  ].join('');
  lbl.textContent = 'SEATS';
  header.appendChild(lbl);

  // Outlined-pill builder for ALL/NONE — small, transparent fill, colored border + text.
  function _buildBulkPill(label, color) {
    const el = document.createElement('div');
    el.style.cssText = [
      'padding:3px 12px;',
      `border:1.5px solid ${color};`,
      'border-radius:6px;',
      'background:transparent;',
      `color:${color};`,
      `font-family:${T.fh};font-size:${T.fsB4};font-weight:${T.fwBold};`,
      'letter-spacing:0.15em;',
      'cursor:pointer;user-select:none;',
      'pointer-events:auto;touch-action:manipulation;',
      'transition:opacity 0.1s;',
    ].join('');
    el.textContent = label;
    el.addEventListener('pointerdown', () => { el.style.opacity = '0.6'; });
    let _rel = () => { el.style.opacity = '1'; };
    el.addEventListener('pointerup', _rel);
    el.addEventListener('pointerleave', _rel);
    el.addEventListener('pointercancel', _rel);
    return el;
  }

  const allBtn  = _buildBulkPill('ALL',  T.green);
  const noneBtn = _buildBulkPill('NONE', T.moon);
  header.appendChild(allBtn);
  header.appendChild(noneBtn);
  card.appendChild(header);

  // ── Body: 8-col scrollable grid ───────────────────
  // grid-auto-rows fixes row height at 40px; max-height shows ~3 rows; scrolls beyond.
  let body = document.createElement('div');
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
    let pill = document.createElement('div');
    pill.style.cssText = [
      'display:flex;align-items:center;justify-content:center;',
      'border-radius:8px;',
      `font-family:${T.fh};font-weight:${T.fwBold};`,
      `font-size:${T.fsB2};`,
      'cursor:pointer;user-select:none;',
      'pointer-events:auto;touch-action:manipulation;',
      'transition:transform 0.07s;',
      isActive
        ? `background:${T.green};color:${T.well};box-shadow:0 2px 0 ${T.greenDk};`
        : `background:transparent;color:${T.green};border:1.5px solid ${T.green};`,
    ].join('');
    pill.textContent = `S${sn}`;
    pill.addEventListener('pointerdown', () => { pill.style.transform = 'translateY(1px)'; });
    const _rel = () => { pill.style.transform = ''; };
    pill.addEventListener('pointerup',     _rel);
    pill.addEventListener('pointerleave',  _rel);
    pill.addEventListener('pointercancel', _rel);
    return pill;
  }

  function _buildAddTile() {
    let tile = document.createElement('div');
    tile.style.cssText = [
      'display:flex;align-items:center;justify-content:center;',
      'border-radius:8px;',
      'background:transparent;',
      `border:1.5px dashed ${T.moon};`,
      `color:${T.moon};`,
      `font-family:${T.fh};font-weight:${T.fwBold};font-size:24px;`,
      'cursor:pointer;user-select:none;',
      'pointer-events:auto;touch-action:manipulation;',
    ].join('');
    tile.textContent = '+';
    return tile;
  }

  function repaintSeats() {
    body.innerHTML = '';
    _allSeatList.forEach((sn) => {
      let isActive = _activeSeats.has(sn);
      let pill = _buildSeatPill(sn, isActive);
      pill.addEventListener('pointerup', ((seatNum) => {
        return () => {
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
    const addTile = _buildAddTile();
    addTile.addEventListener('pointerup', () => {
      const usedSeats = {};
      _allSeatList.forEach((sn) => { usedSeats[sn] = true; });
      let newSeat = 1;
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

  allBtn.addEventListener('pointerup', () => {
    _allSeatList.forEach((sn) => { _activeSeats.add(sn); });
    _autoSwitchArmed = false;
    repaintSeats();
    renderTicket();
  });

  noneBtn.addEventListener('pointerup', () => {
    _activeSeats.clear();
    _autoSwitchArmed = false;
    repaintSeats();
    renderTicket();
  });

  repaintSeats();
  card._repaintSeats = repaintSeats;
  // Called by _pushToAllSeats after items land — refresh pill states (in
  // case auto-switch armed) and any future add-seat hints.
  card._onItemAdded = () => { repaintSeats(); };
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

  let hasUnsent = ticket.some((i) => !i.sent);

  const doneLabel = isSending ? 'SENDING…' : 'DONE';

  let doneBtn = buildPillButton({
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
  doneBtn.addEventListener('pointerup', () => {
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
  ticket.forEach((i) => { i.selected = false; });
  renderTicket();
  rebuildBottomBar();
}

// ── MODIFIER SESSION ─────────────────────────────
function openModifierSession() {
  if (modifierSession.active) return;
  // Filter to unsent items only
  const ids = modifierSession.selectedItems;
  const items = ticket.filter((i) => ids.indexOf(i.id) !== -1 && !i.sent);
  if (items.length === 0) {
    showToast('No unsent items selected', { bg: hexToRgba(T.text, 0.45), duration: 2000 });
    return;
  }
  modifierSession.active = true;
  modifierSession.selectedItems = items.map((i) => i.id);
  modifierSession.activePrefix = null;
  modifierSession.activePlacement = null;
  modifierSession.appliedMods = [];
  modifierSession.activeSizes = {};

  // Detect pizza items for placement
  const catIds = [];
  items.forEach((i) => {
    if (i.category && catIds.indexOf(i.category) === -1) catIds.push(i.category);
  });
  modifierSession.hasPizza = hasPizzaCategory(catIds);
  modifierSession._catIds = catIds;

  // Collapse snake grid, show modifier panel
  if (_gridWrap) _gridWrap.style.display = 'none';

  let panel = buildModifierPanel(catIds);
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
  const plColor = MOD_COLORS.pizza.color;
  const plText  = MOD_COLORS.pizza.textColor;
  const dimText = hexToRgba(T.text, 0.6);

  const container = document.createElement('div');
  container.style.cssText = [
    'flex-shrink:0;height:44px;display:flex;align-items:stretch;',
    `background:${T.well};border-radius:${T.pillRadius};`,
    `overflow:hidden;border:1px solid ${T.border};`,
  ].join('');

  const segments = {};
  const order = ['left', 'whole', 'right'];

  order.forEach((id, i) => {
    const pl = PIZZA_PLACEMENTS.find((p) => p.id === id);
    if (!pl) return;
    let isActive = modifierSession.activePlacement === id;

    if (i > 0) {
      const div = document.createElement('div');
      div.style.cssText = `width:1px;background:${T.border};flex-shrink:0;align-self:stretch;`;
      container.appendChild(div);
    }

    let seg = document.createElement('div');
    seg.style.cssText = [
      `flex:${(id === 'whole' ? '2' : '1')};`,
      'display:flex;align-items:center;justify-content:center;',
      `font-family:${T.fh};font-size:13px;font-weight:700;letter-spacing:1px;`,
      `background:${(isActive ? plColor : 'transparent')};`,
      `color:${(isActive ? plText : dimText)};`,
      'cursor:pointer;transition:all 120ms;',
    ].join('');
    seg.textContent = pl.label.toUpperCase();

    seg.addEventListener('pointerup', (e) => {
      e.stopPropagation();
      modifierSession.activePlacement = id;
      refreshPlacementBar();
    });

    container.appendChild(seg);
    segments[id] = seg;
  });

  return { wrap: container, segments, plColor, plText, dimText };
}

function refreshPlacementBar() {
  let panel = modifierSession.panelEl;
  if (!panel || !panel._placeBar) return;
  let bar = panel._placeBar;

  ['left', 'whole', 'right'].forEach((id) => {
    let seg = bar.segments[id];
    if (!seg) return;
    let isActive = modifierSession.activePlacement === id;
    seg.style.background = isActive ? bar.plColor : 'transparent';
    seg.style.color = isActive ? bar.plText : bar.dimText;
  });
}

function buildModifierPanel(catIds) {
  let panel = document.createElement('div');
  panel.style.cssText = [
    'flex:1;display:flex;flex-direction:column;gap:4px;',
    `background:${T.card};`,
    `border-left:${T.accentBarW} solid ${T.gold};`,
    `border-radius:${T.chamferCard}px;`,
    'box-shadow:0 4px 16px rgba(0,0,0,0.28);',
    'padding:10px;overflow:hidden;',
    'margin:0 10px 10px;',
    `padding-bottom:${OVERLAP}px;`,
  ].join('');

  // ── PREFIX ROW ──
  const prefixRow = document.createElement('div');
  prefixRow.style.cssText = 'display:flex;gap:6px;flex-shrink:0;';
  panel._prefixBtns = {};

  UNI_PREFIXES.forEach((p) => {
    let isActive = modifierSession.activePrefix === p.id;
    let pDef = PREFIXES.find((x) => x.id === p.id) || {};
    let pColor = pDef.color || T.card;
    let pTextColor = pDef.textColor || T.text;

    let btn = buildPillButton({
      label: p.label,
      color: isActive ? pColor : T.card,
      fontSize: '26px',
      onClick: (e) => {
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
    let placeBar = buildPlacementBar();
    panel._placeBar = placeBar;
    panel.appendChild(placeBar.wrap);
  }

  // ── MODIFIER BUTTON GRID (replaces HexNav) ──
  const modData = getModHexData(catIds || []);
  panel._modData = modData;

  // Category tab bar
  const catTabBar = document.createElement('div');
  catTabBar.style.cssText = 'display:flex;gap:4px;flex-shrink:0;';
  panel._catTabBtns = {};
  const activeCatId = modData.length > 0 ? modData[0].id : null;
  panel._activeCatId = activeCatId;

  modData.forEach((cat) => {
    let isActive = cat.id === activeCatId;
    const catBtn = document.createElement('div');
    catBtn.style.cssText = [
      'flex:1;height:34px;display:flex;align-items:center;justify-content:center;',
      `font-family:${T.fh};font-size:20px;cursor:pointer;`,
      `border:2px solid ${cat.color};`,
      `background:${(isActive ? cat.color : T.card)};`,
      `color:${(isActive ? cat.textColor : cat.color)};`,
      'transition:background 80ms,color 80ms;',
    ].join('') + `;font-weight:${T.fwBold};`;
    catBtn.textContent = cat.label;
    catBtn.addEventListener('pointerup', (e) => {
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
  const gridWrap = document.createElement('div');
  gridWrap.style.cssText = 'flex:1;overflow-y:auto;overflow-x:hidden;scrollbar-width:none;-ms-overflow-style:none;';
  let grid = document.createElement('div');
  grid.style.cssText = 'display:grid;grid-template-columns:repeat(3,1fr);gap:6px;padding:4px;';
  gridWrap.appendChild(grid);
  panel._modGrid = grid;
  panel.appendChild(gridWrap);

  // Init: no deferred HexNav needed
  panel._initHexNav = () => {
    renderModButtonGrid(panel);
  };

  // ── APPLIED MODS LOG ──
  const logWrap = document.createElement('div');
  logWrap.style.cssText = [
    'max-height:100px;overflow-y:auto;scrollbar-width:none;-ms-overflow-style:none;',
    `background:${T.well};padding:4px 8px;flex-shrink:0;`,
    `border:1px solid ${T.border};border-radius:6px;`,
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
  const prefix = UNI_PREFIXES.find((p) => p.id === modifierSession.activePrefix);
  if (!prefix) return;

  const placement = modifierSession.hasPizza ? (modifierSession.activePlacement || 'whole') : null;
  let modName = prefix.label + ` ${mod.label}`;
  const modRefs = [];

  // Determine price based on prefix: ADD/EXTRA use modifier price, others are free
  const chargesPrice = prefix.id === 'add' || prefix.id === 'extra';
  let modPrice = chargesPrice ? (mod.price || 0) : 0;
  let charged = chargesPrice && modPrice > 0;

  modifierSession.selectedItems.forEach((id) => {
    let inst = ticket.find((i) => i.id === id);
    if (!inst) return;
    let isPizza = inst.category === 'pizza';
    let halfSide = null;
    if (isPizza && placement === 'left') halfSide = 'Left';
    else if (isPizza && placement === 'right') halfSide = 'Right';

    const modObj = { name: modName, price: modPrice, charged, prefix: halfSide };
    inst.mods.push(modObj);
    modRefs.push({ inst, mod: modObj });
  });

  const logLabel = modName + (charged ? ` +$${modPrice.toFixed(2)}` : '');
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

  // Active-sizes tracker — if this modifier belongs to a drives_pricing
  // group, record its name so calculateItemPrice picks up the new size.
  // mod.groupId is set by buildModifierPanel where available; fall back
  // to scanning MODIFIER_GROUPS for the modifier_id.
  let modGroupId = mod.groupId || mod.group_id;
  if (!modGroupId && mod.id && Array.isArray(MODIFIER_GROUPS)) {
    for (let gi = 0; gi < MODIFIER_GROUPS.length; gi++) {
      const grpScan = MODIFIER_GROUPS[gi];
      const members = (grpScan.modifiers || []);
      for (let mi = 0; mi < members.length; mi++) {
        if (members[mi].modifier_id === mod.id) { modGroupId = grpScan.group_id; break; }
      }
      if (modGroupId) break;
    }
  }
  if (modGroupId) {
    const grpDef = (Array.isArray(MODIFIER_GROUPS) ? MODIFIER_GROUPS : [])
      .find((g) => g && g.group_id === modGroupId);
    if (grpDef && grpDef.drives_pricing) {
      modifierSession.activeSizes[modGroupId] = mod.label || mod.name;
    }
  }

  renderTicket();
  refreshModifierPanel();
}

function refreshModifierPanel() {
  const panel = modifierSession.panelEl;
  if (!panel) return;

  // Refresh prefix button states
  UNI_PREFIXES.forEach((p) => {
    let btn = panel._prefixBtns[p.id];
    if (!btn) return;
    let isActive = modifierSession.activePrefix === p.id;
    let pDef = PREFIXES.find((x) => x.id === p.id) || {};
    const pColor = pDef.color || T.card;
    const pTextColor = pDef.textColor || T.text;
    const inner = btn.firstElementChild || btn.querySelector('div');
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
  panel._modData.forEach((cat) => {
    let btn = panel._catTabBtns[cat.id];
    if (!btn) return;
    let isActive = panel._activeCatId === cat.id;
    btn.style.background = isActive ? cat.color : T.card;
    btn.style.color = isActive ? cat.textColor : cat.color;
  });
}

function renderModButtonGrid(panel) {
  let grid = panel._modGrid;
  if (!grid) return;
  grid.innerHTML = '';

  let activeCat = null;
  (panel._modData || []).forEach((cat) => {
    if (cat.id === panel._activeCatId) activeCat = cat;
  });
  if (!activeCat) return;

  let catColor = activeCat.color;
  const catText = activeCat.textColor;

  // Flatten all items from all subcats
  (activeCat.subcats || []).forEach((sub) => {
    (sub.items || []).forEach((item) => {
      let btn = document.createElement('div');
      btn.style.cssText = [
        'display:flex;align-items:center;justify-content:center;',
        'height:52px;cursor:pointer;',
        `font-family:${T.fb};font-size:22px;font-weight:${T.fwBold};`,
        'text-align:center;word-break:break-word;',
        `background:${T.card};`,
        `color:${catText};`,
        `border:2px solid ${catColor};`,
        'transition:background 80ms;',
        'touch-action:manipulation;pointer-events:auto;',
      ].join('');
      btn.textContent = item.label;

      btn.addEventListener('pointerdown', () => {
        btn.style.background = catColor;
        btn.style.color = activeCat.textColor === catText ? T.text : catText;
      });
      btn.addEventListener('pointerup', () => {
        btn.style.background = T.card;
        btn.style.color = catText;
        applyModifier(item);
      });
      btn.addEventListener('pointerleave', () => {
        btn.style.background = T.card;
        btn.style.color = catText;
      });

      grid.appendChild(btn);
    });
  });
}

function renderAppliedModsLog(panel) {
  const log = panel._log;
  if (!log) return;
  log.innerHTML = '';

  if (modifierSession.appliedMods.length === 0) {
    const empty = document.createElement('div');
    empty.style.cssText = `font-family:${T.fb};font-size:30px;color:${hexToRgba(T.text, 0.6)};text-align:center;padding:4px 0;;font-weight:${T.fwBold};`;
    empty.textContent = 'No modifiers applied';
    log.appendChild(empty);
    return;
  }

  modifierSession.appliedMods.forEach((entry, idx) => {
    let row = document.createElement('div');
    row.style.cssText = `display:flex;justify-content:space-between;align-items:center;font-family:${T.fb};font-size:30px;color:${T.gold};line-height:1.2;;font-weight:${T.fwBold};`;
    let label = document.createElement('span');
    label.textContent = entry.logLabel || (entry.prefixLabel + ` \u2192 ${entry.modLabel}`);
    row.appendChild(label);
    const removeBtn = document.createElement('span');
    removeBtn.textContent = '\u2715';
    removeBtn.style.cssText = `color:${T.verm};cursor:pointer;padding:0 4px;font-size:28px;flex-shrink:0;touch-action:manipulation;pointer-events:auto;;font-weight:${T.fwBold};`;
    removeBtn.addEventListener('pointerup', ((i) => {
      return (e) => {
        e.stopPropagation();
        const removed = modifierSession.appliedMods.splice(i, 1)[0];
        removed.modRefs.forEach((ref) => {
          const mIdx = ref.inst.mods.indexOf(ref.mod);
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
    const resetBtn = buildPillButton({
      label: 'RESET ALL',
      color: T.verm,
      fontSize: '11px',
      onClick: () => {
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
  const last = modifierSession.appliedMods.pop();

  // Remove the mod from all affected items
  last.modRefs.forEach((ref) => {
    let idx = ref.inst.mods.indexOf(ref.mod);
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
    let entry = modifierSession.appliedMods.pop();
    entry.modRefs.forEach((ref) => {
      let idx = ref.inst.mods.indexOf(ref.mod);
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
  ticket.forEach((i) => { i.selected = false; });

  // Restore grid
  if (_gridWrap) _gridWrap.style.display = '';

  renderTicket();
  rebuildBottomBar();
}


// ── KIND MODIFIER PANEL — inline replacement for modifier-panel.js ────────
// Builds our Vz2.0 modifier UI directly. Returns { destroy() }.

const _PREFIX_DEFS = [
  { id:'ADD',     label:'ADD',     color: null },  // T.greenWarm
  { id:'EXTRA',   label:'EXTRA',   color: null },  // T.elec
  { id:'NO',      label:'NO',      color: null },  // T.verm
  { id:'ON SIDE', label:'ON SIDE', color: null },  // T.gold
  { id:'LITE',    label:'LITE',    color: null },  // T.gold
];

const _PLACE_DEFS = [
  { id:'LEFT',  label:'½ LEFT'  },
  { id:'WHOLE', label:'WHOLE'   },
  { id:'RIGHT', label:'RIGHT ½' },
];

function _prefixColor(id) {
  if (id === 'ADD')     return T.modAdd;
  if (id === 'EXTRA')   return T.modExtra;
  if (id === 'NO')      return T.modNo;
  if (id === 'ON SIDE') return T.modOnSide;
  if (id === 'LITE')    return T.modLite;
  return T.card;
}

function buildKindModPanel(container, item, modConfig, catColor, enablePlacement, callbacks) {
  modConfig = modConfig || {};
  let includedItems   = modConfig.includedItems   || [];
  let mandatoryGroups = modConfig.mandatoryGroups || [];
  let optionalGroups  = modConfig.optionalGroups  || [];
  const isPizza = !!enablePlacement;

  // ── State ──────────────────────────────────────────
  const inclState  = {};   // mod.id  → 'NO'|'ON SIDE'
  const optState   = {};   // optId   → { prefix, placement }
  const mandState  = {};   // groupKey → { key, label, price }
  let activePrefix = 'ADD';
  let activePlacement = 'WHOLE';
  let inclPrefix = 'NO';
  let openSubKey = null;

  const PREFIX_MAP = [
    { id:'ADD',   label:'ADD',     color:T.modAdd,    textColor:T.well, dk:T.modAddDk    },
    { id:'EXTRA', label:'EXTRA',   color:T.modExtra,  textColor:T.well, dk:T.modExtraDk  },
    { id:'NO',    label:'NO',      color:T.modNo,     textColor:T.well, dk:T.modNoDk     },
    { id:'SIDE',  label:'ON SIDE', color:T.modOnSide, textColor:T.well, dk:T.modOnSideDk },
    { id:'LITE',  label:'LITE',    color:T.modLite,   textColor:T.well, dk:T.modLiteDk   },
  ];

  // ── Root overlay ────────────────────────────────────
  const ov = document.createElement('div');
  ov.style.cssText = [
    'flex:1;min-height:0;',
    `background:${T.bg};`,
    'display:flex;flex-direction:column;',
    'overflow:hidden;',
  ].join('');

  // strip is rendered by openModifierPanel as a separate _mainArea flex child
  const itemPx = Number(item.price) || 0;

  // ── Scrollable content ──────────────────────────────
  const scroll = document.createElement('div');
  scroll.style.cssText = 'flex:1;overflow-y:auto;padding:8px 14px 10px;';
  ov.appendChild(scroll);

  // ── DONE button ─────────────────────────────────────
  const doneWrap = document.createElement('div');
  doneWrap.style.cssText = 'flex-shrink:0;padding:8px 14px 10px;';
  const doneBtn = buildPillButton({ label: 'DONE — ADD TO CHECK', color: T.green, textColor: T.well });
  doneBtn.style.width = '100%';
  doneBtn.style.fontSize = '16px';
  doneBtn.addEventListener('pointerup', () => { callbacks.onSend(_buildActiveItem()); });
  doneBtn.disabled = mandatoryGroups.some((g) => !mandState[g.key]);
  doneWrap.appendChild(doneBtn);
  ov.appendChild(doneWrap);

  // ── Build active item for commit ─────────────────────
  function _buildActiveItem() {
    let pricingDriverKey = modConfig.pricingDriverKey;
    const pricingDriverValue = pricingDriverKey ? (mandState[pricingDriverKey] ? mandState[pricingDriverKey].key : null) : null;

    const optMods = [];
    Object.keys(optState).forEach((optId) => {
      let s = optState[optId];
      if (!s) return;
      // Find the option def
      let found = null;
      optionalGroups.forEach((g) => {
        (g.options || []).forEach((o) => {
          if ((o.id || o.key) === optId) found = o;
        });
      });
      if (!found) return;

      let resolvedPrice = found.price || 0;
      if (pricingDriverValue && found.priceByOption && found.priceByOption[pricingDriverValue] !== undefined) {
        resolvedPrice = found.priceByOption[pricingDriverValue];
      }

      const placeMap = { 'LEFT': '1st', 'RIGHT': '2nd', 'WHOLE': null };
      optMods.push({
        prefix:    s.prefix,
        label:     found.label,
        price:     resolvedPrice,
        placement: placeMap[s.placement] || null,
      });
    });

    const removals = Object.keys(inclState).filter((id) => inclState[id] === 'NO');

    // Build mandatory selections map
    const mandSel = {};
    Object.keys(mandState).forEach((k) => {
      let s = mandState[k];
      let grp = mandatoryGroups.find((g) => g.key === k);
      const opt = grp ? (grp.options || []).find((o) => (o.key || o.id) === s.key) : null;

      let resolvedPrice = s.price;
      if (opt && pricingDriverValue && opt.priceByOption && opt.priceByOption[pricingDriverValue] !== undefined) {
        resolvedPrice = opt.priceByOption[pricingDriverValue];
      }
      mandSel[k] = { key: s.key, label: s.label, price: resolvedPrice };
    });

    // Build preview mods for ticket
    let previewMods = [];

    // 1. Mandatory selections (e.g. Size, Crust)
    Object.keys(mandSel).forEach((k) => {
      let s = mandSel[k];
      previewMods.push({ name: s.label, price: s.price || 0, charged: (s.price > 0), prefix: null });
    });

    // 2. Included items (Pre-applied) — show even if not modified, unless removed
    includedItems.forEach((inc) => {
      if (inclState[inc.id] !== 'SIDE') return;   // NO handled by removals below
      previewMods.push({ name: `ON SIDE ${inc.label}`, price: 0, charged: false, prefix: null });
    });

    // 3. Removals (NO X)
    removals.forEach((rid) => {
      const inc = includedItems.find((i) => i.id === rid);
      if (inc) previewMods.push({ name: `NO ${inc.label}`, price: 0, charged: false, prefix: null });
    });

    // 4. Optional modifiers
    optMods.forEach((m) => {
      let halfSide = m.placement === '1st' ? 'Left' : m.placement === '2nd' ? 'Right' : null;
      let charged = (m.prefix === 'ADD' || m.prefix === 'EXTRA') && m.price > 0;
      // `activePrefix` starts as null (line 1312) and stays null until
      // the server taps ADD/NO/EXTRA/etc. A modifier picked before any
      // prefix is chosen previously rendered as "null Pepperoni" on
      // both the preview and (via commitModifierPanelItem) the kitchen
      // ticket. formatModifierLabel handles the null-prefix fallback
      // so the commit path (below) and this preview stay in lockstep.
      let displayName = formatModifierLabel(m.prefix, m.label);
      previewMods.push({ name: displayName, price: charged ? m.price : 0, charged, prefix: halfSide });
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
    const savedTop = scroll.scrollTop;
    scroll.innerHTML = '';

    // ── SNAKE BREADCRUMB CARD — matches grid tile style ──
    const snakeCard = document.createElement('div');
    snakeCard.style.cssText = [
      'display:flex;gap:6px;align-items:stretch;',
      'margin-bottom:12px;',
    ].join('');

    // Crumb tiles — filled, same style as buildCrumbTile
    snakeState.crumbs.forEach((crumb) => {
      let tile = document.createElement('div');
      tile.style.cssText = [
        'display:flex;align-items:center;justify-content:center;',
        'padding:10px 14px;border-radius:10px;min-height:95px;',
        `background:${crumb.color};`,
        `border-left:4px solid ${crumb.color};`,
        `box-shadow:0 4px 0 ${hexToRgba(crumb.color, 0.55)};`,
        `font-family:${T.fh};font-weight:700;font-size:22px;`,
        `color:${T.well};letter-spacing:1px;pointer-events:none;`,
      ].join('');
      tile.textContent = crumb.label;
      snakeCard.appendChild(tile);
    });

    // Item tile — same style as buildItemTile but filled, tap to cancel
    const itemTile = document.createElement('div');
    itemTile.style.cssText = [
      'display:flex;flex-direction:column;justify-content:center;',
      'padding:10px 14px;border-radius:10px;cursor:pointer;',
      `background:${catColor};`,
      `border-left:4px solid ${catColor};`,
      `box-shadow:0 4px 0 ${hexToRgba(catColor, 0.55)};`,
      'pointer-events:auto;touch-action:manipulation;',
      'min-height:95px;min-width:120px;',
    ].join('');
    const icn = document.createElement('span');
    icn.style.cssText = `font-family:${T.fh};font-weight:700;font-size:22px;color:${T.well};pointer-events:none;`;
    icn.textContent = item.label;
    const icp = document.createElement('span');
    icp.style.cssText = `font-family:${T.fb};font-size:14px;color:${hexToRgba(T.well, 0.65)};margin-top:4px;pointer-events:none;;font-weight:${T.fwBold};`;
    icp.textContent = `$${itemPx.toFixed(2)}`;
    itemTile.appendChild(icn);
    itemTile.appendChild(icp);
    itemTile.addEventListener('pointerup', () => { callbacks.onCancel(); });
    snakeCard.appendChild(itemTile);
    scroll.appendChild(snakeCard);

    // ── Accordion state ──────────────────────────
    const defaultCard =
      includedItems.length  > 0 ? 'included' :
      mandatoryGroups.length > 0 ? 'mandatory' : 'optional';
    if (!renderContent._activeCard) renderContent._activeCard = defaultCard;
    const activeCard = renderContent._activeCard;

    function setActiveCard(id) {
      renderContent._activeCard = id;
      renderContent();
    }

    // ── Accordion container ───────────────────────
    const accWrap = document.createElement('div');
    accWrap.style.cssText = [
      'display:flex;flex-direction:column;gap:8px;',
      'padding:8px 14px 10px;',
    ].join('');

    const CARD_DEFS = [
      { id:'included',  title:'INCLUDED',  show: includedItems.length > 0 },
      { id:'mandatory', title:'MANDATORY', show: mandatoryGroups.length > 0 },
      { id:'optional',  title:'OPTIONS',   show: true },
    ];

    CARD_DEFS.forEach((def) => {
      if (!def.show) return;
      const isExp = activeCard === def.id;

      let card = document.createElement('div');
      card.dataset.accCard = def.id;
      card.style.cssText = [
        `background:${T.card};`,
        'border-radius:10px;overflow:hidden;flex-shrink:0;',
        `border-left:4px solid ${(isExp ? _accColor(def.id) : T.border)};`,
        'box-shadow:0 4px 12px rgba(0,0,0,0.25);',
        'transition:border-color 0.15s;',
        'pointer-events:auto;',
      ].join('');

      // Header
      const hdr = document.createElement('div');
      hdr.style.cssText = [
        'display:flex;align-items:center;gap:10px;',
        'padding:0 14px;height:44px;cursor:pointer;',
        'user-select:none;touch-action:manipulation;',
        'pointer-events:auto;',
      ].join('');
      hdr.addEventListener('pointerdown', () => {
        hdr.style.background = 'rgba(255,255,255,0.03)';
      });
      hdr.addEventListener('pointerleave', () => {
        hdr.style.background = '';
      });
      hdr.addEventListener('pointerup', () => {
        hdr.style.background = '';
      });
      hdr.addEventListener('pointerup', () => { setActiveCard(def.id); });

      const titleEl = document.createElement('span');
      titleEl.style.cssText = [
        `font-family:${T.fb};font-size:${T.fsB3};font-weight:700;`,
        'letter-spacing:2px;flex-shrink:0;',
        `color:${(isExp ? _accColor(def.id) : T.moon)};`,
      ].join('');
      titleEl.textContent = def.title;
      hdr.appendChild(titleEl);

      // Action area (expanded only) — placeholder, filled per card below
      const actionArea = document.createElement('div');
      actionArea.style.cssText = 'display:flex;align-items:center;gap:5px;flex:1;';
      actionArea.dataset.actionArea = def.id;
      hdr.appendChild(actionArea);

      // Status chip (collapsed only) — placeholder
      const chipWrap = document.createElement('span');
      chipWrap.dataset.chipWrap = def.id;
      hdr.appendChild(chipWrap);

      // Chevron
      let chev = document.createElement('span');
      chev.style.cssText = [
        `font-size:${T.fsB4};color:${T.border};margin-left:auto;`,
        'transition:transform 0.15s;flex-shrink:0;',
        `transform:${(isExp ? 'rotate(180deg)' : 'none')};`,
      ].join('');
      chev.textContent = '▼';
      hdr.appendChild(chev);

      card.appendChild(hdr);

      // Body
      const body = document.createElement('div');
      body.style.cssText = `padding:8px 10px 10px;${(isExp ? '' : 'display:none;')}`;
      body.dataset.cardBody = def.id;
      card.appendChild(body);

      accWrap.appendChild(card);

      if (def.id === 'included') {
        _buildInclCard(actionArea, chipWrap, body, isExp);
      }
      if (def.id === 'mandatory') {
        _buildMandCard(chipWrap, body);
      }
      if (def.id === 'optional') {
        _buildOptCard(actionArea, body, isExp);
      }
    });

    scroll.appendChild(accWrap);

    // ── Helper: accent color per card ────────────
    function _accColor(id) {
      if (id === 'optional') return T.greenWarm;
      return catColor || T.green;
    }

    function _buildInclCard(actionArea, chipWrap, body, isExp) {

      // ── Header buttons (expanded only) ───────────
      if (isExp) {
        ['NO','SIDE'].forEach((pid) => {
          let p = PREFIX_MAP.find((x) => x.id === pid);
          let isActive = inclPrefix === pid;
          let btn = document.createElement('button');
          btn.style.cssText = [
            'padding:4px 11px;border-radius:6px;',
            `font-family:${T.fb};font-size:${T.fsB4};font-weight:700;`,
            'letter-spacing:0.5px;cursor:pointer;white-space:nowrap;',
            `border:1px solid ${(isActive ? p.color : T.border)};`,
            `background:${(isActive ? p.color : T.well)};`,
            `color:${(isActive ? p.textColor : T.text)};`,
            `box-shadow:0 3px 0 ${(isActive ? p.dk : T.moonDk)};`,
            'touch-action:manipulation;pointer-events:auto;',
          ].join('');
          btn.textContent = p.label;
          btn.addEventListener('pointerup', (e) => {
            e.stopPropagation();
            inclPrefix = (inclPrefix === pid) ? null : pid;
            renderContent();
          });
          actionArea.appendChild(btn);
        });
      }

      // ── Status chip (collapsed only) ─────────────
      if (!isExp) {
        const nCount = Object.keys(inclState).filter((k) => inclState[k]==='NO').length;
        const sCount = Object.keys(inclState).filter((k) => inclState[k]==='SIDE').length;
        const parts = [];
        if (nCount) parts.push(nCount + ' NO');
        if (sCount) parts.push(sCount + ' SIDE');
        if (parts.length) {
          let chip = document.createElement('span');
          chip.style.cssText = [
            'display:inline-flex;align-items:center;gap:5px;',
            'padding:2px 8px;border-radius:6px;white-space:nowrap;',
            `font-family:${T.fb};font-size:${T.fsB4};font-weight:700;`,
            `background:rgba(74,222,128,0.1);color:${T.greenWarm};`,
            'border:1px solid rgba(74,222,128,0.25);',
          ].join('');
          chip.textContent = parts.join(' · ');
          chipWrap.appendChild(chip);
        }
      }

      // ── Tile grid ────────────────────────────────
      let grid = document.createElement('div');
      grid.style.cssText = [
        'display:grid;',
        'grid-template-columns:repeat(auto-fill,minmax(108px,1fr));',
        'gap:6px;',
      ].join('');

      includedItems.forEach((inc) => {
        let s = inclState[inc.id] || null;
        let tile = document.createElement('div');

        let bg   = s==='NO' ? T.verm : s==='SIDE' ? T.modOnSide : T.well;
        let fg   = s==='NO' ? '#fff' : s==='SIDE' ? T.well      : T.text;
        let shDk = s==='NO' ? T.modNoDk : s==='SIDE' ? T.modOnSideDk : T.moonDk;

        tile.style.cssText = [
          'height:44px;border-radius:8px;',
          'display:flex;flex-direction:column;',
          'align-items:center;justify-content:center;gap:1px;',
          `font-family:${T.fb};font-weight:700;`,
          `background:${bg};color:${fg};`,
          `border:1px solid ${(s ? bg : T.border)};`,
          `box-shadow:0 3px 0 ${shDk};`,
          'cursor:pointer;touch-action:manipulation;pointer-events:auto;',
          'transition:all 0.08s;user-select:none;',
        ].join('');

        if (s) {
          let tag = document.createElement('span');
          tag.style.cssText = `font-size:${T.fsB4};font-weight:700;opacity:0.8;pointer-events:none;`;
          tag.textContent = s === 'SIDE' ? 'ON SIDE' : s;
          tile.appendChild(tag);
        }
        let lbl = document.createElement('span');
        lbl.style.cssText = `font-size:${T.fsB3};pointer-events:none;`;
        lbl.textContent = inc.label;
        tile.appendChild(lbl);

        tile.addEventListener('pointerdown', () => {
          tile.style.transform='translateY(2px)';
          tile.style.boxShadow=`0 1px 0 ${shDk}`;
        });
        tile.addEventListener('pointerup', () => {
          tile.style.transform='';
          tile.style.boxShadow=`0 3px 0 ${shDk}`;
          if (!inclPrefix) return;
          if (inclState[inc.id]===inclPrefix) delete inclState[inc.id];
          else inclState[inc.id]=inclPrefix;
          renderContent();
        });
        tile.addEventListener('pointerleave', () => {
          tile.style.transform='';
          tile.style.boxShadow=`0 3px 0 ${shDk}`;
        });
        grid.appendChild(tile);
      });

      body.appendChild(grid);
    }

    function _buildMandCard(chipWrap, body) {

      // ── Status chip (collapsed only) ─────────────
      if (activeCard !== 'mandatory') {
        const pending = mandatoryGroups.filter((g) => !mandState[g.key]);
        if (pending.length) {
          let chip = document.createElement('span');
          chip.style.cssText = [
            'display:inline-flex;align-items:center;gap:5px;',
            'padding:2px 8px;border-radius:6px;white-space:nowrap;',
            `font-family:${T.fb};font-size:${T.fsB4};font-weight:700;`,
            `background:rgba(251,191,36,0.12);color:${T.modLite};`,
            'border:1px solid rgba(251,191,36,0.3);',
          ].join('');
          chip.textContent = pending.length + ' REQUIRED';
          chipWrap.appendChild(chip);
        } else {
          mandatoryGroups.forEach((g) => {
            if (!mandState[g.key]) return;
            const sc = document.createElement('span');
            sc.style.cssText = [
              'display:inline-flex;padding:2px 7px;border-radius:6px;',
              `font-family:${T.fb};font-size:${T.fsB4};font-weight:700;`,
              `background:rgba(232,200,78,0.12);color:${T.gold};`,
              'border:1px solid rgba(232,200,78,0.3);white-space:nowrap;',
              'margin-right:4px;',
            ].join('');
            sc.textContent = mandState[g.key].label.toUpperCase();
            chipWrap.appendChild(sc);
          });
        }
      }

      // ── Two-column tile grid ──────────────────────
      const grid = document.createElement('div');
      grid.style.cssText = 'display:grid;grid-template-columns:1fr 1fr;gap:6px;';

      mandatoryGroups.forEach((g) => {
        const chosen  = mandState[g.key] || null;
        let isOpen  = openSubKey === g.key;

        // Group tile
        let tile = document.createElement('div');
        const barColor = isOpen||chosen ? T.gold : (g.required ? T.modLite : T.border);
        tile.style.cssText = [
          'height:52px;border-radius:8px;position:relative;overflow:hidden;',
          'display:flex;flex-direction:column;justify-content:center;',
          'padding:0 12px 0 14px;cursor:pointer;',
          `background:${T.well};`,
          `border:1px solid ${T.border};`,
          `box-shadow:0 3px 0 ${T.moonDk};`,
          'touch-action:manipulation;pointer-events:auto;user-select:none;',
          'transition:all 0.08s;',
        ].join('');

        // Left bar
        const bar = document.createElement('div');
        bar.style.cssText = [
          'position:absolute;left:0;top:0;bottom:0;width:3px;',
          `background:${barColor};pointer-events:none;`,
        ].join('');
        tile.appendChild(bar);

        const glabel = document.createElement('div');
        glabel.style.cssText = [
          `font-family:${T.fb};font-size:${T.fsB4};font-weight:700;`,
          'letter-spacing:1.5px;pointer-events:none;',
          `color:${(g.required && !chosen ? T.modLite : T.moon)};`,
        ].join('');
        glabel.textContent = g.label;
        tile.appendChild(glabel);

        if (chosen) {
          const gval = document.createElement('div');
          gval.style.cssText = [
            `font-family:${T.fb};font-size:${T.fsB3};font-weight:700;`,
            `color:${T.gold};margin-top:2px;pointer-events:none;`,
          ].join('');
          gval.textContent = chosen.label;
          tile.appendChild(gval);
        } else {
          const gpend = document.createElement('div');
          gpend.style.cssText = [
            `font-family:${T.fb};font-size:${T.fsB4};font-weight:700;`,
            `font-style:italic;color:${T.modLite};`,
            'margin-top:2px;pointer-events:none;',
          ].join('');
          gpend.textContent = 'tap to select →';
          tile.appendChild(gpend);
        }

        tile.addEventListener('pointerdown', () => {
          tile.style.transform='translateY(2px)';
          tile.style.boxShadow=`0 1px 0 ${T.moonDk}`;
        });
        tile.addEventListener('pointerup', () => {
          tile.style.transform='';
          tile.style.boxShadow=`0 3px 0 ${T.moonDk}`;
          openSubKey = (openSubKey===g.key) ? null : g.key;
          renderContent();
        });
        tile.addEventListener('pointerleave', () => {
          tile.style.transform='';
          tile.style.boxShadow=`0 3px 0 ${T.moonDk}`;
        });
        grid.appendChild(tile);

        // Sub-card (spans both columns)
        if (isOpen) {
          const sub = document.createElement('div');
          sub.style.cssText = [
            'grid-column:1/-1;display:block;',
            'background:rgba(34,37,42,0.85);border-radius:8px;',
            'border:1px solid rgba(232,200,78,0.22);padding:8px;',
          ].join('');

          const subLbl = document.createElement('div');
          subLbl.style.cssText = [
            `font-family:${T.fb};font-size:${T.fsB4};font-weight:700;`,
            `letter-spacing:1.5px;color:${T.gold};margin-bottom:7px;`,
          ].join('');
          subLbl.textContent = `SELECT ${g.label}`;
          sub.appendChild(subLbl);

          const subGrid = document.createElement('div');
          subGrid.style.cssText = [
            'display:grid;',
            'grid-template-columns:repeat(auto-fill,minmax(100px,1fr));',
            'gap:5px;',
          ].join('');

          (g.options || []).forEach((opt) => {
            const isSel = chosen && chosen.key === (opt.key||opt.id);
            const st = document.createElement('div');
            st.style.cssText = [
              'height:36px;border-radius:6px;',
              'display:flex;align-items:center;justify-content:center;',
              `font-family:${T.fb};font-size:${T.fsB4};font-weight:700;`,
              'letter-spacing:0.3px;cursor:pointer;',
              `background:${(isSel ? T.gold  : T.card)};`,
              `color:${(isSel ? T.well  : T.text)};`,
              `border:1px solid ${(isSel ? T.gold : T.border)};`,
              `box-shadow:0 2px 0 ${(isSel ? T.goldDk : T.moonDk)};`,
              'touch-action:manipulation;pointer-events:auto;user-select:none;',
              'transition:all 0.08s;',
            ].join('');
            st.textContent = opt.label.toUpperCase();
            st.addEventListener('pointerup', (e) => {
              e.stopPropagation();
              mandState[g.key] = {
                key:   opt.key || opt.id,
                label: opt.label,
                price: opt.price || 0,
              };
              openSubKey = null;
              doneBtn.disabled = mandatoryGroups.some((g) => !mandState[g.key]);
              renderContent();
            });
            subGrid.appendChild(st);
          });

          sub.appendChild(subGrid);
          grid.appendChild(sub);
        }
      });

      body.appendChild(grid);
    }

    function _buildOptCard(actionArea, body, isExp) {

      // ── Prefix toolbar (expanded only) ───────────
      if (isExp) {
        PREFIX_MAP.forEach((p) => {
          let isActive = activePrefix === p.id;
          const btn = document.createElement('button');
          btn.style.cssText = [
            'padding:4px 11px;border-radius:6px;',
            `font-family:${T.fb};font-size:${T.fsB4};font-weight:700;`,
            'letter-spacing:0.5px;cursor:pointer;white-space:nowrap;',
            `border:1px solid ${(isActive ? p.color : T.border)};`,
            `background:${(isActive ? p.color : T.well)};`,
            `color:${(isActive ? p.textColor : T.text)};`,
            `box-shadow:0 3px 0 ${(isActive ? p.dk : T.moonDk)};`,
            'touch-action:manipulation;pointer-events:auto;',
          ].join('');
          btn.textContent = p.label;
          btn.addEventListener('pointerup', (e) => {
            e.stopPropagation();
            activePrefix = p.id;
            renderContent();
          });
          actionArea.appendChild(btn);
        });
      }

      // ── Placement bar (pizza only) ────────────────
      if (isPizza) {
        const placeBar = document.createElement('div');
        placeBar.style.cssText = [
          'display:flex;gap:3px;margin-bottom:10px;',
          `background:${T.well};border-radius:10px;padding:3px;`,
        ].join('');
        _PLACE_DEFS.forEach((pl) => {
          const isActive = activePlacement === pl.id;
          const seg = document.createElement('div');
          seg.style.cssText = [
            `flex:${(pl.id === 'WHOLE' ? 2 : 1)};text-align:center;`,
            'padding:7px 8px;border-radius:8px;cursor:pointer;',
            'pointer-events:auto;touch-action:manipulation;',
            `font-family:${T.fb};font-weight:700;font-size:${T.fsB4};letter-spacing:1px;`,
            `color:${(isActive ? T.well : T.moon)};`,
            `background:${(isActive ? catColor : 'transparent')};`,
            `box-shadow:${(isActive ? '0 3px 0 ' + hexToRgba(catColor, 0.55) : 'none')};`,
            'transition:all 120ms;',
          ].join('');
          seg.textContent = pl.label;
          seg.addEventListener('pointerup', () => {
            activePlacement = pl.id;
            renderContent();
          });
          placeBar.appendChild(seg);
        });
        body.appendChild(placeBar);
      }

      // ── Option tile grid ─────────────────────────
      const outerGrid = document.createElement('div');
      outerGrid.style.cssText = 'display:flex;flex-direction:column;gap:6px;';

      optionalGroups.forEach((g) => {
        if (g.label) {
          const secLbl = document.createElement('div');
          secLbl.style.cssText = [
            `font-family:${T.fb};font-size:${T.fsB4};font-weight:700;`,
            `letter-spacing:2px;color:${T.greenWarm};`,
            'margin-top:4px;margin-bottom:2px;',
            'display:flex;align-items:center;gap:8px;',
          ].join('');
          const line = document.createElement('div');
          line.style.cssText = 'height:1px;flex:1;background:rgba(74,222,128,0.2);';
          secLbl.textContent = g.label;
          secLbl.appendChild(line);
          outerGrid.appendChild(secLbl);
        }

        const tileGrid = document.createElement('div');
        tileGrid.style.cssText = [
          'display:grid;',
          'grid-template-columns:repeat(auto-fill,minmax(108px,1fr));',
          'gap:6px;',
        ].join('');

        (g.options || []).forEach((opt) => {
          const optId = opt.id || opt.key;
          const s     = optState[optId] || null;
          const pDef  = s ? PREFIX_MAP.find((p) => p.id===s.prefix) : null;

          const bg   = pDef ? pDef.color     : T.well;
          const fg   = pDef ? pDef.textColor : T.text;
          const shDk = pDef ? pDef.dk        : T.moonDk;

          const tile = document.createElement('div');
          tile.style.cssText = [
            'height:44px;border-radius:8px;',
            'display:flex;flex-direction:column;',
            'align-items:center;justify-content:center;gap:1px;',
            `font-family:${T.fb};font-weight:700;`,
            `background:${bg};color:${fg};`,
            `border:1px solid ${(s ? bg : T.border)};`,
            `box-shadow:0 3px 0 ${shDk};`,
            'cursor:pointer;touch-action:manipulation;pointer-events:auto;',
            'user-select:none;transition:all 0.08s;',
          ].join('');

          if (s && pDef) {
            const tag = document.createElement('span');
            tag.style.cssText = `font-size:${T.fsB4};font-weight:700;opacity:0.8;pointer-events:none;`;
            tag.textContent = pDef.label;
            tile.appendChild(tag);
          }
          const lbl = document.createElement('span');
          lbl.style.cssText = `font-size:${T.fsB3};pointer-events:none;`;
          lbl.textContent = opt.label;
          tile.appendChild(lbl);

          tile.addEventListener('pointerdown', () => {
            tile.style.transform='translateY(2px)';
            tile.style.boxShadow=`0 1px 0 ${shDk}`;
          });
          tile.addEventListener('pointerup', () => {
            tile.style.transform='';
            tile.style.boxShadow=`0 3px 0 ${shDk}`;
            const _cur = optState[optId];
            if (!_cur) {
              optState[optId] = { prefix: activePrefix, placement: activePlacement };
            } else if (_cur.prefix === 'ADD' && activePrefix === 'ADD') {
              optState[optId] = { prefix: 'EXTRA', placement: activePlacement };
            } else if (_cur.prefix === 'EXTRA' && activePrefix === 'ADD') {
              delete optState[optId];
            } else if (_cur.prefix === activePrefix) {
              delete optState[optId];
            } else {
              optState[optId] = { prefix: activePrefix, placement: activePlacement };
            }
            renderContent();
          });
          tile.addEventListener('pointerleave', () => {
            tile.style.transform='';
            tile.style.boxShadow=`0 3px 0 ${shDk}`;
          });
          tileGrid.appendChild(tile);
        });

        outerGrid.appendChild(tileGrid);
      });

      body.appendChild(outerGrid);
    }

    _buildActiveItem();
  }

  renderContent();
  container.appendChild(ov);

  return {
    destroy: () => {
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
    onUpdate: (outputItem) => { _modPanelItem = outputItem; renderTicket(); },
    onSend:   (activeItem) => { commitModifierPanelItem(item, activeItem, modConfig); },
    onCancel: () => { closeModifierPanel(); },
  });
  renderTicket();
}

function _buildSnakeStrip(item, catColor) {
  if (!_snakeStrip) return;
  _snakeStrip.innerHTML = '';
  _snakeStrip.style.display = 'flex';

  // Crumb tiles
  snakeState.crumbs.forEach((crumb) => {
    const chip = document.createElement('div');
    chip.style.cssText = [
      `background:${crumb.color};border-radius:8px;`,
      `border-left:4px solid ${crumb.color};`,
      `padding:6px 16px;font-family:${T.fh};`,
      `font-weight:700;font-size:14px;color:${T.well};letter-spacing:1px;`,
      'pointer-events:none;',
    ].join('');
    chip.textContent = crumb.label;
    _snakeStrip.appendChild(chip);
  });

  // Item chip — tap to cancel
  const itemChip = document.createElement('div');
  itemChip.style.cssText = [
    `background:${catColor};border-radius:8px;`,
    `border-left:4px solid ${catColor};`,
    `padding:6px 16px;font-family:${T.fh};`,
    `font-weight:700;font-size:14px;color:${T.well};letter-spacing:1px;`,
    'display:flex;align-items:center;gap:8px;cursor:pointer;',
    'pointer-events:auto;touch-action:manipulation;',
    `box-shadow:0 0 12px ${hexToRgba(catColor, 0.5)};`,
  ].join('');
  const itemName = document.createElement('span');
  itemName.style.cssText = 'pointer-events:none;';
  itemName.textContent = item.label;
  const itemPrice = document.createElement('span');
  itemPrice.style.cssText = `font-family:${T.fb};font-size:13px;color:rgba(255,255,255,0.7);pointer-events:none;;font-weight:${T.fwBold};`;
  itemPrice.textContent = `$${(Number(item.price) || 0).toFixed(2)}`;
  itemChip.appendChild(itemName);
  itemChip.appendChild(itemPrice);
  itemChip.addEventListener('pointerup', () => { closeModifierPanel(); });
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

  requestAnimationFrame(() => {
    if (_bottomBar) _bottomBar.style.display = '';
    rebuildBottomBar();
  });
}



function commitModifierPanelItem(originalItem, activeItem, modConfig) {
  if (!_modPanelOpen) return;
  _modPanelOpen = false;
  modConfig = modConfig || {};
  // Build ticket item from modifier panel state
  const mands = activeItem.mandatorySelections;
  let mandPrice = 0;
  Object.keys(mands).forEach((k) => {
    mandPrice += mands[k].price || 0;
  });

  // Mandatory selections as modifier lines
  let mods = [];
  const mandGroups = modConfig.mandatoryGroups || [];
  mandGroups.forEach((g) => {
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
  activeItem.optionalModifiers.forEach((m) => {
    let charged = m.prefix !== 'NO' && m.price > 0;
    const halfSide = m.placement === '1st' ? 'Left' : m.placement === '2nd' ? 'Right' : null;
    // `m.prefix` is null if the modifier was picked before the server
    // tapped ADD/NO/EXTRA. formatModifierLabel treats null as
    // "unprefixed" rather than concatenating literal "null ".
    // Previously shipped "null Pepperoni" to the kitchen ticket.
    let displayName = formatModifierLabel(m.prefix, m.label);
    const parentMod = {
      name: displayName,
      price: m.prefix === 'NO' ? 0 : m.price,
      charged: charged,
      prefix: halfSide,
      children: [],
    };
    // Special exclusions as child mods (indented on ticket)
    if (m.special && m.exclusions && m.exclusions.length > 0) {
      m.exclusions.forEach((ex) => {
        parentMod.children.push({ name: `NO ${ex}`, price: 0, charged: false });
      });
    }
    mods.push(parentMod);
  });

  // Included removals
  const includedItems = modConfig.includedItems || [];
  activeItem.includedRemovals.forEach((rid) => {
    const incl = includedItems.find((i) => i.id === rid);
    if (incl) {
      mods.push({ name: `NO ${incl.label}`, price: 0, charged: false, prefix: null });
    }
  });

  // Allergens
  const ALLERGEN_LABELS = {
    nuts: 'Nuts', shellfish: 'Shellfish', gluten: 'Gluten', dairy: 'Dairy',
    soy: 'Soy', eggs: 'Eggs', fish: 'Fish',
  };
  activeItem.allergens.forEach((aId) => {
    const label = ALLERGEN_LABELS[aId] || aId;
    mods.push({ name: `\u26A0 ALLERGEN: ${label}`, price: 0, charged: false, prefix: null });
  });
  if (activeItem.allergenNote) {
    mods.push({ name: `\u26A0 ALLERGEN: ${activeItem.allergenNote}`, price: 0, charged: false, prefix: null });
  }

  // Note
  if (activeItem.note) {
    mods.push({ name: `\uD83D\uDCDD ${activeItem.note}`, price: 0, charged: false, prefix: null });
  }

  let ticketItem = {
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
  let menuCat = catId ? MENU_DATA.find((c) => c.id === catId) : null;
  let menuItem = null;
  if (menuCat) {
    (menuCat.subcats || []).some((sc) => {
      menuItem = (sc.items || []).find((i) => i.id === itemId);
      return !!menuItem;
    });
  }
  // Fallback: scan all categories (item may be orphaned from catId)
  if (!menuItem && itemId) {
    MENU_DATA.some((c) => {
      (c.subcats || []).some((sc) => {
        menuItem = (sc.items || []).find((i) => i.id === itemId);
        return !!menuItem;
      });
      if (menuItem && !menuCat) menuCat = c;
      return !!menuItem;
    });
  }

  const mandatoryGroupIds = (menuItem && menuItem.mandatoryGroupIds) || [];
  const universalGroupIds = (menuCat && menuCat.universalGroupIds) || [];

  const mandatoryGroups = [];
  let pricingDriverKey = null;
  mandatoryGroupIds.forEach((gid) => {
    let grp = MODIFIER_GROUPS.find((g) => g.group_id === gid);
    if (!grp) return;
    const drivesPricing = !!grp.drives_pricing;
    let entry = {
      key: gid,
      label: (grp.name || '').toUpperCase(),
      drivesPricing: drivesPricing,
      min: grp.min_selections || 0,
      max: grp.max_selections || 1,
      options: (grp.modifiers || []).map((m) => {
        let priceByOption = (m.price_by_option && Object.keys(m.price_by_option).length > 0) ? m.price_by_option : null;
        const subatomicIds  = (m.included_modifier_ids && m.included_modifier_ids.length > 0) ? m.included_modifier_ids.slice() : null;
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

  const optionalGroups = [];
  universalGroupIds.forEach((gid) => {
    const grp = MODIFIER_GROUPS.find((g) => g.group_id === gid);
    if (!grp) return;
    optionalGroups.push({
      key: grp.group_id,
      label: (grp.name || '').toUpperCase(),
      min: grp.min_selections || 0,
      max: grp.max_selections || 99,
      options: (grp.modifiers || []).map((m) => {
        const priceByOption = (m.price_by_option && Object.keys(m.price_by_option).length > 0) ? m.price_by_option : null;
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
  let seatArr = Array.from(_activeSeats);
  if (seatArr.length === 0) seatArr = [_seatList[0] || 1];
  item.seat_number = seatArr[0];
  ticket.push(item);
  for (let si = 1; si < seatArr.length; si++) {
    const clone = Object.assign({}, item);
    clone.id = ++ticketSeq;
    clone.idemKey = _idemKey();
    clone.seat_number = seatArr[si];
    clone.mods = (item.mods || []).map((m) => { return Object.assign({}, m); });
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
  return MENU_DATA.find((c) => c.id === id);
}

function getModCat(id) {
  return MOD_DATA.find((c) => c.id === id);
}

function handleItemSelect(item) {
  let name  = item.label || item;
  let price = Number(item.price) || 0;

  // ── Combo flow: picking side or soda ──
  if (comboFlow) {
    if (comboFlow.step === 'side') {
      comboFlow.ticketItem.mods.push({ name, price: 0, charged: false });
      comboFlow.step = 'drink';
      // Navigate snake to drinks
      const drinksCat = getMenuCat('drinks');
      if (drinksCat) _selectCat(drinksCat);
      renderTicket();
      rebuildBottomBar();
      return;
    }
    if (comboFlow.step === 'drink') {
      comboFlow.ticketItem.mods.push({ name, price: 0, charged: false });
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
    const comboMods = [];
    if (item.selectedMods) {
      item.selectedMods.forEach((sm) => {
        comboMods.push({ name: sm.label, price: sm.price || 0, charged: sm.price > 0 });
      });
    }
    const ticketItem = {
      id:        ++ticketSeq,
      menu_item_id: item.id,
      idemKey:   _idemKey(),
      name:      `Combo ${name}`,
      unitPrice: price,
      mods:      comboMods,
      selected:  false,
      sent:      false,
      category:  'combo',
    };
    _pushToAllSeats(ticketItem);
    comboFlow = { step: 'side', ticketItem };
    const sidesCat = getMenuCat('sides');
    if (sidesCat) _selectCat(sidesCat);
    renderTicket();
    rebuildBottomBar();
    return;
  }

  // ── Pizza builder: size tap opens the overlay ──
  if (item.pizzaSize) {
    showPizzaBuilderOverlay(item, PIZZA_BUILDER_DATA).then((result) => {
      const pizzaItem = {
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
    }).catch(() => { /* cancelled */ });
    return;
  }

  // ── Modifier panel: resolve config from backend assignments ──
  let catId = snakeState.catId;
  if (!catId && item.id) catId = ITEM_TO_CATEGORY[item.id] || null;

  const backendConfig = resolveBackendModifierConfig(item.id, catId);
  const overseerIncluded = item.id ? INCLUDED_BY_ITEM[item.id] : null;

  if (backendConfig || (overseerIncluded && overseerIncluded.length > 0)) {
    const effectiveConfig = backendConfig ? Object.assign({}, backendConfig) : {};
    if (overseerIncluded && overseerIncluded.length > 0) {
      effectiveConfig.includedItems = overseerIncluded;
    }
    let catColor = (snakeState.crumbs.length > 0)
      ? snakeState.crumbs[snakeState.crumbs.length - 1].color
      : T.catColor(item.category || item.cat || '');
    const menuCat = catId ? getMenuCat(catId) : null;
    const enablePlacement = menuCat ? !!menuCat.enablePlacement : false;
    openModifierPanel(item, effectiveConfig, catColor, enablePlacement);
    return;
  }

  // ── Pizza fallback: always open modifier panel for pizza categories ──
  const menuCatForFallback = catId ? getMenuCat(catId) : null;
  if (menuCatForFallback && (menuCatForFallback.enablePlacement || menuCatForFallback.pizzaBuilder)) {
    const fallbackConfig = { mandatoryGroups: [], optionalGroups: [], includedItems: [] };
    openModifierPanel(item, fallbackConfig, menuCatForFallback.color, true);
    return;
  }

  addToTicket(item);
}

function addToTicket(item) {
  const name  = item.label || item;
  const price = Number(item.price) || 0;

  // Empty-seat guard: if no seats are active, the new item has nowhere to
  // route. Toast and bail rather than silently routing to seat 1 — the
  // user explicitly hit NONE and we should respect that intent.
  if (_activeSeats.size === 0 && !modifierSession.active) {
    showToast('Pick a seat first', { bg: T.gold, duration: 2000 });
    return;
  }

  if (modifierSession.active) {
    // Apply modifier to all selected instances
    const selected = ticket.filter((i) => i.selected);
    if (selected.length === 0) {
      showToast('Select an item first', { bg: hexToRgba(T.text, 0.45), duration: 2000 });
      return;
    }

    // Check if current modifier category has half_placement
    const modCatId = snakeState.catId;
    const modCat = modCatId ? getModCat(modCatId) : null;
    if (modCat && modCat.half_placement) {
      const halfPrice = typeof item.half_price === 'number' ? item.half_price : null;
      // Use first selected item for overlay context
      const targetInst = selected[0];
      showHalfPlacementOverlay(targetInst.name, name, price, halfPrice, targetInst.mods)
        .then((result) => {
          selected.forEach((inst) => {
            // Re-selection: if same mod on other side, move it
            const otherSide = result.side === 'Left' ? 'Right' : 'Left';
            for (let i = inst.mods.length - 1; i >= 0; i--) {
              if (inst.mods[i].name === name && inst.mods[i].prefix === otherSide) {
                inst.mods.splice(i, 1);
              }
            }
            let modPrice = halfPrice != null ? halfPrice : 0;
            let mod = { name, price: modPrice, half_price: halfPrice, charged: modPrice > 0, prefix: result.side };
            inst.mods.push(mod);
            modHistory.push({ inst, mod });
          });
          renderTicket();
          rebuildBottomBar();
        })
        .catch(() => { /* cancelled */ });
      return;
    }

    const pfx = PREFIXES.find((p) => p.id === modifierSession.activePrefix);
    let modName = (pfx ? pfx.label + ' ' : '') + name;
    const charged = price > 0;
    selected.forEach((inst) => {
      const mod = { name: modName, price, charged, prefix: null };
      inst.mods.push(mod);
      modHistory.push({ inst, mod });
    });
  } else {
    // New item instance
    const mods = [];
    if (item.selectedMods) {
      item.selectedMods.forEach((sm) => {
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
  const cat = getMenuCat(inst.category);
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
  const variant = opts.variant || 'default';
  let catColor = opts.catColor || T.green;
  let bevelLt = lightenHex(T.bg, 0.08);
  let bevelDk = darkenHex(T.bg, 0.2);

  const tree = document.createElement('div');
  tree.style.cssText = [
    'position:relative;',
    'display:flex;flex-direction:column;gap:3px;',
    'margin-top:4px;margin-left:10px;',
    'padding-left:16px;',
  ].join('');

  // Stem — vertical line down the left of the tree. Stops 12px before the
  // tree bottom so the last branch's horizontal segment terminates the line.
  const stem = document.createElement('div');
  if (variant === 'preview') {
    stem.style.cssText = `position:absolute;left:5px;top:0;bottom:12px;width:0;border-left:2px dashed ${T.text};`;
  } else {
    stem.style.cssText = `position:absolute;left:6px;top:0;bottom:12px;width:2px;background:${T.text};`;
  }
  tree.appendChild(stem);

  mods.forEach((mod) => {
    const entry = document.createElement('div');
    entry.style.cssText = 'position:relative;display:flex;align-items:center;gap:5px;';

    // Branch — horizontal segment from stem to pill
    const branch = document.createElement('div');
    if (variant === 'preview') {
      branch.style.cssText = `position:absolute;left:-10px;top:50%;width:10px;height:0;border-top:2px dashed ${T.text};`;
    } else {
      branch.style.cssText = `position:absolute;left:-10px;top:50%;width:10px;height:2px;background:${T.text};`;
    }
    entry.appendChild(branch);

    // Pill
    const pill = document.createElement('div');
    const pillStyles = [
      'flex:1;min-width:0;',
      'display:flex;align-items:baseline;justify-content:space-between;gap:6px;',
      'padding:3px 8px;',
      `background:${T.card};`,
      'border-radius:6px;',
    ];
    if (variant === 'sent') {
      pillStyles.push(`border:1px solid ${hexToRgba(T.green, 0.4)}`);
    } else if (variant === 'preview') {
      pillStyles.push(`border:1px dashed ${hexToRgba(catColor, 0.6)}`);
    } else {
      pillStyles.push(`border-top:1px solid ${bevelLt}`);
      pillStyles.push(`border-left:1px solid ${bevelLt}`);
      pillStyles.push(`border-right:1px solid ${bevelDk}`);
      pillStyles.push(`border-bottom:1px solid ${bevelDk}`);
    }
    pill.style.cssText = pillStyles.join(';') + ';';

    const modName = document.createElement('span');
    modName.style.cssText = [
      `font-family:${T.fb};`,
      `font-size:${T.fsB4};`,
      'font-style:italic;',
      `color:${T.text};`,
      'overflow:hidden;text-overflow:ellipsis;white-space:nowrap;',
      'min-width:0;flex:1;',
    ].join('') + `;font-weight:${T.fwBold};`;
    modName.textContent = mod.name;
    pill.appendChild(modName);

    if (mod.charged && Number(mod.price) > 0) {
      const modPrice = document.createElement('span');
      modPrice.style.cssText = [
        `font-family:${T.fb};`,
        `font-size:${T.fsB4};`,
        `font-weight:${T.fwBold};`,
        `color:${T.gold};`,
        'flex-shrink:0;',
      ].join('');
      modPrice.textContent = `+$${(Number(mod.price) || 0).toFixed(2)}`;
      pill.appendChild(modPrice);
    }

    entry.appendChild(pill);
    tree.appendChild(entry);
  });

  return tree;
}

function _buildItemSubCard(inst, isMultiSeat) {
  const sent = !!inst.sent;
  let catColor = _catColorForItem(inst);
  const bevelLt = lightenHex(T.bg, 0.08);
  let bevelDk = darkenHex(T.bg, 0.2);

  let modTotal = (inst.mods || []).reduce((s, m) => s + (Number(m.price) || 0), 0);
  const totalPrice = (Number(inst.unitPrice) || 0) + modTotal;
  const qty = inst.qty || 1;
  const displayName = qty > 1 ? qty + `× ${inst.name}` : inst.name;

  // Wrapper — flex row containing item-block (card + mod tree) + optional
  // chevron column for sent items.
  const wrapper = document.createElement('div');
  wrapper.style.cssText = [
    'display:flex;align-items:stretch;gap:8px;',
    'margin-bottom:5px;',
    isMultiSeat ? 'margin-left:8px;' : '',
  ].join('');

  // Item block — vertical stack of card + (optional) mod tree
  const block = document.createElement('div');
  block.style.cssText = 'flex:1;min-width:0;display:flex;flex-direction:column;';

  // ── Card body ────────────────────────────────────
  const card = document.createElement('div');
  if (sent) {
    // All-4 green border (Mode B treatment from check-overview)
    card.style.cssText = [
      `background:${T.well};`,
      `border:2px solid ${T.green};`,
      'border-left-width:3px;',
      'border-radius:8px;',
      'padding:6px 10px;',
      `box-shadow:0 2px 0 ${T.greenDk};`,
    ].join('');
  } else {
    // Bevel chrome with cat-color left border
    card.style.cssText = [
      `background:${T.well};`,
      `border-top:2px solid ${bevelLt};`,
      `border-right:2px solid ${bevelDk};`,
      `border-bottom:2px solid ${bevelDk};`,
      `border-left:3px solid ${catColor};`,
      'border-radius:8px;',
      'padding:6px 10px;',
    ].join('');
  }

  // Main row: name + price + (× delete for unsent)
  const mainRow = document.createElement('div');
  mainRow.style.cssText = 'display:flex;align-items:center;gap:6px;';

  const nameEl = document.createElement('span');
  nameEl.style.cssText = [
    `font-family:${T.fb};`,
    `font-weight:${T.fwBold};`,
    `font-size:${T.fsB3};`,
    `color:${T.text};`,
    'flex:1;min-width:0;',
    'overflow:hidden;text-overflow:ellipsis;white-space:nowrap;',
  ].join('');
  nameEl.textContent = displayName;
  mainRow.appendChild(nameEl);

  const priceEl = document.createElement('span');
  priceEl.style.cssText = [
    `font-family:${T.fb};`,
    `font-weight:${T.fwBold};`,
    `font-size:${T.fsB3};`,
    `color:${T.gold};`,
    'flex-shrink:0;',
  ].join('');
  priceEl.textContent = _fmtPrice(totalPrice);
  mainRow.appendChild(priceEl);

  if (!sent) {
    const xBtn = document.createElement('div');
    xBtn.style.cssText = [
      'width:22px;height:22px;flex-shrink:0;',
      'display:flex;align-items:center;justify-content:center;',
      `border-radius:4px;background:${T.verm};`,
      `color:#fff;font-family:${T.fb};font-size:15px;font-weight:${T.fwBold};`,
      'cursor:pointer;pointer-events:auto;touch-action:manipulation;',
    ].join('');
    xBtn.textContent = '×';
    xBtn.addEventListener('pointerup', ((instance) => {
      return (e) => {
        e.stopPropagation();
        let idx = ticket.indexOf(instance);
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
    const _wholeMods = inst.mods.filter((m) => m.prefix !== 'Left' && m.prefix !== 'Right');
    const _leftMods  = inst.mods.filter((m) => m.prefix === 'Left');
    const _rightMods = inst.mods.filter((m) => m.prefix === 'Right');
    if (_wholeMods.length > 0) {
      block.appendChild(_buildModTree(_wholeMods, {
        variant: sent ? 'sent' : 'default',
        catColor: catColor,
      }));
    }
    if (_leftMods.length > 0 || _rightMods.length > 0) {
      block.appendChild(buildHalfTable(_leftMods, _rightMods, T.fsB4, sent ? null : inst));
    }
  }

  wrapper.appendChild(block);

  // ── Sent: chevron column to right ────────────────
  if (sent) {
    const chevCol = document.createElement('div');
    chevCol.style.cssText = [
      'flex:0 0 auto;min-width:48px;',
      'display:flex;flex-direction:column;',
      'align-items:center;justify-content:center;',
      'padding-left:4px;gap:4px;',
    ].join('');

    const chev = document.createElement('span');
    chev.style.cssText = [
      `font-family:${T.fb};`,
      `font-weight:${T.fwBold};`,
      'font-size:18px;',
      `color:${T.green};`,
      'letter-spacing:0.08em;line-height:1;',
    ].join('');
    chev.textContent = '>>>';
    chevCol.appendChild(chev);

    if (inst.sent_at) {
      const stamp = document.createElement('span');
      stamp.style.cssText = [
        `font-family:${T.fb};`,
        'font-size:11px;',
        `color:${T.text};`,
        'font-style:italic;',
      ].join('') + `;font-weight:${T.fwBold};`;
      stamp.textContent = inst.sent_at;
      chevCol.appendChild(stamp);
    }

    wrapper.appendChild(chevCol);
  }

  return wrapper;
}

function renderTicket() {
  if (SceneManager.getActiveWorking() !== 'order-entry') return;
  const list = document.getElementById('ticket-list');
  if (!list) return;
  list.innerHTML = '';

  // In check-overview mode, only show unsent items
  let displayTicket = ticket;
  if (sceneParams.returnScene === 'check-overview') {
    displayTicket = ticket.filter((inst) => !inst.sent);
  }

  // Filter to items whose seat_number is in _activeSeats
  if (_activeSeats.size > 0) {
    displayTicket = displayTicket.filter((inst) => _activeSeats.has(inst.seat_number));
  }

  if (displayTicket.length === 0 && !_modPanelItem) {
    const hint = document.createElement('div');
    hint.style.cssText = `padding:20px 8px;font-family:${T.fb};font-size:${T.fsB3};color:${hexToRgba(T.text, 0.6)};text-align:center;;font-weight:${T.fwBold};`;
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
    const bevelDk = darkenHex(T.bg, 0.2);
    let seatOrder = Array.from(_activeSeats).sort((a, b) => a - b);
    seatOrder.forEach((sn) => {
      const seatItems = displayTicket.filter((i) => i.seat_number === sn);
      const seatSubtotal = seatItems.reduce((s, i) => {
        return s + (Number(i.unitPrice) || 0) + (i.mods || []).reduce((ms, m) => ms + (Number(m.price) || 0), 0);
      }, 0);
      const isOpen = !_collapsedSeats.has(sn);

      const sCard = document.createElement('div');
      sCard.style.cssText = [
        `border-bottom:1px solid ${bevelDk};`,
        `border-left:3px solid ${T.green};`,
        'margin-bottom:5px;',
      ].join('');

      const sHdr = document.createElement('div');
      sHdr.style.cssText = [
        'display:flex;align-items:baseline;justify-content:space-between;',
        `padding:8px 12px;background:${T.well};`,
        'cursor:pointer;user-select:none;',
        'pointer-events:auto;touch-action:manipulation;',
      ].join('');

      const sHdrLeft = document.createElement('div');
      sHdrLeft.style.cssText = 'display:flex;align-items:baseline;gap:8px;';
      const sNum = document.createElement('span');
      sNum.style.cssText = `font-family:${T.fh};font-weight:${T.fwBold};font-size:20px;color:${T.green};`;
      sNum.textContent = `S${sn}`;
      const sSbtl = document.createElement('span');
      sSbtl.style.cssText = `font-family:${T.fb};font-weight:${T.fwBold};font-size:${T.fsB4};color:${T.gold};`;
      sSbtl.textContent = _fmtPrice(seatSubtotal);
      sHdrLeft.appendChild(sNum);
      sHdrLeft.appendChild(sSbtl);
      sHdr.appendChild(sHdrLeft);

      const sChev = document.createElement('span');
      sChev.style.cssText = [
        `font-family:${T.fb};font-size:16px;color:${T.moon};`,
        'transition:transform 0.15s;display:inline-block;',
        `transform:${(isOpen ? 'rotate(90deg)' : 'rotate(0deg)')};`,
      ].join('') + `;font-weight:${T.fwBold};`;
      sChev.textContent = '▸';
      sHdr.appendChild(sChev);

      sHdr.addEventListener('pointerup', ((seatNum) => {
        return () => {
          if (_collapsedSeats.has(seatNum)) _collapsedSeats.delete(seatNum);
          else _collapsedSeats.add(seatNum);
          renderTicket();
        };
      })(sn));

      sCard.appendChild(sHdr);

      const itemsWrap = document.createElement('div');
      itemsWrap.style.cssText = [
        'overflow:hidden;',
        `max-height:${(isOpen ? '5000px' : '0')};`,
        'transition:max-height 0.2s ease;',
      ].join('');

      const itemsInner = document.createElement('div');
      itemsInner.style.cssText = 'padding:6px 8px 8px;display:flex;flex-direction:column;';

      seatItems.forEach((inst) => {
        itemsInner.appendChild(_buildItemSubCard(inst, false));
      });

      itemsWrap.appendChild(itemsInner);
      sCard.appendChild(itemsWrap);
      list.appendChild(sCard);
    });
  } else {
    // Single seat — items render flush, no header
    displayTicket.forEach((inst) => {
      list.appendChild(_buildItemSubCard(inst, false));
    });
  }

  _appendModPreview(list);
  _updateTicketTotals(displayTicket);
}

function _appendModPreview(list) {
  if (!_modPanelItem) return;
  // Remove ALL stale previews (may lack data-mod-preview from interrupted renders)
  const children = list.children;
  for (let ri = children.length - 1; ri >= 0; ri--) {
    if (children[ri].textContent.indexOf('\u270E') !== -1) {
      list.removeChild(children[ri]);
    }
  }

  let previewMods = (_modPanelItem.mods || []);
  let previewModTotal = previewMods.reduce((s, m) => s + Number(m.price || 0), 0);
  const previewPrice = (_modPanelItem.basePrice || 0) + previewModTotal;
  const catColor = _modPanelCatColor || T.green;
  const fsMod = T.fsB3;

  // ── Wrapper: dashed cat-color border on all 4 sides, transparent fill,
  // marker text (\u270E pencil) inside the name so renderTicket can scrub
  // stale previews on next pass. Price stays gold per money rule.
  const pc = document.createElement('div');
  pc.setAttribute('data-mod-preview', '1');
  pc.style.cssText = [
    'flex-shrink:0;margin-bottom:5px;',
    `background:${T.well};`,
    `border:1.5px dashed ${catColor};`,
    'border-radius:8px;',
    'padding:6px 10px;',
  ].join('');

  // Main row: pencil + name + price
  const pRow = document.createElement('div');
  pRow.style.cssText = 'display:flex;align-items:center;gap:6px;';
  const pName = document.createElement('span');
  pName.style.cssText = [
    `font-family:${T.fb};`,
    `font-weight:${T.fwBold};`,
    `font-size:${T.fsB3};`,
    `color:${T.text};`,
    'flex:1;min-width:0;',
    'overflow:hidden;text-overflow:ellipsis;white-space:nowrap;',
  ].join('');
  pName.textContent = `\u270E ${_modPanelItem.itemLabel}`;
  const pPrice = document.createElement('span');
  pPrice.style.cssText = [
    `font-family:${T.fb};`,
    `font-weight:${T.fwBold};`,
    `font-size:${T.fsB3};`,
    `color:${T.gold};`,
    'flex-shrink:0;',
  ].join('');
  pPrice.textContent = `$${previewPrice.toFixed(2)}`;
  pRow.appendChild(pName);
  pRow.appendChild(pPrice);
  pc.appendChild(pRow);

  // Partition into whole / left / right
  const wholeMods = [];
  const leftMods = [];
  const rightMods = [];
  for (let pi = 0; pi < previewMods.length; pi++) {
    const pm = previewMods[pi];
    if (pm.prefix === 'Left') leftMods.push(pm);
    else if (pm.prefix === 'Right') rightMods.push(pm);
    else wholeMods.push(pm);
  }

  // Whole mods → preview-variant mod tree (dashed cat-color pills + dashed stem/branch)
  if (wholeMods.length > 0) {
    pc.appendChild(_buildModTree(wholeMods, { variant: 'preview', catColor }));
    // Exclusion children (e.g. "NO Ketchup" under "ADD Cheeseburger")
    // — preserved from legacy preview; rendered as italic verm rows below the tree.
    wholeMods.forEach((m) => {
      if (m.children && m.children.length > 0) {
        m.children.forEach((child) => {
          const childRow = document.createElement('div');
          childRow.style.cssText = [
            'margin-left:36px;padding:2px 8px;',
            `font-family:${T.fb};font-size:${T.fsB4};`,
            `font-style:italic;color:${T.verm};`,
          ].join('') + `;font-weight:${T.fwBold};`;
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
    let inst = { sent: false, mods: _modPanelItem.mods };
    pc.appendChild(buildHalfTable(leftMods, rightMods, fsMod, inst));
  }

  list.appendChild(pc);
}

function _updateTicketTotals(filteredTicket) {
  // When a filtered view is active, compute totals from visible items only.
  let subtotal = 0;
  const src = filteredTicket || ticket;
  src.forEach((inst) => {
    const modTotal = (inst.mods || []).reduce((s, m) => s + (Number(m.price) || 0), 0);
    subtotal += (Number(inst.unitPrice) || 0) + modTotal;
  });
  if (_modPanelItem) {
    const previewMods = (_modPanelItem.mods || []);
    const previewModTotal = previewMods.reduce((s, m) => s + (Number(m.price) || 0), 0);
    subtotal += (_modPanelItem.basePrice || 0) + previewModTotal;
  }
  const t = computeTotals(subtotal);
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
  const THRESHOLD = 60;
  const BTN_W = 70;

  const wrap = document.createElement('div');
  wrap.style.cssText = 'position:relative;overflow:hidden;flex-shrink:0;';

  // Delete button behind
  const delBtn = document.createElement('div');
  delBtn.style.cssText = `position:absolute;right:0;top:0;bottom:0;width:${BTN_W}px;display:flex;align-items:center;justify-content:center;background:${T.verm};color:${T.text};font-family:${T.fh};font-size:${T.fsB3};letter-spacing:1px;cursor:pointer;user-select:none;;font-weight:${T.fwBold};`;
  delBtn.textContent = 'DELETE';
  wrap.appendChild(delBtn);

  // Inner content on top
  innerEl.style.position = 'relative';
  innerEl.style.zIndex = '1';
  innerEl.style.transition = 'transform 150ms ease-out';
  wrap.appendChild(innerEl);

  let startX = 0;
  let currentX = 0;
  let swiping = false;
  let revealed = false;

  innerEl.addEventListener('pointerdown', (e) => {
    startX = e.clientX;
    currentX = 0;
    swiping = true;
    innerEl.style.transition = 'none';
  });

  innerEl.addEventListener('pointermove', (e) => {
    if (!swiping) return;
    let dx = e.clientX - startX;
    if (dx > 0) dx = 0; // no right swipe
    if (dx < -BTN_W) dx = -BTN_W;
    currentX = dx;
    innerEl.style.transform = `translateX(${dx}px)`;
  });

  innerEl.addEventListener('pointerup', () => {
    if (!swiping) return;
    swiping = false;
    innerEl.style.transition = 'transform 150ms ease-out';
    if (currentX < -THRESHOLD) {
      // Reveal delete
      innerEl.style.transform = `translateX(-${BTN_W}px)`;
      revealed = true;
    } else {
      innerEl.style.transform = 'translateX(0)';
      revealed = false;
    }
  });

  innerEl.addEventListener('pointerleave', () => {
    if (!swiping) return;
    swiping = false;
    innerEl.style.transition = 'transform 150ms ease-out';
    if (currentX < -THRESHOLD) {
      innerEl.style.transform = `translateX(-${BTN_W}px)`;
      revealed = true;
    } else {
      innerEl.style.transform = 'translateX(0)';
      revealed = false;
    }
  });

  delBtn.addEventListener('pointerup', () => {
    onDelete();
  });

  return wrap;
}


// ── SEPARATOR + MOD ROW helpers ───────────────────
function buildSeparator() {
  let sep = document.createElement('div');
  sep.style.cssText = `padding:0 8px;font-family:${T.fb};font-size:${T.fsB3};color:${T.greenDk};letter-spacing:2px;overflow:hidden;white-space:nowrap;line-height:1;;font-weight:${T.fwBold};`;
  sep.textContent = '- - - - - - - - - - - - - - - - - -';
  return sep;
}

function buildModRow(name, price, dark, showPrice) {
  let row = document.createElement('div');
  row.style.cssText = [
    'display:flex;justify-content:space-between;',
    'padding:2px 8px 2px 20px;',
    `font-family:${T.fb};font-size:${T.fsB3};font-weight:${T.fwBold};`,
    `color:${(dark ? T.well : T.gold)};`,
  ].join('');
  let n = document.createElement('span');
  n.textContent = name;
  let p = document.createElement('span');
  p.textContent = price > 0 ? `+$${price.toFixed(2)}` : '$0.00';
  row.appendChild(n);
  row.appendChild(p);
  return row;
}

function buildModRowSized(name, price, fontSize, onRemove) {
  let row = document.createElement('div');
  row.style.cssText = [
    'display:flex;align-items:center;',
    'padding:1px 8px 1px 16px;',
    `font-family:${T.fb};font-size:${fontSize};font-weight:${T.fwBold};`,
    `color:${T.green};`,
  ].join('');
  // Remove button (shown for unsent items)
  if (onRemove) {
    let x = document.createElement('span');
    x.style.cssText = [
      'flex-shrink:0;width:22px;height:22px;margin-right:4px;',
      'display:flex;align-items:center;justify-content:center;',
      `font-size:14px;color:${T.verm};cursor:pointer;`,
      `border:1px solid ${T.verm};clip-path:polygon(3px 0%,calc(100% - 3px) 0%,100% 3px,100% calc(100% - 3px),calc(100% - 3px) 100%,3px 100%,0% calc(100% - 3px),0% 3px);`,
    ].join('') + `;font-weight:${T.fwBold};`;
    x.textContent = '\u2715';
    x.addEventListener('pointerup', (e) => {
      e.stopPropagation();
      onRemove();
    });
    row.appendChild(x);
  }
  const n = document.createElement('span');
  n.style.cssText = 'flex:1;';
  n.textContent = name;
  let p = document.createElement('span');
  p.style.cssText = `flex-shrink:0;color:${T.gold};`;
  p.textContent = price > 0 ? `+$${price.toFixed(2)}` : '';
  row.appendChild(n);
  if (price > 0) row.appendChild(p);
  return row;
}

function buildHalfTable(leftMods, rightMods, fontSize, removableInst) {
  const table = document.createElement('div');
  table.style.cssText = 'padding:2px 8px;';

  // Divider
  const divTop = document.createElement('div');
  divTop.style.cssText = `display:flex;border-bottom:1px solid ${T.greenDk};margin-bottom:1px;`;
  const hdrL = document.createElement('div');
  hdrL.style.cssText = `flex:1;font-family:${T.fb};font-size:${fontSize};font-weight:${T.fwBold};color:${T.gold};text-align:center;`;
  hdrL.textContent = '1ST';
  const hdrSep = document.createElement('div');
  hdrSep.style.cssText = `width:1px;background:${T.greenDk};margin:0 4px;`;
  const hdrR = document.createElement('div');
  hdrR.style.cssText = `flex:1;font-family:${T.fb};font-size:${fontSize};font-weight:${T.fwBold};color:${T.gold};text-align:center;`;
  hdrR.textContent = '2ND';
  divTop.appendChild(hdrL);
  divTop.appendChild(hdrSep);
  divTop.appendChild(hdrR);
  table.appendChild(divTop);

  function _makeRemoveBtn(mod) {
    const x = document.createElement('span');
    x.style.cssText = [
      'flex-shrink:0;width:18px;height:18px;margin:0 2px;',
      'display:inline-flex;align-items:center;justify-content:center;',
      `font-size:11px;color:${T.verm};cursor:pointer;`,
      `border:1px solid ${T.verm};clip-path:polygon(3px 0%,calc(100% - 3px) 0%,100% 3px,100% calc(100% - 3px),calc(100% - 3px) 100%,3px 100%,0% calc(100% - 3px),0% 3px);`,
    ].join('') + `;font-weight:${T.fwBold};`;
    x.textContent = '\u2715';
    x.addEventListener('pointerup', (e) => {
      e.stopPropagation();
      const mi = removableInst.mods.indexOf(mod);
      if (mi !== -1) removableInst.mods.splice(mi, 1);
      renderTicket();
      rebuildBottomBar();
    });
    return x;
  }

  // Rows — zip left and right
  const maxRows = Math.max(leftMods.length, rightMods.length);
  for (let i = 0; i < maxRows; i++) {
    const row = document.createElement('div');
    row.style.cssText = 'display:flex;align-items:center;';

    const cellL = document.createElement('div');
    cellL.style.cssText = `flex:1;display:flex;align-items:center;font-family:${T.fb};font-size:${fontSize};color:${T.green};padding:0 4px;;font-weight:${T.fwBold};`;
    if (removableInst && leftMods[i]) cellL.appendChild(_makeRemoveBtn(leftMods[i]));
    const lText = document.createElement('span');
    lText.textContent = leftMods[i] ? stripPlacementPrefix(leftMods[i].name) : '';
    cellL.appendChild(lText);

    if (leftMods[i] && leftMods[i].priceDelta) {
      const lp = leftMods[i].priceDelta;
      const lpRow = buildDataRow('', (lp > 0 ? '+$' : '-$') + Math.abs(lp).toFixed(2), T.gold);
      lpRow.style.flex = '1';
      lpRow.style.border = 'none';
      lpRow.style.padding = '0 0 0 8px';
      cellL.appendChild(lpRow);
    }

    const sep = document.createElement('div');
    sep.style.cssText = `width:1px;align-self:stretch;background:${T.greenDk};margin:0 4px;flex-shrink:0;`;

    const cellR = document.createElement('div');
    cellR.style.cssText = `flex:1;display:flex;align-items:center;justify-content:flex-end;font-family:${T.fb};font-size:${fontSize};color:${T.green};padding:0 4px;;font-weight:${T.fwBold};`;

    if (rightMods[i] && rightMods[i].priceDelta) {
      const rp = rightMods[i].priceDelta;
      const rpRow = buildDataRow('', (rp > 0 ? '+$' : '-$') + Math.abs(rp).toFixed(2), T.gold);
      rpRow.style.flex = '1';
      rpRow.style.border = 'none';
      rpRow.style.padding = '0 8px 0 0';
      cellR.appendChild(rpRow);
    }

    const rText = document.createElement('span');
    rText.textContent = rightMods[i] ? stripPlacementPrefix(rightMods[i].name) : '';
    cellR.appendChild(rText);
    if (removableInst && rightMods[i]) cellR.appendChild(_makeRemoveBtn(rightMods[i]));

    row.appendChild(cellL);
    row.appendChild(sep);
    row.appendChild(cellR);
    table.appendChild(row);

    // Render children (exclusions) for specials in half-table
    const lChildren = (leftMods[i] && leftMods[i].children) ? leftMods[i].children : [];
    const rChildren = (rightMods[i] && rightMods[i].children) ? rightMods[i].children : [];
    const maxChildren = Math.max(lChildren.length, rChildren.length);
    for (let ci = 0; ci < maxChildren; ci++) {
      const cRow = document.createElement('div');
      cRow.style.cssText = 'display:flex;align-items:center;';
      const cL = document.createElement('div');
      cL.style.cssText = `flex:1;font-family:${T.fb};font-size:${(parseInt(fontSize) - 4)}px;color:${T.verm};font-style:italic;padding:0 4px 0 20px;;font-weight:${T.fwBold};`;
      cL.textContent = lChildren[ci] ? lChildren[ci].name : '';
      const cSep = document.createElement('div');
      cSep.style.cssText = `width:1px;align-self:stretch;background:${T.greenDk};margin:0 4px;flex-shrink:0;`;
      const cR = document.createElement('div');
      cR.style.cssText = `flex:1;font-family:${T.fb};font-size:${(parseInt(fontSize) - 4)}px;color:${T.verm};font-style:italic;padding:0 4px 0 20px;text-align:right;;font-weight:${T.fwBold};`;
      cR.textContent = rChildren[ci] ? rChildren[ci].name : '';
      cRow.appendChild(cL);
      cRow.appendChild(cSep);
      cRow.appendChild(cR);
      table.appendChild(cRow);
    }
  }

  // Bottom divider
  const divBot = document.createElement('div');
  divBot.style.cssText = `border-top:1px solid ${T.greenDk};margin-top:1px;`;
  table.appendChild(divBot);

  return table;
}

function stripPlacementPrefix(name) {
  return name;
}

// ── QUANTITY EDITOR ─────────────────────────────
function showQtyEditor(itemName, instances) {
  SceneManager.interrupt('qty-edit', {
    onConfirm: (newQty) => {
      const currentQty = instances.length;
      if (newQty === currentQty || newQty < 1) return;
      if (newQty > currentQty) {
        // Add more instances (clone from first)
        const template = instances[0];
        for (let i = 0; i < newQty - currentQty; i++) {
          ticket.push({
            id:        ++ticketSeq,
            menu_item_id: template.menu_item_id,
            idemKey:   _idemKey(),
            name:      template.name,
            unitPrice: template.unitPrice,
            mods:      template.mods.map((m) => { return { name: m.name, price: m.price, charged: m.charged, prefix: m.prefix }; }),
            selected:  false,
            sent:      false,
            category:  template.category,
            seat_number: template.seat_number,
          });
        }
      } else {
        // Remove from the end (unsent only)
        let toRemove = currentQty - newQty;
        for (let j = instances.length - 1; j >= 0 && toRemove > 0; j--) {
          const idx = ticket.indexOf(instances[j]);
          if (idx !== -1) { ticket.splice(idx, 1); toRemove--; }
        }
      }
      renderTicket();
      rebuildBottomBar();
    },
    onCancel: () => {},
    params: { itemName, currentQty: instances.length },
  });
}

function _buildItemPayload(inst) {
  const payload = {
    menu_item_id: inst.menu_item_id || inst.name.toLowerCase().replace(/\s+/g, '_'),
    name:         inst.name,
    price:        Number(inst.unitPrice) || 0,
    quantity:     1,
    category:     inst.category || 'general',
    seat_number:  inst.seat_number || 1,
    modifiers:    inst.mods.map((m) => {
      return {
        name: m.name, price: m.price, modifier_price: m.price,
        charged: m.charged, prefix: m.prefix || null,
        half_price: m.half_price != null ? m.half_price : null,
      };
    }),
  };

  // Include modifier panel data for atomic ledger write (ORDER_ITEM_ADDED)
  if (inst._modPanelData) {
    const mpd = inst._modPanelData;
    // Backend expects list[str] ("{group_id}:{option_key}"); mpd.mandatory
    // is the terminal-side object map {group_id: {key,label,price}}. Flatten
    // so the ledger can audit which groups were picked without losing the
    // group→choice mapping. Label/price already ride along in `modifiers[]`.
    const mand = mpd.mandatory;
    if (mand && typeof mand === 'object' && !Array.isArray(mand)) {
      payload.mandatory_selections = Object.keys(mand).map((gid) => {
        const sel = mand[gid];
        const key = (sel && sel.key) || '';
        return gid + `:${key}`;
      });
    } else {
      payload.mandatory_selections = mand || [];
    }
    payload.included_removals = mpd.includedRemovals;
    payload.allergens = mpd.allergens;
    payload.allergen_note = mpd.allergenNote || '';
    payload.note = mpd.note || '';
    payload.optional_modifiers = mpd.optionalModifiers.map((m) => {
      return { prefix: m.prefix, modifier_id: m.modifierId, label: m.label, price: m.price };
    });
  }

  console.log('POST payload:', payload);
  return payload;
}

async function handleSaveOnly() {
  if (ticket.length === 0) return;
  if (isSending) return;

  let unsentInstances = ticket.filter((inst) => !inst.sent);
  if (unsentInstances.length === 0) return;

  setSending(true);

  try {
    // Step 1 — create order if needed
    if (!state.currentOrderId) {
      if (!createOrderIdemKey) createOrderIdemKey = _idemKey();
      let createRes = await fetchWithTimeout(API + '/orders', {
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
      if (!createRes.ok) throw new Error(`Order create failed: ${createRes.status}`);
      let created = await createRes.json();
      if (!created || !created.order_id) throw new Error('Invalid order response — missing order_id');
      state.currentOrderId = created.order_id;
      currentCheckNumber = created.check_number;
    }

    // Step 2 — post unsent items (seat already assigned per-item).
    // Skip items with a backendItemId: they were saved in a prior session and
    // already exist on the backend — re-posting with a new idemKey would create
    // duplicates when the user later calls handleSend.
    let itemPromises = [];
    for (let ui = 0; ui < unsentInstances.length; ui++) {
      let inst = unsentInstances[ui];
      if (inst.backendItemId) continue;
      itemPromises.push({ inst, promise: fetchWithTimeout(API + `/orders/${state.currentOrderId}/items`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Idempotency-Key': inst.idemKey || _idemKey() },
        body: JSON.stringify(_buildItemPayload(inst)),
      }, 15000)});
    }
    if (itemPromises.length === 0) return;
    let results = await Promise.allSettled(itemPromises.map((p) => p.promise));
    let anyFailed = false;
    results.forEach((r, idx) => {
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
    if (state.currentOrderId) SceneManager.emit('order:updated', { orderId: state.currentOrderId });
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

  const unsentInstances = ticket.filter((inst) => !inst.sent);

  // All items already sent — resend to kitchen only
  if (unsentInstances.length === 0 && state.currentOrderId) {
    setSending(true);
    try {
      await fetchWithTimeout(API + `/orders/${state.currentOrderId}/send`, { method: 'POST' }, 15000);
      fetchWithTimeout(API + `/print/ticket/${state.currentOrderId}`, { method: 'POST' }, 15000)
        .then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); })
        .catch((err) => {
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
  const totals = computeTicketTotals();

  try {
    // Step 1 — create order on first send, reuse on subsequent sends
    if (!state.currentOrderId) {
      if (!createOrderIdemKey) createOrderIdemKey = _idemKey();
      const createRes = await fetchWithTimeout(API + '/orders', {
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
      if (!createRes.ok) throw new Error(`Order create failed: ${createRes.status}`);
      const created = await createRes.json();
      if (!created || !created.order_id) throw new Error('Invalid order response — missing order_id');
      state.currentOrderId = created.order_id;   // use the backend-generated ID
      currentCheckNumber = created.check_number;
    }

    // Step 2 — post unsent instances (seat already assigned per-item).
    // Skip items with a backendItemId: they were saved in a prior session and
    // already exist on the backend. Re-posting with a new idemKey would create
    // duplicates. The /send call in step 3 fires them to the kitchen regardless.
    const itemPromises = [];
    for (let ui = 0; ui < unsentInstances.length; ui++) {
      const inst = unsentInstances[ui];
      if (inst.backendItemId) continue;
      itemPromises.push({ inst, promise: fetchWithTimeout(API + `/orders/${state.currentOrderId}/items`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Idempotency-Key': inst.idemKey || _idemKey() },
        body: JSON.stringify(_buildItemPayload(inst)),
      }, 15000)});
    }
    const results = await Promise.allSettled(itemPromises.map((p) => p.promise));
    let anyFailed = false;
    results.forEach((r, idx) => {
      if (r.status === 'fulfilled' && r.value.ok) {
        itemPromises[idx].inst.sent = true;
      } else {
        anyFailed = true;
        console.warn('[KINDpos] Item POST failed:', itemPromises[idx].inst.name,
          r.status === 'rejected' ? r.reason : `HTTP ${r.value.status}`);
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
    const sendRes = await fetchWithTimeout(API + `/orders/${state.currentOrderId}/send`, { method: 'POST' }, 15000);
    if (!sendRes.ok) {
      renderTicket();
      throw new Error(`Send to kitchen failed: HTTP ${sendRes.status}`);
    }

    // Mark remaining items as sent (order-level confirmation)
    ticket.forEach((inst) => { inst.sent = true; });

    // Fire kitchen print — non-blocking, dispatcher handles retry
    fetchWithTimeout(API + `/print/ticket/${state.currentOrderId}`, { method: 'POST' }, 15000)
      .then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); })
      .catch((err) => {
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
  if (state.currentOrderId) SceneManager.emit('order:updated', { orderId: state.currentOrderId });

  // Reset hex nav — ticket stays visible for PAY

}

// ── CLOSE (X button) ────────────────────────────
// Auto-saves unsent items before navigating. Any items the server typed
// are persisted to the backend (without kitchen-send) so they survive
// BACK, logout, or an unexpected scene swap.
async function handleClose() {
  const hasUnsent = ticket.some((inst) => !inst.sent);
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
  SceneManager.mountWorking('check-overview', buildCheckOverviewParams(state.currentOrderId, sceneParams));
}

// ── RECALL FROM BACKEND (open saved check) ──────
function recallFromBackend(orderId) {
  // 15s abort guard matches handleSend/handleSaveOnly. Without it, a
  // hung backend on scene entry leaves the ticket list blank forever
  // with no error surfaced.
  fetchWithTimeout(API + `/orders/${orderId}`, {}, 15000)
    .then((r) => {
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return r.json();
    })
    .then((order) => {
      if (SceneManager.getActiveWorking() !== 'order-entry') return;
      state.currentOrderId = order.order_id;
      currentCheckNumber = order.check_number || null;
      if (currentCheckNumber) {
        OrderSummary.update({ checkId: currentCheckNumber });
      }

      // Convert backend items to frontend ticket format.
      // Backend Decimals serialize as JSON strings ("12.50"), so every
      // price field arriving here is a string. Coerce to Number at the
      // boundary — downstream code (renderTicket, sending, totals) all
      // assume numeric prices and `.toFixed()` them.
      ticket = (order.items || []).filter((item) => !item.voided).map((item) => {
        ticketSeq += 1;
        // Prefer server-computed effective_price (post-mods/discounts);
        // base `price` is 0 for combos/pizzas where value lives in mods.
        const rawUnit = item.effective_price != null ? item.effective_price : item.price;
        let unit = Number(rawUnit);
        if (!Number.isFinite(unit)) unit = 0;
        return {
          id:           ticketSeq,
          backendItemId: item.item_id,  // prevents re-POST on subsequent handleSend/handleSaveOnly
          menu_item_id: item.menu_item_id,
          idemKey:      _idemKey(),
          name:      item.name,
          unitPrice: unit,
          mods:      (item.modifiers || []).map((m) => {
            const rawPrice = m.modifier_price != null ? m.modifier_price : m.price;
            let p = Number(rawPrice);
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
        const selSeats = sceneParams.selectedSeatNumbers || [];
        let sentItems = ticket;

        if (selSeats.length === 1) {
          sentItems = sentItems.filter((i) => i.seat_number === selSeats[0]);
        }

        let leftItems = [];
        if (selSeats.length !== 1 && sentItems.length > 0) {
          const seatGroups = {};
          const seatOrder  = [];
          sentItems.forEach((i) => {
            const sn = i.seat_number || 1;
            if (!seatGroups[sn]) { seatGroups[sn] = []; seatOrder.push(sn); }
            seatGroups[sn].push(i);
          });
          seatOrder.sort((a, b) => a - b);
          seatOrder.forEach((sn) => {
            const seatTot = seatGroups[sn].reduce((s, i) => s + (i.unitPrice || 0), 0);
            leftItems.push({ seatHeader: true, seatId: `SEAT ${sn}`, seatTotal: seatTot });
            seatGroups[sn].forEach((i) => { leftItems.push(i); });
          });
        } else {
          leftItems = sentItems;
        }

        OrderSummary.unlockItemRender();
        OrderSummary.update({ items: leftItems });
        OrderSummary.lockItemRender();
      }
    })
    .catch((err) => {
      console.warn('[KINDpos] Failed to recall order:', err);
      showToast('Failed to load saved check', { bg: T.verm, duration: 2000 });
    });
}