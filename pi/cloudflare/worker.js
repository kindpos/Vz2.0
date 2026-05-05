/**
 * KINDpos License Activation Worker
 * Deployed to Cloudflare edge for global license management.
 */

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method;

    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      'Content-Type': 'application/json',
    };

    // Handle CORS preflight
    if (method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders, status: 204 });
    }

    try {
      if (path === '/api/activate' && method === 'POST') {
        return await handleActivate(request, env, corsHeaders);
      } else if (path === '/api/admin/generate' && method === 'POST') {
        return await handleGenerate(request, env, corsHeaders);
      } else if (path === '/api/admin/nodes' && method === 'GET') {
        return await handleNodes(request, env, corsHeaders);
      } else {
        return new Response(
          JSON.stringify({ error: 'Not Found' }),
          { status: 404, headers: corsHeaders }
        );
      }
    } catch (error) {
      console.error('Worker error:', error);
      return new Response(
        JSON.stringify({ error: error.message || 'Internal Server Error' }),
        { status: 500, headers: corsHeaders }
      );
    }
  }
};

/**
 * POST /api/activate
 * Activates a license and registers the node.
 */
async function handleActivate(request, env, corsHeaders) {
  const body = await request.json();
  const { license_key, hardware_fingerprint, store_name, terminal_name } = body;

  if (!license_key || !hardware_fingerprint) {
    return new Response(
      JSON.stringify({ error: 'Missing license_key or hardware_fingerprint' }),
      { status: 400, headers: corsHeaders }
    );
  }

  const db = env.KINDPOS_DB;

  // Look up license in D1
  const licenseStmt = db.prepare('SELECT * FROM licenses WHERE id = ?');
  const license = await licenseStmt.bind(license_key).first();

  if (!license) {
    return new Response(
      JSON.stringify({ error: 'License not found' }),
      { status: 404, headers: corsHeaders }
    );
  }

  // Check if already activated with different hardware
  if (license.activated && license.hardware_fingerprint && license.hardware_fingerprint !== hardware_fingerprint) {
    return new Response(
      JSON.stringify({ error: 'License already activated with different device' }),
      { status: 409, headers: corsHeaders }
    );
  }

  const activatedAt = new Date().toISOString();
  const nodeId = hashHardwareFingerprint(hardware_fingerprint);

  // Insert or replace in nodes table
  const nodeStmt = db.prepare(`
    INSERT OR REPLACE INTO nodes (id, license_id, prefix, node_number, store_name, terminal_name, activated_at, last_seen)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);
  await nodeStmt.bind(
    nodeId,
    license_key,
    license.prefix,
    license.node_number,
    store_name || license.store_name,
    terminal_name || license.terminal_name,
    activatedAt,
    activatedAt
  ).run();

  // Mark license as activated
  const updateStmt = db.prepare(`
    UPDATE licenses
    SET activated = 1, activated_at = ?, hardware_fingerprint = ?, store_name = ?, terminal_name = ?, last_seen = ?
    WHERE id = ?
  `);
  await updateStmt.bind(
    activatedAt,
    hardware_fingerprint,
    store_name || license.store_name,
    terminal_name || license.terminal_name,
    activatedAt,
    license_key
  ).run();

  return new Response(
    JSON.stringify({
      success: true,
      store_name: store_name || license.store_name,
      terminal_name: terminal_name || license.terminal_name,
      node_number: license.node_number,
      prefix: license.prefix,
      activated_at: activatedAt
    }),
    { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
  );
}

/**
 * POST /api/admin/generate
 * Generates a new license code. Requires Bearer ADMIN_SECRET.
 */
async function handleGenerate(request, env, corsHeaders) {
  // Validate admin secret
  const authHeader = request.headers.get('Authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return new Response(
      JSON.stringify({ error: 'Unauthorized' }),
      { status: 401, headers: corsHeaders }
    );
  }

  const token = authHeader.slice(7);
  if (token !== env.ADMIN_SECRET) {
    return new Response(
      JSON.stringify({ error: 'Unauthorized' }),
      { status: 401, headers: corsHeaders }
    );
  }

  const body = await request.json();
  const { prefix, node_number, sku, store_ref } = body;

  if (!prefix || !node_number || !sku) {
    return new Response(
      JSON.stringify({ error: 'Missing required fields: prefix, node_number, sku' }),
      { status: 400, headers: corsHeaders }
    );
  }

  // Generate license code: PREFIX-NNN-XXXX-XXXX-XXXX
  const code = generateLicenseCode(prefix, node_number);
  const createdAt = new Date().toISOString();

  const db = env.KINDPOS_DB;
  const insertStmt = db.prepare(`
    INSERT INTO licenses (id, prefix, node_number, sku, store_ref, activated, created_at)
    VALUES (?, ?, ?, ?, ?, 0, ?)
  `);
  await insertStmt.bind(
    code,
    prefix.toUpperCase(),
    node_number,
    sku,
    store_ref || null,
    createdAt
  ).run();

  return new Response(
    JSON.stringify({
      code,
      prefix: prefix.toUpperCase(),
      node_number,
      sku
    }),
    { status: 201, headers: corsHeaders }
  );
}

/**
 * GET /api/admin/nodes
 * Lists all active nodes grouped by store prefix. Requires Bearer ADMIN_SECRET.
 */
async function handleNodes(request, env, corsHeaders) {
  // Validate admin secret
  const authHeader = request.headers.get('Authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return new Response(
      JSON.stringify({ error: 'Unauthorized' }),
      { status: 401, headers: corsHeaders }
    );
  }

  const token = authHeader.slice(7);
  if (token !== env.ADMIN_SECRET) {
    return new Response(
      JSON.stringify({ error: 'Unauthorized' }),
      { status: 401, headers: corsHeaders }
    );
  }

  const db = env.KINDPOS_DB;
  const stmt = db.prepare(`
    SELECT
      n.id, n.prefix, n.node_number, n.store_name, n.terminal_name,
      n.activated_at, n.last_seen, l.sku
    FROM nodes n
    LEFT JOIN licenses l ON n.license_id = l.id
    ORDER BY n.prefix, n.node_number
  `);
  const rows = await stmt.all();

  // Group by prefix (store)
  const grouped = {};
  for (const row of rows.results || []) {
    if (!grouped[row.prefix]) {
      grouped[row.prefix] = [];
    }
    grouped[row.prefix].push(row);
  }

  return new Response(
    JSON.stringify(grouped),
    { status: 200, headers: corsHeaders }
  );
}

/**
 * Generates a license code in the format: PREFIX-NNN-XXXX-XXXX-XXXX
 */
function generateLicenseCode(prefix, nodeNumber) {
  const prefixUpper = prefix.toUpperCase().slice(0, 4);
  const nodeNum = String(nodeNumber).padStart(3, '0');

  const seg1 = generateRandomHex(4);
  const seg2 = generateRandomHex(4);
  const seg3 = generateRandomHex(4);

  return `${prefixUpper}-${nodeNum}-${seg1}-${seg2}-${seg3}`;
}

/**
 * Generates a random hex string of the specified length.
 */
function generateRandomHex(length) {
  const chars = '0123456789ABCDEF';
  let result = '';
  for (let i = 0; i < length; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

/**
 * Deterministic hash of hardware fingerprint for node ID.
 * In production, use crypto.subtle.digest('SHA-256', ...) for true hashing.
 */
function hashHardwareFingerprint(fingerprint) {
  // Simple approach: use first 16 chars + checksum
  return 'node_' + fingerprint.slice(0, 16).toUpperCase();
}
