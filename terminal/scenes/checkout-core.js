// ═══════════════════════════════════════════════════
//  KINDpos Terminal — Checkout Core
//  Shared builders for server-checkout + close-day scenes
//  Nice. Dependable. Yours.
// ═══════════════════════════════════════════════════

import { T } from '../../common/tokens.js';
import { showToast } from '../components.js';
import { fetchWithTimeout } from '../net.js';
import { SceneManager, defineScene } from '../scene-manager.js';
import { buildNumpad } from '../numpad.js';
import {
  buildCard,
  buildStaticCard,
  buildNavCard,
  buildActionCard,
  buildPillButton,
  hexToRgba,
} from '../theme-manager.js';

// Resolved at call time — captured default would never re-theme.
function CHROME() { return T.headerBg || T.green; }

// ── Layout constants ─────────────────────────────
export var CARD_GAP  = 8;
export var STRIP_H   = 28;
export var ACTION_H  = 48;
export var BANNER_H  = 36;
export var BEVEL     = 4;
export var CHAM      = 8;
export var SCENE_PAD = 13;
export var RED       = T.verm;

// ─────────────────────────────────────────────────
//  HELPERS
// ─────────────────────────────────────────────────

export function fmt(n) {
  n = n || 0;
  var abs = Math.abs(n).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return (n < 0 ? '\u2212$' : '$') + abs;
}

export function detailRow(label, value, valueColor) {
  var row = document.createElement('div');
  row.style.cssText = 'display:flex;justify-content:space-between;align-items:baseline;font-family:' + T.fb + ';padding:2px 0;';
  var lbl = document.createElement('span');
  lbl.style.cssText = 'font-size:' + T.fsB1 + ';color:' + T.green + ';';
  lbl.textContent = label;
  var val = document.createElement('span');
  val.style.cssText = 'font-size:' + T.fsB1 + ';color:' + (valueColor || T.gold) + ';font-weight:bold;';
  val.textContent = value;
  row.appendChild(lbl);
  row.appendChild(val);
  return row;
}

export function detailDivider() {
  var el = document.createElement('div');
  el.style.cssText = 'border-top:1px solid ' + T.bg + ';margin:4px 0;';
  return el;
}

export function buildMixBar(cashPct, cardPct) {
  var bar = document.createElement('div');
  bar.style.cssText = 'display:flex;height:16px;margin-top:8px;border-radius:4px;overflow:hidden;';
  var cashSeg = document.createElement('div');
  cashSeg.style.cssText = 'width:' + cashPct + '%;background:' + T.green + ';';
  var cardSeg = document.createElement('div');
  cardSeg.style.cssText = 'width:' + cardPct + '%;background:' + T.elec + ';';
  bar.appendChild(cashSeg);
  bar.appendChild(cardSeg);
  var labels = document.createElement('div');
  labels.style.cssText = 'display:flex;justify-content:space-between;font-family:' + T.fb + ';font-size:' + T.fsB2 + ';color:' + T.green + ';margin-top:2px;';
  labels.innerHTML = '<span>Cash ' + cashPct + '%</span><span>Card ' + cardPct + '%</span>';
  var wrap = document.createElement('div');
  wrap.appendChild(bar);
  wrap.appendChild(labels);
  return wrap;
}

// ─────────────────────────────────────────────────
//  CARD TILE (collapsed card in grid)
//  opts.onExpand(idx) — called on tap
// ─────────────────────────────────────────────────

export function buildCardTile(def, idx, opts) {
  var card = buildNavCard({
    accent: def.statusColor || T.green,
    showChevron: false,
    onClick: function(e) {
      if (e.target.closest && e.target.closest('[data-shortcut]')) return;
      if (opts && opts.onExpand) opts.onExpand(idx);
    }
  });
  card.style.background = T.well;
  card.style.padding    = '0';
  card.style.height     = '100%';
  card.style.display    = 'flex';
  card.style.flexDirection = 'column';
  card.style.overflow   = 'hidden';
  card.style.position   = 'relative';

  // Chrome header bar
  var hdr = document.createElement('div');
  hdr.style.cssText = 'background:' + CHROME() + ';padding:3px 8px;flex-shrink:0;';
  var hdrTxt = document.createElement('div');
  hdrTxt.style.cssText = 'font-family:' + T.fh + ';font-size:13px;color:' + (T.headerText || T.well) + ';letter-spacing:1px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;text-align:center;';
  hdrTxt.textContent = def.title;
  hdr.appendChild(hdrTxt);
  card.appendChild(hdr);

  // Body
  var body = document.createElement('div');
  body.style.cssText = 'flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:4px 8px;gap:1px;';

  var hero = document.createElement('div');
  hero.style.cssText = 'font-family:' + T.fb + ';font-size:26px;color:' + (def.heroColor || T.gold) + ';font-weight:bold;text-align:center;';
  hero.textContent = def.hero;
  body.appendChild(hero);

  var sub = document.createElement('div');
  sub.style.cssText = 'font-family:' + T.fb + ';font-size:16px;color:' + T.green + ';text-align:center;';
  sub.textContent = def.subtitle;
  body.appendChild(sub);

  var hint = document.createElement('div');
  hint.style.cssText = 'font-family:' + T.fb + ';font-size:14px;color:' + T.green + ';text-align:center;margin-top:1px;';
  hint.textContent = '\u25B8';
  body.appendChild(hint);

  card.appendChild(body);

  // Status dot
  var dot = document.createElement('div');
  dot.style.cssText = 'position:absolute;bottom:8px;right:8px;width:8px;height:8px;clip-path:circle(50%);background:' + (def.statusColor || T.elec) + ';opacity:' + (def.statusColor ? '1' : '0.4') + ';';
  card.appendChild(dot);

  // Shortcut buttons below body
  if (def.buildShortcuts) {
    var shortcuts = def.buildShortcuts();
    shortcuts.style.cssText += 'padding:0 8px 6px;flex-shrink:0;';
    card.appendChild(shortcuts);
  }

  return card;
}

// ─────────────────────────────────────────────────
//  CARD STRIP (thin collapsed label)
// ─────────────────────────────────────────────────

export function buildCardStrip(def, idx, opts) {
  var strip = document.createElement('div');
  strip.style.cssText = [
    'height:' + STRIP_H + 'px;',
    'display:flex;align-items:center;justify-content:space-between;',
    'padding:0 12px;cursor:pointer;',
    'background:' + T.well + ';',
    'border:1px solid ' + T.border + ';',
    'border-radius:4px;',
    'font-family:' + T.fb + ';',
    'user-select:none;-webkit-user-select:none;',
  ].join('');

  var lbl = document.createElement('span');
  lbl.style.cssText = 'font-size:' + T.fsB1 + ';color:' + T.green + ';';
  lbl.textContent = def.title;
  strip.appendChild(lbl);

  var val = document.createElement('span');
  val.style.cssText = 'font-size:' + T.fsB1 + ';color:' + T.elec + ';';
  val.textContent = def.hero;
  strip.appendChild(val);

  strip.addEventListener('pointerup', function() {
    if (opts && opts.onExpand) opts.onExpand(idx);
  });

  return strip;
}

// ─────────────────────────────────────────────────
//  CARD GRID (NxM grid of card tiles)
//  opts.columns — grid column count (2 or 3)
//  opts.onExpand(idx) — passed to each tile
// ─────────────────────────────────────────────────

export function buildCardGrid(defs, opts) {
  var cols = (opts && opts.columns) || 2;
  var rows = Math.ceil(defs.length / cols);
  var grid = document.createElement('div');
  grid.style.cssText = [
    'flex:1;',
    'display:grid;',
    'grid-template-columns:repeat(' + cols + ',1fr);',
    'grid-template-rows:repeat(' + rows + ',1fr);',
    'gap:' + CARD_GAP + 'px;',
  ].join('');

  defs.forEach(function(def, i) {
    grid.appendChild(buildCardTile(def, i, opts));
  });

  return grid;
}

// ─────────────────────────────────────────────────
//  EXPANDED CARD VIEW (one card fills area, siblings as strips)
//  opts.onExpand(idx) — for strip taps
//  opts.onCollapse() — for header tap
// ─────────────────────────────────────────────────

export function buildExpandedCard(defs, idx, opts) {
  var wrap = document.createElement('div');
  wrap.style.cssText = 'flex:1;display:flex;flex-direction:column;gap:4px;overflow:hidden;';

  for (var i = 0; i < idx; i++) {
    wrap.appendChild(buildCardStrip(defs[i], i, opts));
  }

  var card = buildStaticCard({ accent: T.green });
  card.style.background = T.well;
  card.style.padding    = '0';
  card.style.display    = 'flex';
  card.style.flexDirection = 'column';
  card.style.flex       = '1';
  card.style.overflow   = 'hidden';

  // Chrome header bar (tappable to collapse)
  var hdr = document.createElement('div');
  hdr.style.cssText = [
    'background:' + CHROME() + ';padding:5px 14px;flex-shrink:0;',
    'display:flex;justify-content:space-between;align-items:center;',
    'cursor:pointer;user-select:none;-webkit-user-select:none;',
  ].join('');
  var hTitle = document.createElement('span');
  hTitle.style.cssText = 'font-family:' + T.fh + ';font-size:16px;color:' + (T.headerText || T.well) + ';letter-spacing:1px;';
  hTitle.textContent = defs[idx].title;
  var hHint = document.createElement('span');
  hHint.style.cssText = 'font-family:' + T.fh + ';font-size:16px;color:' + (T.headerText || T.well) + ';';
  hHint.textContent = '\u25BE';
  hdr.appendChild(hTitle);
  hdr.appendChild(hHint);
  hdr.addEventListener('pointerup', function() {
    if (opts && opts.onCollapse) opts.onCollapse();
  });
  card.appendChild(hdr);

  var content = document.createElement('div');
  content.style.cssText = 'flex:1;overflow-y:auto;padding:12px 16px;display:flex;flex-direction:column;gap:4px;';
  defs[idx].buildExpanded(content);
  card.appendChild(content);

  wrap.appendChild(card);

  for (var j = idx + 1; j < defs.length; j++) {
    wrap.appendChild(buildCardStrip(defs[j], j, opts));
  }

  return wrap;
}

// ─────────────────────────────────────────────────
//  BLOCKER BANNER
//  messages — array of warning strings, empty = all clear
// ─────────────────────────────────────────────────

export function buildBlockerBanner(messages) {
  var el = document.createElement('div');
  el.style.cssText = [
    'flex-shrink:0;height:' + BANNER_H + 'px;',
    'display:flex;align-items:center;justify-content:center;',
    'font-family:' + T.fb + ';font-size:' + T.fsB1 + ';',
    'border-radius:4px;',
  ].join('');

  if (messages && messages.length > 0) {
    el.style.background = 'rgba(255,51,85,0.1)';
    el.style.border = '1px solid ' + RED;
    el.style.color = RED;
    el.textContent = '\u26A0 RESOLVE: ' + messages.join(' + ');
  } else {
    el.style.background = 'rgba(51,255,255,0.08)';
    el.style.border = '1px solid ' + T.elec;
    el.style.color = T.elec;
    el.textContent = '\u2713 ALL CLEAR \u2014 ready to finalize';
  }

  return el;
}

// ─────────────────────────────────────────────────
//  INLINE TIP-ADJUST PANEL
//  Same list+numpad UX as the `co-tip-adjust` transactional scene, but
//  mountable directly into a parent container (e.g. inside an expanded
//  card body on the server-checkout scene). Self-manages fetching and
//  re-rendering as tips get adjusted or zeroed. Parent scene gets told
//  when the last unadjusted tip is handled so it can refresh its own
//  state and collapse back to grid view.
//
//  opts:
//    serverId   — filters /day-summary to one server's checks (optional)
//    onAdjusted — fired after each successful tip adjustment (optional)
//    onAllDone  — fired when the last unadjusted tip is handled
//
//  Returns an HTMLElement — caller sets height/flex on its parent.
//  All tappable divs get explicit pointer-events:auto + touch-action.
// ─────────────────────────────────────────────────

export function buildTipAdjustInline(opts) {
  opts = opts || {};
  var serverId   = opts.serverId || null;
  var onAdjusted = opts.onAdjusted || function() {};
  var onAllDone  = opts.onAllDone  || function() {};

  var _selected = null;
  var _checks   = [];

  // Root — horizontal flex: list on left, numpad on right
  var root = document.createElement('div');
  root.style.cssText = [
    'flex:1;display:flex;gap:12px;',
    'min-height:0;overflow:hidden;',
    'pointer-events:auto;touch-action:manipulation;',
  ].join('');

  // ── LEFT: header + scrollable list ──
  var leftCol = document.createElement('div');
  leftCol.style.cssText = 'flex:1;display:flex;flex-direction:column;overflow:hidden;min-width:0;';

  var headerRow = document.createElement('div');
  headerRow.style.cssText = 'display:flex;justify-content:space-between;align-items:center;gap:8px;padding:0 0 8px;flex-shrink:0;';

  var title = document.createElement('div');
  title.style.cssText = 'font-family:' + T.fb + ';font-size:13px;color:' + T.warning + ';letter-spacing:0.1em;font-weight:700;';
  title.textContent = 'UNADJUSTED';

  var zeroBtn = buildPillButton({
    label: '$0 ALL',
    variant: 'verm',
    fontSize: T.fsB3,
    onClick: function() {
      var remaining = _checks.filter(function(c) { return c.tip_amount == null; }).length;
      if (remaining === 0) return;
      SceneManager.interrupt('co-zero-confirm', {
        onConfirm: function() {
          var url = '/api/v1/payments/zero-unadjusted';
          if (serverId) url += '?server_id=' + encodeURIComponent(serverId);
          fetchWithTimeout(url, { method: 'POST' }, 10000)
            .then(function(r) { return r.json(); })
            .then(function() {
              _selected = null;
              numpad.clear();
              hintEl.textContent = 'All done';
              loadChecks(function() { onAllDone(); });
            })
            .catch(function(err) {
              console.error('[KINDpos] Zero all failed:', err);
              showToast('Zero-all failed', { bg: T.verm });
            });
        },
        onCancel: function() {},
        params: { count: remaining },
      });
    },
  });
  zeroBtn.style.cssText += 'height:28px;flex-shrink:0;';
  zeroBtn.style.fontSize = '11px';
  zeroBtn.style.padding  = '0 14px';

  headerRow.appendChild(title);
  headerRow.appendChild(zeroBtn);
  leftCol.appendChild(headerRow);

  var listEl = document.createElement('div');
  listEl.style.cssText = 'flex:1;overflow-y:auto;display:flex;flex-direction:column;gap:4px;padding-right:4px;';
  leftCol.appendChild(listEl);

  root.appendChild(leftCol);

  // ── RIGHT: hint + numpad ──
  var rightCol = document.createElement('div');
  rightCol.style.cssText = 'flex-shrink:0;display:flex;flex-direction:column;align-items:center;gap:6px;';

  var hintEl = document.createElement('div');
  hintEl.style.cssText = 'font-family:' + T.fb + ';font-size:12px;color:' + hexToRgba(T.text, 0.6) + ';text-align:center;min-height:16px;letter-spacing:0.06em;';
  hintEl.textContent = 'Tap a check to adjust';
  rightCol.appendChild(hintEl);

  var numpad = buildNumpad({
    masked: false,
    maxDigits: 6,
    submitLabel: 'ent',
    displayFormat: function(digits) {
      var n = parseInt(digits || '0', 10);
      return '$' + (n / 100).toFixed(2);
    },
    canSubmit: function() { return _selected !== null; },
    onSubmit: function(digits) {
      if (!_selected) return;
      var tipAmount = parseInt(digits || '0', 10) / 100;
      var adjusting = _selected;
      _selected = null;
      numpad.clear();
      fetchWithTimeout('/api/v1/payments/tip-adjust', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          order_id:   adjusting.check_id,
          payment_id: adjusting.payment_id,
          tip_amount: tipAmount,
        }),
      }, 10000).then(function(r) {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        showToast('Tip adjusted', { bg: T.greenWarm });
        adjusting.tip_amount = tipAmount;
        onAdjusted();
        // Refetch to confirm server state, then auto-advance if possible
        loadChecks(function() {
          var next = _checks.find(function(c) { return c.tip_amount == null; });
          if (next) {
            _selectCheck(next);
          } else {
            hintEl.textContent = 'All done';
            onAllDone();
          }
        });
      }).catch(function() {
        showToast('Tip adjust failed', { bg: T.verm });
      });
    },
  });
  rightCol.appendChild(numpad);
  root.appendChild(rightCol);

  // ── Internal rendering ──
  function _selectCheck(check) {
    _selected = check;
    hintEl.textContent = (check.check_num || 'CHK') + ' \u2014 ' + fmt(check.amount || 0);
    numpad.clear();
    renderList();
  }

  function renderList() {
    listEl.innerHTML = '';
    var unadj = _checks.filter(function(c) { return c.tip_amount == null; });

    if (unadj.length === 0) {
      var done = document.createElement('div');
      done.style.cssText = 'font-family:' + T.fb + ';font-size:14px;color:' + T.greenWarm + ';text-align:center;padding:24px 8px;letter-spacing:0.08em;';
      done.textContent = '\u2713 All tips adjusted';
      listEl.appendChild(done);
      return;
    }

    unadj.forEach(function(check) {
      var isActive = _selected === check;
      var row = document.createElement('div');
      row.style.cssText = [
        'display:flex;justify-content:space-between;align-items:center;',
        'padding:10px 12px;cursor:pointer;',
        'background:' + (isActive ? hexToRgba(T.warning, 0.14) : T.well) + ';',
        'border:1.5px solid ' + (isActive ? T.warning : T.border) + ';',
        'border-radius:6px;',
        'transition:background 0.1s, border-color 0.1s;',
        // Custom tappable div — must explicitly claim pointer events.
        'pointer-events:auto;touch-action:manipulation;',
        'user-select:none;-webkit-user-select:none;',
      ].join('');

      var label = document.createElement('span');
      label.style.cssText = 'font-family:' + T.fb + ';font-size:13px;color:' + T.green + ';letter-spacing:0.06em;pointer-events:none;';
      label.textContent = check.check_num || 'CHK';

      var amt = document.createElement('span');
      amt.style.cssText = 'font-family:' + T.fb + ';font-size:13px;color:' + T.gold + ';font-weight:bold;pointer-events:none;';
      amt.textContent = fmt(check.amount || 0);

      row.appendChild(label);
      row.appendChild(amt);
      row.addEventListener('pointerup', function() { _selectCheck(check); });
      listEl.appendChild(row);
    });
  }

  function loadChecks(cb) {
    var url = '/api/v1/orders/day-summary';
    if (serverId) url += '?server_id=' + encodeURIComponent(serverId);
    fetchWithTimeout(url, {}, 10000)
      .then(function(r) { return r.json(); })
      .then(function(data) {
        var raw = data.checks || [];
        _checks = raw
          .filter(function(c) { return c.status === 'closed' && c.method === 'card'; })
          .map(function(c) {
            return {
              check_id:   c.checkId,
              check_num:  c.checkLabel || c.checkId,
              payment_id: c.paymentId,
              amount:     c.amount,
              tip_amount: c.adjusted ? c.tip : null,
            };
          });
        renderList();
        if (cb) cb();
      })
      .catch(function() {
        listEl.innerHTML = '';
        var err = document.createElement('div');
        err.style.cssText = 'font-family:' + T.fb + ';font-size:13px;color:' + T.verm + ';padding:16px;text-align:center;';
        err.textContent = 'Failed to load checks';
        listEl.appendChild(err);
      });
  }

  loadChecks();
  return root;
}

// ═══════════════════════════════════════════════════
//  CO SUB-SCENES — zero-confirm, manager-pin, tip numpads
// ═══════════════════════════════════════════════════

// ── Zero-confirm interrupt ───────────────────────
// params.count, params.onConfirm, params.onCancel, params.serverId (optional)

defineScene({
  name: 'co-zero-confirm',
  render: function(container, params) {
    container.style.cssText = 'display:flex;align-items:center;justify-content:center;';

    // Nostalgia landing-page card shell — verm accent marks
    // destructive intent.
    var shell = buildStaticCard({ accent: T.groups.confirmation.shellAccentDanger });
    shell.style.padding = '20px ' + T.scenePad + 'px ' + T.scenePad + 'px';
    shell.style.display       = 'flex';
    shell.style.flexDirection = 'column';
    shell.style.alignItems    = 'center';
    shell.style.gap           = '10px';
    shell.style.minWidth      = '280px';

    var lbl = document.createElement('div');
    lbl.style.cssText = 'font-family:' + T.fb + ';font-size:' + T.fsB2 + ';color:' + RED + ';letter-spacing:2px;margin-bottom:4px;';
    lbl.textContent = '// ZERO ALL TIPS //';
    shell.appendChild(lbl);

    var msg = document.createElement('div');
    msg.style.cssText = 'font-family:' + T.fb + ';font-size:' + T.fsB3 + ';color:' + T.green + ';text-align:center;';
    msg.textContent = 'Set ' + (params.count || 0) + ' unadjusted tip(s) to $0.00?';
    shell.appendChild(msg);

    // Destructive confirm — CONFIRM carries the verm (matches shell
    // accent signaling destruction). CANCEL uses ghost so the eye goes
    // to the destructive action first.
    var confirmBtn = buildPillButton({
      label:    'CONFIRM',
      variant:  T.groups.confirmation.confirmDelete,
      fontSize: T.fsB2,
      onClick:  function() { params.onConfirm(); },
    });
    confirmBtn.style.width           = '240px';
    confirmBtn.style.height          = '48px';
    confirmBtn.style.borderRadius    = '14px';
    confirmBtn.style.display         = 'flex';
    confirmBtn.style.alignItems      = 'center';
    confirmBtn.style.justifyContent  = 'center';
    shell.appendChild(confirmBtn);

    var cancelBtn = buildPillButton({
      label:    'CANCEL',
      variant:  T.groups.confirmation.cancel,
      fontSize: T.fsB3,
      onClick:  function() { params.onCancel(); },
    });
    cancelBtn.style.width           = '240px';
    cancelBtn.style.height          = '40px';
    cancelBtn.style.borderRadius    = '14px';
    cancelBtn.style.display         = 'flex';
    cancelBtn.style.alignItems      = 'center';
    cancelBtn.style.justifyContent  = 'center';
    shell.appendChild(cancelBtn);

    container.appendChild(shell);
  },
});

// ── Manager PIN gate interrupt ───────────────────
// params.onConfirm(data), params.onCancel

defineScene({
  name: 'co-manager-pin',
  render: function(container, params) {
    container.style.cssText = 'display:flex;align-items:center;justify-content:center;';
    var numpad = buildNumpad({
      maxDigits: 4,
      masked: true,
      onSubmit: function(pin) {
        fetchWithTimeout('/api/v1/auth/verify-pin', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ pin: pin }),
        }, 10000)
          .then(function(r) { return r.json(); })
          .then(function(data) {
            if (data.valid) {
              params.onConfirm(data);
            } else {
              numpad.setError('Invalid PIN');
            }
          })
          .catch(function() { numpad.setError('PIN check failed'); });
      },
      onCancel: function() { params.onCancel(); },
    });
    var shell = buildStaticCard({ accent: T.groups.auth.shellAccent });
    shell.style.padding = '20px 24px';
    shell.appendChild(numpad);
    container.appendChild(shell);
  },
});

// ── Tip adjustment transactional ─────────────────
// params.serverId (optional), params.onDone

defineScene({
  name: 'co-tip-adjust',
  render: function(container, params) {
    var _selected = null;
    var _checks = [];
    var _listEl = null;

    container.style.cssText = 'width:100%;height:100%;display:flex;gap:' + T.colGap + 'px;padding:8px ' + SCENE_PAD + 'px ' + SCENE_PAD + 'px;box-sizing:border-box;';

    // Left: check list
    var leftCol = document.createElement('div');
    leftCol.style.cssText = 'flex:1;display:flex;flex-direction:column;overflow:hidden;';

    var header = document.createElement('div');
    header.style.cssText = 'font-family:' + T.fh + ';font-size:18px;color:' + T.gold + ';letter-spacing:0.1em;margin-bottom:8px;';
    header.textContent = 'UNADJUSTED TIPS';
    leftCol.appendChild(header);

    _listEl = document.createElement('div');
    _listEl.style.cssText = 'flex:1;overflow-y:auto;display:flex;flex-direction:column;gap:4px;';
    leftCol.appendChild(_listEl);
    container.appendChild(leftCol);

    // Right: numpad
    var rightCol = document.createElement('div');
    rightCol.style.cssText = 'flex-shrink:0;display:flex;flex-direction:column;align-items:center;justify-content:center;';

    var hintEl = document.createElement('div');
    hintEl.style.cssText = 'font-family:' + T.fb + ';font-size:' + T.fsB3 + ';color:' + hexToRgba(T.text, 0.6) + ';margin-bottom:8px;text-align:center;';
    hintEl.textContent = 'Tap a check to adjust';
    rightCol.appendChild(hintEl);

    var numpad = buildNumpad({
      masked: false,
      maxDigits: 6,
      submitLabel: 'ent',
      displayFormat: function(digits) {
        var n = parseInt(digits || '0', 10);
        return '$' + (n / 100).toFixed(2);
      },
      canSubmit: function() { return _selected !== null; },
      onSubmit: function(digits) {
        if (!_selected) return;
        var tipAmount = parseInt(digits || '0', 10) / 100;
        var adjusting = _selected;
        _selected = null;
        fetchWithTimeout('/api/v1/payments/tip-adjust', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ order_id: adjusting.check_id, payment_id: adjusting.payment_id, tip_amount: tipAmount }),
        }, 10000).then(function(r) {
          if (r.ok) {
            showToast('Tip adjusted', { bg: T.greenWarm });
            adjusting.tip_amount = tipAmount;
            hintEl.textContent = 'Tap a check to adjust';
            numpad.clear();
            renderList();
          } else {
            showToast('Tip adjust failed', { bg: T.verm });
          }
        }).catch(function() { showToast('Tip adjust failed', { bg: T.verm }); });
      },
      onCancel: function() {
        SceneManager.closeTransactional('co-tip-adjust');
        if (params.onDone) params.onDone();
      },
    });
    rightCol.appendChild(numpad);
    container.appendChild(rightCol);

    function renderList() {
      _listEl.innerHTML = '';
      var unadj = _checks.filter(function(c) { return c.tip_amount == null; });
      if (unadj.length === 0) {
        var done = document.createElement('div');
        done.style.cssText = 'font-family:' + T.fb + ';font-size:18px;color:' + T.green + ';text-align:center;padding:20px;';
        done.textContent = '\u2713 All tips adjusted';
        _listEl.appendChild(done);
        return;
      }
      for (var i = 0; i < unadj.length; i++) {
        (function(check) {
          var row = document.createElement('div');
          var isActive = _selected === check;
          row.style.cssText = 'display:flex;justify-content:space-between;align-items:center;padding:8px 12px;cursor:pointer;background:' + (isActive ? T.bg3 : T.well) + ';border:2px solid ' + (isActive ? T.gold : T.border) + ';';
          row.style.background   = T.well;
          row.style.border       = '1px solid ' + T.border;
          row.style.borderRadius = '6px';
          row.style.boxShadow    = 'inset 0 2px 4px rgba(0,0,0,0.35)';

          var label = document.createElement('span');
          label.style.cssText = 'font-family:' + T.fb + ';font-size:16px;color:' + T.green + ';';
          label.textContent = check.check_num || 'CHK';

          var amt = document.createElement('span');
          amt.style.cssText = 'font-family:' + T.fb + ';font-size:16px;color:' + T.gold + ';font-weight:bold;';
          amt.textContent = fmt(check.amount || 0);

          row.appendChild(label);
          row.appendChild(amt);
          row.addEventListener('pointerup', function() {
            _selected = check;
            hintEl.textContent = (check.check_num || 'CHK') + ' \u2014 ' + fmt(check.amount || 0);
            numpad.clear();
            renderList();
          });
          _listEl.appendChild(row);
        })(unadj[i]);
      }
    }

    // Fetch unadjusted checks
    var url = '/api/v1/orders/day-summary';
    if (params.serverId) url += '?server_id=' + encodeURIComponent(params.serverId);
    fetchWithTimeout(url, {}, 10000).then(function(r) { return r.json(); }).then(function(data) {
      var raw = data.checks || [];
      _checks = raw.filter(function(c) { return c.status === 'closed' && c.method === 'card'; }).map(function(c) {
        return {
          check_id: c.checkId,
          check_num: c.checkLabel || c.checkId,
          payment_id: c.paymentId,
          amount: c.amount,
          tip_amount: c.adjusted ? c.tip : null,
        };
      });
      renderList();
    }).catch(function() {
      _listEl.innerHTML = '';
      var err = document.createElement('div');
      err.style.cssText = 'font-family:' + T.fb + ';font-size:16px;color:' + T.verm + ';padding:20px;text-align:center;';
      err.textContent = 'Failed to load checks';
      _listEl.appendChild(err);
    });
  },
});

// ═══════════════════════════════════════════════════
//  CO-ADJUST-SINGLE — single-check tip adjustment
//  Opened from Unadjusted Tips card row ADJUST buttons on server-checkout.
//  Unlike `co-tip-adjust` (which has a list + numpad for multiple checks),
//  this focuses on ONE check. User enters tip, hits submit, we POST to
//  /api/v1/payments/tip-adjust, close the transactional, and call onDone
//  so the parent scene can refresh and remove the row from its blocker list.
//
//  params:
//    check    — { check_id|checkId, check_label|checkLabel, amount,
//                 payment_id|paymentId, table_label|tableLabel, card_brand|cardBrand }
//    onDone   — fn(), called after successful POST (parent rebuilds state)
// ═══════════════════════════════════════════════════

defineScene({
  name: 'co-adjust-single',
  render: function(container, params) {
    var chk = params.check || {};
    var isEdit = params.mode === 'edit';
    // Normalize both snake_case and camelCase shapes so callers don't have to.
    var checkId    = chk.check_id    || chk.checkId    || '';
    var checkLabel = chk.check_label || chk.checkLabel || checkId;
    var paymentId  = chk.payment_id  || chk.paymentId  || null;
    var amount     = chk.amount      || 0;
    var tableLabel = chk.table_label || chk.tableLabel || '';
    var cardBrand  = chk.card_brand  || chk.cardBrand  || '';
    // Initial tip value as cents-string so the numpad can pre-fill from it.
    var initialTipCents = '';
    if (params.initialTip != null) {
      initialTipCents = Math.round(params.initialTip * 100).toString();
    }

    // Container fills the transactional layer and centers the row.
    container.style.cssText = [
      'width:100%;height:100%;',
      'display:flex;align-items:center;justify-content:center;',
    ].join('');

    // Horizontal row — info card on left, numpad on right. No outer
    // wrapping panel/border so the info card's gold border visually
    // anchors the left side and the numpad's chassis anchors the right.
    // align-items:center so the shorter info card sits vertically centered
    // against the taller numpad instead of stretching to match its height.
    var row = document.createElement('div');
    row.style.cssText = [
      'display:flex;flex-direction:row;align-items:center;gap:14px;',
    ].join('');

    // ── LEFT: warning-accented info card ──
    // Sizes to content (no stretch). Everything inside centered.
    var infoShell = buildCard({
      accent: T.warning,
      bg: T.well,
      padding: '18px 22px',
    });
    infoShell.card.style.display       = 'flex';
    infoShell.card.style.flexDirection = 'column';
    infoShell.card.style.alignItems    = 'center';
    infoShell.card.style.gap           = '14px';
    infoShell.card.style.width         = '240px';
    infoShell.card.style.boxSizing     = 'border-box';
    var infoCard = infoShell.card;

    var title = document.createElement('div');
    title.style.cssText = [
      'font-family:' + T.fh + ';font-size:14px;font-weight:700;',
      'color:' + T.warning + ';letter-spacing:2px;text-align:center;',
    ].join('');
    title.textContent = isEdit ? 'EDIT TIP' : 'ADJUST TIP';
    infoCard.appendChild(title);

    // Check info block — centered stack
    var info = document.createElement('div');
    info.style.cssText = [
      'width:100%;background:' + T.well + ';border-radius:8px;',
      'padding:12px 14px;box-sizing:border-box;',
      'display:flex;flex-direction:column;align-items:center;gap:4px;',
    ].join('');

    var lbl = document.createElement('div');
    lbl.style.cssText = 'font-family:' + T.fb + ';font-size:13px;font-weight:700;color:' + T.text + ';text-align:center;';
    lbl.textContent = (tableLabel ? tableLabel + ' \u2022 ' : '') + 'Check ' + checkLabel;
    info.appendChild(lbl);

    var amt = document.createElement('div');
    amt.style.cssText = 'font-family:' + T.fb + ';font-size:22px;font-weight:700;color:' + T.gold + ';text-align:center;';
    amt.textContent = fmt(amount);
    info.appendChild(amt);

    if (cardBrand) {
      var brand = document.createElement('div');
      brand.style.cssText = 'font-family:' + T.fb + ';font-size:11px;color:' + hexToRgba(T.text, 0.6) + ';text-align:center;';
      brand.textContent = cardBrand;
      info.appendChild(brand);
    }

    // In edit mode, show the current tip value so the user knows what they're correcting.
    if (isEdit && params.initialTip != null) {
      var currentTipRow = document.createElement('div');
      currentTipRow.style.cssText = [
        'margin-top:4px;padding-top:6px;border-top:1px solid ' + hexToRgba(T.text, 0.1) + ';',
        'display:flex;justify-content:space-between;',
        'font-family:' + T.fb + ';font-size:12px;',
      ].join('');
      var cLbl = document.createElement('span');
      cLbl.style.color = hexToRgba(T.text, 0.6);
      cLbl.textContent = 'current tip';
      var cAmt = document.createElement('span');
      cAmt.style.cssText = 'color:' + T.green + ';font-weight:700;';
      cAmt.textContent = fmt(params.initialTip);
      currentTipRow.appendChild(cLbl);
      currentTipRow.appendChild(cAmt);
      info.appendChild(currentTipRow);
    }

    infoCard.appendChild(info);

    var hint = document.createElement('div');
    hint.style.cssText = 'font-family:' + T.fb + ';font-size:11px;color:' + hexToRgba(T.text, 0.6) + ';letter-spacing:0.5px;text-align:center;';
    hint.textContent = isEdit ? 'correct the tip amount' : 'enter tip amount';
    infoCard.appendChild(hint);

    row.appendChild(infoShell.wrap);

    // ── RIGHT: numpad ──
    var numpad = buildNumpad({
      masked:      false,
      maxDigits:   6,
      submitLabel: 'ent',
      displayFormat: function(digits) {
        var n = parseInt(digits || '0', 10);
        return '$' + (n / 100).toFixed(2);
      },
      onSubmit: function(digits) {
        var tipAmount = parseInt(digits || '0', 10) / 100;
        fetchWithTimeout('/api/v1/payments/tip-adjust', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            order_id:   checkId,
            payment_id: paymentId,
            tip_amount: tipAmount,
          }),
        }, 10000).then(function(r) {
          if (!r.ok) throw new Error('HTTP ' + r.status);
          showToast('Tip adjusted', { bg: T.greenWarm });
          SceneManager.closeTransactional('co-adjust-single');
          if (params.onDone) params.onDone();
        }).catch(function() {
          numpad.setError && numpad.setError('Adjust failed');
          showToast('Tip adjust failed', { bg: T.verm });
        });
      },
      onCancel: function() {
        SceneManager.closeTransactional('co-adjust-single');
      },
    });
    row.appendChild(numpad);

    container.appendChild(row);
  },
});

// ═══════════════════════════════════════════════════
//  CO-FINALIZE-CONFIRM — final step confirmation interrupt
//  Opened after manager PIN verifies. Shows the take-home + cash-expected
//  totals so the server can visually verify them before the checkout is
//  sealed. CONFIRM fires params.onConfirm(); CANCEL fires params.onCancel.
//
//  params:
//    takeHome       — number, server's take-home total
//    cashExpected   — number, cash the server owes the drawer
//    employeeName   — string, for personalized confirmation text
//    onConfirm      — fn(), after final CONFIRM tap
//    onCancel       — fn(), back-out
// ═══════════════════════════════════════════════════

defineScene({
  name: 'co-finalize-confirm',
  render: function(container, params) {
    container.style.cssText = [
      'width:100%;height:100%;',
      'display:flex;align-items:center;justify-content:center;',
    ].join('');

    var shell = buildStaticCard({ accent: T.groups.confirmation.shellAccentOk });
    shell.style.display       = 'flex';
    shell.style.flexDirection = 'column';
    shell.style.gap           = '14px';
    shell.style.width         = '360px';
    shell.style.padding       = '24px 28px 28px 32px';
    shell.style.boxSizing     = 'border-box';
    var panel = shell;

    var title = document.createElement('div');
    title.style.cssText = [
      'font-family:' + T.fh + ';font-size:14px;font-weight:700;',
      'color:' + T.green + ';letter-spacing:2px;text-align:center;',
    ].join('');
    title.textContent = 'FINALIZE CHECKOUT';
    panel.appendChild(title);

    var sub = document.createElement('div');
    sub.style.cssText = 'font-family:' + T.fb + ';font-size:12px;color:' + hexToRgba(T.text, 0.6) + ';text-align:center;';
    sub.textContent = 'confirm these totals — this is final';
    panel.appendChild(sub);

    // Totals panel
    var totals = document.createElement('div');
    totals.style.cssText = [
      'background:' + T.well + ';border-radius:8px;padding:14px 16px;',
      'display:flex;flex-direction:column;gap:8px;',
    ].join('');

    var takeRow = document.createElement('div');
    takeRow.style.cssText = 'display:flex;justify-content:space-between;align-items:baseline;';
    var takeL = document.createElement('span');
    takeL.style.cssText = 'font-family:' + T.fb + ';font-size:13px;color:' + hexToRgba(T.text, 0.6) + ';letter-spacing:1px;';
    takeL.textContent = 'TAKE-HOME';
    var takeR = document.createElement('span');
    takeR.style.cssText = 'font-family:' + T.fb + ';font-size:20px;font-weight:700;color:' + T.green + ';';
    takeR.textContent = fmt(params.takeHome || 0);
    takeRow.appendChild(takeL);
    takeRow.appendChild(takeR);
    totals.appendChild(takeRow);

    var divider = document.createElement('div');
    divider.style.cssText = 'height:1px;background:' + hexToRgba(T.text, 0.1) + ';';
    totals.appendChild(divider);

    var cashRow = document.createElement('div');
    cashRow.style.cssText = 'display:flex;justify-content:space-between;align-items:baseline;';
    var cashL = document.createElement('span');
    cashL.style.cssText = 'font-family:' + T.fb + ';font-size:13px;color:' + hexToRgba(T.text, 0.6) + ';letter-spacing:1px;';
    cashL.textContent = 'CASH EXPECTED';
    var cashR = document.createElement('span');
    cashR.style.cssText = 'font-family:' + T.fb + ';font-size:20px;font-weight:700;color:' + T.gold + ';';
    cashR.textContent = fmt(params.cashExpected || 0);
    cashRow.appendChild(cashL);
    cashRow.appendChild(cashR);
    totals.appendChild(cashRow);

    panel.appendChild(totals);

    // Action buttons
    var btnRow = document.createElement('div');
    btnRow.style.cssText = 'display:flex;gap:10px;';

    var cancel = buildPillButton({
      label:    'CANCEL',
      variant:  T.groups.confirmation.cancel,
      fontSize: T.fsB2,
      onClick:  function() { if (params.onCancel) params.onCancel(); },
    });
    cancel.style.flex            = '1';
    cancel.style.height          = '48px';
    cancel.style.borderRadius    = '14px';
    cancel.style.display         = 'flex';
    cancel.style.alignItems      = 'center';
    cancel.style.justifyContent  = 'center';

    var confirm = buildPillButton({
      label:    'CONFIRM',
      variant:  T.groups.confirmation.confirmAffirm,
      fontSize: T.fsB2,
      onClick:  function() { if (params.onConfirm) params.onConfirm(); },
    });
    confirm.style.flex           = '1';
    confirm.style.height         = '48px';
    confirm.style.borderRadius   = '14px';
    confirm.style.display        = 'flex';
    confirm.style.alignItems     = 'center';
    confirm.style.justifyContent = 'center';

    btnRow.appendChild(cancel);
    btnRow.appendChild(confirm);
    panel.appendChild(btnRow);

    container.appendChild(shell);
  },
});

// ═══════════════════════════════════════════════════
//  CO-TRANSFER-PICKER — server picker for check transfers
//  Mounted as an interrupt when the server taps TRANSFER in the preview
//  panel. Fetches /api/v1/servers/clocked-in, filters out the current
//  server, and shows the rest as selectable tiles. CONFIRM fires
//  params.onConfirm(destinationServer); CANCEL fires params.onCancel.
//
//  params:
//    checks        — array of check objects being transferred (for header summary)
//    currentEmpId  — the originating employee's ID, filtered out of the picker
//    onConfirm     — fn(server), server is the full clocked-in record
//    onCancel      — fn()
// ═══════════════════════════════════════════════════

defineScene({
  name: 'co-transfer-picker',
  render: function(container, params) {
    container.style.cssText = [
      'width:100%;height:100%;',
      'display:flex;align-items:center;justify-content:center;',
    ].join('');

    var shell = buildStaticCard({ accent: T.groups.picker.shellAccent });
    shell.style.display       = 'flex';
    shell.style.flexDirection = 'column';
    shell.style.gap           = '14px';
    shell.style.width         = '640px';
    shell.style.maxWidth      = '92vw';
    shell.style.padding       = '24px 28px 28px 32px';
    shell.style.boxSizing     = 'border-box';
    var panel = shell;

    // Header
    var hdrRow = document.createElement('div');
    hdrRow.style.cssText = 'display:flex;justify-content:space-between;align-items:baseline;';

    var title = document.createElement('div');
    title.style.cssText = [
      'font-family:' + T.fh + ';font-size:14px;font-weight:700;',
      'color:' + T.elec + ';letter-spacing:2px;',
    ].join('');
    title.textContent = 'TRANSFER CHECKS';

    var dismissX = document.createElement('span');
    dismissX.style.cssText = [
      'font-family:' + T.fb + ';font-size:20px;color:' + hexToRgba(T.text, 0.6) + ';',
      'cursor:pointer;user-select:none;-webkit-user-select:none;',
      'pointer-events:auto;touch-action:manipulation;',
      'padding:0 4px;line-height:1;',
    ].join('');
    dismissX.textContent = '\u00D7';
    dismissX.addEventListener('pointerup', function() {
      if (params.onCancel) params.onCancel();
    });

    hdrRow.appendChild(title);
    hdrRow.appendChild(dismissX);
    panel.appendChild(hdrRow);

    // Summary of what's being transferred
    var checks = params.checks || [];
    var totalAmt = checks.reduce(function(s, c) { return s + (c.amount || 0); }, 0);
    var summary = document.createElement('div');
    summary.style.cssText = [
      'font-family:' + T.fb + ';font-size:13px;color:' + T.text + ';',
      'padding:10px 14px;background:' + T.well + ';border-radius:8px;',
      'display:flex;justify-content:space-between;align-items:baseline;',
    ].join('');
    var sL = document.createElement('span');
    sL.textContent = checks.length + (checks.length === 1 ? ' check' : ' checks') + ' \u2022 pick a server to receive';
    var sR = document.createElement('span');
    sR.style.cssText = 'font-family:' + T.fb + ';font-size:15px;font-weight:700;color:' + T.gold + ';';
    sR.textContent = '$' + totalAmt.toFixed(2);
    summary.appendChild(sL);
    summary.appendChild(sR);
    panel.appendChild(summary);

    // Server tile grid — populated asynchronously after fetch
    var grid = document.createElement('div');
    grid.style.cssText = [
      'display:grid;grid-template-columns:repeat(auto-fill, minmax(120px, 1fr));gap:10px;',
      'min-height:140px;max-height:340px;overflow-y:auto;',
      'touch-action:pan-y;overscroll-behavior:contain;',
      'padding:4px;',
    ].join('');

    var loading = document.createElement('div');
    loading.style.cssText = [
      'font-family:' + T.fb + ';font-size:13px;color:' + hexToRgba(T.text, 0.6) + ';',
      'grid-column:1 / -1;text-align:center;padding:40px 0;',
    ].join('');
    loading.textContent = 'loading servers\u2026';
    grid.appendChild(loading);
    panel.appendChild(grid);

    // Action buttons — CONFIRM starts disabled until a server is picked.
    var btnRow = document.createElement('div');
    btnRow.style.cssText = 'display:flex;gap:10px;margin-top:4px;';

    var cancel = buildPillButton({
      label:    'CANCEL',
      variant:  T.groups.picker.cancel,
      fontSize: T.fsB2,
      onClick:  function() { if (params.onCancel) params.onCancel(); },
    });
    cancel.style.flex            = '1';
    cancel.style.height          = '48px';
    cancel.style.borderRadius    = '14px';
    cancel.style.display         = 'flex';
    cancel.style.alignItems      = 'center';
    cancel.style.justifyContent  = 'center';

    var confirm = buildPillButton({
      label:    'CONFIRM',
      variant:  T.groups.picker.apply,
      fontSize: T.fsB2,
      onClick:  function() {
        if (!selectedServer) return;
        if (params.onConfirm) params.onConfirm(selectedServer);
      },
    });
    confirm.style.flex           = '1';
    confirm.style.height         = '48px';
    confirm.style.borderRadius   = '14px';
    confirm.style.display        = 'flex';
    confirm.style.alignItems     = 'center';
    confirm.style.justifyContent = 'center';
    confirm.setDisabled(true);

    // setDisabled on buildPillButton handles dim + not-allowed cursor.
    var updateConfirmStyle = function() { confirm.setDisabled(!selectedServer); };

    btnRow.appendChild(cancel);
    btnRow.appendChild(confirm);
    panel.appendChild(btnRow);
    container.appendChild(shell);

    // Fetch clocked-in servers + build tiles
    var selectedServer = null;
    fetchWithTimeout('/api/v1/servers/clocked-in', {}, 10000).then(function(r) {
      return r.ok ? r.json() : [];
    }).catch(function() {
      return [];
    }).then(function(allServers) {
      if (!Array.isArray(allServers)) allServers = [];
      // Filter out the originating server
      var candidates = allServers.filter(function(s) {
        return s.id !== params.currentEmpId && !s.checked_out;
      });

      grid.innerHTML = '';

      if (candidates.length === 0) {
        var empty = document.createElement('div');
        empty.style.cssText = [
          'font-family:' + T.fb + ';font-size:13px;color:' + hexToRgba(T.text, 0.6) + ';font-style:italic;',
          'grid-column:1 / -1;text-align:center;padding:30px 0;',
        ].join('');
        empty.textContent = 'no other servers clocked in';
        grid.appendChild(empty);
        return;
      }

      candidates.forEach(function(srv) {
        var tile = document.createElement('div');
        var isSel = false;
        var applyStyle = function() {
          tile.style.cssText = [
            'display:flex;flex-direction:column;align-items:center;justify-content:center;gap:4px;',
            'padding:14px 8px;border-radius:10px;',
            'background:' + (isSel ? hexToRgba(T.elec, 0.15) : T.well) + ';',
            'border:2px solid ' + (isSel ? T.elec : 'transparent') + ';',
            'cursor:pointer;user-select:none;-webkit-user-select:none;',
            'pointer-events:auto;touch-action:manipulation;',
            'transition:background 0.1s, border-color 0.1s;',
            'min-height:110px;',
          ].join('');
        };
        applyStyle();

        // Initials badge
        var initials = (srv.name || '?').split(/\s+/).map(function(w) { return w[0] || ''; }).join('').slice(0, 2).toUpperCase();
        var badge = document.createElement('div');
        badge.style.cssText = [
          'width:40px;height:40px;border-radius:999px;',
          'display:flex;align-items:center;justify-content:center;',
          'background:' + T.well + ';color:' + T.elec + ';',
          'font-family:' + T.fh + ';font-size:14px;font-weight:700;letter-spacing:1px;',
        ].join('');
        badge.textContent = initials;

        var name = document.createElement('div');
        name.style.cssText = 'font-family:' + T.fb + ';font-size:13px;font-weight:700;color:' + T.text + ';text-align:center;';
        name.textContent = srv.name || '(unnamed)';

        var role = document.createElement('div');
        role.style.cssText = 'font-family:' + T.fb + ';font-size:11px;color:' + hexToRgba(T.text, 0.6) + ';letter-spacing:0.5px;text-transform:uppercase;';
        role.textContent = srv.role || 'server';

        tile.appendChild(badge);
        tile.appendChild(name);
        tile.appendChild(role);

        tile.addEventListener('pointerup', function() {
          // Clear other selections
          Array.prototype.forEach.call(grid.children, function(child) {
            if (child._applyStyle) {
              child._isSel = false;
              child._applyStyle();
            }
          });
          isSel = true;
          applyStyle();
          selectedServer = srv;
          updateConfirmStyle();
        });

        // Expose selection hooks so we can clear from outside
        tile._isSel = false;
        tile._applyStyle = function() {
          isSel = tile._isSel;
          applyStyle();
        };

        grid.appendChild(tile);
      });
    });
  },
});

// ═══════════════════════════════════════════════════
//  CO-DISCOUNT-PICKER — preset discount tile picker
//  Mounted as an interrupt after manager PIN verifies. Shows a tile grid
//  of preset discounts. Tapping a tile selects; CONFIRM fires params.
//  onConfirm(discount). Discount shape:
//    { type: 'percent', value: 10 }   → 10% off
//    { type: 'amount',  value: 5 }    → $5 off
//    { type: 'comp',    value: 100 }  → comp (100% off)
//
//  params:
//    checks     — array of check objects being discounted (for summary)
//    onConfirm  — fn(discount)
//    onCancel   — fn()
// ═══════════════════════════════════════════════════

defineScene({
  name: 'co-discount-picker',
  render: function(container, params) {
    container.style.cssText = [
      'width:100%;height:100%;',
      'display:flex;align-items:center;justify-content:center;',
    ].join('');

    var shell = buildStaticCard({ accent: T.groups.picker.shellAccent });
    shell.style.display       = 'flex';
    shell.style.flexDirection = 'column';
    shell.style.gap           = '14px';
    shell.style.width         = '520px';
    shell.style.maxWidth      = '92vw';
    shell.style.padding       = '24px 28px 28px 32px';
    shell.style.boxSizing     = 'border-box';
    var panel = shell;

    // Header
    var hdrRow = document.createElement('div');
    hdrRow.style.cssText = 'display:flex;justify-content:space-between;align-items:baseline;';
    var title = document.createElement('div');
    title.style.cssText = 'font-family:' + T.fh + ';font-size:14px;font-weight:700;color:' + T.elec + ';letter-spacing:2px;';
    title.textContent = 'APPLY DISCOUNT';
    var dismissX = document.createElement('span');
    dismissX.style.cssText = [
      'font-family:' + T.fb + ';font-size:20px;color:' + hexToRgba(T.text, 0.6) + ';',
      'cursor:pointer;user-select:none;-webkit-user-select:none;',
      'pointer-events:auto;touch-action:manipulation;padding:0 4px;line-height:1;',
    ].join('');
    dismissX.textContent = '\u00D7';
    dismissX.addEventListener('pointerup', function() { if (params.onCancel) params.onCancel(); });
    hdrRow.appendChild(title);
    hdrRow.appendChild(dismissX);
    panel.appendChild(hdrRow);

    // Summary
    var checks = params.checks || [];
    var totalAmt = checks.reduce(function(s, c) { return s + (c.amount || 0); }, 0);
    var summary = document.createElement('div');
    summary.style.cssText = [
      'font-family:' + T.fb + ';font-size:13px;color:' + T.text + ';',
      'padding:10px 14px;background:' + T.well + ';border-radius:8px;',
      'display:flex;justify-content:space-between;align-items:baseline;',
    ].join('');
    var sL = document.createElement('span');
    sL.textContent = checks.length + (checks.length === 1 ? ' check' : ' checks') + ' \u2022 pick a discount';
    var sR = document.createElement('span');
    sR.style.cssText = 'font-family:' + T.fb + ';font-size:15px;font-weight:700;color:' + T.gold + ';';
    sR.textContent = '$' + totalAmt.toFixed(2);
    summary.appendChild(sL);
    summary.appendChild(sR);
    panel.appendChild(summary);

    // Preset tile grid — 4 cols × 2 rows
    var grid = document.createElement('div');
    grid.style.cssText = 'display:grid;grid-template-columns:repeat(4, 1fr);gap:8px;';

    var presets = [
      { type: 'percent', value: 10, label: '10% OFF' },
      { type: 'percent', value: 15, label: '15% OFF' },
      { type: 'percent', value: 20, label: '20% OFF' },
      { type: 'percent', value: 25, label: '25% OFF' },
      { type: 'amount',  value:  5, label: '$5 OFF'  },
      { type: 'amount',  value: 10, label: '$10 OFF' },
      { type: 'amount',  value: 15, label: '$15 OFF' },
      { type: 'comp',    value: 100, label: 'COMP'    },
    ];

    var selectedDiscount = null;
    var tiles = [];

    presets.forEach(function(preset) {
      var tile = document.createElement('div');
      var isSel = false;
      var applyStyle = function() {
        tile.style.cssText = [
          'display:flex;align-items:center;justify-content:center;',
          'padding:16px 8px;border-radius:10px;',
          'background:' + (isSel ? hexToRgba(T.groups.picker.optionSelected, 0.15) : T.well) + ';',
          'border:2px solid ' + (isSel ? T.groups.picker.optionSelected : 'transparent') + ';',
          'font-family:' + T.fh + ';font-size:14px;font-weight:700;',
          'color:' + (preset.type === 'comp' ? T.gold : T.text) + ';letter-spacing:0.5px;',
          'cursor:pointer;user-select:none;-webkit-user-select:none;',
          'pointer-events:auto;touch-action:manipulation;',
          'transition:background 0.1s, border-color 0.1s;',
          'min-height:56px;',
        ].join('');
      };
      applyStyle();
      tile.textContent = preset.label;

      tile.addEventListener('pointerup', function() {
        tiles.forEach(function(t) { t._deselect(); });
        isSel = true;
        applyStyle();
        selectedDiscount = preset;
        updateApplyStyle();
      });

      tile._deselect = function() { isSel = false; applyStyle(); };
      tiles.push(tile);
      grid.appendChild(tile);
    });

    panel.appendChild(grid);

    // Action buttons — APPLY disabled until a discount preset is picked.
    var btnRow = document.createElement('div');
    btnRow.style.cssText = 'display:flex;gap:10px;margin-top:4px;';

    var cancel = buildPillButton({
      label:    'CANCEL',
      variant:  T.groups.picker.cancel,
      fontSize: T.fsB2,
      onClick:  function() { if (params.onCancel) params.onCancel(); },
    });
    cancel.style.flex            = '1';
    cancel.style.height          = '48px';
    cancel.style.borderRadius    = '14px';
    cancel.style.display         = 'flex';
    cancel.style.alignItems      = 'center';
    cancel.style.justifyContent  = 'center';

    var apply = buildPillButton({
      label:    'APPLY',
      variant:  T.groups.picker.apply,
      fontSize: T.fsB2,
      onClick:  function() {
        if (!selectedDiscount) return;
        if (params.onConfirm) params.onConfirm(selectedDiscount);
      },
    });
    apply.style.flex           = '1';
    apply.style.height         = '48px';
    apply.style.borderRadius   = '14px';
    apply.style.display        = 'flex';
    apply.style.alignItems     = 'center';
    apply.style.justifyContent = 'center';
    apply.setDisabled(true);

    var updateApplyStyle = function() { apply.setDisabled(!selectedDiscount); };

    btnRow.appendChild(cancel);
    btnRow.appendChild(apply);
    panel.appendChild(btnRow);
    container.appendChild(shell);
  },
});

// ═══════════════════════════════════════════════════
//  CO-VOID-CONFIRM — void confirmation with reason picker
//  Mounted as an interrupt after manager PIN verifies. Shows the check(s)
//  being voided with a strong warning, then a reason radio list. CONFIRM
//  fires params.onConfirm(reason). No default reason — must pick one.
//
//  params:
//    checks     — array of check objects being voided
//    onConfirm  — fn(reason)
//    onCancel   — fn()
// ═══════════════════════════════════════════════════

defineScene({
  name: 'co-void-confirm',
  render: function(container, params) {
    container.style.cssText = [
      'width:100%;height:100%;',
      'display:flex;align-items:center;justify-content:center;',
    ].join('');

    var shell = buildStaticCard({ accent: T.groups.confirmation.shellAccentDanger });
    shell.style.display       = 'flex';
    shell.style.flexDirection = 'column';
    shell.style.gap           = '14px';
    shell.style.width         = '420px';
    shell.style.maxWidth      = '92vw';
    shell.style.padding       = '24px 28px 28px 32px';
    shell.style.boxSizing     = 'border-box';
    var panel = shell;

    // Header — verm-colored title signals destructive action
    var title = document.createElement('div');
    title.style.cssText = [
      'font-family:' + T.fh + ';font-size:14px;font-weight:700;',
      'color:' + T.verm + ';letter-spacing:2px;text-align:center;',
    ].join('');
    title.textContent = 'VOID CHECK';
    panel.appendChild(title);

    var sub = document.createElement('div');
    sub.style.cssText = 'font-family:' + T.fb + ';font-size:12px;color:' + hexToRgba(T.text, 0.6) + ';text-align:center;';
    sub.textContent = 'this cannot be undone';
    panel.appendChild(sub);

    // Summary of what's being voided
    var checks = params.checks || [];
    var totalAmt = checks.reduce(function(s, c) { return s + (c.amount || 0); }, 0);
    var summary = document.createElement('div');
    summary.style.cssText = [
      'font-family:' + T.fb + ';font-size:13px;color:' + T.text + ';',
      'padding:10px 14px;background:' + T.well + ';border-radius:8px;',
      'display:flex;justify-content:space-between;align-items:baseline;',
    ].join('');
    var sL = document.createElement('span');
    sL.textContent = 'voiding ' + checks.length + (checks.length === 1 ? ' check' : ' checks');
    var sR = document.createElement('span');
    sR.style.cssText = 'font-family:' + T.fb + ';font-size:15px;font-weight:700;color:' + T.gold + ';';
    sR.textContent = '$' + totalAmt.toFixed(2);
    summary.appendChild(sL);
    summary.appendChild(sR);
    panel.appendChild(summary);

    // Reason picker — radio-button list
    var reasonLabel = document.createElement('div');
    reasonLabel.style.cssText = 'font-family:' + T.fb + ';font-size:12px;color:' + hexToRgba(T.text, 0.6) + ';letter-spacing:1px;text-transform:uppercase;margin-top:4px;';
    reasonLabel.textContent = 'reason';
    panel.appendChild(reasonLabel);

    var reasonList = document.createElement('div');
    reasonList.style.cssText = 'display:flex;flex-direction:column;gap:6px;';

    var reasons = [
      'Customer walked out',
      'Duplicate order',
      'Wrong order',
      'Server error',
      'Other',
    ];

    var selectedReason = null;
    var reasonRows = [];

    reasons.forEach(function(reason) {
      var row = document.createElement('div');
      var isSel = false;
      var applyStyle = function() {
        row.style.cssText = [
          'display:flex;align-items:center;gap:10px;',
          'padding:10px 12px;border-radius:8px;',
          'background:' + (isSel ? hexToRgba(T.verm, 0.15) : T.well) + ';',
          'border:1.5px solid ' + (isSel ? T.verm : 'transparent') + ';',
          'cursor:pointer;user-select:none;-webkit-user-select:none;',
          'pointer-events:auto;touch-action:manipulation;',
          'transition:background 0.1s, border-color 0.1s;',
        ].join('');
      };
      applyStyle();

      var radio = document.createElement('div');
      var applyRadio = function() {
        radio.style.cssText = [
          'width:18px;height:18px;border-radius:999px;flex-shrink:0;',
          'border:2px solid ' + (isSel ? T.verm : hexToRgba(T.text, 0.3)) + ';',
          'background:' + (isSel ? T.verm : 'transparent') + ';',
          'display:flex;align-items:center;justify-content:center;',
        ].join('');
        radio.innerHTML = isSel ? '<div style="width:6px;height:6px;border-radius:999px;background:' + T.well + ';"></div>' : '';
      };
      applyRadio();

      var text = document.createElement('span');
      text.style.cssText = 'font-family:' + T.fb + ';font-size:13px;color:' + T.text + ';';
      text.textContent = reason;

      row.appendChild(radio);
      row.appendChild(text);

      row.addEventListener('pointerup', function() {
        reasonRows.forEach(function(r) { r._deselect(); });
        isSel = true;
        applyStyle();
        applyRadio();
        selectedReason = reason;
        updateConfirmStyle();
      });

      row._deselect = function() { isSel = false; applyStyle(); applyRadio(); };
      reasonRows.push(row);
      reasonList.appendChild(row);
    });

    panel.appendChild(reasonList);

    // Action buttons — VOID stays verm (destructive) and disabled until
    // a reason is picked.
    var btnRow = document.createElement('div');
    btnRow.style.cssText = 'display:flex;gap:10px;margin-top:4px;';

    var cancel = buildPillButton({
      label:    'CANCEL',
      variant:  T.groups.confirmation.cancel,
      fontSize: T.fsB2,
      onClick:  function() { if (params.onCancel) params.onCancel(); },
    });
    cancel.style.flex            = '1';
    cancel.style.height          = '48px';
    cancel.style.borderRadius    = '14px';
    cancel.style.display         = 'flex';
    cancel.style.alignItems      = 'center';
    cancel.style.justifyContent  = 'center';

    var confirm = buildPillButton({
      label:    'VOID',
      variant:  T.groups.confirmation.confirmDelete,
      fontSize: T.fsB2,
      onClick:  function() {
        if (!selectedReason) return;
        if (params.onConfirm) params.onConfirm(selectedReason);
      },
    });
    confirm.style.flex           = '1';
    confirm.style.height         = '48px';
    confirm.style.borderRadius   = '14px';
    confirm.style.display        = 'flex';
    confirm.style.alignItems     = 'center';
    confirm.style.justifyContent = 'center';
    confirm.setDisabled(true);

    var updateConfirmStyle = function() { confirm.setDisabled(!selectedReason); };

    btnRow.appendChild(cancel);
    btnRow.appendChild(confirm);
    panel.appendChild(btnRow);
    container.appendChild(shell);
  },
});