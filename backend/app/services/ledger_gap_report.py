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
    _node("LG-03", "check", "check.reopened", "IMPLEMENTED", "MEDIUM",
          "Emitted as order.reopened by /orders/{id}/reopen (and in an append_batch when reopen is part of a larger flow).",
          site="orders.py:reopen_order"),
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
    _node("LG-09", "check", "check.server_transferred", "IMPLEMENTED", "HIGH",
          "Emitted as order.transferred by PATCH /orders/{id} (server_id field) and /server-shift.",
          site="orders.py:patch_order, server_shift.py"),
    _node("LG-10", "check", "check.table_changed", "IMPLEMENTED", "MEDIUM",
          "PATCH /orders/{id} with a new table field now emits check.table_changed (previous_table + new_table + changed_by) inside the same append_batch as other field patches. Same-table PATCH is a no-op.",
          site="orders.py:patch_order"),
    _node("LG-11", "check", "check.cover_count_updated", "IMPLEMENTED", "MEDIUM",
          "Emitted as guest_count.updated by PATCH /orders/{id} (guest_count field), in the same append_batch as any other simultaneous field patches.",
          site="orders.py:patch_order"),
    _node("LG-12", "check", "check.discount_applied", "RENAMED", "HIGH",
          "Emitted as discount.approved at order level. TOCTOU vs concurrent payment; CHECK vs SEAT scope not differentiable post-hoc.",
          site="orders.py:1520", related_ids=["LG-90"]),
    _node("LG-13", "check", "check.discount_voided", "IMPLEMENTED", "HIGH",
          "POST /orders/{id}/discount/void emits discount.voided; projection removes the matching discount from order.discounts (by discount_id when supplied, else by type+amount).",
          site="orders.py:void_discount"),
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
    _node("LG-20", "check", "check.named", "IMPLEMENTED", "MEDIUM",
          "Emitted by PATCH /orders/{id} (customer_name field), batched with any concurrent field updates.",
          site="orders.py:patch_order"),
    _node("LG-21", "check", "check.abandoned", "IMPLEMENTED", "MEDIUM",
          "Not in spec; consider merging semantics with check.voided or adding to spec.",
          site="orders.py:1044"),
]


_SEAT_NODES: list[dict[str, Any]] = [
    _node("LG-22", "seat", "seat.item_added", "RENAMED", "CRITICAL",
          "Renamed to item.added. Payload lacks seat_id consistently. Modifiers emitted as separate modifier.applied events -- crash after item.added but before modifier appends leaves item with no modifiers.",
          site="orders.py:791, 825-927", related_ids=["LG-43", "LG-44"]),
    _node("LG-23", "seat", "seat.item_voided", "RENAMED", "CRITICAL",
          "Uses item.removed. Payload now accepts an optional voided_by so audit callers can distinguish comp/waste/server-error from plain remove; Phase 3b will emit a distinct seat.item_voided.",
          site="orders.py:remove_item", related_ids=["LG-45"]),
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
    _node("LG-34", "seat", "seat.overpayment_resolved", "IMPLEMENTED", "HIGH",
          "Emitted in the cash-payment auto-close batch when req_amount clamps down to balance (resolution=change) and in the credit-sale route when overage routes to tip (resolution=tip). Payload carries amount + resolution + payment_id.",
          site="payment_routes.py:process_cash_payment, process_sale"),
    _node("LG-35", "seat", "seat.tip_added", "IMPLEMENTED", "HIGH",
          "Emitted in an append_batch alongside payment.tip_adjusted when previous_tip==0 and the new tip_amount>0 (zero-amount settlement sweeps do not re-fire). Lets reporting distinguish first-tip from subsequent adjustments.",
          site="payment_routes.py:adjust_tip"),
    _node("LG-36", "seat", "seat.tip_adjusted", "RENAMED", "HIGH",
          "Emitted as payment.tip_adjusted. Payload now accepts adjusted_by; device sync still happens outside the ledger scope so a failed device-side tip update can still drift from the ledger.",
          site="payment_routes.py:adjust_tip"),
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
    _node("LG-49", "day", "day.cash_float_updated", "IMPLEMENTED", "HIGH",
          "Emitted by POST /day/cash/float (manager-gated). Payload carries amount, previous_float (auto-derived from last float event since the previous day.closed), set_by, and reason.",
          site="day_cash.py:update_cash_float"),
    _node("LG-50", "day", "day.cash_drop", "IMPLEMENTED", "HIGH",
          "Emitted by POST /day/cash/drop (manager-gated). Payload carries amount, approved_by, reason, and an optional deposit_ref so safe reconciliation can match ledger drops to the physical deposit log.",
          site="day_cash.py:record_cash_drop"),
    _node("LG-51", "day", "day.cash_payout", "IMPLEMENTED", "HIGH",
          "Emitted by POST /day/cash/payout (manager-gated). Payload carries amount, recipient (required), approved_by, reason, and optional category for spend reporting.",
          site="day_cash.py:record_cash_payout"),
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
    _node("LG-57", "staff", "staff.updated", "IMPLEMENTED", "MEDIUM",
          "Dark-shipped enum + factory. Emittable via /config/push for non-PIN/non-role profile edits (name, email, hourly rate) with fields_changed. PIN rotations route to staff.pin_changed; role changes route to staff.role_changed.",
          site="events.py:staff_updated, config.py:push_changes"),
    _node("LG-58", "staff", "staff.role_changed", "IMPLEMENTED", "MEDIUM",
          "Permission-escalation audit anchor with previous_role_ids + new_role_ids + changed_by; emittable via /config/push.",
          site="events.py:staff_role_changed, config.py:push_changes"),
    _node("LG-59", "staff", "staff.pin_changed", "IMPLEMENTED", "HIGH",
          "Emitted in an append_batch with employee.created when an initial PIN is set. Payload carries only metadata (no PIN or hash). Future employee-update endpoint should emit the same event.",
          site="config.py:create_employee"),
    _node("LG-60", "staff", "staff.deactivated", "IMPLEMENTED", "MEDIUM",
          "Soft-delete audit anchor (distinct from EMPLOYEE_DELETED hard removal). Emittable via /config/push with deactivated_by + reason; historical shift/sales records stay valid.",
          site="events.py:staff_deactivated, config.py:push_changes"),
    _node("LG-61", "staff", "staff.reactivated", "IMPLEMENTED", "MEDIUM",
          "Rehire audit anchor; undo for staff.deactivated. Emittable via /config/push.",
          site="events.py:staff_reactivated, config.py:push_changes"),
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
    _node("LG-66", "staff", "clock.edit", "IMPLEMENTED", "HIGH",
          "Dedicated enum + factory; carries field / previous_value / new_value / edited_by / reason so wage-dispute audits can replay the full correction history. Emittable via /config/push.",
          site="events.py:clock_edit, config.py:push_changes"),
    _node("LG-67", "staff", "shift.deleted", "IMPLEMENTED", "MEDIUM",
          "Deleted-shift audit anchor (employee_id + shift_id + deleted_by + reason) via /config/push so error corrections stay traceable.",
          site="events.py:shift_deleted, config.py:push_changes"),
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
    _node("LG-71", "menu", "category.deactivated", "IMPLEMENTED", "MEDIUM",
          "Dedicated soft-delete event (distinct from MENU_CATEGORY_DELETED hard removal). Emittable via /config/push.",
          site="events.py:category_deactivated, config.py:push_changes",
          related_ids=["LG-72"]),
    _node("LG-72", "menu", "category.reactivated", "IMPLEMENTED", "MEDIUM",
          "Undo for category.deactivated. Emittable via /config/push.",
          site="events.py:category_reactivated, config.py:push_changes",
          related_ids=["LG-71"]),
    _node("LG-73", "menu", "item.created", "RENAMED", "MEDIUM",
          "Emitted as menu.item_created in config route + seeders. No coverage in tests for schema-evolution of payload.",
          site="config.py:331"),
    _node("LG-74", "menu", "item.updated", "RENAMED", "MEDIUM",
          "Emitted as menu.item_updated only via overseer service; direct terminal edits bypass ledger.",
          site="overseer_config_service.py:210"),
    _node("LG-75", "menu", "item.price_changed", "IMPLEMENTED", "HIGH",
          "Dedicated event for menu-item price deltas (previous_price + new_price + changed_by). Emittable via /config/push so historical-pricing replay survives without re-projecting the full menu catalog.",
          site="events.py:item_price_changed, config.py:push_changes"),
    _node("LG-76", "menu", "item.deactivated", "IMPLEMENTED", "MEDIUM",
          "Emittable via /config/push; soft-delete marker so historical references stay valid.",
          site="events.py:item_deactivated, config.py:push_changes",
          related_ids=["LG-77"]),
    _node("LG-77", "menu", "item.reactivated", "IMPLEMENTED", "MEDIUM",
          "Mirror of LG-76.",
          site="events.py:item_reactivated, config.py:push_changes",
          related_ids=["LG-76"]),
    _node("LG-78", "menu", "item.86ed", "IMPLEMENTED", "HIGH",
          "item.86ed now emitted in an append_batch alongside menu.item_86d on /menu/86. Payload still lacks expected_return_at (follow-up).",
          site="config.py:item_86"),
    _node("LG-79", "menu", "item.86_cleared", "IMPLEMENTED", "HIGH",
          "item.86_cleared emitted in an append_batch alongside menu.item_restored on /menu/restore.",
          site="config.py:item_restore"),
    _node("LG-80", "menu", "modifier.created", "IMPLEMENTED", "HIGH",
          "Enum + factory live; emitted via /config/push when an overseer pushes a modifier.created change. Sits alongside the existing modifier.group_* events for the parent grouping.",
          site="events.py:modifier_created, config.py:push_changes"),
    _node("LG-81", "menu", "modifier.updated", "IMPLEMENTED", "HIGH",
          "Emitted via /config/push for non-price changes (name, sort, group). Payload carries fields_changed so projections can apply minimal diffs.",
          site="events.py:modifier_updated, config.py:push_changes",
          related_ids=["LG-80"]),
    _node("LG-82", "menu", "modifier.price_changed", "IMPLEMENTED", "HIGH",
          "Dedicated event for price deltas with previous_price and new_price; lets historical-pricing replay survive without re-projecting the full modifier catalog.",
          site="events.py:modifier_price_changed, config.py:push_changes"),
    _node("LG-83", "menu", "modifier.deactivated_or_reactivated", "IMPLEMENTED", "MEDIUM",
          "modifier.deactivated soft-deletes a modifier from new orders; modifier.reactivated undoes it. Both flow via /config/push.",
          site="events.py:modifier_deactivated/reactivated, config.py:push_changes"),
    _node("LG-84", "menu", "modifier.86ed_or_86_cleared", "IMPLEMENTED", "HIGH",
          "modifier.86ed marks temporary out-of-stock; modifier.86_cleared restores. Distinct from deactivated/reactivated which is a permanent catalog change.",
          site="events.py:modifier_86ed/86_cleared, config.py:push_changes"),
    _node("LG-85", "menu", "micromod.*", "IMPLEMENTED", "MEDIUM",
          "Dark-shipped: 9 enum entries (micromod.created / updated / price_changed / deactivated / reactivated / assigned_to_modifier / unassigned_from_modifier / 86ed / 86_cleared) plus factories exist and are emittable via /config/push. The overseer micromod feature can land without an events-table schema change; emission flips to active use when the UI starts pushing.",
          site="events.py:micromod_* factories, config.py:push_changes"),
    _node("LG-86", "menu", "special.*", "IMPLEMENTED", "MEDIUM",
          "Four new enum entries (special.created / updated / activated / deactivated) with matching factories; emittable via /config/push. Happy-hour windows and scheduled specials are now replayable from the ledger.",
          site="events.py:special_* factories, config.py:push_changes"),
]


_DISCOUNT_NODES: list[dict[str, Any]] = [
    _node("LG-87", "discount", "discount.created", "MISSING", "MEDIUM",
          "No CRUD events; discount.approved captures applications, not definitions. Catalog history unrecoverable."),
    _node("LG-88", "discount", "discount.updated", "MISSING", "MEDIUM",
          "Same as LG-87."),
    _node("LG-89", "discount", "discount.deactivated_or_reactivated", "MISSING", "MEDIUM",
          "Same as LG-87."),
    _node("LG-90", "discount", "discount.approved", "IMPLEMENTED", "HIGH",
          "Payload now accepts optional discount_id so catalog references survive catalog renames; callers that only pass discount_type still get the audit record.",
          site="orders.py:apply_discount", related_ids=["LG-12"]),
]


_BATCH_NODES: list[dict[str, Any]] = [
    _node("LG-91", "batch", "batch.opened", "MISSING", "HIGH",
          "No batch-open marker. 'Which check is in which batch' inferable only by timestamp window."),
    _node("LG-92", "batch", "batch.settlement_initiated", "MISSING", "HIGH",
          "Cannot distinguish 'sent to processor' from 'settled'."),
    _node("LG-93", "batch", "batch.settled", "RENAMED", "HIGH",
          "Emitted as batch.submitted. Semantic ambiguity: submitted != settled. Failed settlements still show as batch.submitted with no failure counterpart.",
          site="orders.py:1728"),
    _node("LG-94", "batch", "batch.settlement_failed", "IMPLEMENTED", "HIGH",
          "Emitted in the _do_close_day append_batch alongside batch.submitted + day.closed whenever the close-day invariant gate reports one or more failures. Payload carries reason, recon_diff, and a list of failed_invariants so the ledger distinguishes a clean close from a drifted one.",
          site="orders.py:_do_close_day"),
    _node("LG-95", "batch", "batch.reopened", "MISSING", "MEDIUM",
          "Reopened batches (next-day corrections) unaudited."),
]


_TIPOUT_NODES: list[dict[str, Any]] = [
    _node("LG-96", "tipout", "tipout.rule_created", "FACTORY-ONLY", "HIGH",
          "Defined but unemitted; rule changes silent."),
    _node("LG-97", "tipout", "tipout.rule_updated", "FACTORY-ONLY", "HIGH",
          "Same as LG-96."),
    _node("LG-98", "tipout", "tipout.rule_deactivated", "IMPLEMENTED", "MEDIUM",
          "Dedicated soft-delete event distinct from TIPOUT_RULE_DELETED. Emittable via /config/push.",
          site="events.py:tipout_rule_deactivated, config.py:push_changes"),
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
    _node("LG-103", "config", "tax.rate_updated", "RENAMED", "MEDIUM",
          "Emitted as store.tax_rule_created / updated / deleted via /config/push. The spec's single tax.rate_updated maps to the existing three-event store.tax_rule_* family; semantics preserved.",
          site="events.py:EventType.STORE_TAX_RULE_*, config.py:push_changes"),
    _node("LG-104", "config", "terminal.settings_updated", "RENAMED", "MEDIUM",
          "Emittable as terminal.updated via /config/push. The spec's terminal.settings_updated is the same event under a different name.",
          site="events.py:EventType.TERMINAL_UPDATED, config.py:push_changes"),
    _node("LG-105", "config", "printer.configured", "IMPLEMENTED", "HIGH",
          "Emitted by POST /hardware/devices when a new MAC is saved; payload carries mac/ip/type/name plus categories for kitchen printers.",
          site="hardware.py:save_device"),
    _node("LG-106", "config", "printer.removed", "IMPLEMENTED", "HIGH",
          "Emitted by DELETE /hardware/devices/{mac} after the DB row is deleted; payload carries the pre-delete name and type for audit continuity.",
          site="hardware.py:delete_device"),
    _node("LG-107", "config", "printer.assignment_changed", "IMPLEMENTED", "HIGH",
          "Emitted by POST /hardware/devices when an existing printer's category list changes; payload carries previous_categories + new_categories so routing drift is auditable.",
          site="hardware.py:save_device"),
    _node("LG-108", "config", "payment.processor_configured", "IMPLEMENTED", "HIGH",
          "Emitted by POST /hardware/devices when a card reader is saved. Payload carries mac/ip/name/register_id; tpn and auth_key are deliberately excluded so the audit record cannot leak credentials.",
          site="hardware.py:save_device"),
    _node("LG-109", "config", "security.setting_updated", "IMPLEMENTED", "HIGH",
          "PCI/SOX compliance anchor: carries setting_key + previous_value + new_value + updated_by. Payload deliberately uses string values so secrets never land on the ledger. Emittable via /config/push.",
          site="events.py:security_setting_updated, config.py:push_changes"),
]


_IMPORT_NODES: list[dict[str, Any]] = [
    _node("LG-110", "import", "menu.import_started", "IMPLEMENTED", "HIGH",
          "config/push now wraps any batch containing menu.*, category.*, modifier.*, restaurant.configured, or *_batch_created events with menu.import_started as the leading event. Correlated by import_id.",
          site="config.py:push_changes"),
    _node("LG-111", "import", "menu.import_completed", "IMPLEMENTED", "HIGH",
          "Trailing event of the same config/push batch when append_batch succeeds. event_count matches the number of menu events that landed.",
          site="config.py:push_changes"),
    _node("LG-112", "import", "menu.import_failed", "IMPLEMENTED", "HIGH",
          "Emitted as a standalone append when the wrapped append_batch raises. Atomic semantics mean nothing menu-related committed; this event is the sole record of the attempt.",
          site="config.py:push_changes"),
    _node("LG-113", "import", "menu.import_rolled_back", "FACTORY-ONLY", "HIGH",
          "Enum + factory live; emission awaits an overseer rollback endpoint that reverses a previously-completed import_id. Dark-shipped so future rollback routes can emit without a schema change.",
          site="events.py:menu_import_rolled_back"),
]


_TELEMETRY_NODES: list[dict[str, Any]] = [
    _node("LG-114", "telemetry", "ticket.print_lifecycle", "IMPLEMENTED", "MEDIUM",
          "ticket.printed / ticket.print_failed / ticket.reprinted all emitted from PrinterManager.print_job on success, failure, and reprint paths.",
          site="printer_manager.py:ticket_printed/ticket_print_failed/ticket_reprinted"),
    _node("LG-115", "telemetry", "print.retry_reroute", "IMPLEMENTED", "MEDIUM",
          "print.retrying emitted on retry attempts; print.rerouted emitted when the fallback printer takes over.",
          site="printer_manager.py:print_retrying/print_rerouted"),
    _node("LG-116", "telemetry", "drawer.open_events", "IMPLEMENTED", "HIGH",
          "drawer.opened / drawer.open_failed both emitted from PrinterManager.open_drawer on success and failure.",
          site="printer_manager.py:open_drawer"),
    _node("LG-117", "telemetry", "printer.health_family", "IMPLEMENTED", "MEDIUM",
          "printer.registered, printer.role_created, printer.fallback_assigned, printer.status_changed, printer.health_warning, printer.reboot_started/completed, printer.error all emitted by PrinterManager.",
          site="printer_manager.py:registration/health/reboot paths"),
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
