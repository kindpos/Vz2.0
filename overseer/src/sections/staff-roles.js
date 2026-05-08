/* ============================================
   KINDpos Overseer — Staff Roles (Nostalgia)

   Role management page under STAFF. Lists all roles as cards
   (name, color, tipped badge, default rate, permission summary)
   and lets managers create / edit / delete roles.

   Data flow:
     GET  /api/v1/config/roles         (projection read)
     POST /api/v1/config/push          (employee.role_* events)

   Payload shape is a superset of the backend Role model:
     role_id, name, color, description, default_hourly_rate,
     permission_level, permissions,
     tipout_eligible, can_receive_tips, can_be_tipped_out_to.

   The `color`, `description`, and `default_hourly_rate` fields
   are frontend-display today — the backend ignores / round-trips
   them via the flexible Dict projection. If the backend tightens
   its Role schema, those extras move into a sibling event.

   "Nice. Dependable. Yours."
   ============================================ */

import { T, withAlpha } from '../ui/tokens.js';
import {
    buildScenePage, sectionCard, button, field, numberField,
    chipGroup, checkboxChip, openModal, showToast, colorPicker,
} from '../ui/forms.js';
import { pushChanges } from '../services/config-push.js';
import { loadEmployeeData } from '../data/sample-employees.js';

/* ------------------------------------------
   MODULE STATE
------------------------------------------ */
let _container = null;
let _roles = [];

/* ------------------------------------------
   CONSTANTS
------------------------------------------ */
const PERMISSION_LEVELS = ['Standard', 'Elevated', 'Manager'];

// Curated palette for role identity colors.
const ROLE_COLORS = [
    '#38bdf8', // sky
    '#34d399', // emerald
    '#f472b6', // pink
    '#f97316', // orange
    T.gold,
    T.cyan,
    T.lavender,
    T.green,
];

// Individual permission toggles. Keys land in the backend's
// Dict[str, bool] permissions map verbatim.
const PERMISSION_DEFS = [
    { key: 'access_configuration', label: 'Access Overseer (configuration)' },
    { key: 'allow_voids',          label: 'Allow voids' },
    { key: 'allow_discounts',      label: 'Allow discounts' },
    { key: 'close_checks',         label: 'Close own checks' },
    { key: 'view_reports',         label: 'View sales reports' },
    { key: 'edit_menu',            label: 'Edit menu & pricing' },
    { key: 'reset_pins',           label: 'Reset employee PINs' },
];

/* ------------------------------------------
   LOAD
------------------------------------------ */
const loadRoles = async () => {
    try {
        const res = await fetch('/api/v1/config/roles');
        if (res.ok) {
            const data = await res.json();
            _roles = Array.isArray(data) ? data : [];
        } else {
            _roles = [];
        }
    } catch (e) {
        console.warn('[Staff Roles] load failed:', e);
        _roles = [];
    }
}

const _newRoleId = () => 'role_' + Math.random().toString(36).slice(2, 10);
;

const _permissionCount = (role) => {
    const p = role.permissions || {};
    return Object.values(p).filter(Boolean).length;
}

/* ------------------------------------------
   ROLE CARD
   One tile per role — name in role color, permission level chip,
   tipped dot, default rate, permission count. Click → edit.
------------------------------------------ */
const buildRoleCard = (role) => {
    const card = document.createElement('button');
    card.type = 'button';
    card.style.cssText = `
        background: ${T.card};
        border: 1px solid ${T.border};
        border-left: 4px solid ${role.color || T.green};
        border-radius: ${T.r.md}px;
        padding: ${T.sp.lg}px ${T.sp.lg + 2}px;
        cursor: pointer;
        text-align: left;
        display: flex; flex-direction: column; gap: ${T.sp.sm}px;
        transition: transform 0.1s ease, border-color 0.15s ease;
    `;
    card.addEventListener('mouseenter', () => {
        card.style.transform = 'translateY(-1px)';
        card.style.borderColor = withAlpha(T.text, 0.18);
    });
    card.addEventListener('mouseleave', () => {
        card.style.transform = '';
        card.style.borderColor = T.border;
    });
    card.addEventListener('click', () => openRoleModal(role));

    // Header row: name + permission level pill
    const head = document.createElement('div');
    head.style.cssText = `
        display: flex; justify-content: space-between; align-items: center;
        gap: ${T.sp.sm}px;
    `;
    const name = document.createElement('div');
    name.style.cssText = `
        color: ${role.color || T.text};
        font-family: ${T.font.heading};
        font-size: ${T.fs.xl - 2}px;
        font-weight: 700;
        letter-spacing: 0.3px;
    `;
    name.textContent = role.name || '(unnamed)';
    head.appendChild(name);

    const level = document.createElement('div');
    level.style.cssText = `
        font-family: ${T.font.mono};
        font-size: ${T.fs.xs}px;
        letter-spacing: 1.5px;
        font-weight: 700;
        text-transform: uppercase;
        color: ${T.textMuted};
        background: ${T.well};
        padding: 2px 8px;
        border-radius: 999px;
    `;
    level.textContent = role.permission_level || 'Standard';
    head.appendChild(level);
    card.appendChild(head);

    // Description (optional)
    if (role.description) {
        const desc = document.createElement('div');
        desc.style.cssText = `
            color: ${T.textMuted};
            font-size: ${T.fs.base}px;
            line-height: 1.45;
        `;
        desc.textContent = role.description;
        card.appendChild(desc);
    }

    // Meta row: tipped / rate / perm count
    const meta = document.createElement('div');
    meta.style.cssText = `
        display: flex; gap: ${T.sp.md}px; flex-wrap: wrap;
        margin-top: ${T.sp.xs}px;
        font-family: ${T.font.mono};
        font-size: ${T.fs.sm}px;
        letter-spacing: 1px;
        color: ${T.textMuted};
        text-transform: uppercase;
    `;
    const tipped = role.tipout_eligible !== false;
    meta.appendChild(_metaItem(tipped ? 'TIPPED' : 'NOT TIPPED',
                                tipped ? T.green : T.textDim));
    if (role.default_hourly_rate != null) {
        meta.appendChild(_metaItem(`$${Number(role.default_hourly_rate).toFixed(2)}/HR`, T.gold));
    }
    const pCount = _permissionCount(role);
    if (pCount > 0) {
        meta.appendChild(_metaItem(`${pCount} OVERRIDES`, T.lavender));
    }
    card.appendChild(meta);

    return card;
}

const _metaItem = (text, color) => {
    const span = document.createElement('span');
    span.textContent = text;
    span.style.color = color;
    span.style.fontWeight = '700';
    return span;
}

/* ------------------------------------------
   RENDER
------------------------------------------ */
const renderRoles = async (wrapper) => {
    wrapper.innerHTML = '';

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
    loading.textContent = 'Loading roles...';
    wrapper.appendChild(loading);

    await loadRoles();
    wrapper.innerHTML = '';

    const card = sectionCard({
        label: 'Roles',
        accent: T.green,
        note: 'Roles define what each staff member can do. Each employee can hold multiple roles; permissions combine across them.',
    });

    // Toolbar: count + add button
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
    const n = _roles.length;
    hint.textContent = `${n} role${n === 1 ? '' : 's'}`;
    toolbar.appendChild(hint);
    toolbar.appendChild(button({
        label: '+ New Role',
        variant: 'primary',
        onClick: () => openRoleModal(null),
    }));
    card.body.appendChild(toolbar);

    // Card grid
    if (_roles.length === 0) {
        const empty = document.createElement('div');
        empty.style.cssText = `
            padding: ${T.sp.xxxl}px;
            text-align: center;
            color: ${T.textMuted};
            font-size: ${T.fs.base}px;
            background: ${T.well};
            border-radius: ${T.r.sm}px;
        `;
        empty.textContent = 'No roles yet. Click "+ New Role" to create one.';
        card.body.appendChild(empty);
    } else {
        const grid = document.createElement('div');
        grid.style.cssText = `
            display: grid;
            grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
            gap: ${T.sp.md}px;
        `;
        _roles.forEach(role => grid.appendChild(buildRoleCard(role)));
        card.body.appendChild(grid);
    }

    wrapper.appendChild(card.card);
}

/* ==========================================
   ROLE EDIT MODAL
   Two-tab form: Details + Permissions. Emits
   employee.role_created / role_updated on save,
   employee.role_deleted on delete.
   ========================================== */
const openRoleModal = (role) => {
    const isEdit = !!role;
    const draft = {
        role_id:     isEdit ? role.role_id : _newRoleId(),
        name:        isEdit ? (role.name || '') : '',
        color:       isEdit ? (role.color || T.green) : T.green,
        description: isEdit ? (role.description || '') : '',
        default_hourly_rate: isEdit
            ? (role.default_hourly_rate != null ? Number(role.default_hourly_rate) : 15.00)
            : 15.00,
        permission_level: isEdit ? (role.permission_level || 'Standard') : 'Standard',
        permissions: Object.assign({}, (isEdit && role.permissions) || {}),
        tipout_eligible:        isEdit ? (role.tipout_eligible !== false)        : true,
        can_receive_tips:       isEdit ? (role.can_receive_tips !== false)       : true,
        can_be_tipped_out_to:   isEdit ? (role.can_be_tipped_out_to !== false)   : true,
        service_types: isEdit
            ? (role.service_types || ['full_service'])
            : ['full_service'],
    };

    const content = document.createElement('div');
    content.style.cssText = 'display: flex; flex-direction: column; gap: 16px;';

    // Tab strip (Details / Permissions)
    const tabs = document.createElement('div');
    tabs.style.cssText = `
        display: flex; gap: ${T.sp.xs + 2}px;
        border-bottom: 1px solid ${T.well};
        margin-bottom: ${T.sp.sm}px;
    `;
    const tabBtns = {};
    const tabPanels = {};

    function makeTab(id, label) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.textContent = label;
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
        btn.addEventListener('click', () => activateTab(id));
        return btn;
    }

    function activateTab(id) {
        Object.entries(tabBtns).forEach(([tid, b]) => {
            const on = tid === id;
            b.style.color = on ? T.green : T.textMuted;
            b.style.borderBottomColor = on ? T.green : 'transparent';
        });
        Object.entries(tabPanels).forEach(([tid, p]) => {
            p.style.display = tid === id ? 'flex' : 'none';
        });
    }

    tabBtns.details     = makeTab('details', 'Details');
    tabBtns.permissions = makeTab('permissions', 'Permissions');
    tabs.appendChild(tabBtns.details);
    tabs.appendChild(tabBtns.permissions);
    content.appendChild(tabs);

    // ── Details tab ──
    const detailsPanel = document.createElement('div');
    detailsPanel.style.cssText = 'display: flex; flex-direction: column; gap: 16px;';

    const nameF = field({ label: 'Role name', value: draft.name, required: true });
    nameF.input.addEventListener('input', () => { draft.name = nameF.input.value; });
    detailsPanel.appendChild(nameF.wrap);

    // Color picker (wrapped with label caption)
    const colorWrap = document.createElement('div');
    colorWrap.style.cssText = 'display: flex; flex-direction: column; gap: 6px;';
    const colorLbl = document.createElement('div');
    colorLbl.style.cssText = `
        font-family: ${T.font.body};
        font-size: ${T.fs.base}px;
        color: ${T.textMuted};
        font-weight: 600;
        letter-spacing: 0.3px;
    `;
    colorLbl.textContent = 'Role color';
    colorWrap.appendChild(colorLbl);
    const colorP = colorPicker({
        colors: ROLE_COLORS,
        selected: draft.color,
        onChange: (hex) => { draft.color = hex; },
    });
    colorWrap.appendChild(colorP.wrap);
    detailsPanel.appendChild(colorWrap);

    // Description (local textarea)
    const descWrap = document.createElement('div');
    descWrap.style.cssText = 'display: flex; flex-direction: column; gap: 6px;';
    const descLbl = document.createElement('label');
    descLbl.style.cssText = `
        font-family: ${T.font.body};
        font-size: ${T.fs.base}px;
        color: ${T.textMuted};
        font-weight: 600;
        letter-spacing: 0.3px;
    `;
    descLbl.textContent = 'Description';
    descWrap.appendChild(descLbl);
    const descTa = document.createElement('textarea');
    descTa.rows = 2;
    descTa.value = draft.description;
    descTa.style.cssText = `
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
    descTa.addEventListener('focus', () => descTa.style.borderColor = T.gold);
    descTa.addEventListener('blur',  () => descTa.style.borderColor = T.border);
    descTa.addEventListener('input', () => { draft.description = descTa.value; });
    descWrap.appendChild(descTa);
    detailsPanel.appendChild(descWrap);

    const rateF = numberField({
        label: 'Default hourly rate',
        value: draft.default_hourly_rate,
        min: 0,
        step: 0.5,
        suffix: '$/hr',
    });
    rateF.input.addEventListener('input', () => {
        draft.default_hourly_rate = parseFloat(rateF.input.value) || 0;
    });
    detailsPanel.appendChild(rateF.wrap);

    // Tipped yes/no
    const tippedWrap = document.createElement('div');
    tippedWrap.style.cssText = 'display: flex; flex-direction: column; gap: 6px;';
    const tippedLbl = document.createElement('div');
    tippedLbl.style.cssText = `
        font-family: ${T.font.body};
        font-size: ${T.fs.base}px;
        color: ${T.textMuted};
        font-weight: 600;
        letter-spacing: 0.3px;
    `;
    tippedLbl.textContent = 'Tipped';
    tippedWrap.appendChild(tippedLbl);
    const tippedGroup = chipGroup({
        options: [{ id: 'yes', label: 'Yes' }, { id: 'no', label: 'No' }],
        selected: [draft.tipout_eligible ? 'yes' : 'no'],
        mode: 'single',
        onChange: (sel) => {
            const yes = sel[0] === 'yes';
            draft.tipout_eligible = yes;
            draft.can_receive_tips = yes;
            draft.can_be_tipped_out_to = yes;
        },
    });
    tippedWrap.appendChild(tippedGroup.wrap);
    detailsPanel.appendChild(tippedWrap);

    const serviceTypesWrap = document.createElement('div');
    serviceTypesWrap.style.cssText = 'display: flex; flex-direction: column; gap: 6px;';
    const serviceTypesLbl = document.createElement('div');
    serviceTypesLbl.style.cssText = `
        font-family: ${T.font.body};
        font-size: ${T.fs.base}px;
        color: ${T.textMuted};
        font-weight: 600;
        letter-spacing: 0.3px;
    `;
    serviceTypesLbl.textContent = 'Service types';
    const serviceTypesSub = document.createElement('div');
    serviceTypesSub.style.cssText = `
        font-family: ${T.font.body};
        font-size: ${T.fs.sm}px;
        color: ${T.textMuted};
        opacity: 0.65;
    `;
    serviceTypesSub.textContent = 'Which order flows this role can work';
    const serviceTypesGroup = chipGroup({
        options: [
            { id: 'full_service', label: 'Full Service' },
            { id: 'qsr', label: 'QSR' },
        ],
        selected: draft.service_types,
        mode: 'multi',
        onChange: (selected) => {
            draft.service_types = selected.length > 0 ? selected : draft.service_types;
        },
    });
    serviceTypesWrap.appendChild(serviceTypesLbl);
    serviceTypesWrap.appendChild(serviceTypesSub);
    serviceTypesWrap.appendChild(serviceTypesGroup.wrap);
    detailsPanel.appendChild(serviceTypesWrap);

    tabPanels.details = detailsPanel;
    content.appendChild(detailsPanel);

    // ── Permissions tab ──
    const permPanel = document.createElement('div');
    permPanel.style.cssText = 'display: none; flex-direction: column; gap: 16px;';

    const levelWrap = document.createElement('div');
    levelWrap.style.cssText = 'display: flex; flex-direction: column; gap: 6px;';
    const levelLbl = document.createElement('div');
    levelLbl.style.cssText = `
        font-family: ${T.font.body};
        font-size: ${T.fs.base}px;
        color: ${T.textMuted};
        font-weight: 600;
        letter-spacing: 0.3px;
    `;
    levelLbl.textContent = 'Permission level';
    levelWrap.appendChild(levelLbl);
    const levelGroup = chipGroup({
        options: PERMISSION_LEVELS.map(l => ({ id: l, label: l })),
        selected: [draft.permission_level],
        mode: 'single',
        onChange: (sel) => { draft.permission_level = sel[0] || 'Standard'; },
    });
    levelWrap.appendChild(levelGroup.wrap);
    permPanel.appendChild(levelWrap);

    const permGrid = document.createElement('div');
    permGrid.style.cssText = 'display: flex; flex-direction: column; gap: 8px; margin-top: 4px;';
    const permGridLbl = document.createElement('div');
    permGridLbl.style.cssText = `
        font-family: ${T.font.body};
        font-size: ${T.fs.base}px;
        color: ${T.textMuted};
        font-weight: 600;
        letter-spacing: 0.3px;
        margin-bottom: 2px;
    `;
    permGridLbl.textContent = 'Individual permissions';
    permGrid.appendChild(permGridLbl);

    const chipRow = document.createElement('div');
    chipRow.style.cssText = 'display: flex; flex-wrap: wrap; gap: 8px;';
    PERMISSION_DEFS.forEach(def => {
        const chip = checkboxChip({
            label: def.label,
            checked: !!draft.permissions[def.key],
            onChange: (on) => {
                if (on) draft.permissions[def.key] = true;
                else delete draft.permissions[def.key];
            },
        });
        chipRow.appendChild(chip.wrap);
    });
    permGrid.appendChild(chipRow);
    permPanel.appendChild(permGrid);

    tabPanels.permissions = permPanel;
    content.appendChild(permPanel);

    // Default to Details tab
    activateTab('details');

    // Footer: Delete (edit only) · Cancel · Save
    const footer = [];
    let modalRef = null;
    if (isEdit) {
        footer.push(button({
            label: 'Delete Role',
            variant: 'danger',
            onClick: () => confirmDeleteRole(role),
        }));
    }
    footer.push(button({
        label: 'Cancel',
        variant: 'ghost',
        onClick: () => modalRef.close(),
    }));
    footer.push(button({
        label: isEdit ? 'Save Changes' : 'Create Role',
        variant: 'primary',
        onClick: async () => {
            const name = (draft.name || '').trim();
            if (!name) {
                showToast('Role name is required.', 'error');
                activateTab('details');
                return;
            }
            draft.name = name;

            try {
                const result = await pushChanges([{
                    event_type: isEdit ? 'employee.role_updated' : 'employee.role_created',
                    payload: {
                        role_id: draft.role_id,
                        name: draft.name,
                        color: draft.color,
                        description: draft.description,
                        default_hourly_rate: draft.default_hourly_rate,
                        permission_level: draft.permission_level,
                        permissions: Object.assign({}, draft.permissions),
                        tipout_eligible: draft.tipout_eligible,
                        can_receive_tips: draft.can_receive_tips,
                        can_be_tipped_out_to: draft.can_be_tipped_out_to,
                        service_types: draft.service_types,
                    },
                }]);
                if (!result.ok) { showToast('Save failed', 'error'); return; }
                showToast(isEdit ? 'Role updated' : 'Role created', 'success');
                modalRef.close();
                // Refresh the roles cache used by employees.js (staff list) too.
                await loadEmployeeData().catch(() => {});
                if (_container) {
                    const wrap = _container.querySelector('#staff-roles-wrap');
                    if (wrap) renderRoles(wrap);
                }
            } catch (e) {
                console.warn('[Staff Roles] save failed:', e);
                showToast('Save failed — see console', 'error');
            }
        },
    }));

    modalRef = openModal({
        title: isEdit ? `Edit Role: ${role.name || '(unnamed)'}` : 'New Role',
        content,
        footer,
        width: 640,
    });
}

const confirmDeleteRole = (role) => {
    const content = document.createElement('div');
    content.style.cssText = `font-size: ${T.fs.lg}px; color: ${T.text}; line-height: 1.6;`;
    content.innerHTML = `
        Delete the role <strong style="color: ${role.color || T.green};">${role.name || '(unnamed)'}</strong>?<br/><br/>
        <span style="font-family: ${T.font.mono}; color: ${T.textMuted}; font-size: ${T.fs.base}px;">
            Employees currently holding this role will keep it on their record, but the role will no longer appear as a selectable option.
        </span>
    `;

    let modalRef = null;
    const cancelBtn = button({
        label: 'Cancel',
        variant: 'ghost',
        onClick: () => modalRef.close(),
    });
    const deleteBtn = button({
        label: 'Delete Role',
        variant: 'danger',
        onClick: async () => {
            try {
                const result = await pushChanges([{
                    event_type: 'employee.role_deleted',
                    payload: { role_id: role.role_id },
                }]);
                if (!result.ok) { showToast('Delete failed', 'error'); return; }
                showToast('Role deleted', 'success');
                modalRef.close();
                // Also close any edit modal that was open for this role.
                document.querySelectorAll('[data-ov-role-edit]').forEach(el => el.remove());
                await loadEmployeeData().catch(() => {});
                if (_container) {
                    const wrap = _container.querySelector('#staff-roles-wrap');
                    if (wrap) renderRoles(wrap);
                }
            } catch (e) {
                console.warn('[Staff Roles] delete failed:', e);
                showToast('Delete failed — see console', 'error');
            }
        },
    });

    modalRef = openModal({
        title: 'Delete Role',
        content,
        footer: [cancelBtn, deleteBtn],
        width: 440,
    });
}

/* ==========================================
   SCENE ENTRY / EXIT
   ========================================== */
export function buildStaffRolesScene(container) {
    _container = container;

    const { body } = buildScenePage(container, {
        title: 'Roles',
        subtitle: 'Staff administration',
    });

    const wrap = document.createElement('div');
    wrap.id = 'staff-roles-wrap';
    body.appendChild(wrap);

    renderRoles(wrap);
}

export function cleanupStaffRoles(container) {
    if (container) container.innerHTML = '';
    _container = null;
    _roles = [];
}
