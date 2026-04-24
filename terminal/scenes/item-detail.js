// terminal/scenes/item-detail.js
// Read-only view of item modifiers. (UI-023)

import { SceneManager, defineScene } from '../scene-manager.js';
import { T } from '../../common/tokens.js';
import { buildPillButton, hexToRgba } from '../theme-manager.js';

defineScene({
  name: 'item-detail',

  render: function(container, params) {
    var inst = params.item;
    if (!inst) return;

    container.style.cssText = 'position:absolute;inset:0;background:' + T.bg + ';display:flex;flex-direction:column;padding:8px 20px 20px;';

    var title = document.createElement('div');
    title.style.cssText = 'font-family:' + T.fh + ';font-size:24px;font-weight:bold;color:' + T.text + ';margin-bottom:4px;';
    title.textContent = inst.name;
    container.appendChild(title);

    var price = document.createElement('div');
    price.style.cssText = 'font-family:' + T.fb + ';font-size:18px;color:' + T.gold + ';margin-bottom:20px;';
    var total = inst.unitPrice + (inst.mods || []).reduce(function(s, m) { return s + m.price; }, 0);
    price.textContent = '$' + total.toFixed(2);
    container.appendChild(price);

    var modScroll = document.createElement('div');
    modScroll.style.cssText = 'flex:1;overflow-y:auto;';
    container.appendChild(modScroll);

    if (!inst.mods || inst.mods.length === 0) {
      var none = document.createElement('div');
      none.style.cssText = 'font-family:' + T.fh + ';font-size:14px;color:' + hexToRgba(T.text, 0.6) + ';font-style:italic;';
      none.textContent = 'No modifiers';
      modScroll.appendChild(none);
    } else {
      inst.mods.forEach(function(m) {
        var row = document.createElement('div');
        row.style.cssText = 'display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid ' + T.border + ';';
        
        var name = document.createElement('span');
        name.style.cssText = 'font-family:' + T.fb + ';font-size:16px;color:' + T.text + ';';
        name.textContent = (m.prefix ? m.prefix + ' ' : '') + m.name;
        
        var val = document.createElement('span');
        val.style.cssText = 'font-family:' + T.fb + ';font-size:16px;color:' + T.green + ';';
        val.textContent = m.price > 0 ? '+$' + m.price.toFixed(2) : '';
        
        row.appendChild(name);
        row.appendChild(val);
        modScroll.appendChild(row);

        if (m.children && m.children.length > 0) {
          m.children.forEach(function(child) {
            var crow = document.createElement('div');
            crow.style.cssText = 'display:flex;justify-content:space-between;padding:4px 0 4px 20px;';
            var cname = document.createElement('span');
            cname.style.cssText = 'font-family:' + T.fb + ';font-size:14px;color:' + T.verm + ';font-style:italic;';
            cname.textContent = child.name;
            crow.appendChild(cname);
            modScroll.appendChild(crow);
          });
        }
      });
    }

    var footer = document.createElement('div');
    footer.style.cssText = 'padding-top:20px;display:flex;justify-content:center;pointer-events:auto;';
    var closeBtn = buildPillButton({
      label: 'DONE',
      variant: 'goGreen',
      onClick: function() { SceneManager.closeTransactional('item-detail'); }
    });
    footer.appendChild(closeBtn);
    container.appendChild(footer);

    return function cleanup() {};
  }
});
