/* ============================================
   KINDpos Overseer — Boot Sequence
   Nice. Dependable. Yours.
   ============================================ */

// Import auth-client FIRST — its module side-effect installs the fetch
// interceptor that attaches the session bearer token (and prompts for
// a manager PIN on 401/403). Needed before any other module fires a
// fetch during its own import cycle.
import './services/auth-client.js';

import { SceneManager }              from './components/scene-manager.js';
import { T }                          from './components/tokens.js';
import { initThemeBridge }             from './theme-bridge.js';
import { loadEmployeeData }           from './data/sample-employees.js';
import { loadReportData }             from './data/sample-reports.js';
import { loadTimeData }               from './data/sample-timedata.js';
import { loadPayrollData }            from './data/sample-payroll.js';
import { loadShiftData }              from './data/sample-shifts.js';

import { registerMenuImport }         from './sections/menu-import.js';
import { registerEmployeeSections }   from './sections/employees.js';
import { registerMenuCategories }     from './sections/menu-categories.js';
import { registerConfigureModifiers } from './sections/configure-modifiers.js';
import { registerPricingSpecials }    from './sections/pricing-specials.js';
import { registerPrinterConfig }      from './sections/printer-config.js';
import { registerPrinterSetup }       from './sections/printer-setup.js';
import { buildNetworkSetupScene, cleanupNetworkSetup } from './sections/hardware/network-setup.js';
import { buildTerminalDetailsScene, cleanupTerminalDetailsScene } from './sections/hardware/terminal-details.js';
import { buildHardwareScene, cleanupHardware } from './sections/hardware.js';
import { mount as buildHardwareNetworkScene, cleanupHardwareNetwork } from './sections/hardware-network.js';

// Build-pattern sections (no register wrapper — wrap manually below)
import { buildStoreInfoScene,     cleanupStoreInfo     } from './sections/store-info.js';
import { buildOrderSettingsScene, cleanupOrderSettings } from './sections/order-settings.js';
import { buildCardReadersScene,  cleanupCardReaders  } from './sections/card-readers.js';
import { buildReceiptSettingsScene, cleanupReceiptSettings } from './sections/receipt-settings.js';
import { buildTerminalSettingsScene, cleanupTerminalSettings } from './sections/terminal-settings.js';
import { buildLaborReportsScene,  cleanupLaborReports  } from './sections/labor-reports.js';
import { buildMenuPerformanceScene, cleanupMenuPerformance } from './sections/menu-performance.js';
import { buildFloorPlanScene,    cleanupFloorPlan    } from './sections/floor-plan.js';
import { buildPayrollTipsScene,    cleanupPayrollTips    } from './sections/payroll-tips.js';
import { buildTimeAttendanceScene, cleanupTimeAttendance } from './sections/time-attendance.js';
import { buildShiftConfigScene,    cleanupShiftConfig    } from './sections/shift-config.js';
import { buildTipoutRulesScene,    cleanupTipoutRules    } from './sections/tipout-rules.js';
import { buildHomeScene,           cleanupHome           } from './sections/home.js';
import { buildSalesReportsScene,  cleanupSalesReports   } from './sections/sales-reports.js';
import { buildStaffRolesScene,    cleanupStaffRoles     } from './sections/staff-roles.js';
import { buildPayrollAttendanceScene, cleanupPayrollAttendance } from './sections/payroll-attendance.js';
import { buildPricingSetupScene, cleanupPricingSetup } from './sections/pricing-setup.js';
import { buildModifierGroupsScene, cleanupModifierGroups } from './sections/modifier-groups.js';
import { buildModifiersScene, cleanupModifiers } from './sections/modifiers.js';
import mountTransactionLog, { unmount as unmountTransactionLog } from './sections/transaction-log.js';
import { buildKINDnosticStoreScene, cleanupKINDnosticStore } from './sections/kindnostic-store.js';
import { buildKINDnosticSettingsScene, cleanupKINDnosticSettings } from './sections/kindnostic-settings.js';
import { buildKINDnosticSurveyScene, cleanupKINDnosticSurvey } from './sections/kindnostic-survey.js';
import { buildKINDnosticInterpreterScene, cleanupKINDnosticInterpreter } from './sections/kindnostic-interpreter.js';

// Cookie-auth scaffolding (OVERSEER_AUTH §5.1, §5.2, §5.5). Distinct from
// `services/auth-client.js` which still handles the legacy Bearer/PIN flow
// for /api/* paths; the two coexist without interfering because the new
// endpoints live under /v1/* and don't trip the interceptor.
import { probeAuth, logout as authLogout } from './auth/auth_state.js';
import { renderLoginScene } from './auth/login_scene.js';
import { renderPasswordChangeScene } from './auth/password_change_scene.js';

/* ------------------------------------------
   NAVIGATION STRUCTURE
   Order: STORE → STAFF → REPORTING → MENU → HARDWARE & TERMINAL CONFIGURATION
   (HOME is pinned top separately by buildNav — not in this array.)
------------------------------------------ */
const NAV = [
    {
        id: 'store',
        label: 'STORE',
        subs: [
            { id: 'store-info',      label: 'Store Information' },
            { id: 'floor-plan',      label: 'Floor Plan'        },
            { id: 'order-settings',  label: 'Order Settings'    },
        ]
    },
    {
        id: 'staff',
        label: 'STAFF',
        subs: [
            // Post-Nostalgia structure: three mockup entries.
            // time-attendance / payroll-tips / tipout-rules / shift-config
            // stay registered below for deep-link compatibility but no
            // longer appear in the sidebar — their features now live
            // inside the Payroll & Attendance tabs.
            { id: 'employee-management', label: 'Staff List'         },
            { id: 'staff-roles',         label: 'Roles'              },
            { id: 'payroll-attendance',  label: 'Payroll & Attendance' },
        ]
    },
    {
        id: 'reporting',
        label: 'REPORTING',
        subs: [
            { id: 'transaction-log',  label: 'Transaction Log'  },
            { id: 'sales-reports',    label: 'Sales Reports'    },
            { id: 'labor-reports',    label: 'Labor Reports'    },
            { id: 'menu-performance', label: 'Menu Performance' },
        ]
    },
    {
        id: 'menu',
        label: 'MENU',
        subs: [
            { id: 'menu-categories',     label: 'Items'             },
            { id: 'modifiers',           label: 'Modifiers & Options' },
            { id: 'modifier-groups',     label: 'Groups'            },
            { id: 'pricing-setup',       label: 'Sizes'             },
            { id: 'pricing-specials',    label: 'Menu Pricing'       },
            { id: 'import-excel',        label: 'Import Menu'       },
        ]
    },
    {
        id: 'hardware',
        label: 'HARDWARE & NETWORK',
        subs: [
            { id: 'hardware-network', label: 'Hardware & Network' },
        ]
    },
    {
        id: 'kindnostic',
        label: 'KINDNOSTIC',
        subs: [
            { id: 'kindnostic-store',    label: 'Archive & Export'  },
            { id: 'kindnostic-settings', label: 'Configuration'     },
            { id: 'kindnostic-survey',   label: 'Survey'            },
            { id: 'kindnostic-interpreter', label: 'Interpreter'    },
        ]
    },
];

/* ------------------------------------------
   STATE
------------------------------------------ */
let _activeSection = null;
let _activeScene   = null;

/* ------------------------------------------
   SIDEBAR NAV BUILDER
------------------------------------------ */
const buildNav = () => {
    const container = document.getElementById('nav-sections');
    if (!container) return;
    container.innerHTML = '';

    // HOME pinned top (not in NAV array — it's a destination, not a group)
    const homeEl = document.createElement('div');
    homeEl.className = 'nav-section nav-home';
    homeEl.dataset.id = 'home';
    const homeBtn = document.createElement('div');
    homeBtn.className = 'nav-section-header nav-home-btn';
    homeBtn.textContent = 'HOME';
    homeBtn.addEventListener('click', () => navigateTo('home'));
    homeEl.appendChild(homeBtn);
    container.appendChild(homeEl);

    NAV.forEach(section => {
        const sectionEl = document.createElement('div');
        sectionEl.className = 'nav-section';
        sectionEl.dataset.id = section.id;

        const headerEl = document.createElement('div');
        headerEl.className = 'nav-section-header';
        headerEl.textContent = section.label;
        headerEl.addEventListener('click', () => toggleSection(section.id));
        sectionEl.appendChild(headerEl);

        const subsEl = document.createElement('div');
        subsEl.className = 'nav-section-subs';
        subsEl.dataset.sectionId = section.id;

        section.subs.forEach(sub => {
            const subEl = document.createElement('div');
            subEl.className = 'nav-sub-item';
            subEl.dataset.id = sub.id;
            subEl.textContent = sub.label;
            subEl.addEventListener('click', () => navigateTo(sub.id));
            subsEl.appendChild(subEl);
        });

        sectionEl.appendChild(subsEl);
        container.appendChild(sectionEl);
    });
}

const toggleSection = (sectionId) => {
    document.querySelectorAll('.nav-section-subs').forEach(el => {
        const isTarget = el.dataset.sectionId === sectionId;
        el.classList.toggle('open', isTarget && !el.classList.contains('open'));
    });
    document.querySelectorAll('.nav-section-header').forEach(el => {
        const section = el.closest('.nav-section');
        el.classList.toggle('active', section && section.dataset.id === sectionId);
    });
    _activeSection = sectionId;
}

const setActiveNavItem = (sceneId) => {
    document.querySelectorAll('.nav-sub-item').forEach(el => {
        el.classList.toggle('active', el.dataset.id === sceneId);
    });
    // Also track HOME active state
    const homeEl = document.querySelector('.nav-home .nav-home-btn');
    if (homeEl) homeEl.classList.toggle('active', sceneId === 'home');
}

/* ------------------------------------------
   NAVIGATION
------------------------------------------ */
const navigateTo = (sceneId) => {
    if (sceneId === _activeScene) return;
    const prev = _activeScene;
    _activeScene = sceneId;
    setActiveNavItem(sceneId);
    try {
        SceneManager.mountWorking(sceneId);
    } catch (e) {
        console.error('navigateTo: mount failed for "' + sceneId + '":', e);
        _activeScene = prev;
        setActiveNavItem(prev);
    }
}

/* ------------------------------------------
   NAV FOOTER BADGES
   Polls employees + menu item counts, updates footer counters,
   online dot, sync time. Runs every 60s from boot().
------------------------------------------ */
const refreshBadges = async () => {
    let allOk = true;
    try {
        const [menuRes, staffRes] = await Promise.all([
            fetch('/api/v1/menu/items'),
            fetch('/api/v1/staff'),
        ]);
        if (menuRes.ok) {
            const menu = await menuRes.json();
            const el = document.getElementById('nav-footer-items');
            if (el) el.textContent = menu.length ?? '--';
        } else { allOk = false; }

        if (staffRes.ok) {
            const staff = await staffRes.json();
            const el = document.getElementById('nav-footer-employees');
            if (el) el.textContent = staff.length ?? '--';
        } else { allOk = false; }

        // Terminals count — currently static (no endpoint), defaults to 1
        const termEl = document.getElementById('nav-footer-terminals');
        if (termEl) termEl.textContent = '1';

        const syncEl = document.getElementById('nav-footer-sync');
        if (syncEl) {
            const now = new Date();
            syncEl.textContent = `SYNC ${now.toLocaleTimeString([], {hour: '2-digit', minute: '2-digit', hour12: false})}`;
        }

        // Online indicator
        const dot = document.getElementById('nav-online-dot');
        if (dot) dot.classList.toggle('offline', !allOk);
    } catch (e) {
        console.warn('[Overseer] Badge refresh failed:', e);
        const dot = document.getElementById('nav-online-dot');
        if (dot) dot.classList.add('offline');
    }
}

const setVersionStamp = async () => {
    // Version is no longer rendered in the shell (header removed).
    // Kept as a no-op so boot() stays simple; reintroduce if needed
    // as a tooltip on the brand wordmark.
    try {
        await fetch('/api/v1/system/version');
    } catch {}
}

/* ------------------------------------------
   LEGACY REGISTRATION ADAPTER

   Sections use the old sm.register(name, config) format
   with { onEnter, onExit } callbacks.
   SceneManager v3 expects register({ name, mount, unmount }).
   This adapter bridges the two without modifying section files.
------------------------------------------ */
const createLegacyAdapter = (nameOverrides) => {
    return {
        register(name, config) {
            const resolvedName = (nameOverrides && nameOverrides[name]) || name;
            let activeContainer = null;
            SceneManager.register({
                name: resolvedName,
                mount(container, params) {
                    activeContainer = container;
                    if (config.onEnter) config.onEnter(container, params);
                },
                unmount() {
                    if (config.onExit && activeContainer) config.onExit(activeContainer);
                    activeContainer = null;
                },
            });
        }
    };
}

/* ------------------------------------------
   SECTION REGISTRATION
------------------------------------------ */
const registerAllSections = () => {
    const adapter = createLegacyAdapter();

    // Register-pattern sections (use adapter to bridge old format)
    registerMenuImport(adapter);
    registerEmployeeSections(adapter);
    registerMenuCategories(adapter);
    registerConfigureModifiers(adapter);
    registerPricingSpecials(adapter);
    registerPrinterConfig(adapter);

    // printer-setup.js registers as 'printer-config' in source — remap to
    // 'printer-setup' so it doesn't overwrite the real printer-config scene
    registerPrinterSetup(createLegacyAdapter({ 'printer-config': 'printer-setup' }));

    // Build-pattern sections (already use correct format)
    SceneManager.register({
        name: 'payroll-tips',
        mount: (container) => buildPayrollTipsScene(container),
        unmount: () => cleanupPayrollTips(),
    });
    SceneManager.register({
        name: 'time-attendance',
        mount: (container) => buildTimeAttendanceScene(container),
        unmount: () => cleanupTimeAttendance(),
    });
    SceneManager.register({
        name: 'shift-config',
        mount: (container) => buildShiftConfigScene(container),
        unmount: () => cleanupShiftConfig(),
    });
    SceneManager.register({
        name: 'tipout-rules',
        mount: (container) => buildTipoutRulesScene(container),
        unmount: () => cleanupTipoutRules(),
    });
    SceneManager.register({
        name: 'home',
        mount: (container) => buildHomeScene(container),
        unmount: () => cleanupHome(),
    });
    SceneManager.register({
        name: 'sales-reports',
        mount: (container) => buildSalesReportsScene(container),
        unmount: () => cleanupSalesReports(),
    });
    SceneManager.register({
        name: 'staff-roles',
        mount: (container) => buildStaffRolesScene(container),
        unmount: (container) => cleanupStaffRoles(container),
    });
    SceneManager.register({
        name: 'payroll-attendance',
        mount: (container) => buildPayrollAttendanceScene(container),
        unmount: (container) => cleanupPayrollAttendance(container),
    });
    SceneManager.register({
        name: 'store-info',
        mount: (container) => buildStoreInfoScene(container),
        unmount: (container) => cleanupStoreInfo(container),
    });
    SceneManager.register({
        name: 'order-settings',
        mount: (container) => buildOrderSettingsScene(container),
        unmount: (container) => cleanupOrderSettings(container),
    });
    SceneManager.register({
        name: 'network-setup',
        mount: (container) => buildNetworkSetupScene(container),
        unmount: (container) => cleanupNetworkSetup(container),
    });
    SceneManager.register({
        name: 'terminal-details',
        mount: (container, params) => buildTerminalDetailsScene(container, params),
        unmount: (container) => cleanupTerminalDetailsScene(container),
    });
    SceneManager.register({
        name: 'hardware-network',
        mount: (container) => buildHardwareNetworkScene(container),
        unmount: (container) => cleanupHardwareNetwork(container),
    });
    SceneManager.register({
        name: 'hardware-management',
        mount: (container) => buildHardwareScene(container),
        unmount: (container) => cleanupHardware(),
    });
    SceneManager.register({
        name: 'card-readers',
        mount: (container) => buildCardReadersScene(container),
        unmount: (container) => cleanupCardReaders(container),
    });
    SceneManager.register({
        name: 'receipt-settings',
        mount: (container) => buildReceiptSettingsScene(container),
        unmount: (container) => cleanupReceiptSettings(container),
    });
    SceneManager.register({
        name: 'terminal-settings',
        mount: (container) => buildTerminalSettingsScene(container),
        unmount: (container) => cleanupTerminalSettings(container),
    });
    SceneManager.register({
        name: 'labor-reports',
        mount: (container) => buildLaborReportsScene(container),
        unmount: (container) => cleanupLaborReports(container),
    });
    SceneManager.register({
        name: 'menu-performance',
        mount: (container) => buildMenuPerformanceScene(container),
        unmount: (container) => cleanupMenuPerformance(container),
    });
    SceneManager.register({
        name: 'floor-plan',
        mount: (container) => buildFloorPlanScene(container),
        unmount: (container) => cleanupFloorPlan(container),
    });
    SceneManager.register({
        name: 'pricing-setup',
        mount: (container) => buildPricingSetupScene(container),
        unmount: (container) => cleanupPricingSetup(container),
    });
    // modifier-groups: registered above by the legacy configure-modifiers
    // adapter; this re-registration replaces it with the two-panel rebuild.
    SceneManager.register({
        name: 'modifier-groups',
        mount: (container) => buildModifierGroupsScene(container),
        unmount: (container) => cleanupModifierGroups(container),
    });
    SceneManager.register({
        name: 'modifiers',
        mount: (container) => buildModifiersScene(container),
        unmount: (container) => cleanupModifiers(container),
    });
    SceneManager.register({
        name: 'transaction-log',
        mount: (container) => mountTransactionLog(container),
        unmount: () => unmountTransactionLog(),
    });
    SceneManager.register({
        name: 'kindnostic-store',
        mount: (container) => buildKINDnosticStoreScene(container),
        unmount: (container) => cleanupKINDnosticStore(container),
    });
    SceneManager.register({
        name: 'kindnostic-settings',
        mount: (container) => buildKINDnosticSettingsScene(container),
        unmount: (container) => cleanupKINDnosticSettings(container),
    });
    SceneManager.register({
        name: 'kindnostic-survey',
        mount: (container) => buildKINDnosticSurveyScene(container),
        unmount: (container) => cleanupKINDnosticSurvey(container),
    });
    SceneManager.register({
        name: 'kindnostic-interpreter',
        mount: (container) => buildKINDnosticInterpreterScene(container),
        unmount: (container) => cleanupKINDnosticInterpreter(container),
    });
}

/* ------------------------------------------
   BOOT
------------------------------------------ */

// Initials from a user's email — left of '@', up to two characters.
const _initialsForEmail = (email) => {
    if (!email) return '··';
    const local = String(email).split('@')[0] || '';
    const tokens = local.split(/[._-]+/).filter(Boolean);
    if (tokens.length >= 2) return (tokens[0][0] + tokens[1][0]).toUpperCase();
    return local.slice(0, 2).toUpperCase() || '··';
};

const _wireFooterUser = (user) => {
    const avatarEl = document.getElementById('nav-footer-avatar');
    if (avatarEl) avatarEl.textContent = _initialsForEmail(user.email);

    const userEl = document.getElementById('nav-footer-user');
    if (!userEl) return;
    userEl.innerHTML = '';
    const label = document.createElement('span');
    label.textContent = user.email + ' · ';
    userEl.appendChild(label);
    const out = document.createElement('a');
    out.textContent = 'sign out';
    out.href = '#';
    out.style.color = 'inherit';
    out.style.textDecoration = 'underline';
    out.style.cursor = 'pointer';
    out.dataset.role = 'logout-link';
    out.addEventListener('click', async (e) => {
        e.preventDefault();
        await authLogout();
        // Simplest "re-run the bootstrap path" — a full reload re-fires
        // DOMContentLoaded → boot → probeAuth → login screen.
        window.location.reload();
    });
    userEl.appendChild(out);
};

// Run the existing Overseer initialization. Split out of boot() so we can
// call it both on a fresh probeAuth() hit and after a successful login.
const _initOverseerUI = async (user) => {
    // Forced password-change gate (OVERSEER_AUTH §2 must_change_password,
    // §5.3 password-change endpoint). New installs ship with a temporary
    // password and the flag set; we cannot proceed to the Overseer chrome
    // until the rotation completes. After a successful change the in-memory
    // user is stale, so the callback re-probes /v1/auth/me to get a
    // refreshed object (with the flag cleared) before recursing.
    //
    // Recursion is bounded — the recursive call always carries the
    // refreshed user with must_change_password=false, so the full init
    // body below runs exactly once per boot.
    if (user && user.must_change_password === true) {
        const gate = document.getElementById('gate-layer');
        if (gate) {
            renderPasswordChangeScene(gate, async () => {
                gate.innerHTML = '';
                gate.style.display = 'none';
                const fresh = await probeAuth();
                if (fresh) {
                    await _initOverseerUI(fresh);
                } else {
                    // The session evaporated between change and probe
                    // (e.g. server revoked, network died). Reload to
                    // land on the login screen cleanly.
                    window.location.reload();
                }
            });
            return;
        }
        // gate-layer missing — fall through to normal init rather than
        // hard-blocking. Subsequent admin operations will still 401 against
        // the server side until the password is rotated elsewhere.
    }

    SceneManager.init({
        layers: {
            working:       document.getElementById('working-layer'),
            transactional: document.getElementById('transactional-layer'),
            interrupt:     document.getElementById('interrupt-layer'),
            gate:          document.getElementById('gate-layer'),
        }
    });
    await initThemeBridge();
    await loadEmployeeData();
    await Promise.all([loadReportData(), loadTimeData(), loadPayrollData(), loadShiftData()]);
    buildNav();
    registerAllSections();

    await refreshBadges();
    await setVersionStamp();

    _wireFooterUser(user);

    // Boot into HOME by default
    navigateTo('home');

    setInterval(refreshBadges, 60_000);
};

const boot = async () => {
    console.log('[Overseer] Booting...');

    let user = null;
    try {
        user = await probeAuth();
    } catch (e) {
        // Server unreachable or 5xx — fall through to the login screen
        // so the operator at least gets a clear error path instead of
        // a blank Overseer.
        console.error('[Overseer] auth probe failed:', e);
        user = null;
    }

    if (user) {
        await _initOverseerUI(user);
        console.log('[Overseer] Boot complete (authenticated).');
        return;
    }

    const gate = document.getElementById('gate-layer');
    if (!gate) {
        console.error('[Overseer] gate-layer not found — cannot render login');
        return;
    }
    renderLoginScene(gate, async (loggedInUser) => {
        // Tear the gate down before mounting the Overseer underneath.
        gate.innerHTML = '';
        gate.style.display = 'none';
        await _initOverseerUI(loggedInUser);
        console.log('[Overseer] Boot complete (post-login).');
    });
    console.log('[Overseer] Awaiting login.');
}

window._overseerNav = navigateTo;
document.addEventListener('DOMContentLoaded', boot);