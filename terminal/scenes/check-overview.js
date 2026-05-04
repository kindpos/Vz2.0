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
//  DISC is behind the manager-pin interrupt — reachable via
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
(() => {
  if (document.getElementById('co-scroll-style')) return;
  let s = document.createElement('style');
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
  let v = Number(n);
  if (!isFinite(v)) v = 0;
  return `$${v.toFixed(2)}`;
}

// seatTotal now wraps the pure helper from ./seats.js so the
// rendering paths and transition paths share one math implementation.
// Pass state so cached discounts (_itemDiscounts / _seatDiscounts) are
// subtracted — the backend does not stamp effectivePrice per item after
// a discount POST, only updating the order-level total.
function seatTotal(seat, state) {
  let base = seatSubtotal(seat);
  if (!state || !seat) return base;
  // Whole-seat discount is the authoritative source when present — it already
  // accumulates all per-item amounts, so don't also sum _itemDiscounts.
  const sd = seat.id && state._seatDiscounts ? state._seatDiscounts[seat.id] : null;
  if (sd && sd.amount) {
    return Math.round((base - sd.amount) * 100) / 100;
  }
  // Item-level discounts (no seat-level entry means this is a targeted discount)
  if (state._itemDiscounts && seat.items) {
    for (let _i = 0; _i < seat.items.length; _i++) {
      let _id = state._itemDiscounts[seat.items[_i].item_id];
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

const _PREFIX_RX = /^(NO|ADD|SUB|EXTRA|ON SIDE|LITE)\s+/;

function _parsePrefix(name) {
  if (!name) return { prefix: null, clean: '' };
  let m = name.match(_PREFIX_RX);
  if (!m) return { prefix: null, clean: name };
  return { prefix: m[1], clean: name.slice(m[0].length) };
}

function _adaptMod(raw) {
  let pp = _parsePrefix(raw.name || '');
  return {
    prefix:    pp.prefix,
    name:      pp.clean,
    mandatory: pp.prefix === null,
    upcharge:  raw.charged ? (Number(raw.price) || 0) : 0,
    microMods: (raw.children || []).map(_adaptMod),
  };
}

function _adaptHalfItem(raw) {
  const pp = _parsePrefix(raw.name || '');
  return {
    prefix:   pp.prefix,
    name:     pp.clean,
    upcharge: raw.charged ? (Number(raw.price) || 0) : 0,
  };
}

function _adaptItem(it) {
  let mods = [];
  const first  = [];
  const second = [];
  const rawMods = it.mods || [];
  for (let i = 0; i < rawMods.length; i++) {
    let raw = rawMods[i];
    if (raw.prefix === 'Left')       first.push(_adaptHalfItem(raw));
    else if (raw.prefix === 'Right') second.push(_adaptHalfItem(raw));
    else                             mods.push(_adaptMod(raw));
  }
  const halves = (first.length || second.length)
    ? { first, second }
    : null;

  return {
    name:          it.name,
    qty:           it.qty || 1,
    price:         Number(it.effectivePrice != null ? it.effectivePrice : (it.price || 0)) || 0,
    categoryColor: T.catColor(it.category),
    sent:          !!(it.sent_at || it.sent),
    mods:          mods,
    halves:        halves,
  };
}

function _sumItemUpcharges(adaptedItem) {
  let uc = 0;
  let mods = adaptedItem.mods || [];
  for (let i = 0; i < mods.length; i++) {
    uc += mods[i].upcharge || 0;
    const mms = mods[i].microMods || [];
    for (let j = 0; j < mms.length; j++) uc += mms[j].upcharge || 0;
  }
  if (adaptedItem.halves) {
    const sides = ['first', 'second'];
    for (let s = 0; s < sides.length; s++) {
      const lst = adaptedItem.halves[sides[s]] || [];
      for (let k = 0; k < lst.length; k++) uc += lst[k].upcharge || 0;
    }
  }
  return uc;
}

// Build the single-seat order shape buildItemRecap expects so a Mode
// A seat tile can embed the same recap chrome (chevrons, qty chips,
// prefix badges, pizza halves) used by the Mode B recap column.
function _adaptSeatForRecap(state, seatIdx) {
  let seat = state.seats[seatIdx];
  let adaptedItems = [];
  for (let i = 0; i < seat.items.length; i++) {
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
  let order  = state.order || {};
  let params = state._mountParams || {};

  // Selection drives SORT, not filter: seats with at least one selected
  // item float to the top of the recap so the cashier's working set is
  // always visible first, while the rest of the check stays reachable
  // below. state.selectedItems is the source of truth; state.selected
  // is a derived "fully-selected" mirror maintained by toggleSeat /
  // toggleItem.
  const selItems = state.selectedItems || {};
  let selKeys  = Object.keys(selItems);
  const seatIdxsWithSelected = {};
  for (let sk = 0; sk < selKeys.length; sk++) {
    const sIdxSel = parseInt(selKeys[sk].split(':')[0], 10);
    if (!isNaN(sIdxSel)) seatIdxsWithSelected[sIdxSel] = true;
  }

  let adaptedSeats = [];
  let totalUpcharges = 0;
  for (let s = 0; s < state.seats.length; s++) {
    if (state.paidSeats && state.paidSeats[state.seats[s].id]) continue;
    let seat = state.seats[s];
    const adaptedItems = [];
    for (let i = 0; i < seat.items.length; i++) {
      const ai = _adaptItem(seat.items[i]);
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
  const selectedSeatIds = Object.keys(state.selected || {});
  if (selectedSeatIds.length === 1) {
    const focusId = selectedSeatIds[0];
    adaptedSeats = adaptedSeats.filter((s) => state.seats[s._sIdx] && state.seats[s._sIdx].id === focusId);
  } else if (Object.keys(seatIdxsWithSelected).length > 0) {
    // Sort selected-having seats to the top; preserve seat-number order
    // within each group. No-op when nothing is selected.
    adaptedSeats.sort((a, b) => {
      const aSel = seatIdxsWithSelected[a._sIdx] ? 1 : 0;
      const bSel = seatIdxsWithSelected[b._sIdx] ? 1 : 0;
      if (aSel !== bSel) return bSel - aSel;
      return (a.seatNumber || 0) - (b.seatNumber || 0);
    });
  }

  order = state.order || {};
  const totals = {
    subtotal:  order.gross_subtotal != null ? order.gross_subtotal : (order.subtotal || 0),
    discount:  order.manager_discount_total || 0,
    tax:       order.tax || 0,
    cardTotal: order.total || 0,
    taxRate:   getTaxRate(),
  };

  let paid = 0;
  if (Array.isArray(order.payments)) {
    for (let p = 0; p < order.payments.length; p++) {
      paid += Number(order.payments[p].amount) || 0;
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
  const items = [];
  let subtotal = 0;
  const anySelected = Object.keys(selected).length > 0;
  let visibleSeatCount = 0;
  for (let s = 0; s < seats.length; s++) {
    if (paidSeats && paidSeats[seats[s].id]) continue;
    visibleSeatCount++;
  }
  const showHeaders = visibleSeatCount > 1;
  for (let i = 0; i < seats.length; i++) {
    if (paidSeats && paidSeats[seats[i].id]) continue;
    if (anySelected && !selected[seats[i].id]) continue;
    if (showHeaders) {
      items.push({ seatHeader: true, seatId: seats[i].id, seatTotal: seatTotal(seats[i], state), seatIdx: i });
    }
    for (let j = 0; j < seats[i].items.length; j++) {
      let it = seats[i].items[j];
      if (it.voided) continue;
      let ep = it.effectivePrice || it.price;
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
  let taxRate  = getTaxRate();
  let tax      = subtotal * taxRate;
  let cardTotal = subtotal + tax;
  return {
    items:     items,
    subtotal:  Math.round(subtotal * 100) / 100,
    tax:       Math.round(tax * 100) / 100,
    cardTotal: Math.round(cardTotal * 100) / 100,
  };
}

const DISCOUNT_OPTIONS = [
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
    _voidedItems:      [],    // {seatNumber, item} re-injected after every refreshOrder
    _seatDiscounts:    {},    // seat.id  → {pct, amount} — fallback when item_id absent
    _paymentInProgress:  false,
    _voidInProgress:     false,
    _discountInProgress: false,
  },

  render: (container, params, state) => {
    function track(el, event, handler) {
      el.addEventListener(event, handler);
      state.listeners.push({ el, event, handler });
    }
    function trackBus(event, handler) {
      SceneManager.on(event, handler);
      state.listeners.push({ bus: true, event, handler });
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

    let _landing = params.returnLanding || null;
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
    const _landingParams = { emp: { id: params.employeeId, name: params.employeeName, pin: params.pin } };

    // Stash the landing target on state so renderOrderSummary can wire its
    // own BACK chevron without re-deriving the landing/emp bundle each call.
    state._landing       = _landing;
    state._landingParams = _landingParams;

    // ── Root + body layout ──
    let root = document.createElement('div');
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

    let body = document.createElement('div');
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

    const topArea = document.createElement('div');
    Object.assign(topArea.style, {
      flex:      '1',
      minHeight: '0',
      display:   'flex',
      gap:       '12px',
    });
    body.appendChild(topArea);
    state.topAreaEl = topArea;

    const bottomRow = document.createElement('div');
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

    trackBus('payment:complete', (data) => {
      if (data && data.orderId === state.orderId) refreshOrder(state, params);
    });

    state._backConfirmed = false;

    if (window._header && window._header.setBackHandler) {
      window._header.setBackHandler(state._landing ? () => {
        SceneManager.mountWorking(state._landing, state._landingParams);
      } : null);
    }

    return function cleanup() { state._alive = false; };
  },

  unmount: (state) => {
    if (window._header && window._header.setBackHandler) {
      window._header.setBackHandler(null);
    }
    if (OrderSummary.unlockItemRender) OrderSummary.unlockItemRender();
    OrderSummary.hide();
    state._osActive = false;

    for (let i = 0; i < state.listeners.length; i++) {
      let l = state.listeners[i];
      if (l.bus) SceneManager.off(l.event, l.handler);
      else       l.el.removeEventListener(l.event, l.handler);
    }
    state.listeners = [];

    for (let t = 0; t < state._lpTimers.length; t++) clearTimeout(state._lpTimers[t]);
    state._lpTimers = [];
  },

  interrupts: {

    'co-name-input': {
      render: (container, params) => {
        showKeyboard({
          placeholder:   'Enter name',
          initialValue:  params.currentName || '',
          maxLength:     40,
          onDone:        (val) => { params.onConfirm(val.trim()); },
          onDismiss:     () => { params.onCancel(); },
          dismissOnDone: true,
        });
      },
      unmount: () => { hideKeyboard(); },
    },

    'co-item-menu': {
      render: (container, params) => {
        params = params || {};
        let title   = params.title   || 'Options';
        let options = params.options || [];

        container.style.cssText = 'width:100%;height:100%;display:flex;align-items:center;justify-content:center;';

        let shell = buildStaticCard({ accent: T.green });
        shell.style.display       = 'flex';
        shell.style.flexDirection = 'column';
        shell.style.alignItems    = 'stretch';
        shell.style.gap           = '10px';
        shell.style.minWidth      = '320px';
        shell.style.maxWidth      = '420px';
        shell.style.padding       = '20px 28px 28px 32px';
        let panel = shell;

        let lbl = document.createElement('div');
        lbl.style.cssText = [
          `font-family:${T.fh};`,
          `font-size:${T.fsB2};`,
          `font-weight:${T.fwBold};`,
          `color:${T.green};`,
          'letter-spacing:0.2em;',
          'text-transform:uppercase;',
          'text-align:center;margin-bottom:8px;',
        ].join('');
        lbl.textContent = title;
        panel.appendChild(lbl);

        // Option pills — scene passes a semantic opt.color (T.green,
        // T.verm, T.gold…). Unset options fall back to ghost so they
        // don't blend into the T.card shell.
        for (let oi = 0; oi < options.length; oi++) {
          ((opt) => {
            let btn;
            if (opt.color) {
              btn = buildPillButton({
                label:    opt.label,
                color:    opt.color,
                darkBg:   darkenHex(opt.color, 0.4),
                fontSize: T.fsB2,
                onClick:  () => { params.onConfirm(opt.id); },
              });
              btn.style.color = (opt.color === T.verm) ? '#fff' : T.well;
            } else {
              btn = buildPillButton({
                label:    opt.label,
                variant:  'ghost',
                fontSize: T.fsB2,
                onClick:  () => { params.onConfirm(opt.id); },
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
        let cancelBtn = buildPillButton({
          label:    'CANCEL',
          variant:  'verm',
          fontSize: T.fsB2,
          onClick:  () => { params.onCancel(); },
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
        let _downInside = false;
        container.addEventListener('pointerdown', (e) => {
          _downInside = (e.target === container);
        });
        container.addEventListener('pointerup', (e) => {
          if (_downInside && e.target === container) { params.onCancel(); }
          _downInside = false;
        });
      },
      unmount: () => {},
    },

    'server-picker': {
      render: (container, params) => {
        params = params || {};
        const excludeId = params.excludeId || null;

        container.style.cssText = 'width:100%;height:100%;display:flex;align-items:center;justify-content:center;';

        let shell = buildStaticCard({ accent: T.green });
        shell.style.display       = 'flex';
        shell.style.flexDirection = 'column';
        shell.style.gap           = '10px';
        shell.style.minWidth      = '320px';
        shell.style.maxWidth      = '440px';
        shell.style.minHeight     = '360px';
        shell.style.maxHeight     = '520px';
        shell.style.padding       = '20px 28px 28px 32px';
        let panel = shell;

        let title = document.createElement('div');
        title.style.cssText = [
          `font-family:${T.fh};`,
          `font-size:${T.fsB2};`,
          `font-weight:${T.fwBold};`,
          'letter-spacing:0.18em;',
          `color:${T.green};`,
          'text-transform:uppercase;',
          'text-align:center;padding:4px 0 10px;',
        ].join('');
        title.textContent = 'TRANSFER TO SERVER';
        panel.appendChild(title);

        const list = document.createElement('div');
        list.style.cssText = 'flex:1;overflow-y:auto;display:flex;flex-direction:column;gap:8px;';

        const loading = document.createElement('div');
        loading.style.cssText = [
          `font-family:${T.fb};`,
          `font-size:${T.fsB3};`,
          `color:${T.text};`,
          'opacity:0.55;',
          'text-align:center;padding:20px 0;',
        ].join('') + `;font-weight:${T.fwBold};`;
        loading.textContent = 'Loading...';
        list.appendChild(loading);
        panel.appendChild(list);

        let cancelBtn = buildPillButton({
          label:    'CANCEL',
          variant:  'verm',
          fontSize: T.fsB2,
          onClick:  () => { params.onCancel(); },
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
          .then((r) => { if (!r.ok) throw new Error(r.status); return r.json(); })
          .then((data) => {
            if (!data || !Array.isArray(data.staff)) throw new Error('unexpected response');
            list.innerHTML = '';
            const staff = data.staff.filter((s) => s.employee_id !== excludeId);
            if (staff.length === 0) {
              let empty = document.createElement('div');
              empty.style.cssText = [
                `font-family:${T.fb};`,
                `font-size:${T.fsB3};`,
                `color:${T.text};`,
                'opacity:0.55;',
                'text-align:center;padding:20px 0;',
              ].join('') + `;font-weight:${T.fwBold};`;
              empty.textContent = 'No other servers clocked in';
              list.appendChild(empty);
              return;
            }
            for (let i = 0; i < staff.length; i++) {
              ((srv) => {
                let btn = buildPillButton({
                  label:    srv.employee_name,
                  color:    T.card,
                  darkBg:   darkenHex(T.card, 0.4),
                  fontSize: T.fsB2,
                  onClick:  () => {
                    params.onConfirm({ employee_id: srv.employee_id, employee_name: srv.employee_name });
                  },
                });
                btn.style.width = '100%';
                btn.style.color = T.text;
                list.appendChild(btn);
              })(staff[i]);
            }
          })
          .catch(() => {
            list.innerHTML = '';
            const err = document.createElement('div');
            err.style.cssText = [
              `font-family:${T.fb};`,
              `font-size:${T.fsB3};`,
              `color:${T.verm};`,
              'text-align:center;padding:20px 0;',
            ].join('') + `;font-weight:${T.fwBold};`;
            err.textContent = 'Failed to load servers';
            list.appendChild(err);
          });
      },
    },

    'disc-select': {
      render: (container, params) => {
        container.style.cssText = 'width:100%;height:100%;display:flex;align-items:center;justify-content:center;';

        let shell = buildStaticCard({ accent: T.groups.picker.shellAccentAuth });
        shell.style.display       = 'flex';
        shell.style.flexDirection = 'column';
        shell.style.alignItems    = 'center';
        shell.style.gap           = '12px';
        shell.style.minWidth      = '320px';
        shell.style.padding       = '24px 28px 28px 32px';
        let panel = shell;

        let lbl = document.createElement('div');
        lbl.style.cssText = [
          `font-family:${T.fh};`,
          `font-size:${T.fsB2};`,
          `font-weight:${T.fwBold};`,
          `color:${T.gold};`,
          'letter-spacing:0.2em;',
          'text-transform:uppercase;',
          'margin-bottom:6px;',
        ].join('');
        lbl.textContent = 'DISCOUNT';
        panel.appendChild(lbl);

        DISCOUNT_OPTIONS.forEach((opt) => {
          let btn = buildPillButton({
            label:    opt.label,
            color:    T.gold,
            darkBg:   T.goldDk,
            fontSize: T.fsB2,
            onClick:  () => { params.onConfirm(opt); },
          });
          btn.style.width          = '240px';
          btn.style.borderRadius   = '14px';
          btn.style.display        = 'flex';
          btn.style.alignItems     = 'center';
          btn.style.justifyContent = 'center';
          panel.appendChild(btn);
        });

        let cancelBtn = buildPillButton({
          label:    'CANCEL',
          variant:  'verm',
          fontSize: T.fsB2,
          onClick:  () => { params.onCancel(); },
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
      unmount: () => {},
    },

    'seat-count': {
      render: (container, params) => {
        container.style.cssText = 'width:100%;height:100%;display:flex;align-items:center;justify-content:center;';

        const numpad = buildNumpad({
          masked:    false,
          maxDigits: 2,
          onSubmit: (val) => {
            let n = parseInt(val, 10);
            if (!isFinite(n) || n < 1) { numpad.setError('ENTER A NUMBER'); return; }
            if (n > 99)                 { numpad.setError('MAX 99');         return; }
            params.onConfirm(n);
          },
          onCancel: () => { params.onCancel(); },
        });

        let shell = buildStaticCard({ accent: T.groups.auth.shellAccent });
        shell.style.padding = '20px 24px';
        shell.appendChild(numpad);
        container.appendChild(shell);

        container.addEventListener('pointerup', (e) => {
          if (e.target === container) params.onCancel();
        });
      },
      unmount: () => {},
    },

    'seat-payment': {
      render: (container, params) => {
        params = params || {};
        const seatId   = params.seatId   || '??';
        let payments = params.payments || [];

        container.style.cssText = 'width:100%;height:100%;display:flex;align-items:center;justify-content:center;';

        let shell = buildStaticCard({ accent: T.gold });
        shell.style.display       = 'flex';
        shell.style.flexDirection = 'column';
        shell.style.alignItems    = 'stretch';
        shell.style.gap           = '10px';
        shell.style.minWidth      = '320px';
        shell.style.maxWidth      = '440px';
        shell.style.padding       = '24px 28px 28px 32px';
        let panel = shell;

        const title = document.createElement('div');
        title.style.cssText = [
          `font-family:${T.fh};`,
          `font-size:${T.fsB2};`,
          `font-weight:${T.fwBold};`,
          `color:${T.gold};`,
          'letter-spacing:0.2em;',
          'text-transform:uppercase;',
          'text-align:center;margin-bottom:4px;',
        ].join('');
        title.textContent = seatId + ' PAYMENT';
        panel.appendChild(title);

        if (payments.length === 0) {
          let empty = document.createElement('div');
          empty.style.cssText = [
            `font-family:${T.fb};`,
            `font-size:${T.fsB3};`,
            `color:${T.text};`,
            'opacity:0.55;',
            'padding:8px 0;text-align:center;',
          ].join('') + `;font-weight:${T.fwBold};`;
          empty.textContent = 'No payments found for this seat';
          panel.appendChild(empty);
        } else {
          for (let pi = 0; pi < payments.length; pi++) {
            ((p) => {
              let row = document.createElement('div');
              row.style.cssText = [
                'display:flex;align-items:center;justify-content:space-between;',
                'gap:12px;width:100%;padding:6px 0;',
              ].join('');
              let info = document.createElement('div');
              info.style.cssText = [
                `font-family:${T.fb};`,
                `font-size:${T.fsB2};`,
                `color:${T.text};`,
              ].join('') + `;font-weight:${T.fwBold};`;
              info.textContent = p.method.toUpperCase() + `  ${fmt(p.amount)}`;
              row.appendChild(info);
              const delBtn = buildPillButton({
                label:    'DELETE',
                variant:  'verm',
                fontSize: T.fsB3,
                onClick:  () => { params.onConfirm(p.payment_id); },
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

        const cancelBtn = buildPillButton({
          label:    'CANCEL',
          variant:  'verm',
          fontSize: T.fsB2,
          onClick:  () => { params.onCancel(); },
        });
        cancelBtn.style.width          = '100%';
        cancelBtn.style.marginTop      = '4px';
        cancelBtn.style.borderRadius   = '14px';
        cancelBtn.style.display        = 'flex';
        cancelBtn.style.alignItems     = 'center';
        cancelBtn.style.justifyContent = 'center';
        panel.appendChild(cancelBtn);
        container.appendChild(shell);

        let _downInside = false;
        container.addEventListener('pointerdown', (e) => {
          _downInside = (e.target === container);
        });
        container.addEventListener('pointerup', (e) => {
          if (_downInside && e.target === container) { params.onCancel(); }
          _downInside = false;
        });
      },
      unmount: () => {},
    },

    'co-unassigned-warn': {
      render: (container, params) => {
        params = params || {};
        const count = params.count || 0;

        container.style.cssText = 'width:100%;height:100%;display:flex;align-items:center;justify-content:center;';

        let shell = buildStaticCard({ accent: T.gold });
        shell.style.display       = 'flex';
        shell.style.flexDirection = 'column';
        shell.style.alignItems    = 'stretch';
        shell.style.gap           = '14px';
        shell.style.minWidth      = '320px';
        shell.style.maxWidth      = '420px';
        shell.style.padding       = '24px 28px 28px 28px';

        let title = document.createElement('div');
        title.style.cssText = [
          `font-family:${T.fh};`,
          `font-size:${T.fsB2};`,
          `font-weight:${T.fwBold};`,
          `color:${T.gold};`,
          'letter-spacing:0.2em;',
          'text-transform:uppercase;',
          'text-align:center;',
        ].join('');
        title.textContent = 'Unassigned Items';
        shell.appendChild(title);

        let body = document.createElement('div');
        body.style.cssText = [
          `font-family:${T.fb};`,
          `font-size:${T.fsB2};`,
          `color:${T.text};`,
          'text-align:center;',
          'line-height:1.5;',
        ].join('');
        body.textContent = `${count} item(s) have no seat assigned and will not be included in this payment. Continue?`;
        shell.appendChild(body);

        let cancelBtn = buildPillButton({
          label:    'CANCEL',
          variant:  'ghost',
          fontSize: T.fsB2,
          onClick:  () => { params.onCancel(); },
        });
        cancelBtn.style.width          = '100%';
        cancelBtn.style.borderRadius   = '14px';
        cancelBtn.style.display        = 'flex';
        cancelBtn.style.alignItems     = 'center';
        cancelBtn.style.justifyContent = 'center';
        shell.appendChild(cancelBtn);

        let continueBtn = buildPillButton({
          label:    'CONTINUE',
          color:    T.gold,
          fontSize: T.fsB2,
          onClick:  () => { params.onConfirm(); },
        });
        continueBtn.style.width          = '100%';
        continueBtn.style.borderRadius   = '14px';
        continueBtn.style.display        = 'flex';
        continueBtn.style.alignItems     = 'center';
        continueBtn.style.justifyContent = 'center';
        shell.appendChild(continueBtn);

        container.appendChild(shell);
      },
      unmount: () => {},
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
  let timer = null;
  let fired = false;
  const ms = holdMs || 550;
  el.addEventListener('pointerdown', () => {
    fired = false;
    timer = setTimeout(() => { fired = true; onFire(); }, ms);
  });
  el.addEventListener('pointerup', () => {
    if (timer) { clearTimeout(timer); timer = null; }
  });
  el.addEventListener('pointerleave', () => {
    if (timer) { clearTimeout(timer); timer = null; }
  });
  el.addEventListener('pointercancel', () => {
    if (timer) { clearTimeout(timer); timer = null; }
  });
}

function renderActionBar(state) {
  const barZone = state.bottomBarEl;
  if (!barZone) return;
  barZone.innerHTML = '';

  const order           = state.order || {};
  let discount        = getCashDiscount();
  const managerDiscount = order.manager_discount_total || 0;
  let bevelLt         = lightenHex(T.bg, 0.08);
  let bevelDk         = darkenHex(T.bg, 0.2);

  // ── Selection-aware totals ──
  const itemKeys    = Object.keys(state.selectedItems || {});
  const anyItemSel  = itemKeys.length > 0;
  const focusActive = !anyItemSel && Object.keys(state.focusedSeats || {}).length > 0;
  let subtotal, tax, total, cashTotal;

  if (anyItemSel) {
    subtotal = 0;
    for (let ki = 0; ki < itemKeys.length; ki++) {
      const parts   = itemKeys[ki].split(':');
      let sIdx    = parseInt(parts[0], 10);
      const iIdx    = parseInt(parts[1], 10);
      const selSeat = state.seats[sIdx];
      const selItem = selSeat && selSeat.items[iIdx];
      if (!selItem || selItem.voided) continue;
      const selPrice = selItem.effectivePrice != null ? selItem.effectivePrice : (selItem.price || 0);
      subtotal += (selItem.qty || 0) * selPrice;
    }
    tax       = subtotal * getTaxRate();
    total     = subtotal + tax;
    cashTotal = Math.round(total * (1 - discount) * 100) / 100;
  } else if (focusActive) {
    subtotal = 0;
    for (let _fi = 0; _fi < state.seats.length; _fi++) {
      const _fSeat = state.seats[_fi];
      if (!state.focusedSeats[_fSeat.id]) continue;
      if (state.paidSeats && state.paidSeats[_fSeat.id]) continue;
      for (let _fii = 0; _fii < _fSeat.items.length; _fii++) {
        const _fItem = _fSeat.items[_fii];
        if (_fItem.voided) continue;
        const _fPrice = _fItem.effectivePrice != null ? _fItem.effectivePrice : (_fItem.price || 0);
        subtotal += (_fItem.qty || 0) * _fPrice;
      }
    }
    subtotal  = Math.round(subtotal * 100) / 100;
    tax       = subtotal * getTaxRate();
    total     = subtotal + tax;
    cashTotal = Math.round(total * (1 - discount) * 100) / 100;
  } else {
    const _hasLocalVoid = state.seats.some((s) => {
      return s.items.some((it) => it.voided);
    });
    if (_hasLocalVoid) {
      subtotal = 0;
      for (let _vi = 0; _vi < state.seats.length; _vi++) {
        for (let _vj = 0; _vj < state.seats[_vi].items.length; _vj++) {
          const _vit = state.seats[_vi].items[_vj];
          if (_vit.voided) continue;
          const _vp = _vit.effectivePrice != null ? _vit.effectivePrice : (_vit.price || 0);
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
  const bar = document.createElement('div');
  bar.style.height        = '136px';
  bar.style.flex          = '1';
  bar.style.flexShrink    = '0';
  bar.style.background    = T.well;
  bar.style.borderTop     = `2px solid ${T.border}`;
  bar.style.display       = 'flex';
  bar.style.alignItems    = 'stretch';
  bar.style.gap           = '4px';
  bar.style.padding       = '6px 0';
  bar.style.boxSizing     = 'border-box';
  bar.style.borderRadius  = '10px';
  bar.style.margin        = '0';
  bar.style.width         = 'fit-content';
  bar.style.minWidth      = '0';
  barZone.appendChild(bar);

  // ── Left totals cluster ──
  const totalsWrap = document.createElement('div');
  totalsWrap.style.display    = 'flex';
  totalsWrap.style.gap        = '6px';
  totalsWrap.style.flexShrink = '0';
  totalsWrap.style.alignItems = 'stretch';

  function _totBox(opts) {
    const box = document.createElement('div');
    box.style.background    = T.card;
    box.style.borderTop     = `3px solid ${bevelLt}`;
    box.style.borderLeft    = `4px solid ${(opts.accent || T.gold)}`;
    box.style.borderRight   = `3px solid ${bevelDk}`;
    box.style.borderBottom  = `3px solid ${bevelDk}`;
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
    let row = document.createElement('div');
    row.style.display        = 'flex';
    row.style.justifyContent = 'space-between';
    row.style.alignItems     = 'baseline';
    row.style.gap            = '12px';
    const l = document.createElement('span');
    l.style.fontFamily = T.fb;
    l.style.fontWeight = T.fwBold;
    l.style.fontSize   = T.fsB3;
    l.style.color      = T.text;
    l.style.whiteSpace = 'nowrap';
    l.textContent = lbl;
    const v = document.createElement('span');
    v.style.fontFamily = T.fb;
    v.style.fontWeight = T.fwBold;
    v.style.fontSize   = '17px';
    v.style.color      = valColor || T.gold;
    v.textContent = val;
    row.appendChild(l); row.appendChild(v);
    return row;
  }

  // Sub/Disc/Tax box
  const subBox = _totBox({ minWidth: '168px', gap: '4px' });
  subBox.appendChild(_totRow('Subtotal:', fmt(subtotal), T.gold));
  if (managerDiscount > 0) {
    subBox.appendChild(_totRow('Discounts:', `-${fmt(managerDiscount)}`, T.lavender));
  }
  subBox.appendChild(_totRow('Tax:', fmt(tax), T.gold));
  totalsWrap.appendChild(subBox);

  // Total + Cash stacked
  const rightCol = document.createElement('div');
  rightCol.style.display       = 'flex';
  rightCol.style.flexDirection = 'column';
  rightCol.style.gap           = '6px';

  const totalBox = _totBox({ flex: '1', minWidth: '110px' });
  totalBox.appendChild(_totRow('Total:', fmt(total), T.gold));
  rightCol.appendChild(totalBox);

  const cashBox = _totBox({ flex: '1', minWidth: '110px', accent: T.greenWarm });
  cashBox.appendChild(_totRow('Cash:', fmt(cashTotal), T.greenWarm));
  rightCol.appendChild(cashBox);

  totalsWrap.appendChild(rightCol);
  bar.appendChild(totalsWrap);

  // ── Divider ──
  const barDiv = document.createElement('div');
  barDiv.style.width      = '1px';
  barDiv.style.background = T.border;
  barDiv.style.flexShrink = '0';
  barDiv.style.margin     = '2px 0';
  bar.appendChild(barDiv);

  // ── Action grid — 4 equal buttons ──
  const actionGrid = document.createElement('div');
  actionGrid.style.width               = 'fit-content';
  actionGrid.style.flex                = '0 0 auto';
  actionGrid.style.display             = 'grid';
  actionGrid.style.gridTemplateColumns = 'auto auto auto auto auto';
  actionGrid.style.gap                 = '5px';
  actionGrid.style.alignSelf           = 'center';
  actionGrid.style.alignItems          = 'center';


  function _actBtn(opts) {
    let btn = document.createElement('div');
    btn.style.borderRadius   = '10px';
    btn.style.height         = '78px';
    btn.style.width          = '80%';
    btn.style.margin         = '0';
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
    btn.style.boxShadow      = `0 4px 0 ${(opts.dk || T.moonDk)}`;
    btn.style.color          = opts.color || T.text;
    btn.style.border         = opts.border || 'none';
    btn.style.transition     = 'transform 0.07s, box-shadow 0.07s';

    const lbl = document.createElement('span');
    lbl.style.fontSize   = opts.labelSize || '32px';
    lbl.style.fontWeight = T.fwBold;
    lbl.style.lineHeight = '1.2';
    lbl.style.textAlign  = 'center';
    lbl.textContent      = opts.label;
    btn.appendChild(lbl);

    if (opts.sub !== undefined) {
      const sub = document.createElement('span');
      sub.style.fontFamily = T.fb;
      sub.style.fontSize   = T.fsB4;
      sub.style.fontWeight = T.fwBold;
      sub.style.opacity    = '0.65';
      sub.style.minHeight  = '14px';
      sub.textContent      = opts.sub || '';
      btn.appendChild(sub);
    }

    let baseShadow  = btn.style.boxShadow;
    let pressShadow = `0 1px 0 ${(opts.dk || T.moonDk)}`;
    btn.addEventListener('pointerdown', () => {
      btn.style.transform = 'translateY(3px)';
      btn.style.boxShadow = pressShadow;
    });
    let _up = () => { btn.style.transform = 'none'; btn.style.boxShadow = baseShadow; };
    btn.addEventListener('pointerup',     _up);
    btn.addEventListener('pointerleave',  _up);
    btn.addEventListener('pointercancel', _up);
    if (opts.onClick) btn.addEventListener('pointerup', (e) => {
      if (e.defaultPrevented) return;
      opts.onClick();
    });
    return btn;
  }

  const selCount = itemKeys.length;
  const paySubLabel = selCount > 0 ? `(${selCount} items)` : '';

  const payBtn = _actBtn({
    label:     'Pay',
    sub:       paySubLabel,
    bg:        T.gold,
    dk:        T.goldDk,
    color:     T.well,
    onClick:   () => { handlePay(state, state._params || {}); },
  });

  // Sub-button builder — shared press-state wiring
  function _subBtn(opts) {
    const btn = document.createElement('div');
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
    const baseShadow  = `0 3px 0 ${opts.dk}`;
    const pressShadow = `0 1px 0 ${opts.dk}`;
    btn.style.boxShadow = baseShadow;
    btn.textContent = opts.label;
    btn.addEventListener('pointerdown', () => {
      btn.style.transform = 'translateY(2px)';
      btn.style.boxShadow = pressShadow;
    });
    const _up = () => { btn.style.transform = 'none'; btn.style.boxShadow = baseShadow; };
    btn.addEventListener('pointerup',     _up);
    btn.addEventListener('pointerleave',  _up);
    btn.addEventListener('pointercancel', _up);
    if (opts.onClick) btn.addEventListener('pointerup', (e) => {
      if (e.defaultPrevented) return;
      opts.onClick();
    });
    return btn;
  }

  const manageBtn = _actBtn({
    label:     'Manage\nSeats',
    labelSize: '24px',
    sub:       '',
    bg:        T.card,
    dk:        T.moonDk,
    color:     T.text,
    border:    `1px solid ${T.border}`,
    onClick:   () => { openEditSeats(state); },
  });

  const addItemsBtn = _actBtn({
    label:   'Add Items',
    labelSize: '22px',
    sub:     '',
    bg:      T.greenWarm,
    dk:      T.greenWarmDk,
    color:   T.well,
    onClick: () => { handleAddItems(state, state._params || {}); },
  });

  // Pay (unchanged, append as before)
  actionGrid.appendChild(payBtn);

  // Disc/Void — new narrow stacked column between Pay and Print
  const dvCol = document.createElement('div');
  dvCol.style.display       = 'flex';
  dvCol.style.flexDirection = 'column';
  dvCol.style.gap           = '5px';
  dvCol.style.alignSelf     = 'center';
  dvCol.style.height        = '78px';

  const discBtn = _subBtn({
    label:   'Disc',
    bg:      T.lavender,
    dk:      darkenHex(T.lavender, 0.45),
    color:   T.well,
    onClick: () => { handleDiscount(state); },
  });
  discBtn.style.flex   = '1';
  discBtn.style.width  = '80%';
  discBtn.style.margin = '0';

  const voidBtn = _subBtn({
    label:   'Void',
    bg:      T.verm,
    dk:      T.vermDk,
    color:   '#fff',
    onClick: () => { handleVoid(state); },
  });
  voidBtn.style.flex   = '1';
  voidBtn.style.width  = '80%';
  voidBtn.style.margin = '0';

  dvCol.appendChild(discBtn);
  discBtn.style.width = '100%';
  dvCol.appendChild(voidBtn);
  voidBtn.style.width = '100%';
  actionGrid.appendChild(dvCol);

  // Print — standalone button, no sub-row, no flex:1
  const printColNew = document.createElement('div');
  printColNew.style.alignSelf = 'center';
  const printBtnNew = _actBtn({
    label:   'Print',
    bg:      T.elec,
    dk:      T.elecDk,
    color:   T.well,
    onClick: () => { handlePrint(state); },
  });
  printColNew.appendChild(printBtnNew);
  actionGrid.appendChild(printColNew);

  // Manage and Add Items (unchanged labels/colors, just appended directly)
  actionGrid.appendChild(manageBtn);
  actionGrid.appendChild(addItemsBtn);

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
    `/api/v1/orders/${state.orderId}/split-by-seat`,
    {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ seats: seatNumbers }),
    },
    15000
  )
    .then((r) => { return r.json().then((j) => { return { ok: r.ok, body: j }; }); })
    .then((res) => {
      if (!res.ok || !res.body || res.body.success === false) {
        const msg = (res.body && res.body.detail) || 'Split failed';
        showToast(msg, { bg: T.verm });
        return;
      }
      const kids = (res.body.child_orders || []).map((c) => c.order_id);
      showToast(`New check: ${kids.join(', ')}`, { bg: T.greenWarm });
      refreshOrder(state, state._mountParams || {});
    })
    .catch(() => { showToast('Split failed', { bg: T.verm }); });
}


// ═══════════════════════════════════════════════════
//  SEATS CONTAINER — Nostalgia card shell
//  T.card body, 10 px radius, drop shadow, 4 px T.green left accent
//  bar, and a 24 px T.green top strip with SEATS / ALL labels.
//  Wraps whatever mode (A / B / C) renders into its body slot.
// ═══════════════════════════════════════════════════

function _allSeatsSelected(state) {
  let anyUnpaid = false;
  for (let i = 0; i < state.seats.length; i++) {
    let s = state.seats[i];
    if (state.paidSeats[s.id]) continue;
    anyUnpaid = true;
    if (!state.selected[s.id]) return false;
  }
  return anyUnpaid;
}

function buildSeatsContainer(state) {
  const root = document.createElement('div');
  Object.assign(root.style, {
    flex:          '1',
    minHeight:     '0',
    display:       'flex',
    flexDirection: 'column',
    overflow:      'visible',
    position:      'relative',
  });

  let activeCount = activeSeatCount(state.seats, state.paidSeats);
  const mode = activeCount <= 4 ? 'A' : 'B';

  let body = document.createElement('div');
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

  return { root, body, mode };
}

// ═══════════════════════════════════════════════════
//  TOP-AREA DISPATCHER
// ═══════════════════════════════════════════════════

function rerenderTopArea(state) {
  if (state._osActive) {
    OrderSummary.hide();
    state._osActive = false;
  }

  const savedRecapScroll = state._scrollListEl ? state._scrollListEl.scrollTop : 0;

  const top = state.topAreaEl;
  top.innerHTML = '';
  state.seatEls = {};

  for (let t = 0; t < state._lpTimers.length; t++) clearTimeout(state._lpTimers[t]);
  state._lpTimers = [];

  const shell = buildSeatsContainer(state);
  top.appendChild(shell.root);

  renderSeatsGrid(state, shell.body, shell.mode);
  if (state._scrollListEl) state._scrollListEl.scrollTop = savedRecapScroll;

  renderActionBar(state);
}

function renderSeatsGrid(state, container, mode) {
  container.innerHTML = '';

  // ── Mode B: collapsible recap LEFT + tile grid RIGHT ──
  if (mode === 'B') {
    const focusedSeats = state.focusedSeats || (state.focusedSeats = {});
    const expandedSeats = state.expandedSeats || (state.expandedSeats = {});
    let bevelLt = lightenHex(T.bg, 0.08);
    let bevelDk = darkenHex(T.bg, 0.2);

    // ── LEFT: recap shell ──────────────────────────────
    const recapShell = document.createElement('div');
    recapShell.style.flex          = '0 0 360px';
    recapShell.style.width         = '360px';
    recapShell.style.display       = 'flex';
    recapShell.style.flexDirection = 'column';
    recapShell.style.overflow      = 'hidden';
    recapShell.style.background    = T.well;
    recapShell.style.border        = `3px solid ${bevelLt}`;
    recapShell.style.borderLeft    = `3px solid ${bevelDk}`;
    recapShell.style.borderBottom  = `3px solid ${bevelDk}`;
    recapShell.style.borderRadius  = T.chamferCard + 'px';

    const scrollArea = document.createElement('div');
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
    const visibleSeats = state.seats.filter((s) => {
      if (state.paidSeats[s.id]) return false;
      if (Object.keys(focusedSeats).length > 0 && !focusedSeats[s.id]) return false;
      return true;
    });

    for (let rsi = 0; rsi < visibleSeats.length; rsi++) {
      const rSeat      = visibleSeats[rsi];
      const rSeatIdx   = state.seats.indexOf(rSeat);
      const isExpanded = !!expandedSeats[rSeat.id];
      let hasDisc    = _seatHasDisc(rSeat, state);

      // Collapsible seat card
      const sCard = document.createElement('div');
      sCard.style.borderBottom = `1px solid ${bevelDk}`;
      sCard.style.borderLeft   = `3px solid ${(hasDisc ? T.lavender : T.green)}`;

      // Seat card header
      const sHdr = document.createElement('div');
      sHdr.style.display         = 'flex';
      sHdr.style.alignItems      = 'baseline';
      sHdr.style.justifyContent  = 'space-between';
      sHdr.style.padding         = '8px 12px';
      sHdr.style.background      = T.well;
      sHdr.style.cursor          = 'pointer';
      sHdr.style.userSelect      = 'none';
      sHdr.style.pointerEvents   = 'auto';
      sHdr.style.touchAction     = 'manipulation';

      const sHdrLeft = document.createElement('div');
      sHdrLeft.style.display    = 'flex';
      sHdrLeft.style.alignItems = 'baseline';
      sHdrLeft.style.gap        = '8px';

      const sNum = document.createElement('span');
      sNum.textContent      = `S${(rSeat.number != null ? rSeat.number : (rSeatIdx + 1))}`;
      sNum.style.fontFamily = T.fh;
      sNum.style.fontWeight = T.fwBold;
      sNum.style.fontSize   = '20px';
      sNum.style.color      = hasDisc ? T.lavender : T.green;
      sHdrLeft.appendChild(sNum);

      const sSbtl = document.createElement('span');
      sSbtl.textContent      = fmt(seatTotal(rSeat, state));
      sSbtl.style.fontFamily = T.fb;
      sSbtl.style.fontWeight = T.fwBold;
      sSbtl.style.fontSize   = '14px';
      sSbtl.style.color      = hasDisc ? T.lavender : T.gold;
      sHdrLeft.appendChild(sSbtl);
      sHdr.appendChild(sHdrLeft);

      const sHdrRight = document.createElement('div');
      sHdrRight.style.display    = 'flex';
      sHdrRight.style.alignItems = 'baseline';
      sHdrRight.style.gap        = '8px';

      if (rSeat.name) {
        const sPname = document.createElement('span');
        sPname.textContent      = `"${rSeat.name}"`;
        sPname.style.fontFamily = T.fb;
        sPname.style.fontSize   = T.fsB4;
        sPname.style.color      = T.text;
        sPname.style.fontStyle  = 'italic';
        sHdrRight.appendChild(sPname);
      }

      let chevron = document.createElement('span');
      chevron.textContent      = '▸';
      chevron.style.fontFamily = T.fb;
      chevron.style.fontSize   = T.fsB3;
      chevron.style.color      = T.moon;
      chevron.style.transition = 'transform 0.15s';
      chevron.style.display    = 'inline-block';
      if (isExpanded) chevron.style.transform = 'rotate(90deg)';
      sHdrRight.appendChild(chevron);

      const canDeleteRecap = rSeat.items.length === 0
        && activeSeatCount(state.seats, state.paidSeats) > 1;
      if (canDeleteRecap) {
        const sDelBtn = _buildDeleteSeatX(state, rSeat.id);
        sDelBtn.style.position  = 'relative';
        sDelBtn.style.top       = 'auto';
        sDelBtn.style.right     = 'auto';
        sDelBtn.style.alignSelf = 'center';
        sHdrRight.appendChild(sDelBtn);
      }

      sHdr.appendChild(sHdrRight);

      ((capturedId) => {
        sHdr.addEventListener('pointerup', (e) => {
          if (e.defaultPrevented) return;
          if (state.expandedSeats[capturedId]) delete state.expandedSeats[capturedId];
          else state.expandedSeats[capturedId] = true;
          rerenderTopArea(state);
        });
      })(rSeat.id);
      sCard.appendChild(sHdr);

      // Items wrapper — collapses/expands
      let itemsWrap = document.createElement('div');
      itemsWrap.style.overflow      = 'hidden';
      itemsWrap.style.maxHeight     = isExpanded ? '1500px' : '0';
      itemsWrap.style.transition    = 'max-height 0.2s ease';
      itemsWrap.style.pointerEvents = isExpanded ? 'auto' : 'none';

      const itemsInner = document.createElement('div');
      itemsInner.style.padding       = '6px 8px 8px';
      itemsInner.style.display       = 'flex';
      itemsInner.style.flexDirection = 'column';
      itemsInner.style.gap           = '5px';

      for (let rii = 0; rii < rSeat.items.length; rii++) {
        itemsInner.appendChild(buildItemBlock(state, rSeatIdx, rii, true));
      }
      itemsWrap.appendChild(itemsInner);
      sCard.appendChild(itemsWrap);
      scrollArea.appendChild(sCard);
    }
    recapShell.appendChild(scrollArea);
    container.appendChild(recapShell);

    // ── RIGHT: 480px tile grid ──────────────────────
    const tilesCol = document.createElement('div');
    tilesCol.style.flex          = '1';
    tilesCol.style.minWidth      = '0';
    tilesCol.style.display       = 'flex';
    tilesCol.style.flexDirection = 'column';
    tilesCol.style.gap           = '6px';
    tilesCol.style.minHeight     = '0';

    const tilesGrid = document.createElement('div');
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
    for (let pti = 0; pti < state.seats.length; pti++) {
      if (!state.paidSeats[state.seats[pti].id]) continue;
      const pTile = buildPaidCompactTile(state, pti);
      tilesGrid.appendChild(pTile);
    }

    // Unpaid seat tiles
    for (let ti = 0; ti < state.seats.length; ti++) {
      if (state.paidSeats[state.seats[ti].id]) continue;
      const tSeat    = state.seats[ti];
      const tActive  = !!focusedSeats[tSeat.id];
      const tHasDisc = _seatHasDisc(tSeat, state);

      const tile = document.createElement('div');
      tile.style.background    = tActive ? T.green : T.card;
      tile.style.border        = `1px solid ${(tActive ? T.greenDk : T.border)}`;
      tile.style.borderLeft    = `3px solid ${(tActive ? T.greenDk : (tHasDisc ? T.lavender : T.green))}`;
      tile.style.boxShadow     = `0 2px 0 ${(tActive ? T.greenDk : T.moonDk)}`;
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

      const tNum = document.createElement('span');
      tNum.textContent      = `S${(tSeat.number != null ? tSeat.number : (ti + 1))}`;
      tNum.style.fontFamily = T.fh;
      tNum.style.fontWeight = T.fwBold;
      tNum.style.fontSize   = '18px';
      tNum.style.color      = tActive ? T.well : T.green;
      tile.appendChild(tNum);

      if (tSeat.name) {
        const tName = document.createElement('span');
        tName.textContent      = `"${tSeat.name}"`;
        tName.style.fontFamily = T.fb;
        tName.style.fontSize   = T.fsB4;
        tName.style.color      = tActive ? T.well : T.text;
        tName.style.fontStyle  = 'italic';
        tile.appendChild(tName);
      }

      const tTotal = document.createElement('span');
      tTotal.textContent      = fmt(seatTotal(tSeat, state));
      tTotal.style.fontFamily = T.fb;
      tTotal.style.fontWeight = T.fwBold;
      tTotal.style.fontSize   = T.fsB3;
      tTotal.style.color      = tActive ? T.well : T.gold;
      tile.appendChild(tTotal);

      ((capturedSeat) => {
        tile.addEventListener('pointerup', (e) => {
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
    const addTileB = buildAddTile(state, { fullSize: true });
    tilesGrid.appendChild(addTileB);

    tilesCol.appendChild(tilesGrid);
    container.appendChild(tilesCol);
    return;
  }

  // ── Mode A: each seat is an equal flex-row column ──
  const activeCount = activeSeatCount(state.seats, state.paidSeats);
  for (let i = 0; i < state.seats.length; i++) {
    if (state.paidSeats[state.seats[i].id]) {
      const paidPanel = buildPaidSeatCard(state, i);
      paidPanel.style.flex  = '1';
      paidPanel.style.width = '0';
      container.appendChild(paidPanel);
      continue;
    }
    let panel = buildSeatCard(state, i);
    panel.style.flex  = '1';
    panel.style.width = '0';
    container.appendChild(panel);
  }

  const addTile = buildAddTile(state, { fullSize: true });
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
  const _id = (state && state._itemDiscounts) ? state._itemDiscounts : null;
  const _sd = (state && state._seatDiscounts) ? state._seatDiscounts : null;
  // Fastest path: seat-level cache stamped by _applyDiscount
  if (_sd && seat.id && _sd[seat.id]) return true;
  return seat.items.some((it) => {
    if (it.discount) return true;
    if (_id && it.item_id && _id[it.item_id]) return true;
    const raw = it.price || 0;
    const eff = it.effectivePrice != null ? it.effectivePrice : raw;
    return raw > 0 && (raw - eff) > 0.005;
  });
}

function buildItemBlock(state, seatIdx, itemIdx, modeB) {
  let item     = state.seats[seatIdx].items[itemIdx];
  const isVoided = !!item.voided;
  // Detect discount from explicit object OR from effectivePrice being lower than
  // the list price — the backend may only surface the discount at the order level
  // and not stamp a `discount` object on individual items after refresh.
  const _rawPrice   = item.price || 0;
  const _effPrice   = item.effectivePrice != null ? item.effectivePrice : _rawPrice;
  const _priceDelta = Math.round((_rawPrice - _effPrice) * 100) / 100;
  // Third/fourth detection paths: per-item and per-seat caches stamped by _applyDiscount.
  // The seat-level cache is the more reliable fallback since it doesn't depend on item_id.
  const _seatId     = state.seats[seatIdx] ? state.seats[seatIdx].id : null;
  const _stateDisc  = (state._itemDiscounts && item.item_id)
    ? (state._itemDiscounts[item.item_id] || null)
    : null;
  const _seatDisc   = (state._seatDiscounts && _seatId)
    ? (state._seatDiscounts[_seatId] || null)
    : null;
  const isDisc      = !!(item.discount) || (_priceDelta > 0.005) || !!_stateDisc || !!_seatDisc;
  // Prefer explicit discount object, then state cache, then price delta.
  const _discObj    = item.discount || null;
  const _itemCount  = state.seats[seatIdx] ? Math.max(state.seats[seatIdx].items.length, 1) : 1;
  const _discAmt    = _discObj
    ? (_discObj.amount || 0)
    : _stateDisc
    ? _stateDisc.amount
    : _seatDisc
    ? Math.round(_seatDisc.amount / _itemCount * 100) / 100
    : Math.round(_priceDelta * (item.qty || 1) * 100) / 100;
  let _discPctRaw = _discObj && _discObj.pct != null
    ? _discObj.pct
    : (_discObj && _discObj.label ? parseInt(_discObj.label, 10) : null);
  if (_discPctRaw == null) _discPctRaw = _stateDisc ? _stateDisc.pct : null;
  if (_discPctRaw == null) _discPctRaw = _seatDisc  ? _seatDisc.pct  : null;
  if (_discPctRaw == null && _rawPrice > 0 && _priceDelta > 0.005) {
    _discPctRaw = Math.round((_priceDelta / _rawPrice) * 100);
  }
  const isSent   = !!(item.sent_at || item.sent) && !isVoided;
  const isSel    = !isVoided && !!(state.selectedItems && state.selectedItems[seatIdx + `:${itemIdx}`]);

  let bevelLt = lightenHex(T.bg, 0.08);
  let bevelDk = darkenHex(T.bg, 0.2);

  // ── Item card ──────────────────────────────────────
  let card = document.createElement('div');
  card.style.background    = isSel ? T.green : T.well;
  card.style.borderTop     = `2px solid ${(isSel ? T.greenDk : bevelLt)}`;
  card.style.borderRight   = `2px solid ${(isSel ? T.greenDk : bevelDk)}`;
  card.style.borderBottom  = `2px solid ${(isSel ? T.greenDk : bevelDk)}`;
  card.style.borderRadius  = '8px';
  card.style.padding       = '6px 10px';
  card.style.cursor        = isVoided ? 'default' : 'pointer';
  card.style.pointerEvents = 'auto';
  card.style.touchAction   = 'manipulation';
  card.style.userSelect    = 'none';

  // Left border priority: selected > voided > discounted > sent > default
  let leftColor, leftShadow;
  if (isSel) {
    leftColor  = T.greenDk;
    leftShadow = `0 2px 0 ${T.greenDk}`;
  } else if (isVoided) {
    leftColor  = T.verm;
    leftShadow = `0 2px 0 ${T.vermDk}`;
  } else if (isDisc) {
    leftColor  = T.lavender;
    leftShadow = `0 2px 0 ${darkenHex(T.lavender, 0.3)}`;
  } else if (isSent) {
    leftColor  = T.green;
    leftShadow = `0 2px 0 ${T.greenDk}`;
  } else {
    leftColor  = T.moon;
    leftShadow = null;
  }
  card.style.borderLeft = `3px solid ${leftColor}`;
  if (leftShadow) card.style.boxShadow = leftShadow;

  // Mode B sent: all-4-borders green (unless discounted or selected)
  if (modeB && isSent && !isSel && !isDisc) {
    card.style.borderTop    = `2px solid ${T.green}`;
    card.style.borderRight  = `2px solid ${T.green}`;
    card.style.borderBottom = `2px solid ${T.green}`;
  }

  // ── Name + price row ──
  const mainRow = document.createElement('div');
  mainRow.style.display        = 'flex';
  mainRow.style.justifyContent = 'space-between';
  mainRow.style.alignItems     = 'center';
  mainRow.style.gap            = '6px';

  // Left cluster: name + optional discount badge
  const nameCluster = document.createElement('span');
  nameCluster.style.display    = 'flex';
  nameCluster.style.alignItems = 'center';
  nameCluster.style.gap        = '6px';
  nameCluster.style.flex       = '1';
  nameCluster.style.minWidth   = '0';

  const nameEl = document.createElement('span');
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
    const badgeText = _discPctRaw != null ? _discPctRaw + '% OFF' : 'DISC';

    const discBadge = document.createElement('span');
    discBadge.style.fontFamily    = T.fh;
    discBadge.style.fontWeight    = T.fwBold;
    discBadge.style.fontSize      = '10px';
    discBadge.style.letterSpacing = '0.06em';
    discBadge.style.color         = isSel ? T.well : T.lavender;
    discBadge.style.background    = isSel ? hexToRgba(T.lavender, 0.35) : hexToRgba(T.lavender, 0.18);
    discBadge.style.border        = `1px solid ${(isSel ? hexToRgba(T.lavender, 0.5) : hexToRgba(T.lavender, 0.45))}`;
    discBadge.style.borderRadius  = '4px';
    discBadge.style.padding       = '1px 5px';
    discBadge.style.flexShrink    = '0';
    discBadge.style.whiteSpace    = 'nowrap';
    discBadge.textContent         = badgeText;
    nameCluster.appendChild(discBadge);
  }

  // Void badge — shown inline next to name
  if (isVoided) {
    const voidBadge = document.createElement('span');
    voidBadge.style.fontFamily    = T.fh;
    voidBadge.style.fontWeight    = T.fwBold;
    voidBadge.style.fontSize      = '10px';
    voidBadge.style.letterSpacing = '0.06em';
    voidBadge.style.color         = T.verm;
    voidBadge.style.background    = hexToRgba(T.verm, 0.12);
    voidBadge.style.border        = `1px solid ${hexToRgba(T.verm, 0.4)}`;
    voidBadge.style.borderRadius  = '4px';
    voidBadge.style.padding       = '1px 5px';
    voidBadge.style.flexShrink    = '0';
    voidBadge.style.whiteSpace    = 'nowrap';
    voidBadge.textContent         = 'VOID';
    nameCluster.appendChild(voidBadge);
  }

  mainRow.appendChild(nameCluster);

  const priceEl = document.createElement('span');
  priceEl.style.fontFamily      = T.fb;
  priceEl.style.fontWeight      = T.fwBold;
  priceEl.style.fontSize        = modeB ? '14px' : T.fsB3;
  priceEl.style.color           = isSel ? T.well : (isVoided ? T.moon : T.gold);
  priceEl.style.flexShrink      = '0';
  priceEl.style.textDecoration  = isVoided ? 'line-through' : 'none';
  priceEl.style.opacity         = isVoided ? '0.6' : '1';
  const ep = item.effectivePrice != null ? item.effectivePrice : (item.price || 0);
  priceEl.textContent = fmt((item.qty || 1) * ep);
  mainRow.appendChild(priceEl);
  card.appendChild(mainRow);

  // ── Discount row — original price (struck) + savings amount ──
  if (isDisc) {
    const discRow = document.createElement('div');
    discRow.style.display        = 'flex';
    discRow.style.justifyContent = 'space-between';
    discRow.style.alignItems     = 'baseline';
    discRow.style.gap            = '6px';
    discRow.style.marginTop      = '3px';
    discRow.style.paddingTop     = '2px';

    const origPrice = _rawPrice;
    const discOrig = document.createElement('span');
    discOrig.style.fontFamily     = T.fb;
    discOrig.style.fontSize       = T.fsB4;
    discOrig.style.color          = isSel ? hexToRgba(T.well, 0.6) : hexToRgba(T.lavender, 0.6);
    discOrig.style.textDecoration = 'line-through';
    discOrig.style.flex           = '1';
    discOrig.textContent          = `was ${fmt((item.qty || 1) * origPrice)}`;
    discRow.appendChild(discOrig);

    const discAmt = document.createElement('span');
    discAmt.style.fontFamily = T.fb;
    discAmt.style.fontSize   = T.fsB4;
    discAmt.style.fontWeight = T.fwBold;
    discAmt.style.color      = isSel ? T.well : T.lavender;
    discAmt.textContent      = `-${fmt(_discAmt)}`;
    discRow.appendChild(discAmt);
    card.appendChild(discRow);
  }

  if (!isVoided) {
    card.addEventListener('pointerup', (e) => {
      if (e.defaultPrevented) return;
      toggleItem(state, seatIdx, itemIdx);
    });
  }

  // ── Mod tree ──────────────────────────────────────
  const mods = item.mods || [];
  const block = document.createElement('div');
  block.style.display       = 'flex';
  block.style.flexDirection = 'column';
  block.appendChild(card);

  if (mods.length > 0) {
    const tree = document.createElement('div');
    tree.style.position    = 'relative';
    tree.style.display     = 'flex';
    tree.style.flexDirection = 'column';
    tree.style.gap         = '3px';
    tree.style.marginTop   = '4px';
    tree.style.marginLeft  = '10px';
    tree.style.paddingLeft = '16px';

    // Vertical stem — always T.text
    const stem = document.createElement('div');
    stem.style.position   = 'absolute';
    stem.style.left       = '6px';
    stem.style.top        = '0';
    stem.style.bottom     = '12px';
    stem.style.width      = '2px';
    stem.style.background = T.text;
    tree.appendChild(stem);

    for (let mi = 0; mi < mods.length; mi++) {
      const mod = mods[mi];
      let entry = document.createElement('div');
      entry.style.position   = 'relative';
      entry.style.display    = 'flex';
      entry.style.alignItems = 'center';
      entry.style.gap        = '5px';

      // Horizontal branch — always T.text
      const branch = document.createElement('div');
      branch.style.position   = 'absolute';
      branch.style.left       = '-10px';
      branch.style.top        = '50%';
      branch.style.width      = '10px';
      branch.style.height     = '2px';
      branch.style.background = T.text;
      entry.appendChild(branch);

      // Pill borders change by state, connectors stay white
      const pill = document.createElement('div');
      pill.style.flex            = '1';
      pill.style.display         = 'flex';
      pill.style.alignItems      = 'baseline';
      pill.style.justifyContent  = 'space-between';
      pill.style.gap             = '6px';
      pill.style.padding         = '3px 8px';
      pill.style.background      = T.card;
      pill.style.borderRadius    = '6px';

      if (isVoided) {
        pill.style.borderLeft   = `1px solid ${hexToRgba(T.verm, 0.5)}`;
        pill.style.borderTop    = `1px solid ${hexToRgba(T.verm, 0.3)}`;
        pill.style.borderRight  = `1px solid ${bevelDk}`;
        pill.style.borderBottom = `1px solid ${bevelDk}`;
      } else if (isDisc) {
        pill.style.borderLeft   = `1px solid ${T.lavender}`;
        pill.style.borderTop    = `1px solid ${hexToRgba(T.lavender, 0.4)}`;
        pill.style.borderRight  = `1px solid ${bevelDk}`;
        pill.style.borderBottom = `1px solid ${bevelDk}`;
        pill.style.boxShadow    = `0 2px 0 ${darkenHex(T.lavender, 0.3)}`;
      } else if (isSent) {
        pill.style.border = `1px solid ${hexToRgba(T.green, 0.4)}`;
      } else {
        pill.style.borderTop    = `1px solid ${bevelLt}`;
        pill.style.borderLeft   = `1px solid ${bevelLt}`;
        pill.style.borderRight  = `1px solid ${bevelDk}`;
        pill.style.borderBottom = `1px solid ${bevelDk}`;
      }

      const modName = document.createElement('span');
      modName.style.fontFamily = T.fb;
      modName.style.fontSize   = modeB ? '11px' : T.fsB4;
      modName.style.fontStyle  = 'italic';
      modName.style.color      = isVoided ? T.moon : T.text;
      modName.textContent      = mod.name || '';
      pill.appendChild(modName);

      if (mod.charged && mod.price > 0) {
        const modPrice = document.createElement('span');
        modPrice.style.fontFamily = T.fb;
        modPrice.style.fontSize   = modeB ? '11px' : T.fsB4;
        modPrice.style.fontWeight = T.fwBold;
        modPrice.style.color      = isVoided ? T.moon : T.gold;
        modPrice.style.flexShrink = '0';
        modPrice.textContent      = `+${fmt(mod.price)}`;
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
    const sentRow = document.createElement('div');
    sentRow.style.display    = 'flex';
    sentRow.style.alignItems = 'stretch';

    block.style.width    = '50%';
    block.style.minWidth = '170px';

    sentRow.appendChild(block);

    const info = document.createElement('div');
    info.style.display        = 'flex';
    info.style.flexDirection  = 'column';
    info.style.alignItems     = 'center';
    info.style.justifyContent = 'center';
    info.style.paddingLeft    = '8px';
    info.style.gap            = '4px';

    const chevron = document.createElement('span');
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
      const _sentLabel = ((raw) => {
        const d = new Date(raw);
        if (!isNaN(d.getTime())) {
          let h = d.getHours(), m = d.getMinutes();
          const ampm = h >= 12 ? 'PM' : 'AM';
          h = h % 12 || 12;
          return h + `:${(m < 10 ? '0' : '')}${m} ${ampm}`;
        }
        // Fallback: already a short string (e.g. '2:15 PM')
        return raw;
      })(item.sent_at);
      const sentTime = document.createElement('span');
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
  let seat     = state.seats[seatIdx];
  const bevelLt  = lightenHex(T.bg, 0.08);
  const bevelDk  = darkenHex(T.bg, 0.2);
  const hasDisc  = _seatHasDisc(seat, state);
  const isSeatSel = !!(state.selected && state.selected[seat.id]);

  const card = document.createElement('div');
  card.style.position      = 'relative';
  card.style.flex          = '1';
  card.style.minWidth      = '0';
  card.style.display       = 'flex';
  card.style.flexDirection = 'column';
  card.style.overflowY     = 'auto';
  card.style.overflowX     = 'hidden';
  card.style.background    = T.card;
  card.style.borderTop     = `3px solid ${bevelLt}`;
  card.style.borderLeft    = `4px solid ${(isSeatSel ? T.greenDk : (hasDisc ? T.lavender : T.green))}`;
  card.style.borderRight   = `3px solid ${bevelDk}`;
  card.style.borderBottom  = `3px solid ${bevelDk}`;
  card.style.borderRadius  = T.chamferCard + 'px';
  card.style.scrollbarWidth     = 'none';
  card.style.msOverflowStyle    = 'none';
  card.style.touchAction        = 'pan-y';
  card.style.pointerEvents      = 'auto';

  // ── Sticky header ──

  let hdr = document.createElement('div');
  hdr.style.position      = 'sticky';
  hdr.style.top           = '0';
  hdr.style.zIndex        = '2';
  hdr.style.background    = isSeatSel ? T.green : T.well;
  hdr.style.padding       = '8px 12px';
  hdr.style.borderBottom  = `2px solid ${(isSeatSel ? T.greenDk : bevelDk)}`;
  hdr.style.display       = 'flex';
  hdr.style.alignItems    = 'baseline';
  hdr.style.justifyContent = 'space-between';
  hdr.style.cursor        = 'pointer';
  hdr.style.userSelect    = 'none';
  hdr.style.pointerEvents = 'auto';
  hdr.style.touchAction   = 'manipulation';
  hdr.style.flexShrink    = '0';

  const hdrLeft = document.createElement('div');
  hdrLeft.style.display    = 'flex';
  hdrLeft.style.alignItems = 'baseline';
  hdrLeft.style.gap        = '8px';

  let seatNum = document.createElement('span');
  seatNum.textContent      = `S${(seat.number != null ? seat.number : (seatIdx + 1))}`;
  seatNum.style.fontFamily = T.fh;
  seatNum.style.fontWeight = T.fwBold;
  seatNum.style.fontSize   = '24px';
  seatNum.style.color      = isSeatSel ? T.well : (hasDisc ? T.lavender : T.green);
  hdrLeft.appendChild(seatNum);

  const seatSbtl = document.createElement('span');
  seatSbtl.textContent      = fmt(seatTotal(seat, state));
  seatSbtl.style.fontFamily = T.fb;
  seatSbtl.style.fontWeight = T.fwBold;
  seatSbtl.style.fontSize   = '17px';
  seatSbtl.style.color      = isSeatSel ? T.well : (hasDisc ? T.lavender : T.gold);
  hdrLeft.appendChild(seatSbtl);
  hdr.appendChild(hdrLeft);

  if (seat.name) {
    const seatPname = document.createElement('span');
    seatPname.textContent      = `"${seat.name}"`;
    seatPname.style.fontFamily = T.fb;
    seatPname.style.fontSize   = T.fsB4;
    seatPname.style.color      = T.text;
    seatPname.style.fontStyle  = 'italic';
    hdr.appendChild(seatPname);
  }

  hdr.addEventListener('pointerup', (e) => {
    if (e.defaultPrevented) return;
    toggleSeat(state, seat.id);
  });
  card.appendChild(hdr);

  // ── Items ──
  const itemsWrap = document.createElement('div');
  itemsWrap.style.padding       = '6px 8px 8px';
  itemsWrap.style.display       = 'flex';
  itemsWrap.style.flexDirection = 'column';
  itemsWrap.style.gap           = '5px';

  if (seat.items.length === 0) {
    let empty = document.createElement('div');
    empty.textContent      = 'empty seat';
    empty.style.textAlign  = 'center';
    empty.style.padding    = '20px 0';
    empty.style.fontFamily = T.fb;
    empty.style.fontSize   = T.fsB3;
    empty.style.color      = T.moon;
    empty.style.fontStyle  = 'italic';
    itemsWrap.appendChild(empty);
  } else {
    for (let ii = 0; ii < seat.items.length; ii++) {
      itemsWrap.appendChild(buildItemBlock(state, seatIdx, ii, false));
    }
  }
  card.appendChild(itemsWrap);

  let canDelete = seat.items.length === 0
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
  const row = document.createElement('div');
  Object.assign(row.style, {
    display:       'flex',
    alignItems:    'center',
    justifyContent:'space-between',
    padding:       '9px 12px',
    borderBottom:  `1px solid ${hexToRgba(T.gold, 0.18)}`,
    cursor:        'pointer',
    userSelect:    'none',
    background:    'transparent',
    touchAction:   'manipulation',
  });

  const left = document.createElement('div');
  Object.assign(left.style, {
    fontWeight: T.fwBold,
    display:    'flex',
    gap:        '8px',
    alignItems: 'center',
    fontFamily: T.fb,
    fontSize:   T.fsB3,
    color:      T.gold,
  });

  const methodEl = document.createElement('span');
  Object.assign(methodEl.style, {
    fontWeight:    T.fwBold,
    letterSpacing: '0.06em',
    textTransform: 'uppercase',
  });
  methodEl.textContent = pmt.method || 'payment';
  left.appendChild(methodEl);

  const sep1 = document.createElement('span');
  sep1.style.color   = hexToRgba(T.gold, 0.4);
  sep1.textContent   = '·';
  left.appendChild(sep1);

  // Seat numbers this payment covers
  let seatNums = Array.isArray(pmt.seat_numbers) ? pmt.seat_numbers : [];
  const seatLabel = seatNums.map((n) => `S${n}`).join(', ') || seatId;
  const seatEl = document.createElement('span');
  seatEl.style.color = hexToRgba(T.gold, 0.7);
  seatEl.textContent = seatLabel;
  left.appendChild(seatEl);

  if (state.checkNumber) {
    const sep2 = document.createElement('span');
    sep2.style.color   = hexToRgba(T.gold, 0.4);
    sep2.textContent   = '·';
    left.appendChild(sep2);

    const checkEl = document.createElement('span');
    checkEl.style.color = hexToRgba(T.gold, 0.7);
    checkEl.textContent = state.checkNumber;
    left.appendChild(checkEl);
  }

  row.appendChild(left);

  const amountEl = document.createElement('div');
  Object.assign(amountEl.style, {
    fontFamily: T.fb,
    fontWeight: T.fwBold,
    fontSize:   T.fsB3,
    color:      T.gold,
  });
  amountEl.textContent = fmt(pmt.amount || 0);
  row.appendChild(amountEl);

  row.addEventListener('pointerup', (e) => {
    if (e.defaultPrevented) return;
    openSeatPaymentInterrupt(state, seatId, [pmt]);
  });

  return row;
}

// Mode B left-column panel shown when a paid tile is selected.
function _buildPaidRecapPanel(state, seatId) {
  let seatIdx = -1;
  for (let i = 0; i < state.seats.length; i++) {
    if (state.seats[i].id === seatId) { seatIdx = i; break; }
  }
  let seat     = seatIdx >= 0 ? state.seats[seatIdx] : null;
  let payments = state.seatPayments[seatId] || [];
  const seatNum  = seat ? (seat.number != null ? seat.number : seatIdx + 1) : '?';

  const panel = document.createElement('div');
  Object.assign(panel.style, {
    display:       'flex',
    flexDirection: 'column',
    width:         '100%',
  });

  // Header bar
  let hdr = document.createElement('div');
  Object.assign(hdr.style, {
    background:    T.gold,
    padding:       '10px 14px',
    display:       'flex',
    alignItems:    'center',
    justifyContent:'space-between',
    borderRadius:  '8px 8px 0 0',
    userSelect:    'none',
  });
  const titleEl = document.createElement('div');
  Object.assign(titleEl.style, {
    color:      T.moonText,
    fontFamily: T.fh,
    fontWeight: T.fwBold,
    fontSize:   T.fsB2,
  });
  titleEl.textContent = `S${seatNum} — PAID`;
  hdr.appendChild(titleEl);

  if (seat) {
    let totalEl = document.createElement('div');
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
  let body = document.createElement('div');
  Object.assign(body.style, {
    background:    hexToRgba(T.gold, 0.06),
    borderRadius:  '0 0 8px 8px',
    overflow:      'hidden',
  });

  if (payments.length === 0) {
    let empty = document.createElement('div');
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
    payments.forEach((pmt) => {
      body.appendChild(_buildPaymentRow(state, seatId, pmt));
    });
  }
  panel.appendChild(body);

  return panel;
}

// Paid seat card (Mode A) — gold-infilled; body shows tappable payment rows.
function buildPaidSeatCard(state, seatIdx) {
  let seat = state.seats[seatIdx];
  const payments = state.seatPayments[seat.id] || [];

  let wrap = buildStaticCard({ accent: T.gold });
  wrap.style.flex          = '1';
  wrap.style.padding       = '0';
  wrap.style.display       = 'flex';
  wrap.style.flexDirection = 'column';
  wrap.style.overflow      = 'hidden';

  // ── Gold header ──
  let hdr = document.createElement('div');
  Object.assign(hdr.style, {
    background:     T.gold,
    padding:        '8px 12px',
    borderBottom:   `1px solid ${T.goldDk}`,
    display:        'flex',
    alignItems:     'center',
    justifyContent: 'space-between',
    userSelect:     'none',
  });

  let label = document.createElement('div');
  Object.assign(label.style, {
    color:      T.moonText,
    fontFamily: T.fh,
    fontWeight: T.fwBold,
  });
  label.textContent = `S${(seat.number != null ? seat.number : (seatIdx + 1))}`;
  hdr.appendChild(label);

  const rightSide = document.createElement('div');
  rightSide.style.cssText = 'display:flex;align-items:center;gap:8px;';

  let subtotal = document.createElement('div');
  Object.assign(subtotal.style, {
    color:      T.moonText,
    fontFamily: T.fb,
    fontWeight: T.fwBold,
  });
  subtotal.textContent = fmt(seatTotal(seat, state));
  rightSide.appendChild(subtotal);

  const paidBadge = document.createElement('div');
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
  let body = document.createElement('div');
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
    let empty = document.createElement('div');
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
    payments.forEach((pmt) => {
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
  let seat = state.seats[seatIdx];
  // Tile focus uses focusedSeats (by seat ID) — filter only, no payment selection.
  const tileActive = !!(state.focusedSeats && state.focusedSeats[seat.id]);

  let wrap = buildActionCard({ accent: T.moon });
  wrap.style.padding       = '0';
  wrap.style.display       = 'flex';
  wrap.style.flexDirection = 'column';
  wrap.style.overflow      = 'hidden';
  wrap.style.minHeight     = '90px';
  wrap.style.background    = T.well;
  wrap.style.border        = `1px solid ${T.moon}`;
  wrap.style.boxShadow     = `0 2px 0 ${T.moonDk}`;

  wrap.addEventListener('pointerup', (e) => {
    if (e.defaultPrevented) return;
    if (state.focusedSeats[seat.id]) delete state.focusedSeats[seat.id];
    else state.focusedSeats[seat.id] = true;
    rerenderTopArea(state);
  });

  // Header: floods T.green when tile is selected
  let hdr = document.createElement('div');
  Object.assign(hdr.style, {
    background:    tileActive ? T.green : T.well,
    padding:       '6px 10px',
    borderBottom:  `1px solid ${T.border}`,
    pointerEvents: 'auto',
    touchAction:   'manipulation',
  });
  let label = document.createElement('div');
  Object.assign(label.style, {
    color:      tileActive ? T.moonText : T.moon,
    fontFamily: T.fh,
    fontWeight: T.fwBold,
  });
  label.textContent = `S${(seat.number != null ? seat.number : (seatIdx + 1))}`;
  hdr.appendChild(label);
  wrap.appendChild(hdr);

  // Body: subtotal only — no item count
  let body = document.createElement('div');
  Object.assign(body.style, {
    flex:           '1',
    display:        'flex',
    alignItems:     'center',
    justifyContent: 'center',
    padding:        '8px',
  });
  let totalEl = document.createElement('div');
  Object.assign(totalEl.style, {
    color:      tileActive ? T.green : T.gold,
    fontFamily: T.fb,
    fontSize:   T.fsB1,
    fontWeight: T.fwBold,
  });
  totalEl.textContent = fmt(seatTotal(seat, state));
  body.appendChild(totalEl);
  wrap.appendChild(body);

  const canDelete = seat.items.length === 0
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
  let seat = state.seats[seatIdx];
  const isSelected = state._selectedPaidSeat === seat.id;

  let wrap = buildActionCard({ accent: T.gold });
  wrap.style.padding       = '0';
  wrap.style.display       = 'flex';
  wrap.style.flexDirection = 'column';
  wrap.style.overflow      = 'hidden';
  wrap.style.minHeight     = '90px';
  wrap.style.background    = isSelected ? T.gold : hexToRgba(T.gold, 0.18);

  wrap.addEventListener('pointerup', (e) => {
    if (e.defaultPrevented) return;
    state._selectedPaidSeat = isSelected ? null : seat.id;
    rerenderTopArea(state);
  });

  const hdr = document.createElement('div');
  Object.assign(hdr.style, {
    background:     isSelected ? darkenHex(T.gold, 0.15) : T.gold,
    padding:        '6px 12px',
    borderBottom:   `1px solid ${T.goldDk}`,
    display:        'flex',
    alignItems:     'center',
    justifyContent: 'space-between',
  });
  const label = document.createElement('div');
  Object.assign(label.style, {
    color:      T.moonText,
    fontFamily: T.fh,
    fontWeight: T.fwBold,
  });
  label.textContent = `S${(seat.number != null ? seat.number : (seatIdx + 1))}`;
  hdr.appendChild(label);
  const badge = document.createElement('div');
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

  const body = document.createElement('div');
  Object.assign(body.style, {
    flex:           '1',
    display:        'flex',
    alignItems:     'center',
    justifyContent: 'center',
    padding:        '10px',
  });
  const totalEl = document.createElement('div');
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
  const wrap = buildStaticCard({ accent: T.green });
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

  const plus = document.createElement('div');
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
  let lpTimer = null;
  let longPressed = false;
  wrap.addEventListener('pointerdown', () => {
    longPressed = false;
    lpTimer = setTimeout(() => {
      longPressed = true;
      lpTimer = null;
      SceneManager.interrupt('seat-count', {
        onConfirm: (n) => { addSeatsBatch(state, n); },
        onCancel:  () => {},
      });
    }, 550);
  });
  wrap.addEventListener('pointerup', () => {
    if (lpTimer) { clearTimeout(lpTimer); lpTimer = null; }
    if (longPressed) { longPressed = false; return; }
    addSeat(state);
  });
  wrap.addEventListener('pointerleave', () => {
    if (lpTimer) { clearTimeout(lpTimer); lpTimer = null; }
    longPressed = false;
  });
  wrap.addEventListener('pointercancel', () => {
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
  let used = {};
  for (let i = 0; i < state.seats.length; i++) { used[state.seats[i].number] = true; }
  let next = 1;
  for (let j = 0; j < n; j++) {
    while (used[next]) next++;
    let num = next;
    used[next] = true;
    state.seats.push({
      id:     `S-${String(num).padStart(3, '0')}`,
      number: num,
      items:  [],
    });
  }
  state.seats.sort((a, b) => a.number - b.number);
  persistSeats(state);
  rerenderTopArea(state);
}

// ═══════════════════════════════════════════════════
//  TAP + LONG-PRESS WIRING
// ═══════════════════════════════════════════════════

function _wireHeaderTaps(state, seatId, el) {
  let lpTimer = null;
  let didLongPress = false;

  el.addEventListener('pointerdown', () => {
    didLongPress = false;
    lpTimer = setTimeout(() => {
      didLongPress = true;
      openSeatMenu(state, seatId);
    }, 550);
    state._lpTimers.push(lpTimer);
  });
  el.addEventListener('pointerup', () => {
    if (lpTimer) { clearTimeout(lpTimer); lpTimer = null; }
    if (didLongPress) { didLongPress = false; return; }
    // Tap = toggle selection (but paid seats go to reopen flow)
    if (state.paidSeats[seatId]) {
      reopenSeat(state, seatId);
      return;
    }
    toggleSeat(state, seatId);
  });
  el.addEventListener('pointerleave', () => {
    if (lpTimer) { clearTimeout(lpTimer); lpTimer = null; }
    didLongPress = false;
  });
  el.addEventListener('pointercancel', () => {
    if (lpTimer) { clearTimeout(lpTimer); lpTimer = null; }
    didLongPress = false;
  });
}

function _wireItemTaps(state, seatIdx, itemIdx, el) {
  let lpTimer = null;
  let didLongPress = false;
  let key = seatIdx + `:${itemIdx}`;

  el.addEventListener('pointerdown', () => {
    didLongPress = false;
    lpTimer = setTimeout(() => {
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
  el.addEventListener('pointerup', () => {
    if (lpTimer) { clearTimeout(lpTimer); lpTimer = null; }
    if (didLongPress) { didLongPress = false; return; }
    toggleItem(state, seatIdx, itemIdx);
  });
  el.addEventListener('pointerleave', () => {
    if (lpTimer) { clearTimeout(lpTimer); lpTimer = null; }
    didLongPress = false;
  });
  el.addEventListener('pointercancel', () => {
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
  const next = {};
  // Carry empty-seat selections forward — they have no items to
  // mirror, so they persist based on explicit toggleSeat taps until
  // the cashier untaps them (or ADD ITEMS populates the seat).
  if (state.selected) {
    for (let i = 0; i < state.seats.length; i++) {
      let s = state.seats[i];
      if (state.paidSeats && state.paidSeats[s.id]) continue;
      if (s.items.length === 0 && state.selected[s.id]) {
        next[s.id] = true;
      }
    }
  }
  // Non-empty seats are "fully selected" iff every one of their items
  // is in state.selectedItems.
  for (let i2 = 0; i2 < state.seats.length; i2++) {
    const s2 = state.seats[i2];
    if (state.paidSeats && state.paidSeats[s2.id]) continue;
    if (!s2.items.length) continue;
    let all = true;
    let hasSelectable = false;
    for (let j = 0; j < s2.items.length; j++) {
      if (s2.items[j].voided) continue;
      hasSelectable = true;
      if (!state.selectedItems[i2 + `:${j}`]) { all = false; break; }
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
  let seatIdx = -1;
  for (let i = 0; i < state.seats.length; i++) {
    if (state.seats[i].id === seatId) { seatIdx = i; break; }
  }
  if (seatIdx < 0) return;
  let seat = state.seats[seatIdx];
  if (!state.selectedItems) state.selectedItems = {};
  if (!state.selected)      state.selected      = {};

  if (seat.items.length === 0) {
    if (state.selected[seatId]) delete state.selected[seatId];
    else                         state.selected[seatId] = true;
    rerenderTopArea(state);
    return;
  }

  let allSelected = true;
  for (let j = 0; j < seat.items.length; j++) {
    if (seat.items[j].voided) continue;
    if (!state.selectedItems[seatIdx + `:${j}`]) { allSelected = false; break; }
  }
  for (let k = 0; k < seat.items.length; k++) {
    if (seat.items[k].voided) continue;
    const key = seatIdx + `:${k}`;
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
  for (let i = 0; i < state.seats.length; i++) {
    let seat = state.seats[i];
    if (state.paidSeats && state.paidSeats[seat.id]) continue;
    if (seat.items.length === 0) {
      state.selected[seat.id] = true;
    } else {
      for (let j = 0; j < seat.items.length; j++) {
        if (seat.items[j].voided) continue;
        state.selectedItems[i + `:${j}`] = true;
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
  const used = {};
  for (let i = 0; i < state.seats.length; i++) { used[state.seats[i].number] = true; }
  let num = 1;
  while (used[num]) num++;
  state.seats.push({
    id:     `S-${String(num).padStart(3, '0')}`,
    number: num,
    items:  [],
  });
  state.seats.sort((a, b) => a.number - b.number);
  persistSeats(state);
  rerenderTopArea(state);
}

function deleteSeat(state, seatId) {
  let seatIdx = -1;
  for (let i = 0; i < state.seats.length; i++) {
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
      ctx: { orderId: state.orderId, seatId },
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
  const _prevChain = state._seatsChain || Promise.resolve();
  const myChain = _prevChain.then(() => {
    const nums = state.seats.map((s) => s.number);
    if (nums.length === 0) return;
    return fetchWithTimeout(`/api/v1/orders/${state.orderId}/seats`, {
      method:  'PUT',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ seat_numbers: nums }),
    }, 15000)
      .then(() => {
        SceneManager.emit('order:updated', { orderId: state.orderId });
      })
      .catch((err) => {
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
  myChain.then(() => {
    if (state._seatsChain === myChain) state._seatsChain = null;
  }, () => {
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
  const persistedItems = items.filter((it) => !!it.item_id);
  if (persistedItems.length === 0) return Promise.resolve();

  const promises = persistedItems.map((it) => {
    return fetchWithTimeout(`/api/v1/orders/${state.orderId}/items/${it.item_id}`, {
      method:  'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ seat_number: it.seat_number }),
    }, 15000);
  });

  return Promise.allSettled(promises).then((results) => {
    const failed = results.filter((r) => r.status === 'rejected' || !r.value.ok);
    if (failed.length > 0) {
      console.warn('[KINDpos] Some item seat updates failed:', failed.length);
      entReport({
        code: 'UI-009', level: 'WARNING',
        source: 'check-overview.persistItemSeats',
        message: `PATCH /items/{id} failed for ${failed.length} items`,
        ctx: { orderId: state.orderId, count: failed.length },
      });
    }
  });
}

// Tiny × button overlay for empty seats. Tapping removes the seat.
function _buildDeleteSeatX(state, seatId) {
  const x = document.createElement('div');
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
  x.addEventListener('pointerdown', (e) => {
    e.stopPropagation();
    e.preventDefault();
  });
  x.addEventListener('pointerup',   (e) => {
    e.stopPropagation();
    e.preventDefault();
    deleteSeat(state, seatId);
  });
  x.addEventListener('click', (e) => {
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
  fetchWithTimeout(`/api/v1/orders/${state.orderId}/print/receipt`, { method: 'POST' }, 8000)
    .then((r) => {
      state._printing = false;
      if (r.ok) showToast('Receipt printed', { bg: T.greenWarm });
      else      showToast('Print failed', { bg: T.verm });
    })
    .catch(() => { state._printing = false; showToast('Print failed', { bg: T.verm }); });
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
  fetchWithTimeout(`/api/v1/orders/${state.orderId}/resend`, { method: 'POST' }, 8000)
    .then((r) => {
      state._resending = false;
      if (r.ok) showToast('Kitchen ticket sent', { bg: T.greenWarm });
      else      showToast('Resend failed', { bg: T.verm });
    })
    .catch(() => { state._resending = false; showToast('Resend failed', { bg: T.verm }); });
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
  if (state._paymentInProgress) {
    showToast('Payment already in progress.', { bg: T.gold });
    return;
  }

  if (state._voidInProgress) {
    showToast('Please wait — void is still processing.', { bg: T.gold });
    return;
  }

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

  const selectedIds = getSelectedSeatIds(state);
  if (selectedIds.length === 0) {
    // No seats selected — default to "pay whole check" (all non-paid seats
    // with items on them).
    for (let i = 0; i < state.seats.length; i++) {
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
  const seatSummary = [];
  for (let s = 0; s < state.seats.length; s++) {
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
  let totalUnpaidWithItems = 0;
  for (let ui = 0; ui < state.seats.length; ui++) {
    if (!state.paidSeats[state.seats[ui].id] && state.seats[ui].items.length > 0)
      totalUnpaidWithItems++;
  }
  const isLastPayment = seatSummary.length >= totalUnpaidWithItems;

  // Pre-seed totals from the seats we're about to pay — not state.order.total.
  // state.order.total is the whole-check total and can be stale or zero when
  // the user pays a subset of seats; this mirrors renderActionBar's own
  // selection-aware totals calc so what payment shows matches what was just
  // displayed on the overview. effectivePrice is always server-sourced via
  // refreshOrder(), so these are not arbitrary client-side values.
  const discount = getCashDiscount();
  const taxRate  = getTaxRate();
  let subtotal = 0;
  for (let ssI = 0; ssI < seatSummary.length; ssI++) {
    const ssItems = seatSummary[ssI].items || [];
    for (let iI = 0; iI < ssItems.length; iI++) {
      let it = ssItems[iI];
      if (it.voided) continue;
      let p = (it.effectivePrice != null) ? it.effectivePrice : (it.price || 0);
      subtotal += (it.qty || 0) * p;
    }
  }
  subtotal      = Math.round(subtotal * 100) / 100;
  const tax       = Math.round(subtotal * taxRate * 100) / 100;
  const cardTotal = Math.round((subtotal + tax) * 100) / 100;
  const cashPrice = Math.round(cardTotal * (1 - discount) * 100) / 100;

  // Pre-flight: verify balance_due > 0 and order still open before mounting
  // the payment scene. Uses the freshest server state to avoid launching
  // payment against a check that was just closed or fully paid elsewhere.
  function _launchPayment() {
    fetchWithTimeout(`/api/v1/orders/${state.orderId}`, { cache: 'no-store' }, 10000)
      .then((r) => r.ok ? r.json() : null)
      .then((freshOrder) => {
        state._payingInProgress = false;
        if (!state._alive) return;
        if (!freshOrder) {
          showToast('Could not verify check — try again', { bg: T.verm });
          return;
        }
        const freshStatus = freshOrder.status || '';
        if (freshStatus === 'closed' || freshStatus === 'paid') {
          showToast('Check already settled', { bg: T.gold });
          return;
        }
        if (!(freshOrder.balance_due > 0)) {
          showToast('Nothing is owed on this check', { bg: T.gold });
          return;
        }
        state._paymentInProgress = true;
        SceneManager.mountWorking('payment', {
          orderId:              state.orderId,
          seatIds:              selectedIds,
          seats:                seatSummary,
          cardTotal:            cardTotal,
          cashPrice:            cashPrice,
          subtotal:             subtotal,
          tax:                  tax,
          managerDiscountTotal: freshOrder.manager_discount_total || 0,
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
          onComplete:   () => { state._paymentInProgress = false; },
          onCancel:     () => { state._paymentInProgress = false; },
        });
      })
      .catch(() => {
        state._payingInProgress = false;
        showToast('Could not verify check — try again', { bg: T.verm });
      });
  }

  const orderItems = (state.order && state.order.items) || [];
  const unassigned = orderItems.filter(
    (it) => !it.voided && (!it.seat_number || it.seat_number === 0)
  );
  if (unassigned.length > 0) {
    SceneManager.interrupt('co-unassigned-warn', {
      count:     unassigned.length,
      onConfirm: () => { _launchPayment(); },
      onCancel:  () => { state._payingInProgress = false; },
    });
  } else {
    _launchPayment();
  }
}

// ═══════════════════════════════════════════════════
//  VOID  (items / seats with undo window)
// ═══════════════════════════════════════════════════

function handleVoid(state) {
  const orderStatus = state.order && state.order.status;
  if (orderStatus === 'closed' || orderStatus === 'paid') {
    showToast('Cannot void items on a closed check.', { bg: T.verm });
    return;
  }

  let itemRefs = getSelectedItemRefs(state);
  let seatIds  = getSelectedSeatIds(state);

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
    for (let s = 0; s < seatIds.length; s++) {
      let sIdx = _seatIdxById(state, seatIds[s]);
      if (sIdx < 0) continue;
      for (let j = 0; j < state.seats[sIdx].items.length; j++) {
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

  // Filter out already-voided items before showing the PIN challenge.
  const nonVoidedRefs = itemRefs.filter((r) => {
    const item = state.seats[r.seatIdx] && state.seats[r.seatIdx].items[r.itemIdx];
    return item && !item.voided;
  });
  if (nonVoidedRefs.length === 0) {
    showToast('Selected items are already voided.', { bg: T.gold });
    return;
  }

  state._voidInProgress = true;
  SceneManager.interrupt('manager-pin', {
    context: 'void',
    onConfirm: (approvedBy) => {
      const paidSeats = state.paidSeats || {};
      const hasPaid = nonVoidedRefs.some((r) => {
        const seat = state.seats[r.seatIdx];
        return seat && paidSeats[seat.id];
      });
      if (hasPaid) {
        state._voidInProgress = false;
        showToast('Cannot void items on a paid seat.', { bg: T.verm });
        return;
      }
      _voidItems(state, nonVoidedRefs, approvedBy);
    },
    onCancel: () => { state._voidInProgress = false; },
  });
}

function _voidItems(state, refs, approvedBy) {
  const snapshot = [];
  for (let i = 0; i < refs.length; i++) {
    let r = refs[i];
    const item = state.seats[r.seatIdx].items[r.itemIdx];
    const alreadyVoided = !!item.voided;
    snapshot.push({ seatIdx: r.seatIdx, itemIdx: r.itemIdx, item, alreadyVoided });
    item.voided = true;
  }

  state.selectedItems = {};
  rerenderTopArea(state);

  if (!state.orderId) return;

  // Snapshot order and totals state before DELETEs fire so we can fully
  // restore the display — not just item voided flags — if any DELETE fails.
  const preVoidSnapshot = JSON.parse(JSON.stringify(state.order));

  // Fire DELETEs immediately — no undo window.
  const deletes = snapshot
    .filter((s) => !!s.item.item_id && !s.alreadyVoided)
    .map((s) => {
      const qs = approvedBy ? `?voided_by=${encodeURIComponent(approvedBy)}` : '';
      return fetchWithTimeout(
        `/api/v1/orders/${state.orderId}/items/${s.item.item_id}${qs}`,
        { method: 'DELETE' }, 8000
      ).then((r) => {
        if (!r.ok) throw new Error(r.status);
      });
    });

  Promise.allSettled(deletes)
    .then((results) => {
      const anyFailed = results.some((r) => r.status === 'rejected');
      if (anyFailed) {
        state._voidInProgress = false;
        // Restore order state and clear voided flags so the display
        // rolls back to match backend truth.
        state.order = preVoidSnapshot;
        for (let j = 0; j < snapshot.length; j++) {
          snapshot[j].item.voided = false;
        }
        entReport({
          code:    'VOID_DELETE_FAILED',
          level:   'ERROR',
          source:  'check-overview._voidItems',
          message: 'One or more void DELETE requests failed — order display rolled back',
          ctx:     { orderId: state.orderId },
        });
        if (!state._alive) return;
        rerenderTopArea(state);
        showToast('Void failed — please try again.', { bg: T.verm });
      } else {
        state._voidInProgress = false;
        // All DELETEs confirmed. Persist voided items in _voidedItems so
        // _injectVoidedItems restores them after every refreshOrder.
        if (!state._voidedItems) state._voidedItems = [];
        for (let _vi = 0; _vi < snapshot.length; _vi++) {
          const _ve = snapshot[_vi];
          const _vs = state.seats[_ve.seatIdx];
          if (!_vs) continue;
          const _dup = state._voidedItems.some((e) => e.item.item_id && e.item.item_id === _ve.item.item_id);
          if (!_dup) state._voidedItems.push({ seatNumber: _vs.number, item: _ve.item });
        }
      }
    });
}

function _injectVoidedItems(state) {
  if (!state._voidedItems || state._voidedItems.length === 0) return;
  for (let vi = 0; vi < state._voidedItems.length; vi++) {
    const entry = state._voidedItems[vi];
    let seat  = null;
    for (let si = 0; si < state.seats.length; si++) {
      if (state.seats[si].number === entry.seatNumber) { seat = state.seats[si]; break; }
    }
    if (!seat) continue;
    const already = seat.items.some((it) => it.item_id && it.item_id === entry.item.item_id);
    if (!already) seat.items.push(entry.item);
  }
}

function _seatIdxById(state, seatId) {
  for (let i = 0; i < state.seats.length; i++) {
    if (state.seats[i].id === seatId) return i;
  }
  return -1;
}

// ═══════════════════════════════════════════════════
//  DISCOUNT (manager PIN → % picker → apply)
// ═══════════════════════════════════════════════════

function handleDiscount(state) {
  if (state._discountInProgress) {
    showToast('Discount already being applied.', { bg: T.gold });
    return;
  }

  const itemRefs = getSelectedItemRefs(state);
  const seatIds  = getSelectedSeatIds(state);

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
  const _params = state._mountParams || {};
  const _isManager = (_params.role === 'manager') || (_params.employeeRole === 'manager');

  if (_isManager) {
    state._discountInProgress = true;
    SceneManager.interrupt('disc-select', {
      onConfirm: (opt) => {
        _applyDiscount(state, opt.pct, itemRefs, seatIds, _params.employeeId || 'manager');
      },
      onCancel: () => { state._discountInProgress = false; },
    });
    return;
  }

  state._discountInProgress = true;
  SceneManager.interrupt('manager-pin', {
    context: 'discount',
    onConfirm: (_pin, empId) => {
      SceneManager.interrupt('disc-select', {
        onConfirm: (opt) => {
          _applyDiscount(state, opt.pct, itemRefs, seatIds, empId);
        },
        onCancel: () => { state._discountInProgress = false; },
      });
    },
    onCancel: () => { state._discountInProgress = false; },
  });
}

function _applyDiscount(state, pct, itemRefs, seatIds, approvedBy) {
  // Track whether this is a whole-seat discount (selected by seat) vs item-level
  const isWholeSeatDiscount = itemRefs.length === 0 && seatIds.length > 0;
  // Expand seat selections into item refs
  if (isWholeSeatDiscount) {
    for (let s = 0; s < seatIds.length; s++) {
      let sIdx = _seatIdxById(state, seatIds[s]);
      if (sIdx < 0) continue;
      for (let j = 0; j < state.seats[sIdx].items.length; j++) {
        itemRefs.push({ seatIdx: sIdx, itemIdx: j });
      }
    }
  }

  // Collect the selected lines so the pure discount helpers (see
  // discount.js) can compute the dollar amount + item_ids and build
  // the wire body. Previously this was inlined with a TODO — discount
  // survived re-render but not refresh/re-login.
  const lines = [];
  for (let i = 0; i < itemRefs.length; i++) {
    let r = itemRefs[i];
    lines.push(state.seats[r.seatIdx].items[r.itemIdx]);
  }
  const hasUnsent = lines.some((it) => !it.item_id);
  if (hasUnsent) {
    state._discountInProgress = false;
    showToast('Send items to kitchen before applying a discount.', { bg: T.gold });
    return;
  }
  const amount = computeDiscountAmount(lines, pct);
  const itemIds = extractItemIds(lines);
  if (amount <= 0 || !state.orderId) {
    state._discountInProgress = false;
    showToast('Discount has no selected items', { bg: T.gold });
    return;
  }

  const discountTxId = `disc-${Date.now()}-${Math.random().toString(36).slice(2,8)}`;
  const discountBody = buildDiscountBody(pct, amount, itemIds, approvedBy);
  discountBody.idempotency_key = discountTxId;

  fetchWithTimeout(`/api/v1/orders/${state.orderId}/discount`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify(discountBody),
  }, 15000).then((r) => {
    if (!r.ok) return r.json().then((d) => { throw new Error(d.detail || `HTTP ${r.status}`); });
    return r.json();
  }).then((_discountResp) => {
    state._discountInProgress = false;
    if (!state._alive) return;
    // Cache per-item discount metadata so buildItemBlock can show lavender
    // treatment after refreshOrder (backend only updates manager_discount_total
    // at the order level — it does not stamp effectivePrice on individual items).
    if (!state._itemDiscounts) state._itemDiscounts = {};
    if (!state._seatDiscounts) state._seatDiscounts = {};
    for (let _di = 0; _di < lines.length; _di++) {
      const _dItem = lines[_di];
      const _dRef  = itemRefs[_di];
      const _dAmt  = Math.round((_dItem.price || 0) * (_dItem.qty || 1) * pct / 100 * 100) / 100;
      // Per-item cache (keyed by backend item_id)
      if (_dItem.item_id) {
        state._itemDiscounts[_dItem.item_id] = { pct, amount: _dAmt };
      }
      // Per-seat cache only for whole-seat discounts, not item-level discounts.
      // Item-level discounts should only be indicated via _itemDiscounts.
      if (isWholeSeatDiscount) {
        const _dSeat = _dRef && state.seats[_dRef.seatIdx];
        if (_dSeat && _dSeat.id) {
          if (!state._seatDiscounts[_dSeat.id]) {
            state._seatDiscounts[_dSeat.id] = { pct, amount: 0 };
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
  }).catch((err) => {
    state._discountInProgress = false;
    showToast(`Discount failed: ${(err && err.message ? err.message : 'unknown')}`, { bg: T.verm });
  });
}

// ═══════════════════════════════════════════════════
//  LONG-PRESS MENUS
// ═══════════════════════════════════════════════════

function openItemMenu(state, seatIdx, itemIdx) {
  // When long-pressed on an unselected item, select it first so the
  // menu acts on a clear single target.
  state.selectedItems = {};
  state.selectedItems[seatIdx + `:${itemIdx}`] = true;
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
    onConfirm: (optId) => { handleItemAction(state, optId, seatIdx, itemIdx); },
    onCancel:  () => { state.selectedItems = {}; rerenderTopArea(state); },
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
    onConfirm: (optId) => { handleBulkAction(state, optId); },
    onCancel:  () => {},
  });
}

function openSeatMenu(state, seatId) {
  let sIdx = _seatIdxById(state, seatId);
  let seat = state.seats[sIdx];
  const empty = seat && seat.items.length === 0;
  let options = [
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
    onConfirm: (optId) => { handleSeatAction(state, optId, seatId); },
    onCancel:  () => {},
  });
}

// ═══════════════════════════════════════════════════
//  MENU ACTION HANDLERS
// ═══════════════════════════════════════════════════

function handleItemAction(state, optId, seatIdx, itemIdx) {
  if (optId === 'void') {
    _voidItems(state, [{ seatIdx, itemIdx }]);
  } else if (optId === 'disc') {
    handleDiscount(state);
  } else if (optId === 'move') {
    _pickMoveTarget(state, [{ seatIdx, itemIdx }]);
  } else if (optId === 'qty') {
    _promptQty(state, seatIdx, itemIdx);
  } else if (optId === 'note') {
    _promptNote(state, seatIdx, itemIdx);
  } else if (optId === 'reprint') {
    showToast('Reprint — coming soon', { bg: T.gold });
  }
}

function handleBulkAction(state, optId) {
  let refs = getSelectedItemRefs(state);
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
  let sIdx = _seatIdxById(state, seatId);
  if (sIdx < 0) return;

  if (optId === 'void') {
    const refs = [];
    for (let i = 0; i < state.seats[sIdx].items.length; i++) {
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
  const targetIdx = _seatIdxById(state, targetSeatId);
  if (targetIdx < 0) return 0;

  // Move in descending order so earlier splice calls don't shift the
  // indices of later ones (matches the pre-extraction behavior).
  refs.sort((a, b) => {
    if (a.seatIdx !== b.seatIdx) return b.seatIdx - a.seatIdx;
    return b.itemIdx - a.itemIdx;
  });

  const patches = [];
  let movedItems = [];
  let targetNum = state.seats[targetIdx].number;

  for (let r = 0; r < refs.length; r++) {
    const rr = refs[r];
    if (rr.seatIdx === targetIdx) continue;  // skip no-op moves
    const fromSeat = state.seats[rr.seatIdx];
    let it = fromSeat.items.splice(rr.itemIdx, 1)[0];
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
    showToast(`Already on ${targetSeatId}`, { bg: T.gold });
    return 0;
  }

  persistItemSeats(state, movedItems);
  persistSeats(state);

  state.selectedItems = {};
  state.selected      = {};
  rerenderTopArea(state);
  showToast(`Moved ${patches.length} item(s)`, { bg: T.greenWarm });
  return patches.length;
}

function _pickMoveTarget(state, refs) {
  // Build seat list excluding paid seats.
  let options = [];
  for (let i = 0; i < state.seats.length; i++) {
    if (state.paidSeats[state.seats[i].id]) continue;
    options.push({ id: state.seats[i].id, label: state.seats[i].id, color: T.green });
  }
  options.push({ id: '__new__', label: '+ New seat', color: T.greenWarm });

  SceneManager.interrupt('co-item-menu', {
    title:   'Move to Seat',
    options: options,
    onConfirm: (optId) => {
      let targetId;
      if (optId === '__new__') {
        addSeat(state);
        targetId = state.seats[state.seats.length - 1].id;
      } else {
        targetId = optId;
      }
      _moveItemsToSeat(state, refs, targetId);
    },
    onCancel: () => {},
  });
}

function _pickMergeTarget(state, sourceSeatId) {
  const options = [];
  for (let i = 0; i < state.seats.length; i++) {
    if (state.paidSeats[state.seats[i].id]) continue;
    if (state.seats[i].id === sourceSeatId) continue;
    options.push({ id: state.seats[i].id, label: state.seats[i].id, color: T.green });
  }
  if (options.length === 0) { showToast('No other seats to merge with', { bg: T.gold }); return; }

  SceneManager.interrupt('co-item-menu', {
    title:   `Merge ${sourceSeatId} Into…`,
    options: options,
    onConfirm: (targetId) => {
      const sIdx = _seatIdxById(state, sourceSeatId);
      const tIdx = _seatIdxById(state, targetId);
      if (sIdx < 0 || tIdx < 0) return;

      const movedItems = state.seats[sIdx].items;
      const targetNum = state.seats[tIdx].number;
      for (let m = 0; m < movedItems.length; m++) {
        movedItems[m].seat_number = targetNum;
      }

      state.seats[tIdx].items = state.seats[tIdx].items.concat(movedItems);
      state.seats.splice(sIdx, 1);
      delete state.selected[sourceSeatId];
      rerenderTopArea(state);
      showToast(`Merged into ${targetId}`, { bg: T.greenWarm });

      persistItemSeats(state, movedItems);
      persistSeats(state);
    },
    onCancel: () => {},
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
    onConfirm: (server) => {
      fetchWithTimeout(`/api/v1/orders/${state.orderId}`, {
        method:  'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          server_id:   server.employee_id,
          server_name: server.employee_name,
        }),
      }, 10000).then((r) => {
        if (r.ok) showToast(`Transferred to ${server.employee_name}`, { bg: T.greenWarm });
        else      showToast('Transfer failed',                         { bg: T.verm });
      }).catch(() => {
        // Network/offline — without this the promise hangs forever and
        // the server sees no toast, no retry, no signal that the transfer
        // did NOT happen. Explicit catch so the op is recoverable.
        showToast('Transfer failed — check connection', { bg: T.verm });
      });
    },
    onCancel: () => {},
    excludeId: null,
  });
}

// ═══════════════════════════════════════════════════
//  EDIT SEATS (column-editor for split/merge/move)
// ═══════════════════════════════════════════════════

function openEditSeats(state) {
  // Determine which seats to send: selected seats if any, else all unpaid.
  const sentIndices = [];
  const selKeys = Object.keys(state.selected || {});
  if (selKeys.length > 0) {
    for (let i = 0; i < state.seats.length; i++) {
      if (state.selected[state.seats[i].id]) sentIndices.push(i);
    }
  } else {
    for (let i = 0; i < state.seats.length; i++) {
      if (!state.paidSeats[state.seats[i].id]) sentIndices.push(i);
    }
  }

  const columns = sentIndices.map((idx) => {
    let seat = state.seats[idx];
    return {
      id:    seat.id,
      label: seat.id,
      items: seat.items.map((it) => {
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
  const allColumns = state.seats
    .filter((s) => !state.paidSeats[s.id])
    .map((s) => {
      return {
        id:    s.id,
        label: `S${(s.number != null ? s.number : '')}`,
        items: s.items.map((it) => {
          return {
            name: it.name, qty: it.qty, price: it.price,
            item_id: it.item_id, menu_item_id: it.menu_item_id,
            category: it.category, mods: it.mods, notes: it.notes,
            _splitRef: it._splitRef || undefined,
          };
        }),
      };
    });

  // focusedIds: selected seats, or focused seats, or all unpaid seats
  let focusedIds;
  const selKeys2 = Object.keys(state.selected || {});
  if (selKeys2.length > 0) {
    focusedIds = selKeys2;
  } else if (Object.keys(state.focusedSeats || {}).length > 0) {
    focusedIds = Object.keys(state.focusedSeats);
  } else {
    focusedIds = state.seats.filter((s) => !state.paidSeats[s.id]).map((s) => s.id);
  }

  SceneManager.openTransactional('column-editor', {
    columns:      columns,
    allColumns:   allColumns,
    focusedIds:   focusedIds,
    checkNumber:  state.checkNumber || '',
    orderId:      state.orderId,
    onSave: (newColumns) => {
      const itemsToSync = [];

      // Zip returned columns back into the original seat indices.
      // Seats whose column was merged away are cleared.
      sentIndices.forEach((origIdx, colIdx) => {
        const seat = state.seats[origIdx];
        if (newColumns[colIdx]) {
          seat.items = newColumns[colIdx].items;
        } else {
          seat.items = [];
        }
        for (let i = 0; i < seat.items.length; i++) {
          const it = seat.items[i];
          if (it.item_id) {
            it.seat_number = seat.number;
            itemsToSync.push(it);
          }
        }
      });

      // Remove seats emptied by a merge so their numbers are available for reuse.
      state.seats = state.seats.filter((s) => s.items.length > 0);

      // Handle extra columns (new seats added inside column-editor).
      const usedNumbers = state.seats.map((s) => s.number);
      newColumns.slice(sentIndices.length).forEach((col) => {
        let n = 1;
        while (usedNumbers.indexOf(n) >= 0) n++;
        usedNumbers.push(n);
        const newSeat = {
          id:     `S-${String(n).padStart(3, '0')}`,
          number: n,
          items:  col.items,
        };
        state.seats.push(newSeat);
        for (let i = 0; i < col.items.length; i++) {
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
      const itemSync = itemsToSync.length > 0
        ? persistItemSeats(state, itemsToSync)
        : Promise.resolve();
      itemSync.then(() => { persistSeats(state); });

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
  const s = collectSummary(state.seats, state.selected, state.paidSeats, state);
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
      onNameTap:    () => { openNameEditor(state); },
      onItemTap:    (idx) => { _onOSItemTap(state, idx); },
      showBack:     !!state._landing,
      onBack:       () => {
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
    onConfirm:   (name) => {
      state.customerName = name;
      if (state.orderId) {
        fetchWithTimeout(`/api/v1/orders/${state.orderId}`, {
          method:  'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify({ customer_name: name }),
        })
          .then((r) => {
            if (!r.ok) showToast('Could not save name', { bg: T.verm });
          })
          .catch(() => { showToast('Could not save name', { bg: T.verm }); });
      }
      if (state._osActive) renderOrderSummary(state);
    },
    onCancel: () => {},
  });
}

// ═══════════════════════════════════════════════════
//  REOPEN PAID SEAT (void payment flow)
// ═══════════════════════════════════════════════════

function reopenSeat(state, seatId) {
  // Use the already-built seatPayments cache; no extra fetch needed.
  const matches = state.seatPayments[seatId] || [];
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
    onConfirm: (paymentId) => {
      fetchWithTimeout(
        `/api/v1/orders/${state.orderId}/payments/${paymentId}/void`,
        {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify({ reason: 'Voided from check overview' }),
        },
        8000
      ).then((r) => {
        if (r.ok) {
          // Do not mutate paidSeats/seatPayments locally — let refreshOrder
          // repaint from the server's response so local state never races
          // ahead of backend truth.
          showToast('Payment voided', { bg: T.greenWarm });
          refreshOrder(state, {});
        } else {
          showToast('Void failed', { bg: T.verm });
        }
      }).catch(() => {
        showToast('Void failed', { bg: T.verm });
      });
    },
    onCancel: () => {},
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
    return state._seatsChain.then(() => refreshOrder(state, params));
  }
  state._refreshInFlight = true;

  // 15s abort guard — matches order-entry's send/recall fetches so a hung
  // backend doesn't leave the refresh indicator silently pending. The
  // existing catch already clears _refreshInFlight on rejection, so an
  // AbortError takes the same path as any other network failure.
  state._refreshPromise = fetchWithTimeout(`/api/v1/orders/${state.orderId}`, { cache: 'no-store' }, 15000)
    .then((r) => r.ok ? r.json() : null)
    .then((order) => {
      state._refreshInFlight = false;
      if (!state._alive) return;
      if (!order) return;
      state.order = order;
      state.checkNumber  = order.check_number || '';
      state.customerName = order.customer_name || '';

      if (!order || !Array.isArray(order.items)) {
        entReport({
          code:    'CHECK_OVERVIEW_NO_ITEMS',
          source:  'check-overview',
          message: 'order.items missing or not array',
        });
        return;
      }

      state.seats = orderToSeats(order, order.guest_count || 1);
      _injectVoidedItems(state);

      // Recompute paid seats from payment.seat_numbers (list of seat
      // numbers). Build seatPayments[seat.id] = [payment, ...] so the
      // UI can render per-seat payment rows without another fetch.
      state.paidSeats    = {};
      state.seatPayments = {};
      if (Array.isArray(order.payments)) {
        for (let p = 0; p < order.payments.length; p++) {
          const pmt = order.payments[p];
          if (pmt.status !== 'confirmed') continue;
          const seatNums = pmt.seat_numbers || [];
          for (let si = 0; si < state.seats.length; si++) {
            if (seatNums.indexOf(state.seats[si].number) < 0) continue;
            const sid = state.seats[si].id;
            state.paidSeats[sid] = true;
            if (!state.seatPayments[sid]) state.seatPayments[sid] = [];
            // De-duplicate by payment_id (a payment covering S1+S2
            // appears in both seats' lists).
            let dup = false;
            for (let qi = 0; qi < state.seatPayments[sid].length; qi++) {
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
    .catch(() => {
      state._refreshInFlight = false;
    })
    .finally(() => {
      // Clear the per-state cache so a later tap on the same check
      // (after payment, after refresh) re-fetches rather than handing
      // back the stale resolved promise.
      state._refreshPromise = null;
    });

  return state._refreshPromise;
}