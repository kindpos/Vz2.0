"""
Tests for `app.services.hardware_fingerprint` (HARDWARE_ROUTING.md §6).

The tests run on any host platform — they pin `platform.system()` to
'Linux' via monkeypatch and stub the two specific file reads the Linux
path performs, so the Windows CI box and Pi targets both exercise the
same code paths.
"""

from __future__ import annotations

import builtins
import hashlib
import io

import pytest

from app.services import hardware_fingerprint as hwfp


# ─── helpers ─────────────────────────────────────────────────────────────


def _make_open_dispatcher(contents: dict[str, str], errors: set[str]):
    """Return a `builtins.open` replacement that resolves the paths the
    Linux fingerprint code reads.

    `contents` maps path -> file body (returned as a StringIO).
    `errors` is the set of paths that should raise OSError instead.
    Anything else falls back to the real `open`.
    """
    real_open = builtins.open

    def _fake_open(path, *args, **kwargs):
        spath = str(path)
        if spath in errors:
            raise OSError(f"simulated unreadable: {spath}")
        if spath in contents:
            return io.StringIO(contents[spath])
        return real_open(path, *args, **kwargs)

    return _fake_open


# ─── get_hardware_fingerprint ────────────────────────────────────────────


def test_linux_path_hashes_serial_and_mac(monkeypatch: pytest.MonkeyPatch):
    """Both files readable → sha256("{serial}:{mac}").hexdigest()."""
    monkeypatch.setattr(hwfp.platform, "system", lambda: "Linux")
    monkeypatch.setattr(
        builtins,
        "open",
        _make_open_dispatcher(
            contents={
                hwfp._LINUX_CPUINFO: (
                    "processor\t: 0\n"
                    "model name\t: ARMv7\n"
                    "Serial\t\t: 10000000abcdef12\n"
                ),
                hwfp._LINUX_ETH0_MAC: "dc:a6:32:11:22:33\n",
            },
            errors=set(),
        ),
    )

    expected = hashlib.sha256(
        b"10000000abcdef12:dc:a6:32:11:22:33"
    ).hexdigest()
    assert hwfp.get_hardware_fingerprint() == expected


def test_linux_path_falls_back_to_unknown_when_mac_unreadable(
    monkeypatch: pytest.MonkeyPatch,
):
    """Serial readable, MAC unreadable → sha256("SERIAL:unknown")."""
    monkeypatch.setattr(hwfp.platform, "system", lambda: "Linux")
    monkeypatch.setattr(
        builtins,
        "open",
        _make_open_dispatcher(
            contents={
                hwfp._LINUX_CPUINFO: "Serial\t\t: 10000000abcdef12\n",
            },
            errors={hwfp._LINUX_ETH0_MAC},
        ),
    )

    expected = hashlib.sha256(b"10000000abcdef12:unknown").hexdigest()
    assert hwfp.get_hardware_fingerprint() == expected


def test_linux_path_raises_when_both_unreadable(monkeypatch: pytest.MonkeyPatch):
    """Both files unreadable → RuntimeError (never falls back to a
    fully-`unknown` hash)."""
    monkeypatch.setattr(hwfp.platform, "system", lambda: "Linux")
    monkeypatch.setattr(
        builtins,
        "open",
        _make_open_dispatcher(
            contents={},
            errors={hwfp._LINUX_CPUINFO, hwfp._LINUX_ETH0_MAC},
        ),
    )

    with pytest.raises(RuntimeError):
        hwfp.get_hardware_fingerprint()


# ─── get_mac_address ─────────────────────────────────────────────────────


def test_get_mac_address_linux_returns_plain_mac(
    monkeypatch: pytest.MonkeyPatch,
):
    """Linux path: read eth0 address, strip trailing newline, return raw."""
    monkeypatch.setattr(hwfp.platform, "system", lambda: "Linux")
    monkeypatch.setattr(
        builtins,
        "open",
        _make_open_dispatcher(
            contents={hwfp._LINUX_ETH0_MAC: "dc:a6:32:aa:bb:cc\n"},
            errors=set(),
        ),
    )

    assert hwfp.get_mac_address() == "dc:a6:32:aa:bb:cc"


def test_get_mac_address_returns_empty_on_read_error(
    monkeypatch: pytest.MonkeyPatch,
):
    """Linux path with unreadable eth0 → empty string (not 'unknown', not
    a uuid.getnode() fallback — the hub-proxy lookup treats '' as 'no
    MAC, skip MAC-routing for this terminal')."""
    monkeypatch.setattr(hwfp.platform, "system", lambda: "Linux")
    monkeypatch.setattr(
        builtins,
        "open",
        _make_open_dispatcher(
            contents={},
            errors={hwfp._LINUX_ETH0_MAC},
        ),
    )

    assert hwfp.get_mac_address() == ""
