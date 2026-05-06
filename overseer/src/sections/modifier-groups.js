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
    buildActionCard,
    hexToRgba,
    darkenHex,
} from '../../../common/theme.js';

/* ------------------------------------------
   STATE
------------------------------------------ */
const _state = {
    container: null,
    wrapper: null,
    contentMount: null,

    activeTab: 'mod', // 'mod' | 'micromod' | 'optionGroup'
    loadError: false,
    addingOptionGroup: false,
    editingGroupId: null,

    groups: [],
    micromodGroups: [],
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
const fmtPrice = (n) => '$' + Number(n || 0).toFixed(2); ;
const fmtPriceAdj = (n) => {
    const v = Number(n || 0);
    if (v > 0) return '+ ' + fmtPrice(v);
    if (v < 0) return '− ' + fmtPrice(Math.abs(v));
    return fmtPrice(0);
}

/* ------------------------------------------
   API
------------------------------------------ */
const apiGet = async (url) => {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`GET ${url} → ${res.status}`);
    return res.json();
}

const apiPost = async (url, body) => {
    const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: body == null ? undefined : JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`POST ${url} → ${res.status}`);
    return res.json();
}

const apiPatch = async (url, body) => {
    const res = await fetch(url, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`PATCH ${url} → ${res.status}`);
    return res.json();
}

const apiPut = async (url, body) => {
    const res = await fetch(url, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`PUT ${url} → ${res.status}`);
    return res.json();
}

const apiGetOptional = async (url, fallback) => {
    try { return await apiGet(url); }
    catch (e) { console.warn(`[Modifiers] ${url} unavailable:`, e.message); return fallback; }
}

const apiDelete = async (url) => {
    const res = await fetch(url, { method: 'DELETE' });
    if (!res.ok) throw new Error(`DELETE ${url} → ${res.status}`);
    return res.json();
}

/* ------------------------------------------
   INLINE PICKER — replaces a host element with a
   dropdown <select> populated from an async fetch.
   Used by Wire 1 / 3 / 5 in the spec.
------------------------------------------ */
const openModifierPickerInline = async (host, currentIds, onPick) => {
    const original = host.textContent;
    host.disabled = true;
    host.textContent = 'Loading…';
    try {
        const all = await apiGet('/api/v1/modifiers');
        const taken = new Set(currentIds || []);
        const candidates = (all || [])
            .filter(m => !taken.has(m.modifier_id) && m.active !== false);
        host.replaceWith(buildPickerSelect(
            candidates.length ? '+ ADD MODIFIER' : 'ALL MODIFIERS ADDED',
            candidates.map(m => ({ value: m.modifier_id, label: m.name || m.modifier_id })),
            onPick,
        ));
    } catch (e) {
        host.disabled = false;
        host.textContent = original;
        showToast('Failed to load modifiers', 'error');
    }
}

const openMicromodGroupPickerInline = async (host, takenMicromodIds, onPick) => {
    const original = host.textContent;
    host.disabled = true;
    host.textContent = 'Loading…';
    try {
        const all = await apiGet('/api/v1/config/modifier-groups');
        const groups = (all || []).filter(g => !g.hidden && isMicromodGroup(g));
        const taken = new Set(takenMicromodIds || []);
        // Hide groups whose modifiers are entirely already attached.
        const candidates = groups.filter(g => {
            const ids = (g.modifiers || []).map(m => m.modifier_id);
            return ids.some(id => !taken.has(id));
        });
        host.replaceWith(buildPickerSelect(
            candidates.length ? '+ ATTACH MICROMOD GROUP' : 'NO GROUPS AVAILABLE',
            candidates.map(g => ({ value: g.group_id, label: g.name || g.group_id })),
            onPick,
        ));
    } catch (e) {
        host.disabled = false;
        host.textContent = original;
        showToast('Failed to load microMOD groups', 'error');
    }
}

const buildPickerSelect = (placeholder, options, onPick) => {
    const select = document.createElement('select');
    select.style.cssText = `
        background: ${T.well};
        border: 1px solid ${T.border};
        border-radius: 6px;
        padding: 6px 10px;
        font-family: ${T.fb};
        font-size: 11px;
        font-weight: 700;
        letter-spacing: 0.04em;
        color: ${T.text};
        cursor: pointer;
        outline: none;
    `;
    const placeholderOpt = document.createElement('option');
    placeholderOpt.value = '';
    placeholderOpt.textContent = placeholder;
    placeholderOpt.disabled = true;
    placeholderOpt.selected = true;
    select.appendChild(placeholderOpt);
    options.forEach(o => {
        const opt = document.createElement('option');
        opt.value = o.value;
        opt.textContent = o.label;
        select.appendChild(opt);
    });
    if (options.length === 0) select.disabled = true;
    select.addEventListener('change', () => {
        if (!select.value) return;
        onPick(select.value);
    });
    return select;
}

const buildErrorState = (retry) => {
    const el = document.createElement('div');
    el.textContent = 'Failed to load — tap to retry';
    el.style.cssText = `
        padding: 40px 20px;
        text-align: center;
        font-family: ${T.fb};
        font-size: 11px;
        color: ${T.verm};
        cursor: pointer;
        letter-spacing: 0.08em;
    `;
    el.addEventListener('click', retry);
    return el;
}

/* ------------------------------------------
   TOAST
------------------------------------------ */
const showToast = (msg, kind = 'ok') => {
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
const buildToggle = (initial, onChange) => {
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

const buildPillButton = (label, variant, onClick, opts = {}) => {
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

const buildBadge = (text, color) => {
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

const buildMoonBadge = (text) => {
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

const buildSelectMock = (value, onChange, options) => {
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

const buildPriceInput = (value, opts = {}) => {
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

const buildLeftPanel = () => {
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
    sectionLabel.textContent = 'Groups';
    sectionLabel.style.cssText = `
        font-family: ${T.fb};
        font-size: 11px;
        font-weight: 700;
        color: ${T.moonDk};
        letter-spacing: 2.5px;
        text-transform: uppercase;
        margin-bottom: 2px;
    `;
    leftContent.appendChild(sectionLabel);

    const subLabel = document.createElement('div');
    subLabel.textContent = 'Mod Groups · MicroMOD Groups';
    subLabel.style.cssText = `
        font-family: ${T.fb};
        font-size: 10px;
        font-weight: 600;
        color: ${T.moon};
        letter-spacing: 0.06em;
        margin-bottom: 8px;
    `;
    leftContent.appendChild(subLabel);

    const newBtn = document.createElement('button');
    newBtn.type = 'button';
    newBtn.textContent = '+ NEW GROUP';
    newBtn.style.cssText = `
        display: block;
        width: 100%;
        height: 36px;
        background: ${T.elec};
        color: ${T.well};
        border: none;
        border-radius: 8px;
        font-family: ${T.fb};
        font-size: 11px;
        font-weight: 700;
        text-transform: uppercase;
        letter-spacing: 0.06em;
        cursor: pointer;
        margin-bottom: 10px;
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

    if (_state.loadError) {
        list.appendChild(buildErrorState(() => refreshAll()));
    } else if (_state.groups.length === 0) {
        const empty = document.createElement('div');
        empty.textContent = 'No groups yet — tap + New Group';
        empty.style.cssText = `
            padding: 18px 8px;
            text-align: center;
            font-family: ${T.fb};
            font-size: 11px;
            color: ${T.moon};
        `;
        list.appendChild(empty);
    } else {
        _state.groups.forEach(g => list.appendChild(buildGroupListItem(g)));
    }

    leftContent.appendChild(list);
    return leftCard;
}

const buildGroupListItem = (group) => {
    const isSelected = _state.selectedGroupId === group.group_id;
    const isDriver = !!group.drives_pricing;
    const accent = isDriver ? T.gold : T.green;

    const item = buildActionCard({
        accent,
        onClick: () => {
            if (_state.selectedGroupId !== group.group_id) {
                _state.selectedGroupId = group.group_id;
                _state.selectedModifierId = null;
                rebuild();
            }
        },
    });
    item.style.margin = '4px 0';

    const name = document.createElement('div');
    name.textContent = group.name || group.group_id;
    name.style.cssText = `
        font-family: ${T.fh};
        font-size: 14px;
        font-weight: 700;
        color: ${isDriver ? T.gold : T.text};
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
        font-size: 11px;
        color: ${T.moon};
        letter-spacing: 0.04em;
        line-height: 1.4;
        margin-top: 3px;
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

    // Selected — keep an elec ring stamped on top of buildActionCard's
    // internal hover/press shadows. These listeners run after the internal
    // ones since they're added later, so they always have the final say.
    if (isSelected) {
        const ring = `0 0 0 1px ${T.elec}`;
        const stampRing = () => {
            const current = item.style.boxShadow || '';
            if (!current.includes(ring)) {
                item.style.boxShadow = current ? `${current}, ${ring}` : ring;
            }
        };
        item.addEventListener('mouseenter', stampRing);
        item.addEventListener('mouseleave', stampRing);
        item.addEventListener('pointerdown', stampRing);
        item.addEventListener('pointerup', stampRing);
        stampRing();
    }

    return item;
}

const buildAddGroupForm = () => {
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

const buildRightPanel = () => {
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

const buildGroupHeaderBar = (group) => {
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
        font-size: 22px;
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
        font-size: 10px;
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
            width: 44px;
            height: 24px;
            border-radius: 12px;
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
            top: 4px;
            left: ${driveState ? '25px' : '4px'};
            width: 16px;
            height: 16px;
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
        font-size: 10px;
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
        font-size: 12px;
        height: 32px;
        padding: 0 10px;
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
        font-size: 11px;
        font-weight: 700;
        text-transform: uppercase;
        letter-spacing: 0.06em;
        height: 36px;
        border-radius: 8px;
        padding: 0 14px;
        cursor: pointer;
        outline: none;
        white-space: nowrap;
    `;
    editBtn.addEventListener('click', () => {
        const next = window.prompt('Rename group', group.name || '');
        if (next == null) return;
        const trimmed = next.trim();
        if (!trimmed || trimmed === (group.name || '')) return;
        apiPatch(`/api/v1/modifier-groups/${encodeURIComponent(group.group_id)}`, { name: trimmed })
            .then(() => refreshAll())
            .then(() => showToast('Group renamed'))
            .catch(() => showToast('Failed to rename group', 'error'));
    });
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
        font-size: 10px;
        font-weight: 700;
        text-transform: uppercase;
        letter-spacing: 0.1em;
        padding: 4px 10px;
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

const buildModifierChipsRow = (group) => {
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
        font-size: 10px;
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
    modifiers.forEach(m => chipRow.appendChild(buildModifierChip(m, group)));
    chipRow.appendChild(buildAddModifierChip(group));
    strip.appendChild(chipRow);
    return strip;
}

const buildModifierChip = (modifier, group) => {
    const isSelected = _state.selectedModifierId === modifier.modifier_id;
    const price = Number(modifier.price || 0);
    const accent = price > 0 ? T.gold : T.green;
    const baseShadow = `0 4px 0 ${darkenHex(T.card, 0.35)}, inset 0 1px 0 rgba(255,255,255,0.08)`;

    const chip = document.createElement('div');
    chip.style.cssText = `
        position: relative;
        background: ${T.card};
        border-radius: 10px;
        padding: 8px 14px 8px 16px;
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
        width: 4px;
        border-radius: 0 2px 2px 0;
        background: ${accent};
        box-shadow: 0 0 6px ${hexToRgba(accent, 0.5)};
    `;
    chip.appendChild(accentBar);

    const nameEl = document.createElement('span');
    nameEl.textContent = modifier.name;
    nameEl.style.cssText = `
        font-family: ${T.fb};
        font-size: 13px;
        font-weight: 600;
        color: ${price > 0 ? T.gold : T.green};
    `;
    chip.appendChild(nameEl);

    if (price > 0) {
        const priceEl = document.createElement('span');
        priceEl.textContent = ' ' + fmtPrice(price);
        priceEl.style.cssText = `
            font-family: ${T.fb};
            font-size: 13px;
            font-weight: 600;
            color: ${T.gold};
            opacity: 0.6;
        `;
        chip.appendChild(priceEl);
    }

    chip.addEventListener('mousedown', () => { chip.style.transform = 'translateY(2px)'; });
    chip.addEventListener('mouseup',   () => { chip.style.transform = 'translateY(0)'; });
    chip.addEventListener('mouseleave',() => { chip.style.transform = 'translateY(0)'; });
    chip.addEventListener('click', (e) => {
        if (e.target.closest('[data-chip-remove]')) return;
        _state.selectedModifierId = modifier.modifier_id;
        rebuild();
    });

    if (group && group.group_id) {
        const removeX = document.createElement('button');
        removeX.type = 'button';
        removeX.dataset.chipRemove = '1';
        removeX.textContent = '×';
        removeX.style.cssText = `
            position: absolute;
            top: -4px;
            right: -4px;
            width: 16px;
            height: 16px;
            border-radius: 50%;
            background: ${T.verm};
            color: ${T.text};
            border: none;
            font-family: ${T.fb};
            font-size: 10px;
            font-weight: 700;
            line-height: 16px;
            text-align: center;
            padding: 0;
            cursor: pointer;
            outline: none;
        `;
        removeX.addEventListener('click', async (e) => {
            e.stopPropagation();
            const label = modifier.name || modifier.modifier_id;
            if (!window.confirm(`Remove ${label} from this group?`)) return;
            try {
                await apiDelete(
                    `/api/v1/modifier-groups/${encodeURIComponent(group.group_id)}` +
                    `/modifiers/${encodeURIComponent(modifier.modifier_id)}`,
                );
                await refreshAll();
                showToast('Modifier removed from group');
            } catch (err) {
                showToast('Failed to remove modifier', 'error');
            }
        });
        chip.appendChild(removeX);
    }

    return chip;
}

const buildAddModifierChip = (group) => {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.textContent = '+ Add Modifier';
    chip.style.cssText = `
        position: relative;
        background: ${T.card};
        border: none;
        border-radius: 10px;
        padding: 8px 14px 8px 16px;
        font-family: ${T.fb};
        font-size: 13px;
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
    chip.addEventListener('click', () => {
        const currentIds = (group.modifiers || []).map(m => m.modifier_id);
        openModifierPickerInline(chip, currentIds, async (modifierId) => {
            try {
                await apiPost(
                    `/api/v1/modifier-groups/${encodeURIComponent(group.group_id)}` +
                    `/modifiers/${encodeURIComponent(modifierId)}`,
                );
                await refreshAll();
                showToast('Modifier added to group');
            } catch (e) {
                showToast('Failed to add modifier', 'error');
            }
        });
    });
    return chip;
}

/* ============================================
   MODIFIER DETAIL CARD
============================================ */

const buildModifierDetail = (group, modifier) => {
    const wrap = document.createElement('div');

    const sectionLabel = document.createElement('div');
    sectionLabel.textContent = `↳ Editing: ${modifier.name}`;
    sectionLabel.style.cssText = `
        font-family: ${T.fb};
        font-size: 10px;
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
        font-size: 10px;
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
            width: 44px;
            height: 24px;
            border-radius: 12px;
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
            top: 4px;
            left: ${activeState ? '25px' : '4px'};
            width: 16px;
            height: 16px;
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
const buildSizePricingCol = (group, modifier) => {
    const col = document.createElement('div');
    col.style.cssText = 'display: flex; flex-direction: column; gap: 8px; flex: 1; min-width: 0;';

    const label = document.createElement('div');
    label.textContent = 'Size Pricing';
    label.style.cssText = `
        font-family: ${T.fb};
        font-size: 10px;
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
            font-size: 10px;
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
            color: ${T.text};
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
            font-size: 11px;
            font-weight: 700;
            cursor: pointer;
            padding: 4px 0;
            margin-top: 4px;
        `;
        link.addEventListener('click', () => showToast('Multi-driver pricing not yet wired', 'ok'));
        col.appendChild(link);
    }

    return col;
}

/* ------------------------------------------
   MICROMODS column
------------------------------------------ */
const buildMicromodsCol = (modifier) => {
    const col = document.createElement('div');
    col.style.cssText = 'display: flex; flex-direction: column; gap: 8px; flex: 1; min-width: 0;';

    const label = document.createElement('div');
    label.textContent = 'MicroMODs';
    label.style.cssText = `
        font-family: ${T.fb};
        font-size: 10px;
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
        attached.forEach(mm => col.appendChild(buildMicromodRow(mm, modifier)));
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
        font-size: 11px;
        font-weight: 700;
        cursor: pointer;
        padding: 4px 0;
        margin-top: 4px;
    `;
    addLink.addEventListener('click', () => {
        const taken = (_state.micromods || [])
            .filter(mm => mm.modifier_id === modifier.modifier_id)
            .map(mm => mm.micromod_id || mm.modifier_id);
        const alreadyAttached = new Set(modifier.included_modifier_ids || []);
        taken.forEach(id => alreadyAttached.add(id));

        openMicromodGroupPickerInline(addLink, [...alreadyAttached], async (groupId) => {
            const grp = (_state.micromodGroups || [])
                .find(g => g.group_id === groupId);
            if (!grp) {
                showToast('MicroMOD group not found', 'error');
                return;
            }
            const ids = (grp.modifiers || [])
                .map(m => m.modifier_id)
                .filter(id => id && !alreadyAttached.has(id));
            if (ids.length === 0) {
                showToast('Group has nothing new to attach', 'error');
                return;
            }
            try {
                for (const micromodId of ids) {
                    await apiPost(
                        `/api/v1/modifiers/${encodeURIComponent(modifier.modifier_id)}` +
                        `/micromods/${encodeURIComponent(micromodId)}`,
                    );
                }
                await refreshAll();
                showToast('MicroMOD group attached');
            } catch (e) {
                showToast('Failed to attach microMODs', 'error');
            }
        });
    });
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

const buildMicromodRow = (mm, modifier) => {
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
        font-size: 10px;
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
    removeBtn.addEventListener('click', async () => {
        if (!modifier || !modifier.modifier_id) {
            showToast('Cannot remove — modifier missing', 'error');
            return;
        }
        const micromodId = mm.micromod_id || mm.modifier_id;
        if (!micromodId) {
            showToast('Cannot remove — micromod id missing', 'error');
            return;
        }
        const mmLabel = mm.name || micromodId;
        const modLabel = modifier.name || modifier.modifier_id;
        if (!window.confirm(`Remove ${mmLabel} from ${modLabel}?`)) return;
        try {
            await apiDelete(
                `/api/v1/modifiers/${encodeURIComponent(modifier.modifier_id)}` +
                `/micromods/${encodeURIComponent(micromodId)}`,
            );
            await refreshAll();
            showToast('MicroMOD removed');
        } catch (e) {
            showToast('Failed to remove microMOD', 'error');
        }
    });
    row.appendChild(removeBtn);

    return row;
}

const buildIncludedItemsSection = (modifier) => {
    const wrap = document.createElement('div');

    const label = document.createElement('div');
    label.textContent = 'Included in items';
    label.style.cssText = `
        font-family: ${T.fb};
        font-size: 10px;
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
                color: ${T.text};
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
const currentGroup = () => {
    if (!_state.selectedGroupId) return null;
    return _state.groups.find(g => g.group_id === _state.selectedGroupId) || null;
}

const currentModifier = (group) => {
    if (!group || !_state.selectedModifierId) return null;
    return (group.modifiers || []).find(m => m.modifier_id === _state.selectedModifierId) || null;
}

const optionGroupName = (id) => {
    if (!id) return null;
    const og = _state.optionGroups.find(o => o.option_group_id === id);
    return og ? og.name : null;
}

/* ============================================
   TAB BAR
============================================ */
const buildTabBar = () => {
    const bar = document.createElement('div');
    bar.style.cssText = `
        background: ${T.card};
        border-bottom: 1px solid rgba(255,255,255,0.05);
        padding: 0 20px;
        display: flex;
        gap: 0;
        flex-shrink: 0;
    `;

    const tabs = [
        { id: 'mod',         label: 'MOD GROUPS' },
        { id: 'micromod',    label: 'MICROMOD GROUPS' },
        { id: 'optionGroup', label: 'OPTION GROUPS' },
    ];
    tabs.forEach(t => bar.appendChild(buildTab(t.id, t.label)));
    return bar;
}

const buildTab = (id, label) => {
    const isActive = _state.activeTab === id;
    const tab = document.createElement('div');
    tab.textContent = label;
    tab.style.cssText = `
        padding: 14px 20px;
        font-family: ${T.fb};
        font-size: 11px;
        font-weight: 700;
        text-transform: uppercase;
        letter-spacing: 1.8px;
        color: ${isActive ? T.elec : T.moon};
        cursor: pointer;
        border-bottom: 2px solid ${isActive ? T.elec : 'transparent'};
        margin-bottom: -1px;
        transition: color 0.15s ease, border-color 0.15s ease;
    `;
    tab.addEventListener('click', () => {
        if (_state.activeTab === id) return;
        _state.activeTab = id;
        rebuild();
    });
    return tab;
}

/* ============================================
   MICROMOD GROUPS TAB
============================================ */
const buildMicromodTab = () => {
    const wrap = document.createElement('div');
    wrap.className = 'kindpos-scrollbar-hide';
    wrap.style.cssText = `
        flex: 1;
        min-height: 0;
        overflow-y: auto;
        scrollbar-width: none;
        -ms-overflow-style: none;
        padding: 14px;
        box-sizing: border-box;
    `;

    // Header row
    const header = document.createElement('div');
    header.style.cssText = 'display: flex; align-items: center; justify-content: space-between; margin-bottom: 14px;';

    const title = document.createElement('div');
    title.textContent = 'MICROMOD GROUPS';
    title.style.cssText = `
        font-family: ${T.fb};
        font-size: 11px;
        font-weight: 700;
        color: ${T.lavender};
        letter-spacing: 2.5px;
        text-transform: uppercase;
    `;
    header.appendChild(title);

    header.appendChild(buildPillButton('+ New MicroMOD Group', 'confirm', async () => {
        const name = window.prompt('New MicroMOD Group name');
        if (name == null) return;
        const trimmed = name.trim();
        if (!trimmed) return;
        try {
            await apiPost('/api/v1/modifier-groups', {
                name: trimmed,
                modifier_ids: [],
                modifiers: [],
                min_selections: 0,
                max_selections: 1,
                drives_pricing: false,
                template_id: 'micromod',
            });
            await refreshAll();
            showToast('MicroMOD group created');
        } catch (e) {
            showToast('Failed to create MicroMOD group', 'error');
        }
    }, { small: true }));
    wrap.appendChild(header);

    // Card grid
    const grid = document.createElement('div');
    grid.style.cssText = `
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
        gap: 14px;
        align-items: start;
    `;

    if (_state.loadError) {
        const errEl = buildErrorState(() => refreshAll());
        errEl.style.gridColumn = '1 / -1';
        grid.appendChild(errEl);
    } else if (_state.micromodGroups.length === 0) {
        const empty = document.createElement('div');
        empty.textContent = 'No microMOD groups yet';
        empty.style.cssText = `
            grid-column: 1 / -1;
            padding: 32px 0;
            text-align: center;
            font-family: ${T.fb};
            font-size: 11px;
            color: ${T.moon};
        `;
        grid.appendChild(empty);
    } else {
        _state.micromodGroups.forEach(g => grid.appendChild(buildMicromodGroupCard(g)));
    }
    wrap.appendChild(grid);
    return wrap;
}

const buildMicromodGroupCard = (group) => {
    const card = buildStaticCard({ accent: T.lavender });
    card.style.padding = '14px 16px 14px 22px';
    card.style.display = 'flex';
    card.style.flexDirection = 'column';
    card.style.gap = '12px';

    // Group name
    const nameEl = document.createElement('div');
    nameEl.textContent = group.name || group.group_id;
    nameEl.style.cssText = `
        font-family: ${T.fh};
        font-size: 15px;
        font-weight: 700;
        color: ${T.text};
    `;
    card.appendChild(nameEl);

    // ATTACHES TO
    card.appendChild(buildAttachesToSection(group));

    // DEFAULT OPTION GROUP select
    card.appendChild(buildDefaultOptionGroupSection(group));

    // Modifier chips
    card.appendChild(buildMicromodModifiersSection(group));

    return card;
}

const buildAttachesToSection = (group) => {
    const wrap = document.createElement('div');

    const label = document.createElement('div');
    label.textContent = 'ATTACHES TO';
    label.style.cssText = `
        font-family: ${T.fb};
        font-size: 9px;
        font-weight: 700;
        color: ${T.moon};
        letter-spacing: 2px;
        text-transform: uppercase;
        margin-bottom: 6px;
    `;
    wrap.appendChild(label);

    const chipRow = document.createElement('div');
    chipRow.style.cssText = 'display: flex; flex-wrap: wrap; gap: 6px;';

    const attachIds = attachesToModifierIds(group);
    if (attachIds.length === 0) {
        const dash = document.createElement('span');
        dash.textContent = '—';
        dash.style.cssText = `font-family: ${T.fb}; font-size: 11px; color: ${T.moon};`;
        chipRow.appendChild(dash);
    } else {
        attachIds.forEach(id => {
            const name = modifierNameById(id) || id;
            chipRow.appendChild(buildAttachChip(name));
        });
    }
    wrap.appendChild(chipRow);
    return wrap;
}

const buildAttachChip = (label) => {
    const chip = document.createElement('span');
    chip.textContent = label;
    chip.style.cssText = `
        display: inline-flex; align-items: center;
        background: ${T.card};
        color: ${T.lavender};
        border: 1px solid ${hexToRgba(T.lavender, 0.45)};
        border-radius: 5px;
        padding: 3px 9px;
        font-family: ${T.fb};
        font-size: 10px;
        font-weight: 700;
        letter-spacing: 0.04em;
        white-space: nowrap;
    `;
    return chip;
}

const buildDefaultOptionGroupSection = (group) => {
    const wrap = document.createElement('div');

    const label = document.createElement('div');
    label.textContent = 'DEFAULT OPTION GROUP';
    label.style.cssText = `
        font-family: ${T.fb};
        font-size: 9px;
        font-weight: 700;
        color: ${T.moon};
        letter-spacing: 2px;
        text-transform: uppercase;
        margin-bottom: 6px;
    `;
    wrap.appendChild(label);

    const sel = document.createElement('select');
    sel.style.cssText = `
        appearance: none;
        -webkit-appearance: none;
        background: ${T.well};
        border: 1px solid ${T.border};
        border-radius: 6px;
        color: ${T.lavender};
        font-family: ${T.fb};
        font-size: 12px;
        font-weight: 700;
        height: 32px;
        padding: 0 12px;
        cursor: pointer;
        outline: none;
        width: 100%;
        box-sizing: border-box;
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

    wrap.appendChild(sel);
    return wrap;
}

const buildMicromodModifiersSection = (group) => {
    const wrap = document.createElement('div');

    const label = document.createElement('div');
    label.textContent = 'MODIFIERS IN GROUP';
    label.style.cssText = `
        font-family: ${T.fb};
        font-size: 9px;
        font-weight: 700;
        color: ${T.moon};
        letter-spacing: 2px;
        text-transform: uppercase;
        margin-bottom: 6px;
    `;
    wrap.appendChild(label);

    const chipRow = document.createElement('div');
    chipRow.style.cssText = 'display: flex; flex-wrap: wrap; gap: 6px;';

    const modifiers = group.modifiers || [];
    if (modifiers.length === 0) {
        const dash = document.createElement('span');
        dash.textContent = '—';
        dash.style.cssText = `font-family: ${T.fb}; font-size: 11px; color: ${T.moon};`;
        chipRow.appendChild(dash);
    } else {
        modifiers.forEach(m => chipRow.appendChild(buildMicromodModifierChip(m)));
    }
    chipRow.appendChild(buildMicromodAddModifierChip(group));
    wrap.appendChild(chipRow);
    return wrap;
}

const buildMicromodAddModifierChip = (group) => {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.textContent = '+ ADD MODIFIER';
    chip.style.cssText = `
        background: transparent;
        border: 1px dashed ${hexToRgba(T.lavender, 0.6)};
        border-radius: 5px;
        padding: 3px 9px;
        font-family: ${T.fb};
        font-size: 9px;
        font-weight: 700;
        letter-spacing: 0.04em;
        color: ${T.lavender};
        cursor: pointer;
        outline: none;
    `;
    chip.addEventListener('click', () => {
        const currentIds = (group.modifiers || []).map(m => m.modifier_id);
        openModifierPickerInline(chip, currentIds, async (modifierId) => {
            try {
                await apiPost(
                    `/api/v1/modifier-groups/${encodeURIComponent(group.group_id)}` +
                    `/modifiers/${encodeURIComponent(modifierId)}`,
                );
                await refreshAll();
                showToast('Modifier added to group');
            } catch (e) {
                showToast('Failed to add modifier', 'error');
            }
        });
    });
    return chip;
}

const buildMicromodModifierChip = (modifier) => {
    const baseShadow = `0 4px 0 ${darkenHex(T.card, 0.35)}, inset 0 1px 0 rgba(255,255,255,0.08)`;
    const chip = document.createElement('div');
    chip.style.cssText = `
        position: relative;
        background: ${T.card};
        border-radius: 10px;
        padding: 6px 12px 6px 14px;
        display: inline-flex;
        align-items: center;
        gap: 6px;
        box-shadow: ${baseShadow};
    `;

    const accentBar = document.createElement('div');
    accentBar.style.cssText = `
        position: absolute;
        left: 0;
        top: 5px;
        bottom: 5px;
        width: 3px;
        border-radius: 0 2px 2px 0;
        background: ${T.lavender};
        box-shadow: 0 0 6px ${hexToRgba(T.lavender, 0.5)};
    `;
    chip.appendChild(accentBar);

    const nameEl = document.createElement('span');
    nameEl.textContent = modifier.name || modifier.modifier_id;
    nameEl.style.cssText = `
        font-family: ${T.fb};
        font-size: 12px;
        font-weight: 600;
        color: ${T.lavender};
    `;
    chip.appendChild(nameEl);
    return chip;
}

/* ------------------------------------------
   MICROMOD HELPERS
------------------------------------------ */
const isMicromodGroup = (g) => {
    if (!g || g.hidden) return false;
    const t = (g.template_id || '').toLowerCase();
    return t === 'micromod' || t.includes('micromod') || g.is_micromod === true;
}

const attachesToModifierIds = (group) => {
    if (Array.isArray(group.attaches_to_modifier_ids) && group.attaches_to_modifier_ids.length) {
        return group.attaches_to_modifier_ids.slice();
    }
    // Derive from MicroMod records: a MicroMod whose name matches this group's
    // name links its modifier_id to the group as an attachment.
    const groupName = (group.name || '').trim().toLowerCase();
    if (!groupName) return [];
    const ids = new Set();
    (_state.micromods || []).forEach(mm => {
        if ((mm.name || '').trim().toLowerCase() === groupName && mm.modifier_id) {
            ids.add(mm.modifier_id);
        }
    });
    return [...ids];
}

const modifierNameById = (id) => {
    if (!id) return null;
    for (const g of _state.groups) {
        const found = (g.modifiers || []).find(m => m.modifier_id === id);
        if (found) return found.name;
    }
    for (const g of _state.micromodGroups) {
        const found = (g.modifiers || []).find(m => m.modifier_id === id);
        if (found) return found.name;
    }
    return null;
}

/* ============================================
   RENDER + LIFECYCLE
============================================ */
const buildModTab = () => {
    const row = document.createElement('div');
    row.style.cssText = `
        display: flex;
        flex: 1;
        min-height: 0;
        overflow: hidden;
        gap: 14px;
        padding: 14px;
        align-items: stretch;
    `;
    row.appendChild(buildLeftPanel());
    row.appendChild(buildRightPanel());
    return row;
}

/* ============================================
   OPTION GROUPS TAB
============================================ */
const buildOptionGroupTab = () => {
    const wrap = document.createElement('div');
    wrap.className = 'kindpos-scrollbar-hide';
    wrap.style.cssText = `
        flex: 1;
        min-height: 0;
        overflow-y: auto;
        scrollbar-width: none;
        -ms-overflow-style: none;
        padding: 14px;
        box-sizing: border-box;
    `;

    // Full-width "+ Add Option Group" mint pill.
    const addBtn = buildPillButton('+ Add Option Group', 'confirm', () => {
        _state.addingOptionGroup = true;
        rebuild();
    }, { fullWidth: true });
    addBtn.style.marginBottom = '14px';
    wrap.appendChild(addBtn);

    if (_state.addingOptionGroup) {
        wrap.appendChild(buildOptionGroupAddPanel());
    }

    const list = document.createElement('div');
    list.style.cssText = 'display: flex; flex-direction: column; gap: 10px;';

    if (_state.loadError) {
        list.appendChild(buildErrorState(() => refreshAll()));
    } else if (_state.optionGroups.length === 0) {
        const empty = document.createElement('div');
        empty.textContent = 'No option groups yet — tap + Add';
        empty.style.cssText = `
            padding: 32px 0;
            text-align: center;
            font-family: ${T.fb};
            font-size: 11px;
            color: ${T.moon};
        `;
        list.appendChild(empty);
    } else {
        _state.optionGroups.forEach(og => list.appendChild(buildOptionGroupCard(og)));
    }
    wrap.appendChild(list);
    return wrap;
}

const buildOptionGroupAddPanel = () => {
    const panel = document.createElement('div');
    panel.style.cssText = `
        background: ${hexToRgba(T.lavender, 0.08)};
        border-radius: 8px;
        padding: 12px 14px;
        margin-bottom: 14px;
        display: flex;
        flex-direction: column;
        gap: 10px;
    `;

    const heading = document.createElement('div');
    heading.textContent = 'NEW OPTION GROUP';
    heading.style.cssText = `
        font-family: ${T.fb};
        font-size: 9px;
        font-weight: 700;
        color: ${T.lavender};
        letter-spacing: 0.16em;
        text-transform: uppercase;
    `;
    panel.appendChild(heading);

    const input = document.createElement('input');
    input.type = 'text';
    input.placeholder = 'e.g. Pizza Toppings';
    input.style.cssText = `
        padding: 7px 10px;
        background: ${T.bg};
        border: 1px solid ${hexToRgba(T.border, 0.5)};
        border-radius: ${T.chamferBtn}px;
        color: ${T.text};
        font-family: ${T.fb};
        font-size: 12px;
        outline: none;
        box-sizing: border-box;
    `;
    input.addEventListener('focus', () => { input.style.borderColor = T.lavender; });
    input.addEventListener('blur', () => {
        input.style.borderColor = hexToRgba(T.border, 0.5);
    });
    panel.appendChild(input);

    const row = document.createElement('div');
    row.style.cssText = 'display: flex; gap: 8px; justify-content: flex-end;';
    row.appendChild(buildPillButton('Cancel', 'tertiary', () => {
        _state.addingOptionGroup = false;
        rebuild();
    }, { small: true }));
    row.appendChild(buildPillButton('Create', 'confirm', async () => {
        const name = input.value.trim();
        if (!name) { showToast('Name is required', 'error'); return; }
        try {
            await apiPost('/api/v1/option-groups', { name, option_ids: [] });
            _state.addingOptionGroup = false;
            await refreshAll();
            showToast('Option group created');
        } catch (e) {
            showToast('Failed to create option group', 'error');
        }
    }, { small: true }));
    panel.appendChild(row);

    return panel;
}

const buildOptionGroupCard = (group) => {
    const card = buildStaticCard({ accent: T.lavender });
    card.style.padding = '14px 18px 14px 20px';
    card.style.display = 'flex';
    card.style.flexDirection = 'column';

    // Row 1 — name + active toggle.
    const row1 = document.createElement('div');
    row1.style.cssText = 'display: flex; align-items: center; gap: 10px;';

    const nameEl = document.createElement('div');
    nameEl.textContent = group.name || group.option_group_id;
    nameEl.style.cssText = `
        flex: 1;
        font-family: ${T.fh};
        font-size: 14px;
        font-weight: 700;
        color: ${T.text};
    `;
    row1.appendChild(nameEl);

    const toggle = buildToggle(group.active !== false, async (v) => {
        try {
            if (v) {
                await apiPatch(
                    `/api/v1/option-groups/${encodeURIComponent(group.option_group_id)}`,
                    { active: true },
                );
            } else {
                if (!window.confirm(`Deactivate option group "${group.name || group.option_group_id}"?`)) {
                    toggle.setValue(true);
                    return;
                }
                await apiDelete(`/api/v1/option-groups/${encodeURIComponent(group.option_group_id)}`);
            }
            await refreshAll();
        } catch (e) {
            toggle.setValue(!v);
            showToast('Failed to update option group', 'error');
        }
    });
    row1.appendChild(toggle);
    card.appendChild(row1);

    // Row 2 — option chips with remove + an add-option picker.
    const row2 = document.createElement('div');
    row2.style.cssText = 'display: flex; flex-wrap: wrap; gap: 6px; margin-top: 8px; align-items: center;';

    const optionsById = new Map((_state.options || []).map(o => [o.option_id, o]));
    const optionIds = group.option_ids || [];
    if (optionIds.length === 0) {
        const dash = document.createElement('span');
        dash.textContent = 'no options';
        dash.style.cssText = `
            font-family: ${T.fb};
            font-size: 9px;
            color: ${T.moon};
            font-style: italic;
        `;
        row2.appendChild(dash);
    } else {
        optionIds.forEach(oid => {
            const opt = optionsById.get(oid);
            if (!opt) return;
            row2.appendChild(buildOptionGroupChip(opt, async () => {
                try {
                    await apiDelete(
                        `/api/v1/option-groups/${encodeURIComponent(group.option_group_id)}` +
                        `/options/${encodeURIComponent(oid)}`,
                    );
                    await refreshAll();
                } catch (e) {
                    showToast('Failed to remove option', 'error');
                }
            }));
        });
    }

    row2.appendChild(buildOptionGroupAddOptionControl(group));
    card.appendChild(row2);

    // Row 3 — "Used by:" line.
    const row3 = document.createElement('div');
    row3.style.cssText = 'margin-top: 6px;';

    const usedByLabel = document.createElement('span');
    usedByLabel.textContent = 'Used by: ';
    usedByLabel.style.cssText = `
        font-family: ${T.fb};
        font-size: 9px;
        color: ${T.moon};
    `;
    row3.appendChild(usedByLabel);

    const consumers = findGroupsUsingOptionGroup(group.option_group_id);
    if (consumers.length === 0) {
        const dash = document.createElement('span');
        dash.textContent = '— unassigned —';
        dash.style.cssText = `
            font-family: ${T.fb};
            font-size: 9px;
            color: ${T.moonDk};
        `;
        row3.appendChild(dash);
    } else {
        const names = document.createElement('span');
        names.textContent = consumers.map(g => g.name || g.group_id).join(', ');
        names.style.cssText = `
            font-family: ${T.fb};
            font-size: 9px;
            color: ${T.elec};
        `;
        row3.appendChild(names);
    }
    card.appendChild(row3);

    return card;
}

const buildOptionGroupChip = (option, onRemove) => {
    const negates = !!option.negates_price;
    const baseColor = negates ? T.verm : T.lavender;
    const adj = Number(option.price_adjustment || 0);

    const chip = document.createElement('span');
    chip.style.cssText = `
        display: inline-flex;
        align-items: center;
        gap: 4px;
        background: ${T.card};
        color: ${baseColor};
        border: 1px solid ${baseColor};
        border-radius: 5px;
        padding: 3px 9px;
        font-family: ${T.fb};
        font-size: 9px;
        font-weight: 700;
        letter-spacing: 0.04em;
        white-space: nowrap;
    `;

    const nameSpan = document.createElement('span');
    nameSpan.textContent = option.name || option.option_id;
    chip.appendChild(nameSpan);

    if (adj !== 0) {
        const adjSpan = document.createElement('span');
        if (adj > 0) {
            adjSpan.textContent = '+$' + adj.toFixed(2);
            adjSpan.style.color = T.gold;
        } else {
            adjSpan.textContent = '−$' + Math.abs(adj).toFixed(2);
            adjSpan.style.color = T.verm;
        }
        chip.appendChild(adjSpan);
    }

    if (onRemove) {
        const x = document.createElement('button');
        x.type = 'button';
        x.textContent = '×';
        x.style.cssText = `
            background: transparent;
            border: none;
            color: ${baseColor};
            font-family: ${T.fb};
            font-size: 12px;
            line-height: 1;
            padding: 0 2px;
            margin-left: 2px;
            cursor: pointer;
            outline: none;
        `;
        x.addEventListener('click', (e) => {
            e.stopPropagation();
            onRemove();
        });
        chip.appendChild(x);
    }
    return chip;
}

const buildOptionGroupAddOptionControl = (group) => {
    const taken = new Set(group.option_ids || []);
    const candidates = (_state.options || []).filter(
        o => !taken.has(o.option_id) && o.active !== false,
    );

    const select = document.createElement('select');
    select.style.cssText = `
        appearance: none;
        -webkit-appearance: none;
        background: transparent;
        border: 1px dashed ${hexToRgba(T.lavender, 0.6)};
        border-radius: 5px;
        padding: 3px 9px;
        font-family: ${T.fb};
        font-size: 9px;
        font-weight: 700;
        letter-spacing: 0.04em;
        color: ${T.lavender};
        cursor: pointer;
        outline: none;
    `;
    const placeholder = document.createElement('option');
    placeholder.value = '';
    placeholder.textContent = candidates.length ? '+ ADD OPTION' : 'ALL OPTIONS ADDED';
    placeholder.disabled = candidates.length === 0;
    placeholder.selected = true;
    select.appendChild(placeholder);

    candidates.forEach(o => {
        const opt = document.createElement('option');
        opt.value = o.option_id;
        opt.textContent = o.name || o.option_id;
        select.appendChild(opt);
    });

    if (candidates.length === 0) select.disabled = true;

    select.addEventListener('change', async () => {
        const oid = select.value;
        if (!oid) return;
        try {
            await apiPost(
                `/api/v1/option-groups/${encodeURIComponent(group.option_group_id)}` +
                `/options/${encodeURIComponent(oid)}`,
            );
            await refreshAll();
        } catch (e) {
            showToast('Failed to add option', 'error');
            select.value = '';
        }
    });
    return select;
}

const findGroupsUsingOptionGroup = (ogId) => {
    if (!ogId) return [];
    const consumers = [];
    [..._state.groups, ..._state.micromodGroups].forEach(g => {
        if (g.default_option_group_id === ogId) consumers.push(g);
    });
    return consumers;
}

const rebuild = () => {
    if (!_state.contentMount) return;
    _state.contentMount.replaceChildren();
    if (_state.activeTab === 'micromod') {
        _state.contentMount.appendChild(buildMicromodTab());
    } else if (_state.activeTab === 'optionGroup') {
        _state.contentMount.appendChild(buildOptionGroupTab());
    } else {
        _state.contentMount.appendChild(buildModTab());
    }
    // Refresh tab bar so the active border updates.
    if (_state.tabBarMount) {
        _state.tabBarMount.replaceChildren(buildTabBar());
    }
}

const refreshAll = async () => {
    _state.loadError = false;
    let groups, micromodGroups, optionGroups, options, sizes, micromods, items;
    try {
        [groups, micromodGroups, optionGroups, options, sizes, micromods, items] = await Promise.all([
            apiGet('/api/v1/config/modifier-groups'),
            apiGetOptional('/api/v1/modifier-groups?type=micromod', []),
            apiGet('/api/v1/option-groups'),
            apiGet('/api/v1/options'),
            apiGetOptional('/api/v1/sizes', []),
            apiGetOptional('/api/v1/config/micromods', []),
            apiGetOptional('/api/v1/config/menu/items', []),
        ]);
    } catch (e) {
        console.error('[Modifiers] Refresh failed:', e);
        _state.loadError = true;
        _state.groups = [];
        _state.micromodGroups = [];
        _state.optionGroups = [];
        _state.options = [];
        _state.sizes = [];
        _state.micromods = [];
        _state.items = [];
        rebuild();
        return;
    }
    try {
        _state.groups = (groups || []).filter(g => !g.hidden && !isMicromodGroup(g));
        // If the backend honors ?type=micromod the response is the canonical
        // list. If not (filter is silently ignored), filter the same payload
        // by template_id on the client so the tab does not duplicate Mod Groups.
        const micromodSource = (Array.isArray(micromodGroups) && micromodGroups.length)
            ? micromodGroups
            : (groups || []);
        _state.micromodGroups = micromodSource.filter(g => !g.hidden && isMicromodGroup(g));
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
    _state.activeTab = 'mod';
    _state.selectedGroupId = null;
    _state.selectedModifierId = null;
    _state.showAddGroup = false;
    _state.addingOptionGroup = false;
    _state.editingGroupId = null;
    _state.loadError = false;

    container.replaceChildren();

    _state.wrapper = document.createElement('div');
    _state.wrapper.style.cssText = `
        display: flex;
        flex-direction: column;
        height: 100%;
        overflow: hidden;
        background: ${T.bg};
        box-sizing: border-box;
    `;
    container.appendChild(_state.wrapper);

    _state.tabBarMount = document.createElement('div');
    _state.tabBarMount.appendChild(buildTabBar());
    _state.wrapper.appendChild(_state.tabBarMount);

    _state.contentMount = document.createElement('div');
    _state.contentMount.style.cssText = 'flex: 1; min-height: 0; display: flex; flex-direction: column;';
    _state.wrapper.appendChild(_state.contentMount);

    rebuild();
    refreshAll().catch(e => console.error('[Modifiers] Initial load failed:', e));
}

export function cleanupModifierGroups(container) {
    if (container) container.replaceChildren();
    _state.container = null;
    _state.wrapper = null;
    _state.contentMount = null;
    _state.tabBarMount = null;
    _state.activeTab = 'mod';
    _state.groups = [];
    _state.micromodGroups = [];
    _state.optionGroups = [];
    _state.options = [];
    _state.sizes = [];
    _state.micromods = [];
    _state.items = [];
    _state.selectedGroupId = null;
    _state.selectedModifierId = null;
    _state.showAddGroup = false;
    _state.addingOptionGroup = false;
    _state.editingGroupId = null;
    _state.loadError = false;
}
