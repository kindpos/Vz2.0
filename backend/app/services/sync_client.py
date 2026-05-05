"""
KINDpos Terminal Pi Sync Client

Maintains a persistent WebSocket connection to the hub Pi. Each broadcast
event received from the hub is written to the local ledger (with idempotency
check) so the terminal Pi stays in sync without issuing its own queries.

Lifecycle:
    start() → connect loop (auto-reconnect every 5 s) → receive events → append
    stop()  → signal loop to exit → close connection
"""

import asyncio
import json
import logging
from typing import Optional

import websockets
from websockets.exceptions import ConnectionClosed

from app.core.event_ledger import EventLedger
from app.core.events import create_event, parse_event_type

logger = logging.getLogger("kindpos.sync_client")

_RECONNECT_DELAY = 5  # seconds between reconnect attempts


class SyncClient:
    """
    WebSocket client that keeps a terminal Pi's local ledger in sync with
    the hub Pi by consuming broadcast events in real time.
    """

    def __init__(self, hub_url: str, terminal_id: str, ledger: EventLedger) -> None:
        self._hub_url = hub_url          # ws://hub-ip:8000/api/v1/sync/ws/<terminal_id>
        self._terminal_id = terminal_id
        self._ledger = ledger
        self._task: Optional[asyncio.Task] = None
        self._connected = False
        self._running = False

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    @property
    def is_connected(self) -> bool:
        return self._connected

    async def start(self) -> None:
        """Spawn the background reconnect/receive loop."""
        if self._task is not None:
            return
        self._running = True
        self._task = asyncio.create_task(self._run(), name="sync_client")
        logger.info("SyncClient started — hub=%s terminal=%s", self._hub_url, self._terminal_id)

    async def stop(self) -> None:
        """Signal the loop to exit and wait for it to finish."""
        self._running = False
        if self._task is not None:
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                pass
            self._task = None
        self._connected = False
        logger.info("SyncClient stopped")

    # ------------------------------------------------------------------
    # Internal loop
    # ------------------------------------------------------------------

    async def _run(self) -> None:
        """Outer reconnect loop — never exits until stop() is called."""
        url = f"{self._hub_url}/{self._terminal_id}"
        while self._running:
            try:
                async with websockets.connect(url) as ws:
                    self._connected = True
                    logger.info("Connected to hub at %s", url)
                    await self._receive_loop(ws)
            except asyncio.CancelledError:
                break
            except ConnectionClosed as exc:
                self._connected = False
                logger.warning("Hub connection closed (%s) — reconnecting in %ds", exc, _RECONNECT_DELAY)
            except Exception as exc:
                self._connected = False
                logger.warning("Hub connection error (%s) — reconnecting in %ds", exc, _RECONNECT_DELAY)

            if not self._running:
                break

            try:
                await asyncio.sleep(_RECONNECT_DELAY)
            except asyncio.CancelledError:
                break

        self._connected = False

    async def _receive_loop(self, ws) -> None:
        """Inner receive loop — runs until the connection drops."""
        async for raw in ws:
            if not self._running:
                break

            try:
                event_dict = json.loads(raw)
            except json.JSONDecodeError:
                logger.warning("Received non-JSON message from hub — ignoring")
                continue

            msg_type = event_dict.get("type")

            # Welcome/ack frames from the hub — no action needed
            if msg_type in ("connected", "ack"):
                continue

            await self._ingest(event_dict)

    async def _ingest(self, event_dict: dict) -> None:
        """Write a hub-broadcast event into the local ledger (idempotent)."""
        event_id = event_dict.get("event_id")
        event_type_str = event_dict.get("event_type")
        payload = event_dict.get("payload")
        origin = event_dict.get("origin")

        if not event_id or not event_type_str or payload is None:
            logger.warning(
                "Received malformed broadcast (missing event_id/event_type/payload) — ignoring"
            )
            return

        # Idempotency check — skip if already in local ledger
        existing = await self._ledger.get_event(event_id)
        if existing is not None:
            logger.debug("Skipping already-known event %s", event_id)
            return

        try:
            event = create_event(
                event_type=parse_event_type(event_type_str),
                payload=payload,
                terminal_id=origin or self._terminal_id,
                idempotency_key=event_id,
            )
        except (KeyError, ValueError) as exc:
            logger.warning(
                "Cannot ingest hub event %s — unknown event_type %r: %s",
                event_id, event_type_str, exc,
            )
            return

        try:
            stored = await self._ledger.append(event)
        except ValueError as exc:
            logger.warning("Ledger rejected hub event %s: %s", event_id, exc)
            return

        if stored is None:
            logger.debug("Ledger idempotency gate blocked duplicate %s", event_id)
            return

        logger.info(
            "Ingested hub event event_id=%s event_type=%s seq=%d",
            stored.event_id, stored.event_type.value, stored.sequence_number,
        )
