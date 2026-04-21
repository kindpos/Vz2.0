// overseer/src/hardware/terminal-card.js
// Collapsed / expanded terminal card with device swimlane.
// Swimlane is built on expand and destroyed on collapse — never just hidden.

import { T, withAlpha } from '../ui/tokens.js';
import { buildPrinterSVG, buildCardReaderSVG, buildTerminalSVG } from './device-silhouettes.js';

// ── Small reusable helpers ──────────────────────────────────────────

function pillLabel(text, color, bgAlpha = 0.12) {
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

function statusDot(online) {
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

function ghostPillBtn(label, eventName, terminalId) {
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
    });
    return btn;
}

// ── Device nodes ────────────────────────────────────────────────────

function buildPrinterNode(printer) {
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

function buildReaderNode(reader) {
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

function buildSwimLane(terminal) {
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
        hubLabel.textContent = terminal.id.toUpperCase();
        hub.appendChild(hubLabel);
        hubWrap.appendChild(hub);
        band.appendChild(hubWrap);

        // Printer nodes row
        const printerRow = document.createElement('div');
        printerRow.style.cssText = 'display: flex; gap: 10px;';
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
        readerRow.style.cssText = 'display: flex; gap: 10px;';
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

// ── Public: buildTerminalCard ────────────────────────────────────────

export function buildTerminalCard(terminal) {
    let expanded = false;
    let collapsing = false;

    const accentColor = terminal.online ? T.green : T.verm;

    const card = document.createElement('div');
    card.style.cssText = `
        background: ${T.card};
        border-radius: 8px;
        border-left: 4px solid ${accentColor};
        overflow: hidden;
        transition: box-shadow 0.15s ease;
    `;
    card.addEventListener('mouseenter', () => { card.style.boxShadow = '0 2px 14px rgba(0,0,0,0.45)'; });
    card.addEventListener('mouseleave', () => { card.style.boxShadow = ''; });

    // ── Collapsed header (72px) ──────────────────────────────────────
    const header = document.createElement('div');
    header.style.cssText = `
        display: flex; align-items: center; gap: 10px;
        padding: 0 14px;
        height: 72px;
        cursor: pointer;
        touch-action: manipulation;
        pointer-events: auto;
        user-select: none;
    `;

    // Pi icon
    const iconWrap = document.createElement('div');
    iconWrap.style.cssText = 'flex-shrink: 0; opacity: 0.85;';
    iconWrap.appendChild(buildTerminalSVG(accentColor, 24));
    header.appendChild(iconWrap);

    // Label + IP / last-seen
    const labelCol = document.createElement('div');
    labelCol.style.cssText = 'flex: 1; min-width: 0;';

    const nameEl = document.createElement('div');
    nameEl.style.cssText = `
        font-family: var(--font-heading);
        font-size: ${T.fs.lg}px;
        font-weight: 700;
        color: ${T.text};
        white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
    `;
    nameEl.textContent = terminal.label;
    labelCol.appendChild(nameEl);

    const subEl = document.createElement('div');
    subEl.style.cssText = `
        font-family: ui-monospace, monospace;
        font-size: ${T.fs.xs}px;
        margin-top: 2px;
    `;
    if (terminal.online) {
        subEl.style.color = T.green;
        subEl.textContent = terminal.ip || '';
    } else {
        subEl.style.color = T.verm;
        subEl.textContent = `Last seen ${terminal.lastSeen || 'Xh'} ago`;
    }
    labelCol.appendChild(subEl);
    header.appendChild(labelCol);

    // Right: status dot + chips + chevron
    const rightEl = document.createElement('div');
    rightEl.style.cssText = 'display: flex; align-items: center; gap: 6px; flex-shrink: 0;';

    rightEl.appendChild(statusDot(terminal.online));

    const pc = terminal.devices?.printers?.length || 0;
    const rc = terminal.devices?.readers?.length || 0;
    if (pc > 0) rightEl.appendChild(pillLabel(`${pc} 🖨`, T.green, 0.14));
    if (rc > 0) rightEl.appendChild(pillLabel(`${rc} 💳`, T.cyan, 0.14));

    const chevron = document.createElement('div');
    chevron.style.cssText = `
        font-size: 12px;
        color: ${T.textMuted};
        margin-left: 4px;
        transition: transform 0.25s ease;
    `;
    chevron.textContent = '▾';
    rightEl.appendChild(chevron);
    header.appendChild(rightEl);

    card.appendChild(header);

    // ── Expandable body ──────────────────────────────────────────────
    const expandBody = document.createElement('div');
    expandBody.style.cssText = `
        max-height: 0;
        overflow: hidden;
        transition: max-height 300ms ease;
    `;
    card.appendChild(expandBody);

    // ── Expand / collapse logic ──────────────────────────────────────

    function expand() {
        if (expanded || collapsing) return;
        expanded = true;
        chevron.style.transform = 'rotate(180deg)';

        const swim = buildSwimLane(terminal);
        expandBody.appendChild(swim);

        // Action row (pinned at bottom)
        const actionRow = document.createElement('div');
        actionRow.style.cssText = `
            display: flex; gap: 8px; padding: 8px 14px 12px;
            border-top: 1px solid ${T.border};
        `;
        actionRow.appendChild(ghostPillBtn('TEST ALL', 'kindpos:testAll', terminal.id));
        actionRow.appendChild(ghostPillBtn('+ ADD DEVICE', 'kindpos:addDevice', terminal.id));
        actionRow.appendChild(ghostPillBtn('SETTINGS', 'kindpos:terminalSettings', terminal.id));
        expandBody.appendChild(actionRow);

        requestAnimationFrame(() => {
            expandBody.style.maxHeight = expandBody.scrollHeight + 'px';
        });
    }

    function collapse() {
        if (!expanded) return;
        expanded = false;
        collapsing = true;
        chevron.style.transform = '';
        expandBody.style.maxHeight = '0';
        expandBody.addEventListener('transitionend', () => {
            collapsing = false;
            if (!expanded) {
                expandBody.innerHTML = '';
            }
        }, { once: true });
    }

    header.addEventListener('click', () => {
        if (expanded) collapse();
        else expand();
    });

    return { card, expand, collapse };
}
