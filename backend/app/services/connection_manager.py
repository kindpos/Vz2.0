"""
KINDpos WebSocket Connection Manager

Hub-and-spoke sync: each terminal connects once; events emitted by one
terminal are broadcast to all others. The 'origin' field on broadcast()
prevents echo-back to the sender.
"""

import json
import logging
from typing import Optional

from fastapi import WebSocket

logger = logging.getLogger("kindpos.connection_manager")


class ConnectionManager:
    def __init__(self) -> None:
        self.connected_terminals: dict[str, WebSocket] = {}

    async def connect(self, terminal_id: str, websocket: WebSocket) -> None:
        """Accept and register a terminal WebSocket connection."""
        await websocket.accept()
        self.connected_terminals[terminal_id] = websocket
        logger.info(
            "Terminal connected: %s  (total=%d)",
            terminal_id,
            len(self.connected_terminals),
        )

    async def disconnect(self, terminal_id: str) -> None:
        """Remove a terminal from the registry."""
        self.connected_terminals.pop(terminal_id, None)
        logger.info(
            "Terminal disconnected: %s  (total=%d)",
            terminal_id,
            len(self.connected_terminals),
        )

    async def broadcast(
        self, event_dict: dict, origin: Optional[str] = None
    ) -> None:
        """Send event JSON to all connected terminals except the origin."""
        payload = json.dumps(event_dict)
        recipients = [
            tid for tid in self.connected_terminals if tid != origin
        ]
        logger.info(
            "Broadcast event=%s origin=%s recipients=%s",
            event_dict.get("type", "unknown"),
            origin,
            recipients,
        )
        dead: list[str] = []
        for terminal_id in recipients:
            ws = self.connected_terminals.get(terminal_id)
            if ws is None:
                continue
            try:
                await ws.send_text(payload)
            except Exception as exc:
                logger.warning(
                    "Broadcast failed for terminal %s: %s — removing",
                    terminal_id,
                    exc,
                )
                dead.append(terminal_id)
        for terminal_id in dead:
            await self.disconnect(terminal_id)

    async def send_to(self, terminal_id: str, event_dict: dict) -> None:
        """Send event JSON to a specific terminal."""
        ws = self.connected_terminals.get(terminal_id)
        if ws is None:
            logger.warning(
                "send_to: terminal %s not connected — dropping event %s",
                terminal_id,
                event_dict.get("type", "unknown"),
            )
            return
        payload = json.dumps(event_dict)
        logger.info(
            "send_to terminal=%s event=%s",
            terminal_id,
            event_dict.get("type", "unknown"),
        )
        try:
            await ws.send_text(payload)
        except Exception as exc:
            logger.warning(
                "send_to failed for terminal %s: %s — removing",
                terminal_id,
                exc,
            )
            await self.disconnect(terminal_id)
