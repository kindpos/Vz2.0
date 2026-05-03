// ═══════════════════════════════════════════════════
//  KINDpos Terminal — QSR Modifier Selector  (Vz2.0)
//
//  Transactional overlay — opens over qsr-order.
//  Shows INCLUDED / MANDATORY / OPTIONS sections.
//  Calls onConfirm({ name, price, itemKey, mods[] })
//  when DONE — ADD TO ORDER is tapped.
//
//  Params:
//    item: {
//      name, unitPrice, itemKey,
//      modifier_groups: [{ group_id, name, type,
//        modifiers: [{ modifier_id, name, price }] }]
//    }
//    catColor: string   // category color for accents
//    onConfirm(configuredItem)
//    onCancel()
//
//  Nice. Dependable. Yours.
// ═══════════════════════════════════════════════════

import { defineScene, SceneManager } from '../scene-manager.js';
import { T } from '../../common/tokens.js';
import { darkenHex, hexToRgba } from '../theme-manager.js';
import { fmt } from './checkout-core.js';

var state = {
  item:       null,
  catColor:   T.green,
  onConfirm:  null,
  onCancel:   null,
  selections: {},
};

var els = {};

// ── Helpers ──────────────────────────────────────────────

function moneyRound(x) { return Math.round(x * 100) / 100; }

function _isMandatory(grp) {
  var t = (grp.type || grp.group_type || '').toLowerCase();
  return t === 'mandatory' || t === 'required' || t === 'must_select';
}

function _isIncluded(grp) {
  var t = (grp.type || grp.group_type || '').toLowerCase();
  return t === 'included' || t === 'default';
}

function buildSelectedMods() {
  var mods = [];
  (state.item.modifier_groups || []).forEach(function(grp) {
    var selected = state.selections[grp.group_id] || [];
    selected.forEach(function(modId) {
      var mod = (grp.modifiers || []).find(function(m) {
        return (m.modifier_id || m.id) === modId;
      });
      if (mod) mods.push({ name: mod.name, price: parseFloat(mod.price || 0) });
    });
  });
  return mods;
}

function computeTotal() {
  var base = parseFloat(state.item.unitPrice || 0);
  return moneyRound(base + buildSelectedMods().reduce(function(s, m) {
    return moneyRound(s + (m.price || 0));
  }, 0));
}

function allMandatoryMet() {
  return (state.item.modifier_groups || []).every(function(grp) {
    if (!_isMandatory(grp)) return true;
    return (state.selections[grp.group_id] || []).length > 0;
  });
}

// ── UI Builders ──────────────────────────────────────────

function buildBreadcrumb() {
  var bc = document.createElement('div');
  bc.style.cssText = [
    'font-family:' + T.fb + ';font-size:10px;font-weight:' + T.fwBold + ';',
    'color:' + state.catColor + ';letter-spacing:1px;',
    'padding:10px ' + T.scenePad + 'px 8px;',
    'border-bottom:1px solid ' + T.border + ';',
    'opacity:0.8;',
  ].join('');
  bc.textContent = 'MENU  ›  ' + state.item.name.toUpperCase() + '  ›  CUSTOMISE';
  return bc;
}

function buildSectionHeader(label, isMandatory) {
  var hdr = document.createElement('div');
  hdr.style.cssText = 'display:flex;align-items:center;gap:10px;padding:10px ' + T.scenePad + 'px 6px;';

  var title = document.createElement('span');
  title.style.cssText = [
    'font-family:' + T.fh + ';font-size:14px;font-weight:' + T.fwBold + ';',
    'color:' + T.text + ';',
  ].join('');
  title.textContent = label;
  hdr.appendChild(title);

  if (isMandatory) {
    var badge = document.createElement('span');
    badge.style.cssText = [
      'font-family:' + T.fb + ';font-size:10px;font-weight:' + T.fwBold + ';',
      'color:#fff;background:' + T.verm + ';',
      'padding:2px 8px;border-radius:4px;',
    ].join('');
    badge.textContent = 'REQUIRED';
    hdr.appendChild(badge);
  }
  return hdr;
}

function buildModTile(mod, grp, isSelected) {
  var modId = mod.modifier_id || mod.id;
  var tile = document.createElement('div');

  tile.style.cssText = [
    'border-radius:8px;',
    'padding:8px 12px;',
    'cursor:pointer;pointer-events:auto;touch-action:manipulation;',
    'display:flex;justify-content:space-between;align-items:center;',
    'min-height:44px;',
    isSelected
      ? 'background:' + state.catColor + ';'
      : 'background:' + T.well + ';border:1px solid ' + T.border + ';',
  ].join('');

  var nameEl = document.createElement('span');
  nameEl.style.cssText = [
    'font-family:' + T.fh + ';font-size:14px;font-weight:' + T.fwBold + ';',
    'color:' + (isSelected ? darkenHex(state.catColor, 0.5) : T.text) + ';',
  ].join('');
  nameEl.textContent = mod.name;

  var priceEl = document.createElement('span');
  priceEl.style.cssText = [
    'font-family:' + T.fb + ';font-size:13px;font-weight:' + T.fwBold + ';',
    'color:' + (isSelected ? darkenHex(state.catColor, 0.5) : T.gold) + ';',
  ].join('');
  var price = parseFloat(mod.price || 0);
  priceEl.textContent = price > 0 ? '+' + fmt(price) : '';

  tile.appendChild(nameEl);
  tile.appendChild(priceEl);

  tile.addEventListener('pointerup', function() {
    var isMand = _isMandatory(grp);
    var sel = state.selections[grp.group_id] || [];
    var idx = sel.indexOf(modId);

    if (isMand) {
      state.selections[grp.group_id] = [modId];
    } else {
      if (idx !== -1) {
        sel.splice(idx, 1);
      } else {
        sel.push(modId);
      }
      state.selections[grp.group_id] = sel;
    }
    rerenderPanel();
  });

  return tile;
}

function buildGroupSection(grp) {
  var section = document.createElement('div');

  if (_isIncluded(grp)) {
    section.style.cssText = 'padding:0 ' + T.scenePad + 'px;margin-bottom:8px;';
    section.appendChild(buildSectionHeader('INCLUDED', false));
    var list = document.createElement('div');
    list.style.cssText = 'display:flex;flex-direction:column;gap:4px;margin-top:4px;';
    (grp.modifiers || []).forEach(function(mod) {
      var row = document.createElement('div');
      row.style.cssText = [
        'font-family:' + T.fb + ';font-size:13px;font-weight:' + T.fwBold + ';',
        'color:' + T.moon + ';padding:4px 0;',
      ].join('');
      row.textContent = '· ' + mod.name;
      list.appendChild(row);
    });
    section.appendChild(list);
    return section;
  }

  var isMandatory = _isMandatory(grp);
  section.style.cssText = 'padding:0 ' + T.scenePad + 'px;margin-bottom:12px;';
  section.appendChild(buildSectionHeader(isMandatory ? 'MANDATORY' : 'OPTIONS', isMandatory));

  var label = document.createElement('div');
  label.style.cssText = [
    'font-family:' + T.fb + ';font-size:10px;font-weight:' + T.fwBold + ';',
    'color:' + state.catColor + ';letter-spacing:1.5px;',
    'padding:2px 0 6px;text-transform:uppercase;',
  ].join('');
  label.textContent = grp.name || '';
  section.appendChild(label);

  var grid = document.createElement('div');
  grid.style.cssText = 'display:flex;flex-direction:column;gap:6px;';
  var sel = state.selections[grp.group_id] || [];
  (grp.modifiers || []).forEach(function(mod) {
    var modId = mod.modifier_id || mod.id;
    grid.appendChild(buildModTile(mod, grp, sel.indexOf(modId) !== -1));
  });
  section.appendChild(grid);
  return section;
}

function buildAddButton() {
  var btn = document.createElement('div');
  els.addBtn = btn;
  _updateAddButton();

  btn.addEventListener('pointerup', function() {
    if (!allMandatoryMet()) {
      btn.style.background = T.verm;
      setTimeout(function() { _updateAddButton(); }, 500);
      return;
    }
    var mods = buildSelectedMods();
    SceneManager.closeTransactional('qsr-modifier-selector');
    if (state.onConfirm) {
      state.onConfirm({
        name:    state.item.name,
        price:   state.item.unitPrice,
        itemKey: state.item.itemKey,
        mods:    mods,
      });
    }
  });

  return btn;
}

function _updateAddButton() {
  if (!els.addBtn) return;
  var met   = allMandatoryMet();
  var total = computeTotal();
  els.addBtn.style.cssText = [
    'margin:0 ' + T.scenePad + 'px ' + T.scenePad + 'px;',
    'height:52px;border-radius:10px;',
    'display:flex;align-items:center;justify-content:center;',
    'cursor:pointer;pointer-events:auto;touch-action:manipulation;',
    'background:' + (met ? state.catColor : hexToRgba(state.catColor, 0.35)) + ';',
    met ? 'box-shadow:0 4px 0 ' + darkenHex(state.catColor, 0.3) + ';' : '',
    'transition:background 0.2s;',
  ].join('');
  els.addBtn.textContent = '';
  var lbl = document.createElement('span');
  lbl.style.cssText = [
    'font-family:' + T.fh + ';font-size:18px;font-weight:800;',
    'color:' + darkenHex(state.catColor, 0.5) + ';',
  ].join('');
  lbl.textContent = 'ADD TO ORDER  ' + fmt(total);
  els.addBtn.appendChild(lbl);
}

function buildPanel() {
  var panel = document.createElement('div');
  panel.style.cssText = 'position:absolute;inset:0;display:flex;flex-direction:column;background:' + T.bg + ';';

  panel.appendChild(buildBreadcrumb());

  var scroll = document.createElement('div');
  scroll.style.cssText = 'flex:1;overflow-y:auto;padding-top:8px;';
  els.scroll = scroll;

  var groups = state.item.modifier_groups || [];
  if (groups.length === 0) {
    var empty = document.createElement('div');
    empty.style.cssText = [
      'padding:' + T.scenePad + 'px;',
      'font-family:' + T.fb + ';font-size:14px;font-weight:' + T.fwBold + ';',
      'color:' + T.moon + ';',
    ].join('');
    empty.textContent = 'No modifier groups configured for this item.';
    scroll.appendChild(empty);
  } else {
    groups.forEach(function(grp) { scroll.appendChild(buildGroupSection(grp)); });
  }

  panel.appendChild(scroll);
  panel.appendChild(buildAddButton());
  return panel;
}

function rerenderPanel() {
  if (!els.scroll) return;
  els.scroll.innerHTML = '';
  var groups = state.item.modifier_groups || [];
  groups.forEach(function(grp) { els.scroll.appendChild(buildGroupSection(grp)); });
  _updateAddButton();
}

// ── Scene Registration ────────────────────────────────────

defineScene('qsr-modifier-selector', {
  mount: function(container, params) {
    var p = params || {};
    state.item      = p.item     || { name: '', unitPrice: 0, modifier_groups: [] };
    state.catColor  = p.catColor || T.green;
    state.onConfirm = p.onConfirm || null;
    state.onCancel  = p.onCancel  || null;
    state.selections = {};

    (state.item.modifier_groups || []).forEach(function(grp) {
      state.selections[grp.group_id] = [];
    });

    container.appendChild(buildPanel());
  },

  unmount: function() {
    els.addBtn = null;
    els.scroll = null;
  },
});
