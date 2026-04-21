import { pushChanges } from '../services/config-push.js';
/* ============================================
   KINDpos Overseer — Shift Configuration

   View Stack:
     daily-timeline → shift-templates → swap-queue

   Features:
     - Gantt-style daily timeline (scheduled vs actual)
     - Shift templates (reusable patterns)
     - Swap request approval queue
     - Coverage analysis (minimum staffing)

   "Nice. Dependable. Yours."
   ============================================ */

import {
    SHIFT_TEMPLATES, TODAYS_SCHEDULE, SWAP_REQUESTS,
    COVERAGE_REQUIREMENTS, GANTT_CONFIG,
    timeToPercent, barWidth,
    SHIFT_STATUSES, SWAP_STATUSES,
} from '../data/sample-shifts.js';
import { getRoleLabel } from '../data/sample-employees.js';

/* ------------------------------------------
   COLOR PALETTE
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
    blue:       '#64B5F6',
    backdrop:   'rgba(0, 0, 0, 0.75)',
};

/* ------------------------------------------
   MODULE STATE
------------------------------------------ */
let viewHistory = [];
let currentContainer = null;
let swapRequests = null; // mutable working copy

const VIEW_REGISTRY = {
    'daily-timeline':  buildDailyTimeline,
    'shift-templates': buildShiftTemplates,
    'swap-queue':      buildSwapQueue,
};

/* ------------------------------------------
   VIEW STACK
------------------------------------------ */
function pushView(viewName, data) {
    if (!currentContainer) return;
    const wrapper = currentContainer.querySelector('#sc-view-wrapper');
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
    viewHistory.pop();
    pushView(prev.name, prev.data);
}

/* ------------------------------------------
   BACK BUTTON
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
   TOAST
------------------------------------------ */
function showToast(message, type = 'success') {
    if (!currentContainer) return;
    const old = currentContainer.querySelector('.sc-toast');
    if (old) old.remove();

    const colors = {
        success: { bg: 'rgba(0, 255, 0, 0.15)', border: C.green, text: C.green },
        error:   { bg: 'rgba(var(--color-vermillion-rgb), 0.15)', border: C.red, text: C.red },
        info:    { bg: 'rgba(var(--color-mint-rgb), 0.15)', border: C.mint, text: C.mint },
        warning: { bg: 'rgba(255, 165, 0, 0.15)', border: C.orange, text: C.orange },
    };
    const tc = colors[type] || colors.info;

    const toast = document.createElement('div');
    toast.className = 'sc-toast';
    toast.style.cssText = `
        position: fixed; top: 24px; right: 24px; z-index: 10000;
        background: ${tc.bg}; border: 1px solid ${tc.border};
        color: ${tc.text}; padding: 14px 24px; border-radius: 8px;
        font-family: var(--font-body, 'Sevastopol Interface', Arial, sans-serif);
        font-size: 25px; backdrop-filter: blur(8px);
        animation: toastSlideIn 0.3s ease-out; max-width: 450px;
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
function fmtTime12(time24) {
    if (!time24) return '—';
    const [h, m] = time24.split(':').map(Number);
    const ampm = h >= 12 ? 'PM' : 'AM';
    const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
    return `${h12}:${String(m).padStart(2, '0')} ${ampm}`;
}

function fmtDateShort(dateStr) {
    if (!dateStr) return '—';
    const d = new Date(dateStr + 'T12:00:00');
    return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
}

function timeAgo(isoStr) {
    const now = new Date();
    const then = new Date(isoStr);
    const diffH = Math.floor((now - then) / 3600000);
    if (diffH < 1) return 'Just now';
    if (diffH < 24) return `${diffH}h ago`;
    const diffD = Math.floor(diffH / 24);
    return `${diffD}d ago`;
}

/* ==========================================
   VIEW 1: DAILY TIMELINE (Gantt-style)
   ========================================== */
function buildDailyTimeline(wrapper) {
    wrapper.style.cssText = 'padding: 0 8px; max-width: 1200px; margin: 0 auto;';

    const todayDate = new Date().toLocaleDateString('en-US', {
        weekday: 'long', month: 'long', day: 'numeric', year: 'numeric'
    });

    // ── Header ──
    const header = document.createElement('div');
    header.style.cssText = `
        display: flex; justify-content: space-between; align-items: flex-start;
        margin-bottom: 24px; flex-wrap: wrap; gap: 12px;
    `;
    header.innerHTML = `
        <div>
            <div style="font-family: var(--font-display, 'Alien Encounters', monospace);
                        font-size: 36px; color: ${C.yellow};">
                Shift Configuration
            </div>
            <div style="font-size: 25px; color: rgba(var(--color-mint-rgb), 0.5); margin-top: 4px;">
                ${todayDate}
            </div>
        </div>
    `;
    wrapper.appendChild(header);

    // ── Navigation Tabs ──
    const tabs = document.createElement('div');
    tabs.style.cssText = 'display: flex; gap: 12px; margin-bottom: 24px; flex-wrap: wrap;';

    const pendingCount = swapRequests.filter(s => s.status === 'pending').length;
    const swapLabel = pendingCount > 0 ? `Swap Queue (${pendingCount})` : 'Swap Queue';

    tabs.appendChild(buildTab('Daily Timeline', true));
    tabs.appendChild(buildTab('Shift Templates', false, () => pushView('shift-templates')));
    tabs.appendChild(buildTab(swapLabel, false, () => pushView('swap-queue')));
    wrapper.appendChild(tabs);

    // ── Summary Cards ──
    const active = TODAYS_SCHEDULE.filter(s => s.status === 'active').length;
    const upcoming = TODAYS_SCHEDULE.filter(s => s.status === 'upcoming').length;
    const totalScheduled = TODAYS_SCHEDULE.length;

    // Check early/late arrivals
    const lateArrivals = TODAYS_SCHEDULE.filter(s => {
        if (!s.actualStart || s.status !== 'active') return false;
        return s.actualStart > s.scheduledStart;
    });
    const earlyArrivals = TODAYS_SCHEDULE.filter(s => {
        if (!s.actualStart || s.status !== 'active') return false;
        return s.actualStart < s.scheduledStart;
    });

    const cards = document.createElement('div');
    cards.style.cssText = 'display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; margin-bottom: 24px;';
    cards.appendChild(buildSummaryCard('Scheduled', totalScheduled, C.mint));
    cards.appendChild(buildSummaryCard('Active', active, C.green));
    cards.appendChild(buildSummaryCard('Upcoming', upcoming, C.blue));
    cards.appendChild(buildSummaryCard('Late Arrivals', lateArrivals.length, lateArrivals.length > 0 ? C.orange : C.green));
    wrapper.appendChild(cards);

    // ── Gantt Chart ──
    const ganttSection = document.createElement('div');
    ganttSection.style.cssText = `
        background: rgba(var(--color-mint-rgb), 0.04); border: 1px solid ${C.mintBorder};
        border-radius: 10px; overflow: hidden; margin-bottom: 20px;
    `;

    const ganttHeader = document.createElement('div');
    ganttHeader.style.cssText = `
        padding: 16px 20px; border-bottom: 1px solid ${C.mintBorder};
        font-family: var(--font-display, 'Alien Encounters', monospace);
        font-size: 26px; color: ${C.mint}; letter-spacing: 1px;
        display: flex; justify-content: space-between; align-items: center;
    `;
    ganttHeader.innerHTML = `
        <span>TODAY'S TIMELINE</span>
        <span style="font-size: 20px; color: ${C.grey};">Scheduled vs Actual</span>
    `;
    ganttSection.appendChild(ganttHeader);

    // Time axis header
    const axisRow = document.createElement('div');
    axisRow.style.cssText = `
        display: grid; grid-template-columns: 180px 1fr;
        padding: 10px 20px; gap: 12px;
        background: rgba(var(--color-mint-rgb), 0.06);
        border-bottom: 1px solid ${C.mintBorder};
    `;
    const axisLabel = document.createElement('div');
    axisLabel.style.cssText = `font-size: 20px; color: ${C.mintFaded}; text-transform: uppercase;`;
    axisLabel.textContent = 'Employee';
    axisRow.appendChild(axisLabel);

    const axis = document.createElement('div');
    axis.style.cssText = 'position: relative; height: 28px;';

    // Hour markers
    for (let h = GANTT_CONFIG.startHour; h <= GANTT_CONFIG.endHour; h += 2) {
        const displayH = h > 24 ? h - 24 : h;
        const pct = ((h - GANTT_CONFIG.startHour) / GANTT_CONFIG.totalHours) * 100;
        const marker = document.createElement('div');
        marker.style.cssText = `
            position: absolute; left: ${pct}%; transform: translateX(-50%);
            font-size: 18px; color: ${C.mintFaded}; white-space: nowrap;
        `;
        const ampm = displayH >= 12 ? 'p' : 'a';
        const h12 = displayH === 0 ? 12 : displayH > 12 ? displayH - 12 : displayH;
        marker.textContent = `${h12}${ampm}`;
        axis.appendChild(marker);
    }
    axisRow.appendChild(axis);
    ganttSection.appendChild(axisRow);

    // "Now" line position
    const now = new Date();
    let nowHour = now.getHours() + now.getMinutes() / 60;
    if (nowHour < GANTT_CONFIG.startHour) nowHour += 24;
    const nowPct = ((nowHour - GANTT_CONFIG.startHour) / GANTT_CONFIG.totalHours) * 100;

    // Employee rows
    TODAYS_SCHEDULE.forEach((shift, i) => {
        const stripeBg = i % 2 === 0 ? 'transparent' : 'rgba(var(--color-mint-rgb), 0.03)';
        const row = document.createElement('div');
        row.style.cssText = `
            display: grid; grid-template-columns: 180px 1fr;
            padding: 14px 20px; gap: 12px; align-items: center;
            border-bottom: 1px solid rgba(var(--color-mint-rgb), 0.08);
            background: ${stripeBg};
        `;

        // Name cell
        const nameCell = document.createElement('div');
        const statusInfo = SHIFT_STATUSES[shift.status] || { label: shift.status, color: C.grey };
        nameCell.innerHTML = `
            <div style="font-size: 22px; color: ${C.white};">${shift.name || ''}</div>
            <div style="font-size: 18px; color: ${statusInfo.color};">${getRoleLabel(shift.role)} · ${statusInfo.label}</div>
        `;
        row.appendChild(nameCell);

        // Gantt cell
        const ganttCell = document.createElement('div');
        ganttCell.style.cssText = 'position: relative; height: 44px; background: rgba(var(--color-mint-rgb), 0.04); border-radius: 6px; overflow: hidden;';

        // Hour gridlines
        for (let h = GANTT_CONFIG.startHour; h <= GANTT_CONFIG.endHour; h += 2) {
            const pct = ((h - GANTT_CONFIG.startHour) / GANTT_CONFIG.totalHours) * 100;
            const line = document.createElement('div');
            line.style.cssText = `
                position: absolute; left: ${pct}%; top: 0; bottom: 0; width: 1px;
                background: rgba(var(--color-mint-rgb), 0.08);
            `;
            ganttCell.appendChild(line);
        }

        // Scheduled bar (background, dimmed)
        const schedLeft = timeToPercent(shift.scheduledStart);
        const schedWidth = barWidth(shift.scheduledStart, shift.scheduledEnd);
        const schedBar = document.createElement('div');
        schedBar.style.cssText = `
            position: absolute; top: 4px; height: 16px;
            left: ${schedLeft}%; width: ${schedWidth}%;
            background: rgba(255, 255, 255, 0.08); border-radius: 4px;
            border: 1px dashed rgba(255, 255, 255, 0.2);
        `;
        schedBar.title = `Scheduled: ${fmtTime12(shift.scheduledStart)} – ${fmtTime12(shift.scheduledEnd)}`;
        ganttCell.appendChild(schedBar);

        // Actual bar (solid, colored)
        if (shift.actualStart) {
            const actualEnd = shift.actualEnd || `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
            const actLeft = timeToPercent(shift.actualStart);
            const actWidth = barWidth(shift.actualStart, actualEnd);

            const actBar = document.createElement('div');
            actBar.style.cssText = `
                position: absolute; top: 24px; height: 16px;
                left: ${actLeft}%; width: ${actWidth}%;
                background: ${shift.color}; border-radius: 4px;
                opacity: 0.85;
            `;
            actBar.title = `Actual: ${fmtTime12(shift.actualStart)} – ${shift.actualEnd ? fmtTime12(shift.actualEnd) : 'Now'}`;
            ganttCell.appendChild(actBar);

            // Late/Early indicator
            if (shift.actualStart > shift.scheduledStart) {
                const lateDot = document.createElement('div');
                lateDot.style.cssText = `
                    position: absolute; top: 26px; left: ${actLeft - 1.5}%;
                    width: 12px; height: 12px; background: ${C.orange};
                    border-radius: 50%; border: 2px solid ${C.dark};
                `;
                lateDot.title = `Late: arrived ${fmtTime12(shift.actualStart)} (scheduled ${fmtTime12(shift.scheduledStart)})`;
                ganttCell.appendChild(lateDot);
            } else if (shift.actualStart < shift.scheduledStart) {
                const earlyDot = document.createElement('div');
                earlyDot.style.cssText = `
                    position: absolute; top: 26px; left: ${actLeft - 1.5}%;
                    width: 12px; height: 12px; background: ${C.green};
                    border-radius: 50%; border: 2px solid ${C.dark};
                `;
                earlyDot.title = `Early: arrived ${fmtTime12(shift.actualStart)} (scheduled ${fmtTime12(shift.scheduledStart)})`;
                ganttCell.appendChild(earlyDot);
            }
        }

        // "Now" line
        if (nowPct > 0 && nowPct < 100) {
            const nowLine = document.createElement('div');
            nowLine.style.cssText = `
                position: absolute; left: ${nowPct}%; top: 0; bottom: 0;
                width: 2px; background: ${C.red}; z-index: 2;
            `;
            ganttCell.appendChild(nowLine);
        }

        row.appendChild(ganttCell);
        ganttSection.appendChild(row);
    });

    wrapper.appendChild(ganttSection);

    // ── Legend ──
    const legend = document.createElement('div');
    legend.style.cssText = `
        display: flex; gap: 24px; font-size: 20px; color: ${C.grey};
        flex-wrap: wrap; margin-bottom: 20px;
    `;
    legend.innerHTML = `
        <span><span style="display: inline-block; width: 24px; height: 10px; background: rgba(255,255,255,0.08);
              border: 1px dashed rgba(255,255,255,0.2); border-radius: 3px; vertical-align: middle; margin-right: 6px;"></span> Scheduled</span>
        <span><span style="display: inline-block; width: 24px; height: 10px; background: ${C.mint};
              border-radius: 3px; vertical-align: middle; margin-right: 6px;"></span> Actual</span>
        <span><span style="display: inline-block; width: 10px; height: 10px; background: ${C.orange};
              border-radius: 50%; vertical-align: middle; margin-right: 6px;"></span> Late</span>
        <span><span style="display: inline-block; width: 10px; height: 10px; background: ${C.green};
              border-radius: 50%; vertical-align: middle; margin-right: 6px;"></span> Early</span>
        <span><span style="display: inline-block; width: 2px; height: 14px; background: ${C.red};
              vertical-align: middle; margin-right: 6px;"></span> Now</span>
    `;
    wrapper.appendChild(legend);

    // ── Coverage Analysis ──
    buildCoverageAnalysis(wrapper);
}

/* ------------------------------------------
   COVERAGE ANALYSIS
   Minimum staffing vs actual
------------------------------------------ */
function buildCoverageAnalysis(wrapper) {
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
    `;
    sectionHeader.textContent = 'COVERAGE ANALYSIS';
    section.appendChild(sectionHeader);

    // Column headers
    const colHeader = document.createElement('div');
    colHeader.style.cssText = `
        display: grid; grid-template-columns: 1.5fr repeat(5, 1fr) 0.8fr;
        padding: 14px 20px; gap: 8px;
        background: rgba(var(--color-mint-rgb), 0.08);
        border-bottom: 1px solid ${C.mintBorder};
        font-size: 20px; color: ${C.mintFaded};
        text-transform: uppercase; letter-spacing: 1px;
    `;
    ['Daypart', 'Manager', 'Server', 'Bartender', 'Host', 'Busser', 'Status'].forEach(label => {
        const cell = document.createElement('div');
        cell.textContent = label;
        cell.style.cssText = 'text-align: center;';
        if (label === 'Daypart') cell.style.textAlign = 'left';
        colHeader.appendChild(cell);
    });
    section.appendChild(colHeader);

    // Analyze each daypart
    const now = new Date();
    const currentHour = now.getHours();

    COVERAGE_REQUIREMENTS.dayparts.forEach((dp, i) => {
        const stripeBg = i % 2 === 0 ? 'transparent' : 'rgba(var(--color-mint-rgb), 0.03)';

        // Count scheduled staff for this daypart
        const scheduled = { manager: 0, server: 0, bartender: 0, host: 0, busser: 0 };
        TODAYS_SCHEDULE.forEach(shift => {
            const [sh] = shift.scheduledStart.split(':').map(Number);
            const [eh] = shift.scheduledEnd.split(':').map(Number);
            let endH = eh < sh ? eh + 24 : eh;

            if (sh <= dp.endHour && endH >= dp.startHour) {
                const roles = Array.isArray(shift.role) ? shift.role : [shift.role];
                roles.forEach(r => { if (scheduled[r] !== undefined) scheduled[r]++; });
            }
        });

        // Check if current daypart
        let isActive = false;
        if (dp.endHour > dp.startHour) {
            isActive = currentHour >= dp.startHour && currentHour < dp.endHour;
        } else {
            isActive = currentHour >= dp.startHour || currentHour < dp.endHour;
        }

        let hasGap = false;
        const roles = ['manager', 'server', 'bartender', 'host', 'busser'];

        const row = document.createElement('div');
        row.style.cssText = `
            display: grid; grid-template-columns: 1.5fr repeat(5, 1fr) 0.8fr;
            padding: 16px 20px; gap: 8px; align-items: center;
            border-bottom: 1px solid rgba(var(--color-mint-rgb), 0.08);
            background: ${stripeBg};
        `;

        // Daypart label
        const dpCell = document.createElement('div');
        dpCell.innerHTML = `
            <div style="font-size: 25px; color: ${isActive ? C.white : C.grey};">
                ${dp.name}${isActive ? ' <span style="font-size: 16px; color: ' + C.green + '; vertical-align: middle;">● NOW</span>' : ''}
            </div>
            <div style="font-size: 18px; color: ${C.grey};">
                ${fmtTime12(String(dp.startHour).padStart(2, '0') + ':00')} – ${fmtTime12(String(dp.endHour > 23 ? dp.endHour - 24 : dp.endHour).padStart(2, '0') + ':00')}
            </div>
        `;
        row.appendChild(dpCell);

        // Role cells
        roles.forEach(role => {
            const min = dp.minimum[role];
            const actual = scheduled[role];
            const cell = document.createElement('div');
            cell.style.cssText = 'text-align: center;';

            if (min === 0 && actual === 0) {
                cell.innerHTML = `<span style="font-size: 22px; color: ${C.grey};">—</span>`;
            } else {
                const isMet = actual >= min;
                if (!isMet) hasGap = true;
                const cellColor = isMet ? C.green : C.red;
                cell.innerHTML = `
                    <span style="font-size: 25px; color: ${cellColor}; font-weight: bold;">${actual}</span>
                    <span style="font-size: 18px; color: ${C.grey};">/ ${min}</span>
                `;
            }
            row.appendChild(cell);
        });

        // Status
        const statusCell = document.createElement('div');
        statusCell.style.cssText = 'text-align: center;';
        if (hasGap) {
            statusCell.innerHTML = `<span style="font-size: 20px; color: ${C.red};">⚠ GAP</span>`;
        } else {
            statusCell.innerHTML = `<span style="font-size: 20px; color: ${C.green};">✓</span>`;
        }
        row.appendChild(statusCell);

        section.appendChild(row);
    });

    wrapper.appendChild(section);
}

/* ==========================================
   VIEW 2: SHIFT TEMPLATES
   Reusable shift patterns
   ========================================== */
function buildShiftTemplates(wrapper) {
    wrapper.style.cssText = 'padding: 0 8px; max-width: 1100px; margin: 0 auto;';

    buildBackButton(wrapper, 'Daily Timeline');

    // ── Header ──
    const header = document.createElement('div');
    header.style.cssText = 'margin-bottom: 24px;';
    header.innerHTML = `
        <div style="font-family: var(--font-display, 'Alien Encounters', monospace);
                    font-size: 36px; color: ${C.yellow}; margin-bottom: 4px;">
            Shift Templates
        </div>
        <div style="font-size: 25px; color: rgba(var(--color-mint-rgb), 0.5);">
            Reusable shift patterns for scheduling
        </div>
    `;
    wrapper.appendChild(header);

    // ── Add Template Button ──
    const addBtn = document.createElement('button');
    addBtn.textContent = '+ Create New Template';
    addBtn.style.cssText = `
        background: ${C.mint}; color: ${C.dark}; border: none;
        padding: 14px 28px; border-radius: 8px; font-size: 25px;
        cursor: pointer; font-weight: bold; margin-bottom: 24px;
        font-family: var(--font-body, 'Sevastopol Interface', Arial, sans-serif);
        transition: all 0.2s ease;
    `;
    addBtn.addEventListener('click', () => {
        showToast('Template editor coming in next build', 'info');
    });
    wrapper.appendChild(addBtn);

    // ── Template Cards Grid ──
    const grid = document.createElement('div');
    grid.style.cssText = `
        display: grid; grid-template-columns: repeat(auto-fill, minmax(340px, 1fr));
        gap: 16px;
    `;

    SHIFT_TEMPLATES.forEach(tmpl => {
        const card = document.createElement('div');
        card.style.cssText = `
            background: rgba(var(--color-mint-rgb), 0.04);
            border: 1px solid ${C.mintBorder};
            border-left: 4px solid ${tmpl.color};
            border-radius: 10px; padding: 24px;
            transition: all 0.2s ease;
        `;
        card.addEventListener('mouseenter', () => card.style.background = C.mintHover);
        card.addEventListener('mouseleave', () => card.style.background = 'rgba(var(--color-mint-rgb), 0.04)');

        const rolesHTML = tmpl.roles.map(r =>
            `<span style="font-size: 18px; color: ${C.mint}; background: rgba(var(--color-mint-rgb), 0.1);
                          padding: 4px 10px; border-radius: 4px;">${getRoleLabel(r)}</span>`
        ).join(' ');

        card.innerHTML = `
            <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 12px;">
                <div style="font-size: 25px; color: ${C.white}; font-weight: bold;">${tmpl.name}</div>
                <div style="font-size: 28px; color: ${tmpl.color}; font-family: var(--font-display, monospace);">
                    ${tmpl.duration}h
                </div>
            </div>
            <div style="font-size: 22px; color: ${C.mint}; margin-bottom: 10px;">
                ${fmtTime12(tmpl.startTime)} – ${fmtTime12(tmpl.endTime)}
            </div>
            <div style="font-size: 20px; color: ${C.grey}; margin-bottom: 14px;">
                ${tmpl.description}
            </div>
            <div style="display: flex; gap: 8px; flex-wrap: wrap;">
                ${rolesHTML}
            </div>
        `;

        grid.appendChild(card);
    });

    wrapper.appendChild(grid);

    // ── Visual timeline preview ──
    const previewSection = document.createElement('div');
    previewSection.style.cssText = `
        margin-top: 24px; background: rgba(var(--color-mint-rgb), 0.04); border: 1px solid ${C.mintBorder};
        border-radius: 10px; overflow: hidden;
    `;

    const previewHeader = document.createElement('div');
    previewHeader.style.cssText = `
        padding: 16px 20px; border-bottom: 1px solid ${C.mintBorder};
        font-family: var(--font-display, 'Alien Encounters', monospace);
        font-size: 26px; color: ${C.mint}; letter-spacing: 1px;
    `;
    previewHeader.textContent = 'TEMPLATE TIMELINE';
    previewSection.appendChild(previewHeader);

    // Time axis
    const previewAxis = document.createElement('div');
    previewAxis.style.cssText = `
        padding: 10px 20px; position: relative; height: 28px;
        background: rgba(var(--color-mint-rgb), 0.06); border-bottom: 1px solid ${C.mintBorder};
    `;
    for (let h = GANTT_CONFIG.startHour; h <= GANTT_CONFIG.endHour; h += 2) {
        const displayH = h > 24 ? h - 24 : h;
        const pct = ((h - GANTT_CONFIG.startHour) / GANTT_CONFIG.totalHours) * 100;
        const marker = document.createElement('div');
        marker.style.cssText = `
            position: absolute; left: ${pct}%; transform: translateX(-50%);
            font-size: 18px; color: ${C.mintFaded};
        `;
        const ampm = displayH >= 12 ? 'p' : 'a';
        const h12 = displayH === 0 ? 12 : displayH > 12 ? displayH - 12 : displayH;
        marker.textContent = `${h12}${ampm}`;
        previewAxis.appendChild(marker);
    }
    previewSection.appendChild(previewAxis);

    // Template bars
    SHIFT_TEMPLATES.forEach((tmpl, i) => {
        const row = document.createElement('div');
        const stripeBg = i % 2 === 0 ? 'transparent' : 'rgba(var(--color-mint-rgb), 0.03)';
        row.style.cssText = `
            display: grid; grid-template-columns: 160px 1fr;
            padding: 10px 20px; gap: 12px; align-items: center;
            border-bottom: 1px solid rgba(var(--color-mint-rgb), 0.08);
            background: ${stripeBg};
        `;

        const label = document.createElement('div');
        label.style.cssText = `font-size: 20px; color: ${tmpl.color};`;
        label.textContent = tmpl.name;
        row.appendChild(label);

        const barContainer = document.createElement('div');
        barContainer.style.cssText = 'position: relative; height: 24px;';

        const left = timeToPercent(tmpl.startTime);
        const width = barWidth(tmpl.startTime, tmpl.endTime);
        const bar = document.createElement('div');
        bar.style.cssText = `
            position: absolute; top: 2px; height: 20px; border-radius: 4px;
            left: ${left}%; width: ${width}%;
            background: ${tmpl.color}; opacity: 0.7;
        `;
        bar.title = `${tmpl.name}: ${fmtTime12(tmpl.startTime)} – ${fmtTime12(tmpl.endTime)} (${tmpl.duration}h)`;
        barContainer.appendChild(bar);

        row.appendChild(barContainer);
        previewSection.appendChild(row);
    });

    wrapper.appendChild(previewSection);
}

/* ==========================================
   VIEW 3: SWAP QUEUE
   Approve/deny shift swap requests
   ========================================== */
function buildSwapQueue(wrapper) {
    wrapper.style.cssText = 'padding: 0 8px; max-width: 1100px; margin: 0 auto;';

    buildBackButton(wrapper, 'Daily Timeline');

    // ── Header ──
    const header = document.createElement('div');
    header.style.cssText = 'margin-bottom: 24px;';

    const pending = swapRequests.filter(s => s.status === 'pending');
    const resolved = swapRequests.filter(s => s.status !== 'pending');

    header.innerHTML = `
        <div style="font-family: var(--font-display, 'Alien Encounters', monospace);
                    font-size: 36px; color: ${C.yellow}; margin-bottom: 4px;">
            Shift Swap Queue
        </div>
        <div style="font-size: 25px; color: rgba(var(--color-mint-rgb), 0.5);">
            ${pending.length} pending · ${resolved.length} resolved
        </div>
    `;
    wrapper.appendChild(header);

    // ── Pending Requests ──
    if (pending.length > 0) {
        const pendingSection = document.createElement('div');
        pendingSection.style.cssText = `
            background: rgba(var(--color-mint-rgb), 0.04); border: 1px solid ${C.mintBorder};
            border-radius: 10px; overflow: hidden; margin-bottom: 24px;
        `;

        const pendHeader = document.createElement('div');
        pendHeader.style.cssText = `
            padding: 16px 20px; border-bottom: 1px solid ${C.mintBorder};
            font-family: var(--font-display, 'Alien Encounters', monospace);
            font-size: 26px; color: ${C.yellow}; letter-spacing: 1px;
        `;
        pendHeader.textContent = `PENDING APPROVAL [${pending.length}]`;
        pendingSection.appendChild(pendHeader);

        pending.forEach(swap => {
            pendingSection.appendChild(buildSwapCard(swap, true));
        });
        wrapper.appendChild(pendingSection);
    } else {
        const emptyMsg = document.createElement('div');
        emptyMsg.style.cssText = `
            text-align: center; padding: 40px 20px; color: ${C.green};
            font-size: 25px; margin-bottom: 24px;
            background: rgba(0, 255, 0, 0.04); border: 1px solid rgba(0, 255, 0, 0.15);
            border-radius: 10px;
        `;
        emptyMsg.textContent = '✓ No pending swap requests';
        wrapper.appendChild(emptyMsg);
    }

    // ── Resolved History ──
    if (resolved.length > 0) {
        const resolvedSection = document.createElement('div');
        resolvedSection.style.cssText = `
            background: rgba(var(--color-mint-rgb), 0.04); border: 1px solid ${C.mintBorder};
            border-radius: 10px; overflow: hidden;
        `;

        const resHeader = document.createElement('div');
        resHeader.style.cssText = `
            padding: 16px 20px; border-bottom: 1px solid ${C.mintBorder};
            font-family: var(--font-display, 'Alien Encounters', monospace);
            font-size: 26px; color: ${C.grey}; letter-spacing: 1px;
        `;
        resHeader.textContent = `HISTORY [${resolved.length}]`;
        resolvedSection.appendChild(resHeader);

        resolved.forEach(swap => {
            resolvedSection.appendChild(buildSwapCard(swap, false));
        });
        wrapper.appendChild(resolvedSection);
    }
}

/* ------------------------------------------
   SWAP CARD BUILDER
------------------------------------------ */
function buildSwapCard(swap, showActions) {
    const card = document.createElement('div');
    card.style.cssText = `
        padding: 20px; border-bottom: 1px solid rgba(var(--color-mint-rgb), 0.08);
    `;

    const statusInfo = SWAP_STATUSES[swap.status] || { label: swap.status, color: C.grey };

    // Swap details
    const topRow = document.createElement('div');
    topRow.style.cssText = `
        display: flex; justify-content: space-between; align-items: flex-start;
        margin-bottom: 14px; flex-wrap: wrap; gap: 8px;
    `;

    const isOpenSwap = !swap.swapWith;

    topRow.innerHTML = `
        <div>
            <div style="font-size: 25px; color: ${C.white}; margin-bottom: 6px;">
                ${swap.requestedBy.name}
                ${isOpenSwap
                    ? `<span style="color: ${C.orange}; font-size: 20px;"> → Looking for coverage</span>`
                    : `<span style="color: ${C.mint}; font-size: 20px;"> ↔ ${swap.swapWith.name}</span>`
                }
            </div>
            <div style="font-size: 20px; color: ${C.grey};">Requested ${timeAgo(swap.requestedAt)}</div>
        </div>
        <div style="font-size: 22px; color: ${statusInfo.color};
                    background: ${statusInfo.color}15; padding: 6px 14px;
                    border-radius: 6px; font-weight: bold;">${statusInfo.label}</div>
    `;
    card.appendChild(topRow);

    // Shift details
    const shiftRow = document.createElement('div');
    shiftRow.style.cssText = `
        display: grid; grid-template-columns: 1fr auto 1fr; gap: 12px;
        margin-bottom: 14px; align-items: center;
    `;

    shiftRow.innerHTML = `
        <div style="padding: 14px; background: rgba(var(--color-mint-rgb), 0.06);
                    border-radius: 8px; border: 1px solid ${C.mintBorder};">
            <div style="font-size: 18px; color: ${C.mintFaded}; text-transform: uppercase; margin-bottom: 4px;">
                ${swap.requestedBy.name.split(' ')[0]}'s Shift
            </div>
            <div style="font-size: 22px; color: ${C.white};">${swap.originalShift.template}</div>
            <div style="font-size: 20px; color: ${C.mint};">
                ${fmtDateShort(swap.originalShift.date)} · ${fmtTime12(swap.originalShift.start)} – ${fmtTime12(swap.originalShift.end)}
            </div>
        </div>
        <div style="font-size: 28px; color: ${C.yellow};">⇄</div>
        ${swap.swapShift ? `
            <div style="padding: 14px; background: rgba(var(--color-mint-rgb), 0.06);
                        border-radius: 8px; border: 1px solid ${C.mintBorder};">
                <div style="font-size: 18px; color: ${C.mintFaded}; text-transform: uppercase; margin-bottom: 4px;">
                    ${swap.swapWith ? swap.swapWith.name.split(' ')[0] + "'s Shift" : 'Swap Shift'}
                </div>
                <div style="font-size: 22px; color: ${C.white};">${swap.swapShift.template}</div>
                <div style="font-size: 20px; color: ${C.mint};">
                    ${fmtDateShort(swap.swapShift.date)} · ${fmtTime12(swap.swapShift.start)} – ${fmtTime12(swap.swapShift.end)}
                </div>
            </div>
        ` : `
            <div style="padding: 14px; background: rgba(255, 165, 0, 0.06);
                        border-radius: 8px; border: 1px dashed rgba(255, 165, 0, 0.3);
                        text-align: center;">
                <div style="font-size: 22px; color: ${C.orange};">Needs Coverage</div>
                <div style="font-size: 20px; color: ${C.grey};">No swap partner yet</div>
            </div>
        `}
    `;
    card.appendChild(shiftRow);

    // Reason
    const reasonRow = document.createElement('div');
    reasonRow.style.cssText = `
        font-size: 22px; color: rgba(var(--color-mint-rgb), 0.6); margin-bottom: 14px;
        padding: 10px 14px; background: rgba(var(--color-mint-rgb), 0.04); border-radius: 6px;
    `;
    reasonRow.innerHTML = `<span style="color: ${C.grey};">Reason:</span> ${swap.reason}`;
    card.appendChild(reasonRow);

    // Partner approval status
    if (swap.swapWith) {
        const partnerRow = document.createElement('div');
        partnerRow.style.cssText = `font-size: 20px; margin-bottom: 14px;`;
        partnerRow.innerHTML = swap.swapPartnerApproved
            ? `<span style="color: ${C.green};">✓ ${swap.swapWith.name} has agreed to swap</span>`
            : `<span style="color: ${C.orange};">⏳ Waiting for ${swap.swapWith.name} to confirm</span>`;
        card.appendChild(partnerRow);
    }

    // Deny reason (if denied)
    if (swap.status === 'denied' && swap.denyReason) {
        const denyRow = document.createElement('div');
        denyRow.style.cssText = `
            font-size: 20px; color: ${C.red}; padding: 10px 14px;
            background: rgba(var(--color-vermillion-rgb), 0.06); border-radius: 6px; margin-bottom: 14px;
        `;
        denyRow.innerHTML = `<span style="font-weight: bold;">Denied:</span> ${swap.denyReason}`;
        card.appendChild(denyRow);
    }

    // Resolution info (if resolved)
    if (swap.resolvedAt) {
        const resRow = document.createElement('div');
        resRow.style.cssText = `font-size: 18px; color: ${C.grey}; margin-bottom: 14px;`;
        resRow.textContent = `Resolved by ${swap.resolvedBy} · ${timeAgo(swap.resolvedAt)}`;
        card.appendChild(resRow);
    }

    // Action buttons (pending only)
    if (showActions && swap.status === 'pending') {
        const actions = document.createElement('div');
        actions.style.cssText = 'display: flex; gap: 12px;';

        const approveBtn = document.createElement('button');
        approveBtn.textContent = '✓ Approve';
        approveBtn.style.cssText = `
            background: ${C.green}; color: ${C.dark}; border: none;
            padding: 12px 28px; border-radius: 8px; font-size: 22px; cursor: pointer;
            font-family: var(--font-body, 'Sevastopol Interface', Arial, sans-serif);
            font-weight: bold; transition: all 0.2s ease;
        `;
        approveBtn.addEventListener('click', () => {
            swap.status = 'approved';
            swap.resolvedAt = new Date().toISOString();
            swap.resolvedBy = 'Tyler Johnson';

            emitEvent('SHIFT_SWAP_APPROVED', {
                swap_id: swap.id,
                requested_by: swap.requestedBy.id,
                swap_with: swap.swapWith?.id || null,
                original_shift: swap.originalShift,
                swap_shift: swap.swapShift,
            });

            showToast(`Swap approved for ${swap.requestedBy.name}`, 'success');
            popView();
            pushView('swap-queue');
        });

        const denyBtn = document.createElement('button');
        denyBtn.textContent = '✕ Deny';
        denyBtn.style.cssText = `
            background: transparent; color: ${C.red}; border: 1px solid ${C.red};
            padding: 12px 28px; border-radius: 8px; font-size: 22px; cursor: pointer;
            font-family: var(--font-body, 'Sevastopol Interface', Arial, sans-serif);
            transition: all 0.2s ease;
        `;
        denyBtn.addEventListener('mouseenter', () => { denyBtn.style.background = C.red; denyBtn.style.color = C.white; });
        denyBtn.addEventListener('mouseleave', () => { denyBtn.style.background = 'transparent'; denyBtn.style.color = C.red; });
        denyBtn.addEventListener('click', () => {
            swap.status = 'denied';
            swap.resolvedAt = new Date().toISOString();
            swap.resolvedBy = 'Tyler Johnson';
            swap.denyReason = 'Coverage requirements not met';

            emitEvent('SHIFT_SWAP_DENIED', {
                swap_id: swap.id,
                requested_by: swap.requestedBy.id,
                reason: swap.denyReason,
            });

            showToast(`Swap denied for ${swap.requestedBy.name}`, 'warning');
            popView();
            pushView('swap-queue');
        });

        actions.appendChild(approveBtn);
        actions.appendChild(denyBtn);
        card.appendChild(actions);
    }

    return card;
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

/* ==========================================
   EXPORTS
   ========================================== */
export function buildShiftConfigScene(container) {
    currentContainer = container;
    viewHistory = [];

    // Clone swap requests for mutable state
    swapRequests = JSON.parse(JSON.stringify(SWAP_REQUESTS));

    const viewWrapper = document.createElement('div');
    viewWrapper.id = 'sc-view-wrapper';
    container.appendChild(viewWrapper);

    pushView('daily-timeline');
}

export function cleanupShiftConfig(container) {
    if (container) container.innerHTML = '';
    viewHistory = [];
    currentContainer = null;
    swapRequests = null;
}