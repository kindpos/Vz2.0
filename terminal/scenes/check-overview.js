// ═══════════════════════════════════════════════════
//  KINDpos Terminal — check-overview  (Vz2.0, adaptive)
//  Working layer: full check management with 3 layout modes.
//
//    Mode A  1-4 seats   full-width seat cards
//    Mode B  5 seats     4 full cards + 5th column (shortened card + compact ＋)
//    Mode C  6+ seats    OrderSummary (items-only) + compact seat grid
//
//  Persistent across modes:
//    - Green header (check name tappable to edit)
//    - Bottom-left: totals corner (Subtotal/Tax + Card/Cash)
//    - Bottom-right: 2×3 action grid (PRINT DISC ADD / PAY VOID RESEND)
//
//  Interactions:
//    - Tap seat header  → toggle seat selection
//    - Tap item row     → toggle item selection
//    - Long-press item  → per-item menu
//    - Long-press on selection → bulk menu
//    - Long-press seat header → seat menu (void, merge, split, transfer…)
//
//  SceneManager.mountWorking('check-overview', {
//    checkId, returnLanding, employeeId, employeeName, pin
//  })
// ═══════════════════════════════════════════════════

import { SceneManager, defineScene } from '../scene-manager.js';
import { T } from '../tokens.js';
import {
  buildPillButton,
  hexToRgba,
  darkenHex,
} from '../theme-manager.js';
import { OrderSummary } from '../order-summary.js';
import { buildNumpad } from '../numpad.js';
import { showToast } from '../components.js';
import { setSceneName, setHeaderBack } from '../app.js';
import { showKeyboard, hideKeyboard } from '../keyboard.js';
import { computeTotals, getTaxRate } from '../pricing.js';
import { buildItemRecap, buildItemRecapTotals } from '../components/item-recap.js';
import { fetchWithTimeout } from '../sm2-shim.js';
import { entReport } from '../entomology-client.js';
import { computeDiscountAmount, extractItemIds, buildDiscountBody } from '../discount.js';
import { buildOrderEntryParams } from './transitions.js';
import {
  seatSubtotal,
  checkSubtotal,
  activeSeatCount as activeSeatCountHelper,
  layoutModeFor,
  orderToSeats as orderToSeatsHelper,
  toggleSeatSelection,
  toggleItemSelection,
  selectAllUnpaid,
  collectSelectedItemRefs,
} from './seats.js';
import './column-editor.js';

var _refreshInFlight = false;

// ── Inject invisible scrollbar style ──
(function() {
  if (document.getElementById('co-scroll-style')) return;
  var s = document.createElement('style');
  s.id = 'co-scroll-style';
  s.textContent = '.co-scroll::-webkit-scrollbar{display:none}';
  document.head.appendChild(s);
})();

// ═══════════════════════════════════════════════════
//  HELPERS
// ═══════════════════════════════════════════════════

function fmt(n) { return '$' + (n || 0).toFixed(2); }

// seatTotal / checkTotals now wrap the pure helpers from ./seats.js so the
// rendering paths and transition paths share one math implementation.
function seatTotal(seat) {
  return seatSubtotal(seat);
}

function checkTotals(seats, paidSeats) {
  return computeTotals(checkSubtotal(seats, paidSeats));
}

// ═══════════════════════════════════════════════════
//  RECAP ADAPTER
//  Translates the terminal's real order shape into the
//  spec-style shape buildItemRecap() expects. Keeps the
//  component purely visual — prefix parsing, half bucketing,
//  and category-color resolution live here.
// ═══════════════════════════════════════════════════

var _PREFIX_RX = /^(NO|ADD|SUB|EXTRA|ON SIDE|LITE)\s+/;

function _parsePrefix(name) {
  if (!name) return { prefix: null, clean: '' };
  var m = name.match(_PREFIX_RX);
  if (!m) return { prefix: null, clean: name };
  return { prefix: m[1], clean: name.slice(m[0].length) };
}

function _adaptMod(raw) {
  var pp = _parsePrefix(raw.name || '');
  return {
    prefix:    pp.prefix,
    name:      pp.clean,
    mandatory: pp.prefix === null,
    upcharge:  raw.charged ? (raw.price || 0) : 0,
    microMods: (raw.children || []).map(_adaptMod),
  };
}

function _adaptHalfItem(raw) {
  var pp = _parsePrefix(raw.name || '');
  return {
    prefix:   pp.prefix,
    name:     pp.clean,
    upcharge: raw.charged ? (raw.price || 0) : 0,
  };
}

function _adaptItem(it) {
  var mods = [];
  var first  = [];
  var second = [];
  var rawMods = it.mods || [];
  for (var i = 0; i < rawMods.length; i++) {
    var raw = rawMods[i];
    if (raw.prefix === 'Left')       first.push(_adaptHalfItem(raw));
    else if (raw.prefix === 'Right') second.push(_adaptHalfItem(raw));
    else                             mods.push(_adaptMod(raw));
  }
  var halves = (first.length || second.length)
    ? { first: first, second: second }
    : null;

  return {
    name:          it.name,
    qty:           it.qty || 1,
    price:         it.effectivePrice != null ? it.effectivePrice : (it.price || 0),
    categoryColor: T.catColor(it.category),
    sent:          it.sent_at ? true : (it.sent === false ? false : true),
    mods:          mods,
    halves:        halves,
  };
}

function _sumItemUpcharges(adaptedItem) {
  var uc = 0;
  var mods = adaptedItem.mods || [];
  for (var i = 0; i < mods.length; i++) {
    uc += mods[i].upcharge || 0;
    var mms = mods[i].microMods || [];
    for (var j = 0; j < mms.length; j++) uc += mms[j].upcharge || 0;
  }
  if (adaptedItem.halves) {
    var sides = ['first', 'second'];
    for (var s = 0; s < sides.length; s++) {
      var lst = adaptedItem.halves[sides[s]] || [];
      for (var k = 0; k < lst.length; k++) uc += lst[k].upcharge || 0;
    }
  }
  return uc;
}

// Build the single-seat order shape buildItemRecap expects so a Mode
// A seat tile can embed the same recap chrome (chevrons, qty chips,
// prefix badges, pizza halves) used by the Mode B recap column.
function _adaptSeatForRecap(state, seatIdx) {
  var seat = state.seats[seatIdx];
  var adaptedItems = [];
  for (var i = 0; i < seat.items.length; i++) {
    adaptedItems.push(_adaptItem(seat.items[i]));
  }
  return {
    seats: [{
      seatNumber: seat.number,
      subtotal:   seatTotal(seat),
      items:      adaptedItems,
    }],
    totals: null,
  };
}

function _adaptOrderForRecap(state) {
  var order  = state.order || {};
  var params = state._mountParams || {};

  var adaptedSeats = [];
  var totalUpcharges = 0;
  for (var s = 0; s < state.seats.length; s++) {
    if (state.paidSeats && state.paidSeats[state.seats[s].id]) continue;
    var seat = state.seats[s];
    var adaptedItems = [];
    for (var i = 0; i < seat.items.length; i++) {
      var ai = _adaptItem(seat.items[i]);
      adaptedItems.push(ai);
      totalUpcharges += (ai.qty || 1) * _sumItemUpcharges(ai);
    }
    adaptedSeats.push({
      seatNumber: seat.number,
      subtotal:   seatTotal(seat),
      items:      adaptedItems,
    });
  }

  var totals = checkTotals(state.seats, state.paidSeats);
  var paid = 0;
  if (Array.isArray(order.payments)) {
    for (var p = 0; p < order.payments.length; p++) {
      paid += order.payments[p].amount || 0;
    }
  }

  return {
    tableNum: null,
    checkId:  state.checkNumber || null,
    server:   params.employeeName || null,
    seats:    adaptedSeats,
    totals: {
      subtotal:  totals.subtotal,
      upcharges: Math.round(totalUpcharges * 100) / 100,
      tax:       totals.tax,
      paid:      Math.round(paid * 100) / 100,
      total:     totals.cardTotal,
      cash:      totals.cashPrice,
      taxRate:   getTaxRate(),
    },
  };
}

// activeSeatCount / modeFor / orderToSeats now forward to ./seats.js so
// the layout math has a single unit-testable implementation.
function activeSeatCount(seats, paidSeats) {
  return activeSeatCountHelper(seats, paidSeats);
}

// A = 1-4 active seats · B = 5 · C = 6+
function modeFor(count) {
  return layoutModeFor(count);
}

function orderToSeats(order, minSeats) {
  return orderToSeatsHelper(order, minSeats);
}

function collectSummary(seats, selected, paidSeats) {
  var items = [];
  var subtotal = 0;
  var anySelected = Object.keys(selected).length > 0;
  var visibleSeatCount = 0;
  for (var s = 0; s < seats.length; s++) {
    if (paidSeats && paidSeats[seats[s].id]) continue;
    visibleSeatCount++;
  }
  var showHeaders = visibleSeatCount > 1;
  for (var i = 0; i < seats.length; i++) {
    if (paidSeats && paidSeats[seats[i].id]) continue;
    if (anySelected && !selected[seats[i].id]) continue;
    var seatSub = 0;
    if (showHeaders) {
      for (var k = 0; k < seats[i].items.length; k++) {
        seatSub += seats[i].items[k].qty * (seats[i].items[k].effectivePrice || seats[i].items[k].price);
      }
      items.push({ seatHeader: true, seatId: seats[i].id, seatTotal: seatSub, seatIdx: i });
    }
    for (var j = 0; j < seats[i].items.length; j++) {
      var it = seats[i].items[j];
      var ep = it.effectivePrice || it.price;
      items.push({
        name:      it.name,
        qty:       it.qty,
        unitPrice: ep,
        mods:      it.mods || [],
        seatIdx:   i,
        itemIdx:   j,
        item_id:   it.item_id,
      });
      subtotal += it.qty * ep;
    }
  }
  var totals = computeTotals(subtotal);
  return {
    items:     items,
    subtotal:  totals.subtotal,
    tax:       totals.tax,
    cardTotal: totals.cardTotal,
    cashPrice: totals.cashPrice,
  };
}

var DISCOUNT_OPTIONS = [
  { label: '10% OFF',     pct: 10  },
  { label: '15% OFF',     pct: 15  },
  { label: '20% OFF',     pct: 20  },
  { label: 'COMP (100%)', pct: 100 },
];

// ═══════════════════════════════════════════════════
//  SCENE
// ═══════════════════════════════════════════════════

defineScene({
  name: 'check-overview',

  // __handlers is a test seam: the scene's action dispatchers are
  // attached here so integration tests can drive discount / pay /
  // print / void / add-items / resend flows without needing to
  // simulate pointer events on the live DOM. Production code never
  // reaches in here.
  __handlers: {
    get handleDiscount() { return handleDiscount; },
    get handlePay()      { return handlePay; },
    get handlePrint()    { return handlePrint; },
    get handleVoid()     { return handleVoid; },
    get handleAddItems() { return handleAddItems; },
    get handleResend()   { return handleResend; },
  },

  state: {
    listeners:     [],
    orderId:       null,
    order:         null,
    seats:         [],
    checkNumber:   '',
    customerName:  '',
    selected:      {},
    selectedItems: {},
    paidSeats:     {},
    _payingSeats:  [],
    _backConfirmed:false,
    rootEl:        null,
    topAreaEl:     null,
    totalsEl:      null,
    actionGridEl:  null,
    seatEls:       {},
    _lpTimers:     [],
    _mode:         null,
    _summaryItemMap:{},
    _osActive:     false,
    _mountParams:  null,
    _seatsChain:   null,
    // MANAGE mode session state. _manageMode flips the action bar
    // and seats-container into the MANAGE toolbar + banner layout.
    // _manageSnapshot holds a deep copy of seats / paid / selection
    // state captured on enter so RESET can revert the whole session.
    // _manageLog is a stack of reverse patches UNDO pops one at a time.
    _manageMode:     false,
    _manageTool:     'move',
    _manageSnapshot: null,
    _manageLog:      [],
  },

  render: function(container, params, state) {
    function track(el, event, handler) {
      el.addEventListener(event, handler);
      state.listeners.push({ el: el, event: event, handler: handler });
    }
    function trackBus(event, handler) {
      SceneManager.on(event, handler);
      state.listeners.push({ bus: true, event: event, handler: handler });
    }

    state.orderId       = params.checkId || null;
    state.checkNumber   = '';
    state.customerName  = '';
    state.selected      = {};
    state.selectedItems = {};
    state.seatEls       = {};
    state.paidSeats     = {};
    state._payingSeats  = [];
    state._backConfirmed= false;
    state._lpTimers     = [];
    state._mode         = null;
    state._osActive     = false;
    state._mountParams  = params;   // persistSeats() reads employee info
    state._seatsChain   = null;     // reset per mount
    state.seats = orderToSeats(null, 1);

    var _landing = params.returnLanding || 'server-landing';
    var _landingParams = { emp: { id: params.employeeId, name: params.employeeName, pin: params.pin } };

    // ── Header ──
    setSceneName(params.checkId ? 'CHECK' : 'NEW CHECK');
    setHeaderBack({
      back:   true,
      onBack: function() {
        var hasContent = state.seats.some(function(s) { return s.items.length > 0; });
        if (!state.orderId && hasContent) {
          if (state._backConfirmed) {
            SceneManager.mountWorking(_landing, _landingParams);
            return;
          }
          showToast('Unsaved items — tap back again to exit', { bg: T.gold });
          state._backConfirmed = true;
          setTimeout(function() { state._backConfirmed = false; }, 3000);
          return;
        }
        SceneManager.mountWorking(_landing, _landingParams);
      },
      x: true,
    });

    // ── Root + body layout ──
    var root = document.createElement('div');
    Object.assign(root.style, {
      position:      'absolute',
      inset:         '0',
      paddingTop:    '44px',
      boxSizing:     'border-box',
      display:       'flex',
      flexDirection: 'column',
    });
    container.appendChild(root);
    state.rootEl = root;

    var body = document.createElement('div');
    Object.assign(body.style, {
      flex:          '1',
      minHeight:     '0',
      padding:       '16px',
      boxSizing:     'border-box',
      display:       'flex',
      flexDirection: 'column',
      gap:           '12px',
    });
    root.appendChild(body);

    var topArea = document.createElement('div');
    Object.assign(topArea.style, {
      flex:      '1',
      minHeight: '0',
      display:   'flex',
      gap:       '12px',
    });
    body.appendChild(topArea);
    state.topAreaEl = topArea;

    var bottomRow = document.createElement('div');
    Object.assign(bottomRow.style, {
      height:     '96px',
      flexShrink: '0',
      display:    'flex',
      gap:        '12px',
      alignItems: 'center',
    });
    body.appendChild(bottomRow);

    // Left: TotalsBar (single-row summary) — filled by renderTotals.
    var totalsCorner = document.createElement('div');
    Object.assign(totalsCorner.style, {
      width:         '220px',
      flexShrink:    '0',
      display:       'flex',
      alignItems:    'stretch',
    });
    bottomRow.appendChild(totalsCorner);
    state.totalsEl = totalsCorner;

    // Right: action zone — filled by renderActionBar. Hosts both the
    // secondary pills (PRINT, VOID) and the primary pills (PAY, ADD
    // ITEMS) with a dashed divider between them.
    var actionZone = document.createElement('div');
    Object.assign(actionZone.style, {
      flex:           '1',
      display:        'flex',
      alignItems:     'center',
      justifyContent: 'flex-end',
      gap:            '10px',
    });
    bottomRow.appendChild(actionZone);
    state.actionGridEl = actionZone;

    // ── Initial paint ──
    state._params = params;
    renderTotals(state);
    renderActionBar(state);
    rerenderTopArea(state);

    // ── Fetch order ──
    if (state.orderId) {
      refreshOrder(state, params);
    }

    trackBus('payment:complete', function(data) {
      if (data && data.orderId === state.orderId) refreshOrder(state, params);
    });

    state._backConfirmed = false;
    return function cleanup() { /* scene-level cleanup in unmount */ };
  },

  unmount: function(state) {
    if (OrderSummary.unlockItemRender) OrderSummary.unlockItemRender();
    OrderSummary.hide();
    state._osActive = false;

    for (var i = 0; i < state.listeners.length; i++) {
      var l = state.listeners[i];
      if (l.bus) SceneManager.off(l.event, l.handler);
      else       l.el.removeEventListener(l.event, l.handler);
    }
    state.listeners = [];

    for (var t = 0; t < state._lpTimers.length; t++) clearTimeout(state._lpTimers[t]);
    state._lpTimers = [];
  },

  interrupts: {

    'co-name-input': {
      render: function(container, params) {
        showKeyboard({
          placeholder:   'Enter name',
          initialValue:  params.currentName || '',
          maxLength:     40,
          onDone:        function(val) { params.onConfirm(val.trim()); },
          onDismiss:     function() { params.onCancel(); },
          dismissOnDone: true,
        });
      },
      unmount: function() { hideKeyboard(); },
    },

    'co-item-menu': {
      render: function(container, params) {
        params = params || {};
        var title   = params.title   || 'Options';
        var options = params.options || [];

        container.style.cssText = 'width:100%;height:100%;display:flex;align-items:center;justify-content:center;';

        var panel = document.createElement('div');
        panel.style.cssText = [
          'display:flex;flex-direction:column;align-items:stretch;gap:8px;',
          'background:' + T.card + ';',
          'border:3px solid ' + T.green + ';',
          'border-radius:' + T.chamferCard + 'px;',
          'padding:20px 22px;min-width:300px;max-width:420px;',
          'box-shadow:0 8px 32px rgba(0,0,0,0.5);',
        ].join('');

        var lbl = document.createElement('div');
        lbl.style.cssText = [
          'font-family:' + T.fh + ';',
          'font-size:' + T.fsB2 + ';',
          'font-weight:' + T.fwBold + ';',
          'color:' + T.green + ';',
          'letter-spacing:0.2em;',
          'text-transform:uppercase;',
          'text-align:center;margin-bottom:8px;',
        ].join('');
        lbl.textContent = title;
        panel.appendChild(lbl);

        for (var oi = 0; oi < options.length; oi++) {
          (function(opt) {
            var btn = buildPillButton({
              label:    opt.label,
              color:    opt.color || T.card,
              darkBg:   darkenHex(opt.color || T.card, 0.4),
              fontSize: T.fsB2,
              onClick:  function() { params.onConfirm(opt.id); },
            });
            btn.style.width = '100%';
            if ((opt.color || T.card) === T.card) btn.style.color = T.text;
            else                                  btn.style.color = T.well;
            if (opt.color === T.verm) btn.style.color = '#fff';
            panel.appendChild(btn);
          })(options[oi]);
        }

        var cancelBtn = buildPillButton({
          label:    'CANCEL',
          color:    T.card,
          darkBg:   darkenHex(T.card, 0.4),
          fontSize: T.fsB2,
          onClick:  function() { params.onCancel(); },
        });
        cancelBtn.style.width     = '100%';
        cancelBtn.style.color     = T.text;
        cancelBtn.style.marginTop = '6px';
        panel.appendChild(cancelBtn);
        container.appendChild(panel);

        // Tap-outside-to-cancel, gated so the opening long-press release
        // doesn't self-dismiss the modal.
        var _downInside = false;
        container.addEventListener('pointerdown', function(e) {
          _downInside = (e.target === container);
        });
        container.addEventListener('pointerup', function(e) {
          if (_downInside && e.target === container) { params.onCancel(); }
          _downInside = false;
        });
      },
      unmount: function() {},
    },

    'server-picker': {
      render: function(container, params) {
        params = params || {};
        var excludeId = params.excludeId || null;

        container.style.cssText = 'width:100%;height:100%;display:flex;align-items:center;justify-content:center;';

        var panel = document.createElement('div');
        panel.style.cssText = [
          'background:' + T.card + ';',
          'border:3px solid ' + T.green + ';',
          'border-radius:' + T.chamferCard + 'px;',
          'padding:18px;',
          'min-width:320px;max-width:440px;max-height:460px;',
          'display:flex;flex-direction:column;gap:10px;',
          'box-shadow:0 8px 32px rgba(0,0,0,0.5);',
        ].join('');

        var title = document.createElement('div');
        title.style.cssText = [
          'font-family:' + T.fh + ';',
          'font-size:' + T.fsB2 + ';',
          'font-weight:' + T.fwBold + ';',
          'letter-spacing:0.18em;',
          'color:' + T.green + ';',
          'text-transform:uppercase;',
          'text-align:center;padding:4px 0 10px;',
        ].join('');
        title.textContent = 'TRANSFER TO SERVER';
        panel.appendChild(title);

        var list = document.createElement('div');
        list.style.cssText = 'flex:1;overflow-y:auto;display:flex;flex-direction:column;gap:8px;';

        var loading = document.createElement('div');
        loading.style.cssText = [
          'font-family:' + T.fb + ';',
          'font-size:' + T.fsB3 + ';',
          'color:' + T.text + ';',
          'opacity:0.55;',
          'text-align:center;padding:20px 0;',
        ].join('');
        loading.textContent = 'Loading...';
        list.appendChild(loading);
        panel.appendChild(list);

        var cancelBtn = buildPillButton({
          label:    'CANCEL',
          color:    T.verm,
          darkBg:   T.vermDk,
          fontSize: T.fsB2,
          onClick:  function() { params.onCancel(); },
        });
        cancelBtn.style.alignSelf = 'center';
        panel.appendChild(cancelBtn);
        container.appendChild(panel);

        fetch('/api/v1/servers/clocked-in')
          .then(function(r) { if (!r.ok) throw new Error(r.status); return r.json(); })
          .then(function(data) {
            list.innerHTML = '';
            var staff = (data.staff || []).filter(function(s) { return s.employee_id !== excludeId; });
            if (staff.length === 0) {
              var empty = document.createElement('div');
              empty.style.cssText = [
                'font-family:' + T.fb + ';',
                'font-size:' + T.fsB3 + ';',
                'color:' + T.text + ';',
                'opacity:0.55;',
                'text-align:center;padding:20px 0;',
              ].join('');
              empty.textContent = 'No other servers clocked in';
              list.appendChild(empty);
              return;
            }
            for (var i = 0; i < staff.length; i++) {
              (function(srv) {
                var btn = buildPillButton({
                  label:    srv.employee_name,
                  color:    T.card,
                  darkBg:   darkenHex(T.card, 0.4),
                  fontSize: T.fsB2,
                  onClick:  function() {
                    params.onConfirm({ employee_id: srv.employee_id, employee_name: srv.employee_name });
                  },
                });
                btn.style.width = '100%';
                btn.style.color = T.text;
                list.appendChild(btn);
              })(staff[i]);
            }
          })
          .catch(function() {
            list.innerHTML = '';
            var err = document.createElement('div');
            err.style.cssText = [
              'font-family:' + T.fb + ';',
              'font-size:' + T.fsB3 + ';',
              'color:' + T.verm + ';',
              'text-align:center;padding:20px 0;',
            ].join('');
            err.textContent = 'Failed to load servers';
            list.appendChild(err);
          });
      },
    },

    'disc-pin': {
      render: function(container, params) {
        container.style.cssText = 'width:100%;height:100%;display:flex;align-items:center;justify-content:center;';

        var panel = document.createElement('div');
        panel.style.cssText = [
          'display:flex;flex-direction:column;align-items:center;gap:14px;',
          'background:' + T.card + ';',
          'border:3px solid ' + T.gold + ';',
          'border-radius:' + T.chamferCard + 'px;',
          'padding:22px 24px;',
          'box-shadow:0 8px 32px rgba(0,0,0,0.5);',
        ].join('');

        var lbl = document.createElement('div');
        lbl.style.cssText = [
          'font-family:' + T.fh + ';',
          'font-size:' + T.fsB2 + ';',
          'font-weight:' + T.fwBold + ';',
          'color:' + T.gold + ';',
          'letter-spacing:0.2em;',
          'text-transform:uppercase;',
          'margin-bottom:2px;',
        ].join('');
        lbl.textContent = 'MANAGER PIN';
        panel.appendChild(lbl);

        var numpad = buildNumpad({
          onSubmit: function(pin) {
            fetchWithTimeout('/api/v1/auth/verify-pin', {
              method:  'POST',
              headers: { 'Content-Type': 'application/json' },
              body:    JSON.stringify({ pin: pin }),
            }, 10000).then(function(r) { return r.json(); }).then(function(data) {
              if (data.valid && (data.roles || []).indexOf('manager') !== -1) {
                params.onConfirm(data.employee_id || pin);
              } else if (data.valid) {
                numpad.setError('NOT A MANAGER');
              } else {
                numpad.setError('INVALID PIN');
              }
            }).catch(function() { numpad.setError('NETWORK ERROR'); });
          },
          onCancel: function() { params.onCancel(); },
        });
        panel.appendChild(numpad);
        container.appendChild(panel);

        container.addEventListener('pointerup', function(e) {
          if (e.target === container) { params.onCancel(); }
        });
      },
      unmount: function() {},
    },

    'disc-select': {
      render: function(container, params) {
        container.style.cssText = 'width:100%;height:100%;display:flex;align-items:center;justify-content:center;';

        var panel = document.createElement('div');
        panel.style.cssText = [
          'display:flex;flex-direction:column;align-items:center;gap:10px;',
          'background:' + T.card + ';',
          'border:3px solid ' + T.gold + ';',
          'border-radius:' + T.chamferCard + 'px;',
          'padding:22px 24px;min-width:300px;',
          'box-shadow:0 8px 32px rgba(0,0,0,0.5);',
        ].join('');

        var lbl = document.createElement('div');
        lbl.style.cssText = [
          'font-family:' + T.fh + ';',
          'font-size:' + T.fsB2 + ';',
          'font-weight:' + T.fwBold + ';',
          'color:' + T.gold + ';',
          'letter-spacing:0.2em;',
          'text-transform:uppercase;',
          'margin-bottom:6px;',
        ].join('');
        lbl.textContent = 'DISCOUNT';
        panel.appendChild(lbl);

        DISCOUNT_OPTIONS.forEach(function(opt) {
          var btn = buildPillButton({
            label:    opt.label,
            color:    T.gold,
            darkBg:   T.goldDk,
            fontSize: T.fsB2,
            onClick:  function() { params.onConfirm(opt); },
          });
          btn.style.width = '240px';
          panel.appendChild(btn);
        });

        var cancelBtn = buildPillButton({
          label:    'CANCEL',
          color:    T.card,
          darkBg:   darkenHex(T.card, 0.4),
          fontSize: T.fsB2,
          onClick:  function() { params.onCancel(); },
        });
        cancelBtn.style.width     = '240px';
        cancelBtn.style.color     = T.text;
        cancelBtn.style.marginTop = '6px';
        panel.appendChild(cancelBtn);
        container.appendChild(panel);
      },
      unmount: function() {},
    },

    'seat-payment': {
      render: function(container, params) {
        params = params || {};
        var seatId   = params.seatId   || '??';
        var payments = params.payments || [];

        container.style.cssText = 'width:100%;height:100%;display:flex;align-items:center;justify-content:center;';

        var panel = document.createElement('div');
        panel.style.cssText = [
          'display:flex;flex-direction:column;align-items:stretch;gap:10px;',
          'background:' + T.card + ';',
          'border:3px solid ' + T.gold + ';',
          'border-radius:' + T.chamferCard + 'px;',
          'padding:22px 24px;min-width:320px;max-width:440px;',
          'box-shadow:0 8px 32px rgba(0,0,0,0.5);',
        ].join('');

        var title = document.createElement('div');
        title.style.cssText = [
          'font-family:' + T.fh + ';',
          'font-size:' + T.fsB2 + ';',
          'font-weight:' + T.fwBold + ';',
          'color:' + T.gold + ';',
          'letter-spacing:0.2em;',
          'text-transform:uppercase;',
          'text-align:center;margin-bottom:4px;',
        ].join('');
        title.textContent = seatId + ' PAYMENT';
        panel.appendChild(title);

        if (payments.length === 0) {
          var empty = document.createElement('div');
          empty.style.cssText = [
            'font-family:' + T.fb + ';',
            'font-size:' + T.fsB3 + ';',
            'color:' + T.text + ';',
            'opacity:0.55;',
            'padding:8px 0;text-align:center;',
          ].join('');
          empty.textContent = 'No payments found for this seat';
          panel.appendChild(empty);
        } else {
          for (var pi = 0; pi < payments.length; pi++) {
            (function(p) {
              var row = document.createElement('div');
              row.style.cssText = [
                'display:flex;align-items:center;justify-content:space-between;',
                'gap:12px;width:100%;padding:6px 0;',
              ].join('');
              var info = document.createElement('div');
              info.style.cssText = [
                'font-family:' + T.fb + ';',
                'font-size:' + T.fsB2 + ';',
                'color:' + T.text + ';',
              ].join('');
              info.textContent = p.method.toUpperCase() + '  ' + fmt(p.amount);
              row.appendChild(info);
              var delBtn = buildPillButton({
                label:    'DELETE',
                color:    T.verm,
                darkBg:   T.vermDk,
                fontSize: T.fsB3,
                onClick:  function() { params.onConfirm(p.payment_id); },
              });
              delBtn.style.minWidth = '100px';
              row.appendChild(delBtn);
              panel.appendChild(row);
            })(payments[pi]);
          }
        }

        var cancelBtn = buildPillButton({
          label:    'CANCEL',
          color:    T.card,
          darkBg:   darkenHex(T.card, 0.4),
          fontSize: T.fsB2,
          onClick:  function() { params.onCancel(); },
        });
        cancelBtn.style.width     = '100%';
        cancelBtn.style.color     = T.text;
        cancelBtn.style.marginTop = '4px';
        panel.appendChild(cancelBtn);
        container.appendChild(panel);

        var _downInside = false;
        container.addEventListener('pointerdown', function(e) {
          _downInside = (e.target === container);
        });
        container.addEventListener('pointerup', function(e) {
          if (_downInside && e.target === container) { params.onCancel(); }
          _downInside = false;
        });
      },
      unmount: function() {},
    },
  },
});

// ═══════════════════════════════════════════════════
//  TOTALS BAR (bottom-left, universal across modes)
//  Single-row pill: LABEL on top (mutedText), big gold VALUE below.
//  Label and value shift with selection state: no seats → "CHECK
//  TOTAL" + full check total; seats selected → "S1 + S3 TOTAL" +
//  sum of selected seats.
// ═══════════════════════════════════════════════════

function _selectedSeatSubtotal(state) {
  var sum = 0;
  for (var i = 0; i < state.seats.length; i++) {
    var s = state.seats[i];
    if (state.selected[s.id] && !state.paidSeats[s.id]) {
      sum += seatSubtotal(s);
    }
  }
  return sum;
}

function _selectedSeatShortLabel(state) {
  var parts = [];
  for (var i = 0; i < state.seats.length; i++) {
    var s = state.seats[i];
    if (state.selected[s.id]) {
      parts.push('S' + (s.number != null ? s.number : (i + 1)));
    }
  }
  return parts.join(' + ');
}

function renderTotals(state) {
  var el = state.totalsEl;
  el.innerHTML = '';

  var anySel = Object.keys(state.selected || {}).length > 0;
  var label, value;
  if (anySel) {
    label = _selectedSeatShortLabel(state) + ' TOTAL';
    value = _selectedSeatSubtotal(state);
  } else {
    label = 'CHECK TOTAL';
    value = computeTotals(checkSubtotal(state.seats, state.paidSeats)).cardTotal;
  }

  var bar = document.createElement('div');
  Object.assign(bar.style, {
    flex:         '1',
    display:      'flex',
    flexDirection:'column',
    justifyContent:'center',
    gap:          '2px',
    padding:      '8px 14px',
    background:   T.well,
    border:       '1px solid ' + T.border,
    borderRadius: '8px',
  });

  var lbl = document.createElement('span');
  Object.assign(lbl.style, {
    fontFamily:    T.fb,
    fontSize:      '10px',
    fontWeight:    T.fwBold,
    letterSpacing: '0.12em',
    color:         T.mutedText,
    whiteSpace:    'nowrap',
    overflow:      'hidden',
    textOverflow:  'ellipsis',
  });
  lbl.textContent = label;
  bar.appendChild(lbl);

  var val = document.createElement('span');
  Object.assign(val.style, {
    fontFamily: T.fb,
    fontSize:   '22px',
    fontWeight: T.fwBold,
    color:      T.gold,
    lineHeight: '1.1',
  });
  val.textContent = fmt(value);
  bar.appendChild(val);

  el.appendChild(bar);
}

// ═══════════════════════════════════════════════════
//  ACTION BAR (bottom-right pills)
//  State 1 (no seats selected): PRINT + VOID secondaries on the left,
//  dashed divider, PAY (gold) + ADD ITEMS (green) primaries on the
//  right. VOID requires a ~550 ms long-press to fire; short taps are
//  ignored so the cashier can't void the check on an accidental tap.
//  State 2 (seats selected) and MANAGE mode toolbars come in later
//  steps and dispatch from this same slot.
// ═══════════════════════════════════════════════════

function _makeSecondaryPill(label, textColor, opts) {
  opts = opts || {};
  var btn = document.createElement('button');
  Object.assign(btn.style, {
    height:        '36px',
    padding:       '0 18px',
    border:        'none',
    borderRadius:  T.pillRadius,
    background:    opts.bg || T.card,
    color:         textColor,
    fontFamily:    T.fb,
    fontSize:      T.fsB3,
    fontWeight:    T.fwBold,
    letterSpacing: '0.12em',
    cursor:        'pointer',
    boxShadow:     '0 2px 0 rgba(0,0,0,0.35)',
    pointerEvents: 'auto',
  });
  btn.textContent = label;
  return btn;
}

function _makePrimaryPill(label, bg, opts) {
  opts = opts || {};
  var btn = document.createElement('button');
  Object.assign(btn.style, {
    height:        '48px',
    padding:       '0 24px',
    minWidth:      opts.minWidth || '120px',
    border:        'none',
    borderRadius:  T.pillRadius,
    background:    bg,
    color:         T.well,
    fontFamily:    T.fb,
    fontSize:      T.fsB2,
    fontWeight:    T.fwBold,
    letterSpacing: '0.10em',
    cursor:        'pointer',
    boxShadow:     '0 3px 0 rgba(0,0,0,0.4)',
    display:       'flex',
    flexDirection: 'column',
    alignItems:    'center',
    justifyContent:'center',
    gap:           '1px',
    pointerEvents: 'auto',
  });
  var main = document.createElement('span');
  main.textContent = label;
  btn.appendChild(main);
  if (opts.sub) {
    var sub = document.createElement('span');
    Object.assign(sub.style, {
      fontSize:      '9px',
      fontWeight:    T.fwBold,
      letterSpacing: '0.10em',
      opacity:       '0.78',
    });
    sub.textContent = opts.sub;
    btn.appendChild(sub);
  }
  return btn;
}

function _wireLongPress(el, onFire, holdMs) {
  var timer = null;
  var fired = false;
  var ms = holdMs || 550;
  el.addEventListener('pointerdown', function() {
    fired = false;
    timer = setTimeout(function() { fired = true; onFire(); }, ms);
  });
  el.addEventListener('pointerup', function() {
    if (timer) { clearTimeout(timer); timer = null; }
  });
  el.addEventListener('pointerleave', function() {
    if (timer) { clearTimeout(timer); timer = null; }
  });
  el.addEventListener('pointercancel', function() {
    if (timer) { clearTimeout(timer); timer = null; }
  });
}

function _dashedDivider() {
  var d = document.createElement('div');
  Object.assign(d.style, {
    width:      '0',
    height:     '56px',
    borderLeft: '1px dashed ' + T.border,
    margin:     '0 4px',
  });
  return d;
}

function renderActionBar(state) {
  var zone = state.actionGridEl;
  if (!zone) return;
  zone.innerHTML = '';

  // MANAGE mode owns the bottom-right zone while active — the tool
  // pills and utility row replace PAY / ADD ITEMS until the cashier
  // taps DONE (which calls exitManageMode → rerender → falls back
  // to State 1 or 2 here).
  if (state._manageMode) {
    renderManageToolbar(state);
    return;
  }

  var params = state._params || state._mountParams || {};
  var anySel = Object.keys(state.selected || {}).length > 0;

  if (!anySel) {
    // ── STATE 1: nothing selected ──
    var printBtn = _makeSecondaryPill('PRINT', T.green);
    printBtn.addEventListener('click', function() { handlePrint(state); });
    zone.appendChild(printBtn);

    var voidBtn = _makeSecondaryPill('VOID', T.verm);
    voidBtn.addEventListener('click', function() {
      showToast('Hold VOID to confirm', { bg: T.gold });
    });
    _wireLongPress(voidBtn, function() { handleVoid(state); });
    zone.appendChild(voidBtn);

    zone.appendChild(_dashedDivider());

    var payBtn = _makePrimaryPill('PAY', T.gold, { minWidth: '150px' });
    payBtn.addEventListener('click', function() { handlePay(state, params); });
    zone.appendChild(payBtn);

    var addBtn = _makePrimaryPill('ADD ITEMS', T.green, { minWidth: '158px' });
    addBtn.addEventListener('click', function() { handleAddItems(state, params); });
    zone.appendChild(addBtn);
    return;
  }

  // ── STATE 2: one or more seats selected ──
  // Secondary: PRINT SEATS + MANAGE. MANAGE fills T.elec to flag that
  // it opens a distinct mode (MOVE / SPLIT / MERGE / TRANSFER tools).
  var selLabel = _selectedSeatShortLabel(state);

  var printSeatsBtn = _makeSecondaryPill('PRINT SEATS', T.green);
  printSeatsBtn.addEventListener('click', function() { handlePrint(state); });
  zone.appendChild(printSeatsBtn);

  var manageBtn = _makeSecondaryPill('MANAGE', T.well, { bg: T.elec });
  manageBtn.addEventListener('click', function() { enterManageMode(state); });
  zone.appendChild(manageBtn);

  zone.appendChild(_dashedDivider());

  // Primary: PAY SEATS shows selected-seat sub-label so cashier knows
  // exactly which totals are about to settle. ADD ITEMS continues to
  // open order-entry; Step 9 adds a seatFilter so the assign modal
  // inside order-entry pre-filters to the selected seats.
  var paySeatsBtn = _makePrimaryPill('PAY SEATS', T.gold, {
    minWidth: '170px',
    sub:      selLabel,
  });
  paySeatsBtn.addEventListener('click', function() { handlePay(state, params); });
  zone.appendChild(paySeatsBtn);

  var addItemsBtn = _makePrimaryPill('ADD ITEMS', T.green, { minWidth: '158px' });
  addItemsBtn.addEventListener('click', function() { handleAddItems(state, params); });
  zone.appendChild(addItemsBtn);
}

// ═══════════════════════════════════════════════════
//  MANAGE MODE — session state + toolbar
//  enter / exit handle the snapshot bookkeeping; the toolbar itself
//  is emitted by renderActionBar when state._manageMode is true.
//  Tool mechanics (MOVE / SPLIT / MERGE / TRANSFER + UNDO / RESET)
//  are wired in Steps 11-12.
// ═══════════════════════════════════════════════════

// TRANSFER is deliberately not on the MANAGE toolbar — the existing
// long-press seat menu keeps routing through _openTransfer for
// whole-check transfers, and selection-aware transfer is scoped out.
var MANAGE_TOOLS = [
  { id: 'move',  label: 'MOVE' },
  { id: 'split', label: 'SPLIT' },
  { id: 'merge', label: 'MERGE' },
];

function _cloneSeats(seats) {
  // Deep clone via JSON round-trip — seats / items / mods contain only
  // plain data (no Dates, functions, or DOM refs) so this is safe and
  // keeps the snapshot independent of ongoing mutations.
  return JSON.parse(JSON.stringify(seats || []));
}

function enterManageMode(state) {
  if (!state.orderId) {
    showToast('Save items before managing', { bg: T.gold });
    return;
  }
  state._manageMode = true;
  state._manageTool = 'move';
  state._manageLog  = [];
  state._manageSnapshot = {
    seats:         _cloneSeats(state.seats),
    paidSeats:     Object.assign({}, state.paidSeats),
    selected:      Object.assign({}, state.selected),
    selectedItems: Object.assign({}, state.selectedItems),
  };
  rerenderTopArea(state);
}

function exitManageMode(state) {
  state._manageMode = false;
  state._manageTool = 'move';
  state._manageLog  = [];
  state._manageSnapshot = null;
  rerenderTopArea(state);
}

function _resetManageSession(state) {
  if (!state._manageSnapshot) return;
  state.seats         = _cloneSeats(state._manageSnapshot.seats);
  state.paidSeats     = Object.assign({}, state._manageSnapshot.paidSeats);
  state.selected      = Object.assign({}, state._manageSnapshot.selected);
  state.selectedItems = Object.assign({}, state._manageSnapshot.selectedItems);
  state._manageLog    = [];
  rerenderTopArea(state);
  showToast('MANAGE session reset', { bg: T.verm });
}

function _makeToolPill(label, active) {
  var btn = document.createElement('button');
  Object.assign(btn.style, {
    height:        '36px',
    padding:       '0 16px',
    border:        'none',
    borderRadius:  T.pillRadius,
    background:    active ? T.elec : T.card,
    color:         active ? T.well : T.elec,
    fontFamily:    T.fb,
    fontSize:      T.fsB3,
    fontWeight:    T.fwBold,
    letterSpacing: '0.14em',
    cursor:        'pointer',
    boxShadow:     '0 2px 0 rgba(0,0,0,0.35)',
    pointerEvents: 'auto',
  });
  btn.textContent = label;
  return btn;
}

function _makeUtilPill(label, textColor, opts) {
  opts = opts || {};
  var btn = document.createElement('button');
  Object.assign(btn.style, {
    height:        '36px',
    padding:       '0 14px',
    border:        'none',
    borderRadius:  T.pillRadius,
    background:    opts.bg || T.card,
    color:         textColor,
    fontFamily:    T.fb,
    fontSize:      T.fsB3,
    fontWeight:    T.fwBold,
    letterSpacing: '0.14em',
    cursor:        'pointer',
    boxShadow:     '0 2px 0 rgba(0,0,0,0.35)',
    pointerEvents: 'auto',
  });
  btn.textContent = label;
  return btn;
}

function renderManageToolbar(state) {
  var zone = state.actionGridEl;
  if (!zone) return;
  zone.innerHTML = '';

  // ── Left: tool pills ──
  for (var i = 0; i < MANAGE_TOOLS.length; i++) {
    var tool = MANAGE_TOOLS[i];
    var active = state._manageTool === tool.id;
    var pill = _makeToolPill(tool.label, active);
    (function(toolId) {
      pill.addEventListener('click', function() {
        state._manageTool = toolId;
        renderManageToolbar(state);
        // Re-render the banner so its "[TOOL] ACTIVE" segment updates.
        // rerenderTopArea rebuilds the whole seats container — cheaper
        // to just redraw the banner, but rerenderTopArea is what
        // every other tap does and keeps MANAGE state coherent.
        rerenderTopArea(state);
      });
    })(tool.id);
    zone.appendChild(pill);
  }

  zone.appendChild(_dashedDivider());

  // ── Right: utility pills — UNDO, RESET, DONE ──
  var undoBtn = _makeUtilPill('UNDO', T.text);
  undoBtn.addEventListener('click', function() {
    if (!state._manageLog || state._manageLog.length === 0) {
      showToast('Nothing to undo', { bg: T.gold });
      return;
    }
    // Step 12 wires the actual inverse-patch replay. For now, surface
    // the no-op path so the pill reads as responsive.
    showToast('Undo arriving in Step 12', { bg: T.elec });
  });
  zone.appendChild(undoBtn);

  var resetBtn = _makeUtilPill('RESET', T.verm);
  // Short tap is a no-op by design — RESET wipes the entire MANAGE
  // session and we don't want an accidental tap to erase the cashier's
  // in-progress reorg.
  resetBtn.addEventListener('click', function() {
    showToast('Hold RESET to revert session', { bg: T.gold });
  });
  _wireLongPress(resetBtn, function() { _resetManageSession(state); });
  zone.appendChild(resetBtn);

  var doneBtn = _makeUtilPill('DONE', T.well, { bg: T.greenWarm });
  doneBtn.addEventListener('click', function() { exitManageMode(state); });
  zone.appendChild(doneBtn);
}

function _buildTotalsBox(rows) {
  var box = document.createElement('div');
  Object.assign(box.style, {
    background:   T.well,
    borderLeft:   T.accentBarW + ' solid ' + T.green,
    borderRadius: '8px',
    padding:      '8px 12px',
    fontSize:     T.fsB3,
    fontFamily:   T.fb,
    display:      'flex',
    flexDirection:'column',
    gap:          '3px',
  });
  for (var i = 0; i < rows.length; i++) {
    var r = document.createElement('div');
    Object.assign(r.style, {
      display:        'flex',
      justifyContent: 'space-between',
      alignItems:     'baseline',
      gap:            '8px',
    });
    var l = document.createElement('span');
    l.style.cssText = 'color:' + T.text + ';opacity:0.85;';
    l.textContent = rows[i].lbl;
    r.appendChild(l);
    var v = document.createElement('span');
    v.style.cssText = 'color:' + rows[i].color + ';font-weight:' + T.fwBold + ';';
    v.textContent = rows[i].val;
    r.appendChild(v);
    box.appendChild(r);
  }
  return box;
}

// ═══════════════════════════════════════════════════
//  SEATS CONTAINER — Nostalgia card shell
//  T.card body, 10 px radius, drop shadow, 4 px T.green left accent
//  bar, and a 24 px T.green top strip with SEATS / ALL labels.
//  Wraps whatever mode (A / B / C) renders into its body slot.
// ═══════════════════════════════════════════════════

function _allSeatsSelected(state) {
  var anyUnpaid = false;
  for (var i = 0; i < state.seats.length; i++) {
    var s = state.seats[i];
    if (state.paidSeats[s.id]) continue;
    anyUnpaid = true;
    if (!state.selected[s.id]) return false;
  }
  return anyUnpaid;
}

function buildSeatsContainer(state) {
  var root = document.createElement('div');
  Object.assign(root.style, {
    flex:         '1',
    minHeight:    '0',
    display:      'flex',
    flexDirection:'column',
    background:   T.card,
    borderLeft:   T.accentBarW + ' solid ' + T.green,
    borderRadius: T.chamferCard + 'px',
    overflow:     'hidden',
    boxShadow:    '0 4px 16px rgba(0,0,0,0.28)',
  });

  var header = document.createElement('div');
  Object.assign(header.style, {
    flexShrink:             '0',
    height:                 '24px',
    background:             T.green,
    borderTopRightRadius:   (T.chamferCard - 4) + 'px',
    display:                'flex',
    alignItems:             'center',
    justifyContent:         'space-between',
    padding:                '0 14px',
    fontFamily:             T.fh,
    fontWeight:             T.fwBold,
    fontSize:               '11px',
    letterSpacing:          '0.14em',
    color:                  T.well,
    userSelect:             'none',
  });

  var lbl = document.createElement('span');
  lbl.textContent = 'SEATS';
  header.appendChild(lbl);

  var all = document.createElement('span');
  all.textContent = 'ALL';
  all.style.cursor = 'pointer';
  all.style.padding = '0 4px';
  all.addEventListener('click', function() {
    if (_allSeatsSelected(state)) {
      state.selected = {};
    } else {
      state.selected = selectAllUnpaid(state.seats, state.paidSeats);
    }
    rerenderTopArea(state);
  });
  header.appendChild(all);

  root.appendChild(header);

  // MANAGE-mode banner. Shown only while state._manageMode is true so
  // the cashier always knows they're in the tool-dispatching surface
  // rather than the normal overview. The label's "[TOOL] ACTIVE"
  // segment updates with state._manageTool.
  if (state._manageMode) {
    var banner = document.createElement('div');
    Object.assign(banner.style, {
      flexShrink:    '0',
      height:        '26px',
      background:    hexToRgba(T.elec, 0.14),
      borderBottom:  '1px solid ' + hexToRgba(T.elec, 0.45),
      color:         T.elec,
      fontFamily:    T.fb,
      fontSize:      '10px',
      fontWeight:    T.fwBold,
      letterSpacing: '0.18em',
      display:       'flex',
      alignItems:    'center',
      justifyContent:'center',
      padding:       '0 14px',
      userSelect:    'none',
    });
    banner.textContent = '▶ MANAGE MODE · '
      + String(state._manageTool || 'move').toUpperCase() + ' ACTIVE';
    root.appendChild(banner);
  }

  var body = document.createElement('div');
  Object.assign(body.style, {
    flex:         '1',
    minHeight:    '0',
    display:      'flex',
    flexDirection:'column',
    padding:      '12px',
    boxSizing:    'border-box',
  });
  root.appendChild(body);

  return { root: root, body: body };
}

// ═══════════════════════════════════════════════════
//  TOP-AREA DISPATCHER
// ═══════════════════════════════════════════════════

function rerenderTopArea(state) {
  state._mode = layoutModeFor(activeSeatCount(state.seats, state.paidSeats));

  if (state._osActive) {
    OrderSummary.hide();
    state._osActive = false;
  }

  // Totals render into the bottom-left corner (same row as the action
  // buttons) via buildItemRecapTotals — keep the corner visible.
  if (state.totalsEl) {
    state.totalsEl.style.display = 'flex';
  }

  var top = state.topAreaEl;
  top.innerHTML = '';
  state.seatEls = {};

  for (var t = 0; t < state._lpTimers.length; t++) clearTimeout(state._lpTimers[t]);
  state._lpTimers = [];

  var shell = buildSeatsContainer(state);
  top.appendChild(shell.root);

  if (state._mode === 'A') renderModeA(state, shell.body);
  else                     renderModeB(state, shell.body);

  renderTotals(state);
  renderActionBar(state);
}

// ═══════════════════════════════════════════════════
//  MODE A — 1 to 4 seats, full-width cards
// ═══════════════════════════════════════════════════

function renderModeA(state, container) {
  // Flex row instead of a uniform grid so the add-tile can stay a slim
  // 54 px rail while the seat tiles share the remaining width evenly.
  var row = document.createElement('div');
  Object.assign(row.style, {
    flex:         '1',
    minHeight:    '0',
    display:      'flex',
    gap:          '10px',
    alignItems:   'stretch',
  });
  container.appendChild(row);

  for (var i = 0; i < state.seats.length; i++) {
    if (state.paidSeats[state.seats[i].id]) continue;
    var card = buildSeatCard(state, i, { compact: false });
    card.style.flex = '1';
    card.style.minWidth = '0';
    row.appendChild(card);
  }

  var addTile = buildAddTile(state, { narrow: true });
  row.appendChild(addTile);
}

// ═══════════════════════════════════════════════════
//  MODE B — 5+ seats, recap + compact scrollable grid
//
//  Left column:  buildItemRecap scrolls vertically and is top-aligned
//                so rows start at the top rather than centering in
//                the column. Totals continue to mount separately in
//                the bottom-left corner via renderTotals so scrolling
//                the recap never clips them.
//  Right column: a fixed-height card whose inner grid scrolls when
//                more seat tiles are added than fit. The card itself
//                never grows past the seats-container body — growth
//                happens inside the scrolling grid instead.
// ═══════════════════════════════════════════════════

function renderModeB(state, container) {
  var wrap = document.createElement('div');
  Object.assign(wrap.style, {
    flex:               '1',
    minHeight:          '0',
    display:            'grid',
    gridTemplateColumns:'360px 1fr',
    gap:                '12px',
  });
  container.appendChild(wrap);

  // ── LEFT: order recap ──
  var recapSlot = document.createElement('div');
  Object.assign(recapSlot.style, {
    minHeight:      '0',
    display:        'flex',
    flexDirection:  'column',
    justifyContent: 'flex-start',
    overflow:       'hidden',
  });
  var recap = buildItemRecap(_adaptOrderForRecap(state), {
    hideTotals:           true,
    defaultItemCollapsed: true,
    onSeatHeaderTap: function(seatIdx) {
      if (seatIdx < 0 || seatIdx >= state.seats.length) return;
      toggleSeat(state, state.seats[seatIdx].id);
    },
    onItemTap: function(seatIdx, itemIdx) {
      toggleItem(state, seatIdx, itemIdx);
    },
    onRemoveItem: function(seatIdx, itemIdx) {
      _voidItems(state, [{ seatIdx: seatIdx, itemIdx: itemIdx }]);
    },
  });
  recap.style.flex = '1';
  recap.style.minHeight = '0';
  recap.style.background = 'transparent';
  recapSlot.appendChild(recap);
  wrap.appendChild(recapSlot);

  // ── RIGHT: compact seat grid (fixed-height card, scrolling grid) ──
  var gridCard = document.createElement('div');
  Object.assign(gridCard.style, {
    background:   T.card,
    borderLeft:   T.accentBarW + ' solid ' + T.green,
    borderRadius: T.chamferCard + 'px',
    display:      'flex',
    flexDirection:'column',
    overflow:     'hidden',
    boxShadow:    '0 4px 16px rgba(0,0,0,0.28)',
    minHeight:    '0',
    flex:         '1',
  });

  var cg = document.createElement('div');
  Object.assign(cg.style, {
    flex:               '1',
    minHeight:          '0',
    padding:            '10px',
    display:            'grid',
    gap:                '10px',
    overflowY:          'auto',
    gridTemplateColumns:'repeat(auto-fill, minmax(120px, 1fr))',
    gridAutoRows:       '72px',
    alignContent:       'start',
  });
  cg.className = 'co-scroll';

  for (var i = 0; i < state.seats.length; i++) {
    if (state.paidSeats[state.seats[i].id]) continue;
    cg.appendChild(buildCompactTile(state, i));
  }
  cg.appendChild(buildAddTile(state, { compact: true }));

  gridCard.appendChild(cg);
  wrap.appendChild(gridCard);
}

// ═══════════════════════════════════════════════════
//  SEAT CARD (used in Mode A and B for first 4 + the shortened 5th)
// ═══════════════════════════════════════════════════

// Per-seat accent color. First four seats use the canonical blueprint
// palette; beyond that we rotate through T.srvPalette so large parties
// still get distinct accents.
function seatAccent(seatIdx) {
  var first4 = [T.green, T.elec, T.gold, T.verm];
  if (seatIdx < first4.length) return first4[seatIdx];
  var pal = T.srvPalette || [];
  if (!pal.length) return T.green;
  return pal[seatIdx % pal.length];
}

function buildSeatCard(state, seatIdx, opts) {
  opts = opts || {};
  var seat = state.seats[seatIdx];
  var selected = !!state.selected[seat.id];
  var accent = seatAccent(seatIdx);
  var canDelete = seat.items.length === 0
    && activeSeatCount(state.seats, state.paidSeats) > 1;

  // Inverted selection: the whole tile flips to the seat accent color
  // and every text node reads as T.well. When unselected the tile is
  // the dark T.well surface with per-role colors (names = T.text,
  // prices = T.gold, mods = dim, labels = T.green).
  var tileBg     = selected ? accent : T.well;
  var labelCol   = selected ? T.well : T.green;      // big S-num
  var subLblCol  = selected ? T.well : T.mutedText;  // "SEAT" / "SUBTOTAL"
  var subValCol  = selected ? T.well : T.gold;       // subtotal value
  var headerBg   = selected ? 'rgba(0,0,0,0.15)' : T.card;
  var footerBg   = selected ? 'rgba(0,0,0,0.15)' : T.card;
  var divColor   = selected ? 'rgba(0,0,0,0.20)' : T.border;

  var card = document.createElement('div');
  if (selected) card.className = 'ir-inverted';
  Object.assign(card.style, {
    position:     'relative',
    background:   tileBg,
    borderLeft:   T.accentBarW + ' solid ' + hexToRgba(accent, selected ? 0.4 : 1.0),
    borderRadius: T.chamferCard + 'px',
    boxShadow:    '0 4px 16px rgba(0,0,0,0.35)',
    display:      'flex',
    flexDirection:'column',
    overflow:     'hidden',
    minHeight:    '0',
    transition:   'background 0.12s ease',
  });
  // Expose the tile accent so item-recap's .ir-qty chip (and any
  // other .ir-inverted rule that needs to contrast against the tile
  // surface) can read it as --ir-inv-bg.
  card.style.setProperty('--ir-inv-bg', accent);

  // ── Header: big S-num | stacked (SEAT label + gold subtotal) ──
  var hdr = document.createElement('div');
  Object.assign(hdr.style, {
    flexShrink:    '0',
    height:        '36px',
    background:    headerBg,
    display:       'flex',
    alignItems:    'center',
    gap:           '10px',
    padding:       '0 12px',
    cursor:        'pointer',
    userSelect:    'none',
    pointerEvents: 'auto',
    touchAction:   'manipulation',
  });

  var sNum = document.createElement('span');
  Object.assign(sNum.style, {
    fontFamily: T.fh,
    fontWeight: T.fwBold,
    fontSize:   '24px',
    lineHeight: '1',
    color:      labelCol,
    minWidth:   '32px',
  });
  sNum.textContent = 'S' + (seat.number != null ? seat.number : (seatIdx + 1));
  hdr.appendChild(sNum);

  var meta = document.createElement('div');
  Object.assign(meta.style, {
    display:       'flex',
    flexDirection: 'column',
    gap:           '1px',
    flex:          '1',
    minWidth:      '0',
  });

  var metaLbl = document.createElement('span');
  Object.assign(metaLbl.style, {
    fontFamily:    T.fb,
    fontSize:      '8px',
    fontWeight:    T.fwBold,
    letterSpacing: '0.16em',
    color:         subLblCol,
  });
  metaLbl.textContent = 'SEAT';
  meta.appendChild(metaLbl);

  var metaVal = document.createElement('span');
  Object.assign(metaVal.style, {
    fontFamily: T.fb,
    fontSize:   '11px',
    fontWeight: T.fwBold,
    color:      subValCol,
  });
  metaVal.textContent = fmt(seatTotal(seat));
  meta.appendChild(metaVal);

  hdr.appendChild(meta);
  card.appendChild(hdr);

  _wireHeaderTaps(state, seat.id, hdr);

  // ── Body (items) ──
  // Embed buildItemRecap so the tile shares one source of truth for
  // item rendering with the Mode B recap column — chevrons, qty chips,
  // colored prefix badges, microMODs, pizza halves, and the upcharge
  // strip that stays visible while items are collapsed.
  var itemsEl = document.createElement('div');
  itemsEl.className = 'co-scroll';
  Object.assign(itemsEl.style, {
    flex:          '1',
    overflowY:     'auto',
    display:       'flex',
    flexDirection: 'column',
    minHeight:     '0',
  });

  if (seat.items.length === 0) {
    var empty = document.createElement('div');
    Object.assign(empty.style, {
      flex:       '1',
      display:    'flex',
      alignItems: 'center',
      justifyContent: 'center',
      fontFamily: T.fb,
      fontSize:   T.fsB3,
      color:      selected ? hexToRgba(T.well, 0.6) : hexToRgba(T.text, 0.45),
      fontStyle:  'italic',
    });
    empty.textContent = 'empty seat';
    itemsEl.appendChild(empty);
  } else {
    var recap = buildItemRecap(_adaptSeatForRecap(state, seatIdx), {
      hideHeader:           true,
      hideSeatHeader:       true,
      hideTotals:           true,
      defaultItemCollapsed: true,
      // Tile embeds only show one seat, so the adapted order has that
      // seat at seats[0]. Item-recap emits seatIdx=0 in its callbacks;
      // route back to the real seat index on the scene's state.
      onItemTap: function(_seatIdx0, itemIdx0) {
        toggleItem(state, seatIdx, itemIdx0);
      },
      onRemoveItem: function(_seatIdx0, itemIdx0) {
        _voidItems(state, [{ seatIdx: seatIdx, itemIdx: itemIdx0 }]);
      },
    });
    // Recap root ships with its own padding / max-width / bg for the
    // standalone column use-case. Dial those off for the compact tile
    // embed so the inherited tile surface shows through.
    Object.assign(recap.style, {
      padding:    '6px 8px 8px',
      maxWidth:   'none',
      background: 'transparent',
      flex:       '1',
      minHeight:  '0',
    });
    itemsEl.appendChild(recap);
  }

  card.appendChild(itemsEl);

  // ── Footer: SUBTOTAL row ──
  var ftr = document.createElement('div');
  Object.assign(ftr.style, {
    flexShrink:    '0',
    height:        '28px',
    background:    footerBg,
    borderTop:     '0.75px solid ' + divColor,
    display:       'flex',
    alignItems:    'center',
    justifyContent:'space-between',
    padding:       '0 12px',
  });

  var ftrL = document.createElement('span');
  Object.assign(ftrL.style, {
    fontFamily:    T.fb,
    fontSize:      '9px',
    fontWeight:    T.fwBold,
    letterSpacing: '0.14em',
    color:         subLblCol,
  });
  ftrL.textContent = 'SUBTOTAL';
  ftr.appendChild(ftrL);

  var ftrR = document.createElement('span');
  Object.assign(ftrR.style, {
    fontFamily: T.fb,
    fontSize:   '13px',
    fontWeight: T.fwBold,
    color:      subValCol,
  });
  ftrR.textContent = fmt(seatTotal(seat));
  ftr.appendChild(ftrR);

  card.appendChild(ftr);

  if (canDelete) card.appendChild(_buildDeleteSeatX(state, seat.id));
  state.seatEls[seat.id] = { wrap: card, hdr: hdr, itemsEl: itemsEl };
  return card;
}

function buildItemRow(state, seatIdx, itemIdx) {
  var item = state.seats[seatIdx].items[itemIdx];
  var key = seatIdx + ':' + itemIdx;
  var isSel = !!state.selectedItems[key];

  var row = document.createElement('div');
  Object.assign(row.style, {
    display:            'grid',
    gridTemplateColumns:'1fr 32px 58px',
    alignItems:         'center',
    padding:            '4px 6px',
    fontFamily:         T.fb,
    fontSize:           T.fsB3,
    color:              isSel ? T.well : T.text,
    background:         isSel ? T.gold : 'transparent',
    borderBottom:       '1px solid ' + hexToRgba(T.border, 0.3),
    borderRadius:       '4px',
    cursor:             'pointer',
    userSelect:         'none',
    pointerEvents:      'auto',
    touchAction:        'manipulation',
  });

  var name = document.createElement('span');
  name.textContent = item.name;
  name.style.cssText = 'overflow:hidden;text-overflow:ellipsis;white-space:nowrap;';
  row.appendChild(name);

  var qty = document.createElement('span');
  qty.textContent = item.qty;
  qty.style.cssText = 'text-align:right;color:' + (isSel ? T.well : T.text) + ';';
  row.appendChild(qty);

  var px = document.createElement('span');
  px.textContent = fmt(item.qty * (item.effectivePrice || item.price));
  px.style.cssText = 'text-align:right;color:' + (isSel ? T.well : T.gold) + ';font-weight:' + T.fwBold + ';';
  row.appendChild(px);

  _wireItemTaps(state, seatIdx, itemIdx, row);

  // Render modifiers below the row
  var wrap = document.createElement('div');
  wrap.style.cssText = 'display:flex;flex-direction:column;';
  wrap.appendChild(row);
  if (Array.isArray(item.mods) && item.mods.length) {
    for (var mi = 0; mi < item.mods.length; mi++) {
      wrap.appendChild(_modRow(item.mods[mi]));
    }
  }
  return wrap;
}

function _modRow(mod) {
  var isSecondary = mod.prefix === 'NO' || mod.prefix === 'ON SIDE';
  var r = document.createElement('div');
  Object.assign(r.style, {
    display:            'grid',
    gridTemplateColumns:'1fr 58px',
    padding:            '0 0 1px ' + (isSecondary ? '28px' : '20px'),
    fontFamily:         T.fb,
    fontSize:           T.fsB4,
    color:              isSecondary ? T.verm : T.green,
    fontStyle:          isSecondary ? 'italic' : 'normal',
  });
  var nm = document.createElement('span');
  var pre = mod.prefix && mod.prefix !== 'ADD' ? mod.prefix + ' ' : '';
  nm.textContent = pre + (mod.name || '');
  r.appendChild(nm);
  var p = document.createElement('span');
  p.style.cssText = 'text-align:right;color:' + T.gold + ';';
  if (mod.price && mod.price > 0) p.textContent = '+' + fmt(mod.price);
  r.appendChild(p);
  return r;
}

// ═══════════════════════════════════════════════════
//  COMPACT SEAT TILE (Mode C)
// ═══════════════════════════════════════════════════

function buildCompactTile(state, seatIdx) {
  var seat = state.seats[seatIdx];
  var selected = !!state.selected[seat.id];
  var accent = seatAccent(seatIdx);
  var canDelete = seat.items.length === 0
    && activeSeatCount(state.seats, state.paidSeats) > 1;

  var tile = document.createElement('div');
  Object.assign(tile.style, {
    position:       'relative',
    background:     selected ? accent : T.well,
    borderLeft:     T.accentBarW + ' solid ' + hexToRgba(accent, selected ? 0.4 : 1.0),
    borderRadius:   T.chamferCard + 'px',
    padding:        '8px 10px',
    display:        'flex',
    flexDirection:  'column',
    alignItems:     'center',
    justifyContent: 'center',
    gap:            '2px',
    cursor:         'pointer',
    boxShadow:      '0 3px 0 rgba(0,0,0,0.4)',
    userSelect:     'none',
    pointerEvents:  'auto',
    touchAction:    'manipulation',
  });

  var cid = document.createElement('span');
  Object.assign(cid.style, {
    fontFamily:   T.fh,
    fontWeight:   T.fwBold,
    fontSize:     T.fsH4,
    color:        selected ? T.well : T.text,
    letterSpacing:'0.06em',
    lineHeight:   '1',
  });
  cid.textContent = 'S' + (seat.number != null ? seat.number : (seatIdx + 1));
  tile.appendChild(cid);

  var ctot = document.createElement('span');
  Object.assign(ctot.style, {
    fontFamily: T.fb,
    fontSize:   T.fsB3,
    color:      selected ? T.well : T.gold,
    lineHeight: '1',
  });
  ctot.textContent = fmt(seatTotal(seat));
  tile.appendChild(ctot);

  _wireHeaderTaps(state, seat.id, tile);
  if (canDelete) tile.appendChild(_buildDeleteSeatX(state, seat.id));
  state.seatEls[seat.id] = { wrap: tile, hdr: tile, itemsEl: null };
  return tile;
}

// ═══════════════════════════════════════════════════
//  ADD TILE (dashed +)
// ═══════════════════════════════════════════════════

function buildAddTile(state, opts) {
  opts = opts || {};
  var tile = document.createElement('div');
  Object.assign(tile.style, {
    background:     'transparent',
    border:         '1px dashed ' + T.border,
    borderRadius:   T.chamferCard + 'px',
    display:        'flex',
    alignItems:     'center',
    justifyContent: 'center',
    cursor:         'pointer',
    minHeight:      opts.compact ? '72px' : '0',
    pointerEvents:  'auto',
    flexShrink:     '0',
  });
  if (opts.narrow) {
    tile.style.width = '54px';
  }
  var plus = document.createElement('div');
  Object.assign(plus.style, {
    fontFamily: T.fh,
    fontWeight: T.fwBold,
    fontSize:   opts.narrow ? '28px' : (opts.compact ? '32px' : '56px'),
    color:      T.green,
    lineHeight: '1',
  });
  plus.textContent = '+';
  tile.appendChild(plus);

  tile.addEventListener('pointerdown', function() {
    tile.style.background = hexToRgba(T.green, 0.08);
  });
  tile.addEventListener('pointerup', function() {
    tile.style.background = 'transparent';
    addSeat(state);
  });
  tile.addEventListener('pointerleave', function() {
    tile.style.background = 'transparent';
  });
  return tile;
}

// ═══════════════════════════════════════════════════
//  TAP + LONG-PRESS WIRING
// ═══════════════════════════════════════════════════

function _wireHeaderTaps(state, seatId, el) {
  var lpTimer = null;
  var didLongPress = false;

  el.addEventListener('pointerdown', function() {
    didLongPress = false;
    lpTimer = setTimeout(function() {
      didLongPress = true;
      openSeatMenu(state, seatId);
    }, 550);
    state._lpTimers.push(lpTimer);
  });
  el.addEventListener('pointerup', function() {
    if (lpTimer) { clearTimeout(lpTimer); lpTimer = null; }
    if (didLongPress) { didLongPress = false; return; }
    // Tap = toggle selection (but paid seats go to reopen flow)
    if (state.paidSeats[seatId]) {
      reopenSeat(state, seatId);
      return;
    }
    // MANAGE + MOVE: if items are selected, the tap is the MOVE
    // destination, not a selection toggle. If no items are selected
    // yet, fall through so the cashier can use the seat-header tap
    // to select every item in that seat.
    if (state._manageMode
        && state._manageTool === 'move'
        && Object.keys(state.selectedItems || {}).length > 0) {
      var refs = getSelectedItemRefs(state);
      _moveItemsToSeat(state, refs, seatId);
      return;
    }
    toggleSeat(state, seatId);
  });
  el.addEventListener('pointerleave', function() {
    if (lpTimer) { clearTimeout(lpTimer); lpTimer = null; }
    didLongPress = false;
  });
  el.addEventListener('pointercancel', function() {
    if (lpTimer) { clearTimeout(lpTimer); lpTimer = null; }
    didLongPress = false;
  });
}

function _wireItemTaps(state, seatIdx, itemIdx, el) {
  var lpTimer = null;
  var didLongPress = false;
  var key = seatIdx + ':' + itemIdx;

  el.addEventListener('pointerdown', function() {
    didLongPress = false;
    lpTimer = setTimeout(function() {
      didLongPress = true;
      // If something is already selected → bulk menu
      if (Object.keys(state.selectedItems).length > 0) {
        openBulkMenu(state);
      } else {
        openItemMenu(state, seatIdx, itemIdx);
      }
    }, 500);
    state._lpTimers.push(lpTimer);
  });
  el.addEventListener('pointerup', function() {
    if (lpTimer) { clearTimeout(lpTimer); lpTimer = null; }
    if (didLongPress) { didLongPress = false; return; }
    toggleItem(state, seatIdx, itemIdx);
  });
  el.addEventListener('pointerleave', function() {
    if (lpTimer) { clearTimeout(lpTimer); lpTimer = null; }
    didLongPress = false;
  });
  el.addEventListener('pointercancel', function() {
    if (lpTimer) { clearTimeout(lpTimer); lpTimer = null; }
    didLongPress = false;
  });
}

// ═══════════════════════════════════════════════════
//  SELECTION OPERATIONS
// ═══════════════════════════════════════════════════

// Selection toggles forward to pure helpers in ./seats.js that return a
// fresh selection map; the scene owns the re-render trigger.
function toggleSeat(state, seatId) {
  state.selected = toggleSeatSelection(state.selected, state.paidSeats, seatId);
  // Mirror seat selection onto per-item selection: downstream ops
  // (PAY SEATS, MANAGE, discount) read from state.selectedItems, so
  // tapping a seat header behaves the same as hand-tapping every
  // item in that seat.
  var seatIdx = -1;
  for (var i = 0; i < state.seats.length; i++) {
    if (state.seats[i].id === seatId) { seatIdx = i; break; }
  }
  if (seatIdx >= 0) {
    var seat = state.seats[seatIdx];
    var nowSelected = !!state.selected[seatId];
    for (var j = 0; j < seat.items.length; j++) {
      var key = seatIdx + ':' + j;
      if (nowSelected) state.selectedItems[key] = true;
      else             delete state.selectedItems[key];
    }
  }
  rerenderTopArea(state);
}

function toggleItem(state, seatIdx, itemIdx) {
  state.selectedItems = toggleItemSelection(state.selectedItems, seatIdx, itemIdx);
  rerenderTopArea(state);
}

function forceSelectAll(state) {
  state.selected = selectAllUnpaid(state.seats, state.paidSeats);
  rerenderTopArea(state);
}

function clearAllSelection(state) {
  state.selected = {};
  state.selectedItems = {};
  rerenderTopArea(state);
}

function getSelectedItemRefs(state) {
  return collectSelectedItemRefs(state.selectedItems);
}

function getSelectedSeatIds(state) {
  return Object.keys(state.selected);
}

function addSeat(state) {
  var maxNum = 0;
  for (var i = 0; i < state.seats.length; i++) {
    if (state.seats[i].number > maxNum) maxNum = state.seats[i].number;
  }
  var num = maxNum + 1;
  state.seats.push({
    id:     'S-' + String(num).padStart(3, '0'),
    number: num,
    items:  [],
  });
  persistSeats(state);
  rerenderTopArea(state);
}

function deleteSeat(state, seatId) {
  var seatIdx = -1;
  for (var i = 0; i < state.seats.length; i++) {
    if (state.seats[i].id === seatId) { seatIdx = i; break; }
  }
  if (seatIdx < 0) return;
  // A paid seat still carries a backend payment record. Deleting it from
  // the UI orphans that payment against a seat_id the check no longer has,
  // desyncing the ledger. Block the delete and surface a hint that the
  // payment must be voided/reopened first.
  if (state.paidSeats && state.paidSeats[seatId]) {
    entReport({
      code: 'UI-007', level: 'INFO',
      source: 'check-overview.deleteSeat',
      message: 'dead-end tap: delete a paid seat',
      ctx: { orderId: state.orderId, seatId: seatId },
    });
    showToast('Can’t remove a paid seat — reopen the payment first', { bg: T.gold });
    return;
  }
  if (state.seats[seatIdx].items.length > 0) {
    showToast('Seat has items — void them first', { bg: T.verm });
    return;
  }
  if (activeSeatCount(state.seats, state.paidSeats) <= 1) {
    showToast('Can’t remove the only seat', { bg: T.gold });
    return;
  }
  state.seats.splice(seatIdx, 1);
  delete state.selected[seatId];
  persistSeats(state);
  rerenderTopArea(state);
}

// Push the current seat layout to the backend. Creates the order on first
// call (no orderId yet) and replaces the seat list thereafter. Seats live
// in the backend as a first-class list, so they survive scene unmount,
// logout, and lack-of-items.
function _idemKey() {
  // 16 hex chars of randomness. Good enough to dedupe at the backend.
  return 'co-' + Math.random().toString(16).slice(2, 10) + Date.now().toString(16);
}

function persistSeats(state) {
  // Serialize requests via a per-state promise chain. Rapid taps on "+"
  // used to race: each call would see orderId=null and POST its own
  // /orders, creating duplicate C-### checks. The chain guarantees the
  // first tap completes (POSTing and capturing orderId) before any
  // follow-up runs as a PUT against that same orderId.
  state._seatsChain = (state._seatsChain || Promise.resolve()).then(function() {
    var nums = state.seats.map(function(s) { return s.number; });
    if (nums.length === 0) return;

    if (state.orderId) {
      return fetchWithTimeout('/api/v1/orders/' + state.orderId + '/seats', {
        method:  'PUT',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ seat_numbers: nums }),
      }, 15000)
        .then(function() {
          SceneManager.emit('order:updated', { orderId: state.orderId });
        })
        .catch(function(err) {
          console.warn('[KINDpos] Seat update failed:', err);
          entReport({
            code: 'UI-009', level: 'WARNING',
            source: 'check-overview.persistSeats',
            message: 'PUT /seats failed',
            ctx: { orderId: state.orderId, error: String(err && err.message || err).slice(0, 200) },
          });
        });
    }

    // First POST — create the order with the seats attached. Caller
    // params captured at mount time carry the employee identity.
    //
    // Idempotency-Key is stable per-mount: if the first POST times out
    // (request reached the server but the response was lost) and the
    // user taps "+ Add Seat" again, this retry hits the backend with the
    // same key and the ledger returns the original order instead of
    // minting a duplicate C-###. Verified by the pytest
    // test_create_order_is_idempotent added earlier in this branch.
    state._createOrderIdemKey = state._createOrderIdemKey || _idemKey();
    var params = state._mountParams || {};
    return fetchWithTimeout('/api/v1/orders', {
      method:  'POST',
      headers: {
        'Content-Type':    'application/json',
        'Idempotency-Key': state._createOrderIdemKey,
      },
      body:    JSON.stringify({
        server_id:    params.employeeId || null,
        server_name:  params.employeeName || null,
        seat_numbers: nums,
      }),
    }, 15000)
      .then(function(r) { return r.ok ? r.json() : null; })
      .then(function(order) {
        if (!order) {
          entReport({
            code: 'UI-009', level: 'WARNING',
            source: 'check-overview.persistSeats',
            message: 'POST /orders returned empty or non-OK response',
            ctx: { seatNumbers: nums },
          });
          return;
        }
        var newId = order.order_id || order.id;
        if (!newId) {
          // Backend returned 200 with no order_id. state.orderId stays
          // null, which would send the next persistSeats tap back into
          // the POST branch — the Idempotency-Key above is what prevents
          // the duplicate from landing in the ledger. Still surface it
          // so the malformed response is visible in entomology.
          entReport({
            code: 'UI-009', level: 'ERROR',
            source: 'check-overview.persistSeats',
            message: 'POST /orders response missing order_id',
            ctx: { keys: Object.keys(order).slice(0, 20) },
          });
          return;
        }
        state.orderId     = newId;
        state.checkNumber = order.check_number || '';
        if (state.checkNumber) setSceneName(state.checkNumber);
        SceneManager.emit('order:updated', { orderId: state.orderId });
      })
      .catch(function(err) {
        console.warn('[KINDpos] Order create-with-seats failed:', err);
        entReport({
          code: 'UI-009', level: 'WARNING',
          source: 'check-overview.persistSeats',
          message: 'POST /orders rejected',
          ctx: { error: String(err && err.message || err).slice(0, 200) },
        });
      });
  });
  return state._seatsChain;
}

// Tiny × button overlay for empty seats. Tapping removes the seat.
function _buildDeleteSeatX(state, seatId) {
  var x = document.createElement('div');
  Object.assign(x.style, {
    position:       'absolute',
    top:            '5px',
    right:          '6px',
    width:          '24px',
    height:         '24px',
    borderRadius:   '50%',
    background:     T.verm,
    color:          '#fff',
    fontFamily:     T.fh,
    fontWeight:     T.fwBold,
    fontSize:       '16px',
    display:        'flex',
    alignItems:     'center',
    justifyContent: 'center',
    cursor:         'pointer',
    userSelect:     'none',
    zIndex:         '5',
    lineHeight:     '1',
    boxShadow:      '0 2px 6px rgba(0,0,0,0.5)',
    pointerEvents:  'auto',
    touchAction:    'manipulation',
  });
  x.textContent = '\u00d7';
  // Capture-phase handlers so we win against the header's listeners.
  x.addEventListener('pointerdown', function(e) {
    e.stopPropagation();
    e.preventDefault();
  });
  x.addEventListener('pointerup',   function(e) {
    e.stopPropagation();
    e.preventDefault();
    deleteSeat(state, seatId);
  });
  x.addEventListener('click', function(e) {
    // Fallback for platforms where click still fires
    e.stopPropagation();
    e.preventDefault();
    deleteSeat(state, seatId);
  });
  return x;
}

// ═══════════════════════════════════════════════════
//  PRINT
// ═══════════════════════════════════════════════════

function handlePrint(state) {
  if (!state.orderId) {
    entReport({
      code: 'UI-007', level: 'INFO',
      source: 'check-overview.handlePrint',
      message: 'dead-end tap: PRINT before any items saved',
      ctx: { orderId: null, seatCount: (state.seats || []).length },
    });
    showToast('Save items first', { bg: T.gold });
    return;
  }
  showToast('Printing receipt…', { bg: T.green });
  fetch('/api/v1/orders/' + state.orderId + '/print/receipt', { method: 'POST' })
    .then(function(r) {
      if (r.ok) showToast('Receipt printed', { bg: T.greenWarm });
      else      showToast('Print failed', { bg: T.verm });
    })
    .catch(function() { showToast('Print failed', { bg: T.verm }); });
}

// ═══════════════════════════════════════════════════
//  RESEND (re-fire kitchen tickets)
// ═══════════════════════════════════════════════════

function handleResend(state) {
  if (!state.orderId) {
    entReport({
      code: 'UI-007', level: 'INFO',
      source: 'check-overview.handleResend',
      message: 'dead-end tap: RESEND on a check with no orderId',
      ctx: { orderId: null },
    });
    showToast('Nothing to resend', { bg: T.gold });
    return;
  }
  showToast('Resending to kitchen…', { bg: T.green });
  fetch('/api/v1/orders/' + state.orderId + '/resend', { method: 'POST' })
    .then(function(r) {
      if (r.ok) showToast('Kitchen ticket sent', { bg: T.greenWarm });
      else      showToast('Resend failed', { bg: T.verm });
    })
    .catch(function() { showToast('Resend failed', { bg: T.verm }); });
}

// ═══════════════════════════════════════════════════
//  ADD ITEMS (push to order-entry)
// ═══════════════════════════════════════════════════

function handleAddItems(state, params) {
  // Order creation deferred to order-entry's first SAVE/SEND — no POST here.
  // Passing state.orderId forward lets order-entry recall an existing check
  // when we're editing; null means a brand-new check will be created lazily.
  _gotoOrderEntry(state, params);
}

async function _gotoOrderEntry(state, params) {
  // If the backend hasn't responded yet (user tapped ADD ITEMS before
  // the initial refreshOrder fetch resolved), state.seats is still the
  // default [{number:1}] that the scene paints on mount. Threading that
  // into order-entry makes assignSeatsIfNeeded treat it as a 1-seat
  // check and auto-assigns every new item to seat 1 — the "seats
  // combine" regression. Await the refresh so seatNumbers reflects
  // the real layout before we route.
  if (state.orderId && !state.order) {
    showToast('Loading check…', { bg: T.gold, duration: 800 });
    try { await refreshOrder(state, params); }
    catch (e) { /* refreshOrder already swallows; fall through to the guard */ }
  }
  // After the await, state.order may STILL be null — refreshOrder only sets it
  // on a 2xx response with a JSON body. A 404 / 500 / network error silently
  // leaves state.seats at the [{number:1}] default and would re-expose the
  // combining-seats bug. Refuse to navigate; surface the miss to entReport
  // so the backend side of the bug is visible in diagnostics.
  if (state.orderId && !state.order) {
    showToast('Couldn’t load check — check network and try again', { bg: T.verm, duration: 2500 });
    entReport({
      code: 'UI-005',
      source: 'check-overview._gotoOrderEntry',
      message: 'Refused ADD ITEMS navigation: state.order is null after refresh',
      ctx: { orderId: state.orderId },
      level: 'WARNING',
    });
    return;
  }
  // Param shape lives in scenes/transitions.js so the check-overview
  // and order-entry sides of the handoff share one source of truth.
  // A brand-new check threads recallOrderId=null and order-entry POSTs
  // /orders lazily on first SEND.
  SceneManager.mountWorking('order-entry', buildOrderEntryParams(state, params));
}

// ═══════════════════════════════════════════════════
//  PAY (push to payment scene for selected seat(s))
// ═══════════════════════════════════════════════════

function handlePay(state, params) {
  if (!state.orderId) {
    entReport({
      code: 'UI-007', level: 'INFO',
      source: 'check-overview.handlePay',
      message: 'dead-end tap: PAY before any items saved',
      ctx: { orderId: null },
    });
    showToast('Save items first', { bg: T.gold });
    return;
  }

  var selectedIds = getSelectedSeatIds(state);
  if (selectedIds.length === 0) {
    // No seats selected — default to "pay whole check" (all non-paid seats
    // with items on them).
    for (var i = 0; i < state.seats.length; i++) {
      if (!state.paidSeats[state.seats[i].id] && state.seats[i].items.length > 0) {
        selectedIds.push(state.seats[i].id);
      }
    }
  }
  if (selectedIds.length === 0) {
    entReport({
      code: 'UI-007', level: 'INFO',
      source: 'check-overview.handlePay',
      message: 'dead-end tap: PAY on an empty check',
      ctx: {
        orderId: state.orderId,
        seatCount: (state.seats || []).length,
        paidSeatCount: Object.keys(state.paidSeats || {}).length,
      },
    });
    showToast('No items to pay', { bg: T.gold });
    return;
  }

  // Build the seat-totals summary the payment scene needs — seat IDs,
  // per-seat subtotals, and their items (so payment can display what it's
  // charging for per seat).
  var seatSummary = [];
  for (var s = 0; s < state.seats.length; s++) {
    if (selectedIds.indexOf(state.seats[s].id) === -1) continue;
    if (state.paidSeats[state.seats[s].id]) continue;
    seatSummary.push({
      seatId:  state.seats[s].id,
      number:  state.seats[s].number,
      items:   state.seats[s].items,
    });
  }

  SceneManager.mountWorking('payment', {
    orderId:      state.orderId,
    seatIds:      selectedIds,
    seats:        seatSummary,
    returnTo:     'check-overview',
    returnParams: {
      checkId:       state.orderId,
      returnLanding: params.returnLanding,
      employeeId:    params.employeeId,
      employeeName:  params.employeeName,
      pin:           params.pin,
    },
    employeeId:   params.employeeId,
    employeeName: params.employeeName,
    pin:          params.pin,
  });
}

// ═══════════════════════════════════════════════════
//  VOID  (items / seats with undo window)
// ═══════════════════════════════════════════════════

function handleVoid(state) {
  var itemRefs = getSelectedItemRefs(state);
  var seatIds  = getSelectedSeatIds(state);

  if (itemRefs.length === 0 && seatIds.length === 0) {
    entReport({
      code: 'UI-007', level: 'INFO',
      source: 'check-overview.handleVoid',
      message: 'dead-end tap: VOID with nothing selected',
      ctx: { orderId: state.orderId || null },
    });
    showToast('Select items or seats to void', { bg: T.gold });
    return;
  }

  // Expand seat selections into item refs
  if (itemRefs.length === 0 && seatIds.length > 0) {
    for (var s = 0; s < seatIds.length; s++) {
      var sIdx = _seatIdxById(state, seatIds[s]);
      if (sIdx < 0) continue;
      for (var j = 0; j < state.seats[sIdx].items.length; j++) {
        itemRefs.push({ seatIdx: sIdx, itemIdx: j });
      }
    }
  }

  if (itemRefs.length === 0) {
    entReport({
      code: 'UI-007', level: 'INFO',
      source: 'check-overview.handleVoid',
      message: 'dead-end tap: VOID on empty seats',
      ctx: { orderId: state.orderId || null, seatIdsSelected: seatIds.length },
    });
    showToast('Nothing to void', { bg: T.gold });
    return;
  }

  _voidItems(state, itemRefs);
}

function _voidItems(state, refs) {
  // Sort descending within each seat so splice doesn't shift indices
  refs.sort(function(a, b) {
    if (a.seatIdx !== b.seatIdx) return b.seatIdx - a.seatIdx;
    return b.itemIdx - a.itemIdx;
  });

  var snapshot = [];
  for (var i = 0; i < refs.length; i++) {
    var r = refs[i];
    snapshot.push({
      seatIdx: r.seatIdx,
      itemIdx: r.itemIdx,
      item:    state.seats[r.seatIdx].items[r.itemIdx],
    });
    state.seats[r.seatIdx].items.splice(r.itemIdx, 1);
  }

  state.selectedItems = {};
  rerenderTopArea(state);

  showToast('Voided ' + refs.length + ' item(s) — tap to undo', {
    bg: T.verm,
    duration: 4000,
    onClick: function() {
      // Reinsert in ascending order
      snapshot.sort(function(a, b) {
        if (a.seatIdx !== b.seatIdx) return a.seatIdx - b.seatIdx;
        return a.itemIdx - b.itemIdx;
      });
      for (var j = 0; j < snapshot.length; j++) {
        var s = snapshot[j];
        state.seats[s.seatIdx].items.splice(s.itemIdx, 0, s.item);
      }
      rerenderTopArea(state);
      showToast('Void undone', { bg: T.greenWarm });
    },
  });

  // After the undo window, commit to backend
  if (state.orderId) {
    setTimeout(function() {
      for (var k = 0; k < snapshot.length; k++) {
        var iid = snapshot[k].item.item_id;
        if (!iid) continue;
        fetch('/api/v1/orders/' + state.orderId + '/items/' + iid, { method: 'DELETE' });
      }
    }, 4200);
  }
}

function _seatIdxById(state, seatId) {
  for (var i = 0; i < state.seats.length; i++) {
    if (state.seats[i].id === seatId) return i;
  }
  return -1;
}

// ═══════════════════════════════════════════════════
//  DISCOUNT (manager PIN → % picker → apply)
// ═══════════════════════════════════════════════════

function handleDiscount(state) {
  var itemRefs = getSelectedItemRefs(state);
  var seatIds  = getSelectedSeatIds(state);

  if (itemRefs.length === 0 && seatIds.length === 0) {
    entReport({
      code: 'UI-007', level: 'INFO',
      source: 'check-overview.handleDiscount',
      message: 'dead-end tap: DISC with nothing selected',
      ctx: { orderId: state.orderId || null },
    });
    showToast('Select items or seats to discount', { bg: T.gold });
    return;
  }

  SceneManager.interrupt('disc-pin', {
    onConfirm: function(approvedBy) {
      SceneManager.interrupt('disc-select', {
        onConfirm: function(opt) {
          _applyDiscount(state, opt.pct, itemRefs, seatIds, approvedBy);
        },
        onCancel: function() {},
      });
    },
    onCancel: function() {},
  });
}

function _applyDiscount(state, pct, itemRefs, seatIds, approvedBy) {
  // Expand seat selections into item refs
  if (itemRefs.length === 0 && seatIds.length > 0) {
    for (var s = 0; s < seatIds.length; s++) {
      var sIdx = _seatIdxById(state, seatIds[s]);
      if (sIdx < 0) continue;
      for (var j = 0; j < state.seats[sIdx].items.length; j++) {
        itemRefs.push({ seatIdx: sIdx, itemIdx: j });
      }
    }
  }

  // Collect the selected lines so the pure discount helpers (see
  // discount.js) can compute the dollar amount + item_ids and build
  // the wire body. Previously this was inlined with a TODO — discount
  // survived re-render but not refresh/re-login.
  var lines = [];
  for (var i = 0; i < itemRefs.length; i++) {
    var r = itemRefs[i];
    lines.push(state.seats[r.seatIdx].items[r.itemIdx]);
  }
  var amount = computeDiscountAmount(lines, pct);
  var itemIds = extractItemIds(lines);
  if (amount <= 0 || !state.orderId) {
    showToast('Discount has no selected items', { bg: T.gold });
    return;
  }

  fetchWithTimeout('/api/v1/orders/' + state.orderId + '/discount', {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify(buildDiscountBody(pct, amount, itemIds, approvedBy)),
  }, 15000).then(function(r) {
    if (!r.ok) return r.json().then(function(d) { throw new Error(d.detail || 'HTTP ' + r.status); });
    return r.json();
  }).then(function() {
    state.selectedItems = {};
    state.selected = {};
    // Let the scene refresh from backend truth so other panels (totals,
    // balance_due, payment scene) see the new discount. `order:updated`
    // is the same bus event the server-landing refresh listens on.
    SceneManager.emit('order:updated', { orderId: state.orderId });
    if (typeof refreshOrder === 'function') refreshOrder(state, {});
    showToast(pct + '% discount applied', { bg: T.greenWarm });
  }).catch(function(err) {
    showToast('Discount failed: ' + (err && err.message ? err.message : 'unknown'), { bg: T.verm });
  });
}

// ═══════════════════════════════════════════════════
//  LONG-PRESS MENUS
// ═══════════════════════════════════════════════════

function openItemMenu(state, seatIdx, itemIdx) {
  // When long-pressed on an unselected item, select it first so the
  // menu acts on a clear single target.
  state.selectedItems = {};
  state.selectedItems[seatIdx + ':' + itemIdx] = true;
  rerenderTopArea(state);

  SceneManager.interrupt('co-item-menu', {
    title:   'Item Options',
    options: [
      { id: 'void',     label: 'Void this item',      color: T.verm      },
      { id: 'disc',     label: 'Discount this item',  color: T.gold      },
      { id: 'move',     label: 'Move to seat…',       color: T.green     },
      { id: 'qty',      label: 'Change quantity',     color: T.green     },
      { id: 'note',     label: 'Add note',            color: T.green     },
      { id: 'reprint',  label: 'Reprint to kitchen',  color: T.greenWarm },
    ],
    onConfirm: function(optId) { handleItemAction(state, optId, seatIdx, itemIdx); },
    onCancel:  function() { state.selectedItems = {}; rerenderTopArea(state); },
  });
}

function openBulkMenu(state) {
  SceneManager.interrupt('co-item-menu', {
    title:   Object.keys(state.selectedItems).length + ' Items Selected',
    options: [
      { id: 'void',     label: 'Void selected',            color: T.verm      },
      { id: 'disc',     label: 'Discount selected',        color: T.gold      },
      { id: 'move',     label: 'Move selected to seat…',   color: T.green     },
      { id: 'reprint',  label: 'Reprint selected',         color: T.greenWarm },
    ],
    onConfirm: function(optId) { handleBulkAction(state, optId); },
    onCancel:  function() {},
  });
}

function openSeatMenu(state, seatId) {
  var sIdx = _seatIdxById(state, seatId);
  var seat = state.seats[sIdx];
  var empty = seat && seat.items.length === 0;
  var options = [
    { id: 'void',     label: 'Void seat',            color: T.verm      },
    { id: 'disc',     label: 'Discount seat',        color: T.gold      },
    { id: 'rename',   label: 'Rename seat',          color: T.green     },
    { id: 'merge',    label: 'Merge with seat…',     color: T.green     },
    { id: 'split',    label: 'Split items across…',  color: T.green     },
    { id: 'transfer', label: 'Transfer to server…',  color: T.green     },
  ];
  if (empty) options.push({ id: 'delete', label: 'Delete seat', color: T.verm });

  SceneManager.interrupt('co-item-menu', {
    title:   seatId + ' Options',
    options: options,
    onConfirm: function(optId) { handleSeatAction(state, optId, seatId); },
    onCancel:  function() {},
  });
}

// ═══════════════════════════════════════════════════
//  MENU ACTION HANDLERS
// ═══════════════════════════════════════════════════

function handleItemAction(state, optId, seatIdx, itemIdx) {
  if (optId === 'void') {
    _voidItems(state, [{ seatIdx: seatIdx, itemIdx: itemIdx }]);
  } else if (optId === 'disc') {
    handleDiscount(state);
  } else if (optId === 'move') {
    _pickMoveTarget(state, [{ seatIdx: seatIdx, itemIdx: itemIdx }]);
  } else if (optId === 'qty') {
    _promptQty(state, seatIdx, itemIdx);
  } else if (optId === 'note') {
    _promptNote(state, seatIdx, itemIdx);
  } else if (optId === 'reprint') {
    showToast('Reprint — coming soon', { bg: T.gold });
  }
}

function handleBulkAction(state, optId) {
  var refs = getSelectedItemRefs(state);
  if (optId === 'void') {
    _voidItems(state, refs);
  } else if (optId === 'disc') {
    handleDiscount(state);
  } else if (optId === 'move') {
    _pickMoveTarget(state, refs);
  } else if (optId === 'reprint') {
    showToast('Reprint — coming soon', { bg: T.gold });
  }
}

function handleSeatAction(state, optId, seatId) {
  var sIdx = _seatIdxById(state, seatId);
  if (sIdx < 0) return;

  if (optId === 'void') {
    var refs = [];
    for (var i = 0; i < state.seats[sIdx].items.length; i++) {
      refs.push({ seatIdx: sIdx, itemIdx: i });
    }
    if (refs.length === 0) { showToast('Seat is already empty', { bg: T.gold }); return; }
    _voidItems(state, refs);
  } else if (optId === 'disc') {
    state.selected = {};
    state.selected[seatId] = true;
    handleDiscount(state);
  } else if (optId === 'rename') {
    showToast('Rename seat — coming soon', { bg: T.gold });
  } else if (optId === 'merge') {
    _pickMergeTarget(state, seatId);
  } else if (optId === 'split') {
    openEditSeats(state);
  } else if (optId === 'transfer') {
    _openTransfer(state);
  } else if (optId === 'delete') {
    deleteSeat(state, seatId);
  }
}

// ── Move primitive ──
// Shared in-memory move used by both the long-press "Move to seat…"
// picker (_pickMoveTarget) and the MANAGE MOVE tool. refs is the
// [{seatIdx, itemIdx}] list the selection helpers produce; targetSeatId
// is the destination seat. opts.skipLog skips the MANAGE UNDO entry
// when the helper is driving a caller that already owns its own log
// (reserved for future use). Returns the count actually moved.
function _moveItemsToSeat(state, refs, targetSeatId, opts) {
  opts = opts || {};
  var targetIdx = _seatIdxById(state, targetSeatId);
  if (targetIdx < 0) return 0;

  // Move in descending order so earlier splice calls don't shift the
  // indices of later ones (matches the pre-extraction behavior).
  refs.sort(function(a, b) {
    if (a.seatIdx !== b.seatIdx) return b.seatIdx - a.seatIdx;
    return b.itemIdx - a.itemIdx;
  });

  var patches = [];
  for (var r = 0; r < refs.length; r++) {
    var rr = refs[r];
    if (rr.seatIdx === targetIdx) continue;  // skip no-op moves
    var fromSeat = state.seats[rr.seatIdx];
    var it = fromSeat.items.splice(rr.itemIdx, 1)[0];
    state.seats[targetIdx].items.push(it);
    patches.push({
      fromSeatId: fromSeat.id,
      fromItemIdx: rr.itemIdx,
      item: it,
    });
  }

  if (patches.length === 0) {
    showToast('Already on ' + targetSeatId, { bg: T.gold });
    return 0;
  }

  if (state._manageMode && !opts.skipLog) {
    state._manageLog.push({
      kind:         'move',
      targetSeatId: targetSeatId,
      patches:      patches,
    });
  }

  state.selectedItems = {};
  state.selected      = {};
  rerenderTopArea(state);
  showToast('Moved ' + patches.length + ' item(s)', { bg: T.greenWarm });
  return patches.length;
}

function _pickMoveTarget(state, refs) {
  // Build seat list excluding paid seats.
  var options = [];
  for (var i = 0; i < state.seats.length; i++) {
    if (state.paidSeats[state.seats[i].id]) continue;
    options.push({ id: state.seats[i].id, label: state.seats[i].id, color: T.green });
  }
  options.push({ id: '__new__', label: '+ New seat', color: T.greenWarm });

  SceneManager.interrupt('co-item-menu', {
    title:   'Move to Seat',
    options: options,
    onConfirm: function(optId) {
      var targetId;
      if (optId === '__new__') {
        addSeat(state);
        targetId = state.seats[state.seats.length - 1].id;
      } else {
        targetId = optId;
      }
      _moveItemsToSeat(state, refs, targetId);
    },
    onCancel: function() {},
  });
}

function _pickMergeTarget(state, sourceSeatId) {
  var options = [];
  for (var i = 0; i < state.seats.length; i++) {
    if (state.paidSeats[state.seats[i].id]) continue;
    if (state.seats[i].id === sourceSeatId) continue;
    options.push({ id: state.seats[i].id, label: state.seats[i].id, color: T.green });
  }
  if (options.length === 0) { showToast('No other seats to merge with', { bg: T.gold }); return; }

  SceneManager.interrupt('co-item-menu', {
    title:   'Merge ' + sourceSeatId + ' Into…',
    options: options,
    onConfirm: function(targetId) {
      var sIdx = _seatIdxById(state, sourceSeatId);
      var tIdx = _seatIdxById(state, targetId);
      if (sIdx < 0 || tIdx < 0) return;
      state.seats[tIdx].items = state.seats[tIdx].items.concat(state.seats[sIdx].items);
      state.seats.splice(sIdx, 1);
      delete state.selected[sourceSeatId];
      rerenderTopArea(state);
      showToast('Merged into ' + targetId, { bg: T.greenWarm });
    },
    onCancel: function() {},
  });
}

function _promptQty(state, seatIdx, itemIdx) {
  showToast('Change qty — coming soon', { bg: T.gold });
  // TODO: numpad interrupt to set new quantity, patch backend.
}

function _promptNote(state, seatIdx, itemIdx) {
  showToast('Add note — coming soon', { bg: T.gold });
  // TODO: showKeyboard interrupt, update item.notes, patch backend.
}

function _openTransfer(state) {
  if (!state.orderId) { showToast('Save items first', { bg: T.gold }); return; }
  SceneManager.interrupt('server-picker', {
    onConfirm: function(server) {
      fetch('/api/v1/orders/' + state.orderId, {
        method:  'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          server_id:   server.employee_id,
          server_name: server.employee_name,
        }),
      }).then(function(r) {
        if (r.ok) showToast('Transferred to ' + server.employee_name, { bg: T.greenWarm });
        else      showToast('Transfer failed',                         { bg: T.verm });
      }).catch(function() {
        // Network/offline — without this the promise hangs forever and
        // the server sees no toast, no retry, no signal that the transfer
        // did NOT happen. Explicit catch so the op is recoverable.
        showToast('Transfer failed — check connection', { bg: T.verm });
      });
    },
    onCancel: function() {},
    excludeId: null,
  });
}

// ═══════════════════════════════════════════════════
//  EDIT SEATS (column-editor for split/merge/move)
// ═══════════════════════════════════════════════════

function openEditSeats(state) {
  var columns = [];
  for (var i = 0; i < state.seats.length; i++) {
    if (state.paidSeats[state.seats[i].id]) continue;
    columns.push({
      id:    state.seats[i].id,
      label: state.seats[i].id,
      items: state.seats[i].items.map(function(it) {
        return {
          name:         it.name,
          qty:          it.qty,
          price:        it.price,
          item_id:      it.item_id,
          menu_item_id: it.menu_item_id,
          category:     it.category,
          mods:         it.mods,
          notes:        it.notes,
        };
      }),
    });
  }
  SceneManager.openTransactional('column-editor', {
    columns:    columns,
    operations: ['MERGE', 'MOVE', 'SPLIT'],
    orderId:    state.orderId,
    onSave: function(newColumns) {
      // Rebuild seats from columns
      var newSeats = [];
      for (var c = 0; c < newColumns.length; c++) {
        var oldNumber = parseInt(newColumns[c].id.replace(/^S-|^NEW-/, ''), 10) || (c + 1);
        newSeats.push({
          id:     'S-' + String(c + 1).padStart(3, '0'),
          number: c + 1,
          items:  newColumns[c].items,
        });
      }
      // Preserve any paid seats at the front unchanged
      var paid = [];
      for (var p = 0; p < state.seats.length; p++) {
        if (state.paidSeats[state.seats[p].id]) paid.push(state.seats[p]);
      }
      state.seats = paid.concat(newSeats);
      state.selectedItems = {};
      state.selected = {};
      rerenderTopArea(state);
      // TODO: diff against backend and POST new / PATCH changed / DELETE removed.
    },
  });
}

// ═══════════════════════════════════════════════════
//  ORDER SUMMARY (Mode C only)
// ═══════════════════════════════════════════════════

function renderOrderSummary(state) {
  var s = collectSummary(state.seats, state.selected, state.paidSeats);
  state._summaryItemMap = {};

  if (!state._osActive) {
    OrderSummary.show({
      checkLabel:   state.checkNumber || state.orderId || 'check',
      customerName: state.customerName || '',
      items:        s.items,
      subtotal:     s.subtotal,
      tax:          s.tax,
      cardTotal:    s.cardTotal,
      cashPrice:    s.cashPrice,
      onNameTap:    function() { openNameEditor(state); },
      onItemTap:    function(idx) { _onOSItemTap(state, idx); },
    });
    state._osActive = true;
  } else {
    OrderSummary.update({
      checkLabel:   state.checkNumber || state.orderId || 'check',
      customerName: state.customerName || '',
      items:        s.items,
      subtotal:     s.subtotal,
      tax:          s.tax,
      cardTotal:    s.cardTotal,
      cashPrice:    s.cashPrice,
    });
  }
}

function _onOSItemTap(state, idx) {
  // TODO: when OrderSummary fires an item tap, translate back to (seatIdx, itemIdx)
  // and toggle selection, then rerender. Since collectSummary already includes
  // seatIdx/itemIdx on item entries, we can use that.
  // For now stubbed — selection in Mode C is driven by compact tiles.
}

// ═══════════════════════════════════════════════════
//  CUSTOMER NAME EDITOR
// ═══════════════════════════════════════════════════

function openNameEditor(state) {
  SceneManager.interrupt('co-name-input', {
    currentName: state.customerName,
    onConfirm:   function(name) {
      state.customerName = name;
      if (state.orderId) {
        fetch('/api/v1/orders/' + state.orderId, {
          method:  'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify({ customer_name: name }),
        });
      }
      if (state._osActive) renderOrderSummary(state);
    },
    onCancel: function() {},
  });
}

// ═══════════════════════════════════════════════════
//  REOPEN PAID SEAT (void payment flow)
// ═══════════════════════════════════════════════════

function reopenSeat(state, seatId) {
  if (!state.orderId) return;
  // 15s abort guard so a hung backend doesn't leave the reopen flow
  // waiting indefinitely.
  fetchWithTimeout('/api/v1/orders/' + state.orderId, { cache: 'no-store' }, 15000)
    .then(function(r) { return r.ok ? r.json() : null; })
    .then(function(order) {
      if (order) state.order = order;
      var source = (order && order.payments) || (state.order && state.order.payments) || [];
      var matches = source.filter(function(p) { return p.seat_id === seatId; });
      if (matches.length === 0) {
        showToast('No payment found for this seat', { bg: T.gold });
        return;
      }
      openSeatPaymentInterrupt(state, seatId, matches);
    });
}

function openSeatPaymentInterrupt(state, seatId, payments) {
  SceneManager.interrupt('seat-payment', {
    seatId:   seatId,
    payments: payments,
    onConfirm: function(paymentId) {
      fetch('/api/v1/orders/' + state.orderId + '/payments/' + paymentId, {
        method:  'DELETE',
      }).then(function(r) {
        if (r.ok) {
          delete state.paidSeats[seatId];
          showToast('Payment voided', { bg: T.greenWarm });
          refreshOrder(state, {});
        } else {
          showToast('Void failed', { bg: T.verm });
        }
      });
    },
    onCancel: function() {},
  });
}

// ═══════════════════════════════════════════════════
//  REFRESH ORDER (fetch + re-render)
// ═══════════════════════════════════════════════════

function refreshOrder(state, params) {
  // Return a Promise so callers that route away from check-overview (ADD
  // ITEMS → order-entry) can await the backend truth before they thread
  // seat data into the next scene. Previously refreshOrder was fire-and-
  // forget; a fast tap on ADD ITEMS could land in order-entry with the
  // default `state.seats = orderToSeats(null, 1)` = [1] still in place,
  // which made `assignSeatsIfNeeded` treat it as a 1-seat check and
  // silently send every new item to seat 1 ("combined seats" bug).
  if (!state.orderId) return Promise.resolve();
  if (state._refreshPromise) return state._refreshPromise;
  // If a seat-mutation chain (persistSeats) is in flight we must NOT
  // overwrite state.seats with the backend's pre-mutation view — it
  // would silently revert a seat the user just added locally. Defer
  // the refresh until the chain completes (persistSeats emits
  // order:updated on success, which re-triggers this path).
  if (state._seatsChain) {
    return state._seatsChain.then(function() { return refreshOrder(state, params); });
  }
  _refreshInFlight = true;

  // 15s abort guard — matches order-entry's send/recall fetches so a hung
  // backend doesn't leave the refresh indicator silently pending. The
  // existing catch already clears _refreshInFlight on rejection, so an
  // AbortError takes the same path as any other network failure.
  state._refreshPromise = fetchWithTimeout('/api/v1/orders/' + state.orderId, { cache: 'no-store' }, 15000)
    .then(function(r) { return r.ok ? r.json() : null; })
    .then(function(order) {
      _refreshInFlight = false;
      if (!order) return;
      state.order = order;
      state.checkNumber  = order.check_number || '';
      state.customerName = order.customer_name || '';

      if (state.checkNumber) setSceneName(state.checkNumber);

      state.seats = orderToSeats(order, order.guest_count || 1);

      // Recompute paid seats
      state.paidSeats = {};
      if (Array.isArray(order.payments)) {
        for (var p = 0; p < order.payments.length; p++) {
          if (order.payments[p].seat_id) {
            state.paidSeats[order.payments[p].seat_id] = true;
          }
        }
      }

      rerenderTopArea(state);

      // Deep-link: if caller passed autoSplit (e.g. from a landing page's
      // Split button), fire the edit-seats flow once the check data has
      // loaded. One-shot — clear the flag so subsequent refreshes don't
      // re-trigger the column-editor.
      if (params && params.autoSplit) {
        params.autoSplit = false;
        openEditSeats(state);
      }
    })
    .catch(function() {
      _refreshInFlight = false;
    })
    .finally(function() {
      // Clear the per-state cache so a later tap on the same check
      // (after payment, after refresh) re-fetches rather than handing
      // back the stale resolved promise.
      state._refreshPromise = null;
    });

  return state._refreshPromise;
}