/* ============================================
   KINDpos Overseer - Menu Availability
   Category Schedules, Grace Periods, 86 Board

   "The 2:55pm table that wants the lunch
   special happens every day. Now your servers
   can handle it without guessing."

   Nice. Dependable. Yours.
   ============================================ */

/* ------------------------------------------
   COLORS (consistent with Overseer palette)
------------------------------------------ */
const COLORS = {
    mint:       'var(--color-mint)',
    mintHover:  '#d4ffca',
    mintFaded:  'rgba(var(--color-mint-rgb), 0.8)',
    mintGhost:  'rgba(var(--color-mint-rgb), 0.4)',
    mintDim:    'rgba(var(--color-mint-rgb), 0.15)',
    yellow:     'var(--color-gold)',
    yellowFaded:'rgba(var(--color-gold-rgb), 0.4)',
    red:        'var(--color-vermillion)',
    redFaded:   'rgba(var(--color-vermillion-rgb), 0.3)',
    dark:       'var(--color-bg)',
    grey:       '#999999',
    white:      '#FFFFFF',
    green:      '#4CAF50',
    greenFaded: 'rgba(76, 175, 80, 0.3)',
};

/* ------------------------------------------
   DAY NAMES
------------------------------------------ */
const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const DAYS_FULL = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

/* ------------------------------------------
   TEST DATA
   Categories with schedule fields,
   Items with availability state.
   Same items as menu-categories.js for
   consistency.
------------------------------------------ */
async function fetchAvailabilityData() {
    try {
        const [catRes, itemRes] = await Promise.all([
            fetch("/api/v1/config/menu/categories"),
            fetch("/api/v1/config/menu/items"),
        ]);
        const categories = catRes.ok ? await catRes.json() : [];
        const items = itemRes.ok ? await itemRes.json() : [];
        const nameToId = {};
        categories.forEach(c => { nameToId[(c.name || "").toLowerCase()] = c.category_id || c.id; });
        return {
            categories: categories.map((c, i) => ({
                id: c.category_id || c.id, name: c.name, emoji: "", display_order: c.display_order || i + 1,
                schedule_type: "always", time_start: "", time_end: "", grace_minutes: 10,
                active_days: [true, true, true, true, true, true, true],
                special_active: false, special_label: "",
            })),
            items: items.map(item => ({
                id: item.item_id || item.id, name: item.name, price: parseFloat(item.price) || 0,
                category_id: nameToId[(item.category_id || item.category || "").toLowerCase()] || item.category_id || "",
                available: item.active !== false, eightysixed_at: null,
            })),
        };
    } catch (e) { console.warn("[MenuAvailability] Failed to fetch:", e); return { categories: [], items: [] }; }
}

/* ------------------------------------------
   MODULE-LEVEL STATE
------------------------------------------ */
let currentWrapper = null;
let availData = { categories: [], items: [] };
let pendingChanges = { categories: [], items: [] };
let displayState = { searchTerm: '', expandedCategories: {} };

/* ------------------------------------------
   HELPERS
------------------------------------------ */
function clone(obj) {
    return JSON.parse(JSON.stringify(obj));
}

function formatPrice(price) {
    return '$' + Number(price).toFixed(2);
}

function getPendingCount() {
    return pendingChanges.categories.length + pendingChanges.items.length;
}

/** Get the working copy of a category (pending edit or base) */
function getWorkingCategory(catId) {
    const pending = pendingChanges.categories.find(c => c.id === catId);
    return pending || availData.categories.find(c => c.id === catId);
}

/** Get the working copy of an item */
function getWorkingItem(itemId) {
    const pending = pendingChanges.items.find(i => i.id === itemId);
    return pending || availData.items.find(i => i.id === itemId);
}

/** Track a category change */
function trackCategoryChange(updatedCat) {
    const idx = pendingChanges.categories.findIndex(c => c.id === updatedCat.id);
    if (idx !== -1) {
        pendingChanges.categories[idx] = updatedCat;
    } else {
        pendingChanges.categories.push(updatedCat);
    }
    updateFooter();
}

/** Track an item change */
function trackItemChange(updatedItem) {
    const idx = pendingChanges.items.findIndex(i => i.id === updatedItem.id);
    if (idx !== -1) {
        pendingChanges.items[idx] = updatedItem;
    } else {
        pendingChanges.items.push(updatedItem);
    }
    updateFooter();
}

/** Format time string nicely on blur */
function formatTimeString(raw) {
    if (!raw || !raw.trim()) return '';
    let cleaned = raw.trim().toUpperCase();

    // If they just typed a number like "3" or "11"
    const numOnly = cleaned.match(/^(\d{1,2})$/);
    if (numOnly) {
        const h = parseInt(numOnly[1]);
        if (h <= 12) return `${h}:00 ${h < 7 || h === 12 ? 'PM' : 'AM'}`;
        return `${h - 12}:00 PM`;
    }

    // If they typed "3:30" or "11:00" without AM/PM
    const noAmPm = cleaned.match(/^(\d{1,2}):(\d{2})$/);
    if (noAmPm) {
        const h = parseInt(noAmPm[1]);
        const m = noAmPm[2];
        if (h <= 12) return `${h}:${m} ${h < 7 || h === 12 ? 'PM' : 'AM'}`;
        return `${h - 12}:${m} PM`;
    }

    // If they typed something with AM/PM already, just clean it up
    const withAmPm = cleaned.match(/^(\d{1,2}):?(\d{2})?\s*(AM|PM)$/);
    if (withAmPm) {
        const h = withAmPm[1];
        const m = withAmPm[2] || '00';
        const p = withAmPm[3];
        return `${h}:${m} ${p}`;
    }

    // Return as-is if we can't parse
    return raw.trim();
}

/* ------------------------------------------
   RENDER: MAIN VIEW
------------------------------------------ */
function buildMainView(wrapper) {
    wrapper.innerHTML = '';

    // --- HEADER ---
    const header = document.createElement('div');
    header.style.cssText = `
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-bottom: 20px;
    `;
    header.innerHTML = `
        <div>
            <div style="
                font-family: var(--font-display);
                font-size: 34px;
                color: ${COLORS.yellow};
            ">Menu Availability</div>
            <div style="
                font-family: var(--font-body);
                font-size: 18px;
                color: rgba(var(--color-mint-rgb), 0.5);
                margin-top: 4px;
            ">Schedules, Specials & 86 Board</div>
        </div>
    `;

    // Summary gauge
    const allItems = availData.items;
    const availableCount = allItems.filter(i => {
        const working = getWorkingItem(i.id);
        return working.available;
    }).length;
    const totalCount = allItems.length;

    const gauge = document.createElement('div');
    gauge.style.cssText = `
        display: flex;
        align-items: center;
        gap: 14px;
    `;
    gauge.innerHTML = `
        <div style="
            font-family: var(--font-body);
            font-size: 22px;
            color: ${availableCount === totalCount ? COLORS.mint : COLORS.yellow};
        ">
            <strong>${availableCount}</strong> of <strong>${totalCount}</strong> items available
        </div>
        <div style="
            width: 120px;
            height: 12px;
            background: rgba(var(--color-mint-rgb), 0.15);
            border-radius: 6px;
            overflow: hidden;
        ">
            <div style="
                width: ${(availableCount / totalCount) * 100}%;
                height: 100%;
                background: ${availableCount === totalCount ? COLORS.mint : COLORS.yellow};
                border-radius: 6px;
                transition: width 0.3s ease;
            "></div>
        </div>
    `;
    header.appendChild(gauge);
    wrapper.appendChild(header);

    // --- CATEGORY SCHEDULES SECTION ---
    const schedSection = document.createElement('div');
    schedSection.style.cssText = `margin-bottom: 40px;`;

    const schedTitle = document.createElement('div');
    schedTitle.style.cssText = `
        font-family: var(--font-display);
        font-size: 28px;
        color: ${COLORS.yellow};
        margin-bottom: 16px;
        padding-bottom: 8px;
        border-bottom: 2px solid ${COLORS.yellowFaded};
    `;
    schedTitle.textContent = 'Category Schedules';
    schedSection.appendChild(schedTitle);

    availData.categories
        .sort((a, b) => a.display_order - b.display_order)
        .forEach(cat => {
            const card = buildCategoryScheduleCard(cat);
            schedSection.appendChild(card);
        });
    wrapper.appendChild(schedSection);

    // --- 86 BOARD SECTION ---
    const boardSection = document.createElement('div');

    const boardHeader = document.createElement('div');
    boardHeader.style.cssText = `
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-bottom: 16px;
    `;

    const boardTitle = document.createElement('div');
    boardTitle.style.cssText = `
        font-family: var(--font-display);
        font-size: 28px;
        color: ${COLORS.yellow};
        padding-bottom: 8px;
        border-bottom: 2px solid ${COLORS.yellowFaded};
        flex: 1;
    `;
    boardTitle.textContent = '86 Board — Item Availability';
    boardHeader.appendChild(boardTitle);
    boardSection.appendChild(boardHeader);

    // Search bar
    const searchInput = document.createElement('input');
    searchInput.type = 'text';
    searchInput.placeholder = 'Search items...';
    searchInput.value = displayState.searchTerm;
    searchInput.style.cssText = `
        width: 100%;
        padding: 12px 16px;
        background: rgba(var(--color-mint-rgb), 0.08);
        border: 1px solid rgba(var(--color-mint-rgb), 0.2);
        border-radius: 8px;
        color: ${COLORS.mint};
        font-family: var(--font-body);
        font-size: 22px;
        outline: none;
        margin-bottom: 20px;
        box-sizing: border-box;
        transition: border-color 0.2s ease;
    `;
    searchInput.addEventListener('focus', () => { searchInput.style.borderColor = COLORS.mint; });
    searchInput.addEventListener('blur', () => { searchInput.style.borderColor = 'rgba(var(--color-mint-rgb), 0.2)'; });
    searchInput.addEventListener('input', (e) => {
        displayState.searchTerm = e.target.value;
        renderItemBoard();
    });
    boardSection.appendChild(searchInput);

    // Item board container
    const boardContainer = document.createElement('div');
    boardContainer.id = 'avail-item-board';
    boardSection.appendChild(boardContainer);
    wrapper.appendChild(boardSection);

    // --- FOOTER ---
    const footer = document.createElement('div');
    footer.id = 'avail-change-footer';
    footer.style.cssText = `
        position: sticky;
        bottom: 0;
        padding: 16px 32px;
        background: rgba(51, 51, 51, 0.97);
        border-top: 2px solid ${COLORS.yellow};
        display: none;
        justify-content: space-between;
        align-items: center;
        z-index: 50;
        margin-top: 24px;
    `;
    wrapper.appendChild(footer);

    // Initial renders
    renderItemBoard();
    updateFooter();
}

/* ------------------------------------------
   RENDER: CATEGORY SCHEDULE CARD
   One expandable card per category with
   schedule type, time inputs, grace slider
------------------------------------------ */
function buildCategoryScheduleCard(baseCat) {
    const cat = getWorkingCategory(baseCat.id);
    const isExpanded = displayState.expandedCategories[cat.id] || false;
    const hasPending = pendingChanges.categories.some(c => c.id === cat.id);

    const card = document.createElement('div');
    card.id = `cat-sched-${cat.id}`;
    card.style.cssText = `
        background: rgba(var(--color-mint-rgb), 0.06);
        border: 1px solid ${hasPending ? COLORS.yellow : 'rgba(var(--color-mint-rgb), 0.15)'};
        border-radius: 10px;
        margin-bottom: 12px;
        overflow: hidden;
        transition: border-color 0.2s ease;
    `;

    // --- Collapsed Header Row ---
    const headerRow = document.createElement('div');
    headerRow.style.cssText = `
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 16px 20px;
        cursor: pointer;
        transition: background 0.2s ease;
    `;
    headerRow.addEventListener('mouseenter', () => { headerRow.style.background = 'rgba(var(--color-mint-rgb), 0.08)'; });
    headerRow.addEventListener('mouseleave', () => { headerRow.style.background = 'transparent'; });

    // Left: emoji + name + badge
    const leftSide = document.createElement('div');
    leftSide.style.cssText = `display: flex; align-items: center; gap: 14px;`;

    leftSide.innerHTML = `
        <span style="font-size: 28px;">${cat.emoji}</span>
        <span style="
            font-family: var(--font-body);
            font-size: 25px;
            font-weight: bold;
            color: ${COLORS.mint};
        ">${cat.name}</span>
    `;

    // Schedule badge
    const badge = document.createElement('span');
    badge.style.cssText = `
        padding: 4px 12px;
        border-radius: 20px;
        font-family: var(--font-body);
        font-size: 18px;
        font-weight: bold;
    `;
    if (cat.schedule_type === 'always') {
        badge.style.background = COLORS.greenFaded;
        badge.style.color = COLORS.green;
        badge.textContent = 'Always Available';
    } else if (cat.schedule_type === 'scheduled') {
        badge.style.background = COLORS.yellowFaded;
        badge.style.color = COLORS.yellow;
        badge.textContent = cat.time_start && cat.time_end
            ? `${cat.time_start} – ${cat.time_end}`
            : 'Scheduled (set times)';
    } else if (cat.schedule_type === 'special') {
        badge.style.background = cat.special_active ? 'rgba(156, 39, 176, 0.3)' : 'rgba(156, 39, 176, 0.15)';
        badge.style.color = cat.special_active ? '#CE93D8' : '#9C27B0';
        badge.textContent = cat.special_label
            ? `✦ ${cat.special_label}${cat.special_active ? ' (LIVE)' : ''}`
            : `✦ Special${cat.special_active ? ' (LIVE)' : ''}`;
    }
    leftSide.appendChild(badge);
    headerRow.appendChild(leftSide);

    // Right: expand chevron
    const chevron = document.createElement('span');
    chevron.style.cssText = `
        font-size: 22px;
        color: ${COLORS.grey};
        transition: transform 0.2s ease;
        transform: rotate(${isExpanded ? '180deg' : '0deg'});
    `;
    chevron.textContent = '▼';
    headerRow.appendChild(chevron);

    headerRow.addEventListener('click', () => {
        displayState.expandedCategories[cat.id] = !displayState.expandedCategories[cat.id];
        rebuildCategoryCard(cat.id);
    });

    card.appendChild(headerRow);

    // --- Expanded Content ---
    if (isExpanded) {
        const body = document.createElement('div');
        body.style.cssText = `
            padding: 0 20px 20px 20px;
            border-top: 1px solid rgba(var(--color-mint-rgb), 0.1);
        `;

        // Schedule Type Selector
        const typeRow = document.createElement('div');
        typeRow.style.cssText = `
            display: flex;
            gap: 10px;
            margin: 20px 0;
        `;

        ['always', 'scheduled', 'special'].forEach(type => {
            const btn = document.createElement('button');
            const isActive = cat.schedule_type === type;
            const labels = { always: 'Always Available', scheduled: 'Scheduled', special: 'Special' };
            const icons = { always: '✓', scheduled: '🕒', special: '✦' };

            btn.style.cssText = `
                flex: 1;
                padding: 14px 16px;
                background: ${isActive ? COLORS.mintDim : 'transparent'};
                border: 2px solid ${isActive ? COLORS.mint : 'rgba(var(--color-mint-rgb), 0.15)'};
                border-radius: 8px;
                color: ${isActive ? COLORS.mint : COLORS.grey};
                font-family: var(--font-body);
                font-size: 22px;
                cursor: pointer;
                transition: all 0.2s ease;
                text-align: center;
            `;
            btn.textContent = `${icons[type]} ${labels[type]}`;
            btn.addEventListener('mouseenter', () => {
                if (!isActive) btn.style.borderColor = COLORS.mintGhost;
            });
            btn.addEventListener('mouseleave', () => {
                if (!isActive) btn.style.borderColor = 'rgba(var(--color-mint-rgb), 0.15)';
            });
            btn.addEventListener('click', () => {
                const updated = clone(getWorkingCategory(cat.id));
                updated.schedule_type = type;
                trackCategoryChange(updated);
                rebuildCategoryCard(cat.id);
            });
            typeRow.appendChild(btn);
        });
        body.appendChild(typeRow);

        // --- Scheduled: Time + Days + Grace ---
        if (cat.schedule_type === 'scheduled') {
            // Time inputs row
            const timeRow = document.createElement('div');
            timeRow.style.cssText = `
                display: flex;
                align-items: center;
                gap: 14px;
                margin-bottom: 20px;
            `;

            const timeInputStyle = `
                width: 160px;
                padding: 12px 14px;
                background: rgba(var(--color-mint-rgb), 0.12);
                border: 1px solid rgba(var(--color-mint-rgb), 0.35);
                border-radius: 8px;
                color: ${COLORS.white};
                font-family: var(--font-body);
                font-size: 25px;
                outline: none;
                text-align: center;
                transition: border-color 0.2s ease;
            `;

            const startLabel = document.createElement('span');
            startLabel.style.cssText = `font-family: var(--font-body); font-size: 20px; color: ${COLORS.grey};`;
            startLabel.textContent = 'From';
            timeRow.appendChild(startLabel);

            const startInput = document.createElement('input');
            startInput.type = 'text';
            startInput.placeholder = '11:00 AM';
            startInput.value = cat.time_start;
            startInput.style.cssText = timeInputStyle;
            startInput.addEventListener('focus', () => { startInput.style.borderColor = COLORS.mint; });
            startInput.addEventListener('blur', () => {
                startInput.style.borderColor = 'rgba(var(--color-mint-rgb), 0.25)';
                startInput.value = formatTimeString(startInput.value);
                const updated = clone(getWorkingCategory(cat.id));
                updated.time_start = startInput.value;
                trackCategoryChange(updated);
            });
            timeRow.appendChild(startInput);

            const toLabel = document.createElement('span');
            toLabel.style.cssText = `font-family: var(--font-body); font-size: 20px; color: ${COLORS.grey};`;
            toLabel.textContent = 'to';
            timeRow.appendChild(toLabel);

            const endInput = document.createElement('input');
            endInput.type = 'text';
            endInput.placeholder = '3:00 PM';
            endInput.value = cat.time_end;
            endInput.style.cssText = timeInputStyle;
            endInput.addEventListener('focus', () => { endInput.style.borderColor = COLORS.mint; });
            endInput.addEventListener('blur', () => {
                endInput.style.borderColor = 'rgba(var(--color-mint-rgb), 0.25)';
                endInput.value = formatTimeString(endInput.value);
                const updated = clone(getWorkingCategory(cat.id));
                updated.time_end = endInput.value;
                trackCategoryChange(updated);
            });
            timeRow.appendChild(endInput);
            body.appendChild(timeRow);

            // Day-of-week selector
            const daysRow = document.createElement('div');
            daysRow.style.cssText = `
                display: flex;
                gap: 8px;
                margin-bottom: 24px;
            `;

            DAYS.forEach((day, i) => {
                const dayBtn = document.createElement('button');
                const isOn = cat.active_days[i];
                dayBtn.style.cssText = `
                    width: 64px;
                    padding: 10px 0;
                    background: ${isOn ? COLORS.mint : 'transparent'};
                    border: 2px solid ${isOn ? COLORS.mint : 'rgba(var(--color-mint-rgb), 0.2)'};
                    border-radius: 8px;
                    color: ${isOn ? COLORS.dark : COLORS.grey};
                    font-family: var(--font-body);
                    font-size: 20px;
                    font-weight: ${isOn ? 'bold' : 'normal'};
                    cursor: pointer;
                    transition: all 0.15s ease;
                    text-align: center;
                `;
                dayBtn.textContent = day;
                dayBtn.title = DAYS_FULL[i];
                dayBtn.addEventListener('click', () => {
                    const updated = clone(getWorkingCategory(cat.id));
                    updated.active_days[i] = !updated.active_days[i];
                    trackCategoryChange(updated);
                    rebuildCategoryCard(cat.id);
                });
                daysRow.appendChild(dayBtn);
            });

            // "Every Day" toggle
            const allDaysOn = cat.active_days.every(d => d);
            const everyDayBtn = document.createElement('button');
            everyDayBtn.style.cssText = `
                padding: 10px 16px;
                background: ${allDaysOn ? COLORS.yellowFaded : 'transparent'};
                border: 2px solid ${allDaysOn ? COLORS.yellow : 'rgba(var(--color-mint-rgb), 0.15)'};
                border-radius: 8px;
                color: ${allDaysOn ? COLORS.yellow : COLORS.grey};
                font-family: var(--font-body);
                font-size: 20px;
                cursor: pointer;
                margin-left: 8px;
                transition: all 0.15s ease;
            `;
            everyDayBtn.textContent = 'Every Day';
            everyDayBtn.addEventListener('click', () => {
                const updated = clone(getWorkingCategory(cat.id));
                const setTo = !allDaysOn;
                updated.active_days = updated.active_days.map(() => setTo);
                trackCategoryChange(updated);
                rebuildCategoryCard(cat.id);
            });
            daysRow.appendChild(everyDayBtn);
            body.appendChild(daysRow);

            // Grace period slider
            const graceSection = document.createElement('div');
            graceSection.style.cssText = `margin-bottom: 10px;`;

            const graceLabel = document.createElement('div');
            graceLabel.style.cssText = `
                display: flex;
                justify-content: space-between;
                align-items: center;
                margin-bottom: 10px;
            `;
            graceLabel.innerHTML = `
                <span style="
                    font-family: var(--font-body);
                    font-size: 20px;
                    color: ${COLORS.mint};
                ">Grace Period (Manager Approval)</span>
                <span id="grace-value-${cat.id}" style="
                    font-family: var(--font-display);
                    font-size: 28px;
                    color: ${COLORS.yellow};
                ">${cat.grace_minutes} min</span>
            `;
            graceSection.appendChild(graceLabel);

            // Custom slider
            const sliderContainer = document.createElement('div');
            sliderContainer.style.cssText = `
                position: relative;
                width: 100%;
                height: 40px;
                display: flex;
                align-items: center;
            `;

            const slider = document.createElement('input');
            slider.type = 'range';
            slider.min = '0';
            slider.max = '15';
            slider.step = '1';
            slider.value = cat.grace_minutes;
            slider.style.cssText = `
                -webkit-appearance: none;
                appearance: none;
                width: 100%;
                height: 10px;
                background: linear-gradient(to right,
                    ${COLORS.mint} 0%,
                    ${COLORS.mint} ${(cat.grace_minutes / 15) * 100}%,
                    rgba(var(--color-mint-rgb), 0.15) ${(cat.grace_minutes / 15) * 100}%,
                    rgba(var(--color-mint-rgb), 0.15) 100%
                );
                border-radius: 5px;
                outline: none;
                cursor: pointer;
            `;

            slider.addEventListener('input', (e) => {
                const val = parseInt(e.target.value);
                const pct = (val / 15) * 100;

                // Update slider track fill
                slider.style.background = `linear-gradient(to right,
                    ${COLORS.mint} 0%, ${COLORS.mint} ${pct}%,
                    rgba(var(--color-mint-rgb), 0.15) ${pct}%, rgba(var(--color-mint-rgb), 0.15) 100%
                )`;

                // Update display value
                const display = document.getElementById(`grace-value-${cat.id}`);
                if (display) {
                    display.textContent = val === 0 ? 'Off' : `${val} min`;
                }
            });

            slider.addEventListener('change', (e) => {
                const updated = clone(getWorkingCategory(cat.id));
                updated.grace_minutes = parseInt(e.target.value);
                trackCategoryChange(updated);
            });

            sliderContainer.appendChild(slider);
            graceSection.appendChild(sliderContainer);

            // Tick labels
            const ticks = document.createElement('div');
            ticks.style.cssText = `
                display: flex;
                justify-content: space-between;
                padding: 4px 2px;
            `;
            ticks.innerHTML = `
                <span style="font-family: var(--font-body); font-size: 16px; color: ${COLORS.grey};">Off</span>
                <span style="font-family: var(--font-body); font-size: 16px; color: ${COLORS.grey};">5</span>
                <span style="font-family: var(--font-body); font-size: 16px; color: ${COLORS.grey};">10</span>
                <span style="font-family: var(--font-body); font-size: 16px; color: ${COLORS.grey};">15 min</span>
            `;
            graceSection.appendChild(ticks);

            // Explanation
            const graceExplain = document.createElement('div');
            graceExplain.style.cssText = `
                font-family: var(--font-body);
                font-size: 18px;
                color: ${COLORS.grey};
                margin-top: 10px;
                line-height: 1.5;
            `;
            graceExplain.textContent = cat.grace_minutes > 0
                ? `After ${cat.time_end || 'close time'}, servers can still order for ${cat.grace_minutes} minutes with manager PIN approval. Every override is logged.`
                : 'No grace period — menu cuts off immediately at end time.';
            graceSection.appendChild(graceExplain);

            body.appendChild(graceSection);
        }

        // --- Special: Label + Active Toggle ---
        if (cat.schedule_type === 'special') {
            const specialSection = document.createElement('div');
            specialSection.style.cssText = `margin-bottom: 10px;`;

            // Special label input
            const labelGroup = document.createElement('div');
            labelGroup.style.cssText = `margin-bottom: 20px;`;

            const labelTitle = document.createElement('div');
            labelTitle.style.cssText = `
                font-family: var(--font-body);
                font-size: 20px;
                color: ${COLORS.mint};
                margin-bottom: 6px;
            `;
            labelTitle.textContent = 'Special Name';
            labelGroup.appendChild(labelTitle);

            const labelInput = document.createElement('input');
            labelInput.type = 'text';
            labelInput.placeholder = "Valentine's Day Prix Fixe, Sunday Brunch...";
            labelInput.value = cat.special_label || '';
            labelInput.style.cssText = `
                width: 100%;
                padding: 12px 14px;
                background: rgba(var(--color-mint-rgb), 0.08);
                border: 1px solid rgba(var(--color-mint-rgb), 0.25);
                border-radius: 8px;
                color: ${COLORS.mint};
                font-family: var(--font-body);
                font-size: 25px;
                outline: none;
                box-sizing: border-box;
                transition: border-color 0.2s ease;
            `;
            labelInput.addEventListener('focus', () => { labelInput.style.borderColor = COLORS.mint; });
            labelInput.addEventListener('blur', () => {
                labelInput.style.borderColor = 'rgba(var(--color-mint-rgb), 0.25)';
                const updated = clone(getWorkingCategory(cat.id));
                updated.special_label = labelInput.value.trim();
                trackCategoryChange(updated);
            });
            labelGroup.appendChild(labelInput);
            specialSection.appendChild(labelGroup);

            // Active toggle — big, unmissable
            const toggleRow = document.createElement('div');
            toggleRow.style.cssText = `
                display: flex;
                align-items: center;
                justify-content: space-between;
                padding: 16px 20px;
                background: ${cat.special_active ? 'rgba(156, 39, 176, 0.15)' : 'rgba(var(--color-mint-rgb), 0.04)'};
                border: 2px solid ${cat.special_active ? '#CE93D8' : 'rgba(var(--color-mint-rgb), 0.1)'};
                border-radius: 10px;
            `;

            const toggleLabel = document.createElement('div');
            toggleLabel.style.cssText = `
                font-family: var(--font-body);
                font-size: 25px;
                color: ${cat.special_active ? '#CE93D8' : COLORS.grey};
            `;
            toggleLabel.innerHTML = cat.special_active
                ? '✦ <strong>LIVE</strong> — Visible on terminals'
                : '✦ Off — Hidden from terminals';
            toggleRow.appendChild(toggleLabel);

            const toggleSwitch = buildToggleSwitch(cat.special_active, (newVal) => {
                const updated = clone(getWorkingCategory(cat.id));
                updated.special_active = newVal;
                trackCategoryChange(updated);
                rebuildCategoryCard(cat.id);
            });
            toggleRow.appendChild(toggleSwitch);

            specialSection.appendChild(toggleRow);
            body.appendChild(specialSection);
        }

        card.appendChild(body);
    }

    return card;
}

/** Rebuild a single category card without re-rendering everything */
function rebuildCategoryCard(catId) {
    const existing = document.getElementById(`cat-sched-${catId}`);
    if (!existing) return;

    const baseCat = availData.categories.find(c => c.id === catId);
    const newCard = buildCategoryScheduleCard(baseCat);
    existing.replaceWith(newCard);
    updateFooter();
}

/* ------------------------------------------
   RENDER: 86 BOARD (Item Toggle List)
------------------------------------------ */
function renderItemBoard() {
    const container = document.getElementById('avail-item-board');
    if (!container) return;

    container.innerHTML = '';

    const categories = availData.categories
        .sort((a, b) => a.display_order - b.display_order);

    categories.forEach(cat => {
        let catItems = availData.items.filter(i => i.category_id === cat.id);

        // Search filter
        if (displayState.searchTerm.trim()) {
            const term = displayState.searchTerm.toLowerCase().trim();
            catItems = catItems.filter(item =>
                item.name.toLowerCase().includes(term)
            );
            if (catItems.length === 0) return;
        }

        // Category subheader
        const catHeader = document.createElement('div');
        catHeader.style.cssText = `
            font-family: var(--font-body);
            font-size: 22px;
            color: ${COLORS.yellow};
            padding: 12px 0 8px 0;
            margin-top: 8px;
            display: flex;
            align-items: center;
            gap: 8px;
        `;

        const workingCat = getWorkingCategory(cat.id);
        let schedNote = '';
        if (workingCat.schedule_type === 'scheduled' && workingCat.time_start && workingCat.time_end) {
            schedNote = ` · ${workingCat.time_start} – ${workingCat.time_end}`;
        } else if (workingCat.schedule_type === 'special') {
            schedNote = workingCat.special_active ? ' · ✦ Special (LIVE)' : ' · ✦ Special (Off)';
        }

        catHeader.innerHTML = `
            <span>${cat.emoji}</span>
            <strong>${cat.name}</strong>
            <span style="color: ${COLORS.grey}; font-size: 18px;">${schedNote}</span>
        `;
        container.appendChild(catHeader);

        // Item rows
        catItems.forEach(baseItem => {
            const item = getWorkingItem(baseItem.id);
            const row = buildItemRow(item);
            container.appendChild(row);
        });
    });
}

/* ------------------------------------------
   RENDER: SINGLE ITEM ROW (86 Board)
------------------------------------------ */
function buildItemRow(item) {
    const hasPending = pendingChanges.items.some(i => i.id === item.id);

    const row = document.createElement('div');
    row.style.cssText = `
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 14px 20px;
        background: ${item.available ? 'rgba(var(--color-mint-rgb), 0.04)' : COLORS.redFaded};
        border: 1px solid ${hasPending ? COLORS.yellow : (item.available ? 'rgba(var(--color-mint-rgb), 0.08)' : 'rgba(var(--color-vermillion-rgb), 0.3)')};
        border-radius: 8px;
        margin-bottom: 6px;
        transition: all 0.2s ease;
    `;

    // Left: name + price
    const leftSide = document.createElement('div');
    leftSide.style.cssText = `display: flex; align-items: center; gap: 20px;`;

    const nameEl = document.createElement('span');
    nameEl.style.cssText = `
        font-family: var(--font-body);
        font-size: 25px;
        color: ${item.available ? COLORS.mint : COLORS.red};
        ${item.available ? '' : 'text-decoration: line-through;'}
    `;
    nameEl.textContent = item.name;
    leftSide.appendChild(nameEl);

    const priceEl = document.createElement('span');
    priceEl.style.cssText = `
        font-family: var(--font-body);
        font-size: 20px;
        color: ${COLORS.grey};
    `;
    priceEl.textContent = formatPrice(item.price);
    leftSide.appendChild(priceEl);

    // 86 timestamp
    if (!item.available && item.eightysixed_at) {
        const timeEl = document.createElement('span');
        timeEl.style.cssText = `
            font-family: var(--font-body);
            font-size: 16px;
            color: ${COLORS.red};
            opacity: 0.7;
        `;
        timeEl.textContent = `86'd at ${item.eightysixed_at}`;
        leftSide.appendChild(timeEl);
    }

    row.appendChild(leftSide);

    // Right: toggle switch
    const toggle = buildToggleSwitch(item.available, (newVal) => {
        const updated = clone(item);
        updated.available = newVal;
        updated.eightysixed_at = newVal ? null : new Date().toLocaleTimeString('en-US', {
            hour: 'numeric',
            minute: '2-digit',
            hour12: true,
        });
        trackItemChange(updated);

        // Re-render just this row
        const parent = row.parentElement;
        const newRow = buildItemRow(updated);
        row.replaceWith(newRow);

        // Update header gauge
        buildMainView(currentWrapper);
    });
    row.appendChild(toggle);

    return row;
}

/* ------------------------------------------
   COMPONENT: TOGGLE SWITCH
   Reusable on/off toggle with smooth
   animation. Mint = on, Red = off.
------------------------------------------ */
function buildToggleSwitch(isOn, onChange) {
    const track = document.createElement('div');
    track.style.cssText = `
        width: 64px;
        height: 34px;
        background: ${isOn ? COLORS.mint : 'rgba(var(--color-vermillion-rgb), 0.5)'};
        border-radius: 17px;
        position: relative;
        cursor: pointer;
        transition: background 0.2s ease;
        flex-shrink: 0;
    `;

    const thumb = document.createElement('div');
    thumb.style.cssText = `
        width: 28px;
        height: 28px;
        background: ${COLORS.white};
        border-radius: 50%;
        position: absolute;
        top: 3px;
        left: ${isOn ? '33px' : '3px'};
        transition: left 0.2s ease;
        box-shadow: 0 1px 4px rgba(0,0,0,0.3);
    `;
    track.appendChild(thumb);

    track.addEventListener('click', (e) => {
        e.stopPropagation();
        const newVal = !isOn;
        onChange(newVal);
    });

    return track;
}

/* ------------------------------------------
   FOOTER: CHANGE TRACKER
------------------------------------------ */
function updateFooter() {
    const footer = document.getElementById('avail-change-footer');
    if (!footer) return;

    const count = getPendingCount();

    if (count === 0) {
        footer.style.display = 'none';
        return;
    }

    footer.style.display = 'flex';
    footer.innerHTML = '';

    // Left: counter
    const counter = document.createElement('div');
    counter.style.cssText = `
        font-family: var(--font-body);
        font-size: 22px;
        color: ${COLORS.yellow};
        display: flex;
        align-items: center;
        gap: 8px;
    `;
    counter.innerHTML = `⚠️ <strong>${count} unsaved change${count !== 1 ? 's' : ''}</strong>`;
    footer.appendChild(counter);

    // Right: buttons
    const btnGroup = document.createElement('div');
    btnGroup.style.cssText = `display: flex; gap: 12px;`;

    const cancelBtn = document.createElement('button');
    cancelBtn.style.cssText = `
        padding: 12px 24px;
        background: transparent;
        border: 1px solid ${COLORS.grey};
        border-radius: 8px;
        color: ${COLORS.grey};
        font-family: var(--font-body);
        font-size: 22px;
        cursor: pointer;
        transition: all 0.2s ease;
    `;
    cancelBtn.textContent = 'Cancel';
    cancelBtn.addEventListener('mouseenter', () => {
        cancelBtn.style.borderColor = COLORS.red;
        cancelBtn.style.color = COLORS.red;
    });
    cancelBtn.addEventListener('mouseleave', () => {
        cancelBtn.style.borderColor = COLORS.grey;
        cancelBtn.style.color = COLORS.grey;
    });
    cancelBtn.addEventListener('click', () => {
        showConfirmDialog(
            'Discard Changes?',
            `You have ${count} unsaved change${count !== 1 ? 's' : ''}. This cannot be undone.`,
            'Discard',
            () => {
                pendingChanges = { categories: [], items: [] };
                buildMainView(currentWrapper);
            }
        );
    });
    btnGroup.appendChild(cancelBtn);

    const saveBtn = document.createElement('button');
    saveBtn.style.cssText = `
        padding: 12px 24px;
        background: ${COLORS.mint};
        border: none;
        border-radius: 8px;
        color: ${COLORS.dark};
        font-family: var(--font-body);
        font-size: 22px;
        font-weight: bold;
        cursor: pointer;
        transition: all 0.2s ease;
    `;
    saveBtn.textContent = 'Save Changes';
    saveBtn.addEventListener('mouseenter', () => { saveBtn.style.background = COLORS.mintHover; });
    saveBtn.addEventListener('mouseleave', () => { saveBtn.style.background = COLORS.mint; });
    saveBtn.addEventListener('click', () => {
        handleSaveChanges();
    });
    btnGroup.appendChild(saveBtn);
    footer.appendChild(btnGroup);
}

/* ------------------------------------------
   SAVE: Generate Events & Log
------------------------------------------ */
function handleSaveChanges() {
    const events = generateAvailabilityEvents(pendingChanges);

    console.log('%c[KINDpos] Availability Events Generated', 'background: #333; color: var(--color-gold); font-size: 14px; padding: 2px 8px;');
    console.log(`Batch contains ${events.length} events:`);
    events.forEach((evt, i) => {
        console.log(`  ${i + 1}. ${evt.event_type} — ${JSON.stringify(evt.payload)}`);
    });

    // Apply to base data
    pendingChanges.categories.forEach(updated => {
        const idx = availData.categories.findIndex(c => c.id === updated.id);
        if (idx !== -1) availData.categories[idx] = clone(updated);
    });

    pendingChanges.items.forEach(updated => {
        const idx = availData.items.findIndex(i => i.id === updated.id);
        if (idx !== -1) availData.items[idx] = clone(updated);
    });

    pendingChanges = { categories: [], items: [] };
    buildMainView(currentWrapper);
    showToast(`${events.length} change${events.length !== 1 ? 's' : ''} saved successfully`);
}

/* ------------------------------------------
   EVENT GENERATION
------------------------------------------ */
function generateAvailabilityEvents(changes) {
    const events = [];
    const batch_id = `avail_batch_${Date.now()}`;

    changes.categories.forEach(cat => {
        events.push({
            event_type: 'menu.category_schedule_updated',
            batch_id,
            timestamp: new Date().toISOString(),
            payload: {
                category_id: cat.id,
                schedule_type: cat.schedule_type,
                time_start: cat.time_start,
                time_end: cat.time_end,
                grace_minutes: cat.grace_minutes,
                active_days: cat.active_days,
                special_active: cat.special_active,
                special_label: cat.special_label,
            }
        });
    });

    changes.items.forEach(item => {
        events.push({
            event_type: item.available ? 'menu.item_available' : 'menu.item_eightysixed',
            batch_id,
            timestamp: new Date().toISOString(),
            payload: {
                item_id: item.id,
                available: item.available,
                eightysixed_at: item.eightysixed_at,
            }
        });
    });

    return events;
}

/* ------------------------------------------
   CONFIRM DIALOG (themed)
   Replaces native confirm() to match
   the retro Overseer aesthetic.
------------------------------------------ */
function showConfirmDialog(title, message, confirmLabel, onConfirm) {
    const overlay = document.createElement('div');
    overlay.style.cssText = `
        position: fixed;
        top: 0; left: 0; right: 0; bottom: 0;
        background: rgba(0, 0, 0, 0.75);
        z-index: 300;
        display: flex;
        align-items: center;
        justify-content: center;
    `;

    const dialog = document.createElement('div');
    dialog.style.cssText = `
        background: ${COLORS.dark};
        border: 2px solid ${COLORS.red};
        border-radius: 12px;
        padding: 32px;
        width: 420px;
        text-align: center;
    `;

    dialog.innerHTML = `
        <div style="
            font-family: var(--font-display);
            font-size: 28px;
            color: ${COLORS.red};
            margin-bottom: 16px;
        ">${title}</div>
        <div style="
            font-family: var(--font-body);
            font-size: 22px;
            color: ${COLORS.grey};
            margin-bottom: 28px;
            line-height: 1.5;
        ">${message}</div>
    `;

    const btnRow = document.createElement('div');
    btnRow.style.cssText = `display: flex; gap: 12px; justify-content: center;`;

    const keepBtn = document.createElement('button');
    keepBtn.style.cssText = `
        padding: 12px 28px;
        background: transparent;
        border: 1px solid ${COLORS.mint};
        border-radius: 8px;
        color: ${COLORS.mint};
        font-family: var(--font-body);
        font-size: 22px;
        cursor: pointer;
        transition: all 0.2s ease;
    `;
    keepBtn.textContent = 'Keep Editing';
    keepBtn.addEventListener('mouseenter', () => {
        keepBtn.style.background = 'rgba(var(--color-mint-rgb), 0.1)';
    });
    keepBtn.addEventListener('mouseleave', () => {
        keepBtn.style.background = 'transparent';
    });
    keepBtn.addEventListener('click', () => overlay.remove());
    btnRow.appendChild(keepBtn);

    const discardBtn = document.createElement('button');
    discardBtn.style.cssText = `
        padding: 12px 28px;
        background: ${COLORS.redFaded};
        border: 2px solid ${COLORS.red};
        border-radius: 8px;
        color: ${COLORS.white};
        font-family: var(--font-body);
        font-size: 22px;
        font-weight: bold;
        cursor: pointer;
        transition: all 0.2s ease;
    `;
    discardBtn.textContent = confirmLabel;
    discardBtn.addEventListener('mouseenter', () => {
        discardBtn.style.background = 'rgba(var(--color-vermillion-rgb), 0.5)';
    });
    discardBtn.addEventListener('mouseleave', () => {
        discardBtn.style.background = COLORS.redFaded;
    });
    discardBtn.addEventListener('click', () => {
        overlay.remove();
        onConfirm();
    });
    btnRow.appendChild(discardBtn);

    dialog.appendChild(btnRow);
    overlay.appendChild(dialog);

    // ESC to dismiss
    const escHandler = (e) => {
        if (e.key === 'Escape') {
            overlay.remove();
            document.removeEventListener('keydown', escHandler);
        }
    };
    document.addEventListener('keydown', escHandler);

    // Click outside to dismiss
    overlay.addEventListener('click', (e) => {
        if (e.target === overlay) overlay.remove();
    });

    document.body.appendChild(overlay);
}

/* ------------------------------------------
   TOAST NOTIFICATION
------------------------------------------ */
function showToast(message) {
    const toast = document.createElement('div');
    toast.style.cssText = `
        position: fixed;
        top: 24px;
        right: 24px;
        padding: 16px 28px;
        background: ${COLORS.mint};
        color: ${COLORS.dark};
        font-family: var(--font-body);
        font-size: 22px;
        font-weight: bold;
        border-radius: 8px;
        z-index: 200;
        box-shadow: 0 4px 20px rgba(0,0,0,0.3);
    `;
    toast.textContent = `✓ ${message}`;
    document.body.appendChild(toast);

    setTimeout(() => {
        toast.style.opacity = '0';
        toast.style.transition = 'opacity 0.3s ease';
        setTimeout(() => toast.remove(), 300);
    }, 2500);
}

/* ------------------------------------------
   CSS: SLIDER STYLING
   Injected once for the range input thumb
------------------------------------------ */
function injectStyles() {
    if (document.getElementById('avail-scene-styles')) return;

    const style = document.createElement('style');
    style.id = 'avail-scene-styles';
    style.textContent = `
        /* Range slider thumb — webkit (Chrome, Edge, Android) */
        #menu-avail-wrapper input[type="range"]::-webkit-slider-thumb {
            -webkit-appearance: none;
            appearance: none;
            width: 28px;
            height: 28px;
            background: ${COLORS.yellow};
            border-radius: 50%;
            cursor: pointer;
            box-shadow: 0 2px 6px rgba(0,0,0,0.3);
            border: 3px solid ${COLORS.dark};
        }

        /* Range slider thumb — Firefox */
        #menu-avail-wrapper input[type="range"]::-moz-range-thumb {
            width: 28px;
            height: 28px;
            background: ${COLORS.yellow};
            border-radius: 50%;
            cursor: pointer;
            box-shadow: 0 2px 6px rgba(0,0,0,0.3);
            border: 3px solid ${COLORS.dark};
        }

        /* Select dropdown styling */
        #menu-avail-wrapper select option {
            background: ${COLORS.dark};
            color: ${COLORS.mint};
        }
    `;
    document.head.appendChild(style);
}

/* ------------------------------------------
   PUBLIC: Register scene with scene manager
------------------------------------------ */
export function registerMenuAvailability(sceneManager) {
    sceneManager.register('menu-availability', {
        type: 'detail',
        title: 'Availability',
        parent: 'menu-subs',
        async onEnter(container) {
            console.log('[MenuAvailability] Scene loaded — initializing...');

            injectStyles();

            // Clone test data
            availData = await fetchAvailabilityData();
            pendingChanges = { categories: [], items: [] };
            displayState = { searchTerm: '', expandedCategories: {} };

            // Build container
            currentWrapper = document.createElement('div');
            currentWrapper.id = 'menu-avail-wrapper';
            currentWrapper.style.cssText = `
                max-width: 1100px;
                margin: 0 auto;
                padding: 10px 20px 40px 20px;
            `;
            container.appendChild(currentWrapper);

            buildMainView(currentWrapper);

            console.log(`[MenuAvailability] Loaded ${availData.categories.length} categories, ${availData.items.length} items.`);
            console.log('[MenuAvailability] Ready.');
        },
        onExit(container) {
            currentWrapper = null;
            availData = { categories: [], items: [] };
            pendingChanges = { categories: [], items: [] };
            displayState = { searchTerm: '', expandedCategories: {} };
            container.innerHTML = '';
        },
    });
}