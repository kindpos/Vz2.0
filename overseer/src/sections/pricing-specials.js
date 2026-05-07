import { pushChanges } from '../services/config-push.js';
import {
    C, buildScenePage, showToast, withAlpha,
} from '../ui/forms.js';
import { fetchWithTimeout } from '../services/http.js';

/* ============================================
   KINDpos Overseer — Specials & Discounts (Nostalgia)

   Accordion scene consolidating:
     — Day Parts (scheduling primitive for specials)
     — Specials (promotional pricing events)
     — Order Type Pricing (Dine-In/Takeout/Delivery %)
     — Employee Discount (staff policy)
     — Void Reasons (manager void flow policy)

   Locked per specials-discounts-reskin-spec.md.
   Nice. Dependable. Yours.
   ============================================ */

const C2 = {
    warning:   '#fbbf24',
    warningBg: 'rgba(251,191,36,0.08)',
    hairline:  '#2a2d32',
    lavender:  '#b48efa',
};

const DAY_LABELS = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'];

/* ─── MODULE STATE ───────────────────────────────────────────── */
let bodyMount = null;
let currentSaveBar = null;
let footerMount = null;

let pricingData = {
    day_parts:          [],
    specials:           [],
    order_types:        [],
    employee_discount:  null,
    void_reasons:       [],
    discounts:          [],
    categories:         [],
};

let pendingChanges = {
    day_parts_new: [],       day_parts_edited: [],     day_parts_deleted: [],
    specials_new: [],        specials_edited: [],      specials_deleted: [],
    order_types_edited: [],
    employee_edited: null,
    discounts_new: [],       discounts_edited: [],     discounts_deleted: [],
    void_reasons_new: [],    void_reasons_edited: [],  void_reasons_deleted: [],
};

let displayState = {
    openSection: 'specials',   // one of: day-parts, specials, order-types, employee, void-reasons, null
};

const modalStack = [];

/* ─── HELPERS ────────────────────────────────────────────────── */
const clone = (o) => JSON.parse(JSON.stringify(o)); ;

const getPendingCount = () => pendingChanges.day_parts_new.length
         + pendingChanges.day_parts_edited.length
         + pendingChanges.day_parts_deleted.length
         + pendingChanges.specials_new.length
         + pendingChanges.specials_edited.length
         + pendingChanges.specials_deleted.length
         + pendingChanges.order_types_edited.length
         + (pendingChanges.employee_edited ? 1 : 0)
         + pendingChanges.void_reasons_new.length
         + pendingChanges.void_reasons_edited.length
         + pendingChanges.void_reasons_deleted.length;
;

const defaultWindow = () => ({ label: '', days: [1,1,1,1,1,1,1], start: '09:00', end: '17:00' });

const defaultDayPart = () => ({
        id:          `temp_dp_${Date.now()}`,
        name:        '',
        description: '',
        windows:     [defaultWindow()],
    });

const defaultSpecial = () => ({
        id:             `temp_spec_${Date.now()}`,
        name:           '',
        discount_type:  'percentage',
        discount_value: 0,
        schedule: {
            mode:           'daypart',
            daypart_ids:    [],
            custom_windows: [],
        },
        scope: {
            mode: 'all',
            ids:  [],
        },
        apply_mode:    'auto',
        requires_pin:  false,
        stacking:      false,
        priority:      1,
        active:        true,
    });

const defaultEmployee = () => ({
        id:                 'emp_disc',
        separate_rates:     false,
        percentage:         20,
        on_duty_rate:       50,
        off_duty_rate:      20,
        applies_to:         'food_only',
        exclude_categories: [],
        requires_pin:       true,
        active:             true,
    });

const defaultVoidReason = () => ({
        id:           `temp_void_${Date.now()}`,
        name:         '',
        requires_pin: true,
        max_amount:   null,
        active:       true,
    });

/* ─── DATA FETCH ─────────────────────────────────────────────── */
const migrateDayPart = (raw) => {
    if (Array.isArray(raw.windows) && raw.windows.length > 0) {
        return {
            id:          raw.id || `dp_${Date.now()}`,
            name:        raw.name || '',
            description: raw.description || '',
            windows:     raw.windows.map(w => ({
                label: w.label || '',
                days:  Array.isArray(w.days) && w.days.length === 7 ? w.days.slice() : [1,1,1,1,1,1,1],
                start: w.start || '09:00',
                end:   w.end   || '17:00',
            })),
        };
    }
    // legacy single-window shape
    return {
        id:          raw.id || `dp_${Date.now()}`,
        name:        raw.name || '',
        description: raw.description || '',
        windows: [{
            label: '',
            days:  [1,1,1,1,1,1,1],
            start: raw.time_start || '09:00',
            end:   raw.time_end   || '17:00',
        }],
    };
}

const migrateSpecial = (raw) => {
    let schedule;
    if (raw.schedule && typeof raw.schedule === 'object') {
        schedule = {
            mode:           raw.schedule.mode || 'daypart',
            daypart_ids:    Array.isArray(raw.schedule.daypart_ids) ? raw.schedule.daypart_ids.slice() : [],
            custom_windows: Array.isArray(raw.schedule.custom_windows) ? raw.schedule.custom_windows.map(w => ({
                label: w.label || '', days: w.days || [1,1,1,1,1,1,1],
                start: w.start || '09:00', end: w.end || '17:00',
            })) : [],
        };
    } else if (raw.schedule_mode === 'manual') {
        schedule = { mode: 'manual', daypart_ids: [], custom_windows: [] };
    } else if (raw.schedule_mode === 'auto' || raw.time_start) {
        schedule = {
            mode: 'custom',
            daypart_ids: [],
            custom_windows: [{
                label: '',
                days:  Array.isArray(raw.active_days) && raw.active_days.length === 7
                          ? raw.active_days.map(x => x ? 1 : 0)
                          : [1,1,1,1,1,1,1],
                start: raw.time_start || '09:00',
                end:   raw.time_end   || '17:00',
            }],
        };
    } else {
        schedule = { mode: 'daypart', daypart_ids: [], custom_windows: [] };
    }

    let scope;
    if (raw.scope && typeof raw.scope === 'object') {
        scope = {
            mode: raw.scope.mode || 'all',
            ids:  Array.isArray(raw.scope.ids) ? raw.scope.ids.slice() : [],
        };
    } else {
        scope = {
            mode: raw.scope || 'all',
            ids:  Array.isArray(raw.scope_ids) ? raw.scope_ids.slice() : [],
        };
    }

    return {
        id:             raw.id,
        name:           raw.name || '',
        discount_type:  raw.discount_type || 'percentage',
        discount_value: Number(raw.discount_value) || 0,
        schedule, scope,
        apply_mode:    raw.apply_mode || 'auto',
        requires_pin:  raw.requires_pin === true || raw.requires_approval === true,
        stacking:      raw.stacking === true,
        priority:      Number(raw.priority) || 1,
        active:        raw.active !== false,
    };
}

const fetchPricingData = async () => {
    try {
        const [dpRes, spRes, otRes, empRes, voidRes, discRes, catRes] = await Promise.all([
            fetchWithTimeout('/api/v1/config/pricing/day-parts').catch(() => ({ ok: false })),
            fetchWithTimeout('/api/v1/config/pricing/specials').catch(() => ({ ok: false })),
            fetchWithTimeout('/api/v1/config/pricing/order-types').catch(() => ({ ok: false })),
            fetchWithTimeout('/api/v1/config/pricing/employee-discount').catch(() => ({ ok: false })),
            fetchWithTimeout('/api/v1/config/pricing/void-reasons').catch(() => ({ ok: false })),
            fetchWithTimeout('/api/v1/config/pricing/discounts').catch(() => ({ ok: false })),
            fetchWithTimeout('/api/v1/config/menu/categories').catch(() => ({ ok: false })),
        ]);

        const dpData = dpRes.ok ? await dpRes.json() : {};
        const day_parts   = Array.isArray(dpData) ? dpData.map(migrateDayPart) : (dpData.day_parts || []).map(migrateDayPart);
        const spData = spRes.ok ? await spRes.json() : [];
        const specials    = Array.isArray(spData) ? spData.map(migrateSpecial) : spData;
        const order_types = otRes.ok ? await otRes.json()   : [
            { id: 'ot_dinein',   name: 'Dine-In',  adjustment: 0, active: true },
            { id: 'ot_takeout',  name: 'Takeout',  adjustment: 0, active: true },
            { id: 'ot_delivery', name: 'Delivery', adjustment: 0, active: true },
        ];
        const employee_discount = empRes.ok ? await empRes.json() : defaultEmployee();
        const void_reasons = voidRes.ok ? await voidRes.json() : [];
        const discData = discRes.ok ? await discRes.json() : {};
        const discounts = (discData.discounts || []).map(d => ({
            id: d.id || `disc_${Date.now()}`,
            name: d.name || '',
            type: d.type || 'percentage',
            value: d.value || 0,
            timing_type: d.timing_type || 'always',
            day_part_id: d.day_part_id || null,
            custom_start: d.custom_start || '09:00',
            custom_end: d.custom_end || '17:00',
            auto: d.auto !== false,
            requires_pin: d.requires_pin !== false,
            active: d.active !== false,
        }));
        const rawCats = catRes.ok ? await catRes.json() : [];
        const categories = rawCats.map(c => ({
            id:    c.category_id || c.id,
            name:  c.name || c.label || '',
            color: c.hex_color || c.color || C.gold,
        }));

        return { day_parts, specials, order_types, employee_discount, void_reasons, discounts, categories };
    } catch (e) {
        console.warn('[PricingSpecials] Failed to fetch:', e);
        return {
            day_parts: [], specials: [], order_types: [],
            employee_discount: defaultEmployee(),
            void_reasons: [], discounts: [], categories: [],
        };
    }
}

/* ─── WORKING-STATE RESOLVERS ────────────────────────────────── */
const getAllDayParts = () => {
    const edits = new Map(pendingChanges.day_parts_edited.map(e => [e.id, e]));
    const deleted = new Set(pendingChanges.day_parts_deleted);
    return pricingData.day_parts
        .map(d => edits.has(d.id) ? edits.get(d.id) : clone(d))
        .filter(d => !deleted.has(d.id))
        .concat(pendingChanges.day_parts_new);
}

const getAllSpecials = () => {
    const edits = new Map(pendingChanges.specials_edited.map(e => [e.id, e]));
    const deleted = new Set(pendingChanges.specials_deleted);
    return pricingData.specials
        .map(s => edits.has(s.id) ? edits.get(s.id) : clone(s))
        .filter(s => !deleted.has(s.id))
        .concat(pendingChanges.specials_new);
}

const getAllOrderTypes = () => {
    const edits = new Map(pendingChanges.order_types_edited.map(e => [e.id, e]));
    return pricingData.order_types.map(o => edits.has(o.id) ? edits.get(o.id) : clone(o));
}

const getWorkingEmployee = () => pendingChanges.employee_edited
        ? clone(pendingChanges.employee_edited)
        : clone(pricingData.employee_discount || defaultEmployee());
;

const getAllVoidReasons = () => {
    const edits = new Map(pendingChanges.void_reasons_edited.map(e => [e.id, e]));
    const deleted = new Set(pendingChanges.void_reasons_deleted);
    return pricingData.void_reasons
        .map(r => edits.has(r.id) ? edits.get(r.id) : clone(r))
        .filter(r => !deleted.has(r.id))
        .concat(pendingChanges.void_reasons_new);
}

const getAllDiscounts = () => {
    const edits = new Map((pendingChanges.discounts_edited || []).map(e => [e.id, e]));
    const deleted = new Set(pendingChanges.discounts_deleted || []);
    const base = Array.isArray(pricingData.discounts) ? pricingData.discounts : [];
    return base
        .map(d => edits.has(d.id) ? edits.get(d.id) : clone(d))
        .filter(d => !deleted.has(d.id))
        .concat(pendingChanges.discounts_new || []);
}

/* ─── CHANGE TRACKERS ────────────────────────────────────────── */
const trackDayPartCreate = (dp) => { pendingChanges.day_parts_new.push(dp); renderScene(); }
const trackDayPartEdit = (dp) => {
    if (pendingChanges.day_parts_new.some(n => n.id === dp.id)) {
        const i = pendingChanges.day_parts_new.findIndex(n => n.id === dp.id);
        pendingChanges.day_parts_new[i] = dp; renderScene(); return;
    }
    const i = pendingChanges.day_parts_edited.findIndex(e => e.id === dp.id);
    if (i !== -1) pendingChanges.day_parts_edited[i] = dp;
    else pendingChanges.day_parts_edited.push(dp);
    renderScene();
}
const trackDayPartDelete = (id) => {
    const i = pendingChanges.day_parts_new.findIndex(n => n.id === id);
    if (i !== -1) { pendingChanges.day_parts_new.splice(i, 1); renderScene(); return; }
    pendingChanges.day_parts_edited = pendingChanges.day_parts_edited.filter(e => e.id !== id);
    if (!pendingChanges.day_parts_deleted.includes(id)) pendingChanges.day_parts_deleted.push(id);
    renderScene();
}

const trackOrderTypeEdit = (ot) => {
    const i = pendingChanges.order_types_edited.findIndex(e => e.id === ot.id);
    if (i !== -1) pendingChanges.order_types_edited[i] = ot;
    else pendingChanges.order_types_edited.push(ot);
    renderScene();
}

const trackVoidReasonCreate = (r) => { pendingChanges.void_reasons_new.push(r); renderScene(); }
const trackVoidReasonEdit = (r) => {
    if (pendingChanges.void_reasons_new.some(n => n.id === r.id)) {
        const i = pendingChanges.void_reasons_new.findIndex(n => n.id === r.id);
        pendingChanges.void_reasons_new[i] = r; renderScene(); return;
    }
    const i = pendingChanges.void_reasons_edited.findIndex(e => e.id === r.id);
    if (i !== -1) pendingChanges.void_reasons_edited[i] = r;
    else pendingChanges.void_reasons_edited.push(r);
    renderScene();
}
const trackVoidReasonDelete = (id) => {
    const i = pendingChanges.void_reasons_new.findIndex(n => n.id === id);
    if (i !== -1) { pendingChanges.void_reasons_new.splice(i, 1); renderScene(); return; }
    pendingChanges.void_reasons_edited = pendingChanges.void_reasons_edited.filter(e => e.id !== id);
    if (!pendingChanges.void_reasons_deleted.includes(id)) pendingChanges.void_reasons_deleted.push(id);
    renderScene();
}

/* ─── SCENE REGISTRATION ─────────────────────────────────────── */
export function registerPricingSpecials(sceneManager) {
    sceneManager.register('pricing-specials', {
        type: 'detail', title: 'Specials & Discounts', parent: 'menu-subs',
        async onEnter(container) {
            injectAnimations();
            pricingData    = await fetchPricingData();
            pendingChanges = emptyChanges();
            displayState   = { openSection: 'specials' };

            const { body, saveBar } = buildScenePage(container, {
                title:     'Specials & Discounts',
                subtitle:  sceneSubtitle(),
                saveLabel: 'Save Changes',
                onSave:    handleSaveChanges,
            });
            bodyMount      = body;
            currentSaveBar = saveBar;
            renderScene();
        },
        onExit(container) {
            modalStack.splice(0).forEach(o => o.parentNode && o.remove());
            bodyMount = footerMount = currentSaveBar = null;
            pricingData = {
                day_parts: [], specials: [], order_types: [],
                employee_discount: null, void_reasons: [], discounts: [], categories: [],
            };
            pendingChanges = emptyChanges();
            if (container) container.innerHTML = '';
        },
    });
}

const emptyChanges = () => ({
        day_parts_new: [], day_parts_edited: [], day_parts_deleted: [],
        specials_new: [], specials_edited: [], specials_deleted: [],
        order_types_edited: [],
        employee_edited: null,
        discounts_new: [], discounts_edited: [], discounts_deleted: [],
        void_reasons_new: [], void_reasons_edited: [], void_reasons_deleted: [],
    });

const sceneSubtitle = () => {
    const dp = getAllDayParts().length;
    const dc = getAllDiscounts().length;
    const ot = getAllOrderTypes().length;
    const cr = getAllVoidReasons().length;
    return `${dp} day part${dp===1?'':'s'} · ${dc} discount${dc===1?'':'s'} · ${ot} order types · ${cr} void reason${cr===1?'':'s'}`;
}

/* ─── MAIN SCENE RENDER ──────────────────────────────────────── */
const renderScene = () => {
    if (!bodyMount) return;
    bodyMount.innerHTML = '';

    bodyMount.appendChild(buildSectionLabel('DAY PARTS', C2.lavender));
    bodyMount.appendChild(buildDayPartsAccordion());

    bodyMount.appendChild(buildOrderTypesAccordion());

    const discountsSpacer = document.createElement('div');
    discountsSpacer.style.marginTop = '24px';
    bodyMount.appendChild(discountsSpacer);
    bodyMount.appendChild(buildSectionLabel('DISCOUNTS', C.green));
    bodyMount.appendChild(buildDiscountsAccordion());

    const voidsSpacer = document.createElement('div');
    voidsSpacer.style.marginTop = '24px';
    bodyMount.appendChild(voidsSpacer);
    bodyMount.appendChild(buildSectionLabel('VOIDS', C.verm));
    bodyMount.appendChild(buildVoidReasonsAccordion());

    bodyMount.appendChild(buildPendingFooter());
    updateSaveBar();
}

const buildSuperHeader = (label, color) => {
    const wrap = document.createElement('div');
    wrap.style.cssText = `
        display: flex; align-items: center; gap: 14px;
        padding: 14px 0 6px;
        color: ${color};
    `;
    const lbl = document.createElement('div');
    lbl.textContent = label;
    lbl.style.cssText = `
        font-family: ui-monospace, monospace;
        font-size: 11px; letter-spacing: 3px;
        font-weight: 700; text-transform: uppercase;
    `;
    wrap.appendChild(lbl);
    const line = document.createElement('div');
    line.style.cssText = `flex: 1; height: 1px; background: currentColor; opacity: 0.25;`;
    wrap.appendChild(line);
    return wrap;
}

const buildAccordion = (key, title, meta, accentColor, bodyBuilder, countBadge = 0) => {
    const isOpen = displayState.openSection === key;
    const wrap = document.createElement('div');
    wrap.style.cssText = `
        background: ${C.card};
        border-left: 4px solid ${accentColor};
        border-radius: 10px;
        overflow: hidden;
        margin-bottom: 8px;
    `;

    const head = document.createElement('div');
    head.style.cssText = `
        display: flex; align-items: center; gap: 12px;
        padding: 14px 16px;
        cursor: pointer;
    `;
    head.addEventListener('click', () => {
        displayState.openSection = isOpen ? null : key;
        renderScene();
    });

    const titleEl = document.createElement('div');
    titleEl.textContent = title;
    titleEl.style.cssText = `
        font-family: ui-monospace, monospace;
        font-size: 13px; font-weight: 700;
        letter-spacing: 2.5px; text-transform: uppercase;
        color: ${accentColor};
    `;
    head.appendChild(titleEl);

    if (countBadge > 0) {
        const badge = document.createElement('div');
        badge.textContent = countBadge;
        badge.style.cssText = `
            padding: 1px 8px; border-radius: 999px;
            font-family: ui-monospace, monospace;
            font-size: 10px; font-weight: 700;
            background: ${withAlpha(C.gold, 0.25)};
            color: ${C.gold};
        `;
        head.appendChild(badge);
    }

    if (meta) {
        const metaEl = document.createElement('div');
        metaEl.textContent = meta;
        metaEl.style.cssText = `
            font-family: ui-monospace, monospace;
            font-size: 10px;
            letter-spacing: 1.5px;
            color: ${C.textMuted};
        `;
        head.appendChild(metaEl);
    }

    const spacer = document.createElement('div');
    spacer.style.flex = '1';
    head.appendChild(spacer);

    const caret = document.createElement('div');
    caret.textContent = '▶';
    caret.style.cssText = `
        color: ${withAlpha(C.text, 0.4)};
        font-size: 11px;
        transition: transform 0.15s ease;
        transform: rotate(${isOpen ? 90 : 0}deg);
    `;
    head.appendChild(caret);

    wrap.appendChild(head);

    if (isOpen) {
        const body = document.createElement('div');
        body.style.cssText = `
            padding: 0 16px 16px;
            padding-top: 14px;
            display: flex; flex-direction: column; gap: 8px;
            border-top: 1px solid ${C2.hairline};
        `;
        bodyBuilder(body);
        wrap.appendChild(body);
    }
    return wrap;
}

/* ─── DAY PARTS ACCORDION ────────────────────────────────────── */
const buildDayPartsAccordion = () => {
    const parts = getAllDayParts();
    const pendingCount = pendingChanges.day_parts_new.length
                       + pendingChanges.day_parts_edited.length
                       + pendingChanges.day_parts_deleted.length;
    return buildAccordion(
        'day-parts', 'Day Parts',
        `${parts.length} defined · used by specials`,
        C2.lavender,
        (body) => {
            const hint = document.createElement('div');
            hint.textContent = 'Reusable schedule templates. Specials reference a day part for their schedule — change hours once, every special using it updates.';
            hint.style.cssText = `font-size: 11px; color: ${C.textDim}; line-height: 1.4;`;
            body.appendChild(hint);

            if (parts.length === 0) {
                const empty = document.createElement('div');
                empty.textContent = 'No day parts yet';
                empty.style.cssText = `
                    padding: 20px; text-align: center;
                    font-family: ui-monospace, monospace;
                    font-size: 11px; color: ${C.textDim};
                    letter-spacing: 1.5px; text-transform: uppercase;
                `;
                body.appendChild(empty);
            } else {
                parts.forEach(dp => body.appendChild(buildDayPartCard(dp)));
            }

            const addWrap = document.createElement('div');
            addWrap.style.cssText = `padding: 12px 0 0; border-top: 1px solid ${C2.hairline};`;
            const addBtn = buildPillButton('+ ADD DAY PART', 'mint', () => openDayPartModal(null), { small: true });
            addBtn.style.cssText += ' pointer-events: auto; touch-action: manipulation;';
            addWrap.appendChild(addBtn);
            body.appendChild(addWrap);
        },
        pendingCount
    );
}

const buildDayPartCard = (dp) => {
    const pending = pendingChanges.day_parts_new.some(n => n.id === dp.id)
                 || pendingChanges.day_parts_edited.some(e => e.id === dp.id);

    const card = document.createElement('div');
    card.style.cssText = `
        background: ${C.well};
        border: 1px solid ${pending ? C.gold : withAlpha(C.text, 0.08)};
        border-left: 3px solid ${C2.lavender};
        border-radius: 8px;
        padding: 12px 14px;
        display: flex; align-items: center; gap: 10px;
        margin-bottom: 8px;
    `;

    const info = document.createElement('div');
    info.style.cssText = 'flex: 1; display: flex; flex-direction: column; gap: 4px; min-width: 0;';

    const name = document.createElement('div');
    name.textContent = dp.name || '(unnamed)';
    name.style.cssText = `font-size: 14px; font-weight: 600; color: ${C.text};`;
    info.appendChild(name);

    const desc = document.createElement('div');
    desc.textContent = summarizeWindows(dp.windows);
    desc.style.cssText = `
        font-family: ui-monospace, monospace;
        font-size: 11px; color: ${C.textMuted};
        letter-spacing: 1.2px;
    `;
    info.appendChild(desc);

    if (dp.description) {
        const extra = document.createElement('div');
        extra.textContent = dp.description;
        extra.style.cssText = `font-size: 11px; color: ${C.textDim}; font-style: italic;`;
        info.appendChild(extra);
    }

    card.appendChild(info);

    const editBtn = buildPillButton('EDIT', 'dark', () => openDayPartModal(dp), { small: true });
    editBtn.style.cssText += ' pointer-events: auto; touch-action: manipulation;';
    card.appendChild(editBtn);

    const delBtn = buildPillButton('DELETE', 'vermillion', () => confirmDeleteDayPart(dp.id), { small: true });
    delBtn.style.cssText += ' pointer-events: auto; touch-action: manipulation;';
    card.appendChild(delBtn);

    return card;
}

/* ─── ORDER TYPES ACCORDION ──────────────────────────────────── */
const buildOrderTypesAccordion = () => {
    const types = getAllOrderTypes();
    const meta = types.map(t => `${t.name} ${fmtPct(t.adjustment)}`).join(' · ');
    return buildAccordion(
        'order-types', 'Order Type Pricing',
        meta,
        C.green,
        (body) => {
            const hint = document.createElement('div');
            hint.textContent = 'Applied to every item by order type. Positive = markup, negative = discount.';
            hint.style.cssText = `font-size: 11px; color: ${C.textDim}; line-height: 1.4;`;
            body.appendChild(hint);

            types.forEach(ot => body.appendChild(buildOrderTypeRow(ot)));
        },
        pendingChanges.order_types_edited.length
    );
}

const fmtPct = (n) => {
    if (!n) return '0%';
    return `${n > 0 ? '+' : ''}${n}%`;
}

const buildOrderTypeRow = (ot) => {
    const edited = pendingChanges.order_types_edited.some(e => e.id === ot.id);
    const row = document.createElement('div');
    row.style.cssText = `
        display: flex; align-items: center; gap: 12px;
        padding: 10px 14px;
        background: ${C.well};
        border: 1px solid ${edited ? C.gold : withAlpha(C.text, 0.08)};
        border-radius: 8px;
        opacity: ${ot.active ? '1' : '0.55'};
        margin-bottom: 8px;
    `;

    const name = document.createElement('div');
    name.textContent = ot.name;
    name.style.cssText = `flex: 1; font-size: 14px; color: ${C.text}; font-weight: 500;`;
    row.appendChild(name);

    const input = document.createElement('input');
    input.type = 'number'; input.step = '0.1';
    input.value = ot.adjustment;
    input.style.cssText = `
        width: 70px;
        background: ${C.card};
        border: 1px solid ${C.border};
        border-radius: 6px;
        padding: 7px 10px;
        color: ${C.gold};
        font-family: ui-monospace, monospace;
        font-size: 14px; text-align: right;
        outline: none; color-scheme: dark;
    `;
    input.addEventListener('focus', () => input.style.borderColor = C.gold);
    input.addEventListener('blur',  () => input.style.borderColor = C.border);
    input.addEventListener('change', () => {
        const updated = clone(ot);
        updated.adjustment = parseFloat(input.value) || 0;
        trackOrderTypeEdit(updated);
    });
    row.appendChild(input);

    const pct = document.createElement('div');
    pct.textContent = '%';
    pct.style.cssText = `color: ${withAlpha(C.text, 0.4)}; font-family: ui-monospace, monospace; font-size: 14px;`;
    row.appendChild(pct);

    row.appendChild(buildInlineToggle(ot.active, (on) => {
        const updated = clone(ot);
        updated.active = on;
        trackOrderTypeEdit(updated);
    }));

    return row;
}

const buildInlineToggle = (initial, onChange) => {
    const state = { on: !!initial };
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.style.cssText = `
        position: relative;
        width: 40px; height: 22px;
        border-radius: 999px;
        border: none; padding: 0;
        background: ${state.on ? withAlpha(C.green, 0.2) : withAlpha(C.text, 0.12)};
        cursor: pointer;
        transition: background 0.15s ease;
    `;
    const knob = document.createElement('div');
    knob.style.cssText = `
        position: absolute; top: 3px;
        left: ${state.on ? 'calc(100% - 19px)' : '3px'};
        width: 16px; height: 16px; border-radius: 50%;
        background: ${state.on ? C.green : withAlpha(C.text, 0.4)};
        transition: left 0.15s ease, background 0.15s ease;
    `;
    btn.appendChild(knob);
    btn.addEventListener('click', (e) => {
        e.stopPropagation();
        state.on = !state.on;
        btn.style.background = state.on ? withAlpha(C.green, 0.2) : withAlpha(C.text, 0.12);
        knob.style.left = state.on ? 'calc(100% - 19px)' : '3px';
        knob.style.background = state.on ? C.green : withAlpha(C.text, 0.4);
        onChange(state.on);
    });
    return btn;
}

/* ─── DISCOUNTS ACCORDION ────────────────────────────────────── */
const buildDiscountsAccordion = () => {
    const discounts = getAllDiscounts();
    const pendingCount = pendingChanges.discounts_new.length
                       + pendingChanges.discounts_edited.length
                       + pendingChanges.discounts_deleted.length;
    return buildAccordion(
        'discounts', 'Discounts',
        `${discounts.length} discount${discounts.length === 1 ? '' : 's'}`,
        C.green,
        (body) => {
            if (discounts.length === 0) {
                const empty = document.createElement('div');
                empty.textContent = 'NO DISCOUNTS DEFINED';
                empty.style.cssText = `
                    padding: 20px; text-align: center;
                    font-family: ui-monospace, monospace;
                    font-size: 11px; color: ${C.textDim};
                    letter-spacing: 1.5px; text-transform: uppercase;
                `;
                body.appendChild(empty);
            } else {
                discounts.forEach(d => body.appendChild(buildDiscountCard(d)));
            }

            const addWrap = document.createElement('div');
            addWrap.style.cssText = `padding: 12px 0 0; border-top: 1px solid ${C2.hairline};`;
            const addBtn = buildPillButton('+ ADD DISCOUNT', 'mint', () => openDiscountModal(null), { small: true });
            addBtn.style.cssText += ' pointer-events: auto; touch-action: manipulation;';
            addWrap.appendChild(addBtn);
            body.appendChild(addWrap);
        },
        pendingCount
    );
}

const buildDiscountCard = (d) => {
    const pending = pendingChanges.discounts_new.some(n => n.id === d.id)
                 || pendingChanges.discounts_edited.some(e => e.id === d.id);

    const card = document.createElement('div');
    card.style.cssText = `
        background: ${C.well};
        border: 1px solid ${pending ? C.gold : withAlpha(C.text, 0.08)};
        border-left: 3px solid ${C.green};
        border-radius: 8px;
        padding: 12px 14px;
        display: flex; align-items: center; gap: 10px;
        margin-bottom: 8px;
    `;

    const info = document.createElement('div');
    info.style.cssText = 'flex: 1; display: flex; flex-direction: column; gap: 4px; min-width: 0;';

    const nameRow = document.createElement('div');
    nameRow.style.cssText = 'display: flex; align-items: center; gap: 8px; flex-wrap: wrap;';

    const name = document.createElement('div');
    name.textContent = d.name || '(unnamed)';
    name.style.cssText = `font-size: 14px; font-weight: 600; color: ${C.text};`;
    nameRow.appendChild(name);

    const amount = document.createElement('div');
    amount.textContent = d.type === 'percentage' ? `${d.value}%` : `$${Number(d.value).toFixed(2)}`;
    amount.style.cssText = `
        font-family: ui-monospace, monospace;
        font-size: 12px; color: ${C.textMuted};
        font-weight: 600;
    `;
    nameRow.appendChild(amount);

    const timingLabel = getTimingLabel(d);
    const timing = document.createElement('div');
    timing.textContent = timingLabel;
    timing.style.cssText = `
        font-family: ui-monospace, monospace;
        font-size: 11px; color: ${C.textDim};
        letter-spacing: 0.5px;
    `;
    nameRow.appendChild(timing);

    if (d.auto) {
        const autoBadge = document.createElement('div');
        autoBadge.textContent = 'AUTO';
        autoBadge.style.cssText = `
            padding: 2px 8px; border-radius: 999px;
            font-family: ui-monospace, monospace;
            font-size: 9px; font-weight: 700; letter-spacing: 1.2px;
            background: ${withAlpha(C.green, 0.2)}; color: ${C.green};
        `;
        nameRow.appendChild(autoBadge);
    }

    info.appendChild(nameRow);
    card.appendChild(info);

    const btnGroup = document.createElement('div');
    btnGroup.style.cssText = 'display: flex; gap: 6px;';
    const editBtn = buildPillButton('EDIT', 'dark', () => openDiscountModal(d), { small: true });
    const deleteBtn = buildPillButton('DELETE', 'danger', () => {
        if (!confirm(`Delete "${d.name}"?`)) return;
        trackDiscountDelete(d.id);
        renderScene();
    }, { small: true });
    btnGroup.appendChild(editBtn);
    btnGroup.appendChild(deleteBtn);
    card.appendChild(btnGroup);

    return card;
}

const getTimingLabel = (d) => {
    if (d.timing_type === 'always') return 'always active';
    if (d.timing_type === 'day_part') {
        const dp = pricingData.day_parts.find(x => x.id === d.day_part_id);
        return dp ? `day part: ${dp.name}` : 'day part (missing)';
    }
    if (d.timing_type === 'custom') {
        return `${d.custom_start || '09:00'} – ${d.custom_end || '17:00'}`;
    }
    return 'unknown timing';
}

const openDiscountModal = (existing) => {
    const isEdit = !!existing;
    const d = existing ? clone(existing) : {
        id: `disc_${Date.now()}`,
        name: '',
        type: 'percentage',
        value: 0,
        timing_type: 'always',
        day_part_id: null,
        custom_start: '09:00',
        custom_end: '17:00',
        auto: true,
        requires_pin: false,
        active: true,
    };

    openModal(isEdit ? `Edit discount: ${d.name || ''}` : 'Add discount', (body, modalEl, ov) => {
        // NAME
        const nameField = buildTextField(body, 'Name', d.name, { required: true, placeholder: 'Happy Hour, 20% off…' });

        // AMOUNT TYPE & VALUE
        const row1 = document.createElement('div');
        row1.style.cssText = 'display: flex; gap: 12px; align-items: flex-end;';
        const typeCol = document.createElement('div');
        typeCol.style.cssText = 'flex: 1;';
        const typeField = buildSelectField(typeCol, 'Amount type', d.type, [
            { value: 'percentage', label: 'Percentage' },
            { value: 'flat_dollar', label: 'Flat rate' },
        ]);
        row1.appendChild(typeCol);
        const valCol = document.createElement('div');
        valCol.style.cssText = 'flex: 0 0 120px;';
        const valField = buildTextField(valCol, 'Amount', d.value, { type: 'number', step: '0.01' });
        row1.appendChild(valCol);
        const unitDiv = document.createElement('div');
        unitDiv.textContent = d.type === 'percentage' ? '%' : '$';
        unitDiv.style.cssText = `font-weight: 600; padding-bottom: 12px; color: ${C.textMuted};`;
        row1.appendChild(unitDiv);
        typeField.select.addEventListener('change', () => {
            d.type = typeField.select.value;
            unitDiv.textContent = d.type === 'percentage' ? '%' : '$';
        });
        body.appendChild(row1);

        body.appendChild(buildDivider());

        // TIMING
        body.appendChild(buildSectionLabel('TIMING', C.green));
        const timingWrap = document.createElement('div');
        timingWrap.style.cssText = 'display: flex; flex-direction: column; gap: 12px;';
        const timingSeg = buildSegmented([
            { value: 'always',   label: '◎ Always' },
            { value: 'day_part', label: '⏰ Day part' },
            { value: 'custom',   label: '✓ Custom' },
        ], d.timing_type, (v) => {
            d.timing_type = v;
            renderTiming();
        }, C.green);
        timingWrap.appendChild(timingSeg.wrap);

        const timingDetails = document.createElement('div');
        timingDetails.style.cssText = 'display: flex; flex-direction: column; gap: 10px;';
        timingWrap.appendChild(timingDetails);

        function renderTiming() {
            timingDetails.innerHTML = '';
            if (d.timing_type === 'day_part') {
                const dpList = getAllDayParts();
                if (dpList.length === 0) {
                    const msg = document.createElement('div');
                    msg.textContent = 'No day parts defined. Switch to Custom or add a day part first.';
                    msg.style.cssText = `font-size: 12px; color: ${C.verm};`;
                    timingDetails.appendChild(msg);
                } else {
                    const dpField = buildSelectField(timingDetails, 'Day part', d.day_part_id || '', [
                        { value: '', label: '— select a day part —' },
                        ...dpList.map(dp => ({ value: dp.id, label: dp.name })),
                    ]);
                    dpField.select.addEventListener('change', () => { d.day_part_id = dpField.select.value || null; });
                }
            } else if (d.timing_type === 'custom') {
                const row = document.createElement('div');
                row.style.cssText = 'display: flex; gap: 12px; align-items: flex-end;';
                const startCol = document.createElement('div');
                startCol.style.flex = '1';
                const startField = buildTextField(startCol, 'Start', d.custom_start, { type: 'time' });
                startField.input.addEventListener('input', () => { d.custom_start = startField.input.value; });
                row.appendChild(startCol);
                const arrow = document.createElement('div');
                arrow.textContent = '→';
                arrow.style.cssText = `padding: 0 4px 10px 4px; color: ${withAlpha(C.text, 0.4)};`;
                row.appendChild(arrow);
                const endCol = document.createElement('div');
                endCol.style.flex = '1';
                const endField = buildTextField(endCol, 'End', d.custom_end, { type: 'time' });
                endField.input.addEventListener('input', () => { d.custom_end = endField.input.value; });
                row.appendChild(endCol);
                timingDetails.appendChild(row);
            }
        }

        renderTiming();
        body.appendChild(timingWrap);

        body.appendChild(buildDivider());

        // AUTO-APPLY
        body.appendChild(buildSectionLabel('OPTIONS', C.green));
        const optWrap = document.createElement('div');
        optWrap.style.cssText = 'display: flex; flex-direction: column; gap: 10px;';

        const autoRow = document.createElement('div');
        autoRow.style.cssText = 'display: flex; align-items: center; gap: 10px;';
        const autoLabel = document.createElement('div');
        autoLabel.textContent = 'Auto-apply';
        autoLabel.style.cssText = `flex: 1; font-size: 13px; color: ${C.text};`;
        const autoToggle = buildToggle(d.auto, (v) => { d.auto = v; });
        autoRow.appendChild(autoLabel);
        autoRow.appendChild(autoToggle);
        optWrap.appendChild(autoRow);

        const autoHint = document.createElement('div');
        autoHint.textContent = 'ON = applies automatically during timing window · OFF = appears as a button for manual use';
        autoHint.style.cssText = `font-size: 10px; color: ${C.textDim}; line-height: 1.4;`;
        optWrap.appendChild(autoHint);

        body.appendChild(optWrap);

        // FOOTER
        const footer = document.createElement('div');
        footer.style.cssText = `display: flex; gap: 10px; justify-content: flex-end; padding-top: 14px; border-top: 1px solid ${C2.hairline}; margin-top: 6px;`;
        footer.appendChild(buildPillButton('Cancel', 'tertiary', () => closeModal(ov), { small: true }));
        footer.appendChild(buildPillButton(isEdit ? 'Save' : 'Create', 'primary', () => {
            const name = nameField.input.value.trim();
            if (!name) { nameField.input.style.borderColor = C.verm; return; }
            const gathered = {
                ...d,
                name,
                type: typeField.select.value,
                value: parseFloat(valField.input.value) || 0,
            };
            if (isEdit) trackDiscountEdit(gathered);
            else trackDiscountCreate(gathered);
            closeModal(ov);
            renderScene();
        }, { small: true }));
        body.appendChild(footer);
    }, { accent: C.green });
}

const trackDiscountCreate = (d) => {
    pendingChanges.discounts_new.push(d);
}

const trackDiscountEdit = (d) => {
    const idx = pendingChanges.discounts_edited.findIndex(e => e.id === d.id);
    if (idx >= 0) pendingChanges.discounts_edited[idx] = d;
    else pendingChanges.discounts_edited.push(d);
}

const trackDiscountDelete = (discountId) => {
    pendingChanges.discounts_new = pendingChanges.discounts_new.filter(n => n.id !== discountId);
    const idx = pendingChanges.discounts_edited.findIndex(e => e.id === discountId);
    if (idx >= 0) pendingChanges.discounts_edited.splice(idx, 1);
    if (!pendingChanges.discounts_deleted.includes(discountId)) {
        pendingChanges.discounts_deleted.push(discountId);
    }
}

/* ─── VOID REASONS ACCORDION ─────────────────────────────────── */
const buildVoidReasonsAccordion = () => {
    const reasons = getAllVoidReasons();
    const pinCount = reasons.filter(r => r.requires_pin).length;
    const pendingCount = pendingChanges.void_reasons_new.length
                       + pendingChanges.void_reasons_edited.length
                       + pendingChanges.void_reasons_deleted.length;
    return buildAccordion(
        'void-reasons', 'Void Reasons',
        `${reasons.length} reason${reasons.length === 1 ? '' : 's'}${pinCount > 0 ? ` · ${pinCount} require PIN` : ''}`,
        C.verm,
        (body) => {
            if (reasons.length === 0) {
                const empty = document.createElement('div');
                empty.textContent = 'No void reasons yet';
                empty.style.cssText = `
                    padding: 20px; text-align: center;
                    font-family: ui-monospace, monospace;
                    font-size: 11px; color: ${C.textDim};
                    letter-spacing: 1.5px; text-transform: uppercase;
                `;
                body.appendChild(empty);
            } else {
                reasons.forEach(r => body.appendChild(buildVoidReasonRow(r)));
            }
            const addWrap = document.createElement('div');
            addWrap.style.cssText = `padding: 12px 0 0; border-top: 1px solid ${C2.hairline};`;
            const addBtn = buildPillButton('+ ADD REASON', 'mint', () => openVoidReasonModal(null), { small: true });
            addBtn.style.cssText += ' pointer-events: auto; touch-action: manipulation;';
            addWrap.appendChild(addBtn);
            body.appendChild(addWrap);
        },
        pendingCount
    );
}

const buildVoidReasonRow = (r) => {
    const pending = pendingChanges.void_reasons_new.some(n => n.id === r.id)
                 || pendingChanges.void_reasons_edited.some(e => e.id === r.id);
    const row = document.createElement('div');
    row.style.cssText = `
        display: flex; align-items: center; gap: 10px;
        padding: 10px 14px;
        background: ${C.well};
        border: 1px solid ${pending ? C.gold : withAlpha(C.text, 0.08)};
        border-left: 3px solid ${C.verm};
        border-radius: 8px;
        margin-bottom: 8px;
    `;

    const name = document.createElement('div');
    name.textContent = r.name || '(unnamed)';
    name.style.cssText = `flex: 1; font-size: 14px; color: ${C.text}; font-weight: 500;`;
    row.appendChild(name);

    if (r.requires_pin) row.appendChild(makePill('PIN', 'gold'));
    if (r.max_amount != null) row.appendChild(makePill(`max $${Number(r.max_amount).toFixed(2)}`, 'verm'));

    const editBtn = buildPillButton('EDIT', 'dark', () => openVoidReasonModal(r), { small: true });
    editBtn.style.cssText += ' pointer-events: auto; touch-action: manipulation;';
    row.appendChild(editBtn);

    const delBtn = buildPillButton('DELETE', 'vermillion', () => confirmDeleteVoidReason(r.id), { small: true });
    delBtn.style.cssText += ' pointer-events: auto; touch-action: manipulation;';
    row.appendChild(delBtn);

    return row;
}

/* ─── FOOTER / SAVE BAR ──────────────────────────────────────── */
const buildPendingFooter = () => {
    const wrap = document.createElement('div');
    footerMount = wrap;
    wrap.style.cssText = `
        position: sticky; bottom: 12px; margin-top: 20px; z-index: 40;
        display: none;
    `;
    const inner = document.createElement('div');
    inner.style.cssText = `
        display: flex; align-items: center; gap: 16px;
        padding: 14px 20px;
        background: ${C.card};
        border-left: 4px solid ${C.gold};
        border-radius: 10px;
        box-shadow: 0 12px 40px rgba(0,0,0,0.5);
    `;
    wrap.appendChild(inner);

    const msg = document.createElement('div');
    msg.id = 'psp-pending-msg';
    msg.style.cssText = `
        flex: 1;
        font-family: ui-monospace, monospace;
        font-size: 12px; font-weight: 700;
        letter-spacing: 1.5px; text-transform: uppercase;
        color: ${C.gold};
    `;
    inner.appendChild(msg);

    const discard = buildPillButton('Discard', 'ghost', () => {
        const n = getPendingCount();
        if (!n) return;
        if (confirm(`Discard ${n} unsaved change${n === 1 ? '' : 's'}?`)) {
            pendingChanges = emptyChanges();
            renderScene();
        }
    });
    discard.style.padding = '8px 18px';
    discard.style.fontSize = '11px';
    inner.appendChild(discard);

    return wrap;
}

const updateSaveBar = () => {
    const n = getPendingCount();
    if (footerMount) {
        footerMount.style.display = n === 0 ? 'none' : 'block';
        const m = document.getElementById('psp-pending-msg');
        if (m) m.textContent = `⚠ ${n} unsaved change${n === 1 ? '' : 's'}`;
    }
    if (currentSaveBar && currentSaveBar.el) {
        currentSaveBar.el.disabled = n === 0;
        currentSaveBar.el.style.opacity = n === 0 ? '0.5' : '1';
        currentSaveBar.el.style.cursor  = n === 0 ? 'default' : 'pointer';
    }
}

/* ─── CONFIRM-DELETE HELPERS ─────────────────────────────────── */
const confirmDeleteDayPart = (id) => {
    if (confirm('Delete this day part?')) trackDayPartDelete(id);
}
const confirmDeleteVoidReason = (id) => {
    if (confirm('Delete this void reason?')) trackVoidReasonDelete(id);
}

/* ─── BUTTONS ────────────────────────────────────────────────── */
const buildPillButton = (label, variant, onClick, opts = {}) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = label;
    const variants = {
        primary:    `background: ${C.gold};   color: #1a1000;    border: none;`,
        confirm:    `background: ${C.greenUp || C.green}; color: ${C.well};  border: none;`,
        danger:     `background: transparent; color: ${C.verm};  border: 1px solid ${C.verm};`,
        ghost:      `background: transparent; color: ${C.text};  border: 1px solid ${withAlpha(C.text, 0.2)};`,
        tertiary:   `background: transparent; color: ${C.textMuted}; border: 1px solid ${C.border};`,
        dark:       `background: ${C.card};   color: ${C.text};  border: 1px solid ${withAlpha(C.text, 0.2)};`,
        vermillion: `background: transparent; color: ${C.verm};  border: 1px solid ${C.verm};`,
        mint:       `background: ${withAlpha(C.green, 0.15)}; color: ${C.green}; border: 1px solid ${C.green};`,
    };
    btn.style.cssText = `
        ${variants[variant] || variants.primary}
        border-radius: 999px;
        padding: ${opts.small ? '8px 18px' : '10px 22px'};
        font-family: ui-monospace, monospace;
        font-size: ${opts.small ? '11px' : '12px'};
        font-weight: 700;
        letter-spacing: 1.5px;
        text-transform: uppercase;
        cursor: pointer;
        transition: transform 0.1s ease, opacity 0.15s ease;
        white-space: nowrap;
    `;
    btn.addEventListener('mouseenter', () => { if (!btn.disabled) btn.style.transform = 'translateY(-1px)'; });
    btn.addEventListener('mouseleave', () => btn.style.transform = '');
    if (onClick) btn.addEventListener('click', onClick);
    return btn;
}

const buildAddBtn = (label, color) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = label;
    b.style.cssText = `
        align-self: flex-start;
        padding: 8px 14px;
        background: transparent;
        border: 1px dashed ${withAlpha(C.text, 0.2)};
        border-radius: 999px;
        color: ${withAlpha(C.text, 0.7)};
        font-family: ui-monospace, monospace;
        font-size: 10px; font-weight: 700;
        letter-spacing: 1.5px; text-transform: uppercase;
        cursor: pointer;
        transition: all 0.15s ease;
    `;
    b.addEventListener('mouseenter', () => { b.style.borderColor = color; b.style.color = color; });
    b.addEventListener('mouseleave', () => { b.style.borderColor = withAlpha(C.text, 0.2); b.style.color = withAlpha(C.text, 0.7); });
    return b;
}

/* ─── MODAL SYSTEM ───────────────────────────────────────────── */
const openModal = (titleText, contentBuilder, opts = {}) => {
    const overlay = document.createElement('div');
    overlay.style.cssText = `
        position: fixed; inset: 0;
        background: rgba(26,29,32,0.75);
        z-index: ${5000 + modalStack.length * 10};
        display: flex; align-items: center; justify-content: center;
        padding: 20px;
        animation: psp-fade-in 0.15s ease-out;
    `;
    overlay.addEventListener('click', (e) => { if (e.target === overlay) closeModal(overlay); });

    const modal = document.createElement('div');
    modal.style.cssText = `
        background: ${C.card};
        border-left: 4px solid ${opts.accent || C.gold};
        border-radius: 12px;
        max-width: ${opts.wide ? '720px' : '540px'};
        width: 100%;
        max-height: 90vh;
        display: flex; flex-direction: column;
        box-shadow: 0 20px 60px rgba(0,0,0,0.6);
        overflow: hidden;
    `;

    const header = document.createElement('div');
    header.style.cssText = `
        padding: 18px 22px 14px;
        border-bottom: 1px solid ${C2.hairline};
        display: flex; align-items: center; justify-content: space-between;
        flex-shrink: 0;
    `;
    const title = document.createElement('div');
    title.textContent = titleText;
    title.style.cssText = `font-size: 17px; font-weight: 700; color: ${C.text};`;
    const closeBtn = document.createElement('button');
    closeBtn.textContent = '×';
    closeBtn.style.cssText = `
        background: transparent; border: none;
        color: ${C.textMuted}; font-size: 26px;
        cursor: pointer; padding: 0 4px; line-height: 1;
    `;
    closeBtn.addEventListener('click', () => closeModal(overlay));
    header.appendChild(title);
    header.appendChild(closeBtn);
    modal.appendChild(header);

    const body = document.createElement('div');
    body.style.cssText = `padding: 18px 22px; overflow-y: auto; flex: 1; display: flex; flex-direction: column; gap: 14px;`;
    modal.appendChild(body);
    overlay.appendChild(modal);
    document.body.appendChild(overlay);

    modalStack.push(overlay);
    contentBuilder(body, modal, overlay);
    return overlay;
}

const closeModal = (target) => {
    if (modalStack.length === 0) return;
    const t = target || modalStack[modalStack.length - 1];
    const idx = modalStack.indexOf(t);
    if (idx === -1) return;
    modalStack.splice(idx, 1);
    if (t.parentNode) t.remove();
}

/* ─── FORM FIELDS ────────────────────────────────────────────── */
const buildTextField = (parent, labelText, value, opts = {}) => {
    const wrap = document.createElement('div');
    wrap.style.cssText = 'display: flex; flex-direction: column; gap: 6px;';
    const lbl = document.createElement('label');
    lbl.style.cssText = `font-size: 12px; font-weight: 600; color: ${C.textMuted};`;
    lbl.innerHTML = opts.required ? `${labelText} <span style="color:${C.verm};">*</span>` : labelText;
    wrap.appendChild(lbl);
    const input = opts.textarea ? document.createElement('textarea') : document.createElement('input');
    if (!opts.textarea) input.type = opts.type || 'text';
    input.value = value != null ? value : '';
    if (opts.placeholder) input.placeholder = opts.placeholder;
    if (opts.step) input.step = opts.step;
    input.style.cssText = `
        width: 100%; box-sizing: border-box;
        background: ${C.well}; color: ${C.text};
        border: 1px solid ${C.border}; border-radius: 6px;
        padding: 10px 14px; font-size: 15px;
        font-family: var(--font-body);
        outline: none; color-scheme: dark;
        ${opts.textarea ? 'resize: vertical; min-height: 60px;' : ''}
    `;
    input.addEventListener('focus', () => input.style.borderColor = C.gold);
    input.addEventListener('blur',  () => input.style.borderColor = C.border);
    wrap.appendChild(input);
    parent.appendChild(wrap);
    return { wrap, input };
}

const buildSelectField = (parent, labelText, value, choices) => {
    const wrap = document.createElement('div');
    wrap.style.cssText = 'display: flex; flex-direction: column; gap: 6px;';
    const lbl = document.createElement('label');
    lbl.style.cssText = `font-size: 12px; font-weight: 600; color: ${C.textMuted};`;
    lbl.textContent = labelText;
    wrap.appendChild(lbl);
    const sel = document.createElement('select');
    sel.style.cssText = `
        width: 100%; box-sizing: border-box;
        background: ${C.well}; color: ${C.text};
        border: 1px solid ${C.border}; border-radius: 6px;
        padding: 10px 14px; font-size: 15px;
        font-family: var(--font-body);
        outline: none; cursor: pointer; color-scheme: dark;
    `;
    choices.forEach(c => {
        const o = document.createElement('option');
        o.value = c.value; o.textContent = c.label;
        if (c.value === value) o.selected = true;
        sel.appendChild(o);
    });
    sel.addEventListener('focus', () => sel.style.borderColor = C.gold);
    sel.addEventListener('blur',  () => sel.style.borderColor = C.border);
    wrap.appendChild(sel);
    parent.appendChild(wrap);
    return { wrap, input: sel };
}

const buildSectionLabel = (text, color) => {
    const lbl = document.createElement('div');
    lbl.textContent = text;
    lbl.style.cssText = `
        font-family: ui-monospace, monospace;
        font-size: 11px; font-weight: 700;
        letter-spacing: 2px; text-transform: uppercase;
        color: ${color || C.gold};
    `;
    return lbl;
}

const buildDivider = () => {
    const d = document.createElement('div');
    d.style.cssText = `height: 1px; background: ${C2.hairline}; margin: 4px 0;`;
    return d;
}

const buildSegmented = (options, currentValue, onSelect, activeColor) => {
    const wrap = document.createElement('div');
    wrap.style.cssText = `
        display: flex; gap: 4px;
        background: ${C.well};
        border: 1px solid ${withAlpha(C.text, 0.08)};
        border-radius: 999px;
        padding: 3px;
    `;
    const color = activeColor || C.gold;
    const btns = [];
    options.forEach(opt => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.textContent = opt.label;
        btn.dataset.value = opt.value;
        btn.style.cssText = `
            flex: 1; padding: 7px 10px;
            background: transparent;
            border: none; border-radius: 999px;
            color: ${withAlpha(C.text, 0.55)};
            font-family: ui-monospace, monospace;
            font-size: 10px; font-weight: 700; letter-spacing: 1.5px;
            cursor: pointer;
            transition: all 0.15s ease;
        `;
        btn.addEventListener('click', () => {
            btns.forEach(b => {
                const active = b.dataset.value === opt.value;
                b.style.background = active ? withAlpha(color, 0.18) : 'transparent';
                b.style.color = active ? color : withAlpha(C.text, 0.55);
            });
            onSelect(opt.value);
        });
        wrap.appendChild(btn);
        btns.push(btn);
    });
    // Initial state
    btns.forEach(b => {
        const active = b.dataset.value === currentValue;
        b.style.background = active ? withAlpha(color, 0.18) : 'transparent';
        b.style.color = active ? color : withAlpha(C.text, 0.55);
    });
    return {
        wrap,
        setValue: (v) => btns.forEach(b => {
            const active = b.dataset.value === v;
            b.style.background = active ? withAlpha(color, 0.18) : 'transparent';
            b.style.color = active ? color : withAlpha(C.text, 0.55);
        }),
    };
}

const buildDayChips = (initialDays, onChange, activeColor) => {
    const days = (initialDays && initialDays.length === 7) ? initialDays.slice() : [1,1,1,1,1,1,1];
    const wrap = document.createElement('div');
    wrap.style.cssText = 'display: flex; gap: 4px; flex-wrap: wrap;';
    const color = activeColor || C.green;
    DAY_LABELS.forEach((lbl, i) => {
        const chip = document.createElement('button');
        chip.type = 'button';
        chip.textContent = lbl;
        const render = () => {
            const on = days[i] === 1;
            chip.style.cssText = `
                width: 40px; padding: 7px 0;
                background: ${on ? withAlpha(color, 0.15) : C.well};
                border: 1px solid ${on ? color : withAlpha(C.text, 0.08)};
                border-radius: 6px;
                color: ${on ? color : C.textMuted};
                font-family: ui-monospace, monospace;
                font-size: 11px; font-weight: 700;
                letter-spacing: 1px; text-align: center;
                cursor: pointer;
            `;
        };
        render();
        chip.addEventListener('click', () => {
            days[i] = days[i] ? 0 : 1;
            render();
            if (onChange) onChange(days.slice());
        });
        wrap.appendChild(chip);
    });
    return { wrap, getDays: () => days.slice(), setDays: (d) => { d.forEach((v, i) => days[i] = v ? 1 : 0); }};
}

const buildToggleRow = (parent, label, initial, onChange, color) => {
    const row = document.createElement('div');
    row.style.cssText = 'display: flex; align-items: center; gap: 12px;';
    const state = { on: !!initial };
    const btn = document.createElement('button');
    btn.type = 'button';
    const activeColor = color || C.green;
    btn.style.cssText = `
        position: relative;
        width: 46px; height: 24px;
        border-radius: 999px;
        border: none; padding: 0;
        background: ${state.on ? withAlpha(activeColor, 0.2) : withAlpha(C.text, 0.12)};
        cursor: pointer;
        transition: background 0.15s ease;
        flex-shrink: 0;
    `;
    const knob = document.createElement('div');
    knob.style.cssText = `
        position: absolute; top: 3px;
        left: ${state.on ? 'calc(100% - 21px)' : '3px'};
        width: 18px; height: 18px; border-radius: 50%;
        background: ${state.on ? activeColor : withAlpha(C.text, 0.4)};
        transition: all 0.15s ease;
    `;
    btn.appendChild(knob);
    btn.addEventListener('click', () => {
        state.on = !state.on;
        btn.style.background = state.on ? withAlpha(activeColor, 0.2) : withAlpha(C.text, 0.12);
        knob.style.left = state.on ? 'calc(100% - 21px)' : '3px';
        knob.style.background = state.on ? activeColor : withAlpha(C.text, 0.4);
        if (onChange) onChange(state.on);
    });
    row.appendChild(btn);
    const lbl = document.createElement('div');
    lbl.textContent = label;
    lbl.style.cssText = `font-size: 14px; color: ${C.text};`;
    row.appendChild(lbl);
    parent.appendChild(row);
    return { isOn: () => state.on, row };
}

/* ─── WINDOW EDITOR (shared) ─────────────────────────────────── */
const buildWindowEditor = (parent, windows, accent) => {
    const wrap = document.createElement('div');
    wrap.style.cssText = 'display: flex; flex-direction: column; gap: 10px;';
    const windowsWrap = document.createElement('div');
    windowsWrap.style.cssText = 'display: flex; flex-direction: column; gap: 10px;';
    wrap.appendChild(windowsWrap);

    function render() {
        windowsWrap.innerHTML = '';
        windows.forEach((w, idx) => windowsWrap.appendChild(buildWindowBlock(w, idx)));
    }

    function buildWindowBlock(win, idx) {
        const block = document.createElement('div');
        block.style.cssText = `
            background: rgba(34,37,42,0.4);
            border: 1px solid ${withAlpha(C.text, 0.08)};
            border-radius: 8px;
            padding: 12px 14px;
            display: flex; flex-direction: column; gap: 10px;
            position: relative;
        `;

        const wlbl = document.createElement('div');
        wlbl.textContent = `Window ${idx + 1}${win.label ? ' · ' + win.label : ''}`;
        wlbl.style.cssText = `
            font-family: ui-monospace, monospace;
            font-size: 10px; font-weight: 700;
            letter-spacing: 2px; text-transform: uppercase;
            color: ${withAlpha(C.text, 0.4)};
        `;
        block.appendChild(wlbl);

        const canRemove = windows.length > 1;
        const removeBtn = document.createElement('button');
        removeBtn.type = 'button';
        removeBtn.textContent = '×';
        removeBtn.style.cssText = `
            position: absolute; top: 10px; right: 12px;
            background: transparent; border: none;
            color: ${withAlpha(C.text, 0.4)};
            font-size: 16px; line-height: 1;
            cursor: ${canRemove ? 'pointer' : 'not-allowed'};
            opacity: ${canRemove ? '1' : '0.25'};
        `;
        if (canRemove) {
            removeBtn.addEventListener('click', () => {
                windows.splice(idx, 1);
                render();
            });
        }
        block.appendChild(removeBtn);

        const labelField = buildTextField(block, 'Label (optional)', win.label, { placeholder: 'e.g. main lunch' });
        labelField.input.addEventListener('input', () => {
            win.label = labelField.input.value;
            wlbl.textContent = `Window ${idx + 1}${win.label ? ' · ' + win.label : ''}`;
        });

        const daysWrap = document.createElement('div');
        daysWrap.style.cssText = 'display: flex; flex-direction: column; gap: 6px;';
        const daysLbl = document.createElement('div');
        daysLbl.textContent = 'Active days';
        daysLbl.style.cssText = `font-size: 12px; font-weight: 600; color: ${C.textMuted};`;
        daysWrap.appendChild(daysLbl);
        const chips = buildDayChips(win.days, (d) => { win.days = d; }, accent);
        daysWrap.appendChild(chips.wrap);
        block.appendChild(daysWrap);

        const timesRow = document.createElement('div');
        timesRow.style.cssText = 'display: flex; gap: 12px; align-items: flex-end;';
        const startCol = document.createElement('div');
        startCol.style.flex = '1';
        const startField = buildTextField(startCol, 'Start', win.start, { type: 'time' });
        startField.input.addEventListener('input', () => { win.start = startField.input.value; });
        timesRow.appendChild(startCol);
        const arrow = document.createElement('div');
        arrow.textContent = '→';
        arrow.style.cssText = `padding: 0 4px 10px 4px; color: ${withAlpha(C.text, 0.4)};`;
        timesRow.appendChild(arrow);
        const endCol = document.createElement('div');
        endCol.style.flex = '1';
        const endField = buildTextField(endCol, 'End', win.end, { type: 'time' });
        endField.input.addEventListener('input', () => { win.end = endField.input.value; });
        timesRow.appendChild(endCol);
        block.appendChild(timesRow);

        const priceAdjRow = document.createElement('div');
        priceAdjRow.style.cssText = 'display: flex; gap: 12px; align-items: flex-end;';
        const priceAdjCol = document.createElement('div');
        priceAdjCol.style.flex = '1';
        const priceAdjField = buildTextField(priceAdjCol, 'Price adjustment', win.price_adjustment_pct || 0, {
            type: 'number',
            step: '0.1',
            min: '-100',
            max: '100'
        });
        priceAdjField.input.addEventListener('input', () => {
            win.price_adjustment_pct = parseFloat(priceAdjField.input.value) || 0;
        });
        priceAdjRow.appendChild(priceAdjCol);
        const priceAdjUnit = document.createElement('div');
        priceAdjUnit.textContent = '%';
        priceAdjUnit.style.cssText = `padding: 0 4px 10px 4px; color: ${withAlpha(C.text, 0.4)}; font-weight: 600;`;
        priceAdjRow.appendChild(priceAdjUnit);
        block.appendChild(priceAdjRow);

        const priceAdjHint = document.createElement('div');
        priceAdjHint.textContent = 'Negative = discount, positive = surcharge';
        priceAdjHint.style.cssText = `
            font-size: 10px; color: ${withAlpha(C.text, 0.5)};
            margin-top: -4px; margin-bottom: 4px;
        `;
        block.appendChild(priceAdjHint);

        return block;
    }

    const addBtn = buildAddBtn('+ Add window', accent);
    addBtn.addEventListener('click', () => {
        windows.push(defaultWindow());
        render();
    });
    wrap.appendChild(addBtn);

    render();
    parent.appendChild(wrap);
    return { getWindows: () => windows };
}

/* ─── DAY PART MODAL ─────────────────────────────────────────── */
const openDayPartModal = (existing) => {
    const isEdit = !!existing;
    const dp = existing ? clone(existing) : defaultDayPart();

    openModal(isEdit ? `Edit day part: ${dp.name || ''}` : 'Add day part', (body, modalEl, ov) => {
        const nameField = buildTextField(body, 'Name', dp.name, { required: true, placeholder: 'e.g. Lunch, Dinner, Late Night' });
        const descField = buildTextField(body, 'Description (optional)', dp.description, { placeholder: 'e.g. weekday midday service' });

        body.appendChild(buildDivider());
        body.appendChild(buildSectionLabel('WINDOWS', C2.lavender));
        const hint = document.createElement('div');
        hint.textContent = 'Day part is active during any of these windows. Specials referencing this day part inherit the schedule.';
        hint.style.cssText = `font-size: 11px; color: ${C.textDim}; line-height: 1.4;`;
        body.appendChild(hint);

        const windowEditor = buildWindowEditor(body, dp.windows, C2.lavender);

        if (isEdit) {
            body.appendChild(buildDivider());
            const dependents = findSpecialsUsingDayPart(dp.id);
            const delBtn = buildPillButton('Delete day part', 'danger', () => {
                if (dependents.length > 0) {
                    openDayPartDependentsModal(dp, dependents);
                    return;
                }
                if (!confirm(`Delete "${dp.name}"?`)) return;
                trackDayPartDelete(dp.id);
                closeModal(ov);
            });
            delBtn.style.width = '100%';
            body.appendChild(delBtn);
        }

        const footer = document.createElement('div');
        footer.style.cssText = `display: flex; gap: 10px; justify-content: flex-end; padding-top: 14px; border-top: 1px solid ${C2.hairline}; margin-top: 6px;`;
        footer.appendChild(buildPillButton('Cancel', 'tertiary', () => closeModal(ov), { small: true }));
        footer.appendChild(buildPillButton(isEdit ? 'Save' : 'Create', 'primary', () => {
            const name = nameField.input.value.trim();
            if (!name) { nameField.input.style.borderColor = C.verm; return; }
            const gathered = {
                ...dp,
                name,
                description: descField.input.value.trim(),
                windows: windowEditor.getWindows(),
            };
            if (isEdit) trackDayPartEdit(gathered);
            else trackDayPartCreate(gathered);
            closeModal(ov);
        }, { small: true }));
        body.appendChild(footer);
    }, { accent: C2.lavender });
}

const findSpecialsUsingDayPart = (dpId) => getAllSpecials().filter(sp =>
        sp.schedule.mode === 'daypart' && (sp.schedule.daypart_ids || []).includes(dpId)
    );
;

const openDayPartDependentsModal = (dp, dependents) => {
    openModal('Day part in use', (body, modalEl, ov) => {
        const hint = document.createElement('div');
        hint.innerHTML = `<strong style="color:${C.text};">${dp.name}</strong> is used by <strong style="color:${C2.warning};">${dependents.length}</strong> active special${dependents.length === 1 ? '' : 's'}. Remove it from them (or swap their day part) before deleting.`;
        hint.style.cssText = `font-size: 13px; color: ${C.textMuted}; line-height: 1.5;`;
        body.appendChild(hint);

        const list = document.createElement('div');
        list.style.cssText = 'display: flex; flex-direction: column; gap: 6px; margin-top: 4px;';
        dependents.forEach(sp => {
            const row = document.createElement('div');
            row.style.cssText = `
                padding: 10px 14px;
                background: ${C.well};
                border-left: 3px solid ${C.gold};
                border-radius: 6px;
                font-size: 14px; color: ${C.text}; font-weight: 500;
            `;
            row.textContent = sp.name;
            list.appendChild(row);
        });
        body.appendChild(list);

        const footer = document.createElement('div');
        footer.style.cssText = `display: flex; gap: 10px; justify-content: flex-end; padding-top: 14px; border-top: 1px solid ${C2.hairline}; margin-top: 10px;`;
        footer.appendChild(buildPillButton('Got it', 'primary', () => closeModal(ov), { small: true }));
        body.appendChild(footer);
    }, { accent: C2.warning });
}

/* ─── VOID REASON MODAL ──────────────────────────────────────── */
const openVoidReasonModal = (existing) => {
    const isEdit = !!existing;
    const r = existing ? clone(existing) : defaultVoidReason();

    openModal(isEdit ? `Edit void reason: ${r.name || ''}` : 'Add void reason', (body, modalEl, ov) => {
        const nameField = buildTextField(body, 'Reason name', r.name, { required: true, placeholder: 'Kitchen Error, Customer Complaint…' });
        const pinToggle = buildToggleRow(body, 'Requires manager PIN', r.requires_pin, (on) => { r.requires_pin = on; }, C.gold);
        const maxField  = buildTextField(body, 'Max void amount (blank = unlimited)', r.max_amount != null ? r.max_amount : '', { type: 'number', step: '0.01', placeholder: 'Leave blank for no limit' });

        if (isEdit) {
            body.appendChild(buildDivider());
            const delBtn = buildPillButton('Delete reason', 'danger', () => {
                if (!confirm(`Delete "${r.name}"?`)) return;
                trackVoidReasonDelete(r.id);
                closeModal(ov);
            });
            delBtn.style.width = '100%';
            body.appendChild(delBtn);
        }

        const footer = document.createElement('div');
        footer.style.cssText = `display: flex; gap: 10px; justify-content: flex-end; padding-top: 14px; border-top: 1px solid ${C2.hairline}; margin-top: 6px;`;
        footer.appendChild(buildPillButton('Cancel', 'tertiary', () => closeModal(ov), { small: true }));
        footer.appendChild(buildPillButton(isEdit ? 'Save' : 'Create', 'primary', () => {
            const name = nameField.input.value.trim();
            if (!name) { nameField.input.style.borderColor = C.verm; return; }
            const gathered = {
                ...r,
                name,
                requires_pin: pinToggle.isOn(),
                max_amount:   maxField.input.value.trim() ? parseFloat(maxField.input.value) : null,
                active:       true,
            };
            if (isEdit) trackVoidReasonEdit(gathered);
            else trackVoidReasonCreate(gathered);
            closeModal(ov);
        }, { small: true }));
        body.appendChild(footer);
    }, { accent: C.verm });
}

/* ─── EVENT GENERATION ───────────────────────────────────────── */
const generatePricingEvents = () => {
    const events = [];
    const batch_id = `pricing_batch_${Date.now()}`;
    const ts = () => new Date().toISOString();

    pendingChanges.day_parts_new.forEach(dp => {
        const id = dp.id.replace(/^temp_/, '');
        events.push({ event_type: 'pricing.daypart_created', batch_id, timestamp: ts(),
            payload: { ...dp, id } });
    });
    pendingChanges.day_parts_edited.forEach(dp => {
        events.push({ event_type: 'pricing.daypart_updated', batch_id, timestamp: ts(), payload: dp });
    });
    pendingChanges.day_parts_deleted.forEach(id => {
        events.push({ event_type: 'pricing.daypart_deleted', batch_id, timestamp: ts(), payload: { id } });
    });

    pendingChanges.specials_new.forEach(sp => {
        const id = sp.id.replace(/^temp_/, '');
        events.push({ event_type: 'pricing.special_created', batch_id, timestamp: ts(),
            payload: { ...sp, id } });
    });
    pendingChanges.specials_edited.forEach(sp => {
        events.push({ event_type: 'pricing.special_updated', batch_id, timestamp: ts(), payload: sp });
    });
    pendingChanges.specials_deleted.forEach(id => {
        events.push({ event_type: 'pricing.special_deleted', batch_id, timestamp: ts(), payload: { id } });
    });

    pendingChanges.order_types_edited.forEach(ot => {
        events.push({ event_type: 'pricing.order_type_updated', batch_id, timestamp: ts(), payload: ot });
    });

    if (pendingChanges.employee_edited) {
        events.push({ event_type: 'pricing.employee_discount_updated', batch_id, timestamp: ts(),
            payload: pendingChanges.employee_edited });
    }

    pendingChanges.void_reasons_new.forEach(r => {
        const id = r.id.replace(/^temp_/, '');
        events.push({ event_type: 'pricing.void_reason_created', batch_id, timestamp: ts(),
            payload: { ...r, id } });
    });
    pendingChanges.void_reasons_edited.forEach(r => {
        events.push({ event_type: 'pricing.void_reason_updated', batch_id, timestamp: ts(), payload: r });
    });
    pendingChanges.void_reasons_deleted.forEach(id => {
        events.push({ event_type: 'pricing.void_reason_deleted', batch_id, timestamp: ts(), payload: { id } });
    });

    return events;
}

const handleSaveChanges = async () => {
    const events = generatePricingEvents();
    if (events.length === 0) return;

    const result = await pushChanges(events);
    if (!result.ok) {
        showToast('Failed to save changes — try again', 'error');
        return;
    }

    // Apply to base
    pendingChanges.day_parts_new.forEach(dp => pricingData.day_parts.push(clone(dp)));
    pendingChanges.day_parts_edited.forEach(dp => {
        const idx = pricingData.day_parts.findIndex(d => d.id === dp.id);
        if (idx !== -1) pricingData.day_parts[idx] = clone(dp);
    });
    pendingChanges.day_parts_deleted.forEach(id => {
        pricingData.day_parts = pricingData.day_parts.filter(d => d.id !== id);
    });

    pendingChanges.specials_new.forEach(sp => pricingData.specials.push(clone(sp)));
    pendingChanges.specials_edited.forEach(sp => {
        const idx = pricingData.specials.findIndex(s => s.id === sp.id);
        if (idx !== -1) pricingData.specials[idx] = clone(sp);
    });
    pendingChanges.specials_deleted.forEach(id => {
        pricingData.specials = pricingData.specials.filter(s => s.id !== id);
    });

    pendingChanges.order_types_edited.forEach(ot => {
        const idx = pricingData.order_types.findIndex(o => o.id === ot.id);
        if (idx !== -1) pricingData.order_types[idx] = clone(ot);
    });

    if (pendingChanges.employee_edited) {
        pricingData.employee_discount = clone(pendingChanges.employee_edited);
    }

    pendingChanges.void_reasons_new.forEach(r => pricingData.void_reasons.push(clone(r)));
    pendingChanges.void_reasons_edited.forEach(r => {
        const idx = pricingData.void_reasons.findIndex(x => x.id === r.id);
        if (idx !== -1) pricingData.void_reasons[idx] = clone(r);
    });
    pendingChanges.void_reasons_deleted.forEach(id => {
        pricingData.void_reasons = pricingData.void_reasons.filter(x => x.id !== id);
    });

    const n = events.length;
    pendingChanges = emptyChanges();
    renderScene();
    showToast(`${n} change${n === 1 ? '' : 's'} saved`);
}

/* ─── ANIMATION ──────────────────────────────────────────────── */
const injectAnimations = () => {
    if (document.getElementById('psp-keyframes')) return;
    const s = document.createElement('style');
    s.id = 'psp-keyframes';
    s.textContent = `
        @keyframes psp-fade-in {
            from { opacity: 0; transform: translateY(-4px); }
            to   { opacity: 1; transform: none; }
        }
    `;
    document.head.appendChild(s);
}