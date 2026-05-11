# PROVISIONING_FLOW.md

**Repository:** KINDpos-site
**Status:** Locked design — implement only what is specified here.
**Last updated:** 2026-05-10
**Companion doc:** `OVERSEER_AUTH.md` (KINDpos-Vz2.0 repo)

---

## 1. Purpose and scope

This document defines how a KINDpos installation is provisioned and shipped, how it phones home after activation, and what kindpos.com tracks about each installation. It is the contract between Alex's admin tool and the customer's Overseer.

**Covers:**
- Customer record schema on kindpos.com (D1)
- Image-builder admin workflow
- SD image structure and content
- Welcome email template
- Phone-home endpoints and their semantics
- Alert delivery to Alex
- License-key lifecycle on the kindpos.com side
- Cloud revocation propagation
- Endpoints that retire under the new flow

**Does NOT cover:**
- The local Overseer's auth model (see `OVERSEER_AUTH.md`)
- Terminal-side UI for login or binding
- Existing `/api/admin/*` admin-tool endpoints retained as-is

---

## 2. Customer record

### 2.1 D1 schema changes

```sql
ALTER TABLE customers ADD COLUMN customer_email TEXT;
ALTER TABLE customers ADD COLUMN customer_phone TEXT;
ALTER TABLE customers ADD COLUMN shipped_at    TEXT;
ALTER TABLE customers ADD COLUMN activated_at  TEXT;
ALTER TABLE customers ADD COLUMN support_status TEXT NOT NULL DEFAULT 'none';
                              -- 'none' | 'monthly' | 'annual'
ALTER TABLE customers ADD COLUMN api_key_hash  TEXT;
                              -- argon2id hash of customer_api_key baked into the image
ALTER TABLE customers ADD COLUMN status TEXT NOT NULL DEFAULT 'pending';
                              -- 'pending' | 'shipped' | 'activated' | 'cancelled'

CREATE TABLE IF NOT EXISTS provisioning_events (
  event_id     TEXT PRIMARY KEY,
  store_ref    TEXT NOT NULL REFERENCES customers(store_ref),
  event_type   TEXT NOT NULL,
                -- 'activated' | 'terminal_bound' | 'heartbeat' | 'user_created'
  event_data   TEXT,    -- JSON payload, opaque to D1
  source_ip    TEXT,
  occurred_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_provisioning_events_store
  ON provisioning_events(store_ref, occurred_at DESC);
```

### 2.2 Status normalization on existing `terminals` table

All `status` values normalized to **lowercase** from this point forward:

- `pending` — issued, no fingerprint yet
- `active` — bound to a hardware fingerprint, in use
- `revoked` — killed (permanent)

Migration: `UPDATE terminals SET status = LOWER(status);`

The `hardware_fingerprint` column is populated **only** by the `/api/notify/terminal-bound` phone-home (§7.2), never by an anonymous activation endpoint.

---

## 3. Image-builder workflow

### 3.1 Trigger

A "Build Image" button on a customer record in the admin UI. Available when:
- `customer_email` and `store_name` are set
- At least one `terminals` row exists for this customer
- `customers.status = 'pending'`

### 3.2 What the builder generates

When the admin clicks Build Image:

1. **`store_admin` temporary password** — cryptographically random, 20 characters from `[a-zA-Z0-9-_!]`. **Plaintext leaves kindpos.com only in:**
   - The welcome email body
   - The seeded `users.password_hash` in the SD image (as argon2id hash, not plaintext)
   *Plaintext is never persisted on kindpos.com.*

2. **Recovery code** — 6 groups of 4 lowercase letters: `kjsd-fhgi-poqe-zxcv-bnma-uyti`. Printed on the welcome letter (PDF). Hash stored as `provisioning.recovery_code_hash` in the image. Hash also stored as `customers.recovery_code_hash` on kindpos.com for support recovery.

3. **`customer_api_key`** — random 32-byte token, base64url-encoded. Used by the Overseer to authenticate phone-home calls. Stored as `customers.api_key_hash` (argon2id) on kindpos.com. Plaintext baked into the SD image only.

4. **Ed25519 keypair** — generated for the Overseer to sign terminal tokens. Both keys baked into the image (private key in the seeded `provisioning` table). Neither key is stored on kindpos.com; Overseer is the sole holder.

5. **Image artifact** — see §4.

### 3.3 Output

The admin tool produces three artifacts:

- **Image file** — the bootable SD image or diff overlay (see §4).
- **Welcome email preview** — final review before sending.
- **Print-ready welcome letter PDF** — includes the recovery code.

The image is **not** delivered until the admin clicks "Mark as Shipped" on the customer record. That action:
- Sets `customers.status = 'shipped'`, `customers.shipped_at = now`
- Sends the welcome email to `customer_email`
- Persists `api_key_hash`, `recovery_code_hash` to `customers`
- Logs an admin audit-log entry

---

## 4. SD image structure

### 4.1 Recommendation: diff overlay over a single master image

Maintain one master KINDpos image. Per-customer overlays are tiny tarballs that the master image's first-boot script applies. Avoids re-flashing a multi-gigabyte image per customer.

### 4.2 Layout on the SD card

```
/boot/
  kindpos-overlay.tar.gz       # per-customer overlay
  first-boot.sh                # init script that applies overlay, deletes itself, reboots
/opt/kindpos/                  # identical across all customers
/var/lib/kindpos/              # written by first-boot.sh from overlay:
  accounts.db                  #   - users (store_admin row)
                               #   - terminal_bindings (N unbound rows)
                               #   - provisioning (first_boot_pending, keys, api_key, etc.)
  kindpos.toml                 #   - store_name, customer_email, support contact
  welcome-letter.pdf           #   - same content as welcome email + recovery code
```

`first-boot.sh` runs once, applies the overlay, deletes itself, and reboots. From the customer's view, the Pi boots silently into setup, reboots, and comes up at `kindpos.local`.

### 4.3 What goes into `accounts.db` at provisioning

The overlay's `accounts.db` is seeded with exactly the rows specified in `OVERSEER_AUTH.md` §3.2. Image-builder must emit a database file whose schema and contents match that spec.

---

## 5. Welcome email template

**Subject:** `Your KINDpos is on its way`

**Body:**
```
Hi {customer_name},

Your KINDpos system is being shipped to you. Here's what to do when it
arrives.

1. Plug in the hub Pi (the unit labeled "Hub").
2. Give it about 30 seconds to boot.
3. On any device on the same network, open a browser and go to:
   http://kindpos.local/overseer

4. Log in with these credentials:
   Email:    {customer_email}
   Password: {temporary_password}

5. You'll be asked to set a new password. Choose something memorable but
   strong — you'll use it to log into your Overseer and to set up each
   terminal.

That's it. Your Overseer is ready, and you can plug in your terminals
next.

If kindpos.local doesn't load, check your router's connected-devices list
for one named "kindpos" and use its IP address instead:
   http://<ip-from-router>:8000/overseer

A printed recovery code is included in your hardware box. Keep it
somewhere safe — it's the only way to reset your password without
contacting us.

Questions or trouble? Reply to this email or call us at (XXX) XXX-XXXX.

— The KINDpos team
```

Customer name, email, and temporary password are substituted at send time. The recovery code is NOT in the email — it ships physically.

---

## 6. Discovery and IP fallback

The Pi advertises `kindpos` as its mDNS service name on the LAN. `kindpos.local` resolves on most home/SMB networks.

**Fallback options (in order of customer-friendliness):**

1. **Router's connected-devices list** — instructions in the welcome email. The Pi's hostname is `kindpos`; customer finds the IP and uses `http://<ip>:8000/overseer`. v1 ships with this only.

2. **Printed IP on a label** *(future)* — if Alex ships with a known router config or pre-configured static lease, the label is set at fulfillment.

3. **E-paper or LCD display on the unit** *(future hardware)* — Pi shows its IP and hostname.

4. **Companion mobile app** *(future)* — scans the LAN for the kindpos service, presents the URL.

For v1, the email instructions are the only fallback. Restaurant owners can typically navigate router admin pages, and Alex can guide by phone in edge cases.

---

## 7. Phone-home endpoints

All endpoints on kindpos.com, called by the customer's Overseer. **Auth:** `Authorization: Bearer <customer_api_key>` validated against `customers.api_key_hash` using argon2id verification.

Status values returned in responses are lowercase per `OVERSEER_AUTH.md` §10.

### 7.1 POST /api/notify/activated

**Trigger:** First successful password change after first-boot on the Overseer.

**Request:**
```json
{
  "store_ref": "STORE-1",
  "activated_at": "2026-05-10T14:00:00Z",
  "hub_fingerprint": "<sha256-of-composite>",
  "overseer_version": "2.0.0"
}
```

**Server action:**
1. Validate Bearer token resolves to a customer.
2. If `customers.store_ref` does not match request's `store_ref`, return 403.
3. Update `customers.activated_at = activated_at`, `customers.status = 'activated'`.
4. Insert `provisioning_events` row with `event_type = 'activated'`, full body in `event_data`.
5. Trigger alert delivery (§8).

**Response:** `204 No Content` on success. `401` on auth failure (do not leak detail). `403` on store mismatch. `409` if already activated (idempotent on the customer side; treat as no-op success on the Overseer side).

### 7.2 POST /api/notify/terminal-bound

**Trigger:** Each successful slot binding on the Overseer (slot transitions from unbound → bound).

**Request:**
```json
{
  "store_ref": "STORE-1",
  "slot_id": "KIND-001-A5B2-C3D4-E6F7",
  "terminal_name": "Front Counter",
  "hardware_fingerprint": "<sha256-of-composite>",
  "bound_at": "2026-05-10T14:30:00Z"
}
```

**Server action:**
1. Validate Bearer token and store_ref as in §7.1.
2. Validate `slot_id` belongs to this customer in `terminals` table.
3. Update `terminals` row: set `hardware_fingerprint`, `activated_at = bound_at`, `status = 'active'`, `terminal_name`.
4. Insert `provisioning_events` row.
5. No email alert; dashboard counter only.

**Response:** `204` on success. `404` if slot doesn't belong to this customer.

### 7.3 POST /api/notify/heartbeat *(optional, support-subscribed only)*

**Trigger:** Daily, only if `customers.support_status != 'none'`.

**Request:**
```json
{
  "store_ref": "STORE-1",
  "as_of": "2026-05-10T23:59:00Z",
  "overseer_version": "2.0.0",
  "terminal_count_bound": 3,
  "orders_24h": 142,
  "last_shift_end": "2026-05-10T22:30:00Z",
  "error_count_24h": 0
}
```

**Server action:** Insert `provisioning_events` row only. No customer record update unless health flags require it. Available to support dashboard.

**Response:** `204`.

### 7.4 POST /api/notify/user-created *(optional, opt-in)*

**Trigger:** New user added to Overseer, if customer has enabled this in privacy settings.

**Request:**
```json
{
  "store_ref": "STORE-1",
  "role": "manager",
  "created_at": "2026-05-12T10:00:00Z"
}
```

Note: **no email, name, or PII** in the payload. Role count tracking only.

**Response:** `204`.

### 7.5 GET /api/store/{store_ref}/revocations

**Trigger:** Overseer poll. Frequency: every 15 minutes for support-subscribed stores, every 24 hours otherwise.

**Auth:** `Bearer <customer_api_key>` validated against the matching `store_ref`.

**Query parameters:** `since` — ISO 8601 timestamp; returns slot_ids revoked at or after this time.

**Response 200:**
```json
{
  "as_of": "2026-05-10T15:00:00Z",
  "revocations": [
    { "slot_id": "KIND-007-...", "revoked_at": "2026-05-09T11:23:00Z" }
  ]
}
```

**Server action:** Read-only query against `terminals` where `status = 'revoked'` and `updated_at >= since`. Requires a `terminals.updated_at` column populated by any status-changing endpoint.

### 7.6 Retry policy (Overseer side)

Implemented as `phone_home_queue` per `OVERSEER_AUTH.md` §3.1. Backoff schedule: **1m, 5m, 15m, 1h, 6h, 24h, then daily**. Abandoned after 7 days of failure; surfaced as a non-blocking warning in the Overseer UI.

---

## 8. Alert delivery

When `POST /api/notify/activated` succeeds, kindpos.com fires alerts to Alex through configured channels:

- **Email** to the configured admin address. Subject: `KINDpos activated: {customer_name}`. Body: customer name, `store_ref`, `activated_at`, terminal count, hub fingerprint.
- **Slack webhook** *(optional)* to a configured URL.
- **Dashboard widget** "Recent activations" in the admin UI.

For `/api/notify/terminal-bound`: no email, dashboard counter only.
For `/api/notify/heartbeat`: no alert; data feeds analytics and the support dashboard.
For `/api/notify/user-created`: no alert; data is for support continuity only.

Channels configured in Alex's admin settings (a new page, not yet implemented; tracked in §12).

---

## 9. License-key lifecycle on kindpos.com

License keys (the `terminals.license_key` field) remain as internal slot identifiers. **They are never displayed to customers in the new flow.**

| Event | Trigger | Endpoint |
|---|---|---|
| Generated | Admin provisioning | `POST /api/admin/generate` (retained) |
| Bound | Phone-home from Overseer | `POST /api/notify/terminal-bound` (§7.2) |
| Revoked | Admin action | `POST /api/admin/revoke` (retained) |
| Propagated to Overseer | Overseer poll | `GET /api/store/{store_ref}/revocations` (§7.5) |

---

## 10. Cloud revocation

Alex's `/api/admin/revoke` retains current behavior: marks `terminals.status = 'revoked'`. The **new piece** is propagation to the affected Overseer:

1. Overseer polls `/api/store/{store_ref}/revocations?since={cursor}` on schedule.
2. New revocations land in the Overseer's local `revocations` table with `source = 'cloud'`.
3. Terminals subscribe to the local revocations list per `OVERSEER_AUTH.md` §7.3 and lock immediately.

For stores that never connect to the internet, cloud revocation never reaches them. **Local revocation** by `store_admin` in the Overseer is always immediately effective and is the primary kill switch. Cloud revocation is the kill-switch-of-last-resort for stolen-and-disconnected hardware.

---

## 11. Endpoints that retire

Within one release after the new flow stabilizes, these legacy endpoints return `410 Gone`:

| Endpoint | Replaced by |
|---|---|
| `POST /api/activate` *(LEFT JOIN bug)* | `POST /api/notify/terminal-bound` + `POST /api/notify/activated` |
| `POST /api/validate` | Local token validation per `OVERSEER_AUTH.md` §7 |
| `POST /api/checkin` | `POST /api/notify/heartbeat` |
| `GET /api/admin/config` *(leaks ADMIN_SECRET)* | Real admin login (§12) |

---

## 12. Security follow-ups

Not v1 deliverables but tracked here so they don't get lost:

1. **Replace ADMIN_SECRET** shared-token auth with a real user system for Alex (single-digit users, not multi-tenant SaaS).
2. **Rate limit** all phone-home endpoints per `customer_api_key`. Suggested: 1 req/sec sustained, burst of 30.
3. **Audit log** on kindpos.com for admin actions (revocations, customer creation, image generation, image downloads).
4. **HMAC-sign phone-home payloads** using `customer_api_key` as the secret, in addition to Bearer, to prevent replay if the key is captured in transit.
5. **Rotate `customer_api_key`** — endpoint for admin to issue a new key and update the customer's image overlay.

---

## 13. Open questions

### 13.1 Hub Pi's own slot
Does the hub Pi count as one of the customer's terminal slots? **Recommend yes** — it is a physical terminal running the POS. Image-builder marks the first slot as `is_hub = 1`. Per `OVERSEER_AUTH.md` §11.3, that slot auto-binds at first password change using the Pi's fingerprint.

### 13.2 Refurbishment / resale
If a customer sells their hardware to a new customer, the image must be wiped and re-flashed by Alex; transfer is not supported. Document in support docs and EULA.

### 13.3 Customer-initiated factory reset
Should the Overseer offer a "factory reset" that wipes local state? Useful for resale/return, dangerous if accidentally triggered. **Recommend** require physical button-press at boot (held for 10 seconds), not a software UI action.

### 13.4 Image artifact storage
Where do generated images live? **Recommend Cloudflare R2** with a signed URL that expires 30 days after generation. Admin can regenerate if needed.

### 13.5 Software versioning and updates
- **Support-subscribed customers:** auto-update from kindpos.com on heartbeat.
- **Non-subscribed customers:** manual trigger from Overseer ("Check for updates" button).
- Update mechanism is out of scope for this spec; flagged as a future deliverable.

### 13.6 Image-builder secret material
The image overlay contains plaintext secrets (`customer_api_key`, Ed25519 private key, password_hash). The artifact must be treated as sensitive:
- R2 storage with signed URLs that expire after first download or 24 hours, whichever is sooner.
- Admin audit-log entry for every image download.
- Image overlay tarball should be encrypted at rest with a per-customer derivation if possible.

---

## 14. Implementation gating

Every Claude Code prompt that touches license issuance, customer records, image generation, phone-home endpoints, or revocation propagation must cite a specific section of this document. Prompts that propose behavior not specified here are out of scope and should be rejected or escalated to a spec update PR.
