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
import { validateToken } from './token-validator.js';

// ── Scene imports ─────────────────────────────────
import { defineActivationScene } from './scenes/activation.js';
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
import './scenes/qsr-order.js';
import './scenes/qsr-cash.js';
import './scenes/qsr-card.js';
import './scenes/qsr-complete.js';
import './scenes/qsr-split.js';
import './qsr-utils.js';
import './scenes/shared-interrupts.js';

// ── Dev console hook ──────────────────────────────
window._SM = SceneManager;

// ═══════════════════════════════════════════════════
//  PRICING CONFIG STORE
//  Populated at boot and refreshed on config version
//  change. Exposed as window.pricingConfig so scenes
//  can read it without a separate import.
// ═══════════════════════════════════════════════════

var pricingConfig = window.pricingConfig = {
  orderTypes:       [],   // GET /config/pricing/order-types
  dayParts:         [],   // GET /config/pricing/day-parts
  discounts:        [],   // GET /config/pricing/discounts (unified specials + employee_discount)
};

// 2dp monetary rounding, ROUND_HALF_UP-safe for positive values.
// Number.EPSILON nudge prevents float drift like 1.005*100 → 100.4999…
function roundHalfUp(value) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}
window.roundHalfUp = roundHalfUp;

function _timeToMinutes(hhmm) {
  var parts = (hhmm || '00:00').split(':');
  return parseInt(parts[0], 10) * 60 + parseInt(parts[1] || '0', 10);
}

function getActiveDayPartWindow() {
  var now = new Date();
  var dayOfWeek = now.getDay(); // 0=Sun, 1=Mon ... 6=Sat
  // Convert to Mon-based index: backend days[] is [Mon,Tue,Wed,Thu,Fri,Sat,Sun]
  var dayIdx = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
  var nowMins = now.getHours() * 60 + now.getMinutes();

  var dayParts = window.pricingConfig?.dayParts ?? [];
  for (var i = 0; i < dayParts.length; i++) {
    var dp = dayParts[i];
    var windows = dp.windows ?? [];
    for (var j = 0; j < windows.length; j++) {
      var win = windows[j];
      // Check day of week
      var wDays = win.days || [];
      if (wDays.length > 0 && !wDays[dayIdx]) continue;
      // Check time window
      var start = _timeToMinutes(win.start);
      var end = _timeToMinutes(win.end);
      var inWindow = start <= end
        ? nowMins >= start && nowMins < end
        : nowMins >= start || nowMins < end; // overnight window
      if (inWindow) return { dayPart: dp, window: win };
    }
  }
  return null;
}
window.getActiveDayPartWindow = getActiveDayPartWindow;

var _lastConfigVersion = null;

async function loadPricingConfig() {
  var results = await Promise.all([
    fetchWithTimeout('/api/v1/config/pricing/order-types', {}, 8000).catch(function() { return null; }),
    fetchWithTimeout('/api/v1/config/pricing/day-parts',   {}, 8000).catch(function() { return null; }),
    fetchWithTimeout('/api/v1/config/pricing/discounts',   {}, 8000).catch(function() { return null; }),
  ]);
  var otRes = results[0], dpRes = results[1], discRes = results[2];
  try { if (otRes && otRes.ok) { var ot = await otRes.json(); pricingConfig.orderTypes = Array.isArray(ot) ? ot : []; } } catch(e) {}
  try { if (dpRes && dpRes.ok) { var dpData = await dpRes.json(); pricingConfig.dayParts = (dpData && Array.isArray(dpData.day_parts)) ? dpData.day_parts : []; } } catch(e) {}
  try { if (discRes && discRes.ok) { var discData = await discRes.json(); pricingConfig.discounts = (discData && Array.isArray(discData.discounts)) ? discData.discounts : []; } } catch(e) {}
  console.log('[KINDpos] Pricing config loaded:', {
    orderTypes: pricingConfig.orderTypes.length,
    dayParts:   pricingConfig.dayParts.length,
    discounts:  pricingConfig.discounts.length,
  });
}

async function pollConfigVersion() {
  try {
    var res  = await fetchWithTimeout('/api/v1/config/version', {}, 8000);
    var data = await res.json();
    var ver  = data.version != null ? data.version : null;
    if (ver !== null && _lastConfigVersion !== null && ver !== _lastConfigVersion) {
      console.log('[KINDpos] Config changed — reloading pricing config...');
      await loadPricingConfig();
    }
    _lastConfigVersion = ver;
  } catch(e) { /* silent */ }
}

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
      'font-size:11px;color:#fff;letter-spacing:1.8px;font-weight:' + T.fwBold + ';',
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
      'font-family:\'Outfit\',sans-serif;font-weight:' + T.fwBold + ';font-size:14px;',
      'color:#fff;letter-spacing:0.3px;line-height:1;display:none;',
    ].join('');

    // Role chip — shown only when session is active
    var roleEl = document.createElement('div');
    roleEl.style.cssText = [
      'display:none;align-items:center;gap:5px;',
      'font-family:\'JetBrains Mono\',monospace;font-weight:' + T.fwBold + ';',
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
    ].join('') + ";font-weight:" + T.fwBold + ";";
    backBtn.textContent = '<<<';

    // Logout button ("×") — always visible
    var exitBtn = document.createElement('div');
    exitBtn.style.cssText = btnBase + [
      'width:30px;font-size:17px;',
      'background:' + T.verm + ';color:#fff;',
    ].join('') + ";font-weight:" + T.fwBold + ";";
    exitBtn.textContent = '×';

    var _backLastTap = 0;
    backBtn.addEventListener('click', function() {
      var now = Date.now();
      if (now - _backLastTap < 300) {
        _backLastTap = 0;
        var sess = getSession();
        var role0 = sess && sess.roles && sess.roles[0];
        var isManager = typeof role0 === 'string'
          ? role0 === 'manager'
          : !!(role0 && (role0.permission_level === 'manager' ||
               (role0.permissions && role0.permissions.manage_staff)));
        var landingScene = isManager ? 'manager-landing' : 'server-landing';
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
        var role = sess.roles && sess.roles[0];
        var roleName = typeof role === 'string' ? role : (role && (role.name || role.role_id)) || '';
        roleText.textContent = roleName ? roleName.toUpperCase() : '';
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

  // 1a. Overseer binding-token gate (OVERSEER_AUTH.md §7).
  //     If a cached token is present, validate it locally — five §7 checks,
  //     no network. Invalid → wipe the cached binding so the next operator
  //     action funnels through rebind. Valid → publish window._kindpos and
  //     start the 5-minute revocations poll (§7.2 refresh + §7.3 revoke).
  const TOK_KEYS = [
    'kindpos_token', 'kindpos_slot_id', 'kindpos_public_key',
    'kindpos_fingerprint', 'kindpos_revocations', 'kindpos_token_expires_at',
  ];
  function clearKindposKeys() {
    for (const k of TOK_KEYS) {
      try { localStorage.removeItem(k); } catch (e) { /* private mode */ }
    }
  }
  const storedToken       = localStorage.getItem('kindpos_token');
  const storedSlotId      = localStorage.getItem('kindpos_slot_id');
  const storedPublicKey   = localStorage.getItem('kindpos_public_key');
  const storedFingerprint = localStorage.getItem('kindpos_fingerprint');
  let storedRevocations = [];
  try {
    const raw = localStorage.getItem('kindpos_revocations');
    storedRevocations = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(storedRevocations)) storedRevocations = [];
  } catch (e) { storedRevocations = []; }

  if (storedToken && storedSlotId && storedPublicKey && storedFingerprint) {
    const result = await validateToken(
      storedToken, storedPublicKey, storedFingerprint, storedRevocations,
    );
    if (!result.valid) {
      console.info('[kindpos] cached binding token invalid:', result.reason);
      clearKindposKeys();
    } else {
      window._kindpos = {
        slotId: storedSlotId,
        token: storedToken,
        publicKey: storedPublicKey,
        fingerprint: storedFingerprint,
      };
      // 5-minute revocations poll. Only runs while a valid binding exists.
      const pollRevocations = async () => {
        try {
          const res = await fetchWithTimeout(
            '/api/v1/terminals/revocations',
            { headers: { Authorization: 'Bearer ' + window._kindpos.token } },
            10000,
          );
          if (res.status === 401) {
            clearKindposKeys();
            window.location.reload();
            return;
          }
          if (!res.ok) return;
          const body = await res.json();
          const revoked = Array.isArray(body.revoked_slot_ids) ? body.revoked_slot_ids : [];
          localStorage.setItem('kindpos_revocations', JSON.stringify(revoked));
          if (revoked.includes(window._kindpos.slotId)) {
            clearKindposKeys();
            window.location.reload();
            return;
          }
          if (body.refreshed_token) {
            localStorage.setItem('kindpos_token', body.refreshed_token);
            window._kindpos.token = body.refreshed_token;
            if (body.refreshed_token_expires_at) {
              localStorage.setItem('kindpos_token_expires_at', body.refreshed_token_expires_at);
            }
          }
        } catch (e) {
          // §8 — heartbeat / revocations poll failures are best-effort.
          console.debug('[kindpos] revocations poll failed:', e && e.message);
        }
      };
      setInterval(pollRevocations, 5 * 60 * 1000);
    }
  }

  // 2. Register activation scene
  SceneManager.register(defineActivationScene());

  // 3. Check server-license activation (must come before login).
  //    Any record with status='active' counts as activated; otherwise we
  //    show the activation gate. A network failure here is treated as
  //    "not activated" so a brand-new server can never silently bypass.
  try {
    const licRes = await fetchWithTimeout('/api/v1/licenses/status', {}, 8000);
    const licData = await licRes.json();
    if (!licData.activated) {
      SceneManager.openGate('activation');
      return;
    }
  } catch (e) {
    console.info('[app] License check failed, opening activation gate');
    SceneManager.openGate('activation');
    return;
  }

  // 4. Load store config from backend
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

  // 5. Load pricing config (order types, day parts, specials, employee discount)
  await loadPricingConfig();

  // 6. Start config-version polling — detects Overseer changes while terminal
  //    is active and reloads pricing config when the version advances.
  setInterval(pollConfigVersion, 30000);
  pollConfigVersion();

  // 7. Open gate → login scene (only reached if license is activated)
  SceneManager.openGate('login');
}

// ── Run ───────────────────────────────────────────
document.addEventListener('DOMContentLoaded', boot);
