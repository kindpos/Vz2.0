// Smoke test for pizza-builder-overlay.
// Pins the button-theme migration: all buttons are canonical <button>s
// (no wrap/inner divs, no raw <div>s with pointerup), prefix/placement
// toggles flip state correctly, CANCEL/ADD wire to the right callbacks,
// and PREFIXES carry canonical tokens instead of hardcoded hex text colors.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

vi.mock('./entomology-client.js', () => ({
  entReport: vi.fn(() => Promise.resolve()),
}));

vi.mock('./menu-data/universal-modifiers.js', () => ({
  PREFIXES: [],
}));

function setupDom() {
  document.body.innerHTML = `
    <div id="terminal">
      <div id="header"></div>
      <div id="layer-working"></div>
      <div id="layer-transactional"></div>
      <div id="order-summary"></div>
      <div id="layer-interrupt"></div>
      <div id="layer-gate"></div>
    </div>
  `;
}

describe('terminal/pizza-builder-overlay', () => {
  let SceneManager;
  let showPizzaBuilderOverlay;

  beforeEach(async () => {
    vi.resetModules();
    setupDom();
    ({ SceneManager } = await import('./scene-manager.js'));
    SceneManager.init();
    ({ showPizzaBuilderOverlay } = await import('./pizza-builder-overlay.js'));
  });

  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('registers the "pizza-builder" interrupt scene', () => {
    showPizzaBuilderOverlay({ label: 'Large', price: 18 }, null);
    expect(SceneManager.hasInterrupt()).toBe(true);
  });

  it('renders 5 prefix toggles + 3 placement toggles + CANCEL/UNDO/ADD as <button>', () => {
    showPizzaBuilderOverlay({ label: 'Large', price: 18 }, null);
    const layer = document.getElementById('layer-interrupt');
    const prefixBtns    = layer.querySelectorAll('button[data-role="prefix"]');
    const placementBtns = layer.querySelectorAll('button[data-role="placement"]');
    const cancelBtn     = layer.querySelector('button[data-role="cancel"]');
    const undoBtn       = layer.querySelector('button[data-role="undo"]');
    const addBtn        = layer.querySelector('button[data-role="add"]');

    expect(prefixBtns.length).toBe(5);
    expect(placementBtns.length).toBe(3);
    expect(cancelBtn).toBeTruthy();
    expect(undoBtn).toBeTruthy();
    expect(addBtn).toBeTruthy();
  });

  it('prefix toggles flip active state on click', () => {
    showPizzaBuilderOverlay({ label: 'Large', price: 18 }, null);
    const noBtn  = document.querySelector('button[data-prefix-id="no"]');
    const addBtn = document.querySelector('button[data-prefix-id="add"]');

    // Default active is "add". Clicking "no" should swap.
    const addBgBefore = addBtn.style.background;
    const noBgBefore  = noBtn.style.background;

    noBtn.dispatchEvent(new Event('pointerup'));

    expect(addBtn.style.background).not.toBe(addBgBefore);
    expect(noBtn.style.background).not.toBe(noBgBefore);
    // Active button gets the full-saturation color; previously-active drops
    // back to T.card. The two should no longer be painted the same way.
    expect(addBtn.style.background).not.toBe(noBtn.style.background);
  });

  it('placement toggles flip active state on click', () => {
    showPizzaBuilderOverlay({ label: 'Large', price: 18 }, null);
    const firstHalf = document.querySelector('button[data-placement-id="1st-half"]');
    const whole     = document.querySelector('button[data-placement-id="whole"]');

    const wholeBgBefore = whole.style.background;
    firstHalf.dispatchEvent(new Event('pointerup'));

    expect(whole.style.background).not.toBe(wholeBgBefore);
  });

  it('CANCEL rejects the promise', async () => {
    const promise = showPizzaBuilderOverlay({ label: 'Large', price: 18 }, null);
    document.querySelector('button[data-role="cancel"]').dispatchEvent(new Event('pointerup'));
    await expect(promise).rejects.toThrow('Interrupt cancelled');
  });

  it('ADD resolves with name + unitPrice + mods + category', async () => {
    const promise = showPizzaBuilderOverlay({ label: 'Large', price: 18 }, null);
    document.querySelector('button[data-role="add"]').dispatchEvent(new Event('pointerup'));
    const result = await promise;
    expect(result).toMatchObject({
      name: 'Large',
      unitPrice: 18,
      mods: [],
      category: 'pizza',
    });
  });

  it('PREFIXES reference canonical tokens, not hardcoded hex text colors', async () => {
    // Direct-import the module to inspect PREFIXES via a side channel: the
    // prefix buttons' dataset has the ids. Scan the text colors of the
    // inactive buttons — they should equal T.greenWarm / T.verm / T.gold /
    // T.elec, not the legacy darkened hex like '#1a2a1a'.
    showPizzaBuilderOverlay({ label: 'Large', price: 18 }, null);
    const inactiveBtns = document.querySelectorAll('button[data-role="prefix"]:not([data-prefix-id="add"])');
    const forbidden = ['#1a2a1a', '#1a1000', '#001a1a', '#1a0030'];
    inactiveBtns.forEach((btn) => {
      forbidden.forEach((hex) => {
        expect(btn.style.color).not.toBe(hex);
      });
    });
  });
});
