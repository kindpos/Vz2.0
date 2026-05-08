// ═══════════════════════════════════════════════════
//  KINDpos Terminal — Server Checkout Scene
//  Three-column layout per locked mockup:
//    LEFT    Receipt Preview (260px, dimmed while blocked)
//    MIDDLE  Card stack — blockers expanded, non-blockers dim-collapsed
//    RIGHT   Actions + blocker queue + FLSA timer (236px)
//  Two blockers: open checks (verm) + unadjusted tips (yellow)
//  Nice. Dependable. Yours.
// ═══════════════════════════════════════════════════

import { T } from '../../common/tokens.js';
import { showToast } from '../components.js';
import { SceneManager, defineScene } from '../scene-manager.js';
import { OrderSummary } from '../order-summary.js';
import {
  buildStaticCard,
  buildNavCard,
  buildActionCard,
  buildPillButton,
  hexToRgba,
  darkenHex,
} from '../theme-manager.js';
import { fmt, detailRow, detailDivider } from './checkout-core.js';
import { fetchWithTimeout } from '../net.js';

// ─────────────────────────────────────────────────
//  LAYOUT CONSTANTS (match mockup exactly)
// ─────────────────────────────────────────────────

const LEFT_W   = 260;   // Left stats column
const PAD      = 14;    // Outer side/bottom padding
const PAD_TOP  = 8;     // reduce top padding per UI audit

// ─────────────────────────────────────────────────
//  TYPOGRAPHY — aligned to KINDpos token scale
//  fsB4=14px (micro labels), fsB3=16px (body), fsB2=20px (emphasis)
// ─────────────────────────────────────────────────

const FS_LABEL   = '13px';   // Uppercase letter-spaced section labels
const FS_META    = '13px';   // Dim meta text (opened 10:30pm, closed 11:22pm)
const FS_BODY    = '15px';   // Standard body text, row labels
const FS_AMOUNT  = '17px';   // Row-level monetary amounts
const FS_HERO    = '26px';   // Hero numbers (Take-Home, Cash Expected)
const FS_PILL    = '13px';   // Pill button labels
const FS_PILL_LG = '15px';   // Larger pill labels (BACK, PRINT, FINALIZE main)
const FS_RECEIPT = '11px';   // Receipt preview paper (intentionally small — it's a slip)

// ─────────────────────────────────────────────────
//  DATA FETCH
// ─────────────────────────────────────────────────

export function fetchServerState(params) {
  const empId = params.employeeId || '';

  // Hard gate — we must have an employee ID. Without one, a bare
  // `?server_id=` query hits the backend's store-wide fallback and returns
  // every server's data. The scene surfaces this as an error state rather
  // than showing someone else's checks. Managers viewing a server always
  // have staff.id populated, so this path is never hit legitimately.
  if (!empId) {
    return Promise.reject(new Error('server-checkout: missing employee id'));
  }

  const summaryUrl = `/api/v1/orders/day-summary?server_id=${encodeURIComponent(empId)}`;
  const ordersUrl  = `/api/v1/orders?server_id=${encodeURIComponent(empId)}`;

  return Promise.all([
    fetchWithTimeout(summaryUrl, {}, 10000).then((r) => r.json()),
    fetchWithTimeout('/api/v1/config/tipout', {}, 10000).then((r) => r.json()).catch(() => []),
    fetchWithTimeout('/api/v1/config/store', {}, 10000).then((r) => r.json()).catch(() => { return {}; }),
    fetchWithTimeout(ordersUrl, {}, 10000).then((r) => r.json()).catch(() => []),
  ]).then((results) => {
    let d = results[0] || {};
    const rules = Array.isArray(results[1]) ? results[1] : [];
    const store = results[2] || {};
    const rawOrders = Array.isArray(results[3]) ? results[3] : [];

    // Defensive client-side scrub — drop any order whose server_id doesn't
    // match ours. Trusts the backend filter as primary but prevents leaks
    // if the backend regresses or returns store-wide results.
    const allOrders = rawOrders.filter((o) => {
      // If the record has no server_id at all, we can't verify — prefer
      // safety and drop it.
      if (!o.server_id) return false;
      return o.server_id === empId;
    });

    const rate = rules.reduce((s, r) => s + (r.percentage || 0), 0) / 100;
    const netSales = Number(d.net_sales) || 0;
    const cashSales = Number(d.cash_total) || 0;
    const cardSales = Number(d.card_sales) || 0;
    const cardTips  = Number(d.card_tips) || 0;
    const tipOutTotal = netSales * rate;
    const takeHome = (cardTips + (Number(d.cash_tips) || 0)) - tipOutTotal;
    const cashExpected = cashSales - cardTips;

    // Build a lookup so check rows can show table label and guest count,
    // which the day-summary omits but the orders endpoint includes.
    const rawById = {};
    allOrders.forEach((o) => { rawById[o.order_id] = o; });

    // Same defensive scrub on the checks summary. day-summary entries
    // don't always carry server_id (depends on backend version), so when
    // absent we trust the URL filter; when present, we verify.
    let allChecks = (d.checks || []).filter((c) => {
      if (c.server_id && c.server_id !== empId) return false;
      return true;
    }).map((c) => {
      const raw = rawById[c.checkId] || {};
      return Object.assign({}, c, {
        tableLabel:  raw.table         || raw.customer_name || c.tableLabel  || '',
        guests:      raw.guest_count   || c.guests          || 0,
        server_name: raw.server_name   || c.server_name     || '',
      });
    });
    const openChecks = allChecks.filter((c) => c.status === 'open');
    const closedCardChecks = allChecks.filter((c) => c.status === 'closed' && c.method === 'card');
    const unadjustedChecks = closedCardChecks.filter((c) => !c.adjusted);
    const adjustedChecks   = closedCardChecks.filter((c) => c.adjusted);

    return {
      employeeId:    params.employeeId || '',
      employeeName:  params.employeeName || '',
      restaurantName: store.name || 'KINDpos/lite',
      terminalId:    store.terminal_id || 'terminal_01',

      // Aggregates
      netSales:      netSales,
      cashSales:     cashSales,
      cardSales:     cardSales,
      cardTips:      cardTips,
      tipOutRate:    rate,
      tipOutTotal:   tipOutTotal,
      takeHome:      takeHome,
      cashExpected:  cashExpected,
      checksClosed:  (d.total_closed || closedCardChecks.length + (allChecks.filter((c) => c.status === 'closed' && c.method === 'cash').length)),

      // Blocker data
      checks:             allChecks,
      openChecks:         openChecks,
      unadjustedChecks:   unadjustedChecks,
      adjustedChecks:     adjustedChecks,

      // Full order records — used to render check preview with items.
      // Indexed by order_id; checks in `openChecks`/etc. have a `checkId`
      // that matches `order_id` in this array.
      allOrders:          allOrders,

      // Raw tipout rules — needed by buildLeftCol for per-role breakdown.
      tipoutRules:        rules,
    };
  });
}

// ─────────────────────────────────────────────────
//  BLOCKER BANNER (top full-width)
//  Shown only when openChecks.length + unadjustedChecks.length > 0.
// ─────────────────────────────────────────────────

function buildBlockerBanner(state, startTime) {
  const blockerCount = state.openChecks.length + state.unadjustedChecks.length;
  if (blockerCount === 0) return null;

  let card = buildStaticCard({ accent: T.verm });
  card.style.flexShrink = '0';
  card.style.display = 'flex';
  card.style.alignItems = 'center';
  card.style.gap = '14px';
  card.style.padding = '10px 18px';

  let icon = document.createElement('div');
  icon.style.cssText = [
    'width:28px;height:28px;border-radius:6px;flex-shrink:0;',
    `background:${hexToRgba(T.verm, 0.18)};`,
    'display:flex;align-items:center;justify-content:center;',
    `font-family:${T.fb};font-size:16px;font-weight:700;color:${T.verm};`,
  ].join('');
  icon.textContent = '!';

  const textCol = document.createElement('div');
  textCol.style.cssText = 'flex:1;display:flex;flex-direction:column;gap:3px;min-width:0;';

  let title = document.createElement('div');
  title.style.cssText = `font-family:${T.fh};font-size:${FS_LABEL};font-weight:700;color:${T.verm};letter-spacing:1.8px;`;
  title.textContent = blockerCount + ` BLOCKER${(blockerCount > 1 ? 'S' : '')} \u2014 RESOLVE TO CHECK OUT`;

  const summary = document.createElement('div');
  summary.style.cssText = `font-family:${T.fb};font-size:${FS_BODY};color:${T.text};;font-weight:${T.fwBold};`;
  const parts = [];
  if (state.openChecks.length > 0) parts.push(state.openChecks.length + ` open check${(state.openChecks.length > 1 ? 's' : '')}`);
  if (state.unadjustedChecks.length > 0) parts.push(state.unadjustedChecks.length + ` unadjusted CC tip${(state.unadjustedChecks.length > 1 ? 's' : '')}`);
  summary.textContent = parts.join(' \u2022 ');

  textCol.appendChild(title);
  textCol.appendChild(summary);

  // FLSA timer — reassurance that they're still on the clock while resolving.
  const timer = document.createElement('div');
  timer.style.cssText = [
    'flex-shrink:0;padding:7px 18px;border-radius:999px;',
    `background:${T.well};`,
    `font-family:${T.fb};font-size:${FS_META};color:${T.lavender};`,
    'letter-spacing:0.5px;',
  ].join('') + `;font-weight:${T.fwBold};`;
  timer.dataset.flsa = '1';
  timer.textContent = 'still on the clock \u2022 0m 00s';
  const startedAt = startTime || Date.now();
  const tick = () => {
    if (!document.body.contains(timer)) return;
    const elapsed = Math.floor((Date.now() - startedAt) / 1000);
    const mins = Math.floor(elapsed / 60);
    const secs = elapsed % 60;
    timer.textContent = `still on the clock \u2022 ${mins}m ${(secs < 10 ? '0' : '')}${secs}s`;
    setTimeout(tick, 1000);
  };
  setTimeout(tick, 1000);

  card.appendChild(icon);
  card.appendChild(textCol);
  card.appendChild(timer);

  return card;
}

// ─────────────────────────────────────────────────
//  CHECK PREVIEW (rendered inside the left column when a row is selected)
//  Matches the information density of manager-landing's check preview.
//  `chk` is the summary row, `fullOrder` is the detailed record from
//  /api/v1/orders with an items array.
// ─────────────────────────────────────────────────

function renderCheckPreview(paper, checks, allOrders) {
  const isMulti = checks.length > 1;
  const grandTotal = checks.reduce((s, c) => s + (Number(c.amount) || 0), 0);

  // Header row — "N CHECKS" + total when multi, else single check label
  const hdrRow = document.createElement('div');
  hdrRow.style.cssText = [
    'display:flex;justify-content:space-between;align-items:baseline;',
    `padding-bottom:8px;border-bottom:1px solid ${hexToRgba(T.text, 0.1)};margin-bottom:4px;`,
  ].join('');
  const hLabel = document.createElement('div');
  hLabel.style.cssText = `font-family:${T.fh};font-size:14px;font-weight:700;color:${T.green};letter-spacing:1.2px;`;
  if (isMulti) {
    hLabel.textContent = checks.length + ' CHECKS';
  } else {
    hLabel.textContent = (checks[0].tableLabel ? checks[0].tableLabel + ' \u2022 ' : '') + (checks[0].checkLabel || checks[0].checkId);
  }
  const hTotal = document.createElement('div');
  hTotal.style.cssText = `font-family:${T.fh};font-size:14px;font-weight:700;color:${T.gold};`;
  hTotal.textContent = fmt(grandTotal);
  hdrRow.appendChild(hLabel);
  hdrRow.appendChild(hTotal);
  paper.appendChild(hdrRow);

  checks.forEach((chk, idx) => {
    const fullOrder = (allOrders || []).find((o) => o.order_id === chk.checkId);

    if (isMulti) {
      // Sub-header per check — check label + server in smaller type
      let sub = document.createElement('div');
      sub.style.cssText = `font-family:${T.fh};font-size:11px;color:${T.green};letter-spacing:0.5px;margin-top:${(idx === 0 ? '0' : '8px')};margin-bottom:2px;;font-weight:${T.fwBold};`;
      sub.textContent = (chk.checkLabel || chk.checkId) + (fullOrder && fullOrder.server_name ? ` \u00B7 ${fullOrder.server_name.split(' ')[0].toUpperCase()}` : '');
      paper.appendChild(sub);
    } else if (fullOrder && fullOrder.server_name) {
      const srvLbl = document.createElement('div');
      srvLbl.style.cssText = `font-family:${T.fb};font-size:11px;color:${T.elec};letter-spacing:0.5px;margin-bottom:4px;;font-weight:${T.fwBold};`;
      srvLbl.textContent = fullOrder.server_name.toUpperCase();
      paper.appendChild(srvLbl);
    }

    // Meta row (only for single — collapsed on multi to save space)
    if (!isMulti) {
      const metaRow = document.createElement('div');
      metaRow.style.cssText = `display:flex;justify-content:space-between;font-family:${T.fb};font-size:11px;color:${hexToRgba(T.text, 0.6)};margin-bottom:4px;;font-weight:${T.fwBold};`;
      const mL = document.createElement('span');
      mL.textContent = chk.guests ? (chk.guests + ` guest${(chk.guests > 1 ? 's' : '')}`) : '\u00A0';
      const mR = document.createElement('span');
      mR.textContent = `opened ${(chk.time || 'recently')}`;
      metaRow.appendChild(mL);
      metaRow.appendChild(mR);
      paper.appendChild(metaRow);
    }

    const items = (fullOrder && fullOrder.items) || [];

    if (items.length === 0) {
      let empty = document.createElement('div');
      empty.style.cssText = `font-family:${T.fb};font-size:11px;color:${hexToRgba(T.text, 0.6)};font-style:italic;padding:6px 0;;font-weight:${T.fwBold};`;
      empty.textContent = isMulti ? 'no items' : 'no items on this check';
      paper.appendChild(empty);
    } else {
      // Cap items per check on multi-select so the paper doesn't get
      // absurdly long — show first 3, then "+N more".
      const showCap = isMulti ? 3 : items.length;
      items.slice(0, showCap).forEach((item) => {
        let row = document.createElement('div');
        row.style.cssText = [
          'display:flex;justify-content:space-between;gap:8px;',
          `padding:3px 0;border-bottom:1px solid ${hexToRgba(T.text, 0.06)};`,
        ].join('');
        const nm = document.createElement('span');
        nm.style.cssText = `font-family:${T.fb};font-size:11px;color:${T.text};;font-weight:${T.fwBold};`;
        nm.textContent = (item.qty && item.qty > 1 ? item.qty + '\u00D7 ' : '') + (item.name || 'Item');
        const pr = document.createElement('span');
        pr.style.cssText = `font-family:${T.fb};font-size:11px;color:${T.gold};flex-shrink:0;;font-weight:${T.fwBold};`;
        pr.textContent = fmt((item.price || 0) * (item.qty || 1));
        row.appendChild(nm);
        row.appendChild(pr);
        paper.appendChild(row);
      });
      if (items.length > showCap) {
        const more = document.createElement('div');
        more.style.cssText = `font-family:${T.fb};font-size:10px;color:${hexToRgba(T.text, 0.6)};padding-top:2px;opacity:0.6;;font-weight:${T.fwBold};`;
        more.textContent = `+ ${(items.length - showCap)} more`;
        paper.appendChild(more);
      }
    }

    // Per-check totals only on single-select view
    if (!isMulti && fullOrder) {
      const sep = document.createElement('div');
      sep.style.cssText = `height:1px;background:${hexToRgba(T.text, 0.1)};margin:6px 0 2px;`;
      paper.appendChild(sep);

      const addTotalRow = (label, val, emphasis) => {
        const r = document.createElement('div');
        r.style.cssText = [
          'display:flex;justify-content:space-between;padding:2px 0;',
          `font-family:${T.fb};font-size:${(emphasis ? '12px' : '11px')};`,
          `color:${(emphasis ? T.text : hexToRgba(T.text, 0.6))};`,
          emphasis ? 'font-weight:700;' : '',
        ].join('');
        const rL = document.createElement('span');
        rL.textContent = label;
        const rR = document.createElement('span');
        rR.style.cssText = emphasis ? `color:${T.gold};font-weight:700;` : `color:${T.gold};`;
        rR.textContent = fmt(val);
        r.appendChild(rL);
        r.appendChild(rR);
        paper.appendChild(r);
      };

      if (fullOrder.subtotal != null) addTotalRow('subtotal', fullOrder.subtotal);
      if (fullOrder.tax != null && fullOrder.tax > 0) addTotalRow('tax', fullOrder.tax);
      addTotalRow('TOTAL', fullOrder.total || chk.amount || 0, true);
    }
  });
}

// ─────────────────────────────────────────────────
//  LEFT COLUMN — STATS + CASH EXPECTED
// ─────────────────────────────────────────────────

function buildLeftCol(state, handlers) {
  const wrapper = document.createElement('div');
  wrapper.style.cssText = [
    'flex-shrink:0;width:260px;align-self:flex-start;',
    'display:flex;flex-direction:column;gap:6px;',
  ].join('');

  let card = document.createElement('div');
  card.style.cssText = [
    `background:${T.card};`,
    `border-left:3px solid ${T.green};`,
    'border-radius:6px;',
    'display:flex;flex-direction:column;',
    'overflow:hidden;',
  ].join('');

  const colBody = document.createElement('div');
  colBody.style.cssText = [
    'flex-shrink:0;padding:16px 14px 10px;',
    'display:flex;flex-direction:column;',
    'overflow-y:auto;',
    'touch-action:pan-y;overscroll-behavior:contain;',
  ].join('');

  // 1. Take Home hero
  const heroWrap = document.createElement('div');
  heroWrap.style.cssText = [
    'background:rgba(0,0,0,0.2);border-radius:6px;',
    'padding:12px 10px;margin:0 -4px;',
    'display:flex;flex-direction:column;gap:2px;',
  ].join('');

  const heroLabel = document.createElement('div');
  heroLabel.style.cssText = [
    `font-family:${T.fh};font-size:10px;font-weight:700;`,
    `letter-spacing:2px;color:${T.moon};text-transform:uppercase;`,
  ].join('');
  heroLabel.textContent = 'TAKE HOME';

  const heroValue = document.createElement('div');
  heroValue.style.cssText = [
    `font-family:${T.fb};font-size:32px;font-weight:700;`,
    `color:${T.greenWarm};line-height:1.1;`,
  ].join('');
  heroValue.textContent = fmt(state.takeHome);

  const heroMeta = document.createElement('div');
  heroMeta.style.cssText = `font-family:${T.fb};font-size:11px;color:${T.moon};;font-weight:${T.fwBold};`;
  heroMeta.textContent = 'tips − tipout';

  heroWrap.appendChild(heroLabel);
  heroWrap.appendChild(heroValue);
  heroWrap.appendChild(heroMeta);
  colBody.appendChild(heroWrap);

  // 2. Divider
  colBody.appendChild(_leftColDivider());

  // 3. Card Tips
  colBody.appendChild(_leftColStat('CARD TIPS', fmt(state.cardTips), T.gold));

  // 4. Divider
  colBody.appendChild(_leftColDivider());

  // 5. Tip-Out
  const toSectionLabel = document.createElement('div');
  toSectionLabel.style.cssText = [
    `font-family:${T.fh};font-size:10px;font-weight:700;`,
    `letter-spacing:2px;color:${T.moon};text-transform:uppercase;`,
  ].join('');
  toSectionLabel.textContent = 'TIP-OUT';
  colBody.appendChild(toSectionLabel);

  const toBlock = document.createElement('div');
  toBlock.style.cssText = [
    `background:${T.well};border-radius:5px;`,
    'padding:8px 10px;',
    'display:flex;flex-direction:column;gap:6px;',
    'margin-top:2px;',
  ].join('');

  const tipoutRules = state.tipoutRules || [];
  const isOverrideMode = state.overrideMode === true;

  // Helper to get effective percentage and amount
  const getEffectivePct = (rule) => {
    if (state.overrides && state.overrides[rule.rule_id]) {
      return state.overrides[rule.rule_id];
    }
    return rule.percentage || 0;
  };
  const getCalculatedAmt = (rule) => ((rule.percentage || 0) / 100) * (state.netSales || 0);
  const getEffectiveAmt = (rule) => (getEffectivePct(rule) / 100) * (state.netSales || 0);

  // Calculate actual total
  let actualTipOutTotal = 0;
  tipoutRules.forEach((r) => {
    actualTipOutTotal += getEffectiveAmt(r);
  });

  if (!isOverrideMode) {
    // Normal 3-column mode: ROLE | BASIS | AMOUNT
    tipoutRules.forEach((r) => {
      const ruleRow = document.createElement('div');
      ruleRow.style.cssText = 'display:grid;grid-template-columns:auto 1fr auto;gap:6px;align-items:baseline;';
      const roleName = document.createElement('div');
      roleName.style.cssText = `font-family:${T.fb};font-size:12px;font-weight:700;color:${T.text};`;
      roleName.textContent = r.role || r.name || 'Role';
      const basis = document.createElement('div');
      basis.style.cssText = `font-family:${T.fb};font-size:10px;color:${T.moon};;font-weight:${T.fwBold};`;
      basis.textContent = (r.percentage || 0) + `% · ${(r.category || r.basis || 'Net Sales')}`;
      const ruleAmt = document.createElement('div');
      ruleAmt.style.cssText = `font-family:${T.fb};font-size:13px;font-weight:700;color:${T.verm};`;
      ruleAmt.textContent = `−${fmt(getEffectiveAmt(r))}`;
      ruleRow.appendChild(roleName);
      ruleRow.appendChild(basis);
      ruleRow.appendChild(ruleAmt);
      toBlock.appendChild(ruleRow);
    });
  } else {
    // Override mode: ROLE | CALC% | ACTUAL% | CALC$ | ACTUAL$
    toBlock.style.display = 'block';
    const headerRow = document.createElement('div');
    headerRow.style.cssText = 'display:grid;grid-template-columns:auto 1fr 1fr 1fr 1fr;gap:4px;align-items:baseline;margin-bottom:6px;font-size:9px;color:' + T.moon + ';font-weight:700;';
    ['ROLE', 'CALC%', 'ACTUAL%', 'CALC$', 'ACTUAL$'].forEach((h) => {
      const hdr = document.createElement('div');
      hdr.textContent = h;
      hdr.style.cssText = 'text-align:right;';
      headerRow.appendChild(hdr);
    });
    toBlock.appendChild(headerRow);

    tipoutRules.forEach((r) => {
      const ruleRow = document.createElement('div');
      const isOverridden = state.overrides && state.overrides[r.rule_id] !== undefined;
      ruleRow.style.cssText = 'display:grid;grid-template-columns:auto 1fr 1fr 1fr 1fr;gap:4px;align-items:center;margin-bottom:4px;padding-left:' + (isOverridden ? '4px;border-left:3px solid ' + T.gold : '4px;border-left:3px solid transparent') + ';';

      // ROLE
      const roleEl = document.createElement('div');
      roleEl.style.cssText = `font-family:${T.fb};font-size:11px;font-weight:700;color:${T.text};`;
      roleEl.textContent = r.role || r.name || 'Role';

      // CALC%
      const calcPctEl = document.createElement('div');
      calcPctEl.style.cssText = `font-family:${T.fb};font-size:11px;color:${T.moon};text-align:right;${isOverridden ? 'text-decoration:line-through;' : ''}`;
      calcPctEl.textContent = ((r.percentage || 0).toFixed(1)) + '%';

      // ACTUAL%
      const actualPctEl = document.createElement('input');
      actualPctEl.type = 'number';
      actualPctEl.min = '0';
      actualPctEl.max = '100';
      actualPctEl.step = '0.1';
      actualPctEl.value = getEffectivePct(r).toFixed(1);
      actualPctEl.style.cssText = `font-family:${T.fb};font-size:11px;width:50px;padding:4px;border:1px solid ${isOverridden ? T.gold : T.border};border-radius:3px;background:${T.well};color:${isOverridden ? T.gold : T.text};text-align:right;pointer-events:auto;touch-action:manipulation;`;
      actualPctEl.addEventListener('change', () => {
        const newPct = parseFloat(actualPctEl.value) || 0;
        if (newPct === (r.percentage || 0)) {
          delete state.overrides[r.rule_id];
        } else {
          state.overrides[r.rule_id] = Math.max(0, Math.min(100, newPct));
        }
        if (handlers && handlers.onOverrideChanged) handlers.onOverrideChanged();
      });

      // CALC$
      const calcAmtEl = document.createElement('div');
      const calcAmt = getCalculatedAmt(r);
      calcAmtEl.style.cssText = `font-family:${T.fb};font-size:11px;color:${T.moon};text-align:right;${isOverridden ? 'text-decoration:line-through;' : ''}`;
      calcAmtEl.textContent = `${fmt(calcAmt)}`;

      // ACTUAL$
      const actualAmtEl = document.createElement('div');
      const actualAmt = getEffectiveAmt(r);
      actualAmtEl.style.cssText = `font-family:${T.fb};font-size:11px;font-weight:700;text-align:right;color:${isOverridden ? T.gold : T.verm};`;
      actualAmtEl.textContent = `${fmt(actualAmt)}`;

      ruleRow.appendChild(roleEl);
      ruleRow.appendChild(calcPctEl);
      ruleRow.appendChild(actualPctEl);
      ruleRow.appendChild(calcAmtEl);
      ruleRow.appendChild(actualAmtEl);
      toBlock.appendChild(ruleRow);
    });
  }

  const toCrule = document.createElement('div');
  toCrule.style.cssText = `height:1px;background:${T.border};opacity:0.5;`;
  toBlock.appendChild(toCrule);

  const toTotRow = document.createElement('div');
  if (isOverrideMode) {
    toTotRow.style.cssText = 'display:grid;grid-template-columns:auto 1fr 1fr 1fr 1fr;gap:4px;align-items:baseline;margin-top:6px;';
  } else {
    toTotRow.style.cssText = 'display:flex;justify-content:space-between;align-items:baseline;';
  }
  const toTotLabel = document.createElement('div');
  toTotLabel.style.cssText = [
    `font-family:${T.fh};font-size:10px;font-weight:700;`,
    `letter-spacing:1.5px;color:${T.moon};text-transform:uppercase;`,
  ].join('');
  toTotLabel.textContent = 'TOTAL';

  if (isOverrideMode) {
    // In override mode, show calc total and actual total
    const emptyA = document.createElement('div');
    const emptyB = document.createElement('div');
    const calcTotEl = document.createElement('div');
    calcTotEl.style.cssText = `font-family:${T.fb};font-size:13px;font-weight:700;color:${T.moon};text-align:right;`;
    calcTotEl.textContent = `${fmt(state.tipOutTotal)}`;
    const actualTotEl = document.createElement('div');
    actualTotEl.style.cssText = `font-family:${T.fb};font-size:13px;font-weight:700;color:${T.verm};text-align:right;`;
    actualTotEl.textContent = `${fmt(actualTipOutTotal)}`;
    toTotRow.appendChild(toTotLabel);
    toTotRow.appendChild(emptyA);
    toTotRow.appendChild(emptyB);
    toTotRow.appendChild(calcTotEl);
    toTotRow.appendChild(actualTotEl);
  } else {
    const toTotValue = document.createElement('div');
    toTotValue.style.cssText = `font-family:${T.fb};font-size:17px;font-weight:700;color:${T.verm};`;
    toTotValue.textContent = `−${fmt(actualTipOutTotal)}`;
    toTotRow.appendChild(toTotLabel);
    toTotRow.appendChild(toTotValue);
  }
  toBlock.appendChild(toTotRow);
  colBody.appendChild(toBlock);

  // Adjust Rates pill
  const adjBtn = document.createElement('div');
  adjBtn.style.cssText = [
    'width:100%;box-sizing:border-box;border-radius:999px;',
    `border:1px solid ${T.border};background:transparent;`,
    'display:flex;align-items:center;justify-content:center;gap:5px;',
    'padding:6px 0;margin-top:7px;cursor:pointer;',
    `font-family:${T.fh};font-size:10px;font-weight:700;`,
    `letter-spacing:1.5px;color:${T.moon};text-transform:uppercase;`,
    'pointer-events:auto;touch-action:manipulation;',
    'transition:border-color 0.15s, color 0.15s;',
  ].join('');

  (() => {
    const ns = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('width', '9');
    svg.setAttribute('height', '10');
    svg.setAttribute('viewBox', '0 0 9 10');
    svg.setAttribute('fill', 'none');
    svg.style.flexShrink = '0';
    const lockRect = document.createElementNS(ns, 'rect');
    lockRect.setAttribute('x', '1');
    lockRect.setAttribute('y', '4');
    lockRect.setAttribute('width', '7');
    lockRect.setAttribute('height', '5.5');
    lockRect.setAttribute('rx', '1');
    lockRect.setAttribute('fill', 'currentColor');
    const lockPath = document.createElementNS(ns, 'path');
    lockPath.setAttribute('d', 'M2.5 4V3a2 2 0 0 1 4 0v1');
    lockPath.setAttribute('stroke', 'currentColor');
    lockPath.setAttribute('stroke-width', '1.2');
    lockPath.setAttribute('fill', 'none');
    svg.appendChild(lockRect);
    svg.appendChild(lockPath);
    adjBtn.appendChild(svg);
  })();

  const adjText = document.createElement('span');
  adjText.textContent = state.overrideMode ? 'ADJUSTING RATES' : 'Adjust Rates';
  adjBtn.appendChild(adjText);

  if (state.overrideMode) {
    adjBtn.style.borderColor = T.gold;
    adjBtn.style.color = T.gold;
  }

  adjBtn.addEventListener('pointerenter', () => {
    if (!state.overrideMode) {
      adjBtn.style.borderColor = T.warning;
      adjBtn.style.color = T.warning;
    }
  });
  adjBtn.addEventListener('pointerleave', () => {
    if (!state.overrideMode) {
      adjBtn.style.borderColor = T.border;
      adjBtn.style.color = T.moon;
    }
  });
  adjBtn.addEventListener('pointerup', function() {
    if (state.overrideMode) return;  // Already in override mode
    SceneManager.interrupt('co-manager-pin', {
      onConfirm: (authData) => {
        state.managerPin = authData.pin || authData.manager_pin || authData.raw_pin;
        state.overrideMode = true;
        state.overrides = {};
        SceneManager.closeInterrupt('co-manager-pin');
        // Rebuild will be triggered by the interrupt close
        // and handlers.onRebuild if we have access
        if (handlers && handlers.onRebuild) {
          handlers.onRebuild();
        }
      },
      onCancel: () => {
        SceneManager.closeInterrupt('co-manager-pin');
      },
    });
  });
  colBody.appendChild(adjBtn);

  // 6. Divider
  colBody.appendChild(_leftColDivider());

  // 7. Checks Closed
  colBody.appendChild(_leftColStat('CHECKS CLOSED', String(state.checksClosed), T.text));

  card.appendChild(colBody);

  // cash-footer
  const cashFooter = document.createElement('div');
  cashFooter.style.cssText = [
    'flex-shrink:0;',
    `border-top:1px solid ${hexToRgba(T.gold, 0.35)};`,
    `background:${hexToRgba(T.gold, 0.06)};`,
    'border-radius:0 0 6px 6px;',
    'padding:12px 14px 14px;',
    'display:flex;flex-direction:column;gap:6px;',
  ].join('');

  const cfLabel = document.createElement('div');
  cfLabel.style.cssText = [
    `font-family:${T.fh};font-size:10px;font-weight:700;`,
    'letter-spacing:2px;text-transform:uppercase;',
    `color:${hexToRgba(T.gold, 0.75)};`,
  ].join('');
  cfLabel.textContent = 'CASH EXPECTED';

  const cfAmount = document.createElement('div');
  cfAmount.style.cssText = [
    `font-family:${T.fb};font-size:28px;font-weight:700;`,
    `color:${T.gold};line-height:1.1;`,
  ].join('');
  cfAmount.textContent = fmt(state.cashExpected);

  const cfMath = document.createElement('div');
  cfMath.style.cssText = [
    'display:flex;flex-direction:row;gap:6px;align-items:baseline;',
    `font-family:${T.fb};font-size:11px;`,
  ].join('') + `;font-weight:${T.fwBold};`;

  [
    { text: fmt(state.cashSales), color: T.text, bold: true },
    { text: 'cash',               color: T.moon },
    { text: '−',             color: T.moon },
    { text: fmt(state.cardTips),  color: T.verm, bold: true },
    { text: 'tips',               color: T.moon },
  ].forEach((seg) => {
    const s = document.createElement('span');
    s.style.color = seg.color;
    if (seg.bold) s.style.fontWeight = '700';
    s.textContent = seg.text;
    cfMath.appendChild(s);
  });

  cashFooter.appendChild(cfLabel);
  cashFooter.appendChild(cfAmount);
  cashFooter.appendChild(cfMath);
  card.appendChild(cashFooter);
  wrapper.appendChild(card);

  // Print pill
  const printPill = document.createElement('div');
  printPill.style.cssText = [
    'width:100%;border-radius:999px;padding:10px 0;',
    `background:${T.elec};box-shadow:0 4px 0 ${T.elecDk};`,
    `font-family:${T.fh};font-size:13px;font-weight:700;`,
    `letter-spacing:2px;color:${T.well};text-transform:uppercase;`,
    'text-align:center;',
    'touch-action:manipulation;pointer-events:auto;cursor:pointer;',
    'user-select:none;-webkit-user-select:none;',
    'transition:filter 0.1s;flex-shrink:0;box-sizing:border-box;',
  ].join('');
  printPill.textContent = 'Print Slip';

  printPill.addEventListener('pointerenter', () => {
    printPill.style.filter = 'brightness(1.08)';
  });
  printPill.addEventListener('pointerdown', () => {
    printPill.style.transform = 'translateY(2px)';
    printPill.style.boxShadow = `0 2px 0 ${T.elecDk}`;
  });
  const _printRelease = () => {
    printPill.style.transform = '';
    printPill.style.boxShadow = `0 4px 0 ${T.elecDk}`;
    printPill.style.filter = '';
  };
  printPill.addEventListener('pointerup', () => {
    _printRelease();
    if (handlers && handlers.onPrintSlip) handlers.onPrintSlip();
  });
  printPill.addEventListener('pointerleave', _printRelease);
  printPill.addEventListener('pointercancel', _printRelease);

  wrapper.appendChild(printPill);
  return wrapper;
}

function _leftColDivider() {
  let d = document.createElement('div');
  d.style.cssText = `height:1px;background:${hexToRgba(T.text, 0.08)};margin:6px 0;flex-shrink:0;`;
  return d;
}

function _leftColStat(label, value, valueColor) {
  let row = document.createElement('div');
  row.style.cssText = 'display:flex;flex-direction:column;gap:2px;';
  const lbl = document.createElement('div');
  lbl.style.cssText = [
    `font-family:${T.fh};font-size:10px;font-weight:700;`,
    `letter-spacing:2px;color:${T.moon};text-transform:uppercase;`,
  ].join('');
  lbl.textContent = label;
  const val = document.createElement('div');
  val.style.cssText = `font-family:${T.fb};font-size:17px;font-weight:700;color:${valueColor};`;
  val.textContent = value;
  row.appendChild(lbl);
  row.appendChild(val);
  return row;
}


// ─────────────────────────────────────────────────
//  CARD STACK HELPERS (middle column)
// ─────────────────────────────────────────────────

// Base card shell — border-left accent + optional stroke border.
function buildBaseCard(opts) {
  opts = opts || {};
  let card = buildStaticCard({ accent: opts.accent || T.green });
  if (opts.stroke) card.style.border = `1.5px solid ${opts.stroke}`;
  card.style.opacity = opts.dimmed ? '0.45' : '1';
  card.style.transition = 'opacity 0.2s';
  card.style.padding = '12px 16px';
  card.style.display = 'flex';
  card.style.flexDirection = 'column';
  card.style.gap = '8px';
  card.style.flexShrink = '0';
  card.style.touchAction = 'pan-y';

  return card;
}

// ── Checks card — Active / All tab switcher ──
function buildChecksCard(state, handlers, activeTab, selectedCheckIds) {
  selectedCheckIds = selectedCheckIds || [];
  if (!activeTab) {
    activeTab = (state.openChecks && state.openChecks.length > 0) ? 'active' : 'all';
  }

  const hasOpen = state.openChecks.length > 0;
  let accentColor = hasOpen ? T.verm : T.elec;
  const allChecks = state.checks || [];

  let card = buildBaseCard({ accent: accentColor });
  card.style.padding = '12px 14px';
  card.style.gap = '10px';

  // Header row
  let hdr = document.createElement('div');
  hdr.style.cssText = 'display:flex;align-items:center;gap:8px;flex-shrink:0;';

  if (hasOpen) {
    let icon = document.createElement('div');
    icon.style.cssText = [
      'width:18px;height:18px;border-radius:4px;flex-shrink:0;',
      `background:${hexToRgba(T.verm, 0.18)};`,
      'display:flex;align-items:center;justify-content:center;',
      `font-family:${T.fb};font-size:14px;font-weight:700;color:${T.verm};`,
    ].join('');
    icon.textContent = '!';
    hdr.appendChild(icon);
  }

  const titleEl = document.createElement('span');
  titleEl.style.cssText = [
    `font-family:${T.fh};font-size:11px;font-weight:700;`,
    'letter-spacing:2px;text-transform:uppercase;',
    `color:${accentColor};`,
  ].join('');
  titleEl.textContent = 'CHECKS';
  hdr.appendChild(titleEl);

  // Tab pills
  const tabBar = document.createElement('div');
  tabBar.style.cssText = 'display:flex;gap:5px;flex-shrink:0;margin-left:auto;';

  let makeTab = (key, label, count, activeColor) => {
    const isActive = (activeTab === key);
    let pill = document.createElement('div');
    pill.style.cssText = [
      'padding:3px 9px;border-radius:999px;',
      `font-family:${T.fh};font-size:10px;font-weight:700;letter-spacing:1px;`,
      'cursor:pointer;user-select:none;-webkit-user-select:none;',
      'pointer-events:auto;touch-action:manipulation;',
      isActive
        ? `background:${activeColor};color:${T.well};`
        : `background:transparent;color:${T.moon};border:1px solid rgba(255,255,255,0.15);`,
    ].join('');
    pill.textContent = label + ` ${count}`;
    pill.addEventListener('pointerup', () => {
      if (handlers.onTabChange) handlers.onTabChange(key);
    });
    return pill;
  };

  tabBar.appendChild(makeTab('active', 'Active', state.openChecks.length, T.elec));
  tabBar.appendChild(makeTab('all', 'All', allChecks.length, T.moon));
  hdr.appendChild(tabBar);
  card.appendChild(hdr);

  // List
  let list = document.createElement('div');
  list.style.cssText = 'display:flex;flex-direction:column;gap:6px;';

  if (activeTab === 'active') {
    state.openChecks.forEach((chk) => {
      let selected = selectedCheckIds.indexOf(chk.checkId) !== -1;
      list.appendChild(_buildActiveCheckRow(chk, handlers, selected));
    });
  } else {
    allChecks.forEach((chk) => {
      if (chk.status === 'closed') {
        list.appendChild(_buildClosedCheckRow(chk, handlers));
      } else {
        const selected = selectedCheckIds.indexOf(chk.checkId) !== -1;
        list.appendChild(_buildActiveCheckRow(chk, handlers, selected));
      }
    });
  }

  card.appendChild(list);
  return card;
}

function _buildActiveCheckRow(chk, handlers, isSelected) {
  let row = document.createElement('div');
  row.style.cssText = [
    'display:flex;gap:10px;align-items:center;',
    'padding:10px 12px;border-radius:6px;',
    isSelected
      ? `border:1.5px solid ${T.elec};background:${hexToRgba(T.elec, 0.07)};`
      : `border:1.5px solid transparent;background:${T.well};`,
    'cursor:pointer;pointer-events:auto;touch-action:pan-y;',
    'user-select:none;-webkit-user-select:none;',
  ].join('');

  let info = document.createElement('div');
  info.style.cssText = 'flex:1;display:flex;flex-direction:column;gap:2px;min-width:0;';

  let top = document.createElement('div');
  top.style.cssText = 'display:flex;gap:6px;align-items:baseline;flex-wrap:wrap;';
  let checkLbl = document.createElement('span');
  checkLbl.style.cssText = `font-family:${T.fb};font-size:13px;font-weight:700;color:${T.text};`;
  checkLbl.textContent = chk.checkLabel || (`Check ${(chk.checkId || '')}`);
  top.appendChild(checkLbl);
  if (chk.tableLabel) {
    let tableLbl = document.createElement('span');
    tableLbl.style.cssText = `font-family:${T.fb};font-size:13px;color:${T.moon};;font-weight:${T.fwBold};`;
    tableLbl.textContent = chk.tableLabel;
    top.appendChild(tableLbl);
  }
  info.appendChild(top);

  let meta = document.createElement('div');
  meta.style.cssText = `font-family:${T.fb};font-size:11px;color:${T.moon};;font-weight:${T.fwBold};`;
  let metaParts = [];
  if (chk.guests) metaParts.push(chk.guests + ` guest${(chk.guests > 1 ? 's' : '')}`);
  if (chk.time) metaParts.push(`opened ${chk.time}`);
  meta.textContent = metaParts.join(' · ');
  info.appendChild(meta);

  let amt = document.createElement('div');
  amt.style.cssText = `font-family:${T.fb};font-size:17px;font-weight:700;color:${T.gold};flex-shrink:0;`;
  amt.textContent = fmt(chk.amount || 0);

  row.appendChild(info);
  row.appendChild(amt);
  row.addEventListener('pointerup', () => {
    if (handlers.onSelectCheck) handlers.onSelectCheck(chk);
  });
  return row;
}

function _buildClosedCheckRow(chk, handlers) {
  const outer = document.createElement('div');
  outer.style.cssText = [
    `background:${T.well};border-radius:6px;`,
    'padding:10px 12px;',
    'display:flex;flex-direction:column;gap:6px;',
  ].join('');

  // Top row
  const topRow = document.createElement('div');
  topRow.style.cssText = 'display:flex;gap:10px;align-items:center;';

  let info = document.createElement('div');
  info.style.cssText = 'flex:1;display:flex;flex-direction:column;gap:2px;min-width:0;';

  const top = document.createElement('div');
  top.style.cssText = 'display:flex;gap:6px;align-items:baseline;flex-wrap:wrap;';
  const checkLbl = document.createElement('span');
  checkLbl.style.cssText = `font-family:${T.fb};font-size:13px;font-weight:700;color:${T.text};`;
  checkLbl.textContent = chk.checkLabel || (`Check ${(chk.checkId || '')}`);
  top.appendChild(checkLbl);
  if (chk.tableLabel) {
    const tableLbl = document.createElement('span');
    tableLbl.style.cssText = `font-family:${T.fb};font-size:13px;color:${T.moon};;font-weight:${T.fwBold};`;
    tableLbl.textContent = chk.tableLabel;
    top.appendChild(tableLbl);
  }
  info.appendChild(top);

  let meta = document.createElement('div');
  meta.style.cssText = `font-family:${T.fb};font-size:11px;color:${T.moon};;font-weight:${T.fwBold};`;
  const metaParts = [];
  if (chk.time) metaParts.push(`closed ${chk.time}`);
  if (chk.tip != null) metaParts.push(`tip ${fmt(chk.tip)}`);
  meta.textContent = metaParts.join(' · ');
  info.appendChild(meta);

  // Payment tag
  const isCard = chk.method !== 'cash';
  const tag = document.createElement('div');
  tag.style.cssText = [
    'flex-shrink:0;font-size:10px;border-radius:3px;padding:1px 5px;',
    `font-family:${T.fb};`,
    isCard
      ? `background:${hexToRgba(T.elec, 0.12)};color:${T.elec};`
      : `background:${hexToRgba(T.greenWarm, 0.12)};color:${T.greenWarm};`,
  ].join('') + `;font-weight:${T.fwBold};`;
  tag.textContent = isCard
    ? (chk.cardBrand || 'Card') + (chk.cardLast4 ? ` ··· ${chk.cardLast4}` : '')
    : 'Cash';

  const amt = document.createElement('div');
  amt.style.cssText = `font-family:${T.fb};font-size:17px;font-weight:700;color:${T.gold};flex-shrink:0;`;
  amt.textContent = fmt(chk.amount || 0);

  topRow.appendChild(info);
  topRow.appendChild(tag);
  topRow.appendChild(amt);
  outer.appendChild(topRow);

  // Actions row
  const actRow = document.createElement('div');
  actRow.style.cssText = 'display:flex;gap:6px;';

  const reprBtn = document.createElement('div');
  reprBtn.style.cssText = [
    `background:${hexToRgba(T.greenWarm, 0.15)};`,
    `color:${T.greenWarm};`,
    `border:1px solid ${hexToRgba(T.greenWarm, 0.3)};`,
    `font-family:${T.fh};font-size:10px;font-weight:700;letter-spacing:1px;`,
    'border-radius:999px;padding:4px 12px;',
    'cursor:pointer;pointer-events:auto;touch-action:manipulation;',
    'user-select:none;-webkit-user-select:none;',
  ].join('');
  reprBtn.textContent = 'Reprint';
  reprBtn.addEventListener('pointerup', () => {
    if (handlers.onReprintCheck) handlers.onReprintCheck(chk);
  });

  const reopBtn = document.createElement('div');
  reopBtn.style.cssText = [
    `background:${hexToRgba(T.verm, 0.12)};`,
    `color:${T.verm};`,
    `border:1px solid ${hexToRgba(T.verm, 0.3)};`,
    `font-family:${T.fh};font-size:10px;font-weight:700;letter-spacing:1px;`,
    'border-radius:999px;padding:4px 12px;',
    'cursor:pointer;pointer-events:auto;touch-action:manipulation;',
    'user-select:none;-webkit-user-select:none;',
  ].join('');
  reopBtn.textContent = 'Reopen';
  reopBtn.addEventListener('pointerup', () => {
    if (handlers.onReopenCheck) handlers.onReopenCheck(chk);
  });

  actRow.appendChild(reprBtn);
  actRow.appendChild(reopBtn);
  outer.appendChild(actRow);

  return outer;
}

// ── Tips card — filterable between Unadjusted (blocker) and Adjusted (review)
// Shown whenever there are ANY closed-card checks. When there are unadjusted
// tips, this is the yellow blocker. When all tips are adjusted, it becomes a
// gold review card so the server can fix typos by tapping EDIT on any row.
function buildTipsCard(state, handlers, tipFilter) {
  const hasCards = state.unadjustedChecks.length > 0 || state.adjustedChecks.length > 0;
  const hasUnadj = state.unadjustedChecks.length > 0;
  const accentColor = !hasCards ? T.border : (hasUnadj ? T.warning : T.gold);

  const card = buildBaseCard({ accent: accentColor, stroke: accentColor });
  card.dataset.cardKey = 'unadjusted-tips';

  // Header row — icon + title + filter tabs on the right
  const hdr = document.createElement('div');
  hdr.style.cssText = 'display:flex;align-items:center;gap:10px;flex-shrink:0;flex-wrap:wrap;';

  const icon = document.createElement('div');
  icon.style.cssText = [
    'width:18px;height:18px;border-radius:4px;flex-shrink:0;',
    `background:${hexToRgba(accentColor, 0.18)};`,
    'display:flex;align-items:center;justify-content:center;',
    `font-family:${T.fb};font-size:14px;font-weight:700;color:${accentColor};`,
  ].join('');
  icon.textContent = (!hasCards || !hasUnadj) ? '\u2713' : '!';

  const title = document.createElement('span');
  title.style.cssText = `flex:1;font-family:${T.fh};font-size:13px;font-weight:700;color:${accentColor};letter-spacing:1.8px;`;
  title.textContent = !hasCards
    ? 'CC TIPS'
    : (hasUnadj ? `UNADJUSTED TIPS \u2022 ${state.unadjustedChecks.length}` : 'TIPS \u2022 ALL ADJUSTED');

  hdr.appendChild(icon);
  hdr.appendChild(title);

  if (hasCards) {
    hdr.appendChild(buildTipFilterTabs(tipFilter, state.unadjustedChecks.length, state.adjustedChecks.length, handlers));
  }

  card.appendChild(hdr);

  // Row list — content depends on current filter
  const list = document.createElement('div');
  list.style.cssText = 'display:flex;flex-direction:column;gap:8px;';

  if (!hasCards) {
    const emptyAll = document.createElement('div');
    emptyAll.style.cssText = `font-family:${T.fb};font-size:12px;color:${T.text};opacity:0.4;text-align:center;padding:10px 0;font-style:italic;;font-weight:${T.fwBold};`;
    emptyAll.textContent = 'no card checks today';
    list.appendChild(emptyAll);
  } else {
    const showing = (tipFilter === 'adjusted') ? state.adjustedChecks : state.unadjustedChecks;
    const mode = (tipFilter === 'adjusted') ? 'adjusted' : 'unadjusted';
    showing.forEach((chk) => {
      list.appendChild(buildTipRow(chk, mode, handlers));
    });
    if (!showing.length) {
      const empty = document.createElement('div');
      empty.style.cssText = `font-family:${T.fb};font-size:12px;color:${T.text};opacity:0.45;text-align:center;padding:10px 0;font-style:italic;;font-weight:${T.fwBold};`;
      empty.textContent = tipFilter === 'adjusted' ? 'no adjusted tips yet' : 'all tips adjusted \u2014 ready to finalize';
      list.appendChild(empty);
    }
  }

  card.appendChild(list);
  return card;
}

// Filter tab switcher — two pills, active one is filled, inactive is outlined.
function buildTipFilterTabs(activeFilter, unadjCount, adjCount, handlers) {
  let wrap = document.createElement('div');
  wrap.style.cssText = 'display:flex;gap:6px;flex-shrink:0;';

  const makeTab = (key, label, count, activeColor) => {
    const active = activeFilter === key || (activeFilter == null && key === 'unadjusted' && unadjCount > 0);
    const pill = document.createElement('div');
    pill.style.cssText = [
      'padding:4px 10px;border-radius:999px;',
      `font-family:${T.fh};font-size:11px;font-weight:700;letter-spacing:1px;`,
      'cursor:pointer;user-select:none;-webkit-user-select:none;',
      'pointer-events:auto;touch-action:manipulation;',
      active
        ? `background:${activeColor};color:${T.well};`
        : `background:transparent;color:${hexToRgba(T.text, 0.6)};border:1px solid ${hexToRgba(T.text, 0.2)};`,
    ].join('');
    pill.textContent = label + ` ${count}`;
    pill.addEventListener('pointerup', () => {
      if (handlers.onTipFilterChange) handlers.onTipFilterChange(key);
    });
    return pill;
  };

  wrap.appendChild(makeTab('unadjusted', 'UNADJ', unadjCount, T.warning));
  wrap.appendChild(makeTab('adjusted',   'ADJ',   adjCount,   T.gold));
  return wrap;
}

// Row for a single check — renders different action button based on mode.
function buildTipRow(chk, mode, handlers) {
  const row = document.createElement('div');
  row.style.cssText = [
    'display:flex;gap:10px;align-items:center;',
    `padding:8px 12px;background:${T.well};border-radius:8px;user-select:none;-webkit-user-select:none;touch-action:pan-y;`,
  ].join('');

  const info = document.createElement('div');
  info.style.cssText = 'flex:1;display:flex;flex-direction:column;gap:2px;min-width:0;';
  let label = document.createElement('div');
  label.style.cssText = `font-family:${T.fb};font-size:14px;font-weight:700;color:${T.text};`;
  label.textContent = (chk.tableLabel ? chk.tableLabel + ' \u2022 ' : '') + `Check ${(chk.checkLabel || chk.checkId)}`;
  const meta = document.createElement('div');
  meta.style.cssText = `font-family:${T.fb};font-size:13px;color:${hexToRgba(T.text, 0.6)};;font-weight:${T.fwBold};`;
  meta.textContent = `closed ${(chk.time || '')}${(chk.cardBrand ? ' \u2022 ' + chk.cardBrand : '')}`;
  info.appendChild(label);
  info.appendChild(meta);

  const amtCol = document.createElement('div');
  amtCol.style.cssText = 'flex-shrink:0;display:flex;flex-direction:column;align-items:flex-end;gap:2px;';
  const sub = document.createElement('div');
  sub.style.cssText = `font-family:${T.fb};font-size:14px;color:${hexToRgba(T.text, 0.6)};;font-weight:${T.fwBold};`;
  sub.innerHTML = `<span style="color:${hexToRgba(T.text, 0.6)};margin-right:8px;">subtotal</span><span style="font-weight:700;color:${T.gold};">${fmt(chk.amount || 0)}</span>`;
  const tip = document.createElement('div');

  if (mode === 'adjusted') {
    // Show the actual tip amount already entered
    tip.style.cssText = `font-family:${T.fb};font-size:14px;color:${T.green};;font-weight:${T.fwBold};`;
    tip.innerHTML = `<span style="color:${hexToRgba(T.text, 0.6)};margin-right:8px;">tip</span><span style="font-weight:700;color:${T.green};">${fmt(chk.tip || 0)}</span>`;
  } else {
    tip.style.cssText = `font-family:${T.fb};font-size:14px;color:${T.warning};;font-weight:${T.fwBold};`;
    tip.innerHTML = `<span style="color:${T.warning};margin-right:8px;">tip</span><span style="font-weight:700;">\u2014 pending</span>`;
  }

  amtCol.appendChild(sub);
  amtCol.appendChild(tip);

  let actionBtn;
  if (mode === 'adjusted') {
    actionBtn = buildRowPill({
      label: 'EDIT',
      variant: 'outline',
      width: 76,
      onClick: () => { if (handlers.onEditTip) handlers.onEditTip(chk); },
    });
  } else {
    actionBtn = buildRowPill({
      label: 'ADJUST',
      variant: 'yellow',
      width: 76,
      onClick: () => { if (handlers.onAdjustTip) handlers.onAdjustTip(chk); },
    });
  }

  row.appendChild(info);
  row.appendChild(amtCol);
  row.appendChild(actionBtn);
  return row;
}

// ── Compact pill button for row actions (32px tall) ──
function buildRowPill(opts) {
  const variant = opts.variant || 'elec';
  let bg, fg, stroke = null;
  if (variant === 'elec')     { bg = T.elec;   fg = T.well; }
  else if (variant === 'yellow')  { bg = T.warning; fg = T.well; }
  else if (variant === 'verm')    { bg = T.verm;   fg = T.text; }
  else if (variant === 'outline') { bg = T.bg;     fg = T.text; stroke = hexToRgba(T.text, 0.2); }
  else                            { bg = T.elec;   fg = T.well; }

  const wrap = document.createElement('div');
  wrap.style.cssText = [
    'flex-shrink:0;display:flex;align-items:center;justify-content:center;',
    `height:32px;width:${(opts.width || 120)}px;`,
    `background:${bg};`,
    stroke ? `border:1px solid ${stroke};` : '',
    'border-radius:999px;',
    'cursor:pointer;user-select:none;-webkit-user-select:none;',
    'pointer-events:auto;touch-action:manipulation;',
    `font-family:${T.fh};font-size:14px;font-weight:700;letter-spacing:1.2px;color:${fg};`,
    'box-shadow:0 2px 0 rgba(0,0,0,0.25);',
  ].join('');
  wrap.textContent = opts.label;
  wrap.addEventListener('pointerup', () => {
    if (opts.onClick) opts.onClick();
  });
  return wrap;
}

// ─────────────────────────────────────────────────
//  MIDDLE COLUMN — card stack
// ─────────────────────────────────────────────────

function buildMiddleCol(state, handlers, tipFilter, selectedCheckIds, activeTab) {
  selectedCheckIds = selectedCheckIds || [];
  const col = document.createElement('div');
  col.style.cssText = 'flex:1;display:flex;flex-direction:column;min-width:0;min-height:0;';

  const blocked = (state.openChecks.length + state.unadjustedChecks.length) > 0;

  // Card stack — scrollable
  const cardStack = document.createElement('div');
  cardStack.style.cssText = [
    'flex:1;overflow-y:auto;overflow-x:hidden;',
    'display:flex;flex-direction:column;gap:8px;padding-bottom:4px;',
    'touch-action:pan-y;',
    '-webkit-overflow-scrolling:touch;',
    'overscroll-behavior:contain;',
  ].join('');

  cardStack.appendChild(buildChecksCard(state, handlers, activeTab, selectedCheckIds));

  cardStack.appendChild(buildTipsCard(state, handlers, tipFilter));

  col.appendChild(cardStack);

  // Pinned finalize footer — right-aligned auto-width pill
  const footer = document.createElement('div');
  footer.style.cssText = 'flex-shrink:0;padding-top:8px;display:flex;flex-direction:column;gap:4px;align-items:flex-end;';

  const finBtn = document.createElement('div');
  if (blocked) {
    finBtn.style.cssText = [
      'padding:10px 18px;border-radius:8px;white-space:nowrap;',
      `background:${T.card};border:1.5px solid ${T.border};`,
      'opacity:0.55;cursor:not-allowed;',
      `font-family:${T.fh};font-size:${FS_PILL_LG};font-weight:700;`,
      `color:${T.text};letter-spacing:1.2px;`,
    ].join('');
  } else {
    finBtn.style.cssText = [
      'padding:10px 18px;border-radius:8px;white-space:nowrap;cursor:pointer;',
      `background:${T.greenWarm};`,
      `box-shadow:0 3px 0 ${T.greenWarmDk};`,
      `font-family:${T.fh};font-size:${FS_PILL_LG};font-weight:700;`,
      'color:#1a1a1a;letter-spacing:1.2px;',
    ].join('');
    finBtn.addEventListener('click', () => {
      if (handlers.onFinalize) handlers.onFinalize();
    });
  }
  finBtn.textContent = 'FINALIZE CHECKOUT';
  footer.appendChild(finBtn);

  if (blocked) {
    const reason = document.createElement('div');
    const openN  = state.openChecks.length;
    const unadjN = state.unadjustedChecks.length;
    const reasonMsg = openN > 0
      ? openN + ` open check${(openN === 1 ? '' : 's')} must be closed`
      : unadjN + ` tip${(unadjN === 1 ? '' : 's')} need adjustment`;
    reason.style.cssText = [
      `font-family:${T.fh};font-size:10px;font-weight:700;`,
      `color:${T.verm};text-align:right;letter-spacing:0.6px;`,
    ].join('');
    reason.textContent = reasonMsg;
    footer.appendChild(reason);
  }

  col.appendChild(footer);
  return col;
}


// ═══════════════════════════════════════════════════
//  SCENE
// ═══════════════════════════════════════════════════

defineScene({
  name: 'server-checkout',
  state: {
    data: null,
    fromManager: false,
    startTime: null,
    tipFilter: null, // 'unadjusted' | 'adjusted' — resolved per-render based on data
    selectedCheckIds: [], // array of check IDs pinned to the preview panel
    activeTab: 'active',
    _refreshing: false,
    el: null,
  },
  render: (container, params, state) => {
    state.el = container;
    // ── Param normalization — accepts legacy { employeeId, employeeName }
    //    and new { staff, fromManager } shape from manager-landing.
    //    staff object may carry either `.id` or `.employee_id` depending
    //    on which flow populated it (login currently sets employee_id);
    //    check both. Matches manager-landing's defensive read at line 659.
    params = params || {};
    const employeeId   = params.employeeId
                       || (params.staff && (params.staff.id || params.staff.employee_id))
                       || null;
    const employeeName = params.employeeName
                       || (params.staff && params.staff.name)
                       || '';
    state.fromManager = !!params.fromManager;
    state.startTime   = state.startTime || Date.now();
    state.overrideMode = state.overrideMode ?? false;
    state.overrides = state.overrides ?? {};
    state.managerPin = state.managerPin ?? null;

    params = Object.assign({}, params, {
      employeeId:   employeeId,
      employeeName: employeeName,
    });

    // Hide OrderSummary — this scene owns its own left column now.
    OrderSummary.hide();

    if (window._header && window._header.setBackHandler) {
      window._header.setBackHandler(() => {
        let target = state.fromManager ? 'manager-landing' : 'server-landing';
        SceneManager.mountWorking(target, { staff: params.staff });
      });
    }

    container.style.cssText = [
      'width:100%;height:100%;',
      `display:flex;flex-direction:column;gap:${T.colGapSm}px;`,
      `padding:${PAD_TOP}px ${PAD}px ${PAD}px ${PAD}px;`,
      'box-sizing:border-box;overflow:hidden;',
      `background:${T.bg};`,
    ].join('');

    function refresh() {
      if (state._refreshing || !state.el) return;
      state._refreshing = true;

      fetchServerState(params).then((newData) => {
        state._refreshing = false;
        if (!state.el) return;
        state.data = newData;
        rebuild();
      }).catch((err) => {
        state._refreshing = false;
        if (!state.el) return;

        // Most likely: missing employee id (backend auth didn't populate
        // state.emp.id at login). Surface clearly so the server doesn't
        // see someone else's checks by accident.
        container.innerHTML = '';
        const errPanel = document.createElement('div');
        errPanel.style.cssText = [
          'flex:1;display:flex;align-items:center;justify-content:center;',
          'padding:40px;text-align:center;',
        ].join('');
        const errCard = document.createElement('div');
        errCard.style.cssText = [
          `background:${T.card};border:2px solid ${T.verm};`,
          'border-radius:12px;padding:28px 36px;max-width:420px;',
          'display:flex;flex-direction:column;gap:10px;align-items:center;',
        ].join('');
        const t = document.createElement('div');
        t.style.cssText = `font-family:${T.fh};font-size:14px;font-weight:700;color:${T.verm};letter-spacing:2px;`;
        t.textContent = 'CHECKOUT UNAVAILABLE';
        const m = document.createElement('div');
        m.style.cssText = `font-family:${T.fb};font-size:13px;color:${T.text};line-height:1.5;;font-weight:${T.fwBold};`;
        m.textContent = 'Your session is missing an employee ID. Log out and log back in to refresh it.';
        const d = document.createElement('div');
        d.style.cssText = `font-family:${T.fb};font-size:11px;color:${hexToRgba(T.text, 0.6)};font-style:italic;margin-top:6px;;font-weight:${T.fwBold};`;
        d.textContent = (err && err.message) || '';
        errCard.appendChild(t);
        errCard.appendChild(m);
        errCard.appendChild(d);
        errPanel.appendChild(errCard);
        container.appendChild(errPanel);
      });
    }

    function rebuild() {
      if (!state.data) return;
      container.innerHTML = '';

      // Optional blocker banner across the top
      const banner = buildBlockerBanner(state.data, state.startTime);
      if (banner) container.appendChild(banner);

      // 3-column row
      const body = document.createElement('div');
      body.style.cssText = `flex:1;display:flex;gap:${T.colGapSm}px;min-height:0;overflow:hidden;`;

      const handlers = {
        onBack: () => {
          OrderSummary.hide();
          let target = state.fromManager ? 'manager-landing' : 'server-landing';
          SceneManager.mountWorking(target, { staff: params.staff });
        },
        onPrint: () => {
          if (state._printing) return;
          state._printing = true;
          // Print the server's shift summary slip (the "server checkout"
          // template — not a per-check receipt). Backend template per
          // memory: server_checkout.py is still pending, so expect 404
          // until it's added. The frontend call is correct — just swap
          // the template name if the endpoint needs adjustment.
          showToast('Printing slip\u2026', { bg: T.lavender });
          fetchWithTimeout('/api/v1/server/shift/print-checkout', {
            method:  'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              employee_id:   state.data.employeeId,
              employee_name: state.data.employeeName,
            }),
          }, 8000).then((r) => {
            state._printing = false;
            if (r.ok) {
              showToast('Slip printed', { bg: T.greenWarm });
            } else if (r.status === 404) {
              showToast('Print endpoint pending \u2014 server_checkout.py template needed', { bg: T.warning });
            } else {
              showToast(`Print failed (${r.status}) \u2014 check printer`, { bg: T.verm });
            }
          }).catch(() => {
            state._printing = false;
            showToast('Print failed \u2014 check printer connection', { bg: T.verm });
          });
        },
        onFinalize: () => {
          // Full finalize flow: manager PIN → confirm totals → POST → return
          // to server-landing. On any backend error, stay on scene and surface
          // an actionable message — never give false success to the server.
          SceneManager.interrupt('co-manager-pin', {
            onConfirm: (authData) => {
              SceneManager.closeInterrupt('co-manager-pin');
              // Brief defer so the PIN interrupt unmounts before the next one
              // mounts — avoids visual overlap of the two panels.
              setTimeout(() => {
                SceneManager.interrupt('co-finalize-confirm', {
                  takeHome:     state.data.takeHome,
                  cashExpected: state.data.cashExpected,
                  employeeName: state.data.employeeName,
                  onConfirm: async () => {
                    if (state._finalizing) return;
                    state._finalizing = true;
                    SceneManager.closeInterrupt('co-finalize-confirm');
                    // POST the finalize. Endpoint is stubbed — swap URL when
                    // backend lands. `/server/shift/finalize-checkout` matches
                    // the existing shift endpoint naming convention.
                    const payload = {
                      employee_id:          state.data.employeeId,
                      take_home:            state.data.takeHome,
                      cash_expected:        state.data.cashExpected,
                      manager_pin_verified: true,
                    };
                    if (state.overrideMode && Object.keys(state.overrides).length > 0) {
                      payload.overrides = Object.entries(state.overrides).map(
                        ([rule_id, pct]) => ({ rule_id, override_percentage: pct })
                      );
                      payload.manager_pin = state.managerPin;
                    }
                    try {
                      const r = await fetchWithTimeout('/api/v1/server/shift/finalize-checkout', {
                        method:  'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(payload),
                      });
                      if (r.ok) {
                        showToast('Checkout finalized', { bg: T.green });
                        OrderSummary.hide();
                        SceneManager.mountWorking('server-landing', {
                          staff: {
                            id:   state.data.employeeId,
                            name: state.data.employeeName,
                          },
                        });
                      } else if (r.status === 404) {
                        // Endpoint not yet implemented on the backend.
                        state._finalizing = false;
                        showToast('Finalize endpoint pending — backend work needed', { bg: T.warning });
                      } else {
                        state._finalizing = false;
                        showToast(`Finalize failed (${r.status}) — try again`, { bg: T.verm });
                      }
                    } catch {
                      state._finalizing = false;
                      showToast('Finalize unavailable — ask your manager', { bg: T.verm });
                    }
                  },
                  onCancel: () => {
                    SceneManager.closeInterrupt('co-finalize-confirm');
                  },
                });
              }, 80);
            },
            onCancel: () => {
              SceneManager.closeInterrupt('co-manager-pin');
            },
          });
        },
        onAdjustTip: (chk) => {
          // Opens the single-check tip-adjust transactional from checkout-core.
          // On success, that scene calls onDone → we refresh → the card rebuilds
          // without this row (and collapses when the last unadjusted is cleared).
          SceneManager.openTransactional('co-adjust-single', {
            check: chk,
            onDone: () => { refresh(); },
          });
        },
        onEditTip: (chk) => {
          // Reopens the same single-adjust scene but with the existing tip
          // pre-filled so the server can fix a typo. The scene reads chk.tip
          // as the initial value when present.
          SceneManager.openTransactional('co-adjust-single', {
            check: chk,
            initialTip: chk.tip,
            mode: 'edit',
            onDone: () => { refresh(); },
          });
        },
        onTipFilterChange: (filter) => {
          // User tapped the UNADJ/ADJ filter tab — update state and rebuild.
          state.tipFilter = filter;
          rebuild();
        },
        onTransferChecks: (checks) => {
          // Open the server-picker interrupt. On confirm, POST transfer for
          // each selected check. All-or-nothing is not guaranteed — if a
          // mid-batch transfer fails, we surface the specific failure and
          // leave the successful ones in place.
          SceneManager.interrupt('co-transfer-picker', {
            checks: checks,
            currentEmpId: state.data.employeeId,
            onConfirm: (destServer) => {
              SceneManager.closeInterrupt('co-transfer-picker');

              const transfers = checks.map((chk) => {
                return fetchWithTimeout(`/api/v1/orders/${(chk.checkId || chk.check_id)}/transfer`, {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({
                    to_server_id: destServer.id,
                    from_server_id: state.data.employeeId,
                  }),
                }, 10000).then((r) => {
                  return { chk, ok: r.ok, status: r.status };
                }).catch(() => {
                  return { chk, ok: false, status: 0 };
                });
              });

              Promise.all(transfers).then((results) => {
                let ok = results.filter((r) => r.ok);
                let failed = results.filter((r) => !r.ok);

                if (ok.length > 0 && failed.length === 0) {
                  showToast(
                    `Transferred ${ok.length}${(ok.length === 1 ? ' check' : ' checks')} to ${destServer.name}`,
                    { bg: T.elec }
                  );
                } else if (ok.length > 0 && failed.length > 0) {
                  showToast(
                    ok.length + ` transferred, ${failed.length} failed`,
                    { bg: T.warning }
                  );
                } else {
                  // All failed — likely the endpoint doesn't exist yet.
                  let code = failed[0] && failed[0].status;
                  showToast(
                    code === 404
                      ? 'Transfer endpoint pending \u2014 backend work needed'
                      : 'Transfer failed \u2014 try again',
                    { bg: T.verm }
                  );
                }

                // Clear selection and refetch either way so the UI reflects
                // whatever succeeded.
                state.selectedCheckIds = [];
                refresh();
              });
            },
            onCancel: () => {
              SceneManager.closeInterrupt('co-transfer-picker');
            },
          });
        },
        onCloseCheck: (checks) => {
          // When exactly one check selected, jump into check-overview for that
          // specific check so the server can finish the payment flow. When
          // multiple are selected, we don't have a combined-payment scene yet,
          // so surface a Phase D toast rather than silently picking the first.
          if (checks.length === 1) {
            const chk = checks[0];
            SceneManager.mountWorking('check-overview', {
              checkId:       chk.checkId    || chk.check_id,
              checkLabel:    chk.checkLabel || chk.check_label,
              employeeId:    state.data.employeeId,
              employeeName:  state.data.employeeName,
              returnLanding: state.fromManager ? 'manager-landing' : 'server-landing',
            });
          } else {
            showToast(`Combined payment for ${checks.length} checks — Phase D`, { bg: T.gold });
          }
        },
        onPrintCheck: (checks) => {
          // Print is a routine action — no manager gate. Fires one request
          // per selected check. Backend endpoint TBD; 404 handled gracefully.
          const label = checks.length > 1 ? checks.length + ' checks' : (checks[0].checkLabel || checks[0].checkId);
          showToast(`Printing ${label}\u2026`, { bg: T.greenWarm });

          const prints = checks.map((chk) => {
            return fetchWithTimeout(`/api/v1/checks/${(chk.checkId || chk.check_id)}/print`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ kind: 'guest' }),
            }, 10000).then((r) => {
              return { chk, ok: r.ok, status: r.status };
            }).catch(() => {
              return { chk, ok: false, status: 0 };
            });
          });

          Promise.all(prints).then((results) => {
            const ok = results.filter((r) => r.ok);
            const failed = results.filter((r) => !r.ok);

            if (ok.length > 0 && failed.length === 0) {
              showToast(`Printed ${ok.length}${(ok.length === 1 ? ' check' : ' checks')}`, { bg: T.greenWarm });
            } else if (ok.length > 0 && failed.length > 0) {
              showToast(ok.length + ` printed, ${failed.length} failed`, { bg: T.warning });
            } else {
              const code = failed[0] && failed[0].status;
              showToast(
                code === 404
                  ? 'Print endpoint pending \u2014 backend work needed'
                  : 'Print failed \u2014 check printer',
                { bg: T.verm }
              );
            }
          });
        },
        onDiscountCheck: (checks) => {
          SceneManager.interrupt('co-manager-action', {
            action: 'discount',
            checks: checks,
            onConfirm: (result) => {
              SceneManager.closeInterrupt('co-manager-action');

              const discount = result.discount;
              const discLabel = discount.type === 'comp'
                ? 'Comp'
                : discount.type === 'percent'
                  ? discount.value + '% off'
                  : `$${discount.value} off`;

              let okCount = result.results.filter((r) => r.ok).length;
              let failCount = result.results.length - okCount;

              if (okCount > 0 && failCount === 0) {
                showToast(discLabel + ` applied to ${okCount}${(okCount === 1 ? ' check' : ' checks')}`, { bg: T.elec });
              } else if (okCount > 0 && failCount > 0) {
                showToast(okCount + ` discounted, ${failCount} failed`, { bg: T.warning });
              } else {
                showToast('Discount failed — try again', { bg: T.verm });
              }

              state.selectedCheckIds = [];
              refresh();
            },
            onCancel: () => {
              SceneManager.closeInterrupt('co-manager-action');
            },
          });
        },
                onVoidCheck: (checks) => {
          SceneManager.interrupt('co-manager-action', {
            action: 'void',
            checks: checks,
            onConfirm: (result) => {
              SceneManager.closeInterrupt('co-manager-action');

              const okCount = result.results.filter((r) => r.ok).length;
              const failCount = result.results.length - okCount;

              if (okCount > 0 && failCount === 0) {
                showToast(`Voided ${okCount}${(okCount === 1 ? ' check' : ' checks')}`, { bg: T.verm });
              } else if (okCount > 0 && failCount > 0) {
                showToast(okCount + ` voided, ${failCount} failed`, { bg: T.warning });
              } else {
                showToast('Void failed — try again', { bg: T.verm });
              }

              state.selectedCheckIds = [];
              refresh();
            },
            onCancel: () => {
              SceneManager.closeInterrupt('co-manager-action');
            },
          });
        },
                onJumpToCard: (cardKey) => {
          // Smooth-scroll middle column to the target blocker card and flash
          // a brief highlight. Cards are tagged with data-card-key.
          const target = container.querySelector(`[data-card-key="${cardKey}"]`);
          if (!target) return;
          target.scrollIntoView({ behavior: 'smooth', block: 'start' });
          // Flash effect — quick outline pulse.
          const originalShadow = target.style.boxShadow;
          target.style.transition = 'box-shadow 0.3s ease';
          target.style.boxShadow = `0 0 0 3px ${hexToRgba(T.text, 0.35)}`;
          setTimeout(() => {
            target.style.boxShadow = originalShadow || '';
          }, 600);
        },
        onSelectCheck: (chk) => {
          // Toggle this check's id in the selection array. Tap to add, tap
          // again to remove. No cap on how many can be selected.
          const id = chk.checkId || chk.check_id;
          const idx = state.selectedCheckIds.indexOf(id);
          if (idx !== -1) {
            state.selectedCheckIds.splice(idx, 1);
          } else {
            state.selectedCheckIds.push(id);
          }
          rebuild();
        },
        onDismissPreview: () => {
          state.selectedCheckIds = [];
          rebuild();
        },
        onPrintSlip: () => {
          if (handlers.onPrint) handlers.onPrint();
        },
        onRebuild: () => {
          rebuild();
        },
        onOverrideChanged: () => {
          rebuild();
        },
        onTabChange: (tab) => {
          state.activeTab = tab;
          rebuild();
        },
        onReprintCheck: (chk) => {
          showToast(`Reprinting ${(chk.checkLabel || chk.checkId)}…`, { bg: T.elec });
        },
        onReopenCheck: (chk) => {
          SceneManager.interrupt('co-manager-pin', {
            onConfirm: () => {
              SceneManager.closeInterrupt('co-manager-pin');
              showToast(`Reopening ${(chk.checkLabel || chk.checkId)} — backend pending`, { bg: T.warning });
              refresh();
            },
            onCancel: () => {
              SceneManager.closeInterrupt('co-manager-pin');
            },
          });
        },
      };

      // Resolve the active tip filter. Defaults to 'unadjusted' when there
      // are unadjusted tips (blocker case), 'adjusted' when all done. Scene
      // state overrides the default once the user explicitly taps a tab.
      let resolvedFilter = state.tipFilter;
      if (!resolvedFilter) {
        resolvedFilter = state.data.unadjustedChecks.length > 0 ? 'unadjusted' : 'adjusted';
      }

      // Stale-cleanup: drop any IDs that no longer correspond to an open
      // check (e.g. server paid one elsewhere, or refresh returned fewer).
      state.selectedCheckIds = state.selectedCheckIds.filter((id) => {
        return state.data.openChecks.some((c) => c.checkId === id);
      });

      body.appendChild(buildLeftCol(state.data, handlers));
      body.appendChild(buildMiddleCol(state.data, handlers, resolvedFilter, state.selectedCheckIds, state.activeTab));

      container.appendChild(body);
    }

    refresh();
    const poll = setInterval(refresh, 15000);

    return function cleanup() {
      state.el = null;
      clearInterval(poll);
      if (window._header && window._header.setBackHandler) {
        window._header.setBackHandler(null);
      }
    };
  },
});