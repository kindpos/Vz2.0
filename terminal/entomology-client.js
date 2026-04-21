// ═══════════════════════════════════════════════════
//  KINDpos Terminal — Entomology client
//
//  Fire-and-forget posts to /api/v1/entomology/client-event.
//  Accepts UI-* event codes only (backend rejects anything else).
//  Never throws — diagnostic writes must not break the scene flow.
//  Queues events when offline and replays on `online`.
// ═══════════════════════════════════════════════════

const _ENDPOINT = '/api/v1/entomology/client-event';
const _QUEUE_MAX = 50;
const _queue = [];

function _send(body) {
  return fetch(_ENDPOINT, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify(body),
    keepalive: true,
  }).then(function(r) { return r.ok; }).catch(function() { return false; });
}

function _drain() {
  if (_queue.length === 0) return;
  var pending = _queue.splice(0);
  pending.forEach(function(b) { _send(b); });
}

if (typeof window !== 'undefined') {
  window.addEventListener('online', _drain);
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
  var body = {
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
