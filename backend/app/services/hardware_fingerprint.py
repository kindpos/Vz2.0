"""
Hardware fingerprint utility (HARDWARE_ROUTING.md §6).

Two read-only helpers, no side effects on import:

- `get_hardware_fingerprint()` — sha256("{serial}:{mac}") used by the §7
  binding flow and the legacy license check-in.
- `get_mac_address()` — raw MAC string for HARDWARE_ROUTING.md §5 proxy
  MAC→IP routing. Not hashed.

Platform paths:

- Linux/Pi: serial from `/proc/cpuinfo` (the `Serial` line), MAC from
  `/sys/class/net/eth0/address`.
- Windows: serial from `HKLM\\SOFTWARE\\Microsoft\\Cryptography\\MachineGuid`,
  MAC from `uuid.getnode()` (colon-separated lowercase hex).
- Other platforms: dev fallback — serial `"unknown"`, MAC from
  `uuid.getnode()` for the fingerprint; empty string for raw MAC.
"""

from __future__ import annotations

import hashlib
import logging
import platform
import uuid

_log = logging.getLogger(__name__)

_LINUX_CPUINFO = "/proc/cpuinfo"
_LINUX_ETH0_MAC = "/sys/class/net/eth0/address"
_WIN_REG_KEY = r"SOFTWARE\Microsoft\Cryptography"
_WIN_REG_VAL = "MachineGuid"


def _format_mac_from_uuid_node() -> str:
    """Return uuid.getnode() as 'aa:bb:cc:dd:ee:ff' (lowercase, big-endian)."""
    node = uuid.getnode()
    return ":".join(
        f"{(node >> (i * 8)) & 0xff:02x}" for i in reversed(range(6))
    )


def _read_linux_serial() -> str | None:
    try:
        with open(_LINUX_CPUINFO, "r") as f:
            for line in f:
                if line.startswith("Serial"):
                    return line.split(":", 1)[1].strip()
    except OSError as e:
        _log.warning("Could not read %s: %s", _LINUX_CPUINFO, e)
    return None


def _read_linux_mac() -> str | None:
    try:
        with open(_LINUX_ETH0_MAC, "r") as f:
            value = f.read().strip()
        return value or None
    except OSError as e:
        _log.warning("Could not read %s: %s", _LINUX_ETH0_MAC, e)
        return None


def _read_windows_serial() -> str | None:
    try:
        import winreg  # type: ignore[import-not-found]

        with winreg.OpenKey(winreg.HKEY_LOCAL_MACHINE, _WIN_REG_KEY) as key:
            value, _ = winreg.QueryValueEx(key, _WIN_REG_VAL)
        return str(value).strip() or None
    except OSError as e:
        _log.warning("Could not read MachineGuid from registry: %s", e)
        return None


def get_hardware_fingerprint() -> str:
    """Return sha256("{serial}:{mac}").hexdigest().

    Linux: raises `RuntimeError` only when both `/proc/cpuinfo` Serial AND
    `/sys/class/net/eth0/address` are unreadable — single-component
    failures fall back to the literal `"unknown"` for that half.

    Windows: serial falls back to `"unknown"` if the registry read fails;
    MAC always derives from `uuid.getnode()` and never raises.

    Other platforms: serial `"unknown"`, MAC from `uuid.getnode()` — used
    as the dev/test fallback. Never raises.
    """
    system = platform.system()

    if system == "Linux":
        serial = _read_linux_serial()
        mac = _read_linux_mac()
        if serial is None and mac is None:
            raise RuntimeError(
                "Could not read /proc/cpuinfo Serial or "
                "/sys/class/net/eth0/address"
            )
        combined = f"{serial or 'unknown'}:{mac or 'unknown'}"
    elif system == "Windows":
        serial = _read_windows_serial() or "unknown"
        combined = f"{serial}:{_format_mac_from_uuid_node()}"
    else:
        combined = f"unknown:{_format_mac_from_uuid_node()}"

    return hashlib.sha256(combined.encode("utf-8")).hexdigest()


def get_mac_address() -> str:
    """Return the raw (un-hashed) MAC address for this machine.

    Linux: `/sys/class/net/eth0/address`. Empty string on read failure.
    Windows: `uuid.getnode()` colon-formatted (never fails).
    Other platforms: empty string.
    """
    system = platform.system()
    if system == "Linux":
        mac = _read_linux_mac()
        return mac or ""
    if system == "Windows":
        return _format_mac_from_uuid_node()
    return ""
