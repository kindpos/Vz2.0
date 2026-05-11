"""
In-memory rate limiter for /v1/auth/login (OVERSEER_AUTH.md §5.1).

Sliding window of failure timestamps per email and per source IP. A new
failure is rejected when either bucket exceeds its cap inside the window.

State is process-local: counters reset on restart. Acceptable for v1 because
(a) the Overseer is single-process, (b) attackers can't restart it from
outside, (c) the 5-minute window is short enough that even a full reset only
gives one extra burst window.

Configurable via constants below if a later requirement bumps them. The
public surface is just `check_rate_limit`, `record_failure`, `record_success`.
"""

from __future__ import annotations

import threading
from collections import defaultdict, deque
from dataclasses import dataclass
from time import monotonic
from typing import Deque, Dict, Optional


EMAIL_FAIL_CAP = 5
IP_FAIL_CAP = 20
WINDOW_SECONDS = 5 * 60


@dataclass(frozen=True)
class RateLimitResult:
    allowed: bool
    retry_after: int  # seconds; 0 when allowed


_lock = threading.Lock()
_email_fails: Dict[str, Deque[float]] = defaultdict(deque)
_ip_fails: Dict[str, Deque[float]] = defaultdict(deque)


def _normalize_email(email: str) -> str:
    return (email or "").strip().lower()


def _prune(bucket: Deque[float], now: float) -> None:
    cutoff = now - WINDOW_SECONDS
    while bucket and bucket[0] < cutoff:
        bucket.popleft()


def _retry_after(bucket: Deque[float], now: float) -> int:
    """Seconds until the oldest failure ages out and a new attempt would fit."""
    if not bucket:
        return 0
    oldest = bucket[0]
    seconds = int((oldest + WINDOW_SECONDS) - now)
    return max(seconds, 1)


def check_rate_limit(email: str, ip: Optional[str]) -> RateLimitResult:
    """Return whether a fresh attempt is allowed right now.

    Does NOT record anything — the caller records via `record_failure` or
    `record_success` after performing the actual credential check.
    """
    now = monotonic()
    email_key = _normalize_email(email)
    ip_key = ip or "-"
    with _lock:
        ebkt = _email_fails[email_key]
        ibkt = _ip_fails[ip_key]
        _prune(ebkt, now)
        _prune(ibkt, now)
        if len(ebkt) >= EMAIL_FAIL_CAP:
            return RateLimitResult(allowed=False, retry_after=_retry_after(ebkt, now))
        if len(ibkt) >= IP_FAIL_CAP:
            return RateLimitResult(allowed=False, retry_after=_retry_after(ibkt, now))
    return RateLimitResult(allowed=True, retry_after=0)


def record_failure(email: str, ip: Optional[str]) -> None:
    now = monotonic()
    email_key = _normalize_email(email)
    ip_key = ip or "-"
    with _lock:
        _email_fails[email_key].append(now)
        _ip_fails[ip_key].append(now)


def record_success(email: str) -> None:
    """Clear the per-email bucket after a successful login. IP bucket is left
    intact — a compromised box should still be rate-limited even when a
    legitimate user happens to sit on it."""
    email_key = _normalize_email(email)
    with _lock:
        _email_fails.pop(email_key, None)


def reset_all() -> None:
    """Test hook — drop every counter. Not exported for production use."""
    with _lock:
        _email_fails.clear()
        _ip_fails.clear()
