import { T, withAlpha } from '../ui/tokens.js';

// ─── Module state ─────────────────────────────────────────────────────
let _currentContainer = null;
let _abortController  = null;
let _clearAllBtn      = null;
let _activeTagsEl     = null;
let _resultCountEl    = null;
let _summaryStrip     = null;
let _currentPage      = 1;

export let _pillValues    = {};
export let _activeFilters = [];

// ─── Fetch ────────────────────────────────────────────────────────────
async function fetchJson(url, signal) {
    const res = await fetch(url, { signal });
    if (!res.ok) throw new Error(`${url} ${res.status}`);
    return res.json();
}

function buildTransactionsUrl() {
    const from = document.getElementById('tl-date-from');
    const to   = document.getElementById('tl-date-to');
    const params = new URLSearchParams();
    if (from && from.value) params.set('date_from', from.value);
    if (to   && to.value)   params.set('date_to',   to.value);

    _activeFilters.forEach(f => {
        const v = f.value;
        switch (f.group) {
            case 'daypart':
                params.append('day_part', v.toLowerCase().replace(/ /g, '_'));
                break;
            case 'ordertype':
                params.append('order_type', v.toLowerCase().replace(/-/g, '_'));
                break;
            case 'payment':
                params.append('payment_method', v.toLowerCase());
                break;
            case 'server':
                params.append('server_id', v.toLowerCase());
                break;
        }
    });

    params.set('page', _currentPage);
    params.set('page_size', 50);
    return `/api/v1/reports/transactions?${params.toString()}`;
}

// ─── Lifecycle ────────────────────────────────────────────────────────
function still() { return _currentContainer !== null; }

export default function mount(container) {
    if (_abortController) _abortController.abort();
    _currentContainer = container;
    _abortController = new AbortController();
    renderSkeleton(container);
    loadTransactions();
}

export function unmount() {
    if (_abortController) _abortController.abort();
    _currentContainer = null;
}

async function loadTransactions() {
    const container = _currentContainer;
    if (!still()) return;
    renderSkeleton(container);
    const signal = _abortController.signal;
    const url = buildTransactionsUrl();
    const [txResult, empResult] = await Promise.allSettled([
        fetchJson(url, signal),
        fetchJson('/api/v1/config/employees', signal),
    ]);
    if (!still()) return;
    if (txResult.status === 'rejected') {
        renderError(container, txResult.reason);
        return;
    }
    const data      = txResult.value;
    const employees = empResult.status === 'fulfilled' ? empResult.value : [];
    populateServerChips(employees);
    renderPage_data(container, data, employees);
}

function renderError(container, err) {
    container.textContent = 'Error: ' + err.message;
}

function populateServerChips(employees) { /* TODO 3b */ }

function renderPage_data(container, data, employees) { /* TODO 3b */ }

// ─── Skeleton (loading state) ─────────────────────────────────────────
function renderSkeleton(container) {
    if (!document.getElementById('tl-styles')) {
        const style = document.createElement('style');
        style.id = 'tl-styles';
        style.textContent = `
            @keyframes tl-pulse {
                0%, 100% { opacity: 0.4; }
                50%       { opacity: 0.7; }
            }
            .tl-loading { padding: 24px; }
            .tl-loading-row {
                background: ${T.well};
                border-radius: 8px;
                height: 18px;
                margin-bottom: 12px;
                animation: tl-pulse 1.4s ease-in-out infinite;
            }
        `;
        document.head.appendChild(style);
    }

    const wrap = document.createElement('div');
    wrap.className = 'tl-loading';

    [' 100%', '60%', '80%'].forEach(w => {
        const row = document.createElement('div');
        row.className = 'tl-loading-row';
        row.style.width = w.trim();
        wrap.appendChild(row);
    });

    container.innerHTML = '';
    container.appendChild(wrap);
}

// ─── Page-level styles (appended to tl-styles once) ──────────────────
function ensurePageStyles() {
    const style = document.getElementById('tl-styles');
    if (!style || style.dataset.full) return;
    style.dataset.full = '1';
    style.textContent += `
        .tl-chip {
            background: ${T.well};
            border: 1px solid ${T.border};
            color: ${T.text};
            border-radius: 6px;
            font-family: ${T.fb};
            font-size: 11px;
            padding: 4px 10px;
            cursor: pointer;
            transition: border-color 0.15s, color 0.15s, background 0.15s;
        }
        .tl-chip-selected {
            border-color: ${T.green};
            color: ${T.green};
            background: ${withAlpha(T.green, 0.09)};
        }
        .tl-filter-label {
            font-family: ${T.fb};
            font-size: 11px;
            text-transform: uppercase;
            letter-spacing: 0.12em;
            color: ${T.muted};
            white-space: nowrap;
        }
        .tl-active-tag {
            display: inline-flex;
            border-radius: 999px;
            font-family: ${T.fb};
            font-size: 11px;
            background: ${withAlpha(T.green, 0.1)};
            border: 1px solid ${withAlpha(T.green, 0.25)};
            color: ${T.green};
            padding: 2px 8px 2px 10px;
            cursor: pointer;
        }
        .tl-stat-pill {}
    `;
}

// ─── Page ─────────────────────────────────────────────────────────────
function renderPage(container) {
    container.innerHTML = '';
    _clearAllBtn   = null;
    _activeTagsEl  = null;
    _resultCountEl = null;
    _summaryStrip  = null;
    _activeFilters = [];
    _pillValues    = {};
    ensurePageStyles();
    renderPageHeader(container);
    renderStatPills(container);
    renderFilterBar(container);
}

// ─── Page Header ──────────────────────────────────────────────────────
function renderPageHeader(container) {
    const header = document.createElement('div');
    header.style.cssText = `
        display: flex;
        justify-content: space-between;
        align-items: flex-start;
        padding: 20px 24px 16px;
    `;

    // Left column — eyebrow / title / subtitle
    const left = document.createElement('div');

    const eyebrow = document.createElement('div');
    eyebrow.style.cssText = `
        font-family: ${T.fb};
        font-size: 11px;
        letter-spacing: 0.18em;
        text-transform: uppercase;
        color: ${T.green};
        margin-bottom: 4px;
    `;
    eyebrow.textContent = 'Reports';

    const title = document.createElement('div');
    title.style.cssText = `
        font-family: ${T.fh};
        font-size: 26px;
        font-weight: 700;
        color: ${T.text};
        margin-bottom: 4px;
    `;
    title.textContent = 'Transaction Log';

    const now = new Date();
    const dayNames   = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
    const monthNames = ['January','February','March','April','May','June','July','August','September','October','November','December'];
    const dateStr = `${dayNames[now.getDay()]}, ${monthNames[now.getMonth()]} ${now.getDate()} ${now.getFullYear()} · Business Day`;

    const subtitle = document.createElement('div');
    subtitle.style.cssText = `
        font-family: ${T.fb};
        font-size: 12px;
        color: ${T.muted};
    `;
    subtitle.textContent = dateStr;

    left.appendChild(eyebrow);
    left.appendChild(title);
    left.appendChild(subtitle);

    // Right — Export CSV button
    const exportBtn = document.createElement('button');
    exportBtn.style.cssText = `
        border: 1.5px solid ${T.border};
        border-radius: 6px;
        background: ${T.card};
        color: ${T.text};
        font-family: ${T.fb};
        font-size: 11px;
        text-transform: uppercase;
        letter-spacing: 0.12em;
        padding: 8px 18px;
        cursor: pointer;
    `;
    exportBtn.textContent = 'Export CSV';
    exportBtn.addEventListener('mouseenter', () => { exportBtn.style.borderColor = T.green; });
    exportBtn.addEventListener('mouseleave', () => { exportBtn.style.borderColor = T.border; });
    exportBtn.addEventListener('click', () => console.log('export csv'));

    header.appendChild(left);
    header.appendChild(exportBtn);
    container.appendChild(header);
}

// ─── Stat Pills ───────────────────────────────────────────────────────
function renderStatPills(container) {
    const row = document.createElement('div');
    row.style.cssText = `
        display: flex;
        gap: 12px;
        flex-wrap: wrap;
        padding: 0 24px 16px;
    `;

    const pills = [
        { id: 'totalChecks', label: 'Total Checks', accent: T.green,    sub: 'Closed today'    },
        { id: 'grossSales',  label: 'Gross Sales',  accent: T.gold,     sub: 'Pre-discount'    },
        { id: 'netSales',    label: 'Net Sales',    accent: T.gold,     sub: 'After discounts' },
        { id: 'cardRevenue', label: 'Card Revenue', accent: T.elec,     sub: 'of net'          },
        { id: 'cashRevenue', label: 'Cash Revenue', accent: T.green,    sub: 'of net'          },
        { id: 'discounts',   label: 'Discounts',    accent: T.lavender, sub: 'applied'         },
        { id: 'voids',       label: 'Voids',        accent: T.verm,     sub: 'items'           },
    ];

    pills.forEach(pill => {
        const card = document.createElement('div');
        card.className = 'tl-stat-pill';
        card.style.cssText = `
            background: ${T.card};
            border: 1px solid ${T.border};
            border-left: 3px solid ${pill.accent};
            border-radius: 8px;
            padding: 12px 20px;
            display: flex;
            flex-direction: column;
            gap: 4px;
            min-width: 150px;
        `;

        const lbl = document.createElement('div');
        lbl.style.cssText = `
            font-family: ${T.fb};
            font-size: 10px;
            text-transform: uppercase;
            letter-spacing: 0.2em;
            color: ${T.muted};
        `;
        lbl.textContent = pill.label;

        const valueEl = document.createElement('div');
        valueEl.style.cssText = `
            font-family: ${T.fh};
            font-size: 24px;
            font-weight: 700;
            color: ${pill.accent};
        `;
        valueEl.textContent = '—';

        const sub = document.createElement('div');
        sub.style.cssText = `
            font-family: ${T.fb};
            font-size: 11px;
            color: ${T.muted};
        `;
        sub.textContent = pill.sub;

        card.appendChild(lbl);
        card.appendChild(valueEl);
        card.appendChild(sub);
        row.appendChild(card);

        _pillValues[pill.id] = valueEl;
    });

    container.appendChild(row);
}

// ─── Filter Bar helpers ───────────────────────────────────────────────
function _makeDivider() {
    const d = document.createElement('div');
    d.style.cssText = `
        width: 1px;
        height: 26px;
        background: ${T.border};
        flex-shrink: 0;
        align-self: center;
    `;
    return d;
}

function _makeDateInput(value) {
    const input = document.createElement('input');
    input.type = 'text';
    input.value = value;
    input.style.cssText = `
        background: ${T.well};
        border: 1px solid ${T.border};
        border-radius: 6px;
        color: ${T.text};
        font-family: ${T.fb};
        font-size: 12px;
        padding: 5px 10px;
        width: 108px;
        outline: none;
    `;
    return input;
}

function _makeFilterGroup(label, values, groupName) {
    const group = document.createElement('div');
    group.dataset.group = groupName;
    group.style.cssText = 'display: flex; align-items: center; gap: 6px;';

    const lbl = document.createElement('span');
    lbl.className = 'tl-filter-label';
    lbl.textContent = label;
    group.appendChild(lbl);

    values.forEach(val => {
        const chip = document.createElement('button');
        chip.className = 'tl-chip';
        chip.dataset.value = val;
        chip.textContent = val;
        chip.addEventListener('click', () => toggleChip(chip, groupName));
        group.appendChild(chip);
    });

    return group;
}

// ─── Filter Bar ───────────────────────────────────────────────────────
function renderFilterBar(container) {
    const todayStr = new Date().toISOString().slice(0, 10);

    const card = document.createElement('div');
    card.style.cssText = `
        background: ${T.card};
        border: 1px solid ${T.border};
        border-radius: 10px;
        overflow: hidden;
        margin: 0 24px 24px;
    `;

    // Row 1 — filter controls
    const row1 = document.createElement('div');
    row1.style.cssText = `
        padding: 14px 18px;
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: 10px;
    `;

    // Date group
    const dateGroup = document.createElement('div');
    dateGroup.style.cssText = 'display: flex; align-items: center; gap: 6px;';
    const dateLbl = document.createElement('span');
    dateLbl.className = 'tl-filter-label';
    dateLbl.textContent = 'Date';
    const arrowSpan = document.createElement('span');
    arrowSpan.style.cssText = `color: ${T.muted}; font-size: 12px;`;
    arrowSpan.textContent = '→';
    const dateFrom = _makeDateInput(todayStr);
    dateFrom.id = 'tl-date-from';
    const dateTo = _makeDateInput(todayStr);
    dateTo.id = 'tl-date-to';
    dateGroup.appendChild(dateLbl);
    dateGroup.appendChild(dateFrom);
    dateGroup.appendChild(arrowSpan);
    dateGroup.appendChild(dateTo);
    row1.appendChild(dateGroup);
    row1.appendChild(_makeDivider());

    row1.appendChild(_makeFilterGroup('Day Part',   ['Lunch', 'Dinner', 'Late Night'],          'daypart'));
    row1.appendChild(_makeDivider());
    row1.appendChild(_makeFilterGroup('Order Type', ['Dine-In', 'To-Go', 'Bar', 'Delivery'],    'ordertype'));
    row1.appendChild(_makeDivider());
    row1.appendChild(_makeFilterGroup('Payment',    ['Cash', 'Card', 'Split', 'Comp'],           'payment'));
    row1.appendChild(_makeDivider());

    // Server group — chips populated in Chunk 3
    const serverGroup = document.createElement('div');
    serverGroup.dataset.group = 'server';
    serverGroup.style.cssText = 'display: flex; align-items: center; gap: 6px;';
    const serverLbl = document.createElement('span');
    serverLbl.className = 'tl-filter-label';
    serverLbl.textContent = 'Server';
    serverGroup.appendChild(serverLbl);
    // TODO Chunk 3: populate from /api/v1/config/employees
    row1.appendChild(serverGroup);

    // Right side — Clear All + Search
    const right = document.createElement('div');
    right.style.cssText = 'margin-left: auto; display: flex; align-items: center; gap: 8px;';

    _clearAllBtn = document.createElement('button');
    _clearAllBtn.style.cssText = `
        opacity: 0;
        pointer-events: none;
        border: 1px solid ${T.verm};
        color: ${T.verm};
        background: none;
        border-radius: 6px;
        font-family: ${T.fb};
        font-size: 11px;
        text-transform: uppercase;
        padding: 5px 12px;
        cursor: pointer;
        transition: opacity 0.15s;
    `;
    _clearAllBtn.textContent = 'Clear All';
    _clearAllBtn.addEventListener('click', clearAllFilters);

    const searchInput = document.createElement('input');
    searchInput.type = 'text';
    searchInput.placeholder = 'Check #, last 4…';
    searchInput.style.cssText = `
        background: ${T.well};
        border: 1px solid ${T.border};
        border-radius: 6px;
        color: ${T.text};
        font-family: ${T.fb};
        font-size: 12px;
        padding: 5px 12px;
        width: 200px;
        outline: none;
    `;

    right.appendChild(_clearAllBtn);
    right.appendChild(searchInput);
    row1.appendChild(right);
    card.appendChild(row1);

    // Row 2 — active filter summary strip (hidden by default)
    _summaryStrip = document.createElement('div');
    _summaryStrip.style.cssText = `
        display: none;
        background: rgba(0,0,0,0.12);
        border-top: 1px solid ${T.border};
        padding: 9px 18px;
        flex-wrap: wrap;
        gap: 8px;
        align-items: center;
    `;

    const activeLabel = document.createElement('span');
    activeLabel.style.cssText = `
        font-family: ${T.fb};
        font-size: 10px;
        text-transform: uppercase;
        color: ${T.muted};
    `;
    activeLabel.textContent = 'Active:';

    _activeTagsEl = document.createElement('div');
    _activeTagsEl.id = 'tl-active-tags';
    _activeTagsEl.style.cssText = 'display: flex; flex-direction: row; gap: 6px; flex-wrap: wrap;';

    _resultCountEl = document.createElement('span');
    _resultCountEl.id = 'tl-result-count';
    _resultCountEl.style.cssText = `
        margin-left: auto;
        font-family: ${T.fb};
        font-size: 11px;
        color: ${T.muted};
    `;

    _summaryStrip.appendChild(activeLabel);
    _summaryStrip.appendChild(_activeTagsEl);
    _summaryStrip.appendChild(_resultCountEl);
    card.appendChild(_summaryStrip);

    container.appendChild(card);
}

// ─── Filter interaction ───────────────────────────────────────────────
function toggleChip(chip, groupName) {
    chip.classList.toggle('tl-chip-selected');
    updateFilterSummary();
}

function clearAllFilters() {
    if (!_currentContainer) return;
    _currentContainer.querySelectorAll('.tl-chip-selected').forEach(chip => {
        chip.classList.remove('tl-chip-selected');
    });
    updateFilterSummary();
}

function updateFilterSummary() {
    if (!_currentContainer) return;

    _activeFilters = [];
    _currentContainer.querySelectorAll('[data-group]').forEach(group => {
        const groupName = group.dataset.group;
        group.querySelectorAll('.tl-chip-selected').forEach(chip => {
            _activeFilters.push({ value: chip.dataset.value, group: groupName });
        });
    });

    if (_activeFilters.length > 0) {
        if (_clearAllBtn) {
            _clearAllBtn.style.opacity = '1';
            _clearAllBtn.style.pointerEvents = 'auto';
        }
        if (_summaryStrip) _summaryStrip.style.display = 'flex';
        if (_activeTagsEl) {
            _activeTagsEl.innerHTML = '';
            _activeFilters.forEach(filter => {
                const tag = document.createElement('button');
                tag.className = 'tl-active-tag';
                tag.textContent = `${filter.value} ×`;
                tag.addEventListener('click', () => {
                    if (!_currentContainer) return;
                    _currentContainer
                        .querySelectorAll(`[data-group="${filter.group}"] .tl-chip-selected`)
                        .forEach(chip => {
                            if (chip.dataset.value === filter.value) {
                                chip.classList.remove('tl-chip-selected');
                            }
                        });
                    updateFilterSummary();
                });
                _activeTagsEl.appendChild(tag);
            });
        }
        if (_resultCountEl) {
            _resultCountEl.textContent = 'Filters active — fetch will apply on load';
        }
    } else {
        if (_clearAllBtn) {
            _clearAllBtn.style.opacity = '0';
            _clearAllBtn.style.pointerEvents = 'none';
        }
        if (_summaryStrip) _summaryStrip.style.display = 'none';
    }
    _currentPage = 1;
    loadTransactions();
}
