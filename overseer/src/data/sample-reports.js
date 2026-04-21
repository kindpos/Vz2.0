/* ============================================
   KINDpos Overseer — Report Data (API-backed)
   Fetches from /api/v1/reports/sales-summary
   ============================================ */

function todayStr() {
    return new Date().toISOString().slice(0, 10);
}

function yesterdayStr() {
    const d = new Date();
    d.setDate(d.getDate() - 1);
    return d.toISOString().slice(0, 10);
}

async function fetchSummary(date) {
    try {
        const res = await fetch(`/api/v1/reports/sales-summary?date=${date}`);
        if (!res.ok) return null;
        return await res.json();
    } catch { return null; }
}

function buildFlash(summary) {
    if (!summary) return {
        net_sales: 0, tax_collected: 0, tips: 0, total_collected: 0,
        orders: 0, guests: 0, avg_check: 0, discounts: 0, comps: 0, voids: 0,
    };
    const net = summary.net_sales || 0;
    const tax = summary.tax_collected || 0;
    const tips = summary.tips_collected || summary.tip_avg || 0;
    return {
        net_sales: net,
        tax_collected: tax,
        tips: tips,
        total_collected: net + tax + tips,
        orders: summary.total_checks || 0,
        guests: summary.total_guests || summary.total_checks || 0,
        avg_check: summary.check_avg || 0,
        discounts: summary.discounts_total || 0,
        comps: summary.comps_total || 0,
        voids: summary.voids_total || 0,
    };
}

export let SAMPLE_DATA = {
    dailyFlash: {
        date: todayStr(),
        today: buildFlash(null),
        yesterday: buildFlash(null),
    },
    hourlySales: { today: [], yesterday: [] },
    topSellers: [],
    paymentBreakdown: {
        card: { amount: 0, count: 0, pct: 0, fees: 0 },
        cash: { amount: 0, count: 0, pct: 0 },
    },
    dayparts: [],
    salesByCategory: [],
    taxBreakdown: [],
    tipsByServer: [],
    adjustmentDetails: { discounts: [], comps: [], voids: [] },
};

export async function loadReportData(date) {
    const targetDate = date || todayStr();
    const prevDate = (() => { const d = new Date(targetDate + 'T12:00:00'); d.setDate(d.getDate() - 1); return d.toISOString().slice(0, 10); })();

    const [today, yesterday] = await Promise.all([
        fetchSummary(targetDate),
        fetchSummary(prevDate),
    ]);

    const todayFlash = buildFlash(today);
    const yesterdayFlash = buildFlash(yesterday);

    const hourlyToday = (today?.hourly_sales || []).map(h => ({
        hour: h.hour, sales: h.net || 0,
    }));
    const hourlyYesterday = (yesterday?.hourly_sales || today?.last_week_hourly || []).map(h => ({
        hour: h.hour, sales: h.net || 0,
    }));

    const topSellers = (today?.top_items || []).map(item => ({
        name: item.name || item.item,
        qty: item.qty || item.count || 0,
        revenue: item.revenue || item.total || 0,
    }));

    const cashTotal = today?.cash_total || 0;
    const cardTotal = today?.card_total || 0;
    const payTotal = cashTotal + cardTotal || 1;

    const salesByCategory = (today?.category_breakdown || []).map(c => ({
        category: c.category || c.name,
        net_sales: c.net_sales || c.total || 0,
        items_sold: c.items_sold || c.count || 0,
        pct: c.pct || Math.round(((c.net_sales || c.total || 0) / (todayFlash.net_sales || 1)) * 100),
    }));

    // Display the tax actually captured on payments (event-sourced via
    // the sales-summary endpoint). Previously the Overseer fabricated a
    // flat 7% × net_sales amount, which contradicted the real tax_collected.
    const taxCollected = todayFlash.tax_collected || 0;
    const effectiveTaxRate = todayFlash.net_sales > 0
        ? (taxCollected / todayFlash.net_sales)
        : 0;

    SAMPLE_DATA = {
        dailyFlash: {
            date: targetDate,
            today: todayFlash,
            yesterday: yesterdayFlash,
        },
        hourlySales: { today: hourlyToday, yesterday: hourlyYesterday },
        topSellers,
        paymentBreakdown: {
            card: {
                amount: cardTotal,
                count: today?.card_count || 0,
                pct: Math.round((cardTotal / payTotal) * 100),
                fees: fmt$(cardTotal * 0.029),
            },
            cash: {
                amount: cashTotal,
                count: today?.cash_count || 0,
                pct: Math.round((cashTotal / payTotal) * 100),
            },
        },
        dayparts: today?.dayparts || [],
        salesByCategory,
        taxBreakdown: [
            { type: 'Sales Tax', rate: effectiveTaxRate * 100, amount: taxCollected },
        ],
        tipsByServer: today?.tips_by_server || [],
        adjustmentDetails: {
            discounts: today?.adjustment_details?.discounts || [],
            comps: today?.adjustment_details?.comps || [],
            voids: today?.adjustment_details?.voids || [],
        },
    };
}

export function calcDelta(current, previous) {
    if (!previous || previous === 0) return { pct: 0, direction: 'up' };
    const diff = current - previous;
    const pct = Math.abs((diff / previous) * 100);
    return { pct, direction: diff >= 0 ? 'up' : 'down' };
}

export function fmt$(value) {
    if (value == null || isNaN(value)) return '$0.00';
    return '$' + Number(value).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

export function fmtPct(value) {
    if (value == null || isNaN(value)) return '0.0%';
    return Number(value).toFixed(1) + '%';
}
