/* ============================================
   KINDpos Overseer — Nostalgia Design Tokens

   Single source of truth for the Overseer-Nostalgia visual system.
   Mirrors the naming of terminal/tokens.js (`T`) for mental
   consistency, but carries Overseer-Nostalgia values (darker
   surface, desktop-scale type) rather than the terminal's
   1024×600 terminal scale.

   `ui/forms.js` re-exports the palette slice as `C` so existing
   consumers keep working without edits.
   ============================================ */

// ─── Palette (hex + rgba) ──────────────────────────────────────────
const palette = {
  bg:         '#383c42',
  card:       '#2e3236',
  well:       '#22252a',
  gold:       '#f5a623',
  cyan:       '#22d3ee',
  mint:       '#C6FFBB',
  green:      '#86efac',
  greenUp:    '#4ade80',
  lavender:   '#b48efa',
  verm:       '#e8472a',
  warning:    '#fbbf24',
  text:       '#e8eaed',
  textMuted:  'rgba(232,234,237,0.55)',
  textDim:    'rgba(232,234,237,0.4)',
  border:     'rgba(232,234,237,0.08)',
};

// ─── Type scale (px numbers — append 'px' at use site) ─────────────
// Desktop scale. Terminal has its own scale in terminal/tokens.js.
const fs = {
  xs:    10, // micro meta labels
  sm:    11, // mono hints, KPI labels
  md:    12, // buttons, tab labels, subtitles
  base:  13, // card labels, body
  lg:    15, // input text, body emphasis
  xl:    20, // medium heading
  xxl:   28, // KPI value
  hero:  34, // page title
};

// ─── Spacing scale (px) ────────────────────────────────────────────
const sp = {
  xs:   4,
  sm:   8,
  md:   12,
  lg:   16,
  xl:   20,
  xxl:  24,
  xxxl: 32,
};

// ─── Radii (px) ────────────────────────────────────────────────────
const r = {
  sm:    6,
  md:    10,
  lg:    12,
  pill:  999,
};

// ─── Font families (CSS strings) ───────────────────────────────────
// These use the same CSS vars that the Nostalgia shell defines so
// terminal + overseer agree on what `var(--font-heading)` means.
const font = {
  heading: 'var(--font-heading)',
  body:    'var(--font-body)',
  mono:    'ui-monospace, monospace',
};

// ─── Public token bundle ───────────────────────────────────────────
// `T` flattens the palette onto the top level so call sites can
// write `T.green` (mirroring terminal/tokens.js) while structured
// sub-blocks (`T.fs`, `T.sp`, `T.r`, `T.font`) stay namespaced.
export const T = {
  ...palette,
  fs,
  sp,
  r,
  font,
};

// ─── Helpers ───────────────────────────────────────────────────────
export function withAlpha(hex, alpha) {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}
