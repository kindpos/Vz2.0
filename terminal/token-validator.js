// ═══════════════════════════════════════════════════
//  KINDpos Terminal — Overseer binding-token validator
//  Implements the §7 local checks (OVERSEER_AUTH.md):
//    1. base64url-decode payload, JSON-parse
//    2. Ed25519 signature verify with the cached Overseer public key
//    3. expires_at > now
//    4. payload.fingerprint == stored hardware fingerprint
//    5. payload.slot_id not in cached revocations list
//
//  All five checks are local — never reaches the network.
// ═══════════════════════════════════════════════════

function _b64urlToBytes(s) {
  if (typeof s !== 'string') throw new TypeError('expected string');
  // Convert base64url → base64, re-pad to a multiple of 4.
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/');
  const padded = b64 + '='.repeat((4 - (b64.length % 4)) % 4);
  const bin = atob(padded);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/**
 * Decode the payload half of a token. Does NOT verify the signature — use
 * `validateToken` for that. Returns the parsed payload object, or throws
 * if the token is malformed.
 */
export function parseTokenPayload(token) {
  if (typeof token !== 'string' || !token.includes('.')) {
    throw new Error('malformed token');
  }
  const [payloadB64] = token.split('.');
  const bytes = _b64urlToBytes(payloadB64);
  const json = new TextDecoder('utf-8').decode(bytes);
  return JSON.parse(json);
}

/**
 * Run the five §7 local checks. Resolves to `{ valid: true }` or
 * `{ valid: false, reason }`. Never throws — callers can rely on the
 * shape of the return.
 *
 *   token              — "<b64url-payload>.<b64url-sig>"
 *   publicKeyB64url    — Overseer public key (32-byte Ed25519 raw, b64url-nopad)
 *   storedFingerprint  — hardware fingerprint cached at bind time
 *   cachedRevocations  — array of revoked slot_id strings (may be [])
 */
export async function validateToken(
  token,
  publicKeyB64url,
  storedFingerprint,
  cachedRevocations,
) {
  // Step 1 — base64url-decode payload + parse JSON.
  let payload;
  let payloadBytes;
  let sigBytes;
  try {
    if (typeof token !== 'string' || token.split('.').length !== 2) {
      return { valid: false, reason: 'malformed_token' };
    }
    const [payloadB64, sigB64] = token.split('.');
    payloadBytes = _b64urlToBytes(payloadB64);
    sigBytes = _b64urlToBytes(sigB64);
    payload = JSON.parse(new TextDecoder('utf-8').decode(payloadBytes));
  } catch (e) {
    return { valid: false, reason: 'decode_error' };
  }

  // Step 2 — Ed25519 signature verify via Web Crypto.
  try {
    const pubBytes = _b64urlToBytes(publicKeyB64url);
    const key = await crypto.subtle.importKey(
      'raw',
      pubBytes,
      { name: 'Ed25519' },
      false,
      ['verify'],
    );
    const ok = await crypto.subtle.verify(
      { name: 'Ed25519' },
      key,
      sigBytes,
      payloadBytes,
    );
    if (!ok) return { valid: false, reason: 'bad_signature' };
  } catch (e) {
    return { valid: false, reason: 'verify_error' };
  }

  // Step 3 — expires_at > now.
  if (!payload.expires_at) return { valid: false, reason: 'missing_expires_at' };
  const expiresMs = Date.parse(payload.expires_at);
  if (Number.isNaN(expiresMs) || expiresMs <= Date.now()) {
    return { valid: false, reason: 'expired' };
  }

  // Step 4 — fingerprint match.
  if (payload.fingerprint !== storedFingerprint) {
    return { valid: false, reason: 'fingerprint_mismatch' };
  }

  // Step 5 — slot not on the cached revocations list.
  const revs = Array.isArray(cachedRevocations) ? cachedRevocations : [];
  if (revs.includes(payload.slot_id)) {
    return { valid: false, reason: 'revoked' };
  }

  return { valid: true };
}
