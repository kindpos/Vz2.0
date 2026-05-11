# OVERSEER_AUTH.md

**Repository:** KINDpos-Vz2.0
**Status:** Locked design — implement only what is specified here.
**Last updated:** 2026-05-10
**Companion doc:** `PROVISIONING_FLOW.md` (KINDpos-site repo)

---

## 1. Purpose and scope

This document defines the authentication, authorization, and terminal-binding model for the local Overseer on a KINDpos installation. The Overseer is the single source of truth for user identity and terminal authorization within one customer's store. It is independent of kindpos.com; the system must remain fully operational with no internet connection after initial provisioning.

**Covers:**
- The user / account / role model
- First-boot detection
- Login flow (Overseer browser session)
- Terminal-binding handshake
- Token issuance, validation, expiry, revocation
- Offline behavior expectations
- Phone-home triggers (contract defined in companion doc)

**Does NOT cover:**
- Anything happening on kindpos.com (see `PROVISIONING_FLOW.md`)
- Terminal-side UI for the login screen (frontend implementation)
- Existing PIN-based staff auth at the terminal level (operational, separate)

---

## 2. Identity model

### 2.1 Users

Users live in a new local SQLite database (`accounts.db`), kept separate from `hardware_config.db` and `event_ledger.db` for clean separation of concerns. Each user has:

| Field | Type | Notes |
|---|---|---|
| `user_id` | TEXT (UUID v4) | Primary key |
| `email` | TEXT UNIQUE | Login identifier, case-insensitive |
| `password_hash` | TEXT | argon2id; plaintext never stored, never logged |
| `role` | TEXT | One of: `store_admin`, `manager`, `server`, `accountant` |
| `must_change_password` | INTEGER | `1` for pre-provisioned admin; cleared after change |
| `created_at` | TEXT | ISO 8601 |
| `updated_at` | TEXT | ISO 8601 |
| `last_login_at` | TEXT | ISO 8601, nullable |
| `is_active` | INTEGER | Allows disable without delete |

### 2.2 Roles

Four roles, additive in privileges:

- **`server`** — take orders, process payments, view own checkouts. No admin actions.
- **`manager`** — server permissions plus tip adjustments, voids, comps, end-of-shift operations.
- **`accountant`** — read-only access to reporting endpoints. No operational permissions.
- **`store_admin`** — full Overseer access: user management, terminal binding, configuration, all reports.

The pre-provisioned account is `store_admin`. Additional users are created in the Overseer UI by the `store_admin`.

### 2.3 Passwords vs PINs

`store_admin` and `accountant` log in with **email + password** (longer credentials, used infrequently).
`manager` and `server` continue to use **PIN-based login at terminals** for operational speed.

Both paths grant the same role-gated permissions. PIN management remains as it exists today in the `staff` table. This document adds the user/password layer for admin-tier access only.

---

## 3. Schema

### 3.1 New tables (accounts.db)

```sql
CREATE TABLE users (
  user_id              TEXT PRIMARY KEY,
  email                TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash        TEXT NOT NULL,
  role                 TEXT NOT NULL CHECK (role IN
                         ('store_admin','manager','server','accountant')),
  must_change_password INTEGER NOT NULL DEFAULT 0,
  created_at           TEXT NOT NULL,
  updated_at           TEXT NOT NULL,
  last_login_at        TEXT,
  is_active            INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE sessions (
  session_id    TEXT PRIMARY KEY,
  user_id       TEXT NOT NULL REFERENCES users(user_id),
  created_at    TEXT NOT NULL,
  expires_at    TEXT NOT NULL,
  ip            TEXT,
  user_agent    TEXT,
  revoked       INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE terminal_bindings (
  slot_id              TEXT PRIMARY KEY,
  terminal_name        TEXT NOT NULL,
  hardware_fingerprint TEXT,
  bound_at             TEXT,
  bound_by_user_id     TEXT REFERENCES users(user_id),
  token                TEXT,
  token_expires_at     TEXT,
  is_active            INTEGER NOT NULL DEFAULT 1,
  is_hub               INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE revocations (
  slot_id            TEXT PRIMARY KEY REFERENCES terminal_bindings(slot_id),
  revoked_at         TEXT NOT NULL,
  revoked_by_user_id TEXT REFERENCES users(user_id),
  source             TEXT NOT NULL CHECK (source IN ('local','cloud')),
  reason             TEXT
);

CREATE TABLE provisioning (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE phone_home_queue (
  queue_id      TEXT PRIMARY KEY,
  endpoint      TEXT NOT NULL,
  payload       TEXT NOT NULL,
  attempt_count INTEGER NOT NULL DEFAULT 0,
  next_attempt  TEXT NOT NULL,
  status        TEXT NOT NULL DEFAULT 'pending'
                CHECK (status IN ('pending','sent','failed_retrying','abandoned')),
  created_at    TEXT NOT NULL,
  last_error    TEXT
);
```

### 3.2 Pre-seeded state (from SD image)

The image-builder (see `PROVISIONING_FLOW.md` §3) writes these rows before shipping:

- One `users` row — the customer's `store_admin` with `must_change_password = 1`
- N `terminal_bindings` rows — one per purchased slot, all unbound
- `provisioning` rows for:
  - `first_boot_pending` = `'true'`
  - `customer_id`, `store_ref`, `customer_api_key`
  - `overseer_private_key`, `overseer_public_key` (Ed25519)
  - `recovery_code_hash` (argon2id of the printed recovery code)

---

## 4. First-boot detection

On Overseer startup, check `provisioning.first_boot_pending`.

**If `'true'`:**
1. Render the login screen with no setup wizard (image is already personalized).
2. On the first successful login (will be the pre-provisioned `store_admin`):
   - Force password change before any other action.
   - On successful password change, enqueue the activated phone-home (§9.1).
   - Set `provisioning.first_boot_pending = 'false'`.
   - If the hub-slot auto-bind is enabled (open question §11.3), bind it now using the Pi's own fingerprint.

**If `'false'`:** Normal Overseer behavior. No special path.

---

## 5. Authentication endpoints

All under `/v1/auth/*` on the Overseer FastAPI backend. CORS restricted to the configured Overseer hostname and the LAN range. All responses use lowercase status values per §10.

### 5.1 POST /v1/auth/login

**Request:**
```json
{ "email": "owner@sammys.com", "password": "..." }
```

**Response 200:**
```json
{
  "user_id": "...",
  "email": "owner@sammys.com",
  "role": "store_admin",
  "must_change_password": true,
  "session_id": "...",
  "expires_at": "2026-05-11T14:00:00Z"
}
```

Sets `HttpOnly; Secure; SameSite=Strict` session cookie. Session lifetime: 24 hours, refreshed on activity.

**Errors:** 401 (invalid credentials, generic message), 423 (account disabled), 429 (rate limit).

**Rate limit:** 5 failed attempts per email per 5 minutes; 20 failed attempts per source IP per 5 minutes. Beyond cap, return 429 with `Retry-After`. Successful login resets counters for that email.

### 5.2 POST /v1/auth/logout

Authenticated. Marks the session `revoked = 1`. Returns 204.

### 5.3 POST /v1/auth/password-change

Authenticated.

**Request:**
```json
{ "current_password": "...", "new_password": "..." }
```

Validates current password (constant-time compare on hash), hashes and stores new password, clears `must_change_password`, updates `updated_at`. Returns 204.

**Password requirements:** minimum 12 characters, no maximum, no composition rules (NIST 800-63B aligned). Reject if equal to current.

### 5.4 POST /v1/auth/password-recovery

Unauthenticated. Uses the recovery code printed on the welcome letter.

**Request:**
```json
{
  "email": "owner@sammys.com",
  "recovery_code": "kjsd-fhgi-poqe-zxcv-bnma-uyti",
  "new_password": "..."
}
```

Single-use. On success: hash and store new password, clear `must_change_password`, rotate `recovery_code_hash` (a new code is generated and surfaced in the UI for the user to write down). Returns 200 with the new recovery code.

### 5.5 GET /v1/auth/me

Authenticated. Returns the current session and user info. Used by frontends to verify session validity on page load.

---

## 6. Terminal binding

### 6.1 Discovery

Terminals discover the Overseer via mDNS at `kindpos.local`, port 8000. Fallback: hardcoded IP at first config (see `PROVISIONING_FLOW.md` §6).

### 6.2 Login on a terminal device

A terminal device boots its browser UI pointing at `http://kindpos.local:8000/terminal`. If the device has no cached binding token (first time, or after unbind), the terminal shows the same login screen as Overseer.

### 6.3 Bind handshake

When a logged-in `store_admin` on an unbound device requests binding:

**Step 1 — Collect fingerprint.** Terminal collects local hardware fingerprint: composite of primary MAC, CPU serial, and OS install ID, hashed.

**Step 2 — POST to Overseer:**
```
POST /v1/terminals/bind
Cookie: <session>

{
  "hardware_fingerprint": "...",
  "terminal_name_preferred": "Front Counter",
  "slot_id": "KIND-001-..."        // optional; null = auto-pick first unbound
}
```

**Step 3 — Overseer:**
- Validates session is `store_admin`.
- Validates `slot_id` exists, `is_active = 1`, and `hardware_fingerprint IS NULL`.
- Generates a signed token (§7).
- Updates row: writes `hardware_fingerprint`, `bound_at = now`, `bound_by_user_id`, `token`, `token_expires_at`. Updates `terminal_name` if provided.
- Enqueues `/api/notify/terminal-bound` phone-home.

**Response 200:**
```json
{
  "slot_id": "KIND-001-...",
  "terminal_name": "Front Counter",
  "token": "<base64url-payload>.<base64url-signature>",
  "token_expires_at": "2026-06-09T14:00:00Z",
  "overseer_public_key": "<base64url>"
}
```

Terminal stores `token`, `slot_id`, `overseer_public_key` in local secure storage. From this point, the terminal validates its own token offline on every boot.

### 6.4 Unbind

```
POST /v1/terminals/unbind/{slot_id}
Cookie: <session, must be store_admin>
```

Clears `hardware_fingerprint`, `token`, `bound_at`. Inserts into `revocations` with `source = 'local'` so previously-issued tokens are rejected on next contact.

### 6.5 Slot listing

```
GET /v1/terminals/slots
Cookie: <session, store_admin or manager>
```

Returns the full slot list with binding state. Used by the terminal-side picker UI ("Which terminal is this?") and the Overseer admin view.

---

## 7. Token format

Compact custom format, not JWT (smaller, simpler parser, no algorithm-negotiation footguns).

```
<base64url(payload_json)>.<base64url(signature)>
```

**Payload:**
```json
{
  "v": 1,
  "slot_id": "KIND-001-...",
  "store_ref": "STORE-1",
  "fingerprint": "...",
  "issued_at": "2026-05-10T14:00:00Z",
  "expires_at": "2026-06-09T14:00:00Z"
}
```

**Signature:** Ed25519 over the raw `payload_json` bytes (before base64), using the Overseer's private key.

**Terminal validates locally:**
1. Base64-decode payload.
2. Verify signature with stored Overseer public key.
3. Check `expires_at > now`.
4. Check `fingerprint` matches local hardware fingerprint.
5. Check token is not in the cached revocations list.

All five checks are local. No network required.

### 7.1 Token lifetime

**Default:** 30 days.
**Configurable in Overseer settings:** 7 to 90 days.

Shorter lifetimes give tighter revocation but risk legitimate locks during extended LAN outages. Default chosen for restaurant ops where weekly contact with the hub is essentially guaranteed.

### 7.2 Refresh

When a terminal contacts the Overseer (heartbeat, §8) and its token is within 7 days of expiry, the Overseer issues a refreshed token. Terminal silently updates its cached token. No user interaction.

### 7.3 Revocation check

Each Overseer contact, terminal includes its `slot_id`. Overseer responds with the current revocations list for the store (slot_ids only). If the terminal's own slot is on the list, the terminal locks immediately and discards its token.

```
GET /v1/terminals/revocations
Authorization: Bearer <token>
```

Response:
```json
{ "revoked_slot_ids": ["KIND-007-...", "KIND-012-..."], "as_of": "..." }
```

---

## 8. Offline behavior

- **Terminal can boot, authenticate, and operate** fully without Overseer reachability until its token expires.
- **Heartbeat:** Terminal pings Overseer every 5 minutes when online. Best-effort. Failures logged at debug level only.
- **Token expired + Overseer unreachable:** Terminal locks at next boot or shift-change with: *"Cannot reach Overseer. Contact your administrator."*
- **Recovery:** `store_admin` rebinds the slot per §6.3. If the device is recovered, the same fingerprint can be reused; the slot picks up where it left off.
- **Overseer offline:** All terminals continue operating on cached tokens. Events queue locally on each terminal and sync when Overseer returns (existing event-sync mechanism, out of scope for this doc).

---

## 9. Phone-home triggers

These are best-effort calls from the Overseer to kindpos.com. They are enqueued into `phone_home_queue` and retried on backoff: **1m, 5m, 15m, 1h, 6h, 24h, then daily**. Abandoned after 7 days; surface a non-blocking warning in Overseer.

Full request/response contracts are defined in `PROVISIONING_FLOW.md` §7. This section lists only the trigger conditions and payload skeletons.

### 9.1 Activated

**Trigger:** First successful password change after first-boot.
**Endpoint:** `POST /api/notify/activated`
**Auth:** `Bearer <customer_api_key>`

### 9.2 Terminal bound

**Trigger:** Each successful `/v1/terminals/bind` that transitions a slot from unbound → bound.
**Endpoint:** `POST /api/notify/terminal-bound`

### 9.3 Heartbeat (optional)

**Trigger:** Daily, if customer has support subscription.
**Endpoint:** `POST /api/notify/heartbeat`

### 9.4 User created (optional, opt-in)

**Trigger:** New `users` row created.
**Endpoint:** `POST /api/notify/user-created`
**Default:** Disabled. Enabled only if customer opts in via Overseer privacy settings.

---

## 10. Status enums — canonical, lowercase

For all internal use and on-wire communication:

| Field | Allowed values |
|---|---|
| `users.role` | `store_admin` \| `manager` \| `server` \| `accountant` |
| Slot status (derived) | `unbound` \| `bound` \| `revoked` |
| `phone_home_queue.status` | `pending` \| `sent` \| `failed_retrying` \| `abandoned` |
| `revocations.source` | `local` \| `cloud` |
| `users.is_active`, `must_change_password`, `terminal_bindings.is_active`, `is_hub`, `sessions.revoked` | `0` \| `1` (SQLite booleans) |

**No uppercase values anywhere. No legacy strings.**

---

## 11. Open questions

These need decisions before implementation but do not block this spec.

### 11.1 Recovery code format
Recommend 6 groups of 4 lowercase letters separated by hyphens (e.g., `kjsd-fhgi-poqe-zxcv-bnma-uyti`). Printed on the welcome letter. Entry field accepts flexible separators (spaces, hyphens, no separator) by stripping before hashing.

### 11.2 Multi-user creation at provisioning time
Should the image carry only the `store_admin`, with all other users created post-hoc in Overseer UI? Or should the customer specify staff at order time? **Recommend post-hoc** — fewer support touchpoints, customer better knows their staff after install.

### 11.3 Hub Pi auto-bind
The Pi running the Overseer also occupies one terminal slot. **Recommend auto-bind for the hub** at first password change, using the Pi's own fingerprint, with `is_hub = 1`. UX simplification: customer doesn't need to "bind" the device they're already logged into.

### 11.4 Concurrent sessions per user
Recommend **allow** (owner on phone and laptop simultaneously) but expose a "current sessions" list with revoke action in user settings.

### 11.5 Token storage on terminal devices
For Android (Swan 1) clients: storage is the Android Keystore equivalent. For Pi-based terminals: encrypted file in `/var/lib/kindpos/`. For browser-only terminals running in kiosk mode: HttpOnly cookies set by the Overseer's response — terminals are essentially long-lived browser sessions in that path.

---

## 12. Implementation gating

Every Claude Code prompt that touches auth, binding, or licensing must cite a specific section of this document. Prompts that propose behavior not specified here are out of scope and should be rejected or escalated to a spec update PR.