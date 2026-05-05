"""
KINDpos WebSocket Sync Endpoint

Hub-and-spoke push channel. Each terminal Pi opens one persistent WebSocket
connection and receives broadcasted event dicts in real time.

Routes (all under /api/v1/sync when registered with prefix /api/v1):
    WS  /sync/ws/{terminal_id}  — persistent connection per terminal
    GET /sync/peers             — list currently connected terminal IDs
"""

import json
import logging
from typing import Any

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from app.api.dependencies import get_connection_manager

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
