// terminal/modifier-panel.js
// Shared modifier panel for both full-service (order-entry) and QSR (qsr-order)

import { T } from '../common/tokens.js';
import { buildPillButton, hexToRgba } from './theme-manager.js';
import { formatModifierLabel } from './modifier-label.js';

const _PLACE_DEFS = [
  { id:'LEFT',  label:'½ LEFT'  },
  { id:'WHOLE', label:'WHOLE'   },
  { id:'RIGHT', label:'RIGHT ½' },
];

function _prefixColor(id) {
  if (id === 'ADD')     return T.modAdd;
  if (id === 'EXTRA')   return T.modExtra;
  if (id === 'NO')      return T.modNo;
  if (id === 'ON SIDE') return T.modOnSide;
  if (id === 'LITE')    return T.modLite;
  return T.card;
}

function buildKindModPanel(container, item, modConfig, catColor, enablePlacement, callbacks, snakeStateParam) {
  modConfig = modConfig || {};
  let includedItems   = modConfig.includedItems   || [];
  let mandatoryGroups = modConfig.mandatoryGroups || [];
  let optionalGroups  = modConfig.optionalGroups  || [];
  const snakeState    = snakeStateParam || {};
  const isPizza = !!enablePlacement;

  // ── State ──────────────────────────────────────────
  const inclState  = {};   // mod.id  → 'NO'|'ON SIDE'
  const optState   = {};   // optId   → { prefix, placement }
  const mandState  = {};   // groupKey → { key, label, price }
  let activePrefix = 'ADD';
  let activePlacement = 'WHOLE';
  let inclPrefix = 'NO';
  let openSubKey = null;

  const PREFIX_MAP = [
    { id:'ADD',   label:'ADD',     color:T.modAdd,    textColor:T.well, dk:T.modAddDk    },
    { id:'EXTRA', label:'EXTRA',   color:T.modExtra,  textColor:T.well, dk:T.modExtraDk  },
    { id:'NO',    label:'NO',      color:T.modNo,     textColor:T.well, dk:T.modNoDk     },
    { id:'SIDE',  label:'ON SIDE', color:T.modOnSide, textColor:T.well, dk:T.modOnSideDk },
    { id:'LITE',  label:'LITE',    color:T.modLite,   textColor:T.well, dk:T.modLiteDk   },
  ];

  // ── Root overlay ────────────────────────────────────
  const ov = document.createElement('div');
  ov.style.cssText = [
    'flex:1;min-height:0;',
    `background:${T.bg};`,
    'display:flex;flex-direction:column;',
    'overflow:hidden;',
  ].join('');

  const itemPx = Number(item.price) || 0;

  // ── Scrollable content ──────────────────────────────
  const scroll = document.createElement('div');
  scroll.style.cssText = 'flex:1;overflow-y:auto;padding:8px 14px 10px;';
  ov.appendChild(scroll);

  // ── DONE button ─────────────────────────────────────
  const doneWrap = document.createElement('div');
  doneWrap.style.cssText = 'flex-shrink:0;padding:8px 14px 10px;';
  const doneBtn = buildPillButton({ label: 'DONE — ADD TO CHECK', color: T.green, textColor: T.well });
  doneBtn.style.width = '100%';
  doneBtn.style.fontSize = '16px';
  doneBtn.addEventListener('pointerup', () => { callbacks.onSend(_buildActiveItem()); });
  doneBtn.disabled = mandatoryGroups.some((g) => !mandState[g.key]);
  doneWrap.appendChild(doneBtn);
  ov.appendChild(doneWrap);

  // ── Build active item for commit ─────────────────────
  function _buildActiveItem() {
    let pricingDriverKey = modConfig.pricingDriverKey;
    const pricingDriverValue = pricingDriverKey ? (mandState[pricingDriverKey] ? mandState[pricingDriverKey].key : null) : null;

    const optMods = [];
    Object.keys(optState).forEach((optId) => {
      let s = optState[optId];
      if (!s) return;
      // Find the option def
      let found = null;
      optionalGroups.forEach((g) => {
        (g.options || []).forEach((o) => {
          if ((o.id || o.key) === optId) found = o;
        });
      });
      if (!found) return;

      let resolvedPrice = found.price || 0;
      if (pricingDriverValue && found.priceByOption && found.priceByOption[pricingDriverValue] !== undefined) {
        resolvedPrice = found.priceByOption[pricingDriverValue];
      }

      const placeMap = { 'LEFT': '1st', 'RIGHT': '2nd', 'WHOLE': null };
      optMods.push({
        prefix:    s.prefix,
        label:     found.label,
        price:     resolvedPrice,
        placement: placeMap[s.placement] || null,
      });
    });

    const removals = Object.keys(inclState).filter((id) => inclState[id] === 'NO');

    // Build mandatory selections map
    const mandSel = {};
    Object.keys(mandState).forEach((k) => {
      let s = mandState[k];
      let grp = mandatoryGroups.find((g) => g.key === k);
      const opt = grp ? (grp.options || []).find((o) => (o.key || o.id) === s.key) : null;

      let resolvedPrice = s.price;
      if (opt && pricingDriverValue && opt.priceByOption && opt.priceByOption[pricingDriverValue] !== undefined) {
        resolvedPrice = opt.priceByOption[pricingDriverValue];
      }
      mandSel[k] = { key: s.key, label: s.label, price: resolvedPrice };
    });

    // Build preview mods for ticket
    let previewMods = [];

    // 1. Mandatory selections (e.g. Size, Crust)
    Object.keys(mandSel).forEach((k) => {
      let s = mandSel[k];
      previewMods.push({ name: s.label, price: s.price || 0, charged: (s.price > 0), prefix: null });
    });

    // 2. Included items (Pre-applied) — show even if not modified, unless removed
    includedItems.forEach((inc) => {
      if (inclState[inc.id] !== 'SIDE') return;   // NO handled by removals below
      previewMods.push({ name: `ON SIDE ${inc.label}`, price: 0, charged: false, prefix: null });
    });

    // 3. Removals (NO X)
    removals.forEach((rid) => {
      const inc = includedItems.find((i) => i.id === rid);
      if (inc) previewMods.push({ name: `NO ${inc.label}`, price: 0, charged: false, prefix: null });
    });

    // 4. Optional modifiers
    optMods.forEach((m) => {
      let halfSide = m.placement === '1st' ? 'Left' : m.placement === '2nd' ? 'Right' : null;
      let charged = (m.prefix === 'ADD' || m.prefix === 'EXTRA') && m.price > 0;
      let displayName = formatModifierLabel(m.prefix, m.label);
      previewMods.push({ name: displayName, price: charged ? m.price : 0, charged, prefix: halfSide });
    });

    callbacks.onUpdate({ itemLabel: item.label, basePrice: itemPx, mods: previewMods });

    return {
      itemLabel:           item.label,
      basePrice:           itemPx,
      mandatorySelections: mandSel,
      optionalModifiers:   optMods,
      includedRemovals:    removals,
      allergens:           [],
      allergenNote:        '',
      note:                '',
      _modPanelData: {
        optMods: optMods,
        mandSel: mandSel,
        removals: removals
      }
    };
  }

  // ── Render content sections ──────────────────────────
  function renderContent() {
    const savedTop = scroll.scrollTop;
    scroll.innerHTML = '';

    // ── SNAKE BREADCRUMB CARD — matches grid tile style ──
    const snakeCard = document.createElement('div');
    snakeCard.style.cssText = [
      'display:flex;gap:6px;align-items:stretch;',
      'margin-bottom:12px;',
    ].join('');

    // Crumb tiles — filled, same style as buildCrumbTile
    (snakeState.crumbs || []).forEach((crumb) => {
      let tile = document.createElement('div');
      tile.style.cssText = [
        'display:flex;align-items:center;justify-content:center;',
        'padding:10px 14px;border-radius:10px;min-height:95px;',
        `background:${crumb.color};`,
        `border-left:4px solid ${crumb.color};`,
        `box-shadow:0 4px 0 ${hexToRgba(crumb.color, 0.55)};`,
        `font-family:${T.fh};font-weight:700;font-size:22px;`,
        `color:${T.well};letter-spacing:1px;pointer-events:none;`,
      ].join('');
      tile.textContent = crumb.label;
      snakeCard.appendChild(tile);
    });

    // Item tile — same style as buildItemTile but filled, tap to cancel
    const itemTile = document.createElement('div');
    itemTile.style.cssText = [
      'display:flex;flex-direction:column;justify-content:center;',
      'padding:10px 14px;border-radius:10px;cursor:pointer;',
      `background:${catColor};`,
      `border-left:4px solid ${catColor};`,
      `box-shadow:0 4px 0 ${hexToRgba(catColor, 0.55)};`,
      'pointer-events:auto;touch-action:manipulation;',
      'min-height:95px;min-width:120px;',
    ].join('');
    const icn = document.createElement('span');
    icn.style.cssText = `font-family:${T.fh};font-weight:700;font-size:22px;color:${T.well};pointer-events:none;`;
    icn.textContent = item.label;
    const icp = document.createElement('span');
    icp.style.cssText = `font-family:${T.fb};font-size:14px;color:${hexToRgba(T.well, 0.65)};margin-top:4px;pointer-events:none;;font-weight:${T.fwBold};`;
    icp.textContent = `$${itemPx.toFixed(2)}`;
    itemTile.appendChild(icn);
    itemTile.appendChild(icp);
    itemTile.addEventListener('pointerup', () => { callbacks.onCancel(); });
    snakeCard.appendChild(itemTile);
    scroll.appendChild(snakeCard);

    // ── Accordion state ──────────────────────────
    const defaultCard =
      includedItems.length  > 0 ? 'included' :
      mandatoryGroups.length > 0 ? 'mandatory' : 'optional';
    if (!renderContent._activeCard) renderContent._activeCard = defaultCard;
    const activeCard = renderContent._activeCard;

    function setActiveCard(id) {
      renderContent._activeCard = id;
      renderContent();
    }

    // ── Accordion container ───────────────────────
    const accWrap = document.createElement('div');
    accWrap.style.cssText = [
      'display:flex;flex-direction:column;gap:8px;',
      'padding:8px 14px 10px;',
    ].join('');

    const CARD_DEFS = [
      { id:'included',  title:'INCLUDED',  show: includedItems.length > 0 },
      { id:'mandatory', title:'MANDATORY', show: mandatoryGroups.length > 0 },
      { id:'optional',  title:'OPTIONS',   show: true },
    ];

    CARD_DEFS.forEach((def) => {
      if (!def.show) return;
      const isExp = activeCard === def.id;

      let card = document.createElement('div');
      card.dataset.accCard = def.id;
      card.style.cssText = [
        `background:${T.card};`,
        'border-radius:10px;overflow:hidden;flex-shrink:0;',
        `border-left:4px solid ${(isExp ? _accColor(def.id) : T.border)};`,
        'box-shadow:0 4px 12px rgba(0,0,0,0.25);',
        'transition:border-color 0.15s;',
        'pointer-events:auto;',
      ].join('');

      // Header
      const hdr = document.createElement('div');
      hdr.style.cssText = [
        'display:flex;align-items:center;gap:10px;',
        'padding:0 14px;height:44px;cursor:pointer;',
        'user-select:none;touch-action:manipulation;',
        'pointer-events:auto;',
      ].join('');
      hdr.addEventListener('pointerdown', () => {
        hdr.style.background = 'rgba(255,255,255,0.03)';
      });
      hdr.addEventListener('pointerleave', () => {
        hdr.style.background = '';
      });
      hdr.addEventListener('pointerup', () => {
        hdr.style.background = '';
      });
      hdr.addEventListener('pointerup', () => { setActiveCard(def.id); });

      const titleEl = document.createElement('span');
      titleEl.style.cssText = [
        `font-family:${T.fb};font-size:${T.fsB3};font-weight:700;`,
        'letter-spacing:2px;flex-shrink:0;',
        `color:${(isExp ? _accColor(def.id) : T.moon)};`,
      ].join('');
      titleEl.textContent = def.title;
      hdr.appendChild(titleEl);

      // Action area (expanded only) — placeholder, filled per card below
      const actionArea = document.createElement('div');
      actionArea.style.cssText = 'display:flex;align-items:center;gap:5px;flex:1;';
      actionArea.dataset.actionArea = def.id;
      hdr.appendChild(actionArea);

      // Status chip (collapsed only) — placeholder
      const chipWrap = document.createElement('span');
      chipWrap.dataset.chipWrap = def.id;
      hdr.appendChild(chipWrap);

      // Chevron
      let chev = document.createElement('span');
      chev.style.cssText = [
        `font-size:${T.fsB4};color:${T.border};margin-left:auto;`,
        'transition:transform 0.15s;flex-shrink:0;',
        `transform:${(isExp ? 'rotate(180deg)' : 'none')};`,
      ].join('');
      chev.textContent = '▼';
      hdr.appendChild(chev);

      card.appendChild(hdr);

      // Body
      const body = document.createElement('div');
      body.style.cssText = `padding:8px 10px 10px;${(isExp ? '' : 'display:none;')}`;
      body.dataset.cardBody = def.id;
      card.appendChild(body);

      accWrap.appendChild(card);

      if (def.id === 'included') {
        _buildInclCard(actionArea, chipWrap, body, isExp);
      }
      if (def.id === 'mandatory') {
        _buildMandCard(chipWrap, body);
      }
      if (def.id === 'optional') {
        _buildOptCard(actionArea, body, isExp);
      }
    });

    scroll.appendChild(accWrap);

    // ── Helper: accent color per card ────────────
    function _accColor(id) {
      if (id === 'optional') return T.greenWarm;
      return catColor || T.green;
    }

    function _buildInclCard(actionArea, chipWrap, body, isExp) {
      // ── Header buttons (expanded only) ───────────
      if (isExp) {
        ['NO','SIDE'].forEach((pid) => {
          let p = PREFIX_MAP.find((x) => x.id === pid);
          let isActive = inclPrefix === pid;
          let btn = document.createElement('button');
          btn.style.cssText = [
            'padding:4px 11px;border-radius:6px;',
            `font-family:${T.fb};font-size:${T.fsB4};font-weight:700;`,
            'letter-spacing:0.5px;cursor:pointer;white-space:nowrap;',
            `border:1px solid ${(isActive ? p.color : T.border)};`,
            `background:${(isActive ? p.color : T.well)};`,
            `color:${(isActive ? p.textColor : T.text)};`,
            `box-shadow:0 3px 0 ${(isActive ? p.dk : T.moonDk)};`,
            'touch-action:manipulation;pointer-events:auto;',
          ].join('');
          btn.textContent = p.label;
          btn.addEventListener('pointerup', (e) => {
            e.stopPropagation();
            inclPrefix = (inclPrefix === pid) ? null : pid;
            renderContent();
          });
          actionArea.appendChild(btn);
        });
      }

      // ── Status chip (collapsed only) ─────────────
      if (!isExp) {
        const nCount = Object.keys(inclState).filter((k) => inclState[k]==='NO').length;
        const sCount = Object.keys(inclState).filter((k) => inclState[k]==='SIDE').length;
        const parts = [];
        if (nCount) parts.push(nCount + ' NO');
        if (sCount) parts.push(sCount + ' SIDE');
        if (parts.length) {
          let chip = document.createElement('span');
          chip.style.cssText = [
            'display:inline-flex;align-items:center;gap:5px;',
            'padding:2px 8px;border-radius:6px;white-space:nowrap;',
            `font-family:${T.fb};font-size:${T.fsB4};font-weight:700;`,
            `background:rgba(74,222,128,0.1);color:${T.greenWarm};`,
            'border:1px solid rgba(74,222,128,0.25);',
          ].join('');
          chip.textContent = parts.join(' · ');
          chipWrap.appendChild(chip);
        }
      }

      // ── Tile grid ────────────────────────────────
      let grid = document.createElement('div');
      grid.style.cssText = [
        'display:grid;',
        'grid-template-columns:repeat(auto-fill,minmax(108px,1fr));',
        'gap:6px;',
      ].join('');

      includedItems.forEach((inc) => {
        let s = inclState[inc.id] || null;
        let tile = document.createElement('div');

        let bg   = s==='NO' ? T.verm : s==='SIDE' ? T.modOnSide : T.well;
        let fg   = s==='NO' ? '#fff' : s==='SIDE' ? T.well      : T.text;
        let shDk = s==='NO' ? T.modNoDk : s==='SIDE' ? T.modOnSideDk : T.moonDk;

        tile.style.cssText = [
          'height:44px;border-radius:8px;',
          'display:flex;flex-direction:column;',
          'align-items:center;justify-content:center;gap:1px;',
          `font-family:${T.fb};font-weight:700;`,
          `background:${bg};color:${fg};`,
          `border:1px solid ${(s ? bg : T.border)};`,
          `box-shadow:0 3px 0 ${shDk};`,
          'cursor:pointer;touch-action:manipulation;pointer-events:auto;',
          'transition:all 0.08s;user-select:none;',
        ].join('');

        if (s) {
          let tag = document.createElement('span');
          tag.style.cssText = `font-size:${T.fsB4};font-weight:700;opacity:0.8;pointer-events:none;`;
          tag.textContent = s === 'SIDE' ? 'ON SIDE' : s;
          tile.appendChild(tag);
        }
        let lbl = document.createElement('span');
        lbl.style.cssText = `font-size:${T.fsB3};pointer-events:none;`;
        lbl.textContent = inc.label;
        tile.appendChild(lbl);

        tile.addEventListener('pointerdown', () => {
          tile.style.transform='translateY(2px)';
          tile.style.boxShadow=`0 1px 0 ${shDk}`;
        });
        tile.addEventListener('pointerup', () => {
          tile.style.transform='';
          tile.style.boxShadow=`0 3px 0 ${shDk}`;
          if (!inclPrefix) return;
          if (inclState[inc.id]===inclPrefix) delete inclState[inc.id];
          else inclState[inc.id]=inclPrefix;
          renderContent();
        });
        tile.addEventListener('pointerleave', () => {
          tile.style.transform='';
          tile.style.boxShadow=`0 3px 0 ${shDk}`;
        });
        grid.appendChild(tile);
      });

      body.appendChild(grid);
    }

    function _buildMandCard(chipWrap, body) {
      // ── Status chip (collapsed only) ─────────────
      if (activeCard !== 'mandatory') {
        const pending = mandatoryGroups.filter((g) => !mandState[g.key]);
        if (pending.length) {
          let chip = document.createElement('span');
          chip.style.cssText = [
            'display:inline-flex;align-items:center;gap:5px;',
            'padding:2px 8px;border-radius:6px;white-space:nowrap;',
            `font-family:${T.fb};font-size:${T.fsB4};font-weight:700;`,
            `background:rgba(251,191,36,0.12);color:${T.modLite};`,
            'border:1px solid rgba(251,191,36,0.3);',
          ].join('');
          chip.textContent = pending.length + ' REQUIRED';
          chipWrap.appendChild(chip);
        } else {
          mandatoryGroups.forEach((g) => {
            if (!mandState[g.key]) return;
            const sc = document.createElement('span');
            sc.style.cssText = [
              'display:inline-flex;padding:2px 7px;border-radius:6px;',
              `font-family:${T.fb};font-size:${T.fsB4};font-weight:700;`,
              `background:rgba(232,200,78,0.12);color:${T.gold};`,
              'border:1px solid rgba(232,200,78,0.3);white-space:nowrap;',
              'margin-right:4px;',
            ].join('');
            sc.textContent = mandState[g.key].label.toUpperCase();
            chipWrap.appendChild(sc);
          });
        }
      }

      // ── Two-column tile grid ──────────────────────
      const grid = document.createElement('div');
      grid.style.cssText = 'display:grid;grid-template-columns:1fr 1fr;gap:6px;';

      mandatoryGroups.forEach((g) => {
        const chosen  = mandState[g.key] || null;
        let isOpen  = openSubKey === g.key;

        // Group tile
        let tile = document.createElement('div');
        const barColor = isOpen||chosen ? T.gold : (g.required ? T.modLite : T.border);
        tile.style.cssText = [
          'height:52px;border-radius:8px;position:relative;overflow:hidden;',
          'display:flex;flex-direction:column;justify-content:center;',
          'padding:0 12px 0 14px;cursor:pointer;',
          `background:${T.well};`,
          `border:1px solid ${T.border};`,
          `box-shadow:0 3px 0 ${T.moonDk};`,
          'touch-action:manipulation;pointer-events:auto;user-select:none;',
          'transition:all 0.08s;',
        ].join('');

        // Left bar
        const bar = document.createElement('div');
        bar.style.cssText = [
          'position:absolute;left:0;top:0;bottom:0;width:3px;',
          `background:${barColor};pointer-events:none;`,
        ].join('');
        tile.appendChild(bar);

        const glabel = document.createElement('div');
        glabel.style.cssText = [
          `font-family:${T.fb};font-size:${T.fsB4};font-weight:700;`,
          'letter-spacing:1.5px;pointer-events:none;',
          `color:${(g.required && !chosen ? T.modLite : T.moon)};`,
        ].join('');
        glabel.textContent = g.label;
        tile.appendChild(glabel);

        if (chosen) {
          const gval = document.createElement('div');
          gval.style.cssText = [
            `font-family:${T.fb};font-size:${T.fsB3};font-weight:700;`,
            `color:${T.gold};margin-top:2px;pointer-events:none;`,
          ].join('');
          gval.textContent = chosen.label;
          tile.appendChild(gval);
        } else {
          const gpend = document.createElement('div');
          gpend.style.cssText = [
            `font-family:${T.fb};font-size:${T.fsB4};font-weight:700;`,
            `font-style:italic;color:${T.modLite};`,
            'margin-top:2px;pointer-events:none;',
          ].join('');
          gpend.textContent = 'tap to select →';
          tile.appendChild(gpend);
        }

        tile.addEventListener('pointerdown', () => {
          tile.style.transform='translateY(2px)';
          tile.style.boxShadow=`0 1px 0 ${T.moonDk}`;
        });
        tile.addEventListener('pointerup', () => {
          tile.style.transform='';
          tile.style.boxShadow=`0 3px 0 ${T.moonDk}`;
          openSubKey = (openSubKey===g.key) ? null : g.key;
          renderContent();
        });
        tile.addEventListener('pointerleave', () => {
          tile.style.transform='';
          tile.style.boxShadow=`0 3px 0 ${T.moonDk}`;
        });
        grid.appendChild(tile);

        // Sub-card (spans both columns)
        if (isOpen) {
          const sub = document.createElement('div');
          sub.style.cssText = [
            'grid-column:1/-1;display:block;',
            'background:rgba(34,37,42,0.85);border-radius:8px;',
            'border:1px solid rgba(232,200,78,0.22);padding:8px;',
          ].join('');

          const subLbl = document.createElement('div');
          subLbl.style.cssText = [
            `font-family:${T.fb};font-size:${T.fsB4};font-weight:700;`,
            `letter-spacing:1.5px;color:${T.gold};margin-bottom:7px;`,
          ].join('');
          subLbl.textContent = `SELECT ${g.label}`;
          sub.appendChild(subLbl);

          const subGrid = document.createElement('div');
          subGrid.style.cssText = [
            'display:grid;',
            'grid-template-columns:repeat(auto-fill,minmax(100px,1fr));',
            'gap:5px;',
          ].join('');

          (g.options || []).forEach((opt) => {
            const isSel = chosen && chosen.key === (opt.key||opt.id);
            const st = document.createElement('div');
            st.style.cssText = [
              'height:36px;border-radius:6px;',
              'display:flex;align-items:center;justify-content:center;',
              `font-family:${T.fb};font-size:${T.fsB4};font-weight:700;`,
              'letter-spacing:0.3px;cursor:pointer;',
              `background:${(isSel ? T.gold  : T.card)};`,
              `color:${(isSel ? T.well  : T.text)};`,
              `border:1px solid ${(isSel ? T.gold : T.border)};`,
              `box-shadow:0 2px 0 ${(isSel ? T.goldDk : T.moonDk)};`,
              'touch-action:manipulation;pointer-events:auto;user-select:none;',
              'transition:all 0.08s;',
            ].join('');
            st.textContent = opt.label.toUpperCase();
            st.addEventListener('pointerup', (e) => {
              e.stopPropagation();
              mandState[g.key] = {
                key:   opt.key || opt.id,
                label: opt.label,
                price: opt.price || 0,
              };
              openSubKey = null;
              doneBtn.disabled = mandatoryGroups.some((g) => !mandState[g.key]);
              renderContent();
            });
            subGrid.appendChild(st);
          });

          sub.appendChild(subGrid);
          grid.appendChild(sub);
        }
      });

      body.appendChild(grid);
    }

    function _buildOptCard(actionArea, body, isExp) {
      // ── Prefix toolbar (expanded only) ───────────
      if (isExp) {
        PREFIX_MAP.forEach((p) => {
          let isActive = activePrefix === p.id;
          const btn = document.createElement('button');
          btn.style.cssText = [
            'padding:4px 11px;border-radius:6px;',
            `font-family:${T.fb};font-size:${T.fsB4};font-weight:700;`,
            'letter-spacing:0.5px;cursor:pointer;white-space:nowrap;',
            `border:1px solid ${(isActive ? p.color : T.border)};`,
            `background:${(isActive ? p.color : T.well)};`,
            `color:${(isActive ? p.textColor : T.text)};`,
            `box-shadow:0 3px 0 ${(isActive ? p.dk : T.moonDk)};`,
            'touch-action:manipulation;pointer-events:auto;',
          ].join('');
          btn.textContent = p.label;
          btn.addEventListener('pointerup', (e) => {
            e.stopPropagation();
            activePrefix = p.id;
            renderContent();
          });
          actionArea.appendChild(btn);
        });
      }

      // ── Placement bar (pizza only) ────────────────
      if (isPizza) {
        const placeBar = document.createElement('div');
        placeBar.style.cssText = [
          'display:flex;gap:3px;margin-bottom:10px;',
          `background:${T.well};border-radius:10px;padding:3px;`,
        ].join('');
        _PLACE_DEFS.forEach((pl) => {
          const isActive = activePlacement === pl.id;
          const seg = document.createElement('div');
          seg.style.cssText = [
            `flex:${(pl.id === 'WHOLE' ? 2 : 1)};text-align:center;`,
            'padding:7px 8px;border-radius:8px;cursor:pointer;',
            'pointer-events:auto;touch-action:manipulation;',
            `font-family:${T.fb};font-weight:700;font-size:${T.fsB4};letter-spacing:1px;`,
            `color:${(isActive ? T.well : T.moon)};`,
            `background:${(isActive ? catColor : 'transparent')};`,
            `box-shadow:${(isActive ? '0 3px 0 ' + hexToRgba(catColor, 0.55) : 'none')};`,
            'transition:all 120ms;',
          ].join('');
          seg.textContent = pl.label;
          seg.addEventListener('pointerup', () => {
            activePlacement = pl.id;
            renderContent();
          });
          placeBar.appendChild(seg);
        });
        body.appendChild(placeBar);
      }

      // ── Option tile grid ─────────────────────────
      const outerGrid = document.createElement('div');
      outerGrid.style.cssText = 'display:flex;flex-direction:column;gap:6px;';

      optionalGroups.forEach((g) => {
        if (g.label) {
          const secLbl = document.createElement('div');
          secLbl.style.cssText = [
            `font-family:${T.fb};font-size:${T.fsB4};font-weight:700;`,
            `letter-spacing:2px;color:${T.greenWarm};`,
            'margin-top:4px;margin-bottom:2px;',
            'display:flex;align-items:center;gap:8px;',
          ].join('');
          const line = document.createElement('div');
          line.style.cssText = 'height:1px;flex:1;background:rgba(74,222,128,0.2);';
          secLbl.textContent = g.label;
          secLbl.appendChild(line);
          outerGrid.appendChild(secLbl);
        }

        const tileGrid = document.createElement('div');
        tileGrid.style.cssText = [
          'display:grid;',
          'grid-template-columns:repeat(auto-fill,minmax(108px,1fr));',
          'gap:6px;',
        ].join('');

        (g.options || []).forEach((opt) => {
          const optId = opt.id || opt.key;
          const s     = optState[optId] || null;
          const pDef  = s ? PREFIX_MAP.find((p) => p.id===s.prefix) : null;

          const bg   = pDef ? pDef.color     : T.well;
          const fg   = pDef ? pDef.textColor : T.text;
          const shDk = pDef ? pDef.dk        : T.moonDk;

          const tile = document.createElement('div');
          tile.style.cssText = [
            'height:44px;border-radius:8px;',
            'display:flex;flex-direction:column;',
            'align-items:center;justify-content:center;gap:1px;',
            `font-family:${T.fb};font-weight:700;`,
            `background:${bg};color:${fg};`,
            `border:1px solid ${(s ? bg : T.border)};`,
            `box-shadow:0 3px 0 ${shDk};`,
            'cursor:pointer;touch-action:manipulation;pointer-events:auto;',
            'user-select:none;transition:all 0.08s;',
          ].join('');

          if (s && pDef) {
            const tag = document.createElement('span');
            tag.style.cssText = `font-size:${T.fsB4};font-weight:700;opacity:0.8;pointer-events:none;`;
            tag.textContent = pDef.label;
            tile.appendChild(tag);
          }
          const lbl = document.createElement('span');
          lbl.style.cssText = `font-size:${T.fsB3};pointer-events:none;`;
          lbl.textContent = opt.label;
          tile.appendChild(lbl);

          tile.addEventListener('pointerdown', () => {
            tile.style.transform='translateY(2px)';
            tile.style.boxShadow=`0 1px 0 ${shDk}`;
          });
          tile.addEventListener('pointerup', () => {
            tile.style.transform='';
            tile.style.boxShadow=`0 3px 0 ${shDk}`;
            if (optState[optId] && optState[optId].prefix===activePrefix) {
              delete optState[optId];
            } else {
              optState[optId] = { prefix: activePrefix, placement: activePlacement };
            }
            renderContent();
          });
          tile.addEventListener('pointerleave', () => {
            tile.style.transform='';
            tile.style.boxShadow=`0 3px 0 ${shDk}`;
          });
          tileGrid.appendChild(tile);
        });

        outerGrid.appendChild(tileGrid);
      });

      body.appendChild(outerGrid);
    }

    _buildActiveItem();
  }

  renderContent();
  container.appendChild(ov);

  return {
    destroy: () => {
      if (ov.parentNode) ov.parentNode.removeChild(ov);
    },
  };
}

function openModifierPanel(item, modConfig, catColor, enablePlacement, context) {
  context = context || {};
  const { mainArea, snakeState, onPanelInit } = context;

  if (!mainArea) return;

  const panelState = {
    modPanel: null,
    modPanelOpen: true,
    modPanelCatColor: catColor || T.green,
  };

  const panel = buildKindModPanel(mainArea, item, modConfig, catColor, enablePlacement, {
    onUpdate: (outputItem) => {
      if (onPanelInit && onPanelInit.onUpdate) {
        onPanelInit.onUpdate(outputItem);
      }
    },
    onSend: (activeItem) => {
      if (onPanelInit && onPanelInit.onSend) {
        onPanelInit.onSend(activeItem);
      }
      panelState.modPanel = null;
      panelState.modPanelOpen = false;
    },
    onCancel: () => {
      if (panel) panel.destroy();
      panelState.modPanel = null;
      panelState.modPanelOpen = false;
      if (onPanelInit && onPanelInit.onCancel) {
        onPanelInit.onCancel();
      }
    },
  }, snakeState);

  panelState.modPanel = panel;
  return panelState;
}

export { buildKindModPanel, openModifierPanel, _PLACE_DEFS };
