/* ============================================
   KINDpos Overseer — Order & Service Settings (Nostalgia)

   Tax rate, cash discount, enabled order types, operating
   hours per day, auto-gratuity rules.
   ============================================ */

import { pushChanges } from '../services/config-push.js';
import {
  C, showToast, buildScenePage, sectionCard,
  field, numberField, row, chipGroup, checkboxChip, withAlpha
} from '../ui/forms.js';

const DAYS = [
  { id: 'monday',    label: 'Monday'    },
  { id: 'tuesday',   label: 'Tuesday'   },
  { id: 'wednesday', label: 'Wednesday' },
  { id: 'thursday',  label: 'Thursday'  },
  { id: 'friday',    label: 'Friday'    },
  { id: 'saturday',  label: 'Saturday'  },
  { id: 'sunday',    label: 'Sunday'    },
];

const ORDER_TYPES = [
  { id: 'dine_in',    label: 'Dine-In'    },
  { id: 'takeout',    label: 'Takeout'    },
  { id: 'delivery',   label: 'Delivery'   },
  { id: 'drive_thru', label: 'Drive-Thru' },
];

async function loadConfig() {
  try {
    const [storeRes, pricingRes] = await Promise.all([
      fetch('/api/v1/config/store'),
      fetch('/api/v1/config/pricing'),
    ]);
    const store = storeRes.ok ? await storeRes.json() : {};
    const pricing = pricingRes.ok ? await pricingRes.json() : {};
    store._pricing = pricing;
    return store;
  } catch { return {}; }
}

async function mount(container) {
  const config = await loadConfig();

  // Refs we need in save handler
  const refs = {};

  const { body } = buildScenePage(container, {
    title: 'Order & Service Settings',
    subtitle: 'Order types, operating hours, tax, and gratuity',
    onSave: async () => {
      const events = [];

      // Tax
      const taxRate = parseFloat(refs.tax.value) || 0;
      events.push({
        event_type: 'store.tax_rule_created',
        payload: { tax_rule_id: 'default', name: 'Sales Tax', rate_percent: taxRate, applies_to: 'all' },
      });

      // Cash discount
      const cashDisc = (parseFloat(refs.cashDisc.value) || 0) / 100;
      events.push({
        event_type: 'store.cc_processing_rate_updated',
        payload: { cash_discount_rate: cashDisc },
      });

      // Order types
      const selectedTypes = refs.orderTypes.getSelected();
      events.push({
        event_type: 'store.order_types_updated',
        payload: { enabled_types: selectedTypes },
      });

      // Operating hours
      const hoursPayload = {};
      DAYS.forEach(day => {
        const d = refs.hours[day.id];
        hoursPayload[day.id] = {
          open: d.open.value,
          close: d.close.value,
          enabled: d.enabled.checked,
        };
      });
      events.push({
        event_type: 'store.operating_hours_updated',
        payload: { hours: hoursPayload },
      });

      // Auto-gratuity
      events.push({
        event_type: 'store.auto_gratuity_updated',
        payload: {
          enabled: refs.agEnabled.checked,
          party_size_threshold: parseInt(refs.agParty.value) || 6,
          rate_percent: parseFloat(refs.agRate.value) || 20,
          applies_to_order_types: selectedTypes.length > 0 ? selectedTypes : ['dine_in'],
        },
      });

      const result = await pushChanges(events);
      if (result.ok) showToast('Settings saved');
      else showToast('Failed to save', 'error');
    },
  });

  // ── TAX & PRICING ────────────────────────────────────────────────
  const tax = sectionCard({ label: 'Tax & Pricing' });
  const taxField = numberField({
    label: 'Tax Rate',
    id: 'os-tax',
    value: config._pricing ? (config._pricing.tax_rate * 100).toFixed(2) : '0',
    min: 0, max: 25, step: 0.01,
    suffix: '%',
    width: 120,
  });
  taxField.wrap.style.flex = '0 0 200px';
  const cashField = numberField({
    label: 'Cash Discount Rate',
    id: 'os-cash',
    value: config._pricing ? (config._pricing.cash_discount_rate * 100).toFixed(1) : '0',
    min: 0, max: 15, step: 0.1,
    suffix: '%',
    width: 120,
  });
  cashField.wrap.style.flex = '0 0 240px';
  tax.body.appendChild(row(taxField, cashField));
  refs.tax = taxField.input;
  refs.cashDisc = cashField.input;
  body.appendChild(tax.card);

  // ── ORDER TYPES ──────────────────────────────────────────────────
  const types = sectionCard({
    label: 'Order Types',
    note: 'Types the terminal will offer when starting a new order.',
  });
  const enabledTypes = (config.order_types && config.order_types.enabled_types) || [];
  const typeGroup = chipGroup({
    options: ORDER_TYPES,
    selected: enabledTypes,
    mode: 'multi',
  });
  types.body.appendChild(typeGroup.wrap);
  refs.orderTypes = typeGroup;
  body.appendChild(types.card);

  // ── OPERATING HOURS ──────────────────────────────────────────────
  const hoursCard = sectionCard({ label: 'Operating Hours' });
  const hoursData = config.operating_hours || {};
  refs.hours = {};

  const hoursGrid = document.createElement('div');
  hoursGrid.style.cssText = `
    display: grid;
    grid-template-columns: 120px 1fr 1fr 80px;
    gap: 12px 16px;
    align-items: center;
  `;

  // Column headers
  ['Day', 'Open', 'Close', 'Enabled'].forEach(h => {
    const hdr = document.createElement('div');
    hdr.style.cssText = `
      font-family: ui-monospace, monospace;
      font-size: 11px;
      color: ${C.textDim};
      letter-spacing: 2px;
      font-weight: 700;
      text-transform: uppercase;
    `;
    hdr.textContent = h;
    hoursGrid.appendChild(hdr);
  });

  DAYS.forEach(day => {
    const data = hoursData[day.id] || { open: '11:00', close: '22:00', enabled: false };

    const dayLbl = document.createElement('div');
    dayLbl.style.cssText = `
      font-family: var(--font-body);
      font-size: 14px;
      color: ${C.text};
      font-weight: 600;
    `;
    dayLbl.textContent = day.label;
    hoursGrid.appendChild(dayLbl);

    const openI = document.createElement('input');
    openI.type = 'time';
    openI.value = data.open || '11:00';
    openI.style.cssText = `
      background: ${C.well};
      color: ${C.text};
      border: 1px solid ${C.border};
      border-radius: 6px;
      padding: 8px 12px;
      font-size: 14px;
      font-family: var(--font-body);
      outline: none;
      color-scheme: dark;
      transition: border-color 0.15s ease;
    `;
    openI.addEventListener('focus', () => openI.style.borderColor = C.gold);
    openI.addEventListener('blur',  () => openI.style.borderColor = C.border);
    hoursGrid.appendChild(openI);

    const closeI = document.createElement('input');
    closeI.type = 'time';
    closeI.value = data.close || '22:00';
    closeI.style.cssText = openI.style.cssText;
    closeI.addEventListener('focus', () => closeI.style.borderColor = C.gold);
    closeI.addEventListener('blur',  () => closeI.style.borderColor = C.border);
    hoursGrid.appendChild(closeI);

    const cbWrap = document.createElement('label');
    cbWrap.style.cssText = 'display: inline-flex; align-items: center; justify-content: center; cursor: pointer;';
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = !!data.enabled;
    cb.style.cssText = `
      accent-color: ${C.green};
      width: 20px; height: 20px;
      cursor: pointer;
    `;
    cbWrap.appendChild(cb);
    hoursGrid.appendChild(cbWrap);

    refs.hours[day.id] = { open: openI, close: closeI, enabled: cb };
  });
  hoursCard.body.appendChild(hoursGrid);
  body.appendChild(hoursCard.card);

  // ── AUTO-GRATUITY ────────────────────────────────────────────────
  const ag = config.auto_gratuity || {
    enabled: false,
    party_size_threshold: 6,
    rate_percent: 20,
    applies_to_order_types: ['dine_in'],
  };

  const agCard = sectionCard({
    label: 'Auto-Gratuity',
    note: 'Large parties auto-charged a gratuity. Applies to enabled order types above.',
  });

  const agEnabledChip = checkboxChip({ label: 'Enable auto-gratuity', checked: ag.enabled });
  agCard.body.appendChild(agEnabledChip.wrap);
  refs.agEnabled = agEnabledChip.input;

  const partyField = numberField({
    label: 'Party size threshold',
    id: 'os-ag-party',
    value: ag.party_size_threshold,
    min: 2, max: 20, step: 1,
    suffix: 'guests',
    width: 100,
  });
  partyField.wrap.style.flex = '0 0 260px';
  const rateField = numberField({
    label: 'Gratuity rate',
    id: 'os-ag-rate',
    value: ag.rate_percent,
    min: 0, max: 50, step: 0.5,
    suffix: '%',
    width: 100,
  });
  rateField.wrap.style.flex = '0 0 220px';
  agCard.body.appendChild(row(partyField, rateField));
  refs.agParty = partyField.input;
  refs.agRate = rateField.input;

  body.appendChild(agCard.card);
}

export function buildOrderSettingsScene(container) {
  mount(container).catch(e => console.error('[OrderSettings] Mount error:', e));
}

export function cleanupOrderSettings(container) {
  if (container) container.innerHTML = '';
}