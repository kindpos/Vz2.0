// ═══════════════════════════════════════════════════
//  KINDpos Terminal — Close-day pure calculation helpers
//
//  Extracted from close-day.js so formulas can be unit-tested without
//  mounting the scene or mocking fetch.
// ═══════════════════════════════════════════════════

/**
 * Compute the expected cash in the drawer at close-of-day.
 *
 * Logic: all cash collected from customers, minus credit-card tips that
 * must be paid out to servers in cash from the drawer.
 *   - cash_total  = total cash received (includes cash tips from cash payers)
 *   - card_tips   = tips on card transactions, which are owed to servers
 *                   in cash and therefore reduce the expected drawer total
 *
 * NOTE: cash_tips are NOT subtracted — cash customers' tips are already
 * in the physical drawer as part of cash_total.
 *
 * @param {object} daySummary - response from GET /api/v1/orders/day-summary
 * @returns {number}
 */
export function computeCashExpected(daySummary) {
  var d = daySummary || {};
  return (Number(d.cash_total) || 0) - (Number(d.card_tips) || 0);
}

/**
 * Compute the cash variance: how much the counted cash differs from expected.
 *
 * @param {number} cashExpected  - expected drawer total (from computeCashExpected)
 * @param {number|null} cashCounted - amount physically counted; null = not counted
 * @returns {number} positive = over, negative = short, 0 = exact or uncounted
 */
export function computeCashVariance(cashExpected, cashCounted) {
  if (cashCounted == null || cashCounted === 'bypass') return 0;
  return parseFloat((cashCounted - cashExpected).toFixed(2));
}
