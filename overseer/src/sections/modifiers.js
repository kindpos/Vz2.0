/* ============================================
   KINDpos Overseer — Modifiers (master lists)

   Two side-by-side master lists:
     LEFT  (T.gold)     — Modifiers
     RIGHT (T.lavender) — Options

   Group membership is owned by the Groups screen and
   never appears here.

   Endpoints:
     GET   /api/v1/modifiers
     POST  /api/v1/modifiers
     PATCH /api/v1/modifiers/{id}
     GET   /api/v1/options
     POST  /api/v1/options
     PATCH /api/v1/options/{id}

   All visual values flow from common/tokens.js.
   ============================================ */

import { T } from '../../../common/tokens.js';
import { buildStaticCard, hexToRgba } from '../../../common/theme.js';
import { pushChanges } from '../services/config-push.js';
import { fetchWithTimeout } from '../services/http.js';

/* ------------------------------------------
   STATE
------------------------------------------ */
const _state = {
    container: null,
    wrapper: null,

    modifiers: [],
    options: [],

    editingModifierId: null,
    editingOptionId: null,
    addingModifier: false,
    addingOption: false,

    loadError: false,
};

/* ------------------------------------------
   FORMATTERS
------------------------------------------ */
const fmtPrice = (n) => '$' + Number(n || 0).toFixed(2); ;
const fmtPriceAdj = (n) => {
    const v = Number(n || 0);
    if (v > 0) return '+$' + v.toFixed(2);
    if (v < 0) return '−$' + Math.abs(v).toFixed(2);
    return '±$0.00';
}
const priceAdjColor = (n) => {
    const v = Number(n || 0);
    if (v > 0) return T.gold;
    if (v < 0) return T.verm;
    return T.moon;
}

/* ------------------------------------------
   API
------------------------------------------ */
const apiGet = async (url) => {
    const res = await fetchWithTimeout(url);
    if (!res.ok) throw new Error(`GET ${url} → ${res.status}`);
    return res.json();
}
const apiPost = async (url, body) => {
    const res = await fetchWithTimeout(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: body == null ? undefined : JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`POST ${url} → ${res.status}`);
    return res.json();
}
const apiPatch = async (url, body) => {
    const res = await fetchWithTimeout(url, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`PATCH ${url} → ${res.status}`);
    return res.json();
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
    const btn = document.createElement('button');
    btn.type = 'button';

    function apply() {
        btn.style.cssText = `
            width: 34px;
            height: 18px;
            border-radius: 999px;
            background: ${state ? T.greenWarm : T.moonDk};
            border: none;
            position: relative;
            cursor: pointer;
            outline: none;
            transition: background 0.15s ease;
            flex-shrink: 0;
        `;
        btn.replaceChildren();
        const knob = document.createElement('span');
        knob.style.cssText = `
            position: absolute;
            top: 3px;
            left: ${state ? '19px' : '3px'};
            width: 12px;
            height: 12px;
            border-radius: 50%;
            background: ${T.well};
            transition: left 0.15s ease;
        `;
        btn.appendChild(knob);
    }
    apply();

    btn.getValue = () => state;
    btn.setValue = (v) => { state = !!v; apply(); };
    btn.addEventListener('click', (e) => {
        e.stopPropagation();
        state = !state;
        apply();
        if (onChange) onChange(state);
    });
    return btn;
}

const buildPillButton = (label, fillColor, textColor, onClick) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = label;
    const shadow = hexToRgba(fillColor, 0.45);
    b.style.cssText = `
        display: inline-flex; align-items: center; justify-content: center;
        padding: 6px 14px;
        background: ${fillColor};
        color: ${textColor};
        border: none;
        border-radius: 999px;
        font-family: ${T.fb};
        font-size: 9px;
        font-weight: 700;
        letter-spacing: 0.08em;
        text-transform: uppercase;
        cursor: pointer;
        outline: none;
        box-shadow: 0 3px 0 ${shadow};
        transition: transform 0.08s ease, box-shadow 0.08s ease;
        white-space: nowrap;
    `;
    b.addEventListener('mousedown', () => {
        b.style.transform = 'translateY(2px)';
        b.style.boxShadow = `0 1px 0 ${shadow}`;
    });
    const reset = () => {
        b.style.transform = 'translateY(0)';
        b.style.boxShadow = `0 3px 0 ${shadow}`;
    };
    b.addEventListener('mouseup', reset);
    b.addEventListener('mouseleave', reset);
    if (onClick) b.addEventListener('click', onClick);
    return b;
}

const buildGhostButton = (label, onClick) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = label;
    b.style.cssText = `
        background: transparent;
        border: 1px solid ${hexToRgba(T.moon, 0.5)};
        color: ${T.moon};
        font-family: ${T.fb};
        font-size: 9px;
        font-weight: 700;
        letter-spacing: 0.08em;
        text-transform: uppercase;
        padding: 5px 14px;
        border-radius: 999px;
        cursor: pointer;
        outline: none;
        white-space: nowrap;
    `;
    if (onClick) b.addEventListener('click', onClick);
    return b;
}

const buildNegatesBadge = () => {
    const el = document.createElement('span');
    el.textContent = 'NEGATES';
    el.style.cssText = `
        display: inline-flex; align-items: center;
        background: ${T.verm};
        color: ${T.text};
        border-radius: 5px;
        padding: 2px 8px;
        font-family: ${T.fb};
        font-size: 9px;
        font-weight: 700;
        letter-spacing: 0.1em;
        text-transform: uppercase;
    `;
    return el;
}

const buildTextInput = (value, opts = {}) => {
    const input = document.createElement('input');
    input.type = 'text';
    input.value = value || '';
    if (opts.placeholder) input.placeholder = opts.placeholder;
    input.style.cssText = `
        flex: 1;
        min-width: 0;
        box-sizing: border-box;
        background: ${T.well};
        border: 1px solid ${T.border};
        border-radius: 6px;
        padding: 6px 10px;
        font-family: ${T.fb};
        font-size: 12px;
        font-weight: 600;
        color: ${T.text};
        outline: none;
    `;
    input.addEventListener('focus', () => { input.style.borderColor = opts.focusColor || T.elec; });
    input.addEventListener('blur',  () => { input.style.borderColor = T.border; });
    return input;
}

const buildPriceInput = (value, opts = {}) => {
    const wrap = document.createElement('div');
    wrap.style.cssText = 'display: flex; align-items: center; gap: 2px;';

    const dollar = document.createElement('span');
    dollar.textContent = '$';
    dollar.style.cssText = `
        font-family: ${T.fb};
        font-size: 13px;
        font-weight: 700;
        color: ${T.moon};
    `;
    wrap.appendChild(dollar);

    const input = document.createElement('input');
    input.type = 'text';
    input.inputMode = 'decimal';
    const seed = Number(value || 0);
    input.value = isNaN(seed) ? '0.00' : seed.toFixed(2);
    input.style.cssText = `
        width: ${opts.width || '90px'};
        box-sizing: border-box;
        background: ${T.well};
        border: 1px solid ${T.border};
        border-radius: 6px;
        padding: 6px 10px;
        font-family: ${T.fb};
        font-size: 12px;
        font-weight: 700;
        color: ${T.gold};
        text-align: right;
        outline: none;
    `;

    input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); input.blur(); return; }
        if (opts.allowSign && e.key === '-' && input.selectionStart === 0 && !input.value.includes('-')) return;
        if (e.key.length > 1 || e.ctrlKey || e.metaKey || e.altKey) return;
        const isDigit = e.key >= '0' && e.key <= '9';
        const isDecimal = e.key === '.';
        if (!isDigit && !isDecimal) { e.preventDefault(); return; }
        const v = input.value;
        if (isDecimal && v.includes('.')) { e.preventDefault(); return; }
        const numericPart = v.startsWith('-') ? v.slice(1) : v;
        if (isDigit && !numericPart.includes('.') && numericPart.length >= 2) {
            e.preventDefault();
            input.value = v + '.' + e.key;
            input.dispatchEvent(new Event('input'));
            return;
        }
        if (isDigit && v.includes('.')) {
            const cursorPos = input.selectionStart;
            const dotIdx = v.indexOf('.');
            const fracPart = v.slice(dotIdx + 1);
            if (cursorPos > dotIdx && fracPart.length >= 2 && cursorPos === input.selectionEnd) {
                e.preventDefault();
            }
        }
    });

    input.addEventListener('blur', () => {
        const n = parseFloat(input.value);
        input.value = isNaN(n) ? '0.00' : n.toFixed(2);
    });

    wrap.appendChild(input);
    wrap.input = input;
    wrap.getValue = () => parseFloat(input.value) || 0;
    return wrap;
}

const buildErrorState = (retry) => {
    const el = document.createElement('div');
    el.textContent = 'Failed to load — tap to retry';
    el.style.cssText = `
        padding: 32px 0;
        text-align: center;
        font-family: ${T.fb};
        font-size: 11px;
        color: ${T.verm};
        cursor: pointer;
    `;
    el.addEventListener('click', retry);
    return el;
}

const buildEmptyState = (text) => {
    const el = document.createElement('div');
    el.textContent = text;
    el.style.cssText = `
        padding: 20px 0;
        text-align: center;
        font-family: ${T.fb};
        font-size: 11px;
        color: ${T.moon};
    `;
    return el;
}

/* ============================================
   LEFT CARD — MODIFIERS
============================================ */
const MODIFIER_GRID = '1.6fr 100px 50px';

const buildModifiersCard = () => {
    const card = buildStaticCard({ accent: T.gold });
    card.className = 'kindpos-scrollbar-hide';
    card.style.flex = '1';
    card.style.alignSelf = 'stretch';
    card.style.minHeight = '0';
    card.style.padding = '0';
    card.style.overflowY = 'auto';
    card.style.scrollbarWidth = 'none';
    card.style.msOverflowStyle = 'none';
    card.style.display = 'flex';
    card.style.flexDirection = 'column';

    const content = document.createElement('div');
    content.style.cssText = 'flex: 1; min-height: 0; padding: 14px 16px 14px 22px; box-sizing: border-box;';
    card.appendChild(content);

    const header = document.createElement('div');
    header.style.cssText = 'display: flex; align-items: center; justify-content: space-between; margin-bottom: 12px;';

    const title = document.createElement('div');
    title.textContent = 'MODIFIERS';
    title.style.cssText = `
        font-family: ${T.fb};
        font-size: 11px;
        font-weight: 700;
        color: ${T.gold};
        letter-spacing: 2.5px;
        text-transform: uppercase;
    `;
    header.appendChild(title);

    header.appendChild(buildPillButton(
        '+ Add Modifier',
        T.greenWarm,
        T.well,
        () => {
            _state.addingModifier = true;
            _state.editingModifierId = null;
            rebuild();
        },
    ));
    content.appendChild(header);

    if (_state.loadError) {
        content.appendChild(buildErrorState(() => refreshAll()));
        return card;
    }

    if (_state.addingModifier) content.appendChild(buildModifierAddPanel());

    content.appendChild(buildModifierColHeaders());

    if (_state.modifiers.length === 0) {
        content.appendChild(buildEmptyState('No modifiers yet — tap + Add Modifier'));
    } else {
        _state.modifiers.forEach(m => content.appendChild(buildModifierRow(m)));
    }

    return card;
}

const buildModifierColHeaders = () => {
    const wrap = document.createElement('div');
    wrap.style.cssText = `
        display: grid;
        grid-template-columns: ${MODIFIER_GRID};
        gap: 10px;
        align-items: center;
        padding: 0 0 6px;
        border-bottom: 1px solid ${hexToRgba(T.border, 0.5)};
    `;
    const labels = ['NAME', 'BASE PRICE', 'ACTIVE'];
    labels.forEach((label, i) => {
        const cell = document.createElement('div');
        cell.textContent = label;
        cell.style.cssText = `
            font-family: ${T.fb};
            font-size: 9px;
            font-weight: 700;
            color: ${T.moonDk};
            letter-spacing: 2px;
            text-transform: uppercase;
            text-align: ${i === 1 ? 'right' : (i === 2 ? 'center' : 'left')};
        `;
        wrap.appendChild(cell);
    });
    return wrap;
}

const buildModifierRow = (modifier) => {
    const wrap = document.createElement('div');
    wrap.style.cssText = `
        border-bottom: 1px solid rgba(255,255,255,0.04);
    `;

    const row = document.createElement('div');
    row.style.cssText = `
        display: grid;
        grid-template-columns: ${MODIFIER_GRID};
        gap: 10px;
        align-items: center;
        padding: 12px 0;
        cursor: pointer;
        transition: background 0.1s ease;
    `;
    row.addEventListener('mouseenter', () => {
        row.style.background = hexToRgba(T.gold, 0.04);
    });
    row.addEventListener('mouseleave', () => {
        row.style.background = 'transparent';
    });

    const nameCell = document.createElement('div');
    nameCell.textContent = modifier.name || modifier.modifier_id;
    nameCell.style.cssText = `
        font-family: ${T.fb};
        font-size: 13px;
        font-weight: 600;
        color: ${T.text};
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
    `;
    row.appendChild(nameCell);

    const price = Number(modifier.price || 0);
    const priceCell = document.createElement('div');
    priceCell.textContent = fmtPrice(price);
    priceCell.style.cssText = `
        font-family: ${T.fb};
        font-size: 12px;
        font-weight: 700;
        color: ${price > 0 ? T.gold : T.moon};
        text-align: right;
    `;
    row.appendChild(priceCell);

    const toggleCell = document.createElement('div');
    toggleCell.style.cssText = 'display: flex; justify-content: center; align-items: center;';
    const toggle = buildToggle(modifier.active !== false, async (v) => {
        try {
            await pushChanges([{ event_type: 'modifier.updated', payload: { modifier_id: modifier.modifier_id, active: v } }]);
            modifier.active = v;
        } catch (e) {
            toggle.setValue(!v);
            showToast('Failed to update modifier', 'error');
        }
    });
    toggleCell.appendChild(toggle);
    row.appendChild(toggleCell);

    row.addEventListener('click', (e) => {
        if (e.target.closest('button')) return;
        _state.editingModifierId =
            _state.editingModifierId === modifier.modifier_id ? null : modifier.modifier_id;
        _state.editingOptionId = null;
        _state.addingModifier = false;
        rebuild();
    });

    wrap.appendChild(row);

    if (_state.editingModifierId === modifier.modifier_id) {
        wrap.appendChild(buildModifierEditPanel(modifier));
    }

    return wrap;
}

const buildModifierAddPanel = () => {
    const panel = document.createElement('div');
    panel.style.cssText = `
        background: ${hexToRgba(T.gold, 0.06)};
        border-radius: 8px;
        padding: 12px 14px;
        margin: 0 0 12px;
        display: flex;
        flex-direction: column;
        gap: 10px;
    `;

    const nameRow = document.createElement('div');
    nameRow.style.cssText = 'display: flex; align-items: center; gap: 10px;';
    const nameLabel = document.createElement('div');
    nameLabel.textContent = 'Name';
    nameLabel.style.cssText = editLabelCSS();
    nameRow.appendChild(nameLabel);
    const nameInput = buildTextInput('', { focusColor: T.gold, placeholder: 'e.g. Pepperoni' });
    nameRow.appendChild(nameInput);
    panel.appendChild(nameRow);

    const priceRow = document.createElement('div');
    priceRow.style.cssText = 'display: flex; align-items: center; gap: 10px;';
    const priceLabel = document.createElement('div');
    priceLabel.textContent = 'Price';
    priceLabel.style.cssText = editLabelCSS();
    priceRow.appendChild(priceLabel);
    const priceInput = buildPriceInput(0);
    priceRow.appendChild(priceInput);
    panel.appendChild(priceRow);

    const btnRow = document.createElement('div');
    btnRow.style.cssText = 'display: flex; justify-content: flex-end; gap: 8px;';
    btnRow.appendChild(buildGhostButton('Cancel', () => {
        _state.addingModifier = false;
        rebuild();
    }));
    btnRow.appendChild(buildPillButton('Create', T.greenWarm, T.well, async () => {
        const name = nameInput.value.trim();
        const priceVal = priceInput.getValue();
        if (!name) { showToast('Name is required', 'error'); return; }
        try {
            await pushChanges([{ event_type: 'modifier.created', payload: { name, price: priceVal } }]);
            _state.addingModifier = false;
            await refreshAll();
            showToast('Modifier created');
        } catch (e) {
            showToast('Failed to create modifier', 'error');
        }
    }));
    panel.appendChild(btnRow);
    return panel;
}

const buildModifierEditPanel = (modifier) => {
    const panel = document.createElement('div');
    panel.style.cssText = `
        background: ${hexToRgba(T.gold, 0.06)};
        border-radius: 8px;
        padding: 12px 14px;
        margin: 4px 0 10px;
        display: flex;
        flex-direction: column;
        gap: 10px;
    `;

    const nameRow = document.createElement('div');
    nameRow.style.cssText = 'display: flex; align-items: center; gap: 10px;';
    const nameLabel = document.createElement('div');
    nameLabel.textContent = 'Name';
    nameLabel.style.cssText = editLabelCSS();
    nameRow.appendChild(nameLabel);
    const nameInput = buildTextInput(modifier.name || '', { focusColor: T.gold });
    nameRow.appendChild(nameInput);
    panel.appendChild(nameRow);

    const priceRow = document.createElement('div');
    priceRow.style.cssText = 'display: flex; align-items: center; gap: 10px;';
    const priceLabel = document.createElement('div');
    priceLabel.textContent = 'Price';
    priceLabel.style.cssText = editLabelCSS();
    priceRow.appendChild(priceLabel);
    const priceInput = buildPriceInput(modifier.price || 0);
    priceRow.appendChild(priceInput);
    panel.appendChild(priceRow);

    const btnRow = document.createElement('div');
    btnRow.style.cssText = 'display: flex; justify-content: flex-end; gap: 8px; margin-top: 4px;';
    btnRow.appendChild(buildGhostButton('Cancel', () => {
        _state.editingModifierId = null;
        rebuild();
    }));
    btnRow.appendChild(buildPillButton('Save', T.greenWarm, T.well, async () => {
        const newName = nameInput.value.trim();
        const newPrice = priceInput.getValue();
        if (!newName) { showToast('Name is required', 'error'); return; }
        const body = {};
        if (newName !== (modifier.name || '')) body.name = newName;
        if (Math.abs(newPrice - Number(modifier.price || 0)) >= 0.005) body.price = newPrice;
        if (Object.keys(body).length === 0) {
            _state.editingModifierId = null;
            rebuild();
            return;
        }
        try {
            await pushChanges([{ event_type: 'modifier.updated', payload: { modifier_id: modifier.modifier_id, ...body } }]);
            if (body.name != null) modifier.name = body.name;
            if (body.price != null) modifier.price = body.price;
            _state.editingModifierId = null;
            await refreshAll();
            showToast('Modifier saved');
        } catch (e) {
            showToast('Failed to save modifier', 'error');
        }
    }));
    panel.appendChild(btnRow);

    return panel;
}

/* ============================================
   RIGHT CARD — OPTIONS
============================================ */
const OPTION_GRID = '1.4fr 100px 100px 50px';

const buildOptionsCard = () => {
    const card = buildStaticCard({ accent: T.lavender });
    card.className = 'kindpos-scrollbar-hide';
    card.style.flex = '1';
    card.style.alignSelf = 'stretch';
    card.style.minHeight = '0';
    card.style.padding = '0';
    card.style.overflowY = 'auto';
    card.style.scrollbarWidth = 'none';
    card.style.msOverflowStyle = 'none';
    card.style.display = 'flex';
    card.style.flexDirection = 'column';

    const content = document.createElement('div');
    content.style.cssText = 'flex: 1; min-height: 0; padding: 14px 16px 14px 22px; box-sizing: border-box;';
    card.appendChild(content);

    const header = document.createElement('div');
    header.style.cssText = 'display: flex; align-items: center; justify-content: space-between; margin-bottom: 12px;';

    const title = document.createElement('div');
    title.textContent = 'OPTIONS';
    title.style.cssText = `
        font-family: ${T.fb};
        font-size: 11px;
        font-weight: 700;
        color: ${T.lavender};
        letter-spacing: 2.5px;
        text-transform: uppercase;
    `;
    header.appendChild(title);

    header.appendChild(buildPillButton(
        '+ Add Option',
        T.lavender,
        T.well,
        () => {
            _state.addingOption = true;
            _state.editingOptionId = null;
            rebuild();
        },
    ));
    content.appendChild(header);

    if (_state.loadError) {
        content.appendChild(buildErrorState(() => refreshAll()));
        return card;
    }

    if (_state.addingOption) content.appendChild(buildOptionAddPanel());

    content.appendChild(buildOptionColHeaders());

    if (_state.options.length === 0) {
        content.appendChild(buildEmptyState('No options yet — tap + Add Option'));
    } else {
        _state.options.forEach(o => content.appendChild(buildOptionRow(o)));
    }

    return card;
}

const buildOptionColHeaders = () => {
    const wrap = document.createElement('div');
    wrap.style.cssText = `
        display: grid;
        grid-template-columns: ${OPTION_GRID};
        gap: 10px;
        align-items: center;
        padding: 0 0 6px;
        border-bottom: 1px solid ${hexToRgba(T.border, 0.5)};
    `;
    const labels = ['NAME', 'PRICE ADJ', 'FLAGS', 'ACTIVE'];
    labels.forEach((label, i) => {
        const cell = document.createElement('div');
        cell.textContent = label;
        cell.style.cssText = `
            font-family: ${T.fb};
            font-size: 9px;
            font-weight: 700;
            color: ${T.moonDk};
            letter-spacing: 2px;
            text-transform: uppercase;
            text-align: ${i === 1 ? 'right' : (i === 3 ? 'center' : 'left')};
        `;
        wrap.appendChild(cell);
    });
    return wrap;
}

const buildOptionRow = (option) => {
    const wrap = document.createElement('div');
    wrap.style.cssText = `
        border-bottom: 1px solid rgba(255,255,255,0.04);
    `;

    const row = document.createElement('div');
    row.style.cssText = `
        display: grid;
        grid-template-columns: ${OPTION_GRID};
        gap: 10px;
        align-items: center;
        padding: 12px 0;
        cursor: pointer;
        transition: background 0.1s ease;
    `;
    row.addEventListener('mouseenter', () => {
        row.style.background = hexToRgba(T.lavender, 0.04);
    });
    row.addEventListener('mouseleave', () => {
        row.style.background = 'transparent';
    });

    const nameCell = document.createElement('div');
    nameCell.textContent = option.name || option.option_id;
    nameCell.style.cssText = `
        font-family: ${T.fb};
        font-size: 13px;
        font-weight: 600;
        color: ${T.text};
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
    `;
    row.appendChild(nameCell);

    const adj = Number(option.price_adjustment || 0);
    const adjCell = document.createElement('div');
    adjCell.textContent = fmtPriceAdj(adj);
    adjCell.style.cssText = `
        font-family: ${T.fb};
        font-size: 12px;
        font-weight: 700;
        color: ${priceAdjColor(adj)};
        text-align: right;
    `;
    row.appendChild(adjCell);

    const flagsCell = document.createElement('div');
    flagsCell.style.cssText = 'display: flex; align-items: center; gap: 4px;';
    if (option.negates_price) flagsCell.appendChild(buildNegatesBadge());
    row.appendChild(flagsCell);

    const toggleCell = document.createElement('div');
    toggleCell.style.cssText = 'display: flex; justify-content: center; align-items: center;';
    const toggle = buildToggle(option.active !== false, async (v) => {
        try {
            await apiPatch(`/api/v1/options/${encodeURIComponent(option.option_id)}`, { active: v });
            option.active = v;
        } catch (e) {
            toggle.setValue(!v);
            showToast('Failed to update option', 'error');
        }
    });
    toggleCell.appendChild(toggle);
    row.appendChild(toggleCell);

    row.addEventListener('click', (e) => {
        if (e.target.closest('button')) return;
        _state.editingOptionId =
            _state.editingOptionId === option.option_id ? null : option.option_id;
        _state.editingModifierId = null;
        _state.addingOption = false;
        rebuild();
    });

    wrap.appendChild(row);

    if (_state.editingOptionId === option.option_id) {
        wrap.appendChild(buildOptionEditPanel(option));
    }

    return wrap;
}

const buildOptionAddPanel = () => {
    const panel = document.createElement('div');
    panel.style.cssText = `
        background: ${hexToRgba(T.lavender, 0.07)};
        border-radius: 8px;
        padding: 12px 14px;
        margin: 0 0 12px;
        display: flex;
        flex-direction: column;
        gap: 10px;
    `;

    const nameRow = document.createElement('div');
    nameRow.style.cssText = 'display: flex; align-items: center; gap: 10px;';
    const nameLabel = document.createElement('div');
    nameLabel.textContent = 'Name';
    nameLabel.style.cssText = editLabelCSS();
    nameRow.appendChild(nameLabel);
    const nameInput = buildTextInput('', { focusColor: T.lavender, placeholder: 'e.g. No Cheese' });
    nameRow.appendChild(nameInput);
    panel.appendChild(nameRow);

    const adjRow = document.createElement('div');
    adjRow.style.cssText = 'display: flex; align-items: center; gap: 10px;';
    const adjLabel = document.createElement('div');
    adjLabel.textContent = 'Price Adj';
    adjLabel.style.cssText = editLabelCSS();
    adjRow.appendChild(adjLabel);
    const adjInput = buildPriceInput(0, { allowSign: true });
    adjRow.appendChild(adjInput);
    panel.appendChild(adjRow);

    const negRow = document.createElement('div');
    negRow.style.cssText = 'display: flex; align-items: center; gap: 10px;';
    const negLabel = document.createElement('div');
    negLabel.textContent = 'Negates Price';
    negLabel.style.cssText = editLabelCSS();
    negRow.appendChild(negLabel);
    const negToggle = buildToggle(false);
    negRow.appendChild(negToggle);
    panel.appendChild(negRow);

    const btnRow = document.createElement('div');
    btnRow.style.cssText = 'display: flex; justify-content: flex-end; gap: 8px;';
    btnRow.appendChild(buildGhostButton('Cancel', () => {
        _state.addingOption = false;
        rebuild();
    }));
    btnRow.appendChild(buildPillButton('Create', T.lavender, T.well, async () => {
        const name = nameInput.value.trim();
        const adjVal = adjInput.getValue();
        const negVal = negToggle.getValue();
        if (!name) { showToast('Name is required', 'error'); return; }
        try {
            await apiPost('/api/v1/options', {
                name,
                price_adjustment: adjVal,
                negates_price: negVal,
            });
            _state.addingOption = false;
            await refreshAll();
            showToast('Option created');
        } catch (e) {
            showToast('Failed to create option', 'error');
        }
    }));
    panel.appendChild(btnRow);
    return panel;
}

const buildOptionEditPanel = (option) => {
    const panel = document.createElement('div');
    panel.style.cssText = `
        background: ${hexToRgba(T.lavender, 0.07)};
        border-radius: 8px;
        padding: 12px 14px;
        margin: 4px 0 10px;
        display: flex;
        flex-direction: column;
        gap: 10px;
    `;

    const nameRow = document.createElement('div');
    nameRow.style.cssText = 'display: flex; align-items: center; gap: 10px;';
    const nameLabel = document.createElement('div');
    nameLabel.textContent = 'Name';
    nameLabel.style.cssText = editLabelCSS();
    nameRow.appendChild(nameLabel);
    const nameInput = buildTextInput(option.name || '', { focusColor: T.lavender });
    nameRow.appendChild(nameInput);
    panel.appendChild(nameRow);

    const adjRow = document.createElement('div');
    adjRow.style.cssText = 'display: flex; align-items: center; gap: 10px;';
    const adjLabel = document.createElement('div');
    adjLabel.textContent = 'Price Adj';
    adjLabel.style.cssText = editLabelCSS();
    adjRow.appendChild(adjLabel);
    const adjInput = buildPriceInput(option.price_adjustment || 0, { allowSign: true });
    adjRow.appendChild(adjInput);
    panel.appendChild(adjRow);

    const negRow = document.createElement('div');
    negRow.style.cssText = 'display: flex; align-items: center; gap: 10px;';
    const negLabel = document.createElement('div');
    negLabel.textContent = 'Negates Price';
    negLabel.style.cssText = editLabelCSS();
    negRow.appendChild(negLabel);
    const negToggle = buildToggle(!!option.negates_price);
    negRow.appendChild(negToggle);
    panel.appendChild(negRow);

    const btnRow = document.createElement('div');
    btnRow.style.cssText = 'display: flex; justify-content: flex-end; gap: 8px; margin-top: 4px;';
    btnRow.appendChild(buildGhostButton('Cancel', () => {
        _state.editingOptionId = null;
        rebuild();
    }));
    btnRow.appendChild(buildPillButton('Save', T.lavender, T.well, async () => {
        const newName = nameInput.value.trim();
        const newAdj  = adjInput.getValue();
        const newNeg  = negToggle.getValue();
        if (!newName) { showToast('Name is required', 'error'); return; }
        const body = {};
        if (newName !== (option.name || '')) body.name = newName;
        if (Math.abs(newAdj - Number(option.price_adjustment || 0)) >= 0.005) body.price_adjustment = newAdj;
        if (newNeg !== !!option.negates_price) body.negates_price = newNeg;
        if (Object.keys(body).length === 0) {
            _state.editingOptionId = null;
            rebuild();
            return;
        }
        try {
            await apiPatch(`/api/v1/options/${encodeURIComponent(option.option_id)}`, body);
            if (body.name != null) option.name = body.name;
            if (body.price_adjustment != null) option.price_adjustment = body.price_adjustment;
            if (body.negates_price != null) option.negates_price = body.negates_price;
            _state.editingOptionId = null;
            await refreshAll();
            showToast('Option saved');
        } catch (e) {
            showToast('Failed to save option', 'error');
        }
    }));
    panel.appendChild(btnRow);

    return panel;
}

const editLabelCSS = () => `
        font-family: ${T.fb};
        font-size: 9px;
        font-weight: 700;
        color: ${T.moon};
        letter-spacing: 0.16em;
        text-transform: uppercase;
        width: 96px;
        flex-shrink: 0;
    `;

/* ============================================
   RENDER + LIFECYCLE
============================================ */
const rebuild = () => {
    if (!_state.wrapper) return;
    _state.wrapper.replaceChildren();
    _state.wrapper.appendChild(buildModifiersCard());
    _state.wrapper.appendChild(buildOptionsCard());
}

const refreshAll = async () => {
    _state.loadError = false;
    try {
        const [modifiers, options] = await Promise.all([
            apiGet('/api/v1/modifiers'),
            apiGet('/api/v1/options'),
        ]);
        _state.modifiers = (modifiers || []).slice();
        _state.options = (options || []).slice();
    } catch (e) {
        console.error('[Modifiers] Refresh failed:', e);
        _state.loadError = true;
        _state.modifiers = [];
        _state.options = [];
    }

    if (_state.editingModifierId &&
        !_state.modifiers.some(m => m.modifier_id === _state.editingModifierId)) {
        _state.editingModifierId = null;
    }
    if (_state.editingOptionId &&
        !_state.options.some(o => o.option_id === _state.editingOptionId)) {
        _state.editingOptionId = null;
    }
    rebuild();
}

export function buildModifiersScene(container) {
    _state.container = container;
    _state.editingModifierId = null;
    _state.editingOptionId = null;
    _state.addingModifier = false;
    _state.addingOption = false;
    _state.loadError = false;

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

export function cleanupModifiers(container) {
    if (container) container.replaceChildren();
    _state.container = null;
    _state.wrapper = null;
    _state.modifiers = [];
    _state.options = [];
    _state.editingModifierId = null;
    _state.editingOptionId = null;
    _state.addingModifier = false;
    _state.addingOption = false;
    _state.loadError = false;
}
