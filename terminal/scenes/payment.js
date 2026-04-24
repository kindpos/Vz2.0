// ═══════════════════════════════════════════════════
//  KINDpos Terminal — Payment Scene (Vz2.0)
//  3-column: Order Recap | Tender (toggle + denoms + actions) | Amount + Numpad
//  Nice. Dependable. Yours.
// ═══════════════════════════════════════════════════

import { T } from '../tokens.js';
import { fetchWithTimeout } from '../net.js';
import { buildButton, showToast } from '../components.js';
import { SceneManager, defineScene } from '../scene-manager.js';
import {
  buildPillButton, buildWell, buildNumpadChassis, buildHeroNumber, hexToRgba,
  buildStaticCard, buildDivider, buildDataRow, lightenHex, darkenHex,
} from '../theme-manager.js';
import { OrderSummary } from '../order-summary.js';

var PAD     = T.scenePad;
var GAP     = T.colGapSm;
var API     = '/api/v1';

// ── Scene state ───────────────────────────────────
var sceneEl           = null;
var sceneData         = {};
var enteredAmount     = 0;
var denomAccum        = 0;
var numpadStr         = '';
var paymentMode       = 'card';
var confirmProcessing = false;
var payments          = [];
var totalPaid         = 0;
var baseTotal         = 0;
var numpadRef         = null;
var dotTimer          = null;

// DOM refs
var _modeButtons      = {};
var _chevronEl        = null;
var _balanceValueEl   = null;
var _checkNumEl       = null;
var _denomTiles       = [];
var _btn100           = null;
var _heroEl           = null;
var _subRow           = null;
var _taxRow           = null;
var _cardRow          = null;
var _cashRow          = null;
var _itemsScroll      = null;

// Card processing overlay state
var _procStatusEl     = null;
var _procAnimTimer    = null;

// Change-due timer
var _changeDueTimer   = null;

// Split tap handler (bound to event bus)
function _onSplitTap() { showSplitPopup(); }


// ═══════════════════════════════════════════════════
//  SCENE DEFINITION
// ═══════════════════════════════════════════════════

// ── Return-to-parent helper ──────────────────────
// Payment is mounted as a working scene (replaces check-overview). To go
// back, re-mount the returnTo scene with the returnParams bundle that was
// passed in. Falls back to whatever landing the user came from, or gate
// login as last resort.
function _returnToParent(params) {
  params = params || {};
  var target    = params.returnTo || 'check-overview';
  var retParams = params.returnParams || {
    checkId:       params.checkId || params.orderId,
    returnLanding: params.returnLanding,
    employeeId:    params.employeeId,
    employeeName:  params.employeeName,
    pin:           params.pin,
  };
  try {
    SceneManager.mountWorking(target, retParams);
  } catch (e) {
    // If returnTo scene isn't registered for some reason, fall back to
    // the landing or login gate.
    if (params.returnLanding) {
      SceneManager.mountWorking(params.returnLanding, {
        emp: params.employeeId ? {
          id:   params.employeeId,
          name: params.employeeName,
          pin:  params.pin,
        } : null,
      });
    } else {
      SceneManager.openGate('login');
    }
  }
}

defineScene({
  name: 'payment',

  state: {
    enteredAmount: 0,
    paymentMode: 'card',
  },

  render: function(container, params) {
    params = params || {};
    sceneEl           = container;
    sceneData         = params;
    enteredAmount     = 0;
    denomAccum        = 0;
    numpadStr         = '';
    paymentMode       = params.paymentMode || 'card';
    confirmProcessing = false;
    payments          = [];
    totalPaid         = 0;
    baseTotal         = params.cardTotal || 0;
    numpadRef         = null;
    dotTimer          = null;
    _modeButtons      = {};
    _chevronEl        = null;
    _balanceValueEl   = null;
    _checkNumEl       = null;
    _denomTiles       = [];
    _btn100           = null;
    _heroEl           = null;
    _subRow = _taxRow = _cardRow = _cashRow = null;
    _itemsScroll      = null;
    _procStatusEl     = null;
    _procAnimTimer    = null;

    container.style.cssText = [
      'width:100%;height:100%;',
      'display:flex;gap:12px;',
      'padding:10px 24px 16px;',
      'box-sizing:border-box;overflow:hidden;',
      'background:' + T.bg + ';',
    ].join('');

    container.appendChild(buildLeftColumn(params));
    container.appendChild(buildCenterColumn(params));
    container.appendChild(buildRightColumn(params));

    // Paint active mode now that toggle buttons and denom tiles both exist.
    setPaymentMode(paymentMode);
    updateSplitDisplay();

    // ── Order fetch — populate left recap + authoritative baseTotal ──
    // check-overview doesn't always pass cardTotal in params, so fall back
    // to the backend's balance_due when no cardTotal was pre-seeded.
    if (params.orderId) {
      fetch('/api/v1/orders/' + encodeURIComponent(params.orderId))
        .then(function(r) { return r.ok ? r.json() : null; })
        .then(function(order) {
          if (!order) return;
          populateLeftCard(order);
        })
        .catch(function() { /* silently skip — scene still works */ });
    }
  },

  unmount: function() {
    SceneManager.off('split:tap', _onSplitTap);
    if (dotTimer) { clearInterval(dotTimer); dotTimer = null; }
    if (_procAnimTimer) { clearInterval(_procAnimTimer); _procAnimTimer = null; }
    if (OrderSummary && OrderSummary.hide) OrderSummary.hide();
  },

  events: {
    'split:tap': function() { showSplitPopup(); },
  },

  interrupts: {
    'split-select': {
      render: function(container, params) {
        params = params || {};
        var remaining = params.remaining || 0;

        // Vz2.0 card: left accent bar + rounded corners + drop shadow
        container.style.cssText = [
          'display:flex;flex-direction:column;align-items:center;gap:18px;',
          'padding:8px 44px 44px;',
          'background:' + T.card + ';',
          'border-left:4px solid ' + T.gold + ';',
          'border-radius:' + T.chamferCard + 'px;',
          'box-shadow:0 10px 30px rgba(0,0,0,0.45);',
          'min-width:420px;',
          'pointer-events:auto;',
        ].join('');

        var title = document.createElement('div');
        title.style.cssText = [
          'font-family:' + T.fh + ';',
          'font-size:' + T.fsB1 + ';',
          'font-weight:' + T.fwBold + ';',
          'color:' + T.gold + ';',
          'letter-spacing:0.14em;',
          'text-transform:uppercase;',
        ].join('');
        title.textContent = 'Split Payment';
        container.appendChild(title);

        var sub = document.createElement('div');
        sub.style.cssText = [
          'font-family:' + T.fb + ';',
          'font-size:' + T.fsB2 + ';',
          'color:' + T.green + ';',
        ].join('');
        sub.textContent = 'Remaining: $' + remaining.toFixed(2);
        container.appendChild(sub);

        var btnRow = document.createElement('div');
        btnRow.style.cssText = 'display:flex;gap:14px;margin-top:4px;';

        [2, 3, 4].forEach(function(divisor) {
          var amt = Math.ceil(remaining / divisor * 100) / 100;
          var btn = buildPillButton({
            label: '1/' + divisor,
            sub: '$' + amt.toFixed(2),
            color: T.card,
            onClick: function() { params.onConfirm(amt); }
          });
          btn.style.width = '120px';
          btn.style.height = '88px';
          btn.style.border = '2px solid ' + T.green;
          btn.style.color = T.green;
          btnRow.appendChild(btn);
        });
        container.appendChild(btnRow);

        var cancel = buildPillButton({
          label: 'CANCEL',
          color: T.verm,
          onClick: function() { params.onCancel(); }
        });
        cancel.style.width = '160px';
        cancel.style.height = '48px';
        container.appendChild(cancel);
      },
    },
  },

  transactionals: {
    'pc-card-processing': {
      render: function(container, params) {
        params = params || {};
        var amount = params.amount || 0;
        var TOTAL_SEGS = 22;
        var segments = [];
        var segIdx = 0;
        var msgIdx = 0;

        var statusMessages = [
          'Connecting to terminal...',
          'Waiting for card...',
          'Reading card data...',
          'Contacting processor...',
          'Awaiting authorization...',
        ];

        container.style.cssText = 'width:100%;height:100%;display:flex;align-items:center;justify-content:center;';

        // Vz2.0 modal card: left accent bar + rounded + drop shadow.
        var card = document.createElement('div');
        card.style.cssText = [
          'background:' + T.card + ';',
          'border-left:4px solid ' + T.gold + ';',
          'border-radius:' + T.chamferCard + 'px;',
          'width:460px;',
          'box-shadow:0 12px 36px rgba(0,0,0,0.55);',
          'font-family:' + T.fb + ';',
          'overflow:hidden;',
        ].join('');

        // Header strip
        var titleBar = document.createElement('div');
        titleBar.style.cssText = [
          'padding:14px 20px;',
          'background:' + T.well + ';',
          'display:flex;align-items:center;gap:12px;',
          'border-bottom:1px solid ' + T.border + ';',
        ].join('');

        var icon = document.createElement('div');
        icon.style.cssText = [
          'width:32px;height:32px;flex-shrink:0;',
          'background:' + T.gold + ';',
          'display:flex;align-items:center;justify-content:center;',
          'font-size:18px;font-weight:' + T.fwBold + ';',
          'color:' + T.well + ';',
          'border-radius:8px;',
        ].join('');
        icon.textContent = '\u25C8';

        var titleText = document.createElement('span');
        titleText.style.cssText = [
          'font-family:' + T.fh + ';',
          'font-size:' + T.fsB2 + ';',
          'font-weight:' + T.fwBold + ';',
          'color:' + T.green + ';',
          'letter-spacing:0.08em;',
          'text-transform:uppercase;',
        ].join('');
        titleText.textContent = 'Card Payment \u2014 $' + amount.toFixed(2);

        titleBar.appendChild(icon);
        titleBar.appendChild(titleText);
        card.appendChild(titleBar);

        // Body
        var body = document.createElement('div');
        body.style.cssText = 'padding:24px 24px 22px;display:flex;flex-direction:column;gap:14px;';

        _procStatusEl = document.createElement('div');
        _procStatusEl.style.cssText = [
          'font-family:' + T.fb + ';',
          'font-size:' + T.fsB2 + ';',
          'color:' + T.text + ';',
          'min-height:28px;',
        ].join('');
        _procStatusEl.textContent = statusMessages[0];
        body.appendChild(_procStatusEl);

        // Progress bar: rounded well with gold segments inside.
        var progContainer = document.createElement('div');
        progContainer.style.cssText = [
          'height:28px;padding:3px;',
          'background:' + T.well + ';',
          'border:1px solid ' + T.border + ';',
          'border-radius:8px;',
          'overflow:hidden;',
          'box-shadow:inset 0 2px 4px rgba(0,0,0,0.4);',
        ].join('');
        var progFill = document.createElement('div');
        progFill.style.cssText = 'height:100%;display:flex;gap:2px;align-items:stretch;';

        for (var i = 0; i < TOTAL_SEGS; i++) {
          var seg = document.createElement('div');
          seg.style.cssText = [
            'width:14px;flex-shrink:0;',
            'background:' + T.gold + ';',
            'border-radius:2px;',
            'opacity:0;transition:opacity 0.05s;',
          ].join('');
          progFill.appendChild(seg);
          segments.push(seg);
        }
        progContainer.appendChild(progFill);
        body.appendChild(progContainer);

        var hint = document.createElement('div');
        hint.style.cssText = [
          'font-family:' + T.fb + ';',
          'font-size:' + T.fsB3 + ';',
          'color:' + hexToRgba(T.text, 0.6) + ';',
          'text-align:center;',
          'letter-spacing:0.05em;',
        ].join('');
        hint.textContent = 'Present card on terminal...';
        body.appendChild(hint);

        card.appendChild(body);
        container.appendChild(card);

        _procAnimTimer = setInterval(function() {
          if (segIdx < TOTAL_SEGS) {
            segments[segIdx].style.opacity = '1';
            segIdx++;
          }
          if (segIdx % 4 === 0 && msgIdx < statusMessages.length - 1) {
            msgIdx++;
            if (_procStatusEl) _procStatusEl.textContent = statusMessages[msgIdx];
          }
          if (segIdx >= TOTAL_SEGS) {
            segIdx = 0;
            segments.forEach(function(s) { s.style.opacity = '0'; });
          }
        }, 200);
      },
      unmount: function() {
        if (_procAnimTimer) clearInterval(_procAnimTimer);
        _procAnimTimer = null;
        _procStatusEl = null;
      },
    },

    'pc-change-due': {
      render: function(container, params) {
        params = params || {};
        var returned = false;
        _changeDueTimer = null;


        container.style.cssText = [
          'width:100%;height:100%;',
          'display:flex;flex-direction:column;align-items:center;justify-content:center;',
          'gap:24px;background:' + T.scrimInterrupt + ';',
        ].join('');

        var isCash    = params.paymentMode === 'cash';
        var hasChange = isCash && params.change > 0;

        // Vz2.0 card with accent bar (gold for change-due celebration)
        var card = document.createElement('div');
        card.style.cssText = [
          'display:flex;flex-direction:column;align-items:center;',
          'padding:40px 72px 36px;',
          'background:' + T.card + ';',
          'border-left:4px solid ' + T.gold + ';',
          'border-radius:' + T.chamferCard + 'px;',
          'box-shadow:0 16px 48px rgba(0,0,0,0.55);',
          'min-width:520px;',
        ].join('');

        var topLabel = document.createElement('div');
        topLabel.style.cssText = [
          'font-family:' + T.fh + ';',
          'font-size:' + T.fsB1 + ';',
          'font-weight:' + T.fwBold + ';',
          'letter-spacing:0.22em;',
          'color:' + T.green + ';',
          'margin-bottom:24px;',
          'text-transform:uppercase;',
        ].join('');
        topLabel.textContent = isCash ? 'Cash Payment' : 'Card Payment';
        card.appendChild(topLabel);

        if (hasChange) {
          var changeLabel = document.createElement('div');
          changeLabel.style.cssText = [
            'font-family:' + T.fh + ';',
            'font-size:' + T.fsB2 + ';',
            'font-weight:' + T.fwBold + ';',
            'letter-spacing:0.18em;',
            'color:' + T.green + ';',
            'margin-bottom:8px;',
            'text-transform:uppercase;',
          ].join('');
          changeLabel.textContent = 'Change Due';
          card.appendChild(changeLabel);

          var changeAmount = document.createElement('div');
          changeAmount.style.cssText = [
            'font-family:' + T.fh + ';',
            'font-size:108px;font-weight:' + T.fwBold + ';',
            'color:' + T.gold + ';',
            'line-height:1;letter-spacing:0.02em;',
            'text-shadow:0 0 24px ' + hexToRgba(T.gold, 0.35) + ';',
          ].join('');
          changeAmount.textContent = '$' + params.change.toFixed(2);
          card.appendChild(changeAmount);
        } else {
          var paidLabel = document.createElement('div');
          paidLabel.style.cssText = [
            'font-family:' + T.fh + ';',
            'font-size:44px;font-weight:' + T.fwBold + ';',
            'letter-spacing:0.14em;',
            'color:' + T.green + ';',
            'margin-bottom:8px;',
            'text-transform:uppercase;',
          ].join('');
          paidLabel.textContent = isCash ? 'Exact Change' : 'Payment Approved';
          card.appendChild(paidLabel);
        }

        var chargedLine = document.createElement('div');
        chargedLine.style.cssText = [
          'font-family:' + T.fb + ';',
          'font-size:' + T.fsB2 + ';',
          'color:' + hexToRgba(T.text, 0.6) + ';',
          'margin-top:14px;',
          'letter-spacing:0.06em;',
        ].join('');
        chargedLine.textContent = (isCash ? 'Cash price: ' : 'Charged: ') + '$' + params.total.toFixed(2);
        card.appendChild(chargedLine);

        var printLine = document.createElement('div');
        printLine.style.cssText = [
          'font-family:' + T.fb + ';',
          'font-size:' + T.fsB3 + ';',
          'color:' + hexToRgba(T.text, 0.6) + ';',
          'letter-spacing:0.14em;',
          'margin-top:18px;',
          'text-transform:uppercase;',
        ].join('');
        printLine.textContent = 'Receipt Printing...';
        card.appendChild(printLine);

        container.appendChild(card);

        var btnRow = document.createElement('div');
        btnRow.style.cssText = 'display:flex;gap:20px;';

        var newOrderBtn = buildPillButton({
          label: 'NEW ORDER',
          color: T.green,
          onClick: function() { doReturn('order-entry'); }
        });
        newOrderBtn.style.flex = '0 0 auto';
        newOrderBtn.style.width  = '240px';
        newOrderBtn.style.height = '72px';
        btnRow.appendChild(newOrderBtn);

        var logoutBtn = buildPillButton({
          label: 'LOGOUT',
          color: T.green,
          onClick: function() { doReturn('login'); }
        });
        logoutBtn.style.flex = '0 0 auto';
        logoutBtn.style.width  = '240px';
        logoutBtn.style.height = '72px';
        btnRow.appendChild(logoutBtn);

        container.appendChild(btnRow);

        var postAction = (window.KINDpos && window.KINDpos.postPaymentAction) || 'quick-service';
        if (postAction === 'logout') {
          var autoHint = document.createElement('div');
          autoHint.style.cssText = [
            'font-family:' + T.fb + ';',
            'font-size:' + T.fsB3 + ';',
            'color:' + hexToRgba(T.text, 0.6) + ';',
            'letter-spacing:0.12em;',
            'margin-top:4px;',
          ].join('');
          autoHint.textContent = 'auto-logout in 8s...';
          container.appendChild(autoHint);

          var countdown = 8;
          _changeDueTimer = setInterval(function() {
            countdown--;
            if (countdown <= 0) {
              clearInterval(_changeDueTimer);
              _changeDueTimer = null;
              doReturn('login');
            } else {
              autoHint.textContent = 'auto-logout in ' + countdown + 's...';
            }
          }, 1000);
        }

        function doReturn(target) {
          if (returned) return;
          returned = true;
          if (_changeDueTimer) { clearInterval(_changeDueTimer); _changeDueTimer = null; }
          var activeScene = SceneManager.getActiveWorking();
          SceneManager.closeAllTransactional();
          if (target === 'login') {
            OrderSummary.hide();
            SceneManager.unmountWorking(activeScene);
            SceneManager.openGate('login');
          } else if (activeScene === 'check-overview') {
            SceneManager.emit('payment:complete');
          } else {
            // NEW ORDER path (quick-service flow). Start a fresh check,
            // but thread the employee context so order-entry can POST
            // /orders with the right server_id / server_name instead of
            // nulls. `{}` here used to lose identity + returnLanding,
            // which meant the BACK button from order-entry fell through
            // to a default landing rather than the employee's own.
            OrderSummary.hide();
            SceneManager.mountWorking('order-entry', {
              employeeId:   sceneData.employeeId,
              employeeName: sceneData.employeeName,
              pin:          sceneData.pin,
              returnLanding: sceneData.returnLanding
                || (sceneData.returnParams && sceneData.returnParams.returnLanding)
                || null,
            });
          }
        }
      },
      unmount: function() {
        if (_changeDueTimer) { clearInterval(_changeDueTimer); _changeDueTimer = null; }
      },
    },
  },
});


// ═══════════════════════════════════════════════════
//  LEFT COLUMN — Order Recap
// ═══════════════════════════════════════════════════

function buildLeftColumn(params) {
  var wrap = document.createElement('div');
  wrap.style.cssText = 'width:210px;flex-shrink:0;display:flex;flex-direction:column;min-height:0;';

  var card = buildStaticCard({ accent: T.green, width: '210px' });
  card.style.flex          = '1';
  card.style.display       = 'flex';
  card.style.flexDirection = 'column';
  card.style.minHeight     = '0';
  card.style.padding       = '14px 14px 14px 18px';

  // Header row — chevron + label
  var header = document.createElement('div');
  header.style.cssText = 'flex-shrink:0;display:flex;align-items:center;gap:10px;margin-bottom:10px;';

  _chevronEl = document.createElement('div');
  _chevronEl.textContent         = '◄';
  _chevronEl.style.fontFamily    = T.fh;
  _chevronEl.style.fontSize      = T.fsB2;
  _chevronEl.style.color         = T.green;
  _chevronEl.style.cursor        = 'pointer';
  _chevronEl.style.userSelect    = 'none';
  _chevronEl.style.touchAction   = 'manipulation';
  _chevronEl.style.padding       = '2px 6px';
  _chevronEl.addEventListener('pointerup', function() { _returnToParent(sceneData); });
  header.appendChild(_chevronEl);

  var title = document.createElement('div');
  title.textContent         = 'ORDER RECAP';
  title.style.fontFamily    = T.fh;
  title.style.fontSize      = T.fsB3;
  title.style.fontWeight    = T.fwBold;
  title.style.color         = T.green;
  title.style.letterSpacing = '0.2em';
  title.style.textTransform = 'uppercase';
  header.appendChild(title);

  card.appendChild(header);

  // Items scroll
  _itemsScroll = document.createElement('div');
  _itemsScroll.style.cssText = 'flex:1;min-height:0;overflow-y:auto;display:flex;flex-direction:column;';
  card.appendChild(_itemsScroll);

  // Totals block
  card.appendChild(buildDivider('10px 0'));
  _subRow = buildDataRow('SUBTOTAL', '$0.00', T.gold);
  _taxRow = buildDataRow('TAX',      '$0.00', T.gold);
  card.appendChild(_subRow);
  card.appendChild(_taxRow);

  card.appendChild(buildDivider('10px 0'));
  _cardRow = buildDataRow('CARD PRICE', '$0.00', T.elec);
  _cashRow = buildDataRow('CASH PRICE', '$0.00', T.greenWarm);
  card.appendChild(_cardRow);
  card.appendChild(_cashRow);

  wrap.appendChild(card);

  if (totalPaid > 0 && _chevronEl) _chevronEl.style.display = 'none';
  return wrap;
}

function populateLeftCard(order) {
  var items    = [];
  var subtotal = 0;
  if (Array.isArray(order.items)) {
    order.items.forEach(function(it) {
      if (it.voided) return;
      var qty   = it.qty || 1;
      var price = (typeof it.price === 'number' ? it.price : 0);
      subtotal += qty * price;
      items.push({
        name:  it.name || it.menu_item_name || 'Item',
        qty:   qty,
        price: qty * price,
      });
    });
  }
  var tax       = (typeof order.tax === 'number') ? order.tax : 0;
  var cardTotal = (typeof order.balance_due === 'number') ? order.balance_due : (subtotal + tax);
  var cashPrice = cardTotal;

  // Trust params.cardTotal when pre-seeded; only fall back to the backend's
  // whole-check balance_due when no cardTotal was passed at mount.
  if (!baseTotal) baseTotal = cardTotal;

  if (_itemsScroll) {
    _itemsScroll.innerHTML = '';
    items.forEach(function(it) {
      var row = document.createElement('div');
      row.style.cssText = [
        'display:flex;align-items:baseline;justify-content:space-between;',
        'padding:6px 0;',
        'border-bottom:1px solid rgba(90,95,102,0.25);',
        'gap:8px;',
      ].join('');

      var left = document.createElement('span');
      left.textContent         = it.qty + '  ' + it.name;
      left.style.fontFamily    = T.fb;
      left.style.fontSize      = T.fsB3;
      left.style.color         = T.text;
      left.style.overflow      = 'hidden';
      left.style.textOverflow  = 'ellipsis';
      left.style.whiteSpace    = 'nowrap';
      row.appendChild(left);

      var right = document.createElement('span');
      right.textContent      = '$' + it.price.toFixed(2);
      right.style.fontFamily = T.fb;
      right.style.fontSize   = T.fsB2;
      right.style.fontWeight = T.fwBold;
      right.style.color      = T.gold;
      right.style.flexShrink = '0';
      row.appendChild(right);

      _itemsScroll.appendChild(row);
    });
  }

  if (_subRow)  _subRow.setValue('$' + subtotal.toFixed(2));
  if (_taxRow)  _taxRow.setValue('$' + tax.toFixed(2));
  if (_cardRow) _cardRow.setValue('$' + cardTotal.toFixed(2));
  if (_cashRow) _cashRow.setValue('$' + cashPrice.toFixed(2));
  if (_checkNumEl) _checkNumEl.textContent = order.check_number || order.order_id || '';

  updateSplitDisplay();
}


// ═══════════════════════════════════════════════════
//  CENTER COLUMN — Tender Toggle | Balance | Denoms | Actions
// ═══════════════════════════════════════════════════

function buildCenterColumn(params) {
  var col = document.createElement('div');
  col.style.cssText = 'flex:1;display:flex;flex-direction:column;gap:10px;overflow:hidden;min-width:0;';

  col.appendChild(buildTenderToggle());
  col.appendChild(buildBalanceStrip());

  var grid = document.createElement('div');
  grid.style.cssText = [
    'display:grid;',
    'grid-template-columns:1fr 1fr;',
    'grid-template-rows:1fr 1fr;',
    'gap:10px;flex:1;min-height:0;',
  ].join('');
  grid.appendChild(buildDenomTile(5));
  grid.appendChild(buildDenomTile(10));
  grid.appendChild(buildDenomTile(20));
  grid.appendChild(buildDenomTile(50));
  col.appendChild(grid);

  _btn100 = buildDenomTile(100, { fullWidth: true });
  col.appendChild(_btn100);

  col.appendChild(buildActionRow());

  return col;
}

function buildTenderToggle() {
  var row = document.createElement('div');
  row.style.cssText = 'flex-shrink:0;display:flex;gap:8px;';
  row.appendChild(buildModeToggle('cash', 'CASH', T.greenWarm, T.greenWarmDk));
  row.appendChild(buildModeToggle('card', 'CARD', T.elec,      T.elecDk));
  row.appendChild(buildModeToggle('gc',   'GIFT', '#e040fb',   '#7b0099'));
  return row;
}

function buildModeToggle(mode, label, color, dkColor) {
  var btn = buildPillButton({
    label:   label,
    color:   color,
    onClick: function() { setPaymentMode(mode); },
  });
  btn.style.flex   = '1';
  btn.style.height = '44px';
  _modeButtons[mode] = { el: btn, color: color, dk: dkColor };
  return btn;
}

function buildBalanceStrip() {
  var card = buildStaticCard({ accent: T.gold });
  card.style.flexShrink = '0';
  card.style.height     = '36px';
  card.style.padding    = '0 14px 0 20px';
  card.style.display    = 'flex';
  card.style.alignItems = 'center';
  card.style.justifyContent = 'space-between';

  var label = document.createElement('span');
  label.textContent         = 'REMAINING';
  label.style.fontFamily    = T.fb;
  label.style.fontSize      = T.fsB3;
  label.style.color         = T.moon;
  label.style.letterSpacing = '0.18em';
  label.style.textTransform = 'uppercase';
  card.appendChild(label);

  _checkNumEl = document.createElement('span');
  _checkNumEl.style.fontFamily    = T.fb;
  _checkNumEl.style.fontSize      = T.fsB3;
  _checkNumEl.style.color         = T.moon;
  _checkNumEl.style.letterSpacing = '0.12em';
  _checkNumEl.textContent = sceneData.checkLabel
    || (sceneData.orderId ? '#' + String(sceneData.orderId).slice(0, 6) : '');
  card.appendChild(_checkNumEl);

  _balanceValueEl = document.createElement('span');
  _balanceValueEl.style.fontFamily = T.fh;
  _balanceValueEl.style.fontSize   = T.fsB2;
  _balanceValueEl.style.fontWeight = T.fwBold;
  _balanceValueEl.style.color      = T.gold;
  _balanceValueEl.style.textShadow = '0 0 8px ' + hexToRgba(T.gold, 0.35);
  _balanceValueEl.textContent      = '$' + getRemainingBalance().toFixed(2);
  card.appendChild(_balanceValueEl);

  return card;
}

function buildDenomTile(val, opts) {
  opts = opts || {};
  var tile = document.createElement('div');
  var beveLight = lightenHex(T.bg, 0.08);
  var beveDark  = darkenHex(T.bg, 0.2);
  tile.style.cssText = [
    (opts.fullWidth ? 'width:100%;height:60px;flex-shrink:0;' : 'width:100%;height:100%;'),
    'display:flex;align-items:center;justify-content:center;',
    'background:' + T.card + ';',
    'border-top:2px solid '    + beveLight + ';',
    'border-left:2px solid '   + beveLight + ';',
    'border-bottom:2px solid ' + beveDark  + ';',
    'border-right:2px solid '  + beveDark  + ';',
    'border-radius:10px;',
    'font-family:' + T.fh + ';',
    'font-size:' + T.fsH2 + ';',
    'font-weight:' + T.fwBold + ';',
    'color:' + T.green + ';',
    'letter-spacing:0.04em;',
    'cursor:pointer;user-select:none;',
    'pointer-events:auto;touch-action:manipulation;',
    'box-shadow:0 5px 0 ' + T.well + ';',
    'transition:background 140ms, color 140ms, transform 80ms, box-shadow 80ms;',
  ].join('');
  tile.textContent = '$' + val;

  tile.addEventListener('pointerdown', function() {
    tile.style.transform = 'translateY(3px)';
    tile.style.boxShadow = '0 2px 0 ' + T.well;
  });
  function resetPress() {
    tile.style.transform = '';
    tile.style.boxShadow = '0 5px 0 ' + T.well;
  }
  tile.addEventListener('pointercancel', resetPress);
  tile.addEventListener('pointerleave',  resetPress);

  tile.addEventListener('pointerup', function() {
    resetPress();
    handleDenomination(val);
    tile.style.background = T.green;
    tile.style.color      = T.well;
    setTimeout(function() {
      tile.style.background = T.card;
      tile.style.color      = T.green;
    }, 180);
  });

  if (!opts.fullWidth) _denomTiles.push(tile);
  return tile;
}

function buildActionRow() {
  var row = document.createElement('div');
  row.style.cssText = 'flex-shrink:0;display:flex;gap:10px;height:52px;';

  var exact = buildPillButton({
    label:     'EXACT',
    color:     T.gold,
    textColor: T.well,
    onClick:   handleExact,
  });
  exact.style.flex   = '1';
  exact.style.height = '52px';
  row.appendChild(exact);

  var split = buildPillButton({
    label:     'SPLIT',
    color:     T.card,
    textColor: T.elec,
    onClick:   _onSplitTap,
  });
  split.style.flex       = '1';
  split.style.height     = '52px';
  split.style.background = 'transparent';
  split.style.border     = '2px solid ' + T.elec;
  split.style.boxShadow  = '0 4px 0 ' + T.elecDk;
  row.appendChild(split);

  return row;
}


// ═══════════════════════════════════════════════════
//  RIGHT COLUMN — Numpad
// ═══════════════════════════════════════════════════

function handleKey(label) {
  if (label === 'CLR') {
    numpadStr = '';
    enteredAmount = 0;
    denomAccum = 0;
    if (numpadRef) numpadRef.clear();
    updateSplitDisplay();
  } else if (label === 'ENT') {
    handleConfirm();
  } else {
    // Digit
    if (numpadStr.length < 7) {
      denomAccum = 0;
      numpadStr += label;
      enteredAmount = (parseInt(numpadStr, 10) || 0) / 100;
      if (numpadRef) numpadRef.setPin(numpadStr);
      updateSplitDisplay();
    }
  }
}

function buildRightColumn() {
  var col = document.createElement('div');
  col.style.cssText = 'width:300px;flex-shrink:0;display:flex;flex-direction:column;gap:12px;min-height:0;';

  // Amount well — TENDERING label + hero number
  var dispWell = buildWell({ padding: '8px 16px' });
  dispWell.style.height         = '76px';
  dispWell.style.flexShrink     = '0';
  dispWell.style.display        = 'flex';
  dispWell.style.flexDirection  = 'column';
  dispWell.style.alignItems     = 'center';
  dispWell.style.justifyContent = 'center';
  dispWell.style.gap            = '2px';
  dispWell.style.background     = T.well;

  var tenderLbl = document.createElement('div');
  tenderLbl.textContent         = 'TENDERING';
  tenderLbl.style.fontFamily    = T.fb;
  tenderLbl.style.fontSize      = T.fsB4;
  tenderLbl.style.color         = T.moon;
  tenderLbl.style.letterSpacing = '0.2em';
  tenderLbl.style.textTransform = 'uppercase';
  dispWell.appendChild(tenderLbl);

  _heroEl = buildHeroNumber('$0.00', T.gold);
  dispWell.appendChild(_heroEl);
  col.appendChild(dispWell);

  // Numpad — do not rebuild key-by-key; use the shared chassis builder.
  var pad = buildNumpadChassis({
    onKey: function(label) { handleKey(label); },
  });
  pad.style.flex = '1';
  col.appendChild(pad);

  // numpadRef wrapper — owned by payment.js. Backed by the hero display.
  numpadRef = {
    setPin: function(digits) {
      numpadStr = digits || '';
      updateDisplay();
    },
    setHint: function(msg, color) {
      if (!_heroEl) return;
      _heroEl.textContent = msg;
      _heroEl.style.color = color || T.gold;
    },
    clear: function() {
      numpadStr = '';
      updateDisplay();
    },
  };

  function updateDisplay() {
    if (!_heroEl) return;
    if (numpadStr.length > 0) {
      var n = parseInt(numpadStr, 10) || 0;
      _heroEl.textContent = '$' + (n / 100).toFixed(2);
    } else if (denomAccum > 0) {
      _heroEl.textContent = '$' + denomAccum.toFixed(2);
    } else {
      _heroEl.textContent = '$0.00';
    }
    _heroEl.style.color = T.gold;
  }

  updateDisplay();
  return col;
}


// ═══════════════════════════════════════════════════
//  PAYMENT MODE TOGGLE
// ═══════════════════════════════════════════════════

function setPaymentMode(mode) {
  paymentMode = mode;

  // Paint each tender toggle: active = filled + glow, inactive = ghost.
  Object.keys(_modeButtons).forEach(function(m) {
    var b = _modeButtons[m];
    if (!b || !b.el) return;
    var isActive = (m === mode);
    var el = b.el;
    if (isActive) {
      el.style.background = b.color;
      el.style.color      = T.well;
      el.style.border     = 'none';
      el.style.boxShadow  = '0 4px 0 ' + b.dk + ', 0 0 16px ' + hexToRgba(b.color, 0.4);
    } else {
      el.style.background = T.card;
      el.style.color      = b.color;
      el.style.border     = '2px solid ' + b.color;
      el.style.boxShadow  = 'none';
    }
  });

  // Denom tiles + $100 tile: live only in cash mode.
  var enabled = (mode === 'cash');
  var tiles = _denomTiles.slice();
  if (_btn100) tiles.push(_btn100);
  tiles.forEach(function(t) {
    if (!t) return;
    t.style.opacity       = enabled ? '1'    : '0.35';
    t.style.pointerEvents = enabled ? 'auto' : 'none';
  });
}


// ═══════════════════════════════════════════════════
//  DENOMINATION + EXACT HANDLERS
// ═══════════════════════════════════════════════════

function handleDenomination(val) {
  denomAccum += val;
  numpadStr = '';
  enteredAmount = denomAccum;
  if (numpadRef) {
    numpadRef.setPin('');
    numpadRef.setHint('$' + denomAccum.toFixed(2), T.gold);
  }
  updateSplitDisplay();
}

function handleExact() {
  var remaining = getRemainingBalance();
  if (remaining <= 0) {
    showToast('Nothing due', { bg: T.gold, duration: 1500 });
    return;
  }
  enteredAmount = remaining;
  denomAccum = 0;
  // Populate the numpad's digit buffer with the remaining amount in cents
  // so the display reads the same as if the user typed it manually — then
  // pressing `ent` submits via the normal path.
  var cents = Math.round(remaining * 100).toString();
  numpadStr = cents;
  if (numpadRef) {
    numpadRef.setPin(cents);
  }
  updateSplitDisplay();
}


// ═══════════════════════════════════════════════════
//  BALANCE TRACKING
// ═══════════════════════════════════════════════════

function getRemainingBalance() {
  return Math.max(0, baseTotal - totalPaid);
}

function updateSplitDisplay() {
  if (_balanceValueEl) {
    _balanceValueEl.textContent = '$' + getRemainingBalance().toFixed(2);
  }
}


// ═══════════════════════════════════════════════════
//  CONFIRM — API Calls
// ═══════════════════════════════════════════════════

async function handleConfirm() {
  if (confirmProcessing) return;
  confirmProcessing = true;

  var remaining = getRemainingBalance();
  var isCash = paymentMode === 'cash';
  var paymentAmount = Math.min(enteredAmount, remaining);
  var change = isCash ? Math.max(0, enteredAmount - paymentAmount) : 0;
  var proc = null;

  if (paymentAmount <= 0) {
    confirmProcessing = false;
    return;
  }

  try {
    // Resolve seat_numbers for the backend. Two param shapes are supported:
    //  1) Legacy SM2: sceneData.seatNumbers = [1, 2, 3]
    //  2) Vz2.0 check-overview: sceneData.seats = [{seatId, number, items}, ...]
    // Without seat_numbers the backend can't tag the payment to specific
    // seats, so check-overview wouldn't render them as paid (gold) on return.
    var seatNumbers = null;
    if (Array.isArray(sceneData.seatNumbers) && sceneData.seatNumbers.length) {
      seatNumbers = sceneData.seatNumbers.slice();
    } else if (Array.isArray(sceneData.seats) && sceneData.seats.length) {
      seatNumbers = sceneData.seats
        .map(function(s) { return s && typeof s.number === 'number' ? s.number : null; })
        .filter(function(n) { return n !== null; });
      if (seatNumbers.length === 0) seatNumbers = null;
    }

    if (isCash) {
      var cashBody = {
          order_id:       sceneData.orderId,
          amount:         paymentAmount,
          tip:            0.0,
          payment_method: 'cash',
      };
      if (seatNumbers) cashBody.seat_numbers = seatNumbers;
      var res = await fetchWithTimeout(API + '/payments/cash', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(cashBody),
      }, 20000);
      if (!res.ok) {
        var err = await res.json().catch(function() { return {}; });
        confirmProcessing = false;
        showToast(err.detail || 'Cash payment failed', { bg: T.verm });
        return;
      }
    } else {
      proc = showProcessingOverlay(paymentAmount);

      var controller = new AbortController();
      var cardTimeout = setTimeout(function() { controller.abort(); }, 95000);

      var transactionId = (typeof crypto !== 'undefined' && crypto.randomUUID)
          ? crypto.randomUUID()
          : 'tx_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 10);

      var saleBody = {
          transaction_id: transactionId,
          order_id:       sceneData.orderId,
          amount:         paymentAmount,
          terminal_id:    'terminal_01',
      };
      if (seatNumbers) saleBody.seat_numbers = seatNumbers;
      var res = await fetch(API + '/payments/sale', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(saleBody),
        signal: controller.signal,
      });

      clearTimeout(cardTimeout);
      if (proc) proc.dismiss();

      if (!res.ok) {
        var err = await res.json().catch(function() { return {}; });
        var errType = res.status === 402 ? 'DECLINED'
                    : res.status === 400 ? 'CANCELLED'
                    : 'ERROR';
        confirmProcessing = false;
        showToast(err.detail || 'Payment failed \u2014 ' + errType, { bg: T.verm });
        return;
      }
    }

    // ── Success — queue receipts ──
    queueReceipt('customer');
    if (!isCash) queueReceipt('merchant');

    payments.push({ method: paymentMode, amount: paymentAmount });
    totalPaid += paymentAmount;

    // Hide the back chevron now that money has been taken — a
    // back-to-check-overview here would orphan the recorded payment.
    if (_chevronEl) _chevronEl.style.display = 'none';

    var newRemaining = getRemainingBalance();
    confirmProcessing = false;

    if (newRemaining < 0.005) {
      activateResult(change);
    } else {
      enteredAmount = 0;
      denomAccum = 0;
      numpadStr = '';
      if (numpadRef) numpadRef.clear();
      updateSplitDisplay();
      showToast(
        '$' + paymentAmount.toFixed(2) + ' ' + paymentMode +
        ' \u2014 $' + newRemaining.toFixed(2) + ' remaining',
        { bg: T.greenWarm, duration: 3000 }
      );
    }

  } catch (err) {
    if (proc) proc.dismiss();
    confirmProcessing = false;
    showToast('Connection error \u2014 check terminal', { bg: T.verm });
  }
}

function queueReceipt(copyType) {
  // 15s abort guard — a hung printer endpoint used to leave this promise
  // dangling forever with no error surfaced to the operator.
  fetchWithTimeout(API + '/print/receipt/' + sceneData.orderId + '?copy_type=' + copyType, { method: 'POST' }, 15000)
    .then(function(r) { if (!r.ok) throw new Error('HTTP ' + r.status); })
    .catch(function(err) {
      console.warn('[KINDpos] Receipt print failed (' + copyType + '):', err);
      showToast('Receipt print failed \u2014 check printer');
    });
}


// ═══════════════════════════════════════════════════
//  RESULT — Open Change Due
// ═══════════════════════════════════════════════════

function activateResult(change) {
  var lastPayment = payments[payments.length - 1] || {};
  var remaining = getRemainingBalance();
  var isFullyPaid = remaining < 0.005;

  SceneManager.closeAllTransactional();
  SceneManager.emit('payment:complete', { orderId: sceneData.orderId });

  if (isFullyPaid) {
    // Whole check settled → hand off to the change-due transactional,
    // which owns the NEW ORDER / LOGOUT routing via its own doReturn.
    SceneManager.openTransactional('pc-change-due', {
      paymentMode: lastPayment.method,
      change:      change,
      total:       baseTotal,
    });
  } else {
    // Partial payment (more seats / amount remaining) → return to
    // check-overview so operator can continue paying. Gold-headered
    // paid seats will show their settled state.
    _returnToParent(sceneData);
  }
}


// ═══════════════════════════════════════════════════
//  SPLIT POPUP
// ═══════════════════════════════════════════════════

function showSplitPopup() {
  var remaining = getRemainingBalance();
  if (remaining <= 0) return;

  SceneManager.interrupt('split-select', {
    remaining: remaining,
    onConfirm: function(amount) {
      denomAccum = 0;
      enteredAmount = amount;
      numpadStr = '';
      if (numpadRef) numpadRef.setHint('$' + amount.toFixed(2), T.gold);
      updateSplitDisplay();
    },
  });
}


// ═══════════════════════════════════════════════════
//  CARD PROCESSING OVERLAY HELPERS
// ═══════════════════════════════════════════════════

function showProcessingOverlay(amount) {
  SceneManager.openTransactional('pc-card-processing', { amount: amount });
  return {
    updateStatus: function(msg) { if (_procStatusEl) _procStatusEl.textContent = msg; },
    dismiss: function() {
      if (_procAnimTimer) clearInterval(_procAnimTimer);
      _procAnimTimer = null;
      _procStatusEl = null;
      SceneManager.closeTransactional('pc-card-processing');
    },
  };
}