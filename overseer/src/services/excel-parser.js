/* ============================================
   KINDpos Overseer — Excel Parser Service
   v2 — matches KINDpos menu import template v2

   Sheet changes from v1:
     RESTAURANT INFO  — no column headers; raw col-A/col-B pairs
     CATEGORIES       — column names updated, tax_category removed
     OPTION GROUPS    — replaces MODIFIERS; two-part structure
                        (Part 1: individual choices, Part 2: groups)
     ITEMS            — required_choices + add_ons replace modifier_groups
     COMBO SPECIALS   — new sheet
     PORTION OPTIONS  — new sheet
     STAFF            — new sheet
     DISCOUNTS        — column names updated
     TAX RULES        — no longer a sheet; derived from RESTAURANT INFO

   Output shape is backwards-compatible where possible so event
   generation works with either v1 or v2 parsed data.
   ============================================ */

/**
 * Parse a KINDpos menu template Excel file (v2).
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

        data.restaurant_info = _parseRestaurantInfo(workbook, errors);
        data.tax_rules       = _deriveTaxRules(data.restaurant_info, warnings);
        data.categories      = _parseCategories(workbook, errors);
        data.option_groups   = _parseOptionGroups(workbook, errors, warnings);
        data.items           = _parseItems(workbook, errors, warnings);
        data.combo_specials  = _parseComboSpecials(workbook, warnings);
        data.portion_options = _parsePortionOptions(workbook, warnings);
        data.staff           = _parseStaff(workbook, errors, warnings);
        data.discounts       = _parseDiscounts(workbook, warnings);

        // Legacy compat — keep data.modifiers so any callers that read it get
        // an empty shell rather than a crash.
        data.modifiers = {
            master_list:          [],
            option_templates:     [],
            groups:               [],
            category_assignments: [],
        };

        const success = errors.length === 0;
        return { success, data, errors, warnings };

    } catch (e) {
        errors.push(`Failed to read file: ${e.message}`);
        return { success: false, data: {}, errors, warnings };
    }
}


/* ─────────────────────────────────────────────────────────────────────────────
   HELPERS
───────────────────────────────────────────────────────────────────────────── */

/** True for anything that isn't empty / null / undefined. */
function hasValue(v) {
    return v !== undefined && v !== null && String(v).trim() !== '';
}

/** Safe string coercion. */
function str(v) {
    return hasValue(v) ? String(v).trim() : '';
}

/** Strip asterisks, question marks, newlines, and extra whitespace.
 *  Used to normalise column header keys before comparison. */
export function norm(v) {
    return str(v).replace(/[*?()\n\r]/g, ' ').replace(/\s+/g, ' ').trim().toLowerCase();
}

/**
 * Find a value in a SheetJS JSON row object using normalised key matching.
 * Handles headers like "Item Name *", "Active? (Y/N)", "Price *\n($0.00 if free)" etc.
 *
 * @param {object} row         Row object from sheet_to_json
 * @param {string} expected    The key you're looking for (plain English, no decorators)
 * @param {*}      fallback    Returned when the key isn't found
 */
function get(row, expected, fallback = undefined) {
    const target = norm(expected);
    for (const key of Object.keys(row)) {
        if (norm(key) === target) return row[key];
    }
    // Partial match — key starts with the target string
    for (const key of Object.keys(row)) {
        if (norm(key).startsWith(target)) return row[key];
    }
    return fallback;
}

/** Parse a price string like "$1.50" or "1.50" into a float. */
export function parsePrice(v) {
    if (!hasValue(v)) return 0.0;
    return parseFloat(String(v).replace(/[^0-9.\-]/g, '')) || 0.0;
}

/** Split a comma-separated string into a trimmed array, dropping blanks. */
export function splitList(v) {
    if (!hasValue(v)) return [];
    return String(v).split(',').map(s => s.trim()).filter(Boolean);
}

/** True if the row looks like a section-header or instruction row (not real data). */
function _isHeaderRow(firstCell) {
    const s = str(firstCell).toLowerCase();
    return (
        s.startsWith('part 1') ||
        s.startsWith('part 2') ||
        s.includes('these are example') ||
        s.includes('notes:') ||
        s.startsWith('↑') ||
        s.length === 0
    );
}


/* ─────────────────────────────────────────────────────────────────────────────
   RESTAURANT INFO
   No column headers in v2 — raw col-A / col-B key-value pairs.
   Rows 1-3 are the title banner and note; data starts at row 4.
───────────────────────────────────────────────────────────────────────────── */
function _parseRestaurantInfo(workbook, errors) {
    try {
        const sheet = workbook.Sheets['RESTAURANT INFO'];
        if (!sheet) {
            errors.push('Missing sheet: RESTAURANT INFO');
            return {};
        }

        // Read as raw arrays (header:1 = no auto-header row)
        const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });
        const info = {};

        for (const row of rows) {
            const label = str(row[0]);
            const value = str(row[1]);

            // Skip title/note rows and empty rows
            if (!label || !value) continue;
            if (label.toLowerCase().includes('your restaurant')) continue;
            if (label.toLowerCase().startsWith('fill in')) continue;

            // Clean label: strip *, trailing whitespace
            const key = label.replace(/\*/g, '').trim();
            // Skip if the value still looks like the example placeholder (italic gray)
            // — we can't detect formatting from JS, so just store it; the caller can
            // validate specific fields.
            info[key] = value;
        }

        // Validate required fields
        const required = ['Restaurant Name', 'Address', 'City', 'State', 'ZIP Code'];
        for (const field of required) {
            const found = Object.keys(info).some(k => norm(k) === norm(field));
            if (!found) errors.push(`Missing required field: ${field}`);
        }

        return info;

    } catch (e) {
        errors.push(`Error parsing Restaurant Info: ${e.message}`);
        return {};
    }
}


/* ─────────────────────────────────────────────────────────────────────────────
   TAX RULES  (derived from RESTAURANT INFO — no separate sheet in v2)
───────────────────────────────────────────────────────────────────────────── */
function _deriveTaxRules(info, warnings) {
    // Find the tax rate field (stored as "Sales Tax Rate  (%)" after cleaning)
    const rateKey = Object.keys(info).find(k => norm(k).includes('sales tax rate'));
    const rate    = rateKey ? parseFloat(info[rateKey]) || 0.0 : 0.0;

    if (rate === 0.0) {
        warnings.push('Sales Tax Rate is 0% or not set — verify in RESTAURANT INFO');
    }

    return [{
        name:       'Sales Tax',
        type:       'Sales Tax',
        rate:       rate,
        applies_to: 'All Taxable Items',
        dine_in:    true,
        takeout:    true,
        delivery:   true,
        notes:      '',
    }];
}


/* ─────────────────────────────────────────────────────────────────────────────
   CATEGORIES
───────────────────────────────────────────────────────────────────────────── */
function _parseCategories(workbook, errors) {
    try {
        const sheet = workbook.Sheets['CATEGORIES'];
        if (!sheet) {
            errors.push('Missing sheet: CATEGORIES');
            return [];
        }

        const rows       = XLSX.utils.sheet_to_json(sheet, { range: 2, defval: '' });
        const categories = [];

        for (const row of rows) {
            const name = str(get(row, 'Category Name'));
            if (!name || _isHeaderRow(name)) continue;

            categories.push({
                name:          name,
                display_order: parseInt(str(get(row, 'Display Order', '999')), 10) || 999,
                color:         str(get(row, 'Color Code', '#CCCCCC')) || '#CCCCCC',
                description:   str(get(row, 'Description', '')),
                active:        str(get(row, 'Active', 'Y')).toUpperCase().startsWith('Y'),
                // v1 compat — tax_category no longer in the template
                tax_category:  null,
            });
        }

        if (categories.length === 0) {
            errors.push('No categories defined — at least one category is required');
        }

        categories.sort((a, b) => a.display_order - b.display_order);
        return categories;

    } catch (e) {
        errors.push(`Error parsing Categories: ${e.message}`);
        return [];
    }
}


/* ─────────────────────────────────────────────────────────────────────────────
   OPTION GROUPS  (replaces MODIFIERS)
   Single sheet with two sections separated by section-header rows.

   Part 1 — individual choices
     columns: Choice Name *, Extra Cost *, Changes Price? (Y/N),
              Special Prep Options?, Must Also Pick?, Notes, Active? (Y/N)

   Part 2 — groups that reference Part 1 choices
     columns: Group Name *, Required or Optional? *, Min Picks, Max Picks,
              Choices in This Group *, Which Items Use This?, Notes

   Returns:
     {
       choices: [{ name, price, changes_price, prep_options, must_also_pick, notes, active }],
       groups:  [{ name, type, min, max, choices[], items[], notes }]
     }
───────────────────────────────────────────────────────────────────────────── */
function _parseOptionGroups(workbook, errors, warnings) {
    const result = { choices: [], groups: [] };

    try {
        const sheet = workbook.Sheets['OPTION GROUPS'];
        if (!sheet) {
            warnings.push('No OPTION GROUPS sheet found — skipping');
            return result;
        }

        // Read as raw arrays so we can detect section-header rows by text
        const rawRows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });

        // ── Locate section boundaries ────────────────────────────────────────
        let part1HeaderIdx  = -1;  // row index of "PART 1 — LIST ALL YOUR..."
        let part1ColIdx     = -1;  // row index of the column header row after Part 1
        let part2HeaderIdx  = -1;  // row index of "PART 2 — CREATE YOUR GROUPS..."
        let part2ColIdx     = -1;  // row index of the column header row after Part 2

        for (let i = 0; i < rawRows.length; i++) {
            const cell = norm(str(rawRows[i][0]));
            if (cell.startsWith('part 1') && part1HeaderIdx === -1) {
                part1HeaderIdx = i;
                // Column headers are on the next non-empty row
                for (let j = i + 1; j < rawRows.length; j++) {
                    if (str(rawRows[j][0])) { part1ColIdx = j; break; }
                }
            }
            if (cell.startsWith('part 2') && part2HeaderIdx === -1) {
                part2HeaderIdx = i;
                for (let j = i + 1; j < rawRows.length; j++) {
                    if (str(rawRows[j][0])) { part2ColIdx = j; break; }
                }
            }
        }

        // ── Helper: build a header-keyed object from a raw row ───────────────
        function toObj(headers, row) {
            const obj = {};
            headers.forEach((h, idx) => { obj[str(h)] = row[idx] ?? ''; });
            return obj;
        }

        // ── Parse Part 1: choices ────────────────────────────────────────────
        if (part1ColIdx !== -1) {
            const headers   = rawRows[part1ColIdx];
            const dataStart = part1ColIdx + 1;
            const dataEnd   = part2HeaderIdx !== -1 ? part2HeaderIdx : rawRows.length;

            for (let i = dataStart; i < dataEnd; i++) {
                const row  = rawRows[i];
                const obj  = toObj(headers, row);
                const name = str(get(obj, 'Choice Name'));
                if (!name || _isHeaderRow(name)) continue;

                result.choices.push({
                    name:           name,
                    price:          parsePrice(get(obj, 'Extra Cost', '0')),
                    changes_price:  str(get(obj, 'Changes Price', 'N')).toUpperCase().startsWith('Y'),
                    prep_options:   splitList(get(obj, 'Special Prep Options', '')),
                    must_also_pick: _parseMustAlsoPick(str(get(obj, 'Must Also Pick', ''))),
                    notes:          str(get(obj, 'Notes', '')),
                    active:         str(get(obj, 'Active', 'Y')).toUpperCase().startsWith('Y'),
                });
            }
        } else {
            warnings.push('OPTION GROUPS: Could not locate Part 1 section');
        }

        // ── Parse Part 2: groups ─────────────────────────────────────────────
        if (part2ColIdx !== -1) {
            const headers   = rawRows[part2ColIdx];
            const dataStart = part2ColIdx + 1;

            for (let i = dataStart; i < rawRows.length; i++) {
                const row  = rawRows[i];
                const obj  = toObj(headers, row);
                const name = str(get(obj, 'Group Name'));
                if (!name || _isHeaderRow(name)) continue;

                const typeRaw = str(get(obj, 'Required or Optional', 'Optional')).toLowerCase();

                result.groups.push({
                    name:     name,
                    type:     typeRaw.startsWith('req') ? 'mandatory' : 'optional',
                    min:      parseInt(str(get(obj, 'Min Picks', '0')), 10) || 0,
                    max:      parseInt(str(get(obj, 'Max Picks', '1')), 10) || 1,
                    choices:  splitList(get(obj, 'Choices in This Group', '')),
                    items:    splitList(get(obj, 'Which Items Use This', '')),
                    notes:    str(get(obj, 'Notes', '')),
                });
            }
        } else {
            warnings.push('OPTION GROUPS: Could not locate Part 2 section');
        }

        if (result.choices.length === 0 && result.groups.length === 0) {
            warnings.push('No option groups or choices defined');
        }

        return result;

    } catch (e) {
        errors.push(`Error parsing Option Groups: ${e.message}`);
        return result;
    }
}

/**
 * Parse the "Must Also Pick" cell value into a structured array.
 * Input format: '8" GF ($0.00), 10" GF ($2.00)'
 * Output: [{ name: '8" GF', price: 0.0 }, { name: '10" GF', price: 2.0 }]
 */
export function _parseMustAlsoPick(raw) {
    if (!raw) return [];
    // Split on commas that are NOT inside parentheses
    const parts = raw.match(/[^,]+(?:\([^)]*\))?/g) || [];
    return parts.map(part => {
        const m = part.trim().match(/^(.+?)\s*\(\$?([\d.]+)\)\s*$/);
        if (m) return { name: m[1].trim(), price: parseFloat(m[2]) || 0.0 };
        return { name: part.trim(), price: 0.0 };
    }).filter(x => x.name);
}


/* ─────────────────────────────────────────────────────────────────────────────
   ITEMS
───────────────────────────────────────────────────────────────────────────── */
function _parseItems(workbook, errors, warnings) {
    try {
        const sheet = workbook.Sheets['ITEMS'];
        if (!sheet) {
            errors.push('Missing sheet: ITEMS');
            return [];
        }

        const rows  = XLSX.utils.sheet_to_json(sheet, { range: 2, defval: '' });
        const items = [];

        for (const row of rows) {
            const name = str(get(row, 'Item Name'));
            if (!name || _isHeaderRow(name)) continue;

            const priceRaw = get(row, 'Price', '0');

            items.push({
                name:             name,
                category:         str(get(row, 'Category', '')),
                price:            parsePrice(priceRaw),
                description:      str(get(row, 'Description', '')),
                required_choices: splitList(get(row, 'Required Choices', '')),
                add_ons:          splitList(get(row, 'Add-Ons', '')),
                active:           str(get(row, 'Active', 'Y')).toUpperCase().startsWith('Y'),
                notes:            str(get(row, 'Notes', '')),
                // v1 compat
                modifier_groups:  str(get(row, 'Modifier Groups', '')),
            });
        }

        if (items.length === 0) {
            warnings.push('No menu items defined');
        }

        return items;

    } catch (e) {
        errors.push(`Error parsing Items: ${e.message}`);
        return [];
    }
}


/* ─────────────────────────────────────────────────────────────────────────────
   COMBO SPECIALS  (new in v2)
   Named toppings that include a set of ingredients (microMOD groups).
───────────────────────────────────────────────────────────────────────────── */
function _parseComboSpecials(workbook, warnings) {
    try {
        const sheet = workbook.Sheets['COMBO SPECIALS'];
        if (!sheet) {
            warnings.push('No COMBO SPECIALS sheet — skipping');
            return [];
        }

        const rows   = XLSX.utils.sheet_to_json(sheet, { range: 2, defval: '' });
        const combos = [];

        for (const row of rows) {
            const name = str(get(row, 'Combo Name'));
            if (!name || _isHeaderRow(name)) continue;

            combos.push({
                name:        name,
                price:       parsePrice(get(row, 'Price', '0')),
                comes_with:  splitList(get(row, 'Comes With', '')),
                group:       str(get(row, 'Goes In Which Group', 'Toppings')),
                active:      str(get(row, 'Active', 'Y')).toUpperCase().startsWith('Y'),
                notes:       str(get(row, 'Notes', '')),
            });
        }

        return combos;

    } catch (e) {
        warnings.push(`Error parsing Combo Specials: ${e.message}`);
        return [];
    }
}


/* ─────────────────────────────────────────────────────────────────────────────
   PORTION OPTIONS  (new in v2)
   Universal microMOD group — Extra / Light / On Side on any topping.
───────────────────────────────────────────────────────────────────────────── */
function _parsePortionOptions(workbook, warnings) {
    try {
        const sheet = workbook.Sheets['PORTION OPTIONS'];
        if (!sheet) {
            // Optional — not every restaurant uses portion modifiers
            return [];
        }

        const rows    = XLSX.utils.sheet_to_json(sheet, { range: 2, defval: '' });
        const options = [];

        for (const row of rows) {
            const name = str(get(row, 'Option Name'));
            if (!name || _isHeaderRow(name)) continue;

            options.push({
                name:        name,
                price:       parsePrice(get(row, 'Extra Cost', '0')),
                description: str(get(row, 'Description', '')),
                active:      str(get(row, 'Active', 'Y')).toUpperCase().startsWith('Y'),
                notes:       str(get(row, 'Notes', '')),
            });
        }

        return options;

    } catch (e) {
        warnings.push(`Error parsing Portion Options: ${e.message}`);
        return [];
    }
}


/* ─────────────────────────────────────────────────────────────────────────────
   STAFF  (new in v2)
───────────────────────────────────────────────────────────────────────────── */
function _parseStaff(workbook, errors, warnings) {
    try {
        const sheet = workbook.Sheets['STAFF'];
        if (!sheet) {
            warnings.push('No STAFF sheet found — skipping');
            return [];
        }

        const rows  = XLSX.utils.sheet_to_json(sheet, { range: 2, defval: '' });
        const staff = [];

        for (const row of rows) {
            const firstName = str(get(row, 'First Name'));
            const lastName  = str(get(row, 'Last Name'));
            if (!firstName || _isHeaderRow(firstName)) continue;

            const pin = str(get(row, 'PIN', '')).replace(/\D/g, '');
            if (!pin) {
                warnings.push(`Staff member "${firstName} ${lastName}" has no PIN — skipping`);
                continue;
            }

            const roleRaw = str(get(row, 'Role', 'Server')).toLowerCase();

            staff.push({
                first_name: firstName,
                last_name:  lastName,
                name:       `${firstName} ${lastName}`.trim(),
                pin:        pin,
                role:       roleRaw.startsWith('man') ? 'manager' : 'server',
                active:     str(get(row, 'Active', 'Y')).toUpperCase().startsWith('Y'),
                notes:      str(get(row, 'Notes', '')),
            });
        }

        if (staff.length === 0) {
            warnings.push('No staff defined');
        }

        const managerCount = staff.filter(s => s.role === 'manager').length;
        if (managerCount === 0 && staff.length > 0) {
            errors.push('At least one Manager is required');
        }

        return staff;

    } catch (e) {
        errors.push(`Error parsing Staff: ${e.message}`);
        return [];
    }
}


/* ─────────────────────────────────────────────────────────────────────────────
   DISCOUNTS  (column names updated in v2)
───────────────────────────────────────────────────────────────────────────── */
function _parseDiscounts(workbook, warnings) {
    try {
        const sheet = workbook.Sheets['DISCOUNTS'];
        if (!sheet) {
            return [];
        }

        const rows      = XLSX.utils.sheet_to_json(sheet, { range: 2, defval: '' });
        const discounts = [];

        for (const row of rows) {
            const name = str(get(row, 'Discount Name'));
            if (!name || _isHeaderRow(name)) continue;

            discounts.push({
                name:              name,
                type:              str(get(row, 'Type', '%')),   // "%" or "$"
                amount:            parsePrice(get(row, 'Amount', '0')),
                who_can_apply:     str(get(row, 'Who Can Apply It', '')),
                applies_to:        str(get(row, 'Applies To', 'Entire Check')),
                requires_approval: str(get(row, 'Needs Manager OK', 'N')).toUpperCase().startsWith('Y'),
                active:            str(get(row, 'Active', 'Y')).toUpperCase().startsWith('Y'),
                notes:             str(get(row, 'Notes', '')),
                // v1 compat
                schedule:              'Always',
                restrictions:          '',
                reason_code_required:  false,
            });
        }

        return discounts;

    } catch (e) {
        warnings.push(`Error parsing Discounts: ${e.message}`);
        return [];
    }
}


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
    const info   = data.restaurant_info || {};
    const nameKey = Object.keys(info).find(k => norm(k) === 'restaurant name') || '';

    return {
        restaurant_name:      nameKey ? info[nameKey] : 'Unknown',
        tax_rate:             ((data.tax_rules || [])[0] || {}).rate ?? 0,
        categories_count:     (data.categories      || []).length,
        choices_count:        (data.option_groups?.choices || []).length,
        groups_count:         (data.option_groups?.groups  || []).length,
        combo_specials_count: (data.combo_specials  || []).length,
        portion_options_count:(data.portion_options || []).length,
        items_count:          (data.items           || []).length,
        staff_count:          (data.staff           || []).length,
        discounts_count:      (data.discounts       || []).length,
    };
}