// ═══════════════════════════════════════════════════
//  KINDpos Terminal — Unified Discount Engine
//
//  Reads window.pricingConfig.discounts (populated by app.js at boot,
//  refreshed every 30s). Answers two questions:
//    1. Which auto discounts are currently active?
//    2. What is the best auto discount for a given ticket item?
//
//  Discount schema (backend fields):
//    discount.id              — string
//    discount.name            — string
//    discount.type            — "percentage" | "flat_dollar"
//    discount.value           — number (pct or dollar amount)
//    discount.auto            — bool  (true = applies automatically)
//    discount.timing_type     — "always" | "day_part" | "custom"
//    discount.timing_day_part_id — string | null
//    discount.timing_start    — "HH:MM" | null
//    discount.timing_end      — "HH:MM" | null
//
//  Nice. Dependable. Yours.
// ═══════════════════════════════════════════════════

function _mins(hhmm) {
  if (!hhmm) return 0;
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}

// Returns all auto=true discounts whose timing window is currently active.
export function getActiveAutoDiscounts() {
  const now      = new Date();
  const nowMins  = now.getHours() * 60 + now.getMinutes();
  const activeDPW = window.getActiveDayPartWindow?.();

  return (window.pricingConfig?.discounts ?? []).filter(d => {
    if (!d.auto) return false;

    const t = d.timing_type ?? 'always';

    if (t === 'always') return true;

    if (t === 'day_part')
      return activeDPW?.dayPart?.id === d.timing_day_part_id;

    if (t === 'custom') {
      const s = _mins(d.timing_start);
      const e = _mins(d.timing_end);
      return s <= e
        ? nowMins >= s && nowMins < e
        : nowMins >= s || nowMins < e;
    }

    return false;
  });
}

// Returns the best matching auto discount for an item.
// Percentage discounts are compared by effective percentage;
// flat discounts are converted to an effective percentage for comparison.
// Most favorable wins. No stacking.
export function getItemAutoDiscount(item, activeDiscounts) {
  if (!activeDiscounts?.length) return null;

  const price = item.unitPrice ?? item.unit_price ?? 0;

  const best = activeDiscounts.reduce((winner, d) => {
    const dv = _effectivePct(d, price);
    const wv = winner ? _effectivePct(winner, price) : -1;
    return dv > wv ? d : winner;
  }, null);

  if (!best) return null;

  const amt = _discountAmount(best, price);
  if (amt <= 0) return null;

  return { discount: best, amount: amt };
}

// Compute the dollar amount a discount removes from a given price.
function _discountAmount(d, price) {
  const rnd = window.roundHalfUp || (v => Math.round((v + 1e-10) * 100) / 100);
  if (d.type === 'percentage') return rnd(price * Number(d.value) / 100);
  if (d.type === 'flat_dollar') return rnd(Math.min(Number(d.value), price));
  return 0;
}

// Convert a discount to an effective percentage for comparison purposes.
function _effectivePct(d, price) {
  if (d.type === 'percentage') return Number(d.value);
  if (d.type === 'flat_dollar') return price > 0 ? Number(d.value) / price * 100 : 0;
  return 0;
}
