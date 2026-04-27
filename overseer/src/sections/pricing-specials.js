import { pushChanges } from '../services/config-push.js';
import {
    C, buildScenePage, showToast, withAlpha,
} from '../ui/forms.js';

/* ============================================
   KINDpos Overseer — Specials & Discounts (Nostalgia)

   Accordion scene consolidating:
     — Day Parts (scheduling primitive for specials)
     — Specials (promotional pricing events)
     — Order Type Pricing (Dine-In/Takeout/Delivery %)
     — Employee Discount (staff policy)
     — Comp Reasons (manager comp flow policy)

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
    comp_reasons:       [],
    categories:         [],
};

let pendingChanges = {
    day_parts_new: [],       day_parts_edited: [],     day_parts_deleted: [],
    specials_new: [],        specials_edited: [],      specials_deleted: [],
    order_types_edited: [],
    employee_edited: null,
    comp_reasons_new: [],    comp_reasons_edited: [],  comp_reasons_deleted: [],
};

let displayState = {
    openSection: 'specials',   // one of: day-parts, specials, order-types, employee, comp-reasons, null
};

const modalStack = [];

/* ─── HELPERS ────────────────────────────────────────────────── */
function clone(o) { return JSON.parse(JSON.stringify(o)); }

function getPendingCount() {
    return pendingChanges.day_parts_new.length
         + pendingChanges.day_parts_edited.length
         + pendingChanges.day_parts_deleted.length
         + pendingChanges.specials_new.length
         + pendingChanges.specials_edited.length
         + pendingChanges.specials_deleted.length
         + pendingChanges.order_types_edited.length
         + (pendingChanges.employee_edited ? 1 : 0)
         + pendingChanges.comp_reasons_new.length
         + pendingChanges.comp_reasons_edited.length
         + pendingChanges.comp_reasons_deleted.length;
}

function defaultWindow() {
    return { label: '', days: [1,1,1,1,1,1,1], start: '09:00', end: '17:00' };
}

function defaultDayPart() {
    return {
        id:          `temp_dp_${Date.now()}`,
        name:        '',
        description: '',
        windows:     [defaultWindow()],
    };
}

function defaultSpecial() {
    return {
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
    };
}

function defaultEmployee() {
    return {
        id:                 'emp_disc',
        separate_rates:     false,
        percentage:         20,
        on_duty_rate:       50,
        off_duty_rate:      20,
        applies_to:         'food_only',
        exclude_categories: [],
        requires_pin:       true,
        active:             true,
    };
}

function defaultCompReason() {
    return {
        id:           `temp_comp_${Date.now()}`,
        name:         '',
        requires_pin: true,
        max_amount:   null,
        active:       true,
    };
}

/* ─── DATA FETCH ─────────────────────────────────────────────── */
function migrateDayPart(raw) {
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

function migrateSpecial(raw) {
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

async function fetchPricingData() {
    try {
        const [dpRes, spRes, otRes, empRes, compRes, catRes] = await Promise.all([
            fetch('/api/v1/config/pricing/day-parts').catch(() => ({ ok: false })),
            fetch('/api/v1/config/pricing/specials').catch(() => ({ ok: false })),
            fetch('/api/v1/config/pricing/order-types').catch(() => ({ ok: false })),
            fetch('/api/v1/config/pricing/employee-discount').catch(() => ({ ok: false })),
            fetch('/api/v1/config/pricing/comp-reasons').catch(() => ({ ok: false })),
            fetch('/api/v1/config/menu/categories').catch(() => ({ ok: false })),
        ]);

        const day_parts   = dpRes.ok   ? (await dpRes.json()).map(migrateDayPart)  : [];
        const specials    = spRes.ok   ? (await spRes.json()).map(migrateSpecial)  : [];
        const order_types = otRes.ok   ? await otRes.json()   : [
            { id: 'ot_dinein',   name: 'Dine-In',  adjustment: 0, active: true },
            { id: 'ot_takeout',  name: 'Takeout',  adjustment: 0, active: true },
            { id: 'ot_delivery', name: 'Delivery', adjustment: 0, active: true },
        ];
        const employee_discount = empRes.ok ? await empRes.json() : defaultEmployee();
        const comp_reasons = compRes.ok ? await compRes.json() : [];
        const rawCats = catRes.ok ? await catRes.json() : [];
        const categories = rawCats.map(c => ({
            id:    c.category_id || c.id,
            name:  c.name || c.label || '',
            color: c.hex_color || c.color || C.gold,
        }));

        return { day_parts, specials, order_types, employee_discount, comp_reasons, categories };
    } catch (e) {
        console.warn('[PricingSpecials] Failed to fetch:', e);
        return {
            day_parts: [], specials: [], order_types: [],
            employee_discount: defaultEmployee(),
            comp_reasons: [], categories: [],
        };
    }
}

/* ─── WORKING-STATE RESOLVERS ────────────────────────────────── */
function getAllDayParts() {
    const edits = new Map(pendingChanges.day_parts_edited.map(e => [e.id, e]));
    const deleted = new Set(pendingChanges.day_parts_deleted);
    return pricingData.day_parts
        .map(d => edits.has(d.id) ? edits.get(d.id) : clone(d))
        .filter(d => !deleted.has(d.id))
        .concat(pendingChanges.day_parts_new);
}

function getAllSpecials() {
    const edits = new Map(pendingChanges.specials_edited.map(e => [e.id, e]));
    const deleted = new Set(pendingChanges.specials_deleted);
    return pricingData.specials
        .map(s => edits.has(s.id) ? edits.get(s.id) : clone(s))
        .filter(s => !deleted.has(s.id))
        .concat(pendingChanges.specials_new);
}

function getAllOrderTypes() {
    const edits = new Map(pendingChanges.order_types_edited.map(e => [e.id, e]));
    return pricingData.order_types.map(o => edits.has(o.id) ? edits.get(o.id) : clone(o));
}

function getWorkingEmployee() {
    return pendingChanges.employee_edited
        ? clone(pendingChanges.employee_edited)
        : clone(pricingData.employee_discount || defaultEmployee());
}

function getAllCompReasons() {
    const edits = new Map(pendingChanges.comp_reasons_edited.map(e => [e.id, e]));
    const deleted = new Set(pendingChanges.comp_reasons_deleted);
    return pricingData.comp_reasons
        .map(r => edits.has(r.id) ? edits.get(r.id) : clone(r))
        .filter(r => !deleted.has(r.id))
        .concat(pendingChanges.comp_reasons_new);
}

/* ─── CHANGE TRACKERS ────────────────────────────────────────── */
function trackDayPartCreate(dp) { pendingChanges.day_parts_new.push(dp); renderScene(); }
function trackDayPartEdit(dp) {
    if (pendingChanges.day_parts_new.some(n => n.id === dp.id)) {
        const i = pendingChanges.day_parts_new.findIndex(n => n.id === dp.id);
        pendingChanges.day_parts_new[i] = dp; renderScene(); return;
    }
    const i = pendingChanges.day_parts_edited.findIndex(e => e.id === dp.id);
    if (i !== -1) pendingChanges.day_parts_edited[i] = dp;
    else pendingChanges.day_parts_edited.push(dp);
    renderScene();
}
function trackDayPartDelete(id) {
    const i = pendingChanges.day_parts_new.findIndex(n => n.id === id);
    if (i !== -1) { pendingChanges.day_parts_new.splice(i, 1); renderScene(); return; }
    pendingChanges.day_parts_edited = pendingChanges.day_parts_edited.filter(e => e.id !== id);
    if (!pendingChanges.day_parts_deleted.includes(id)) pendingChanges.day_parts_deleted.push(id);
    renderScene();
}

function trackSpecialCreate(sp) { pendingChanges.specials_new.push(sp); renderScene(); }
function trackSpecialEdit(sp) {
    if (pendingChanges.specials_new.some(n => n.id === sp.id)) {
        const i = pendingChanges.specials_new.findIndex(n => n.id === sp.id);
        pendingChanges.specials_new[i] = sp; renderScene(); return;
    }
    const i = pendingChanges.specials_edited.findIndex(e => e.id === sp.id);
    if (i !== -1) pendingChanges.specials_edited[i] = sp;
    else pendingChanges.specials_edited.push(sp);
    renderScene();
}
function trackSpecialDelete(id) {
    const i = pendingChanges.specials_new.findIndex(n => n.id === id);
    if (i !== -1) { pendingChanges.specials_new.splice(i, 1); renderScene(); return; }
    pendingChanges.specials_edited = pendingChanges.specials_edited.filter(e => e.id !== id);
    if (!pendingChanges.specials_deleted.includes(id)) pendingChanges.specials_deleted.push(id);
    renderScene();
}

function trackOrderTypeEdit(ot) {
    const i = pendingChanges.order_types_edited.findIndex(e => e.id === ot.id);
    if (i !== -1) pendingChanges.order_types_edited[i] = ot;
    else pendingChanges.order_types_edited.push(ot);
    renderScene();
}

function trackEmployeeEdit(emp) { pendingChanges.employee_edited = emp; renderScene(); }

function trackCompReasonCreate(r) { pendingChanges.comp_reasons_new.push(r); renderScene(); }
function trackCompReasonEdit(r) {
    if (pendingChanges.comp_reasons_new.some(n => n.id === r.id)) {
        const i = pendingChanges.comp_reasons_new.findIndex(n => n.id === r.id);
        pendingChanges.comp_reasons_new[i] = r; renderScene(); return;
    }
    const i = pendingChanges.comp_reasons_edited.findIndex(e => e.id === r.id);
    if (i !== -1) pendingChanges.comp_reasons_edited[i] = r;
    else pendingChanges.comp_reasons_edited.push(r);
    renderScene();
}
function trackCompReasonDelete(id) {
    const i = pendingChanges.comp_reasons_new.findIndex(n => n.id === id);
    if (i !== -1) { pendingChanges.comp_reasons_new.splice(i, 1); renderScene(); return; }
    pendingChanges.comp_reasons_edited = pendingChanges.comp_reasons_edited.filter(e => e.id !== id);
    if (!pendingChanges.comp_reasons_deleted.includes(id)) pendingChanges.comp_reasons_deleted.push(id);
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
                employee_discount: null, comp_reasons: [], categories: [],
            };
            pendingChanges = emptyChanges();
            if (container) container.innerHTML = '';
        },
    });
}

function emptyChanges() {
    return {
        day_parts_new: [], day_parts_edited: [], day_parts_deleted: [],
        specials_new: [], specials_edited: [], specials_deleted: [],
        order_types_edited: [],
        employee_edited: null,
        comp_reasons_new: [], comp_reasons_edited: [], comp_reasons_deleted: [],
    };
}

function sceneSubtitle() {
    const dp = getAllDayParts().length;
    const sp = getAllSpecials().length;
    const ot = getAllOrderTypes().length;
    const cr = getAllCompReasons().length;
    return `${dp} day part${dp===1?'':'s'} · ${sp} special${sp===1?'':'s'} · ${ot} order types · ${cr} comp reason${cr===1?'':'s'}`;
}

/* ─── MAIN SCENE RENDER ──────────────────────────────────────── */
function renderScene() {
    if (!bodyMount) return;
    bodyMount.innerHTML = '';

    bodyMount.appendChild(buildSuperHeader('SPECIALS', C.gold));
    bodyMount.appendChild(buildDayPartsAccordion());
    bodyMount.appendChild(buildSpecialsAccordion());

    bodyMount.appendChild(buildOrderTypesAccordion());
    bodyMount.appendChild(buildSuperHeader('DISCOUNTS', C.green));
    bodyMount.appendChild(buildEmployeeAccordion());
    bodyMount.appendChild(buildCompReasonsAccordion());

    bodyMount.appendChild(buildPendingFooter());
    updateSaveBar();
}

function buildSuperHeader(label, color) {
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

function buildAccordion(key, title, meta, accentColor, bodyBuilder, countBadge = 0) {
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
            display: flex; flex-direction: column; gap: 10px;
            border-top: 1px solid ${C2.hairline};
        `;
        bodyBuilder(body);
        wrap.appendChild(body);
    }
    return wrap;
}

/* ─── DAY PARTS ACCORDION ────────────────────────────────────── */
function buildDayPartsAccordion() {
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

            const addBtn = buildAddBtn('+ Add day part', C2.lavender);
            addBtn.addEventListener('click', () => openDayPartModal(null));
            body.appendChild(addBtn);
        },
        pendingCount
    );
}

function buildDayPartCard(dp) {
    const pending = pendingChanges.day_parts_new.some(n => n.id === dp.id)
                 || pendingChanges.day_parts_edited.some(e => e.id === dp.id);

    const card = document.createElement('div');
    card.style.cssText = `
        background: ${C.well};
        border: 1px solid ${pending ? C.gold : withAlpha(C.text, 0.08)};
        border-left: 3px solid ${C2.lavender};
        border-radius: 8px;
        padding: 12px 14px;
        display: flex; flex-direction: column; gap: 6px;
        cursor: pointer;
        transition: background 0.15s ease;
    `;
    card.addEventListener('mouseenter', () => card.style.background = C.card);
    card.addEventListener('mouseleave', () => card.style.background = C.well);
    card.addEventListener('click', () => openDayPartModal(dp));

    const name = document.createElement('div');
    name.textContent = dp.name || '(unnamed)';
    name.style.cssText = `font-size: 14px; font-weight: 600; color: ${C.text};`;
    card.appendChild(name);

    const desc = document.createElement('div');
    desc.textContent = summarizeWindows(dp.windows);
    desc.style.cssText = `
        font-family: ui-monospace, monospace;
        font-size: 11px; color: ${C.textMuted};
        letter-spacing: 1.2px;
    `;
    card.appendChild(desc);

    if (dp.description) {
        const extra = document.createElement('div');
        extra.textContent = dp.description;
        extra.style.cssText = `font-size: 11px; color: ${C.textDim}; font-style: italic;`;
        card.appendChild(extra);
    }

    return card;
}

function summarizeWindows(windows) {
    if (!windows || windows.length === 0) return 'No windows defined';
    if (windows.length === 1) return formatWindow(windows[0]);
    const first = formatWindow(windows[0]);
    return `${first} · ${windows.length} windows`;
}

function formatWindow(win) {
    const days = win.days || [1,1,1,1,1,1,1];
    const onCount = days.filter(Boolean).length;
    let daysStr;
    if (onCount === 7) daysStr = 'daily';
    else if (onCount === 0) daysStr = '—';
    else if (days.slice(0,5).every(Boolean) && !days[5] && !days[6]) daysStr = 'M–F';
    else if (!days.slice(0,5).some(Boolean) && days[5] && days[6]) daysStr = 'Sat–Sun';
    else daysStr = days.map((d,i) => d ? DAY_LABELS[i][0] : null).filter(Boolean).join('·');
    return `${win.start}–${win.end} · ${daysStr}`;
}

/* ─── SPECIALS ACCORDION ─────────────────────────────────────── */
function buildSpecialsAccordion() {
    const specials = getAllSpecials();
    const pendingCount = pendingChanges.specials_new.length
                       + pendingChanges.specials_edited.length
                       + pendingChanges.specials_deleted.length;
    const active = specials.filter(s => s.active).length;
    const draft  = specials.length - active;

    return buildAccordion(
        'specials', 'Specials',
        `${active} active${draft > 0 ? ` · ${draft} draft` : ''}`,
        C.gold,
        (body) => {
            if (specials.length === 0) {
                const empty = document.createElement('div');
                empty.textContent = 'No specials yet — tap + Add to create one';
                empty.style.cssText = `
                    padding: 20px; text-align: center;
                    font-family: ui-monospace, monospace;
                    font-size: 11px; color: ${C.textDim};
                    letter-spacing: 1.5px; text-transform: uppercase;
                `;
                body.appendChild(empty);
            } else {
                specials
                    .sort((a, b) => (a.priority || 999) - (b.priority || 999))
                    .forEach(sp => body.appendChild(buildSpecialCard(sp)));
            }

            const addBtn = buildAddBtn('+ Add special', C.gold);
            addBtn.addEventListener('click', () => openSpecialModal(null));
            body.appendChild(addBtn);
        },
        pendingCount
    );
}

function buildSpecialCard(sp) {
    const pending = pendingChanges.specials_new.some(n => n.id === sp.id)
                 || pendingChanges.specials_edited.some(e => e.id === sp.id);
    const isManual = sp.schedule.mode === 'manual';
    const accent = isManual ? C2.lavender : C.gold;

    const card = document.createElement('div');
    card.style.cssText = `
        background: ${C.well};
        border: 1px solid ${pending ? C.gold : withAlpha(C.text, 0.08)};
        border-left: 3px solid ${accent};
        border-radius: 8px;
        padding: 12px 14px;
        display: flex; flex-direction: column; gap: 6px;
        cursor: pointer;
        opacity: ${sp.active ? '1' : '0.55'};
        transition: background 0.15s ease;
    `;
    card.addEventListener('mouseenter', () => card.style.background = C.card);
    card.addEventListener('mouseleave', () => card.style.background = C.well);
    card.addEventListener('click', () => openSpecialModal(sp));

    // Headline row
    const headline = document.createElement('div');
    headline.style.cssText = 'display: flex; align-items: center; gap: 10px;';

    const name = document.createElement('div');
    name.textContent = sp.name || '(unnamed)';
    name.style.cssText = `font-size: 15px; font-weight: 600; color: ${C.text};`;
    headline.appendChild(name);

    const valueEl = document.createElement('div');
    valueEl.textContent = formatDiscountValue(sp);
    valueEl.style.cssText = `
        font-family: ui-monospace, monospace;
        font-size: 14px; font-weight: 700;
        color: ${accent};
        letter-spacing: 0.5px;
    `;
    headline.appendChild(valueEl);

    const spacer = document.createElement('div');
    spacer.style.flex = '1';
    headline.appendChild(spacer);

    const statusChip = document.createElement('div');
    statusChip.textContent = sp.active ? '● ON' : '○ OFF';
    statusChip.style.cssText = `
        padding: 3px 10px; border-radius: 999px;
        font-family: ui-monospace, monospace;
        font-size: 10px; font-weight: 700; letter-spacing: 1.5px;
        background: ${sp.active ? withAlpha(C.green, 0.15) : withAlpha(C.text, 0.12)};
        color: ${sp.active ? C.green : withAlpha(C.text, 0.55)};
    `;
    headline.appendChild(statusChip);
    card.appendChild(headline);

    // Descriptor row
    const desc = document.createElement('div');
    desc.style.cssText = `
        display: flex; gap: 6px; flex-wrap: wrap; align-items: center;
        font-family: ui-monospace, monospace;
        font-size: 10px; font-weight: 700;
        letter-spacing: 1.5px;
        color: ${withAlpha(C.text, 0.5)};
    `;

    // Schedule
    const schedPart = document.createElement('span');
    schedPart.style.color = C2.lavender;
    schedPart.textContent = formatScheduleDescriptor(sp);
    desc.appendChild(schedPart);

    desc.appendChild(makeDot());

    // Scope
    const scopePart = document.createElement('span');
    scopePart.style.color = C.green;
    scopePart.textContent = formatScopeDescriptor(sp);
    desc.appendChild(scopePart);

    desc.appendChild(makeDot());

    // Apply mode
    const applyPart = document.createElement('span');
    applyPart.style.color = sp.apply_mode === 'auto' ? C.green : C.gold;
    applyPart.textContent = sp.apply_mode === 'auto' ? '⚡ AUTO' : '✋ ASK';
    desc.appendChild(applyPart);

    desc.appendChild(makeDot());

    // Priority / rules
    const rules = [`P${sp.priority}`];
    if (sp.stacking) rules.push('STACKS');
    if (sp.requires_pin) rules.push('PIN');
    const rulesPart = document.createElement('span');
    rulesPart.textContent = rules.join(' · ');
    desc.appendChild(rulesPart);

    card.appendChild(desc);
    return card;
}

function makeDot() {
    const d = document.createElement('span');
    d.textContent = '·';
    d.style.color = withAlpha(C.text, 0.25);
    return d;
}

function formatDiscountValue(sp) {
    const v = sp.discount_value;
    if (sp.discount_type === 'percentage') return `${v > 0 ? '+' : ''}${v}%`;
    if (sp.discount_type === 'flat')       return `${v >= 0 ? '+' : '−'}$${Math.abs(v).toFixed(2)} off`;
    if (sp.discount_type === 'fixed_price') return `$${v.toFixed(2)} fixed`;
    return String(v);
}

function formatScheduleDescriptor(sp) {
    if (sp.schedule.mode === 'manual') return '⚑ MANUAL';
    if (sp.schedule.mode === 'daypart') {
        const names = (sp.schedule.daypart_ids || [])
            .map(id => (getAllDayParts().find(dp => dp.id === id) || {}).name)
            .filter(Boolean);
        if (names.length === 0) return '◔ NO DAY PART';
        if (names.length === 1) return `◔ ${names[0].toUpperCase()}`;
        return `◔ ${names.map(n => n.toUpperCase()).join(' + ')}`;
    }
    // custom
    const win = (sp.schedule.custom_windows || [])[0];
    if (!win) return '⏰ NO WINDOW';
    return `⏰ ${formatWindow(win).toUpperCase()}`;
}

function formatScopeDescriptor(sp) {
    if (sp.scope.mode === 'all') return 'ALL ITEMS';
    if (sp.scope.mode === 'items') return `${sp.scope.ids.length} ITEMS`;
    const cats = (sp.scope.ids || [])
        .map(id => (pricingData.categories.find(c => c.id === id) || {}).name)
        .filter(Boolean);
    if (cats.length === 0) return 'NO CATEGORIES';
    if (cats.length <= 2) return cats.map(n => n.toUpperCase()).join(' + ');
    return `${cats.length} CATEGORIES`;
}

/* ─── ORDER TYPES ACCORDION ──────────────────────────────────── */
function buildOrderTypesAccordion() {
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

function fmtPct(n) {
    if (!n) return '0%';
    return `${n > 0 ? '+' : ''}${n}%`;
}

function buildOrderTypeRow(ot) {
    const edited = pendingChanges.order_types_edited.some(e => e.id === ot.id);
    const row = document.createElement('div');
    row.style.cssText = `
        display: flex; align-items: center; gap: 12px;
        padding: 10px 14px;
        background: ${C.well};
        border: 1px solid ${edited ? C.gold : withAlpha(C.text, 0.08)};
        border-radius: 8px;
        opacity: ${ot.active ? '1' : '0.55'};
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

function buildInlineToggle(initial, onChange) {
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

/* ─── EMPLOYEE DISCOUNT ACCORDION ────────────────────────────── */
function buildEmployeeAccordion() {
    const emp = getWorkingEmployee();
    const meta = emp.separate_rates
        ? `On-duty ${emp.on_duty_rate}% · Off-duty ${emp.off_duty_rate}%`
        : `${emp.percentage}% · ${friendlyAppliesTo(emp.applies_to)}`;
    return buildAccordion(
        'employee', 'Employee Discount',
        meta,
        C.green,
        (body) => {
            const card = document.createElement('div');
            card.style.cssText = `
                background: ${C.well};
                border: 1px solid ${pendingChanges.employee_edited ? C.gold : withAlpha(C.text, 0.08)};
                border-radius: 8px;
                padding: 14px;
                display: flex; flex-direction: column; gap: 12px;
            `;

            const rateRow = document.createElement('div');
            rateRow.style.cssText = 'display: flex; gap: 24px;';
            if (emp.separate_rates) {
                rateRow.appendChild(buildRateCol('ON-DUTY', `${emp.on_duty_rate}%`, C.green));
                rateRow.appendChild(buildRateCol('OFF-DUTY', `${emp.off_duty_rate}%`, C.gold));
            } else {
                rateRow.appendChild(buildRateCol('DISCOUNT', `${emp.percentage}%`, C.green));
            }
            card.appendChild(rateRow);

            const pillRow = document.createElement('div');
            pillRow.style.cssText = 'display: flex; gap: 6px; flex-wrap: wrap;';
            pillRow.appendChild(makePill(friendlyAppliesTo(emp.applies_to), 'mint'));
            if (emp.exclude_categories && emp.exclude_categories.length > 0) {
                const names = emp.exclude_categories
                    .map(id => (pricingData.categories.find(c => c.id === id) || {}).name)
                    .filter(Boolean);
                if (names.length) pillRow.appendChild(makePill(`excl. ${names.join(', ')}`, 'verm'));
            }
            if (emp.requires_pin) pillRow.appendChild(makePill('PIN required', 'gold'));
            if (emp.separate_rates) pillRow.appendChild(makePill('separate rates', 'muted'));
            card.appendChild(pillRow);

            const editBtn = buildAddBtn('Edit settings', C.green);
            editBtn.style.alignSelf = 'stretch';
            editBtn.style.textAlign = 'center';
            editBtn.addEventListener('click', () => openEmployeeModal(emp));
            card.appendChild(editBtn);

            body.appendChild(card);
        },
        pendingChanges.employee_edited ? 1 : 0
    );
}

function friendlyAppliesTo(a) {
    return { everything: 'everything', food_only: 'food only', drinks_only: 'drinks only' }[a] || a;
}

function buildRateCol(label, value, color) {
    const col = document.createElement('div');
    const lbl = document.createElement('div');
    lbl.textContent = label;
    lbl.style.cssText = `
        font-family: ui-monospace, monospace;
        font-size: 10px; color: ${C.textMuted};
        letter-spacing: 1.5px; font-weight: 700;
        margin-bottom: 4px;
    `;
    col.appendChild(lbl);
    const val = document.createElement('div');
    val.textContent = value;
    val.style.cssText = `
        font-family: ui-monospace, monospace;
        font-size: 22px; font-weight: 700;
        color: ${color};
    `;
    col.appendChild(val);
    return col;
}

function makePill(text, tone) {
    const toneMap = {
        mint:  { bg: withAlpha(C.green, 0.15),    fg: C.green  },
        gold:  { bg: withAlpha(C.gold, 0.18),     fg: C.gold   },
        verm:  { bg: withAlpha(C.verm, 0.18),     fg: C.verm   },
        muted: { bg: withAlpha(C.text, 0.1),      fg: withAlpha(C.text, 0.6) },
    };
    const t = toneMap[tone] || toneMap.muted;
    const p = document.createElement('div');
    p.textContent = text;
    p.style.cssText = `
        padding: 3px 10px; border-radius: 999px;
        font-family: ui-monospace, monospace;
        font-size: 9px; font-weight: 700; letter-spacing: 1.5px;
        background: ${t.bg}; color: ${t.fg};
    `;
    return p;
}

/* ─── COMP REASONS ACCORDION ─────────────────────────────────── */
function buildCompReasonsAccordion() {
    const reasons = getAllCompReasons();
    const pinCount = reasons.filter(r => r.requires_pin).length;
    const pendingCount = pendingChanges.comp_reasons_new.length
                       + pendingChanges.comp_reasons_edited.length
                       + pendingChanges.comp_reasons_deleted.length;
    return buildAccordion(
        'comp-reasons', 'Comp Reasons',
        `${reasons.length} reason${reasons.length === 1 ? '' : 's'}${pinCount > 0 ? ` · ${pinCount} require PIN` : ''}`,
        C.verm,
        (body) => {
            if (reasons.length === 0) {
                const empty = document.createElement('div');
                empty.textContent = 'No comp reasons yet';
                empty.style.cssText = `
                    padding: 20px; text-align: center;
                    font-family: ui-monospace, monospace;
                    font-size: 11px; color: ${C.textDim};
                    letter-spacing: 1.5px; text-transform: uppercase;
                `;
                body.appendChild(empty);
            } else {
                reasons.forEach(r => body.appendChild(buildCompReasonRow(r)));
            }
            const addBtn = buildAddBtn('+ Add reason', C.verm);
            addBtn.addEventListener('click', () => openCompReasonModal(null));
            body.appendChild(addBtn);
        },
        pendingCount
    );
}

function buildCompReasonRow(r) {
    const pending = pendingChanges.comp_reasons_new.some(n => n.id === r.id)
                 || pendingChanges.comp_reasons_edited.some(e => e.id === r.id);
    const row = document.createElement('div');
    row.style.cssText = `
        display: flex; align-items: center; gap: 10px;
        padding: 10px 14px;
        background: ${C.well};
        border: 1px solid ${pending ? C.gold : withAlpha(C.text, 0.08)};
        border-left: 3px solid ${C.verm};
        border-radius: 8px;
        cursor: pointer;
        transition: background 0.15s ease;
    `;
    row.addEventListener('mouseenter', () => row.style.background = C.card);
    row.addEventListener('mouseleave', () => row.style.background = C.well);
    row.addEventListener('click', () => openCompReasonModal(r));

    const name = document.createElement('div');
    name.textContent = r.name || '(unnamed)';
    name.style.cssText = `flex: 1; font-size: 14px; color: ${C.text}; font-weight: 500;`;
    row.appendChild(name);

    if (r.requires_pin) row.appendChild(makePill('PIN', 'gold'));
    if (r.max_amount != null) row.appendChild(makePill(`max $${Number(r.max_amount).toFixed(2)}`, 'verm'));

    return row;
}

/* ─── FOOTER / SAVE BAR ──────────────────────────────────────── */
function buildPendingFooter() {
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

function updateSaveBar() {
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

/* ─── BUTTONS ────────────────────────────────────────────────── */
function buildPillButton(label, variant, onClick, opts = {}) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = label;
    const variants = {
        primary:   `background: ${C.gold};   color: #1a1000;    border: none;`,
        confirm:   `background: ${C.greenUp || C.green}; color: ${C.well};  border: none;`,
        danger:    `background: transparent; color: ${C.verm};  border: 1px solid ${C.verm};`,
        ghost:     `background: transparent; color: ${C.text};  border: 1px solid ${withAlpha(C.text, 0.2)};`,
        tertiary:  `background: transparent; color: ${C.textMuted}; border: 1px solid ${C.border};`,
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

function buildAddBtn(label, color) {
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
function openModal(titleText, contentBuilder, opts = {}) {
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

function closeModal(target) {
    if (modalStack.length === 0) return;
    const t = target || modalStack[modalStack.length - 1];
    const idx = modalStack.indexOf(t);
    if (idx === -1) return;
    modalStack.splice(idx, 1);
    if (t.parentNode) t.remove();
}

/* ─── FORM FIELDS ────────────────────────────────────────────── */
function buildTextField(parent, labelText, value, opts = {}) {
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

function buildSelectField(parent, labelText, value, choices) {
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

function buildSectionLabel(text, color) {
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

function buildDivider() {
    const d = document.createElement('div');
    d.style.cssText = `height: 1px; background: ${C2.hairline}; margin: 4px 0;`;
    return d;
}

function buildSegmented(options, currentValue, onSelect, activeColor) {
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

function buildDayChips(initialDays, onChange, activeColor) {
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

function buildToggleRow(parent, label, initial, onChange, color) {
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
function buildWindowEditor(parent, windows, accent) {
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
function openDayPartModal(existing) {
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

function findSpecialsUsingDayPart(dpId) {
    return getAllSpecials().filter(sp =>
        sp.schedule.mode === 'daypart' && (sp.schedule.daypart_ids || []).includes(dpId)
    );
}

function openDayPartDependentsModal(dp, dependents) {
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

/* ─── SPECIAL MODAL ──────────────────────────────────────────── */
function openSpecialModal(existing) {
    const isEdit = !!existing;
    const sp = existing ? clone(existing) : defaultSpecial();

    openModal(isEdit ? `Edit special: ${sp.name || ''}` : 'Add special', (body, modalEl, ov) => {
        // Name
        const nameField = buildTextField(body, 'Name', sp.name, { required: true, placeholder: 'Happy Hour, Taco Tuesday…' });

        // Discount
        const row1 = document.createElement('div');
        row1.style.cssText = 'display: flex; gap: 12px;';
        const typeCol = document.createElement('div');
        typeCol.style.cssText = 'flex: 1;';
        const typeField = buildSelectField(typeCol, 'Discount type', sp.discount_type, [
            { value: 'percentage', label: 'Percentage off (e.g. −25%)' },
            { value: 'flat',       label: 'Flat amount off (e.g. −$2)' },
            { value: 'fixed_price', label: 'Fixed price (e.g. $5 wells)' },
        ]);
        row1.appendChild(typeCol);
        const valCol = document.createElement('div');
        valCol.style.cssText = 'flex: 0 0 140px;';
        const valField = buildTextField(valCol, 'Value', sp.discount_value, { type: 'number', step: '0.01' });
        row1.appendChild(valCol);
        body.appendChild(row1);

        body.appendChild(buildDivider());

        // SCHEDULE
        body.appendChild(buildSectionLabel('SCHEDULE', C2.lavender));
        const schedWrap = document.createElement('div');
        schedWrap.style.cssText = 'display: flex; flex-direction: column; gap: 12px;';
        body.appendChild(schedWrap);

        const schedSeg = buildSegmented([
            { value: 'daypart', label: '◔ Day part' },
            { value: 'custom',  label: '⏰ Custom' },
            { value: 'manual',  label: '⚑ Manual' },
        ], sp.schedule.mode, (v) => {
            sp.schedule.mode = v;
            if (v === 'custom' && sp.schedule.custom_windows.length === 0) {
                sp.schedule.custom_windows.push(defaultWindow());
            }
            renderSchedDetails();
        }, C2.lavender);
        schedWrap.appendChild(schedSeg.wrap);

        const schedDetails = document.createElement('div');
        schedDetails.style.cssText = 'display: flex; flex-direction: column; gap: 10px;';
        schedWrap.appendChild(schedDetails);

        function renderSchedDetails() {
            schedDetails.innerHTML = '';
            if (sp.schedule.mode === 'daypart') {
                const lbl = document.createElement('div');
                lbl.textContent = 'Active day parts';
                lbl.style.cssText = `font-size: 12px; font-weight: 600; color: ${C.textMuted};`;
                schedDetails.appendChild(lbl);
                const dpList = getAllDayParts();
                if (dpList.length === 0) {
                    const empty = document.createElement('div');
                    empty.textContent = 'No day parts defined — switch to Custom or add a day part first.';
                    empty.style.cssText = `font-size: 11px; color: ${C.textDim}; font-style: italic;`;
                    schedDetails.appendChild(empty);
                } else {
                    const chipRow = document.createElement('div');
                    chipRow.style.cssText = 'display: flex; gap: 6px; flex-wrap: wrap;';
                    dpList.forEach(dp => {
                        const on = sp.schedule.daypart_ids.includes(dp.id);
                        const chip = document.createElement('button');
                        chip.type = 'button';
                        chip.textContent = dp.name;
                        const render = () => {
                            const active = sp.schedule.daypart_ids.includes(dp.id);
                            chip.style.cssText = `
                                padding: 7px 12px;
                                background: ${active ? withAlpha(C2.lavender, 0.15) : C.well};
                                border: 1px solid ${active ? C2.lavender : withAlpha(C.text, 0.12)};
                                border-radius: 999px;
                                color: ${active ? C2.lavender : C.text};
                                font-family: var(--font-body);
                                font-size: 13px; font-weight: 500;
                                cursor: pointer;
                                transition: all 0.15s ease;
                            `;
                        };
                        render();
                        chip.addEventListener('click', () => {
                            const set = new Set(sp.schedule.daypart_ids);
                            if (set.has(dp.id)) set.delete(dp.id);
                            else set.add(dp.id);
                            sp.schedule.daypart_ids = Array.from(set);
                            render();
                        });
                        chipRow.appendChild(chip);
                    });
                    schedDetails.appendChild(chipRow);
                }
                const hint = document.createElement('div');
                hint.textContent = 'Special runs whenever any selected day part is active. Change day part hours to affect every special using it.';
                hint.style.cssText = `font-size: 11px; color: ${C.textDim}; line-height: 1.4;`;
                schedDetails.appendChild(hint);
            } else if (sp.schedule.mode === 'custom') {
                const hint = document.createElement('div');
                hint.textContent = 'Inline schedule for this special only. For reusable hours across multiple specials, create a day part instead.';
                hint.style.cssText = `font-size: 11px; color: ${C.textDim}; line-height: 1.4;`;
                schedDetails.appendChild(hint);
                buildWindowEditor(schedDetails, sp.schedule.custom_windows, C2.lavender);
            } else {
                const hint = document.createElement('div');
                hint.textContent = 'Manager-controlled. Flip the master toggle at the terminal to enable. No automatic schedule — good for ad-hoc promotions and slow-day discounts.';
                hint.style.cssText = `font-size: 11px; color: ${C.textDim}; line-height: 1.4; padding: 12px 14px; background: ${withAlpha(C2.lavender, 0.08)}; border-left: 3px solid ${C2.lavender}; border-radius: 6px;`;
                schedDetails.appendChild(hint);
            }
        }
        renderSchedDetails();

        body.appendChild(buildDivider());

        // SCOPE
        body.appendChild(buildSectionLabel('SCOPE', C.green));
        const scopeWrap = document.createElement('div');
        scopeWrap.style.cssText = 'display: flex; flex-direction: column; gap: 10px;';
        body.appendChild(scopeWrap);

        const scopeSeg = buildSegmented([
            { value: 'all',        label: 'All items' },
            { value: 'categories', label: 'Categories' },
            { value: 'items',      label: 'Specific items' },
        ], sp.scope.mode, (v) => {
            sp.scope.mode = v;
            renderScopeDetails();
        }, C.green);
        scopeWrap.appendChild(scopeSeg.wrap);

        const scopeDetails = document.createElement('div');
        scopeWrap.appendChild(scopeDetails);

        function renderScopeDetails() {
            scopeDetails.innerHTML = '';
            if (sp.scope.mode === 'categories') {
                const cats = pricingData.categories;
                if (cats.length === 0) {
                    const empty = document.createElement('div');
                    empty.textContent = 'No categories loaded';
                    empty.style.cssText = `font-size: 11px; color: ${C.textDim}; font-style: italic; padding: 8px 0;`;
                    scopeDetails.appendChild(empty);
                    return;
                }
                const chipRow = document.createElement('div');
                chipRow.style.cssText = 'display: flex; gap: 6px; flex-wrap: wrap;';
                cats.forEach(cat => {
                    const chip = document.createElement('button');
                    chip.type = 'button';
                    chip.textContent = cat.name;
                    const render = () => {
                        const active = sp.scope.ids.includes(cat.id);
                        chip.style.cssText = `
                            padding: 7px 12px;
                            background: ${active ? withAlpha(C.green, 0.15) : C.well};
                            border: 1px solid ${active ? C.green : withAlpha(C.text, 0.12)};
                            border-radius: 999px;
                            color: ${active ? C.green : C.text};
                            font-family: var(--font-body);
                            font-size: 13px; font-weight: 500;
                            cursor: pointer;
                        `;
                    };
                    render();
                    chip.addEventListener('click', () => {
                        const set = new Set(sp.scope.ids);
                        if (set.has(cat.id)) set.delete(cat.id);
                        else set.add(cat.id);
                        sp.scope.ids = Array.from(set);
                        render();
                    });
                    chipRow.appendChild(chip);
                });
                scopeDetails.appendChild(chipRow);
            } else if (sp.scope.mode === 'items') {
                const note = document.createElement('div');
                note.textContent = 'Per-item scope coming soon. Use Categories for now.';
                note.style.cssText = `
                    font-size: 11px; color: ${C2.warning}; line-height: 1.4;
                    padding: 12px 14px;
                    background: ${C2.warningBg};
                    border-left: 3px solid ${C2.warning};
                    border-radius: 6px;
                `;
                scopeDetails.appendChild(note);
            }
        }
        renderScopeDetails();

        body.appendChild(buildDivider());

        // APPLY MODE
        body.appendChild(buildSectionLabel('APPLY MODE', C2.lavender));
        const applySeg = buildSegmented([
            { value: 'auto', label: '⚡ Auto — applies at checkout' },
            { value: 'ask',  label: '✋ Ask — staff taps to apply' },
        ], sp.apply_mode, (v) => { sp.apply_mode = v; }, C.green);
        body.appendChild(applySeg.wrap);
        const applyHint = document.createElement('div');
        applyHint.textContent = 'Auto-discounts land on the check the moment schedule + scope match — no server action needed. Switch to Ask for specials staff opts into per check.';
        applyHint.style.cssText = `font-size: 11px; color: ${C.textDim}; line-height: 1.4;`;
        body.appendChild(applyHint);

        body.appendChild(buildDivider());

        // RULES
        body.appendChild(buildSectionLabel('RULES', C2.lavender));
        const rulesRow = document.createElement('div');
        rulesRow.style.cssText = 'display: flex; gap: 12px; align-items: flex-end;';
        const prioCol = document.createElement('div');
        prioCol.style.flex = '0 0 100px';
        const prioField = buildTextField(prioCol, 'Priority', sp.priority, { type: 'number' });
        rulesRow.appendChild(prioCol);
        const togglesCol = document.createElement('div');
        togglesCol.style.cssText = 'flex: 1; display: flex; flex-direction: column; gap: 8px; padding-bottom: 4px;';
        rulesRow.appendChild(togglesCol);
        body.appendChild(rulesRow);

        const stackToggle    = buildToggleRow(togglesCol, 'Stacks with other specials', sp.stacking, (on) => { sp.stacking = on; });
        const pinToggle      = buildToggleRow(togglesCol, 'Requires manager PIN', sp.requires_pin, (on) => { sp.requires_pin = on; }, C.gold);

        body.appendChild(buildDivider());
        const activeToggle = buildToggleRow(body, 'Active', sp.active, (on) => { sp.active = on; });

        // Delete
        if (isEdit) {
            body.appendChild(buildDivider());
            const delBtn = buildPillButton('Delete special', 'danger', () => {
                if (!confirm(`Delete "${sp.name}"?`)) return;
                trackSpecialDelete(sp.id);
                closeModal(ov);
            });
            delBtn.style.width = '100%';
            body.appendChild(delBtn);
        }

        // Footer
        const footer = document.createElement('div');
        footer.style.cssText = `display: flex; gap: 10px; justify-content: flex-end; padding-top: 14px; border-top: 1px solid ${C2.hairline}; margin-top: 6px;`;
        footer.appendChild(buildPillButton('Cancel', 'tertiary', () => closeModal(ov), { small: true }));
        footer.appendChild(buildPillButton(isEdit ? 'Save' : 'Create', 'primary', () => {
            const name = nameField.input.value.trim();
            if (!name) { nameField.input.style.borderColor = C.verm; return; }
            const gathered = {
                ...sp,
                name,
                discount_type:  typeField.input.value,
                discount_value: parseFloat(valField.input.value) || 0,
                priority:       parseInt(prioField.input.value) || 1,
                stacking:       stackToggle.isOn(),
                requires_pin:   pinToggle.isOn(),
                active:         activeToggle.isOn(),
            };
            if (isEdit) trackSpecialEdit(gathered);
            else trackSpecialCreate(gathered);
            closeModal(ov);
        }, { small: true }));
        body.appendChild(footer);
    }, { accent: sp.schedule.mode === 'manual' ? C2.lavender : C.gold, wide: true });
}

/* ─── EMPLOYEE DISCOUNT MODAL ────────────────────────────────── */
function openEmployeeModal(existing) {
    const emp = clone(existing);

    openModal('Employee Discount Settings', (body, modalEl, ov) => {
        // Separate rates toggle
        const sepToggle = buildToggleRow(body, 'Separate on-duty / off-duty rates', emp.separate_rates, (on) => {
            emp.separate_rates = on;
            singleGroup.style.display = on ? 'none' : 'block';
            dualGroup.style.display   = on ? 'flex' : 'none';
        }, C.green);

        const singleGroup = document.createElement('div');
        singleGroup.style.display = emp.separate_rates ? 'none' : 'block';
        const pctField = buildTextField(singleGroup, 'Discount percentage', emp.percentage, { type: 'number', step: '1' });
        body.appendChild(singleGroup);

        const dualGroup = document.createElement('div');
        dualGroup.style.cssText = `display: ${emp.separate_rates ? 'flex' : 'none'}; gap: 12px;`;
        const onCol = document.createElement('div');
        onCol.style.cssText = 'flex: 1;';
        const onField = buildTextField(onCol, 'On-duty %', emp.on_duty_rate, { type: 'number', step: '1' });
        dualGroup.appendChild(onCol);
        const offCol = document.createElement('div');
        offCol.style.cssText = 'flex: 1;';
        const offField = buildTextField(offCol, 'Off-duty %', emp.off_duty_rate, { type: 'number', step: '1' });
        dualGroup.appendChild(offCol);
        body.appendChild(dualGroup);

        const appliesField = buildSelectField(body, 'Applies to', emp.applies_to, [
            { value: 'everything',  label: 'Everything' },
            { value: 'food_only',   label: 'Food only' },
            { value: 'drinks_only', label: 'Drinks only' },
        ]);

        // Exclude categories
        const excludeWrap = document.createElement('div');
        excludeWrap.style.cssText = 'display: flex; flex-direction: column; gap: 6px;';
        const excludeLbl = document.createElement('div');
        excludeLbl.textContent = 'Exclude categories';
        excludeLbl.style.cssText = `font-size: 12px; font-weight: 600; color: ${C.textMuted};`;
        excludeWrap.appendChild(excludeLbl);
        const excludeChips = document.createElement('div');
        excludeChips.style.cssText = 'display: flex; gap: 6px; flex-wrap: wrap;';
        const excludeSet = new Set(emp.exclude_categories || []);
        pricingData.categories.forEach(cat => {
            const chip = document.createElement('button');
            chip.type = 'button';
            chip.textContent = cat.name;
            const render = () => {
                const on = excludeSet.has(cat.id);
                chip.style.cssText = `
                    padding: 6px 12px;
                    background: ${on ? withAlpha(C.verm, 0.15) : C.well};
                    border: 1px solid ${on ? C.verm : withAlpha(C.text, 0.12)};
                    border-radius: 999px;
                    color: ${on ? C.verm : C.text};
                    font-size: 12px; font-weight: 500;
                    cursor: pointer;
                `;
            };
            render();
            chip.addEventListener('click', () => {
                if (excludeSet.has(cat.id)) excludeSet.delete(cat.id);
                else excludeSet.add(cat.id);
                render();
            });
            excludeChips.appendChild(chip);
        });
        excludeWrap.appendChild(excludeChips);
        body.appendChild(excludeWrap);

        body.appendChild(buildDivider());
        const pinToggle = buildToggleRow(body, 'Requires manager PIN', emp.requires_pin, (on) => { emp.requires_pin = on; }, C.gold);

        const footer = document.createElement('div');
        footer.style.cssText = `display: flex; gap: 10px; justify-content: flex-end; padding-top: 14px; border-top: 1px solid ${C2.hairline}; margin-top: 6px;`;
        footer.appendChild(buildPillButton('Cancel', 'tertiary', () => closeModal(ov), { small: true }));
        footer.appendChild(buildPillButton('Save', 'primary', () => {
            const gathered = {
                ...emp,
                separate_rates:     sepToggle.isOn(),
                percentage:         parseInt(pctField.input.value) || 20,
                on_duty_rate:       parseInt(onField.input.value) || 50,
                off_duty_rate:      parseInt(offField.input.value) || 20,
                applies_to:         appliesField.input.value,
                exclude_categories: Array.from(excludeSet),
                requires_pin:       pinToggle.isOn(),
                active:             true,
            };
            trackEmployeeEdit(gathered);
            closeModal(ov);
        }, { small: true }));
        body.appendChild(footer);
    }, { accent: C.green });
}

/* ─── COMP REASON MODAL ──────────────────────────────────────── */
function openCompReasonModal(existing) {
    const isEdit = !!existing;
    const r = existing ? clone(existing) : defaultCompReason();

    openModal(isEdit ? `Edit comp reason: ${r.name || ''}` : 'Add comp reason', (body, modalEl, ov) => {
        const nameField = buildTextField(body, 'Reason name', r.name, { required: true, placeholder: 'Kitchen Error, Customer Complaint…' });
        const pinToggle = buildToggleRow(body, 'Requires manager PIN', r.requires_pin, (on) => { r.requires_pin = on; }, C.gold);
        const maxField  = buildTextField(body, 'Max comp amount (blank = unlimited)', r.max_amount != null ? r.max_amount : '', { type: 'number', step: '0.01', placeholder: 'Leave blank for no limit' });

        if (isEdit) {
            body.appendChild(buildDivider());
            const delBtn = buildPillButton('Delete reason', 'danger', () => {
                if (!confirm(`Delete "${r.name}"?`)) return;
                trackCompReasonDelete(r.id);
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
            if (isEdit) trackCompReasonEdit(gathered);
            else trackCompReasonCreate(gathered);
            closeModal(ov);
        }, { small: true }));
        body.appendChild(footer);
    }, { accent: C.verm });
}

/* ─── EVENT GENERATION ───────────────────────────────────────── */
function generatePricingEvents() {
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

    pendingChanges.comp_reasons_new.forEach(r => {
        const id = r.id.replace(/^temp_/, '');
        events.push({ event_type: 'pricing.comp_reason_created', batch_id, timestamp: ts(),
            payload: { ...r, id } });
    });
    pendingChanges.comp_reasons_edited.forEach(r => {
        events.push({ event_type: 'pricing.comp_reason_updated', batch_id, timestamp: ts(), payload: r });
    });
    pendingChanges.comp_reasons_deleted.forEach(id => {
        events.push({ event_type: 'pricing.comp_reason_deleted', batch_id, timestamp: ts(), payload: { id } });
    });

    return events;
}

async function handleSaveChanges() {
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

    pendingChanges.comp_reasons_new.forEach(r => pricingData.comp_reasons.push(clone(r)));
    pendingChanges.comp_reasons_edited.forEach(r => {
        const idx = pricingData.comp_reasons.findIndex(x => x.id === r.id);
        if (idx !== -1) pricingData.comp_reasons[idx] = clone(r);
    });
    pendingChanges.comp_reasons_deleted.forEach(id => {
        pricingData.comp_reasons = pricingData.comp_reasons.filter(x => x.id !== id);
    });

    const n = events.length;
    pendingChanges = emptyChanges();
    renderScene();
    showToast(`${n} change${n === 1 ? '' : 's'} saved`);
}

/* ─── ANIMATION ──────────────────────────────────────────────── */
function injectAnimations() {
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