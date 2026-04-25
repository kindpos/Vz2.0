"""Tests for /print/* endpoints in app.api.routes.printing.

Focuses on:
1. Path-traversal guard on /print/test (SEC-002 — three rejection patterns).
2. Correct ticket_number and order_id shape for the four "specialist" print
   endpoints (clock-hours, sales-recap, server-checkout, queue GET).

Strategy
--------
* print_queue.enqueue is the module-level singleton.  We patch it with
  AsyncMock so every test gets a predictable "fake-queued" return value
  without touching SQLite.
* PrintContextBuilder is patched as a constructor so its async methods
  (build_*_context) return lightweight dicts instantly.
* _record_diag (imported into printing.py from auth.py) is patched to an
  AsyncMock so the SEC-002 diagnostic write doesn't hit any database.
"""

from __future__ import annotations

import re
import pytest
from unittest.mock import AsyncMock, MagicMock, patch

from app.api.routes import printing


# ── helpers ──────────────────────────────────────────────────────────────────

def _make_context_builder(ticket_number="T001", order_id="ord-001"):
    """Return a mock PrintContextBuilder whose build_* methods yield minimal dicts."""
    builder = AsyncMock()
    ctx = {"ticket_number": ticket_number, "order_id": order_id}
    builder.build_receipt_context         = AsyncMock(return_value=ctx)
    builder.build_kitchen_context         = AsyncMock(return_value=ctx)
    builder.build_clock_hours_context     = AsyncMock(return_value=ctx)
    builder.build_sales_recap_context     = AsyncMock(return_value=ctx)
    builder.build_server_checkout_context = AsyncMock(return_value=ctx)
    return builder


# ── /print/test — path traversal guard ───────────────────────────────────────

class TestPrintTestSecurity:
    """SEC-002: bare template names only; separators and traversal rejected."""

    @pytest.mark.asyncio
    async def test_forward_slash_rejected(self):
        with patch("app.api.routes.printing._record_diag", new_callable=AsyncMock), \
             patch.object(printing.print_queue, "enqueue", new_callable=AsyncMock):
            from fastapi import HTTPException
            with pytest.raises(HTTPException) as exc:
                await printing.print_test(
                    template_name="../../etc/passwd",
                    printer_mac="AA:BB:CC:DD:EE:FF",
                )
            assert exc.value.status_code == 400

    @pytest.mark.asyncio
    async def test_backslash_rejected(self):
        with patch("app.api.routes.printing._record_diag", new_callable=AsyncMock), \
             patch.object(printing.print_queue, "enqueue", new_callable=AsyncMock):
            from fastapi import HTTPException
            with pytest.raises(HTTPException) as exc:
                await printing.print_test(
                    template_name="subdir\\template",
                    printer_mac="AA:BB:CC:DD:EE:FF",
                )
            assert exc.value.status_code == 400

    @pytest.mark.asyncio
    async def test_dotdot_without_slash_rejected(self):
        with patch("app.api.routes.printing._record_diag", new_callable=AsyncMock), \
             patch.object(printing.print_queue, "enqueue", new_callable=AsyncMock):
            from fastapi import HTTPException
            with pytest.raises(HTTPException) as exc:
                await printing.print_test(
                    template_name="..secret",
                    printer_mac="AA:BB:CC:DD:EE:FF",
                )
            assert exc.value.status_code == 400

    @pytest.mark.asyncio
    async def test_record_diag_called_on_traversal(self):
        mock_diag = AsyncMock()
        with patch("app.api.routes.printing._record_diag", mock_diag), \
             patch.object(printing.print_queue, "enqueue", new_callable=AsyncMock):
            from fastapi import HTTPException
            with pytest.raises(HTTPException):
                await printing.print_test(
                    template_name="../../etc/passwd",
                    printer_mac="DEFAULT",
                )
        mock_diag.assert_awaited_once()
        # The event_code should be SEC-002
        call_kwargs = mock_diag.call_args.kwargs
        assert call_kwargs.get("event_code") == "SEC-002"


# ── /print/clock-hours/{employee_id} ─────────────────────────────────────────

class TestPrintClockHours:
    @pytest.mark.asyncio
    async def test_ticket_number_is_CLK(self):
        mock_enqueue = AsyncMock(return_value="job-clk-1")
        mock_builder = _make_context_builder()

        with patch("app.api.routes.printing.PrintContextBuilder", return_value=mock_builder), \
             patch.object(printing.print_queue, "enqueue", mock_enqueue):
            result = await printing.print_clock_hours(
                employee_id="emp-42",
                request=printing.ClockHoursRequest(employee_name="Alice", action="CLOCK IN"),
                ledger=None,
            )

        assert result["status"] == "queued"
        call_kwargs = mock_enqueue.call_args.kwargs
        assert call_kwargs["ticket_number"] == "CLK"

    @pytest.mark.asyncio
    async def test_order_id_prefixed_with_clock(self):
        mock_enqueue = AsyncMock(return_value="job-clk-2")
        mock_builder = _make_context_builder()

        with patch("app.api.routes.printing.PrintContextBuilder", return_value=mock_builder), \
             patch.object(printing.print_queue, "enqueue", mock_enqueue):
            await printing.print_clock_hours(
                employee_id="emp-99",
                request=printing.ClockHoursRequest(employee_name="Bob"),
                ledger=None,
            )

        call_kwargs = mock_enqueue.call_args.kwargs
        assert call_kwargs["order_id"].startswith("clock-emp-99-")


# ── /print/sales-recap ────────────────────────────────────────────────────────

class TestPrintSalesRecap:
    @pytest.mark.asyncio
    async def test_ticket_number_is_RPT(self):
        mock_enqueue = AsyncMock(return_value="job-rpt-1")
        mock_builder = _make_context_builder()

        with patch("app.api.routes.printing.PrintContextBuilder", return_value=mock_builder), \
             patch.object(printing.print_queue, "enqueue", mock_enqueue):
            result = await printing.print_sales_recap(
                request=printing.SalesRecapRequest(printed_by="Manager"),
                ledger=None,
            )

        assert result["status"] == "queued"
        call_kwargs = mock_enqueue.call_args.kwargs
        assert call_kwargs["ticket_number"] == "RPT"

    @pytest.mark.asyncio
    async def test_order_id_prefixed_with_sales_recap(self):
        mock_enqueue = AsyncMock(return_value="job-rpt-2")
        mock_builder = _make_context_builder()

        with patch("app.api.routes.printing.PrintContextBuilder", return_value=mock_builder), \
             patch.object(printing.print_queue, "enqueue", mock_enqueue):
            await printing.print_sales_recap(
                request=printing.SalesRecapRequest(),
                ledger=None,
            )

        call_kwargs = mock_enqueue.call_args.kwargs
        assert call_kwargs["order_id"].startswith("sales-recap-")


# ── /print/server-checkout/{server_id} ────────────────────────────────────────

class TestPrintServerCheckout:
    @pytest.mark.asyncio
    async def test_ticket_number_is_CHK(self):
        mock_enqueue = AsyncMock(return_value="job-chk-1")
        mock_builder = _make_context_builder()

        with patch("app.api.routes.printing.PrintContextBuilder", return_value=mock_builder), \
             patch.object(printing.print_queue, "enqueue", mock_enqueue):
            result = await printing.print_server_checkout(
                server_id="srv-7",
                request=printing.ServerCheckoutPrintRequest(server_name="Alice"),
                ledger=None,
            )

        assert result["status"] == "queued"
        call_kwargs = mock_enqueue.call_args.kwargs
        assert call_kwargs["ticket_number"] == "CHK"

    @pytest.mark.asyncio
    async def test_order_id_prefixed_with_checkout(self):
        mock_enqueue = AsyncMock(return_value="job-chk-2")
        mock_builder = _make_context_builder()

        with patch("app.api.routes.printing.PrintContextBuilder", return_value=mock_builder), \
             patch.object(printing.print_queue, "enqueue", mock_enqueue):
            await printing.print_server_checkout(
                server_id="srv-12",
                request=printing.ServerCheckoutPrintRequest(),
                ledger=None,
            )

        call_kwargs = mock_enqueue.call_args.kwargs
        assert call_kwargs["order_id"].startswith("checkout-srv-12-")


# ── GET /print/queue ──────────────────────────────────────────────────────────

class TestGetQueue:
    @pytest.mark.asyncio
    async def test_returns_pending_and_failed_keys(self):
        with patch.object(printing.print_queue, "get_pending_jobs", AsyncMock(return_value=[])), \
             patch.object(printing.print_queue, "get_failed_jobs", AsyncMock(return_value=[])):
            result = await printing.get_queue()
        assert "pending" in result
        assert "failed" in result

    @pytest.mark.asyncio
    async def test_returns_populated_lists(self):
        pending_job = {"job_id": "j1", "template_id": "guest_receipt"}
        failed_job  = {"job_id": "j2", "error": "printer offline"}

        with patch.object(printing.print_queue, "get_pending_jobs", AsyncMock(return_value=[pending_job])), \
             patch.object(printing.print_queue, "get_failed_jobs",  AsyncMock(return_value=[failed_job])):
            result = await printing.get_queue()

        assert result["pending"] == [pending_job]
        assert result["failed"]  == [failed_job]
