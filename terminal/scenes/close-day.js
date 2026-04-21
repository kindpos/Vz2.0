import { defineScene, SceneManager } from '../scene-manager.js';
import { T } from '../tokens.js';
import { buildPillButton } from '../theme-manager.js';

defineScene({
  name: 'close-day',
  render: function(container) {
    var root = document.createElement('div');
    root.style.cssText = 'width:100%;height:100%;display:flex;flex-direction:column;align-items:center;justify-content:center;background:' + T.bg + ';color:' + T.text + ';gap:30px;';

    var msg = document.createElement('div');
    msg.style.fontFamily = T.fh;
    msg.style.fontSize = T.fsH3;
    msg.textContent = 'Close Day — scene not yet built';
    root.appendChild(msg);

    var backBtn = buildPillButton({
      label: 'BACK',
      variant: 'verm',
      onClick: function() {
        SceneManager.closeTransactional('close-day');
      }
    });
    root.appendChild(backBtn);

    container.appendChild(root);

    return function cleanup() {
      // nothing to clean up in stub
    };
  }
});
