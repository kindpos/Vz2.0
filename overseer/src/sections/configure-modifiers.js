import { pushChanges } from '../services/config-push.js';

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
   MODULE STATE
------------------------------------------ */
let currentWrapper = null;
let modData = null;

// Single bucket. Modifier edits cascade into group events
// on save — no separate mandatory/universal bucket.
let pendingChanges = { modifiers: [], groups: [] };

let activeTab = 'modifiers'; // 'modifiers' | 'groups'
let searchState = { modifiers: '', groups: '' };
// 'all' | 'bundled' | 'orphan' — scoped to the Modifiers tab
let modifierFilter = 'all';

/* ------------------------------------------
   DATA FETCH
   Pulls from /menu (projection) + /config/menu/categories.
   Deduplicates modifiers across groups into a flat
   master list. No mandatory/universal fetches
   since those endpoints no longer exist.
------------------------------------------ */
async function fetchModifierData() {
    try {
        const [menuRes, catRes] = await Promise.all([
            fetch('/api/v1/menu'),
            fetch('/api/v1/config/menu/categories'),
        ]);
        const menu = menuRes.ok ? await menuRes.json() : { modifier_groups: [] };
        const cats = catRes.ok ? await catRes.json() : [];

        const modifiersById = new Map();
        const groups = [];

        for (const grp of (menu.modifier_groups || [])) {
            // Skip any legacy hidden per-item groups from the old
            // "included_<item_id>" pattern. These will disappear
            // entirely once the new menu-categories.js lands.
            if (grp.hidden) continue;

            const mods = grp.modifiers || [];
            const subcatMods = (grp.subcats || []).flatMap(sc => sc.modifiers || []);
            const allGrpMods = [...mods, ...subcatMods];

            for (const m of allGrpMods) {
                const mid = m.modifier_id || m.id;
                if (!mid) continue;
                if (!modifiersById.has(mid)) {
                    modifiersById.set(mid, {
                        id: mid,
                        name: m.name || mid,
                        base_price: parseFloat(m.price) || 0,
                        included_modifier_ids: Array.isArray(m.included_modifier_ids)
                            ? [...m.included_modifier_ids]
                            : [],
                    });
                } else if (Array.isArray(m.included_modifier_ids) && m.included_modifier_ids.length) {
                    const existing = modifiersById.get(mid);
                    const merged = new Set([...existing.included_modifier_ids, ...m.included_modifier_ids]);
                    existing.included_modifier_ids = Array.from(merged);
                }
            }

            const priceByOptionMap = {};
            allGrpMods.forEach(m => {
                const mid = m.modifier_id || m.id;
                if (m.price_by_option && Object.keys(m.price_by_option).length > 0) {
                    priceByOptionMap[mid] = m.price_by_option;
                }
            });

            groups.push({
                id: grp.group_id || grp.id,
                name: grp.name || '',
                modifier_ids: allGrpMods.map(m => m.modifier_id || m.id).filter(Boolean),
                min_selections: grp.min_selections ?? 0,
                max_selections: grp.max_selections ?? 1,
                drives_pricing: !!grp.drives_pricing,
                price_by_option_map: priceByOptionMap,
                color: grp.color || null,
                category_id: grp.category_id || null,
            });
        }

        return {
            modifiers: Array.from(modifiersById.values()).sort((a, b) => a.name.localeCompare(b.name)),
            groups: groups.sort((a, b) => a.name.localeCompare(b.name)),
            categories: cats.map(c => ({
                id: c.category_id || c.id,
                name: c.name || c.label,
            })),
        };
    } catch (e) {
        console.warn('[ConfigureModifiers] Failed to fetch data:', e);
        return { modifiers: [], groups: [], categories: [] };
    }
}

const EMPTY_DATA = { modifiers: [], groups: [], categories: [] };

/* ------------------------------------------
   SMALL UTILS
------------------------------------------ */
function clone(obj) { return JSON.parse(JSON.stringify(obj)); }
function formatPrice(p) { return '$' + Number(p || 0).toFixed(2); }

function getPendingCount() {
    return (pendingChanges.modifiers || []).length + (pendingChanges.groups || []).length;
}

function getAllWorking(collection) {
    const base = modData[collection] || [];
    const pending = pendingChanges[collection] || [];
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

function trackChange(collection, item) {
    if (!pendingChanges[collection]) pendingChanges[collection] = [];
    const idx = pendingChanges[collection].findIndex(x => x.id === item.id);
    if (idx >= 0) pendingChanges[collection][idx] = item;
    else pendingChanges[collection].push(item);
    updateFooter();
}

function handleDeleteItem(collection, id) {
    if (!pendingChanges[collection]) pendingChanges[collection] = [];
    const idx = pendingChanges[collection].findIndex(x => x.id === id);
    if (idx >= 0) {
        pendingChanges[collection][idx]._deleted = true;
    } else {
        pendingChanges[collection].push({ id, _deleted: true });
    }
    updateFooter();
}

/* ------------------------------------------
   PRIMITIVE HELPERS — Nostalgia vocabulary.
------------------------------------------ */

function buildCard(accent, opts = {}) {
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

function buildLabel(text, opts = {}) {
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

function buildPillButton(label, variant, onClick, opts = {}) {
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

function buildTextInput(value, opts = {}) {
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

function buildToggle(initial, onChange, opts = {}) {
    let state = !!initial;
    const wrap = document.createElement('button');
    wrap.type = 'button';
    wrap.style.cssText = `
        width: 44px; height: 24px;
        border-radius: 999px;
        background: ${state ? C.greenUp : C.well};
        border: 1px solid ${state ? C.greenUp : C.hairline};
        position: relative;
        cursor: pointer;
        transition: background 0.15s ease;
        outline: none;
        ${opts.disabled ? 'opacity: 0.4; cursor: not-allowed;' : ''}
    `;
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

    wrap.setValue = (v) => {
        state = !!v;
        wrap.style.background = state ? C.greenUp : C.well;
        wrap.style.borderColor = state ? C.greenUp : C.hairline;
        knob.style.left = state ? '22px' : '2px';
        knob.style.background = state ? C.well : C.textMuted;
    };
    wrap.getValue = () => state;
    wrap.setDisabled = (d) => {
        wrap.style.opacity = d ? '0.4' : '1';
        wrap.style.cursor = d ? 'not-allowed' : 'pointer';
        wrap.disabled = !!d;
    };

    if (!opts.disabled) {
        wrap.addEventListener('click', () => {
            wrap.setValue(!state);
            if (onChange) onChange(state);
        });
    }
    return wrap;
}

function showToast(message, kind = 'confirm') {
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
   destroying it.
------------------------------------------ */
const modalStack = [];

function openModal(titleText, contentBuilder, opts = {}) {
    const overlay = document.createElement('div');
    overlay.style.cssText = `
        position: fixed; inset: 0;
        background: rgba(0,0,0,0.6);
        z-index: ${500 + modalStack.length * 10};
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

    modalStack.push(overlay);
    contentBuilder(body, modal);
}

/**
 * Close a modal. Without an argument, closes the topmost modal. With an
 * overlay arg, closes that specific modal (used by per-modal dismiss
 * handlers). Safe to call when the stack is empty.
 */
function closeModal(specificOverlay) {
    if (modalStack.length === 0) return;
    const target = specificOverlay || modalStack[modalStack.length - 1];
    const idx = modalStack.indexOf(target);
    if (idx === -1) return;
    modalStack.splice(idx, 1);
    if (target.parentNode) target.remove();
}

function closeAllModals() {
    while (modalStack.length > 0) {
        const overlay = modalStack.pop();
        if (overlay.parentNode) overlay.remove();
    }
}

function buildModalField(container, labelText, type, value, opts = {}) {
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

function buildModalFooter(container, onSave, opts = {}) {
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

/* ------------------------------------------
   MULTI-SELECT PICKER
   Chip tray + "+ Add" that opens a picker modal
   with three-state checks, search, and delta footer.
   Used by both Group editor (pick modifiers for group)
   and Modifier editor (pick microMODs).
------------------------------------------ */

function buildChipTray(container, initialIds, sourceFn, opts = {}) {
    const state = { ids: [...(initialIds || [])] };
    const tray = document.createElement('div');
    tray.style.cssText = `
        display: flex; flex-wrap: wrap; gap: 6px;
        margin-bottom: 10px;
        min-height: 36px;
        padding: 8px;
        background: ${C.well};
        border-radius: 6px;
        border: 1px dashed ${C.hairline};
    `;

    function render() {
        tray.innerHTML = '';
        if (state.ids.length === 0) {
            const empty = document.createElement('div');
            empty.textContent = opts.emptyHint || 'None selected — tap + to add';
            empty.style.cssText = `
                font-family: ui-monospace, monospace;
                font-size: 11px;
                color: ${C.textDim};
                padding: 4px 6px;
                letter-spacing: 1.5px;
                text-transform: uppercase;
                font-weight: 700;
            `;
            tray.appendChild(empty);
            return;
        }
        const all = sourceFn();
        state.ids.forEach(id => {
            const modifier = all.find(a => a.id === id);
            const chip = document.createElement('span');
            chip.style.cssText = `
                display: inline-flex; align-items: center; gap: 6px;
                padding: 5px 6px 5px 10px;
                background: ${C.card};
                border: 1px solid ${opts.accent || C.green};
                border-radius: 999px;
                font-family: system-ui, sans-serif;
                font-size: 12px;
                font-weight: 600;
                color: ${C.text};
            `;
            const nameSpan = document.createElement('span');
            nameSpan.textContent = modifier ? modifier.name : id;
            chip.appendChild(nameSpan);

            if (modifier && modifier.extra) {
                const extra = document.createElement('span');
                extra.textContent = modifier.extra;
                extra.style.cssText = `color: ${C.gold}; font-family: ui-monospace, monospace; font-size: 11px;`;
                chip.appendChild(extra);
            }

            const x = document.createElement('button');
            x.type = 'button';
            x.textContent = '×';
            x.style.cssText = `
                background: transparent; border: none;
                color: ${C.textMuted}; cursor: pointer;
                font-size: 14px; line-height: 1;
                padding: 0 4px;
            `;
            x.addEventListener('click', () => {
                state.ids = state.ids.filter(i => i !== id);
                render();
                if (opts.onChange) opts.onChange(state.ids);
            });
            chip.appendChild(x);
            tray.appendChild(chip);
        });
    }

    container.appendChild(tray);

    const addBtn = buildPillButton(opts.addLabel || '+ Add', 'secondary', () => {
        openPickerModal(state.ids, sourceFn, opts, (newIds) => {
            state.ids = newIds;
            render();
            if (opts.onChange) opts.onChange(state.ids);
        });
    }, { small: true });
    container.appendChild(addBtn);

    render();
    return state;
}

function openPickerModal(currentIds, sourceFn, opts, onDone) {
    const excluded = opts.excludeIds ? new Set(opts.excludeIds()) : new Set();
    const all = sourceFn().filter(a => !excluded.has(a.id));

    openModal(opts.pickerTitle || 'Pick modifiers', (body) => {
        const selected = new Set(currentIds);
        const originallySelected = new Set(currentIds);

        const searchWrap = document.createElement('div');
        searchWrap.style.cssText = 'margin-bottom: 14px;';
        const search = buildTextInput('', { placeholder: 'Search…' });
        searchWrap.appendChild(search);
        body.appendChild(searchWrap);

        const list = document.createElement('div');
        list.style.cssText = `
            max-height: 360px;
            overflow-y: auto;
            display: flex; flex-direction: column; gap: 4px;
            margin-bottom: 14px;
        `;
        body.appendChild(list);

        function renderList() {
            list.innerHTML = '';
            const q = search.value.trim().toLowerCase();
            const filtered = q
                ? all.filter(a => a.name.toLowerCase().includes(q))
                : all;

            if (filtered.length === 0) {
                const empty = document.createElement('div');
                empty.textContent = q ? 'No matches' : 'No modifiers available';
                empty.style.cssText = `
                    font-family: ui-monospace, monospace;
                    font-size: 12px;
                    color: ${C.textDim};
                    text-align: center;
                    padding: 24px 0;
                    letter-spacing: 1.5px;
                    text-transform: uppercase;
                `;
                list.appendChild(empty);
                return;
            }

            filtered.forEach(modifier => {
                const isSelected = selected.has(modifier.id);
                const wasSelected = originallySelected.has(modifier.id);
                const row = document.createElement('button');
                row.type = 'button';
                row.style.cssText = `
                    display: flex; align-items: center; gap: 12px;
                    padding: 10px 14px;
                    background: ${isSelected && !wasSelected ? 'rgba(74,222,128,0.08)'
                                : !isSelected && wasSelected ? 'rgba(232,71,42,0.08)'
                                : C.well};
                    border: 1px solid ${isSelected && !wasSelected ? C.greenUp
                                      : !isSelected && wasSelected ? C.verm
                                      : 'transparent'};
                    border-left: 3px solid ${isSelected ? C.green : 'transparent'};
                    border-radius: 6px;
                    cursor: pointer;
                    width: 100%;
                    text-align: left;
                    font-family: system-ui, sans-serif;
                    transition: background 0.1s ease;
                `;

                const box = document.createElement('div');
                box.style.cssText = `
                    width: 18px; height: 18px;
                    border: 2px solid ${isSelected ? C.green : C.textDim};
                    border-radius: 4px;
                    display: flex; align-items: center; justify-content: center;
                    background: ${isSelected ? C.green : 'transparent'};
                    flex-shrink: 0;
                `;
                if (isSelected) {
                    box.innerHTML = `<span style="color: ${C.well}; font-size: 13px; font-weight: 900;">✓</span>`;
                }
                row.appendChild(box);

                const name = document.createElement('span');
                name.textContent = modifier.name;
                name.style.cssText = `
                    flex: 1;
                    color: ${C.text};
                    font-size: 14px;
                    font-weight: 600;
                `;
                row.appendChild(name);

                if (modifier.extra) {
                    const extra = document.createElement('span');
                    extra.textContent = modifier.extra;
                    extra.style.cssText = `
                        color: ${C.gold};
                        font-family: ui-monospace, monospace;
                        font-size: 12px;
                    `;
                    row.appendChild(extra);
                }

                if (isSelected && !wasSelected) {
                    const badge = document.createElement('span');
                    badge.textContent = '+ NEW';
                    badge.style.cssText = `
                        font-family: ui-monospace, monospace;
                        font-size: 9px;
                        color: ${C.greenUp};
                        letter-spacing: 1.5px;
                        font-weight: 700;
                    `;
                    row.appendChild(badge);
                } else if (!isSelected && wasSelected) {
                    const badge = document.createElement('span');
                    badge.textContent = '− REMOVE';
                    badge.style.cssText = `
                        font-family: ui-monospace, monospace;
                        font-size: 9px;
                        color: ${C.verm};
                        letter-spacing: 1.5px;
                        font-weight: 700;
                    `;
                    row.appendChild(badge);
                }

                row.addEventListener('click', () => {
                    if (selected.has(modifier.id)) selected.delete(modifier.id);
                    else selected.add(modifier.id);
                    renderList();
                    renderDelta();
                });

                list.appendChild(row);
            });
        }

        const delta = document.createElement('div');
        delta.style.cssText = `
            padding: 10px 14px;
            background: ${C.well};
            border-radius: 6px;
            font-family: ui-monospace, monospace;
            font-size: 11px;
            letter-spacing: 1.5px;
            text-transform: uppercase;
            font-weight: 700;
            color: ${C.textMuted};
            margin-bottom: 14px;
        `;
        function renderDelta() {
            const added = [...selected].filter(id => !originallySelected.has(id)).length;
            const removed = [...originallySelected].filter(id => !selected.has(id)).length;
            const unchanged = [...selected].filter(id => originallySelected.has(id)).length;
            const parts = [];
            if (added > 0) parts.push(`<span style="color:${C.greenUp}">+${added} added</span>`);
            if (removed > 0) parts.push(`<span style="color:${C.verm}">−${removed} removed</span>`);
            if (parts.length === 0) parts.push(`<span style="color:${C.textDim}">no changes</span>`);
            parts.push(`<span style="color:${C.textDim}">· ${unchanged + added} total</span>`);
            delta.innerHTML = parts.join('  ');
        }
        body.appendChild(delta);
        renderDelta();

        search.addEventListener('input', renderList);
        renderList();

        buildModalFooter(body, () => {
            onDone(Array.from(selected));
            closeModal();
        }, { saveLabel: 'Apply' });
    }, { wide: true, accent: opts.accent || C.green });
}

/* ============================================
   MAIN VIEW
============================================ */

function buildMainView(wrapper) {
    wrapper.innerHTML = '';

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

    if (activeTab === 'modifiers') buildModifiersTab(content);
    else buildGroupsTab(content);

    // Footer
    buildFooter(wrapper);
}

function buildTabBar(wrapper) {
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
        const isActive = activeTab === t.id;
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
            activeTab = t.id;
            buildMainView(currentWrapper);
        });
        bar.appendChild(tab);
    });
    wrapper.appendChild(bar);
}

function buildSearchBar(container, collection, onChange) {
    const wrap = document.createElement('div');
    wrap.style.cssText = 'margin-bottom: 14px;';
    const input = buildTextInput(searchState[collection] || '', {
        placeholder: `Search ${collection}…`,
    });
    input.addEventListener('input', () => {
        searchState[collection] = input.value;
        onChange();
    });
    wrap.appendChild(input);
    container.appendChild(wrap);
}

/* ============================================
   MODIFIERS TAB (modifier master list)
============================================ */

function buildModifiersTab(container) {
    container.innerHTML = '';

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
function buildModifierFilterRow(container, onChange) {
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
        const isActive = modifierFilter === opt.id;
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
            modifierFilter = opt.id;
            rebuild();
        });

        row.appendChild(chip);
    });

    // Clear link — only visible when filter is non-default
    if (modifierFilter !== 'all') {
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
            modifierFilter = 'all';
            rebuild();
        });
        row.appendChild(clear);
    }

    // First-time mount: append to container. Rebuilds replace via row.replaceWith.
    if (!row.parentNode) container.appendChild(row);
    return row;
}

function renderModifierList(list) {
    list.innerHTML = '';
    const modifiers = getAllWorking('modifiers');
    const groups = getAllWorking('groups');
    const q = (searchState.modifiers || '').trim().toLowerCase();

    // Search + filter compose via AND. Search first (cheap string match),
    // filter second (needs group-membership lookup for orphans).
    let filtered = q ? modifiers.filter(a => a.name.toLowerCase().includes(q)) : modifiers;
    if (modifierFilter === 'bundled') {
        filtered = filtered.filter(a => (a.included_modifier_ids || []).length > 0);
    } else if (modifierFilter === 'orphan') {
        filtered = filtered.filter(a => !groups.some(g => (g.modifier_ids || []).includes(a.id)));
    }

    if (filtered.length === 0) {
        const empty = document.createElement('div');
        let msg;
        if (modifiers.length === 0) msg = 'No modifiers yet — create one to get started';
        else if (modifierFilter === 'bundled') msg = q ? 'No bundled matches' : 'No bundled modifiers';
        else if (modifierFilter === 'orphan')  msg = q ? 'No orphan matches'  : 'No orphan modifiers — everything is wired up';
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

function openModifierModal(existing) {
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
            buildMainView(currentWrapper);
        }, {
            saveLabel: isEdit ? 'Save' : 'Create',
            extraLeft: deleteBtn,
        });
    }, { accent: C.green, wide: false });
}

function countGroupRefs(atomId) {
    return getAllWorking('groups').filter(g => (g.modifier_ids || []).includes(atomId)).length;
}

function openOverrideModal(modifier, driverAtoms, existingOverrides, onSave) {
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

function buildGroupsTab(container) {
    container.innerHTML = '';

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

function renderGroupList(list) {
    list.innerHTML = '';
    const groups = getAllWorking('groups');
    const modifiers = getAllWorking('modifiers');
    const q = (searchState.groups || '').trim().toLowerCase();
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

function openGroupModal(existing) {
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

            const lines = [];
            const issues = [];

            // Wire type
            if (min >= 1) {
                lines.push(`<span style="color:${C.gold}">■</span> MANDATORY-WIREABLE — wire to items via their edit modal`);
            } else {
                lines.push(`<span style="color:${C.cyan}">■</span> UNIVERSAL-WIREABLE — wire to categories via their edit modal`);
            }

            // Selection shape
            if (max === 1) {
                lines.push(`<span style="color:${C.text}">◆</span> Single-select: panel auto-dismisses on pick`);
            } else {
                lines.push(`<span style="color:${C.text}">◆</span> Multi-select: checklist with DONE, picks 0 or more up to ${max}`);
            }

            // Drives pricing
            if (draft.drives_pricing) {
                if (max === 1) {
                    lines.push(`<span style="color:${C.gold}">💲</span> Drives pricing on optional modifiers`);
                } else {
                    issues.push(`drives_pricing requires max = 1 (can't price off a multi-select)`);
                }
            }

            // Validation issues
            if (modifierCount === 0) {
                issues.push(`no modifiers wired yet`);
            }
            if (max < min) {
                issues.push(`max (${max}) must be ≥ min (${min})`);
            }
            if (max > modifierCount && modifierCount > 0) {
                issues.push(`max (${max}) exceeds modifier count (${modifierCount})`);
            }
            if (min > modifierCount) {
                issues.push(`min (${min}) exceeds modifier count (${modifierCount})`);
            }

            const linesHtml = lines.join('<br>');
            const issuesHtml = issues.length
                ? `<div style="margin-top:8px;color:${C.warning}"><strong>⚠ ${issues.join(' · ')}</strong></div>`
                : '';
            hintBox.innerHTML = linesHtml + issuesHtml;

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
            overrideSection.innerHTML = '';
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
                    buildMainView(currentWrapper);
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

            draft.name = name;
            draft.min_selections = min;
            draft.max_selections = max;

            trackChange('groups', draft);
            closeModal();
            buildMainView(currentWrapper);
        }, {
            saveLabel: isEdit ? 'Save' : 'Create',
            extraLeft: deleteBtn,
        });
    }, { accent: C.gold, wide: true });
}

/* ============================================
   FOOTER + SAVE
============================================ */

function buildFooter(wrapper) {
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
                pendingChanges = { modifiers: [], groups: [] };
                buildMainView(currentWrapper);
            }
        );
    }, { small: true }));

    const saveBtn = buildPillButton('Save Changes', 'confirm', handleSaveChanges, { small: true });
    saveBtn.id = 'configure-modifiers-save-btn';
    btnRow.appendChild(saveBtn);

    footer.appendChild(btnRow);
    wrapper.appendChild(footer);

    updateFooter();
}

function updateFooter() {
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

/**
 * Save orchestrator.
 *
 * Strategy:
 *   1. Collect dirty group IDs — explicit group edits AND any groups
 *      containing a changed modifier.
 *   2. For each dirty group, rebuild its modifiers[] payload from
 *      current modifier state (merging pending modifier changes so microMOD
 *      + name + price ride through).
 *   3. Emit modifier.group_created / _updated / _deleted for each.
 *   4. No modifier-level events are emitted — modifiers exist only inside
 *      groups in the backend projection.
 *
 * Orphan modifiers (in pendingChanges.modifiers but not referenced by any
 * group) produce no events and are dropped silently on next reload.
 * The Modifiers tab shows ⚠ NO GROUP badges so operators can catch this.
 */
async function handleSaveChanges() {
    if (getPendingCount() === 0) return;

    const events = [];

    // 1. Collect dirty group IDs
    const dirtyGroupIds = new Set();
    (pendingChanges.groups || []).forEach(g => dirtyGroupIds.add(g.id));
    (pendingChanges.modifiers || []).forEach(modifier => {
        const allGroups = getAllWorking('groups');
        allGroups.forEach(g => {
            if ((g.modifier_ids || []).includes(modifier.id)) {
                dirtyGroupIds.add(g.id);
            }
        });
    });

    // 2+3. Emit events per dirty group
    const orphanedModifierIds = [];
    dirtyGroupIds.forEach(gid => {
        const pendingG = (pendingChanges.groups || []).find(g => g.id === gid);
        const baseG = (modData.groups || []).find(g => g.id === gid);

        if (pendingG?._deleted) {
            events.push({ event_type: 'modifier.group_deleted', payload: { group_id: gid } });
            return;
        }

        const g = pendingG || baseG;
        if (!g) return;

        const isNew = !baseG;
        // Build modifiers[] using current modifier state
        const modifiers = getAllWorking('modifiers');
        const modifiers = (g.modifier_ids || []).map(mid => {
            const modifier = modifiers.find(a => a.id === mid);
            if (!modifier) return null;
            const base = {
                modifier_id: mid,
                name: modifier.name,
                price: modifier.base_price || 0,
            };
            if (modifier.included_modifier_ids && modifier.included_modifier_ids.length > 0) {
                base.included_modifier_ids = modifier.included_modifier_ids.slice();
            }
            const overrides = (g.price_by_option_map || {})[mid];
            if (overrides && Object.keys(overrides).length > 0) {
                base.price_by_option = overrides;
            }
            return base;
        }).filter(Boolean);

        events.push({
            event_type: isNew ? 'modifier.group_created' : 'modifier.group_updated',
            payload: {
                group_id: gid,
                name: g.name,
                modifier_ids: g.modifier_ids || [],
                modifiers,
                min_selections: g.min_selections ?? 0,
                max_selections: g.max_selections ?? 1,
                drives_pricing: !!g.drives_pricing,
            },
        });
    });

    // Detect orphaned modifiers (for warning)
    (pendingChanges.modifiers || []).forEach(modifier => {
        if (modifier._deleted) return;
        const allGroups = getAllWorking('groups');
        const referenced = allGroups.some(g => (g.modifier_ids || []).includes(modifier.id));
        if (!referenced && !(modData.modifiers || []).some(a => a.id === modifier.id)) {
            orphanedModifierIds.push(modifier.id);
        }
    });

    if (events.length === 0 && orphanedModifierIds.length > 0) {
        showToast(`${orphanedModifierIds.length} modifier(s) not in any group — add them to a group to persist`, 'warning');
        return;
    }

    if (events.length === 0) {
        showToast('No events to push', 'warning');
        return;
    }

    try {
        const result = await pushChanges(events);
        if (!result || !result.ok) {
            showToast('Failed to save changes', 'error');
            return;
        }
    } catch (e) {
        console.error('[ConfigureModifiers] Save failed:', e);
        showToast('Failed to save changes', 'error');
        return;
    }

    // Apply pending to base data
    const modifiers = getAllWorking('modifiers');
    modData.modifiers = modifiers;

    (pendingChanges.groups || []).forEach(g => {
        if (g._deleted) {
            modData.groups = (modData.groups || []).filter(x => x.id !== g.id);
        } else {
            const idx = (modData.groups || []).findIndex(x => x.id === g.id);
            if (idx >= 0) modData.groups[idx] = clone(g);
            else modData.groups.push(clone(g));
        }
    });

    pendingChanges = { modifiers: [], groups: [] };
    buildMainView(currentWrapper);

    const msg = orphanedModifierIds.length > 0
        ? `${events.length} saved · ${orphanedModifierIds.length} orphan modifier(s) not persisted`
        : `${events.length} change${events.length === 1 ? '' : 's'} saved`;
    showToast(msg, orphanedModifierIds.length > 0 ? 'warning' : 'confirm');
}

/* ============================================
   CONFIRM DIALOG
============================================ */

function showConfirmDialog(title, message, confirmLabel, onConfirm) {
    openModal(title, (body) => {
        const msg = document.createElement('div');
        msg.textContent = message;
        msg.style.cssText = `
            font-family: system-ui, sans-serif;
            font-size: 14px;
            color: ${C.text};
            line-height: 1.6;
            margin-bottom: 10px;
        `;
        body.appendChild(msg);

        const footer = document.createElement('div');
        footer.style.cssText = `
            display: flex; gap: 10px; justify-content: flex-end;
            margin-top: 20px;
            padding-top: 16px;
            border-top: 1px solid ${C.hairline};
        `;
        footer.appendChild(buildPillButton('Cancel', 'tertiary', closeModal, { small: true }));
        footer.appendChild(buildPillButton(confirmLabel, 'danger', () => {
            closeModal();
            onConfirm();
        }, { small: true }));
        body.appendChild(footer);
    }, { accent: C.verm, wide: false });
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

            modData = await fetchModifierData();
            pendingChanges = { modifiers: [], groups: [] };
            activeTab = 'modifiers';
            searchState = { modifiers: '', groups: '' };
            modifierFilter = 'all';

            currentWrapper = document.createElement('div');
            currentWrapper.style.cssText = `
                max-width: 1100px;
                margin: 0 auto;
                padding: 24px 20px 40px 20px;
                background: ${C.bg};
                min-height: 100%;
            `;
            container.appendChild(currentWrapper);

            buildMainView(currentWrapper);

            console.log(`[ConfigureModifiers] Loaded ${modData.modifiers.length} modifiers, ${modData.groups.length} groups.`);
            console.log('[ConfigureModifiers] Ready.');
        },
        onExit(container) {
            currentWrapper = null;
            modData = null;
            pendingChanges = { modifiers: [], groups: [] };
            if (container) container.innerHTML = '';
            closeAllModals();
        },
    });
}