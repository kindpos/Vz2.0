/* ============================================
   KINDpos Overseer — money / percent formatters

   Mirrors backend money_round 2dp ROUND_HALF_UP behavior for
   display purposes only. Values arrive pre-rounded from the
   API (or mock data); these helpers just produce strings.
   ============================================ */

// ─── fmt(n, { signed, dp, compact }) ────────────────────────────────
// Examples:
//   fmt(38417.22)                 → "$38,417.22"
//   fmt(2976.14, { signed: true}) → "+$2,976.14"
//   fmt(-50, { signed: true })    → "-$50.00"
//   fmt(38417, { compact: true }) → "$38.4k"
//   fmt(1842, { dp: 0 })          → "$1,842"
//
// Caller is responsible for passing already-rounded numbers in
// contexts where that matters (e.g. totals). We do NOT re-round
// here beyond toFixed; we format.
export function fmt(n, opts = {}) {
  const { signed = false, dp = 2, compact = false } = opts;
  const v = n ?? 0;
  if (compact && Math.abs(v) >= 1000) {
    const k = v / 1000;
    const body = '$' + k.toFixed(k >= 10 ? 0 : 1) + 'k';
    return signed && v > 0 ? '+' + body : body;
  }
  const sign = signed && v > 0 ? '+' : (v < 0 ? '-' : '');
  const abs = Math.abs(v);
  const body = '$' + abs.toFixed(dp).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return sign + body;
}

// ─── fmtPct(n, { dp, signed }) ──────────────────────────────────────
// Takes a FRACTION (0.184 → "18.4%"), not a pre-multiplied pct.
export function fmtPct(n, opts = {}) {
  const { dp = 1, signed = false } = opts;
  const v = n ?? 0;
  const pct = v * 100;
  const sign = signed && pct > 0 ? '+' : (pct < 0 ? '-' : '');
  return sign + Math.abs(pct).toFixed(dp) + '%';
}

// ─── fmtInt(n, { signed }) ──────────────────────────────────────────
// Comma-grouped integer, e.g. 1842 → "1,842".
export function fmtInt(n, opts = {}) {
  const { signed = false } = opts;
  const v = Math.round(n ?? 0);
  const sign = signed && v > 0 ? '+' : (v < 0 ? '-' : '');
  return sign + Math.abs(v).toLocaleString('en-US');
}

// ─── fmtPP(n, { dp, signed }) ───────────────────────────────────────
// "Percentage-points" delta, e.g. -0.003 → "-0.3pp". Distinct from
// fmtPct because a 0.3pp change on a 18% base is NOT a -0.3% change.
export function fmtPP(n, opts = {}) {
  const { dp = 1, signed = true } = opts;
  const v = (n ?? 0) * 100;
  const sign = signed && v > 0 ? '+' : (v < 0 ? '-' : '');
  return sign + Math.abs(v).toFixed(dp) + 'pp';
}
