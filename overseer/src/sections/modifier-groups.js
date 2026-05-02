/* ============================================
   KINDpos Overseer — Modifiers (Two-panel rebuild)

   Replaces the old single-pane Configure Modifiers
   screen. Layout:
     LEFT 214px  — group list, "+ New Group"
     RIGHT flex  — group detail (top bar + chip row)
                   then a modifier-detail card with
                   size-pricing grid + microMODs.

   Endpoint surface used here:
     GET  /api/v1/config/modifier-groups
     GET  /api/v1/option-groups
     GET  /api/v1/options
     GET  /api/v1/sizes
     GET  /api/v1/config/micromods
     GET  /api/v1/config/menu/items
     POST /api/v1/modifier-groups/{id}/option-group
     PATCH /api/v1/modifier-groups/{id}            (drives_pricing)
     PATCH /api/v1/modifiers/{id}                  (active / base price)
     PUT  /api/v1/modifiers/{id}/size-pricing/{group_id}

   All visual values flow from common/tokens.js.
   ============================================ */

import { T } from '../../../common/tokens.js';
import {
    buildStaticCard,
    hexToRgba,
    darkenHex,
} from '../../../common/theme.js';

/* ------------------------------------------
   STATE
------------------------------------------ */
const _state = {
    container: null,
    wrapper: null,

    groups: [],
    optionGroups: [],
    options: [],
    sizes: [],
    micromods: [],
    items: [],

    selectedGroupId: null,
    selectedModifierId: null,
    showAddGroup: false,
};

/* ------------------------------------------
   FORMATTERS
------------------------------------------ */
function fmtPrice(n) { return '$' + Number(n || 0).toFixed(2); }
function fmtPriceAdj(n) {
    const v = Number(n || 0);
    if (v > 0) return '+ ' + fmtPrice(v);
    if (v < 0) return '− ' + fmtPrice(Math.abs(v));
    return fmtPrice(0);
}

/* ------------------------------------------
   API
------------------------------------------ */
async function apiGet(url) {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`GET ${url} → ${res.status}`);
    return res.json();
}

async function apiPost(url, body) {
    const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: body == null ? undefined : JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`POST ${url} → ${res.status}`);
    return res.json();
}

async function apiPatch(url, body) {
    const res = await fetch(url, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`PATCH ${url} → ${res.status}`);
    return res.json();
}

async function apiPut(url, body) {
    const res = await fetch(url, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`PUT ${url} → ${res.status}`);
    return res.json();
}

async function apiGetOptional(url, fallback) {
    try { return await apiGet(url); }
    catch (e) { console.warn(`[Modifiers] ${url} unavailable:`, e.message); return fallback; }
}

/* ------------------------------------------
   TOAST
------------------------------------------ */
function showToast(msg, kind = 'ok') {
    const toast = document.createElement('div');
    const bg = kind === 'error' ? T.verm : T.greenWarm;
    toast.textContent = msg;
    toast.style.cssText = `
        position: fixed; top: 24px; right: 24px;
        padding: 12px 20px;
        background: ${bg};
        color: ${T.well};
        font-family: ${T.fb};
        font-size: ${T.fsB3};
        font-weight: ${T.fwBold};
        border-radius: 999px;
        z-index: 10000;
        box-shadow: 0 6px 20px rgba(0,0,0,0.4);
        transition: opacity 0.3s ease, transform 0.3s ease;
    `;
    document.body.appendChild(toast);
    setTimeout(() => {
        toast.style.opacity = '0';
        toast.style.transform = 'translateY(-10px)';
        setTimeout(() => toast.remove(), 300);
    }, 2500);
}

/* ------------------------------------------
   PRIMITIVES
------------------------------------------ */
function buildToggle(initial, onChange) {
    let state = !!initial;
    const wrap = document.createElement('button');
    wrap.type = 'button';

    function applyState() {
        wrap.style.cssText = `
            width: 38px; height: 22px;
            border-radius: 999px;
            background: ${state ? T.greenWarm : T.well};
            border: 1px solid ${state ? T.greenWarm : hexToRgba(T.border, 0.5)};
            position: relative;
            cursor: pointer;
            outline: none;
            transition: background 0.15s ease;
            flex: 0 0 auto;
        `;
        wrap.replaceChildren();
        const knob = document.createElement('span');
        knob.style.cssText = `
            position: absolute;
            top: 2px;
            left: ${state ? '18px' : '2px'};
            width: 16px; height: 16px;
            border-radius: 50%;
            background: ${state ? T.well : T.moon};
            transition: left 0.15s ease, background 0.15s ease;
        `;
        wrap.appendChild(knob);
    }

    wrap.getValue = () => state;
    wrap.setValue = (v) => { state = !!v; applyState(); };
    wrap.addEventListener('click', (e) => {
        e.stopPropagation();
        state = !state;
        applyState();
        if (onChange) onChange(state);
    });
    applyState();
    return wrap;
}

function buildPillButton(label, variant, onClick, opts = {}) {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = label;
    const variants = {
        elec:    { bg: T.elec,     fg: T.well, shadow: hexToRgba(T.elec, 0.45),     border: 'none' },
        confirm: { bg: T.greenWarm,fg: T.well, shadow: hexToRgba(T.greenWarm, 0.45),border: 'none' },
        ghost:   { bg: 'transparent', fg: T.elec, shadow: 'transparent',            border: `1px solid ${T.elec}` },
        ghostMoon: { bg: 'transparent', fg: T.moon, shadow: 'transparent',          border: `1px solid ${hexToRgba(T.moon, 0.5)}` },
        tertiary:{ bg: 'transparent', fg: T.moon, shadow: 'transparent',            border: 'none' },
    };
    const v = variants[variant] || variants.elec;

    b.style.cssText = `
        display: inline-flex; align-items: center; justify-content: center;
        padding: ${opts.small ? '5px 12px' : '8px 16px'};
        background: ${v.bg};
        color: ${v.fg};
        border: ${v.border};
        border-radius: 999px;
        font-family: ${T.fb};
        font-size: ${opts.small ? T.fsB4 : T.fsB3};
        font-weight: ${T.fwBold};
        letter-spacing: 0.04em;
        cursor: pointer;
        outline: none;
        box-shadow: ${v.shadow === 'transparent' ? 'none' : `0 3px 0 ${v.shadow}`};
        transition: transform 0.08s ease, box-shadow 0.08s ease;
        white-space: nowrap;
        ${opts.fullWidth ? 'width: 100%;' : ''}
    `;
    b.addEventListener('mousedown', () => {
        b.style.transform = 'translateY(2px)';
        if (v.shadow !== 'transparent') b.style.boxShadow = `0 1px 0 ${v.shadow}`;
    });
    const reset = () => {
        b.style.transform = 'translateY(0)';
        if (v.shadow !== 'transparent') b.style.boxShadow = `0 3px 0 ${v.shadow}`;
    };
    b.addEventListener('mouseup', reset);
    b.addEventListener('mouseleave', reset);
    if (onClick) b.addEventListener('click', onClick);
    return b;
}

function buildBadge(text, color) {
    const el = document.createElement('span');
    el.textContent = text;
    el.style.cssText = `
        display: inline-flex; align-items: center;
        padding: 2px 8px;
        background: ${hexToRgba(color, 0.16)};
        color: ${color};
        border-radius: 999px;
        font-family: ${T.fb};
        font-size: 9px;
        font-weight: ${T.fwBold};
        letter-spacing: 0.18em;
        text-transform: uppercase;
    `;
    return el;
}

function buildMoonBadge(text) {
    const el = document.createElement('span');
    el.textContent = text;
    el.style.cssText = `
        display: inline-flex; align-items: center;
        padding: 3px 10px;
        background: ${T.moon};
        color: ${T.moonText};
        border-radius: 999px;
        font-family: ${T.fb};
        font-size: ${T.fsB4};
        font-weight: ${T.fwBold};
        letter-spacing: 0.06em;
    `;
    return el;
}

function buildSelectMock(value, onChange, options) {
    const wrap = document.createElement('div');
    wrap.style.cssText = 'position: relative; display: inline-block;';

    const sel = document.createElement('select');
    sel.value = value || '';
    sel.style.cssText = `
        appearance: none;
        -webkit-appearance: none;
        -moz-appearance: none;
        background: ${T.well};
        border: 1px solid ${hexToRgba(T.border, 0.5)};
        border-radius: ${T.chamferBtn}px;
        color: ${T.elec};
        font-family: ${T.fb};
        font-size: ${T.fsB4};
        font-weight: ${T.fwBold};
        padding: 6px 28px 6px 12px;
        cursor: pointer;
        outline: none;
    `;
    options.forEach(opt => {
        const o = document.createElement('option');
        o.value = opt.value;
        o.textContent = opt.label;
        if (opt.value === value) o.selected = true;
        sel.appendChild(o);
    });
    sel.addEventListener('change', () => onChange(sel.value));
    wrap.appendChild(sel);

    const caret = document.createElement('span');
    caret.textContent = '▾';
    caret.style.cssText = `
        position: absolute; right: 10px; top: 50%;
        transform: translateY(-50%);
        color: ${T.elec};
        font-size: ${T.fsB4};
        pointer-events: none;
    `;
    wrap.appendChild(caret);

    return wrap;
}

function buildPriceInput(value, opts = {}) {
    const input = document.createElement('input');
    input.type = 'number';
    input.step = '0.01';
    input.value = (value == null) ? '' : Number(value).toFixed(2);
    input.style.cssText = `
        width: ${opts.width || '76px'};
        padding: 6px 10px;
        background: ${T.well};
        border: 1px solid ${T.gold};
        border-radius: ${T.chamferBtn}px;
        color: ${T.gold};
        font-family: ${T.fb};
        font-size: ${T.fsB3};
        font-weight: ${T.fwBold};
        text-align: right;
        outline: none;
        box-sizing: border-box;
    `;
    return input;
}

/* ============================================
   LEFT PANEL — group list
============================================ */

function buildLeftPanel() {
    const leftCard = buildStaticCard({ accent: T.green });
    leftCard.style.width = '680px';
    leftCard.style.flexShrink = '0';
    leftCard.style.alignSelf = 'stretch';
    leftCard.style.minHeight = '0';
    leftCard.style.padding = '0';
    leftCard.style.overflow = 'hidden';
    leftCard.style.display = 'flex';
    leftCard.style.flexDirection = 'column';

    const leftContent = document.createElement('div');
    leftContent.className = 'kindpos-scrollbar-hide';
    leftContent.style.cssText = 'flex: 1; min-height: 0; overflow-y: auto; scrollbar-width: none; -ms-overflow-style: none; padding: 12px 12px 12px 20px; box-sizing: border-box;';
    leftCard.appendChild(leftContent);

    const sectionLabel = document.createElement('div');
    sectionLabel.textContent = 'Modifier Groups';
    sectionLabel.style.cssText = `
        font-family: ${T.fb};
        font-size: 8px;
        font-weight: 700;
        color: ${T.moonDk};
        letter-spacing: 2.5px;
        text-transform: uppercase;
        margin-bottom: 8px;
    `;
    leftContent.appendChild(sectionLabel);

    const newBtn = document.createElement('button');
    newBtn.type = 'button';
    newBtn.textContent = '+ New Group';
    newBtn.style.cssText = `
        display: block;
        width: 100%;
        height: 28px;
        background: ${T.elec};
        color: ${T.well};
        border: none;
        border-radius: 8px;
        font-family: ${T.fb};
        font-size: 9px;
        font-weight: 700;
        text-transform: uppercase;
        letter-spacing: 0.06em;
        cursor: pointer;
        margin-bottom: 8px;
        box-shadow: 0 3px 0 ${T.elecDk};
        box-sizing: border-box;
    `;
    newBtn.addEventListener('click', () => {
        _state.showAddGroup = true;
        rebuild();
    });
    leftContent.appendChild(newBtn);

    if (_state.showAddGroup) leftContent.appendChild(buildAddGroupForm());

    const list = document.createElement('div');
    list.style.cssText = 'display: flex; flex-direction: column;';

    if (_state.groups.length === 0) {
        const empty = document.createElement('div');
        empty.textContent = 'No groups yet';
        empty.style.cssText = `
            padding: 18px 8px;
            text-align: center;
            font-family: ${T.fb};
            font-size: ${T.fsB4};
            color: ${T.moon};
        `;
        list.appendChild(empty);
    } else {
        _state.groups.forEach(g => list.appendChild(buildGroupListItem(g)));
    }

    leftContent.appendChild(list);
    return leftCard;
}

function buildGroupListItem(group) {
    const isSelected = _state.selectedGroupId === group.group_id;
    const isDriver = !!group.drives_pricing;

    const item = document.createElement('div');
    item.style.cssText = `
        padding: 9px 10px;
        border-radius: 7px;
        margin: 1px 4px;
        background: ${isSelected ? hexToRgba(T.green, 0.10) : 'transparent'};
        cursor: pointer;
        transition: background 0.1s ease;
    `;
    if (!isSelected) {
        item.addEventListener('mouseenter', () => {
            item.style.background = hexToRgba(T.green, 0.05);
        });
        item.addEventListener('mouseleave', () => {
            item.style.background = 'transparent';
        });
    }

    const name = document.createElement('div');
    name.textContent = group.name || group.group_id;
    name.style.cssText = `
        font-family: ${T.fb};
        font-size: 11px;
        font-weight: 600;
        color: ${isSelected ? T.green : (isDriver ? T.gold : T.moon)};
        margin-bottom: 2px;
    `;
    item.appendChild(name);

    const meta = document.createElement('div');
    const min = group.min_selections ?? 0;
    const modCount = (group.modifiers || []).length;
    const wireType = min >= 1 ? 'Mandatory' : 'Optional';
    const ogName = optionGroupName(group.default_option_group_id);

    const metaParts = [`${modCount} modifiers · ${wireType}`];
    if (ogName) metaParts.push(ogName);

    meta.style.cssText = `
        font-family: ${T.fb};
        font-size: 9px;
        color: ${T.moonDk};
        letter-spacing: 0.04em;
        line-height: 1.4;
        margin-top: 1px;
    `;

    if (isDriver) {
        meta.appendChild(document.createTextNode(metaParts.join(' · ') + ' · '));
        const pricingSpan = document.createElement('span');
        pricingSpan.textContent = 'Drives pricing';
        pricingSpan.style.color = T.gold;
        meta.appendChild(pricingSpan);
    } else {
        meta.textContent = metaParts.join(' · ');
    }

    item.appendChild(meta);

    item.addEventListener('click', () => {
        if (_state.selectedGroupId !== group.group_id) {
            _state.selectedGroupId = group.group_id;
            _state.selectedModifierId = null;
            rebuild();
        }
    });

    return item;
}

function buildAddGroupForm() {
    const form = document.createElement('div');
    form.style.cssText = `
        padding: 10px;
        background: ${T.well};
        border-radius: ${T.chamferBtn}px;
        display: flex; flex-direction: column; gap: 8px;
    `;
    const label = document.createElement('div');
    label.textContent = 'New group name';
    label.style.cssText = `
        font-family: ${T.fb};
        font-size: 10px;
        font-weight: ${T.fwBold};
        color: ${T.elec};
        letter-spacing: 0.1em;
        text-transform: uppercase;
    `;
    form.appendChild(label);

    const input = document.createElement('input');
    input.type = 'text';
    input.placeholder = 'e.g. Cheese Options';
    input.style.cssText = `
        padding: 7px 10px;
        background: ${T.bg};
        border: 1px solid ${hexToRgba(T.border, 0.5)};
        border-radius: ${T.chamferBtn}px;
        color: ${T.text};
        font-family: ${T.fb};
        font-size: ${T.fsB4};
        outline: none;
        box-sizing: border-box;
    `;
    input.addEventListener('focus', () => { input.style.borderColor = T.elec; });
    input.addEventListener('blur', () => {
        input.style.borderColor = hexToRgba(T.border, 0.5);
    });
    form.appendChild(input);

    const row = document.createElement('div');
    row.style.cssText = 'display: flex; gap: 6px;';
    row.appendChild(buildPillButton('Cancel', 'tertiary', () => {
        _state.showAddGroup = false;
        rebuild();
    }, { small: true }));
    row.appendChild(buildPillButton('Create', 'confirm', async () => {
        const name = input.value.trim();
        if (!name) { showToast('Name is required', 'error'); return; }
        try {
            const result = await apiPost('/api/v1/modifier-groups', {
                name, modifier_ids: [], modifiers: [],
                min_selections: 0, max_selections: 1, drives_pricing: false,
            });
            _state.showAddGroup = false;
            if (result && result.group_id) _state.selectedGroupId = result.group_id;
            await refreshAll();
            showToast('Group created');
        } catch (e) {
            showToast('Failed to create group', 'error');
        }
    }, { small: true }));
    form.appendChild(row);

    return form;
}

/* ============================================
   RIGHT PANEL
============================================ */

function buildRightPanel() {
    const rightCard = buildStaticCard({ accent: T.elec });
    rightCard.className = 'kindpos-scrollbar-hide';
    rightCard.style.flex = '1';
    rightCard.style.padding = '0';
    rightCard.style.overflowY = 'auto';
    rightCard.style.position = 'sticky';
    rightCard.style.top = '0';
    rightCard.style.alignSelf = 'flex-start';
    rightCard.style.maxHeight = '100%';
    rightCard.style.scrollbarWidth = 'none';
    rightCard.style.msOverflowStyle = 'none';

    const group = currentGroup();
    if (!group) {
        const placeholder = document.createElement('div');
        placeholder.textContent = 'Select a modifier group';
        placeholder.style.cssText = `
            display: flex;
            align-items: center;
            justify-content: center;
            padding: 40px;
            font-family: ${T.fb};
            font-size: 11px;
            color: ${T.moon};
            text-align: center;
        `;
        rightCard.appendChild(placeholder);
        return rightCard;
    }

    rightCard.appendChild(buildGroupHeaderBar(group));
    rightCard.appendChild(buildModifierChipsRow(group));

    const modifier = currentModifier(group);
    if (modifier) {
        rightCard.appendChild(buildModifierDetail(group, modifier));
    }

    return rightCard;
}

function buildGroupHeaderBar(group) {
    const bar = document.createElement('div');
    bar.style.cssText = `
        background: ${T.card};
        border-bottom: 1px solid ${hexToRgba(T.border, 0.4)};
    `;

    // Row 1: name + controls
    const row1 = document.createElement('div');
    row1.style.cssText = `
        display: flex;
        align-items: center;
        padding: 14px 20px 0;
    `;

    const nameEl = document.createElement('div');
    nameEl.textContent = group.name || group.group_id;
    nameEl.style.cssText = `
        font-family: ${T.fh};
        font-size: 16px;
        font-weight: 700;
        color: ${T.text};
        flex: 1;
        min-width: 0;
    `;
    row1.appendChild(nameEl);

    const controls = document.createElement('div');
    controls.style.cssText = `
        display: flex;
        align-items: center;
        gap: 12px;
        flex-shrink: 0;
    `;

    // Drives Pricing compact toggle
    const toggleWrap = document.createElement('div');
    toggleWrap.style.cssText = 'display: flex; align-items: center; gap: 6px;';

    const toggleLabel = document.createElement('div');
    toggleLabel.textContent = 'Drives Pricing';
    toggleLabel.style.cssText = `
        font-family: ${T.fb};
        font-size: 8px;
        font-weight: 700;
        color: ${T.moon};
        letter-spacing: 2px;
        text-transform: uppercase;
    `;
    toggleWrap.appendChild(toggleLabel);

    let driveState = !!group.drives_pricing;
    const toggleBtn = document.createElement('button');
    toggleBtn.type = 'button';

    function applyToggleState() {
        toggleBtn.style.cssText = `
            width: 34px;
            height: 18px;
            border-radius: 9px;
            background: ${driveState ? T.greenWarm : T.moonDk};
            border: none;
            position: relative;
            cursor: pointer;
            outline: none;
            transition: background 0.15s ease;
            flex-shrink: 0;
        `;
        toggleBtn.replaceChildren();
        const knob = document.createElement('span');
        knob.style.cssText = `
            position: absolute;
            top: 3px;
            left: ${driveState ? '19px' : '3px'};
            width: 12px;
            height: 12px;
            border-radius: 50%;
            background: ${T.well};
            transition: left 0.15s ease;
        `;
        toggleBtn.appendChild(knob);
    }
    applyToggleState();

    toggleBtn.addEventListener('click', async () => {
        driveState = !driveState;
        applyToggleState();
        try {
            await apiPatch(`/api/v1/modifier-groups/${encodeURIComponent(group.group_id)}`, {
                drives_pricing: driveState,
            });
            await refreshAll();
        } catch (e) {
            driveState = !driveState;
            applyToggleState();
            showToast('Drives pricing endpoint not available', 'error');
        }
    });

    toggleWrap.appendChild(toggleBtn);
    controls.appendChild(toggleWrap);

    // Default Option Group select
    const selectWrap = document.createElement('div');
    selectWrap.style.cssText = 'display: flex; flex-direction: column; gap: 3px;';

    const selectLabel = document.createElement('div');
    selectLabel.textContent = 'Default Options';
    selectLabel.style.cssText = `
        font-family: ${T.fb};
        font-size: 8px;
        font-weight: 700;
        color: ${T.moon};
        letter-spacing: 2px;
        text-transform: uppercase;
    `;
    selectWrap.appendChild(selectLabel);

    const sel = document.createElement('select');
    sel.style.cssText = `
        appearance: none;
        -webkit-appearance: none;
        background: ${T.well};
        border: 1px solid ${T.border};
        border-radius: 6px;
        color: ${T.elec};
        font-family: ${T.fb};
        font-size: 10px;
        padding: 5px 10px;
        cursor: pointer;
        outline: none;
    `;

    const noneOpt = document.createElement('option');
    noneOpt.value = '';
    noneOpt.textContent = '— None —';
    sel.appendChild(noneOpt);

    _state.optionGroups.forEach(og => {
        const opt = document.createElement('option');
        opt.value = og.option_group_id;
        opt.textContent = og.name;
        if (og.option_group_id === group.default_option_group_id) opt.selected = true;
        sel.appendChild(opt);
    });
    if (!group.default_option_group_id) sel.value = '';

    sel.addEventListener('change', async () => {
        try {
            await apiPost(`/api/v1/modifier-groups/${encodeURIComponent(group.group_id)}/option-group`, {
                option_group_id: sel.value || null,
            });
            await refreshAll();
        } catch (e) {
            showToast('Failed to set option group', 'error');
        }
    });

    selectWrap.appendChild(sel);
    controls.appendChild(selectWrap);

    // Edit Group ghost button
    const editBtn = document.createElement('button');
    editBtn.type = 'button';
    editBtn.textContent = 'Edit Group';
    editBtn.style.cssText = `
        background: transparent;
        border: 1px solid ${T.border};
        color: ${T.moon};
        font-family: ${T.fb};
        font-size: 9px;
        font-weight: 700;
        text-transform: uppercase;
        letter-spacing: 0.06em;
        height: 28px;
        border-radius: 8px;
        padding: 0 14px;
        cursor: pointer;
        outline: none;
        white-space: nowrap;
    `;
    editBtn.addEventListener('click', () => showToast('Group edit coming soon', 'ok'));
    controls.appendChild(editBtn);

    row1.appendChild(controls);
    bar.appendChild(row1);

    // Row 2: badges
    const row2 = document.createElement('div');
    row2.style.cssText = `
        display: flex;
        align-items: center;
        gap: 6px;
        padding: 6px 20px;
    `;

    const min = group.min_selections ?? 0;
    const max = group.max_selections ?? 1;
    const typeText = min >= 1
        ? `Mandatory · 1–${max}`
        : `Optional · 0–${max}`;

    const badgeStyle = `
        font-family: ${T.fb};
        font-size: 8px;
        font-weight: 700;
        text-transform: uppercase;
        letter-spacing: 0.1em;
        padding: 2px 8px;
        border-radius: 5px;
    `;

    const typeBadge = document.createElement('span');
    typeBadge.textContent = typeText;
    typeBadge.style.cssText = badgeStyle + `
        background: ${hexToRgba(T.moon, 0.18)};
        color: ${T.moon};
    `;
    row2.appendChild(typeBadge);

    if (group.drives_pricing) {
        const driverBadge = document.createElement('span');
        driverBadge.textContent = 'Drives Pricing';
        driverBadge.style.cssText = badgeStyle + `
            background: ${hexToRgba(T.gold, 0.16)};
            color: ${T.gold};
        `;
        row2.appendChild(driverBadge);
    }

    bar.appendChild(row2);
    return bar;
}

function buildModifierChipsRow(group) {
    const strip = document.createElement('div');
    strip.style.cssText = `
        background: ${T.bg};
        padding: 10px 20px;
        border-bottom: 1px solid rgba(255,255,255,0.05);
    `;

    const label = document.createElement('div');
    label.textContent = 'Modifiers in group — click to edit';
    label.style.cssText = `
        font-family: ${T.fb};
        font-size: 8px;
        font-weight: 700;
        color: ${T.moonDk};
        letter-spacing: 2px;
        text-transform: uppercase;
        margin-bottom: 8px;
    `;
    strip.appendChild(label);

    const chipRow = document.createElement('div');
    chipRow.style.cssText = 'display: flex; flex-wrap: wrap; gap: 6px;';

    const modifiers = group.modifiers || [];
    modifiers.forEach(m => chipRow.appendChild(buildModifierChip(m)));
    chipRow.appendChild(buildAddModifierChip(group));
    strip.appendChild(chipRow);
    return strip;
}

function buildModifierChip(modifier) {
    const isSelected = _state.selectedModifierId === modifier.modifier_id;
    const price = Number(modifier.price || 0);
    const accent = price > 0 ? T.gold : T.green;
    const baseShadow = `0 4px 0 ${darkenHex(T.card, 0.35)}, inset 0 1px 0 rgba(255,255,255,0.08)`;

    const chip = document.createElement('div');
    chip.style.cssText = `
        position: relative;
        background: ${T.card};
        border-radius: 10px;
        padding: 6px 10px 6px 13px;
        cursor: pointer;
        display: inline-flex;
        align-items: center;
        gap: 6px;
        box-shadow: ${isSelected ? baseShadow + `, 0 0 0 1px ${T.elec}` : baseShadow};
        transition: transform 0.07s ease;
    `;

    const accentBar = document.createElement('div');
    accentBar.style.cssText = `
        position: absolute;
        left: 0;
        top: 6px;
        bottom: 6px;
        width: 3px;
        border-radius: 0 2px 2px 0;
        background: ${accent};
        box-shadow: 0 0 6px ${hexToRgba(accent, 0.5)};
    `;
    chip.appendChild(accentBar);

    const nameEl = document.createElement('span');
    nameEl.textContent = modifier.name;
    nameEl.style.cssText = `
        font-family: ${T.fb};
        font-size: 10px;
        font-weight: 600;
        color: ${price > 0 ? T.gold : T.green};
    `;
    chip.appendChild(nameEl);

    if (price > 0) {
        const priceEl = document.createElement('span');
        priceEl.textContent = ' ' + fmtPrice(price);
        priceEl.style.cssText = `
            font-family: ${T.fb};
            font-size: 10px;
            font-weight: 600;
            color: ${T.gold};
            opacity: 0.6;
        `;
        chip.appendChild(priceEl);
    }

    chip.addEventListener('mousedown', () => { chip.style.transform = 'translateY(2px)'; });
    chip.addEventListener('mouseup',   () => { chip.style.transform = 'translateY(0)'; });
    chip.addEventListener('mouseleave',() => { chip.style.transform = 'translateY(0)'; });
    chip.addEventListener('click', () => {
        _state.selectedModifierId = modifier.modifier_id;
        rebuild();
    });

    return chip;
}

function buildAddModifierChip(group) {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.textContent = '+ Add Modifier';
    chip.style.cssText = `
        position: relative;
        background: ${T.card};
        border: none;
        border-radius: 10px;
        padding: 6px 10px 6px 13px;
        font-family: ${T.fb};
        font-size: 10px;
        font-weight: 600;
        color: ${T.elec};
        cursor: pointer;
        outline: none;
        opacity: 0.4;
        box-shadow: 0 4px 0 ${darkenHex(T.card, 0.35)}, inset 0 1px 0 rgba(255,255,255,0.08);
        transition: opacity 0.15s ease, transform 0.07s ease;
    `;
    chip.addEventListener('mouseenter', () => { chip.style.opacity = '0.7'; });
    chip.addEventListener('mouseleave', () => { chip.style.opacity = '0.4'; });
    chip.addEventListener('mousedown',  () => { chip.style.transform = 'translateY(2px)'; });
    chip.addEventListener('mouseup',    () => { chip.style.transform = 'translateY(0)'; });
    chip.addEventListener('click', () => showToast('Modifier add coming soon', 'ok'));
    return chip;
}

/* ============================================
   MODIFIER DETAIL CARD
============================================ */

function buildModifierDetail(group, modifier) {
    const wrap = document.createElement('div');

    const sectionLabel = document.createElement('div');
    sectionLabel.textContent = `↳ Editing: ${modifier.name}`;
    sectionLabel.style.cssText = `
        font-family: ${T.fb};
        font-size: 8px;
        font-weight: 700;
        color: ${T.elec};
        letter-spacing: 2px;
        text-transform: uppercase;
        margin: 16px 20px 10px;
    `;
    wrap.appendChild(sectionLabel);

    const card = buildStaticCard({ accent: T.gold });
    card.style.margin = '0 14px 16px';
    card.style.padding = '16px 20px';

    // Header row
    const header = document.createElement('div');
    header.style.cssText = `
        display: flex;
        align-items: center;
        gap: 12px;
        padding-bottom: 12px;
        border-bottom: 1px solid rgba(255,255,255,0.06);
    `;

    const nameEl = document.createElement('div');
    nameEl.textContent = modifier.name;
    nameEl.style.cssText = `
        font-family: ${T.fb};
        font-size: 15px;
        font-weight: 700;
        color: ${T.text};
        flex: 1;
    `;
    header.appendChild(nameEl);

    const baseLabel = document.createElement('div');
    baseLabel.textContent = 'Base Price';
    baseLabel.style.cssText = `
        font-family: ${T.fb};
        font-size: 8px;
        font-weight: 700;
        color: ${T.moon};
        letter-spacing: 2px;
        text-transform: uppercase;
        flex-shrink: 0;
    `;
    header.appendChild(baseLabel);

    const priceWrap = document.createElement('div');
    priceWrap.style.cssText = 'display: flex; align-items: center; gap: 2px;';

    const dollarSign = document.createElement('span');
    dollarSign.textContent = '$';
    dollarSign.style.cssText = `
        font-family: ${T.fb};
        font-size: 13px;
        font-weight: 700;
        color: ${T.moon};
    `;
    priceWrap.appendChild(dollarSign);

    const priceInput = document.createElement('input');
    priceInput.type = 'text';
    priceInput.inputMode = 'decimal';
    const seedPrice = Number(modifier.price || 0);
    priceInput.value = isNaN(seedPrice) ? '0.00' : seedPrice.toFixed(2);
    priceInput.style.cssText = `
        width: 90px;
        box-sizing: border-box;
        background: ${T.well};
        border: 1px solid ${hexToRgba(T.gold, 0.3)};
        border-radius: 6px;
        padding: 5px 12px;
        font-family: ${T.fb};
        font-size: 13px;
        font-weight: 700;
        color: ${T.gold};
        text-align: right;
        outline: none;
    `;

    priceInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); priceInput.blur(); return; }
        if (e.key.length > 1 || e.ctrlKey || e.metaKey || e.altKey) return;
        const isDigit = e.key >= '0' && e.key <= '9';
        const isDecimal = e.key === '.';
        if (!isDigit && !isDecimal) { e.preventDefault(); return; }
        const v = priceInput.value;
        if (isDecimal && v.includes('.')) { e.preventDefault(); return; }
        if (isDigit && !v.includes('.') && v.length >= 2) {
            e.preventDefault();
            priceInput.value = v + '.' + e.key;
            priceInput.dispatchEvent(new Event('input'));
            return;
        }
        if (isDigit && v.includes('.')) {
            const cursorPos = priceInput.selectionStart;
            const dotIdx = v.indexOf('.');
            const fracPart = v.slice(dotIdx + 1);
            if (cursorPos > dotIdx && fracPart.length >= 2 && cursorPos === priceInput.selectionEnd) {
                e.preventDefault();
            }
        }
    });

    priceInput.addEventListener('blur', async () => {
        const n = parseFloat(priceInput.value);
        priceInput.value = isNaN(n) ? '0.00' : n.toFixed(2);
        const next = parseFloat(priceInput.value);
        const prev = Number(modifier.price || 0);
        if (Math.abs(next - prev) < 0.005) return;
        try {
            await apiPatch(`/api/v1/modifiers/${encodeURIComponent(modifier.modifier_id)}`, {
                price: next,
            });
            modifier.price = next;
            await refreshAll();
        } catch (e) {
            priceInput.value = prev.toFixed(2);
            showToast('Failed to save base price', 'error');
        }
    });

    priceWrap.appendChild(priceInput);
    header.appendChild(priceWrap);

    // Active toggle — 34×18px compact style
    let activeState = modifier.active !== false;
    const activeBtn = document.createElement('button');
    activeBtn.type = 'button';

    function applyActiveState() {
        activeBtn.style.cssText = `
            width: 34px;
            height: 18px;
            border-radius: 9px;
            background: ${activeState ? T.greenWarm : T.moonDk};
            border: none;
            position: relative;
            cursor: pointer;
            outline: none;
            transition: background 0.15s ease;
            flex-shrink: 0;
        `;
        activeBtn.replaceChildren();
        const knob = document.createElement('span');
        knob.style.cssText = `
            position: absolute;
            top: 3px;
            left: ${activeState ? '19px' : '3px'};
            width: 12px;
            height: 12px;
            border-radius: 50%;
            background: ${T.well};
            transition: left 0.15s ease;
        `;
        activeBtn.appendChild(knob);
    }
    applyActiveState();

    activeBtn.addEventListener('click', async () => {
        activeState = !activeState;
        applyActiveState();
        try {
            await apiPatch(`/api/v1/modifiers/${encodeURIComponent(modifier.modifier_id)}`, {
                active: activeState,
            });
            modifier.active = activeState;
        } catch (e) {
            activeState = !activeState;
            applyActiveState();
            showToast('Failed to update modifier', 'error');
        }
    });
    header.appendChild(activeBtn);
    card.appendChild(header);

    // Two-column body
    const body = document.createElement('div');
    body.style.cssText = 'display: flex; gap: 20px; margin-top: 14px;';
    body.appendChild(buildSizePricingCol(group, modifier));
    body.appendChild(buildMicromodsCol(modifier));
    card.appendChild(body);

    wrap.appendChild(card);
    return wrap;
}

/* ------------------------------------------
   SIZE PRICING column
------------------------------------------ */
function buildSizePricingCol(group, modifier) {
    const col = document.createElement('div');
    col.style.cssText = 'display: flex; flex-direction: column; gap: 8px; flex: 1; min-width: 0;';

    const label = document.createElement('div');
    label.textContent = 'Size Pricing';
    label.style.cssText = `
        font-family: ${T.fb};
        font-size: 8px;
        font-weight: 700;
        color: ${T.green};
        letter-spacing: 2px;
        text-transform: uppercase;
    `;
    col.appendChild(label);

    const drivers = _state.groups.filter(g => g.drives_pricing);
    const driver = drivers.find(g => g.group_id === group.group_id) || drivers[0] || null;

    if (!driver) {
        const note = document.createElement('div');
        note.textContent = 'No drives_pricing group — toggle Drives Pricing on a group to enable size-aware adjustments.';
        note.style.cssText = `
            font-family: ${T.fb};
            font-size: 9px;
            color: ${T.moon};
            line-height: 1.5;
            padding: 10px 12px;
            background: ${T.well};
            border-radius: 8px;
        `;
        col.appendChild(note);
        return col;
    }

    const sizesList = (_state.sizes || []).slice();
    const driverGroupId = driver.group_id;
    const modSizeMap = (modifier.price_by_size && modifier.price_by_size[driverGroupId]) || {};
    const flatMap = (group.size_price_adjustments || {});
    const liveValues = {};
    sizesList.forEach(s => {
        const key = s.name;
        const v = modSizeMap[key];
        if (v != null) liveValues[key] = Number(v);
        else if (flatMap[key] != null) liveValues[key] = Number(flatMap[key]);
        else liveValues[key] = 0;
    });

    const gridWrap = document.createElement('div');
    gridWrap.style.cssText = `
        background: ${T.well};
        border-radius: 8px;
        overflow: hidden;
    `;

    // Header row
    const hdrRow = document.createElement('div');
    hdrRow.style.cssText = `
        display: grid;
        grid-template-columns: 1fr 88px 70px;
        background: ${hexToRgba(T.green, 0.05)};
        padding: 7px 14px;
        gap: 8px;
        align-items: center;
    `;
    ['SIZE', 'ADJ', 'TOTAL'].forEach((h, i) => {
        const cell = document.createElement('div');
        cell.textContent = h;
        cell.style.cssText = `
            font-family: ${T.fb};
            font-size: 8px;
            font-weight: 700;
            color: ${T.moon};
            letter-spacing: 2px;
            text-transform: uppercase;
            text-align: ${i === 0 ? 'left' : 'right'};
        `;
        hdrRow.appendChild(cell);
    });
    gridWrap.appendChild(hdrRow);

    sizesList.forEach(s => {
        const row = document.createElement('div');
        row.style.cssText = `
            display: grid;
            grid-template-columns: 1fr 88px 70px;
            padding: 9px 14px;
            gap: 8px;
            align-items: center;
            border-bottom: 1px solid rgba(255,255,255,0.04);
        `;

        const nameCell = document.createElement('div');
        nameCell.textContent = s.name;
        nameCell.style.cssText = `
            font-family: ${T.fb};
            font-size: 10px;
            font-weight: 600;
            color: ${T.moon};
            text-transform: uppercase;
        `;
        row.appendChild(nameCell);

        const adjWrap = document.createElement('div');
        adjWrap.style.cssText = 'display: flex; justify-content: flex-end;';

        const adjInput = document.createElement('input');
        adjInput.type = 'text';
        adjInput.inputMode = 'decimal';
        adjInput.value = Number(liveValues[s.name] || 0).toFixed(2);
        adjInput.style.cssText = `
            width: 70px;
            box-sizing: border-box;
            background: ${T.well};
            border: 1px solid ${T.border};
            border-radius: 5px;
            font-family: ${T.fb};
            font-size: 11px;
            font-weight: 700;
            color: ${T.gold};
            text-align: right;
            padding: 4px 8px;
            outline: none;
        `;

        const totalCell = document.createElement('div');
        totalCell.style.cssText = `
            font-family: ${T.fb};
            font-size: 11px;
            font-weight: 600;
            color: ${T.gold};
            text-align: right;
        `;

        function updateTotal() {
            const adj = parseFloat(adjInput.value) || 0;
            const base = Number(modifier.price || 0);
            totalCell.textContent = '$' + (base + adj).toFixed(2);
        }
        updateTotal();

        adjInput.addEventListener('input', updateTotal);
        adjInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') { e.preventDefault(); adjInput.blur(); }
        });
        adjInput.addEventListener('blur', async () => {
            const next = parseFloat(adjInput.value) || 0;
            adjInput.value = next.toFixed(2);
            updateTotal();
            const prev = Number(liveValues[s.name] || 0);
            if (next.toFixed(2) === prev.toFixed(2)) return;
            const newMap = Object.fromEntries(
                Object.entries({ ...liveValues, [s.name]: next })
                    .map(([k, v]) => [k, Number(v).toFixed(2)])
            );
            try {
                await apiPut(
                    `/api/v1/modifiers/${encodeURIComponent(modifier.modifier_id)}/size-pricing/${encodeURIComponent(driverGroupId)}`,
                    { size_prices: newMap },
                );
                liveValues[s.name] = next;
            } catch (e) {
                adjInput.value = prev.toFixed(2);
                updateTotal();
                showToast('Failed to save size pricing', 'error');
            }
        });

        adjWrap.appendChild(adjInput);
        row.appendChild(adjWrap);
        row.appendChild(totalCell);
        gridWrap.appendChild(row);
    });

    col.appendChild(gridWrap);

    if (sizesList.length === 0) {
        const note = document.createElement('div');
        note.textContent = 'No sizes configured yet.';
        note.style.cssText = `
            font-family: ${T.fb};
            font-size: 9px;
            color: ${T.moon};
            padding: 10px 12px;
            background: ${T.well};
            border-radius: 8px;
        `;
        col.appendChild(note);
    }

    if (drivers.length > 1) {
        const link = document.createElement('button');
        link.type = 'button';
        link.textContent = '+ Add Size Group pricing';
        link.style.cssText = `
            align-self: flex-start;
            background: transparent;
            border: none;
            color: ${T.elec};
            font-family: ${T.fb};
            font-size: 9px;
            font-weight: 700;
            cursor: pointer;
            padding: 4px 0;
            margin-top: 4px;
        `;
        link.addEventListener('click', () => showToast('Multi-driver pricing coming soon', 'ok'));
        col.appendChild(link);
    }

    return col;
}

/* ------------------------------------------
   MICROMODS column
------------------------------------------ */
function buildMicromodsCol(modifier) {
    const col = document.createElement('div');
    col.style.cssText = 'display: flex; flex-direction: column; gap: 8px; flex: 1; min-width: 0;';

    const label = document.createElement('div');
    label.textContent = 'MicroMODs';
    label.style.cssText = `
        font-family: ${T.fb};
        font-size: 8px;
        font-weight: 700;
        color: ${T.lavender};
        letter-spacing: 2px;
        text-transform: uppercase;
    `;
    col.appendChild(label);

    const note = document.createElement('div');
    note.textContent = 'Specification-only. Always $0.00.';
    note.style.cssText = `
        font-family: ${T.fb};
        font-size: 9px;
        color: ${T.moon};
        margin-bottom: 10px;
    `;
    col.appendChild(note);

    const attached = (_state.micromods || []).filter(mm => mm.modifier_id === modifier.modifier_id);

    if (attached.length === 0) {
        const empty = document.createElement('div');
        empty.textContent = 'No microMODs attached';
        empty.style.cssText = `
            font-family: ${T.fb};
            font-size: 9px;
            color: ${T.moon};
            font-style: italic;
        `;
        col.appendChild(empty);
    } else {
        attached.forEach(mm => col.appendChild(buildMicromodRow(mm)));
    }

    const addLink = document.createElement('button');
    addLink.type = 'button';
    addLink.textContent = '+ Attach MicroMOD Group';
    addLink.style.cssText = `
        align-self: flex-start;
        background: transparent;
        border: none;
        color: ${T.lavender};
        font-family: ${T.fb};
        font-size: 9px;
        font-weight: 700;
        cursor: pointer;
        padding: 4px 0;
        margin-top: 4px;
    `;
    addLink.addEventListener('click', () => showToast('MicroMOD attach coming soon', 'ok'));
    col.appendChild(addLink);

    const divider = document.createElement('div');
    divider.style.cssText = `
        height: 1px;
        background: rgba(255,255,255,0.06);
        margin: 12px 0;
    `;
    col.appendChild(divider);

    col.appendChild(buildIncludedItemsSection(modifier));
    return col;
}

function buildMicromodRow(mm) {
    const row = document.createElement('div');
    row.style.cssText = `
        background: ${hexToRgba(T.lavender, 0.07)};
        border: 1px solid ${hexToRgba(T.lavender, 0.18)};
        border-radius: 7px;
        padding: 8px 12px;
        display: flex;
        align-items: center;
        gap: 10px;
    `;

    const textBlock = document.createElement('div');
    textBlock.style.cssText = 'flex: 1; min-width: 0;';

    const name = document.createElement('div');
    name.textContent = mm.name;
    name.style.cssText = `
        font-family: ${T.fb};
        font-size: 11px;
        font-weight: 600;
        color: ${T.lavender};
    `;
    textBlock.appendChild(name);

    const sub = document.createElement('div');
    sub.textContent = mm.values && mm.values.length ? mm.values.join(', ') : '—';
    sub.style.cssText = `
        font-family: ${T.fb};
        font-size: 9px;
        color: ${T.moon};
        margin-top: 1px;
    `;
    textBlock.appendChild(sub);
    row.appendChild(textBlock);

    const badge = document.createElement('span');
    badge.textContent = 'Prep';
    badge.style.cssText = `
        background: ${hexToRgba(T.lavender, 0.16)};
        color: ${T.lavender};
        font-family: ${T.fb};
        font-size: 8px;
        font-weight: 700;
        text-transform: uppercase;
        letter-spacing: 0.1em;
        padding: 2px 7px;
        border-radius: 5px;
        flex-shrink: 0;
    `;
    row.appendChild(badge);

    const removeBtn = document.createElement('button');
    removeBtn.type = 'button';
    removeBtn.textContent = 'Remove';
    removeBtn.style.cssText = `
        background: transparent;
        border: 1px solid ${T.border};
        color: ${T.moon};
        font-family: ${T.fb};
        font-size: 8px;
        font-weight: 700;
        height: 22px;
        border-radius: 6px;
        padding: 0 9px;
        cursor: pointer;
        outline: none;
        white-space: nowrap;
        flex-shrink: 0;
    `;
    removeBtn.addEventListener('mouseenter', () => {
        removeBtn.style.color = T.verm;
        removeBtn.style.borderColor = T.verm;
    });
    removeBtn.addEventListener('mouseleave', () => {
        removeBtn.style.color = T.moon;
        removeBtn.style.borderColor = T.border;
    });
    removeBtn.addEventListener('click', () => showToast('MicroMOD remove coming soon', 'ok'));
    row.appendChild(removeBtn);

    return row;
}

function buildIncludedItemsSection(modifier) {
    const wrap = document.createElement('div');

    const label = document.createElement('div');
    label.textContent = 'Included in items';
    label.style.cssText = `
        font-family: ${T.fb};
        font-size: 8px;
        font-weight: 700;
        color: ${T.moon};
        letter-spacing: 2px;
        text-transform: uppercase;
        margin-bottom: 8px;
    `;
    wrap.appendChild(label);

    const containing = (_state.items || []).filter(it =>
        Array.isArray(it.included_modifier_ids) &&
        it.included_modifier_ids.includes(modifier.modifier_id)
    );

    const chipRow = document.createElement('div');
    chipRow.style.cssText = 'display: flex; flex-wrap: wrap; gap: 6px;';

    if (containing.length === 0) {
        const empty = document.createElement('div');
        empty.textContent = 'Not included on any item';
        empty.style.cssText = `
            font-family: ${T.fb};
            font-size: 9px;
            color: ${T.moon};
            font-style: italic;
        `;
        chipRow.appendChild(empty);
    } else {
        const chipShadow = `0 3px 0 ${darkenHex(T.card, 0.35)}, inset 0 1px 0 rgba(255,255,255,0.08)`;
        containing.forEach(it => {
            const chip = document.createElement('div');
            chip.style.cssText = `
                position: relative;
                background: ${T.card};
                border-radius: 10px;
                padding: 5px 10px 5px 12px;
                display: inline-flex;
                align-items: center;
                box-shadow: ${chipShadow};
            `;

            const accentBar = document.createElement('div');
            accentBar.style.cssText = `
                position: absolute;
                left: 0;
                top: 5px;
                bottom: 5px;
                width: 3px;
                border-radius: 0 2px 2px 0;
                background: ${T.moon};
            `;
            chip.appendChild(accentBar);

            const nameEl = document.createElement('span');
            nameEl.textContent = it.name;
            nameEl.style.cssText = `
                font-family: ${T.fb};
                font-size: 10px;
                font-weight: 600;
                color: ${T.moon};
            `;
            chip.appendChild(nameEl);
            chipRow.appendChild(chip);
        });
    }
    wrap.appendChild(chipRow);
    return wrap;
}

/* ============================================
   HELPERS — current-selection lookups
============================================ */
function currentGroup() {
    if (!_state.selectedGroupId) return null;
    return _state.groups.find(g => g.group_id === _state.selectedGroupId) || null;
}

function currentModifier(group) {
    if (!group || !_state.selectedModifierId) return null;
    return (group.modifiers || []).find(m => m.modifier_id === _state.selectedModifierId) || null;
}

function optionGroupName(id) {
    if (!id) return null;
    const og = _state.optionGroups.find(o => o.option_group_id === id);
    return og ? og.name : null;
}

/* ============================================
   RENDER + LIFECYCLE
============================================ */
function rebuild() {
    if (!_state.wrapper) return;
    _state.wrapper.replaceChildren();
    _state.wrapper.appendChild(buildLeftPanel());
    _state.wrapper.appendChild(buildRightPanel());
}

async function refreshAll() {
    try {
        const [groups, optionGroups, options, sizes, micromods, items] = await Promise.all([
            apiGetOptional('/api/v1/config/modifier-groups', []),
            apiGetOptional('/api/v1/option-groups', []),
            apiGetOptional('/api/v1/options', []),
            apiGetOptional('/api/v1/sizes', []),
            apiGetOptional('/api/v1/config/micromods', []),
            apiGetOptional('/api/v1/config/menu/items', []),
        ]);
        _state.groups = (groups || []).filter(g => !g.hidden);
        _state.optionGroups = optionGroups || [];
        _state.options = options || [];
        _state.sizes = sizes || [];
        _state.micromods = micromods || [];
        _state.items = items || [];

        // Repair selection if the current ids vanished from the list.
        if (_state.selectedGroupId && !_state.groups.some(g => g.group_id === _state.selectedGroupId)) {
            _state.selectedGroupId = null;
            _state.selectedModifierId = null;
        } else if (!_state.selectedGroupId && _state.groups.length > 0) {
            _state.selectedGroupId = _state.groups[0].group_id;
        }
        const grp = currentGroup();
        if (grp && _state.selectedModifierId &&
            !(grp.modifiers || []).some(m => m.modifier_id === _state.selectedModifierId)) {
            _state.selectedModifierId = null;
        }
    } catch (e) {
        console.error('[Modifiers] Refresh failed:', e);
    }
    rebuild();
}

export function buildModifierGroupsScene(container) {
    _state.container = container;
    _state.selectedGroupId = null;
    _state.selectedModifierId = null;
    _state.showAddGroup = false;

    container.replaceChildren();

    _state.wrapper = document.createElement('div');
    _state.wrapper.style.cssText = `
        display: flex;
        height: 100%;
        overflow: hidden;
        gap: 14px;
        padding: 14px;
        background: ${T.bg};
        box-sizing: border-box;
        align-items: stretch;
    `;
    container.appendChild(_state.wrapper);

    rebuild();
    refreshAll().catch(e => console.error('[Modifiers] Initial load failed:', e));
}

export function cleanupModifierGroups(container) {
    if (container) container.replaceChildren();
    _state.container = null;
    _state.wrapper = null;
    _state.groups = [];
    _state.optionGroups = [];
    _state.options = [];
    _state.sizes = [];
    _state.micromods = [];
    _state.items = [];
    _state.selectedGroupId = null;
    _state.selectedModifierId = null;
    _state.showAddGroup = false;
}
