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
  mount: (container, params) => {
    params = params || {};

    const ctx         = params.context;
    const accentColor = ctx === 'discount' ? T.lavender
                    : ctx === 'void'     ? T.verm
                    :                      T.green;
    const titleText   = ctx === 'discount' ? 'APPLY DISCOUNT'
                    : ctx === 'void'     ? 'VOID ITEM'
                    :                      'MANAGER PIN';

    let alive      = true;
    let pinBuf     = '';
    let pinError   = false;
    let submitting = false;

    container.style.cssText = [
      'width:100%;height:100%;',
      'display:flex;flex-direction:column;',
      'align-items:center;justify-content:center;',
      'gap:12px;',
    ].join('');

    // ── Modal card ──
    let modal = document.createElement('div');
    modal.style.cssText = [
      'width:360px;',
      `background:${T.card};`,
      `border-radius:${T.chamferCard}px;`,
      'overflow:hidden;',
      'display:flex;flex-direction:column;align-items:stretch;',
    ].join('');

    // Top accent bar
    let accentBar = document.createElement('div');
    accentBar.style.cssText = [
      'width:100%;height:4px;',
      `background:${accentColor};`,
      'flex-shrink:0;',
    ].join('');
    modal.appendChild(accentBar);

    // Inner content wrapper
    let inner = document.createElement('div');
    inner.style.cssText = [
      'display:flex;flex-direction:column;align-items:center;',
      'gap:14px;',
      'padding:16px 20px 24px;',
      'box-sizing:border-box;',
    ].join('');

    // Title
    let title = document.createElement('div');
    title.style.cssText = [
      `font-family:${T.fh};`,
      'font-size:18px;',
      `font-weight:${T.fwBold};`,
      `color:${accentColor};`,
      'text-align:center;',
      'letter-spacing:1px;',
      'text-transform:uppercase;',
    ].join('');
    title.textContent = titleText;
    inner.appendChild(title);

    // Subtitle
    const subtitle = document.createElement('div');
    subtitle.style.cssText = [
      `font-family:${T.fb};`,
      'font-size:11px;',
      `font-weight:${T.fwBold};`,
      `color:${T.moon};`,
      'text-align:center;',
      'margin-top:-8px;',
    ].join('');
    subtitle.textContent = 'Manager PIN required';
    inner.appendChild(subtitle);

    // PIN dot trough
    const trough = document.createElement('div');
    trough.style.cssText = [
      'display:flex;flex-direction:row;align-items:center;justify-content:center;',
      'gap:12px;',
      `background:${T.well};`,
      'border-radius:8px;',
      'padding:10px 20px;',
      'width:100%;box-sizing:border-box;',
    ].join('');

    const dots = [];
    for (let di = 0; di < 4; di++) {
      const dot = document.createElement('div');
      dot.style.cssText = [
        'width:16px;height:16px;',
        'border-radius:50%;',
        `background:${T.bg};`,
        `border:1.5px solid ${T.border};`,
        'transition:background 0.1s,border-color 0.1s;',
        'flex-shrink:0;',
      ].join('');
      trough.appendChild(dot);
      dots.push(dot);
    }
    inner.appendChild(trough);

    function updateDots() {
      for (let i = 0; i < 4; i++) {
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
    const bevelLt = lightenHex(T.bg, 0.08);
    const bevelDk = darkenHex(T.bg, 0.2);

    const chassis = document.createElement('div');
    chassis.style.cssText = [
      `background:${T.well};`,
      `border-radius:${T.chamferWell}px;`,
      'padding:10px;',
      'display:grid;',
      'grid-template-columns:repeat(3,1fr);',
      'gap:8px;',
      'width:100%;box-sizing:border-box;',
    ].join('');

    const keyRows = [
      ['7', '8', '9'],
      ['4', '5', '6'],
      ['1', '2', '3'],
      ['CLR', '0', 'ENT'],
    ];

    keyRows.forEach((row) => {
      row.forEach((k) => {
        let key = document.createElement('div');
        key.dataset.key = k;
        let shadowDk;

        if (k === 'CLR') {
          shadowDk = T.vermDk;
          key.style.cssText = [
            'min-height:56px;',
            `border-radius:${T.chamferKey}px;`,
            `background:${T.verm};`,
            'display:flex;align-items:center;justify-content:center;',
            'cursor:pointer;pointer-events:auto;touch-action:manipulation;',
            `box-shadow:0 3px 0 ${shadowDk};`,
            'transition:transform 0.07s,box-shadow 0.07s;',
          ].join('');
          let lbl = document.createElement('span');
          lbl.style.cssText = [
            `font-family:${T.fb};font-size:${T.fsB3};`,
            `font-weight:${T.fwBold};color:#fff;pointer-events:none;`,
          ].join('');
          lbl.textContent = 'CLR';
          key.appendChild(lbl);

        } else if (k === 'ENT') {
          shadowDk = T.greenWarmDk;
          key.style.cssText = [
            'min-height:56px;',
            `border-radius:${T.chamferKey}px;`,
            `background:${T.greenWarm};`,
            'display:flex;align-items:center;justify-content:center;',
            'cursor:pointer;pointer-events:auto;touch-action:manipulation;',
            `box-shadow:0 3px 0 ${shadowDk};`,
            'transition:transform 0.07s,box-shadow 0.07s;',
          ].join('');
          let lbl = document.createElement('span');
          lbl.style.cssText = [
            `font-family:${T.fb};font-size:${T.fsB3};`,
            `font-weight:${T.fwBold};color:${T.moonText};pointer-events:none;`,
          ].join('');
          lbl.textContent = 'ENT';
          key.appendChild(lbl);

        } else {
          shadowDk = darkenHex(T.green, 0.35);
          key.style.cssText = [
            'min-height:56px;',
            `border-radius:${T.chamferKey}px;`,
            `background:${T.green};`,
            `border-top:2px solid ${bevelLt};`,
            `border-bottom:2px solid ${bevelDk};`,
            'display:flex;align-items:center;justify-content:center;',
            'cursor:pointer;pointer-events:auto;touch-action:manipulation;',
            `box-shadow:0 3px 0 ${shadowDk};`,
            'transition:transform 0.07s,box-shadow 0.07s;',
          ].join('');
          const lbl = document.createElement('span');
          lbl.style.cssText = [
            `font-family:${T.fh};font-size:24px;`,
            `font-weight:800;color:${T.moonText};pointer-events:none;`,
          ].join('');
          lbl.textContent = k;
          key.appendChild(lbl);
        }

        // Press animation (IIFE captures shadowDk per key)
        ;((sd) => {
          key.addEventListener('pointerdown', () => {
            key.style.transform = 'translateY(2px)';
            key.style.boxShadow = `0 1px 0 ${sd}`;
          });
          const release = () => {
            key.style.transform = '';
            key.style.boxShadow = `0 3px 0 ${sd}`;
          };
          key.addEventListener('pointerup',     release);
          key.addEventListener('pointerleave',  release);
          key.addEventListener('pointercancel', release);
        })(shadowDk);

        chassis.appendChild(key);
      });
    });

    // Tap delegation on chassis
    chassis.addEventListener('pointerup', (e) => {
      let target = e.target;
      let key = null;
      while (target && target !== chassis) {
        if (target.dataset && target.dataset.key) { key = target; break; }
        target = target.parentElement;
      }
      if (!key) return;
      const k = key.dataset.key;

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
          .then((r) => r.json())
          .then((data) => {
            if (!alive) return;
            if (data.valid && (data.roles || []).indexOf('manager') !== -1) {
              const empId = data.employee_id || pinBuf;
              SceneManager.resolveInterrupt('manager-pin');
              if (params.onConfirm) params.onConfirm(empId);
            } else {
              _flashError();
            }
          })
          .catch(() => {
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
      setTimeout(() => {
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
    let cancelLink = document.createElement('div');
    cancelLink.style.cssText = [
      `font-family:${T.fb};`,
      'font-size:11px;',
      `font-weight:${T.fwBold};`,
      `color:${T.moon};`,
      'text-align:center;',
      'cursor:pointer;pointer-events:auto;touch-action:manipulation;',
    ].join('');
    cancelLink.textContent = 'cancel';
    cancelLink.addEventListener('pointerup', () => {
      if (params.onCancel) params.onCancel();
    });
    container.appendChild(cancelLink);

    updateDots();

    return () => { alive = false; };
  },

  unmount: () => {},
});

// ═══════════════════════════════════════════════════
//  2. disc-select
//     Params: { approvedBy: string,
//               onConfirm({ id, name, pct }), onCancel() }
// ═══════════════════════════════════════════════════

defineScene('disc-select', {
  mount: (container, params) => {
    params = params || {};

    let alive            = true;
    let selectedDiscount = null;

    container.style.cssText = [
      'width:100%;height:100%;',
      'display:flex;flex-direction:column;',
      'align-items:center;justify-content:center;',
    ].join('');

    // ── Modal card ──
    let modal = document.createElement('div');
    modal.style.cssText = [
      'width:360px;',
      `background:${T.card};`,
      `border-radius:${T.chamferCard}px;`,
      'overflow:hidden;',
      'display:flex;flex-direction:column;align-items:stretch;',
    ].join('');

    // Top accent bar
    let accentBar = document.createElement('div');
    accentBar.style.cssText = `width:100%;height:4px;background:${T.lavender};flex-shrink:0;`;
    modal.appendChild(accentBar);

    // Inner
    let inner = document.createElement('div');
    inner.style.cssText = [
      'display:flex;flex-direction:column;align-items:stretch;',
      'gap:12px;',
      'padding:16px 20px 20px;',
      'box-sizing:border-box;',
    ].join('');

    // Title
    let title = document.createElement('div');
    title.style.cssText = [
      `font-family:${T.fh};`,
      'font-size:18px;',
      `font-weight:${T.fwBold};`,
      `color:${T.lavender};`,
      'text-align:center;',
      'letter-spacing:1px;',
      'text-transform:uppercase;',
    ].join('');
    title.textContent = 'APPLY DISCOUNT';
    inner.appendChild(title);

    // Approved badge
    let badge = document.createElement('div');
    badge.style.cssText = [
      'display:flex;flex-direction:row;align-items:center;justify-content:center;',
      'gap:6px;',
      `background:${T.well};`,
      'border-radius:6px;',
      'padding:5px 10px;',
      'align-self:center;',
    ].join('');
    let badgeDot = document.createElement('div');
    badgeDot.style.cssText = [
      'width:6px;height:6px;border-radius:50%;',
      `background:${T.green};`,
      'flex-shrink:0;',
    ].join('');
    let badgeText = document.createElement('span');
    badgeText.style.cssText = [
      `font-family:${T.fb};font-size:11px;`,
      `font-weight:${T.fwBold};color:${T.green};`,
    ].join('');
    badgeText.textContent = `Approved · ${(params.approvedBy || '')}`;
    badge.appendChild(badgeDot);
    badge.appendChild(badgeText);
    inner.appendChild(badge);

    // Tile grid (populated after fetch)
    const tileGrid = document.createElement('div');
    tileGrid.style.cssText = [
      'display:grid;',
      'grid-template-columns:1fr 1fr;',
      'gap:8px;',
    ].join('');
    inner.appendChild(tileGrid);

    // APPLY button
    const applyBtn = document.createElement('div');
    applyBtn.style.cssText = [
      'width:100%;border-radius:8px;',
      'padding:12px 10px;',
      'box-sizing:border-box;',
      'text-align:center;',
      'cursor:pointer;pointer-events:auto;touch-action:manipulation;',
      `font-family:${T.fb};font-size:${T.fsB3};`,
      `font-weight:${T.fwBold};`,
      `background:${T.well};`,
      `border:1px solid ${T.border};`,
      `color:${T.moon};`,
      'transition:background 0.1s,color 0.1s;',
    ].join('');
    applyBtn.textContent = 'SELECT A DISCOUNT';
    inner.appendChild(applyBtn);

    // Cancel link
    let cancelLink = document.createElement('div');
    cancelLink.style.cssText = [
      'text-align:center;',
      `font-family:${T.fb};font-size:11px;`,
      `font-weight:${T.fwBold};color:${T.moon};`,
      'cursor:pointer;pointer-events:auto;touch-action:manipulation;',
      'margin-top:2px;',
    ].join('');
    cancelLink.textContent = 'cancel';
    cancelLink.addEventListener('pointerup', () => {
      SceneManager.resolveInterrupt('disc-select');
      if (params.onCancel) params.onCancel();
    });
    inner.appendChild(cancelLink);

    modal.appendChild(inner);
    container.appendChild(modal);

    function _updateApplyBtn() {
      if (selectedDiscount) {
        applyBtn.style.background   = T.lavender;
        applyBtn.style.border       = `1px solid ${T.lavender}`;
        applyBtn.style.color        = T.moonText;
        applyBtn.textContent        = `APPLY  ${selectedDiscount.name}  ${selectedDiscount.pct}%`;
      } else {
        applyBtn.style.background   = T.well;
        applyBtn.style.border       = `1px solid ${T.border}`;
        applyBtn.style.color        = T.moon;
        applyBtn.textContent        = 'SELECT A DISCOUNT';
      }
    }

    function _buildTiles(discounts) {
      tileGrid.innerHTML = '';
      discounts.forEach((disc) => {
        let tile = document.createElement('div');
        tile.style.cssText = [
          'border-radius:8px;',
          'padding:10px;',
          'cursor:pointer;pointer-events:auto;touch-action:manipulation;',
          'display:flex;flex-direction:column;gap:4px;',
          `background:${T.well};`,
          `border:1px solid ${T.border};`,
          'transition:background 0.1s,border-color 0.1s;',
        ].join('');

        const namEl = document.createElement('div');
        namEl.style.cssText = [
          `font-family:${T.fb};font-size:${T.fsB3};`,
          `font-weight:${T.fwBold};color:${T.text};`,
        ].join('');
        namEl.textContent = disc.name;

        const pctEl = document.createElement('div');
        pctEl.style.cssText = [
          `font-family:${T.fb};font-size:${T.fsB3};`,
          `font-weight:${T.fwBold};color:${T.lavender};`,
        ].join('');
        pctEl.textContent = disc.pct + '% off';

        tile.appendChild(namEl);
        tile.appendChild(pctEl);

        tile.addEventListener('pointerup', () => {
          selectedDiscount = disc;
          // Update all tiles
          const tiles = tileGrid.querySelectorAll('[data-disc-tile]');
          for (let ti = 0; ti < tiles.length; ti++) {
            const t = tiles[ti];
            const isSelected = t === tile;
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

    applyBtn.addEventListener('pointerup', () => {
      if (!selectedDiscount) return;
      const disc = selectedDiscount;
      SceneManager.resolveInterrupt('disc-select');
      if (params.onConfirm) params.onConfirm(disc);
    });

    // Show loading state
    const loadingEl = document.createElement('div');
    loadingEl.style.cssText = [
      'text-align:center;',
      `font-family:${T.fb};font-size:${T.fsB3};`,
      `font-weight:${T.fwBold};color:${T.moon};`,
      'padding:12px 0;',
    ].join('');
    loadingEl.textContent = 'Loading…';
    tileGrid.appendChild(loadingEl);

    // Fetch discounts
    fetchWithTimeout('/api/v1/discounts', {}, 10000)
      .then((r) => r.json())
      .then((data) => {
        if (!alive) return;
        const list = Array.isArray(data) ? data : (data.discounts || data.items || []);
        const normalized = list.map((d) => {
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
      .catch(() => {
        if (!alive) return;
        showToast('Could not load discounts');
        SceneManager.resolveInterrupt('disc-select');
        if (params.onCancel) params.onCancel();
      });

    return () => { alive = false; };
  },

  unmount: () => {},
});

// ═══════════════════════════════════════════════════
//  3. void-reason
//     Params: { item: { name, price }, approvedBy: string,
//               onConfirm(reason: string), onCancel() }
// ═══════════════════════════════════════════════════

const VOID_REASONS = [
  'Customer Changed Mind',
  'Entered in Error',
  'Kitchen Error',
  'Comp / Courtesy',
];

defineScene('void-reason', {
  mount: (container, params) => {
    params = params || {};

    const item           = params.item || {};
    let alive          = true;
    let selectedReason = null;

    container.style.cssText = [
      'width:100%;height:100%;',
      'display:flex;flex-direction:column;',
      'align-items:center;justify-content:center;',
    ].join('');

    // ── Modal card ──
    const modal = document.createElement('div');
    modal.style.cssText = [
      'width:360px;',
      `background:${T.card};`,
      `border-radius:${T.chamferCard}px;`,
      'overflow:hidden;',
      'display:flex;flex-direction:column;align-items:stretch;',
      `border:1px solid ${T.verm};`,
    ].join('');

    // Top accent bar
    const accentBar = document.createElement('div');
    accentBar.style.cssText = `width:100%;height:4px;background:${T.verm};flex-shrink:0;`;
    modal.appendChild(accentBar);

    // Inner
    const inner = document.createElement('div');
    inner.style.cssText = [
      'display:flex;flex-direction:column;align-items:stretch;',
      'gap:12px;',
      'padding:16px 20px 20px;',
      'box-sizing:border-box;',
    ].join('');

    // Title
    const title = document.createElement('div');
    title.style.cssText = [
      `font-family:${T.fh};`,
      'font-size:18px;',
      `font-weight:${T.fwBold};`,
      `color:${T.verm};`,
      'text-align:center;',
      'letter-spacing:1px;',
      'text-transform:uppercase;',
    ].join('');
    title.textContent = 'VOID ITEM';
    inner.appendChild(title);

    // Approved badge
    const badge = document.createElement('div');
    badge.style.cssText = [
      'display:flex;flex-direction:row;align-items:center;justify-content:center;',
      'gap:6px;',
      `background:${T.well};`,
      'border-radius:6px;',
      'padding:5px 10px;',
      'align-self:center;',
    ].join('');
    const badgeDot = document.createElement('div');
    badgeDot.style.cssText = [
      'width:6px;height:6px;border-radius:50%;',
      `background:${T.green};flex-shrink:0;`,
    ].join('');
    const badgeText = document.createElement('span');
    badgeText.style.cssText = [
      `font-family:${T.fb};font-size:11px;`,
      `font-weight:${T.fwBold};color:${T.green};`,
    ].join('');
    badgeText.textContent = `Approved · ${(params.approvedBy || '')}`;
    badge.appendChild(badgeDot);
    badge.appendChild(badgeText);
    inner.appendChild(badge);

    // Item card
    const itemCard = document.createElement('div');
    itemCard.style.cssText = [
      `background:${T.well};`,
      `border:1px solid ${T.verm};`,
      `border-left:3px solid ${T.verm};`,
      'border-radius:8px;',
      'padding:6px 10px;',
      'display:flex;flex-direction:row;align-items:center;justify-content:space-between;',
    ].join('');
    const itemName = document.createElement('span');
    itemName.style.cssText = [
      `font-family:${T.fb};font-size:${T.fsB3};`,
      `font-weight:${T.fwBold};color:${T.text};`,
      'flex:1;min-width:0;',
    ].join('');
    itemName.textContent = item.name || '';
    const itemPrice = document.createElement('span');
    itemPrice.style.cssText = [
      `font-family:${T.fb};font-size:${T.fsB3};`,
      `font-weight:${T.fwBold};color:${T.gold};`,
      'flex-shrink:0;margin-left:10px;',
    ].join('');
    const priceNum = typeof item.price === 'number' ? item.price : parseFloat(item.price) || 0;
    itemPrice.textContent = `$${priceNum.toFixed(2)}`;
    itemCard.appendChild(itemName);
    itemCard.appendChild(itemPrice);
    inner.appendChild(itemCard);

    // Reason tiles
    const tileCol = document.createElement('div');
    tileCol.style.cssText = 'display:flex;flex-direction:column;gap:8px;';

    const tilePtrs = [];

    VOID_REASONS.forEach((reason) => {
      const tile = document.createElement('div');
      tile.style.cssText = [
        'width:100%;',
        'border-radius:8px;',
        'padding:10px 12px;',
        'box-sizing:border-box;',
        'cursor:pointer;pointer-events:auto;touch-action:manipulation;',
        `font-family:${T.fb};font-size:${T.fsB3};`,
        `font-weight:${T.fwBold};`,
        `color:${T.text};`,
        `background:${T.well};`,
        `border:1px solid ${T.border};`,
        'transition:background 0.1s,color 0.1s,border-color 0.1s;',
      ].join('');
      tile.textContent = reason;
      tile.dataset.reason = reason;

      tile.addEventListener('pointerup', () => {
        selectedReason = reason;
        tilePtrs.forEach((t) => {
          const isSel = t.dataset.reason === reason;
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
    const voidBtn = document.createElement('div');
    voidBtn.style.cssText = [
      'width:100%;border-radius:8px;',
      'padding:12px 10px;',
      'box-sizing:border-box;',
      'text-align:center;',
      'cursor:pointer;pointer-events:auto;touch-action:manipulation;',
      `font-family:${T.fb};font-size:${T.fsB3};`,
      `font-weight:${T.fwBold};`,
      `background:${T.well};`,
      `border:1px solid ${T.border};`,
      `color:${T.moon};`,
      `box-shadow:0 3px 0 ${T.vermDk};`,
      'transition:background 0.1s,color 0.1s,border-color 0.1s,transform 0.07s,box-shadow 0.07s;',
    ].join('');
    voidBtn.textContent = 'SELECT A REASON';
    inner.appendChild(voidBtn);

    voidBtn.addEventListener('pointerdown', () => {
      if (!selectedReason) return;
      voidBtn.style.transform  = 'translateY(2px)';
      voidBtn.style.boxShadow  = `0 1px 0 ${T.vermDk}`;
    });
    const _voidRelease = () => {
      voidBtn.style.transform = '';
      voidBtn.style.boxShadow = `0 3px 0 ${T.vermDk}`;
    };
    voidBtn.addEventListener('pointerup',     _voidRelease);
    voidBtn.addEventListener('pointerleave',  _voidRelease);
    voidBtn.addEventListener('pointercancel', _voidRelease);

    voidBtn.addEventListener('pointerup', () => {
      if (!selectedReason) return;
      const reason = selectedReason;
      SceneManager.resolveInterrupt('void-reason');
      if (params.onConfirm) params.onConfirm(reason);
    });

    function _updateVoidBtn() {
      if (selectedReason) {
        voidBtn.style.background  = T.verm;
        voidBtn.style.border      = `1px solid ${T.verm}`;
        voidBtn.style.color       = '#fff';
        voidBtn.textContent       = `VOID  ${(item.name || '').toUpperCase()}`;
      } else {
        voidBtn.style.background  = T.well;
        voidBtn.style.border      = `1px solid ${T.border}`;
        voidBtn.style.color       = T.moon;
        voidBtn.textContent       = 'SELECT A REASON';
      }
    }

    // Cancel link
    const cancelLink = document.createElement('div');
    cancelLink.style.cssText = [
      'text-align:center;',
      `font-family:${T.fb};font-size:11px;`,
      `font-weight:${T.fwBold};color:${T.moon};`,
      'cursor:pointer;pointer-events:auto;touch-action:manipulation;',
      'margin-top:2px;',
    ].join('');
    cancelLink.textContent = 'cancel';
    cancelLink.addEventListener('pointerup', () => {
      SceneManager.resolveInterrupt('void-reason');
      if (params.onCancel) params.onCancel();
    });
    inner.appendChild(cancelLink);

    modal.appendChild(inner);
    container.appendChild(modal);

    return () => { alive = false; };
  },

  unmount: () => {},
});
