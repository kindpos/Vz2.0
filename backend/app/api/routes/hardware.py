"""
KINDpos Hardware API
Network scanning, device persistence (hardware_config.db), test print.
MAC-as-identity: IPs change, MACs don't.
"""

import asyncio
import hashlib
import json
import logging
import os
import re
import socket
import subprocess
import urllib.parse
import platform
import uuid
import xml.etree.ElementTree as ET
import ipaddress
from datetime import datetime
from pathlib import Path
from typing import List, Optional

import aiosqlite
import httpx
from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, field_validator

from ...api.dependencies import get_ledger
from ...api.routes.auth import require_manager
from ...config import settings
from ...core.event_ledger import EventLedger
from ...core.events import (
    payment_processor_configured,
    printer_assignment_changed,
    printer_configured,
    printer_removed,
    server_activated,
)

logger = logging.getLogger("kindpos.hardware")

router = APIRouter(prefix="/hardware", tags=["hardware"])

_MAC_RE = re.compile(r'^([0-9a-fA-F]{1,2}[:\-]){5}[0-9a-fA-F]{1,2}$')

# Canonical data directory — hardware_config.db lives in backend/data/
HARDWARE_DB_PATH = str(
    Path(__file__).resolve().parents[3] / 'data' / 'hardware_config.db'
)

# ΓöÇΓöÇ Port fingerprinting ΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇ
PRINTER_PORTS = [9100, 9101, 9102]
# Dejavoo SPIn ΓÇö default port first, then dedicated fallbacks only
CARD_READER_PORTS = [9000, 8443, 9443]
TERMINAL_PORTS = [8000]
WEB_UI_PORTS = [80]

ALL_SCAN_PORTS = WEB_UI_PORTS + PRINTER_PORTS + CARD_READER_PORTS + TERMINAL_PORTS

# ΓöÇΓöÇ Scan tuning ΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇ
PROBE_TIMEOUT  = 2.5  # TCP connect timeout per port
DIRECT_TIMEOUT = 2.5  # Direct IP probe (user-entered)
PING_TIMEOUT   = 2    # Seconds to wait for broadcast ping / ARP population

# ΓöÇΓöÇ DB bootstrap ΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇ

async def _ensure_db():
    async with aiosqlite.connect(HARDWARE_DB_PATH) as db:
        await db.execute("""
            CREATE TABLE IF NOT EXISTS devices (
                mac         TEXT PRIMARY KEY,
                ip          TEXT NOT NULL,
                type        TEXT NOT NULL,
                name        TEXT NOT NULL,
                port        INTEGER NOT NULL DEFAULT 9100,
                register_id TEXT NOT NULL DEFAULT '',
                tpn         TEXT NOT NULL DEFAULT '',
                auth_key    TEXT NOT NULL DEFAULT '',
                is_active   INTEGER NOT NULL DEFAULT 1,
                saved_at    TEXT NOT NULL
            )
        """)
        # Migrate: add columns if missing (existing DBs)
        async with db.execute("PRAGMA table_info(devices)") as cur:
            cols = [row[1] async for row in cur]
        if 'register_id' not in cols:
            await db.execute("ALTER TABLE devices ADD COLUMN register_id TEXT NOT NULL DEFAULT ''")
        if 'tpn' not in cols:
            await db.execute("ALTER TABLE devices ADD COLUMN tpn TEXT NOT NULL DEFAULT ''")
        if 'auth_key' not in cols:
            await db.execute("ALTER TABLE devices ADD COLUMN auth_key TEXT NOT NULL DEFAULT ''")
        if 'is_active' not in cols:
            await db.execute("ALTER TABLE devices ADD COLUMN is_active INTEGER NOT NULL DEFAULT 1")
        if 'categories' not in cols:
            await db.execute("ALTER TABLE devices ADD COLUMN categories TEXT NOT NULL DEFAULT ''")
        if 'terminal_id' not in cols:
            await db.execute("ALTER TABLE devices ADD COLUMN terminal_id TEXT NOT NULL DEFAULT ''")
        if 'terminal_ids' not in cols:
            await db.execute("ALTER TABLE devices ADD COLUMN terminal_ids TEXT NOT NULL DEFAULT '[]'")
        if 'role' not in cols:
            try:
                await db.execute("ALTER TABLE devices ADD COLUMN role TEXT NOT NULL DEFAULT ''")
            except Exception:
                pass

        # Routing rules — one row per printer per rule type
        await db.execute("""
            CREATE TABLE IF NOT EXISTS printer_routing (
                id          INTEGER PRIMARY KEY AUTOINCREMENT,
                printer_mac TEXT NOT NULL,
                rule_type   TEXT NOT NULL DEFAULT 'all',
                category_id TEXT DEFAULT '',
                item_tag    TEXT DEFAULT '',
                priority    INTEGER DEFAULT 0,
                is_active   INTEGER DEFAULT 1,
                created_at  TEXT NOT NULL
            )
        """)

        # Server-license table — bound on activation, audited via ledger
        await db.execute("""
            CREATE TABLE IF NOT EXISTS server_license (
                activation_code TEXT PRIMARY KEY,
                server_mac      TEXT NOT NULL DEFAULT '',
                platform        TEXT NOT NULL DEFAULT '',
                status          TEXT NOT NULL DEFAULT 'pending',
                store_id        TEXT NOT NULL DEFAULT '',
                label           TEXT NOT NULL DEFAULT '',
                created_at      TEXT NOT NULL,
                activated_at    TEXT NOT NULL DEFAULT ''
            )
        """)

        # Migrate: add node_number column if missing
        try:
            async with db.execute("PRAGMA table_info(server_license)") as cur:
                sl_cols = [row[1] async for row in cur]
            if 'node_number' not in sl_cols:
                await db.execute("ALTER TABLE server_license ADD COLUMN node_number INTEGER DEFAULT NULL")
        except aiosqlite.OperationalError:
            pass

        # Terminals table — registry of activated terminals on this server.
        # Self-registered on POST /api/v1/licenses/activate; never seeded.
        await db.execute("""
            CREATE TABLE IF NOT EXISTS terminals (
                terminal_id     TEXT PRIMARY KEY,
                auth_key_hash   TEXT NOT NULL,
                activated_at    TEXT NOT NULL,
                is_active       INTEGER NOT NULL DEFAULT 1,
                name            TEXT NOT NULL DEFAULT '',
                ip_address      TEXT NOT NULL DEFAULT '',
                mac_address     TEXT NOT NULL DEFAULT '',
                role            TEXT NOT NULL DEFAULT 'server',
                is_hub          INTEGER NOT NULL DEFAULT 0
            )
        """)

        # Migrate: add columns if missing (existing DBs predate the
        # self-registration columns: name/ip_address/mac_address/role/is_hub).
        async with db.execute("PRAGMA table_info(terminals)") as cur:
            term_cols = [row[1] async for row in cur]
        if 'name' not in term_cols:
            await db.execute("ALTER TABLE terminals ADD COLUMN name TEXT NOT NULL DEFAULT ''")
        if 'ip_address' not in term_cols:
            await db.execute("ALTER TABLE terminals ADD COLUMN ip_address TEXT NOT NULL DEFAULT ''")
        if 'mac_address' not in term_cols:
            await db.execute("ALTER TABLE terminals ADD COLUMN mac_address TEXT NOT NULL DEFAULT ''")
        if 'role' not in term_cols:
            await db.execute("ALTER TABLE terminals ADD COLUMN role TEXT NOT NULL DEFAULT 'server'")
        if 'is_hub' not in term_cols:
            await db.execute("ALTER TABLE terminals ADD COLUMN is_hub INTEGER NOT NULL DEFAULT 0")
        # HARDWARE_ROUTING.md §2.2 — slot_id convention-FK to accounts.db
        # terminal_bindings.slot_id; populated by POST /v1/terminals/bind.
        if 'slot_id' not in term_cols:
            await db.execute("ALTER TABLE terminals ADD COLUMN slot_id TEXT DEFAULT ''")

        # HARDWARE_ROUTING.md §2.4 — time-based / day-of-week / redirect /
        # manual-override columns on printer_routing. Additive migration on
        # existing DBs so the routing-rule resolver (§3) can evaluate them.
        async with db.execute("PRAGMA table_info(printer_routing)") as cur:
            pr_cols = [row[1] async for row in cur]
        if 'time_from' not in pr_cols:
            await db.execute("ALTER TABLE printer_routing ADD COLUMN time_from TEXT NOT NULL DEFAULT ''")
        if 'time_to' not in pr_cols:
            await db.execute("ALTER TABLE printer_routing ADD COLUMN time_to TEXT NOT NULL DEFAULT ''")
        if 'days_of_week' not in pr_cols:
            await db.execute("ALTER TABLE printer_routing ADD COLUMN days_of_week TEXT NOT NULL DEFAULT '[]'")
        if 'redirect_to_mac' not in pr_cols:
            await db.execute("ALTER TABLE printer_routing ADD COLUMN redirect_to_mac TEXT NOT NULL DEFAULT ''")
        if 'override_active' not in pr_cols:
            await db.execute("ALTER TABLE printer_routing ADD COLUMN override_active INTEGER NOT NULL DEFAULT 0")
        if 'override_expires_at' not in pr_cols:
            await db.execute("ALTER TABLE printer_routing ADD COLUMN override_expires_at TEXT NOT NULL DEFAULT ''")

        await db.commit()

# ΓöÇΓöÇ Models ΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇ

class DeviceRecord(BaseModel):
    mac:  Optional[str] = None
    ip:   str
    type: str        # hardware: 'thermal' | 'impact' | 'card_reader' | 'terminal' (legacy: 'kitchen' | 'receipt')
    role: str = ''   # logical role: 'kitchen' | 'receipt' (empty = legacy type-only devices)
    name: str
    port: int = 9100
    register_id: str = ''  # SPIn Register ID for card readers
    tpn: str = ''          # SPIn Terminal Processing Number
    auth_key: str = ''     # SPIn Auth Key for card readers
    categories: str = ''   # Comma-separated category IDs for kitchen printers
    terminal_ids: list[str] = []  # Receipt printer → linked terminal IDs

    @field_validator('ip')
    @classmethod
    def validate_ip(cls, v):
        try:
            ipaddress.ip_address(v)
        except ValueError:
            raise ValueError(f'Invalid IP address: {v}')
        return v

    @field_validator('port')
    @classmethod
    def validate_port(cls, v):
        if not (0 <= v <= 65535):
            raise ValueError(f'Port must be 0-65535, got {v}')
        return v

class TestRequest(BaseModel):
    mac: str

class TestPrintRequest(BaseModel):
    ip:   str
    port: int = 9100

    @field_validator('ip')
    @classmethod
    def validate_ip(cls, v):
        try:
            ipaddress.ip_address(v)
        except ValueError:
            raise ValueError(f'Invalid IP address: {v}')
        return v

    @field_validator('port')
    @classmethod
    def validate_port(cls, v):
        if not (0 <= v <= 65535):
            raise ValueError(f'Port must be 0-65535, got {v}')
        return v

# ΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉ
#  NETWORK SCANNER ΓÇö ARP-first discovery
#
#  Instead of brute-forcing TCP on 254 hosts (slow, hammers WiFi), we:
#    1. Ping the broadcast address to wake up the ARP cache
#    2. Read `arp -a` to get only the live hosts (usually 3-10)
#    3. TCP probe just those hosts on our specific ports
#
#  This turns 254 ├ù 6 = 1,524 connections into ~5 ├ù 6 = 30.
# ΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉ

def _get_subnet_prefix() -> str:
    """Extract /24 prefix from settings.default_subnet, e.g. '10.0.0'.

    Validates the extracted prefix looks like 'X.X.X' (three numeric octets).
    Falls back to the machine's active outbound interface address if the
    configured subnet yields a malformed prefix (e.g. missing the last octet).
    """
    raw = settings.default_subnet
    base = raw.split('/')[0]
    candidate = base.rsplit('.', 1)[0]

    if re.match(r'^\d{1,3}\.\d{1,3}\.\d{1,3}$', candidate):
        return candidate

    logger.warning(
        f"[SCANNER] Configured subnet '{raw}' yielded malformed prefix "
        f"'{candidate}'; detecting active network interface"
    )
    try:
        # UDP trick: bind to a non-routable address just to resolve the
        # outbound interface — no packets are actually sent.
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        try:
            s.connect(('192.0.2.0', 1))  # TEST-NET, never actually routed
            my_ip = s.getsockname()[0]
        finally:
            s.close()
        derived = my_ip.rsplit('.', 1)[0]
        logger.info(f"[SCANNER] Derived subnet prefix from active interface: {derived!r}")
        return derived
    except Exception as e:
        logger.error(f"[SCANNER] Interface detection failed ({e}); using '10.0.0'")
        return '10.0.0'


def _ports_for_type(device_type: Optional[str]) -> list:
    """Return the port list to scan based on device type filter."""
    if device_type == 'card_reader':
        return CARD_READER_PORTS
    elif device_type in ('printer', 'kitchen', 'receipt'):
        return PRINTER_PORTS
    return ALL_SCAN_PORTS


# ΓöÇΓöÇ ARP discovery ΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇ

def _ping_broadcast(prefix: str) -> None:
    """
    Ping the broadcast address to populate the OS ARP cache.
    Works cross-platform: tries broadcast ping, then falls back to
    pinging a handful of common addresses.
    """
    broadcast = f"{prefix}.255"
    is_win = platform.system() == "Windows"

    # Try broadcast ping first
    try:
        if is_win:
            subprocess.run(
                ['ping', '-n', '1', '-w', str(PING_TIMEOUT * 1000), broadcast],
                timeout=PING_TIMEOUT + 1, capture_output=True,
            )
        else:
            subprocess.run(
                ['ping', '-c', '1', '-W', str(PING_TIMEOUT), '-b', broadcast],
                timeout=PING_TIMEOUT + 1, capture_output=True,
            )
    except Exception as e:
        logger.debug(f"[SCANNER] Broadcast ping to {broadcast} failed (non-fatal): {e}")


def _get_arp_hosts(prefix: str) -> List[dict]:
    """
    Read the OS ARP cache and return all live hosts on our subnet.
    Returns list of {'ip': str, 'mac': str}.

    Uses a compiled regex anchored to the full /24 IP pattern (^prefix\.\d{1,3}$)
    so a shortened or mismatched prefix cannot silently match hosts on a
    different subnet (the old startswith + dot-count check allowed this).
    """
    hosts = []
    # Anchored pattern: matches "prefix.N" exactly (N = 1–3 digit final octet)
    ip_re = re.compile(r'^' + re.escape(prefix) + r'\.\d{1,3}$')
    try:
        out = subprocess.check_output(
            ['arp', '-a'], timeout=3, stderr=subprocess.DEVNULL
        ).decode()
        logger.debug(
            f"[SCANNER] Raw ARP table (prefix={prefix!r}, "
            f"{len(out.splitlines())} lines):\n{out}"
        )
        for line in out.splitlines():
            # Fast pre-filter: skip lines that clearly don't mention our prefix
            if prefix not in line:
                continue
            parts = line.split()
            ip = None
            mac = None
            for part in parts:
                stripped = part.strip('()')
                # Anchored regex replaces the old startswith + dot-count heuristic
                if ip_re.match(stripped):
                    ip = stripped
                if _MAC_RE.match(part):
                    octets = part.replace('-', ':').upper().split(':')
                    mac = ':'.join(o.zfill(2) for o in octets)
            if ip and mac:
                # Skip broadcast and incomplete entries
                if mac in ('FF:FF:FF:FF:FF:FF', '00:00:00:00:00:00'):
                    continue
                hosts.append({'ip': ip, 'mac': mac})
    except Exception as e:
        logger.warning(f"[SCANNER] ARP cache read failed: {e}")

    logger.info(f"[SCANNER] ARP parse: {len(hosts)} host(s) matched prefix {prefix!r}")
    return hosts


def _get_mac(ip: str) -> Optional[str]:
    """Best-effort MAC from ARP cache for a single IP."""
    for cmd in (['arp', '-a', ip], ['arp', '-n', ip]):
        try:
            out = subprocess.check_output(
                cmd, timeout=2, stderr=subprocess.DEVNULL
            ).decode()
            for line in out.splitlines():
                if ip in line:
                    for part in line.split():
                        if _MAC_RE.match(part):
                            octets = part.replace('-', ':').upper().split(':')
                            return ':'.join(o.zfill(2) for o in octets)
        except Exception:
            continue
    return None


# ΓöÇΓöÇ Low-level probes ΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇ

def _tcp_probe(host: str, port: int, timeout: float) -> bool:
    """Attempt a TCP connect. Returns True if the port is open."""
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
            s.settimeout(timeout)
            s.connect((host, port))
            return True
    except Exception:
        return False


async def _probe_spin(ip: str, port: int) -> dict:
    """Probe a Dejavoo device via SPIn GET to auto-detect RegisterId and model."""
    xml = "<request><TransType>GetStatus</TransType><RegisterId></RegisterId></request>"
    encoded = urllib.parse.quote(xml, safe='')
    url = f"http://{ip}:{port}/spin/cgi.html?TerminalTransaction={encoded}"
    try:
        async with httpx.AsyncClient(timeout=3.0) as client:
            resp = await client.get(url)
            if resp.status_code == 200 and resp.text.strip():
                body = resp.text.strip()
                if "<xmp>" in body:
                    body = body.split("<xmp>", 1)[-1]
                if "</xmp>" in body:
                    body = body.split("</xmp>", 1)[0]
                body = urllib.parse.unquote(body.strip())
                root = ET.fromstring(body)
                return {
                    "register_id": root.findtext("RegisterId") or root.findtext("TerminalId") or "",
                    "serial":      root.findtext("SN") or root.findtext("SerialNo") or "",
                    "model":       root.findtext("Model") or "",
                    "status":      root.findtext("RespMSG") or root.findtext("Message") or "",
                }
    except Exception as e:
        logger.warning(f"[SCANNER] SPIn probe failed for {ip}:{port}: {e}")
    return {}


# ΓöÇΓöÇ Host probing ΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇ

async def _probe_host(ip: str, mac: Optional[str], ports: list, timeout: float) -> Optional[dict]:
    """
    Probe a known-live host on all given ports. Collects ALL open ports,
    then classifies the device from the full picture.
    """
    loop = asyncio.get_running_loop()

    async def _try_port(port: int) -> Optional[int]:
        try:
            hit = await asyncio.wait_for(
                loop.run_in_executor(None, _tcp_probe, ip, port, timeout),
                timeout=timeout + 0.2,
            )
            return port if hit else None
        except Exception:
            return None

    results = await asyncio.gather(*[_try_port(p) for p in ports])
    open_ports = [p for p in results if p is not None]

    if not open_ports:
        return None

    # Classify from complete picture — printer ports take priority
    printer_hits = [p for p in open_ports if p in PRINTER_PORTS]
    reader_hits  = [p for p in open_ports if p in CARD_READER_PORTS]

    if printer_hits:
        dtype = 'printer'
        best_port = printer_hits[0]
        name = 'Thermal Printer'
    elif reader_hits:
        dtype = 'card_reader'
        best_port = reader_hits[0]  # 9000 is first in CARD_READER_PORTS
        name = 'Card Reader'
    elif 8000 in open_ports:
        dtype = 'terminal'
        best_port = 8000
        name = 'KINDpos Terminal'
    else:
        return None

    # Resolve MAC if not provided by ARP discovery
    if not mac:
        await asyncio.sleep(0.05)
        mac = await loop.run_in_executor(None, _get_mac, ip)

    result = {
        'ip':   ip,
        'port': best_port,
        'mac':  mac or None,
        'type': dtype,
        'name': name,
    }

    # Auto-detect SPIn details for card readers
    if dtype == 'card_reader':
        spin = await _probe_spin(ip, best_port)
        if spin.get('register_id'):
            result['register_id'] = spin['register_id']
        if spin.get('model'):
            result['name'] = spin['model']
        elif spin.get('status'):
            result['name'] = 'Dejavoo'

    # Enrich KINDpos terminal name via health endpoint
    if dtype == 'terminal':
        try:
            async with httpx.AsyncClient(timeout=1.0) as client:
                health = None
                for path in ('/api/v1/health', '/health'):
                    try:
                        r = await client.get(f'http://{ip}:8000{path}')
                        if r.status_code == 200:
                            health = r.json()
                            break
                    except Exception:
                        continue
                if health:
                    label = health.get('version') or health.get('hostname')
                    if label:
                        result['name'] = f'KINDpos Terminal — {label}'
        except Exception:
            pass

    # Enrich printer name via web UI <title> tag (port 80)
    if dtype == 'printer' and 80 in open_ports:
        _GENERIC_TITLES = {'printer', 'embedded web server', ''}
        try:
            async with httpx.AsyncClient(timeout=1.0) as client:
                r = await client.get(f'http://{ip}/')
                if r.status_code == 200:
                    m = re.search(r'<title[^>]*>([^<]*)</title>', r.text, re.IGNORECASE)
                    if m:
                        title = m.group(1).strip()[:64]
                        if title.lower() not in _GENERIC_TITLES:
                            result['name'] = title
        except Exception:
            pass

    return result


# ΓöÇΓöÇ Scan endpoints ΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇ

@router.get("/scan/stream", dependencies=[Depends(require_manager)])
async def scan_network_stream(
    ip: Optional[str] = None,
    type: Optional[str] = None,
):
    """
    SSE streaming network scan. Two modes:

    Subnet sweep (default):
        1. Ping broadcast to populate ARP cache
        2. Read ARP table for live hosts on the subnet
        3. TCP probe only those hosts on device-specific ports
        Much faster and more reliable than brute-force scanning.

    Direct IP probe:
        ?ip=10.0.0.19           ΓåÆ single host
        ?ip=10.0.0.19,10.0.0.20 ΓåÆ multiple hosts (comma-separated)

    Optional: ?type=card_reader|printer to filter ports scanned.

    SSE event types:
        start    ΓÇö scan started, includes host count and mode
        device   ΓÇö a device was found
        complete ΓÇö sweep finished
        error    ΓÇö something went wrong
    """
    await _ensure_db()
    ports = _ports_for_type(type)

    # Determine mode: direct IPs vs subnet sweep
    if ip:
        direct_ips = []
        for addr in ip.split(','):
            addr = addr.strip()
            if addr:
                try:
                    ipaddress.ip_address(addr)
                    direct_ips.append(addr)
                except ValueError:
                    logger.warning(f"Skipping malformed IP address: {addr}")
        mode = 'direct'
    else:
        direct_ips = []
        mode = 'sweep'

    # Load saved devices for annotation
    async with aiosqlite.connect(HARDWARE_DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        async with db.execute("SELECT * FROM devices") as cur:
            saved = {row['mac']: dict(row) async for row in cur}

    def _sse(data: dict) -> str:
        return f"data: {json.dumps(data)}\n\n"

    def _annotate(device: dict) -> dict:
        if device['mac'] in saved:
            device['saved_name'] = saved[device['mac']]['name']
            device['saved_type'] = saved[device['mac']]['type']
        return device

    async def stream():
        loop = asyncio.get_running_loop()

        try:
            if mode == 'direct':
                # ΓöÇΓöÇ Direct IP probe ΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇ
                yield _sse({'type': 'start', 'total': len(direct_ips), 'mode': 'direct'})

                results = await asyncio.gather(
                    *[_probe_host(h, None, ports, DIRECT_TIMEOUT) for h in direct_ips]
                )
                for r in results:
                    if r is not None:
                        yield _sse({**_annotate(r), 'event': 'device'})

            else:
                # ΓöÇΓöÇ ARP-first subnet sweep ΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇ
                prefix = _get_subnet_prefix()

                # Step 1: Ping broadcast to populate ARP cache
                await loop.run_in_executor(None, _ping_broadcast, prefix)
                # Brief pause to let ARP entries settle
                await asyncio.sleep(0.5)

                # Step 2: Read ARP table for live hosts
                arp_hosts = await loop.run_in_executor(None, _get_arp_hosts, prefix)
                logger.info(
                    f"[SCANNER] ARP discovery returned {len(arp_hosts)} host(s) "
                    f"for prefix {prefix!r}"
                )

                # Step 2b: If ARP returned nothing, fall back to a parallel TCP
                # sweep of the full /24 on the primary printer port.  This is
                # slower (~254 × 0.5 s but parallelised) and yields hosts without
                # MACs, but prevents a silent empty scan when the ARP cache is
                # cold or the subnet prefix was corrected from a bad config value.
                if not arp_hosts:
                    yield _sse({
                        'type': 'diagnostic',
                        'message': (
                            f"ARP table empty for prefix {prefix} — "
                            "falling back to full /24 TCP sweep (this is slower)"
                        ),
                        'style': 'warning',
                    })
                    sweep_ips = [
                        str(h)
                        for h in ipaddress.ip_network(
                            f"{prefix}.0/24", strict=False
                        ).hosts()
                    ]
                    logger.info(
                        f"[SCANNER] TCP fallback: probing {len(sweep_ips)} hosts "
                        f"on port {PRINTER_PORTS[0]}"
                    )
                    alive_results = await asyncio.gather(
                        *[
                            asyncio.wait_for(
                                loop.run_in_executor(
                                    None, _tcp_probe, ip, PRINTER_PORTS[0], 0.5
                                ),
                                timeout=1.0,
                            )
                            for ip in sweep_ips
                        ],
                        return_exceptions=True,
                    )
                    arp_hosts = [
                        {'ip': ip, 'mac': None}
                        for ip, r in zip(sweep_ips, alive_results)
                        if r is True
                    ]
                    logger.info(
                        f"[SCANNER] TCP fallback found {len(arp_hosts)} "
                        "responsive host(s)"
                    )

                yield _sse({
                    'type': 'start',
                    'total': len(arp_hosts),
                    'mode': 'sweep',
                    'subnet': f"{prefix}.0/24",
                })

                # Still nothing after ARP + TCP fallback — emit an actionable error
                # so the GUI shows a reason rather than "0 devices found".
                if not arp_hosts:
                    yield _sse({
                        'type': 'error',
                        'message': (
                            f"No hosts found on {prefix}.0/24 — ARP table was "
                            "empty and the TCP sweep found no responsive devices. "
                            "Verify the server is on the same subnet as the printers."
                        ),
                    })
                    yield _sse({'type': 'complete'})
                    return

                # Step 3: TCP probe hosts in batches of 5, stream as found
                found_ips = set()
                batch_size = 5
                for i in range(0, len(arp_hosts), batch_size):
                    batch = arp_hosts[i:i + batch_size]
                    results = await asyncio.gather(
                        *[_probe_host(h['ip'], h['mac'], ports, PROBE_TIMEOUT)
                          for h in batch]
                    )
                    for r in results:
                        if r is not None:
                            found_ips.add(r['ip'])
                            yield _sse({**_annotate(r), 'event': 'device'})

                # Step 4: Probe saved device IPs not found in ARP sweep
                missed = [
                    s for s in saved.values()
                    if s['ip'] not in found_ips
                ]
                if missed:
                    missed_results = await asyncio.gather(
                        *[_probe_host(s['ip'], s['mac'], ports, PROBE_TIMEOUT)
                          for s in missed]
                    )
                    for r in missed_results:
                        if r is not None:
                            yield _sse({**_annotate(r), 'event': 'device'})

            yield _sse({'type': 'complete'})

        except Exception as e:
            logger.error(f"Scan stream error: {e}")
            yield _sse({'type': 'error', 'message': str(e)})

    return StreamingResponse(
        stream(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


# ΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉ
#  DEVICE CRUD
# ΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉ

def _decode_terminal_ids(raw) -> list:
    try:
        parsed = json.loads(raw or '[]')
        return parsed if isinstance(parsed, list) else []
    except Exception:
        return []


@router.get("/devices", dependencies=[Depends(require_manager)])
async def list_devices():
    """Return all active saved devices from hardware_config.db.

    Soft-deleted rows (is_active = 0) are filtered out so listings
    reflect operational reality, not history.
    """
    await _ensure_db()
    async with aiosqlite.connect(HARDWARE_DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        async with db.execute(
            "SELECT * FROM devices WHERE is_active = 1 ORDER BY saved_at"
        ) as cur:
            rows = []
            async for row in cur:
                d = dict(row)
                d['terminal_ids'] = _decode_terminal_ids(d.get('terminal_ids', '[]'))
                rows.append(d)
            return rows


def _parse_categories(raw: str) -> list[str]:
    return [c.strip() for c in (raw or "").split(",") if c.strip()]


@router.post("/devices", dependencies=[Depends(require_manager)])
async def save_device(
    device: DeviceRecord,
    ledger: EventLedger = Depends(get_ledger),
):
    """Insert or update a device by MAC address.

    If mac is absent, attempts ARP resolution before saving.
    Rejects with 409 if MAC cannot be resolved — never persists a null MAC.

    Emits a ledger event after the DB write: printer.configured on a
    brand-new MAC, or printer.assignment_changed when an existing
    kitchen printer's category list changes. Card readers only ever
    emit printer.configured (they don't carry categories).
    """
    await _ensure_db()

    # Resolve MAC if not supplied
    resolved_mac = device.mac.upper() if device.mac else None
    if not resolved_mac:
        loop = asyncio.get_running_loop()
        resolved_mac = await loop.run_in_executor(None, _get_mac, device.ip)
        if resolved_mac:
            resolved_mac = resolved_mac.upper()

    if not resolved_mac:
        raise HTTPException(
            status_code=409,
            detail={
                "error": "mac_unresolvable",
                "message": f"Could not resolve MAC for {device.ip}. Is the device still online?",
            },
        )

    mac = resolved_mac
    now = datetime.utcnow().isoformat()

    # role='kitchen' with no categories → default to routing all items
    effective_categories = device.categories
    if device.role == 'kitchen' and not device.categories.strip():
        effective_categories = 'ALL'

    # terminal_ids apply to receipt role (new) or legacy receipt type
    is_receipt = device.role == 'receipt' or (not device.role and device.type == 'receipt')
    terminal_ids_json = json.dumps(device.terminal_ids if is_receipt else [])

    async with aiosqlite.connect(HARDWARE_DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        async with db.execute(
            "SELECT categories FROM devices WHERE mac = ?", (mac,)
        ) as cur:
            existing = await cur.fetchone()
        previous_categories = _parse_categories(existing["categories"]) if existing else []

        await db.execute("""
            INSERT INTO devices (mac, ip, type, name, port, register_id, tpn, auth_key, categories, terminal_ids, role, saved_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(mac) DO UPDATE SET
                ip           = excluded.ip,
                type         = excluded.type,
                name         = excluded.name,
                port         = excluded.port,
                register_id  = excluded.register_id,
                tpn          = excluded.tpn,
                auth_key     = excluded.auth_key,
                categories   = excluded.categories,
                terminal_ids = excluded.terminal_ids,
                role         = excluded.role,
                saved_at     = excluded.saved_at
        """, (mac, device.ip, device.type,
              device.name, device.port, device.register_id, device.tpn, device.auth_key,
              effective_categories, terminal_ids_json, device.role, now))

        # Kitchen printers get a catch-all routing rule so the dispatcher
        # knows to send every order item to this printer.
        if device.role == 'kitchen':
            await db.execute(
                "DELETE FROM printer_routing WHERE printer_mac = ? AND rule_type = 'all'",
                (mac,)
            )
            await db.execute("""
                INSERT INTO printer_routing
                    (printer_mac, rule_type, category_id, item_tag, priority, is_active, created_at)
                VALUES (?, 'all', '', '', 0, 1, ?)
            """, (mac, now))

        await db.commit()

    # Reload PrinterManager if this is a printer device
    if device.role in ('kitchen', 'receipt') or device.type in ('thermal', 'impact'):
        try:
            from app.main import _init_printer_manager
            manager = await _init_printer_manager(ledger)
            logger.info(f"PrinterManager reloaded ({len(manager._printers)} printers)")
        except Exception as e:
            logger.error(f"Failed to reload PrinterManager: {e}")

    new_categories = _parse_categories(effective_categories)
    events = []
    if existing is None:
        # Card readers land under the payment.processor_configured audit
        # (PCI/SOX), printers under printer.configured.
        if device.type == "card_reader":
            events.append(payment_processor_configured(
                terminal_id=settings.terminal_id,
                mac=mac,
                ip=device.ip,
                name=device.name,
                register_id=device.register_id,
            ))
        else:
            events.append(printer_configured(
                terminal_id=settings.terminal_id,
                mac=mac,
                ip=device.ip,
                printer_type=device.type,
                name=device.name,
                categories=new_categories or None,
            ))
    elif new_categories != previous_categories:
        events.append(printer_assignment_changed(
            terminal_id=settings.terminal_id,
            mac=mac,
            previous_categories=previous_categories,
            new_categories=new_categories,
        ))
    if events:
        await ledger.append_batch(events) if len(events) > 1 else await ledger.append(events[0])

    return {
        **device.model_dump(),
        'mac': mac,
        'categories': effective_categories,
        'role': device.role,
        'terminal_ids': device.terminal_ids if is_receipt else [],
        'saved_at': now,
    }


@router.delete("/devices/{mac}", dependencies=[Depends(require_manager)])
async def delete_device(
    mac: str,
    ledger: EventLedger = Depends(get_ledger),
):
    """Remove a saved device by MAC. Emits printer.removed with the
    device's pre-delete name/type so the audit record survives the
    DB row disappearing."""
    await _ensure_db()
    mac = mac.upper()
    async with aiosqlite.connect(HARDWARE_DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        async with db.execute(
            "SELECT name, type FROM devices WHERE mac = ?", (mac,)
        ) as cur:
            existing = await cur.fetchone()
        await db.execute("DELETE FROM devices WHERE mac = ?", (mac,))
        await db.commit()

    if existing is not None:
        await ledger.append(printer_removed(
            terminal_id=settings.terminal_id,
            mac=mac,
            name=existing["name"],
            printer_type=existing["type"],
        ))
    return {"deleted": mac}


@router.get("/terminals", dependencies=[Depends(require_manager)])
async def list_terminals():
    """Return all active terminals from hardware_config.db.

    Read-only registry. Rows are written only by the activation flow
    (POST /api/v1/licenses/activate); there is no manual registration
    endpoint by design — terminals self-register on license activation.
    """
    await _ensure_db()
    async with aiosqlite.connect(HARDWARE_DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        async with db.execute(
            "SELECT terminal_id, name, ip_address, mac_address, role, "
            "is_hub, is_active, activated_at FROM terminals "
            "WHERE is_active = 1 ORDER BY activated_at"
        ) as cur:
            rows = []
            async for row in cur:
                d = dict(row)
                d['is_hub'] = bool(d['is_hub'])
                d['is_active'] = bool(d['is_active'])
                rows.append(d)
            return rows


@router.get("/routing", dependencies=[Depends(require_manager)])
async def list_routing_rules():
    """Return all active printer routing rules, grouped by printer_mac."""
    await _ensure_db()
    async with aiosqlite.connect(HARDWARE_DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        async with db.execute(
            "SELECT * FROM printer_routing WHERE is_active = 1 ORDER BY priority"
        ) as cur:
            return [dict(row) async for row in cur]


@router.get("/kitchen-printers", dependencies=[Depends(require_manager)])
async def list_kitchen_printers():
    """Return kitchen printers with their assigned categories."""
    await _ensure_db()
    async with aiosqlite.connect(HARDWARE_DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        async with db.execute(
            "SELECT * FROM devices WHERE type = 'kitchen' ORDER BY saved_at"
        ) as cur:
            printers = []
            async for row in cur:
                d = dict(row)
                cats = d.get('categories', '')
                d['categories_list'] = [c.strip() for c in cats.split(',') if c.strip()] if cats else []
                printers.append(d)
            return printers


# ΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉ
#  TEST (by MAC ΓÇö resolves IP from DB)
# ΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉ

@router.post("/test", dependencies=[Depends(require_manager)])
async def test_device(req: TestRequest):
    """Test connectivity to a saved device by MAC address."""
    await _ensure_db()
    mac = req.mac.upper()
    async with aiosqlite.connect(HARDWARE_DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        async with db.execute(
            "SELECT * FROM devices WHERE mac = ?", (mac,)
        ) as cur:
            row = await cur.fetchone()

    if not row:
        return {"success": False, "message": f"Device {mac} not saved"}

    dev = dict(row)
    reachable = await asyncio.get_running_loop().run_in_executor(
        None, _tcp_probe, dev['ip'], dev['port'], DIRECT_TIMEOUT
    )
    return {
        "success": reachable,
        "mac": mac,
        "ip": dev['ip'],
        "port": dev['port'],
        "message": "Device reachable" if reachable
                   else f"Cannot connect to {dev['ip']}:{dev['port']}",
    }

# ΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉ
#  TEST PRINT (direct IP ΓÇö used from settings scene device editor)
# ΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉ

@router.post("/test-print", dependencies=[Depends(require_manager)])
async def test_print(request: TestPrintRequest):
    """Send a KINDpos test receipt via raw ESC/POS over TCP."""
    ESC = b'\x1b'; GS = b'\x1d'
    now = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    receipt = bytearray()
    receipt += ESC + b'\x40'                  # init
    receipt += ESC + b'\x61\x01'              # center
    receipt += b'================================\n'
    receipt += ESC + b'\x21\x20' + ESC + b'\x45\x01'
    receipt += b'K I N D p o s\n'
    receipt += ESC + b'\x21\x00' + ESC + b'\x45\x00'
    receipt += b'Nice. Dependable. Yours.\n'
    receipt += b'================================\n\n'
    receipt += ESC + b'\x45\x01' + ESC + b'\x21\x20'
    receipt += b'*** TEST PRINT ***\n'
    receipt += ESC + b'\x21\x00' + ESC + b'\x45\x00' + b'\n'
    receipt += ESC + b'\x61\x00'              # left
    receipt += f'  IP:   {request.ip}\n'.encode()
    receipt += f'  Port: {request.port}\n'.encode()
    receipt += f'  Date: {now}\n'.encode()
    receipt += b'\n' + ESC + b'\x61\x01'
    receipt += b'If you can read this,\nyour printer is ready.\n\n'
    receipt += b'================================\n'
    receipt += ESC + b'\x45\x01' + b'KIND Technologies\n' + ESC + b'\x45\x00'
    receipt += b'================================\n'
    receipt += ESC + b'\x64\x03'              # feed
    receipt += GS  + b'\x56\x00'              # cut

    try:
        loop = asyncio.get_running_loop()
        await loop.run_in_executor(
            None, _send_raw, request.ip, request.port, bytes(receipt)
        )
        return {"success": True,
                "message": f"Test print sent to {request.ip}:{request.port}",
                "timestamp": now}
    except socket.timeout:
        return {"success": False,
                "message": f"Timed out ΓÇö {request.ip}:{request.port} not responding"}
    except ConnectionRefusedError:
        return {"success": False,
                "message": f"Refused ΓÇö {request.ip}:{request.port}"}
    except Exception as e:
        return {"success": False, "message": f"Print failed: {e}"}


def _send_raw(ip: str, port: int, data: bytes):
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.settimeout(5.0)
        s.connect((ip, port))
        s.sendall(data)


@router.get("/status", dependencies=[Depends(require_manager)])
async def hardware_status():
    return {
        "status": "online",
        "db_path": HARDWARE_DB_PATH,
        "default_subnet": settings.default_subnet,
        "endpoints": [
            "/api/v1/hardware/scan/stream",
            "/api/v1/hardware/devices",
            "/api/v1/hardware/test",
            "/api/v1/hardware/test-print",
            "/api/v1/hardware/test-connection",
            "/api/v1/hardware/status",
        ],
    }


class ProbeRequest(BaseModel):
    ip: str
    port: int = 9100

    @field_validator('ip')
    @classmethod
    def validate_ip(cls, v):
        try:
            ipaddress.ip_address(v)
        except ValueError:
            raise ValueError(f'Invalid IP address: {v}')
        return v

    @field_validator('port')
    @classmethod
    def validate_port(cls, v):
        if not (0 <= v <= 65535):
            raise ValueError(f'Port must be 0-65535, got {v}')
        return v


@router.post("/probe", dependencies=[Depends(require_manager)])
async def probe_device(req: ProbeRequest):
    """Probe a specific IP:port, identify device type, model, and MAC."""
    ports_to_try = list(dict.fromkeys([req.port] + ALL_SCAN_PORTS))
    result = await _probe_host(req.ip, None, ports_to_try, DIRECT_TIMEOUT)
    if not result:
        return {"found": False}

    protocol_map = {
        9100: "TM", 9101: "TM", 9102: "TM",
        9000: "SPIn", 8443: "SPIn", 9443: "SPIn",
    }
    return {
        "found": True,
        "model": result.get("name", "Unknown Device"),
        "mac": result.get("mac", ""),
        "protocol": protocol_map.get(result.get("port"), "Unknown"),
        "type": result.get("type", ""),
        "port": result.get("port", req.port),
        "ip": req.ip,
    }


class TestConnectionRequest(BaseModel):
    ip: str
    port: int
    timeout: float = 2.0

    @field_validator('ip')
    @classmethod
    def validate_ip(cls, v):
        try:
            ipaddress.ip_address(v)
        except ValueError:
            raise ValueError(f'Invalid IP address: {v}')
        return v

    @field_validator('port')
    @classmethod
    def validate_port(cls, v):
        if not (0 <= v <= 65535):
            raise ValueError(f'Port must be 0-65535, got {v}')
        return v


@router.post("/test-connection", dependencies=[Depends(require_manager)])
async def test_connection(req: TestConnectionRequest):
    """Test raw TCP connectivity to an IP:port."""
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
            s.settimeout(req.timeout)
            s.connect((req.ip, req.port))
        status = "online"
    except (socket.timeout, ConnectionRefusedError, OSError):
        status = "unreachable"
    return {"ip": req.ip, "port": req.port, "status": status}


# ╔═══════════════════════════════════════════════════════════════════════╗
#  SERVER LICENSE — generate / activate / list / revoke
#
#  KIND-XXXX-XXXX activation codes bind to a single server's MAC. The
#  ledger gets a server.activated audit anchor so we can prove which
#  physical box was licensed at what time, without trusting the local DB.
# ╚═══════════════════════════════════════════════════════════════════════╝

_PLATFORMS = {"windows", "pi"}


class ActivateServerRequest(BaseModel):
    activation_code: str
    server_mac: str
    platform: str

    @field_validator('platform')
    @classmethod
    def validate_platform(cls, v):
        if v not in _PLATFORMS:
            raise ValueError(f"platform must be one of {sorted(_PLATFORMS)}")
        return v


# License generation has been removed from the customer-facing application.
# Activation codes are issued exclusively from kindpos.com/admin (vendor side).
# This server only consumes a code via POST /api/v1/hardware/activate.


@router.post("/activate")
async def activate_server(
    req: ActivateServerRequest,
    ledger: EventLedger = Depends(get_ledger),
):
    """Bind a pending activation code to this server's MAC.

    Intentionally unauthenticated: this is the gate that runs *before*
    the operator has any way to log in. Each code is single-use; once
    flipped to active it cannot be re-bound to a different MAC.

    INSTALLER NOTE: This call may take up to 75 seconds on slow networks.
    The installer UI should show "Contacting activation server..."
    during this wait. See kindpos_installer.py for UI integration point.
    """
    await _ensure_db()
    code = req.activation_code.strip().upper()
    server_mac = req.server_mac.strip().upper()
    now = datetime.utcnow().isoformat()

    node_number = None
    terminal_id = None

    # ─────────────────────────────────────────────────────────────
    # STEP 2: External activation call to KINDpos-site
    # ─────────────────────────────────────────────────────────────
    activation_server_url = settings.activation_server_url
    external_success = False
    offline_fallback = False

    for attempt in range(2):
        try:
            timeout = httpx.Timeout(connect=15.0, read=30.0)
            async with httpx.AsyncClient(timeout=timeout) as client:
                resp = await client.post(
                    f"{activation_server_url}/api/activate",
                    json={
                        "license_key": code,
                        "hardware_fingerprint": server_mac,
                    }
                )

            # CASE A: Success (key PENDING → ACTIVATED)
            if resp.status_code == 200:
                try:
                    data = resp.json()
                    node_number = int(data.get("node_number"))
                    terminal_id = f"T-{str(node_number).zfill(2)}"
                    logger.info(f"Activated via KINDpos-site as {terminal_id}")
                    external_success = True
                    break
                except (ValueError, TypeError, KeyError):
                    logger.warning(f"Invalid node_number in KINDpos-site response: {resp.text}")
                    raise HTTPException(
                        status_code=503,
                        detail="Activation server returned invalid response",
                    )

            # CASE B: Already activated on THIS hardware
            if resp.status_code == 409:
                try:
                    data = resp.json()
                    if data.get("error") == "already_activated":
                        node_number = int(data.get("node_number"))
                        terminal_id = f"T-{str(node_number).zfill(2)}"
                        logger.info(f"Re-activation of existing terminal {terminal_id}")
                        external_success = True
                        break
                except (ValueError, TypeError, KeyError):
                    logger.warning(f"Invalid node_number in already_activated response: {resp.text}")

            # CASE C: Already activated on DIFFERENT hardware
            if resp.status_code == 409 and "already registered to another terminal" in resp.text:
                raise HTTPException(
                    status_code=409,
                    detail="This license key is already registered to another terminal. Contact KIND Technologies to transfer or reissue.",
                )

            # CASE D: Key not found / revoked
            if resp.status_code == 404:
                raise HTTPException(
                    status_code=404,
                    detail="License key not recognized. Check the key and try again.",
                )

        except (httpx.TimeoutException, httpx.ConnectError, httpx.NetworkError) as e:
            if attempt < 1:
                logger.warning(f"Activation server unreachable (attempt {attempt + 1}/2): {e}")
                await asyncio.sleep(5)
                continue
            else:
                logger.warning(f"KINDpos-site unreachable after retries, checking local registry")
                offline_fallback = True

    # ─────────────────────────────────────────────────────────────
    # CASE E: Network failure — fall back to local registry
    # ─────────────────────────────────────────────────────────────
    if not external_success and offline_fallback:
        async with aiosqlite.connect(HARDWARE_DB_PATH) as db:
            db.row_factory = aiosqlite.Row
            async with db.execute(
                "SELECT * FROM server_license WHERE activation_code = ?",
                (code,),
            ) as cur:
                row = await cur.fetchone()

            if row and row["status"] == "active" and row["node_number"]:
                try:
                    node_number = int(row["node_number"])
                    terminal_id = f"T-{str(node_number).zfill(2)}"
                    logger.warning(f"Offline activation approved from local registry")
                    external_success = True
                except (ValueError, TypeError):
                    pass

    if not external_success:
        if offline_fallback:
            raise HTTPException(
                status_code=503,
                detail="Cannot reach activation server and no local record found. Ensure internet connectivity during first activation, or contact KIND Technologies for offline registration.",
            )
        else:
            raise HTTPException(
                status_code=500,
                detail="Activation server connection failed",
            )

    # ─────────────────────────────────────────────────────────────
    # STEP 3: Local registration (regardless of how we got node_number)
    # ─────────────────────────────────────────────────────────────
    async with aiosqlite.connect(HARDWARE_DB_PATH) as db:
        db.row_factory = aiosqlite.Row

        # Fetch original row for label/store_id if available
        async with db.execute(
            "SELECT * FROM server_license WHERE activation_code = ?",
            (code,),
        ) as cur:
            row = await cur.fetchone()

        label = (row["label"] or "") if row else ""
        store_id = (row["store_id"] or "") if row else ""

        # Write to server_license with node_number
        await db.execute(
            """
            INSERT OR REPLACE INTO server_license
                (activation_code, server_mac, platform, status,
                 store_id, label, created_at, activated_at, node_number)
            VALUES (?, ?, ?, 'active', ?, ?, ?, ?, ?)
            """,
            (code, server_mac, req.platform, store_id, label,
             (row["created_at"] if row else now), now, node_number),
        )
        await db.commit()

    # Write to terminals table
    auth_key_hash = hashlib.sha256(code.encode()).hexdigest()
    async with aiosqlite.connect(HARDWARE_DB_PATH) as db:
        await db.execute("""
            INSERT INTO terminals (terminal_id, auth_key_hash, activated_at, is_active)
            VALUES (?, ?, ?, 1)
            ON CONFLICT(terminal_id) DO UPDATE SET
                auth_key_hash = excluded.auth_key_hash,
                activated_at = excluded.activated_at,
                is_active = 1
        """, (terminal_id, auth_key_hash, now))

        # Auto-assign unassigned devices to this terminal
        await db.execute("""
            UPDATE devices
            SET terminal_ids = ?
            WHERE (terminal_ids IS NULL OR terminal_ids = '' OR terminal_ids = '[]')
            AND is_active = 1
        """, (f'["{terminal_id}"]',))

        await db.commit()

    await ledger.append(server_activated(
        terminal_id=terminal_id,
        activation_code=code,
        server_mac=server_mac,
        platform=req.platform,
        label=label,
    ))

    return {
        "success": True,
        "terminal_id": terminal_id,
        "node_number": node_number,
        "message": "Terminal activated successfully",
    }


@router.get("/license/list")
async def list_licenses():
    """All license records, newest first.

    Unauthenticated so the terminal boot probe can decide whether the
    server has ever been activated before any login flow exists.
    """
    await _ensure_db()
    async with aiosqlite.connect(HARDWARE_DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        async with db.execute(
            "SELECT * FROM server_license ORDER BY created_at DESC"
        ) as cur:
            return [dict(row) async for row in cur]


@router.delete("/license/{activation_code}", dependencies=[Depends(require_manager)])
async def revoke_license(activation_code: str):
    """Soft-revoke a license. Active rows stay visible but unusable."""
    await _ensure_db()
    code = activation_code.strip().upper()
    async with aiosqlite.connect(HARDWARE_DB_PATH) as db:
        async with db.execute(
            "SELECT 1 FROM server_license WHERE activation_code = ?", (code,)
        ) as cur:
            if await cur.fetchone() is None:
                raise HTTPException(status_code=404, detail="License not found")
        await db.execute(
            "UPDATE server_license SET status = 'revoked' WHERE activation_code = ?",
            (code,),
        )
        await db.commit()
    return {"revoked": code}


@router.get("/server-mac")
async def get_server_mac():
    """Return this server's primary MAC address.

    Pi: prefer /sys/class/net/eth0/address, fall back to wlan0, then to
    Python's uuid.getnode(). Windows/dev hosts: just uuid.getnode().
    """
    for iface in ("eth0", "wlan0"):
        path = f"/sys/class/net/{iface}/address"
        try:
            if os.path.exists(path):
                with open(path, "r") as f:
                    raw = f.read().strip()
                if raw:
                    return {"mac": raw.upper()}
        except Exception as e:  # pragma: no cover — sysfs read failure
            logger.debug(f"Could not read {path}: {e}")

    node = uuid.getnode()
    mac = ":".join(f"{(node >> i) & 0xFF:02X}" for i in range(40, -8, -8))
    return {"mac": mac}
