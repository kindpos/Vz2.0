// ─────────────────────────────────────────────────────────
//  terminal/scenes/qsr-order.test.js
//  Covers: item-add qty-merge, payment routing (CASH/CARD/
//  SPLIT), discount/void manager-pin gate, category switch,
//  and the empty-cart guard on all payment + action buttons.
// ─────────────────────────────────────────────────────────

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// ── Mocks ────────────────────────────────────────────────

const registeredScenes = [];

const SceneManagerMock = {
  mountWorking:      vi.fn(),
  openTransactional: vi.fn(),
  closeTransactional:vi.fn(),
  openInterrupt:     vi.fn(),
  closeInterrupt:    vi.fn(),
  on:                vi.fn(),
  off:               vi.fn(),
};

// qsr-order.js calls defineScene('qsr-order', { mount, unmount })
// — two-arg form; handle both patterns.
vi.mock('../scene-manager.js', () => ({
  SceneManager: SceneManagerMock,
  defineScene: (nameOrDef, def) => {
    if (typeof nameOrDef === 'string') {
      const scene = Object.assign({ name: nameOrDef }, def);
      registeredScenes.push(scene);
      return scene;
    }
    registeredScenes.push(nameOrDef);
    return nameOrDef;
  },
}));

vi.mock('../theme-manager.js', () => ({
  buildStaticCard:   () => document.createElement('div'),
  buildActionCard:   () => document.createElement('div'),
  buildPillButton:   () => document.createElement('button'),
  buildSectionLabel: () => document.createElement('div'),
  hexToRgba: (c) => c,
  darkenHex:  (c) => c,
}));

// /api/v1/menu rejects → MOCK_MENU fallback activates in fetchMenuData.
// /api/v1/config/store returns an empty object → default taxRate kept.
vi.mock('../net.js', () => ({
  fetchWithTimeout: vi.fn((url) => {
    if (String(url).includes('/menu')) {
      return Promise.reject(new Error('mock network error'));
    }
    return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
  }),
}));

vi.mock('../components.js', () => ({
  showToast: vi.fn(),
}));

vi.mock('./checkout-core.js', () => ({
  fmt: (n) => '$' + Number(n).toFixed(2),
}));

// ── Helpers ──────────────────────────────────────────────

function tap(el) {
  el.dispatchEvent(new Event('pointerup', { bubbles: true }));
}

// Find the button div whose label span contains the given text.
// Locates the first span with that exact text and returns its parent.
function findBtnByLabel(container, text) {
  const span = Array.from(container.querySelectorAll('span')).find(
    (el) => el.textContent === text,
  );
  return span?.parentElement;
}

// ── Suite ────────────────────────────────────────────────

describe('terminal/scenes/qsr-order', () => {
  let sceneDef;

  beforeEach(async () => {
    vi.resetModules();
    registeredScenes.length = 0;
    SceneManagerMock.mountWorking.mockClear();
    SceneManagerMock.openTransactional.mockClear();
    SceneManagerMock.openInterrupt.mockClear();
    SceneManagerMock.closeInterrupt.mockClear();

    await import('./qsr-order.js');
    sceneDef = registeredScenes.find((s) => s.name === 'qsr-order');
    expect(sceneDef, 'qsr-order scene must be registered').toBeDefined();
  });

  afterEach(() => {
    document.body.innerHTML = '';
    vi.restoreAllMocks();
  });

  async function mountScene(params = {}) {
    const container = document.createElement('div');
    document.body.appendChild(container);
    await sceneDef.mount(container, params);
    return container;
  }

  // ── 1. addItem qty-merge ─────────────────────────────────────────

  it('tapping the same tile twice merges into one line item with qty 2', async () => {
    const container = await mountScene();
    const tile = container.querySelector('[data-item-key="burger-classic"]');
    expect(tile, 'burger-classic tile must be in initial BURGERS grid').toBeTruthy();
    tap(tile);
    tap(tile);
    const rows = container.querySelectorAll('[data-item-idx]');
    expect(rows).toHaveLength(1);
    expect(rows[0].textContent).toContain('2×');
  });

  // ── 2. Empty-cart guard on payment buttons ───────────────────────

  it('cash, card, and split buttons have pointer-events:none when cart is empty', async () => {
    const container = await mountScene();
    expect(findBtnByLabel(container, 'CASH')?.style.pointerEvents).toBe('none');
    expect(findBtnByLabel(container, 'CARD')?.style.pointerEvents).toBe('none');
    expect(findBtnByLabel(container, 'SPLIT')?.style.pointerEvents).toBe('none');
  });

  // ── 3. CASH payment routing ──────────────────────────────────────

  it('CASH tap calls SceneManager.mountWorking with qsr-cash and order payload', async () => {
    const container = await mountScene();
    tap(container.querySelector('[data-item-key="burger-classic"]'));
    tap(findBtnByLabel(container, 'CASH'));
    expect(SceneManagerMock.mountWorking).toHaveBeenCalledWith(
      'qsr-cash',
      expect.objectContaining({
        order: expect.objectContaining({ items: expect.any(Array) }),
      }),
    );
  });

  // ── 4. CARD payment routing ──────────────────────────────────────

  it('CARD tap calls SceneManager.mountWorking with qsr-card and order payload', async () => {
    const container = await mountScene();
    tap(container.querySelector('[data-item-key="burger-classic"]'));
    tap(findBtnByLabel(container, 'CARD'));
    expect(SceneManagerMock.mountWorking).toHaveBeenCalledWith(
      'qsr-card',
      expect.objectContaining({
        order: expect.objectContaining({ items: expect.any(Array) }),
      }),
    );
  });

  // ── 5. SPLIT payment routing ─────────────────────────────────────

  it('SPLIT tap calls SceneManager.openTransactional with qsr-split and order payload', async () => {
    const container = await mountScene();
    tap(container.querySelector('[data-item-key="burger-classic"]'));
    tap(findBtnByLabel(container, 'SPLIT'));
    expect(SceneManagerMock.openTransactional).toHaveBeenCalledWith(
      'qsr-split',
      expect.objectContaining({
        order: expect.objectContaining({ items: expect.any(Array) }),
      }),
    );
  });

  // ── 6. DISCOUNT manager-pin gate ─────────────────────────────────

  it('DISCOUNT tap opens manager-pin interrupt with onConfirm callback', async () => {
    const container = await mountScene();
    tap(container.querySelector('[data-item-key="burger-classic"]'));
    tap(findBtnByLabel(container, 'DISCOUNT'));
    expect(SceneManagerMock.openInterrupt).toHaveBeenCalledWith(
      'manager-pin',
      expect.objectContaining({ onConfirm: expect.any(Function) }),
    );
  });

  // ── 7. VOID manager-pin gate ─────────────────────────────────────

  it('VOID tap opens manager-pin interrupt with onConfirm callback', async () => {
    const container = await mountScene();
    tap(container.querySelector('[data-item-key="burger-classic"]'));
    tap(findBtnByLabel(container, 'VOID'));
    expect(SceneManagerMock.openInterrupt).toHaveBeenCalledWith(
      'manager-pin',
      expect.objectContaining({ onConfirm: expect.any(Function) }),
    );
  });

  // ── 8. Category switching repaints the item grid ─────────────────

  it('tapping a category tile repaints the item grid with that category items', async () => {
    const container = await mountScene();
    tap(container.querySelector('[data-category-key="SIDES"]'));
    // The item grid is the only element with display:grid in the scene.
    const grid = Array.from(container.querySelectorAll('div')).find(
      (el) => el.style.display === 'grid',
    );
    expect(grid, 'item grid must exist').toBeTruthy();
    expect(grid.querySelector('[data-item-key="fries-sm"]')).toBeTruthy();
    expect(grid.querySelector('[data-item-key="burger-classic"]')).toBeNull();
  });
});
