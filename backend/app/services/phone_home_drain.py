"""
Background drain loop for phone_home_queue.

PROVISIONING_FLOW.md §7.6 — retry backoff schedule:
  attempt 0 → 1 min
  attempt 1 → 5 min
  attempt 2 → 15 min
  attempt 3 → 1 hour
  attempt 4 → 6 hours
  attempt 5 → 24 hours
  attempt 6+ → 24 hours (daily)
Abandoned after 7 days of total elapsed time from created_at.

Auth: Bearer <customer_api_key> from provisioning table.
Idempotent responses (409) are treated as success (mark_sent).
4xx responses other than 429 are treated as permanent failure (mark_abandoned).
5xx and network errors trigger retry with backoff.

Uses stdlib urllib.request (the project already depends on httpx, but a
sync POST in a thread executor avoids tangling async lifetime with the
short-lived sqlite3 connection that owns the queue rows).
"""
from __future__ import annotations

import asyncio
import json
import logging
import sqlite3
import urllib.error
import urllib.request
from datetime import datetime, timedelta, timezone

from app.persistence.phone_home_repository import (
    get_pending_jobs,
    mark_abandoned,
    mark_failed_retrying,
    mark_sent,
)
from app.persistence.provisioning_keys import CUSTOMER_API_KEY
from app.persistence.provisioning_repository import ProvisioningRepository

logger = logging.getLogger(__name__)

# §7.6 backoff schedule in seconds (index = attempt_count before this attempt)
BACKOFF_SECONDS: list[int] = [60, 300, 900, 3600, 21600, 86400]
ABANDON_AFTER_DAYS = 7
POLL_INTERVAL_SECONDS = 60


def _next_backoff(attempt_count: int) -> int:
    """Return seconds to wait before the next attempt."""
    if attempt_count < len(BACKOFF_SECONDS):
        return BACKOFF_SECONDS[attempt_count]
    return BACKOFF_SECONDS[-1]  # daily after exhausting schedule


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _add_seconds(iso: str, seconds: int) -> str:
    dt = datetime.fromisoformat(iso.replace("Z", "+00:00"))
    return (dt + timedelta(seconds=seconds)).isoformat()


def _is_abandoned(created_at: str) -> bool:
    """Return True if the job has been pending for more than ABANDON_AFTER_DAYS."""
    dt = datetime.fromisoformat(created_at.replace("Z", "+00:00"))
    return datetime.now(timezone.utc) - dt > timedelta(days=ABANDON_AFTER_DAYS)


def _post_sync(endpoint: str, payload: dict, api_key: str) -> int:
    """
    Synchronous HTTP POST using stdlib urllib (no extra deps).
    Returns the HTTP status code. Raises urllib.error.URLError on network failure.
    """
    data = json.dumps(payload).encode()
    req = urllib.request.Request(
        endpoint,
        data=data,
        headers={
            "Content-Type": "application/json",
            "Authorization": f"Bearer {api_key}",
            "User-Agent": "KINDpos-Overseer/2.0",
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            return resp.status
    except urllib.error.HTTPError as exc:
        return exc.code


def _process_one(
    conn: sqlite3.Connection,
    job: dict,
    api_key: str,
) -> None:
    """Process a single queue row. All state transitions happen here."""
    queue_id = job["queue_id"]
    endpoint = job["endpoint"]
    payload = json.loads(job["payload"])
    attempt_count = job["attempt_count"]
    created_at = job["created_at"]

    # §7.6: abandon if older than ABANDON_AFTER_DAYS
    if _is_abandoned(created_at):
        logger.warning(
            "phone_home: abandoning %s after %d days (endpoint=%s)",
            queue_id, ABANDON_AFTER_DAYS, endpoint,
        )
        mark_abandoned(conn, queue_id, last_error="max age exceeded")
        return

    try:
        status = _post_sync(endpoint, payload, api_key)
    except Exception as exc:
        # Network failure — retry with backoff
        delay = _next_backoff(attempt_count)
        next_attempt = _add_seconds(_now_iso(), delay)
        logger.warning(
            "phone_home: network error for %s, retry in %ds: %s",
            queue_id, delay, exc,
        )
        mark_failed_retrying(
            conn, queue_id, next_attempt=next_attempt, last_error=str(exc)
        )
        return

    if status in (200, 204, 409):
        # 2xx = success; 409 = already activated (idempotent) — both count as sent
        logger.info("phone_home: sent %s → %d", queue_id, status)
        mark_sent(conn, queue_id)

    elif status == 429:
        # Rate limited — back off
        delay = _next_backoff(attempt_count)
        next_attempt = _add_seconds(_now_iso(), delay)
        logger.warning("phone_home: rate limited for %s, retry in %ds", queue_id, delay)
        mark_failed_retrying(
            conn, queue_id, next_attempt=next_attempt, last_error="HTTP 429"
        )

    elif 400 <= status < 500:
        # Permanent client error (bad payload, auth rejected, etc.) — abandon
        logger.error(
            "phone_home: permanent failure for %s → HTTP %d, abandoning",
            queue_id, status,
        )
        mark_abandoned(conn, queue_id, last_error=f"HTTP {status}")

    else:
        # 5xx — retry with backoff
        delay = _next_backoff(attempt_count)
        next_attempt = _add_seconds(_now_iso(), delay)
        logger.warning(
            "phone_home: server error %d for %s, retry in %ds",
            status, queue_id, delay,
        )
        mark_failed_retrying(
            conn, queue_id, next_attempt=next_attempt, last_error=f"HTTP {status}"
        )


def _drain_once(accounts_db_path: str) -> int:
    """
    Open a short-lived connection, fetch due jobs, process each one.
    Returns the count of jobs processed.
    """
    # ProvisioningRepository takes a path, not a connection — it opens its
    # own short-lived connection under the hood.
    prov = ProvisioningRepository(accounts_db_path)
    api_key = prov.get_value(CUSTOMER_API_KEY)
    if not api_key:
        # Not provisioned yet — nothing to send
        return 0

    conn = sqlite3.connect(accounts_db_path)
    conn.row_factory = sqlite3.Row
    try:
        jobs = get_pending_jobs(conn, limit=10)
        for job in jobs:
            try:
                _process_one(conn, job, api_key)
            except Exception as exc:
                logger.exception(
                    "phone_home: unexpected error processing %s: %s",
                    job["queue_id"], exc,
                )
        return len(jobs)
    finally:
        conn.close()


async def phone_home_drain_loop(accounts_db_path: str) -> None:
    """
    Async loop that runs indefinitely, draining the queue every POLL_INTERVAL_SECONDS.
    Designed to be started as an asyncio task from the FastAPI lifespan.
    """
    logger.info(
        "phone_home: drain loop started (poll interval=%ds)", POLL_INTERVAL_SECONDS
    )
    loop = asyncio.get_running_loop()
    while True:
        try:
            processed = await loop.run_in_executor(
                None, _drain_once, accounts_db_path
            )
            if processed:
                logger.debug("phone_home: processed %d job(s)", processed)
        except asyncio.CancelledError:
            logger.info("phone_home: drain loop cancelled")
            raise
        except Exception as exc:
            logger.exception("phone_home: drain loop error: %s", exc)
        await asyncio.sleep(POLL_INTERVAL_SECONDS)
