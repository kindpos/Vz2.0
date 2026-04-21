/* ============================================
   KINDpos Overseer — Shared Form UI (Nostalgia)

   Common building blocks for reskinned sections. All new/reskinned
   scenes should go through this module so the look stays consistent
   and tweaks only need to happen in one place.

   Covers:
   - Color palette (C)
   - buildScenePage   : standard scene scaffold with sticky top bar
   - sectionCard      : titled card containing a form section
   - field            : text-like input
   - numberField      : number input with optional suffix
   - row              : horizontal field row
   - checkboxChip     : pill-style toggle
   - chipGroup        : multi/single-select chip row
   - colorPicker      : swatch picker
   - button           : primary/secondary/danger/ghost buttons
   - openModal        : generic modal with title/content/footer
   - showToast        : toasts (top-right)
   - withAlpha        : hex + alpha → rgba()
   ============================================ */

// ─── Nostalgia tokens ──────────────────────────────────────────────
// Tokens now live in ui/tokens.js. `C` is kept as a re-export so
// existing consumers (sectionCard, button, openModal, ...) keep
// working without edits.
import { T, withAlpha as _withAlpha } from './tokens.js';

export { T };
export const C = T;
export const withAlpha = _withAlpha;

// ─── Keyframes (injected once) ─────────────────────────────────────
function ensureKeyframes() {
  if (document.getElementById('ov-form-keyframes')) return;
  const style = document.createElement('style');
  style.id = 'ov-form-keyframes';
  style.textContent = `
    @keyframes ov-fade-in { from { opacity: 0; transform: translateY(-4px); } to { opacity: 1; transform: none; } }
  `;
  document.head.appendChild(style);
}

// ─── Toast ────────────────────────────────────────────────────────
let _toastMount = null;
function ensureToastMount() {
  if (_toastMount && document.body.contains(_toastMount)) return _toastMount;
  _toastMount = document.createElement('div');
  _toastMount.id = 'ov-toast-root';
  _toastMount.style.cssText = `
    position: fixed; top: 24px; right: 24px; z-index: 10000;
    display: flex; flex-direction: column; gap: 8px;
    pointer-events: none;
  `;
  document.body.appendChild(_toastMount);
  return _toastMount;
}

export function showToast(msg, type = 'success') {
  ensureKeyframes();
  const mount = ensureToastMount();
  const color = type === 'error' ? C.verm : (type === 'warn' ? C.warning : C.greenUp);
  const toast = document.createElement('div');
  toast.style.cssText = `
    background: rgba(26, 29, 32, 0.95);
    border: 1px solid ${color};
    color: ${color};
    padding: 12px 20px;
    border-radius: 8px;
    font-family: var(--font-body);
    font-size: 14px;
    pointer-events: auto;
    min-width: 220px;
    box-shadow: 0 4px 14px rgba(0,0,0,0.4);
    animation: ov-fade-in 0.2s ease-out;
  `;
  toast.textContent = msg;
  mount.appendChild(toast);
  setTimeout(() => {
    toast.style.transition = 'opacity 0.2s ease-out';
    toast.style.opacity = '0';
    setTimeout(() => toast.remove(), 250);
  }, 2500);
}

// ─── Scene page scaffold ──────────────────────────────────────────
// Builds the standard Nostalgia-styled section scene:
// - Sticky top bar with title + subtitle (left) and save button (right)
// - Scrollable body below for content cards
//
// Returns { wrapper, body, saveBar }.
// Use saveBar.setBusy(bool) if you need to control it externally.
export function buildScenePage(container, { title, subtitle = null, saveLabel = 'Save Changes', onSave = null }) {
  container.innerHTML = '';
  ensureKeyframes();

  const wrapper = document.createElement('div');
  wrapper.style.cssText = `
    max-width: 960px;
    margin: 0 auto;
    padding: 0 32px 80px;
    color: ${C.text};
  `;
  container.appendChild(wrapper);

  // Sticky header
  const header = document.createElement('div');
  header.style.cssText = `
    position: sticky;
    top: 0;
    z-index: 10;
    background: ${C.bg};
    padding: 24px 0 20px;
    border-bottom: 1px solid ${C.well};
    margin-bottom: 28px;
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    gap: 20px;
  `;

  const titleCol = document.createElement('div');
  titleCol.style.cssText = 'flex: 1; min-width: 0;';
  titleCol.innerHTML = `
    <div style="font-family: var(--font-heading); font-size: 34px; font-weight: 700; color: ${C.text}; letter-spacing: 0.5px; line-height: 1.1;">${title}</div>
    ${subtitle ? `<div style="font-family: ui-monospace, monospace; font-size: 12px; letter-spacing: 2px; color: ${C.textMuted}; margin-top: 8px; text-transform: uppercase;">${subtitle}</div>` : ''}
  `;
  header.appendChild(titleCol);

  // Save bar is only rendered when an onSave handler is provided.
  // List-style pages (e.g. Staff List) pass no handler and get a
  // clean header with no floating button.
  const saveBar = onSave ? buildStickySaveBar({ label: saveLabel, onSave }) : null;
  if (saveBar) header.appendChild(saveBar.el);

  wrapper.appendChild(header);

  // Body
  const body = document.createElement('div');
  body.style.cssText = 'display: flex; flex-direction: column; gap: 20px;';
  wrapper.appendChild(body);

  return { wrapper, body, saveBar };
}

function buildStickySaveBar({ label = 'Save Changes', onSave = null }) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.textContent = label;
  btn.style.cssText = `
    background: ${C.gold};
    color: #1a1000;
    border: none;
    border-radius: 999px;
    padding: 12px 28px;
    font-family: var(--font-heading);
    font-size: 13px;
    font-weight: 700;
    letter-spacing: 1.5px;
    text-transform: uppercase;
    cursor: pointer;
    box-shadow: 0 2px 6px rgba(0,0,0,0.3);
    transition: transform 0.1s ease, opacity 0.15s ease;
    flex-shrink: 0;
    white-space: nowrap;
  `;
  btn.addEventListener('mouseenter', () => { if (!btn.disabled) btn.style.transform = 'translateY(-1px)'; });
  btn.addEventListener('mouseleave', () => { btn.style.transform = ''; });

  let busy = false;
  const setBusy = (b) => {
    busy = b;
    btn.disabled = b;
    btn.style.opacity = b ? '0.6' : '1';
    btn.style.cursor = b ? 'default' : 'pointer';
    btn.textContent = b ? 'Saving...' : label;
  };

  if (onSave) {
    btn.addEventListener('click', async () => {
      if (busy) return;
      setBusy(true);
      try {
        await onSave();
      } catch (e) {
        console.error('[saveBar] onSave threw:', e);
        showToast('Save failed: ' + (e.message || e), 'error');
      } finally {
        setBusy(false);
      }
    });
  }

  return { el: btn, setBusy };
}

// ─── Section card ─────────────────────────────────────────────────
// Titled card that wraps a related group of fields.
// Returns { card, body } — append fields into `body`.
export function sectionCard({ label, note = null, accent = null }) {
  const card = document.createElement('div');
  card.style.cssText = `
    background: ${C.card};
    border-radius: 10px;
    padding: 24px 26px;
    border-left: 4px solid ${accent || C.green};
    position: relative;
  `;

  if (label) {
    const lbl = document.createElement('div');
    lbl.style.cssText = `
      font-family: ui-monospace, monospace;
      font-size: 13px;
      letter-spacing: 2.5px;
      font-weight: 700;
      color: ${accent || C.green};
      text-transform: uppercase;
      margin-bottom: ${note ? '8px' : '18px'};
    `;
    lbl.textContent = label;
    card.appendChild(lbl);
  }
  if (note) {
    const n = document.createElement('div');
    n.style.cssText = `
      font-size: 13px;
      color: ${C.textMuted};
      font-family: var(--font-body);
      margin-bottom: 18px;
      line-height: 1.5;
    `;
    n.textContent = note;
    card.appendChild(n);
  }

  const body = document.createElement('div');
  body.style.cssText = 'display: flex; flex-direction: column; gap: 16px;';
  card.appendChild(body);

  return { card, body };
}

// ─── Text field ───────────────────────────────────────────────────
export function field({ label, id = null, value = '', placeholder = '', type = 'text', required = false }) {
  const wrap = document.createElement('div');
  wrap.style.cssText = 'display: flex; flex-direction: column; gap: 6px; flex: 1; min-width: 0;';

  if (label) {
    const lbl = document.createElement('label');
    lbl.style.cssText = `
      font-family: var(--font-body);
      font-size: 13px;
      color: ${C.textMuted};
      font-weight: 600;
      letter-spacing: 0.3px;
    `;
    if (id) lbl.htmlFor = id;
    lbl.innerHTML = required
      ? `${label} <span style="color: ${C.verm};">*</span>`
      : label;
    wrap.appendChild(lbl);
  }

  const input = document.createElement('input');
  input.type = type;
  if (id) input.id = id;
  input.value = value != null ? value : '';
  if (placeholder) input.placeholder = placeholder;
  input.style.cssText = `
    width: 100%;
    box-sizing: border-box;
    background: ${C.well};
    color: ${C.text};
    border: 1px solid ${C.border};
    border-radius: 6px;
    padding: 10px 14px;
    font-size: 15px;
    font-family: var(--font-body);
    outline: none;
    transition: border-color 0.15s ease;
    color-scheme: dark;
  `;
  input.addEventListener('focus', () => input.style.borderColor = C.gold);
  input.addEventListener('blur',  () => input.style.borderColor = C.border);
  wrap.appendChild(input);

  return { wrap, input };
}

// ─── Number field ─────────────────────────────────────────────────
export function numberField({ label, id = null, value = 0, min = null, max = null, step = 1, suffix = null, width = null, required = false }) {
  const { wrap, input } = field({ label, id, value, type: 'number', required });
  if (min != null) input.min = String(min);
  if (max != null) input.max = String(max);
  if (step != null) input.step = String(step);
  if (width) input.style.maxWidth = width + 'px';

  if (suffix) {
    // Reparent input into a row so the suffix sits next to it
    const container = document.createElement('div');
    container.style.cssText = 'display: flex; align-items: center; gap: 10px;';
    input.parentNode.removeChild(input);
    container.appendChild(input);
    const sfx = document.createElement('span');
    sfx.textContent = suffix;
    sfx.style.cssText = `
      font-family: ui-monospace, monospace;
      font-size: 13px;
      color: ${C.textMuted};
      white-space: nowrap;
    `;
    container.appendChild(sfx);
    wrap.appendChild(container);
  }
  return { wrap, input };
}

// ─── Row (horizontal) ─────────────────────────────────────────────
export function row(...children) {
  const r = document.createElement('div');
  r.style.cssText = 'display: flex; gap: 16px; align-items: flex-end;';
  children.forEach(c => r.appendChild(c.wrap || c));
  return r;
}

// ─── Checkbox chip ────────────────────────────────────────────────
export function checkboxChip({ label, checked = false, onChange = null }) {
  const chip = document.createElement('label');
  chip.style.cssText = `
    display: inline-flex;
    align-items: center;
    gap: 10px;
    padding: 10px 16px;
    border-radius: 999px;
    background: ${checked ? withAlpha(C.green, 0.15) : C.well};
    border: 1px solid ${checked ? C.green : C.border};
    color: ${checked ? C.green : C.textMuted};
    font-family: var(--font-body);
    font-size: 14px;
    cursor: pointer;
    transition: all 0.15s ease;
    user-select: none;
  `;
  const cb = document.createElement('input');
  cb.type = 'checkbox';
  cb.checked = !!checked;
  cb.style.cssText = `
    accent-color: ${C.green};
    width: 16px; height: 16px;
    cursor: pointer;
  `;
  cb.addEventListener('change', () => {
    const on = cb.checked;
    chip.style.background = on ? withAlpha(C.green, 0.15) : C.well;
    chip.style.borderColor = on ? C.green : C.border;
    chip.style.color = on ? C.green : C.textMuted;
    if (onChange) onChange(on);
  });
  chip.appendChild(cb);
  chip.appendChild(document.createTextNode(label));
  return { wrap: chip, input: cb };
}

// ─── Chip group ───────────────────────────────────────────────────
// options: [{ id, label }, ...]
// mode: 'multi' | 'single'
export function chipGroup({ options, selected = [], mode = 'multi', onChange = null }) {
  const wrap = document.createElement('div');
  wrap.style.cssText = 'display: flex; flex-wrap: wrap; gap: 8px;';
  const chips = {};
  const sel = new Set(selected);

  options.forEach(opt => {
    const { wrap: chip, input } = checkboxChip({
      label: opt.label,
      checked: sel.has(opt.id),
      onChange: (on) => {
        if (mode === 'single' && on) {
          Object.entries(chips).forEach(([id, ch]) => {
            if (id !== opt.id && ch.input.checked) {
              ch.input.checked = false;
              ch.input.dispatchEvent(new Event('change'));
            }
          });
          sel.clear();
          sel.add(opt.id);
        } else {
          if (on) sel.add(opt.id); else sel.delete(opt.id);
        }
        if (onChange) onChange(Array.from(sel));
      },
    });
    chips[opt.id] = { wrap: chip, input };
    wrap.appendChild(chip);
  });

  return {
    wrap,
    getSelected: () => Array.from(sel),
  };
}

// ─── Color picker ─────────────────────────────────────────────────
export function colorPicker({ colors, selected = null, onChange = null }) {
  const wrap = document.createElement('div');
  wrap.style.cssText = 'display: flex; flex-wrap: wrap; gap: 8px;';
  let current = selected;
  const swatches = [];

  const refresh = () => {
    swatches.forEach(s => {
      const on = s.dataset.color === current;
      s.style.boxShadow = on ? `0 0 0 2px ${C.text}, 0 0 0 4px ${C.bg}` : 'none';
      s.style.transform = on ? 'scale(1.1)' : '';
    });
  };

  colors.forEach(hex => {
    const sw = document.createElement('button');
    sw.type = 'button';
    sw.dataset.color = hex;
    sw.style.cssText = `
      width: 32px; height: 32px;
      border-radius: 6px;
      background: ${hex};
      border: none;
      cursor: pointer;
      transition: transform 0.1s ease, box-shadow 0.15s ease;
      padding: 0;
    `;
    sw.addEventListener('click', () => {
      current = hex;
      refresh();
      if (onChange) onChange(hex);
    });
    wrap.appendChild(sw);
    swatches.push(sw);
  });
  refresh();

  return { wrap, getSelected: () => current };
}

// ─── Button ───────────────────────────────────────────────────────
export function button({ label, variant = 'primary', onClick = null }) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.textContent = label;
  const styles = {
    primary:   `background: ${C.gold};    color: #1a1000;          border: none;`,
    secondary: `background: ${C.well};    color: ${C.text};        border: 1px solid ${C.border};`,
    danger:    `background: transparent;  color: ${C.verm};        border: 1px solid ${C.verm};`,
    ghost:     `background: transparent;  color: ${C.textMuted};   border: 1px solid ${C.border};`,
  };
  btn.style.cssText = `
    ${styles[variant] || styles.primary}
    border-radius: 999px;
    padding: 10px 22px;
    font-family: var(--font-heading);
    font-size: 12px;
    font-weight: 700;
    letter-spacing: 1.5px;
    text-transform: uppercase;
    cursor: pointer;
    transition: transform 0.1s ease, opacity 0.15s ease;
    white-space: nowrap;
  `;
  btn.addEventListener('mouseenter', () => { if (!btn.disabled) btn.style.transform = 'translateY(-1px)'; });
  btn.addEventListener('mouseleave', () => { btn.style.transform = ''; });
  if (onClick) btn.addEventListener('click', onClick);
  return btn;
}

// ─── Modal ────────────────────────────────────────────────────────
// Returns { overlay, body, close }. `content` is a DOM element or HTML string.
// `footer` is an array of button elements (or null).
export function openModal({ title = null, content = null, footer = null, width = 480 }) {
  ensureKeyframes();
  const overlay = document.createElement('div');
  overlay.style.cssText = `
    position: fixed; inset: 0;
    background: rgba(26, 29, 32, 0.8);
    z-index: 5000;
    display: flex; align-items: center; justify-content: center;
    animation: ov-fade-in 0.15s ease-out;
  `;

  const modal = document.createElement('div');
  modal.style.cssText = `
    background: ${C.card};
    border-radius: 12px;
    width: ${width}px; max-width: 92vw;
    max-height: 85vh;
    display: flex; flex-direction: column;
    overflow: hidden;
    box-shadow: 0 12px 40px rgba(0,0,0,0.5);
  `;

  if (title) {
    const hdr = document.createElement('div');
    hdr.style.cssText = `
      font-family: var(--font-heading);
      font-size: 20px;
      font-weight: 700;
      color: ${C.text};
      padding: 20px 24px;
      border-bottom: 1px solid ${C.well};
      letter-spacing: 0.5px;
    `;
    hdr.textContent = title;
    modal.appendChild(hdr);
  }

  const body = document.createElement('div');
  body.style.cssText = 'padding: 20px 24px; overflow-y: auto; flex: 1; display: flex; flex-direction: column; gap: 14px;';
  if (typeof content === 'string') body.innerHTML = content;
  else if (content) body.appendChild(content);
  modal.appendChild(body);

  if (footer && footer.length) {
    const f = document.createElement('div');
    f.style.cssText = `
      padding: 16px 24px;
      border-top: 1px solid ${C.well};
      display: flex; gap: 10px; justify-content: flex-end;
    `;
    footer.forEach(el => f.appendChild(el));
    modal.appendChild(f);
  }

  overlay.appendChild(modal);
  const close = () => overlay.remove();
  overlay.addEventListener('click', e => { if (e.target === overlay) close(); });
  // ESC to close
  const onKey = (e) => { if (e.key === 'Escape') { close(); document.removeEventListener('keydown', onKey); } };
  document.addEventListener('keydown', onKey);

  document.body.appendChild(overlay);
  return { overlay, body, close };
}