/* ============================================
   KINDpos Overseer — Login scene

   Pre-auth screen, mounted on the gate-layer when probeAuth() returns
   null. Submits credentials to /v1/auth/login via auth_state.js;
   on success invokes onLoginSuccess(user) so the bootstrap can continue
   into the existing Overseer UI.

   Error policy mirrors the backend's no-enumeration response:
     401 → "Invalid credentials"           (wrong password or no such user)
     423 → "This account is disabled"      (is_active = 0)
     429 → "Too many attempts, ..."        (per-email or per-IP rate limit)
     other / network → "Could not reach server"

   `must_change_password` handling is OUT OF SCOPE for P5 per the spec —
   if the field is true after login we still call onLoginSuccess and the
   Overseer renders normally. P6 wires the forced-change flow.
   ============================================ */

import { T, field, button } from '../ui/forms.js';
import { login } from './auth_state.js';

const KEEPALIVE_FOCUS_DELAY_MS = 60;

/**
 * Mount the login scene inside `rootEl`. Replaces any prior content,
 * makes the host visible, and centers a card on the Nostalgia
 * background. Calls `onLoginSuccess(user)` after a 200 response.
 *
 * Returns a cleanup function that removes the scene's content. Useful
 * for tests; the production bootstrap also calls it after login to
 * tear the gate down before rendering the Overseer.
 */
export function renderLoginScene(rootEl, onLoginSuccess) {
  if (!rootEl) throw new Error('renderLoginScene: rootEl is required');

  // The gate-layer div is hidden by default in index.html. The login
  // scene is full-screen and needs to cover everything underneath.
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
    width: 360px;
    max-width: 100%;
    box-shadow: 0 10px 40px rgba(0, 0, 0, 0.5);
    display: flex;
    flex-direction: column;
    gap: 18px;
  `;

  // ─── Header ──────────────────────────────────────────────────────
  const brand = document.createElement('div');
  brand.style.cssText = `
    display: flex;
    align-items: baseline;
    gap: 8px;
    font-family: var(--font-heading);
    letter-spacing: 1.5px;
    text-transform: uppercase;
  `;
  const brandKindpos = document.createElement('span');
  brandKindpos.textContent = 'KINDpos';
  brandKindpos.style.cssText = `color: ${T.text}; font-weight: 700; font-size: 18px;`;
  const brandOverseer = document.createElement('span');
  brandOverseer.textContent = 'Overseer';
  brandOverseer.style.cssText = `color: ${T.textMuted}; font-size: 12px; font-weight: 600;`;
  brand.appendChild(brandKindpos);
  brand.appendChild(brandOverseer);
  card.appendChild(brand);

  const subtitle = document.createElement('div');
  subtitle.textContent = 'Sign in to continue';
  subtitle.style.cssText = `
    color: ${T.textMuted};
    font-family: var(--font-body);
    font-size: 13px;
    margin-top: -8px;
  `;
  card.appendChild(subtitle);

  // ─── Inputs ──────────────────────────────────────────────────────
  const emailF = field({
    label: 'Email',
    id: 'login-email',
    type: 'email',
    placeholder: 'you@example.com',
  });
  emailF.input.autocomplete = 'username';
  card.appendChild(emailF.wrap);

  const passwordF = field({
    label: 'Password',
    id: 'login-password',
    type: 'password',
    placeholder: '',
  });
  passwordF.input.autocomplete = 'current-password';
  card.appendChild(passwordF.wrap);

  // ─── Submit button (recolored primary to match the prompt's mint) ───
  const submitBtn = button({ label: 'Log in', variant: 'primary' });
  // Override the gold-on-cream primary to a mint-on-dark action that
  // reads as the "go" affordance against the Nostalgia card surface.
  submitBtn.style.background = T.green;
  submitBtn.style.color = '#0b1f10';
  submitBtn.style.width = '100%';
  submitBtn.style.marginTop = '4px';
  card.appendChild(submitBtn);

  // ─── Error message strip ─────────────────────────────────────────
  const errorEl = document.createElement('div');
  errorEl.dataset.role = 'login-error';
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
    emailF.input.disabled = busy;
    passwordF.input.disabled = busy;
  };

  const submit = async () => {
    setError('');
    const email = emailF.input.value.trim();
    const password = passwordF.input.value;
    if (!email || !password) {
      setError('Email and password required');
      return;
    }
    setBusy(true);
    const result = await login(email, password);
    setBusy(false);
    if (result.ok) {
      // Clear the password field before handing off so a back/forward
      // navigation can't redisplay it.
      passwordF.input.value = '';
      if (typeof onLoginSuccess === 'function') {
        onLoginSuccess(result.user);
      }
      return;
    }
    if (result.status === 423) {
      setError('This account is disabled');
    } else if (result.status === 429) {
      const ra = result.retryAfter;
      setError(
        ra
          ? `Too many attempts, try again in ${ra} seconds`
          : 'Too many attempts, try again later',
      );
    } else if (result.status === 0) {
      setError('Could not reach server');
    } else {
      // 401 and everything else fall through to the generic message —
      // never leak whether the email matches a known account.
      setError('Invalid credentials');
    }
  };

  submitBtn.addEventListener('click', (e) => { e.preventDefault(); submit(); });

  const onKey = (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      submit();
    }
  };
  emailF.input.addEventListener('keydown', onKey);
  passwordF.input.addEventListener('keydown', onKey);

  // Defer focus so jsdom / real browsers don't fight a synchronous
  // layout-then-focus race.
  setTimeout(() => { try { emailF.input.focus(); } catch (e) { /* noop */ } }, KEEPALIVE_FOCUS_DELAY_MS);

  return function cleanup() {
    rootEl.innerHTML = '';
    rootEl.style.display = 'none';
  };
}
