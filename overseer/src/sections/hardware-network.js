/* ============================================
   KINDpos Overseer — Hardware & Network Hub
   Terminal Registration & Device Config
   ============================================ */

import { pushChanges } from '../services/config-push.js';
import { fetchWithTimeout } from '../services/http.js';
import { T, withAlpha } from '../ui/tokens.js';
import {
    field, numberField, checkboxChip, chipGroup,
    button, openModal, showToast,
} from '../ui/forms.js';
import {
    startScan,
    buildTerminalAssignmentChips,
    openSaveDeviceDialog,
} from '../hardware/shared.js';

/* ─── TERMINAL COLORS ──────────────────────────────────────────── */
const TERM_COLORS = [T.greenUp, T.cyan, T.gold, T.verm, T.lavender];

const getTerminalColor = (terminalId) => {
    let idx;
    const tMatch = /^T-(\d+)$/.exec(terminalId || '');
    if (tMatch) {
        idx = parseInt(tMatch[1], 10) - 1;
    } else {
        idx = _state.terminals.findIndex(t => t.terminal_id === terminalId);
        if (idx < 0) idx = 0;
    }
    return TERM_COLORS[Math.max(0, idx % TERM_COLORS.length)];
};

/* ─── STATE ───────────────────────────────────────────────────── */
let _state = {
    terminals: [],
    printers: [],
    cardReaders: [],
    routingRules: {},
    connectionMap: {},
    activeTerminalId: null,
    isScanning: false,
    discoveredDevices: [],
    scanEventSource: null,
    container: null,
    lastSyncTime: null,
};

const resetState = () => {
    _state = {
        terminals: [],
        printers: [],
        cardReaders: [],
        routingRules: {},
        connectionMap: {},
        activeTerminalId: null,
        isScanning: false,
        discoveredDevices: [],
        scanEventSource: null,
        container: null,
        lastSyncTime: null,
    };
};

/* ─── FETCH & LOAD ───────────────────────────────────────────── */
const loadData = async () => {
    try {
        const [devicesResp, terminalsResp, routingResp] = await Promise.all([
            fetchWithTimeout('/api/v1/hardware/devices'),
            fetchWithTimeout('/api/v1/hardware/terminals'),
            fetchWithTimeout('/api/v1/hardware/routing'),
        ]);

        if (devicesResp.ok) {
            const devices = await devicesResp.json();
            _state.printers = devices.filter(d =>
                d.type === 'printer' || d.type === 'kitchen' || d.type === 'receipt' ||
                d.type === 'thermal' || d.type === 'impact'
            ) || [];
            _state.cardReaders = devices.filter(d => d.type === 'card_reader') || [];
        }

        if (terminalsResp.ok) {
            _state.terminals = await terminalsResp.json() || [];
        }

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

        _state.connectionMap = buildConnectionMap(
            _state.terminals,
            _state.printers,
            _state.cardReaders,
            _state.routingRules
        );

        _state.lastSyncTime = new Date().toLocaleTimeString([], {
            hour: '2-digit',
            minute: '2-digit',
            hour12: false,
        });
    } catch (e) {
        showToast(`Failed to load hardware data: ${e.message}`, 'error');
        console.error('[HardwareNetwork] Load error:', e);
    }
};

/* ─── CONNECTION MAP ───────────────────────────────────────────── */
function buildConnectionMap(terminals, printers, cardReaders, routingRules) {
    const map = {};
    for (const term of terminals) {
        map[term.terminal_id] = { kitchen: [], receipt: [], card: [] };

        for (const p of printers) {
            if (p.role === 'kitchen') {
                const rule = routingRules[p.mac];
                if (!rule || rule[0]?.rule_type === 'all') {
                    map[term.terminal_id].kitchen.push(p.mac);
                }
            }
            if (p.role === 'receipt' && p.terminal_ids?.includes(term.terminal_id)) {
                map[term.terminal_id].receipt.push(p.mac);
            }
        }

        for (const reader of (term.devices?.readers || [])) {
            map[term.terminal_id].card.push(reader.mac || reader);
        }
    }
    return map;
}

/* ─── MODALS ────────────────────────────────────────────────────── */
const openTerminalModal = (terminal, onSaved) => {
    const isEdit = !!terminal;
    const content = document.createElement('div');
    content.style.cssText = `display: flex; flex-direction: column; gap: 16px;`;

    const nameF = field({
        label: 'Name',
        id: 'hwn-term-name',
        value: terminal?.name || '',
        placeholder: 'Front Register',
        required: true,
    });

    const ROLES = [
        { id: 'register', label: 'Register' },
        { id: 'kitchen', label: 'Kitchen' },
        { id: 'bar', label: 'Bar' },
        { id: 'manager', label: 'Manager' },
        { id: 'expo', label: 'Expo' },
    ];

    const roleChips = chipGroup({
        options: ROLES,
        selected: [terminal?.role || 'register'],
        mode: 'single',
    });

    const trainingChip = checkboxChip({
        label: 'Training Mode',
        checked: terminal?.training_mode || false,
    });

    content.appendChild(nameF.wrap);
    content.appendChild(document.createElement('div'));
    content.lastChild.textContent = 'Role';
    content.lastChild.style.cssText = `font-size: 14px; color: ${T.textMuted}; font-weight: 600;`;
    content.appendChild(roleChips.wrap);
    content.appendChild(trainingChip.wrap);

    let modalRef = null;
    const saveBtn = button({
        label: isEdit ? 'Save' : 'Add Terminal',
        variant: 'primary',
        onClick: async () => {
            const name = nameF.input.value.trim();
            const role = roleChips.getSelected()[0] || 'register';
            const training = trainingChip.input.checked;

            if (!name) {
                showToast('Name is required', 'error');
                return;
            }

            saveBtn.disabled = true;

            try {
                const result = await pushChanges([{
                    event_type: isEdit ? 'terminal.updated' : 'terminal.registered',
                    payload: {
                        terminal_id: terminal?.terminal_id,
                        name,
                        role,
                        training_mode: training,
                    },
                }]);
                if (!result.ok) throw new Error('Push failed');
                showToast(`Terminal ${isEdit ? 'updated' : 'added'}`);
                modalRef.close();
                onSaved();
            } catch (e) {
                showToast('Failed to save terminal', 'error');
                saveBtn.disabled = false;
            }
        },
    });

    modalRef = openModal({
        title: isEdit ? `Edit ${terminal.name}` : 'Add Terminal',
        content,
        footer: [
            button({ label: 'Cancel', variant: 'ghost', onClick: () => modalRef.close() }),
            saveBtn,
        ],
        width: 480,
    });
};

const openDeviceModal = (device, deviceType, onSaved) => {
    const isEdit = !!device;
    const content = document.createElement('div');
    content.style.cssText = `display: flex; flex-direction: column; gap: 16px;`;

    const nameF = field({
        label: 'Name',
        id: 'hwn-dev-name',
        value: device?.name || '',
        placeholder: deviceType === 'printer' ? 'Kitchen Printer' : 'Card Reader',
    });

    const ipF = field({
        label: 'IP Address',
        id: 'hwn-dev-ip',
        value: device?.ip || '',
        placeholder: '10.0.0.x',
    });

    const portF = numberField({
        label: 'Port',
        id: 'hwn-dev-port',
        value: device?.port || 9100,
    });

    content.appendChild(nameF.wrap);
    content.appendChild(ipF.wrap);
    content.appendChild(portF.wrap);

    // ── Role chip group ──────────────────────────────────────────
    const ROLE_OPTIONS = [
        { id: 'receipt',     label: 'Receipt' },
        { id: 'kitchen',     label: 'Kitchen' },
        { id: 'card_reader', label: 'Card Reader' },
    ];

    let currentRole;
    if (device?.role === 'receipt' || device?.role === 'kitchen' || device?.role === 'card_reader') {
        currentRole = device.role;
    } else if (device?.type === 'card_reader') {
        currentRole = 'card_reader';
    } else {
        currentRole = 'receipt';
    }

    const roleLabel = document.createElement('div');
    roleLabel.textContent = 'Role';
    roleLabel.style.cssText = `font-size: 14px; color: ${T.textMuted}; font-weight: 600;`;
    content.appendChild(roleLabel);

    const roleChips = chipGroup({
        options: ROLE_OPTIONS,
        selected: [currentRole],
        mode: 'single',
    });
    content.appendChild(roleChips.wrap);

    // ── Terminal assignment (receipt + card_reader) ──────────────
    const selectedTerminalIds = new Set(
        Array.isArray(device?.terminal_ids) ? device.terminal_ids : []
    );

    const termSection = document.createElement('div');
    termSection.style.cssText = `display: flex; flex-direction: column; gap: 8px;`;
    const termSectionLabel = document.createElement('div');
    termSectionLabel.textContent = 'Assigned Terminals';
    termSectionLabel.style.cssText = `font-size: 14px; color: ${T.textMuted}; font-weight: 600;`;
    termSection.appendChild(termSectionLabel);
    const termChips = buildTerminalAssignmentChips(
        _state.terminals,
        selectedTerminalIds,
        () => { /* set mutated in place */ }
    );
    termSection.appendChild(termChips);
    content.appendChild(termSection);

    // ── Categories (kitchen) ─────────────────────────────────────
    const catF = field({
        label: 'Categories (comma-separated; blank = ALL)',
        id: 'hwn-dev-cats',
        value: (device?.categories === 'ALL' ? '' : (device?.categories || '')),
        placeholder: 'apps, entrees',
    });
    content.appendChild(catF.wrap);

    // ── register_id (card_reader) ────────────────────────────────
    const regF = field({
        label: 'SPIn Register ID',
        id: 'hwn-dev-reg',
        value: device?.register_id || '',
        placeholder: 'REG-001',
    });
    content.appendChild(regF.wrap);

    // ── Show/hide conditional sections based on role ─────────────
    const refreshConditional = () => {
        termSection.style.display =
            (currentRole === 'receipt' || currentRole === 'card_reader') ? 'flex' : 'none';
        catF.wrap.style.display = (currentRole === 'kitchen') ? '' : 'none';
        regF.wrap.style.display = (currentRole === 'card_reader') ? '' : 'none';
    };
    refreshConditional();

    // chipGroup mutates its internal state on click — poll after the click
    // bubbles to the wrapper to detect the new selection and refresh.
    roleChips.wrap.addEventListener('click', () => {
        const sel = roleChips.getSelected()[0];
        if (sel && sel !== currentRole) {
            currentRole = sel;
            refreshConditional();
        }
    });

    let modalRef = null;
    const saveBtn = button({
        label: 'Save',
        variant: 'primary',
        onClick: async () => {
            saveBtn.disabled = true;
            try {
                const res = await fetchWithTimeout('/api/v1/hardware/devices', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        mac: device?.mac,
                        name: nameF.input.value.trim(),
                        type: device?.type || deviceType,
                        ip: ipF.input.value.trim(),
                        port: parseInt(portF.input.value, 10) || 9100,
                        role: currentRole,
                        terminal_ids: [...selectedTerminalIds],
                        categories: catF.input.value.trim(),
                        register_id: regF.input.value.trim(),
                    }),
                });
                if (!res.ok) throw new Error(`HTTP ${res.status}`);
                showToast('Device saved');
                modalRef.close();
                onSaved();
            } catch (e) {
                showToast(`Failed to save device: ${e.message}`, 'error');
                saveBtn.disabled = false;
            }
        },
    });

    const deleteBtn = button({
        label: 'Delete',
        variant: 'danger',
        onClick: async () => {
            if (!confirm(`Delete ${device.name}?`)) return;
            try {
                const res = await fetchWithTimeout(`/api/v1/hardware/devices/${device.mac}`, {
                    method: 'DELETE',
                });
                if (!res.ok) throw new Error(`HTTP ${res.status}`);
                showToast('Device deleted');
                modalRef.close();
                onSaved();
            } catch (e) {
                showToast(`Failed to delete device: ${e.message}`, 'error');
            }
        },
    });

    modalRef = openModal({
        title: `Edit ${device?.name || 'Device'}`,
        content,
        footer: [
            button({ label: 'Cancel', variant: 'ghost', onClick: () => modalRef.close() }),
            deleteBtn,
            saveBtn,
        ],
        width: 480,
    });
};

const openReceiptSettingsModal = async (onSaved) => {
    let storeData = {};
    try {
        const res = await fetchWithTimeout('/api/v1/config/store');
        if (res.ok) storeData = await res.json();
    } catch (e) {
        console.warn('[HardwareNetwork] Receipt load failed:', e);
    }

    const receipt = storeData.receipt_settings || {};
    const content = document.createElement('div');
    content.style.cssText = `display: flex; flex-direction: column; gap: 12px;`;

    const headerF = field({
        label: 'Header Text',
        id: 'hwn-receipt-header',
        value: storeData.receipt_header || '',
        placeholder: 'Thank you for visiting!',
    });

    const footerF = field({
        label: 'Footer Text',
        id: 'hwn-receipt-footer',
        value: storeData.receipt_footer || '',
        placeholder: 'Come back soon!',
    });

    const logoChip = checkboxChip({
        label: 'Print Logo',
        checked: receipt.print_logo !== false,
    });

    const customerChip = checkboxChip({
        label: 'Print Customer Copy',
        checked: receipt.print_customer_copy !== false,
    });

    const merchantChip = checkboxChip({
        label: 'Print Merchant Copy',
        checked: receipt.print_merchant_copy === true,
    });

    const itemizedChip = checkboxChip({
        label: 'Print Itemized Copy',
        checked: receipt.print_itemized_copy !== false,
    });

    const tip1F = numberField({
        label: 'Tip Suggestion 1 (%)',
        id: 'hwn-tip1',
        value: receipt.tip_suggestions?.[0] || 15,
    });

    const tip2F = numberField({
        label: 'Tip Suggestion 2 (%)',
        id: 'hwn-tip2',
        value: receipt.tip_suggestions?.[1] || 18,
    });

    const tip3F = numberField({
        label: 'Tip Suggestion 3 (%)',
        id: 'hwn-tip3',
        value: receipt.tip_suggestions?.[2] || 20,
    });

    content.appendChild(headerF.wrap);
    content.appendChild(footerF.wrap);
    content.appendChild(logoChip.wrap);
    content.appendChild(customerChip.wrap);
    content.appendChild(merchantChip.wrap);
    content.appendChild(itemizedChip.wrap);
    content.appendChild(tip1F.wrap);
    content.appendChild(tip2F.wrap);
    content.appendChild(tip3F.wrap);

    let modalRef = null;
    const saveBtn = button({
        label: 'Save Receipt Settings',
        variant: 'primary',
        onClick: async () => {
            saveBtn.disabled = true;
            try {
                const result = await pushChanges([{
                    event_type: 'store.info_updated',
                    payload: {
                        ...storeData.info,
                        receipt_header: headerF.input.value.trim(),
                        receipt_footer: footerF.input.value.trim(),
                        receipt_settings: {
                            print_logo: logoChip.input.checked,
                            print_customer_copy: customerChip.input.checked,
                            print_merchant_copy: merchantChip.input.checked,
                            print_itemized_copy: itemizedChip.input.checked,
                            tip_suggestions: [
                                parseInt(tip1F.input.value, 10) || 15,
                                parseInt(tip2F.input.value, 10) || 18,
                                parseInt(tip3F.input.value, 10) || 20,
                            ],
                            tip_calc_base: receipt.tip_calc_base || 'pretax',
                            language: receipt.language || 'en',
                        },
                    },
                }]);
                if (!result.ok) throw new Error('Push failed');
                showToast('Receipt settings saved');
                modalRef.close();
                onSaved();
            } catch (e) {
                showToast('Failed to save receipt settings', 'error');
                saveBtn.disabled = false;
            }
        },
    });

    modalRef = openModal({
        title: 'Receipt Settings',
        content,
        footer: [
            button({ label: 'Cancel', variant: 'ghost', onClick: () => modalRef.close() }),
            saveBtn,
        ],
        width: 520,
    });
};

/* ─── SVG LINE DRAWING ──────────────────────────────────────────── */
const buildSVG = (container) => {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.style.cssText = `
        position: absolute;
        inset: 0;
        pointer-events: none;
        overflow: visible;
        width: 100%;
        height: 100%;
    `;

    const busY = 180;

    for (const term of _state.terminals) {
        const termCard = container.querySelector(`[data-term-id="${term.terminal_id}"]`);
        if (!termCard) continue;

        const x1 = termCard.offsetLeft + termCard.offsetWidth / 2;
        const y1 = termCard.offsetTop + termCard.offsetHeight;

        const connections = _state.connectionMap[term.terminal_id] || {};
        const isActive = _state.activeTerminalId === term.terminal_id;
        const termColor = getTerminalColor(term.terminal_id);

        const drawLine = (targetEl) => {
            if (!targetEl) return;
            const x2 = targetEl.offsetLeft + targetEl.offsetWidth / 2;
            const y2 = targetEl.offsetTop;

            if (isActive) {
                const glow = document.createElementNS('http://www.w3.org/2000/svg', 'path');
                glow.setAttribute('d', `M${x1},${y1} V${busY} H${x2} V${y2}`);
                glow.style.cssText = `fill: none; stroke: ${termColor}; stroke-width: 7; opacity: 0.25; stroke-linecap: butt; stroke-linejoin: miter;`;
                svg.appendChild(glow);
            }

            const line = document.createElementNS('http://www.w3.org/2000/svg', 'path');
            line.setAttribute('d', `M${x1},${y1} V${busY} H${x2} V${y2}`);
            const strokeColor = isActive ? termColor : `rgba(90,95,102,0.15)`;
            const strokeWidth = isActive ? 2 : 1.2;
            line.style.cssText = `fill: none; stroke: ${strokeColor}; stroke-width: ${strokeWidth}; stroke-linecap: butt; stroke-linejoin: miter; transition: all 0.15s ease;`;
            svg.appendChild(line);
        };

        for (const pmac of connections.kitchen || []) {
            const groupEl = container.querySelector(`[data-device-group="kitchen"]`);
            if (groupEl) drawLine(groupEl);
        }

        for (const pmac of connections.receipt || []) {
            const devEl = container.querySelector(`[data-device-mac="${pmac}"]`);
            if (devEl) drawLine(devEl);
        }

        for (const rmac of connections.card || []) {
            const devEl = container.querySelector(`[data-device-mac="${rmac}"]`);
            if (devEl) drawLine(devEl);
        }
    }

    return svg;
};

/* ─── TERMINAL CARDS ───────────────────────────────────────────── */
const buildTerminalCard = (terminal) => {
    const card = document.createElement('div');
    const color = getTerminalColor(terminal.terminal_id);
    const isActive = _state.activeTerminalId === terminal.terminal_id;

    card.setAttribute('data-term-id', terminal.terminal_id);
    card.style.cssText = `
        flex: 1;
        min-width: 120px;
        padding: 16px;
        background: ${T.card};
        border: 2px solid ${isActive ? color : T.border};
        border-bottom: 3px solid ${color};
        border-radius: 8px;
        text-align: center;
        cursor: pointer;
        transition: all 0.15s ease;
        ${isActive ? `box-shadow: 0 0 12px ${withAlpha(color, 0.4)};` : ''}
    `;

    card.addEventListener('mouseenter', () => {
        if (!isActive) card.style.borderColor = withAlpha(color, 0.5);
    });
    card.addEventListener('mouseleave', () => {
        if (!isActive) card.style.borderColor = T.border;
    });

    const dot = document.createElement('div');
    dot.style.cssText = `
        width: 8px;
        height: 8px;
        border-radius: 50%;
        background: ${terminal.online ? T.greenWarm : T.verm};
        margin: 0 auto 8px;
    `;
    card.appendChild(dot);

    const id = document.createElement('div');
    id.style.cssText = `
        font-family: ${T.fb};
        font-size: 22px;
        font-weight: 700;
        color: ${isActive ? color : T.text};
        transition: color 0.15s ease;
    `;
    id.textContent = terminal.terminal_id;
    card.appendChild(id);

    const ip = document.createElement('div');
    ip.style.cssText = `
        font-size: 9px;
        color: ${T.textMuted};
        margin-top: 4px;
        font-family: ui-monospace, monospace;
    `;
    ip.textContent = terminal.online ? terminal.ip_address || '' : `Last seen ${terminal.lastSeen || '?'}`;
    card.appendChild(ip);

    const role = document.createElement('div');
    role.style.cssText = `
        font-size: 8px;
        color: ${isActive ? T.bg : T.textMuted};
        background: ${isActive ? color : T.card};
        padding: 2px 6px;
        border-radius: 3px;
        margin-top: 6px;
        display: inline-block;
        transition: all 0.15s ease;
    `;
    role.textContent = terminal.role?.toUpperCase() || 'REGISTER';
    card.appendChild(role);

    card.addEventListener('click', () => {
        if (_state.activeTerminalId === terminal.terminal_id) {
            _state.activeTerminalId = null;
        } else {
            _state.activeTerminalId = terminal.terminal_id;
        }
        rebuild();
    });

    card.addEventListener('dblclick', () => {
        openTerminalModal(terminal, () => {
            loadData().then(() => rebuild());
        });
    });

    return card;
};

/* ─── DEVICE CARDS ─────────────────────────────────────────────── */
const buildDeviceCard = (device, deviceType) => {
    const card = document.createElement('div');
    card.setAttribute('data-device-mac', device.mac);

    const accentColor = deviceType === 'printer'
        ? (device.role === 'kitchen' ? T.verm : T.cyan)
        : T.green;

    card.style.cssText = `
        padding: 12px;
        background: ${T.well};
        border: 1px solid ${T.border};
        border-top: 2px solid ${accentColor};
        border-radius: 6px;
        text-align: center;
        cursor: pointer;
        transition: all 0.15s ease;
    `;

    card.addEventListener('mouseenter', () => {
        card.style.borderColor = accentColor;
        card.style.boxShadow = `0 0 8px ${withAlpha(accentColor, 0.3)}`;
    });
    card.addEventListener('mouseleave', () => {
        card.style.borderColor = T.border;
        card.style.boxShadow = '';
    });

    const emoji = document.createElement('div');
    emoji.style.cssText = `font-size: 20px; margin-bottom: 4px;`;
    emoji.textContent = deviceType === 'printer' ? '🖨' : '💳';
    card.appendChild(emoji);

    const name = document.createElement('div');
    name.style.cssText = `
        font-size: 9px;
        font-weight: 700;
        color: ${T.text};
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
    `;
    name.textContent = device.name || 'Device';
    card.appendChild(name);

    const info = document.createElement('div');
    info.style.cssText = `
        font-size: 8px;
        color: ${T.textMuted};
        margin-top: 2px;
        font-family: ui-monospace, monospace;
    `;
    info.textContent = device.register_id || device.ip || '';
    card.appendChild(info);

    card.addEventListener('click', () => {
        openDeviceModal(device, deviceType, () => {
            loadData().then(() => rebuild());
        });
    });

    return card;
};

/* ─── GROUP CARDS ──────────────────────────────────────────────── */
const buildGroupCard = (title, devices, deviceType, icon) => {
    const card = document.createElement('div');
    const isActive = _state.activeTerminalId !== null;

    card.setAttribute('data-device-group', deviceType === 'printer' && title.includes('Kitchen') ? 'kitchen' : deviceType);
    card.style.cssText = `
        padding: 14px;
        background: ${T.well};
        border: 1px solid ${isActive ? withAlpha(getTerminalColor(_state.activeTerminalId), 0.5) : T.border};
        border-radius: 8px;
        transition: all 0.15s ease;
        ${isActive ? `box-shadow: 0 0 8px ${withAlpha(getTerminalColor(_state.activeTerminalId), 0.2)};` : ''}
    `;

    const titleEl = document.createElement('div');
    titleEl.style.cssText = `
        font-family: ${T.fb};
        font-size: 12px;
        font-weight: 700;
        color: ${T.textMuted};
        text-transform: uppercase;
        letter-spacing: 1px;
        margin-bottom: 10px;
        display: flex;
        align-items: center;
        justify-content: space-between;
    `;
    titleEl.innerHTML = `<span>${title}</span>`;

    if (title.includes('Receipt Settings')) {
        const settingsBtn = document.createElement('button');
        settingsBtn.textContent = '⚙';
        settingsBtn.style.cssText = `
            background: transparent;
            border: 1px solid ${T.border};
            color: ${T.text};
            border-radius: 3px;
            padding: 2px 6px;
            cursor: pointer;
            font-size: 12px;
        `;
        settingsBtn.addEventListener('click', () => {
            openReceiptSettingsModal(() => {
                loadData().then(() => rebuild());
            });
        });
        titleEl.appendChild(settingsBtn);
    }

    card.appendChild(titleEl);

    const grid = document.createElement('div');
    grid.style.cssText = `
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(80px, 1fr));
        gap: 8px;
    `;

    devices.forEach(dev => {
        grid.appendChild(buildDeviceCard(dev, deviceType));
    });

    if (devices.length === 0) {
        const empty = document.createElement('div');
        empty.style.cssText = `
            grid-column: 1 / -1;
            padding: 20px;
            text-align: center;
            color: ${T.textDim};
            font-size: 11px;
        `;
        empty.textContent = `No ${title.toLowerCase()}`;
        grid.appendChild(empty);
    }

    card.appendChild(grid);
    return card;
};

/* ─── DISCOVERED DEVICES PANEL ─────────────────────────────────── */
function buildDiscoveredDevicesPanel() {
    const devices = _state.discoveredDevices;
    if (!devices.length) return null;

    const panel = document.createElement('div');
    panel.style.cssText = `margin-top:16px; display:flex;
      flex-direction:column; gap:8px;`;

    const heading = document.createElement('div');
    heading.textContent = 'DISCOVERED DEVICES';
    heading.style.cssText = `font:600 11px/1 'JetBrains Mono',
      monospace; color:${T.moon}; letter-spacing:0.08em;
      padding:0 4px;`;
    panel.appendChild(heading);

    devices.forEach(device => {
        const row = document.createElement('div');
        row.style.cssText = `display:flex; align-items:center;
          justify-content:space-between; padding:8px 12px;
          background:${T.card}; border-radius:6px;`;

        const info = document.createElement('div');
        info.innerHTML = `
          <div style="font:600 13px/1 'JetBrains Mono',monospace;
            color:${T.text}">${device.name || device.mac || '—'}</div>
          <div style="font:11px/1.4 'JetBrains Mono',monospace;
            color:${T.moon}">${device.ip || ''} · ${device.type || ''}</div>`;
        row.appendChild(info);

        const addBtn = document.createElement('button');
        addBtn.textContent = 'ADD';
        addBtn.style.cssText = `padding:4px 14px;
          background:${T.green}; color:${T.bg};
          border:none; border-radius:20px;
          font:700 11px/1 'JetBrains Mono',monospace;
          cursor:pointer; pointer-events:auto;
          touch-action:manipulation;`;
        addBtn.addEventListener('click', () => {
            openSaveDeviceDialog({
                device,
                terminals: _state.terminals,
                onSaved: async () => {
                    _state.discoveredDevices =
                        _state.discoveredDevices.filter(d => d !== device);
                    await loadData();
                    rebuild();
                },
                onCancel: () => {},
            });
        });
        row.appendChild(addBtn);
        panel.appendChild(row);
    });
    return panel;
}

/* ─── STATUS BAR ────────────────────────────────────────────────── */
const buildStatusBar = () => {
    const bar = document.createElement('div');
    bar.style.cssText = `
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 16px;
        padding: 12px 16px;
        background: ${T.card};
        border-bottom: 1px solid ${T.border};
    `;

    const left = document.createElement('div');
    left.style.cssText = `
        display: flex;
        align-items: center;
        gap: 12px;
        font-family: ui-monospace, monospace;
        font-size: 11px;
        color: ${T.textMuted};
    `;

    const dot = document.createElement('div');
    dot.style.cssText = `
        width: 6px;
        height: 6px;
        border-radius: 50%;
        background: ${T.greenWarm};
    `;
    left.appendChild(dot);

    const status = document.createElement('span');
    status.textContent = `ONLINE  •  ${_state.terminals.length} terminals  •  Sync ${_state.lastSyncTime || '--:--'}`;
    left.appendChild(status);

    bar.appendChild(left);

    const scanBtn = button({
        label: 'SCAN NETWORK',
        variant: 'primary',
        onClick: () => startNetworkScan(),
    });
    scanBtn.style.cssText = `
        padding: 6px 12px;
        font-size: 10px;
        white-space: nowrap;
    `;
    bar.appendChild(scanBtn);

    return bar;
};

/* ─── NETWORK SCAN ─────────────────────────────────────────────── */
function startNetworkScan(targetIp) {
    if (_state.isScanning) return;
    _state.isScanning = true;
    _state.discoveredDevices = [];
    rebuild();
    if (_state.scanEventSource) {
        _state.scanEventSource.close();
    }
    _state.scanEventSource = startScan({
        targetIp,
        onStart:      (msg) => { /* optional: log */ },
        onDevice:     (msg) => {
            _state.discoveredDevices.push(msg);
            rebuild();
        },
        onDiagnostic: (msg) => showToast(msg.message || ''),
        onComplete:   ()    => {
            _state.isScanning = false;
            showToast(`Scan complete — ${_state.discoveredDevices.length} devices found`);
            rebuild();
        },
        onError:      (msg) => {
            _state.isScanning = false;
            rebuild();
        },
    });
}

/* ─── RENDER ────────────────────────────────────────────────────── */
const rebuild = () => {
    if (!_state.container) return;

    const main = _state.container.querySelector('[data-hwn-main]');
    if (!main) return;
    main.innerHTML = '';

    const terminalRow = document.createElement('div');
    terminalRow.style.cssText = `
        display: flex;
        gap: 12px;
        margin-bottom: 52px;
        position: relative;
    `;

    _state.terminals.forEach(term => {
        terminalRow.appendChild(buildTerminalCard(term));
    });

    main.appendChild(terminalRow);

    const groupGrid = document.createElement('div');
    groupGrid.style.cssText = `
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 12px;
        position: relative;
    `;

    const kitchenPrinters = _state.printers.filter(p => p.role === 'kitchen');
    const receiptPrinters = _state.printers.filter(p => p.role === 'receipt');
    const cardReaders = _state.cardReaders;

    groupGrid.appendChild(buildGroupCard('Kitchen Printers', kitchenPrinters, 'printer', '🖨'));
    groupGrid.appendChild(buildGroupCard('Receipt Printers', receiptPrinters, 'printer', '🧾'));
    groupGrid.appendChild(buildGroupCard('Card Readers', cardReaders, 'card', '💳'));
    groupGrid.appendChild(buildGroupCard('Receipt Settings', [], 'settings', '⚙'));

    main.appendChild(groupGrid);

    const discoveredPanel = buildDiscoveredDevicesPanel();
    if (discoveredPanel) {
        const mainEl = _state.container.querySelector('[data-hwn-main]');
        if (mainEl) mainEl.appendChild(discoveredPanel);
    }

    const svgContainer = document.createElement('div');
    svgContainer.style.cssText = `
        position: absolute;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        pointer-events: none;
    `;
    svgContainer.appendChild(buildSVG(_state.container));
    main.appendChild(svgContainer);
};

export async function mount(container) {
    _state.container = container;
    container.innerHTML = '';
    container.style.cssText = `
        display: flex;
        flex-direction: column;
        height: 100%;
        background: ${T.bg};
        color: ${T.text};
    `;

    const header = document.createElement('div');
    header.style.cssText = `
        padding: 20px 16px;
        border-bottom: 1px solid ${T.border};
    `;

    const title = document.createElement('div');
    title.style.cssText = `
        font-family: ${T.fb};
        font-size: 32px;
        font-weight: 700;
        color: ${T.text};
        margin-bottom: 4px;
    `;
    title.textContent = 'Hardware & Network';
    header.appendChild(title);

    const subtitle = document.createElement('div');
    subtitle.style.cssText = `
        font-family: ui-monospace, monospace;
        font-size: 11px;
        color: ${T.textMuted};
        letter-spacing: 1px;
        text-transform: uppercase;
    `;
    subtitle.textContent = 'Terminal Registration & Device Config';
    header.appendChild(subtitle);

    container.appendChild(header);

    const statusBar = buildStatusBar();
    container.appendChild(statusBar);

    const main = document.createElement('div');
    main.setAttribute('data-hwn-main', '');
    main.style.cssText = `
        flex: 1;
        padding: 16px;
        overflow-y: auto;
        position: relative;
    `;
    container.appendChild(main);

    await loadData();
    rebuild();

    return () => {
        if (_state.scanEventSource) {
            _state.scanEventSource.close();
            _state.scanEventSource = null;
        }
        resetState();
    };
}

export function cleanupHardwareNetwork(container) {
    if (_state.scanEventSource) {
        _state.scanEventSource.close();
    }
    resetState();
}
