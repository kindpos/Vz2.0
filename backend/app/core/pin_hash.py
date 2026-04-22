"""
KINDpos PIN hashing.

Wraps stdlib `hashlib.pbkdf2_hmac` (no new deps) with a tagged string
format so `verify_pin_hash` can tell a hashed value apart from a legacy
plaintext one and support both during the migration window.

Format
------
    $pbkdf2-sha256$<iterations>$<salt_b64>$<hash_b64>

`verify_pin_hash(submitted, stored)`:
    - If `stored` begins with `$pbkdf2-`, verify via PBKDF2.
    - Otherwise treat `stored` as legacy plaintext and compare with
      `secrets.compare_digest`.

Callers that persist a PIN should push it through `hash_pin(...)` first
(via `ensure_hashed_pin` if the input might already be hashed).
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import os
import secrets


_ITERATIONS = 200_000  # 2025-era desktop PBKDF2-SHA256 target (~150ms)
_SALT_BYTES = 16
_HASH_BYTES = 32
_PREFIX = "$pbkdf2-sha256$"


def _b64(b: bytes) -> str:
    return base64.urlsafe_b64encode(b).rstrip(b"=").decode("ascii")


def _b64decode(s: str) -> bytes:
    # Add back stripped padding.
    pad = "=" * (-len(s) % 4)
    return base64.urlsafe_b64decode(s + pad)


def hash_pin(pin: str) -> str:
    """Return a tagged PBKDF2-SHA256 hash of `pin`.

    The caller should treat the return as opaque and never parse it
    beyond what `verify_pin_hash` does.
    """
    if pin is None:
        pin = ""
    salt = os.urandom(_SALT_BYTES)
    digest = hashlib.pbkdf2_hmac(
        "sha256", pin.encode("utf-8"), salt, _ITERATIONS, dklen=_HASH_BYTES
    )
    return f"{_PREFIX}{_ITERATIONS}${_b64(salt)}${_b64(digest)}"


def is_hashed(stored: str) -> bool:
    """True if `stored` looks like a tagged hash (not legacy plaintext)."""
    return bool(stored) and stored.startswith(_PREFIX)


def verify_pin_hash(submitted: str, stored: str) -> bool:
    """Constant-time verify. Accepts both hashed and legacy plaintext
    `stored` values so an in-place migration can proceed without
    invalidating existing employee records."""
    if not stored:
        return False
    submitted = submitted or ""
    if not is_hashed(stored):
        # Legacy plaintext — constant-time compare.
        return secrets.compare_digest(stored, submitted)
    try:
        # Format is `$pbkdf2-sha256$<iters>$<salt>$<hash>`. Leading split
        # gives "" then four parts — drop the empty leading element.
        parts = stored.split("$")
        _empty, _alg, iters_str, salt_b64, digest_b64 = parts
        iterations = int(iters_str)
        salt = _b64decode(salt_b64)
        expected = _b64decode(digest_b64)
    except Exception:
        # Malformed tag — refuse to authenticate rather than silently
        # falling through to some other path.
        return False
    candidate = hashlib.pbkdf2_hmac(
        "sha256", submitted.encode("utf-8"), salt, iterations, dklen=len(expected)
    )
    return hmac.compare_digest(candidate, expected)


def ensure_hashed_pin(pin: str) -> str:
    """Hash `pin` unless it already looks hashed — lets callers forward
    an already-hashed value through idempotently."""
    if pin and is_hashed(pin):
        return pin
    return hash_pin(pin)
