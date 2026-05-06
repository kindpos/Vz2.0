CREATE TABLE IF NOT EXISTS licenses (
  id                   TEXT PRIMARY KEY,
  prefix               TEXT NOT NULL,
  node_number          TEXT NOT NULL,
  sku                  TEXT NOT NULL,
  store_ref            TEXT,
  activated            INTEGER DEFAULT 0,
  hardware_fingerprint TEXT,
  store_name           TEXT,
  terminal_name        TEXT,
  created_at           TEXT NOT NULL,
  activated_at         TEXT,
  last_seen            TEXT
);

CREATE TABLE IF NOT EXISTS nodes (
  id                   TEXT PRIMARY KEY,
  license_id           TEXT NOT NULL,
  prefix               TEXT NOT NULL,
  node_number          TEXT NOT NULL,
  store_name           TEXT,
  terminal_name        TEXT,
  activated_at         TEXT,
  last_seen            TEXT,
  FOREIGN KEY (license_id) REFERENCES licenses(id)
);
