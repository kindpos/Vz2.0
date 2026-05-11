"""
Tests for `app.auth.recovery` (OVERSEER_AUTH.md §5.4, §11.1).

Covers code format, lenient normalization, argon2id verify, and rotation
semantics. Each test gets a fresh accounts.db so the provisioning row
written by `seed_recovery_code_hash`/`rotate_recovery_code` is isolated.
"""

from __future__ import annotations

import re
import string
from pathlib import Path

import pytest

from app.auth.recovery import (
    PROVISIONING_KEY_RECOVERY_HASH,
    generate_recovery_code,
    normalize_recovery_code,
    rotate_recovery_code,
    seed_recovery_code_hash,
    verify_recovery_code,
)
from app.persistence.accounts_db import init_accounts_db
from app.persistence.provisioning_repository import ProvisioningRepository


@pytest.fixture
def db_path(tmp_path: Path) -> Path:
    path = tmp_path / "accounts.db"
    init_accounts_db(str(path))
    return path


@pytest.fixture
def provisioning(db_path: Path) -> ProvisioningRepository:
    return ProvisioningRepository(db_path)


# ─── generation ──────────────────────────────────────────────────────────


def test_generate_recovery_code_has_canonical_format(db_path: Path):
    code = generate_recovery_code()
    assert re.fullmatch(r"[a-z]{4}-[a-z]{4}-[a-z]{4}-[a-z]{4}-[a-z]{4}-[a-z]{4}", code)


def test_generate_recovery_code_uses_only_lowercase_letters(db_path: Path):
    code = generate_recovery_code()
    for ch in code.replace("-", ""):
        assert ch in string.ascii_lowercase


def test_generate_recovery_code_is_random_across_calls(db_path: Path):
    # 1024 bits of entropy per code; collisions in 5 draws are astronomical,
    # so a duplicate would be a real bug (e.g., someone swapped in random.random).
    codes = {generate_recovery_code() for _ in range(5)}
    assert len(codes) == 5


# ─── normalization ───────────────────────────────────────────────────────


def test_normalize_strips_hyphens_spaces_and_lowercases():
    canonical = "kjsd-fhgi-poqe-zxcv-bnma-uyti"
    expected = "kjsdfhgipoqezxcvbnmauyti"
    assert normalize_recovery_code(canonical) == expected
    assert normalize_recovery_code("kjsd fhgi poqe zxcv bnma uyti") == expected
    assert normalize_recovery_code("KJSD-FHGI-POQE-ZXCV-BNMA-UYTI") == expected
    assert normalize_recovery_code("KJSDFHGIPOQEZXCVBNMAUYTI") == expected
    assert (
        normalize_recovery_code("kjsd-FHGI poqe\tZXCV\nbnma   uyti") == expected
    )


def test_normalize_handles_none_and_empty():
    assert normalize_recovery_code(None) == ""
    assert normalize_recovery_code("") == ""


# ─── verify / rotate ─────────────────────────────────────────────────────


def test_verify_returns_false_when_no_hash_provisioned(db_path: Path):
    assert verify_recovery_code("anything-at-all-here") is False


def test_verify_returns_true_for_matching_code_after_seed(db_path: Path):
    code = "abcd-efgh-ijkl-mnop-qrst-uvwx"
    seed_recovery_code_hash(code)
    assert verify_recovery_code(code) is True


def test_verify_accepts_any_normalized_variant_after_seed(db_path: Path):
    code = "abcd-efgh-ijkl-mnop-qrst-uvwx"
    seed_recovery_code_hash(code)
    assert verify_recovery_code(code) is True
    assert verify_recovery_code("ABCD-EFGH-IJKL-MNOP-QRST-UVWX") is True
    assert verify_recovery_code("abcd efgh ijkl mnop qrst uvwx") is True
    assert verify_recovery_code("abcdefghijklmnopqrstuvwx") is True


def test_verify_returns_false_for_non_matching_code(db_path: Path):
    seed_recovery_code_hash("abcd-efgh-ijkl-mnop-qrst-uvwx")
    assert verify_recovery_code("zzzz-zzzz-zzzz-zzzz-zzzz-zzzz") is False


def test_rotate_invalidates_old_and_returns_verifiable_new_code(db_path: Path):
    old = "abcd-efgh-ijkl-mnop-qrst-uvwx"
    seed_recovery_code_hash(old)
    assert verify_recovery_code(old) is True

    new_code = rotate_recovery_code()
    assert re.fullmatch(
        r"[a-z]{4}-[a-z]{4}-[a-z]{4}-[a-z]{4}-[a-z]{4}-[a-z]{4}", new_code
    )
    assert verify_recovery_code(old) is False
    assert verify_recovery_code(new_code) is True


def test_rotate_writes_hash_under_canonical_provisioning_key(
    db_path: Path, provisioning: ProvisioningRepository
):
    new_code = rotate_recovery_code()
    stored = provisioning.get_value(PROVISIONING_KEY_RECOVERY_HASH)
    assert stored is not None
    # Stored value must be a hash, not the plaintext code.
    assert stored != new_code
    assert stored.startswith("$argon2")
