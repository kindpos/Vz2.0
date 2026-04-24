// Smoke test for half-placement-overlay.
// Pins the button-theme migration: canonical buildPillButton (no SM2 shim
// wrapper, no legacy token aliases), CANCEL + LEFT + RIGHT all wired to the
// correct callback, and the overlay mounts without throwing when the list is
// empty or populated.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

vi.mock('./entomology-client.js', () => ({
  entReport: vi.fn(() => Promise.resolve()),
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

describe('terminal/half-placement-overlay', () => {
  let SceneManager;
  let showHalfPlacementOverlay;

  beforeEach(async () => {
    vi.resetModules();
    setupDom();
    ({ SceneManager } = await import('./scene-manager.js'));
    SceneManager.init();
    ({ showHalfPlacementOverlay } = await import('./half-placement-overlay.js'));
  });

  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('registers the "half-placement" interrupt scene on import', () => {
    // Opening the interrupt is the only externally-observable proof of
    // registration — hasInterrupt() flips true once mount completes.
    showHalfPlacementOverlay('Pizza', 'Olives', 1.50, 0.75, []);
    expect(SceneManager.hasInterrupt()).toBe(true);
  });

  it('renders CANCEL + LEFT + RIGHT buttons via buildPillButton', () => {
    showHalfPlacementOverlay('Pizza', 'Olives', 1.50, 0.75, []);
    const layer = document.getElementById('layer-interrupt');
    const buttons = layer.querySelectorAll('button');
    // buildPillButton produces <button>. Legacy buildStyledButton returned
    // {wrap, inner} divs — if this assertion ever hits 0, the migration
    // regressed to the shim.
    expect(buttons.length).toBe(3);
    const labels = Array.from(buttons).map((b) => b.textContent);
    expect(labels).toEqual(['CANCEL', 'LEFT', 'RIGHT']);
  });

  it('CANCEL button fires onCancel; promise rejects', async () => {
    const promise = showHalfPlacementOverlay('Pizza', 'Olives', 1.50, 0.75, []);
    const cancelBtn = document.querySelector('button[data-role="cancel"]');
    expect(cancelBtn).toBeTruthy();
    cancelBtn.dispatchEvent(new Event('pointerup'));
    await expect(promise).rejects.toThrow('Interrupt cancelled');
  });

  it('LEFT button resolves with side:"Left"', async () => {
    const promise = showHalfPlacementOverlay('Pizza', 'Olives', 1.50, 0.75, []);
    const leftBtn = document.querySelector('button[data-side="LEFT"]');
    expect(leftBtn).toBeTruthy();
    leftBtn.dispatchEvent(new Event('pointerup'));
    await expect(promise).resolves.toEqual({ side: 'Left' });
  });

  it('RIGHT button resolves with side:"Right"', async () => {
    const promise = showHalfPlacementOverlay('Pizza', 'Olives', 1.50, 0.75, []);
    const rightBtn = document.querySelector('button[data-side="RIGHT"]');
    expect(rightBtn).toBeTruthy();
    rightBtn.dispatchEvent(new Event('pointerup'));
    await expect(promise).resolves.toEqual({ side: 'Right' });
  });

  it('renders existing mods split into Left / Right columns', () => {
    const mods = [
      { name: 'Pepperoni', price: 1.00, prefix: 'Left' },
      { name: 'Mushrooms', price: 1.25, prefix: 'Right' },
      { name: 'Cheese',    price: 0,    prefix: null    },
    ];
    showHalfPlacementOverlay('Pizza', 'Olives', 1.50, 0.75, mods);
    const layer = document.getElementById('layer-interrupt');
    const text = layer.textContent;
    expect(text).toContain('Pepperoni');
    expect(text).toContain('Mushrooms');
    // "Cheese" is a whole-pizza mod, so on its own it doesn't appear in either
    // side list — it only appears as an "Xtra" badge if the user is picking a
    // duplicate. The overlay is built from the left/right arrays only.
    expect(text).not.toContain('Cheese');
  });

  it('empty side lists show placeholder copy', () => {
    showHalfPlacementOverlay('Pizza', 'Olives', 1.50, 0.75, []);
    const layer = document.getElementById('layer-interrupt');
    expect(layer.textContent).toContain('Nothing on left');
    expect(layer.textContent).toContain('Nothing on right');
  });
});
