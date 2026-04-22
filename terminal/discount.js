// ═══════════════════════════════════════════════════
//  KINDpos Terminal — Discount computation
//
//  Pure helpers extracted from check-overview.js _applyDiscount so the
//  backend wire contract (POST /api/v1/orders/{id}/discount) can be
//  unit-tested without mounting the full scene.
//
//  Invariants pinned here:
//    - `amount` is always 2dp (matches backend _validate_2dp gate).
//    - `item_ids` is null when empty (backend treats omitted/null as
//      "apply to whole order"; empty array has been known to 400).
//    - Modifiers are summed into each line's effective price before
//      the pct is applied.
//    - `approved_by` falls back to null when absent.
// ═══════════════════════════════════════════════════

/**
 * Sum a set of order-lines into the dollar amount a given percent
 * discount would remove, rounded to two decimals.
 *
 * @param {Array<{price?:number, qty?:number, mods?:Array<{price?:number}>}>} items
 * @param {number} pct     Percentage, e.g. 10 for 10%.
 * @returns {number}       Dollar amount, 2dp.
 */
export function computeDiscountAmount(items, pct) {
  var amount = 0;
  for (var i = 0; i < items.length; i++) {
    var it = items[i] || {};
    var base = it.price || 0;
    var modSum = 0;
    if (Array.isArray(it.mods)) {
      for (var m = 0; m < it.mods.length; m++) {
        modSum += (it.mods[m] && it.mods[m].price) || 0;
      }
    }
    var effective = (base + modSum) * (it.qty || 1);
    amount += effective * (pct / 100);
  }
  // Matches backend _validate_2dp: reject anything beyond 2dp. Also dodges
  // float drift from (pct / 100).
  return Number(amount.toFixed(2));
}

/**
 * Pull the server-side item_ids out of a line set, skipping any lines
 * that haven't been persisted yet (no item_id).
 *
 * @param {Array<{item_id?:string}>} items
 * @returns {Array<string>}
 */
export function extractItemIds(items) {
  var ids = [];
  for (var i = 0; i < items.length; i++) {
    if (items[i] && items[i].item_id) ids.push(items[i].item_id);
  }
  return ids;
}

/**
 * Build the JSON body for POST /api/v1/orders/{id}/discount.
 *
 * @param {number}  pct
 * @param {number}  amount      Already rounded to 2dp.
 * @param {Array<string>} itemIds
 * @param {?string} approvedBy
 * @returns {{discount_type:string, amount:number, reason:string, approved_by:?string, item_ids:?Array<string>}}
 */
export function buildDiscountBody(pct, amount, itemIds, approvedBy) {
  return {
    discount_type: pct + '%',
    amount:        amount,
    reason:        'Manager ' + pct + '% discount',
    approved_by:   approvedBy || null,
    item_ids:      itemIds && itemIds.length ? itemIds : null,
  };
}
