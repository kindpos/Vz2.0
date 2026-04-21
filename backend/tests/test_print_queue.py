"""
Tests for PrintJobQueue — local SQLite-based print job queue.
"""

import pytest
from app.printing.print_queue import PrintJobQueue


@pytest.fixture
async def queue(tmp_path):
    q = PrintJobQueue(db_path=str(tmp_path / "test_queue.db"))
    await q.connect()
    yield q
    await q.close()


def _enqueue_kwargs(**overrides):
    """Default kwargs for enqueue()."""
    kw = {
        'order_id': 'order-001',
        'template_id': 'guest_receipt',
        'printer_mac': 'AA:BB:CC:DD:EE:FF',
        'ticket_number': '1001',
        'context': {'restaurant_name': 'Test'},
    }
    kw.update(overrides)
    return kw


class TestPrintJobQueue:

    async def test_enqueue_returns_job_id(self, queue):
        job_id = await queue.enqueue(**_enqueue_kwargs())
        assert isinstance(job_id, str)
        assert len(job_id) > 0

    async def test_enqueue_and_get_pending(self, queue):
        await queue.enqueue(**_enqueue_kwargs(order_id='o1'))
        await queue.enqueue(**_enqueue_kwargs(order_id='o2'))
        await queue.enqueue(**_enqueue_kwargs(order_id='o3'))

        pending = await queue.get_pending_jobs()
        assert len(pending) == 3

    async def test_mark_sent(self, queue):
        job_id = await queue.enqueue(**_enqueue_kwargs())
        await queue.mark_sent(job_id, 1)

        # 'sent' jobs are excluded from the dispatch poll to prevent double-sends.
        # Verify status directly via get_failed_jobs absence + a direct DB check.
        pending = await queue.get_pending_jobs()
        assert len(pending) == 0  # in-flight jobs are invisible to the poll loop

        failed = await queue.get_failed_jobs()
        assert len(failed) == 0

        # Confirm the row itself updated correctly
        async with queue._db.execute(
            "SELECT status, attempt_count FROM print_queue WHERE job_id = ?", (job_id,)
        ) as cur:
            row = await cur.fetchone()
        assert row[0] == 'sent'
        assert row[1] == 1

    async def test_mark_completed(self, queue):
        job_id = await queue.enqueue(**_enqueue_kwargs())
        await queue.mark_sent(job_id, 1)
        await queue.mark_completed(job_id)

        pending = await queue.get_pending_jobs()
        assert len(pending) == 0

    async def test_mark_failed(self, queue):
        job_id = await queue.enqueue(**_enqueue_kwargs())
        await queue.mark_failed(job_id)

        failed = await queue.get_failed_jobs()
        assert len(failed) == 1

        pending = await queue.get_pending_jobs()
        assert len(pending) == 0

    async def test_reset_for_retry(self, queue):
        job_id = await queue.enqueue(**_enqueue_kwargs())
        await queue.mark_failed(job_id)

        failed = await queue.get_failed_jobs()
        assert len(failed) == 1

        await queue.reset_for_retry(job_id)

        pending = await queue.get_pending_jobs()
        assert len(pending) == 1
        assert pending[0]['status'] == 'queued'
        assert pending[0]['attempt_count'] == 0

    async def test_dismiss_job(self, queue):
        job_id = await queue.enqueue(**_enqueue_kwargs())
        await queue.dismiss_job(job_id)

        pending = await queue.get_pending_jobs()
        assert len(pending) == 0

        failed = await queue.get_failed_jobs()
        assert len(failed) == 0

    async def test_multiple_jobs_order(self, queue):
        ids = []
        for i in range(3):
            jid = await queue.enqueue(**_enqueue_kwargs(order_id=f'order-{i}'))
            ids.append(jid)

        pending = await queue.get_pending_jobs()
        assert len(pending) == 3
        # Should be in creation order
        for i, job in enumerate(pending):
            assert job['job_id'] == ids[i]

    async def test_completed_not_in_pending(self, queue):
        job_id = await queue.enqueue(**_enqueue_kwargs())
        await queue.mark_sent(job_id, 1)
        await queue.mark_completed(job_id)

        # Enqueue a second job that stays pending
        await queue.enqueue(**_enqueue_kwargs(order_id='order-002'))

        pending = await queue.get_pending_jobs()
        assert len(pending) == 1
        assert pending[0]['order_id'] == 'order-002'

    async def test_enqueue_idempotent_while_queued(self, queue):
        """Enqueueing the same (order, template, mac, copy_type) twice while
        the first is still 'queued' returns the existing job_id — no duplicate."""
        kwargs = _enqueue_kwargs()
        j1 = await queue.enqueue(**kwargs)
        j2 = await queue.enqueue(**kwargs)
        assert j1 == j2
        pending = await queue.get_pending_jobs()
        assert len(pending) == 1

    async def test_enqueue_idempotent_while_sent(self, queue):
        """Same dedup applies while the job is 'sent' (in-flight)."""
        kwargs = _enqueue_kwargs()
        j1 = await queue.enqueue(**kwargs)
        await queue.mark_sent(j1, 1)
        j2 = await queue.enqueue(**kwargs)
        assert j1 == j2

    async def test_enqueue_not_idempotent_after_completed(self, queue):
        """After a job completes, a new enqueue for the same params creates a
        fresh job (e.g. reprint)."""
        kwargs = _enqueue_kwargs()
        j1 = await queue.enqueue(**kwargs)
        await queue.mark_sent(j1, 1)
        await queue.mark_completed(j1)
        j2 = await queue.enqueue(**kwargs)
        assert j1 != j2
        pending = await queue.get_pending_jobs()
        assert len(pending) == 1
        assert pending[0]['job_id'] == j2

    async def test_recover_stale_sent_jobs(self, queue):
        """Stale 'sent' jobs (crashed mid-send) are reset to 'queued'."""
        from datetime import timedelta
        from datetime import datetime, timezone

        j1 = await queue.enqueue(**_enqueue_kwargs())
        await queue.mark_sent(j1, 1)

        # Backdate last_attempt_at to make it appear stale
        stale_ts = (datetime.now(timezone.utc) - timedelta(seconds=120)).isoformat()
        await queue._db.execute(
            "UPDATE print_queue SET last_attempt_at = ? WHERE job_id = ?", (stale_ts, j1)
        )
        await queue._db.commit()

        recovered = await queue.recover_stale_sent_jobs(stale_after_seconds=60)
        assert recovered == 1

        pending = await queue.get_pending_jobs()
        assert len(pending) == 1
        assert pending[0]['status'] == 'queued'

    async def test_recover_does_not_touch_recent_sent(self, queue):
        """A 'sent' job with a recent last_attempt_at is NOT recovered — it's
        still in-flight."""
        j1 = await queue.enqueue(**_enqueue_kwargs())
        await queue.mark_sent(j1, 1)

        recovered = await queue.recover_stale_sent_jobs(stale_after_seconds=60)
        assert recovered == 0

        pending = await queue.get_pending_jobs()
        assert len(pending) == 0  # still in-flight, correctly excluded
