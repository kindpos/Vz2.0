import base64
import logging
import os
import uuid
from datetime import datetime, timezone
from decimal import Decimal
from fastapi import APIRouter, Depends, HTTPException, BackgroundTasks
from fastapi.responses import Response
from pydantic import BaseModel
from typing import List, Dict, Any, Optional
from app.api.dependencies import get_ledger
from app.core.event_ledger import EventLedger
from app.core.events import (
    CONFIG_EVENT_PREFIXES,
    EventType,
    Event,
    create_event,
    is_config_event,
    menu_import_completed,
    menu_import_failed,
    menu_import_started,
    parse_event_type,
)
from app.models.config_events import (
    StoreConfigBundle, StoreInfo, CCProcessingRate, PendingChange,
    Role, Employee, TipoutRule, TipPool, MenuItem, MenuCategory, ModifierGroup, MicroMod,
    Section, FloorPlanLayout, Terminal, Printer, RoutingMatrix,
    Discount, VoidReason,
)
from app.config import settings
from app.services.store_config_service import StoreConfigService
from app.services.overseer_config_service import OverseerConfigService
from app.api.routes.auth import auth_required, require_manager
from app.core.pin_hash import ensure_hashed_pin

_log = logging.getLogger(__name__)

# Allow-list of mime types we'll accept for the store logo. Keep this tight —
# rendering anything else risks XSS via SVG or unbounded payloads.
_ALLOWED_LOGO_MIMES = {"image/png", "image/jpeg", "image/webp", "image/gif"}
_LOGO_MAX_BYTES = 2 * 1024 * 1024  # 2 MB


def _logo_storage_path() -> str:
    """Single fixed path for the store logo, sibling to the event ledger."""
    data_dir = os.path.dirname(os.path.abspath(settings.database_path))
    os.makedirs(data_dir, exist_ok=True)
    return os.path.join(data_dir, "store_logo.bin")


class LogoUploadRequest(BaseModel):
    filename: Optional[str] = None
    mime_type: str
    content_base64: str


router = APIRouter(prefix="/config", tags=["config"])


# Config-change notification.
#
# We don't (yet) run a WebSocket — terminals poll `GET /config/version`
# for the max sequence number of any config event; when it advances,
# they re-pull from `/sync/config/events?since=N`. This function is the
# backend-side hook that logs the write and leaves a marker in the
# operator log; the UI-side poll is the thing that actually delivers
# the update. Previously this was a `print(...)` stub with a "mock"
# comment, which made it easy to believe terminals were being notified
# when in fact nothing was happening.
async def broadcast_config_update(sections: List[str]):
    _log.info("config.updated sections=%s (terminals pick up via /config/version poll)", sections)


@router.get("/version")
async def get_config_version(ledger: EventLedger = Depends(get_ledger)):
    """Cheap poll endpoint terminals use to detect config changes.

    Returns the max `sequence_number` of any config-prefixed event in
    the ledger. Terminals cache this; when it advances, they re-sync
    via `GET /sync/config/events?since=N` and replay the new events
    into their local projection. This replaces a long-standing
    `print()`-only "WS BROADCAST" stub that gave the appearance of
    push-updates without actually delivering any.

    Ten-second call overhead is a single indexed SELECT-MAX, so
    polling every 5-10 seconds from every terminal is cheap.
    """
    latest = 0
    # A small cursor loop so we don't pay for 50k operational events
    # when we only care about the config slice. Batch large enough that
    # typical stores finish in one pass.
    cursor = 0
    while True:
        batch = await ledger.get_events_since(cursor, limit=2000)
        if not batch:
            break
        for ev in batch:
            if is_config_event(ev.event_type.value):
                seq = ev.sequence_number or 0
                if seq > latest:
                    latest = seq
        cursor = batch[-1].sequence_number or (cursor + 1)
        if len(batch) < 2000:
            break
    return {"version": latest, "prefixes": list(CONFIG_EVENT_PREFIXES)}


@router.get("/pricing")
async def get_pricing(ledger: EventLedger = Depends(get_ledger)):
    """Return canonical pricing constants from ledger (or env defaults)."""
    tax_rate = settings.tax_rate
    cash_discount_rate = settings.cash_discount_rate

    # Check for user-configured tax rules
    tax_events = await ledger.get_events_by_type(EventType.STORE_TAX_RULE_CREATED, limit=100)
    tax_events += await ledger.get_events_by_type(EventType.STORE_TAX_RULE_UPDATED, limit=100)
    tax_events.sort(key=lambda x: x.sequence_number or 0)
    for e in tax_events:
        if e.payload.get("applies_to") == "all":
            tax_rate = e.payload.get("rate_percent", tax_rate) / 100

    # Check for user-configured cash discount
    cc_events = await ledger.get_events_by_type(EventType.STORE_CC_PROCESSING_RATE_UPDATED, limit=10)
    cc_events.sort(key=lambda x: x.sequence_number or 0)
    if cc_events:
        last = cc_events[-1].payload
        if "cash_discount_rate" in last:
            cash_discount_rate = last["cash_discount_rate"]

    return {
        "tax_rate": tax_rate,
        "cash_discount_rate": cash_discount_rate,
    }


@router.get("/store", response_model=StoreConfigBundle)
async def get_store_config(ledger: EventLedger = Depends(get_ledger)):
    service = StoreConfigService(ledger)
    return await service.get_projected_config()


# New Overseer Endpoints
@router.get("/roles", response_model=List[Role])
async def get_roles(ledger: EventLedger = Depends(get_ledger)):
    service = OverseerConfigService(ledger)
    return await service.get_roles()


@router.get("/employees", response_model=List[Employee])
async def get_employees(ledger: EventLedger = Depends(get_ledger)):
    service = OverseerConfigService(ledger)
    return await service.get_employees()


@router.get("/tipout", response_model=List[TipoutRule])
async def get_tipout(ledger: EventLedger = Depends(get_ledger)):
    service = OverseerConfigService(ledger)
    return await service.get_tipout_rules()


@router.get("/tip_pools", response_model=List[TipPool])
async def get_tip_pools(ledger: EventLedger = Depends(get_ledger)):
    service = OverseerConfigService(ledger)
    return await service.get_tip_pools()


@router.get("/menu/categories", response_model=List[MenuCategory])
async def get_menu_categories(ledger: EventLedger = Depends(get_ledger)):
    service = OverseerConfigService(ledger)
    return await service.get_menu_categories()


@router.get("/menu/items", response_model=List[MenuItem])
async def get_menu_items(ledger: EventLedger = Depends(get_ledger)):
    service = OverseerConfigService(ledger)
    return await service.get_menu_items()


@router.get("/modifier-groups", response_model=List[ModifierGroup])
async def get_modifier_groups(ledger: EventLedger = Depends(get_ledger)):
    service = OverseerConfigService(ledger)
    return await service.get_modifier_groups()


@router.get("/micromods", response_model=List[MicroMod])
async def get_micromods(ledger: EventLedger = Depends(get_ledger)):
    service = OverseerConfigService(ledger)
    return await service.get_micromods()


@router.get("/floorplan/sections", response_model=List[Section])
async def get_floorplan_sections(ledger: EventLedger = Depends(get_ledger)):
    service = OverseerConfigService(ledger)
    return await service.get_floorplan_sections()


@router.get("/floorplan", response_model=FloorPlanLayout)
async def get_floorplan(ledger: EventLedger = Depends(get_ledger)):
    service = OverseerConfigService(ledger)
    return await service.get_floorplan_layout()


@router.get("/terminals", response_model=List[Terminal])
async def get_terminals(ledger: EventLedger = Depends(get_ledger)):
    service = OverseerConfigService(ledger)
    return await service.get_terminals()


@router.get("/routing", response_model=RoutingMatrix)
async def get_routing(ledger: EventLedger = Depends(get_ledger)):
    service = OverseerConfigService(ledger)
    return await service.get_routing_matrix()


@router.post("/store/logo", dependencies=[Depends(require_manager)])
async def upload_store_logo(
        req: LogoUploadRequest,
        background_tasks: BackgroundTasks,
        ledger: EventLedger = Depends(get_ledger),
):
    """Save an uploaded image as the store logo and emit a branding event.

    Body is JSON {mime_type, content_base64} — base64 keeps us free of
    python-multipart and works fine for the small images we expect here.
    """
    if req.mime_type not in _ALLOWED_LOGO_MIMES:
        raise HTTPException(status_code=400, detail=f"Unsupported mime type: {req.mime_type}")
    try:
        raw = base64.b64decode(req.content_base64, validate=True)
    except Exception:
        raise HTTPException(status_code=400, detail="content_base64 is not valid base64")
    if len(raw) == 0:
        raise HTTPException(status_code=400, detail="empty image")
    if len(raw) > _LOGO_MAX_BYTES:
        raise HTTPException(status_code=413, detail=f"image exceeds {_LOGO_MAX_BYTES} bytes")

    event = create_event(
        event_type=EventType.STORE_BRANDING_UPDATED,
        terminal_id="OVERSEER",
        payload={
            "logo_url": "/api/v1/config/store/logo",
            "logo_mime_type": req.mime_type,
        },
    )
    await ledger.append(event)

    path = _logo_storage_path()
    with open(path, "wb") as fh:
        fh.write(raw)
    background_tasks.add_task(broadcast_config_update, ["store"])
    # Echo a cache-buster the client can use to refresh the <img> src.
    return {"status": "ok", "event_id": event.sequence_number,
            "logo_url": f"/api/v1/config/store/logo?v={event.sequence_number}"}


@router.get("/store/logo")
async def get_store_logo(ledger: EventLedger = Depends(get_ledger)):
    """Stream the most recently uploaded store logo, if any."""
    events = await ledger.get_events_by_type(EventType.STORE_BRANDING_UPDATED, limit=200)
    events.sort(key=lambda e: e.sequence_number or 0)
    mime_type = None
    for e in events:
        payload = e.payload or {}
        if payload.get("logo_mime_type"):
            mime_type = payload["logo_mime_type"]
    if not mime_type:
        raise HTTPException(status_code=404, detail="no logo uploaded")

    path = _logo_storage_path()
    if not os.path.exists(path):
        raise HTTPException(status_code=404, detail="logo file missing")
    with open(path, "rb") as fh:
        data = fh.read()
    return Response(content=data, media_type=mime_type)


@router.post("/store/info", dependencies=[Depends(require_manager)])
async def update_store_info(info: StoreInfo, background_tasks: BackgroundTasks,
                            ledger: EventLedger = Depends(get_ledger)):
    event = create_event(
        event_type=EventType.STORE_INFO_UPDATED,
        terminal_id="OVERSEER",
        payload=info.model_dump()
    )
    await ledger.append(event)
    background_tasks.add_task(broadcast_config_update, ["store"])
    return {"status": "ok", "event_id": event.sequence_number}


@router.post("/store/cc-rate", dependencies=[Depends(require_manager)])
async def update_cc_rate(rate: CCProcessingRate, background_tasks: BackgroundTasks,
                         ledger: EventLedger = Depends(get_ledger)):
    _TWO_DP = Decimal("0.01")
    if rate.per_transaction_fee != rate.per_transaction_fee.quantize(_TWO_DP):
        raise HTTPException(status_code=422, detail="per_transaction_fee must have at most 2 decimal places")
    event = create_event(
        event_type=EventType.STORE_CC_PROCESSING_RATE_UPDATED,
        terminal_id="OVERSEER",
        payload=rate.model_dump()
    )
    await ledger.append(event)
    background_tasks.add_task(broadcast_config_update, ["store"])
    return {"status": "ok", "event_id": event.sequence_number}


def _is_menu_import_event(etype: str) -> bool:
    """True when a config-push change belongs to the menu-import audit
    envelope (menu.*, category.*, modifier.*, tax_rules.*, items.*,
    categories.*, restaurant.configured)."""
    if etype.startswith(("menu.", "category.", "modifier.")):
        return True
    if etype in {
        "restaurant.configured",
        "tax_rules.batch_created",
        "categories.batch_created",
        "items.batch_created",
    }:
        return True
    return False


@router.post("/push", dependencies=[Depends(require_manager)])
async def push_changes(changes: List[PendingChange], background_tasks: BackgroundTasks,
                       ledger: EventLedger = Depends(get_ledger)):
    events = []
    sections = set()
    menu_import_count = 0
    for change in changes:
        payload = dict(change.payload or {})
        # PIN-at-rest on the batch path. /config/employees (POST) already
        # hashes via ensure_hashed_pin; without the same treatment here
        # any employee.* event with a `pin` field (notably the PIN-reset
        # flow) would land in the ledger as plaintext and future verify
        # attempts would compare plaintext-to-plaintext — a pre-hashing
        # regression. `ensure_hashed_pin` is idempotent, so it's safe to
        # call on a value that might already be hashed.
        if change.event_type.startswith("employee.") and payload.get("pin"):
            payload["pin"] = ensure_hashed_pin(payload["pin"])

        # Hub constraint: only one terminal may have is_hub=True. If setting
        # is_hub=True on a terminal, first reset any existing hub terminal.
        if (change.event_type in ("terminal.registered", "terminal.updated")
            and payload.get("is_hub") is True):
            service = OverseerConfigService(ledger)
            existing_terminals = await service.get_terminals()
            target_id = payload.get("terminal_id")
            # Find any other terminal that is marked as hub and disable it
            for term in existing_terminals:
                if term.is_hub and term.terminal_id != target_id:
                    # Create an event to disable the old hub
                    old_hub_event = create_event(
                        event_type=EventType.TERMINAL_UPDATED,
                        terminal_id="OVERSEER",
                        payload={"terminal_id": term.terminal_id, "is_hub": False}
                    )
                    events.append(old_hub_event)
                    break

        # Auto-wire order_id from payload as correlation_id so that
        # order-scoped events (seat.*, check.seat_*, seat.transferred_*)
        # are retrievable via get_events_by_correlation(order_id). Non-order
        # events (staff.*, category.*, etc.) don't have order_id in their
        # payload, so payload.get("order_id") returns None and is a no-op.
        event = create_event(
            event_type=parse_event_type(change.event_type),
            terminal_id="OVERSEER",
            payload=payload,
            correlation_id=payload.get("order_id") or None,
        )
        events.append(event)

        if _is_menu_import_event(change.event_type):
            menu_import_count += 1

        # Infer section from event type
        etype = change.event_type
        if etype.startswith("store."):
            sections.add("store")
        elif (etype.startswith("employee.")
              or etype.startswith("tipout.")
              or etype.startswith("timecard.")):
            sections.add("employees")
        elif etype.startswith("menu.") or etype.startswith("category."):
            sections.add("menu")
        elif etype.startswith("modifier."):
            sections.add("modifiers")
        elif etype.startswith("micromod."):
            sections.add("modifiers")
        elif etype.startswith("discount."):
            sections.add("discounts")
        elif etype.startswith("pricing."):
            sections.add("pricing")
        elif etype.startswith("floorplan."):
            sections.add("floor_plan")
        elif etype.startswith("terminal.") or etype.startswith("routing."):
            sections.add("hardware")

    if events:
        # Wrap menu-touching batches with menu.import_started /
        # menu.import_completed so replayers can pair the inner events
        # back to a single import operation. Non-menu batches pass
        # through unchanged so employee / store / floorplan pushes
        # don't accidentally inherit a menu-import envelope.
        import_id: str | None = None
        if menu_import_count > 0:
            import_id = f"imp_{uuid.uuid4().hex[:10]}"
            started_evt = menu_import_started(
                terminal_id="OVERSEER",
                import_id=import_id,
                source="config_push",
                expected_event_count=menu_import_count,
            )
            completed_evt = menu_import_completed(
                terminal_id="OVERSEER",
                import_id=import_id,
                event_count=menu_import_count,
            )
            batch = [started_evt, *events, completed_evt]
        else:
            batch = events

        try:
            await ledger.append_batch(batch)
        except Exception as exc:
            if import_id is not None:
                # Atomic batch failed -- no menu events landed, but
                # record the attempt so the ledger isn't silent about
                # the failure.
                failure_evt = menu_import_failed(
                    terminal_id="OVERSEER",
                    import_id=import_id,
                    reason=str(exc) or "config_push_failed",
                    error_type=type(exc).__name__,
                )
                await ledger.append(failure_evt)
            raise
        background_tasks.add_task(broadcast_config_update, list(sections))

    return {
        "status": "ok",
        "events_written": len(events),
        "event_ids": [e.sequence_number for e in events]
    }


@router.post("/menu/86", dependencies=[Depends(require_manager)])
async def item_86(item_id: str, background_tasks: BackgroundTasks, ledger: EventLedger = Depends(get_ledger)):
    if not item_id or not item_id.strip():
        raise HTTPException(status_code=422, detail="item_id must not be empty")
    # Emit the legacy menu.item_86d alongside the spec-aligned item.86ed
    # so existing projections keep seeing the old name while replayers
    # that follow the spec vocabulary have a canonical 86 event.
    event = create_event(
        event_type=EventType.MENU_ITEM_86D,
        terminal_id="OVERSEER",
        payload={"item_id": item_id}
    )
    spec_event = create_event(
        event_type=EventType.ITEM_86ED,
        terminal_id="OVERSEER",
        payload={"item_id": item_id},
    )
    await ledger.append_batch([event, spec_event])
    background_tasks.add_task(broadcast_config_update, ["menu"])
    return {"status": "ok", "event_id": event.sequence_number}


@router.post("/menu/restore", dependencies=[Depends(require_manager)])
async def item_restore(item_id: str, background_tasks: BackgroundTasks, ledger: EventLedger = Depends(get_ledger)):
    if not item_id or not item_id.strip():
        raise HTTPException(status_code=422, detail="item_id must not be empty")
    # Mirror the 86 route: emit legacy menu.item_restored alongside the
    # spec-aligned item.86_cleared in one atomic append_batch.
    event = create_event(
        event_type=EventType.MENU_ITEM_RESTORED,
        terminal_id="OVERSEER",
        payload={"item_id": item_id}
    )
    spec_event = create_event(
        event_type=EventType.ITEM_86_CLEARED,
        terminal_id="OVERSEER",
        payload={"item_id": item_id},
    )
    await ledger.append_batch([event, spec_event])
    background_tasks.add_task(broadcast_config_update, ["menu"])
    return {"status": "ok", "event_id": event.sequence_number}


@router.post("/roles", dependencies=[Depends(require_manager)])
async def create_role(role: Role, background_tasks: BackgroundTasks, ledger: EventLedger = Depends(get_ledger)):
    event = create_event(
        event_type=EventType.EMPLOYEE_ROLE_CREATED,
        terminal_id="OVERSEER",
        payload=role.model_dump()
    )
    await ledger.append(event)
    background_tasks.add_task(broadcast_config_update, ["employees"])
    return {"status": "ok", "event_id": event.sequence_number}


@router.put("/roles/{role_id}", dependencies=[Depends(require_manager)])
async def update_role(role_id: str, role: Role, background_tasks: BackgroundTasks,
                      ledger: EventLedger = Depends(get_ledger)):
    event = create_event(
        event_type=EventType.EMPLOYEE_ROLE_UPDATED,
        terminal_id="OVERSEER",
        payload=role.model_dump()
    )
    await ledger.append(event)
    background_tasks.add_task(broadcast_config_update, ["employees"])
    return {"status": "ok", "event_id": event.sequence_number}


@router.delete("/roles/{role_id}", dependencies=[Depends(require_manager)])
async def delete_role(role_id: str, background_tasks: BackgroundTasks, ledger: EventLedger = Depends(get_ledger)):
    event = create_event(
        event_type=EventType.EMPLOYEE_ROLE_DELETED,
        terminal_id="OVERSEER",
        payload={"role_id": role_id}
    )
    await ledger.append(event)
    background_tasks.add_task(broadcast_config_update, ["employees"])
    return {"status": "ok", "event_id": event.sequence_number}


@router.delete("/modifier-groups/{group_id}", dependencies=[Depends(require_manager)])
async def delete_modifier_group(group_id: str, background_tasks: BackgroundTasks,
                                ledger: EventLedger = Depends(get_ledger)):
    """Delete a modifier group."""
    event = create_event(
        event_type=EventType.MODIFIER_GROUP_DELETED,
        terminal_id="OVERSEER",
        payload={"group_id": group_id}
    )
    await ledger.append(event)
    background_tasks.add_task(broadcast_config_update, ["menu"])
    return {"status": "ok", "event_id": event.sequence_number}


@router.post("/employees", dependencies=[Depends(require_manager)])
async def create_employee(employee: Employee, background_tasks: BackgroundTasks,
                          ledger: EventLedger = Depends(get_ledger)):
    # In a real system, we'd use employee.created event,
    # but for now let's stick to the pattern.
    payload = employee.model_dump()
    # PIN-at-rest: hash before the ledger append so the plaintext never
    # hits disk, the audit trail, or any future sync-replay consumer.
    # `ensure_hashed_pin` is idempotent — if caller already hashed, it's
    # a no-op.
    had_pin = bool(payload.get("pin"))
    if had_pin:
        payload["pin"] = ensure_hashed_pin(payload["pin"])
    event = create_event(
        event_type=EventType.EMPLOYEE_CREATED,
        terminal_id="OVERSEER",
        payload=payload,
    )

    # Emit a distinct STAFF_PIN_CHANGED audit record when an initial PIN
    # is set. The payload carries only metadata (no hash, no plaintext)
    # so the security audit trail is safe to replay anywhere. Batched
    # with EMPLOYEE_CREATED so the two events land atomically.
    batch = [event]
    if had_pin:
        batch.append(create_event(
            event_type=EventType.STAFF_PIN_CHANGED,
            terminal_id="OVERSEER",
            payload={
                "employee_id": payload.get("employee_id"),
                "employee_name": (
                    payload.get("display_name")
                    or payload.get("name")
                    or payload.get("employee_id")
                ),
                "change_reason": "Employee created with PIN",
            },
        ))
    await ledger.append_batch(batch)
    background_tasks.add_task(broadcast_config_update, ["employees"])
    return {"status": "ok", "event_id": event.sequence_number}


@router.get("/terminal-bundle")
async def get_terminal_bundle(ledger: EventLedger = Depends(get_ledger)):
    store_service = StoreConfigService(ledger)
    overseer_service = OverseerConfigService(ledger)

    return {
        "bundle_version": 1,
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "store": await store_service.get_projected_config(),
        "employees": await overseer_service.get_employees(),
        "roles": await overseer_service.get_roles(),
        "menu": {
            "categories": await overseer_service.get_menu_categories(),
            "items": await overseer_service.get_menu_items(),
            "modifier_groups": await overseer_service.get_modifier_groups()
        },
        "floor_plan": {
            "sections": await overseer_service.get_floorplan_sections(),
            "layout": await overseer_service.get_floorplan_layout()
        },
        "hardware": {
            "terminals": await overseer_service.get_terminals(),
            "printers": await overseer_service.get_printers(),
            "routing": await overseer_service.get_routing_matrix()
        }
    }


# =============================================================================
# PRICING CONFIG — Discounts & Void Reasons
# =============================================================================

async def _project_discounts(ledger: EventLedger) -> list[dict]:
    """Replay PRICING_DISCOUNT_* events into a current discount list."""
    created = await ledger.get_events_by_type(EventType.PRICING_DISCOUNT_CREATED, limit=500)
    updated = await ledger.get_events_by_type(EventType.PRICING_DISCOUNT_UPDATED, limit=500)
    deleted = await ledger.get_events_by_type(EventType.PRICING_DISCOUNT_DELETED, limit=500)

    discounts: dict[str, dict] = {}
    for ev in sorted(created + updated + deleted, key=lambda e: e.sequence_number or 0):
        p = ev.payload
        if ev.event_type == EventType.PRICING_DISCOUNT_CREATED:
            discounts[p["id"]] = dict(p)
        elif ev.event_type == EventType.PRICING_DISCOUNT_UPDATED:
            if p["id"] in discounts:
                discounts[p["id"]].update(p)
        elif ev.event_type == EventType.PRICING_DISCOUNT_DELETED:
            discounts.pop(p.get("id", ""), None)

    return list(discounts.values())


async def _project_void_reasons(ledger: EventLedger) -> list[dict]:
    """Replay PRICING_VOID_REASON_* events into a current void reason list."""
    created = await ledger.get_events_by_type(EventType.PRICING_VOID_REASON_CREATED, limit=500)
    updated = await ledger.get_events_by_type(EventType.PRICING_VOID_REASON_UPDATED, limit=500)
    deleted = await ledger.get_events_by_type(EventType.PRICING_VOID_REASON_DELETED, limit=500)

    reasons: dict[str, dict] = {}
    for ev in sorted(created + updated + deleted, key=lambda e: e.sequence_number or 0):
        p = ev.payload
        if ev.event_type == EventType.PRICING_VOID_REASON_CREATED:
            reasons[p["id"]] = dict(p)
        elif ev.event_type == EventType.PRICING_VOID_REASON_UPDATED:
            if p["id"] in reasons:
                reasons[p["id"]].update(p)
        elif ev.event_type == EventType.PRICING_VOID_REASON_DELETED:
            reasons.pop(p.get("id", ""), None)

    return list(reasons.values())


# Discount endpoints live on a separate no-prefix router so they land at
# /api/v1/discounts (not /api/v1/config/discounts). Registered in main.py.
discounts_router = APIRouter(tags=["config"])


@discounts_router.get("/discounts")
async def list_discounts(ledger: EventLedger = Depends(get_ledger)):
    """Return all active discounts with a 'pct' field for the terminal disc-select scene."""
    rows = await _project_discounts(ledger)
    result = []
    for r in rows:
        if not r.get("active", True):
            continue
        d = Discount(**r)
        row = d.model_dump(mode="json")
        row["pct"] = float(d.value) if d.type == "percentage" else 0
        result.append(row)
    return result


@discounts_router.post("/discounts", dependencies=[Depends(require_manager)])
async def create_discount(
    discount: Discount,
    background_tasks: BackgroundTasks,
    ledger: EventLedger = Depends(get_ledger),
):
    """Create a new discount definition."""
    if not discount.id:
        discount.id = str(uuid.uuid4())
    event = create_event(
        event_type=EventType.PRICING_DISCOUNT_CREATED,
        terminal_id="OVERSEER",
        payload=discount.model_dump(mode="json"),
    )
    await ledger.append(event)
    background_tasks.add_task(broadcast_config_update, ["pricing"])
    return discount


@discounts_router.delete("/discounts/{discount_id}", dependencies=[Depends(require_manager)])
async def delete_discount(
    discount_id: str,
    background_tasks: BackgroundTasks,
    ledger: EventLedger = Depends(get_ledger),
):
    """Delete (hard-remove) a discount from the catalog."""
    rows = await _project_discounts(ledger)
    if not any(r["id"] == discount_id for r in rows):
        raise HTTPException(status_code=404, detail=f"Discount {discount_id} not found")
    event = create_event(
        event_type=EventType.PRICING_DISCOUNT_DELETED,
        terminal_id="OVERSEER",
        payload={"id": discount_id},
    )
    await ledger.append(event)
    background_tasks.add_task(broadcast_config_update, ["pricing"])
    return {"status": "ok"}


# Void-reason endpoints: config router already has prefix="/config" so
# "/pricing/void-reasons" resolves to /api/v1/config/pricing/void-reasons.
@router.get("/pricing/void-reasons", response_model=List[VoidReason])
async def list_void_reasons(ledger: EventLedger = Depends(get_ledger)):
    """Return all void reasons from the config projection."""
    rows = await _project_void_reasons(ledger)
    return [VoidReason(**r) for r in rows]


@router.post("/pricing/void-reasons", dependencies=[Depends(require_manager)])
async def create_void_reason(
    reason: VoidReason,
    background_tasks: BackgroundTasks,
    ledger: EventLedger = Depends(get_ledger),
):
    """Create a new void reason."""
    if not reason.id:
        reason.id = str(uuid.uuid4())
    event = create_event(
        event_type=EventType.PRICING_VOID_REASON_CREATED,
        terminal_id="OVERSEER",
        payload=reason.model_dump(mode="json"),
    )
    await ledger.append(event)
    background_tasks.add_task(broadcast_config_update, ["pricing"])
    return reason


@router.put("/pricing/void-reasons/{reason_id}", dependencies=[Depends(require_manager)])
async def update_void_reason(
    reason_id: str,
    reason: VoidReason,
    background_tasks: BackgroundTasks,
    ledger: EventLedger = Depends(get_ledger),
):
    """Update an existing void reason."""
    rows = await _project_void_reasons(ledger)
    if not any(r["id"] == reason_id for r in rows):
        raise HTTPException(status_code=404, detail=f"Void reason {reason_id} not found")
    payload = reason.model_dump(mode="json")
    payload["id"] = reason_id
    event = create_event(
        event_type=EventType.PRICING_VOID_REASON_UPDATED,
        terminal_id="OVERSEER",
        payload=payload,
    )
    await ledger.append(event)
    background_tasks.add_task(broadcast_config_update, ["pricing"])
    return reason


@router.delete("/pricing/void-reasons/{reason_id}", dependencies=[Depends(require_manager)])
async def delete_void_reason(
    reason_id: str,
    background_tasks: BackgroundTasks,
    ledger: EventLedger = Depends(get_ledger),
):
    """Delete a void reason."""
    rows = await _project_void_reasons(ledger)
    if not any(r["id"] == reason_id for r in rows):
        raise HTTPException(status_code=404, detail=f"Void reason {reason_id} not found")
    event = create_event(
        event_type=EventType.PRICING_VOID_REASON_DELETED,
        terminal_id="OVERSEER",
        payload={"id": reason_id},
    )
    await ledger.append(event)
    background_tasks.add_task(broadcast_config_update, ["pricing"])
    return {"status": "ok"}


# =============================================================================
# PRICING CONFIG — Day Parts, Specials, Order Types, Employee Discount
# =============================================================================

_DEFAULT_ORDER_TYPES = [
    {"id": "ot_dinein",   "name": "Dine-In",  "adjustment": 0.0, "active": True},
    {"id": "ot_takeout",  "name": "Takeout",  "adjustment": 0.0, "active": True},
    {"id": "ot_delivery", "name": "Delivery", "adjustment": 0.0, "active": True},
]

_DEFAULT_EMPLOYEE_DISCOUNT = {
    "id": "emp_disc",
    "separate_rates": False,
    "percentage": 20,
    "on_duty_rate": 50,
    "off_duty_rate": 20,
    "applies_to": "food_only",
    "exclude_categories": [],
    "requires_pin": True,
    "active": True,
}


async def _project_day_parts(ledger: EventLedger) -> list[dict]:
    created = await ledger.get_events_by_type(EventType.PRICING_DAYPART_CREATED, limit=500)
    updated = await ledger.get_events_by_type(EventType.PRICING_DAYPART_UPDATED, limit=500)
    deleted = await ledger.get_events_by_type(EventType.PRICING_DAYPART_DELETED, limit=500)
    items: dict[str, dict] = {}
    for ev in sorted(created + updated + deleted, key=lambda e: e.sequence_number or 0):
        p = ev.payload
        eid = p.get("id", "")
        if ev.event_type == EventType.PRICING_DAYPART_CREATED:
            items[eid] = dict(p)
        elif ev.event_type == EventType.PRICING_DAYPART_UPDATED:
            if eid in items:
                items[eid].update(p)
        elif ev.event_type == EventType.PRICING_DAYPART_DELETED:
            items.pop(eid, None)
    return list(items.values())


async def _project_specials(ledger: EventLedger) -> list[dict]:
    created = await ledger.get_events_by_type(EventType.PRICING_SPECIAL_CREATED, limit=500)
    updated = await ledger.get_events_by_type(EventType.PRICING_SPECIAL_UPDATED, limit=500)
    deleted = await ledger.get_events_by_type(EventType.PRICING_SPECIAL_DELETED, limit=500)
    items: dict[str, dict] = {}
    for ev in sorted(created + updated + deleted, key=lambda e: e.sequence_number or 0):
        p = ev.payload
        eid = p.get("id", "")
        if ev.event_type == EventType.PRICING_SPECIAL_CREATED:
            items[eid] = dict(p)
        elif ev.event_type == EventType.PRICING_SPECIAL_UPDATED:
            if eid in items:
                items[eid].update(p)
        elif ev.event_type == EventType.PRICING_SPECIAL_DELETED:
            items.pop(eid, None)
    return list(items.values())


async def _project_order_types(ledger: EventLedger) -> list[dict]:
    updated = await ledger.get_events_by_type(EventType.PRICING_ORDER_TYPE_UPDATED, limit=500)
    # Start from defaults so records always exist even with no ledger events
    by_id: dict[str, dict] = {ot["id"]: dict(ot) for ot in _DEFAULT_ORDER_TYPES}
    for ev in sorted(updated, key=lambda e: e.sequence_number or 0):
        p = ev.payload
        eid = p.get("id", "")
        if eid in by_id:
            by_id[eid].update(p)
        else:
            by_id[eid] = dict(p)
    return list(by_id.values())


async def _project_employee_discount(ledger: EventLedger) -> dict:
    events = await ledger.get_events_by_type(EventType.PRICING_EMPLOYEE_DISCOUNT_UPDATED, limit=200)
    events.sort(key=lambda e: e.sequence_number or 0)
    result = dict(_DEFAULT_EMPLOYEE_DISCOUNT)
    for ev in events:
        result.update(ev.payload)
    return result


@router.get("/pricing/day-parts")
async def list_day_parts(ledger: EventLedger = Depends(get_ledger)):
    """Return all day parts from the config projection."""
    return await _project_day_parts(ledger)


@router.get("/pricing/specials")
async def list_specials(ledger: EventLedger = Depends(get_ledger)):
    """Return all specials from the config projection."""
    return await _project_specials(ledger)


@router.get("/pricing/order-types")
async def list_order_types(ledger: EventLedger = Depends(get_ledger)):
    """Return order type pricing adjustments, falling back to defaults when no ledger events exist."""
    return await _project_order_types(ledger)


@router.get("/pricing/employee-discount")
async def get_employee_discount(ledger: EventLedger = Depends(get_ledger)):
    """Return the employee discount policy, falling back to defaults when no ledger events exist."""
    return await _project_employee_discount(ledger)