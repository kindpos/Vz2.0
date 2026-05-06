// ═══════════════════════════════════════════════════
//  KINDpos Terminal — Modifier Label Helper
//
//  A modifier picked before the server taps ADD / NO / EXTRA / SUB /
//  LITE carries `prefix: null`. Raw concat ("null" + " " + label)
//  used to ship the literal string "null Pepperoni" to the kitchen
//  ticket. This helper is the single source of truth for how a
//  modifier's display label is built from { prefix, label }, so both
//  the preview and the commit path render identically.
// ═══════════════════════════════════════════════════

/**
 * Build the display label for a modifier.
 * @param {?string} prefix  One of 'ADD', 'NO', 'EXTRA', 'LITE', or
 *                          null/undefined/'' when no prefix was chosen.
 * @param {string}  label   The modifier's own label (e.g. "Pepperoni").
 * @returns {string}
 */
export function formatModifierLabel(prefix, label) {
  var safeLabel = label == null ? '' : String(label);
  if (!prefix) return safeLabel;
  return prefix + ' ' + safeLabel;
}
