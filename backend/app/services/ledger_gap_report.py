"""Static audit dataset for the /entomology Event Ledger Gaps tab.

Each record is one LG-## node from the event-ledger gap audit. The data is
hand-authored from the audit; it is not derived at runtime from the live
ledger. Consumers: app/api/routes/entomology.py (ledger-gaps endpoint).
"""

from __future__ import annotations

from collections import Counter
from typing import Any

Status = str  # IMPLEMENTED | RENAMED | PARTIAL | FACTORY-ONLY | MISSING
Severity = str  # CRITICAL | HIGH | MEDIUM | LOW


def _node(
    lg_id: str,
    aggregate: str,
    event: str,
    status: Status,
    severity: Severity,
    drop_risk: str,
    site: str = "",
    related_ids: list[str] | None = None,
) -> dict[str, Any]:
    return {
        "id": lg_id,
        "aggregate": aggregate,
        "event": event,
        "status": status,
        "severity": severity,
        "drop_risk": drop_risk,
        "site": site,
        "related_ids": related_ids or [],
    }


_CHECK_NODES: list[dict[str, Any]] = [
    _node("LG-01", "check", "check.opened", "IMPLEMENTED", "CRITICAL",
          "Emitted alongside order.created (create_order) and per child in split_by_seat, all in one append_batch, so the check timeline has a dedicated anchor.",
          site="orders.py:create_order, split_by_seat", related_ids=["LG-02"]),
    _node("LG-02", "check", "order.created", "RENAMED", "CRITICAL",
          "Payload lacks seat_count/cover_count/opened_by. Client-retry idempotency_key is minute-granularity only.",
          site="orders.py:410", related_ids=["LG-01"]),
    _node("LG-03", "check", "check.reopened", "FACTORY-ONLY", "MEDIUM",
          "Factory order.reopened never emitted; reopening a closed check leaves no audit trail.",
          site="events.py:732"),
    _node("LG-04", "check", "check.closed", "RENAMED", "CRITICAL",
          "Renamed to order.closed. Not atomic with payment.confirmed (two separate appends). Crash between the two leaves a paid-but-open ghost.",
          site="orders.py:1225", related_ids=["LG-32"]),
    _node("LG-05", "check", "check.voided", "RENAMED", "CRITICAL",
          "Renamed to order.voided. Multi-step void (refund x N + void) is non-atomic; crash during refund loop = money reversed without order.voided appended.",
          site="orders.py:1267-1345, 1468"),
    _node("LG-06", "check", "check.seat_added", "MISSING", "HIGH",
          "Only coarse seats.updated; no per-seat identity preserved.",
          site="orders.py:818", related_ids=["LG-07", "LG-08", "LG-47"]),
    _node("LG-07", "check", "check.seat_removed", "MISSING", "HIGH",
          "Mirror of LG-06.", related_ids=["LG-06"]),
    _node("LG-08", "check", "check.seat_relabeled", "MISSING", "HIGH",
          "Seat rename never ledgered.", related_ids=["LG-06"]),
    _node("LG-09", "check", "check.server_transferred", "FACTORY-ONLY", "HIGH",
          "order.transferred factory defined but no route emits it. Server swaps invisible to accountability and tip-out.",
          site="events.py:380"),
    _node("LG-10", "check", "check.table_changed", "MISSING", "MEDIUM",
          "Table moves not tracked; revenue-by-table reports wrong if ledger is source."),
    _node("LG-11", "check", "check.cover_count_updated", "FACTORY-ONLY", "MEDIUM",
          "guest_count.updated factory exists; no route calls it.",
          site="events.py:419"),
    _node("LG-12", "check", "check.discount_applied", "RENAMED", "HIGH",
          "Emitted as discount.approved at order level. TOCTOU vs concurrent payment; CHECK vs SEAT scope not differentiable post-hoc.",
          site="orders.py:1520", related_ids=["LG-90"]),
    _node("LG-13", "check", "check.discount_voided", "MISSING", "HIGH",
          "No void-discount event; removing a discount silently alters totals."),
    _node("LG-14", "check", "check.merged_into", "PARTIAL", "HIGH",
          "Single check.merged with role=target. Non-atomic: items copied in loop, merge events, then source voids; crash mid-loop double-counts items.",
          site="orders.py:1359-1482", related_ids=["LG-15"]),
    _node("LG-15", "check", "check.absorbed_by", "PARTIAL", "HIGH",
          "Same op as LG-14 with role=source; same atomicity drop.",
          site="orders.py:1359-1482", related_ids=["LG-14"]),
    _node("LG-16", "check", "check.split_from", "PARTIAL", "HIGH",
          "Single check.split without directional parent<->child. Non-atomic: orphan items if child-creation succeeds but parent-removal fails.",
          site="orders.py:1963-2091"),
    _node("LG-17", "check", "check.seat_sent_out", "MISSING", "HIGH",
          "Cross-check seat transfer not implemented; only whole-check split/merge.",
          related_ids=["LG-18"]),
    _node("LG-18", "check", "check.seat_received", "MISSING", "HIGH",
          "Mirror of LG-17.", related_ids=["LG-17"]),
    _node("LG-19", "check", "check.day_locked", "MISSING", "MEDIUM",
          "No per-check locking on day-close; late edits after day.closed could mutate projections silently."),
    _node("LG-20", "check", "check.named", "FACTORY-ONLY", "MEDIUM",
          "Factory exists; not emitted. Naming a tab ('Smith party') not audited.",
          site="events.py:400"),
    _node("LG-21", "check", "check.abandoned", "IMPLEMENTED", "MEDIUM",
          "Not in spec; consider merging semantics with check.voided or adding to spec.",
          site="orders.py:1044"),
]


_SEAT_NODES: list[dict[str, Any]] = [
    _node("LG-22", "seat", "seat.item_added", "RENAMED", "CRITICAL",
          "Renamed to item.added. Payload lacks seat_id consistently. Modifiers emitted as separate modifier.applied events -- crash after item.added but before modifier appends leaves item with no modifiers.",
          site="orders.py:791, 825-927", related_ids=["LG-43", "LG-44"]),
    _node("LG-23", "seat", "seat.item_voided", "RENAMED", "CRITICAL",
          "Uses item.removed; no void-vs-remove distinction. voided_by absent from payload (only envelope user_id).",
          site="orders.py:897", related_ids=["LG-45"]),
    _node("LG-24", "seat", "seat.item_transferred_out", "MISSING", "HIGH",
          "Seat-level item transfer not implemented; 'move steak from seat 2 to seat 4' appears as void+add.",
          related_ids=["LG-25"]),
    _node("LG-25", "seat", "seat.item_received", "MISSING", "HIGH",
          "Mirror of LG-24.", related_ids=["LG-24"]),
    _node("LG-26", "seat", "seat.item_modified", "RENAMED", "MEDIUM",
          "Renamed to item.modified; lacks seat scope. Tip-out by seat less precise.",
          site="orders.py:922"),
    _node("LG-27", "seat", "seat.course_fired", "PARTIAL", "MEDIUM",
          "item.sent fires per-item, not per-course. KDS expediter cannot replay course-firing order; course bundling lost.",
          site="orders.py:958", related_ids=["LG-46"]),
    _node("LG-28", "seat", "seat.discount_applied", "MISSING", "HIGH",
          "Only order-level discount.approved; per-seat splits with one-seat-comped yield no seat-granular audit."),
    _node("LG-29", "seat", "seat.discount_voided", "MISSING", "HIGH",
          "No void-discount event at any level."),
    _node("LG-30", "seat", "seat.comped", "MISSING", "HIGH",
          "Comps likely recorded as discount.approved with discount_type=comp -- indistinguishable from standard discount for comp-reporting."),
    _node("LG-31", "seat", "seat.payment_initiated", "RENAMED", "CRITICAL",
          "Renamed to payment.initiated. seat_numbers optional in factory and typically absent; split-check payment cannot prove which seat's balance was tendered.",
          site="payment_routes.py:443"),
    _node("LG-32", "seat", "seat.payment_applied", "RENAMED", "CRITICAL",
          "Renamed to payment.confirmed. Order-level only, no seat_id/seat_number. Not atomic with order.closed.",
          site="payment_routes.py:454", related_ids=["LG-04"]),
    _node("LG-33", "seat", "seat.payment_voided", "MISSING", "HIGH",
          "No explicit seat-level payment void; payment.refunded is order-scoped."),
    _node("LG-34", "seat", "seat.overpayment_resolved", "MISSING", "HIGH",
          "Cash overpay audit impossible; disputes cannot be traced."),
    _node("LG-35", "seat", "seat.tip_added", "MISSING", "HIGH",
          "Only payment.tip_adjusted exists; original tip entry is not distinguishable from subsequent adjustment -- the first write is lost."),
    _node("LG-36", "seat", "seat.tip_adjusted", "RENAMED", "HIGH",
          "Renamed to payment.tip_adjusted. adjusted_by missing from payload. Device sync (payment_routes.py:572-589) happens outside ledger scope -- ledger can disagree with processor.",
          site="payment_routes.py:499-600"),
    _node("LG-37", "seat", "seat.paid", "IMPLEMENTED", "CRITICAL",
          "Emitted once per seat in the auto-close batch (both cash and credit paths) when the order becomes fully paid.",
          site="payment_routes.py: process_cash_payment, process_sale"),
    _node("LG-38", "seat", "seat.transferred_out", "MISSING", "HIGH",
          "Whole-seat transfer (with items) not implemented.", related_ids=["LG-39"]),
    _node("LG-39", "seat", "seat.transferred_in", "MISSING", "HIGH",
          "Mirror of LG-38.", related_ids=["LG-38"]),
    _node("LG-40", "seat", "seat.split_from", "MISSING", "HIGH",
          "Splits operate on checks, not seats. One-seat-splits-into-two falls back to check-level split, losing seat identity."),
    _node("LG-41", "seat", "seat.merged_into", "MISSING", "HIGH",
          "Mirror of LG-40."),
    _node("LG-42", "seat", "seat.reopened", "MISSING", "MEDIUM",
          "No seat reopen semantics; re-adding to seat after seat.paid has no directional open event."),
    _node("LG-43", "seat", "modifier.applied", "IMPLEMENTED", "HIGH",
          "Unclear aggregate owner -- spec folds modifiers into seat.item_added payload. Separate-event model creates atomicity gap and harder idempotent replay.",
          site="orders.py:996", related_ids=["LG-22"]),
    _node("LG-44", "seat", "item.added", "IMPLEMENTED", "CRITICAL",
          "See LG-22.", site="orders.py:791", related_ids=["LG-22"]),
    _node("LG-45", "seat", "item.removed", "IMPLEMENTED", "CRITICAL",
          "See LG-23.", site="orders.py:897", related_ids=["LG-23"]),
    _node("LG-46", "seat", "item.sent", "IMPLEMENTED", "MEDIUM",
          "See LG-27.", site="orders.py:958", related_ids=["LG-27"]),
    _node("LG-47", "seat", "seats.updated", "IMPLEMENTED", "HIGH",
          "Coarse-grained; drops per-seat identity. See LG-06.",
          site="orders.py:818", related_ids=["LG-06"]),
]


_DAY_NODES: list[dict[str, Any]] = [
    _node("LG-48", "day", "day.opened", "IMPLEMENTED", "CRITICAL",
          "create_order inserts day.opened at the head of its append_batch whenever no events exist since the last day.closed, anchoring the day boundary atomically with the first order of the day.",
          site="orders.py:create_order"),
    _node("LG-49", "day", "day.cash_float_updated", "MISSING", "HIGH",
          "Drawer float changes not audited; cash variance at close cannot be reconciled against starting float."),
    _node("LG-50", "day", "day.cash_drop", "MISSING", "HIGH",
          "Cash drops to safe not ledgered; manager skim risk without event trail."),
    _node("LG-51", "day", "day.cash_payout", "MISSING", "HIGH",
          "Cash payouts to vendors/staff not tracked."),
    _node("LG-52", "day", "day.flash_report_generated", "MISSING", "LOW",
          "Midday flash reports not anchored."),
    _node("LG-53", "day", "day.closed", "IMPLEMENTED", "CRITICAL",
          "Emitted as second of two appends (after batch.submitted); not atomic with batch. _day_close_lock reduces but does not eliminate the tear. No closed_by in payload.",
          site="orders.py:1781"),
    _node("LG-54", "day", "day.locked", "MISSING", "MEDIUM",
          "No day-frozen semantic after close; late writes can land post-close if caller retries."),
    _node("LG-55", "day", "day.reopened", "MISSING", "LOW",
          "No unlock event."),
]


_STAFF_NODES: list[dict[str, Any]] = [
    _node("LG-56", "staff", "staff.created", "RENAMED", "MEDIUM",
          "Renamed to employee.created. No pin_hash_ref in payload; security-sensitive creation half-audited.",
          site="config.py:415"),
    _node("LG-57", "staff", "staff.updated", "FACTORY-ONLY", "MEDIUM",
          "Factory employee.updated never emitted; profile edits silent."),
    _node("LG-58", "staff", "staff.role_changed", "MISSING", "MEDIUM",
          "Role CRUD tracked but role change on an individual employee is not. Permission escalations invisible to audit."),
    _node("LG-59", "staff", "staff.pin_changed", "IMPLEMENTED", "HIGH",
          "Emitted in an append_batch with employee.created when an initial PIN is set. Payload carries only metadata (no PIN or hash). Future employee-update endpoint should emit the same event.",
          site="config.py:create_employee"),
    _node("LG-60", "staff", "staff.deactivated", "MISSING", "MEDIUM",
          "Termination events lost."),
    _node("LG-61", "staff", "staff.reactivated", "MISSING", "MEDIUM",
          "Rehire events lost."),
    _node("LG-62", "staff", "clock.in", "IMPLEMENTED", "CRITICAL",
          "Emitted in an append_batch alongside user.logged_in in the /staff/clock-in handler. Labor projections can now filter on clock.in without the session-auth semantic collision.",
          site="staff.py:clock_in", related_ids=["LG-63"]),
    _node("LG-63", "staff", "clock.out", "IMPLEMENTED", "CRITICAL",
          "Mirror of LG-62 in the /staff/clock-out handler.",
          site="staff.py:clock_out", related_ids=["LG-62"]),
    _node("LG-64", "staff", "break.started", "MISSING", "HIGH",
          "Break tracking absent; labor-law compliance unprovable from ledger.", related_ids=["LG-65"]),
    _node("LG-65", "staff", "break.ended", "MISSING", "HIGH",
          "Mirror of LG-64.", related_ids=["LG-64"]),
    _node("LG-66", "staff", "clock.edit", "FACTORY-ONLY", "HIGH",
          "timecard.adjusted defined; not emitted. Manual timecard fixes untracked -> wage disputes unprovable."),
    _node("LG-67", "staff", "shift.deleted", "MISSING", "MEDIUM",
          "Full-shift deletions (error correction) unaudited."),
    _node("LG-68", "staff", "payment.cash_tips_declared", "IMPLEMENTED", "MEDIUM",
          "Consider renaming under staff.* namespace for consistency.",
          site="staff.py:109"),
]


_MENU_NODES: list[dict[str, Any]] = [
    _node("LG-69", "menu", "category.created", "RENAMED", "MEDIUM",
          "Emitted as menu.category_created in seeder only; route-driven admin edits may not all emit.",
          site="demo_seeder.py:76, 132"),
    _node("LG-70", "menu", "category.updated", "RENAMED", "MEDIUM",
          "Emitted as menu.category_updated only in overseer service; on-terminal edits drop.",
          site="overseer_config_service.py:167"),
    _node("LG-71", "menu", "category.deactivated", "MISSING", "MEDIUM",
          "Soft-deletes of categories not ledgered; report filters 'active only' may disagree with replay.",
          related_ids=["LG-72"]),
    _node("LG-72", "menu", "category.reactivated", "MISSING", "MEDIUM",
          "Mirror of LG-71.", related_ids=["LG-71"]),
    _node("LG-73", "menu", "item.created", "RENAMED", "MEDIUM",
          "Emitted as menu.item_created in config route + seeders. No coverage in tests for schema-evolution of payload.",
          site="config.py:331"),
    _node("LG-74", "menu", "item.updated", "RENAMED", "MEDIUM",
          "Emitted as menu.item_updated only via overseer service; direct terminal edits bypass ledger.",
          site="overseer_config_service.py:210"),
    _node("LG-75", "menu", "item.price_changed", "MISSING", "HIGH",
          "Critical for tax/discount audit: price history folded into menu.item_updated payload, not a dedicated event. Retro-pricing impossible without replay gymnastics."),
    _node("LG-76", "menu", "item.deactivated", "MISSING", "MEDIUM",
          "Soft-delete not ledgered.", related_ids=["LG-77"]),
    _node("LG-77", "menu", "item.reactivated", "MISSING", "MEDIUM",
          "Mirror of LG-76.", related_ids=["LG-76"]),
    _node("LG-78", "menu", "item.86ed", "RENAMED", "HIGH",
          "Emitted as menu.item_86d. Payload lacks expected_return_at; re-stock ETAs not projectable.",
          site="config.py:344"),
    _node("LG-79", "menu", "item.86_cleared", "RENAMED", "HIGH",
          "Emitted as menu.item_restored. OK.",
          site="config.py:356"),
    _node("LG-80", "menu", "modifier.created", "MISSING", "HIGH",
          "Only modifier.group_* factories exist; individual modifier CRUD missing. Whole modifier lifecycle not audited."),
    _node("LG-81", "menu", "modifier.updated", "MISSING", "HIGH",
          "Same as LG-80.", related_ids=["LG-80"]),
    _node("LG-82", "menu", "modifier.price_changed", "MISSING", "HIGH",
          "Same as LG-75 but for modifiers."),
    _node("LG-83", "menu", "modifier.deactivated_or_reactivated", "MISSING", "MEDIUM",
          "Modifier (de)activation lifecycle absent."),
    _node("LG-84", "menu", "modifier.86ed_or_86_cleared", "MISSING", "HIGH",
          "Modifier 86 state absent."),
    _node("LG-85", "menu", "micromod.*", "MISSING", "MEDIUM",
          "Entire micromod concept absent from codebase. If forthcoming, must land with ledger support from day 1."),
    _node("LG-86", "menu", "special.*", "MISSING", "MEDIUM",
          "No specials audit trail; happy-hour windows not replayable."),
]


_DISCOUNT_NODES: list[dict[str, Any]] = [
    _node("LG-87", "discount", "discount.created", "MISSING", "MEDIUM",
          "No CRUD events; discount.approved captures applications, not definitions. Catalog history unrecoverable."),
    _node("LG-88", "discount", "discount.updated", "MISSING", "MEDIUM",
          "Same as LG-87."),
    _node("LG-89", "discount", "discount.deactivated_or_reactivated", "MISSING", "MEDIUM",
          "Same as LG-87."),
    _node("LG-90", "discount", "discount.approved", "IMPLEMENTED", "HIGH",
          "No discount_id reference in payload -- payload lists discount_type as free string. Loose coupling means renames/updates of the catalog cannot be reconciled with historical applications.",
          site="orders.py:1520", related_ids=["LG-12"]),
]


_BATCH_NODES: list[dict[str, Any]] = [
    _node("LG-91", "batch", "batch.opened", "MISSING", "HIGH",
          "No batch-open marker. 'Which check is in which batch' inferable only by timestamp window."),
    _node("LG-92", "batch", "batch.settlement_initiated", "MISSING", "HIGH",
          "Cannot distinguish 'sent to processor' from 'settled'."),
    _node("LG-93", "batch", "batch.settled", "RENAMED", "HIGH",
          "Emitted as batch.submitted. Semantic ambiguity: submitted != settled. Failed settlements still show as batch.submitted with no failure counterpart.",
          site="orders.py:1728"),
    _node("LG-94", "batch", "batch.settlement_failed", "MISSING", "HIGH",
          "Fatal drop: a batch can fail at the processor and leave the ledger claiming success."),
    _node("LG-95", "batch", "batch.reopened", "MISSING", "MEDIUM",
          "Reopened batches (next-day corrections) unaudited."),
]


_TIPOUT_NODES: list[dict[str, Any]] = [
    _node("LG-96", "tipout", "tipout.rule_created", "FACTORY-ONLY", "HIGH",
          "Defined but unemitted; rule changes silent."),
    _node("LG-97", "tipout", "tipout.rule_updated", "FACTORY-ONLY", "HIGH",
          "Same as LG-96."),
    _node("LG-98", "tipout", "tipout.rule_deactivated", "MISSING", "MEDIUM",
          "Only tipout.rule_deleted factory present; distinction lost."),
    _node("LG-99", "tipout", "tipout.calculated", "MISSING", "HIGH",
          "Tipout math result not ledgered. Disputes over 'why did I get $X' cannot be replayed."),
    _node("LG-100", "tipout", "tipout.adjusted", "MISSING", "HIGH",
          "Manual override events missing."),
    _node("LG-101", "tipout", "tipout.distributed", "MISSING", "HIGH",
          "Pay-out event missing; no audit that distribution actually occurred."),
]


_CONFIG_NODES: list[dict[str, Any]] = [
    _node("LG-102", "config", "store.info_updated", "IMPLEMENTED", "MEDIUM",
          "OK.", site="config.py:268"),
    _node("LG-103", "config", "tax.rate_updated", "MISSING", "MEDIUM",
          "Code uses store.tax_rule_* factories instead; none emitted from routes. Tax-rate history lost."),
    _node("LG-104", "config", "terminal.settings_updated", "FACTORY-ONLY", "MEDIUM",
          "terminal.updated defined; never emitted."),
    _node("LG-105", "config", "printer.configured", "MISSING", "HIGH",
          "Only printer.registered factory exists. Adding/reconfiguring printers silently."),
    _node("LG-106", "config", "printer.removed", "MISSING", "HIGH",
          "Printer decommissions unaudited."),
    _node("LG-107", "config", "printer.assignment_changed", "MISSING", "HIGH",
          "Routing changes (which printer gets which category) unaudited. 'Why did ticket print in wrong station' unanswerable from ledger."),
    _node("LG-108", "config", "payment.processor_configured", "MISSING", "HIGH",
          "Critical: processor credential changes unaudited -- PCI compliance gap."),
    _node("LG-109", "config", "security.setting_updated", "MISSING", "HIGH",
          "Critical: security policy changes (lockout, 2FA, session TTL) unaudited."),
]


_IMPORT_NODES: list[dict[str, Any]] = [
    _node("LG-110", "import", "menu.import_started", "MISSING", "HIGH",
          "No import lifecycle; partial imports cannot be tied back to a root event."),
    _node("LG-111", "import", "menu.import_completed", "MISSING", "HIGH",
          "Same as LG-110."),
    _node("LG-112", "import", "menu.import_failed", "MISSING", "HIGH",
          "Mid-import crash leaves orphan menu events with no failure marker."),
    _node("LG-113", "import", "menu.import_rolled_back", "MISSING", "HIGH",
          "No rollback semantics."),
]


_TELEMETRY_NODES: list[dict[str, Any]] = [
    _node("LG-114", "telemetry", "ticket.print_lifecycle", "FACTORY-ONLY", "MEDIUM",
          "ticket.printed / ticket.print_failed / ticket.reprinted factories never actually appended from print pipeline. Print attempts invisible to ledger.",
          site="events.py:865, 888, 918"),
    _node("LG-115", "telemetry", "print.retry_reroute", "FACTORY-ONLY", "MEDIUM",
          "print.retrying / print.rerouted factories; same pipeline gap as LG-114.",
          site="events.py:948, 984"),
    _node("LG-116", "telemetry", "drawer.open_events", "FACTORY-ONLY", "HIGH",
          "drawer.opened / drawer.open_failed factories; no manual drawer-open audit (cash control). Unauthorized opens undetectable.",
          site="events.py:1228, 1362"),
    _node("LG-117", "telemetry", "printer.health_family", "FACTORY-ONLY", "MEDIUM",
          "Eight printer.* health events defined; not wired into status monitor.",
          site="events.py:1020-1200"),
    _node("LG-118", "telemetry", "device.status_changed", "IMPLEMENTED", "MEDIUM",
          "OK -- payment-terminal health events actually flow.",
          site="payment_routes.py:325"),
]


LEDGER_GAP_NODES: list[dict[str, Any]] = [
    *_CHECK_NODES,
    *_SEAT_NODES,
    *_DAY_NODES,
    *_STAFF_NODES,
    *_MENU_NODES,
    *_DISCOUNT_NODES,
    *_BATCH_NODES,
    *_TIPOUT_NODES,
    *_CONFIG_NODES,
    *_IMPORT_NODES,
    *_TELEMETRY_NODES,
]


AGGREGATE_ORDER: list[str] = [
    "check", "seat", "day", "staff", "menu", "discount",
    "batch", "tipout", "config", "import", "telemetry",
]


def aggregate_summary(nodes: list[dict[str, Any]]) -> dict[str, Any]:
    """Return totals, status breakdown, severity breakdown, and per-aggregate counts.

    Shape:
        {
          "total": int,
          "by_status": {"MISSING": n, ...},
          "by_severity": {"CRITICAL": n, ...},
          "aggregates": [
            {"name": "check", "total": n, "by_status": {...}, "by_severity": {...}},
            ...
          ],
        }
    """
    by_status = Counter(n["status"] for n in nodes)
    by_severity = Counter(n["severity"] for n in nodes)

    seen_aggs = {n["aggregate"] for n in nodes}
    ordered = [a for a in AGGREGATE_ORDER if a in seen_aggs]
    ordered += sorted(seen_aggs - set(AGGREGATE_ORDER))

    per_agg = []
    for name in ordered:
        group = [n for n in nodes if n["aggregate"] == name]
        per_agg.append({
            "name": name,
            "total": len(group),
            "by_status": dict(Counter(n["status"] for n in group)),
            "by_severity": dict(Counter(n["severity"] for n in group)),
        })

    return {
        "total": len(nodes),
        "by_status": dict(by_status),
        "by_severity": dict(by_severity),
        "aggregates": per_agg,
    }
