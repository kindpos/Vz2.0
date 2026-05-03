// ═══════════════════════════════════════════════════
//  KINDpos Terminal — Login Scene  (Vz2.0)
//  Gate layer — split layout, store branding + numpad
//  Nice. Dependable. Yours.
// ═══════════════════════════════════════════════════

import { defineScene, SceneManager } from '../scene-manager.js';
import { T }                          from '../../common/tokens.js';
import {
  buildPillButton,
  buildSectionLabel,
  buildDivider,
  hexToRgba,
} from '../theme-manager.js';

// Inline helper — darken a hex color by pct (0–1)
function darkenHex(hex, pct) {
  hex = hex.replace('#', '');
  if (hex.length === 3) hex = hex[0]+hex[0]+hex[1]+hex[1]+hex[2]+hex[2];
  const r = Math.max(0, Math.round(parseInt(hex.slice(0,2),16) * (1-pct)));
  const g = Math.max(0, Math.round(parseInt(hex.slice(2,4),16) * (1-pct)));
  const b = Math.max(0, Math.round(parseInt(hex.slice(4,6),16) * (1-pct)));
  return `#${[r,g,b].map((v) => v.toString(16).padStart(2,'0')).join('')}`;
}
import { buildNumpad } from '../numpad.js';
import { showToast }   from '../components.js';
import { setToken, clearToken } from '../auth-client.js';
import { fetchWithTimeout }     from '../net.js';

// ── Constants ─────────────────────────────────────
const PIN_LENGTH = 4;

// ── Clock ─────────────────────────────────────────
function _startClock(timeEl, dateEl, dayEl) {
  function _tick() {
    const now  = new Date();
    const h    = now.getHours() % 12 || 12;
    const m    = String(now.getMinutes()).padStart(2, '0');
    const ampm = now.getHours() >= 12 ? 'pm' : 'am';
    const day  = now.toLocaleDateString([], { weekday: 'long' });
    const date = now.toLocaleDateString([], { month: 'long', day: 'numeric', year: 'numeric' });

    if (timeEl) timeEl.textContent = `${String(h).padStart(2, '0')}:${m}`;
    if (dateEl) dateEl.textContent = date;
    if (dayEl)  dayEl.textContent  = day;

    // Update am/pm suffix separately so it can be styled smaller
    const suffix = timeEl ? timeEl.parentElement.querySelector('.login-ampm') : null;
    if (suffix) suffix.textContent = ampm;
  }
  _tick();
  return setInterval(_tick, 1000);
}

// ── Auth ──────────────────────────────────────────
async function _attemptLogin(pin, onSuccess, onFail) {
  try {
    if (pin.length !== PIN_LENGTH || !/^\d+$/.test(pin)) {
      onFail('INVALID PIN');
      return;
    }
    console.log('[login] attempting auth...');
    const res = await fetchWithTimeout('/api/v1/auth/verify-pin', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ pin }),
    }, 10000);
    console.log('[login] response status:', res.status);
    if (res.status === 429) {
      // Rate-limited — show a distinct message so operators don't retype a valid PIN.
      onFail('TOO MANY ATTEMPTS');
      return;
    }
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    if (data.valid) {
      // Persist the bearer token so auth-client can attach it to every
      // subsequent /api/* request. Without this the server-side auth
      // gates never see a valid session and (under KINDPOS_AUTH_ENFORCED
      // = true) would start returning 401.
      setToken(data);
      onSuccess(data);
    } else {
      onFail();
    }
  } catch (e) {
    console.error('[login] Auth error:', e);
    onFail();
  }
}

// ── Scene definition ──────────────────────────────
defineScene({
  name: 'login',

  state: {
    pin:    [],
    locked: false,
  },

  render: function(container, params, state) {

    // ── Root layout ────────────────────────────────
    const root = document.createElement('div');
    root.style.cssText = `${[
      'position:absolute;inset:0;',
      'display:flex;',
      `background:${T.bg};`,
      `font-family:${T.fb};`,
    ].join('')};font-weight:${T.fwBold};`;
    container.appendChild(root);

    // ── Left panel — store branding ────────────────
    const leftWrap = document.createElement('div');
    leftWrap.style.cssText = [
      'width:42%;',
      `border-right:1px solid ${T.border};`,
      'display:flex;flex-direction:column;',
      'padding:56px 60px 40px;',
      'position:relative;',
      `background:linear-gradient(160deg,${T.bg} 0%,${hexToRgba(T.well, 0.6)} 100%);`,
    ].join('');
    root.appendChild(leftWrap);

    // Logo slot
    const logoSlot = document.createElement('div');
    logoSlot.style.cssText = `${[
      'width:100%;height:140px;',
      `border:1px solid ${hexToRgba(T.storePrimary || T.green, 0.6)};`,
      'display:flex;align-items:center;justify-content:center;',
      'margin-bottom:20px;',
      `background:${hexToRgba(T.storePrimary || T.green, 0.08)};`,
      'position:relative;',
      `font-family:${T.fb};`,
      `font-size:${T.fsB3};`,
      `color:${hexToRgba(T.storePrimary || T.green, 0.5)};`,
      'letter-spacing:0.15em;',
      'flex-shrink:0;',
    ].join('')};font-weight:${T.fwBold};`;

    if (T.storeLogoUrl) {
      const img = document.createElement('img');
      img.src = T.storeLogoUrl;
      img.style.cssText = 'max-width:100%;max-height:100%;object-fit:contain;';
      logoSlot.appendChild(img);
    } else {
      logoSlot.textContent = 'LOGO';
    }
    leftWrap.appendChild(logoSlot);

    // Store name
    const storeName = document.createElement('div');
    storeName.textContent  = T.storeName || 'Store Name';
    storeName.style.cssText = [
      `font-family:${T.fh};`,
      'font-size:56px;',
      `font-weight:${T.fwBold};`,
      `color:${T.text};`,
      'letter-spacing:0.06em;',
      'line-height:1.1;',
      'margin-bottom:24px;',
      'text-align:center;',
    ].join('');
    leftWrap.appendChild(storeName);

    // Divider
    leftWrap.appendChild(buildDivider('0 0 20px'));

    // Clock block
    const clockBlock = document.createElement('div');
    clockBlock.style.cssText = 'flex:1;display:flex;flex-direction:column;justify-content:center;align-items:center;';

    const clockBtn = buildPillButton({
      label:   'Clock In / Out',
      color:   T.greenWarm,
      darkBg:  T.greenWarmDk,
      onClick: () => {
        if (state.pin.length === PIN_LENGTH) {
          // PIN already entered — auth and always show timeclock (clock in OR out)
          if (state.locked) return;
          state.locked = true;
          _attemptLogin(
            state.pin.join(''),
            (data) => { state.locked = false; _showTimeclock(data); },
            (msg)  => { state.locked = false; numpad.setError(msg || 'INVALID PIN'); }
          );
        } else {
          // No PIN yet — show overlay prompting for PIN entry
          _showTimeclock(null);
        }
      },
    });
    clockBtn.style.flexShrink = '0';
    clockBtn.style.width = 'fit-content'; clockBtn.style.alignSelf = 'center'; clockBtn.style.padding = '12px 48px';
    leftWrap.appendChild(clockBtn);

    leftWrap.appendChild(clockBlock);

    const timeRow = document.createElement('div');
    timeRow.style.cssText = 'display:flex;align-items:baseline;gap:6px;';
    clockBlock.appendChild(timeRow);

    const timeEl = document.createElement('span');
    timeEl.style.cssText = [
      `font-family:${T.fh};`,
      'font-style:italic;',
      'font-size:104px;',
      `font-weight:${T.fwBold};`,
      `color:${T.green};`,
      'line-height:1;',
      `text-shadow:0 0 28px ${hexToRgba(T.green, 0.4)};`,
    ].join('');
    timeRow.appendChild(timeEl);

    const ampmEl = document.createElement('span');
    ampmEl.className = 'login-ampm';
    ampmEl.style.cssText = `${[
      `font-family:${T.fh};`,
      'font-style:italic;',
      'font-size:40px;',
      `color:${T.green};`,
      'opacity:0.65;',
    ].join('')};font-weight:${T.fwBold};`;
    timeRow.appendChild(ampmEl);

    const dayEl = document.createElement('div');
    dayEl.style.cssText = `${[
      `font-family:${T.fh};`,
      'font-style:italic;',
      'font-size:28px;',
      `color:${T.text};`,
      'letter-spacing:0.06em;',
      'margin-top:6px;',
      'opacity:0.75;',
    ].join('')};font-weight:${T.fwBold};`;
    clockBlock.appendChild(dayEl);

    const dateEl = document.createElement('div');
    dateEl.style.cssText = `${[
      `font-family:${T.fh};`,
      'font-style:italic;',
      'font-size:28px;',
      `color:${T.green};`,
      'letter-spacing:0.06em;',
      'margin-top:2px;',
      'opacity:0.65;',
    ].join('')};font-weight:${T.fwBold};`;
    clockBlock.appendChild(dateEl);

    const configBtn = buildPillButton({
      label:   'Configuration',
      color:   T.verm,
      darkBg:  T.vermDk,
      onClick: () => {
        SceneManager.mountWorking('settings', { tab: 'TERMINAL' });
        SceneManager.closeGate('login');
      },
    });
    configBtn.style.width = 'fit-content'; configBtn.style.alignSelf = 'center'; configBtn.style.padding = '18px 32px'; configBtn.style.marginBottom = '8px';
    leftWrap.appendChild(configBtn);

    // ── Right panel — PIN entry ────────────────────
    const rightWrap = document.createElement('div');
    rightWrap.style.cssText = [
      'flex:1;',
      'position:relative;',
      'display:flex;flex-direction:column;',
      'align-items:center;justify-content:center;',
      'padding:48px 72px;',
      'gap:36px;',
    ].join('');
    root.appendChild(rightWrap);

    // ── Timeclock overlay — slides over left panel ──────
    function _showTimeclock(emp) {
      const overlay = document.createElement('div');
      overlay.style.cssText = [
        'position:absolute;inset:0;',
        `background:${T.card};`,
        `border-right:1px solid ${T.green};`,
        'display:flex;flex-direction:column;',
        'transform:translateX(-100%);',
        'transition:transform 0.25s ease;',
        'z-index:10;',
      ].join('');
      leftWrap.appendChild(overlay);
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          overlay.style.transform = 'translateX(0)';
        });
      });

      let _overlayClosed = false;
      function _closeOverlay() {
        if (_overlayClosed) return;
        _overlayClosed = true;
        overlay.style.transform = 'translateX(-100%)';
        setTimeout(() => {
          if (overlay.parentNode) overlay.remove();
        }, 260);
      }

      function _buildContent(empData) {
        overlay.innerHTML = '';
        const empId   = empData ? (empData.employee_id || empData.id || '') : '';
        const empName = empData ? (empData.name || 'Team Member') : '';
        const roles   = empData ? (empData.roles || ['server']) : [];

        // Header
        const hdr = document.createElement('div');
        hdr.style.cssText = `background:${T.green};height:40px;flex-shrink:0;display:flex;align-items:center;justify-content:space-between;padding:0 20px;`;
        const hdrL = document.createElement('span');
        hdrL.textContent = 'TIMECLOCK';
        hdrL.style.cssText = `font-family:${T.fb};font-size:12px;font-weight:700;letter-spacing:3px;color:${T.well};`;
        const hdrR = document.createElement('span');
        hdrR.style.cssText = `font-family:${T.fb};font-size:10px;color:${T.well};opacity:0.7;cursor:pointer;;font-weight:${T.fwBold};`;
        hdrR.textContent = '✕';
        hdrR.addEventListener('pointerup', _closeOverlay);
        hdr.appendChild(hdrL); hdr.appendChild(hdrR);
        overlay.appendChild(hdr);

        if (!empData) {
          // No emp yet — prompt to enter PIN
          const msg = document.createElement('div');
          msg.style.cssText = `flex:1;display:flex;align-items:center;justify-content:center;font-family:${T.fb};font-size:11px;letter-spacing:2px;color:${T.border};text-align:center;padding:20px;;font-weight:${T.fwBold};`;
          msg.textContent = 'ENTER YOUR PIN ON THE RIGHT TO CONTINUE';
          overlay.appendChild(msg);
          return;
        }

        // Body
        const body = document.createElement('div');
        body.style.cssText = 'flex:1;display:flex;flex-direction:column;padding:20px;gap:14px;overflow:hidden;';
        overlay.appendChild(body);

        const greet = document.createElement('div');
        greet.textContent = `${_greetingText()}, ${empName.split(' ')[0]}.`;
        greet.style.cssText = `font-family:${T.fh};font-size:26px;font-weight:800;color:${T.text};flex-shrink:0;`;
        body.appendChild(greet);

        const sub = document.createElement('div');
        sub.textContent = 'Select a role to clock in';
        sub.style.cssText = `font-family:${T.fb};font-size:10px;letter-spacing:2px;color:${T.border};text-transform:uppercase;flex-shrink:0;;font-weight:${T.fwBold};`;
        body.appendChild(sub);

        // Role buttons
        const roleGrid = document.createElement('div');
        roleGrid.style.cssText = 'display:flex;flex-wrap:wrap;gap:8px;align-content:center;flex:1;';
        body.appendChild(roleGrid);

        // Pool memberships chosen by the employee for this shift.
        let selectedPoolIds = [];
        // All active pools fetched from the backend.
        let _allPools = [];

        // Pool section — rendered/updated whenever the selected role changes.
        const poolSection = document.createElement('div');
        poolSection.style.cssText = 'flex-shrink:0;display:none;flex-direction:column;gap:6px;';
        const poolSectionLbl = document.createElement('div');
        poolSectionLbl.style.cssText = `font-family:${T.fb};font-size:9px;letter-spacing:2px;color:${T.border};text-transform:uppercase;;font-weight:${T.fwBold};`;
        poolSectionLbl.textContent = 'TIP POOLS — TAP TO JOIN';
        poolSection.appendChild(poolSectionLbl);
        const poolChips = document.createElement('div');
        poolChips.style.cssText = 'display:flex;flex-wrap:wrap;gap:6px;';
        poolSection.appendChild(poolChips);

        // Check if a pool's schedule window covers the current time.
        function _poolMatchesNow(pool) {
          if (!pool.schedule || (!pool.schedule.start && !pool.schedule.end)) return true;
          const now = new Date();
          const hhmm = `${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}`;
          const s = pool.schedule.start || '00:00';
          const e = pool.schedule.end   || '23:59';
          // Handles overnight windows (e.g. 17:00–02:00).
          if (s <= e) return hhmm >= s && hhmm <= e;
          return hhmm >= s || hhmm <= e;
        }

        function _refreshPoolSection(role) {
          selectedPoolIds = [];
          poolChips.innerHTML = '';
          const matching = _allPools.filter((p) => p.active !== false
              && Array.isArray(p.role_ids)
              && p.role_ids.indexOf(role) !== -1
              && _poolMatchesNow(p));
          if (matching.length === 0) {
            poolSection.style.display = 'none';
            return;
          }
          poolSection.style.display = 'flex';
          matching.forEach((pool) => {
            let joined = false;
            const chip = buildPillButton({
              label: pool.name.toUpperCase(),
              color: T.card,
              darkBg: T.well,
              fontSize: '10px',
            });
            function _paint() {
              chip.setColor(
                joined ? T.elec : T.card,
                joined ? hexToRgba(T.elec, 0.15) : T.well,
                joined ? T.elec : T.border
              );
              chip.style.border = `1px solid ${joined ? T.elec : T.border}`;
            }
            _paint();
            chip.style.padding = '6px 14px';
            chip.style.letterSpacing = '1.5px';
            chip.style.height = 'auto';

            chip.addEventListener('pointerup', () => {
              joined = !joined;
              chip.textContent = pool.name.toUpperCase() + (joined ? ' ✓' : '');
              if (joined) {
                selectedPoolIds.push(pool.pool_id);
              } else {
                selectedPoolIds = selectedPoolIds.filter((id) => id !== pool.pool_id);
              }
              _paint();
            });
            poolChips.appendChild(chip);
          });
        }

        let selectedRole = null;
        const roleBtns = [];
        roles.forEach((role) => {
          const rc = (T.roles && T.roles[role]) || T.elec;
          const rd = darkenHex(rc, 0.35);
          const btn = buildPillButton({
            label:    role.toUpperCase(),
            color:    hexToRgba(rc, 0.15),
            darkBg:   hexToRgba(rc, 0.08),
            textColor: rc,
            fontSize: T.fsB3,
            onClick:  ((r, rcc, rdd) => () => {
              selectedRole = r;
              roleBtns.forEach((rb) => {
                const sel = rb._role === r;
                if (sel) {
                  rb.setColor(rb._rc, rb._rd, T.well);
                } else {
                  rb.setColor(hexToRgba(rb._rc, 0.15), hexToRgba(rb._rc, 0.08), rb._rc);
                }
              });
              _refreshPoolSection(r);
              clockInBtn.style.opacity       = '1';
              clockInBtn.style.pointerEvents = 'auto';
            })(role, rc, rd),
          });
          btn._role = role; btn._rc = rc; btn._rd = rd;
          roleBtns.push(btn);
          roleGrid.appendChild(btn);
        });

        // Hours card
        const hrsWrap = document.createElement('div');
        hrsWrap.style.cssText = `flex-shrink:0;display:flex;align-items:baseline;gap:8px;padding:10px 14px;background:${T.well};border-radius:${T.chamferCard}px;border-left:${T.accentBarW} solid ${T.gold};`;
        const hrsVal = document.createElement('span');
        hrsVal.textContent = '–';
        hrsVal.style.cssText = `font-family:${T.fh};font-size:28px;font-weight:800;color:${T.gold};`;
        const hrsLbl = document.createElement('span');
        hrsLbl.textContent = 'hours this week';
        hrsLbl.style.cssText = `font-family:${T.fb};font-size:10px;color:${T.border};;font-weight:${T.fwBold};`;
        hrsWrap.appendChild(hrsVal); hrsWrap.appendChild(hrsLbl);
        body.appendChild(hrsWrap);

        body.appendChild(poolSection);

        // Action buttons
        const clockInBtn = buildPillButton({ label: 'CLOCK IN', color: T.greenWarm, darkBg: T.greenWarmDk, fontSize: T.fsB3 });
        clockInBtn.style.width = '100%'; clockInBtn.style.opacity = '0.35'; clockInBtn.style.pointerEvents = 'none';
        body.appendChild(clockInBtn);

        // Fetch active pools in the background so they're ready when a role is picked.
        (async () => {
          try {
            const r = await fetchWithTimeout('/api/v1/config/tip_pools', {}, 10000);
            const pools = r.ok ? await r.json() : [];
            if (_overlayClosed) return;
            _allPools = Array.isArray(pools) ? pools : [];
          } catch (e) {
            _allPools = [];
          }
        })();

        const clockOutBtn = buildPillButton({ label: 'CLOCK OUT', color: T.verm, darkBg: T.vermDk, fontSize: T.fsB3 });
        clockOutBtn.style.width = '100%'; clockOutBtn.style.display = 'none';
        body.appendChild(clockOutBtn);

        const cancelBtn = buildPillButton({ label: 'CANCEL', color: T.border, darkBg: T.well, fontSize: T.fsB3 });
        cancelBtn.style.width = '100%';
        cancelBtn.addEventListener('pointerup', _closeOverlay);
        body.appendChild(cancelBtn);

        // Clocked-in check
        (async () => {
          try {
            const r = await fetchWithTimeout('/api/v1/servers/clocked-in', {}, 10000);
            const d = await r.json();
            if (_overlayClosed) return;
            const match = (d.staff || []).find((s) => s.employee_id === empId);
            if (match) {
              sub.textContent = 'You are currently clocked in';
              greet.style.color = T.green;
              roleGrid.style.display = 'none';
              clockInBtn.style.display = 'none';
              clockOutBtn.style.display = '';
            }
          } catch (e) { /* ignore */ }
        })();

        // Hours fetch
        const today = new Date();
        const ds = `${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,'0')}-${String(today.getDate()).padStart(2,'0')}`;
        (async () => {
          try {
            const r = await fetchWithTimeout(`/api/v1/reports/labor-summary?date=${ds}&server_id=${encodeURIComponent(empId)}`, {}, 10000);
            const d = await r.json();
            if (_overlayClosed) return;
            hrsVal.textContent = `${(Number(d.weekly_hours ?? d.total_hours) || 0).toFixed(2)}h`;
          } catch (e) {
            if (_overlayClosed) return;
            hrsVal.textContent = '0.00h';
          }
        })();

        // Clock In action
        clockInBtn.addEventListener('pointerup', async () => {
          if (!selectedRole) return;
          clockInBtn.style.opacity = '0.35'; clockInBtn.style.pointerEvents = 'none';
          try {
            const r = await fetchWithTimeout('/api/v1/servers/clock-in', { method:'POST', headers:{'Content-Type':'application/json'},
              body: JSON.stringify({ employee_id: empId, employee_name: empName, role: selectedRole, pool_memberships: selectedPoolIds }),
            }, 15000);
            if (!r.ok) {
              const d = await r.json();
              throw new Error(d.detail||'Failed');
            }
            await r.json();
            showToast(`${empName} clocked in as ${selectedRole.toUpperCase()}`, { bg: T.greenWarm, duration: 3000 });
            _closeOverlay();
            SceneManager.closeGate('login');
            const dest = selectedRole === 'manager' ? 'manager-landing' : 'server-landing';
            SceneManager.mountWorking(dest, { staff: empData });
          } catch (e) {
            showToast(e.message||'Clock-in failed', { bg: T.verm, duration: 3000 });
            clockInBtn.style.opacity = '1'; clockInBtn.style.pointerEvents = 'auto';
          }
        });

        // Clock Out action
        clockOutBtn.addEventListener('pointerup', async () => {
          clockOutBtn.style.opacity = '0.35'; clockOutBtn.style.pointerEvents = 'none';
          try {
            const r = await fetchWithTimeout('/api/v1/servers/clock-out', { method:'POST', headers:{'Content-Type':'application/json'},
              body: JSON.stringify({ employee_id: empId, employee_name: empName }),
            }, 15000);
            if (!r.ok) {
              const d = await r.json();
              throw new Error(d.detail||'Failed');
            }
            await r.json();
            showToast(`${empName} clocked out`, { bg: T.greenWarm, duration: 3000 });
            _closeOverlay();
          } catch (e) {
            showToast(e.message||'Clock-out failed', { bg: T.verm, duration: 3000 });
            clockOutBtn.style.opacity = '1'; clockOutBtn.style.pointerEvents = 'auto';
          }
        });
      }

      _buildContent(emp);
    }

    function _greetingText() {
      const h = new Date().getHours();
      if (h < 12) return 'Good Morning';
      if (h < 17) return 'Good Afternoon';
      return 'Good Evening';
    }

    // Shared auth → routes to landing or shows timeclock overlay
    function _doLogin(pin) {
      if (state.locked) return;
      state.locked = true;
      _attemptLogin(
        pin,
        async function onSuccess(data) {
          const empId = data.employee_id || data.id || '';
          try {
            const r = await fetchWithTimeout('/api/v1/servers/clocked-in', {}, 10000);
            const clockData = await r.json();
            const isClockedIn = (clockData.staff || []).some((s) => s.employee_id === empId);
            if (!isClockedIn) {
              state.locked = false;
              _showTimeclock(data);
              return;
            }
            SceneManager.closeGate('login');
            // Collect all service types across all roles this employee holds
            const allServiceTypes = [];
            (data.roles || []).forEach((r) => {
              (r.service_types || ['full_service']).forEach((st) => {
                if (allServiceTypes.indexOf(st) === -1) allServiceTypes.push(st);
              });
            });

            // Determine if this employee has manager-level permissions
            const isManager = (data.roles || []).some((r) => r.permission_level === 'manager' || (r.permissions && r.permissions.manage_staff));

            function mountForMode(mode) {
              if (mode === 'qsr') {
                SceneManager.mountWorking('qsr-order');
              } else {
                // full_service — surface depends on permission level
                if (isManager) {
                  SceneManager.mountWorking('manager-landing');
                } else {
                  SceneManager.mountWorking('server-landing');
                }
              }
            }

            // service_types is assigned at the role level — the role a cashier
            // clocks into determines the mode directly. No picker needed.
            // Use the first service type from the employee's primary role.
            // Fall back to 'full_service' if service_types is missing or empty.
            const mode = allServiceTypes.length > 0
              ? allServiceTypes[0]
              : 'full_service';
            mountForMode(mode);
          } catch (e) {
            state.locked = false;
            SceneManager.closeGate('login');
            // Collect all service types across all roles this employee holds
            const allServiceTypes = [];
            (data.roles || []).forEach((r) => {
              (r.service_types || ['full_service']).forEach((st) => {
                if (allServiceTypes.indexOf(st) === -1) allServiceTypes.push(st);
              });
            });

            // Determine if this employee has manager-level permissions
            const isManager = (data.roles || []).some((r) => r.permission_level === 'manager' || (r.permissions && r.permissions.manage_staff));

            function mountForMode(mode) {
              if (mode === 'qsr') {
                SceneManager.mountWorking('qsr-order');
              } else {
                if (isManager) {
                  SceneManager.mountWorking('manager-landing');
                } else {
                  SceneManager.mountWorking('server-landing');
                }
              }
            }

            // service_types is assigned at the role level — the role a cashier
            // clocks into determines the mode directly. No picker needed.
            // Use the first service type from the employee's primary role.
            // Fall back to 'full_service' if service_types is missing or empty.
            const mode = allServiceTypes.length > 0
              ? allServiceTypes[0]
              : 'full_service';
            mountForMode(mode);
          }
        },
        function onFail(msg) {
          state.locked = false;
          numpad.setError(msg || 'INVALID PIN');
        }
      );
    }

    // Numpad — display + chassis built together
    const numpad = buildNumpad({
      masked:      true,
      maxDigits:   PIN_LENGTH,
      submitLabel: '>>>',
      canSubmit:   (p) => p.length === PIN_LENGTH,
      onSubmit:    (pin) => { _doLogin(pin); },
      onChange:    (p)   => { state.pin = p.split(''); },
    });
    rightWrap.appendChild(numpad);

    // Terminal ID — bottom of right panel, readable
    const termId = document.createElement('div');
    termId.textContent  = 'T-001';
    termId.style.cssText = `${[
      'position:absolute;bottom:16px;left:24px;',
      `font-family:${T.fb};`,
      `font-size:${T.fsB2};`,
      `color:${T.green};`,
      'letter-spacing:0.2em;',
      'text-transform:uppercase;',
      'opacity:0.6;',
    ].join('')};font-weight:${T.fwBold};`;
    rightWrap.appendChild(termId);

    // ── Start clock ────────────────────────────────
    const clockInterval = _startClock(timeEl, dateEl, dayEl);

    // ── Cleanup ────────────────────────────────────
    return function cleanup() {
      clearInterval(clockInterval);
    };
  },
});
