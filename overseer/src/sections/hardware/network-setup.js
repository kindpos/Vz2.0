// overseer/src/sections/hardware/network-setup.js
// Network Topology page — replaces Printer Setup, Printer Config, Card Readers.
// Gateway row pinned sticky inside scrollable 2-column terminal grid.

import { T, withAlpha } from '../../ui/tokens.js';
import { buildRouterSVG } from '../../hardware/device-silhouettes.js';
import { buildTerminalCard } from '../../hardware/terminal-card.js';
import { buildAddDeviceOverlay } from '../../hardware/add-device-overlay.js';

// ── Seed data ────────────────────────────────────────────────────────
// TODO: replace with GET /api/v1/hardware/terminals when endpoint is live

const SEED_TERMINALS = [
    {
        id: 't1',
        label: 'Terminal 1',
        ip: '10.0.0.100',
        slot: '#1.5',
        online: true,
        devices: {
            printers: [
                { label: 'KITCHEN', type: 'kitchen', model: 'Epson TM-U220', ip: '10.0.0.15', port: 9100, variant: 'impact' },
                { label: 'RECEIPT',  type: 'receipt', model: 'Epson TM-T88',  ip: '10.0.0.186', port: 9100, variant: 'thermal' },
            ],
            readers: [
                { model: 'Dejavoo P8', status: 'SPIn · Paired' },
            ],
        },
    },
    {
        id: 't2',
        label: 'Terminal 2',
        ip: '10.0.0.101',
        slot: '#1.5',
        online: true,
        devices: {
            printers: [
                { label: 'KITCHEN', type: 'kitchen', variant: 'impact' },
                { label: 'RECEIPT',  type: 'receipt', variant: 'thermal' },
            ],
            readers: [
                { model: 'Dejavoo P8', status: 'SPIn · Paired' },
            ],
        },
    },
    {
        id: 't3',
        label: 'Terminal 3',
        ip: '10.0.0.102',
        slot: '#1.5',
        online: false,
        lastSeen: '2h',
        devices: { printers: [], readers: [] },
    },
];

// ── Gateway row ───────────────────────────────────────────────────────

function buildGatewayRow(terminals) {
    const row = document.createElement('div');
    row.style.cssText = `
        display: flex; align-items: center; gap: 14px;
        background: ${T.card};
        border-left: 4px solid ${T.border};
        border-radius: 8px;
        padding: 0 16px;
        height: 62px;
        position: sticky;
        top: 0;
        z-index: 19;
        grid-column: 1 / -1;
    `;

    // Router icon
    const iconWrap = document.createElement('div');
    iconWrap.style.cssText = 'flex-shrink: 0; opacity: 0.75;';
    iconWrap.appendChild(buildRouterSVG(T.green, 32));
    row.appendChild(iconWrap);

    // Label + IP block
    const infoCol = document.createElement('div');
    infoCol.style.cssText = 'flex: 1; min-width: 0;';

    const routerLabel = document.createElement('div');
    routerLabel.style.cssText = `
        font-family: var(--font-heading);
        font-size: ${T.fs.xs}px;
        font-weight: 700;
        letter-spacing: 2px;
        text-transform: uppercase;
        color: ${T.textMuted};
    `;
    routerLabel.textContent = 'GATEWAY / ROUTER';

    const ipEl = document.createElement('div');
    ipEl.style.cssText = `
        font-family: ui-monospace, monospace;
        font-size: ${T.fs.xl}px;
        font-weight: 700;
        color: ${T.text};
        line-height: 1.1;
    `;
    ipEl.textContent = '10.0.0.1';

    const subnetEl = document.createElement('div');
    subnetEl.style.cssText = `
        font-family: ui-monospace, monospace;
        font-size: ${T.fs.xs}px;
        color: ${T.textDim};
        margin-top: 1px;
    `;
    subnetEl.textContent = 'LOCAL GATEWAY — 192.168.1/24';

    infoCol.appendChild(routerLabel);
    infoCol.appendChild(ipEl);
    infoCol.appendChild(subnetEl);
    row.appendChild(infoCol);

    // Right side chips
    const chipsEl = document.createElement('div');
    chipsEl.style.cssText = 'display: flex; align-items: center; gap: 8px; flex-shrink: 0;';

    const onlineCount = terminals.filter(t => t.online).length;
    const deviceCount = terminals.reduce((n, t) => {
        return n + (t.devices?.printers?.length || 0) + (t.devices?.readers?.length || 0);
    }, 0);

    function chip(label, value, color) {
        const el = document.createElement('div');
        el.style.cssText = `
            display: flex; flex-direction: column; align-items: center;
            padding: 4px 12px;
            background: ${withAlpha(color, 0.1)};
            border-radius: 6px;
            border: 1px solid ${withAlpha(color, 0.25)};
        `;
        const valEl = document.createElement('div');
        valEl.style.cssText = `
            font-family: var(--font-heading); font-size: ${T.fs.xl}px;
            font-weight: 700; color: ${color};
        `;
        valEl.textContent = value;
        const lbl = document.createElement('div');
        lbl.style.cssText = `
            font-family: var(--font-heading); font-size: ${T.fs.xs}px;
            font-weight: 700; letter-spacing: 1.5px;
            color: ${color}; opacity: 0.7;
            text-transform: uppercase;
        `;
        lbl.textContent = label;
        el.appendChild(valEl);
        el.appendChild(lbl);
        return el;
    }

    chipsEl.appendChild(chip('TERMINALS', onlineCount, T.text));
    chipsEl.appendChild(chip('DEVICES', deviceCount, T.gold));

    // PINNED badge
    const pinned = document.createElement('div');
    pinned.style.cssText = `
        padding: 3px 8px;
        border-radius: 4px;
        background: ${withAlpha(T.gold, 0.12)};
        border: 1px solid ${withAlpha(T.gold, 0.25)};
        color: ${T.gold};
        font-family: var(--font-heading);
        font-size: ${T.fs.xs}px;
        font-weight: 700;
        letter-spacing: 1.5px;
        text-transform: uppercase;
    `;
    pinned.textContent = 'PINNED';
    chipsEl.appendChild(pinned);

    row.appendChild(chipsEl);
    return row;
}

// ── Ghost "Add Terminal" card ─────────────────────────────────────────

function buildGhostCard() {
    const card = document.createElement('div');
    card.style.cssText = `
        height: 72px;
        border-radius: 8px;
        border: 1.5px dashed ${T.border};
        background: transparent;
        display: flex; flex-direction: column; align-items: center; justify-content: center;
        gap: 4px;
        cursor: default;
    `;

    const label = document.createElement('div');
    label.style.cssText = `
        font-family: var(--font-heading);
        font-size: ${T.fs.md}px;
        font-weight: 700;
        letter-spacing: 1.5px;
        color: ${T.border};
        text-transform: uppercase;
    `;
    label.textContent = '+ ADD TERMINAL';
    card.appendChild(label);

    const sub = document.createElement('div');
    sub.style.cssText = `
        font-family: var(--font-body);
        font-size: ${T.fs.xs}px;
        color: ${T.textDim};
    `;
    sub.textContent = 'Pair a new Pi terminal to this network';
    card.appendChild(sub);

    return card;
}

// ── Mount / cleanup ───────────────────────────────────────────────────

let _cleanupListener = null;

export function buildNetworkSetupScene(container) {
    container.innerHTML = '';
    container.style.cssText = `
        height: 100%;
        display: flex;
        flex-direction: column;
        overflow: hidden;
        background: ${T.bg};
        color: ${T.text};
        font-family: var(--font-body);
    `;

    // ── Page header ──────────────────────────────────────────────────
    const pageHeader = document.createElement('div');
    pageHeader.style.cssText = `
        display: flex;
        align-items: flex-start;
        justify-content: space-between;
        padding: 20px 20px 14px;
        background: ${T.bg};
        border-bottom: 1px solid ${T.border};
        flex-shrink: 0;
        gap: 16px;
    `;

    const titleCol = document.createElement('div');

    const titleEl = document.createElement('div');
    titleEl.style.cssText = `
        font-family: var(--font-heading);
        font-size: ${T.fs.hero}px;
        font-weight: 700;
        color: ${T.text};
        letter-spacing: 0.5px;
        line-height: 1.1;
    `;
    titleEl.textContent = 'Network Topology';

    const subtitleEl = document.createElement('div');
    subtitleEl.style.cssText = `
        font-family: ui-monospace, monospace;
        font-size: ${T.fs.sm}px;
        letter-spacing: 2.5px;
        color: ${T.textMuted};
        margin-top: 6px;
        text-transform: uppercase;
    `;
    subtitleEl.textContent = 'ALL TERMINALS — HARDWARE OVERVIEW';

    titleCol.appendChild(titleEl);
    titleCol.appendChild(subtitleEl);
    pageHeader.appendChild(titleCol);

    // + ADD DEVICE(S) button
    const addBtn = document.createElement('button');
    addBtn.type = 'button';
    addBtn.textContent = '+ ADD DEVICE(S)';
    addBtn.style.cssText = `
        background: ${T.gold};
        color: #1a1000;
        border: none;
        border-radius: 999px;
        padding: 10px 20px;
        font-family: var(--font-heading);
        font-size: ${T.fs.md}px;
        font-weight: 700;
        letter-spacing: 1.2px;
        text-transform: uppercase;
        cursor: pointer;
        white-space: nowrap;
        flex-shrink: 0;
        touch-action: manipulation;
        transition: transform 0.1s ease, opacity 0.15s ease;
    `;
    addBtn.addEventListener('mouseenter', () => { addBtn.style.transform = 'translateY(-1px)'; });
    addBtn.addEventListener('mouseleave', () => { addBtn.style.transform = ''; });
    addBtn.addEventListener('click', () => {
        buildAddDeviceOverlay({ terminals: SEED_TERMINALS });
    });
    pageHeader.appendChild(addBtn);
    container.appendChild(pageHeader);

    // ── Scroll wrapper (contains grid + fade overlay) ────────────────
    const scrollWrapper = document.createElement('div');
    scrollWrapper.style.cssText = `
        flex: 1;
        position: relative;
        overflow: hidden;
    `;
    container.appendChild(scrollWrapper);

    // ── Scrollable 2-column grid ─────────────────────────────────────
    const scrollGrid = document.createElement('div');
    scrollGrid.style.cssText = `
        height: 100%;
        overflow-y: auto;
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 12px;
        padding: 12px;
        align-content: start;
    `;
    scrollWrapper.appendChild(scrollGrid);

    // ── Fade gradient (bottom of scroll area) ────────────────────────
    const fade = document.createElement('div');
    fade.style.cssText = `
        position: absolute;
        bottom: 0;
        left: 0;
        right: 0;
        height: 64px;
        background: linear-gradient(to bottom, transparent, ${T.bg});
        pointer-events: none;
        z-index: 5;
    `;
    scrollWrapper.appendChild(fade);

    // ── Gateway row (sticky at top of grid) ──────────────────────────
    scrollGrid.appendChild(buildGatewayRow(SEED_TERMINALS));

    // ── Terminal cards ────────────────────────────────────────────────
    SEED_TERMINALS.forEach((terminal, idx) => {
        const { card, expand } = buildTerminalCard(terminal);
        scrollGrid.appendChild(card);
        if (idx === 0) {
            requestAnimationFrame(() => expand());
        }
    });

    // ── Ghost add-terminal card ───────────────────────────────────────
    scrollGrid.appendChild(buildGhostCard());

    // ── Listen for device-added events to refresh ─────────────────────
    _cleanupListener = () => {};
    const onDevicesAdded = () => {
        buildNetworkSetupScene(container);
    };
    window.addEventListener('kindpos:devicesAdded', onDevicesAdded);
    _cleanupListener = () => window.removeEventListener('kindpos:devicesAdded', onDevicesAdded);
}

export function cleanupNetworkSetup(container) {
    if (_cleanupListener) {
        _cleanupListener();
        _cleanupListener = null;
    }
    container.innerHTML = '';
}
