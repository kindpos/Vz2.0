# KINDpos Licensing Worker — Deployment Guide

Deploy the license activation Worker to Cloudflare edge.

## Prerequisites

- Cloudflare account with a domain
- Node.js 18+ installed
- wrangler CLI

## Step 1: Install wrangler

```bash
npm install -g wrangler
```

Or locally in the project:

```bash
cd pi/cloudflare
npm install
```

## Step 2: Login to Cloudflare

```bash
wrangler login
```

This opens your browser to authorize wrangler to manage your account.

## Step 3: Create the D1 Database

Create a new D1 database named `kindpos-licenses`:

```bash
wrangler d1 create kindpos-licenses
```

Output will show:

```
✓ Successfully created new database.
Database ID: 12345678-1234-1234-1234-123456789abc
```

Copy the **Database ID** — you'll use it in step 4.

## Step 4: Update wrangler.toml

Edit `pi/cloudflare/wrangler.toml` and replace `REPLACE_WITH_D1_ID` with the actual database ID:

```toml
[[d1_databases]]
binding = "KINDPOS_DB"
database_name = "kindpos-licenses"
database_id = "12345678-1234-1234-1234-123456789abc"  # ← Your ID here
```

## Step 5: Initialize the Database Schema

Run the schema initialization against the remote database:

```bash
cd pi/cloudflare
npm run db:init:remote
```

This executes `schema.sql` on the D1 database, creating the `licenses` and `nodes` tables.

## Step 6: Set the ADMIN_SECRET Environment Variable

Set the admin secret that will guard `/api/admin/*` endpoints. Choose a strong value:

```bash
wrangler secret put ADMIN_SECRET
```

Wrangler will prompt you to enter the secret. Paste a secure value, e.g.:

```
your-super-secret-admin-key-here-32-chars-minimum
```

This stores the secret securely in Cloudflare's environment.

## Step 7: Deploy the Worker

```bash
npm run deploy
```

Or directly:

```bash
wrangler deploy
```

Output will show:

```
✓ Successfully published your Worker
  https://kindpos-licensing.your-account.workers.dev
```

Your Worker is now live at that URL.

## Step 8: Test the Endpoints

### Generate a License Code (Admin)

```bash
curl -X POST https://kindpos-licensing.your-account.workers.dev/api/admin/generate \
  -H "Authorization: Bearer your-super-secret-admin-key-here-32-chars-minimum" \
  -H "Content-Type: application/json" \
  -d '{"prefix": "SMYS", "node_number": "001", "sku": "KINDPOS-PI-5", "store_ref": "store-123"}'
```

Response:

```json
{
  "code": "SMYS-001-a7f2-8b3c-1e90",
  "prefix": "SMYS",
  "node_number": "001",
  "sku": "KINDPOS-PI-5"
}
```

### Activate a License

```bash
curl -X POST https://kindpos-licensing.your-account.workers.dev/api/activate \
  -H "Content-Type: application/json" \
  -d '{"license_key": "SMYS-001-a7f2-8b3c-1e90", "hardware_fingerprint": "abc123def456", "store_name": "Smile Yeshiva Springs", "terminal_name": "Register-1"}'
```

Response:

```json
{
  "success": true,
  "store_name": "Smile Yeshiva Springs",
  "terminal_name": "Register-1",
  "node_number": "001",
  "prefix": "SMYS",
  "activated_at": "2024-01-15T10:30:45.123Z"
}
```

### List All Nodes (Admin)

```bash
curl -X GET https://kindpos-licensing.your-account.workers.dev/api/admin/nodes \
  -H "Authorization: Bearer your-super-secret-admin-key-here-32-chars-minimum"
```

Response (grouped by store prefix):

```json
{
  "SMYS": [
    {
      "id": "node_abc123def456",
      "prefix": "SMYS",
      "node_number": "001",
      "store_name": "Smile Yeshiva Springs",
      "terminal_name": "Register-1",
      "activated_at": "2024-01-15T10:30:45.123Z",
      "last_seen": "2024-01-15T11:45:22.456Z",
      "sku": "KINDPOS-PI-5"
    }
  ]
}
```

## Troubleshooting

### "Database not found"

Verify the database ID in `wrangler.toml` matches the output from `wrangler d1 create`.

### "ADMIN_SECRET is undefined"

Re-run `wrangler secret put ADMIN_SECRET` and re-deploy with `npm run deploy`.

### Schema not initialized

Run `npm run db:init:remote` again:

```bash
wrangler d1 execute kindpos-licenses --remote --file=pi/cloudflare/schema.sql
```

### Local development

To test locally before deploying:

```bash
npm run dev
```

This starts a local worker on `localhost:8787`. You still need D1 binding configured,
but changes are reflected immediately without redeploying.

## Continuous Deployment

To redeploy after code changes:

```bash
git push origin main  # (or your default branch)
npm run deploy
```

Or set up a GitHub Actions workflow to auto-deploy on push (see Cloudflare docs).
