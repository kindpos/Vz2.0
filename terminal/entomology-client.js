// ═══════════════════════════════════════════════════
//  KINDpos Terminal — Entomology client
//
//  Fire-and-forget posts to /api/v1/entomology/client-event.
//  Accepts UI-* event codes only (backend rejects anything else).
//  Never throws — diagnostic writes must not break the scene flow.
//  Queues events when offline and replays on `online`.
// ═══════════════════════════════════════════════════

import { fetchWithTimeout } from './net.js';

const _ENDPOINT = '/api/v1/entomology/client-event';
const _QUEUE_MAX = 50;
const _queue = [];

async function _send(body) {
  try {
    const r = await fetchWithTimeout(_ENDPOINT, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(body),
      keepalive: true,
    }, 3000);
    return r.ok;
  } catch (e) {
    return false;
  }
}

function _drain() {
  if (_queue.length === 0) return;
  const pending = _queue.splice(0);
  pending.forEach((b) => { _send(b); });
}

if (typeof window !== 'undefined') {
  window.addEventListener('online', _drain);

  // Global exception + unhandled-rejection → entReport. Uncaught errors
  // would previously surface only in the browser console; now they land
  // in entomology under UI-011 so they're visible on the dashboard + in
  // the Excel bug report. Dedupe key: source + message, capped at 20
  // distinct per page load so a loop of the same error can't flood the
  // backend.
  const _seenErrors = new Set();
  const _MAX_SEEN = 20;

  function _reportError(label, source, message, stack) {
    if (_seenErrors.size >= _MAX_SEEN) return;
    const key = `${source}|${message}`;
    if (_seenErrors.has(key)) return;
    _seenErrors.add(key);
    try {
      entReport({
        code: 'UI-011',
        source,
        message,
        ctx: stack ? { label, stack: String(stack).slice(0, 800) } : { label },
        level: 'ERROR',
      });
    } catch (_) { /* entReport itself swallows; don't recurse */ }
  }

  window.addEventListener('error', (ev) => {
    try {
      const file = ev.filename ? String(ev.filename).split('/').pop() : 'window';
      const src = file + (ev.lineno ? `:${ev.lineno}` : '');
      const msg = String(ev.message || 'uncaught error').slice(0, 500);
      const stack = (ev.error && ev.error.stack) || null;
      _reportError('error', src, msg, stack);
    } catch (_) { /* never throw from the error handler */ }
  });

  window.addEventListener('unhandledrejection', (ev) => {
    try {
      const reason = ev.reason;
      const msg = String(reason && reason.message ? reason.message : reason || 'unhandled rejection').slice(0, 500);
      const stack = (reason && reason.stack) || null;
      _reportError('unhandledrejection', 'promise', msg, stack);
    } catch (_) { /* never throw from the error handler */ }
  });
}

/**
 * Record a UI diagnostic. Never throws; returns a Promise that always resolves.
 *
 *   entReport({
 *     code:    'UI-001',
 *     source:  'scene-manager.interrupt',
 *     message: 'Interrupt stacked — prior torn down',
 *     ctx:     { prior: 'confirm-void', next: 'tip-adjust' },
 *     level:   'WARNING',   // optional; default WARNING
 *   });
 */
export function entReport(opts) {
  if (!opts || !opts.code || !opts.source || !opts.message) return Promise.resolve(false);
  const body = {
    event_code: String(opts.code),
    severity:   opts.level || 'WARNING',
    source:     String(opts.source).slice(0, 120),
    message:    String(opts.message).slice(0, 500),
    context:    opts.ctx && typeof opts.ctx === 'object' ? opts.ctx : {},
  };
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    if (_queue.length < _QUEUE_MAX) _queue.push(body);
    return Promise.resolve(false);
  }
  return _send(body);
}
