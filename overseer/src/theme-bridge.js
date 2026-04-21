/* ============================================
   KINDpos Overseer — Theme Bridge (STUB)

   Original imported from the terminal's theme registry. In Vz1.5 the
   terminal uses a different structure (terminal/ not frontend/js/),
   so this is stubbed out for now.

   The Appearance theme-editor scene will be rebuilt against Vz2.0
   tokens later. Until then these stubs let app.js boot without
   touching any theme scene it doesn't need.
   ============================================ */

// Theme slots — empty; editor reads this for the list of editable keys
export const THEME_SLOTS = [];

// Default slot values — empty
export const DEFAULT_SLOTS = {};

// Convenience: passed-through identity map; editor uses this to
// translate flat slot overrides into the terminal's token system.
export function expandOverrides(slots) {
  return slots || {};
}

// No saved custom themes — always empty list
export function listCustomThemes() {
  return [];
}

// No active theme — always the built-in default
export function getActiveThemeId() {
  return 'terminal-glow';
}

// No customs — always null
export function getCustomTheme(_id) {
  return null;
}

// Save: no-op
export async function saveCustomTheme(_theme) {
  console.warn('[theme-bridge] saveCustomTheme is stubbed — theme editor is disabled');
  return { ok: false, error: 'theme editor not available in this build' };
}

// Delete: no-op
export async function deleteCustomTheme(_id) {
  console.warn('[theme-bridge] deleteCustomTheme is stubbed');
  return { ok: false };
}

// Set active: no-op
export async function setActiveTheme(_id) {
  console.warn('[theme-bridge] setActiveTheme is stubbed');
  return { ok: false };
}

// New id generator — uses timestamp for uniqueness
export function newThemeId() {
  return 'theme-' + Date.now();
}

// Sync themes from server: resolves immediately
export async function syncThemesFromServer() {
  return [];
}

// Boot hook: no-op
export async function initThemeBridge() {
  /* stub — rebuild after Vz2.0 reskin */
}