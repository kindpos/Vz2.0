/* ============================================
   KINDpos Overseer — KINDnostic Interpreter

   Rules-based root cause analysis from diagnostic
   snapshot data. Client-side logic, no new API routes.
   ============================================ */

import { C, showToast, sectionCard } from '../ui/forms.js';

let _currentContainer = null;
let _snapshot = null;
let _lastRefresh = null;

// Rules engine: pattern match → diagnosis
const RULES = [
  {
    id: 'hash-chain-fail',
    match: (snapshot) => {
      const probes = snapshot.probes || [];
      return probes.some(p => p.id && p.id.includes('hash_chain') && p.status === 'FAIL');
    },
    severity: 'CRITICAL',
    title: 'Event Ledger Integrity Failure',
    detail: 'SHA-256 chain broken — possible tampering or data corruption detected.',
    action: 'Export full ledger backup immediately. Do not close business day until resolved. Contact KIND Technologies support.',
  },
  {
    id: 'precision-fail',
    match: (snapshot) => {
      const probes = snapshot.probes || [];
      return probes.some(p => p.id && p.id.includes('precision_gate') && p.status === 'FAIL');
    },
    severity: 'CRITICAL',
    title: 'Financial Calculation Error',
    detail: 'Rounding or decimal precision violation detected in payment calculations.',
    action: 'Suspend payment processing. Do not run end-of-day reports until resolved.',
  },
  {
    id: 'printer-fail',
    match: (snapshot) => {
      const probes = snapshot.probes || [];
      return probes.some(p => p.id && p.id.includes('printer') && p.status === 'FAIL');
    },
    severity: 'HIGH',
    title: 'Printer Connectivity Lost',
    detail: 'One or more printers not reachable on the network.',
    action: 'Check printer power and TCP connection. Kitchen: 10.0.0.19 | Receipt: 10.0.0.186',
  },
  {
    id: 'schema-fail',
    match: (snapshot) => {
      const probes = snapshot.probes || [];
      return probes.some(p => p.id && p.id.includes('schema') && p.status === 'FAIL');
    },
    severity: 'CRITICAL',
    title: 'Database Schema Version Mismatch',
    detail: 'Schema version does not match expected. Migrations may be incomplete.',
    action: 'Run pending migrations before continuing. Do not process transactions.',
  },
  {
    id: 'network-fail',
    match: (snapshot) => {
      const probes = snapshot.probes || [];
      return probes.some(p => p.id && p.id.includes('network') && p.status === 'FAIL');
    },
    severity: 'HIGH',
    title: 'Network Interface Offline',
    detail: 'eth0 or wlan0 not reachable.',
    action: 'Check network cable and router. Cloud sync and Overseer will be unavailable.',
  },
  {
    id: 'all-pass',
    match: (snapshot) => {
      const probes = snapshot.probes || [];
      return probes.length > 0 && probes.every(p => p.status === 'PASS');
    },
    severity: 'INFO',
    title: 'All Systems Nominal',
    detail: 'No issues detected in last diagnostic run.',
    action: 'No action required.',
  },
];

const fetchSnapshot = async () => {
  try {
    const res = await fetch('/api/v1/entomology/snapshot');
    if (!res.ok) return null;
    _snapshot = await res.json();
    _lastRefresh = new Date();
    return _snapshot;
  } catch (e) {
    console.warn('[Interpreter] Snapshot fetch failed:', e);
    return null;
  }
};

const matchRules = (snapshot) => {
  if (!snapshot) return [];
  return RULES.filter(rule => rule.match(snapshot));
};

const severityOrder = { CRITICAL: 0, HIGH: 1, INFO: 2 };

const renderDiagnosis = () => {
  const { card, body } = sectionCard({
    label: 'DIAGNOSIS',
    note: 'Rules-based analysis of diagnostic findings',
  });

  if (!_snapshot) {
    const msg = document.createElement('div');
    msg.style.cssText = `color: ${C.textMuted}; font-size: 13px; font-family: var(--font-body);`;
    msg.textContent = 'Loading snapshot...';
    body.appendChild(msg);
    return card;
  }

  const matches = matchRules(_snapshot);
  if (matches.length === 0) {
    const msg = document.createElement('div');
    msg.style.cssText = `color: ${C.textMuted}; font-size: 13px; font-family: var(--font-body);`;
    msg.textContent = 'No rules matched';
    body.appendChild(msg);
    return card;
  }

  // Sort by severity
  matches.sort((a, b) => severityOrder[a.severity] - severityOrder[b.severity]);

  const list = document.createElement('div');
  list.style.cssText = 'display: flex; flex-direction: column; gap: 12px;';

  matches.forEach(rule => {
    const ruleCard = document.createElement('div');
    ruleCard.style.cssText = `
      background: ${C.well};
      border-left: 4px solid ${rule.severity === 'CRITICAL' ? '#ff6b6b' : rule.severity === 'HIGH' ? '#ffa502' : '#51cf66'};
      border-radius: 4px;
      padding: 12px;
    `;

    const header = document.createElement('div');
    header.style.cssText = 'display: flex; align-items: center; gap: 8px; margin-bottom: 8px;';

    const badge = document.createElement('span');
    badge.style.cssText = `
      padding: 3px 8px;
      border-radius: 3px;
      font-size: 10px;
      font-weight: 600;
      text-transform: uppercase;
      background: ${rule.severity === 'CRITICAL' ? '#ff6b6b44' : rule.severity === 'HIGH' ? '#ffa50244' : '#51cf6644'};
      color: ${rule.severity === 'CRITICAL' ? '#ff6b6b' : rule.severity === 'HIGH' ? '#ffa502' : '#51cf66'};
      font-family: var(--font-body);
    `;
    badge.textContent = rule.severity;
    header.appendChild(badge);

    const titleEl = document.createElement('span');
    titleEl.style.cssText = `
      font-weight: 600;
      color: ${C.textBody};
      font-family: var(--font-body);
      font-size: 13px;
    `;
    titleEl.textContent = rule.title;
    header.appendChild(titleEl);

    ruleCard.appendChild(header);

    const detail = document.createElement('div');
    detail.style.cssText = `
      color: ${C.textBody};
      font-size: 12px;
      font-family: var(--font-body);
      margin-bottom: 8px;
      line-height: 1.4;
    `;
    detail.textContent = rule.detail;
    ruleCard.appendChild(detail);

    const action = document.createElement('div');
    action.style.cssText = `
      color: ${C.textMuted};
      font-size: 11px;
      font-family: var(--font-body);
      padding-top: 8px;
      border-top: 1px solid ${C.border};
      line-height: 1.4;
    `;
    action.innerHTML = '<strong>Action:</strong> ' + rule.action;
    ruleCard.appendChild(action);

    list.appendChild(ruleCard);
  });

  body.appendChild(list);
  return card;
};

const renderRawEvents = () => {
  const { card, body } = sectionCard({
    label: 'RAW EVENTS',
    note: 'Last 50 diagnostic events from snapshot',
  });

  if (!_snapshot || !_snapshot.groups) {
    const msg = document.createElement('div');
    msg.style.cssText = `color: ${C.textMuted}; font-size: 13px; font-family: var(--font-body);`;
    msg.textContent = 'No events available';
    body.appendChild(msg);
    return card;
  }

  // Flatten events from all categories
  const allEvents = [];
  for (const [cat, byCode] of Object.entries(_snapshot.groups || {})) {
    for (const [code, events] of Object.entries(byCode || {})) {
      allEvents.push(...(events || []));
    }
  }

  // Sort newest first
  allEvents.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
  const events = allEvents.slice(0, 50);

  if (events.length === 0) {
    const msg = document.createElement('div');
    msg.style.cssText = `color: ${C.textMuted}; font-size: 13px; font-family: var(--font-body);`;
    msg.textContent = 'No events';
    body.appendChild(msg);
    return card;
  }

  const table = document.createElement('table');
  table.style.cssText = `
    width: 100%;
    border-collapse: collapse;
    font-size: 11px;
    font-family: ui-monospace, monospace;
  `;

  // Header
  const thead = document.createElement('thead');
  const headerRow = document.createElement('tr');
  headerRow.style.cssText = `border-bottom: 1px solid ${C.border};`;
  ['Timestamp', 'Category', 'Code', 'Severity'].forEach(label => {
    const th = document.createElement('th');
    th.style.cssText = `
      text-align: left;
      padding: 6px;
      font-weight: 600;
      color: ${C.textMuted};
      border-bottom: 1px solid ${C.border};
    `;
    th.textContent = label;
    headerRow.appendChild(th);
  });
  thead.appendChild(headerRow);
  table.appendChild(thead);

  // Body
  const tbody = document.createElement('tbody');
  events.forEach((ev, idx) => {
    const row = document.createElement('tr');
    row.style.cssText = `
      border-bottom: 1px solid ${C.border};
      ${idx % 2 === 0 ? `background: ${C.well};` : ''}
    `;

    const ts = new Date(ev.timestamp);
    const tsStr = ts.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });

    [tsStr, ev.category || '—', ev.event_code || '—', ev.severity || '—'].forEach(text => {
      const td = document.createElement('td');
      td.style.cssText = `padding: 6px; color: ${C.textBody};`;
      td.textContent = text;
      row.appendChild(td);
    });

    tbody.appendChild(row);
  });
  table.appendChild(tbody);
  body.appendChild(table);

  return card;
};

export async function buildKINDnosticInterpreterScene(container) {
  _currentContainer = container;
  container.innerHTML = '';

  // Header
  const header = document.createElement('div');
  header.style.cssText = `
    padding: 20px;
    border-bottom: 1px solid ${C.border};
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
  `;
  const titleBlock = document.createElement('div');
  const title = document.createElement('h1');
  title.style.cssText = `
    margin: 0;
    font-size: 22px;
    font-weight: 600;
    color: ${C.textBody};
    font-family: var(--font-body);
  `;
  title.textContent = 'DIAGNOSTIC INTERPRETER';
  const subtitle = document.createElement('div');
  subtitle.style.cssText = `
    margin-top: 4px;
    font-size: 12px;
    color: ${C.textMuted};
    font-family: var(--font-body);
  `;
  subtitle.textContent = 'Analyzing your last diagnostic run.';
  titleBlock.appendChild(title);
  titleBlock.appendChild(subtitle);
  header.appendChild(titleBlock);

  const refreshBtn = document.createElement('button');
  refreshBtn.textContent = 'REFRESH';
  refreshBtn.style.cssText = `
    padding: 8px 16px;
    background: ${C.border};
    border: 1px solid ${C.border};
    border-radius: 4px;
    color: ${C.textBody};
    font-family: var(--font-body);
    font-size: 12px;
    font-weight: 600;
    cursor: pointer;
  `;
  refreshBtn.addEventListener('click', async () => {
    refreshBtn.disabled = true;
    refreshBtn.textContent = 'LOADING...';
    await fetchSnapshot();
    refreshBtn.disabled = false;
    refreshBtn.textContent = 'REFRESH';
    // Re-render content
    const contentArea = document.querySelector('[data-section="interpreter-content"]');
    if (contentArea) {
      contentArea.innerHTML = '';
      contentArea.appendChild(renderDiagnosis());
      contentArea.appendChild(renderRawEvents());
      if (_lastRefresh) {
        const ts = document.createElement('div');
        ts.style.cssText = `
          font-size: 11px;
          color: ${C.textMuted};
          font-family: var(--font-body);
          margin-top: 12px;
        `;
        ts.textContent = `Last analyzed: ${_lastRefresh.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
        contentArea.appendChild(ts);
      }
    }
  });
  header.appendChild(refreshBtn);

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
  content.setAttribute('data-section', 'interpreter-content');
  container.appendChild(content);

  // Fetch snapshot and render
  await fetchSnapshot();

  if (_snapshot) {
    content.appendChild(renderDiagnosis());
    content.appendChild(renderRawEvents());

    if (_lastRefresh) {
      const ts = document.createElement('div');
      ts.style.cssText = `
        font-size: 11px;
        color: ${C.textMuted};
        font-family: var(--font-body);
        margin-top: 12px;
      `;
      ts.textContent = `Last analyzed: ${_lastRefresh.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
      content.appendChild(ts);
    }
  } else {
    const errorEl = document.createElement('div');
    errorEl.style.cssText = `
      color: ${C.textDanger};
      font-size: 13px;
      font-family: var(--font-body);
      padding: 12px;
    `;
    errorEl.textContent = 'Failed to load snapshot';
    content.appendChild(errorEl);
  }
}

export function cleanupKINDnosticInterpreter(container) {
  if (container === _currentContainer) {
    _currentContainer = null;
  }
}
