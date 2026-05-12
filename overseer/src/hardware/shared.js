/* ============================================
   KINDpos Overseer — Hardware Shared Components
   Liftable, parameter-driven primitives shared by
   the Hardware & Network scene and its variants.
   No module-level state; all collaborators are passed in.
   ============================================ */

import { T } from '../ui/tokens.js';
import { fetchWithTimeout } from '../services/http.js';
import { showToast } from '../ui/forms.js';
import { hexToRgba } from '../../../common/theme.js';

/* ─── 1. buildPillButton ──────────────────────────────────────────
   Rounded pill button with drop-shadow press animation.
   Lifted from hardware.js. Pure DOM builder.
*/
export function buildPillButton(label, fillColor, textColor, onClick) {
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
        box-shadow: 0 3px 0 ${shadow};
        transition: transform 0.08s ease, box-shadow 0.08s ease;
        white-space: nowrap;
    `;
    b.addEventListener('mousedown', () => {
        b.style.transform = 'translateY(2px)';
        b.style.boxShadow = `0 1px 0 ${shadow}`;
    });
    const reset = () => {
        b.style.transform = 'translateY(0)';
        b.style.boxShadow = `0 3px 0 ${shadow}`;
    };
    b.addEventListener('mouseup', reset);
    b.addEventListener('mouseleave', reset);
    if (onClick) b.addEventListener('click', onClick);
    return b;
}

/* ─── 2. buildGhostButton ─────────────────────────────────────────
   Outline pill button. Lifted from hardware.js. Pure DOM builder.
*/
export function buildGhostButton(label, color, onClick) {
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
}

/* ─── 3. isValidIP ────────────────────────────────────────────────
   IPv4 string → boolean. Pure validator.
*/
export function isValidIP(ip) {
    const parts = String(ip || '').split('.');
    if (parts.length !== 4) return false;
    return parts.every(p => {
        const num = parseInt(p, 10);
        return !isNaN(num) && num >= 0 && num <= 255;
    });
}

/* ─── 4. isValidPort ──────────────────────────────────────────────
   Port string/number → boolean. Pure validator.
*/
export function isValidPort(port) {
    const num = parseInt(port, 10);
    return !isNaN(num) && num >= 0 && num <= 65535;
}

/* ─── 5. buildTestConnectionButton ────────────────────────────────
   POSTs /api/v1/hardware/test-connection with the values from the
   two input elements; updates its own label to ✓/✗ for 2 s and
   notifies the optional onResult(boolean, payload).
*/
export function buildTestConnectionButton(ipInput, portInput, onResult) {
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
                body: JSON.stringify({ ip, port: parseInt(port, 10) }),
            }, 5000);

            if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
            const result = await resp.json();

            const reachable = result.status === 'online';
            if (reachable) {
                btn.textContent = '✓ REACHABLE';
                btn.style.color = T.green;
                showToast(`${ip}:${port} is reachable`);
            } else {
                btn.textContent = '✗ UNREACHABLE';
                btn.style.color = T.verm;
                showToast(`${ip}:${port} is unreachable`, 'warn');
            }
            if (onResult) onResult(reachable, result);

            setTimeout(() => {
                btn.textContent = originalText;
                btn.style.color = T.cyan;
                btn.disabled = false;
            }, 2000);
        } catch (e) {
            btn.textContent = '✗ ERROR';
            btn.style.color = T.verm;
            showToast(`Connection test failed: ${e.message}`, 'error');
            if (onResult) onResult(false, { error: e.message });
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
}

/* ─── 6. startScan ────────────────────────────────────────────────
   Generic SSE wrapper around /api/v1/hardware/scan/stream.

   Note: the backend marks device events with `event: 'device'`
   (separate field from the `type: 'start'/'diagnostic'/'complete'/
   'error'` used by the other event kinds — see hardware.py:618 vs
   :642). We dispatch on whichever field is present.

   Caller closes the returned EventSource. Module holds no state.
*/
export function startScan({ targetIp, onStart, onDevice, onDiagnostic, onComplete, onError } = {}) {
    const url = (targetIp && String(targetIp).trim())
        ? `/api/v1/hardware/scan/stream?ip=${encodeURIComponent(targetIp)}`
        : '/api/v1/hardware/scan/stream';

    const source = new EventSource(url);

    source.onmessage = (e) => {
        let msg;
        try {
            msg = JSON.parse(e.data);
        } catch (err) {
            if (onError) onError({ type: 'error', message: 'Malformed SSE payload' });
            return;
        }
        if (msg.event === 'device') {
            if (onDevice) onDevice(msg);
            return;
        }
        switch (msg.type) {
            case 'start':      if (onStart)      onStart(msg);      break;
            case 'device':     if (onDevice)     onDevice(msg);     break;
            case 'diagnostic': if (onDiagnostic) onDiagnostic(msg); break;
            case 'complete':   if (onComplete)   onComplete(msg);   break;
            case 'error':      if (onError)      onError(msg);      break;
            default: /* ignore unknown event types */ break;
        }
    };

    source.onerror = () => {
        if (onError) onError({ type: 'error', message: 'Connection lost' });
    };

    return source;
}

/* ─── 7. buildTerminalAssignmentChips ────────────────────────────
   Per-terminal selectable chip list — the only writer of the
   terminal_ids JSON array in the codebase (extracted from
   hardware.js:1187-1265).

   terminals   : Array<{ terminal_id, name, ip_address?, is_hub? }>
   selectedIds : Set<string>  — caller owns mutation.
   onToggle    : (terminalId, nowSelected) => void  (optional)

   Returns a container <div>; mutates selectedIds in place.
*/
export function buildTerminalAssignmentChips(terminals, selectedIds, onToggle) {
    const wrap = document.createElement('div');
    wrap.style.cssText = `display: flex; flex-direction: column; gap: 8px;`;

    if (!Array.isArray(terminals) || terminals.length === 0) {
        const empty = document.createElement('div');
        empty.style.cssText = `
            color: ${T.textMuted}; font-size: 11px;
            font-family: 'Share Tech Mono', monospace; padding: 4px 0;
        `;
        empty.textContent = 'No terminals configured. Add terminals first.';
        wrap.appendChild(empty);
        return wrap;
    }

    terminals.forEach(term => {
        const chip = document.createElement('div');
        chip.style.cssText = `
            display: flex; align-items: center; gap: 10px;
            padding: 8px 10px; background: ${T.card};
            border: 1px solid ${T.border}; border-radius: 5px;
            cursor: pointer; transition: border-color 0.12s;
        `;

        const isSelected = selectedIds.has(term.terminal_id);
        const isHub = term.is_hub === true;

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
            <div style="font-size: 12px; color: ${T.text}; font-family: ${T.fb};">
                ${term.name || term.terminal_id || 'Terminal'}
            </div>
            <div style="font-size: 10px; color: ${T.textMuted}; font-family: 'Share Tech Mono', monospace; margin-top: 1px;">
                ${term.ip_address || ''}
            </div>
        `;

        const assignBadge = document.createElement('span');
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
                if (onToggle) onToggle(term.terminal_id, false);
            } else {
                selectedIds.add(term.terminal_id);
                chkIndicator.style.border = `1.5px solid ${T.elec}`;
                chkIndicator.style.background = T.elec;
                chkIndicator.textContent = '✓';
                if (!isHub) {
                    assignBadge.style.background = T.green;
                    assignBadge.textContent = 'Assigned';
                }
                if (onToggle) onToggle(term.terminal_id, true);
            }
        });

        wrap.appendChild(chip);
    });

    return wrap;
}

/* ─── 8. openSaveDeviceDialog ─────────────────────────────────────
   Modal scrim mounted to document.body. Self-unmounts on save,
   cancel, or scrim click. POSTs to /api/v1/hardware/devices.

   Role determines which fields appear and what body shape is sent:
     - receipt     : terminal_ids[] (multi-select chips)
     - kitchen     : categories (CSV text input)
     - card_reader : register_id (text input)
   All roles send: { mac, ip, port, type, name, role }.
*/
export function openSaveDeviceDialog({ device, terminals, onSaved, onCancel } = {}) {
    device = device || {};
    terminals = Array.isArray(terminals) ? terminals : [];

    // ── Seed initial role from device.role or device.type ──────────
    let selectedRole;
    if (device.role === 'receipt' || device.role === 'kitchen' || device.role === 'card_reader') {
        selectedRole = device.role;
    } else if (device.type === 'card_reader') {
        selectedRole = 'card_reader';
    } else {
        selectedRole = 'receipt';
    }

    const selectedIds = new Set(Array.isArray(device.terminal_ids) ? device.terminal_ids : []);

    // ── Scrim ──────────────────────────────────────────────────────
    const scrim = document.createElement('div');
    scrim.style.cssText = `
        position: fixed; inset: 0;
        background: rgba(13,15,16,0.72);
        z-index: 100;
        display: flex; align-items: center; justify-content: center;
        padding: 20px;
    `;

    // ── Panel ──────────────────────────────────────────────────────
    const panel = document.createElement('div');
    panel.style.cssText = `
        background: ${T.card};
        border: 1px solid ${T.border};
        border-radius: 10px;
        width: 480px; max-width: 100%; max-height: 90vh;
        display: flex; flex-direction: column;
        overflow: hidden;
    `;

    const accentBar = document.createElement('div');
    accentBar.style.cssText = `height: 4px; background: ${T.green};`;
    panel.appendChild(accentBar);

    // Header
    const header = document.createElement('div');
    header.style.cssText = `
        padding: 14px 18px; display: flex; align-items: center;
        justify-content: space-between; border-bottom: 1px solid ${T.border};
    `;
    const titleEl = document.createElement('div');
    titleEl.style.cssText = `
        font-family: ${T.fh}; font-size: 14px; font-weight: 700;
        color: ${T.text}; letter-spacing: 0.04em;
    `;
    titleEl.textContent = device.mac ? 'EDIT DEVICE' : 'SAVE DEVICE';
    header.appendChild(titleEl);

    const macStrip = document.createElement('div');
    macStrip.style.cssText = `
        font-family: 'Share Tech Mono', monospace; font-size: 10px;
        color: ${T.textMuted}; letter-spacing: 0.06em;
    `;
    macStrip.textContent = device.mac || (device.ip ? device.ip : '—');
    header.appendChild(macStrip);
    panel.appendChild(header);

    // Scrollable body
    const body = document.createElement('div');
    body.style.cssText = `
        flex: 1; overflow-y: auto;
        padding: 16px 18px; display: flex; flex-direction: column; gap: 14px;
    `;
    panel.appendChild(body);

    // ── Shared input style ────────────────────────────────────────
    const inputCss = `
        background: ${T.well}; border: 1px solid ${T.border};
        color: ${T.text}; padding: 8px 10px; border-radius: 4px;
        font-family: ${T.fb}; font-size: 12px; width: 100%; box-sizing: border-box;
        outline: none;
    `;
    const labelCss = `
        font-family: ${T.fh}; font-size: 10px; font-weight: 700;
        color: ${T.textMuted}; letter-spacing: 0.1em; text-transform: uppercase;
    `;

    // Name field
    const nameSection = document.createElement('div');
    nameSection.style.cssText = `display: flex; flex-direction: column; gap: 6px;`;
    const nameLabel = document.createElement('div');
    nameLabel.style.cssText = labelCss;
    nameLabel.textContent = 'Display Name';
    const nameInput = document.createElement('input');
    nameInput.type = 'text';
    nameInput.placeholder = 'Front Register';
    nameInput.value = device.name || '';
    nameInput.style.cssText = inputCss;
    nameSection.appendChild(nameLabel);
    nameSection.appendChild(nameInput);
    body.appendChild(nameSection);

    // Role chip group
    const roleSection = document.createElement('div');
    roleSection.style.cssText = `display: flex; flex-direction: column; gap: 6px;`;
    const roleLabel = document.createElement('div');
    roleLabel.style.cssText = labelCss;
    roleLabel.textContent = 'Role';
    const roleRow = document.createElement('div');
    roleRow.style.cssText = `display: flex; gap: 6px; flex-wrap: wrap;`;
    roleSection.appendChild(roleLabel);
    roleSection.appendChild(roleRow);
    body.appendChild(roleSection);

    // Conditional fields container — rebuilt on every role change
    const conditional = document.createElement('div');
    conditional.style.cssText = `display: flex; flex-direction: column; gap: 14px;`;
    body.appendChild(conditional);

    // ── Conditional field elements (created once, mounted/unmounted) ──
    // Receipt + Card Reader: terminal_ids chip group (re-rendered to
    // reflect role-specific labelling)
    const termSection = document.createElement('div');
    termSection.style.cssText = `display: flex; flex-direction: column; gap: 6px;`;
    const termLabel = document.createElement('div');
    termLabel.style.cssText = labelCss;
    termLabel.textContent = 'Assigned Terminals';
    termSection.appendChild(termLabel);
    let termChipsContainer = document.createElement('div');
    termSection.appendChild(termChipsContainer);

    const renderTermChips = () => {
        const fresh = buildTerminalAssignmentChips(terminals, selectedIds);
        termChipsContainer.replaceWith(fresh);
        termChipsContainer = fresh;
    };

    // Kitchen: categories CSV
    const categoriesSection = document.createElement('div');
    categoriesSection.style.cssText = `display: flex; flex-direction: column; gap: 6px;`;
    const catLabel = document.createElement('div');
    catLabel.style.cssText = labelCss;
    catLabel.textContent = 'Categories (comma-separated; blank = ALL)';
    const catInput = document.createElement('input');
    catInput.type = 'text';
    catInput.placeholder = 'apps, entrees';
    catInput.value = (device.categories === 'ALL' ? '' : (device.categories || ''));
    catInput.style.cssText = inputCss;
    categoriesSection.appendChild(catLabel);
    categoriesSection.appendChild(catInput);

    // Card reader: register_id
    const registerSection = document.createElement('div');
    registerSection.style.cssText = `display: flex; flex-direction: column; gap: 6px;`;
    const regLabel = document.createElement('div');
    regLabel.style.cssText = labelCss;
    regLabel.textContent = 'SPIn Register ID';
    const registerInput = document.createElement('input');
    registerInput.type = 'text';
    registerInput.placeholder = 'e.g. REG-001';
    registerInput.value = device.register_id || '';
    registerInput.style.cssText = inputCss;
    registerSection.appendChild(regLabel);
    registerSection.appendChild(registerInput);

    // ── Role chip rendering + role-change handler ─────────────────
    const ROLE_OPTIONS = [
        { id: 'receipt',     label: 'Receipt',     fill: T.elec },
        { id: 'kitchen',     label: 'Kitchen',     fill: T.gold },
        { id: 'card_reader', label: 'Card Reader', fill: T.green },
    ];

    const refreshConditional = () => {
        conditional.innerHTML = '';
        if (selectedRole === 'receipt' || selectedRole === 'card_reader') {
            renderTermChips();
            conditional.appendChild(termSection);
        }
        if (selectedRole === 'kitchen') {
            conditional.appendChild(categoriesSection);
        }
        if (selectedRole === 'card_reader') {
            conditional.appendChild(registerSection);
        }
    };

    const renderRoleChips = () => {
        roleRow.innerHTML = '';
        ROLE_OPTIONS.forEach(opt => {
            const isActive = selectedRole === opt.id;
            const chip = buildPillButton(
                opt.label,
                isActive ? opt.fill : T.well,
                isActive ? T.bg : T.textMuted,
                () => {
                    if (selectedRole === opt.id) return;
                    selectedRole = opt.id;
                    renderRoleChips();
                    refreshConditional();
                }
            );
            roleRow.appendChild(chip);
        });
    };

    renderRoleChips();
    refreshConditional();

    // ── Action bar ────────────────────────────────────────────────
    const actionBar = document.createElement('div');
    actionBar.style.cssText = `
        display: flex; gap: 8px; align-items: center;
        padding: 12px 18px; background: ${T.well};
        border-top: 1px solid ${T.border};
    `;

    const dismiss = () => { scrim.remove(); };

    const saveBtn = buildPillButton('SAVE', T.green, T.bg, async () => {
        const trimmedName = nameInput.value.trim();
        if (!trimmedName) {
            showToast('Name is required', 'error');
            return;
        }

        // Map role → backend `type` field. Modern saves: thermal/impact
        // for printers, card_reader for readers. Preserve device.type
        // when it already names a specific hardware variant.
        let saveType;
        if (selectedRole === 'card_reader') {
            saveType = 'card_reader';
        } else if (device.type === 'impact' || device.type === 'thermal') {
            saveType = device.type;
        } else {
            saveType = 'thermal';
        }

        const body = {
            mac:  device.mac || null,
            ip:   device.ip,
            port: device.port || (selectedRole === 'card_reader' ? 9000 : 9100),
            type: saveType,
            name: trimmedName,
            role: selectedRole,
        };

        if (selectedRole === 'receipt' || selectedRole === 'card_reader') {
            body.terminal_ids = [...selectedIds];
        }
        if (selectedRole === 'kitchen') {
            body.categories = catInput.value.trim();
        }
        if (selectedRole === 'card_reader') {
            body.register_id = registerInput.value.trim();
        }

        saveBtn.disabled = true;
        const originalLabel = saveBtn.textContent;
        saveBtn.textContent = 'SAVING…';

        try {
            const resp = await fetchWithTimeout('/api/v1/hardware/devices', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body),
            }, 8000);

            if (!resp.ok) {
                const err = await resp.json().catch(() => ({}));
                const detail = err.detail?.message || err.detail || err.message || `HTTP ${resp.status}`;
                showToast(`Save failed: ${detail}`, 'error');
                saveBtn.disabled = false;
                saveBtn.textContent = originalLabel;
                return;
            }

            const saved = await resp.json().catch(() => body);
            showToast(`${trimmedName} saved`);
            dismiss();
            if (onSaved) onSaved(saved);
        } catch (e) {
            showToast(`Save failed: ${e.message}`, 'error');
            saveBtn.disabled = false;
            saveBtn.textContent = originalLabel;
        }
    });

    const spacer = document.createElement('div');
    spacer.style.cssText = `flex: 1;`;

    const cancelBtn = buildGhostButton('CANCEL', T.textMuted, () => {
        dismiss();
        if (onCancel) onCancel();
    });

    actionBar.appendChild(saveBtn);
    actionBar.appendChild(spacer);
    actionBar.appendChild(cancelBtn);
    panel.appendChild(actionBar);

    // Scrim click dismisses (treated as cancel)
    scrim.addEventListener('click', e => {
        if (e.target === scrim) {
            dismiss();
            if (onCancel) onCancel();
        }
    });

    scrim.appendChild(panel);
    document.body.appendChild(scrim);

    return { close: dismiss };
}
