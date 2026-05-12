"""
Offline license verification.

Reads a signed license file (issued by tools/kindpos-keygen.py), verifies
the Ed25519 signature against the public key baked into app.config, and
binds the license to this machine's hardware fingerprint. All entry points
return tuples and never raise — the boot path uses these to set an
`activated` flag without crashing on malformed input.
"""

from __future__ import annotations

import base64
import binascii
import json
import logging
from pathlib import Path
from typing import Optional

from cryptography.exceptions import InvalidSignature
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PublicKey

from app.config import KINDPOS_LICENSE_PUBLIC_KEY
from app.services.hardware_fingerprint import get_hardware_fingerprint

_log = logging.getLogger(__name__)

DEFAULT_LICENSE_PATH = "/data/kindpos.lic"


def load_license(path: str = DEFAULT_LICENSE_PATH) -> Optional[dict]:
    """Read and JSON-parse the license file. Return None on any failure."""
    try:
        p = Path(path)
        if not p.is_file():
            return None
        text = p.read_text(encoding="utf-8")
    except OSError:
        return None
    try:
        data = json.loads(text)
    except (ValueError, TypeError):
        return None
    if not isinstance(data, dict):
        return None
    return data


def _b64url_decode(s: str) -> bytes:
    """Decode urlsafe base64 with or without padding. Raises binascii.Error on bad input."""
    pad = (-len(s)) % 4
    return base64.urlsafe_b64decode(s + ("=" * pad))


def verify_license(lic: dict) -> tuple[bool, str]:
    """Verify Ed25519 signature over the canonical JSON of the license payload."""
    if not isinstance(lic, dict):
        return False, "License payload is not a dict"

    if "signature" not in lic:
        return False, "Missing signature field"

    payload = {k: v for k, v in lic.items() if k != "signature"}
    sig_value = lic["signature"]
    if not isinstance(sig_value, str):
        return False, "Signature field is not a string"

    try:
        sig_bytes = _b64url_decode(sig_value)
    except (binascii.Error, ValueError):
        return False, "Signature is not valid base64"

    try:
        pub_bytes = base64.b64decode(KINDPOS_LICENSE_PUBLIC_KEY)
        pubkey = Ed25519PublicKey.from_public_bytes(pub_bytes)
    except (binascii.Error, ValueError):
        return False, "Configured public key is invalid"

    try:
        canonical = json.dumps(payload, sort_keys=True, separators=(",", ":")).encode("utf-8")
    except (TypeError, ValueError):
        return False, "Payload is not JSON-serializable"

    try:
        pubkey.verify(sig_bytes, canonical)
    except InvalidSignature:
        return False, "Signature did not verify against configured public key"
    except Exception as e:  # noqa: BLE001 — never propagate from verifier
        return False, f"Signature verification failed: {e.__class__.__name__}"

    return True, "ok"


def check_terminal_license(path: str = DEFAULT_LICENSE_PATH) -> tuple[bool, str]:
    """Full boot-time check: load, signature-verify, and hardware-bind."""
    lic = load_license(path)
    if lic is None:
        return False, "License file not found"

    ok, reason = verify_license(lic)
    if not ok:
        return False, reason

    bound_fp = lic.get("terminal_fingerprint")
    if not isinstance(bound_fp, str) or not bound_fp:
        return False, "License missing terminal_fingerprint"

    try:
        this_fp = get_hardware_fingerprint()
    except Exception as e:  # noqa: BLE001
        return False, f"Could not read hardware fingerprint: {e.__class__.__name__}"

    if bound_fp != this_fp:
        return False, "License bound to different hardware"

    license_id = lic.get("license_id")
    if not isinstance(license_id, str) or not license_id:
        return False, "License missing license_id"

    return True, license_id
