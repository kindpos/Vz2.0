// terminal/qsr-utils.js
// Shared utilities for QSR scenes

import { defineScene, SceneManager } from './scene-manager.js';
import { T } from '../common/tokens.js';
import { buildPillButton, hexToRgba } from './theme-manager.js';

defineScene({
  name: 'qsr-modifier-selector',

  render: function(container, params, state) {
    state._alive = true;

    var item           = params.item     || {};
    var catColor       = params.catColor || T.green;
    var modifierGroups = item.modifier_groups || [];

    // selections: gid → [{ modifier_id, name, price }]
    var selections = {};
    modifierGroups.forEach(function(grp) {
      var gid = grp.group_id || grp.id || grp.name;
      selections[gid] = [];
    });

    function computeTotal() {
      var extra = 0;
      modifierGroups.forEach(function(grp) {
        var gid = grp.group_id || grp.id || grp.name;
        (selections[gid] || []).forEach(function(s) { extra += Number(s.price) || 0; });
      });
      return (Number(item.unitPrice) || 0) + extra;
    }

    // ── Layout ───────────────────────────────────────────────────────
    container.style.cssText = [
      'position:absolute;inset:0;',
      'background:' + T.bg + ';',
      'display:flex;flex-direction:column;',
      'padding:16px 20px 20px;',
      'box-sizing:border-box;',
    ].join('');

    // ── Header ───────────────────────────────────────────────────────
    var header = document.createElement('div');
    header.style.cssText = 'flex-shrink:0;margin-bottom:16px;';

    var nameEl = document.createElement('div');
    nameEl.style.cssText = [
      'font-family:' + T.fh + ';',
      'font-size:22px;font-weight:' + T.fwBold + ';',
      'color:' + T.text + ';',
    ].join('');
    nameEl.textContent = item.name || '';

    var priceEl = document.createElement('div');
    priceEl.style.cssText = [
      'font-family:' + T.fb + ';',
      'font-size:18px;font-weight:' + T.fwBold + ';',
      'color:' + T.gold + ';',
      'margin-top:4px;',
    ].join('');
    priceEl.textContent = '$' + (Number(item.unitPrice) || 0).toFixed(2);

    header.appendChild(nameEl);
    header.appendChild(priceEl);
    container.appendChild(header);

    // ── Scrollable modifier groups ────────────────────────────────────
    var scroll = document.createElement('div');
    scroll.style.cssText = 'flex:1;overflow-y:auto;min-height:0;touch-action:pan-y;';
    container.appendChild(scroll);

    // doneBtn declared before the group loop so updateDoneBtn can reference it.
    var doneBtn;

    function updateDoneBtn() {
      var allMet = modifierGroups.every(function(grp) {
        var gid = grp.group_id || grp.id || grp.name;
        return (selections[gid] || []).length >= (grp.min_selections || 0);
      });
      if (!doneBtn) return;
      if (doneBtn.setDisabled) doneBtn.setDisabled(!allMet);
      doneBtn.style.opacity       = allMet ? '1'    : '0.4';
      doneBtn.style.pointerEvents = allMet ? 'auto' : 'none';
    }

    // Per-group tile registry so taps can repaint siblings.
    var tilesByGroup = {};

    modifierGroups.forEach(function(grp) {
      var gid       = grp.group_id || grp.id || grp.name;
      var isSingle  = (grp.max_selections || 1) === 1;
      var isMandatory = (grp.min_selections || 0) >= 1;
      var maxSel    = grp.max_selections || 99;
      var options   = grp.modifiers || grp.options || [];

      if (!options.length) return;

      var section = document.createElement('div');
      section.style.cssText = 'margin-bottom:20px;';

      var groupLabel = document.createElement('div');
      groupLabel.style.cssText = [
        'font-family:' + T.fb + ';',
        'font-size:11px;font-weight:' + T.fwBold + ';',
        'color:' + T.moon + ';',
        'letter-spacing:1.5px;text-transform:uppercase;',
        'margin-bottom:8px;',
      ].join('');
      groupLabel.textContent = grp.name + (isMandatory ? '  ✱' : '');
      section.appendChild(groupLabel);

      var grid = document.createElement('div');
      grid.style.cssText = 'display:flex;flex-wrap:wrap;gap:8px;';

      tilesByGroup[gid] = [];

      options.forEach(function(opt) {
        var mid      = opt.modifier_id || opt.id || opt.name;
        var optPrice = parseFloat(opt.price || 0);

        var tile = document.createElement('div');
        tile.style.cssText = [
          'padding:8px 14px;',
          'border-radius:8px;',
          'border:2px solid ' + T.border + ';',
          'background:' + T.well + ';',
          'cursor:pointer;pointer-events:auto;touch-action:manipulation;',
          'display:flex;flex-direction:column;align-items:center;gap:2px;',
          'transition:' + T.transitionFast + ';',
        ].join('');

        var optNameEl = document.createElement('span');
        optNameEl.style.cssText = [
          'font-family:' + T.fb + ';',
          'font-size:14px;font-weight:' + T.fwBold + ';',
          'color:' + T.text + ';',
        ].join('');
        optNameEl.textContent = opt.name;
        tile.appendChild(optNameEl);

        if (optPrice > 0) {
          var optPriceEl = document.createElement('span');
          optPriceEl.style.cssText = [
            'font-family:' + T.fb + ';',
            'font-size:11px;font-weight:' + T.fwBold + ';',
            'color:' + T.gold + ';',
          ].join('');
          optPriceEl.textContent = '+$' + optPrice.toFixed(2);
          tile.appendChild(optPriceEl);
        }

        function isSelected() {
          var list = selections[gid] || [];
          for (var k = 0; k < list.length; k++) {
            if (list[k].modifier_id === mid) return true;
          }
          return false;
        }

        function paintTile() {
          var sel = isSelected();
          tile.style.border     = '2px solid ' + (sel ? catColor : T.border);
          tile.style.background = sel ? hexToRgba(catColor, 0.18) : T.well;
          optNameEl.style.color = sel ? catColor : T.text;
        }

        tile._paint = paintTile;
        tilesByGroup[gid].push(tile);

        // IIFE to close over per-option values
        ;(function(g, m, label, price, single, max) {
          tile.addEventListener('pointerup', function() {
            if (single) {
              selections[g] = [{ modifier_id: m, name: label, price: price }];
            } else {
              var list = selections[g] || [];
              var idx = -1;
              for (var k = 0; k < list.length; k++) {
                if (list[k].modifier_id === m) { idx = k; break; }
              }
              if (idx >= 0) {
                list.splice(idx, 1);
              } else if (list.length < max) {
                list.push({ modifier_id: m, name: label, price: price });
              }
              selections[g] = list;
            }
            // Repaint all tiles in this group
            var siblings = tilesByGroup[g] || [];
            for (var i = 0; i < siblings.length; i++) {
              if (siblings[i]._paint) siblings[i]._paint();
            }
            priceEl.textContent = '$' + computeTotal().toFixed(2);
            updateDoneBtn();
          });
        })(gid, mid, opt.name, optPrice, isSingle, maxSel);

        paintTile();
        grid.appendChild(tile);
      });

      section.appendChild(grid);
      scroll.appendChild(section);
    });

    // ── Footer: ADD TO ORDER ──────────────────────────────────────────
    var footer = document.createElement('div');
    footer.style.cssText = 'flex-shrink:0;padding-top:16px;';

    doneBtn = buildPillButton({
      label:   'ADD TO ORDER',
      variant: 'goGreen',
      onClick: function() {
        var mods = [];
        modifierGroups.forEach(function(grp) {
          var gid = grp.group_id || grp.id || grp.name;
          (selections[gid] || []).forEach(function(sel) {
            mods.push({ name: sel.name, price: sel.price || 0 });
          });
        });
        var configured = {
          name:    item.name,
          price:   computeTotal(),
          itemKey: item.itemKey,
          mods:    mods,
        };
        SceneManager.closeTransactional('qsr-modifier-selector');
        if (params.onConfirm) params.onConfirm(configured);
      },
    });
    doneBtn.style.width = '100%';

    footer.appendChild(doneBtn);
    container.appendChild(footer);

    updateDoneBtn();

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
      itemKey:         item.itemKey || item.key || item.name,
      modifier_groups: item.modifier_groups,
      mods:            [],
    },
    catColor: catColor,
    onConfirm: onConfirm,
  });
}

export { openQsrModifierSelector };
