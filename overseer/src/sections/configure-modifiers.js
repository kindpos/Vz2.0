import { pushChanges } from '../services/config-push.js';
import { fetchModifierData, EMPTY_DATA, handleSaveChanges as _handleSaveChanges } from './modifier-data.js';
import { initPicker, buildChipTray, openPickerModal } from '../components/picker-modal.js';
import { initConfirmDialog, showConfirmDialog } from '../components/confirm-dialog.js';
import { T } from '../ui/tokens.js';

/* ============================================
   KINDpos Overseer — Configure Modifiers

   Two tabs, one event stream:
   1. Modifiers — master list of modifiers (add-ons).
      Modifiers can carry microMODs.
   2. Groups — collections of modifiers wired to items
      (mandatory) or categories (universal) through
      min_selections / max_selections / drives_pricing.

   Assignments tab is GONE — wiring lives on the
   item modal (mandatory) and category modal
   (universal) in menu-categories.js.

   Reskinned to Vz2.0 Nostalgia. Event stream is
   group-only: modifier.group_created / _updated /
   _deleted. Modifier edits cascade into updates of
   every group that references them.

   Nice. Dependable. Yours.
   ============================================ */

/* ------------------------------------------
   NOSTALGIA PALETTE — mirrors home.js
------------------------------------------ */
const C = {
    bg:         '#383c42',
    card:       '#2e3236',
    well:       '#22252a',
    gold:       '#f5a623',
    goldDk:     '#7a4d00',
    cyan:       '#22d3ee',
    green:      '#86efac',
    greenDk:    '#1a5c2e',
    greenUp:    '#4ade80',
    greenUpDk:  '#166534',
    lavender:   '#b48efa',
    lavenderDk: '#5a3a9a',
    verm:       '#e8472a',
    vermDk:     '#6b1a0e',
    warning:    '#fbbf24',
    warningDk:  '#78350f',
    text:       '#e8eaed',
    textMuted:  'rgba(232,234,237,0.55)',
    textDim:    'rgba(232,234,237,0.4)',
    border:     'rgba(232,234,237,0.08)',
    hairline:   '#2a2d32',
};

/* ------------------------------------------
   MODULE STATE — single const; properties mutate, binding never does.
------------------------------------------ */
const _state = {
    currentWrapper: null,
    modData: null,
    // Single bucket. Modifier edits cascade into group events
    // on save — no separate mandatory/universal bucket.
    pendingChanges: { modifiers: [], groups: [] },
    activeTab: 'modifiers', // 'modifiers' | 'groups'
    searchState: { modifiers: '', groups: '' },
    modifierFilter: 'all', // 'all' | 'bundled' | 'orphan' — scoped to Modifiers tab
};

/* ------------------------------------------
   SMALL UTILS
------------------------------------------ */
const clone = (obj) => JSON.parse(JSON.stringify(obj)); ;
const formatPrice = (p) => '$' + Number(p || 0).toFixed(2); ;

const getPendingCount = () => (_state.pendingChanges.modifiers || []).length + (_state.pendingChanges.groups || []).length;
;

const getAllWorking = (collection) => {
    const base = _state.modData[collection] || [];
    const pending = _state.pendingChanges[collection] || [];
    const pendingMap = new Map(pending.map(p => [p.id, p]));
    const result = [];
    for (const b of base) {
        const p = pendingMap.get(b.id);
        if (p) {
            if (!p._deleted) result.push(p);
            pendingMap.delete(b.id);
        } else {
            result.push(b);
        }
    }
    for (const p of pendingMap.values()) {
        if (!p._deleted) result.push(p);
    }
    return result;
}

const trackChange = (collection, item) => {
    if (!_state.pendingChanges[collection]) _state.pendingChanges[collection] = [];
    const idx = _state.pendingChanges[collection].findIndex(x => x.id === item.id);
    if (idx >= 0) _state.pendingChanges[collection][idx] = item;
    else _state.pendingChanges[collection].push(item);
    updateFooter();
}

/**
 * Guard: a group with min_selections >= 1 must have at least one modifier.
 * Highlights highlightEl with T.verm, shows a toast, returns false if invalid.
 */
const _guardMandatoryHasModifiers = (minSelections, modifierIds, groupName, highlightEl) => {
    if (minSelections >= 1 && modifierIds.length === 0) {
        if (highlightEl) {
            highlightEl.style.outline = `2px solid ${T.verm}`;
            highlightEl.style.borderRadius = '8px';
        }
        showToast(`"${groupName || 'Group'}" requires min ${minSelections} but has no modifiers`, 'error');
        return false;
    }
    return true;
}

const handleDeleteItem = (collection, id) => {
    if (!_state.pendingChanges[collection]) _state.pendingChanges[collection] = [];
    const idx = _state.pendingChanges[collection].findIndex(x => x.id === id);
    if (idx >= 0) {
        _state.pendingChanges[collection][idx]._deleted = true;
    } else {
        _state.pendingChanges[collection].push({ id, _deleted: true });
    }
    updateFooter();
}

/* ------------------------------------------
   PRIMITIVE HELPERS — Nostalgia vocabulary.
------------------------------------------ */

const buildCard = (accent, opts = {}) => {
    const card = document.createElement('div');
    card.style.cssText = `
        background: ${C.card};
        border-left: 4px solid ${accent || C.green};
        border-radius: 10px;
        padding: ${opts.padding || '18px 22px'};
        position: relative;
        ${opts.margin ? `margin: ${opts.margin};` : ''}
        ${opts.cssText || ''}
    `;
    return card;
}

const buildLabel = (text, opts = {}) => {
    const el = document.createElement('div');
    el.textContent = text;
    el.style.cssText = `
        font-family: ui-monospace, monospace;
        font-size: ${opts.size || '10px'};
        letter-spacing: 2px;
        text-transform: uppercase;
        font-weight: 700;
        color: ${opts.color || C.textMuted};
        ${opts.margin ? `margin: ${opts.margin};` : ''}
    `;
    return el;
}

const buildPillButton = (label, variant, onClick, opts = {}) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = label;

    const variants = {
        primary:   { bg: C.gold,     fg: C.well,   shadow: C.goldDk,     hover: '#ffb733' },
        confirm:   { bg: C.greenUp,  fg: C.well,   shadow: C.greenUpDk,  hover: '#5fe895' },
        secondary: { bg: 'transparent', fg: C.green, shadow: 'transparent', border: `1px solid ${C.green}` },
        tertiary:  { bg: 'transparent', fg: C.textMuted, shadow: 'transparent' },
        danger:    { bg: C.verm,     fg: C.text,   shadow: C.vermDk,     hover: '#ff5d3d' },
    };
    const v = variants[variant] || variants.primary;

    b.style.cssText = `
        display: inline-block;
        padding: ${opts.small ? '8px 16px' : '12px 22px'};
        background: ${v.bg};
        color: ${v.fg};
        border: ${v.border || 'none'};
        border-radius: 999px;
        font-family: system-ui, -apple-system, sans-serif;
        font-size: ${opts.small ? '12px' : '14px'};
        font-weight: 700;
        letter-spacing: 0.3px;
        cursor: pointer;
        box-shadow: ${v.shadow === 'transparent' ? 'none' : `0 3px 0 ${v.shadow}`};
        transition: transform 0.08s ease, box-shadow 0.08s ease, background 0.15s ease;
        outline: none;
        ${opts.disabled ? 'opacity: 0.4; cursor: not-allowed; pointer-events: none;' : ''}
        ${opts.cssText || ''}
    `;

    if (!opts.disabled) {
        b.addEventListener('mouseenter', () => {
            if (v.hover) b.style.background = v.hover;
        });
        b.addEventListener('mouseleave', () => {
            b.style.background = v.bg;
        });
        b.addEventListener('mousedown', () => {
            b.style.transform = 'translateY(2px)';
            if (v.shadow !== 'transparent') b.style.boxShadow = `0 1px 0 ${v.shadow}`;
        });
        b.addEventListener('mouseup', () => {
            b.style.transform = 'translateY(0)';
            if (v.shadow !== 'transparent') b.style.boxShadow = `0 3px 0 ${v.shadow}`;
        });
        if (onClick) b.addEventListener('click', onClick);
    }
    return b;
}

const buildTextInput = (value, opts = {}) => {
    const input = document.createElement('input');
    input.type = opts.type || 'text';
    input.value = value ?? '';
    if (opts.placeholder) input.placeholder = opts.placeholder;
    if (opts.step) input.step = opts.step;
    if (opts.min !== undefined) input.min = opts.min;
    if (opts.max !== undefined) input.max = opts.max;
    input.style.cssText = `
        width: 100%;
        padding: 10px 14px;
        background: ${C.well};
        border: 1px solid ${C.hairline};
        border-radius: 6px;
        color: ${C.text};
        font-family: ${opts.mono ? 'ui-monospace, monospace' : 'system-ui, sans-serif'};
        font-size: 15px;
        outline: none;
        transition: border-color 0.15s ease;
        ${opts.cssText || ''}
    `;
    input.addEventListener('focus', () => { input.style.borderColor = C.green; });
    input.addEventListener('blur', () => { input.style.borderColor = C.hairline; });
    return input;
}

const buildToggle = (initial, onChange, opts = {}) => {
    let state = !!initial;
    let isDisabled = !!opts.disabled;
    const wrap = document.createElement('button');
    wrap.type = 'button';

    function applyState() {
        wrap.style.cssText = `
            width: 44px; height: 24px;
            border-radius: 999px;
            background: ${state ? C.greenUp : C.well};
            border: 1px solid ${state ? C.greenUp : C.hairline};
            position: relative;
            cursor: ${isDisabled ? 'not-allowed' : 'pointer'};
            transition: background 0.15s ease;
            outline: none;
            ${isDisabled ? 'opacity: 0.4;' : ''}
        `;
        wrap.disabled = isDisabled;
        wrap.replaceChildren();
        const knob = document.createElement('span');
        knob.style.cssText = `
            position: absolute;
            top: 2px;
            left: ${state ? '22px' : '2px'};
            width: 18px; height: 18px;
            border-radius: 50%;
            background: ${state ? C.well : C.textMuted};
            transition: left 0.15s ease, background 0.15s ease;
        `;
        wrap.appendChild(knob);
    }

    wrap.setValue = (v) => {
        state = !!v;
        applyState();
    };
    wrap.getValue = () => state;
    wrap.setDisabled = (d) => {
        isDisabled = !!d;
        wrap.style.opacity = d ? '0.4' : '1';
        wrap.style.cursor = d ? 'not-allowed' : 'pointer';
        wrap.disabled = isDisabled;
    };

    if (!opts.disabled) {
        wrap.addEventListener('click', () => {
            wrap.setValue(!state);
            if (onChange) onChange(state);
        });
    }
    applyState();
    return wrap;
}

const showToast = (message, kind = 'confirm') => {
    const toast = document.createElement('div');
    const bg = kind === 'error' ? C.verm
             : kind === 'warning' ? C.warning
             : C.greenUp;
    toast.style.cssText = `
        position: fixed; top: 24px; right: 24px;
        padding: 12px 20px;
        background: ${bg};
        color: ${C.well};
        font-family: system-ui, sans-serif;
        font-size: 14px;
        font-weight: 700;
        border-radius: 999px;
        z-index: 1000;
        box-shadow: 0 6px 20px rgba(0,0,0,0.4);
        transition: opacity 0.3s ease, transform 0.3s ease;
    `;
    toast.textContent = (kind === 'error' ? '✕ ' : kind === 'warning' ? '⚠ ' : '✓ ') + message;
    document.body.appendChild(toast);
    setTimeout(() => {
        toast.style.opacity = '0';
        toast.style.transform = 'translateY(-10px)';
        setTimeout(() => toast.remove(), 300);
    }, 2500);
}

/* ------------------------------------------
   MODAL SYSTEM — stacked so pickers can layer
   on top of the modifier edit modal without
   destroying it. Stack is local to this closure.
------------------------------------------ */
const { openModal, closeModal, closeAllModals } = (() => {
    const stack = [];

    function openModal(titleText, contentBuilder, opts = {}) {
        const overlay = document.createElement('div');
        overlay.style.cssText = `
            position: fixed; inset: 0;
            background: rgba(0,0,0,0.6);
            z-index: ${500 + stack.length * 10};
            display: flex; align-items: center; justify-content: center;
            padding: 20px;
        `;
        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) closeModal(overlay);
        });

        const modal = document.createElement('div');
        modal.style.cssText = `
            background: ${C.card};
            border-left: 4px solid ${opts.accent || C.gold};
            border-radius: 12px;
            max-width: ${opts.wide ? '720px' : '520px'};
            width: 100%;
            max-height: 90vh;
            display: flex; flex-direction: column;
            box-shadow: 0 20px 60px rgba(0,0,0,0.6);
        `;

        const header = document.createElement('div');
        header.style.cssText = `
            padding: 20px 24px 14px;
            border-bottom: 1px solid ${C.hairline};
            display: flex; align-items: center; justify-content: space-between;
        `;
        const title = document.createElement('div');
        title.textContent = titleText;
        title.style.cssText = `
            font-family: system-ui, sans-serif;
            font-size: 18px; font-weight: 700;
            color: ${C.text};
        `;
        const closeBtn = document.createElement('button');
        closeBtn.textContent = '×';
        closeBtn.style.cssText = `
            background: transparent; border: none;
            color: ${C.textMuted}; font-size: 26px;
            cursor: pointer; padding: 0 4px;
            line-height: 1;
        `;
        closeBtn.addEventListener('click', () => closeModal(overlay));
        header.appendChild(title);
        header.appendChild(closeBtn);
        modal.appendChild(header);

        const body = document.createElement('div');
        body.style.cssText = `
            padding: 20px 24px;
            overflow-y: auto;
            flex: 1;
        `;
        modal.appendChild(body);
        overlay.appendChild(modal);
        document.body.appendChild(overlay);

        stack.push(overlay);
        contentBuilder(body, modal);
    }

    function closeModal(specificOverlay) {
        if (stack.length === 0) return;
        const target = specificOverlay || stack[stack.length - 1];
        const idx = stack.indexOf(target);
        if (idx === -1) return;
        stack.splice(idx, 1);
        if (target.parentNode) target.remove();
    }

    function closeAllModals() {
        while (stack.length > 0) {
            const overlay = stack.pop();
            if (overlay.parentNode) overlay.remove();
        }
    }

    return { openModal, closeModal, closeAllModals };
})();

const buildModalField = (container, labelText, type, value, opts = {}) => {
    const wrap = document.createElement('div');
    wrap.style.cssText = 'margin-bottom: 16px;';
    const lbl = buildLabel(labelText, { color: C.green });
    lbl.style.marginBottom = '6px';
    wrap.appendChild(lbl);
    const input = buildTextInput(value, { type, ...opts });
    wrap.appendChild(input);
    if (opts.hint) {
        const hint = document.createElement('div');
        hint.textContent = opts.hint;
        hint.style.cssText = `
            font-family: ui-monospace, monospace;
            font-size: 11px;
            color: ${C.textDim};
            margin-top: 4px;
        `;
        wrap.appendChild(hint);
    }
    container.appendChild(wrap);
    return input;
}

const buildModalFooter = (container, onSave, opts = {}) => {
    const footer = document.createElement('div');
    footer.style.cssText = `
        display: flex; gap: 10px;
        justify-content: flex-end;
        margin-top: 20px;
        padding-top: 16px;
        border-top: 1px solid ${C.hairline};
    `;
    if (opts.extraLeft) {
        const left = document.createElement('div');
        left.style.cssText = 'margin-right: auto;';
        left.appendChild(opts.extraLeft);
        footer.appendChild(left);
    }
    footer.appendChild(buildPillButton('Cancel', 'tertiary', closeModal, { small: true }));
    footer.appendChild(buildPillButton(opts.saveLabel || 'Save', 'confirm', onSave, { small: true }));
    container.appendChild(footer);
}

// Wire picker-modal.js and confirm-dialog.js with this scene's UI primitives.
initPicker(C, { openModal, closeModal, buildPillButton, buildTextInput, buildModalFooter });
initConfirmDialog(C, { openModal, closeModal, buildPillButton });

/* ============================================
   MAIN VIEW
============================================ */

const buildMainView = (wrapper) => {
    wrapper.replaceChildren();

    // Page header
    const header = document.createElement('div');
    header.style.cssText = `
        display: flex; align-items: center; justify-content: space-between;
        margin-bottom: 20px;
        padding-bottom: 14px;
        border-bottom: 1px solid ${C.hairline};
    `;
    const titleBlock = document.createElement('div');
    const title = document.createElement('div');
    title.textContent = 'Modifiers & microMODs';
    title.style.cssText = `
        font-family: system-ui, sans-serif;
        font-size: 22px; font-weight: 700;
        color: ${C.text};
        margin-bottom: 2px;
    `;
    const subtitle = buildLabel('Master lists · Groups', { color: C.textMuted });
    titleBlock.appendChild(title);
    titleBlock.appendChild(subtitle);
    header.appendChild(titleBlock);
    wrapper.appendChild(header);

    // Tab bar
    buildTabBar(wrapper);

    // Content
    const content = document.createElement('div');
    content.id = 'configure-modifiers-content';
    content.style.cssText = 'min-height: 300px;';
    wrapper.appendChild(content);

    if (_state.activeTab === 'modifiers') buildModifiersTab(content);
    else buildGroupsTab(content);

    // Footer
    buildFooter(wrapper);
}

const buildTabBar = (wrapper) => {
    const bar = document.createElement('div');
    bar.style.cssText = `
        display: flex; gap: 6px;
        margin-bottom: 18px;
        padding: 4px;
        background: ${C.well};
        border-radius: 10px;
    `;

    const tabs = [
        { id: 'modifiers', label: 'Modifiers', count: () => getAllWorking('modifiers').length },
        { id: 'groups', label: 'Groups', count: () => getAllWorking('groups').length },
    ];

    tabs.forEach(t => {
        const tab = document.createElement('button');
        tab.type = 'button';
        const isActive = _state.activeTab === t.id;
        tab.style.cssText = `
            flex: 1;
            padding: 10px 16px;
            background: ${isActive ? C.card : 'transparent'};
            color: ${isActive ? C.text : C.textMuted};
            border: none;
            border-radius: 8px;
            font-family: system-ui, sans-serif;
            font-size: 14px;
            font-weight: 700;
            cursor: pointer;
            display: flex; align-items: center; justify-content: center; gap: 8px;
            transition: background 0.15s ease, color 0.15s ease;
        `;
        const label = document.createElement('span');
        label.textContent = t.label;
        tab.appendChild(label);

        const count = document.createElement('span');
        count.textContent = t.count();
        count.style.cssText = `
            padding: 2px 8px;
            background: ${isActive ? C.greenUp : C.hairline};
            color: ${isActive ? C.well : C.textMuted};
            border-radius: 999px;
            font-family: ui-monospace, monospace;
            font-size: 11px;
            font-weight: 700;
        `;
        tab.appendChild(count);

        tab.addEventListener('click', () => {
            _state.activeTab = t.id;
            buildMainView(_state.currentWrapper);
        });
        bar.appendChild(tab);
    });
    wrapper.appendChild(bar);
}

const buildSearchBar = (container, collection, onChange) => {
    const wrap = document.createElement('div');
    wrap.style.cssText = 'margin-bottom: 14px;';
    const input = buildTextInput(_state.searchState[collection] || '', {
        placeholder: `Search ${collection}…`,
    });
    input.addEventListener('input', () => {
        _state.searchState[collection] = input.value;
        onChange();
    });
    wrap.appendChild(input);
    container.appendChild(wrap);
}

/* ============================================
   MODIFIERS TAB (modifier master list)
============================================ */

const buildModifiersTab = (container) => {
    container.replaceChildren();

    // Search bar first, then Add button row underneath so it reads as a
    // secondary control for the filtered list below.
    buildSearchBar(container, 'modifiers', () => renderModifierList(list));

    const headerRow = document.createElement('div');
    headerRow.style.cssText = `
        display: flex; align-items: center; justify-content: flex-end;
        margin-bottom: 14px;
    `;
    const addBtn = buildPillButton('+ Add Modifier', 'primary', () => openModifierModal(null), { small: true });
    headerRow.appendChild(addBtn);
    container.appendChild(headerRow);

    // Filter chips — quick filters for common operator tasks:
    // finding bundled modifiers (microMOD carriers) and orphans (unsaved).
    buildModifierFilterRow(container, () => renderModifierList(list));

    const list = document.createElement('div');
    list.style.cssText = `display: flex; flex-direction: column; gap: 6px;`;
    container.appendChild(list);

    renderModifierList(list);
}

/**
 * Three-option filter pill row for the Modifiers tab. Single-select —
 * one option active at a time. ANDs with the search box.
 *   • All      — show every modifier
 *   • Bundled  — only modifiers with included_modifier_ids (microMODs)
 *   • Orphan   — only modifiers not referenced by any group
 */
const buildModifierFilterRow = (container, onChange) => {
    const modifiers = getAllWorking('modifiers');
    const groups = getAllWorking('groups');
    const bundledCount = modifiers.filter(a => (a.included_modifier_ids || []).length > 0).length;
    const orphanCount = modifiers.filter(a => !groups.some(g => (g.modifier_ids || []).includes(a.id))).length;

    const row = document.createElement('div');
    row.style.cssText = `
        display: flex; align-items: center; gap: 8px;
        margin-bottom: 14px;
        flex-wrap: wrap;
    `;

    const label = document.createElement('span');
    label.textContent = 'FILTER';
    label.style.cssText = `
        font-family: ui-monospace, monospace;
        font-size: 10px;
        letter-spacing: 2px;
        color: ${C.textDim};
        font-weight: 700;
        margin-right: 4px;
    `;
    row.appendChild(label);

    const options = [
        { id: 'all',     label: 'All',       count: modifiers.length,  accent: C.green    },
        { id: 'bundled', label: '⋯ Bundled', count: bundledCount,  accent: C.lavender },
        { id: 'orphan',  label: '⚠ Orphan',  count: orphanCount,   accent: C.warning  },
    ];

    // Selecting a chip replaces the row in-place so the active state visually
    // updates, then re-renders the list through onChange.
    const rebuild = () => {
        const fresh = buildModifierFilterRow(container, onChange);
        row.replaceWith(fresh);
        onChange();
    };

    options.forEach(opt => {
        const isActive = _state.modifierFilter === opt.id;
        const chip = document.createElement('button');
        chip.type = 'button';
        chip.style.cssText = `
            display: inline-flex; align-items: center; gap: 6px;
            padding: 5px 10px;
            background: ${isActive ? opt.accent : 'transparent'};
            color: ${isActive ? C.well : opt.accent};
            border: 1px solid ${opt.accent};
            border-radius: 999px;
            font-family: ui-monospace, monospace;
            font-size: 11px;
            font-weight: 700;
            letter-spacing: 1px;
            text-transform: uppercase;
            cursor: pointer;
            transition: background 0.08s ease, color 0.08s ease;
        `;
        chip.textContent = opt.label;

        // Count badge
        const badge = document.createElement('span');
        badge.textContent = opt.count;
        badge.style.cssText = `
            background: ${isActive ? C.well : opt.accent};
            color: ${isActive ? opt.accent : C.well};
            padding: 1px 7px;
            border-radius: 999px;
            font-size: 10px;
            min-width: 10px;
            text-align: center;
        `;
        chip.appendChild(badge);

        chip.addEventListener('click', () => {
            _state.modifierFilter = opt.id;
            rebuild();
        });

        row.appendChild(chip);
    });

    // Clear link — only visible when filter is non-default
    if (_state.modifierFilter !== 'all') {
        const clear = document.createElement('button');
        clear.type = 'button';
        clear.textContent = '× clear';
        clear.style.cssText = `
            background: transparent;
            border: none;
            color: ${C.textDim};
            font-family: ui-monospace, monospace;
            font-size: 10px;
            letter-spacing: 1px;
            text-transform: uppercase;
            cursor: pointer;
            padding: 4px 8px;
            margin-left: 4px;
        `;
        clear.addEventListener('click', () => {
            _state.modifierFilter = 'all';
            rebuild();
        });
        row.appendChild(clear);
    }

    // First-time mount: append to container. Rebuilds replace via row.replaceWith.
    if (!row.parentNode) container.appendChild(row);
    return row;
}

const renderModifierList = (list) => {
    list.replaceChildren();
    const modifiers = getAllWorking('modifiers');
    const groups = getAllWorking('groups');
    const q = (_state.searchState.modifiers || '').trim().toLowerCase();

    // Search + filter compose via AND. Search first (cheap string match),
    // filter second (needs group-membership lookup for orphans).
    let filtered = q ? modifiers.filter(a => a.name.toLowerCase().includes(q)) : modifiers;
    if (_state.modifierFilter === 'bundled') {
        filtered = filtered.filter(a => (a.included_modifier_ids || []).length > 0);
    } else if (_state.modifierFilter === 'orphan') {
        filtered = filtered.filter(a => !groups.some(g => (g.modifier_ids || []).includes(a.id)));
    }

    if (filtered.length === 0) {
        const empty = document.createElement('div');
        let msg;
        if (modifiers.length === 0) msg = 'No modifiers yet — create one to get started';
        else if (_state.modifierFilter === 'bundled') msg = q ? 'No bundled matches' : 'No bundled modifiers';
        else if (_state.modifierFilter === 'orphan')  msg = q ? 'No orphan matches'  : 'No orphan modifiers — everything is wired up';
        else msg = 'No matches';
        empty.textContent = msg;
        empty.style.cssText = `
            font-family: ui-monospace, monospace;
            font-size: 12px;
            color: ${C.textDim};
            text-align: center;
            padding: 40px 0;
            letter-spacing: 1.5px;
            text-transform: uppercase;
        `;
        list.appendChild(empty);
        return;
    }

    filtered.forEach(modifier => {
        // Count how many groups reference this modifier
        const groupRefs = groups.filter(g => (g.modifier_ids || []).includes(modifier.id));
        const isOrphan = groupRefs.length === 0;
        const microModCount = (modifier.included_modifier_ids || []).length;
        const isBundled = microModCount > 0;

        const row = buildCard(isBundled ? C.lavender : isOrphan ? C.warning : C.green, {
            padding: '12px 16px',
            cssText: 'cursor: pointer; transition: transform 0.08s ease;',
        });
        row.addEventListener('mouseenter', () => { row.style.transform = 'translateX(2px)'; });
        row.addEventListener('mouseleave', () => { row.style.transform = 'translateX(0)'; });
        row.addEventListener('click', () => openModifierModal(modifier));

        const rowInner = document.createElement('div');
        rowInner.style.cssText = `
            display: flex; align-items: center; gap: 14px;
        `;

        // Name + badges
        const nameBlock = document.createElement('div');
        nameBlock.style.cssText = 'flex: 1; min-width: 0;';
        const nameRow = document.createElement('div');
        nameRow.style.cssText = 'display: flex; align-items: center; gap: 8px; margin-bottom: 2px;';
        const name = document.createElement('span');
        name.textContent = modifier.name;
        name.style.cssText = `
            font-family: system-ui, sans-serif;
            font-size: 15px; font-weight: 700;
            color: ${C.text};
        `;
        nameRow.appendChild(name);

        if (isBundled) {
            const bundleBadge = document.createElement('span');
            bundleBadge.textContent = `⋯ ${microModCount} MICROMOD${microModCount === 1 ? '' : 'S'}`;
            bundleBadge.style.cssText = `
                font-family: ui-monospace, monospace;
                font-size: 9px;
                color: ${C.lavender};
                letter-spacing: 1.5px;
                font-weight: 700;
                padding: 2px 6px;
                border: 1px solid ${C.lavender};
                border-radius: 999px;
            `;
            nameRow.appendChild(bundleBadge);
        }

        if (isOrphan) {
            const orphanBadge = document.createElement('span');
            orphanBadge.textContent = '⚠ NO GROUP';
            orphanBadge.style.cssText = `
                font-family: ui-monospace, monospace;
                font-size: 9px;
                color: ${C.warning};
                letter-spacing: 1.5px;
                font-weight: 700;
            `;
            nameRow.appendChild(orphanBadge);
        }
        nameBlock.appendChild(nameRow);

        const subLine = document.createElement('div');
        subLine.style.cssText = `
            font-family: ui-monospace, monospace;
            font-size: 11px;
            color: ${C.textDim};
            letter-spacing: 0.5px;
        `;
        const parts = [];
        if (!isOrphan) {
            parts.push(`in ${groupRefs.length} group${groupRefs.length === 1 ? '' : 's'}`);
        }
        subLine.textContent = parts.join(' · ');
        nameBlock.appendChild(subLine);

        rowInner.appendChild(nameBlock);

        // Price
        const price = document.createElement('div');
        price.textContent = formatPrice(modifier.base_price);
        price.style.cssText = `
            font-family: ui-monospace, monospace;
            font-size: 14px;
            font-weight: 700;
            color: ${C.gold};
            padding-right: 8px;
        `;
        rowInner.appendChild(price);

        row.appendChild(rowInner);
        list.appendChild(row);
    });
}

/* ============================================
   MODIFIER EDIT MODAL (with microMOD picker)
============================================ */

const openModifierModal = (existing) => {
    const isEdit = !!existing;
    openModal(isEdit ? 'Edit Modifier' : 'Add Modifier', (body) => {
        const nameInput = buildModalField(body, 'Name', 'text', existing?.name || '', {
            placeholder: 'e.g. Pepperoni, Meat Lovers…',
        });
        const priceInput = buildModalField(body, 'Base Price', 'number', existing?.base_price ?? '0.00', {
            step: '0.01',
            mono: true,
            hint: 'Price applied when this modifier is added as an ADD. EXTRA doubles it.',
        });

        // microMOD section
        const subSection = document.createElement('div');
        subSection.style.cssText = `
            margin-top: 24px;
            padding-top: 20px;
            border-top: 1px dashed ${C.hairline};
        `;
        const subLabel = buildLabel('microMODs', { color: C.lavender });
        subLabel.style.marginBottom = '4px';
        subSection.appendChild(subLabel);

        const subHint = document.createElement('div');
        subHint.style.cssText = `
            font-family: ui-monospace, monospace;
            font-size: 11px;
            color: ${C.textDim};
            margin-bottom: 10px;
            line-height: 1.5;
        `;
        subHint.textContent = 'microMODs can be attached to modifiers to allow a second layer of modification. Examples include: Chicken → Grilled or Fried, Meat Lovers → No Ham, etc.';
        subSection.appendChild(subHint);

        const microModIds = [...(existing?.included_modifier_ids || [])];
        const trayState = buildChipTray(subSection, microModIds, () => {
            // Source: all modifiers EXCEPT self, and EXCEPT modifiers that are
            // themselves bundled (depth cap at 2: item → modifier → microMOD,
            // no deeper). Schema allows it; UI refuses to render.
            const all = getAllWorking('modifiers');
            return all
                .filter(a => a.id !== existing?.id)
                .map(a => ({
                    id: a.id,
                    name: a.name,
                    extra: formatPrice(a.base_price),
                    _isBundled: (a.included_modifier_ids || []).length > 0,
                }));
        }, {
            accent: C.lavender,
            addLabel: '+ Add microMOD',
            emptyHint: 'No microMODs — tap + Add microMOD',
            pickerTitle: 'Pick microMODs',
            excludeIds: () => {
                // Exclude modifiers that are already bundled themselves
                const all = getAllWorking('modifiers');
                return all
                    .filter(a => (a.included_modifier_ids || []).length > 0 && a.id !== existing?.id)
                    .map(a => a.id);
            },
        });

        body.appendChild(subSection);

        // Footer
        const deleteBtn = isEdit ? buildPillButton('Delete', 'danger', () => {
            showConfirmDialog(
                'Delete modifier?',
                `"${existing.name}" will be removed from ${countGroupRefs(existing.id)} group(s) and any items that include it.`,
                'Delete',
                () => {
                    handleDeleteItem('modifiers', existing.id);
                    closeModal();
                    renderModifierList(document.querySelector('#configure-modifiers-content > div:last-child'));
                }
            );
        }, { small: true }) : null;

        buildModalFooter(body, () => {
            const name = nameInput.value.trim();
            if (!name) {
                nameInput.style.borderColor = C.verm;
                showToast('Name is required', 'error');
                return;
            }
            const item = {
                id: existing?.id || `mod_${Date.now()}`,
                name,
                base_price: parseFloat(priceInput.value) || 0,
                included_modifier_ids: trayState.ids.slice(),
            };
            trackChange('modifiers', item);
            closeModal();
            buildMainView(_state.currentWrapper);
        }, {
            saveLabel: isEdit ? 'Save' : 'Create',
            extraLeft: deleteBtn,
        });
    }, { accent: C.green, wide: false });
}

const countGroupRefs = (atomId) => getAllWorking('groups').filter(g => (g.modifier_ids || []).includes(atomId)).length;
;

const openOverrideModal = (modifier, driverAtoms, existingOverrides, onSave) => {
    openModal(`Price Overrides: ${modifier.name}`, (body) => {
        const hint = document.createElement('div');
        hint.style.cssText = `font-size: 12px; color: ${C.textDim}; margin-bottom: 20px;`;
        hint.textContent = `Base Price: ${formatPrice(modifier.base_price)}`;
        body.appendChild(hint);

        const inputs = {};
        driverAtoms.forEach(driver => {
            const row = document.createElement('div');
            row.style.cssText = 'margin-bottom: 12px;';
            const label = buildLabel(`${driver.groupName}: ${driver.name}`, { color: C.text });
            label.style.marginBottom = '4px';
            row.appendChild(label);

            const input = buildTextInput(existingOverrides[driver.id] || '', {
                placeholder: 'Use base price',
                type: 'number', step: '0.01', mono: true
            });
            row.appendChild(input);
            body.appendChild(row);
            inputs[driver.id] = input;
        });

        buildModalFooter(body, () => {
            const result = {};
            Object.keys(inputs).forEach(id => {
                const val = parseFloat(inputs[id].value);
                if (!isNaN(val)) result[id] = val;
            });
            onSave(result);
            closeModal();
        }, {
            saveLabel: 'Apply Overrides'
        });
    }, { accent: C.gold, wide: false });
}

/* ============================================
   GROUPS TAB
============================================ */

const buildGroupsTab = (container) => {
    container.replaceChildren();

    const headerRow = document.createElement('div');
    headerRow.style.cssText = `
        display: flex; align-items: center; justify-content: space-between;
        margin-bottom: 14px;
    `;
    const leftBlock = document.createElement('div');
    const heading = document.createElement('div');
    heading.textContent = 'Groups';
    heading.style.cssText = `
        font-family: system-ui, sans-serif;
        font-size: 16px; font-weight: 700;
        color: ${C.text}; margin-bottom: 2px;
    `;
    const sub = buildLabel('Collections of modifiers with min/max/pricing rules', { color: C.textDim });
    leftBlock.appendChild(heading);
    leftBlock.appendChild(sub);
    headerRow.appendChild(leftBlock);

    const addBtn = buildPillButton('+ Add Group', 'primary', () => openGroupModal(null), { small: true });
    headerRow.appendChild(addBtn);
    container.appendChild(headerRow);

    buildSearchBar(container, 'groups', () => renderGroupList(list));

    const list = document.createElement('div');
    list.style.cssText = `display: flex; flex-direction: column; gap: 8px;`;
    container.appendChild(list);

    renderGroupList(list);
}

const renderGroupList = (list) => {
    list.replaceChildren();
    const groups = getAllWorking('groups');
    const modifiers = getAllWorking('modifiers');
    const q = (_state.searchState.groups || '').trim().toLowerCase();
    const filtered = q ? groups.filter(g => g.name.toLowerCase().includes(q)) : groups;

    if (filtered.length === 0) {
        const empty = document.createElement('div');
        empty.textContent = groups.length === 0
            ? 'No groups yet — create one to get started'
            : 'No matches';
        empty.style.cssText = `
            font-family: ui-monospace, monospace;
            font-size: 12px;
            color: ${C.textDim};
            text-align: center;
            padding: 40px 0;
            letter-spacing: 1.5px;
            text-transform: uppercase;
        `;
        list.appendChild(empty);
        return;
    }

    filtered.forEach(group => {
        const min = group.min_selections ?? 0;
        const max = group.max_selections ?? 1;
        const isMandatoryWireable = min >= 1;
        const isUniversalWireable = min === 0;
        const accent = isMandatoryWireable ? C.gold : C.cyan;

        const row = buildCard(accent, {
            padding: '14px 18px',
            cssText: 'cursor: pointer; transition: transform 0.08s ease;',
        });
        row.addEventListener('mouseenter', () => { row.style.transform = 'translateX(2px)'; });
        row.addEventListener('mouseleave', () => { row.style.transform = 'translateX(0)'; });
        row.addEventListener('click', () => openGroupModal(group));

        const topRow = document.createElement('div');
        topRow.style.cssText = `
            display: flex; align-items: center; gap: 10px;
            margin-bottom: 6px;
        `;

        const name = document.createElement('span');
        name.textContent = group.name || '(unnamed group)';
        name.style.cssText = `
            font-family: system-ui, sans-serif;
            font-size: 16px; font-weight: 700;
            color: ${C.text}; flex: 1;
        `;
        topRow.appendChild(name);

        // Count pill
        const countBadge = document.createElement('span');
        countBadge.textContent = `${(group.modifier_ids || []).length} MODIFIERS`;
        countBadge.style.cssText = `
            font-family: ui-monospace, monospace;
            font-size: 10px;
            letter-spacing: 1.5px;
            font-weight: 700;
            color: ${C.textMuted};
        `;
        topRow.appendChild(countBadge);

        row.appendChild(topRow);

        // Badge row
        const badgeRow = document.createElement('div');
        badgeRow.style.cssText = `
            display: flex; flex-wrap: wrap; gap: 6px;
        `;

        // Wire type badge
        const wireBadge = document.createElement('span');
        wireBadge.textContent = isMandatoryWireable ? 'MANDATORY-WIREABLE' : 'UNIVERSAL-WIREABLE';
        wireBadge.style.cssText = `
            font-family: ui-monospace, monospace;
            font-size: 9px;
            letter-spacing: 1.5px;
            font-weight: 700;
            color: ${isMandatoryWireable ? C.gold : C.cyan};
            padding: 2px 8px;
            border: 1px solid ${isMandatoryWireable ? C.gold : C.cyan};
            border-radius: 999px;
        `;
        badgeRow.appendChild(wireBadge);

        // Selection shape badge
        const selBadge = document.createElement('span');
        const selText = max === 1
            ? (min === 0 ? 'PICK 0 OR 1' : 'PICK 1')
            : (min === max ? `PICK ${min}` : `PICK ${min}–${max}`);
        selBadge.textContent = selText;
        selBadge.style.cssText = `
            font-family: ui-monospace, monospace;
            font-size: 9px;
            letter-spacing: 1.5px;
            font-weight: 700;
            color: ${C.textMuted};
            padding: 2px 8px;
            border: 1px solid ${C.hairline};
            border-radius: 999px;
        `;
        badgeRow.appendChild(selBadge);

        if (group.drives_pricing) {
            const priceBadge = document.createElement('span');
            priceBadge.textContent = '💲 DRIVES PRICING';
            priceBadge.style.cssText = `
                font-family: ui-monospace, monospace;
                font-size: 9px;
                letter-spacing: 1.5px;
                font-weight: 700;
                color: ${C.gold};
                padding: 2px 8px;
                border: 1px solid ${C.gold};
                border-radius: 999px;
            `;
            badgeRow.appendChild(priceBadge);
        }

        row.appendChild(badgeRow);
        list.appendChild(row);
    });
}

/* ============================================
   GROUP EDIT MODAL
   Carries the new-model fields: min_selections,
   max_selections, drives_pricing. Validation
   enforces: drives_pricing requires max=1.
============================================ */

const openGroupModal = (existing) => {
    const isEdit = !!existing;

    openModal(isEdit ? 'Edit Group' : 'Add Group', (body) => {
        // Draft copy — mutations only commit on Save
        const draft = {
            id: existing?.id || `grp_${Date.now()}`,
            name: existing?.name || '',
            modifier_ids: [...(existing?.modifier_ids || [])],
            min_selections: existing?.min_selections ?? 0,
            max_selections: existing?.max_selections ?? 1,
            drives_pricing: !!existing?.drives_pricing,
            price_by_option_map: clone(existing?.price_by_option_map || {}),
            color: existing?.color || null,
            category_id: existing?.category_id || null,
        };

        const nameInput = buildModalField(body, 'Group Name', 'text', draft.name, {
            placeholder: 'e.g. Pizza Toppings, Cheese Options…',
        });

        // Modifiers in this group — chip tray picker
        const atomSection = document.createElement('div');
        atomSection.style.cssText = 'margin-bottom: 20px;';
        const atomLabel = buildLabel('Modifiers in This Group', { color: C.green });
        atomLabel.style.marginBottom = '6px';
        atomSection.appendChild(atomLabel);

        const atomTray = buildChipTray(atomSection, draft.modifier_ids, () => {
            return getAllWorking('modifiers').map(a => ({
                id: a.id,
                name: a.name,
                extra: formatPrice(a.base_price),
            }));
        }, {
            accent: C.green,
            addLabel: '+ Add Modifiers',
            emptyHint: 'No modifiers — tap + Add Modifiers',
            pickerTitle: 'Pick modifiers for this group',
            onChange: (ids) => {
                draft.modifier_ids = ids;
                renderSelectionHint();
            },
        });
        body.appendChild(atomSection);

        // Selection rules section
        const rulesSection = document.createElement('div');
        rulesSection.style.cssText = `
            margin-top: 20px;
            padding-top: 16px;
            border-top: 1px dashed ${C.hairline};
        `;
        const rulesLabel = buildLabel('Selection Rules', { color: C.gold });
        rulesLabel.style.marginBottom = '10px';
        rulesSection.appendChild(rulesLabel);

        // Min / Max row
        const minMaxRow = document.createElement('div');
        minMaxRow.style.cssText = `
            display: grid; grid-template-columns: 1fr 1fr; gap: 14px;
            margin-bottom: 14px;
        `;

        const minWrap = document.createElement('div');
        const minSubLabel = buildLabel('Min selections', { color: C.textMuted });
        minSubLabel.style.marginBottom = '4px';
        minWrap.appendChild(minSubLabel);
        const minInput = buildTextInput(String(draft.min_selections), {
            type: 'number', min: 0, step: '1', mono: true,
        });
        minWrap.appendChild(minInput);
        minMaxRow.appendChild(minWrap);

        const maxWrap = document.createElement('div');
        const maxSubLabel = buildLabel('Max selections', { color: C.textMuted });
        maxSubLabel.style.marginBottom = '4px';
        maxWrap.appendChild(maxSubLabel);
        const maxInput = buildTextInput(String(draft.max_selections), {
            type: 'number', min: 1, step: '1', mono: true,
        });
        maxWrap.appendChild(maxInput);
        minMaxRow.appendChild(maxWrap);

        rulesSection.appendChild(minMaxRow);

        // Drives pricing toggle row
        const drivesRow = document.createElement('div');
        drivesRow.style.cssText = `
            display: flex; align-items: center; gap: 14px;
            padding: 12px 14px;
            background: ${C.well};
            border-radius: 8px;
            margin-bottom: 10px;
        `;
        const drivesLabel = document.createElement('div');
        drivesLabel.style.cssText = 'flex: 1;';
        const drivesName = document.createElement('div');
        drivesName.textContent = 'Drives Pricing';
        drivesName.style.cssText = `
            font-family: system-ui, sans-serif;
            font-size: 14px;
            font-weight: 700;
            color: ${C.text};
            margin-bottom: 2px;
        `;
        drivesLabel.appendChild(drivesName);
        const drivesHint = document.createElement('div');
        drivesHint.style.cssText = `
            font-family: ui-monospace, monospace;
            font-size: 11px;
            color: ${C.textDim};
            line-height: 1.4;
        `;
        drivesHint.textContent = 'The selected modifier sets pricing for optional modifiers (pizza size → topping prices).';
        drivesLabel.appendChild(drivesHint);
        drivesRow.appendChild(drivesLabel);

        const drivesToggle = buildToggle(draft.drives_pricing, (v) => {
            draft.drives_pricing = v;
            renderSelectionHint();
        });
        drivesRow.appendChild(drivesToggle);
        rulesSection.appendChild(drivesRow);

        // Live hint — describes what this group does based on current values
        const hintBox = document.createElement('div');
        hintBox.style.cssText = `
            padding: 10px 14px;
            background: ${C.well};
            border-radius: 6px;
            border-left: 3px solid ${C.cyan};
            font-family: ui-monospace, monospace;
            font-size: 11px;
            line-height: 1.6;
            color: ${C.textMuted};
        `;
        rulesSection.appendChild(hintBox);

        function renderSelectionHint() {
            const min = parseInt(minInput.value, 10) || 0;
            const max = parseInt(maxInput.value, 10) || 1;
            const modifierCount = draft.modifier_ids.length;

            hintBox.replaceChildren();

            function addLine(bullet, bulletColor, text) {
                const div = document.createElement('div');
                const s = document.createElement('span');
                s.textContent = bullet;
                s.style.color = bulletColor;
                div.appendChild(s);
                div.appendChild(document.createTextNode(' ' + text));
                hintBox.appendChild(div);
            }

            // Wire type
            if (min >= 1) {
                addLine('■', C.gold, 'MANDATORY-WIREABLE — wire to items via their edit modal');
            } else {
                addLine('■', C.cyan, 'UNIVERSAL-WIREABLE — wire to categories via their edit modal');
            }

            // Selection shape
            if (max === 1) {
                addLine('◆', C.text, 'Single-select: panel auto-dismisses on pick');
            } else {
                addLine('◆', C.text, `Multi-select: checklist with DONE, picks 0 or more up to ${max}`);
            }

            // Drives pricing
            const issues = [];
            if (draft.drives_pricing) {
                if (max === 1) {
                    addLine('💲', C.gold, 'Drives pricing on optional modifiers');
                } else {
                    issues.push(`drives_pricing requires max = 1 (can't price off a multi-select)`);
                }
            }

            // Validation issues
            if (modifierCount === 0) issues.push('no modifiers wired yet');
            if (max < min) issues.push(`max (${max}) must be ≥ min (${min})`);
            if (max > modifierCount && modifierCount > 0) issues.push(`max (${max}) exceeds modifier count (${modifierCount})`);
            if (min > modifierCount) issues.push(`min (${min}) exceeds modifier count (${modifierCount})`);

            if (issues.length > 0) {
                const issueDiv = document.createElement('div');
                issueDiv.style.cssText = `margin-top: 8px; color: ${C.warning};`;
                const strong = document.createElement('strong');
                strong.textContent = `⚠ ${issues.join(' · ')}`;
                issueDiv.appendChild(strong);
                hintBox.appendChild(issueDiv);
            }

            // Update drives_pricing toggle availability
            if (max > 1 && drivesToggle.getValue()) {
                drivesToggle.setValue(false);
                draft.drives_pricing = false;
            }
            drivesToggle.setDisabled(max > 1);
        }

        minInput.addEventListener('input', () => {
            draft.min_selections = parseInt(minInput.value, 10) || 0;
            renderSelectionHint();
        });
        maxInput.addEventListener('input', () => {
            draft.max_selections = parseInt(maxInput.value, 10) || 1;
            renderSelectionHint();
        });
        renderSelectionHint();

        body.appendChild(rulesSection);

        // Pricing Overrides section
        const overrideSection = document.createElement('div');
        overrideSection.style.cssText = `
            margin-top: 24px;
            padding-top: 20px;
            border-top: 1px dashed ${C.hairline};
        `;

        function updateOverridesUI() {
            overrideSection.replaceChildren();
            if (draft.drives_pricing) return; // Drivers don't have overrides themselves

            const pricingDrivers = getAllWorking('groups').filter(g => g.drives_pricing);
            if (pricingDrivers.length === 0) return;

            const lbl = buildLabel('Pricing Overrides', { color: C.gold });
            lbl.style.marginBottom = '10px';
            overrideSection.appendChild(lbl);

            const hint = document.createElement('div');
            hint.style.cssText = `font-size: 11px; color: ${C.textDim}; margin-bottom: 15px; line-height: 1.4;`;
            hint.textContent = 'Set price overrides for modifiers in this group based on selections in "Drives Pricing" groups (e.g. Pizza Size). Modifiers without overrides use their Base Price.';
            overrideSection.appendChild(hint);

            const table = document.createElement('div');
            table.style.cssText = 'display: flex; flex-direction: column; gap: 8px;';

            const allModifiers = getAllWorking('modifiers');
            const driverAtoms = [];
            pricingDrivers.forEach(dg => {
                (dg.modifier_ids || []).forEach(mid => {
                    const a = allModifiers.find(x => x.id === mid);
                    if (a) driverAtoms.push({ id: mid, name: a.name, groupName: dg.name });
                });
            });

            draft.modifier_ids.forEach(mid => {
                const modifier = allModifiers.find(a => a.id === mid);
                if (!modifier) return;

                const row = document.createElement('div');
                row.style.cssText = `
                    background: ${C.well}; padding: 10px 14px; border-radius: 8px;
                    display: flex; align-items: center; justify-content: space-between;
                `;
                const name = document.createElement('div');
                name.textContent = modifier.name;
                name.style.cssText = 'font-weight: 600; font-size: 13px; color: #fff;';
                row.appendChild(name);

                const btn = buildPillButton('Set Overrides', 'secondary', () => {
                    openOverrideModal(modifier, driverAtoms, draft.price_by_option_map[mid] || {}, (newOverrides) => {
                        if (Object.keys(newOverrides).length === 0) {
                            delete draft.price_by_option_map[mid];
                        } else {
                            draft.price_by_option_map[mid] = newOverrides;
                        }
                        updateOverridesUI();
                    });
                }, { small: true });

                const count = Object.keys(draft.price_by_option_map[mid] || {}).length;
                if (count > 0) {
                    btn.textContent = `${count} Overrides`;
                    btn.style.borderColor = C.gold;
                    btn.style.color = C.gold;
                }

                row.appendChild(btn);
                table.appendChild(row);
            });
            overrideSection.appendChild(table);
        }

        body.appendChild(overrideSection);
        updateOverridesUI();

        // Footer
        const deleteBtn = isEdit ? buildPillButton('Delete', 'danger', () => {
            showConfirmDialog(
                'Delete group?',
                `"${existing.name}" will be deleted. Any items/categories wired to it lose that wiring.`,
                'Delete',
                () => {
                    handleDeleteItem('groups', existing.id);
                    closeModal();
                    buildMainView(_state.currentWrapper);
                }
            );
        }, { small: true }) : null;

        buildModalFooter(body, () => {
            const name = nameInput.value.trim();
            if (!name) {
                nameInput.style.borderColor = C.verm;
                showToast('Name is required', 'error');
                return;
            }
            const min = parseInt(minInput.value, 10) || 0;
            const max = parseInt(maxInput.value, 10) || 1;
            if (max < min) {
                showToast('Max must be ≥ min', 'error');
                return;
            }
            if (draft.drives_pricing && max !== 1) {
                showToast('drives_pricing requires max = 1', 'error');
                return;
            }
            if (!_guardMandatoryHasModifiers(min, draft.modifier_ids, name, atomSection)) return;

            draft.name = name;
            draft.min_selections = min;
            draft.max_selections = max;

            trackChange('groups', draft);
            closeModal();
            buildMainView(_state.currentWrapper);
        }, {
            saveLabel: isEdit ? 'Save' : 'Create',
            extraLeft: deleteBtn,
        });
    }, { accent: C.gold, wide: true });
}

/* ============================================
   FOOTER + SAVE
============================================ */

const buildFooter = (wrapper) => {
    const existing = wrapper.querySelector('#configure-modifiers-footer');
    if (existing) existing.remove();

    const footer = document.createElement('div');
    footer.id = 'configure-modifiers-footer';
    footer.style.cssText = `
        position: sticky;
        bottom: 0;
        background: ${C.bg};
        border-top: 1px solid ${C.hairline};
        padding: 14px 0;
        margin-top: 24px;
        display: flex; align-items: center; justify-content: space-between;
        z-index: 10;
    `;

    const count = document.createElement('div');
    count.id = 'configure-modifiers-pending-count';
    count.style.cssText = `
        font-family: ui-monospace, monospace;
        font-size: 12px;
        letter-spacing: 1.5px;
        text-transform: uppercase;
        font-weight: 700;
        color: ${C.textMuted};
    `;
    footer.appendChild(count);

    const btnRow = document.createElement('div');
    btnRow.style.cssText = 'display: flex; gap: 10px;';
    btnRow.appendChild(buildPillButton('Discard', 'tertiary', () => {
        if (getPendingCount() === 0) return;
        showConfirmDialog(
            'Discard pending changes?',
            `${getPendingCount()} change(s) will be lost.`,
            'Discard',
            () => {
                _state.pendingChanges = { modifiers: [], groups: [] };
                buildMainView(_state.currentWrapper);
            }
        );
    }, { small: true }));

    const saveBtn = buildPillButton('Save Changes', 'confirm', () => _handleSaveChanges(_getSaveCtx()), { small: true });
    saveBtn.id = 'configure-modifiers-save-btn';
    btnRow.appendChild(saveBtn);

    footer.appendChild(btnRow);
    wrapper.appendChild(footer);

    updateFooter();
}

const updateFooter = () => {
    const count = document.getElementById('configure-modifiers-pending-count');
    const btn = document.getElementById('configure-modifiers-save-btn');
    const n = getPendingCount();
    if (count) {
        count.textContent = n === 0 ? 'No pending changes' : `${n} pending change${n === 1 ? '' : 's'}`;
        count.style.color = n === 0 ? C.textMuted : C.greenUp;
    }
    if (btn) {
        btn.style.opacity = n === 0 ? '0.4' : '1';
        btn.style.pointerEvents = n === 0 ? 'none' : 'auto';
    }
}

/* ------------------------------------------
   SAVE CONTEXT BUILDER
   Assembles the ctx object that handleSaveChanges (in
   modifier-data.js) needs to read/write scene state.
------------------------------------------ */
const _getSaveCtx = () => {
    return {
        pendingChanges: _state.pendingChanges,
        modData: _state.modData,
        setPendingChanges: (v) => { _state.pendingChanges = v; },
        getAllWorking,
        getPendingCount,
        clone,
        showToast,
        buildMainView,
        currentWrapper: _state.currentWrapper,
    };
}

/* ============================================
   SCENE REGISTRATION
============================================ */

export function registerConfigureModifiers(sceneManager) {
    sceneManager.register('modifier-groups', {
        type: 'detail',
        title: 'Modifiers & microMODs',
        parent: 'menu-subs',
        async onEnter(container) {
            console.log('[ConfigureModifiers] Scene loaded — initializing...');

            _state.modData = await fetchModifierData();
            _state.pendingChanges = { modifiers: [], groups: [] };
            _state.activeTab = 'modifiers';
            _state.searchState = { modifiers: '', groups: '' };
            _state.modifierFilter = 'all';

            _state.currentWrapper = document.createElement('div');
            _state.currentWrapper.style.cssText = `
                max-width: 1100px;
                margin: 0 auto;
                padding: 24px 20px 40px 20px;
                background: ${C.bg};
                min-height: 100%;
            `;
            container.appendChild(_state.currentWrapper);

            buildMainView(_state.currentWrapper);

            console.log(`[ConfigureModifiers] Loaded ${_state.modData.modifiers.length} modifiers, ${_state.modData.groups.length} groups.`);
            console.log('[ConfigureModifiers] Ready.');
        },
        onExit(container) {
            _state.currentWrapper = null;
            _state.modData = null;
            _state.pendingChanges = { modifiers: [], groups: [] };
            if (container) container.replaceChildren();
            closeAllModals();
        },
    });
}