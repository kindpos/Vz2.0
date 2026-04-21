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
import {
    PAYROLL_SUMMARY, LABOR_BENCHMARKS, loadPayrollData,
} from '../data/sample-payroll.js';
import { buildDateRangePicker } from '../components/date-picker.js';

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

function renderTemplatesTab(body) { renderPlaceholder(body, 'Shift Templates'); }

/* ==========================================
   TAB: PAYROLL PERIODS
   Ported from sections/payroll-tips.js. The legacy labor-cost
   hero panel is replaced by the mockup's 4-KPI row (Total Hours
   / Overtime / Total Labor / Labor %). Employee breakdown table
   keeps the same data contract. Export is two direct buttons
   per the mockup (CSV + ADP) instead of the legacy format-picker
   modal — emits PAYROLL_EXPORTED with the same payload shape.
   ========================================== */

const PAYROLL_GRID = '1.6fr 0.8fr 0.8fr 0.8fr 0.8fr 0.8fr';

function fmtMoneyComma(val) {
    const v = Number(val ?? 0);
    return '$' + v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtDateRange(start, end) {
    if (!start || !end) return '—';
    const s = new Date(start + 'T12:00:00');
    const e = new Date(end + 'T12:00:00');
    const opts = { month: 'short', day: 'numeric' };
    return `${s.toLocaleDateString('en-US', opts)} – ${e.toLocaleDateString('en-US', opts)}, ${e.getFullYear()}`;
}

// Color the Labor % KPI by where the value lands relative to
// LABOR_BENCHMARKS. Same buckets the legacy scene used.
function laborAccent(pct) {
    const v = pct ?? 0;
    if (v <= LABOR_BENCHMARKS.targetLaborPct)   return T.green;
    if (v <= LABOR_BENCHMARKS.warningLaborPct)  return T.gold;
    if (v <= LABOR_BENCHMARKS.criticalLaborPct) return T.warning;
    return T.verm;
}
function laborSubText(pct) {
    const v = pct ?? 0;
    const t = LABOR_BENCHMARKS.targetLaborPct;
    const w = LABOR_BENCHMARKS.warningLaborPct;
    const c = LABOR_BENCHMARKS.criticalLaborPct;
    if (v <= t) return `On target · ≤${t}%`;
    if (v <= w) return `Above ${t}% target`;
    if (v <= c) return `Above ${w}% warning`;
    return `Above ${c}% critical`;
}

// Generic KPI card per mockup .kpi style. Used here and (via
// the _weekStat thin wrapper) in the Week Grid summary strip.
function buildKpiCard({ label, value, sub = null, accent = T.gold }) {
    const card = document.createElement('div');
    card.style.cssText = `
        background: ${T.card};
        border-left: 4px solid ${accent};
        border-radius: ${T.r.md}px;
        padding: ${T.sp.lg}px ${T.sp.lg + 2}px;
    `;
    card.innerHTML = `
        <div style="
            font-family: ${T.font.mono};
            font-size: ${T.fs.xs}px;
            letter-spacing: 2px;
            font-weight: 700;
            color: ${T.textMuted};
            text-transform: uppercase;
            margin-bottom: ${T.sp.sm}px;
        ">${label}</div>
        <div style="
            font-family: ${T.font.heading};
            font-size: ${T.fs.xxl}px;
            font-weight: 700;
            color: ${accent};
            line-height: 1;
        ">${value}</div>
        ${sub ? `<div style="
            font-family: ${T.font.mono};
            font-size: ${T.fs.sm}px;
            color: ${T.textDim};
            margin-top: ${T.sp.xs}px;
            letter-spacing: 0.5px;
        ">${sub}</div>` : ''}
    `;
    return card;
}

async function renderPayrollTab(body) {
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
    loading.textContent = 'Loading payroll period...';
    body.appendChild(loading);

    try {
        await loadPayrollData(PAYROLL_SUMMARY.period.start, PAYROLL_SUMMARY.period.end);
    } catch (e) {
        console.warn('[Payroll Periods] load failed:', e);
    }

    body.innerHTML = '';

    const summary = PAYROLL_SUMMARY.laborSummary || {};
    const employees = PAYROLL_SUMMARY.employees || [];
    const otCount = employees.filter(e => (e.overtimeHours || 0) > 0).length;

    // ── Toolbar: date range picker + export buttons ──
    const toolbar = document.createElement('div');
    toolbar.style.cssText = `
        display: flex; justify-content: space-between; align-items: center;
        gap: ${T.sp.md}px; flex-wrap: wrap;
        margin-bottom: ${T.sp.lg}px;
    `;
    const picker = buildDateRangePicker({
        start: PAYROLL_SUMMARY.period.start,
        end: PAYROLL_SUMMARY.period.end,
        onChange: async ({ start, end }) => {
            PAYROLL_SUMMARY.period.start = start;
            PAYROLL_SUMMARY.period.end = end;
            renderPayrollTab(body);
        },
    });
    toolbar.appendChild(picker);
    const exportRow = document.createElement('div');
    exportRow.style.cssText = `display: flex; gap: ${T.sp.sm}px;`;
    exportRow.appendChild(button({
        label: 'Export CSV',
        variant: 'secondary',
        onClick: () => exportPayroll('csv'),
    }));
    exportRow.appendChild(button({
        label: 'Export ADP',
        variant: 'primary',
        onClick: () => exportPayroll('adp'),
    }));
    toolbar.appendChild(exportRow);
    body.appendChild(toolbar);

    // ── KPI row (4 cards per mockup) ──
    const kpis = document.createElement('div');
    kpis.style.cssText = `
        display: grid;
        grid-template-columns: repeat(4, 1fr);
        gap: ${T.sp.md}px;
        margin-bottom: ${T.sp.lg}px;
    `;
    kpis.appendChild(buildKpiCard({
        label: 'Total Hours',
        value: fmtHrs(summary.totalHours),
        sub: `Across ${employees.length} employee${employees.length === 1 ? '' : 's'}`,
        accent: T.green,
    }));
    kpis.appendChild(buildKpiCard({
        label: 'Overtime',
        value: fmtHrs(summary.overtimeHours),
        sub: `${otCount} employee${otCount === 1 ? '' : 's'} > 40h`,
        accent: (summary.overtimeHours || 0) > 0 ? T.warning : T.green,
    }));
    kpis.appendChild(buildKpiCard({
        label: 'Total Labor',
        value: fmtMoneyComma(summary.totalLabor),
        sub: 'Wages + OT premium',
        accent: T.gold,
    }));
    kpis.appendChild(buildKpiCard({
        label: 'Labor %',
        value: `${(summary.laborPct || 0).toFixed(1)}%`,
        sub: laborSubText(summary.laborPct),
        accent: laborAccent(summary.laborPct),
    }));
    body.appendChild(kpis);

    // ── Employee breakdown ──
    const card = sectionCard({
        label: 'Employee Breakdown',
        accent: T.gold,
        note: `Hours, overtime premium, and gross pay for ${fmtDateRange(PAYROLL_SUMMARY.period.start, PAYROLL_SUMMARY.period.end)}.`,
    });
    card.body.appendChild(buildPayrollTable(employees));
    body.appendChild(card.card);
}

function buildPayrollTable(employees) {
    const table = document.createElement('div');
    table.style.cssText = `
        background: ${T.well};
        border-radius: ${T.r.sm}px;
        overflow: hidden;
    `;

    // Header
    const th = document.createElement('div');
    th.style.cssText = `
        display: grid;
        grid-template-columns: ${PAYROLL_GRID};
        gap: ${T.sp.md}px;
        padding: ${T.sp.md}px ${T.sp.lg}px;
        background: ${withAlpha(T.gold, 0.06)};
        font-family: ${T.font.mono};
        font-size: ${T.fs.sm}px;
        font-weight: 700;
        letter-spacing: 1.5px;
        text-transform: uppercase;
        color: ${T.textMuted};
    `;
    ['Employee', 'Role', 'Regular', 'OT', 'Rate'].forEach(label => {
        const c = document.createElement('div');
        c.textContent = label;
        th.appendChild(c);
    });
    const grossHead = document.createElement('div');
    grossHead.textContent = 'Gross';
    grossHead.style.textAlign = 'right';
    th.appendChild(grossHead);
    table.appendChild(th);

    if (employees.length === 0) {
        const empty = document.createElement('div');
        empty.style.cssText = `
            padding: ${T.sp.xxxl}px;
            text-align: center;
            color: ${T.textMuted};
            font-size: ${T.fs.base}px;
        `;
        empty.textContent = 'No employee data for this period.';
        table.appendChild(empty);
        return table;
    }

    employees.forEach(emp => {
        const tr = document.createElement('div');
        tr.style.cssText = `
            display: grid;
            grid-template-columns: ${PAYROLL_GRID};
            gap: ${T.sp.md}px;
            padding: ${T.sp.md + 2}px ${T.sp.lg}px;
            border-top: 1px solid ${T.border};
            align-items: center;
        `;

        // Employee name
        const name = document.createElement('div');
        name.style.cssText = `color: ${T.text}; font-size: ${T.fs.base}px;`;
        name.textContent = emp.name || '—';
        tr.appendChild(name);

        // Role chip
        const role = document.createElement('div');
        role.appendChild(_roleChip(emp.role));
        tr.appendChild(role);

        // Regular hours
        const reg = document.createElement('div');
        reg.style.cssText = `font-family: ${T.font.mono}; font-size: ${T.fs.base}px; color: ${T.text};`;
        reg.textContent = fmtHrs(emp.regularHours);
        tr.appendChild(reg);

        // OT hours (em-dash if zero, warning color if non-zero)
        const ot = document.createElement('div');
        const otVal = emp.overtimeHours || 0;
        ot.style.cssText = `font-family: ${T.font.mono}; font-size: ${T.fs.base}px; color: ${otVal > 0 ? T.warning : T.textDim};`;
        ot.textContent = otVal > 0 ? fmtHrs(otVal) : '—';
        tr.appendChild(ot);

        // Hourly rate
        const rate = document.createElement('div');
        rate.style.cssText = `font-family: ${T.font.mono}; font-size: ${T.fs.base}px; color: ${T.textMuted};`;
        rate.textContent = (emp.hourlyRate || 0) > 0 ? fmtMoneyComma(emp.hourlyRate) : '—';
        tr.appendChild(rate);

        // Gross pay (right-aligned, gold, bold)
        const gross = document.createElement('div');
        gross.style.cssText = `
            font-family: ${T.font.mono};
            font-size: ${T.fs.base}px;
            color: ${T.gold};
            font-weight: 700;
            text-align: right;
        `;
        gross.textContent = fmtMoneyComma(emp.grossPay);
        tr.appendChild(gross);

        table.appendChild(tr);
    });

    return table;
}

async function exportPayroll(formatId) {
    const summary = PAYROLL_SUMMARY.laborSummary || {};
    const employees = PAYROLL_SUMMARY.employees || [];
    try {
        await pushChanges([{
            event_type: 'PAYROLL_EXPORTED',
            payload: {
                format: formatId,
                period_start: PAYROLL_SUMMARY.period.start,
                period_end:   PAYROLL_SUMMARY.period.end,
                employee_count: employees.length,
                total_hours: summary.totalHours,
                total_labor: summary.totalLabor,
            },
        }]);
        const label = formatId === 'adp' ? 'ADP' : formatId.toUpperCase();
        showToast(`Payroll exported (${label})`, 'success');
    } catch (e) {
        console.warn('[Payroll Periods] export failed:', e);
        showToast('Export failed — see console', 'error');
    }
}

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

/* ==========================================
   SHIFT DETAIL MODAL
   Opens when a manager clicks Edit on a Live Dashboard row or any
   cell in the Week Grid. Shows the shift's time card, edited
   provenance, breaks, performance metrics, and order log — any
   section with no data is skipped. Edit Shift Times button in
   the footer opens the manager-PIN-gated edit modal.
   ========================================== */
function openShiftDetailModal(shift) {
    const content = document.createElement('div');
    content.style.cssText = 'display: flex; flex-direction: column; gap: 16px;';

    // ── Time card (3-col: Clock In / Clock Out / Hours) ──
    const timeRow = document.createElement('div');
    timeRow.style.cssText = `
        display: grid;
        grid-template-columns: repeat(3, 1fr);
        gap: ${T.sp.md}px;
        padding: ${T.sp.md + 2}px ${T.sp.lg - 2}px;
        background: ${T.well};
        border-radius: ${T.r.md}px;
    `;
    timeRow.appendChild(_timeStat('Clock In',  fmtTime12(shift.clockIn),  T.text));
    timeRow.appendChild(_timeStat('Clock Out', shift.clockOut ? fmtTime12(shift.clockOut) : 'Still Working', T.text));
    const hrsColor = shift.hours >= 10 ? T.warning : (shift.hours >= 8 ? T.gold : T.green);
    timeRow.appendChild(_timeStat('Total Hours', fmtHrs(shift.hours), hrsColor));
    content.appendChild(timeRow);

    // ── Edited notice (if applicable) ──
    if (shift.edited) {
        const notice = document.createElement('div');
        notice.style.cssText = `
            padding: ${T.sp.md + 2}px ${T.sp.lg}px;
            background: ${withAlpha(T.warning, 0.08)};
            border: 1px solid ${withAlpha(T.warning, 0.3)};
            border-radius: ${T.r.md}px;
            color: ${T.warning};
            font-size: ${T.fs.base}px;
            line-height: 1.55;
        `;
        const orig = shift.originalClockOut
            ? `Original clock out: ${fmtTime12(shift.originalClockOut)} → adjusted ${fmtTime12(shift.clockOut)}.<br/>`
            : '';
        notice.innerHTML = `
            <div style="font-family: ${T.font.mono};
                        font-size: ${T.fs.sm}px; letter-spacing: 1.5px;
                        font-weight: 700; text-transform: uppercase;
                        margin-bottom: 4px;">
                ✎ Time adjusted by ${shift.editedBy || 'manager'}
            </div>
            ${orig}
            ${shift.editReason ? `Reason: ${shift.editReason}.` : ''}
        `;
        content.appendChild(notice);
    }

    // ── Breaks section ──
    if (Array.isArray(shift.breaks) && shift.breaks.length > 0) {
        const breaksCard = sectionCard({
            label: `Breaks [${shift.breaks.length}]`,
            accent: T.cyan,
        });
        const breaksGrid = document.createElement('div');
        breaksGrid.style.cssText = `
            background: ${T.well};
            border-radius: ${T.r.sm}px;
            overflow: hidden;
        `;
        const bh = document.createElement('div');
        bh.style.cssText = `
            display: grid;
            grid-template-columns: 1fr 1.4fr 1fr 1fr;
            gap: ${T.sp.md}px;
            padding: ${T.sp.sm + 2}px ${T.sp.lg}px;
            background: ${withAlpha(T.cyan, 0.06)};
            font-family: ${T.font.mono};
            font-size: ${T.fs.sm}px;
            font-weight: 700;
            letter-spacing: 1.5px;
            text-transform: uppercase;
            color: ${T.textMuted};
        `;
        ['Type', 'Window', 'Duration', 'Compliance'].forEach(lbl => {
            const c = document.createElement('div');
            c.textContent = lbl;
            bh.appendChild(c);
        });
        breaksGrid.appendChild(bh);

        shift.breaks.forEach(brk => {
            const row = document.createElement('div');
            row.style.cssText = `
                display: grid;
                grid-template-columns: 1fr 1.4fr 1fr 1fr;
                gap: ${T.sp.md}px;
                padding: ${T.sp.sm + 2}px ${T.sp.lg}px;
                border-top: 1px solid ${T.border};
                font-size: ${T.fs.base}px;
                color: ${T.text};
            `;
            const isMeal = brk.type === 'meal';
            const compliant = isMeal ? (brk.duration >= 30) : true;
            row.innerHTML = `
                <div style="color: ${isMeal ? T.warning : T.cyan};">${isMeal ? 'Meal break' : 'Rest break'}</div>
                <div style="color: ${T.textMuted}; font-family: ${T.font.mono}; font-size: ${T.fs.md}px;">${fmtTime12(brk.start)} – ${fmtTime12(brk.end)}</div>
                <div style="color: ${T.text};">${brk.duration} min · ${brk.paid ? 'Paid' : 'Unpaid'}</div>
                <div style="color: ${compliant ? T.green : T.warning};">
                    ${compliant ? '✓ Compliant' : '⚠ Under 30 min'}
                </div>
            `;
            breaksGrid.appendChild(row);
        });
        breaksCard.body.appendChild(breaksGrid);
        content.appendChild(breaksCard.card);
    }

    // ── Performance metrics (only if there's something to show) ──
    if ((shift.sales > 0) || (shift.tips > 0) || shift.tables) {
        const metricRow = document.createElement('div');
        metricRow.style.cssText = `
            display: grid;
            grid-template-columns: repeat(4, 1fr);
            gap: ${T.sp.md}px;
        `;
        metricRow.appendChild(_weekStat('Tables', shift.tables ? String(shift.tables) : '—', T.green));
        metricRow.appendChild(_weekStat('Sales',  shift.sales  ? fmtMoney(shift.sales) : '—', T.gold));
        metricRow.appendChild(_weekStat('Tips',   shift.tips   ? fmtMoney(shift.tips)  : '—', T.gold));
        metricRow.appendChild(_weekStat('Tip %',  shift.tipPct ? shift.tipPct.toFixed(1) + '%' : '—', T.lavender));
        content.appendChild(metricRow);
    }

    // ── Order log ──
    if (Array.isArray(shift.orders) && shift.orders.length > 0) {
        const ordersCard = sectionCard({
            label: `Order Log [${shift.orders.length}]`,
            accent: T.gold,
        });
        const og = document.createElement('div');
        og.style.cssText = `
            background: ${T.well};
            border-radius: ${T.r.sm}px;
            overflow: hidden;
        `;
        const oh = document.createElement('div');
        oh.style.cssText = `
            display: grid;
            grid-template-columns: 1fr 0.8fr 0.8fr 1fr;
            gap: ${T.sp.md}px;
            padding: ${T.sp.sm + 2}px ${T.sp.lg}px;
            background: ${withAlpha(T.gold, 0.06)};
            font-family: ${T.font.mono};
            font-size: ${T.fs.sm}px;
            font-weight: 700;
            letter-spacing: 1.5px;
            text-transform: uppercase;
            color: ${T.textMuted};
        `;
        ['Time', 'Table', 'Items', 'Amount'].forEach(lbl => {
            const c = document.createElement('div');
            c.textContent = lbl;
            oh.appendChild(c);
        });
        og.appendChild(oh);
        shift.orders.forEach(order => {
            const row = document.createElement('div');
            row.style.cssText = `
                display: grid;
                grid-template-columns: 1fr 0.8fr 0.8fr 1fr;
                gap: ${T.sp.md}px;
                padding: ${T.sp.sm + 2}px ${T.sp.lg}px;
                border-top: 1px solid ${T.border};
                font-size: ${T.fs.base}px;
                color: ${T.text};
            `;
            row.innerHTML = `
                <div style="color: ${T.textMuted}; font-family: ${T.font.mono}; font-size: ${T.fs.md}px;">${fmtTime12(order.time)}</div>
                <div style="color: ${T.green};">${order.table}</div>
                <div style="color: ${T.textMuted};">${order.items}</div>
                <div style="color: ${T.text}; font-weight: 600;">${fmtMoney(order.amount)}</div>
            `;
            og.appendChild(row);
        });
        ordersCard.body.appendChild(og);
        content.appendChild(ordersCard.card);
    }

    // ── Footer ──
    let modalRef = null;
    const cancelBtn = button({
        label: 'Close',
        variant: 'ghost',
        onClick: () => modalRef.close(),
    });
    const editBtn = button({
        label: '✎ Edit Shift Times',
        variant: 'primary',
        onClick: () => {
            modalRef.close();
            openEditShiftModal(shift);
        },
    });

    const dateDisplay = shift.date
        ? new Date(shift.date + 'T12:00:00').toLocaleDateString('en-US', {
            weekday: 'short', month: 'short', day: 'numeric', year: 'numeric',
        })
        : 'Today';

    modalRef = openModal({
        title: `${shift.name || ''} — ${dateDisplay}`,
        content,
        footer: [cancelBtn, editBtn],
        width: 680,
    });
}

function _timeStat(label, value, color) {
    const stat = document.createElement('div');
    stat.innerHTML = `
        <div style="
            font-family: ${T.font.mono};
            font-size: ${T.fs.xs}px;
            letter-spacing: 2px;
            font-weight: 700;
            color: ${T.textMuted};
            text-transform: uppercase;
            margin-bottom: ${T.sp.xs + 2}px;
        ">${label}</div>
        <div style="
            font-family: ${T.font.mono};
            font-size: ${T.fs.xxl - 4}px;
            font-weight: 700;
            color: ${color};
            line-height: 1;
        ">${value}</div>
    `;
    return stat;
}

/* ==========================================
   EDIT SHIFT MODAL
   Manager-PIN-gated form that emits SHIFT_TIME_ADJUSTED. Reason
   is required (dropdown from EDIT_REASONS). Notes optional.
   Payload shape is identical to the legacy time-attendance scene
   so the backend projection doesn't notice the port.
   ========================================== */
function openEditShiftModal(shift) {
    const draft = {
        adjustedIn:  shift.clockIn,
        adjustedOut: shift.clockOut,
        reason:      '',
        notes:       '',
        pin:         '',
    };

    const content = document.createElement('div');
    content.style.cssText = 'display: flex; flex-direction: column; gap: 16px;';

    // Original times (read-only)
    const origWrap = document.createElement('div');
    origWrap.style.cssText = 'display: flex; flex-direction: column; gap: 6px;';
    const origLbl = document.createElement('div');
    origLbl.style.cssText = `
        font-family: ${T.font.mono};
        font-size: ${T.fs.sm}px;
        letter-spacing: 1.5px;
        font-weight: 700;
        color: ${T.textMuted};
        text-transform: uppercase;
    `;
    origLbl.textContent = 'Original times';
    origWrap.appendChild(origLbl);
    const origBox = document.createElement('div');
    origBox.style.cssText = `
        display: grid;
        grid-template-columns: repeat(3, 1fr);
        gap: ${T.sp.md}px;
        padding: ${T.sp.md}px ${T.sp.lg}px;
        background: ${T.well};
        border-radius: ${T.r.sm}px;
    `;
    origBox.appendChild(_miniStat('Clock In',  fmtTime12(shift.clockIn)));
    origBox.appendChild(_miniStat('Clock Out', fmtTime12(shift.clockOut)));
    origBox.appendChild(_miniStat('Hours',     fmtHrs(shift.hours)));
    origWrap.appendChild(origBox);
    content.appendChild(origWrap);

    // Adjusted times
    const adjHdr = document.createElement('div');
    adjHdr.style.cssText = `
        font-family: ${T.font.mono};
        font-size: ${T.fs.sm}px;
        letter-spacing: 1.5px;
        font-weight: 700;
        color: ${T.textMuted};
        text-transform: uppercase;
    `;
    adjHdr.textContent = 'Adjusted times';
    content.appendChild(adjHdr);

    const timeRow = document.createElement('div');
    timeRow.style.cssText = `display: flex; gap: ${T.sp.lg}px;`;
    const inF = _buildTimeField('New Clock In', shift.clockIn || '');
    const outF = _buildTimeField('New Clock Out', shift.clockOut || '');
    inF.input.addEventListener('input',  () => { draft.adjustedIn  = inF.input.value; });
    outF.input.addEventListener('input', () => { draft.adjustedOut = outF.input.value; });
    timeRow.appendChild(inF.wrap);
    timeRow.appendChild(outF.wrap);
    content.appendChild(timeRow);

    // Reason (required)
    const reasonGroup = _labeledGroup('Reason for edit (required)', chipGroup({
        options: EDIT_REASONS.map(r => ({ id: r, label: r })),
        selected: [],
        mode: 'single',
        onChange: (sel) => { draft.reason = sel[0] || ''; },
    }));
    content.appendChild(reasonGroup);

    // Notes (optional textarea)
    const notesWrap = document.createElement('div');
    notesWrap.style.cssText = 'display: flex; flex-direction: column; gap: 6px;';
    const notesLbl = document.createElement('label');
    notesLbl.style.cssText = `
        font-family: ${T.font.body};
        font-size: ${T.fs.base}px;
        color: ${T.textMuted};
        font-weight: 600;
        letter-spacing: 0.3px;
    `;
    notesLbl.textContent = 'Notes (optional)';
    notesWrap.appendChild(notesLbl);
    const notesTa = document.createElement('textarea');
    notesTa.rows = 2;
    notesTa.style.cssText = `
        width: 100%; box-sizing: border-box;
        background: ${T.well};
        color: ${T.text};
        border: 1px solid ${T.border};
        border-radius: ${T.r.sm}px;
        padding: 10px 14px;
        font-size: ${T.fs.lg}px;
        font-family: ${T.font.body};
        outline: none; resize: vertical;
        transition: border-color 0.15s ease;
        color-scheme: dark;
    `;
    notesTa.addEventListener('focus', () => notesTa.style.borderColor = T.gold);
    notesTa.addEventListener('blur',  () => notesTa.style.borderColor = T.border);
    notesTa.addEventListener('input', () => { draft.notes = notesTa.value; });
    notesWrap.appendChild(notesTa);
    content.appendChild(notesWrap);

    // Manager PIN
    const pinF = field({
        label: 'Manager PIN (required)',
        type: 'password',
        placeholder: 'Enter 4–6 digit PIN',
    });
    pinF.input.maxLength = 6;
    pinF.input.style.letterSpacing = '4px';
    pinF.input.addEventListener('input', () => { draft.pin = pinF.input.value; });
    content.appendChild(pinF.wrap);

    // Audit notice
    const notice = document.createElement('div');
    notice.style.cssText = `
        padding: ${T.sp.md}px ${T.sp.lg}px;
        background: ${T.well};
        border: 1px solid ${T.border};
        border-radius: ${T.r.sm}px;
        color: ${T.textMuted};
        font-size: ${T.fs.base}px;
        line-height: 1.5;
    `;
    notice.innerHTML = `🔒 This edit creates a permanent <span style="color: ${T.green}; font-family: ${T.font.mono};">SHIFT_TIME_ADJUSTED</span> event in the audit trail. Original times are preserved and can never be deleted.`;
    content.appendChild(notice);

    // Footer
    let modalRef = null;
    const cancelBtn = button({
        label: 'Cancel',
        variant: 'ghost',
        onClick: () => modalRef.close(),
    });
    const applyBtn = button({
        label: 'Apply Edit',
        variant: 'primary',
        onClick: async () => {
            if (!draft.reason) {
                showToast('Please select a reason for this edit.', 'error');
                return;
            }
            if (!draft.pin || draft.pin.length < 4) {
                showToast('Manager PIN is required.', 'error');
                return;
            }

            try {
                await pushChanges([{
                    event_type: 'SHIFT_TIME_ADJUSTED',
                    payload: {
                        shift_id: shift.shift_id,
                        employee_id: shift.employee_id,
                        original_clock_in: shift.clockIn,
                        original_clock_out: shift.clockOut,
                        adjusted_clock_in: draft.adjustedIn,
                        adjusted_clock_out: draft.adjustedOut,
                        reason_code: draft.reason,
                        notes: draft.notes || null,
                        manager_pin_verified: true,
                    },
                }]);
                modalRef.close();
                const label = (shift.name || '').split(' ')[0] || 'shift';
                showToast(`Shift times adjusted for ${label}.`, 'success');
                // Refresh whichever sub-view is open.
                if (_container && _tabBodies.clock && _activeTabId === 'clock') {
                    renderClockTab(_tabBodies.clock);
                }
            } catch (e) {
                console.warn('[Shift edit] save failed:', e);
                showToast('Save failed — see console', 'error');
            }
        },
    });

    modalRef = openModal({
        title: `Edit Shift: ${shift.name || ''}`,
        content,
        footer: [cancelBtn, applyBtn],
        width: 560,
    });
}

function _miniStat(label, value) {
    const s = document.createElement('div');
    s.innerHTML = `
        <div style="
            font-family: ${T.font.mono};
            font-size: ${T.fs.xs}px;
            letter-spacing: 1.5px;
            font-weight: 700;
            color: ${T.textDim};
            text-transform: uppercase;
            margin-bottom: 2px;
        ">${label}</div>
        <div style="
            font-family: ${T.font.mono};
            font-size: ${T.fs.lg}px;
            font-weight: 700;
            color: ${T.text};
        ">${value}</div>
    `;
    return s;
}

function _buildTimeField(label, value) {
    const wrap = document.createElement('div');
    wrap.style.cssText = 'display: flex; flex-direction: column; gap: 6px; flex: 1;';
    const lbl = document.createElement('label');
    lbl.style.cssText = `
        font-family: ${T.font.body};
        font-size: ${T.fs.base}px;
        color: ${T.textMuted};
        font-weight: 600;
        letter-spacing: 0.3px;
    `;
    lbl.textContent = label;
    wrap.appendChild(lbl);
    const input = document.createElement('input');
    input.type = 'time';
    input.value = value || '';
    input.style.cssText = `
        width: 100%; box-sizing: border-box;
        background: ${T.well};
        color: ${T.text};
        border: 1px solid ${T.border};
        border-radius: ${T.r.sm}px;
        padding: 10px 14px;
        font-size: ${T.fs.lg}px;
        font-family: ${T.font.body};
        outline: none;
        transition: border-color 0.15s ease;
        color-scheme: dark;
    `;
    input.addEventListener('focus', () => input.style.borderColor = T.gold);
    input.addEventListener('blur',  () => input.style.borderColor = T.border);
    wrap.appendChild(input);
    return { wrap, input };
}
/* ------------------------------------------
   WEEK GRID — Weekly timecards for the full team
   Spreadsheet-style Employee × Day grid. Each shift cell shows
   hours colored by bucket (T.green <8h, T.gold 8–10h, T.warning
   10h+). Cells are clickable and open the shift-detail modal
   (chunk 4) so the user can edit shift times. Empty days show an
   em-dash. OT badge appears on the name cell whenever the week's
   total crosses 40h.
------------------------------------------ */
const WEEK_GRID = '1.8fr repeat(7, 1fr) 1fr';

// Cell-color buckets match the mockup: green below 8h, gold 8–10h,
// warning 10h+. Listed in CONFIGURABLE_SETTINGS.md for eventual
// per-location tuning.
function cellColor(hours) {
    if (hours >= 10) return T.warning;
    if (hours >= 8)  return T.gold;
    return T.green;
}

function renderWeekGrid(wrap) {
    wrap.innerHTML = '';

    // Week range caption (Mon–Sun of the most recently completed week).
    const weekStart = new Date();
    weekStart.setDate(weekStart.getDate() - ((weekStart.getDay() + 6) % 7) - 7);
    const weekEnd = new Date(weekStart);
    weekEnd.setDate(weekEnd.getDate() + 6);
    const fmtWeekDate = (d) => d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

    const card = sectionCard({
        label: 'Weekly Time Cards',
        accent: T.green,
        note: `Week of ${fmtWeekDate(weekStart)} – ${fmtWeekDate(weekEnd)}. Click any cell to open that shift.`,
    });

    if (WEEKLY_TIMECARDS.length === 0) {
        const empty = document.createElement('div');
        empty.style.cssText = `
            padding: ${T.sp.xxxl}px;
            text-align: center;
            color: ${T.textMuted};
            font-size: ${T.fs.base}px;
            background: ${T.well};
            border-radius: ${T.r.sm}px;
        `;
        empty.textContent = 'No timecards for the selected week.';
        card.body.appendChild(empty);
        wrap.appendChild(card.card);
        return;
    }

    const grid = document.createElement('div');
    grid.style.cssText = `
        background: ${T.well};
        border-radius: ${T.r.sm}px;
        overflow-x: auto;
    `;

    // Grid header
    const gh = document.createElement('div');
    gh.style.cssText = `
        display: grid;
        grid-template-columns: ${WEEK_GRID};
        gap: ${T.sp.sm}px;
        padding: ${T.sp.md}px ${T.sp.lg}px;
        background: ${withAlpha(T.green, 0.06)};
        font-family: ${T.font.mono};
        font-size: ${T.fs.sm}px;
        font-weight: 700;
        letter-spacing: 1.5px;
        text-transform: uppercase;
        color: ${T.textMuted};
        min-width: 820px;
    `;
    const empHead = document.createElement('div');
    empHead.textContent = 'Employee';
    gh.appendChild(empHead);
    DAY_LABELS.forEach(lbl => {
        const c = document.createElement('div');
        c.textContent = lbl;
        c.style.textAlign = 'center';
        gh.appendChild(c);
    });
    const totalHead = document.createElement('div');
    totalHead.textContent = 'Total';
    totalHead.style.textAlign = 'right';
    gh.appendChild(totalHead);
    grid.appendChild(gh);

    // Rows
    WEEKLY_TIMECARDS.forEach(tc => {
        const totals = getWeeklyTotals(tc);

        const row = document.createElement('div');
        row.style.cssText = `
            display: grid;
            grid-template-columns: ${WEEK_GRID};
            gap: ${T.sp.sm}px;
            padding: ${T.sp.md}px ${T.sp.lg}px;
            border-top: 1px solid ${T.border};
            align-items: center;
            min-width: 820px;
        `;

        // Name cell with OT / EDITED badges
        const nameCell = document.createElement('div');
        nameCell.style.cssText = `
            color: ${T.text};
            font-size: ${T.fs.base}px;
            display: flex; align-items: center; flex-wrap: wrap;
            gap: ${T.sp.xs}px;
        `;
        const nameTxt = document.createElement('span');
        nameTxt.textContent = tc.name;
        nameCell.appendChild(nameTxt);
        if (totals.overtime > 0) {
            nameCell.appendChild(_inlineBadge(`OT +${totals.overtime.toFixed(1)}H`, T.verm));
        }
        if (totals.hasEdits) {
            nameCell.appendChild(_inlineBadge('EDITED', T.warning));
        }
        row.appendChild(nameCell);

        // One cell per day
        for (let dayIdx = 0; dayIdx < 7; dayIdx++) {
            const shift = tc.shifts.find(s => getDayIndex(s.date) === dayIdx);
            const cell = document.createElement('div');
            cell.style.cssText = 'text-align: center;';

            if (shift) {
                const color = cellColor(shift.hours);
                const cellBtn = document.createElement('button');
                cellBtn.type = 'button';
                cellBtn.title = `${fmtTime12(shift.clockIn)} – ${fmtTime12(shift.clockOut)}`;
                cellBtn.style.cssText = `
                    background: transparent;
                    border: 1px solid transparent;
                    color: ${color};
                    font-family: ${T.font.mono};
                    font-size: ${T.fs.base}px;
                    font-weight: 700;
                    padding: 6px 8px;
                    border-radius: ${T.r.sm}px;
                    cursor: pointer;
                    transition: background 0.15s ease, border-color 0.15s ease;
                `;
                cellBtn.textContent = shift.hours.toFixed(1);
                if (shift.edited) {
                    const dot = document.createElement('span');
                    dot.textContent = ' ✎';
                    dot.style.cssText = `color: ${T.warning}; font-size: ${T.fs.xs}px; vertical-align: super;`;
                    cellBtn.appendChild(dot);
                }
                cellBtn.addEventListener('mouseenter', () => {
                    cellBtn.style.background = withAlpha(T.text, 0.05);
                    cellBtn.style.borderColor = T.border;
                });
                cellBtn.addEventListener('mouseleave', () => {
                    cellBtn.style.background = 'transparent';
                    cellBtn.style.borderColor = 'transparent';
                });
                cellBtn.addEventListener('click', () => {
                    const detail = SHIFT_DETAILS[shift.shift_id] || _synthesizeShiftDetail(tc, shift);
                    openShiftDetailModal(detail);
                });
                cell.appendChild(cellBtn);
            } else {
                const em = document.createElement('span');
                em.textContent = '—';
                em.style.cssText = `color: ${T.textDim}; font-size: ${T.fs.md}px;`;
                cell.appendChild(em);
            }
            row.appendChild(cell);
        }

        // Total cell
        const totalCell = document.createElement('div');
        const totalColor = totals.overtime > 0 ? T.verm
                         : (totals.totalHours > 35 ? T.gold : T.green);
        totalCell.style.cssText = `
            text-align: right;
            font-family: ${T.font.mono};
            font-size: ${T.fs.lg}px;
            font-weight: 700;
            color: ${totalColor};
        `;
        totalCell.textContent = fmtHrs(totals.totalHours);
        row.appendChild(totalCell);

        grid.appendChild(row);
    });

    card.body.appendChild(grid);
    wrap.appendChild(card.card);

    // Week totals strip (matches the mockup's KPI row pattern, scaled down)
    const allTotals = WEEKLY_TIMECARDS.map(getWeeklyTotals);
    const grandHours = allTotals.reduce((sum, t) => sum + t.totalHours, 0);
    const grandSales = allTotals.reduce((sum, t) => sum + t.totalSales, 0);
    const grandTips  = allTotals.reduce((sum, t) => sum + t.totalTips, 0);
    const otEmps = allTotals.filter(t => t.overtime > 0).length;

    const stats = document.createElement('div');
    stats.style.cssText = `
        margin-top: ${T.sp.md}px;
        display: grid;
        grid-template-columns: repeat(4, 1fr);
        gap: ${T.sp.md}px;
    `;
    stats.appendChild(_weekStat('Total Hours', fmtHrs(grandHours), T.green));
    stats.appendChild(_weekStat('Total Sales', fmtMoney(grandSales), T.gold));
    stats.appendChild(_weekStat('Total Tips',  fmtMoney(grandTips),  T.gold));
    stats.appendChild(_weekStat('OT Employees', String(otEmps), otEmps > 0 ? T.verm : T.green));
    wrap.appendChild(stats);

    // Legend
    const legend = document.createElement('div');
    legend.style.cssText = `
        margin-top: ${T.sp.md}px;
        padding: ${T.sp.sm + 2}px ${T.sp.lg}px;
        display: flex; gap: ${T.sp.lg}px; flex-wrap: wrap;
        font-family: ${T.font.mono};
        font-size: ${T.fs.sm}px;
        letter-spacing: 1px;
        color: ${T.textMuted};
        text-transform: uppercase;
    `;
    legend.innerHTML = `
        <span><span style="color: ${T.green};">■</span> under 8h</span>
        <span><span style="color: ${T.gold};">■</span> 8–10h</span>
        <span><span style="color: ${T.warning};">■</span> 10h+</span>
        <span><span style="color: ${T.warning};">✎</span> edited</span>
    `;
    wrap.appendChild(legend);
}

function _weekStat(label, value, color) {
    return buildKpiCard({ label, value, accent: color });
}

// Week-grid rows reference shift_ids that may not have a matching
// detail record in SHIFT_DETAILS. For those, synthesize a best-
// effort detail object from the timecard row so the drill-down
// modal still opens.
function _synthesizeShiftDetail(tc, shift) {
    const parts = (tc.name || '').split(' ');
    return {
        shift_id: shift.shift_id,
        employee_id: tc.employee_id,
        name: tc.name,
        firstName: parts[0] || '',
        lastName: parts.slice(1).join(' '),
        role: tc.role,
        date: shift.date,
        clockIn: shift.clockIn,
        clockOut: shift.clockOut,
        hours: shift.hours,
        edited: !!shift.edited,
        editedBy: shift.editedBy || null,
        originalClockOut: shift.originalClockOut || null,
        editReason: shift.editReason || null,
        breaks: [],
        tables: shift.tables || 0,
        guests: 0,
        sales: shift.sales || 0,
        tips: shift.tips || 0,
        tipPct: shift.sales > 0 ? (shift.tips / shift.sales * 100) : 0,
        avgCheck: 0,
        orders: [],
    };
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
