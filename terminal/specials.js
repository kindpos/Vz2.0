// ═══════════════════════════════════════════════════
//  KINDpos Terminal — Day-Part Specials Engine
//
//  Reads window.pricingConfig (populated by app.js at boot)
//  and answers two questions:
//    1. Which specials are active right now?
//    2. How much does a given ticket item get discounted?
//
//  Schema notes (actual backend fields):
//    special.schedule.mode          — 'dayparts' | 'custom' | absent
//    special.schedule.daypart_ids   — string[] of day-part IDs
//    special.schedule.custom_windows — window[] used when mode='custom'
//    special.scope.mode             — 'all' | 'items' | 'categories'
//    special.scope.ids              — string[] of item or category IDs
//    special.discount_type          — 'percentage' | 'flat' | 'fixed_price'
//    special.discount_value         — number
//    special.requires_pin           — boolean
//    special.priority               — number (higher wins)
//    daypart.windows[]              — {label, days:string[], start:'HH:MM', end:'HH:MM'}
//
//  Nice. Dependable. Yours.
// ═══════════════════════════════════════════════════

var _DAY_NAMES = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

function _parseMinutes(hhmm) {
  var parts = (hhmm || '00:00').split(':');
  return parseInt(parts[0], 10) * 60 + parseInt(parts[1] || '0', 10);
}

function _windowActive(w, nowMin, currentDay) {
  var wDays = w.days || [];
  if (wDays.length > 0 && wDays.indexOf(currentDay) === -1) return false;
  return nowMin >= _parseMinutes(w.start) && nowMin < _parseMinutes(w.end);
}

// Returns the array of specials that are currently scheduled (active flag
// + day-part or custom-window time match). Reads from window.pricingConfig
// which is refreshed every 30s by app.js pollConfigVersion.
export function getActiveSpecials() {
  var cfg      = window.pricingConfig || {};
  var specials = cfg.specials  || [];
  var dayParts = cfg.dayParts  || [];

  var now        = new Date();
  var nowMin     = now.getHours() * 60 + now.getMinutes();
  var currentDay = _DAY_NAMES[now.getDay()];

  return specials.filter(function(sp) {
    if (!sp.active) return false;

    var sched = sp.schedule || {};

    if (sched.mode === 'dayparts') {
      var dpIds = sched.daypart_ids || [];
      if (dpIds.length === 0) return true; // no restriction → always active
      return dpIds.some(function(id) {
        var dp = dayParts.find(function(d) { return d.id === id; });
        if (!dp) return false;
        return (dp.windows || []).some(function(w) {
          return _windowActive(w, nowMin, currentDay);
        });
      });
    }

    if (sched.mode === 'custom') {
      var wins = sched.custom_windows || [];
      if (wins.length === 0) return true;
      return wins.some(function(w) { return _windowActive(w, nowMin, currentDay); });
    }

    return true; // no schedule restriction
  });
}

// Given a ticket item (with unitPrice, menu_item_id, category, mods fields)
// and an array of active specials, returns the best matching discount.
// Returns { amount: number (2dp), special: object|null }.
// amount is 0 and special is null when no special applies.
export function getItemSpecialDiscount(item, activeSpecials) {
  if (!activeSpecials || activeSpecials.length === 0) return { amount: 0, special: null };

  var itemId = item.menu_item_id || '';
  var catId  = item.category     || '';

  var matching = activeSpecials.filter(function(sp) {
    var scope = sp.scope || {};
    if (!scope.mode || scope.mode === 'all') return true;
    if (scope.mode === 'items')              return (scope.ids || []).indexOf(itemId) !== -1;
    if (scope.mode === 'categories')         return (scope.ids || []).indexOf(catId)  !== -1;
    return false;
  });

  if (matching.length === 0) return { amount: 0, special: null };

  // Highest priority wins; ties broken by array order.
  matching.sort(function(a, b) { return (b.priority || 0) - (a.priority || 0); });
  var best = matching[0];

  // Line price = base + charged modifiers only.
  var chargedMods = (item.mods || []).reduce(function(s, m) {
    return s + (m.charged ? (Number(m.price) || 0) : 0);
  }, 0);
  var linePrice = (Number(item.unitPrice) || 0) + chargedMods;

  var rnd = window.roundHalfUp || function(v) {
    return Math.round((v + 1e-10) * 100) / 100;
  };

  var amount = 0;
  var dv = Number(best.discount_value) || 0;
  if (best.discount_type === 'percentage') {
    amount = rnd(linePrice * dv / 100);
  } else if (best.discount_type === 'flat') {
    amount = rnd(Math.min(dv, linePrice));
  } else if (best.discount_type === 'fixed_price') {
    amount = rnd(Math.max(0, linePrice - dv));
  }

  return { amount: amount, special: best };
}
