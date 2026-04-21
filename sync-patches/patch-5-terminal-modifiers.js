/* ================================================================
   PATCH: terminal/scenes/order-entry.js — modifier wiring rewrite
   ================================================================

   Three surgical edits that make the terminal read new-model modifier
   wiring (item.mandatory_group_ids, item.included_modifier_ids,
   category.universal_group_ids) instead of legacy assignment tables.

   Apply in order. Each is a str_replace against the current file.

   Changes are additive + backward compatible: hardcoded fallbacks in
   the caller still fire for items with zero modifier wiring, so any
   legacy seed data keeps working until re-authored through Overseer.

   After applying: restart the terminal in your browser (refresh),
   open a pizza, verify the included modifiers (from pizza.included_modifier_ids)
   show up pre-applied on the check.
   ================================================================ */


/* ──────────────────────────────────────────────────────────────────
   EDIT 1 — Preserve new-model fields on MENU_DATA transform
   ──────────────────────────────────────────────────────────────────
   Location: around line 126-135 (inside fetchMenuFromAPI, the
   MENU_DATA = menu.categories.map(...) block).

   FIND:
──────────────────────────────────────────────────────────────────── */

    MENU_DATA = menu.categories.map(function(cat) {
      var catItems = (itemsByCatId[cat.category_id] || [])
        .sort(function(a, b) { return (a.display_order || 999) - (b.display_order || 999); })
        .map(function(item) {
          var hexItem = { label: item.name, price: item.price, id: item.item_id || item.id };
          if (item.pizza_size) hexItem.pizzaSize = true;
          if (item.mods) hexItem.requiredMods = item.mods;
          return hexItem;
        });
      // Prefer the user-set color from the Overseer; fall back to theme token
      var catColor = cat.color || cat.hex_color || T.catColor(cat.label || cat.name.toUpperCase()) || T.mutedText;
      var textColor = _textColorForHex(catColor);
      return {
        id: cat.category_id,
        label: cat.label || cat.name.toUpperCase(),
        color: catColor,
        textColor: textColor,
        pizzaBuilder: cat.pizza_builder || false,
        enablePlacement: cat.enable_placement === true,
        subcats: [{ id: cat.category_id + '-items', label: cat.name, items: catItems }],
      };
    });

/* REPLACE WITH:
──────────────────────────────────────────────────────────────────── */

    MENU_DATA = menu.categories.map(function(cat) {
      var catItems = (itemsByCatId[cat.category_id] || [])
        .sort(function(a, b) { return (a.display_order || 999) - (b.display_order || 999); })
        .map(function(item) {
          var hexItem = { label: item.name, price: item.price, id: item.item_id || item.id };
          if (item.pizza_size) hexItem.pizzaSize = true;
          if (item.mods) hexItem.requiredMods = item.mods;
          // Preserve new-model modifier wiring authored in Overseer.
          // mandatoryGroupIds → groups forced at order entry (pizza size, etc).
          // includedModifierIds → atoms pre-applied to the check on add.
          if (item.mandatory_group_ids && item.mandatory_group_ids.length > 0) {
            hexItem.mandatoryGroupIds = item.mandatory_group_ids.slice();
          }
          if (item.included_modifier_ids && item.included_modifier_ids.length > 0) {
            hexItem.includedModifierIds = item.included_modifier_ids.slice();
          }
          return hexItem;
        });
      // Prefer the user-set color from the Overseer; fall back to theme token
      var catColor = cat.color || cat.hex_color || T.catColor(cat.label || cat.name.toUpperCase()) || T.mutedText;
      var textColor = _textColorForHex(catColor);
      return {
        id: cat.category_id,
        label: cat.label || cat.name.toUpperCase(),
        color: catColor,
        textColor: textColor,
        pizzaBuilder: cat.pizza_builder || false,
        enablePlacement: cat.enable_placement === true,
        // Universal groups attach at the category level — every item in this
        // category gets these as OPT-tab options at order entry.
        universalGroupIds: (cat.universal_group_ids || []).slice(),
        subcats: [{ id: cat.category_id + '-items', label: cat.name, items: catItems }],
      };
    });


/* ──────────────────────────────────────────────────────────────────
   EDIT 2 — Populate INCLUDED_BY_ITEM from item.included_modifier_ids
   ──────────────────────────────────────────────────────────────────
   Location: around line 150-170 (the modifier_groups processing
   block that sets INCLUDED_BY_ITEM from hidden groups).

   The change: after processing hidden legacy groups, ALSO walk the
   items array and populate INCLUDED_BY_ITEM from each item's
   included_modifier_ids field. New-model data wins over legacy
   (menu-categories.js emits modifier.group_deleted when migrating,
   so legacy entries disappear naturally — but this ordering handles
   any partial-migration state.)

   FIND:
──────────────────────────────────────────────────────────────────── */

    INCLUDED_BY_ITEM = {};
    MODIFIER_GROUPS = [];
    MODIFIER_MASTER = {};
    (menu.modifier_groups || []).forEach(function(g) {
      // Always index modifiers into MODIFIER_MASTER so mandatory-assignment
      // lookups resolve names for modifiers that live in hidden groups too.
      (g.modifiers || []).forEach(function(m) {
        if (m.modifier_id && !MODIFIER_MASTER[m.modifier_id]) {
          MODIFIER_MASTER[m.modifier_id] = { name: m.name, price: parseFloat(m.price) || 0 };
        }
      });
      if (g.hidden) {
        if (g.owner_item_id) {
          var mods = (g.modifiers || []).map(function(m) { return { id: m.modifier_id, label: m.name }; });
          if (mods.length > 0) INCLUDED_BY_ITEM[g.owner_item_id] = mods;
        }
        return;
      }
      MODIFIER_GROUPS.push(g);
    });

/* REPLACE WITH:
──────────────────────────────────────────────────────────────────── */

    INCLUDED_BY_ITEM = {};
    MODIFIER_GROUPS = [];
    MODIFIER_MASTER = {};
    (menu.modifier_groups || []).forEach(function(g) {
      // Always index modifiers into MODIFIER_MASTER so later lookups
      // resolve atom names/prices even for atoms inside hidden groups.
      (g.modifiers || []).forEach(function(m) {
        if (m.modifier_id && !MODIFIER_MASTER[m.modifier_id]) {
          MODIFIER_MASTER[m.modifier_id] = { name: m.name, price: parseFloat(m.price) || 0 };
        }
      });
      if (g.hidden) {
        // Legacy hidden "included_<item_id>" groups — still honored for items
        // that haven't been migrated yet. menu-categories.js emits
        // modifier.group_deleted on first save to clean these up.
        if (g.owner_item_id) {
          var mods = (g.modifiers || []).map(function(m) { return { id: m.modifier_id, label: m.name }; });
          if (mods.length > 0) INCLUDED_BY_ITEM[g.owner_item_id] = mods;
        }
        return;
      }
      MODIFIER_GROUPS.push(g);
    });

    // New-model pass: walk items directly and build INCLUDED_BY_ITEM
    // from item.included_modifier_ids. This overrides any legacy hidden-group
    // entry with the authoritative Overseer-authored list.
    (menu.items || []).forEach(function(item) {
      var iid = item.item_id || item.id;
      var ids = item.included_modifier_ids || [];
      if (!iid || ids.length === 0) return;
      var mods = ids.map(function(mid) {
        var master = MODIFIER_MASTER[mid];
        return { id: mid, label: master ? master.name : mid };
      });
      INCLUDED_BY_ITEM[iid] = mods;
    });


/* ──────────────────────────────────────────────────────────────────
   EDIT 3 — Rewrite resolveBackendModifierConfig
   ──────────────────────────────────────────────────────────────────
   Location: around line 2229.

   The rewrite reads mandatoryGroupIds from the item (on MENU_DATA)
   and universalGroupIds from the category. Drops the legacy
   MANDATORY_ASSIGNMENTS / UNIVERSAL_ASSIGNMENTS reads entirely.

   FIND:
──────────────────────────────────────────────────────────────────── */

function resolveBackendModifierConfig(itemId, catId) {
  if (!itemId && !catId) return null;

  var mandatoryGroups = [];
  var pricingDriverKey = null;
  MANDATORY_ASSIGNMENTS.forEach(function(asgn) {
    var hit = (asgn.target_type === 'item' && asgn.target_id === itemId)
           || (asgn.target_type === 'category' && asgn.target_id === catId);
    if (!hit) return;
    var entry = {
      key: asgn.assignment_id,
      label: (asgn.label || '').toUpperCase(),
      drivesPricing: !!asgn.drives_pricing,
      options: (asgn.modifier_ids || []).map(function(mid) {
        var m = MODIFIER_MASTER[mid] || { name: mid, price: 0 };
        return { key: mid, label: m.name, price: m.price };
      }),
    };
    if (entry.drivesPricing && !pricingDriverKey) pricingDriverKey = asgn.assignment_id;
    mandatoryGroups.push(entry);
  });

  var optionalGroups = [];
  UNIVERSAL_ASSIGNMENTS.forEach(function(asgn) {
    if (asgn.category_id !== catId) return;
    (asgn.group_ids || []).forEach(function(gid) {
      var grp = MODIFIER_GROUPS.find(function(g) { return g.group_id === gid; });
      if (!grp) return;
      optionalGroups.push({
        key: grp.group_id,
        label: (grp.name || '').toUpperCase(),
        options: (grp.modifiers || []).map(function(m) {
          var priceByOption = m.price_by_option && Object.keys(m.price_by_option).length > 0 ? m.price_by_option : null;
          return {
            id: m.modifier_id,
            label: m.name,
            price: parseFloat(m.price) || 0,
            priceByOption: priceByOption,
          };
        }),
      });
    });
  });

  if (mandatoryGroups.length === 0 && optionalGroups.length === 0) return null;
  return {
    mandatoryGroups: mandatoryGroups,
    optionalGroups: optionalGroups,
    includedItems: [],
    pricingDriverKey: pricingDriverKey,
  };
}

/* REPLACE WITH:
──────────────────────────────────────────────────────────────────── */

// Build modifier config from Overseer-authored new-model wiring on MENU_DATA.
// Reads mandatoryGroupIds off the item and universalGroupIds off the category,
// then expands each referenced group into an option list.
// Returns null when no modifiers are configured — caller falls back to
// hardcoded configs for unmigrated items.
function resolveBackendModifierConfig(itemId, catId) {
  if (!itemId && !catId) return null;

  // Locate the MENU_DATA item + category to read new-model fields.
  var menuCat = catId ? MENU_DATA.find(function(c) { return c.id === catId; }) : null;
  var menuItem = null;
  if (menuCat) {
    (menuCat.subcats || []).some(function(sc) {
      menuItem = (sc.items || []).find(function(i) { return i.id === itemId; });
      return !!menuItem;
    });
  }
  // Fallback: scan all categories (item may be orphaned from catId)
  if (!menuItem && itemId) {
    MENU_DATA.some(function(c) {
      (c.subcats || []).some(function(sc) {
        menuItem = (sc.items || []).find(function(i) { return i.id === itemId; });
        return !!menuItem;
      });
      if (menuItem && !menuCat) menuCat = c;
      return !!menuItem;
    });
  }

  var mandatoryGroupIds = (menuItem && menuItem.mandatoryGroupIds) || [];
  var universalGroupIds = (menuCat && menuCat.universalGroupIds) || [];

  var mandatoryGroups = [];
  var pricingDriverKey = null;
  mandatoryGroupIds.forEach(function(gid) {
    var grp = MODIFIER_GROUPS.find(function(g) { return g.group_id === gid; });
    if (!grp) return;
    var drivesPricing = !!grp.drives_pricing;
    var entry = {
      key: gid,
      label: (grp.name || '').toUpperCase(),
      drivesPricing: drivesPricing,
      min: grp.min_selections || 0,
      max: grp.max_selections || 1,
      options: (grp.modifiers || []).map(function(m) {
        var priceByOption = (m.price_by_option && Object.keys(m.price_by_option).length > 0) ? m.price_by_option : null;
        var subatomicIds  = (m.included_modifier_ids && m.included_modifier_ids.length > 0) ? m.included_modifier_ids.slice() : null;
        return {
          key: m.modifier_id,
          id: m.modifier_id,
          label: m.name,
          price: parseFloat(m.price) || 0,
          priceByOption: priceByOption,
          includedModifierIds: subatomicIds,
        };
      }),
    };
    if (drivesPricing && !pricingDriverKey) pricingDriverKey = gid;
    mandatoryGroups.push(entry);
  });

  var optionalGroups = [];
  universalGroupIds.forEach(function(gid) {
    var grp = MODIFIER_GROUPS.find(function(g) { return g.group_id === gid; });
    if (!grp) return;
    optionalGroups.push({
      key: grp.group_id,
      label: (grp.name || '').toUpperCase(),
      min: grp.min_selections || 0,
      max: grp.max_selections || 99,
      options: (grp.modifiers || []).map(function(m) {
        var priceByOption = (m.price_by_option && Object.keys(m.price_by_option).length > 0) ? m.price_by_option : null;
        return {
          id: m.modifier_id,
          label: m.name,
          price: parseFloat(m.price) || 0,
          priceByOption: priceByOption,
        };
      }),
    });
  });

  if (mandatoryGroups.length === 0 && optionalGroups.length === 0) return null;
  return {
    mandatoryGroups: mandatoryGroups,
    optionalGroups: optionalGroups,
    includedItems: [],  // Caller overlays INCLUDED_BY_ITEM[itemId] if present
    pricingDriverKey: pricingDriverKey,
  };
}


/* ──────────────────────────────────────────────────────────────────
   OPTIONAL — Drop the dead endpoint fetches
   ──────────────────────────────────────────────────────────────────
   Around line 99-106 the fetchMenuFromAPI function fires GETs at
   /config/mandatory-assignments and /config/universal-assignments
   which don't exist. They return [] via .catch so they're harmless,
   just noise in the network tab.

   If you want them gone, replace this:
──────────────────────────────────────────────────────────────────── */

function fetchMenuFromAPI() {
  return Promise.all([
    fetch(API + '/menu').then(function(r) { return r.json(); }),
    fetch(API + '/config/mandatory-assignments').then(function(r) { return r.ok ? r.json() : []; }).catch(function() { return []; }),
    fetch(API + '/config/universal-assignments').then(function(r) { return r.ok ? r.json() : []; }).catch(function() { return []; }),

/* WITH:
──────────────────────────────────────────────────────────────────── */

function fetchMenuFromAPI() {
  return Promise.all([
    fetch(API + '/menu').then(function(r) { return r.json(); }),

/* AND further down, the `.then(function(results) {` block:

    MANDATORY_ASSIGNMENTS = results[1] || [];
    UNIVERSAL_ASSIGNMENTS = results[2] || [];

Changes to a single-argument callback and drops those two lines since
we no longer use them:

    }).then(function(menu) {
      if (!menu.categories || !menu.items) return;
      // ... rest of the block unchanged, just no results[1]/[2] lines

The global declarations at the top of the file:

    var MANDATORY_ASSIGNMENTS = [];
    var UNIVERSAL_ASSIGNMENTS = [];

Can stay or be deleted — nothing reads them anymore. Leaving them in
is harmless; removing them is tidier.

This optional edit is defer-able. The 404s are silent and the code path
above works either way.
──────────────────────────────────────────────────────────────────── */
