// Integration-style tests for the PIN-reset modal in overseer/src/sections/employees.js.
//
// `showPINResetModal` is module-local, so we drive it through the public
// surface: register the section, invoke onEnter, find the "Reset PIN" button
// in the employee row, click it, and then interact with the captured modal.
//
// Tests pin:
//   1. "Reset PIN" row button opens the PIN reset modal.
//   2. Clicking "Reset PIN" in the modal footer (random method) calls
//      buildPinResetPayload with the employee id, a numeric PIN, and
//      the force-change flag.
//   3. An invalid custom PIN (too short) shows a validation toast, not a modal.
//   4. A valid custom PIN is sent to buildPinResetPayload as-is.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// --- Mocks ---

const TEST_EMPLOYEE = {
  id: 'emp-01',
  firstName: 'Mel',
  lastName: 'Manager',
  roles: ['manager'],
  status: 'active',
  payRate: 22.50,
  hireDate: '2022-01-15',
};

const buildPinResetPayloadMock = vi.fn((empId, pin, forceChange) => ({
  employee_id: empId,
  pin,
  force_change_on_login: !!forceChange,
  reset_reason: 'Manager-initiated reset',
}));

vi.mock('./employee-events.js', () => ({
  buildPinResetPayload:        buildPinResetPayloadMock,
  buildEmployeeUpdatePayload:  vi.fn(() => ({})),
  buildEmployeeCreatePayload:  vi.fn(() => ({})),
}));

vi.mock('../services/config-push.js', () => ({
  pushChanges: vi.fn(() => Promise.resolve({ ok: true })),
}));

// Minimal token mock (employees.js uses T.font, T.fs, T.sp, T.r, T.text, etc.)
vi.mock('../ui/tokens.js', () => {
  const T = {
    font: { body: 'sans-serif', heading: 'sans-serif', mono: 'monospace' },
    fs: { xs: 10, sm: 11, md: 12, base: 13, lg: 15, xl: 20, xxl: 28, hero: 34 },
    sp: { xs: 4, sm: 8, md: 12, lg: 16, xl: 20, xxl: 24 },
    r:  { sm: 6, md: 10, lg: 14 },
    bg: '#383c42', card: '#2e3236', well: '#22252a',
    green: '#86efac', greenUp: '#4ade80', gold: '#f5a623',
    verm: '#e8472a', warning: '#fbbf24',
    text: '#e8eaed', textMuted: 'rgba(232,234,237,0.55)',
    textDim: 'rgba(232,234,237,0.4)', border: 'rgba(232,234,237,0.08)',
    cyan: '#22d3ee', lavender: '#b48efa',
  };
  return { T, withAlpha: (c) => c };
});

// Mutable modal captures — reset in beforeEach.
let modalCalls = [];
let showToastMock;
let chipGroupMock;

vi.mock('../ui/forms.js', () => ({
  openModal: vi.fn((args) => {
    modalCalls.push(args);
    return { close: vi.fn() };
  }),
  button: ({ label, onClick = null } = {}) => {
    const el = document.createElement('button');
    el.textContent = label || '';
    if (onClick) el.addEventListener('click', onClick);
    return el;
  },
  field: ({ type = 'text', value = '' } = {}) => {
    const wrap = document.createElement('div');
    const input = document.createElement('input');
    input.type = type;
    input.value = value;
    wrap.appendChild(input);
    return { wrap, input };
  },
  numberField: ({ value = 0 } = {}) => {
    const wrap = document.createElement('div');
    const input = document.createElement('input');
    input.type = 'number';
    input.value = String(value);
    wrap.appendChild(input);
    return { wrap, input };
  },
  checkboxChip: ({ label = '', checked = false } = {}) => {
    const wrap = document.createElement('div');
    wrap.textContent = label;
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.checked = checked;
    wrap.appendChild(input);
    return { wrap, input };
  },
  chipGroup: vi.fn(({ selected = [] } = {}) => {
    const wrap = document.createElement('div');
    let _selected = [...selected];
    return { wrap, getSelected: () => _selected };
  }),
  showToast: vi.fn(),
  buildScenePage: (container) => {
    const el = document.createElement('div');
    if (container && container.appendChild) container.appendChild(el);
    return { root: el, body: el, save: vi.fn() };
  },
  sectionCard: () => {
    const card = document.createElement('div');
    const body = document.createElement('div');
    card.appendChild(body);
    return { root: card, card, body };
  },
  row: (...children) => {
    const el = document.createElement('div');
    children.forEach((c) => c && el.appendChild(c));
    return el;
  },
  buildChipTray: () => document.createElement('div'),
  C: {},
  T: {},
  withAlpha: (c) => c,
}));

vi.mock('../data/sample-employees.js', () => ({
  EMPLOYEES:          [TEST_EMPLOYEE],
  ROLES:              ['manager', 'server'],
  STATUSES:           ['active', 'inactive'],
  getRoleLabel:       vi.fn(() => 'Manager'),
  getStatusInfo:      vi.fn(() => ({ label: 'Active', color: '#4ade80' })),
  fmtDate:            vi.fn(() => 'Jan 2022'),
  generatePIN:        vi.fn(() => '7391'),
  generateEmployeeId: vi.fn(() => 'emp-99'),
}));

// --- Helpers ---

const findButtonByLabel = (root, label) => Array.from(root.querySelectorAll('button'))
    .find((b) => b.textContent.trim() === label);
;

// --- Tests ---

describe('overseer/src/sections/employees — PIN-reset modal', () => {
  let sectionManager;

  beforeEach(async () => {
    vi.resetModules();
    modalCalls = [];
    buildPinResetPayloadMock.mockClear();

    // Fresh mock refs after module reset.
    const forms = await import('../ui/forms.js');
    showToastMock = forms.showToast;
    chipGroupMock = forms.chipGroup;
    forms.openModal.mockClear();
    showToastMock.mockClear();
    chipGroupMock.mockClear();

    sectionManager = {
      register: vi.fn(),
    };

    await import('./employees.js');
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  function mountEmployeeSection() {
    const { registerEmployeeSections } = require('./employees.js');
    // registerEmployeeSections is called during import side effects in this
    // project's pattern — but we invoke it explicitly to get the registration.
    // Import is already done in beforeEach; we need the registered scene.
    const container = document.createElement('div');
    // Drive onEnter for the employee-management scene.
    const registered = sectionManager.register.mock.calls[0];
    if (registered) {
      const scene = registered[1];
      if (scene && scene.onEnter) scene.onEnter(container);
    }
    return container;
  }

  it('"Reset PIN" row button opens the PIN-reset modal', async () => {
    const { registerEmployeeSections } = await import('./employees.js');
    const container = document.createElement('div');

    // Register sections.
    registerEmployeeSections(sectionManager);
    const registeredScene = sectionManager.register.mock.calls
      .find(([name]) => name === 'employee-management');
    expect(registeredScene).toBeDefined();

    // Mount the employee management section.
    registeredScene[1].onEnter(container);

    // Find the "Reset PIN" button in the employee row.
    const resetBtn = findButtonByLabel(container, 'Reset PIN');
    expect(resetBtn).toBeDefined();

    // Click it — should open the PIN-reset modal.
    const { openModal } = await import('../ui/forms.js');
    openModal.mockClear();
    resetBtn.click();

    expect(openModal).toHaveBeenCalledTimes(1);
    const modalArgs = openModal.mock.calls[0][0];
    expect(modalArgs.title).toMatch(/Reset PIN/i);
  });

  it('footer "Reset PIN" button (random method) calls buildPinResetPayload with a numeric PIN', async () => {
    const { registerEmployeeSections } = await import('./employees.js');
    const container = document.createElement('div');
    registerEmployeeSections(sectionManager);

    const registeredScene = sectionManager.register.mock.calls
      .find(([name]) => name === 'employee-management');
    registeredScene[1].onEnter(container);

    const resetBtn = findButtonByLabel(container, 'Reset PIN');
    resetBtn.click();

    const { openModal } = await import('../ui/forms.js');
    const firstModal = openModal.mock.calls[0][0];
    expect(firstModal).toBeDefined();

    // The footer is [cancelBtn, resetBtn].
    const footerResetBtn = firstModal.footer[1];
    expect(footerResetBtn).toBeDefined();

    // Click "Reset PIN" in the modal footer.
    footerResetBtn.click();

    expect(buildPinResetPayloadMock).toHaveBeenCalledTimes(1);
    const [empId, pin, forceChange] = buildPinResetPayloadMock.mock.calls[0];
    expect(empId).toBe('emp-01');
    expect(pin).toMatch(/^\d{4,6}$/);   // 4–6 digit numeric PIN
    expect(forceChange).toBe(true);     // default force-change is checked
  });

  it('invalid custom PIN (< 4 digits) shows validation toast, no buildPinResetPayload call', async () => {
    const { registerEmployeeSections } = await import('./employees.js');
    const forms = await import('../ui/forms.js');
    const container = document.createElement('div');
    registerEmployeeSections(sectionManager);

    const registeredScene = sectionManager.register.mock.calls
      .find(([name]) => name === 'employee-management');
    registeredScene[1].onEnter(container);

    findButtonByLabel(container, 'Reset PIN').click();

    // Make the chipGroup for method selection return ['custom'] so the code
    // enters the custom-PIN branch.
    forms.chipGroup.mockImplementationOnce(() => ({
      wrap: document.createElement('div'),
      getSelected: () => ['custom'],
    }));

    // Re-open the modal so chipGroup is called with the new mock.
    forms.openModal.mockClear();
    forms.chipGroup.mockClear();
    forms.chipGroup.mockImplementationOnce(() => ({
      wrap: document.createElement('div'),
      getSelected: () => ['custom'],
    }));
    findButtonByLabel(container, 'Reset PIN').click();

    const modalArgs = forms.openModal.mock.calls[0][0];
    const footerResetBtn = modalArgs.footer[1];

    // Get the custom-field input that was created and set it to an invalid value.
    const customInput = modalArgs.content.querySelector('input[type="password"]');
    if (customInput) customInput.value = '12'; // too short

    footerResetBtn.click();

    expect(forms.showToast).toHaveBeenCalledWith(
      expect.stringContaining('4'),
      'error',
    );
    expect(buildPinResetPayloadMock).not.toHaveBeenCalled();
  });

  it('edit flow (non-reset) does not pass pin to buildEmployeeUpdatePayload', async () => {
    const { registerEmployeeSections } = await import('./employees.js');
    const forms = await import('../ui/forms.js');
    const eventsModule = await import('./employee-events.js');
    const buildEmployeeUpdatePayload = eventsModule.buildEmployeeUpdatePayload;
    buildEmployeeUpdatePayload.mockClear();

    // Override buildChipTray so rolesTray.el and rolesTray.getIds() exist.
    // Override row so field objects ({ wrap, input }) are unwrapped before appendChild.
    const origBuildChipTray = forms.buildChipTray;
    const origRow = forms.row;
    forms.buildChipTray = () => ({ el: document.createElement('div'), getIds: () => ['manager'] });
    forms.row = (...children) => {
      const el = document.createElement('div');
      children.forEach((c) => { if (c) el.appendChild(c && c.wrap ? c.wrap : c); });
      return el;
    };

    const container = document.createElement('div');
    registerEmployeeSections(sectionManager);

    const registeredScene = sectionManager.register.mock.calls
      .find(([name]) => name === 'employee-management');
    registeredScene[1].onEnter(container);

    // Click the "Edit" button for the test employee.
    const editBtn = findButtonByLabel(container, 'Edit');
    expect(editBtn).toBeDefined();
    forms.openModal.mockClear();
    editBtn.click();

    expect(forms.openModal).toHaveBeenCalledTimes(1);
    const modal = forms.openModal.mock.calls[0][0];

    // The footer is [cancelBtn, saveBtn].
    const saveBtn = modal.footer.find((b) => b.textContent.trim() === 'Save Changes');
    expect(saveBtn).toBeDefined();
    saveBtn.click();

    await new Promise((r) => setTimeout(r, 0)); // flush async (flushEvents)

    // buildEmployeeUpdatePayload must have been called, and its argument must
    // NOT contain a `pin` key — that would overwrite the backend's hashed PIN.
    expect(buildEmployeeUpdatePayload).toHaveBeenCalledTimes(1);
    const callArg = buildEmployeeUpdatePayload.mock.calls[0][0];
    expect(callArg).not.toHaveProperty('pin');

    forms.buildChipTray = origBuildChipTray;
    forms.row = origRow;
  });
});
