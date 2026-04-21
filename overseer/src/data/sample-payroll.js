/* ============================================
   KINDpos Overseer — Payroll Data (API-backed)
   Fetches from /api/v1/reports/labor-summary
   ============================================ */

import { EMPLOYEES } from './sample-employees.js';

function todayStr() { return new Date().toISOString().slice(0, 10); }
function weekAgoStr() { const d = new Date(); d.setDate(d.getDate() - 7); return d.toISOString().slice(0, 10); }

export let PAY_PERIODS = [];
export let PAY_SCHEDULE = { frequency: 'bi-weekly', nextPayDate: '' };
export let PAYROLL_SUMMARY = {
    period: { start: weekAgoStr(), end: todayStr() },
    totalSales: 0,
    laborSummary: { totalHours: 0, regularHours: 0, overtimeHours: 0, totalLabor: 0, laborPct: 0 },
    employees: [],
};

export const EXPORT_FORMATS = [
    { id: 'csv',  label: 'CSV Spreadsheet', icon: '📊', ext: '.csv'  },
    { id: 'pdf',  label: 'PDF Report',      icon: '📄', ext: '.pdf'  },
    { id: 'json', label: 'JSON (API)',       icon: '🔗', ext: '.json' },
];

export const LABOR_BENCHMARKS = {
    targetLaborPct: 30,
    warningLaborPct: 35,
    criticalLaborPct: 40,
    maxWeeklyHours: 40,
    overtimeRate: 1.5,
};

export async function loadPayrollData(startDate, endDate) {
    const qDate = endDate || todayStr();
    try {
        const res = await fetch(`/api/v1/reports/labor-summary?date=${qDate}`);
        if (!res.ok) return;
        const data = await res.json();

        const totalSales = data.net_sales || data.total_sales || 0;
        const employees = (data.employees || []).map(e => ({
            id: e.employee_id || e.id,
            name: e.name || e.display_name || e.employee_id,
            role: e.role || 'server',
            hoursWorked: e.hours || 0,
            regularHours: Math.min(e.hours || 0, 40),
            overtimeHours: Math.max(0, (e.hours || 0) - 40),
            hourlyRate: e.hourly_rate || 0,
            grossPay: e.gross_pay || (e.hours || 0) * (e.hourly_rate || 0),
            tips: e.tips || 0,
            tipout: e.tipout || 0,
            netTips: (e.tips || 0) - (e.tipout || 0),
            shiftsWorked: e.shifts || 0,
        }));

        const totalHours = employees.reduce((s, e) => s + e.hoursWorked, 0);
        const totalLabor = employees.reduce((s, e) => s + e.grossPay, 0);
        const overtimeHours = employees.reduce((s, e) => s + e.overtimeHours, 0);

        PAYROLL_SUMMARY = {
            period: { start: startDate || weekAgoStr(), end: endDate || todayStr() },
            totalSales,
            laborSummary: {
                totalHours: Math.round(totalHours * 100) / 100,
                regularHours: Math.round((totalHours - overtimeHours) * 100) / 100,
                overtimeHours: Math.round(overtimeHours * 100) / 100,
                totalLabor: Math.round(totalLabor * 100) / 100,
                laborPct: totalSales > 0 ? Math.round((totalLabor / totalSales) * 10000) / 100 : 0,
            },
            employees,
        };
    } catch (e) {
        console.warn('[Payroll] Failed to load labor data:', e);
        PAYROLL_SUMMARY.employees = EMPLOYEES.map(emp => ({
            id: emp.id, name: `${emp.firstName} ${emp.lastName}`, role: emp.role,
            hoursWorked: 0, regularHours: 0, overtimeHours: 0,
            hourlyRate: emp.payRate, grossPay: 0, tips: 0, tipout: 0, netTips: 0, shiftsWorked: 0,
        }));
    }
}
