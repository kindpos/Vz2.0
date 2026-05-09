// ═══════════════════════════════════════════════════
//  KINDpos Terminal — Seat + check pure helpers
//
//  Every seat/check interaction in check-overview routes through one
//  of these functions. Previously all inlined; extracting them so the
//  layout math, selection semantics, and backend→frontend shape
//  conversion can be unit-tested without mounting the scene.
//
//  Conventions:
//    - seat:  { id: 'S-001', number: 1, items: [...] }
//    - item:  { qty, price, effectivePrice?, ... }
//    - selected:       { [seatId]: true }   — seat-level selection
//    - selectedItems:  { 'S-NNN:itemId': true }  — item-level selection (stable IDs)
//    - paidSeats:      { [seatId]: true }   — seats with a payment attached
//
//  All helpers are pure — no DOM, no fetch, no global state. Selection
//  toggles return a new map so the caller owns the re-render trigger.
// ═══════════════════════════════════════════════════

/**
 * Sum of qty × price for a seat's items. Prefers effectivePrice (which
 * reflects modifiers + discounts) but falls back to base price when the
 * backend hasn't computed one yet. Note: uses `||` on purpose — an
 * effectivePrice of 0 falls back to price, matching pre-extraction behavior.
 */
export function seatSubtotal(seat) {
  var t = 0;
  var items = (seat && seat.items) || [];
  for (var i = 0; i < items.length; i++) {
    var it = items[i];
    if (it.voided) continue;
    t += (it.qty || 0) * (it.effectivePrice != null ? it.effectivePrice : (it.price || 0));
  }
  return t;
}

/** Sum of seatSubtotal across all UNPAID seats. Does NOT include tax. */
export function checkSubtotal(seats, paidSeats) {
  var sum = 0;
  seats = seats || [];
  for (var i = 0; i < seats.length; i++) {
    if (paidSeats && paidSeats[seats[i].id]) continue;
    sum += seatSubtotal(seats[i]);
  }
  return sum;
}

/** Count of seats with no payment attached. */
export function activeSeatCount(seats, paidSeats) {
  var n = 0;
  seats = seats || [];
  for (var i = 0; i < seats.length; i++) {
    if (!paidSeats || !paidSeats[seats[i].id]) n++;
  }
  return n;
}

/**
 * Layout mode picker: A = 1-4 active seats, B = 5+.
 * Mode A renders full-width seat tiles; Mode B switches to an order
 * recap on the left and a compact, scrollable seat grid on the right.
 */
export function layoutModeFor(count) {
  if (count <= 4) return 'A';
  return 'B';
}

/**
 * Convert a backend Order projection into the frontend's seat[] array.
 * - Seeds from order.seat_numbers (authoritative layout) so seats with
 *   no items yet still appear.
 * - Attaches items to their seats; creates a seat on the fly for any
 *   item whose seat_number wasn't in seat_numbers (legacy replay compat).
 * - Pads up to `minSeats` so a brand-new check always has at least one
 *   seat visible.
 * - Returns seats sorted ascending by number.
 */
export function orderToSeats(order, minSeats) {
  minSeats = minSeats || 1;
  var bySeat = {};
  var allIds = [];

  if (order && Array.isArray(order.seat_numbers)) {
    for (var s = 0; s < order.seat_numbers.length; s++) {
      var num = order.seat_numbers[s];
      var sid = 'S-' + String(num).padStart(3, '0');
      if (!bySeat[sid]) {
        bySeat[sid] = { id: sid, number: num, items: [] };
        allIds.push(sid);
      }
    }
  }

  if (order && Array.isArray(order.items)) {
    for (var i = 0; i < order.items.length; i++) {
      var it = order.items[i];
      var sn = it.seat_number || 1;
      var seatId = 'S-' + String(sn).padStart(3, '0');
      if (!bySeat[seatId]) {
        bySeat[seatId] = { id: seatId, number: sn, items: [] };
        allIds.push(seatId);
      }
      bySeat[seatId].items.push({
        item_id:        it.item_id,
        menu_item_id:   it.menu_item_id,
        name:           it.name,
        qty:            it.quantity || it.qty || 1,
        price:          it.price || 0,
        effectivePrice: it.effective_price != null ? it.effective_price : null,
        mods:           it.modifiers || it.mods || [],
        notes:          it.notes || '',
        category:       it.category,
        sent_at:        it.sent_at || null,
        voided:         it.voided || false,
      });
    }
  }

  var maxNum = 0;
  for (var k = 0; k < allIds.length; k++) {
    if (bySeat[allIds[k]].number > maxNum) maxNum = bySeat[allIds[k]].number;
  }
  while (allIds.length < minSeats || maxNum < minSeats) {
    maxNum++;
    var newId = 'S-' + String(maxNum).padStart(3, '0');
    if (!bySeat[newId]) {
      bySeat[newId] = { id: newId, number: maxNum, items: [] };
      allIds.push(newId);
    }
  }

  allIds.sort(function(a, b) { return bySeat[a].number - bySeat[b].number; });
  return allIds.map(function(id) { return bySeat[id]; });
}

/**
 * Toggle a seat's membership in the `selected` map.
 * - Paid seats are never toggleable (selection is for pending work).
 * - Returns a NEW map so the caller can trigger a re-render diff.
 */
export function toggleSeatSelection(selected, paidSeats, seatId) {
  var next = Object.assign({}, selected || {});
  if (paidSeats && paidSeats[seatId]) return next;
  if (next[seatId]) delete next[seatId];
  else              next[seatId] = true;
  return next;
}

/**
 * Toggle a single item's membership in the `selectedItems` map.
 * Key format: 'S-NNN:itemId' (stable seat and item IDs). Returns a NEW map.
 */
export function toggleItemSelection(selectedItems, seatId, itemId) {
  var key = seatId + ':' + itemId;
  var next = Object.assign({}, selectedItems || {});
  if (next[key]) delete next[key];
  else           next[key] = true;
  return next;
}

/** Returns a fresh `selected` map with every unpaid seat marked true. */
export function selectAllUnpaid(seats, paidSeats) {
  var sel = {};
  seats = seats || [];
  for (var i = 0; i < seats.length; i++) {
    if (paidSeats && paidSeats[seats[i].id]) continue;
    sel[seats[i].id] = true;
  }
  return sel;
}

/**
 * Decode the 'S-NNN:itemId' keys back into { seatId, itemId } refs
 * for callers that need to look up the actual items.
 */
export function collectSelectedItemRefs(selectedItems) {
  var out = [];
  var keys = Object.keys(selectedItems || {});
  for (var i = 0; i < keys.length; i++) {
    var p = keys[i].split(':');
    out.push({ seatId: p[0], itemId: p[1] });
  }
  return out;
}
