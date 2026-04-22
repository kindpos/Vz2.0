"""
Unit tests for `app/core/pin_hash.py` — the PBKDF2-tagged PIN hashing
that backs `POST /auth/verify-pin` at rest.

These pin the format contract so the parse/verify path can't silently
regress (the original implementation shipped with an off-by-one in
`split('$', 3)` that made every hashed-PIN verify return False).
"""

import pytest

from app.core.pin_hash import (
    ensure_hashed_pin,
    hash_pin,
    is_hashed,
    verify_pin_hash,
)


def test_hash_is_tagged():
    h = hash_pin("1234")
    assert h.startswith("$pbkdf2-sha256$")
    assert is_hashed(h)


def test_hash_is_nondeterministic():
    # Distinct salt each call — two hashes of the same PIN differ.
    assert hash_pin("1234") != hash_pin("1234")


def test_verify_roundtrip():
    h = hash_pin("1234")
    assert verify_pin_hash("1234", h)
    assert not verify_pin_hash("0000", h)
    assert not verify_pin_hash("", h)


def test_verify_accepts_legacy_plaintext():
    # During migration, the ledger may still hold plaintext PINs. The
    # verify path MUST accept both formats so pre-hash employees don't
    # get locked out.
    assert verify_pin_hash("1234", "1234")
    assert not verify_pin_hash("0000", "1234")


def test_verify_rejects_empty_stored():
    assert not verify_pin_hash("1234", "")
    assert not verify_pin_hash("", "")


def test_verify_rejects_malformed_tag():
    # A tagged-looking but broken record must not silently fall through
    # to plaintext comparison.
    assert not verify_pin_hash("1234", "$pbkdf2-sha256$not-a-number$x$y")
    assert not verify_pin_hash("1234", "$pbkdf2-sha256$200000$onlytwoparts")


def test_ensure_hashed_pin_is_idempotent():
    once = ensure_hashed_pin("1234")
    twice = ensure_hashed_pin(once)
    # Idempotent: feeding an already-hashed value returns it unchanged.
    assert once == twice
    assert verify_pin_hash("1234", twice)


def test_is_hashed_boundary():
    assert not is_hashed("")
    assert not is_hashed("1234")
    assert is_hashed(hash_pin("1234"))
