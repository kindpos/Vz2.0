/* ============================================
   KINDpos Overseer — Boot Sequence
   Nice. Dependable. Yours.
   ============================================ */

import { SceneManager }              from './components/scene-manager.js';
import { T }                          from './components/tokens.js';
import {
    initThemeBridge,
    THEME_SLOTS,
    DEFAULT_SLOTS,
    expandOverrides,
    listCustomThemes,
    getActiveThemeId,
    getCustomTheme,
    saveCustomTheme,
    deleteCustomTheme,
    setActiveTheme,
    newThemeId,
    syncThemesFromServer,
}                                      from './theme-bridge.js';
import { loadEmployeeData }           from './data/sample-employees.js';
import { loadReportData }             from './data/sample-reports.js';
import { loadTimeData }               from './data/sample-timedata.js';
import { loadPayrollData }            from './data/sample-payroll.js';
import { loadShiftData }              from './data/sample-shifts.js';

import { registerSalesReports }       from './sections/reporting.js';
import { registerMenuImport }         from './sections/menu-import.js';
import { registerEmployeeSections }   from './sections/employees.js';
import { registerSystemTesting }      from './sections/system-testing.js';
import { registerMenuCategories }     from './sections/menu-categories.js';
import { registerConfigureModifiers } from './sections/configure-modifiers.js';
import { registerPricingSpecials }    from './sections/pricing-specials.js';
import { registerPrinterConfig }      from './sections/printer-config.js';
import { registerPrinterSetup }       from './sections/printer-setup.js';

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
import { buildStaffRolesScene,    cleanupStaffRoles     } from './sections/staff-roles.js';
import { buildPayrollAttendanceScene, cleanupPayrollAttendance } from './sections/payroll-attendance.js';

/* ------------------------------------------
   NAVIGATION STRUCTURE
   Order: STORE → STAFF → REPORTING → MENU → HARDWARE → SYSTEM
   (HOME is pinned top separately by buildNav — not in this array.)

   Sub-items are intentionally unchanged in this pass — consolidation
   (Payroll & Attendance merge, Printers merge, etc.) happens when
   each section is reskinned individually.
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
            { id: 'sales-reports',    label: 'Sales Reports'    },
            { id: 'labor-reports',    label: 'Labor Reports'    },
            { id: 'menu-performance', label: 'Menu Performance' },
        ]
    },
    {
        id: 'menu',
        label: 'MENU',
        subs: [
            { id: 'menu-categories',     label: 'Categories'        },
            { id: 'modifier-groups',      label: 'Modifiers'         },
            { id: 'pricing-specials',    label: 'Discounts & Specials' },
            { id: 'import-excel',        label: 'Import Menu'       },
        ]
    },
    {
        id: 'hardware',
        label: 'HARDWARE',
        subs: [
            { id: 'printer-setup',    label: 'Printer Setup'    },
            { id: 'printer-config',   label: 'Printer Config'   },
            { id: 'card-readers',     label: 'Card Readers'     },
            { id: 'receipt-settings', label: 'Receipt Settings'  },
        ]
    },
    {
        id: 'system',
        label: 'SYSTEM',
        subs: [
            { id: 'system-testing',     label: 'System Testing'    },
            { id: 'terminal-settings',  label: 'Terminal Settings'  },
            { id: 'system-appearance',  label: 'Appearance'         },
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
function buildNav() {
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

function toggleSection(sectionId) {
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

function setActiveNavItem(sceneId) {
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
function navigateTo(sceneId) {
    if (sceneId === _activeScene) return;
    _activeScene = sceneId;
    setActiveNavItem(sceneId);
    SceneManager.mountWorking(sceneId);
}

/* ------------------------------------------
   NAV FOOTER BADGES
   Polls employees + menu item counts, updates footer counters,
   online dot, sync time. Runs every 60s from boot().
------------------------------------------ */
async function refreshBadges() {
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

async function setVersionStamp() {
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
function createLegacyAdapter(nameOverrides) {
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
function registerAllSections() {
    const adapter = createLegacyAdapter();

    // Register-pattern sections (use adapter to bridge old format)
    registerSalesReports(adapter);
    registerMenuImport(adapter);
    registerEmployeeSections(adapter);
    registerSystemTesting(adapter);
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

    registerSystemAppearance();
}

/* ------------------------------------------
   SYSTEM APPEARANCE (theme picker scene)
------------------------------------------ */
function registerSystemAppearance() {
    SceneManager.register({
        name: 'system-appearance',
        mount(container) { mountThemePicker(container); },
        unmount() {},
    });
}

/* ------------------------------------------
   THEME EDITOR SCENE
   Library of saved custom themes + editor with
   live preview of the terminal surface.
------------------------------------------ */
function mountThemePicker(container) {
    const state = {
        editingId: null,      // null = no editor open; otherwise a theme id
        draft: null,          // { id, label, slots }
    };

    const wrapper = document.createElement('div');
    wrapper.style.cssText = 'max-width:1100px;margin:0 auto;padding:30px 24px;';
    wrapper.innerHTML = `
        <div style="font-family:var(--font-heading);font-size:44px;color:var(--color-gold);margin-bottom:4px;">
            Appearance
        </div>
        <div style="font-size:20px;color:rgba(var(--color-mint-rgb),0.4);margin-bottom:24px;">
            Build and save your own terminal themes.
        </div>
        <div id="theme-library" style="display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin-bottom:24px;"></div>
        <div id="theme-editor"></div>
    `;
    container.appendChild(wrapper);

    const libEl = wrapper.querySelector('#theme-library');
    const editorEl = wrapper.querySelector('#theme-editor');

    function render() {
        renderLibrary(libEl, state, render);
        renderEditor(editorEl, state, render);
    }
    render();

    // Pull the authoritative theme list from the server so the library
    // shows themes saved on other devices. Re-render once it resolves.
    syncThemesFromServer().then(() => render());
}

function renderLibrary(libEl, state, render) {
    libEl.innerHTML = '';
    const activeId = getActiveThemeId();
    const saved = listCustomThemes();

    const entries = [
        { id: 'terminal-glow', label: 'Terminal Glow', builtin: true },
        ...saved,
    ];

    entries.forEach(entry => {
        libEl.appendChild(buildLibraryCard(entry, activeId, state, render));
    });

    // "New theme" action card
    const add = document.createElement('button');
    add.style.cssText = `
        display:flex;flex-direction:column;align-items:center;justify-content:center;gap:6px;
        padding:18px;background:rgba(var(--color-mint-rgb),0.04);
        border:2px dashed rgba(var(--color-mint-rgb),0.3);
        border-radius:6px;cursor:pointer;
        font-family:var(--font-body);color:var(--color-mint);
        min-height:110px;
    `;
    add.innerHTML = `
        <span style="font-size:28px;font-family:var(--font-heading);color:var(--color-gold);">+ New theme</span>
        <span style="font-size:13px;color:rgba(var(--color-mint-rgb),0.4);text-transform:uppercase;letter-spacing:1px;">Start from defaults</span>
    `;
    add.addEventListener('click', () => {
        const id = newThemeId();
        state.editingId = id;
        state.draft = {
            id,
            label: 'Untitled theme',
            slots: { ...DEFAULT_SLOTS },
            isNew: true,
        };
        render();
    });
    libEl.appendChild(add);
}

function buildLibraryCard(entry, activeId, state, render) {
    const isActive = entry.id === activeId;
    const isEditing = entry.id === state.editingId;
    const slots = entry.builtin ? DEFAULT_SLOTS : (entry.slots || DEFAULT_SLOTS);

    const card = document.createElement('div');
    card.style.cssText = `
        display:flex;flex-direction:column;gap:8px;padding:14px;
        background:${isActive ? 'rgba(var(--color-mint-rgb),0.12)' : 'rgba(var(--color-mint-rgb),0.04)'};
        border:2px solid ${isEditing ? 'var(--color-gold)' : isActive ? 'var(--color-mint)' : 'rgba(var(--color-mint-rgb),0.1)'};
        border-radius:6px;font-family:var(--font-body);color:var(--color-mint);
    `;

    // Swatch row
    const swatches = document.createElement('div');
    swatches.style.cssText = 'display:flex;gap:4px;';
    ['bg', 'numpadChassis', 'gold', 'mint', 'textPrimary'].forEach(k => {
        const s = document.createElement('div');
        s.style.cssText = `width:22px;height:22px;border-radius:3px;background:${slots[k] || DEFAULT_SLOTS[k]};border:1px solid rgba(0,0,0,0.4);`;
        swatches.appendChild(s);
    });
    card.appendChild(swatches);

    const title = document.createElement('div');
    title.style.cssText = 'font-size:20px;font-family:var(--font-heading);color:var(--color-gold);';
    title.textContent = entry.label;
    card.appendChild(title);

    const status = document.createElement('div');
    status.style.cssText = 'font-size:12px;color:rgba(var(--color-mint-rgb),0.5);text-transform:uppercase;letter-spacing:1px;';
    status.textContent = isActive ? 'Active' : (entry.builtin ? 'Built-in default' : 'Saved');
    card.appendChild(status);

    // Action row
    const actions = document.createElement('div');
    actions.style.cssText = 'display:flex;gap:6px;margin-top:4px;';
    actions.appendChild(buildMiniButton('Apply', isActive, async () => {
        try { await setActiveTheme(entry.id); }
        catch (e) { alert('Could not apply theme: ' + e.message); return; }
        render();
    }));
    if (!entry.builtin) {
        actions.appendChild(buildMiniButton('Edit', false, () => {
            state.editingId = entry.id;
            state.draft = {
                id: entry.id,
                label: entry.label,
                slots: { ...DEFAULT_SLOTS, ...entry.slots },
                isNew: false,
            };
            render();
        }));
        actions.appendChild(buildMiniButton('Delete', false, async () => {
            if (!confirm(`Delete theme "${entry.label}"?`)) return;
            try { await deleteCustomTheme(entry.id); }
            catch (e) { alert('Could not delete theme: ' + e.message); return; }
            if (state.editingId === entry.id) { state.editingId = null; state.draft = null; }
            render();
        }, true));
    }
    card.appendChild(actions);

    return card;
}

function buildMiniButton(label, active, onClick, destructive) {
    const btn = document.createElement('button');
    const border = destructive ? 'var(--color-vermillion)' : (active ? 'var(--color-gold)' : 'rgba(var(--color-mint-rgb),0.3)');
    const fg = destructive ? 'var(--color-vermillion)' : (active ? 'var(--color-gold)' : 'var(--color-mint)');
    btn.style.cssText = `
        flex:1;padding:6px 10px;background:transparent;border:1px solid ${border};
        color:${fg};font-family:var(--font-body);font-size:13px;
        text-transform:uppercase;letter-spacing:1px;border-radius:3px;cursor:pointer;
    `;
    btn.textContent = label;
    btn.addEventListener('click', onClick);
    return btn;
}

function renderEditor(editorEl, state, render) {
    editorEl.innerHTML = '';
    if (!state.editingId || !state.draft) {
        const hint = document.createElement('div');
        hint.style.cssText = 'padding:16px;color:rgba(var(--color-mint-rgb),0.4);font-family:var(--font-body);font-size:15px;';
        hint.textContent = 'Select a saved theme to edit or create a new one.';
        editorEl.appendChild(hint);
        return;
    }

    const layout = document.createElement('div');
    layout.style.cssText = 'display:grid;grid-template-columns:1fr 1fr;gap:24px;';

    layout.appendChild(buildEditorControls(state, render));
    layout.appendChild(buildPreview(state.draft.slots));

    editorEl.appendChild(layout);

    // Save / cancel row (full width)
    const actions = document.createElement('div');
    actions.style.cssText = 'display:flex;gap:12px;justify-content:flex-end;margin-top:16px;';

    const cancel = document.createElement('button');
    cancel.textContent = state.draft.isNew ? 'Discard' : 'Cancel';
    cancel.style.cssText = `
        padding:10px 20px;background:transparent;border:1px solid rgba(var(--color-mint-rgb),0.3);
        color:var(--color-mint);font-family:var(--font-body);font-size:14px;text-transform:uppercase;
        letter-spacing:1.5px;border-radius:3px;cursor:pointer;
    `;
    cancel.addEventListener('click', () => {
        state.editingId = null;
        state.draft = null;
        render();
    });

    const save = document.createElement('button');
    save.textContent = 'Save theme';
    save.style.cssText = `
        padding:10px 20px;background:var(--color-gold);border:1px solid var(--color-gold);
        color:#1a1a1a;font-family:var(--font-body);font-size:14px;font-weight:bold;
        text-transform:uppercase;letter-spacing:1.5px;border-radius:3px;cursor:pointer;
    `;
    save.addEventListener('click', async () => {
        const label = (state.draft.label || '').trim() || 'Untitled theme';
        save.disabled = true;
        const prev = save.textContent;
        save.textContent = 'Saving...';
        try {
            await saveCustomTheme({
                id: state.draft.id,
                label,
                slots: state.draft.slots,
            });
        } catch (e) {
            save.disabled = false;
            save.textContent = prev;
            alert('Could not save theme: ' + e.message);
            return;
        }
        state.editingId = null;
        state.draft = null;
        render();
    });

    actions.appendChild(cancel);
    actions.appendChild(save);
    editorEl.appendChild(actions);
}

function buildEditorControls(state, render) {
    const col = document.createElement('div');
    col.style.cssText = 'display:flex;flex-direction:column;gap:16px;';

    // Name field
    const nameLabel = document.createElement('div');
    nameLabel.style.cssText = 'font-size:12px;color:rgba(var(--color-mint-rgb),0.5);text-transform:uppercase;letter-spacing:1.5px;';
    nameLabel.textContent = 'Theme name';
    col.appendChild(nameLabel);

    const nameInput = document.createElement('input');
    nameInput.type = 'text';
    nameInput.value = state.draft.label;
    nameInput.style.cssText = `
        padding:10px 12px;background:var(--color-bg-dark);
        border:1px solid rgba(var(--color-mint-rgb),0.2);color:var(--color-mint);
        font-family:var(--font-body);font-size:16px;border-radius:3px;
    `;
    nameInput.addEventListener('input', (e) => { state.draft.label = e.target.value; });
    col.appendChild(nameInput);

    // Group slots by their `group` attribute
    const groups = {};
    THEME_SLOTS.forEach(slot => {
        (groups[slot.group] = groups[slot.group] || []).push(slot);
    });

    Object.keys(groups).forEach(groupName => {
        const header = document.createElement('div');
        header.style.cssText = 'font-size:13px;color:var(--color-gold);text-transform:uppercase;letter-spacing:2px;margin-top:4px;';
        header.textContent = groupName;
        col.appendChild(header);

        groups[groupName].forEach(slot => {
            col.appendChild(buildSlotRow(slot, state, render));
        });
    });

    return col;
}

function buildSlotRow(slot, state, render) {
    const row = document.createElement('div');
    row.dataset.themeSlot = slot.key;
    row.style.cssText = 'display:flex;align-items:center;gap:12px;padding:6px 8px;border-radius:4px;transition:background 0.12s ease;';
    row.addEventListener('mouseenter', () => highlightSlot(slot.key, true, row));
    row.addEventListener('mouseleave', () => highlightSlot(slot.key, false, row));

    const color = document.createElement('input');
    color.type = 'color';
    color.value = state.draft.slots[slot.key] || DEFAULT_SLOTS[slot.key];
    color.style.cssText = 'width:44px;height:32px;border:none;background:transparent;cursor:pointer;padding:0;';

    const hex = document.createElement('input');
    hex.type = 'text';
    hex.value = color.value;
    hex.maxLength = 7;
    hex.style.cssText = `
        width:90px;padding:6px 8px;background:var(--color-bg-dark);
        border:1px solid rgba(var(--color-mint-rgb),0.15);color:var(--color-mint);
        font-family:var(--font-mono);font-size:13px;border-radius:3px;
    `;

    color.addEventListener('input', (e) => {
        state.draft.slots[slot.key] = e.target.value;
        hex.value = e.target.value;
        refreshPreview(state.draft.slots);
    });
    hex.addEventListener('input', (e) => {
        const v = e.target.value.trim();
        if (/^#[0-9a-fA-F]{6}$/.test(v)) {
            color.value = v;
            state.draft.slots[slot.key] = v;
            refreshPreview(state.draft.slots);
        }
    });

    const text = document.createElement('div');
    text.style.cssText = 'flex:1;display:flex;flex-direction:column;';
    text.innerHTML = `
        <div style="font-size:15px;color:var(--color-mint);font-family:var(--font-body);">${slot.label}</div>
        <div style="font-size:12px;color:rgba(var(--color-mint-rgb),0.4);">${slot.hint}</div>
    `;

    row.appendChild(color);
    row.appendChild(hex);
    row.appendChild(text);
    return row;
}

function refreshPreview(slots) {
    const old = document.querySelector('#theme-preview-pane');
    if (!old) return;
    const fresh = buildPreview(slots);
    old.parentElement.replaceChild(fresh, old);
}

// Hover a slot row → pulse every preview element tagged with that slot.
// Also glow the slot row itself so the connection reads in both directions.
function highlightSlot(key, on, rowEl) {
    const pane = document.querySelector('#theme-preview-pane');
    if (!pane) return;
    const targets = pane.querySelectorAll(`[data-theme-slot="${key}"]`);
    targets.forEach(el => {
        if (on) {
            el._prevOutline = el.style.outline;
            el._prevOffset  = el.style.outlineOffset;
            el.style.outline = '2px dashed var(--color-gold)';
            el.style.outlineOffset = '2px';
        } else {
            el.style.outline       = el._prevOutline || '';
            el.style.outlineOffset = el._prevOffset  || '';
        }
    });
    if (rowEl) {
        rowEl.style.background = on ? 'rgba(var(--color-gold-rgb),0.08)' : '';
    }
}

function tag(el, slot) {
    el.dataset.themeSlot = slot;
    return el;
}

function buildPreview(slots) {
    const full = expandOverrides(slots);

    const pane = document.createElement('div');
    pane.id = 'theme-preview-pane';
    pane.style.cssText = 'position:sticky;top:20px;';

    const label = document.createElement('div');
    label.style.cssText = 'font-size:13px;color:var(--color-gold);text-transform:uppercase;letter-spacing:2px;margin-bottom:8px;';
    label.textContent = 'Preview — hover a slot on the left to highlight';
    pane.appendChild(label);

    const scene = tag(document.createElement('div'), 'bg');
    scene.id = 'theme-preview-inner';
    scene.style.cssText = `
        background:${full.bg};padding:0;border-radius:4px;
        min-height:360px;font-family:var(--font-body);overflow:hidden;
    `;

    // Shell header strip (mirrors the terminal's #header)
    const shellHeader = tag(document.createElement('div'), 'headerBg');
    shellHeader.style.cssText = `
        display:flex;justify-content:space-between;align-items:center;
        background:${full.headerBg};padding:6px 12px;
        border-top:4px solid ${full.headerBgL};border-left:4px solid ${full.headerBgL};
        border-bottom:4px solid ${full.headerBgD};border-right:4px solid ${full.headerBgD};
    `;
    const shellTime = tag(document.createElement('span'), 'headerText');
    shellTime.style.cssText = `color:${full.headerText};font-family:var(--font-mono);font-size:14px;`;
    shellTime.textContent = '04/17/26 || 5:04pm // NEW ORDER';
    shellHeader.appendChild(shellTime);
    scene.appendChild(shellHeader);

    const body = document.createElement('div');
    body.style.cssText = 'padding:18px;';

    // Sub-header row inside scene
    const header = document.createElement('div');
    header.style.cssText = 'display:flex;justify-content:space-between;align-items:baseline;margin-bottom:14px;';
    const orderLabel = tag(document.createElement('span'), 'gold');
    orderLabel.style.cssText = `color:${full.gold};font-family:var(--font-heading);font-size:22px;`;
    orderLabel.textContent = 'Order #1042';
    const tableLabel = tag(document.createElement('span'), 'mutedText');
    tableLabel.style.cssText = `color:${full.mutedText};font-size:13px;`;
    tableLabel.textContent = 'Table 7 · 9:42 PM';
    header.appendChild(orderLabel);
    header.appendChild(tableLabel);
    body.appendChild(header);

    // Beveled card with its own header strip
    const cardWrap = tag(document.createElement('div'), 'numpadChassis');
    cardWrap.style.cssText = `
        background:${full.bgDark};
        border-top:7px solid ${full.numpadChassisL};
        border-left:7px solid ${full.numpadChassisL};
        border-bottom:7px solid ${full.numpadChassisD};
        border-right:7px solid ${full.numpadChassisD};
        clip-path:polygon(10px 0%, calc(100% - 10px) 0%, 100% 10px, 100% calc(100% - 10px), calc(100% - 10px) 100%, 10px 100%, 0% calc(100% - 10px), 0% 10px);
    `;

    // Card header strip (mirrors buildCardHeader)
    const cardHeader = tag(document.createElement('div'), 'headerBg');
    cardHeader.style.cssText = `background:${full.headerBg};padding:5px 12px;`;
    const cardHeaderText = tag(document.createElement('div'), 'headerText');
    cardHeaderText.style.cssText = `color:${full.headerText};font-family:var(--font-heading);font-size:14px;letter-spacing:1.5px;`;
    cardHeaderText.textContent = 'ORDER RECAP';
    cardHeader.appendChild(cardHeaderText);
    cardWrap.appendChild(cardHeader);

    const cardBody = document.createElement('div');
    cardBody.style.cssText = 'padding:14px 16px;';

    const title = tag(document.createElement('div'), 'textPrimary');
    title.style.cssText = `color:${full.textPrimary};font-size:22px;font-family:var(--font-heading);margin-bottom:2px;`;
    title.textContent = 'Margherita Pizza';
    cardBody.appendChild(title);

    const sub = tag(document.createElement('div'), 'textSecondary');
    sub.style.cssText = `color:${full.textSecondary};font-size:14px;margin-bottom:14px;`;
    sub.textContent = 'Large · Extra basil · No garlic';
    cardBody.appendChild(sub);

    const lineRow = (l, r, fg, slot) => {
        const d = tag(document.createElement('div'), slot);
        d.style.cssText = `display:flex;justify-content:space-between;padding:4px 0;font-size:15px;color:${fg};`;
        d.innerHTML = `<span>${l}</span><span>${r}</span>`;
        return d;
    };
    cardBody.appendChild(lineRow('Subtotal', '$18.00', full.textPrimary, 'textPrimary'));
    cardBody.appendChild(lineRow('Tax',      '$1.48',  full.mutedText,   'mutedText'));
    const totalRow = lineRow('Total', '$19.48', full.goGreen, 'goGreen');
    totalRow.style.cssText += 'font-family:var(--font-heading);font-size:20px;margin-top:6px;';
    cardBody.appendChild(totalRow);

    const warn = tag(document.createElement('div'), 'red');
    warn.style.cssText = `color:${full.red};font-size:13px;margin-top:10px;text-transform:uppercase;letter-spacing:1px;`;
    warn.textContent = '⚠ Void requires manager';
    cardBody.appendChild(warn);

    cardWrap.appendChild(cardBody);
    body.appendChild(cardWrap);

    // Accent swatches
    const accents = document.createElement('div');
    accents.style.cssText = 'display:flex;gap:8px;margin-top:14px;';
    [
        { c: full.mint, lbl: 'Main',      slot: 'mint' },
        { c: full.cyan, lbl: 'Secondary', slot: 'cyan' },
        { c: full.gold, lbl: 'Highlight', slot: 'gold' },
    ].forEach(a => {
        const chip = tag(document.createElement('div'), a.slot);
        chip.style.cssText = `
            flex:1;padding:8px 10px;background:${a.c};color:${full.bg};
            font-family:var(--font-heading);font-size:13px;text-align:center;
            text-transform:uppercase;letter-spacing:1.5px;border-radius:3px;
        `;
        chip.textContent = a.lbl;
        accents.appendChild(chip);
    });
    body.appendChild(accents);

    // Mini numpad mock — 5 keys, just enough to preview the colors.
    const padWrap = tag(document.createElement('div'), 'numpadChassis');
    padWrap.style.cssText = `
        display:grid;grid-template-columns:repeat(3,1fr);gap:6px;margin-top:14px;
        padding:8px;background:${full.numpadChassis};
        border-top:4px solid ${full.numpadChassisL};border-left:4px solid ${full.numpadChassisL};
        border-bottom:4px solid ${full.numpadChassisD};border-right:4px solid ${full.numpadChassisD};
    `;
    const mkKey = (label, color, slot) => {
        const k = tag(document.createElement('div'), slot);
        k.style.cssText = `
            background:${full.numpadKeyFace};
            border-top:3px solid ${full.numpadKeyFaceL};border-left:3px solid ${full.numpadKeyFaceL};
            border-bottom:3px solid ${full.numpadKeyFaceD};border-right:3px solid ${full.numpadKeyFaceD};
            color:${color};font-family:var(--font-mono);font-size:22px;
            display:flex;align-items:center;justify-content:center;padding:6px 0;
        `;
        k.textContent = label;
        return k;
    };
    padWrap.appendChild(mkKey('1',   full.numpadDigit, 'numpadDigit'));
    padWrap.appendChild(mkKey('2',   full.numpadDigit, 'numpadDigit'));
    padWrap.appendChild(mkKey('3',   full.numpadDigit, 'numpadDigit'));
    padWrap.appendChild(mkKey('clr', full.red,         'red'));
    padWrap.appendChild(mkKey('0',   full.numpadDigit, 'numpadKeyFace'));
    padWrap.appendChild(mkKey('>>>', full.goGreen,     'goGreen'));
    body.appendChild(padWrap);

    scene.appendChild(body);
    pane.appendChild(scene);

    // Active-theme note
    const note = document.createElement('div');
    note.style.cssText = 'margin-top:10px;font-size:12px;color:rgba(var(--color-mint-rgb),0.4);';
    note.textContent = 'Preview reflects the terminal surface. Save and apply to push it live.';
    pane.appendChild(note);

    return pane;
}

/* ------------------------------------------
   BOOT
------------------------------------------ */
async function boot() {
    console.log('[Overseer] Booting...');

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

    // Populate avatar placeholder (until login ships, this is just a marker)
    const avatarEl = document.getElementById('nav-footer-avatar');
    if (avatarEl) avatarEl.textContent = 'AK';
    const userEl = document.getElementById('nav-footer-user');
    if (userEl) userEl.textContent = 'Alex K. · sign out';

    // Boot into HOME by default
    navigateTo('home');

    setInterval(refreshBadges, 60_000);
    console.log('[Overseer] Boot complete.');
}

window._overseerNav = navigateTo;
document.addEventListener('DOMContentLoaded', boot);