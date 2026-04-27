import asyncio
import aiosqlite
import json
import logging
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional, List, Dict, Any

logger = logging.getLogger("kindpos.printing.queue")

class PrintJobQueue:
    """
    Local SQLite-based print job queue.
    Guarantees no order is lost regardless of printer status.
    """

    def __init__(self, db_path: str = "./data/print_queue.db"):
        self.db_path = Path(db_path)
        self.db_path.parent.mkdir(parents=True, exist_ok=True)
        self._db: Optional[aiosqlite.Connection] = None
        self._enqueue_lock = asyncio.Lock()

    async def connect(self) -> None:
        """Initialize the print queue database and schema."""
        self._db = await aiosqlite.connect(str(self.db_path))
        await self._db.execute("PRAGMA journal_mode=WAL")
        await self._db.execute("PRAGMA synchronous=NORMAL")

        await self._db.execute("""
            CREATE TABLE IF NOT EXISTS print_queue (
                job_id          TEXT PRIMARY KEY,
                order_id        TEXT NOT NULL,
                template_id     TEXT NOT NULL,
                printer_mac     TEXT NOT NULL,
                copy_type       TEXT,
                ticket_number   TEXT NOT NULL,
                context_json    TEXT NOT NULL,
                status          TEXT NOT NULL,   -- queued | sent | completed | failed
                attempt_count   INTEGER DEFAULT 0,
                last_attempt_at TEXT,
                created_at      TEXT NOT NULL,
                completed_at    TEXT
            )
        """)
        await self._db.commit()

    async def close(self) -> None:
        if self._db:
            await self._db.close()
            self._db = None

    async def enqueue(self, order_id: str, template_id: str, printer_mac: str,
                      ticket_number: str, context: Dict[str, Any],
                      copy_type: Optional[str] = None) -> str:
        """Add a new job to the queue, returning the existing job_id if an
        identical in-flight job (queued or sent) already exists."""
        async with self._enqueue_lock:
            # Idempotency: don't queue the same print twice while it's pending.
            # Lock ensures the SELECT + INSERT is atomic across concurrent callers.
            async with self._db.execute("""
                SELECT job_id FROM print_queue
                WHERE order_id = ? AND template_id = ? AND printer_mac = ?
                  AND (copy_type = ? OR (copy_type IS NULL AND ? IS NULL))
                  AND status IN ('queued', 'sent')
                LIMIT 1
            """, (order_id, template_id, printer_mac, copy_type, copy_type)) as cur:
                existing = await cur.fetchone()
            if existing:
                logger.info(f"Dedup: job {existing[0]} already pending for {order_id}/{template_id}")
                return existing[0]

            job_id = str(uuid.uuid4())
            now = datetime.now(timezone.utc).isoformat()

            await self._db.execute("""
                INSERT INTO print_queue (
                    job_id, order_id, template_id, printer_mac,
                    copy_type, ticket_number, context_json, status,
                    created_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            """, (
                job_id, order_id, template_id, printer_mac,
                copy_type, ticket_number, json.dumps(context), 'queued',
                now
            ))
            await self._db.commit()
            return job_id

    async def mark_sent(self, job_id: str, attempt_number: int):
        """Mark a job as currently being sent."""
        now = datetime.now(timezone.utc).isoformat()
        await self._db.execute("""
            UPDATE print_queue 
            SET status = 'sent', 
                attempt_count = ?, 
                last_attempt_at = ? 
            WHERE job_id = ?
        """, (attempt_number, now, job_id))
        await self._db.commit()

    async def mark_completed(self, job_id: str):
        """Mark a job as successfully printed."""
        now = datetime.now(timezone.utc).isoformat()
        await self._db.execute("""
            UPDATE print_queue 
            SET status = 'completed', 
                completed_at = ? 
            WHERE job_id = ?
        """, (now, job_id))
        await self._db.commit()

    async def mark_failed(self, job_id: str):
        """Mark a job as failed after retry threshold."""
        await self._db.execute("""
            UPDATE print_queue 
            SET status = 'failed' 
            WHERE job_id = ?
        """, (job_id,))
        await self._db.commit()

    async def get_pending_jobs(self) -> List[Dict[str, Any]]:
        """Get all 'queued' jobs ready to dispatch.
        'sent' jobs are excluded — they are in-flight or stale (recovered
        by recover_stale_sent_jobs on startup)."""
        async with self._db.execute(
            "SELECT * FROM print_queue WHERE status = 'queued' ORDER BY created_at ASC"
        ) as cursor:
            rows = await cursor.fetchall()
            return [dict(zip([col[0] for col in cursor.description], row)) for row in rows]

    async def recover_stale_sent_jobs(self, stale_after_seconds: int = 30) -> int:
        """Reset 'sent' jobs older than stale_after_seconds back to 'queued'.
        Called on dispatcher startup to recover from a mid-send crash."""
        from datetime import timedelta
        cutoff = (datetime.now(timezone.utc) - timedelta(seconds=stale_after_seconds)).isoformat()
        async with self._db.execute("""
            UPDATE print_queue
            SET status = 'queued'
            WHERE status = 'sent' AND last_attempt_at < ?
        """, (cutoff,)) as cur:
            count = cur.rowcount
        await self._db.commit()
        if count:
            logger.warning(f"Recovered {count} stale 'sent' job(s) back to 'queued'")
        return count

    async def get_failed_jobs(self) -> List[Dict[str, Any]]:
        """Get all 'failed' jobs for manual retry or display."""
        async with self._db.execute(
            "SELECT * FROM print_queue WHERE status = 'failed' ORDER BY created_at ASC"
        ) as cursor:
            rows = await cursor.fetchall()
            return [dict(zip([col[0] for col in cursor.description], row)) for row in rows]

    async def reset_for_retry(self, job_id: str):
        """Reset a failed job back to 'queued' for manual retry (attempt_count → 0)."""
        await self._db.execute("""
            UPDATE print_queue
            SET status = 'queued',
                attempt_count = 0
            WHERE job_id = ?
        """, (job_id,))
        await self._db.commit()

    async def bump_attempt_for_retry(self, job_id: str, attempt: int) -> None:
        """Reset status to 'queued' while preserving the attempt counter.
        Used by the dispatcher on transient failure so MAX_ATTEMPTS is
        enforced correctly. A single UPDATE avoids the reset-then-patch
        pattern where the patch could be silently dropped."""
        await self._db.execute("""
            UPDATE print_queue
            SET status = 'queued',
                attempt_count = ?
            WHERE job_id = ?
        """, (attempt, job_id))
        await self._db.commit()

    async def dismiss_job(self, job_id: str):
        """Remove or mark a job as dismissed (deleting for simplicity here)."""
        await self._db.execute("DELETE FROM print_queue WHERE job_id = ?", (job_id,))
        await self._db.commit()
