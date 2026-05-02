/* ============================================
   KINDpos Overseer — Pricing Setup

   Three tabs over the pricing-vocabulary primitives that
   feed the modifier system:
     1. Sizes          — GET/POST /api/v1/sizes
     2. Options        — GET/POST /api/v1/options
     3. Option Groups  — GET/POST /api/v1/option-groups
                         + POST /api/v1/option-groups/{id}/options/{opt_id}

   Every visual value flows from common/tokens.js. No
   hardcoded hex anywhere in this file.
   ============================================ */

import { T } from '../../../common/tokens.js';
import {
    buildStaticCard,
    hexToRgba,
    darkenHex,
} from '../../../common/theme.js';

/* ------------------------------------------
   MODULE STATE — single const; properties mutate.
------------------------------------------ */
const _state = {
    container: null,
    wrapper: null,
    activeTab: 'sizes',         // 'sizes' | 'options' | 'option-groups'
    sizes: [],
    options: [],
    optionGroups: [],
    showAddForm: false,
};

const TAB_DEFS = [
    { id: 'sizes',          label: 'Sizes',          singular: 'Size'   },
    { id: 'options',        label: 'Options',        singular: 'Option' },
    { id: 'option-groups',  label: 'Option Groups',  singular: 'Group'  },
];

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

function priceAccent(value, negates) {
    if (negates) return T.verm;
    if (Number(value || 0) !== 0) return T.gold;
    return T.moon;
}

function priceColor(value, negates) {
    if (negates) return T.verm;
    const v = Number(value || 0);
    if (v !== 0) return T.gold;
    return T.moon;
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

async function apiDelete(url) {
    const res = await fetch(url, { method: 'DELETE' });
    if (!res.ok) throw new Error(`DELETE ${url} → ${res.status}`);
    return res.json();
}

async function fetchSizes()        { return apiGet('/api/v1/sizes'); }
async function fetchOptions()      { return apiGet('/api/v1/options'); }
async function fetchOptionGroups() { return apiGet('/api/v1/option-groups'); }

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
   INFO BANNER — appears on every tab
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

/* ------------------------------------------
   MODIFIER TILE — small option chip used inside Option Groups.
   Matches the buildActionCard visual pattern: depth-only,
   no flat border anywhere.
------------------------------------------ */
function buildOptionChip(option, opts = {}) {
    const accent = priceAccent(option.price_adjustment, option.negates_price);

    const el = document.createElement('div');
    el.style.cssText = `
        position: relative;
        background: ${T.card};
        border-radius: ${T.chamferBtn}px;
        padding: 10px 14px 10px 18px;
        box-shadow: 0 4px 0 ${darkenHex(T.card, 0.35)},
                    inset 0 1px 0 rgba(255,255,255,0.08);
        display: flex; align-items: center; gap: 10px;
    `;

    const bar = document.createElement('div');
    bar.style.cssText = `
        position: absolute;
        left: 0; top: 6px; bottom: 6px;
        width: 3px;
        border-radius: 0 2px 2px 0;
        background: ${accent};
        box-shadow: 0 0 8px ${hexToRgba(accent, 0.5)};
    `;
    el.appendChild(bar);

    const name = document.createElement('span');
    name.textContent = option.name;
    name.style.cssText = `
        flex: 1;
        font-family: ${T.fb};
        font-size: ${T.fsB3};
        font-weight: ${T.fwBold};
        color: ${T.text};
    `;
    el.appendChild(name);

    if (option.negates_price) {
        el.appendChild(buildBadge('Negates', T.verm));
    } else {
        const v = Number(option.price_adjustment || 0);
        const priceEl = document.createElement('span');
        priceEl.textContent = formatPriceAdjustment(v);
        priceEl.style.cssText = `
            font-family: ${T.fb};
            font-size: ${T.fsB4};
            font-weight: ${T.fwBold};
            color: ${priceColor(v, false)};
        `;
        el.appendChild(priceEl);
    }

    if (opts.onRemove) {
        const remove = document.createElement('button');
        remove.type = 'button';
        remove.textContent = '×';
        remove.style.cssText = `
            background: transparent;
            border: none;
            color: ${T.moon};
            font-size: ${T.fsB1};
            line-height: 1;
            padding: 0 4px;
            cursor: pointer;
            font-family: ${T.fb};
        `;
        remove.addEventListener('click', (e) => {
            e.stopPropagation();
            opts.onRemove();
        });
        remove.addEventListener('mouseenter', () => { remove.style.color = T.verm; });
        remove.addEventListener('mouseleave', () => { remove.style.color = T.moon; });
        el.appendChild(remove);
    }

    return el;
}

/* ============================================
   PAGE FRAME — header, tab bar, body, info banner.
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

    const activeDef = TAB_DEFS.find(t => t.id === _state.activeTab);
    const addBtn = buildPillButton(`+ Add ${activeDef.singular}`, 'primary', () => {
        _state.showAddForm = true;
        rebuild();
    });
    addBtn.id = 'pricing-setup-add-btn';
    header.appendChild(addBtn);

    wrapper.appendChild(header);
}

function buildTabBar(wrapper) {
    const bar = document.createElement('div');
    bar.style.cssText = `
        display: flex; gap: 4px;
        margin-bottom: 18px;
        border-bottom: 1px solid ${hexToRgba(T.border, 0.5)};
    `;

    TAB_DEFS.forEach(t => {
        const isActive = _state.activeTab === t.id;
        const tab = document.createElement('button');
        tab.type = 'button';
        tab.textContent = t.label;
        tab.style.cssText = `
            background: transparent;
            border: none;
            padding: 12px 22px;
            font-family: ${T.fb};
            font-size: ${T.fsB3};
            font-weight: ${T.fwBold};
            letter-spacing: 0.04em;
            color: ${isActive ? T.elec : T.moon};
            cursor: pointer;
            position: relative;
            border-bottom: 2px solid ${isActive ? T.elec : 'transparent'};
            margin-bottom: -1px;
            transition: color 0.15s ease, border-color 0.15s ease;
        `;
        tab.addEventListener('mouseenter', () => {
            if (!isActive) tab.style.color = T.text;
        });
        tab.addEventListener('mouseleave', () => {
            if (!isActive) tab.style.color = T.moon;
        });
        tab.addEventListener('click', () => {
            if (_state.activeTab !== t.id) {
                _state.activeTab = t.id;
                _state.showAddForm = false;
                rebuild();
            }
        });
        bar.appendChild(tab);
    });

    wrapper.appendChild(bar);
}

/* ============================================
   TAB 1 — SIZES
============================================ */

function buildSizesTab(content) {
    content.appendChild(buildInfoBanner(
        'Sizes scale item base prices. A positive Price Adjustment is added on top of the item price for that size.'
    ));

    const list = document.createElement('div');
    list.style.cssText = 'display: flex; flex-direction: column; gap: 10px;';

    if (_state.sizes.length === 0) {
        list.appendChild(buildEmptyState('No sizes yet — tap + Add Size to begin'));
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
            await refreshActiveTab();
        } catch (e) {
            toggle.setValue(!next);
            showToast('Failed to update size', 'error');
        }
    });
    row.appendChild(toggle);

    const editBtn = buildPillButton('Edit', 'ghost', () => {
        showToast('Edit coming soon', 'ok');
    }, { small: true });
    row.appendChild(editBtn);

    card.appendChild(row);
    return card;
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
            await refreshActiveTab();
            showToast('Size added');
        } catch (e) {
            showToast('Failed to create size', 'error');
        }
    });

    return form;
}

/* ============================================
   TAB 2 — OPTIONS
============================================ */

function buildOptionsTab(content) {
    content.appendChild(buildInfoBanner(
        'Options are reusable pricing modifiers. A negating option zeros out the base price (e.g. "No Cheese" on a Pizza topping).'
    ));

    const list = document.createElement('div');
    list.style.cssText = 'display: flex; flex-direction: column; gap: 10px;';

    if (_state.options.length === 0) {
        list.appendChild(buildEmptyState('No options yet — tap + Add Option to begin'));
    } else {
        _state.options.forEach(option => list.appendChild(buildOptionCard(option)));
    }
    content.appendChild(list);

    if (_state.showAddForm) {
        content.appendChild(buildOptionAddForm());
    }
}

function buildOptionCard(option) {
    const adj = Number(option.price_adjustment || 0);
    const accent = priceAccent(adj, option.negates_price);
    const card = buildStaticCard({ accent });
    card.style.padding = '14px 18px 14px 22px';

    const row = document.createElement('div');
    row.style.cssText = `
        display: flex; align-items: center; gap: 14px;
        flex-wrap: wrap;
    `;

    const nameBlock = document.createElement('div');
    nameBlock.style.cssText = 'flex: 1; min-width: 160px;';

    const name = document.createElement('div');
    name.textContent = option.name;
    name.style.cssText = `
        font-family: ${T.fb};
        font-size: ${T.fsB3};
        font-weight: ${T.fwBold};
        color: ${T.text};
        margin-bottom: 4px;
    `;
    nameBlock.appendChild(name);

    const sub = document.createElement('div');
    sub.style.cssText = `
        font-family: ${T.fb};
        font-size: ${T.fsB4};
        color: ${priceColor(adj, option.negates_price)};
    `;
    sub.textContent = option.negates_price
        ? 'Zeros the base price'
        : (adj === 0 ? 'No price change' : formatPriceAdjustment(adj));
    nameBlock.appendChild(sub);

    row.appendChild(nameBlock);

    if (option.negates_price) {
        row.appendChild(buildBadge('Negates', T.verm));
    }

    const toggle = buildToggle(option.active !== false, async (next) => {
        try {
            await apiPatch(`/api/v1/options/${encodeURIComponent(option.option_id)}`, { active: next });
            await refreshActiveTab();
        } catch (e) {
            toggle.setValue(!next);
            showToast('Failed to update option', 'error');
        }
    });
    row.appendChild(toggle);

    const editBtn = buildPillButton('Edit', 'ghost', () => {
        showToast('Edit coming soon', 'ok');
    }, { small: true });
    row.appendChild(editBtn);

    card.appendChild(row);
    return card;
}

function buildOptionAddForm() {
    const form = buildAddFormShell('Add Option');

    const nameInput = buildField(form, 'Name *', buildTextInput('', { placeholder: 'e.g. Pepperoni, No Cheese…' }));
    const priceInput = buildField(form, 'Price Adjustment',
        buildTextInput('0', { type: 'number', step: '0.01' }),
        'Decimal — applied when this option is selected');

    // Negates Price toggle row
    const toggleRow = document.createElement('div');
    toggleRow.style.cssText = `
        display: flex; align-items: center; gap: 14px;
        padding: 12px 14px;
        background: ${T.well};
        border-radius: ${T.chamferBtn}px;
        margin-bottom: 14px;
    `;
    const toggleLabel = document.createElement('div');
    toggleLabel.style.cssText = 'flex: 1;';
    const toggleLabelTitle = document.createElement('div');
    toggleLabelTitle.textContent = 'Negates Price';
    toggleLabelTitle.style.cssText = `
        font-family: ${T.fb};
        font-size: ${T.fsB3};
        font-weight: ${T.fwBold};
        color: ${T.text};
        margin-bottom: 2px;
    `;
    const toggleLabelHint = document.createElement('div');
    toggleLabelHint.textContent = 'Zeros out the base price (e.g. "No Cheese")';
    toggleLabelHint.style.cssText = `
        font-family: ${T.fb};
        font-size: ${T.fsB4};
        color: ${T.moon};
    `;
    toggleLabel.appendChild(toggleLabelTitle);
    toggleLabel.appendChild(toggleLabelHint);
    toggleRow.appendChild(toggleLabel);
    const negatesToggle = buildToggle(false, () => {});
    toggleRow.appendChild(negatesToggle);
    form.appendChild(toggleRow);

    buildFormActions(form, async () => {
        const name = nameInput.value.trim();
        if (!name) { showToast('Name is required', 'error'); return; }
        try {
            await apiPost('/api/v1/options', {
                name,
                price_adjustment: parseFloat(priceInput.value) || 0,
                negates_price: negatesToggle.getValue(),
            });
            _state.showAddForm = false;
            await refreshActiveTab();
            showToast('Option added');
        } catch (e) {
            showToast('Failed to create option', 'error');
        }
    });

    return form;
}

/* ============================================
   TAB 3 — OPTION GROUPS
============================================ */

function buildOptionGroupsTab(content) {
    content.appendChild(buildInfoBanner(
        'Option Groups bundle related options for reuse — e.g. a "Pizza Toppings" group containing Pepperoni, Mushrooms, Olives.'
    ));

    const list = document.createElement('div');
    list.style.cssText = 'display: flex; flex-direction: column; gap: 14px;';

    if (_state.optionGroups.length === 0) {
        list.appendChild(buildEmptyState('No option groups yet — tap + Add Group to begin'));
    } else {
        _state.optionGroups.forEach(group => list.appendChild(buildOptionGroupCard(group)));
    }
    content.appendChild(list);

    if (_state.showAddForm) {
        content.appendChild(buildOptionGroupAddForm());
    }
}

function buildOptionGroupCard(group) {
    const card = buildStaticCard({ accent: T.green });
    card.style.padding = '16px 18px 14px 22px';

    // Header row — name, count badge, toggle, edit button
    const headerRow = document.createElement('div');
    headerRow.style.cssText = `
        display: flex; align-items: center; gap: 14px;
        margin-bottom: 12px;
        flex-wrap: wrap;
    `;

    const nameBlock = document.createElement('div');
    nameBlock.style.cssText = 'flex: 1; min-width: 160px;';
    const name = document.createElement('div');
    name.textContent = group.name;
    name.style.cssText = `
        font-family: ${T.fb};
        font-size: ${T.fsB3};
        font-weight: ${T.fwBold};
        color: ${T.text};
    `;
    nameBlock.appendChild(name);
    headerRow.appendChild(nameBlock);

    const optionIds = group.option_ids || [];
    const countBadge = buildBadge(
        `${optionIds.length} option${optionIds.length === 1 ? '' : 's'}`,
        T.green,
    );
    headerRow.appendChild(countBadge);

    const toggle = buildToggle(group.active !== false, async (next) => {
        try {
            await apiPatch(`/api/v1/option-groups/${encodeURIComponent(group.option_group_id)}`, { active: next });
            await refreshActiveTab();
        } catch (e) {
            toggle.setValue(!next);
            showToast('Failed to update group', 'error');
        }
    });
    headerRow.appendChild(toggle);

    const editBtn = buildPillButton('Edit', 'ghost', () => {
        showToast('Edit coming soon', 'ok');
    }, { small: true });
    headerRow.appendChild(editBtn);

    card.appendChild(headerRow);

    // Mini option chips inside the group
    const optionsList = document.createElement('div');
    optionsList.style.cssText = `
        display: flex; flex-direction: column; gap: 8px;
        margin-bottom: 12px;
    `;

    const optionsById = new Map(_state.options.map(o => [o.option_id, o]));
    if (optionIds.length === 0) {
        const empty = document.createElement('div');
        empty.textContent = 'No options yet';
        empty.style.cssText = `
            font-family: ${T.fb};
            font-size: ${T.fsB4};
            color: ${T.moon};
            font-style: italic;
            padding: 6px 0;
        `;
        optionsList.appendChild(empty);
    } else {
        optionIds.forEach(oid => {
            const opt = optionsById.get(oid);
            if (!opt) return;
            optionsList.appendChild(buildOptionChip(opt, {
                onRemove: async () => {
                    try {
                        await apiDelete(`/api/v1/option-groups/${encodeURIComponent(group.option_group_id)}/options/${encodeURIComponent(oid)}`);
                        await refreshActiveTab();
                    } catch (e) {
                        showToast('Failed to remove option', 'error');
                    }
                },
            }));
        });
    }
    card.appendChild(optionsList);

    // + Add Option link / inline picker
    card.appendChild(buildAddOptionPicker(group));

    return card;
}

function buildAddOptionPicker(group) {
    const wrap = document.createElement('div');
    wrap.style.cssText = 'margin-top: 4px;';

    let pickerOpen = false;
    let pickerEl = null;

    const link = document.createElement('button');
    link.type = 'button';
    link.textContent = '+ Add Option';
    link.style.cssText = `
        background: transparent;
        border: none;
        padding: 4px 0;
        font-family: ${T.fb};
        font-size: ${T.fsB4};
        font-weight: ${T.fwBold};
        color: ${T.elec};
        cursor: pointer;
        letter-spacing: 0.04em;
    `;
    link.addEventListener('click', () => {
        pickerOpen = !pickerOpen;
        renderPicker();
    });
    wrap.appendChild(link);

    const pickerSlot = document.createElement('div');
    wrap.appendChild(pickerSlot);

    function renderPicker() {
        pickerSlot.replaceChildren();
        if (!pickerOpen) return;

        const taken = new Set(group.option_ids || []);
        const candidates = _state.options.filter(o => !taken.has(o.option_id) && o.active !== false);

        pickerEl = document.createElement('div');
        pickerEl.style.cssText = `
            margin-top: 10px;
            padding: 12px;
            background: ${T.well};
            border-radius: ${T.chamferBtn}px;
            display: flex; flex-wrap: wrap; gap: 8px;
        `;

        if (candidates.length === 0) {
            const empty = document.createElement('div');
            empty.textContent = 'All options are already in this group';
            empty.style.cssText = `
                font-family: ${T.fb};
                font-size: ${T.fsB4};
                color: ${T.moon};
                padding: 4px 8px;
            `;
            pickerEl.appendChild(empty);
        } else {
            candidates.forEach(opt => {
                const accent = priceAccent(opt.price_adjustment, opt.negates_price);
                const chip = document.createElement('button');
                chip.type = 'button';
                chip.textContent = opt.name;
                chip.style.cssText = `
                    padding: 6px 12px;
                    background: transparent;
                    border: 1px solid ${accent};
                    border-radius: 999px;
                    font-family: ${T.fb};
                    font-size: ${T.fsB4};
                    font-weight: ${T.fwBold};
                    color: ${accent};
                    cursor: pointer;
                    transition: background 0.15s ease, color 0.15s ease;
                `;
                chip.addEventListener('mouseenter', () => {
                    chip.style.background = hexToRgba(accent, 0.16);
                });
                chip.addEventListener('mouseleave', () => {
                    chip.style.background = 'transparent';
                });
                chip.addEventListener('click', async () => {
                    chip.disabled = true;
                    try {
                        await apiPost(`/api/v1/option-groups/${encodeURIComponent(group.option_group_id)}/options/${encodeURIComponent(opt.option_id)}`);
                        await refreshActiveTab();
                    } catch (e) {
                        chip.disabled = false;
                        showToast('Failed to add option', 'error');
                    }
                });
                pickerEl.appendChild(chip);
            });
        }
        pickerSlot.appendChild(pickerEl);
    }

    return wrap;
}

function buildOptionGroupAddForm() {
    const form = buildAddFormShell('Add Option Group');

    const nameInput = buildField(form, 'Name *',
        buildTextInput('', { placeholder: 'e.g. Pizza Toppings, Drink Sizes…' }));

    buildFormActions(form, async () => {
        const name = nameInput.value.trim();
        if (!name) { showToast('Name is required', 'error'); return; }
        try {
            await apiPost('/api/v1/option-groups', { name, option_ids: [] });
            _state.showAddForm = false;
            await refreshActiveTab();
            showToast('Option group added');
        } catch (e) {
            showToast('Failed to create group', 'error');
        }
    });

    return form;
}

/* ------------------------------------------
   FORM PRIMITIVES — shared shell for the
   inline Add forms across all three tabs.
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

/* ============================================
   RENDER + LIFECYCLE
============================================ */

function rebuild() {
    if (!_state.wrapper) return;
    _state.wrapper.replaceChildren();

    buildPageHeader(_state.wrapper);
    buildTabBar(_state.wrapper);

    const content = document.createElement('div');
    content.style.cssText = 'min-height: 240px;';
    _state.wrapper.appendChild(content);

    if (_state.activeTab === 'sizes')              buildSizesTab(content);
    else if (_state.activeTab === 'options')       buildOptionsTab(content);
    else if (_state.activeTab === 'option-groups') buildOptionGroupsTab(content);
}

async function refreshActiveTab() {
    try {
        if (_state.activeTab === 'sizes') {
            _state.sizes = await fetchSizes();
        } else if (_state.activeTab === 'options') {
            _state.options = await fetchOptions();
        } else if (_state.activeTab === 'option-groups') {
            // Option groups need both lists — render mini option chips by id.
            const [groups, options] = await Promise.all([
                fetchOptionGroups(),
                fetchOptions(),
            ]);
            _state.optionGroups = groups;
            _state.options = options;
        }
    } catch (e) {
        console.error('[PricingSetup] Refresh failed:', e);
    }
    rebuild();
}

export function buildPricingSetupScene(container) {
    _state.container = container;
    _state.activeTab = 'sizes';
    _state.showAddForm = false;
    _state.sizes = [];
    _state.options = [];
    _state.optionGroups = [];

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
    refreshActiveTab().catch(e => console.error('[PricingSetup] Initial load failed:', e));
}

export function cleanupPricingSetup(container) {
    if (container) container.replaceChildren();
    _state.container = null;
    _state.wrapper = null;
    _state.sizes = [];
    _state.options = [];
    _state.optionGroups = [];
    _state.showAddForm = false;
}
