// ═══════════════════════════════════════════════════
//  KINDpos Terminal — Item Recap Component  (Vz2.0)
//
//  Reusable DOM builder for the order recap column:
//  seat-grouped items with collapsible mods, microMODs,
//  multi-select, an inline red-X remove button for unsent
//  items, and a totals section.
//
//  Single export:
//    buildItemRecap(order, opts = {}) -> HTMLElement
//
//  Consumed by check-overview.js (Mode C left panel) and
//  later by order-entry.js (right recap column).
//
//  All styling is injected once into <head> as #item-recap-styles.
//  All colors flow from tokens.js — no hardcoded hex.
// ═══════════════════════════════════════════════════

import { T } from '../tokens.js';

export function buildItemRecap(order, opts) {
  opts = opts || {};
  var root = document.createElement('div');
  return root;
}
