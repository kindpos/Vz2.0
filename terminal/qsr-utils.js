// terminal/qsr-utils.js
// Shared utilities for QSR scenes

import { defineScene, SceneManager } from './scene-manager.js';
import { T } from '../common/tokens.js';
import { buildPillButton, hexToRgba } from './theme-manager.js';
import { openModifierPanel } from './modifier-panel.js';

defineScene({
  name: 'qsr-modifier-selector',

  render: function(container, params, state) {
    state._alive = true;

    var item           = params.item     || {};
    var catColor       = params.catColor || T.green;
    var modifierGroups = item.modifier_groups || [];

    // FIX B: make container full-screen so it obscures the order screen below
    container.style.cssText = [
      'position:fixed;top:0;left:0;right:0;bottom:0;',
      'display:flex;flex-direction:column;',
      'background:' + T.bg + ';',
      'z-index:50;overflow:hidden;',
    ].join('');

    // Map QSR modifier_groups to modConfig shape (mandatoryGroups, optionalGroups)
    var mandatoryGroups = [];
    var optionalGroups = [];
    modifierGroups.forEach(function(grp) {
      var groupKey = grp.group_id || grp.id || grp.name;
      var isMandatory = (grp.min_selections || 0) >= 1;
      // FIX C: use 'options' (not 'modifiers') so buildKindModPanel can read g.options;
      // also normalise each modifier to the {key, id, label, price} shape the panel expects.
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
      if (isMandatory) {
        mandatoryGroups.push(groupObj);
      } else {
        optionalGroups.push(groupObj);
      }
    });

    var modConfig = {
      mandatoryGroups: mandatoryGroups,
      optionalGroups: optionalGroups,
      includedItems: [],
    };

    // FIX A: set label so the item tile shows the name; read unitPrice (not price)
    // since openQsrModifierSelector forwards item.price as unitPrice.
    var fsItem = {
      id:    item.itemKey || item.key || item.name,
      name:  item.name,
      label: item.name,
      price: parseFloat(item.unitPrice || item.price || 0),
      category: 'qsr',
    };

    // FIX A: build a category crumb so the breadcrumb area shows [Category][Item $X.XX]
    var qsrCrumbs = [];
    if (item.category_name) {
      qsrCrumbs.push({ label: item.category_name.toUpperCase(), color: catColor });
    }

    // Call openModifierPanel with container as mainArea
    openModifierPanel(fsItem, modConfig, catColor, false, {
      mainArea: container,
      snakeState: { crumbs: qsrCrumbs },
      onPanelInit: {
        onUpdate: function(outputItem) {
          // Real-time update (optional)
        },
        onSend: function(outputItem) {
          // Map full-service result back to QSR shape
          var mods = [];
          if (outputItem.mods && Array.isArray(outputItem.mods)) {
            outputItem.mods.forEach(function(mod) {
              mods.push({
                name: mod.name,
                price: mod.price || 0,
              });
            });
          }
          var configured = {
            name: outputItem.name,
            price: outputItem.unitPrice,
            itemKey: outputItem.menu_item_id || item.itemKey || item.key || item.name,
            mods: mods,
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

    return function cleanup() {
      state._alive = false;
    };
  },
});

function openQsrModifierSelector(item, catColor, onConfirm) {
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
    catColor: catColor,
    onConfirm: onConfirm,
  });
}

export { openQsrModifierSelector };
