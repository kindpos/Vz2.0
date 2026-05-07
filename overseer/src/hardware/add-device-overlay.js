// overseer/src/hardware/add-device-overlay.js
// "Add Device(s)" overlay — Enter IP tab and Scan LAN tab.
// Mounts to document.body and removes itself fully on close (no DOM leak).

import { T, withAlpha } from '../ui/tokens.js';
import { buildPrinterSVG } from './device-silhouettes.js';

// ── Small shared helpers ─────────────────────────────────────────────

function sectionLabel(text) {
    const el = document.createElement('div');
    el.style.cssText = `
        font-family: ui-monospace, monospace;
        font-size: ${T.fs.xs}px;
        font-weight: 700;
        letter-spacing: 2px;
        text-transform: uppercase;
        color: ${T.textMuted};
        margin-bottom: 6px;
    `;
    el.textContent = text;
    return el;
}

function inputEl(placeholder, value = '') {
    const inp = document.createElement('input');
    inp.type = 'text';
    inp.placeholder = placeholder;
    inp.value = value;
    inp.style.cssText = `
        flex: 1;
        background: ${T.well};
        border: 1px solid ${T.border};
        border-radius: 6px;
        padding: 9px 13px;
        font-family: ui-monospace, monospace;
        font-size: ${T.fs.base}px;
        color: ${T.cyan};
        outline: none;
        color-scheme: dark;
        transition: border-color 0.12s ease;
        min-width: 0;
    `;
    inp.addEventListener('focus', () => { inp.style.borderColor = T.gold; });
    inp.addEventListener('blur',  () => { inp.style.borderColor = T.border; });
    return inp;
}

function actionBtn(label, variant, onClick) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = label;
    const base = `
        border-radius: 999px;
        padding: 9px 20px;
        font-family: var(--font-heading);
        font-size: ${T.fs.md}px;
        font-weight: 700;
        letter-spacing: 1.2px;
        text-transform: uppercase;
        cursor: pointer;
        touch-action: manipulation;
        transition: transform 0.1s ease, opacity 0.12s ease;
        border: none;
        white-space: nowrap;
        flex-shrink: 0;
    `;
    const variants = {
        gold:  `background: ${T.gold};  color: #1a1000;`,
        cyan:  `background: ${T.cyan};  color: #001a1f;`,
        ghost: `background: transparent; color: ${T.textMuted}; border: 1px solid ${T.border};`,
    };
    btn.style.cssText = base + (variants[variant] || variants.ghost);
    btn.addEventListener('mouseenter', () => { if (!btn.disabled) btn.style.transform = 'translateY(-1px)'; });
    btn.addEventListener('mouseleave', () => { btn.style.transform = ''; });
    if (onClick) btn.addEventListener('click', onClick);
    return btn;
}

function modeTab(label, active, variant, onClick) {
    const btn = actionBtn(label, active ? variant : 'ghost', onClick);
    if (!active) {
        btn.style.color = T.textMuted;
    }
    return btn;
}

function divider() {
    const el = document.createElement('div');
    el.style.cssText = `height: 1px; background: ${T.border}; margin: 14px 0;`;
    return el;
}

// ── Enter IP tab ─────────────────────────────────────────────────────

const _IP_RE = /^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/;

function buildEnterIpTab(terminals, onClose) {
    const wrap = document.createElement('div');
    wrap.style.cssText = 'display: flex; flex-direction: column; gap: 0;';

    let probeDevice = null;   // device object from the SSE `device` event
    let probeSource = null;   // active EventSource
    const ipSelected = new Set();

    // ── Step 1: IP input ─────────────────────────────────────────────
    const step1 = document.createElement('div');
    step1.style.cssText = 'display: flex; flex-direction: column; gap: 6px;';
    step1.appendChild(sectionLabel('DEVICE IP ADDRESS'));

    const ipRow = document.createElement('div');
    ipRow.style.cssText = 'display: flex; gap: 8px; align-items: center;';
    const ipInput = inputEl('10.0.0.x');
    ipInput.style.fontWeight = '700';
    const probeBtn = actionBtn('PROBE', 'gold', null);
    ipRow.appendChild(ipInput);
    ipRow.appendChild(probeBtn);
    step1.appendChild(ipRow);

    const statusEl = document.createElement('div');
    statusEl.style.cssText = `
        font-family: ui-monospace, monospace;
        font-size: ${T.fs.xs}px;
        color: ${T.textDim};
        min-height: 16px;
    `;
    step1.appendChild(statusEl);

    const errorEl = document.createElement('div');
    errorEl.style.cssText = `
        font-family: ui-monospace, monospace;
        font-size: ${T.fs.xs}px;
        color: ${T.verm};
        min-height: 16px;
    `;
    step1.appendChild(errorEl);
    wrap.appendChild(step1);

    // ── Step 2: Device row (shown after SSE device event) ────────────
    const deviceRowWrap = document.createElement('div');
    deviceRowWrap.style.cssText = 'margin-top: 10px; display: none; flex-direction: column; gap: 4px;';
    wrap.appendChild(deviceRowWrap);

    // ── Step 3: Name / assign / save (shown after device found) ──────
    const step3 = document.createElement('div');
    step3.style.cssText = 'display: none; flex-direction: column; gap: 14px; margin-top: 14px;';

    const nameWrap = document.createElement('div');
    nameWrap.appendChild(sectionLabel('DISPLAY NAME'));
    const nameInput = inputEl('Kitchen Printer');
    nameWrap.appendChild(nameInput);
    step3.appendChild(nameWrap);

    const assignWrap = document.createElement('div');
    assignWrap.style.display = terminals.length <= 1 ? 'none' : 'flex';
    assignWrap.style.flexDirection = 'column';
    assignWrap.style.gap = '6px';
    assignWrap.appendChild(sectionLabel('ASSIGN TO TERMINAL'));
    const termSelect = document.createElement('select');
    termSelect.style.cssText = `
        background: ${T.well};
        border: 1px solid ${T.border};
        border-radius: 6px;
        padding: 9px 13px;
        font-family: var(--font-body);
        font-size: ${T.fs.base}px;
        color: ${T.text};
        outline: none;
        color-scheme: dark;
        cursor: pointer;
    `;
    terminals.forEach(t => {
        const opt = document.createElement('option');
        opt.value = t.id;
        opt.textContent = `${t.label} — ${t.ip || ''}`;
        termSelect.appendChild(opt);
    });
    assignWrap.appendChild(termSelect);
    step3.appendChild(assignWrap);

    // No-MAC warning (shown when SSE device has no MAC)
    const macWarnEl = document.createElement('div');
    macWarnEl.style.cssText = `
        display: none;
        font-family: ui-monospace, monospace;
        font-size: ${T.fs.xs}px;
        color: ${T.gold};
        background: ${withAlpha(T.gold, 0.08)};
        border: 1px solid ${withAlpha(T.gold, 0.25)};
        border-radius: 6px;
        padding: 8px 10px;
        line-height: 1.5;
    `;
    macWarnEl.textContent = 'Could not resolve MAC — device will be saved by IP only. Consider assigning a static IP for this device.';
    step3.appendChild(macWarnEl);

    // Duplicate-device warning (populated just before save attempt)
    const dupWarnEl = document.createElement('div');
    dupWarnEl.style.cssText = `
        display: none;
        flex-direction: column;
        gap: 8px;
        background: ${withAlpha(T.verm, 0.08)};
        border: 1px solid ${withAlpha(T.verm, 0.3)};
        border-radius: 6px;
        padding: 10px 12px;
        font-family: ui-monospace, monospace;
        font-size: ${T.fs.xs}px;
        color: ${T.verm};
    `;
    const dupMsgEl = document.createElement('div');
    dupMsgEl.style.lineHeight = '1.5';
    const dupBtnRow = document.createElement('div');
    dupBtnRow.style.cssText = 'display: flex; gap: 8px;';
    dupWarnEl.appendChild(dupMsgEl);
    dupWarnEl.appendChild(dupBtnRow);
    step3.appendChild(dupWarnEl);

    // Save
    const saveWrap = document.createElement('div');
    saveWrap.style.cssText = 'display: flex; justify-content: center; padding-top: 4px;';
    const saveBtn = actionBtn('SAVE DEVICE', 'gold', null);
    saveWrap.appendChild(saveBtn);
    step3.appendChild(saveWrap);
    wrap.appendChild(step3);

    // ── Helpers ───────────────────────────────────────────────────────

    function resetProbe() {
        probeDevice = null;
        ipSelected.clear();
        deviceRowWrap.innerHTML = '';
        deviceRowWrap.style.display = 'none';
        step3.style.display = 'none';
        dupWarnEl.style.display = 'none';
        macWarnEl.style.display = 'none';
        errorEl.textContent = '';
        statusEl.textContent = '';
    }

    function stopSource() {
        if (probeSource) { probeSource.close(); probeSource = null; }
    }

    function showDevice(data) {
        const port = data.port || 9100;
        const isReader = data.saved_type === 'card_reader' || CARD_READER_PORTS.includes(port);
        probeDevice = {
            ip: data.ip,
            mac: data.mac || '',
            model: data.name || data.saved_name || 'Unknown Device',
            port,
            assignedType: data.saved_type || (isReader ? 'card_reader' : 'kitchen'),
        };
        const key = probeDevice.mac || probeDevice.ip;
        ipSelected.add(key);

        deviceRowWrap.innerHTML = '';
        deviceRowWrap.appendChild(buildDeviceRow(probeDevice, ipSelected, () => {
            // re-render checkbox state only
            deviceRowWrap.innerHTML = '';
            deviceRowWrap.appendChild(buildDeviceRow(probeDevice, ipSelected, () => {}));
        }));
        deviceRowWrap.style.display = 'flex';

        nameInput.value = probeDevice.model !== 'Unknown Device' ? probeDevice.model : '';
        macWarnEl.style.display = probeDevice.mac ? 'none' : 'block';
        step3.style.display = 'flex';
    }

    // ── PROBE handler (SSE) ───────────────────────────────────────────

    probeBtn.addEventListener('click', () => {
        const ip = ipInput.value.trim();
        errorEl.textContent = '';
        if (!_IP_RE.test(ip)) {
            errorEl.textContent = 'Invalid IP address';
            return;
        }

        stopSource();
        resetProbe();

        probeBtn.disabled = true;
        probeBtn.textContent = '…';
        probeBtn.style.opacity = '0.65';
        statusEl.textContent = `Probing ${ip}…`;

        probeSource = new EventSource(`/api/v1/hardware/scan/stream?ip=${encodeURIComponent(ip)}`);

        probeSource.onmessage = (e) => {
            let data;
            try { data = JSON.parse(e.data); } catch { return; }

            if (data.type === 'diagnostic') {
                statusEl.textContent = data.message || `Probing ${ip}…`;
            } else if (data.type === 'device') {
                statusEl.textContent = '';
                showDevice(data);
            } else if (data.type === 'complete') {
                stopSource();
                probeBtn.disabled = false;
                probeBtn.textContent = 'PROBE';
                probeBtn.style.opacity = '1';
                statusEl.textContent = '';
                if (!probeDevice) {
                    errorEl.textContent = `No device responded at ${ip}`;
                }
            } else if (data.type === 'error') {
                stopSource();
                probeBtn.disabled = false;
                probeBtn.textContent = 'PROBE';
                probeBtn.style.opacity = '1';
                statusEl.textContent = '';
                errorEl.textContent = data.message || `Error probing ${ip}`;
            }
        };

        probeSource.onerror = () => {
            stopSource();
            probeBtn.disabled = false;
            probeBtn.textContent = 'PROBE';
            probeBtn.style.opacity = '1';
            statusEl.textContent = '';
            errorEl.textContent = `Could not reach ${ip} — check network connection.`;
        };
    });

    // Enter key triggers probe
    ipInput.addEventListener('keydown', e => { if (e.key === 'Enter') probeBtn.click(); });

    // ── Save handler with persistence checks ─────────────────────────

    saveBtn.addEventListener('click', async () => {
        if (!probeDevice) return;

        // Duplicate check: fetch current saved devices, look for matching MAC
        let savedDevices = [];
        try {
            const r = await fetch('/api/v1/hardware/devices');
            if (r.ok) savedDevices = await r.json();
        } catch { /* non-fatal */ }

        if (probeDevice.mac) {
            const existing = savedDevices.find(d => d.mac === probeDevice.mac);
            if (existing) {
                dupMsgEl.textContent = `This device is already saved as "${existing.name || existing.type}" at ${existing.ip}. Update its IP instead?`;
                dupBtnRow.innerHTML = '';
                const confirmBtn = actionBtn('CONFIRM UPDATE', 'gold', async () => {
                    dupWarnEl.style.display = 'none';
                    await doSave(true);
                });
                confirmBtn.style.fontSize = T.fs.xs + 'px';
                const cancelBtn = actionBtn('CANCEL', 'ghost', () => {
                    dupWarnEl.style.display = 'none';
                });
                cancelBtn.style.fontSize = T.fs.xs + 'px';
                dupBtnRow.appendChild(confirmBtn);
                dupBtnRow.appendChild(cancelBtn);
                dupWarnEl.style.display = 'flex';
                return;
            }
        }

        await doSave(false);
    });

    async function doSave(isUpdate) {
        saveBtn.disabled = true;
        saveBtn.textContent = 'Saving…';
        saveBtn.style.opacity = '0.65';
        const record = {
            ip:   probeDevice.ip,
            port: probeDevice.port || 9100,
            mac:  probeDevice.mac || null,
            type: probeDevice.assignedType || 'kitchen',
            name: nameInput.value.trim() || probeDevice.model || 'Device',
        };
        try {
            const method = isUpdate ? 'PATCH' : 'POST';
            const res = await fetch('/api/v1/hardware/devices', {
                method,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(record),
            });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            window.dispatchEvent(new CustomEvent('kindpos:devicesAdded'));
            onClose();
        } catch {
            saveBtn.textContent = 'Save failed';
            setTimeout(() => {
                saveBtn.disabled = false;
                saveBtn.textContent = 'SAVE DEVICE';
                saveBtn.style.opacity = '1';
            }, 2000);
        }
    }

    return wrap;
}

// ── Scan LAN tab ─────────────────────────────────────────────────────

// Ports that identify a payment terminal (Dejavoo SPIn). Defined here so
// the isReader classification below stays in sync with the backend constant.
const CARD_READER_PORTS = [9000, 8443, 9443];

// ── Shared device row ────────────────────────────────────────────────
// Used by both Scan LAN and Enter IP tabs.
// selectedDevices: Set of keys (mac or ip) that are checked.
// onSelectionChange: called after toggling a checkbox.

function buildDeviceRow(dev, selectedDevices, onSelectionChange) {
    const isReader = dev.assignedType === 'card_reader';
    const row = document.createElement('div');
    row.style.cssText = `
        display: flex; align-items: center; gap: 10px;
        background: ${T.well};
        border-radius: 6px;
        padding: 8px 12px;
    `;

    const checkKey = dev.mac || dev.ip;
    const isChecked = selectedDevices.has(checkKey);
    const checkbox = document.createElement('div');
    checkbox.style.cssText = `
        width: 16px; height: 16px; border-radius: 3px; flex-shrink: 0;
        border: 1.5px solid ${isChecked ? T.green : T.border};
        background: ${isChecked ? withAlpha(T.green, 0.2) : 'transparent'};
        display: flex; align-items: center; justify-content: center;
        cursor: pointer; touch-action: manipulation;
        font-size: 10px; color: ${T.green};
    `;
    checkbox.textContent = isChecked ? '✓' : '';
    checkbox.addEventListener('click', () => {
        if (selectedDevices.has(checkKey)) selectedDevices.delete(checkKey);
        else selectedDevices.add(checkKey);
        onSelectionChange();
    });
    row.appendChild(checkbox);

    const info = document.createElement('div');
    info.style.cssText = 'flex: 1; min-width: 0;';
    const nameEl = document.createElement('div');
    nameEl.style.cssText = `font-size: ${T.fs.base}px; color: ${T.text}; font-weight: 600;`;
    nameEl.textContent = dev.model || (isReader ? 'Card Reader' : 'Unknown Device');
    const detailEl = document.createElement('div');
    detailEl.style.cssText = `font-family: ui-monospace, monospace; font-size: ${T.fs.xs}px; color: ${T.textMuted};`;
    detailEl.textContent = `${dev.ip}  ·  ${dev.mac || ''}`;
    info.appendChild(nameEl);
    info.appendChild(detailEl);
    row.appendChild(info);

    if (isReader) {
        const badge = document.createElement('div');
        badge.style.cssText = `
            background: ${withAlpha(T.cyan, 0.12)};
            border: 1px solid ${withAlpha(T.cyan, 0.3)};
            border-radius: 6px;
            padding: 4px 8px;
            font-family: var(--font-heading);
            font-size: ${T.fs.xs}px;
            color: ${T.cyan};
            font-weight: 700;
            letter-spacing: 0.5px;
            text-transform: uppercase;
            white-space: nowrap;
        `;
        badge.textContent = 'CARD READER';
        row.appendChild(badge);
    } else {
        const typeSel = document.createElement('select');
        typeSel.style.cssText = `
            background: ${withAlpha(T.gold, 0.12)};
            border: 1px solid ${withAlpha(T.gold, 0.3)};
            border-radius: 6px;
            padding: 4px 8px;
            font-family: var(--font-heading);
            font-size: ${T.fs.xs}px;
            color: ${T.gold};
            font-weight: 700;
            outline: none;
            cursor: pointer;
            color-scheme: dark;
            letter-spacing: 0.5px;
            text-transform: uppercase;
        `;
        ['KITCHEN', 'RECEIPT', 'BAR', 'EXPO'].forEach(t => {
            const opt = document.createElement('option');
            opt.value = t.toLowerCase();
            opt.textContent = t;
            typeSel.appendChild(opt);
        });
        typeSel.value = dev.assignedType || 'kitchen';
        typeSel.addEventListener('change', () => { dev.assignedType = typeSel.value; });
        row.appendChild(typeSel);
    }

    return row;
}

function buildScanLanTab(terminals, onClose) {
    const wrap = document.createElement('div');
    wrap.style.cssText = 'display: flex; flex-direction: column; gap: 0;';

    let discovered = [];
    let scanning = false;
    let scanSource = null;
    const selectedDevices = new Set();

    // Subnet row
    const subnetWrap = document.createElement('div');
    subnetWrap.style.cssText = 'display: flex; flex-direction: column; gap: 6px;';
    subnetWrap.appendChild(sectionLabel('SUBNET'));
    const subnetRow = document.createElement('div');
    subnetRow.style.cssText = 'display: flex; gap: 8px; align-items: center;';
    const subnetInput = inputEl('10.0.0.0/24', '10.0.0.0/24');
    const scanBtn = actionBtn('START SCAN', 'cyan', null);
    subnetRow.appendChild(subnetInput);
    subnetRow.appendChild(scanBtn);
    subnetWrap.appendChild(subnetRow);
    wrap.appendChild(subnetWrap);

    // Scan terminal log
    const termLog = document.createElement('div');
    termLog.style.cssText = `
        background: ${T.well};
        border: 1px solid ${T.border};
        border-radius: 6px;
        padding: 10px 12px;
        margin-top: 10px;
        min-height: 90px;
        max-height: 180px;
        overflow-y: auto;
        font-family: ui-monospace, monospace;
        font-size: ${T.fs.xs}px;
        display: flex; flex-direction: column; gap: 2px;
    `;
    function logLine(text, color) {
        const line = document.createElement('div');
        line.style.color = color || T.textDim;
        line.textContent = text;
        termLog.appendChild(line);
        termLog.scrollTop = termLog.scrollHeight;
    }
    logLine('Waiting for scan…', T.border);
    wrap.appendChild(termLog);

    // Progress bar
    const progressTrack = document.createElement('div');
    progressTrack.style.cssText = `
        height: 4px;
        background: ${T.well};
        border-radius: 999px;
        margin-top: 8px;
        overflow: hidden;
    `;
    const progressFill = document.createElement('div');
    progressFill.style.cssText = `
        height: 100%;
        width: 0%;
        background: ${withAlpha(T.cyan, 0.7)};
        border-radius: 999px;
        transition: width 0.4s ease;
    `;
    progressTrack.appendChild(progressFill);
    wrap.appendChild(progressTrack);

    // Discovered devices section
    const discoveredSection = document.createElement('div');
    discoveredSection.style.cssText = 'margin-top: 10px; display: flex; flex-direction: column; gap: 6px;';

    const discoveredHeader = document.createElement('div');
    discoveredHeader.style.cssText = `
        font-family: var(--font-heading);
        font-size: ${T.fs.xs}px;
        font-weight: 700;
        letter-spacing: 2px;
        color: ${T.textMuted};
        text-transform: uppercase;
    `;
    discoveredHeader.textContent = 'DISCOVERED DEVICES — 0 found';
    discoveredSection.appendChild(discoveredHeader);

    const deviceList = document.createElement('div');
    deviceList.style.cssText = 'display: flex; flex-direction: column; gap: 6px;';
    discoveredSection.appendChild(deviceList);
    wrap.appendChild(discoveredSection);

    function refreshDeviceList() {
        deviceList.innerHTML = '';
        discoveredHeader.textContent = `DISCOVERED DEVICES — ${discovered.length} found`;

        const printers = discovered.filter(d => d.assignedType !== 'card_reader');
        const readers  = discovered.filter(d => d.assignedType === 'card_reader');

        if (printers.length > 0) {
            const lbl = document.createElement('div');
            lbl.style.cssText = `
                font-family: ui-monospace, monospace;
                font-size: ${T.fs.xs}px;
                font-weight: 700;
                letter-spacing: 2px;
                text-transform: uppercase;
                color: ${T.gold};
                margin-bottom: 4px;
                margin-top: 2px;
            `;
            lbl.textContent = 'PRINT DEVICES';
            deviceList.appendChild(lbl);
            printers.forEach(dev => deviceList.appendChild(buildDeviceRow(dev, selectedDevices, refreshDeviceList)));
        }

        if (printers.length > 0 && readers.length > 0) {
            deviceList.appendChild(divider());
        }

        if (readers.length > 0) {
            const lbl = document.createElement('div');
            lbl.style.cssText = `
                font-family: ui-monospace, monospace;
                font-size: ${T.fs.xs}px;
                font-weight: 700;
                letter-spacing: 2px;
                text-transform: uppercase;
                color: ${T.cyan};
                margin-bottom: 4px;
                margin-top: 2px;
            `;
            lbl.textContent = 'PAYMENT';
            deviceList.appendChild(lbl);
            readers.forEach(dev => deviceList.appendChild(buildDeviceRow(dev, selectedDevices, refreshDeviceList)));
        }
    }

    // Assign all to terminal (hidden when 1 terminal)
    const assignWrap = document.createElement('div');
    assignWrap.style.display = terminals.length <= 1 ? 'none' : 'flex';
    assignWrap.style.flexDirection = 'column';
    assignWrap.style.gap = '6px';
    assignWrap.style.marginTop = '8px';
    assignWrap.appendChild(sectionLabel('ASSIGN ALL TO'));
    const assignSel = document.createElement('select');
    assignSel.style.cssText = `
        background: ${T.well};
        border: 1px solid ${T.border};
        border-radius: 6px;
        padding: 9px 13px;
        font-family: var(--font-body);
        font-size: ${T.fs.base}px;
        color: ${T.text};
        outline: none;
        color-scheme: dark;
        cursor: pointer;
    `;
    terminals.forEach(t => {
        const opt = document.createElement('option');
        opt.value = t.id;
        opt.textContent = `${t.label} — ${t.ip || ''}`;
        assignSel.appendChild(opt);
    });
    assignWrap.appendChild(assignSel);
    wrap.appendChild(assignWrap);

    // Save button
    const saveWrap = document.createElement('div');
    saveWrap.style.cssText = 'display: flex; justify-content: center; padding-top: 10px;';
    const saveAllBtn = actionBtn('SAVE DEVICE(S)', 'cyan', async () => {
        const toSave = discovered.filter(d => selectedDevices.has(d.mac));
        if (!toSave.length) return;
        saveAllBtn.disabled = true;
        saveAllBtn.textContent = 'Saving…';
        saveAllBtn.style.opacity = '0.65';
        try {
            // TODO: wire to real endpoint — /api/v1/hardware/devices (one POST per device)
            for (const d of toSave) {
                const record = {
                    ip:   d.ip,
                    port: d.port || 9100,
                    mac:  d.mac || `UNKNOWN-${d.ip.replace(/\./g, '-')}`,
                    type: d.assignedType || 'kitchen',
                    name: d.model || 'Printer',
                };
                const res = await fetch('/api/v1/hardware/devices', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(record),
                });
                if (!res.ok) throw new Error(`HTTP ${res.status}`);
            }
            window.dispatchEvent(new CustomEvent('kindpos:devicesAdded'));
            onClose();
        } catch {
            saveAllBtn.textContent = 'Save failed';
            setTimeout(() => { saveAllBtn.disabled = false; saveAllBtn.textContent = 'SAVE DEVICE(S)'; saveAllBtn.style.opacity = '1'; }, 2000);
        }
    });
    saveWrap.appendChild(saveAllBtn);
    wrap.appendChild(saveWrap);

    // Scan logic
    scanBtn.addEventListener('click', () => {
        if (scanning) {
            if (scanSource) { scanSource.close(); scanSource = null; }
            scanning = false;
            scanBtn.textContent = 'START SCAN';
            return;
        }
        scanning = true;
        discovered = [];
        selectedDevices.clear();
        termLog.innerHTML = '';
        progressFill.style.width = '0%';
        refreshDeviceList();
        scanBtn.textContent = 'STOP';

        // TODO: wire to real endpoint — /api/v1/hardware/scan/stream
        // Backend ignores ?subnet= param — uses auto-detected local subnet
        scanSource = new EventSource('/api/v1/hardware/scan/stream');
        let totalHosts = 0;
        let hostsProbed = 0;

        scanSource.onmessage = (e) => {
            let data;
            try { data = JSON.parse(e.data); } catch { return; }

            if (data.type === 'start') {
                totalHosts = data.total || 0;
                const subnet = data.subnet || subnetInput.value;
                logLine(`Scanning ${subnet} — ${totalHosts} host${totalHosts !== 1 ? 's' : ''} to check`, T.textDim);
            } else if (data.type === 'device') {
                hostsProbed++;
                const pct = totalHosts > 0 ? Math.min((hostsProbed / totalHosts) * 100, 99) : 50;
                progressFill.style.width = pct + '%';
                const label = data.name || data.type || 'device';
                logLine(`Found: ${data.ip} — ${label}`, T.green);
                // Infer device type: backend overwrites inner 'type' with 'device' in the event,
                // so use saved_type if present, else check against the known card-reader port list.
                // The old arithmetic check (port >= 9000 && ...) incorrectly excluded port 8443.
                const port = data.port || 9100;
                const isReader = data.saved_type === 'card_reader' || CARD_READER_PORTS.includes(port);
                const inferredType = data.saved_type || (isReader ? 'card_reader' : 'kitchen');
                discovered.push({
                    ip: data.ip, mac: data.mac || '', model: data.name || data.saved_name || 'Unknown',
                    port, assignedType: inferredType,
                });
                selectedDevices.add(data.mac || data.ip);
                refreshDeviceList();
            } else if (data.type === 'complete') {
                progressFill.style.width = '100%';
                logLine(`Scan complete — ${discovered.length} device(s) found`, T.cyan);
                scanning = false;
                scanBtn.textContent = 'START SCAN';
                scanSource.close();
                scanSource = null;
            } else if (data.type === 'error') {
                logLine(`Error: ${data.message || 'scan failed'}`, T.verm);
                scanning = false;
                scanBtn.textContent = 'START SCAN';
                scanSource.close();
                scanSource = null;
            }
        };

        scanSource.onerror = () => {
            logLine('Scan error — check network connection', T.verm);
            scanning = false;
            scanBtn.textContent = 'START SCAN';
            if (scanSource) { scanSource.close(); scanSource = null; }
        };
    });

    return wrap;
}

// ── Main overlay builder ──────────────────────────────────────────────

export function buildAddDeviceOverlay({ terminals = [] }) {
    let activeMode = 'ip'; // 'ip' | 'scan'
    let scanSource = null;

    // Scrim
    const scrim = document.createElement('div');
    scrim.style.cssText = `
        position: fixed; inset: 0;
        background: rgba(13,15,16,0.72);
        z-index: 50;
        display: flex; align-items: center; justify-content: center;
        padding: 20px;
    `;

    // Panel
    const panel = document.createElement('div');
    panel.style.cssText = `
        background: ${T.card};
        border-radius: 10px;
        width: 420px;
        max-width: 100%;
        max-height: 90vh;
        display: flex;
        flex-direction: column;
        overflow: hidden;
        position: relative;
    `;

    // Top accent bar
    const accentBar = document.createElement('div');
    accentBar.style.cssText = `height: 4px; background: ${T.gold}; border-radius: 10px 10px 0 0; flex-shrink: 0;`;
    panel.appendChild(accentBar);

    // Header row
    const headerRow = document.createElement('div');
    headerRow.style.cssText = `
        display: flex; align-items: flex-start; justify-content: space-between;
        padding: 16px 18px 8px;
        flex-shrink: 0;
    `;

    const headerText = document.createElement('div');
    const titleEl = document.createElement('div');
    titleEl.style.cssText = `
        font-family: var(--font-heading);
        font-size: ${T.fs.xl}px;
        font-weight: 700;
        color: ${T.text};
    `;
    titleEl.textContent = 'Add Device';
    const subtitleEl = document.createElement('div');
    subtitleEl.style.cssText = `
        font-family: ui-monospace, monospace;
        font-size: ${T.fs.xs}px;
        font-weight: 700;
        letter-spacing: 2px;
        color: ${T.gold};
        text-transform: uppercase;
        margin-top: 3px;
    `;
    subtitleEl.textContent = 'MANUAL ENTRY';
    headerText.appendChild(titleEl);
    headerText.appendChild(subtitleEl);
    headerRow.appendChild(headerText);

    // Close button
    const closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.textContent = '✕';
    closeBtn.style.cssText = `
        background: transparent;
        border: none;
        color: ${T.textMuted};
        font-size: 16px;
        cursor: pointer;
        touch-action: manipulation;
        padding: 4px 6px;
        border-radius: 4px;
        transition: color 0.12s ease;
        line-height: 1;
    `;
    closeBtn.addEventListener('mouseenter', () => { closeBtn.style.color = T.text; });
    closeBtn.addEventListener('mouseleave', () => { closeBtn.style.color = T.textMuted; });
    headerRow.appendChild(closeBtn);
    panel.appendChild(headerRow);

    // Mode tabs
    const tabRow = document.createElement('div');
    tabRow.style.cssText = 'display: flex; gap: 8px; padding: 0 18px 12px; flex-shrink: 0;';
    panel.appendChild(tabRow);

    // Scrollable body
    const body = document.createElement('div');
    body.style.cssText = `
        flex: 1;
        overflow-y: auto;
        padding: 4px 18px 20px;
    `;
    panel.appendChild(body);

    // Close handler
    function close() {
        if (scanSource) { try { scanSource.close(); } catch {} }
        scrim.remove();
    }

    closeBtn.addEventListener('click', close);
    scrim.addEventListener('click', e => { if (e.target === scrim) close(); });

    // Tab switch logic
    function switchTab(mode) {
        activeMode = mode;
        const isIp = mode === 'ip';
        accentBar.style.background = isIp ? T.gold : T.cyan;
        subtitleEl.style.color = isIp ? T.gold : T.cyan;
        subtitleEl.textContent = isIp ? 'MANUAL ENTRY' : 'SCAN LAN';

        // Rebuild tabs
        tabRow.innerHTML = '';
        const ipTabBtn = modeTab('Enter IP', isIp, 'gold', () => switchTab('ip'));
        const scanTabBtn = modeTab('Scan LAN', !isIp, 'cyan', () => switchTab('scan'));
        tabRow.appendChild(ipTabBtn);
        tabRow.appendChild(scanTabBtn);

        // Rebuild body
        body.innerHTML = '';
        if (isIp) {
            body.appendChild(buildEnterIpTab(terminals, close));
        } else {
            body.appendChild(buildScanLanTab(terminals, close));
        }
    }

    switchTab('ip');
    scrim.appendChild(panel);
    document.body.appendChild(scrim);
}
