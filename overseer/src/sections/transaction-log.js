import { T, withAlpha } from '../ui/tokens.js';
import { fmt } from '../ui/money.js';

// ─── Module state ─────────────────────────────────────────────────────
let _currentContainer = null;
let _abortController  = null;
let _clearAllBtn      = null;
let _activeTagsEl     = null;
let _resultCountEl    = null;
let _summaryStrip     = null;
let _currentPage      = 1;
let _tabRowEl         = null;
let _tableWrapEl      = null;
let _modalEl          = null;
let _modalOrderId     = null;
let _modalCheckNumEl  = null;
let _modalMetaTopEl   = null;
let _modalMetaSubEl   = null;
let _modalLeftEl      = null;
let _modalRightEl     = null;

// Fallbacks for tokens not yet in tokens.js
const _MOON        = T.moon        || T.lavender;
const _SRV_PALETTE = T.srvPalette  || [T.elec, T.green, T.gold, T.lavender, T.verm, T.mint];
const _SEAT_PALETTE = T.seatPalette || [T.green, T.elec, T.gold, T.lavender, T.verm, T.mint, T.greenUp, T.warning];
const _GREEN_WARM   = T.greenWarm   || T.green;

export let _pillValues    = {};
export let _activeFilters = [];

// ─── Helpers ─────────────────────────────────────────────────────────
function formatTime(isoString) {
    const d = new Date(isoString);
    let h = d.getHours();
    const m = String(d.getMinutes()).padStart(2, '0');
    const ampm = h >= 12 ? 'PM' : 'AM';
    h = h % 12 || 12;
    return `${h}:${m} ${ampm}`;
}

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
    const wrap = document.createElement('div');
    wrap.style.cssText = 'max-width: 480px; margin: 40px auto; text-align: center;';

    const card = document.createElement('div');
    card.style.cssText = `
        background: ${T.card};
        border-left: 3px solid ${T.verm};
        border-radius: 8px;
        padding: 20px 24px;
        text-align: left;
    `;

    const title = document.createElement('div');
    title.style.cssText = `
        color: ${T.verm};
        font-family: ${T.fh};
        font-size: 16px;
        font-weight: 600;
    `;
    title.textContent = 'Failed to load transactions';

    const msg = document.createElement('div');
    msg.style.cssText = `
        color: ${T.text};
        font-family: ${T.fb};
        font-size: 13px;
        margin-top: 6px;
    `;
    msg.textContent = err.message;

    const retryBtn = document.createElement('button');
    retryBtn.style.cssText = `
        border: 1px solid ${T.green};
        color: ${T.green};
        background: none;
        border-radius: 6px;
        font-family: ${T.fb};
        font-size: 11px;
        text-transform: uppercase;
        letter-spacing: 0.1em;
        padding: 8px 16px;
        margin-top: 14px;
        cursor: pointer;
    `;
    retryBtn.textContent = 'Retry';
    retryBtn.addEventListener('click', () => { _currentPage = 1; loadTransactions(); });

    card.appendChild(title);
    card.appendChild(msg);
    card.appendChild(retryBtn);
    wrap.appendChild(card);
    container.innerHTML = '';
    container.appendChild(wrap);
}

function populateServerChips(employees) {
    if (!_currentContainer) return;
    const group = _currentContainer.querySelector('[data-group="server"]');
    if (!group) return;
    if (group.querySelector('.tl-chip')) return;
    employees.forEach(emp => {
        const chip = document.createElement('button');
        chip.className = 'tl-chip';
        chip.dataset.value = emp.id;
        chip.textContent = emp.name;
        chip.addEventListener('click', () => toggleChip(chip, 'server'));
        group.appendChild(chip);
    });
}

function updateStatPills(data) {
    const set = (id, text) => { if (_pillValues[id]) _pillValues[id].textContent = text; };
    const setSub = (id, text) => {
        const el = _pillValues[id];
        if (el && el.nextElementSibling) el.nextElementSibling.textContent = text;
    };
    set('totalChecks', data.total_checks    != null ? String(data.total_checks)    : '—');
    set('grossSales',  data.gross_sales     != null ? fmt(data.gross_sales)        : '—');
    set('netSales',    data.net_sales       != null ? fmt(data.net_sales)          : '—');
    set('cardRevenue', data.card_revenue    != null ? fmt(data.card_revenue)       : '—');
    set('cashRevenue', data.cash_revenue    != null ? fmt(data.cash_revenue)       : '—');
    set('discounts',   data.total_discounts != null ? fmt(data.total_discounts)    : '—');
    set('voids',       data.total_voids     != null ? fmt(data.total_voids)        : '—');
    if (data.discount_count != null) setSub('discounts', `${data.discount_count} applied`);
    if (data.void_count     != null) setSub('voids',     `${data.void_count} items`);
}

function renderTabs(container, data) {
    const tabs = [
        { id: 'transactions', label: 'Transactions', count: data.total_count    || 0 },
        { id: 'discounts',    label: 'Discounts',    count: data.discount_count || 0 },
        { id: 'voids',        label: 'Voids',        count: data.void_count     || 0 },
    ];

    _tabRowEl = document.createElement('div');
    _tabRowEl.style.cssText = `
        display: flex;
        border-bottom: 1.5px solid ${T.border};
        padding: 0 24px;
    `;

    tabs.forEach(tab => {
        const isActive = tab.id === 'transactions';
        const btn = document.createElement('button');
        btn.style.cssText = `
            background: none;
            border: none;
            border-bottom: 2px solid ${isActive ? T.green : 'transparent'};
            color: ${isActive ? T.green : T.muted};
            font-family: ${T.fb};
            font-size: 13px;
            padding: 10px 16px;
            cursor: pointer;
            display: flex;
            align-items: center;
            gap: 6px;
            margin-bottom: -1.5px;
        `;

        const labelSpan = document.createElement('span');
        labelSpan.textContent = tab.label;

        const badge = document.createElement('span');
        badge.style.cssText = `
            background: ${isActive ? withAlpha(T.green, 0.15) : T.well};
            color: ${isActive ? T.green : T.muted};
            border-radius: 999px;
            font-size: 10px;
            padding: 1px 7px;
            font-family: ${T.fb};
        `;
        badge.textContent = String(tab.count);

        btn.appendChild(labelSpan);
        btn.appendChild(badge);

        if (!isActive) {
            btn.addEventListener('click', () => console.log('tab:', tab.id));
        }

        _tabRowEl.appendChild(btn);
    });

    container.appendChild(_tabRowEl);
}

function renderPage_data(container, data, employees) {
    populateServerChips(employees);
    updateStatPills(data);
    renderTabs(container, data);
    renderTable(container, data.results || []);
    renderPagination(container, data);
}

function renderTable(container, rows) {
    _tableWrapEl = document.createElement('div');
    _tableWrapEl.style.cssText = `
        background: ${T.card};
        border: 1px solid ${T.border};
        border-radius: 10px;
        overflow: hidden;
        margin: 0 24px 24px;
    `;

    if (rows.length === 0) {
        const empty = document.createElement('div');
        empty.style.cssText = `
            text-align: center;
            padding: 60px 20px;
            color: ${T.muted};
            font-family: ${T.fb};
            font-size: 13px;
        `;
        empty.textContent = 'No transactions match the current filters';
        _tableWrapEl.appendChild(empty);
        container.appendChild(_tableWrapEl);
        return;
    }

    const table = document.createElement('table');
    table.style.cssText = 'width: 100%; border-collapse: collapse;';

    // thead
    const thead = document.createElement('thead');
    thead.style.cssText = `background: ${T.well}; border-bottom: 1px solid ${T.border};`;
    const headerRow = document.createElement('tr');
    const cols = [
        { label: 'Check #',    align: 'left'  },
        { label: 'Time',       align: 'left'  },
        { label: 'Server',     align: 'left'  },
        { label: 'Order Type', align: 'left'  },
        { label: 'Day Part',   align: 'left'  },
        { label: 'Items',      align: 'left'  },
        { label: 'Subtotal',   align: 'right' },
        { label: 'Discount',   align: 'right' },
        { label: 'Tax',        align: 'right' },
        { label: 'Total',      align: 'right' },
        { label: 'Tip',        align: 'right' },
        { label: 'Payment',    align: 'left'  },
        { label: 'Last 4',     align: 'right' },
    ];
    cols.forEach(col => {
        const th = document.createElement('th');
        th.style.cssText = `
            font-family: ${T.fb};
            font-size: 10px;
            text-transform: uppercase;
            letter-spacing: 0.2em;
            color: ${T.muted};
            padding: 11px 16px;
            text-align: ${col.align};
        `;
        th.textContent = col.label;
        headerRow.appendChild(th);
    });
    thead.appendChild(headerRow);
    table.appendChild(thead);

    // tbody
    const tbody = document.createElement('tbody');
    rows.forEach((row, idx) => {
        const tr = document.createElement('tr');
        tr.style.cssText = `border-bottom: 1px solid rgba(255,255,255,0.06);${row.voided ? ' opacity: 0.55;' : ''}`;
        tr.addEventListener('mouseenter', () => { tr.style.background = 'rgba(255,255,255,0.025)'; });
        tr.addEventListener('mouseleave', () => { tr.style.background = ''; });

        const td = (css = '') => {
            const cell = document.createElement('td');
            cell.style.cssText = `padding: 11px 16px; ${css}`;
            return cell;
        };

        // Check #
        const checkTd = td();
        const checkSpan = document.createElement('span');
        checkSpan.style.cssText = `
            color: ${row.voided ? T.verm : T.elec};
            font-weight: 700;
            cursor: pointer;
            font-family: ${T.fb};
            font-size: 13px;
        `;
        checkSpan.dataset.orderId = row.order_id;
        checkSpan.textContent = row.order_id || '—';
        checkSpan.addEventListener('click', () => openModal(row));
        checkTd.appendChild(checkSpan);
        tr.appendChild(checkTd);

        // Time
        const timeTd = td(`color: ${T.muted}; font-family: ${T.fb};`);
        timeTd.textContent = row.closed_at ? formatTime(row.closed_at) : '—';
        tr.appendChild(timeTd);

        // Server
        const serverTd = td();
        const serverFlex = document.createElement('div');
        serverFlex.style.cssText = 'display: flex; align-items: center; gap: 6px;';
        const dotColor = _SRV_PALETTE[idx % _SRV_PALETTE.length];
        const dot = document.createElement('span');
        dot.style.cssText = `
            width: 7px; height: 7px;
            border-radius: 50%;
            background: ${dotColor};
            flex-shrink: 0;
            display: inline-block;
        `;
        serverFlex.appendChild(dot);
        serverFlex.appendChild(document.createTextNode(row.server_name || '—'));
        serverTd.appendChild(serverFlex);
        tr.appendChild(serverTd);

        // Order Type
        const otTd = td();
        const otBadge = document.createElement('span');
        const ot = (row.order_type || '').toLowerCase().replace('_', '-');
        const otColor = ot === 'dine-in' ? T.green : ot === 'bar' ? T.elec : _MOON;
        otBadge.style.cssText = `
            background: ${withAlpha(otColor, 0.1)};
            border: 1px solid ${withAlpha(otColor, 0.3)};
            color: ${otColor};
            border-radius: 4px;
            font-family: ${T.fb};
            font-size: 10px;
            text-transform: uppercase;
            padding: 2px 7px;
        `;
        otBadge.textContent = row.order_type || '—';
        otTd.appendChild(otBadge);
        tr.appendChild(otTd);

        // Day Part
        const dpTd = td(`color: ${T.muted}; font-family: ${T.fb};`);
        dpTd.textContent = row.day_part || '—';
        tr.appendChild(dpTd);

        // Items
        const itemsTd = td(`text-align: center; color: ${T.muted};`);
        itemsTd.textContent = row.item_count != null ? String(row.item_count) : '—';
        tr.appendChild(itemsTd);

        // Subtotal
        const subtotalTd = td(`text-align: right; color: ${T.gold}; font-weight: 500;`);
        subtotalTd.textContent = row.subtotal != null ? fmt(row.subtotal) : '—';
        tr.appendChild(subtotalTd);

        // Discount
        const discTd = td('text-align: right;');
        if (row.discount_total > 0) {
            discTd.style.color = T.lavender;
            discTd.textContent = '–' + fmt(row.discount_total);
        } else {
            discTd.style.color = T.muted;
            discTd.textContent = '—';
        }
        tr.appendChild(discTd);

        // Tax
        const taxTd = td(`text-align: right; color: ${T.muted};`);
        taxTd.textContent = row.tax != null ? fmt(row.tax) : '—';
        tr.appendChild(taxTd);

        // Total
        const totalTd = td(`text-align: right; color: ${T.gold}; font-weight: 500;`);
        totalTd.textContent = row.total != null ? fmt(row.total) : '—';
        tr.appendChild(totalTd);

        // Tip
        const tipTd = td(`text-align: right; color: ${T.green}; font-weight: 500;`);
        tipTd.textContent = row.tip_total != null ? fmt(row.tip_total) : '—';
        tr.appendChild(tipTd);

        // Payment
        const payTd = td();
        const payBadge = document.createElement('span');
        const pm = (row.payment_method || '').toLowerCase();
        const pmColor = pm === 'cash' ? T.green : pm === 'card' ? T.elec : pm === 'split' ? T.gold : _MOON;
        payBadge.style.cssText = `
            background: ${withAlpha(pmColor, 0.1)};
            border: 1px solid ${withAlpha(pmColor, 0.3)};
            color: ${pmColor};
            border-radius: 4px;
            font-family: ${T.fb};
            font-size: 10px;
            text-transform: uppercase;
            padding: 2px 7px;
        `;
        payBadge.textContent = row.payment_method || '—';
        payTd.appendChild(payBadge);
        tr.appendChild(payTd);

        // Last 4
        const last4Td = td(`text-align: right; color: ${T.muted}; font-family: ${T.fb};`);
        last4Td.textContent = row.card_last_four || '—';
        tr.appendChild(last4Td);

        tbody.appendChild(tr);
    });

    table.appendChild(tbody);
    _tableWrapEl.appendChild(table);
    container.appendChild(_tableWrapEl);
}

function renderPagination(container, data) {
    if (!_tableWrapEl) return;
    const totalPages = data.total_pages || 1;
    const totalCount = data.total_count || 0;
    const pageSize   = data.page_size   || 50;

    const footer = document.createElement('div');
    footer.style.cssText = `
        background: ${T.well};
        border-top: 1px solid ${T.border};
        padding: 14px 20px;
        display: flex;
        justify-content: space-between;
        align-items: center;
    `;

    // Left — "Showing X–Y of Z checks"
    const x = (_currentPage - 1) * pageSize + 1;
    const y = Math.min(_currentPage * pageSize, totalCount);
    const info = document.createElement('span');
    info.style.cssText = `font-family: ${T.fb}; font-size: 11px; color: ${T.muted};`;
    info.textContent = `Showing ${x}–${y} of ${totalCount} checks`;
    footer.appendChild(info);

    // Right — page controls
    const controls = document.createElement('div');
    controls.style.cssText = 'display: flex; gap: 4px; align-items: center;';

    const _btn = (label, onClick, disabled = false) => {
        const b = document.createElement('button');
        b.style.cssText = `
            background: ${T.card};
            border: 1px solid ${T.border};
            border-radius: 5px;
            color: ${T.text};
            font-family: ${T.fb};
            font-size: 11px;
            padding: 4px 11px;
            cursor: ${disabled ? 'default' : 'pointer'};
            ${disabled ? 'opacity: 0.35;' : ''}
        `;
        b.textContent = label;
        b.disabled = disabled;
        if (!disabled) {
            b.addEventListener('mouseenter', () => { b.style.borderColor = T.green; });
            b.addEventListener('mouseleave', () => { b.style.borderColor = T.border; });
            b.addEventListener('click', onClick);
        }
        return b;
    };

    // Prev
    controls.appendChild(_btn('← Prev', () => { _currentPage--; loadTransactions(); }, _currentPage === 1));

    // Page number buttons with ellipsis
    const half = 2;
    let start = Math.max(1, _currentPage - half);
    let end   = Math.min(totalPages, _currentPage + half);
    if (end - start < 4) {
        if (start === 1) end   = Math.min(totalPages, start + 4);
        else             start = Math.max(1, end - 4);
    }

    if (start > 1) {
        controls.appendChild(_btn('1', () => { _currentPage = 1; loadTransactions(); }));
        if (start > 2) {
            const ellipsis = document.createElement('span');
            ellipsis.style.cssText = `font-family: ${T.fb}; font-size: 11px; color: ${T.muted}; padding: 4px 6px;`;
            ellipsis.textContent = '…';
            controls.appendChild(ellipsis);
        }
    }

    for (let p = start; p <= end; p++) {
        const isActive = p === _currentPage;
        const pb = _btn(String(p), () => { _currentPage = p; loadTransactions(); }, false);
        if (isActive) {
            pb.style.borderColor = T.green;
            pb.style.color       = T.green;
            pb.style.fontWeight  = '500';
        }
        controls.appendChild(pb);
    }

    if (end < totalPages) {
        if (end < totalPages - 1) {
            const ellipsis = document.createElement('span');
            ellipsis.style.cssText = `font-family: ${T.fb}; font-size: 11px; color: ${T.muted}; padding: 4px 6px;`;
            ellipsis.textContent = '…';
            controls.appendChild(ellipsis);
        }
        controls.appendChild(_btn(String(totalPages), () => { _currentPage = totalPages; loadTransactions(); }));
    }

    // Next
    controls.appendChild(_btn('Next →', () => { _currentPage++; loadTransactions(); }, _currentPage === totalPages));

    footer.appendChild(controls);
    _tableWrapEl.appendChild(footer);
}

// ─── Modal ────────────────────────────────────────────────────────────
function ensureModal() {
    if (_modalEl) return;

    _modalEl = document.createElement('div');
    _modalEl.style.cssText = `
        position: fixed;
        inset: 0;
        background: ${withAlpha(T.well, 0.88)};
        z-index: 200;
        display: none;
        align-items: center;
        justify-content: center;
        padding: 24px;
    `;
    _modalEl.addEventListener('click', e => { if (e.target === _modalEl) closeModal(); });

    const shell = document.createElement('div');
    shell.style.cssText = `
        background: ${T.card};
        border: 1.5px solid ${T.border};
        border-radius: 12px;
        width: 100%;
        max-width: 780px;
        max-height: 88vh;
        display: flex;
        flex-direction: column;
        overflow: hidden;
        box-shadow: 0 24px 64px rgba(0,0,0,0.55);
    `;
    shell.addEventListener('click', e => e.stopPropagation());

    // Header
    const header = document.createElement('div');
    header.style.cssText = `
        display: flex;
        gap: 16px;
        padding: 18px 22px 16px;
        border-bottom: 1.5px solid ${T.green};
        background: ${T.well};
        flex-shrink: 0;
        align-items: flex-start;
    `;

    _modalCheckNumEl = document.createElement('span');
    _modalCheckNumEl.style.cssText = `
        font-family: ${T.fh};
        font-size: 22px;
        font-weight: 800;
        color: ${T.elec};
        letter-spacing: -0.01em;
        white-space: nowrap;
    `;

    const metaCol = document.createElement('div');
    metaCol.style.cssText = 'flex: 1; display: flex; flex-direction: column; gap: 3px;';

    _modalMetaTopEl = document.createElement('div');
    _modalMetaTopEl.style.cssText = 'display: flex; align-items: center; gap: 10px; flex-wrap: wrap;';

    _modalMetaSubEl = document.createElement('div');
    _modalMetaSubEl.style.cssText = `display: flex; gap: 8px; font-family: ${T.fb}; font-size: 11px; color: ${T.muted};`;

    metaCol.appendChild(_modalMetaTopEl);
    metaCol.appendChild(_modalMetaSubEl);

    const closeBtn = document.createElement('button');
    closeBtn.style.cssText = `
        background: none;
        border: 1px solid ${T.border};
        border-radius: 6px;
        color: ${T.muted};
        font-family: ${T.fb};
        font-size: 18px;
        width: 34px;
        height: 34px;
        display: flex;
        align-items: center;
        justify-content: center;
        cursor: pointer;
        flex-shrink: 0;
    `;
    closeBtn.textContent = '×';
    closeBtn.addEventListener('mouseenter', () => { closeBtn.style.borderColor = T.verm; closeBtn.style.color = T.verm; });
    closeBtn.addEventListener('mouseleave', () => { closeBtn.style.borderColor = T.border; closeBtn.style.color = T.muted; });
    closeBtn.addEventListener('click', closeModal);

    header.appendChild(_modalCheckNumEl);
    header.appendChild(metaCol);
    header.appendChild(closeBtn);

    // Body
    const body = document.createElement('div');
    body.style.cssText = 'display: flex; flex: 1; overflow: hidden; min-height: 0;';

    _modalLeftEl = document.createElement('div');
    _modalLeftEl.style.cssText = `
        flex: 1;
        overflow-y: auto;
        padding: 18px 20px;
        border-right: 1px solid rgba(255,255,255,0.06);
        display: flex;
        flex-direction: column;
        gap: 16px;
    `;

    _modalRightEl = document.createElement('div');
    _modalRightEl.style.cssText = `
        width: 240px;
        flex-shrink: 0;
        overflow-y: auto;
        padding: 18px 18px;
        display: flex;
        flex-direction: column;
        gap: 16px;
    `;

    body.appendChild(_modalLeftEl);
    body.appendChild(_modalRightEl);

    // Footer
    const footer = document.createElement('div');
    footer.style.cssText = `
        display: flex;
        justify-content: flex-end;
        gap: 10px;
        padding: 14px 22px;
        border-top: 1px solid ${T.border};
        background: ${T.well};
        flex-shrink: 0;
    `;

    const footerCloseBtn = document.createElement('button');
    footerCloseBtn.style.cssText = `
        background: none;
        border: 1.5px solid ${T.border};
        color: ${T.muted};
        font-family: ${T.fb};
        font-size: 11px;
        text-transform: uppercase;
        letter-spacing: 0.12em;
        padding: 8px 18px;
        border-radius: 6px;
        cursor: pointer;
    `;
    footerCloseBtn.textContent = 'Close';
    footerCloseBtn.addEventListener('click', closeModal);

    const reprintBtn = document.createElement('button');
    reprintBtn.style.cssText = `
        background: ${withAlpha(T.elec, 0.08)};
        border: 1.5px solid ${T.elec};
        color: ${T.elec};
        font-family: ${T.fb};
        font-size: 11px;
        text-transform: uppercase;
        letter-spacing: 0.12em;
        padding: 8px 18px;
        border-radius: 6px;
        cursor: pointer;
        display: flex;
        align-items: center;
        gap: 7px;
    `;
    reprintBtn.textContent = 'Reprint Receipt';
    reprintBtn.addEventListener('click', () => console.log('reprint', _modalOrderId));

    footer.appendChild(footerCloseBtn);
    footer.appendChild(reprintBtn);

    shell.appendChild(header);
    shell.appendChild(body);
    shell.appendChild(footer);
    _modalEl.appendChild(shell);
    document.body.appendChild(_modalEl);
}

function openModal(row) {
    ensureModal();
    _modalOrderId = row.order_id;

    _modalCheckNumEl.textContent = '#' + (row.check_number || row.order_id);

    // Meta top row
    _modalMetaTopEl.innerHTML = '';

    const serverChip = document.createElement('div');
    serverChip.style.cssText = 'display: flex; align-items: center; gap: 6px;';
    const dot = document.createElement('span');
    dot.style.cssText = `
        width: 7px; height: 7px;
        border-radius: 50%;
        background: ${_SRV_PALETTE[0]};
        flex-shrink: 0;
        display: inline-block;
    `;
    const nameSpan = document.createElement('span');
    nameSpan.style.cssText = `font-family: ${T.fb}; font-size: 13px; font-weight: 500; color: ${T.text};`;
    nameSpan.textContent = row.server_name || '—';
    serverChip.appendChild(dot);
    serverChip.appendChild(nameSpan);
    _modalMetaTopEl.appendChild(serverChip);

    if (row.order_type) {
        const ot = (row.order_type || '').toLowerCase().replace('_', '-');
        const otColor = ot === 'dine-in' ? T.green : ot === 'bar' ? T.elec : _MOON;
        const otBadge = document.createElement('span');
        otBadge.style.cssText = `
            background: ${withAlpha(otColor, 0.1)};
            border: 1px solid ${withAlpha(otColor, 0.3)};
            color: ${otColor};
            border-radius: 4px;
            font-family: ${T.fb};
            font-size: 10px;
            text-transform: uppercase;
            padding: 2px 7px;
        `;
        otBadge.textContent = row.order_type;
        _modalMetaTopEl.appendChild(otBadge);
    }

    const pm = (row.payment_method || '').toLowerCase();
    const pmColor = pm === 'cash' ? T.green : pm === 'card' ? T.elec : pm === 'split' ? T.gold : _MOON;
    const pmBadge = document.createElement('span');
    pmBadge.style.cssText = `
        background: ${withAlpha(pmColor, 0.1)};
        border: 1px solid ${withAlpha(pmColor, 0.3)};
        color: ${pmColor};
        border-radius: 4px;
        font-family: ${T.fb};
        font-size: 10px;
        text-transform: uppercase;
        padding: 2px 7px;
    `;
    pmBadge.textContent = row.payment_method || '—';
    _modalMetaTopEl.appendChild(pmBadge);

    if (row.day_part) {
        const dpSpan = document.createElement('span');
        dpSpan.style.cssText = `color: ${T.muted}; font-family: ${T.fb}; font-size: 11px;`;
        dpSpan.textContent = row.day_part;
        _modalMetaTopEl.appendChild(dpSpan);
    }

    // Meta sub row
    _modalMetaSubEl.innerHTML = '';
    const parts = [];
    if (row.table_number) parts.push('Table ' + row.table_number);
    if (row.closed_at)    parts.push('Closed ' + formatTime(row.closed_at));
    if (row.guest_count)  parts.push(row.guest_count + ' guests');
    parts.forEach((p, i) => {
        if (i > 0) {
            const sep = document.createElement('span');
            sep.style.cssText = `color: ${T.border}; margin: 0 4px;`;
            sep.textContent = '·';
            _modalMetaSubEl.appendChild(sep);
        }
        _modalMetaSubEl.appendChild(document.createTextNode(p));
    });

    _modalLeftEl.innerHTML = '';
    _modalRightEl.innerHTML = '';
    renderModalContent(row);

    _modalEl.style.display = 'flex';
    document.body.style.overflow = 'hidden';
}

function closeModal() {
    if (!_modalEl) return;
    _modalEl.style.display = 'none';
    document.body.style.overflow = '';
    _modalOrderId = null;
}

// ─── Modal content ────────────────────────────────────────────────────
function renderModalContent(row) {
    renderModalItems(row);
    renderModalSeats(row);
    if (row.discounts?.length) renderModalDiscounts(row);
    if (row.voids?.length)     renderModalVoids(row);
    renderModalTotals(row);
    renderModalPayment(row);
    renderModalTimeline(row);
}

function buildModalSection(title) {
    const wrapper = document.createElement('div');
    const lbl = document.createElement('div');
    lbl.style.cssText = `
        font-family: ${T.fb};
        font-size: 10px;
        text-transform: uppercase;
        letter-spacing: 0.22em;
        color: ${T.green};
        font-weight: 500;
        margin-bottom: 8px;
    `;
    lbl.textContent = title;
    const content = document.createElement('div');
    wrapper.appendChild(lbl);
    wrapper.appendChild(content);
    wrapper.content = content;
    return wrapper;
}

function renderModalItems(row) {
    const sec = buildModalSection('Items');
    const items = row.items || [];

    if (items.length === 0) {
        const empty = document.createElement('div');
        empty.style.cssText = `color: ${T.muted}; font-family: ${T.fb}; font-size: 12px;`;
        empty.textContent = 'No items';
        sec.content.appendChild(empty);
        _modalLeftEl.appendChild(sec);
        return;
    }

    const table = document.createElement('table');
    table.style.cssText = 'width: 100%; border-collapse: collapse;';

    const thead = document.createElement('thead');
    const hRow = document.createElement('tr');
    [
        { label: 'Item',  align: 'left'  },
        { label: 'Qty',   align: 'right' },
        { label: 'Each',  align: 'right' },
        { label: 'Total', align: 'right' },
    ].forEach(col => {
        const th = document.createElement('th');
        th.style.cssText = `
            font-family: ${T.fb};
            font-size: 9.5px;
            text-transform: uppercase;
            letter-spacing: 0.2em;
            color: ${T.muted};
            padding: 0 8px 7px;
            border-bottom: 1px solid ${T.border};
            text-align: ${col.align};
        `;
        th.textContent = col.label;
        hRow.appendChild(th);
    });
    thead.appendChild(hRow);
    table.appendChild(thead);

    const tbody = document.createElement('tbody');
    items.forEach(item => {
        const tr = document.createElement('tr');
        tr.style.cssText = `border-bottom: 1px solid rgba(255,255,255,0.06);${item.is_voided ? ' opacity: 0.45;' : ''}`;

        const itemTd = document.createElement('td');
        itemTd.style.cssText = 'padding: 8px 8px 8px 0;';

        if (item.seat_number) {
            const seatColor = _SEAT_PALETTE[(item.seat_number - 1) % _SEAT_PALETTE.length];
            const seatBadge = document.createElement('span');
            seatBadge.style.cssText = `
                display: inline-block;
                font-family: ${T.fb};
                font-size: 10px;
                font-weight: 500;
                padding: 1px 6px;
                border-radius: 999px;
                margin-bottom: 3px;
                background: ${withAlpha(seatColor, 0.15)};
                color: ${seatColor};
            `;
            seatBadge.textContent = 'S' + item.seat_number;
            itemTd.appendChild(seatBadge);
            itemTd.appendChild(document.createElement('br'));
        }

        const nameDiv = document.createElement('div');
        nameDiv.style.cssText = `font-weight: 500; color: ${T.text}; font-size: 12.5px;${item.is_voided ? ' text-decoration: line-through;' : ''}`;
        nameDiv.textContent = item.item_name || item.name || '—';
        itemTd.appendChild(nameDiv);

        if (item.modifiers?.length) {
            const modDiv = document.createElement('div');
            modDiv.style.cssText = `font-family: ${T.fb}; font-size: 11px; color: ${T.muted}; margin-top: 2px; line-height: 1.5;`;
            modDiv.textContent = item.modifiers.join(' · ');
            itemTd.appendChild(modDiv);
        }

        if (item.is_voided) {
            const voidBadge = document.createElement('span');
            voidBadge.style.cssText = `
                display: inline-block;
                font-family: ${T.fb};
                font-size: 10px;
                background: ${withAlpha(T.verm, 0.15)};
                color: ${T.verm};
                padding: 1px 5px;
                border-radius: 3px;
                margin-top: 2px;
                opacity: 1;
            `;
            voidBadge.textContent = 'VOID';
            itemTd.appendChild(voidBadge);
        }

        tr.appendChild(itemTd);

        const qtyTd = document.createElement('td');
        qtyTd.style.cssText = `padding: 8px; text-align: right; color: ${T.muted};`;
        qtyTd.textContent = item.quantity != null ? String(item.quantity) : '—';
        tr.appendChild(qtyTd);

        const eachTd = document.createElement('td');
        eachTd.style.cssText = `padding: 8px; text-align: right; color: ${T.gold};`;
        eachTd.textContent = item.unit_price != null ? fmt(item.unit_price) : '—';
        tr.appendChild(eachTd);

        const totalTd = document.createElement('td');
        totalTd.style.cssText = 'padding: 8px 0 8px 8px; text-align: right;';
        if (item.is_voided) {
            totalTd.style.color = T.verm;
            totalTd.textContent = 'VOID';
        } else {
            totalTd.style.color = T.gold;
            totalTd.textContent = item.subtotal != null ? fmt(item.subtotal) : '—';
        }
        tr.appendChild(totalTd);

        tbody.appendChild(tr);
    });

    table.appendChild(tbody);
    sec.content.appendChild(table);
    _modalLeftEl.appendChild(sec);
}

function renderModalSeats(row) {
    if (!row.seats?.length) return;
    const sec = buildModalSection('By Seat');
    row.seats.forEach((seat, idx) => {
        const rowEl = document.createElement('div');
        const isLast = idx === row.seats.length - 1;
        rowEl.style.cssText = `
            display: flex;
            justify-content: space-between;
            padding: 7px 0;
            font-size: 12.5px;
            ${isLast ? '' : 'border-bottom: 1px solid rgba(255,255,255,0.06);'}
        `;
        const left = document.createElement('div');
        left.style.cssText = 'display: flex; align-items: center; gap: 7px;';
        const dotColor = _SEAT_PALETTE[(seat.seat_number - 1) % _SEAT_PALETTE.length];
        const dot = document.createElement('span');
        dot.style.cssText = `
            width: 8px; height: 8px;
            border-radius: 50%;
            background: ${dotColor};
            flex-shrink: 0;
            display: inline-block;
        `;
        const lbl = document.createElement('span');
        lbl.style.color = T.text;
        lbl.textContent = 'Seat ' + seat.seat_number;
        left.appendChild(dot);
        left.appendChild(lbl);
        const right = document.createElement('span');
        right.style.cssText = `color: ${T.gold}; font-weight: 500;`;
        right.textContent = seat.subtotal != null ? fmt(seat.subtotal) : '—';
        rowEl.appendChild(left);
        rowEl.appendChild(right);
        sec.content.appendChild(rowEl);
    });
    _modalLeftEl.appendChild(sec);
}

function renderModalDiscounts(row) {
    const sec = buildModalSection('Discount Applied');
    row.discounts.forEach(discount => {
        const card = document.createElement('div');
        card.style.cssText = `
            background: ${T.well};
            border-radius: 8px;
            padding: 11px 14px;
            border-left: 3px solid ${T.lavender};
            display: flex;
            flex-direction: column;
            gap: 5px;
        `;
        const titleEl = document.createElement('div');
        titleEl.style.cssText = `color: ${T.lavender}; font-weight: 600; font-size: 12px;`;
        titleEl.textContent = (discount.discount_type || '—') + ' · –' + (discount.amount != null ? fmt(discount.amount) : '—');
        const authEl = document.createElement('div');
        authEl.style.cssText = `color: ${T.muted}; font-family: ${T.fb}; font-size: 11px;`;
        authEl.textContent = 'Auth: ' + (discount.approved_by || '—') + ' · ' + (discount.applied_at ? formatTime(discount.applied_at) : '—');
        card.appendChild(titleEl);
        if (discount.reason) {
            const reasonEl = document.createElement('div');
            reasonEl.style.cssText = `color: ${T.muted}; font-family: ${T.fb}; font-size: 11px;`;
            reasonEl.textContent = discount.reason;
            card.appendChild(reasonEl);
        }
        card.appendChild(authEl);
        sec.content.appendChild(card);
    });
    _modalLeftEl.appendChild(sec);
}

function renderModalVoids(row) {
    const sec = buildModalSection('Void');
    row.voids.forEach(v => {
        const card = document.createElement('div');
        card.style.cssText = `
            background: ${T.well};
            border-radius: 8px;
            padding: 11px 14px;
            border-left: 3px solid ${T.verm};
            display: flex;
            flex-direction: column;
            gap: 5px;
        `;
        const titleEl = document.createElement('div');
        titleEl.style.cssText = `color: ${T.verm}; font-weight: 600; font-size: 12px;`;
        titleEl.textContent = (v.item_name || '—') + ' × ' + (v.quantity || 1) + ' · ' + (v.amount != null ? fmt(v.amount) : '—');
        const authEl = document.createElement('div');
        authEl.style.cssText = `color: ${T.muted}; font-family: ${T.fb}; font-size: 11px;`;
        authEl.textContent = 'Auth: ' + (v.approved_by || '—') + ' · ' + (v.voided_at ? formatTime(v.voided_at) : '—');
        card.appendChild(titleEl);
        if (v.reason) {
            const reasonEl = document.createElement('div');
            reasonEl.style.cssText = `color: ${T.muted}; font-family: ${T.fb}; font-size: 11px;`;
            reasonEl.textContent = v.reason;
            card.appendChild(reasonEl);
        }
        card.appendChild(authEl);
        sec.content.appendChild(card);
    });
    _modalLeftEl.appendChild(sec);
}

function renderModalTotals(row) {
    const sec = buildModalSection('Totals');
    const c = sec.content;
    const discountTotal = row.discount_total || 0;
    const net = (row.subtotal || 0) - discountTotal;

    const mkRow = (label, value, valueColor, labelExtra = '', valueExtra = '') => {
        const el = document.createElement('div');
        el.style.cssText = `
            display: flex;
            justify-content: space-between;
            padding: 6px 0;
            border-bottom: 1px solid rgba(255,255,255,0.06);
            font-size: 12.5px;
        `;
        const lbl = document.createElement('span');
        lbl.style.cssText = `color: ${T.muted}; ${labelExtra}`;
        lbl.textContent = label;
        const val = document.createElement('span');
        val.style.cssText = `color: ${valueColor}; ${valueExtra}`;
        val.textContent = value;
        el.appendChild(lbl);
        el.appendChild(val);
        return el;
    };

    c.appendChild(mkRow('Subtotal', fmt(row.subtotal || 0), T.gold));
    if (discountTotal) {
        c.appendChild(mkRow('Discount', '–' + fmt(discountTotal), T.lavender));
        c.appendChild(mkRow('Net', fmt(net), T.text));
    }
    c.appendChild(mkRow('Tax', fmt(row.tax || 0), T.muted));

    const div1 = document.createElement('div');
    div1.style.cssText = `border-top: 1.5px solid ${T.border}; padding-top: 10px; margin-top: 2px;`;
    const totalRow = mkRow('Total', fmt(row.total || 0), T.gold,
        `color: ${T.text}; font-weight: 600; font-size: 14px;`, 'font-size: 16px; font-weight: 700;');
    totalRow.style.borderBottom = 'none';
    div1.appendChild(totalRow);
    c.appendChild(div1);

    const div2 = document.createElement('div');
    div2.style.cssText = `border-top: 1.5px solid ${T.border}; padding-top: 6px; margin-top: 2px;`;
    div2.appendChild(mkRow('Tip', fmt(row.tip_total || 0), T.green));
    const chargedRow = mkRow('Charged', fmt((row.total || 0) + (row.tip_total || 0)), T.gold,
        `color: ${T.text}; font-weight: 600; font-size: 14px;`, 'font-size: 18px; font-weight: 700;');
    chargedRow.style.borderBottom = 'none';
    div2.appendChild(chargedRow);
    c.appendChild(div2);

    _modalRightEl.appendChild(sec);
}

function renderModalPayment(row) {
    const sec = buildModalSection('Payment');
    const card = document.createElement('div');
    card.style.cssText = `
        background: ${T.well};
        border-radius: 8px;
        border: 1px solid ${T.border};
        padding: 12px 14px;
        display: flex;
        flex-direction: column;
        gap: 6px;
    `;

    const payments = row.payments || (row.payment_method ? [{
        method: row.payment_method,
        amount: row.total,
        card_last_four: row.card_last_four,
    }] : []);

    payments.forEach((payment, idx) => {
        if (idx > 0) {
            const sep = document.createElement('div');
            sep.style.cssText = `border-top: 1px solid ${T.border}; padding-top: 10px; margin-top: 4px;`;
            card.appendChild(sep);
        }
        const pm = (payment.method || payment.payment_method || '').toLowerCase();
        const pmColor = pm === 'cash' ? T.green : pm === 'card' ? T.elec : pm === 'split' ? T.gold : _MOON;

        const row1 = document.createElement('div');
        row1.style.cssText = 'display: flex; align-items: center; gap: 8px;';

        const badge = document.createElement('span');
        badge.style.cssText = `
            background: ${withAlpha(pmColor, 0.1)};
            border: 1px solid ${withAlpha(pmColor, 0.3)};
            color: ${pmColor};
            border-radius: 4px;
            font-family: ${T.fb};
            font-size: 10px;
            text-transform: uppercase;
            padding: 2px 7px;
        `;
        badge.textContent = payment.method || payment.payment_method || '—';
        row1.appendChild(badge);

        if (pm === 'card' && payment.card_last_four) {
            const last4 = document.createElement('span');
            last4.style.cssText = `color: ${T.muted}; font-size: 11px; font-family: ${T.fb}; letter-spacing: 0.15em;`;
            last4.textContent = '·· ·· ·· ' + payment.card_last_four;
            row1.appendChild(last4);
        }

        const amountEl = document.createElement('span');
        amountEl.style.cssText = `color: ${T.gold}; font-weight: 500; margin-left: auto;`;
        amountEl.textContent = payment.amount != null ? fmt(payment.amount) : '—';
        row1.appendChild(amountEl);
        card.appendChild(row1);

        if (pm === 'card') {
            const row2 = document.createElement('div');
            row2.style.cssText = `color: ${T.muted}; font-family: ${T.fb}; font-size: 11px; margin-top: 2px;`;
            row2.textContent = (payment.method || 'Card') + ' · Swiped · Adjusted';
            card.appendChild(row2);
        }

        if (pm === 'cash' && payment.tendered != null) {
            const row3 = document.createElement('div');
            row3.style.cssText = `color: ${T.muted}; font-family: ${T.fb}; font-size: 11px; margin-top: 2px;`;
            row3.textContent = 'Tendered ' + fmt(payment.tendered) + ' · Change: ' + fmt(payment.change || 0);
            card.appendChild(row3);
        }
    });

    sec.content.appendChild(card);
    _modalRightEl.appendChild(sec);
}

function renderModalTimeline(row) {
    const sec = buildModalSection('Timeline');

    const events = [
        row.opened_at         && { label: 'Opened',      ts: row.opened_at,        color: T.text        },
        row.first_item_at     && { label: '1st item',     ts: row.first_item_at,    color: T.text        },
        row.voids?.length     && { label: 'Void',         ts: row.voids.reduce((a, v) => (!a || v.voided_at < a) ? v.voided_at : a, null), color: T.verm },
        row.discounts?.length && { label: 'Discount',     ts: row.discounts.reduce((a, d) => (!a || d.applied_at < a) ? d.applied_at : a, null), color: T.lavender },
        row.tip_adjusted_at   && { label: 'Tip adjusted', ts: row.tip_adjusted_at,  color: T.text        },
        row.closed_at         && { label: 'Closed',       ts: row.closed_at,        color: _GREEN_WARM   },
    ].filter(Boolean).filter(e => e.ts);

    events.sort((a, b) => a.ts < b.ts ? -1 : a.ts > b.ts ? 1 : 0);

    const col = document.createElement('div');
    col.style.cssText = `display: flex; flex-direction: column; gap: 5px; font-family: ${T.fb}; font-size: 11.5px;`;

    if (events.length === 0) {
        col.style.color = T.muted;
        col.textContent = '—';
    } else {
        events.forEach(ev => {
            const evRow = document.createElement('div');
            evRow.style.cssText = 'display: flex; justify-content: space-between;';
            const lbl = document.createElement('span');
            lbl.style.color = T.muted;
            lbl.textContent = ev.label;
            const val = document.createElement('span');
            val.style.color = ev.color;
            val.textContent = formatTime(ev.ts);
            evRow.appendChild(lbl);
            evRow.appendChild(val);
            col.appendChild(evRow);
        });
    }

    sec.content.appendChild(col);
    _modalRightEl.appendChild(sec);
}

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
