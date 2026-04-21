/* ============================================
   KINDpos Overseer — Store Information (Nostalgia)

   Restaurant identity, branding (logo), address, contact.
   Persists via pushChanges() → POST /api/v1/config/store/info.
   ============================================ */

import { pushChanges } from '../services/config-push.js';
import {
  C, showToast, buildScenePage, sectionCard,
  field, row, button
} from '../ui/forms.js';

let _currentContainer = null;
let _storeInfo = null;

async function loadStoreInfo() {
  try {
    const res = await fetch('/api/v1/config/store');
    if (!res.ok) return { info: {}, branding: {} };
    const bundle = await res.json();
    return { info: bundle.info || {}, branding: bundle.branding || {} };
  } catch (e) {
    console.warn('[StoreInfo] Load failed:', e);
    return { info: {}, branding: {} };
  }
}

async function uploadLogo(file) {
  const allowed = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'];
  if (!allowed.includes(file.type)) {
    showToast('Logo must be PNG, JPG, WEBP, or GIF', 'error');
    return null;
  }
  if (file.size > 2 * 1024 * 1024) {
    showToast('Logo must be under 2 MB', 'error');
    return null;
  }
  const base64 = await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const s = reader.result || '';
      const idx = s.indexOf(',');
      resolve(idx === -1 ? s : s.slice(idx + 1));
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
  const res = await fetch('/api/v1/config/store/logo', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      filename: file.name,
      mime_type: file.type,
      content_base64: base64,
    }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    showToast('Logo upload failed' + (text ? `: ${text}` : ''), 'error');
    return null;
  }
  return await res.json();
}

function brandingSection(branding) {
  const { card, body } = sectionCard({
    label: 'Branding',
    note: 'Logo shown on the terminal login screen. PNG, JPG, WEBP, or GIF. Under 2 MB.',
  });

  const row = document.createElement('div');
  row.style.cssText = 'display: flex; align-items: center; gap: 24px;';

  // Logo preview
  const preview = document.createElement('img');
  preview.alt = 'Store logo';
  preview.style.cssText = `
    width: 120px; height: 120px;
    object-fit: contain;
    background: ${C.well};
    border: 1px solid ${C.border};
    border-radius: 8px;
    padding: 8px;
    box-sizing: border-box;
  `;
  if (branding && branding.logo_url) {
    preview.src = branding.logo_url + (branding.logo_url.includes('?') ? '&' : '?') + 'v=' + Date.now();
  } else {
    // Empty state - show placeholder text via alt
    preview.style.objectFit = 'cover';
    preview.removeAttribute('src');
    const placeholder = document.createElement('div');
    placeholder.style.cssText = `
      width: 120px; height: 120px;
      background: ${C.well};
      border: 1px solid ${C.border};
      border-radius: 8px;
      display: flex; align-items: center; justify-content: center;
      color: ${C.textDim};
      font-family: ui-monospace, monospace;
      font-size: 11px;
      letter-spacing: 2px;
    `;
    placeholder.textContent = 'NO LOGO';
    row.appendChild(placeholder);
  }
  if (preview.src) row.appendChild(preview);

  // Controls column
  const controls = document.createElement('div');
  controls.style.cssText = 'flex: 1; display: flex; flex-direction: column; gap: 12px; align-items: flex-start;';

  const fileInput = document.createElement('input');
  fileInput.type = 'file';
  fileInput.accept = 'image/png,image/jpeg,image/webp,image/gif';
  fileInput.style.cssText = `
    color: ${C.textMuted};
    font-family: var(--font-body);
    font-size: 13px;
  `;
  controls.appendChild(fileInput);

  const uploadBtn = button({
    label: 'Upload Logo',
    variant: 'secondary',
    onClick: async () => {
      const file = fileInput.files && fileInput.files[0];
      if (!file) { showToast('Pick a file first', 'error'); return; }
      uploadBtn.disabled = true;
      uploadBtn.textContent = 'Uploading...';
      const result = await uploadLogo(file);
      uploadBtn.disabled = false;
      uploadBtn.textContent = 'Upload Logo';
      if (result && result.logo_url) {
        // Swap placeholder for preview if one was shown
        const ph = row.querySelector('div:not([style*="flex:"])');
        if (ph && !preview.src) ph.remove();
        preview.src = result.logo_url + '?v=' + Date.now();
        if (!row.contains(preview)) row.insertBefore(preview, controls);
        fileInput.value = '';
        showToast('Logo updated');
      }
    }
  });
  controls.appendChild(uploadBtn);

  row.appendChild(controls);
  body.appendChild(row);
  return card;
}

async function mount(container) {
  _currentContainer = container;
  const loaded = await loadStoreInfo();
  _storeInfo = loaded.info;
  const branding = loaded.branding;

  const fields = {};

  const { body } = buildScenePage(container, {
    title: 'Store Information',
    subtitle: 'Restaurant details shown on receipts and reports',
    onSave: async () => {
      const name = fields.name.value.trim();
      if (!name) {
        showToast('Restaurant name is required', 'error');
        fields.name.focus();
        return;
      }

      const payload = {
        restaurant_name:   name,
        legal_entity_name: fields.legal.value.trim() || null,
        address_line_1:    fields.addr1.value.trim(),
        address_line_2:    fields.addr2.value.trim() || null,
        city:              fields.city.value.trim(),
        state:             fields.state.value.trim(),
        zip:               fields.zip.value.trim(),
        phone:             fields.phone.value.trim(),
        email:             fields.email.value.trim() || null,
        website:           fields.web.value.trim() || null,
      };

      const result = await pushChanges([{
        event_type: 'store.info_updated',
        payload,
      }]);

      if (!result.ok) {
        showToast('Failed to save', 'error');
      } else {
        showToast('Store information saved');
        _storeInfo = payload;
      }
    },
  });

  // ── IDENTITY ─────────────────────────────────────────────────────
  const identity = sectionCard({ label: 'Identity' });
  const nameField = field({
    label: 'Restaurant Name',
    id: 'si-name',
    value: _storeInfo.restaurant_name,
    placeholder: "e.g. Sammy's Pizza",
    required: true,
  });
  const legalField = field({
    label: 'Legal Entity',
    id: 'si-legal',
    value: _storeInfo.legal_entity_name,
    placeholder: 'Legal business name (optional)',
  });
  identity.body.appendChild(nameField.wrap);
  identity.body.appendChild(legalField.wrap);
  fields.name = nameField.input;
  fields.legal = legalField.input;
  body.appendChild(identity.card);

  // ── BRANDING ─────────────────────────────────────────────────────
  body.appendChild(brandingSection(branding));

  // ── ADDRESS ──────────────────────────────────────────────────────
  const addr = sectionCard({ label: 'Address' });
  const addr1Field = field({ label: 'Street',                  id: 'si-addr1', value: _storeInfo.address_line_1 });
  const addr2Field = field({ label: 'Suite / Apt (optional)',  id: 'si-addr2', value: _storeInfo.address_line_2 });
  addr.body.appendChild(addr1Field.wrap);
  addr.body.appendChild(addr2Field.wrap);
  fields.addr1 = addr1Field.input;
  fields.addr2 = addr2Field.input;

  const cityField  = field({ label: 'City',  id: 'si-city',  value: _storeInfo.city  });
  const stateField = field({ label: 'State', id: 'si-state', value: _storeInfo.state });
  const zipField   = field({ label: 'ZIP',   id: 'si-zip',   value: _storeInfo.zip   });
  stateField.input.style.maxWidth = '120px';
  zipField.input.style.maxWidth = '140px';
  stateField.wrap.style.flex = '0 0 140px';
  zipField.wrap.style.flex = '0 0 160px';
  addr.body.appendChild(row(cityField, stateField, zipField));
  fields.city  = cityField.input;
  fields.state = stateField.input;
  fields.zip   = zipField.input;
  body.appendChild(addr.card);

  // ── CONTACT ──────────────────────────────────────────────────────
  const contact = sectionCard({ label: 'Contact' });
  const phoneField = field({ label: 'Phone',   id: 'si-phone', value: _storeInfo.phone,   placeholder: '(555) 123-4567',   type: 'tel' });
  const emailField = field({ label: 'Email',   id: 'si-email', value: _storeInfo.email,   placeholder: 'contact@example.com', type: 'email' });
  const webField   = field({ label: 'Website', id: 'si-web',   value: _storeInfo.website, placeholder: 'https://example.com', type: 'url' });
  contact.body.appendChild(row(phoneField, emailField));
  contact.body.appendChild(webField.wrap);
  fields.phone = phoneField.input;
  fields.email = emailField.input;
  fields.web   = webField.input;
  body.appendChild(contact.card);
}

export function buildStoreInfoScene(container) {
  mount(container).catch(e => console.error('[StoreInfo] Mount error:', e));
}

export function cleanupStoreInfo(container) {
  if (container) container.innerHTML = '';
  _currentContainer = null;
  _storeInfo = null;
}