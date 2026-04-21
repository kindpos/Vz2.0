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
   COLOR PALETTE (matches reporting.js)
------------------------------------------ */
const C = {
    mint:       'var(--color-mint)',
    mintFaded:  'rgba(var(--color-mint-rgb), 0.4)',
    mintGhost:  'rgba(var(--color-mint-rgb), 0.15)',
    mintBorder: 'rgba(var(--color-mint-rgb), 0.25)',
    mintHover:  'rgba(var(--color-mint-rgb), 0.12)',
    yellow:     'var(--color-gold)',
    red:        'var(--color-vermillion)',
    redFaded:   'rgba(var(--color-vermillion-rgb), 0.3)',
    dark:       'var(--color-bg)',
    darkCard:   '#2a2a2a',
    white:      '#FFFFFF',
    green:      '#00FF00',
    orange:     '#FFA500',
    grey:       '#888888',
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
   TOAST NOTIFICATIONS
------------------------------------------ */
function showToast(message, type = 'success') {
    if (!activeContainer) return;

    // Remove existing toast
    const old = activeContainer.querySelector('.emp-toast');
    if (old) old.remove();

    const colors = {
        success: { bg: 'rgba(0, 255, 0, 0.15)', border: C.green, text: C.green },
        error:   { bg: 'rgba(var(--color-vermillion-rgb), 0.15)', border: C.red, text: C.red },
        info:    { bg: 'rgba(var(--color-mint-rgb), 0.15)', border: C.mint, text: C.mint },
    };
    const tc = colors[type] || colors.info;

    const toast = document.createElement('div');
    toast.className = 'emp-toast';
    toast.style.cssText = `
        position: fixed; top: 24px; right: 24px; z-index: 10000;
        background: ${tc.bg}; border: 1px solid ${tc.border};
        color: ${tc.text}; padding: 14px 24px; border-radius: 8px;
        font-family: var(--font-body, 'Sevastopol Interface', Arial, sans-serif);
        font-size: 25px; backdrop-filter: blur(8px);
        animation: toastSlideIn 0.3s ease-out;
        max-width: 400px;
    `;
    toast.textContent = message;
    activeContainer.appendChild(toast);

    setTimeout(() => {
        toast.style.animation = 'toastSlideOut 0.3s ease-in forwards';
        setTimeout(() => toast.remove(), 300);
    }, 3000);
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

    const wrapper = document.createElement('div');
    wrapper.style.cssText = 'padding: 0 8px; max-width: 1100px; margin: 0 auto;';

    // ── Date Header ──
    const header = document.createElement('div');
    header.style.cssText = `
        display: flex; justify-content: space-between; align-items: flex-start;
        margin-bottom: 24px; flex-wrap: wrap; gap: 12px;
    `;
    header.innerHTML = `
        <div>
            <div style="font-family: var(--font-display, 'Alien Encounters', monospace);
                        font-size: 36px; color: ${C.yellow};">
                Employee Management
            </div>
            <div style="font-size: 25px; color: rgba(var(--color-mint-rgb), 0.5); margin-top: 4px;">
                ${EMPLOYEES.length} active employee${EMPLOYEES.length !== 1 ? 's' : ''}
            </div>
        </div>
    `;
    wrapper.appendChild(header);

    // ── Action Bar: Add + Search ──
    const actionBar = document.createElement('div');
    actionBar.style.cssText = `
        display: flex; justify-content: space-between; align-items: center;
        margin-bottom: 20px; gap: 16px; flex-wrap: wrap;
    `;

    // Add button
    const addBtn = document.createElement('button');
    addBtn.textContent = '+ Add New Employee';
    addBtn.style.cssText = `
        background: ${C.mint}; color: ${C.dark}; border: none;
        padding: 14px 28px; border-radius: 8px; font-size: 25px;
        font-family: var(--font-body, 'Sevastopol Interface', Arial, sans-serif);
        font-weight: bold; cursor: pointer; letter-spacing: 0.5px;
        transition: all 0.2s ease;
    `;
    addBtn.addEventListener('mouseenter', () => addBtn.style.background = '#d4ffca');
    addBtn.addEventListener('mouseleave', () => addBtn.style.background = C.mint);
    addBtn.addEventListener('click', () => showAddEditModal(container, null));
    actionBar.appendChild(addBtn);

    // Search box
    const searchBox = document.createElement('div');
    searchBox.style.cssText = 'position: relative;';
    searchBox.innerHTML = `
        <span style="position: absolute; left: 12px; top: 50%; transform: translateY(-50%);
                     color: rgba(var(--color-mint-rgb), 0.4); font-size: 22px;">🔍</span>
        <input type="text" id="emp-search" placeholder="Search by name or role..."
               value="${searchTerm}"
               style="background: rgba(var(--color-mint-rgb), 0.06); border: 1px solid ${C.mintBorder};
                      color: ${C.mint}; padding: 14px 16px 14px 38px; border-radius: 8px;
                      font-size: 25px; width: 300px; outline: none;
                      font-family: var(--font-body, 'Sevastopol Interface', Arial, sans-serif);
                      transition: border-color 0.2s ease;" />
    `;
    actionBar.appendChild(searchBox);
    wrapper.appendChild(actionBar);

    // Wire up search
    setTimeout(() => {
        const input = container.querySelector('#emp-search');
        if (input) {
            input.addEventListener('input', (e) => {
                searchTerm = e.target.value;
                refreshTable();
            });
            input.addEventListener('focus', () => input.style.borderColor = C.mint);
            input.addEventListener('blur', () => input.style.borderColor = C.mintBorder);
        }
    }, 0);

    // ── Table Wrapper (refreshable) ──
    const tableWrap = document.createElement('div');
    tableWrap.id = 'emp-table-wrapper';
    wrapper.appendChild(tableWrap);
    buildTableSection(tableWrap);

    container.appendChild(wrapper);
}

/* ------------------------------------------
   TABLE SECTION (Active + Inactive)
------------------------------------------ */
function buildTableSection(wrapper) {
    const active   = getFiltered('active');
    const inactive = getFiltered('inactive');

    // ── Active Employees ──
    const activeSection = document.createElement('div');
    activeSection.style.cssText = `
        background: rgba(var(--color-mint-rgb), 0.04); border: 1px solid ${C.mintBorder};
        border-radius: 10px; overflow: hidden; margin-bottom: 20px;
    `;

    const activeHeader = document.createElement('div');
    activeHeader.style.cssText = `
        padding: 16px 20px; border-bottom: 1px solid ${C.mintBorder};
        font-family: var(--font-display, 'Alien Encounters', monospace);
        font-size: 26px; color: ${C.mint}; letter-spacing: 1px;
    `;
    activeHeader.textContent = `ACTIVE EMPLOYEES [${active.length}]`;
    activeSection.appendChild(activeHeader);

    if (active.length === 0) {
        const empty = document.createElement('div');
        empty.style.cssText = `padding: 40px; text-align: center; color: ${C.grey}; font-size: 25px;`;
        empty.textContent = searchTerm ? 'No matching employees found.' : 'No active employees.';
        activeSection.appendChild(empty);
    } else {
        activeSection.appendChild(buildTable(active));
    }
    wrapper.appendChild(activeSection);

    // ── Inactive Employees ──
    const inactiveSection = document.createElement('div');
    inactiveSection.style.cssText = `
        background: rgba(var(--color-mint-rgb), 0.04); border: 1px solid ${C.mintBorder};
        border-radius: 10px; overflow: hidden;
    `;

    const inactiveHeader = document.createElement('div');
    inactiveHeader.style.cssText = `
        padding: 16px 20px; border-bottom: ${showInactive ? '1px solid ' + C.mintBorder : 'none'};
        font-family: var(--font-display, 'Alien Encounters', monospace);
        font-size: 26px; color: ${C.grey}; letter-spacing: 1px;
        cursor: pointer; display: flex; justify-content: space-between;
        align-items: center; transition: background 0.2s ease;
        user-select: none;
    `;
    inactiveHeader.innerHTML = `
        <span>INACTIVE EMPLOYEES [${inactive.length}]</span>
        <span style="font-size: 20px; color: ${C.grey};">${showInactive ? 'Hide ▲' : 'Show ▼'}</span>
    `;
    inactiveHeader.addEventListener('mouseenter', () => inactiveHeader.style.background = C.mintHover);
    inactiveHeader.addEventListener('mouseleave', () => inactiveHeader.style.background = 'transparent');
    inactiveHeader.addEventListener('click', () => {
        showInactive = !showInactive;
        refreshTable();
    });
    inactiveSection.appendChild(inactiveHeader);

    if (showInactive && inactive.length > 0) {
        inactiveSection.appendChild(buildTable(inactive, true));
    }
    wrapper.appendChild(inactiveSection);
}

/* ------------------------------------------
   TABLE BUILDER
------------------------------------------ */
function buildTable(list, isInactive = false) {
    const table = document.createElement('div');
    table.style.cssText = 'overflow-x: auto;';

    // ── Header Row ──
    const headerRow = document.createElement('div');
    headerRow.style.cssText = `
        display: grid;
        grid-template-columns: 2.2fr 1.2fr 0.8fr 1fr 0.6fr 1.4fr;
        padding: 14px 20px; gap: 8px;
        background: rgba(var(--color-mint-rgb), 0.08);
        border-bottom: 1px solid ${C.mintBorder};
        font-size: 20px; color: ${C.mintFaded};
        text-transform: uppercase; letter-spacing: 1px;
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
            ? 'cursor: pointer; user-select: none; transition: color 0.2s;'
            : '';
        cell.textContent = col.label + (col.sortable !== false ? sortArrow(col.field) : '');
        if (col.sortable !== false) {
            cell.addEventListener('click', () => toggleSort(col.field));
            cell.addEventListener('mouseenter', () => cell.style.color = C.mint);
            cell.addEventListener('mouseleave', () => cell.style.color = C.mintFaded);
        }
        headerRow.appendChild(cell);
    });
    table.appendChild(headerRow);

    // ── Data Rows ──
    list.forEach((emp, i) => {
        const row = document.createElement('div');
        const stripeBg = i % 2 === 0 ? 'transparent' : 'rgba(var(--color-mint-rgb), 0.03)';
        row.style.cssText = `
            display: grid;
            grid-template-columns: 2.2fr 1.2fr 0.8fr 1fr 0.6fr 1.4fr;
            padding: 16px 20px; gap: 8px; align-items: center;
            border-bottom: 1px solid rgba(var(--color-mint-rgb), 0.08);
            background: ${stripeBg}; transition: background 0.15s ease;
            min-width: 700px;
            ${isInactive ? 'opacity: 0.6;' : ''}
        `;
        row.addEventListener('mouseenter', () => row.style.background = C.mintHover);
        row.addEventListener('mouseleave', () => row.style.background = stripeBg);

        const statusInfo = getStatusInfo(emp.status);
        const statusDot  = `<span style="display: inline-block; width: 8px; height: 8px;
                              border-radius: 50%; background: ${statusInfo.color};
                              margin-right: 8px; vertical-align: middle;"></span>`;

        row.innerHTML = `
            <div style="color: ${C.white}; font-size: 25px;">
                ${statusDot}${emp.firstName} ${emp.lastName}
                ${emp.status === 'do_not_rehire' ? `<span style="font-size: 15px; color: ${C.red};
                    background: ${C.redFaded}; padding: 2px 6px; border-radius: 4px;
                    margin-left: 8px; vertical-align: middle;">DNR</span>` : ''}
            </div>
            <div style="color: ${C.mint}; font-size: 22px;">${getRoleLabel(emp.roles)}</div>
            <div style="color: ${C.grey}; font-size: 22px; letter-spacing: 2px;">••••</div>
            <div style="color: rgba(var(--color-mint-rgb), 0.6); font-size: 22px;">${fmtDate(emp.hireDate)}</div>
            <div style="color: rgba(var(--color-mint-rgb), 0.6); font-size: 22px;">$${emp.payRate.toFixed(2)}</div>
            <div class="emp-action-cell"></div>
        `;

        // Action buttons
        const actionCell = row.querySelector('.emp-action-cell');
        actionCell.style.cssText = 'display: flex; gap: 8px;';

        const editBtn = createActionBtn('Edit', C.mint, () => showAddEditModal(activeContainer, emp));
        const resetBtn = createActionBtn('Reset', C.yellow, () => showPINResetModal(activeContainer, emp));

        actionCell.appendChild(editBtn);
        actionCell.appendChild(resetBtn);

        table.appendChild(row);
    });

    return table;
}

/* ------------------------------------------
   ACTION BUTTON HELPER
------------------------------------------ */
function createActionBtn(label, color, onClick) {
    const btn = document.createElement('button');
    btn.textContent = label;
    btn.style.cssText = `
        background: transparent; color: ${color};
        border: 1px solid ${color}; padding: 6px 16px;
        border-radius: 6px; font-size: 20px; cursor: pointer;
        font-family: var(--font-body, 'Sevastopol Interface', Arial, sans-serif);
        transition: all 0.2s ease; white-space: nowrap;
    `;
    btn.addEventListener('mouseenter', () => {
        btn.style.background = color;
        btn.style.color = C.dark;
    });
    btn.addEventListener('mouseleave', () => {
        btn.style.background = 'transparent';
        btn.style.color = color;
    });
    btn.addEventListener('click', (e) => {
        e.stopPropagation();
        onClick();
    });
    return btn;
}

/* ------------------------------------------
   ADD / EDIT MODAL
------------------------------------------ */
function showAddEditModal(container, employee) {
    const isEdit = !!employee;
    const title  = isEdit ? `EDIT EMPLOYEE: ${employee.firstName} ${employee.lastName}` : 'ADD NEW EMPLOYEE';

    // Default values
    const vals = isEdit ? { ...employee } : {
        firstName: '', lastName: '', roles: ['server'],
        payRate: 15.00, isTipped: true, status: 'active',
        hireDate: new Date().toISOString().split('T')[0],
        termDate: '', termReason: '', notes: '',
    };

    // ── Backdrop ──
    const backdrop = document.createElement('div');
    backdrop.style.cssText = `
        position: fixed; inset: 0; z-index: 5000;
        background: ${C.backdrop}; display: flex;
        align-items: center; justify-content: center;
        animation: modalFadeIn 0.25s ease-out;
    `;

    // ── Modal Card ──
    const modal = document.createElement('div');
    modal.style.cssText = `
        background: ${C.dark}; border: 1px solid ${C.mintBorder};
        border-radius: 12px; padding: 0; width: 720px; max-width: 95vw;
        max-height: 90vh; overflow-y: auto;
        animation: modalSlideIn 0.25s ease-out;
    `;

    // ── Header ──
    const modalHeader = document.createElement('div');
    modalHeader.style.cssText = `
        padding: 20px 24px; border-bottom: 1px solid ${C.mintBorder};
        font-family: var(--font-display, 'Alien Encounters', monospace);
        font-size: 26px; color: ${C.yellow}; letter-spacing: 1px;
    `;
    modalHeader.textContent = title;
    modal.appendChild(modalHeader);

    // ── Form Body ──
    const form = document.createElement('div');
    form.style.cssText = 'padding: 24px;';

    // Name fields (side by side)
    form.appendChild(buildFieldRow([
        buildTextField('First Name *', 'emp-first', vals.firstName),
        buildTextField('Last Name *', 'emp-last', vals.lastName),
    ]));

    // Role checkboxes (multi-select)
    const roleWrap = document.createElement('div');
    roleWrap.style.cssText = 'margin-bottom: 16px;';
    const roleLabel = document.createElement('div');
    roleLabel.style.cssText = `${fieldLabelStyle}`;
    roleLabel.textContent = 'Roles';
    roleWrap.appendChild(roleLabel);
    const roleGrid = document.createElement('div');
    roleGrid.id = 'emp-roles';
    roleGrid.style.cssText = 'display: flex; flex-wrap: wrap; gap: 8px;';
    const currentRoles = vals.roles || [];
    ROLES.forEach(r => {
        const chip = document.createElement('label');
        const checked = currentRoles.includes(r.id);
        chip.style.cssText = `
            display: inline-flex; align-items: center; gap: 6px;
            padding: 8px 14px; border-radius: 6px; cursor: pointer;
            background: ${checked ? 'rgba(var(--color-mint-rgb), 0.2)' : 'var(--color-bg-dark)'};
            border: 1px solid ${checked ? 'var(--color-mint)' : 'rgba(var(--color-mint-rgb), 0.15)'};
            color: var(--color-mint); font-family: var(--font-body); font-size: 20px;
            transition: all 0.15s ease;
        `;
        const cb = document.createElement('input');
        cb.type = 'checkbox';
        cb.value = r.id;
        cb.checked = checked;
        cb.style.cssText = 'accent-color: var(--color-mint); width: 18px; height: 18px;';
        cb.addEventListener('change', () => {
            chip.style.background = cb.checked ? 'rgba(var(--color-mint-rgb), 0.2)' : 'var(--color-bg-dark)';
            chip.style.borderColor = cb.checked ? 'var(--color-mint)' : 'rgba(var(--color-mint-rgb), 0.15)';
        });
        chip.appendChild(cb);
        chip.appendChild(document.createTextNode(r.label));
        roleGrid.appendChild(chip);
    });
    roleWrap.appendChild(roleGrid);
    form.appendChild(roleWrap);

    // Pay Rate + Tipped (side by side)
    form.appendChild(buildFieldRow([
        buildTextField('Pay Rate ($/hr)', 'emp-rate', vals.payRate.toFixed(2), 'number'),
        buildRadioField('Tipped', 'emp-tipped', vals.isTipped ? 'yes' : 'no', [
            { value: 'yes', label: 'Yes' },
            { value: 'no',  label: 'No' },
        ]),
    ]));

    // PIN (only for new employees)
    if (!isEdit) {
        form.appendChild(buildTextField('PIN Code (4–6 digits)', 'emp-pin', '', 'password'));
    }

    // Status
    form.appendChild(buildRadioField('Status', 'emp-status', vals.status, [
        { value: 'active',         label: 'Active' },
        { value: 'inactive',       label: 'Inactive' },
        { value: 'do_not_rehire',  label: 'Do Not Rehire' },
    ]));

    // Hire Date
    form.appendChild(buildTextField('Hire Date', 'emp-hire', vals.hireDate, 'date'));

    // Conditional: Term Date + Reason (visible when inactive/DNR)
    const termSection = document.createElement('div');
    termSection.id = 'emp-term-section';
    termSection.style.cssText = vals.status !== 'active'
        ? 'margin-top: 4px;'
        : 'display: none; margin-top: 4px;';
    termSection.appendChild(buildTextField('Termination Date', 'emp-term-date', vals.termDate || '', 'date'));
    termSection.appendChild(buildTextArea('Reason', 'emp-term-reason', vals.termReason || ''));
    form.appendChild(termSection);

    // Notes
    form.appendChild(buildTextArea('Notes', 'emp-notes', vals.notes || ''));

    modal.appendChild(form);

    // ── Footer Buttons ──
    const footer = document.createElement('div');
    footer.style.cssText = `
        padding: 16px 24px; border-top: 1px solid ${C.mintBorder};
        display: flex; justify-content: flex-end; gap: 12px;
    `;

    const cancelBtn = document.createElement('button');
    cancelBtn.textContent = 'Cancel';
    cancelBtn.style.cssText = `
        background: transparent; color: ${C.grey}; border: 1px solid ${C.grey};
        padding: 12px 28px; border-radius: 8px; font-size: 25px; cursor: pointer;
        font-family: var(--font-body, 'Sevastopol Interface', Arial, sans-serif);
        transition: all 0.2s ease;
    `;
    cancelBtn.addEventListener('click', () => backdrop.remove());

    const saveBtn = document.createElement('button');
    saveBtn.textContent = isEdit ? 'Save Changes' : 'Add Employee';
    saveBtn.style.cssText = `
        background: ${C.mint}; color: ${C.dark}; border: none;
        padding: 12px 28px; border-radius: 8px; font-size: 25px; cursor: pointer;
        font-family: var(--font-body, 'Sevastopol Interface', Arial, sans-serif);
        font-weight: bold; transition: all 0.2s ease;
    `;
    saveBtn.addEventListener('mouseenter', () => saveBtn.style.background = '#d4ffca');
    saveBtn.addEventListener('mouseleave', () => saveBtn.style.background = C.mint);
    saveBtn.addEventListener('click', () => handleSave(isEdit, employee, backdrop));

    footer.appendChild(cancelBtn);
    footer.appendChild(saveBtn);
    modal.appendChild(footer);

    backdrop.appendChild(modal);

    // Close on backdrop click
    backdrop.addEventListener('click', (e) => {
        if (e.target === backdrop) backdrop.remove();
    });

    // Escape key closes modal
    const escHandler = (e) => {
        if (e.key === 'Escape') { backdrop.remove(); document.removeEventListener('keydown', escHandler); }
    };
    document.addEventListener('keydown', escHandler);

    container.appendChild(backdrop);

    // Wire up status radio to show/hide term fields
    setTimeout(() => {
        const statusRadios = backdrop.querySelectorAll('input[name="emp-status"]');
        statusRadios.forEach(r => {
            r.addEventListener('change', () => {
                const section = backdrop.querySelector('#emp-term-section');
                section.style.display = r.value !== 'active' ? 'block' : 'none';
            });
        });
    }, 0);
}

/* ------------------------------------------
   SAVE HANDLER (Add / Edit)
------------------------------------------ */
async function handleSave(isEdit, original, backdrop) {
    // Read form values
    const firstName  = (backdrop.querySelector('#emp-first')?.value || '').trim();
    const lastName   = (backdrop.querySelector('#emp-last')?.value || '').trim();
    const roles      = [...backdrop.querySelectorAll('#emp-roles input:checked')].map(cb => cb.value);
    if (roles.length === 0) roles.push('server');
    const payRate    = parseFloat(backdrop.querySelector('#emp-rate')?.value) || 0;
    const isTipped   = backdrop.querySelector('input[name="emp-tipped"]:checked')?.value === 'yes';
    const status     = backdrop.querySelector('input[name="emp-status"]:checked')?.value || 'active';
    const hireDate   = backdrop.querySelector('#emp-hire')?.value || '';
    const termDate   = backdrop.querySelector('#emp-term-date')?.value || '';
    const termReason = backdrop.querySelector('#emp-term-reason')?.value || '';
    const notes      = backdrop.querySelector('#emp-notes')?.value || '';

    // ── Validation ──
    if (!firstName || !lastName) {
        showToast('First and last name are required.', 'error');
        return;
    }

    let newPin = '';
    if (!isEdit) {
        newPin = backdrop.querySelector('#emp-pin')?.value || '';
        if (newPin.length < 4 || newPin.length > 6 || !/^\d+$/.test(newPin)) {
            showToast('PIN must be 4–6 digits.', 'error');
            return;
        }
    }

    if (isEdit) {
        // ── Update existing ──
        const idx = employees.findIndex(e => e.id === original.id);
        if (idx === -1) return;

        const changedFields = {};
        if (employees[idx].firstName !== firstName) changedFields.firstName = { old: employees[idx].firstName, new: firstName };
        if (employees[idx].lastName !== lastName)   changedFields.lastName  = { old: employees[idx].lastName, new: lastName };
        if (JSON.stringify(employees[idx].roles) !== JSON.stringify(roles)) changedFields.roles = { old: employees[idx].roles, new: roles };
        if (employees[idx].payRate !== payRate)      changedFields.payRate   = { old: employees[idx].payRate, new: payRate };
        if (employees[idx].isTipped !== isTipped)    changedFields.isTipped  = { old: employees[idx].isTipped, new: isTipped };

        const oldStatus = employees[idx].status;

        Object.assign(employees[idx], {
            firstName, lastName, roles, payRate, isTipped,
            status, hireDate, termDate: status !== 'active' ? termDate : null,
            termReason: status !== 'active' ? termReason : null, notes,
        });

        // Emit full employee snapshot as update event
        emitEvent('employee.updated', {
            employee_id: original.id,
            first_name: firstName,
            last_name: lastName,
            display_name: `${firstName} ${lastName}`,
            role_ids: roles,
            hourly_rate: payRate,
            active: status === 'active',
        });

        showToast(`${firstName} ${lastName} updated successfully`, 'success');
    } else {
        // ── Create new ──
        const newEmp = {
            id: generateEmployeeId(firstName),
            firstName, lastName, roles, pinHash: '••••',
            payRate, isTipped, hireDate, status,
            termDate: null, termReason: null, notes,
        };
        employees.push(newEmp);

        emitEvent('employee.created', {
            employee_id: newEmp.id,
            first_name: firstName,
            last_name: lastName,
            display_name: `${firstName} ${lastName}`,
            role_ids: roles,
            hourly_rate: payRate,
            pin: newPin,
            active: status === 'active',
        });

        showToast(`${firstName} ${lastName} added successfully`, 'success');
    }

    await flushEvents();
    backdrop.remove();
    refreshTable();
}

/* ------------------------------------------
   PIN RESET MODAL (Step 1: Confirmation)
------------------------------------------ */
function showPINResetModal(container, employee) {
    const backdrop = document.createElement('div');
    backdrop.style.cssText = `
        position: fixed; inset: 0; z-index: 5000;
        background: ${C.backdrop}; display: flex;
        align-items: center; justify-content: center;
        animation: modalFadeIn 0.25s ease-out;
    `;

    const modal = document.createElement('div');
    modal.style.cssText = `
        background: ${C.dark}; border: 1px solid ${C.mintBorder};
        border-radius: 12px; width: 420px; max-width: 95vw;
        animation: modalSlideIn 0.25s ease-out;
    `;

    // Header
    const header = document.createElement('div');
    header.style.cssText = `
        padding: 20px 24px; border-bottom: 1px solid ${C.mintBorder};
        font-family: var(--font-display, 'Alien Encounters', monospace);
        font-size: 26px; color: ${C.yellow}; letter-spacing: 1px;
    `;
    header.textContent = `RESET PIN: ${employee.firstName} ${employee.lastName}`;
    modal.appendChild(header);

    // Body
    const body = document.createElement('div');
    body.style.cssText = 'padding: 24px;';

    body.innerHTML = `
        <div style="color: ${C.mint}; font-size: 25px; margin-bottom: 20px;">
            Generate new PIN for this employee?
        </div>
    `;

    // Radio: Random vs Custom
    body.appendChild(buildRadioField('', 'pin-method', 'random', [
        { value: 'random', label: 'Generate random 4-digit PIN' },
        { value: 'custom', label: 'Let me set custom PIN' },
    ]));

    // Custom PIN input (hidden by default)
    const customWrap = document.createElement('div');
    customWrap.id = 'pin-custom-wrap';
    customWrap.style.cssText = 'display: none; margin: 8px 0 16px 0;';
    customWrap.appendChild(buildTextField('', 'pin-custom', '', 'password'));
    body.appendChild(customWrap);

    // Force change checkbox
    const forceWrap = document.createElement('div');
    forceWrap.style.cssText = 'margin: 16px 0;';
    forceWrap.innerHTML = `
        <label style="color: ${C.mint}; font-size: 22px; cursor: pointer; display: flex; align-items: center; gap: 8px;">
            <input type="checkbox" id="pin-force-change" checked
                   style="width: 16px; height: 16px; accent-color: ${C.mint};" />
            Force employee to change PIN on next login
        </label>
    `;
    body.appendChild(forceWrap);

    // Warning
    const warning = document.createElement('div');
    warning.style.cssText = `
        color: ${C.orange}; font-size: 20px; margin-top: 16px;
        padding: 12px; background: rgba(255, 165, 0, 0.08);
        border: 1px solid rgba(255, 165, 0, 0.2); border-radius: 8px;
    `;
    warning.textContent = 'New PIN will be displayed once and cannot be recovered. Write it down.';
    body.appendChild(warning);

    modal.appendChild(body);

    // Footer
    const footer = document.createElement('div');
    footer.style.cssText = `
        padding: 16px 24px; border-top: 1px solid ${C.mintBorder};
        display: flex; justify-content: flex-end; gap: 12px;
    `;

    const cancelBtn = document.createElement('button');
    cancelBtn.textContent = 'Cancel';
    cancelBtn.style.cssText = `
        background: transparent; color: ${C.grey}; border: 1px solid ${C.grey};
        padding: 12px 28px; border-radius: 8px; font-size: 25px; cursor: pointer;
        font-family: var(--font-body, 'Sevastopol Interface', Arial, sans-serif);
    `;
    cancelBtn.addEventListener('click', () => backdrop.remove());

    const resetBtn = document.createElement('button');
    resetBtn.textContent = 'Reset PIN';
    resetBtn.style.cssText = `
        background: ${C.yellow}; color: ${C.dark}; border: none;
        padding: 12px 28px; border-radius: 8px; font-size: 25px; cursor: pointer;
        font-family: var(--font-body, 'Sevastopol Interface', Arial, sans-serif);
        font-weight: bold;
    `;
    resetBtn.addEventListener('click', () => {
        const method = backdrop.querySelector('input[name="pin-method"]:checked')?.value;
        let newPIN;

        if (method === 'custom') {
            const val = backdrop.querySelector('#pin-custom')?.value || '';
            if (val.length < 4 || val.length > 6 || !/^\d+$/.test(val)) {
                showToast('Custom PIN must be 4–6 digits.', 'error');
                return;
            }
            newPIN = val;
        } else {
            newPIN = generatePIN();
        }

        const forceChange = backdrop.querySelector('#pin-force-change')?.checked ?? true;

        emitEvent('employee.updated', {
            employee_id: employee.id,
            new_pin_hash: 'SHA256_SIMULATED',
            force_change_on_login: forceChange,
            reset_reason: 'Manager-initiated reset',
        });

        backdrop.remove();
        showPINDisplayModal(container, employee, newPIN, forceChange);
    });

    footer.appendChild(cancelBtn);
    footer.appendChild(resetBtn);
    modal.appendChild(footer);

    backdrop.appendChild(modal);
    backdrop.addEventListener('click', (e) => { if (e.target === backdrop) backdrop.remove(); });

    const escHandler = (e) => {
        if (e.key === 'Escape') { backdrop.remove(); document.removeEventListener('keydown', escHandler); }
    };
    document.addEventListener('keydown', escHandler);

    container.appendChild(backdrop);

    // Wire radio toggle for custom PIN field
    setTimeout(() => {
        const radios = backdrop.querySelectorAll('input[name="pin-method"]');
        radios.forEach(r => {
            r.addEventListener('change', () => {
                const wrap = backdrop.querySelector('#pin-custom-wrap');
                wrap.style.display = r.value === 'custom' ? 'block' : 'none';
            });
        });
    }, 0);
}

/* ------------------------------------------
   PIN DISPLAY MODAL (Step 2: One-time show)
------------------------------------------ */
function showPINDisplayModal(container, employee, pin, forceChange) {
    const backdrop = document.createElement('div');
    backdrop.style.cssText = `
        position: fixed; inset: 0; z-index: 5000;
        background: ${C.backdrop}; display: flex;
        align-items: center; justify-content: center;
        animation: modalFadeIn 0.25s ease-out;
    `;

    const modal = document.createElement('div');
    modal.style.cssText = `
        background: ${C.dark}; border: 1px solid ${C.green};
        border-radius: 12px; width: 400px; max-width: 95vw;
        text-align: center; animation: modalSlideIn 0.25s ease-out;
    `;

    // Header
    const header = document.createElement('div');
    header.style.cssText = `
        padding: 20px 24px; border-bottom: 1px solid ${C.mintBorder};
        font-family: var(--font-display, 'Alien Encounters', monospace);
        font-size: 26px; color: ${C.green}; letter-spacing: 1px;
    `;
    header.textContent = 'PIN RESET SUCCESSFUL';
    modal.appendChild(header);

    // Body
    const body = document.createElement('div');
    body.style.cssText = 'padding: 32px 24px;';

    body.innerHTML = `
        <div style="color: ${C.mint}; font-size: 25px; margin-bottom: 20px;">
            New PIN for ${employee.firstName} ${employee.lastName}:
        </div>
        <div style="background: rgba(0, 255, 0, 0.08); border: 2px solid ${C.green};
                    border-radius: 12px; padding: 20px; display: inline-block;
                    margin-bottom: 20px; cursor: pointer;"
             id="pin-display-box"
             title="Click to copy">
            <span style="font-family: var(--font-display, 'Alien Encounters', monospace);
                         font-size: 42px; color: ${C.green}; letter-spacing: 12px;">
                ${pin}
            </span>
        </div>
        <div style="color: ${C.orange}; font-size: 22px; font-weight: bold;
                    margin-bottom: 8px;">
            ⚠ WRITE THIS DOWN NOW
        </div>
        <div style="color: ${C.grey}; font-size: 20px; margin-bottom: 8px;">
            This will not be shown again.
        </div>
        ${forceChange ? `<div style="color: rgba(var(--color-mint-rgb), 0.6); font-size: 20px;">
            Employee must change PIN on next login.
        </div>` : ''}
    `;
    modal.appendChild(body);

    // Footer
    const footer = document.createElement('div');
    footer.style.cssText = `
        padding: 16px 24px; border-top: 1px solid ${C.mintBorder};
        display: flex; justify-content: center;
    `;

    const closeBtn = document.createElement('button');
    closeBtn.textContent = 'Close';
    closeBtn.style.cssText = `
        background: ${C.mint}; color: ${C.dark}; border: none;
        padding: 12px 40px; border-radius: 8px; font-size: 25px; cursor: pointer;
        font-family: var(--font-body, 'Sevastopol Interface', Arial, sans-serif);
        font-weight: bold;
    `;
    closeBtn.addEventListener('click', async () => {
        await flushEvents();
        backdrop.remove();
        showToast(`PIN reset for ${employee.firstName} ${employee.lastName}`, 'success');
    });
    footer.appendChild(closeBtn);
    modal.appendChild(footer);

    backdrop.appendChild(modal);
    container.appendChild(backdrop);

    // Click PIN box to copy
    setTimeout(() => {
        const box = backdrop.querySelector('#pin-display-box');
        if (box) {
            box.addEventListener('click', () => {
                navigator.clipboard?.writeText(pin).then(() => {
                    showToast('PIN copied to clipboard', 'info');
                }).catch(() => {});
            });
        }
    }, 0);
}

/* ------------------------------------------
   FORM FIELD BUILDERS
   (Match modal styling patterns)
------------------------------------------ */
const fieldLabelStyle = `
    font-size: 20px; color: ${C.mintFaded};
    text-transform: uppercase; letter-spacing: 0.5px;
    margin-bottom: 6px; display: block;
`;

const inputStyle = `
    width: 100%; box-sizing: border-box;
    background: var(--color-bg-dark);
    border: 1px solid ${C.mintBorder}; color: ${C.mint};
    padding: 12px 14px; border-radius: 6px; font-size: 25px;
    font-family: var(--font-body, 'Sevastopol Interface', Arial, sans-serif);
    outline: none; transition: border-color 0.2s ease;
    color-scheme: dark;
`;

function buildTextField(label, id, value, type = 'text') {
    const wrap = document.createElement('div');
    wrap.style.cssText = 'margin-bottom: 16px; flex: 1; min-width: 140px;';
    wrap.innerHTML = `
        ${label ? `<label for="${id}" style="${fieldLabelStyle}">${label}</label>` : ''}
        <input type="${type}" id="${id}" value="${value}" style="${inputStyle}"
               ${type === 'number' ? 'step="0.50" min="0"' : ''}
               ${type === 'password' ? 'maxlength="6"' : ''} />
    `;
    // Focus glow
    setTimeout(() => {
        const inp = wrap.querySelector('input');
        if (inp) {
            inp.addEventListener('focus', () => inp.style.borderColor = C.mint);
            inp.addEventListener('blur', () => inp.style.borderColor = C.mintBorder);
        }
    }, 0);
    return wrap;
}

function buildTextArea(label, id, value) {
    const wrap = document.createElement('div');
    wrap.style.cssText = 'margin-bottom: 16px;';
    wrap.innerHTML = `
        <label for="${id}" style="${fieldLabelStyle}">${label}</label>
        <textarea id="${id}" rows="3" style="${inputStyle} resize: vertical;">${value}</textarea>
    `;
    setTimeout(() => {
        const ta = wrap.querySelector('textarea');
        if (ta) {
            ta.addEventListener('focus', () => ta.style.borderColor = C.mint);
            ta.addEventListener('blur', () => ta.style.borderColor = C.mintBorder);
        }
    }, 0);
    return wrap;
}

function buildSelectField(label, id, value, options) {
    const wrap = document.createElement('div');
    wrap.style.cssText = 'margin-bottom: 16px;';
    const optionsHTML = options.map(o =>
        `<option value="${o.value}" ${o.value === value ? 'selected' : ''}>${o.label}</option>`
    ).join('');
    wrap.innerHTML = `
        <label for="${id}" style="${fieldLabelStyle}">${label}</label>
        <select id="${id}" style="${inputStyle} cursor: pointer; appearance: auto;">
            ${optionsHTML}
        </select>
    `;
    return wrap;
}

function buildRadioField(label, name, value, options) {
    const wrap = document.createElement('div');
    wrap.style.cssText = 'margin-bottom: 16px;';
    if (label) {
        wrap.innerHTML = `<div style="${fieldLabelStyle}">${label}</div>`;
    }
    const radioWrap = document.createElement('div');
    radioWrap.style.cssText = 'display: flex; gap: 16px; flex-wrap: wrap;';

    options.forEach(opt => {
        const lbl = document.createElement('label');
        lbl.style.cssText = `
            color: ${C.mint}; font-size: 22px; cursor: pointer;
            display: flex; align-items: center; gap: 6px;
        `;
        lbl.innerHTML = `
            <input type="radio" name="${name}" value="${opt.value}"
                   ${opt.value === value ? 'checked' : ''}
                   style="accent-color: ${C.mint}; width: 15px; height: 15px;" />
            ${opt.label}
        `;
        radioWrap.appendChild(lbl);
    });
    wrap.appendChild(radioWrap);
    return wrap;
}

function buildFieldRow(fields) {
    const row = document.createElement('div');
    row.style.cssText = 'display: flex; gap: 16px;';
    fields.forEach(f => row.appendChild(f));
    return row;
}

/* ------------------------------------------
   PLACEHOLDER BUILDER (for unbuilt subsections)
------------------------------------------ */
function buildPlaceholder(container, title, subtitle, items) {
    const wrapper = document.createElement('div');
    wrapper.style.cssText = 'padding: 0 8px; max-width: 900px; margin: 0 auto;';

    wrapper.innerHTML = `
        <div style="font-family: var(--font-display, 'Alien Encounters', monospace);
                    font-size: 36px; color: ${C.yellow}; margin-bottom: 8px;">
            ${title}
        </div>
        <div style="font-size: 25px; color: rgba(var(--color-mint-rgb), 0.5); margin-bottom: 32px;">
            ${subtitle}
        </div>
        <div style="background: rgba(var(--color-mint-rgb), 0.04); border: 1px solid ${C.mintBorder};
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

/* ------------------------------------------
   CSS ANIMATIONS (injected once)
------------------------------------------ */
function injectStyles() {
    if (document.getElementById('emp-mgmt-styles')) return;
    const style = document.createElement('style');
    style.id = 'emp-mgmt-styles';
    style.textContent = `
        @keyframes modalFadeIn {
            from { opacity: 0; }
            to   { opacity: 1; }
        }
        @keyframes modalSlideIn {
            from { opacity: 0; transform: translateY(-20px) scale(0.98); }
            to   { opacity: 1; transform: translateY(0) scale(1); }
        }
        @keyframes toastSlideIn {
            from { opacity: 0; transform: translateX(40px); }
            to   { opacity: 1; transform: translateX(0); }
        }
        @keyframes toastSlideOut {
            from { opacity: 1; transform: translateX(0); }
            to   { opacity: 0; transform: translateX(40px); }
        }
    `;
    document.head.appendChild(style);
}

/* ==========================================
   SCENE REGISTRATION
   Called from app.js:
     import { registerEmployeeSections } from './sections/employees.js';
     registerEmployeeSections(sceneManager);
   ========================================== */
export function registerEmployeeSections(sceneManager) {
    injectStyles();

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