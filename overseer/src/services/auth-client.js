/* ============================================
   KINDpos Overseer — Auth client
   ============================================

   Ports the same contract as terminal/auth-client.js:
   - sessionStorage-backed token store
   - window.fetch interceptor that auto-attaches
     `Authorization: Bearer <token>` to every /api/* request
   - On 401 from the backend, clears the stored token and opens a
     manager-PIN prompt so the next call can retry with a fresh token

   Imported once from src/app.js for its side-effect install. The
   backend's config writes are manager-gated since the SEC-hardening
   round; without this client every Overseer POST returned 401.
*/

const _KEY = 'kindpos.overseer.session';

function _read() {
    try { return JSON.parse(sessionStorage.getItem(_KEY) || 'null'); }
    catch (e) { return null; }
}

function _write(obj) {
    try { sessionStorage.setItem(_KEY, JSON.stringify(obj)); }
    catch (e) { /* quota exceeded / private mode — ignore */ }
}

export function setToken(data) {
    if (!data || !data.token) return;
    _write({
        token:       data.token,
        employee_id: data.employee_id || null,
        name:        data.name || null,
        roles:       data.roles || [],
    });
}

export function getToken() {
    const s = _read();
    return s && s.token ? s.token : null;
}

export function getSession() { return _read(); }

export function clearToken() {
    try { sessionStorage.removeItem(_KEY); } catch (e) { /* ignore */ }
}

// ── PIN prompt ─────────────────────────────────────
// Minimum-viable login: use window.prompt so managers can authenticate
// without waiting on a bigger login-modal redesign. When the UI grows a
// real login screen, replace this with a proper modal that calls
// /auth/verify-pin the same way.
let _pinPromptInFlight = null;
export async function promptManagerPin(reason) {
    if (_pinPromptInFlight) return _pinPromptInFlight;
    _pinPromptInFlight = (async () => {
        try {
            const msg = reason
                ? `${reason}\n\nEnter your manager PIN:`
                : 'Enter your manager PIN:';
            const pin = window.prompt(msg);
            if (!pin) return false;
            // Call the raw fetch — our interceptor will no-op on
            // /auth/verify-pin because there's no token yet, which is
            // what we want.
            const res = await _originalFetch('/api/v1/auth/verify-pin', {
                method:  'POST',
                headers: { 'Content-Type': 'application/json' },
                body:    JSON.stringify({ pin }),
            });
            // Rate-limit needs its own branch: the backend sends 429 with a
            // `{valid:false}` body, but `res.ok` is false for 429 so the prior
            // code returned early and the alert below was unreachable. Check
            // the status first so the operator actually sees the "wait 60s"
            // message instead of a generic PIN-reject toast.
            if (res.status === 429) {
                window.alert('Too many PIN attempts. Wait 60 seconds and try again.');
                return false;
            }
            if (!res.ok) return false;
            const data = await res.json();
            if (!data.valid) return false;
            setToken(data);
            return true;
        } finally {
            _pinPromptInFlight = null;
        }
    })();
    return _pinPromptInFlight;
}

// ── Fetch interceptor ──────────────────────────────
// Same contract as the terminal interceptor: attach the bearer to
// /api/* requests, don't touch others, never clobber caller-supplied
// Authorization. Additionally — because the Overseer has no other
// login surface yet — a 401 response triggers the PIN prompt and a
// single retry. That way a fresh session comes up transparently on the
// first write that needs auth.

let _installed = false;
let _originalFetch = null;

export function installAuthFetchInterceptor() {
    if (_installed) return;
    if (typeof window === 'undefined' || typeof window.fetch !== 'function') return;
    _installed = true;

    _originalFetch = window.fetch.bind(window);

    window.fetch = async function(input, init) {
        const attach = (initArg) => {
            const url = (typeof input === 'string') ? input
                      : (input && input.url) ? input.url : '';
            const isOurApi = typeof url === 'string' && (
                url.indexOf('/api/') === 0 ||
                url.indexOf(window.location.origin + '/api/') === 0
            );
            if (!isOurApi) return initArg;
            const tok = getToken();
            if (!tok) return initArg;
            const out = initArg ? { ...initArg } : {};
            const headers = new Headers(out.headers || {});
            if (!headers.has('Authorization')) {
                headers.set('Authorization', 'Bearer ' + tok);
                out.headers = headers;
            }
            return out;
        };

        const firstInit = attach(init);
        let res;
        try {
            res = await _originalFetch(input, firstInit);
        } catch (e) {
            throw e;
        }

        // If the backend says "you need to authenticate", drop any
        // stored token (it may be stale) and ask the user for a PIN.
        // Retry once on success so the caller sees the real response.
        if (res.status === 401 || res.status === 403) {
            clearToken();
            const ok = await promptManagerPin(
                res.status === 403
                    ? 'Manager role required.'
                    : 'Session expired or not signed in.'
            );
            if (ok) {
                const retryInit = attach(init);
                return _originalFetch(input, retryInit);
            }
        }
        return res;
    };
}

// Side-effect install so a bare `import './services/auth-client.js'`
// wires the interceptor.
installAuthFetchInterceptor();
