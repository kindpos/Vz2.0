# KINDpos License Management — Cloudflare D1

D1 is Cloudflare's SQLite edge database, providing low-latency access to license
and node registration data globally.

## Schema

### licenses
Tracks generated and activated activation codes.

| Column | Purpose |
|--------|---------|
| `id` | License code identifier (e.g. `SMYS-001-a7f2-8b3c-1e90`) |
| `prefix` | Store abbreviation (e.g. `SMYS`, `MSWT`) |
| `node_number` | Sequential node ID (e.g. `001`, `002`, `003`) |
| `sku` | Product SKU (e.g. `KINDPOS-PI-5`) |
| `store_ref` | Internal store reference code |
| `activated` | Boolean flag (0 = pending, 1 = activated) |
| `hardware_fingerprint` | SHA256 of device IMEI/MAC (set on first activation) |
| `store_name` | Friendly store name (populated on activation) |
| `terminal_name` | Friendly terminal name (e.g. `Register-1`) |
| `created_at` | ISO 8601 timestamp when code was generated |
| `activated_at` | ISO 8601 timestamp of first activation |
| `last_seen` | ISO 8601 timestamp of last heartbeat |

### nodes
Tracks active hardware instances currently running KINDpos.

| Column | Purpose |
|--------|---------|
| `id` | Unique node identifier (SHA256 of hardware fingerprint) |
| `license_id` | FK to the license that activated this node |
| `prefix` | Store prefix (denormalized for fast lookup) |
| `node_number` | Node ID (denormalized for fast lookup) |
| `store_name` | Store name (at time of activation) |
| `terminal_name` | Terminal name (at time of activation) |
| `activated_at` | Timestamp when this node went live |
| `last_seen` | Timestamp of last health check heartbeat |

## License Code Format

```
PREFIX-NNN-XXXX-XXXX-XXXX
```

- **PREFIX** — Store abbreviation (2–4 chars, uppercase)
  - `SMYS` = Smile Yeshiva Springs
  - `MSWT` = Main Street West Toronto
  - `QNSD` = Queens, New South Dakota
- **NNN** — Sequential node number (001, 002, 003, ...)
- **XXXX-XXXX-XXXX** — Random 12-digit hex suffix (generated, unique per code)

### Examples

```
SMYS-001-a7f2-8b3c-1e90
MSWT-002-c3e9-5d4b-2f67
QNSD-001-b1a8-9e2d-4c73
```

## Activation Flow

1. **Generation** — Operator generates codes in the control panel
   - Inserts into `licenses` with `activated=0`
   - Code and QR printed on a card shipped to the store

2. **First Activation** — KINDpos Pi contacts activation endpoint
   - Reads license code from QR or manual entry
   - Captures hardware fingerprint (MAC/IMEI)
   - `licenses.activated` → 1, `activated_at`, `hardware_fingerprint` set
   - Row inserted into `nodes` with FK to the license

3. **Ongoing** — Node sends periodic heartbeats
   - Updates `nodes.last_seen`
   - If `nodes` entry missing, re-activates from the license record

## Queries

**Find all active nodes for a store:**
```sql
SELECT nodes.* FROM nodes WHERE nodes.prefix = 'SMYS'
```

**Find pending activations (generated but not yet activated):**
```sql
SELECT * FROM licenses WHERE activated = 0
```

**Find a node by hardware fingerprint:**
```sql
SELECT * FROM licenses WHERE hardware_fingerprint = 'abc123...'
```

**List all nodes registered in the last 24 hours:**
```sql
SELECT * FROM nodes
WHERE datetime(last_seen) > datetime('now', '-1 day')
```
