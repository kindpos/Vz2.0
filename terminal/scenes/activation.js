/**
 * KINDpos Activation Scene
 * Shown on first boot when no license certificate exists.
 * Collects activation code, store name, and terminal name.
 */

import { T } from '../../common/tokens.js';
import { defineScene } from '../scene-manager.js';
import { buildStaticCard, buildPillButton } from '../theme-manager.js';
import { fetchWithTimeout } from '../net.js';

export function defineActivationScene() {
  return defineScene({
    name: 'activation',
    render: (container, params, state) => {
      state._submitting = false;
      state._alive = true;

      // Full-screen background
      const background = document.createElement('div');
      background.style.cssText = `
        position: absolute;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        background: ${T.bg};
        display: flex;
        align-items: center;
        justify-content: center;
        z-index: 0;
      `;

      // Form card (using Nostalgia card style)
      const card = buildStaticCard();
      card.style.width = '500px';
      card.style.padding = '24px';

      // Title heading
      const title = document.createElement('h1');
      title.textContent = 'KINDpos Activation';
      title.style.cssText = `
        font-family: 'Outfit', sans-serif;
        font-weight: 700;
        font-size: 28px;
        margin: 0 0 24px 0;
        color: ${T.text};
      `;
      card.appendChild(title);

      // --- Activation Code Input ---
      const codeLabel = document.createElement('label');
      codeLabel.textContent = 'Activation Code';
      codeLabel.style.cssText = `
        display: block;
        margin-bottom: 8px;
        font-size: 13px;
        color: ${T.text};
        font-family: 'JetBrains Mono', monospace;
        font-weight: 600;
      `;
      card.appendChild(codeLabel);

      const codeInput = document.createElement('input');
      codeInput.type = 'text';
      codeInput.placeholder = 'SMYS-001-XXXX-XXXX-XXXX';
      codeInput.style.cssText = `
        width: 100%;
        padding: 16px;
        margin-bottom: 16px;
        border: 1px solid ${T.border};
        border-radius: 8px;
        background: ${T.card};
        color: ${T.text};
        font-family: 'JetBrains Mono', monospace;
        font-size: 14px;
        box-sizing: border-box;
      `;
      card.appendChild(codeInput);

      // --- Store Name Input ---
      const storeLabel = document.createElement('label');
      storeLabel.textContent = 'Store Name';
      storeLabel.style.cssText = `
        display: block;
        margin-bottom: 8px;
        font-size: 13px;
        color: ${T.text};
        font-family: 'JetBrains Mono', monospace;
        font-weight: 600;
      `;
      card.appendChild(storeLabel);

      const storeInput = document.createElement('input');
      storeInput.type = 'text';
      storeInput.placeholder = 'e.g. Smile Yeshiva Springs';
      storeInput.style.cssText = `
        width: 100%;
        padding: 16px;
        margin-bottom: 16px;
        border: 1px solid ${T.border};
        border-radius: 8px;
        background: ${T.card};
        color: ${T.text};
        font-family: 'JetBrains Mono', monospace;
        font-size: 14px;
        box-sizing: border-box;
      `;
      card.appendChild(storeInput);

      // --- Terminal Name Input ---
      const terminalLabel = document.createElement('label');
      terminalLabel.textContent = 'Terminal Name';
      terminalLabel.style.cssText = `
        display: block;
        margin-bottom: 8px;
        font-size: 13px;
        color: ${T.text};
        font-family: 'JetBrains Mono', monospace;
        font-weight: 600;
      `;
      card.appendChild(terminalLabel);

      const terminalInput = document.createElement('input');
      terminalInput.type = 'text';
      terminalInput.placeholder = 'e.g. Register-1';
      terminalInput.style.cssText = `
        width: 100%;
        padding: 16px;
        margin-bottom: 24px;
        border: 1px solid ${T.border};
        border-radius: 8px;
        background: ${T.card};
        color: ${T.text};
        font-family: 'JetBrains Mono', monospace;
        font-size: 14px;
        box-sizing: border-box;
      `;
      card.appendChild(terminalInput);

      // --- Status Text Area ---
      const statusText = document.createElement('div');
      statusText.style.cssText = `
        margin-bottom: 16px;
        padding: 16px;
        border-radius: 8px;
        min-height: 40px;
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 13px;
        color: ${T.text};
        text-align: center;
        font-family: 'JetBrains Mono', monospace;
      `;
      card.appendChild(statusText);

      // --- Activate Button (green pill) ---
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
      `;

      card.appendChild(activateBtn);

      // --- Click handler ---
      activateBtn.addEventListener('click', async () => {
        if (!state._alive) return;
        if (state._submitting) return;

        const code = codeInput.value.trim().toUpperCase();
        const store = storeInput.value.trim();
        const terminal = terminalInput.value.trim();

        if (!code || !store || !terminal) {
          statusText.style.backgroundColor = T.verm;
          statusText.style.color = 'white';
          statusText.textContent = 'All fields required';
          return;
        }

        state._submitting = true;
        statusText.style.backgroundColor = 'transparent';
        statusText.style.color = T.text;
        statusText.textContent = 'Activating...';
        activateBtn.disabled = true;

        try {
          const resp = await fetchWithTimeout('/api/v1/licenses/activate', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              license_key: code,
              store_name: store,
              terminal_name: terminal
            })
          }, 10000);

          if (!state._alive) return;

          if (resp.ok) {
            await resp.json();
            statusText.style.backgroundColor = 'transparent';
            statusText.style.color = T.text;
            statusText.textContent = 'Activation successful! Rebooting...';
            setTimeout(() => {
              if (state._alive) window.location.reload();
            }, 1500);
          } else {
            const error = await resp.json();
            statusText.style.backgroundColor = T.verm;
            statusText.style.color = 'white';
            statusText.textContent = error.error || 'Activation failed';
            state._submitting = false;
            activateBtn.disabled = false;
          }
        } catch (err) {
          if (!state._alive) return;
          statusText.style.backgroundColor = T.verm;
          statusText.style.color = 'white';
          statusText.textContent = err.message || 'Network error';
          state._submitting = false;
          activateBtn.disabled = false;
        }
      });

      background.appendChild(card);
      container.appendChild(background);

      // Cleanup function
      return () => {
        state._alive = false;
      };
    },

    unmount: () => {}
  });
}
