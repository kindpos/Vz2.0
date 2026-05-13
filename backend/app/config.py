"""
KINDpos Configuration

Central configuration management using environment variables.
"""

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict
from typing import Optional
import os
from pathlib import Path

# Canonical data directory — always backend/data/ regardless
# of working directory or launch method
BACKEND_ROOT = Path(__file__).resolve().parent.parent
DATA_DIR = BACKEND_ROOT / 'data'
DATA_DIR.mkdir(exist_ok=True)


class Settings(BaseSettings):
    """Application settings loaded from environment variables."""

    # Application
    app_name: str = "KINDpos"
    app_version: str = "0.1.0"
    debug: bool = False

    # Terminal identification.
    # No hardcoded default — main.py looks the active terminal up in
    # hardware_config.db.terminals on startup and overrides this. Tests
    # set KINDPOS_TERMINAL_ID via conftest. An empty value here means
    # "unactivated" and forces the licensure path to fail closed.
    terminal_id: str = ""

    # Database
    database_path: str = str(DATA_DIR / 'event_ledger.db')

    # Server
    host: str = "127.0.0.1"
    port: int = 8000

    # Tax rate (0 until configured via Overseer)
    tax_rate: float = Field(default=0.0, ge=0.0, le=1.0)

    # Cash dual-pricing discount (0 until configured via Overseer)
    cash_discount_rate: float = 0.0

    # Tip-out percentage (default 2%)
    tipout_percent: float = 2.0

    # Store mode: "demo" seeds sample data, "production" starts clean
    store_mode: str = "production"

    # Store local timezone — IANA name (e.g. "America/Chicago",
    # "America/Los_Angeles"). Used by routing_resolver scheduled rules
    # so "lunch shift 11:00-14:00" fires on local-store clock, not UTC.
    store_tz: str = "America/Chicago"

    # Hardware Discovery
    default_subnet: str = "10.0.0.0/24"
    scan_timeout: float = 2.0

    # Activation Server (KINDpos-site)
    activation_server_url: str = "https://kindpos.com"

    # Ed25519 public key for verifying offline-signed terminal licenses.
    # Private key lives in tools/kindpos-private.key (offline, never deployed).
    license_public_key: str = "nex+HVMXNP0sXJq7IxD7qzb9k8r6VWD1obwn3nncenc="
    license_path: str = ""

    # Financial invariants. When True, aggregation paths raise
    # InvariantViolation if any P&L / tender / tips identity drifts
    # outside tolerance. When False (production default), the mismatch
    # is logged at WARN level and a `reconciliation_diff` field is
    # surfaced on the response so operators can see the drift without
    # the API call failing. pytest flips this to True via conftest.
    strict_invariants: bool = False

    # Auth gate on write/admin routes. When True (production default), the
    # auth_required dependency raises 401 on missing/expired bearer tokens.
    # When False, a SEC-005 diagnostic is recorded and the request is
    # allowed through — useful during the rollout transition and in tests
    # that still call routes without a valid session. Tests turn this off
    # via conftest so the 1000+-test suite doesn't need token fixtures.
    auth_enforced: bool = False

    model_config = SettingsConfigDict(env_file=".env", env_prefix="KINDPOS_")


# Global settings instance
settings = Settings()

# Module-level alias for the license-signing public key. Kept as a constant
# so verifier code can import a stable name without depending on the Settings
# instance shape.
KINDPOS_LICENSE_PUBLIC_KEY = settings.license_public_key
