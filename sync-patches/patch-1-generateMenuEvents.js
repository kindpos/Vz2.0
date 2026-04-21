/* =============================================================
   PATCH: menu-categories.js — availability event rename
   =============================================================
   Replace the existing generateMenuEvents() function in
   overseer/src/sections/menu-categories.js with this version.

   Only change: availability events now emit the names backend
   already understands (menu.item_86d / menu.item_restored) and
   the payload drops `eightysixed_at` since the backend timestamps
   via the event's own timestamp field.

   Also note: `menu.items_reordered` and `menu.categories_reordered`
   will still fail until the Python enum patch lands (patch 3), so
   this JS change on its own fixes availability but not reorder.
   ============================================================= */

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
            payload: { item_id: item.id, changes: itemPayload(item, false) },
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
