/* ============================================
   KINDpos Overseer - Display Order
   Category & Item ordering for menu display

   Spatial memory matters — consistent ordering
   helps servers find items fast under pressure.

   Nice. Dependable. Yours.
   ============================================ */

/* ------------------------------------------
   COLORS
------------------------------------------ */
const COLORS = {
    mint:       'var(--color-mint)',
    mintHover:  '#d4ffca',
    mintDim:    'rgba(var(--color-mint-rgb), 0.15)',
    yellow:     'var(--color-gold)',
    yellowFaded:'rgba(var(--color-gold-rgb), 0.4)',
    red:        'var(--color-vermillion)',
    redFaded:   'rgba(var(--color-vermillion-rgb), 0.3)',
    dark:       'var(--color-bg)',
    grey:       '#999999',
    white:      '#FFFFFF',
};

/* ------------------------------------------
   MENU DATA (fetched from API)
------------------------------------------ */
async function fetchOrderData() {
    try {
        const [catRes, itemRes] = await Promise.all([
            fetch('/api/v1/config/menu/categories'),
            fetch('/api/v1/config/menu/items'),
        ]);
        const categories = catRes.ok ? await catRes.json() : [];
        const items = itemRes.ok ? await itemRes.json() : [];
        const cats = categories.map((c, i) => ({
            id: c.category_id || c.id, name: c.name, emoji: '', display_order: c.display_order || i + 1,
        }));
        const nameToId = {};
        cats.forEach(c => { nameToId[c.name.toLowerCase()] = c.id; nameToId[c.id.toLowerCase()] = c.id; });
        const itemsByCat = {};
        cats.forEach(c => { itemsByCat[c.id] = []; });
        items.forEach((item, i) => {
            const raw = item.category_id || item.category || '';
            const catId = nameToId[raw.toLowerCase()] || raw;
            if (!itemsByCat[catId]) itemsByCat[catId] = [];
            itemsByCat[catId].push({ id: item.item_id || item.id, name: item.name, price: parseFloat(item.price) || 0, display_order: item.display_order || i + 1 });
        });
        return { categories: cats, items: itemsByCat };
    } catch (e) { console.warn('[DisplayOrder] Failed to fetch:', e); return { categories: [], items: {} }; }
}

/* ------------------------------------------
   MODULE STATE
------------------------------------------ */
let currentWrapper = null;
let orderData = null;
let pendingChanges = { categories: false, items: {} }; // items keyed by category id
let selectedCategoryId = null;

/* ------------------------------------------
   HELPERS
------------------------------------------ */
function clone(obj) { return JSON.parse(JSON.stringify(obj)); }

function hasPendingChanges() {
    return pendingChanges.categories || Object.values(pendingChanges.items).some(v => v);
}

function getPendingCount() {
    let count = pendingChanges.categories ? 1 : 0;
    count += Object.values(pendingChanges.items).filter(v => v).length;
    return count;
}

function swapItems(arr, idxA, idxB) {
    if (idxA < 0 || idxB < 0 || idxA >= arr.length || idxB >= arr.length) return;
    const tempOrder = arr[idxA].display_order;
    arr[idxA].display_order = arr[idxB].display_order;
    arr[idxB].display_order = tempOrder;
    [arr[idxA], arr[idxB]] = [arr[idxB], arr[idxA]];
}

/* ------------------------------------------
   MAIN VIEW
------------------------------------------ */
function buildMainView(wrapper) {
    wrapper.innerHTML = '';

    // Header
    const header = document.createElement('div');
    header.style.cssText = `margin-bottom: 28px;`;
    header.innerHTML = `
        <div style="font-family: var(--font-display); font-size: 34px; color: ${COLORS.yellow};">Display Order</div>
        <div style="font-family: var(--font-body); font-size: 18px; color: rgba(var(--color-mint-rgb), 0.5); margin-top: 4px;">
            Arrange categories and items — consistent ordering builds spatial memory
        </div>
    `;
    wrapper.appendChild(header);

    // Footer (append early)
    const footer = document.createElement('div');
    footer.id = 'order-change-footer';
    footer.style.cssText = `
        position: sticky; bottom: 0; padding: 16px 32px;
        background: rgba(51, 51, 51, 0.97);
        border-top: 2px solid ${COLORS.yellow};
        display: none; justify-content: space-between;
        align-items: center; z-index: 50; margin-top: 24px;
    `;

    // Section 1: Category Order
    buildSectionHeader(wrapper, 'Category Order', 'How categories appear on the order screen hex nav');
    const catList = document.createElement('div');
    catList.id = 'category-order-list';
    wrapper.appendChild(catList);
    renderCategoryOrder();

    // Divider
    const divider = document.createElement('div');
    divider.style.cssText = `border-bottom: 2px solid rgba(var(--color-mint-rgb), 0.1); margin: 32px 0;`;
    wrapper.appendChild(divider);

    // Section 2: Item Order
    buildSectionHeader(wrapper, 'Item Order Within Category', 'How items appear within each category');

    // Category selector
    const selector = document.createElement('div');
    selector.style.cssText = `margin-bottom: 20px;`;
    const select = document.createElement('select');
    select.style.cssText = `
        width: 100%; max-width: 400px; padding: 14px 16px;
        background: rgba(var(--color-mint-rgb), 0.08);
        border: 1px solid rgba(var(--color-mint-rgb), 0.25);
        border-radius: 8px; color: ${COLORS.white};
        font-family: var(--font-body); font-size: 22px;
        cursor: pointer; outline: none;
    `;
    const defaultOpt = document.createElement('option');
    defaultOpt.value = '';
    defaultOpt.textContent = 'Select a category...';
    defaultOpt.style.background = COLORS.dark;
    select.appendChild(defaultOpt);
    orderData.categories.forEach(cat => {
        const opt = document.createElement('option');
        opt.value = cat.id;
        opt.textContent = `${cat.emoji} ${cat.name}`;
        opt.style.background = COLORS.dark;
        if (cat.id === selectedCategoryId) opt.selected = true;
        select.appendChild(opt);
    });
    select.addEventListener('change', () => {
        selectedCategoryId = select.value || null;
        renderItemOrder();
    });
    selector.appendChild(select);
    wrapper.appendChild(selector);

    const itemList = document.createElement('div');
    itemList.id = 'item-order-list';
    wrapper.appendChild(itemList);
    renderItemOrder();

    wrapper.appendChild(footer);
    updateFooter();
}

function buildSectionHeader(container, title, subtitle) {
    const hdr = document.createElement('div');
    hdr.style.cssText = `margin-bottom: 16px;`;
    hdr.innerHTML = `
        <div style="font-family: var(--font-display); font-size: 28px; color: ${COLORS.yellow}; padding-bottom: 4px;">${title}</div>
        <div style="font-family: var(--font-body); font-size: 18px; color: ${COLORS.grey};">${subtitle}</div>
    `;
    container.appendChild(hdr);
}

/* ==========================================
   CATEGORY ORDER
   ========================================== */
function renderCategoryOrder() {
    const container = document.getElementById('category-order-list');
    if (!container) return;
    container.innerHTML = '';

    const cats = orderData.categories;

    cats.forEach((cat, idx) => {
        const row = buildOrderRow({
            position: idx + 1,
            label: `${cat.emoji}  ${cat.name}`,
            sublabel: null,
            isFirst: idx === 0,
            isLast: idx === cats.length - 1,
            onMoveUp: () => {
                swapItems(cats, idx, idx - 1);
                pendingChanges.categories = true;
                renderCategoryOrder();
                updateFooter();
            },
            onMoveDown: () => {
                swapItems(cats, idx, idx + 1);
                pendingChanges.categories = true;
                renderCategoryOrder();
                updateFooter();
            },
        });
        container.appendChild(row);
    });
}

/* ==========================================
   ITEM ORDER
   ========================================== */
function renderItemOrder() {
    const container = document.getElementById('item-order-list');
    if (!container) return;
    container.innerHTML = '';

    if (!selectedCategoryId) {
        container.innerHTML = `<div style="color: ${COLORS.grey}; font-family: var(--font-body); font-size: 20px; padding: 20px; font-style: italic;">Select a category above to reorder its items</div>`;
        return;
    }

    const items = orderData.items[selectedCategoryId];
    if (!items || items.length === 0) {
        container.innerHTML = `<div style="color: ${COLORS.grey}; font-family: var(--font-body); font-size: 20px; padding: 20px; font-style: italic;">No items in this category</div>`;
        return;
    }

    items.forEach((item, idx) => {
        const row = buildOrderRow({
            position: idx + 1,
            label: item.name,
            sublabel: `$${Number(item.price).toFixed(2)}`,
            isFirst: idx === 0,
            isLast: idx === items.length - 1,
            onMoveUp: () => {
                swapItems(items, idx, idx - 1);
                pendingChanges.items[selectedCategoryId] = true;
                renderItemOrder();
                updateFooter();
            },
            onMoveDown: () => {
                swapItems(items, idx, idx + 1);
                pendingChanges.items[selectedCategoryId] = true;
                renderItemOrder();
                updateFooter();
            },
        });
        container.appendChild(row);
    });
}

/* ==========================================
   SHARED: ORDER ROW COMPONENT
   ========================================== */
function buildOrderRow({ position, label, sublabel, isFirst, isLast, onMoveUp, onMoveDown }) {
    const row = document.createElement('div');
    row.style.cssText = `
        display: flex; align-items: center; justify-content: space-between;
        padding: 14px 20px;
        background: rgba(var(--color-mint-rgb), 0.04);
        border: 1px solid rgba(var(--color-mint-rgb), 0.08);
        border-radius: 8px; margin-bottom: 6px;
        transition: all 0.15s ease;
    `;
    row.addEventListener('mouseenter', () => { row.style.background = 'rgba(var(--color-mint-rgb), 0.08)'; });
    row.addEventListener('mouseleave', () => { row.style.background = 'rgba(var(--color-mint-rgb), 0.04)'; });

    const left = document.createElement('div');
    left.style.cssText = `display: flex; align-items: center; gap: 18px;`;

    // Position number
    const posEl = document.createElement('div');
    posEl.style.cssText = `
        width: 38px; height: 38px;
        background: ${COLORS.mintDim};
        border: 1px solid rgba(var(--color-mint-rgb), 0.3);
        border-radius: 8px;
        display: flex; align-items: center; justify-content: center;
        font-family: var(--font-display); font-size: 20px; color: ${COLORS.mint};
    `;
    posEl.textContent = position;
    left.appendChild(posEl);

    // Name
    const nameEl = document.createElement('span');
    nameEl.style.cssText = `font-family: var(--font-body); font-size: 25px; color: ${COLORS.mint};`;
    nameEl.textContent = label;
    left.appendChild(nameEl);

    // Sublabel (price)
    if (sublabel) {
        const subEl = document.createElement('span');
        subEl.style.cssText = `font-family: var(--font-body); font-size: 20px; color: ${COLORS.yellow};`;
        subEl.textContent = sublabel;
        left.appendChild(subEl);
    }

    row.appendChild(left);

    // Arrow buttons
    const right = document.createElement('div');
    right.style.cssText = `display: flex; gap: 8px;`;

    const upBtn = buildArrowButton('▲', isFirst, onMoveUp);
    right.appendChild(upBtn);

    const downBtn = buildArrowButton('▼', isLast, onMoveDown);
    right.appendChild(downBtn);

    row.appendChild(right);
    return row;
}

function buildArrowButton(symbol, disabled, onClick) {
    const btn = document.createElement('button');
    btn.style.cssText = `
        width: 44px; height: 44px;
        background: ${disabled ? 'transparent' : 'rgba(var(--color-mint-rgb), 0.08)'};
        border: 1px solid ${disabled ? 'rgba(var(--color-mint-rgb), 0.08)' : 'rgba(var(--color-mint-rgb), 0.25)'};
        border-radius: 8px;
        color: ${disabled ? 'rgba(var(--color-mint-rgb), 0.15)' : COLORS.mint};
        font-size: 18px;
        cursor: ${disabled ? 'default' : 'pointer'};
        transition: all 0.15s ease;
        display: flex; align-items: center; justify-content: center;
    `;
    btn.textContent = symbol;
    if (!disabled) {
        btn.addEventListener('mouseenter', () => {
            btn.style.background = COLORS.mint;
            btn.style.color = COLORS.dark;
        });
        btn.addEventListener('mouseleave', () => {
            btn.style.background = 'rgba(var(--color-mint-rgb), 0.08)';
            btn.style.color = COLORS.mint;
        });
        btn.addEventListener('click', (e) => { e.stopPropagation(); onClick(); });
    }
    return btn;
}

/* ==========================================
   FOOTER: CHANGE TRACKER
   ========================================== */
function updateFooter() {
    const footer = document.getElementById('order-change-footer');
    if (!footer) return;

    const count = getPendingCount();
    if (!hasPendingChanges()) { footer.style.display = 'none'; return; }

    footer.style.display = 'flex';
    footer.innerHTML = '';

    // Description of what changed
    const parts = [];
    if (pendingChanges.categories) parts.push('category order');
    const itemCats = Object.entries(pendingChanges.items).filter(([_, v]) => v).map(([id]) => {
        const cat = orderData.categories.find(c => c.id === id);
        return cat ? cat.name : id;
    });
    if (itemCats.length > 0) parts.push(`items in ${itemCats.join(', ')}`);

    const counter = document.createElement('div');
    counter.style.cssText = `font-family: var(--font-body); font-size: 22px; color: ${COLORS.yellow}; display: flex; align-items: center; gap: 8px;`;
    counter.innerHTML = `⚠️ <strong>Changed: ${parts.join(' + ')}</strong>`;
    footer.appendChild(counter);

    const btnGroup = document.createElement('div');
    btnGroup.style.cssText = `display: flex; gap: 12px;`;

    const cancelBtn = document.createElement('button');
    cancelBtn.style.cssText = `
        padding: 12px 24px; background: transparent;
        border: 1px solid ${COLORS.grey}; border-radius: 8px;
        color: ${COLORS.grey}; font-family: var(--font-body);
        font-size: 22px; cursor: pointer;
    `;
    cancelBtn.textContent = 'Cancel';
    cancelBtn.addEventListener('mouseenter', () => { cancelBtn.style.borderColor = COLORS.red; cancelBtn.style.color = COLORS.red; });
    cancelBtn.addEventListener('mouseleave', () => { cancelBtn.style.borderColor = COLORS.grey; cancelBtn.style.color = COLORS.grey; });
    cancelBtn.addEventListener('click', () => {
        showConfirmDialog('Discard Changes?', 'Revert all ordering changes?', 'Discard', async () => {
            orderData = await fetchOrderData();
            pendingChanges = { categories: false, items: {} };
            buildMainView(currentWrapper);
        });
    });
    btnGroup.appendChild(cancelBtn);

    const saveBtn = document.createElement('button');
    saveBtn.style.cssText = `
        padding: 12px 24px; background: ${COLORS.mint}; border: none;
        border-radius: 8px; color: ${COLORS.dark}; font-family: var(--font-body);
        font-size: 22px; font-weight: bold; cursor: pointer; transition: all 0.2s ease;
    `;
    saveBtn.textContent = 'Save Order';
    saveBtn.addEventListener('mouseenter', () => { saveBtn.style.background = COLORS.mintHover; });
    saveBtn.addEventListener('mouseleave', () => { saveBtn.style.background = COLORS.mint; });
    saveBtn.addEventListener('click', () => handleSaveChanges());
    btnGroup.appendChild(saveBtn);

    footer.appendChild(btnGroup);
}

/* ==========================================
   SAVE: EVENT GENERATION
   ========================================== */
function handleSaveChanges() {
    const events = [];
    const batch_id = `display_order_batch_${Date.now()}`;
    const ts = new Date().toISOString();

    if (pendingChanges.categories) {
        events.push({
            event_type: 'menu.category_order_updated',
            batch_id, timestamp: ts,
            payload: {
                order: orderData.categories.map((c, i) => ({
                    id: c.id, name: c.name, display_order: i + 1,
                })),
            },
        });
        // Update display_order values
        orderData.categories.forEach((c, i) => { c.display_order = i + 1; });
    }

    Object.entries(pendingChanges.items).forEach(([catId, changed]) => {
        if (!changed) return;
        const items = orderData.items[catId];
        if (!items) return;
        events.push({
            event_type: 'menu.item_order_updated',
            batch_id, timestamp: ts,
            payload: {
                category_id: catId,
                order: items.map((item, i) => ({
                    id: item.id, name: item.name, display_order: i + 1,
                })),
            },
        });
        items.forEach((item, i) => { item.display_order = i + 1; });
    });

    console.log('%c[KINDpos] Display Order Events Generated', 'background: #333; color: var(--color-gold); font-size: 14px; padding: 2px 8px;');
    events.forEach((evt, i) => {
        console.log(`  ${i + 1}. ${evt.event_type} — ${evt.payload.order.map(o => o.name).join(', ')}`);
    });

    pendingChanges = { categories: false, items: {} };
    buildMainView(currentWrapper);
    showToast(`Display order saved — ${events.length} update${events.length !== 1 ? 's' : ''}`);
}

/* ==========================================
   CONFIRM DIALOG
   ========================================== */
function showConfirmDialog(title, message, confirmLabel, onConfirm) {
    const overlay = document.createElement('div');
    overlay.style.cssText = `position: fixed; top: 0; left: 0; right: 0; bottom: 0; background: rgba(0,0,0,0.75); z-index: 300; display: flex; align-items: center; justify-content: center;`;

    const dialog = document.createElement('div');
    dialog.style.cssText = `background: ${COLORS.dark}; border: 2px solid ${COLORS.red}; border-radius: 12px; padding: 32px; width: 420px; text-align: center;`;
    dialog.innerHTML = `
        <div style="font-family: var(--font-display); font-size: 28px; color: ${COLORS.red}; margin-bottom: 16px;">${title}</div>
        <div style="font-family: var(--font-body); font-size: 22px; color: ${COLORS.grey}; margin-bottom: 28px; line-height: 1.5;">${message}</div>
    `;
    const btnRow = document.createElement('div');
    btnRow.style.cssText = `display: flex; gap: 12px; justify-content: center;`;

    const keepBtn = document.createElement('button');
    keepBtn.style.cssText = `padding: 12px 28px; background: transparent; border: 1px solid ${COLORS.mint}; border-radius: 8px; color: ${COLORS.mint}; font-family: var(--font-body); font-size: 22px; cursor: pointer;`;
    keepBtn.textContent = 'Keep Editing';
    keepBtn.addEventListener('click', () => overlay.remove());
    btnRow.appendChild(keepBtn);

    const discardBtn = document.createElement('button');
    discardBtn.style.cssText = `padding: 12px 28px; background: ${COLORS.redFaded}; border: 2px solid ${COLORS.red}; border-radius: 8px; color: ${COLORS.white}; font-family: var(--font-body); font-size: 22px; font-weight: bold; cursor: pointer;`;
    discardBtn.textContent = confirmLabel;
    discardBtn.addEventListener('click', () => { overlay.remove(); onConfirm(); });
    btnRow.appendChild(discardBtn);

    dialog.appendChild(btnRow);
    overlay.appendChild(dialog);

    const escHandler = (e) => { if (e.key === 'Escape') { overlay.remove(); document.removeEventListener('keydown', escHandler); } };
    document.addEventListener('keydown', escHandler);
    overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
    document.body.appendChild(overlay);
}

/* ==========================================
   TOAST
   ========================================== */
function showToast(message) {
    const toast = document.createElement('div');
    toast.style.cssText = `position: fixed; top: 24px; right: 24px; padding: 16px 28px; background: ${COLORS.mint}; color: ${COLORS.dark}; font-family: var(--font-body); font-size: 22px; font-weight: bold; border-radius: 8px; z-index: 200; box-shadow: 0 4px 20px rgba(0,0,0,0.3);`;
    toast.textContent = `✓ ${message}`;
    document.body.appendChild(toast);
    setTimeout(() => { toast.style.opacity = '0'; toast.style.transition = 'opacity 0.3s ease'; setTimeout(() => toast.remove(), 300); }, 2500);
}

/* ==========================================
   PUBLIC: Register scene
   ========================================== */
export function registerDisplayOrder(sceneManager) {
    sceneManager.register('display-order', {
        type: 'detail',
        title: 'Display Order',
        parent: 'menu-subs',
        async onEnter(container) {
            console.log('[DisplayOrder] Scene loaded — initializing...');

            orderData = await fetchOrderData();
            pendingChanges = { categories: false, items: {} };
            selectedCategoryId = null;

            currentWrapper = document.createElement('div');
            currentWrapper.style.cssText = `max-width: 900px; margin: 0 auto; padding: 10px 20px 40px 20px;`;
            container.appendChild(currentWrapper);

            buildMainView(currentWrapper);

            console.log(`[DisplayOrder] Loaded ${orderData.categories.length} categories.`);
            console.log('[DisplayOrder] Ready.');
        },
        onExit(container) {
            currentWrapper = null;
            orderData = null;
            pendingChanges = { categories: false, items: {} };
            container.innerHTML = '';
        },
    });
}