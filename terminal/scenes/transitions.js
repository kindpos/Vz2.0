// ═══════════════════════════════════════════════════
//  KINDpos Terminal — check-overview ↔ order-entry transition params
//
//  Single source of truth for the objects passed to
//  SceneManager.mountWorking() in both directions of the check-overview
//  ↔ order-entry handoff. The two call sites used to build these inline;
//  a typo on either side (swapped keys, dropped null fallback, missing
//  seatNumber thread-through) silently broke the handoff — and without
//  the scenes running integration-style, there was no way to catch it.
//
//  Pure functions. No DOM, no fetch, no SceneManager access. Safe to
//  unit-test without mounting the scenes.
// ═══════════════════════════════════════════════════

/**
 * Params for mountWorking('order-entry', ...). Called from check-overview
 * when the user taps ADD ITEMS.
 *
 * Contract guarantees:
 *   - recallOrderId / recallCheckNumber fall back to null (never undefined)
 *     so order-entry's `if (!params.recallOrderId)` branch fires cleanly
 *     on a brand-new check.
 *   - returnTo + returnParams let order-entry find its way back with the
 *     employee + PIN context it needs to hand control to check-overview.
 *   - seatNumbers / selectedSeatNumbers thread the seat layout so the
 *     new scene can pre-select the seat the user tapped on.
 */
export function buildOrderEntryParams(state, params) {
  state = state || {};
  params = params || {};
  var seats = Array.isArray(state.seats) ? state.seats : [];
  var selected = state.selected || {};
  return {
    recallOrderId:     state.orderId || null,
    recallCheckNumber: state.checkNumber || null,
    returnTo:          'check-overview',
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
    seatNumbers:  seats.map(function(s) { return s.number; }),
    selectedSeatNumbers: seats
      .filter(function(s) { return !!selected[s.id]; })
      .map(function(s) { return s.number; }),
  };
}

/**
 * Params for mountWorking('check-overview', ...). Called from order-entry
 * when the user taps BACK or the close button.
 *
 * Contract guarantees:
 *   - checkId prefers the live currentOrderId (if order-entry POSTed a
 *     fresh order during its session) and falls back to the original
 *     recallOrderId the user entered with. Either path lets
 *     check-overview.refreshOrder pull the latest state from the backend.
 *   - PIN + employee context is threaded through so check-overview can
 *     continue the manager-gated flows (discount, void) without asking
 *     for the PIN again.
 */
export function buildCheckOverviewParams(currentOrderId, sceneParams) {
  sceneParams = sceneParams || {};
  return {
    checkId:       currentOrderId || sceneParams.recallOrderId || null,
    pin:           sceneParams.pin,
    employeeId:    sceneParams.employeeId,
    employeeName:  sceneParams.employeeName,
    returnLanding: sceneParams.returnLanding,
  };
}
