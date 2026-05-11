// ═══════════════════════════════════════════════════
//  KINDpos Terminal — bind-complete handler
//  Persists the §7 binding artifacts returned by POST /v1/terminals/bind
//  into localStorage so the next boot can validate the token locally,
//  then reloads to re-enter boot under the fresh credentials.
// ═══════════════════════════════════════════════════

const KEYS = {
  token: 'kindpos_token',
  tokenExpiresAt: 'kindpos_token_expires_at',
  slotId: 'kindpos_slot_id',
  publicKey: 'kindpos_public_key',
  fingerprint: 'kindpos_fingerprint',
  revocations: 'kindpos_revocations',
};

/**
 * Persist a successful bind response and reload.
 *
 * `bindResp` is the JSON body from POST /v1/terminals/bind:
 *   { slot_id, terminal_name, token, token_expires_at, overseer_public_key }
 *
 * `hardwareFingerprint` is the fingerprint the caller submitted with the
 * bind request. The server doesn't echo it back, so callers must pass it
 * through from the same source they used in the request body.
 */
export function persistBindResponse(bindResp, hardwareFingerprint) {
  if (!bindResp || !bindResp.token || !bindResp.slot_id) {
    throw new Error('bind response missing token/slot_id');
  }
  if (!hardwareFingerprint) {
    throw new Error('hardwareFingerprint is required');
  }

  localStorage.setItem(KEYS.token, bindResp.token);
  localStorage.setItem(KEYS.slotId, bindResp.slot_id);
  localStorage.setItem(KEYS.publicKey, bindResp.overseer_public_key);
  localStorage.setItem(KEYS.fingerprint, hardwareFingerprint);
  if (bindResp.token_expires_at) {
    localStorage.setItem(KEYS.tokenExpiresAt, bindResp.token_expires_at);
  }
  // Start with a clean revocations cache; the boot-time poll will populate it.
  localStorage.setItem(KEYS.revocations, '[]');

  // Re-enter boot so the just-issued token flows through the §7 gate.
  window.location.reload();
}

export { KEYS as BIND_STORAGE_KEYS };
