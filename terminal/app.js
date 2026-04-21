// ═══════════════════════════════════════════════════
//  KINDpos Terminal — app.js  (Vz2.0)
//  Entry point. Boots managers, loads config, opens gate.
//  Also exports the global header API for all scenes.
//  Nice. Dependable. Yours.
// ═══════════════════════════════════════════════════

import { SceneManager } from './scene-manager.js';
import { T, applyStoreTheme } from './tokens.js';

// ── Scene imports ─────────────────────────────────
import './scenes/login.js';
import './scenes/server-landing.js';
import './scenes/manager-landing.js';
import './scenes/check-overview.js';
import './scenes/column-editor.js';
import './scenes/order-entry.js';
import './scenes/payment.js';
import './scenes/server-checkout.js';
import './scenes/close-day.js';

// ── Dev console hook ──────────────────────────────
window._SM = SceneManager;

// ═══════════════════════════════════════════════════
//  BOOT
// ═══════════════════════════════════════════════════

async function boot() {

  // 1. Init scene manager — wire DOM layers
  SceneManager.init();

  // 2. Wire header auto-hide on scene transitions
  SceneManager.onBeforeTransition(_hideHeader);

  // 3. Load store config from backend
  try {
    var res = await fetch('/api/v1/config/store');
    if (res.ok) {
      var config = await res.json();
      applyStoreTheme({
        storeName:       config.store_name      || 'Store Name',
        terminalId:      config.terminal_id     || 'Terminal 01',
        storePrimary:    config.primary_color   || null,
        storePrimaryDk:  config.primary_dark    || null,
        storeSecondary:  config.secondary_color || null,
        storeSecondaryDk:config.secondary_dark  || null,
        storeTertiary:   config.tertiary_color  || null,
        storeTertiaryDk: config.tertiary_dark   || null,
        storeLogoUrl:    config.logo_url        || null,
      });
    }
  } catch (e) {
    console.info('[app] Store config unavailable, using defaults');
  }

  // 4. Open gate → login scene
  SceneManager.openGate('login');
}

// ── Run ───────────────────────────────────────────
document.addEventListener('DOMContentLoaded', boot);

// ═══════════════════════════════════════════════════
//  GLOBAL HEADER
//
//  Persistent 48px bar at top:0. Always shown after login.
//  Gate layer (login) uses z-index 100 + top:0, so it covers the header.
//
//  Landing scenes call:
//    setHeaderUser(emp)          — clock + greeting + role dot (left)
//    setSceneName('MANAGER')     — center title
//    setHeaderSubtitle('3 OPEN') — center subtitle, updated per refresh
//    setHeaderLogout(true)       — shows LOGOUT pill (right); navigates to login
//
//  Transactional scenes call:
//    setSceneName('CHECK')
//    setHeaderBack({ back: true, onBack: fn, x: true, onX: fn })
//
//  Header auto-hides on every scene transition via onBeforeTransition.
//  Each scene re-calls its header setup in render() to keep it visible.
// ═══════════════════════════════════════════════════

var _headerEl         = null;
var _headerBackEl     = null;
var _clockWrapEl      = null;
var _clockDateEl      = null;
var _clockTimeEl      = null;
var _userWrapEl       = null;
var _greetEl          = null;
var _roleEl           = null;
var _headerNameEl     = null;
var _headerSubtitleEl = null;
var _logoutEl         = null;
var _headerXEl        = null;
var _clockInterval    = null;

var HEADER_H = 52; // must match T.headerH in tokens.js

// ── Clock helpers ─────────────────────────────────

function _tickClock() {
  if (!_clockDateEl) return;
  var now  = new Date();
  var DAYS = ['SUN','MON','TUE','WED','THU','FRI','SAT'];
  var MONS = ['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'];
  _clockDateEl.textContent = DAYS[now.getDay()] + ' · ' + MONS[now.getMonth()] + ' ' + now.getDate();
  var h = now.getHours(), m = now.getMinutes();
  var ap = h >= 12 ? 'PM' : 'AM';
  h = h % 12 || 12;
  _clockTimeEl.textContent = h + ':' + String(m).padStart(2, '0') + ' ' + ap;
}

function _startClock() {
  if (_clockInterval) return;
  _tickClock();
  _clockInterval = setInterval(_tickClock, 1000);
}

function _stopClock() {
  if (_clockInterval) { clearInterval(_clockInterval); _clockInterval = null; }
}

// ── Header construction ───────────────────────────

function _ensureHeader() {
  if (_headerEl) return _headerEl;

  _headerEl = document.getElementById('header');
  if (!_headerEl) {
    _headerEl = document.createElement('div');
    _headerEl.id = 'header';
    var terminal = document.getElementById('terminal') || document.body;
    terminal.appendChild(_headerEl);
  }

  _headerEl.style.cssText = [
    'position:absolute;top:0;left:0;right:0;',
    'height:' + HEADER_H + 'px;',
    'background:' + T.card + ';',
    'border-bottom:1px solid ' + T.border + ';',
    'display:none;',
    'align-items:center;',
    'padding:0 14px;gap:12px;',
    'z-index:50;box-sizing:border-box;',
  ].join('');

  // ← back arrow (left, transactional)
  _headerBackEl = document.createElement('div');
  _headerBackEl.style.cssText = [
    'display:none;flex-shrink:0;',
    'font-family:' + T.fh + ';font-size:36px;',
    'font-weight:' + T.fwBold + ';color:' + T.green + ';',
    'cursor:pointer;user-select:none;',
    'padding:0 8px 0 0;line-height:1;',
  ].join('');
  _headerBackEl.textContent = '‹';
  _headerEl.appendChild(_headerBackEl);

  // Clock block (left, landing)
  _clockWrapEl = document.createElement('div');
  _clockWrapEl.style.cssText = 'display:none;flex-direction:column;line-height:1.15;flex-shrink:0;';
  _headerEl.appendChild(_clockWrapEl);

  _clockDateEl = document.createElement('div');
  _clockDateEl.style.cssText = 'font-family:' + T.fb + ';font-size:10px;color:' + T.green + ';letter-spacing:0.12em;font-weight:700;text-transform:uppercase;';
  _clockWrapEl.appendChild(_clockDateEl);

  _clockTimeEl = document.createElement('div');
  _clockTimeEl.style.cssText = 'font-family:' + T.fb + ';font-size:16px;color:' + T.text + ';font-weight:700;';
  _clockWrapEl.appendChild(_clockTimeEl);

  // User greeting block (left, landing)
  _userWrapEl = document.createElement('div');
  _userWrapEl.style.cssText = 'display:none;flex-direction:column;line-height:1.2;flex-shrink:0;';
  _headerEl.appendChild(_userWrapEl);

  _greetEl = document.createElement('div');
  _greetEl.style.cssText = 'font-family:' + T.fh + ';font-size:13px;color:' + T.text + ';font-weight:700;';
  _userWrapEl.appendChild(_greetEl);

  _roleEl = document.createElement('div');
  _roleEl.style.cssText = 'display:flex;align-items:center;gap:4px;font-family:' + T.fb + ';font-size:10px;color:' + T.green + ';letter-spacing:0.10em;font-weight:700;text-transform:uppercase;';
  _userWrapEl.appendChild(_roleEl);

  // Center: title + subtitle
  var centerEl = document.createElement('div');
  centerEl.style.cssText = 'flex:1;display:flex;flex-direction:column;align-items:center;line-height:1.2;min-width:0;';
  _headerEl.appendChild(centerEl);

  _headerNameEl = document.createElement('div');
  _headerNameEl.style.cssText = [
    'font-family:' + T.fh + ';font-size:18px;',
    'font-weight:' + T.fwBold + ';color:' + T.text + ';',
    'letter-spacing:0.16em;text-transform:uppercase;',
    'white-space:nowrap;overflow:hidden;text-overflow:ellipsis;',
  ].join('');
  centerEl.appendChild(_headerNameEl);

  _headerSubtitleEl = document.createElement('div');
  _headerSubtitleEl.style.cssText = 'font-family:' + T.fb + ';font-size:10px;color:' + T.border + ';letter-spacing:0.10em;text-transform:uppercase;';
  centerEl.appendChild(_headerSubtitleEl);

  // LOGOUT pill (right, landing)
  _logoutEl = document.createElement('div');
  _logoutEl.style.cssText = [
    'display:none;flex-shrink:0;',
    'background:' + T.verm + ';color:#fff;',
    'font-family:' + T.fb + ';font-size:' + T.fsB3 + ';font-weight:' + T.fwBold + ';',
    'letter-spacing:0.10em;padding:6px 16px;',
    'border-radius:999px;cursor:pointer;user-select:none;',
    'box-shadow:0 4px 0 ' + T.vermDk + ';',
    'transition:transform 0.07s ease,box-shadow 0.07s ease;',
  ].join('');
  _logoutEl.textContent = 'LOGOUT';
  _logoutEl.addEventListener('pointerdown', function() {
    _logoutEl.style.transform = 'translateY(2px)';
    _logoutEl.style.boxShadow = '0 2px 0 ' + T.vermDk;
  });
  _logoutEl.addEventListener('pointerleave', function() {
    _logoutEl.style.transform = '';
    _logoutEl.style.boxShadow = '0 4px 0 ' + T.vermDk;
  });
  _logoutEl.addEventListener('pointerup', function() {
    _logoutEl.style.transform = '';
    _logoutEl.style.boxShadow = '0 4px 0 ' + T.vermDk;
    SceneManager.openGate('login');
  });
  _headerEl.appendChild(_logoutEl);

  // × close (right, transactional)
  _headerXEl = document.createElement('div');
  _headerXEl.style.cssText = [
    'display:none;flex-shrink:0;',
    'font-family:' + T.fh + ';font-size:26px;',
    'font-weight:' + T.fwBold + ';color:' + T.green + ';',
    'cursor:pointer;user-select:none;',
    'padding:0 0 0 8px;line-height:1;',
  ].join('');
  _headerXEl.textContent = '✕';
  _headerEl.appendChild(_headerXEl);

  return _headerEl;
}

function _showHeader() {
  _ensureHeader();
  _headerEl.style.display = 'flex';
}

function _hideHeader() {
  if (!_headerEl) return;
  _headerEl.style.display = 'none';
  _stopClock();
  if (_headerBackEl)     { _headerBackEl.onclick = null; _headerBackEl.style.display = 'none'; }
  if (_headerXEl)        { _headerXEl.onclick    = null; _headerXEl.style.display    = 'none'; }
  if (_clockWrapEl)      _clockWrapEl.style.display  = 'none';
  if (_userWrapEl)       _userWrapEl.style.display   = 'none';
  if (_logoutEl)         _logoutEl.style.display     = 'none';
  if (_headerNameEl)     _headerNameEl.textContent   = '';
  if (_headerSubtitleEl) _headerSubtitleEl.textContent = '';
}

// ── Exports ───────────────────────────────────────

/**
 * Set the center scene title. Shows the header if hidden.
 */
export function setSceneName(name) {
  _ensureHeader();
  _headerNameEl.textContent = name || '';
  _showHeader();
}

/**
 * Set the subtitle line under the scene title (e.g. "3 OPEN · 12% COB").
 * Safe to call at any time — no-ops if header not yet built.
 */
export function setHeaderSubtitle(text) {
  if (_headerSubtitleEl) _headerSubtitleEl.textContent = text || '';
}

/**
 * Show the clock + greeting on the left side. Call once per landing scene.
 * @param {object} emp  — employee object (employee_name/name, role/employee_role)
 */
export function setHeaderUser(emp) {
  _ensureHeader();
  emp = emp || {};
  var name = (emp.employee_name || emp.name || 'MGR').split(' ')[0];
  var h = new Date().getHours();
  var greeting = h < 12 ? 'Good Morning' : h < 17 ? 'Good Afternoon' : 'Good Evening';
  _greetEl.textContent = greeting + ', ' + name + '!';

  _roleEl.innerHTML = '';
  var dot = document.createElement('span');
  dot.style.cssText = 'width:6px;height:6px;border-radius:50%;background:' + T.green + ';flex-shrink:0;display:inline-block;';
  _roleEl.appendChild(dot);
  var roleLabel = (emp.role || emp.employee_role || 'MANAGER').toUpperCase();
  _roleEl.appendChild(document.createTextNode(' ' + roleLabel + ' · ON'));

  _clockWrapEl.style.display = 'flex';
  _userWrapEl.style.display  = 'flex';
  _startClock();
  _showHeader();
}

/**
 * Show or hide the LOGOUT pill on the right side.
 * Tapping it navigates to login via SceneManager.openGate('login').
 */
export function setHeaderLogout(show) {
  _ensureHeader();
  _logoutEl.style.display = show ? 'flex' : 'none';
}

/**
 * Configure ← back and × close buttons (transactional scenes).
 */
export function setHeaderBack(opts) {
  _ensureHeader();
  opts = opts || {};

  if (opts.back) {
    _headerBackEl.style.display = '';
    _headerBackEl.onclick = function() { if (opts.onBack) opts.onBack(); };
  } else {
    _headerBackEl.style.display = 'none';
    _headerBackEl.onclick       = null;
  }

  if (opts.x) {
    _headerXEl.style.display = '';
    _headerXEl.onclick = function() {
      if (opts.onX) opts.onX();
      else if (opts.onBack) opts.onBack();
    };
  } else {
    _headerXEl.style.display = 'none';
    _headerXEl.onclick       = null;
  }

  _showHeader();
}
