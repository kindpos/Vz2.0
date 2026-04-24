"""Tests for GET /entomology/ledger-gaps and the underlying static dataset."""

from __future__ import annotations

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient

from app.api.routes.auth import get_current_session
from app.services.ledger_gap_report import (
    AGGREGATE_ORDER,
    LEDGER_GAP_NODES,
    aggregate_summary,
)


VALID_STATUSES = {"IMPLEMENTED", "RENAMED", "PARTIAL", "FACTORY-ONLY", "MISSING"}
VALID_SEVERITIES = {"CRITICAL", "HIGH", "MEDIUM", "LOW"}


def _fake_session():
    return {"employee_id": "E1", "name": "Tester", "roles": ["manager"]}


@pytest_asyncio.fixture
async def authed_client():
    from app.main import app

    app.dependency_overrides[get_current_session] = _fake_session
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        yield ac
    app.dependency_overrides.pop(get_current_session, None)


# ── Dataset invariants ─────────────────────────────────
def test_node_count_matches_audit():
    assert len(LEDGER_GAP_NODES) == 118


def test_node_ids_unique():
    ids = [n["id"] for n in LEDGER_GAP_NODES]
    assert len(ids) == len(set(ids)), "LG-## IDs must be unique"


def test_node_ids_follow_lg_pattern():
    for n in LEDGER_GAP_NODES:
        assert n["id"].startswith("LG-"), f"bad id: {n['id']}"
        assert n["id"][3:].isdigit(), f"bad id: {n['id']}"


def test_status_and_severity_values_valid():
    for n in LEDGER_GAP_NODES:
        assert n["status"] in VALID_STATUSES, f"{n['id']}: bad status {n['status']!r}"
        assert n["severity"] in VALID_SEVERITIES, f"{n['id']}: bad severity {n['severity']!r}"


def test_every_aggregate_known():
    known = set(AGGREGATE_ORDER)
    for n in LEDGER_GAP_NODES:
        assert n["aggregate"] in known, f"{n['id']}: unknown aggregate {n['aggregate']!r}"


def test_related_ids_all_resolve():
    all_ids = {n["id"] for n in LEDGER_GAP_NODES}
    for n in LEDGER_GAP_NODES:
        for rel in n.get("related_ids", []):
            assert rel in all_ids, f"{n['id']}: related_ids references unknown {rel!r}"


def test_aggregate_summary_shape():
    s = aggregate_summary(LEDGER_GAP_NODES)
    assert s["total"] == 118
    assert set(s["by_status"]).issubset(VALID_STATUSES)
    assert set(s["by_severity"]).issubset(VALID_SEVERITIES)
    assert sum(s["by_status"].values()) == 118
    assert sum(s["by_severity"].values()) == 118
    per_agg_total = sum(a["total"] for a in s["aggregates"])
    assert per_agg_total == 118


# ── Route ──────────────────────────────────────────────
@pytest.mark.asyncio
async def test_ledger_gaps_endpoint_returns_full_dataset(authed_client):
    resp = await authed_client.get("/api/v1/entomology/ledger-gaps")
    assert resp.status_code == 200
    body = resp.json()
    assert "generated_at" in body
    assert len(body["nodes"]) == 118
    assert body["summary"]["total"] == 118
