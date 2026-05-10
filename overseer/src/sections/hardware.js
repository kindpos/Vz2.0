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

/* ─── DIAGRAM: terminal identity palette ─────────────────────── */
// Per-terminal color used by the Hardware Hub diagram. Cycles through
// four hues so up to 4 terminals are visually distinguishable; index 4
// wraps back to the first hue.
const TERMINAL_COLORS = [
    { color: T.green,    dim: withAlpha(T.green,    0.15) },
    { color: T.elec,     dim: withAlpha(T.elec,     0.15) },
    { color: T.lavender, dim: withAlpha(T.lavender, 0.15) },
    { color: T.warning,  dim: withAlpha(T.warning,  0.15) },
];

const getTerminalColor = (index) =>
    TERMINAL_COLORS[index % TERMINAL_COLORS.length];

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
    kindTerminals: [],
    licenses: [],
    routingRules: {},
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
        kindTerminals: [],
        licenses: [],
        routingRules: {},
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

        const configResp = await fetchWithTimeout('/api/v1/hardware/terminals');
        if (!configResp.ok) throw new Error(`Terminals config fetch failed: ${configResp.status}`);
        const terminals = await configResp.json();

        _state.terminals = Array.isArray(terminals) ? terminals : [];
        _state.printers = devices.filter(d =>
            d.type === 'printer' || d.type === 'kitchen' || d.type === 'receipt' ||
            d.type === 'thermal' || d.type === 'impact'
        ) || [];
        _state.cardReaders = devices.filter(d => d.type === 'card_reader') || [];
        _state.kindTerminals = devices.filter(d => d.type === 'terminal') || [];

        try {
            const routingResp = await fetchWithTimeout('/api/v1/hardware/routing');
            if (routingResp.ok) {
                const rules = await routingResp.json();
                _state.routingRules = {};
                for (const rule of rules) {
                    if (!_state.routingRules[rule.printer_mac]) {
                        _state.routingRules[rule.printer_mac] = [];
                    }
                    _state.routingRules[rule.printer_mac].push(rule);
                }
            }
        } catch (e) {
            console.warn('[Hardware] Routing rules unavailable:', e);
        }

        try {
            const licResp = await fetchWithTimeout('/api/v1/hardware/license/list');
            if (licResp.ok) {
                const lic = await licResp.json();
                _state.licenses = Array.isArray(lic) ? lic : [];
            }
        } catch (licErr) {
            console.warn('[Hardware] License list unavailable:', licErr);
        }

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
        info.innerHTML = `<div style="color: ${T.mint}; font-weight: bold;">${dev.name || 'Unknown Device'}</div><div style="color: ${T.textMuted}; margin-top: 2px;">${dev.ip}</div><div style="color: ${T.textMuted}; margin-top: 2px; font-size: 9px; text-transform: uppercase; letter-spacing: 0.08em;">${dev.type || 'unknown'}</div>`;

        item.style.position = 'relative';

        const isPrinter = dev.type === 'printer' || dev.type === 'thermal_printer';

        const doAdd = async (chosenType, extraFields = {}) => {
            try {
                const resp = await fetchWithTimeout('/api/v1/hardware/devices', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        mac:  dev.mac || null,
                        ip:   dev.ip,
                        type: chosenType,
                        name: dev.name || chosenType,
                        port: dev.port || 9100,
                        ...extraFields,
                    }),
                });
                if (resp.status === 409) {
                    const err = await resp.json();
                    showToast(`Could not save ${dev.ip} — ${err.detail?.message || 'MAC could not be resolved'}`, 'error');
                    rebuild();
                    return;
                }
                if (!resp.ok) {
                    showToast(`Failed to save ${dev.ip} (HTTP ${resp.status})`, 'error');
                    rebuild();
                    return;
                }
                showToast(`${dev.ip} saved as ${chosenType}`, 'success');
                _state.discoveredDevices = _state.discoveredDevices.filter(d => d !== dev);
                await loadData();
                rebuild();
            } catch (e) {
                showToast(`Could not save ${dev.ip} — ${e.message}`, 'error');
                rebuild();
            }
        };

        const addBtn = buildGhostButton('ADD', T.green, () => {
            if (dev.type === 'card_reader') {
                const existing = item.querySelector('[data-register-picker]');
                if (existing) { existing.remove(); return; }

                const picker = document.createElement('div');
                picker.setAttribute('data-register-picker', '');
                picker.style.cssText = `
                    position: absolute; right: 0; top: 100%; z-index: 200;
                    background: ${T.bg}; border: 1px solid ${T.border};
                    border-radius: 6px; padding: 10px;
                    display: flex; flex-direction: column; gap: 8px;
                    min-width: 280px; box-shadow: 0 4px 16px rgba(0,0,0,0.4);
                `;

                const label = document.createElement('div');
                label.style.cssText = `
                    font-size: 9px; font-weight: 700; text-transform: uppercase;
                    letter-spacing: 0.08em; color: ${T.textMuted};
                    font-family: ${T.fb};
                `;
                label.textContent = 'SPIn Register ID';
                picker.appendChild(label);

                const input = document.createElement('input');
                input.type = 'text';
                input.id = `register-id-input-${dev.mac}`;
                input.placeholder = 'SPIn Register ID';
                input.style.cssText = `
                    background: ${T.card}; border: 1px solid ${T.border};
                    color: ${T.text}; padding: 8px; border-radius: 4px;
                    font-family: ${T.fb}; font-size: 12px; width: 100%; box-sizing: border-box;
                    outline: none;
                `;
                picker.appendChild(input);

                const confirmBtn = buildPillButton('CONFIRM', T.cyan, T.bg, async () => {
                    const registerIdValue = input.value.trim();
                    if (!registerIdValue) return;
                    picker.remove();
                    await doAdd('card_reader', { register_id: registerIdValue });
                });

                const updateConfirmState = () => {
                    confirmBtn.disabled = !input.value.trim();
                };

                input.addEventListener('input', updateConfirmState);
                updateConfirmState();

                const cancelBtn = buildPillButton('Cancel', '#7e8896', T.bg, () => {
                    picker.remove();
                });

                const btnRow = document.createElement('div');
                btnRow.style.cssText = 'display: flex; gap: 6px;';
                btnRow.appendChild(confirmBtn);
                btnRow.appendChild(cancelBtn);
                picker.appendChild(btnRow);

                item.appendChild(picker);
                input.focus();
                return;
            }

            if (!isPrinter) {
                doAdd(dev.type);
                return;
            }

            const existing = item.querySelector('[data-printer-picker]');
            if (existing) { existing.remove(); return; }

            let selectedRole = null;
            let selectedHardwareType = 'thermal';

            const picker = document.createElement('div');
            picker.setAttribute('data-printer-picker', '');
            picker.style.cssText = `
                position: absolute; right: 0; top: 100%; z-index: 200;
                background: ${T.bg}; border: 1px solid ${T.border};
                border-radius: 6px; padding: 10px;
                display: flex; flex-direction: column; gap: 6px;
                min-width: 220px; box-shadow: 0 4px 16px rgba(0,0,0,0.4);
            `;

            // ── STEP 1: Role ──────────────────────────────────────────
            const step1Label = document.createElement('div');
            step1Label.style.cssText = `
                font-size: 9px; color: ${T.textMuted}; font-family: ${T.fb};
                text-transform: uppercase; letter-spacing: 0.08em;
            `;
            step1Label.textContent = 'STEP 1 — ROLE';

            const step1Row = document.createElement('div');
            step1Row.style.cssText = `display: flex; gap: 6px;`;

            const kitchenBtn = buildPillButton('KITCHEN', T.gold, T.bg, () => {
                selectedRole = 'kitchen';
                step1Label.style.display = 'none';
                step1Row.style.display = 'none';
                step2.style.display = 'flex';
            });
            const receiptBtn = buildPillButton('RECEIPT', T.mint, T.bg, () => {
                selectedRole = 'receipt';
                step1Label.style.display = 'none';
                step1Row.style.display = 'none';
                step2.style.display = 'flex';
            });

            step1Row.appendChild(kitchenBtn);
            step1Row.appendChild(receiptBtn);

            // ── STEP 2: Hardware type ─────────────────────────────────
            const step2 = document.createElement('div');
            step2.style.cssText = `display: none; flex-direction: column; gap: 6px;`;

            const step2Label = document.createElement('div');
            step2Label.style.cssText = `
                font-size: 9px; color: ${T.textMuted}; font-family: ${T.fb};
                text-transform: uppercase; letter-spacing: 0.08em;
            `;
            step2Label.textContent = 'STEP 2 — HARDWARE TYPE';

            const hwRow = document.createElement('div');
            hwRow.style.cssText = `display: flex; gap: 6px;`;

            const thermalBtn = buildPillButton('THERMAL', T.mint, T.bg, null);
            const impactBtn = buildPillButton('IMPACT', T.gold, T.bg, null);

            const helperText = document.createElement('div');
            helperText.style.cssText = `
                font-size: 9px; color: ${T.textMuted}; font-family: ${T.fb};
                line-height: 1.4; padding: 2px 0;
            `;

            const applyHwSelection = () => {
                thermalBtn.style.opacity = selectedHardwareType === 'thermal' ? '1' : '0.4';
                impactBtn.style.opacity = selectedHardwareType === 'impact' ? '1' : '0.4';
                helperText.textContent = selectedHardwareType === 'thermal'
                    ? 'Thermal: inkless roll paper (most receipt/kitchen printers)'
                    : 'Impact: dot matrix with ink ribbon (Epson TM-U220, TM-U950)';
            };

            thermalBtn.addEventListener('click', () => { selectedHardwareType = 'thermal'; applyHwSelection(); });
            impactBtn.addEventListener('click', () => { selectedHardwareType = 'impact'; applyHwSelection(); });
            applyHwSelection();

            hwRow.appendChild(thermalBtn);
            hwRow.appendChild(impactBtn);

            const confirmBtn = buildPillButton('CONFIRM', T.green, T.bg, async () => {
                picker.remove();
                const extra = { role: selectedRole };
                if (selectedRole === 'receipt') extra.terminal_ids = [];
                await doAdd(selectedHardwareType, extra);
            });

            step2.appendChild(step2Label);
            step2.appendChild(hwRow);
            step2.appendChild(helperText);
            step2.appendChild(confirmBtn);

            const cancelBtn = buildPillButton('CANCEL', '#7e8896', T.bg, () => {
                picker.remove();
            });

            picker.appendChild(step1Label);
            picker.appendChild(step1Row);
            picker.appendChild(step2);
            picker.appendChild(cancelBtn);
            item.appendChild(picker);
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

    const targetIpInput = document.createElement('input');
    targetIpInput.type = 'text';
    targetIpInput.placeholder = 'Target IP (optional)';
    targetIpInput.style.cssText = `
        background: ${T.well}; border: 1px solid ${T.border};
        color: ${T.text}; padding: 5px 10px; border-radius: 4px;
        font-family: 'Share Tech Mono', monospace; font-size: 11px;
        width: 160px; outline: none;
    `;
    targetIpInput.disabled = _state.isScanning;

    const scanBtn = buildPillButton(
        _state.isScanning ? 'SCANNING...' : 'SCAN NETWORK',
        _state.isScanning ? T.textMuted : T.gold,
        _state.isScanning ? T.card : T.bg,
        async () => {
            if (_state.isScanning) return;
            await startNetworkScan(targetIpInput.value.trim() || null);
        }
    );
    scanBtn.disabled = _state.isScanning;

    bar.appendChild(left);
    bar.appendChild(targetIpInput);
    bar.appendChild(scanBtn);

    return bar;
};

const startNetworkScan = async (targetIp = null) => {
    _state.isScanning = true;
    _state.discoveredDevices = [];
    rebuild();

    if (_state.scanEventSource) {
        _state.scanEventSource.close();
    }

    try {
        const url = targetIp
            ? `/api/v1/hardware/scan/stream?ip=${encodeURIComponent(targetIp)}`
            : '/api/v1/hardware/scan/stream';
        _state.scanEventSource = new EventSource(url);

        _state.scanEventSource.onmessage = (e) => {
            try {
                const msg = JSON.parse(e.data);
                if (msg.event !== 'device') return;
                _state.discoveredDevices.push(msg);
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

    const termPortInput = document.createElement('input');
    termPortInput.value = '8000';

    const ipRow = document.createElement('div');
    ipRow.style.cssText = `display: flex; gap: 8px; align-items: center;`;
    ipRow.appendChild(ipInput);
    const testBtn = buildTestConnectionButton(ipInput, termPortInput);
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
                    ip_address: ipInput.value.trim(),
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

    // Hardware type badge: THERMAL or IMPACT
    const isImpact = printer.type === 'impact';
    const hwBadge = document.createElement('span');
    hwBadge.style.cssText = `
        background: ${isImpact ? T.gold : T.lavender};
        color: ${T.bg}; padding: 2px 6px; border-radius: 3px;
        font-size: 8px; font-weight: bold;
    `;
    hwBadge.textContent = isImpact ? 'IMPACT' : 'THERMAL';
    header.appendChild(hwBadge);

    // Role badge: KITCHEN or RECEIPT
    const isKitchenRole = printer.role === 'kitchen' || printer.type === 'kitchen';
    const isReceiptRole = printer.role === 'receipt' || printer.type === 'receipt';
    if (isKitchenRole || isReceiptRole) {
        const roleBadge = document.createElement('span');
        roleBadge.style.cssText = `
            background: ${isKitchenRole ? T.green : T.elec};
            color: ${T.bg}; padding: 2px 6px; border-radius: 3px;
            font-size: 8px; font-weight: bold;
        `;
        roleBadge.textContent = isKitchenRole ? 'KITCHEN' : 'RECEIPT';
        header.appendChild(roleBadge);
    }

    // Routing badge (kitchen printers only)
    if (isKitchenRole && printer.mac) {
        const printerRules = _state.routingRules[printer.mac] || [];
        const hasAllRule = printerRules.some(r => r.rule_type === 'all');
        const routingBadge = document.createElement('span');
        routingBadge.style.cssText = `
            background: ${hasAllRule ? T.green : T.gold};
            color: ${T.bg}; padding: 2px 6px; border-radius: 3px;
            font-size: 8px; font-weight: bold; cursor: pointer;
        `;
        routingBadge.textContent = hasAllRule ? 'ALL ITEMS' : `${printerRules.length} RULES`;
        routingBadge.addEventListener('click', (e) => {
            e.stopPropagation();
            showToast('Category routing — coming soon');
        });
        header.appendChild(routingBadge);
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
                const resp = await fetchWithTimeout(`/api/v1/hardware/devices/${printer.mac}`, {
                    method: 'DELETE',
                }, 5000);
                if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
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

const buildPrinterEditPanel = (printer) => {
    const inputCss = `
        background: ${T.card}; border: 1px solid ${T.border};
        color: ${T.text}; padding: 8px; border-radius: 4px;
        font-family: ${T.fb}; font-size: 12px; width: 100%; box-sizing: border-box;
    `;

    // ── panel shell ───────────────────────────────────────────────────
    const panel = document.createElement('div');
    panel.style.cssText = `
        background: ${T.well}; border: 1px solid ${T.border};
        border-radius: 8px; margin-bottom: 16px;
        display: flex; flex-direction: column; gap: 0;
        overflow: hidden; grid-column: 1 / -1;
    `;

    // ── 1. header row ─────────────────────────────────────────────────
    const header = document.createElement('div');
    header.style.cssText = `
        display: flex; align-items: center; gap: 10px;
        padding: 12px 16px; border-bottom: 1px solid ${T.border};
    `;
    const headerTitle = document.createElement('div');
    headerTitle.style.cssText = `
        font-family: ${T.fh}; font-size: 13px; font-weight: 700;
        color: ${T.green}; flex: 1; letter-spacing: 0.04em;
    `;
    headerTitle.textContent = 'EDIT PRINTER';

    const roleBadge = document.createElement('span');
    const isReceiptInit = printer.type === 'receipt';
    roleBadge.style.cssText = `
        background: ${isReceiptInit ? T.elec : T.gold};
        color: ${T.bg}; padding: 2px 8px; border-radius: 3px;
        font-size: 8px; font-weight: 700; text-transform: uppercase;
        letter-spacing: 0.08em;
    `;
    roleBadge.textContent = isReceiptInit ? 'RECEIPT' : 'KITCHEN';

    header.appendChild(headerTitle);
    header.appendChild(roleBadge);
    panel.appendChild(header);

    // ── 2. MAC strip (read-only) ───────────────────────────────────────
    const macStrip = document.createElement('div');
    macStrip.style.cssText = `
        display: flex; align-items: center; gap: 10px;
        padding: 8px 16px; background: ${T.well};
        border-bottom: 1px solid ${T.border};
        font-family: 'Share Tech Mono', monospace; font-size: 11px;
    `;
    const macLabel = document.createElement('span');
    macLabel.style.cssText = `color: ${T.textMuted};`;
    macLabel.textContent = 'MAC';
    const macValue = document.createElement('span');
    macValue.style.cssText = `color: ${T.text}; letter-spacing: 0.06em; flex: 1;`;
    macValue.textContent = printer.mac || '—';
    const lockIcon = document.createElement('span');
    lockIcon.textContent = '🔒';
    lockIcon.style.cssText = `font-size: 10px;`;
    const idChip = document.createElement('span');
    idChip.style.cssText = `
        background: ${withAlpha(T.textMuted, 0.15)}; color: ${T.textMuted};
        padding: 1px 6px; border-radius: 3px; font-size: 9px;
        letter-spacing: 0.06em;
    `;
    idChip.textContent = 'Identity Key';

    macStrip.appendChild(macLabel);
    macStrip.appendChild(macValue);
    macStrip.appendChild(lockIcon);
    macStrip.appendChild(idChip);
    panel.appendChild(macStrip);

    // ── 3. form body ──────────────────────────────────────────────────
    const body = document.createElement('div');
    body.style.cssText = `padding: 16px; display: flex; flex-direction: column; gap: 12px;`;

    // name
    const nameInput = document.createElement('input');
    nameInput.type = 'text';
    nameInput.placeholder = 'Printer Name';
    nameInput.value = printer.name || '';
    nameInput.style.cssText = inputCss;

    // role toggle
    let currentRole = printer.type === 'receipt' ? 'receipt' : 'kitchen';

    const roleRow = document.createElement('div');
    roleRow.style.cssText = `display: flex; gap: 6px;`;

    const kitchenToggle = buildPillButton('Kitchen', T.gold, T.bg, null);
    const receiptToggle = buildPillButton('Receipt', T.elec, T.bg, null);

    const applyToggleState = () => {
        kitchenToggle.style.opacity = currentRole === 'kitchen' ? '1' : '0.35';
        receiptToggle.style.opacity = currentRole === 'receipt' ? '1' : '0.35';
        roleBadge.textContent = currentRole === 'receipt' ? 'RECEIPT' : 'KITCHEN';
        roleBadge.style.background = currentRole === 'receipt' ? T.elec : T.gold;
        terminalSection.style.display = currentRole === 'receipt' ? 'flex' : 'none';
    };

    kitchenToggle.addEventListener('click', () => { currentRole = 'kitchen'; applyToggleState(); });
    receiptToggle.addEventListener('click', () => { currentRole = 'receipt'; applyToggleState(); });

    roleRow.appendChild(kitchenToggle);
    roleRow.appendChild(receiptToggle);

    // ip + port grid
    const ipPortGrid = document.createElement('div');
    ipPortGrid.style.cssText = `display: grid; grid-template-columns: 1fr 1fr; gap: 8px;`;

    const ipInput = document.createElement('input');
    ipInput.type = 'text';
    ipInput.placeholder = 'IP Address';
    ipInput.value = printer.ip || '';
    ipInput.style.cssText = inputCss;

    const portInput = document.createElement('input');
    portInput.type = 'text';
    portInput.placeholder = 'Port';
    portInput.value = String(printer.port || 9100);
    portInput.style.cssText = inputCss;

    ipPortGrid.appendChild(ipInput);
    ipPortGrid.appendChild(portInput);

    // ── 4. terminal assignment section ────────────────────────────────
    const terminalSection = document.createElement('div');
    terminalSection.style.cssText = `
        flex-direction: column; gap: 8px;
        display: ${currentRole === 'receipt' ? 'flex' : 'none'};
    `;

    const termSectionLabel = document.createElement('div');
    termSectionLabel.style.cssText = `
        font-family: ${T.fh}; font-size: 10px; font-weight: 700;
        color: ${T.textMuted}; letter-spacing: 0.1em; text-transform: uppercase;
    `;
    termSectionLabel.textContent = 'ASSIGNED TERMINALS';
    terminalSection.appendChild(termSectionLabel);

    const selectedIds = new Set(Array.isArray(printer.terminal_ids) ? printer.terminal_ids : []);

    if (_state.terminals.length === 0) {
        const emptyNote = document.createElement('div');
        emptyNote.style.cssText = `
            color: ${T.textMuted}; font-size: 11px;
            font-family: 'Share Tech Mono', monospace; padding: 4px 0;
        `;
        emptyNote.textContent = 'No terminals configured. Add terminals first.';
        terminalSection.appendChild(emptyNote);
    } else {
        _state.terminals.forEach(term => {
            const chip = document.createElement('div');
            chip.style.cssText = `
                display: flex; align-items: center; gap: 10px;
                padding: 8px 10px; background: ${T.card};
                border: 1px solid ${T.border}; border-radius: 5px;
                cursor: pointer; transition: border-color 0.12s;
            `;

            const isSelected = selectedIds.has(term.terminal_id);

            const chkIndicator = document.createElement('span');
            chkIndicator.style.cssText = `
                width: 14px; height: 14px; border-radius: 3px;
                border: 1.5px solid ${isSelected ? T.elec : T.border};
                background: ${isSelected ? T.elec : 'transparent'};
                display: flex; align-items: center; justify-content: center;
                font-size: 9px; color: ${T.bg}; flex-shrink: 0;
                transition: all 0.1s;
            `;
            chkIndicator.textContent = isSelected ? '✓' : '';

            const chipInfo = document.createElement('div');
            chipInfo.style.cssText = `flex: 1;`;
            chipInfo.innerHTML = `
                <div style="font-size: 12px; color: ${T.text}; font-family: ${T.fb};">${term.name || 'Terminal'}</div>
                <div style="font-size: 10px; color: ${T.textMuted}; font-family: 'Share Tech Mono', monospace; margin-top: 1px;">${term.ip_address || ''}</div>
            `;

            const assignBadge = document.createElement('span');
            const isHub = term.is_hub === true;
            assignBadge.style.cssText = `
                padding: 1px 6px; border-radius: 3px; font-size: 8px;
                font-weight: 700; text-transform: uppercase; letter-spacing: 0.06em;
                background: ${isHub ? T.elec : (isSelected ? T.green : '#7e8896')};
                color: ${T.bg};
            `;
            assignBadge.textContent = isHub ? 'Hub' : (isSelected ? 'Assigned' : 'Unassigned');

            chip.appendChild(chkIndicator);
            chip.appendChild(chipInfo);
            chip.appendChild(assignBadge);

            chip.addEventListener('click', () => {
                if (selectedIds.has(term.terminal_id)) {
                    selectedIds.delete(term.terminal_id);
                    chkIndicator.style.border = `1.5px solid ${T.border}`;
                    chkIndicator.style.background = 'transparent';
                    chkIndicator.textContent = '';
                    if (!isHub) {
                        assignBadge.style.background = '#7e8896';
                        assignBadge.textContent = 'Unassigned';
                    }
                } else {
                    selectedIds.add(term.terminal_id);
                    chkIndicator.style.border = `1.5px solid ${T.elec}`;
                    chkIndicator.style.background = T.elec;
                    chkIndicator.textContent = '✓';
                    if (!isHub) {
                        assignBadge.style.background = T.green;
                        assignBadge.textContent = 'Assigned';
                    }
                }
            });

            terminalSection.appendChild(chip);
        });
    }

    body.appendChild(nameInput);
    body.appendChild(roleRow);
    body.appendChild(ipPortGrid);
    body.appendChild(terminalSection);
    panel.appendChild(body);

    // ── 5. action bar ─────────────────────────────────────────────────
    const actionBar = document.createElement('div');
    actionBar.style.cssText = `
        display: flex; align-items: center; gap: 8px;
        padding: 12px 16px; background: ${T.well};
        border-top: 1px solid ${T.border};
    `;

    const saveBtn = buildPillButton('SAVE', T.greenUp, T.bg, async () => {
        const newName = nameInput.value.trim();
        const newIp   = ipInput.value.trim();
        const newPort = portInput.value.trim();
        if (!newName) { showToast('Name is required', 'error'); return; }

        try {
            const res = await fetch('/api/v1/hardware/devices', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    mac:          printer.mac,
                    name:         newName,
                    type:         currentRole,
                    ip:           newIp,
                    port:         parseInt(newPort, 10) || 9100,
                    terminal_ids: currentRole === 'receipt' ? [...selectedIds] : [],
                }),
            });
            if (!res.ok) {
                const err = await res.json().catch(() => ({}));
                showToast(err.message || 'Failed to save printer', 'error');
                return;
            }
            _state.editingPrinterId = null;
            await loadData();
            rebuild();
            showToast('Printer updated');
        } catch (e) {
            showToast(`Failed to update printer: ${e.message}`, 'error');
        }
    });

    const testPrintBtn = buildPillButton('TEST PRINT', T.elec, T.bg, async () => {
        try {
            const resp = await fetchWithTimeout('/api/v1/hardware/test-print', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ ip: ipInput.value.trim(), port: parseInt(portInput.value.trim(), 10) || 9100 }),
            });
            if (resp.ok) {
                showToast('Test print sent');
            } else {
                showToast('Test print failed', 'error');
            }
        } catch (e) {
            showToast(`Test error: ${e.message}`, 'error');
        }
    });

    const spacer = document.createElement('div');
    spacer.style.cssText = `flex: 1;`;

    const cancelBtn = buildGhostButton('CANCEL', T.textMuted, () => {
        _state.editingPrinterId = null;
        rebuild();
    });

    actionBar.appendChild(saveBtn);
    actionBar.appendChild(testPrintBtn);
    actionBar.appendChild(spacer);
    actionBar.appendChild(cancelBtn);
    panel.appendChild(actionBar);

    applyToggleState();

    return panel;
};

const buildPrintersTab = () => {
    const container = document.createElement('div');
    container.style.cssText = `
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
        gap: 16px;
    `;

    if (_state.editingPrinterId) {
        const printer = _state.printers.find(p => p.mac === _state.editingPrinterId);
        if (printer) {
            container.appendChild(buildPrinterEditPanel(printer));
        }
    }

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

const buildCardReaderEditPanel = (reader) => {
    const inputCss = `
        background: ${T.card}; border: 1px solid ${T.border};
        color: ${T.text}; padding: 8px; border-radius: 4px;
        font-family: ${T.fb}; font-size: 12px; width: 100%; box-sizing: border-box;
    `;

    const panel = document.createElement('div');
    panel.style.cssText = `
        background: ${T.well}; border: 1px solid ${T.border};
        border-radius: 8px; margin-bottom: 16px;
        display: flex; flex-direction: column; gap: 0;
        overflow: hidden; grid-column: 1 / -1;
    `;

    // ── 1. header ─────────────────────────────────────────────────────
    const header = document.createElement('div');
    header.style.cssText = `
        display: flex; align-items: center; gap: 10px;
        padding: 12px 16px; border-bottom: 1px solid ${T.border};
    `;
    const headerTitle = document.createElement('div');
    headerTitle.style.cssText = `
        font-family: ${T.fh}; font-size: 13px; font-weight: 700;
        color: ${T.green}; flex: 1; letter-spacing: 0.04em;
    `;
    headerTitle.textContent = 'EDIT CARD READER';
    const badge = document.createElement('span');
    badge.style.cssText = `
        background: ${T.green}; color: ${T.bg}; padding: 2px 8px;
        border-radius: 3px; font-size: 8px; font-weight: 700;
        text-transform: uppercase; letter-spacing: 0.08em;
    `;
    badge.textContent = 'CARD READER';
    header.appendChild(headerTitle);
    header.appendChild(badge);
    panel.appendChild(header);

    // ── 2. MAC strip (read-only) ───────────────────────────────────────
    const macStrip = document.createElement('div');
    macStrip.style.cssText = `
        display: flex; align-items: center; gap: 10px;
        padding: 8px 16px; background: ${T.well};
        border-bottom: 1px solid ${T.border};
        font-family: 'Share Tech Mono', monospace; font-size: 11px;
    `;
    const macLabel = document.createElement('span');
    macLabel.style.cssText = `color: ${T.textMuted};`;
    macLabel.textContent = 'MAC';
    const macValue = document.createElement('span');
    macValue.style.cssText = `color: ${T.text}; letter-spacing: 0.06em; flex: 1;`;
    macValue.textContent = reader.mac || '—';
    const lockIcon = document.createElement('span');
    lockIcon.textContent = '🔒';
    lockIcon.style.cssText = `font-size: 10px;`;
    const idChip = document.createElement('span');
    idChip.style.cssText = `
        background: ${withAlpha(T.textMuted, 0.15)}; color: ${T.textMuted};
        padding: 1px 6px; border-radius: 3px; font-size: 9px; letter-spacing: 0.06em;
    `;
    idChip.textContent = 'Identity Key';
    macStrip.appendChild(macLabel);
    macStrip.appendChild(macValue);
    macStrip.appendChild(lockIcon);
    macStrip.appendChild(idChip);
    panel.appendChild(macStrip);

    // ── 3. form body ──────────────────────────────────────────────────
    const body = document.createElement('div');
    body.style.cssText = `padding: 16px; display: flex; flex-direction: column; gap: 12px;`;

    const nameInput = document.createElement('input');
    nameInput.type = 'text';
    nameInput.placeholder = 'Card Reader Name';
    nameInput.value = reader.name || '';
    nameInput.style.cssText = inputCss;

    const ipPortGrid = document.createElement('div');
    ipPortGrid.style.cssText = `display: grid; grid-template-columns: 1fr 1fr; gap: 8px;`;

    const ipInput = document.createElement('input');
    ipInput.type = 'text';
    ipInput.placeholder = 'IP Address';
    ipInput.value = reader.ip || '';
    ipInput.style.cssText = inputCss;

    const portInput = document.createElement('input');
    portInput.type = 'text';
    portInput.placeholder = 'Port';
    portInput.value = String(reader.port || 9000);
    portInput.style.cssText = inputCss;

    ipPortGrid.appendChild(ipInput);
    ipPortGrid.appendChild(portInput);

    const registerInput = document.createElement('input');
    registerInput.type = 'text';
    registerInput.placeholder = 'e.g. REG-001';
    registerInput.value = reader.register_id || '';
    registerInput.style.cssText = inputCss;

    const registerLabel = document.createElement('div');
    registerLabel.style.cssText = `display: flex; flex-direction: column; gap: 4px;`;
    const registerLabelText = document.createElement('div');
    registerLabelText.style.cssText = `
        font-size: 10px; font-weight: 700; text-transform: uppercase;
        letter-spacing: 0.08em; color: ${T.textMuted}; font-family: ${T.fb};
    `;
    registerLabelText.textContent = 'SPIn Register ID';
    registerLabel.appendChild(registerLabelText);
    registerLabel.appendChild(registerInput);

    body.appendChild(nameInput);
    body.appendChild(ipPortGrid);
    body.appendChild(registerLabel);
    panel.appendChild(body);

    // ── 4. action bar ─────────────────────────────────────────────────
    const actionBar = document.createElement('div');
    actionBar.style.cssText = `
        display: flex; align-items: center; gap: 8px;
        padding: 12px 16px; background: ${T.well};
        border-top: 1px solid ${T.border};
    `;

    const saveBtn = buildPillButton('SAVE', T.greenUp, T.bg, async () => {
        const newName = nameInput.value.trim();
        if (!newName) { showToast('Name is required', 'error'); return; }
        try {
            const res = await fetch('/api/v1/hardware/devices', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    mac:         reader.mac,
                    name:        newName,
                    type:        'card_reader',
                    ip:          ipInput.value.trim(),
                    port:        parseInt(portInput.value.trim(), 10) || 9000,
                    register_id: registerInput.value.trim() || null,
                }),
            });
            if (!res.ok) {
                const err = await res.json().catch(() => ({}));
                showToast(err.message || 'Failed to save card reader', 'error');
                return;
            }
            _state.editingReaderId = null;
            await loadData();
            rebuild();
            showToast('Card reader updated');
        } catch (e) {
            showToast(`Failed to update card reader: ${e.message}`, 'error');
        }
    });

    const pingBtn = buildPillButton('PING', T.elec, T.bg, async () => {
        try {
            const resp = await fetchWithTimeout('/api/v1/hardware/test-connection', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    ip: ipInput.value.trim(),
                    port: parseInt(portInput.value.trim(), 10) || 9000,
                }),
            }, 5000);
            if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
            const r = await resp.json();
            if (r.status === 'online') {
                showToast(`${ipInput.value.trim()} is reachable`, 'success');
            } else {
                showToast(`${ipInput.value.trim()} is unreachable`, 'warn');
            }
        } catch (e) {
            showToast(`Ping failed: ${e.message}`, 'error');
        }
    });

    const removeBtn = buildPillButton('REMOVE', T.verm, T.bg, async () => {
        if (!confirm(`Remove card reader ${reader.name}?`)) return;
        try {
            const res = await fetch(`/api/v1/hardware/devices/${reader.mac}`, { method: 'DELETE' });
            if (!res.ok) { showToast('Failed to remove card reader', 'error'); return; }
            _state.editingReaderId = null;
            await loadData();
            rebuild();
            showToast('Card reader removed');
        } catch (e) {
            showToast(`Remove failed: ${e.message}`, 'error');
        }
    });

    const spacer = document.createElement('div');
    spacer.style.cssText = `flex: 1;`;

    const cancelBtn = buildGhostButton('CANCEL', T.textMuted, () => {
        _state.editingReaderId = null;
        rebuild();
    });

    actionBar.appendChild(saveBtn);
    actionBar.appendChild(pingBtn);
    actionBar.appendChild(removeBtn);
    actionBar.appendChild(spacer);
    actionBar.appendChild(cancelBtn);
    panel.appendChild(actionBar);

    return panel;
};

const buildCardReadersTab = () => {
    const container = document.createElement('div');
    container.style.cssText = `
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
        gap: 16px;
    `;

    if (_state.editingReaderId) {
        const reader = _state.cardReaders.find(r => r.mac === _state.editingReaderId);
        if (reader) {
            container.appendChild(buildCardReaderEditPanel(reader));
        }
    }

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

/* ─── LICENSES TAB ────────────────────────────────────────────── */
const LICENSE_STATUS_COLOR = {
    pending:  T.gold,
    active:   T.mint,
    revoked:  T.textMuted,
};

const buildStatusBadge = (status) => {
    const fill = LICENSE_STATUS_COLOR[status] || T.textMuted;
    const badge = document.createElement('span');
    badge.style.cssText = `
        background: ${fill}; color: ${T.bg};
        padding: 2px 8px; border-radius: 3px; font-size: 9px;
        font-weight: 700; text-transform: uppercase; letter-spacing: 0.08em;
        font-family: ${T.fb};
    `;
    badge.textContent = status || 'unknown';
    return badge;
};

const buildPlatformBadge = (platform) => {
    const label = platform === 'windows' ? 'WIN' : (platform === 'pi' ? 'PI' : '—');
    const fill = platform === 'windows' ? T.cyan : (platform === 'pi' ? T.green : T.textMuted);
    const badge = document.createElement('span');
    badge.style.cssText = `
        background: ${withAlpha(fill, 0.18)}; color: ${fill};
        padding: 2px 8px; border-radius: 3px; font-size: 9px;
        font-weight: 700; letter-spacing: 0.08em; font-family: ${T.fb};
        border: 1px solid ${withAlpha(fill, 0.4)};
    `;
    badge.textContent = label;
    return badge;
};

const buildLicenseRow = (lic) => {
    const isRevoked = lic.status === 'revoked';

    const row = document.createElement('div');
    row.style.cssText = `
        display: grid;
        grid-template-columns: 2fr 70px 90px 1.4fr 1.2fr auto;
        gap: 12px; align-items: center;
        padding: 12px 14px; background: ${T.card};
        border: 1px solid ${T.border}; border-radius: 6px;
        opacity: ${isRevoked ? '0.55' : '1'};
    `;

    const labelEl = document.createElement('div');
    labelEl.style.cssText = `
        color: ${T.text}; font-family: ${T.fb}; font-size: 13px; font-weight: 600;
    `;
    labelEl.textContent = lic.label || '(unlabeled)';

    const platformCell = document.createElement('div');
    platformCell.appendChild(buildPlatformBadge(lic.platform));

    const statusCell = document.createElement('div');
    statusCell.appendChild(buildStatusBadge(lic.status));

    const codeEl = document.createElement('div');
    codeEl.style.cssText = `
        font-family: 'Share Tech Mono', monospace; font-size: 12px;
        color: ${isRevoked ? T.textMuted : T.gold};
        letter-spacing: 0.08em;
        ${isRevoked ? 'text-decoration: line-through;' : ''}
        user-select: all;
    `;
    codeEl.textContent = lic.activation_code;

    const activatedEl = document.createElement('div');
    activatedEl.style.cssText = `
        font-family: 'Share Tech Mono', monospace; font-size: 11px;
        color: ${T.textMuted};
    `;
    if (lic.activated_at) {
        const d = new Date(lic.activated_at);
        activatedEl.textContent = isNaN(d.getTime())
            ? lic.activated_at
            : d.toLocaleString();
    } else {
        activatedEl.textContent = 'Pending';
    }

    const actions = document.createElement('div');
    actions.style.cssText = `display: flex; gap: 6px; justify-content: flex-end;`;

    if (!isRevoked) {
        const revokeBtn = buildGhostButton('REVOKE', T.verm, async () => {
            if (!confirm(`Revoke license ${lic.activation_code}?\n\nThis cannot be undone.`)) return;
            try {
                const resp = await fetchWithTimeout(
                    `/api/v1/hardware/license/${encodeURIComponent(lic.activation_code)}`,
                    { method: 'DELETE' }
                );
                if (!resp.ok) {
                    const err = await resp.json().catch(() => ({}));
                    showToast(err.detail || `Revoke failed (HTTP ${resp.status})`, 'error');
                    return;
                }
                await loadData();
                rebuild();
                showToast('License revoked');
            } catch (e) {
                showToast(`Revoke failed: ${e.message}`, 'error');
            }
        });
        actions.appendChild(revokeBtn);
    }

    row.appendChild(labelEl);
    row.appendChild(platformCell);
    row.appendChild(statusCell);
    row.appendChild(codeEl);
    row.appendChild(activatedEl);
    row.appendChild(actions);

    return row;
};

const buildLicensesTab = () => {
    const container = document.createElement('div');
    container.style.cssText = `display: flex; flex-direction: column; gap: 16px;`;

    if (_state.licenses.length === 0) {
        const empty = document.createElement('div');
        empty.style.cssText = `
            padding: 24px; text-align: center;
            color: ${T.textMuted}; font-family: 'Share Tech Mono', monospace;
            font-size: 12px;
            border: 1px dashed ${T.border}; border-radius: 8px;
        `;
        empty.textContent = 'Contact kind.pos to purchase a license — kindpos.com';
        container.appendChild(empty);
        return container;
    }

    // Header row
    const header = document.createElement('div');
    header.style.cssText = `
        display: grid;
        grid-template-columns: 2fr 70px 90px 1.4fr 1.2fr auto;
        gap: 12px; padding: 0 14px;
        font-family: ${T.fh}; font-size: 10px; font-weight: 700;
        color: ${T.textMuted}; letter-spacing: 0.1em; text-transform: uppercase;
    `;
    ['Label', 'Platform', 'Status', 'Activation Code', 'Activated', ''].forEach(h => {
        const cell = document.createElement('div');
        cell.textContent = h;
        header.appendChild(cell);
    });
    container.appendChild(header);

    const list = document.createElement('div');
    list.style.cssText = `display: flex; flex-direction: column; gap: 8px;`;
    _state.licenses.forEach(lic => list.appendChild(buildLicenseRow(lic)));
    container.appendChild(list);

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
        { id: 'licenses', label: `LICENSES (${_state.licenses.length})` },
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

/* ─── DIAGRAM: hub builders ─────────────────────────────────────
   Scaffold for the Hardware & Network hub visual. Read-only static
   layout sourced from _state; no SVG routing lines and no tap
   interactions yet (added in later chunks).
   ─────────────────────────────────────────────────────────────── */

const buildTerminalDiagramCard = (term, index) => {
    const online = term.is_active === 1 || term.is_active === true;
    const palette = getTerminalColor(index);
    const accent = online ? palette.color : T.verm;
    const nameColor = online ? palette.color : T.border;

    const card = document.createElement('div');
    card.setAttribute('data-terminal-id', term.terminal_id || '');
    card.setAttribute('data-terminal-index', String(index));
    card.style.cssText = `
        position: relative;
        background: ${T.card};
        border: 2px solid ${online ? T.border : withAlpha(T.text, 0.04)};
        border-radius: 8px;
        padding: 12px 8px 10px;
        display: flex; flex-direction: column; align-items: center;
        cursor: pointer;
        overflow: hidden;
        min-height: 92px;
    `;

    const accentBar = document.createElement('div');
    accentBar.style.cssText = `
        position: absolute; top: 0; left: 0; right: 0;
        height: 3px; background: ${accent};
    `;
    card.appendChild(accentBar);

    const dot = document.createElement('div');
    dot.style.cssText = `
        width: 8px; height: 8px; border-radius: 50%;
        background: ${online ? palette.color : T.border};
        margin-bottom: 6px;
    `;
    card.appendChild(dot);

    const name = document.createElement('div');
    name.textContent = term.name || term.terminal_id || 'Terminal';
    name.style.cssText = `
        font-family: ${T.fh};
        font-size: 18px;
        font-weight: 700;
        color: ${nameColor};
        text-align: center;
        line-height: 1.1;
        max-width: 100%;
        overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    `;
    card.appendChild(name);

    const subtitle = document.createElement('div');
    subtitle.textContent = term.mac_address || term.ip_address || '';
    subtitle.style.cssText = `
        font-family: ${T.fb};
        font-size: 9px;
        color: ${T.border};
        text-align: center;
        margin-top: 2px;
        max-width: 100%;
        overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    `;
    card.appendChild(subtitle);

    const badge = document.createElement('div');
    badge.textContent = (term.role || 'terminal').toUpperCase();
    badge.style.cssText = `
        margin-top: 6px;
        padding: 2px 8px;
        border-radius: 999px;
        font-family: ${T.fb};
        font-size: 8px;
        font-weight: 700;
        letter-spacing: 0.08em;
        background: ${online ? palette.color : T.border};
        color: ${T.well};
    `;
    card.appendChild(badge);

    return card;
};

// Type → accent color. `card` is the diagram's logical group name for
// card readers; devices themselves live under type='card_reader'.
const _miniAccentForType = (type) => {
    if (type === 'kitchen') return T.verm;
    if (type === 'receipt') return T.elec;
    if (type === 'card')    return T.greenUp;
    return T.border;
};

const buildDeviceMiniCard = (device, type) => {
    const card = document.createElement('div');

    if (!device) {
        card.setAttribute('data-device-id', 'unassigned');
        card.setAttribute('data-device-type', type);
        card.style.cssText = `
            min-width: 78px;
            padding: 8px 6px;
            background: ${T.well};
            border: 1.5px dashed ${T.border};
            border-radius: 6px;
            display: flex; align-items: center; justify-content: center;
            opacity: 0.4;
            color: ${T.border};
            font-family: ${T.fb};
            font-size: 14px;
        `;
        card.textContent = '—';
        return card;
    }

    const accent = _miniAccentForType(type);
    card.setAttribute('data-device-id', device.mac || '');
    card.setAttribute('data-device-type', type);
    card.style.cssText = `
        position: relative;
        min-width: 78px;
        padding: 8px 6px;
        background: ${T.well};
        border: 1.5px solid ${T.border};
        border-radius: 6px;
        display: flex; flex-direction: column; align-items: center;
        overflow: hidden;
    `;

    const accentBar = document.createElement('div');
    accentBar.style.cssText = `
        position: absolute; top: 0; left: 0; right: 0;
        height: 2px; background: ${accent};
    `;
    card.appendChild(accentBar);

    const typeLabel = document.createElement('div');
    typeLabel.textContent = type.toUpperCase();
    typeLabel.style.cssText = `
        font-family: ${T.fb};
        font-size: 7px;
        font-weight: 700;
        letter-spacing: 0.12em;
        color: ${accent};
        margin-top: 4px;
    `;
    card.appendChild(typeLabel);

    const name = document.createElement('div');
    name.textContent = device.name || 'Unnamed';
    name.style.cssText = `
        font-family: ${T.fb};
        font-size: 10px;
        font-weight: 700;
        color: ${T.text};
        text-align: center;
        margin-top: 2px;
        max-width: 100%;
        overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    `;
    card.appendChild(name);

    const sub = document.createElement('div');
    sub.textContent = device.ip || '';
    sub.style.cssText = `
        font-family: ${T.fb};
        font-size: 8px;
        color: ${T.border};
        text-align: center;
        margin-top: 1px;
    `;
    card.appendChild(sub);

    return card;
};

const buildDeviceGroupCard = (title, devices, type) => {
    const group = document.createElement('div');
    group.setAttribute('data-group-type', type);
    group.style.cssText = `
        background: ${T.card};
        border: 2px solid ${T.border};
        border-radius: 10px;
        padding: 14px;
        min-height: 120px;
        display: flex; flex-direction: column;
    `;

    const titleEl = document.createElement('div');
    titleEl.textContent = title;
    titleEl.style.cssText = `
        font-family: ${T.fh};
        font-size: 15px;
        font-weight: 700;
        color: ${T.text};
        margin-bottom: 10px;
    `;
    group.appendChild(titleEl);

    if (!devices || devices.length === 0) {
        const empty = document.createElement('div');
        empty.textContent = `No ${title.toLowerCase()} configured`;
        empty.style.cssText = `
            flex: 1;
            display: flex; align-items: center; justify-content: center;
            font-family: ${T.fb};
            font-size: 10px;
            color: ${T.border};
            text-align: center;
        `;
        group.appendChild(empty);
        return group;
    }

    const row = document.createElement('div');
    row.style.cssText = `display: flex; gap: 6px; flex-wrap: wrap;`;
    for (const d of devices) {
        row.appendChild(buildDeviceMiniCard(d, type));
    }
    group.appendChild(row);
    return group;
};

// Dashed "+ Pair New" terminal-row slot.
const _buildPairTerminalSlot = () => {
    const slot = document.createElement('div');
    slot.style.cssText = `
        background: ${T.card};
        border: 2px dashed ${T.border};
        border-radius: 8px;
        padding: 12px 8px 10px;
        display: flex; align-items: center; justify-content: center;
        cursor: pointer;
        font-family: ${T.fb};
        font-size: 11px;
        font-weight: 700;
        letter-spacing: 0.1em;
        text-transform: uppercase;
        color: ${T.textMuted};
        opacity: 0.7;
        min-height: 92px;
    `;
    slot.textContent = '+ Pair New';
    return slot;
};

// Dashed "+ Add Device" device-grid slot.
const _buildAddDeviceSlot = () => {
    const slot = document.createElement('div');
    slot.style.cssText = `
        background: ${T.card};
        border: 2px dashed ${T.border};
        border-radius: 10px;
        min-height: 120px;
        display: flex; align-items: center; justify-content: center;
        cursor: pointer;
        font-family: ${T.fb};
        font-size: 11px;
        font-weight: 700;
        letter-spacing: 0.1em;
        text-transform: uppercase;
        color: ${T.textMuted};
        opacity: 0.7;
    `;
    slot.textContent = '+ Add Device';
    return slot;
};

const buildHardwareHub = () => {
    const wrapper = document.createElement('div');
    wrapper.setAttribute('data-hardware-hub', '');
    wrapper.style.cssText = `position: relative; margin-bottom: 16px;`;

    // Terminal row
    const termRow = document.createElement('div');
    termRow.style.cssText = `
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(120px, 1fr));
        gap: 8px;
    `;
    (_state.terminals || []).forEach((t, i) => {
        termRow.appendChild(buildTerminalDiagramCard(t, i));
    });
    termRow.appendChild(_buildPairTerminalSlot());
    wrapper.appendChild(termRow);

    // Routing gap (SVG routing lines will mount inside in a later chunk)
    const gap = document.createElement('div');
    gap.setAttribute('data-hub-gap', '');
    gap.style.cssText = `height: 48px; position: relative;`;
    wrapper.appendChild(gap);

    // Device-group 2×2 grid
    const kitchenPrinters = (_state.printers || []).filter(p =>
        p.role === 'kitchen' || p.type === 'kitchen' || p.type === 'impact'
    );
    const receiptPrinters = (_state.printers || []).filter(p =>
        p.role === 'receipt' || p.type === 'receipt' || p.type === 'thermal'
    );

    const deviceGrid = document.createElement('div');
    deviceGrid.style.cssText = `
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 10px;
    `;
    deviceGrid.appendChild(buildDeviceGroupCard('Kitchen Printers', kitchenPrinters, 'kitchen'));
    deviceGrid.appendChild(buildDeviceGroupCard('Receipt Printers', receiptPrinters, 'receipt'));
    deviceGrid.appendChild(buildDeviceGroupCard('Card Readers', _state.cardReaders || [], 'card'));
    deviceGrid.appendChild(_buildAddDeviceSlot());
    wrapper.appendChild(deviceGrid);

    return wrapper;
};

const _buildHubDivider = () => {
    const hr = document.createElement('hr');
    hr.style.cssText = `
        border: none;
        border-top: 1px solid ${T.border};
        margin: 16px 0;
    `;
    return hr;
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

    main.appendChild(buildHardwareHub());
    main.appendChild(_buildHubDivider());

    main.appendChild(buildTabBar());

    let tabContent;
    if (_state.activeTab === 'terminals') {
        tabContent = buildTerminalsTab();
    } else if (_state.activeTab === 'printers') {
        tabContent = buildPrintersTab();
    } else if (_state.activeTab === 'licenses') {
        tabContent = buildLicensesTab();
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
