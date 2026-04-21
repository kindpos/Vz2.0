/* ============================================
   KINDpos Overseer — Employee Sections
   Subsections: Employee Management,
   Time & Attendance, Payroll & Tips,
   Shift Configuration

   Pattern: Same scene registration as
   reporting.js (registerSalesReports).

   "Nice. Dependable. Yours."
   ============================================ */

import { pushChanges } from '../services/config-push.js';
import { T, withAlpha } from '../ui/tokens.js';
import {
    buildScenePage, sectionCard, button, field,
    numberField, chipGroup, checkboxChip, row, openModal,
    showToast, buildChipTray,
} from '../ui/forms.js';
import {
    EMPLOYEES, ROLES, STATUSES,
    getRoleLabel, getStatusInfo, fmtDate,
    generatePIN, generateEmployeeId,
} from '../data/sample-employees.js';
import {
    buildTimeAttendanceScene, cleanupTimeAttendance,
} from './time-attendance.js';
import {
    buildPayrollTipsScene, cleanupPayrollTips,
} from './payroll-tips.js';
import {
    buildShiftConfigScene, cleanupShiftConfig,
} from './shift-config.js';

/* ------------------------------------------
   COLOR PALETTE
   Routed through ui/tokens.js. Kept as a local `C` alias so the
   existing `C.mint` / `C.yellow` / ... call sites in this file
   keep reading naturally during the Nostalgia port; later steps
   rename them to `T.green` / `T.gold` / ... directly.
------------------------------------------ */
const C = {
    mint:       T.green,
    mintFaded:  T.textMuted,
    mintGhost:  withAlpha(T.green, 0.15),
    mintBorder: T.border,
    mintHover:  withAlpha(T.green, 0.08),
    yellow:     T.gold,
    red:        T.verm,
    redFaded:   withAlpha(T.verm, 0.3),
    dark:       T.bg,
    darkCard:   T.card,
    white:      T.text,
    green:      T.greenUp,
    orange:     T.warning,
    grey:       T.textMuted,
    backdrop:   'rgba(0, 0, 0, 0.75)',
};

/* ------------------------------------------
   MODULE STATE
------------------------------------------ */
let employees = [];         // mutable working copy
let searchTerm = '';
let sortField  = 'lastName';
let sortDir    = 'asc';
let showInactive = false;
let activeContainer = null; // reference to scene container

/** Reset state on scene exit */
function resetState() {
    searchTerm = '';
    sortField  = 'lastName';
    sortDir    = 'asc';
    showInactive = false;
    activeContainer = null;
}

/** Deep-clone EMPLOYEES into mutable working array */
function loadEmployees() {
    employees = EMPLOYEES.map(e => ({ ...e }));
}

/* ------------------------------------------
   FILTER + SORT
------------------------------------------ */
function getFiltered(statusFilter) {
    let list = employees.filter(e => {
        if (statusFilter === 'active') return e.status === 'active';
        return e.status === 'inactive' || e.status === 'do_not_rehire';
    });

    if (searchTerm) {
        const q = searchTerm.toLowerCase();
        list = list.filter(e =>
            e.firstName.toLowerCase().includes(q) ||
            e.lastName.toLowerCase().includes(q) ||
            getRoleLabel(e.roles).toLowerCase().includes(q)
        );
    }

    list.sort((a, b) => {
        let av = a[sortField] ?? '';
        let bv = b[sortField] ?? '';
        if (typeof av === 'string') av = av.toLowerCase();
        if (typeof bv === 'string') bv = bv.toLowerCase();
        if (av < bv) return sortDir === 'asc' ? -1 : 1;
        if (av > bv) return sortDir === 'asc' ? 1 : -1;
        return 0;
    });

    return list;
}

function toggleSort(field) {
    if (sortField === field) {
        sortDir = sortDir === 'asc' ? 'desc' : 'asc';
    } else {
        sortField = field;
        sortDir = 'asc';
    }
    refreshTable();
}

function sortArrow(field) {
    if (sortField !== field) return ' ↕';
    return sortDir === 'asc' ? ' ↑' : ' ↓';
}

/* ------------------------------------------
   REFRESH — Re-render the table in place
------------------------------------------ */
function refreshTable() {
    if (!activeContainer) return;
    const wrapper = activeContainer.querySelector('#emp-table-wrapper');
    if (wrapper) {
        wrapper.innerHTML = '';
        buildTableSection(wrapper);
    }
}

/* ------------------------------------------
   EVENT DISPATCH — posts to /api/v1/config/push
------------------------------------------ */
const _pendingEvents = [];

function emitEvent(eventType, payload) {
    const event = { event_type: eventType, payload };
    _pendingEvents.push(event);
    console.log(`[Overseer] Queued: ${eventType}`, payload);
    return event;
}

async function flushEvents() {
    if (_pendingEvents.length === 0) return true;
    const batch = _pendingEvents.splice(0);
    const result = await pushChanges(batch);
    if (!result.ok) {
        _pendingEvents.unshift(...batch);
        showToast('Failed to save — changes queued for retry', 'error');
        return false;
    }
    return true;
}

/* ------------------------------------------
   MAIN VIEW: Employee List
------------------------------------------ */
function buildEmployeeList(container) {
    activeContainer = container;

    const { body: wrapper } = buildScenePage(container, {
        title: 'Staff List',
        subtitle: 'Staff administration',
    });

    // ── Action Bar: Add + Search ──
    const actionBar = document.createElement('div');
    actionBar.style.cssText = `
        display: flex; justify-content: space-between; align-items: center;
        margin-bottom: ${T.sp.lg}px; gap: ${T.sp.lg}px; flex-wrap: wrap;
    `;

    const addBtn = button({
        label: '+ Add New Employee',
        variant: 'primary',
        onClick: () => showAddEditModal(container, null),
    });
    actionBar.appendChild(addBtn);

    const searchField = field({
        id: 'emp-search',
        value: searchTerm,
        placeholder: 'Search by name or role...',
    });
    searchField.wrap.style.flex = '0 0 300px';
    searchField.input.addEventListener('input', (e) => {
        searchTerm = e.target.value;
        refreshTable();
    });
    actionBar.appendChild(searchField.wrap);

    wrapper.appendChild(actionBar);

    // ── Table Wrapper (refreshable) ──
    const tableWrap = document.createElement('div');
    tableWrap.id = 'emp-table-wrapper';
    wrapper.appendChild(tableWrap);
    buildTableSection(tableWrap);
}

/* ------------------------------------------
   TABLE SECTION (Active + Inactive)
   Two sectionCards — green accent for active, dim accent for
   inactive. Inactive card's label row is wired as a click-toggle
   that collapses the body.
------------------------------------------ */
function buildTableSection(wrapper) {
    const active   = getFiltered('active');
    const inactive = getFiltered('inactive');

    // ── Active Employees ──
    const activeCard = sectionCard({
        label: `Active Employees [${active.length}]`,
        accent: T.green,
    });
    if (active.length === 0) {
        const empty = document.createElement('div');
        empty.style.cssText = `
            padding: ${T.sp.xxxl}px;
            text-align: center;
            color: ${T.textMuted};
            font-size: ${T.fs.base}px;
        `;
        empty.textContent = searchTerm ? 'No matching employees found.' : 'No active employees.';
        activeCard.body.appendChild(empty);
    } else {
        activeCard.body.appendChild(buildTable(active));
    }
    activeCard.card.style.marginBottom = `${T.sp.lg}px`;
    wrapper.appendChild(activeCard.card);

    // ── Inactive Employees (collapsible) ──
    const inactiveCard = sectionCard({
        label: `Inactive Employees [${inactive.length}]`,
        accent: T.textDim,
    });

    // Promote sectionCard's label row into a clickable toggle with a chevron.
    const lbl = inactiveCard.card.firstElementChild;
    if (lbl) {
        lbl.style.color = T.textMuted;
        lbl.style.cursor = 'pointer';
        lbl.style.display = 'flex';
        lbl.style.justifyContent = 'space-between';
        lbl.style.alignItems = 'center';
        lbl.style.userSelect = 'none';
        lbl.style.marginBottom = showInactive ? `${T.sp.md}px` : '0';
        const chev = document.createElement('span');
        chev.style.cssText = `
            font-family: ${T.font.mono};
            font-size: ${T.fs.sm}px;
            letter-spacing: 1px;
            color: ${T.textDim};
        `;
        chev.textContent = showInactive ? 'HIDE ▲' : 'SHOW ▼';
        lbl.appendChild(chev);
        lbl.addEventListener('click', () => {
            showInactive = !showInactive;
            refreshTable();
        });
    }

    if (showInactive && inactive.length > 0) {
        inactiveCard.body.appendChild(buildTable(inactive, true));
    } else {
        // Body is empty while collapsed; hide it so the gap doesn't show.
        inactiveCard.body.style.display = 'none';
    }
    wrapper.appendChild(inactiveCard.card);
}

/* ------------------------------------------
   TABLE BUILDER
   Grid columns and sort logic unchanged from Vz1.x; type scale
   dropped to the mockup's 11/12/13 px (from 20/22/25) and the
   mint-tinted surface swapped for T.well.
------------------------------------------ */
const GRID_COLUMNS = '2.2fr 1.2fr 0.8fr 1fr 0.6fr 1.4fr';

function buildTable(list, isInactive = false) {
    const table = document.createElement('div');
    table.style.cssText = `
        background: ${T.well};
        border-radius: ${T.r.sm}px;
        overflow: hidden;
    `;

    // ── Header Row ──
    const headerRow = document.createElement('div');
    headerRow.style.cssText = `
        display: grid;
        grid-template-columns: ${GRID_COLUMNS};
        padding: ${T.sp.md}px ${T.sp.lg}px;
        gap: ${T.sp.md}px;
        background: ${withAlpha(T.green, 0.06)};
        font-family: ${T.font.mono};
        font-size: ${T.fs.sm}px;
        font-weight: 700;
        letter-spacing: 1.5px;
        text-transform: uppercase;
        color: ${T.textMuted};
        min-width: 700px;
    `;

    const columns = [
        { field: 'lastName',  label: 'Name' },
        { field: 'role',      label: 'Role' },
        { field: 'pinHash',   label: 'PIN',    sortable: false },
        { field: 'hireDate',  label: 'Hired' },
        { field: 'payRate',   label: 'Rate' },
        { field: null,        label: 'Actions', sortable: false },
    ];

    columns.forEach(col => {
        const cell = document.createElement('div');
        cell.style.cssText = col.sortable !== false
            ? 'cursor: pointer; user-select: none; transition: color 0.15s ease;'
            : '';
        cell.textContent = col.label + (col.sortable !== false ? sortArrow(col.field) : '');
        if (col.sortable !== false) {
            cell.addEventListener('click', () => toggleSort(col.field));
            cell.addEventListener('mouseenter', () => cell.style.color = T.text);
            cell.addEventListener('mouseleave', () => cell.style.color = T.textMuted);
        }
        headerRow.appendChild(cell);
    });
    table.appendChild(headerRow);

    // ── Data Rows ──
    list.forEach((emp, i) => {
        const row = document.createElement('div');
        row.style.cssText = `
            display: grid;
            grid-template-columns: ${GRID_COLUMNS};
            padding: ${T.sp.md}px ${T.sp.lg}px;
            gap: ${T.sp.md}px;
            align-items: center;
            border-top: 1px solid ${T.border};
            transition: background 0.15s ease;
            min-width: 700px;
            ${isInactive ? 'opacity: 0.6;' : ''}
        `;
        row.addEventListener('mouseenter', () => row.style.background = withAlpha(T.green, 0.04));
        row.addEventListener('mouseleave', () => row.style.background = 'transparent');

        const statusInfo = getStatusInfo(emp.status);
        const statusDot  = `<span style="display: inline-block; width: 8px; height: 8px;
                              border-radius: 50%; background: ${statusInfo.color};
                              margin-right: 8px; vertical-align: middle;"></span>`;

        row.innerHTML = `
            <div style="color: ${T.text}; font-size: ${T.fs.lg}px;">
                ${statusDot}${emp.firstName} ${emp.lastName}
                ${emp.status === 'do_not_rehire' ? `<span style="font-family: ${T.font.mono};
                    font-size: ${T.fs.xs}px; letter-spacing: 1px; color: ${T.verm};
                    background: ${withAlpha(T.verm, 0.15)}; padding: 2px 6px;
                    border-radius: ${T.r.sm}px; margin-left: ${T.sp.sm}px;
                    vertical-align: middle;">DNR</span>` : ''}
            </div>
            <div style="color: ${T.green}; font-size: ${T.fs.base}px;">${getRoleLabel(emp.roles)}</div>
            <div style="color: ${T.textDim}; font-family: ${T.font.mono}; font-size: ${T.fs.base}px; letter-spacing: 2px;">••••</div>
            <div style="color: ${T.textMuted}; font-family: ${T.font.mono}; font-size: ${T.fs.md}px;">${fmtDate(emp.hireDate)}</div>
            <div style="color: ${T.textMuted}; font-family: ${T.font.mono}; font-size: ${T.fs.md}px;">$${emp.payRate.toFixed(2)}</div>
            <div class="emp-action-cell"></div>
        `;

        // Action buttons
        const actionCell = row.querySelector('.emp-action-cell');
        actionCell.style.cssText = `display: flex; gap: ${T.sp.sm}px; justify-content: flex-end;`;

        actionCell.appendChild(button({
            label: 'Edit',
            variant: 'ghost',
            onClick: () => showAddEditModal(activeContainer, emp),
        }));
        actionCell.appendChild(button({
            label: 'Reset PIN',
            variant: 'ghost',
            onClick: () => showPINResetModal(activeContainer, emp),
        }));

        table.appendChild(row);
    });

    return table;
}

/* ------------------------------------------
   Local textarea builder — forms.js doesn't export one yet.
   Mirrors the field() style from forms.js so glows/spacing match.
------------------------------------------ */
function textArea({ label = null, value = '', rows = 3 }) {
    const wrap = document.createElement('div');
    wrap.style.cssText = 'display: flex; flex-direction: column; gap: 6px; flex: 1;';

    if (label) {
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
    }

    const ta = document.createElement('textarea');
    ta.rows = rows;
    ta.value = value;
    ta.style.cssText = `
        width: 100%; box-sizing: border-box;
        background: ${T.well};
        color: ${T.text};
        border: 1px solid ${T.border};
        border-radius: ${T.r.sm}px;
        padding: 10px 14px;
        font-size: ${T.fs.lg}px;
        font-family: ${T.font.body};
        outline: none;
        resize: vertical;
        transition: border-color 0.15s ease;
        color-scheme: dark;
    `;
    ta.addEventListener('focus', () => ta.style.borderColor = T.gold);
    ta.addEventListener('blur',  () => ta.style.borderColor = T.border);
    wrap.appendChild(ta);
    return { wrap, input: ta };
}

/* ------------------------------------------
   Labeled chipGroup — forms.js's chipGroup has no header label.
   We need a "Roles" / "Tipped" / "Status" caption on top to
   match the other field builders. Returns { wrap, getSelected }.
------------------------------------------ */
function labeledChipGroup({ label, options, selected, mode, onChange = null }) {
    const wrap = document.createElement('div');
    wrap.style.cssText = 'display: flex; flex-direction: column; gap: 6px; flex: 1;';

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

    const group = chipGroup({ options, selected, mode, onChange });
    wrap.appendChild(group.wrap);

    return { wrap, getSelected: group.getSelected };
}

/* ==========================================
   ADD / EDIT MODAL
   Built on openModal + field/numberField/chipGroup/button.
   Emits employee.created / employee.updated with identical
   payload shapes to the pre-port version.
   ========================================== */
function showAddEditModal(_container, employee) {
    const isEdit = !!employee;
    const vals = isEdit ? { ...employee } : {
        firstName: '', lastName: '', roles: ['server'],
        payRate: 15.00, isTipped: true, status: 'active',
        hireDate: new Date().toISOString().split('T')[0],
        termDate: '', termReason: '', notes: '',
    };

    const content = document.createElement('div');
    content.style.cssText = 'display: flex; flex-direction: column; gap: 16px;';

    // Name row
    const firstF = field({ label: 'First Name', value: vals.firstName, required: true });
    const lastF  = field({ label: 'Last Name',  value: vals.lastName,  required: true });
    content.appendChild(row(firstF, lastF));

    // Roles (chip tray with picker modal — only shows selected
    // roles as removable chips; tap + ADD to open the picker)
    const rolesWrap = document.createElement('div');
    rolesWrap.style.cssText = 'display: flex; flex-direction: column; gap: 6px;';
    const rolesLbl = document.createElement('div');
    rolesLbl.style.cssText = `
        font-family: ${T.font.body};
        font-size: ${T.fs.base}px;
        color: ${T.textMuted};
        font-weight: 600;
        letter-spacing: 0.3px;
    `;
    rolesLbl.textContent = 'Roles';
    rolesWrap.appendChild(rolesLbl);
    const rolesTray = buildChipTray({
        selected: vals.roles || [],
        sourceFn: () => ROLES.map(r => ({ id: r.id, name: r.label })),
        pickerTitle: 'Pick roles',
        emptyHint: 'No roles selected — tap + ADD',
        accent: T.green,
    });
    rolesWrap.appendChild(rolesTray.el);
    content.appendChild(rolesWrap);

    // Pay rate + tipped
    const rateF = numberField({
        label: 'Pay Rate',
        value: vals.payRate,
        min: 0,
        step: 0.5,
        suffix: '$/hr',
    });
    const tippedGroup = labeledChipGroup({
        label: 'Tipped',
        options: [{ id: 'yes', label: 'Yes' }, { id: 'no', label: 'No' }],
        selected: [vals.isTipped ? 'yes' : 'no'],
        mode: 'single',
    });
    content.appendChild(row(rateF, tippedGroup));

    // PIN (only on create)
    let pinF = null;
    if (!isEdit) {
        pinF = field({ label: 'PIN Code (4–6 digits)', type: 'password' });
        pinF.input.maxLength = 6;
        content.appendChild(pinF.wrap);
    }

    // Status — toggles visibility of the term section
    const termSection = document.createElement('div');
    termSection.style.cssText = `display: ${vals.status !== 'active' ? 'flex' : 'none'}; flex-direction: column; gap: 16px;`;

    const statusGroup = labeledChipGroup({
        label: 'Status',
        options: [
            { id: 'active',        label: 'Active' },
            { id: 'inactive',      label: 'Inactive' },
            { id: 'do_not_rehire', label: 'Do Not Rehire' },
        ],
        selected: [vals.status],
        mode: 'single',
        onChange: (selected) => {
            const isActive = selected[0] === 'active';
            termSection.style.display = isActive ? 'none' : 'flex';
        },
    });
    content.appendChild(statusGroup.wrap);

    // Hire date
    const hireF = field({ label: 'Hire Date', type: 'date', value: vals.hireDate });
    content.appendChild(hireF.wrap);

    // Term date + reason (conditional)
    const termDateF   = field({ label: 'Termination Date', type: 'date', value: vals.termDate || '' });
    const termReasonF = textArea({ label: 'Reason', value: vals.termReason || '' });
    termSection.appendChild(termDateF.wrap);
    termSection.appendChild(termReasonF.wrap);
    content.appendChild(termSection);

    // Notes
    const notesF = textArea({ label: 'Notes', value: vals.notes || '' });
    content.appendChild(notesF.wrap);

    // Footer
    let modalRef = null;
    const cancelBtn = button({
        label: 'Cancel',
        variant: 'ghost',
        onClick: () => modalRef.close(),
    });
    const saveBtn = button({
        label: isEdit ? 'Save Changes' : 'Add Employee',
        variant: 'primary',
        onClick: async () => {
            await handleSave(isEdit, employee, {
                firstName: firstF.input.value.trim(),
                lastName:  lastF.input.value.trim(),
                roles:     rolesTray.getIds(),
                payRate:   parseFloat(rateF.input.value) || 0,
                isTipped:  tippedGroup.getSelected()[0] === 'yes',
                status:    statusGroup.getSelected()[0] || 'active',
                hireDate:  hireF.input.value,
                termDate:  termDateF.input.value,
                termReason: termReasonF.input.value,
                notes:     notesF.input.value,
                pin:       pinF ? pinF.input.value : '',
            }, () => modalRef.close());
        },
    });

    modalRef = openModal({
        title: isEdit
            ? `Edit Employee: ${employee.firstName} ${employee.lastName}`
            : 'Add New Employee',
        content,
        footer: [cancelBtn, saveBtn],
        width: 640,
    });
}

/* ------------------------------------------
   SAVE HANDLER (Add / Edit)
------------------------------------------ */
async function handleSave(isEdit, original, values, close) {
    const {
        firstName, lastName, roles, payRate, isTipped,
        status, hireDate, termDate, termReason, notes, pin,
    } = values;
    const finalRoles = roles.length ? roles : ['server'];

    if (!firstName || !lastName) {
        showToast('First and last name are required.', 'error');
        return;
    }
    if (!isEdit && (pin.length < 4 || pin.length > 6 || !/^\d+$/.test(pin))) {
        showToast('PIN must be 4–6 digits.', 'error');
        return;
    }

    if (isEdit) {
        const idx = employees.findIndex(e => e.id === original.id);
        if (idx === -1) return;

        Object.assign(employees[idx], {
            firstName, lastName, roles: finalRoles, payRate, isTipped,
            status, hireDate,
            termDate:   status !== 'active' ? termDate   : null,
            termReason: status !== 'active' ? termReason : null,
            notes,
        });

        emitEvent('employee.updated', {
            employee_id: original.id,
            first_name: firstName,
            last_name: lastName,
            display_name: `${firstName} ${lastName}`,
            role_ids: finalRoles,
            hourly_rate: payRate,
            active: status === 'active',
        });

        showToast(`${firstName} ${lastName} updated successfully`, 'success');
    } else {
        const newEmp = {
            id: generateEmployeeId(firstName),
            firstName, lastName, roles: finalRoles, pinHash: '••••',
            payRate, isTipped, hireDate, status,
            termDate: null, termReason: null, notes,
        };
        employees.push(newEmp);

        emitEvent('employee.created', {
            employee_id: newEmp.id,
            first_name: firstName,
            last_name: lastName,
            display_name: `${firstName} ${lastName}`,
            role_ids: finalRoles,
            hourly_rate: payRate,
            pin,
            active: status === 'active',
        });

        showToast(`${firstName} ${lastName} added successfully`, 'success');
    }

    await flushEvents();
    close();
    refreshTable();
}

/* ==========================================
   PIN RESET MODAL (Step 1: Confirmation)
   ========================================== */
function showPINResetModal(container, employee) {
    const content = document.createElement('div');
    content.style.cssText = 'display: flex; flex-direction: column; gap: 16px;';

    const prompt = document.createElement('div');
    prompt.style.cssText = `color: ${T.text}; font-size: ${T.fs.lg}px;`;
    prompt.textContent = 'Generate new PIN for this employee?';
    content.appendChild(prompt);

    const customF = field({ type: 'password', placeholder: 'Enter 4–6 digit PIN' });
    customF.input.maxLength = 6;
    const customWrap = document.createElement('div');
    customWrap.style.cssText = 'display: none;';
    customWrap.appendChild(customF.wrap);

    const methodGroup = labeledChipGroup({
        label: 'Method',
        options: [
            { id: 'random', label: 'Random 4-digit' },
            { id: 'custom', label: 'Set custom' },
        ],
        selected: ['random'],
        mode: 'single',
        onChange: (selected) => {
            customWrap.style.display = selected[0] === 'custom' ? 'block' : 'none';
        },
    });
    content.appendChild(methodGroup.wrap);
    content.appendChild(customWrap);

    const forceChip = checkboxChip({
        label: 'Force employee to change PIN on next login',
        checked: true,
    });
    content.appendChild(forceChip.wrap);

    const warn = document.createElement('div');
    warn.style.cssText = `
        color: ${T.warning};
        font-size: ${T.fs.base}px;
        padding: 12px 14px;
        background: ${withAlpha(T.warning, 0.08)};
        border: 1px solid ${withAlpha(T.warning, 0.2)};
        border-radius: ${T.r.sm}px;
        line-height: 1.5;
    `;
    warn.textContent = 'New PIN will be displayed once and cannot be recovered. Write it down.';
    content.appendChild(warn);

    let modalRef = null;
    const cancelBtn = button({
        label: 'Cancel',
        variant: 'ghost',
        onClick: () => modalRef.close(),
    });
    const resetBtn = button({
        label: 'Reset PIN',
        variant: 'primary',
        onClick: () => {
            const method = methodGroup.getSelected()[0];
            let newPIN;
            if (method === 'custom') {
                const val = customF.input.value || '';
                if (val.length < 4 || val.length > 6 || !/^\d+$/.test(val)) {
                    showToast('Custom PIN must be 4–6 digits.', 'error');
                    return;
                }
                newPIN = val;
            } else {
                newPIN = generatePIN();
            }
            const forceChange = forceChip.input.checked;

            emitEvent('employee.updated', {
                employee_id: employee.id,
                new_pin_hash: 'SHA256_SIMULATED',
                force_change_on_login: forceChange,
                reset_reason: 'Manager-initiated reset',
            });

            modalRef.close();
            showPINDisplayModal(container, employee, newPIN, forceChange);
        },
    });

    modalRef = openModal({
        title: `Reset PIN: ${employee.firstName} ${employee.lastName}`,
        content,
        footer: [cancelBtn, resetBtn],
        width: 460,
    });
}

/* ==========================================
   PIN DISPLAY MODAL (Step 2: One-time show)
   ========================================== */
function showPINDisplayModal(_container, employee, pin, forceChange) {
    const content = document.createElement('div');
    content.style.cssText = 'display: flex; flex-direction: column; align-items: center; gap: 12px; text-align: center;';

    const prompt = document.createElement('div');
    prompt.style.cssText = `color: ${T.text}; font-size: ${T.fs.lg}px;`;
    prompt.textContent = `New PIN for ${employee.firstName} ${employee.lastName}:`;
    content.appendChild(prompt);

    const pinBox = document.createElement('button');
    pinBox.type = 'button';
    pinBox.title = 'Click to copy';
    pinBox.style.cssText = `
        background: ${withAlpha(T.greenUp, 0.1)};
        border: 2px solid ${T.greenUp};
        border-radius: ${T.r.md}px;
        padding: 16px 24px;
        cursor: pointer;
        font-family: ${T.font.heading};
        font-size: ${T.fs.hero}px;
        color: ${T.greenUp};
        letter-spacing: 10px;
        font-weight: 700;
    `;
    pinBox.textContent = pin;
    pinBox.addEventListener('click', () => {
        navigator.clipboard?.writeText(pin).then(() => {
            showToast('PIN copied to clipboard', 'success');
        }).catch(() => {});
    });
    content.appendChild(pinBox);

    const warn = document.createElement('div');
    warn.style.cssText = `color: ${T.warning}; font-size: ${T.fs.base}px; font-weight: 700;`;
    warn.textContent = '⚠ WRITE THIS DOWN NOW';
    content.appendChild(warn);

    const sub = document.createElement('div');
    sub.style.cssText = `color: ${T.textMuted}; font-size: ${T.fs.md}px;`;
    sub.textContent = 'This will not be shown again.';
    content.appendChild(sub);

    if (forceChange) {
        const force = document.createElement('div');
        force.style.cssText = `color: ${T.textDim}; font-size: ${T.fs.md}px;`;
        force.textContent = 'Employee must change PIN on next login.';
        content.appendChild(force);
    }

    let modalRef = null;
    const closeBtn = button({
        label: 'Close',
        variant: 'primary',
        onClick: async () => {
            await flushEvents();
            modalRef.close();
            showToast(`PIN reset for ${employee.firstName} ${employee.lastName}`, 'success');
        },
    });

    modalRef = openModal({
        title: 'PIN Reset Successful',
        content,
        footer: [closeBtn],
        width: 420,
    });
}

/* ------------------------------------------
   PLACEHOLDER BUILDER (for unbuilt subsections)
------------------------------------------ */
function buildPlaceholder(container, title, subtitle, items) {
    const wrapper = document.createElement('div');
    wrapper.style.cssText = 'padding: 0 8px; max-width: 900px; margin: 0 auto;';

    wrapper.innerHTML = `
        <div style="font-family: ${T.font.heading};
                    font-size: 36px; color: ${C.yellow}; margin-bottom: 8px;">
            ${title}
        </div>
        <div style="font-size: 25px; color: ${withAlpha(T.green, 0.5)}; margin-bottom: 32px;">
            ${subtitle}
        </div>
        <div style="background: ${withAlpha(T.green, 0.04)}; border: 1px solid ${C.mintBorder};
                    border-radius: 10px; padding: 40px; text-align: center;">
            <div style="font-size: 56px; margin-bottom: 16px; opacity: 0.3;">🚧</div>
            <div style="color: ${C.mint}; font-size: 28px; margin-bottom: 12px;">
                Under Development
            </div>
            <div style="color: ${C.grey}; font-size: 22px; max-width: 480px; margin: 0 auto; line-height: 1.6;">
                This section will include: ${items.join(', ')}.
            </div>
        </div>
    `;
    container.appendChild(wrapper);
}

/* ==========================================
   SCENE REGISTRATION
   Called from app.js:
     import { registerEmployeeSections } from './sections/employees.js';
     registerEmployeeSections(sceneManager);
   ========================================== */
export function registerEmployeeSections(sceneManager) {

    // ── 1. Employee Management (FULL BUILD) ──
    sceneManager.register('employee-management', {
        type: 'detail',
        title: 'Employee Management',
        parent: 'employees-subs',
        onEnter(container) {
            loadEmployees();
            buildEmployeeList(container);
        },
        onExit(container) {
            container.innerHTML = '';
            resetState();
        },
    });

    // ── 2. Time & Attendance (FULL BUILD) ──
    sceneManager.register('time-attendance', {
        type: 'detail',
        title: 'Time & Attendance',
        parent: 'employees-subs',
        onEnter(container) {
            buildTimeAttendanceScene(container);
        },
        onExit(container) {
            cleanupTimeAttendance(container);
        },
    });

    // ── 3. Payroll & Tips (FULL BUILD) ──
    sceneManager.register('payroll-tips', {
        type: 'detail',
        title: 'Payroll & Tips',
        parent: 'employees-subs',
        onEnter(container) {
            buildPayrollTipsScene(container);
        },
        onExit(container) {
            cleanupPayrollTips(container);
        },
    });

    // ── 4. Shift Configuration (FULL BUILD) ──
    sceneManager.register('shift-config', {
        type: 'detail',
        title: 'Shift Configuration',
        parent: 'employees-subs',
        onEnter(container) {
            buildShiftConfigScene(container);
        },
        onExit(container) {
            cleanupShiftConfig(container);
        },
    });
}