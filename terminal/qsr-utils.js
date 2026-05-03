// terminal/qsr-utils.js
// Shared utilities for QSR scenes

import { defineScene, SceneManager } from './scene-manager.js';
import { T } from '../common/tokens.js';
import { buildPillButton, hexToRgba } from './theme-manager.js';
import { openModifierPanel } from './modifier-panel.js';

// ── Shared config builder ──────────────────────────────────────────────────
function _buildQsrConfig(item, catColor) {
  var modifierGroups = item.modifier_groups || [];
  var mandatoryGroups = [];
  var optionalGroups  = [];

  modifierGroups.forEach(function(grp) {
    var groupKey = grp.group_id || grp.id || grp.name;
    // FIX B: mandatory if min_selections >= 1 OR required === true
    var isMandatory = (grp.min_selections || 0) >= 1 || grp.required === true;
    var mappedOptions = (grp.modifiers || grp.options || []).map(function(m) {
      return {
        key:   m.id || m.key || m.name,
        id:    m.id || m.key || m.name,
        label: m.name || m.label,
        price: parseFloat(m.price || 0),
      };
    });
    var groupObj = {
      key:            groupKey,
      name:           grp.name,
      label:          grp.name,
      options:        mappedOptions,
      required:       isMandatory,
      min_selections: grp.min_selections || 0,
      max_selections: grp.max_selections || 1,
    };
    if (isMandatory) mandatoryGroups.push(groupObj);
    else             optionalGroups.push(groupObj);
  });

  var modConfig = {
    mandatoryGroups: mandatoryGroups,
    optionalGroups:  optionalGroups,
    includedItems:   [],
  };
  var fsItem = {
    id:    item.itemKey || item.key || item.name,
    name:  item.name,
    label: item.name,
    price: parseFloat(item.unitPrice || item.price || 0),
    category: 'qsr',
  };
  var qsrCrumbs = [];
  if (item.category_name) {
    qsrCrumbs.push({ label: item.category_name.toUpperCase(), color: catColor });
  }
  return { modConfig: modConfig, fsItem: fsItem, qsrCrumbs: qsrCrumbs };
}

// ── Transactional scene (fallback when no navContainer provided) ───────────
defineScene({
  name: 'qsr-modifier-selector',

  render: function(container, params, state) {
    state._alive = true;

    var item     = params.item     || {};
    var catColor = params.catColor || T.green;

    container.style.cssText = [
      'position:fixed;top:0;left:0;right:0;bottom:0;',
      'display:flex;flex-direction:column;',
      'background:' + T.bg + ';',
      'z-index:50;overflow:hidden;',
    ].join('');

    var cfg = _buildQsrConfig(item, catColor);

    openModifierPanel(cfg.fsItem, cfg.modConfig, catColor, false, {
      mainArea:    container,
      snakeState:  { crumbs: cfg.qsrCrumbs },
      onPanelInit: {
        onUpdate: function() {},
        onSend: function(outputItem) {
          var mods = [];
          if (outputItem.mods && Array.isArray(outputItem.mods)) {
            outputItem.mods.forEach(function(mod) {
              mods.push({ name: mod.name, price: mod.price || 0 });
            });
          }
          var configured = {
            name:          outputItem.name,
            price:         outputItem.unitPrice,
            itemKey:       outputItem.menu_item_id || item.itemKey || item.key || item.name,
            mods:          mods,
            _modPanelData: outputItem._modPanelData,
          };
          SceneManager.closeTransactional('qsr-modifier-selector');
          if (params.onConfirm) params.onConfirm(configured);
        },
        onCancel: function() {
          SceneManager.closeTransactional('qsr-modifier-selector');
        },
      },
    });

    return function cleanup() { state._alive = false; };
  },
});

// ── Public API ─────────────────────────────────────────────────────────────
// navContainer (optional): the right-surface element from qsr-order.js.
// When provided, the panel mounts INSIDE that element (replacing the category
// grid), then restores the original children on DONE or cancel — matching the
// order-entry.js mount/restore pattern.
// When omitted, falls back to the full-screen transactional scene.
function openQsrModifierSelector(item, catColor, onConfirm, navContainer) {
  if (!navContainer) {
    SceneManager.openTransactional('qsr-modifier-selector', {
      item: {
        name:            item.name,
        unitPrice:       parseFloat(item.price || 0),
        price:           parseFloat(item.price || 0),
        category_name:   item.category_name || '',
        itemKey:         item.itemKey || item.key || item.name,
        modifier_groups: item.modifier_groups,
        mods:            [],
      },
      catColor:  catColor,
      onConfirm: onConfirm,
    });
    return;
  }

  // FIX A: save navContainer children, clear, mount panel, restore on close
  var cfg          = _buildQsrConfig(item, catColor);
  var savedCssText = navContainer.style.cssText;
  var savedChildren = Array.from(navContainer.childNodes);

  while (navContainer.firstChild) navContainer.removeChild(navContainer.firstChild);
  navContainer.style.cssText = [
    'flex:1;min-width:0;height:100%;',
    'display:flex;flex-direction:column;',
    'background:' + T.bg + ';overflow:hidden;',
  ].join('');

  function restore() {
    while (navContainer.firstChild) navContainer.removeChild(navContainer.firstChild);
    savedChildren.forEach(function(c) { navContainer.appendChild(c); });
    navContainer.style.cssText = savedCssText;
  }

  openModifierPanel(cfg.fsItem, cfg.modConfig, catColor, false, {
    mainArea:    navContainer,
    snakeState:  { crumbs: cfg.qsrCrumbs },
    onPanelInit: {
      onUpdate: function() {},
      onSend: function(outputItem) {
        var mods = [];
        if (outputItem.mods && Array.isArray(outputItem.mods)) {
          outputItem.mods.forEach(function(mod) {
            mods.push({ name: mod.name, price: mod.price || 0 });
          });
        }
        var configured = {
          name:          item.name,
          price:         parseFloat(item.price || 0),
          itemKey:       item.itemKey || item.key || item.name,
          mods:          mods,
          _modPanelData: outputItem._modPanelData,
        };
        restore();
        onConfirm(configured);
      },
      onCancel: function() {
        restore();
      },
    },
  });
}

export { openQsrModifierSelector };
