/* ============================================
   KINDpos Overseer — KINDnostic Settings & Config

   View probe tier assignments, run probes on-demand,
   and review system threshold configuration.
   ============================================ */

import { T } from '../ui/tokens.js';
import { C, showToast, sectionCard, button } from '../ui/forms.js';

let _currentContainer = null;
let _runningTier = null;

// Probe tier and category metadata
const PROBE_METADATA = [
  { name: 'dummy', tier: 'PASSIVE', category: 'LOW', probe: 'probe_dummy' },
  { name: 'entomology_heartbeat', tier: 'PASSIVE', category: 'LOW', probe: 'probe_entomology_heartbeat' },
  { name: 'network_interface', tier: 'PASSIVE', category: 'LOW', probe: 'probe_network_interface' },
  { name: 'last_boot_result', tier: 'PASSIVE', category: 'LOW', probe: 'probe_last_boot_result' },
  { name: 'uptime_since_last_close', tier: 'PASSIVE', category: 'LOW', probe: 'probe_uptime_since_last_close' },
  { name: 'database_integrity', tier: 'POLITE', category: 'CRITICAL', probe: 'probe_database_integrity' },
  { name: 'database_writable', tier: 'POLITE', category: 'CRITICAL', probe: 'probe_database_writable' },
  { name: 'schema_version', tier: 'POLITE', category: 'CRITICAL', probe: 'probe_schema_version' },
  { name: 'clock_sync', tier: 'POLITE', category: 'HIGH', probe: 'probe_clock_sync' },
  { name: 'display_resolution', tier: 'POLITE', category: 'HIGH', probe: 'probe_display_resolution' },
  { name: 'ssd_health', tier: 'POLITE', category: 'HIGH', probe: 'probe_ssd_health' },
  { name: 'kitchen_printer_reachable', tier: 'POLITE', category: 'HIGH', probe: 'probe_kitchen_printer_reachable' },
  { name: 'receipt_printer_reachable', tier: 'POLITE', category: 'HIGH', probe: 'probe_receipt_printer_reachable' },
  { name: 'hash_chain_integrity', tier: 'DEEP', category: 'CRITICAL', probe: 'probe_hash_chain_integrity' },
  { name: 'precision_gate', tier: 'DEEP', category: 'CRITICAL', probe: 'probe_precision_gate' },
];

const fetchSnapshot = async () => {
  try {
    const res = await fetch('/api/v1/entomology/snapshot');
    if (!res.ok) return null;
    return await res.json();
  } catch (e) {
    console.warn('[KINDnostic Settings] Snapshot fetch failed:', e);
    return null;
  }
};

const runProbesByTier = async (tier) => {
  try {
    _runningTier = tier;
    const token = sessionStorage.getItem('entomology.token');
    const headers = {};
    if (token) headers['Authorization'] = `Bearer ${token}`;

    const res = await fetch(`/api/v1/entomology/run-probes?tier=${tier}`, { headers });
    if (!res.ok) {
      showToast(`Failed to run ${tier} probes`, 'error');
      return null;
    }
    return await res.json();
  } catch (e) {
    console.error('[KINDnostic Settings] Probe run failed:', e);
    showToast('Probe execution error: ' + String(e).slice(0, 60), 'error');
    return null;
  } finally {
    _runningTier = null;
  }
};

const renderProbeTable = async () => {
  const { card, body } = sectionCard({
    label: 'PROBE TIER ASSIGNMENTS',
    note: 'All probes in the system with their execution tier and last result',
  });

  const loadingEl = document.createElement('div');
  loadingEl.style.cssText = `
    color: ${C.textMuted};
    font-size: 13px;
    font-family: var(--font-body);
    padding: 12px;
  `;
  loadingEl.textContent = 'LOADING...';
  body.appendChild(loadingEl);

  const snapshot = await fetchSnapshot();
  loadingEl.remove();

  if (!snapshot) {
    const errorEl = document.createElement('div');
    errorEl.style.cssText = `
      color: ${C.textDanger};
      font-size: 13px;
      font-family: var(--font-body);
    `;
    errorEl.textContent = 'Failed to load probe status';
    body.appendChild(errorEl);
    return card;
  }

  // Build probe status map
  const probeStatus = {};
  if (snapshot.probes) {
    snapshot.probes.forEach(p => {
      probeStatus[p.id] = p;
    });
  }

  // Create table
  const table = document.createElement('table');
  table.style.cssText = `
    width: 100%;
    border-collapse: collapse;
    font-size: 12px;
    font-family: var(--font-body);
  `;

  // Header
  const thead = document.createElement('thead');
  const headerRow = document.createElement('tr');
  headerRow.style.cssText = `
    border-bottom: 2px solid ${C.border};
    background: ${C.well};
  `;
  ['Probe', 'Tier', 'Category', 'Last Result'].forEach(label => {
    const th = document.createElement('th');
    th.style.cssText = `
      text-align: left;
      padding: 10px;
      font-weight: 600;
      color: ${C.textMuted};
      text-transform: uppercase;
      letter-spacing: 0.5px;
    `;
    th.textContent = label;
    headerRow.appendChild(th);
  });
  thead.appendChild(headerRow);
  table.appendChild(thead);

  // Body
  const tbody = document.createElement('tbody');
  PROBE_METADATA.forEach((meta, idx) => {
    const row = document.createElement('tr');
    row.style.cssText = `
      border-bottom: 1px solid ${C.border};
      ${idx % 2 === 0 ? `background: ${C.well};` : ''}
    `;

    // Name
    const nameCell = document.createElement('td');
    nameCell.style.cssText = 'padding: 10px; color: ' + C.textBody + ';';
    nameCell.textContent = meta.name;
    row.appendChild(nameCell);

    // Tier
    const tierCell = document.createElement('td');
    tierCell.style.cssText = 'padding: 10px;';
    const tierBadge = document.createElement('span');
    tierBadge.style.cssText = `
      padding: 4px 8px;
      border-radius: 3px;
      font-weight: 600;
      font-size: 11px;
      background: ${meta.tier === 'DEEP' ? '#ff6b6b44' : meta.tier === 'POLITE' ? '#4dabf744' : '#51cf6644'};
      color: ${meta.tier === 'DEEP' ? '#ff6b6b' : meta.tier === 'POLITE' ? '#4dabf7' : '#51cf66'};
    `;
    tierBadge.textContent = meta.tier;
    tierCell.appendChild(tierBadge);
    row.appendChild(tierCell);

    // Category
    const catCell = document.createElement('td');
    catCell.style.cssText = 'padding: 10px; color: ' + C.textMuted + ';';
    catCell.textContent = meta.category;
    row.appendChild(catCell);

    // Status
    const statusCell = document.createElement('td');
    statusCell.style.cssText = 'padding: 10px;';
    const status = probeStatus[meta.probe] || {};
    const statusText = status.status || '—';
    const statusColor = statusText === 'PASS' ? '#51cf66' : statusText === 'FAIL' ? '#ff6b6b' : '#ffa502';
    statusCell.style.color = statusColor;
    statusCell.style.fontWeight = '600';
    statusCell.textContent = statusText;
    row.appendChild(statusCell);

    tbody.appendChild(row);
  });
  table.appendChild(tbody);
  body.appendChild(table);

  return card;
};

const renderProbeRunner = () => {
  const { card, body } = sectionCard({
    label: 'RUN PROBES',
    note: 'Execute probes on-demand to refresh system health checks',
  });

  const btnRow = document.createElement('div');
  btnRow.style.cssText = `
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 12px;
  `;
  body.appendChild(btnRow);

  const tiers = [
    { label: 'RUN PASSIVE', value: 'passive', note: '' },
    { label: 'RUN POLITE', value: 'polite', note: '' },
    { label: 'RUN DEEP', value: 'deep', note: 'Walks full event ledger' },
  ];

  tiers.forEach(tier => {
    const wrapper = document.createElement('div');
    wrapper.style.cssText = 'display: flex; flex-direction: column; gap: 8px;';

    const btn = button({
      label: tier.label,
      variant: 'secondary',
      onClick: async () => {
        btn.disabled = true;
        btn.textContent = 'RUNNING...';
        const result = await runProbesByTier(tier.value);
        btn.disabled = false;
        btn.textContent = tier.label;
        if (result) {
          showToast(`${tier.label.split(' ')[1]} probes completed`);
          // Re-render the probe table (in real app would update in place)
        }
      },
    });
    btn.style.padding = '10px 12px';

    if (tier.note) {
      const note = document.createElement('div');
      note.style.cssText = `
        font-size: 11px;
        color: ${C.textMuted};
        font-family: var(--font-body);
      `;
      note.textContent = tier.note;
      wrapper.appendChild(note);
    }
    wrapper.appendChild(btn);
    btnRow.appendChild(wrapper);
  });

  return card;
};

const renderThresholds = () => {
  const { card, body } = sectionCard({
    label: 'SYSTEM DEFAULTS',
    note: 'Alert thresholds and configuration parameters',
  });

  const note = document.createElement('div');
  note.style.cssText = `
    color: ${C.textMuted};
    font-size: 12px;
    font-family: var(--font-body);
    margin-bottom: 16px;
    padding: 12px;
    background: ${C.well};
    border-radius: 4px;
    border-left: 3px solid ${C.textMuted};
  `;
  note.textContent = 'To change thresholds, update environment variables and restart the service.';
  body.appendChild(note);

  const thresholds = [
    { label: 'Disk Usage Warning', value: '85%' },
    { label: 'Disk Usage Critical', value: '95%' },
    { label: 'Memory Usage Warning', value: '85%' },
    { label: 'Memory Usage Critical', value: '95%' },
    { label: 'CPU Temperature Warning', value: '75°C' },
    { label: 'CPU Temperature Critical', value: '85°C' },
    { label: 'Heartbeat Stale Warning', value: '120s' },
    { label: 'Event Ledger Stale Critical', value: '3600s' },
  ];

  const grid = document.createElement('div');
  grid.style.cssText = `
    display: grid;
    grid-template-columns: repeat(2, 1fr);
    gap: 12px;
  `;
  body.appendChild(grid);

  thresholds.forEach(item => {
    const box = document.createElement('div');
    box.style.cssText = `
      background: ${C.well};
      border: 1px solid ${C.border};
      border-radius: 6px;
      padding: 12px;
    `;
    const lbl = document.createElement('div');
    lbl.style.cssText = `
      font-size: 12px;
      color: ${C.textMuted};
      font-weight: 600;
      margin-bottom: 4px;
      font-family: var(--font-body);
    `;
    lbl.textContent = item.label;
    const val = document.createElement('div');
    val.style.cssText = `
      font-size: 14px;
      color: ${C.textBody};
      font-weight: 600;
      font-family: ui-monospace, monospace;
    `;
    val.textContent = item.value;
    box.appendChild(lbl);
    box.appendChild(val);
    grid.appendChild(box);
  });

  return card;
};

export async function buildKINDnosticSettingsScene(container) {
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
  title.textContent = 'DIAGNOSTIC CONFIGURATION';
  header.appendChild(title);
  container.appendChild(header);

  // Content area
  const content = document.createElement('div');
  content.style.cssText = `
    padding: 20px;
    display: flex;
    flex-direction: column;
    gap: 20px;
    max-width: 1000px;
  `;
  container.appendChild(content);

  // Probe tier assignments
  const probeCard = await renderProbeTable();
  content.appendChild(probeCard);

  // Probe runner
  const runCard = renderProbeRunner();
  content.appendChild(runCard);

  // Thresholds
  const threshCard = renderThresholds();
  content.appendChild(threshCard);
}

export function cleanupKINDnosticSettings(container) {
  if (container === _currentContainer) {
    _currentContainer = null;
  }
}
