// terminal/header.js
// KINDpos/lite — Scene Header (Nostalgia)
// LOCKED 2026-04-20
//
// Per-scene mount. In a scene's mount(), call buildHeader({ ... }) and
// append the returned element to the scene root before the scene body.
// Call el.destroy() in unmount() to stop the tick timer.
//
// ─── Scene mapping ──────────────────────────────────────────────────
//   login            — (no header — custom)
//   server-landing   — { title:'SERVER LANDING',  subtitle, showBack:false }
//   manager-landing  — { title:'MANAGER',         subtitle, showBack:false }
//   order-entry      — { title:'ORDER ENTRY',     subtitle, showBack:true  }
//   check-overview   — { title:'CHECK OVERVIEW',  subtitle, showBack:true  }
//   tip-adjustment   — { title:'TIP ADJUSTMENT',  subtitle, showBack:true  }
//   reporting        — { title:'REPORTING',       subtitle, showBack:true  }
//   settings         — { title:'SETTINGS',        subtitle, showBack:true  }
//   payment          — { title:'PAYMENT',         subtitle, showBack:true  }
//   server-checkout  — { title:'SERVER CHECKOUT', subtitle, showBack:true  }
//   close-day        — (overlay — has its own chrome)
//
// ─── Usage ──────────────────────────────────────────────────────────
//   import { buildHeader } from '../header.js';
//
//   // in mount():
//   this.header = buildHeader({
//     title: 'ORDER ENTRY',
//     subtitle: `TABLE ${table} · ${guests} GUESTS`,
//     showBack: true,
//     user: session.currentUser,   // { firstName, role }
//   });
//   root.appendChild(this.header);
//
//   // later, to update subtitle as state changes:
//   this.header.update({ subtitle: `TABLE ${table} · ${newGuests} GUESTS` });
//
//   // in unmount():
//   this.header.destroy();
//
// ─── Contract ───────────────────────────────────────────────────────
//   Returns an HTMLElement with:
//     el.update(patch)   — { title?, subtitle? }
//     el.destroy()       — stops the 1s tick timer
//
//   Expects global SceneManager (window._SM) with:
//     .back()                          — called by BACK pill if no onBack override
//     .openGate('login')               — target of logout flow
//     .interrupt(key, opts)            — Tier 3 confirm for logout
//     .hasScene(name)                  — used to gate the confirm-logout
//                                        interrupt; falls back to
//                                        window.confirm() when the
//                                        interrupt scene isn't registered.

import { T } from '../common/tokens.js';
import { buildPillButton } from './theme-manager.js';
import { fetchWithTimeout } from './net.js';
// ^ adjust import path/names if buildPillButton lives elsewhere

// ─── Style injection (once per page) ────────────────────────────────
let _stylesInjected = false;
function injectStyles() {
  if (_stylesInjected) return;
  _stylesInjected = true;

  const textDim  = T.textDim || 'rgba(232, 234, 237, 0.5)';
  const border   = T.border;

  const css = `
    .kh-root {
      height: 52px;
      min-height: 52px;
      width: 100%;
      background: ${T.card};
      border-bottom: 1px solid ${border};
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 0 14px;
      position: relative;
      font-family: 'Outfit', sans-serif;
      color: ${T.text};
      box-sizing: border-box;
    }
    .kh-root::after {
      content: '';
      position: absolute;
      left: 14px; right: 14px; bottom: 0;
      height: 1px;
      background: linear-gradient(90deg,
        transparent 0%,
        ${T.green}1f 50%,
        transparent 100%);
      pointer-events: none;
    }
    .kh-left  { display:flex; align-items:center; gap:14px; pointer-events:auto; }
    .kh-right { display:flex; align-items:center; gap:10px; pointer-events:auto; flex-shrink:0; }
    .kh-center {
      position: absolute;
      left: 50%; top: 0; bottom: 0;
      transform: translateX(-50%);
      display: flex; flex-direction: column;
      align-items: center; justify-content: center;
      gap: 2px;
      pointer-events: none;
    }
    .kh-title {
      font-family: 'Outfit', sans-serif;
      font-weight: 800;
      font-size: 17px;
      letter-spacing: 2.4px;
      color: ${T.text};
      text-transform: uppercase;
      line-height: 1;
    }
    .kh-subtitle {
      font-family: 'JetBrains Mono', monospace;
      font-weight: ${T.fwBold};
      font-size: 10px;
      color: ${textDim};
      letter-spacing: 1.6px;
      text-transform: uppercase;
    }
    .kh-datetime {
      display: flex; flex-direction: column;
      gap: 3px;
      padding: 7px 14px;
      background: ${T.well};
      border-radius: 8px;
      border-left: 3px solid ${T.elec};
      line-height: 1;
      min-width: 132px;
    }
    .kh-datetime-date {
      font-family: 'JetBrains Mono', monospace;
      font-size: 9px;
      color: ${textDim};
      letter-spacing: 1.8px;
      font-weight: ${T.fwBold};
    }
    .kh-datetime-time {
      font-family: 'JetBrains Mono', monospace;
      font-size: 13px;
      color: ${T.text};
      letter-spacing: 1px;
      font-weight: 700;
    }
    .kh-user { display:flex; flex-direction:column; align-items:flex-start; gap:2px; }
    .kh-greeting {
      font-family: 'Outfit', sans-serif;
      font-weight: ${T.fwBold};
      font-size: 13px;
      color: ${T.text};
      line-height: 1;
      letter-spacing: 0.3px;
    }
    .kh-role {
      font-family: 'JetBrains Mono', monospace;
      font-weight: ${T.fwBold};
      font-size: 9px;
      color: ${T.green};
      letter-spacing: 1.4px;
      display: flex; align-items: center; gap: 4px;
    }
    .kh-role::before {
      content: '';
      width: 5px; height: 5px;
      border-radius: 999px;
      background: ${T.green};
      box-shadow: 0 0 6px ${T.green};
    }
  `;

  const style = document.createElement('style');
  style.id = 'kh-styles';
  style.textContent = css;
  document.head.appendChild(style);
}

// ─── Time / greeting helpers ────────────────────────────────────────
const DAYS   = ['SUN','MON','TUE','WED','THU','FRI','SAT'];
const MONTHS = ['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'];

export function greetingFor(h24) {
  if (h24 >= 5  && h24 < 12) return 'Good Morning';
  if (h24 >= 12 && h24 < 17) return 'Good Afternoon';
  return 'Good Evening';
}
export function fmtTime(d) {
  const h24 = d.getHours();
  const m = String(d.getMinutes()).padStart(2, '0');
  const ampm = h24 >= 12 ? 'PM' : 'AM';
  return `${h24 % 12 || 12}:${m} ${ampm}`;
}
export function fmtDate(d) {
  return `${DAYS[d.getDay()]} · ${MONTHS[d.getMonth()]} ${d.getDate()}`;
}

// ─── Logout flow ────────────────────────────────────────────────────
import { getToken as _getAuthToken, clearToken as _clearAuthToken } from './auth-client.js';

export function performLogout() {
  console.log('[logout] firing');
  const SM = window._SM;
  // Prefer the persisted auth-client token (sessionStorage) over the old
  // window._session shim that the codebase is migrating off of.
  const token = _getAuthToken() || (window._session && window._session.token) || null;

  // Clear client-side session state — both the new auth-client storage
  // and the legacy window._session for any scene that still reads it.
  _clearAuthToken();
  window._session = null;

  // Immediate UI response
  if (SM) {
    SM.openGate('login');
  }

  // Background API call to invalidate server session. Note: the fetch
  // interceptor also attaches the header when a token is stored, but we
  // just cleared it, so pass it explicitly here.
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;

  fetchWithTimeout('/api/v1/auth/logout', { method: 'POST', headers: headers }, 8000)
    .catch(err => console.warn('[logout] API background call failed:', err));
}

function triggerLogout() {
  console.log('[logout] fired');
  const SM = window._SM;
  if (!SM) return;

  // Prefer the tier-3 confirm interrupt, but only if a scene is actually
  // registered for it. `SM.interrupt` on an unregistered key just logs an
  // error and returns, so without this probe the window.confirm fallback
  // below would never run and LOGOUT would silently do nothing.
  var canInterrupt = typeof SM.interrupt === 'function'
    && typeof SM.hasScene === 'function'
    && SM.hasScene('confirm-logout');
  if (canInterrupt) {
    SM.interrupt('confirm-logout', {
      message: 'Log out and return to PIN entry?',
      onConfirm: performLogout
    });
  } else {
    // graceful fallback if the confirm-logout interrupt isn't wired yet
    if (window.confirm('Log out?')) {
      performLogout();
    }
  }
}

// ─── Main ───────────────────────────────────────────────────────────
/**
 * @param {object}   opts
 * @param {string}   opts.title
 * @param {string}   [opts.subtitle]
 * @param {boolean}  [opts.showBack=false]
 * @param {boolean}  [opts.showLogout=true]
 * @param {boolean}  [opts.showGreeting=true]
 * @param {boolean}  [opts.showDatetime=true]
 * @param {object}   [opts.user]              — { firstName, role }
 * @param {function} [opts.onBack]            — override default SceneManager.back()
 * @returns {HTMLElement} with .update(patch) and .destroy()
 */
export function buildHeader(opts = {}) {
  const {
    title        = '',
    subtitle     = '',
    showBack     = false,
    showLogout   = true,
    showGreeting = true,
    showDatetime = true,
    user         = null,
    onBack       = null,
  } = opts;

  injectStyles();

  const root = document.createElement('header');
  root.className = 'kh-root';

  // ── Left ──
  const left = document.createElement('div');
  left.className = 'kh-left';

  let dateEl = null, timeEl = null, greetingEl = null;

  if (showDatetime) {
    const dt = document.createElement('div');
    dt.className = 'kh-datetime';
    dateEl = document.createElement('div');
    dateEl.className = 'kh-datetime-date';
    timeEl = document.createElement('div');
    timeEl.className = 'kh-datetime-time';
    dt.append(dateEl, timeEl);
    left.appendChild(dt);
  }

  if (showGreeting && user) {
    const chip = document.createElement('div');
    chip.className = 'kh-user';
    greetingEl = document.createElement('div');
    greetingEl.className = 'kh-greeting';
    const roleEl = document.createElement('div');
    roleEl.className = 'kh-role';
    roleEl.textContent = `${(user.role || '').toUpperCase()} · ON`;
    chip.append(greetingEl, roleEl);
    left.appendChild(chip);
  }

  // ── Center (absolute, dead-center) ──
  const center = document.createElement('div');
  center.className = 'kh-center';
  const titleEl = document.createElement('div');
  titleEl.className = 'kh-title';
  titleEl.textContent = title;
  const subtitleEl = document.createElement('div');
  subtitleEl.className = 'kh-subtitle';
  subtitleEl.textContent = subtitle;
  subtitleEl.style.display = subtitle ? '' : 'none';
  center.append(titleEl, subtitleEl);

  // ── Right ──
  const right = document.createElement('div');
  right.className = 'kh-right';

  if (showBack) {
    const backBtn = buildPillButton({
      label: 'BACK',
      variant: 'ghost',
      padding: '6px 16px',
      fontSize: T.fsB4,
      onClick: onBack || (() => window._SM?.back?.()),
    });
    right.appendChild(backBtn);
  }

  if (showLogout) {
    const logoutBtn = buildPillButton({
      label: 'LOGOUT',
      variant: 'verm',
      padding: '6px 16px',
      fontSize: T.fsB4,
      onClick: triggerLogout,
    });
    right.appendChild(logoutBtn);
  }

  root.append(left, center, right);

  // ── Tick ──
  const tick = () => {
    const d = new Date();
    if (timeEl) timeEl.textContent = fmtTime(d);
    if (dateEl) dateEl.textContent = fmtDate(d);
    if (greetingEl && user) {
      greetingEl.textContent = `${greetingFor(d.getHours())}, ${user.firstName || ''}!`;
    }
  };
  tick();
  const interval = setInterval(tick, 1000);

  // ── Public API ──
  root.update = (patch = {}) => {
    if ('title' in patch) titleEl.textContent = patch.title;
    if ('subtitle' in patch) {
      subtitleEl.textContent = patch.subtitle || '';
      subtitleEl.style.display = patch.subtitle ? '' : 'none';
    }
  };
  root.destroy = () => clearInterval(interval);

  return root;
}