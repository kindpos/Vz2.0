/* ============================================
   KINDpos Overseer — KINDnostic Diagnostic Survey

   Symptom checklist → recommended probe tiers.
   Guides operators to the right diagnostics.
   ============================================ */

import { C, showToast, sectionCard, button } from '../ui/forms.js';

let _currentContainer = null;
let _selectedSymptoms = new Set();
let _recommendedTiers = [];
let _runningTiers = [];
let _results = {};

const SYMPTOMS = [
  { id: 'payments', label: 'Payments processing slowly or failing', tiers: ['DEEP'] },
  { id: 'printer', label: 'Kitchen or receipt printer not responding', tiers: ['POLITE'] },
  { id: 'reports', label: 'Reports showing incorrect totals', tiers: ['DEEP'] },
  { id: 'network', label: 'Network connectivity issues', tiers: ['PASSIVE'] },
  { id: 'performance', label: 'System running slowly or crashing', tiers: ['POLITE'] },
  { id: 'integrity', label: 'Concerned about data integrity', tiers: ['DEEP'] },
  { id: 'clockin', label: 'Employee clock-in/out not recording', tiers: ['POLITE'] },
];

const mapSymptomsToTiers = (symptoms) => {
  const tiers = new Set();
  const has = {
    integrity: symptoms.has('payments') || symptoms.has('reports') || symptoms.has('integrity'),
    hardware: symptoms.has('printer') || symptoms.has('performance'),
    network: symptoms.has('network'),
    database: symptoms.has('clockin') || symptoms.has('performance'),
  };

  if (has.integrity) tiers.add('DEEP');
  if (has.hardware || has.database) tiers.add('POLITE');
  if (has.network) tiers.add('PASSIVE');

  const order = ['PASSIVE', 'POLITE', 'DEEP'];
  return order.filter(t => tiers.has(t));
};

const runProbesByTier = async (tier) => {
  try {
    const token = sessionStorage.getItem('entomology.token');
    const headers = {};
    if (token) headers['Authorization'] = `Bearer ${token}`;

    // Deep tier requires confirmation
    if (tier === 'DEEP') {
      if (!confirm('This will walk the full event ledger. Continue?')) {
        return null;
      }
    }

    const res = await fetch(`/api/v1/entomology/run-probes?tier=${tier}`, { headers });
    if (!res.ok) {
      showToast(`Failed to run ${tier} probes`, 'error');
      return null;
    }
    return await res.json();
  } catch (e) {
    console.error('[Survey] Probe run failed:', e);
    showToast('Probe execution error', 'error');
    return null;
  }
};

const renderSymptomChecklist = () => {
  const { card, body } = sectionCard({
    label: 'WHAT ARE YOU OBSERVING?',
    note: 'Select all that apply to your situation',
  });

  const list = document.createElement('div');
  list.style.cssText = 'display: flex; flex-direction: column; gap: 12px;';

  SYMPTOMS.forEach(symptom => {
    const wrapper = document.createElement('label');
    wrapper.style.cssText = `
      display: flex;
      align-items: center;
      gap: 12px;
      cursor: pointer;
      padding: 8px;
      border-radius: 4px;
      transition: background 0.2s;
    `;
    wrapper.addEventListener('mouseenter', () => {
      wrapper.style.background = C.well;
    });
    wrapper.addEventListener('mouseleave', () => {
      wrapper.style.background = 'transparent';
    });

    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.style.cssText = 'cursor: pointer; width: 18px; height: 18px;';
    checkbox.addEventListener('change', () => {
      if (checkbox.checked) {
        _selectedSymptoms.add(symptom.id);
      } else {
        _selectedSymptoms.delete(symptom.id);
      }
      updateAnalyzeButton();
    });
    wrapper.appendChild(checkbox);

    const label = document.createElement('span');
    label.style.cssText = `
      color: ${C.textBody};
      font-family: var(--font-body);
      font-size: 14px;
    `;
    label.textContent = symptom.label;
    wrapper.appendChild(label);

    list.appendChild(wrapper);
  });

  body.appendChild(list);
  return card;
};

const updateAnalyzeButton = () => {
  const btn = document.querySelector('[data-action="analyze"]');
  if (btn) {
    btn.disabled = _selectedSymptoms.size === 0;
    btn.style.opacity = _selectedSymptoms.size === 0 ? '0.5' : '1';
    btn.style.cursor = _selectedSymptoms.size === 0 ? 'not-allowed' : 'pointer';
  }
};

const renderRecommendation = () => {
  _recommendedTiers = mapSymptomsToTiers(_selectedSymptoms);

  const { card, body } = sectionCard({
    label: 'RECOMMENDED ACTION',
    note: 'Based on your symptoms, run these probes',
  });

  const desc = document.createElement('div');
  desc.style.cssText = `
    color: ${C.textBody};
    font-family: var(--font-body);
    font-size: 13px;
    margin-bottom: 16px;
  `;

  const tierNames = _recommendedTiers.map(t => `${t}`).join(' → ');
  desc.textContent = `We'll run: ${tierNames}`;
  body.appendChild(desc);

  const runBtn = button({
    label: 'RUN DIAGNOSTICS',
    variant: 'primary',
    onClick: async () => {
      runBtn.disabled = true;
      runBtn.textContent = 'RUNNING...';
      _results = {};

      for (const tier of _recommendedTiers) {
        const result = await runProbesByTier(tier);
        if (result && result.results) {
          _results[tier] = result.results;
        }
      }

      runBtn.disabled = false;
      runBtn.textContent = 'RUN DIAGNOSTICS';

      // Re-render to show results
      const container = document.querySelector('[data-section="survey-results"]');
      if (container) {
        container.innerHTML = '';
        container.appendChild(renderResultsDisplay());
      }
    },
  });
  runBtn.setAttribute('data-action', 'analyze');
  runBtn.style.width = '100%';
  body.appendChild(runBtn.parentElement || runBtn);

  return card;
};

const renderResultsDisplay = () => {
  const wrapper = document.createElement('div');
  wrapper.style.cssText = 'display: flex; flex-direction: column; gap: 12px;';

  for (const tier of _recommendedTiers) {
    const probes = _results[tier] || [];
    const { card, body } = sectionCard({
      label: `${tier} TIER RESULTS`,
      note: `${probes.length} probe${probes.length !== 1 ? 's' : ''} executed`,
    });

    if (probes.length === 0) {
      const msg = document.createElement('div');
      msg.style.cssText = `color: ${C.textMuted}; font-size: 13px; font-family: var(--font-body);`;
      msg.textContent = 'No results yet';
      body.appendChild(msg);
    } else {
      const list = document.createElement('div');
      list.style.cssText = 'display: flex; flex-direction: column; gap: 8px;';

      probes.forEach(probe => {
        const item = document.createElement('div');
        item.style.cssText = `
          display: flex;
          align-items: center;
          gap: 8px;
          padding: 8px;
          background: ${C.well};
          border-radius: 4px;
          font-family: var(--font-body);
          font-size: 13px;
        `;

        const icon = document.createElement('span');
        const isPass = probe.status === 'PASS';
        icon.style.cssText = `
          font-weight: 600;
          color: ${isPass ? '#51cf66' : '#ff6b6b'};
        `;
        icon.textContent = isPass ? '✓' : '✗';
        item.appendChild(icon);

        const name = document.createElement('span');
        name.style.cssText = `color: ${C.textBody};`;
        name.textContent = probe.id;
        item.appendChild(name);

        const status = document.createElement('span');
        status.style.cssText = `
          margin-left: auto;
          color: ${C.textMuted};
          font-size: 12px;
        `;
        status.textContent = probe.status;
        item.appendChild(status);

        list.appendChild(item);
      });

      body.appendChild(list);
    }

    wrapper.appendChild(card);
  }

  return wrapper;
};

export async function buildKINDnosticSurveyScene(container) {
  _currentContainer = container;
  _selectedSymptoms.clear();
  _results = {};
  container.innerHTML = '';

  // Header
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
  title.textContent = 'DIAGNOSTIC SURVEY';
  const subtitle = document.createElement('div');
  subtitle.style.cssText = `
    margin-top: 4px;
    font-size: 12px;
    color: ${C.textMuted};
    font-family: var(--font-body);
  `;
  subtitle.textContent = "Select what you're observing. We'll run the right probes.";
  header.appendChild(title);
  header.appendChild(subtitle);
  container.appendChild(header);

  // Content
  const content = document.createElement('div');
  content.style.cssText = `
    padding: 20px;
    display: flex;
    flex-direction: column;
    gap: 20px;
    max-width: 600px;
  `;
  container.appendChild(content);

  // Symptoms checklist
  const checklistCard = renderSymptomChecklist();
  content.appendChild(checklistCard);

  // Recommendation section (initially empty)
  const recCard = renderRecommendation();
  content.appendChild(recCard);

  // Results section (shown after running)
  const resultsSection = document.createElement('div');
  resultsSection.setAttribute('data-section', 'survey-results');
  content.appendChild(resultsSection);

  // Clear button
  const clearBtn = button({
    label: 'CLEAR SELECTIONS',
    variant: 'ghost',
    onClick: () => {
      _selectedSymptoms.clear();
      _results = {};
      document.querySelectorAll('input[type="checkbox"]').forEach(cb => {
        cb.checked = false;
      });
      resultsSection.innerHTML = '';
      updateAnalyzeButton();
    },
  });
  clearBtn.style.marginTop = '12px';
  content.appendChild(clearBtn.parentElement || clearBtn);
}

export function cleanupKINDnosticSurvey(container) {
  if (container === _currentContainer) {
    _currentContainer = null;
  }
}
