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
export const expandOverrides = (slots) => slots || {};

// No saved custom themes — always empty list
export const listCustomThemes = () => [];

// No active theme — always the built-in default
export const getActiveThemeId = () => 'terminal-glow';

// No customs — always null
export const getCustomTheme = (_id) => null;

// Save: no-op
export const saveCustomTheme = async (_theme) => {
  console.warn('[theme-bridge] saveCustomTheme is stubbed — theme editor is disabled');
  return { ok: false, error: 'theme editor not available in this build' };
};

// Delete: no-op
export const deleteCustomTheme = async (_id) => {
  console.warn('[theme-bridge] deleteCustomTheme is stubbed');
  return { ok: false };
};

// Set active: no-op
export const setActiveTheme = async (_id) => {
  console.warn('[theme-bridge] setActiveTheme is stubbed');
  return { ok: false };
};

// New id generator — uses timestamp for uniqueness
export const newThemeId = () => `theme-${Date.now()}`;

// Sync themes from server: resolves immediately
export const syncThemesFromServer = async () => [];

// Boot hook: no-op
export const initThemeBridge = async () => {
  /* stub — rebuild after Vz2.0 reskin */
};