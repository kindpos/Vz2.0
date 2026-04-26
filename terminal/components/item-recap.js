// ═══════════════════════════════════════════════════
//  KINDpos Terminal — Item Recap Component  (Vz2.0)
//
//  Reusable DOM builder for the order recap column:
//  seat-grouped items with collapsible mods, microMODs,
//  multi-select, an inline red-X remove button for unsent
//  items, and a totals section.
//
//  Single export:
//    buildItemRecap(order, opts = {}) -> HTMLElement
//
//  opts:
//    onRemoveItem(seatIdx, itemIdx)  Callback when the red-X
//                                    button on an unsent item
//                                    is tapped. Only items with
//                                    `sent === false` render it.
//    compact                          Reserved for a simpler
//                                    check-preview variant that
//                                    may omit mods/microMODs and
//                                    the totals block. Plumbed
//                                    now; rendered later if we
//                                    confirm the preview surface
//                                    needs it.
//
//  Consumed by check-overview.js (Mode C left panel) and
//  later by order-entry.js (right recap column).
//
//  All styling is injected once into <head> as #item-recap-styles.
//  All colors flow from tokens.js — no hardcoded hex.
// ═══════════════════════════════════════════════════

import { T } from '../../common/tokens.js';

// ── Local hex → rgba helper ─────────────────────────
// Keeps every color derivation flowing from tokens.js instead of
// hardcoding #RRGGBBAA literals. Accepts '#RRGGBB'.
function _rgba(hex, a) {
  var r = parseInt(hex.slice(1, 3), 16);
  var g = parseInt(hex.slice(3, 5), 16);
  var b = parseInt(hex.slice(5, 7), 16);
  return 'rgba(' + r + ',' + g + ',' + b + ',' + a + ')';
}

// ── Style injection ─────────────────────────────────
// One <style id="item-recap-styles"> in <head>, shared by every
// recap instance. Idempotent — safe to call on every build.
function _ensureStyles() {
  if (document.getElementById('item-recap-styles')) return;

  var mintDim   = _rgba(T.green, 0.30);
  var mintDim2  = _rgba(T.green, 0.35);
  var mintDim5  = _rgba(T.green, 0.50);
  var textDim35 = _rgba(T.text, 0.35);
  var textDim38 = _rgba(T.text, 0.38);
  var textDim50 = _rgba(T.text, 0.50);
  var textDim55 = _rgba(T.text, 0.55);
  var textDim60 = _rgba(T.text, 0.60);

  var css = ''
    // ── Root scroll column ──
    + '.ir-root{'
    +   'background:' + T.bg + ';'
    +   'font-family:' + T.fb + ';'
    +   'color:' + T.text + ';'
    +   'padding:16px 14px 32px;'
    +   'max-width:400px;'
    +   'box-sizing:border-box;'
    +   'overflow-y:auto;'
    + '}'
    + '.ir-root *,.ir-root *::before,.ir-root *::after{'
    +   'box-sizing:border-box;margin:0;padding:0;'
    + '}'

    // ── Panel header ──
    + '.ir-panel-title{'
    +   'font-family:' + T.fh + ';'
    +   'font-size:13px;font-weight:700;'
    +   'color:' + T.green + ';letter-spacing:.16em;'
    + '}'
    + '.ir-panel-sub{'
    +   'font-size:9px;color:' + textDim38 + ';'
    +   'letter-spacing:.07em;margin-top:2px;'
    + '}'
    + '.ir-panel-rule{'
    +   'border:none;border-top:2px solid ' + T.green + ';'
    +   'margin:8px 0 12px;'
    + '}'

    // ── Seat group ──
    + '.ir-seat-group{margin-bottom:10px;}'
    + '.ir-seat-header{'
    +   'display:flex;align-items:center;gap:10px;'
    +   'padding:6px 10px 8px;'
    +   'cursor:pointer;user-select:none;'
    +   '-webkit-tap-highlight-color:transparent;'
    +   'background:' + T.card + ';'
    +   'border-radius:6px;'
    +   'border-bottom:1px dashed ' + mintDim2 + ';'
    +   'margin-bottom:6px;'
    + '}'
    + '.ir-seat-num{'
    +   'font-family:' + T.fh + ';'
    +   'font-size:36px;font-weight:700;'
    +   'color:var(--ir-seat-accent, ' + T.green + ');line-height:1;min-width:48px;'
    + '}'
    + '.ir-seat-meta{display:flex;flex-direction:column;gap:2px;flex:1;}'
    + '.ir-seat-label{'
    +   'font-size:9px;font-weight:700;letter-spacing:.16em;'
    +   'color:' + textDim35 + ';'
    + '}'
    + '.ir-seat-sub{font-size:11px;font-weight:700;color:' + T.gold + ';}'
    + '.ir-seat-chev{'
    +   'font-size:10px;color:' + T.green + ';font-weight:900;'
    +   'transition:transform 0.18s ease;flex-shrink:0;'
    + '}'
    + '.ir-seat-group.collapsed .ir-seat-chev{transform:rotate(-90deg);}'
    + '.ir-seat-group.collapsed .ir-seat-items{display:none;}'

    // ── Item card ──
    + '.ir-card{'
    +   'background:' + T.card + ';'
    +   'border:1px solid ' + T.border + ';'
    +   'border-top:2px solid ' + T.green + ';'
    +   'border-radius:6px;margin-bottom:5px;overflow:hidden;'
    + '}'

    // ── Item row ──
    + '.ir-item-row{'
    +   'display:flex;align-items:center;gap:6px;'
    +   'padding:8px 10px;'
    +   'cursor:pointer;user-select:none;'
    +   '-webkit-tap-highlight-color:transparent;'
    +   'transition:background 0.12s;'
    + '}'
    + '.ir-chev{'
    +   'color:' + T.green + ';font-size:8px;width:10px;flex-shrink:0;'
    +   'transition:color 0.12s,transform 0.15s;'
    + '}'
    + '.ir-card.collapsed .ir-chev{transform:rotate(-90deg);}'
    + '.ir-card .ir-mods{display:none;}'
    + '.ir-iname{'
    +   'flex:1;font-size:12px;font-weight:700;color:' + T.text + ';'
    +   'letter-spacing:.01em;transition:color 0.12s;'
    + '}'
    + '.ir-iprice{'
    +   'font-size:12px;font-weight:700;color:' + T.gold + ';'
    +   'flex-shrink:0;margin-left:12px;transition:color 0.12s;'
    + '}'
    + '.ir-qty{'
    +   'background:' + T.elec + ';color:' + T.well + ';'
    +   'font-size:9px;font-weight:700;'
    +   'padding:0 4px;height:14px;border-radius:3px;'
    +   'display:inline-flex;align-items:center;flex-shrink:0;'
    +   'transition:background 0.12s,color 0.12s;'
    + '}'

    // ── Item selected ──
    // Background falls through to the consumer-set --ir-accent-selected
    // custom property so each check-overview seat card can tint its own
    // selected rows with its per-seat accent. Defaults to T.green for
    // any caller that doesn't set the var. Text flips to T.well (dark)
    // for contrast on the light / mid-value accents.
    + '.ir-item-row.sel{background:var(--ir-accent-selected, ' + T.green + ');}'
    + '.ir-item-row.sel .ir-chev{color:' + T.well + ';}'
    + '.ir-item-row.sel .ir-iname{color:' + T.well + ';}'
    + '.ir-item-row.sel .ir-iprice{color:' + T.well + ';}'
    + '.ir-item-row.sel .ir-qty{background:' + T.well + ';color:var(--ir-accent-selected, ' + T.green + ');}'
    + '.ir-item-row.sel ~ .ir-mods{background:' + T.greenWarm + ';}'
    + '.ir-item-row.sel ~ .ir-mods .ir-mod-arrow{color:' + T.well + ';}'
    + '.ir-item-row.sel ~ .ir-mods .ir-mname{color:' + T.well + ';}'
    + '.ir-item-row.sel ~ .ir-mods .ir-mmod-arrow{color:' + T.well + ';}'
    + '.ir-item-row.sel ~ .ir-mods .ir-mmname{color:' + T.well + ';}'
    + '.ir-item-row.sel ~ .ir-mods .ir-up{color:' + T.well + ';}'
    + '.ir-item-row.sel ~ .ir-mods .ir-ups{color:' + T.well + ';}'
    + '.ir-item-row.sel ~ .ir-mods .ir-half-hdr{color:' + T.well + ';}'
    + '.ir-item-row.sel ~ .ir-mods .ir-half-name{color:' + T.well + ';}'
    + '.ir-item-row.sel ~ .ir-mods .ir-b{background:' + T.well + ';color:' + T.green + ';}'

    // ── Mods well ──
    + '.ir-mods{'
    +   'background:' + T.well + ';'
    +   'border-top:1px dashed ' + mintDim + ';'
    +   'padding:6px 0 8px;transition:background 0.12s;'
    + '}'

    // ── L1 MOD ──
    + '.ir-mod{'
    +   'display:flex;align-items:center;gap:5px;'
    +   'padding:4px 10px;'
    +   'cursor:pointer;user-select:none;'
    +   '-webkit-tap-highlight-color:transparent;'
    +   'transition:background 0.12s;'
    + '}'
    + '.ir-mod-arrow{'
    +   'font-size:10px;color:' + T.green + ';'
    +   'flex-shrink:0;width:12px;text-align:center;'
    +   'transition:color 0.12s;'
    + '}'
    + '.ir-mod.mand .ir-mname{color:var(--cat,' + T.green + ');}'
    + '.ir-mname{'
    +   'flex:1;font-size:11px;color:' + T.text + ';'
    +   'white-space:nowrap;overflow:hidden;text-overflow:ellipsis;'
    +   'transition:color 0.12s;'
    + '}'
    + '.ir-mod.sel{background:' + T.green + ';}'
    + '.ir-mod.sel .ir-mod-arrow{color:' + T.well + ';}'
    + '.ir-mod.sel .ir-mname{color:' + T.well + ';}'
    + '.ir-mod.sel .ir-up{color:' + T.well + ';}'
    + '.ir-mod.sel .ir-b{background:' + T.well + ';color:' + T.green + ';}'

    // ── L2 microMOD ──
    + '.ir-mmod{'
    +   'display:flex;align-items:center;gap:5px;'
    +   'padding:4px 10px 4px 26px;'
    +   'cursor:pointer;user-select:none;'
    +   '-webkit-tap-highlight-color:transparent;'
    +   'transition:background 0.12s;'
    + '}'
    + '.ir-mmod-arrow{'
    +   'font-size:10px;color:' + T.green + ';'
    +   'flex-shrink:0;width:12px;text-align:center;'
    +   'transition:color 0.12s;'
    + '}'
    + '.ir-mmname{'
    +   'flex:1;font-size:10px;color:' + T.text + ';'
    +   'white-space:nowrap;overflow:hidden;text-overflow:ellipsis;'
    +   'transition:color 0.12s;'
    + '}'
    + '.ir-mmod.sel{background:' + T.green + ';}'
    + '.ir-mmod.sel .ir-mmod-arrow{color:' + T.well + ';}'
    + '.ir-mmod.sel .ir-mmname{color:' + T.well + ';}'
    + '.ir-mmod.sel .ir-ups{color:' + T.well + ';}'
    + '.ir-mmod.sel .ir-b{background:' + T.well + ';color:' + T.green + ';}'

    // ── Upcharges ──
    + '.ir-up{font-size:11px;color:' + T.gold + ';flex-shrink:0;transition:color 0.12s;}'
    + '.ir-ups{font-size:10px;color:' + T.gold + ';flex-shrink:0;transition:color 0.12s;}'

    // ── Prefix badges ──
    + '.ir-b{'
    +   'display:inline-flex;align-items:center;justify-content:center;'
    +   'height:14px;padding:0 5px;border-radius:3px;'
    +   'font-size:9px;font-weight:700;letter-spacing:.06em;'
    +   'flex-shrink:0;white-space:nowrap;'
    +   'transition:background 0.12s,color 0.12s;'
    + '}'
    + '.ir-bno{background:' + T.verm + ';color:#fff;}'
    + '.ir-badd{background:' + T.greenWarm + ';color:' + T.well + ';}'
    + '.ir-bsub{background:' + T.elec + ';color:' + T.well + ';}'
    + '.ir-bext{background:' + T.gold + ';color:' + T.well + ';}'
    + '.ir-blit{'
    +   'background:transparent;color:' + textDim55 + ';'
    +   'border:1px solid ' + T.border + ';'
    + '}'

    // ── Pizza halves ──
    + '.ir-halves{'
    +   'display:grid;grid-template-columns:1fr 1fr;'
    +   'margin:4px 10px 2px 20px;'
    +   'border:1px solid ' + mintDim + ';'
    +   'border-radius:4px;overflow:hidden;'
    + '}'
    + '.ir-half{padding:5px 8px;}'
    + '.ir-half + .ir-half{border-left:1px solid ' + mintDim + ';}'
    + '.ir-half-hdr{'
    +   'font-size:8px;font-weight:700;letter-spacing:.14em;'
    +   'color:' + T.green + ';margin-bottom:4px;transition:color 0.12s;'
    + '}'
    + '.ir-half-row{display:flex;align-items:center;gap:4px;}'
    + '.ir-half-name{flex:1;font-size:10px;color:' + T.text + ';transition:color 0.12s;}'

    // ── Red X remove button (unsent items) ──
    + '.ir-xbtn{'
    +   'width:18px;height:18px;'
    +   'background:' + T.verm + ';color:#fff;'
    +   'border-radius:50%;'
    +   'font-family:' + T.fh + ';font-size:12px;font-weight:' + T.fwBold + ';line-height:1;'
    +   'display:inline-flex;align-items:center;justify-content:center;'
    +   'cursor:pointer;flex-shrink:0;user-select:none;'
    +   'box-shadow:0 1px 4px rgba(0,0,0,0.4);'
    +   '-webkit-tap-highlight-color:transparent;'
    + '}'

    // ── Sent-to-kitchen state ──
    // Items that have been dispatched to the kitchen use a warm-green
    // top border (vs the category color) and muted text so the cashier
    // can instantly distinguish "kitchen has it" from "still pending".
    + '.ir-card.ir-sent{border-top-color:' + T.greenWarm + ';}'
    + '.ir-card.ir-sent .ir-iname{color:' + textDim55 + ';}'
    + '.ir-card.ir-sent .ir-iprice{color:' + textDim55 + ';}'
    + '.ir-card.ir-sent .ir-chev{color:' + textDim50 + ';}'

    // ── Totals ──
    // Matches the seat-header card treatment: T.card dark bg + 6px
    // radius. Stands on its own when rendered outside the recap.
    + '.ir-totals{'
    +   'background:' + T.card + ';'
    +   'border-radius:6px;'
    +   'padding:10px 14px;'
    +   'margin-top:4px;'
    + '}'
    + '.ir-tr{'
    +   'display:flex;justify-content:space-between;align-items:baseline;'
    +   'padding:4px 1px;'
    + '}'
    + '.ir-tl{font-size:11px;letter-spacing:.09em;color:' + textDim50 + ';}'
    + '.ir-tv{font-size:12px;color:' + T.text + ';}'
    + '.ir-tv.ir-tv-gold{color:' + T.gold + ';}'
    + '.ir-tv.ir-tv-big{font-size:22px;font-weight:700;color:' + T.gold + ';}'
    + '.ir-tv.ir-tv-cash{font-size:22px;font-weight:700;color:' + T.greenWarm + ';}'
    + '.ir-tv.ir-tv-paid{font-size:12px;color:' + textDim60 + ';}'
    + '.ir-tl-strong{font-size:15px;font-weight:700;color:' + T.text + ';letter-spacing:.06em;}'
    + '.ir-tsep{'
    +   'border:none;border-top:1px dashed ' + mintDim + ';'
    +   'margin:6px 0 4px;'
    + '}'
    + '.ir-tsep2{'
    +   'border:none;border-top:1px solid ' + mintDim5 + ';'
    +   'margin:6px 0 4px;'
    + '}'

    // ── Upcharge strip (visible only when item card is collapsed) ──
    // Lists mods / microMods that carry an upcharge so the diner sees
    // where the price is coming from without expanding the card.
    + '.ir-upcharge-strip{'
    +   'display:none;flex-direction:column;gap:2px;'
    +   'padding:2px 10px 6px 26px;'
    + '}'
    + '.ir-card.collapsed .ir-upcharge-strip{display:flex;}'
    + '.ir-upcharge-row{'
    +   'display:flex;align-items:center;gap:5px;'
    +   'font-size:10px;color:' + textDim55 + ';'
    + '}'
    + '.ir-upcharge-row .ir-mod-arrow{font-size:9px;}'
    + '.ir-upcharge-row .ir-uc-name{'
    +   'flex:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;'
    + '}'
    + '.ir-upcharge-row .ir-up{margin-left:10px;}'

    // ── Tile-level inversion cascade ──
    // When a parent element carries .ir-inverted, every text node
    // inside the recap reads as T.well and card backgrounds fall
    // transparent so the parent tile's accent fill shows through.
    // Colored prefix badges (NO / ADD / EXTRA …) intentionally keep
    // their semantic colors — they remain readable.
    + '.ir-inverted{--ir-inv-text:' + T.well + ';}'
    + '.ir-inverted .ir-seat-num,'
    +   '.ir-inverted .ir-seat-label,'
    +   '.ir-inverted .ir-seat-sub,'
    +   '.ir-inverted .ir-iname,'
    +   '.ir-inverted .ir-iprice,'
    +   '.ir-inverted .ir-mname,'
    +   '.ir-inverted .ir-mmname,'
    +   '.ir-inverted .ir-up,'
    +   '.ir-inverted .ir-ups,'
    +   '.ir-inverted .ir-half-hdr,'
    +   '.ir-inverted .ir-half-name,'
    +   '.ir-inverted .ir-uc-name,'
    +   '.ir-inverted .ir-chev,'
    +   '.ir-inverted .ir-seat-chev,'
    +   '.ir-inverted .ir-mod-arrow,'
    +   '.ir-inverted .ir-mmod-arrow{color:var(--ir-inv-text);}'
    + '.ir-inverted .ir-seat-header{background:rgba(0,0,0,0.15);'
    +   'border-bottom-color:rgba(0,0,0,0.25);}'
    + '.ir-inverted .ir-card{background:rgba(0,0,0,0.10);'
    +   'border-color:rgba(0,0,0,0.30);border-top-color:rgba(0,0,0,0.45);}'
    + '.ir-inverted .ir-mods{background:rgba(0,0,0,0.10);'
    +   'border-top-color:rgba(0,0,0,0.25);}'
    + '.ir-inverted .ir-halves{border-color:rgba(0,0,0,0.25);}'
    + '.ir-inverted .ir-half + .ir-half{border-left-color:rgba(0,0,0,0.25);}'
    + '.ir-inverted .ir-qty{background:var(--ir-inv-text);color:var(--ir-inv-bg,' + T.green + ');}'
  ;

  var style = document.createElement('style');
  style.id = 'item-recap-styles';
  style.textContent = css;
  document.head.appendChild(style);
}

// ── Totals block ──
// t = { subtotal, upcharges, tax, paid, total, cash, taxRate }
// taxRate is a fraction (0.07 = 7%). All money fields are dollars.
function _buildTotals(t) {
  t = t || {};
  var wrap = document.createElement('div');
  wrap.className = 'ir-totals';

  function _row(label, value, labelCls, valueCls) {
    var tr = document.createElement('div');
    tr.className = 'ir-tr';
    var l = document.createElement('span');
    l.className = labelCls || 'ir-tl';
    l.textContent = label;
    var v = document.createElement('span');
    v.className = valueCls || 'ir-tv';
    v.textContent = value;
    tr.appendChild(l);
    tr.appendChild(v);
    return tr;
  }
  function _sep(cls) {
    var hr = document.createElement('hr');
    hr.className = cls;
    return hr;
  }

  wrap.appendChild(_row('SUBTOTAL', _fmt(t.subtotal)));
  wrap.appendChild(_row('UPCHARGES', '+' + _fmt(t.upcharges), 'ir-tl', 'ir-tv ir-tv-gold'));
  var taxPct = t.taxRate != null ? (Math.round(t.taxRate * 1000) / 10) : null;
  var taxLbl = taxPct != null ? 'TAX (' + taxPct + '%)' : 'TAX';
  wrap.appendChild(_row(taxLbl, _fmt(t.tax)));
  wrap.appendChild(_sep('ir-tsep'));
  wrap.appendChild(_row('PAID', _fmt(t.paid), 'ir-tl', 'ir-tv ir-tv-paid'));
  wrap.appendChild(_sep('ir-tsep'));
  wrap.appendChild(_row('TOTAL', _fmt(t.total), 'ir-tl-strong', 'ir-tv ir-tv-big'));
  wrap.appendChild(_sep('ir-tsep2'));
  wrap.appendChild(_row('CASH', _fmt(t.cash), 'ir-tl-strong', 'ir-tv ir-tv-cash'));

  return wrap;
}

// ── Pizza halves grid ──
// halves = { first: [mod...], second: [mod...] }
// Each entry accepts { name, prefix, upcharge }.
function _buildHalves(halves) {
  var grid = document.createElement('div');
  grid.className = 'ir-halves';

  var pairs = [
    { label: '1ST HALF', list: halves.first  || [] },
    { label: '2ND HALF', list: halves.second || [] },
  ];

  for (var p = 0; p < pairs.length; p++) {
    var half = document.createElement('div');
    half.className = 'ir-half';

    var hdr = document.createElement('div');
    hdr.className = 'ir-half-hdr';
    hdr.textContent = pairs[p].label;
    half.appendChild(hdr);

    var list = pairs[p].list;
    for (var i = 0; i < list.length; i++) {
      var item = list[i];
      var row = document.createElement('div');
      row.className = 'ir-half-row';

      var badge = _buildBadge(item.prefix);
      if (badge) row.appendChild(badge);

      var name = document.createElement('span');
      name.className = 'ir-half-name';
      name.textContent = item.name || '';
      row.appendChild(name);

      if (item.upcharge && item.upcharge > 0) {
        var up = document.createElement('span');
        up.className = 'ir-ups';
        up.textContent = '+' + _fmt(item.upcharge);
        row.appendChild(up);
      }

      half.appendChild(row);
    }

    grid.appendChild(half);
  }

  return grid;
}

// ── Prefix badge ──
// Maps prefix codes to class + display copy. Unknown / null
// prefixes return null so the caller can skip appending.
var _BADGE_MAP = {
  'NO':      { cls: 'ir-bno',  copy: 'NO' },
  'ADD':     { cls: 'ir-badd', copy: 'ADD' },
  'SUB':     { cls: 'ir-bsub', copy: 'SUB' },
  'EXTRA':   { cls: 'ir-bext', copy: 'EXTRA' },
  'ON SIDE': { cls: 'ir-bsub', copy: 'ON SIDE' },
  'LITE':    { cls: 'ir-blit', copy: 'LITE' },
};

function _buildBadge(prefix) {
  if (!prefix) return null;
  var spec = _BADGE_MAP[prefix];
  if (!spec) return null;
  var b = document.createElement('span');
  b.className = 'ir-b ' + spec.cls;
  b.textContent = spec.copy;
  return b;
}

// ── L2 microMOD row ──
function _buildMicroModRow(mm) {
  var r = document.createElement('div');
  r.className = 'ir-mmod';

  var arrow = document.createElement('span');
  arrow.className = 'ir-mmod-arrow';
  arrow.textContent = '↳';
  r.appendChild(arrow);

  var badge = _buildBadge(mm.prefix);
  if (badge) r.appendChild(badge);

  var name = document.createElement('span');
  name.className = 'ir-mmname';
  name.textContent = mm.name || '';
  r.appendChild(name);

  if (mm.upcharge && mm.upcharge > 0) {
    var up = document.createElement('span');
    up.className = 'ir-ups';
    up.textContent = '+' + _fmt(mm.upcharge);
    r.appendChild(up);
  }

  r.addEventListener('click', function(e) {
    e.stopPropagation();
    r.classList.toggle('sel');
  });

  return r;
}

// ── L1 MOD row ──
function _buildModRow(mod) {
  var r = document.createElement('div');
  r.className = 'ir-mod' + (mod.mandatory ? ' mand' : '');

  var arrow = document.createElement('span');
  arrow.className = 'ir-mod-arrow';
  arrow.textContent = '↳';
  r.appendChild(arrow);

  var badge = _buildBadge(mod.prefix);
  if (badge) r.appendChild(badge);

  var name = document.createElement('span');
  name.className = 'ir-mname';
  name.textContent = mod.name || '';
  r.appendChild(name);

  if (mod.upcharge && mod.upcharge > 0) {
    var up = document.createElement('span');
    up.className = 'ir-up';
    up.textContent = '+' + _fmt(mod.upcharge);
    r.appendChild(up);
  }

  r.addEventListener('click', function(e) {
    e.stopPropagation();
    r.classList.toggle('sel');
  });

  return r;
}

// ── Collect upcharge-bearing mods/microMods for the compact strip ──
// Returns a flat list of { prefix, name, upcharge } so the collapsed
// card can show just the price contributors.
function _collectUpchargeRows(mods) {
  var out = [];
  if (!Array.isArray(mods)) return out;
  for (var i = 0; i < mods.length; i++) {
    var m = mods[i];
    if (m && m.upcharge && m.upcharge > 0) {
      out.push({ prefix: m.prefix, name: m.name || '', upcharge: m.upcharge });
    }
    var mm = Array.isArray(m && m.microMods) ? m.microMods : [];
    for (var j = 0; j < mm.length; j++) {
      var x = mm[j];
      if (x && x.upcharge && x.upcharge > 0) {
        out.push({ prefix: x.prefix, name: x.name || '', upcharge: x.upcharge });
      }
    }
  }
  return out;
}

function _buildUpchargeStrip(rows) {
  var strip = document.createElement('div');
  strip.className = 'ir-upcharge-strip';
  for (var i = 0; i < rows.length; i++) {
    var row = rows[i];
    var r = document.createElement('div');
    r.className = 'ir-upcharge-row';

    var arrow = document.createElement('span');
    arrow.className = 'ir-mod-arrow';
    arrow.textContent = '↳';
    r.appendChild(arrow);

    var badge = _buildBadge(row.prefix);
    if (badge) r.appendChild(badge);

    var name = document.createElement('span');
    name.className = 'ir-uc-name';
    name.textContent = row.name;
    r.appendChild(name);

    var up = document.createElement('span');
    up.className = 'ir-up';
    up.textContent = '+' + _fmt(row.upcharge);
    r.appendChild(up);

    strip.appendChild(r);
  }
  return strip;
}

// ── Item card (item row only; mods/halves appended by later chunks) ──
function _buildItemCard(item, seatIdx, itemIdx, opts) {
  var card = document.createElement('div');
  card.className = item.sent ? 'ir-card ir-sent' : 'ir-card';
  card.style.setProperty('--cat', item.categoryColor || T.green);

  var row = document.createElement('div');
  row.className = 'ir-item-row';
  // When the consumer tracks selection across re-renders (check-overview's
  // state.selectedItems), seed the row's .sel class so the inverted
  // cascade persists after rerenderTopArea wipes and rebuilds the DOM.
  if (typeof opts.itemSelected === 'function' && opts.itemSelected(seatIdx, itemIdx)) {
    row.classList.add('sel');
  }

  var chev = document.createElement('span');
  chev.className = 'ir-chev';
  chev.textContent = '▼';
  row.appendChild(chev);

  if (item.qty && item.qty > 1) {
    var qty = document.createElement('span');
    qty.className = 'ir-qty';
    qty.textContent = item.qty + '×';
    row.appendChild(qty);
  }

  var name = document.createElement('span');
  name.className = 'ir-iname';
  name.textContent = (item.sent ? '✓ ' : '') + (item.name || '');
  row.appendChild(name);

  var price = document.createElement('span');
  price.className = 'ir-iprice';
  var q = item.qty || 1;
  price.textContent = _fmt(q * (item.price || 0));
  row.appendChild(price);

  // Red × remove button for unsent items. Tap swallows the event so
  // the row-collapse handler below doesn't fire. No-ops if the
  // consumer didn't wire an onRemoveItem callback.
  if (item.sent === false) {
    var xbtn = document.createElement('span');
    xbtn.className = 'ir-xbtn';
    xbtn.textContent = '×';
    xbtn.addEventListener('click', function(e) {
      e.stopPropagation();
      if (typeof opts.onRemoveItem === 'function') {
        opts.onRemoveItem(seatIdx, itemIdx);
      }
    });
    row.appendChild(xbtn);
  }

  card.appendChild(row);

  var mods = Array.isArray(item.mods) ? item.mods : [];
  var halves = item.halves;
  var hasHalves = halves && ((halves.first && halves.first.length) ||
                             (halves.second && halves.second.length));

  // Compact upcharge strip — only price-affecting mods. Visible only
  // when the card is collapsed so diners still see where the price
  // comes from without expanding.
  var upRows = _collectUpchargeRows(mods);
  if (upRows.length > 0) {
    card.appendChild(_buildUpchargeStrip(upRows));
  }

  if (mods.length > 0 || hasHalves) {
    var well = document.createElement('div');
    well.className = 'ir-mods';
    for (var i = 0; i < mods.length; i++) {
      well.appendChild(_buildModRow(mods[i]));
      var mmods = Array.isArray(mods[i].microMods) ? mods[i].microMods : [];
      for (var mi = 0; mi < mmods.length; mi++) {
        well.appendChild(_buildMicroModRow(mmods[mi]));
      }
    }
    if (hasHalves) well.appendChild(_buildHalves(halves));
    card.appendChild(well);
  }

  // Chevron alone opens details overlay
  chev.addEventListener('click', function(e) {
    e.stopPropagation();
    SceneManager.openTransactional('item-detail', { item: item });
  });

  // Row tap — toggles the visual .sel class and notifies the consumer
  row.addEventListener('click', function() {
    if (typeof opts.onItemTap === 'function') {
      row.classList.toggle('sel');
      opts.onItemTap(seatIdx, itemIdx);
    }
  });

  return card;
}

// ── Seat group (header only; items appended by later chunks) ──
function _buildSeatGroup(seat, seatIdx, opts) {
  opts = opts || {};
  var group = document.createElement('div');
  group.className = 'ir-seat-group';

  // Per-seat accent drives the seat-num color (.ir-seat-num uses
  // var(--ir-seat-accent, T.green)) AND tints this group's selected
  // item rows (.sel background uses var(--ir-accent-selected, T.green))
  // so each group in a multi-seat recap visually matches its sibling
  // tile in the grid.
  if (typeof opts.seatAccent === 'function') {
    var sa = opts.seatAccent(seatIdx);
    if (sa) {
      group.style.setProperty('--ir-seat-accent', sa);
      group.style.setProperty('--ir-accent-selected', sa);
    }
  }

  // Collapsible variant — groups start EXPANDED (items visible and
  // tappable on first paint, matching Mode A), and the compact header
  // remains a tap-to-toggle affordance so the cashier can hide detail
  // for dense multi-seat checks on demand.

  // When the consumer owns its own seat header (e.g. check-overview's
  // Mode A tile already renders S-num / SEAT / subtotal) we skip the
  // recap's internal header to avoid duplicating the same chrome.
  if (!opts.hideSeatHeader) {
    var header = document.createElement('div');
    header.className = 'ir-seat-header';

    var num = document.createElement('span');
    num.className = 'ir-seat-num';
    num.textContent = 'S' + seat.seatNumber;
    header.appendChild(num);

    if (opts.collapsible) {
      // Compact header: seat num on the left, subtotal flush right,
      // chevron at the end. Drops the 'SEAT' label + stacked meta
      // column so the subtotal sits directly next to the seat number
      // per the Mode B design.
      var subC = document.createElement('span');
      subC.className = 'ir-seat-sub';
      subC.style.marginLeft = 'auto';
      subC.textContent = _fmt(seat.subtotal);
      header.appendChild(subC);

      var chevC = document.createElement('span');
      chevC.className = 'ir-seat-chev';
      chevC.textContent = '›';
      header.appendChild(chevC);

      // Tap header → toggle collapse. Item-level selection is driven
      // by per-item taps (opts.onItemTap) and bulk-selection happens
      // at the consumer's seat tile.
      header.addEventListener('click', function() {
        group.classList.toggle('collapsed');
      });
    } else {
      // Original layout — retained for order-summary and any other
      // consumer that hasn't opted into the collapsible flow.
      var meta = document.createElement('div');
      meta.className = 'ir-seat-meta';
      var label = document.createElement('span');
      label.className = 'ir-seat-label';
      label.textContent = 'SEAT';
      meta.appendChild(label);
      var sub = document.createElement('span');
      sub.className = 'ir-seat-sub';
      sub.textContent = _fmt(seat.subtotal);
      meta.appendChild(sub);
      header.appendChild(meta);

      var chev = document.createElement('span');
      chev.className = 'ir-seat-chev';
      chev.textContent = '›';
      header.appendChild(chev);

      header.addEventListener('click', function() {
        var all = group.querySelectorAll('.ir-item-row, .ir-mod, .ir-mmod');
        var allSelected = all.length > 0;
        for (var i = 0; i < all.length; i++) {
          if (!all[i].classList.contains('sel')) { allSelected = false; break; }
        }
        for (var j = 0; j < all.length; j++) {
          all[j].classList.toggle('sel', !allSelected);
        }
        if (typeof opts.onSeatHeaderTap === 'function') {
          opts.onSeatHeaderTap(seatIdx, !allSelected);
        }
      });
    }

    group.appendChild(header);
  }

  var items = document.createElement('div');
  items.className = 'ir-seat-items';
  group.appendChild(items);

  return group;
}

// ── $ formatter (dollars in, "$X.XX" out) ─────────
function _fmt(n) { return '$' + (Number(n) || 0).toFixed(2); }

// ── Panel header: title + sub + rule ──────────────
function _buildPanelHeader(order) {
  var frag = document.createDocumentFragment();

  var title = document.createElement('div');
  title.className = 'ir-panel-title';
  title.textContent = 'ORDER RECAP';
  frag.appendChild(title);

  var parts = [];
  if (order.tableNum != null) parts.push('TABLE ' + order.tableNum);
  if (order.checkId)          parts.push('CHECK #' + order.checkId);
  if (order.server)           parts.push(String(order.server).toUpperCase());
  if (parts.length) {
    var sub = document.createElement('div');
    sub.className = 'ir-panel-sub';
    sub.textContent = parts.join(' · ');
    frag.appendChild(sub);
  }

  var rule = document.createElement('hr');
  rule.className = 'ir-panel-rule';
  frag.appendChild(rule);

  return frag;
}

export function buildItemRecap(order, opts) {
  opts = opts || {};
  order = order || {};
  _ensureStyles();

  var root = document.createElement('div');
  root.className = 'ir-root';
  if (!opts.hideHeader) {
    root.appendChild(_buildPanelHeader(order));
  }

  var seats = Array.isArray(order.seats) ? order.seats : [];
  for (var i = 0; i < seats.length; i++) {
    var group = _buildSeatGroup(seats[i], i, opts);
    var itemsWrap = group.querySelector('.ir-seat-items');
    var items = Array.isArray(seats[i].items) ? seats[i].items : [];
    for (var j = 0; j < items.length; j++) {
      itemsWrap.appendChild(_buildItemCard(items[j], i, j, opts));
    }
    root.appendChild(group);
  }

  if (order.totals && !opts.hideTotals) {
    root.appendChild(_buildTotals(order.totals));
  }

  return root;
}

// ── Standalone totals card ────────────────────────
// Same node _buildTotals produces, so callers can hoist the
// totals block out of the recap (e.g. into a bottom bar) while
// keeping the dark-bg card treatment.
export function buildItemRecapTotals(totals) {
  _ensureStyles();
  return _buildTotals(totals);
}
