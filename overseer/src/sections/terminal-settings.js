/* ============================================
   KINDpos Overseer — Terminal Settings (Nostalgia)

   Register and configure POS terminals: role, default
   floor-plan section, and training mode.
   ============================================ */

import { pushChanges } from '../services/config-push.js';
import {
  T, C, withAlpha,
  buildScenePage, sectionCard, field, checkboxChip, chipGroup,
  button, openModal, showToast,
} from '../ui/forms.js';

const ROLES = [
  { id: 'register', label: 'Register' },
  { id: 'kitchen',  label: 'Kitchen'  },
  { id: 'bar',      label: 'Bar'      },
  { id: 'manager',  label: 'Manager'  },
  { id: 'expo',     label: 'Expo'     },
];

const NO_SECTION = '__none__';

let _container = null;

/* ------------------------------------------
   DATA FETCH
------------------------------------------ */
const fetchTerminals = async () => {
  try {
    const res = await fetch('/api/v1/config/terminals');
    if (!res.ok) return [];
    return await res.json();
  } catch { return []; }
}

const fetchFloorSections = async () => {
  try {
    const res = await fetch('/api/v1/config/floorplan/sections');
    if (!res.ok) return [];
    return await res.json();
  } catch { return []; }
}

const sectionOptions = (sections) => [
    { id: NO_SECTION, label: '(none)' ;,
    ...sections.map(s => ({
      id: s.id || s.section_id,
      label: s.name || s.label,
    })),
  ];
}

/* ------------------------------------------
   ID ASSIGNMENT
   Terminal IDs are auto-generated in "T-NN" form so staff can't
   collide on handles like "front register"; the human-readable
   label lives in the Name field. Gaps are NOT backfilled — always
   take max + 1 so retired IDs stay retired in the ledger history.
------------------------------------------ */
const TERMINAL_ID_PREFIX = 'T-';

const nextTerminalId = (existing) => {
  let max = 0;
  for (const t of (existing || [])) {
    const id = t && t.terminal_id;
    if (typeof id !== 'string') continue;
    const m = /^T-(\d+)$/i.exec(id);
    if (!m) continue;
    const n = parseInt(m[1], 10);
    if (Number.isFinite(n) && n > max) max = n;
  }
  return `${TERMINAL_ID_PREFIX}${String(max + 1).padStart(2, '0')}`;
}

/* ------------------------------------------
   ADD / EDIT MODAL
------------------------------------------ */
const openTerminalModal = (terminal, sections, existingTerminals, onSaved) => {
  const isEdit = !!terminal;

  // IDs are assigned by us (T-01, T-02, …) so the admin only picks
  // the name. On add we pre-compute the next slot; on edit we keep
  // whatever id is already on the record.
  const assignedId = isEdit
    ? (terminal.terminal_id || '')
    : nextTerminalId(existingTerminals);

  const draft = {
    terminal_id:        assignedId,
    name:               terminal?.name              || '',
    role:               terminal?.role              || 'register',
    default_section_id: terminal?.default_section_id || null,
    training_mode:      !!terminal?.training_mode,
  };

  const content = document.createElement('div');
  content.style.cssText = `display: flex; flex-direction: column; gap: ${T.sp.lg}px;`;

  // Terminal ID — read-only info line. We own the numbering.
  const idBlock = document.createElement('div');
  idBlock.style.cssText = `display: flex; flex-direction: column; gap: 6px;`;
  const idLbl = document.createElement('div');
  idLbl.style.cssText = `
    font-family: ${T.font.body};
    font-size: ${T.fs.base}px;
    color: ${T.textMuted};
    font-weight: 600;
    letter-spacing: 0.3px;
  `;
  idLbl.textContent = 'Terminal ID';
  idBlock.appendChild(idLbl);
  const idValue = document.createElement('div');
  idValue.style.cssText = `
    padding: 10px 14px;
    background: ${T.well};
    color: ${T.text};
    border: 1px solid ${T.border};
    border-radius: ${T.r.sm}px;
    font-family: ${T.font.mono};
    font-size: ${T.fs.lg}px;
    letter-spacing: 1px;
    display: flex; align-items: center; justify-content: space-between;
    gap: ${T.sp.md}px;
  `;
  const idValueText = document.createElement('span');
  idValueText.textContent = assignedId;
  idBlock.style.minHeight = '0';
  idValue.appendChild(idValueText);
  const idNote = document.createElement('span');
  idNote.textContent = isEdit ? 'ASSIGNED' : 'AUTO-ASSIGNED';
  idNote.style.cssText = `
    font-family: ${T.font.mono};
    font-size: ${T.fs.xs}px;
    letter-spacing: 1.5px;
    text-transform: uppercase;
    color: ${T.textDim};
  `;
  idValue.appendChild(idNote);
  idBlock.appendChild(idValue);
  content.appendChild(idBlock);

  // Name
  const nameF = field({
    label: 'Name',
    id: 'ts-name',
    value: draft.name,
    placeholder: 'Front Register',
    required: true,
  });
  nameF.input.addEventListener('input', e => { draft.name = e.target.value; });
  content.appendChild(nameF.wrap);

  // Role (single-select chip group)
  const roleWrap = document.createElement('div');
  roleWrap.style.cssText = `display: flex; flex-direction: column; gap: 6px;`;
  const roleLbl = document.createElement('label');
  roleLbl.style.cssText = `
    font-family: ${T.font.body};
    font-size: ${T.fs.base}px;
    color: ${T.textMuted};
    font-weight: 600;
    letter-spacing: 0.3px;
  `;
  roleLbl.textContent = 'Role';
  roleWrap.appendChild(roleLbl);
  const roleChips = chipGroup({
    options: ROLES,
    selected: [draft.role],
    mode: 'single',
    onChange: (sel) => { draft.role = sel[0] || 'register'; },
  });
  roleWrap.appendChild(roleChips.wrap);
  content.appendChild(roleWrap);

  // Default Section (single-select chip group — (none) + each section)
  const secWrap = document.createElement('div');
  secWrap.style.cssText = `display: flex; flex-direction: column; gap: 6px;`;
  const secLbl = document.createElement('label');
  secLbl.style.cssText = roleLbl.style.cssText;
  secLbl.textContent = 'Default Section';
  secWrap.appendChild(secLbl);
  const secOpts = sectionOptions(sections);
  const secChips = chipGroup({
    options: secOpts,
    selected: [draft.default_section_id || NO_SECTION],
    mode: 'single',
    onChange: (sel) => {
      const v = sel[0] || NO_SECTION;
      draft.default_section_id = v === NO_SECTION ? null : v;
    },
  });
  secWrap.appendChild(secChips.wrap);
  content.appendChild(secWrap);

  // Training mode
  const trainingChip = checkboxChip({
    label: 'Training Mode',
    checked: draft.training_mode,
    onChange: (on) => { draft.training_mode = on; },
  });
  content.appendChild(trainingChip.wrap);

  // Footer buttons
  let modalRef = null;
  const cancelBtn = button({
    label: 'Cancel',
    variant: 'ghost',
    onClick: () => modalRef.close(),
  });
  const saveBtn = button({
    label: isEdit ? 'Save' : 'Add Terminal',
    variant: 'primary',
    onClick: async () => {
      const terminalId = (draft.terminal_id || '').trim();
      const name = (draft.name || '').trim();
      if (!name) {
        showToast('Name is required', 'error');
        return;
      }
      saveBtn.disabled = true;
      saveBtn.style.opacity = '0.6';
      saveBtn.textContent = 'Saving...';

      const payload = {
        terminal_id: terminalId,
        name,
        role: draft.role,
        default_section_id: draft.default_section_id,
        training_mode: draft.training_mode,
      };

      try {
        const result = await pushChanges([{
          event_type: isEdit ? 'terminal.updated' : 'terminal.registered',
          payload,
        }]);
        if (!result.ok) throw new Error('push failed');
        showToast(`Terminal ${isEdit ? 'updated' : 'added'}`);
        modalRef.close();
        onSaved();
      } catch (e) {
        console.warn('[Terminal Settings] save failed:', e);
        showToast('Failed to save', 'error');
        saveBtn.disabled = false;
        saveBtn.style.opacity = '1';
        saveBtn.textContent = isEdit ? 'Save' : 'Add Terminal';
      }
    },
  });

  modalRef = openModal({
    title: isEdit ? `Edit Terminal: ${terminal.name || terminal.terminal_id}` : 'Add Terminal',
    content,
    footer: [cancelBtn, saveBtn],
    width: 520,
  });
}

/* ------------------------------------------
   TERMINAL ROW
------------------------------------------ */
const buildTerminalRow = (terminal, sections, onRefresh) => {
  const roleLabel = (ROLES.find(r => r.id === terminal.role) || {}).label || terminal.role;
  const section = terminal.default_section_id
    ? sections.find(s => (s.id || s.section_id) === terminal.default_section_id)
    : null;
  const sectionLabel = section ? (section.name || section.label) : null;

  const row = document.createElement('div');
  row.style.cssText = `
    display: flex;
    align-items: center;
    gap: ${T.sp.lg}px;
    padding: ${T.sp.md}px ${T.sp.lg}px;
    background: ${T.well};
    border-radius: ${T.r.sm}px;
    border-left: 3px solid ${terminal.training_mode ? T.warning : T.green};
    flex-wrap: wrap;
  `;

  const info = document.createElement('div');
  info.style.cssText = 'flex: 1; min-width: 200px; display: flex; flex-direction: column; gap: 4px;';

  const nameLine = document.createElement('div');
  nameLine.style.cssText = `
    display: flex; align-items: center; gap: ${T.sp.sm}px;
    font-family: ${T.font.heading};
    font-size: ${T.fs.xl}px;
    color: ${T.text};
    font-weight: 700;
    letter-spacing: 0.5px;
  `;
  const nameText = document.createElement('span');
  nameText.textContent = terminal.name || terminal.terminal_id;
  nameLine.appendChild(nameText);
  if (terminal.training_mode) {
    const badge = document.createElement('span');
    badge.textContent = 'TRAINING';
    badge.style.cssText = `
      font-family: ${T.font.mono};
      font-size: ${T.fs.xs}px;
      letter-spacing: 1.5px;
      color: ${T.warning};
      background: ${withAlpha(T.warning, 0.15)};
      padding: 2px 8px;
      border-radius: ${T.r.sm}px;
      font-weight: 700;
    `;
    nameLine.appendChild(badge);
  }
  info.appendChild(nameLine);

  const meta = document.createElement('div');
  meta.style.cssText = `
    display: flex; flex-wrap: wrap; gap: ${T.sp.md}px;
    font-family: ${T.font.mono};
    font-size: ${T.fs.base}px;
    color: ${T.textMuted};
  `;
  const metaParts = [
    { key: 'ID',      val: terminal.terminal_id, color: T.text },
    { key: 'Role',    val: roleLabel,            color: T.green },
  ];
  if (sectionLabel) metaParts.push({ key: 'Section', val: sectionLabel, color: T.cyan });
  metaParts.forEach(part => {
    const span = document.createElement('span');
    span.innerHTML = `<span style="color:${T.textDim};letter-spacing:1.5px;text-transform:uppercase;font-size:${T.fs.xs}px;">${part.key}</span> <span style="color:${part.color};font-weight:600;">${part.val}</span>`;
    meta.appendChild(span);
  });
  info.appendChild(meta);

  row.appendChild(info);

  const editBtn = button({
    label: 'Edit',
    variant: 'ghost',
    onClick: () => openTerminalModal(terminal, sections, [], onRefresh),
  });
  row.appendChild(editBtn);

  return row;
}

/* ------------------------------------------
   MAIN RENDER
------------------------------------------ */
const render = async (container) => {
  const [terminals, sections] = await Promise.all([fetchTerminals(), fetchFloorSections()]);

  const { body } = buildScenePage(container, {
    title: 'Terminal Settings',
    subtitle: 'Register POS terminals and assign roles',
  });

  // Action bar — Add button
  const actionBar = document.createElement('div');
  actionBar.style.cssText = `
    display: flex; justify-content: flex-end;
    margin-bottom: ${T.sp.sm}px;
  `;
  actionBar.appendChild(button({
    label: '+ Add Terminal',
    variant: 'primary',
    onClick: () => openTerminalModal(null, sections, terminals, () => render(container)),
  }));
  body.appendChild(actionBar);

  // Terminal list
  const listCard = sectionCard({
    label: `Registered Terminals [${terminals.length}]`,
    accent: T.green,
  });

  if (terminals.length === 0) {
    const empty = document.createElement('div');
    empty.style.cssText = `
      padding: ${T.sp.xxxl}px;
      text-align: center;
      color: ${T.textMuted};
      font-family: ${T.font.body};
      font-size: ${T.fs.base}px;
    `;
    empty.textContent = 'No terminals registered. Click + Add Terminal to begin.';
    listCard.body.appendChild(empty);
  } else {
    terminals.forEach(t => {
      listCard.body.appendChild(buildTerminalRow(t, sections, () => render(container)));
    });
  }
  body.appendChild(listCard.card);
}

/* ------------------------------------------
   SCENE API
------------------------------------------ */
export function buildTerminalSettingsScene(container) {
  _container = container;
  render(container).catch(e => console.error('[Terminal Settings] Mount error:', e));
}

export function cleanupTerminalSettings(container) {
  if (container) container.innerHTML = '';
  _container = null;
}
