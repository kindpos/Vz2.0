/* ============================================
   KINDpos Overseer — Labor Reports
   Reads from GET /api/v1/reports/labor-summary
   ============================================ */

import { buildDatePicker } from '../components/date-picker.js';

let currentContainer = null;
let currentDate = new Date().toISOString().slice(0, 10);

function fmt$(v) { return '$' + (v ?? 0).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ','); }
function fmtHrs(v) { return (v ?? 0).toFixed(2) + 'h'; }
function fmtPct(v) { return (v ?? 0).toFixed(1) + '%'; }

async function fetchLabor(date) {
    try {
        const res = await fetch(`/api/v1/reports/labor-summary?date=${date}`);
        if (!res.ok) return null;
        return await res.json();
    } catch { return null; }
}

function kpiCard(label, value, color = 'var(--color-gold)') {
    const card = document.createElement('div');
    card.style.cssText = `
        flex: 1; min-width: 180px;
        background: rgba(var(--color-mint-rgb), 0.06);
        border: 1px solid rgba(var(--color-mint-rgb), 0.15);
        border-radius: 6px; padding: 16px; text-align: center;
    `;
    card.innerHTML = `
        <div style="font-size:16px;color:var(--color-mint);text-transform:uppercase;letter-spacing:1px;margin-bottom:6px;">${label}</div>
        <div style="font-size:36px;color:${color};font-family:var(--font-heading);">${value}</div>
    `;
    return card;
}

async function render(container) {
    container.innerHTML = '';
    const wrapper = document.createElement('div');
    wrapper.style.cssText = 'max-width: 900px; margin: 0 auto; padding: 30px 24px 60px;';

    const header = document.createElement('div');
    header.style.cssText = 'display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:20px;flex-wrap:wrap;gap:12px;';
    header.innerHTML = `
        <div>
            <div style="font-family:var(--font-heading);font-size:44px;color:var(--color-gold);">\u{1F4CA} Labor Reports</div>
            <div style="font-size:18px;color:rgba(var(--color-mint-rgb),0.5);margin-top:4px;">Staff hours, overtime, and labor cost</div>
        </div>
    `;
    const datePicker = buildDatePicker({
        value: currentDate,
        onChange: (d) => { currentDate = d; render(container); },
    });
    header.appendChild(datePicker);
    wrapper.appendChild(header);

    const data = await fetchLabor(currentDate);
    if (!data) {
        const empty = document.createElement('div');
        empty.style.cssText = 'padding:60px 20px;text-align:center;color:rgba(var(--color-mint-rgb),0.4);font-size:22px;';
        empty.textContent = 'No labor data for this date.';
        wrapper.appendChild(empty);
        container.appendChild(wrapper);
        return;
    }

    // KPI Cards
    const kpiRow = document.createElement('div');
    kpiRow.style.cssText = 'display:flex;gap:12px;flex-wrap:wrap;margin-bottom:24px;';

    const totalHours = (data.employees || []).reduce((s, e) => s + (e.hours || 0), 0);
    const totalLabor = (data.employees || []).reduce((s, e) => s + (e.gross_pay || (e.hours || 0) * (e.hourly_rate || 0)), 0);
    // Federal overtime kicks in beyond 40 *weekly* hours. Using the
    // daily `hours` field meant OT only triggered on 40-hour shifts —
    // practically never, so the KPI read 0h regardless of schedule.
    const overtimeHours = (data.employees || []).reduce((s, e) => s + Math.max(0, (e.weekly_hours || 0) - 40), 0);
    const netSales = data.net_sales || data.total_sales || 0;
    const laborPct = netSales > 0 ? (totalLabor / netSales) * 100 : 0;

    kpiRow.appendChild(kpiCard('Total Hours', fmtHrs(totalHours)));
    kpiRow.appendChild(kpiCard('Overtime', fmtHrs(overtimeHours), 'var(--color-vermillion)'));
    kpiRow.appendChild(kpiCard('Total Labor', fmt$(totalLabor)));
    kpiRow.appendChild(kpiCard('Labor %', fmtPct(laborPct), laborPct > 35 ? 'var(--color-vermillion)' : 'var(--color-mint)'));
    wrapper.appendChild(kpiRow);

    // Employee breakdown
    const tableHdr = document.createElement('div');
    tableHdr.style.cssText = 'font-family:var(--font-heading);font-size:22px;color:var(--color-mint);margin:24px 0 12px 0;';
    tableHdr.textContent = 'EMPLOYEE BREAKDOWN';
    wrapper.appendChild(tableHdr);

    if ((data.employees || []).length === 0) {
        const none = document.createElement('div');
        none.style.cssText = 'padding:20px;color:rgba(var(--color-mint-rgb),0.4);font-size:18px;font-style:italic;';
        none.textContent = 'No employees clocked in on this date.';
        wrapper.appendChild(none);
    } else {
        const thead = document.createElement('div');
        thead.style.cssText = 'display:grid;grid-template-columns:2fr 1fr 1fr 1fr 1fr;gap:10px;padding:10px 14px;border-bottom:2px solid rgba(var(--color-mint-rgb),0.15);color:rgba(var(--color-mint-rgb),0.5);font-size:16px;text-transform:uppercase;letter-spacing:1px;';
        thead.innerHTML = `
            <span>Employee</span>
            <span style="text-align:right;">Hours</span>
            <span style="text-align:right;">Overtime</span>
            <span style="text-align:right;">Rate</span>
            <span style="text-align:right;">Gross Pay</span>
        `;
        wrapper.appendChild(thead);

        data.employees.forEach(e => {
            const hours = e.hours || 0;
            const rate = e.hourly_rate || 0;
            const overtime = Math.max(0, hours - 40);
            const gross = e.gross_pay || (hours * rate);
            const row = document.createElement('div');
            row.style.cssText = 'display:grid;grid-template-columns:2fr 1fr 1fr 1fr 1fr;gap:10px;padding:12px 14px;border-bottom:1px solid rgba(var(--color-mint-rgb),0.08);font-size:20px;';
            row.innerHTML = `
                <span style="color:var(--color-mint);">${e.name || e.display_name || e.employee_id}</span>
                <span style="text-align:right;color:var(--color-mint);">${fmtHrs(hours)}</span>
                <span style="text-align:right;color:${overtime > 0 ? 'var(--color-vermillion)' : 'rgba(var(--color-mint-rgb),0.4)'};">${overtime > 0 ? fmtHrs(overtime) : '—'}</span>
                <span style="text-align:right;color:rgba(var(--color-mint-rgb),0.6);">${fmt$(rate)}/hr</span>
                <span style="text-align:right;color:var(--color-gold);font-family:var(--font-heading);">${fmt$(gross)}</span>
            `;
            wrapper.appendChild(row);
        });
    }

    container.appendChild(wrapper);
}

export function buildLaborReportsScene(container) {
    currentContainer = container;
    currentDate = new Date().toISOString().slice(0, 10);
    render(container).catch(e => console.error('[LaborReports] Mount error:', e));
}

export function cleanupLaborReports(container) {
    if (container) container.innerHTML = '';
    currentContainer = null;
}
