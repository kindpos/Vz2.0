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

function buildKindModPanel(container, item, modConfig, catColor, enablePlacement, callbacks, snakeStateParam) {
  modConfig = modConfig || {};
  let includedItems   = modConfig.includedItems   || [];
  let mandatoryGroups = modConfig.mandatoryGroups || [];
  let optionalGroups  = modConfig.optionalGroups  || [];
  const snakeState    = snakeStateParam || {};
  const isPizza = !!enablePlacement;

  // ── State ──────────────────────────────────────────
  const inclState  = {};   // mod.id  → 'NO'|'SIDE'
  const optState   = {};   // optId   → { prefix, placement, count? }
  const mandState  = {};   // groupKey → { key, label, price }
  let activePrefix    = 'ADD';
  let activePlacement = 'WHOLE';
  let inclPrefix      = 'NO';

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
  scroll.style.cssText = 'flex:1;overflow-y:auto;padding:8px 12px 10px;';
  ov.appendChild(scroll);

  // ── DONE button ─────────────────────────────────────
  const doneWrap = document.createElement('div');
  doneWrap.style.cssText = 'flex-shrink:0;padding:8px 12px 10px;';
  const doneBtn = buildPillButton({ label: 'DONE — ADD TO CHECK', color: T.green, textColor: T.well });
  doneBtn.style.width = '100%';
  doneBtn.style.fontSize = '16px';
  doneBtn.addEventListener('pointerup', () => { callbacks.onSend(_buildActiveItem()); });
  doneBtn.disabled = mandatoryGroups.some((g) => !mandState[g.key]);
  doneWrap.appendChild(doneBtn);
  ov.appendChild(doneWrap);

  // ── Flash helper ────────────────────────────────────
  function _flashTile(tile, color, textColor, ms) {
    tile.style.background = color;
    tile.style.color = textColor || T.well;
    tile.style.transform = 'translateY(2px)';
    setTimeout(() => {
      tile.style.background = T.well;
      tile.style.color = T.text;
      tile.style.transform = '';
    }, ms || 260);
  }

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

      if (s.prefix === 'EXTRA' && s.count && s.count > 1) {
        optMods.push({ prefix: 'ADD',   label: found.label, price: resolvedPrice, placement: placeMap[s.placement] || null });
        for (let i = 1; i < s.count; i++) {
          optMods.push({ prefix: 'EXTRA', label: found.label, price: resolvedPrice, placement: placeMap[s.placement] || null });
        }
      } else {
        optMods.push({
          prefix:    s.prefix,
          label:     found.label,
          price:     resolvedPrice,
          placement: placeMap[s.placement] || null,
        });
      }
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

    // Crumb tiles
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

    // Item tile — tap to cancel
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

    // ── Flat sections ─────────────────────────────────
    const sectionsWrap = document.createElement('div');
    sectionsWrap.style.cssText = 'display:flex;flex-direction:column;gap:12px;padding:4px 0 10px;';

    // Helper: section header row with label + rule + optional buttons
    function _buildSectionHeader(label, color, buttonDefs) {
      const row = document.createElement('div');
      row.style.cssText = 'display:flex;align-items:center;gap:10px;margin-bottom:8px;';

      const lbl = document.createElement('span');
      lbl.style.cssText = [
        `font-family:${T.fb};font-size:${T.fsB4};font-weight:700;`,
        'letter-spacing:2px;flex-shrink:0;',
        `color:${color};`,
      ].join('');
      lbl.textContent = label;
      row.appendChild(lbl);

      const rule = document.createElement('div');
      rule.style.cssText = `flex:1;height:1px;background:${hexToRgba(color, 0.2)};`;
      row.appendChild(rule);

      if (buttonDefs && buttonDefs.length) {
        const btnGroup = document.createElement('div');
        btnGroup.style.cssText = 'display:flex;gap:5px;flex-shrink:0;';
        buttonDefs.forEach(({ pid, isActive, onClick }) => {
          const p = PREFIX_MAP.find((x) => x.id === pid);
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
          btn.addEventListener('pointerup', (e) => { e.stopPropagation(); onClick(); });
          btnGroup.appendChild(btn);
        });
        row.appendChild(btnGroup);
      }

      return row;
    }

    // Helper: section card with left border
    function _buildSectionCard(borderColor, bodyBuilder) {
      const card = document.createElement('div');
      card.style.cssText = [
        `background:${T.card};`,
        'border-radius:10px;overflow:hidden;flex-shrink:0;',
        `border-left:4px solid ${borderColor};`,
        'box-shadow:0 4px 12px rgba(0,0,0,0.25);',
        'padding:8px 10px 10px;',
      ].join('');
      const body = document.createElement('div');
      bodyBuilder(body);
      card.appendChild(body);
      return card;
    }

    // ── INCLUDED section ─────────────────────────────
    if (includedItems.length > 0) {
      const inclSection = document.createElement('div');

      inclSection.appendChild(_buildSectionHeader('INCLUDED', T.green, [
        { pid:'NO',   isActive: inclPrefix === 'NO',   onClick: () => { inclPrefix = inclPrefix === 'NO'   ? null : 'NO';   renderContent(); } },
        { pid:'SIDE', isActive: inclPrefix === 'SIDE', onClick: () => { inclPrefix = inclPrefix === 'SIDE' ? null : 'SIDE'; renderContent(); } },
      ]));

      inclSection.appendChild(_buildSectionCard(T.green, (body) => {
        if (modConfig.includedLabel) {
          const gl = document.createElement('div');
          gl.style.cssText = [
            `font-family:${T.fb};font-size:${T.fsB4};font-weight:700;`,
            `letter-spacing:1.5px;color:${T.moon};margin-bottom:6px;`,
          ].join('');
          gl.textContent = modConfig.includedLabel;
          body.appendChild(gl);
        }
        _buildInclCard(body);
      }));

      sectionsWrap.appendChild(inclSection);
    }

    // ── MANDATORY section ────────────────────────────
    if (mandatoryGroups.length > 0) {
      const mandSection = document.createElement('div');

      mandSection.appendChild(_buildSectionHeader('MANDATORY', T.gold, null));

      mandatoryGroups.forEach((g) => {
        mandSection.appendChild(_buildSectionCard(mandState[g.key] ? T.gold : T.border, (body) => {
          _buildMandCard(g, body);
        }));
      });

      sectionsWrap.appendChild(mandSection);
    }

    // ── OPTIONAL section ─────────────────────────────
    {
      const optSection = document.createElement('div');

      // Build optional header manually to accommodate the toolbar separator
      const optHdr = document.createElement('div');
      optHdr.style.cssText = 'display:flex;align-items:center;gap:10px;margin-bottom:8px;';

      const optLbl = document.createElement('span');
      optLbl.style.cssText = [
        `font-family:${T.fb};font-size:${T.fsB4};font-weight:700;`,
        'letter-spacing:2px;flex-shrink:0;',
        `color:${T.greenWarm};`,
      ].join('');
      optLbl.textContent = 'OPTIONAL';
      optHdr.appendChild(optLbl);

      const optRule = document.createElement('div');
      optRule.style.cssText = `flex:1;height:1px;background:${hexToRgba(T.greenWarm, 0.2)};`;
      optHdr.appendChild(optRule);

      const optToolbar = document.createElement('div');
      optToolbar.style.cssText = 'display:flex;align-items:center;gap:5px;flex-shrink:0;';

      ['ADD', 'EXTRA', 'LITE'].forEach((pid) => {
        const p = PREFIX_MAP.find((x) => x.id === pid);
        const isActive = activePrefix === pid;
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
        btn.addEventListener('pointerup', (e) => { e.stopPropagation(); activePrefix = pid; renderContent(); });
        optToolbar.appendChild(btn);
      });

      const toolSep = document.createElement('div');
      toolSep.style.cssText = `width:1px;height:20px;background:${T.border};flex-shrink:0;`;
      optToolbar.appendChild(toolSep);

      ['NO', 'SIDE'].forEach((pid) => {
        const p = PREFIX_MAP.find((x) => x.id === pid);
        const isActive = activePrefix === pid;
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
        btn.addEventListener('pointerup', (e) => { e.stopPropagation(); activePrefix = pid; renderContent(); });
        optToolbar.appendChild(btn);
      });

      optHdr.appendChild(optToolbar);
      optSection.appendChild(optHdr);

      optSection.appendChild(_buildSectionCard(T.greenWarm, (body) => {
        _buildOptCard(body);
      }));

      sectionsWrap.appendChild(optSection);
    }

    scroll.appendChild(sectionsWrap);
    scroll.scrollTop = savedTop;

    _buildActiveItem();
  }

  // ── _buildInclCard ──────────────────────────────────
  function _buildInclCard(body) {
    const grid = document.createElement('div');
    grid.style.cssText = [
      'display:grid;',
      'grid-template-columns:repeat(auto-fill,minmax(108px,1fr));',
      'gap:6px;',
    ].join('');

    includedItems.forEach((inc) => {
      const tile = document.createElement('div');
      tile.style.cssText = [
        'height:44px;border-radius:8px;',
        'display:flex;flex-direction:column;',
        'align-items:center;justify-content:center;gap:1px;',
        `font-family:${T.fb};font-weight:700;`,
        `background:${T.well};color:${T.text};`,
        `border:1px solid ${T.border};`,
        `box-shadow:0 3px 0 ${T.moonDk};`,
        'cursor:pointer;touch-action:manipulation;pointer-events:auto;',
        'user-select:none;',
      ].join('');

      const lbl = document.createElement('span');
      lbl.style.cssText = `font-size:${T.fsB3};pointer-events:none;`;
      lbl.textContent = inc.label;
      tile.appendChild(lbl);

      tile.addEventListener('pointerdown', () => {
        tile.style.transform = 'translateY(2px)';
        tile.style.boxShadow = `0 1px 0 ${T.moonDk}`;
      });
      tile.addEventListener('pointerup', () => {
        tile.style.transform = '';
        tile.style.boxShadow = `0 3px 0 ${T.moonDk}`;
        if (!inclPrefix) return;
        const cur = inclState[inc.id];
        if (cur === inclPrefix) { delete inclState[inc.id]; }
        else { inclState[inc.id] = inclPrefix; }
        const p = PREFIX_MAP.find((x) => x.id === inclPrefix);
        if (p) _flashTile(tile, p.color, p.textColor, 280);
        _buildActiveItem();
      });
      tile.addEventListener('pointerleave', () => {
        tile.style.transform = '';
        tile.style.boxShadow = `0 3px 0 ${T.moonDk}`;
      });
      grid.appendChild(tile);
    });

    body.appendChild(grid);
  }

  // ── _buildMandCard ──────────────────────────────────
  function _buildMandCard(g, body) {
    const row = document.createElement('div');
    row.style.cssText = 'display:flex;align-items:flex-start;gap:12px;';

    const nameEl = document.createElement('div');
    nameEl.style.cssText = [
      `font-family:${T.fb};font-size:${T.fsB4};font-weight:700;`,
      'letter-spacing:1.5px;white-space:nowrap;flex-shrink:0;',
      'padding-top:8px;min-width:54px;',
      `color:${(g.required && !mandState[g.key]) ? T.modLite : T.moon};`,
    ].join('');
    nameEl.textContent = g.label;
    row.appendChild(nameEl);

    const grid = document.createElement('div');
    grid.style.cssText = [
      'display:grid;',
      'grid-template-columns:repeat(auto-fill,minmax(100px,1fr));',
      'gap:5px;flex:1;',
    ].join('');

    (g.options || []).forEach((opt) => {
      const optKey = opt.key || opt.id;
      const isSel  = !!(mandState[g.key] && mandState[g.key].key === optKey);
      const tile   = document.createElement('div');
      tile.style.cssText = [
        'height:36px;border-radius:6px;',
        'display:flex;align-items:center;justify-content:center;',
        `font-family:${T.fb};font-size:${T.fsB4};font-weight:700;`,
        'letter-spacing:0.3px;cursor:pointer;',
        `background:${(isSel ? T.gold : T.well)};`,
        `color:${(isSel ? T.well : T.text)};`,
        `border:1px solid ${(isSel ? T.gold : T.border)};`,
        `box-shadow:0 2px 0 ${(isSel ? T.goldDk : T.moonDk)};`,
        'touch-action:manipulation;pointer-events:auto;user-select:none;',
        'transition:all 0.08s;',
      ].join('');
      tile.textContent = opt.label.toUpperCase();

      tile.addEventListener('pointerdown', () => {
        tile.style.transform = 'translateY(2px)';
      });
      tile.addEventListener('pointerup', (e) => {
        e.stopPropagation();
        tile.style.transform = '';
        mandState[g.key] = {
          key:   opt.key || opt.id,
          label: opt.label,
          price: opt.price || 0,
        };
        doneBtn.disabled = mandatoryGroups.some((grp) => !mandState[grp.key]);
        renderContent();
      });
      tile.addEventListener('pointerleave', () => {
        tile.style.transform = '';
      });
      grid.appendChild(tile);
    });

    row.appendChild(grid);
    body.appendChild(row);
  }

  // ── _buildOptCard ────────────────────────────────────
  function _buildOptCard(body) {
    // ── Placement bar (pizza only) ────────────────────
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

    // ── Flat tile grid — all options from all groups ──
    const tileGrid = document.createElement('div');
    tileGrid.style.cssText = [
      'display:grid;',
      'grid-template-columns:repeat(auto-fill,minmax(108px,1fr));',
      'gap:6px;',
    ].join('');

    optionalGroups.forEach((g) => {
      (g.options || []).forEach((opt) => {
        const optId = opt.id || opt.key;

        const tile = document.createElement('div');
        tile.style.cssText = [
          'height:44px;border-radius:8px;',
          'display:flex;flex-direction:column;',
          'align-items:center;justify-content:center;gap:1px;',
          `font-family:${T.fb};font-weight:700;`,
          `background:${T.well};color:${T.text};`,
          `border:1px solid ${T.border};`,
          `box-shadow:0 3px 0 ${T.moonDk};`,
          'cursor:pointer;touch-action:manipulation;pointer-events:auto;',
          'user-select:none;',
        ].join('');

        const lbl = document.createElement('span');
        lbl.style.cssText = `font-size:${T.fsB3};pointer-events:none;`;
        lbl.textContent = opt.label;
        tile.appendChild(lbl);

        tile.addEventListener('pointerdown', () => {
          tile.style.transform = 'translateY(2px)';
          tile.style.boxShadow = `0 1px 0 ${T.moonDk}`;
        });
        tile.addEventListener('pointerup', () => {
          tile.style.transform = '';
          tile.style.boxShadow = `0 3px 0 ${T.moonDk}`;

          const pAdd   = PREFIX_MAP.find((p) => p.id === 'ADD');
          const pExtra = PREFIX_MAP.find((p) => p.id === 'EXTRA');
          const cur    = optState[optId] ? optState[optId].prefix : null;

          if (activePrefix === 'ADD') {
            if (!cur) {
              optState[optId] = { prefix: 'ADD', placement: activePlacement };
              _flashTile(tile, pAdd.color, pAdd.textColor, 280);
            } else if (cur === 'ADD') {
              optState[optId] = { prefix: 'EXTRA', placement: activePlacement, count: (optState[optId].count || 1) + 1 };
              _flashTile(tile, pExtra.color, pExtra.textColor, 280);
            } else if (cur === 'EXTRA') {
              optState[optId].count = (optState[optId].count || 1) + 1;
              _flashTile(tile, pExtra.color, pExtra.textColor, 280);
            } else {
              optState[optId] = { prefix: 'ADD', placement: activePlacement };
              _flashTile(tile, pAdd.color, pAdd.textColor, 280);
            }
          } else {
            const pActive = PREFIX_MAP.find((p) => p.id === activePrefix);
            if (cur === activePrefix) {
              delete optState[optId];
              _flashTile(tile, T.border, T.text, 180);
            } else {
              optState[optId] = { prefix: activePrefix, placement: activePlacement };
              if (pActive) _flashTile(tile, pActive.color, pActive.textColor, 280);
            }
          }
          _buildActiveItem();
        });
        tile.addEventListener('pointerleave', () => {
          tile.style.transform = '';
          tile.style.boxShadow = `0 3px 0 ${T.moonDk}`;
        });
        tileGrid.appendChild(tile);
      });
    });

    body.appendChild(tileGrid);
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
