/**
 * KINDpos Activation Scene
 * Shown on first boot when no valid offline license file is bound to this
 * machine. The terminal is informational only — operators copy the hardware
 * ID and send it to KIND Technologies, who return a signed license file out
 * of band. No in-app activation.
 */

import { T } from '../../common/tokens.js';
import { defineScene } from '../scene-manager.js';
import { buildStaticCard } from '../theme-manager.js';
import { fetchWithTimeout } from '../net.js';

export function defineActivationScene() {
  return defineScene({
    name: 'activation',
    render: (container, params, state) => {
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
      card.style.width = '520px';
      card.style.padding = '36px';

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
      subtitle.textContent = 'TERMINAL UNLICENSED';
      subtitle.style.cssText = `
        font-family: 'JetBrains Mono', monospace;
        font-size: 12px;
        color: ${T.verm};
        text-align: center;
        margin-bottom: 32px;
        letter-spacing: 0.22em;
        text-transform: uppercase;
        font-weight: 600;
      `;
      card.appendChild(subtitle);

      const fpBlock = document.createElement('div');
      fpBlock.style.cssText = `
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 10px;
        margin-bottom: 28px;
        padding: 18px;
        border: 1px solid ${T.border};
        border-radius: 10px;
        background: ${T.well};
      `;

      const fpLabel = document.createElement('div');
      fpLabel.textContent = 'HARDWARE ID';
      fpLabel.style.cssText = `
        font-family: 'JetBrains Mono', monospace;
        font-size: 11px;
        color: ${T.moon};
        letter-spacing: 0.18em;
        text-transform: uppercase;
        font-weight: 600;
      `;
      fpBlock.appendChild(fpLabel);

      const fpValue = document.createElement('div');
      fpValue.textContent = 'Reading…';
      fpValue.style.cssText = `
        font-family: 'JetBrains Mono', monospace;
        font-size: 18px;
        color: ${T.gold};
        text-align: center;
        word-break: break-all;
        line-height: 1.4;
        -webkit-user-select: text;
        user-select: text;
        cursor: text;
      `;
      fpBlock.appendChild(fpValue);
      card.appendChild(fpBlock);

      const supportLine = document.createElement('div');
      supportLine.style.cssText = `
        font-family: 'JetBrains Mono', monospace;
        font-size: 12px;
        color: ${T.moon};
        text-align: center;
        line-height: 1.6;
        letter-spacing: 0.04em;
      `;
      const supportText = document.createTextNode(
        'Contact KIND Technologies to activate this terminal.'
      );
      const supportBreak = document.createElement('br');
      const supportEmail = document.createElement('span');
      supportEmail.textContent = 'support@kindpos.com';
      supportEmail.style.color = T.green;
      supportLine.appendChild(supportText);
      supportLine.appendChild(supportBreak);
      supportLine.appendChild(supportEmail);
      card.appendChild(supportLine);

      background.appendChild(card);
      container.appendChild(background);

      // Pull the hardware identifier. Prefer /fingerprint (canonical) and
      // fall back to /server-mac if the route isn't deployed yet. Whatever
      // string the backend returns is what operators read aloud.
      function extractId(body) {
        if (!body || typeof body !== 'object') return null;
        return (
          body.fingerprint
          || body.hardware_fingerprint
          || body.server_mac
          || body.mac
          || body.id
          || null
        );
      }

      async function loadHardwareId() {
        const endpoints = [
          '/api/v1/hardware/fingerprint',
          '/api/v1/hardware/server-mac',
        ];
        for (const url of endpoints) {
          try {
            const resp = await fetchWithTimeout(url, {}, 6000);
            if (!state._alive) return;
            if (resp.status === 404) continue;
            if (!resp.ok) continue;
            let body = null;
            try { body = await resp.json(); } catch (_) { /* non-JSON */ }
            const id = extractId(body);
            if (id) {
              if (!state._alive) return;
              fpValue.textContent = id;
              return;
            }
          } catch (_) {
            // try next endpoint
          }
        }
        if (!state._alive) return;
        fpValue.textContent = 'Unable to read hardware ID';
        fpValue.style.color = T.verm;
      }

      loadHardwareId();

      return () => {
        state._alive = false;
      };
    },

    unmount: () => {},
  });
}
