// overseer/src/sections/hardware/terminal-details.js
// Detail view for a terminal, shown in a transactional overlay.

import { T, withAlpha } from '../../ui/tokens.js';
import { buildPrinterSVG, buildCardReaderSVG, buildTerminalSVG } from '../../hardware/device-silhouettes.js';
import { SceneManager } from '../../components/scene-manager.js';

// ── Small reusable helpers ──────────────────────────────────────────

const pillLabel = (text, color, bgAlpha = 0.12) => {
    const el = document.createElement('div');
    el.style.cssText = `
        display: inline-flex; align-items: center;
        padding: 2px 8px; border-radius: 999px;
        background: ${withAlpha(color, bgAlpha)};
        color: ${color};
        font-size: ${T.fs.xs}px;
        font-family: var(--font-heading);
        font-weight: 700;
        letter-spacing: 1px;
        text-transform: uppercase;
        white-space: nowrap;
        flex-shrink: 0;
    `;
    el.textContent = text;
    return el;
}

const statusDot = (online) => {
    const el = document.createElement('div');
    const color = online ? T.green : T.verm;
    el.style.cssText = `
        width: 8px; height: 8px; border-radius: 50%;
        background: ${color};
        flex-shrink: 0;
        box-shadow: 0 0 5px ${color}88;
    `;
    return el;
}

const ghostPillBtn = (label, eventName, terminalId) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = label;
    btn.style.cssText = `
        background: transparent;
        color: ${T.textMuted};
        border: 1px solid ${T.border};
        border-radius: 999px;
        padding: 5px 14px;
        font-family: var(--font-heading);
        font-size: ${T.fs.xs}px;
        font-weight: 700;
        letter-spacing: 1px;
        text-transform: uppercase;
        cursor: pointer;
        touch-action: manipulation;
        transition: color 0.12s ease, border-color 0.12s ease;
    `;
    btn.addEventListener('mouseenter', () => { btn.style.color = T.text; btn.style.borderColor = T.textMuted; });
    btn.addEventListener('mouseleave', () => { btn.style.color = T.textMuted; btn.style.borderColor = T.border; });
    btn.addEventListener('click', e => {
        e.stopPropagation();
        btn.dispatchEvent(new CustomEvent(eventName, { bubbles: true, detail: { terminalId } }));
        // Also close the overlay when an action is taken?
        // SceneManager.closeTransactional('terminal-details');
    });
    return btn;
}

// ── Device nodes ────────────────────────────────────────────────────

const buildPrinterNode = (printer) => {
    const node = document.createElement('div');
    node.style.cssText = `
        display: flex; flex-direction: column; align-items: center; gap: 4px;
        padding: 8px 10px;
        background: ${T.well};
        border: 1px solid ${T.green};
        border-radius: 6px;
        min-width: 88px;
        position: relative;
        flex: 1;
    `;

    const dot = statusDot(printer.online !== false);
    dot.style.position = 'absolute';
    dot.style.top = '5px';
    dot.style.right = '5px';
    node.appendChild(dot);

    node.appendChild(buildPrinterSVG(T.green, 28, printer.variant || 'thermal'));

    const typeEl = document.createElement('div');
    typeEl.style.cssText = `font-size: ${T.fs.xs}px; color: ${T.green}; font-family: var(--font-heading); font-weight: 700; text-transform: uppercase;`;
    typeEl.textContent = printer.label || printer.type || 'PRINTER';
    node.appendChild(typeEl);

    if (printer.model) {
        const modelEl = document.createElement('div');
        modelEl.style.cssText = `font-size: ${T.fs.xs}px; color: ${T.textMuted}; font-family: ui-monospace, monospace; text-align: center;`;
        modelEl.textContent = printer.model;
        node.appendChild(modelEl);
    }
    if (printer.ip) {
        const ipEl = document.createElement('div');
        ipEl.style.cssText = `font-size: ${T.fs.xs}px; color: ${T.textDim}; font-family: ui-monospace, monospace;`;
        ipEl.textContent = `${printer.ip}:${printer.port || 9100}`;
        node.appendChild(ipEl);
    }
    return node;
}

const buildReaderNode = (reader) => {
    const node = document.createElement('div');
    node.style.cssText = `
        display: flex; flex-direction: column; align-items: center; gap: 4px;
        padding: 8px 10px;
        background: ${T.well};
        border: 1px solid ${T.cyan};
        border-radius: 6px;
        min-width: 88px;
        position: relative;
        flex: 1;
    `;

    const dot = statusDot(reader.online !== false);
    dot.style.position = 'absolute';
    dot.style.top = '5px';
    dot.style.right = '5px';
    node.appendChild(dot);

    node.appendChild(buildCardReaderSVG(T.cyan, 28));

    const modelEl = document.createElement('div');
    modelEl.style.cssText = `font-size: ${T.fs.xs}px; color: ${T.cyan}; font-family: var(--font-heading); font-weight: 700; text-transform: uppercase;`;
    modelEl.textContent = reader.model || 'CARD READER';
    node.appendChild(modelEl);

    if (reader.status) {
        const statusEl = document.createElement('div');
        statusEl.style.cssText = `font-size: ${T.fs.xs}px; color: ${T.textMuted}; font-family: ui-monospace, monospace;`;
        statusEl.textContent = reader.status;
        node.appendChild(statusEl);
    }
    return node;
}

// ── Swimlane (PRINT DEVICES + PAYMENT bands) ────────────────────────

const buildSwimLane = (terminal) => {
    const swim = document.createElement('div');
    swim.style.cssText = `padding: 0 12px 12px; display: flex; flex-direction: column; gap: 8px;`;

    const printers = terminal.devices?.printers || [];
    const readers = terminal.devices?.readers || [];

    // PRINT DEVICES band
    if (printers.length > 0) {
        const band = document.createElement('div');
        band.style.cssText = `
            background: ${withAlpha(T.green, 0.05)};
            border-radius: 8px;
            padding: 10px 12px;
        `;

        const chipRow = document.createElement('div');
        chipRow.style.cssText = 'margin-bottom: 10px;';
        chipRow.appendChild(pillLabel('PRINT DEVICES', T.green, 0.12));
        band.appendChild(chipRow);

        // Terminal hub node (centered)
        const hubWrap = document.createElement('div');
        hubWrap.style.cssText = 'display: flex; justify-content: center; margin-bottom: 8px;';
        const hub = document.createElement('div');
        hub.style.cssText = `
            display: flex; flex-direction: column; align-items: center; gap: 3px;
            padding: 5px 10px;
            background: ${T.card};
            border: 1px solid ${T.green};
            border-radius: 6px;
        `;
        hub.appendChild(buildTerminalSVG(T.green, 20));
        const hubLabel = document.createElement('div');
        hubLabel.style.cssText = `font-size: ${T.fs.xs}px; color: ${T.green}; font-family: var(--font-heading); font-weight: 700;`;
        hubLabel.textContent = (terminal.id || '').toUpperCase();
        hub.appendChild(hubLabel);
        hubWrap.appendChild(hub);
        band.appendChild(hubWrap);

        // Printer nodes row
        const printerRow = document.createElement('div');
        printerRow.style.cssText = 'display: flex; gap: 10px; flex-wrap: wrap;';
        printers.forEach(p => printerRow.appendChild(buildPrinterNode(p)));
        band.appendChild(printerRow);

        swim.appendChild(band);
    }

    // PAYMENT band
    if (readers.length > 0) {
        const band = document.createElement('div');
        band.style.cssText = `
            background: ${withAlpha(T.cyan, 0.05)};
            border-radius: 8px;
            padding: 10px 12px;
        `;

        const chipRow = document.createElement('div');
        chipRow.style.cssText = 'margin-bottom: 10px;';
        chipRow.appendChild(pillLabel('PAYMENT', T.cyan, 0.12));
        band.appendChild(chipRow);

        const readerRow = document.createElement('div');
        readerRow.style.cssText = 'display: flex; gap: 10px; flex-wrap: wrap;';
        readers.forEach(r => readerRow.appendChild(buildReaderNode(r)));
        band.appendChild(readerRow);

        swim.appendChild(band);
    }

    // Device summary footer
    const summary = document.createElement('div');
    summary.style.cssText = `
        font-size: ${T.fs.xs}px;
        color: ${T.textDim};
        font-family: ui-monospace, monospace;
        padding: 4px 2px;
    `;
    const pc = printers.length, rc = readers.length;
    summary.textContent = `${pc} print${pc !== 1 ? 's' : ''} · ${rc} payment${rc !== 1 ? 's' : ''} · ${pc + rc} total`;
    swim.appendChild(summary);

    return swim;
}

export function buildTerminalDetailsScene(container, params) {
    const terminal = params.terminal;
    if (!terminal) return;

    container.style.cssText = `
        display: flex;
        flex-direction: column;
        height: 100%;
        background: ${T.bg};
        color: ${T.text};
    `;

    // Header
    const header = document.createElement('div');
    header.style.cssText = `
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 16px 20px;
        border-bottom: 1px solid ${T.border};
    `;

    const titleWrap = document.createElement('div');
    const title = document.createElement('div');
    title.style.cssText = `font-family: var(--font-heading); font-size: ${T.fs.xl}px; font-weight: 700;`;
    title.textContent = terminal.label;
    titleWrap.appendChild(title);

    const sub = document.createElement('div');
    sub.style.cssText = `font-family: ui-monospace, monospace; font-size: ${T.fs.xs}px; color: ${T.textMuted};`;
    sub.textContent = terminal.ip || (terminal.online ? 'Online' : 'Offline');
    titleWrap.appendChild(sub);
    header.appendChild(titleWrap);

    const closeBtn = document.createElement('button');
    closeBtn.textContent = '✕';
    closeBtn.style.cssText = `
        background: transparent; border: none; color: ${T.textMuted};
        font-size: 20px; cursor: pointer; padding: 4px 8px;
    `;
    closeBtn.onclick = () => SceneManager.closeTransactional('terminal-details');
    header.appendChild(closeBtn);
    container.appendChild(header);

    // Scrollable content
    const content = document.createElement('div');
    content.style.cssText = `flex: 1; overflow-y: auto; padding: 20px;`;
    content.appendChild(buildSwimLane(terminal));
    container.appendChild(content);

    // Footer actions
    const footer = document.createElement('div');
    footer.style.cssText = `
        display: flex; gap: 12px; padding: 16px 20px;
        border-top: 1px solid ${T.border};
        background: ${T.card};
    `;
    footer.appendChild(ghostPillBtn('TEST ALL', 'kindpos:testAll', terminal.id));
    footer.appendChild(ghostPillBtn('+ ADD DEVICE', 'kindpos:addDevice', terminal.id));
    footer.appendChild(ghostPillBtn('SETTINGS', 'kindpos:terminalSettings', terminal.id));
    container.appendChild(footer);

    return function cleanup() {};
}

export function cleanupTerminalDetailsScene() {}
