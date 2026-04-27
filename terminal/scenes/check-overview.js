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
import { T } from '../../common/tokens.js';
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
import { fetchWithTimeout } from '../net.js';
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

function fmt(n) {
  // Coerce to Number so we tolerate stringified prices from the backend
  // ("9.00" is common) — the raw `n.toFixed(2)` path used to throw a
  // TypeError on any non-number and take the whole action bar down.
  var v = Number(n);
  if (!isFinite(v)) v = 0;
  return '$' + v.toFixed(2);
}

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
    sent:          !!(it.sent_at || it.sent),
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

  // Selection drives SORT, not filter: seats with at least one selected
  // item float to the top of the recap so the cashier's working set is
  // always visible first, while the rest of the check stays reachable
  // below. state.selectedItems is the source of truth; state.selected
  // is a derived "fully-selected" mirror maintained by toggleSeat /
  // toggleItem.
  var selItems = state.selectedItems || {};
  var selKeys  = Object.keys(selItems);
  var seatIdxsWithSelected = {};
  for (var sk = 0; sk < selKeys.length; sk++) {
    var sIdxSel = parseInt(selKeys[sk].split(':')[0], 10);
    if (!isNaN(sIdxSel)) seatIdxsWithSelected[sIdxSel] = true;
  }

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
      _sIdx:      s,  // original state.seats index — used by the sort below
    });
  }

  // Single-seat focus: when exactly one seat tile is selected, narrow the
  // recap to that seat only so the left column gives focused context.
  // With 0 or 2+ selections the full recap is shown (sorted below).
  var selectedSeatIds = Object.keys(state.selected || {});
  if (selectedSeatIds.length === 1) {
    var focusId = selectedSeatIds[0];
    adaptedSeats = adaptedSeats.filter(function(s) {
      return state.seats[s._sIdx] && state.seats[s._sIdx].id === focusId;
    });
  } else if (Object.keys(seatIdxsWithSelected).length > 0) {
    // Sort selected-having seats to the top; preserve seat-number order
    // within each group. No-op when nothing is selected.
    adaptedSeats.sort(function(a, b) {
      var aSel = seatIdxsWithSelected[a._sIdx] ? 1 : 0;
      var bSel = seatIdxsWithSelected[b._sIdx] ? 1 : 0;
      if (aSel !== bSel) return bSel - aSel;
      return (a.seatNumber || 0) - (b.seatNumber || 0);
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
    get _persistSeats()  { return persistSeats; },
    get _addSeat()       { return addSeat; },
    get openNameEditor()     { return openNameEditor; },
    get refreshOrder()       { return refreshOrder; },
    get forceSelectAll()          { return forceSelectAll; },
    get toggleSeat()              { return toggleSeat; },
    get openSeatPaymentInterrupt(){ return openSeatPaymentInterrupt; },
    get _callSplitBySeat()        { return _callSplitBySeat; },
    get _moveItemsToSeat()        { return _moveItemsToSeat; },
    get _persistItemSeats()       { return persistItemSeats; },
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
    paidSeats:          {},
    seatPayments:       {},
    _selectedPaidSeat:  null,
    _payingSeats:       [],
    _backConfirmed:false,
    rootEl:        null,
    topAreaEl:     null,
    bottomBarEl:   null,
    seatEls:       {},
    _lpTimers:     [],
    _voidTimers:   [],
    _mode:         null,
    _summaryItemMap:{},
    _osActive:     false,
    _mountParams:  null,
    _seatsChain:   null,
    _refreshInFlight: false,
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
    state.paidSeats          = {};
    state.seatPayments       = {};
    state._selectedPaidSeat  = null;
    state._payingSeats       = [];
    state._backConfirmed= false;
    state._lpTimers     = [];
    state._voidTimers   = [];
    state._mode         = null;
    state._osActive     = false;
    state._tileSelSet   = new Set();
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

    // Stash the landing target on state so renderOrderSummary can wire its
    // own BACK chevron without re-deriving the landing/emp bundle each call.
    state._landing       = _landing;
    state._landingParams = _landingParams;

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

    if (window._header && window._header.setBackHandler) {
      window._header.setBackHandler(state._landing ? function() {
        SceneManager.mountWorking(state._landing, state._landingParams);
      } : null);
    }

    return function cleanup() { /* scene-level cleanup in unmount */ };
  },

  unmount: function(state) {
    if (window._header && window._header.setBackHandler) {
      window._header.setBackHandler(null);
    }
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
    for (var v = 0; v < state._voidTimers.length; v++) clearTimeout(state._voidTimers[v]);
    state._voidTimers = [];
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

        var shell = buildStaticCard({ accent: T.green });
        shell.style.display       = 'flex';
        shell.style.flexDirection = 'column';
        shell.style.alignItems    = 'stretch';
        shell.style.gap           = '10px';
        shell.style.minWidth      = '320px';
        shell.style.maxWidth      = '420px';
        shell.style.padding       = '20px 28px 28px 32px';
        var panel = shell;

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

        // Option pills — scene passes a semantic opt.color (T.green,
        // T.verm, T.gold…). Unset options fall back to ghost so they
        // don't blend into the T.card shell.
        for (var oi = 0; oi < options.length; oi++) {
          (function(opt) {
            var btn;
            if (opt.color) {
              btn = buildPillButton({
                label:    opt.label,
                color:    opt.color,
                darkBg:   darkenHex(opt.color, 0.4),
                fontSize: T.fsB2,
                onClick:  function() { params.onConfirm(opt.id); },
              });
              btn.style.color = (opt.color === T.verm) ? '#fff' : T.well;
            } else {
              btn = buildPillButton({
                label:    opt.label,
                variant:  'ghost',
                fontSize: T.fsB2,
                onClick:  function() { params.onConfirm(opt.id); },
              });
            }
            btn.style.width         = '100%';
            btn.style.borderRadius  = '14px';
            btn.style.display       = 'flex';
            btn.style.alignItems    = 'center';
            btn.style.justifyContent = 'center';
            panel.appendChild(btn);
          })(options[oi]);
        }

        // CANCEL — destructive exit.
        var cancelBtn = buildPillButton({
          label:    'CANCEL',
          variant:  'verm',
          fontSize: T.fsB2,
          onClick:  function() { params.onCancel(); },
        });
        cancelBtn.style.width          = '100%';
        cancelBtn.style.marginTop      = '6px';
        cancelBtn.style.borderRadius   = '14px';
        cancelBtn.style.display        = 'flex';
        cancelBtn.style.alignItems     = 'center';
        cancelBtn.style.justifyContent = 'center';
        panel.appendChild(cancelBtn);
        container.appendChild(shell);

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

        var shell = buildStaticCard({ accent: T.green });
        shell.style.display       = 'flex';
        shell.style.flexDirection = 'column';
        shell.style.gap           = '10px';
        shell.style.minWidth      = '320px';
        shell.style.maxWidth      = '440px';
        shell.style.minHeight     = '360px';
        shell.style.maxHeight     = '520px';
        shell.style.padding       = '20px 28px 28px 32px';
        var panel = shell;

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
          variant:  'verm',
          fontSize: T.fsB2,
          onClick:  function() { params.onCancel(); },
        });
        cancelBtn.style.alignSelf       = 'center';
        cancelBtn.style.height          = '48px';
        cancelBtn.style.minWidth        = '160px';
        cancelBtn.style.borderRadius    = '14px';
        cancelBtn.style.display         = 'flex';
        cancelBtn.style.alignItems      = 'center';
        cancelBtn.style.justifyContent  = 'center';
        panel.appendChild(cancelBtn);
        container.appendChild(shell);

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

        var shell = buildStaticCard({ accent: T.groups.auth.shellAccent });
        shell.style.display       = 'flex';
        shell.style.flexDirection = 'column';
        shell.style.alignItems    = 'center';
        shell.style.gap           = '14px';
        shell.style.padding       = '24px 28px 28px 32px';
        var panel = shell;

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
        container.appendChild(shell);

        container.addEventListener('pointerup', function(e) {
          if (e.target === container) { params.onCancel(); }
        });
      },
      unmount: function() {},
    },

    'disc-select': {
      render: function(container, params) {
        container.style.cssText = 'width:100%;height:100%;display:flex;align-items:center;justify-content:center;';

        var shell = buildStaticCard({ accent: T.groups.picker.shellAccentAuth });
        shell.style.display       = 'flex';
        shell.style.flexDirection = 'column';
        shell.style.alignItems    = 'center';
        shell.style.gap           = '12px';
        shell.style.minWidth      = '320px';
        shell.style.padding       = '24px 28px 28px 32px';
        var panel = shell;

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
          btn.style.width          = '240px';
          btn.style.borderRadius   = '14px';
          btn.style.display        = 'flex';
          btn.style.alignItems     = 'center';
          btn.style.justifyContent = 'center';
          panel.appendChild(btn);
        });

        var cancelBtn = buildPillButton({
          label:    'CANCEL',
          variant:  'verm',
          fontSize: T.fsB2,
          onClick:  function() { params.onCancel(); },
        });
        cancelBtn.style.width          = '240px';
        cancelBtn.style.marginTop      = '6px';
        cancelBtn.style.borderRadius   = '14px';
        cancelBtn.style.display        = 'flex';
        cancelBtn.style.alignItems     = 'center';
        cancelBtn.style.justifyContent = 'center';
        panel.appendChild(cancelBtn);
        container.appendChild(shell);
      },
      unmount: function() {},
    },

    'seat-count': {
      render: function(container, params) {
        container.style.cssText = 'width:100%;height:100%;display:flex;align-items:center;justify-content:center;';

        var numpad = buildNumpad({
          masked:    false,
          maxDigits: 2,
          onSubmit: function(val) {
            var n = parseInt(val, 10);
            if (!isFinite(n) || n < 1) { numpad.setError('ENTER A NUMBER'); return; }
            if (n > 99)                 { numpad.setError('MAX 99');         return; }
            params.onConfirm(n);
          },
          onCancel: function() { params.onCancel(); },
        });

        var shell = buildStaticCard({ accent: T.groups.auth.shellAccent });
        shell.style.padding = '20px 24px';
        shell.appendChild(numpad);
        container.appendChild(shell);

        container.addEventListener('pointerup', function(e) {
          if (e.target === container) params.onCancel();
        });
      },
      unmount: function() {},
    },

    'seat-payment': {
      render: function(container, params) {
        params = params || {};
        var seatId   = params.seatId   || '??';
        var payments = params.payments || [];

        container.style.cssText = 'width:100%;height:100%;display:flex;align-items:center;justify-content:center;';

        var shell = buildStaticCard({ accent: T.gold });
        shell.style.display       = 'flex';
        shell.style.flexDirection = 'column';
        shell.style.alignItems    = 'stretch';
        shell.style.gap           = '10px';
        shell.style.minWidth      = '320px';
        shell.style.maxWidth      = '440px';
        shell.style.padding       = '24px 28px 28px 32px';
        var panel = shell;

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
                variant:  'verm',
                fontSize: T.fsB3,
                onClick:  function() { params.onConfirm(p.payment_id); },
              });
              delBtn.style.minWidth         = '100px';
              delBtn.style.height           = '40px';
              delBtn.style.borderRadius     = '14px';
              delBtn.style.display          = 'flex';
              delBtn.style.alignItems       = 'center';
              delBtn.style.justifyContent   = 'center';
              row.appendChild(delBtn);
              panel.appendChild(row);
            })(payments[pi]);
          }
        }

        var cancelBtn = buildPillButton({
          label:    'CANCEL',
          variant:  'verm',
          fontSize: T.fsB2,
          onClick:  function() { params.onCancel(); },
        });
        cancelBtn.style.width          = '100%';
        cancelBtn.style.marginTop      = '4px';
        cancelBtn.style.borderRadius   = '14px';
        cancelBtn.style.display        = 'flex';
        cancelBtn.style.alignItems     = 'center';
        cancelBtn.style.justifyContent = 'center';
        panel.appendChild(cancelBtn);
        container.appendChild(shell);

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

  var order    = state.order || {};
  var discount = getCashDiscount();

  // ── Selection-aware totals ──
  // When items are selected the bar shows a filtered subtotal so the user
  // can confirm what they're about to act on. The server has no endpoint
  // for a subset total, so we derive it locally from effectivePrice —
  // which is always a server-provided value populated during refreshOrder().
  // The unselected path (else) trusts order.subtotal / order.total directly.
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

  // VOID/DELETE label: flips when every selected item is pre-kitchen
  var voidLabel = 'VOID';
  if (anyItemSel) {
    var allUnsent = true;
    for (var vki = 0; vki < itemKeys.length; vki++) {
      var vp    = itemKeys[vki].split(':');
      var vSeat = state.seats[parseInt(vp[0], 10)];
      var vItem = vSeat && vSeat.items[parseInt(vp[1], 10)];
      if (!vItem) continue;
      if (vItem.sent_at) { allUnsent = false; break; }
    }
    if (allUnsent) voidLabel = 'DELETE';
  }

  var bar = buildStaticCard({ accent: T.green });
  Object.assign(bar.style, {
    display:    'flex',
    alignItems: 'stretch',
    overflow:   'hidden',
    width:      '100%',
    boxSizing:  'border-box',
  });
  barZone.appendChild(bar);

  // ── Left totals block ──
  var totalsBlock = document.createElement('div');
  Object.assign(totalsBlock.style, {
    width:          '196px',
    flexShrink:     '0',
    padding:        '12px 14px',
    display:        'flex',
    flexDirection:  'column',
    justifyContent: 'center',
    gap:            '5px',
    borderRight:    '1px solid ' + T.border,
  });
  bar.appendChild(totalsBlock);

  function _totRow(lbl, val, valColor) {
    var row = document.createElement('div');
    Object.assign(row.style, {
      display:        'flex',
      justifyContent: 'space-between',
      alignItems:     'baseline',
    });
    var l = document.createElement('span');
    Object.assign(l.style, { fontFamily:T.fb, fontSize:T.fsB4, color:T.text,
      letterSpacing:'0.07em', textTransform:'uppercase' });
    l.textContent = lbl;
    var v = document.createElement('span');
    Object.assign(v.style, { fontFamily:T.fb, fontSize:T.fsB3,
      fontWeight:T.fwBold, color:valColor || T.text });
    v.textContent = val;
    row.appendChild(l);
    row.appendChild(v);
    return row;
  }

  totalsBlock.appendChild(_totRow('SUBTOTAL', fmt(subtotal), T.gold));
  if (discount > 0) {
    totalsBlock.appendChild(_totRow('DISC', '-' + fmt(subtotal * discount), T.verm));
  }
  totalsBlock.appendChild(_totRow('TAX',  fmt(tax),       T.gold));
  totalsBlock.appendChild(_totRow('CARD', fmt(total),     T.elec));
  totalsBlock.appendChild(_totRow('CASH', fmt(cashTotal), T.greenWarm));

  // ── Right action groups wrapper ──
  var groupsWrap = document.createElement('div');
  Object.assign(groupsWrap.style, {
    flex:       '1',
    display:    'flex',
    alignItems: 'stretch',
    gap:        '8px',
    padding:    '8px 10px 8px 8px',
    background: T.well,
  });
  bar.appendChild(groupsWrap);

  // ── PAY group card ──
  var payCard = buildStaticCard({ accent: T.gold });
  Object.assign(payCard.style, {
    flex:          '1',
    display:       'flex',
    flexDirection: 'column',
    padding:       '10px 12px 12px',
    gap:           '6px',
    overflow:      'hidden',
    boxShadow:     '0 3px 0 ' + T.goldDk,
  });

  var payHeader = document.createElement('div');
  Object.assign(payHeader.style, {
    fontFamily:    T.fh,
    fontWeight:    T.fwBold,
    fontSize:      T.fsB4,
    letterSpacing: '0.2em',
    paddingLeft:   '8px',
    marginBottom:  '3px',
    color:         T.gold,
  });
  payHeader.textContent = 'PAY';
  payCard.appendChild(payHeader);

  var payBtn = buildPillButton({ label: 'PAY', color: T.gold, darkBg: T.goldDk,
    borderRadius: '6px', onClick: function() { handlePay(state, state._params || {}); } });
  payBtn.style.height = '38px';
  payBtn.style.width  = '100%';
  payCard.appendChild(payBtn);

  var splitPayRow = document.createElement('div');
  Object.assign(splitPayRow.style, { display: 'flex', gap: '5px', justifyContent: 'center' });

  var discBtn = buildPillButton({ label: 'DISC', color: T.lavender,
    darkBg: darkenHex(T.lavender, 0.4), borderRadius: '6px', padding: '8px 20px',
    onClick: function() { handleDiscount(state); } });
  discBtn.style.height = '38px';
  splitPayRow.appendChild(discBtn);

  var voidBtn = buildPillButton({ label: voidLabel, color: T.verm, darkBg: T.vermDk,
    borderRadius: '6px', padding: '8px 20px' });
  voidBtn.style.height = '38px';
  _wireLongPress(voidBtn, function() { handleVoid(state); }, 550);
  splitPayRow.appendChild(voidBtn);

  payCard.appendChild(splitPayRow);
  groupsWrap.appendChild(payCard);

  // ── TERMINAL group card ──
  var termCard = buildStaticCard({ accent: T.elec });
  Object.assign(termCard.style, {
    flex:          '1',
    display:       'flex',
    flexDirection: 'column',
    padding:       '10px 12px 12px',
    gap:           '6px',
    overflow:      'hidden',
    boxShadow:     '0 3px 0 ' + T.elecDk,
  });

  var termHeader = document.createElement('div');
  Object.assign(termHeader.style, {
    fontFamily:    T.fh,
    fontWeight:    T.fwBold,
    fontSize:      T.fsB4,
    letterSpacing: '0.2em',
    paddingLeft:   '8px',
    marginBottom:  '3px',
    color:         T.elec,
  });
  termHeader.textContent = 'TERMINAL';
  termCard.appendChild(termHeader);

  var printBtn = buildPillButton({ label: 'PRINT', color: T.elec, darkBg: T.elecDk,
    borderRadius: '6px', onClick: function() { handlePrint(state); } });
  printBtn.style.height = '38px';
  printBtn.style.width  = '100%';
  termCard.appendChild(printBtn);

  var drawerBtn = buildPillButton({ label: 'OPEN DRAWER', color: T.moon, darkBg: T.moonDk,
    borderRadius: '6px',
    onClick: function() { showToast('Drawer — coming soon', { bg: T.moon }); } });
  drawerBtn.style.height = '38px';
  drawerBtn.style.width  = '100%';
  termCard.appendChild(drawerBtn);

  groupsWrap.appendChild(termCard);

  // ── ORDER group card ──
  var orderCard = buildStaticCard({ accent: T.moon });
  Object.assign(orderCard.style, {
    flex:          '1',
    display:       'flex',
    flexDirection: 'column',
    padding:       '10px 12px 12px',
    gap:           '6px',
    overflow:      'hidden',
    boxShadow:     '0 3px 0 ' + T.moonDk,
  });

  var orderHeader = document.createElement('div');
  Object.assign(orderHeader.style, {
    fontFamily:    T.fh,
    fontWeight:    T.fwBold,
    fontSize:      T.fsB4,
    letterSpacing: '0.2em',
    paddingLeft:   '8px',
    marginBottom:  '3px',
    color:         T.moon,
  });
  orderHeader.textContent = 'ORDER';
  orderCard.appendChild(orderHeader);

  var addBtn = buildPillButton({ label: 'ADD ITEMS', color: T.greenWarm, darkBg: T.greenWarmDk,
    borderRadius: '6px', onClick: function() { handleAddItems(state, state._params || {}); } });
  addBtn.style.height = '38px';
  addBtn.style.width  = '100%';
  orderCard.appendChild(addBtn);

  var splitOrderRow = document.createElement('div');
  Object.assign(splitOrderRow.style, { display: 'flex', gap: '5px', justifyContent: 'center' });

  var sendBtn = buildPillButton({ label: 'SEND UNSENT', color: T.green, darkBg: T.greenDk,
    borderRadius: '6px', padding: '8px 20px',
    onClick: function() {
      if (!state.orderId) { showToast('No items to send', { bg: T.gold }); return; }
      fetchWithTimeout('/api/v1/orders/' + state.orderId + '/send', { method: 'POST' }, 8000)
        .then(function(r) {
          if (r.ok) showToast('Sent to kitchen', { bg: T.greenWarm });
          else      showToast('Send failed', { bg: T.verm });
        })
        .catch(function() { showToast('Send failed', { bg: T.verm }); });
    } });
  sendBtn.style.height = '38px';
  splitOrderRow.appendChild(sendBtn);

  var resendBtn = buildPillButton({ label: 'RESEND', color: T.moon, darkBg: T.moonDk,
    borderRadius: '6px', padding: '8px 20px', onClick: function() { handleResend(state); } });
  resendBtn.style.height = '38px';
  splitOrderRow.appendChild(resendBtn);

  orderCard.appendChild(splitOrderRow);
  groupsWrap.appendChild(orderCard);
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
    position:     'relative',
  });

  // ── Selection toolbar ──
  // Three fixed right-aligned pills: CLEAR · MANAGE · SELECT ALL.
  var selRow = document.createElement('div');
  Object.assign(selRow.style, {
    position:       'absolute',
    top:            '8px',
    right:          '12px',
    zIndex:         '10',
    display:        'flex',
    justifyContent: 'flex-end',
    alignItems:     'center',
    gap:            '8px',
    pointerEvents:  'auto',
  });

  var clearBtn = buildPillButton({
    label:        'CLEAR',
    color:        T.moon,
    darkBg:       T.moonDk,
    fontSize:     T.fsB4,
    padding:      '6px 14px',
    borderRadius: '8px',
    onClick:      function() { clearAllSelection(state); },
  });
  selRow.appendChild(clearBtn);

  var manageBtn = buildPillButton({
    label:        'MANAGE',
    color:        T.moon,
    darkBg:       T.moonDk,
    fontSize:     T.fsB4,
    padding:      '6px 14px',
    borderRadius: '8px',
    onClick:      function() { openEditSeats(state); },
  });
  selRow.appendChild(manageBtn);

  var selAllBtn = buildPillButton({
    label:        'SELECT ALL',
    color:        T.elec,
    darkBg:       T.elecDk,
    fontSize:     T.fsB4,
    padding:      '6px 14px',
    borderRadius: '8px',
    onClick:      function() { forceSelectAll(state); },
  });
  selRow.appendChild(selAllBtn);
  root.appendChild(selRow);

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
  container.innerHTML = '';
  if (mode === 'B') {
    // _tileSelSet lives on state so it survives rerenderTopArea calls
    // triggered by tile taps — it's reset only on mount and when ALL
    // SEATS is tapped. It does NOT write to state.selected /
    // state.selectedItems; it only filters the left recap.
    var _tileSelSet = state._tileSelSet || (state._tileSelSet = new Set());

    // ── LEFT: scrollable recap ──
    var recapCol = document.createElement('div');
    Object.assign(recapCol.style, {
      flex:          '1',
      minWidth:      '0',
      display:       'flex',
      flexDirection: 'column',
      overflow:      'hidden',
    });

    if (state._selectedPaidSeat) {
      var paidPanel = _buildPaidRecapPanel(state, state._selectedPaidSeat);
      paidPanel.style.flex      = '1';
      paidPanel.style.minHeight = '0';
      paidPanel.style.overflowY = 'auto';
      recapCol.appendChild(paidPanel);
    } else {
      // Inline seat sections with _buildItemSubCard per item.
      // _tileSelSet filters which seats are shown; empty = show all.
      var scrollList = document.createElement('div');
      Object.assign(scrollList.style, {
        flex:          '1',
        minHeight:     '0',
        overflowY:     'auto',
        display:       'flex',
        flexDirection: 'column',
        gap:           '8px',
        padding:       '4px 2px',
      });

      for (var rsi = 0; rsi < state.seats.length; rsi++) {
        var rSeat = state.seats[rsi];
        if (state.paidSeats[rSeat.id]) continue;
        if (_tileSelSet.size > 0 && !_tileSelSet.has(rsi)) continue;

        var anyItemSel = false;
        for (var rki = 0; rki < rSeat.items.length; rki++) {
          if (state.selectedItems && state.selectedItems[rsi + ':' + rki]) {
            anyItemSel = true; break;
          }
        }

        // Seat section header (tappable — toggleSeat)
        var secHdr = document.createElement('div');
        Object.assign(secHdr.style, {
          background:    T.well,
          borderLeft:    '3px solid ' + (anyItemSel ? T.green : T.moon),
          borderRadius:  '6px',
          padding:       '5px 8px',
          display:       'flex',
          alignItems:    'center',
          justifyContent:'space-between',
          cursor:        'pointer',
          pointerEvents: 'auto',
          touchAction:   'manipulation',
          userSelect:    'none',
        });
        var secLabel = document.createElement('span');
        Object.assign(secLabel.style, {
          fontFamily: T.fh,
          fontWeight: T.fwBold,
          fontSize:   '20px',
          color:      anyItemSel ? T.green : T.moon,
        });
        secLabel.textContent = 'S' + (rSeat.number != null ? rSeat.number : (rsi + 1));
        secHdr.appendChild(secLabel);
        var secSub = document.createElement('span');
        Object.assign(secSub.style, {
          fontFamily: T.fb,
          fontWeight: T.fwBold,
          fontSize:   '11px',
          color:      T.gold,
        });
        secSub.textContent = fmt(seatTotal(rSeat));
        secHdr.appendChild(secSub);
        (function(capturedSeatId) {
          secHdr.addEventListener('pointerup', function(e) {
            if (e.defaultPrevented) return;
            toggleSeat(state, capturedSeatId);
          });
        })(rSeat.id);
        scrollList.appendChild(secHdr);

        // Indented item sub-cards
        for (var rii = 0; rii < rSeat.items.length; rii++) {
          var subCard = _buildItemSubCard(state, rsi, rii);
          subCard.style.marginLeft = '24px';
          scrollList.appendChild(subCard);
        }
      }
      recapCol.appendChild(scrollList);
    }
    container.appendChild(recapCol);

    // ── RIGHT: 300px compact tile grid ──
    var tilesCol = document.createElement('div');
    Object.assign(tilesCol.style, {
      width:               '300px',
      flexShrink:          '0',
      display:             'grid',
      gridTemplateColumns: 'repeat(3, 1fr)',
      gridAutoRows:        'min-content',
      alignContent:        'start',
      gap:                 '6px',
      overflowY:           'auto',
    });

    // ALL SEATS button — spans 3 columns
    var allSel = _tileSelSet.size === 0;
    var allSeatsBtn = document.createElement('div');
    Object.assign(allSeatsBtn.style, {
      gridColumn:     '1 / -1',
      background:     allSel ? T.elec : T.well,
      border:         '1px solid ' + (allSel ? T.elec : T.moon),
      borderRadius:   '8px',
      padding:        '8px',
      textAlign:      'center',
      cursor:         'pointer',
      pointerEvents:  'auto',
      touchAction:    'manipulation',
      userSelect:     'none',
      fontFamily:     T.fh,
      fontWeight:     T.fwBold,
      fontSize:       '12px',
      color:          allSel ? T.moonText : T.moon,
    });
    allSeatsBtn.textContent = 'ALL SEATS';
    allSeatsBtn.addEventListener('pointerup', function(e) {
      if (e.defaultPrevented) return;
      state._tileSelSet.clear();
      rerenderTopArea(state);
    });
    tilesCol.appendChild(allSeatsBtn);

    // +SEAT add tile
    var addB = buildAddTile(state, { fullSize: true });
    addB.style.flex     = '';
    addB.style.width    = '';
    addB.style.position = 'sticky';
    addB.style.top      = '0';
    addB.style.zIndex   = '1';
    tilesCol.appendChild(addB);

    for (var ti = 0; ti < state.seats.length; ti++) {
      if (state.paidSeats[state.seats[ti].id]) {
        var paidTile = buildPaidCompactTile(state, ti);
        paidTile.style.flex  = '';
        paidTile.style.width = '';
        tilesCol.appendChild(paidTile);
        continue;
      }
      var tile = buildCompactTile(state, ti);
      tile.style.flex  = '';
      tile.style.width = '';
      tilesCol.appendChild(tile);
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
    if (state.paidSeats[state.seats[i].id]) {
      var paidPanel = buildPaidSeatCard(state, i);
      paidPanel.style.flex  = '1';
      paidPanel.style.width = '0';
      container.appendChild(paidPanel);
      continue;
    }
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
}

// Accent is always T.moon (structural) — selection state uses T.green.
// The old per-seat T.seatPalette lookup is removed per the new visual spec.
function seatAccent(/* seatIdx */) {
  return T.moon;
}

// ═══════════════════════════════════════════════════
//  ITEM SUB-CARD (inline, used in Mode A + Mode B recap)
//  Replaces buildItemRecap for per-item rendering.
// ═══════════════════════════════════════════════════

function _buildItemSubCard(state, seatIdx, itemIdx) {
  var item = state.seats[seatIdx].items[itemIdx];
  var isSel = !!(state.selectedItems && state.selectedItems[seatIdx + ':' + itemIdx]);

  var card = document.createElement('div');
  Object.assign(card.style, {
    background:    isSel ? T.green       : T.well,
    border:        '1px solid ' + (isSel ? T.green   : T.moon),
    boxShadow:     '0 3px 0 '  + (isSel ? T.greenDk : T.moonDk),
    borderRadius:  '8px',
    padding:       '5px 8px',
    display:       'flex',
    flexDirection: 'column',
    gap:           '2px',
    cursor:        'pointer',
    pointerEvents: 'auto',
    touchAction:   'manipulation',
    userSelect:    'none',
    boxSizing:     'border-box',
  });

  // sent badge
  if (item.sent_at) {
    var badge = document.createElement('div');
    badge.textContent = '>>>';
    Object.assign(badge.style, {
      fontSize:      '10px',
      fontWeight:    T.fwBold,
      fontFamily:    T.fb,
      color:         isSel ? T.moonText : T.green,
      letterSpacing: '0.04em',
    });
    card.appendChild(badge);
  }

  // name + price row
  var nameRow = document.createElement('div');
  Object.assign(nameRow.style, {
    display:        'flex',
    justifyContent: 'space-between',
    alignItems:     'baseline',
    gap:            '6px',
  });

  var nameEl = document.createElement('span');
  Object.assign(nameEl.style, {
    fontSize:   '12px',
    fontWeight: T.fwBold,
    fontFamily: T.fh,
    color:      isSel ? T.moonText : T.text,
    flex:       '1',
    minWidth:   '0',
  });
  nameEl.textContent = (item.qty > 1 ? item.qty + '× ' : '') + item.name;
  nameRow.appendChild(nameEl);

  var priceEl = document.createElement('span');
  Object.assign(priceEl.style, {
    fontSize:   '11px',
    fontWeight: T.fwBold,
    fontFamily: T.fb,
    color:      isSel ? T.moonText : T.gold,
    flexShrink: '0',
  });
  var itemPrice = item.effectivePrice != null ? item.effectivePrice : (item.price || 0);
  priceEl.textContent = fmt((item.qty || 1) * itemPrice);
  nameRow.appendChild(priceEl);
  card.appendChild(nameRow);

  // modifier rows
  var mods = item.mods || [];
  for (var mi = 0; mi < mods.length; mi++) {
    var mod = mods[mi];
    var modRow = document.createElement('div');
    Object.assign(modRow.style, {
      display:     'flex',
      alignItems:  'baseline',
      gap:         '4px',
      marginLeft:  '8px',
      paddingLeft: '6px',
      borderLeft:  '2px solid ' + hexToRgba(T.moon, 0.3),
    });
    var modName = document.createElement('span');
    Object.assign(modName.style, {
      fontSize:   '10px',
      fontFamily: T.fb,
      color:      isSel ? T.moonText : T.moon,
      flex:       '1',
    });
    modName.textContent = mod.name || '';
    modRow.appendChild(modName);
    if (mod.price && mod.charged) {
      var modPrice = document.createElement('span');
      Object.assign(modPrice.style, {
        fontSize:   '10px',
        fontWeight: T.fwBold,
        fontFamily: T.fb,
        color:      isSel ? T.moonText : T.moon,
      });
      modPrice.textContent = '+' + fmt(mod.price);
      modRow.appendChild(modPrice);
    }
    card.appendChild(modRow);
  }

  // discount row (item-level discount via effectivePrice being lower than price)
  var basePrice = item.price || 0;
  var effPrice  = item.effectivePrice != null ? item.effectivePrice : basePrice;
  if (effPrice < basePrice && basePrice > 0) {
    var discRow = document.createElement('div');
    Object.assign(discRow.style, {
      display:     'flex',
      alignItems:  'baseline',
      gap:         '4px',
      marginLeft:  '8px',
      paddingLeft: '6px',
      borderLeft:  '2px solid ' + hexToRgba(T.verm, 0.4),
    });
    var discLabel = document.createElement('span');
    Object.assign(discLabel.style, {
      fontSize:   '10px',
      fontFamily: T.fb,
      color:      isSel ? T.moonText : T.moon,
      flex:       '1',
    });
    discLabel.textContent = 'DISC';
    discRow.appendChild(discLabel);
    var discAmt = document.createElement('span');
    Object.assign(discAmt.style, {
      fontSize:   '10px',
      fontWeight: T.fwBold,
      fontFamily: T.fb,
      color:      isSel ? T.moonText : T.verm,
    });
    discAmt.textContent = '-' + fmt((item.qty || 1) * (basePrice - effPrice));
    discRow.appendChild(discAmt);
    card.appendChild(discRow);
  }

  card.addEventListener('pointerup', function(e) {
    if (e.defaultPrevented) return;
    toggleItem(state, seatIdx, itemIdx);
  });

  return card;
}

function buildSeatCard(state, seatIdx) {
  var seat = state.seats[seatIdx];

  // seat-active = any item in this seat is in state.selectedItems
  var seatActive = false;
  var selItems = state.selectedItems || {};
  for (var ki = 0; ki < seat.items.length; ki++) {
    if (selItems[seatIdx + ':' + ki]) { seatActive = true; break; }
  }

  var wrap = buildActionCard({ accent: T.moon });
  wrap.style.flex          = '1';
  wrap.style.padding       = '0';
  wrap.style.display       = 'flex';
  wrap.style.flexDirection = 'column';
  wrap.style.overflow      = 'hidden';
  wrap.style.borderLeft    = '4px solid ' + (seatActive ? T.green   : T.moon);
  wrap.style.boxShadow     = seatActive
    ? '0 4px 0 ' + T.greenDk + ', 0 0 18px rgba(134,239,172,0.14)'
    : '0 4px 0 ' + T.moonDk;

  // ── Header (tappable — toggleSeat) ──
  var hdr = document.createElement('div');
  Object.assign(hdr.style, {
    background:    seatActive ? T.green : T.well,
    padding:       '8px 12px',
    borderBottom:  '1px solid ' + T.border,
    display:       'flex',
    alignItems:    'center',
    cursor:        'pointer',
    userSelect:    'none',
    pointerEvents: 'auto',
    touchAction:   'manipulation',
  });

  var label = document.createElement('div');
  Object.assign(label.style, {
    color:      seatActive ? T.moonText : T.moon,
    fontFamily: T.fh,
    fontWeight: T.fwBold,
    fontSize:   '17px',
  });
  label.textContent = 'S' + (seat.number != null ? seat.number : (seatIdx + 1));
  hdr.appendChild(label);

  hdr.addEventListener('pointerup', function(e) {
    if (e.defaultPrevented) return;
    toggleSeat(state, seat.id);
  });
  wrap.appendChild(hdr);

  // ── Body (scrollable item cards) ──
  var body = document.createElement('div');
  Object.assign(body.style, {
    flex:          '1',
    minHeight:     '0',
    padding:       '8px',
    display:       'flex',
    flexDirection: 'column',
    gap:           '6px',
    overflowY:     'auto',
  });

  if (seat.items.length === 0) {
    var empty = document.createElement('div');
    Object.assign(empty.style, {
      flex:           '1',
      display:        'flex',
      alignItems:     'center',
      justifyContent: 'center',
      color:          T.border,
      fontStyle:      'italic',
      fontFamily:     T.fb,
    });
    empty.textContent = 'empty seat';
    body.appendChild(empty);
  } else {
    for (var ii = 0; ii < seat.items.length; ii++) {
      body.appendChild(_buildItemSubCard(state, seatIdx, ii));
    }
  }
  wrap.appendChild(body);

  // ── Footer (subtotal + optional disc) ──
  if (seat.items.length > 0) {
    var footer = document.createElement('div');
    Object.assign(footer.style, {
      flexShrink:    '0',
      padding:       '6px 10px',
      borderTop:     '1px solid ' + hexToRgba(T.border, 0.3),
      display:       'flex',
      flexDirection: 'column',
      gap:           '2px',
    });

    // DISC row — only when a cash discount is configured
    var discount = getCashDiscount();
    if (discount > 0) {
      var discAmt = seatTotal(seat) * discount;
      var discRow = document.createElement('div');
      Object.assign(discRow.style, { display:'flex', justifyContent:'space-between', alignItems:'baseline' });
      var discLbl = document.createElement('span');
      Object.assign(discLbl.style, { fontFamily:T.fb, fontSize:'10px', color:T.verm, letterSpacing:'0.06em' });
      discLbl.textContent = 'DISC';
      var discVal = document.createElement('span');
      Object.assign(discVal.style, { fontFamily:T.fb, fontSize:'11px', fontWeight:T.fwBold, color:T.verm });
      discVal.textContent = '-' + fmt(discAmt);
      discRow.appendChild(discLbl);
      discRow.appendChild(discVal);
      footer.appendChild(discRow);
    }

    // SUBTOTAL row
    var subRow = document.createElement('div');
    Object.assign(subRow.style, { display:'flex', justifyContent:'space-between', alignItems:'baseline' });
    var subLbl = document.createElement('span');
    Object.assign(subLbl.style, { fontFamily:T.fb, fontSize:'10px', color:T.moon, letterSpacing:'0.06em' });
    subLbl.textContent = 'SUBTOTAL';
    var subVal = document.createElement('span');
    Object.assign(subVal.style, {
      fontFamily: T.fb, fontSize:'11px', fontWeight:T.fwBold,
      color: seatActive ? T.green : T.gold,
    });
    subVal.textContent = fmt(seatTotal(seat));
    subRow.appendChild(subLbl);
    subRow.appendChild(subVal);
    footer.appendChild(subRow);

    wrap.appendChild(footer);
  }

  var canDelete = seat.items.length === 0
    && activeSeatCount(state.seats, state.paidSeats) > 1;
  if (canDelete) {
    var delX = _buildDeleteSeatX(state, seat.id);
    wrap.appendChild(delX);
  }

  state.seatEls[seat.id] = wrap;
  return wrap;
}

// ═══════════════════════════════════════════════════
//  PAID SEAT HELPERS — shared between Mode A cards and Mode B recap panel
// ═══════════════════════════════════════════════════

// One tappable payment row: METHOD · $AMOUNT · S1,S2 · C-042
function _buildPaymentRow(state, seatId, pmt) {
  var row = document.createElement('div');
  Object.assign(row.style, {
    display:       'flex',
    alignItems:    'center',
    justifyContent:'space-between',
    padding:       '9px 12px',
    borderBottom:  '1px solid ' + hexToRgba(T.gold, 0.18),
    cursor:        'pointer',
    userSelect:    'none',
    background:    'transparent',
    touchAction:   'manipulation',
  });

  var left = document.createElement('div');
  Object.assign(left.style, {
    display:    'flex',
    gap:        '8px',
    alignItems: 'center',
    fontFamily: T.fb,
    fontSize:   T.fsB3,
    color:      T.gold,
  });

  var methodEl = document.createElement('span');
  Object.assign(methodEl.style, {
    fontWeight:    T.fwBold,
    letterSpacing: '0.06em',
    textTransform: 'uppercase',
  });
  methodEl.textContent = pmt.method || 'payment';
  left.appendChild(methodEl);

  var sep1 = document.createElement('span');
  sep1.style.color   = hexToRgba(T.gold, 0.4);
  sep1.textContent   = '·';
  left.appendChild(sep1);

  // Seat numbers this payment covers
  var seatNums = Array.isArray(pmt.seat_numbers) ? pmt.seat_numbers : [];
  var seatLabel = seatNums.map(function(n) { return 'S' + n; }).join(', ') || seatId;
  var seatEl = document.createElement('span');
  seatEl.style.color = hexToRgba(T.gold, 0.7);
  seatEl.textContent = seatLabel;
  left.appendChild(seatEl);

  if (state.checkNumber) {
    var sep2 = document.createElement('span');
    sep2.style.color   = hexToRgba(T.gold, 0.4);
    sep2.textContent   = '·';
    left.appendChild(sep2);

    var checkEl = document.createElement('span');
    checkEl.style.color = hexToRgba(T.gold, 0.7);
    checkEl.textContent = state.checkNumber;
    left.appendChild(checkEl);
  }

  row.appendChild(left);

  var amountEl = document.createElement('div');
  Object.assign(amountEl.style, {
    fontFamily: T.fb,
    fontWeight: T.fwBold,
    fontSize:   T.fsB3,
    color:      T.gold,
  });
  amountEl.textContent = fmt(pmt.amount || 0);
  row.appendChild(amountEl);

  row.addEventListener('pointerup', function(e) {
    if (e.defaultPrevented) return;
    openSeatPaymentInterrupt(state, seatId, [pmt]);
  });

  return row;
}

// Mode B left-column panel shown when a paid tile is selected.
function _buildPaidRecapPanel(state, seatId) {
  var seatIdx = -1;
  for (var i = 0; i < state.seats.length; i++) {
    if (state.seats[i].id === seatId) { seatIdx = i; break; }
  }
  var seat     = seatIdx >= 0 ? state.seats[seatIdx] : null;
  var payments = state.seatPayments[seatId] || [];
  var seatNum  = seat ? (seat.number != null ? seat.number : seatIdx + 1) : '?';

  var panel = document.createElement('div');
  Object.assign(panel.style, {
    display:       'flex',
    flexDirection: 'column',
    width:         '100%',
  });

  // Header bar
  var hdr = document.createElement('div');
  Object.assign(hdr.style, {
    background:    T.gold,
    padding:       '10px 14px',
    display:       'flex',
    alignItems:    'center',
    justifyContent:'space-between',
    borderRadius:  '8px 8px 0 0',
    userSelect:    'none',
  });
  var titleEl = document.createElement('div');
  Object.assign(titleEl.style, {
    color:      T.moonText,
    fontFamily: T.fh,
    fontWeight: T.fwBold,
    fontSize:   T.fsB2,
  });
  titleEl.textContent = 'S' + seatNum + ' — PAID';
  hdr.appendChild(titleEl);

  if (seat) {
    var totalEl = document.createElement('div');
    Object.assign(totalEl.style, {
      color:      T.moonText,
      fontFamily: T.fb,
      fontWeight: T.fwBold,
    });
    totalEl.textContent = fmt(seatTotal(seat));
    hdr.appendChild(totalEl);
  }
  panel.appendChild(hdr);

  // Payment rows
  var body = document.createElement('div');
  Object.assign(body.style, {
    background:    hexToRgba(T.gold, 0.06),
    borderRadius:  '0 0 8px 8px',
    overflow:      'hidden',
  });

  if (payments.length === 0) {
    var empty = document.createElement('div');
    Object.assign(empty.style, {
      padding:    '20px',
      textAlign:  'center',
      color:      hexToRgba(T.gold, 0.5),
      fontStyle:  'italic',
      fontFamily: T.fb,
      fontSize:   T.fsB3,
    });
    empty.textContent = 'no payment record';
    body.appendChild(empty);
  } else {
    payments.forEach(function(pmt) {
      body.appendChild(_buildPaymentRow(state, seatId, pmt));
    });
  }
  panel.appendChild(body);

  return panel;
}

// Paid seat card (Mode A) — gold-infilled; body shows tappable payment rows.
function buildPaidSeatCard(state, seatIdx) {
  var seat = state.seats[seatIdx];
  var payments = state.seatPayments[seat.id] || [];

  var wrap = buildStaticCard({ accent: T.gold });
  wrap.style.flex          = '1';
  wrap.style.padding       = '0';
  wrap.style.display       = 'flex';
  wrap.style.flexDirection = 'column';
  wrap.style.overflow      = 'hidden';

  // ── Gold header ──
  var hdr = document.createElement('div');
  Object.assign(hdr.style, {
    background:     T.gold,
    padding:        '8px 12px',
    borderBottom:   '1px solid ' + T.goldDk,
    display:        'flex',
    alignItems:     'center',
    justifyContent: 'space-between',
    userSelect:     'none',
  });

  var label = document.createElement('div');
  Object.assign(label.style, {
    color:      T.moonText,
    fontFamily: T.fh,
    fontWeight: T.fwBold,
  });
  label.textContent = 'S' + (seat.number != null ? seat.number : (seatIdx + 1));
  hdr.appendChild(label);

  var rightSide = document.createElement('div');
  rightSide.style.cssText = 'display:flex;align-items:center;gap:8px;';

  var subtotal = document.createElement('div');
  Object.assign(subtotal.style, {
    color:      T.moonText,
    fontFamily: T.fb,
    fontWeight: T.fwBold,
  });
  subtotal.textContent = fmt(seatTotal(seat));
  rightSide.appendChild(subtotal);

  var paidBadge = document.createElement('div');
  Object.assign(paidBadge.style, {
    background:    T.moonText,
    color:         T.gold,
    borderRadius:  '4px',
    fontFamily:    T.fh,
    fontWeight:    T.fwBold,
    fontSize:      '9px',
    letterSpacing: '0.15em',
    padding:       '2px 5px',
  });
  paidBadge.textContent = 'PAID';
  rightSide.appendChild(paidBadge);
  hdr.appendChild(rightSide);
  wrap.appendChild(hdr);

  // ── Body: one tappable row per payment ──
  var body = document.createElement('div');
  Object.assign(body.style, {
    background:    hexToRgba(T.gold, 0.06),
    flex:          '1',
    minHeight:     '0',
    padding:       '6px 0',
    display:       'flex',
    flexDirection: 'column',
    overflowY:     'auto',
  });

  if (payments.length === 0) {
    var empty = document.createElement('div');
    Object.assign(empty.style, {
      flex:           '1',
      display:        'flex',
      alignItems:     'center',
      justifyContent: 'center',
      color:          hexToRgba(T.gold, 0.5),
      fontStyle:      'italic',
      fontFamily:     T.fb,
      fontSize:       T.fsB3,
      padding:        '12px',
    });
    empty.textContent = 'no payment record';
    body.appendChild(empty);
  } else {
    payments.forEach(function(pmt) {
      body.appendChild(_buildPaymentRow(state, seat.id, pmt));
    });
  }
  wrap.appendChild(body);

  state.seatEls[seat.id] = wrap;
  return wrap;
}

// Mode B compact tile — header shows S# only (no subtotal column that
// would overflow at 33 % width), body shows the seat total big and
// centered so the tile doubles as a balance glance. Item detail lives
// in the recap column to the left.
function buildCompactTile(state, seatIdx) {
  var seat = state.seats[seatIdx];
  // Tile selection is from _tileSelSet (UI-only, not state.selected).
  var _tileSelSet = state._tileSelSet || (state._tileSelSet = new Set());
  var tileActive  = _tileSelSet.has(seatIdx);

  var wrap = buildActionCard({ accent: T.moon });
  wrap.style.padding       = '0';
  wrap.style.display       = 'flex';
  wrap.style.flexDirection = 'column';
  wrap.style.overflow      = 'hidden';
  wrap.style.minHeight     = '90px';
  wrap.style.background    = T.well;
  wrap.style.border        = '1px solid ' + T.moon;
  wrap.style.boxShadow     = '0 2px 0 ' + T.moonDk;

  wrap.addEventListener('pointerup', function(e) {
    if (e.defaultPrevented) return;
    if (_tileSelSet.has(seatIdx)) _tileSelSet.delete(seatIdx);
    else                          _tileSelSet.add(seatIdx);
    rerenderTopArea(state);
  });

  // Header: floods T.green when tile is selected
  var hdr = document.createElement('div');
  Object.assign(hdr.style, {
    background:    tileActive ? T.green : T.well,
    padding:       '6px 10px',
    borderBottom:  '1px solid ' + T.border,
    pointerEvents: 'auto',
    touchAction:   'manipulation',
  });
  var label = document.createElement('div');
  Object.assign(label.style, {
    color:      tileActive ? T.moonText : T.moon,
    fontFamily: T.fh,
    fontWeight: T.fwBold,
  });
  label.textContent = 'S' + (seat.number != null ? seat.number : (seatIdx + 1));
  hdr.appendChild(label);
  wrap.appendChild(hdr);

  // Body: subtotal only — no item count
  var body = document.createElement('div');
  Object.assign(body.style, {
    flex:           '1',
    display:        'flex',
    alignItems:     'center',
    justifyContent: 'center',
    padding:        '8px',
  });
  var totalEl = document.createElement('div');
  Object.assign(totalEl.style, {
    color:      tileActive ? T.green : T.gold,
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

// Paid compact tile (Mode B) — gold-filled. Tapping selects it and
// shows that seat's payment detail in the left recap column.
function buildPaidCompactTile(state, seatIdx) {
  var seat = state.seats[seatIdx];
  var isSelected = state._selectedPaidSeat === seat.id;

  var wrap = buildActionCard({ accent: T.gold });
  wrap.style.padding       = '0';
  wrap.style.display       = 'flex';
  wrap.style.flexDirection = 'column';
  wrap.style.overflow      = 'hidden';
  wrap.style.minHeight     = '90px';
  wrap.style.background    = isSelected ? T.gold : hexToRgba(T.gold, 0.18);

  wrap.addEventListener('pointerup', function(e) {
    if (e.defaultPrevented) return;
    state._selectedPaidSeat = isSelected ? null : seat.id;
    rerenderTopArea(state);
  });

  var hdr = document.createElement('div');
  Object.assign(hdr.style, {
    background:     isSelected ? darkenHex(T.gold, 0.15) : T.gold,
    padding:        '6px 12px',
    borderBottom:   '1px solid ' + T.goldDk,
    display:        'flex',
    alignItems:     'center',
    justifyContent: 'space-between',
  });
  var label = document.createElement('div');
  Object.assign(label.style, {
    color:      T.moonText,
    fontFamily: T.fh,
    fontWeight: T.fwBold,
  });
  label.textContent = 'S' + (seat.number != null ? seat.number : (seatIdx + 1));
  hdr.appendChild(label);
  var badge = document.createElement('div');
  Object.assign(badge.style, {
    background:    T.moonText,
    color:         T.gold,
    borderRadius:  '4px',
    fontFamily:    T.fh,
    fontWeight:    T.fwBold,
    fontSize:      '8px',
    letterSpacing: '0.12em',
    padding:       '1px 4px',
  });
  badge.textContent = 'PAID';
  hdr.appendChild(badge);
  wrap.appendChild(hdr);

  var body = document.createElement('div');
  Object.assign(body.style, {
    flex:           '1',
    display:        'flex',
    alignItems:     'center',
    justifyContent: 'center',
    padding:        '10px',
  });
  var totalEl = document.createElement('div');
  Object.assign(totalEl.style, {
    color:      isSelected ? T.moonText : T.gold,
    fontFamily: T.fb,
    fontSize:   T.fsB1,
    fontWeight: T.fwBold,
  });
  totalEl.textContent = fmt(seatTotal(seat));
  body.appendChild(totalEl);
  wrap.appendChild(body);

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

  // Short tap = add one seat (or commit MERGE when items are selected in
  // MANAGE/merge). Long press (~550 ms) opens the numeric keypad so the
  // cashier can add several seats in a single gesture — handy for
  // large parties landing on a fresh check.
  var lpTimer = null;
  var longPressed = false;
  wrap.addEventListener('pointerdown', function() {
    longPressed = false;
    lpTimer = setTimeout(function() {
      longPressed = true;
      lpTimer = null;
      SceneManager.interrupt('seat-count', {
        onConfirm: function(n) { addSeatsBatch(state, n); },
        onCancel:  function() {},
      });
    }, 550);
  });
  wrap.addEventListener('pointerup', function() {
    if (lpTimer) { clearTimeout(lpTimer); lpTimer = null; }
    if (longPressed) { longPressed = false; return; }
    addSeat(state);
  });
  wrap.addEventListener('pointerleave', function() {
    if (lpTimer) { clearTimeout(lpTimer); lpTimer = null; }
    longPressed = false;
  });
  wrap.addEventListener('pointercancel', function() {
    if (lpTimer) { clearTimeout(lpTimer); lpTimer = null; }
    longPressed = false;
  });

  return wrap;
}

// Append N empty seats in one shot (cheaper than looping addSeat and
// chaining N persistSeats calls). Caps at 99 to match the seat-count
// interrupt's validation. Triggers a single persistSeats + rerender.
function addSeatsBatch(state, n) {
  n = Math.max(1, Math.min(99, parseInt(n, 10) || 1));
  var maxNum = 0;
  for (var i = 0; i < state.seats.length; i++) {
    if (state.seats[i].number > maxNum) maxNum = state.seats[i].number;
  }
  for (var j = 0; j < n; j++) {
    var num = maxNum + j + 1;
    state.seats.push({
      id:     'S-' + String(num).padStart(3, '0'),
      number: num,
      items:  [],
    });
  }
  persistSeats(state);
  rerenderTopArea(state);
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

// Populate state.selectedItems with every unpaid seat's items (plus
// state.selected for empty unpaid seats so they still get the inverted
// tile visual). The items-first totals + recap filter pick up the rest.
function forceSelectAll(state) {
  if (!state.selectedItems) state.selectedItems = {};
  if (!state.selected)      state.selected      = {};
  for (var i = 0; i < state.seats.length; i++) {
    var seat = state.seats[i];
    if (state.paidSeats && state.paidSeats[seat.id]) continue;
    if (seat.items.length === 0) {
      state.selected[seat.id] = true;
    } else {
      for (var j = 0; j < seat.items.length; j++) {
        state.selectedItems[i + ':' + j] = true;
      }
    }
  }
  _syncSelectedFromItems(state);
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
// call only on an existing order. Seat layout on a brand-new check is
// local-only; order-entry creates the order on the first SEND so no
// empty order.created event lands in the ledger when a server walks away
// without adding any items.
function persistSeats(state) {
  // Nothing to do until an order exists. The seat numbers travel to
  // order-entry via buildOrderEntryParams → seatNumbers and are written
  // to the ledger there, alongside the first item.
  if (!state.orderId) return Promise.resolve();

  // Serialize PUTs via a per-state promise chain so rapid seat additions
  // on an existing check don't send overlapping requests.
  var _prevChain = state._seatsChain || Promise.resolve();
  var myChain = _prevChain.then(function() {
    var nums = state.seats.map(function(s) { return s.number; });
    if (nums.length === 0) return;
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
  if (state._printing) return;
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
  state._printing = true;
  showToast('Printing receipt…', { bg: T.green });
  fetchWithTimeout('/api/v1/orders/' + state.orderId + '/print/receipt', { method: 'POST' }, 8000)
    .then(function(r) {
      state._printing = false;
      if (r.ok) showToast('Receipt printed', { bg: T.greenWarm });
      else      showToast('Print failed', { bg: T.verm });
    })
    .catch(function() { state._printing = false; showToast('Print failed', { bg: T.verm }); });
}

// ═══════════════════════════════════════════════════
//  RESEND (re-fire kitchen tickets)
// ═══════════════════════════════════════════════════

function handleResend(state) {
  if (state._resending) return;
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
  state._resending = true;
  showToast('Resending to kitchen…', { bg: T.green });
  fetchWithTimeout('/api/v1/orders/' + state.orderId + '/resend', { method: 'POST' }, 8000)
    .then(function(r) {
      state._resending = false;
      if (r.ok) showToast('Kitchen ticket sent', { bg: T.greenWarm });
      else      showToast('Resend failed', { bg: T.verm });
    })
    .catch(function() { state._resending = false; showToast('Resend failed', { bg: T.verm }); });
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

  if (state.order && state.order.status === 'closed') {
    showToast('Check already settled', { bg: T.gold });
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

  // Guard: all selected seats already paid — nothing to charge.
  if (seatSummary.length === 0) {
    showToast('Selected seat(s) already paid', { bg: T.gold });
    return;
  }

  // Detect whether this payment covers every remaining unpaid seat so the
  // result screen can auto-navigate to landing instead of showing OVERVIEW.
  var totalUnpaidWithItems = 0;
  for (var ui = 0; ui < state.seats.length; ui++) {
    if (!state.paidSeats[state.seats[ui].id] && state.seats[ui].items.length > 0)
      totalUnpaidWithItems++;
  }
  var isLastPayment = seatSummary.length >= totalUnpaidWithItems;

  // Pre-seed totals from the seats we're about to pay — not state.order.total.
  // state.order.total is the whole-check total and can be stale or zero when
  // the user pays a subset of seats; this mirrors renderActionBar's own
  // selection-aware totals calc so what payment shows matches what was just
  // displayed on the overview. effectivePrice is always server-sourced via
  // refreshOrder(), so these are not arbitrary client-side values.
  var discount = getCashDiscount();
  var taxRate  = getTaxRate();
  var subtotal = 0;
  for (var ssI = 0; ssI < seatSummary.length; ssI++) {
    var ssItems = seatSummary[ssI].items || [];
    for (var iI = 0; iI < ssItems.length; iI++) {
      var it = ssItems[iI];
      if (it.voided) continue;
      var p = (it.effectivePrice != null) ? it.effectivePrice : (it.price || 0);
      subtotal += (it.qty || 0) * p;
    }
  }
  subtotal      = Math.round(subtotal * 100) / 100;
  var tax       = Math.round(subtotal * taxRate * 100) / 100;
  var cardTotal = Math.round((subtotal + tax) * 100) / 100;
  var cashPrice = Math.round(cardTotal * (1 - discount) * 100) / 100;

  SceneManager.mountWorking('payment', {
    orderId:       state.orderId,
    seatIds:       selectedIds,
    seats:         seatSummary,
    cardTotal:     cardTotal,
    cashPrice:     cashPrice,
    subtotal:      subtotal,
    tax:           tax,
    isLastPayment: isLastPayment,
    returnTo:      'check-overview',
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
  var allPreKitchen = true;
  for (var i = 0; i < refs.length; i++) {
    var r = refs[i];
    var item = state.seats[r.seatIdx].items[r.itemIdx];
    if (item.sent_at) allPreKitchen = false;
    snapshot.push({ seatIdx: r.seatIdx, itemIdx: r.itemIdx, item: item });
    state.seats[r.seatIdx].items.splice(r.itemIdx, 1);
  }

  var actionWord = allPreKitchen ? 'Deleted' : 'Voided';

  state.selectedItems = {};
  rerenderTopArea(state);

  // Hoisted so the undo handler (defined before the setTimeout) can cancel it.
  var _voidTid = null;

  showToast(actionWord + ' ' + refs.length + ' item(s) — tap to undo', {
    bg: T.verm,
    duration: 4000,
    onClick: function() {
      // Cancel the pending backend DELETE — undo wins.
      if (_voidTid !== null) {
        clearTimeout(_voidTid);
        var ti = state._voidTimers.indexOf(_voidTid);
        if (ti !== -1) state._voidTimers.splice(ti, 1);
        _voidTid = null;
      }
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
      showToast(actionWord + ' undone', { bg: T.greenWarm });
    },
  });

  // After the undo window, commit to backend. Stored in _voidTimers so unmount
  // can cancel it, but rerenderTopArea (which only clears _lpTimers) won't
  // accidentally abort it when the user interacts with the UI.
  if (state.orderId) {
    _voidTid = setTimeout(function() {
      for (var k = 0; k < snapshot.length; k++) {
        var iid = snapshot[k].item.item_id;
        if (!iid) continue;
        fetchWithTimeout('/api/v1/orders/' + state.orderId + '/items/' + iid, { method: 'DELETE' }, 8000);
      }
    }, 4200);
    state._voidTimers.push(_voidTid);
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
  }).then(function(_discountResp) {
    state.selectedItems = {};
    state.selected = {};
    // Refresh from backend truth so totals, balance_due, and payment scene
    // reflect the server-confirmed discount. `order:updated` notifies other
    // panels (e.g. server-landing) that the order has changed.
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
// Shared in-memory move used by the long-press "Move to seat…" picker
// (_pickMoveTarget). refs is the [{seatIdx, itemIdx}] list the
// selection helpers produce; targetSeatId is the destination seat.
// Returns the count actually moved.
function _moveItemsToSeat(state, refs, targetSeatId) {
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
  // Determine which seats to send: selected seats if any, else all unpaid.
  var sentIndices = [];
  var selKeys = Object.keys(state.selected || {});
  if (selKeys.length > 0) {
    for (var i = 0; i < state.seats.length; i++) {
      if (state.selected[state.seats[i].id]) sentIndices.push(i);
    }
  } else {
    for (var i = 0; i < state.seats.length; i++) {
      if (!state.paidSeats[state.seats[i].id]) sentIndices.push(i);
    }
  }

  var columns = sentIndices.map(function(idx) {
    var seat = state.seats[idx];
    return {
      id:    seat.id,
      label: seat.id,
      items: seat.items.map(function(it) {
        return {
          name:         it.name,
          qty:          it.qty,
          price:        it.price,
          item_id:      it.item_id,
          menu_item_id: it.menu_item_id,
          category:     it.category,
          mods:         it.mods,
          notes:        it.notes,
          _splitRef:    it._splitRef || undefined,
        };
      }),
    };
  });

  SceneManager.openTransactional('column-editor', {
    columns:  columns,
    orderId:  state.orderId,
    onSave: function(newColumns) {
      var itemsToSync = [];

      // Zip returned columns back into the original seat indices.
      // Seats whose column was merged away are cleared.
      sentIndices.forEach(function(origIdx, colIdx) {
        var seat = state.seats[origIdx];
        if (newColumns[colIdx]) {
          seat.items = newColumns[colIdx].items;
        } else {
          seat.items = [];
        }
        for (var i = 0; i < seat.items.length; i++) {
          var it = seat.items[i];
          if (it.item_id) {
            it.seat_number = seat.number;
            itemsToSync.push(it);
          }
        }
      });

      // Remove seats emptied by a merge so their numbers are available for reuse.
      state.seats = state.seats.filter(function(s) { return s.items.length > 0; });

      // Handle extra columns (new seats added inside column-editor).
      var usedNumbers = state.seats.map(function(s) { return s.number; });
      newColumns.slice(sentIndices.length).forEach(function(col) {
        if (!col.isNewCheck) {
          var n = 1;
          while (usedNumbers.indexOf(n) >= 0) n++;
          usedNumbers.push(n);
          var newSeat = {
            id:     'S-' + String(n).padStart(3, '0'),
            number: n,
            items:  col.items,
          };
          state.seats.push(newSeat);
          for (var i = 0; i < col.items.length; i++) {
            if (col.items[i].item_id) {
              col.items[i].seat_number = n;
              itemsToSync.push(col.items[i]);
            }
          }
        } else {
          // New check column — collect seat numbers and hand off to backend split.
          var seatNums = col.items.map(function(it) { return it.seat_number; }).filter(Boolean);
          if (seatNums.length > 0) _callSplitBySeat(state, seatNums);
        }
      });

      // Sequence: patch item seat_numbers first, then PUT seat list.
      // persistSeats emits 'order:updated' which triggers a full refresh;
      // if that fires before item PATCHes complete, orderToSeats rebuilds
      // seats from stale item.seat_number values and resurrects cleared seats.
      var itemSync = itemsToSync.length > 0
        ? persistItemSeats(state, itemsToSync)
        : Promise.resolve();
      itemSync.then(function() { persistSeats(state); });

      state.selectedItems = {};
      state.selected      = {};
      rerenderTopArea(state);
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
      showBack:     !!state._landing,
      onBack:       function() {
        if (state._landing) SceneManager.mountWorking(state._landing, state._landingParams);
      },
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
        fetchWithTimeout('/api/v1/orders/' + state.orderId, {
          method:  'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify({ customer_name: name }),
        })
          .then(function(r) {
            if (!r.ok) showToast('Could not save name', { bg: T.verm });
          })
          .catch(function() { showToast('Could not save name', { bg: T.verm }); });
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
  // Use the already-built seatPayments cache; no extra fetch needed.
  var matches = state.seatPayments[seatId] || [];
  if (matches.length === 0) {
    showToast('No payment found for this seat', { bg: T.gold });
    return;
  }
  openSeatPaymentInterrupt(state, seatId, matches);
}

function openSeatPaymentInterrupt(state, seatId, payments) {
  SceneManager.interrupt('seat-payment', {
    seatId:   seatId,
    payments: payments,
    onConfirm: function(paymentId) {
      fetchWithTimeout(
        '/api/v1/orders/' + state.orderId + '/payments/' + paymentId + '/void',
        {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify({ reason: 'Voided from check overview' }),
        },
        8000
      ).then(function(r) {
        if (r.ok) {
          // Do not mutate paidSeats/seatPayments locally — let refreshOrder
          // repaint from the server's response so local state never races
          // ahead of backend truth.
          showToast('Payment voided', { bg: T.greenWarm });
          refreshOrder(state, {});
        } else {
          showToast('Void failed', { bg: T.verm });
        }
      }).catch(function() {
        showToast('Void failed', { bg: T.verm });
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
  state._refreshInFlight = true;

  // 15s abort guard — matches order-entry's send/recall fetches so a hung
  // backend doesn't leave the refresh indicator silently pending. The
  // existing catch already clears _refreshInFlight on rejection, so an
  // AbortError takes the same path as any other network failure.
  state._refreshPromise = fetchWithTimeout('/api/v1/orders/' + state.orderId, { cache: 'no-store' }, 15000)
    .then(function(r) { return r.ok ? r.json() : null; })
    .then(function(order) {
      state._refreshInFlight = false;
      if (!order) return;
      state.order = order;
      state.checkNumber  = order.check_number || '';
      state.customerName = order.customer_name || '';


      state.seats = orderToSeats(order, order.guest_count || 1);

      // Recompute paid seats from payment.seat_numbers (list of seat
      // numbers). Build seatPayments[seat.id] = [payment, ...] so the
      // UI can render per-seat payment rows without another fetch.
      state.paidSeats    = {};
      state.seatPayments = {};
      if (Array.isArray(order.payments)) {
        for (var p = 0; p < order.payments.length; p++) {
          var pmt = order.payments[p];
          if (pmt.status !== 'confirmed') continue;
          var seatNums = pmt.seat_numbers || [];
          for (var si = 0; si < state.seats.length; si++) {
            if (seatNums.indexOf(state.seats[si].number) < 0) continue;
            var sid = state.seats[si].id;
            state.paidSeats[sid] = true;
            if (!state.seatPayments[sid]) state.seatPayments[sid] = [];
            // De-duplicate by payment_id (a payment covering S1+S2
            // appears in both seats' lists).
            var dup = false;
            for (var qi = 0; qi < state.seatPayments[sid].length; qi++) {
              if (state.seatPayments[sid][qi].payment_id === pmt.payment_id) { dup = true; break; }
            }
            if (!dup) state.seatPayments[sid].push(pmt);
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
      state._refreshInFlight = false;
    })
    .finally(function() {
      // Clear the per-state cache so a later tap on the same check
      // (after payment, after refresh) re-fetches rather than handing
      // back the stale resolved promise.
      state._refreshPromise = null;
    });

  return state._refreshPromise;
}