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
                id                   INTEGER PRIMARY KEY,
                license_key          TEXT NOT NULL,
                hardware_fingerprint TEXT NOT NULL,
                activated_at         TEXT NOT NULL,
                status               TEXT NOT NULL DEFAULT 'active'
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

    # Dedup by IP — a multi-homed Pi (eth0 + wlan0) lists the same neighbor
    # once per interface, which would otherwise yield N identical probe results.
    seen_ips = set()
    deduped = []
    for h in hosts:
        if h['ip'] not in seen_ips:
            seen_ips.add(h['ip'])
            deduped.append(h)
    hosts = deduped

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

                # Step 3b: Supplemental TCP sweep of the rest of the /24 on
                # PRINTER_PORTS only. Many thermal printers ignore broadcast
                # ICMP so they never appear in ARP — without this pass, the
                # ARP-success path silently drops them.
                arp_ips = {h['ip'] for h in arp_hosts}
                remaining_ips = [
                    str(h) for h in ipaddress.ip_network(
                        f"{prefix}.0/24", strict=False
                    ).hosts()
                    if str(h) not in arp_ips and str(h) not in found_ips
                ]
                if remaining_ips:
                    supplemental = await asyncio.gather(
                        *[_probe_host(ip, None, PRINTER_PORTS, 0.5)
                          for ip in remaining_ips],
                        return_exceptions=True,
                    )
                    for r in supplemental:
                        if isinstance(r, dict):
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


@router.get("/devices/health", dependencies=[Depends(require_manager)])
async def devices_health():
    """Live reachability for all saved devices.

    Parallel-probes each device's stored IP:port with a 1.5s TCP
    connect. The whole gather is bounded by a 2.0s hard cap; any
    probe that misses the budget is reported online=False rather
    than blocking the response.
    """
    await _ensure_db()
    async with aiosqlite.connect(HARDWARE_DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        async with db.execute(
            "SELECT mac, ip, port, role, name FROM devices WHERE is_active = 1"
        ) as cur:
            rows = [dict(r) async for r in cur]

    if not rows:
        return []

    loop = asyncio.get_running_loop()
    probes = [
        loop.run_in_executor(None, _tcp_probe, r['ip'], r['port'], 1.5)
        for r in rows
    ]
    try:
        results = await asyncio.wait_for(
            asyncio.gather(*probes, return_exceptions=True),
            timeout=2.0,
        )
    except asyncio.TimeoutError:
        results = [False] * len(rows)

    return [
        {
            'mac':    r['mac'],
            'ip':     r['ip'],
            'port':   r['port'],
            'role':   r['role'],
            'name':   r['name'],
            'online': bool(res) if not isinstance(res, BaseException) else False,
        }
        for r, res in zip(rows, results)
    ]


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

    VALID_ROLES = {'kitchen', 'receipt', 'card_reader', ''}
    if device.role not in VALID_ROLES:
        raise HTTPException(
            status_code=422,
            detail={
                "error": "invalid_role",
                "message": "Role must be one of: kitchen, receipt, card_reader"
            }
        )

    if os.environ.get("KINDPOS_PROBE_ON_SAVE", "true").lower() == "true":
        probe_result = await _probe_host(
            device.ip, resolved_mac,
            PRINTER_PORTS + CARD_READER_PORTS,
            DIRECT_TIMEOUT
        )
        if not probe_result:
            raise HTTPException(
                status_code=422,
                detail={
                    "error": "device_unreachable",
                    "message": f"Could not reach {device.ip} — verify IP before saving"
                }
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

        async with db.execute("BEGIN"):
            pass
        try:
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

            # Clear stale routing rows for ALL roles — prevents orphan rules
            # when a kitchen printer is re-roled to receipt or card_reader.
            await db.execute(
                "DELETE FROM printer_routing WHERE printer_mac = ?", (mac,)
            )

            # Kitchen printers get exactly one catch-all routing rule.
            if device.role == 'kitchen':
                await db.execute("""
                    INSERT INTO printer_routing
                        (printer_mac, rule_type, category_id, item_tag, priority, is_active, created_at)
                    VALUES (?, 'all', '', '', 0, 1, ?)
                """, (mac, now))

            await db.execute("COMMIT")
        except Exception:
            await db.execute("ROLLBACK")
            raise HTTPException(
                status_code=500,
                detail={
                    "error": "save_failed",
                    "message": "Device save rolled back — no changes were made"
                }
            )

    # Reload PrinterManager if this is a printer device
    if device.role in ('kitchen', 'receipt') or device.type in ('thermal', 'impact'):
        try:
            from app.main import _init_printer_manager
            manager = await _init_printer_manager(ledger)
            logger.info(f"PrinterManager reloaded ({len(manager._printers)} printers)")
        except Exception as e:
            logger.error(f"Failed to reload PrinterManager: {e}")

    # HARDWARE_ROUTING.md §4 — refresh PaymentManager when a card reader
    # row changes so the new terminal_ids assignment takes effect without
    # restarting the process. _ensure_devices is incremental (adds entries
    # on top of the existing map); flipping the guard is enough to make
    # it re-read the DB on the next call.
    if device.role == 'card_reader' or device.type == 'card_reader':
        try:
            from app.api.routes import payment_routes
            payment_routes._devices_initialized = False
            pm = payment_routes.get_payment_manager(ledger)
            await payment_routes._ensure_devices(pm)
        except Exception as e:
            logger.error(f"Failed to reload PaymentManager: {e}")

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


# ── printer_routing CRUD (HARDWARE_ROUTING.md §3) ───────────────────────
#
# The §2.4 schema migration adds time / day / redirect / override
# columns to `printer_routing` but provides no writer beyond the
# catch-all row that `POST /devices` plants for new kitchen printers.
# These four endpoints let the Overseer UI build category rules, time
# windows, redirects, and manual overrides — what the resolver in
# `app/services/routing_resolver.py` evaluates at print time.

class CreateRoutingRuleRequest(BaseModel):
    printer_mac: str
    rule_type: str = "all"
    category_id: str = ""
    item_tag: str = ""
    priority: int = 0
    time_from: str = ""
    time_to: str = ""
    days_of_week: str = "[]"
    redirect_to_mac: str = ""
    override_active: int = 0
    override_expires_at: str = ""


class UpdateRoutingRuleRequest(BaseModel):
    rule_type: Optional[str] = None
    category_id: Optional[str] = None
    item_tag: Optional[str] = None
    priority: Optional[int] = None
    time_from: Optional[str] = None
    time_to: Optional[str] = None
    days_of_week: Optional[str] = None
    redirect_to_mac: Optional[str] = None
    override_active: Optional[int] = None
    override_expires_at: Optional[str] = None


class RoutingOverrideRequest(BaseModel):
    active: bool
    expires_at: Optional[str] = None


async def _select_routing_row(db, rule_id: int) -> Optional[dict]:
    """Read one routing row by id. Returns None if absent."""
    async with db.execute(
        "SELECT * FROM printer_routing WHERE id = ?", (rule_id,)
    ) as cur:
        row = await cur.fetchone()
    return dict(row) if row else None


@router.post("/routing", dependencies=[Depends(require_manager)])
async def create_routing_rule(req: CreateRoutingRuleRequest):
    """Insert a new printer_routing row and return it."""
    await _ensure_db()
    now = datetime.utcnow().isoformat()
    async with aiosqlite.connect(HARDWARE_DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        cursor = await db.execute(
            """
            INSERT INTO printer_routing
                (printer_mac, rule_type, category_id, item_tag, priority,
                 time_from, time_to, days_of_week, redirect_to_mac,
                 override_active, override_expires_at, is_active, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)
            """,
            (
                req.printer_mac, req.rule_type, req.category_id, req.item_tag,
                req.priority, req.time_from, req.time_to, req.days_of_week,
                req.redirect_to_mac, req.override_active, req.override_expires_at,
                now,
            ),
        )
        rule_id = cursor.lastrowid
        await db.commit()
        return await _select_routing_row(db, rule_id)


@router.put("/routing/{rule_id}", dependencies=[Depends(require_manager)])
async def update_routing_rule(rule_id: int, req: UpdateRoutingRuleRequest):
    """Patch an existing rule. Only fields present in the body are
    updated. 404 if the rule_id doesn't exist."""
    await _ensure_db()
    fields = req.model_dump(exclude_unset=True)
    if not fields:
        # Nothing to update — just return the current row.
        async with aiosqlite.connect(HARDWARE_DB_PATH) as db:
            db.row_factory = aiosqlite.Row
            row = await _select_routing_row(db, rule_id)
        if row is None:
            raise HTTPException(status_code=404, detail="routing rule not found")
        return row

    set_clause = ", ".join(f"{k} = ?" for k in fields)
    values = list(fields.values()) + [rule_id]
    async with aiosqlite.connect(HARDWARE_DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        cursor = await db.execute(
            f"UPDATE printer_routing SET {set_clause} WHERE id = ?", values
        )
        if cursor.rowcount == 0:
            raise HTTPException(status_code=404, detail="routing rule not found")
        await db.commit()
        return await _select_routing_row(db, rule_id)


@router.delete("/routing/{rule_id}", status_code=204, dependencies=[Depends(require_manager)])
async def delete_routing_rule(rule_id: int):
    """Soft-delete (is_active=0). The row stays visible to audits."""
    await _ensure_db()
    async with aiosqlite.connect(HARDWARE_DB_PATH) as db:
        cursor = await db.execute(
            "UPDATE printer_routing SET is_active = 0 WHERE id = ?", (rule_id,)
        )
        if cursor.rowcount == 0:
            raise HTTPException(status_code=404, detail="routing rule not found")
        await db.commit()
    # 204 No Content


@router.post("/routing/{rule_id}/override", dependencies=[Depends(require_manager)])
async def set_routing_override(rule_id: int, req: RoutingOverrideRequest):
    """Set or clear the manual override on a routing rule. With
    `active=true`, the resolver elevates this rule above any
    time/day/category match until `expires_at` (optional)."""
    await _ensure_db()
    async with aiosqlite.connect(HARDWARE_DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        if req.active:
            cursor = await db.execute(
                """
                UPDATE printer_routing
                   SET override_active = 1,
                       override_expires_at = ?
                 WHERE id = ?
                """,
                (req.expires_at or "", rule_id),
            )
        else:
            cursor = await db.execute(
                """
                UPDATE printer_routing
                   SET override_active = 0,
                       override_expires_at = ''
                 WHERE id = ?
                """,
                (rule_id,),
            )
        if cursor.rowcount == 0:
            raise HTTPException(status_code=404, detail="routing rule not found")
        await db.commit()
        return await _select_routing_row(db, rule_id)


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
    """Probe a known IP across printer / card-reader / terminal ports.

    Returns the raw _probe_host result on a match — caller decides whether
    to POST /devices to persist. Raises 404 when no port responds; this
    endpoint never writes to the devices table on its own.
    """
    ports_to_try = PRINTER_PORTS + CARD_READER_PORTS + TERMINAL_PORTS
    result = await _probe_host(req.ip, None, ports_to_try, DIRECT_TIMEOUT)
    if not result:
        raise HTTPException(
            status_code=404,
            detail=f"No device found at {req.ip}",
        )
    return result


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
    raise HTTPException(
        status_code=410,
        detail="This endpoint is retired. Use POST /api/v1/licenses/activate."
    )


@router.get("/license/list")
async def list_licenses():
    raise HTTPException(
        status_code=410,
        detail="This endpoint is retired. Use POST /api/v1/licenses/activate."
    )


@router.delete("/license/{activation_code}", dependencies=[Depends(require_manager)])
async def revoke_license(activation_code: str):
    raise HTTPException(
        status_code=410,
        detail="This endpoint is retired. Use POST /api/v1/licenses/activate."
    )


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


@router.get("/fingerprint")
async def get_fingerprint():
    """Return this server's hardware fingerprint (sha256 of serial+mac).

    Non-fatal: on any error returns {"fingerprint": None, "error": <msg>}
    with status 200 so the activation scene can still render.
    """
    try:
        from ...services.hardware_fingerprint import get_hardware_fingerprint
        return {"fingerprint": get_hardware_fingerprint()}
    except Exception as e:
        return {"fingerprint": None, "error": str(e)}
