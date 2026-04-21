/* ============================================
   KINDpos Overseer — Menu Performance
   Item sales velocity, profitability ranking.
   Derives from /api/v1/reports/sales-summary.
   ============================================ */

import { buildDateRangePicker } from '../components/date-picker.js';

let currentContainer = null;
let startDate, endDate;

function initDates() {
    const today = new Date();
    endDate = today.toISOString().slice(0, 10);
    const weekAgo = new Date(); weekAgo.setDate(weekAgo.getDate() - 6);
    startDate = weekAgo.toISOString().slice(0, 10);
}

function fmt$(v) { return '$' + (v ?? 0).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ','); }

async function fetchDay(date) {
    try {
        const res = await fetch(`/api/v1/reports/sales-summary?date=${date}`);
        if (!res.ok) return null;
        return await res.json();
    } catch { return null; }
}

function dateRange(start, end) {
    const days = [];
    const d = new Date(start + 'T12:00:00');
    const endD = new Date(end + 'T12:00:00');
    while (d <= endD) {
        days.push(d.toISOString().slice(0, 10));
        d.setDate(d.getDate() + 1);
    }
    return days;
}

async function aggregateItems(start, end) {
    const dates = dateRange(start, end);
    const results = await Promise.all(dates.map(fetchDay));
    const itemMap = {};
    results.forEach(day => {
        (day?.top_items || []).forEach(item => {
            const key = item.name || item.item || 'Unknown';
            if (!itemMap[key]) itemMap[key] = { name: key, qty: 0, revenue: 0 };
            itemMap[key].qty += item.qty || item.count || 0;
            itemMap[key].revenue += item.revenue || item.total || 0;
        });
    });
    return Object.values(itemMap).sort((a, b) => b.revenue - a.revenue);
}

async function render(container) {
    container.innerHTML = '';
    const wrapper = document.createElement('div');
    wrapper.style.cssText = 'max-width: 900px; margin: 0 auto; padding: 30px 24px 60px;';

    const header = document.createElement('div');
    header.style.cssText = 'display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:20px;flex-wrap:wrap;gap:12px;';
    header.innerHTML = `
        <div>
            <div style="font-family:var(--font-heading);font-size:44px;color:var(--color-gold);">\u{1F4C8} Menu Performance</div>
            <div style="font-size:18px;color:rgba(var(--color-mint-rgb),0.5);margin-top:4px;">Item sales velocity and revenue ranking</div>
        </div>
    `;
    const rangePicker = buildDateRangePicker({
        start: startDate, end: endDate,
        onChange: ({ start, end }) => { startDate = start; endDate = end; render(container); },
    });
    header.appendChild(rangePicker);
    wrapper.appendChild(header);

    const loadingEl = document.createElement('div');
    loadingEl.style.cssText = 'padding:40px 20px;text-align:center;color:rgba(var(--color-mint-rgb),0.5);font-size:18px;';
    loadingEl.textContent = 'Loading sales data...';
    wrapper.appendChild(loadingEl);
    container.appendChild(wrapper);

    const items = await aggregateItems(startDate, endDate);
    loadingEl.remove();

    if (items.length === 0) {
        const empty = document.createElement('div');
        empty.style.cssText = 'padding:60px 20px;text-align:center;color:rgba(var(--color-mint-rgb),0.4);font-size:22px;';
        empty.textContent = 'No sales data in this date range.';
        wrapper.appendChild(empty);
        return;
    }

    const totalRev = items.reduce((s, i) => s + i.revenue, 0);
    const totalQty = items.reduce((s, i) => s + i.qty, 0);

    const summaryRow = document.createElement('div');
    summaryRow.style.cssText = 'display:flex;gap:16px;margin-bottom:24px;';
    summaryRow.innerHTML = `
        <div style="flex:1;background:rgba(var(--color-mint-rgb),0.06);border:1px solid rgba(var(--color-mint-rgb),0.15);border-radius:6px;padding:16px;text-align:center;">
            <div style="font-size:16px;color:var(--color-mint);text-transform:uppercase;letter-spacing:1px;">Total Revenue</div>
            <div style="font-size:36px;color:var(--color-gold);font-family:var(--font-heading);">${fmt$(totalRev)}</div>
        </div>
        <div style="flex:1;background:rgba(var(--color-mint-rgb),0.06);border:1px solid rgba(var(--color-mint-rgb),0.15);border-radius:6px;padding:16px;text-align:center;">
            <div style="font-size:16px;color:var(--color-mint);text-transform:uppercase;letter-spacing:1px;">Total Items Sold</div>
            <div style="font-size:36px;color:var(--color-mint);font-family:var(--font-heading);">${totalQty.toLocaleString()}</div>
        </div>
        <div style="flex:1;background:rgba(var(--color-mint-rgb),0.06);border:1px solid rgba(var(--color-mint-rgb),0.15);border-radius:6px;padding:16px;text-align:center;">
            <div style="font-size:16px;color:var(--color-mint);text-transform:uppercase;letter-spacing:1px;">Unique Items</div>
            <div style="font-size:36px;color:var(--color-mint);font-family:var(--font-heading);">${items.length}</div>
        </div>
    `;
    wrapper.appendChild(summaryRow);

    const tableHdr = document.createElement('div');
    tableHdr.style.cssText = 'font-family:var(--font-heading);font-size:22px;color:var(--color-mint);margin:24px 0 12px 0;';
    tableHdr.textContent = 'ITEM RANKING (BY REVENUE)';
    wrapper.appendChild(tableHdr);

    const headerRow = document.createElement('div');
    headerRow.style.cssText = 'display:grid;grid-template-columns:40px 2fr 1fr 1fr 1fr;gap:10px;padding:10px 14px;border-bottom:2px solid rgba(var(--color-mint-rgb),0.15);color:rgba(var(--color-mint-rgb),0.5);font-size:16px;text-transform:uppercase;letter-spacing:1px;';
    headerRow.innerHTML = `<span>#</span><span>Item</span><span style="text-align:right;">Qty</span><span style="text-align:right;">Revenue</span><span style="text-align:right;">% of Total</span>`;
    wrapper.appendChild(headerRow);

    items.forEach((item, i) => {
        const pct = totalRev > 0 ? (item.revenue / totalRev) * 100 : 0;
        const row = document.createElement('div');
        row.style.cssText = 'display:grid;grid-template-columns:40px 2fr 1fr 1fr 1fr;gap:10px;padding:12px 14px;border-bottom:1px solid rgba(var(--color-mint-rgb),0.08);font-size:20px;';
        const rankColor = i < 3 ? 'var(--color-gold)' : 'rgba(var(--color-mint-rgb),0.4)';
        row.innerHTML = `
            <span style="color:${rankColor};font-family:var(--font-heading);">${i + 1}</span>
            <span style="color:var(--color-mint);">${item.name}</span>
            <span style="text-align:right;color:rgba(var(--color-mint-rgb),0.7);">${item.qty}</span>
            <span style="text-align:right;color:var(--color-gold);font-family:var(--font-heading);">${fmt$(item.revenue)}</span>
            <span style="text-align:right;color:rgba(var(--color-mint-rgb),0.6);">${pct.toFixed(1)}%</span>
        `;
        wrapper.appendChild(row);
    });
}

export function buildMenuPerformanceScene(container) {
    currentContainer = container;
    initDates();
    render(container).catch(e => console.error('[MenuPerformance] Mount error:', e));
}

export function cleanupMenuPerformance(container) {
    if (container) container.innerHTML = '';
    currentContainer = null;
}
