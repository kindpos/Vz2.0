/* ============================================
   KINDpos Overseer — Receipt Settings
   Logo, tip suggestions, receipt copies, language.
   ============================================ */

import { pushChanges } from '../services/config-push.js';

let currentContainer = null;

function showToast(msg, type = 'success') {
    const toast = document.createElement('div');
    const color = type === 'error' ? 'var(--color-vermillion)' : 'var(--color-green)';
    toast.style.cssText = `position:fixed;top:24px;right:24px;z-index:10000;background:rgba(0,0,0,0.85);border:1px solid ${color};color:${color};padding:14px 24px;border-radius:8px;font-family:var(--font-body);font-size:22px;`;
    toast.textContent = msg;
    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), 3000);
}

async function loadStoreInfo() {
    try {
        const res = await fetch('/api/v1/config/store');
        if (!res.ok) return {};
        const bundle = await res.json();
        return bundle.info || {};
    } catch { return {}; }
}

function section(title) {
    const h = document.createElement('div');
    h.style.cssText = 'font-family:var(--font-heading);font-size:22px;color:var(--color-mint);margin:24px 0 12px 0;';
    h.textContent = title;
    return h;
}

function toggle(label, checked) {
    const wrap = document.createElement('label');
    wrap.style.cssText = `
        display: inline-flex; align-items: center; gap: 10px;
        padding: 10px 16px; border-radius: 6px; cursor: pointer;
        background: ${checked ? 'rgba(var(--color-mint-rgb), 0.2)' : 'var(--color-bg-dark)'};
        border: 1px solid ${checked ? 'var(--color-mint)' : 'rgba(var(--color-mint-rgb), 0.15)'};
        color: var(--color-mint); font-family: var(--font-body); font-size: 20px;
        margin-right: 8px; margin-bottom: 8px;
        transition: all 0.15s ease;
    `;
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = !!checked;
    cb.style.cssText = 'accent-color: var(--color-mint); width:18px; height:18px;';
    cb.addEventListener('change', () => {
        wrap.style.background = cb.checked ? 'rgba(var(--color-mint-rgb), 0.2)' : 'var(--color-bg-dark)';
        wrap.style.borderColor = cb.checked ? 'var(--color-mint)' : 'rgba(var(--color-mint-rgb), 0.15)';
    });
    wrap.appendChild(cb);
    wrap.appendChild(document.createTextNode(label));
    return { wrap, cb };
}

function textInput(label, id, value, placeholder = '', type = 'text') {
    const wrap = document.createElement('div');
    wrap.style.cssText = 'margin-bottom: 14px;';
    const lbl = document.createElement('label');
    lbl.textContent = label;
    lbl.style.cssText = 'display:block;font-family:var(--font-body);font-size:16px;color:var(--color-mint);margin-bottom:4px;';
    wrap.appendChild(lbl);
    const inp = document.createElement('input');
    inp.type = type;
    inp.id = id;
    inp.value = value || '';
    if (placeholder) inp.placeholder = placeholder;
    inp.className = 'kp-date-input';
    inp.style.cssText += 'width:100%;max-width:300px;font-size:20px;';
    wrap.appendChild(inp);
    return { wrap, input: inp };
}

async function mount(container) {
    const info = await loadStoreInfo();
    const receipt = info.receipt_settings || {};

    container.innerHTML = '';
    const wrapper = document.createElement('div');
    wrapper.style.cssText = 'max-width:800px;margin:0 auto;padding:30px 24px 60px;';
    wrapper.innerHTML = `
        <div style="font-family:var(--font-heading);font-size:44px;color:var(--color-gold);margin-bottom:4px;">
            \u{1F9FE} Receipt Settings
        </div>
        <div style="font-size:18px;color:rgba(var(--color-mint-rgb),0.5);margin-bottom:20px;">
            Logo, tip suggestions, receipt copies, language
        </div>
    `;
    container.appendChild(wrapper);

    // Receipt header/footer text
    wrapper.appendChild(section('HEADER / FOOTER TEXT'));
    const headerF = textInput('Header Text', 'rs-header', info.receipt_header || '', 'Thank you for visiting!');
    const footerF = textInput('Footer Text', 'rs-footer', info.receipt_footer || '', 'Come back soon!');
    headerF.input.style.maxWidth = '100%';
    footerF.input.style.maxWidth = '100%';
    wrapper.appendChild(headerF.wrap);
    wrapper.appendChild(footerF.wrap);

    // Logo + copies
    wrapper.appendChild(section('PRINTING OPTIONS'));
    const logoT = toggle('Print Logo on Receipts', receipt.print_logo !== false);
    const customerT = toggle('Print Customer Copy', receipt.print_customer_copy !== false);
    const merchantT = toggle('Print Merchant Copy', receipt.print_merchant_copy === true);
    const itemizedT = toggle('Print Itemized Copy', receipt.print_itemized_copy !== false);
    wrapper.appendChild(logoT.wrap);
    wrapper.appendChild(customerT.wrap);
    wrapper.appendChild(merchantT.wrap);
    wrapper.appendChild(itemizedT.wrap);

    // Tip suggestions
    wrapper.appendChild(section('TIP SUGGESTIONS'));
    const tips = receipt.tip_suggestions || [15, 18, 20];
    const tipRow = document.createElement('div');
    tipRow.style.cssText = 'display:flex;gap:12px;align-items:end;';
    const tip1 = textInput('Suggestion 1 (%)', 'rs-tip1', tips[0] || 15, '', 'number');
    const tip2 = textInput('Suggestion 2 (%)', 'rs-tip2', tips[1] || 18, '', 'number');
    const tip3 = textInput('Suggestion 3 (%)', 'rs-tip3', tips[2] || 20, '', 'number');
    [tip1, tip2, tip3].forEach(t => { t.input.style.maxWidth = '100px'; tipRow.appendChild(t.wrap); });
    wrapper.appendChild(tipRow);

    // Tip calc base
    const tipBaseWrap = document.createElement('div');
    tipBaseWrap.style.cssText = 'margin-top:8px;';
    tipBaseWrap.innerHTML = '<div style="color:var(--color-mint);font-size:16px;margin-bottom:4px;">Tip calculated on:</div>';
    const tipBaseSelect = document.createElement('select');
    tipBaseSelect.className = 'kp-date-input';
    tipBaseSelect.style.cssText += 'width:200px;font-size:20px;';
    ['pretax', 'posttax'].forEach(v => {
        const opt = document.createElement('option');
        opt.value = v; opt.textContent = v === 'pretax' ? 'Pre-tax (Net)' : 'Post-tax (Gross)';
        opt.style.background = 'var(--color-bg-dark)';
        if ((receipt.tip_calc_base || 'pretax') === v) opt.selected = true;
        tipBaseSelect.appendChild(opt);
    });
    tipBaseWrap.appendChild(tipBaseSelect);
    wrapper.appendChild(tipBaseWrap);

    // Language
    wrapper.appendChild(section('LANGUAGE'));
    const langWrap = document.createElement('div');
    const langSelect = document.createElement('select');
    langSelect.className = 'kp-date-input';
    langSelect.style.cssText += 'width:200px;font-size:20px;';
    [['en', 'English'], ['es', 'Español'], ['it', 'Italiano']].forEach(([v, l]) => {
        const opt = document.createElement('option');
        opt.value = v; opt.textContent = l;
        opt.style.background = 'var(--color-bg-dark)';
        if ((receipt.language || 'en') === v) opt.selected = true;
        langSelect.appendChild(opt);
    });
    langWrap.appendChild(langSelect);
    wrapper.appendChild(langWrap);

    // Save
    const saveBtn = document.createElement('button');
    saveBtn.type = 'button';
    saveBtn.textContent = 'Save Receipt Settings';
    saveBtn.style.cssText = 'background:var(--color-mint);color:var(--color-bg);border:none;border-radius:8px;padding:14px 32px;font-family:var(--font-body);font-size:22px;font-weight:bold;cursor:pointer;margin-top:28px;';
    saveBtn.addEventListener('click', async () => {
        saveBtn.disabled = true;
        saveBtn.textContent = 'Saving...';

        const payload = {
            ...info,
            receipt_header: headerF.input.value.trim(),
            receipt_footer: footerF.input.value.trim(),
            receipt_settings: {
                print_logo: logoT.cb.checked,
                print_customer_copy: customerT.cb.checked,
                print_merchant_copy: merchantT.cb.checked,
                print_itemized_copy: itemizedT.cb.checked,
                tip_suggestions: [
                    parseInt(tip1.input.value) || 15,
                    parseInt(tip2.input.value) || 18,
                    parseInt(tip3.input.value) || 20,
                ],
                tip_calc_base: tipBaseSelect.value,
                language: langSelect.value,
            },
        };

        const result = await pushChanges([{ event_type: 'store.info_updated', payload }]);
        saveBtn.disabled = false;
        saveBtn.textContent = 'Save Receipt Settings';
        if (result.ok) showToast('Receipt settings saved');
        else showToast('Failed to save', 'error');
    });
    wrapper.appendChild(saveBtn);
}

export function buildReceiptSettingsScene(container) {
    currentContainer = container;
    mount(container).catch(e => console.error('[ReceiptSettings] Mount error:', e));
}

export function cleanupReceiptSettings(container) {
    if (container) container.innerHTML = '';
    currentContainer = null;
}
