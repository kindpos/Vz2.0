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
  me:             '/v1/auth/me',
  login:          '/v1/auth/login',
  logout:         '/v1/auth/logout',
  passwordChange: '/v1/auth/password-change',
};

let _user = null;

function _setUser(u) {
  _user = u ? Object.freeze({ ...u }) : null;
  return _user;
}

export function currentUser() {
  return _user;
}

export async function probeAuth() {
  // Auth removed — local-first POS, no login required
  const user = {
    user_id: 'local',
    email: 'local',
    role: 'store_admin',
    must_change_password: false,
  };
  _setUser(user);
  return user;
}

export async function login() {
  return { ok: true, user: currentUser() };
}

/**
 * Rotate the current user's password. Returns:
 *   { ok: true }                              on 204
 *   { ok: false, status: 401 }                on bad current password
 *   { ok: false, status: 400, message: ... }  on validation failure
 *   { ok: false, status: 0, error: 'network' } on transport failure
 *   { ok: false, status: <other> }            on anything else
 *
 * After a successful change the cached in-memory user is now stale
 * (its `must_change_password` will still read `true`). Callers should
 * `probeAuth()` to refresh before consulting `currentUser()`.
 */
export async function changePassword(currentPassword, newPassword) {
  let resp;
  try {
    resp = await fetch(ENDPOINTS.passwordChange, {
      method: 'POST',
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
      body: JSON.stringify({
        current_password: currentPassword,
        new_password: newPassword,
      }),
    });
  } catch (e) {
    return { ok: false, status: 0, error: 'network' };
  }
  if (resp.status === 204) {
    return { ok: true };
  }
  if (resp.status === 400) {
    let detail = '';
    try {
      const body = await resp.json();
      detail = (body && body.detail) ? String(body.detail) : '';
    } catch (e) { /* empty / non-JSON body — leave detail empty */ }
    return { ok: false, status: 400, message: detail };
  }
  if (resp.status === 401) {
    return { ok: false, status: 401 };
  }
  return { ok: false, status: resp.status };
}

export async function logout() {
  return;
}

// Test-only escape hatch (not exported as part of the public API contract
// but accessible for unit tests that need to clear in-memory state
// between cases).
export const __resetForTests = () => _setUser(null);
