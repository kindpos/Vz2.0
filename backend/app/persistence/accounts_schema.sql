-- accounts.db schema (OVERSEER_AUTH.md §3.1).
-- Six tables: users, sessions, terminal_bindings, revocations,
-- provisioning, phone_home_queue. Status enums lowercase per §10.

CREATE TABLE IF NOT EXISTS users (
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

CREATE TABLE IF NOT EXISTS sessions (
  session_id    TEXT PRIMARY KEY,
  user_id       TEXT NOT NULL REFERENCES users(user_id),
  created_at    TEXT NOT NULL,
  expires_at    TEXT NOT NULL,
  ip            TEXT,
  user_agent    TEXT,
  revoked       INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS terminal_bindings (
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

CREATE TABLE IF NOT EXISTS revocations (
  slot_id            TEXT PRIMARY KEY REFERENCES terminal_bindings(slot_id),
  revoked_at         TEXT NOT NULL,
  revoked_by_user_id TEXT REFERENCES users(user_id),
  source             TEXT NOT NULL CHECK (source IN ('local','cloud')),
  reason             TEXT
);

CREATE TABLE IF NOT EXISTS provisioning (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

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
