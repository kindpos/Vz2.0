// ═══════════════════════════════════════════════════
//  KINDpos Terminal — Shared Interrupts  (Vz2.0)
//  Standalone interrupt scenes usable from any context.
//
//  Scenes defined here:
//    manager-pin  — PIN entry, context-aware (discount/void/default)
//    disc-select  — Discount picker after manager approval
//    void-reason  — Void reason picker after manager approval
//
//  Nice. Dependable. Yours.
// ═══════════════════════════════════════════════════

import { defineScene, SceneManager } from '../scene-manager.js';
import { T } from '../../common/tokens.js';
import { lightenHex, darkenHex } from '../theme-manager.js';
import { fetchWithTimeout } from '../net.js';
import { showToast } from '../components.js';

// ═══════════════════════════════════════════════════
//  1. manager-pin
//     Params: { context: 'discount'|'void'|undefined,
//               onConfirm(employeeId), onCancel() }
// ═══════════════════════════════════════════════════

defineScene('manager-pin', {
  mount: function(container, params) {
    params = params || {};

    var ctx         = params.context;
    var accentColor = ctx === 'discount' ? T.lavender
                    : ctx === 'void'     ? T.verm
                    :                      T.green;
    var titleText   = ctx === 'discount' ? 'APPLY DISCOUNT'
                    : ctx === 'void'     ? 'VOID ITEM'
                    :                      'MANAGER PIN';

    var alive      = true;
    var pinBuf     = '';
    var pinError   = false;
    var submitting = false;

    container.style.cssText = [
      'width:100%;height:100%;',
      'display:flex;flex-direction:column;',
      'align-items:center;justify-content:center;',
      'gap:12px;',
    ].join('');

    // ── Modal card ──
    var modal = document.createElement('div');
    modal.style.cssText = [
      'width:360px;',
      'background:' + T.card + ';',
      'border-radius:' + T.chamferCard + 'px;',
      'overflow:hidden;',
      'display:flex;flex-direction:column;align-items:stretch;',
    ].join('');

    // Top accent bar
    var accentBar = document.createElement('div');
    accentBar.style.cssText = [
      'width:100%;height:4px;',
      'background:' + accentColor + ';',
      'flex-shrink:0;',
    ].join('');
    modal.appendChild(accentBar);

    // Inner content wrapper
    var inner = document.createElement('div');
    inner.style.cssText = [
      'display:flex;flex-direction:column;align-items:center;',
      'gap:14px;',
      'padding:16px 20px 24px;',
      'box-sizing:border-box;',
    ].join('');

    // Title
    var title = document.createElement('div');
    title.style.cssText = [
      'font-family:' + T.fh + ';',
      'font-size:18px;',
      'font-weight:' + T.fwBold + ';',
      'color:' + accentColor + ';',
      'text-align:center;',
      'letter-spacing:1px;',
      'text-transform:uppercase;',
    ].join('');
    title.textContent = titleText;
    inner.appendChild(title);

    // Subtitle
    var subtitle = document.createElement('div');
    subtitle.style.cssText = [
      'font-family:' + T.fb + ';',
      'font-size:11px;',
      'font-weight:' + T.fwBold + ';',
      'color:' + T.moon + ';',
      'text-align:center;',
      'margin-top:-8px;',
    ].join('');
    subtitle.textContent = 'Manager PIN required';
    inner.appendChild(subtitle);

    // PIN dot trough
    var trough = document.createElement('div');
    trough.style.cssText = [
      'display:flex;flex-direction:row;align-items:center;justify-content:center;',
      'gap:12px;',
      'background:' + T.well + ';',
      'border-radius:8px;',
      'padding:10px 20px;',
      'width:100%;box-sizing:border-box;',
    ].join('');

    var dots = [];
    for (var di = 0; di < 4; di++) {
      var dot = document.createElement('div');
      dot.style.cssText = [
        'width:16px;height:16px;',
        'border-radius:50%;',
        'background:' + T.bg + ';',
        'border:1.5px solid ' + T.border + ';',
        'transition:background 0.1s,border-color 0.1s;',
        'flex-shrink:0;',
      ].join('');
      trough.appendChild(dot);
      dots.push(dot);
    }
    inner.appendChild(trough);

    function updateDots() {
      for (var i = 0; i < 4; i++) {
        if (pinError) {
          dots[i].style.background   = T.verm;
          dots[i].style.borderColor  = T.verm;
        } else if (i < pinBuf.length) {
          dots[i].style.background   = T.green;
          dots[i].style.borderColor  = T.green;
        } else {
          dots[i].style.background   = T.bg;
          dots[i].style.borderColor  = T.border;
        }
      }
    }

    // Numpad chassis
    var bevelLt = lightenHex(T.bg, 0.08);
    var bevelDk = darkenHex(T.bg, 0.2);

    var chassis = document.createElement('div');
    chassis.style.cssText = [
      'background:' + T.well + ';',
      'border-radius:' + T.chamferWell + 'px;',
      'padding:10px;',
      'display:grid;',
      'grid-template-columns:repeat(3,1fr);',
      'gap:8px;',
      'width:100%;box-sizing:border-box;',
    ].join('');

    var keyRows = [
      ['7', '8', '9'],
      ['4', '5', '6'],
      ['1', '2', '3'],
      ['CLR', '0', 'ENT'],
    ];

    keyRows.forEach(function(row) {
      row.forEach(function(k) {
        var key = document.createElement('div');
        key.dataset.key = k;
        var shadowDk;

        if (k === 'CLR') {
          shadowDk = T.vermDk;
          key.style.cssText = [
            'min-height:56px;',
            'border-radius:' + T.chamferKey + 'px;',
            'background:' + T.verm + ';',
            'display:flex;align-items:center;justify-content:center;',
            'cursor:pointer;pointer-events:auto;touch-action:manipulation;',
            'box-shadow:0 3px 0 ' + shadowDk + ';',
            'transition:transform 0.07s,box-shadow 0.07s;',
          ].join('');
          var lbl = document.createElement('span');
          lbl.style.cssText = [
            'font-family:' + T.fb + ';font-size:' + T.fsB3 + ';',
            'font-weight:' + T.fwBold + ';color:#fff;pointer-events:none;',
          ].join('');
          lbl.textContent = 'CLR';
          key.appendChild(lbl);

        } else if (k === 'ENT') {
          shadowDk = T.greenWarmDk;
          key.style.cssText = [
            'min-height:56px;',
            'border-radius:' + T.chamferKey + 'px;',
            'background:' + T.greenWarm + ';',
            'display:flex;align-items:center;justify-content:center;',
            'cursor:pointer;pointer-events:auto;touch-action:manipulation;',
            'box-shadow:0 3px 0 ' + shadowDk + ';',
            'transition:transform 0.07s,box-shadow 0.07s;',
          ].join('');
          var lbl = document.createElement('span');
          lbl.style.cssText = [
            'font-family:' + T.fb + ';font-size:' + T.fsB3 + ';',
            'font-weight:' + T.fwBold + ';color:' + T.moonText + ';pointer-events:none;',
          ].join('');
          lbl.textContent = 'ENT';
          key.appendChild(lbl);

        } else {
          shadowDk = darkenHex(T.green, 0.35);
          key.style.cssText = [
            'min-height:56px;',
            'border-radius:' + T.chamferKey + 'px;',
            'background:' + T.green + ';',
            'border-top:2px solid ' + bevelLt + ';',
            'border-bottom:2px solid ' + bevelDk + ';',
            'display:flex;align-items:center;justify-content:center;',
            'cursor:pointer;pointer-events:auto;touch-action:manipulation;',
            'box-shadow:0 3px 0 ' + shadowDk + ';',
            'transition:transform 0.07s,box-shadow 0.07s;',
          ].join('');
          var lbl = document.createElement('span');
          lbl.style.cssText = [
            'font-family:' + T.fh + ';font-size:24px;',
            'font-weight:800;color:' + T.moonText + ';pointer-events:none;',
          ].join('');
          lbl.textContent = k;
          key.appendChild(lbl);
        }

        // Press animation (IIFE captures shadowDk per key)
        ;(function(sd) {
          key.addEventListener('pointerdown', function() {
            key.style.transform = 'translateY(2px)';
            key.style.boxShadow = '0 1px 0 ' + sd;
          });
          var release = function() {
            key.style.transform = '';
            key.style.boxShadow = '0 3px 0 ' + sd;
          };
          key.addEventListener('pointerup',     release);
          key.addEventListener('pointerleave',  release);
          key.addEventListener('pointercancel', release);
        })(shadowDk);

        chassis.appendChild(key);
      });
    });

    // Tap delegation on chassis
    chassis.addEventListener('pointerup', function(e) {
      var target = e.target;
      var key = null;
      while (target && target !== chassis) {
        if (target.dataset && target.dataset.key) { key = target; break; }
        target = target.parentElement;
      }
      if (!key) return;
      var k = key.dataset.key;

      if (k === 'CLR') {
        pinBuf   = '';
        pinError = false;
        updateDots();
        return;
      }

      if (k === 'ENT') {
        if (submitting || !pinBuf) return;
        submitting = true;
        chassis.style.pointerEvents = 'none';

        fetchWithTimeout('/api/v1/auth/verify-pin', {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify({ pin: pinBuf }),
        }, 10000)
          .then(function(r) { return r.json(); })
          .then(function(data) {
            if (!alive) return;
            if (data.valid && (data.roles || []).indexOf('manager') !== -1) {
              var empId = data.employee_id || pinBuf;
              SceneManager.resolveInterrupt('manager-pin');
              if (params.onConfirm) params.onConfirm(empId);
            } else {
              _flashError();
            }
          })
          .catch(function() {
            if (!alive) return;
            _flashError();
          });
        return;
      }

      // Digit
      if (pinBuf.length < 4) {
        pinBuf += k;
        updateDots();
      }
    });

    function _flashError() {
      pinError = true;
      updateDots();
      setTimeout(function() {
        if (!alive) return;
        pinError   = false;
        pinBuf     = '';
        submitting = false;
        chassis.style.pointerEvents = 'auto';
        updateDots();
      }, 600);
    }

    inner.appendChild(chassis);
    modal.appendChild(inner);
    container.appendChild(modal);

    // Cancel link — below the modal card
    var cancelLink = document.createElement('div');
    cancelLink.style.cssText = [
      'font-family:' + T.fb + ';',
      'font-size:11px;',
      'font-weight:' + T.fwBold + ';',
      'color:' + T.moon + ';',
      'text-align:center;',
      'cursor:pointer;pointer-events:auto;touch-action:manipulation;',
    ].join('');
    cancelLink.textContent = 'cancel';
    cancelLink.addEventListener('pointerup', function() {
      if (params.onCancel) params.onCancel();
    });
    container.appendChild(cancelLink);

    updateDots();

    return function() { alive = false; };
  },

  unmount: function() {},
});

// ═══════════════════════════════════════════════════
//  2. disc-select
//     Params: { approvedBy: string,
//               onConfirm({ id, name, pct }), onCancel() }
// ═══════════════════════════════════════════════════

defineScene('disc-select', {
  mount: function(container, params) {
    params = params || {};

    var alive            = true;
    var selectedDiscount = null;

    container.style.cssText = [
      'width:100%;height:100%;',
      'display:flex;flex-direction:column;',
      'align-items:center;justify-content:center;',
    ].join('');

    // ── Modal card ──
    var modal = document.createElement('div');
    modal.style.cssText = [
      'width:360px;',
      'background:' + T.card + ';',
      'border-radius:' + T.chamferCard + 'px;',
      'overflow:hidden;',
      'display:flex;flex-direction:column;align-items:stretch;',
    ].join('');

    // Top accent bar
    var accentBar = document.createElement('div');
    accentBar.style.cssText = 'width:100%;height:4px;background:' + T.lavender + ';flex-shrink:0;';
    modal.appendChild(accentBar);

    // Inner
    var inner = document.createElement('div');
    inner.style.cssText = [
      'display:flex;flex-direction:column;align-items:stretch;',
      'gap:12px;',
      'padding:16px 20px 20px;',
      'box-sizing:border-box;',
    ].join('');

    // Title
    var title = document.createElement('div');
    title.style.cssText = [
      'font-family:' + T.fh + ';',
      'font-size:18px;',
      'font-weight:' + T.fwBold + ';',
      'color:' + T.lavender + ';',
      'text-align:center;',
      'letter-spacing:1px;',
      'text-transform:uppercase;',
    ].join('');
    title.textContent = 'APPLY DISCOUNT';
    inner.appendChild(title);

    // Approved badge
    var badge = document.createElement('div');
    badge.style.cssText = [
      'display:flex;flex-direction:row;align-items:center;justify-content:center;',
      'gap:6px;',
      'background:' + T.well + ';',
      'border-radius:6px;',
      'padding:5px 10px;',
      'align-self:center;',
    ].join('');
    var badgeDot = document.createElement('div');
    badgeDot.style.cssText = [
      'width:6px;height:6px;border-radius:50%;',
      'background:' + T.green + ';',
      'flex-shrink:0;',
    ].join('');
    var badgeText = document.createElement('span');
    badgeText.style.cssText = [
      'font-family:' + T.fb + ';font-size:11px;',
      'font-weight:' + T.fwBold + ';color:' + T.green + ';',
    ].join('');
    badgeText.textContent = 'Approved · ' + (params.approvedBy || '');
    badge.appendChild(badgeDot);
    badge.appendChild(badgeText);
    inner.appendChild(badge);

    // Tile grid (populated after fetch)
    var tileGrid = document.createElement('div');
    tileGrid.style.cssText = [
      'display:grid;',
      'grid-template-columns:1fr 1fr;',
      'gap:8px;',
    ].join('');
    inner.appendChild(tileGrid);

    // APPLY button
    var applyBtn = document.createElement('div');
    applyBtn.style.cssText = [
      'width:100%;border-radius:8px;',
      'padding:12px 10px;',
      'box-sizing:border-box;',
      'text-align:center;',
      'cursor:pointer;pointer-events:auto;touch-action:manipulation;',
      'font-family:' + T.fb + ';font-size:' + T.fsB3 + ';',
      'font-weight:' + T.fwBold + ';',
      'background:' + T.well + ';',
      'border:1px solid ' + T.border + ';',
      'color:' + T.moon + ';',
      'transition:background 0.1s,color 0.1s;',
    ].join('');
    applyBtn.textContent = 'SELECT A DISCOUNT';
    inner.appendChild(applyBtn);

    // Cancel link
    var cancelLink = document.createElement('div');
    cancelLink.style.cssText = [
      'text-align:center;',
      'font-family:' + T.fb + ';font-size:11px;',
      'font-weight:' + T.fwBold + ';color:' + T.moon + ';',
      'cursor:pointer;pointer-events:auto;touch-action:manipulation;',
      'margin-top:2px;',
    ].join('');
    cancelLink.textContent = 'cancel';
    cancelLink.addEventListener('pointerup', function() {
      SceneManager.resolveInterrupt('disc-select');
      if (params.onCancel) params.onCancel();
    });
    inner.appendChild(cancelLink);

    modal.appendChild(inner);
    container.appendChild(modal);

    function _updateApplyBtn() {
      if (selectedDiscount) {
        applyBtn.style.background   = T.lavender;
        applyBtn.style.border       = '1px solid ' + T.lavender;
        applyBtn.style.color        = T.moonText;
        applyBtn.textContent        = 'APPLY  ' + selectedDiscount.name + '  ' + selectedDiscount.pct + '%';
      } else {
        applyBtn.style.background   = T.well;
        applyBtn.style.border       = '1px solid ' + T.border;
        applyBtn.style.color        = T.moon;
        applyBtn.textContent        = 'SELECT A DISCOUNT';
      }
    }

    function _buildTiles(discounts) {
      tileGrid.innerHTML = '';
      discounts.forEach(function(disc) {
        var tile = document.createElement('div');
        tile.style.cssText = [
          'border-radius:8px;',
          'padding:10px;',
          'cursor:pointer;pointer-events:auto;touch-action:manipulation;',
          'display:flex;flex-direction:column;gap:4px;',
          'background:' + T.well + ';',
          'border:1px solid ' + T.border + ';',
          'transition:background 0.1s,border-color 0.1s;',
        ].join('');

        var namEl = document.createElement('div');
        namEl.style.cssText = [
          'font-family:' + T.fb + ';font-size:' + T.fsB3 + ';',
          'font-weight:' + T.fwBold + ';color:' + T.text + ';',
        ].join('');
        namEl.textContent = disc.name;

        var pctEl = document.createElement('div');
        pctEl.style.cssText = [
          'font-family:' + T.fb + ';font-size:' + T.fsB3 + ';',
          'font-weight:' + T.fwBold + ';color:' + T.lavender + ';',
        ].join('');
        pctEl.textContent = disc.pct + '% off';

        tile.appendChild(namEl);
        tile.appendChild(pctEl);

        tile.addEventListener('pointerup', function() {
          selectedDiscount = disc;
          // Update all tiles
          var tiles = tileGrid.querySelectorAll('[data-disc-tile]');
          for (var ti = 0; ti < tiles.length; ti++) {
            var t = tiles[ti];
            var isSelected = t === tile;
            t.style.background   = isSelected ? T.lavender : T.well;
            t.style.borderColor  = isSelected ? T.lavender : T.border;
            t.querySelector('[data-disc-name]').style.color = isSelected ? T.moonText : T.text;
            t.querySelector('[data-disc-pct]').style.color  = isSelected ? T.moonText : T.lavender;
          }
          _updateApplyBtn();
        });

        tile.dataset.discTile = '1';
        namEl.dataset.discName = '1';
        pctEl.dataset.discPct  = '1';
        tileGrid.appendChild(tile);
      });
    }

    applyBtn.addEventListener('pointerup', function() {
      if (!selectedDiscount) return;
      var disc = selectedDiscount;
      SceneManager.resolveInterrupt('disc-select');
      if (params.onConfirm) params.onConfirm(disc);
    });

    // Show loading state
    var loadingEl = document.createElement('div');
    loadingEl.style.cssText = [
      'text-align:center;',
      'font-family:' + T.fb + ';font-size:' + T.fsB3 + ';',
      'font-weight:' + T.fwBold + ';color:' + T.moon + ';',
      'padding:12px 0;',
    ].join('');
    loadingEl.textContent = 'Loading…';
    tileGrid.appendChild(loadingEl);

    // Fetch discounts
    fetchWithTimeout('/api/v1/discounts', {}, 10000)
      .then(function(r) { return r.json(); })
      .then(function(data) {
        if (!alive) return;
        var list = Array.isArray(data) ? data : (data.discounts || data.items || []);
        var normalized = list.map(function(d) {
          return {
            id:   d.id   || d.discount_id || d.name || '',
            name: d.name || d.label || d.title || '',
            pct:  d.pct  || d.percent || d.percentage || d.rate || 0,
          };
        });
        if (normalized.length === 0) {
          showToast('No discounts available');
          SceneManager.resolveInterrupt('disc-select');
          if (params.onCancel) params.onCancel();
          return;
        }
        _buildTiles(normalized);
      })
      .catch(function() {
        if (!alive) return;
        showToast('Could not load discounts');
        SceneManager.resolveInterrupt('disc-select');
        if (params.onCancel) params.onCancel();
      });

    return function() { alive = false; };
  },

  unmount: function() {},
});

// ═══════════════════════════════════════════════════
//  3. void-reason
//     Params: { item: { name, price }, approvedBy: string,
//               onConfirm(reason: string), onCancel() }
// ═══════════════════════════════════════════════════

var VOID_REASONS = [
  'Customer Changed Mind',
  'Entered in Error',
  'Kitchen Error',
  'Comp / Courtesy',
];

defineScene('void-reason', {
  mount: function(container, params) {
    params = params || {};

    var item           = params.item || {};
    var alive          = true;
    var selectedReason = null;

    container.style.cssText = [
      'width:100%;height:100%;',
      'display:flex;flex-direction:column;',
      'align-items:center;justify-content:center;',
    ].join('');

    // ── Modal card ──
    var modal = document.createElement('div');
    modal.style.cssText = [
      'width:360px;',
      'background:' + T.card + ';',
      'border-radius:' + T.chamferCard + 'px;',
      'overflow:hidden;',
      'display:flex;flex-direction:column;align-items:stretch;',
      'border:1px solid ' + T.verm + ';',
    ].join('');

    // Top accent bar
    var accentBar = document.createElement('div');
    accentBar.style.cssText = 'width:100%;height:4px;background:' + T.verm + ';flex-shrink:0;';
    modal.appendChild(accentBar);

    // Inner
    var inner = document.createElement('div');
    inner.style.cssText = [
      'display:flex;flex-direction:column;align-items:stretch;',
      'gap:12px;',
      'padding:16px 20px 20px;',
      'box-sizing:border-box;',
    ].join('');

    // Title
    var title = document.createElement('div');
    title.style.cssText = [
      'font-family:' + T.fh + ';',
      'font-size:18px;',
      'font-weight:' + T.fwBold + ';',
      'color:' + T.verm + ';',
      'text-align:center;',
      'letter-spacing:1px;',
      'text-transform:uppercase;',
    ].join('');
    title.textContent = 'VOID ITEM';
    inner.appendChild(title);

    // Approved badge
    var badge = document.createElement('div');
    badge.style.cssText = [
      'display:flex;flex-direction:row;align-items:center;justify-content:center;',
      'gap:6px;',
      'background:' + T.well + ';',
      'border-radius:6px;',
      'padding:5px 10px;',
      'align-self:center;',
    ].join('');
    var badgeDot = document.createElement('div');
    badgeDot.style.cssText = [
      'width:6px;height:6px;border-radius:50%;',
      'background:' + T.green + ';flex-shrink:0;',
    ].join('');
    var badgeText = document.createElement('span');
    badgeText.style.cssText = [
      'font-family:' + T.fb + ';font-size:11px;',
      'font-weight:' + T.fwBold + ';color:' + T.green + ';',
    ].join('');
    badgeText.textContent = 'Approved · ' + (params.approvedBy || '');
    badge.appendChild(badgeDot);
    badge.appendChild(badgeText);
    inner.appendChild(badge);

    // Item card
    var itemCard = document.createElement('div');
    itemCard.style.cssText = [
      'background:' + T.well + ';',
      'border:1px solid ' + T.verm + ';',
      'border-left:3px solid ' + T.verm + ';',
      'border-radius:8px;',
      'padding:6px 10px;',
      'display:flex;flex-direction:row;align-items:center;justify-content:space-between;',
    ].join('');
    var itemName = document.createElement('span');
    itemName.style.cssText = [
      'font-family:' + T.fb + ';font-size:' + T.fsB3 + ';',
      'font-weight:' + T.fwBold + ';color:' + T.text + ';',
      'flex:1;min-width:0;',
    ].join('');
    itemName.textContent = item.name || '';
    var itemPrice = document.createElement('span');
    itemPrice.style.cssText = [
      'font-family:' + T.fb + ';font-size:' + T.fsB3 + ';',
      'font-weight:' + T.fwBold + ';color:' + T.gold + ';',
      'flex-shrink:0;margin-left:10px;',
    ].join('');
    var priceNum = typeof item.price === 'number' ? item.price : parseFloat(item.price) || 0;
    itemPrice.textContent = '$' + priceNum.toFixed(2);
    itemCard.appendChild(itemName);
    itemCard.appendChild(itemPrice);
    inner.appendChild(itemCard);

    // Reason tiles
    var tileCol = document.createElement('div');
    tileCol.style.cssText = 'display:flex;flex-direction:column;gap:8px;';

    var tilePtrs = [];

    VOID_REASONS.forEach(function(reason) {
      var tile = document.createElement('div');
      tile.style.cssText = [
        'width:100%;',
        'border-radius:8px;',
        'padding:10px 12px;',
        'box-sizing:border-box;',
        'cursor:pointer;pointer-events:auto;touch-action:manipulation;',
        'font-family:' + T.fb + ';font-size:' + T.fsB3 + ';',
        'font-weight:' + T.fwBold + ';',
        'color:' + T.text + ';',
        'background:' + T.well + ';',
        'border:1px solid ' + T.border + ';',
        'transition:background 0.1s,color 0.1s,border-color 0.1s;',
      ].join('');
      tile.textContent = reason;
      tile.dataset.reason = reason;

      tile.addEventListener('pointerup', function() {
        selectedReason = reason;
        tilePtrs.forEach(function(t) {
          var isSel = t.dataset.reason === reason;
          t.style.background   = isSel ? T.verm    : T.well;
          t.style.color        = isSel ? '#fff'    : T.text;
          t.style.borderColor  = isSel ? T.verm    : T.border;
        });
        _updateVoidBtn();
      });

      tileCol.appendChild(tile);
      tilePtrs.push(tile);
    });
    inner.appendChild(tileCol);

    // VOID button
    var voidBtn = document.createElement('div');
    voidBtn.style.cssText = [
      'width:100%;border-radius:8px;',
      'padding:12px 10px;',
      'box-sizing:border-box;',
      'text-align:center;',
      'cursor:pointer;pointer-events:auto;touch-action:manipulation;',
      'font-family:' + T.fb + ';font-size:' + T.fsB3 + ';',
      'font-weight:' + T.fwBold + ';',
      'background:' + T.well + ';',
      'border:1px solid ' + T.border + ';',
      'color:' + T.moon + ';',
      'box-shadow:0 3px 0 ' + T.vermDk + ';',
      'transition:background 0.1s,color 0.1s,border-color 0.1s,transform 0.07s,box-shadow 0.07s;',
    ].join('');
    voidBtn.textContent = 'SELECT A REASON';
    inner.appendChild(voidBtn);

    voidBtn.addEventListener('pointerdown', function() {
      if (!selectedReason) return;
      voidBtn.style.transform  = 'translateY(2px)';
      voidBtn.style.boxShadow  = '0 1px 0 ' + T.vermDk;
    });
    var _voidRelease = function() {
      voidBtn.style.transform = '';
      voidBtn.style.boxShadow = '0 3px 0 ' + T.vermDk;
    };
    voidBtn.addEventListener('pointerup',     _voidRelease);
    voidBtn.addEventListener('pointerleave',  _voidRelease);
    voidBtn.addEventListener('pointercancel', _voidRelease);

    voidBtn.addEventListener('pointerup', function() {
      if (!selectedReason) return;
      var reason = selectedReason;
      SceneManager.resolveInterrupt('void-reason');
      if (params.onConfirm) params.onConfirm(reason);
    });

    function _updateVoidBtn() {
      if (selectedReason) {
        voidBtn.style.background  = T.verm;
        voidBtn.style.border      = '1px solid ' + T.verm;
        voidBtn.style.color       = '#fff';
        voidBtn.textContent       = 'VOID  ' + (item.name || '').toUpperCase();
      } else {
        voidBtn.style.background  = T.well;
        voidBtn.style.border      = '1px solid ' + T.border;
        voidBtn.style.color       = T.moon;
        voidBtn.textContent       = 'SELECT A REASON';
      }
    }

    // Cancel link
    var cancelLink = document.createElement('div');
    cancelLink.style.cssText = [
      'text-align:center;',
      'font-family:' + T.fb + ';font-size:11px;',
      'font-weight:' + T.fwBold + ';color:' + T.moon + ';',
      'cursor:pointer;pointer-events:auto;touch-action:manipulation;',
      'margin-top:2px;',
    ].join('');
    cancelLink.textContent = 'cancel';
    cancelLink.addEventListener('pointerup', function() {
      SceneManager.resolveInterrupt('void-reason');
      if (params.onCancel) params.onCancel();
    });
    inner.appendChild(cancelLink);

    modal.appendChild(inner);
    container.appendChild(modal);

    return function() { alive = false; };
  },

  unmount: function() {},
});
