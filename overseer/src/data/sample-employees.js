/* ============================================
   KINDpos Overseer — Employee Data (API-backed)
   Fetches from /api/v1/config/employees and /api/v1/config/roles
   ============================================ */

export let EMPLOYEES = [];

const DEFAULT_ROLES = [
    { id: 'manager',    label: 'Manager',    permissionLevel: 'Manager'  },
    { id: 'server',     label: 'Server',     permissionLevel: 'Standard' },
    { id: 'bartender',  label: 'Bartender',  permissionLevel: 'Standard' },
    { id: 'cook',       label: 'Cook',       permissionLevel: 'Standard' },
    { id: 'host',       label: 'Host',       permissionLevel: 'Standard' },
    { id: 'busser',     label: 'Busser',     permissionLevel: 'Standard' },
];

export let ROLES = [...DEFAULT_ROLES];

export const STATUSES = [
    { id: 'active',         label: 'Active',           color: 'var(--color-green)',       dot: '#39b54a' },
    { id: 'inactive',       label: 'Inactive',         color: 'rgba(var(--color-mint-rgb), 0.4)', dot: '#888' },
    { id: 'do_not_rehire',  label: 'Do Not Rehire',    color: 'var(--color-vermillion)',  dot: '#ff4422' },
];

let _rolesMap = {};

export async function loadEmployeeData() {
    const [empRes, roleRes] = await Promise.allSettled([
        fetch('/api/v1/config/employees'),
        fetch('/api/v1/config/roles'),
    ]);

    if (roleRes.status === 'fulfilled' && roleRes.value.ok) {
        const roles = await roleRes.value.json();
        if (roles.length > 0) {
            ROLES = roles.map(r => ({
                id: r.role_id,
                label: r.name,
                permissionLevel: r.permission_level,
            }));
        }
    }
    _rolesMap = {};
    ROLES.forEach(r => { _rolesMap[r.id] = r.label; });

    if (empRes.status === 'fulfilled' && empRes.value.ok) {
        const employees = await empRes.value.json();
        EMPLOYEES = employees.map(e => {
            const firstName = e.first_name || (e.name || '').split(' ')[0] || e.employee_id;
            const lastName = e.last_name || (e.name || '').split(' ').slice(1).join(' ') || '';
            return {
                id: e.employee_id,
                firstName,
                lastName,
                roles: e.role_ids && e.role_ids.length > 0 ? e.role_ids : (e.role_id ? [e.role_id] : ['server']),
                status: e.active !== false ? 'active' : 'inactive',
                hireDate: new Date().toISOString().slice(0, 10),
                payRate: parseFloat(e.hourly_rate) || 0,
                pin: e.pin || '',
                phone: '',
                email: '',
            };
        });
    }
}

function _labelFor(id) {
    if (_rolesMap[id]) return _rolesMap[id];
    const match = ROLES.find(r => r.id === id);
    return (match && match.label) || id;
}

export function getRoleLabel(roleIdOrArray) {
    if (Array.isArray(roleIdOrArray)) {
        return roleIdOrArray.map(_labelFor).join(', ') || '—';
    }
    return _labelFor(roleIdOrArray) || '—';
}

export function getStatusInfo(statusId) {
    return STATUSES.find(s => s.id === statusId) || STATUSES[0];
}

export function fmtDate(dateStr) {
    if (!dateStr) return '—';
    try {
        return new Date(dateStr + 'T12:00:00').toLocaleDateString('en-US', {
            month: 'short', day: 'numeric', year: 'numeric',
        });
    } catch { return dateStr; }
}

export function generatePIN() {
    return String(Math.floor(1000 + Math.random() * 9000));
}

export function generateEmployeeId() {
    return 'emp_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}
