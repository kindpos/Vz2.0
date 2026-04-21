/* ============================================
   KINDpos Overseer — Shift Config Data
   Constants and helpers for shift management UI.
   Schedule data built from employee roster.
   ============================================ */

import { EMPLOYEES } from './sample-employees.js';

export const SHIFT_STATUSES = {
    scheduled:  { label: 'Scheduled',  color: 'var(--color-mint)'        },
    active:     { label: 'Active',     color: 'var(--color-green)'       },
    completed:  { label: 'Completed',  color: 'rgba(var(--color-mint-rgb), 0.4)' },
    missed:     { label: 'No Show',    color: 'var(--color-vermillion)'  },
    swapped:    { label: 'Swapped',    color: 'var(--color-gold)'        },
};

export const SWAP_STATUSES = {
    pending:  { label: 'Pending',  color: 'var(--color-gold)'        },
    approved: { label: 'Approved', color: 'var(--color-green)'       },
    denied:   { label: 'Denied',   color: 'var(--color-vermillion)'  },
};

export const GANTT_CONFIG = {
    startHour: 6,
    endHour: 24,
    hourWidth: 60,
    rowHeight: 40,
};

export const SHIFT_TEMPLATES = [
    { id: 'open',  label: 'Open',  start: '10:00', end: '16:00' },
    { id: 'mid',   label: 'Mid',   start: '12:00', end: '20:00' },
    { id: 'close', label: 'Close', start: '16:00', end: '23:00' },
    { id: 'full',  label: 'Full',  start: '10:00', end: '23:00' },
];

export let TODAYS_SCHEDULE = [];
export let SWAP_REQUESTS = [];

export const COVERAGE_REQUIREMENTS = {
    dayparts: [
        { name: 'Lunch (11a–2p)', startHour: 11, endHour: 14, roles: { server: 2, manager: 1 } },
        { name: 'Dinner (5p–9p)', startHour: 17, endHour: 21, roles: { server: 3, manager: 1 } },
        { name: 'Late (9p–Close)', startHour: 21, endHour: 23, roles: { server: 1, manager: 1 } },
    ],
};

export function timeToPercent(timeStr) {
    const [h, m] = timeStr.split(':').map(Number);
    const totalMinutes = (h - GANTT_CONFIG.startHour) * 60 + m;
    const totalRange = (GANTT_CONFIG.endHour - GANTT_CONFIG.startHour) * 60;
    return (totalMinutes / totalRange) * 100;
}

export function barWidth(start, end) {
    return timeToPercent(end) - timeToPercent(start);
}

export async function loadShiftData() {
    TODAYS_SCHEDULE = EMPLOYEES
        .filter(e => e.status === 'active')
        .map((emp, i) => {
            const template = SHIFT_TEMPLATES[i % SHIFT_TEMPLATES.length];
            return {
                employeeId: emp.id,
                name: `${emp.firstName} ${emp.lastName}`,
                role: emp.roles || [],
                scheduledStart: template.start,
                scheduledEnd: template.end,
                actualStart: null,
                actualEnd: null,
                status: 'scheduled',
                template: template.id,
            };
        });
    SWAP_REQUESTS = [];
}
