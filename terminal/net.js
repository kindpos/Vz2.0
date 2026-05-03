// ═══════════════════════════════════════════════════
//  KINDpos Terminal — Net helpers  (Vz2.0)
//  fetch variants that scene code should reach for instead of bare fetch.
//  Nice. Dependable. Yours.
// ═══════════════════════════════════════════════════
//
//  fetchWithTimeout — fetch with an abort-on-timeout guard.
//  Without this, a stalled backend leaves spinners spinning until the
//  browser default network timeout (~120s). Aborts produce a normal
//  rejection that callers' .catch / try-catch can recover from.
//
//  Usage: fetchWithTimeout('/api/...', { method: 'POST', body }, 15000)
//  Default timeout: 15 seconds.
// ═══════════════════════════════════════════════════

export function fetchWithTimeout(url, opts, ms) {
  opts = opts || {};
  if (ms == null) ms = 15000;
  const controller = new AbortController();
  const timer = setTimeout(() => { controller.abort(); }, ms);
  const merged = Object.assign({}, opts, { signal: opts.signal || controller.signal });
  return fetch(url, merged).finally(() => { clearTimeout(timer); });
}
