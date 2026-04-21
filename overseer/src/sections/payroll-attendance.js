/* ============================================
   KINDpos Overseer — Payroll & Attendance (Nostalgia)

   Merges the four legacy Staff subsections into one tabbed scene:
     - Clock Records    (was time-attendance)
     - Payroll Periods  (was payroll-tips)
     - Tipout Rules     (was tipout-rules)
     - Shift Templates  (was the templates view in shift-config)

   Design target: the Payroll & Attendance mockup. Reads from
   ui/tokens.js + ui/forms.js only — no local palette, no Vz1.x
   CSS vars.

   Tabs keep their individual save semantics:
     - Clock Records  : live data, no save
     - Payroll Periods: export action inside tab
     - Tipout Rules   : per-row edit/delete, inline modal
     - Shift Templates: + New Template inline modal

   "Nice. Dependable. Yours."
   ============================================ */

import { T, withAlpha } from '../ui/tokens.js';
import {
    buildScenePage, sectionCard, button, field,
    numberField, chipGroup, openModal, showToast,
} from '../ui/forms.js';
import { pushChanges } from '../services/config-push.js';
import { ROLES as FALLBACK_ROLES, loadEmployeeData, getRoleLabel } from '../data/sample-employees.js';
import {
    ACTIVE_SHIFTS, WEEKLY_TIMECARDS, SHIFT_DETAILS, EDIT_REASONS,
    DAY_LABELS, getDayIndex, calcDuration, durationColor, getWeeklyTotals,
} from '../data/sample-timedata.js';

/* ------------------------------------------
   MODULE STATE
------------------------------------------ */
let _container = null;
let _activeTabId = 'clock';
let _tabBodies = {};  // tabId -> body element

// Tipout tab state (hydrated on first open, refreshed on each
// subsequent open so external changes land without a hard reload).
let _tipoutRules = [];
let _tipoutRoles = [];
let _tipoutCategories = [];

const TIPOUT_BASIS_OPTIONS = ['Net Sales', 'Gross Tips', 'Net Tips'];

// Clock Records tab state.
let _clockSubView = 'live';   // 'live' | 'week'
let _clockRefreshTimer = null;

// Role identity colors — matches the mockup's .role-chip styling.
// Source of truth for role colors is now staff-roles (Phase B),
// but ACTIVE_SHIFTS sample data only carries role ids, so this
// local map keeps rendering honest for the built-in roles.
const ROLE_CHIP_COLORS = {
    server:    '#38bdf8', // sky
    bartender: '#34d399', // emerald
    cook:      '#f472b6', // pink
    manager:   '#f97316', // orange
    host:      '#facc15', // amber
    busser:    '#a78bfa', // violet
};
function roleChipColor(roleId) {
    return ROLE_CHIP_COLORS[roleId] || T.textMuted;
}

const TABS = [
    { id: 'clock',      label: 'Clock Records'    },
    { id: 'payroll',    label: 'Payroll Periods'  },
    { id: 'tipout',     label: 'Tipout Rules'     },
    { id: 'templates',  label: 'Shift Templates'  },
];

/* ------------------------------------------
   TAB STRIP
   Underline style per the mockup's .tabs / .tab markup:
   mono-caps labels, 2px underline on the active tab, no
   background fill. Returns the strip element plus a
   setActive(id) hook so tab content re-renders on click.
------------------------------------------ */
function buildTabStrip({ tabs, activeId, onSelect }) {
    const strip = document.createElement('div');
    strip.style.cssText = `
        display: flex;
        gap: ${T.sp.xs + 2}px;
        flex-wrap: wrap;
        border-bottom: 1px solid ${T.well};
        margin-bottom: ${T.sp.xxl - 2}px;
    `;

    const buttons = {};

    tabs.forEach(tab => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.textContent = tab.label;
        btn.style.cssText = `
            background: transparent;
            border: none;
            border-bottom: 2px solid transparent;
            margin-bottom: -1px;
            padding: 10px 18px 12px;
            font-family: ${T.font.mono};
            font-size: ${T.fs.md}px;
            font-weight: 700;
            letter-spacing: 1.5px;
            text-transform: uppercase;
            color: ${T.textMuted};
            cursor: pointer;
            transition: color 0.15s ease, border-color 0.15s ease;
        `;
        btn.addEventListener('mouseenter', () => {
            if (!btn.dataset.active) btn.style.color = T.text;
        });
        btn.addEventListener('mouseleave', () => {
            if (!btn.dataset.active) btn.style.color = T.textMuted;
        });
        btn.addEventListener('click', () => onSelect(tab.id));
        buttons[tab.id] = btn;
        strip.appendChild(btn);
    });

    function applyActive(id) {
        Object.entries(buttons).forEach(([tabId, b]) => {
            const on = tabId === id;
            b.style.color = on ? T.green : T.textMuted;
            b.style.borderBottomColor = on ? T.green : 'transparent';
            if (on) b.dataset.active = '1';
            else delete b.dataset.active;
        });
    }
    applyActive(activeId);

    return { el: strip, setActive: applyActive };
}

/* ------------------------------------------
   TAB PLACEHOLDERS (real renders come in steps 10–13)
------------------------------------------ */
function renderPlaceholder(body, label) {
    body.innerHTML = '';
    const card = sectionCard({
        label,
        accent: T.textDim,
        note: 'Coming online in a later port step.',
    });
    const stub = document.createElement('div');
    stub.style.cssText = `
        color: ${T.textDim};
        font-family: ${T.font.mono};
        font-size: ${T.fs.md}px;
        padding: ${T.sp.xl}px 0;
        text-align: center;
        letter-spacing: 2px;
        text-transform: uppercase;
    `;
    stub.textContent = 'Stub';
    card.body.appendChild(stub);
    body.appendChild(card.card);
}

function renderPayrollTab(body)   { renderPlaceholder(body, 'Payroll Periods'); }
function renderTemplatesTab(body) { renderPlaceholder(body, 'Shift Templates'); }

/* ==========================================
   TAB: TIPOUT RULES
   Ported from sections/tipout-rules.js. Same /api/v1/config/tipout
   read path, same tipout.rule_created / rule_updated / rule_deleted
   event types. Falls back to the shared ROLES list when the roles
   API returns empty (matches the legacy behavior).
   ========================================== */

const TIPOUT_GRID = '1.1fr 1.1fr 0.6fr 1fr 1.6fr 120px';

async function loadTipoutData() {
    const [rulesRes, rolesRes, catsRes] = await Promise.all([
        fetch('/api/v1/config/tipout').catch(() => null),
        fetch('/api/v1/config/roles').catch(() => null),
        fetch('/api/v1/config/menu/categories').catch(() => null),
    ]);
    _tipoutRules = rulesRes && rulesRes.ok ? await rulesRes.json() : [];
    const apiRoles = rolesRes && rolesRes.ok ? await rolesRes.json() : [];
    if (Array.isArray(apiRoles) && apiRoles.length > 0) {
        _tipoutRoles = apiRoles;
    } else {
        // Same fallback as the legacy scene: use the shared ROLES list
        // so the form always has selectable options on a fresh install.
        await loadEmployeeData().catch(() => {});
        _tipoutRoles = (FALLBACK_ROLES || []).map(r => ({ role_id: r.id, name: r.label }));
    }
    _tipoutCategories = catsRes && catsRes.ok ? await catsRes.json() : [];
}

function roleLabelById(id) {
    const match = _tipoutRoles.find(r => r.role_id === id);
    return (match && (match.name || match.role_id)) || id || '—';
}

async function renderTipoutTab(body) {
    body.innerHTML = '';

    // Loading state
    const loading = document.createElement('div');
    loading.style.cssText = `
        color: ${T.textMuted};
        font-family: ${T.font.mono};
        font-size: ${T.fs.md}px;
        padding: ${T.sp.xxl}px 0;
        text-align: center;
        letter-spacing: 1.5px;
        text-transform: uppercase;
    `;
    loading.textContent = 'Loading tipout rules...';
    body.appendChild(loading);

    try {
        await loadTipoutData();
    } catch (e) {
        console.warn('[Payroll & Attendance] tipout load failed:', e);
    }

    body.innerHTML = '';
    const card = sectionCard({
        label: 'Tipout Rules',
        accent: T.green,
        note: "Route a percentage of a role's basis (Net Sales, Gross Tips, or Net Tips) to another role. Net Sales rules may be scoped to specific menu categories.",
    });

    // Toolbar: rule count + add button
    const toolbar = document.createElement('div');
    toolbar.style.cssText = `
        display: flex; justify-content: space-between; align-items: center;
        margin-bottom: ${T.sp.md}px;
    `;
    const hint = document.createElement('div');
    hint.style.cssText = `
        font-family: ${T.font.mono};
        font-size: ${T.fs.sm}px;
        letter-spacing: 1.5px;
        color: ${T.textDim};
        text-transform: uppercase;
    `;
    const n = _tipoutRules.length;
    hint.textContent = `${n} active rule${n === 1 ? '' : 's'}`;
    toolbar.appendChild(hint);
    toolbar.appendChild(button({
        label: '+ Add Rule',
        variant: 'primary',
        onClick: () => openTipoutRuleModal(null, body),
    }));
    card.body.appendChild(toolbar);

    // Table
    card.body.appendChild(buildTipoutTable(body));
    body.appendChild(card.card);
}

function buildTipoutTable(tabBody) {
    const table = document.createElement('div');
    table.style.cssText = `
        background: ${T.well};
        border-radius: ${T.r.sm}px;
        overflow: hidden;
    `;

    // Header row
    const th = document.createElement('div');
    th.style.cssText = `
        display: grid;
        grid-template-columns: ${TIPOUT_GRID};
        gap: ${T.sp.md}px;
        padding: ${T.sp.md}px ${T.sp.lg}px;
        background: ${withAlpha(T.green, 0.06)};
        font-family: ${T.font.mono};
        font-size: ${T.fs.sm}px;
        font-weight: 700;
        letter-spacing: 1.5px;
        text-transform: uppercase;
        color: ${T.textMuted};
    `;
    ['From', 'To', '%', 'Basis', 'Categories'].forEach(label => {
        const cell = document.createElement('div');
        cell.textContent = label;
        th.appendChild(cell);
    });
    const actionsHead = document.createElement('div');
    actionsHead.style.cssText = 'text-align: right;';
    actionsHead.textContent = 'Actions';
    th.appendChild(actionsHead);
    table.appendChild(th);

    if (_tipoutRules.length === 0) {
        const empty = document.createElement('div');
        empty.style.cssText = `
            padding: ${T.sp.xxxl}px;
            text-align: center;
            color: ${T.textMuted};
            font-size: ${T.fs.base}px;
        `;
        empty.textContent = 'No tipout rules yet. Click "+ Add Rule" to create one.';
        table.appendChild(empty);
        return table;
    }

    _tipoutRules.forEach(rule => {
        const tr = document.createElement('div');
        tr.style.cssText = `
            display: grid;
            grid-template-columns: ${TIPOUT_GRID};
            gap: ${T.sp.md}px;
            padding: ${T.sp.md + 2}px ${T.sp.lg}px;
            border-top: 1px solid ${T.border};
            align-items: center;
            font-size: ${T.fs.base}px;
            color: ${T.text};
        `;

        const from = document.createElement('div');
        from.textContent = roleLabelById(rule.role_from);
        tr.appendChild(from);

        const to = document.createElement('div');
        to.textContent = roleLabelById(rule.role_to);
        to.style.color = T.gold;
        to.style.fontWeight = '500';
        tr.appendChild(to);

        const pct = document.createElement('div');
        pct.style.cssText = `
            font-family: ${T.font.mono};
            font-size: ${T.fs.lg}px;
            font-weight: 700;
        `;
        pct.textContent = (rule.percentage || 0) + '%';
        tr.appendChild(pct);

        const basis = document.createElement('div');
        basis.style.cssText = `
            color: ${T.green};
            font-family: ${T.font.mono};
            font-size: ${T.fs.md}px;
            letter-spacing: 1px;
        `;
        basis.textContent = rule.calculation_base || 'Net Sales';
        tr.appendChild(basis);

        const cats = document.createElement('div');
        const catList = Array.isArray(rule.categories) ? rule.categories : [];
        if (catList.length === 0) {
            cats.textContent = 'All categories';
            cats.style.cssText = `color: ${T.textDim}; font-style: italic; font-size: ${T.fs.md}px;`;
        } else {
            cats.textContent = catList.join(', ');
            cats.style.cssText = `color: ${T.textMuted}; font-size: ${T.fs.md}px;`;
        }
        tr.appendChild(cats);

        const actions = document.createElement('div');
        actions.style.cssText = `display: flex; gap: ${T.sp.sm}px; justify-content: flex-end;`;
        actions.appendChild(button({
            label: 'Edit',
            variant: 'ghost',
            onClick: () => openTipoutRuleModal(rule, tabBody),
        }));
        actions.appendChild(button({
            label: 'Delete',
            variant: 'danger',
            onClick: () => confirmDeleteTipoutRule(rule, tabBody),
        }));
        tr.appendChild(actions);

        table.appendChild(tr);
    });

    return table;
}

function _newRuleId() {
    return 'rule_' + Math.random().toString(36).slice(2, 10);
}

function openTipoutRuleModal(rule, tabBody) {
    const isEdit = !!rule;
    const draft = {
        role_from: rule ? rule.role_from : '',
        role_to:   rule ? rule.role_to   : '',
        percentage: rule ? rule.percentage : 0,
        calculation_base: rule ? (rule.calculation_base || 'Net Sales') : 'Net Sales',
        categories: rule && Array.isArray(rule.categories) ? rule.categories.slice() : [],
    };

    const content = document.createElement('div');
    content.style.cssText = 'display: flex; flex-direction: column; gap: 16px;';

    const roleOptions = _tipoutRoles.map(r => ({ id: r.role_id, label: r.name || r.role_id }));

    const fromGroup = _labeledGroup('From role (who pays)', chipGroup({
        options: roleOptions,
        selected: draft.role_from ? [draft.role_from] : [],
        mode: 'single',
        onChange: (sel) => { draft.role_from = sel[0] || ''; },
    }));
    content.appendChild(fromGroup);

    const toGroup = _labeledGroup('To role (who receives)', chipGroup({
        options: roleOptions,
        selected: draft.role_to ? [draft.role_to] : [],
        mode: 'single',
        onChange: (sel) => { draft.role_to = sel[0] || ''; },
    }));
    content.appendChild(toGroup);

    const pctF = numberField({
        label: 'Percentage',
        value: draft.percentage,
        min: 0,
        step: 0.1,
        suffix: '%',
    });
    pctF.input.addEventListener('input', () => {
        draft.percentage = parseFloat(pctF.input.value) || 0;
    });
    content.appendChild(pctF.wrap);

    const basisGroup = _labeledGroup('Calculation basis', chipGroup({
        options: TIPOUT_BASIS_OPTIONS.map(o => ({ id: o, label: o })),
        selected: [draft.calculation_base],
        mode: 'single',
        onChange: (sel) => {
            draft.calculation_base = sel[0] || 'Net Sales';
            catSection.style.display = draft.calculation_base === 'Net Sales' ? 'flex' : 'none';
        },
    }));
    content.appendChild(basisGroup);

    // Category multi-select (only meaningful for Net Sales)
    const catSection = document.createElement('div');
    catSection.style.cssText = `
        display: ${draft.calculation_base === 'Net Sales' ? 'flex' : 'none'};
        flex-direction: column; gap: 6px;
    `;
    const catLabel = document.createElement('div');
    catLabel.style.cssText = `
        font-family: ${T.font.body};
        font-size: ${T.fs.base}px;
        color: ${T.textMuted};
        font-weight: 600;
        letter-spacing: 0.3px;
    `;
    catLabel.textContent = 'Categories (leave empty for all net sales)';
    catSection.appendChild(catLabel);

    const catHint = document.createElement('div');
    catHint.style.cssText = `
        font-size: ${T.fs.md}px;
        color: ${T.textDim};
        line-height: 1.5;
    `;
    catHint.textContent = 'When at least one category is selected, the basis narrows to the server’s net sales in those categories only.';
    catSection.appendChild(catHint);

    if (_tipoutCategories.length === 0) {
        const noCats = document.createElement('div');
        noCats.style.cssText = `
            color: ${T.textDim};
            font-size: ${T.fs.base}px;
            padding: ${T.sp.md}px ${T.sp.lg}px;
            border: 1px solid ${T.border};
            border-radius: ${T.r.sm}px;
            background: ${T.well};
        `;
        noCats.textContent = 'No categories configured yet.';
        catSection.appendChild(noCats);
    } else {
        const catGroup = chipGroup({
            options: _tipoutCategories.map(c => {
                const name = c.name || c.category_id;
                return { id: name, label: name };
            }),
            selected: draft.categories,
            mode: 'multi',
            onChange: (sel) => { draft.categories = sel.slice(); },
        });
        catSection.appendChild(catGroup.wrap);
    }
    content.appendChild(catSection);

    let modalRef = null;
    const cancelBtn = button({
        label: 'Cancel',
        variant: 'ghost',
        onClick: () => modalRef.close(),
    });
    const saveBtn = button({
        label: isEdit ? 'Save Changes' : 'Create Rule',
        variant: 'primary',
        onClick: async () => {
            if (!draft.role_from || !draft.role_to) {
                showToast('Pick a From and To role.', 'error');
                return;
            }
            if (!isFinite(draft.percentage) || draft.percentage <= 0) {
                showToast('Percentage must be greater than 0.', 'error');
                return;
            }
            const payload = {
                rule_id: isEdit ? rule.rule_id : _newRuleId(),
                role_from: draft.role_from,
                role_to: draft.role_to,
                percentage: draft.percentage,
                calculation_base: draft.calculation_base,
                categories: draft.calculation_base === 'Net Sales' ? draft.categories.slice() : [],
            };
            try {
                await pushChanges([{
                    event_type: isEdit ? 'tipout.rule_updated' : 'tipout.rule_created',
                    payload,
                }]);
                showToast(isEdit ? 'Rule updated' : 'Rule created', 'success');
                modalRef.close();
                renderTipoutTab(tabBody);
            } catch (e) {
                console.warn('[Tipout Rules] save failed:', e);
                showToast('Save failed — see console', 'error');
            }
        },
    });

    modalRef = openModal({
        title: isEdit ? 'Edit Tipout Rule' : 'New Tipout Rule',
        content,
        footer: [cancelBtn, saveBtn],
        width: 640,
    });
}

function confirmDeleteTipoutRule(rule, tabBody) {
    const content = document.createElement('div');
    content.style.cssText = `font-size: ${T.fs.lg}px; color: ${T.text}; line-height: 1.6;`;
    content.innerHTML = `
        Delete this tipout rule?<br/><br/>
        <span style="font-family: ${T.font.mono}; color: ${T.textMuted}; font-size: ${T.fs.base}px;">
            ${roleLabelById(rule.role_from)} → ${roleLabelById(rule.role_to)} · ${rule.percentage}% · ${rule.calculation_base || 'Net Sales'}
        </span>
    `;

    let modalRef = null;
    const cancelBtn = button({
        label: 'Cancel',
        variant: 'ghost',
        onClick: () => modalRef.close(),
    });
    const deleteBtn = button({
        label: 'Delete Rule',
        variant: 'danger',
        onClick: async () => {
            try {
                await pushChanges([{
                    event_type: 'tipout.rule_deleted',
                    payload: { rule_id: rule.rule_id },
                }]);
                showToast('Rule deleted', 'success');
                modalRef.close();
                renderTipoutTab(tabBody);
            } catch (e) {
                console.warn('[Tipout Rules] delete failed:', e);
                showToast('Delete failed — see console', 'error');
            }
        },
    });

    modalRef = openModal({
        title: 'Delete Tipout Rule',
        content,
        footer: [cancelBtn, deleteBtn],
        width: 420,
    });
}

/* ------------------------------------------
   Small helper: wrap a chipGroup with a label caption.
------------------------------------------ */
function _labeledGroup(label, group) {
    const wrap = document.createElement('div');
    wrap.style.cssText = 'display: flex; flex-direction: column; gap: 6px;';
    const lbl = document.createElement('div');
    lbl.style.cssText = `
        font-family: ${T.font.body};
        font-size: ${T.fs.base}px;
        color: ${T.textMuted};
        font-weight: 600;
        letter-spacing: 0.3px;
    `;
    lbl.textContent = label;
    wrap.appendChild(lbl);
    wrap.appendChild(group.wrap);
    return wrap;
}

/* ==========================================
   TAB: CLOCK RECORDS
   Ported from sections/time-attendance.js. Split into two
   sub-views via a pill toggle (mockup's .sub-toggle):
     - Live Dashboard — who's on the clock right now
     - Week Grid      — weekly timecards for the whole team
   Shift drill-down + SHIFT_TIME_ADJUSTED edit land in chunks 3–4.
   ========================================== */

function fmtTime12(time24) {
    if (!time24) return '—';
    const [h, m] = time24.split(':').map(Number);
    const ampm = h >= 12 ? 'PM' : 'AM';
    const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
    return `${h12}:${String(m).padStart(2, '0')} ${ampm}`;
}
function fmtTimeISO(isoStr) {
    if (!isoStr) return '—';
    const d = new Date(isoStr);
    return fmtTime12(`${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`);
}
function fmtHrs(val) { return (val ?? 0).toFixed(2) + 'h'; }
function fmtMoney(val) { return '$' + (val ?? 0).toFixed(2); }

// Sub-toggle pill group (mockup .sub-toggle).
function buildClockSubToggle(activeSub, onSelect) {
    const toggle = document.createElement('div');
    toggle.style.cssText = `
        display: flex; gap: ${T.sp.xs}px;
        padding: ${T.sp.xs}px;
        background: ${T.well};
        border-radius: 999px;
        width: fit-content;
        margin-bottom: ${T.sp.md + 2}px;
    `;
    [
        { id: 'live', label: 'Live Dashboard' },
        { id: 'week', label: 'Week Grid'      },
    ].forEach(opt => {
        const on = opt.id === activeSub;
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.textContent = opt.label;
        btn.style.cssText = `
            background: ${on ? T.card : 'transparent'};
            border: none; cursor: pointer;
            padding: 6px 16px;
            border-radius: 999px;
            font-family: ${T.font.mono};
            font-size: ${T.fs.sm}px;
            letter-spacing: 1.5px;
            font-weight: 700;
            color: ${on ? T.green : T.textMuted};
            text-transform: uppercase;
        `;
        btn.addEventListener('click', () => { if (opt.id !== activeSub) onSelect(opt.id); });
        toggle.appendChild(btn);
    });
    return toggle;
}

function startClockRefresh(rerender) {
    stopClockRefresh();
    _clockRefreshTimer = setInterval(() => {
        if (typeof rerender === 'function') rerender();
    }, 30_000);
}
function stopClockRefresh() {
    if (_clockRefreshTimer) {
        clearInterval(_clockRefreshTimer);
        _clockRefreshTimer = null;
    }
}

function renderClockTab(body) {
    stopClockRefresh();
    body.innerHTML = '';

    const toggle = buildClockSubToggle(_clockSubView, (sub) => {
        _clockSubView = sub;
        renderClockTab(body);
    });
    body.appendChild(toggle);

    const viewWrap = document.createElement('div');
    body.appendChild(viewWrap);

    if (_clockSubView === 'live') {
        renderLiveDashboard(viewWrap);
    } else {
        renderWeekGrid(viewWrap);
    }
}

/* ------------------------------------------
   LIVE DASHBOARD — "Currently Clocked In"
   Matches the mockup's 5-col table (Employee / Role / Clocked In
   / Duration / Actions). Duration text is colored by durationColor
   (green under 8h, warning 8–10h, verm 10h+). ON-BREAK chip and
   OT-WATCH chip surface on the name cell. Break-compliance alert
   below the card flags anyone past their 5-hour mark without a
   meal break (California rule). Re-renders every 30 s so durations
   stay current.
------------------------------------------ */
const LIVE_GRID = '1.6fr 0.8fr 0.8fr 0.8fr 120px';

function renderLiveDashboard(wrap) {
    wrap.innerHTML = '';

    const card = sectionCard({
        label: 'Currently Clocked In',
        accent: T.green,
        note: 'Real-time staff on the floor. Duration colors flag shifts approaching overtime.',
    });

    // Toolbar: active count + refresh hint
    const toolbar = document.createElement('div');
    toolbar.style.cssText = `
        display: flex; justify-content: space-between; align-items: center;
        margin-bottom: ${T.sp.md}px;
    `;
    const hint = document.createElement('div');
    hint.style.cssText = `
        font-family: ${T.font.mono};
        font-size: ${T.fs.sm}px;
        letter-spacing: 1.5px;
        color: ${T.textDim};
        text-transform: uppercase;
    `;
    const activeCount = ACTIVE_SHIFTS.length;
    hint.textContent = `${activeCount} on clock · auto-refreshes every 30s`;
    toolbar.appendChild(hint);
    card.body.appendChild(toolbar);

    // Table
    const table = document.createElement('div');
    table.style.cssText = `
        background: ${T.well};
        border-radius: ${T.r.sm}px;
        overflow: hidden;
    `;

    const th = document.createElement('div');
    th.style.cssText = `
        display: grid;
        grid-template-columns: ${LIVE_GRID};
        gap: ${T.sp.md}px;
        padding: ${T.sp.md}px ${T.sp.lg}px;
        background: ${withAlpha(T.green, 0.06)};
        font-family: ${T.font.mono};
        font-size: ${T.fs.sm}px;
        font-weight: 700;
        letter-spacing: 1.5px;
        text-transform: uppercase;
        color: ${T.textMuted};
    `;
    ['Employee', 'Role', 'Clocked In', 'Duration'].forEach(label => {
        const cell = document.createElement('div');
        cell.textContent = label;
        th.appendChild(cell);
    });
    const actionsHead = document.createElement('div');
    actionsHead.style.cssText = 'text-align: right;';
    actionsHead.textContent = 'Actions';
    th.appendChild(actionsHead);
    table.appendChild(th);

    if (ACTIVE_SHIFTS.length === 0) {
        const empty = document.createElement('div');
        empty.style.cssText = `
            padding: ${T.sp.xxxl}px;
            text-align: center;
            color: ${T.textMuted};
            font-size: ${T.fs.base}px;
        `;
        empty.textContent = 'Nobody on the clock right now.';
        table.appendChild(empty);
    } else {
        ACTIVE_SHIFTS.forEach(shift => {
            const dur = calcDuration(shift.clockIn);
            const durColor = durationColor(dur.totalHrs);

            const tr = document.createElement('div');
            tr.style.cssText = `
                display: grid;
                grid-template-columns: ${LIVE_GRID};
                gap: ${T.sp.md}px;
                padding: ${T.sp.md + 2}px ${T.sp.lg}px;
                border-top: 1px solid ${T.border};
                align-items: center;
            `;

            // Employee cell: live-dot + name + optional badges
            const empCell = document.createElement('div');
            empCell.style.cssText = `color: ${T.text}; font-size: ${T.fs.lg}px;`;
            const dot = document.createElement('span');
            const dotColor = dur.totalHrs >= 8 ? T.warning : T.greenUp;
            dot.style.cssText = `
                display: inline-block;
                width: 8px; height: 8px;
                border-radius: 50%;
                background: ${dotColor};
                box-shadow: 0 0 8px ${dotColor};
                margin-right: ${T.sp.sm}px;
                vertical-align: middle;
            `;
            empCell.appendChild(dot);
            empCell.appendChild(document.createTextNode(shift.name));
            if (shift.onBreak) {
                empCell.appendChild(_inlineBadge('ON BREAK', T.warning));
            }
            if (dur.totalHrs >= 8) {
                empCell.appendChild(_inlineBadge('OT WATCH', T.verm));
            }
            tr.appendChild(empCell);

            // Role chip
            const roleCell = document.createElement('div');
            roleCell.appendChild(_roleChip(shift.role));
            tr.appendChild(roleCell);

            // Clocked in time
            const inCell = document.createElement('div');
            inCell.style.cssText = `
                color: ${T.textMuted};
                font-family: ${T.font.mono};
                font-size: ${T.fs.md}px;
            `;
            inCell.textContent = fmtTimeISO(shift.clockIn);
            tr.appendChild(inCell);

            // Duration (colored)
            const durCell = document.createElement('div');
            durCell.style.cssText = `
                color: ${durColor};
                font-family: ${T.font.mono};
                font-size: ${T.fs.lg}px;
                font-weight: 700;
            `;
            durCell.textContent = dur.text;
            tr.appendChild(durCell);

            // Actions (Edit opens the shift-detail modal — filled in chunk 4)
            const actions = document.createElement('div');
            actions.style.cssText = `display: flex; gap: ${T.sp.sm}px; justify-content: flex-end;`;
            actions.appendChild(button({
                label: 'Edit',
                variant: 'ghost',
                onClick: () => openShiftDetailModal(shift),
            }));
            tr.appendChild(actions);

            table.appendChild(tr);
        });
    }
    card.body.appendChild(table);
    wrap.appendChild(card.card);

    // Break-compliance alert: anyone past 5h without a meal break.
    const fiveHourAlerts = ACTIVE_SHIFTS.filter(s => {
        const d = calcDuration(s.clockIn);
        return d.totalHrs >= 5 && s.breaksTaken.length === 0 && !s.onBreak;
    });
    if (fiveHourAlerts.length > 0) {
        const alert = document.createElement('div');
        alert.style.cssText = `
            margin-top: ${T.sp.md}px;
            padding: ${T.sp.md + 2}px ${T.sp.lg}px;
            background: ${withAlpha(T.warning, 0.08)};
            border: 1px solid ${withAlpha(T.warning, 0.3)};
            border-radius: ${T.r.md}px;
            color: ${T.warning};
            font-size: ${T.fs.base}px;
            line-height: 1.5;
        `;
        const names = fiveHourAlerts.map(s => s.firstName).join(', ');
        alert.innerHTML = `
            <div style="font-weight: 700; margin-bottom: 4px;
                        font-family: ${T.font.mono};
                        font-size: ${T.fs.sm}px; letter-spacing: 1.5px;
                        text-transform: uppercase;">
                ⚠ Break Compliance Alert
            </div>
            <div>${names} — over 5 hours without a meal break. California law requires a 30-minute meal break before the 5th hour.</div>
        `;
        wrap.appendChild(alert);
    }

    // Keep durations fresh.
    startClockRefresh(() => renderLiveDashboard(wrap));
}

function _inlineBadge(text, color) {
    const b = document.createElement('span');
    b.textContent = text;
    b.style.cssText = `
        display: inline-block;
        margin-left: ${T.sp.sm}px;
        padding: 2px 8px;
        border-radius: ${T.r.sm}px;
        background: ${withAlpha(color, 0.15)};
        color: ${color};
        font-family: ${T.font.mono};
        font-size: ${T.fs.xs}px;
        letter-spacing: 1px;
        font-weight: 700;
        vertical-align: middle;
    `;
    return b;
}

function _roleChip(roleId) {
    const color = roleChipColor(roleId);
    const chip = document.createElement('span');
    chip.textContent = getRoleLabel([roleId]) || roleId;
    chip.style.cssText = `
        display: inline-block;
        padding: 2px 10px;
        border-radius: 999px;
        background: ${withAlpha(color, 0.15)};
        color: ${color};
        font-family: ${T.font.mono};
        font-size: ${T.fs.sm}px;
        letter-spacing: 1px;
        font-weight: 700;
        text-transform: uppercase;
    `;
    return chip;
}

// Stub — real implementation in chunk 4.
function openShiftDetailModal(shift) {
    showToast(`Shift detail for ${shift.name} — coming in chunk 4`, 'warn');
}
function renderWeekGrid(wrap) {
    wrap.textContent = ''; // filled in chunk 3
}

const TAB_RENDERERS = {
    clock:     renderClockTab,
    payroll:   renderPayrollTab,
    tipout:    renderTipoutTab,
    templates: renderTemplatesTab,
};

/* ------------------------------------------
   TAB SWITCHING
   Only the active tab's body is mounted — inactive tab-content
   wrappers stay empty. Keeps time-attendance timers etc. from
   running in the background when the user is on another tab.
------------------------------------------ */
function activateTab(tabId, stripRef) {
    // Tab-leave hooks: stop any timers that shouldn't keep running
    // in the background when the user is on a different tab.
    if (_activeTabId === 'clock' && tabId !== 'clock') stopClockRefresh();

    _activeTabId = tabId;
    Object.entries(_tabBodies).forEach(([id, el]) => {
        el.style.display = (id === tabId) ? 'block' : 'none';
    });
    const render = TAB_RENDERERS[tabId];
    if (render && _tabBodies[tabId]) render(_tabBodies[tabId]);
    stripRef.setActive(tabId);
}

/* ==========================================
   SCENE ENTRY / EXIT
   ========================================== */
export function buildPayrollAttendanceScene(container) {
    _container = container;
    _activeTabId = 'clock';
    _tabBodies = {};

    const { body: wrapper } = buildScenePage(container, {
        title: 'Payroll & Attendance',
        subtitle: 'Staff administration',
    });

    // Tab strip — ref captured so activateTab can re-paint the underline.
    const stripRef = buildTabStrip({
        tabs: TABS,
        activeId: _activeTabId,
        onSelect: (id) => activateTab(id, stripRef),
    });
    wrapper.appendChild(stripRef.el);

    // One body per tab. Only the active body is visible.
    TABS.forEach(tab => {
        const tabBody = document.createElement('div');
        tabBody.dataset.tab = tab.id;
        tabBody.style.display = (tab.id === _activeTabId) ? 'block' : 'none';
        _tabBodies[tab.id] = tabBody;
        wrapper.appendChild(tabBody);
    });

    // Initial render of the default tab.
    const initialRender = TAB_RENDERERS[_activeTabId];
    if (initialRender) initialRender(_tabBodies[_activeTabId]);
}

export function cleanupPayrollAttendance(container) {
    stopClockRefresh();
    if (container) container.innerHTML = '';
    _container = null;
    _activeTabId = 'clock';
    _tabBodies = {};
    _clockSubView = 'live';
}
