/* ============================================
   KINDpos Overseer — Hardware Management
   Terminals, Printers, Card Readers Configuration

   Three tabs: TERMINALS | PRINTERS | CARD READERS
   Hub concept: single designated hub terminal with atomic swap

   "Nice. Dependable. Yours."
   ============================================ */

import { pushChanges } from '../services/config-push.js';
import { fetchWithTimeout } from '../services/http.js';
import { T, withAlpha } from '../ui/tokens.js';
import {
    buildScenePage, sectionCard, button, field,
    numberField, row, openModal, showToast, buildPillButton, buildGhostButton,
} from '../ui/forms.js';
import { hexToRgba, buildStaticCard } from '../../../common/theme.js';

/* ─── STATE ───────────────────────────────────────────────────── */
let _state = {
    terminals: [],
    printers: [],
    cardReaders: [],
    activeTab: 'terminals',
    editingTerminalId: null,
    editingPrinterId: null,
    editingReaderId: null,
    container: null,
    lastSyncTime: null,
};

const resetState = () => {
    _state = {
        terminals: [],
        printers: [],
        cardReaders: [],
        activeTab: 'terminals',
        editingTerminalId: null,
        editingPrinterId: null,
        editingReaderId: null,
        container: null,
        lastSyncTime: null,
    };
};

/* ─── FETCH HELPERS ───────────────────────────────────────────── */
const loadData = async () => {
    try {
        const devicesResp = await fetchWithTimeout('/api/v1/hardware/devices');
        if (!devicesResp.ok) throw new Error(`Devices fetch failed: ${devicesResp.status}`);
        const devices = await devicesResp.json();

        const configResp = await fetchWithTimeout('/api/v1/config/terminals');
        if (!configResp.ok) throw new Error(`Terminals config fetch failed: ${configResp.status}`);
        const terminals = await configResp.json();

        _state.terminals = Array.isArray(terminals) ? terminals : [];
        _state.printers = devices.filter(d => d.type === 'printer' || d.type === 'kitchen' || d.type === 'receipt') || [];
        _state.cardReaders = devices.filter(d => d.type === 'card_reader') || [];
        _state.lastSyncTime = new Date().toLocaleTimeString();
    } catch (e) {
        showToast(`Failed to load hardware data: ${e.message}`, 'error');
        console.error('[Hardware] Load error:', e);
    }
};

const getHubTerminal = () => _state.terminals.find(t => t.is_hub);

/* ─── IP VALIDATION ───────────────────────────────────────────── */
const isValidIP = (ip) => {
    const parts = ip.split('.');
    if (parts.length !== 4) return false;
    return parts.every(p => {
        const num = parseInt(p, 10);
        return !isNaN(num) && num >= 0 && num <= 255;
    });
};

const isValidPort = (port) => {
    const num = parseInt(port, 10);
    return !isNaN(num) && num >= 0 && num <= 65535;
};

/* ─── SYNC STATUS BAR ───────────────────────────────────────────── */
const buildSyncStatusBar = () => {
    const bar = document.createElement('div');
    bar.style.cssText = `
        display: flex;
        gap: 16px;
        align-items: center;
        padding: 12px 16px;
        background: ${T.well};
        border-bottom: 1px solid ${T.border};
        font-family: 'Share Tech Mono', monospace;
        font-size: 11px;
        color: ${T.textMuted};
    `;

    const hub = getHubTerminal();
    const hubStatus = hub
        ? `🟢 HUB ONLINE — ${hub.name || 'Hub'} (${hub.ip_address || 'unknown'})`
        : `⚪ NO HUB CONFIGURED`;

    bar.innerHTML = `
        <div>${hubStatus}</div>
        <div>•</div>
        <div>${_state.terminals.length} terminals</div>
        <div>•</div>
        <div>Sync: ${_state.lastSyncTime || 'never'}</div>
    `;

    return bar;
};

/* ─── TERMINALS TAB ───────────────────────────────────────────── */
const buildTerminalCard = (term) => {
    const isHub = term.is_hub === true;

    const card = document.createElement('div');
    card.style.cssText = `
        border: 2px solid ${isHub ? T.green : T.border};
        border-radius: 8px;
        padding: 16px;
        background: ${isHub ? withAlpha(T.green, 0.08) : T.card};
        display: flex;
        flex-direction: column;
        gap: 12px;
    `;

    const header = document.createElement('div');
    header.style.cssText = `
        display: flex;
        justify-content: space-between;
        align-items: center;
    `;

    const title = document.createElement('div');
    title.style.cssText = `
        font-family: 'Orbitron', sans-serif;
        font-size: 14px;
        font-weight: bold;
        color: ${T.text};
    `;
    title.textContent = term.name || 'Terminal';

    if (isHub) {
        const hubBadge = document.createElement('span');
        hubBadge.style.cssText = `
            background: ${T.green};
            color: ${T.bg};
            padding: 2px 8px;
            border-radius: 3px;
            font-size: 9px;
            font-weight: bold;
        `;
        hubBadge.textContent = 'HUB';
        header.appendChild(hubBadge);
    }

    header.appendChild(title);
    card.appendChild(header);

    const info = document.createElement('div');
    info.style.cssText = `
        font-size: 11px;
        color: ${T.textMuted};
        font-family: 'Share Tech Mono', monospace;
        display: grid;
        gap: 4px;
    `;
    info.innerHTML = `
        <div>Role: ${term.role || 'unknown'}</div>
        <div>Training: ${term.training_mode ? 'YES' : 'NO'}</div>
    `;
    card.appendChild(info);

    const actions = document.createElement('div');
    actions.style.cssText = `
        display: flex;
        gap: 8px;
        padding-top: 8px;
        border-top: 1px solid ${T.border};
    `;

    const editBtn = buildGhostButton('EDIT', T.text, async () => {
        _state.editingTerminalId = term.terminal_id;
        rebuild();
    });

    if (isHub) {
        const reassignBtn = buildGhostButton('REASSIGN HUB', T.verm, async () => {
            const confirmed = confirm(`Remove hub status from ${term.name}? You must designate another hub.`);
            if (confirmed) {
                await pushChanges([{
                    event_type: 'terminal.updated',
                    payload: { terminal_id: term.terminal_id, is_hub: false }
                }]);
                await loadData();
                rebuild();
                showToast('Hub reassigned');
            }
        });
        actions.appendChild(reassignBtn);
    } else {
        const promoteBtn = buildGhostButton('MAKE HUB', T.greenUp, async () => {
            const confirmed = confirm(`Designate ${term.name} as the hub terminal?`);
            if (confirmed) {
                await pushChanges([{
                    event_type: 'terminal.updated',
                    payload: { terminal_id: term.terminal_id, is_hub: true }
                }]);
                await loadData();
                rebuild();
                showToast('Hub designated');
            }
        });
        actions.appendChild(promoteBtn);
    }

    actions.appendChild(editBtn);
    card.appendChild(actions);

    return card;
};

const buildTerminalEditPanel = (term) => {
    const panel = document.createElement('div');
    panel.style.cssText = `
        background: ${T.well};
        border: 1px solid ${T.border};
        border-radius: 8px;
        padding: 16px;
        margin-bottom: 16px;
        display: flex;
        flex-direction: column;
        gap: 12px;
    `;

    const nameInput = document.createElement('input');
    nameInput.type = 'text';
    nameInput.placeholder = 'Terminal Name';
    nameInput.value = term.name || '';
    nameInput.style.cssText = `
        background: ${T.card};
        border: 1px solid ${T.border};
        color: ${T.text};
        padding: 8px;
        border-radius: 4px;
    `;

    const roleInput = document.createElement('input');
    roleInput.type = 'text';
    roleInput.placeholder = 'Role (e.g., server, kitchen)';
    roleInput.value = term.role || '';
    roleInput.style.cssText = nameInput.style.cssText;

    const trainingChk = document.createElement('input');
    trainingChk.type = 'checkbox';
    trainingChk.checked = term.training_mode || false;
    trainingChk.style.cssText = `margin-right: 8px;`;
    const trainingLabel = document.createElement('label');
    trainingLabel.style.cssText = `display: flex; align-items: center; gap: 8px;`;
    trainingLabel.appendChild(trainingChk);
    trainingLabel.appendChild(document.createTextNode('Training Mode'));

    const btnRow = document.createElement('div');
    btnRow.style.cssText = `display: flex; gap: 8px; justify-content: flex-end;`;

    const cancelBtn = buildGhostButton('Cancel', T.textMuted, () => {
        _state.editingTerminalId = null;
        rebuild();
    });

    const saveBtn = buildPillButton('Save', T.green, T.bg, async () => {
        const newName = nameInput.value.trim();
        const newRole = roleInput.value.trim();
        if (!newName || !newRole) {
            showToast('Name and role are required', 'error');
            return;
        }

        try {
            await pushChanges([{
                event_type: 'terminal.updated',
                payload: {
                    terminal_id: term.terminal_id,
                    name: newName,
                    role: newRole,
                    training_mode: trainingChk.checked,
                }
            }]);
            _state.editingTerminalId = null;
            await loadData();
            rebuild();
            showToast('Terminal updated');
        } catch (e) {
            showToast(`Failed to update terminal: ${e.message}`, 'error');
        }
    });

    btnRow.appendChild(cancelBtn);
    btnRow.appendChild(saveBtn);

    panel.appendChild(nameInput);
    panel.appendChild(roleInput);
    panel.appendChild(trainingLabel);
    panel.appendChild(btnRow);

    return panel;
};

const buildTerminalsTab = () => {
    const container = document.createElement('div');
    container.style.cssText = `
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
        gap: 16px;
    `;

    if (_state.editingTerminalId) {
        const term = _state.terminals.find(t => t.terminal_id === _state.editingTerminalId);
        if (term) {
            container.appendChild(buildTerminalEditPanel(term));
        }
    }

    const hub = getHubTerminal();
    if (hub) {
        const hubCard = buildTerminalCard(hub);
        container.appendChild(hubCard);
    }

    const satellites = _state.terminals.filter(t => !t.is_hub);
    satellites.forEach(sat => {
        container.appendChild(buildTerminalCard(sat));
    });

    return container;
};

/* ─── PRINTERS TAB ───────────────────────────────────────────── */
const buildPrinterCard = (printer) => {
    const card = document.createElement('div');
    card.style.cssText = `
        border: 1px solid ${T.border};
        border-radius: 8px;
        padding: 16px;
        background: ${T.card};
        display: flex;
        flex-direction: column;
        gap: 12px;
    `;

    const header = document.createElement('div');
    header.style.cssText = `
        display: flex;
        justify-content: space-between;
        align-items: center;
        gap: 8px;
    `;

    const name = document.createElement('div');
    name.style.cssText = `
        font-family: 'Orbitron', sans-serif;
        font-size: 13px;
        font-weight: bold;
        color: ${T.text};
        flex: 1;
    `;
    name.textContent = printer.name || 'Printer';
    header.appendChild(name);

    if (printer.type === 'kitchen') {
        const badge = document.createElement('span');
        badge.style.cssText = `
            background: ${T.verm};
            color: white;
            padding: 2px 6px;
            border-radius: 3px;
            font-size: 8px;
            font-weight: bold;
        `;
        badge.textContent = 'KITCHEN';
        header.appendChild(badge);
    } else if (printer.type === 'receipt') {
        const badge = document.createElement('span');
        badge.style.cssText = `
            background: ${T.cyan};
            color: ${T.bg};
            padding: 2px 6px;
            border-radius: 3px;
            font-size: 8px;
            font-weight: bold;
        `;
        badge.textContent = 'RECEIPT';
        header.appendChild(badge);
    }

    card.appendChild(header);

    const info = document.createElement('div');
    info.style.cssText = `
        font-size: 11px;
        color: ${T.textMuted};
        font-family: 'Share Tech Mono', monospace;
        display: grid;
        gap: 4px;
    `;
    info.innerHTML = `
        <div>IP: ${printer.ip || 'unknown'}</div>
        <div>Port: ${printer.port || 9100}</div>
    `;
    card.appendChild(info);

    const actions = document.createElement('div');
    actions.style.cssText = `
        display: flex;
        gap: 8px;
        padding-top: 8px;
        border-top: 1px solid ${T.border};
    `;

    const testBtn = buildGhostButton('TEST', T.green, async () => {
        try {
            const resp = await fetchWithTimeout('/api/v1/hardware/test-print', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ ip: printer.ip, port: printer.port || 9100 })
            });
            if (resp.ok) {
                showToast(`Test print sent to ${printer.name}`);
            } else {
                showToast('Test print failed', 'error');
            }
        } catch (e) {
            showToast(`Test error: ${e.message}`, 'error');
        }
    });

    const editBtn = buildGhostButton('EDIT', T.text, () => {
        _state.editingPrinterId = printer.mac || null;
        rebuild();
    });

    const removeBtn = buildGhostButton('REMOVE', T.verm, async () => {
        if (confirm(`Remove ${printer.name}?`)) {
            try {
                await pushChanges([{
                    event_type: 'printer.removed',
                    payload: { mac: printer.mac }
                }]);
                await loadData();
                rebuild();
                showToast('Printer removed');
            } catch (e) {
                showToast(`Remove failed: ${e.message}`, 'error');
            }
        }
    });

    actions.appendChild(testBtn);
    actions.appendChild(editBtn);
    actions.appendChild(removeBtn);
    card.appendChild(actions);

    return card;
};

const buildPrintersTab = () => {
    const container = document.createElement('div');
    container.style.cssText = `
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
        gap: 16px;
    `;

    _state.printers.forEach(printer => {
        container.appendChild(buildPrinterCard(printer));
    });

    const addCard = document.createElement('div');
    addCard.style.cssText = `
        border: 2px dashed ${T.border};
        border-radius: 8px;
        padding: 32px;
        background: ${withAlpha(T.border, 0.1)};
        display: flex;
        align-items: center;
        justify-content: center;
        cursor: pointer;
        transition: all 0.2s;
    `;
    addCard.textContent = '+ ADD PRINTER';
    addCard.style.color = T.textMuted;
    addCard.style.fontFamily = 'Orbitron, sans-serif';
    addCard.style.fontSize = '12px';
    addCard.addEventListener('mouseenter', () => {
        addCard.style.borderColor = T.green;
        addCard.style.color = T.green;
    });
    addCard.addEventListener('mouseleave', () => {
        addCard.style.borderColor = T.border;
        addCard.style.color = T.textMuted;
    });
    addCard.addEventListener('click', () => {
        showToast('Add printer: Use network scan in Network Setup section', 'info');
    });

    container.appendChild(addCard);
    return container;
};

/* ─── CARD READERS TAB ───────────────────────────────────────── */
const buildCardReaderCard = (reader) => {
    const card = document.createElement('div');
    card.style.cssText = `
        border: 1px solid ${T.border};
        border-radius: 8px;
        padding: 16px;
        background: ${T.card};
        display: flex;
        flex-direction: column;
        gap: 12px;
    `;

    const name = document.createElement('div');
    name.style.cssText = `
        font-family: 'Orbitron', sans-serif;
        font-size: 13px;
        font-weight: bold;
        color: ${T.text};
    `;
    name.textContent = reader.name || 'Card Reader';
    card.appendChild(name);

    const info = document.createElement('div');
    info.style.cssText = `
        font-size: 11px;
        color: ${T.textMuted};
        font-family: 'Share Tech Mono', monospace;
        display: grid;
        gap: 4px;
    `;
    info.innerHTML = `
        <div>MAC: ${reader.mac || 'unknown'}</div>
        <div>IP: ${reader.ip || 'unknown'}</div>
        <div>Register ID: ${reader.register_id || 'not configured'}</div>
    `;
    card.appendChild(info);

    const actions = document.createElement('div');
    actions.style.cssText = `
        display: flex;
        gap: 8px;
        padding-top: 8px;
        border-top: 1px solid ${T.border};
    `;

    const editBtn = buildGhostButton('EDIT', T.text, () => {
        _state.editingReaderId = reader.mac || null;
        rebuild();
    });

    const unpairBtn = buildGhostButton('UNPAIR', T.verm, async () => {
        if (confirm(`Unpair ${reader.name}?`)) {
            try {
                await pushChanges([{
                    event_type: 'payment.processor_removed',
                    payload: { mac: reader.mac }
                }]);
                await loadData();
                rebuild();
                showToast('Card reader unpaired');
            } catch (e) {
                showToast(`Unpair failed: ${e.message}`, 'error');
            }
        }
    });

    actions.appendChild(editBtn);
    actions.appendChild(unpairBtn);
    card.appendChild(actions);

    return card;
};

const buildCardReadersTab = () => {
    const container = document.createElement('div');
    container.style.cssText = `
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
        gap: 16px;
    `;

    _state.cardReaders.forEach(reader => {
        container.appendChild(buildCardReaderCard(reader));
    });

    const addCard = document.createElement('div');
    addCard.style.cssText = `
        border: 2px dashed ${T.border};
        border-radius: 8px;
        padding: 32px;
        background: ${withAlpha(T.border, 0.1)};
        display: flex;
        align-items: center;
        justify-content: center;
        cursor: pointer;
        transition: all 0.2s;
    `;
    addCard.textContent = '+ ADD CARD READER';
    addCard.style.color = T.textMuted;
    addCard.style.fontFamily = 'Orbitron, sans-serif';
    addCard.style.fontSize = '12px';
    addCard.addEventListener('mouseenter', () => {
        addCard.style.borderColor = T.cyan;
        addCard.style.color = T.cyan;
    });
    addCard.addEventListener('mouseleave', () => {
        addCard.style.borderColor = T.border;
        addCard.style.color = T.textMuted;
    });
    addCard.addEventListener('click', () => {
        showToast('Add card reader: Use network scan in Network Setup section', 'info');
    });

    container.appendChild(addCard);
    return container;
};

/* ─── TAB SWITCHER ───────────────────────────────────────────── */
const buildTabBar = () => {
    const bar = document.createElement('div');
    bar.style.cssText = `
        display: flex;
        gap: 0;
        border-bottom: 1px solid ${T.border};
        margin-bottom: 16px;
    `;

    const tabs = [
        { id: 'terminals', label: `TERMINALS (${_state.terminals.length})` },
        { id: 'printers', label: `PRINTERS (${_state.printers.length})` },
        { id: 'cardReaders', label: `CARD READERS (${_state.cardReaders.length})` },
    ];

    tabs.forEach(tab => {
        const btn = document.createElement('button');
        btn.style.cssText = `
            padding: 12px 16px;
            border: none;
            background: ${_state.activeTab === tab.id ? T.well : 'transparent'};
            color: ${_state.activeTab === tab.id ? T.text : T.textMuted};
            font-family: 'Orbitron', sans-serif;
            font-size: 11px;
            font-weight: bold;
            cursor: pointer;
            border-bottom: ${_state.activeTab === tab.id ? `2px solid ${T.green}` : 'none'};
            transition: all 0.2s;
        `;
        btn.textContent = tab.label;
        btn.addEventListener('click', () => {
            _state.activeTab = tab.id;
            rebuild();
        });
        bar.appendChild(btn);
    });

    return bar;
};

/* ─── MAIN SCENE BUILDER ───────────────────────────────────────── */
const rebuild = () => {
    if (!_state.container) return;

    const main = _state.container.querySelector('[data-hardware-main]');
    if (!main) return;

    main.innerHTML = '';

    main.appendChild(buildTabBar());

    let tabContent;
    if (_state.activeTab === 'terminals') {
        tabContent = buildTerminalsTab();
    } else if (_state.activeTab === 'printers') {
        tabContent = buildPrintersTab();
    } else {
        tabContent = buildCardReadersTab();
    }

    main.appendChild(tabContent);
};

export const buildHardwareScene = async (container) => {
    _state.container = container;

    const page = buildScenePage(container);
    const { root, body } = page;

    body.appendChild(buildSyncStatusBar());

    const main = document.createElement('div');
    main.setAttribute('data-hardware-main', '');
    main.style.cssText = `
        padding: 16px;
        flex: 1;
        overflow-y: auto;
    `;
    body.appendChild(main);

    await loadData();
    rebuild();

    return () => {
        resetState();
    };
};

export const cleanupHardware = () => {
    resetState();
};
