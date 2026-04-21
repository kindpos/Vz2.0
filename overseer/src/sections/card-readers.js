/* ============================================
   KINDpos Overseer — Card Readers
   Configure payment terminals (Dejavoo SPIn, mock).
   Full CRUD via /api/v1/hardware/devices.
   ============================================ */

const READER_TYPES = [
    { id: 'dejavoo_spin', label: 'Dejavoo SPIn', defaultPort: 8443 },
    { id: 'mock',          label: 'Mock (testing)', defaultPort: 8443 },
];

let currentContainer = null;

function showToast(msg, type = 'success') {
    const toast = document.createElement('div');
    const color = type === 'error' ? 'var(--color-vermillion)' : 'var(--color-green)';
    toast.style.cssText = `position:fixed;top:24px;right:24px;z-index:10000;background:rgba(0,0,0,0.85);border:1px solid ${color};color:${color};padding:14px 24px;border-radius:8px;font-family:var(--font-body);font-size:22px;`;
    toast.textContent = msg;
    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), 3000);
}

async function fetchDevices() {
    try {
        const res = await fetch('/api/v1/hardware/devices');
        if (!res.ok) return [];
        const all = await res.json();
        return all.filter(d => d.type === 'card_reader');
    } catch { return []; }
}

async function saveDevice(device) {
    const res = await fetch('/api/v1/hardware/devices', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...device, type: 'card_reader' }),
    });
    return res.ok;
}

async function deleteDevice(mac) {
    const res = await fetch(`/api/v1/hardware/devices/${encodeURIComponent(mac)}`, {
        method: 'DELETE',
    });
    return res.ok;
}

async function testDevice(mac) {
    try {
        const res = await fetch('/api/v1/payments/test-device');
        if (!res.ok) return false;
        const data = await res.json();
        return data.connected || data.status === 'ok';
    } catch { return false; }
}

function input(label, id, value, placeholder = '', type = 'text') {
    const wrap = document.createElement('div');
    wrap.style.cssText = 'margin-bottom: 14px;';
    const lbl = document.createElement('label');
    lbl.textContent = label;
    lbl.style.cssText = 'display:block;font-family:var(--font-body);font-size:16px;color:var(--color-mint);margin-bottom:4px;';
    wrap.appendChild(lbl);
    const inp = document.createElement('input');
    inp.type = type;
    inp.id = id;
    inp.value = value || '';
    if (placeholder) inp.placeholder = placeholder;
    inp.className = 'kp-date-input';
    inp.style.cssText += 'width:100%;font-size:20px;';
    wrap.appendChild(inp);
    return { wrap, input: inp };
}

function openAddModal(onSave) {
    const overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.75);z-index:5000;display:flex;align-items:center;justify-content:center;';

    const modal = document.createElement('div');
    modal.style.cssText = 'background:var(--color-bg);border:2px solid var(--color-gold);border-radius:12px;width:500px;max-height:85vh;overflow-y:auto;padding:24px;';

    modal.innerHTML = `<div style="font-family:var(--font-heading);font-size:28px;color:var(--color-gold);margin-bottom:16px;">Add Card Reader</div>`;

    const nameF = input('Name *', 'cr-name', '', 'e.g. Front Register');
    const typeWrap = document.createElement('div');
    typeWrap.style.cssText = 'margin-bottom:14px;';
    typeWrap.innerHTML = `<label style="display:block;font-family:var(--font-body);font-size:16px;color:var(--color-mint);margin-bottom:4px;">Type</label>`;
    const typeSelect = document.createElement('select');
    typeSelect.className = 'kp-date-input';
    typeSelect.style.cssText += 'width:100%;font-size:20px;';
    READER_TYPES.forEach(t => {
        const opt = document.createElement('option');
        opt.value = t.id; opt.textContent = t.label;
        opt.style.background = 'var(--color-bg-dark)';
        typeSelect.appendChild(opt);
    });
    typeWrap.appendChild(typeSelect);

    const macF = input('MAC Address *', 'cr-mac', '', '00:11:22:33:44:55');
    const ipF = input('IP Address *', 'cr-ip', '', '10.0.0.50');
    const portF = input('Port', 'cr-port', '8443', '', 'number');
    const regF = input('Register ID', 'cr-reg', '', 'SPIn register identifier');
    const tpnF = input('TPN', 'cr-tpn', '', 'Terminal Processing Number');
    const authF = input('Auth Key', 'cr-auth', '', 'Not used for LAN SPIn');

    modal.appendChild(nameF.wrap);
    modal.appendChild(typeWrap);
    modal.appendChild(macF.wrap);
    modal.appendChild(ipF.wrap);
    modal.appendChild(portF.wrap);
    modal.appendChild(regF.wrap);
    modal.appendChild(tpnF.wrap);
    modal.appendChild(authF.wrap);

    const btnRow = document.createElement('div');
    btnRow.style.cssText = 'display:flex;justify-content:flex-end;gap:12px;margin-top:20px;';
    const cancelBtn = document.createElement('button');
    cancelBtn.type = 'button';
    cancelBtn.textContent = 'Cancel';
    cancelBtn.style.cssText = 'padding:12px 24px;background:transparent;border:1px solid #888;border-radius:8px;color:#888;font-family:var(--font-body);font-size:20px;cursor:pointer;';
    cancelBtn.addEventListener('click', () => overlay.remove());
    btnRow.appendChild(cancelBtn);

    const saveBtn = document.createElement('button');
    saveBtn.type = 'button';
    saveBtn.textContent = 'Add Reader';
    saveBtn.style.cssText = 'padding:12px 24px;background:var(--color-mint);border:none;border-radius:8px;color:var(--color-bg);font-family:var(--font-body);font-size:20px;font-weight:bold;cursor:pointer;';
    saveBtn.addEventListener('click', async () => {
        const name = nameF.input.value.trim();
        const mac = macF.input.value.trim();
        const ip = ipF.input.value.trim();
        if (!name || !mac || !ip) { showToast('Name, MAC, and IP are required', 'error'); return; }

        saveBtn.disabled = true;
        saveBtn.textContent = 'Saving...';
        const ok = await saveDevice({
            mac, ip, name,
            port: parseInt(portF.input.value) || 8443,
            register_id: regF.input.value.trim(),
            tpn: tpnF.input.value.trim(),
            auth_key: authF.input.value.trim(),
            categories: typeSelect.value,
        });
        if (ok) {
            overlay.remove();
            showToast('Card reader added');
            onSave();
        } else {
            saveBtn.disabled = false;
            saveBtn.textContent = 'Add Reader';
            showToast('Failed to save', 'error');
        }
    });
    btnRow.appendChild(saveBtn);
    modal.appendChild(btnRow);

    overlay.appendChild(modal);
    overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });
    document.body.appendChild(overlay);
}

async function render(container) {
    container.innerHTML = '';
    const wrapper = document.createElement('div');
    wrapper.style.cssText = 'max-width: 900px; margin: 0 auto; padding: 30px 24px 60px;';

    const header = document.createElement('div');
    header.style.cssText = 'display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:24px;flex-wrap:wrap;gap:12px;';
    header.innerHTML = `
        <div>
            <div style="font-family:var(--font-heading);font-size:44px;color:var(--color-gold);">\u{1F4B3} Card Readers</div>
            <div style="font-size:18px;color:rgba(var(--color-mint-rgb),0.5);margin-top:4px;">Payment terminals (Dejavoo SPIn, mock)</div>
        </div>
    `;
    const addBtn = document.createElement('button');
    addBtn.type = 'button';
    addBtn.textContent = '+ Add Reader';
    addBtn.style.cssText = 'background:var(--color-mint);color:var(--color-bg);border:none;border-radius:8px;padding:12px 24px;font-family:var(--font-body);font-size:20px;font-weight:bold;cursor:pointer;';
    addBtn.addEventListener('click', () => openAddModal(() => render(container)));
    header.appendChild(addBtn);
    wrapper.appendChild(header);

    const devices = await fetchDevices();
    if (devices.length === 0) {
        const empty = document.createElement('div');
        empty.style.cssText = 'padding:60px 20px;text-align:center;color:rgba(var(--color-mint-rgb),0.4);font-size:22px;';
        empty.textContent = 'No card readers configured. Click + Add Reader to begin.';
        wrapper.appendChild(empty);
    } else {
        devices.forEach(d => {
            const card = document.createElement('div');
            card.style.cssText = `
                background: rgba(var(--color-mint-rgb), 0.06);
                border: 1px solid rgba(var(--color-mint-rgb), 0.2);
                border-radius: 8px; padding: 18px 22px; margin-bottom: 12px;
                display: flex; justify-content: space-between; align-items: center; gap: 16px; flex-wrap: wrap;
            `;
            card.innerHTML = `
                <div style="flex:1;min-width:200px;">
                    <div style="font-family:var(--font-heading);color:var(--color-gold);font-size:26px;margin-bottom:6px;">${d.name || 'Card Reader'}</div>
                    <div style="font-family:var(--font-mono,monospace);font-size:18px;color:rgba(var(--color-mint-rgb),0.7);">
                        <span style="color:rgba(var(--color-mint-rgb),0.4);">IP:</span> ${d.ip}:${d.port || 8443}
                        &nbsp;<span style="color:rgba(var(--color-mint-rgb),0.4);">MAC:</span> ${d.mac}
                    </div>
                    ${d.register_id ? `<div style="font-family:var(--font-mono,monospace);font-size:16px;color:rgba(var(--color-mint-rgb),0.5);margin-top:2px;"><span style="color:rgba(var(--color-mint-rgb),0.3);">Reg:</span> ${d.register_id} &nbsp; <span style="color:rgba(var(--color-mint-rgb),0.3);">TPN:</span> ${d.tpn || '—'}</div>` : ''}
                </div>
            `;
            const actions = document.createElement('div');
            actions.style.cssText = 'display:flex;gap:8px;';

            const testBtn = document.createElement('button');
            testBtn.type = 'button';
            testBtn.textContent = 'Test';
            testBtn.style.cssText = 'padding:8px 16px;background:rgba(var(--color-mint-rgb),0.1);border:1px solid rgba(var(--color-mint-rgb),0.25);border-radius:6px;color:var(--color-mint);font-family:var(--font-body);font-size:18px;cursor:pointer;';
            testBtn.addEventListener('click', async () => {
                testBtn.disabled = true;
                testBtn.textContent = 'Testing...';
                const ok = await testDevice(d.mac);
                testBtn.disabled = false;
                testBtn.textContent = 'Test';
                showToast(ok ? 'Connected' : 'Connection failed', ok ? 'success' : 'error');
            });
            actions.appendChild(testBtn);

            const delBtn = document.createElement('button');
            delBtn.type = 'button';
            delBtn.textContent = 'Remove';
            delBtn.style.cssText = 'padding:8px 16px;background:transparent;border:1px solid var(--color-vermillion);border-radius:6px;color:var(--color-vermillion);font-family:var(--font-body);font-size:18px;cursor:pointer;';
            delBtn.addEventListener('click', async () => {
                if (!confirm(`Remove ${d.name}?`)) return;
                const ok = await deleteDevice(d.mac);
                if (ok) { showToast('Card reader removed'); render(container); }
                else showToast('Failed to remove', 'error');
            });
            actions.appendChild(delBtn);
            card.appendChild(actions);
            wrapper.appendChild(card);
        });
    }

    container.appendChild(wrapper);
}

export function buildCardReadersScene(container) {
    currentContainer = container;
    render(container).catch(e => console.error('[CardReaders] Mount error:', e));
}

export function cleanupCardReaders(container) {
    if (container) container.innerHTML = '';
    currentContainer = null;
}
