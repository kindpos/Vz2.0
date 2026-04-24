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
      'width:100%;height:36px;min-height:36px;',
      'background:' + T.card + ';',
      'border-bottom:1px solid ' + T.border + ';',
      'display:flex;align-items:center;justify-content:flex-end;',
      'padding:0 10px;box-sizing:border-box;flex-shrink:0;',
    ].join('');

    var exitBtn = document.createElement('div');
    exitBtn.style.cssText = [
      'width:24px;height:24px;',
      'background:' + T.verm + ';',
      'border-radius:4px;',
      'display:flex;align-items:center;justify-content:center;',
      'cursor:pointer;',
      'font-family:' + T.fb + ';font-size:14px;font-weight:700;',
      'color:#fff;',
      'pointer-events:auto;touch-action:manipulation;',
    ].join('');
    exitBtn.textContent = '×';
    placeholderHeader.appendChild(exitBtn);

    window._header = placeholderHeader;
    appRoot.insertBefore(placeholderHeader, appRoot.firstChild);
  }

  // 1. Init scene manager — wire DOM layers
  SceneManager.init();

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
