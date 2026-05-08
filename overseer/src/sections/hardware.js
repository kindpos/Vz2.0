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
    numberField, row, openModal, showToast,
} from '../ui/forms.js';
import { hexToRgba, buildStaticCard } from '../../../common/theme.js';

/* ─── LOCAL UI HELPERS ────────────────────────────────────────── */
const buildPillButton = (label, fillColor, textColor, onClick) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = label;
    const shadow = hexToRgba(fillColor, 0.45);
    b.style.cssText = `
        display: inline-flex; align-items: center; justify-content: center;
        padding: 6px 14px; background: ${fillColor}; color: ${textColor};
        border: none; border-radius: 999px; font-family: ${T.fb};
        font-size: 9px; font-weight: 700; letter-spacing: 0.08em;
        text-transform: uppercase; cursor: pointer; outline: none;
        box-shadow: 0 3px 0 ${shadow}; transition: transform 0.08s ease, box-shadow 0.08s ease;
        white-space: nowrap;
    `;
    b.addEventListener('mousedown', () => { b.style.transform = 'translateY(2px)'; b.style.boxShadow = `0 1px 0 ${shadow}`; });
    const reset = () => { b.style.transform = 'translateY(0)'; b.style.boxShadow = `0 3px 0 ${shadow}`; };
    b.addEventListener('mouseup', reset);
    b.addEventListener('mouseleave', reset);
    if (onClick) b.addEventListener('click', onClick);
    return b;
};

const buildGhostButton = (label, color, onClick) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = label;
    b.style.cssText = `
        background: transparent; border: 1px solid ${hexToRgba(color, 0.5)};
        color: ${color}; font-family: ${T.fb}; font-size: 9px; font-weight: 700;
        letter-spacing: 0.08em; text-transform: uppercase; padding: 5px 14px;
        border-radius: 999px; cursor: pointer; outline: none; white-space: nowrap;
    `;
    if (onClick) b.addEventListener('click', onClick);
    return b;
};

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
    isScanning: false,
    discoveredDevices: [],
    scanEventSource: null,
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
        isScanning: false,
        discoveredDevices: [],
        scanEventSource: null,
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

/* ─── TEST CONNECTION ───────────────────────────────────────────── */
const buildTestConnectionButton = (ipInput, portInput) => {
    const btn = buildGhostButton('TEST', T.cyan, async () => {
        const ip = ipInput.value.trim();
        const port = portInput.value.trim();

        if (!ip || !isValidIP(ip)) {
            showToast('Invalid IP address', 'error');
            return;
        }

        if (!port || !isValidPort(port)) {
            showToast('Invalid port (0-65535)', 'error');
            return;
        }

        btn.disabled = true;
        const originalText = btn.textContent;
        btn.textContent = 'TESTING...';

        try {
            const resp = await fetchWithTimeout('/api/v1/hardware/test-connection', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ ip, port: parseInt(port, 10) })
            }, 5000);

            if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
            const result = await resp.json();

            if (result.status === 'online') {
                btn.textContent = '✓ REACHABLE';
                btn.style.color = T.green;
                showToast(`${ip}:${port} is reachable`);
            } else {
                btn.textContent = '✗ UNREACHABLE';
                btn.style.color = T.verm;
                showToast(`${ip}:${port} is unreachable`, 'warn');
            }

            setTimeout(() => {
                btn.textContent = originalText;
                btn.style.color = T.cyan;
                btn.disabled = false;
            }, 2000);
        } catch (e) {
            btn.textContent = '✗ ERROR';
            btn.style.color = T.verm;
            showToast(`Connection test failed: ${e.message}`, 'error');
            setTimeout(() => {
                btn.textContent = originalText;
                btn.style.color = T.cyan;
                btn.disabled = false;
            }, 2000);
        }
    });

    const updateDisabled = () => {
        const ip = ipInput.value.trim();
        const port = portInput.value.trim();
        btn.disabled = !ip || !port;
    };

    ipInput.addEventListener('input', updateDisabled);
    portInput.addEventListener('input', updateDisabled);
    updateDisabled();

    return btn;
};

/* ─── DISCOVERED DEVICES LIST ───────────────────────────────────── */
const buildDiscoveredDevicesList = () => {
    const container = document.createElement('div');

    if (_state.discoveredDevices.length === 0) {
        if (!_state.isScanning) {
            return container;
        }
        container.style.cssText = `
            padding: 16px;
            text-align: center;
            color: ${T.textMuted};
            font-family: 'Share Tech Mono', monospace;
            font-size: 11px;
        `;
        container.textContent = 'Scanning network...';
        return container;
    }

    container.style.cssText = `
        padding: 16px;
        background: ${withAlpha(T.green, 0.08)};
        border-top: 1px solid ${T.border};
    `;

    const title = document.createElement('div');
    title.style.cssText = `
        font-family: 'Orbitron', sans-serif;
        font-size: 12px;
        font-weight: bold;
        color: ${T.text};
        margin-bottom: 12px;
    `;
    title.textContent = `DISCOVERED — ${_state.discoveredDevices.length} device${_state.discoveredDevices.length === 1 ? '' : 's'}`;
    container.appendChild(title);

    const list = document.createElement('div');
    list.style.cssText = `
        display: grid;
        gap: 8px;
    `;

    _state.discoveredDevices.forEach(dev => {
        const item = document.createElement('div');
        item.style.cssText = `
            display: flex;
            justify-content: space-between;
            align-items: center;
            padding: 8px;
            background: ${T.card};
            border-radius: 4px;
            border: 1px solid ${T.border};
            font-family: 'Share Tech Mono', monospace;
            font-size: 11px;
        `;

        const info = document.createElement('div');
        info.style.cssText = `flex: 1;`;
        info.innerHTML = `<div>${dev.ip || 'unknown'}</div><div style="color: ${T.textMuted}; margin-top: 2px;">${dev.type || 'unknown'}</div>`;

        const addBtn = buildGhostButton('ADD', T.green, () => {
            showToast(`Added ${dev.ip} to pending devices`, 'success');
            _state.discoveredDevices = _state.discoveredDevices.filter(d => d !== dev);
            rebuild();
        });

        item.appendChild(info);
        item.appendChild(addBtn);
        list.appendChild(item);
    });

    container.appendChild(list);
    return container;
};

/* ─── SYNC STATUS BAR ───────────────────────────────────────────── */
const buildSyncStatusBar = () => {
    const bar = document.createElement('div');
    bar.style.cssText = `
        display: flex;
        gap: 16px;
        align-items: center;
        justify-content: space-between;
        padding: 12px 16px;
        background: ${T.well};
        border-bottom: 1px solid ${T.border};
        font-family: 'Share Tech Mono', monospace;
        font-size: 11px;
        color: ${T.textMuted};
    `;

    const left = document.createElement('div');
    left.style.cssText = `display: flex; gap: 16px; align-items: center;`;

    const hub = getHubTerminal();
    const hubStatus = hub
        ? `🟢 HUB ONLINE — ${hub.name || 'Hub'} (${hub.ip_address || 'unknown'})`
        : `⚪ NO HUB CONFIGURED`;

    left.innerHTML = `
        <div>${hubStatus}</div>
        <div>•</div>
        <div>${_state.terminals.length} terminals</div>
        <div>•</div>
        <div>Sync: ${_state.lastSyncTime || 'never'}</div>
    `;

    const scanBtn = buildPillButton(
        _state.isScanning ? 'SCANNING...' : 'SCAN NETWORK',
        _state.isScanning ? T.textMuted : T.gold,
        _state.isScanning ? T.card : T.bg,
        async () => {
            if (_state.isScanning) return;
            await startNetworkScan();
        }
    );
    scanBtn.disabled = _state.isScanning;

    bar.appendChild(left);
    bar.appendChild(scanBtn);

    return bar;
};

const startNetworkScan = async () => {
    _state.isScanning = true;
    _state.discoveredDevices = [];
    rebuild();

    if (_state.scanEventSource) {
        _state.scanEventSource.close();
    }

    try {
        _state.scanEventSource = new EventSource('/api/v1/hardware/scan/stream');

        _state.scanEventSource.onmessage = (e) => {
            try {
                const device = JSON.parse(e.data);
                _state.discoveredDevices.push(device);
                rebuild();
            } catch (err) {
                console.error('[Scan] Parse error:', err);
            }
        };

        _state.scanEventSource.onerror = (e) => {
            _state.scanEventSource.close();
            _state.scanEventSource = null;
            _state.isScanning = false;
            showToast(`Scan complete — ${_state.discoveredDevices.length} devices found`, 'success');
            rebuild();
        };
    } catch (e) {
        _state.isScanning = false;
        showToast(`Scan failed: ${e.message}`, 'error');
        rebuild();
    }
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
                const result = await pushChanges([{
                    event_type: 'terminal.updated',
                    payload: { terminal_id: term.terminal_id, is_hub: false }
                }]);
                if (!result.ok) { showToast('Failed to reassign hub', 'error'); return; }
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
                const result = await pushChanges([{
                    event_type: 'terminal.updated',
                    payload: { terminal_id: term.terminal_id, is_hub: true }
                }]);
                if (!result.ok) { showToast('Failed to designate hub', 'error'); return; }
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

    const ipInput = document.createElement('input');
    ipInput.type = 'text';
    ipInput.placeholder = 'IP Address';
    ipInput.value = term.ip_address || '';
    ipInput.style.cssText = nameInput.style.cssText;

    const ipRow = document.createElement('div');
    ipRow.style.cssText = `display: flex; gap: 8px; align-items: center;`;
    ipRow.appendChild(ipInput);
    const testBtn = buildTestConnectionButton(ipInput, { value: '22' });
    testBtn.style.whiteSpace = 'nowrap';
    ipRow.appendChild(testBtn);

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
            const result = await pushChanges([{
                event_type: 'terminal.updated',
                payload: {
                    terminal_id: term.terminal_id,
                    name: newName,
                    role: newRole,
                    training_mode: trainingChk.checked,
                }
            }]);
            if (!result.ok) { showToast('Failed to update terminal', 'error'); return; }
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
    panel.appendChild(ipRow);
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
        flex-wrap: wrap;
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

    const connBtn = buildGhostButton('PING', T.cyan, async () => {
        try {
            const resp = await fetchWithTimeout('/api/v1/hardware/test-connection', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ ip: printer.ip, port: printer.port || 9100 })
            }, 5000);
            if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
            const result = await resp.json();
            if (result.status === 'online') {
                showToast(`${printer.ip}:${printer.port} is reachable`, 'success');
            } else {
                showToast(`${printer.ip}:${printer.port} is unreachable`, 'warn');
            }
        } catch (e) {
            showToast(`Connection test failed: ${e.message}`, 'error');
        }
    });

    const editBtn = buildGhostButton('EDIT', T.text, () => {
        _state.editingPrinterId = printer.mac || null;
        rebuild();
    });

    const removeBtn = buildGhostButton('REMOVE', T.verm, async () => {
        if (confirm(`Remove ${printer.name}?`)) {
            try {
                const result = await pushChanges([{
                    event_type: 'printer.removed',
                    payload: { mac: printer.mac }
                }]);
                if (!result.ok) { showToast('Failed to remove printer', 'error'); return; }
                await loadData();
                rebuild();
                showToast('Printer removed');
            } catch (e) {
                showToast(`Remove failed: ${e.message}`, 'error');
            }
        }
    });

    actions.appendChild(testBtn);
    actions.appendChild(connBtn);
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
                const result = await pushChanges([{
                    event_type: 'payment.processor_removed',
                    payload: { mac: reader.mac }
                }]);
                if (!result.ok) { showToast('Failed to unpair card reader', 'error'); return; }
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

    const status = _state.container.querySelector('[data-hardware-status]');
    if (status) {
        status.innerHTML = '';
        status.appendChild(buildSyncStatusBar());
        status.appendChild(buildDiscoveredDevicesList());
    }

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

    const page = buildScenePage(container, { title: 'Hardware Management', onSave: null });
    const { body } = page;

    const statusWrapper = document.createElement('div');
    statusWrapper.setAttribute('data-hardware-status', '');
    statusWrapper.style.cssText = `flex-shrink: 0;`;
    statusWrapper.appendChild(buildSyncStatusBar());
    statusWrapper.appendChild(buildDiscoveredDevicesList());
    body.appendChild(statusWrapper);

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
        if (_state.scanEventSource) {
            _state.scanEventSource.close();
            _state.scanEventSource = null;
        }
        resetState();
    };
};

export const cleanupHardware = () => {
    resetState();
};
