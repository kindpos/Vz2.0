# HARDWARE_ROUTING.md

**Repository:** KINDpos-Vz2.0
**Status:** Locked design
**Last updated:** 2026-05-11

---

## 1. Purpose

Defines the peripheral routing model for multi-terminal KINDpos
installations. Covers printer assignment, card reader assignment,
time-based rerouting, and the terminal proxy routing layer.

---

## 2. Schema changes

### 2.1 hardware_config.db — devices table

ALTER TABLE devices ADD COLUMN terminal_ids TEXT NOT NULL DEFAULT '[]';
-- JSON array of terminal_id strings.
-- Applies to: receipt printers (already present), card readers (new).
-- Kitchen printers are category-routed; terminal_ids ignored for them.

### 2.2 hardware_config.db — terminals table

ALTER TABLE terminals ADD COLUMN slot_id TEXT DEFAULT '';
-- Convention FK to accounts.db terminal_bindings.slot_id.
-- Populated on POST /v1/terminals/bind.

### 2.3 accounts.db — terminal_bindings table

ALTER TABLE terminal_bindings ADD COLUMN mac_address TEXT DEFAULT '';
-- Populated on POST /v1/terminals/bind.
-- Used by hub proxy to resolve MAC → IP → route.

### 2.4 hardware_config.db — printer_routing table

ALTER TABLE printer_routing ADD COLUMN time_from TEXT DEFAULT '';
  -- HH:MM 24h. Empty = rule applies at all times.
ALTER TABLE printer_routing ADD COLUMN time_to TEXT DEFAULT '';
  -- HH:MM 24h. Empty = rule applies at all times.
ALTER TABLE printer_routing ADD COLUMN days_of_week TEXT DEFAULT '[]';
  -- JSON array of integers 0-6 (0=Sunday). Empty array = all days.
ALTER TABLE printer_routing ADD COLUMN redirect_to_mac TEXT DEFAULT '';
  -- Target printer MAC. Empty = print on this printer normally.
  -- Non-empty = reroute this rule's jobs to another printer.
ALTER TABLE printer_routing ADD COLUMN override_active INTEGER DEFAULT 0;
  -- 1 = manual override in effect, ignores time/day filters.
ALTER TABLE printer_routing ADD COLUMN override_expires_at TEXT DEFAULT '';
  -- ISO 8601. Empty = override has no expiry. Checked at print time.

---

## 3. Routing rule resolution

At print time, candidate rules for a given job are evaluated in
this priority order:

1. **Manual override** — `override_active=1` AND
   (`override_expires_at` empty OR `override_expires_at > now`).
   Beats all other rules regardless of time or category.

2. **Time + day + category** — time window matches AND day matches
   AND `category_id` matches the job's category.

3. **Time + day + catch-all** — time window matches AND day matches
   AND `rule_type='all'`.

4. **Category only** — `category_id` matches, no time constraint.

5. **Catch-all** — `rule_type='all'`, no time or category constraint.

Within each tier, higher `priority` INTEGER wins.
First match wins; remaining rules are not evaluated.

### 3.1 Time window evaluation

- `time_from` and `time_to` both empty → rule is time-unrestricted.
- Overnight windows (`time_from > time_to`, e.g. 22:00–02:00)
  are supported: match if `now >= time_from OR now <= time_to`.
- `days_of_week` empty array → rule applies every day.

### 3.2 Redirect behavior

- `redirect_to_mac` empty → job prints on the matched printer.
- `redirect_to_mac` non-empty → job is sent to that MAC instead.
  If the redirect target is offline, fall back to the matched
  printer (best-effort; log warning).

### 3.3 Manual override

- Set via `POST /api/v1/hardware/routing/{id}/override`
  `{active: true, expires_at?: "ISO8601"}`
- Clear via `POST /api/v1/hardware/routing/{id}/override`
  `{active: false}`
- Expired overrides (`override_expires_at < now`) are treated as
  inactive; a cleanup pass runs at the start of each print job.

---

## 4. Card reader terminal assignment

Card readers gain `terminal_ids` (§2.1) matching the receipt printer
pattern. Assignment is managed in the Overseer HARDWARE settings UI.

`PaymentManager._terminal_device_map` is built from `terminal_ids` at
startup and refreshed on `POST /devices` (no restart required).
Previously this map was rebuilt only at process start — that
behavior is replaced.

---

## 5. Terminal proxy routing (kindpos.local/tXX)

The hub Pi's FastAPI backend proxies `/t{n}` paths to terminal Pis.

Resolution order for `/t{n}`:
1. Look up `node_number=n` in `hardware_config.db terminals`.
2. Read `mac_address` from that row.
3. ARP-resolve MAC → current IP (`ip neigh` / `arp -n`).
4. On ARP miss: use `terminals.ip_address` as fallback.
5. Proxy request to `http://{ip}:8000/{original_path}`.

`/t01` (`is_hub=1`) is served directly without proxy.

ARP resolution is cached for 30 seconds per MAC to avoid
subprocess overhead on every request.

---

## 6. Hardware fingerprint utility

`_get_hardware_fingerprint()` is extracted from `licenses.py` into
`backend/app/services/hardware_fingerprint.py`.

Platform paths:
- **Linux/Pi:** `/proc/cpuinfo` Serial + `/sys/class/net/eth0/address`
- **Windows:** `winreg HKLM\SOFTWARE\Microsoft\Cryptography\MachineGuid`
  + first non-loopback MAC via `uuid.getnode()`
- **Fallback:** `uuid.getnode()` only (dev/test environments)

Returns `sha256("{serial}:{mac}").hexdigest()`.

---

## 7. Implementation gating

Every prompt touching printer routing, card reader assignment,
terminal proxy, or hardware fingerprint must cite a specific
section of this document.
