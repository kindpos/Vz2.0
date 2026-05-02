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
  lightenHex,
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
// Pass state so cached discounts (_itemDiscounts / _seatDiscounts) are
// subtracted — the backend does not stamp effectivePrice per item after
// a discount POST, only updating the order-level total.
function seatTotal(seat, state) {
  var base = seatSubtotal(seat);
  if (!state || !seat) return base;
  // Whole-seat discount is the authoritative source when present — it already
  // accumulates all per-item amounts, so don't also sum _itemDiscounts.
  var sd = seat.id && state._seatDiscounts ? state._seatDiscounts[seat.id] : null;
  if (sd && sd.amount) {
    return Math.round((base - sd.amount) * 100) / 100;
  }
  // Item-level discounts (no seat-level entry means this is a targeted discount)
  if (state._itemDiscounts && seat.items) {
    for (var _i = 0; _i < seat.items.length; _i++) {
      var _id = state._itemDiscounts[seat.items[_i].item_id];
      if (_id && _id.amount) {
        base = Math.round((base - _id.amount) * 100) / 100;
      }
    }
  }
  return base;
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
      subtotal:   seatTotal(seat, state),
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
      subtotal:   seatTotal(seat, state),
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
  var totals = {
    subtotal:  order.gross_subtotal != null ? order.gross_subtotal : (order.subtotal || 0),
    discount:  order.manager_discount_total || 0,
    tax:       order.tax || 0,
    cardTotal: order.total || 0,
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
      discount:  totals.discount,
      upcharges: Math.round(totalUpcharges * 100) / 100,
      tax:       totals.tax,
      paid:      Math.round(paid * 100) / 100,
      total:     totals.cardTotal,
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

function collectSummary(seats, selected, paidSeats, state) {
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
    if (showHeaders) {
      items.push({ seatHeader: true, seatId: seats[i].id, seatTotal: seatTotal(seats[i], state), seatIdx: i });
    }
    for (var j = 0; j < seats[i].items.length; j++) {
      var it = seats[i].items[j];
      if (it.voided) continue;
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
  var taxRate  = getTaxRate();
  var tax      = subtotal * taxRate;
  var cardTotal = subtotal + tax;
  return {
    items:     items,
    subtotal:  Math.round(subtotal * 100) / 100,
    tax:       Math.round(tax * 100) / 100,
    cardTotal: Math.round(cardTotal * 100) / 100,
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
    get deleteSeat()              { return deleteSeat; },
    get toggleItem()              { return toggleItem; },
    get getSelectedSeatIds()      { return getSelectedSeatIds; },
    get getSelectedItemRefs()     { return getSelectedItemRefs; },
    get renderSeatsGrid()         { return renderSeatsGrid; },
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
    _mode:         null,
    _summaryItemMap:{},
    _osActive:     false,
    _mountParams:  null,
    _seatsChain:   null,
    _refreshInFlight: false,
    focusedSeats:  {},
    expandedSeats: {},
    _itemDiscounts: {},   // item_id → {pct, amount} — survives refreshOrder
    _voidedItems:   [],   // {seatNumber, item} re-injected after every refreshOrder
    _seatDiscounts: {},   // seat.id  → {pct, amount} — fallback when item_id absent
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

    state._alive        = true;
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
    state._mode         = null;
    state._osActive     = false;
    state._tileSelSet   = null;       // legacy — superseded by focusedSeats
    state.focusedSeats  = {};         // { seatId: true } — Mode B filter
    state.expandedSeats = {};         // { seatId: true } — Mode B collapsible
    state._itemDiscounts = {};
    state._voidedItems   = [];        // cleared on new mount; repopulated by _applyDiscount
    state._seatDiscounts = {};
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
      minHeight:     '140px',
      flexShrink:    '0',
      display:       'flex',
      pointerEvents: 'auto',
      margin:        '0 -12px',   // break out of body padding — matches header width
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

    return function cleanup() { state._alive = false; };
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
        ].join('') + ";font-weight:" + T.fwBold + ";";
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

        fetchWithTimeout('/api/v1/servers/clocked-in', {}, 10000)
          .then(function(r) { if (!r.ok) throw new Error(r.status); return r.json(); })
          .then(function(data) {
            if (!data || !Array.isArray(data.staff)) throw new Error('unexpected response');
            list.innerHTML = '';
            var staff = data.staff.filter(function(s) { return s.employee_id !== excludeId; });
            if (staff.length === 0) {
              var empty = document.createElement('div');
              empty.style.cssText = [
                'font-family:' + T.fb + ';',
                'font-size:' + T.fsB3 + ';',
                'color:' + T.text + ';',
                'opacity:0.55;',
                'text-align:center;padding:20px 0;',
              ].join('') + ";font-weight:" + T.fwBold + ";";
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
            ].join('') + ";font-weight:" + T.fwBold + ";";
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
          ].join('') + ";font-weight:" + T.fwBold + ";";
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
              ].join('') + ";font-weight:" + T.fwBold + ";";
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

  var order           = state.order || {};
  var discount        = getCashDiscount();
  var managerDiscount = order.manager_discount_total || 0;
  var bevelLt         = lightenHex(T.bg, 0.08);
  var bevelDk         = darkenHex(T.bg, 0.2);

  // ── Selection-aware totals ──
  var itemKeys    = Object.keys(state.selectedItems || {});
  var anyItemSel  = itemKeys.length > 0;
  var focusActive = !anyItemSel && Object.keys(state.focusedSeats || {}).length > 0;
  var subtotal, tax, total, cashTotal;

  if (anyItemSel) {
    subtotal = 0;
    for (var ki = 0; ki < itemKeys.length; ki++) {
      var parts   = itemKeys[ki].split(':');
      var sIdx    = parseInt(parts[0], 10);
      var iIdx    = parseInt(parts[1], 10);
      var selSeat = state.seats[sIdx];
      var selItem = selSeat && selSeat.items[iIdx];
      if (!selItem || selItem.voided) continue;
      var selPrice = selItem.effectivePrice != null ? selItem.effectivePrice : (selItem.price || 0);
      subtotal += (selItem.qty || 0) * selPrice;
    }
    tax       = subtotal * getTaxRate();
    total     = subtotal + tax;
    cashTotal = Math.round(total * (1 - discount) * 100) / 100;
  } else if (focusActive) {
    subtotal = 0;
    for (var _fi = 0; _fi < state.seats.length; _fi++) {
      var _fSeat = state.seats[_fi];
      if (!state.focusedSeats[_fSeat.id]) continue;
      if (state.paidSeats && state.paidSeats[_fSeat.id]) continue;
      for (var _fii = 0; _fii < _fSeat.items.length; _fii++) {
        var _fItem = _fSeat.items[_fii];
        if (_fItem.voided) continue;
        var _fPrice = _fItem.effectivePrice != null ? _fItem.effectivePrice : (_fItem.price || 0);
        subtotal += (_fItem.qty || 0) * _fPrice;
      }
    }
    subtotal  = Math.round(subtotal * 100) / 100;
    tax       = subtotal * getTaxRate();
    total     = subtotal + tax;
    cashTotal = Math.round(total * (1 - discount) * 100) / 100;
  } else {
    var _hasLocalVoid = state.seats.some(function(s) {
      return s.items.some(function(it) { return it.voided; });
    });
    if (_hasLocalVoid) {
      subtotal = 0;
      for (var _vi = 0; _vi < state.seats.length; _vi++) {
        for (var _vj = 0; _vj < state.seats[_vi].items.length; _vj++) {
          var _vit = state.seats[_vi].items[_vj];
          if (_vit.voided) continue;
          var _vp = _vit.effectivePrice != null ? _vit.effectivePrice : (_vit.price || 0);
          subtotal += (_vit.qty || 0) * _vp;
        }
      }
      subtotal  = Math.round(subtotal * 100) / 100;
      tax       = subtotal * getTaxRate();
      total     = subtotal + tax;
      cashTotal = Math.round(total * (1 - discount) * 100) / 100;
    } else {
      subtotal  = order.gross_subtotal != null ? order.gross_subtotal : (order.subtotal || 0);
      tax       = order.tax != null ? order.tax : (subtotal * getTaxRate());
      total     = order.total || 0;
      cashTotal = Math.round(total * (1 - discount) * 100) / 100;
    }
  }

  // ── Bar shell ──
  var bar = document.createElement('div');
  bar.style.height        = '116px';
  bar.style.flex          = '1';
  bar.style.flexShrink    = '0';
  bar.style.background    = T.well;
  bar.style.borderTop     = '2px solid ' + T.border;
  bar.style.display       = 'flex';
  bar.style.alignItems    = 'stretch';
  bar.style.gap           = '8px';
  bar.style.padding       = '6px 10px';
  bar.style.boxSizing     = 'border-box';
  barZone.appendChild(bar);

  // ── Left totals cluster ──
  var totalsWrap = document.createElement('div');
  totalsWrap.style.display    = 'flex';
  totalsWrap.style.gap        = '6px';
  totalsWrap.style.flexShrink = '0';
  totalsWrap.style.alignItems = 'stretch';

  function _totBox(opts) {
    var box = document.createElement('div');
    box.style.background    = T.card;
    box.style.borderTop     = '3px solid ' + bevelLt;
    box.style.borderLeft    = '4px solid ' + (opts.accent || T.gold);
    box.style.borderRight   = '3px solid ' + bevelDk;
    box.style.borderBottom  = '3px solid ' + bevelDk;
    box.style.borderRadius  = '8px';
    box.style.padding       = '8px 11px';
    box.style.display       = 'flex';
    box.style.flexDirection = 'column';
    box.style.justifyContent= 'center';
    box.style.gap           = opts.gap || '4px';
    if (opts.minWidth) box.style.minWidth = opts.minWidth;
    if (opts.flex) box.style.flex = opts.flex;
    return box;
  }

  function _totRow(lbl, val, valColor) {
    var row = document.createElement('div');
    row.style.display        = 'flex';
    row.style.justifyContent = 'space-between';
    row.style.alignItems     = 'baseline';
    row.style.gap            = '12px';
    var l = document.createElement('span');
    l.style.fontFamily = T.fb;
    l.style.fontWeight = T.fwBold;
    l.style.fontSize   = T.fsB3;
    l.style.color      = T.text;
    l.style.whiteSpace = 'nowrap';
    l.textContent = lbl;
    var v = document.createElement('span');
    v.style.fontFamily = T.fb;
    v.style.fontWeight = T.fwBold;
    v.style.fontSize   = '17px';
    v.style.color      = valColor || T.gold;
    v.textContent = val;
    row.appendChild(l); row.appendChild(v);
    return row;
  }

  // Sub/Disc/Tax box
  var subBox = _totBox({ minWidth: '168px', gap: '4px' });
  subBox.appendChild(_totRow('Subtotal:', fmt(subtotal), T.gold));
  if (managerDiscount > 0) {
    subBox.appendChild(_totRow('Discounts:', '-' + fmt(managerDiscount), T.lavender));
  }
  subBox.appendChild(_totRow('Tax:', fmt(tax), T.gold));
  totalsWrap.appendChild(subBox);

  // Total + Cash stacked
  var rightCol = document.createElement('div');
  rightCol.style.display       = 'flex';
  rightCol.style.flexDirection = 'column';
  rightCol.style.gap           = '6px';

  var totalBox = _totBox({ flex: '1', minWidth: '110px' });
  totalBox.appendChild(_totRow('Total:', fmt(total), T.gold));
  rightCol.appendChild(totalBox);

  var cashBox = _totBox({ flex: '1', minWidth: '110px', accent: T.greenWarm });
  cashBox.appendChild(_totRow('Cash:', fmt(cashTotal), T.greenWarm));
  rightCol.appendChild(cashBox);

  totalsWrap.appendChild(rightCol);
  bar.appendChild(totalsWrap);

  // ── Divider ──
  var barDiv = document.createElement('div');
  barDiv.style.width      = '1px';
  barDiv.style.background = T.border;
  barDiv.style.flexShrink = '0';
  barDiv.style.margin     = '2px 0';
  bar.appendChild(barDiv);

  // ── Action grid — 4 equal buttons ──
  var actionGrid = document.createElement('div');
  actionGrid.style.flex                = '1';
  actionGrid.style.display             = 'grid';
  actionGrid.style.gridTemplateColumns = 'repeat(4, 1fr)';
  actionGrid.style.gap                 = '7px';

  function _actBtn(opts) {
    var btn = document.createElement('div');
    btn.style.borderRadius   = '10px';
    btn.style.cursor         = 'pointer';
    btn.style.display        = 'flex';
    btn.style.flexDirection  = 'column';
    btn.style.alignItems     = 'center';
    btn.style.justifyContent = 'center';
    btn.style.fontFamily     = T.fh;
    btn.style.fontWeight     = T.fwBold;
    btn.style.letterSpacing  = '0.03em';
    btn.style.userSelect     = 'none';
    btn.style.touchAction    = 'manipulation';
    btn.style.gap            = '3px';
    btn.style.background     = opts.bg || T.card;
    btn.style.boxShadow      = '0 4px 0 ' + (opts.dk || T.moonDk);
    btn.style.color          = opts.color || T.text;
    btn.style.border         = opts.border || 'none';
    btn.style.transition     = 'transform 0.07s, box-shadow 0.07s';

    var lbl = document.createElement('span');
    lbl.style.fontSize   = opts.labelSize || '26px';
    lbl.style.lineHeight = '1.2';
    lbl.style.textAlign  = 'center';
    lbl.textContent      = opts.label;
    btn.appendChild(lbl);

    if (opts.sub !== undefined) {
      var sub = document.createElement('span');
      sub.style.fontFamily = T.fb;
      sub.style.fontSize   = T.fsB4;
      sub.style.fontWeight = T.fwBold;
      sub.style.opacity    = '0.65';
      sub.style.minHeight  = '14px';
      sub.textContent      = opts.sub || '';
      btn.appendChild(sub);
    }

    var baseShadow  = btn.style.boxShadow;
    var pressShadow = '0 1px 0 ' + (opts.dk || T.moonDk);
    btn.addEventListener('pointerdown', function() {
      btn.style.transform = 'translateY(3px)';
      btn.style.boxShadow = pressShadow;
    });
    var _up = function() { btn.style.transform = 'none'; btn.style.boxShadow = baseShadow; };
    btn.addEventListener('pointerup',     _up);
    btn.addEventListener('pointerleave',  _up);
    btn.addEventListener('pointercancel', _up);
    if (opts.onClick) btn.addEventListener('pointerup', function(e) {
      if (e.defaultPrevented) return;
      opts.onClick();
    });
    return btn;
  }

  var selCount = itemKeys.length;
  var paySubLabel = selCount > 0 ? '(' + selCount + ' items)' : '';

  actionGrid.appendChild(_actBtn({
    label:     'Pay',
    sub:       paySubLabel,
    bg:        T.gold,
    dk:        T.goldDk,
    color:     T.well,
    onClick:   function() { handlePay(state, state._params || {}); },
  }));

  // ── Print column: Print on top, Disc + Void sub-row on bottom ──
  var printCol = document.createElement('div');
  printCol.style.display       = 'flex';
  printCol.style.flexDirection = 'column';
  printCol.style.gap           = '5px';

  var printBtn = _actBtn({
    label:   'Print',
    bg:      T.elec,
    dk:      T.elecDk,
    color:   T.well,
    onClick: function() { handlePrint(state); },
  });
  printBtn.style.flex = '1';
  printCol.appendChild(printBtn);

  // Sub-row builder — shared press-state wiring
  function _subBtn(opts) {
    var btn = document.createElement('div');
    btn.style.flex          = '1';
    btn.style.borderRadius  = '8px';
    btn.style.cursor        = 'pointer';
    btn.style.display       = 'flex';
    btn.style.alignItems    = 'center';
    btn.style.justifyContent= 'center';
    btn.style.fontFamily    = T.fh;
    btn.style.fontWeight    = T.fwBold;
    btn.style.fontSize      = '13px';
    btn.style.letterSpacing = '0.04em';
    btn.style.userSelect    = 'none';
    btn.style.touchAction   = 'manipulation';
    btn.style.background    = opts.bg;
    btn.style.color         = opts.color;
    btn.style.transition    = 'transform 0.07s, box-shadow 0.07s';
    var baseShadow  = '0 3px 0 ' + opts.dk;
    var pressShadow = '0 1px 0 ' + opts.dk;
    btn.style.boxShadow = baseShadow;
    btn.textContent = opts.label;
    btn.addEventListener('pointerdown', function() {
      btn.style.transform = 'translateY(2px)';
      btn.style.boxShadow = pressShadow;
    });
    var _up = function() { btn.style.transform = 'none'; btn.style.boxShadow = baseShadow; };
    btn.addEventListener('pointerup',     _up);
    btn.addEventListener('pointerleave',  _up);
    btn.addEventListener('pointercancel', _up);
    if (opts.onClick) btn.addEventListener('pointerup', function(e) {
      if (e.defaultPrevented) return;
      opts.onClick();
    });
    return btn;
  }

  var subRow = document.createElement('div');
  subRow.style.display    = 'flex';
  subRow.style.gap        = '5px';
  subRow.style.flexShrink = '0';
  subRow.style.height     = '36px';

  subRow.appendChild(_subBtn({
    label:   'Disc',
    bg:      T.lavender,
    dk:      darkenHex(T.lavender, 0.45),
    color:   T.well,
    onClick: function() { handleDiscount(state); },
  }));

  subRow.appendChild(_subBtn({
    label:   'Void',
    bg:      T.verm,
    dk:      T.vermDk,
    color:   '#fff',
    onClick: function() { handleVoid(state); },
  }));

  printCol.appendChild(subRow);
  actionGrid.appendChild(printCol);

  actionGrid.appendChild(_actBtn({
    label:     'Edit\nSeats',
    labelSize: '18px',
    sub:       '',
    bg:        T.card,
    dk:        T.moonDk,
    color:     T.text,
    border:    '1px solid ' + T.border,
    onClick:   function() { openEditSeats(state); },
  }));

  actionGrid.appendChild(_actBtn({
    label:   'Add Items',
    labelSize: '22px',
    sub:     '',
    bg:      T.greenWarm,
    dk:      T.greenWarmDk,
    color:   T.well,
    onClick: function() { handleAddItems(state, state._params || {}); },
  }));

  bar.appendChild(actionGrid);
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
    flex:          '1',
    minHeight:     '0',
    display:       'flex',
    flexDirection: 'column',
    overflow:      'visible',
    position:      'relative',
  });

  var activeCount = activeSeatCount(state.seats, state.paidSeats);
  var mode = activeCount <= 4 ? 'A' : 'B';

  var body = document.createElement('div');
  Object.assign(body.style, {
    display:       'flex',
    flexDirection: 'row',
    gap:           '8px',
    padding:       '8px',
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

  var savedRecapScroll = state._scrollListEl ? state._scrollListEl.scrollTop : 0;

  var top = state.topAreaEl;
  top.innerHTML = '';
  state.seatEls = {};

  for (var t = 0; t < state._lpTimers.length; t++) clearTimeout(state._lpTimers[t]);
  state._lpTimers = [];

  var shell = buildSeatsContainer(state);
  top.appendChild(shell.root);

  renderSeatsGrid(state, shell.body, shell.mode);
  if (state._scrollListEl) state._scrollListEl.scrollTop = savedRecapScroll;

  renderActionBar(state);
}

function renderSeatsGrid(state, container, mode) {
  container.innerHTML = '';

  // ── Mode B: collapsible recap LEFT + tile grid RIGHT ──
  if (mode === 'B') {
    var focusedSeats = state.focusedSeats || (state.focusedSeats = {});
    var expandedSeats = state.expandedSeats || (state.expandedSeats = {});
    var bevelLt = lightenHex(T.bg, 0.08);
    var bevelDk = darkenHex(T.bg, 0.2);

    // ── LEFT: recap shell ──────────────────────────────
    var recapShell = document.createElement('div');
    recapShell.style.flex          = '0 0 360px';
    recapShell.style.width         = '360px';
    recapShell.style.display       = 'flex';
    recapShell.style.flexDirection = 'column';
    recapShell.style.overflow      = 'hidden';
    recapShell.style.background    = T.well;
    recapShell.style.border        = '3px solid ' + bevelLt;
    recapShell.style.borderLeft    = '3px solid ' + bevelDk;
    recapShell.style.borderBottom  = '3px solid ' + bevelDk;
    recapShell.style.borderRadius  = T.chamferCard + 'px';

    var scrollArea = document.createElement('div');
    scrollArea.style.display      = 'block';
    scrollArea.style.overflowY    = 'auto';
    scrollArea.style.flex         = '1';
    scrollArea.style.minHeight    = '0';
    scrollArea.style.scrollbarWidth = 'none';
    scrollArea.style.msOverflowStyle = 'none';
    scrollArea.style.touchAction    = 'pan-y';
    scrollArea.style.pointerEvents  = 'auto';
    state._scrollListEl = scrollArea;

    // Determine visible seats
    var visibleSeats = state.seats.filter(function(s) {
      if (state.paidSeats[s.id]) return false;
      if (Object.keys(focusedSeats).length > 0 && !focusedSeats[s.id]) return false;
      return true;
    });

    for (var rsi = 0; rsi < visibleSeats.length; rsi++) {
      var rSeat      = visibleSeats[rsi];
      var rSeatIdx   = state.seats.indexOf(rSeat);
      var isExpanded = !!expandedSeats[rSeat.id];
      var hasDisc    = _seatHasDisc(rSeat, state);

      // Collapsible seat card
      var sCard = document.createElement('div');
      sCard.style.borderBottom = '1px solid ' + bevelDk;
      sCard.style.borderLeft   = '3px solid ' + (hasDisc ? T.lavender : T.green);

      // Seat card header
      var sHdr = document.createElement('div');
      sHdr.style.display         = 'flex';
      sHdr.style.alignItems      = 'baseline';
      sHdr.style.justifyContent  = 'space-between';
      sHdr.style.padding         = '8px 12px';
      sHdr.style.background      = T.well;
      sHdr.style.cursor          = 'pointer';
      sHdr.style.userSelect      = 'none';
      sHdr.style.pointerEvents   = 'auto';
      sHdr.style.touchAction     = 'manipulation';

      var sHdrLeft = document.createElement('div');
      sHdrLeft.style.display    = 'flex';
      sHdrLeft.style.alignItems = 'baseline';
      sHdrLeft.style.gap        = '8px';

      var sNum = document.createElement('span');
      sNum.textContent      = 'S' + (rSeat.number != null ? rSeat.number : (rSeatIdx + 1));
      sNum.style.fontFamily = T.fh;
      sNum.style.fontWeight = T.fwBold;
      sNum.style.fontSize   = '20px';
      sNum.style.color      = hasDisc ? T.lavender : T.green;
      sHdrLeft.appendChild(sNum);

      var sSbtl = document.createElement('span');
      sSbtl.textContent      = fmt(seatTotal(rSeat, state));
      sSbtl.style.fontFamily = T.fb;
      sSbtl.style.fontWeight = T.fwBold;
      sSbtl.style.fontSize   = '14px';
      sSbtl.style.color      = hasDisc ? T.lavender : T.gold;
      sHdrLeft.appendChild(sSbtl);
      sHdr.appendChild(sHdrLeft);

      var sHdrRight = document.createElement('div');
      sHdrRight.style.display    = 'flex';
      sHdrRight.style.alignItems = 'baseline';
      sHdrRight.style.gap        = '8px';

      if (rSeat.name) {
        var sPname = document.createElement('span');
        sPname.textContent      = '"' + rSeat.name + '"';
        sPname.style.fontFamily = T.fb;
        sPname.style.fontSize   = T.fsB4;
        sPname.style.color      = T.text;
        sPname.style.fontStyle  = 'italic';
        sHdrRight.appendChild(sPname);
      }

      var chevron = document.createElement('span');
      chevron.textContent      = '▸';
      chevron.style.fontFamily = T.fb;
      chevron.style.fontSize   = T.fsB3;
      chevron.style.color      = T.moon;
      chevron.style.transition = 'transform 0.15s';
      chevron.style.display    = 'inline-block';
      if (isExpanded) chevron.style.transform = 'rotate(90deg)';
      sHdrRight.appendChild(chevron);

      var canDeleteRecap = rSeat.items.length === 0
        && activeSeatCount(state.seats, state.paidSeats) > 1;
      if (canDeleteRecap) {
        var sDelBtn = _buildDeleteSeatX(state, rSeat.id);
        sDelBtn.style.position  = 'relative';
        sDelBtn.style.top       = 'auto';
        sDelBtn.style.right     = 'auto';
        sDelBtn.style.alignSelf = 'center';
        sHdrRight.appendChild(sDelBtn);
      }

      sHdr.appendChild(sHdrRight);

      (function(capturedId) {
        sHdr.addEventListener('pointerup', function(e) {
          if (e.defaultPrevented) return;
          if (state.expandedSeats[capturedId]) delete state.expandedSeats[capturedId];
          else state.expandedSeats[capturedId] = true;
          rerenderTopArea(state);
        });
      })(rSeat.id);
      sCard.appendChild(sHdr);

      // Items wrapper — collapses/expands
      var itemsWrap = document.createElement('div');
      itemsWrap.style.overflow      = 'hidden';
      itemsWrap.style.maxHeight     = isExpanded ? '1500px' : '0';
      itemsWrap.style.transition    = 'max-height 0.2s ease';
      itemsWrap.style.pointerEvents = isExpanded ? 'auto' : 'none';

      var itemsInner = document.createElement('div');
      itemsInner.style.padding       = '6px 8px 8px';
      itemsInner.style.display       = 'flex';
      itemsInner.style.flexDirection = 'column';
      itemsInner.style.gap           = '5px';

      for (var rii = 0; rii < rSeat.items.length; rii++) {
        itemsInner.appendChild(buildItemBlock(state, rSeatIdx, rii, true));
      }
      itemsWrap.appendChild(itemsInner);
      sCard.appendChild(itemsWrap);
      scrollArea.appendChild(sCard);
    }
    recapShell.appendChild(scrollArea);
    container.appendChild(recapShell);

    // ── RIGHT: 480px tile grid ──────────────────────
    var tilesCol = document.createElement('div');
    tilesCol.style.flex          = '1';
    tilesCol.style.minWidth      = '0';
    tilesCol.style.display       = 'flex';
    tilesCol.style.flexDirection = 'column';
    tilesCol.style.gap           = '6px';
    tilesCol.style.minHeight     = '0';

    var tilesGrid = document.createElement('div');
    tilesGrid.style.flex                 = '1';
    tilesGrid.style.minHeight            = '0';
    tilesGrid.style.display              = 'grid';
    tilesGrid.style.gridTemplateColumns  = 'repeat(4, 1fr)';
    tilesGrid.style.gap                  = '6px';
    tilesGrid.style.overflowY            = 'auto';
    tilesGrid.style.alignContent         = 'start';
    tilesGrid.style.scrollbarWidth       = 'none';
    tilesGrid.style.msOverflowStyle      = 'none';
    tilesGrid.style.touchAction          = 'pan-y';
    tilesGrid.style.pointerEvents        = 'auto';

    // Paid tiles first
    for (var pti = 0; pti < state.seats.length; pti++) {
      if (!state.paidSeats[state.seats[pti].id]) continue;
      var pTile = buildPaidCompactTile(state, pti);
      tilesGrid.appendChild(pTile);
    }

    // Unpaid seat tiles
    for (var ti = 0; ti < state.seats.length; ti++) {
      if (state.paidSeats[state.seats[ti].id]) continue;
      var tSeat    = state.seats[ti];
      var tActive  = !!focusedSeats[tSeat.id];
      var tHasDisc = _seatHasDisc(tSeat, state);

      var tile = document.createElement('div');
      tile.style.background    = tActive ? T.green : T.card;
      tile.style.border        = '1px solid ' + (tActive ? T.greenDk : T.border);
      tile.style.borderLeft    = '3px solid ' + (tActive ? T.greenDk : (tHasDisc ? T.lavender : T.green));
      tile.style.boxShadow     = '0 2px 0 ' + (tActive ? T.greenDk : T.moonDk);
      tile.style.borderRadius  = '8px';
      tile.style.padding       = '8px 10px';
      tile.style.cursor        = 'pointer';
      tile.style.userSelect    = 'none';
      tile.style.pointerEvents = 'auto';
      tile.style.touchAction   = 'manipulation';
      tile.style.position      = 'relative';
      tile.style.display       = 'flex';
      tile.style.flexDirection = 'column';
      tile.style.alignItems    = 'center';
      tile.style.justifyContent = 'center';
      tile.style.gap           = '3px';

      var tNum = document.createElement('span');
      tNum.textContent      = 'S' + (tSeat.number != null ? tSeat.number : (ti + 1));
      tNum.style.fontFamily = T.fh;
      tNum.style.fontWeight = T.fwBold;
      tNum.style.fontSize   = '18px';
      tNum.style.color      = tActive ? T.well : T.green;
      tile.appendChild(tNum);

      if (tSeat.name) {
        var tName = document.createElement('span');
        tName.textContent      = '"' + tSeat.name + '"';
        tName.style.fontFamily = T.fb;
        tName.style.fontSize   = T.fsB4;
        tName.style.color      = tActive ? T.well : T.text;
        tName.style.fontStyle  = 'italic';
        tile.appendChild(tName);
      }

      var tTotal = document.createElement('span');
      tTotal.textContent      = fmt(seatTotal(tSeat, state));
      tTotal.style.fontFamily = T.fb;
      tTotal.style.fontWeight = T.fwBold;
      tTotal.style.fontSize   = T.fsB3;
      tTotal.style.color      = tActive ? T.well : T.gold;
      tile.appendChild(tTotal);

      (function(capturedSeat) {
        tile.addEventListener('pointerup', function(e) {
          if (e.defaultPrevented) return;
          if (state.focusedSeats[capturedSeat.id]) delete state.focusedSeats[capturedSeat.id];
          else state.focusedSeats[capturedSeat.id] = true;
          rerenderTopArea(state);
        });
      })(tSeat);

      if (tSeat.items.length === 0 && activeSeatCount(state.seats, state.paidSeats) > 1) {
        tile.appendChild(_buildDeleteSeatX(state, tSeat.id));
      }

      tilesGrid.appendChild(tile);
    }

    // +SEAT add tile
    var addTileB = buildAddTile(state, { fullSize: true });
    tilesGrid.appendChild(addTileB);

    tilesCol.appendChild(tilesGrid);
    container.appendChild(tilesCol);
    return;
  }

  // ── Mode A: each seat is an equal flex-row column ──
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

// ═══════════════════════════════════════════════════
//  ITEM BLOCK — Nostalgia item card + mod tree
//  Shared between Mode A columns and Mode B recap.
//  modeB=true → sent item uses all-4-borders green;
//  modeB=false → sent uses left-border only.
// ═══════════════════════════════════════════════════

// Seat-level discount detection — mirrors the item-level broadened check in
// buildItemBlock. Returns true if any item has an explicit discount object OR
// has an effectivePrice meaningfully below its list price.
function _seatHasDisc(seat, state) {
  var _id = (state && state._itemDiscounts) ? state._itemDiscounts : null;
  var _sd = (state && state._seatDiscounts) ? state._seatDiscounts : null;
  // Fastest path: seat-level cache stamped by _applyDiscount
  if (_sd && seat.id && _sd[seat.id]) return true;
  return seat.items.some(function(it) {
    if (it.discount) return true;
    if (_id && it.item_id && _id[it.item_id]) return true;
    var raw = it.price || 0;
    var eff = it.effectivePrice != null ? it.effectivePrice : raw;
    return raw > 0 && (raw - eff) > 0.005;
  });
}

function buildItemBlock(state, seatIdx, itemIdx, modeB) {
  var item     = state.seats[seatIdx].items[itemIdx];
  var isVoided = !!item.voided;
  // Detect discount from explicit object OR from effectivePrice being lower than
  // the list price — the backend may only surface the discount at the order level
  // and not stamp a `discount` object on individual items after refresh.
  var _rawPrice   = item.price || 0;
  var _effPrice   = item.effectivePrice != null ? item.effectivePrice : _rawPrice;
  var _priceDelta = Math.round((_rawPrice - _effPrice) * 100) / 100;
  // Third/fourth detection paths: per-item and per-seat caches stamped by _applyDiscount.
  // The seat-level cache is the more reliable fallback since it doesn't depend on item_id.
  var _seatId     = state.seats[seatIdx] ? state.seats[seatIdx].id : null;
  var _stateDisc  = (state._itemDiscounts && item.item_id)
    ? (state._itemDiscounts[item.item_id] || null)
    : null;
  var _seatDisc   = (state._seatDiscounts && _seatId)
    ? (state._seatDiscounts[_seatId] || null)
    : null;
  var isDisc      = !!(item.discount) || (_priceDelta > 0.005) || !!_stateDisc || !!_seatDisc;
  // Prefer explicit discount object, then state cache, then price delta.
  var _discObj    = item.discount || null;
  var _itemCount  = state.seats[seatIdx] ? Math.max(state.seats[seatIdx].items.length, 1) : 1;
  var _discAmt    = _discObj
    ? (_discObj.amount || 0)
    : _stateDisc
    ? _stateDisc.amount
    : _seatDisc
    ? Math.round(_seatDisc.amount / _itemCount * 100) / 100
    : Math.round(_priceDelta * (item.qty || 1) * 100) / 100;
  var _discPctRaw = _discObj && _discObj.pct != null
    ? _discObj.pct
    : (_discObj && _discObj.label ? parseInt(_discObj.label, 10) : null);
  if (_discPctRaw == null) _discPctRaw = _stateDisc ? _stateDisc.pct : null;
  if (_discPctRaw == null) _discPctRaw = _seatDisc  ? _seatDisc.pct  : null;
  if (_discPctRaw == null && _rawPrice > 0 && _priceDelta > 0.005) {
    _discPctRaw = Math.round((_priceDelta / _rawPrice) * 100);
  }
  var isSent   = !!(item.sent_at || item.sent) && !isVoided;
  var isSel    = !isVoided && !!(state.selectedItems && state.selectedItems[seatIdx + ':' + itemIdx]);

  var bevelLt = lightenHex(T.bg, 0.08);
  var bevelDk = darkenHex(T.bg, 0.2);

  // ── Item card ──────────────────────────────────────
  var card = document.createElement('div');
  card.style.background    = isSel ? T.green : T.well;
  card.style.borderTop     = '2px solid ' + (isSel ? T.greenDk : bevelLt);
  card.style.borderRight   = '2px solid ' + (isSel ? T.greenDk : bevelDk);
  card.style.borderBottom  = '2px solid ' + (isSel ? T.greenDk : bevelDk);
  card.style.borderRadius  = '8px';
  card.style.padding       = '6px 10px';
  card.style.cursor        = isVoided ? 'default' : 'pointer';
  card.style.pointerEvents = 'auto';
  card.style.touchAction   = 'manipulation';
  card.style.userSelect    = 'none';

  // Left border priority: selected > voided > discounted > sent > default
  var leftColor, leftShadow;
  if (isSel) {
    leftColor  = T.greenDk;
    leftShadow = '0 2px 0 ' + T.greenDk;
  } else if (isVoided) {
    leftColor  = T.verm;
    leftShadow = '0 2px 0 ' + T.vermDk;
  } else if (isDisc) {
    leftColor  = T.lavender;
    leftShadow = '0 2px 0 ' + darkenHex(T.lavender, 0.3);
  } else if (isSent) {
    leftColor  = T.green;
    leftShadow = '0 2px 0 ' + T.greenDk;
  } else {
    leftColor  = T.moon;
    leftShadow = null;
  }
  card.style.borderLeft = '3px solid ' + leftColor;
  if (leftShadow) card.style.boxShadow = leftShadow;

  // Mode B sent: all-4-borders green (unless discounted or selected)
  if (modeB && isSent && !isSel && !isDisc) {
    card.style.borderTop    = '2px solid ' + T.green;
    card.style.borderRight  = '2px solid ' + T.green;
    card.style.borderBottom = '2px solid ' + T.green;
  }

  // ── Name + price row ──
  var mainRow = document.createElement('div');
  mainRow.style.display        = 'flex';
  mainRow.style.justifyContent = 'space-between';
  mainRow.style.alignItems     = 'center';
  mainRow.style.gap            = '6px';

  // Left cluster: name + optional discount badge
  var nameCluster = document.createElement('span');
  nameCluster.style.display    = 'flex';
  nameCluster.style.alignItems = 'center';
  nameCluster.style.gap        = '6px';
  nameCluster.style.flex       = '1';
  nameCluster.style.minWidth   = '0';

  var nameEl = document.createElement('span');
  nameEl.style.fontFamily   = T.fb;
  nameEl.style.fontWeight   = T.fwBold;
  nameEl.style.fontSize     = modeB ? '14px' : T.fsB3;
  nameEl.style.color        = isSel ? T.well : (isVoided ? T.moon : T.text);
  nameEl.style.fontStyle    = isVoided ? 'italic' : 'normal';
  nameEl.style.opacity      = isVoided ? '0.6' : '1';
  nameEl.style.whiteSpace   = 'nowrap';
  nameEl.style.overflow     = 'hidden';
  nameEl.style.textOverflow = 'ellipsis';
  nameEl.textContent = (item.qty > 1 ? item.qty + '× ' : '') + item.name;
  nameCluster.appendChild(nameEl);

  // Discount percentage badge shown inline next to name when discounted
  if (isDisc) {
    var badgeText = _discPctRaw != null ? _discPctRaw + '% OFF' : 'DISC';

    var discBadge = document.createElement('span');
    discBadge.style.fontFamily    = T.fh;
    discBadge.style.fontWeight    = T.fwBold;
    discBadge.style.fontSize      = '10px';
    discBadge.style.letterSpacing = '0.06em';
    discBadge.style.color         = isSel ? T.well : T.lavender;
    discBadge.style.background    = isSel ? hexToRgba(T.lavender, 0.35) : hexToRgba(T.lavender, 0.18);
    discBadge.style.border        = '1px solid ' + (isSel ? hexToRgba(T.lavender, 0.5) : hexToRgba(T.lavender, 0.45));
    discBadge.style.borderRadius  = '4px';
    discBadge.style.padding       = '1px 5px';
    discBadge.style.flexShrink    = '0';
    discBadge.style.whiteSpace    = 'nowrap';
    discBadge.textContent         = badgeText;
    nameCluster.appendChild(discBadge);
  }

  // Void badge — shown inline next to name
  if (isVoided) {
    var voidBadge = document.createElement('span');
    voidBadge.style.fontFamily    = T.fh;
    voidBadge.style.fontWeight    = T.fwBold;
    voidBadge.style.fontSize      = '10px';
    voidBadge.style.letterSpacing = '0.06em';
    voidBadge.style.color         = T.verm;
    voidBadge.style.background    = hexToRgba(T.verm, 0.12);
    voidBadge.style.border        = '1px solid ' + hexToRgba(T.verm, 0.4);
    voidBadge.style.borderRadius  = '4px';
    voidBadge.style.padding       = '1px 5px';
    voidBadge.style.flexShrink    = '0';
    voidBadge.style.whiteSpace    = 'nowrap';
    voidBadge.textContent         = 'VOID';
    nameCluster.appendChild(voidBadge);
  }

  mainRow.appendChild(nameCluster);

  var priceEl = document.createElement('span');
  priceEl.style.fontFamily      = T.fb;
  priceEl.style.fontWeight      = T.fwBold;
  priceEl.style.fontSize        = modeB ? '14px' : T.fsB3;
  priceEl.style.color           = isSel ? T.well : (isVoided ? T.moon : T.gold);
  priceEl.style.flexShrink      = '0';
  priceEl.style.textDecoration  = isVoided ? 'line-through' : 'none';
  priceEl.style.opacity         = isVoided ? '0.6' : '1';
  var ep = item.effectivePrice != null ? item.effectivePrice : (item.price || 0);
  priceEl.textContent = fmt((item.qty || 1) * ep);
  mainRow.appendChild(priceEl);
  card.appendChild(mainRow);

  // ── Discount row — original price (struck) + savings amount ──
  if (isDisc) {
    var discRow = document.createElement('div');
    discRow.style.display        = 'flex';
    discRow.style.justifyContent = 'space-between';
    discRow.style.alignItems     = 'baseline';
    discRow.style.gap            = '6px';
    discRow.style.marginTop      = '3px';
    discRow.style.paddingTop     = '2px';

    var origPrice = _rawPrice;
    var discOrig = document.createElement('span');
    discOrig.style.fontFamily     = T.fb;
    discOrig.style.fontSize       = T.fsB4;
    discOrig.style.color          = isSel ? hexToRgba(T.well, 0.6) : hexToRgba(T.lavender, 0.6);
    discOrig.style.textDecoration = 'line-through';
    discOrig.style.flex           = '1';
    discOrig.textContent          = 'was ' + fmt((item.qty || 1) * origPrice);
    discRow.appendChild(discOrig);

    var discAmt = document.createElement('span');
    discAmt.style.fontFamily = T.fb;
    discAmt.style.fontSize   = T.fsB4;
    discAmt.style.fontWeight = T.fwBold;
    discAmt.style.color      = isSel ? T.well : T.lavender;
    discAmt.textContent      = '-' + fmt(_discAmt);
    discRow.appendChild(discAmt);
    card.appendChild(discRow);
  }

  if (!isVoided) {
    card.addEventListener('pointerup', function(e) {
      if (e.defaultPrevented) return;
      toggleItem(state, seatIdx, itemIdx);
    });
  }

  // ── Mod tree ──────────────────────────────────────
  var mods = item.mods || [];
  var block = document.createElement('div');
  block.style.display       = 'flex';
  block.style.flexDirection = 'column';
  block.appendChild(card);

  if (mods.length > 0) {
    var tree = document.createElement('div');
    tree.style.position    = 'relative';
    tree.style.display     = 'flex';
    tree.style.flexDirection = 'column';
    tree.style.gap         = '3px';
    tree.style.marginTop   = '4px';
    tree.style.marginLeft  = '10px';
    tree.style.paddingLeft = '16px';

    // Vertical stem — always T.text
    var stem = document.createElement('div');
    stem.style.position   = 'absolute';
    stem.style.left       = '6px';
    stem.style.top        = '0';
    stem.style.bottom     = '12px';
    stem.style.width      = '2px';
    stem.style.background = T.text;
    tree.appendChild(stem);

    for (var mi = 0; mi < mods.length; mi++) {
      var mod = mods[mi];
      var entry = document.createElement('div');
      entry.style.position   = 'relative';
      entry.style.display    = 'flex';
      entry.style.alignItems = 'center';
      entry.style.gap        = '5px';

      // Horizontal branch — always T.text
      var branch = document.createElement('div');
      branch.style.position   = 'absolute';
      branch.style.left       = '-10px';
      branch.style.top        = '50%';
      branch.style.width      = '10px';
      branch.style.height     = '2px';
      branch.style.background = T.text;
      entry.appendChild(branch);

      // Pill borders change by state, connectors stay white
      var pill = document.createElement('div');
      pill.style.flex            = '1';
      pill.style.display         = 'flex';
      pill.style.alignItems      = 'baseline';
      pill.style.justifyContent  = 'space-between';
      pill.style.gap             = '6px';
      pill.style.padding         = '3px 8px';
      pill.style.background      = T.card;
      pill.style.borderRadius    = '6px';

      if (isVoided) {
        pill.style.borderLeft   = '1px solid ' + hexToRgba(T.verm, 0.5);
        pill.style.borderTop    = '1px solid ' + hexToRgba(T.verm, 0.3);
        pill.style.borderRight  = '1px solid ' + bevelDk;
        pill.style.borderBottom = '1px solid ' + bevelDk;
      } else if (isDisc) {
        pill.style.borderLeft   = '1px solid ' + T.lavender;
        pill.style.borderTop    = '1px solid ' + hexToRgba(T.lavender, 0.4);
        pill.style.borderRight  = '1px solid ' + bevelDk;
        pill.style.borderBottom = '1px solid ' + bevelDk;
        pill.style.boxShadow    = '0 2px 0 ' + darkenHex(T.lavender, 0.3);
      } else if (isSent) {
        pill.style.border = '1px solid ' + hexToRgba(T.green, 0.4);
      } else {
        pill.style.borderTop    = '1px solid ' + bevelLt;
        pill.style.borderLeft   = '1px solid ' + bevelLt;
        pill.style.borderRight  = '1px solid ' + bevelDk;
        pill.style.borderBottom = '1px solid ' + bevelDk;
      }

      var modName = document.createElement('span');
      modName.style.fontFamily = T.fb;
      modName.style.fontSize   = modeB ? '11px' : T.fsB4;
      modName.style.fontStyle  = 'italic';
      modName.style.color      = isVoided ? T.moon : T.text;
      modName.textContent      = mod.name || '';
      pill.appendChild(modName);

      if (mod.charged && mod.price > 0) {
        var modPrice = document.createElement('span');
        modPrice.style.fontFamily = T.fb;
        modPrice.style.fontSize   = modeB ? '11px' : T.fsB4;
        modPrice.style.fontWeight = T.fwBold;
        modPrice.style.color      = isVoided ? T.moon : T.gold;
        modPrice.style.flexShrink = '0';
        modPrice.textContent      = '+' + fmt(mod.price);
        pill.appendChild(modPrice);
      }

      entry.appendChild(pill);
      tree.appendChild(entry);
    }
    block.appendChild(tree);
  }

  // ── Sent-row wrapper (narrows block, adds >>> info) — Mode A only ──
  // Mode B uses the all-4-borders treatment on the card itself instead.
  if (isSent && !modeB) {
    var sentRow = document.createElement('div');
    sentRow.style.display    = 'flex';
    sentRow.style.alignItems = 'stretch';

    block.style.width    = '50%';
    block.style.minWidth = '170px';

    sentRow.appendChild(block);

    var info = document.createElement('div');
    info.style.display        = 'flex';
    info.style.flexDirection  = 'column';
    info.style.alignItems     = 'center';
    info.style.justifyContent = 'center';
    info.style.paddingLeft    = '8px';
    info.style.gap            = '4px';

    var chevron = document.createElement('span');
    chevron.style.fontFamily    = T.fb;
    chevron.style.fontWeight    = T.fwBold;
    chevron.style.fontSize      = modeB ? '36px' : '18px';
    chevron.style.color         = isDisc ? T.lavender : T.green;
    chevron.style.letterSpacing = '0.08em';
    chevron.style.lineHeight    = '1';
    chevron.textContent         = '>>>';
    info.appendChild(chevron);

    if (item.sent_at) {
      // Parse ISO or HH:MM string to a compact 12-hr time label.
      var _sentLabel = (function(raw) {
        var d = new Date(raw);
        if (!isNaN(d.getTime())) {
          var h = d.getHours(), m = d.getMinutes();
          var ampm = h >= 12 ? 'PM' : 'AM';
          h = h % 12 || 12;
          return h + ':' + (m < 10 ? '0' : '') + m + ' ' + ampm;
        }
        // Fallback: already a short string (e.g. '2:15 PM')
        return raw;
      })(item.sent_at);
      var sentTime = document.createElement('span');
      sentTime.style.fontFamily  = T.fb;
      sentTime.style.fontSize    = '11px';
      sentTime.style.color       = isDisc ? hexToRgba(T.lavender, 0.7) : T.moon;
      sentTime.style.whiteSpace  = 'nowrap';
      sentTime.textContent       = _sentLabel;
      info.appendChild(sentTime);
    }

    sentRow.appendChild(info);
    return sentRow;   // return the row wrapper, not the block
  }

  return block;
}

function _buildItemSubCard(state, seatIdx, itemIdx) {
  // Legacy shim — delegates to buildItemBlock for any remaining callers.
  return buildItemBlock(state, seatIdx, itemIdx, false);
}

function buildSeatCard(state, seatIdx) {
  var seat     = state.seats[seatIdx];
  var bevelLt  = lightenHex(T.bg, 0.08);
  var bevelDk  = darkenHex(T.bg, 0.2);
  var hasDisc  = _seatHasDisc(seat, state);

  var card = document.createElement('div');
  card.style.position      = 'relative';
  card.style.flex          = '1';
  card.style.minWidth      = '0';
  card.style.display       = 'flex';
  card.style.flexDirection = 'column';
  card.style.overflowY     = 'auto';
  card.style.overflowX     = 'hidden';
  card.style.background    = T.card;
  card.style.borderTop     = '3px solid ' + bevelLt;
  card.style.borderLeft    = '4px solid ' + (isSeatSel ? T.greenDk : (hasDisc ? T.lavender : T.green));
  card.style.borderRight   = '3px solid ' + bevelDk;
  card.style.borderBottom  = '3px solid ' + bevelDk;
  card.style.borderRadius  = T.chamferCard + 'px';
  card.style.scrollbarWidth     = 'none';
  card.style.msOverflowStyle    = 'none';
  card.style.touchAction        = 'pan-y';
  card.style.pointerEvents      = 'auto';

  // ── Sticky header ──
  var isSeatSel = !!(state.selected && state.selected[seat.id]);

  var hdr = document.createElement('div');
  hdr.style.position      = 'sticky';
  hdr.style.top           = '0';
  hdr.style.zIndex        = '2';
  hdr.style.background    = isSeatSel ? T.green : T.well;
  hdr.style.padding       = '8px 12px';
  hdr.style.borderBottom  = '2px solid ' + (isSeatSel ? T.greenDk : bevelDk);
  hdr.style.display       = 'flex';
  hdr.style.alignItems    = 'baseline';
  hdr.style.justifyContent = 'space-between';
  hdr.style.cursor        = 'pointer';
  hdr.style.userSelect    = 'none';
  hdr.style.pointerEvents = 'auto';
  hdr.style.touchAction   = 'manipulation';
  hdr.style.flexShrink    = '0';

  var hdrLeft = document.createElement('div');
  hdrLeft.style.display    = 'flex';
  hdrLeft.style.alignItems = 'baseline';
  hdrLeft.style.gap        = '8px';

  var seatNum = document.createElement('span');
  seatNum.textContent      = 'S' + (seat.number != null ? seat.number : (seatIdx + 1));
  seatNum.style.fontFamily = T.fh;
  seatNum.style.fontWeight = T.fwBold;
  seatNum.style.fontSize   = '24px';
  seatNum.style.color      = isSeatSel ? T.well : (hasDisc ? T.lavender : T.green);
  hdrLeft.appendChild(seatNum);

  var seatSbtl = document.createElement('span');
  seatSbtl.textContent      = fmt(seatTotal(seat, state));
  seatSbtl.style.fontFamily = T.fb;
  seatSbtl.style.fontWeight = T.fwBold;
  seatSbtl.style.fontSize   = '17px';
  seatSbtl.style.color      = isSeatSel ? T.well : (hasDisc ? T.lavender : T.gold);
  hdrLeft.appendChild(seatSbtl);
  hdr.appendChild(hdrLeft);

  if (seat.name) {
    var seatPname = document.createElement('span');
    seatPname.textContent      = '"' + seat.name + '"';
    seatPname.style.fontFamily = T.fb;
    seatPname.style.fontSize   = T.fsB4;
    seatPname.style.color      = T.text;
    seatPname.style.fontStyle  = 'italic';
    hdr.appendChild(seatPname);
  }

  hdr.addEventListener('pointerup', function(e) {
    if (e.defaultPrevented) return;
    toggleSeat(state, seat.id);
  });
  card.appendChild(hdr);

  // ── Items ──
  var itemsWrap = document.createElement('div');
  itemsWrap.style.padding       = '6px 8px 8px';
  itemsWrap.style.display       = 'flex';
  itemsWrap.style.flexDirection = 'column';
  itemsWrap.style.gap           = '5px';

  if (seat.items.length === 0) {
    var empty = document.createElement('div');
    empty.textContent      = 'empty seat';
    empty.style.textAlign  = 'center';
    empty.style.padding    = '20px 0';
    empty.style.fontFamily = T.fb;
    empty.style.fontSize   = T.fsB3;
    empty.style.color      = T.moon;
    empty.style.fontStyle  = 'italic';
    itemsWrap.appendChild(empty);
  } else {
    for (var ii = 0; ii < seat.items.length; ii++) {
      itemsWrap.appendChild(buildItemBlock(state, seatIdx, ii, false));
    }
  }
  card.appendChild(itemsWrap);

  var canDelete = seat.items.length === 0
    && activeSeatCount(state.seats, state.paidSeats) > 1;
  if (canDelete) {
    card.appendChild(_buildDeleteSeatX(state, seat.id));
  }

  state.seatEls[seat.id] = card;
  return card;
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
    fontWeight: T.fwBold,
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
    totalEl.textContent = fmt(seatTotal(seat, state));
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
      fontWeight: T.fwBold,
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
  subtotal.textContent = fmt(seatTotal(seat, state));
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
      fontWeight: T.fwBold,
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
  // Tile focus uses focusedSeats (by seat ID) — filter only, no payment selection.
  var tileActive = !!(state.focusedSeats && state.focusedSeats[seat.id]);

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
    if (state.focusedSeats[seat.id]) delete state.focusedSeats[seat.id];
    else state.focusedSeats[seat.id] = true;
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
  totalEl.textContent = fmt(seatTotal(seat, state));
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
  totalEl.textContent = fmt(seatTotal(seat, state));
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
  var used = {};
  for (var i = 0; i < state.seats.length; i++) { used[state.seats[i].number] = true; }
  var next = 1;
  for (var j = 0; j < n; j++) {
    while (used[next]) next++;
    var num = next;
    used[next] = true;
    state.seats.push({
      id:     'S-' + String(num).padStart(3, '0'),
      number: num,
      items:  [],
    });
  }
  state.seats.sort(function(a, b) { return a.number - b.number; });
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
    var hasSelectable = false;
    for (var j = 0; j < s2.items.length; j++) {
      if (s2.items[j].voided) continue;
      hasSelectable = true;
      if (!state.selectedItems[i2 + ':' + j]) { all = false; break; }
    }
    if (all && hasSelectable) next[s2.id] = true;
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
    if (seat.items[j].voided) continue;
    if (!state.selectedItems[seatIdx + ':' + j]) { allSelected = false; break; }
  }
  for (var k = 0; k < seat.items.length; k++) {
    if (seat.items[k].voided) continue;
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
        if (seat.items[j].voided) continue;
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
  var used = {};
  for (var i = 0; i < state.seats.length; i++) { used[state.seats[i].number] = true; }
  var num = 1;
  while (used[num]) num++;
  state.seats.push({
    id:     'S-' + String(num).padStart(3, '0'),
    number: num,
    items:  [],
  });
  state.seats.sort(function(a, b) { return a.number - b.number; });
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
        showToast('Seat update failed — please try again', { bg: T.verm, duration: 3000 });
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
  return _gotoOrderEntry(state, params);
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

  if (state._payingInProgress) return;
  state._payingInProgress = true;

  if (state.order && state.order.status === 'closed') {
    state._payingInProgress = false;
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
    state._payingInProgress = false;
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
    state._payingInProgress = false;
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
    orderId:              state.orderId,
    seatIds:              selectedIds,
    seats:                seatSummary,
    cardTotal:            cardTotal,
    cashPrice:            cashPrice,
    subtotal:             subtotal,
    tax:                  tax,
    managerDiscountTotal: state.order ? (state.order.manager_discount_total || 0) : 0,
    isLastPayment:        isLastPayment,
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

  // Expand seat selections into item refs (skip already-voided items)
  if (itemRefs.length === 0 && seatIds.length > 0) {
    for (var s = 0; s < seatIds.length; s++) {
      var sIdx = _seatIdxById(state, seatIds[s]);
      if (sIdx < 0) continue;
      for (var j = 0; j < state.seats[sIdx].items.length; j++) {
        if (state.seats[sIdx].items[j].voided) continue;
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
  var snapshot = [];
  for (var i = 0; i < refs.length; i++) {
    var r = refs[i];
    var item = state.seats[r.seatIdx].items[r.itemIdx];
    snapshot.push({ seatIdx: r.seatIdx, itemIdx: r.itemIdx, item: item });
    item.voided = true;
  }

  state.selectedItems = {};
  rerenderTopArea(state);

  if (!state.orderId) return;

  // Fire DELETEs immediately — no undo window.
  var deletes = snapshot
    .filter(function(s) { return !!s.item.item_id; })
    .map(function(s) {
      return fetchWithTimeout(
        '/api/v1/orders/' + state.orderId + '/items/' + s.item.item_id,
        { method: 'DELETE' }, 8000
      ).then(function(r) {
        if (!r.ok) throw new Error(r.status);
      });
    });

  Promise.all(deletes)
    .then(function() {
      // DELETEs confirmed. Persist voided items in _voidedItems so
      // _injectVoidedItems restores them after every refreshOrder.
      if (!state._voidedItems) state._voidedItems = [];
      for (var _vi = 0; _vi < snapshot.length; _vi++) {
        var _ve = snapshot[_vi];
        var _vs = state.seats[_ve.seatIdx];
        if (!_vs) continue;
        var _dup = state._voidedItems.some(function(e) {
          return e.item.item_id && e.item.item_id === _ve.item.item_id;
        });
        if (!_dup) state._voidedItems.push({ seatNumber: _vs.number, item: _ve.item });
      }
    })
    .catch(function() {
      // DELETE(s) failed — roll back the local void so the display
      // matches backend truth rather than silently diverging.
      if (!state._alive) return;
      for (var j = 0; j < snapshot.length; j++) {
        snapshot[j].item.voided = false;
      }
      rerenderTopArea(state);
      showToast('Void failed — check connection', { bg: T.verm });
    });
}

function _injectVoidedItems(state) {
  if (!state._voidedItems || state._voidedItems.length === 0) return;
  for (var vi = 0; vi < state._voidedItems.length; vi++) {
    var entry = state._voidedItems[vi];
    var seat  = null;
    for (var si = 0; si < state.seats.length; si++) {
      if (state.seats[si].number === entry.seatNumber) { seat = state.seats[si]; break; }
    }
    if (!seat) continue;
    var already = seat.items.some(function(it) {
      return it.item_id && it.item_id === entry.item.item_id;
    });
    if (!already) seat.items.push(entry.item);
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

  // Skip the manager PIN interrupt when the session is already authenticated
  // as a manager — use the logged-in employee ID as approvedBy directly.
  // The calling scene must pass role: 'manager' in mount params for this path.
  var _params = state._mountParams || {};
  var _isManager = (_params.role === 'manager') || (_params.employeeRole === 'manager');

  if (_isManager) {
    SceneManager.interrupt('disc-select', {
      onConfirm: function(opt) {
        _applyDiscount(state, opt.pct, itemRefs, seatIds, _params.employeeId || 'manager');
      },
      onCancel: function() {},
    });
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
  // Track whether this is a whole-seat discount (selected by seat) vs item-level
  var isWholeSeatDiscount = itemRefs.length === 0 && seatIds.length > 0;
  // Expand seat selections into item refs
  if (isWholeSeatDiscount) {
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
  var hasUnsent = lines.some(function(it) { return !it.item_id; });
  if (hasUnsent) {
    showToast('Send items to kitchen before applying a discount.', { bg: T.gold });
    return;
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
    if (!state._alive) return;
    // Cache per-item discount metadata so buildItemBlock can show lavender
    // treatment after refreshOrder (backend only updates manager_discount_total
    // at the order level — it does not stamp effectivePrice on individual items).
    if (!state._itemDiscounts) state._itemDiscounts = {};
    if (!state._seatDiscounts) state._seatDiscounts = {};
    for (var _di = 0; _di < lines.length; _di++) {
      var _dItem = lines[_di];
      var _dRef  = itemRefs[_di];
      var _dAmt  = Math.round((_dItem.price || 0) * (_dItem.qty || 1) * pct / 100 * 100) / 100;
      // Per-item cache (keyed by backend item_id)
      if (_dItem.item_id) {
        state._itemDiscounts[_dItem.item_id] = { pct: pct, amount: _dAmt };
      }
      // Per-seat cache only for whole-seat discounts, not item-level discounts.
      // Item-level discounts should only be indicated via _itemDiscounts.
      if (isWholeSeatDiscount) {
        var _dSeat = _dRef && state.seats[_dRef.seatIdx];
        if (_dSeat && _dSeat.id) {
          if (!state._seatDiscounts[_dSeat.id]) {
            state._seatDiscounts[_dSeat.id] = { pct: pct, amount: 0 };
          }
          state._seatDiscounts[_dSeat.id].amount =
            Math.round((state._seatDiscounts[_dSeat.id].amount + _dAmt) * 100) / 100;
        }
      }
    }
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
      fetchWithTimeout('/api/v1/orders/' + state.orderId, {
        method:  'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          server_id:   server.employee_id,
          server_name: server.employee_name,
        }),
      }, 10000).then(function(r) {
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

  // Build allColumns from all unpaid seats (for the seat selector strip)
  var allColumns = state.seats
    .filter(function(s) { return !state.paidSeats[s.id]; })
    .map(function(s) {
      return {
        id:    s.id,
        label: 'S' + (s.number != null ? s.number : ''),
        items: s.items.map(function(it) {
          return {
            name: it.name, qty: it.qty, price: it.price,
            item_id: it.item_id, menu_item_id: it.menu_item_id,
            category: it.category, mods: it.mods, notes: it.notes,
            _splitRef: it._splitRef || undefined,
          };
        }),
      };
    });

  // focusedIds: selected seats, or focused seats, or first unpaid seat
  var focusedIds;
  var selKeys2 = Object.keys(state.selected || {});
  if (selKeys2.length > 0) {
    focusedIds = selKeys2;
  } else if (Object.keys(state.focusedSeats || {}).length > 0) {
    focusedIds = Object.keys(state.focusedSeats);
  } else {
    var firstUnpaid = state.seats.filter(function(s) { return !state.paidSeats[s.id]; })[0];
    focusedIds = firstUnpaid ? [firstUnpaid.id] : [];
  }

  SceneManager.openTransactional('column-editor', {
    columns:      columns,
    allColumns:   allColumns,
    focusedIds:   focusedIds,
    checkNumber:  state.checkNumber || '',
    orderId:      state.orderId,
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
  var s = collectSummary(state.seats, state.selected, state.paidSeats, state);
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
      if (!state._alive) return;
      if (!order) return;
      state.order = order;
      state.checkNumber  = order.check_number || '';
      state.customerName = order.customer_name || '';


      state.seats = orderToSeats(order, order.guest_count || 1);
      _injectVoidedItems(state);

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