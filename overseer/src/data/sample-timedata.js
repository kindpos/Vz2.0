/* ============================================
   KINDpos Overseer — Time & Attendance Data (API-backed)
   Fetches from /api/v1/servers/clocked-in
   ============================================ */

import { EMPLOYEES } from './sample-employees.js';

export let ACTIVE_SHIFTS = [];
export let WEEKLY_TIMECARDS = [];
export let SHIFT_DETAILS = {};

export const EDIT_REASONS = [
    'Forgot to clock in',
    'Forgot to clock out',
    'System error',
    'Manager correction',
    'Break not recorded',
];

export const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export function getDayIndex(dateStr) {
    return new Date(dateStr + 'T12:00:00').getDay();
}

export function calcDuration(startStr, endStr) {
    if (!startStr) return { totalHrs: 0, text: '—' };
    const start = new Date(startStr).getTime();
    const end = endStr ? new Date(endStr).getTime() : Date.now();
    const totalHrs = (end - start) / 3600000;
    const hours = Math.floor(totalHrs);
    const minutes = Math.floor((totalHrs - hours) * 60);
    const text = `${hours}h ${String(minutes).padStart(2, '0')}m`;
    return { totalHrs, text };
}

export function durationColor(hours) {
    if (hours >= 8) return 'var(--color-vermillion)';
    if (hours >= 6) return 'var(--color-gold)';
    return 'var(--color-mint)';
}

export function getWeeklyTotals(timecard) {
    if (!timecard || !timecard.days) return { hours: 0, overtime: 0, breaks: 0 };
    let hours = 0, overtime = 0, breaks = 0;
    timecard.days.forEach(d => {
        hours += d.hours || 0;
        breaks += d.breakMinutes || 0;
    });
    overtime = Math.max(0, hours - 40);
    return { hours: Math.round(hours * 100) / 100, overtime: Math.round(overtime * 100) / 100, breaks };
}

export async function loadTimeData() {
    try {
        const res = await fetch('/api/v1/servers/clocked-in');
        if (!res.ok) return;
        const data = await res.json();
        const clocked = data.staff || data.clocked_in || [];

        ACTIVE_SHIFTS = clocked.map(s => {
            const emp = EMPLOYEES.find(e => e.id === s.employee_id);
            return {
                employeeId: s.employee_id,
                name: s.employee_name || (emp ? `${emp.firstName} ${emp.lastName}` : s.employee_id),
                role: s.role || (emp && emp.roles) || [],
                clockIn: s.clocked_in_at || s.clock_in,
                onBreak: s.on_break || false,
                breakStart: s.break_start || null,
                breaksTaken: s.breaks_taken || [],
                sales: s.sales || 0,
                tips: s.tips || 0,
                tables: s.tables || 0,
            };
        });
    } catch (e) {
        console.warn('[TimeData] Failed to load clocked-in data:', e);
    }

    WEEKLY_TIMECARDS = EMPLOYEES.map(emp => ({
        employeeId: emp.id,
        name: `${emp.firstName} ${emp.lastName}`,
        role: emp.roles || [],
        days: DAY_LABELS.map(() => ({ hours: 0, breakMinutes: 0 })),
    }));
}
