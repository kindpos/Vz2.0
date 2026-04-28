"""
Printer Detector Tests
======================
Covers scanner/printer_detector.py — a module with zero existing test
coverage. Tests target pure-function logic and monkeypatched network
helpers; no real network connections are made.

Test groups:
  - DiscoveredPrinter data model (pure functions)
  - PrinterDiscovery helpers: OUI lookup, CIDR parsing, dedup, emit
  - PrinterDiscovery network helpers: _check_port, _reverse_dns
  - scan_network: monkeypatched port-scan, progress callback, dedup
  - get_scan_summary: pre-scan and post-scan state
  - Unimplemented stub methods raise NotImplementedError
"""

import socket
import sys
from datetime import datetime
from unittest.mock import MagicMock, patch

import pytest

from app.scanner.printer_detector import DiscoveredPrinter, PrinterDiscovery


# ═══════════════════════════════════════════════════════════════════════════
# DiscoveredPrinter data model
# ═══════════════════════════════════════════════════════════════════════════


class TestDiscoveredPrinter:

    def _make(self, **overrides) -> DiscoveredPrinter:
        kw = dict(ip_address="10.0.0.100", mac_address="00:53:53:FA:54:3E",
                  open_ports=[9100])
        kw.update(overrides)
        return DiscoveredPrinter(**kw)

    def test_defaults(self):
        """Fields not explicitly set carry sensible defaults."""
        p = DiscoveredPrinter(ip_address="192.168.1.1")
        assert p.mac_address == "unknown"
        assert p.hostname is None
        assert p.open_ports == []
        assert p.protocol == "escpos"
        assert p.online_status is True
        assert p.discovery_method == "port_scan"

    def test_infer_printer_type_kitchen(self):
        """device_subtype='kitchen' maps to impact printer."""
        p = self._make(device_subtype="kitchen")
        assert p._infer_printer_type() == "impact"

    def test_infer_printer_type_receipt(self):
        """device_subtype='receipt' (or anything non-kitchen) maps to thermal."""
        assert self._make(device_subtype="receipt")._infer_printer_type() == "thermal"
        assert self._make(device_subtype=None)._infer_printer_type() == "thermal"
        assert self._make(device_subtype="bar")._infer_printer_type() == "thermal"

    def test_str_contains_key_fields(self):
        """__str__ includes IP, MAC, and port list."""
        p = self._make(ip_address="10.0.0.42", mac_address="AA:BB:CC:DD:EE:FF",
                       open_ports=[9100], friendly_name="Kitchen Printer")
        s = str(p)
        assert "10.0.0.42" in s
        assert "AA:BB:CC:DD:EE:FF" in s
        assert "9100" in s

    def test_to_printer_config_dict_structure(self):
        """Exported dict has all required PrinterConfig keys."""
        p = self._make(
            ip_address="10.0.0.50",
            mac_address="00:53:53:FA:54:3E",
            open_ports=[9100],
            device_subtype="receipt",
            friendly_name="Bar Receipt",
            location_notes="Bar counter",
        )
        d = p.to_printer_config_dict()
        assert "printer_id" in d
        assert "name" in d
        assert "printer_type" in d
        assert "role" in d
        assert "connection_string" in d
        assert "location_tag" in d
        assert "_discovery_metadata" in d

    def test_to_printer_config_dict_connection_string(self):
        """connection_string is tcp://<ip>:<port>."""
        p = self._make(ip_address="10.0.0.186", open_ports=[9100])
        d = p.to_printer_config_dict()
        assert d["connection_string"] == "tcp://10.0.0.186:9100"

    def test_to_printer_config_dict_fallback_port_9100(self):
        """No open_ports → still falls back to 9100."""
        p = self._make(ip_address="10.0.0.1", open_ports=[])
        d = p.to_printer_config_dict()
        assert ":9100" in d["connection_string"]

    def test_to_printer_config_dict_friendly_name_fallback(self):
        """When friendly_name is None, name falls back to 'Printer at <ip>'."""
        p = self._make(ip_address="10.0.0.77", friendly_name=None)
        d = p.to_printer_config_dict()
        assert "10.0.0.77" in d["name"]

    def test_to_printer_config_dict_role_defaults_to_receipt(self):
        """device_subtype=None produces role='receipt'."""
        p = self._make(device_subtype=None)
        assert p.to_printer_config_dict()["role"] == "receipt"

    def test_to_printer_config_dict_metadata_fields(self):
        """_discovery_metadata carries mac, manufacturer, scan_id."""
        p = self._make(
            mac_address="00:26:AB:11:22:33",
            manufacturer="Epson",
            scan_id="scan_20260101_abc123",
        )
        meta = p.to_printer_config_dict()["_discovery_metadata"]
        assert meta["mac_address"] == "00:26:AB:11:22:33"
        assert meta["manufacturer"] == "Epson"
        assert meta["scan_id"] == "scan_20260101_abc123"


# ═══════════════════════════════════════════════════════════════════════════
# PrinterDiscovery helpers — pure functions
# ═══════════════════════════════════════════════════════════════════════════


class TestLookupMacManufacturer:
    """_lookup_mac_manufacturer is a pure OUI table lookup."""

    def setup_method(self):
        self.scanner = PrinterDiscovery()

    def test_known_epson_oui(self):
        assert self.scanner._lookup_mac_manufacturer("00:26:AB:11:22:33") == "Epson"

    def test_known_volcora_oui(self):
        assert self.scanner._lookup_mac_manufacturer("00:53:53:FA:54:3E") == "Volcora"

    def test_known_star_micronics_oui(self):
        assert self.scanner._lookup_mac_manufacturer("00:11:62:AA:BB:CC") == "Star Micronics"

    def test_unknown_oui_returns_none(self):
        assert self.scanner._lookup_mac_manufacturer("DE:AD:BE:EF:00:01") is None

    def test_unknown_mac_string_returns_none(self):
        assert self.scanner._lookup_mac_manufacturer("unknown") is None

    def test_empty_string_returns_none(self):
        assert self.scanner._lookup_mac_manufacturer("") is None

    def test_short_mac_returns_none(self):
        """Fewer than 3 octets → can't build OUI key → None."""
        assert self.scanner._lookup_mac_manufacturer("AA:BB") is None


class TestCidrToHostList:
    """_cidr_to_host_list converts CIDR to list of host IPs."""

    def setup_method(self):
        self.scanner = PrinterDiscovery()

    def test_slash_30_gives_two_hosts(self):
        hosts = self.scanner._cidr_to_host_list("10.0.0.0/30")
        assert len(hosts) == 2
        assert "10.0.0.1" in hosts
        assert "10.0.0.2" in hosts

    def test_slash_24_gives_254_hosts(self):
        hosts = self.scanner._cidr_to_host_list("192.168.1.0/24")
        assert len(hosts) == 254

    def test_network_address_excluded(self):
        """The network address (.0) is not a valid host — excluded."""
        hosts = self.scanner._cidr_to_host_list("10.0.0.0/30")
        assert "10.0.0.0" not in hosts

    def test_broadcast_excluded(self):
        """The broadcast address (.3 in /30) is excluded."""
        hosts = self.scanner._cidr_to_host_list("10.0.0.0/30")
        assert "10.0.0.3" not in hosts

    def test_invalid_cidr_returns_empty(self):
        """Bad CIDR notation → empty list, no exception."""
        hosts = self.scanner._cidr_to_host_list("not-a-cidr")
        assert hosts == []

    def test_host_route_slash32_returns_single_host(self):
        """/32 is a host route — Python ipaddress treats it as one host."""
        hosts = self.scanner._cidr_to_host_list("10.0.0.1/32")
        assert hosts == ["10.0.0.1"]


class TestDeduplicate:
    """_deduplicate merges printers by IP, preferring enriched records."""

    def setup_method(self):
        self.scanner = PrinterDiscovery()

    def test_single_printer_passes_through(self):
        p = DiscoveredPrinter(ip_address="10.0.0.1")
        assert self.scanner._deduplicate([p]) == [p]

    def test_same_ip_keeps_one(self):
        p1 = DiscoveredPrinter(ip_address="10.0.0.1")
        p2 = DiscoveredPrinter(ip_address="10.0.0.1")
        result = self.scanner._deduplicate([p1, p2])
        assert len(result) == 1

    def test_same_ip_prefers_enriched_with_manufacturer(self):
        """When two records share an IP, the one with manufacturer wins."""
        bare = DiscoveredPrinter(ip_address="10.0.0.5", manufacturer=None)
        rich = DiscoveredPrinter(ip_address="10.0.0.5", manufacturer="Epson")
        result = self.scanner._deduplicate([bare, rich])
        assert len(result) == 1
        assert result[0].manufacturer == "Epson"

    def test_same_ip_keeps_first_when_both_unenriched(self):
        """Two bare records for same IP → first one wins (arrival order)."""
        p1 = DiscoveredPrinter(ip_address="10.0.0.9", hostname="host-a")
        p2 = DiscoveredPrinter(ip_address="10.0.0.9", hostname="host-b")
        result = self.scanner._deduplicate([p1, p2])
        assert result[0].hostname == "host-a"

    def test_different_ips_both_kept(self):
        p1 = DiscoveredPrinter(ip_address="10.0.0.1")
        p2 = DiscoveredPrinter(ip_address="10.0.0.2")
        result = self.scanner._deduplicate([p1, p2])
        assert len(result) == 2

    def test_empty_list_returns_empty(self):
        assert self.scanner._deduplicate([]) == []


class TestEmit:
    """_emit invokes the on_progress callback and swallows errors."""

    def setup_method(self):
        self.scanner = PrinterDiscovery()

    def test_no_callback_is_noop(self):
        """With no callback registered, _emit is silent."""
        self.scanner.on_progress = None
        self.scanner._emit("scan_start", {"network": "10.0.0.0/24"})
        # No exception — pass

    def test_callback_receives_event_type_and_data(self):
        received = []
        self.scanner.on_progress = lambda t, d: received.append((t, d))

        self.scanner._emit("host_found", {"ip": "10.0.0.1"})

        assert len(received) == 1
        assert received[0][0] == "host_found"
        assert received[0][1] == {"ip": "10.0.0.1"}

    def test_callback_error_is_swallowed(self):
        """A buggy callback must not propagate and crash the scanner."""
        def bad_callback(event_type, data):
            raise RuntimeError("callback broke")

        self.scanner.on_progress = bad_callback
        self.scanner._emit("scan_start", {})  # must not raise


# ═══════════════════════════════════════════════════════════════════════════
# PrinterDiscovery network helpers — monkeypatched sockets
# ═══════════════════════════════════════════════════════════════════════════


class TestCheckPort:
    """_check_port wraps socket.connect_ex — testable by patching the socket."""

    def setup_method(self):
        self.scanner = PrinterDiscovery()

    def test_open_port_returns_true(self, monkeypatch):
        """connect_ex returns 0 (success) → port is open."""
        mock_sock = MagicMock()
        mock_sock.__enter__ = lambda s: s
        mock_sock.__exit__ = MagicMock(return_value=False)
        mock_sock.connect_ex.return_value = 0
        monkeypatch.setattr(socket, "socket", lambda *a, **k: mock_sock)

        assert self.scanner._check_port("10.0.0.1", 9100) is True

    def test_closed_port_returns_false(self, monkeypatch):
        """connect_ex returns non-zero (ECONNREFUSED) → port is closed."""
        mock_sock = MagicMock()
        mock_sock.__enter__ = lambda s: s
        mock_sock.__exit__ = MagicMock(return_value=False)
        mock_sock.connect_ex.return_value = 111  # ECONNREFUSED
        monkeypatch.setattr(socket, "socket", lambda *a, **k: mock_sock)

        assert self.scanner._check_port("10.0.0.1", 9100) is False

    def test_socket_error_returns_false(self, monkeypatch):
        """Any socket.error or OSError → returns False, no exception."""
        def bad_socket(*a, **k):
            raise socket.error("network down")

        monkeypatch.setattr(socket, "socket", bad_socket)
        assert self.scanner._check_port("10.0.0.1", 9100) is False


class TestReverseDns:
    """_reverse_dns wraps socket.gethostbyaddr."""

    def setup_method(self):
        self.scanner = PrinterDiscovery()

    def test_successful_lookup_returns_hostname(self, monkeypatch):
        monkeypatch.setattr(
            socket, "gethostbyaddr",
            lambda ip: ("printer.local", [], [ip]),
        )
        assert self.scanner._reverse_dns("10.0.0.1") == "printer.local"

    def test_herror_returns_none(self, monkeypatch):
        def raise_herror(ip):
            raise socket.herror("no hostname")
        monkeypatch.setattr(socket, "gethostbyaddr", raise_herror)
        assert self.scanner._reverse_dns("10.0.0.1") is None

    def test_gaierror_returns_none(self, monkeypatch):
        def raise_gaierror(ip):
            raise socket.gaierror("DNS failure")
        monkeypatch.setattr(socket, "gethostbyaddr", raise_gaierror)
        assert self.scanner._reverse_dns("10.0.0.1") is None


# ═══════════════════════════════════════════════════════════════════════════
# scan_network — monkeypatched _port_scan_discovery
# ═══════════════════════════════════════════════════════════════════════════


class TestScanNetwork:

    def _scanner_with_fake_port_scan(self, monkeypatch, printers):
        scanner = PrinterDiscovery()
        monkeypatch.setattr(scanner, "_port_scan_discovery", lambda cidr: printers)
        return scanner

    def test_returns_discovered_printers(self, monkeypatch):
        """scan_network returns whatever _port_scan_discovery yields."""
        fake = DiscoveredPrinter(ip_address="10.0.0.100", open_ports=[9100])
        scanner = self._scanner_with_fake_port_scan(monkeypatch, [fake])

        result = scanner.scan_network("10.0.0.0/24", methods=["port_scan"])
        assert len(result) == 1
        assert result[0].ip_address == "10.0.0.100"

    def test_discovered_printers_stored_on_instance(self, monkeypatch):
        """After scan, scanner.discovered_printers is populated."""
        fake = DiscoveredPrinter(ip_address="10.0.0.200", open_ports=[9100])
        scanner = self._scanner_with_fake_port_scan(monkeypatch, [fake])

        scanner.scan_network("10.0.0.0/24", methods=["port_scan"])
        assert len(scanner.discovered_printers) == 1

    def test_empty_network_returns_empty_list(self, monkeypatch):
        """No printers found → empty result, no exception."""
        scanner = self._scanner_with_fake_port_scan(monkeypatch, [])
        result = scanner.scan_network("10.0.0.0/30", methods=["port_scan"])
        assert result == []

    def test_deduplication_applied_during_scan(self, monkeypatch):
        """Two printers at the same IP are merged to one."""
        bare = DiscoveredPrinter(ip_address="10.0.0.5", manufacturer=None)
        rich = DiscoveredPrinter(ip_address="10.0.0.5", manufacturer="Epson")
        scanner = self._scanner_with_fake_port_scan(monkeypatch, [bare, rich])

        result = scanner.scan_network("10.0.0.0/30", methods=["port_scan"])
        assert len(result) == 1
        assert result[0].manufacturer == "Epson"

    def test_progress_callback_receives_scan_start_and_complete(self, monkeypatch):
        """on_progress is called at least for scan_start and scan_complete."""
        received_types = []
        scanner = self._scanner_with_fake_port_scan(monkeypatch, [])
        scanner.on_progress = lambda t, d: received_types.append(t)

        scanner.scan_network("10.0.0.0/30", methods=["port_scan"])
        assert "scan_start" in received_types
        assert "scan_complete" in received_types

    def test_default_method_is_port_scan(self, monkeypatch):
        """Calling scan_network without methods= uses port_scan by default."""
        call_log = []
        scanner = PrinterDiscovery()
        monkeypatch.setattr(
            scanner, "_port_scan_discovery",
            lambda cidr: call_log.append(cidr) or []
        )
        scanner.scan_network("10.0.0.0/30")
        assert len(call_log) == 1


# ═══════════════════════════════════════════════════════════════════════════
# get_scan_summary
# ═══════════════════════════════════════════════════════════════════════════


class TestGetScanSummary:

    def test_before_any_scan_duration_is_none(self):
        """Fresh scanner has no scan timestamps → duration is None."""
        scanner = PrinterDiscovery()
        summary = scanner.get_scan_summary()
        assert summary["duration_seconds"] is None
        assert summary["printers_found"] == 0
        assert summary["printers"] == []

    def test_scan_id_present(self):
        scanner = PrinterDiscovery()
        summary = scanner.get_scan_summary()
        assert summary["scan_id"].startswith("scan_")

    def test_after_scan_has_positive_duration(self, monkeypatch):
        """After a completed scan, duration_seconds is >= 0."""
        scanner = PrinterDiscovery()
        monkeypatch.setattr(scanner, "_port_scan_discovery", lambda cidr: [])
        scanner.scan_network("10.0.0.0/30", methods=["port_scan"])

        summary = scanner.get_scan_summary()
        assert summary["duration_seconds"] is not None
        assert summary["duration_seconds"] >= 0

    def test_after_scan_printers_listed(self, monkeypatch):
        """Discovered printers appear in the summary with expected fields."""
        fake = DiscoveredPrinter(
            ip_address="10.0.0.42",
            mac_address="00:53:53:AA:BB:CC",
            open_ports=[9100],
            manufacturer="Volcora",
        )
        scanner = PrinterDiscovery()
        monkeypatch.setattr(scanner, "_port_scan_discovery", lambda cidr: [fake])
        scanner.scan_network("10.0.0.0/30", methods=["port_scan"])

        summary = scanner.get_scan_summary()
        assert summary["printers_found"] == 1
        p = summary["printers"][0]
        assert p["ip_address"] == "10.0.0.42"
        assert p["manufacturer"] == "Volcora"


# ═══════════════════════════════════════════════════════════════════════════
# Unimplemented stubs raise NotImplementedError
# ═══════════════════════════════════════════════════════════════════════════


class TestUnimplementedStubs:
    """mDNS, SNMP, and USB discovery are future-phase stubs."""

    def setup_method(self):
        self.scanner = PrinterDiscovery()

    def test_mdns_raises_not_implemented(self):
        with pytest.raises(NotImplementedError):
            self.scanner._mdns_discovery()

    def test_snmp_raises_not_implemented(self):
        with pytest.raises(NotImplementedError):
            self.scanner._snmp_discovery("10.0.0.0/24")

    def test_usb_raises_not_implemented(self):
        with pytest.raises(NotImplementedError):
            self.scanner._usb_discovery()
