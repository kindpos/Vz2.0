"""
KINDpos WebSocket Sync Endpoint

Hub-and-spoke push channel. Each terminal Pi opens one persistent WebSocket
connection and receives broadcasted event dicts in real time.

Routes (all under /api/v1/sync when registered with prefix /api/v1):
    WS   /sync/ws/{terminal_id}  — persistent connection per terminal
    GET  /sync/peers             — list currently connected terminal IDs
    POST /sync/events/ingest     — HTTP fallback for terminals without an
                                   active WebSocket connection
"""

import json
import logging
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, WebSocket, WebSocketDisconnect
from pydantic import BaseModel

from app.api.dependencies import get_connection_manager, get_ledger
from app.core.event_ledger import EventLedger
from app.core.events import create_event, parse_event_type

logger = logging.getLogger("kindpos.websocket")

router = APIRouter(prefix="/sync", tags=["sync"])


@router.websocket("/ws/{terminal_id}")
async def websocket_endpoint(terminal_id: str, websocket: WebSocket) -> None:
    """
    Persistent WebSocket connection for a terminal Pi.

    Flow:
        connect → welcome → receive loop (parse → broadcast → ack) → disconnect
    """
    cm = get_connection_manager()
    if cm is None:
        await websocket.close(code=1011)
        logger.error(
            "ConnectionManager not initialized — rejecting terminal %s", terminal_id
        )
        return

    await cm.connect(terminal_id, websocket)
    try:
        await websocket.send_json(
            {"type": "connected", "terminal_id": terminal_id}
        )

        while True:
            raw = await websocket.receive_text()

            try:
                event = json.loads(raw)
            except json.JSONDecodeError:
                logger.warning(
                    "terminal %s sent non-JSON message — ignoring", terminal_id
                )
                continue

            event_type = event.get("event_type")
            event_id = event.get("event_id")
            payload = event.get("payload")

            if not event_type or event_id is None or payload is None:
                logger.warning(
                    "terminal %s sent malformed event "
                    "(missing event_type/event_id/payload) — ignoring",
                    terminal_id,
                )
                continue

            await cm.broadcast(event, origin=terminal_id)
            await websocket.send_json({"type": "ack", "event_id": event_id})

    except WebSocketDisconnect:
        logger.info("WebSocketDisconnect: terminal %s", terminal_id)
    finally:
        await cm.disconnect(terminal_id)


@router.get("/peers")
async def list_peers() -> dict[str, Any]:
    """Return all currently connected terminal IDs and count."""
    cm = get_connection_manager()
    peers = list(cm.connected_terminals.keys()) if cm is not None else []
    return {"peers": peers, "count": len(peers)}


# ---------------------------------------------------------------------------
# HTTP fallback ingest — used when a terminal Pi cannot hold a WebSocket open
# ---------------------------------------------------------------------------

class IngestEventBody(BaseModel):
    event_type: str
    event_id: str
    payload: dict
    sequence_number: int
    timestamp: str
    origin: str  # terminal_id of the sending Pi


@router.post("/events/ingest")
async def ingest_event(
    body: IngestEventBody,
    ledger: EventLedger = Depends(get_ledger),
) -> dict[str, Any]:
    """
    HTTP fallback for terminals that cannot maintain a WebSocket connection.

    Flow:
        validate → idempotency check → write to ledger → broadcast → ack
    """
    # 1. Validate — Pydantic model enforces required fields; extra check for
    #    empty strings that pass Pydantic's str type but are logically absent.
    if not body.event_type or not body.event_id or not body.origin:
        raise HTTPException(
            status_code=422,
            detail="event_type, event_id, and origin must be non-empty strings",
        )

    # 2. Idempotency check — event_id is used as the idempotency key so that
    #    retried POSTs from the same Pi are safe no-ops.
    existing = await ledger.get_event(body.event_id)
    if existing is not None:
        logger.info(
            "ingest: duplicate event_id=%s origin=%s — skipping",
            body.event_id, body.origin,
        )
        return {"status": "skipped", "reason": "duplicate"}

    # 3. Write to local ledger.
    try:
        event = create_event(
            event_type=parse_event_type(body.event_type),
            payload=body.payload,
            terminal_id=body.origin,
            idempotency_key=body.event_id,  # guards against concurrent retries
        )
    except (KeyError, ValueError) as exc:
        raise HTTPException(status_code=422, detail=f"Invalid event_type: {exc}")

    try:
        stored = await ledger.append(event)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc))

    if stored is None:
        # Idempotency gate blocked a race-condition duplicate.
        return {"status": "skipped", "reason": "duplicate"}

    # 4. Broadcast to all other connected terminals (prevents echo-back to
    #    the originating Pi via origin=body.origin).
    #    ledger.append() already fires its own broadcast; this explicit call
    #    forwards the original wire-format dict (with the sender's
    #    sequence_number and timestamp) for the HTTP-fallback path.
    cm = get_connection_manager()
    if cm is not None and cm.connected_terminals:
        broadcast_dict: dict[str, Any] = {
            "event_id":        body.event_id,
            "event_type":      body.event_type,
            "payload":         body.payload,
            "sequence_number": body.sequence_number,
            "timestamp":       body.timestamp,
            "origin":          body.origin,
        }
        try:
            await cm.broadcast(broadcast_dict, origin=body.origin)
        except Exception as exc:
            logger.warning(
                "ingest: broadcast failed for event %s: %s", body.event_id, exc
            )

    # 5. Return success.
    logger.info(
        "ingest: applied event_id=%s event_type=%s origin=%s hub_seq=%d",
        body.event_id, body.event_type, body.origin, stored.sequence_number,
    )
    return {"status": "applied", "event_id": body.event_id}
