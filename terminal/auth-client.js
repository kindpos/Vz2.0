// ═══════════════════════════════════════════════════
//  KINDpos Terminal — Auth client
//
//  Persists the session token issued by /api/v1/auth/verify-pin and
//  auto-attaches it to every outgoing /api/* fetch via a window.fetch
//  interceptor. One import from app.js wires the whole app.
//
//  Storage: sessionStorage (cleared on window close). Picked over
//  localStorage so a forgotten-logged-in terminal clears after a reboot.
// ═══════════════════════════════════════════════════

const _KEY = 'kindpos.session';

function _read() {
  try { return JSON.parse(sessionStorage.getItem(_KEY) || 'null'); }
  catch (e) { return null; }
}

function _write(obj) {
  try { sessionStorage.setItem(_KEY, JSON.stringify(obj)); }
  catch (e) { /* quota exceeded or private mode; ignore */ }
}

/** Persist a verified session. Call from login.js on PIN success. */
export function setToken(data) {
  if (!data || !data.token) return;
  _write({
    token:       data.token,
    employee_id: data.employee_id || null,
    name:        data.name || null,
    roles:       data.roles || [],
  });
}

/** Return the stored bearer token, or null if not logged in. */
export function getToken() {
  const s = _read();
  return s && s.token ? s.token : null;
}

/** Return the full stored session { token, employee_id, name, roles } or null. */
export function getSession() {
  return _read();
}

/** Clear locally. Pair with POST /api/v1/auth/logout to invalidate server-side. */
export function clearToken() {
  try { sessionStorage.removeItem(_KEY); } catch (e) { /* ignore */ }
}

// ── Fetch interceptor ─────────────────────────────
// Rules:
//   - Only attach the header for our own API (/api/ prefix, same-origin).
//   - Don't clobber a caller-supplied Authorization header.
//   - Never throw — if anything fails we pass through to the original fetch.
//
// Importing this module is the install. We only install once per page;
// re-imports are no-ops.

let _installed = false;

export function installAuthFetchInterceptor() {
  if (_installed) return;
  if (typeof window === 'undefined' || typeof window.fetch !== 'function') return;
  _installed = true;

  const _original = window.fetch.bind(window);

  window.fetch = function(input, init) {
    try {
      const url = (typeof input === 'string') ? input
              : (input && input.url) ? input.url : '';
      const isOurApi = typeof url === 'string' && (
        url.indexOf('/api/') === 0 ||
        url.indexOf(`${window.location.origin}/api/`) === 0
      );
      if (isOurApi) {
        const tok = getToken();
        if (tok) {
          init = init || {};
          // Caller-supplied Authorization wins so they can temporarily
          // override (e.g. the PIN verify request before login is complete).
          const headers = new Headers(init.headers || {});
          if (!headers.has('Authorization')) {
            headers.set('Authorization', `Bearer ${tok}`);
            init.headers = headers;
          }
        }
      }
    } catch (e) { /* fall through to original fetch unmodified */ }
    return _original(input, init);
  };
}

// Side-effect install so a plain `import './auth-client.js'` is enough.
installAuthFetchInterceptor();
