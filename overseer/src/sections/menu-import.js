/* ============================================
   KINDpos Overseer — Menu Import Section
   Excel Template Import via SheetJS

   "Nice. Dependable. Yours." — import your
   menu in minutes, not hours. No cloud needed.

   Reskinned to Vz2.0 Nostalgia using home.js
   as the visual guide. Skeleton unchanged —
   view stack, async flow, and event handlers
   all preserved.
   ============================================ */

import { parseMenuTemplate, getSummary } from '../services/excel-parser.js';
import { pushChanges } from '../services/config-push.js';

/* ------------------------------------------
   NOSTALGIA PALETTE
   Mirrors home.js. Will move to variables.css
   when the shell restructure lands.
------------------------------------------ */
const C = {
    bg:         '#383c42',
    card:       '#2e3236',
    well:       '#22252a',
    gold:       '#f5a623',
    goldDk:     '#7a4d00',
    cyan:       '#22d3ee',
    green:      '#86efac',
    greenDk:    '#1a5c2e',
    greenUp:    '#4ade80',
    greenUpDk:  '#166534',
    lavender:   '#b48efa',
    verm:       '#e8472a',
    vermDk:     '#6b1a0e',
    warning:    '#fbbf24',
    text:       '#e8eaed',
    textMuted:  'rgba(232,234,237,0.55)',
    textDim:    'rgba(232,234,237,0.4)',
    border:     'rgba(232,234,237,0.08)',
};

/* ------------------------------------------
   VIEW STACK STATE
   Same architecture as reporting drill-downs.
------------------------------------------ */
let viewHistory = [];
let currentWrapper = null;

/** Parsed data flows between views */
let parsedData = null;
let parseErrors = [];
let parseWarnings = [];

/** Reference to the selected File object */
let selectedFile = null;

/* ------------------------------------------
   SMALL PRIMITIVES
   Minimal helpers so each view reads cleanly.
   Not a full shared forms.js — this is just
   enough for menu-import.
------------------------------------------ */

/**
 * Nostalgia card with left accent bar.
 * Returns the outer element; caller appends children.
 */
function buildCard(accent, opts = {}) {
    const card = document.createElement('div');
    card.style.cssText = `
        background: ${C.card};
        border-left: 4px solid ${accent || C.green};
        border-radius: 10px;
        padding: ${opts.padding || '20px 24px'};
        position: relative;
        ${opts.margin ? `margin: ${opts.margin};` : ''}
        ${opts.cssText || ''}
    `;
    return card;
}

/**
 * Micro label — 12-13px letter-spaced caps in ui-monospace.
 * Matches home.js .card-label / .card-mini-label.
 */
function buildLabel(text, opts = {}) {
    const el = document.createElement('div');
    el.style.cssText = `
        font-size: ${opts.size || '13px'};
        letter-spacing: ${opts.size === '12px' ? '2px' : '2.5px'};
        font-weight: 700;
        color: ${opts.color || C.textMuted};
        text-transform: uppercase;
        font-family: ui-monospace, monospace;
        ${opts.margin ? `margin: ${opts.margin};` : 'margin-bottom: 10px;'}
    `;
    el.textContent = text;
    return el;
}

/**
 * Nostalgia pill button — bottom-shadow press-down.
 * Variants: primary (gold), confirm (greenUp), secondary (ghost green),
 * tertiary (dim link), danger (verm).
 */
function buildPillButton(label, variant, onClick) {
    const btn = document.createElement('button');

    const variants = {
        primary:   { bg: C.gold,    dark: C.goldDk,    fg: C.well, border: 'none' },
        confirm:   { bg: C.greenUp, dark: C.greenUpDk, fg: C.well, border: 'none' },
        danger:    { bg: C.verm,    dark: C.vermDk,    fg: '#fff', border: 'none' },
        secondary: { bg: 'transparent', dark: 'transparent', fg: C.green,
                     border: `2px solid ${C.green}` },
        tertiary:  { bg: 'transparent', dark: 'transparent', fg: C.textMuted,
                     border: `1px solid ${C.border}` },
    };
    const v = variants[variant] || variants.primary;

    const hasShadow = variant !== 'secondary' && variant !== 'tertiary';

    btn.style.cssText = `
        padding: 12px 28px;
        background: ${v.bg};
        border: ${v.border};
        border-radius: 999px;
        color: ${v.fg};
        font-size: 14px;
        font-weight: 700;
        letter-spacing: 0.08em;
        text-transform: uppercase;
        cursor: pointer;
        transition: all 0.08s ease;
        outline: none;
        user-select: none;
        ${hasShadow ? `box-shadow: 0 5px 0 ${v.dark};` : ''}
    `;
    btn.textContent = label;

    // Hover: ghost variants get a subtle tint; solid variants unchanged.
    btn.addEventListener('mouseenter', () => {
        if (btn.disabled) return;
        if (variant === 'secondary') {
            btn.style.background = 'rgba(134, 239, 172, 0.08)';
        } else if (variant === 'tertiary') {
            btn.style.background = 'rgba(232, 234, 237, 0.05)';
            btn.style.color = C.text;
        }
    });
    btn.addEventListener('mouseleave', () => {
        if (btn.disabled) return;
        if (variant === 'secondary' || variant === 'tertiary') {
            btn.style.background = 'transparent';
            btn.style.color = v.fg;
        }
    });

    // Press-down: shadow collapses, button slides to baseline.
    btn.addEventListener('mousedown', () => {
        if (btn.disabled || !hasShadow) return;
        btn.style.boxShadow = 'none';
        btn.style.transform = 'translateY(3px)';
    });
    const release = () => {
        if (btn.disabled || !hasShadow) return;
        btn.style.boxShadow = `0 5px 0 ${v.dark}`;
        btn.style.transform = '';
    };
    btn.addEventListener('mouseup', release);
    btn.addEventListener('mouseleave', release);

    if (onClick) btn.addEventListener('click', onClick);
    return btn;
}

/**
 * Toast — top-right corner, fades out after 3s.
 * Reskinned: dark card with accent-left in the semantic color.
 */
function showToast(msg, type = 'success') {
    const accent = type === 'error' ? C.verm
                 : type === 'warning' ? C.warning
                 : C.greenUp;
    const toast = document.createElement('div');
    toast.style.cssText = `
        position: fixed;
        top: 24px; right: 24px;
        z-index: 10000;
        background: ${C.card};
        border-left: 4px solid ${accent};
        border-radius: 8px;
        color: ${C.text};
        padding: 14px 24px;
        font-size: 15px;
        font-family: ui-monospace, monospace;
        box-shadow: 0 8px 24px rgba(0, 0, 0, 0.4);
    `;
    toast.textContent = msg;
    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), 3000);
}

/* ------------------------------------------
   EVENT CONVERSION
   Pure data transform — exported for tests.

   Emission order matches the dependency graph: every event
   only references ids of entities created earlier in the
   stream, so an in-order replay always projects cleanly.

     1. store.info_updated
     2. size.created                      (per data.sizes)
     3. option.created                    (per data.options)
     4. option_group.created
        option_group.option_added         (per option in each group)
     5. modifier.group_created            (mandatory before optional)
        modifier.group_option_group_set   (when default OG is set)
     6. modifier.created
        modifier.size_pricing_set         (per group in price_by_size)
     7. micromod.created
        micromod.assigned_to_modifier     (per modifier in attaches_to)
     8. menu.category_created
     9. menu.item_created
        menu.item_size_pricing_set
        menu.item_option_group_override_set
        menu.item_size_price_override_set
    10. tax / discounts
------------------------------------------ */
function _slugify(name) {
    return String(name || '').toLowerCase()
        .replace(/[^a-z0-9]+/g, '_')
        .replace(/_+$/, '')
        .replace(/^_+/, '');
}

function _slugifyDash(name) {
    return String(name || '').toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/-+$/, '')
        .replace(/^-+/, '');
}

export function convertParsedDataToEvents(data) {
    const events = [];
    if (!data) return events;

    // Resolve name → id at conversion time so later events can reference
    // entities created earlier in the stream.
    const sizeIdByName        = new Map();
    const optionIdByName      = new Map();
    const optionGroupIdByName = new Map();
    const modifierIdByName    = new Map();
    const modGroupIdByName    = new Map();

    /* ── 1. store.info_updated ───────────────────────────────────── */
    const info = data.restaurant_info || {};
    if (Object.keys(info).length > 0) {
        const find = (k) => {
            const target = k.toLowerCase();
            for (const key of Object.keys(info)) {
                if (key.toLowerCase() === target) return info[key];
            }
            return undefined;
        };
        const restaurantName = find('Restaurant Name') ?? info.name;
        const payload = { ...info };
        if (restaurantName) payload.restaurant_name = restaurantName;
        events.push({ event_type: 'store.info_updated', payload });
    }

    /* ── 2. size.created ─────────────────────────────────────────── */
    (data.sizes || []).forEach(s => {
        const sid = s.size_id || _slugify(s.name);
        sizeIdByName.set(s.name, sid);
        events.push({
            event_type: 'size.created',
            payload: {
                size_id:          sid,
                name:             s.name,
                price_adjustment: s.price_adjustment,
                active:           s.active !== false,
            },
        });
    });

    /* ── 3. option.created ───────────────────────────────────────── */
    (data.options || []).forEach(o => {
        const oid = o.option_id || _slugify(o.name);
        optionIdByName.set(o.name, oid);
        events.push({
            event_type: 'option.created',
            payload: {
                option_id:        oid,
                name:             o.name,
                price_adjustment: o.price_adjustment,
                negates_price:    !!o.negates_price,
                active:           o.active !== false,
            },
        });
    });

    /* ── 4. option_group.created + option_group.option_added ────── */
    (data.option_groups || []).forEach(og => {
        const ogid = og.option_group_id || _slugify(og.name);
        optionGroupIdByName.set(og.name, ogid);
        events.push({
            event_type: 'option_group.created',
            payload: {
                option_group_id: ogid,
                name:            og.name,
                option_ids:      [],
                active:          og.active !== false,
            },
        });
        (og.option_names || []).forEach(optName => {
            const optId = optionIdByName.get(optName);
            if (!optId) return;
            events.push({
                event_type: 'option_group.option_added',
                payload: { option_group_id: ogid, option_id: optId },
            });
        });
    });

    /* ── 5. modifier.group_created (mandatory then optional) ────── */
    const modGrps = data.mod_groups || { mandatory: [], optional: [] };
    const buildEmbeddedModifiers = (group) => (group.modifiers || []).map(modName => {
        const mid = modifierIdByName.get(modName) || _slugify(modName);
        // Surface a minimal {modifier_id, name} shape so the projection's
        // group→modifier embedding has something to work with even before
        // the standalone modifier.created events run. Price information
        // comes from the dedicated modifier.created emission below.
        return { modifier_id: mid, name: modName };
    });

    (modGrps.mandatory || []).forEach(g => {
        const gid = g.group_id || _slugify(g.name);
        modGroupIdByName.set(g.name, gid);
        events.push({
            event_type: 'modifier.group_created',
            payload: {
                group_id:        gid,
                name:            g.name,
                modifiers:       buildEmbeddedModifiers(g),
                modifier_ids:    (g.modifiers || []).map(n => modifierIdByName.get(n) || _slugify(n)),
                min_selections:  g.min || 0,
                max_selections:  g.max || 1,
                drives_pricing:  !!g.drives_pricing,
                active:          g.active !== false,
            },
        });
    });

    (modGrps.optional || []).forEach(g => {
        const gid = g.group_id || _slugify(g.name);
        modGroupIdByName.set(g.name, gid);
        events.push({
            event_type: 'modifier.group_created',
            payload: {
                group_id:        gid,
                name:            g.name,
                modifiers:       buildEmbeddedModifiers(g),
                modifier_ids:    (g.modifiers || []).map(n => modifierIdByName.get(n) || _slugify(n)),
                min_selections:  g.min || 0,
                max_selections:  g.max || 1,
                drives_pricing:  false,
                size_price_adjustments: g.size_price_adjustments || {},
                active:          g.active !== false,
            },
        });
        // If the optional group has a default option group, link them.
        if (g.default_option_group_name) {
            const ogid = optionGroupIdByName.get(g.default_option_group_name);
            if (ogid) {
                events.push({
                    event_type: 'modifier.group_option_group_set',
                    payload: { group_id: gid, option_group_id: ogid },
                });
            }
        }
    });

    /* ── 6. modifier.created + modifier.size_pricing_set ────────── */
    (data.modifiers || []).forEach(m => {
        const mid = m.modifier_id || _slugify(m.name);
        modifierIdByName.set(m.name, mid);
        events.push({
            event_type: 'modifier.created',
            payload: {
                modifier_id: mid,
                name:        m.name,
                price:       m.price,
                active:      m.active !== false,
            },
        });
        // Size-pricing per drives_pricing group keyed in m.price_by_size.
        // Outer key is the parent group's NAME — translate to id at emit time.
        const pbs = m.price_by_size || {};
        Object.keys(pbs).forEach(groupName => {
            const gid = modGroupIdByName.get(groupName);
            if (!gid) return;
            events.push({
                event_type: 'modifier.size_pricing_set',
                payload: {
                    modifier_id: mid,
                    group_id:    gid,
                    size_prices: pbs[groupName] || {},
                },
            });
        });
    });

    /* ── 7. micromod.created + micromod.assigned_to_modifier ────── */
    (data.micromod_groups || []).forEach(mg => {
        (mg.micromod_names || []).forEach(mmName => {
            const mmid = _slugify(mmName);
            events.push({
                event_type: 'micromod.created',
                payload: {
                    micromod_id: mmid,
                    name:        mmName,
                    price:       '0.00',
                    active:      mg.active !== false,
                },
            });
            (mg.attaches_to || []).forEach(modName => {
                const modId = modifierIdByName.get(modName);
                if (!modId) return;
                events.push({
                    event_type: 'micromod.assigned_to_modifier',
                    payload: { micromod_id: mmid, modifier_id: modId },
                });
            });
        });
    });

    /* ── 8. menu.category_created ───────────────────────────────── */
    (data.categories || []).forEach((cat, i) => {
        const catId = _slugifyDash(cat.name);
        const universalIds = (cat.optional_groups || [])
            .map(n => modGroupIdByName.get(n))
            .filter(Boolean);
        events.push({
            event_type: 'menu.category_created',
            payload: {
                category_id:         catId,
                name:                cat.name,
                display_order:       cat.display_order || i + 1,
                color:               cat.color || '',
                tax_rule:            cat.tax_rule || '',
                enable_placement:    !!cat.enable_placement,
                universal_group_ids: universalIds,
                active:              cat.active !== false,
            },
        });
    });

    /* ── 9. menu.item_created + per-field events ────────────────── */
    (data.items || []).forEach((item, i) => {
        const itemId = _slugify(item.name) || `import_item_${i}`;
        const catId  = _slugifyDash(item.category);
        const includedIds = (item.included_mods || [])
            .map(n => modifierIdByName.get(n))
            .filter(Boolean);
        const mandatoryIds = (item.mandatory_groups || [])
            .map(n => modGroupIdByName.get(n))
            .filter(Boolean);

        events.push({
            event_type: 'menu.item_created',
            payload: {
                item_id:               itemId,
                name:                  item.name,
                price:                 item.price,
                category_id:           catId || item.category || '',
                description:           item.description || '',
                included_modifier_ids: includedIds,
                mandatory_group_ids:   mandatoryIds,
                tax_rule:              item.tax_rule || '',
                sku:                   item.sku || '',
                prep_time:             item.prep_time || 0,
                allergens:             item.allergens || [],
                notes:                 item.notes || '',
                active:                item.active !== false,
                display_order:         i + 1,
            },
        });

        // 9a. Item base size pricing — keyed by mod-group NAME.
        const pbs = item.price_by_size || {};
        Object.keys(pbs).forEach(groupName => {
            const gid = modGroupIdByName.get(groupName);
            if (!gid) return;
            events.push({
                event_type: 'menu.item_size_pricing_set',
                payload: { item_id: itemId, group_id: gid, size_prices: pbs[groupName] || {} },
            });
        });

        // 9b. Per-item option group override.
        const ogo = item.option_group_overrides || {};
        Object.keys(ogo).forEach(groupName => {
            const gid  = modGroupIdByName.get(groupName);
            const ogid = optionGroupIdByName.get(ogo[groupName]);
            if (!gid || !ogid) return;
            events.push({
                event_type: 'menu.item_option_group_override_set',
                payload: { item_id: itemId, group_id: gid, option_group_id: ogid },
            });
        });

        // 9c. Per-item size price overrides — one event per (group, size).
        const spo = item.size_price_overrides || {};
        Object.keys(spo).forEach(groupName => {
            const gid = modGroupIdByName.get(groupName);
            if (!gid) return;
            const sizeMap = spo[groupName] || {};
            Object.keys(sizeMap).forEach(sizeName => {
                events.push({
                    event_type: 'menu.item_size_price_override_set',
                    payload: {
                        item_id:    itemId,
                        group_id:   gid,
                        size_name:  sizeName,
                        price:      sizeMap[sizeName],
                    },
                });
            });
        });
    });

    /* ── 10. Tax rules + discounts ──────────────────────────────── */
    (data.tax_rules || []).forEach((rule, i) => {
        events.push({
            event_type: 'store.tax_rule_created',
            payload: {
                tax_rule_id: _slugify(rule.name) || `tax_rule_${i}`,
                name:        rule.name,
                rate:        rule.rate,
                dine_in:     rule.dine_in !== false,
                takeout:     rule.takeout !== false,
                delivery:    rule.delivery !== false,
            },
        });
    });

    (data.discounts || []).forEach((d, i) => {
        events.push({
            event_type: 'discount.created',
            payload: {
                discount_id:       _slugify(d.name) || `discount_${i}`,
                name:              d.name,
                type:              d.type,
                amount:            d.amount,
                schedule:          d.schedule || 'Always',
                applies_to:        d.applies_to || 'Entire Check',
                restrictions:      d.restrictions || '',
                requires_approval: !!d.requires_approval,
                reason_code:       d.reason_code || '',
                active:            d.active !== false,
            },
        });
    });

    return events;
}

/* ------------------------------------------
   VIEW REGISTRY + NAVIGATION
   Unchanged.
------------------------------------------ */
const VIEW_REGISTRY = {
    'file-select':  buildFileSelect,
    'parsing':      buildParsing,
    'preview':      buildPreview,
    'success':      buildSuccess,
    'error':        buildError,
};

function pushView(viewName, data) {
    if (!currentWrapper) return;

    currentWrapper.innerHTML = '';
    viewHistory.push({ name: viewName, data: data });

    const builder = VIEW_REGISTRY[viewName];
    if (builder) {
        builder(currentWrapper, data);
    } else {
        buildComingSoon(currentWrapper, viewName);
    }

    currentWrapper.scrollTop = 0;
}

function popView() {
    if (viewHistory.length <= 1) return;

    viewHistory.pop();
    const prev = viewHistory[viewHistory.length - 1];
    viewHistory.pop();

    pushView(prev.name, prev.data);
}

/* ------------------------------------------
   BACK BUTTON
   Small ghost pill. Matches tertiary variant
   but with a left arrow caret.
------------------------------------------ */
function buildBackButton(container, label) {
    const btn = buildPillButton(`← Back to ${label}`, 'tertiary', () => popView());
    btn.style.fontSize = '12px';
    btn.style.padding = '8px 18px';
    btn.style.marginBottom = '20px';
    btn.style.letterSpacing = '0.1em';
    // Inline-flex so it doesn't block-fill the wrapper
    btn.style.display = 'inline-flex';
    container.appendChild(btn);
}

/* ------------------------------------------
   COMING SOON PLACEHOLDER
------------------------------------------ */
function buildComingSoon(container, viewName) {
    buildBackButton(container, 'File Select');

    const displayName = viewName
        .split('-')
        .map(word => word.charAt(0).toUpperCase() + word.slice(1))
        .join(' ');

    const card = buildCard(C.gold, { padding: '60px 40px' });
    card.style.textAlign = 'center';

    const title = document.createElement('div');
    title.style.cssText = `font-size: 32px; font-weight: 700; color: ${C.gold}; margin-bottom: 12px;`;
    title.textContent = displayName;

    const sub = document.createElement('div');
    sub.style.cssText = `font-size: 14px; color: ${C.textMuted}; font-family: ui-monospace, monospace;`;
    sub.textContent = 'Coming soon — this step is next in the build queue.';

    card.appendChild(title);
    card.appendChild(sub);
    container.appendChild(card);
}

/* ==========================================
   FILE SELECT VIEW (default)

   Dashed-border drop zone on a dark surface.
   Tap opens native picker, drag-drop works
   as a bonus.
   ========================================== */
function buildFileSelect(wrapper) {
    // --- Scene title row (matches home.js pattern) ---
    const titleRow = document.createElement('div');
    titleRow.style.cssText = `margin-bottom: 28px;`;

    const title = document.createElement('div');
    title.style.cssText = `font-size: 34px; font-weight: 700; color: ${C.text}; margin-bottom: 6px;`;
    title.textContent = 'Import Menu Template';

    const subtitle = document.createElement('div');
    subtitle.style.cssText = `
        font-size: 12px; letter-spacing: 2px; color: ${C.textMuted};
        font-family: ui-monospace, monospace; text-transform: uppercase;
    `;
    subtitle.textContent = 'Select your completed KINDpos menu template file';

    titleRow.appendChild(title);
    titleRow.appendChild(subtitle);
    wrapper.appendChild(titleRow);

    // Divider
    const divider = document.createElement('div');
    divider.style.cssText = `border-bottom: 1px solid ${C.well}; margin-bottom: 24px;`;
    wrapper.appendChild(divider);

    // --- Hidden file input ---
    const fileInput = document.createElement('input');
    fileInput.type = 'file';
    fileInput.accept = '.xlsx,.xls';
    fileInput.style.display = 'none';
    fileInput.id = 'menu-file-input';
    wrapper.appendChild(fileInput);

    // --- Drop zone ---
    const dropZone = document.createElement('div');
    dropZone.style.cssText = `
        background: ${C.card};
        border: 3px dashed rgba(134, 239, 172, 0.35);
        border-radius: 10px;
        padding: 56px 40px;
        text-align: center;
        cursor: pointer;
        transition: border-color 0.2s ease, background 0.2s ease;
        max-width: 640px;
        margin: 0 auto 24px auto;
    `;

    const dzIcon = document.createElement('div');
    dzIcon.style.cssText = `font-size: 44px; margin-bottom: 16px; line-height: 1;`;
    dzIcon.textContent = '📄';

    const dzText = document.createElement('div');
    dzText.style.cssText = `
        font-size: 16px;
        color: ${C.text};
        margin-bottom: 8px;
        font-weight: 500;
    `;
    dzText.textContent = 'Click to browse or drag & drop your file here';

    const dzFormats = document.createElement('div');
    dzFormats.style.cssText = `
        font-size: 11px;
        letter-spacing: 2px;
        text-transform: uppercase;
        color: ${C.textDim};
        font-family: ui-monospace, monospace;
    `;
    dzFormats.textContent = 'Supported · .xlsx · .xls';

    // Selected file chip (hidden initially)
    const dzSelected = document.createElement('div');
    dzSelected.style.cssText = `
        display: none;
        margin-top: 20px;
        padding: 10px 18px;
        background: ${C.well};
        border-radius: 6px;
        font-size: 14px;
        color: ${C.gold};
        font-family: ui-monospace, monospace;
        display: none;
    `;
    dzSelected.id = 'selected-file-name';

    dropZone.appendChild(dzIcon);
    dropZone.appendChild(dzText);
    dropZone.appendChild(dzFormats);
    dropZone.appendChild(dzSelected);
    wrapper.appendChild(dropZone);

    // --- Import button (hidden until file selected) ---
    const importBtn = buildPillButton('Import Template →', 'primary', () => {
        if (selectedFile) pushView('parsing');
    });
    importBtn.style.display = 'none';
    importBtn.style.margin = '0 auto';
    importBtn.id = 'import-btn';

    const btnRow = document.createElement('div');
    btnRow.style.cssText = `display: flex; justify-content: center;`;
    btnRow.appendChild(importBtn);
    wrapper.appendChild(btnRow);

    // --- Format note ---
    const note = document.createElement('div');
    note.style.cssText = `
        text-align: center;
        margin-top: 28px;
        font-size: 11px;
        letter-spacing: 2px;
        text-transform: uppercase;
        color: ${C.textDim};
        font-family: ui-monospace, monospace;
    `;
    note.textContent = 'Use the KINDpos Excel template for best results';
    wrapper.appendChild(note);

    // --- Event Handlers ---

    dropZone.addEventListener('click', () => {
        fileInput.click();
    });

    fileInput.addEventListener('change', (e) => {
        if (e.target.files && e.target.files.length > 0) {
            handleFileSelected(e.target.files[0], dzSelected, importBtn, dzText, dzIcon);
        }
    });

    dropZone.addEventListener('dragover', (e) => {
        e.preventDefault();
        dropZone.style.borderColor = 'rgba(245, 166, 35, 0.55)';
        dropZone.style.background = 'rgba(245, 166, 35, 0.04)';
    });

    dropZone.addEventListener('dragleave', (e) => {
        e.preventDefault();
        dropZone.style.borderColor = 'rgba(134, 239, 172, 0.35)';
        dropZone.style.background = C.card;
    });

    dropZone.addEventListener('drop', (e) => {
        e.preventDefault();
        dropZone.style.borderColor = 'rgba(134, 239, 172, 0.35)';
        dropZone.style.background = C.card;

        if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
            const file = e.dataTransfer.files[0];
            const ext = file.name.split('.').pop().toLowerCase();
            if (ext === 'xlsx' || ext === 'xls') {
                handleFileSelected(file, dzSelected, importBtn, dzText, dzIcon);
            } else {
                dzText.textContent = 'Please select an .xlsx or .xls file';
                dzText.style.color = C.verm;
                setTimeout(() => {
                    dzText.textContent = 'Click to browse or drag & drop your file here';
                    dzText.style.color = C.text;
                }, 2000);
            }
        }
    });
}

/**
 * Handle file selected. Swap drop zone to "ready" state.
 */
function handleFileSelected(file, dzSelected, importBtn, dzText, dzIcon) {
    selectedFile = file;

    dzIcon.textContent = '✓';
    dzIcon.style.color = C.greenUp;
    dzText.textContent = 'File selected — ready to import';
    dzText.style.color = C.greenUp;

    dzSelected.textContent = file.name;
    dzSelected.style.display = 'inline-block';

    importBtn.style.display = 'inline-flex';
}

/* ==========================================
   PARSING VIEW
   Animated step card. Gold accent while
   working, greenUp on complete, verm on error.
   ========================================== */
function buildParsing(wrapper) {
    // --- Header ---
    const headerWrap = document.createElement('div');
    headerWrap.style.cssText = `text-align: center; margin-bottom: 28px;`;

    const header = document.createElement('div');
    header.style.cssText = `
        font-size: 28px;
        font-weight: 700;
        color: ${C.gold};
        margin-bottom: 8px;
    `;
    header.textContent = 'Processing Template…';

    const fileName = document.createElement('div');
    fileName.style.cssText = `
        font-size: 12px;
        letter-spacing: 2px;
        text-transform: uppercase;
        color: ${C.textMuted};
        font-family: ui-monospace, monospace;
    `;
    fileName.textContent = selectedFile ? `File · ${selectedFile.name}` : '';

    headerWrap.appendChild(header);
    headerWrap.appendChild(fileName);
    wrapper.appendChild(headerWrap);

    // --- Steps card ---
    const stepsCard = buildCard(C.gold, { padding: '24px 28px' });
    stepsCard.style.maxWidth = '520px';
    stepsCard.style.margin = '0 auto';

    const stepsLabel = buildLabel('Progress', { size: '12px', color: C.textDim, margin: 'margin-bottom: 14px' });
    stepsCard.appendChild(stepsLabel);

    const steps = [
        'Reading file',
        'Validating restaurant info',
        'Processing tax rules',
        'Loading categories',
        'Importing menu items',
        'Checking discounts',
    ];

    const stepElements = [];
    steps.forEach(stepText => {
        const step = document.createElement('div');
        step.style.cssText = `
            display: flex;
            align-items: center;
            gap: 10px;
            font-size: 14px;
            color: ${C.textDim};
            padding: 6px 0;
            font-family: ui-monospace, monospace;
        `;

        const icon = document.createElement('span');
        icon.style.cssText = `
            width: 18px;
            text-align: center;
            color: ${C.textDim};
        `;
        icon.textContent = '○';

        const text = document.createElement('span');
        text.textContent = stepText;

        step.appendChild(icon);
        step.appendChild(text);
        step._icon = icon;
        step._text = text;
        stepsCard.appendChild(step);
        stepElements.push(step);
    });

    wrapper.appendChild(stepsCard);

    // --- Error path: SheetJS missing ---
    if (!selectedFile) {
        header.textContent = 'No file selected';
        header.style.color = C.verm;
        return;
    }

    if (typeof XLSX === 'undefined') {
        header.textContent = 'SheetJS library not loaded';
        header.style.color = C.verm;

        const hint = document.createElement('div');
        hint.style.cssText = `
            font-size: 13px;
            color: ${C.textMuted};
            margin-top: 16px;
            font-family: ui-monospace, monospace;
            text-align: center;
        `;
        hint.textContent = 'Add xlsx.mini.min.js to assets/js/ and load it in index.html';
        wrapper.appendChild(hint);

        const backRow = document.createElement('div');
        backRow.style.cssText = `display: flex; justify-content: center; margin-top: 24px;`;
        backRow.appendChild(buildPillButton('← Back to File Select', 'tertiary', () => popView()));
        wrapper.appendChild(backRow);
        return;
    }

    // --- Animate steps, then parse ---
    animateSteps(stepElements, header).then(() => {
        return parseMenuTemplate(selectedFile);
    }).then(result => {
        parsedData = result.data;
        parseErrors = result.errors;
        parseWarnings = result.warnings;

        if (result.success) {
            const summary = getSummary(result.data);
            console.log(`[MenuImport] ✓ Parsed: ${summary.restaurant_name} — ${summary.categories_count} categories, ${summary.items_count} items`);
            pushView('preview');
        } else {
            console.warn('[MenuImport] Parse errors:', result.errors);
            pushView('error');
        }
    }).catch(err => {
        console.error('[MenuImport] Unexpected error:', err);
        parseErrors = [`Unexpected error: ${err.message}`];
        pushView('error');
    });
}

/**
 * Animate progress steps. Each step ticks greenUp before the next starts.
 */
function animateSteps(stepElements, header) {
    return new Promise(resolve => {
        let i = 0;
        const interval = setInterval(() => {
            if (i < stepElements.length) {
                const step = stepElements[i];
                step._icon.textContent = '✓';
                step._icon.style.color = C.greenUp;
                step._text.style.color = C.text;
                i++;
            } else {
                clearInterval(interval);
                header.textContent = 'Parsing complete';
                header.style.color = C.greenUp;
                setTimeout(resolve, 300);
            }
        }, 150);
    });
}

/* ==========================================
   PREVIEW VIEW
   Stats row of 4 small Nostalgia cards, then
   collapsible section cards for each data
   group. Confirm button at bottom.
   ========================================== */
function buildPreview(wrapper) {
    if (!parsedData) {
        buildComingSoon(wrapper, 'preview');
        return;
    }

    const data = parsedData;
    const summary = getSummary(data);

    // --- Back button ---
    const backBtn = buildPillButton('← Back to File Select', 'tertiary', () => {
        selectedFile = null;
        parsedData = null;
        parseErrors = [];
        parseWarnings = [];
        viewHistory = [];
        pushView('file-select');
    });
    backBtn.style.fontSize = '12px';
    backBtn.style.padding = '8px 18px';
    backBtn.style.marginBottom = '20px';
    backBtn.style.display = 'inline-flex';
    wrapper.appendChild(backBtn);

    // --- Title row ---
    const titleRow = document.createElement('div');
    titleRow.style.cssText = `margin-bottom: 24px;`;

    const title = document.createElement('div');
    title.style.cssText = `font-size: 34px; font-weight: 700; color: ${C.text}; margin-bottom: 6px;`;
    title.textContent = 'Import Preview';

    const restName = document.createElement('div');
    restName.style.cssText = `
        font-size: 16px;
        color: ${C.gold};
        font-family: ui-monospace, monospace;
        letter-spacing: 0.5px;
    `;
    restName.textContent = summary.restaurant_name;

    titleRow.appendChild(title);
    titleRow.appendChild(restName);
    wrapper.appendChild(titleRow);

    // Divider
    const divider = document.createElement('div');
    divider.style.cssText = `border-bottom: 1px solid ${C.well}; margin-bottom: 24px;`;
    wrapper.appendChild(divider);

    // --- Summary stats cards (4-wide grid) ---
    const statsBar = document.createElement('div');
    statsBar.style.cssText = `
        display: grid;
        grid-template-columns: repeat(4, 1fr);
        gap: 14px;
        margin-bottom: 28px;
    `;

    const statItems = [
        { label: 'Categories', count: summary.categories_count, accent: C.cyan },
        { label: 'Items',      count: summary.items_count,      accent: C.gold },
        { label: 'Tax Rules',  count: summary.tax_rules_count,  accent: C.lavender },
        { label: 'Discounts',  count: summary.discounts_count,  accent: C.greenUp },
    ];

    statItems.forEach(stat => {
        const card = buildCard(stat.accent, { padding: '16px 18px' });
        const label = buildLabel(stat.label, { size: '12px', color: C.textMuted, margin: 'margin-bottom: 8px' });
        const num = document.createElement('div');
        num.style.cssText = `
            font-size: 36px;
            font-weight: 700;
            color: ${stat.accent};
            line-height: 1;
        `;
        num.textContent = stat.count;
        card.appendChild(label);
        card.appendChild(num);
        statsBar.appendChild(card);
    });
    wrapper.appendChild(statsBar);

    // --- Collapsible sections ---

    // Restaurant Info (open by default, green accent)
    buildCollapsibleSection(wrapper, 'Restaurant Info', C.green, true, (content) => {
        const info = data.restaurant_info || {};
        const fields = [
            ['Restaurant Name', info['Restaurant Name']],
            ['Address',         info['Address']],
            ['City / State / ZIP', `${info['City'] || ''}, ${info['State'] || ''} ${info['ZIP Code'] || ''}`],
            ['Phone',           info['Phone']],
            ['Email',           info['Email']],
            ['Website',         info['Website']],
            ['Restaurant Type', info['Restaurant Type']],
            ['Serves Alcohol',  info['Serves Alcohol']],
        ];
        fields.forEach(([label, value]) => {
            if (value && value.trim && value.trim() && value.trim() !== ',') {
                const row = document.createElement('div');
                row.style.cssText = `
                    display: flex;
                    padding: 8px 0;
                    border-bottom: 1px solid ${C.well};
                    font-size: 14px;
                    font-family: ui-monospace, monospace;
                `;
                const labelEl = document.createElement('span');
                labelEl.style.cssText = `color: ${C.textMuted}; min-width: 180px;`;
                labelEl.textContent = label;

                const valueEl = document.createElement('span');
                valueEl.style.cssText = `color: ${C.text}; flex: 1;`;
                valueEl.textContent = value;

                row.appendChild(labelEl);
                row.appendChild(valueEl);
                content.appendChild(row);
            }
        });
    });

    // Tax Rules (lavender accent)
    buildCollapsibleSection(wrapper, `Tax Rules · ${(data.tax_rules || []).length}`, C.lavender, false, (content) => {
        const rules = data.tax_rules || [];
        if (rules.length === 0) {
            appendEmpty(content, 'No tax rules defined');
            return;
        }
        rules.forEach(tax => {
            const flags = [];
            if (tax.dine_in)  flags.push('Dine-In');
            if (tax.takeout)  flags.push('Takeout');
            if (tax.delivery) flags.push('Delivery');

            const row = document.createElement('div');
            row.style.cssText = `
                display: flex;
                align-items: center;
                gap: 12px;
                padding: 9px 0;
                border-bottom: 1px solid ${C.well};
                font-size: 14px;
                font-family: ui-monospace, monospace;
            `;
            const name = document.createElement('span');
            name.style.cssText = `color: ${C.text}; flex: 1;`;
            name.textContent = tax.name;

            const rate = document.createElement('span');
            rate.style.cssText = `color: ${C.gold}; font-weight: 700; min-width: 60px; text-align: right;`;
            rate.textContent = `${tax.rate}%`;

            const appliesTo = document.createElement('span');
            appliesTo.style.cssText = `color: ${C.textMuted}; min-width: 180px; text-align: right; font-size: 12px;`;
            appliesTo.textContent = flags.join(' · ');

            row.appendChild(name);
            row.appendChild(rate);
            row.appendChild(appliesTo);
            content.appendChild(row);
        });
    });

    // Categories (cyan accent)
    buildCollapsibleSection(wrapper, `Categories · ${(data.categories || []).length}`, C.cyan, false, (content) => {
        const cats = data.categories || [];
        if (cats.length === 0) {
            appendEmpty(content, 'No categories defined');
            return;
        }
        cats.forEach(cat => {
            const row = document.createElement('div');
            row.style.cssText = `
                display: flex;
                align-items: center;
                gap: 12px;
                padding: 9px 0;
                border-bottom: 1px solid ${C.well};
                font-size: 14px;
                font-family: ui-monospace, monospace;
            `;
            const swatch = document.createElement('span');
            swatch.style.cssText = `
                width: 16px; height: 16px;
                border-radius: 3px;
                background: ${cat.color};
                flex-shrink: 0;
            `;

            const name = document.createElement('span');
            name.style.cssText = `color: ${C.text}; flex: 1;`;
            name.textContent = cat.name;

            const order = document.createElement('span');
            order.style.cssText = `color: ${C.textDim}; font-size: 12px;`;
            order.textContent = `#${cat.display_order}`;

            const taxCat = document.createElement('span');
            taxCat.style.cssText = `color: ${C.textMuted}; font-size: 12px;`;
            taxCat.textContent = cat.tax_category || '';

            const active = document.createElement('span');
            active.style.cssText = `
                color: ${cat.active ? C.greenUp : C.verm};
                font-size: 14px;
                min-width: 16px;
                text-align: center;
            `;
            active.textContent = cat.active ? '✓' : '✗';

            row.appendChild(swatch);
            row.appendChild(name);
            row.appendChild(order);
            row.appendChild(taxCat);
            row.appendChild(active);
            content.appendChild(row);
        });
    });

    // Menu Items (gold accent, grouped by category)
    buildCollapsibleSection(wrapper, `Menu Items · ${(data.items || []).length}`, C.gold, false, (content) => {
        const items = data.items || [];
        if (items.length === 0) {
            appendEmpty(content, 'No items defined');
            return;
        }

        const grouped = {};
        items.forEach(item => {
            const cat = item.category || 'Uncategorized';
            if (!grouped[cat]) grouped[cat] = [];
            grouped[cat].push(item);
        });

        Object.keys(grouped).forEach(catName => {
            const catItems = grouped[catName];

            const catHeading = document.createElement('div');
            catHeading.style.cssText = `
                font-size: 12px;
                letter-spacing: 2px;
                text-transform: uppercase;
                font-weight: 700;
                color: ${C.gold};
                margin: 18px 0 6px 0;
                padding-bottom: 6px;
                border-bottom: 1px solid ${C.well};
                font-family: ui-monospace, monospace;
            `;
            catHeading.textContent = `${catName} · ${catItems.length} items`;
            content.appendChild(catHeading);

            const showCount = 5;
            const displayed = catItems.slice(0, showCount);

            displayed.forEach(item => {
                const row = document.createElement('div');
                row.style.cssText = `
                    display: flex;
                    align-items: center;
                    gap: 12px;
                    padding: 6px 0;
                    font-size: 14px;
                    font-family: ui-monospace, monospace;
                `;
                const priceStr = '$' + item.price.toFixed(2);

                const name = document.createElement('span');
                name.style.cssText = `color: ${C.text}; flex: 1;`;
                name.textContent = item.name;

                const price = document.createElement('span');
                price.style.cssText = `color: ${C.gold}; font-weight: 700; min-width: 70px; text-align: right;`;
                price.textContent = priceStr;

                if (item.description) row.title = item.description;

                row.appendChild(name);
                row.appendChild(price);
                content.appendChild(row);
            });

            if (catItems.length > showCount) {
                const more = document.createElement('div');
                more.style.cssText = `
                    font-size: 12px;
                    color: ${C.textDim};
                    padding: 6px 0 4px 0;
                    font-style: italic;
                    font-family: ui-monospace, monospace;
                `;
                more.textContent = `…and ${catItems.length - showCount} more`;
                content.appendChild(more);
            }
        });
    });

    // Discounts (greenUp accent)
    buildCollapsibleSection(wrapper, `Discounts · ${(data.discounts || []).length}`, C.greenUp, false, (content) => {
        const discounts = data.discounts || [];
        if (discounts.length === 0) {
            appendEmpty(content, 'No discounts defined');
            return;
        }
        discounts.forEach(disc => {
            const amountStr = disc.type === 'Percentage'
                ? `${disc.amount}% off`
                : `$${disc.amount.toFixed(2)} off`;

            const row = document.createElement('div');
            row.style.cssText = `
                display: flex;
                align-items: center;
                gap: 12px;
                padding: 9px 0;
                border-bottom: 1px solid ${C.well};
                font-size: 14px;
                font-family: ui-monospace, monospace;
            `;

            const name = document.createElement('span');
            name.style.cssText = `color: ${C.text}; flex: 1;`;
            name.textContent = disc.name;

            const amount = document.createElement('span');
            amount.style.cssText = `color: ${C.gold}; font-weight: 700; min-width: 90px; text-align: right;`;
            amount.textContent = amountStr;

            const schedule = document.createElement('span');
            schedule.style.cssText = `color: ${C.textMuted}; min-width: 100px; text-align: right; font-size: 12px;`;
            schedule.textContent = disc.schedule || '';

            row.appendChild(name);
            row.appendChild(amount);
            row.appendChild(schedule);

            if (disc.requires_approval) {
                const lock = document.createElement('span');
                lock.style.cssText = `color: ${C.warning}; font-size: 12px; margin-left: 8px;`;
                lock.textContent = '🔒 Approval';
                row.appendChild(lock);
            }

            content.appendChild(row);
        });
    });

    // --- Warnings card (if any) ---
    if (parseWarnings.length > 0) {
        const warnCard = buildCard(C.warning, {
            padding: '16px 20px',
            cssText: 'background: rgba(251, 191, 36, 0.05); margin-top: 16px;'
        });
        const warnHeading = buildLabel(`Warnings · ${parseWarnings.length}`, {
            size: '12px', color: C.warning, margin: 'margin-bottom: 10px'
        });
        warnCard.appendChild(warnHeading);
        parseWarnings.forEach(warn => {
            const line = document.createElement('div');
            line.style.cssText = `
                font-size: 13px;
                color: ${C.textMuted};
                padding: 3px 0;
                font-family: ui-monospace, monospace;
            `;
            line.textContent = `⚠ ${warn}`;
            warnCard.appendChild(line);
        });
        wrapper.appendChild(warnCard);
    }

    // --- Confirm Import button ---
    const confirmRow = document.createElement('div');
    confirmRow.style.cssText = `display: flex; justify-content: center; margin-top: 32px;`;

    const confirmBtn = buildPillButton('Confirm Import →', 'confirm', null);
    confirmBtn.addEventListener('click', async () => {
        confirmBtn.disabled = true;
        confirmBtn.textContent = 'IMPORTING…';
        confirmBtn.style.opacity = '0.7';
        confirmBtn.style.cursor = 'wait';

        const events = convertParsedDataToEvents(parsedData);
        const result = await pushChanges(events);

        if (result.ok) {
            pushView('success');
        } else {
            confirmBtn.disabled = false;
            confirmBtn.textContent = 'Confirm Import →';
            confirmBtn.style.opacity = '1';
            confirmBtn.style.cursor = 'pointer';
            showToast('Import failed — try again', 'error');
        }
    });
    confirmRow.appendChild(confirmBtn);
    wrapper.appendChild(confirmRow);

    // --- Ready-to-import note ---
    const readyNote = document.createElement('div');
    readyNote.style.cssText = `
        text-align: center;
        margin-top: 12px;
        font-size: 11px;
        letter-spacing: 2px;
        text-transform: uppercase;
        color: ${C.textDim};
        font-family: ui-monospace, monospace;
    `;
    readyNote.textContent = `Ready · ${summary.categories_count} cats · ${summary.items_count} items · ${summary.tax_rules_count} tax · ${summary.discounts_count} disc`;
    wrapper.appendChild(readyNote);
}

/** Helper: empty-state placeholder inside a section. */
function appendEmpty(content, msg) {
    const empty = document.createElement('div');
    empty.style.cssText = `
        color: ${C.textDim};
        font-size: 13px;
        font-family: ui-monospace, monospace;
        padding: 8px 0;
    `;
    empty.textContent = msg;
    content.appendChild(empty);
}

/* ------------------------------------------
   COLLAPSIBLE SECTION BUILDER
   Reskinned as a Nostalgia card — header is
   the first row of the card, content expands
   below it.
------------------------------------------ */
function buildCollapsibleSection(wrapper, title, accent, startOpen, contentBuilder) {
    const card = buildCard(accent, {
        padding: '0',
        margin: '0 0 12px 0'
    });
    card.style.overflow = 'hidden';

    // Header (tappable)
    const header = document.createElement('button');
    header.style.cssText = `
        display: flex;
        align-items: center;
        gap: 10px;
        width: 100%;
        padding: 14px 18px;
        background: transparent;
        border: none;
        color: ${C.text};
        font-size: 13px;
        font-weight: 700;
        letter-spacing: 2px;
        text-transform: uppercase;
        font-family: ui-monospace, monospace;
        cursor: pointer;
        transition: background 0.15s ease;
        text-align: left;
    `;

    const arrow = document.createElement('span');
    arrow.style.cssText = `
        font-size: 11px;
        transition: transform 0.2s ease;
        display: inline-block;
        color: ${accent};
        width: 12px;
    `;
    arrow.textContent = '▶';
    if (startOpen) arrow.style.transform = 'rotate(90deg)';

    const titleSpan = document.createElement('span');
    titleSpan.style.cssText = `flex: 1;`;
    titleSpan.textContent = title;

    header.appendChild(arrow);
    header.appendChild(titleSpan);

    header.addEventListener('mouseenter', () => {
        header.style.background = 'rgba(232, 234, 237, 0.03)';
    });
    header.addEventListener('mouseleave', () => {
        header.style.background = 'transparent';
    });

    // Content
    const content = document.createElement('div');
    content.style.cssText = `
        padding: 6px 18px 18px 18px;
        display: ${startOpen ? 'block' : 'none'};
        border-top: ${startOpen ? `1px solid ${C.well}` : 'none'};
    `;
    contentBuilder(content);

    header.addEventListener('click', () => {
        const isOpen = content.style.display !== 'none';
        content.style.display = isOpen ? 'none' : 'block';
        content.style.borderTop = isOpen ? 'none' : `1px solid ${C.well}`;
        arrow.style.transform = isOpen ? 'rotate(0deg)' : 'rotate(90deg)';
    });

    card.appendChild(header);
    card.appendChild(content);
    wrapper.appendChild(card);
}

/* ==========================================
   SUCCESS VIEW
   ========================================== */
function buildSuccess(wrapper) {
    if (!parsedData) {
        buildComingSoon(wrapper, 'success');
        return;
    }

    const data = parsedData;
    const summary = getSummary(data);

    const eventCount = 1
        + (data.tax_rules || []).length
        + (data.categories || []).length
        + (data.items || []).length
        + (data.discounts || []).length
        + 1;

    // --- Checkmark + title ---
    const header = document.createElement('div');
    header.style.cssText = `text-align: center; margin-bottom: 28px; padding-top: 20px;`;

    const check = document.createElement('div');
    check.style.cssText = `
        font-size: 64px;
        color: ${C.greenUp};
        line-height: 1;
        margin-bottom: 12px;
        text-shadow: 0 0 24px rgba(74, 222, 128, 0.35);
    `;
    check.textContent = '✓';

    const title = document.createElement('div');
    title.style.cssText = `
        font-size: 34px;
        font-weight: 700;
        color: ${C.text};
        margin-bottom: 6px;
    `;
    title.textContent = 'Import Successful';

    const restName = document.createElement('div');
    restName.style.cssText = `
        font-size: 14px;
        color: ${C.gold};
        font-family: ui-monospace, monospace;
        letter-spacing: 0.5px;
    `;
    restName.textContent = summary.restaurant_name;

    header.appendChild(check);
    header.appendChild(title);
    header.appendChild(restName);
    wrapper.appendChild(header);

    // --- Stats cards (4-wide grid) ---
    const statsBar = document.createElement('div');
    statsBar.style.cssText = `
        display: grid;
        grid-template-columns: repeat(4, 1fr);
        gap: 14px;
        margin-bottom: 24px;
    `;

    const statItems = [
        { label: 'Categories', count: summary.categories_count, accent: C.cyan },
        { label: 'Items',      count: summary.items_count,      accent: C.gold },
        { label: 'Tax Rules',  count: summary.tax_rules_count,  accent: C.lavender },
        { label: 'Discounts',  count: summary.discounts_count,  accent: C.greenUp },
    ];

    statItems.forEach(stat => {
        const card = buildCard(stat.accent, { padding: '16px 18px' });
        const label = buildLabel(stat.label, { size: '12px', color: C.textMuted, margin: 'margin-bottom: 8px' });
        const num = document.createElement('div');
        num.style.cssText = `
            font-size: 36px;
            font-weight: 700;
            color: ${stat.accent};
            line-height: 1;
        `;
        num.textContent = stat.count;
        card.appendChild(label);
        card.appendChild(num);
        statsBar.appendChild(card);
    });
    wrapper.appendChild(statsBar);

    // --- Events generated card ---
    const eventCard = buildCard(C.gold, { padding: '20px 24px' });
    eventCard.style.textAlign = 'center';
    eventCard.style.marginBottom = '16px';

    const eventLabel = buildLabel('Events Generated', {
        size: '12px', color: C.textMuted, margin: 'margin-bottom: 8px'
    });
    const eventNum = document.createElement('div');
    eventNum.style.cssText = `
        font-size: 44px;
        font-weight: 700;
        color: ${C.gold};
        line-height: 1;
        margin-bottom: 6px;
    `;
    eventNum.textContent = eventCount;

    const eventSub = document.createElement('div');
    eventSub.style.cssText = `
        font-size: 12px;
        letter-spacing: 2px;
        text-transform: uppercase;
        color: ${C.textDim};
        font-family: ui-monospace, monospace;
    `;
    eventSub.textContent = 'Ready for the event ledger';

    eventCard.appendChild(eventLabel);
    eventCard.appendChild(eventNum);
    eventCard.appendChild(eventSub);
    wrapper.appendChild(eventCard);

    // --- What's next card ---
    const nextCard = buildCard(C.lavender, { padding: '16px 20px' });
    nextCard.style.marginBottom = '32px';

    const nextLabel = buildLabel("What's Next", {
        size: '12px', color: C.lavender, margin: 'margin-bottom: 8px'
    });
    const nextBody = document.createElement('div');
    nextBody.style.cssText = `
        font-size: 13px;
        color: ${C.textMuted};
        line-height: 1.6;
        font-family: ui-monospace, monospace;
    `;
    nextBody.innerHTML = `
        Events will be written to the local event ledger<br>
        and synced to your terminals automatically.
    `;
    nextCard.appendChild(nextLabel);
    nextCard.appendChild(nextBody);
    wrapper.appendChild(nextCard);

    // --- Action buttons ---
    const buttonRow = document.createElement('div');
    buttonRow.style.cssText = `
        display: flex;
        gap: 14px;
        justify-content: center;
        flex-wrap: wrap;
    `;

    // Primary
    const editBtn = buildPillButton('Edit Menu Now →', 'primary', () => {
        if (window._sm) window._sm.navigateTo('menu-categories');
    });

    // Secondary
    const anotherBtn = buildPillButton('Import Another', 'secondary', () => {
        selectedFile = null;
        parsedData = null;
        parseErrors = [];
        parseWarnings = [];
        viewHistory = [];
        pushView('file-select');
    });

    // Tertiary
    const doneBtn = buildPillButton('← Done', 'tertiary', () => {
        if (window._sm) window._sm.navigateTo('menu-subs');
    });

    buttonRow.appendChild(editBtn);
    buttonRow.appendChild(anotherBtn);
    buttonRow.appendChild(doneBtn);
    wrapper.appendChild(buttonRow);
}

/* ==========================================
   ERROR VIEW
   ========================================== */
function buildError(wrapper) {
    // --- Header ---
    const header = document.createElement('div');
    header.style.cssText = `text-align: center; margin-bottom: 24px;`;

    const title = document.createElement('div');
    title.style.cssText = `
        font-size: 30px;
        font-weight: 700;
        color: ${C.verm};
        margin-bottom: 8px;
    `;
    title.textContent = 'Import Errors';

    const sub = document.createElement('div');
    sub.style.cssText = `
        font-size: 13px;
        color: ${C.textMuted};
        font-family: ui-monospace, monospace;
    `;
    sub.textContent = 'The template could not be parsed. Please check the errors below.';

    header.appendChild(title);
    header.appendChild(sub);
    wrapper.appendChild(header);

    // --- Errors card ---
    if (parseErrors.length > 0) {
        const errCard = buildCard(C.verm, {
            padding: '18px 22px',
            cssText: 'background: rgba(232, 71, 42, 0.06); margin-bottom: 14px;'
        });
        const errHeading = buildLabel(`Errors · ${parseErrors.length}`, {
            size: '13px', color: C.verm, margin: 'margin-bottom: 12px'
        });
        errCard.appendChild(errHeading);

        parseErrors.forEach(err => {
            const line = document.createElement('div');
            line.style.cssText = `
                font-size: 14px;
                color: ${C.text};
                padding: 4px 0;
                font-family: ui-monospace, monospace;
            `;
            line.textContent = `✗ ${err}`;
            errCard.appendChild(line);
        });
        wrapper.appendChild(errCard);
    }

    // --- Warnings card ---
    if (parseWarnings.length > 0) {
        const warnCard = buildCard(C.warning, {
            padding: '18px 22px',
            cssText: 'background: rgba(251, 191, 36, 0.05); margin-bottom: 14px;'
        });
        const warnHeading = buildLabel(`Warnings · ${parseWarnings.length}`, {
            size: '13px', color: C.warning, margin: 'margin-bottom: 12px'
        });
        warnCard.appendChild(warnHeading);

        parseWarnings.forEach(warn => {
            const line = document.createElement('div');
            line.style.cssText = `
                font-size: 14px;
                color: ${C.textMuted};
                padding: 4px 0;
                font-family: ui-monospace, monospace;
            `;
            line.textContent = `⚠ ${warn}`;
            warnCard.appendChild(line);
        });
        wrapper.appendChild(warnCard);
    }

    // --- Retry button ---
    const retryRow = document.createElement('div');
    retryRow.style.cssText = `display: flex; justify-content: center; margin-top: 24px;`;

    const retryBtn = buildPillButton('← Try Another File', 'primary', () => {
        selectedFile = null;
        parsedData = null;
        parseErrors = [];
        parseWarnings = [];
        viewHistory = [];
        pushView('file-select');
    });
    retryRow.appendChild(retryBtn);
    wrapper.appendChild(retryRow);
}

/* ------------------------------------------
   PUBLIC: Register scene with scene manager.
   Unchanged from Vz1.x.
------------------------------------------ */
export function registerMenuImport(sceneManager) {
    sceneManager.register('import-excel', {
        type: 'detail',
        title: 'Import from Excel',
        parent: 'menu-subs',
        onEnter(container) {
            currentWrapper = document.createElement('div');
            currentWrapper.style.cssText = `
                max-width: 960px;
                margin: 0 auto;
                padding: 30px 32px 48px 32px;
                color: ${C.text};
            `;
            container.appendChild(currentWrapper);

            // Reset state
            parsedData = null;
            parseErrors = [];
            parseWarnings = [];
            selectedFile = null;

            pushView('file-select');
        },
        onExit(container) {
            viewHistory = [];
            currentWrapper = null;
            parsedData = null;
            parseErrors = [];
            parseWarnings = [];
            selectedFile = null;
            container.innerHTML = '';
        },
    });
}