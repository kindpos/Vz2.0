/* ============================================
   KINDpos Overseer — Hardware & Network Hub
   Terminal Registration & Device Config
   ============================================ */

import { pushChanges } from '../services/config-push.js';
import { fetchWithTimeout } from '../services/http.js';
import { T, withAlpha } from '../ui/tokens.js';
import {
    field, numberField, checkboxChip, chipGroup,
    button, openModal, showToast,
} from '../ui/forms.js';
import {
    startScan,
    buildTerminalAssignmentChips,
} from '../hardware/shared.js';

/* ─── TERMINAL COLORS ──────────────────────────────────────────── */
const TERM_COLORS = [T.greenUp, T.cyan, T.gold, T.verm, T.lavender];

const COLOR_MAP = {
    green: T.green,
    cyan:  T.elec,
    gold:  T.gold,
    verm:  T.verm,
};

const getTerminalColor = (terminalId) => {
    const terminal = _state.terminals.find(t => t.terminal_id === terminalId);
    if (terminal?.color && COLOR_MAP[terminal.color]) {
        return COLOR_MAP[terminal.color];
    }
    // Algorithmic fallback — preserves the historical T-N → palette mapping.
    const PALETTE = [T.green, T.elec, T.gold, T.verm, T.lavender];
    const tMatch = /^T-(\d+)$/.exec(terminalId || '');
    const idx = tMatch
        ? parseInt(tMatch[1], 10) - 1
        : Math.max(0, _state.terminals.findIndex(
            t => t.terminal_id === terminalId
          ));
    return PALETTE[Math.max(0, idx % PALETTE.length)];
};

/* ─── STATE ───────────────────────────────────────────────────── */
let _state = {
    terminals: [],
    printers: [],
    cardReaders: [],
    routingRules: {},
    activeTerminalId: null,
    isScanning: false,
    discoveredDevices: [],
    scanEventSource: null,
    container: null,
    lastSyncTime: null,
};

const resetState = () => {
    _state = {
        terminals: [],
        printers: [],
        cardReaders: [],
        routingRules: {},
        activeTerminalId: null,
        isScanning: false,
        discoveredDevices: [],
        scanEventSource: null,
        container: null,
        lastSyncTime: null,
    };
};

/* ─── DEVICE HEALTH CACHE ─────────────────────────────────────
   Keyed by MAC. `undefined` = unknown (pre-first-poll, render
   the dot in T.border). Refreshed every 30s by fetchDeviceHealth.
*/
const deviceHealthCache = new Map();
let _healthInterval = null;

const fetchDeviceHealth = async () => {
    try {
        const resp = await fetchWithTimeout('/api/v1/hardware/devices/health');
        if (!resp.ok) return;
        const data = await resp.json();
        const now = Date.now();
        for (const d of data) {
            deviceHealthCache.set(d.mac, { online: d.online, checkedAt: now });
        }
        if (_state.container) rebuild();
    } catch (e) {
        // silent — next interval retries; never disrupts the UI
    }
};

/* ─── FETCH & LOAD ───────────────────────────────────────────── */
const loadData = async () => {
    try {
        const [devicesResp, terminalsResp, routingResp] = await Promise.all([
            fetchWithTimeout('/api/v1/hardware/devices'),
            fetchWithTimeout('/api/v1/hardware/terminals'),
            fetchWithTimeout('/api/v1/hardware/routing'),
        ]);

        if (devicesResp.ok) {
            const devices = await devicesResp.json();
            _state.printers = devices.filter(d =>
                d.type === 'printer' || d.type === 'kitchen' || d.type === 'receipt' ||
                d.type === 'thermal' || d.type === 'impact'
            ) || [];
            _state.cardReaders = devices.filter(d => d.type === 'card_reader') || [];
        }

        if (terminalsResp.ok) {
            _state.terminals = await terminalsResp.json() || [];
        }

        if (routingResp.ok) {
            const rules = await routingResp.json();
            _state.routingRules = {};
            for (const rule of rules) {
                if (!_state.routingRules[rule.printer_mac]) {
                    _state.routingRules[rule.printer_mac] = [];
                }
                _state.routingRules[rule.printer_mac].push(rule);
            }
        }

        _state.lastSyncTime = new Date().toLocaleTimeString([], {
            hour: '2-digit',
            minute: '2-digit',
            hour12: false,
        });

        fetchDeviceHealth();
    } catch (e) {
        showToast(`Failed to load hardware data: ${e.message}`, 'error');
        console.error('[HardwareNetwork] Load error:', e);
    }
};

/* ─── MODALS ────────────────────────────────────────────────────── */
const openTerminalModal = (terminal, onSaved) => {
    const isEdit = !!terminal;
    const content = document.createElement('div');
    content.style.cssText = `display: flex; flex-direction: column; gap: 16px;`;

    const nameF = field({
        label: 'Name',
        id: 'hwn-term-name',
        value: terminal?.name || '',
        placeholder: 'Front Register',
        required: true,
    });

    const ROLES = [
        { id: 'register', label: 'Register' },
        { id: 'kitchen', label: 'Kitchen' },
        { id: 'bar', label: 'Bar' },
        { id: 'manager', label: 'Manager' },
        { id: 'expo', label: 'Expo' },
    ];

    const roleChips = chipGroup({
        options: ROLES,
        selected: [terminal?.role || 'register'],
        mode: 'single',
    });

    content.appendChild(nameF.wrap);
    content.appendChild(document.createElement('div'));
    content.lastChild.textContent = 'Role';
    content.lastChild.style.cssText = `font-size: 14px; color: ${T.textMuted}; font-weight: 600;`;
    content.appendChild(roleChips.wrap);

    // ── Color chip selector ────────────────────────────────────────
    // Custom chips (not chipGroup) so each chip can render a filled
    // swatch alongside the label. Empty selection = "Auto" (algorithmic).
    const COLOR_CHIPS = [
        { id: '',      label: 'Auto',  swatch: null },
        { id: 'green', label: 'Green', swatch: T.green },
        { id: 'cyan',  label: 'Cyan',  swatch: T.elec },
        { id: 'gold',  label: 'Gold',  swatch: T.gold },
        { id: 'verm',  label: 'Verm',  swatch: T.verm },
    ];
    let selectedColor = terminal?.color || '';
    if (!COLOR_CHIPS.some(c => c.id === selectedColor)) selectedColor = '';

    const colorLabel = document.createElement('div');
    colorLabel.textContent = 'Color';
    colorLabel.style.cssText = `font-size: 14px; color: ${T.textMuted}; font-weight: 600;`;
    content.appendChild(colorLabel);

    const colorRow = document.createElement('div');
    colorRow.style.cssText = `display: flex; flex-wrap: wrap; gap: 8px;`;
    const colorChipEls = [];
    const paintColorChips = () => {
        colorChipEls.forEach(({ chip, def }) => {
            const active = def.id === selectedColor;
            const accent = def.swatch || T.muted;
            chip.style.background = active ? withAlpha(accent, 0.18) : T.card;
            chip.style.borderColor = active ? accent : T.border;
            chip.style.color = active ? accent : T.textMuted;
        });
    };
    COLOR_CHIPS.forEach(def => {
        const chip = document.createElement('div');
        chip.setAttribute('data-color-id', def.id);
        chip.style.cssText = `
            display: inline-flex; align-items: center; gap: 6px;
            padding: 4px 10px;
            border-radius: 6px;
            border: 1px solid ${T.border};
            cursor: pointer;
            user-select: none;
            font-size: 12px;
            font-weight: 600;
            font-family: ${T.fb};
            transition: all 0.12s;
        `;
        if (def.swatch) {
            const dot = document.createElement('div');
            dot.style.cssText = `
                width: 10px; height: 10px; border-radius: 50%;
                background: ${def.swatch};
            `;
            chip.appendChild(dot);
        } else {
            const dot = document.createElement('div');
            dot.style.cssText = `
                width: 10px; height: 10px; border-radius: 50%;
                border: 1px dashed ${T.textMuted};
            `;
            chip.appendChild(dot);
        }
        const txt = document.createElement('span');
        txt.textContent = def.label;
        chip.appendChild(txt);
        chip.addEventListener('click', () => {
            selectedColor = def.id;
            paintColorChips();
        });
        colorChipEls.push({ chip, def });
        colorRow.appendChild(chip);
    });
    paintColorChips();
    content.appendChild(colorRow);

    let modalRef = null;
    const saveBtn = button({
        label: isEdit ? 'Save' : 'Add Terminal',
        variant: 'primary',
        onClick: async () => {
            const name = nameF.input.value.trim();
            const role = roleChips.getSelected()[0] || 'register';
            const color = selectedColor;

            if (!name) {
                showToast('Name is required', 'error');
                return;
            }

            if (!isEdit) {
                // Add-flow is unreachable today (no caller passes a null
                // terminal). Keep this branch as a guard so we don't try
                // to PUT against an empty terminal_id.
                showToast('Terminal add is not supported from this UI', 'error');
                return;
            }

            const originalLabel = saveBtn.textContent;
            saveBtn.disabled = true;
            saveBtn.textContent = 'SAVING…';

            try {
                const res = await fetchWithTimeout(
                    `/api/v1/hardware/terminals/${terminal.terminal_id}`,
                    {
                        method: 'PUT',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ name, role, color }),
                    }
                );
                if (!res.ok) {
                    const err = await res.json().catch(() => ({}));
                    const detail = err.detail?.message || err.detail || err.message || `HTTP ${res.status}`;
                    showToast(`Save failed: ${detail}`, 'error');
                    saveBtn.disabled = false;
                    saveBtn.textContent = originalLabel;
                    return;
                }
                showToast('Terminal updated');
                modalRef.close();
                onSaved();
            } catch (e) {
                showToast(`Failed to save terminal: ${e.message}`, 'error');
                saveBtn.disabled = false;
                saveBtn.textContent = originalLabel;
            }
        },
    });

    modalRef = openModal({
        title: isEdit ? `Edit ${terminal.name}` : 'Add Terminal',
        content,
        footer: [
            button({ label: 'Cancel', variant: 'ghost', onClick: () => modalRef.close() }),
            saveBtn,
        ],
        width: 480,
    });
};

const openDeviceModal = (device, deviceType, onSaved) => {
    const isEdit = !!device;
    const content = document.createElement('div');
    content.style.cssText = `display: flex; flex-direction: column; gap: 16px; font-family: ${T.fb};`; // modal root container font — every child inherits

    const nameF = field({
        label: 'Name',
        id: 'hwn-dev-name',
        value: device?.name || '',
        placeholder: deviceType === 'printer' ? 'Kitchen Printer' : 'Card Reader',
    });

    const ipF = field({
        label: 'IP Address',
        id: 'hwn-dev-ip',
        value: device?.ip || '',
        placeholder: '10.0.0.x',
    });

    const portF = numberField({
        label: 'Port',
        id: 'hwn-dev-port',
        value: device?.port || 9100,
    });

    content.appendChild(nameF.wrap);
    content.appendChild(ipF.wrap);
    content.appendChild(portF.wrap);

    // ── Role chip group ──────────────────────────────────────────
    const ROLE_OPTIONS = [
        { id: 'receipt',     label: 'Receipt' },
        { id: 'kitchen',     label: 'Kitchen' },
        { id: 'card_reader', label: 'Card Reader' },
    ];

    let currentRole;
    if (device?.role === 'receipt' || device?.role === 'kitchen' || device?.role === 'card_reader') {
        currentRole = device.role;
    } else if (device?.type === 'card_reader') {
        currentRole = 'card_reader';
    } else {
        currentRole = 'receipt';
    }

    const roleLabel = document.createElement('div');
    roleLabel.textContent = 'Role';
    roleLabel.style.cssText = `font-size: 14px; color: ${T.textMuted}; font-weight: 600;`;
    content.appendChild(roleLabel);

    const roleChips = chipGroup({
        options: ROLE_OPTIONS,
        selected: [currentRole],
        mode: 'single',
    });
    content.appendChild(roleChips.wrap);

    // ── Terminal assignment (receipt + card_reader) ──────────────
    const selectedTerminalIds = new Set(
        Array.isArray(device?.terminal_ids) ? device.terminal_ids : []
    );

    const termSection = document.createElement('div');
    termSection.style.cssText = `display: flex; flex-direction: column; gap: 8px;`;
    const termSectionLabel = document.createElement('div');
    termSectionLabel.textContent = 'Assigned Terminals';
    termSectionLabel.style.cssText = `font-size: 14px; color: ${T.textMuted}; font-weight: 600;`;
    termSection.appendChild(termSectionLabel);
    const termChips = buildTerminalAssignmentChips(
        _state.terminals,
        selectedTerminalIds,
        () => { /* set mutated in place */ }
    );
    termSection.appendChild(termChips);
    content.appendChild(termSection);

    // ── Categories (kitchen) — toggle + chip multi-select ────────
    const initialCategoriesCsv = (device?.categories === 'ALL' ? '' : (device?.categories || ''));
    const selectedCategoryIds = new Set(
        initialCategoriesCsv.split(',').map(s => s.trim()).filter(Boolean)
    );
    let categoriesEnabled = selectedCategoryIds.size > 0;
    let menuCategoriesLoaded = [];

    const catSection = document.createElement('div');
    catSection.style.cssText = `display: flex; flex-direction: column; gap: 10px;`;

    const catHeader = document.createElement('div');
    catHeader.style.cssText = `
        display: flex; align-items: center; gap: 10px;
        cursor: pointer; user-select: none;
    `;

    const catToggle = document.createElement('div');
    catToggle.style.cssText = `
        width: 34px; height: 18px; border-radius: 999px;
        background: ${T.well}; border: 1px solid ${T.border};
        position: relative; flex-shrink: 0;
        transition: background 0.15s, border-color 0.15s;
    `;
    const catToggleKnob = document.createElement('div');
    catToggleKnob.style.cssText = `
        position: absolute; top: 2px; left: 2px;
        width: 12px; height: 12px; border-radius: 50%;
        background: ${T.textMuted};
        transition: left 0.15s, background 0.15s;
    `;
    catToggle.appendChild(catToggleKnob);
    catHeader.appendChild(catToggle);

    const catTitle = document.createElement('div');
    catTitle.textContent = 'CATEGORIES';
    catTitle.style.cssText = `
        flex: 1;
        font-size: 11px; font-weight: 700;
        color: ${T.textMuted}; letter-spacing: 1px;
    `;
    catHeader.appendChild(catTitle);

    const catBadge = document.createElement('div');
    catBadge.style.cssText = `
        padding: 2px 10px; border-radius: 999px;
        font-size: 10px; font-weight: 700;
        transition: all 0.15s;
    `;
    catHeader.appendChild(catBadge);
    catSection.appendChild(catHeader);

    const catChipsWrap = document.createElement('div');
    catChipsWrap.style.cssText = `display: flex; flex-wrap: wrap; gap: 6px;`;
    catSection.appendChild(catChipsWrap);

    const updateCatBadge = () => {
        const count = selectedCategoryIds.size;
        if (categoriesEnabled && count > 0) {
            catBadge.textContent = `${count} selected`;
            catBadge.style.background = withAlpha(T.green, 0.18);
            catBadge.style.border = `1px solid ${T.green}`;
            catBadge.style.color = T.green;
        } else {
            catBadge.textContent = 'All';
            catBadge.style.background = T.well;
            catBadge.style.border = `1px solid ${T.border}`;
            catBadge.style.color = T.textMuted;
        }
    };
    const updateCatToggle = () => {
        if (categoriesEnabled) {
            catToggle.style.background = withAlpha(T.green, 0.25);
            catToggle.style.borderColor = T.green;
            catToggleKnob.style.left = '18px';
            catToggleKnob.style.background = T.green;
            catTitle.style.color = T.green;
            catChipsWrap.style.display = 'flex';
        } else {
            catToggle.style.background = T.well;
            catToggle.style.borderColor = T.border;
            catToggleKnob.style.left = '2px';
            catToggleKnob.style.background = T.textMuted;
            catTitle.style.color = T.textMuted;
            catChipsWrap.style.display = 'none';
        }
    };
    // Full rebuild only on initial mount and when categories data loads.
    // Per-chip clicks repaint just the clicked chip — no DOM teardown —
    // and stopPropagation prevents bubbling into ancestor toggle regions.
    const renderCatChips = () => {
        catChipsWrap.innerHTML = '';
        if (menuCategoriesLoaded.length === 0) {
            const empty = document.createElement('div');
            empty.style.cssText = `font-size: 11px; color: ${T.textMuted};`;
            empty.textContent = 'No categories loaded';
            catChipsWrap.appendChild(empty);
            return;
        }
        menuCategoriesLoaded.forEach(cat => {
            const chip = document.createElement('div');
            chip.textContent = cat.name;
            const paintChip = () => {
                const active = selectedCategoryIds.has(cat.id);
                chip.style.cssText = `
                    padding: 4px 10px; border-radius: 6px;
                    font-size: 11px; font-weight: 600;
                    cursor: pointer; user-select: none;
                    background: ${active ? withAlpha(T.green, 0.18) : T.card};
                    border: 1px solid ${active ? T.green : T.border};
                    color: ${active ? T.green : T.textMuted};
                    transition: all 0.12s;
                `;
            };
            paintChip();
            chip._paintChip = paintChip;
            chip.addEventListener('click', (e) => {
                e.stopPropagation();
                if (selectedCategoryIds.has(cat.id)) selectedCategoryIds.delete(cat.id);
                else selectedCategoryIds.add(cat.id);
                paintChip();
                updateCatBadge();
            });
            catChipsWrap.appendChild(chip);
        });
    };
    const refreshCatChipStyles = () => {
        Array.from(catChipsWrap.children).forEach(c => {
            if (typeof c._paintChip === 'function') c._paintChip();
        });
    };
    catHeader.addEventListener('click', () => {
        categoriesEnabled = !categoriesEnabled;
        if (!categoriesEnabled) {
            selectedCategoryIds.clear();
            refreshCatChipStyles();
        }
        updateCatToggle();
        updateCatBadge();
    });
    updateCatToggle();
    updateCatBadge();
    renderCatChips();
    content.appendChild(catSection);

    const getCategoriesCSV = () => (
        (categoriesEnabled && selectedCategoryIds.size > 0)
            ? [...selectedCategoryIds].join(',')
            : ''
    );

    // ── Reroute Rules (kitchen + receipt) ────────────────────────
    const rerouteSection = document.createElement('div');
    rerouteSection.style.cssText = `display: flex; flex-direction: column; gap: 10px;`;

    const rerouteHeader = document.createElement('div');
    rerouteHeader.style.cssText = `
        display: flex; align-items: center; justify-content: space-between;
        gap: 10px;
    `;
    const rerouteLabel = document.createElement('div');
    rerouteLabel.textContent = 'REROUTE RULES';
    rerouteLabel.style.cssText = `
        font-size: 11px; font-weight: 700;
        color: ${T.textMuted}; letter-spacing: 1px;
    `;
    rerouteHeader.appendChild(rerouteLabel);

    const addRuleBtn = document.createElement('button');
    addRuleBtn.type = 'button';
    addRuleBtn.textContent = '+ ADD RULE';
    addRuleBtn.style.cssText = `
        background: transparent;
        border: 1px solid ${T.green};
        color: ${T.green};
        padding: 4px 12px; border-radius: 999px;
        font-size: 10px; font-weight: 700; letter-spacing: 0.06em;
        cursor: pointer;
    `;
    rerouteHeader.appendChild(addRuleBtn);
    rerouteSection.appendChild(rerouteHeader);

    const ruleListWrap = document.createElement('div');
    ruleListWrap.style.cssText = `display: flex; flex-direction: column; gap: 8px;`;
    rerouteSection.appendChild(ruleListWrap);
    content.appendChild(rerouteSection);

    const ruleCards = []; // { wrap, getRule }

    const DAY_LABELS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];

    const buildRuleCard = (rule) => {
        const state = {
            enabled: rule.is_active !== 0 && rule.is_active !== false,
            days: new Set(Array.isArray(rule.days_of_week)
                ? rule.days_of_week
                : (() => { try { return JSON.parse(rule.days_of_week || '[]'); } catch { return []; } })()),
            timeFrom: rule.time_from || '',
            timeTo: rule.time_to || '',
            categoryId: rule.category_id || '',
            redirectToMac: rule.redirect_to_mac || '',
            overrideActive: !!(rule.override_active),
        };

        const card = document.createElement('div');
        card.style.cssText = `
            background: ${T.card};
            border: 1px solid ${state.enabled ? T.elec : T.border};
            border-radius: 8px;
            padding: 10px 12px;
            display: flex; flex-direction: column; gap: 10px;
            transition: border-color 0.15s;
        `;

        // Header row
        const head = document.createElement('div');
        head.style.cssText = `display: flex; align-items: center; gap: 10px;`;

        const enableToggle = document.createElement('div');
        enableToggle.style.cssText = `
            width: 30px; height: 16px; border-radius: 999px;
            position: relative; flex-shrink: 0; cursor: pointer;
            transition: background 0.15s, border-color 0.15s;
        `;
        const enableKnob = document.createElement('div');
        enableKnob.style.cssText = `
            position: absolute; top: 2px;
            width: 10px; height: 10px; border-radius: 50%;
            transition: left 0.15s, background 0.15s;
        `;
        enableToggle.appendChild(enableKnob);
        head.appendChild(enableToggle);

        const summary = document.createElement('div');
        summary.style.cssText = `
            flex: 1; font-size: 11px; font-weight: 600;
        `;
        head.appendChild(summary);

        const delBtn = document.createElement('button');
        delBtn.type = 'button';
        delBtn.textContent = '✕';
        delBtn.style.cssText = `
            width: 22px; height: 22px; border-radius: 4px;
            background: ${T.verm};
            color: white;
            border: none;
            font-size: 11px; font-weight: 700; line-height: 1;
            cursor: pointer;
            box-shadow: 0 2px 0 ${withAlpha(T.verm, 0.6)};
        `;
        delBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            card.remove();
            const idx = ruleCards.findIndex(rc => rc.wrap === card);
            if (idx >= 0) ruleCards.splice(idx, 1);
        });
        head.appendChild(delBtn);

        card.appendChild(head);

        // Body (collapsed when disabled)
        const body = document.createElement('div');
        body.style.cssText = `display: flex; flex-direction: column; gap: 10px;`;
        card.appendChild(body);

        // ── Days row ──
        const daysWrap = document.createElement('div');
        daysWrap.style.cssText = `display: flex; gap: 4px; flex-wrap: wrap;`;
        DAY_LABELS.forEach((label, idx) => {
            const dayChip = document.createElement('div');
            dayChip.textContent = label;
            const renderDay = () => {
                const active = state.days.has(idx);
                dayChip.style.cssText = `
                    padding: 4px 8px; border-radius: 6px;
                    font-size: 10px; font-weight: 700;
                    cursor: pointer; user-select: none;
                    background: ${active ? withAlpha(T.elec, 0.18) : T.card};
                    border: 1px solid ${active ? T.elec : T.border};
                    color: ${active ? T.elec : T.moon || T.textMuted};
                    transition: all 0.12s;
                `;
            };
            dayChip.addEventListener('click', () => {
                if (state.days.has(idx)) state.days.delete(idx);
                else state.days.add(idx);
                renderDay();
                updateSummary();
            });
            renderDay();
            daysWrap.appendChild(dayChip);
        });
        body.appendChild(daysWrap);

        // ── Time row ──
        const timeRow = document.createElement('div');
        timeRow.style.cssText = `
            display: grid; grid-template-columns: 1fr 1fr; gap: 8px;
        `;
        const buildTimeInput = (initial, onChange) => {
            const wrap = document.createElement('div');
            wrap.style.cssText = `display: flex; flex-direction: column; gap: 4px;`;
            const input = document.createElement('input');
            input.type = 'time';
            input.value = initial || '';
            input.style.cssText = `
                background: ${T.well}; border: 1px solid ${T.border};
                color: ${T.text};
                padding: 6px 8px; border-radius: 4px;
                font-size: 11px;
            `;
            input.addEventListener('input', () => onChange(input.value));
            wrap.appendChild(input);
            return { wrap, input };
        };
        const timeFromLabel = document.createElement('div');
        timeFromLabel.textContent = 'From';
        timeFromLabel.style.cssText = `font-size: 9px; color: ${T.textMuted}; font-weight: 700;`;
        const timeToLabel = document.createElement('div');
        timeToLabel.textContent = 'To';
        timeToLabel.style.cssText = `font-size: 9px; color: ${T.textMuted}; font-weight: 700;`;
        const fromCol = document.createElement('div');
        fromCol.style.cssText = `display: flex; flex-direction: column; gap: 4px;`;
        fromCol.appendChild(timeFromLabel);
        const fromI = buildTimeInput(state.timeFrom, v => { state.timeFrom = v; updateSummary(); });
        fromCol.appendChild(fromI.input);
        const toCol = document.createElement('div');
        toCol.style.cssText = `display: flex; flex-direction: column; gap: 4px;`;
        toCol.appendChild(timeToLabel);
        const toI = buildTimeInput(state.timeTo, v => { state.timeTo = v; updateSummary(); });
        toCol.appendChild(toI.input);
        timeRow.appendChild(fromCol);
        timeRow.appendChild(toCol);
        body.appendChild(timeRow);

        // ── Category + Reroute target row ──
        const selectRow = document.createElement('div');
        selectRow.style.cssText = `
            display: grid; grid-template-columns: 1fr 1fr; gap: 8px;
        `;
        const buildSelect = (label, value, options, onChange) => {
            const wrap = document.createElement('div');
            wrap.style.cssText = `display: flex; flex-direction: column; gap: 4px;`;
            const lab = document.createElement('div');
            lab.textContent = label;
            lab.style.cssText = `font-size: 9px; color: ${T.textMuted}; font-weight: 700;`;
            wrap.appendChild(lab);
            const sel = document.createElement('select');
            sel.style.cssText = `
                background: ${T.well}; border: 1px solid ${T.border};
                color: ${T.text};
                padding: 6px 8px; border-radius: 4px;
                font-size: 11px;
            `;
            options.forEach(opt => {
                const o = document.createElement('option');
                o.value = opt.value;
                o.textContent = opt.label;
                if (opt.value === value) o.selected = true;
                sel.appendChild(o);
            });
            sel.addEventListener('change', () => onChange(sel.value));
            wrap.appendChild(sel);
            return { wrap, sel };
        };

        // The category and reroute selects need menuCategoriesLoaded and
        // saved printers. Build with current snapshot; refreshed on data load.
        let catSel = null;
        let rerouteSel = null;
        const rebuildSelects = () => {
            const catOpts = [
                { value: '', label: '— all —' },
                ...menuCategoriesLoaded.map(c => ({ value: c.id, label: c.name })),
            ];
            const printerOpts = [
                { value: '', label: '— none —' },
                ...(_state.printers || [])
                    .filter(p => (p.role === 'kitchen' || p.role === 'receipt'))
                    .filter(p => (p.mac || '').toUpperCase() !== (device?.mac || '').toUpperCase())
                    .map(p => ({ value: p.mac, label: p.name || p.mac })),
            ];
            const oldCatWrap = catSel?.wrap;
            const oldRerouteWrap = rerouteSel?.wrap;
            catSel = buildSelect('Category', state.categoryId, catOpts,
                v => { state.categoryId = v; updateSummary(); });
            rerouteSel = buildSelect('Reroute To', state.redirectToMac, printerOpts,
                v => { state.redirectToMac = v; updateSummary(); });
            if (oldCatWrap) selectRow.replaceChild(catSel.wrap, oldCatWrap);
            else selectRow.appendChild(catSel.wrap);
            if (oldRerouteWrap) selectRow.replaceChild(rerouteSel.wrap, oldRerouteWrap);
            else selectRow.appendChild(rerouteSel.wrap);
        };
        rebuildSelects();
        body.appendChild(selectRow);

        // ── Terminals row (UI-only; not persisted, schema has no column) ──
        const termWrap = document.createElement('div');
        termWrap.style.cssText = `display: flex; flex-direction: column; gap: 4px;`;
        const termLab = document.createElement('div');
        termLab.style.cssText = `font-size: 9px; color: ${T.textMuted}; font-weight: 700;`;
        termLab.textContent = 'Terminals · blank = all';
        termWrap.appendChild(termLab);
        const termChipsRow = document.createElement('div');
        termChipsRow.style.cssText = `display: flex; flex-wrap: wrap; gap: 4px;`;
        const selectedTerms = new Set();
        (_state.terminals || []).forEach(t => {
            const chip = document.createElement('div');
            chip.textContent = t.name || t.terminal_id;
            const renderTerm = () => {
                const active = selectedTerms.has(t.terminal_id);
                chip.style.cssText = `
                    padding: 3px 8px; border-radius: 6px;
                    font-size: 10px; font-weight: 600;
                    cursor: pointer; user-select: none;
                    background: ${active ? withAlpha(T.green, 0.18) : T.card};
                    border: 1px solid ${active ? T.green : T.border};
                    color: ${active ? T.green : T.moon || T.textMuted};
                `;
            };
            chip.addEventListener('click', () => {
                if (selectedTerms.has(t.terminal_id)) selectedTerms.delete(t.terminal_id);
                else selectedTerms.add(t.terminal_id);
                renderTerm();
            });
            renderTerm();
            termChipsRow.appendChild(chip);
        });
        termWrap.appendChild(termChipsRow);
        body.appendChild(termWrap);

        // ── Override row (separated) ──
        const divider = document.createElement('div');
        divider.style.cssText = `height: 1px; background: ${T.border};`;
        body.appendChild(divider);

        const overrideRow = document.createElement('div');
        overrideRow.style.cssText = `
            display: flex; align-items: center; gap: 10px;
        `;
        const ovToggle = document.createElement('div');
        ovToggle.style.cssText = `
            width: 30px; height: 16px; border-radius: 999px;
            position: relative; cursor: pointer;
            transition: background 0.15s, border-color 0.15s;
        `;
        const ovKnob = document.createElement('div');
        ovKnob.style.cssText = `
            position: absolute; top: 2px;
            width: 10px; height: 10px; border-radius: 50%;
            transition: left 0.15s, background 0.15s;
        `;
        ovToggle.appendChild(ovKnob);
        const ovLabel = document.createElement('div');
        ovLabel.textContent = 'Manual Override Now';
        ovLabel.style.cssText = `flex: 1; font-size: 11px; font-weight: 600;`;
        overrideRow.appendChild(ovToggle);
        overrideRow.appendChild(ovLabel);
        body.appendChild(overrideRow);

        const ovBanner = document.createElement('div');
        ovBanner.style.cssText = `
            padding: 6px 10px; border-radius: 4px;
            background: ${withAlpha(T.gold, 0.18)};
            border: 1px solid ${T.gold};
            color: ${T.gold};
            font-size: 10px; font-weight: 700;
            display: none; align-items: center; justify-content: space-between;
            gap: 8px;
        `;
        const ovBannerText = document.createElement('span');
        ovBannerText.textContent = '⚡ MANUAL OVERRIDE ACTIVE';
        const ovClear = document.createElement('button');
        ovClear.type = 'button';
        ovClear.textContent = 'Clear';
        ovClear.style.cssText = `
            background: transparent; border: 1px solid ${T.gold};
            color: ${T.gold};
            padding: 2px 8px; border-radius: 4px;
            font-size: 9px; font-weight: 700; cursor: pointer;
        `;
        ovBanner.appendChild(ovBannerText);
        ovBanner.appendChild(ovClear);
        body.appendChild(ovBanner);

        const renderOverride = () => {
            if (state.overrideActive) {
                ovToggle.style.background = withAlpha(T.gold, 0.25);
                ovToggle.style.borderColor = T.gold;
                ovKnob.style.left = '16px';
                ovKnob.style.background = T.gold;
                ovLabel.style.color = T.gold;
                ovBanner.style.display = 'flex';
            } else {
                ovToggle.style.background = T.well;
                ovToggle.style.borderColor = T.border;
                ovKnob.style.left = '2px';
                ovKnob.style.background = T.textMuted;
                ovLabel.style.color = T.text;
                ovBanner.style.display = 'none';
            }
            updateSummary();
        };
        ovToggle.addEventListener('click', () => {
            state.overrideActive = !state.overrideActive;
            renderOverride();
        });
        ovClear.addEventListener('click', () => {
            state.overrideActive = false;
            renderOverride();
        });
        renderOverride();

        // ── Summary line builder ──
        function updateSummary() {
            const parts = [];
            const sortedDays = [...state.days].sort((a, b) => a - b);
            if (sortedDays.length > 0 && sortedDays.length < 7) {
                parts.push(sortedDays.map(d => DAY_LABELS[d]).join(','));
            } else if (sortedDays.length === 7) {
                parts.push('Daily');
            }
            if (state.timeFrom && state.timeTo) {
                parts.push(`${state.timeFrom}–${state.timeTo}`);
            }
            const catName = state.categoryId
                ? (menuCategoriesLoaded.find(c => c.id === state.categoryId)?.name || state.categoryId)
                : 'All';
            const targetPrinter = (_state.printers || []).find(
                p => (p.mac || '').toUpperCase() === (state.redirectToMac || '').toUpperCase()
            );
            const targetName = targetPrinter?.name || state.redirectToMac || '—';
            parts.push(`${catName} → ${targetName}`);
            summary.textContent = parts.join(' · ');
            summary.style.color = state.enabled
                ? (state.overrideActive ? T.gold : T.cyan)
                : (T.moon || T.textMuted);
        }

        // ── Enable toggle ──
        const renderEnable = () => {
            if (state.enabled) {
                enableToggle.style.background = withAlpha(T.elec, 0.25);
                enableToggle.style.borderColor = T.elec;
                enableKnob.style.left = '16px';
                enableKnob.style.background = T.elec;
                body.style.display = 'flex';
                card.style.borderColor = T.elec;
            } else {
                enableToggle.style.background = T.well;
                enableToggle.style.borderColor = T.border;
                enableKnob.style.left = '2px';
                enableKnob.style.background = T.textMuted;
                body.style.display = 'none';
                card.style.borderColor = T.border;
            }
            updateSummary();
        };
        enableToggle.style.border = `1px solid ${T.border}`;
        enableToggle.addEventListener('click', () => {
            state.enabled = !state.enabled;
            renderEnable();
        });
        renderEnable();
        updateSummary();

        const controller = {
            wrap: card,
            state,
            rebuildSelects, // called when menuCategoriesLoaded changes
            getRule: () => ({
                rule_type: 'category',
                category_id: state.categoryId,
                days_of_week: JSON.stringify([...state.days].sort((a, b) => a - b)),
                time_from: state.timeFrom,
                time_to: state.timeTo,
                redirect_to_mac: state.redirectToMac,
                override_active: state.overrideActive ? 1 : 0,
                override_expires_at: '',
                priority: 0,
                item_tag: '',
            }),
        };
        ruleCards.push(controller);
        return controller;
    };

    addRuleBtn.addEventListener('click', () => {
        const ctrl = buildRuleCard({
            is_active: 1,
            days_of_week: '[1,2,3,4,5]',
            time_from: '',
            time_to: '',
            category_id: '',
            redirect_to_mac: '',
            override_active: 0,
        });
        ruleListWrap.appendChild(ctrl.wrap);
    });

    // ── register_id (card_reader) ────────────────────────────────
    const regF = field({
        label: 'SPIn Register ID',
        id: 'hwn-dev-reg',
        value: device?.register_id || '',
        placeholder: 'REG-001',
    });
    content.appendChild(regF.wrap);

    // ── Show/hide conditional sections based on role ─────────────
    const refreshConditional = () => {
        termSection.style.display =
            (currentRole === 'receipt' || currentRole === 'card_reader') ? 'flex' : 'none';
        catSection.style.display = (currentRole === 'kitchen') ? 'flex' : 'none';
        rerouteSection.style.display =
            (currentRole === 'kitchen' || currentRole === 'receipt') ? 'flex' : 'none';
        regF.wrap.style.display = (currentRole === 'card_reader') ? '' : 'none';
    };
    refreshConditional();

    // ── Async: fetch menu categories ─────────────────────────────
    fetchWithTimeout('/api/v1/config/menu/categories').then(async (resp) => {
        if (!resp.ok) return;
        const cats = await resp.json().catch(() => []);
        menuCategoriesLoaded = (cats || []).map(c => ({
            id: c.id,
            name: c.name || c.id,
        }));
        renderCatChips();
        ruleCards.forEach(rc => rc.rebuildSelects());
    }).catch(() => {});

    // ── Async: fetch existing routing rules for this device ─────
    if (device?.mac) {
        fetchWithTimeout(`/api/v1/hardware/devices/${device.mac}/routing`).then(async (resp) => {
            if (!resp.ok) return;
            const rules = await resp.json().catch(() => []);
            (rules || [])
                .filter(r => r.rule_type !== 'all')
                .forEach(r => {
                    const ctrl = buildRuleCard(r);
                    ruleListWrap.appendChild(ctrl.wrap);
                });
        }).catch(() => {});
    }

    // chipGroup mutates its internal state on click — poll after the click
    // bubbles to the wrapper to detect the new selection and refresh.
    roleChips.wrap.addEventListener('click', () => {
        const sel = roleChips.getSelected()[0];
        if (sel && sel !== currentRole) {
            currentRole = sel;
            refreshConditional();
        }
    });

    let modalRef = null;
    const saveBtn = button({
        label: 'Save',
        variant: 'primary',
        onClick: async () => {
            const originalLabel = saveBtn.textContent;
            saveBtn.disabled = true;
            saveBtn.textContent = 'SAVING…';
            try {
                const res = await fetchWithTimeout('/api/v1/hardware/devices', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        mac: device?.mac,
                        name: nameF.input.value.trim(),
                        type: device?.type || deviceType,
                        ip: ipF.input.value.trim(),
                        port: parseInt(portF.input.value, 10) || 9100,
                        role: currentRole,
                        terminal_ids: [...selectedTerminalIds],
                        categories: getCategoriesCSV(),
                        register_id: regF.input.value.trim(),
                    }),
                }, 15000);
                if (!res.ok) {
                    const err = await res.json().catch(() => ({}));
                    const detail = err.detail?.message || err.detail || err.message || `HTTP ${res.status}`;
                    showToast(`Save failed: ${detail}`, 'error');
                    saveBtn.disabled = false;
                    saveBtn.textContent = originalLabel;
                    return;
                }

                // Persist reroute rules under the saved MAC. The device
                // POST may have just minted a fresh row, so prefer the
                // response's mac over the form value.
                const saved = await res.json().catch(() => ({}));
                const macForRouting = (saved.mac || device?.mac || '').toUpperCase();
                if (macForRouting && (currentRole === 'kitchen' || currentRole === 'receipt')) {
                    const rulesPayload = ruleCards.map(rc => rc.getRule());
                    const rr = await fetchWithTimeout(
                        `/api/v1/hardware/devices/${macForRouting}/routing`,
                        {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify(rulesPayload),
                        },
                        15000,
                    );
                    if (!rr.ok) {
                        const rerr = await rr.json().catch(() => ({}));
                        const rd = rerr.detail?.message || rerr.detail || rerr.message || `HTTP ${rr.status}`;
                        showToast(`Routing save failed: ${rd}`, 'error');
                        saveBtn.disabled = false;
                        saveBtn.textContent = originalLabel;
                        return;
                    }
                }

                showToast('Device saved');
                modalRef.close();
                onSaved();
            } catch (e) {
                showToast(`Failed to save device: ${e.message}`, 'error');
                saveBtn.disabled = false;
                saveBtn.textContent = originalLabel;
            }
        },
    });

    const deleteBtn = button({
        label: 'Delete',
        variant: 'danger',
        onClick: async () => {
            if (!confirm(`Delete ${device.name}?`)) return;
            try {
                const res = await fetchWithTimeout(`/api/v1/hardware/devices/${device.mac}`, {
                    method: 'DELETE',
                });
                if (!res.ok) throw new Error(`HTTP ${res.status}`);
                showToast('Device deleted');
                modalRef.close();
                onSaved();
            } catch (e) {
                showToast(`Failed to delete device: ${e.message}`, 'error');
            }
        },
    });

    modalRef = openModal({
        title: `Edit ${device?.name || 'Device'}`,
        content,
        footer: [
            button({ label: 'Cancel', variant: 'ghost', onClick: () => modalRef.close() }),
            deleteBtn,
            saveBtn,
        ],
        width: 480,
    });
};

const openReceiptSettingsModal = async (onSaved) => {
    let storeData = {};
    try {
        const res = await fetchWithTimeout('/api/v1/config/store');
        if (res.ok) storeData = await res.json();
    } catch (e) {
        console.warn('[HardwareNetwork] Receipt load failed:', e);
    }

    const receipt = storeData.receipt_settings || {};
    const content = document.createElement('div');
    content.style.cssText = `display: flex; flex-direction: column; gap: 12px;`;

    const headerF = field({
        label: 'Header Text',
        id: 'hwn-receipt-header',
        value: storeData.receipt_header || '',
        placeholder: 'Thank you for visiting!',
    });

    const footerF = field({
        label: 'Footer Text',
        id: 'hwn-receipt-footer',
        value: storeData.receipt_footer || '',
        placeholder: 'Come back soon!',
    });

    const logoChip = checkboxChip({
        label: 'Print Logo',
        checked: receipt.print_logo !== false,
    });

    const customerChip = checkboxChip({
        label: 'Print Customer Copy',
        checked: receipt.print_customer_copy !== false,
    });

    const merchantChip = checkboxChip({
        label: 'Print Merchant Copy',
        checked: receipt.print_merchant_copy === true,
    });

    const itemizedChip = checkboxChip({
        label: 'Print Itemized Copy',
        checked: receipt.print_itemized_copy !== false,
    });

    const tip1F = numberField({
        label: 'Tip Suggestion 1 (%)',
        id: 'hwn-tip1',
        value: receipt.tip_suggestions?.[0] || 15,
    });

    const tip2F = numberField({
        label: 'Tip Suggestion 2 (%)',
        id: 'hwn-tip2',
        value: receipt.tip_suggestions?.[1] || 18,
    });

    const tip3F = numberField({
        label: 'Tip Suggestion 3 (%)',
        id: 'hwn-tip3',
        value: receipt.tip_suggestions?.[2] || 20,
    });

    content.appendChild(headerF.wrap);
    content.appendChild(footerF.wrap);
    content.appendChild(logoChip.wrap);
    content.appendChild(customerChip.wrap);
    content.appendChild(merchantChip.wrap);
    content.appendChild(itemizedChip.wrap);
    content.appendChild(tip1F.wrap);
    content.appendChild(tip2F.wrap);
    content.appendChild(tip3F.wrap);

    let modalRef = null;
    const saveBtn = button({
        label: 'Save Receipt Settings',
        variant: 'primary',
        onClick: async () => {
            saveBtn.disabled = true;
            try {
                const result = await pushChanges([{
                    event_type: 'store.info_updated',
                    payload: {
                        ...storeData.info,
                        receipt_header: headerF.input.value.trim(),
                        receipt_footer: footerF.input.value.trim(),
                        receipt_settings: {
                            print_logo: logoChip.input.checked,
                            print_customer_copy: customerChip.input.checked,
                            print_merchant_copy: merchantChip.input.checked,
                            print_itemized_copy: itemizedChip.input.checked,
                            tip_suggestions: [
                                parseInt(tip1F.input.value, 10) || 15,
                                parseInt(tip2F.input.value, 10) || 18,
                                parseInt(tip3F.input.value, 10) || 20,
                            ],
                            tip_calc_base: receipt.tip_calc_base || 'pretax',
                            language: receipt.language || 'en',
                        },
                    },
                }]);
                if (!result.ok) throw new Error('Push failed');
                showToast('Receipt settings saved');
                modalRef.close();
                onSaved();
            } catch (e) {
                showToast('Failed to save receipt settings', 'error');
                saveBtn.disabled = false;
            }
        },
    });

    modalRef = openModal({
        title: 'Receipt Settings',
        content,
        footer: [
            button({ label: 'Cancel', variant: 'ghost', onClick: () => modalRef.close() }),
            saveBtn,
        ],
        width: 520,
    });
};

/* ─── TERMINAL CARDS ───────────────────────────────────────────── */
const buildTerminalCard = (terminal) => {
    const card = document.createElement('div');
    const color = getTerminalColor(terminal.terminal_id);
    const isActive = _state.activeTerminalId === terminal.terminal_id;

    card.setAttribute('data-term-id', terminal.terminal_id);
    card.style.cssText = `
        flex: 1;
        min-width: 120px;
        padding: 16px;
        background: ${T.card};
        border: 2px solid ${isActive ? color : T.border};
        border-bottom: 3px solid ${color};
        border-radius: 8px;
        text-align: center;
        cursor: pointer;
        position: relative;
        transition: all 0.15s ease;
        ${isActive ? `box-shadow: 0 0 12px ${withAlpha(color, 0.4)};` : ''}
    `;

    card.addEventListener('mouseenter', () => {
        if (!isActive) card.style.borderColor = withAlpha(color, 0.5);
    });
    card.addEventListener('mouseleave', () => {
        if (!isActive) card.style.borderColor = T.border;
    });

    const editBtn = document.createElement('button');
    editBtn.type = 'button';
    editBtn.textContent = 'EDIT';
    editBtn.style.cssText = `
        position: absolute;
        top: 8px;
        right: 8px;
        background: transparent;
        border: 1.5px solid ${T.border};
        border-radius: 4px;
        padding: 4px 8px;
        font-family: ${T.fb};
        font-size: 9px;
        font-weight: 700;
        letter-spacing: 0.08em;
        color: ${T.moon};
        cursor: pointer;
        pointer-events: auto;
        touch-action: manipulation;
    `;
    editBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        openTerminalModal(terminal, () => {
            loadData().then(() => rebuild());
        });
    });
    card.appendChild(editBtn);

    const dot = document.createElement('div');
    dot.style.cssText = `
        width: 8px;
        height: 8px;
        border-radius: 50%;
        background: ${terminal.online ? T.greenWarm : T.verm};
        margin: 0 auto 8px;
    `;
    card.appendChild(dot);

    const id = document.createElement('div');
    id.style.cssText = `
        font-family: ${T.fb};
        font-size: 22px;
        font-weight: 700;
        color: ${isActive ? color : T.text};
        transition: color 0.15s ease;
    `;
    id.textContent = terminal.terminal_id;
    card.appendChild(id);

    const ip = document.createElement('div');
    ip.style.cssText = `
        font-size: 9px;
        color: ${T.textMuted};
        margin-top: 4px;
        font-family: ui-monospace, monospace;
    `;
    ip.textContent = terminal.online ? terminal.ip_address || '' : `Last seen ${terminal.lastSeen || '?'}`;
    card.appendChild(ip);

    const role = document.createElement('div');
    role.style.cssText = `
        font-size: 8px;
        color: ${isActive ? T.bg : T.textMuted};
        background: ${isActive ? color : T.card};
        padding: 2px 6px;
        border-radius: 3px;
        margin-top: 6px;
        display: inline-block;
        transition: all 0.15s ease;
    `;
    role.textContent = terminal.role?.toUpperCase() || 'REGISTER';
    card.appendChild(role);

    card.addEventListener('click', () => {
        if (_state.activeTerminalId === terminal.terminal_id) {
            _state.activeTerminalId = null;
        } else {
            _state.activeTerminalId = terminal.terminal_id;
        }
        rebuild();
    });

    return card;
};

/* ─── DEVICE CARDS ─────────────────────────────────────────────── */
const buildDeviceCard = (device, deviceType) => {
    const card = document.createElement('div');
    card.setAttribute('data-device-mac', device.mac);

    const accentColor = deviceType === 'printer'
        ? (device.role === 'kitchen' ? T.verm : T.cyan)
        : T.green;

    card.style.cssText = `
        padding: 12px;
        background: ${T.well};
        border: 1px solid ${T.border};
        border-top: 2px solid ${accentColor};
        border-radius: 6px;
        text-align: center;
        cursor: pointer;
        transition: all 0.15s ease;
    `;

    card.addEventListener('mouseenter', () => {
        card.style.borderColor = accentColor;
        card.style.boxShadow = `0 0 8px ${withAlpha(accentColor, 0.3)}`;
    });
    card.addEventListener('mouseleave', () => {
        card.style.borderColor = T.border;
        card.style.boxShadow = '';
    });

    const health = deviceHealthCache.get(device.mac);
    let dotColor;
    if (!health) dotColor = T.border;
    else if (health.online) dotColor = T.green;
    else dotColor = T.verm;

    const dot = document.createElement('div');
    dot.style.cssText = `
        width: 6px;
        height: 6px;
        border-radius: 50%;
        background: ${dotColor};
        margin: 0 auto 4px;
    `;
    card.appendChild(dot);

    const emoji = document.createElement('div');
    emoji.style.cssText = `font-size: 20px; margin-bottom: 4px;`;
    emoji.textContent = deviceType === 'printer' ? '🖨' : '💳';
    card.appendChild(emoji);

    const name = document.createElement('div');
    name.style.cssText = `
        font-size: 9px;
        font-weight: 700;
        color: ${T.text};
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
    `;
    name.textContent = device.name || 'Device';
    card.appendChild(name);

    const info = document.createElement('div');
    info.style.cssText = `
        font-size: 8px;
        color: ${T.textMuted};
        margin-top: 2px;
        font-family: ui-monospace, monospace;
    `;
    info.textContent = device.register_id || device.ip || '';
    card.appendChild(info);

    // Terminal-assignment tags — receipts and card readers only.
    // Kitchen printers fan out to every terminal so they have no tags.
    if (device.role !== 'kitchen') {
        const ids = Array.isArray(device.terminal_ids) ? device.terminal_ids : [];
        if (ids.length > 0) {
            const tagRow = document.createElement('div');
            tagRow.style.cssText = `
                display: flex; gap: 4px; flex-wrap: wrap; margin-top: 4px;
                justify-content: center;
            `;
            ids.forEach(tid => {
                const tColor = getTerminalColor(tid);
                const tag = document.createElement('div');
                tag.style.cssText = `
                    border: 1px solid ${tColor};
                    color: ${tColor};
                    border-radius: 4px;
                    padding: 1px 5px;
                    font-size: 8px;
                    font-weight: 700;
                    letter-spacing: 0.06em;
                    text-transform: uppercase;
                    font-family: ${T.fb};
                `;
                tag.textContent = tid;
                tagRow.appendChild(tag);
            });
            card.appendChild(tagRow);
        }
    }

    card.addEventListener('click', () => {
        openDeviceModal(device, deviceType, () => {
            loadData().then(() => rebuild());
        });
    });

    // Dim/highlight based on the currently-selected terminal.
    // Kitchen always matches (broadcast); others match only if their
    // terminal_ids include the active terminal.
    const activeTid = _state.activeTerminalId;
    if (activeTid) {
        const hColor = getTerminalColor(activeTid);
        const isKitchen = device.role === 'kitchen';
        const ids = Array.isArray(device.terminal_ids) ? device.terminal_ids : [];
        const match = isKitchen || ids.includes(activeTid);
        if (match) {
            card.style.borderColor = hColor;
            card.style.boxShadow = `0 0 0 2px ${withAlpha(hColor, 0.35)}`;
            card.style.opacity = '1';
        } else {
            card.style.opacity = '0.3';
        }
    }

    return card;
};

/* ─── GROUP CARDS ──────────────────────────────────────────────── */
const buildGroupCard = (title, devices, deviceType, icon) => {
    const card = document.createElement('div');
    const isActive = _state.activeTerminalId !== null;

    card.setAttribute('data-device-group', deviceType === 'printer' && title.includes('Kitchen') ? 'kitchen' : deviceType);
    card.style.cssText = `
        padding: 14px;
        background: ${T.well};
        border: 1px solid ${isActive ? withAlpha(getTerminalColor(_state.activeTerminalId), 0.5) : T.border};
        border-radius: 8px;
        transition: all 0.15s ease;
        ${isActive ? `box-shadow: 0 0 8px ${withAlpha(getTerminalColor(_state.activeTerminalId), 0.2)};` : ''}
    `;

    const titleEl = document.createElement('div');
    titleEl.style.cssText = `
        font-family: ${T.fb};
        font-size: 12px;
        font-weight: 700;
        color: ${T.textMuted};
        text-transform: uppercase;
        letter-spacing: 1px;
        margin-bottom: 10px;
        display: flex;
        align-items: center;
        justify-content: space-between;
    `;
    titleEl.innerHTML = `<span>${title}</span>`;

    if (title.includes('Receipt Settings')) {
        const settingsBtn = document.createElement('button');
        settingsBtn.textContent = '⚙';
        settingsBtn.style.cssText = `
            background: transparent;
            border: 1px solid ${T.border};
            color: ${T.text};
            border-radius: 3px;
            padding: 2px 6px;
            cursor: pointer;
            font-size: 12px;
        `;
        settingsBtn.addEventListener('click', () => {
            openReceiptSettingsModal(() => {
                loadData().then(() => rebuild());
            });
        });
        titleEl.appendChild(settingsBtn);
    }

    card.appendChild(titleEl);

    const grid = document.createElement('div');
    grid.style.cssText = `
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(80px, 1fr));
        gap: 8px;
    `;

    devices.forEach(dev => {
        grid.appendChild(buildDeviceCard(dev, deviceType));
    });

    if (devices.length === 0) {
        const empty = document.createElement('div');
        empty.style.cssText = `
            grid-column: 1 / -1;
            padding: 20px;
            text-align: center;
            color: ${T.textDim};
            font-size: 11px;
        `;
        empty.textContent = `No ${title.toLowerCase()}`;
        grid.appendChild(empty);
    }

    card.appendChild(grid);
    return card;
};

/* ─── DISCOVERED DEVICES PANEL ─────────────────────────────────── */
function buildDiscoveredDevicesPanel() {
    const devices = _state.discoveredDevices;
    if (!devices.length) return null;

    const panel = document.createElement('div');
    panel.style.cssText = `margin-top:16px; display:flex;
      flex-direction:column; gap:8px;`;

    const heading = document.createElement('div');
    heading.textContent = 'DISCOVERED DEVICES';
    heading.style.cssText = `font:600 11px/1 'JetBrains Mono',
      monospace; color:${T.moon}; letter-spacing:0.08em;
      padding:0 4px;`;
    panel.appendChild(heading);

    devices.forEach(device => {
        const row = document.createElement('div');
        row.style.cssText = `display:flex; align-items:center;
          justify-content:space-between; padding:8px 12px;
          background:${T.card}; border-radius:6px;`;

        const info = document.createElement('div');
        info.innerHTML = `
          <div style="font:600 13px/1 'JetBrains Mono',monospace;
            color:${T.text}">${device.name || device.mac || '—'}</div>
          <div style="font:11px/1.4 'JetBrains Mono',monospace;
            color:${T.moon}">${device.ip || ''} · ${device.type || ''}</div>`;
        row.appendChild(info);

        const addBtn = document.createElement('button');
        addBtn.textContent = 'ADD';
        addBtn.style.cssText = `padding:4px 14px;
          background:${T.green}; color:${T.bg};
          border:none; border-radius:20px;
          font:700 11px/1 'JetBrains Mono',monospace;
          cursor:pointer; pointer-events:auto;
          touch-action:manipulation;`;
        addBtn.addEventListener('click', () => {
            openDeviceModal(device, device.type || 'printer', async () => {
                _state.discoveredDevices =
                    _state.discoveredDevices.filter(d => d !== device);
                await loadData();
                rebuild();
            });
        });
        row.appendChild(addBtn);
        panel.appendChild(row);
    });
    return panel;
}

/* ─── STATUS BAR ────────────────────────────────────────────────── */
const buildStatusBar = () => {
    const bar = document.createElement('div');
    bar.style.cssText = `
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 16px;
        padding: 12px 16px;
        background: ${T.card};
        border-bottom: 1px solid ${T.border};
    `;

    const left = document.createElement('div');
    left.style.cssText = `
        display: flex;
        align-items: center;
        gap: 12px;
        font-family: ui-monospace, monospace;
        font-size: 11px;
        color: ${T.textMuted};
    `;

    const dot = document.createElement('div');
    dot.style.cssText = `
        width: 6px;
        height: 6px;
        border-radius: 50%;
        background: ${T.greenWarm};
    `;
    left.appendChild(dot);

    const status = document.createElement('span');
    status.textContent = `ONLINE  •  ${_state.terminals.length} terminals  •  Sync ${_state.lastSyncTime || '--:--'}`;
    left.appendChild(status);

    bar.appendChild(left);

    const scanBtn = button({
        label: 'SCAN NETWORK',
        variant: 'primary',
        onClick: () => startNetworkScan(),
    });
    scanBtn.style.cssText = `
        padding: 6px 12px;
        font-size: 10px;
        white-space: nowrap;
    `;
    bar.appendChild(scanBtn);

    return bar;
};

/* ─── NETWORK SCAN ─────────────────────────────────────────────── */
function startNetworkScan(targetIp) {
    if (_state.isScanning) return;
    _state.isScanning = true;
    _state.discoveredDevices = [];
    rebuild();
    if (_state.scanEventSource) {
        _state.scanEventSource.close();
    }
    _state.scanEventSource = startScan({
        targetIp,
        onStart:      (msg) => { /* optional: log */ },
        onDevice:     (msg) => {
            _state.discoveredDevices.push(msg);
            rebuild();
        },
        onDiagnostic: (msg) => showToast(msg.message || ''),
        onComplete:   ()    => {
            _state.isScanning = false;
            showToast(`Scan complete — ${_state.discoveredDevices.length} devices found`);
            rebuild();
        },
        onError:      (msg) => {
            _state.isScanning = false;
            rebuild();
        },
    });
}

/* ─── RENDER ────────────────────────────────────────────────────── */
const rebuild = () => {
    if (!_state.container) return;

    const main = _state.container.querySelector('[data-hwn-main]');
    if (!main) return;
    main.innerHTML = '';

    const terminalRow = document.createElement('div');
    terminalRow.style.cssText = `
        display: flex;
        gap: 12px;
        margin-bottom: 52px;
        position: relative;
    `;

    _state.terminals.forEach(term => {
        terminalRow.appendChild(buildTerminalCard(term));
    });

    main.appendChild(terminalRow);

    const groupGrid = document.createElement('div');
    groupGrid.style.cssText = `
        display: grid;
        grid-template-columns: 1fr 1fr 1fr;
        gap: 12px;
        position: relative;
    `;

    const kitchenPrinters = _state.printers.filter(p => p.role === 'kitchen');
    const receiptPrinters = _state.printers.filter(p => p.role === 'receipt');
    const cardReaders = _state.cardReaders;

    groupGrid.appendChild(buildGroupCard('Kitchen Printers', kitchenPrinters, 'printer', '🖨'));
    groupGrid.appendChild(buildGroupCard('Receipt Printers', receiptPrinters, 'printer', '🧾'));
    groupGrid.appendChild(buildGroupCard('Card Readers', cardReaders, 'card', '💳'));

    main.appendChild(groupGrid);

    // Sub-page link rows — destinations not yet implemented; click is a stub.
    const linkStack = document.createElement('div');
    linkStack.style.cssText = `
        display: flex; flex-direction: column; gap: 8px;
        margin-top: 16px;
    `;
    const SUBPAGES = [
        { label: 'Reroute Rules',     key: 'reroute' },
        { label: 'Printer Templates', key: 'templates' },
        { label: 'Receipt Settings',  key: 'receipt-settings' },
    ];
    SUBPAGES.forEach(({ label, key }) => {
        const row = document.createElement('div');
        row.setAttribute('data-hwn-subpage', key);
        row.style.cssText = `
            background: ${T.well};
            border: 1.5px solid ${T.border};
            border-radius: ${T.r.md}px;
            padding: 10px 16px;
            display: flex; align-items: center; gap: 10px;
            cursor: pointer;
            transition: border-color 0.15s ease;
        `;
        const labelEl = document.createElement('div');
        labelEl.textContent = label;
        labelEl.style.cssText = `
            flex: 1;
            font-family: ${T.fb};
            font-size: ${T.fs.base}px;
            font-weight: 700;
            color: ${T.text};
            text-transform: uppercase;
            letter-spacing: 0.06em;
        `;
        const arrow = document.createElement('div');
        arrow.textContent = '›';
        arrow.style.cssText = `
            color: ${T.moon};
            font-size: 18px;
            font-weight: 700;
        `;
        row.appendChild(labelEl);
        row.appendChild(arrow);
        row.addEventListener('mouseenter', () => {
            row.style.borderColor = T.green;
        });
        row.addEventListener('mouseleave', () => {
            row.style.borderColor = T.border;
        });
        row.addEventListener('click', () => {
            // Stub — destinations not implemented yet.
            showToast(`${label} — coming soon`);
        });
        linkStack.appendChild(row);
    });
    main.appendChild(linkStack);

    const discoveredPanel = buildDiscoveredDevicesPanel();
    if (discoveredPanel) {
        const mainEl = _state.container.querySelector('[data-hwn-main]');
        if (mainEl) mainEl.appendChild(discoveredPanel);
    }
};

export async function mount(container) {
    _state.container = container;
    container.innerHTML = '';
    container.style.cssText = `
        display: flex;
        flex-direction: column;
        height: 100%;
        background: ${T.bg};
        color: ${T.text};
    `;

    const header = document.createElement('div');
    header.style.cssText = `
        padding: 20px 16px;
        border-bottom: 1px solid ${T.border};
    `;

    const title = document.createElement('div');
    title.style.cssText = `
        font-family: ${T.fb};
        font-size: 32px;
        font-weight: 700;
        color: ${T.text};
        margin-bottom: 4px;
    `;
    title.textContent = 'Hardware & Network';
    header.appendChild(title);

    const subtitle = document.createElement('div');
    subtitle.style.cssText = `
        font-family: ui-monospace, monospace;
        font-size: 11px;
        color: ${T.textMuted};
        letter-spacing: 1px;
        text-transform: uppercase;
    `;
    subtitle.textContent = 'Terminal Registration & Device Config';
    header.appendChild(subtitle);

    container.appendChild(header);

    const statusBar = buildStatusBar();
    container.appendChild(statusBar);

    const main = document.createElement('div');
    main.setAttribute('data-hwn-main', '');
    main.style.cssText = `
        flex: 1;
        padding: 16px;
        overflow-y: auto;
        position: relative;
    `;
    container.appendChild(main);

    await loadData();
    rebuild();

    if (_healthInterval) clearInterval(_healthInterval);
    _healthInterval = setInterval(fetchDeviceHealth, 30000);

    return () => {
        if (_state.scanEventSource) {
            _state.scanEventSource.close();
            _state.scanEventSource = null;
        }
        if (_healthInterval) {
            clearInterval(_healthInterval);
            _healthInterval = null;
        }
        resetState();
    };
}

export function cleanupHardwareNetwork(container) {
    if (_state.scanEventSource) {
        _state.scanEventSource.close();
    }
    if (_healthInterval) {
        clearInterval(_healthInterval);
        _healthInterval = null;
    }
    resetState();
}
