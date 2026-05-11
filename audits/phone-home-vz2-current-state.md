# Phase 1 Audit — KINDpos Vz2.0 Phone-Home Sender (Current State)

**Repo:** KINDpos-Vz2.0 (`origin/main`)
**Branch:** `main` (HEAD = `036de75`)
**Date:** 2026-05-11
**Spec references:** `OVERSEER_AUTH.md` §9; `PROVISIONING_FLOW.md` §7.6
**Scope:** Read-only inspection. No source files modified.

---

## A. Git state

`git log --oneline -5`:
```
036de75 Canonicalize spec filename to OVERSEER_AUTH.md
a464999 Force password change on first login
5709d81 Wire Overseer auth end-to-end: lifespan init, admin route, login UI
fc6070e Add Overseer local auth: accounts.db + user/session lifecycle
3df0ed4 Ensure terminals schema + flip admin status on activate
```

`git status`:
- Branch `main`, up to date with `origin/main`.
- Staged: new file `scripts/genhash.mjs`.
- Unstaged modified: `scripts/genhash.mjs`.
- Untracked: `.claude/settings.json`.
- No pending changes in `backend/` or `audits/`.

---

## B. `phone_home_queue` table

**Schema:** Defined in `backend/app/persistence/accounts_schema.sql:53-63`.

```sql
CREATE TABLE IF NOT EXISTS phone_home_queue (
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

- **Columns / types:** matches `OVERSEER_AUTH.md` §3.1 exactly, including the lowercase status enum (§10).
- **Existence at runtime:** the schema file is applied unconditionally during `init_accounts_db()`, so the table is created on every Overseer boot (see §F below).
- **Readers / writers in code:** **none**. The only non-test reference is the schema file itself (`accounts_schema.sql:3` header comment + `:53` table definition). The only test reference is `backend/tests/persistence/test_accounts_db.py:30`, which merely asserts the table exists in the schema.

**Conclusion:** the table is provisioned but no Python code reads from or writes to it. There is no enqueue, dequeue, retry-scan, or status-update path.

---

## C. Phone-home sender implementation

There is **no implementation of the spec'd phone-home sender** (§9 endpoints `POST /api/notify/activated`, `/api/notify/terminal-bound`, `/api/notify/heartbeat`, `/api/notify/user-created`).

The only outbound-to-kindpos.com code is a **separate, legacy license-activation/check-in path** that pre-dates the Overseer auth spec:

| File:line | Function | What it does |
|---|---|---|
| `backend/app/api/routes/licenses.py:37` | `WORKER_URL` constant | `https://kindpos.com/api/activate` |
| `backend/app/api/routes/licenses.py:38` | `CHECKIN_URL` constant | `https://kindpos.com/api/checkin` |
| `backend/app/api/routes/licenses.py:123-152` | `_perform_checkin()` | POSTs `{license_key, hardware_fingerprint, ip}` to `CHECKIN_URL`. **No auth header.** Best-effort, errors swallowed. |
| `backend/app/api/routes/licenses.py:155-167` | `start_license_checkin_loop()` | Background `asyncio` task; sleeps `CHECKIN_INTERVAL_S = 3600` and calls `_perform_checkin()`. |
| `backend/app/api/routes/licenses.py:182-286` | `activate_license()` route | `POST /licenses/activate`. Calls `kindpos.com/api/admin/config`, `…/admin/customers`, and `PUT …/admin/terminals/{license_key}`. |

Findings against the §9 spec:

- **Trigger:** None of these is the §9.1 trigger ("first successful password change after first-boot"). `activate_license` is triggered by the **operator manually entering a license key** at the activation scene.
- **Endpoint:** Calls `/api/admin/*` and `/api/checkin`, **not** the `/api/notify/*` endpoints defined in §7 / §9.
- **Auth:** Uses an **admin Bearer secret** fetched at request time from `kindpos.com/api/admin/config` (`licenses.py:201-206`), **not** the spec's `Bearer <customer_api_key>` baked into `provisioning`.
- **Retry / persistence:** Does **not** use `phone_home_queue`. Failures are logged at `debug`/`warning` and dropped (`licenses.py:151-152`, `:252-254`).
- **Wiring:** Standalone — exposed on the `/licenses` router; the check-in loop is started from `licenses.start_license_checkin_loop()` (call site lives in `app/main.py`'s `check_license_activation` flow).

**Conclusion:** the existing kindpos.com integration is a parallel legacy mechanism. The phone-home pipeline required by `OVERSEER_AUTH.md` §9 and `PROVISIONING_FLOW.md` §7.1–§7.6 does **not** exist yet.

---

## D. `provisioning` table

**Schema:** `backend/app/persistence/accounts_schema.sql:48-51`.

```sql
CREATE TABLE IF NOT EXISTS provisioning (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
```

**Repository:** `backend/app/persistence/provisioning_repository.py` (`ProvisioningRepository.get_value` / `set_value` / `delete`).

**Documented keys** (per docstring at `provisioning_repository.py:5-7`):
> `customer_id`, `recovery_code_hash`, `overseer_private_key`, `first_boot_pending`

**Keys actually read or written by code today:**
- `PROVISIONING_KEY_RECOVERY_HASH` — used by `backend/app/auth/recovery.py:39-98` (read/write via `ProvisioningRepository`).
- Same key is also written directly via raw SQL in `backend/app/api/routes/v1_auth.py:177-180` during the atomic password+recovery-code rotation.

**Searches for the §3.2 image-personalized keys** (`grep -rn "first_boot_pending\|customer_api_key\|store_ref" backend/`):
- `first_boot_pending` — **0 code references.** Only mentioned in the `provisioning_repository.py:6` docstring.
- `customer_api_key` — **0 references** (code or strings).
- `store_ref` — **0 references** (code or strings).

**Conclusion:** the `provisioning` key/value table is in place, but only the recovery-hash slot is exercised. None of the keys required to authenticate phone-home (`customer_api_key`), identify the store (`store_ref`), or gate first-boot (`first_boot_pending`) are read or written anywhere in the backend.

---

## E. First-boot detection (`OVERSEER_AUTH.md` §4)

**`provisioning.first_boot_pending` is not checked anywhere in the backend.** A repo-wide grep returns zero matches outside the spec docstring at `provisioning_repository.py:6`.

- **Startup path** (`backend/app/main.py:285-293`): calls `init_accounts_db(...)` only. No read of `first_boot_pending`, no branching on it.
- **Login path** (`backend/app/api/routes/v1_auth.py:192-251`): sets the session cookie and surfaces `must_change_password` directly from the `users` row; no inspection of `first_boot_pending`.
- **Password-change path** (`backend/app/api/routes/v1_auth.py:254-278`): updates the password hash and calls `_clear_must_change_password()`. It does **not** enqueue the §9.1 "activated" phone-home, and it does **not** flip `first_boot_pending` to `'false'`.
- **Password-recovery path** (`backend/app/api/routes/v1_auth.py:294-329`): same — no first-boot transition.

**Conclusion:** §4 is unimplemented. The "force password change on first login" commit (`a464999`) handles the password-change requirement via the per-user `must_change_password` flag but performs none of the first-boot-pending bookkeeping or the §9.1 phone-home enqueue.

---

## F. `accounts.db` initialization

- **Init function:** `init_accounts_db(path)` at `backend/app/persistence/accounts_db.py:36-58`. Applies `accounts_schema.sql` via `conn.executescript(...)`. `CREATE TABLE IF NOT EXISTS` makes it idempotent.
- **Lifespan wiring:** `backend/app/main.py:289-293`:
  ```python
  accounts_db_path = os.environ.get(
      "KINDPOS_ACCOUNTS_DB_PATH", str(DATA_DIR / "accounts.db")
  )
  init_accounts_db(accounts_db_path)
  ```
  Default path is `<DATA_DIR>/accounts.db`; env var override is honored.
- **`phone_home_queue` on init:** **Yes.** `accounts_schema.sql:53` creates it as part of the same `executescript` call, so every Overseer boot guarantees the table exists.

**Conclusion:** the database substrate for the queue is in place and wired into the FastAPI lifespan. Only the producer and the drain are missing.

---

## G. Existing `/api/notify` routes on the Vz2.0 backend

`grep -rn "/api/notify\|/notify" backend/app/` → **no matches**.

`grep -rn "phone.home\|phone_home" backend/app/` → only the schema header comment + table definition in `accounts_schema.sql`.

**Conclusion:** no `/api/notify/*` routes are registered on the Vz2.0 side. This is correct per spec — those endpoints live on `kindpos.com` (`PROVISIONING_FLOW.md` §7.1–§7.5). The Vz2.0 side is purely a client.

---

## H. Test coverage

`find backend/tests -name "*phone*" -o -name "*notify*" -o -name "*provisioning*"` → **no matches.**

The only adjacent coverage:
- `backend/tests/persistence/test_accounts_db.py:29-30` asserts the `provisioning` and `phone_home_queue` tables exist after `init_accounts_db()`.
- `backend/tests/auth/test_recovery.py` exercises `ProvisioningRepository` for the recovery-hash key only (`test_rotate_writes_hash_under_canonical_provisioning_key`, `:122-126`).

**Conclusion:** no behavioural tests cover phone-home enqueue, drain, retry, or first-boot transition. Schema-presence tests exist.

---

## Summary

| Spec requirement | Status |
|---|---|
| `phone_home_queue` table exists in schema (§3.1) | **Present** (`accounts_schema.sql:53-63`) |
| `phone_home_queue` table created on boot (§F) | **Yes** via `init_accounts_db` in `main.py:292` |
| Any code reads / writes `phone_home_queue` | **No** |
| `provisioning` table + repository (§3.1, §3.2) | **Present**; only `recovery_code_hash` is used |
| `provisioning.first_boot_pending` consulted on startup (§4) | **No** |
| `customer_api_key` / `store_ref` stored or read (§3.2, §9) | **No** |
| `/api/notify/activated` sender, enqueued on first password change (§9.1) | **Missing** |
| `/api/notify/terminal-bound` sender (§9.2) | **Missing** |
| Phone-home retry policy via `phone_home_queue` (§7.6) | **Missing** |
| Phone-home tests | **Missing** (only schema-presence test) |
| Pre-existing kindpos.com client code | `licenses.py` legacy activation/check-in — separate path, no `phone_home_queue`, no `customer_api_key` |

The substrate is in place (DB, table, repository, lifespan init), but the producer side (enqueue on first password change, enqueue on terminal bind), the drain side (background loop, backoff schedule, status transitions), the auth wiring (`customer_api_key` Bearer header from `provisioning`), and the first-boot gate (§4) are all unimplemented. The existing `licenses.py` activation path is structurally and semantically distinct from §9 phone-home and should not be assumed to satisfy it.

PHONE HOME VZ2 AUDIT COMPLETE
