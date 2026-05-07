"""
Employee clock-record seeder — generates 30 days of USER_LOGGED_IN/OUT events.

Called from sample_order_seeder.seed_sample_orders_if_empty after order events
are written.  Idempotent: skips if any USER_LOGGED_IN events already exist.

Scheduling rules:
  - Servers (role_ids = ["server"])  : clock in every day
  - Cooks   (role_ids = ["cook"])    : 1–2 per day, random selection
  - Managers (role_ids = ["manager"]): Fridays and Saturdays only

OT note: with both servers working all 30 days at 6–9 h/shift each server
naturally exceeds 35 h/week, triggering OT alerts in the payroll section
without any special forcing logic.
"""

import random
from datetime import datetime, timedelta, timezone

from app.core.event_ledger import EventLedger
from app.core.events import create_event, EventType

TERMINAL_ID   = "terminal_01"
DAYS_OF_HISTORY = 30
_CLOCK_SEED   = 43          # distinct from order-seeder seed (42)


# ─── Helpers ─────────────────────────────────────────────────────────────────

def _ts(base_date, hour, minute=0, second=0):
    return datetime(
        base_date.year, base_date.month, base_date.day,
        hour, minute, second, tzinfo=timezone.utc,
    )


def _make_clock_event(event_type, emp, timestamp):
    event = create_event(
        event_type=event_type,
        terminal_id=TERMINAL_ID,
        payload={"employee_id": emp["employee_id"],
                 "employee_name": emp["display_name"]},
        user_id=emp["employee_id"],
    )
    object.__setattr__(event, "timestamp", timestamp)
    return event


def _shift_events(emp, day_date):
    """Return [USER_LOGGED_IN, USER_LOGGED_OUT] for one employee on one day."""
    clock_in_hour = random.choices([10, 10, 11], k=1)[0]
    clock_in_min  = random.randint(0, 30)
    clock_in_ts   = _ts(day_date, clock_in_hour, clock_in_min)

    shift_hours   = random.randint(6, 9)
    clock_out_ts  = clock_in_ts + timedelta(
        hours=shift_hours, minutes=random.randint(0, 30)
    )

    return [
        _make_clock_event(EventType.USER_LOGGED_IN,  emp, clock_in_ts),
        _make_clock_event(EventType.USER_LOGGED_OUT, emp, clock_out_ts),
    ]


# ─── Public API ──────────────────────────────────────────────────────────────

async def seed_clock_records_if_empty(ledger: EventLedger) -> None:
    """Generate 30 days of clock-in/out records if none exist."""
    existing = await ledger.get_events_by_type(EventType.USER_LOGGED_IN, limit=1)
    if existing:
        return

    emp_events = await ledger.get_events_by_type(EventType.EMPLOYEE_CREATED, limit=100)
    if not emp_events:
        print("  [clock seeder] No employees found — skipping clock records")
        return

    staff = []
    for e in emp_events:
        p = e.payload
        staff.append({
            "employee_id":  p["employee_id"],
            "display_name": p.get("display_name", p.get("first_name", "Unknown")),
            "role_ids":     p.get("role_ids", [p.get("role", "server")]),
        })

    # Classify by role — managers who are also servers count as servers for scheduling
    servers  = [s for s in staff
                if "server" in s["role_ids"] and "manager" not in s["role_ids"]]
    cooks    = [s for s in staff if "cook"    in s["role_ids"]]
    managers = [s for s in staff
                if "manager" in s["role_ids"] and "server" not in s["role_ids"]]

    random.seed(_CLOCK_SEED)

    today      = datetime.now(timezone.utc).date()
    start_date = today - timedelta(days=DAYS_OF_HISTORY)

    all_events = []

    for day_offset in range(DAYS_OF_HISTORY):
        day_date   = start_date + timedelta(days=day_offset)
        day_events = []

        # Servers work every day
        for s in servers:
            day_events.extend(_shift_events(s, day_date))

        # Cooks: 1–2 per day
        num_cooks = min(
            random.choices([1, 2], weights=[40, 60], k=1)[0], len(cooks)
        )
        for c in random.sample(cooks, num_cooks) if cooks else []:
            day_events.extend(_shift_events(c, day_date))

        # Managers: Fridays (4) and Saturdays (5) only
        if day_date.weekday() in (4, 5):
            for m in managers:
                day_events.extend(_shift_events(m, day_date))

        day_events.sort(key=lambda e: e.timestamp)
        all_events.extend(day_events)

    if all_events:
        await ledger.append_batch(all_events)
        print(f"  Clock records seeded — {len(all_events)} events "
              f"across {DAYS_OF_HISTORY} days")
