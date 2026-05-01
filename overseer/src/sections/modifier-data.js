/**
 * modifier-data.js
 * Data layer for the Configure Modifiers scene.
 * Owns: remote fetch + deduplication, save orchestration.
 */

import { pushChanges } from '../services/config-push.js';

export const EMPTY_DATA = { modifiers: [], groups: [], categories: [] };

/* ------------------------------------------
   DATA FETCH
   Pulls from /menu (projection) + /config/menu/categories.
   Deduplicates modifiers across groups into a flat
   master list. No mandatory/universal fetches
   since those endpoints no longer exist.
------------------------------------------ */
export async function fetchModifierData() {
    try {
        const [menuRes, catRes] = await Promise.all([
            fetch('/api/v1/menu'),
            fetch('/api/v1/config/menu/categories'),
        ]);
        const menu = menuRes.ok ? await menuRes.json() : { modifier_groups: [] };
        const cats = catRes.ok ? await catRes.json() : [];

        const modifiersById = new Map();
        const groups = [];

        for (const grp of (menu.modifier_groups || [])) {
            // Skip any legacy hidden per-item groups from the old
            // "included_<item_id>" pattern. These will disappear
            // entirely once the new menu-categories.js lands.
            if (grp.hidden) continue;

            const mods = grp.modifiers || [];
            const subcatMods = (grp.subcats || []).flatMap(sc => sc.modifiers || []);
            const allGrpMods = [...mods, ...subcatMods];

            for (const m of allGrpMods) {
                const mid = m.modifier_id;
                if (!mid) continue;
                const scopedKey = `${grp.group_id}:${mid}`;
                if (!modifiersById.has(scopedKey)) {
                    modifiersById.set(scopedKey, {
                        id: scopedKey,
                        name: m.name || mid,
                        base_price: parseFloat(m.price) || 0,
                        included_modifier_ids: Array.isArray(m.included_modifier_ids)
                            ? [...m.included_modifier_ids]
                            : [],
                    });
                } else if (Array.isArray(m.included_modifier_ids) && m.included_modifier_ids.length) {
                    const existing = modifiersById.get(scopedKey);
                    const merged = new Set([...existing.included_modifier_ids, ...m.included_modifier_ids]);
                    existing.included_modifier_ids = Array.from(merged);
                }
            }

            const priceByOptionMap = {};
            allGrpMods.forEach(m => {
                const mid = m.modifier_id;
                if (!mid) return;
                const scopedKey = `${grp.group_id}:${mid}`;
                if (m.price_by_option && Object.keys(m.price_by_option).length > 0) {
                    priceByOptionMap[scopedKey] = m.price_by_option;
                }
            });

            groups.push({
                id: grp.group_id,
                name: grp.name || '',
                modifier_ids: allGrpMods.map(m => {
                    const mid = m.modifier_id;
                    return mid ? `${grp.group_id}:${mid}` : null;
                }).filter(Boolean),
                min_selections: grp.min_selections ?? 0,
                max_selections: grp.max_selections ?? 1,
                drives_pricing: !!grp.drives_pricing,
                price_by_option_map: priceByOptionMap,
                color: grp.color || null,
                category_id: grp.category_id || null,
            });
        }

        return {
            modifiers: Array.from(modifiersById.values()).sort((a, b) => a.name.localeCompare(b.name)),
            groups: groups.sort((a, b) => a.name.localeCompare(b.name)),
            categories: cats.map(c => ({
                id: c.category_id || c.id,
                name: c.name || c.label,
            })),
        };
    } catch (e) {
        console.warn('[ConfigureModifiers] Failed to fetch data:', e);
        return { modifiers: [], groups: [], categories: [] };
    }
}

/**
 * Save orchestrator.
 *
 * Strategy:
 *   1. Collect dirty group IDs — explicit group edits AND any groups
 *      containing a changed modifier.
 *   2. For each dirty group, rebuild its modifiers[] payload from
 *      current modifier state (merging pending modifier changes so microMOD
 *      + name + price ride through).
 *   3. Emit modifier.group_created / _updated / _deleted for each.
 *   4. No modifier-level events are emitted — modifiers exist only inside
 *      groups in the backend projection.
 *
 * Orphan modifiers (in pendingChanges.modifiers but not referenced by any
 * group) produce no events and are dropped silently on next reload.
 * The Modifiers tab shows ⚠ NO GROUP badges so operators can catch this.
 *
 * ctx: {
 *   pendingChanges, modData,         — current values (modData mutated in-place)
 *   setPendingChanges,               — rebind pendingChanges in caller's scope
 *   getAllWorking, getPendingCount,   — utility functions from caller
 *   clone, showToast,                — utility functions from caller
 *   buildMainView, currentWrapper,   — UI callbacks from caller
 * }
 */
export async function handleSaveChanges(ctx) {
    const {
        pendingChanges,
        modData,
        setPendingChanges,
        getAllWorking,
        getPendingCount,
        clone,
        showToast,
        buildMainView,
        currentWrapper,
    } = ctx;

    if (getPendingCount() === 0) return;

    const events = [];

    // 1. Collect dirty group IDs
    const dirtyGroupIds = new Set();
    (pendingChanges.groups || []).forEach(g => dirtyGroupIds.add(g.id));
    (pendingChanges.modifiers || []).forEach(modifier => {
        const allGroups = getAllWorking('groups');
        allGroups.forEach(g => {
            if ((g.modifier_ids || []).includes(modifier.id)) {
                dirtyGroupIds.add(g.id);
            }
        });
    });

    // 2+3. Emit events per dirty group
    const orphanedModifierIds = [];
    dirtyGroupIds.forEach(gid => {
        const pendingG = (pendingChanges.groups || []).find(g => g.id === gid);
        const baseG = (modData.groups || []).find(g => g.id === gid);

        if (pendingG?._deleted) {
            events.push({ event_type: 'modifier.group_deleted', payload: { group_id: gid } });
            return;
        }

        const g = pendingG || baseG;
        if (!g) return;

        const isNew = !baseG;
        // Build modifiers[] using current modifier state
        const workingModifiers = getAllWorking('modifiers');
        const modifiers = (g.modifier_ids || []).map(mid => {
            const modifier = workingModifiers.find(a => a.id === mid);
            if (!modifier) return null;
            const base = {
                modifier_id: mid,
                name: modifier.name,
                price: modifier.base_price || 0,
            };
            if (modifier.included_modifier_ids && modifier.included_modifier_ids.length > 0) {
                base.included_modifier_ids = modifier.included_modifier_ids.slice();
            }
            const overrides = (g.price_by_option_map || {})[mid];
            if (overrides && Object.keys(overrides).length > 0) {
                base.price_by_option = overrides;
            }
            return base;
        }).filter(Boolean);

        events.push({
            event_type: isNew ? 'modifier.group_created' : 'modifier.group_updated',
            payload: {
                group_id: gid,
                name: g.name,
                modifier_ids: g.modifier_ids || [],
                modifiers,
                min_selections: g.min_selections ?? 0,
                max_selections: g.max_selections ?? 1,
                drives_pricing: !!g.drives_pricing,
            },
        });
    });

    // Detect orphaned modifiers (for warning)
    (pendingChanges.modifiers || []).forEach(modifier => {
        if (modifier._deleted) return;
        const allGroups = getAllWorking('groups');
        const referenced = allGroups.some(g => (g.modifier_ids || []).includes(modifier.id));
        if (!referenced && !(modData.modifiers || []).some(a => a.id === modifier.id)) {
            orphanedModifierIds.push(modifier.id);
        }
    });

    if (events.length === 0 && orphanedModifierIds.length > 0) {
        showToast(`${orphanedModifierIds.length} modifier(s) not in any group — add them to a group to persist`, 'warning');
        return;
    }

    if (events.length === 0) {
        showToast('No events to push', 'warning');
        return;
    }

    try {
        const result = await pushChanges(events);
        if (!result || !result.ok) {
            showToast('Failed to save changes', 'error');
            return;
        }
    } catch (e) {
        console.error('[ConfigureModifiers] Save failed:', e);
        showToast('Failed to save changes', 'error');
        return;
    }

    // Apply pending to base data
    const modifiers = getAllWorking('modifiers');
    modData.modifiers = modifiers;

    (pendingChanges.groups || []).forEach(g => {
        if (g._deleted) {
            modData.groups = (modData.groups || []).filter(x => x.id !== g.id);
        } else {
            const idx = (modData.groups || []).findIndex(x => x.id === g.id);
            if (idx >= 0) modData.groups[idx] = clone(g);
            else modData.groups.push(clone(g));
        }
    });

    setPendingChanges({ modifiers: [], groups: [] });
    buildMainView(currentWrapper);

    const msg = orphanedModifierIds.length > 0
        ? `${events.length} saved · ${orphanedModifierIds.length} orphan modifier(s) not persisted`
        : `${events.length} change${events.length === 1 ? '' : 's'} saved`;
    showToast(msg, orphanedModifierIds.length > 0 ? 'warning' : 'confirm');
}
