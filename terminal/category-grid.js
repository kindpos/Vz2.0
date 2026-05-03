// ═══════════════════════════════════════════════════
//  KINDpos Terminal — Category Grid Component
//  Chamfered-tile nav, drop-in HexNav replacement
//  Nice. Dependable. Yours.
// ═══════════════════════════════════════════════════

import { T } from '../common/tokens.js';
import { hexToRgba } from './theme-manager.js';

// Shrink label font until it fits the tile. Allows natural multi-word
// wrapping; shrinks when a single long word overflows width, or when
// wrapped lines overflow height. Runs after first paint so layout is real.
function _fitLabel(tile, lbl) {
  requestAnimationFrame(() => {
    const max = 26;
    const min = 12;
    let size = max;
    lbl.style.fontSize = `${size}px`;
    const availW = tile.clientWidth  - 20;
    const availH = tile.clientHeight - 16;
    if (availW <= 0 || availH <= 0) return;
    while (size > min && (lbl.scrollWidth > availW || lbl.scrollHeight > availH)) {
      size -= 1;
      lbl.style.fontSize = `${size}px`;
    }
  });
}

function _alphaCmp(a, b) {
  const la = String(a.label || a.name || a).toLowerCase();
  const lb = String(b.label || b.name || b).toLowerCase();
  return la < lb ? -1 : la > lb ? 1 : 0;
}

// ═══════════════════════════════════════════════════
//  CategoryGrid
//  Usage:
//    var grid = new CategoryGrid(containerEl, {
//      data: menuData,            // array of cat objects
//      onSelect: fn(item, mods),  // called on leaf tap (mods always {})
//      columns: 3,                // grid columns (default 3)
//      sort:    'alpha',          // 'alpha' | 'none' | fn(a,b) (default 'alpha')
//    });
//    grid.setData(newData);       // swap data, return to State A
//    grid.setColumns(n);          // re-layout with a new column count
//    grid.setSort(spec);          // change sort ('alpha' | 'none' | fn)
//    grid.reset();                // return to State A
//    grid.destroy();              // remove from DOM
//
//  HexNav-compatible stubs so order-entry's combo/modifier paths keep
//  working without touching hex-nav.js:
//    grid.getCatId()
//    grid.lockNav() / grid.unlockNav()
//    grid.showPickList(label, color, textColor, items)
// ═══════════════════════════════════════════════════

export function CategoryGrid(container, opts) {
  const o        = opts || {};
  const onSelect = o.onSelect || function() {};
  let data     = o.data    || [];
  let columns  = o.columns || 3;
  let sortSpec = o.sort    !== undefined ? o.sort : 'alpha';

  // Drill path. Empty = State A (categories). Non-empty = State B
  // with the top of the stack as the parent back tile.
  let path = [];
  let navLocked = false;

  // Mandatory-modifier picking state. When active, the grid shows the
  // item's requiredMods groups (and drills into each group's choices)
  // instead of the cat/subcat nav.
  const modState = {
    active:       false,
    item:         null,
    groups:       [],    // filtered list of groups with choices
    selectedMods: [],    // [{ group, label, price }]
    satisfied:    {},    // { groupId: true }
    group:        null,  // currently drilled-into group, else null
  };

  function resetMods() {
    modState.active = false;
    modState.item = null;
    modState.groups = [];
    modState.selectedMods = [];
    modState.satisfied = {};
    modState.group = null;
  }

  // ── Root element ──
  const root = document.createElement('div');
  applyGridStyle();
  container.appendChild(root);

  function applyGridStyle() {
    root.style.cssText = [
      'width:100%;height:100%;box-sizing:border-box;',
      `display:grid;grid-template-columns:repeat(${columns}, 1fr);gap:12px;`,
      'padding:12px;',
      `background:${T.bg};`,
      'border-radius:0;',
      'overflow:auto;align-content:start;',
    ].join('');
  }

  function sortChildren(children) {
    if (!children || children.length === 0) return children;
    if (sortSpec === 'none') return children;
    const cmp = typeof sortSpec === 'function' ? sortSpec : _alphaCmp;
    return children.slice().sort(cmp);
  }

  // Build a tile element.
  //   mode: 'border' (idle cat/subcat) or 'solid' (parent back tile)
  function buildTile(cfg) {
    const mode   = cfg.mode || 'border';
    const color  = cfg.color || T.green;
    const label  = cfg.label || '';
    const price  = cfg.price;
    const isBack = !!cfg.back;
    const onTap  = cfg.onTap;

    const tile = document.createElement('div');

    const baseBg   = mode === 'solid' ? color  : T.well;
    const labelClr = mode === 'solid' ? T.well : color;

    tile.style.cssText = [
      'position:relative;box-sizing:border-box;',
      'display:flex;flex-direction:column;align-items:center;justify-content:center;',
      'min-height:120px;padding:14px 10px;',
      `background:${baseBg};`,
      `border-left:${T.accentBarW} solid ${T.green};`,
      `border-radius:${T.chamferCard}px;`,
      'cursor:pointer;user-select:none;-webkit-user-select:none;',
      'pointer-events:auto;touch-action:manipulation;',
      'transition:transform 60ms, filter 60ms;',
    ].join('');

    if (mode === 'border') {
      tile.style.boxShadow = `0 0 8px ${hexToRgba(color, 0.33)}`;
    } else {
      tile.style.boxShadow = `inset 0 2px 0 ${hexToRgba(T.card, 0.5)}, inset 0 -2px 0 ${hexToRgba(T.border, 0.6)}`;
    }

    // Label — natural wrapping; _fitLabel shrinks font on overflow.
    const lbl = document.createElement('div');
    lbl.style.cssText = [
      `font-family:${T.fh};`,
      `font-weight:${T.fwBold};font-size:26px;line-height:1.1;`,
      `color:${labelClr};`,
      'text-align:center;pointer-events:none;',
      'max-width:100%;',
    ].join('');
    lbl.textContent = label;
    tile.appendChild(lbl);
    _fitLabel(tile, lbl);

    // Price (gold) if provided
    if (price !== undefined && price !== null && price !== '') {
      const p = document.createElement('div');
      p.style.cssText = `${[
        `font-family:${T.fb};`,
        'font-size:20px;margin-top:6px;',
        `color:${T.gold};`,
        'pointer-events:none;',
      ].join('')};font-weight:${T.fwBold};`;
      const pv = Number(price);
      p.textContent = isNaN(pv) ? String(price) : `$${pv.toFixed(2)}`;
      tile.appendChild(p);
    }

    if (isBack) {
      const back = document.createElement('div');
      back.style.cssText = [
        'position:absolute;left:0;right:0;bottom:8px;',
        `font-family:${T.fh};`,
        `font-weight:${T.fwBold};font-size:16px;letter-spacing:2px;`,
        `color:${T.well};`,
        'text-align:center;pointer-events:none;',
      ].join('');
      back.textContent = '← BACK';
      tile.appendChild(back);
    }

    // Visual press state via pointer events, tap via click event so a
    // small finger wiggle doesn't cancel the tap (pointerleave would).
    tile.addEventListener('pointerdown', () => {
      tile.style.transform = 'translate(2px, 3px)';
      tile.style.filter = 'brightness(1.1)';
    });
    function resetPress() {
      tile.style.transform = '';
      tile.style.filter = '';
    }
    tile.addEventListener('pointerup',     resetPress);
    tile.addEventListener('pointercancel', resetPress);
    tile.addEventListener('pointerleave',  resetPress);
    tile.addEventListener('click', () => {
      if (navLocked) return;
      if (onTap) onTap();
    });

    return tile;
  }

  // ── Data helpers ──
  // Categories in this menu wrap items in a single "subcats[0].items"
  // array. Treat that wrapper as transparent so drilling into a cat
  // shows items directly.
  function childrenOf(node) {
    if (node.subcats && node.subcats.length > 0) {
      if (node.subcats.length === 1 && node.subcats[0].items) {
        return node.subcats[0].items;
      }
      return node.subcats;
    }
    if (node.items) return node.items;
    return [];
  }

  function hasChildren(node) {
    if (node.subcats && node.subcats.length > 0) return true;
    if (node.items && node.items.length > 0) return true;
    return false;
  }

  // ── Render ──
  function render() {
    root.innerHTML = '';
    if (modState.active) {
      if (modState.group) renderModChoices();
      else                renderModGroups();
      return;
    }
    if (path.length === 0) renderStateA();
    else                    renderStateB();
  }

  function renderStateA() {
    sortChildren(data).forEach((cat) => {
      root.appendChild(buildTile({
        mode:  'border',
        color: cat.color || T.green,
        label: cat.label || cat.name || '',
        onTap: () => { drillInto(cat); },
      }));
    });
  }

  function renderStateB() {
    const parent      = path[path.length - 1];
    const parentColor = parent.color || T.green;
    const children    = sortChildren(childrenOf(parent));

    root.appendChild(buildTile({
      mode:  'solid',
      color: parentColor,
      label: parent.label || parent.name || '',
      back:  true,
      onTap: () => { goBack(); },
    }));

    children.forEach((child) => {
      root.appendChild(buildTile({
        mode:  'border',
        color: parentColor,
        label: child.label || child.name || '',
        price: child.price,
        onTap: () => {
          if (hasChildren(child)) {
            drillInto(child);
          } else if (child.requiredMods && child.requiredMods.length > 0) {
            startMods(child);
          } else {
            onSelect(child, {});
          }
        },
      }));
    });
  }

  // ── Modifier flow ──
  // Backend payloads sometimes use `name`/`modifier_id` instead of the
  // `label`/`id` documented in hex-nav. Normalize both shapes so tiles
  // always show a human name.
  function _label(o) {
    return (o && (o.label || o.name)) || '';
  }
  function _id(o) {
    return (o && (o.id || o.group_id || o.modifier_id)) || '';
  }

  function startMods(item) {
    const groups = (item.requiredMods || []).filter((g) => g.choices && g.choices.length > 0);
    if (groups.length === 0) {
      onSelect(item, {});
      return;
    }
    modState.active = true;
    modState.item = item;
    modState.groups = groups;
    modState.selectedMods = [];
    modState.satisfied = {};
    modState.group = null;
    render();
  }

  function pickChoice(group, choice) {
    const gid = _id(group);
    // Single-select: replace any prior pick for this group.
    modState.selectedMods = modState.selectedMods.filter((m) => m.group !== gid);
    modState.selectedMods.push({
      group: gid,
      label: _label(choice),
      price: choice.price || 0,
    });
    modState.satisfied[gid] = true;
    modState.group = null;
    render();
  }

  function finalizeMods() {
    const result = {};
    for (const k in modState.item) result[k] = modState.item[k];
    result.selectedMods = modState.selectedMods.slice();
    resetMods();
    onSelect(result, {});
    render();
  }

  function cancelMods() {
    resetMods();
    render();
  }

  // Mod-flow tiles always inherit the drilled-into category color so
  // groups, choices, and the item back tile read as one family. Falls
  // back to the item's own color (pick-list flows) or mint.
  function _modColor() {
    return (path[0] && path[0].color)
        || (modState.item && modState.item.color)
        || T.green;
  }

  function renderModGroups() {
    const item     = modState.item;
    const catColor = _modColor();

    root.appendChild(buildTile({
      mode:  'solid',
      color: catColor,
      label: _label(item),
      price: item.price,
      back:  true,
      onTap: () => { cancelMods(); },
    }));

    modState.groups.forEach((g) => {
      const gid    = _id(g);
      let picked = null;
      modState.selectedMods.forEach((m) => { if (m.group === gid) picked = m; });
      const isDone = !!modState.satisfied[gid];
      root.appendChild(buildTile({
        mode:  isDone ? 'solid' : 'border',
        color: catColor,
        label: picked ? picked.label : _label(g),
        onTap: () => {
          modState.group = g;
          render();
        },
      }));
    });

    const allDone = modState.groups.length > 0 && modState.groups.every((g) => modState.satisfied[_id(g)]);
    if (allDone) {
      root.appendChild(buildTile({
        mode:  'solid',
        color: T.greenWarm,
        label: 'DONE',
        onTap: () => { finalizeMods(); },
      }));
    }
  }

  function renderModChoices() {
    const g        = modState.group;
    const catColor = _modColor();

    root.appendChild(buildTile({
      mode:  'solid',
      color: catColor,
      label: _label(g),
      back:  true,
      onTap: () => {
        modState.group = null;
        render();
      },
    }));

    (g.choices || []).forEach((c) => {
      root.appendChild(buildTile({
        mode:  'border',
        color: catColor,
        label: _label(c),
        price: c.price,
        onTap: () => { pickChoice(g, c); },
      }));
    });
  }

  function drillInto(node) {
    path.push(node);
    render();
  }

  function goBack() {
    path.pop();
    render();
  }

  // ── Public API ──
  this.setData = (newData) => {
    data = newData || [];
    path = [];
    resetMods();
    render();
  };

  this.setColumns = (n) => {
    columns = Math.max(1, n | 0);
    applyGridStyle();
    render();
  };

  this.setSort = (spec) => {
    sortSpec = spec !== undefined ? spec : 'alpha';
    render();
  };

  this.reset = () => {
    path = [];
    resetMods();
    render();
  };

  this.destroy = () => {
    if (root && root.parentNode) root.parentNode.removeChild(root);
  };

  // ── HexNav-compatible stubs ──
  // Top-level cat id of the current drill path (null at State A).
  this.getCatId = () => (path.length > 0 ? (path[0].id || null) : null);

  this.lockNav   = () => { navLocked = true;  };
  this.unlockNav = () => { navLocked = false; };

  // Replace the current view with a custom synthesized parent + items.
  // Used by the combo flow to prompt for sides / drinks.
  this.showPickList = (label, color, textColor, items) => {
    path = [{
      id:        `pick-${(label || '').toLowerCase()}`,
      label:     label || '',
      color:     color || T.green,
      textColor,
      items:     items || [],
    }];
    render();
  };

  // ── Init ──
  render();
}
