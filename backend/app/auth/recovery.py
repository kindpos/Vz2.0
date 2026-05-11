"""
Recovery-code handling (OVERSEER_AUTH.md §5.4, §11.1).

The recovery code is printed once on the welcome letter, hashed (argon2id)
into `provisioning.recovery_code_hash`, and surfaced again only after a
successful `/v1/auth/password-recovery` rotation.

Format (§11.1): six groups of four lowercase letters, hyphen-separated —
`kjsd-fhgi-poqe-zxcv-bnma-uyti`. Entry is lenient: spaces, hyphens, or
no separator at all are accepted and normalized to the canonical form
before hashing or comparison.

Code generation uses `secrets`, never `random`.
"""

from __future__ import annotations

import secrets
import string
from typing import Optional

from argon2 import PasswordHasher
from argon2.exceptions import VerifyMismatchError, InvalidHashError

from app.persistence.provisioning_repository import ProvisioningRepository


PROVISIONING_KEY_RECOVERY_HASH = "recovery_code_hash"

GROUP_COUNT = 6
GROUP_LENGTH = 4
ALPHABET = string.ascii_lowercase

_HASHER = PasswordHasher()


def _resolve_provisioning_repo() -> ProvisioningRepository:
    # Re-imported each call so tests that re-init the DB still resolve right.
    from app.persistence import accounts_db as _accounts_db_mod

    if _accounts_db_mod._DB_PATH is None:
        raise RuntimeError(
            "accounts DB not initialized; call init_accounts_db(path) first"
        )
    return ProvisioningRepository(str(_accounts_db_mod._DB_PATH))


def generate_recovery_code() -> str:
    """Cryptographically random recovery code in canonical form."""
    groups = [
        "".join(secrets.choice(ALPHABET) for _ in range(GROUP_LENGTH))
        for _ in range(GROUP_COUNT)
    ]
    return "-".join(groups)


def normalize_recovery_code(code: str) -> str:
    """Strip hyphens, whitespace, and case so user-typed variants all hash
    to the same value as the canonical printed form."""
    if code is None:
        return ""
    stripped = code.translate(str.maketrans("", "", "- \t\r\n"))
    return stripped.lower()


def verify_recovery_code(provided: str) -> bool:
    """Constant-time argon2id verify against the stored hash. Returns False
    if no hash is provisioned, the stored value is malformed, or the code
    does not match."""
    repo = _resolve_provisioning_repo()
    stored_hash = repo.get_value(PROVISIONING_KEY_RECOVERY_HASH)
    if not stored_hash:
        return False
    candidate = normalize_recovery_code(provided)
    try:
        return _HASHER.verify(stored_hash, candidate)
    except (VerifyMismatchError, InvalidHashError):
        return False


def rotate_recovery_code() -> str:
    """Generate a fresh code, persist its argon2id hash, return plaintext.

    Caller is responsible for surfacing the plaintext exactly once and
    never logging it.
    """
    new_code = generate_recovery_code()
    new_hash = _HASHER.hash(normalize_recovery_code(new_code))
    repo = _resolve_provisioning_repo()
    repo.set_value(PROVISIONING_KEY_RECOVERY_HASH, new_hash)
    return new_code


def seed_recovery_code_hash(plaintext: str) -> None:
    """Test/provisioning helper: hash and write a known plaintext as the
    initial recovery code. Used by the image-builder and by tests that need
    a known-good code to verify against."""
    repo = _resolve_provisioning_repo()
    h = _HASHER.hash(normalize_recovery_code(plaintext))
    repo.set_value(PROVISIONING_KEY_RECOVERY_HASH, h)
