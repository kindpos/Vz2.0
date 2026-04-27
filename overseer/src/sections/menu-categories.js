import { pushChanges } from '../services/config-push.js';
import {
    C, buildScenePage, showToast, withAlpha,
} from '../ui/forms.js';

/* ============================================
   KINDpos Overseer — Menu Categories & Items (Nostalgia, v2 merged)

   Reskinned Vz2.0 per menu-categories-reskin-spec.md (v2).
   Absorbs display-order.js + menu-availability.js per nav lock.

   Data model (additions to v1):
     item.display_order            — mutated on drag reorder
     item.active                   — 86 state toggled inline from tiles
     category.display_order        — mutated by category up/down arrows
     category.schedule             — { enabled, grace_minutes, windows: [...] }
       window: { label, days[7], start, end, price_adjustment_pct }
     category.special_active       — boolean
     category.special_label        — string

   Nice. Dependable. Yours.
   ============================================ */

const C2 = {
    warning:   '#fbbf24',
    warningBg: 'rgba(251,191,36,0.08)',
    hairline:  '#2a2d32',
    lavender:  '#b48efa',
};

const CATEGORY_COLORS = [
    '#ff4757', '#fcbe40', '#3742fa', '#2ed573', '#ff6348',
    '#7bed9f', '#70a1ff', '#b48efa', '#ff6b81', '#ffa502',
    '#1e90ff', '#f97316', '#fb923c', '#e879f9', '#ff4422',
    '#22d3ee', '#facc15', '#a78bfa',
];

const DAY_LABELS = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'];

/* ─── MODULE STATE ───────────────────────────────────────────── */
let bodyMount = null;
let footerMount = null;
let currentSaveBar = null;

let menuData = {
    categories: [],
    items: [],
    allGroups: [],
    allModifiers: [],
    atomsById: {},
    groupsById: {},
    legacyHiddenGroups: {},
};

let pendingChanges = {
    new: [],
    edited: [],
    deleted: [],
    itemOrderByCategory: {},    // { catId: [itemId, ...] } — reorder events
    categoryOrder: null,        // [catId, ...] — category reorder events
    availability: {},           // { itemId: { available: bool, eightysixed_at: string|null } }
};

/* ─── DRAFT (localStorage) ───────────────────────────────────── */
const DRAFT_KEY = 'kindpos.menu.draft';

function saveDraft() {
    try { localStorage.setItem(DRAFT_KEY, JSON.stringify(pendingChanges)); }
    catch (e) { console.warn('[MenuDraft] save failed:', e); }
}

function loadDraft() {
    try {
        const raw = localStorage.getItem(DRAFT_KEY);
        return raw ? JSON.parse(raw) : null;
    } catch { return null; }
}

function clearDraft() {
    localStorage.removeItem(DRAFT_KEY);
}

let displayState = {
    searchTerm:        '',
    filterCategory:    'all',
    editMode:          false,
    availabilityFilter: 'all',  // 'all' | 'available' | 'eightysixed'
    alphaSort:         false,
    reorderMode:       false,
};

const modalStack = [];

/* ─── DATA FETCH ─────────────────────────────────────────────── */
function defaultSchedule() {
    return { enabled: false, grace_minutes: 10, windows: [] };
}

function defaultWindow() {
    return {
        label: '',
        days:  [1,1,1,1,1,1,1],
        start: '09:00',
        end:   '21:00',
        price_adjustment_pct: 0,
    };
}

function migrateCategorySchedule(raw) {
    if (raw.schedule && typeof raw.schedule === 'object') {
        return {
            enabled:       raw.schedule.enabled === true,
            grace_minutes: Number(raw.schedule.grace_minutes) || 10,
            windows:       Array.isArray(raw.schedule.windows) ? raw.schedule.windows.map(w => ({
                label:                w.label || '',
                days:                 Array.isArray(w.days) && w.days.length === 7 ? w.days.slice() : [1,1,1,1,1,1,1],
                start:                w.start || '09:00',
                end:                  w.end   || '21:00',
                price_adjustment_pct: Number(w.price_adjustment_pct) || 0,
            })) : [],
        };
    }
    // legacy single-window fields (from menu-availability.js)
    if (raw.schedule_type && raw.schedule_type !== 'always') {
        return {
            enabled:       true,
            grace_minutes: Number(raw.grace_minutes) || 10,
            windows: [{
                label:                '',
                days:                 Array.isArray(raw.active_days) && raw.active_days.length === 7
                                          ? raw.active_days.map(x => x ? 1 : 0)
                                          : [1,1,1,1,1,1,1],
                start:                raw.time_start || '09:00',
                end:                  raw.time_end   || '21:00',
                price_adjustment_pct: 0,
            }],
        };
    }
    return defaultSchedule();
}

async function fetchMenuData() {
    try {
        const [menuRes, catRes, itemRes] = await Promise.all([
            fetch('/api/v1/menu'),
            fetch('/api/v1/config/menu/categories'),
            fetch('/api/v1/config/menu/items'),
        ]);

        const menu     = menuRes.ok  ? await menuRes.json()  : { modifier_groups: [] };
        const rawCats  = catRes.ok   ? await catRes.json()   : [];
        const rawItems = itemRes.ok  ? await itemRes.json()  : [];

        const modifierGroups = menu.modifier_groups || [];

        const categories = rawCats.map((c, i) => ({
            id:                  c.category_id || c.id || `cat_${i}`,
            name:                c.name || c.label || '',
            display_order:       c.display_order || i + 1,
            color:               c.hex_color || c.color || '#fcbe40',
            enable_placement:    c.enable_placement === true,
            universal_group_ids: Array.isArray(c.universal_group_ids) ? c.universal_group_ids : [],
            schedule:            migrateCategorySchedule(c),
            special_active:      c.special_active === true,
            special_label:       c.special_label || '',
        }));

        const nameToId = {};
        categories.forEach(c => {
            nameToId[c.name.toLowerCase()] = c.id;
            nameToId[c.id.toLowerCase()]   = c.id;
        });
        const resolveCategory = (raw) => {
            if (!raw) return '';
            return nameToId[String(raw).toLowerCase()] || raw;
        };

        const allGroups  = [];
        const allAtoms   = [];
        const atomsById  = {};
        const groupsById = {};
        const atomSet    = new Set();
        const legacyHiddenGroups = {};

        for (const grp of modifierGroups) {
            const gid = grp.group_id || grp.id;
            if (!gid) continue;

            if (grp.hidden) {
                if (grp.owner_item_id) legacyHiddenGroups[grp.owner_item_id] = grp;
                continue;
            }

            const groupRecord = {
                id:             gid,
                name:           grp.name || gid,
                drives_pricing: grp.drives_pricing === true,
                select_mode:    grp.select_mode || 'single',
                member_count:   0,
            };

            const mods       = grp.modifiers || [];
            const subcatMods = (grp.subcats || []).flatMap(sc => sc.modifiers || []);
            const allGrpMods = [...mods, ...subcatMods];
            groupRecord.member_count = allGrpMods.length;

            for (const m of allGrpMods) {
                const mid = m.modifier_id || m.id;
                if (!mid) continue;
                if (atomSet.has(mid)) {
                    if (m.price_by_option && Object.keys(m.price_by_option).length) {
                        atomsById[mid].price_by_option = Object.assign({}, atomsById[mid].price_by_option, m.price_by_option);
                    }
                    continue;
                }
                atomSet.add(mid);
                const rec = {
                    id:              mid,
                    name:            m.name || mid,
                    base_price:      parseFloat(m.price) || 0,
                    price_by_option: (m.price_by_option && Object.keys(m.price_by_option).length)
                                         ? Object.assign({}, m.price_by_option) : null,
                };
                atomsById[mid] = rec;
                allAtoms.push(rec);
            }

            groupsById[gid] = groupRecord;
            allGroups.push(groupRecord);
        }

        const items = rawItems.map((item, i) => {
            const id = item.item_id || item.id || `item_${i}`;
            let included = Array.isArray(item.included_modifier_ids) ? item.included_modifier_ids : [];
            if (included.length === 0 && legacyHiddenGroups[id]) {
                included = (legacyHiddenGroups[id].modifier_ids || []).slice();
            }
            return {
                id,
                name:                  item.name || '',
                price:                 parseFloat(item.price) || 0,
                description:           item.description || '',
                category_id:           resolveCategory(item.category_id || item.category),
                active:                item.active !== false,
                display_order:         item.display_order || i + 1,
                mandatory_group_ids:   Array.isArray(item.mandatory_group_ids) ? item.mandatory_group_ids.slice() : [],
                included_modifier_ids: included.slice(),
            };
        });

        return {
            categories, items, allGroups,
            allModifiers: allAtoms,
            atomsById, groupsById, legacyHiddenGroups,
        };
    } catch (e) {
        console.warn('[MenuCategories] Failed to fetch menu data:', e);
        return {
            categories: [], items: [], allGroups: [], allModifiers: [],
            atomsById: {}, groupsById: {}, legacyHiddenGroups: {},
        };
    }
}

/* ─── HELPERS ────────────────────────────────────────────────── */
function clone(o) { return JSON.parse(JSON.stringify(o)); }
function formatPrice(p) { return '$' + Number(p || 0).toFixed(2); }

function getPendingCount() {
    return pendingChanges.new.length
         + pendingChanges.edited.length
         + pendingChanges.deleted.length
         + Object.keys(pendingChanges.itemOrderByCategory).length
         + (pendingChanges.categoryOrder ? 1 : 0)
         + Object.keys(pendingChanges.availability).length;
}

function getWorkingItem(id) {
    return pendingChanges.new.find(i => i.id === id)
        || pendingChanges.edited.find(i => i.id === id)
        || menuData.items.find(i => i.id === id)
        || null;
}

function getAllWorkingItems() {
    const edits = new Map(
        pendingChanges.edited
            .filter(e => !e._isCategory)
            .map(e => [e.id, e])
    );
    const deleted = new Set(pendingChanges.deleted);
    const basedItems = menuData.items
        .map(it => edits.has(it.id) ? edits.get(it.id) : clone(it))
        .filter(it => !deleted.has(it.id));
    const merged = basedItems.concat(pendingChanges.new.filter(n => !n._isCategory));
    // Apply pending availability overrides
    return merged.map(it => {
        const av = pendingChanges.availability[it.id];
        return av ? { ...it, active: !!av.available } : it;
    });
}

function getAllWorkingCategories() {
    const edits = new Map(
        pendingChanges.edited.filter(e => e._isCategory).map(e => [e.id, e])
    );
    const deleted = new Set(pendingChanges.deleted);
    let base = menuData.categories
        .map(c => edits.has(c.id) ? edits.get(c.id) : clone(c))
        .filter(c => !deleted.has(c.id))
        .concat(pendingChanges.new.filter(n => n._isCategory));

    // Apply pending category reorder
    if (pendingChanges.categoryOrder) {
        const orderMap = new Map(pendingChanges.categoryOrder.map((id, i) => [id, i + 1]));
        base = base.map(c => orderMap.has(c.id) ? { ...c, display_order: orderMap.get(c.id) } : c);
    }
    return base;
}

function itemDrivesPricingGroup(item) {
    const ids = item.mandatory_group_ids || [];
    return ids.some(gid => {
        const g = menuData.groupsById[gid];
        return g && g.drives_pricing;
    });
}

function atomPriceDisplay(atom, item) {
    if (!atom) return null;
    const hasSize = atom.price_by_option && Object.keys(atom.price_by_option).length > 0;
    if (!hasSize) return atom.base_price > 0 ? '+' + formatPrice(atom.base_price) : null;
    if (!itemDrivesPricingGroup(item)) return atom.base_price > 0 ? '+' + formatPrice(atom.base_price) : null;
    const prices = Object.values(atom.price_by_option).map(p => parseFloat(p) || 0);
    const min = Math.min(...prices);
    const max = Math.max(...prices);
    return min === max ? '+' + formatPrice(min) : '+$' + min.toFixed(2) + '–' + max.toFixed(2);
}

function mismatchedAtoms(item) {
    if (itemDrivesPricingGroup(item)) return [];
    return (item.included_modifier_ids || []).filter(aid => {
        const a = menuData.atomsById[aid];
        return a && a.price_by_option && Object.keys(a.price_by_option).length > 0;
    });
}

function formatWindowSummary(win) {
    const days = win.days || [1,1,1,1,1,1,1];
    const onCount = days.filter(Boolean).length;
    let daysStr;
    if (onCount === 7)        daysStr = 'daily';
    else if (onCount === 0)   daysStr = '—';
    else if (days.slice(0,5).every(Boolean) && !days[5] && !days[6]) daysStr = 'M–F';
    else if (!days.slice(0,5).some(Boolean) && days[5] && days[6])   daysStr = 'Sat–Sun';
    else daysStr = days.map((d,i) => d ? DAY_LABELS[i][0] : null).filter(Boolean).join('·');
    return `${win.start}–${win.end} · ${daysStr}`;
}

/* ─── SCENE REGISTRATION ─────────────────────────────────────── */
export function registerMenuCategories(sceneManager) {
    sceneManager.register('menu-categories', {
        type: 'detail', title: 'Items & Categories', parent: 'menu-subs',
        async onEnter(container) {
            injectAnimations();
            menuData       = await fetchMenuData();
            const _draft   = loadDraft();
            pendingChanges = _draft || { new: [], edited: [], deleted: [], itemOrderByCategory: {}, categoryOrder: null, availability: {} };
            displayState   = { searchTerm: '', filterCategory: 'all', editMode: false, availabilityFilter: 'all', alphaSort: false, reorderMode: false };

            const { body, saveBar } = buildScenePage(container, {
                title:     'Menu Items & Categories',
                subtitle:  `${menuData.categories.length} categories · ${menuData.items.length} items`,
                saveLabel: 'Publish Changes',
                onSave:    handlePublish,
            });
            bodyMount      = body;
            currentSaveBar = saveBar;
            renderScene();
        },
        onExit(container) {
            modalStack.splice(0).forEach(o => o.parentNode && o.remove());
            bodyMount = footerMount = currentSaveBar = null;
            menuData       = { categories: [], items: [], allGroups: [], allModifiers: [], atomsById: {}, groupsById: {}, legacyHiddenGroups: {} };
            pendingChanges = { new: [], edited: [], deleted: [], itemOrderByCategory: {}, categoryOrder: null, availability: {} };
            displayState   = { searchTerm: '', filterCategory: 'all', editMode: false, availabilityFilter: 'all', alphaSort: false, reorderMode: false };
            if (container) container.innerHTML = '';
        },
    });
}

/* ─── SCENE RENDER ───────────────────────────────────────────── */
function renderScene() {
    if (!bodyMount) return;
    bodyMount.innerHTML = '';

    bodyMount.appendChild(buildFilterRow());

    const cats  = getAllWorkingCategories().sort((a,b) => a.display_order - b.display_order);
    const items = getAllWorkingItems();

    const visibleCats = displayState.filterCategory === 'all'
        ? cats
        : cats.filter(c => c.id === displayState.filterCategory);

    visibleCats.forEach((cat, idx) => {
        bodyMount.appendChild(buildCategorySection(cat, items, idx === 0, idx === visibleCats.length - 1));
    });

    if (visibleCats.length === 0) {
        const empty = document.createElement('div');
        empty.style.cssText = `
            color: ${C.textMuted}; text-align: center; padding: 40px;
            font-family: ui-monospace, monospace; font-size: 13px;
            letter-spacing: 1.5px; text-transform: uppercase;
        `;
        empty.textContent = 'No categories yet — tap + Category to create one';
        bodyMount.appendChild(empty);
    }

    bodyMount.appendChild(buildPendingFooter());
    updateSaveBar();
}

/* ─── FILTER ROW ─────────────────────────────────────────────── */
function buildFilterRow() {
    const wrap = document.createElement('div');
    wrap.style.cssText = 'display: flex; gap: 8px; flex-wrap: wrap; align-items: center;';

    const search = document.createElement('input');
    search.type = 'text';
    search.placeholder = 'Search items…';
    search.value = displayState.searchTerm;
    search.style.cssText = `
        flex: 1 1 180px;
        background: ${C.well};
        border: 1px solid ${C.border};
        border-radius: 6px;
        padding: 10px 14px;
        color: ${C.text};
        font-family: var(--font-body);
        font-size: 14px; outline: none;
    `;
    search.addEventListener('focus', () => search.style.borderColor = C.gold);
    search.addEventListener('blur',  () => search.style.borderColor = C.border);
    search.addEventListener('input', (e) => { displayState.searchTerm = e.target.value; renderScene(); });
    wrap.appendChild(search);

    const filter = document.createElement('select');
    filter.style.cssText = `
        background: ${C.well};
        border: 1px solid ${C.border};
        border-radius: 6px;
        padding: 10px 14px;
        color: ${C.text};
        font-family: var(--font-body);
        font-size: 14px; outline: none;
        color-scheme: dark;
    `;
    const allOpt = document.createElement('option');
    allOpt.value = 'all'; allOpt.textContent = 'All categories';
    if (displayState.filterCategory === 'all') allOpt.selected = true;
    filter.appendChild(allOpt);
    getAllWorkingCategories()
        .sort((a,b) => a.display_order - b.display_order)
        .forEach(c => {
            const o = document.createElement('option');
            o.value = c.id; o.textContent = c.name;
            if (displayState.filterCategory === c.id) o.selected = true;
            filter.appendChild(o);
        });
    filter.addEventListener('change', (e) => { displayState.filterCategory = e.target.value; renderScene(); });
    wrap.appendChild(filter);

    // Edit / Done chip
    const editChip = buildFilterChip(displayState.editMode ? 'Done' : 'Edit', displayState.editMode, () => {
        displayState.editMode = !displayState.editMode;
        if (!displayState.editMode) {
            // exiting edit mode resets sub-modes
            displayState.reorderMode = false;
            displayState.alphaSort   = false;
            displayState.availabilityFilter = 'all';
        }
        renderScene();
    });
    wrap.appendChild(editChip);

    if (displayState.editMode) {
        const all = getAllWorkingItems();
        const availCount = all.filter(i => i.active).length;
        const eightyCount = all.filter(i => !i.active).length;

        wrap.appendChild(buildFilterChip(
            `Available`,
            displayState.availabilityFilter === 'available',
            () => {
                displayState.availabilityFilter = displayState.availabilityFilter === 'available' ? 'all' : 'available';
                renderScene();
            },
            availCount,
        ));
        wrap.appendChild(buildFilterChip(
            `86'd`,
            displayState.availabilityFilter === 'eightysixed',
            () => {
                displayState.availabilityFilter = displayState.availabilityFilter === 'eightysixed' ? 'all' : 'eightysixed';
                renderScene();
            },
            eightyCount,
        ));

        wrap.appendChild(buildFilterChip(
            'A–Z',
            displayState.alphaSort,
            () => {
                if (displayState.reorderMode) return; // mutually exclusive
                displayState.alphaSort = !displayState.alphaSort;
                renderScene();
            },
            null,
            displayState.reorderMode,
        ));

        wrap.appendChild(buildFilterChip(
            'Reorder',
            displayState.reorderMode,
            () => {
                displayState.reorderMode = !displayState.reorderMode;
                if (displayState.reorderMode) displayState.alphaSort = false;
                renderScene();
            },
        ));
    }

    const addCatBtn = buildPillButton('+ Category', 'primary', () => openAddCategoryModal());
    addCatBtn.style.padding = '8px 16px';
    addCatBtn.style.fontSize = '11px';
    wrap.appendChild(addCatBtn);

    return wrap;
}

function buildFilterChip(label, active, onClick, count = null, disabled = false) {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.style.cssText = `
        display: inline-flex; align-items: center; gap: 6px;
        padding: 6px 14px;
        background: ${active ? withAlpha(C.green, 0.15) : 'transparent'};
        border: 1px solid ${active ? C.green : withAlpha(C.text, 0.2)};
        border-radius: 999px;
        color: ${active ? C.green : C.text};
        font-family: ui-monospace, monospace;
        font-size: 10px; font-weight: 700;
        letter-spacing: 1.5px;
        cursor: ${disabled ? 'not-allowed' : 'pointer'};
        opacity: ${disabled ? '0.4' : '1'};
        transition: all 0.15s ease;
    `;
    chip.textContent = label;
    if (count != null) {
        const c = document.createElement('span');
        c.textContent = count;
        c.style.cssText = `
            background: ${active ? C.green : withAlpha(C.text, 0.15)};
            color: ${active ? C.well : C.text};
            padding: 1px 7px; border-radius: 999px;
            font-size: 9px;
        `;
        chip.appendChild(c);
    }
    if (!disabled) chip.addEventListener('click', onClick);
    return chip;
}

/* ─── CATEGORY SECTION ───────────────────────────────────────── */
function buildCategorySection(cat, allItems, isFirst, isLast) {
    const wrap = document.createElement('div');
    wrap.style.cssText = 'display: flex; flex-direction: column; gap: 10px; margin-top: 12px;';

    const header = document.createElement('div');
    header.style.cssText = `
        display: flex; align-items: center; gap: 10px;
        padding: 10px 0 10px 12px;
        border-left: 4px solid ${cat.color};
        border-bottom: 2px solid ${cat.color};
        flex-wrap: wrap;
    `;

    const catName = document.createElement('div');
    catName.textContent = (cat.name || '').toUpperCase();
    catName.style.cssText = `
        font-family: ui-monospace, monospace;
        font-size: 14px; font-weight: 700;
        letter-spacing: 2.5px; color: ${cat.color};
    `;
    header.appendChild(catName);

    // Filter items for this category
    let catItems = allItems
        .filter(i => i.category_id === cat.id);

    // Availability filter
    if (displayState.availabilityFilter === 'available') {
        catItems = catItems.filter(i => i.active);
    } else if (displayState.availabilityFilter === 'eightysixed') {
        catItems = catItems.filter(i => !i.active);
    }

    // Sort
    if (displayState.alphaSort) {
        catItems.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
    } else {
        // Apply pending reorder if present
        const pendingOrder = pendingChanges.itemOrderByCategory[cat.id];
        if (pendingOrder) {
            const posMap = new Map(pendingOrder.map((id, i) => [id, i]));
            catItems.sort((a, b) => (posMap.get(a.id) ?? 999) - (posMap.get(b.id) ?? 999));
        } else {
            catItems.sort((a, b) => (a.display_order || 999) - (b.display_order || 999));
        }
    }

    // Search filter
    if (displayState.searchTerm.trim()) {
        const term = displayState.searchTerm.toLowerCase().trim();
        catItems = catItems.filter(i =>
            (i.name || '').toLowerCase().includes(term)
            || (i.description || '').toLowerCase().includes(term)
        );
    }

    const count = document.createElement('div');
    count.textContent = `· ${catItems.length} item${catItems.length === 1 ? '' : 's'}`;
    count.style.cssText = `
        font-family: ui-monospace, monospace;
        font-size: 12px; letter-spacing: 1.5px;
        color: ${C.textMuted};
    `;
    header.appendChild(count);

    // Schedule badge
    if (cat.schedule && cat.schedule.enabled && cat.schedule.windows && cat.schedule.windows.length > 0) {
        const badge = document.createElement('div');
        const windows = cat.schedule.windows;
        badge.textContent = windows.length === 1
            ? formatWindowSummary(windows[0])
            : `${windows.length} windows`;
        badge.style.cssText = `
            padding: 3px 8px; border-radius: 999px;
            font-family: ui-monospace, monospace;
            font-size: 9px; font-weight: 700; letter-spacing: 1.5px;
            background: ${withAlpha(C2.lavender, 0.18)};
            color: ${C2.lavender};
        `;
        header.appendChild(badge);
    }
    if (cat.special_active) {
        const badge = document.createElement('div');
        badge.textContent = cat.special_label ? `SPECIAL · ${cat.special_label.toUpperCase()}` : 'SPECIAL';
        badge.style.cssText = `
            padding: 3px 8px; border-radius: 999px;
            font-family: ui-monospace, monospace;
            font-size: 9px; font-weight: 700; letter-spacing: 1.5px;
            background: ${withAlpha(C.gold, 0.18)};
            color: ${C.gold};
        `;
        header.appendChild(badge);
    }

    const spacer = document.createElement('div');
    spacer.style.flex = '1';
    header.appendChild(spacer);

    // Actions: edit/add or reorder arrows
    if (displayState.reorderMode && displayState.editMode) {
        const upBtn = buildArrowButton('▲', isFirst, () => moveCategoryUp(cat.id));
        const dnBtn = buildArrowButton('▼', isLast,  () => moveCategoryDown(cat.id));
        header.appendChild(upBtn);
        header.appendChild(dnBtn);
    } else {
        const editCatBtn = buildPillButton('Edit', 'ghost', () => openEditCategoryModal(cat));
        editCatBtn.style.padding = '5px 12px'; editCatBtn.style.fontSize = '10px';
        header.appendChild(editCatBtn);

        const addItemBtn = buildPillButton('+ Add', 'ghost', () => openAddItemModal(cat.id));
        addItemBtn.style.padding = '5px 12px'; addItemBtn.style.fontSize = '10px';
        header.appendChild(addItemBtn);
    }

    wrap.appendChild(header);

    if (catItems.length === 0) {
        const empty = document.createElement('div');
        empty.style.cssText = `
            color: ${C.textMuted}; padding: 10px 0 16px;
            font-style: italic; font-size: 13px;
        `;
        empty.textContent = displayState.searchTerm.trim()
            ? 'No items match your search'
            : displayState.availabilityFilter !== 'all'
                ? `No ${displayState.availabilityFilter === 'available' ? 'available' : '86\'d'} items in this category`
                : 'No items in this category';
        wrap.appendChild(empty);
        return wrap;
    }

    const grid = document.createElement('div');
    grid.style.cssText = `
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(130px, 1fr));
        gap: 10px;
        margin-bottom: 8px;
        position: relative;
    `;
    grid._categoryId = cat.id;
    catItems.forEach(it => grid.appendChild(buildItemTile(it, cat, grid)));
    wrap.appendChild(grid);

    return wrap;
}

function buildArrowButton(symbol, disabled, onClick) {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = symbol;
    b.disabled = disabled;
    b.style.cssText = `
        width: 28px; height: 28px; padding: 0;
        background: transparent;
        border: 1px solid ${withAlpha(C.text, 0.2)};
        border-radius: 6px;
        color: ${C.text};
        font-size: 14px; line-height: 1;
        display: inline-flex; align-items: center; justify-content: center;
        cursor: ${disabled ? 'not-allowed' : 'pointer'};
        opacity: ${disabled ? '0.3' : '1'};
    `;
    if (!disabled && onClick) b.addEventListener('click', onClick);
    return b;
}

/* ─── TILE ──────────────────────────────────────────────────── */
function buildItemTile(item, cat, gridEl) {
    const isNew     = pendingChanges.new.some(i => i.id === item.id);
    const isEdited  = pendingChanges.edited.some(i => i.id === item.id && !i._isCategory);
    const isDeleted = pendingChanges.deleted.includes(item.id);
    const avAffected = pendingChanges.availability[item.id];

    const tile = document.createElement('div');
    tile._itemId = item.id;
    const dashedBorders = displayState.reorderMode && displayState.editMode;
    tile.style.cssText = `
        background: ${C.card};
        border-left: 4px solid ${cat.color};
        ${dashedBorders ? `border-top: 1px dashed ${withAlpha(C.text, 0.12)};
                            border-right: 1px dashed ${withAlpha(C.text, 0.12)};
                            border-bottom: 1px dashed ${withAlpha(C.text, 0.12)};` : ''}
        border-radius: 10px;
        padding: 14px 14px 12px;
        min-height: 92px;
        display: flex; flex-direction: column; justify-content: space-between;
        position: relative;
        cursor: ${displayState.reorderMode ? 'grab' : 'pointer'};
        opacity: ${isDeleted ? '0.35' : (item.active ? '1' : '0.55')};
        transition: transform 0.1s ease, box-shadow 0.15s ease;
        user-select: none;
        touch-action: ${displayState.reorderMode ? 'none' : 'manipulation'};
    `;

    const name = document.createElement('div');
    name.textContent = item.name;
    name.style.cssText = `
        font-size: 14px; font-weight: 500; color: ${C.text};
        line-height: 1.25; word-break: break-word;
        padding-right: ${displayState.editMode ? '34px' : '8px'};
    `;
    tile.appendChild(name);

    const price = document.createElement('div');
    price.textContent = formatPrice(item.price);
    price.style.cssText = `
        color: ${C.gold}; font-family: ui-monospace, monospace;
        font-size: 15px; font-weight: 700; margin-top: 6px;
    `;
    tile.appendChild(price);

    // Top-right element (varies by mode)
    if (displayState.reorderMode && displayState.editMode) {
        tile.appendChild(buildGrip());
        attachDragHandlers(tile, item, cat, gridEl);
    } else if (displayState.editMode) {
        tile.appendChild(buildAvailabilityDot(item, tile));
    } else {
        // Browse: just a static 86 badge if inactive
        if (!item.active) {
            const b = document.createElement('div');
            b.textContent = '86';
            b.style.cssText = `
                position: absolute; top: 8px; right: 8px;
                padding: 2px 7px; border-radius: 999px;
                font-family: ui-monospace, monospace;
                font-size: 9px; font-weight: 700; letter-spacing: 1.5px;
                background: ${withAlpha(C.text, 0.18)};
                color: ${withAlpha(C.text, 0.75)};
                pointer-events: none;
            `;
            tile.appendChild(b);
        }
    }

    // Status badges (NEW/EDIT/AVAIL-CHANGED) in bottom-right so they don't conflict with the top-right action
    if (isNew || isEdited || avAffected || isDeleted) {
        let label, bg, color;
        if (isDeleted)       { label = 'DEL';  bg = C.verm;               color = '#fff'; }
        else if (isNew)      { label = 'NEW';  bg = C.greenUp;            color = C.well; }
        else if (isEdited)   { label = 'EDIT'; bg = C.gold;               color = '#1a1000'; }
        else if (avAffected) { label = '±86';  bg = withAlpha(C.gold,0.6); color = '#1a1000'; }
        const b = document.createElement('div');
        b.textContent = label;
        b.style.cssText = `
            position: absolute; bottom: 6px; right: 6px;
            padding: 1px 6px; border-radius: 999px;
            font-family: ui-monospace, monospace;
            font-size: 8px; font-weight: 700; letter-spacing: 1.5px;
            background: ${bg}; color: ${color};
        `;
        tile.appendChild(b);
    }

    // Tap: open item modal (browse + edit-without-reorder)
    if (!displayState.reorderMode) {
        tile.addEventListener('click', (e) => {
            if (e.target.closest('._tile-dot')) return; // clicks on the dot handled separately
            if (!isDeleted) openEditItemModal(item.id);
        });
    }

    return tile;
}

function buildGrip() {
    const grip = document.createElement('div');
    grip.style.cssText = `
        position: absolute; top: 8px; right: 8px;
        width: 16px; height: 18px;
        display: grid;
        grid-template-columns: repeat(2, 4px);
        grid-template-rows: repeat(3, 4px);
        gap: 3px; align-content: start;
        opacity: 0.45;
        pointer-events: none;
    `;
    for (let i = 0; i < 6; i++) {
        const d = document.createElement('span');
        d.style.cssText = `width: 4px; height: 4px; background: ${C.text}; border-radius: 50%;`;
        grip.appendChild(d);
    }
    return grip;
}

function buildAvailabilityDot(item, tile) {
    const dot = document.createElement('button');
    dot.type = 'button';
    dot.className = '_tile-dot';
    const on = item.active;
    dot.textContent = on ? '●' : '86';
    dot.style.cssText = `
        position: absolute; top: 6px; right: 6px;
        width: ${on ? '22px' : '28px'}; height: 22px;
        padding: 0;
        border-radius: 999px;
        display: flex; align-items: center; justify-content: center;
        font-size: ${on ? '10px' : '9px'};
        font-weight: 700;
        font-family: ui-monospace, monospace;
        letter-spacing: ${on ? '0' : '1px'};
        cursor: pointer;
        background: ${on ? withAlpha(C.greenUp, 0.15) : withAlpha(C.text, 0.15)};
        color:      ${on ? C.greenUp : withAlpha(C.text, 0.75)};
        border: 1px solid ${on ? C.greenUp : withAlpha(C.text, 0.3)};
    `;
    dot.addEventListener('click', (e) => {
        e.stopPropagation();
        toggleItemAvailability(item.id, !on);
    });
    return dot;
}

function toggleItemAvailability(itemId, becomingAvailable) {
    pendingChanges.availability[itemId] = {
        available:       becomingAvailable,
        eightysixed_at:  becomingAvailable ? null : new Date().toISOString(),
    };
    renderScene();
}

/* ─── DRAG REORDER ──────────────────────────────────────────── */
function attachDragHandlers(tile, item, cat, gridEl) {
    let drag = null;

    tile.addEventListener('pointerdown', (e) => {
        if (!displayState.reorderMode) return;
        if (e.button !== undefined && e.button !== 0) return;
        e.preventDefault();
        const rect = tile.getBoundingClientRect();
        drag = {
            pointerId:    e.pointerId,
            startX:       e.clientX,
            startY:       e.clientY,
            offsetX:      e.clientX - rect.left,
            offsetY:      e.clientY - rect.top,
            width:        rect.width,
            height:       rect.height,
            moved:        false,
            placeholder:  null,
        };
        try { tile.setPointerCapture(e.pointerId); } catch (_) {}
    });

    tile.addEventListener('pointermove', (e) => {
        if (!drag || e.pointerId !== drag.pointerId) return;
        const dx = e.clientX - drag.startX;
        const dy = e.clientY - drag.startY;
        if (!drag.moved && (Math.abs(dx) > 4 || Math.abs(dy) > 4)) {
            drag.moved = true;
            const ph = document.createElement('div');
            ph.className = '_drop-ph';
            ph.style.cssText = `
                background: ${withAlpha(C.green, 0.12)};
                border: 2px dashed ${C.green};
                border-radius: 10px;
                min-height: ${drag.height}px;
            `;
            gridEl.insertBefore(ph, tile);
            drag.placeholder = ph;
            tile.style.position = 'fixed';
            tile.style.left = `${e.clientX - drag.offsetX}px`;
            tile.style.top  = `${e.clientY - drag.offsetY}px`;
            tile.style.width = `${drag.width}px`;
            tile.style.zIndex = '100';
            tile.style.transform = 'rotate(-1.5deg) scale(1.03)';
            tile.style.boxShadow = `0 16px 40px rgba(0,0,0,0.6), 0 0 0 2px ${C.green}`;
            tile.style.pointerEvents = 'none';
            document.body.style.cursor = 'grabbing';
        }
        if (drag.moved) {
            tile.style.left = `${e.clientX - drag.offsetX}px`;
            tile.style.top  = `${e.clientY - drag.offsetY}px`;
            // find target tile within gridEl
            const siblings = Array.from(gridEl.children).filter(c => c !== tile && c !== drag.placeholder && !c.classList.contains('_drop-ph'));
            let bestEl = null, bestDist = Infinity;
            for (const s of siblings) {
                const r = s.getBoundingClientRect();
                const cx = r.left + r.width / 2;
                const cy = r.top  + r.height / 2;
                const d = Math.hypot(e.clientX - cx, e.clientY - cy);
                if (d < bestDist) { bestDist = d; bestEl = s; }
            }
            // only accept if pointer is within the grid's bounds (per-category scope)
            const gridR = gridEl.getBoundingClientRect();
            const inside = e.clientX >= gridR.left && e.clientX <= gridR.right
                        && e.clientY >= gridR.top  && e.clientY <= gridR.bottom + 60;
            if (bestEl && inside) {
                const r = bestEl.getBoundingClientRect();
                const before = (e.clientY < r.top + r.height / 2) || (e.clientX < r.left + r.width / 2);
                if (before) gridEl.insertBefore(drag.placeholder, bestEl);
                else        gridEl.insertBefore(drag.placeholder, bestEl.nextSibling);
            }
        }
    });

    const finish = (e) => {
        if (!drag) return;
        try { tile.releasePointerCapture(drag.pointerId); } catch (_) {}
        if (drag.moved && drag.placeholder) {
            gridEl.insertBefore(tile, drag.placeholder);
            drag.placeholder.remove();
            tile.style.position = '';
            tile.style.left = '';
            tile.style.top  = '';
            tile.style.width = '';
            tile.style.zIndex = '';
            tile.style.transform = '';
            tile.style.boxShadow = '';
            tile.style.pointerEvents = '';
            document.body.style.cursor = '';
            // Collect new item order for this category
            const newOrder = Array.from(gridEl.children)
                .filter(c => c._itemId)
                .map(c => c._itemId);
            commitItemReorder(cat.id, newOrder);
        }
        drag = null;
    };
    tile.addEventListener('pointerup',     finish);
    tile.addEventListener('pointercancel', finish);
}

function commitItemReorder(catId, newOrder) {
    const items = getAllWorkingItems()
        .filter(i => i.category_id === catId)
        .sort((a, b) => (a.display_order || 999) - (b.display_order || 999));
    const baseOrder = items.map(i => i.id);
    if (baseOrder.length === newOrder.length && baseOrder.every((id, i) => id === newOrder[i])) {
        delete pendingChanges.itemOrderByCategory[catId];
    } else {
        pendingChanges.itemOrderByCategory[catId] = newOrder;
    }
    renderScene();
}

function moveCategoryUp(catId) { swapCategory(catId, -1); }
function moveCategoryDown(catId) { swapCategory(catId, +1); }
function swapCategory(catId, delta) {
    const cats = getAllWorkingCategories()
        .sort((a, b) => a.display_order - b.display_order)
        .map(c => c.id);
    const idx = cats.indexOf(catId);
    if (idx < 0) return;
    const next = idx + delta;
    if (next < 0 || next >= cats.length) return;
    [cats[idx], cats[next]] = [cats[next], cats[idx]];
    const baseOrder = menuData.categories.slice().sort((a,b)=>a.display_order-b.display_order).map(c=>c.id);
    if (baseOrder.length === cats.length && baseOrder.every((id,i)=>id===cats[i])) {
        pendingChanges.categoryOrder = null;
    } else {
        pendingChanges.categoryOrder = cats;
    }
    renderScene();
}

/* ─── PENDING FOOTER ────────────────────────────────────────── */
function buildPendingFooter() {
    const wrap = document.createElement('div');
    footerMount = wrap;
    wrap.style.cssText = `position: sticky; bottom: 12px; margin-top: 12px; z-index: 40; display: none;`;

    const inner = document.createElement('div');
    inner.style.cssText = `
        display: flex; align-items: center; gap: 16px;
        padding: 14px 20px;
        background: ${C.card};
        border-left: 4px solid ${C.gold};
        border-radius: 10px;
        box-shadow: 0 12px 40px rgba(0,0,0,0.5);
    `;
    wrap.appendChild(inner);

    const msg = document.createElement('div');
    msg.id = 'mc-pending-msg';
    msg.style.cssText = `
        flex: 1;
        font-family: ui-monospace, monospace;
        font-size: 12px; font-weight: 700;
        letter-spacing: 1.5px; text-transform: uppercase;
        color: ${C.gold};
    `;
    inner.appendChild(msg);

    const discard = buildPillButton('Discard', 'ghost', () => {
        const n = getPendingCount();
        if (!n) return;
        if (confirm(`Discard ${n} unpublished change${n === 1 ? '' : 's'}?`)) {
            pendingChanges = { new: [], edited: [], deleted: [], itemOrderByCategory: {}, categoryOrder: null, availability: {} };
            renderScene();
        }
    });
    discard.style.padding = '8px 18px';
    discard.style.fontSize = '11px';
    inner.appendChild(discard);

    return wrap;
}

function updateSaveBar() {
    const n = getPendingCount();
    if (footerMount) {
        footerMount.style.display = n === 0 ? 'none' : 'block';
        const m = document.getElementById('mc-pending-msg');
        if (m) m.textContent = `⚠ ${n} unpublished change${n === 1 ? '' : 's'}`;
    }
    if (currentSaveBar) {
        currentSaveBar.setLabel(n > 0 ? `Publish Changes (${n})` : 'Publish Changes');
        currentSaveBar.setDisabled(n === 0);
    }
    if (n === 0) clearDraft(); else saveDraft();
}

/* ─── BUTTONS ───────────────────────────────────────────────── */
function buildPillButton(label, variant, onClick, opts = {}) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = label;
    const variants = {
        primary:   `background: ${C.gold};   color: #1a1000;    border: none;`,
        confirm:   `background: ${C.greenUp};color: ${C.well};  border: none;`,
        secondary: `background: ${C.well};   color: ${C.text};  border: 1px solid ${C.border};`,
        danger:    `background: transparent; color: ${C.verm};  border: 1px solid ${C.verm};`,
        ghost:     `background: transparent; color: ${C.text};  border: 1px solid ${withAlpha(C.text, 0.2)};`,
        tertiary:  `background: transparent; color: ${C.textMuted}; border: 1px solid ${C.border};`,
    };
    btn.style.cssText = `
        ${variants[variant] || variants.primary}
        border-radius: 999px;
        padding: ${opts.small ? '8px 18px' : '10px 22px'};
        font-family: ui-monospace, monospace;
        font-size: ${opts.small ? '11px' : '12px'};
        font-weight: 700;
        letter-spacing: 1.5px;
        text-transform: uppercase;
        cursor: pointer;
        transition: transform 0.1s ease, opacity 0.15s ease;
        white-space: nowrap;
    `;
    btn.addEventListener('mouseenter', () => { if (!btn.disabled) btn.style.transform = 'translateY(-1px)'; });
    btn.addEventListener('mouseleave', () => btn.style.transform = '');
    if (onClick) btn.addEventListener('click', onClick);
    return btn;
}

/* ─── MODAL SYSTEM ──────────────────────────────────────────── */
function openModal(titleText, contentBuilder, opts = {}) {
    const overlay = document.createElement('div');
    overlay.style.cssText = `
        position: fixed; inset: 0;
        background: rgba(26,29,32,0.75);
        z-index: ${5000 + modalStack.length * 10};
        display: flex; align-items: center; justify-content: center;
        padding: 20px;
        animation: mc-fade-in 0.15s ease-out;
    `;
    overlay.addEventListener('click', (e) => { if (e.target === overlay) closeModal(overlay); });

    const modal = document.createElement('div');
    modal.style.cssText = `
        background: ${C.card};
        border-left: 4px solid ${opts.accent || C.gold};
        border-radius: 12px;
        max-width: ${opts.wide ? '720px' : '520px'};
        width: 100%;
        max-height: 90vh;
        display: flex; flex-direction: column;
        box-shadow: 0 20px 60px rgba(0,0,0,0.6);
        overflow: hidden;
    `;

    const header = document.createElement('div');
    header.style.cssText = `
        padding: 18px 22px 14px;
        border-bottom: 1px solid ${C2.hairline};
        display: flex; align-items: center; justify-content: space-between;
        flex-shrink: 0;
    `;
    const title = document.createElement('div');
    title.textContent = titleText;
    title.style.cssText = `font-size: 17px; font-weight: 700; color: ${C.text}; letter-spacing: 0.3px;`;
    const closeBtn = document.createElement('button');
    closeBtn.textContent = '×';
    closeBtn.style.cssText = `
        background: transparent; border: none;
        color: ${C.textMuted}; font-size: 26px;
        cursor: pointer; padding: 0 4px; line-height: 1;
    `;
    closeBtn.addEventListener('click', () => closeModal(overlay));
    header.appendChild(title);
    header.appendChild(closeBtn);
    modal.appendChild(header);

    const body = document.createElement('div');
    body.style.cssText = `padding: 18px 22px; overflow-y: auto; flex: 1; display: flex; flex-direction: column; gap: 14px;`;
    modal.appendChild(body);
    overlay.appendChild(modal);
    document.body.appendChild(overlay);

    modalStack.push(overlay);
    overlay._setAccent = (c) => { modal.style.borderLeftColor = c; };
    contentBuilder(body, modal, overlay);
    return overlay;
}

function closeModal(target) {
    if (modalStack.length === 0) return;
    const t = target || modalStack[modalStack.length - 1];
    const idx = modalStack.indexOf(t);
    if (idx === -1) return;
    modalStack.splice(idx, 1);
    if (t.parentNode) t.remove();
}

/* ─── FORM FIELDS ──────────────────────────────────────────── */
function buildTextField(parent, labelText, value, opts = {}) {
    const wrap = document.createElement('div');
    wrap.style.cssText = 'display: flex; flex-direction: column; gap: 6px;';
    const lbl = document.createElement('label');
    lbl.style.cssText = `font-size: 12px; font-weight: 600; color: ${C.textMuted}; letter-spacing: 0.3px;`;
    lbl.innerHTML = opts.required ? `${labelText} <span style="color:${C.verm};">*</span>` : labelText;
    wrap.appendChild(lbl);

    const input = opts.textarea ? document.createElement('textarea') : document.createElement('input');
    if (!opts.textarea) input.type = opts.type || 'text';
    input.value = value != null ? value : '';
    if (opts.placeholder) input.placeholder = opts.placeholder;
    input.style.cssText = `
        width: 100%; box-sizing: border-box;
        background: ${C.well};
        color: ${C.text};
        border: 1px solid ${C.border};
        border-radius: 6px;
        padding: 10px 14px;
        font-size: 15px;
        font-family: var(--font-body);
        outline: none;
        transition: border-color 0.15s ease;
        color-scheme: dark;
        ${opts.textarea ? 'resize: vertical; min-height: 60px;' : ''}
    `;
    input.addEventListener('focus', () => input.style.borderColor = C.gold);
    input.addEventListener('blur',  () => input.style.borderColor = C.border);
    wrap.appendChild(input);
    parent.appendChild(wrap);
    return { wrap, input };
}

function buildSelectField(parent, labelText, value, choices) {
    const wrap = document.createElement('div');
    wrap.style.cssText = 'display: flex; flex-direction: column; gap: 6px;';
    const lbl = document.createElement('label');
    lbl.style.cssText = `font-size: 12px; font-weight: 600; color: ${C.textMuted};`;
    lbl.textContent = labelText;
    wrap.appendChild(lbl);
    const sel = document.createElement('select');
    sel.style.cssText = `
        width: 100%; box-sizing: border-box;
        background: ${C.well}; color: ${C.text};
        border: 1px solid ${C.border};
        border-radius: 6px;
        padding: 10px 14px;
        font-size: 15px; font-family: var(--font-body);
        outline: none; cursor: pointer; color-scheme: dark;
    `;
    choices.forEach(c => {
        const o = document.createElement('option');
        o.value = c.value; o.textContent = c.label;
        if (c.value === value) o.selected = true;
        sel.appendChild(o);
    });
    sel.addEventListener('focus', () => sel.style.borderColor = C.gold);
    sel.addEventListener('blur',  () => sel.style.borderColor = C.border);
    wrap.appendChild(sel);
    parent.appendChild(wrap);
    return { wrap, input: sel };
}

function buildActiveChip(parent, initial, label = 'Active', colorOn = C.green) {
    const chip = document.createElement('label');
    const state = { checked: !!initial };
    const render = () => {
        chip.style.cssText = `
            display: inline-flex; align-items: center; gap: 8px;
            padding: 8px 14px; border-radius: 999px;
            background: ${state.checked ? withAlpha(colorOn, 0.15) : C.well};
            border: 1px solid ${state.checked ? colorOn : C.border};
            color: ${state.checked ? colorOn : C.textMuted};
            font-family: var(--font-body); font-size: 13px;
            font-weight: 600; cursor: pointer; user-select: none;
            align-self: flex-start;
            transition: all 0.15s ease;
        `;
    };
    render();
    const cb = document.createElement('input');
    cb.type = 'checkbox'; cb.checked = !!initial;
    cb.style.cssText = `accent-color: ${colorOn}; width: 14px; height: 14px; cursor: pointer;`;
    cb.addEventListener('change', () => { state.checked = cb.checked; render(); });
    chip.appendChild(cb);
    chip.appendChild(document.createTextNode(label));
    parent.appendChild(chip);
    return { wrap: chip, input: cb };
}

function buildToggle(initial, onChange) {
    const state = { on: !!initial };
    const wrap = document.createElement('button');
    wrap.type = 'button';
    wrap.style.cssText = `
        border: none; padding: 0; cursor: pointer;
        background: transparent;
        position: relative;
        width: 58px; height: 26px;
        border-radius: 999px;
    `;
    const track = document.createElement('div');
    track.style.cssText = `position: absolute; inset: 0; border-radius: 999px; transition: background 0.15s ease;`;
    wrap.appendChild(track);
    const label = document.createElement('span');
    label.style.cssText = `
        position: absolute; top: 50%; transform: translateY(-50%);
        font-family: ui-monospace, monospace; font-size: 10px;
        font-weight: 700; letter-spacing: 1px;
    `;
    wrap.appendChild(label);
    const knob = document.createElement('div');
    knob.style.cssText = `
        position: absolute; top: 3px;
        width: 20px; height: 20px; border-radius: 50%;
        transition: left 0.15s ease, background 0.15s ease;
    `;
    wrap.appendChild(knob);
    const render = () => {
        track.style.background = state.on ? C.green : withAlpha(C.text, 0.12);
        label.textContent = state.on ? 'ON' : 'OFF';
        label.style.color = state.on ? C.well : C.textMuted;
        label.style.left  = state.on ? '10px' : 'auto';
        label.style.right = state.on ? 'auto' : '10px';
        knob.style.left       = state.on ? 'calc(100% - 23px)' : '3px';
        knob.style.background = state.on ? C.card : C.textMuted;
    };
    render();
    wrap.addEventListener('click', () => { state.on = !state.on; render(); if (onChange) onChange(state.on); });
    return { wrap, isOn: () => state.on, setOn: (v) => { state.on = !!v; render(); } };
}

/* ─── CHIP TRAY + PICKER (unchanged from v1) ───────────────── */
function buildChipTray(container, initialIds, sourceFn, opts = {}) {
    const state = { ids: [...(initialIds || [])] };
    const header = document.createElement('div');
    header.style.cssText = 'display: flex; justify-content: flex-end; margin-bottom: 4px;';
    const addBtn = buildPillButton(opts.addLabel || '+ Add', 'ghost',
        () => openPickerModal(state.ids, sourceFn, opts, (newIds) => {
            state.ids = newIds;
            render();
            if (opts.onChange) opts.onChange(state.ids);
        }), { small: true });
    if (opts.accent) {
        addBtn.style.color = opts.accent;
        addBtn.style.borderColor = opts.accent;
    }
    addBtn.style.padding = '6px 14px';
    addBtn.style.fontSize = '10px';
    header.appendChild(addBtn);
    container.appendChild(header);

    const tray = document.createElement('div');
    tray.style.cssText = `
        background: ${C.well};
        border: 1px dashed ${withAlpha(C.text, 0.12)};
        border-radius: 6px;
        padding: 10px;
        display: flex; flex-wrap: wrap; gap: 6px;
        min-height: 48px; align-items: center;
    `;
    container.appendChild(tray);

    function render() {
        tray.innerHTML = '';
        if (state.ids.length === 0) {
            const empty = document.createElement('div');
            empty.textContent = opts.emptyHint || 'None selected — tap + ADD';
            empty.style.cssText = `
                font-family: ui-monospace, monospace;
                font-size: 11px; color: ${C.textDim};
                padding: 2px 4px;
                letter-spacing: 1.5px; text-transform: uppercase;
                font-weight: 700;
            `;
            tray.appendChild(empty);
            return;
        }
        const all = sourceFn();
        state.ids.forEach(id => {
            const rec = all.find(a => a.id === id);
            const flagged = opts.flagIds && opts.flagIds().includes(id);
            const borderColor = flagged ? C2.warning : (opts.accent || C.green);
            const chip = document.createElement('span');
            chip.style.cssText = `
                display: inline-flex; align-items: center; gap: 6px;
                padding: 6px 8px 6px 12px;
                background: ${C.card};
                border: 1px solid ${borderColor};
                border-radius: 999px;
                font-family: var(--font-body);
                font-size: 12px; font-weight: 600;
                color: ${C.text};
            `;
            if (rec && rec.extra) {
                const e = document.createElement('span');
                e.textContent = rec.extra;
                e.style.cssText = `
                    color: ${flagged ? C2.warning : C.gold};
                    font-family: ui-monospace, monospace;
                    font-size: 11px; margin-right: 2px;
                    white-space: nowrap;
                `;
                chip.appendChild(e);
            }
            const n = document.createElement('span');
            n.textContent = rec ? rec.name : id;
            chip.appendChild(n);
            const x = document.createElement('button');
            x.type = 'button'; x.textContent = '×';
            x.style.cssText = `background: transparent; border: none; color: ${C.textMuted}; cursor: pointer; font-size: 15px; line-height: 1; padding: 0 2px;`;
            x.addEventListener('click', (ev) => {
                ev.stopPropagation();
                state.ids = state.ids.filter(i => i !== id);
                render();
                if (opts.onChange) opts.onChange(state.ids);
            });
            chip.appendChild(x);
            tray.appendChild(chip);
        });
    }

    render();
    return {
        getIds:   () => state.ids.slice(),
        setIds:   (ids) => { state.ids = [...(ids || [])]; render(); },
        rerender: render,
    };
}

function openPickerModal(currentIds, sourceFn, opts, onDone) {
    const all = sourceFn();
    openModal(opts.pickerTitle || 'Pick items', (body) => {
        const selected   = new Set(currentIds);
        const originally = new Set(currentIds);

        const search = document.createElement('input');
        search.type = 'text'; search.placeholder = 'Search…';
        search.style.cssText = `
            width: 100%; box-sizing: border-box;
            background: ${C.well};
            border: 1px solid ${C.border};
            border-radius: 6px;
            padding: 10px 14px;
            color: ${C.text};
            font-family: var(--font-body);
            font-size: 14px; outline: none;
        `;
        search.addEventListener('focus', () => search.style.borderColor = C.gold);
        search.addEventListener('blur',  () => search.style.borderColor = C.border);
        body.appendChild(search);

        const delta = document.createElement('div');
        delta.style.cssText = `
            padding: 10px 14px;
            background: ${C.well};
            border-radius: 6px;
            font-family: ui-monospace, monospace;
            font-size: 11px;
            letter-spacing: 1.5px;
            text-transform: uppercase;
            font-weight: 700;
            color: ${C.textMuted};
            display: flex; gap: 14px; flex-wrap: wrap;
        `;
        body.appendChild(delta);

        const list = document.createElement('div');
        list.style.cssText = `max-height: 360px; overflow-y: auto; display: flex; flex-direction: column; gap: 4px;`;
        body.appendChild(list);

        function renderDelta() {
            const added   = [...selected].filter(id => !originally.has(id)).length;
            const removed = [...originally].filter(id => !selected.has(id)).length;
            const total   = selected.size;
            const parts = [];
            if (added)   parts.push(`<span style="color:${C.greenUp};">+${added} added</span>`);
            if (removed) parts.push(`<span style="color:${C.verm};">−${removed} removed</span>`);
            if (!added && !removed) parts.push(`<span style="color:${C.textDim};">no changes</span>`);
            parts.push(`<span style="color:${C.textDim};">· ${total} total</span>`);
            delta.innerHTML = parts.join('  ');
        }

        function renderList() {
            list.innerHTML = '';
            const q = search.value.trim().toLowerCase();
            const filtered = q ? all.filter(a => a.name.toLowerCase().includes(q)) : all;
            if (filtered.length === 0) {
                const empty = document.createElement('div');
                empty.textContent = q ? 'No matches' : 'Nothing available';
                empty.style.cssText = `
                    font-family: ui-monospace, monospace;
                    font-size: 12px; color: ${C.textDim};
                    text-align: center; padding: 24px 0;
                    letter-spacing: 1.5px; text-transform: uppercase;
                `;
                list.appendChild(empty);
                return;
            }
            filtered.forEach(rec => {
                const isSel = selected.has(rec.id);
                const wasSel = originally.has(rec.id);
                const bg = (isSel && !wasSel) ? withAlpha(C.greenUp, 0.08)
                         : (!isSel && wasSel) ? withAlpha(C.verm, 0.08)
                         : C.well;
                const border = (isSel && !wasSel) ? C.greenUp
                             : (!isSel && wasSel) ? C.verm
                             : 'transparent';
                const row = document.createElement('button');
                row.type = 'button';
                row.style.cssText = `
                    display: flex; align-items: center; gap: 12px;
                    padding: 10px 14px;
                    background: ${bg};
                    border: 1px solid ${border};
                    border-left: 3px solid ${isSel ? (opts.accent || C.green) : 'transparent'};
                    border-radius: 6px;
                    cursor: pointer; width: 100%; text-align: left;
                    font-family: var(--font-body);
                    transition: background 0.1s ease;
                `;
                const box = document.createElement('div');
                box.style.cssText = `
                    width: 18px; height: 18px;
                    border: 2px solid ${isSel ? C.green : C.textDim};
                    border-radius: 4px;
                    display: flex; align-items: center; justify-content: center;
                    background: ${isSel ? C.green : 'transparent'};
                    flex-shrink: 0;
                `;
                if (isSel) {
                    const check = document.createElement('span');
                    check.textContent = '✓';
                    check.style.cssText = `color: ${C.well}; font-size: 13px; font-weight: 900;`;
                    box.appendChild(check);
                }
                row.appendChild(box);

                const name = document.createElement('span');
                name.textContent = rec.name;
                name.style.cssText = `flex: 1; color: ${C.text}; font-size: 14px; font-weight: 600;`;
                row.appendChild(name);

                if (rec.extra) {
                    const ex = document.createElement('span');
                    ex.textContent = rec.extra;
                    ex.style.cssText = `color: ${rec.extraColor || C.gold}; font-family: ui-monospace, monospace; font-size: 12px;`;
                    row.appendChild(ex);
                }

                if (isSel && !wasSel) {
                    const bdg = document.createElement('span');
                    bdg.textContent = '+ NEW';
                    bdg.style.cssText = `font-family: ui-monospace, monospace; font-size: 9px; color: ${C.greenUp}; letter-spacing: 1.5px; font-weight: 700;`;
                    row.appendChild(bdg);
                } else if (!isSel && wasSel) {
                    const bdg = document.createElement('span');
                    bdg.textContent = '− REMOVE';
                    bdg.style.cssText = `font-family: ui-monospace, monospace; font-size: 9px; color: ${C.verm}; letter-spacing: 1.5px; font-weight: 700;`;
                    row.appendChild(bdg);
                }

                row.addEventListener('click', () => {
                    if (selected.has(rec.id)) selected.delete(rec.id);
                    else selected.add(rec.id);
                    renderList();
                    renderDelta();
                });
                list.appendChild(row);
            });
        }

        search.addEventListener('input', renderList);
        renderList();
        renderDelta();

        const footer = document.createElement('div');
        footer.style.cssText = `display: flex; gap: 10px; justify-content: flex-end; padding-top: 8px; border-top: 1px solid ${C2.hairline}; margin-top: 4px;`;
        footer.appendChild(buildPillButton('Cancel', 'tertiary', () => closeModal(), { small: true }));
        footer.appendChild(buildPillButton('Apply', 'confirm', () => { onDone(Array.from(selected)); closeModal(); }, { small: true }));
        body.appendChild(footer);
    }, { wide: true, accent: opts.accent || C.green });
}

/* ─── ITEM MODAL (unchanged from v1) ────────────────────────── */
function openEditItemModal(itemId) {
    const item = getWorkingItem(itemId);
    if (!item) return;
    openItemModal({ title: `Edit item: ${item.name}`, source: item, onSave: (u) => handleEdit(u), showActions: true });
}

function openAddItemModal(preselectedCategoryId) {
    const draft = {
        id:                    `temp_item_${Date.now()}`,
        name:                  '',
        price:                 0,
        description:            '',
        category_id:           preselectedCategoryId || (menuData.categories[0] && menuData.categories[0].id) || '',
        active:                true,
        display_order:         999,
        mandatory_group_ids:   [],
        included_modifier_ids: [],
    };
    openItemModal({ title: 'Add item', source: draft, onSave: (n) => handleCreate(n), showActions: false });
}

function openItemModal(cfg) {
    const item = clone(cfg.source);
    const state = {
        currentCategoryColor: (menuData.categories.find(c => c.id === item.category_id) || {}).color || C.gold,
        mandatoryCache:       item.mandatory_group_ids.slice(),
        includedCache:        item.included_modifier_ids.slice(),
    };

    const overlay = openModal(cfg.title, (body, modalEl, ov) => {
        const categoryChoices = menuData.categories
            .sort((a,b) => a.display_order - b.display_order)
            .map(c => ({ value: c.id, label: c.name }));

        const nameField = buildTextField(body, 'Item name', item.name, { required: true });

        const rowWrap = document.createElement('div');
        rowWrap.style.cssText = 'display: flex; gap: 12px;';
        const priceCol = document.createElement('div'); priceCol.style.cssText = 'flex: 0 0 44%; min-width: 0;';
        const catCol   = document.createElement('div'); catCol.style.cssText = 'flex: 1; min-width: 0;';
        rowWrap.appendChild(priceCol); rowWrap.appendChild(catCol);
        body.appendChild(rowWrap);

        const priceField = buildTextField(priceCol, 'Price', Number(item.price).toFixed(2), { type: 'text', inputmode: 'decimal' });
        // Centavo-style entry: digits shift right of decimal; backspace unshifts.
        // Typing 1→5→0 yields $0.01→$0.15→$1.50, preventing the common
        // "$10.00 instead of $1.00" mistake on a touchscreen numpad.
        let _priceCents = Math.round((Number(item.price) || 0) * 100);
        priceField.input.addEventListener('keydown', function(e) {
            if (e.key >= '0' && e.key <= '9') {
                e.preventDefault();
                if (_priceCents < 9999999) _priceCents = _priceCents * 10 + Number(e.key);
                priceField.input.value = (_priceCents / 100).toFixed(2);
            } else if (e.key === 'Backspace') {
                e.preventDefault();
                _priceCents = Math.floor(_priceCents / 10);
                priceField.input.value = (_priceCents / 100).toFixed(2);
            }
        });
        priceField.input.addEventListener('focus', () => priceField.input.select());
        const catField   = buildSelectField(catCol, 'Category', item.category_id, categoryChoices);

        const descField   = buildTextField(body, 'Description', item.description, { textarea: true });
        const activeField = buildActiveChip(body, item.active);

        body.appendChild(buildDivider());

        // MANDATORY GROUPS
        const mandSection = document.createElement('div');
        mandSection.style.cssText = 'display: flex; flex-direction: column; gap: 10px;';
        body.appendChild(mandSection);

        const mandHead = buildSectionHead('MANDATORY GROUPS', state.currentCategoryColor);
        mandSection.appendChild(mandHead.wrap);

        const mandHint = document.createElement('div');
        mandHint.textContent = 'Server must resolve these before sending.';
        mandHint.style.cssText = `font-size: 11px; color: ${C.textDim};`;
        mandSection.appendChild(mandHint);

        const mandTrayWrap = document.createElement('div');
        mandTrayWrap.style.cssText = 'display: flex; flex-direction: column; gap: 6px;';
        mandSection.appendChild(mandTrayWrap);

        const warnBanner = document.createElement('div');
        warnBanner.style.display = 'none';
        mandSection.appendChild(warnBanner);

        let mandTray = null;
        let includedTrayApi = null;
        const groupSource = () => menuData.allGroups.map(g => ({
            id: g.id, name: g.name + (g.drives_pricing ? '  ⬥' : ''),
            extra: g.member_count > 0 ? `${g.member_count}` : null,
            extraColor: C.textDim,
        }));

        function rebuildMandTray(ids) {
            mandTrayWrap.innerHTML = '';
            mandTray = buildChipTray(mandTrayWrap, ids, groupSource, {
                accent:      state.currentCategoryColor,
                pickerTitle: 'Pick mandatory groups',
                emptyHint:   'No mandatory groups — tap + ADD',
                addLabel:    '+ Add',
                onChange: (newIds) => {
                    state.mandatoryCache = newIds.slice();
                    item.mandatory_group_ids = newIds.slice();
                    if (includedTrayApi) includedTrayApi.rerender();
                    refreshWarning();
                },
            });
        }

        function updateMandVis(on) {
            mandHint.style.display = on ? '' : 'none';
            mandTrayWrap.style.display = on ? '' : 'none';
            if (!on) {
                if (mandTray) state.mandatoryCache = mandTray.getIds();
                item.mandatory_group_ids = [];
            } else {
                item.mandatory_group_ids = state.mandatoryCache.slice();
                if (mandTray) mandTray.setIds(item.mandatory_group_ids);
            }
            refreshWarning();
        }

        rebuildMandTray(item.mandatory_group_ids);
        mandHead.toggle.setOn(item.mandatory_group_ids.length > 0);
        updateMandVis(item.mandatory_group_ids.length > 0);
        mandHead.toggle.wrap.addEventListener('click', () => {
            setTimeout(() => updateMandVis(mandHead.toggle.isOn()), 0);
        });

        body.appendChild(buildDivider());

        // INCLUDED MODIFIERS
        const incSection = document.createElement('div');
        incSection.style.cssText = 'display: flex; flex-direction: column; gap: 10px;';
        body.appendChild(incSection);

        const incHead = buildSectionHead('INCLUDED MODIFIERS', C2.lavender);
        incSection.appendChild(incHead.wrap);

        const incHint = document.createElement('div');
        incHint.textContent = 'Pre-added on the check. Tap at terminal removes.';
        incHint.style.cssText = `font-size: 11px; color: ${C.textDim};`;
        incSection.appendChild(incHint);

        const incTrayWrap = document.createElement('div');
        incTrayWrap.style.cssText = 'display: flex; flex-direction: column; gap: 6px;';
        incSection.appendChild(incTrayWrap);

        const atomSource = () => menuData.allModifiers.map(a => ({
            id: a.id, name: a.name, extra: atomPriceDisplay(a, item),
        }));

        function rebuildIncTray(ids) {
            incTrayWrap.innerHTML = '';
            includedTrayApi = buildChipTray(incTrayWrap, ids, atomSource, {
                accent:      C.green,
                pickerTitle: 'Pick included modifiers',
                emptyHint:   'No included modifiers — tap + ADD',
                addLabel:    '+ Add',
                flagIds:     () => mismatchedAtoms(item),
                onChange: (newIds) => {
                    state.includedCache = newIds.slice();
                    item.included_modifier_ids = newIds.slice();
                    refreshWarning();
                },
            });
        }

        function updateIncVis(on) {
            incHint.style.display = on ? '' : 'none';
            incTrayWrap.style.display = on ? '' : 'none';
            if (!on) {
                if (includedTrayApi) state.includedCache = includedTrayApi.getIds();
                item.included_modifier_ids = [];
            } else {
                item.included_modifier_ids = state.includedCache.slice();
                if (includedTrayApi) includedTrayApi.setIds(item.included_modifier_ids);
            }
            refreshWarning();
        }

        rebuildIncTray(item.included_modifier_ids);
        incHead.toggle.setOn(item.included_modifier_ids.length > 0);
        updateIncVis(item.included_modifier_ids.length > 0);
        incHead.toggle.wrap.addEventListener('click', () => {
            setTimeout(() => updateIncVis(incHead.toggle.isOn()), 0);
        });

        function refreshWarning() {
            const flagged = mismatchedAtoms(item);
            if (flagged.length === 0) { warnBanner.style.display = 'none'; return; }
            const names = flagged.slice(0, 3)
                .map(aid => (menuData.atomsById[aid] && menuData.atomsById[aid].name) || aid);
            const extra = flagged.length > 3 ? `, +${flagged.length - 3} more` : '';
            warnBanner.style.display = '';
            warnBanner.style.cssText = `
                display: flex; gap: 12px; padding: 12px 14px;
                background: ${C2.warningBg};
                border-left: 3px solid ${C2.warning};
                border-radius: 6px; align-items: flex-start;
            `;
            warnBanner.innerHTML = `
                <div style="color:${C2.warning};font-size:18px;line-height:1.1;flex-shrink:0;">⚠</div>
                <div>
                    <div style="color:${C2.warning};font-family:ui-monospace,monospace;font-size:11px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;margin-bottom:4px;">
                        Size-variable atom${flagged.length === 1 ? '' : 's'} without a size group
                    </div>
                    <div style="color:${withAlpha(C.text,0.7)};font-size:12px;line-height:1.5;">
                        <span style="color:${C2.warning};font-family:ui-monospace,monospace;font-weight:600;">${names.join(', ')}${extra}</span>
                        ${flagged.length === 1 ? 'has' : 'have'} per-size pricing but this item has no mandatory group that drives pricing. Price will fall back to base.
                    </div>
                </div>
            `;
            if (includedTrayApi) includedTrayApi.rerender();
        }
        refreshWarning();

        catField.input.addEventListener('change', () => {
            item.category_id = catField.input.value;
            const cat = menuData.categories.find(c => c.id === item.category_id);
            state.currentCategoryColor = (cat && cat.color) || C.gold;
            mandHead.label.style.color = state.currentCategoryColor;
            if (mandTray) rebuildMandTray(item.mandatory_group_ids);
        });

        if (cfg.showActions) {
            body.appendChild(buildDivider());
            const actions = document.createElement('div');
            actions.style.cssText = 'display: flex; gap: 10px;';
            const delBtn = buildPillButton('Delete item', 'danger', () => { handleDelete(item.id); closeModal(ov); });
            delBtn.style.flex = '1'; actions.appendChild(delBtn);
            const dupBtn = buildPillButton('Duplicate item', 'secondary', () => {
                handleDuplicate(gather()); closeModal(ov);
            });
            dupBtn.style.flex = '1'; actions.appendChild(dupBtn);
            body.appendChild(actions);
        }

        const footer = document.createElement('div');
        footer.style.cssText = `display: flex; gap: 10px; justify-content: flex-end; padding-top: 14px; border-top: 1px solid ${C2.hairline}; margin-top: 6px;`;
        footer.appendChild(buildPillButton('Cancel', 'tertiary', () => closeModal(ov), { small: true }));
        footer.appendChild(buildPillButton(cfg.showActions ? 'Save' : 'Create', 'primary', () => {
            const g = gather();
            if (!g.name) { nameField.input.style.borderColor = C.verm; return; }
            if (g.price < 0) { priceField.input.style.borderColor = C.verm; return; }
            cfg.onSave(g); closeModal(ov);
        }, { small: true }));
        body.appendChild(footer);

        function gather() {
            return {
                ...item,
                name:        nameField.input.value.trim(),
                price:       _priceCents / 100,
                category_id: catField.input.value,
                description: descField.input.value.trim(),
                active:      activeField.input.checked,
                mandatory_group_ids:   mandHead.toggle.isOn() ? (mandTray ? mandTray.getIds() : []) : [],
                included_modifier_ids: incHead.toggle.isOn()  ? (includedTrayApi ? includedTrayApi.getIds() : []) : [],
            };
        }
    }, { accent: C.gold });
    overlay._setAccent(C.gold);
}

function buildSectionHead(labelText, color) {
    const wrap = document.createElement('div');
    wrap.style.cssText = 'display: flex; align-items: center; justify-content: space-between; gap: 12px;';
    const label = document.createElement('div');
    label.textContent = labelText;
    label.style.cssText = `
        font-family: ui-monospace, monospace;
        font-size: 13px; font-weight: 700;
        letter-spacing: 2.5px; text-transform: uppercase;
        color: ${color};
    `;
    wrap.appendChild(label);
    const toggle = buildToggle(false);
    wrap.appendChild(toggle.wrap);
    return { wrap, label, toggle };
}

function buildDivider() {
    const d = document.createElement('div');
    d.style.cssText = `height: 1px; background: ${C2.hairline}; margin: 4px 0;`;
    return d;
}

/* ─── CATEGORY MODAL ────────────────────────────────────────── */
function openAddCategoryModal() {
    const draft = {
        id:                  null,
        name:                '',
        display_order:       menuData.categories.length + 1,
        color:               '#fcbe40',
        enable_placement:    false,
        universal_group_ids: [],
        schedule:            defaultSchedule(),
        special_active:      false,
        special_label:       '',
        _isCategory: true,
        _isNew:      true,
    };
    openCategoryModal({ title: 'Add category', source: draft, onSave: (n) => handleCreateCategory(n), isNew: true });
}

function openEditCategoryModal(cat) {
    const working = getAllWorkingCategories().find(c => c.id === cat.id) || cat;
    openCategoryModal({
        title: `Edit category: ${working.name}`,
        source: { ...clone(working), _isCategory: true },
        onSave: (u) => handleEditCategory(u),
        isNew: false,
    });
}

function openCategoryModal(cfg) {
    const cat = clone(cfg.source);
    if (!cat.schedule) cat.schedule = defaultSchedule();

    const overlay = openModal(cfg.title, (body, modalEl, ov) => {
        const nameField = buildTextField(body, 'Category name', cat.name, { required: true });

        // ── Color picker
        const colorWrap = document.createElement('div');
        colorWrap.style.cssText = 'display: flex; flex-direction: column; gap: 8px;';
        const colorLbl = document.createElement('div');
        colorLbl.textContent = 'Color';
        colorLbl.style.cssText = `font-size: 12px; font-weight: 600; color: ${C.textMuted};`;
        colorWrap.appendChild(colorLbl);

        const swatchRow = document.createElement('div');
        swatchRow.style.cssText = 'display: flex; flex-wrap: wrap; gap: 8px; align-items: center;';
        const swatches = [];
        CATEGORY_COLORS.forEach(hex => {
            const sw = document.createElement('button');
            sw.type = 'button'; sw.dataset.color = hex;
            sw.style.cssText = `
                width: 30px; height: 30px; border-radius: 6px;
                background: ${hex}; border: none; cursor: pointer; padding: 0;
                transition: transform 0.1s ease, box-shadow 0.15s ease;
            `;
            sw.addEventListener('click', () => selectColor(hex));
            swatchRow.appendChild(sw);
            swatches.push(sw);
        });
        const hexInput = document.createElement('input');
        hexInput.type = 'text'; hexInput.value = cat.color;
        hexInput.style.cssText = `
            background: ${C.well}; border: 1px solid ${C.border}; border-radius: 6px;
            padding: 6px 10px; color: ${C.text};
            font-family: ui-monospace, monospace; font-size: 12px;
            width: 88px; outline: none; color-scheme: dark;
        `;
        hexInput.addEventListener('input', () => {
            const v = hexInput.value.trim();
            if (/^#[0-9a-fA-F]{6}$/.test(v)) selectColor(v, false);
        });
        swatchRow.appendChild(hexInput);
        colorWrap.appendChild(swatchRow);
        body.appendChild(colorWrap);

        function selectColor(hex, syncInput = true) {
            cat.color = hex;
            if (syncInput) hexInput.value = hex;
            swatches.forEach(s => {
                const on = s.dataset.color === hex;
                s.style.boxShadow = on ? `0 0 0 2px ${C.text}, 0 0 0 4px ${C.bg}` : 'none';
                s.style.transform = on ? 'scale(1.1)' : '';
            });
            if (ov._setAccent) ov._setAccent(hex);
            uniHead.label.style.color = hex;
            schedHead.label.style.color = hex;
            if (uniTray) rebuildUniTray(cat.universal_group_ids);
            renderScheduleWindows();
        }

        // ── Placement toggle
        const placeChip = buildActiveChip(body, cat.enable_placement, 'Enable placement bar', C.green);
        const placeHint = document.createElement('div');
        placeHint.textContent = 'Shows ½ LEFT / WHOLE / ½ RIGHT on modifier panel (pizza-style).';
        placeHint.style.cssText = `font-size: 11px; color: ${C.textDim}; margin-top: -8px;`;
        body.appendChild(placeHint);

        body.appendChild(buildDivider());

        // ── Universal groups
        const uniSection = document.createElement('div');
        uniSection.style.cssText = 'display: flex; flex-direction: column; gap: 10px;';
        body.appendChild(uniSection);

        const uniHead = buildSectionHead('UNIVERSAL GROUPS', cat.color);
        uniSection.appendChild(uniHead.wrap);

        const uniHint = document.createElement('div');
        uniHint.textContent = 'Apply to every item in this category. Inherited at the terminal.';
        uniHint.style.cssText = `font-size: 11px; color: ${C.textDim};`;
        uniSection.appendChild(uniHint);

        const uniTrayWrap = document.createElement('div');
        uniTrayWrap.style.cssText = 'display: flex; flex-direction: column; gap: 6px;';
        uniSection.appendChild(uniTrayWrap);

        let uniTray = null;
        const groupSource = () => menuData.allGroups.map(g => ({
            id: g.id, name: g.name,
            extra: g.member_count > 0 ? `${g.member_count}` : null,
            extraColor: C.textDim,
        }));

        function rebuildUniTray(ids) {
            uniTrayWrap.innerHTML = '';
            uniTray = buildChipTray(uniTrayWrap, ids, groupSource, {
                accent:      cat.color,
                pickerTitle: 'Pick universal groups',
                emptyHint:   'No universal groups — tap + ADD',
                addLabel:    '+ Add',
                onChange: (newIds) => { cat.universal_group_ids = newIds.slice(); },
            });
        }

        function updateUniVis(on) {
            uniHint.style.display = on ? '' : 'none';
            uniTrayWrap.style.display = on ? '' : 'none';
            if (!on) cat.universal_group_ids = [];
        }
        rebuildUniTray(cat.universal_group_ids);
        uniHead.toggle.setOn(cat.universal_group_ids.length > 0);
        updateUniVis(cat.universal_group_ids.length > 0);
        uniHead.toggle.wrap.addEventListener('click', () => {
            setTimeout(() => updateUniVis(uniHead.toggle.isOn()), 0);
        });

        body.appendChild(buildDivider());

        // ── Schedule + Special
        const schedSection = document.createElement('div');
        schedSection.style.cssText = 'display: flex; flex-direction: column; gap: 10px;';
        body.appendChild(schedSection);

        const schedHead = buildSectionHead('SCHEDULE', cat.color);
        schedSection.appendChild(schedHead.wrap);

        const schedHint = document.createElement('div');
        schedHint.textContent = 'Category is active during any of these windows. Outside them, items auto-86.';
        schedHint.style.cssText = `font-size: 11px; color: ${C.textDim};`;
        schedSection.appendChild(schedHint);

        const windowsWrap = document.createElement('div');
        windowsWrap.style.cssText = 'display: flex; flex-direction: column; gap: 10px;';
        schedSection.appendChild(windowsWrap);

        const addWindowBtn = document.createElement('button');
        addWindowBtn.type = 'button';
        addWindowBtn.textContent = '+ Add window';
        addWindowBtn.style.cssText = `
            padding: 10px 14px;
            background: transparent;
            border: 1px dashed ${withAlpha(C.text, 0.2)};
            border-radius: 8px;
            color: ${withAlpha(C.text, 0.7)};
            font-family: ui-monospace, monospace;
            font-size: 11px; font-weight: 700;
            letter-spacing: 1.5px; cursor: pointer;
            align-self: flex-start;
        `;
        addWindowBtn.addEventListener('mouseenter', () => {
            addWindowBtn.style.borderColor = cat.color;
            addWindowBtn.style.color = cat.color;
        });
        addWindowBtn.addEventListener('mouseleave', () => {
            addWindowBtn.style.borderColor = withAlpha(C.text, 0.2);
            addWindowBtn.style.color = withAlpha(C.text, 0.7);
        });
        addWindowBtn.addEventListener('click', () => {
            cat.schedule.windows.push(defaultWindow());
            renderScheduleWindows();
        });
        schedSection.appendChild(addWindowBtn);

        const graceRow = document.createElement('div');
        graceRow.style.cssText = 'display: flex; gap: 12px; align-items: flex-end; padding-top: 4px;';
        const graceField = buildTextField(graceRow, 'Grace period (min)', cat.schedule.grace_minutes, { type: 'number' });
        graceField.wrap.style.flex = '0 0 140px';
        graceField.input.style.width = '80px';
        const graceHint = document.createElement('div');
        graceHint.style.cssText = `flex: 1; font-size: 11px; color: ${C.textDim}; padding-bottom: 10px;`;
        graceHint.textContent = 'Minutes past each window\'s end that servers can still add items.';
        graceRow.appendChild(graceHint);
        schedSection.appendChild(graceRow);
        graceField.input.addEventListener('input', () => {
            cat.schedule.grace_minutes = parseInt(graceField.input.value) || 0;
        });

        // Special row
        const specialRow = document.createElement('div');
        specialRow.style.cssText = 'display: flex; gap: 12px; align-items: flex-end; padding-top: 8px;';
        const specialChip = buildActiveChip(specialRow, cat.special_active, 'Special today', C.gold);
        const specialLabelWrap = document.createElement('div');
        specialLabelWrap.style.cssText = 'flex: 1;';
        const specialLabelField = buildTextField(specialLabelWrap, 'Label', cat.special_label, { placeholder: 'e.g. Summer BBQ' });
        specialRow.appendChild(specialLabelWrap);
        schedSection.appendChild(specialRow);
        specialChip.input.addEventListener('change', () => { cat.special_active = specialChip.input.checked; });
        specialLabelField.input.addEventListener('input', () => { cat.special_label = specialLabelField.input.value; });

        function renderScheduleWindows() {
            windowsWrap.innerHTML = '';
            cat.schedule.windows.forEach((win, idx) => {
                windowsWrap.appendChild(buildWindowBlock(win, idx));
            });
        }

        function buildWindowBlock(win, idx) {
            const block = document.createElement('div');
            block.style.cssText = `
                background: rgba(34,37,42,0.4);
                border: 1px solid ${withAlpha(C.text, 0.08)};
                border-radius: 8px;
                padding: 12px 14px;
                display: flex; flex-direction: column; gap: 10px;
                position: relative;
            `;

            const wlbl = document.createElement('div');
            wlbl.textContent = `Window ${idx + 1}${win.label ? ' · ' + win.label : ''}`;
            wlbl.style.cssText = `
                font-family: ui-monospace, monospace;
                font-size: 10px; font-weight: 700;
                letter-spacing: 2px;
                color: ${withAlpha(C.text, 0.4)};
                text-transform: uppercase;
            `;
            block.appendChild(wlbl);

            const removeBtn = document.createElement('button');
            removeBtn.type = 'button'; removeBtn.textContent = '×';
            const canRemove = cat.schedule.windows.length > 1;
            removeBtn.style.cssText = `
                position: absolute; top: 10px; right: 12px;
                background: transparent; border: none;
                color: ${withAlpha(C.text, 0.4)};
                font-size: 16px; line-height: 1;
                cursor: ${canRemove ? 'pointer' : 'not-allowed'};
                padding: 2px 4px;
                opacity: ${canRemove ? '1' : '0.25'};
            `;
            if (canRemove) {
                removeBtn.addEventListener('click', () => {
                    cat.schedule.windows.splice(idx, 1);
                    renderScheduleWindows();
                });
            }
            block.appendChild(removeBtn);

            // Label field
            const labelRow = document.createElement('div');
            labelRow.style.cssText = 'display: flex; gap: 8px;';
            const labelField = buildTextField(labelRow, 'Label (optional)', win.label, { placeholder: 'e.g. weekday lunch' });
            labelField.input.addEventListener('input', () => {
                win.label = labelField.input.value;
                wlbl.textContent = `Window ${idx + 1}${win.label ? ' · ' + win.label : ''}`;
            });
            block.appendChild(labelRow);

            // Day chips
            const daysWrap = document.createElement('div');
            daysWrap.style.cssText = 'display: flex; flex-direction: column; gap: 6px;';
            const daysLbl = document.createElement('div');
            daysLbl.textContent = 'Active days';
            daysLbl.style.cssText = `font-size: 12px; font-weight: 600; color: ${C.textMuted};`;
            daysWrap.appendChild(daysLbl);

            const chipsRow = document.createElement('div');
            chipsRow.style.cssText = 'display: flex; gap: 4px; flex-wrap: wrap;';
            DAY_LABELS.forEach((lbl, i) => {
                const chip = document.createElement('button');
                chip.type = 'button';
                chip.textContent = lbl;
                const renderChip = () => {
                    const on = win.days[i] === 1;
                    chip.style.cssText = `
                        width: 40px; padding: 8px 0;
                        background: ${on ? withAlpha(C.green, 0.15) : C.well};
                        border: 1px solid ${on ? C.green : withAlpha(C.text, 0.08)};
                        border-radius: 6px;
                        color: ${on ? C.green : C.textMuted};
                        font-family: ui-monospace, monospace;
                        font-size: 11px; font-weight: 700;
                        letter-spacing: 1px; text-align: center;
                        cursor: pointer;
                    `;
                };
                renderChip();
                chip.addEventListener('click', () => {
                    win.days[i] = win.days[i] ? 0 : 1;
                    renderChip();
                });
                chipsRow.appendChild(chip);
            });
            daysWrap.appendChild(chipsRow);
            block.appendChild(daysWrap);

            // Times row + price adj
            const timesRow = document.createElement('div');
            timesRow.style.cssText = 'display: flex; gap: 12px; align-items: flex-end; flex-wrap: wrap;';

            const startCol = document.createElement('div');
            startCol.style.flex = '0 0 100px';
            const startField = buildTextField(startCol, 'Start', win.start, { type: 'time' });
            startField.input.addEventListener('input', () => { win.start = startField.input.value; });
            timesRow.appendChild(startCol);

            const arrow = document.createElement('div');
            arrow.textContent = '→';
            arrow.style.cssText = `padding: 0 4px 10px 4px; color: ${withAlpha(C.text, 0.4)};`;
            timesRow.appendChild(arrow);

            const endCol = document.createElement('div');
            endCol.style.flex = '0 0 100px';
            const endField = buildTextField(endCol, 'End', win.end, { type: 'time' });
            endField.input.addEventListener('input', () => { win.end = endField.input.value; });
            timesRow.appendChild(endCol);

            const priceCol = document.createElement('div');
            priceCol.style.flex = '0 0 100px';
            const priceLbl = document.createElement('div');
            priceLbl.textContent = 'Price adj.';
            priceLbl.style.cssText = `font-size: 12px; font-weight: 600; color: ${C.textMuted}; margin-bottom: 6px;`;
            priceCol.appendChild(priceLbl);
            const priceRow = document.createElement('div');
            priceRow.style.cssText = 'display: flex; gap: 4px; align-items: center;';
            const priceInput = document.createElement('input');
            priceInput.type = 'number';
            priceInput.value = win.price_adjustment_pct || 0;
            priceInput.style.cssText = `
                width: 60px; box-sizing: border-box;
                background: ${C.well}; color: ${C.text};
                border: 1px solid ${C.border};
                border-radius: 6px; padding: 10px 8px;
                font-family: var(--font-body); font-size: 15px;
                outline: none; color-scheme: dark;
            `;
            priceInput.addEventListener('focus', () => priceInput.style.borderColor = C.gold);
            priceInput.addEventListener('blur',  () => priceInput.style.borderColor = C.border);
            priceInput.addEventListener('input', () => {
                win.price_adjustment_pct = parseFloat(priceInput.value) || 0;
                updatePriceHint();
            });
            priceRow.appendChild(priceInput);
            const pct = document.createElement('span');
            pct.textContent = '%';
            pct.style.cssText = `color: ${withAlpha(C.text, 0.4)}; font-family: ui-monospace, monospace; font-size: 13px;`;
            priceRow.appendChild(pct);
            priceCol.appendChild(priceRow);
            timesRow.appendChild(priceCol);

            block.appendChild(timesRow);

            const priceHint = document.createElement('div');
            priceHint.style.cssText = 'font-size: 11px;';
            function updatePriceHint() {
                const p = win.price_adjustment_pct || 0;
                if (p === 0) {
                    priceHint.style.color = C.textDim;
                    priceHint.textContent = 'No adjustment — items render at base price.';
                } else {
                    priceHint.style.color = C.gold;
                    const mult = ((100 + p) / 100).toFixed(2);
                    priceHint.textContent = `Items render at ${mult}× base (e.g. $10 → $${(10 * (100 + p) / 100).toFixed(2)}).`;
                }
            }
            updatePriceHint();
            block.appendChild(priceHint);

            return block;
        }

        function updateSchedVis(on) {
            schedHint.style.display     = on ? '' : 'none';
            windowsWrap.style.display   = on ? '' : 'none';
            addWindowBtn.style.display  = on ? '' : 'none';
            graceRow.style.display      = on ? 'flex' : 'none';
            specialRow.style.display    = on ? 'flex' : 'none';
            cat.schedule.enabled        = on;
            if (on && cat.schedule.windows.length === 0) {
                cat.schedule.windows.push(defaultWindow());
                renderScheduleWindows();
            }
        }

        schedHead.toggle.setOn(cat.schedule.enabled);
        renderScheduleWindows();
        updateSchedVis(cat.schedule.enabled);
        schedHead.toggle.wrap.addEventListener('click', () => {
            setTimeout(() => updateSchedVis(schedHead.toggle.isOn()), 0);
        });

        // Initial color swatch selection
        selectColor(cat.color);

        // Delete action
        if (!cfg.isNew) {
            body.appendChild(buildDivider());
            const delBtn = buildPillButton('Delete category', 'danger', () => {
                if (!confirm(`Delete "${cat.name}"? Items remain but become uncategorised.`)) return;
                handleDeleteCategory(cat.id); closeModal(ov);
            });
            delBtn.style.width = '100%';
            body.appendChild(delBtn);
        }

        // Footer
        const footer = document.createElement('div');
        footer.style.cssText = `display: flex; gap: 10px; justify-content: flex-end; padding-top: 14px; border-top: 1px solid ${C2.hairline}; margin-top: 6px;`;
        footer.appendChild(buildPillButton('Cancel', 'tertiary', () => closeModal(ov), { small: true }));
        footer.appendChild(buildPillButton(cfg.isNew ? 'Create' : 'Save', 'primary', () => {
            const name = nameField.input.value.trim();
            if (!name) { nameField.input.style.borderColor = C.verm; return; }
            const gathered = {
                ...cat,
                name,
                enable_placement:    placeChip.input.checked,
                universal_group_ids: uniHead.toggle.isOn() ? (uniTray ? uniTray.getIds() : []) : [],
                schedule:            cat.schedule,
                special_active:      specialChip.input.checked && schedHead.toggle.isOn(),
                special_label:       specialLabelField.input.value,
            };
            cfg.onSave(gathered); closeModal(ov);
        }, { small: true }));
        body.appendChild(footer);
    }, { accent: cat.color || C.gold });
    overlay._setAccent(cat.color || C.gold);
}

/* ─── CHANGE HANDLERS ───────────────────────────────────────── */
function handleCreate(newItem) { pendingChanges.new.push(newItem); renderScene(); }

function handleEdit(updated) {
    const nIdx = pendingChanges.new.findIndex(i => i.id === updated.id);
    if (nIdx !== -1) { pendingChanges.new[nIdx] = updated; renderScene(); return; }
    const eIdx = pendingChanges.edited.findIndex(i => i.id === updated.id);
    if (eIdx !== -1) pendingChanges.edited[eIdx] = updated;
    else pendingChanges.edited.push(updated);
    renderScene();
}

function handleDelete(itemId) {
    const nIdx = pendingChanges.new.findIndex(i => i.id === itemId);
    if (nIdx !== -1) { pendingChanges.new.splice(nIdx, 1); renderScene(); return; }
    pendingChanges.edited = pendingChanges.edited.filter(i => i.id !== itemId);
    if (!pendingChanges.deleted.includes(itemId)) pendingChanges.deleted.push(itemId);
    delete pendingChanges.availability[itemId];
    renderScene();
}

function handleDuplicate(source) {
    const dupe = {
        ...clone(source),
        id:            `temp_item_${Date.now()}`,
        name:          (source.name || 'Item') + ' (Copy)',
        display_order: 999,
    };
    openItemModal({ title: 'Add item (duplicated)', source: dupe, onSave: (n) => handleCreate(n), showActions: false });
}

function handleCreateCategory(newCat) {
    const id = (newCat.name || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || `cat_${Date.now()}`;
    pendingChanges.new.push({ ...newCat, id, _isCategory: true });
    renderScene();
}

function handleEditCategory(updated) {
    const eIdx = pendingChanges.edited.findIndex(i => i.id === updated.id && i._isCategory);
    if (eIdx !== -1) pendingChanges.edited[eIdx] = updated;
    else pendingChanges.edited.push(updated);
    renderScene();
}

function handleDeleteCategory(catId) {
    const nIdx = pendingChanges.new.findIndex(i => i.id === catId && i._isCategory);
    if (nIdx !== -1) { pendingChanges.new.splice(nIdx, 1); renderScene(); return; }
    pendingChanges.edited = pendingChanges.edited.filter(i => !(i.id === catId && i._isCategory));
    if (!pendingChanges.deleted.includes(catId)) pendingChanges.deleted.push(catId);
    renderScene();
}

/* ─── EVENT GENERATION ──────────────────────────────────────── */
function generateMenuEvents(changes) {
    const events = [];
    const batch_id = `menu_batch_${Date.now()}`;
    const ts = () => new Date().toISOString();

    // Categories
    changes.new.filter(c => c._isCategory).forEach(cat => {
        events.push({ event_type: 'menu.category_created', batch_id, timestamp: ts(),
            payload: categoryPayload(cat),
        });
    });
    changes.edited.filter(c => c._isCategory).forEach(cat => {
        events.push({ event_type: 'menu.category_updated', batch_id, timestamp: ts(),
            payload: categoryPayload(cat),
        });
    });

    // Items
    changes.new.filter(i => !i._isCategory).forEach(item => {
        events.push({ event_type: 'menu.item_created', batch_id, timestamp: ts(),
            payload: itemPayload(item, true),
        });
    });
    changes.edited.filter(i => !i._isCategory).forEach(item => {
        events.push({ event_type: 'menu.item_updated', batch_id, timestamp: ts(),
            payload: itemPayload(item, true),
        });
        if (menuData.legacyHiddenGroups && menuData.legacyHiddenGroups[item.id]) {
            const legacy = menuData.legacyHiddenGroups[item.id];
            const legacyId = legacy.group_id || legacy.id || `included_${item.id}`;
            events.push({ event_type: 'modifier.group_deleted', batch_id, timestamp: ts(),
                payload: { group_id: legacyId },
            });
        }
    });

    // Deletions
    changes.deleted.forEach(id => {
        const isCat = menuData.categories.some(c => c.id === id)
                   || pendingChanges.new.some(n => n.id === id && n._isCategory);
        if (isCat) {
            events.push({ event_type: 'menu.category_deleted', batch_id, timestamp: ts(), payload: { category_id: id } });
        } else {
            events.push({ event_type: 'menu.item_deleted', batch_id, timestamp: ts(), payload: { item_id: id } });
            if (menuData.legacyHiddenGroups && menuData.legacyHiddenGroups[id]) {
                const legacy = menuData.legacyHiddenGroups[id];
                const legacyId = legacy.group_id || legacy.id || `included_${id}`;
                events.push({ event_type: 'modifier.group_deleted', batch_id, timestamp: ts(), payload: { group_id: legacyId } });
            }
        }
    });

    // Item reorder per category
    Object.entries(changes.itemOrderByCategory).forEach(([catId, order]) => {
        events.push({ event_type: 'menu.items_reordered', batch_id, timestamp: ts(),
            payload: {
                category_id: catId,
                order: order.map((id, i) => ({ id, display_order: i + 1 })),
            },
        });
    });

    // Category reorder
    if (changes.categoryOrder) {
        events.push({ event_type: 'menu.categories_reordered', batch_id, timestamp: ts(),
            payload: {
                order: changes.categoryOrder.map((id, i) => ({ id, display_order: i + 1 })),
            },
        });
    }

    // Availability — USE BACKEND'S NATIVE EVENT NAMES
    // Backend has projection handlers for MENU_ITEM_86D (is_86ed=True) and
    // MENU_ITEM_RESTORED (is_86ed=False). No eightysixed_at in payload —
    // the event's timestamp field already records when it happened.
    Object.entries(changes.availability).forEach(([itemId, av]) => {
        events.push({
            event_type: av.available ? 'menu.item_restored' : 'menu.item_86d',
            batch_id, timestamp: ts(),
            payload: { item_id: itemId },
        });
    });

    return events;
}

function categoryPayload(cat) {
    return {
        category_id:         cat.id,
        name:                cat.name,
        display_order:       cat.display_order,
        color:               cat.color,
        enable_placement:    !!cat.enable_placement,
        universal_group_ids: cat.universal_group_ids || [],
        schedule:            cat.schedule || defaultSchedule(),
        special_active:      !!cat.special_active,
        special_label:       cat.special_label || '',
    };
}

function itemPayload(item, includeIdInRoot) {
    const base = {
        name:                  item.name,
        price:                 item.price,
        description:            item.description,
        category_id:           item.category_id,
        active:                item.active,
        mandatory_group_ids:   item.mandatory_group_ids || [],
        included_modifier_ids: item.included_modifier_ids || [],
    };
    if (includeIdInRoot) base.item_id = item.id.replace(/^temp_/, '');
    return base;
}

/* ─── SAVE ──────────────────────────────────────────────────── */
async function handlePublish() {
    const events = generateMenuEvents(pendingChanges);
    if (events.length === 0) return;

    const result = await pushChanges(events);
    if (!result.ok) {
        showToast('Failed to publish — try again', 'error');
        return;
    }

    // Apply to base
    pendingChanges.new.forEach(n => {
        if (n._isCategory) menuData.categories.push(clone(n));
        else menuData.items.push(clone(n));
    });
    pendingChanges.edited.forEach(e => {
        if (e._isCategory) {
            const idx = menuData.categories.findIndex(c => c.id === e.id);
            if (idx !== -1) menuData.categories[idx] = clone(e);
        } else {
            const idx = menuData.items.findIndex(i => i.id === e.id);
            if (idx !== -1) menuData.items[idx] = clone(e);
            if (menuData.legacyHiddenGroups[e.id]) delete menuData.legacyHiddenGroups[e.id];
        }
    });
    pendingChanges.deleted.forEach(id => {
        menuData.categories = menuData.categories.filter(c => c.id !== id);
        menuData.items      = menuData.items.filter(i => i.id !== id);
        if (menuData.legacyHiddenGroups[id]) delete menuData.legacyHiddenGroups[id];
    });

    // Apply item reorder to base
    Object.entries(pendingChanges.itemOrderByCategory).forEach(([catId, order]) => {
        const map = new Map(order.map((id, i) => [id, i + 1]));
        menuData.items.forEach(it => {
            if (it.category_id === catId && map.has(it.id)) {
                it.display_order = map.get(it.id);
            }
        });
    });

    // Apply category reorder to base
    if (pendingChanges.categoryOrder) {
        const map = new Map(pendingChanges.categoryOrder.map((id, i) => [id, i + 1]));
        menuData.categories.forEach(c => {
            if (map.has(c.id)) c.display_order = map.get(c.id);
        });
    }

    // Apply availability to base
    Object.entries(pendingChanges.availability).forEach(([itemId, av]) => {
        const it = menuData.items.find(i => i.id === itemId);
        if (it) it.active = !!av.available;
    });

    clearDraft();
    const n = events.length;
    pendingChanges = { new: [], edited: [], deleted: [], itemOrderByCategory: {}, categoryOrder: null, availability: {} };
    renderScene();
    showToast(`${n} change${n === 1 ? '' : 's'} published to terminals`);
}

/* ─── ANIMATION ─────────────────────────────────────────────── */
function injectAnimations() {
    if (document.getElementById('mc-keyframes')) return;
    const s = document.createElement('style');
    s.id = 'mc-keyframes';
    s.textContent = `
        @keyframes mc-fade-in {
            from { opacity: 0; transform: translateY(-4px); }
            to   { opacity: 1; transform: none; }
        }
    `;
    document.head.appendChild(s);
}