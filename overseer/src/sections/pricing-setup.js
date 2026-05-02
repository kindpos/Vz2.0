/* ============================================
   KINDpos Overseer — Pricing Setup

   Sizes — GET/POST /api/v1/sizes

   Options and Option Groups now live on other screens
   (Modifiers and Groups respectively); Pricing Setup is
   the Sizes vocabulary.

   Every visual value flows from common/tokens.js. No
   hardcoded hex anywhere in this file.
   ============================================ */

import { T } from '../../../common/tokens.js';
import {
    buildStaticCard,
    hexToRgba,
} from '../../../common/theme.js';

/* ------------------------------------------
   MODULE STATE — single const; properties mutate.
------------------------------------------ */
const _state = {
    container: null,
    wrapper: null,
    sizes: [],
    showAddForm: false,
    editingSizeId: null,
    loadError: false,
};

/* ------------------------------------------
   FORMATTERS / UTILS
------------------------------------------ */
function formatPrice(n) { return '$' + Number(n || 0).toFixed(2); }

function formatPriceAdjustment(n) {
    const v = Number(n || 0);
    if (v > 0) return '+ ' + formatPrice(v);
    if (v < 0) return '− ' + formatPrice(Math.abs(v));
    return formatPrice(0);
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

async function fetchSizes() { return apiGet('/api/v1/sizes'); }

/* ------------------------------------------
   TOAST (uses tokens for color)
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
   PRIMITIVES — text input, toggle, pill button
------------------------------------------ */
function buildTextInput(value, opts = {}) {
    const input = document.createElement('input');
    input.type = opts.type || 'text';
    input.value = value ?? '';
    if (opts.placeholder) input.placeholder = opts.placeholder;
    if (opts.step) input.step = opts.step;
    input.style.cssText = `
        width: 100%;
        padding: 10px 14px;
        background: ${T.well};
        border: 1px solid ${hexToRgba(T.border, 0.5)};
        border-radius: ${T.chamferBtn}px;
        color: ${T.text};
        font-family: ${T.fb};
        font-size: ${T.fsB3};
        outline: none;
        box-sizing: border-box;
        transition: border-color 0.15s ease;
    `;
    input.addEventListener('focus', () => { input.style.borderColor = T.elec; });
    input.addEventListener('blur', () => {
        input.style.borderColor = hexToRgba(T.border, 0.5);
    });
    return input;
}

function buildToggle(initial, onChange) {
    let state = !!initial;
    const wrap = document.createElement('button');
    wrap.type = 'button';

    function applyState() {
        wrap.style.cssText = `
            width: 44px; height: 24px;
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
            left: ${state ? '22px' : '2px'};
            width: 18px; height: 18px;
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

    // Variants pulled from tokens — no inline hex anywhere
    const variants = {
        primary: {
            bg: T.gold, fg: T.well,
            shadow: hexToRgba(T.gold, 0.45),
            border: 'none',
        },
        confirm: {
            bg: T.greenWarm, fg: T.well,
            shadow: hexToRgba(T.greenWarm, 0.45),
            border: 'none',
        },
        ghost: {
            bg: 'transparent', fg: T.elec,
            shadow: 'transparent',
            border: `1px solid ${T.elec}`,
        },
        tertiary: {
            bg: 'transparent', fg: T.moon,
            shadow: 'transparent',
            border: 'none',
        },
        danger: {
            bg: 'transparent', fg: T.verm,
            shadow: 'transparent',
            border: `1px solid ${T.verm}`,
        },
    };
    const v = variants[variant] || variants.primary;

    b.style.cssText = `
        display: inline-flex; align-items: center; justify-content: center;
        padding: ${opts.small ? '6px 14px' : '10px 20px'};
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
    `;
    b.addEventListener('mousedown', () => {
        b.style.transform = 'translateY(2px)';
        if (v.shadow !== 'transparent') b.style.boxShadow = `0 1px 0 ${v.shadow}`;
    });
    b.addEventListener('mouseup', () => {
        b.style.transform = 'translateY(0)';
        if (v.shadow !== 'transparent') b.style.boxShadow = `0 3px 0 ${v.shadow}`;
    });
    b.addEventListener('mouseleave', () => {
        b.style.transform = 'translateY(0)';
        if (v.shadow !== 'transparent') b.style.boxShadow = `0 3px 0 ${v.shadow}`;
    });
    if (onClick) b.addEventListener('click', onClick);
    return b;
}

/* ------------------------------------------
   BADGE — small inline label
------------------------------------------ */
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
        font-size: ${T.fsB4};
        font-weight: ${T.fwBold};
        letter-spacing: 0.08em;
        text-transform: uppercase;
    `;
    return el;
}

/* ------------------------------------------
   INFO BANNER
------------------------------------------ */
function buildInfoBanner(text) {
    const el = document.createElement('div');
    el.textContent = text;
    el.style.cssText = `
        background: ${hexToRgba(T.elec, 0.07)};
        border: 1px solid ${hexToRgba(T.elec, 0.18)};
        border-radius: ${T.chamferCard}px;
        padding: 12px 16px;
        margin-bottom: 18px;
        font-family: ${T.fb};
        font-size: ${T.fsB4};
        color: ${T.elec};
        line-height: 1.5;
    `;
    return el;
}

/* ============================================
   PAGE FRAME — header.
============================================ */

function buildPageHeader(wrapper) {
    const header = document.createElement('div');
    header.style.cssText = `
        display: flex; align-items: flex-start; justify-content: space-between;
        gap: 16px;
        margin-bottom: 18px;
        padding-bottom: 14px;
        border-bottom: 1px solid ${hexToRgba(T.border, 0.5)};
    `;

    const titleBlock = document.createElement('div');
    const title = document.createElement('div');
    title.textContent = 'Pricing Setup';
    title.style.cssText = `
        font-family: ${T.fh};
        font-size: ${T.fsH3};
        font-weight: ${T.fwBold};
        color: ${T.text};
        margin-bottom: 4px;
    `;
    const sub = document.createElement('div');
    sub.textContent = 'Sizes, options, and option groups — the vocabulary for modifier pricing';
    sub.style.cssText = `
        font-family: ${T.fb};
        font-size: ${T.fsB4};
        color: ${T.moon};
    `;
    titleBlock.appendChild(title);
    titleBlock.appendChild(sub);
    header.appendChild(titleBlock);

    const addBtn = buildPillButton('+ Add Size', 'primary', () => {
        _state.showAddForm = true;
        rebuild();
    });
    addBtn.id = 'pricing-setup-add-btn';
    header.appendChild(addBtn);

    wrapper.appendChild(header);
}

/* ============================================
   SIZES
============================================ */

function buildSizesTab(content) {
    content.appendChild(buildInfoBanner(
        'Sizes scale item base prices. A positive Price Adjustment is added on top of the item price for that size.'
    ));

    if (_state.loadError) {
        content.appendChild(buildErrorState(() => refreshSizes()));
        return;
    }

    const list = document.createElement('div');
    list.style.cssText = 'display: flex; flex-direction: column; gap: 10px;';

    if (_state.sizes.length === 0) {
        list.appendChild(buildEmptyState('No sizes yet — tap + Add Size'));
    } else {
        _state.sizes.forEach(size => list.appendChild(buildSizeCard(size)));
    }
    content.appendChild(list);

    if (_state.showAddForm) {
        content.appendChild(buildSizeAddForm());
    }
}

function buildSizeCard(size) {
    const adj = Number(size.price_adjustment || 0);
    const card = buildStaticCard({
        accent: adj > 0 ? T.gold : T.moon,
    });
    card.style.padding = '14px 18px 14px 22px';

    if (_state.editingSizeId === size.size_id) {
        card.appendChild(buildSizeEditForm(size));
        return card;
    }

    const row = document.createElement('div');
    row.style.cssText = `
        display: flex; align-items: center; gap: 14px;
        flex-wrap: wrap;
    `;

    const nameBlock = document.createElement('div');
    nameBlock.style.cssText = 'flex: 1; min-width: 160px;';

    const name = document.createElement('div');
    name.textContent = size.name;
    name.style.cssText = `
        font-family: ${T.fb};
        font-size: ${T.fsB3};
        font-weight: ${T.fwBold};
        color: ${T.text};
        margin-bottom: 4px;
    `;
    nameBlock.appendChild(name);

    const subLabel = document.createElement('div');
    subLabel.textContent = adj > 0 ? `Adds ${formatPrice(adj)} per item` : 'No adjustment';
    subLabel.style.cssText = `
        font-family: ${T.fb};
        font-size: ${T.fsB4};
        color: ${T.moon};
    `;
    nameBlock.appendChild(subLabel);

    row.appendChild(nameBlock);

    const itemAdj = buildBadge('Item Adj', T.gold);
    row.appendChild(itemAdj);

    const price = document.createElement('div');
    price.textContent = formatPriceAdjustment(adj);
    price.style.cssText = `
        font-family: ${T.fb};
        font-size: ${T.fsB2};
        font-weight: ${T.fwBold};
        color: ${adj > 0 ? T.gold : T.moon};
        min-width: 80px;
        text-align: right;
    `;
    row.appendChild(price);

    const toggle = buildToggle(size.active !== false, async (next) => {
        try {
            await apiPatch(`/api/v1/sizes/${encodeURIComponent(size.size_id)}`, { active: next });
            await refreshSizes();
        } catch (e) {
            toggle.setValue(!next);
            showToast('Failed to update size', 'error');
        }
    });
    row.appendChild(toggle);

    const editBtn = buildPillButton('Edit', 'ghost', () => {
        _state.editingSizeId = size.size_id;
        _state.showAddForm = false;
        rebuild();
    }, { small: true });
    row.appendChild(editBtn);

    card.appendChild(row);
    return card;
}

function buildSizeEditForm(size) {
    const wrap = document.createElement('div');
    wrap.style.cssText = 'display: flex; flex-direction: column; gap: 10px;';

    const heading = document.createElement('div');
    heading.textContent = `Edit ${size.name}`;
    heading.style.cssText = `
        font-family: ${T.fb};
        font-size: ${T.fsB3};
        font-weight: ${T.fwBold};
        color: ${T.elec};
        letter-spacing: 0.06em;
        text-transform: uppercase;
    `;
    wrap.appendChild(heading);

    const nameInput = buildTextInput(size.name || '', { placeholder: 'Size name' });
    const priceInput = buildTextInput(
        Number(size.price_adjustment || 0).toString(),
        { type: 'number', step: '0.01' },
    );

    const fields = document.createElement('div');
    fields.style.cssText = 'display: grid; grid-template-columns: 1fr 160px; gap: 10px;';
    fields.appendChild(nameInput);
    fields.appendChild(priceInput);
    wrap.appendChild(fields);

    const actions = document.createElement('div');
    actions.style.cssText = `
        display: flex; gap: 10px; justify-content: flex-end;
        padding-top: 10px;
        border-top: 1px solid ${hexToRgba(T.border, 0.5)};
    `;
    actions.appendChild(buildPillButton('Cancel', 'tertiary', () => {
        _state.editingSizeId = null;
        rebuild();
    }, { small: true }));
    actions.appendChild(buildPillButton('Save', 'confirm', async () => {
        const newName = nameInput.value.trim();
        const newAdj = parseFloat(priceInput.value);
        if (!newName) { showToast('Name is required', 'error'); return; }
        const body = {};
        if (newName !== (size.name || '')) body.name = newName;
        if (!isNaN(newAdj) && Math.abs(newAdj - Number(size.price_adjustment || 0)) >= 0.005) {
            body.price_adjustment = newAdj;
        }
        if (Object.keys(body).length === 0) {
            _state.editingSizeId = null;
            rebuild();
            return;
        }
        try {
            await apiPatch(`/api/v1/sizes/${encodeURIComponent(size.size_id)}`, body);
            _state.editingSizeId = null;
            await refreshSizes();
            showToast('Size saved');
        } catch (e) {
            showToast('Failed to save size', 'error');
        }
    }, { small: true }));
    wrap.appendChild(actions);

    return wrap;
}

function buildSizeAddForm() {
    const form = buildAddFormShell('Add Size');

    const nameInput = buildField(form, 'Name *', buildTextInput('', { placeholder: 'e.g. Large, X-Large…' }));
    const priceInput = buildField(form, 'Price Adjustment',
        buildTextInput('0', { type: 'number', step: '0.01' }),
        'Decimal — added to base item price for this size');

    buildFormActions(form, async () => {
        const name = nameInput.value.trim();
        if (!name) { showToast('Name is required', 'error'); return; }
        try {
            await apiPost('/api/v1/sizes', {
                name,
                price_adjustment: parseFloat(priceInput.value) || 0,
            });
            _state.showAddForm = false;
            await refreshSizes();
            showToast('Size added');
        } catch (e) {
            showToast('Failed to create size', 'error');
        }
    });

    return form;
}

/* ------------------------------------------
   FORM PRIMITIVES — shared shell for the
   inline Add form.
------------------------------------------ */

function buildAddFormShell(title) {
    const form = document.createElement('div');
    form.style.cssText = `
        margin-top: 18px;
        padding: 18px 20px;
        background: ${T.card};
        border-left: 4px solid ${T.elec};
        border-radius: ${T.chamferCard}px;
    `;
    const heading = document.createElement('div');
    heading.textContent = title;
    heading.style.cssText = `
        font-family: ${T.fb};
        font-size: ${T.fsB2};
        font-weight: ${T.fwBold};
        color: ${T.text};
        margin-bottom: 14px;
    `;
    form.appendChild(heading);
    return form;
}

function buildField(form, labelText, inputEl, hintText) {
    const wrap = document.createElement('div');
    wrap.style.cssText = 'margin-bottom: 14px;';
    const label = document.createElement('div');
    label.textContent = labelText;
    label.style.cssText = `
        font-family: ${T.fb};
        font-size: ${T.fsB4};
        font-weight: ${T.fwBold};
        color: ${T.elec};
        letter-spacing: 0.08em;
        text-transform: uppercase;
        margin-bottom: 6px;
    `;
    wrap.appendChild(label);
    wrap.appendChild(inputEl);
    if (hintText) {
        const hint = document.createElement('div');
        hint.textContent = hintText;
        hint.style.cssText = `
            font-family: ${T.fb};
            font-size: ${T.fsB4};
            color: ${T.moon};
            margin-top: 4px;
        `;
        wrap.appendChild(hint);
    }
    form.appendChild(wrap);
    return inputEl;
}

function buildFormActions(form, onSave) {
    const actions = document.createElement('div');
    actions.style.cssText = `
        display: flex; gap: 10px; justify-content: flex-end;
        margin-top: 18px;
        padding-top: 12px;
        border-top: 1px solid ${hexToRgba(T.border, 0.5)};
    `;
    actions.appendChild(buildPillButton('Cancel', 'tertiary', () => {
        _state.showAddForm = false;
        rebuild();
    }, { small: true }));
    actions.appendChild(buildPillButton('Save', 'confirm', onSave, { small: true }));
    form.appendChild(actions);
    return actions;
}

/* ------------------------------------------
   EMPTY STATE
------------------------------------------ */
function buildEmptyState(text) {
    const el = document.createElement('div');
    el.textContent = text;
    el.style.cssText = `
        padding: 40px 20px;
        text-align: center;
        font-family: ${T.fb};
        font-size: ${T.fsB3};
        color: ${T.moon};
        letter-spacing: 0.08em;
    `;
    return el;
}

/* ------------------------------------------
   ERROR STATE — clickable to retry
------------------------------------------ */
function buildErrorState(retry) {
    const el = document.createElement('div');
    el.textContent = 'Failed to load — tap to retry';
    el.style.cssText = `
        padding: 40px 20px;
        text-align: center;
        font-family: ${T.fb};
        font-size: ${T.fsB3};
        color: ${T.verm};
        cursor: pointer;
        letter-spacing: 0.08em;
    `;
    el.addEventListener('click', retry);
    return el;
}

/* ============================================
   RENDER + LIFECYCLE
============================================ */

function rebuild() {
    if (!_state.wrapper) return;
    _state.wrapper.replaceChildren();

    buildPageHeader(_state.wrapper);

    const content = document.createElement('div');
    content.style.cssText = 'min-height: 240px;';
    _state.wrapper.appendChild(content);

    buildSizesTab(content);
}

async function refreshSizes() {
    _state.loadError = false;
    try {
        _state.sizes = await fetchSizes();
    } catch (e) {
        console.error('[PricingSetup] Refresh failed:', e);
        _state.loadError = true;
        _state.sizes = [];
    }
    rebuild();
}

export function buildPricingSetupScene(container) {
    _state.container = container;
    _state.showAddForm = false;
    _state.editingSizeId = null;
    _state.loadError = false;
    _state.sizes = [];

    container.replaceChildren();

    _state.wrapper = document.createElement('div');
    _state.wrapper.style.cssText = `
        max-width: 1100px;
        margin: 0 auto;
        padding: 24px 20px 60px 20px;
        background: ${T.bg};
        min-height: 100%;
    `;
    container.appendChild(_state.wrapper);

    rebuild();
    refreshSizes().catch(e => console.error('[PricingSetup] Initial load failed:', e));
}

export function cleanupPricingSetup(container) {
    if (container) container.replaceChildren();
    _state.container = null;
    _state.wrapper = null;
    _state.sizes = [];
    _state.showAddForm = false;
    _state.editingSizeId = null;
    _state.loadError = false;
}
