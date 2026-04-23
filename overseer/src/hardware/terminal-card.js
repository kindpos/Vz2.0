// overseer/src/hardware/terminal-card.js
// Collapsed / expanded terminal card with device swimlane.
// Swimlane is built on expand and destroyed on collapse — never just hidden.

import { T, withAlpha } from '../ui/tokens.js';
import { buildTerminalSVG } from './device-silhouettes.js';
import { SceneManager } from '../components/scene-manager.js';

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

// ── Public: buildTerminalCard ────────────────────────────────────────

export function buildTerminalCard(terminal) {
    const accentColor = terminal.online ? T.green : T.verm;

    const card = document.createElement('div');
    card.style.cssText = `
        background: ${T.card};
        border-radius: 8px;
        border-left: 4px solid ${accentColor};
        overflow: hidden;
        transition: box-shadow 0.15s ease, background 0.15s ease;
    `;
    card.addEventListener('mouseenter', () => {
        card.style.boxShadow = '0 2px 14px rgba(0,0,0,0.45)';
        card.style.background = withAlpha(T.text, 0.03);
    });
    card.addEventListener('mouseleave', () => {
        card.style.boxShadow = '';
        card.style.background = T.card;
    });

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
        font-size: 16px;
        color: ${T.textMuted};
        margin-left: 4px;
        opacity: 0.5;
    `;
    chevron.textContent = '›';
    rightEl.appendChild(chevron);
    header.appendChild(rightEl);

    card.appendChild(header);

    header.addEventListener('click', () => {
        SceneManager.openTransactional('terminal-details', { terminal });
    });

    return { card };
}
