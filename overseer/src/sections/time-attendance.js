import { pushChanges } from '../services/config-push.js';
/* ============================================
   KINDpos Overseer — Time & Attendance

   View Stack:
     live-dashboard → week-grid → shift-detail

   Features:
     - Live clock-in dashboard (color-coded durations)
     - Weekly time card grid (spreadsheet-style)
     - Shift detail drill-down (breaks, sales, tips)
     - Time edit modal (manager PIN + audit trail)
     - Break compliance tracking
     - Overtime warnings at >40h

   "Nice. Dependable. Yours."
   ============================================ */

import {
    ACTIVE_SHIFTS, WEEKLY_TIMECARDS, SHIFT_DETAILS, EDIT_REASONS,
    DAY_LABELS, getDayIndex, calcDuration, durationColor, getWeeklyTotals,
} from '../data/sample-timedata.js';
import { getRoleLabel, fmtDate } from '../data/sample-employees.js';

/* ------------------------------------------
   COLOR PALETTE (matches employees.js / reporting.js)
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
let viewHistory = [];
let currentContainer = null;
let refreshTimer = null;

/** View registry: name → builder function */
const VIEW_REGISTRY = {
    'live-dashboard': buildLiveDashboard,
    'week-grid':      buildWeekGrid,
    'shift-detail':   buildShiftDetail,
};

/* ------------------------------------------
   VIEW STACK (same pattern as reporting.js)
------------------------------------------ */
function pushView(viewName, data) {
    if (!currentContainer) return;
    const wrapper = currentContainer.querySelector('#ta-view-wrapper');
    if (!wrapper) return;
    wrapper.innerHTML = '';

    const builder = VIEW_REGISTRY[viewName];
    if (builder) {
        builder(wrapper, data);
        viewHistory.push({ name: viewName, data });
    }
}

function popView() {
    if (viewHistory.length <= 1) return;
    viewHistory.pop();
    const prev = viewHistory[viewHistory.length - 1];
    viewHistory.pop(); // pushView will re-push it
    pushView(prev.name, prev.data);
}

/* ------------------------------------------
   BACK BUTTON BUILDER
------------------------------------------ */
function buildBackButton(wrapper, label) {
    const btn = document.createElement('button');
    btn.textContent = `← Back to ${label}`;
    btn.style.cssText = `
        background: transparent; border: 1px solid ${C.mintBorder};
        color: ${C.mint}; padding: 10px 20px; border-radius: 8px;
        font-size: 22px; cursor: pointer; margin-bottom: 20px;
        font-family: var(--font-body, 'Sevastopol Interface', Arial, sans-serif);
        transition: all 0.2s ease;
    `;
    btn.addEventListener('mouseenter', () => btn.style.background = C.mintHover);
    btn.addEventListener('mouseleave', () => btn.style.background = 'transparent');
    btn.addEventListener('click', popView);
    wrapper.appendChild(btn);
}

/* ------------------------------------------
   TOAST (reuse pattern from employees.js)
------------------------------------------ */
function showToast(message, type = 'success') {
    if (!currentContainer) return;
    const old = currentContainer.querySelector('.ta-toast');
    if (old) old.remove();

    const colors = {
        success: { bg: 'rgba(0, 255, 0, 0.15)', border: C.green, text: C.green },
        error:   { bg: 'rgba(var(--color-vermillion-rgb), 0.15)', border: C.red, text: C.red },
        info:    { bg: 'rgba(var(--color-mint-rgb), 0.15)', border: C.mint, text: C.mint },
        warning: { bg: 'rgba(255, 165, 0, 0.15)', border: C.orange, text: C.orange },
    };
    const tc = colors[type] || colors.info;

    const toast = document.createElement('div');
    toast.className = 'ta-toast';
    toast.style.cssText = `
        position: fixed; top: 24px; right: 24px; z-index: 10000;
        background: ${tc.bg}; border: 1px solid ${tc.border};
        color: ${tc.text}; padding: 14px 24px; border-radius: 8px;
        font-family: var(--font-body, 'Sevastopol Interface', Arial, sans-serif);
        font-size: 25px; backdrop-filter: blur(8px);
        animation: toastSlideIn 0.3s ease-out; max-width: 400px;
    `;
    toast.textContent = message;
    currentContainer.appendChild(toast);
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
    pushChanges([event]).catch(e => console.warn("[Overseer] Event push failed:", e));
    return event;
}

/* ------------------------------------------
   FORMAT HELPERS
------------------------------------------ */
function fmt$(val) { return '$' + val.toFixed(2); }
function fmtHrs(val) { return val.toFixed(2) + 'h'; }

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

/* ==========================================
   VIEW 1: LIVE DASHBOARD
   "Who's on the clock right now?"
   ========================================== */
function buildLiveDashboard(wrapper) {
    wrapper.style.cssText = 'padding: 0 8px; max-width: 1100px; margin: 0 auto;';

    // ── Header ──
    const header = document.createElement('div');
    header.style.cssText = `
        display: flex; justify-content: space-between; align-items: flex-start;
        margin-bottom: 24px; flex-wrap: wrap; gap: 12px;
    `;

    const now = new Date();
    const dateStr = now.toLocaleDateString('en-US', {
        weekday: 'long', month: 'long', day: 'numeric', year: 'numeric'
    });
    const timeStr = now.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });

    header.innerHTML = `
        <div>
            <div style="font-family: var(--font-display, 'Alien Encounters', monospace);
                        font-size: 36px; color: ${C.yellow};">
                Time & Attendance
            </div>
            <div style="font-size: 25px; color: rgba(var(--color-mint-rgb), 0.5); margin-top: 4px;">
                ${dateStr}
            </div>
        </div>
        <div style="text-align: right;">
            <div id="ta-clock" style="font-family: var(--font-display, 'Alien Encounters', monospace);
                        font-size: 26px; color: ${C.mint}; margin-top: 4px;">
                ${timeStr}
            </div>
        </div>
    `;
    wrapper.appendChild(header);

    // ── Navigation Tabs ──
    const tabs = document.createElement('div');
    tabs.style.cssText = `
        display: flex; gap: 12px; margin-bottom: 24px; flex-wrap: wrap;
    `;

    const liveTab = buildTab('Currently Working', true);
    const weekTab = buildTab('Week Grid', false, () => pushView('week-grid'));
    tabs.appendChild(liveTab);
    tabs.appendChild(weekTab);
    wrapper.appendChild(tabs);

    // ── Summary Cards Row ──
    const summaryRow = document.createElement('div');
    summaryRow.style.cssText = `
        display: grid; grid-template-columns: repeat(4, 1fr);
        gap: 12px; margin-bottom: 24px;
    `;

    const onClock = ACTIVE_SHIFTS.filter(s => !s.onBreak).length;
    const onBreak = ACTIVE_SHIFTS.filter(s => s.onBreak).length;
    const totalSales = ACTIVE_SHIFTS.reduce((sum, s) => sum + s.sales, 0);
    const totalTips = ACTIVE_SHIFTS.reduce((sum, s) => sum + s.tips, 0);

    summaryRow.appendChild(buildSummaryCard('On Clock', onClock, C.green));
    summaryRow.appendChild(buildSummaryCard('On Break', onBreak, C.orange));
    summaryRow.appendChild(buildSummaryCard('Today Sales', fmt$(totalSales), C.mint));
    summaryRow.appendChild(buildSummaryCard('Today Tips', fmt$(totalTips), C.yellow));
    wrapper.appendChild(summaryRow);

    // ── Active Shifts Table ──
    const section = document.createElement('div');
    section.style.cssText = `
        background: rgba(var(--color-mint-rgb), 0.04); border: 1px solid ${C.mintBorder};
        border-radius: 10px; overflow: hidden;
    `;

    const sectionHeader = document.createElement('div');
    sectionHeader.style.cssText = `
        padding: 16px 20px; border-bottom: 1px solid ${C.mintBorder};
        font-family: var(--font-display, 'Alien Encounters', monospace);
        font-size: 26px; color: ${C.mint}; letter-spacing: 1px;
        display: flex; justify-content: space-between; align-items: center;
    `;
    sectionHeader.innerHTML = `
        <span>CURRENTLY CLOCKED IN [${ACTIVE_SHIFTS.length}]</span>
        <span style="font-size: 20px; color: ${C.grey};">Auto-refreshes every 30s</span>
    `;
    section.appendChild(sectionHeader);

    // Header row
    const headerRow = document.createElement('div');
    headerRow.style.cssText = `
        display: grid;
        grid-template-columns: 2fr 1fr 1.2fr 1fr 0.8fr 0.8fr 0.8fr;
        padding: 14px 20px; gap: 8px;
        background: rgba(var(--color-mint-rgb), 0.08);
        border-bottom: 1px solid ${C.mintBorder};
        font-size: 20px; color: ${C.mintFaded};
        text-transform: uppercase; letter-spacing: 1px;
    `;
    ['Employee', 'Role', 'Clock In', 'Duration', 'Tables', 'Sales', 'Tips'].forEach(label => {
        const cell = document.createElement('div');
        cell.textContent = label;
        headerRow.appendChild(cell);
    });
    section.appendChild(headerRow);

    // Data rows
    ACTIVE_SHIFTS.forEach((shift, i) => {
        const dur = calcDuration(shift.clockIn);
        const durColor = durationColor(dur.totalHrs);
        const stripeBg = i % 2 === 0 ? 'transparent' : 'rgba(var(--color-mint-rgb), 0.03)';

        const row = document.createElement('div');
        row.style.cssText = `
            display: grid;
            grid-template-columns: 2fr 1fr 1.2fr 1fr 0.8fr 0.8fr 0.8fr;
            padding: 16px 20px; gap: 8px; align-items: center;
            border-bottom: 1px solid rgba(var(--color-mint-rgb), 0.08);
            background: ${stripeBg}; transition: background 0.15s ease;
        `;
        row.addEventListener('mouseenter', () => row.style.background = C.mintHover);
        row.addEventListener('mouseleave', () => row.style.background = stripeBg);

        // Break badge
        const breakBadge = shift.onBreak
            ? `<span style="font-size: 16px; color: ${C.orange}; background: rgba(255,165,0,0.15);
                padding: 2px 8px; border-radius: 4px; margin-left: 8px; vertical-align: middle;">ON BREAK</span>`
            : '';

        // Overtime warning for shifts approaching 8+ hours
        const otWarning = dur.totalHrs >= 8
            ? `<span style="font-size: 16px; color: ${C.red}; background: ${C.redFaded};
                padding: 2px 8px; border-radius: 4px; margin-left: 8px; vertical-align: middle;">OT WATCH</span>`
            : '';

        row.innerHTML = `
            <div style="color: ${C.white}; font-size: 25px;">
                ${shift.name.split(' ')[0]} ${shift.name.split(' ').slice(1).join(' ')}${breakBadge}${otWarning}
            </div>
            <div style="color: ${C.mint}; font-size: 22px;">${getRoleLabel(shift.role)}</div>
            <div style="color: rgba(var(--color-mint-rgb), 0.6); font-size: 22px;">${fmtTimeISO(shift.clockIn)}</div>
            <div style="color: ${durColor}; font-size: 25px; font-family: var(--font-display, monospace);">
                ${dur.text}
            </div>
            <div style="color: rgba(var(--color-mint-rgb), 0.6); font-size: 22px;">${shift.tables || '—'}</div>
            <div style="color: rgba(var(--color-mint-rgb), 0.6); font-size: 22px;">${shift.sales ? fmt$(shift.sales) : '—'}</div>
            <div style="color: ${C.yellow}; font-size: 22px;">${shift.tips ? fmt$(shift.tips) : '—'}</div>
        `;
        section.appendChild(row);
    });

    wrapper.appendChild(section);

    // ── Break Compliance Notice ──
    const fiveHourAlerts = ACTIVE_SHIFTS.filter(s => {
        const dur = calcDuration(s.clockIn);
        return dur.totalHrs >= 5 && s.breaksTaken.length === 0 && !s.onBreak;
    });

    if (fiveHourAlerts.length > 0) {
        const alert = document.createElement('div');
        alert.style.cssText = `
            margin-top: 16px; padding: 16px 20px;
            background: rgba(255, 165, 0, 0.08); border: 1px solid rgba(255, 165, 0, 0.3);
            border-radius: 10px; color: ${C.orange}; font-size: 22px;
        `;
        const names = fiveHourAlerts.map(s => s.firstName).join(', ');
        alert.innerHTML = `
            <div style="font-weight: bold; margin-bottom: 4px;">⚠ Break Compliance Alert</div>
            <div>${names} — over 5 hours without a meal break. California law requires a 30-minute meal break before the 5th hour.</div>
        `;
        wrapper.appendChild(alert);
    }

    // ── Auto-refresh clock ──
    startClockRefresh();
}

/* ------------------------------------------
   CLOCK REFRESH (updates time display)
------------------------------------------ */
function startClockRefresh() {
    stopClockRefresh();
    refreshTimer = setInterval(() => {
        const el = document.getElementById('ta-clock');
        if (el) {
            const now = new Date();
            el.textContent = now.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
        }
    }, 30000);
}

function stopClockRefresh() {
    if (refreshTimer) {
        clearInterval(refreshTimer);
        refreshTimer = null;
    }
}

/* ==========================================
   VIEW 2: WEEK GRID
   Spreadsheet-style time cards for all employees
   ========================================== */
function buildWeekGrid(wrapper) {
    wrapper.style.cssText = 'padding: 0 8px; max-width: 1200px; margin: 0 auto;';

    buildBackButton(wrapper, 'Live Dashboard');

    // ── Header ──
    const header = document.createElement('div');
    header.style.cssText = 'margin-bottom: 24px;';

    const weekStart = new Date();
    weekStart.setDate(weekStart.getDate() - ((weekStart.getDay() + 6) % 7) - 7);
    const weekEnd = new Date(weekStart);
    weekEnd.setDate(weekEnd.getDate() + 6);

    const fmtWeekDate = (d) => d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

    header.innerHTML = `
        <div style="font-family: var(--font-display, 'Alien Encounters', monospace);
                    font-size: 36px; color: ${C.yellow}; margin-bottom: 4px;">
            Weekly Time Cards
        </div>
        <div style="font-size: 25px; color: rgba(var(--color-mint-rgb), 0.5);">
            Week of ${fmtWeekDate(weekStart)} – ${fmtWeekDate(weekEnd)}
        </div>
    `;
    wrapper.appendChild(header);

    // ── Grid Container ──
    const gridContainer = document.createElement('div');
    gridContainer.style.cssText = `
        background: rgba(var(--color-mint-rgb), 0.04); border: 1px solid ${C.mintBorder};
        border-radius: 10px; overflow-x: auto;
    `;

    // Grid header
    const gridHeader = document.createElement('div');
    gridHeader.style.cssText = `
        display: grid;
        grid-template-columns: 2fr repeat(7, 1fr) 1.2fr;
        padding: 14px 16px; gap: 4px;
        background: rgba(var(--color-mint-rgb), 0.08);
        border-bottom: 1px solid ${C.mintBorder};
        font-size: 20px; color: ${C.mintFaded};
        text-transform: uppercase; letter-spacing: 1px;
        min-width: 900px;
    `;
    ['Employee', ...DAY_LABELS, 'Total'].forEach(label => {
        const cell = document.createElement('div');
        cell.textContent = label;
        cell.style.cssText = 'text-align: center;';
        if (label === 'Employee') cell.style.textAlign = 'left';
        gridHeader.appendChild(cell);
    });
    gridContainer.appendChild(gridHeader);

    // Data rows
    WEEKLY_TIMECARDS.forEach((tc, i) => {
        const totals = getWeeklyTotals(tc);
        const stripeBg = i % 2 === 0 ? 'transparent' : 'rgba(var(--color-mint-rgb), 0.03)';

        const row = document.createElement('div');
        row.style.cssText = `
            display: grid;
            grid-template-columns: 2fr repeat(7, 1fr) 1.2fr;
            padding: 14px 16px; gap: 4px; align-items: center;
            border-bottom: 1px solid rgba(var(--color-mint-rgb), 0.08);
            background: ${stripeBg};
            min-width: 900px;
        `;

        // Employee name cell
        const nameCell = document.createElement('div');
        nameCell.style.cssText = `color: ${C.white}; font-size: 22px;`;

        // Overtime badge
        const otBadge = totals.overtime > 0
            ? ` <span style="font-size: 15px; color: ${C.red}; background: ${C.redFaded};
                 padding: 2px 6px; border-radius: 4px; vertical-align: middle;">OT +${totals.overtime.toFixed(1)}h</span>`
            : '';
        const editBadge = totals.hasEdits
            ? ` <span style="font-size: 15px; color: ${C.orange}; background: rgba(255,165,0,0.15);
                 padding: 2px 6px; border-radius: 4px; vertical-align: middle;">EDITED</span>`
            : '';

        nameCell.innerHTML = `${tc.name.split(' ')[0]} ${tc.name.split(' ').slice(1).join(' ')}${otBadge}${editBadge}`;
        row.appendChild(nameCell);

        // Day cells (Mon–Sun)
        for (let dayIdx = 0; dayIdx < 7; dayIdx++) {
            const shift = tc.shifts.find(s => getDayIndex(s.date) === dayIdx);
            const cell = document.createElement('div');
            cell.style.cssText = 'text-align: center;';

            if (shift) {
                const cellColor = shift.hours >= 10 ? C.orange : shift.hours >= 8 ? C.yellow : C.mint;
                cell.style.cssText += `
                    color: ${cellColor}; font-size: 22px; cursor: pointer;
                    padding: 6px 4px; border-radius: 6px;
                    transition: background 0.15s ease;
                `;
                cell.textContent = shift.hours.toFixed(1);
                cell.title = `${fmtTime12(shift.clockIn)} – ${fmtTime12(shift.clockOut)}`;

                // Edited indicator dot
                if (shift.edited) {
                    cell.innerHTML = `${shift.hours.toFixed(1)}<span style="color: ${C.orange}; font-size: 14px; vertical-align: super;">✎</span>`;
                }

                cell.addEventListener('mouseenter', () => cell.style.background = C.mintHover);
                cell.addEventListener('mouseleave', () => cell.style.background = 'transparent');
                cell.addEventListener('click', () => {
                    // If we have detailed data, drill down; otherwise show basic info
                    const detail = SHIFT_DETAILS[shift.shift_id];
                    if (detail) {
                        pushView('shift-detail', detail);
                    } else {
                        pushView('shift-detail', {
                            shift_id: shift.shift_id,
                            employee_id: tc.employee_id,
                            firstName: tc.name.split(' ')[0],
                            lastName: tc.name.split(' ').slice(1).join(' '),
                            role: tc.role,
                            date: shift.date,
                            clockIn: shift.clockIn,
                            clockOut: shift.clockOut,
                            hours: shift.hours,
                            edited: shift.edited,
                            breaks: [],
                            tables: Math.floor(Math.random() * 10) + 2,
                            guests: Math.floor(Math.random() * 25) + 5,
                            sales: shift.sales,
                            tips: shift.tips,
                            tipPct: shift.sales > 0 ? (shift.tips / shift.sales * 100) : 0,
                            avgCheck: shift.sales > 0 ? shift.sales / (Math.floor(Math.random() * 25) + 5) : 0,
                            orders: [],
                        });
                    }
                });
            } else {
                cell.style.color = 'rgba(var(--color-mint-rgb), 0.15)';
                cell.style.fontSize = '16px';
                cell.textContent = '—';
            }
            row.appendChild(cell);
        }

        // Total cell
        const totalCell = document.createElement('div');
        const totalColor = totals.overtime > 0 ? C.red : totals.totalHours > 35 ? C.yellow : C.mint;
        totalCell.style.cssText = `
            text-align: center; font-size: 25px; color: ${totalColor};
            font-family: var(--font-display, monospace); font-weight: bold;
        `;
        totalCell.textContent = fmtHrs(totals.totalHours);
        row.appendChild(totalCell);

        gridContainer.appendChild(row);
    });

    wrapper.appendChild(gridContainer);

    // ── Week Summary ──
    const allTotals = WEEKLY_TIMECARDS.map(getWeeklyTotals);
    const grandHours = allTotals.reduce((sum, t) => sum + t.totalHours, 0);
    const grandSales = allTotals.reduce((sum, t) => sum + t.totalSales, 0);
    const grandTips  = allTotals.reduce((sum, t) => sum + t.totalTips, 0);
    const otEmployees = allTotals.filter(t => t.overtime > 0).length;

    const summary = document.createElement('div');
    summary.style.cssText = `
        display: grid; grid-template-columns: repeat(4, 1fr);
        gap: 12px; margin-top: 20px;
    `;
    summary.appendChild(buildSummaryCard('Total Hours', fmtHrs(grandHours), C.mint));
    summary.appendChild(buildSummaryCard('Total Sales', fmt$(grandSales), C.mint));
    summary.appendChild(buildSummaryCard('Total Tips', fmt$(grandTips), C.yellow));
    summary.appendChild(buildSummaryCard('OT Employees', otEmployees, otEmployees > 0 ? C.red : C.green));
    wrapper.appendChild(summary);

    // ── Legend ──
    const legend = document.createElement('div');
    legend.style.cssText = `
        margin-top: 16px; padding: 12px 20px; display: flex; gap: 24px;
        font-size: 20px; color: ${C.grey}; flex-wrap: wrap;
    `;
    legend.innerHTML = `
        <span><span style="color: ${C.mint};">■</span> Under 8h</span>
        <span><span style="color: ${C.yellow};">■</span> 8–10h</span>
        <span><span style="color: ${C.orange};">■</span> 10h+ (OT watch)</span>
        <span><span style="color: ${C.orange};">✎</span> Edited shift</span>
        <span>Click any cell to view shift details</span>
    `;
    wrapper.appendChild(legend);
}

/* ==========================================
   VIEW 3: SHIFT DETAIL
   Drill-down into individual shift
   ========================================== */
function buildShiftDetail(wrapper, shift) {
    if (!shift) return;
    wrapper.style.cssText = 'padding: 0 8px; max-width: 1000px; margin: 0 auto;';

    buildBackButton(wrapper, 'Week Grid');

    // ── Header ──
    const header = document.createElement('div');
    header.style.cssText = 'margin-bottom: 24px;';

    const dateDisplay = shift.date ? new Date(shift.date + 'T12:00:00').toLocaleDateString('en-US', {
        weekday: 'long', month: 'long', day: 'numeric', year: 'numeric'
    }) : 'Today';

    header.innerHTML = `
        <div style="font-family: var(--font-display, 'Alien Encounters', monospace);
                    font-size: 36px; color: ${C.yellow}; margin-bottom: 4px;">
            ${shift.name.split(' ')[0]} ${shift.name.split(' ').slice(1).join(' ')}
        </div>
        <div style="font-size: 25px; color: rgba(var(--color-mint-rgb), 0.5);">
            ${getRoleLabel(shift.role)} — ${dateDisplay}
        </div>
    `;
    wrapper.appendChild(header);

    // ── Shift Time Card ──
    const timeCard = document.createElement('div');
    timeCard.style.cssText = `
        background: rgba(var(--color-mint-rgb), 0.04); border: 1px solid ${C.mintBorder};
        border-radius: 10px; padding: 24px; margin-bottom: 20px;
    `;

    const editedNotice = shift.edited ? `
        <div style="margin-top: 16px; padding: 14px 16px; background: rgba(255, 165, 0, 0.08);
                    border: 1px solid rgba(255, 165, 0, 0.2); border-radius: 8px;">
            <div style="color: ${C.orange}; font-size: 22px; font-weight: bold; margin-bottom: 6px;">
                ✎ Time Adjusted by ${shift.editedBy || 'Manager'}
            </div>
            ${shift.originalClockOut ? `<div style="color: ${C.grey}; font-size: 20px; margin-bottom: 4px;">
                Original Clock Out: ${fmtTime12(shift.originalClockOut)} → Adjusted: ${fmtTime12(shift.clockOut)}
            </div>` : ''}
            ${shift.editReason ? `<div style="color: rgba(var(--color-mint-rgb), 0.6); font-size: 20px;">
                Reason: ${shift.editReason}
            </div>` : ''}
        </div>
    ` : '';

    timeCard.innerHTML = `
        <div style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 20px; margin-bottom: 20px;">
            <div>
                <div style="font-size: 20px; color: ${C.mintFaded}; text-transform: uppercase; margin-bottom: 6px;">Clock In</div>
                <div style="font-size: 28px; color: ${C.mint}; font-family: var(--font-display, monospace);">${fmtTime12(shift.clockIn)}</div>
            </div>
            <div>
                <div style="font-size: 20px; color: ${C.mintFaded}; text-transform: uppercase; margin-bottom: 6px;">Clock Out</div>
                <div style="font-size: 28px; color: ${C.mint}; font-family: var(--font-display, monospace);">${fmtTime12(shift.clockOut) || 'Still Working'}</div>
            </div>
            <div>
                <div style="font-size: 20px; color: ${C.mintFaded}; text-transform: uppercase; margin-bottom: 6px;">Total Hours</div>
                <div style="font-size: 28px; color: ${shift.hours >= 10 ? C.orange : C.yellow}; font-family: var(--font-display, monospace);">${fmtHrs(shift.hours)}</div>
            </div>
        </div>
        ${editedNotice}
    `;

    // Edit Time button
    const editBtn = document.createElement('button');
    editBtn.textContent = '✎ Edit Shift Times';
    editBtn.style.cssText = `
        background: transparent; color: ${C.yellow}; border: 1px solid ${C.yellow};
        padding: 10px 20px; border-radius: 8px; font-size: 22px; cursor: pointer;
        font-family: var(--font-body, 'Sevastopol Interface', Arial, sans-serif);
        margin-top: 16px; transition: all 0.2s ease;
    `;
    editBtn.addEventListener('mouseenter', () => { editBtn.style.background = C.yellow; editBtn.style.color = C.dark; });
    editBtn.addEventListener('mouseleave', () => { editBtn.style.background = 'transparent'; editBtn.style.color = C.yellow; });
    editBtn.addEventListener('click', () => showTimeEditModal(shift));
    timeCard.appendChild(editBtn);

    wrapper.appendChild(timeCard);

    // ── Breaks Section ──
    if (shift.breaks && shift.breaks.length > 0) {
        const breakSection = document.createElement('div');
        breakSection.style.cssText = `
            background: rgba(var(--color-mint-rgb), 0.04); border: 1px solid ${C.mintBorder};
            border-radius: 10px; overflow: hidden; margin-bottom: 20px;
        `;

        const breakHeader = document.createElement('div');
        breakHeader.style.cssText = `
            padding: 16px 20px; border-bottom: 1px solid ${C.mintBorder};
            font-family: var(--font-display, 'Alien Encounters', monospace);
            font-size: 26px; color: ${C.mint}; letter-spacing: 1px;
        `;
        breakHeader.textContent = `BREAKS [${shift.breaks.length}]`;
        breakSection.appendChild(breakHeader);

        shift.breaks.forEach((brk, i) => {
            const brkRow = document.createElement('div');
            const stripeBg = i % 2 === 0 ? 'transparent' : 'rgba(var(--color-mint-rgb), 0.03)';
            brkRow.style.cssText = `
                display: grid; grid-template-columns: 1fr 1fr 1fr 1fr;
                padding: 14px 20px; gap: 8px; background: ${stripeBg};
                border-bottom: 1px solid rgba(var(--color-mint-rgb), 0.08);
            `;

            const typeColor = brk.type === 'meal' ? C.orange : C.mint;
            const typeLabel = brk.type === 'meal' ? 'Meal Break' : 'Rest Break';
            const paidLabel = brk.paid ? 'Paid' : 'Unpaid';
            const compliance = brk.type === 'meal' && brk.duration >= 30 ? '✓' : brk.type === 'meal' ? '⚠' : '✓';

            brkRow.innerHTML = `
                <div style="color: ${typeColor}; font-size: 22px;">${typeLabel}</div>
                <div style="color: rgba(var(--color-mint-rgb), 0.6); font-size: 22px;">
                    ${fmtTime12(brk.start)} – ${fmtTime12(brk.end)}
                </div>
                <div style="color: ${C.mint}; font-size: 22px;">${brk.duration} min (${paidLabel})</div>
                <div style="color: ${compliance === '✓' ? C.green : C.orange}; font-size: 22px;">
                    ${compliance} ${compliance === '⚠' ? 'Under 30min' : 'Compliant'}
                </div>
            `;
            breakSection.appendChild(brkRow);
        });

        wrapper.appendChild(breakSection);
    }

    // ── Performance Metrics ──
    if (shift.sales > 0 || shift.tips > 0) {
        const perfSection = document.createElement('div');
        perfSection.style.cssText = `
            display: grid; grid-template-columns: repeat(4, 1fr);
            gap: 12px; margin-bottom: 20px;
        `;

        perfSection.appendChild(buildSummaryCard('Tables', shift.tables || '—', C.mint));
        perfSection.appendChild(buildSummaryCard('Sales', fmt$(shift.sales), C.mint));
        perfSection.appendChild(buildSummaryCard('Tips', fmt$(shift.tips), C.yellow));
        perfSection.appendChild(buildSummaryCard('Tip %', shift.tipPct ? shift.tipPct.toFixed(1) + '%' : '—', C.yellow));
        wrapper.appendChild(perfSection);
    }

    // ── Order Log (if available) ──
    if (shift.orders && shift.orders.length > 0) {
        const orderSection = document.createElement('div');
        orderSection.style.cssText = `
            background: rgba(var(--color-mint-rgb), 0.04); border: 1px solid ${C.mintBorder};
            border-radius: 10px; overflow: hidden;
        `;

        const orderHeader = document.createElement('div');
        orderHeader.style.cssText = `
            padding: 16px 20px; border-bottom: 1px solid ${C.mintBorder};
            font-family: var(--font-display, 'Alien Encounters', monospace);
            font-size: 26px; color: ${C.mint}; letter-spacing: 1px;
        `;
        orderHeader.textContent = `ORDER LOG [${shift.orders.length}]`;
        orderSection.appendChild(orderHeader);

        // Column headers
        const orderColHeader = document.createElement('div');
        orderColHeader.style.cssText = `
            display: grid; grid-template-columns: 1fr 1fr 0.8fr 1fr;
            padding: 12px 20px; gap: 8px;
            background: rgba(var(--color-mint-rgb), 0.08);
            border-bottom: 1px solid ${C.mintBorder};
            font-size: 20px; color: ${C.mintFaded};
            text-transform: uppercase; letter-spacing: 1px;
        `;
        ['Time', 'Table', 'Items', 'Amount'].forEach(label => {
            const cell = document.createElement('div');
            cell.textContent = label;
            orderColHeader.appendChild(cell);
        });
        orderSection.appendChild(orderColHeader);

        shift.orders.forEach((order, i) => {
            const oRow = document.createElement('div');
            const stripeBg = i % 2 === 0 ? 'transparent' : 'rgba(var(--color-mint-rgb), 0.03)';
            oRow.style.cssText = `
                display: grid; grid-template-columns: 1fr 1fr 0.8fr 1fr;
                padding: 12px 20px; gap: 8px; background: ${stripeBg};
                border-bottom: 1px solid rgba(var(--color-mint-rgb), 0.08);
            `;
            oRow.innerHTML = `
                <div style="color: rgba(var(--color-mint-rgb), 0.6); font-size: 22px;">${fmtTime12(order.time)}</div>
                <div style="color: ${C.mint}; font-size: 22px;">${order.table}</div>
                <div style="color: rgba(var(--color-mint-rgb), 0.6); font-size: 22px;">${order.items}</div>
                <div style="color: ${C.white}; font-size: 22px;">${fmt$(order.amount)}</div>
            `;
            orderSection.appendChild(oRow);
        });

        wrapper.appendChild(orderSection);
    }
}

/* ==========================================
   TIME EDIT MODAL
   Manager PIN + reason code + audit trail
   ========================================== */
function showTimeEditModal(shift) {
    if (!currentContainer) return;

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
        border-radius: 12px; width: 520px; max-width: 95vw;
        max-height: 90vh; overflow-y: auto;
        animation: modalSlideIn 0.25s ease-out;
    `;

    // Header
    const header = document.createElement('div');
    header.style.cssText = `
        padding: 20px 24px; border-bottom: 1px solid ${C.mintBorder};
        font-family: var(--font-display, 'Alien Encounters', monospace);
        font-size: 26px; color: ${C.yellow}; letter-spacing: 1px;
    `;
    header.textContent = `EDIT SHIFT: ${shift.name.split(' ')[0]} ${shift.name.split(' ').slice(1).join(' ')}`;
    modal.appendChild(header);

    // Body
    const body = document.createElement('div');
    body.style.cssText = 'padding: 24px;';

    // Current times (read-only comparison)
    body.innerHTML = `
        <div style="font-size: 20px; color: ${C.mintFaded}; text-transform: uppercase; margin-bottom: 10px;">
            ORIGINAL TIMES
        </div>
        <div style="display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 16px;
                    padding: 14px 16px; background: rgba(var(--color-mint-rgb), 0.06);
                    border: 1px solid ${C.mintBorder}; border-radius: 8px; margin-bottom: 24px;">
            <div>
                <div style="font-size: 18px; color: ${C.grey};">Clock In</div>
                <div style="font-size: 25px; color: ${C.mint};">${fmtTime12(shift.clockIn)}</div>
            </div>
            <div>
                <div style="font-size: 18px; color: ${C.grey};">Clock Out</div>
                <div style="font-size: 25px; color: ${C.mint};">${fmtTime12(shift.clockOut)}</div>
            </div>
            <div>
                <div style="font-size: 18px; color: ${C.grey};">Hours</div>
                <div style="font-size: 25px; color: ${C.mint};">${fmtHrs(shift.hours)}</div>
            </div>
        </div>

        <div style="font-size: 20px; color: ${C.mintFaded}; text-transform: uppercase; margin-bottom: 10px;">
            ADJUSTED TIMES
        </div>
    `;

    // Adjusted time inputs
    const inputRow = document.createElement('div');
    inputRow.style.cssText = 'display: flex; gap: 16px; margin-bottom: 20px;';

    const inWrap = buildTimeInput('New Clock In', 'edit-clock-in', shift.clockIn);
    const outWrap = buildTimeInput('New Clock Out', 'edit-clock-out', shift.clockOut);
    inputRow.appendChild(inWrap);
    inputRow.appendChild(outWrap);
    body.appendChild(inputRow);

    // Reason dropdown
    const reasonWrap = document.createElement('div');
    reasonWrap.style.cssText = 'margin-bottom: 20px;';
    const reasonLabel = document.createElement('div');
    reasonLabel.style.cssText = `font-size: 20px; color: ${C.mintFaded}; text-transform: uppercase; margin-bottom: 6px;`;
    reasonLabel.textContent = 'REASON FOR EDIT *';
    reasonWrap.appendChild(reasonLabel);

    const reasonSelect = document.createElement('select');
    reasonSelect.id = 'edit-reason';
    reasonSelect.style.cssText = `
        width: 100%; background: rgba(var(--color-mint-rgb), 0.06);
        border: 1px solid ${C.mintBorder}; color: ${C.mint};
        padding: 12px 14px; border-radius: 6px; font-size: 25px;
        font-family: var(--font-body, 'Sevastopol Interface', Arial, sans-serif);
        cursor: pointer; appearance: auto;
    `;
    reasonSelect.innerHTML = `<option value="">Select reason...</option>` +
        EDIT_REASONS.map(r => `<option value="${r.id}">${r.label}</option>`).join('');
    reasonWrap.appendChild(reasonSelect);
    body.appendChild(reasonWrap);

    // Notes
    const notesWrap = document.createElement('div');
    notesWrap.style.cssText = 'margin-bottom: 20px;';
    notesWrap.innerHTML = `
        <div style="font-size: 20px; color: ${C.mintFaded}; text-transform: uppercase; margin-bottom: 6px;">
            NOTES (OPTIONAL)
        </div>
        <textarea id="edit-notes" rows="2" style="
            width: 100%; box-sizing: border-box;
            background: rgba(var(--color-mint-rgb), 0.06);
            border: 1px solid ${C.mintBorder}; color: ${C.mint};
            padding: 12px 14px; border-radius: 6px; font-size: 25px;
            font-family: var(--font-body, 'Sevastopol Interface', Arial, sans-serif);
            resize: vertical;
        "></textarea>
    `;
    body.appendChild(notesWrap);

    // Manager PIN
    const pinWrap = document.createElement('div');
    pinWrap.style.cssText = 'margin-bottom: 16px;';
    pinWrap.innerHTML = `
        <div style="font-size: 20px; color: ${C.mintFaded}; text-transform: uppercase; margin-bottom: 6px;">
            MANAGER PIN *
        </div>
        <input type="password" id="edit-manager-pin" maxlength="6" placeholder="Enter manager PIN"
               style="width: 200px; box-sizing: border-box;
                      background: rgba(var(--color-mint-rgb), 0.06);
                      border: 1px solid ${C.mintBorder}; color: ${C.mint};
                      padding: 12px 14px; border-radius: 6px; font-size: 25px;
                      font-family: var(--font-body, 'Sevastopol Interface', Arial, sans-serif);
                      letter-spacing: 4px;" />
    `;
    body.appendChild(pinWrap);

    // Audit trail notice
    const notice = document.createElement('div');
    notice.style.cssText = `
        padding: 12px 16px; background: rgba(var(--color-mint-rgb), 0.06);
        border: 1px solid ${C.mintBorder}; border-radius: 8px;
        color: ${C.grey}; font-size: 20px; line-height: 1.5;
    `;
    notice.innerHTML = `🔒 This edit creates a permanent <span style="color: ${C.mint};">SHIFT_TIME_ADJUSTED</span> event in the audit trail. Original times are preserved and can never be deleted.`;
    body.appendChild(notice);

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

    const saveBtn = document.createElement('button');
    saveBtn.textContent = 'Apply Edit';
    saveBtn.style.cssText = `
        background: ${C.yellow}; color: ${C.dark}; border: none;
        padding: 12px 28px; border-radius: 8px; font-size: 25px; cursor: pointer;
        font-family: var(--font-body, 'Sevastopol Interface', Arial, sans-serif);
        font-weight: bold;
    `;
    saveBtn.addEventListener('click', () => {
        const reason = backdrop.querySelector('#edit-reason')?.value;
        const pin = backdrop.querySelector('#edit-manager-pin')?.value;
        const newIn = backdrop.querySelector('#edit-clock-in')?.value;
        const newOut = backdrop.querySelector('#edit-clock-out')?.value;
        const notes = backdrop.querySelector('#edit-notes')?.value;

        if (!reason) { showToast('Please select a reason for this edit.', 'error'); return; }
        if (!pin || pin.length < 4) { showToast('Manager PIN is required.', 'error'); return; }

        emitEvent('SHIFT_TIME_ADJUSTED', {
            shift_id: shift.shift_id,
            employee_id: shift.employee_id,
            original_clock_in: shift.clockIn,
            original_clock_out: shift.clockOut,
            adjusted_clock_in: newIn,
            adjusted_clock_out: newOut,
            reason_code: reason,
            notes: notes || null,
            manager_pin_verified: true,
        });

        backdrop.remove();
        showToast(`Shift times adjusted for ${shift.name.split(' ')[0]} ${shift.name.split(' ').slice(1).join(' ')}`, 'success');
    });

    footer.appendChild(cancelBtn);
    footer.appendChild(saveBtn);
    modal.appendChild(footer);

    backdrop.appendChild(modal);
    backdrop.addEventListener('click', (e) => { if (e.target === backdrop) backdrop.remove(); });

    const escHandler = (e) => {
        if (e.key === 'Escape') { backdrop.remove(); document.removeEventListener('keydown', escHandler); }
    };
    document.addEventListener('keydown', escHandler);

    currentContainer.appendChild(backdrop);
}

/* ------------------------------------------
   REUSABLE UI COMPONENTS
------------------------------------------ */
function buildTab(label, active, onClick) {
    const tab = document.createElement('button');
    tab.textContent = label;
    tab.style.cssText = `
        padding: 12px 24px; border-radius: 8px; font-size: 22px; cursor: pointer;
        font-family: var(--font-body, 'Sevastopol Interface', Arial, sans-serif);
        transition: all 0.2s ease; border: 1px solid ${active ? C.mint : C.mintBorder};
        background: ${active ? C.mint : 'transparent'};
        color: ${active ? C.dark : C.mint};
        font-weight: ${active ? 'bold' : 'normal'};
    `;
    if (!active && onClick) {
        tab.addEventListener('click', onClick);
        tab.addEventListener('mouseenter', () => tab.style.background = C.mintHover);
        tab.addEventListener('mouseleave', () => tab.style.background = 'transparent');
    }
    return tab;
}

function buildSummaryCard(label, value, color) {
    const card = document.createElement('div');
    card.style.cssText = `
        background: rgba(var(--color-mint-rgb), 0.04); border: 1px solid ${C.mintBorder};
        border-radius: 10px; padding: 16px 20px; text-align: center;
    `;
    card.innerHTML = `
        <div style="font-size: 20px; color: ${C.mintFaded}; text-transform: uppercase;
                    letter-spacing: 0.5px; margin-bottom: 8px;">${label}</div>
        <div style="font-size: 32px; color: ${color};
                    font-family: var(--font-display, monospace);">${value}</div>
    `;
    return card;
}

function buildTimeInput(label, id, value) {
    const wrap = document.createElement('div');
    wrap.style.cssText = 'flex: 1;';
    wrap.innerHTML = `
        <div style="font-size: 18px; color: ${C.grey}; margin-bottom: 6px;">${label}</div>
        <input type="time" id="${id}" value="${value || ''}"
               style="width: 100%; box-sizing: border-box;
                      background: rgba(var(--color-mint-rgb), 0.06);
                      border: 1px solid ${C.mintBorder}; color: ${C.mint};
                      padding: 12px 14px; border-radius: 6px; font-size: 25px;
                      font-family: var(--font-body, 'Sevastopol Interface', Arial, sans-serif);" />
    `;
    return wrap;
}

/* ==========================================
   EXPORTS — Scene builder + cleanup
   Called from employees.js:
     import { buildTimeAttendanceScene, cleanupTimeAttendance } from './time-attendance.js';
   ========================================== */
export function buildTimeAttendanceScene(container) {
    currentContainer = container;
    viewHistory = [];

    const viewWrapper = document.createElement('div');
    viewWrapper.id = 'ta-view-wrapper';
    container.appendChild(viewWrapper);

    pushView('live-dashboard');
}

export function cleanupTimeAttendance(container) {
    stopClockRefresh();
    if (container) container.innerHTML = '';
    viewHistory = [];
    currentContainer = null;
}