"""
Ed25519 binding-token issuance (OVERSEER_AUTH.md §7).

The token is a compact custom format:

    base64url(payload_json) + "." + base64url(signature)

where each base64url segment is unpadded. The signature is computed over
the *raw* `payload_json` bytes (not over the base64 encoding) using the
Overseer's Ed25519 private key.

Validation, refresh, and revocation are out of scope here.
"""

from __future__ import annotations

import base64
import json
from datetime import datetime, timedelta, timezone

from cryptography.exceptions import InvalidSignature
from cryptography.hazmat.primitives.asymmetric.ed25519 import (
    Ed25519PrivateKey,
    Ed25519PublicKey,
)


def _b64url_nopad(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode("ascii")


def _b64url_decode_nopad(s: str) -> bytes:
    pad = "=" * (-len(s) % 4)
    return base64.urlsafe_b64decode(s + pad)


def issue_terminal_token(
    *,
    slot_id: str,
    store_ref: str,
    fingerprint: str,
    private_key_b64url: str,
    lifetime_days: int = 30,
) -> dict:
    """Sign and return an Overseer binding token for `slot_id`.

    Returns `{"token": "<b64u-payload>.<b64u-sig>", "token_expires_at": <ISO8601>}`.
    The `token_expires_at` value also appears inside the signed payload — it
    is surfaced separately so callers can persist it on the `terminal_bindings`
    row without reparsing the token.
    """
    now = datetime.now(timezone.utc)
    expires = now + timedelta(days=lifetime_days)
    payload = {
        "v": 1,
        "slot_id": slot_id,
        "store_ref": store_ref,
        "fingerprint": fingerprint,
        "issued_at": now.isoformat(),
        "expires_at": expires.isoformat(),
    }
    payload_json = json.dumps(payload, separators=(",", ":")).encode("utf-8")

    priv_bytes = _b64url_decode_nopad(private_key_b64url)
    private_key = Ed25519PrivateKey.from_private_bytes(priv_bytes)
    signature = private_key.sign(payload_json)

    token = f"{_b64url_nopad(payload_json)}.{_b64url_nopad(signature)}"
    return {"token": token, "token_expires_at": payload["expires_at"]}


def verify_terminal_token(
    *,
    token: str,
    public_key_b64url: str,
) -> dict | None:
    """Verify an Overseer binding token's Ed25519 signature (§7 step 2).

    Returns the decoded payload dict on success, or `None` if the token is
    malformed, the signature fails, or the payload isn't valid JSON.

    Expiry, fingerprint, slot-active, and revocation checks are out of scope
    here — the caller (e.g. `require_terminal_token`) is responsible for those.
    """
    try:
        payload_b64, sig_b64 = token.split(".", 1)
    except ValueError:
        return None
    if "." in sig_b64:
        return None

    try:
        payload_bytes = _b64url_decode_nopad(payload_b64)
        signature = _b64url_decode_nopad(sig_b64)
        pub_raw = _b64url_decode_nopad(public_key_b64url)
    except (ValueError, base64.binascii.Error):
        return None

    try:
        pub_key = Ed25519PublicKey.from_public_bytes(pub_raw)
    except ValueError:
        return None

    try:
        pub_key.verify(signature, payload_bytes)
    except InvalidSignature:
        return None

    try:
        payload = json.loads(payload_bytes.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError):
        return None
    if not isinstance(payload, dict):
        return None
    return payload
