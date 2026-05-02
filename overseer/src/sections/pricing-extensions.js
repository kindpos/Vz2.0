/* ============================================
   KINDpos Overseer — Pricing-chain Extensions

   Appends NEW collapsible sections to the existing
   item and category editors without touching the
   legacy form code.

   Item sections (4):
     1. Item Base by Size  — drives_pricing-aware grid
     2. Mandatory Groups   — buildStaticCard (T.gold)
     3. Included Modifiers — buildStaticCard (T.elec)
     4. Overrides          — option-group + size-price (T.moon)

   Category sections (2):
     1. Universal Groups   — chip multi-select (T.green)
     2. Enable Placement   — toggle (T.greenWarm / T.moonDk)

   All visual values flow from common/tokens.js. No
   hardcoded hex anywhere in this file.
   ============================================ */

import { T } from '../../../common/tokens.js';
import {
    buildStaticCard,
    hexToRgba,
    darkenHex,
} from '../../../common/theme.js';

/* ============================================
   API
============================================ */
async function apiGet(url) {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`GET ${url} → ${res.status}`);
    return res.json();
}
async function apiPut(url, body) {
    const res = await fetch(url, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: body == null ? undefined : JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`PUT ${url} → ${res.status}`);
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
async function apiOptional(url, fallback) {
    try { return await apiGet(url); }
    catch (e) { console.warn(`[PricingExtensions] ${url} unavailable:`, e.message); return fallback; }
}

/* ============================================
   TOAST
============================================ */
function toast(msg, kind = 'ok') {
    const el = document.createElement('div');
    const bg = kind === 'error' ? T.verm : T.greenWarm;
    el.textContent = msg;
    el.style.cssText = `
        position: fixed; top: 24px; right: 24px;
        padding: 10px 18px;
        background: ${bg};
        color: ${T.well};
        font-family: ${T.fb};
        font-size: ${T.fsB4};
        font-weight: ${T.fwBold};
        border-radius: 999px;
        z-index: 12000;
        box-shadow: 0 6px 20px rgba(0,0,0,0.4);
    `;
    document.body.appendChild(el);
    setTimeout(() => {
        el.style.opacity = '0';
        el.style.transition = 'opacity 0.3s ease';
        setTimeout(() => el.remove(), 300);
    }, 2200);
}

/* ============================================
   PRIMITIVES
============================================ */
function fmtPrice(n) { return '$' + Number(n || 0).toFixed(2); }

function makeLabel(text, color) {
    const el = document.createElement('div');
    el.textContent = text;
    el.style.cssText = `
        font-family: ${T.fb};
        font-size: 10px;
        font-weight: ${T.fwBold};
        color: ${color || T.green};
        letter-spacing: 0.18em;
        text-transform: uppercase;
        margin-bottom: 6px;
    `;
    return el;
}

function makeNote(text, color) {
    const el = document.createElement('div');
    el.textContent = text;
    el.style.cssText = `
        font-family: ${T.fb};
        font-size: ${T.fsB4};
        color: ${color || T.moon};
        line-height: 1.5;
        margin-bottom: 8px;
    `;
    return el;
}

function makeChip(text, color, opts = {}) {
    const wrap = document.createElement('span');
    wrap.style.cssText = `
        display: inline-flex; align-items: center; gap: 6px;
        padding: 5px 12px;
        background: ${hexToRgba(color, 0.12)};
        color: ${color};
        border: 1px solid ${hexToRgba(color, 0.4)};
        border-radius: 999px;
        font-family: ${T.fb};
        font-size: ${T.fsB4};
        font-weight: ${T.fwBold};
        letter-spacing: 0.04em;
    `;
    const label = document.createElement('span');
    label.textContent = text;
    wrap.appendChild(label);

    if (opts.onRemove) {
        const x = document.createElement('button');
        x.type = 'button';
        x.textContent = '×';
        x.style.cssText = `
            background: transparent;
            border: none;
            color: ${color};
            font-size: ${T.fsB3};
            line-height: 1;
            padding: 0 2px;
            cursor: pointer;
            font-family: ${T.fb};
            opacity: 0.7;
        `;
        x.addEventListener('click', (e) => { e.stopPropagation(); opts.onRemove(); });
        x.addEventListener('mouseenter', () => { x.style.opacity = '1'; });
        x.addEventListener('mouseleave', () => { x.style.opacity = '0.7'; });
        wrap.appendChild(x);
    }
    return wrap;
}

function makeAddLink(text, color, onClick) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = text;
    btn.style.cssText = `
        background: transparent;
        border: none;
        color: ${color};
        font-family: ${T.fb};
        font-size: ${T.fsB4};
        font-weight: ${T.fwBold};
        cursor: pointer;
        padding: 4px 0;
        letter-spacing: 0.04em;
        align-self: flex-start;
    `;
    btn.addEventListener('click', onClick);
    return btn;
}

function makePriceInput(value, opts = {}) {
    const input = document.createElement('input');
    input.type = 'number';
    input.step = '0.01';
    input.value = (value == null) ? '' : Number(value).toFixed(2);
    input.style.cssText = `
        width: ${opts.width || '88px'};
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

function makeSelectMock(value, opts, onChange) {
    const wrap = document.createElement('div');
    wrap.style.cssText = 'position: relative; display: inline-block;';
    const sel = document.createElement('select');
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
        padding: 6px 26px 6px 10px;
        cursor: pointer;
        outline: none;
    `;
    opts.forEach(o => {
        const opt = document.createElement('option');
        opt.value = o.value;
        opt.textContent = o.label;
        if (o.value === value) opt.selected = true;
        sel.appendChild(opt);
    });
    sel.addEventListener('change', () => onChange(sel.value));
    wrap.appendChild(sel);

    const caret = document.createElement('span');
    caret.textContent = '▾';
    caret.style.cssText = `
        position: absolute; right: 8px; top: 50%;
        transform: translateY(-50%);
        color: ${T.elec};
        font-size: ${T.fsB4};
        pointer-events: none;
    `;
    wrap.appendChild(caret);
    return wrap;
}

function makeToggle(initial, onChange) {
    let state = !!initial;
    const wrap = document.createElement('button');
    wrap.type = 'button';

    function paint() {
        wrap.style.cssText = `
            width: 38px; height: 22px;
            border-radius: 999px;
            background: ${state ? T.greenWarm : T.moonDk};
            border: 1px solid ${state ? T.greenWarm : hexToRgba(T.border, 0.5)};
            position: relative;
            cursor: pointer;
            outline: none;
            flex: 0 0 auto;
            transition: background 0.15s ease;
        `;
        wrap.replaceChildren();
        const knob = document.createElement('span');
        knob.style.cssText = `
            position: absolute;
            top: 2px; left: ${state ? '18px' : '2px'};
            width: 16px; height: 16px;
            border-radius: 50%;
            background: ${state ? T.well : T.moon};
            transition: left 0.15s ease, background 0.15s ease;
        `;
        wrap.appendChild(knob);
    }
    wrap.getValue = () => state;
    wrap.setValue = (v) => { state = !!v; paint(); };
    wrap.addEventListener('click', () => {
        state = !state;
        paint();
        if (onChange) onChange(state);
    });
    paint();
    return wrap;
}

/* ============================================
   COLLAPSIBLE SECTION SHELL
============================================ */
function buildSectionShell(opts) {
    const card = buildStaticCard({ accent: opts.accent });
    card.style.padding = '14px 16px 14px 22px';
    card.style.marginBottom = '12px';

    const head = document.createElement('div');
    head.style.cssText = `
        display: flex; align-items: center; justify-content: space-between;
        gap: 10px;
        cursor: pointer;
    `;

    const title = document.createElement('div');
    title.textContent = opts.title;
    title.style.cssText = `
        font-family: ${T.fb};
        font-size: 11px;
        font-weight: ${T.fwBold};
        color: ${opts.accent};
        letter-spacing: 0.22em;
        text-transform: uppercase;
    `;
    head.appendChild(title);

    const caret = document.createElement('span');
    caret.textContent = opts.startOpen ? '▾' : '▸';
    caret.style.cssText = `
        font-family: ${T.fb};
        font-size: ${T.fsB3};
        color: ${opts.accent};
    `;
    head.appendChild(caret);

    const body = document.createElement('div');
    body.style.cssText = `
        display: ${opts.startOpen ? 'flex' : 'none'};
        flex-direction: column;
        gap: 8px;
        margin-top: 12px;
    `;

    head.addEventListener('click', () => {
        const isOpen = body.style.display !== 'none';
        body.style.display = isOpen ? 'none' : 'flex';
        caret.textContent = isOpen ? '▸' : '▾';
    });

    card.appendChild(head);
    card.appendChild(body);
    return { card, body };
}

/* ============================================
   ITEM SECTIONS
============================================ */

export async function buildItemPricingExtensions(container, item, menuData) {
    const wrap = document.createElement('div');
    wrap.style.cssText = `
        display: flex; flex-direction: column;
        gap: 4px;
        margin-top: 16px;
        padding-top: 16px;
        border-top: 1px dashed ${hexToRgba(T.border, 0.5)};
    `;

    const header = document.createElement('div');
    header.textContent = 'Pricing Chain';
    header.style.cssText = `
        font-family: ${T.fh};
        font-size: ${T.fsB2};
        font-weight: ${T.fwBold};
        color: ${T.text};
        margin-bottom: 8px;
    `;
    wrap.appendChild(header);

    const subnote = document.createElement('div');
    subnote.textContent = 'Live-PATCH sections wired to the new pricing-chain endpoints.';
    subnote.style.cssText = `
        font-family: ${T.fb};
        font-size: ${T.fsB4};
        color: ${T.moon};
        margin-bottom: 12px;
    `;
    wrap.appendChild(subnote);

    container.appendChild(wrap);

    // Reference data — sizes, modifier groups, option groups, modifiers.
    const [sizes, allGroups, optionGroups] = await Promise.all([
        apiOptional('/api/v1/sizes', []),
        apiOptional('/api/v1/config/modifier-groups', []),
        apiOptional('/api/v1/option-groups', []),
    ]);

    const allModifiers = ((menuData && menuData.allModifiers) || []).slice();

    container.appendChild(buildItemBaseBySize(item, sizes, allGroups));
    container.appendChild(buildItemMandatoryGroups(item, allGroups));
    container.appendChild(buildItemIncludedModifiers(item, allModifiers));
    container.appendChild(buildItemOverrides(item, allGroups, optionGroups, sizes));
}

/* ── 1) Item Base by Size ────────────────────────────────── */
function buildItemBaseBySize(item, sizes, allGroups) {
    const driverGroup = (allGroups || []).find(g =>
        g.drives_pricing &&
        ((item.mandatory_group_ids || []).includes(g.group_id))
    );

    const { card, body } = buildSectionShell({
        accent: T.gold,
        title: 'Item Base by Size',
        startOpen: !!driverGroup,
    });

    if (!driverGroup) {
        const note = makeNote(
            'No drives_pricing mandatory group attached. Add one (e.g. Pizza Size) to enable size-based base pricing.',
            T.moon,
        );
        body.appendChild(note);
        return card;
    }

    // Info banner
    const banner = document.createElement('div');
    banner.textContent = `Base price is $0.00 flat — the mandatory ${driverGroup.name} group drives item pricing via price_by_size.`;
    banner.style.cssText = `
        background: ${hexToRgba(T.elec, 0.07)};
        border: 1px solid ${hexToRgba(T.elec, 0.18)};
        border-radius: ${T.chamferCard}px;
        padding: 10px 12px;
        font-family: ${T.fb};
        font-size: ${T.fsB4};
        color: ${T.elec};
        line-height: 1.5;
    `;
    body.appendChild(banner);

    // Build size grid
    const grid = document.createElement('div');
    grid.style.cssText = `
        background: ${T.well};
        border-radius: 8px;
        padding: 10px 12px;
        display: grid;
        grid-template-columns: 1.2fr 1fr 1fr;
        column-gap: 10px;
        row-gap: 6px;
        align-items: center;
    `;

    ['Size', 'Per-unit adj', 'Total'].forEach((h, i) => {
        const cell = document.createElement('div');
        cell.textContent = h;
        cell.style.cssText = `
            font-family: ${T.fb};
            font-size: 8px;
            font-weight: ${T.fwBold};
            color: ${T.moon};
            letter-spacing: 2.5px;
            text-transform: uppercase;
            text-align: ${i === 0 ? 'left' : 'right'};
        `;
        grid.appendChild(cell);
    });

    const driverGroupId = driverGroup.group_id;
    const seedMap = (item.price_by_size && item.price_by_size[driverGroupId]) || {};
    const liveValues = {};
    (sizes || []).forEach(s => { liveValues[s.name] = Number(seedMap[s.name] || 0); });
    const baseItemPrice = Number(item.price || 0);

    (sizes || []).forEach((s, idx) => {
        const rowBg = idx === 0 ? hexToRgba(T.gold, 0.04) : 'transparent';

        const nameCell = document.createElement('div');
        nameCell.textContent = s.name;
        nameCell.style.cssText = `
            font-family: ${T.fb};
            font-size: 10px;
            color: ${T.moon};
            padding: 4px 6px;
            background: ${rowBg};
            border-radius: ${T.chamferBtn}px;
        `;
        grid.appendChild(nameCell);

        const adjCell = document.createElement('div');
        adjCell.style.cssText = `
            display: flex; justify-content: flex-end;
            background: ${rowBg};
            padding: 2px;
            border-radius: ${T.chamferBtn}px;
        `;
        const input = makePriceInput(liveValues[s.name], { width: '80px' });
        const totalCell = document.createElement('div');
        totalCell.textContent = fmtPrice(baseItemPrice + Number(liveValues[s.name] || 0));
        totalCell.style.cssText = `
            font-family: ${T.fb};
            font-size: ${T.fsB3};
            font-weight: ${T.fwBold};
            color: ${T.gold};
            text-align: right;
            padding: 4px 6px;
            background: ${rowBg};
            border-radius: ${T.chamferBtn}px;
        `;

        const persist = async () => {
            const next = parseFloat(input.value) || 0;
            const prev = Number(liveValues[s.name] || 0);
            if (Number(next).toFixed(2) === prev.toFixed(2)) return;
            const newMap = { ...liveValues, [s.name]: next };
            try {
                await apiPut(
                    `/api/v1/menu-items/${encodeURIComponent(item.id || item.item_id)}/size-pricing/${encodeURIComponent(driverGroupId)}`,
                    { size_prices: newMap },
                );
                liveValues[s.name] = next;
                totalCell.textContent = fmtPrice(baseItemPrice + next);
                toast('Size pricing saved');
            } catch (e) {
                input.value = prev.toFixed(2);
                toast('Failed to save size pricing', 'error');
            }
        };
        input.addEventListener('blur', persist);
        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') { e.preventDefault(); input.blur(); }
        });

        adjCell.appendChild(input);
        grid.appendChild(adjCell);
        grid.appendChild(totalCell);
    });

    body.appendChild(grid);
    return card;
}

/* ── 2) Mandatory Groups ─────────────────────────────────── */
function buildItemMandatoryGroups(item, allGroups) {
    const { card, body } = buildSectionShell({
        accent: T.gold,
        title: 'Mandatory Groups',
        startOpen: false,
    });

    const note = makeNote('Server must resolve before sending. Adds use the live PATCH endpoint.', T.moon);
    body.appendChild(note);

    const chipRow = document.createElement('div');
    chipRow.style.cssText = `display: flex; flex-wrap: wrap; gap: 8px;`;
    body.appendChild(chipRow);

    const groupsById = new Map((allGroups || []).map(g => [g.group_id, g]));
    const liveIds = (item.mandatory_group_ids || []).slice();

    function renderChips() {
        chipRow.replaceChildren();
        if (liveIds.length === 0) {
            const empty = document.createElement('span');
            empty.textContent = 'No mandatory groups attached';
            empty.style.cssText = `
                font-family: ${T.fb};
                font-size: ${T.fsB4};
                color: ${T.moon};
                font-style: italic;
            `;
            chipRow.appendChild(empty);
            return;
        }
        liveIds.forEach(gid => {
            const grp = groupsById.get(gid);
            const label = grp ? grp.name : gid;
            chipRow.appendChild(makeChip(label, T.gold, {
                onRemove: async () => {
                    const next = liveIds.filter(x => x !== gid);
                    try {
                        await apiPatch(`/api/v1/items/${encodeURIComponent(item.id || item.item_id)}`, {
                            mandatory_group_ids: next,
                        });
                        liveIds.splice(0, liveIds.length, ...next);
                        item.mandatory_group_ids = liveIds.slice();
                        renderChips();
                    } catch (e) {
                        toast('Failed to remove group', 'error');
                    }
                },
            }));
        });
    }
    renderChips();

    const pickerSlot = document.createElement('div');
    body.appendChild(pickerSlot);

    let pickerOpen = false;
    body.appendChild(makeAddLink('+ Add Mandatory Group', T.gold, () => {
        pickerOpen = !pickerOpen;
        renderPicker();
    }));

    function renderPicker() {
        pickerSlot.replaceChildren();
        if (!pickerOpen) return;

        const candidates = (allGroups || []).filter(g => {
            const mandatoryShape = (g.min_selections ?? 0) >= 1;
            return mandatoryShape && !liveIds.includes(g.group_id);
        });

        const tray = document.createElement('div');
        tray.style.cssText = `
            margin-top: 8px;
            padding: 10px;
            background: ${T.well};
            border-radius: ${T.chamferBtn}px;
            display: flex; flex-wrap: wrap; gap: 6px;
        `;
        if (candidates.length === 0) {
            const empty = document.createElement('span');
            empty.textContent = 'No mandatory-shaped groups available';
            empty.style.cssText = `
                font-family: ${T.fb};
                font-size: ${T.fsB4};
                color: ${T.moon};
                padding: 4px 6px;
            `;
            tray.appendChild(empty);
        } else {
            candidates.forEach(g => {
                const btn = document.createElement('button');
                btn.type = 'button';
                btn.textContent = g.name;
                btn.style.cssText = `
                    background: transparent;
                    border: 1px solid ${T.gold};
                    color: ${T.gold};
                    border-radius: 999px;
                    padding: 5px 12px;
                    font-family: ${T.fb};
                    font-size: ${T.fsB4};
                    font-weight: ${T.fwBold};
                    cursor: pointer;
                `;
                btn.addEventListener('click', async () => {
                    btn.disabled = true;
                    const next = liveIds.concat([g.group_id]);
                    try {
                        await apiPatch(`/api/v1/items/${encodeURIComponent(item.id || item.item_id)}`, {
                            mandatory_group_ids: next,
                        });
                        liveIds.push(g.group_id);
                        item.mandatory_group_ids = liveIds.slice();
                        pickerOpen = false;
                        renderChips();
                        renderPicker();
                    } catch (e) {
                        btn.disabled = false;
                        toast('Failed to add group', 'error');
                    }
                });
                tray.appendChild(btn);
            });
        }
        pickerSlot.appendChild(tray);
    }

    return card;
}

/* ── 3) Included Modifiers ───────────────────────────────── */
function buildItemIncludedModifiers(item, allModifiers) {
    const { card, body } = buildSectionShell({
        accent: T.elec,
        title: 'Included Modifiers',
        startOpen: false,
    });

    body.appendChild(makeNote('Base $0.00 waived — option adjustments still apply.', T.moon));

    const chipRow = document.createElement('div');
    chipRow.style.cssText = `display: flex; flex-wrap: wrap; gap: 8px;`;
    body.appendChild(chipRow);

    const liveIds = (item.included_modifier_ids || []).slice();
    const byId = new Map((allModifiers || []).map(m => [m.id || m.modifier_id, m]));

    function renderChips() {
        chipRow.replaceChildren();
        if (liveIds.length === 0) {
            const empty = document.createElement('span');
            empty.textContent = 'No included modifiers';
            empty.style.cssText = `
                font-family: ${T.fb};
                font-size: ${T.fsB4};
                color: ${T.moon};
                font-style: italic;
            `;
            chipRow.appendChild(empty);
            return;
        }
        liveIds.forEach(mid => {
            const m = byId.get(mid);
            const label = m ? m.name : mid;
            chipRow.appendChild(makeChip(label, T.elec, {
                onRemove: async () => {
                    const next = liveIds.filter(x => x !== mid);
                    try {
                        await apiPatch(`/api/v1/items/${encodeURIComponent(item.id || item.item_id)}`, {
                            included_modifier_ids: next,
                        });
                        liveIds.splice(0, liveIds.length, ...next);
                        item.included_modifier_ids = liveIds.slice();
                        renderChips();
                    } catch (e) {
                        toast('Failed to remove modifier', 'error');
                    }
                },
            }));
        });
    }
    renderChips();

    const pickerSlot = document.createElement('div');
    body.appendChild(pickerSlot);

    let pickerOpen = false;
    body.appendChild(makeAddLink('+ Add Included Modifier', T.elec, () => {
        pickerOpen = !pickerOpen;
        renderPicker();
    }));

    function renderPicker() {
        pickerSlot.replaceChildren();
        if (!pickerOpen) return;

        const candidates = (allModifiers || []).filter(m => {
            const id = m.id || m.modifier_id;
            return id && !liveIds.includes(id);
        });

        const tray = document.createElement('div');
        tray.style.cssText = `
            margin-top: 8px;
            padding: 10px;
            background: ${T.well};
            border-radius: ${T.chamferBtn}px;
            display: flex; flex-wrap: wrap; gap: 6px;
        `;
        if (candidates.length === 0) {
            const empty = document.createElement('span');
            empty.textContent = 'No more modifiers to attach';
            empty.style.cssText = `
                font-family: ${T.fb};
                font-size: ${T.fsB4};
                color: ${T.moon};
                padding: 4px 6px;
            `;
            tray.appendChild(empty);
        } else {
            candidates.slice(0, 80).forEach(m => {
                const id = m.id || m.modifier_id;
                const btn = document.createElement('button');
                btn.type = 'button';
                btn.textContent = m.name;
                btn.style.cssText = `
                    background: transparent;
                    border: 1px solid ${T.elec};
                    color: ${T.elec};
                    border-radius: 999px;
                    padding: 5px 12px;
                    font-family: ${T.fb};
                    font-size: ${T.fsB4};
                    font-weight: ${T.fwBold};
                    cursor: pointer;
                `;
                btn.addEventListener('click', async () => {
                    btn.disabled = true;
                    const next = liveIds.concat([id]);
                    try {
                        await apiPatch(`/api/v1/items/${encodeURIComponent(item.id || item.item_id)}`, {
                            included_modifier_ids: next,
                        });
                        liveIds.push(id);
                        item.included_modifier_ids = liveIds.slice();
                        pickerOpen = false;
                        renderChips();
                        renderPicker();
                    } catch (e) {
                        btn.disabled = false;
                        toast('Failed to add modifier', 'error');
                    }
                });
                tray.appendChild(btn);
            });
        }
        pickerSlot.appendChild(tray);
    }

    return card;
}

/* ── 4) Overrides (option-group + size-price) ────────────── */
function buildItemOverrides(item, allGroups, optionGroups, sizes) {
    const { card, body } = buildSectionShell({
        accent: T.moon,
        title: 'Overrides',
        startOpen: false,
    });

    body.appendChild(buildOptionGroupOverrides(item, allGroups, optionGroups));

    const divider = document.createElement('div');
    divider.style.cssText = `
        height: 1px;
        background: ${hexToRgba(T.border, 0.5)};
        margin: 12px 0;
    `;
    body.appendChild(divider);

    body.appendChild(buildSizePriceOverrides(item, allGroups, sizes));

    return card;
}

function buildOptionGroupOverrides(item, allGroups, optionGroups) {
    const wrap = document.createElement('div');
    wrap.style.cssText = 'display: flex; flex-direction: column; gap: 8px;';

    wrap.appendChild(makeLabel('Option Group Overrides', T.moon));
    wrap.appendChild(makeNote(
        "Overrides the group's default option group for this item only.",
        T.moon,
    ));

    const list = document.createElement('div');
    list.style.cssText = 'display: flex; flex-direction: column; gap: 6px;';
    wrap.appendChild(list);

    const liveOverrides = { ...(item.option_group_overrides || {}) };
    const groupsById = new Map((allGroups || []).map(g => [g.group_id, g]));

    function render() {
        list.replaceChildren();
        const entries = Object.entries(liveOverrides);
        if (entries.length === 0) {
            const empty = document.createElement('span');
            empty.textContent = 'No overrides set';
            empty.style.cssText = `
                font-family: ${T.fb};
                font-size: ${T.fsB4};
                color: ${T.moon};
                font-style: italic;
            `;
            list.appendChild(empty);
            return;
        }
        entries.forEach(([gid, ogId]) => {
            const row = document.createElement('div');
            row.style.cssText = `
                display: flex; align-items: center; gap: 10px;
                padding: 8px 10px;
                background: ${T.well};
                border-radius: ${T.chamferBtn}px;
            `;
            const grp = groupsById.get(gid);
            const name = document.createElement('div');
            name.textContent = grp ? grp.name : gid;
            name.style.cssText = `
                flex: 1;
                font-family: ${T.fb};
                font-size: ${T.fsB4};
                font-weight: ${T.fwBold};
                color: ${T.text};
            `;
            row.appendChild(name);

            const opts = [{ value: '', label: '— None —' }].concat(
                (optionGroups || []).map(og => ({ value: og.option_group_id, label: og.name }))
            );
            const sel = makeSelectMock(ogId || '', opts, async (val) => {
                try {
                    await apiPut(
                        `/api/v1/menu-items/${encodeURIComponent(item.id || item.item_id)}/option-group-override/${encodeURIComponent(gid)}`,
                        { option_group_id: val || null },
                    );
                    liveOverrides[gid] = val;
                    item.option_group_overrides = { ...liveOverrides };
                    toast('Override saved');
                } catch (e) {
                    toast('Failed to save override', 'error');
                }
            });
            row.appendChild(sel);

            const remove = document.createElement('button');
            remove.type = 'button';
            remove.textContent = 'Remove';
            remove.style.cssText = `
                background: transparent;
                border: none;
                color: ${T.moon};
                font-family: ${T.fb};
                font-size: 10px;
                font-weight: ${T.fwBold};
                cursor: pointer;
                padding: 2px 6px;
            `;
            remove.addEventListener('click', async () => {
                try {
                    await apiPut(
                        `/api/v1/menu-items/${encodeURIComponent(item.id || item.item_id)}/option-group-override/${encodeURIComponent(gid)}`,
                        { option_group_id: null },
                    );
                    delete liveOverrides[gid];
                    item.option_group_overrides = { ...liveOverrides };
                    render();
                } catch (e) {
                    toast('Failed to remove override', 'error');
                }
            });
            row.appendChild(remove);

            list.appendChild(row);
        });
    }
    render();

    const addSlot = document.createElement('div');
    wrap.appendChild(addSlot);

    let addOpen = false;
    wrap.appendChild(makeAddLink('+ Add Override', T.moon, () => {
        addOpen = !addOpen;
        renderAdd();
    }));

    function renderAdd() {
        addSlot.replaceChildren();
        if (!addOpen) return;
        const candidates = (allGroups || []).filter(g => !liveOverrides[g.group_id]);
        if (candidates.length === 0) {
            const empty = document.createElement('div');
            empty.textContent = 'All groups already have overrides';
            empty.style.cssText = `
                font-family: ${T.fb};
                font-size: ${T.fsB4};
                color: ${T.moon};
                padding: 6px 0;
            `;
            addSlot.appendChild(empty);
            return;
        }
        const row = document.createElement('div');
        row.style.cssText = `
            display: flex; gap: 8px; align-items: center;
            padding: 10px;
            background: ${T.well};
            border-radius: ${T.chamferBtn}px;
        `;
        const groupOpts = candidates.map(g => ({ value: g.group_id, label: g.name }));
        let pickedGroup = groupOpts[0].value;
        const groupSel = makeSelectMock(pickedGroup, groupOpts, (val) => { pickedGroup = val; });
        row.appendChild(groupSel);

        const ogOpts = [{ value: '', label: '— None —' }].concat(
            (optionGroups || []).map(og => ({ value: og.option_group_id, label: og.name }))
        );
        let pickedOg = '';
        const ogSel = makeSelectMock('', ogOpts, (val) => { pickedOg = val; });
        row.appendChild(ogSel);

        const apply = document.createElement('button');
        apply.type = 'button';
        apply.textContent = 'Add';
        apply.style.cssText = `
            background: ${T.greenWarm};
            color: ${T.well};
            border: none;
            border-radius: 999px;
            padding: 6px 14px;
            font-family: ${T.fb};
            font-size: ${T.fsB4};
            font-weight: ${T.fwBold};
            cursor: pointer;
        `;
        apply.addEventListener('click', async () => {
            try {
                await apiPut(
                    `/api/v1/menu-items/${encodeURIComponent(item.id || item.item_id)}/option-group-override/${encodeURIComponent(pickedGroup)}`,
                    { option_group_id: pickedOg || null },
                );
                liveOverrides[pickedGroup] = pickedOg;
                item.option_group_overrides = { ...liveOverrides };
                addOpen = false;
                render();
                renderAdd();
            } catch (e) {
                toast('Failed to add override', 'error');
            }
        });
        row.appendChild(apply);
        addSlot.appendChild(row);
    }

    return wrap;
}

function buildSizePriceOverrides(item, allGroups, sizes) {
    const wrap = document.createElement('div');
    wrap.style.cssText = 'display: flex; flex-direction: column; gap: 8px;';

    wrap.appendChild(makeLabel('Size Price Overrides', T.moon));
    wrap.appendChild(makeNote(
        "Per-item override of a modifier group's size pricing.",
        T.moon,
    ));

    const list = document.createElement('div');
    list.style.cssText = 'display: flex; flex-direction: column; gap: 6px;';
    wrap.appendChild(list);

    const liveOverrides = JSON.parse(JSON.stringify(item.size_price_overrides || {}));
    const groupsById = new Map((allGroups || []).map(g => [g.group_id, g]));

    function render() {
        list.replaceChildren();
        const rows = [];
        Object.entries(liveOverrides).forEach(([gid, sizeMap]) => {
            Object.entries(sizeMap || {}).forEach(([sizeName, price]) => {
                rows.push({ gid, sizeName, price });
            });
        });
        if (rows.length === 0) {
            const empty = document.createElement('span');
            empty.textContent = 'No size price overrides';
            empty.style.cssText = `
                font-family: ${T.fb};
                font-size: ${T.fsB4};
                color: ${T.moon};
                font-style: italic;
            `;
            list.appendChild(empty);
            return;
        }
        rows.forEach(({ gid, sizeName, price }) => {
            const row = document.createElement('div');
            row.style.cssText = `
                display: flex; align-items: center; gap: 10px;
                padding: 8px 10px;
                background: ${T.well};
                border-radius: ${T.chamferBtn}px;
            `;
            const grp = groupsById.get(gid);
            const groupLabel = document.createElement('div');
            groupLabel.textContent = grp ? grp.name : gid;
            groupLabel.style.cssText = `
                flex: 1;
                font-family: ${T.fb};
                font-size: ${T.fsB4};
                font-weight: ${T.fwBold};
                color: ${T.text};
            `;
            row.appendChild(groupLabel);

            const sizeLabel = document.createElement('div');
            sizeLabel.textContent = sizeName;
            sizeLabel.style.cssText = `
                font-family: ${T.fb};
                font-size: 10px;
                color: ${T.moon};
                letter-spacing: 0.1em;
                text-transform: uppercase;
            `;
            row.appendChild(sizeLabel);

            const input = makePriceInput(price, { width: '90px' });
            const persist = async () => {
                const next = parseFloat(input.value) || 0;
                if (Number(next).toFixed(2) === Number(price).toFixed(2)) return;
                try {
                    await apiPut(
                        `/api/v1/menu-items/${encodeURIComponent(item.id || item.item_id)}/size-price-override/${encodeURIComponent(gid)}/${encodeURIComponent(sizeName)}`,
                        { price: next },
                    );
                    if (!liveOverrides[gid]) liveOverrides[gid] = {};
                    liveOverrides[gid][sizeName] = next;
                    item.size_price_overrides = JSON.parse(JSON.stringify(liveOverrides));
                    toast('Override saved');
                } catch (e) {
                    input.value = Number(price).toFixed(2);
                    toast('Failed to save override', 'error');
                }
            };
            input.addEventListener('blur', persist);
            input.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') { e.preventDefault(); input.blur(); }
            });
            row.appendChild(input);

            list.appendChild(row);
        });
    }
    render();

    const addSlot = document.createElement('div');
    wrap.appendChild(addSlot);

    let addOpen = false;
    wrap.appendChild(makeAddLink('+ Add Size Price Override', T.moon, () => {
        addOpen = !addOpen;
        renderAdd();
    }));

    function renderAdd() {
        addSlot.replaceChildren();
        if (!addOpen) return;
        if ((allGroups || []).length === 0 || (sizes || []).length === 0) {
            const empty = document.createElement('div');
            empty.textContent = 'No groups or sizes available';
            empty.style.cssText = `
                font-family: ${T.fb};
                font-size: ${T.fsB4};
                color: ${T.moon};
                padding: 6px 0;
            `;
            addSlot.appendChild(empty);
            return;
        }
        const row = document.createElement('div');
        row.style.cssText = `
            display: flex; gap: 8px; align-items: center; flex-wrap: wrap;
            padding: 10px;
            background: ${T.well};
            border-radius: ${T.chamferBtn}px;
        `;

        let pickedGroup = (allGroups[0] || {}).group_id;
        const groupSel = makeSelectMock(pickedGroup,
            allGroups.map(g => ({ value: g.group_id, label: g.name })),
            (val) => { pickedGroup = val; });
        row.appendChild(groupSel);

        let pickedSize = (sizes[0] || {}).name;
        const sizeSel = makeSelectMock(pickedSize,
            sizes.map(s => ({ value: s.name, label: s.name })),
            (val) => { pickedSize = val; });
        row.appendChild(sizeSel);

        const input = makePriceInput(0, { width: '88px' });
        row.appendChild(input);

        const apply = document.createElement('button');
        apply.type = 'button';
        apply.textContent = 'Add';
        apply.style.cssText = `
            background: ${T.greenWarm};
            color: ${T.well};
            border: none;
            border-radius: 999px;
            padding: 6px 14px;
            font-family: ${T.fb};
            font-size: ${T.fsB4};
            font-weight: ${T.fwBold};
            cursor: pointer;
        `;
        apply.addEventListener('click', async () => {
            const next = parseFloat(input.value) || 0;
            try {
                await apiPut(
                    `/api/v1/menu-items/${encodeURIComponent(item.id || item.item_id)}/size-price-override/${encodeURIComponent(pickedGroup)}/${encodeURIComponent(pickedSize)}`,
                    { price: next },
                );
                if (!liveOverrides[pickedGroup]) liveOverrides[pickedGroup] = {};
                liveOverrides[pickedGroup][pickedSize] = next;
                item.size_price_overrides = JSON.parse(JSON.stringify(liveOverrides));
                addOpen = false;
                render();
                renderAdd();
            } catch (e) {
                toast('Failed to add override', 'error');
            }
        });
        row.appendChild(apply);
        addSlot.appendChild(row);
    }

    return wrap;
}

/* ============================================
   CATEGORY SECTIONS
============================================ */

export async function buildCategoryPricingExtensions(container, category, menuData) {
    const wrap = document.createElement('div');
    wrap.style.cssText = `
        display: flex; flex-direction: column;
        gap: 4px;
        margin-top: 16px;
        padding-top: 16px;
        border-top: 1px dashed ${hexToRgba(T.border, 0.5)};
    `;

    const header = document.createElement('div');
    header.textContent = 'Pricing Chain';
    header.style.cssText = `
        font-family: ${T.fh};
        font-size: ${T.fsB2};
        font-weight: ${T.fwBold};
        color: ${T.text};
        margin-bottom: 8px;
    `;
    wrap.appendChild(header);

    const subnote = document.createElement('div');
    subnote.textContent = 'Live-PATCH controls — these write to the category as you change them.';
    subnote.style.cssText = `
        font-family: ${T.fb};
        font-size: ${T.fsB4};
        color: ${T.moon};
        margin-bottom: 12px;
    `;
    wrap.appendChild(subnote);

    container.appendChild(wrap);

    const allGroups = await apiOptional('/api/v1/config/modifier-groups', []);

    container.appendChild(buildCategoryUniversalGroups(category, allGroups));
    container.appendChild(buildCategoryEnablePlacement(category));
}

function buildCategoryUniversalGroups(category, allGroups) {
    const { card, body } = buildSectionShell({
        accent: T.green,
        title: 'Universal Groups',
        startOpen: true,
    });

    body.appendChild(makeNote(
        'Apply to every item in this category. Filtered to optional (min_selections = 0) groups.',
        T.moon,
    ));

    const chipRow = document.createElement('div');
    chipRow.style.cssText = `display: flex; flex-wrap: wrap; gap: 8px;`;
    body.appendChild(chipRow);

    const optionalGroups = (allGroups || []).filter(g => (g.min_selections ?? 0) === 0);
    const groupsById = new Map((allGroups || []).map(g => [g.group_id, g]));
    const liveIds = (category.universal_group_ids || []).slice();
    const catId = category.id || category.category_id;

    async function persist(next) {
        try {
            await apiPatch(`/api/v1/categories/${encodeURIComponent(catId)}`, {
                universal_group_ids: next,
            });
            liveIds.splice(0, liveIds.length, ...next);
            category.universal_group_ids = liveIds.slice();
            return true;
        } catch (e) {
            toast('Failed to save universal groups', 'error');
            return false;
        }
    }

    function renderChips() {
        chipRow.replaceChildren();
        if (liveIds.length === 0) {
            const empty = document.createElement('span');
            empty.textContent = 'No universal groups attached';
            empty.style.cssText = `
                font-family: ${T.fb};
                font-size: ${T.fsB4};
                color: ${T.moon};
                font-style: italic;
            `;
            chipRow.appendChild(empty);
            return;
        }
        liveIds.forEach(gid => {
            const grp = groupsById.get(gid);
            const label = grp ? grp.name : gid;
            chipRow.appendChild(makeChip(label, T.green, {
                onRemove: async () => {
                    const next = liveIds.filter(x => x !== gid);
                    if (await persist(next)) renderChips();
                },
            }));
        });
    }
    renderChips();

    const pickerSlot = document.createElement('div');
    body.appendChild(pickerSlot);

    let pickerOpen = false;
    body.appendChild(makeAddLink('+ Add Universal Group', T.green, () => {
        pickerOpen = !pickerOpen;
        renderPicker();
    }));

    function renderPicker() {
        pickerSlot.replaceChildren();
        if (!pickerOpen) return;
        const candidates = optionalGroups.filter(g => !liveIds.includes(g.group_id));
        const tray = document.createElement('div');
        tray.style.cssText = `
            margin-top: 8px;
            padding: 10px;
            background: ${T.well};
            border-radius: ${T.chamferBtn}px;
            display: flex; flex-wrap: wrap; gap: 6px;
        `;
        if (candidates.length === 0) {
            const empty = document.createElement('span');
            empty.textContent = 'No optional groups available';
            empty.style.cssText = `
                font-family: ${T.fb};
                font-size: ${T.fsB4};
                color: ${T.moon};
                padding: 4px 6px;
            `;
            tray.appendChild(empty);
        } else {
            candidates.forEach(g => {
                const btn = document.createElement('button');
                btn.type = 'button';
                btn.textContent = g.name;
                btn.style.cssText = `
                    background: transparent;
                    border: 1px solid ${T.green};
                    color: ${T.green};
                    border-radius: 999px;
                    padding: 5px 12px;
                    font-family: ${T.fb};
                    font-size: ${T.fsB4};
                    font-weight: ${T.fwBold};
                    cursor: pointer;
                `;
                btn.addEventListener('click', async () => {
                    btn.disabled = true;
                    const next = liveIds.concat([g.group_id]);
                    if (await persist(next)) {
                        pickerOpen = false;
                        renderChips();
                        renderPicker();
                    } else {
                        btn.disabled = false;
                    }
                });
                tray.appendChild(btn);
            });
        }
        pickerSlot.appendChild(tray);
    }

    return card;
}

function buildCategoryEnablePlacement(category) {
    const { card, body } = buildSectionShell({
        accent: T.green,
        title: 'Enable Placement',
        startOpen: true,
    });

    const row = document.createElement('div');
    row.style.cssText = `
        display: flex; align-items: center; gap: 14px;
        padding: 8px 0;
    `;
    const text = document.createElement('div');
    text.style.cssText = 'flex: 1;';
    const title = document.createElement('div');
    title.textContent = 'Enable Placement';
    title.style.cssText = `
        font-family: ${T.fb};
        font-size: ${T.fsB3};
        font-weight: ${T.fwBold};
        color: ${T.text};
    `;
    text.appendChild(title);
    const sub = document.createElement('div');
    sub.textContent = 'Shows ½ LEFT / WHOLE / ½ RIGHT on modifier screen';
    sub.style.cssText = `
        font-family: ${T.fb};
        font-size: ${T.fsB4};
        color: ${T.moon};
        margin-top: 2px;
    `;
    text.appendChild(sub);
    row.appendChild(text);

    const catId = category.id || category.category_id;
    const toggle = makeToggle(!!category.enable_placement, async (next) => {
        try {
            await apiPatch(`/api/v1/categories/${encodeURIComponent(catId)}`, {
                enable_placement: next,
            });
            category.enable_placement = next;
        } catch (e) {
            toggle.setValue(!next);
            toast('Failed to update placement', 'error');
        }
    });
    row.appendChild(toggle);

    body.appendChild(row);
    return card;
}
