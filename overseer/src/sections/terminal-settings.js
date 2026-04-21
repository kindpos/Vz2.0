/* ============================================
   KINDpos Overseer — Terminal Settings
   Register and configure POS terminals.
   ============================================ */

import { pushChanges } from '../services/config-push.js';

const ROLES = [
    { id: 'register',  label: 'Register'   },
    { id: 'kitchen',   label: 'Kitchen'    },
    { id: 'bar',       label: 'Bar'        },
    { id: 'manager',   label: 'Manager'    },
    { id: 'expo',      label: 'Expo'       },
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

async function fetchTerminals() {
    try {
        const res = await fetch('/api/v1/config/terminals');
        if (!res.ok) return [];
        return await res.json();
    } catch { return []; }
}

async function fetchFloorSections() {
    try {
        const res = await fetch('/api/v1/config/floorplan/sections');
        if (!res.ok) return [];
        return await res.json();
    } catch { return []; }
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

function select(label, id, value, options) {
    const wrap = document.createElement('div');
    wrap.style.cssText = 'margin-bottom: 14px;';
    const lbl = document.createElement('label');
    lbl.textContent = label;
    lbl.style.cssText = 'display:block;font-family:var(--font-body);font-size:16px;color:var(--color-mint);margin-bottom:4px;';
    wrap.appendChild(lbl);
    const sel = document.createElement('select');
    sel.id = id;
    sel.className = 'kp-date-input';
    sel.style.cssText += 'width:100%;font-size:20px;cursor:pointer;';
    options.forEach(opt => {
        const o = document.createElement('option');
        o.value = opt.id; o.textContent = opt.label;
        o.style.background = 'var(--color-bg-dark)';
        if (opt.id === value) o.selected = true;
        sel.appendChild(o);
    });
    wrap.appendChild(sel);
    return { wrap, input: sel };
}

function openTerminalModal(terminal, sections, onSave) {
    const isEdit = !!terminal;
    const overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.75);z-index:5000;display:flex;align-items:center;justify-content:center;';
    const modal = document.createElement('div');
    modal.style.cssText = 'background:var(--color-bg);border:2px solid var(--color-gold);border-radius:12px;width:500px;max-height:85vh;overflow-y:auto;padding:24px;';
    modal.innerHTML = `<div style="font-family:var(--font-heading);font-size:28px;color:var(--color-gold);margin-bottom:16px;">${isEdit ? 'Edit' : 'Add'} Terminal</div>`;

    const idF = input('Terminal ID *', 'ts-id', terminal?.terminal_id || '', 'terminal_01');
    if (isEdit) { idF.input.disabled = true; idF.input.style.opacity = '0.6'; }
    const nameF = input('Name', 'ts-name', terminal?.name || '', 'Front Register');
    const roleF = select('Role', 'ts-role', terminal?.role || 'register', ROLES);

    const sectionOpts = [{ id: '', label: '(none)' }, ...sections.map(s => ({ id: s.id || s.section_id, label: s.name || s.label }))];
    const sectionF = select('Default Section', 'ts-section', terminal?.default_section_id || '', sectionOpts);

    const trainingWrap = document.createElement('label');
    trainingWrap.style.cssText = 'display:inline-flex;align-items:center;gap:10px;padding:10px 16px;border-radius:6px;cursor:pointer;background:var(--color-bg-dark);border:1px solid rgba(var(--color-mint-rgb),0.15);color:var(--color-mint);font-family:var(--font-body);font-size:20px;margin-bottom:14px;';
    const trainingCb = document.createElement('input');
    trainingCb.type = 'checkbox';
    trainingCb.checked = terminal?.training_mode || false;
    trainingCb.style.cssText = 'accent-color:var(--color-mint);width:18px;height:18px;';
    trainingWrap.appendChild(trainingCb);
    trainingWrap.appendChild(document.createTextNode('Training Mode'));

    modal.appendChild(idF.wrap);
    modal.appendChild(nameF.wrap);
    modal.appendChild(roleF.wrap);
    modal.appendChild(sectionF.wrap);
    modal.appendChild(trainingWrap);

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
    saveBtn.textContent = isEdit ? 'Save' : 'Add Terminal';
    saveBtn.style.cssText = 'padding:12px 24px;background:var(--color-mint);border:none;border-radius:8px;color:var(--color-bg);font-family:var(--font-body);font-size:20px;font-weight:bold;cursor:pointer;';
    saveBtn.addEventListener('click', async () => {
        const terminalId = idF.input.value.trim();
        if (!terminalId) { showToast('Terminal ID is required', 'error'); return; }
        saveBtn.disabled = true;
        saveBtn.textContent = 'Saving...';

        const payload = {
            terminal_id: terminalId,
            name: nameF.input.value.trim() || terminalId,
            role: roleF.input.value,
            default_section_id: sectionF.input.value || null,
            training_mode: trainingCb.checked,
        };
        const result = await pushChanges([{
            event_type: isEdit ? 'terminal.updated' : 'terminal.registered',
            payload,
        }]);
        if (result.ok) {
            overlay.remove();
            showToast(`Terminal ${isEdit ? 'updated' : 'added'}`);
            onSave();
        } else {
            saveBtn.disabled = false;
            saveBtn.textContent = isEdit ? 'Save' : 'Add Terminal';
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
    wrapper.style.cssText = 'max-width:900px;margin:0 auto;padding:30px 24px 60px;';

    const header = document.createElement('div');
    header.style.cssText = 'display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:24px;flex-wrap:wrap;gap:12px;';
    header.innerHTML = `
        <div>
            <div style="font-family:var(--font-heading);font-size:44px;color:var(--color-gold);">\u{1F5A5}\u{FE0F} Terminal Settings</div>
            <div style="font-size:18px;color:rgba(var(--color-mint-rgb),0.5);margin-top:4px;">Register POS terminals and assign roles</div>
        </div>
    `;
    const [terminals, sections] = await Promise.all([fetchTerminals(), fetchFloorSections()]);

    const addBtn = document.createElement('button');
    addBtn.type = 'button';
    addBtn.textContent = '+ Add Terminal';
    addBtn.style.cssText = 'background:var(--color-mint);color:var(--color-bg);border:none;border-radius:8px;padding:12px 24px;font-family:var(--font-body);font-size:20px;font-weight:bold;cursor:pointer;';
    addBtn.addEventListener('click', () => openTerminalModal(null, sections, () => render(container)));
    header.appendChild(addBtn);
    wrapper.appendChild(header);

    if (terminals.length === 0) {
        const empty = document.createElement('div');
        empty.style.cssText = 'padding:60px 20px;text-align:center;color:rgba(var(--color-mint-rgb),0.4);font-size:22px;';
        empty.textContent = 'No terminals registered. Click + Add Terminal to begin.';
        wrapper.appendChild(empty);
    } else {
        terminals.forEach(t => {
            const card = document.createElement('div');
            card.style.cssText = 'background:rgba(var(--color-mint-rgb),0.06);border:1px solid rgba(var(--color-mint-rgb),0.2);border-radius:8px;padding:18px 22px;margin-bottom:12px;display:flex;justify-content:space-between;align-items:center;gap:16px;flex-wrap:wrap;';
            const roleLabel = (ROLES.find(r => r.id === t.role) || {}).label || t.role;
            const sectionLabel = t.default_section_id ? (sections.find(s => (s.id || s.section_id) === t.default_section_id) || {}).name : null;
            card.innerHTML = `
                <div style="flex:1;min-width:200px;">
                    <div style="font-family:var(--font-heading);color:var(--color-gold);font-size:26px;margin-bottom:4px;">${t.name || t.terminal_id} ${t.training_mode ? '<span style="font-size:16px;color:var(--color-gold);background:rgba(var(--color-gold-rgb),0.2);padding:2px 8px;border-radius:4px;margin-left:8px;">TRAINING</span>' : ''}</div>
                    <div style="font-family:var(--font-mono,monospace);font-size:18px;color:rgba(var(--color-mint-rgb),0.7);">
                        <span style="color:rgba(var(--color-mint-rgb),0.4);">ID:</span> ${t.terminal_id}
                        &nbsp;<span style="color:rgba(var(--color-mint-rgb),0.4);">Role:</span> ${roleLabel}
                        ${sectionLabel ? `&nbsp;<span style="color:rgba(var(--color-mint-rgb),0.4);">Section:</span> ${sectionLabel}` : ''}
                    </div>
                </div>
            `;
            const editBtn = document.createElement('button');
            editBtn.type = 'button';
            editBtn.textContent = 'Edit';
            editBtn.style.cssText = 'padding:8px 16px;background:rgba(var(--color-mint-rgb),0.1);border:1px solid rgba(var(--color-mint-rgb),0.25);border-radius:6px;color:var(--color-mint);font-family:var(--font-body);font-size:18px;cursor:pointer;';
            editBtn.addEventListener('click', () => openTerminalModal(t, sections, () => render(container)));
            card.appendChild(editBtn);
            wrapper.appendChild(card);
        });
    }

    container.appendChild(wrapper);
}

export function buildTerminalSettingsScene(container) {
    currentContainer = container;
    render(container).catch(e => console.error('[TerminalSettings] Mount error:', e));
}

export function cleanupTerminalSettings(container) {
    if (container) container.innerHTML = '';
    currentContainer = null;
}
