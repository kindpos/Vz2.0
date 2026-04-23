// ═══════════════════════════════════════════════════
//  KINDpos Terminal — check-overview  (Vz2.0)
//  Working layer for full check management. Nostalgia seats-container
//  wraps two layout modes:
//
//    Mode A  1-4 active seats   full-width seat tiles + slim +SEAT rail
//    Mode B  5+ active seats    order recap + fixed-height scrolling
//                               compact-tile card on the right
//
//  Both tiles share an inverted selection visual: selected tiles fill
//  with a per-seat accent (first four [green, elec, gold, verm], then
//  T.srvPalette) and every text node flips to T.well via item-recap's
//  .ir-inverted cascade. Tapping a seat header auto-selects every
//  item on that seat via toggleSeat's selectedItems mirror.
//
//  Bottom bar (96 px, rebuilt on every rerender):
//    Left:  210 px TotalsBar — CHECK TOTAL in State 1, "S1 + S3 TOTAL"
//           (sum of selected seats) in State 2.
//    Right: State 1 → PRINT + VOID (long-press 550 ms) | divider |
//                      PAY + ADD ITEMS.
//           State 2 → PRINT SEATS + MANAGE (T.elec) | divider |
//                      PAY SEATS (w/ seat-name sub-label) + ADD ITEMS.
//           MANAGE  → MOVE / SPLIT / MERGE tool pills | divider |
//                      UNDO + RESET (long-press) + DONE.
//
//  DISC is behind the existing disc-pin interrupt — reachable via
//  long-press item / bulk / seat menus only; no DISC on the primary
//  bar. TRANSFER keeps its long-press seat-menu entry; it's not on
//  the MANAGE toolbar (selection-aware transfer deferred).
//
//  SceneManager.mountWorking('check-overview', {
//    checkId, returnLanding, employeeId, employeeName, pin
//  })
// ═══════════════════════════════════════════════════

import { SceneManager, defineScene } from '../scene-manager.js';
import { T } from '../tokens.js';
import {
  buildWell,
  buildCard,
  buildStaticCard,
  buildActionCard,
  buildPillButton,
  hexToRgba,
  darkenHex,
} from '../theme-manager.js';
import { OrderSummary } from '../order-summary.js';
import { buildNumpad } from '../numpad.js';
import { showToast } from '../components.js';
import { showKeyboard, hideKeyboard } from '../keyboard.js';
import { getTaxRate, getCashDiscount } from '../pricing.js';
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

// seatTotal now wraps the pure helper from ./seats.js so the
// rendering paths and transition paths share one math implementation.
function seatTotal(seat) {
  return seatSubtotal(seat);
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

  // When any item is selected, the recap narrows to just the seats
  // that contain at least one of those items. Empty selection falls
  // back to the whole (unpaid) check. state.selectedItems is the
  // source of truth; state.selected is a derived "fully-selected"
  // mirror maintained by toggleSeat / toggleItem.
  var selItems = state.selectedItems || {};
  var selKeys  = Object.keys(selItems);
  var anyItemSelected = selKeys.length > 0;
  var seatIdxsWithSelected = {};
  for (var sk = 0; sk < selKeys.length; sk++) {
    var sIdx = parseInt(selKeys[sk].split(':')[0], 10);
    if (!isNaN(sIdx)) seatIdxsWithSelected[sIdx] = true;
  }

  var adaptedSeats = [];
  var totalUpcharges = 0;
  for (var s = 0; s < state.seats.length; s++) {
    if (state.paidSeats && state.paidSeats[state.seats[s].id]) continue;
    if (anyItemSelected && !seatIdxsWithSelected[s])           continue;
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

  var order = state.order || {};
  var discount = getCashDiscount();
  var totals = {
    subtotal:  order.subtotal || 0,
    tax:       order.tax || 0,
    cardTotal: order.total || 0,
    cashPrice: Math.round((order.total || 0) * (1 - discount) * 100) / 100,
    taxRate:   getTaxRate(),
  };

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
      taxRate:   totals.taxRate,
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
  var discount = getCashDiscount();
  var taxRate  = getTaxRate();
  var tax      = subtotal * taxRate;
  var cardTotal = subtotal + tax;
  return {
    items:     items,
    subtotal:  Math.round(subtotal * 100) / 100,
    tax:       Math.round(tax * 100) / 100,
    cardTotal: Math.round(cardTotal * 100) / 100,
    cashPrice: Math.round((cardTotal * (1 - discount)) * 100) / 100,
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
    get _commitManageSplit() { return _commitManageSplit; },
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
    bottomBarEl:   null,
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

    var _landing = params.returnLanding || null;
    if (!_landing) {
      entReport({
        code:    'UI-020',
        source:  'check-overview._landing',
        message: 'returnLanding missing — defaulting to server-landing',
        ctx: {
          checkId:     params.checkId  || null,
          employeeId:  params.employeeId || null,
          paramKeys:   Object.keys(params),
        },
        level: 'WARNING',
      });
      _landing = 'server-landing';
    }
    var _landingParams = { emp: { id: params.employeeId, name: params.employeeName, pin: params.pin } };

    // ── Root + body layout ──
    var root = document.createElement('div');
    Object.assign(root.style, {
      position:      'absolute',
      inset:         '0',
      boxSizing:     'border-box',
      display:       'flex',
      flexDirection: 'column',
      height:        '100%',
    });
    container.appendChild(root);
    state.rootEl = root;

    var body = document.createElement('div');
    Object.assign(body.style, {
      flex:          '1',
      minHeight:     '0',
      padding:       '4px 12px 10px',
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
      minHeight:  '140px',
      flexShrink: '0',
      display:    'flex',
      pointerEvents: 'auto',
    });
    body.appendChild(bottomRow);
    state.bottomBarEl = bottomRow;

    // ── Initial paint ──
    state._params = params;
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
          'padding:8px 22px 22px;min-width:300px;max-width:420px;',
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
          'padding:8px 18px 18px;',
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


// ═══════════════════════════════════════════════════
//  ACTION BAR (bottom-right pills)
//  State 1 (no seats selected): PRINT + VOID secondaries on the left,
//  dashed divider, PAY (gold) + ADD ITEMS (green) primaries on the
//  right. VOID requires a ~550 ms long-press to fire; short taps are
//  ignored so the cashier can't void the check on an accidental tap.
//  State 2 (seats selected) and MANAGE mode toolbars come in later
//  steps and dispatch from this same slot.
// ═══════════════════════════════════════════════════

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

function renderActionBar(state) {
  var barZone = state.bottomBarEl;
  if (!barZone) return;
  barZone.innerHTML = '';

  if (state._manageMode) {
    renderManageToolbar(state);
    return;
  }

  // Container — Nostalgia card chassis so the action bar matches the
  // raised-bevel + accent treatment used by manager-landing / COB /
  // sales cards. buildStaticCard sets background, 4-edge bevel,
  // inset+drop shadow, and a glowing left accent bar.
  var bar = buildStaticCard({ accent: T.green });
  Object.assign(bar.style, {
    display:     'flex',
    alignItems:  'stretch',
    gap:         '10px',
    padding:     '12px',
    flex:        '1',
    boxSizing:   'border-box',
  });
  barZone.appendChild(bar);

  var order = state.order || {};
  var discount = getCashDiscount();

  // Selection-aware totals: when any items are selected, the bar shows
  // the sum of those items only; otherwise the whole-check totals from
  // state.order. Items are the source of truth — seat-level selection
  // is just a bulk shortcut that writes to state.selectedItems.
  var itemKeys   = Object.keys(state.selectedItems || {});
  var anyItemSel = itemKeys.length > 0;

  var subtotal, tax, total, cashTotal;
  if (anyItemSel) {
    subtotal = 0;
    for (var ki = 0; ki < itemKeys.length; ki++) {
      var parts = itemKeys[ki].split(':');
      var sIdx  = parseInt(parts[0], 10);
      var iIdx  = parseInt(parts[1], 10);
      var selSeat = state.seats[sIdx];
      var selItem = selSeat && selSeat.items[iIdx];
      if (!selItem) continue;
      var selPrice = selItem.effectivePrice != null ? selItem.effectivePrice : (selItem.price || 0);
      subtotal += (selItem.qty || 0) * selPrice;
    }
    tax       = subtotal * getTaxRate();
    total     = subtotal + tax;
    cashTotal = Math.round(total * (1 - discount) * 100) / 100;
  } else {
    subtotal  = order.subtotal || 0;
    tax       = order.tax != null ? order.tax : (subtotal * getTaxRate());
    total     = order.total || 0;
    cashTotal = Math.round(total * (1 - discount) * 100) / 100;
  }

  // Totals block — two stacked Nostalgia cards matching the order-entry
  // totals treatment: buildStaticCard (bevel + green accent bar) wrapping
  // compact rows (uppercase label left, colored money value right).
  var totalsBlock = document.createElement('div');
  Object.assign(totalsBlock.style, {
    width:         '200px',
    display:       'flex',
    flexDirection: 'column',
    gap:           '8px',
    flexShrink:    '0',
  });
  bar.appendChild(totalsBlock);

  function buildTotalsCard() {
    var card = buildStaticCard({ accent: T.green });
    Object.assign(card.style, {
      padding: '4px 10px 4px 14px',
      flex:    '1',
      display: 'flex',
      flexDirection:  'column',
      justifyContent: 'center',
    });
    return card;
  }

  // Compact variant of buildDataRow for the bottom bar — label T.fsB4,
  // value T.fsB3, tight row padding. Keeps the buildStaticCard +
  // label-left / money-right look from the order-entry totals cards
  // without blowing out the bar height.
  function buildCompactRow(label, valText, valColor) {
    var row = document.createElement('div');
    Object.assign(row.style, {
      display:        'flex',
      justifyContent: 'space-between',
      alignItems:     'baseline',
      padding:        '2px 0',
    });
    var lbl = document.createElement('span');
    Object.assign(lbl.style, {
      fontFamily:    T.fb,
      fontSize:      T.fsB4,
      color:         T.text,
      letterSpacing: '0.08em',
      textTransform: 'uppercase',
    });
    lbl.textContent = label;
    row.appendChild(lbl);
    var val = document.createElement('span');
    Object.assign(val.style, {
      fontFamily: T.fb,
      fontSize:   T.fsB3,
      fontWeight: T.fwBold,
      color:      valColor || T.text,
    });
    val.textContent = valText;
    row.appendChild(val);
    return row;
  }

  var summaryCard = buildTotalsCard();
  summaryCard.appendChild(buildCompactRow('SUBTOTAL', fmt(subtotal), T.gold));
  summaryCard.appendChild(buildCompactRow('TAX',      fmt(tax),      T.gold));
  totalsBlock.appendChild(summaryCard);

  var pricesCard = buildTotalsCard();
  pricesCard.appendChild(buildCompactRow('CARD PRICE', fmt(total),     T.elec));
  pricesCard.appendChild(buildCompactRow('CASH PRICE', fmt(cashTotal), T.greenWarm));
  totalsBlock.appendChild(pricesCard);

  // Left stack — flex-direction: column, gap: 8px, width: 180px.
  var leftStack = document.createElement('div');
  Object.assign(leftStack.style, {
    width: '180px',
    display: 'flex',
    flexDirection: 'column',
    gap: '8px',
    flexShrink: '0',
  });
  bar.appendChild(leftStack);

  // DISC
  var discBtn = buildPillButton({
    label: 'DISC',
    color: T.lavender,
    darkBg: darkenHex(T.lavender, 0.4),
    onClick: function() { handleDiscount(state); }
  });
  discBtn.style.flex = '1';
  discBtn.style.borderRadius = '12px 12px 6px 6px';
  leftStack.appendChild(discBtn);

  // VOID
  var voidBtn = buildPillButton({
    label: 'VOID',
    color: T.verm,
    darkBg: T.vermDk,
    onClick: function() { handleVoid(state); }
  });
  voidBtn.style.flex = '1';
  voidBtn.style.borderRadius = '6px 6px 12px 12px';
  leftStack.appendChild(voidBtn);

  // PAY
  var payBtn = buildPillButton({
    label: 'PAY',
    color: T.gold,
    darkBg: T.goldDk,
    width: '220px',
    onClick: function() { handlePay(state, state._params || {}); }
  });
  Object.assign(payBtn.style, {
    alignSelf: 'stretch',
    borderRadius: '14px',
    fontSize: '20px',
    flexShrink: '0',
  });
  bar.appendChild(payBtn);

  // ADD ITEMS
  var addBtn = buildPillButton({
    label: 'ADD ITEMS',
    color: T.greenWarm,
    darkBg: T.greenWarmDk,
    width: '220px',
    onClick: function() { handleAddItems(state, state._params || {}); }
  });
  Object.assign(addBtn.style, {
    alignSelf: 'stretch',
    borderRadius: '14px',
    fontSize: '20px',
    flexShrink: '0',
  });
  bar.appendChild(addBtn);

  // Right stack
  var rightStack = document.createElement('div');
  Object.assign(rightStack.style, {
    width: '180px',
    display: 'flex',
    flexDirection: 'column',
    gap: '8px',
    flexShrink: '0',
  });
  bar.appendChild(rightStack);

  // EDIT SEATS
  var editBtn = buildPillButton({
    label: 'EDIT SEATS',
    color: T.moon,
    darkBg: T.moonDk,
    onClick: function() { openEditSeats(state); }
  });
  editBtn.style.flex = '1';
  editBtn.style.borderRadius = '12px 12px 6px 6px';
  rightStack.appendChild(editBtn);

  // PRINT
  var printBtn = buildPillButton({
    label: 'PRINT',
    color: T.elec,
    darkBg: T.elecDk,
    onClick: function() { handlePrint(state); }
  });
  printBtn.style.flex = '1';
  printBtn.style.borderRadius = '6px 6px 12px 12px';
  rightStack.appendChild(printBtn);

  // Trailing spacer — pushes everything (totals + DISC/VOID + PAY +
  // ADD ITEMS + EDIT SEATS/PRINT) flush against the left edge so the
  // action group reads as one left-aligned cluster.
  var spacer = document.createElement('div');
  spacer.style.flex = '1';
  bar.appendChild(spacer);
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

// ── UNDO replay ──
// Each MANAGE op pushes a reverse-patch onto state._manageLog. UNDO
// pops the last patch and replays the inverse. Shapes currently handled:
//   { kind: 'move', targetSeatId, patches: [{fromSeatId, fromItemIdx,
//     item}, ...] }  — pull each item off target, re-insert on source.
//   { kind: 'merge-new-seat', newSeatId }  — consumes the preceding
//     'move' patch too, then removes the (now-empty) new seat.
//   { kind: 'split', preSeats }  — restore the whole seats array.
//   { kind: 'merge-new-check-* }  — backend already spawned a child
//     check so we can't locally revert. Push the patch back and
//     nudge the cashier to RESET instead.

function _undoMoveInverse(state, patch) {
  var targetIdx = _seatIdxById(state, patch.targetSeatId);
  var targetItems = targetIdx >= 0 ? state.seats[targetIdx].items : null;
  for (var p = patch.patches.length - 1; p >= 0; p--) {
    var pp = patch.patches[p];
    // Pull the moved item off the target by identity — it's the same
    // JS object reference that was pushed onto target.items.
    if (targetItems) {
      var at = targetItems.indexOf(pp.item);
      if (at >= 0) targetItems.splice(at, 1);
    }
    var fromIdx = _seatIdxById(state, pp.fromSeatId);
    if (fromIdx >= 0) {
      var insertAt = Math.min(pp.fromItemIdx, state.seats[fromIdx].items.length);
      state.seats[fromIdx].items.splice(insertAt, 0, pp.item);
    }
  }
}

function _removeSeatByIdIfEmpty(state, seatId) {
  var idx = _seatIdxById(state, seatId);
  if (idx < 0) return;
  if (state.seats[idx].items.length > 0) return;  // safety
  state.seats.splice(idx, 1);
}

function _undoManage(state) {
  if (!state._manageLog || state._manageLog.length === 0) {
    showToast('Nothing to undo', { bg: T.gold });
    return;
  }
  var patch = state._manageLog.pop();
  var undone = true;

  if (patch.kind === 'move') {
    _undoMoveInverse(state, patch);
  } else if (patch.kind === 'merge-new-seat') {
    // The preceding entry is the 'move' that relocated items onto
    // the new seat — pop + invert it, then remove the now-empty seat.
    var mv = state._manageLog.pop();
    if (mv && mv.kind === 'move') _undoMoveInverse(state, mv);
    _removeSeatByIdIfEmpty(state, patch.newSeatId);
  } else if (patch.kind === 'split') {
    state.seats = _cloneSeats(patch.preSeats);
  } else if (patch.kind === 'merge-new-check-seats'
             || patch.kind === 'merge-new-check-items') {
    // The child check exists on the backend — no local undo.
    state._manageLog.push(patch);
    showToast('Check split can’t be undone — hold RESET to revert the session',
              { bg: T.verm, duration: 2500 });
    return;
  } else {
    undone = false;
  }

  state.selected      = {};
  state.selectedItems = {};
  rerenderTopArea(state);
  if (undone) showToast('Undone', { bg: T.greenWarm });
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

// buildPillButton has no `height` option, so apply the 46 px chrome
// directly on the returned element after construction. Keeps the
// MANAGE toolbar pills the same uniform height that the old callsites
// were silently asking for.
function _makeToolPill(label, active) {
  var color  = active ? T.elec : T.card;
  var darkBg = active ? T.elecDk : darkenHex(T.card, 0.2);
  var btn = buildPillButton({
    label:     label,
    color:     color,
    darkBg:    darkBg,
    textColor: active ? T.well : T.elec,
    padding:   '0 20px',
    fontSize:  T.fsB3,
  });
  btn.style.height = '46px';
  return btn;
}

function _makeUtilPill(label, textColor, opts) {
  opts = opts || {};
  var color = opts.bg || T.card;
  var darkBg = opts.darkBg || darkenHex(color, 0.2);
  var btn = buildPillButton({
    label:     label,
    color:     color,
    darkBg:    darkBg,
    textColor: textColor,
    padding:   '0 20px',
    fontSize:  T.fsB3,
  });
  btn.style.height = '46px';
  return btn;
}

// Vertical dashed separator used inside the MANAGE toolbar between the
// tool pills (MOVE / SPLIT / MERGE) and the utility pills (UNDO /
// RESET / DONE). Zero-width element whose left border paints the
// dashed line, stretched to the toolbar's full height.
function _dashedDivider() {
  var el = document.createElement('div');
  Object.assign(el.style, {
    width:       '0',
    alignSelf:   'stretch',
    borderLeft:  '2px dashed ' + T.border,
    margin:      '4px 8px',
    flexShrink:  '0',
  });
  return el;
}

// ── MANAGE SPLIT ──
// The split flow is a pick-then-pick-then-commit pattern:
//   1. Cashier pre-selects items with item taps (state.selectedItems).
//   2. Taps the SPLIT pill → the tool becomes active and state.selected
//      is seeded with the source seats as recipients-by-default.
//   3. Taps seat tiles to toggle recipient inclusion (tile inverts as
//      usual; state.selected is the recipient set while split is live).
//   4. Taps SPLIT again → commits. Each selected item is removed from
//      its source and a copy is appended to every recipient with
//      price / N, so the cost divides evenly across the tapped seats.
// A snapshot of the pre-split seats is pushed onto state._manageLog so
// Step 12's UNDO can restore the whole layout in one shot.

// ── MANAGE MERGE ──
// Selection + tile tap → move every selected item onto the tapped
// seat. The add-tile doubles as +SEAT: tapping it while MERGE is
// live creates a fresh seat on the check via addSeat() and then
// moves the selection onto that new seat. Existing-seat merges log
// a { kind: 'move' } patch for UNDO; new-seat merges additionally
// carry a { kind: 'merge-new-seat', newSeatId } marker so Step 12
// can replay the full inverse.

function _enterManageMerge(state) {
  if (Object.keys(state.selectedItems || {}).length === 0) {
    showToast('Select items to merge first', { bg: T.gold });
    return;
  }
  state._manageTool = 'merge';
  rerenderTopArea(state);
  showToast('Tap a seat tile or the + tile to merge into it',
            { bg: T.elec, duration: 2500 });
}

// Fire-and-observe wrapper around POST /orders/{id}/split-by-seat.
// Parent + child order IDs come back in data.child_orders; we refresh
// the current order (whose items drop from the parent) and toast the
// new check numbers. The endpoint lives at
// backend/app/api/routes/orders.py:1921.
function _callSplitBySeat(state, seatNumbers) {
  if (!state.orderId) {
    showToast('Save items first', { bg: T.gold });
    return;
  }
  if (!seatNumbers || seatNumbers.length === 0) {
    showToast('Nothing to split off', { bg: T.gold });
    return;
  }
  showToast('Splitting into new check…', { bg: T.elec });
  fetchWithTimeout(
    '/api/v1/orders/' + state.orderId + '/split-by-seat',
    {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ seats: seatNumbers }),
    },
    15000
  )
    .then(function(r) { return r.json().then(function(j) { return { ok: r.ok, body: j }; }); })
    .then(function(res) {
      if (!res.ok || !res.body || res.body.success === false) {
        var msg = (res.body && res.body.detail) || 'Split failed';
        showToast(msg, { bg: T.verm });
        return;
      }
      var kids = (res.body.child_orders || []).map(function(c) { return c.order_id; });
      showToast('New check: ' + kids.join(', '), { bg: T.greenWarm });
      refreshOrder(state, state._mountParams || {});
    })
    .catch(function() { showToast('Split failed', { bg: T.verm }); });
}

// +CHECK target: split the current selection off into a new sibling
// check. Two paths:
//   - Whole seats selected (state.selected populated): call
//     split-by-seat directly with those seat numbers.
//   - Arbitrary items (selectedItems only): create a fresh seat via
//     addSeat, move the selection onto it, then call split-by-seat
//     on just that new seat. preSeats is snapshotted for UNDO.
function _mergeToNewCheck(state) {
  var seatIds = Object.keys(state.selected || {}).filter(function(id) {
    return !state.paidSeats[id];
  });
  var itemCount = Object.keys(state.selectedItems || {}).length;

  if (seatIds.length === 0 && itemCount === 0) {
    showToast('Select items or seats to split off', { bg: T.gold });
    return;
  }
  if (!state.orderId) {
    showToast('Save items first', { bg: T.gold });
    return;
  }

  // Seat-aligned fast path. toggleSeat mirrors seat selection onto
  // item selection, so a "whole seat" selection shows up here as
  // state.selected populated with matching items already included.
  if (seatIds.length > 0) {
    var nums = [];
    for (var i = 0; i < seatIds.length; i++) {
      var idx = _seatIdxById(state, seatIds[i]);
      if (idx >= 0) nums.push(state.seats[idx].number);
    }
    state._manageLog.push({ kind: 'merge-new-check-seats', seatNumbers: nums });
    _callSplitBySeat(state, nums);
    return;
  }

  // Arbitrary items — two-step: make a temp seat, move items there,
  // split off just that seat. The preSeats snapshot captures the
  // layout before addSeat so UNDO can reverse both the move and the
  // new-seat creation on the client side (the new child check still
  // exists on the backend and would need a separate undo).
  var preSeats = _cloneSeats(state.seats);
  var refs = getSelectedItemRefs(state);
  addSeat(state);
  var newSeat = state.seats[state.seats.length - 1];
  if (!newSeat) return;
  _moveItemsToSeat(state, refs, newSeat.id, { skipLog: true });
  state._manageLog.push({
    kind:     'merge-new-check-items',
    preSeats: preSeats,
    newSeatNumber: newSeat.number,
  });
  _callSplitBySeat(state, [newSeat.number]);
}

function _mergeToNewSeat(state) {
  var refs = getSelectedItemRefs(state);
  if (refs.length === 0) {
    showToast('Nothing selected to merge', { bg: T.gold });
    return;
  }
  addSeat(state);
  var newSeat = state.seats[state.seats.length - 1];
  if (!newSeat) return;
  // Refs computed above reference the pre-addSeat indices — addSeat
  // only pushes a new empty seat at the end, so existing (seatIdx,
  // itemIdx) tuples remain valid.
  var moved = _moveItemsToSeat(state, refs, newSeat.id);
  if (moved > 0) {
    state._manageLog.push({
      kind:      'merge-new-seat',
      newSeatId: newSeat.id,
    });
  }
}

function _enterManageSplit(state) {
  if (Object.keys(state.selectedItems || {}).length === 0) {
    showToast('Select items to split first', { bg: T.gold });
    return;
  }
  state._manageTool = 'split';
  // Seed recipients with the source seats of the selected items so the
  // original seat is included by default per spec. Cashier can tap it
  // off if they want the item to move off entirely.
  state.selected = {};
  var refs = getSelectedItemRefs(state);
  for (var r = 0; r < refs.length; r++) {
    var seat = state.seats[refs[r].seatIdx];
    if (seat) state.selected[seat.id] = true;
  }
  rerenderTopArea(state);
  showToast('Tap seat tiles to pick recipients, then tap SPLIT again',
            { bg: T.elec, duration: 2500 });
}

async function _commitManageSplit(state) {
  var recipients = [];
  for (var sid in state.selected) {
    if (!state.paidSeats[sid]) recipients.push(sid);
  }
  if (recipients.length === 0) {
    showToast('Tap seat tiles to add recipients', { bg: T.gold });
    return;
  }
  var itemRefs = getSelectedItemRefs(state);
  if (itemRefs.length === 0) {
    showToast('Nothing selected to split', { bg: T.gold });
    return;
  }

  var preSeats = _cloneSeats(state.seats);

  // Descending sort so splices don't shift later refs.
  itemRefs.sort(function(a, b) {
    if (a.seatIdx !== b.seatIdx) return b.seatIdx - a.seatIdx;
    return b.itemIdx - a.itemIdx;
  });

  var itemsToVoid = [];
  var newItemsToCreate = [];

  for (var r = 0; r < itemRefs.length; r++) {
    var ref = itemRefs[r];
    var src = state.seats[ref.seatIdx].items.splice(ref.itemIdx, 1)[0];
    if (src.item_id) itemsToVoid.push(src.item_id);

    var orig = (src.effectivePrice != null ? src.effectivePrice : src.price) || 0;
    var totalCents = Math.round(orig * 100);
    var floorCents = Math.floor(totalCents / recipients.length);
    var remainderCents = totalCents % recipients.length;

    for (var k = 0; k < recipients.length; k++) {
      var tIdx = _seatIdxById(state, recipients[k]);
      if (tIdx < 0) continue;

      var shareCents = floorCents + (k === 0 ? remainderCents : 0);
      var piece = shareCents / 100;

      var copy = Object.assign({}, src);
      // seatSubtotal prefers effectivePrice when present; set both so
      // later pricing passes stay consistent.
      copy.price          = piece;
      copy.effectivePrice = piece;
      // Drop the original item_id so the backend sees a fresh line
      // rather than colliding with the removed parent on next save.
      copy.item_id        = null;
      // Mark the item as a split share so the recap rows make the
      // fractional cost obvious next to the item name.
      copy.name = (copy.name || '') + ' (1/' + recipients.length + ')';
      state.seats[tIdx].items.push(copy);

      newItemsToCreate.push({
        seat_number:  state.seats[tIdx].number || (tIdx + 1),
        menu_item_id: src.menu_item_id || src.name.toLowerCase().replace(/\s+/g, '_'),
        name:         copy.name,
        price:        piece,
        category:     src.category || 'general'
      });
    }
  }

  try {
    if (state.orderId) {
      for (var i = 0; i < newItemsToCreate.length; i++) {
        var postRes = await fetchWithTimeout('/api/v1/orders/' + state.orderId + '/items', {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify(newItemsToCreate[i]),
        }, 10000);
        if (!postRes.ok) throw new Error('POST failed');
      }

      for (var j = 0; j < itemsToVoid.length; j++) {
        var delRes = await fetchWithTimeout('/api/v1/orders/' + state.orderId + '/items/' + itemsToVoid[j], {
          method: 'DELETE',
        }, 10000);
        if (!delRes.ok) throw new Error('DELETE failed');
      }
    }

    state._manageLog.push({ kind: 'split', preSeats: preSeats });
    state.selected      = {};
    state.selectedItems = {};
    state._manageTool   = 'move';
    rerenderTopArea(state);
    showToast('Split across ' + recipients.length + ' seat(s)', { bg: T.greenWarm });
  } catch (err) {
    console.warn('[KINDpos] Split persistence failed:', err);
    state.seats = preSeats;
    showToast('Split failed: backend sync error', { bg: T.verm });
    rerenderTopArea(state);
  }
}

function renderManageToolbar(state) {
  var zone = state.bottomBarEl;
  if (!zone) return;
  zone.innerHTML = '';

  // ── Left: tool pills ──
  // MOVE and MERGE are "modes" — the pill selects the tool, then a
  // seat-tile tap commits the op. SPLIT is a "trigger" — the pill
  // opens column-editor directly because SPLIT has its own flow
  // inside that transactional scene and there's no seat-tile tap
  // to forward.
  for (var i = 0; i < MANAGE_TOOLS.length; i++) {
    var tool = MANAGE_TOOLS[i];
    var active = state._manageTool === tool.id;
    var pill = _makeToolPill(tool.label, active);
    (function(toolId) {
      pill.addEventListener('click', function() {
        if (toolId === 'split') {
          // Tap while split is already live = commit; otherwise enter.
          if (state._manageTool === 'split') _commitManageSplit(state);
          else                               _enterManageSplit(state);
          return;
        }
        if (toolId === 'merge') {
          _enterManageMerge(state);
          return;
        }
        state._manageTool = toolId;
        rerenderTopArea(state);
      });
    })(tool.id);
    zone.appendChild(pill);
  }

  zone.appendChild(_dashedDivider());

  // ── Right: utility pills — UNDO, RESET, DONE ──
  var undoBtn = _makeUtilPill('UNDO', T.text);
  undoBtn.addEventListener('click', function() { _undoManage(state); });
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
    overflow:     'visible',
  });

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

  // Layout mode:
  //   A  1-4 active seats  — each seat gets its own flex-row column with
  //                          a slim +SEAT rail on the right.
  //   B  5+ active seats   — item recap on the left, compact seat tile
  //                          grid on the right. Matches the original
  //                          Nostalgia spec and the manager-landing
  //                          check-grid visual.
  var activeCount = activeSeatCount(state.seats, state.paidSeats);
  var mode = activeCount <= 4 ? 'A' : 'B';

  var body = document.createElement('div');
  Object.assign(body.style, {
    display:       'flex',
    flexDirection: 'row',
    gap:           '10px',
    padding:       '12px',
    flex:          '1',
    minHeight:     '0',
    overflow:      'hidden',
    boxSizing:     'border-box',
  });
  root.appendChild(body);

  return { root: root, body: body, mode: mode };
}

// ═══════════════════════════════════════════════════
//  TOP-AREA DISPATCHER
// ═══════════════════════════════════════════════════

function rerenderTopArea(state) {
  if (state._osActive) {
    OrderSummary.hide();
    state._osActive = false;
  }

  var top = state.topAreaEl;
  top.innerHTML = '';
  state.seatEls = {};

  for (var t = 0; t < state._lpTimers.length; t++) clearTimeout(state._lpTimers[t]);
  state._lpTimers = [];

  var shell = buildSeatsContainer(state);
  top.appendChild(shell.root);

  renderSeatsGrid(state, shell.body, shell.mode);
  renderActionBar(state);
}

function renderSeatsGrid(state, container, mode) {
  if (mode === 'B') {
    // ── Mode B: item recap on the left, compact seat tile grid on the right ──
    var recapCol = document.createElement('div');
    Object.assign(recapCol.style, {
      flex:      '1',
      minWidth:  '0',
      overflowY: 'auto',
    });
    // _adaptOrderForRecap may filter seats (by selection), so the
    // indices buildItemRecap passes to its callbacks are FILTERED
    // indices — translate back to the real state.seats index via
    // seatNumber so selectedItems / toggleItem operate on the truth.
    var adaptedOrder = _adaptOrderForRecap(state);
    var filteredToState = [];
    for (var ai = 0; ai < adaptedOrder.seats.length; ai++) {
      var adaptedNum = adaptedOrder.seats[ai].seatNumber;
      for (var si2 = 0; si2 < state.seats.length; si2++) {
        if (state.seats[si2].number === adaptedNum) {
          filteredToState[ai] = si2;
          break;
        }
      }
    }

    recapCol.appendChild(buildItemRecap(adaptedOrder, {
      hideHeader:  true,
      hideTotals:  true,
      collapsible: true,
      itemSelected: function(fIdx, itemIdx) {
        var realIdx = filteredToState[fIdx];
        return realIdx != null
          && !!(state.selectedItems && state.selectedItems[realIdx + ':' + itemIdx]);
      },
      onItemTap: function(fIdx, itemIdx) {
        var realIdx = filteredToState[fIdx];
        if (realIdx != null) toggleItem(state, realIdx, itemIdx);
      },
    }));
    container.appendChild(recapCol);

    var tilesCol = document.createElement('div');
    Object.assign(tilesCol.style, {
      flex:                '1',
      minWidth:             '0',
      display:              'grid',
      gridTemplateColumns:  'repeat(3, 1fr)',
      gridAutoRows:         'min-content',
      alignContent:         'start',
      gap:                  '10px',
      overflowY:            'auto',
    });
    for (var i = 0; i < state.seats.length; i++) {
      if (state.paidSeats[state.seats[i].id]) continue;
      var tile = buildCompactTile(state, i);
      // Grid controls width — undo buildStaticCard's flex default so the
      // tile doesn't try to stretch across tracks.
      tile.style.flex  = '';
      tile.style.width = '';
      tilesCol.appendChild(tile);
    }
    var addB = buildAddTile(state, { fullSize: true });
    addB.style.flex  = '';
    addB.style.width = '';
    tilesCol.appendChild(addB);
    if (state._manageMode && state._manageTool === 'merge') {
      var chkB = buildCheckTile(state, { fullSize: true });
      chkB.style.flex  = '';
      chkB.style.width = '';
      tilesCol.appendChild(chkB);
    }
    container.appendChild(tilesCol);
    return;
  }

  // ── Mode A: each seat is an equal flex-row column ──
  // +SEAT tile matches seat width while there's capacity (1-3 seats);
  // at 4 seats we're at Mode A's cap so the +SEAT shrinks to a slim
  // rail to keep all four seat columns full-width.
  var activeCount = activeSeatCount(state.seats, state.paidSeats);
  for (var i = 0; i < state.seats.length; i++) {
    if (state.paidSeats[state.seats[i].id]) continue;
    var panel = buildSeatCard(state, i);
    panel.style.flex  = '1';
    panel.style.width = '0';
    container.appendChild(panel);
  }

  var addTile = buildAddTile(state, { fullSize: true });
  if (activeCount >= 4) {
    addTile.style.flex       = '0 0 auto';
    addTile.style.width      = '80px';
    addTile.style.flexShrink = '0';
  } else {
    addTile.style.flex  = '1';
    addTile.style.width = '0';
  }
  container.appendChild(addTile);

  if (state._manageMode && state._manageTool === 'merge') {
    var checkTile = buildCheckTile(state, { fullSize: true });
    if (activeCount >= 4) {
      checkTile.style.flex       = '0 0 auto';
      checkTile.style.width      = '80px';
      checkTile.style.flexShrink = '0';
    } else {
      checkTile.style.flex  = '1';
      checkTile.style.width = '0';
    }
    container.appendChild(checkTile);
  }
}

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

function buildSeatCard(state, seatIdx) {
  var seat = state.seats[seatIdx];
  var wrap = buildStaticCard({ accent: T.green });
  wrap.style.flex          = '1';
  wrap.style.padding       = '0';
  wrap.style.display       = 'flex';
  wrap.style.flexDirection = 'column';
  wrap.style.overflow      = 'hidden';
  var card = wrap;

  wrap.addEventListener('pointerup', function(e) {
    if (e.defaultPrevented) return;
    toggleSeat(state, seatIdx);
  });

  // ── Header Row ──
  var hdr = document.createElement('div');
  Object.assign(hdr.style, {
    background:   T.well,
    padding:      '8px 12px',
    borderBottom: '1px solid ' + T.border,
    display:      'flex',
    alignItems:   'center',
    justifyContent: 'space-between',
  });

  var label = document.createElement('div');
  Object.assign(label.style, {
    color:      T.green,
    fontFamily: T.fh,
    fontWeight: 'bold',
  });
  label.textContent = 'S' + (seat.number != null ? seat.number : (seatIdx + 1));
  hdr.appendChild(label);

  var subtotal = document.createElement('div');
  Object.assign(subtotal.style, {
    color:      T.gold,
    fontFamily: T.fb,
  });
  subtotal.textContent = fmt(seatTotal(seat));
  hdr.appendChild(subtotal);

  card.appendChild(hdr);

  // ── Body ──
  var body = document.createElement('div');
  Object.assign(body.style, {
    background:    T.card,
    flex:          '1',
    minHeight:     '0',
    padding:       '12px',
    display:       'flex',
    flexDirection: 'column',
    overflowY:     'auto',
  });

  if (seat.items.length === 0) {
    var empty = document.createElement('div');
    Object.assign(empty.style, {
      flex:       '1',
      display:    'flex',
      alignItems: 'center',
      justifyContent: 'center',
      color:      T.border,
      fontStyle:  'italic',
      fontFamily: T.fb,
    });
    empty.textContent = 'empty seat';
    body.appendChild(empty);
  } else {
    for (var i = 0; i < seat.items.length; i++) {
      var it = seat.items[i];
      var row = document.createElement('div');
      row.style.marginBottom = '8px';

      var mainLine = document.createElement('div');
      Object.assign(mainLine.style, {
        display:        'flex',
        justifyContent: 'space-between',
        fontFamily:     T.fb,
      });

      var name = document.createElement('span');
      name.style.color = T.text;
      name.textContent = it.name;
      mainLine.appendChild(name);

      var price = document.createElement('span');
      price.style.color = T.gold;
      price.textContent = fmt(it.qty * (it.effectivePrice || it.price));
      mainLine.appendChild(price);

      row.appendChild(mainLine);

      if (it.mods && it.mods.length > 0) {
        for (var m = 0; m < it.mods.length; m++) {
          var mod = document.createElement('div');
          Object.assign(mod.style, {
            color:      T.border,
            fontSize:   '12px',
            paddingLeft:'12px',
            fontFamily: T.fb,
          });
          mod.textContent = '↳ ' + it.mods[m].name;
          row.appendChild(mod);
        }
      }
      body.appendChild(row);
    }
  }

  card.appendChild(body);

  var canDelete = seat.items.length === 0
    && activeSeatCount(state.seats, state.paidSeats) > 1;
  if (canDelete) {
    var delX = _buildDeleteSeatX(state, seat.id);
    card.appendChild(delX);
  }

  state.seatEls[seat.id] = wrap;
  return wrap;
}

// Mode B compact tile — header shows S# only (no subtotal column that
// would overflow at 33 % width), body shows the seat total big and
// centered so the tile doubles as a balance glance. Item detail lives
// in the recap column to the left.
function buildCompactTile(state, seatIdx) {
  var seat = state.seats[seatIdx];
  var isSelected = !!(state.selected && state.selected[seat.id]);
  var accent     = seatAccent(seatIdx);

  // buildActionCard (same builder the manager-landing check grid uses)
  // gives us cursor:pointer, pointer-events:auto, touch-action:manipulation,
  // and the press-depress animation — everything a tappable tile needs.
  // buildStaticCard is display-only, which is why taps on the tile body
  // showed no cursor feedback and didn't register.
  var wrap = buildActionCard({ accent: accent });
  wrap.style.padding       = '0';
  wrap.style.display       = 'flex';
  wrap.style.flexDirection = 'column';
  wrap.style.overflow      = 'hidden';
  wrap.style.minHeight     = '90px';

  // Inverted selection visual — wrap fills with the per-seat accent,
  // all text flips to T.well. Matches the file-header spec ('selected
  // tiles fill with a per-seat accent ... every text node flips to
  // T.well').
  if (isSelected) {
    wrap.style.background = accent;
  }

  wrap.addEventListener('pointerup', function(e) {
    if (e.defaultPrevented) return;
    toggleSeat(state, seat.id);
  });

  var hdr = document.createElement('div');
  Object.assign(hdr.style, {
    background:   isSelected ? darkenHex(accent, 0.15) : T.well,
    padding:      '6px 12px',
    borderBottom: '1px solid ' + T.border,
  });
  var label = document.createElement('div');
  Object.assign(label.style, {
    color:      isSelected ? T.well : T.green,
    fontFamily: T.fh,
    fontWeight: T.fwBold,
  });
  label.textContent = 'S' + (seat.number != null ? seat.number : (seatIdx + 1));
  hdr.appendChild(label);
  wrap.appendChild(hdr);

  var body = document.createElement('div');
  Object.assign(body.style, {
    background:     isSelected ? accent : T.card,
    flex:           '1',
    display:        'flex',
    alignItems:     'center',
    justifyContent: 'center',
    padding:        '10px',
  });
  var totalEl = document.createElement('div');
  Object.assign(totalEl.style, {
    color:      isSelected ? T.well : T.gold,
    fontFamily: T.fb,
    fontSize:   T.fsB1,
    fontWeight: T.fwBold,
  });
  totalEl.textContent = fmt(seatTotal(seat));
  body.appendChild(totalEl);
  wrap.appendChild(body);

  var canDelete = seat.items.length === 0
    && activeSeatCount(state.seats, state.paidSeats) > 1;
  if (canDelete) {
    wrap.appendChild(_buildDeleteSeatX(state, seat.id));
  }

  state.seatEls[seat.id] = wrap;
  return wrap;
}

// ═══════════════════════════════════════════════════
//  ADD TILE (dashed +)
// ═══════════════════════════════════════════════════

function buildAddTile(state, opts) {
  opts = opts || {};
  var wrap = buildStaticCard({ accent: T.green });
  wrap.style.flex          = '1';
  wrap.style.padding       = '0';
  wrap.style.display       = 'flex';
  wrap.style.flexDirection = 'column';
  wrap.style.overflow      = 'hidden';

  Object.assign(wrap.style, {
    display:        'flex',
    alignItems:     'center',
    justifyContent: 'center',
  });

  var plus = document.createElement('div');
  Object.assign(plus.style, {
    fontFamily:  T.fh,
    fontWeight:  T.fwBold,
    fontSize:    '48px',
    color:       T.green,
    lineHeight:  '1',
    userSelect:  'none',
  });
  plus.textContent = '+';
  wrap.appendChild(plus);

  wrap.style.cursor        = 'pointer';
  wrap.style.pointerEvents = 'auto';
  wrap.style.touchAction   = 'manipulation';
  plus.style.pointerEvents = 'none';  // let clicks fall through to wrap

  wrap.onclick = function() {
    if (state._manageMode
        && state._manageTool === 'merge'
        && Object.keys(state.selectedItems || {}).length > 0) {
      _mergeToNewSeat(state);
      return;
    }
    addSeat(state);
  };

  return wrap;
}

// ── +CHECK tile ──
// Rendered alongside the +SEAT add-tile during MANAGE + MERGE mode.
// Tapping it splits the current selection off into a new sibling
// check via _mergeToNewCheck. Shares the dashed-outline empty-slot
// look with buildAddTile but tints the glyph and border T.elec to
// flag that it leaves the current check.
function buildCheckTile(state, opts) {
  opts = opts || {};
  var tile = document.createElement('div');
  Object.assign(tile.style, {
    background:     'transparent',
    border:         '1px dashed ' + T.elec,
    borderRadius:   '10px',
    display:        'flex',
    flexDirection:  'column',
    alignItems:     'center',
    justifyContent: 'center',
    gap:            '2px',
    cursor:         'pointer',
    minHeight:      opts.compact ? '72px' : '0',
    pointerEvents:  'auto',
    flexShrink:     '0',
  });
  if (opts.narrow) tile.style.width = '54px';

  var plus = document.createElement('div');
  Object.assign(plus.style, {
    fontFamily: T.fh,
    fontWeight: T.fwBold,
    fontSize:   (opts.narrow || opts.fullSize) ? '40px' : (opts.compact ? '26px' : '40px'),
    color:      T.elec,
    lineHeight: '1',
  });
  plus.textContent = '+';
  tile.appendChild(plus);

  var lbl = document.createElement('span');
  Object.assign(lbl.style, {
    fontFamily:    T.fb,
    fontSize:      opts.narrow ? '7px' : '9px',
    fontWeight:    T.fwBold,
    letterSpacing: '0.14em',
    color:         T.elec,
  });
  lbl.textContent = 'CHECK';
  tile.appendChild(lbl);

  tile.addEventListener('pointerdown', function() {
    tile.style.background = hexToRgba(T.elec, 0.08);
  });
  tile.addEventListener('pointerup', function() {
    tile.style.background = 'transparent';
    _mergeToNewCheck(state);
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
    // MANAGE mode routing — tool decides how a seat-tile tap is
    // interpreted:
    //   MOVE: tap = move the current item selection onto this seat
    //         (falls through to toggleSeat when no items are selected
    //         so the cashier can still use the header to pick
    //         everything on a seat).
    //   SPLIT: tap toggles this seat in/out of the recipient set.
    //          state.selected is the recipient set while split is
    //          live; selectedItems stays intact so the commit has
    //          something to split. toggleSeat's mirror is bypassed.
    if (state._manageMode) {
      if (state._manageTool === 'split') {
        if (state.selected[seatId]) delete state.selected[seatId];
        else                         state.selected[seatId] = true;
        rerenderTopArea(state);
        return;
      }
      if ((state._manageTool === 'move' || state._manageTool === 'merge')
          && Object.keys(state.selectedItems || {}).length > 0) {
        var refs = getSelectedItemRefs(state);
        _moveItemsToSeat(state, refs, seatId);
        return;
      }
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

// ── Selection model ──
// state.selectedItems (keyed "seatIdx:itemIdx") is the source of truth.
// state.selected (keyed seat.id) is a derived mirror — true iff every
// item in that seat is currently in selectedItems. Downstream consumers
// (handlePay, handleVoid, etc.) still read state.selected for whole-seat
// checks, so we keep it in sync after every mutation.
function _syncSelectedFromItems(state) {
  var next = {};
  // Carry empty-seat selections forward — they have no items to
  // mirror, so they persist based on explicit toggleSeat taps until
  // the cashier untaps them (or ADD ITEMS populates the seat).
  if (state.selected) {
    for (var i = 0; i < state.seats.length; i++) {
      var s = state.seats[i];
      if (state.paidSeats && state.paidSeats[s.id]) continue;
      if (s.items.length === 0 && state.selected[s.id]) {
        next[s.id] = true;
      }
    }
  }
  // Non-empty seats are "fully selected" iff every one of their items
  // is in state.selectedItems.
  for (var i2 = 0; i2 < state.seats.length; i2++) {
    var s2 = state.seats[i2];
    if (state.paidSeats && state.paidSeats[s2.id]) continue;
    if (!s2.items.length) continue;
    var all = true;
    for (var j = 0; j < s2.items.length; j++) {
      if (!state.selectedItems[i2 + ':' + j]) { all = false; break; }
    }
    if (all) next[s2.id] = true;
  }
  state.selected = next;
}

// Tapping a seat is a bulk shortcut: if every item in the seat is
// already selected, deselect the whole seat; otherwise select every
// item. Empty seats flip state.selected directly — no items to
// mirror — so the tile still serves as ADD ITEMS scope. Individual
// item taps go through toggleItem.
function toggleSeat(state, seatId) {
  if (state.paidSeats && state.paidSeats[seatId]) return;
  var seatIdx = -1;
  for (var i = 0; i < state.seats.length; i++) {
    if (state.seats[i].id === seatId) { seatIdx = i; break; }
  }
  if (seatIdx < 0) return;
  var seat = state.seats[seatIdx];
  if (!state.selectedItems) state.selectedItems = {};
  if (!state.selected)      state.selected      = {};

  if (seat.items.length === 0) {
    if (state.selected[seatId]) delete state.selected[seatId];
    else                         state.selected[seatId] = true;
    rerenderTopArea(state);
    return;
  }

  var allSelected = true;
  for (var j = 0; j < seat.items.length; j++) {
    if (!state.selectedItems[seatIdx + ':' + j]) { allSelected = false; break; }
  }
  for (var k = 0; k < seat.items.length; k++) {
    var key = seatIdx + ':' + k;
    if (allSelected) delete state.selectedItems[key];
    else             state.selectedItems[key] = true;
  }
  _syncSelectedFromItems(state);
  rerenderTopArea(state);
}

function toggleItem(state, seatIdx, itemIdx) {
  state.selectedItems = toggleItemSelection(state.selectedItems, seatIdx, itemIdx);
  _syncSelectedFromItems(state);
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
  var _prevChain = state._seatsChain || Promise.resolve();
  var myChain = _prevChain.then(function() {
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
  state._seatsChain = myChain;
  // Clear the chain reference once our tail resolves so refreshOrder's
  // `if (state._seatsChain)` guard can fall through on the next call.
  // Before this cleanup the chain stayed truthy forever, and refreshOrder
  // would recurse on an already-resolved promise — an infinite microtask
  // loop that locks the tab. Only clear when we're still the tail (a
  // later persistSeats may have queued on top of us).
  myChain.then(function() {
    if (state._seatsChain === myChain) state._seatsChain = null;
  }, function() {
    if (state._seatsChain === myChain) state._seatsChain = null;
  });
  return myChain;
}

// Push item seat assignments to the backend. Used after MANAGE MOVE/MERGE
// to ensure item assignments survive a scene transition or backend refresh.
function persistItemSeats(state, items) {
  if (!state.orderId || !items || items.length === 0) return Promise.resolve();

  // Filter to items that have a server-assigned item_id (already persisted once).
  // New items added in this session but not yet sent to kitchen won't have one,
  // but move/merge only happens in check-overview on items that ARE already saved.
  var persistedItems = items.filter(function(it) { return !!it.item_id; });
  if (persistedItems.length === 0) return Promise.resolve();

  var promises = persistedItems.map(function(it) {
    return fetchWithTimeout('/api/v1/orders/' + state.orderId + '/items/' + it.item_id, {
      method:  'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ seat_number: it.seat_number }),
    }, 15000);
  });

  return Promise.allSettled(promises).then(function(results) {
    var failed = results.filter(function(r) { return r.status === 'rejected' || !r.value.ok; });
    if (failed.length > 0) {
      console.warn('[KINDpos] Some item seat updates failed:', failed.length);
      entReport({
        code: 'UI-009', level: 'WARNING',
        source: 'check-overview.persistItemSeats',
        message: 'PATCH /items/{id} failed for ' + failed.length + ' items',
        ctx: { orderId: state.orderId, count: failed.length },
      });
    }
  });
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
  var movedItems = [];
  var targetNum = state.seats[targetIdx].number;

  for (var r = 0; r < refs.length; r++) {
    var rr = refs[r];
    if (rr.seatIdx === targetIdx) continue;  // skip no-op moves
    var fromSeat = state.seats[rr.seatIdx];
    var it = fromSeat.items.splice(rr.itemIdx, 1)[0];
    it.seat_number = targetNum;
    state.seats[targetIdx].items.push(it);
    movedItems.push(it);
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

  persistItemSeats(state, movedItems);
  persistSeats(state);

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

      var movedItems = state.seats[sIdx].items;
      var targetNum = state.seats[tIdx].number;
      for (var m = 0; m < movedItems.length; m++) {
        movedItems[m].seat_number = targetNum;
      }

      state.seats[tIdx].items = state.seats[tIdx].items.concat(movedItems);
      state.seats.splice(sIdx, 1);
      delete state.selected[sourceSeatId];
      rerenderTopArea(state);
      showToast('Merged into ' + targetId, { bg: T.greenWarm });

      persistItemSeats(state, movedItems);
      persistSeats(state);
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