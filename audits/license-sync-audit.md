# KINDpos License + Multi-Terminal Sync Audit (Phase 0)

**Date:** 2026-05-10  
**Scope:** `backend/` only — licenses and terminals code paths  
**Status:** Report only; no modifications made

---

## 1. Schema Reality

### `server_license` table

**Location:** `backend/app/api/routes/hardware.py:124–141`

```sql
CREATE TABLE IF NOT EXISTS server_license (
    activation_code TEXT PRIMARY KEY,
    server_mac      TEXT NOT NULL DEFAULT '',
    platform        TEXT NOT NULL DEFAULT '',
    status          TEXT NOT NULL DEFAULT 'pending',
    store_id        TEXT NOT NULL DEFAULT '',
    label           TEXT NOT NULL DEFAULT '',
    created_at      TEXT NOT NULL,
    activated_at    TEXT NOT NULL DEFAULT ''
);
```

**Migration:** `node_number INTEGER DEFAULT NULL` added via ALTER TABLE (line 141).

**Notes:**
- Single row expected per server, keyed on activation code
- No indexes or foreign keys
- Status field transitions: `'pending'` → `'active'` or `'revoked'`
- `activated_at` is a timestamp (ISO 8601 string)

### `terminals` table

**Location:** `backend/app/api/routes/hardware.py:148–159`

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
);
```

**Migrations:** Columns `name`, `ip_address`, `mac_address`, `role`, `is_hub` added via ALTER TABLE (lines 166–174).

**Notes:**
- Multiple rows possible (one per activated terminal on the local network)
- Primary key is `terminal_id` (e.g., `"T-01"`, `"T-02"`)
- `is_hub` enforced at application level (only one per server allowed; see `backend/app/api/routes/config.py:347–364`)
- No foreign key to `server_license`

---

## 2. Write Paths

### `server_license` INSERTs and UPDATEs

#### Path A: Activation (hardware.py:1348–1357)

- **File:** `backend/app/api/routes/hardware.py:1348–1357`
- **Function:** `activate_server()` (POST `/api/v1/hardware/activate`)
- **Trigger:** License activation code submitted by installer
- **Operation:**
  ```python
  INSERT OR REPLACE INTO server_license
      (activation_code, server_mac, platform, status, store_id, label, created_at, activated_at, node_number)
      VALUES (?, ?, ?, 'active', ?, ?, ?, ?, ?)
  ```
- **Fields written:** All columns; status hardcoded to `'active'`; `node_number` from activation server response or local registry fallback
- **Side effect:** Happens after external activation call succeeds or local fallback is approved

#### Path B: Revocation (hardware.py:1426)

- **File:** `backend/app/api/routes/hardware.py:1426`
- **Function:** `revoke_license(activation_code)` (DELETE `/api/v1/hardware/license/{activation_code}`)
- **Trigger:** Manager-authenticated request (requires auth)
- **Operation:**
  ```python
  UPDATE server_license SET status = 'revoked' WHERE activation_code = ?
  ```
- **Fields written:** `status` only (to `'revoked'`)
- **Note:** Soft-revoke; row remains in table but unusable

### `terminals` INSERTs and UPDATEs

#### Path A: Activation via hardware.py (hardware.py:1363–1370)

- **File:** `backend/app/api/routes/hardware.py:1363–1370`
- **Function:** `activate_server()` (POST `/api/v1/hardware/activate`)
- **Trigger:** License activation code submission (same request as server_license write)
- **Operation:**
  ```python
  INSERT INTO terminals (terminal_id, auth_key_hash, activated_at, is_active)
  VALUES (?, ?, ?, 1)
  ON CONFLICT(terminal_id) DO UPDATE SET
      auth_key_hash = excluded.auth_key_hash,
      activated_at = excluded.activated_at,
      is_active = 1
  ```
- **Fields written:** `terminal_id`, `auth_key_hash` (SHA256 of activation code), `activated_at` (ISO 8601 timestamp), `is_active` (hardcoded to 1)
- **Fields NOT written:** `name`, `ip_address`, `mac_address`, `role` (remain at DB defaults or prior values)
- **Additional side effect:** Auto-assigns unassigned devices:
  ```python
  UPDATE devices SET terminal_ids = ? WHERE (terminal_ids IS NULL OR ...) AND is_active = 1
  ```

#### Path B: Activation via licenses.py (licenses.py:263–275)

- **File:** `backend/app/api/routes/licenses.py:263–275`
- **Function:** `activate_license()` (POST `/api/v1/licenses/activate`)
- **Trigger:** License key + store/terminal name from admin customer lookup
- **Operation:**
  ```python
  INSERT OR REPLACE INTO terminals
      (terminal_id, auth_key_hash, activated_at, is_active, name, ip_address, mac_address, role, is_hub)
      VALUES (?, ?, ?, 1, ?, ?, ?, 'server', 0)
  ```
- **Fields written:** All columns; `role` hardcoded to `'server'`, `is_hub` hardcoded to 0
- **Note:** This is a DIFFERENT activation endpoint with richer data (uses admin API instead of internal activation server)
- **Does NOT write to server_license table**

#### Path C: Config push — terminal registration/update (config.py:349–362, 371–376)

- **File:** `backend/app/api/routes/config.py:349–362` and `371–376`
- **Function:** `push_changes()` (POST `/api/v1/config/push`)
- **Trigger:** Manager-authenticated config push (e.g., Overseer → Terminals)
- **Events emitted:**
  - `TERMINAL_REGISTERED` event (payload written to ledger, not hardware DB)
  - `TERMINAL_UPDATED` event (with optional `is_hub` field)
- **Note:** **Does NOT write to `hardware_config.db.terminals`**; only emits events to ledger
- **Hub constraint:** If `is_hub=True`, finds existing hub terminal and emits `TERMINAL_UPDATED` with `is_hub=False` (lines 354–363)

---

## 3. Read Paths

### `server_license` SELECTs

#### Path A: Offline fallback during activation (hardware.py:1304–1317)

- **File:** `backend/app/api/routes/hardware.py:1304–1317`
- **Function:** `activate_server()` (POST `/api/v1/hardware/activate`)
- **Context:** Fallback when external activation server is unreachable
- **Query:**
  ```python
  SELECT * FROM server_license WHERE activation_code = ?
  ```
- **Use:** Checks if code has `status='active'` and `node_number` set locally; approves activation if both true
- **Decision:** Returns 503 or 500 if offline and no local match; otherwise proceeds with local node_number

#### Path B: Initial fetch during activation (hardware.py:1338–1342)

- **File:** `backend/app/api/routes/hardware.py:1338–1342`
- **Function:** `activate_server()` (POST `/api/v1/hardware/activate`)
- **Context:** After external or fallback success, retrieve existing row metadata
- **Query:**
  ```python
  SELECT * FROM server_license WHERE activation_code = ?
  ```
- **Use:** Extracts `label` and `store_id` from prior row (if exists) to preserve metadata on re-activation

#### Path C: List all licenses (hardware.py:1408–1410)

- **File:** `backend/app/api/routes/hardware.py:1408–1410`
- **Function:** `list_licenses()` (GET `/api/v1/hardware/license/list`)
- **Context:** Boot probe or admin view
- **Query:**
  ```python
  SELECT * FROM server_license ORDER BY created_at DESC
  ```
- **Use:** Returns all license records; unauthenticated so terminal can check if ever activated
- **Decision:** Frontend uses this to decide if activation UI should appear

#### Path D: Live licensure check (licenses.py:299–303)

- **File:** `backend/app/api/routes/licenses.py:299–303`
- **Function:** `_has_active_server_license()` (called by `license_status` endpoint and boot probe)
- **Query:**
  ```python
  SELECT 1 FROM server_license WHERE status = 'active' LIMIT 1
  ```
- **Use:** Returns True if any row exists with status='active'
- **Decision:** `/api/v1/licenses/status` returns HTTP 402 if False
- **Called by:** `check_license_activation()` in `dependencies.py:111` (boot-time probe)

### `terminals` SELECTs

#### Path A: Resolve local terminal_id at startup (main.py:245–250)

- **File:** `backend/app/main.py:245–250`
- **Function:** `_load_terminal_id_from_db()`
- **Context:** Called during lifespan setup (line 274)
- **Query:**
  ```python
  SELECT terminal_id FROM terminals
  WHERE is_active = 1 ORDER BY activated_at DESC LIMIT 1
  ```
- **Use:** Sets `settings.terminal_id` from the most recently activated terminal
- **Decision:** Returns empty string if no active terminal found (forces licensure check to fail)
- **Persistence:** Survives restarts; used by all subsequent routes and projections

#### Path B: List all terminals (hardware.py:945–948)

- **File:** `backend/app/api/routes/hardware.py:945–956`
- **Function:** `list_terminals()` (GET `/api/v1/hardware/terminals`)
- **Context:** Manager-authenticated read-only registry
- **Query:**
  ```python
  SELECT terminal_id, name, ip_address, mac_address, role, is_hub, is_active, activated_at
  FROM terminals
  WHERE is_active = 1 ORDER BY activated_at
  ```
- **Use:** Returns all active terminals for UI display
- **Decision:** Frontend uses to show terminal list; read-only (no manual registration endpoint)

#### Path C: Get terminals for config projection (overseer_config_service.py:516–596)

- **File:** `backend/app/services/overseer_config_service.py:516–596`
- **Function:** `get_terminals()` (called by `/api/v1/config/terminals` and `/api/v1/config/terminal-bundle`)
- **Queries:**
  1. **Ledger query:** `SELECT * FROM events WHERE event_type IN ('terminal.registered', 'terminal.updated') LIMIT 1000`
     - Replays ledger events to build current terminal state
  2. **Hardware DB query (enrichment):** `SELECT activated_at, is_active FROM terminals WHERE terminal_id = ?` (line 552)
     - For each terminal in ledger, enriches with activation status from hardware DB
  3. **Device assignment:** `SELECT * FROM devices WHERE is_active = 1`
     - For each terminal, finds assigned printers/readers (line 561)
- **Use:** Returns combined projection: ledger terminal config + hardware activation status + device assignments
- **Decision:** If hardware DB query fails, continues with ledger-only data (line 585–592)

---

## 4. Local Terminal Identity

### How does the running backend know WHICH terminal it is?

**Primary source:** `hardware_config.db.terminals` table (activated-terminals registry)

**Resolution function:** `backend/app/main.py:233–253` — `_load_terminal_id_from_db()`

**Algorithm:**
1. On startup (`lifespan` hook, line 274), call `_load_terminal_id_from_db()`
2. Query: `SELECT terminal_id FROM terminals WHERE is_active = 1 ORDER BY activated_at DESC LIMIT 1`
3. Return the most recently activated `terminal_id`, or empty string if no active row
4. Set `settings.terminal_id = resolved_value`

**Persistence:**
- Survives restarts because it reads from the persistent SQLite table
- Terminal identity is bound at activation time (auth_key_hash derives from activation code)
- Can be re-bound if the activation code is re-submitted (ON CONFLICT UPDATE)

**Default behavior:** Empty `settings.terminal_id` means "unactivated"; boot probe logs warning and fails the licensure check

**Note:** There is NO environment variable or config file alternative. The database is the sole source of identity.

---

## 5. Sync Model

### Is there existing peer-to-peer sync code?

**No peer-to-peer sync code exists for terminals or licenses.**

### Existing sync architecture

**Location:** `backend/app/api/routes/sync.py` (config event pull-down only)

**Model:**
- **One-way pull:** Overseer → Terminal (config events only)
- **Endpoint:** `GET /api/v1/sync/config/events` (line 38–72)
  - Terminals call this endpoint periodically with `since: int` (last seen sequence number)
  - Returns config events (prefixed with `CONFIG_EVENT_PREFIXES`) in ledger order
- **Replay endpoint:** `POST /api/v1/sync/config/events/replay` (line 75–179)
  - Terminals POST fetched events back to themselves to apply idempotently

**What is NOT synced:**
- Operational events (orders, payments, shifts) — local only
- License activation records — each server independent
- Terminal registration records — each server has its own `terminals` table
- Server activation records — `server_license` table is local-only

### Determinism and convergence

**License/terminal data is NOT meant to converge across peers.** Each server:
- Has its own independent `server_license` and `terminals` rows
- Activation is per-hardware (keyed on MAC + activation code)
- There is no replication, cross-checks, or multi-server validation

### Terminal discovery and registration

**How are terminals discovered?**

1. **Manual registration (via `/api/v1/hardware/activate` or `/api/v1/licenses/activate`):**
   - Operator activates a license code
   - Terminal self-registers in hardware_config.db.terminals
   - No peer discovery mechanism

2. **mDNS service broadcast (optional):**
   - `backend/app/main.py:298–315` — registers `kindpos.local` via Zeroconf
   - Used for network discovery but does NOT auto-register terminals
   - Each terminal registers itself explicitly via activation

3. **No automatic sync of terminal lists between servers**

---

## 6. License Activation Flow

### POST /api/v1/hardware/activate (official endpoint)

**File:** `backend/app/api/routes/hardware.py:1204–1395`

**Sequence of side effects:**

1. **Fetch activation code from request**
   - Extract and uppercase `activation_code`, `server_mac`, `platform`

2. **Contact external activation server (kindpos.com)**
   - Two retry attempts with 5-second backoff (lines 1234–1296)
   - POST to `{settings.activation_server_url}/api/activate` with code + fingerprint
   - On 200: Extract `node_number` from response
   - On 409 (already_activated): Extract `node_number` from response
   - On 404: Reject (key not found)
   - On timeout/network error (both attempts fail): Fall through to offline fallback

3. **Offline fallback (if network unreachable)**
   - Query `SELECT * FROM server_license WHERE activation_code = ?` (line 1305)
   - If row exists, `status='active'`, and `node_number` is set: Approve using local `node_number`
   - Otherwise: Return 503 (cannot reach server and no local record)

4. **Derive terminal_id**
   - `terminal_id = f"T-{str(node_number).zfill(2)}"`  (line 1251 or 1313)
   - Example: node 1 → `"T-01"`, node 42 → `"T-42"`

5. **Write to server_license table**
   - `INSERT OR REPLACE` with all columns (lines 1348–1357)
   - Hardcoded status: `'active'`
   - Preserves existing `label` and `store_id` if row already exists
   - Sets `created_at` to prior row's value or current timestamp
   - Sets `activated_at = now`
   - Sets `node_number` from external response or fallback

6. **Write to terminals table**
   - `INSERT ... ON CONFLICT UPDATE` (lines 1363–1370)
   - Hardcoded `is_active = 1`
   - Hardcoded `role = 'server'` (implicit, not shown; only these fields set: `terminal_id`, `auth_key_hash`, `activated_at`, `is_active`)
   - Does NOT populate `name`, `ip_address`, `mac_address`, `is_hub` (remain at defaults)
   - `auth_key_hash = SHA256(activation_code)`

7. **Auto-assign devices**
   - `UPDATE devices SET terminal_ids = ?` for all devices with empty/null `terminal_ids` (lines 1373–1378)
   - Sets them to `["{terminal_id}"]` JSON array

8. **Emit ledger event**
   - `server_activated()` event (lines 1382–1388)
   - Payload: `activation_code`, `server_mac`, `platform`, `label`
   - Terminal_id used: the derived `terminal_id` from step 4
   - This event is appended to `event_ledger.db` for audit trail

9. **Return response**
   - HTTP 200 with `{"success": True, "terminal_id": terminal_id, "node_number": node_number, ...}`

### What it does NOT do

- Does NOT write `license.json` file (that's an older flow in `licenses.py`)
- Does NOT update the terminal name/IP/MAC from admin data
- Does NOT check or enforce single-hub constraint (only config.py does)
- Does NOT replicate to other servers

---

## 7. Status Check Flow

### GET /api/v1/licenses/status (live licensure check)

**File:** `backend/app/api/routes/licenses.py:309–327`

**Exact query:**
```python
async with db.execute(
    "SELECT 1 FROM server_license WHERE status = 'active' LIMIT 1"
) as cur:
    row = await cur.fetchone()
    return row is not None
```

**Return shape:**
```json
{
  "activated": true
}
```
or HTTP 402 with:
```json
{
  "detail": "No active license found. Activate this terminal at /activation."
}
```

**What "licensed" means in this code:**
- **Authoritative definition:** Any row in `server_license` table with `status='active'` exists
- **Cache-free:** Queried live on every call (not cached at startup)
- **Revocation visible immediately:** If admin changes `status='revoked'`, next `/licenses/status` call returns 402

**Alternative check (boot-time):**
- `dependencies.py:94–133` — `check_license_activation()` called during `lifespan` startup
- Calls same `_has_active_server_license()` function
- Sets `app.state.activated = bool(result)`
- Logs warning if unlicensed: `"*** STARTUP WARNING: no active license in server_license table ***"`

---

## 8. Conflicts and Dead Code

### Conflict: Two activation endpoints

**Issue:** Two separate license activation flows exist, writing to `terminals` table with different data.

#### `/api/v1/hardware/activate` (official, hardware.py:1204–1395)
- Integrated with external activation server (kindpos.com)
- Offline fallback support
- Writes `auth_key_hash` only to `terminals` (other fields left blank)
- Also writes to `server_license` table
- Returns node_number and terminal_id

#### `/api/v1/licenses/activate` (licenses.py:183–286)
- Queries admin API for customer/terminal info
- Does NOT write to `server_license` table (only `terminals`)
- Writes full terminal metadata: `name`, `ip_address`, `mac_address`, `role`, `is_hub`
- Meant for multi-terminal licensed customers pulling from admin
- Less integration with activation server

**Risk:** An operator using the wrong endpoint gets inconsistent state:
- If they POST to `/hardware/activate`, `server_license` gets populated but `terminals` has sparse data
- If they POST to `/licenses/activate`, `server_license` never gets written
- The two tables can diverge

### Dead or unused fields

#### `server_license.store_id`
- **Written:** During activation (line 1355, extracted from prior row or empty)
- **Read:** Never
- **Status:** Dead field — populated but not consumed

#### `server_license.label`
- **Written:** During activation (line 1355, extracted from prior row)
- **Read:** Never (except for re-write in same request)
- **Status:** Dead field — might have been intended for display but never used

#### `server_license.platform`
- **Written:** During activation (line 1355, from request.platform)
- **Read:** Never
- **Status:** Diagnostic field, not used in business logic

#### `terminals.name`, `terminals.ip_address`, `terminals.mac_address`
- **Written (hardware.py path):** Never (left at default empty strings)
- **Written (licenses.py path):** During activation (lines 272–274)
- **Read (hardware.py):** Yes, in `list_terminals()` (line 946)
- **Read (overseer_config_service.py):** Indirectly (loaded from ledger TERMINAL_REGISTERED events, not from this table)
- **Status:** Partially dead in hardware.py flow; only licenses.py flow populates them

#### `terminals.role`
- **Written (hardware.py path):** Never (left at default `'server'`)
- **Written (licenses.py path):** Hardcoded to `'server'` (line 267)
- **Read:** Yes, in `list_terminals()` (line 946)
- **Status:** Always `'server'`; role is actually tracked in ledger (TERMINAL_REGISTERED.role), not in hardware DB

#### `terminals.is_hub`
- **Written (hardware.py path):** Never (left at default 0)
- **Written (licenses.py path):** Hardcoded to 0 (line 267)
- **Read:** Yes, in `list_terminals()` (line 953)
- **Status:** Always 0 in hardware DB; actual hub state is in ledger (TERMINAL_UPDATED.is_hub) and enforced in config.py, not here

### Unreachable code paths

#### `licenses.py` activation path is shadowed
- **File:** `backend/app/api/routes/licenses.py:183–286`
- **Status:** Functional but appears to be legacy or unused
- **Inference:** 
  - Does not write `server_license` (required for license check in `/licenses/status` to pass)
  - Assumes admin API endpoint exists (not part of standard KINDpos backend)
  - Hardcodes response shape that doesn't match current frontend expectations
- **Risk:** If an operator uses this endpoint, the terminal will appear activated in `terminals` but unlicensed (no `server_license` row)

### TODO/FIXME/XXX comments

No comments found in license/terminal/sync code paths.

---

## Summary

**State of the system:**
- License activation is correctly gated on `server_license.status='active'` (live check, no cache bypass)
- Terminal identity is correctly resolved from `terminals` table at startup
- Two activation endpoints exist with different data models (potential source of operator confusion)
- Dead fields in both tables (store_id, label, platform, role, is_hub, name, ip_address, mac_address) are written but never read
- No peer-to-peer sync; each server is independent
- Config event pull-down (Overseer → Terminal) is one-way and covers only config, not operational or license data

**Audit complete.**
