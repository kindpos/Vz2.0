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
import { getCashDiscount } from '../pricing.js';

const PAD     = T.scenePad;
const GAP     = T.colGapSm;
const API     = '/api/v1';

// Single module-level state reference — replaced on each render, cleared on unmount.
let _state = null;

// Lazily initializes _state with all defaults — used only by the __handlers
// test seam so tests can inject state without calling render().
function _ensureState() {
  if (!_state) {
    _state = {
      sceneEl: null, sceneData: {}, enteredAmount: 0, denomAccum: 0,
      numpadStr: '', paymentMode: 'card', confirmProcessing: false,
      _cardController: null, _pendingTxId: null, _sceneMounted: false,
      payments: [], totalPaid: 0, baseTotal: 0, numpadRef: null,
      dotTimer: null, _modeButtons: {}, _chevronEl: null, _balanceValueEl: null,
      _checkNumEl: null, _denomTiles: [], _btn100: null,
      _subRow: null, _discRow: null, _taxRow: null, _cardRow: null,
      _cashRow: null, _itemsScroll: null, _procStatusEl: null,
      _procAnimTimer: null, _changeDueTimer: null,
    };
  }
}

// Split tap handler (bound to event bus)
function _onSplitTap() { showSplitPopup(); }

// Pick a human-readable check label from whatever the caller passed.
// Prefers an explicit checkLabel/checkNumber; otherwise strips the
// "order_" prefix from an orderId like "order_abc123" and uses the
// last 4-6 chars so the strip reads "#ABC123" instead of "#order_".
function _deriveCheckLabel(src) {
  if (!src) return '';
  if (src.checkLabel)  return src.checkLabel;
  if (src.checkNumber) return `#${src.checkNumber}`;
  const oid = src.orderId || src.checkId;
  if (!oid) return '';
  const stripped = String(oid).replace(/^order[_-]?/i, '');
  const slice    = stripped.slice(-6) || stripped.slice(0, 6);
  return slice ? `#${slice.toUpperCase()}` : '';
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
  const target    = params.returnTo || 'check-overview';
  const retParams = params.returnParams || {
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

  render: (container, params) => {
    params = params || {};
    const state = {
      sceneEl:           container,
      sceneData:         params,
      enteredAmount:     0,
      denomAccum:        0,
      numpadStr:         '',
      paymentMode:       params.paymentMode || 'card',
      confirmProcessing: false,
      _cardController:   null,
      _pendingTxId:      null,
      _sceneMounted:     true,
      payments:          [],
      totalPaid:         0,
      baseTotal:         Number(params.cardTotal) || 0,
      numpadRef:         null,
      dotTimer:          null,
      _modeButtons:      {},
      _chevronEl:        null,
      _balanceValueEl:   null,
      _checkNumEl:       null,
      _denomTiles:       [],
      _btn100:           null,
      _subRow:           null,
      _discRow:          null,
      _taxRow:           null,
      _cardRow:          null,
      _cashRow:          null,
      _itemsScroll:      null,
      _procStatusEl:     null,
      _procAnimTimer:    null,
      _changeDueTimer:   null,
    };
    _state = state;

    container.style.cssText = [
      'width:100%;height:100%;',
      'display:flex;gap:12px;',
      'padding:10px 24px 16px;',
      'box-sizing:border-box;overflow:hidden;',
      `background:${T.bg};`,
    ].join('');

    container.appendChild(buildLeftColumn(params));
    container.appendChild(buildCenterColumn(params));
    container.appendChild(buildRightColumn(params));

    // Paint active mode now that toggle buttons and denom tiles both exist.
    setPaymentMode(state.paymentMode);
    updateSplitDisplay();

    if (window._header && window._header.setBackHandler) {
      window._header.setBackHandler(() => {
        if (state.confirmProcessing) return;
        _returnToParent(state.sceneData);
      });
    }

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
        fetchWithTimeout(`/api/v1/orders/${encodeURIComponent(params.orderId)}`, {}, 10000)
          .then((r) => r.ok ? r.json() : null)
          .then((order) => {
            if (!_state || !_state._sceneMounted || !_state._checkNumEl) return;
            if (order && order.check_number) {
              _state._checkNumEl.textContent = `CHECK #${order.check_number}`;
            }
          })
          .catch(() => { /* keep the derived fallback */ });
      }
    } else if (params.orderId) {
      fetchWithTimeout(`/api/v1/orders/${encodeURIComponent(params.orderId)}`, {}, 10000)
        .then((r) => r.ok ? r.json() : null)
        .then((order) => {
          if (!_state || !_state._sceneMounted || !order) return;
          populateLeftCard(order);
        })
        .catch(() => { /* silently skip — scene still works */ });
    }
  },

  unmount: () => {
    if (_state) {
      _state._sceneMounted = false;
      _state._pendingTxId  = null;
    }
    SceneManager.off('split:tap', _onSplitTap);
    if (_state && _state._cardController) { _state._cardController.abort(); _state._cardController = null; }
    if (_state && _state.dotTimer) { clearInterval(_state.dotTimer); _state.dotTimer = null; }
    if (_state && _state._procAnimTimer) { clearInterval(_state._procAnimTimer); _state._procAnimTimer = null; }
    if (OrderSummary && OrderSummary.hide) OrderSummary.hide();
    if (window._header && window._header.setBackHandler) {
      window._header.setBackHandler(null);
    }
    _state = null;
  },

  events: {
    'split:tap': () => { showSplitPopup(); },
  },

  interrupts: {
    'split-select': {
      render: (container, params) => {
        params = params || {};
        let remaining = Number(params.remaining) || 0;

        container.style.cssText = 'width:100%;height:100%;display:flex;align-items:center;justify-content:center;pointer-events:auto;';

        // Nostalgia landing-page card shell — gold accent for split
        // affordance.
        const shell = buildStaticCard({ accent: T.gold });
        shell.style.display        = 'flex';
        shell.style.flexDirection  = 'column';
        shell.style.alignItems     = 'center';
        shell.style.gap            = '18px';
        shell.style.minWidth       = '420px';
        shell.style.padding        = '24px 44px 28px 48px';

        let title = document.createElement('div');
        title.style.cssText = [
          `font-family:${T.fh};`,
          `font-size:${T.fsB1};`,
          `font-weight:${T.fwBold};`,
          `color:${T.gold};`,
          'letter-spacing:0.14em;',
          'text-transform:uppercase;',
        ].join('');
        title.textContent = 'Split Payment';
        shell.appendChild(title);

        const sub = document.createElement('div');
        sub.style.cssText = [
          `font-family:${T.fb};`,
          `font-size:${T.fsB2};`,
          `color:${T.green};`,
        ].join('') + `;font-weight:${T.fwBold};`;
        sub.textContent = `Remaining: $${remaining.toFixed(2)}`;
        shell.appendChild(sub);

        let btnRow = document.createElement('div');
        btnRow.style.cssText = 'display:flex;gap:14px;margin-top:4px;';

        // Fraction tiles match the payment denomination presets: raised
        // buildActionCard with green accent bar, "1/N" stacked over the
        // dollar amount, mint flash on tap.
        [2, 3, 4].forEach((divisor) => {
          const amt = Math.ceil(remaining / divisor * 100) / 100;
          let tile = buildActionCard({
            accent:  T.groups.paymentPreset.tileAccent,
            onClick: () => { params.onConfirm(amt); },
          });
          tile.style.cssText += [
            'width:120px;height:96px;flex-shrink:0;',
            'display:flex;flex-direction:column;align-items:center;justify-content:center;',
            'gap:4px;padding:14px 14px 12px 20px;',
          ].join('');

          let label = document.createElement('div');
          label.textContent         = `1/${divisor}`;
          label.style.fontFamily    = T.fh;
          label.style.fontSize      = T.fsH2;
          label.style.fontWeight    = T.fwBold;
          label.style.color         = T.groups.paymentPreset.tileAccent;
          label.style.letterSpacing = '0.04em';
          label.style.pointerEvents = 'none';
          tile.appendChild(label);

          const subLabel = document.createElement('div');
          subLabel.textContent         = `$${amt.toFixed(2)}`;
          subLabel.style.fontFamily    = T.fb;
          subLabel.style.fontSize      = T.fsB3;
          subLabel.style.color         = hexToRgba(T.text, 0.7);
          subLabel.style.letterSpacing = '0.04em';
          subLabel.style.pointerEvents = 'none';
          tile.appendChild(subLabel);

          tile.addEventListener('pointerup', () => {
            tile.style.backgroundColor = T.groups.paymentPreset.tapFlashFill;
            label.style.color          = T.groups.paymentPreset.tapFlashLabel;
            subLabel.style.color       = T.groups.paymentPreset.tapFlashLabel;
            setTimeout(() => {
              tile.style.backgroundColor = T.card;
              label.style.color          = T.groups.paymentPreset.tileAccent;
              subLabel.style.color       = hexToRgba(T.text, 0.7);
            }, 180);
          });

          btnRow.appendChild(tile);
        });
        shell.appendChild(btnRow);

        const cancel = buildPillButton({
          label: 'CANCEL',
          variant: 'verm',
          fontSize: T.fsB2,
          onClick: () => { params.onCancel(); }
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
      render: (container, params) => {
        params = params || {};
        const amount = Number(params.amount) || 0;
        const TOTAL_SEGS = 22;
        const segments = [];
        let segIdx = 0;
        let msgIdx = 0;

        const statusMessages = [
          'Connecting to terminal...',
          'Waiting for card...',
          'Reading card data...',
          'Contacting processor...',
          'Awaiting authorization...',
        ];

        container.style.cssText = 'width:100%;height:100%;display:flex;align-items:center;justify-content:center;';

        // Vz2.0 modal card: left accent bar + rounded + drop shadow.
        let card = document.createElement('div');
        card.style.cssText = [
          `background:${T.card};`,
          `border-left:4px solid ${T.gold};`,
          `border-radius:${T.chamferCard}px;`,
          'width:460px;',
          'box-shadow:0 12px 36px rgba(0,0,0,0.55);',
          `font-family:${T.fb};`,
          'overflow:hidden;',
        ].join('') + `;font-weight:${T.fwBold};`;

        // Header strip
        const titleBar = document.createElement('div');
        titleBar.style.cssText = [
          'padding:14px 20px;',
          `background:${T.well};`,
          'display:flex;align-items:center;gap:12px;',
          `border-bottom:1px solid ${T.border};`,
        ].join('');

        const icon = document.createElement('div');
        icon.style.cssText = [
          'width:32px;height:32px;flex-shrink:0;',
          `background:${T.gold};`,
          'display:flex;align-items:center;justify-content:center;',
          `font-size:18px;font-weight:${T.fwBold};`,
          `color:${T.well};`,
          'border-radius:8px;',
        ].join('');
        icon.textContent = '◈';

        const titleText = document.createElement('span');
        titleText.style.cssText = [
          `font-family:${T.fh};`,
          `font-size:${T.fsB2};`,
          `font-weight:${T.fwBold};`,
          `color:${T.green};`,
          'letter-spacing:0.08em;',
          'text-transform:uppercase;',
        ].join('');
        titleText.textContent = `Card Payment — $${amount.toFixed(2)}`;

        titleBar.appendChild(icon);
        titleBar.appendChild(titleText);
        card.appendChild(titleBar);

        // Body
        const body = document.createElement('div');
        body.style.cssText = 'padding:24px 24px 22px;display:flex;flex-direction:column;gap:14px;';

        if (_state) _state._procStatusEl = document.createElement('div');
        const procStatusEl = _state ? _state._procStatusEl : document.createElement('div');
        procStatusEl.style.cssText = [
          `font-family:${T.fb};`,
          `font-size:${T.fsB2};`,
          `color:${T.text};`,
          'min-height:28px;',
        ].join('') + `;font-weight:${T.fwBold};`;
        procStatusEl.textContent = statusMessages[0];
        body.appendChild(procStatusEl);

        // Progress bar: rounded well with gold segments inside.
        const progContainer = document.createElement('div');
        progContainer.style.cssText = [
          'height:28px;padding:3px;',
          `background:${T.well};`,
          `border:1px solid ${T.border};`,
          'border-radius:8px;',
          'overflow:hidden;',
          'box-shadow:inset 0 2px 4px rgba(0,0,0,0.4);',
        ].join('');
        const progFill = document.createElement('div');
        progFill.style.cssText = 'height:100%;display:flex;gap:2px;align-items:stretch;';

        for (let i = 0; i < TOTAL_SEGS; i++) {
          const seg = document.createElement('div');
          seg.style.cssText = [
            'width:14px;flex-shrink:0;',
            `background:${T.gold};`,
            'border-radius:2px;',
            'opacity:0;transition:opacity 0.05s;',
          ].join('');
          progFill.appendChild(seg);
          segments.push(seg);
        }
        progContainer.appendChild(progFill);
        body.appendChild(progContainer);

        const hint = document.createElement('div');
        hint.style.cssText = [
          `font-family:${T.fb};`,
          `font-size:${T.fsB3};`,
          `color:${hexToRgba(T.text, 0.6)};`,
          'text-align:center;',
          'letter-spacing:0.05em;',
        ].join('') + `;font-weight:${T.fwBold};`;
        hint.textContent = 'Present card on terminal...';
        body.appendChild(hint);

        card.appendChild(body);
        container.appendChild(card);

        const animTimer = setInterval(() => {
          if (segIdx < TOTAL_SEGS) {
            segments[segIdx].style.opacity = '1';
            segIdx++;
          }
          if (segIdx % 4 === 0 && msgIdx < statusMessages.length - 1) {
            msgIdx++;
            if (_state && _state._procStatusEl) _state._procStatusEl.textContent = statusMessages[msgIdx];
          }
          if (segIdx >= TOTAL_SEGS) {
            segIdx = 0;
            segments.forEach((s) => { s.style.opacity = '0'; });
          }
        }, 200);
        if (_state) _state._procAnimTimer = animTimer;
      },
      unmount: () => {
        if (_state && _state._procAnimTimer) clearInterval(_state._procAnimTimer);
        if (_state) {
          _state._procAnimTimer = null;
          _state._procStatusEl  = null;
        }
      },
    },

    'pc-change-due': {
      render: (container, params) => {
        params = params || {};
        let returned = false;
        if (_state) _state._changeDueTimer = null;


        container.style.cssText = [
          'width:100%;height:100%;',
          'display:flex;flex-direction:column;align-items:center;justify-content:center;',
          `gap:24px;background:${T.scrimInterrupt};`,
        ].join('');

        let isCash    = params.paymentMode === 'cash';
        const hasChange = isCash && params.change > 0;

        // Vz2.0 card with accent bar (gold for change-due celebration)
        let card = document.createElement('div');
        card.style.cssText = [
          'display:flex;flex-direction:column;align-items:center;',
          'padding:40px 72px 36px;',
          `background:${T.card};`,
          `border-left:4px solid ${T.gold};`,
          `border-radius:${T.chamferCard}px;`,
          'box-shadow:0 16px 48px rgba(0,0,0,0.55);',
          'min-width:520px;',
        ].join('');

        const topLabel = document.createElement('div');
        topLabel.style.cssText = [
          `font-family:${T.fh};`,
          `font-size:${T.fsB1};`,
          `font-weight:${T.fwBold};`,
          'letter-spacing:0.22em;',
          `color:${T.green};`,
          'margin-bottom:24px;',
          'text-transform:uppercase;',
        ].join('');
        topLabel.textContent = isCash ? 'Cash Payment' : 'Card Payment';
        card.appendChild(topLabel);

        if (hasChange) {
          const changeLabel = document.createElement('div');
          changeLabel.style.cssText = [
            `font-family:${T.fh};`,
            `font-size:${T.fsB2};`,
            `font-weight:${T.fwBold};`,
            'letter-spacing:0.18em;',
            `color:${T.green};`,
            'margin-bottom:8px;',
            'text-transform:uppercase;',
          ].join('');
          changeLabel.textContent = 'Change Due';
          card.appendChild(changeLabel);

          const changeAmount = document.createElement('div');
          changeAmount.style.cssText = [
            `font-family:${T.fh};`,
            `font-size:108px;font-weight:${T.fwBold};`,
            `color:${T.gold};`,
            'line-height:1;letter-spacing:0.02em;',
            `text-shadow:0 0 24px ${hexToRgba(T.gold, 0.35)};`,
          ].join('');
          changeAmount.textContent = `$${params.change.toFixed(2)}`;
          card.appendChild(changeAmount);
        } else {
          const paidLabel = document.createElement('div');
          paidLabel.style.cssText = [
            `font-family:${T.fh};`,
            `font-size:44px;font-weight:${T.fwBold};`,
            'letter-spacing:0.14em;',
            `color:${T.green};`,
            'margin-bottom:8px;',
            'text-transform:uppercase;',
          ].join('');
          paidLabel.textContent = isCash ? 'Exact Change' : 'Payment Approved';
          card.appendChild(paidLabel);
        }

        const chargedLine = document.createElement('div');
        chargedLine.style.cssText = [
          `font-family:${T.fb};`,
          `font-size:${T.fsB2};`,
          `color:${hexToRgba(T.text, 0.6)};`,
          'margin-top:14px;',
          'letter-spacing:0.06em;',
        ].join('') + `;font-weight:${T.fwBold};`;
        chargedLine.textContent = (isCash ? 'Cash price: ' : 'Charged: ') + `$${params.total.toFixed(2)}`;
        card.appendChild(chargedLine);

        const printLine = document.createElement('div');
        printLine.style.cssText = [
          `font-family:${T.fb};`,
          `font-size:${T.fsB3};`,
          `color:${hexToRgba(T.text, 0.6)};`,
          'letter-spacing:0.14em;',
          'margin-top:18px;',
          'text-transform:uppercase;',
        ].join('') + `;font-weight:${T.fwBold};`;
        printLine.textContent = 'Receipt Printing...';
        card.appendChild(printLine);

        container.appendChild(card);

        const btnRow = document.createElement('div');
        btnRow.style.cssText = 'display:flex;gap:20px;';

        const newOrderBtn = buildPillButton({
          label: 'OVERVIEW',
          color: T.elec,
          onClick: () => { doReturn('check-overview'); }
        });
        newOrderBtn.style.flex = '0 0 auto';
        newOrderBtn.style.width  = '240px';
        newOrderBtn.style.height = '72px';
        btnRow.appendChild(newOrderBtn);

        const logoutBtn = buildPillButton({
          label: 'LOGOUT',
          color: T.green,
          onClick: () => { doReturn('login'); }
        });
        logoutBtn.style.flex = '0 0 auto';
        logoutBtn.style.width  = '240px';
        logoutBtn.style.height = '72px';
        btnRow.appendChild(logoutBtn);

        container.appendChild(btnRow);

        const postAction = (window.KINDpos && window.KINDpos.postPaymentAction) || 'quick-service';
        if (postAction === 'logout') {
          const autoHint = document.createElement('div');
          autoHint.style.cssText = [
            `font-family:${T.fb};`,
            `font-size:${T.fsB3};`,
            `color:${hexToRgba(T.text, 0.6)};`,
            'letter-spacing:0.12em;',
            'margin-top:4px;',
          ].join('') + `;font-weight:${T.fwBold};`;
          autoHint.textContent = 'auto-logout in 8s...';
          container.appendChild(autoHint);

          let countdown = 8;
          const cdTimer = setInterval(() => {
            countdown--;
            if (countdown <= 0) {
              clearInterval(cdTimer);
              if (_state) _state._changeDueTimer = null;
              doReturn('login');
            } else {
              autoHint.textContent = `auto-logout in ${countdown}s...`;
            }
          }, 1000);
          if (_state) _state._changeDueTimer = cdTimer;
        } else if (params.isLastPayment) {
          // Final seat paid — auto-return to landing after a short flash.
          const landingHint = document.createElement('div');
          landingHint.style.cssText = [
            `font-family:${T.fb};`,
            `font-size:${T.fsB3};`,
            `color:${hexToRgba(T.text, 0.6)};`,
            'letter-spacing:0.12em;',
            'margin-top:4px;',
          ].join('') + `;font-weight:${T.fwBold};`;
          landingHint.textContent = 'returning to landing in 3s...';
          container.appendChild(landingHint);

          let lcount = 3;
          const lcTimer = setInterval(() => {
            lcount--;
            if (lcount <= 0) {
              clearInterval(lcTimer);
              if (_state) _state._changeDueTimer = null;
              doReturn('landing');
            } else {
              landingHint.textContent = `returning to landing in ${lcount}s...`;
            }
          }, 1000);
          if (_state) _state._changeDueTimer = lcTimer;
        }

        function doReturn(target) {
          if (returned) return;
          returned = true;
          if (_state && _state._changeDueTimer) { clearInterval(_state._changeDueTimer); _state._changeDueTimer = null; }
          const activeScene = SceneManager.getActiveWorking();
          SceneManager.closeAllTransactional();
          const sd = _state ? _state.sceneData : {};
          if (target === 'login') {
            OrderSummary.hide();
            SceneManager.unmountWorking(activeScene);
            SceneManager.openGate('login');
          } else if (target === 'check-overview') {
            OrderSummary.hide();
            SceneManager.mountWorking('check-overview', {
              checkId:       sd.orderId,
              returnLanding: sd.returnLanding
                || (sd.returnParams && sd.returnParams.returnLanding)
                || null,
              employeeId:    sd.employeeId,
              employeeName:  sd.employeeName,
              pin:           sd.pin,
            });
          } else if (target === 'landing') {
            OrderSummary.hide();
            SceneManager.unmountWorking(activeScene);
            const landingScene = sd.returnLanding
              || (sd.returnParams && sd.returnParams.returnLanding)
              || 'server-landing';
            SceneManager.mountWorking(landingScene, {
              emp: {
                id:   sd.employeeId,
                name: sd.employeeName,
                pin:  sd.pin,
              },
            });
          } else if (activeScene === 'check-overview') {
            SceneManager.emit('payment:complete');
          } else {
            // Quick-service flow — start a fresh check for the same server.
            OrderSummary.hide();
            SceneManager.mountWorking('order-entry', {
              employeeId:   sd.employeeId,
              employeeName: sd.employeeName,
              pin:          sd.pin,
              returnLanding: sd.returnLanding
                || (sd.returnParams && sd.returnParams.returnLanding)
                || null,
            });
          }
        }
      },
      unmount: () => {
        if (_state && _state._changeDueTimer) { clearInterval(_state._changeDueTimer); _state._changeDueTimer = null; }
      },
    },
  },

  // Test seam — only referenced in *.test.js files.
  __handlers: {
    get pendingTxId()         { return _state ? _state._pendingTxId : null; },
    get confirmProcessing()   { return _state ? _state.confirmProcessing : false; },
    get payments()            { return _state ? _state.payments : []; },
    set sceneData(v)          { _ensureState(); _state.sceneData = v; },
    set enteredAmount(v)      { _ensureState(); _state.enteredAmount = v; },
    set paymentMode(v)        { _ensureState(); _state.paymentMode = v; },
    set totalPaid(v)          { _ensureState(); _state.totalPaid = v; },
    set baseTotal(v)          { _ensureState(); _state.baseTotal = v; },
    handleConfirm:            () => handleConfirm(),
  },
});


// ═══════════════════════════════════════════════════
//  LEFT COLUMN — Order Recap
// ═══════════════════════════════════════════════════

function buildLeftColumn(params) {
  const wrap = document.createElement('div');
  wrap.style.cssText = 'width:300px;flex-shrink:0;display:flex;flex-direction:column;min-height:0;';

  let card = buildStaticCard({ accent: T.green, width: '300px' });
  card.style.flex          = '1';
  card.style.display       = 'flex';
  card.style.flexDirection = 'column';
  card.style.minHeight     = '0';
  card.style.padding       = '14px 14px 14px 18px';

  // Header row — chevron + label
  const header = document.createElement('div');
  header.style.cssText = 'flex-shrink:0;display:flex;align-items:center;gap:10px;margin-bottom:10px;';

  _state._chevronEl = document.createElement('div');
  _state._chevronEl.textContent         = '◄';
  _state._chevronEl.style.fontFamily    = T.fh;
  _state._chevronEl.style.fontSize      = T.fsB2;
  _state._chevronEl.style.color         = T.green;
  _state._chevronEl.style.cursor        = 'pointer';
  _state._chevronEl.style.userSelect    = 'none';
  _state._chevronEl.style.touchAction   = 'manipulation';
  _state._chevronEl.style.padding       = '2px 6px';
  _state._chevronEl.addEventListener('pointerup', () => {
    if (_state.confirmProcessing) return;
    _returnToParent(_state.sceneData);
  });
  header.appendChild(_state._chevronEl);

  const title = document.createElement('div');
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
  _state._itemsScroll = document.createElement('div');
  _state._itemsScroll.style.cssText = 'flex:1;min-height:0;overflow-y:auto;display:flex;flex-direction:column;';
  card.appendChild(_state._itemsScroll);

  // Totals block
  card.appendChild(buildDivider('10px 0'));
  _state._subRow  = buildDataRow('SUBTOTAL', '$0.00', T.gold);
  _state._discRow = buildDataRow('DISCOUNT', '-$0.00', T.lavender);
  _state._discRow.style.display = 'none';
  _state._taxRow  = buildDataRow('TAX',      '$0.00', T.gold);
  card.appendChild(_state._subRow);
  card.appendChild(_state._discRow);
  card.appendChild(_state._taxRow);

  card.appendChild(buildDivider('10px 0'));
  _state._cardRow = buildDataRow('CARD PRICE', '$0.00', T.elec);
  _state._cashRow = buildDataRow('CASH PRICE', '$0.00', T.greenWarm);
  card.appendChild(_state._cardRow);
  card.appendChild(_state._cashRow);

  wrap.appendChild(card);

  if (_state.totalPaid > 0 && _state._chevronEl) _state._chevronEl.style.display = 'none';
  return wrap;
}

// Render { qty, name, price: lineTotal } rows into the scrollable recap.
function _renderItemRows(items) {
  if (!_state._itemsScroll) return;
  _state._itemsScroll.innerHTML = '';
  items.forEach((it) => {
    let row = document.createElement('div');
    row.style.cssText = [
      'display:flex;align-items:baseline;justify-content:space-between;',
      'padding:6px 0;',
      'border-bottom:1px solid rgba(90,95,102,0.25);',
      'gap:8px;',
    ].join('');

    const left = document.createElement('span');
    left.textContent         = it.qty + `  ${it.name}`;
    left.style.fontFamily    = T.fb;
    left.style.fontSize      = T.fsB3;
    left.style.color         = T.text;
    left.style.overflow      = 'hidden';
    left.style.textOverflow  = 'ellipsis';
    left.style.whiteSpace    = 'nowrap';
    row.appendChild(left);

    const right = document.createElement('span');
    right.textContent      = `$${it.price.toFixed(2)}`;
    right.style.fontFamily = T.fb;
    right.style.fontSize   = T.fsB2;
    right.style.fontWeight = T.fwBold;
    right.style.color      = T.gold;
    right.style.flexShrink = '0';
    row.appendChild(right);

    _state._itemsScroll.appendChild(row);
  });
}

// Selection-aware recap — rendered from the seat summary that
// check-overview hands off in params. Pulls only the selected seats'
// items and honors effectivePrice so modifier-adjusted lines display
// the same value the operator saw on the overview.
function populateLeftCardFromSeats(seats, params) {
  let items    = [];
  let subtotal = 0;
  seats.forEach((seat) => {
    if (!seat || !Array.isArray(seat.items)) return;
    seat.items.forEach((it) => {
      if (it.voided) return;
      let qty  = it.qty || 1;
      let unit = (it.effectivePrice != null) ? it.effectivePrice : (it.price || 0);
      let line = qty * unit;
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
  const useSubtotal    = (typeof params.subtotal  === 'number') ? params.subtotal  : subtotal;
  let tax            = (typeof params.tax       === 'number') ? params.tax       : 0;
  let cardTotal      = (typeof params.cardTotal === 'number') ? params.cardTotal : (useSubtotal + tax);
  let cashPrice      = (typeof params.cashPrice === 'number') ? params.cashPrice : cardTotal;
  let managerDisc    = (typeof params.managerDiscountTotal === 'number') ? params.managerDiscountTotal : 0;

  if (!_state.baseTotal) _state.baseTotal = cardTotal;

  _renderItemRows(items);
  if (_state._subRow)  _state._subRow.setValue(`$${useSubtotal.toFixed(2)}`);
  if (_state._discRow) {
    _state._discRow.style.display = managerDisc > 0 ? '' : 'none';
    if (managerDisc > 0) _state._discRow.setValue(`-$${managerDisc.toFixed(2)}`);
  }
  if (_state._taxRow)  _state._taxRow.setValue(`$${tax.toFixed(2)}`);
  if (_state._cardRow) _state._cardRow.setValue(`$${cardTotal.toFixed(2)}`);
  if (_state._cashRow) _state._cashRow.setValue(`$${cashPrice.toFixed(2)}`);
  if (_state._checkNumEl && !_state._checkNumEl.textContent) {
    _state._checkNumEl.textContent = _deriveCheckLabel(params);
  }

  updateSplitDisplay();
}

// Fallback for direct mounts without seat data — fetches the whole
// order and renders every non-voided line. Not selection-aware.
function populateLeftCard(order) {
  const items    = [];
  let subtotal = 0;
  if (Array.isArray(order.items)) {
    order.items.forEach((it) => {
      if (it.voided) return;
      const qty  = it.qty || 1;
      const unit = (typeof it.effective_price === 'number')
        ? it.effective_price
        : (typeof it.price === 'number' ? it.price : 0);
      const line = qty * unit;
      subtotal += line;
      items.push({
        name:  it.name || it.menu_item_name || 'Item',
        qty:   qty,
        price: line,
      });
    });
  }
  const tax         = (typeof order.tax === 'number') ? order.tax : 0;
  const cardTotal   = (typeof order.balance_due === 'number') ? order.balance_due : (subtotal + tax);
  const cashPrice   = Math.round(cardTotal * (1 - getCashDiscount()) * 100) / 100;
  const managerDisc = typeof order.manager_discount_total === 'number' ? order.manager_discount_total : 0;

  if (!_state.baseTotal) _state.baseTotal = cardTotal;

  _renderItemRows(items);
  if (_state._subRow)  _state._subRow.setValue(`$${subtotal.toFixed(2)}`);
  if (_state._discRow) {
    _state._discRow.style.display = managerDisc > 0 ? '' : 'none';
    if (managerDisc > 0) _state._discRow.setValue(`-$${managerDisc.toFixed(2)}`);
  }
  if (_state._taxRow)  _state._taxRow.setValue(`$${tax.toFixed(2)}`);
  if (_state._cardRow) _state._cardRow.setValue(`$${cardTotal.toFixed(2)}`);
  if (_state._cashRow) _state._cashRow.setValue(`$${cashPrice.toFixed(2)}`);
  if (_state._checkNumEl) {
    _state._checkNumEl.textContent = order.check_number
      ? `CHECK #${order.check_number}`
      : _deriveCheckLabel({ orderId: order.order_id });
  }

  updateSplitDisplay();
}


// ═══════════════════════════════════════════════════
//  CENTER COLUMN — Tender Toggle | Balance | Denoms | Actions
// ═══════════════════════════════════════════════════

function buildCenterColumn(params) {
  let col = document.createElement('div');
  col.style.cssText = 'flex:1;min-width:0;display:flex;flex-direction:column;gap:8px;overflow:hidden;';

  col.appendChild(buildTenderToggle());

  // Denom grid — flexes to fill the available vertical space so the
  // tiles grow with the viewport instead of leaving dead space above
  // the balance strip.
  const grid = document.createElement('div');
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

  _state._btn100 = buildDenomTile(100, { fullWidth: true });
  _state._btn100.style.height = '64px';
  col.appendChild(_state._btn100);

  col.appendChild(buildActionRow());
  col.appendChild(buildBalanceStrip());

  return col;
}

function buildTenderToggle() {
  let row = document.createElement('div');
  row.style.cssText = 'flex-shrink:0;display:flex;gap:8px;';
  row.appendChild(buildModeToggle('cash', 'CASH', T.greenWarm, T.greenWarmDk));
  row.appendChild(buildModeToggle('card', 'CARD', T.elec,      T.elecDk));
  row.appendChild(buildModeToggle('gc',   'GIFT', '#e040fb',   '#7b0099'));
  return row;
}

function buildModeToggle(mode, label, color, dkColor) {
  const btn = buildPillButton({
    label:    label,
    color:    color,
    padding:  '10px 14px',
    fontSize: T.fsB2,
    onClick:  () => { setPaymentMode(mode); },
  });
  btn.style.flex   = '1';
  btn.style.height = '48px';
  _state._modeButtons[mode] = { el: btn, color, dk: dkColor };

  // buildPillButton's pointerleave handler repaints the pill to its
  // "default fill" — which on an inactive toggle wrongly reads as
  // selected whenever the pointer just scrolls across it. Re-run
  // setPaymentMode after every pointer event so our own active /
  // inactive paint wins and only an actual tap changes the state.
  ['pointerup', 'pointerleave', 'pointercancel'].forEach((ev) => {
    btn.addEventListener(ev, () => { setPaymentMode(_state.paymentMode); });
  });

  return btn;
}

function buildBalanceStrip() {
  const card = buildStaticCard({ accent: T.gold });
  card.style.flexShrink = '0';
  card.style.height     = '36px';
  card.style.padding    = '0 14px 0 20px';
  card.style.display    = 'flex';
  card.style.alignItems = 'center';
  card.style.justifyContent = 'space-between';

  let label = document.createElement('span');
  label.textContent         = 'REMAINING';
  label.style.fontFamily    = T.fb;
  label.style.fontSize      = T.fsB3;
  label.style.color         = T.moon;
  label.style.letterSpacing = '0.18em';
  label.style.textTransform = 'uppercase';
  card.appendChild(label);

  _state._checkNumEl = document.createElement('span');
  _state._checkNumEl.style.fontFamily    = T.fb;
  _state._checkNumEl.style.fontSize      = T.fsB3;
  _state._checkNumEl.style.color         = T.moon;
  _state._checkNumEl.style.letterSpacing = '0.12em';
  _state._checkNumEl.textContent = _deriveCheckLabel(_state.sceneData);
  card.appendChild(_state._checkNumEl);

  _state._balanceValueEl = document.createElement('span');
  _state._balanceValueEl.style.fontFamily = T.fh;
  _state._balanceValueEl.style.fontSize   = T.fsB2;
  _state._balanceValueEl.style.fontWeight = T.fwBold;
  _state._balanceValueEl.style.color      = T.gold;
  _state._balanceValueEl.style.textShadow = `0 0 8px ${hexToRgba(T.gold, 0.35)}`;
  _state._balanceValueEl.textContent      = `$${getRemainingBalance().toFixed(2)}`;
  card.appendChild(_state._balanceValueEl);

  return card;
}

function buildDenomTile(val, opts) {
  opts = opts || {};

  // Same buildActionCard chrome the check-overview seat/check tiles use:
  // green accent bar with glow, raised card shadow, press animation, and
  // proper touch-action so taps register on touch devices.
  const tile = buildActionCard({
    accent:  T.groups.paymentPreset.tileAccent,
    onClick: () => { handleDenomination(val); },
  });
  tile.style.cssText += [
    (opts.fullWidth ? 'width:100%;flex-shrink:0;' : 'width:100%;height:100%;'),
    'display:flex;align-items:center;justify-content:center;',
    `padding:${(opts.fullWidth ? '8px 20px 6px 24px' : '18px 20px 16px 24px')};`,
  ].join('');

  const label = document.createElement('div');
  label.textContent         = `$${val}`;
  label.style.fontFamily    = T.fh;
  label.style.fontSize      = T.fsH2;
  label.style.fontWeight    = T.fwBold;
  label.style.color         = T.groups.paymentPreset.tileAccent;
  label.style.letterSpacing = '0.04em';
  label.style.pointerEvents = 'none';
  tile.appendChild(label);

  tile.addEventListener('pointerup', () => {
    tile.style.backgroundColor = T.groups.paymentPreset.tapFlashFill;
    label.style.color          = T.groups.paymentPreset.tapFlashLabel;
    setTimeout(() => {
      tile.style.backgroundColor = T.card;
      label.style.color          = T.groups.paymentPreset.tileAccent;
    }, 180);
  });

  if (!opts.fullWidth) _state._denomTiles.push(tile);
  return tile;
}

function buildActionRow() {
  const row = document.createElement('div');
  row.style.cssText = 'flex-shrink:0;display:flex;gap:10px;height:60px;';

  // EXACT / SPLIT mirror check-overview's PAY / ADD-ITEMS theme — solid
  // filled pills with color + darkBg shadow, 14px rounding, 20px label.
  const exact = buildPillButton({
    label:   'EXACT',
    color:   T.gold,
    darkBg:  T.goldDk,
    onClick: handleExact,
  });
  Object.assign(exact.style, {
    fontWeight: T.fwBold,
    flex:         '1',
    height:       '60px',
    borderRadius: '14px',
    fontSize:     '20px',
  });
  row.appendChild(exact);

  const split = buildPillButton({
    label:   'SPLIT',
    color:   T.elec,
    darkBg:  T.elecDk,
    onClick: _onSplitTap,
  });
  Object.assign(split.style, {
    fontWeight: T.fwBold,
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
  const col = document.createElement('div');
  col.style.cssText = 'flex-shrink:0;display:flex;flex-direction:column;gap:6px;align-items:center;';

  // TENDERING label — sits above the numpad's built-in display.
  const tenderLbl = document.createElement('div');
  tenderLbl.textContent         = 'TENDERING';
  tenderLbl.style.fontFamily    = T.fb;
  tenderLbl.style.fontSize      = T.fsB4;
  tenderLbl.style.color         = T.moon;
  tenderLbl.style.letterSpacing = '0.2em';
  tenderLbl.style.textTransform = 'uppercase';
  col.appendChild(tenderLbl);

  // Canonical KINDpos numpad — mint-filled keys, integrated dollar display,
  // vermillion CLR (tap = backspace, long-press = clear all), warm-green ENT.
  const pad = buildNumpad({
    masked:        false,
    maxDigits:     7,
    submitLabel:   'ent',
    displayColor:  T.gold,
    displayFormat: (digits) => {
      const n = parseInt(digits || '0', 10) || 0;
      return `$${(n / 100).toFixed(2)}`;
    },
    canSubmit: () => _state.enteredAmount > 0,
    onChange:  (pin) => {
      _state.numpadStr     = pin;
      _state.denomAccum    = 0;
      _state.enteredAmount = (parseInt(pin || '0', 10) || 0) / 100;
      updateSplitDisplay();
    },
    onSubmit: () => { handleConfirm(); },
  });

  _state.numpadRef = pad;
  col.appendChild(pad);
  return col;
}


// ═══════════════════════════════════════════════════
//  PAYMENT MODE TOGGLE
// ═══════════════════════════════════════════════════

function setPaymentMode(mode) {
  _state.paymentMode = mode;

  // Paint each tender toggle: active = filled + glow, inactive = ghost.
  Object.keys(_state._modeButtons).forEach((m) => {
    const b = _state._modeButtons[m];
    if (!b || !b.el) return;
    const isActive = (m === mode);
    const el = b.el;
    if (isActive) {
      el.style.background = b.color;
      el.style.color      = T.well;
      el.style.border     = 'none';
      el.style.boxShadow  = `0 4px 0 ${b.dk}, 0 0 16px ${hexToRgba(b.color, 0.4)}`;
    } else {
      el.style.background = T.moon;
      el.style.color      = T.moonText;
      el.style.border     = `4px solid ${b.color}`;
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
  _state.denomAccum += val;
  _state.numpadStr = '';
  _state.enteredAmount = _state.denomAccum;
  if (_state.numpadRef) {
    _state.numpadRef.setPin('');
    _state.numpadRef.setHint(`$${_state.denomAccum.toFixed(2)}`, T.gold);
  }
  updateSplitDisplay();
}

function handleExact() {
  let remaining = getRemainingBalance();
  if (remaining <= 0) {
    showToast('Nothing due', { bg: T.gold, duration: 1500 });
    return;
  }
  _state.enteredAmount = remaining;
  _state.denomAccum = 0;
  // Populate the numpad's digit buffer with the remaining amount in cents
  // so the display reads the same as if the user typed it manually — then
  // pressing `ent` submits via the normal path.
  const cents = Math.round(remaining * 100).toString();
  _state.numpadStr = cents;
  if (_state.numpadRef) {
    _state.numpadRef.setPin(cents);
  }
  updateSplitDisplay();
}


// ═══════════════════════════════════════════════════
//  BALANCE TRACKING
// ═══════════════════════════════════════════════════

function getRemainingBalance() {
  return Math.max(0, _state.baseTotal - _state.totalPaid);
}

function updateSplitDisplay() {
  if (_state._balanceValueEl) {
    _state._balanceValueEl.textContent = `$${getRemainingBalance().toFixed(2)}`;
  }
}


// ═══════════════════════════════════════════════════
//  CONFIRM — API Calls
// ═══════════════════════════════════════════════════

async function handleConfirm() {
  if (_state.confirmProcessing) return;
  _state.confirmProcessing = true;

  let remaining = getRemainingBalance();
  const isCash = _state.paymentMode === 'cash';
  const paymentAmount = Math.min(_state.enteredAmount, remaining);
  const change = isCash ? Math.max(0, _state.enteredAmount - paymentAmount) : 0;
  let proc = null;

  if (paymentAmount <= 0) {
    _state.confirmProcessing = false;
    return;
  }

  if (!_state._pendingTxId) {
    _state._pendingTxId = (typeof crypto !== 'undefined' && crypto.randomUUID)
      ? crypto.randomUUID()
      : `tx_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
  }

  try {
    // Resolve seat_numbers for the backend. Two param shapes are supported:
    //  1) sceneData.seatNumbers = [1, 2, 3]             (order-entry, transitions)
    //  2) sceneData.seats = [{seatId, number, items}]   (check-overview)
    // Without seat_numbers the backend can't tag the payment to specific
    // seats, so check-overview wouldn't render them as paid (gold) on return.
    let seatNumbers = null;
    if (Array.isArray(_state.sceneData.seatNumbers) && _state.sceneData.seatNumbers.length) {
      seatNumbers = _state.sceneData.seatNumbers.slice();
    } else if (Array.isArray(_state.sceneData.seats) && _state.sceneData.seats.length) {
      seatNumbers = _state.sceneData.seats
        .map((s) => s && typeof s.number === 'number' ? s.number : null)
        .filter((n) => n !== null);
      if (seatNumbers.length === 0) seatNumbers = null;
    }

    if (isCash) {
      const cashBody = {
          order_id:       _state.sceneData.orderId,
          amount:         paymentAmount,
          tip:            0.0,
          payment_method: 'cash',
          transaction_id: _state._pendingTxId,
      };
      if (seatNumbers) cashBody.seat_numbers = seatNumbers;
      let res = await fetchWithTimeout(API + '/payments/cash', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(cashBody),
      }, 20000);
      if (!res.ok) {
        let err = await res.json().catch(() => { return {}; });
        _state.confirmProcessing = false;
        showToast(err.detail || 'Cash payment failed', { bg: T.verm });
        return;
      }
    } else {
      proc = showProcessingOverlay(paymentAmount);

      _state._cardController = new AbortController();
      const controller = _state._cardController;
      const cardTimeout = setTimeout(() => { controller.abort(); }, 95000);

      const saleBody = {
          transaction_id: _state._pendingTxId,
          order_id:       _state.sceneData.orderId,
          amount:         paymentAmount,
          terminal_id:    'terminal_01',
      };
      if (seatNumbers) saleBody.seat_numbers = seatNumbers;
      // Intentional bare fetch() — card payments need a 95 s timeout and
      // _cardController must be accessible from outside this function so the
      // payment can be aborted programmatically (e.g. scene unmount or user
      // cancel). fetchWithTimeout owns its own AbortController internally and
      // doesn't expose it, so we manage the signal manually here.
      const res = await fetch(API + '/payments/sale', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(saleBody),
        signal: controller.signal,
      });

      clearTimeout(cardTimeout);
      _state._cardController = null;
      if (proc) proc.dismiss();

      if (!res.ok) {
        const err = await res.json().catch(() => { return {}; });
        const errType = res.status === 402 ? 'DECLINED'
                    : res.status === 400 ? 'CANCELLED'
                    : 'ERROR';
        _state.confirmProcessing = false;
        showToast(err.detail || `Payment failed — ${errType}`, { bg: T.verm });
        return;
      }
    }

    // ── Success — queue receipts ──
    queueReceipt('customer');
    if (!isCash) queueReceipt('merchant');

    _state.payments.push({ method: _state.paymentMode, amount: paymentAmount });
    _state.totalPaid += paymentAmount;
    _state._pendingTxId = null;

    // Guard: scene could have been force-unmounted (e.g. logout) while the
    // cash fetch was in-flight. Card payments are already guarded by
    // _cardController.abort(), but fetchWithTimeout has no external abort.
    if (!_state._sceneMounted) return;

    // Hide the back chevron now that money has been taken — a
    // back-to-check-overview here would orphan the recorded payment.
    if (_state._chevronEl) _state._chevronEl.style.display = 'none';

    const newRemaining = getRemainingBalance();
    _state.confirmProcessing = false;

    if (newRemaining < 0.005) {
      activateResult(change);
    } else {
      _state.enteredAmount = 0;
      _state.denomAccum = 0;
      _state.numpadStr = '';
      if (_state.numpadRef) _state.numpadRef.clear();
      updateSplitDisplay();
      showToast(
        `$${paymentAmount.toFixed(2)} ${_state.paymentMode} — $${newRemaining.toFixed(2)} remaining`,
        { bg: T.greenWarm, duration: 3000 }
      );
    }

  } catch (err) {
    if (proc) proc.dismiss();
    _state.confirmProcessing = false;
    showToast('Connection error — check terminal', { bg: T.verm });
  }
}

function queueReceipt(copyType) {
  // 15s abort guard — a hung printer endpoint used to leave this promise
  // dangling forever with no error surfaced to the operator.
  fetchWithTimeout(API + `/print/receipt/${_state.sceneData.orderId}?copy_type=${copyType}`, { method: 'POST' }, 15000)
    .then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); })
    .catch((err) => {
      console.warn(`[KINDpos] Receipt print failed (${copyType}):`, err);
      showToast('Receipt print failed — check printer');
    });
}


// ═══════════════════════════════════════════════════
//  RESULT — Open Change Due
// ═══════════════════════════════════════════════════

function activateResult(change) {
  const lastPayment = _state.payments[_state.payments.length - 1] || {};
  let remaining = getRemainingBalance();
  const isFullyPaid = remaining < 0.005;

  SceneManager.closeAllTransactional();
  SceneManager.emit('payment:complete', { orderId: _state.sceneData.orderId });

  if (isFullyPaid) {
    // Whole check settled → hand off to the change-due transactional,
    // which owns the NEW ORDER / LOGOUT routing via its own doReturn.
    SceneManager.openTransactional('pc-change-due', {
      paymentMode:   lastPayment.method,
      change:        change,
      total:         _state.baseTotal,
      isLastPayment: _state.sceneData.isLastPayment,
    });
  } else {
    // Partial payment (more seats / amount remaining) → return to
    // check-overview so operator can continue paying. Gold-headered
    // paid seats will show their settled state.
    _returnToParent(_state.sceneData);
  }
}


// ═══════════════════════════════════════════════════
//  SPLIT POPUP
// ═══════════════════════════════════════════════════

function showSplitPopup() {
  const remaining = getRemainingBalance();
  if (remaining <= 0) return;

  SceneManager.interrupt('split-select', {
    remaining: remaining,
    onConfirm: (amount) => {
      _state.denomAccum = 0;
      _state.enteredAmount = amount;
      _state.numpadStr = '';
      if (_state.numpadRef) _state.numpadRef.setHint(`$${amount.toFixed(2)}`, T.gold);
      updateSplitDisplay();
    },
  });
}


// ═══════════════════════════════════════════════════
//  CARD PROCESSING OVERLAY HELPERS
// ═══════════════════════════════════════════════════

function showProcessingOverlay(amount) {
  SceneManager.openTransactional('pc-card-processing', { amount });
  return {
    updateStatus: (msg) => { if (_state && _state._procStatusEl) _state._procStatusEl.textContent = msg; },
    dismiss: () => {
      if (_state && _state._procAnimTimer) clearInterval(_state._procAnimTimer);
      if (_state) {
        _state._procAnimTimer = null;
        _state._procStatusEl = null;
      }
      SceneManager.closeTransactional('pc-card-processing');
    },
  };
}
