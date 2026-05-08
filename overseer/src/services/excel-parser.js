/* ============================================
   KINDpos Overseer — Excel Parser Service
   v3 — KINDpos_Menu_Template_v3.xlsx structure

   Reads the new template (rows 1-2 = title + instruction,
   row 3 = column headers, row 4+ = data) and emits twelve
   typed collections covering the full pricing chain:

     sizes / options / option_groups / modifiers /
     micromod_groups / mod_groups{mandatory,optional} /
     categories / items / restaurant_info / tax_rules /
     discounts.

   STORE INFO is the only sheet without column headers —
   raw col-A / col-B key/value pairs.
   MOD GROUPS uses ▶ section markers in col-A to split
   mandatory from optional. ⚠ ends the readable region.
   ============================================ */

/**
 * Parse a KINDpos menu template Excel file (v3).
 *
 * @param {File} file  The Excel file from <input type="file">
 * @returns {Promise<{success: boolean, data: object, errors: string[], warnings: string[]}>}
 */
export async function parseMenuTemplate(file) {
    const errors   = [];
    const warnings = [];
    const data     = {};

    try {
        const buffer   = await file.arrayBuffer();
        const workbook = XLSX.read(buffer, { type: 'array' });

        data.restaurant_info = _parseStoreInfo(workbook, errors);
        data.tax_rules       = _parseTaxRules(workbook, warnings);
        data.sizes           = _parseSizes(workbook, errors);
        data.options         = _parseOptions(workbook, errors);
        data.option_groups   = _parseOptionGroups(workbook, errors, warnings);
        data.modifiers       = _parseModifiers(workbook, errors);
        data.micromod_groups = _parseMicromodGroups(workbook, warnings);
        data.mod_groups      = _parseModGroups(workbook, errors, warnings);
        data.categories      = _parseCategories(workbook, errors);
        data.items           = _parseItems(workbook, errors, warnings);
        data.discounts       = _parseDiscounts(workbook, warnings);

        const success = errors.length === 0;
        return { success, data, errors, warnings };

    } catch (e) {
        errors.push(`Failed to read file: ${e.message}`);
        return { success: false, data: {}, errors, warnings };
    }
}


/* ─────────────────────────────────────────────────────────────────────────────
   PUBLIC HELPERS
───────────────────────────────────────────────────────────────────────────── */

/** True for anything that isn't empty / null / undefined. */
const hasValue = (v) => v !== undefined && v !== null && String(v).trim() !== '';

/** Safe string coercion. */
const str = (v) => hasValue(v) ? String(v).trim() : '';

/** Strip asterisks, question marks, newlines, parentheses + collapse whitespace. */
export function norm(v) {
    return str(v).replace(/[*?()\n\r]/g, ' ').replace(/\s+/g, ' ').trim().toLowerCase();
}

/** Find a value in a row object using normalised key matching. */
const get = (row, expected, fallback = undefined) => {
    if (!row) return fallback;
    const target = norm(expected);
    for (const key of Object.keys(row)) {
        if (norm(key) === target) return row[key];
    }
    for (const key of Object.keys(row)) {
        if (norm(key).startsWith(target)) return row[key];
    }
    return fallback;
};

/** Parse a price like "$1.50" or "1.50" into a float. */
export function parsePrice(v) {
    if (!hasValue(v)) return 0.0;
    return parseFloat(String(v).replace(/[^0-9.\-]/g, '')) || 0.0;
}

/** Parse a price as a 2dp decimal STRING (e.g. "0.00", "1.50"). */
const parseDecimalString = (v) => {
    if (!hasValue(v)) return '0.00';
    const n = parseFloat(String(v).replace(/[^0-9.\-]/g, ''));
    if (isNaN(n)) return '0.00';
    return n.toFixed(2);
};

/** Split a comma-separated string into a trimmed array, dropping blanks. */
export function splitList(v) {
    if (!hasValue(v)) return [];
    return String(v).split(',').map(s => s.trim()).filter(Boolean);
}

/** Y/N → bool. */
const parseYN = (v, defaultVal = true) => {
    if (!hasValue(v)) return defaultVal;
    return String(v).trim().toUpperCase().startsWith('Y');
};

/** Slugify a name into a stable id (a-z0-9 underscored). */
const slugify = (name) => {
    return String(name || '').toLowerCase()
        .replace(/[^a-z0-9]+/g, '_')
        .replace(/_+$/, '')
        .replace(/^_+/, '');
};

/** Header rows: blank, instructions, or arrow markers. */
const _isHeaderRow = (firstCell) => {
    const s = str(firstCell).toLowerCase();
    return (
        !s ||
        s.startsWith('part 1') ||
        s.startsWith('part 2') ||
        s.includes('these are example') ||
        s.startsWith('notes:') ||
        s.startsWith('↑')
    );
};

/**
 * Parse a "key|subkey:value, key|subkey:value" string into a nested map.
 *   "Pizza Size|Small:0.00, Pizza Size|Large:0.50"
 *     → {"Pizza Size": {"Small": "0.00", "Large": "0.50"}}
 *
 * Values are returned as decimal strings so callers can preserve precision.
 */
const parseTwoLevelMap = (raw) => {
    const out = {};
    if (!hasValue(raw)) return out;
    const parts = String(raw).split(',').map(s => s.trim()).filter(Boolean);
    for (const p of parts) {
        const colonIdx = p.lastIndexOf(':');
        if (colonIdx < 0) continue;
        const left  = p.slice(0, colonIdx).trim();
        const value = p.slice(colonIdx + 1).trim();
        const pipeIdx = left.indexOf('|');
        if (pipeIdx < 0) continue;
        const outerKey = left.slice(0, pipeIdx).trim();
        const innerKey = left.slice(pipeIdx + 1).trim();
        if (!outerKey || !innerKey) continue;
        if (!out[outerKey]) out[outerKey] = {};
        out[outerKey][innerKey] = parseDecimalString(value);
    }
    return out;
};

/**
 * Parse a flat "key:value, key:value" string into a single-level map.
 * Used for option_group_overrides and size_price_adjustments.
 *
 *   "Toppings:Simple Qty, Sauces:Side Options"
 *     → {"Toppings": "Simple Qty", "Sauces": "Side Options"}
 *   "Small:0.00, Medium:0.25"
 *     → {"Small": "0.00", "Medium": "0.25"}
 *
 * The caller decides whether values are decimal strings or arbitrary
 * names — `decimalValues=true` runs each value through parseDecimalString.
 */
const parseOneLevelMap = (raw, decimalValues = false) => {
    const out = {};
    if (!hasValue(raw)) return out;
    const parts = String(raw).split(',').map(s => s.trim()).filter(Boolean);
    for (const p of parts) {
        const colonIdx = p.lastIndexOf(':');
        if (colonIdx < 0) continue;
        const k = p.slice(0, colonIdx).trim();
        const v = p.slice(colonIdx + 1).trim();
        if (!k) continue;
        out[k] = decimalValues ? parseDecimalString(v) : v;
    }
    return out;
};

/* ─────────────────────────────────────────────────────────────────────────────
   STORE INFO  (no column headers — raw col-A / col-B pairs)
───────────────────────────────────────────────────────────────────────────── */
const _parseStoreInfo = (workbook, errors) => {
    const sheetName = workbook.Sheets['STORE INFO'] ? 'STORE INFO' :
                      (workbook.Sheets['RESTAURANT INFO'] ? 'RESTAURANT INFO' : null);
    if (!sheetName) {
        errors.push('Missing sheet: STORE INFO');
        return {};
    }

    const rows = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { header: 1, defval: '' });
    const info = {};
    for (const row of rows) {
        const label = str(row[0]);
        const value = str(row[1]);
        if (!label) continue;
        // Skip title / instruction lines (no col-B value, or label looks like a banner).
        if (!value) continue;
        if (label.toLowerCase().includes('your restaurant')) continue;
        if (label.toLowerCase().startsWith('fill in')) continue;
        const key = label.replace(/\*/g, '').trim();
        info[key] = value;
    }
    return info;
};

/* ─────────────────────────────────────────────────────────────────────────────
   TAX RULES — own sheet in v3
───────────────────────────────────────────────────────────────────────────── */
const _parseTaxRules = (workbook, warnings) => {
    const sheet = workbook.Sheets['TAX RULES'];
    if (!sheet) {
        warnings.push('No TAX RULES sheet — using empty list');
        return [];
    }
    const rows = XLSX.utils.sheet_to_json(sheet, { range: 2, defval: '' });
    const out  = [];
    for (const row of rows) {
        const name = str(get(row, 'Tax Rule Name')) || str(get(row, 'Name'));
        if (!name || _isHeaderRow(name)) continue;
        const rate = parseFloat(String(get(row, 'Rate', '0')).replace(/[^0-9.\-]/g, '')) || 0;
        out.push({
            name,
            rate,
            dine_in:  parseYN(get(row, 'Dine-In',  'Y')),
            takeout:  parseYN(get(row, 'Takeout',  'Y')),
            delivery: parseYN(get(row, 'Delivery', 'Y')),
        });
    }
    return out;
};

/* ─────────────────────────────────────────────────────────────────────────────
   SIZES
───────────────────────────────────────────────────────────────────────────── */
const _parseSizes = (workbook, errors) => {
    const sheet = workbook.Sheets['SIZES'];
    if (!sheet) return [];   // Sizes are optional — operators may not use them
    const rows  = XLSX.utils.sheet_to_json(sheet, { range: 2, defval: '' });
    const out   = [];
    for (const row of rows) {
        const name = str(get(row, 'Size Name')) || str(get(row, 'Name'));
        if (!name || _isHeaderRow(name)) continue;
        out.push({
            size_id:          slugify(name),
            name,
            price_adjustment: parseDecimalString(get(row, 'Price Adjustment', '0')),
            active:           parseYN(get(row, 'Active', 'Y')),
        });
    }
    return out;
};

/* ─────────────────────────────────────────────────────────────────────────────
   OPTIONS
───────────────────────────────────────────────────────────────────────────── */
const _parseOptions = (workbook, errors) => {
    const sheet = workbook.Sheets['OPTIONS'];
    if (!sheet) return [];
    const rows  = XLSX.utils.sheet_to_json(sheet, { range: 2, defval: '' });
    const out   = [];
    for (const row of rows) {
        const name = str(get(row, 'Option Name')) || str(get(row, 'Name'));
        if (!name || _isHeaderRow(name)) continue;
        out.push({
            option_id:        slugify(name),
            name,
            price_adjustment: parseDecimalString(get(row, 'Price Adjustment', '0')),
            negates_price:    parseYN(get(row, 'Negates Price', 'N'), false),
            active:           parseYN(get(row, 'Active', 'Y')),
        });
    }
    return out;
};

/* ─────────────────────────────────────────────────────────────────────────────
   OPTION GROUPS
───────────────────────────────────────────────────────────────────────────── */
const _parseOptionGroups = (workbook, errors, warnings) => {
    const sheet = workbook.Sheets['OPTION GROUPS'];
    if (!sheet) return [];
    const rows  = XLSX.utils.sheet_to_json(sheet, { range: 2, defval: '' });
    const out   = [];
    for (const row of rows) {
        const name = str(get(row, 'Group Name')) || str(get(row, 'Option Group Name')) || str(get(row, 'Name'));
        if (!name || _isHeaderRow(name)) continue;
        out.push({
            option_group_id: slugify(name),
            name,
            option_names:    splitList(get(row, 'Options', '')),
            active:          parseYN(get(row, 'Active', 'Y')),
        });
    }
    return out;
};

/* ─────────────────────────────────────────────────────────────────────────────
   MODIFIERS  (with "Price By Size" column)
───────────────────────────────────────────────────────────────────────────── */
const _parseModifiers = (workbook, errors) => {
    const sheet = workbook.Sheets['MODIFIERS'];
    if (!sheet) return [];
    const rows  = XLSX.utils.sheet_to_json(sheet, { range: 2, defval: '' });
    const out   = [];
    for (const row of rows) {
        const name = str(get(row, 'Modifier Name')) || str(get(row, 'Name'));
        if (!name || _isHeaderRow(name)) continue;
        out.push({
            modifier_id:    slugify(name),
            name,
            price:          parseDecimalString(get(row, 'Price', '0')),
            price_by_size:  parseTwoLevelMap(get(row, 'Price By Size', '')),
            active:         parseYN(get(row, 'Active', 'Y')),
        });
    }
    return out;
};

/* ─────────────────────────────────────────────────────────────────────────────
   MICROMOD GROUPS  ("MicroMods" + "Attaches To" comma-split)
───────────────────────────────────────────────────────────────────────────── */
const _parseMicromodGroups = (workbook, warnings) => {
    const sheet = workbook.Sheets['MICROMOD GROUPS'];
    if (!sheet) return [];
    const rows  = XLSX.utils.sheet_to_json(sheet, { range: 2, defval: '' });
    const out   = [];
    for (const row of rows) {
        const name = str(get(row, 'Group Name')) || str(get(row, 'MicroMod Group')) || str(get(row, 'Name'));
        if (!name || _isHeaderRow(name)) continue;
        out.push({
            group_name:      name,
            micromod_names:  splitList(get(row, 'MicroMods', '')),
            attaches_to:     splitList(get(row, 'Attaches To', '')),
            active:          parseYN(get(row, 'Active', 'Y')),
        });
    }
    return out;
};

/* ─────────────────────────────────────────────────────────────────────────────
   MOD GROUPS  (split mandatory / optional via ▶ section markers in col-A)
───────────────────────────────────────────────────────────────────────────── */
const _parseModGroups = (workbook, errors, warnings) => {
    const result = { mandatory: [], optional: [] };
    const sheet = workbook.Sheets['MOD GROUPS'];
    if (!sheet) {
        warnings.push('No MOD GROUPS sheet — skipping modifier groups');
        return result;
    }

    // Read raw arrays — we need col-A inspection for ▶ / ⚠ markers.
    const rawRows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });
    if (rawRows.length === 0) return result;

    // Column headers live on row 3 (index 2). Use them for indexed lookup.
    const headers = (rawRows[2] || []).map(h => norm(h));
    const colIdx = (label) => {
        const target = norm(label);
        for (let i = 0; i < headers.length; i++) {
            if (headers[i] === target) return i;
        }
        for (let i = 0; i < headers.length; i++) {
            if (headers[i].startsWith(target)) return i;
        }
        return -1;
    };

    const idxName    = colIdx('Group Name');
    const idxMods    = colIdx('Modifiers');
    const idxMin     = colIdx('Min Picks');
    const idxMax     = colIdx('Max Picks');
    const idxDrives  = colIdx('Drives Pricing');
    const idxDefaultOG = colIdx('Default Option Group');
    const idxSizeAdj = colIdx('Size Price Adjustments');
    const idxActive  = colIdx('Active');

    let mode = null;  // 'mandatory' | 'optional' | null (skip)
    for (let i = 3; i < rawRows.length; i++) {
        const row = rawRows[i] || [];
        const colA = str(row[0]);

        // Section markers: switch mode. Stop on ⚠.
        if (colA.startsWith('▶')) {
            const upper = colA.toUpperCase();
            if (upper.includes('MANDATORY')) { mode = 'mandatory'; continue; }
            if (upper.includes('OPTIONAL'))  { mode = 'optional';  continue; }
            mode = null;
            continue;
        }
        if (colA.startsWith('⚠')) break;

        if (!mode) continue;
        if (_isHeaderRow(colA)) continue;

        // First column is Group Name. Skip anything that doesn't have a name.
        const name = idxName >= 0 ? str(row[idxName]) : str(row[0]);
        if (!name) continue;

        const entry = {
            group_id: slugify(name),
            name,
            modifiers: idxMods   >= 0 ? splitList(row[idxMods])     : [],
            min:       idxMin    >= 0 ? (parseInt(str(row[idxMin]), 10) || 0) : 0,
            max:       idxMax    >= 0 ? (parseInt(str(row[idxMax]), 10) || 1) : 1,
            active:    idxActive >= 0 ? parseYN(row[idxActive], true) : true,
        };

        if (mode === 'mandatory') {
            entry.drives_pricing = idxDrives >= 0 ? parseYN(row[idxDrives], false) : false;
            result.mandatory.push(entry);
        } else {
            entry.default_option_group_name = idxDefaultOG >= 0 ? str(row[idxDefaultOG]) : '';
            entry.size_price_adjustments = idxSizeAdj >= 0
                ? parseOneLevelMap(row[idxSizeAdj], true)
                : {};
            result.optional.push(entry);
        }
    }
    return result;
};

/* ─────────────────────────────────────────────────────────────────────────────
   CATEGORIES
───────────────────────────────────────────────────────────────────────────── */
const _parseCategories = (workbook, errors) => {
    const sheet = workbook.Sheets['CATEGORIES'];
    if (!sheet) {
        errors.push('Missing sheet: CATEGORIES');
        return [];
    }
    const rows = XLSX.utils.sheet_to_json(sheet, { range: 2, defval: '' });
    const out  = [];
    for (const row of rows) {
        const name = str(get(row, 'Category Name')) || str(get(row, 'Name'));
        if (!name || _isHeaderRow(name)) continue;
        out.push({
            name,
            display_order:    parseInt(str(get(row, 'Display Order', '999')), 10) || 999,
            color:            str(get(row, 'Color', '')) || str(get(row, 'Color Code', '')),
            tax_rule:         str(get(row, 'Tax Rule', '')),
            optional_groups:  splitList(get(row, 'Optional Groups', '')),
            enable_placement: parseYN(get(row, 'Enable Placement', 'N'), false),
            active:           parseYN(get(row, 'Active', 'Y')),
        });
    }
    if (out.length === 0) {
        errors.push('No categories defined — at least one category is required');
    }
    return out.sort((a, b) => a.display_order - b.display_order);
};

/* ─────────────────────────────────────────────────────────────────────────────
   ITEMS
───────────────────────────────────────────────────────────────────────────── */
const _parseItems = (workbook, errors, warnings) => {
    const sheet = workbook.Sheets['ITEMS'];
    if (!sheet) {
        errors.push('Missing sheet: ITEMS');
        return [];
    }
    const rows = XLSX.utils.sheet_to_json(sheet, { range: 2, defval: '' });
    const out  = [];
    for (const row of rows) {
        const name = str(get(row, 'Item Name')) || str(get(row, 'Name'));
        if (!name || _isHeaderRow(name)) continue;

        out.push({
            name,
            category:               str(get(row, 'Category', '')),
            price:                  parseDecimalString(get(row, 'Price', '0')),
            description:            str(get(row, 'Description', '')),
            included_mods:          splitList(get(row, 'Included Mods', '')),
            mandatory_groups:       splitList(get(row, 'Mandatory Groups', '')),
            option_group_overrides: parseOneLevelMap(get(row, 'Options Group Overrides', ''), false),
            price_by_size:          parseTwoLevelMap(get(row, 'Price By Size', '')),
            size_price_overrides:   parseTwoLevelMap(get(row, 'Size Price Overrides', '')),
            tax_rule:               str(get(row, 'Tax Rule', '')),
            sku:                    str(get(row, 'SKU', '')),
            active:                 parseYN(get(row, 'Active', 'Y')),
            prep_time:              parseInt(str(get(row, 'Prep Time', '0')), 10) || 0,
            allergens:              splitList(get(row, 'Allergens', '')),
            notes:                  str(get(row, 'Notes', '')),
        });
    }
    if (out.length === 0) warnings.push('No menu items defined');
    return out;
};

/* ─────────────────────────────────────────────────────────────────────────────
   DISCOUNTS
───────────────────────────────────────────────────────────────────────────── */
const _parseDiscounts = (workbook, warnings) => {
    const sheet = workbook.Sheets['DISCOUNTS'];
    if (!sheet) return [];
    const rows = XLSX.utils.sheet_to_json(sheet, { range: 2, defval: '' });
    const out  = [];
    for (const row of rows) {
        const name = str(get(row, 'Discount Name')) || str(get(row, 'Name'));
        if (!name || _isHeaderRow(name)) continue;
        out.push({
            name,
            type:              str(get(row, 'Type', '%')),
            amount:            parsePrice(get(row, 'Amount', '0')),
            schedule:          str(get(row, 'Schedule', 'Always')),
            applies_to:        str(get(row, 'Applies To', 'Entire Check')),
            restrictions:      str(get(row, 'Restrictions', '')),
            requires_approval: parseYN(get(row, 'Requires Approval', 'N'), false),
            reason_code:       str(get(row, 'Reason Code', '')),
            active:            parseYN(get(row, 'Active', 'Y')),
        });
    }
    return out;
};


/* ─────────────────────────────────────────────────────────────────────────────
   SUMMARY
───────────────────────────────────────────────────────────────────────────── */

/**
 * Get a human-readable summary of parsed data.
 *
 * @param {object} data  The data object returned by parseMenuTemplate
 * @returns {object}
 */
export function getSummary(data) {
    const info     = data.restaurant_info || {};
    const nameKey  = Object.keys(info).find(k => norm(k) === 'restaurant name') || '';
    const modGrps  = data.mod_groups || { mandatory: [], optional: [] };

    return {
        restaurant_name:        nameKey ? info[nameKey] : 'Unknown',
        tax_rate:               ((data.tax_rules || [])[0] || {}).rate ?? 0,
        sizes_count:            (data.sizes           || []).length,
        options_count:          (data.options         || []).length,
        option_groups_count:    (data.option_groups   || []).length,
        modifiers_count:        (data.modifiers       || []).length,
        micromod_groups_count:  (data.micromod_groups || []).length,
        mandatory_groups_count: (modGrps.mandatory    || []).length,
        optional_groups_count:  (modGrps.optional     || []).length,
        categories_count:       (data.categories      || []).length,
        items_count:            (data.items           || []).length,
        tax_rules_count:        (data.tax_rules       || []).length,
        discounts_count:        (data.discounts       || []).length,
    };
}
