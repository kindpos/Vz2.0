/* ============================================
   KINDpos Overseer — Payroll & Attendance (Nostalgia)

   Merges the four legacy Staff subsections into one tabbed scene:
     - Clock Records    (was time-attendance)
     - Payroll Periods  (was payroll-tips)
     - Tipout Rules     (was tipout-rules)
     - Shift Templates  (was the templates view in shift-config)

   Design target: the Payroll & Attendance mockup. Reads from
   ui/tokens.js + ui/forms.js only — no local palette, no Vz1.x
   CSS vars.

   Tabs keep their individual save semantics:
     - Clock Records  : live data, no save
     - Payroll Periods: export action inside tab
     - Tipout Rules   : per-row edit/delete, inline modal
     - Shift Templates: + New Template inline modal

   "Nice. Dependable. Yours."
   ============================================ */

import { T, withAlpha } from '../ui/tokens.js';
import { buildScenePage, sectionCard } from '../ui/forms.js';

/* ------------------------------------------
   MODULE STATE
------------------------------------------ */
let _container = null;
let _activeTabId = 'clock';
let _tabBodies = {};  // tabId -> body element

const TABS = [
    { id: 'clock',      label: 'Clock Records'    },
    { id: 'payroll',    label: 'Payroll Periods'  },
    { id: 'tipout',     label: 'Tipout Rules'     },
    { id: 'templates',  label: 'Shift Templates'  },
];

/* ------------------------------------------
   TAB STRIP
   Underline style per the mockup's .tabs / .tab markup:
   mono-caps labels, 2px underline on the active tab, no
   background fill. Returns the strip element plus a
   setActive(id) hook so tab content re-renders on click.
------------------------------------------ */
function buildTabStrip({ tabs, activeId, onSelect }) {
    const strip = document.createElement('div');
    strip.style.cssText = `
        display: flex;
        gap: ${T.sp.xs + 2}px;
        flex-wrap: wrap;
        border-bottom: 1px solid ${T.well};
        margin-bottom: ${T.sp.xxl - 2}px;
    `;

    const buttons = {};

    tabs.forEach(tab => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.textContent = tab.label;
        btn.style.cssText = `
            background: transparent;
            border: none;
            border-bottom: 2px solid transparent;
            margin-bottom: -1px;
            padding: 10px 18px 12px;
            font-family: ${T.font.mono};
            font-size: ${T.fs.md}px;
            font-weight: 700;
            letter-spacing: 1.5px;
            text-transform: uppercase;
            color: ${T.textMuted};
            cursor: pointer;
            transition: color 0.15s ease, border-color 0.15s ease;
        `;
        btn.addEventListener('mouseenter', () => {
            if (!btn.dataset.active) btn.style.color = T.text;
        });
        btn.addEventListener('mouseleave', () => {
            if (!btn.dataset.active) btn.style.color = T.textMuted;
        });
        btn.addEventListener('click', () => onSelect(tab.id));
        buttons[tab.id] = btn;
        strip.appendChild(btn);
    });

    function applyActive(id) {
        Object.entries(buttons).forEach(([tabId, b]) => {
            const on = tabId === id;
            b.style.color = on ? T.green : T.textMuted;
            b.style.borderBottomColor = on ? T.green : 'transparent';
            if (on) b.dataset.active = '1';
            else delete b.dataset.active;
        });
    }
    applyActive(activeId);

    return { el: strip, setActive: applyActive };
}

/* ------------------------------------------
   TAB PLACEHOLDERS (real renders come in steps 10–13)
------------------------------------------ */
function renderPlaceholder(body, label) {
    body.innerHTML = '';
    const card = sectionCard({
        label,
        accent: T.textDim,
        note: 'Coming online in a later port step.',
    });
    const stub = document.createElement('div');
    stub.style.cssText = `
        color: ${T.textDim};
        font-family: ${T.font.mono};
        font-size: ${T.fs.md}px;
        padding: ${T.sp.xl}px 0;
        text-align: center;
        letter-spacing: 2px;
        text-transform: uppercase;
    `;
    stub.textContent = 'Stub';
    card.body.appendChild(stub);
    body.appendChild(card.card);
}

function renderClockTab(body)     { renderPlaceholder(body, 'Clock Records'); }
function renderPayrollTab(body)   { renderPlaceholder(body, 'Payroll Periods'); }
function renderTipoutTab(body)    { renderPlaceholder(body, 'Tipout Rules'); }
function renderTemplatesTab(body) { renderPlaceholder(body, 'Shift Templates'); }

const TAB_RENDERERS = {
    clock:     renderClockTab,
    payroll:   renderPayrollTab,
    tipout:    renderTipoutTab,
    templates: renderTemplatesTab,
};

/* ------------------------------------------
   TAB SWITCHING
   Only the active tab's body is mounted — inactive tab-content
   wrappers stay empty. Keeps time-attendance timers etc. from
   running in the background when the user is on another tab.
------------------------------------------ */
function activateTab(tabId, stripRef) {
    _activeTabId = tabId;
    Object.entries(_tabBodies).forEach(([id, el]) => {
        el.style.display = (id === tabId) ? 'block' : 'none';
    });
    const render = TAB_RENDERERS[tabId];
    if (render && _tabBodies[tabId]) render(_tabBodies[tabId]);
    stripRef.setActive(tabId);
}

/* ==========================================
   SCENE ENTRY / EXIT
   ========================================== */
export function buildPayrollAttendanceScene(container) {
    _container = container;
    _activeTabId = 'clock';
    _tabBodies = {};

    const { body: wrapper } = buildScenePage(container, {
        title: 'Payroll & Attendance',
        subtitle: 'Staff administration',
    });

    // Tab strip — ref captured so activateTab can re-paint the underline.
    const stripRef = buildTabStrip({
        tabs: TABS,
        activeId: _activeTabId,
        onSelect: (id) => activateTab(id, stripRef),
    });
    wrapper.appendChild(stripRef.el);

    // One body per tab. Only the active body is visible.
    TABS.forEach(tab => {
        const tabBody = document.createElement('div');
        tabBody.dataset.tab = tab.id;
        tabBody.style.display = (tab.id === _activeTabId) ? 'block' : 'none';
        _tabBodies[tab.id] = tabBody;
        wrapper.appendChild(tabBody);
    });

    // Initial render of the default tab.
    const initialRender = TAB_RENDERERS[_activeTabId];
    if (initialRender) initialRender(_tabBodies[_activeTabId]);
}

export function cleanupPayrollAttendance(container) {
    if (container) container.innerHTML = '';
    _container = null;
    _activeTabId = 'clock';
    _tabBodies = {};
}
