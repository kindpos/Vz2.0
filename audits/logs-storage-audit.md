# KINDpos Logs & Transactions Storage Audit — Phase 0

**Date:** May 10, 2026  
**Scope:** Backend storage architecture (`backend/app/**/*.py`)  
**Status:** Read-only audit; no modifications  

---

## 1. SQLite Inventory

### 1.1 event_ledger.db
**Location:** `backend/data/event_ledger.db`  
**Purpose:** Immutable append-only event ledger; source of truth for all business state

**CREATE TABLE statements:**
```sql
CREATE TABLE IF NOT EXISTS events (
    sequence_number INTEGER PRIMARY KEY AUTOINCREMENT,
    event_id TEXT UNIQUE NOT NULL,
    timestamp TEXT NOT NULL,
    terminal_id TEXT NOT NULL,
    event_type TEXT NOT NULL,
    payload TEXT NOT NULL,
    user_id TEXT,
    user_role TEXT,
    correlation_id TEXT,
    previous_checksum TEXT,
    checksum TEXT NOT NULL,
    synced INTEGER DEFAULT 0,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    idempotency_key TEXT
)
```

**Indexes:**
- `idx_events_idempotency` — unique on `idempotency_key` WHERE not null
- `idx_events_correlation` — on `correlation_id`
- `idx_events_type` — on `event_type`
- `idx_events_timestamp` — on `timestamp`
- `idx_events_synced` — on `synced` WHERE = 0

**Separate table for sync tracking (immutable events table never UPDATEd):**
```sql
CREATE TABLE IF NOT EXISTS sync_ledger (
    event_id TEXT PRIMARY KEY,
    synced_at TEXT NOT NULL
)
```

**PRAGMA settings** (`app/core/event_ledger.py:80-82`):
- `journal_mode=WAL` — write-ahead log for concurrent reads
- `synchronous=NORMAL` — balance durability vs. performance
- `cache_size=10000` — 10K page cache

---

### 1.2 print_queue.db
**Location:** `backend/data/print_queue.db`  
**Purpose:** Persistent queue for print jobs; survives process crashes

**CREATE TABLE:**
```sql
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
```

**Retry history:** Stored in `attempt_count` and `last_attempt_at` columns. Stale jobs (status='sent' older than 30s) are recovered back to 'queued' on dispatcher startup (`app/printing/print_queue.py:145-159`).

**On-crash behavior:** In-flight jobs in 'sent' state are automatically reset back to 'queued' (no data loss).

**PRAGMA settings** (`app/printing/print_queue.py:40-41`):
- `journal_mode=WAL`
- `synchronous=NORMAL`

---

### 1.3 diagnostic_boot.db
**Location:** `backend/data/diagnostic_boot.db` (derived from `event_ledger.db` path with string substitution)  
**Purpose:** Diagnostic events (independent hash-chained system) + Kindnostic boot probe results  
**Initialized by:** `DiagnosticCollector` (`app/services/diagnostic_collector.py`)

**Tables:**

#### diagnostic_events
```sql
CREATE TABLE IF NOT EXISTS diagnostic_events (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    diagnostic_id   TEXT NOT NULL UNIQUE,
    correlation_id  TEXT,
    terminal_id     TEXT NOT NULL,
    timestamp       TEXT NOT NULL,
    category        TEXT NOT NULL,
    severity        TEXT NOT NULL,
    source          TEXT NOT NULL,
    event_code      TEXT NOT NULL,
    message         TEXT NOT NULL,
    context         TEXT NOT NULL,
    prev_hash       TEXT NOT NULL,
    hash            TEXT NOT NULL
)
```

**Indexes:**
- `idx_diag_timestamp` — on `timestamp`
- `idx_diag_category` — on `category`
- `idx_diag_severity` — on `severity`
- `idx_diag_event_code` — on `event_code`
- `idx_diag_correlation` — on `correlation_id`

**Hash chain:** Independent SHA-256 chain from business events; `prev_hash` links to previous diagnostic event's hash. Genesis hash = `"KIND_DIAGNOSTIC_GENESIS"`.

#### boot_results (Kindnostic)
```sql
CREATE TABLE IF NOT EXISTS boot_results (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    boot_id     TEXT NOT NULL,
    timestamp   TEXT NOT NULL,
    probe_name  TEXT NOT NULL,
    category    TEXT NOT NULL,
    status      TEXT NOT NULL,
    duration_ms INTEGER,
    message     TEXT,
    metadata    TEXT
)
```

#### boot_summary (Kindnostic)
```sql
CREATE TABLE IF NOT EXISTS boot_summary (
    boot_id         TEXT PRIMARY KEY,
    timestamp       TEXT NOT NULL,
    total_probes    INTEGER,
    passed          INTEGER,
    warned          INTEGER,
    failed          INTEGER,
    duration_ms     INTEGER,
    outcome         TEXT NOT NULL,
    override_by     TEXT
)
```

**PRAGMA settings** (`app/services/diagnostic_collector.py:84-89`):
- `journal_mode=WAL`
- `synchronous=NORMAL`
- `cache_size=10000`
- `mmap_size=268435456` — 256MB memory-mapped I/O
- `journal_size_limit=67108864` — 64MB WAL size cap
- `temp_store=MEMORY` — temporary tables in RAM

---

### 1.4 ephemeral_log.db
**Location:** `backend/data/ephemeral_log.db`  
**Purpose:** Non-chained operational telemetry (printer status, device events, print retries). Purgeable without ledger integrity impact.

**CREATE TABLE:**
```sql
CREATE TABLE IF NOT EXISTS ephemeral_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    event_id TEXT NOT NULL,
    timestamp TEXT NOT NULL,
    terminal_id TEXT NOT NULL,
    event_type TEXT NOT NULL,
    payload TEXT NOT NULL,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
)
```

**Indexes:**
- `idx_eph_type` — on `event_type`
- `idx_eph_timestamp` — on `timestamp`

**PRAGMA settings** (`app/core/ephemeral_log.py:67-68`):
- `journal_mode=WAL`
- `synchronous=NORMAL`

**Routed event types** (`app/core/ephemeral_log.py:32-46`):
- TICKET_PRINT_FAILED
- PRINT_RETRYING
- PRINT_REROUTED
- PRINTER_STATUS_CHANGED
- PRINTER_ERROR
- PRINTER_ROLE_CREATED
- PRINTER_FALLBACK_ASSIGNED
- PRINTER_HEALTH_WARNING
- PRINTER_REBOOT_STARTED
- PRINTER_REBOOT_COMPLETED
- DRAWER_OPENED
- DRAWER_OPEN_FAILED
- DEVICE_STATUS_CHANGED

---

### 1.5 hardware_config.db
**Location:** `backend/data/hardware_config.db` (migrated from `backend/hardware_config.db` on startup)  
**Purpose:** Hardware registry—printers, card readers, terminals, licensing

**Initialization:** `app/api/routes/hardware.py:69-176` — creates tables and runs migrations

**Tables:**

#### devices
```sql
CREATE TABLE IF NOT EXISTS devices (
    mac         TEXT PRIMARY KEY,
    ip          TEXT NOT NULL,
    type        TEXT NOT NULL,
    name        TEXT NOT NULL,
    port        INTEGER NOT NULL DEFAULT 9100,
    register_id TEXT NOT NULL DEFAULT '',
    tpn         TEXT NOT NULL DEFAULT '',
    auth_key    TEXT NOT NULL DEFAULT '',
    is_active   INTEGER NOT NULL DEFAULT 1,
    saved_at    TEXT NOT NULL,
    categories  TEXT NOT NULL DEFAULT '',
    terminal_id TEXT NOT NULL DEFAULT '',
    terminal_ids TEXT NOT NULL DEFAULT '[]',
    role        TEXT NOT NULL DEFAULT ''
)
```

#### printer_routing
```sql
CREATE TABLE IF NOT EXISTS printer_routing (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    printer_mac TEXT NOT NULL,
    rule_type   TEXT NOT NULL DEFAULT 'all',
    category_id TEXT DEFAULT '',
    item_tag    TEXT DEFAULT '',
    priority    INTEGER DEFAULT 0,
    is_active   INTEGER DEFAULT 1,
    created_at  TEXT NOT NULL
)
```

#### server_license
```sql
CREATE TABLE IF NOT EXISTS server_license (
    activation_code TEXT PRIMARY KEY,
    server_mac      TEXT NOT NULL DEFAULT '',
    platform        TEXT NOT NULL DEFAULT '',
    status          TEXT NOT NULL DEFAULT 'pending',
    store_id        TEXT NOT NULL DEFAULT '',
    label           TEXT NOT NULL DEFAULT '',
    created_at      TEXT NOT NULL,
    activated_at    TEXT NOT NULL DEFAULT '',
    node_number     INTEGER DEFAULT NULL
)
```

#### terminals
```sql
CREATE TABLE IF NOT EXISTS terminals (
    terminal_id     TEXT PRIMARY KEY,
    auth_key_hash   TEXT NOT NULL,
    activated_at    TEXT NOT NULL,
    is_active       INTEGER NOT NULL DEFAULT 1,
    name            TEXT NOT NULL DEFAULT '',
    ip_address      TEXT NOT NULL DEFAULT '',
    mac_address     TEXT NOT NULL DEFAULT '',
    role            TEXT NOT NULL DEFAULT 'server',
    is_hub          INTEGER NOT NULL DEFAULT 0
)
```

---

## 2. Event Ledger Contents

### 2.1 Complete EventType Enum
**Source:** `app/core/events.py:39-340`

**Total distinct event types:** ~182 enum values

**Classification by category:**

#### Order lifecycle (LEDGER_CORE — financial)
- ORDER_CREATED
- ORDER_CLOSED
- ORDER_REOPENED
- ORDER_VOIDED
- ORDER_TRANSFERRED
- GUEST_COUNT_UPDATED
- SEATS_UPDATED
- CHECK_OPENED, CHECK_NAMED, CHECK_ABANDONED, CHECK_SPLIT, CHECK_MERGED, CHECK_TABLE_CHANGED, CHECK_DAY_LOCKED
- CHECK_SEAT_ADDED, CHECK_SEAT_REMOVED, CHECK_SEAT_RELABELED, CHECK_SEAT_SENT_OUT, CHECK_SEAT_RECEIVED

#### Item management (LEDGER_CORE — financial)
- ITEM_ADDED, ITEM_REMOVED, ITEM_MODIFIED, ITEM_SENT
- MODIFIER_APPLIED

#### Discounts (LEDGER_CORE — financial)
- DISCOUNT_APPROVED, DISCOUNT_VOIDED, DISCOUNT_CREATED, DISCOUNT_UPDATED, DISCOUNT_DEACTIVATED, DISCOUNT_REACTIVATED
- SEAT_DISCOUNT_APPLIED, SEAT_DISCOUNT_VOIDED
- SEAT_COMPED

#### Printing (mixed: LEDGER_OPERATIONAL / EPHEMERAL)
- TICKET_PRINTED, TICKET_PRINT_FAILED, TICKET_REPRINTED (operational)
- PRINT_RETRYING, PRINT_REROUTED (ephemeral)

#### Printer lifecycle (mixed: LEDGER_OPERATIONAL / EPHEMERAL)
- PRINTER_REGISTERED, PRINTER_CONFIGURED, PRINTER_REMOVED, PRINTER_ASSIGNMENT_CHANGED (operational)
- PRINTER_STATUS_CHANGED, PRINTER_ERROR, PRINTER_ROLE_CREATED, PRINTER_FALLBACK_ASSIGNED (ephemeral)
- PRINTER_REBOOT_STARTED, PRINTER_REBOOT_COMPLETED, PRINTER_HEALTH_WARNING (ephemeral)

#### Cash drawer (EPHEMERAL)
- DRAWER_OPENED, DRAWER_OPEN_FAILED

#### Payment processing (LEDGER_CORE — financial)
- PAYMENT_INITIATED, PAYMENT_CONFIRMED, PAYMENT_DECLINED, PAYMENT_CANCELLED, PAYMENT_TIMED_OUT, PAYMENT_ERROR

#### Post-authorization (LEDGER_CORE — financial)
- PAYMENT_REFUNDED
- SEAT_PAID, SEAT_PAYMENT_VOIDED
- SEAT_TIP_ADDED, SEAT_OVERPAYMENT_RESOLVED
- SEAT_ITEM_TRANSFERRED_OUT, SEAT_ITEM_RECEIVED
- SEAT_TRANSFERRED_OUT, SEAT_TRANSFERRED_IN
- SEAT_SPLIT_FROM, SEAT_MERGED_INTO, SEAT_REOPENED
- TIP_ADJUSTED, CASH_TIPS_DECLARED

#### Batch & Day (LEDGER_CORE — financial)
- BATCH_OPENED, BATCH_SETTLEMENT_INITIATED, BATCH_SUBMITTED, BATCH_SETTLEMENT_FAILED, BATCH_REOPENED
- DAY_OPENED, DAY_CASH_FLOAT_UPDATED, DAY_CASH_DROP, DAY_CASH_PAYOUT, DAY_FLASH_REPORT_GENERATED, DAY_CLOSED, DAY_LOCKED, DAY_REOPENED

#### Device (EPHEMERAL)
- DEVICE_STATUS_CHANGED

#### Store Configuration (LEDGER_OPERATIONAL — non-financial)
- STORE_INFO_UPDATED, STORE_BRANDING_UPDATED
- STORE_THEME_* (multiple variants)
- STORE_CC_PROCESSING_RATE_UPDATED
- STORE_TAX_RULE_* (multiple variants)
- STORE_OPERATING_HOURS_UPDATED
- STORE_ORDER_TYPES_UPDATED
- STORE_AUTO_GRATUITY_UPDATED
- SECURITY_SETTING_UPDATED

#### Employee & Roles (LEDGER_OPERATIONAL — non-financial)
- EMPLOYEE_ROLE_*, EMPLOYEE_CREATED, EMPLOYEE_UPDATED, EMPLOYEE_DELETED
- STAFF_PIN_CHANGED, STAFF_UPDATED, STAFF_ROLE_CHANGED, STAFF_DEACTIVATED, STAFF_REACTIVATED
- CLOCK_EDIT, SHIFT_DELETED
- SHIFT_TEMPLATE_* (multiple variants)
- PAYROLL_EXPORTED, SHIFT_TIME_ADJUSTED
- SHIFT_SWAP_APPROVED, SHIFT_SWAP_DENIED
- CHECKOUT_FINALIZED
- TIPOUT_* (rule, pool, calculation variants)

#### Menu management (LEDGER_OPERATIONAL — non-financial)
- MENU_ITEM_*, MENU_CATEGORY_* (created, updated, deleted)
- CATEGORY_DEACTIVATED, CATEGORY_REACTIVATED
- MENU_ITEM_86D, MENU_ITEM_RESTORED, ITEM_86ED, ITEM_86_CLEARED
- ITEM_PRICE_CHANGED, ITEM_DEACTIVATED, ITEM_REACTIVATED
- SPECIAL_* (created, updated, activated, deactivated)
- MENU_ITEMS_REORDERED, MENU_CATEGORIES_REORDERED
- MODIFIER_GROUP_*, MODIFIER_GROUP_MODIFIER_* (added, removed)
- MODIFIER_* (created, updated, deleted, price_changed, deactivated, reactivated, 86ed, 86_cleared)

#### Micromods (LEDGER_OPERATIONAL — dark-shipped, non-financial)
- MICROMOD_CREATED, MICROMOD_UPDATED, MICROMOD_PRICE_CHANGED
- MICROMOD_DEACTIVATED, MICROMOD_REACTIVATED
- MICROMOD_ASSIGNED_TO_MODIFIER, MICROMOD_UNASSIGNED_FROM_MODIFIER
- MICROMOD_86ED, MICROMOD_86_CLEARED

#### Options & OptionGroups (LEDGER_OPERATIONAL — non-financial)
- OPTION_CREATED, OPTION_UPDATED, OPTION_DELETED
- OPTION_DEACTIVATED, OPTION_REACTIVATED
- OPTION_GROUP_CREATED, OPTION_GROUP_UPDATED
- OPTION_GROUP_OPTION_ADDED, OPTION_GROUP_OPTION_REMOVED
- OPTION_GROUP_DEACTIVATED, OPTION_GROUP_REACTIVATED

#### Sizes (LEDGER_OPERATIONAL — non-financial)
- SIZE_CREATED, SIZE_UPDATED, SIZE_DEACTIVATED, SIZE_REACTIVATED

#### Pricing chain (LEDGER_OPERATIONAL — non-financial)
- MODIFIER_GROUP_OPTION_GROUP_SET
- MODIFIER_GROUP_SIZE_ADJUSTMENTS_UPDATED
- MODIFIER_SIZE_PRICING_SET
- MENU_ITEM_SIZE_PRICING_SET
- MENU_ITEM_OPTION_GROUP_OVERRIDE_SET
- MENU_ITEM_SIZE_PRICE_OVERRIDE_SET

#### Batch setup (LEDGER_OPERATIONAL — non-financial)
- RESTAURANT_CONFIGURED
- TAX_RULES_BATCH_CREATED
- CATEGORIES_BATCH_CREATED
- ITEMS_BATCH_CREATED

#### Menu import (LEDGER_OPERATIONAL — non-financial)
- MENU_IMPORT_STARTED, MENU_IMPORT_COMPLETED, MENU_IMPORT_FAILED, MENU_IMPORT_ROLLED_BACK

#### Floor Plan (LEDGER_OPERATIONAL — non-financial)
- FLOORPLAN_SECTION_CREATED, FLOORPLAN_SECTION_UPDATED, FLOORPLAN_SECTION_DELETED
- FLOORPLAN_LAYOUT_UPDATED

#### Hardware (LEDGER_OPERATIONAL — non-financial)
- TERMINAL_REGISTERED, TERMINAL_UPDATED
- ROUTING_MATRIX_UPDATED

#### System (LEDGER_OPERATIONAL — non-financial)
- USER_LOGGED_IN, USER_LOGGED_OUT
- CLOCK_IN, CLOCK_OUT

#### Timecard (LEDGER_OPERATIONAL — non-financial)
- TIMECARD_ADJUSTED

#### Pricing Config (LEDGER_OPERATIONAL — non-financial)
- PRICING_DAY_PART_* (created, updated, deleted)
- PRICING_DISCOUNT_* (created, updated, deleted)
- PRICING_VOID_REASON_* (created, updated, deleted)
- PRICING_SPECIAL_* (created, updated, deleted)
- PRICING_ORDER_TYPE_UPDATED
- PRICING_EMPLOYEE_DISCOUNT_UPDATED

---

## 3. Python Logging Destinations

### 3.1 Logging Configuration
**Status:** No centralized logging configuration found  
**Location of search:** `backend/app/**/*.py`, no `logging.conf`, `*.yaml`, or `dictConfig` calls

**Actual logging setup:**
- Python's default logging system is used
- Each module calls `logging.getLogger(__name__)` or `logging.getLogger("kindpos.*")`
- **No explicit handlers configured** — output goes to stderr/stdout by default

**Modules with logger instances:**
```
app/main.py → logging.getLogger(__name__)
app/services/diagnostic_collector.py → logging.getLogger("kindpos.diagnostic_collector")
app/services/print_context_builder.py → logging.getLogger("kindpos.printing.context_builder")
app/api/dependencies.py → logging.getLogger(__name__)
app/api/routes/*.py → logging.getLogger(__name__)
```

### 3.2 Destination Paths
- **stderr / stdout:** All Python logging (default handlers)
- **FastAPI/Uvicorn access logs:** Console (uvicorn's default)
- **app/main.py print() statements:** Console (print to stdout)

**No rotating file handlers, no separate access.log, no disk persistence for logs.**

---

## 4. HTTP Access & Error Logs

### 4.1 Access Log Configuration
**FastAPI version:** Runs via Uvicorn  
**Default behavior:** Uvicorn logs to console (stdout)  
**Custom configuration:** None found

**Sample access log:** `GET /api/v1/orders → 200 OK (12.5ms)`  
**Destination:** stdout (no queryable database)

### 4.2 Uncaught Exception Handling
**Location:** `app/main.py:426-453` — exception handler middleware

```python
@app.exception_handler(Exception)
async def _entomology_catch_all(request, exc):
    # Records SYS-001 (ledger error) or SYS-006 (any other exception)
    # to diagnostic_boot.db, then returns 500 JSON response
```

**Queryable outcome:** Exceptions land in `diagnostic_boot.db.diagnostic_events` as SYS-001 or SYS-006 records.  
**Non-queryable outcome:** Exception also goes to Python stderr (unstructured).

---

## 5. Queues & Retry State

### 5.1 Print Queue
**Storage location:** `backend/data/print_queue.db` (SQLite)  
**Table:** `print_queue` (see section 1.2)

**Retry history:**
- `attempt_count` — incremented on each retry
- `last_attempt_at` — timestamp of most recent attempt
- `status` — 'queued' → 'sent' (attempt in flight) → 'completed' or 'failed'

**Retry schedule** (`app/printing/print_dispatcher.py:46`):
```
RETRY_DELAYS = [0, 5, 15, 30]  # seconds
MAX_ATTEMPTS = 4
```

**Persistence:** All job data persists across crashes (stored in SQLite before sending).

**On-crash behavior:**
- Jobs in 'sent' state older than 30s are reset to 'queued' on dispatcher startup
- No jobs are lost

---

### 5.2 In-Flight Payment State
**Storage location:** `backend/data/event_ledger.db` (immutable)

**Events:**
- PAYMENT_INITIATED — payment is pending authorization
- PAYMENT_CONFIRMED or PAYMENT_DECLINED — outcome received
- PAYMENT_ERROR or PAYMENT_TIMED_OUT — failure outcomes

**Crash recovery** (`app/main.py:350-362`):
- `startup_sweep.sweep_orphan_initiated_payments()` runs at boot
- Finds any PAYMENT_INITIATED events without a corresponding outcome event
- Records FIN-008 diagnostic and resolves them to prevent stuck payments

**No in-memory-only in-flight payment state** — everything is event-sourced.

---

### 5.3 In-Memory Printer Registry
**Storage location:** Runtime (in `PrinterManager._printers` dict)

**State:**
```python
# In PrinterManager.__init__
self._printers: dict[str, BasePrinter] = {}  # printer_id → adapter
self._custom_roles: set[str] = {"receipt", "kitchen", "bar"}
self._print_queue: list[PrintJob] = []  # Jobs waiting for retry/reroute
```

**Persistence on crash:**
- **NOT persistent** — registry is reconstructed on startup
- Printers are re-loaded from `hardware_config.db.devices` on app startup
- Print jobs are recovered from `print_queue.db`

**Non-reconstructible if lost:**
- Transient in-flight print job context (partially sent)
- Live connections to printer hardware

---

## 6. Entomology / Diagnostics / Bombard Subsystems

### 6.1 Entomology (Diagnostic System)
**Storage location:** `backend/data/diagnostic_boot.db`

**Schema:** See section 1.3 (diagnostic_events, boot_results, boot_summary)

**Record method:** Only through `DiagnosticCollector.record()` (`app/services/diagnostic_collector.py:196-276`)

**Event code registry** (`app/models/diagnostic_event.py:189-266`):
- DEV-* (device issues)
- NET-* (network issues)
- SYS-* (system/app issues)
- PER-* (peripheral issues)
- REC-* (recovery actions)
- SEC-* (security events)
- FIN-* (financial invariant violations)
- UI-* (frontend lifecycle)

**Queryable alongside event ledger:** Yes — by `correlation_id` (links a diagnostic event to a business event)

**Entomology API** (`app/api/routes/entomology.py`):
- `GET /api/v1/entomology/snapshot` — recent issues + system health
- `GET /api/v1/entomology/report.xlsx` — downloadable Excel bug report

---

### 6.2 Kindnostic (Boot Probes)
**Storage location:** `backend/data/diagnostic_boot.db` (shared with Entomology)

**Tables:** `boot_results`, `boot_summary` (created by `DiagnosticCollector` on init)

**Probes:** Discovered and run by `kindnostic.runner` (separate Python package)  
**Results stored:** Via direct SQLite write by Kindnostic process (not through DiagnosticCollector)

**Queryable:** Yes — used to populate boot-status dashboard at `/entomology`

---

### 6.3 Bombard (Simulation Engine)
**Location:** `backend/bombard/**/*.py` (not in app scope; audit excludes this)

---

## 7. Event-ID Correlation

### 7.1 Canonical Event-ID Format
**Source:** `app/core/events.py:436` — `uuid.uuid4()` as default

**Format:** UUID v4 (e.g., `"a1b2c3d4-e5f6-4789-a123-b4c5d6e7f8a9"`)

**Scope:** Globally unique per event

---

### 7.2 Log References to Event-IDs
**Grep for references within ~3 lines of logger calls:**

Most logging in routes does NOT directly reference event_ids; instead, it references:
- `order_id` — from event payload (financial events)
- `correlation_id` — links related events
- `terminal_id` — which terminal performed the action

**Example** (`app/api/routes/orders.py`, `app/api/routes/payment_routes.py`):
```python
logger.warning(f"Order {order_id} closed while in PAYMENT_INITIATED state")
logger.warning(f"Card declined for order {order_id}")
```

**Can a support engineer today trace a runtime log line back to a business event?**
- **Yes, via order_id / correlation_id** — these are queryable in the event ledger
- **No direct event_id reference** — but all events for an order can be retrieved via correlation_id

---

## 8. In-Memory-Only State

### 8.1 Module-Level Variables Carrying Per-Session State
**Search result:** Minimal module-level state found

**In `app/api/dependencies.py` (line 16-21):**
```python
_ledger: EventLedger | None = None
_ephemeral_log: EphemeralLog | None = None
_printer_manager: PrinterManager | None = None
_diagnostic_collector: DiagnosticCollector | None = None
_print_dispatcher: PrintDispatcher | None = None
```

**Status:** These are **singletons**, initialized once at startup, not per-request.  
**Reconstructible on restart:** Yes (all state derives from SQLite ledgers)

### 8.2 In-Flight State Lost on Restart
- **Printer connections** — TCP sockets to hardware (non-persistent)
- **Print job rendering state** — partially completed context (recovered via print_queue.db if job still pending)
- **Ongoing HTTP requests** — FastAPI request cycles (non-persistent)

### 8.3 Nothing Non-Reconstructible
All durable state (orders, items, payments, diagnostics) lives in SQLite. The event ledger is the source of truth; runtime caches are reconstructible by replaying events.

---

## 9. Retention & Lifecycle

### 9.1 event_ledger.db
**Retention policy:** Immutable (append-only, never deleted)  
**TTL config:** None (events kept forever)  
**Archival:** Events can be exported for long-term storage (via reports), but no automated archival

---

### 9.2 diagnostic_boot.db — diagnostic_events
**Retention policy:** Daily cleanup via `DiagnosticCollector.run_retention()`  
**Scheduled:** App startup calls `asyncio.create_task(_run_daily_retention())` (`app/main.py:323-324`)

**Implementation** (`app/services/diagnostic_collector.py:671-743`):
```python
async def run_retention(retention_days=DEFAULT_RETENTION_DAYS, ...):
    # DEFAULT_RETENTION_DAYS = 90
    cutoff = now - timedelta(days=retention_days)
    # Export events older than cutoff to JSON file: diagnostic_boot_YYYY-MM-DD.json
    # DELETE FROM diagnostic_events WHERE timestamp < cutoff
```

**Archive location:** `backend/data/` (default), filename pattern `KINDpos_diag_archive_YYYY-MM-DD.json`

---

### 9.3 print_queue.db
**Retention policy:** Manual cleanup (jobs marked 'completed' can be deleted by operator)  
**TTL config:** None (completed jobs persist indefinitely unless manually deleted)  
**Archival:** No automatic archival

---

### 9.4 ephemeral_log.db
**Retention policy:** Rotatable via `EphemeralLog.purge_before(cutoff_datetime)` (`app/core/ephemeral_log.py:128-137`)  
**TTL config:** None configured (no scheduled purge)  
**Archival:** No

---

### 9.5 hardware_config.db
**Retention policy:** Persistent (no automatic cleanup)  
**TTL config:** None  
**Archival:** No

---

## Summary Table

| Database | Location | Primary Table | Size Mgmt | Queryable | Archival |
|----------|----------|---|---|---|---|
| event_ledger.db | `backend/data/` | events (immutable) | Never deleted | Yes (projections) | Manual export |
| print_queue.db | `backend/data/` | print_queue | Manual | Yes (status queries) | No |
| diagnostic_boot.db | `backend/data/` | diagnostic_events | 90-day retention (daily cleanup) | Yes (REST API) | JSON archive on cleanup |
| ephemeral_log.db | `backend/data/` | ephemeral_events | Manual purge | Yes (debugging) | No |
| hardware_config.db | `backend/data/` | devices, printer_routing, server_license, terminals | Persistent | Yes (registry) | No |

---

## Audit Complete

AUDIT COMPLETE
