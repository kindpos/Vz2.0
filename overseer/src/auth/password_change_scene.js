/* ============================================
   KINDpos Overseer — Forced password-change scene

   Mounted by `_initOverseerUI` when the logged-in user has
   `must_change_password = true` (OVERSEER_AUTH §2). Sits on the same
   #gate-layer div the login scene uses, with matching aesthetics so
   the transition login → forced-change → Overseer feels like one flow.

   Three fields: current, new, confirm. Client-side validation gates
   the API call (length ≥ 12, new === confirm, new !== current); only
   if all pass do we hit `POST /v1/auth/password-change` (which enforces
   the same rules server-side anyway).

   On success the in-memory user is stale (it still carries the old
   `must_change_password: true`), so the callback re-probes via
   `probeAuth()` to refresh before handing back to `_initOverseerUI`.
   ============================================ */

import { T, field, button } from '../ui/forms.js';
// `changePassword` posts to /v1/auth/password-change with
// `credentials: 'include'` so the HttpOnly session cookie travels with
// the request — this scene itself never touches `fetch` directly.
import { changePassword } from './auth_state.js';

const MIN_PASSWORD_LENGTH = 12;
const FOCUS_DELAY_MS = 60;

/**
 * Mount the forced password-change scene inside `rootEl`. After a
 * successful change, calls `onChangeSuccess()` — the caller is
 * responsible for re-probing auth and tearing the gate down.
 *
 * Returns a cleanup function that empties the host. The bootstrap
 * doesn't usually need it; tests do.
 */
export function renderPasswordChangeScene(rootEl, onChangeSuccess) {
  if (!rootEl) throw new Error('renderPasswordChangeScene: rootEl is required');

  rootEl.innerHTML = '';
  rootEl.style.display = 'flex';
  rootEl.style.position = 'fixed';
  rootEl.style.inset = '0';
  rootEl.style.zIndex = '9000';
  rootEl.style.background = T.bg;
  rootEl.style.alignItems = 'center';
  rootEl.style.justifyContent = 'center';
  rootEl.style.padding = '24px';

  const card = document.createElement('div');
  card.style.cssText = `
    background: ${T.card};
    border: 1px solid ${T.border};
    border-radius: 12px;
    padding: 36px 40px;
    width: 380px;
    max-width: 100%;
    box-shadow: 0 10px 40px rgba(0, 0, 0, 0.5);
    display: flex;
    flex-direction: column;
    gap: 14px;
  `;

  // ─── Header ──────────────────────────────────────────────────────
  const heading = document.createElement('div');
  heading.textContent = 'Set a new password';
  heading.style.cssText = `
    color: ${T.text};
    font-family: var(--font-heading);
    font-size: 18px;
    font-weight: 700;
    letter-spacing: 0.4px;
  `;
  card.appendChild(heading);

  const subhead = document.createElement('div');
  subhead.textContent = 'You must change your password before continuing.';
  subhead.style.cssText = `
    color: ${T.textMuted};
    font-family: var(--font-body);
    font-size: 13px;
    margin-bottom: 4px;
  `;
  card.appendChild(subhead);

  // ─── Inputs ──────────────────────────────────────────────────────
  const currentF = field({
    label: 'Current password',
    id: 'pc-current',
    type: 'password',
  });
  currentF.input.autocomplete = 'current-password';
  card.appendChild(currentF.wrap);

  const newF = field({
    label: 'New password',
    id: 'pc-new',
    type: 'password',
  });
  newF.input.autocomplete = 'new-password';
  card.appendChild(newF.wrap);

  const confirmF = field({
    label: 'Confirm new password',
    id: 'pc-confirm',
    type: 'password',
  });
  confirmF.input.autocomplete = 'new-password';
  card.appendChild(confirmF.wrap);

  // ─── Submit ──────────────────────────────────────────────────────
  const submitBtn = button({ label: 'Update password', variant: 'primary' });
  submitBtn.style.background = T.green;
  submitBtn.style.color = '#0b1f10';
  submitBtn.style.width = '100%';
  submitBtn.style.marginTop = '4px';
  card.appendChild(submitBtn);

  const errorEl = document.createElement('div');
  errorEl.dataset.role = 'password-change-error';
  errorEl.style.cssText = `
    color: ${T.verm};
    font-family: var(--font-body);
    font-size: 13px;
    min-height: 18px;
    text-align: center;
  `;
  card.appendChild(errorEl);

  rootEl.appendChild(card);

  // ─── Behavior ────────────────────────────────────────────────────
  const setError = (msg) => { errorEl.textContent = msg || ''; };
  const setBusy = (busy) => {
    submitBtn.disabled = busy;
    submitBtn.style.opacity = busy ? '0.6' : '';
    submitBtn.style.cursor = busy ? 'not-allowed' : 'pointer';
    currentF.input.disabled = busy;
    newF.input.disabled = busy;
    confirmF.input.disabled = busy;
  };

  const submit = async () => {
    setError('');
    const current = currentF.input.value;
    const next = newF.input.value;
    const confirm = confirmF.input.value;

    // Client-side validation gates the API call so an obvious mistake
    // (mismatched confirm, too short, etc.) never burns a request.
    if (!current || !next || !confirm) {
      setError('All fields are required');
      return;
    }
    if (next.length < MIN_PASSWORD_LENGTH) {
      setError(`New password must be at least ${MIN_PASSWORD_LENGTH} characters`);
      return;
    }
    if (next !== confirm) {
      setError('New password and confirmation do not match');
      return;
    }
    if (next === current) {
      setError('New password must be different from current');
      return;
    }

    setBusy(true);
    const result = await changePassword(current, next);
    setBusy(false);

    if (result.ok) {
      // Wipe local copies of plaintext before handing off.
      currentF.input.value = '';
      newF.input.value = '';
      confirmF.input.value = '';
      if (typeof onChangeSuccess === 'function') {
        await onChangeSuccess();
      }
      return;
    }

    if (result.status === 401) {
      setError('Current password is incorrect');
    } else if (result.status === 400) {
      // Server enforces the same rules as the client; this branch fires
      // only on a race (e.g. policy bumped server-side between fetches)
      // or if a future API extension rejects something the client passed.
      const msg = (result.message || '').toLowerCase();
      if (msg.includes('character')) {
        setError(`New password must be at least ${MIN_PASSWORD_LENGTH} characters`);
      } else if (msg.includes('differ')) {
        setError('New password must be different from current');
      } else {
        setError('Could not update password. Try again.');
      }
    } else if (result.status === 0) {
      setError('Could not update password. Try again.');
    } else {
      setError('Could not update password. Try again.');
    }
  };

  submitBtn.addEventListener('click', (e) => { e.preventDefault(); submit(); });

  const onKey = (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      submit();
    }
  };
  currentF.input.addEventListener('keydown', onKey);
  newF.input.addEventListener('keydown', onKey);
  confirmF.input.addEventListener('keydown', onKey);

  setTimeout(() => {
    try { currentF.input.focus(); } catch (e) { /* noop in jsdom */ }
  }, FOCUS_DELAY_MS);

  return function cleanup() {
    rootEl.innerHTML = '';
    rootEl.style.display = 'none';
  };
}
