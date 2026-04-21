/* ============================================
   KINDpos Overseer - Sales Reports Section
   Daily Flash + Drill-Down Chain

   "Show Your Work" — every number is tappable,
   every total is verifiable.
   ============================================ */

import { SAMPLE_DATA, calcDelta, fmt$, fmtPct, loadReportData } from '../data/sample-reports.js';
import { buildDatePicker, buildDateRangePicker } from '../components/date-picker.js';

/* ------------------------------------------
   CHART COLOR PALETTE (Retro 80s)

   Chart.js draws on <canvas>, which cannot parse CSS `var(--foo)`
   references — it silently falls back to black. We resolve the
   variables to concrete values at module load so charts render
   in the actual theme colors.
------------------------------------------ */
function _cssVar(name, fallback) {
    try {
        const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
        return v || fallback;
    } catch (_) { return fallback; }
}
function _rgba(rgbVarName, alpha, fallbackRgb) {
    const rgb = _cssVar(rgbVarName, fallbackRgb);
    return `rgba(${rgb}, ${alpha})`;
}

const COLORS = {
    mint:        _cssVar('--color-mint',       '#C6FFBB'),
    mintFaded:   _rgba('--color-mint-rgb',       0.8, '198, 255, 187'),
    mintGhost:   _rgba('--color-mint-rgb',       0.4, '198, 255, 187'),
    yellow:      _cssVar('--color-gold',       '#fcbe40'),
    yellowFaded: _rgba('--color-gold-rgb',       0.4, '252, 190, 64'),
    red:         _cssVar('--color-vermillion', '#ff4422'),
    redFaded:    _rgba('--color-vermillion-rgb', 0.3, '255, 68, 34'),
    dark:        _cssVar('--color-bg',         '#333333'),
    white:       '#FFFFFF',
    // Donut segments
    segments: [
        _cssVar('--color-mint',       '#C6FFBB'),
        _cssVar('--color-gold',       '#fcbe40'),
        _cssVar('--color-vermillion', '#ff4422'),
        '#66DDAA', '#FFB347', '#77BBFF',
        '#E8A0BF', '#95E1D3',
    ],
};

/* ------------------------------------------
   CATEGORY COLOR MAP

   The "Sales by Category" chart keys its bars off the hex_color the
   operator chose on the Menu Categories page. We prefetch the
   categories on module load so the map is ready by the time anyone
   drills into the chart; callers can also `await` the promise.
------------------------------------------ */
let _categoryColorMap = null;
let _categoryColorPromise = null;

function _normalizeName(s) { return (s || '').toString().trim().toLowerCase(); }

function ensureCategoryColors() {
    if (_categoryColorPromise) return _categoryColorPromise;
    _categoryColorPromise = fetch('/api/v1/config/menu/categories')
        .then(r => r.ok ? r.json() : [])
        .then(list => {
            const map = {};
            (list || []).forEach(c => {
                if (!c) return;
                const hex = c.hex_color || c.color;
                if (!hex) return;
                if (c.name)       map[_normalizeName(c.name)]       = hex;
                if (c.category_id) map[_normalizeName(c.category_id)] = hex;
            });
            _categoryColorMap = map;
            return map;
        })
        .catch(() => { _categoryColorMap = {}; return {}; });
    return _categoryColorPromise;
}

function categoryColor(name, fallback) {
    if (!_categoryColorMap) return fallback;
    return _categoryColorMap[_normalizeName(name)] || fallback;
}

// Kick off the fetch as soon as reporting.js loads.
ensureCategoryColors();

/* ------------------------------------------
   CHART.JS GLOBAL DEFAULTS
------------------------------------------ */
function applyChartDefaults() {
    if (typeof Chart === 'undefined') {
        console.warn('[Reporting] Chart.js not loaded — charts will be skipped');
        return false;
    }
    Chart.defaults.color = COLORS.mint;
    Chart.defaults.font.family = "'Sevastopol Interface', Arial, sans-serif";
    Chart.defaults.font.size = 30;
    Chart.defaults.plugins.legend.labels.usePointStyle = true;
    Chart.defaults.plugins.legend.labels.padding = 16;
    return true;
}

/* ------------------------------------------
   VIEW STACK STATE

   The drill-down system lives INSIDE the
   sales-reports scene. No new scenes needed.
   viewHistory tracks where we've been so the
   back button always knows where to go.
------------------------------------------ */
let viewHistory = [];
let currentWrapper = null;
let hasCharts = false;

/* ------------------------------------------
   VIEW REGISTRY

   Maps view names → builder functions.
   Each builder receives (wrapper, data).
   "data" carries context for drill-downs,
   e.g. which category was tapped.
------------------------------------------ */
const VIEW_REGISTRY = {
    'daily-flash':        buildDailyFlash,
    'sales-by-category':  buildSalesByCategory,
    'tax-breakdown':      buildTaxBreakdown,
    'tips-by-server':     buildTipsByServer,
    'adjustments':        buildAdjustmentsDetail,
};

/* ------------------------------------------
   VIEW STACK NAVIGATION
------------------------------------------ */

/**
 * pushView — Navigate forward to a new view.
 * Clears the wrapper, calls the builder,
 * and pushes onto history.
 *
 * Chart.js canvases are destroyed automatically
 * when innerHTML is cleared — no memory leaks.
 */
function pushView(viewName, data) {
    if (!currentWrapper) return;

    // Clear current content
    currentWrapper.innerHTML = '';

    // Push onto history stack
    viewHistory.push({ name: viewName, data: data });

    // Look up and call the builder
    const builder = VIEW_REGISTRY[viewName];
    if (builder) {
        builder(currentWrapper, data);
    } else {
        buildComingSoon(currentWrapper, viewName);
    }

    // Scroll to top of the wrapper
    currentWrapper.scrollTop = 0;
}

/**
 * popView — Navigate back one level.
 * Pops current view, rebuilds the previous one.
 * If we're already at the root (daily-flash),
 * this is a no-op — the scene manager's own
 * back button handles returning to hex nav.
 */
function popView() {
    if (viewHistory.length <= 1) return;

    // Remove current view
    viewHistory.pop();

    // Peek at the previous entry
    const prev = viewHistory[viewHistory.length - 1];

    // Pop it too, because pushView will re-push it
    viewHistory.pop();

    // Rebuild the previous view
    pushView(prev.name, prev.data);
}

/* ------------------------------------------
   BACK BUTTON BUILDER

   Every drill-down view gets one of these
   at the top. Daily Flash does NOT get one —
   the scene manager handles that level.
------------------------------------------ */
function buildBackButton(container, label) {
    const btn = document.createElement('button');
    btn.style.cssText = `
        display: inline-flex;
        align-items: center;
        gap: 8px;
        padding: 8px 16px;
        margin-bottom: 16px;
        background: rgba(var(--color-mint-rgb), 0.06);
        border: 1px solid rgba(var(--color-mint-rgb), 0.15);
        border-radius: 4px;
        color: ${COLORS.mint};
        font-family: var(--font-body);
        font-size: 22px;
        cursor: pointer;
        transition: background 0.2s ease;
    `;
    btn.textContent = `← Back to ${label}`;
    btn.addEventListener('mouseenter', () => {
        btn.style.background = 'rgba(var(--color-mint-rgb), 0.15)';
    });
    btn.addEventListener('mouseleave', () => {
        btn.style.background = 'rgba(var(--color-mint-rgb), 0.06)';
    });
    btn.addEventListener('click', () => popView());
    container.appendChild(btn);
}

/* ------------------------------------------
   COMING SOON PLACEHOLDER

   Shown for views registered in VIEW_REGISTRY
   whose builder hasn't been implemented yet.
   Includes a working back button so navigation
   still functions during incremental builds.
------------------------------------------ */
function buildComingSoon(container, viewName) {
    buildBackButton(container, 'Daily Flash');

    const notice = document.createElement('div');
    notice.style.cssText = `
        text-align: center;
        padding: 80px 20px;
    `;

    // Format the view name for display: "sales-by-category" → "Sales By Category"
    const displayName = viewName
        .split('-')
        .map(word => word.charAt(0).toUpperCase() + word.slice(1))
        .join(' ');

    notice.innerHTML = `
        <div style="font-family: var(--font-display); font-size: 40px; color: ${COLORS.yellow}; margin-bottom: 16px;">
            ${displayName}
        </div>
        <div style="font-size: 25px; color: rgba(var(--color-mint-rgb), 0.5);">
            Coming soon — this drill-down is next in the build queue.
        </div>
    `;
    container.appendChild(notice);
}

/* ------------------------------------------
   DATE SUBHEADER (reusable for drill-downs)

   Lighter than the full Daily Flash header.
   Shows the report date under a view title.
------------------------------------------ */
function buildDateSubheader(container, title) {
    const dateStr = new Date(SAMPLE_DATA.dailyFlash.date + 'T12:00:00').toLocaleDateString('en-US', {
        weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
    });

    const header = document.createElement('div');
    header.style.cssText = 'margin-bottom: 20px;';
    header.innerHTML = `
        <div style="font-family: var(--font-display); font-size: 40px; color: ${COLORS.yellow};">
            ${title}
        </div>
        <div style="font-size: 17px; color: rgba(var(--color-mint-rgb), 0.5); margin-top: 4px;">
            ${dateStr}
        </div>
    `;
    container.appendChild(header);
}

/* ==========================================
   DAILY FLASH VIEW (default / home)

   Everything that was previously built
   directly in onEnter now lives here.
   Zero changes to the existing builders —
   just relocated into this function.
   ========================================== */
function buildDailyFlash(wrapper) {
    buildDateHeader(wrapper);
    buildKPICards(wrapper);

    buildSectionHeading(wrapper, 'Hourly Sales');
    buildHourlySalesChart(wrapper);

    buildSectionHeading(wrapper, 'Top Sellers');
    buildTopSellersChart(wrapper);

    buildSectionHeading(wrapper, 'Payment Breakdown');
    buildPaymentDonut(wrapper);

    buildSectionHeading(wrapper, 'Daypart Analysis');
    buildDaypartSection(wrapper);

    buildSectionHeading(wrapper, 'Adjustments');
    buildAdjustmentsSummary(wrapper);

    buildSectionHeading(wrapper, 'Drill Down');
    buildDrillDownLinks(wrapper);

    if (!hasCharts) {
        const warning = document.createElement('div');
        warning.style.cssText = `
            text-align: center; padding: 20px; color: ${COLORS.red};
            font-size: 17px; margin-top: 12px;
        `;
        warning.textContent = 'Chart.js not loaded — download chart.min.js to assets/js/ for visualizations';
        wrapper.insertBefore(warning, wrapper.firstChild);
    }
}

/* ==========================================
   DRILL-DOWN VIEW PLACEHOLDERS

   These will be replaced with real builders
   in Sections 2–5. For now they route to
   buildComingSoon with a working back button,
   proving the view stack works.
   ========================================== */

function buildSalesByCategory(wrapper) {
    const data = SAMPLE_DATA.salesByCategory;

    // Back button
    buildBackButton(wrapper, 'Daily Flash');

    // Header
    buildDateSubheader(wrapper, 'Sales by Category');

    // --- Horizontal Bar Chart ---
    const chartWrap = document.createElement('div');
    chartWrap.style.cssText = 'position: relative; height: 220px; margin-bottom: 24px;';

    const canvas = document.createElement('canvas');
    canvas.id = 'chart-sales-by-category';
    chartWrap.appendChild(canvas);
    wrapper.appendChild(chartWrap);

    // Rank-based fallback used until the category color map resolves
    // (or for categories that don't have a hex_color set).
    function rankFallback(i) {
        return i === 0 ? COLORS.yellow :
               i === 1 ? COLORS.mint   :
                         COLORS.mintFaded;
    }

    let chart = null;
    function drawChart() {
        if (typeof Chart === 'undefined') return;
        const sorted = [...data].sort((a, b) => b.net_sales - a.net_sales);
        const bgs = sorted.map((d, i) => categoryColor(d.category, rankFallback(i)));
        if (chart) { chart.data.datasets[0].backgroundColor = bgs; chart.update(); return; }

        chart = new Chart(canvas, {
            type: 'bar',
            data: {
                labels: sorted.map(d => d.category),
                datasets: [{
                    label: 'Net Sales',
                    data: sorted.map(d => d.net_sales),
                    backgroundColor: bgs,
                    borderColor: 'transparent',
                    borderRadius: 2,
                    barThickness: 28,
                }],
            },
            options: {
                indexAxis: 'y',
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: { display: false },
                    tooltip: {
                        callbacks: {
                            label: ctx => `Net Sales: ${fmt$(ctx.parsed.x)}`,
                            afterLabel: ctx => {
                                const item = sorted[ctx.dataIndex];
                                return `${item.pct}% of total · ${item.items_sold} items`;
                            },
                        },
                    },
                },
                scales: {
                    x: {
                        grid: { color: 'rgba(var(--color-mint-rgb), 0.05)' },
                        ticks: {
                            color: COLORS.mintFaded,
                            callback: v => '$' + v,
                        },
                    },
                    y: {
                        grid: { display: false },
                        ticks: {
                            color: COLORS.mint,
                            font: { size: 20 },
                        },
                    },
                },
            },
        });
    }

    // Draw once with whatever's in the cache now, then refresh with
    // the category colors from the API when the fetch resolves. Both
    // paths are cheap — Chart.js updates in place on the second call.
    drawChart();
    ensureCategoryColors().then(() => drawChart());

    // --- Tappable Data Table ---
    const table = document.createElement('div');
    table.style.cssText = 'margin-bottom: 16px;';

    // Sort descending by net_sales for the table too
    const sortedRows = [...data].sort((a, b) => b.net_sales - a.net_sales);

    sortedRows.forEach(cat => {
        const row = document.createElement('button');
        row.style.cssText = `
            display: flex;
            align-items: center;
            gap: 12px;
            width: 100%;
            padding: 12px 8px;
            background: transparent;
            border: none;
            border-bottom: 1px solid rgba(var(--color-mint-rgb), 0.08);
            cursor: pointer;
            transition: background 0.2s ease;
            font-family: var(--font-body);
            font-size: 25px;
            text-align: left;
        `;
        row.innerHTML = `
            <span style="flex: 1; color: ${COLORS.mint};">${cat.category}</span>
            <span style="color: ${COLORS.yellow}; font-family: var(--font-display); min-width: 110px; text-align: right;">${fmt$(cat.net_sales)}</span>
            <span style="color: rgba(var(--color-mint-rgb), 0.4); min-width: 80px; text-align: right;">${cat.items_sold} items</span>
            <span style="color: rgba(var(--color-mint-rgb), 0.4); min-width: 55px; text-align: right;">${cat.pct}%</span>
            <span style="color: rgba(var(--color-mint-rgb), 0.3); font-size: 20px; margin-left: 4px;">→</span>
        `;
        row.addEventListener('mouseenter', () => {
            row.style.background = 'rgba(var(--color-mint-rgb), 0.06)';
        });
        row.addEventListener('mouseleave', () => {
            row.style.background = 'transparent';
        });
        // Future: drill into Sales by Item for this category
        row.addEventListener('click', () => {
            pushView('sales-by-item', { category: cat.category });
        });
        table.appendChild(row);
    });

    wrapper.appendChild(table);

    // --- Total Row ---
    const totalSales = data.reduce((sum, c) => sum + c.net_sales, 0);
    const totalItems = data.reduce((sum, c) => sum + c.items_sold, 0);

    const totalRow = document.createElement('div');
    totalRow.style.cssText = `
        display: flex;
        align-items: center;
        gap: 12px;
        padding: 14px 8px;
        border-top: 2px solid rgba(var(--color-mint-rgb), 0.2);
        font-size: 25px;
    `;
    totalRow.innerHTML = `
        <span style="flex: 1; color: ${COLORS.mint}; font-family: var(--font-display);">Total</span>
        <span style="color: ${COLORS.yellow}; font-family: var(--font-display); min-width: 110px; text-align: right;">${fmt$(totalSales)}</span>
        <span style="color: rgba(var(--color-mint-rgb), 0.4); min-width: 80px; text-align: right;">${totalItems} items</span>
        <span style="min-width: 55px;"></span>
        <span style="min-width: 24px; margin-left: 4px;"></span>
    `;
    wrapper.appendChild(totalRow);
}

function buildTaxBreakdown(wrapper) {
    const taxes = SAMPLE_DATA.taxBreakdown;
    const netSales = SAMPLE_DATA.dailyFlash.today.net_sales;
    const flashTax = SAMPLE_DATA.dailyFlash.today.tax_collected;

    // Back button
    buildBackButton(wrapper, 'Daily Flash');

    // Header
    buildDateSubheader(wrapper, 'Tax Breakdown');

    // --- Net Sales Reference ---
    const refLine = document.createElement('div');
    refLine.style.cssText = `
        margin-bottom: 24px;
        padding: 16px;
        background: rgba(var(--color-mint-rgb), 0.06);
        border: 1px solid rgba(var(--color-mint-rgb), 0.15);
        border-radius: 4px;
    `;
    refLine.innerHTML = `
        <span style="font-size: 25px; color: ${COLORS.mint};">Net Sales:</span>
        <span style="font-size: 35px; color: ${COLORS.yellow}; font-family: var(--font-display); margin-left: 12px;">${fmt$(netSales)}</span>
    `;
    wrapper.appendChild(refLine);

    // --- Tax Equation Rows ---
    const table = document.createElement('div');
    table.style.cssText = 'margin-bottom: 16px;';

    taxes.forEach(tax => {
        const multiplier = (tax.rate / 100).toFixed(4).replace(/0+$/, '');

        const row = document.createElement('div');
        row.style.cssText = `
            display: flex;
            align-items: baseline;
            gap: 12px;
            padding: 10px 8px;
            border-bottom: 1px solid rgba(var(--color-mint-rgb), 0.08);
            font-size: 25px;
        `;
        row.innerHTML = `
            <span style="flex: 1; color: ${COLORS.mint};">${tax.type}</span>
            <span style="color: rgba(var(--color-mint-rgb), 0.4); min-width: 65px; text-align: right;">${tax.rate.toFixed(2)}%</span>
            <span style="color: rgba(var(--color-mint-rgb), 0.35); min-width: 220px; text-align: right; font-size: 22px;">${fmt$(netSales)} × ${multiplier}</span>
            <span style="color: rgba(var(--color-mint-rgb), 0.4); font-size: 22px;">=</span>
            <span style="color: ${COLORS.yellow}; font-family: var(--font-display); min-width: 90px; text-align: right;">${fmt$(tax.amount)}</span>
        `;
        table.appendChild(row);
    });

    wrapper.appendChild(table);

    // --- Total Row ---
    const totalRate = taxes.reduce((sum, t) => sum + t.rate, 0);
    const totalAmount = taxes.reduce((sum, t) => sum + t.amount, 0);

    const totalRow = document.createElement('div');
    totalRow.style.cssText = `
        display: flex;
        align-items: baseline;
        gap: 12px;
        padding: 14px 8px;
        border-top: 2px solid rgba(var(--color-mint-rgb), 0.2);
        font-size: 25px;
    `;
    totalRow.innerHTML = `
        <span style="flex: 1; color: ${COLORS.mint}; font-family: var(--font-display);">Total Tax</span>
        <span style="color: rgba(var(--color-mint-rgb), 0.6); min-width: 65px; text-align: right; font-family: var(--font-display);">${totalRate.toFixed(2)}%</span>
        <span style="min-width: 220px;"></span>
        <span style="font-size: 22px; visibility: hidden;">=</span>
        <span style="color: ${COLORS.yellow}; font-family: var(--font-display); min-width: 90px; text-align: right; font-size: 30px;">${fmt$(totalAmount)}</span>
    `;
    wrapper.appendChild(totalRow);

    // --- Verification Line ---
    const matches = Math.abs(totalAmount - flashTax) < 0.01;
    const verify = document.createElement('div');
    verify.style.cssText = `
        margin-top: 16px;
        padding: 12px 16px;
        background: ${matches ? 'rgba(var(--color-mint-rgb), 0.06)' : 'rgba(var(--color-vermillion-rgb), 0.1)'};
        border: 1px solid ${matches ? 'rgba(var(--color-mint-rgb), 0.15)' : 'rgba(var(--color-vermillion-rgb), 0.3)'};
        border-radius: 4px;
        font-size: 22px;
        color: ${matches ? COLORS.mint : COLORS.red};
    `;
    verify.innerHTML = matches
        ? `✓ Matches Daily Flash tax_collected: ${fmt$(flashTax)}`
        : `✗ Mismatch — Daily Flash shows ${fmt$(flashTax)}, breakdown totals ${fmt$(totalAmount)}`;
    wrapper.appendChild(verify);
}

function buildTipsByServer(wrapper) {
    const data = SAMPLE_DATA.tipsByServer;

    // Find highest tip % for callout
    const maxTipPct = Math.max(...data.map(s => s.avg_tip_pct));

    // Back button
    buildBackButton(wrapper, 'Daily Flash');

    // Header
    buildDateSubheader(wrapper, 'Tips by Server');

    // --- Horizontal Bar Chart ---
    const chartWrap = document.createElement('div');
    chartWrap.style.cssText = 'position: relative; height: 200px; margin-bottom: 24px;';

    const canvas = document.createElement('canvas');
    canvas.id = 'chart-tips-by-server';
    chartWrap.appendChild(canvas);
    wrapper.appendChild(chartWrap);

    if (typeof Chart !== 'undefined') {
        // Sort descending by tips for the chart
        const sorted = [...data].sort((a, b) => b.tips - a.tips);

        new Chart(canvas, {
            type: 'bar',
            data: {
                labels: sorted.map(d => d.server),
                datasets: [{
                    label: 'Tips',
                    data: sorted.map(d => d.tips),
                    backgroundColor: sorted.map((_, i) =>
                        i === 0 ? COLORS.yellow :
                        i === 1 ? COLORS.mint :
                        COLORS.mintFaded
                    ),
                    borderColor: 'transparent',
                    borderRadius: 2,
                    barThickness: 28,
                }],
            },
            options: {
                indexAxis: 'y',
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: { display: false },
                    tooltip: {
                        callbacks: {
                            label: ctx => `Tips: ${fmt$(ctx.parsed.x)}`,
                            afterLabel: ctx => {
                                const item = sorted[ctx.dataIndex];
                                return `${item.orders} orders · Avg ${item.avg_tip_pct}%`;
                            },
                        },
                    },
                },
                scales: {
                    x: {
                        grid: { color: 'rgba(var(--color-mint-rgb), 0.05)' },
                        ticks: {
                            color: COLORS.mintFaded,
                            callback: v => '$' + v,
                        },
                    },
                    y: {
                        grid: { display: false },
                        ticks: {
                            color: COLORS.mint,
                            font: { size: 20 },
                        },
                    },
                },
            },
        });
    }

    // --- Ranked Data Table ---
    // Table header
    const tableHeader = document.createElement('div');
    tableHeader.style.cssText = `
        display: flex;
        align-items: center;
        gap: 12px;
        padding: 8px 8px;
        border-bottom: 2px solid rgba(var(--color-mint-rgb), 0.15);
        font-size: 20px;
        color: rgba(var(--color-mint-rgb), 0.4);
        text-transform: uppercase;
        letter-spacing: 1px;
    `;
    tableHeader.innerHTML = `
        <span style="width: 30px; text-align: center;">#</span>
        <span style="flex: 1;">Server</span>
        <span style="min-width: 100px; text-align: right;">Tips</span>
        <span style="min-width: 70px; text-align: right;">Orders</span>
        <span style="min-width: 90px; text-align: right;">Avg Tip %</span>
    `;
    wrapper.appendChild(tableHeader);

    // Data rows sorted descending by tips
    const sortedRows = [...data].sort((a, b) => b.tips - a.tips);

    sortedRows.forEach((server, i) => {
        const isHighestPct = server.avg_tip_pct === maxTipPct;

        const row = document.createElement('div');
        row.style.cssText = `
            display: flex;
            align-items: center;
            gap: 12px;
            padding: 10px 8px;
            border-bottom: 1px solid rgba(var(--color-mint-rgb), 0.08);
            font-size: 25px;
        `;
        row.innerHTML = `
            <span style="width: 30px; text-align: center; color: rgba(var(--color-mint-rgb), 0.4);">${i + 1}</span>
            <span style="flex: 1; color: ${COLORS.mint};">${server.server}</span>
            <span style="color: ${COLORS.yellow}; font-family: var(--font-display); min-width: 100px; text-align: right;">${fmt$(server.tips)}</span>
            <span style="color: rgba(var(--color-mint-rgb), 0.4); min-width: 70px; text-align: right;">${server.orders}</span>
            <span style="min-width: 90px; text-align: right; color: ${isHighestPct ? COLORS.mint : 'rgba(var(--color-mint-rgb), 0.4)'};">${server.avg_tip_pct}%${isHighestPct ? ' ★' : ''}</span>
        `;
        wrapper.appendChild(row);
    });

    // --- Total Row ---
    const totalTips = data.reduce((sum, s) => sum + s.tips, 0);

    const totalRow = document.createElement('div');
    totalRow.style.cssText = `
        display: flex;
        align-items: center;
        gap: 12px;
        padding: 14px 8px;
        border-top: 2px solid rgba(var(--color-mint-rgb), 0.2);
        font-size: 25px;
    `;
    totalRow.innerHTML = `
        <span style="width: 30px;"></span>
        <span style="flex: 1; color: ${COLORS.mint}; font-family: var(--font-display);">Total Tips</span>
        <span style="color: ${COLORS.yellow}; font-family: var(--font-display); min-width: 100px; text-align: right; font-size: 30px;">${fmt$(totalTips)}</span>
        <span style="min-width: 70px;"></span>
        <span style="min-width: 90px;"></span>
    `;
    wrapper.appendChild(totalRow);
}

function buildAdjustmentsDetail(wrapper) {
    const flash = SAMPLE_DATA.dailyFlash.today;
    const details = SAMPLE_DATA.adjustmentDetails;
    const total = flash.discounts + flash.comps + flash.voids;
    const pctOfSales = ((total / flash.net_sales) * 100).toFixed(1);

    // Back button
    buildBackButton(wrapper, 'Daily Flash');

    // Header
    buildDateSubheader(wrapper, 'Adjustments Detail');

    // --- Summary Cards (inverted mint style, same as Daily Flash) ---
    const cardRow = document.createElement('div');
    cardRow.style.cssText = `
        display: flex;
        gap: 16px;
        margin-bottom: 28px;
    `;

    const cardItems = [
        { label: 'Discounts', value: flash.discounts },
        { label: 'Comps',     value: flash.comps },
        { label: 'Voids',     value: flash.voids },
    ];

    cardItems.forEach(item => {
        const card = document.createElement('div');
        card.style.cssText = `
            flex: 1;
            background: rgba(var(--color-mint-rgb), 0.8);
            border: 1px solid rgba(var(--color-mint-rgb), 0.12);
            border-radius: 4px;
            padding: 14px;
            text-align: center;
        `;
        card.innerHTML = `
            <div style="font-size: 25px; color: ${COLORS.dark}; text-transform: uppercase; letter-spacing: 1px; margin-bottom: 4px;">${item.label}</div>
            <div style="font-size: 35px; color: ${COLORS.dark}; font-family: var(--font-display);">${fmt$(item.value)}</div>
        `;
        cardRow.appendChild(card);
    });

    // Total card
    const totalCard = document.createElement('div');
    totalCard.style.cssText = `
        flex: 1;
        background: rgba(var(--color-mint-rgb), 0.8);
        border: 1px solid rgba(var(--color-vermillion-rgb), 0.2);
        border-radius: 4px;
        padding: 14px;
        text-align: center;
    `;
    totalCard.innerHTML = `
        <div style="font-size: 20px; color: ${COLORS.dark}; text-transform: uppercase; letter-spacing: 1px; margin-bottom: 4px;">Total (${pctOfSales}% of sales)</div>
        <div style="font-size: 35px; color: ${COLORS.dark}; font-family: var(--font-display);">${fmt$(total)}</div>
    `;
    cardRow.appendChild(totalCard);
    wrapper.appendChild(cardRow);

    // --- Grouped Line Items ---
    const groups = [
        { label: 'Discounts', items: details.discounts },
        { label: 'Comps',     items: details.comps },
        { label: 'Voids',     items: details.voids },
    ];

    groups.forEach(group => {
        // Group heading
        const heading = document.createElement('div');
        heading.style.cssText = `
            font-family: var(--font-display);
            font-size: 30px;
            color: ${COLORS.yellow};
            margin: 20px 0 8px 0;
            padding-bottom: 4px;
            border-bottom: 1px solid rgba(var(--color-mint-rgb), 0.1);
        `;
        heading.textContent = group.label;
        wrapper.appendChild(heading);

        // Line items
        group.items.forEach(item => {
            const row = document.createElement('div');
            row.style.cssText = `
                display: flex;
                align-items: center;
                gap: 12px;
                padding: 10px 8px;
                border-bottom: 1px solid rgba(var(--color-mint-rgb), 0.06);
                font-size: 25px;
            `;
            row.innerHTML = `
                <span style="flex: 1; color: ${COLORS.mint};">${item.reason}</span>
                <span style="color: rgba(var(--color-mint-rgb), 0.4); min-width: 80px; text-align: right;">${item.table}</span>
                <span style="color: rgba(var(--color-mint-rgb), 0.4); min-width: 70px; text-align: right;">${item.server}</span>
                <span style="color: ${COLORS.red}; font-family: var(--font-display); min-width: 90px; text-align: right;">-${fmt$(item.amount)}</span>
            `;
            wrapper.appendChild(row);
        });
    });

    // --- Total Adjustments Row ---
    const totalRow = document.createElement('div');
    totalRow.style.cssText = `
        display: flex;
        align-items: center;
        gap: 12px;
        padding: 14px 8px;
        margin-top: 8px;
        border-top: 2px solid rgba(var(--color-mint-rgb), 0.2);
        font-size: 25px;
    `;
    totalRow.innerHTML = `
        <span style="flex: 1; color: ${COLORS.mint}; font-family: var(--font-display);">Total Adjustments</span>
        <span style="color: ${COLORS.red}; font-family: var(--font-display); font-size: 30px;">-${fmt$(total)}</span>
        <span style="color: rgba(var(--color-mint-rgb), 0.4); margin-left: 8px;">(${pctOfSales}% of net sales)</span>
    `;
    wrapper.appendChild(totalRow);
}

/* ==========================================
   DAILY FLASH COMPONENT BUILDERS

   Everything below is UNCHANGED from the
   original reporting.js. These are the
   individual section builders that make up
   the Daily Flash view.
   ========================================== */

/* ------------------------------------------
   KPI CARD BUILDER
------------------------------------------ */
function buildKPICards(container) {
    const data = SAMPLE_DATA.dailyFlash;
    const isToday = data.date === new Date().toISOString().slice(0, 10);
    const kpis = [
        { label: 'Net Sales',   value: fmt$(data.today.net_sales),       delta: calcDelta(data.today.net_sales, data.yesterday.net_sales) },
        { label: 'Tax',         value: fmt$(data.today.tax_collected),    delta: calcDelta(data.today.tax_collected, data.yesterday.tax_collected) },
        { label: 'Tips',        value: fmt$(data.today.tips),             delta: calcDelta(data.today.tips, data.yesterday.tips) },
        { label: 'Total',       value: fmt$(data.today.total_collected),  delta: calcDelta(data.today.total_collected, data.yesterday.total_collected) },
        { label: 'Orders',      value: data.today.orders.toString(),      delta: calcDelta(data.today.orders, data.yesterday.orders) },
        { label: 'Guests',      value: data.today.guests.toString(),      delta: calcDelta(data.today.guests, data.yesterday.guests) },
        { label: 'Avg Check',   value: fmt$(data.today.avg_check),        delta: calcDelta(data.today.avg_check, data.yesterday.avg_check) },
    ];

    const grid = document.createElement('div');
    grid.style.cssText = `
        display: grid;
        grid-template-columns: repeat(4, 1fr);
        gap: 12px;
        margin-bottom: 24px;
    `;

    kpis.forEach(kpi => {
        const card = document.createElement('div');
        card.style.cssText = `
            background: rgba(var(--color-mint-rgb), 0.06);
            border: 1px solid rgba(var(--color-mint-rgb), 0.15);
            border-radius: 4px;
            padding: 16px;
            text-align: center;
        `;

        const deltaHtml = isToday
            ? (() => {
                const arrow = kpi.delta.direction === 'up' ? '\u25B2' : '\u25BC';
                const deltaColor = kpi.delta.direction === 'up' ? COLORS.mint : COLORS.red;
                return `<div style="font-size: 25px; color: ${deltaColor}; margin-top: 6px;">
                    ${arrow} ${fmtPct(kpi.delta.pct)} vs yesterday
                </div>`;
            })()
            : '';

        card.innerHTML = `
            <div style="font-size: 20px; color: ${COLORS.mint}; margin-bottom: 6px; text-transform: uppercase; letter-spacing: 1px;">
                ${kpi.label}
            </div>
            <div style="font-size: 40px; color: ${COLORS.yellow}; font-family: var(--font-display); line-height: 1.1;">
                ${kpi.value}
            </div>
            ${deltaHtml}
        `;
        grid.appendChild(card);
    });

    container.appendChild(grid);
}

/* ------------------------------------------
   SECTION HEADING BUILDER
------------------------------------------ */
function buildSectionHeading(container, text) {
    const h = document.createElement('div');
    h.style.cssText = `
        font-family: var(--font-display);
        font-size: 45px;
        color: ${COLORS.yellow};
        margin: 28px 0 12px 0;
        padding-bottom: 6px;
        border-bottom: 1px solid rgba(var(--color-mint-rgb), 0.1);
    `;
    h.textContent = text;
    container.appendChild(h);
}

/* ------------------------------------------
   HOURLY SALES LINE CHART
------------------------------------------ */
function buildHourlySalesChart(container) {
    const data = SAMPLE_DATA.hourlySales;

    const wrapper = document.createElement('div');
    wrapper.style.cssText = 'position: relative; height: 260px; margin-bottom: 16px;';

    const canvas = document.createElement('canvas');
    canvas.id = 'chart-hourly-sales';
    wrapper.appendChild(canvas);
    container.appendChild(wrapper);

    if (typeof Chart === 'undefined') return;

    new Chart(canvas, {
        type: 'line',
        data: {
            labels: data.today.map(h => h.hour),
            datasets: [
                {
                    label: 'Today',
                    data: data.today.map(h => h.sales),
                    borderColor: COLORS.mint,
                    backgroundColor: COLORS.mintGhost,
                    fill: true,
                    tension: 0.35,
                    pointRadius: 4,
                    pointBackgroundColor: COLORS.mint,
                    borderWidth: 2,
                },
                {
                    label: 'Yesterday',
                    data: data.yesterday.map(h => h.sales),
                    borderColor: COLORS.yellowFaded,
                    backgroundColor: 'transparent',
                    fill: false,
                    tension: 0.35,
                    pointRadius: 2,
                    borderWidth: 1,
                    borderDash: [5, 5],
                },
            ],
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { position: 'top' },
                tooltip: {
                    callbacks: {
                        label: ctx => `${ctx.dataset.label}: $${ctx.parsed.y.toFixed(2)}`,
                    },
                },
            },
            scales: {
                x: {
                    grid: { color: 'rgba(var(--color-mint-rgb), 0.05)' },
                    ticks: { color: COLORS.mintFaded },
                },
                y: {
                    grid: { color: 'rgba(var(--color-mint-rgb), 0.05)' },
                    ticks: {
                        color: COLORS.mintFaded,
                        callback: v => '$' + v,
                    },
                },
            },
        },
    });
}

/* ------------------------------------------
   TOP SELLERS HORIZONTAL BAR CHART
------------------------------------------ */
function buildTopSellersChart(container) {
    const data = SAMPLE_DATA.topSellers.slice(0, 6);

    const wrapper = document.createElement('div');
    wrapper.style.cssText = 'position: relative; height: 240px; margin-bottom: 16px;';

    const canvas = document.createElement('canvas');
    canvas.id = 'chart-top-sellers';
    wrapper.appendChild(canvas);
    container.appendChild(wrapper);

    if (typeof Chart === 'undefined') return;

    new Chart(canvas, {
        type: 'bar',
        data: {
            labels: data.map(d => d.name),
            datasets: [{
                label: 'Quantity Sold',
                data: data.map(d => d.qty),
                backgroundColor: data.map((_, i) =>
                    i === 0 ? COLORS.yellow :
                    i === 1 ? COLORS.mint :
                    COLORS.mintFaded
                ),
                borderColor: 'transparent',
                borderRadius: 2,
                barThickness: 28,
            }],
        },
        options: {
            indexAxis: 'y',
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { display: false },
                tooltip: {
                    callbacks: {
                        afterLabel: (ctx) => {
                            const item = data[ctx.dataIndex];
                            return `Revenue: ${fmt$(item.revenue)}`;
                        },
                    },
                },
            },
            scales: {
                x: {
                    grid: { color: 'rgba(var(--color-mint-rgb), 0.05)' },
                    ticks: { color: COLORS.mintFaded },
                },
                y: {
                    grid: { display: false },
                    ticks: {
                        color: COLORS.mint,
                        font: { size: 20 },
                    },
                },
            },
        },
    });
}

/* ------------------------------------------
   PAYMENT BREAKDOWN DONUT CHART
------------------------------------------ */
function buildPaymentDonut(container) {
    const data = SAMPLE_DATA.paymentBreakdown;

    const row = document.createElement('div');
    row.style.cssText = 'display: flex; align-items: center; gap: 24px; margin-bottom: 16px;';

    // Chart side
    const chartWrap = document.createElement('div');
    chartWrap.style.cssText = 'position: relative; width: 200px; height: 200px; flex-shrink: 0;';
    const canvas = document.createElement('canvas');
    canvas.id = 'chart-payment';
    chartWrap.appendChild(canvas);
    row.appendChild(chartWrap);

    // Stats side
    const stats = document.createElement('div');
    stats.style.cssText = 'flex: 1; font-family: var(--font-body); color: var(--color-mint);';
    stats.innerHTML = `
        <div style="margin-bottom: 25px;">
            <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 4px;">
                <span style="width: 20px; height: 20px; background: ${COLORS.mint}; display: inline-block; border-radius: 2px;"></span>
                <span style="font-size: 19px;">Credit Card</span>
            </div>
            <div style="font-size: 30px; color: ${COLORS.yellow}; font-family: var(--font-display);">
                ${fmt$(data.card.amount)}
            </div>
            <div style="font-size: 25px; opacity: 0.8;">
                ${data.card.count} transactions (${data.card.pct}%) · Fees: ${fmt$(data.card.fees)}
            </div>
        </div>
        <div>
            <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 4px;">
                <span style="width: 20px; height: 12px; background: ${COLORS.yellow}; display: inline-block; border-radius: 2px;"></span>
                <span style="font-size: 25px;">Cash</span>
            </div>
            <div style="font-size: 30px; color: ${COLORS.yellow}; font-family: var(--font-display);">
                ${fmt$(data.cash.amount)}
            </div>
            <div style="font-size: 25px; opacity: 0.5;">
                ${data.cash.count} transactions (${data.cash.pct}%)
            </div>
        </div>
    `;
    row.appendChild(stats);
    container.appendChild(row);

    if (typeof Chart === 'undefined') return;

    new Chart(canvas, {
        type: 'doughnut',
        data: {
            labels: ['Credit Card', 'Cash'],
            datasets: [{
                data: [data.card.amount, data.cash.amount],
                backgroundColor: [COLORS.mint, COLORS.yellow],
                borderColor: COLORS.dark,
                borderWidth: 3,
            }],
        },
        options: {
            responsive: true,
            maintainAspectRatio: true,
            cutout: '65%',
            plugins: {
                legend: { display: false },
                tooltip: {
                    callbacks: {
                        label: ctx => `${ctx.label}: ${fmt$(ctx.parsed)}`,
                    },
                },
            },
        },
    });
}

/* ------------------------------------------
   DAYPART BREAKDOWN DONUT + TABLE
------------------------------------------ */
function buildDaypartSection(container) {
    const data = SAMPLE_DATA.dayparts;

    const row = document.createElement('div');
    row.style.cssText = 'display: flex; align-items: flex-start; gap: 24px; margin-bottom: 16px;';

    // Chart side
    const chartWrap = document.createElement('div');
    chartWrap.style.cssText = 'position: relative; width: 200px; height: 200px; flex-shrink: 0;';
    const canvas = document.createElement('canvas');
    canvas.id = 'chart-daypart';
    chartWrap.appendChild(canvas);
    row.appendChild(chartWrap);

    // Table side
    const table = document.createElement('div');
    table.style.cssText = 'flex: 1;';

    data.forEach((dp, i) => {
        const item = document.createElement('div');
        item.style.cssText = `
            display: flex;
            align-items: center;
            gap: 12px;
            padding: 8px 0;
            border-bottom: 1px solid rgba(var(--color-mint-rgb), 0.08);
            font-size: 25px;
        `;
        item.innerHTML = `
            <span style="width: 12px; height: 12px; background: ${COLORS.segments[i]}; display: inline-block; border-radius: 2px; flex-shrink: 0;"></span>
            <span style="flex: 1; color: ${COLORS.mint};">${dp.name}</span>
            <span style="color: ${COLORS.yellow}; font-family: var(--font-display); min-width: 80px; text-align: right;">${fmt$(dp.net_sales)}</span>
            <span style="color: rgba(var(--color-mint-rgb), 0.4); min-width: 60px; text-align: right;">${dp.orders} orders</span>
            <span style="color: rgba(var(--color-mint-rgb), 0.4); min-width: 50px; text-align: right;">${dp.pct}%</span>
        `;
        table.appendChild(item);
    });

    row.appendChild(table);
    container.appendChild(row);

    if (typeof Chart === 'undefined') return;

    new Chart(canvas, {
        type: 'doughnut',
        data: {
            labels: data.map(d => d.name),
            datasets: [{
                data: data.map(d => d.net_sales),
                backgroundColor: data.map((_, i) => COLORS.segments[i]),
                borderColor: COLORS.dark,
                borderWidth: 3,
            }],
        },
        options: {
            responsive: true,
            maintainAspectRatio: true,
            cutout: '60%',
            plugins: {
                legend: { display: false },
                tooltip: {
                    callbacks: {
                        label: ctx => `${ctx.label}: ${fmt$(ctx.parsed)} (${data[ctx.dataIndex].pct}%)`,
                    },
                },
            },
        },
    });
}

/* ------------------------------------------
   DRILL-DOWN LINKS

   Now wired up to pushView() instead of
   the previous commented-out placeholder.
------------------------------------------ */
function buildDrillDownLinks(container) {
    const links = [
        { label: 'Sales by Category',  target: 'sales-by-category' },
        { label: 'Tax Breakdown',       target: 'tax-breakdown' },
        { label: 'Tips by Server',      target: 'tips-by-server' },
        { label: 'Adjustments',         target: 'adjustments' },
    ];

    const grid = document.createElement('div');
    grid.style.cssText = 'display: flex; flex-wrap: wrap; gap: 8px; margin-top: 8px;';

    links.forEach(link => {
        const btn = document.createElement('button');
        btn.style.cssText = `
            padding: 10px 20px;
            background: rgba(var(--color-mint-rgb), 0.06);
            border: 1px solid rgba(var(--color-mint-rgb), 0.2);
            color: ${COLORS.mint};
            font-family: var(--font-body);
            font-size: 25px;
            cursor: pointer;
            transition: background 0.2s ease;
        `;
        btn.textContent = `${link.label} →`;
        btn.addEventListener('mouseenter', () => {
            btn.style.background = 'rgba(var(--color-mint-rgb), 0.15)';
        });
        btn.addEventListener('mouseleave', () => {
            btn.style.background = 'rgba(var(--color-mint-rgb), 0.06)';
        });
        btn.addEventListener('click', () => pushView(link.target));
        grid.appendChild(btn);
    });

    container.appendChild(grid);
}

/* ------------------------------------------
   ADJUSTMENTS SUMMARY (Discounts/Comps/Voids)
------------------------------------------ */
function buildAdjustmentsSummary(container) {
    const data = SAMPLE_DATA.dailyFlash.today;
    const total = data.discounts + data.comps + data.voids;
    const pctOfSales = ((total / data.net_sales) * 100).toFixed(1);

    const row = document.createElement('div');
    row.style.cssText = `
        display: flex;
        gap: 16px;
        margin-bottom: 16px;
    `;

    const items = [
        { label: 'Discounts', value: data.discounts, color: COLORS.yellow },
        { label: 'Comps',     value: data.comps,      color: COLORS.mint },
        { label: 'Voids',     value: data.voids,      color: COLORS.red },
    ];

    items.forEach(item => {
        const card = document.createElement('div');
        card.style.cssText = `
            flex: 1;
            background: rgba(var(--color-mint-rgb), 0.8);
            border: 1px solid rgba(var(--color-mint-rgb), 0.12);
            border-radius: 4px;
            padding: 14px;
            text-align: center;
        `;
        card.innerHTML = `
            <div style="font-size: 25px; color: ${COLORS.dark}; text-transform: uppercase; letter-spacing: 1px; margin-bottom: 4px;">${item.label}</div>
            <div style="font-size: 35px; color: ${COLORS.dark}; font-family: var(--font-display);">${fmt$(item.value)}</div>
        `;
        row.appendChild(card);
    });

    // Total
    const totalCard = document.createElement('div');
    totalCard.style.cssText = `
        flex: 1;
        background: rgba(var(--color-mint-rgb), 0.8);
        border: 1px solid rgba(var(--color-vermillion-rgb), 0.2);
        border-radius: 4px;
        padding: 14px;
        text-align: center;
    `;
    totalCard.innerHTML = `
        <div style="font-size: 20px; color: ${COLORS.dark}; text-transform: uppercase; letter-spacing: 1px; margin-bottom: 4px;">Total (${pctOfSales}% of sales)</div>
        <div style="font-size: 35px; color: ${COLORS.dark}; font-family: var(--font-display);">${fmt$(total)}</div>
    `;
    row.appendChild(totalCard);

    container.appendChild(row);
}

/* ------------------------------------------
   CSV EXPORT
------------------------------------------ */
function exportReportCSV() {
    const d = SAMPLE_DATA.dailyFlash;
    const rows = [
        ['KINDpos Daily Flash Report'],
        ['Date', d.date],
        [''],
        ['Metric', 'Today', 'Yesterday'],
        ['Net Sales', d.today.net_sales, d.yesterday.net_sales],
        ['Tax Collected', d.today.tax_collected, d.yesterday.tax_collected],
        ['Tips', d.today.tips, d.yesterday.tips],
        ['Total Collected', d.today.total_collected, d.yesterday.total_collected],
        ['Orders', d.today.orders, d.yesterday.orders],
        ['Guests', d.today.guests, d.yesterday.guests],
        ['Avg Check', d.today.avg_check, d.yesterday.avg_check],
    ];

    if (SAMPLE_DATA.salesByCategory.length) {
        rows.push([''], ['Sales by Category'], ['Category', 'Net Sales', 'Items Sold', '%']);
        SAMPLE_DATA.salesByCategory.forEach(c => rows.push([c.category, c.net_sales, c.items_sold, c.pct]));
    }

    if (SAMPLE_DATA.hourlySales.today.length) {
        rows.push([''], ['Hourly Sales'], ['Hour', 'Sales']);
        SAMPLE_DATA.hourlySales.today.forEach(h => rows.push([h.hour, h.sales]));
    }

    const csv = rows.map(r => r.map(v => `"${v}"`).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `kindpos-report-${d.date}.csv`;
    a.click();
    URL.revokeObjectURL(url);
}

/* ------------------------------------------
   DATE HEADER (Daily Flash full header)
------------------------------------------ */
function buildDateHeader(container) {
    const header = document.createElement('div');
    header.style.cssText = `
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-bottom: 20px;
        padding-bottom: 12px;
        border-bottom: 1px solid rgba(var(--color-mint-rgb), 0.15);
    `;

    const dateStr = new Date(SAMPLE_DATA.dailyFlash.date + 'T12:00:00').toLocaleDateString('en-US', {
        weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
    });

    header.innerHTML = `
        <div>
            <div style="font-family: var(--font-display); font-size: 40px; color: ${COLORS.yellow};">
                Daily Flash Report
            </div>
            <div style="font-size: 17px; color: rgba(var(--color-mint-rgb), 0.5); margin-top: 4px;">
                ${dateStr}
            </div>
        </div>
    `;
    container.appendChild(header);
}

/* ------------------------------------------
   PUBLIC: Register scene with scene manager

   onEnter is now slim — it sets up the
   wrapper and kicks off the view stack.
   applyChartDefaults() runs once here,
   NOT on every view swap.
------------------------------------------ */
export function registerSalesReports(sceneManager) {
    sceneManager.register('sales-reports', {
        type: 'detail',
        title: 'Sales Reports',
        parent: 'reporting-subs',
        async onEnter(container) {
            hasCharts = applyChartDefaults();

            // Toolbar: mode toggle + date picker + export
            const toolbar = document.createElement('div');
            toolbar.style.cssText = `
                max-width: 900px; margin: 0 auto;
                padding: 12px 20px 0 20px;
                display: flex; align-items: center; gap: 10px; flex-wrap: wrap;
            `;

            // Day / Range toggle
            let mode = 'day';
            const toggleWrap = document.createElement('div');
            toggleWrap.style.cssText = 'display: flex; border: 1px solid rgba(var(--color-mint-rgb), 0.2); border-radius: 6px; overflow: hidden;';
            const dayBtn = document.createElement('button');
            dayBtn.textContent = 'Day';
            const rangeBtn = document.createElement('button');
            rangeBtn.textContent = 'Range';
            const toggleStyle = (active) => `
                padding: 5px 14px; border: none; font-family: var(--font-body); font-size: 16px; cursor: pointer;
                background: ${active ? 'rgba(var(--color-mint-rgb), 0.2)' : 'transparent'};
                color: ${active ? 'var(--color-gold)' : 'var(--color-mint)'};
            `;
            dayBtn.style.cssText = toggleStyle(true);
            rangeBtn.style.cssText = toggleStyle(false);

            const pickerSlot = document.createElement('div');
            pickerSlot.style.cssText = 'flex: 1;';

            function reloadReport(date) {
                loadReportData(date).then(() => {
                    if (currentWrapper) { viewHistory = []; pushView('daily-flash'); }
                });
            }

            function showDayPicker() {
                mode = 'day';
                dayBtn.style.cssText = toggleStyle(true);
                rangeBtn.style.cssText = toggleStyle(false);
                pickerSlot.innerHTML = '';
                pickerSlot.appendChild(buildDatePicker({
                    value: SAMPLE_DATA.dailyFlash.date,
                    onChange: reloadReport,
                }));
            }

            function showRangePicker() {
                mode = 'range';
                dayBtn.style.cssText = toggleStyle(false);
                rangeBtn.style.cssText = toggleStyle(true);
                pickerSlot.innerHTML = '';
                pickerSlot.appendChild(buildDateRangePicker({
                    end: SAMPLE_DATA.dailyFlash.date,
                    onChange: ({ end }) => reloadReport(end),
                }));
            }

            dayBtn.addEventListener('click', showDayPicker);
            rangeBtn.addEventListener('click', showRangePicker);
            toggleWrap.appendChild(dayBtn);
            toggleWrap.appendChild(rangeBtn);
            toolbar.appendChild(toggleWrap);
            toolbar.appendChild(pickerSlot);
            showDayPicker();

            const exportBtn = document.createElement('button');
            exportBtn.textContent = 'Export CSV';
            exportBtn.className = 'kp-preset-btn';
            exportBtn.style.cssText += 'font-size: 18px; padding: 5px 16px;';
            exportBtn.addEventListener('click', () => exportReportCSV());
            toolbar.appendChild(exportBtn);
            container.appendChild(toolbar);

            currentWrapper = document.createElement('div');
            currentWrapper.style.cssText = `
                max-width: 900px;
                margin: 0 auto;
                padding: 10px 20px 40px 20px;
            `;
            container.appendChild(currentWrapper);

            pushView('daily-flash');
        },
        onExit(container) {
            viewHistory = [];
            currentWrapper = null;
            container.innerHTML = '';
        },
    });
}