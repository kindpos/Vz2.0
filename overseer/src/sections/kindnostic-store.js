/* ============================================
   KINDpos Overseer — KINDnostic Diagnostic Archive

   Download diagnostic event reports in Excel format
   with customizable date ranges and export options.
   ============================================ */

import { T } from '../ui/tokens.js';
import { C, showToast, sectionCard, button } from '../ui/forms.js';

let _currentContainer = null;
let _selectedDays = 30;
let _loadingSnapshot = false;

const fetchSnapshot = async () => {
  try {
    _loadingSnapshot = true;
    const res = await fetch('/api/v1/entomology/snapshot');
    if (!res.ok) return null;
    return await res.json();
  } catch (e) {
    console.warn('[KINDnostic Store] Snapshot fetch failed:', e);
    return null;
  } finally {
    _loadingSnapshot = false;
  }
};

const formatTimestamp = (iso) => {
  if (!iso) return '—';
  try {
    const d = new Date(iso);
    return d.toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  } catch {
    return iso;
  }
};

const downloadReport = async () => {
  try {
    const url = `/api/v1/entomology/report.xlsx?days=${_selectedDays}`;
    const response = await fetch(url);
    if (!response.ok) {
      showToast('Download failed', 'error');
      return;
    }
    const blob = await response.blob();
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `kindpos-diagnostic-${_selectedDays}d-${new Date().toISOString().slice(0, 10)}.xlsx`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(a.href);
    showToast('Report downloaded');
  } catch (e) {
    console.error('[KINDnostic Store] Download failed:', e);
    showToast('Download error: ' + String(e).slice(0, 60), 'error');
  }
};

const renderSummary = async () => {
  const { card, body } = sectionCard({
    label: 'EVENT SUMMARY',
    note: 'Live snapshot of diagnostic activity',
  });

  const errorEl = document.createElement('div');
  errorEl.style.cssText = `
    color: ${C.textDanger};
    font-size: 13px;
    font-family: var(--font-body);
    margin-bottom: 12px;
    display: none;
  `;
  body.appendChild(errorEl);

  const loadingEl = document.createElement('div');
  loadingEl.style.cssText = `
    color: ${C.textMuted};
    font-size: 13px;
    font-family: var(--font-body);
    margin-bottom: 12px;
  `;
  loadingEl.textContent = 'LOADING...';
  body.appendChild(loadingEl);

  const dataEl = document.createElement('div');
  dataEl.style.cssText = `
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 12px;
    display: none;
  `;
  body.appendChild(dataEl);

  // Fetch snapshot
  const snapshot = await fetchSnapshot();
  loadingEl.style.display = 'none';

  if (!snapshot) {
    errorEl.style.display = 'block';
    errorEl.textContent = 'Failed to load snapshot';
    return card;
  }

  dataEl.style.display = 'grid';

  // Calculate event counts
  const groups = snapshot.groups || {};
  let totalEvents = 0;
  let criticalCount = 0;
  for (const [cat, byCode] of Object.entries(groups)) {
    for (const [code, events] of Object.entries(byCode)) {
      totalEvents += events.length;
      if (events.some(e => e.severity === 'CRITICAL')) {
        criticalCount += events.filter(e => e.severity === 'CRITICAL').length;
      }
    }
  }

  // Get latest event timestamp
  let latestTs = '—';
  for (const [cat, byCode] of Object.entries(groups)) {
    for (const [code, events] of Object.entries(byCode)) {
      if (events.length > 0) {
        const latest = events[0];
        const ts = new Date(latest.timestamp);
        if (!latestTs || ts > new Date(latestTs)) {
          latestTs = latest.timestamp;
        }
      }
    }
  }

  const items = [
    { label: 'Total Events', value: String(totalEvents) },
    { label: 'Critical', value: String(criticalCount) },
    { label: 'Latest Event', value: formatTimestamp(latestTs) },
  ];

  items.forEach(item => {
    const box = document.createElement('div');
    box.style.cssText = `
      background: ${C.well};
      border: 1px solid ${C.border};
      border-radius: 6px;
      padding: 12px;
      text-align: center;
    `;
    const lbl = document.createElement('div');
    lbl.style.cssText = `
      font-size: 11px;
      color: ${C.textMuted};
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      margin-bottom: 4px;
      font-family: var(--font-body);
    `;
    lbl.textContent = item.label;
    const val = document.createElement('div');
    val.style.cssText = `
      font-size: 18px;
      font-weight: 600;
      color: ${C.textBody};
      font-family: ui-monospace, monospace;
    `;
    val.textContent = item.value;
    box.appendChild(lbl);
    box.appendChild(val);
    dataEl.appendChild(box);
  });

  return card;
};

const renderDateRange = () => {
  const { card, body } = sectionCard({
    label: 'EXPORT WINDOW',
    note: 'Select date range for the report',
  });

  const btnRow = document.createElement('div');
  btnRow.style.cssText = `
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: 8px;
    margin-bottom: 16px;
  `;
  body.appendChild(btnRow);

  const options = [
    { label: '7 DAYS', value: 7 },
    { label: '14 DAYS', value: 14 },
    { label: '30 DAYS', value: 30 },
    { label: '90 DAYS', value: 90 },
  ];

  const updateSelection = () => {
    btnRow.querySelectorAll('button').forEach(btn => {
      const val = parseInt(btn.dataset.value, 10);
      btn.style.background = val === _selectedDays ? T.accent : C.border;
      btn.style.color = val === _selectedDays ? '#fff' : C.textBody;
      btn.style.borderColor = val === _selectedDays ? T.accent : C.border;
    });
  };

  options.forEach(opt => {
    const btn = document.createElement('button');
    btn.dataset.value = opt.value;
    btn.textContent = opt.label;
    btn.style.cssText = `
      padding: 10px 12px;
      border: 1px solid ${C.border};
      border-radius: 6px;
      background: ${C.border};
      color: ${C.textBody};
      font-family: var(--font-body);
      font-size: 12px;
      font-weight: 600;
      cursor: pointer;
      transition: background 0.2s, color 0.2s;
    `;
    btn.addEventListener('click', () => {
      _selectedDays = opt.value;
      updateSelection();
    });
    btnRow.appendChild(btn);
  });

  updateSelection();

  const dlBtn = button({
    label: 'DOWNLOAD REPORT',
    variant: 'primary',
    onClick: downloadReport,
  });
  dlBtn.style.width = '100%';
  body.appendChild(dlBtn.parentElement || dlBtn);

  return card;
};

export async function buildKINDnosticStoreScene(container) {
  _currentContainer = container;
  container.innerHTML = '';

  // Page header
  const header = document.createElement('div');
  header.style.cssText = `
    padding: 20px;
    border-bottom: 1px solid ${C.border};
  `;
  const title = document.createElement('h1');
  title.style.cssText = `
    margin: 0;
    font-size: 22px;
    font-weight: 600;
    color: ${C.textBody};
    font-family: var(--font-body);
  `;
  title.textContent = 'DIAGNOSTIC ARCHIVE';
  header.appendChild(title);
  container.appendChild(header);

  // Content area
  const content = document.createElement('div');
  content.style.cssText = `
    padding: 20px;
    display: flex;
    flex-direction: column;
    gap: 20px;
    max-width: 800px;
  `;
  container.appendChild(content);

  // Fetch and render snapshot summary
  const summaryCard = await renderSummary();
  content.appendChild(summaryCard);

  // Render date range selector
  const rangeCard = renderDateRange();
  content.appendChild(rangeCard);
}

export function cleanupKINDnosticStore(container) {
  if (container === _currentContainer) {
    _currentContainer = null;
  }
}
