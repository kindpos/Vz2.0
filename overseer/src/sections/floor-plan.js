/* ============================================
   KINDpos Overseer — Floor Plan (Nostalgia)

   Section editor — add/edit/delete floor sections
   (Dining Room, Bar, Patio, etc.) with color tagging.
   Table-level layout (positions, shapes) deferred.
   ============================================ */

import { pushChanges } from '../services/config-push.js';
import {
  C, showToast, buildScenePage, sectionCard,
  field, button, openModal, colorPicker, checkboxChip, withAlpha
} from '../ui/forms.js';

const SECTION_COLORS = [
  '#ff4757', '#fcbe40', '#3742fa', '#86efac', '#e8472a',
  '#22d3ee', '#b48efa', '#ff6b81', '#ffa502',
  '#C6FFBB', '#4ade80', '#fbbf24', '#f5a623',
];

let _currentContainer = null;

const fetchSections = async () => {
  try {
    const res = await fetch('/api/v1/config/floorplan/sections');
    if (!res.ok) return [];
    return await res.json();
  } catch { return []; }
}

const openSectionEditor = (section, onSaved) => {
  const isEdit = !!section;

  // Build content
  const content = document.createElement('div');
  content.style.cssText = 'display: flex; flex-direction: column; gap: 16px;';

  const nameField = field({
    label: 'Section Name',
    id: 'fp-name',
    value: section?.name || '',
    placeholder: 'e.g. Dining Room, Bar, Patio',
    required: true,
  });
  content.appendChild(nameField.wrap);

  // Color picker block
  const colorWrap = document.createElement('div');
  colorWrap.style.cssText = 'display: flex; flex-direction: column; gap: 8px;';
  const colorLbl = document.createElement('div');
  colorLbl.style.cssText = `font-family: var(--font-body); font-size: 13px; color: ${C.textMuted}; font-weight: 600;`;
  colorLbl.textContent = 'Color';
  colorWrap.appendChild(colorLbl);

  const picker = colorPicker({
    colors: SECTION_COLORS,
    selected: section?.color || '#fcbe40',
  });
  colorWrap.appendChild(picker.wrap);
  content.appendChild(colorWrap);

  // Active toggle
  const activeChip = checkboxChip({ label: 'Active', checked: section?.active !== false });
  content.appendChild(activeChip.wrap);

  // Footer buttons
  let modal;
  const cancelBtn = button({
    label: 'Cancel',
    variant: 'ghost',
    onClick: () => modal.close(),
  });
  const saveBtn = button({
    label: isEdit ? 'Save' : 'Add Section',
    variant: 'primary',
    onClick: async () => {
      const name = nameField.input.value.trim();
      if (!name) {
        showToast('Section name is required', 'error');
        nameField.input.focus();
        return;
      }
      saveBtn.disabled = true;
      saveBtn.textContent = 'Saving...';

      const sectionId = section?.section_id
        || name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
      const payload = {
        section_id: sectionId,
        name,
        color: picker.getSelected(),
        active: activeChip.input.checked,
      };
      const result = await pushChanges([{
        event_type: isEdit ? 'floorplan.section_updated' : 'floorplan.section_created',
        payload,
      }]);
      if (result.ok) {
        modal.close();
        showToast(`Section ${isEdit ? 'updated' : 'added'}`);
        onSaved();
      } else {
        saveBtn.disabled = false;
        saveBtn.textContent = isEdit ? 'Save' : 'Add Section';
        showToast('Failed to save', 'error');
      }
    },
  });

  modal = openModal({
    title: isEdit ? 'Edit Section' : 'New Section',
    content,
    footer: [cancelBtn, saveBtn],
    width: 460,
  });

  // Auto-focus name field
  setTimeout(() => nameField.input.focus(), 50);
}

const confirmDelete = async (section, onDone) => {
  const content = document.createElement('div');
  content.innerHTML = `
    <div style="font-family: var(--font-body); font-size: 15px; color: ${C.text}; line-height: 1.5;">
      Delete section <strong style="color: ${section.color || C.gold};">${section.name}</strong>?
    </div>
    <div style="font-family: ui-monospace, monospace; font-size: 12px; color: ${C.textMuted}; margin-top: 10px;">
      This cannot be undone. Tables assigned to this section will become unassigned.
    </div>
  `;
  let modal;
  const cancelBtn = button({
    label: 'Cancel',
    variant: 'ghost',
    onClick: () => modal.close(),
  });
  const delBtn = button({
    label: 'Delete',
    variant: 'danger',
    onClick: async () => {
      delBtn.disabled = true;
      delBtn.textContent = 'Deleting...';
      const sid = section.section_id || section.id;
      const result = await pushChanges([{
        event_type: 'floorplan.section_deleted',
        payload: { section_id: sid },
      }]);
      if (result.ok) {
        modal.close();
        showToast('Section deleted');
        onDone();
      } else {
        delBtn.disabled = false;
        delBtn.textContent = 'Delete';
        showToast('Failed to delete', 'error');
      }
    },
  });
  modal = openModal({
    title: 'Confirm Delete',
    content,
    footer: [cancelBtn, delBtn],
    width: 420,
  });
}

const buildSectionRow = (section, onChanged) => {
  const id = section.section_id || section.id;
  const color = section.color || C.gold;
  const active = section.active !== false;

  const row = document.createElement('div');
  row.style.cssText = `
    display: flex;
    align-items: center;
    gap: 16px;
    padding: 14px 18px;
    background: ${C.well};
    border-radius: 8px;
    border-left: 4px solid ${color};
    transition: background 0.15s ease;
  `;
  row.addEventListener('mouseenter', () => row.style.background = withAlpha(C.text, 0.03));
  row.addEventListener('mouseleave', () => row.style.background = C.well);

  const info = document.createElement('div');
  info.style.cssText = 'flex: 1; min-width: 0;';
  info.innerHTML = `
    <div style="font-family: var(--font-heading); font-size: 18px; color: ${active ? color : C.textMuted}; font-weight: 700; letter-spacing: 0.5px;">
      ${section.name}${!active ? ` <span style="font-size: 11px; color: ${C.textDim}; font-family: ui-monospace, monospace; letter-spacing: 2px; margin-left: 8px;">(INACTIVE)</span>` : ''}
    </div>
    <div style="font-family: ui-monospace, monospace; font-size: 11px; color: ${C.textDim}; margin-top: 4px; letter-spacing: 0.5px;">
      ${id}
    </div>
  `;
  row.appendChild(info);

  const actions = document.createElement('div');
  actions.style.cssText = 'display: flex; gap: 8px; flex-shrink: 0;';
  actions.appendChild(button({
    label: 'Edit',
    variant: 'secondary',
    onClick: () => openSectionEditor(section, onChanged),
  }));
  actions.appendChild(button({
    label: 'Delete',
    variant: 'danger',
    onClick: () => confirmDelete(section, onChanged),
  }));
  row.appendChild(actions);

  return row;
}

const render = async (container) => {
  // Field refs aren't needed — no save on this page, only per-row actions.
  const { body } = buildScenePage(container, {
    title: 'Floor Plan',
    subtitle: 'Sections for organizing tables and servers',
    saveLabel: 'Add Section',
    onSave: async () => {
      openSectionEditor(null, () => render(container));
    },
  });

  // Info card — explains what this page does and what's missing
  const { card: infoCard } = sectionCard({
    label: 'Roadmap',
    note: 'Section-level organization is live. Table-level layout — positions, shapes, walls — will land in a future release alongside the terminal floor-plan view.',
    accent: C.warning,
  });
  body.appendChild(infoCard);

  // Sections list
  const sections = await fetchSections();
  const listCard = sectionCard({ label: 'Sections' });

  if (sections.length === 0) {
    const empty = document.createElement('div');
    empty.style.cssText = `
      padding: 40px 20px;
      text-align: center;
      color: ${C.textDim};
      font-family: ui-monospace, monospace;
      font-size: 13px;
      letter-spacing: 1.5px;
    `;
    empty.textContent = 'NO SECTIONS — TAP "ADD SECTION" TO BEGIN';
    listCard.body.appendChild(empty);
  } else {
    sections.forEach(s => {
      listCard.body.appendChild(buildSectionRow(s, () => render(container)));
    });
  }
  body.appendChild(listCard.card);
}

export function buildFloorPlanScene(container) {
  _currentContainer = container;
  render(container).catch(e => console.error('[FloorPlan] Mount error:', e));
}

export function cleanupFloorPlan(container) {
  if (container) container.innerHTML = '';
  _currentContainer = null;
}