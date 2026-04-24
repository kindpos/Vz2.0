// ═══════════════════════════════════════════════════
//  KINDpos Terminal — Payment Scene (Vz2.0)
//  3-column: Order Recap | Tender (toggle + denoms + actions) | Amount + Numpad
//  Nice. Dependable. Yours.
// ═══════════════════════════════════════════════════

import { T } from '../../common/tokens.js';
import { fetchWithTimeout } from '../net.js';
import { showToast } from '../components.js';
import { SceneManager, defineScene } from '../scene-manager.js';
import {
  buildPillButton, hexToRgba,
  buildStaticCard, buildActionCard, buildDivider, buildDataRow, lightenHex, darkenHex,
} from '../theme-manager.js';
import { buildNumpad } from '../numpad.js';
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

// Pick a human-readable check label from whatever the caller passed.
// Prefers an explicit checkLabel/checkNumber; otherwise strips the
// "order_" prefix from an orderId like "order_abc123" and uses the
// last 4-6 chars so the strip reads "#ABC123" instead of "#order_".
function _deriveCheckLabel(src) {
  if (!src) return '';
  if (src.checkLabel)  return src.checkLabel;
  if (src.checkNumber) return '#' + src.checkNumber;
  var oid = src.orderId || src.checkId;
  if (!oid) return '';
  var stripped = String(oid).replace(/^order[_-]?/i, '');
  var slice    = stripped.slice(-6) || stripped.slice(0, 6);
  return slice ? '#' + slice.toUpperCase() : '';
}


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

    // Prefer the authoritative data from check-overview: it already knows
    // which seats we're paying for, applied effectivePrice (modifiers /
    // discounts), and pre-computed totals that match what the operator
    // just saw on the overview. Fall back to the raw order fetch for
    // direct / legacy mounts without a seat summary.
    if (Array.isArray(params.seats) && params.seats.length) {
      populateLeftCardFromSeats(params.seats, params);
      // Still hit the order endpoint for the real check_number —
      // check-overview doesn't forward it in params, and the UUID tail
      // ("#15DB75") isn't a real check identifier.
      if (params.orderId) {
        fetch('/api/v1/orders/' + encodeURIComponent(params.orderId))
          .then(function(r) { return r.ok ? r.json() : null; })
          .then(function(order) {
            if (order && order.check_number && _checkNumEl) {
              _checkNumEl.textContent = 'CHECK #' + order.check_number;
            }
          })
          .catch(function() { /* keep the derived fallback */ });
      }
    } else if (params.orderId) {
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

        container.style.cssText = 'width:100%;height:100%;display:flex;align-items:center;justify-content:center;pointer-events:auto;';

        // Nostalgia landing-page card shell — gold accent for split
        // affordance.
        var shell = buildStaticCard({ accent: T.gold });
        shell.style.display        = 'flex';
        shell.style.flexDirection  = 'column';
        shell.style.alignItems     = 'center';
        shell.style.gap            = '18px';
        shell.style.minWidth       = '420px';
        shell.style.padding        = '24px 44px 28px 48px';

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
        shell.appendChild(title);

        var sub = document.createElement('div');
        sub.style.cssText = [
          'font-family:' + T.fb + ';',
          'font-size:' + T.fsB2 + ';',
          'color:' + T.green + ';',
        ].join('');
        sub.textContent = 'Remaining: $' + remaining.toFixed(2);
        shell.appendChild(sub);

        var btnRow = document.createElement('div');
        btnRow.style.cssText = 'display:flex;gap:14px;margin-top:4px;';

        // Fraction tiles match the payment denomination presets: raised
        // buildActionCard with green accent bar, "1/N" stacked over the
        // dollar amount, mint flash on tap.
        [2, 3, 4].forEach(function(divisor) {
          var amt = Math.ceil(remaining / divisor * 100) / 100;
          var tile = buildActionCard({
            accent:  T.green,
            onClick: function() { params.onConfirm(amt); },
          });
          tile.style.cssText += [
            'width:120px;height:96px;flex-shrink:0;',
            'display:flex;flex-direction:column;align-items:center;justify-content:center;',
            'gap:4px;padding:14px 14px 12px 20px;',
          ].join('');

          var label = document.createElement('div');
          label.textContent         = '1/' + divisor;
          label.style.fontFamily    = T.fh;
          label.style.fontSize      = T.fsH2;
          label.style.fontWeight    = T.fwBold;
          label.style.color         = T.green;
          label.style.letterSpacing = '0.04em';
          label.style.pointerEvents = 'none';
          tile.appendChild(label);

          var subLabel = document.createElement('div');
          subLabel.textContent         = '$' + amt.toFixed(2);
          subLabel.style.fontFamily    = T.fb;
          subLabel.style.fontSize      = T.fsB3;
          subLabel.style.color         = hexToRgba(T.text, 0.7);
          subLabel.style.letterSpacing = '0.04em';
          subLabel.style.pointerEvents = 'none';
          tile.appendChild(subLabel);

          // Mint flash on tap — same feedback pattern as buildDenomTile.
          tile.addEventListener('pointerup', function() {
            tile.style.backgroundColor = T.green;
            label.style.color          = T.well;
            subLabel.style.color       = T.well;
            setTimeout(function() {
              tile.style.backgroundColor = T.card;
              label.style.color          = T.green;
              subLabel.style.color       = hexToRgba(T.text, 0.7);
            }, 180);
          });

          btnRow.appendChild(tile);
        });
        shell.appendChild(btnRow);

        var cancel = buildPillButton({
          label: 'CANCEL',
          variant: 'verm',
          fontSize: T.fsB2,
          onClick: function() { params.onCancel(); }
        });
        cancel.style.width           = '160px';
        cancel.style.height          = '48px';
        cancel.style.borderRadius    = '14px';
        cancel.style.display         = 'flex';
        cancel.style.alignItems      = 'center';
        cancel.style.justifyContent  = 'center';
        shell.appendChild(cancel);

        container.appendChild(shell);
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
  wrap.style.cssText = 'width:260px;flex-shrink:0;display:flex;flex-direction:column;min-height:0;';

  var card = buildStaticCard({ accent: T.green, width: '260px' });
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

// Render { qty, name, price: lineTotal } rows into the scrollable recap.
function _renderItemRows(items) {
  if (!_itemsScroll) return;
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

// Selection-aware recap — rendered from the seat summary that
// check-overview hands off in params. Pulls only the selected seats'
// items and honors effectivePrice so modifier-adjusted lines display
// the same value the operator saw on the overview.
function populateLeftCardFromSeats(seats, params) {
  var items    = [];
  var subtotal = 0;
  seats.forEach(function(seat) {
    if (!seat || !Array.isArray(seat.items)) return;
    seat.items.forEach(function(it) {
      if (it.voided) return;
      var qty  = it.qty || 1;
      var unit = (it.effectivePrice != null) ? it.effectivePrice : (it.price || 0);
      var line = qty * unit;
      subtotal += line;
      items.push({
        name:  it.name || it.menu_item_name || 'Item',
        qty:   qty,
        price: line,
      });
    });
  });

  // Prefer the caller's pre-computed totals — they reflect exactly the
  // seats being paid (selection-aware) and match what the operator just
  // saw on check-overview. Fall back to the line-total sum when absent.
  var useSubtotal = (typeof params.subtotal  === 'number') ? params.subtotal  : subtotal;
  var tax         = (typeof params.tax       === 'number') ? params.tax       : 0;
  var cardTotal   = (typeof params.cardTotal === 'number') ? params.cardTotal : (useSubtotal + tax);
  var cashPrice   = (typeof params.cashPrice === 'number') ? params.cashPrice : cardTotal;

  if (!baseTotal) baseTotal = cardTotal;

  _renderItemRows(items);
  if (_subRow)  _subRow.setValue('$' + useSubtotal.toFixed(2));
  if (_taxRow)  _taxRow.setValue('$' + tax.toFixed(2));
  if (_cardRow) _cardRow.setValue('$' + cardTotal.toFixed(2));
  if (_cashRow) _cashRow.setValue('$' + cashPrice.toFixed(2));
  if (_checkNumEl && !_checkNumEl.textContent) {
    _checkNumEl.textContent = _deriveCheckLabel(params);
  }

  updateSplitDisplay();
}

// Fallback for direct mounts without seat data — fetches the whole
// order and renders every non-voided line. Not selection-aware.
function populateLeftCard(order) {
  var items    = [];
  var subtotal = 0;
  if (Array.isArray(order.items)) {
    order.items.forEach(function(it) {
      if (it.voided) return;
      var qty  = it.qty || 1;
      var unit = (typeof it.effective_price === 'number')
        ? it.effective_price
        : (typeof it.price === 'number' ? it.price : 0);
      var line = qty * unit;
      subtotal += line;
      items.push({
        name:  it.name || it.menu_item_name || 'Item',
        qty:   qty,
        price: line,
      });
    });
  }
  var tax       = (typeof order.tax === 'number') ? order.tax : 0;
  var cardTotal = (typeof order.balance_due === 'number') ? order.balance_due : (subtotal + tax);
  var cashPrice = cardTotal;

  if (!baseTotal) baseTotal = cardTotal;

  _renderItemRows(items);
  if (_subRow)  _subRow.setValue('$' + subtotal.toFixed(2));
  if (_taxRow)  _taxRow.setValue('$' + tax.toFixed(2));
  if (_cardRow) _cardRow.setValue('$' + cardTotal.toFixed(2));
  if (_cashRow) _cashRow.setValue('$' + cashPrice.toFixed(2));
  if (_checkNumEl) {
    _checkNumEl.textContent = order.check_number
      ? 'CHECK #' + order.check_number
      : _deriveCheckLabel({ orderId: order.order_id });
  }

  updateSplitDisplay();
}


// ═══════════════════════════════════════════════════
//  CENTER COLUMN — Tender Toggle | Balance | Denoms | Actions
// ═══════════════════════════════════════════════════

function buildCenterColumn(params) {
  var col = document.createElement('div');
  col.style.cssText = 'flex:1;min-width:0;display:flex;flex-direction:column;gap:8px;overflow:hidden;';

  col.appendChild(buildTenderToggle());

  // Denom grid — flexes to fill the available vertical space so the
  // tiles grow with the viewport instead of leaving dead space above
  // the balance strip.
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
  _btn100.style.height = '64px';
  col.appendChild(_btn100);

  col.appendChild(buildActionRow());
  col.appendChild(buildBalanceStrip());

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
    label:    label,
    color:    color,
    padding:  '10px 14px',
    fontSize: T.fsB2,
    onClick:  function() { setPaymentMode(mode); },
  });
  btn.style.flex   = '1';
  btn.style.height = '48px';
  _modeButtons[mode] = { el: btn, color: color, dk: dkColor };

  // buildPillButton's pointerleave handler repaints the pill to its
  // "default fill" — which on an inactive toggle wrongly reads as
  // selected whenever the pointer just scrolls across it. Re-run
  // setPaymentMode after every pointer event so our own active /
  // inactive paint wins and only an actual tap changes the state.
  ['pointerup', 'pointerleave', 'pointercancel'].forEach(function(ev) {
    btn.addEventListener(ev, function() { setPaymentMode(paymentMode); });
  });

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
  _checkNumEl.textContent = _deriveCheckLabel(sceneData);
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

  // Same buildActionCard chrome the check-overview seat/check tiles use:
  // green accent bar with glow, raised card shadow, press animation, and
  // proper touch-action so taps register on touch devices.
  var tile = buildActionCard({
    accent:  T.green,
    onClick: function() { handleDenomination(val); },
  });
  tile.style.cssText += [
    (opts.fullWidth ? 'width:100%;flex-shrink:0;' : 'width:100%;height:100%;'),
    'display:flex;align-items:center;justify-content:center;',
    'padding:' + (opts.fullWidth ? '8px 20px 6px 24px' : '18px 20px 16px 24px') + ';',
  ].join('');

  var label = document.createElement('div');
  label.textContent         = '$' + val;
  label.style.fontFamily    = T.fh;
  label.style.fontSize      = T.fsH2;
  label.style.fontWeight    = T.fwBold;
  label.style.color         = T.green;
  label.style.letterSpacing = '0.04em';
  label.style.pointerEvents = 'none';
  tile.appendChild(label);

  // Brief mint-flash on tap so the operator sees the denom was accepted.
  tile.addEventListener('pointerup', function() {
    tile.style.backgroundColor = T.green;
    label.style.color          = T.well;
    setTimeout(function() {
      tile.style.backgroundColor = T.card;
      label.style.color          = T.green;
    }, 180);
  });

  if (!opts.fullWidth) _denomTiles.push(tile);
  return tile;
}

function buildActionRow() {
  var row = document.createElement('div');
  row.style.cssText = 'flex-shrink:0;display:flex;gap:10px;height:60px;';

  // EXACT / SPLIT mirror check-overview's PAY / ADD-ITEMS theme — solid
  // filled pills with color + darkBg shadow, 14px rounding, 20px label.
  var exact = buildPillButton({
    label:   'EXACT',
    color:   T.gold,
    darkBg:  T.goldDk,
    onClick: handleExact,
  });
  Object.assign(exact.style, {
    flex:         '1',
    height:       '60px',
    borderRadius: '14px',
    fontSize:     '20px',
  });
  row.appendChild(exact);

  var split = buildPillButton({
    label:   'SPLIT',
    color:   T.elec,
    darkBg:  T.elecDk,
    onClick: _onSplitTap,
  });
  Object.assign(split.style, {
    flex:         '1',
    height:       '60px',
    borderRadius: '14px',
    fontSize:     '20px',
  });
  row.appendChild(split);

  return row;
}


// ═══════════════════════════════════════════════════
//  RIGHT COLUMN — Numpad
// ═══════════════════════════════════════════════════

function buildRightColumn() {
  var col = document.createElement('div');
  col.style.cssText = 'flex-shrink:0;display:flex;flex-direction:column;gap:6px;align-items:center;';

  // TENDERING label — sits above the numpad's built-in display.
  var tenderLbl = document.createElement('div');
  tenderLbl.textContent         = 'TENDERING';
  tenderLbl.style.fontFamily    = T.fb;
  tenderLbl.style.fontSize      = T.fsB4;
  tenderLbl.style.color         = T.moon;
  tenderLbl.style.letterSpacing = '0.2em';
  tenderLbl.style.textTransform = 'uppercase';
  col.appendChild(tenderLbl);

  // Canonical KINDpos numpad — mint-filled keys, integrated dollar display,
  // vermillion CLR (tap = backspace, long-press = clear all), warm-green ENT.
  var pad = buildNumpad({
    masked:        false,
    maxDigits:     7,
    submitLabel:   'ent',
    displayColor:  T.gold,
    displayFormat: function(digits) {
      var n = parseInt(digits || '0', 10) || 0;
      return '$' + (n / 100).toFixed(2);
    },
    canSubmit: function() { return enteredAmount > 0; },
    onChange:  function(pin) {
      numpadStr     = pin;
      denomAccum    = 0;
      enteredAmount = (parseInt(pin || '0', 10) || 0) / 100;
      updateSplitDisplay();
    },
    onSubmit: function() { handleConfirm(); },
  });

  numpadRef = pad;
  col.appendChild(pad);
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
      el.style.background = T.moon;
      el.style.color      = T.moonText;
      el.style.border     = '4px solid ' + b.color;
      el.style.boxShadow  = 'none';
    }
  });

  // Denom tiles stay live in every mode — they're quick-tender presets for
  // card/gift/split flows as much as for cash, so we don't gate them.
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
    //  1) sceneData.seatNumbers = [1, 2, 3]             (order-entry, transitions)
    //  2) sceneData.seats = [{seatId, number, items}]   (check-overview)
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