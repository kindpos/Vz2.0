"""
Sample order seeder — generates 30 days of realistic BBQ truck order history.

Called automatically on first boot (when no orders exist) so the dashboard
graphs are populated for demos.  Idempotent: skips if ORDER_CREATED events
already exist in the ledger.
"""

import random
import uuid
from datetime import datetime, timedelta, timezone
from decimal import Decimal

from app.core.event_ledger import EventLedger
from app.core.events import create_event, EventType
from app.core.money import money_round

# ─── Configuration ───────────────────────────────────────────────────────────

TERMINAL_ID = "terminal_01"
TAX_RATE = Decimal("0.06")
CASH_DISCOUNT_RATE = Decimal("0.04")
DAYS_OF_HISTORY = 30
SEED = 42

WINDOW_SEATS = ["W1", "W2", "W3", "W4", "W5", "W6"]
PATIO_SEATS  = ["T1", "T2", "T3", "T4"]

# Mandatory modifier options per item_id: list of (modifier_id, display_name)
MANDATORY_MODS = {
    "burrito":      [("mild",           "Mild"),
                     ("spicy",          "Spicy")],
    "cheeseburger": [("regular_burger", "Cheeseburger"),
                     ("mac_burger",     "Mac Burger")],
    "pop":          [("pepsi",          "Pepsi"),
                     ("diet_pepsi",     "Diet Pepsi"),
                     ("mtn_dew",        "Mtn Dew"),
                     ("dr_pepper",      "Dr. Pepper"),
                     ("diet_drp",       "Diet Dr. P")],
    "chips":        [("doritos",        "Doritos"),
                     ("cheetos",        "Cheetos")],
}

# Items eligible for the optional sour-cream add-on (30% chance)
SOUR_CREAM_ITEMS = frozenset({
    "burrito", "pork_nachos", "chicken_nachos", "brisket_nachos",
    "pork_mac", "brisket_mac", "meat_mac",
})


# ─── Helpers ─────────────────────────────────────────────────────────────────

def _ts(base_date, hour, minute=0, second=0):
    return datetime(
        base_date.year, base_date.month, base_date.day,
        hour, minute, second, tzinfo=timezone.utc,
    )


def _make_event(event_type, payload, timestamp, user_id=None, correlation_id=None):
    event = create_event(
        event_type=event_type,
        terminal_id=TERMINAL_ID,
        payload=payload,
        user_id=user_id,
        correlation_id=correlation_id,
    )
    object.__setattr__(event, "timestamp", timestamp)
    return event


def _pick_table():
    """60 % window seats, 40 % patio seats."""
    if random.random() < 0.60:
        return random.choice(WINDOW_SEATS)
    return random.choice(PATIO_SEATS)


def _order_volume(day_date):
    dow = day_date.weekday()
    if dow == 4:       # Friday
        base = random.randint(45, 60)
    elif dow == 5:     # Saturday
        base = random.randint(50, 65)
    elif dow == 6:     # Sunday
        base = random.randint(30, 40)
    else:
        base = random.randint(25, 40)
    return max(15, base + random.randint(-5, 5))


def _pick_order_hour():
    weights = {
        11: 12, 12: 15, 13: 13, 14: 8,
        15: 4,  16: 5,
        17: 10, 18: 14, 19: 15, 20: 12, 21: 6,
    }
    return random.choices(list(weights.keys()), weights=list(weights.values()), k=1)[0]


def _build_weighted_items(menu_items):
    """Build weighted item pool — BBQ-truck category weights."""
    category_weights = {
        "Mains":  12,
        "Loaded": 10,
        "Sides":   5,
        "Drinks": 15,
        "Snacks":  8,
    }
    weighted = []
    for item in menu_items:
        # Accept both "category" (display name) and "category_id" (slug)
        cat = item.get("category") or item.get("category_id", "")
        base_w = category_weights.get(cat, 5)
        price = item.get("price", 10)
        if price <= 5:
            base_w = int(base_w * 1.5)
        elif price >= 15:
            base_w = max(3, base_w // 2)
        weighted.extend([item] * base_w)
    return weighted


def _pick_items(weighted_items):
    num = random.choices([1, 2, 3, 4, 5], weights=[8, 25, 35, 22, 10], k=1)[0]
    return [random.choice(weighted_items) for _ in range(num)]


def _mod_events(order_id, item_id, item_menu_id, item_ts):
    """Return MODIFIER_APPLIED events for mandatory + optional sour cream."""
    events = []

    if item_menu_id in MANDATORY_MODS:
        mod_id, mod_name = random.choice(MANDATORY_MODS[item_menu_id])
        events.append(_make_event(
            EventType.MODIFIER_APPLIED,
            {
                "order_id":      order_id,
                "item_id":       item_id,
                "modifier_id":   mod_id,
                "modifier_name": mod_name,
                "price":         0.00,
            },
            item_ts + timedelta(seconds=2),
            correlation_id=order_id,
        ))

    if item_menu_id in SOUR_CREAM_ITEMS and random.random() < 0.30:
        events.append(_make_event(
            EventType.MODIFIER_APPLIED,
            {
                "order_id":      order_id,
                "item_id":       item_id,
                "modifier_id":   "sour_cream_add",
                "modifier_name": "Sour Cream",
                "price":         0.00,
            },
            item_ts + timedelta(seconds=3),
            correlation_id=order_id,
        ))

    return events


def _emit_payment(events, order_id, pay_id, amount, method, ts):
    """Append PAYMENT_INITIATED + PAYMENT_CONFIRMED to events list."""
    events.append(_make_event(
        EventType.PAYMENT_INITIATED,
        {"order_id": order_id, "payment_id": pay_id,
         "amount": float(amount), "method": method},
        ts,
        correlation_id=order_id,
    ))
    confirm_ts = ts + timedelta(seconds=random.randint(3, 15))
    events.append(_make_event(
        EventType.PAYMENT_CONFIRMED,
        {"order_id": order_id, "payment_id": pay_id,
         "transaction_id": f"txn-{uuid.uuid4().hex[:12]}",
         "amount": float(amount)},
        confirm_ts,
        correlation_id=order_id,
    ))


def _generate_order_events(day_date, order_num, servers, weighted_items):
    events = []
    order_id = f"ord-{day_date.strftime('%Y%m%d')}-{order_num:04d}"

    hour   = _pick_order_hour()
    minute = random.randint(0, 59)
    second = random.randint(0, 59)
    order_ts = _ts(day_date, hour, minute, second)

    server      = random.choice(servers)
    guest_count = random.choices([1, 2, 3, 4, 5, 6], weights=[15, 35, 25, 15, 7, 3], k=1)[0]
    table       = _pick_table()

    events.append(_make_event(
        EventType.ORDER_CREATED,
        {
            "order_id":     order_id,
            "check_number": f"C-{order_num:03d}",
            "table":        table,
            "server_id":    server["employee_id"],
            "server_name":  server["display_name"],
            "guest_count":  guest_count,
            "customer_name": None,
        },
        order_ts,
        user_id=server["employee_id"],
        correlation_id=order_id,
    ))

    # ── Items ────────────────────────────────────────────────────────────────
    items    = _pick_items(weighted_items)
    subtotal = Decimal("0.00")
    for idx, menu_item in enumerate(items):
        item_id = f"{order_id}-i{idx + 1}"
        item_ts = order_ts + timedelta(seconds=30 * (idx + 1))
        price   = Decimal(str(menu_item["price"]))
        subtotal += price

        events.append(_make_event(
            EventType.ITEM_ADDED,
            {
                "order_id":     order_id,
                "item_id":      item_id,
                "menu_item_id": menu_item["item_id"],
                "name":         menu_item["name"],
                "price":        float(price),
                "quantity":     1,
                "category":     menu_item.get("category"),
                "notes":        None,
                "seat_number":  random.randint(1, guest_count),
            },
            item_ts,
            user_id=server["employee_id"],
            correlation_id=order_id,
        ))

        sent_ts = item_ts + timedelta(seconds=random.randint(5, 60))
        events.append(_make_event(
            EventType.ITEM_SENT,
            {
                "order_id":  order_id,
                "item_id":   item_id,
                "name":      menu_item["name"],
                "seat_number": None,
                "category":  menu_item.get("category"),
                "sent_at":   sent_ts.isoformat(),
            },
            sent_ts,
            correlation_id=order_id,
        ))

        events.extend(_mod_events(order_id, item_id, menu_item["item_id"], item_ts))

    # ── ~2% void rate ─────────────────────────────────────────────────────────
    if random.random() < 0.02:
        void_ts = order_ts + timedelta(minutes=random.randint(5, 20))
        events.append(_make_event(
            EventType.ORDER_VOIDED,
            {"order_id": order_id, "void_reason": "Customer changed mind"},
            void_ts,
            user_id=server["employee_id"],
            correlation_id=order_id,
        ))
        return events

    # ── Payment — 70% card, 25% cash, 5% split ───────────────────────────────
    tax        = money_round(subtotal * TAX_RATE)
    card_total = money_round(subtotal + tax)
    pay_ts     = order_ts + timedelta(minutes=random.randint(15, 45))
    method     = random.choices(["card", "cash", "split"], weights=[70, 25, 5], k=1)[0]

    if method == "cash":
        discount   = money_round(card_total * CASH_DISCOUNT_RATE)
        sale_amount = money_round(card_total - discount)
        events.append(_make_event(
            EventType.DISCOUNT_APPROVED,
            {"order_id": order_id, "discount_type": "cash_dual_pricing",
             "amount": float(discount), "reason": "Cash dual-pricing discount"},
            pay_ts, correlation_id=order_id,
        ))
        _emit_payment(events, order_id, f"pay-{order_id}", sale_amount, "cash", pay_ts)
        close_ts = pay_ts + timedelta(seconds=random.randint(30, 120))
        events.append(_make_event(
            EventType.ORDER_CLOSED,
            {"order_id": order_id, "total": float(sale_amount)},
            close_ts, correlation_id=order_id,
        ))

    elif method == "card":
        pay_id = f"pay-{order_id}"
        _emit_payment(events, order_id, pay_id, card_total, "card", pay_ts)
        if random.random() < 0.90:
            tip_pct    = random.choices([0.15, 0.18, 0.20, 0.22, 0.25],
                                        weights=[20, 30, 30, 15, 5], k=1)[0]
            tip_amount = money_round(card_total * Decimal(str(tip_pct)))
            tip_ts     = pay_ts + timedelta(seconds=random.randint(15, 90))
            events.append(_make_event(
                EventType.TIP_ADJUSTED,
                {"order_id": order_id, "payment_id": pay_id,
                 "tip_amount": float(tip_amount), "previous_tip": 0.0},
                tip_ts, correlation_id=order_id,
            ))
        close_ts = pay_ts + timedelta(seconds=random.randint(30, 120))
        events.append(_make_event(
            EventType.ORDER_CLOSED,
            {"order_id": order_id, "total": float(card_total)},
            close_ts, correlation_id=order_id,
        ))

    else:  # split: 50 % cash + 50 % card
        half      = money_round(card_total / 2)
        remainder = money_round(card_total - half)

        discount = money_round(half * CASH_DISCOUNT_RATE)
        cash_amt = money_round(half - discount)
        events.append(_make_event(
            EventType.DISCOUNT_APPROVED,
            {"order_id": order_id, "discount_type": "cash_dual_pricing",
             "amount": float(discount), "reason": "Cash dual-pricing discount"},
            pay_ts, correlation_id=order_id,
        ))
        _emit_payment(events, order_id, f"pay-cash-{order_id}", cash_amt, "cash", pay_ts)

        card_ts    = pay_ts + timedelta(seconds=30)
        card_pay_id = f"pay-card-{order_id}"
        _emit_payment(events, order_id, card_pay_id, remainder, "card", card_ts)
        if random.random() < 0.90:
            tip_pct    = random.choices([0.15, 0.18, 0.20, 0.22, 0.25],
                                        weights=[20, 30, 30, 15, 5], k=1)[0]
            tip_amount = money_round(remainder * Decimal(str(tip_pct)))
            tip_ts     = card_ts + timedelta(seconds=random.randint(15, 60))
            events.append(_make_event(
                EventType.TIP_ADJUSTED,
                {"order_id": order_id, "payment_id": card_pay_id,
                 "tip_amount": float(tip_amount), "previous_tip": 0.0},
                tip_ts, correlation_id=order_id,
            ))

        total_paid = money_round(cash_amt + remainder)
        close_ts   = card_ts + timedelta(seconds=random.randint(30, 90))
        events.append(_make_event(
            EventType.ORDER_CLOSED,
            {"order_id": order_id, "total": float(total_paid)},
            close_ts, correlation_id=order_id,
        ))

    return events


def _generate_day(day_date, staff, weighted_items, is_today=False):
    all_events = []

    servers  = [s for s in staff if "server" in s.get("role_ids", [])
                                  and "manager" not in s.get("role_ids", [])]
    cooks    = [s for s in staff if "cook" in s.get("role_ids", [])]

    num_servers = min(random.choices([2, 3, 4], weights=[30, 50, 20], k=1)[0], len(servers))
    num_cooks   = min(random.choices([1, 2],    weights=[40, 60],     k=1)[0], len(cooks))
    servers_on  = random.sample(servers, num_servers) if servers else staff[:2]
    cooks_on    = random.sample(cooks,   num_cooks)   if cooks   else []

    # Clock events for this day are generated by seed_employees.seed_clock_records_if_empty

    num_orders      = _order_volume(day_date)
    day_total_sales = Decimal("0.00")
    day_total_tips  = Decimal("0.00")
    day_cash        = Decimal("0.00")
    day_card        = Decimal("0.00")
    order_ids       = []
    payment_count   = 0

    for i in range(1, num_orders + 1):
        order_events = _generate_order_events(day_date, i, servers_on, weighted_items)
        all_events.extend(order_events)

        for e in order_events:
            if e.event_type == EventType.PAYMENT_CONFIRMED:
                day_total_sales += Decimal(str(e.payload.get("amount", 0)))
                payment_count += 1
            if e.event_type == EventType.TIP_ADJUSTED:
                day_total_tips += Decimal(str(e.payload.get("tip_amount", 0)))
            if e.event_type == EventType.PAYMENT_INITIATED:
                if e.payload.get("method") == "cash":
                    day_cash += Decimal(str(e.payload.get("amount", 0)))
                else:
                    day_card += Decimal(str(e.payload.get("amount", 0)))
            if e.event_type == EventType.ORDER_CREATED:
                order_ids.append(e.payload["order_id"])

    all_events.sort(key=lambda e: e.timestamp)

    if not is_today:
        close_ts = _ts(day_date, 23, 59, 59)
        all_events.append(_make_event(
            EventType.DAY_CLOSED,
            {
                "date":          day_date.strftime("%Y-%m-%d"),
                "total_orders":  len(order_ids),
                "total_sales":   float(money_round(day_total_sales)),
                "total_tips":    float(money_round(day_total_tips)),
                "cash_total":    float(money_round(day_cash)),
                "card_total":    float(money_round(day_card)),
                "order_ids":     order_ids,
                "payment_count": payment_count,
            },
            close_ts,
        ))

    return all_events


# ─── Public API ──────────────────────────────────────────────────────────────

async def seed_sample_orders_if_empty(ledger: EventLedger) -> None:
    """Generate 30 days of sample orders if none exist.

    Reads employees and menu items from the ledger so it works with
    whatever was seeded by demo_seeder (or seed_demo_data.py).
    Also seeds 30 days of clock records via seed_employees.
    """
    existing = await ledger.get_events_by_type(EventType.ORDER_CREATED, limit=1)
    if existing:
        return

    random.seed(SEED)

    # ── Load employees ───────────────────────────────────────────────────────
    emp_events = await ledger.get_events_by_type(EventType.EMPLOYEE_CREATED, limit=100)
    if not emp_events:
        print("  No employees in ledger — skipping sample order seeding")
        return

    staff = []
    for e in emp_events:
        p = e.payload
        staff.append({
            "employee_id": p["employee_id"],
            "display_name": p.get("display_name", p.get("first_name", "Unknown")),
            "role_ids": p.get("role_ids", [p.get("role", "server")]),
        })

    servers = [s for s in staff if "server" in s.get("role_ids", [])]
    if not servers:
        staff[0]["role_ids"] = staff[0].get("role_ids", []) + ["server"]

    # ── Load menu items ──────────────────────────────────────────────────────
    item_events = await ledger.get_events_by_type(EventType.MENU_ITEM_CREATED, limit=200)
    if not item_events:
        print("  No menu items in ledger — skipping sample order seeding")
        return

    menu_items = []
    for e in item_events:
        p = e.payload
        menu_items.append({
            "item_id":  p["item_id"],
            "name":     p["name"],
            "price":    p["price"],
            "category": p.get("category") or p.get("category_id"),
        })

    weighted_items = _build_weighted_items(menu_items)

    today      = datetime.now(timezone.utc).date()
    start_date = today - timedelta(days=DAYS_OF_HISTORY)

    print(f"  Seeding {DAYS_OF_HISTORY} days of sample orders "
          f"({start_date} → {today - timedelta(days=1)})...")

    total_events = 0
    for day_offset in range(DAYS_OF_HISTORY):
        day_date   = start_date + timedelta(days=day_offset)
        day_events = _generate_day(day_date, staff, weighted_items, is_today=False)
        if day_events:
            await ledger.append_batch(day_events)
            total_events += len(day_events)

    print(f"  Sample order seed complete — {total_events:,} events across {DAYS_OF_HISTORY} days")

    # ── Seed clock records (separate idempotency gate) ───────────────────────
    from app.services.seed_employees import seed_clock_records_if_empty
    await seed_clock_records_if_empty(ledger)


async def seed_today_demo(ledger: EventLedger) -> None:
    """Seed today's data for demo: partial orders + open checks + clocked-in staff.

    Unlike seed_sample_orders_if_empty, this produces only TODAY's events, gated
    by whether today already has orders. Intended for demo/Fly environments where
    the home dashboard needs to look alive.
    """
    today      = datetime.now(timezone.utc).date()
    today_start = datetime(today.year, today.month, today.day, 0, 0, 0, tzinfo=timezone.utc)

    existing = await ledger.get_events_by_date_range(
        today.strftime("%Y-%m-%d"),
        (today + timedelta(days=1)).strftime("%Y-%m-%d"),
        limit=1,
    )
    has_orders_today = any(e.event_type == EventType.ORDER_CREATED for e in existing)
    if has_orders_today:
        return

    emp_events = await ledger.get_events_by_type(EventType.EMPLOYEE_CREATED, limit=100)
    if not emp_events:
        print("  [seed_today_demo] No employees — skipping")
        return

    staff = []
    for e in emp_events:
        p = e.payload
        staff.append({
            "employee_id": p["employee_id"],
            "display_name": p.get("display_name", p.get("first_name", "Unknown")),
            "role_ids": p.get("role_ids", [p.get("role", "server")]),
        })

    servers = [s for s in staff if "server" in s.get("role_ids", [])
               and "manager" not in s.get("role_ids", [])]
    if not servers:
        staff[0]["role_ids"] = staff[0].get("role_ids", []) + ["server"]
        servers = [staff[0]]

    item_events = await ledger.get_events_by_type(EventType.MENU_ITEM_CREATED, limit=200)
    if not item_events:
        print("  [seed_today_demo] No menu items — skipping")
        return

    menu_items = []
    for e in item_events:
        p = e.payload
        menu_items.append({
            "item_id":  p["item_id"],
            "name":     p["name"],
            "price":    p["price"],
            "category": p.get("category") or p.get("category_id"),
        })

    random.seed(int(today.strftime("%Y%m%d")))
    weighted_items = _build_weighted_items(menu_items)

    now          = datetime.now(timezone.utc)
    current_hour = now.hour
    events_to_append = []

    # ── Clock in 2–3 servers ──────────────────────────────────────────────────
    num_working     = min(random.choices([2, 3], weights=[40, 60], k=1)[0], len(servers))
    working_servers = random.sample(servers, num_working)
    for server in working_servers:
        clock_in_hour = random.choice([10, 10, 11])
        clock_in_min  = random.randint(0, 30)
        if clock_in_hour > current_hour:
            continue
        clock_in_ts = _ts(today_start, clock_in_hour, clock_in_min)
        events_to_append.append(_make_event(
            EventType.USER_LOGGED_IN,
            {"employee_id": server["employee_id"], "employee_name": server["display_name"]},
            clock_in_ts,
            user_id=server["employee_id"],
        ))

    # ── Completed orders earlier today ────────────────────────────────────────
    full_day_volume = _order_volume(today_start)
    hours_open  = max(1, current_hour - 10)
    total_hours = 11
    progress    = min(1.0, hours_open / total_hours)
    num_closed  = int(full_day_volume * progress * 0.85)

    order_num = 1
    for _ in range(num_closed):
        hour = _pick_order_hour()
        if hour > current_hour:
            hour = current_hour
        order_events = _generate_order_events_for_hour(
            today_start, order_num, working_servers, weighted_items, hour
        )
        events_to_append.extend(order_events)
        order_num += 1

    # ── Open checks ───────────────────────────────────────────────────────────
    num_open = random.choices([3, 4, 5], weights=[30, 40, 30], k=1)[0]
    for _ in range(num_open):
        open_events = _generate_open_order(
            today_start, order_num, working_servers, weighted_items, current_hour
        )
        events_to_append.extend(open_events)
        order_num += 1

    events_to_append.sort(key=lambda e: e.timestamp)
    if events_to_append:
        await ledger.append_batch(events_to_append)
        print(f"  [seed_today_demo] Seeded {len(events_to_append)} events for today "
              f"({num_closed} closed, {num_open} open)")


def _generate_order_events_for_hour(day_date, order_num, servers, weighted_items, hour):
    """Variant of _generate_order_events that forces a specific hour."""
    events = []
    order_id = f"ord-{day_date.strftime('%Y%m%d')}-{order_num:04d}"
    minute   = random.randint(0, 59)
    second   = random.randint(0, 59)
    order_ts = _ts(day_date, hour, minute, second)

    server      = random.choice(servers)
    guest_count = random.choices([1, 2, 3, 4, 5, 6], weights=[15, 35, 25, 15, 7, 3], k=1)[0]
    table       = _pick_table()

    events.append(_make_event(
        EventType.ORDER_CREATED,
        {
            "order_id":      order_id,
            "check_number":  f"C-{order_num:03d}",
            "table":         table,
            "server_id":     server["employee_id"],
            "server_name":   server["display_name"],
            "guest_count":   guest_count,
            "customer_name": None,
        },
        order_ts,
        user_id=server["employee_id"],
        correlation_id=order_id,
    ))

    items    = _pick_items(weighted_items)
    subtotal = Decimal("0.00")
    for idx, menu_item in enumerate(items):
        item_id = f"{order_id}-i{idx + 1}"
        item_ts = order_ts + timedelta(seconds=30 * (idx + 1))
        price   = Decimal(str(menu_item["price"]))
        subtotal += price

        events.append(_make_event(
            EventType.ITEM_ADDED,
            {
                "order_id":     order_id, "item_id": item_id,
                "menu_item_id": menu_item["item_id"], "name": menu_item["name"],
                "price": float(price), "quantity": 1,
                "category": menu_item.get("category"), "notes": None,
                "seat_number": random.randint(1, guest_count),
            },
            item_ts, user_id=server["employee_id"], correlation_id=order_id,
        ))

        sent_ts = item_ts + timedelta(seconds=random.randint(5, 60))
        events.append(_make_event(
            EventType.ITEM_SENT,
            {
                "order_id": order_id, "item_id": item_id,
                "name": menu_item["name"], "seat_number": None,
                "category": menu_item.get("category"), "sent_at": sent_ts.isoformat(),
            },
            sent_ts, correlation_id=order_id,
        ))

        events.extend(_mod_events(order_id, item_id, menu_item["item_id"], item_ts))

    tax        = money_round(subtotal * TAX_RATE)
    card_total = money_round(subtotal + tax)
    pay_ts     = order_ts + timedelta(minutes=random.randint(15, 45))
    method     = random.choices(["card", "cash", "split"], weights=[70, 25, 5], k=1)[0]

    if method == "cash":
        discount    = money_round(card_total * CASH_DISCOUNT_RATE)
        sale_amount = money_round(card_total - discount)
        events.append(_make_event(
            EventType.DISCOUNT_APPROVED,
            {"order_id": order_id, "discount_type": "cash_dual_pricing",
             "amount": float(discount), "reason": "Cash dual-pricing discount"},
            pay_ts, correlation_id=order_id,
        ))
        _emit_payment(events, order_id, f"pay-{order_id}", sale_amount, "cash", pay_ts)
        close_ts = pay_ts + timedelta(seconds=random.randint(30, 120))
        events.append(_make_event(
            EventType.ORDER_CLOSED,
            {"order_id": order_id, "total": float(sale_amount)},
            close_ts, correlation_id=order_id,
        ))

    elif method == "card":
        pay_id = f"pay-{order_id}"
        _emit_payment(events, order_id, pay_id, card_total, "card", pay_ts)
        if random.random() < 0.90:
            tip_pct    = random.choices([0.15, 0.18, 0.20, 0.22, 0.25],
                                        weights=[20, 30, 30, 15, 5], k=1)[0]
            tip_amount = money_round(card_total * Decimal(str(tip_pct)))
            tip_ts     = pay_ts + timedelta(seconds=random.randint(15, 90))
            events.append(_make_event(
                EventType.TIP_ADJUSTED,
                {"order_id": order_id, "payment_id": pay_id,
                 "tip_amount": float(tip_amount), "previous_tip": 0.0},
                tip_ts, correlation_id=order_id,
            ))
        close_ts = pay_ts + timedelta(seconds=random.randint(30, 120))
        events.append(_make_event(
            EventType.ORDER_CLOSED,
            {"order_id": order_id, "total": float(card_total)},
            close_ts, correlation_id=order_id,
        ))

    else:  # split
        half      = money_round(card_total / 2)
        remainder = money_round(card_total - half)
        discount  = money_round(half * CASH_DISCOUNT_RATE)
        cash_amt  = money_round(half - discount)
        events.append(_make_event(
            EventType.DISCOUNT_APPROVED,
            {"order_id": order_id, "discount_type": "cash_dual_pricing",
             "amount": float(discount), "reason": "Cash dual-pricing discount"},
            pay_ts, correlation_id=order_id,
        ))
        _emit_payment(events, order_id, f"pay-cash-{order_id}", cash_amt, "cash", pay_ts)
        card_ts    = pay_ts + timedelta(seconds=30)
        card_pay_id = f"pay-card-{order_id}"
        _emit_payment(events, order_id, card_pay_id, remainder, "card", card_ts)
        if random.random() < 0.90:
            tip_pct    = random.choices([0.15, 0.18, 0.20, 0.22, 0.25],
                                        weights=[20, 30, 30, 15, 5], k=1)[0]
            tip_amount = money_round(remainder * Decimal(str(tip_pct)))
            tip_ts     = card_ts + timedelta(seconds=random.randint(15, 60))
            events.append(_make_event(
                EventType.TIP_ADJUSTED,
                {"order_id": order_id, "payment_id": card_pay_id,
                 "tip_amount": float(tip_amount), "previous_tip": 0.0},
                tip_ts, correlation_id=order_id,
            ))
        total_paid = money_round(cash_amt + remainder)
        close_ts   = card_ts + timedelta(seconds=random.randint(30, 90))
        events.append(_make_event(
            EventType.ORDER_CLOSED,
            {"order_id": order_id, "total": float(total_paid)},
            close_ts, correlation_id=order_id,
        ))

    return events


def _generate_open_order(day_date, order_num, servers, weighted_items, current_hour):
    """Generate an OPEN order — items added + sent, but NO payment yet."""
    events   = []
    order_id = f"ord-{day_date.strftime('%Y%m%d')}-{order_num:04d}"

    minutes_ago = random.choices(
        [5, 15, 25, 35, 45, 60, 90], weights=[25, 25, 20, 15, 8, 5, 2], k=1
    )[0]
    order_ts = datetime.now(timezone.utc) - timedelta(minutes=minutes_ago)

    server      = random.choice(servers)
    guest_count = random.choices([1, 2, 3, 4], weights=[10, 40, 30, 20], k=1)[0]
    table       = _pick_table()

    events.append(_make_event(
        EventType.ORDER_CREATED,
        {
            "order_id":      order_id, "check_number": f"C-{order_num:03d}",
            "table":         table,
            "server_id":     server["employee_id"], "server_name": server["display_name"],
            "guest_count":   guest_count, "customer_name": None,
        },
        order_ts, user_id=server["employee_id"], correlation_id=order_id,
    ))

    items = _pick_items(weighted_items)
    for idx, menu_item in enumerate(items):
        item_id = f"{order_id}-i{idx + 1}"
        item_ts = order_ts + timedelta(seconds=30 * (idx + 1))

        events.append(_make_event(
            EventType.ITEM_ADDED,
            {
                "order_id":     order_id, "item_id": item_id,
                "menu_item_id": menu_item["item_id"], "name": menu_item["name"],
                "price": float(menu_item["price"]), "quantity": 1,
                "category": menu_item.get("category"), "notes": None,
                "seat_number": random.randint(1, guest_count),
            },
            item_ts, user_id=server["employee_id"], correlation_id=order_id,
        ))

        sent_ts = item_ts + timedelta(seconds=random.randint(5, 60))
        events.append(_make_event(
            EventType.ITEM_SENT,
            {
                "order_id": order_id, "item_id": item_id,
                "name": menu_item["name"], "seat_number": None,
                "category": menu_item.get("category"), "sent_at": sent_ts.isoformat(),
            },
            sent_ts, correlation_id=order_id,
        ))

        events.extend(_mod_events(order_id, item_id, menu_item["item_id"], item_ts))

    return events
