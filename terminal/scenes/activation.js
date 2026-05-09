/**
 * KINDpos Activation Scene
 * Shown on first boot when no active server license is bound to this machine.
 * Operator enters a KIND-XXXX-XXXX code; we read the server MAC from the
 * backend and POST to /api/v1/hardware/activate.
 */

import { T } from '../../common/tokens.js';
import { defineScene } from '../scene-manager.js';
import { buildStaticCard, buildPillButton } from '../theme-manager.js';
import { fetchWithTimeout } from '../net.js';

const CODE_ALPHABET = /^[A-Z0-9]$/;

// Format raw input as KIND-XXXX-XXXX. Strips KIND- prefix on the way in
// so paste-of-full-code and typing-from-scratch both behave the same.
function formatCode(raw) {
  let cleaned = (raw || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (cleaned.startsWith('KIND')) cleaned = cleaned.slice(4);
  cleaned = cleaned.slice(0, 8); // 4 + 4 body chars
  if (cleaned.length === 0) return '';
  if (cleaned.length <= 4) return `KIND-${cleaned}`;
  return `KIND-${cleaned.slice(0, 4)}-${cleaned.slice(4)}`;
}

function isComplete(formatted) {
  return /^KIND-[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(formatted);
}

export function defineActivationScene() {
  return defineScene({
    name: 'activation',
    render: (container, params, state) => {
      state._submitting = false;
      state._alive = true;

      const background = document.createElement('div');
      background.style.cssText = `
        position: absolute;
        top: 0; left: 0; right: 0; bottom: 0;
        background: ${T.bg};
        display: flex;
        align-items: center;
        justify-content: center;
        z-index: 0;
      `;

      const card = buildStaticCard();
      card.style.width = '480px';
      card.style.padding = '32px';

      const title = document.createElement('h1');
      title.textContent = 'KINDpos';
      title.style.cssText = `
        font-family: 'Outfit', sans-serif;
        font-weight: 700;
        font-size: 32px;
        margin: 0 0 6px 0;
        color: ${T.text};
        text-align: center;
        letter-spacing: 0.04em;
      `;
      card.appendChild(title);

      const subtitle = document.createElement('div');
      subtitle.textContent = 'Server Activation';
      subtitle.style.cssText = `
        font-family: 'JetBrains Mono', monospace;
        font-size: 12px;
        color: ${T.green};
        text-align: center;
        margin-bottom: 28px;
        letter-spacing: 0.18em;
        text-transform: uppercase;
      `;
      card.appendChild(subtitle);

      const codeLabel = document.createElement('label');
      codeLabel.textContent = 'Enter Activation Code';
      codeLabel.style.cssText = `
        display: block;
        margin-bottom: 8px;
        font-size: 12px;
        color: ${T.text};
        font-family: 'JetBrains Mono', monospace;
        font-weight: 600;
        letter-spacing: 0.06em;
        text-transform: uppercase;
      `;
      card.appendChild(codeLabel);

      const codeInput = document.createElement('input');
      codeInput.type = 'text';
      codeInput.placeholder = 'KIND-XXXX-XXXX';
      codeInput.autocomplete = 'off';
      codeInput.spellcheck = false;
      codeInput.maxLength = 14; // KIND-XXXX-XXXX
      codeInput.style.cssText = `
        width: 100%;
        padding: 16px;
        margin-bottom: 18px;
        border: 1px solid ${T.border};
        border-radius: 8px;
        background: ${T.well};
        color: ${T.text};
        font-family: 'JetBrains Mono', monospace;
        font-size: 18px;
        text-align: center;
        letter-spacing: 0.18em;
        box-sizing: border-box;
        outline: none;
        text-transform: uppercase;
      `;
      card.appendChild(codeInput);

      // Auto-format on every keystroke. Cursor jump is acceptable here —
      // operators read the field, they don't edit mid-string.
      codeInput.addEventListener('input', () => {
        codeInput.value = formatCode(codeInput.value);
        updateButtonState();
        clearError();
      });

      const errorEl = document.createElement('div');
      errorEl.style.cssText = `
        min-height: 22px;
        margin-bottom: 14px;
        padding: 0 4px;
        font-family: 'JetBrains Mono', monospace;
        font-size: 12px;
        color: ${T.verm};
        text-align: center;
      `;
      card.appendChild(errorEl);

      function clearError() { errorEl.textContent = ''; }
      function showError(msg) { errorEl.textContent = msg; }

      const activateBtn = buildPillButton('ACTIVATE');
      activateBtn.style.cssText = `
        width: 100%;
        padding: 16px 24px;
        background: ${T.green};
        color: ${T.well};
        border: none;
        border-radius: 999px;
        font-weight: 700;
        cursor: pointer;
        font-size: 16px;
        font-family: 'Outfit', sans-serif;
        letter-spacing: 0.12em;
        text-transform: uppercase;
      `;
      card.appendChild(activateBtn);

      function updateButtonState() {
        const ready = isComplete(codeInput.value) && !state._submitting;
        activateBtn.disabled = !ready;
        activateBtn.style.opacity = ready ? '1' : '0.45';
        activateBtn.style.cursor = ready ? 'pointer' : 'not-allowed';
      }
      updateButtonState();

      async function submit() {
        if (!state._alive || state._submitting) return;
        const code = codeInput.value.trim().toUpperCase();
        if (!isComplete(code)) {
          showError('Code must be KIND-XXXX-XXXX');
          return;
        }

        state._submitting = true;
        updateButtonState();
        clearError();
        activateBtn.textContent = 'ACTIVATING…';

        try {
          const macRes = await fetchWithTimeout('/api/v1/hardware/server-mac', {}, 8000);
          if (!state._alive) return;
          if (!macRes.ok) throw new Error(`Could not read server MAC (HTTP ${macRes.status})`);
          const macData = await macRes.json();
          const serverMac = (macData && macData.mac) ? macData.mac : '';

          const resp = await fetchWithTimeout('/api/v1/hardware/activate', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              activation_code: code,
              server_mac: serverMac,
              platform: 'pi',
            }),
          }, 10000);

          if (!state._alive) return;

          if (resp.ok) {
            activateBtn.textContent = 'ACTIVATED ✓';
            activateBtn.style.background = T.greenWarm;
            setTimeout(() => {
              if (state._alive) window.location.reload();
            }, 900);
            return;
          }

          let detail = `Activation failed (HTTP ${resp.status})`;
          try {
            const errBody = await resp.json();
            if (errBody && errBody.detail) detail = String(errBody.detail);
            else if (errBody && errBody.error) detail = String(errBody.error);
          } catch (_) { /* keep default */ }
          showError(detail);
        } catch (err) {
          if (!state._alive) return;
          showError(err && err.message ? err.message : 'Network error');
        } finally {
          if (state._alive) {
            state._submitting = false;
            activateBtn.textContent = 'ACTIVATE';
            updateButtonState();
          }
        }
      }

      activateBtn.addEventListener('click', submit);
      codeInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          submit();
        }
      });

      background.appendChild(card);
      container.appendChild(background);

      setTimeout(() => { if (state._alive) codeInput.focus(); }, 0);

      return () => {
        state._alive = false;
      };
    },

    unmount: () => {},
  });
}
