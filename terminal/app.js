// ═══════════════════════════════════════════════════
//  KINDpos Terminal — app.js  (Vz2.0)
//  Entry point. Boots managers, loads config, opens gate.
//  Also exports the global header API for all scenes.
//  Nice. Dependable. Yours.
// ═══════════════════════════════════════════════════

// Import auth-client FIRST — its module side-effect installs the fetch
// interceptor that attaches the session bearer token to every /api/* call.
// Any scene that runs fetches during its own import (unlikely, but cheap
// insurance) therefore sees the interceptor already in place.
import './auth-client.js';

import { SceneManager } from './scene-manager.js';
import { fetchWithTimeout } from './net.js';
import { performLogout, fmtTime, fmtDate, greetingFor } from './header.js';
import { getSession } from './auth-client.js';
import { T, applyStoreTheme } from '../common/tokens.js';

// ── Scene imports ─────────────────────────────────
import './scenes/login.js';
import './scenes/server-landing.js';
import './scenes/manager-landing.js';
import './scenes/check-overview.js';
import './scenes/column-editor.js';
import './scenes/order-entry.js';
import './scenes/item-detail.js';
import './scenes/payment.js';
import './scenes/server-checkout.js';
import './scenes/close-day.js';

// ── Dev console hook ──────────────────────────────
window._SM = SceneManager;

// ═══════════════════════════════════════════════════
//  BOOT
// ═══════════════════════════════════════════════════

async function boot() {

  // Step 1 — Build a placeholder header
  var appRoot = document.getElementById('terminal');
  if (appRoot) {
    var placeholderHeader = document.createElement('div');
    placeholderHeader.style.cssText = [
      'width:100%;height:' + T.headerH + 'px;min-height:' + T.headerH + 'px;',
      'background:' + T.card + ';',
      'border-bottom:1px solid ' + T.border + ';',
      'display:flex;align-items:center;justify-content:space-between;',
      'padding:0 10px;box-sizing:border-box;flex-shrink:0;',
    ].join('');

    // ── Left group ──
    var leftGroup = document.createElement('div');
    leftGroup.style.cssText = 'display:flex;align-items:center;gap:14px;';

    // Datetime chip
    var dtWidget = document.createElement('div');
    dtWidget.style.cssText = [
      'display:flex;flex-direction:row;align-items:baseline;gap:10px;',
      'padding:7px 14px;',
      'background:' + T.well + ';',
      'border-radius:8px;',
      'border-left:3px solid ' + T.elec + ';',
      'line-height:1;',
    ].join('');
    var dtDateEl = document.createElement('div');
    dtDateEl.style.cssText = [
      'font-family:\'JetBrains Mono\',monospace;',
      'font-size:11px;color:#fff;letter-spacing:1.8px;font-weight:500;',
    ].join('');
    var dtTimeEl = document.createElement('div');
    dtTimeEl.style.cssText = [
      'font-family:\'JetBrains Mono\',monospace;',
      'font-size:16px;color:#fff;letter-spacing:1px;font-weight:700;',
    ].join('');
    dtWidget.append(dtDateEl, dtTimeEl);

    // Greeting — shown only when session is active
    var greetingEl = document.createElement('div');
    greetingEl.style.cssText = [
      'font-family:\'Outfit\',sans-serif;font-weight:600;font-size:14px;',
      'color:#fff;letter-spacing:0.3px;line-height:1;display:none;',
    ].join('');

    // Role chip — shown only when session is active
    var roleEl = document.createElement('div');
    roleEl.style.cssText = [
      'display:none;align-items:center;gap:5px;',
      'font-family:\'JetBrains Mono\',monospace;font-weight:500;',
      'font-size:10px;color:' + T.green + ';letter-spacing:1.4px;',
    ].join('');
    var roleDot = document.createElement('span');
    roleDot.style.cssText = [
      'width:6px;height:6px;border-radius:999px;flex-shrink:0;',
      'background:' + T.green + ';box-shadow:0 0 6px ' + T.green + ';',
    ].join('');
    var roleText = document.createElement('span');
    roleEl.append(roleDot, roleText);

    leftGroup.append(dtWidget, greetingEl, roleEl);
    placeholderHeader.appendChild(leftGroup);

    // ── Right: button row ──
    var btnRow = document.createElement('div');
    btnRow.style.cssText = 'display:flex;align-items:center;gap:6px;';

    var btnBase = [
      'height:30px;',
      'border-radius:4px;',
      'display:flex;align-items:center;justify-content:center;',
      'cursor:pointer;',
      'font-family:' + T.fb + ';font-weight:700;',
      'pointer-events:auto;touch-action:manipulation;',
    ].join('');

    // Back button ("<<<") — hidden until a scene registers a handler
    var backBtn = document.createElement('div');
    backBtn.style.cssText = btnBase + [
      'width:52px;font-size:14px;letter-spacing:0.5px;',
      'background:' + T.verm + ';',
      'color:#fff;',
      'display:none;',
    ].join('');
    backBtn.textContent = '<<<';

    // Logout button ("×") — always visible
    var exitBtn = document.createElement('div');
    exitBtn.style.cssText = btnBase + [
      'width:30px;font-size:17px;',
      'background:' + T.verm + ';color:#fff;',
    ].join('');
    exitBtn.textContent = '×';

    var _backLastTap = 0;
    backBtn.addEventListener('click', function() {
      var now = Date.now();
      if (now - _backLastTap < 300) {
        _backLastTap = 0;
        var sess = getSession();
        var landingScene = (sess && sess.roles && sess.roles[0] === 'manager')
          ? 'manager-landing' : 'server-landing';
        SceneManager.mountWorking(landingScene, sess ? {
          emp: { id: sess.employee_id, name: sess.name },
        } : {});
      } else {
        _backLastTap = now;
        if (_backHandler) _backHandler();
      }
    });
    exitBtn.addEventListener('click', performLogout);

    btnRow.append(backBtn, exitBtn);
    placeholderHeader.appendChild(btnRow);

    // Scenes that want a back affordance call window._header.setBackHandler(fn)
    // in their render and clear with (null) on unmount.
    var _backHandler = null;
    placeholderHeader.setBackHandler = function(fn) {
      _backHandler = (typeof fn === 'function') ? fn : null;
      backBtn.style.display = _backHandler ? 'flex' : 'none';
    };

    // Tick datetime + greeting every second
    function tickDt() {
      var d = new Date();
      dtDateEl.textContent = fmtDate(d);
      dtTimeEl.textContent = fmtTime(d);
      var sess = getSession();
      if (sess && sess.name) {
        var firstName = sess.name.split(' ')[0];
        greetingEl.textContent = greetingFor(d.getHours()) + ', ' + firstName + '!';
        greetingEl.style.display = '';
        roleText.textContent = (sess.roles && sess.roles[0] ? sess.roles[0].toUpperCase() : '');
        roleEl.style.display = roleText.textContent ? 'flex' : 'none';
      } else {
        greetingEl.style.display = 'none';
        roleEl.style.display = 'none';
      }
    }
    tickDt();
    setInterval(tickDt, 1000);

    window._header = placeholderHeader;
    appRoot.insertBefore(placeholderHeader, appRoot.firstChild);
  }

  // 1. Init scene manager — wire DOM layers
  SceneManager.init();

  // 3. Load store config from backend
  try {
    var res = await fetchWithTimeout('/api/v1/config/store', {}, 8000);
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
        storeLogoUrl:    (config.branding && config.branding.logo_url) || null,
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
