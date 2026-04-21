import { pushChanges } from '../services/config-push.js';
import { ROLES as FALLBACK_ROLES, loadEmployeeData } from '../data/sample-employees.js';

/* ============================================
   KINDpos Overseer — Tipout Rules

   Single-view CRUD over TipoutRule records.
   Reads  GET  /api/v1/config/tipout
   Writes via  /api/v1/config/push with
          tipout.rule_created / rule_updated / rule_deleted

   Each rule routes a % of a basis (Net Sales,
   Gross Tips, Net Tips) from one role to
   another. Net Sales rules may be scoped to
   a subset of menu categories so a rule like
   "2% of alcohol net sales to bar-back" only
   taxes a server's alcohol sales.

   "Nice. Dependable. Yours."
   ============================================ */

const C = {
    mint:       'var(--color-mint)',
    mintFaded:  'rgba(var(--color-mint-rgb), 0.4)',
    mintBorder: 'rgba(var(--color-mint-rgb), 0.25)',
    mintHover:  'rgba(var(--color-mint-rgb), 0.12)',
    yellow:     'var(--color-gold)',
    red:        'var(--color-vermillion)',
    dark:       'var(--color-bg)',
    darkCard:   '#2a2a2a',
    white:      '#FFFFFF',
    green:      '#00FF00',
    grey:       '#888888',
    backdrop:   'rgba(0, 0, 0, 0.75)',
};

const BASIS_OPTIONS = ['Net Sales', 'Gross Tips', 'Net Tips'];

let currentContainer = null;
let rules = [];          // loaded TipoutRule records
let roles = [];          // loaded Role records
let categories = [];     // loaded MenuCategory records
let editingRuleId = null;

function _uid() {
    return 'rule_' + Math.random().toString(36).slice(2, 10);
}

async function _load() {
    const [rulesRes, rolesRes, catsRes] = await Promise.all([
        fetch('/api/v1/config/tipout').catch(() => null),
        fetch('/api/v1/config/roles').catch(() => null),
        fetch('/api/v1/config/menu/categories').catch(() => null),
    ]);
    rules = rulesRes && rulesRes.ok ? await rulesRes.json() : [];
    const apiRoles = rolesRes && rolesRes.ok ? await rolesRes.json() : [];
    // The backend only returns roles that have been created via explicit
    // EMPLOYEE_ROLE_CREATED events, which is empty on fresh installs. Fall
    // back to the shared ROLES list (the same defaults the Employees
    // section uses) so the rule form always has selectable options.
    if (Array.isArray(apiRoles) && apiRoles.length > 0) {
        roles = apiRoles;
    } else {
        // Make sure FALLBACK_ROLES is populated via loadEmployeeData (no-op if
        // already loaded, falls back to DEFAULT_ROLES if the API is unreachable).
        await loadEmployeeData().catch(() => {});
        roles = (FALLBACK_ROLES || []).map(r => ({ role_id: r.id, name: r.label }));
    }
    categories = catsRes && catsRes.ok ? await catsRes.json() : [];
}

function _showToast(msg, type = 'success') {
    if (!currentContainer) return;
    const old = currentContainer.querySelector('.tr-toast');
    if (old) old.remove();
    const palette = {
        success: { bg: 'rgba(0, 255, 0, 0.15)',  bd: C.green,  fg: C.green  },
        error:   { bg: 'rgba(var(--color-vermillion-rgb), 0.15)', bd: C.red, fg: C.red },
        info:    { bg: 'rgba(var(--color-mint-rgb), 0.15)', bd: C.mint, fg: C.mint },
    };
    const p = palette[type] || palette.info;
    const toast = document.createElement('div');
    toast.className = 'tr-toast';
    toast.textContent = msg;
    toast.style.cssText = `
        position: fixed; top: 24px; right: 24px; z-index: 10000;
        background: ${p.bg}; border: 1px solid ${p.bd}; color: ${p.fg};
        padding: 14px 24px; border-radius: 8px; font-size: 22px;
        backdrop-filter: blur(8px); max-width: 460px;
    `;
    currentContainer.appendChild(toast);
    setTimeout(() => toast.remove(), 3000);
}

function _rolesByName() {
    const map = {};
    roles.forEach(r => { map[r.role_id] = r.name || r.role_id; });
    return map;
}

function _roleLabel(id) {
    return _rolesByName()[id] || id || '—';
}

/* ==========================================
   LIST VIEW — existing rules + "Add Rule"
   ========================================== */
function _buildHeader(container) {
    const header = document.createElement('div');
    header.style.cssText = 'margin-bottom: 20px;';
    header.innerHTML = `
        <div style="font-family: var(--font-display, 'Alien Encounters', monospace);
                    font-size: 36px; color: ${C.yellow}; margin-bottom: 4px;">
            Tipout Rules
        </div>
        <div style="font-size: 22px; color: rgba(var(--color-mint-rgb), 0.6);">
            Route a % of a server's basis (Net Sales / Tips) to a supporting role.
            Scope a Net Sales rule to specific categories for per-category tipouts.
        </div>
    `;
    container.appendChild(header);
}

function _buildAddButton(container) {
    const row = document.createElement('div');
    row.style.cssText = 'display: flex; justify-content: flex-end; margin-bottom: 12px;';

    const btn = document.createElement('button');
    btn.textContent = '+ Add Rule';
    btn.style.cssText = `
        background: ${C.mint}; color: ${C.dark}; border: none;
        padding: 10px 22px; border-radius: 8px; font-size: 22px;
        font-weight: bold; cursor: pointer;
    `;
    btn.addEventListener('click', () => _openForm(null));
    row.appendChild(btn);
    container.appendChild(row);
}

function _buildRulesTable(container) {
    const table = document.createElement('div');
    table.style.cssText = `
        border: 1px solid ${C.mintBorder}; border-radius: 10px;
        overflow: hidden;
    `;

    const hdr = document.createElement('div');
    hdr.style.cssText = `
        display: grid; grid-template-columns: 1.3fr 1.3fr 0.7fr 1.2fr 1.8fr 180px;
        gap: 12px; padding: 12px 16px;
        background: rgba(var(--color-mint-rgb), 0.08);
        font-family: var(--font-display, 'Alien Encounters', monospace);
        font-size: 18px; color: ${C.mint}; letter-spacing: 1px;
    `;
    ['FROM', 'TO', 'PERCENT', 'BASIS', 'CATEGORIES', 'ACTIONS'].forEach(t => {
        const c = document.createElement('div');
        c.textContent = t;
        hdr.appendChild(c);
    });
    table.appendChild(hdr);

    if (!rules.length) {
        const empty = document.createElement('div');
        empty.style.cssText = 'padding: 36px; text-align: center; color: ' + C.grey + '; font-size: 22px;';
        empty.textContent = 'No tipout rules yet. Click "Add Rule" to create one.';
        table.appendChild(empty);
        container.appendChild(table);
        return;
    }

    rules.forEach((r, i) => {
        const row = document.createElement('div');
        row.style.cssText = `
            display: grid; grid-template-columns: 1.3fr 1.3fr 0.7fr 1.2fr 1.8fr 180px;
            gap: 12px; padding: 14px 16px; align-items: center;
            border-top: 1px solid ${C.mintBorder};
            background: ${i % 2 === 0 ? 'transparent' : 'rgba(var(--color-mint-rgb), 0.03)'};
            font-size: 22px; color: ${C.white};
        `;

        const from = document.createElement('div');
        from.textContent = _roleLabel(r.role_from);
        row.appendChild(from);

        const to = document.createElement('div');
        to.textContent = _roleLabel(r.role_to);
        to.style.color = C.yellow;
        row.appendChild(to);

        const pct = document.createElement('div');
        pct.textContent = (r.percentage || 0) + '%';
        row.appendChild(pct);

        const basis = document.createElement('div');
        basis.textContent = r.calculation_base || 'Net Sales';
        basis.style.color = C.mint;
        row.appendChild(basis);

        const cats = document.createElement('div');
        const catList = Array.isArray(r.categories) ? r.categories : [];
        cats.textContent = catList.length ? catList.join(', ') : 'All';
        cats.style.color = catList.length ? C.white : C.grey;
        cats.style.fontSize = '20px';
        row.appendChild(cats);

        const actions = document.createElement('div');
        actions.style.cssText = 'display: flex; gap: 8px;';
        const editBtn = document.createElement('button');
        editBtn.textContent = 'Edit';
        editBtn.style.cssText = `
            background: transparent; border: 1px solid ${C.mintBorder};
            color: ${C.mint}; padding: 6px 14px; border-radius: 6px;
            font-size: 18px; cursor: pointer;
        `;
        editBtn.addEventListener('click', () => _openForm(r));
        const delBtn = document.createElement('button');
        delBtn.textContent = 'Delete';
        delBtn.style.cssText = `
            background: transparent; border: 1px solid ${C.red};
            color: ${C.red}; padding: 6px 14px; border-radius: 6px;
            font-size: 18px; cursor: pointer;
        `;
        delBtn.addEventListener('click', () => _confirmDelete(r));
        actions.appendChild(editBtn);
        actions.appendChild(delBtn);
        row.appendChild(actions);

        table.appendChild(row);
    });

    container.appendChild(table);
}

async function _confirmDelete(rule) {
    if (!confirm(`Delete tipout rule: ${_roleLabel(rule.role_from)} → ${_roleLabel(rule.role_to)} (${rule.percentage}%)?`)) return;
    try {
        await pushChanges([{
            event_type: 'tipout.rule_deleted',
            payload: { rule_id: rule.rule_id },
        }]);
        _showToast('Rule deleted', 'success');
        await _rerender();
    } catch (e) {
        console.warn('[Tipout Rules] delete failed:', e);
        _showToast('Delete failed — see console', 'error');
    }
}

/* ==========================================
   FORM — create / edit a rule
   ========================================== */
function _openForm(rule) {
    editingRuleId = rule ? rule.rule_id : null;
    const isEdit = !!rule;

    const overlay = document.createElement('div');
    overlay.className = 'tr-form-overlay';
    overlay.style.cssText = `
        position: fixed; inset: 0; background: ${C.backdrop};
        z-index: 9000; display: flex; align-items: center; justify-content: center;
    `;

    const panel = document.createElement('div');
    panel.style.cssText = `
        background: ${C.dark}; border: 2px solid ${C.mintBorder};
        border-radius: 12px; padding: 28px; width: 680px; max-width: 92vw;
        max-height: 88vh; overflow-y: auto;
    `;

    const title = document.createElement('div');
    title.textContent = isEdit ? 'Edit Tipout Rule' : 'New Tipout Rule';
    title.style.cssText = `
        font-family: var(--font-display, 'Alien Encounters', monospace);
        font-size: 30px; color: ${C.yellow}; margin-bottom: 18px;
    `;
    panel.appendChild(title);

    // Build form state from rule (or defaults)
    const form = {
        role_from: rule ? rule.role_from : '',
        role_to:   rule ? rule.role_to   : '',
        percentage: rule ? rule.percentage : 0,
        calculation_base: rule ? (rule.calculation_base || 'Net Sales') : 'Net Sales',
        categories: rule && Array.isArray(rule.categories) ? rule.categories.slice() : [],
    };

    panel.appendChild(_selectField('From role (who pays)', 'role_from', form, roles.map(r => ({ value: r.role_id, label: r.name || r.role_id }))));
    panel.appendChild(_selectField('To role (who receives)', 'role_to', form, roles.map(r => ({ value: r.role_id, label: r.name || r.role_id }))));
    panel.appendChild(_numberField('Percentage (%)', 'percentage', form));
    panel.appendChild(_selectField('Calculation basis', 'calculation_base', form, BASIS_OPTIONS.map(o => ({ value: o, label: o }))));

    // Category multi-select (only meaningful for Net Sales)
    const catSection = _categoryField(form);
    panel.appendChild(catSection);

    // Hide category section when basis isn't Net Sales
    const basisSelect = panel.querySelector('[data-field="calculation_base"]');
    const syncCatVis = () => {
        catSection.style.display = form.calculation_base === 'Net Sales' ? '' : 'none';
    };
    if (basisSelect) basisSelect.addEventListener('change', syncCatVis);
    syncCatVis();

    const buttonRow = document.createElement('div');
    buttonRow.style.cssText = 'display: flex; justify-content: flex-end; gap: 10px; margin-top: 20px;';

    const cancelBtn = document.createElement('button');
    cancelBtn.textContent = 'Cancel';
    cancelBtn.style.cssText = `
        background: transparent; border: 1px solid ${C.mintBorder};
        color: ${C.mint}; padding: 10px 22px; border-radius: 8px;
        font-size: 22px; cursor: pointer;
    `;
    cancelBtn.addEventListener('click', () => overlay.remove());

    const saveBtn = document.createElement('button');
    saveBtn.textContent = isEdit ? 'Save Changes' : 'Create Rule';
    saveBtn.style.cssText = `
        background: ${C.mint}; color: ${C.dark}; border: none;
        padding: 10px 22px; border-radius: 8px; font-size: 22px;
        font-weight: bold; cursor: pointer;
    `;
    saveBtn.addEventListener('click', async () => {
        if (!form.role_from || !form.role_to) {
            _showToast('Pick a From and To role', 'error');
            return;
        }
        const pct = parseFloat(form.percentage);
        if (!isFinite(pct) || pct <= 0) {
            _showToast('Percentage must be > 0', 'error');
            return;
        }
        const payload = {
            rule_id: isEdit ? rule.rule_id : _uid(),
            role_from: form.role_from,
            role_to: form.role_to,
            percentage: pct,
            calculation_base: form.calculation_base,
            categories: form.calculation_base === 'Net Sales' ? form.categories.slice() : [],
        };
        try {
            await pushChanges([{
                event_type: isEdit ? 'tipout.rule_updated' : 'tipout.rule_created',
                payload,
            }]);
            _showToast(isEdit ? 'Rule updated' : 'Rule created', 'success');
            overlay.remove();
            await _rerender();
        } catch (e) {
            console.warn('[Tipout Rules] save failed:', e);
            _showToast('Save failed — see console', 'error');
        }
    });

    buttonRow.appendChild(cancelBtn);
    buttonRow.appendChild(saveBtn);
    panel.appendChild(buttonRow);

    overlay.appendChild(panel);
    currentContainer.appendChild(overlay);
}

function _fieldWrap(label) {
    const wrap = document.createElement('div');
    wrap.style.cssText = 'margin-bottom: 16px;';
    const l = document.createElement('div');
    l.textContent = label;
    l.style.cssText = `
        font-size: 20px; color: ${C.mint}; letter-spacing: 1px;
        margin-bottom: 6px;
    `;
    wrap.appendChild(l);
    return wrap;
}

function _selectField(label, key, form, options) {
    const wrap = _fieldWrap(label);
    const sel = document.createElement('select');
    sel.dataset.field = key;
    sel.style.cssText = `
        width: 100%; padding: 10px 12px; border-radius: 8px;
        background: ${C.darkCard}; color: ${C.white};
        border: 1px solid ${C.mintBorder}; font-size: 22px;
    `;
    const blank = document.createElement('option');
    blank.value = '';
    blank.textContent = '— select —';
    sel.appendChild(blank);
    options.forEach(o => {
        const opt = document.createElement('option');
        opt.value = o.value;
        opt.textContent = o.label;
        if (form[key] === o.value) opt.selected = true;
        sel.appendChild(opt);
    });
    sel.addEventListener('change', () => { form[key] = sel.value; });
    wrap.appendChild(sel);
    return wrap;
}

function _numberField(label, key, form) {
    const wrap = _fieldWrap(label);
    const input = document.createElement('input');
    input.type = 'number';
    input.step = '0.01';
    input.min = '0';
    input.value = form[key] != null ? String(form[key]) : '';
    input.style.cssText = `
        width: 100%; padding: 10px 12px; border-radius: 8px;
        background: ${C.darkCard}; color: ${C.white};
        border: 1px solid ${C.mintBorder}; font-size: 22px;
    `;
    input.addEventListener('input', () => { form[key] = input.value; });
    wrap.appendChild(input);
    return wrap;
}

function _categoryField(form) {
    const wrap = _fieldWrap('Categories (leave empty for ALL net sales)');
    const hint = document.createElement('div');
    hint.textContent = 'When at least one category is selected the basis narrows to the server\u2019s net sales in those categories only.';
    hint.style.cssText = `font-size: 18px; color: ${C.grey}; margin-bottom: 8px;`;
    wrap.appendChild(hint);

    const grid = document.createElement('div');
    grid.style.cssText = `
        display: grid; grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
        gap: 8px; padding: 12px; border: 1px solid ${C.mintBorder}; border-radius: 8px;
    `;

    if (!categories.length) {
        const empty = document.createElement('div');
        empty.textContent = 'No categories configured yet.';
        empty.style.cssText = `color: ${C.grey}; font-size: 20px; grid-column: 1/-1;`;
        grid.appendChild(empty);
    } else {
        categories.forEach(c => {
            const name = c.name || c.category_id;
            const chip = document.createElement('label');
            chip.style.cssText = `
                display: flex; align-items: center; gap: 8px;
                padding: 6px 10px; border-radius: 6px;
                background: rgba(var(--color-mint-rgb), 0.05);
                cursor: pointer; font-size: 20px; color: ${C.white};
            `;
            const cb = document.createElement('input');
            cb.type = 'checkbox';
            cb.checked = form.categories.indexOf(name) !== -1;
            cb.addEventListener('change', () => {
                if (cb.checked) {
                    if (form.categories.indexOf(name) === -1) form.categories.push(name);
                } else {
                    form.categories = form.categories.filter(x => x !== name);
                }
            });
            chip.appendChild(cb);
            const span = document.createElement('span');
            span.textContent = name;
            chip.appendChild(span);
            grid.appendChild(chip);
        });
    }

    wrap.appendChild(grid);
    return wrap;
}

/* ==========================================
   RENDER / SCENE WIRING
   ========================================== */
async function _rerender() {
    if (!currentContainer) return;
    const wrapper = currentContainer.querySelector('#tr-view-wrapper');
    if (!wrapper) return;
    wrapper.innerHTML = '';
    await _load();
    _buildHeader(wrapper);
    _buildAddButton(wrapper);
    _buildRulesTable(wrapper);
}

export async function buildTipoutRulesScene(container) {
    currentContainer = container;
    container.innerHTML = '';
    container.style.cssText = 'padding: 30px 24px 60px; max-width: 1200px; margin: 0 auto;';

    const wrapper = document.createElement('div');
    wrapper.id = 'tr-view-wrapper';
    container.appendChild(wrapper);

    await _load();
    _buildHeader(wrapper);
    _buildAddButton(wrapper);
    _buildRulesTable(wrapper);
}

export function cleanupTipoutRules() {
    if (currentContainer) currentContainer.innerHTML = '';
    currentContainer = null;
    rules = [];
    roles = [];
    categories = [];
    editingRuleId = null;
}
