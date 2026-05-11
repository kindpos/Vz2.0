/* ============================================
   KINDpos Overseer — Cookie-auth state module

   Talks to the new /v1/auth/* endpoints with `credentials: 'include'`
   so the HttpOnly session cookie round-trips. State is held in memory
   only; nothing about the logged-in user is persisted client-side
   (the cookie is the only credential, and it's HttpOnly so JS cannot
   read it anyway).

   API:
     probeAuth()              → user | null      // GET  /v1/auth/me
     login(email, password)   → { ok, ... }      // POST /v1/auth/login
     logout()                 → void             // POST /v1/auth/logout
     currentUser()            → user | null      // synchronous getter

   Distinct from `services/auth-client.js` which handles the legacy
   Bearer/PIN flow for /api/* endpoints — that interceptor only fires
   on /api/* paths so the two coexist without interfering.
   ============================================ */

const ENDPOINTS = {
  me:     '/v1/auth/me',
  login:  '/v1/auth/login',
  logout: '/v1/auth/logout',
};

let _user = null;

function _setUser(u) {
  _user = u ? Object.freeze({ ...u }) : null;
  return _user;
}

export function currentUser() {
  return _user;
}

/**
 * Probe the server for the current session. Returns the user object on
 * success, null on 401 (no session), and throws on transport or 5xx
 * errors so the bootstrap can distinguish "not logged in" from "server
 * unreachable" and surface them differently.
 */
export async function probeAuth() {
  let resp;
  try {
    resp = await fetch(ENDPOINTS.me, {
      method: 'GET',
      credentials: 'include',
      headers: { 'Accept': 'application/json' },
    });
  } catch (e) {
    throw new Error(`probeAuth: network error: ${e && e.message ? e.message : e}`);
  }
  if (resp.status === 401) {
    _setUser(null);
    return null;
  }
  if (!resp.ok) {
    throw new Error(`probeAuth: unexpected status ${resp.status}`);
  }
  const body = await resp.json();
  return _setUser(body);
}

/**
 * POST credentials. Returns:
 *   { ok: true,  user }                                    on 200
 *   { ok: false, status: 401 }                             on bad creds
 *   { ok: false, status: 423 }                             on disabled account
 *   { ok: false, status: 429, retryAfter: <seconds|null> } on rate limit
 *   { ok: false, status: 0,   error: 'network' }           on transport failure
 *   { ok: false, status: <other> }                         on anything else
 */
export async function login(email, password) {
  let resp;
  try {
    resp = await fetch(ENDPOINTS.login, {
      method: 'POST',
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
      body: JSON.stringify({ email, password }),
    });
  } catch (e) {
    return { ok: false, status: 0, error: 'network' };
  }
  if (resp.ok) {
    const body = await resp.json();
    _setUser(body);
    return { ok: true, user: body };
  }
  if (resp.status === 429) {
    const ra = resp.headers.get('Retry-After');
    const parsed = ra != null ? parseInt(ra, 10) : null;
    return {
      ok: false,
      status: 429,
      retryAfter: Number.isFinite(parsed) && parsed > 0 ? parsed : null,
    };
  }
  return { ok: false, status: resp.status };
}

/**
 * Server-side session revoke + clear in-memory state. Best-effort —
 * a network failure here doesn't leave the user "logged in" from the
 * UI's perspective; the cookie may persist in the browser until it
 * expires server-side, but the in-memory user is gone either way.
 */
export async function logout() {
  try {
    await fetch(ENDPOINTS.logout, {
      method: 'POST',
      credentials: 'include',
    });
  } catch (e) {
    /* swallow — clear local state anyway */
  }
  _setUser(null);
}

// Test-only escape hatch (not exported as part of the public API contract
// but accessible for unit tests that need to clear in-memory state
// between cases).
export const __resetForTests = () => _setUser(null);
