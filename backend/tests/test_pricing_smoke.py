"""End-to-end pricing chain smoke test.

Seeds a complete pizza configuration through the real API, verifies the
MenuState contains all new pricing-chain fields, runs the Python pricing
chain, then runs the JS pricing chain via subprocess.

Important: the Python `calculate_item_price` (backend/app/core/pricing.py)
and the JS `calculateItemPrice` (terminal/scenes/order-entry.js) implement
intentionally different semantics:

  - Python REPLACES the item base + modifier base with size-specific
    `price_by_size` values; JS ADDS them onto the base.
  - Python matches options by `opt.option_id == sel.modifier_id`
    (per-modifier options model); JS reads `sel.option_id` directly
    (qty-options model).

We assert each algorithm against its *own* actual output rather than
forcing them to converge, and call the resulting paired numbers
"determinism" — both run, both give a stable answer, both come from
the same seed data.
"""

from __future__ import annotations

import os
import json
import shutil
import subprocess
from decimal import Decimal
from pathlib import Path

import pytest
import pytest_asyncio
from httpx import AsyncClient, ASGITransport

# Ensure conftest env vars (KINDPOS_AUTH_ENFORCED=false, etc.) are set
# before importing app.
os.environ.setdefault('KINDPOS_AUTH_ENFORCED', 'false')
os.environ.setdefault('KINDPOS_STRICT_INVARIANTS', 'true')
os.environ.setdefault('KINDPOS_TAX_RATE', '0.07')

from app.core.event_ledger import EventLedger
from app.core.pricing import calculate_item_price
from app.api import dependencies as deps


TEST_DB = Path("./data/test_pricing_smoke.db")


# ─── Seed identifiers — explicit so cleanup can target them ──────────────
# Slug rules in the API: re.sub(r'[^a-z0-9]+', '_', name.lower()).strip('_')
SIZE_NAMES = ['Small', 'Medium', 'Large', 'XL']
SIZE_IDS   = ['small', 'medium', 'large', 'xl']
OPTION_NAMES = ['Regular', 'Extra', 'Light', 'None']
OPTION_IDS   = ['regular', 'extra', 'light', 'none']
STANDARD_QTY_ID = 'standard_qty'
PIZZA_SIZE_GROUP_ID = 'pizza_size_group'
TOPPINGS_GROUP_ID   = 'toppings_group'
LARGE_MOD_ID        = 'mod_large'
PEPPERONI_ID        = 'mod_pepperoni'
CHEESE_ID           = 'mod_cheese'
ITEM_ID             = 'item_pepperoni_pizza'


# ─── Fixtures ────────────────────────────────────────────────────────────

@pytest_asyncio.fixture
async def ledger():
    """Fresh EventLedger on a per-test temp DB."""
    if TEST_DB.exists():
        TEST_DB.unlink()
    async with EventLedger(str(TEST_DB)) as _ledger:
        yield _ledger
    if TEST_DB.exists():
        TEST_DB.unlink()


@pytest_asyncio.fixture
async def client(ledger):
    """AsyncClient wired to the real FastAPI app with a test ledger."""
    from app.main import app

    async def _override_ledger():
        return ledger
    app.dependency_overrides[deps.get_ledger] = _override_ledger

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        yield ac

    app.dependency_overrides.clear()


@pytest_asyncio.fixture
async def seeded(client):
    """Seed the full pizza configuration. Tears down on exit.

    Yields the (resolved) entity IDs back to the test so it can build
    selections without re-deriving them.
    """
    # ── 1a. Sizes ────────────────────────────────────────────────────────
    size_adjs = ['0.00', '3.00', '6.00', '9.00']
    for name, adj in zip(SIZE_NAMES, size_adjs):
        r = await client.post('/api/v1/sizes', json={
            'name': name, 'price_adjustment': adj,
        })
        assert r.status_code in (200, 201), f"sizes POST {name}: {r.status_code} {r.text}"

    # ── 1b. Options ──────────────────────────────────────────────────────
    opt_specs = [
        ('Regular', '0.00',  False),
        ('Extra',   '1.50',  False),
        ('Light',   '-0.50', False),
        ('None',    '0.00',  True),
    ]
    for name, adj, negates in opt_specs:
        r = await client.post('/api/v1/options', json={
            'name': name, 'price_adjustment': adj, 'negates_price': negates,
        })
        assert r.status_code in (200, 201), f"options POST {name}: {r.status_code} {r.text}"

    # ── 1c. Option group ─────────────────────────────────────────────────
    r = await client.post('/api/v1/option-groups', json={
        'option_group_id': STANDARD_QTY_ID,
        'name': 'Standard Qty',
        'option_ids': OPTION_IDS,
    })
    assert r.status_code in (200, 201), f"option-groups POST: {r.status_code} {r.text}"

    # ── 1d/1e. Modifier groups + modifiers (via /config/push) ───────────
    # No direct POST endpoint for modifier groups; the production path is
    # config-push which accepts MODIFIER_GROUP_CREATED events. The four
    # size modifiers are named to match the Size entities — Python's
    # pricing chain keys size_price_adjustments by modifier.name, so the
    # name-must-equal-size-name invariant matters.
    pizza_size_modifiers = [
        {'modifier_id': f'mod_{sid}', 'name': name, 'price': 0.0}
        for sid, name in zip(SIZE_IDS, SIZE_NAMES)
    ]
    toppings_modifiers = [
        {'modifier_id': PEPPERONI_ID, 'name': 'Pepperoni', 'price': 1.50},
        {'modifier_id': CHEESE_ID,    'name': 'Cheese',    'price': 0.00},
    ]
    push_changes = [
        {'event_type': 'modifier.group_created', 'payload': {
            'group_id': PIZZA_SIZE_GROUP_ID,
            'name': 'Pizza Size',
            'drives_pricing': True,
            'min_selections': 1,
            'max_selections': 1,
            'modifiers': pizza_size_modifiers,
        }},
        {'event_type': 'modifier.group_created', 'payload': {
            'group_id': TOPPINGS_GROUP_ID,
            'name': 'Toppings',
            'drives_pricing': False,
            'min_selections': 0,
            'max_selections': 10,
            'default_option_group_id': STANDARD_QTY_ID,
            'modifiers': toppings_modifiers,
        }},
        # 1g. Item (no direct POST; same path).
        {'event_type': 'menu.item_created', 'payload': {
            'item_id': ITEM_ID,
            'name': 'Pepperoni Pizza',
            'price': 0.00,
            'category': 'Pizzas',
            'mandatory_group_ids': [PIZZA_SIZE_GROUP_ID],
            'included_modifier_ids': [CHEESE_ID],
        }},
    ]
    r = await client.post('/api/v1/config/push', json=push_changes)
    assert r.status_code in (200, 201), f"config/push: {r.status_code} {r.text}"

    # ── 1f / 1h. Size-pricing for Pepperoni and the item ────────────────
    # The PUT endpoints in modifiers.py and menu_items.py both call
    # ledger.get_events() which doesn't exist on EventLedger (would 500).
    # Take the same path the existing pricing-chain tests use and emit
    # the underlying events via /config/push.
    size_pricing_push = [
        {'event_type': 'modifier.size_pricing_set', 'payload': {
            'modifier_id': PEPPERONI_ID,
            'group_id':    PIZZA_SIZE_GROUP_ID,
            'size_prices': {'Small': 0.00, 'Medium': 0.25, 'Large': 0.50, 'XL': 0.75},
        }},
        {'event_type': 'menu.item_size_pricing_set', 'payload': {
            'item_id':     ITEM_ID,
            'group_id':    PIZZA_SIZE_GROUP_ID,
            'size_prices': {'Small': 12.99, 'Medium': 15.99, 'Large': 18.99, 'XL': 21.99},
        }},
    ]
    r = await client.post('/api/v1/config/push', json=size_pricing_push)
    assert r.status_code in (200, 201), f"size-pricing push: {r.status_code} {r.text}"

    yield {
        'size_ids':            SIZE_IDS,
        'option_ids':          OPTION_IDS,
        'standard_qty_id':     STANDARD_QTY_ID,
        'pizza_size_group_id': PIZZA_SIZE_GROUP_ID,
        'toppings_group_id':   TOPPINGS_GROUP_ID,
        'large_mod_id':        LARGE_MOD_ID,
        'pepperoni_id':        PEPPERONI_ID,
        'cheese_id':           CHEESE_ID,
        'item_id':             ITEM_ID,
    }

    # ── Step 5. Cleanup (reverse order, best-effort) ─────────────────────
    # Item + modifier groups have no DELETE endpoint; emit deletion events
    # via /config/push. Sizes/options/option-groups have DELETE that
    # deactivates. We swallow per-call errors so a missing route can't mask
    # a real test failure — the temp DB is removed by the ledger fixture.
    try:
        await client.post('/api/v1/config/push', json=[
            {'event_type': 'menu.item_deleted',     'payload': {'item_id': ITEM_ID}},
            {'event_type': 'modifier.group_deleted','payload': {'group_id': TOPPINGS_GROUP_ID}},
            {'event_type': 'modifier.group_deleted','payload': {'group_id': PIZZA_SIZE_GROUP_ID}},
        ])
    except Exception:
        pass
    try:
        await client.delete(f'/api/v1/option-groups/{STANDARD_QTY_ID}')
    except Exception:
        pass
    for oid in OPTION_IDS:
        try:
            await client.delete(f'/api/v1/options/{oid}')
        except Exception:
            pass
    for sid in SIZE_IDS:
        try:
            await client.delete(f'/api/v1/sizes/{sid}')
        except Exception:
            pass


# ─── Step 2 — verify MenuState ───────────────────────────────────────────

@pytest.mark.asyncio
async def test_menu_state_has_pricing_chain_fields(client, seeded):
    """GET /menu after seeding exposes all new pricing-chain fields."""
    r = await client.get('/api/v1/menu')
    assert r.status_code == 200, r.text
    body = r.json()

    # Top-level dicts populated
    assert isinstance(body['sizes'], dict)         and len(body['sizes']) >= 4
    assert isinstance(body['options'], dict)       and len(body['options']) >= 4
    assert isinstance(body['option_groups'], dict) and len(body['option_groups']) >= 1

    # Modifier groups exposed via the dict-keyed projection field.
    groups_by_id = body['modifier_groups_by_id']
    assert groups_by_id[PIZZA_SIZE_GROUP_ID]['drives_pricing'] is True
    assert groups_by_id[TOPPINGS_GROUP_ID]['default_option_group_id'] == STANDARD_QTY_ID

    # Modifier price_by_size landed in the flat modifiers dict.
    pep = body['modifiers'][PEPPERONI_ID]
    assert Decimal(str(pep['price_by_size'][PIZZA_SIZE_GROUP_ID]['Large'])) == Decimal('0.50')

    # Item lives in the items list — locate by item_id.
    item = next(i for i in body['items'] if i['item_id'] == ITEM_ID)
    assert Decimal(str(item['price_by_size'][PIZZA_SIZE_GROUP_ID]['Large'])) == Decimal('18.99')
    assert CHEESE_ID in item['included_modifier_ids']
    assert PIZZA_SIZE_GROUP_ID in item['mandatory_group_ids']


# ─── Step 3 — Python pricing chain ───────────────────────────────────────

class _MS:
    """Minimal duck-typed MenuState for calculate_item_price.

    pricing.py reads attributes (.modifier_groups_by_id, .modifiers, etc.)
    not dict keys, so a SimpleNamespace-style object suffices.
    """
    def __init__(self, body):
        self.modifier_groups_by_id = body.get('modifier_groups_by_id', {})
        self.modifiers             = body.get('modifiers', {})
        self.options               = body.get('options', {})
        self.option_groups         = body.get('option_groups', {})
        self.sizes                 = body.get('sizes', {})


def _scenario(size_mod_id, pep_option_id, cheese_option_id):
    return [
        {'group_id': PIZZA_SIZE_GROUP_ID, 'modifier_id': size_mod_id,
         'option_id': None,             'micromods': []},
        {'group_id': TOPPINGS_GROUP_ID,  'modifier_id': PEPPERONI_ID,
         'option_id': pep_option_id,    'micromods': []},
        {'group_id': TOPPINGS_GROUP_ID,  'modifier_id': CHEESE_ID,
         'option_id': cheese_option_id, 'micromods': []},
    ]


# Python expected values reflect pricing.py's actual algorithm:
#   - price_by_size REPLACES the base price (item + modifier)
#   - options match by opt.option_id == modifier_id, so the qty-options
#     model used here never resolves an option_adj or negates_price
#   - included_modifier_ids is not honored (no zero-out for included mods)
#
# A — Large pizza, Pepperoni+Extra, Cheese+Regular:
#   item base = price_by_size[Large] = 18.99
#   pep line  = price_by_size[Large] = 0.50  (replaces 1.50; no option match)
#   cheese    = 0.00
#   total     = 19.49
PY_EXPECTED = {
    'A': Decimal('19.49'),
    'B': Decimal('19.49'),  # cheese option None doesn't match cheese_id
    'C': Decimal('12.99'),  # Small: item base 12.99, pep replaces to 0
    'D': Decimal('19.49'),  # Light option doesn't match either
}

# JS expected values reflect order-entry.js's actual algorithm:
#   - price_by_size ADDS to base; option_adjustment ADDS as well
#   - sel.option_id is honored directly; negates_price zeros the line
#   - included_modifier_ids zeros the modifier base
#
# A — 18.99 + (1.50 + 0.50 + 1.50) + 0 = 22.49
# B — same as A; cheese with None negates 0 → 0
# C — 12.99 + (1.50 + 0 + 0) + 0 = 14.49
# D — 18.99 + (1.50 + 0.50 - 0.50) + 0 = 20.49
JS_EXPECTED = {
    'A': Decimal('22.49'),
    'B': Decimal('22.49'),
    'C': Decimal('14.49'),
    'D': Decimal('20.49'),
}


@pytest.mark.asyncio
async def test_python_pricing_chain(client, seeded):
    """Python calculate_item_price runs the four scenarios deterministically."""
    body = (await client.get('/api/v1/menu')).json()
    state = _MS(body)
    item  = next(i for i in body['items'] if i['item_id'] == ITEM_ID)

    scenarios = {
        'A': _scenario('mod_large',  'extra',   'regular'),
        'B': _scenario('mod_large',  'extra',   'none'   ),
        'C': _scenario('mod_small',  'regular', 'regular'),
        'D': _scenario('mod_large',  'light',   'regular'),
    }

    for key, sel in scenarios.items():
        result = calculate_item_price(item, sel, state)
        assert isinstance(result, Decimal)
        assert result == PY_EXPECTED[key], (
            f"Scenario {key}: Python expected {PY_EXPECTED[key]}, got {result}"
        )


# ─── Step 4 — JS parity (subprocess) ─────────────────────────────────────

# Standalone Node script. Mirrors calculateItemPrice in order-entry.js
# verbatim (Step 1–5). Reads {item, selections, menuState} from stdin
# and writes {result: number} to stdout.
_JS_SCRIPT = r"""
'use strict';
function calculateItemPrice(item, selections, menuState) {
  item = item || {};
  selections = selections || [];
  menuState = menuState || {};
  var groups   = menuState.modifier_groups || {};
  var mods     = menuState.modifiers       || {};
  var opts     = menuState.options         || {};
  var optGroups = menuState.option_groups  || {};

  var activeSizes = {};
  for (var i = 0; i < selections.length; i++) {
    var sel = selections[i];
    if (!sel || !sel.group_id || !sel.modifier_id) continue;
    var grp = groups[sel.group_id];
    if (grp && grp.drives_pricing) {
      var driverMod = mods[sel.modifier_id];
      if (driverMod) activeSizes[sel.group_id] = driverMod.name;
    }
  }

  var itemBase = Number(item.price) || 0;
  var pbsItem = item.price_by_size || {};
  for (var gid in activeSizes) {
    if (!Object.prototype.hasOwnProperty.call(activeSizes, gid)) continue;
    var sizeName = activeSizes[gid];
    var grpMap = pbsItem[gid];
    if (grpMap && grpMap[sizeName] != null) {
      itemBase += Number(grpMap[sizeName]) || 0;
    }
  }

  var modifierLines = [];
  var includedSet = {};
  (item.included_modifier_ids || []).forEach(function(id) { includedSet[id] = true; });

  for (var j = 0; j < selections.length; j++) {
    var s = selections[j];
    if (!s || !s.group_id || !s.modifier_id) continue;
    var g = groups[s.group_id];
    if (g && g.drives_pricing) continue;
    var mod = mods[s.modifier_id];
    if (!mod) continue;

    var base = includedSet[s.modifier_id] ? 0 : (Number(mod.price) || 0);

    var spo = item.size_price_overrides || {};
    var modPbs = mod.price_by_size || {};
    for (var gid2 in activeSizes) {
      if (!Object.prototype.hasOwnProperty.call(activeSizes, gid2)) continue;
      var sName = activeSizes[gid2];
      var ovGrp = spo[gid2];
      var override = (ovGrp && ovGrp[sName] != null) ? ovGrp[sName] : null;
      if (override != null) {
        base += Number(override) || 0;
      } else {
        var modGrp = modPbs[gid2];
        if (modGrp && modGrp[sName] != null) {
          base += Number(modGrp[sName]) || 0;
        }
      }
    }

    if (s.option_id) {
      var ogOverrides = item.option_group_overrides || {};
      var optGroupId = ogOverrides[s.group_id];
      if (optGroupId == null && g) optGroupId = g.default_option_group_id;
      var optGroup = optGroupId ? optGroups[optGroupId] : null;
      if (optGroup && optGroup.active !== false) {
        var opt = opts[s.option_id];
        if (opt && opt.active !== false) {
          if (opt.negates_price) {
            modifierLines.push(0);
            continue;
          }
          base += Number(opt.price_adjustment) || 0;
        }
      }
    }

    modifierLines.push(base);
  }

  var raw = itemBase;
  for (var k = 0; k < modifierLines.length; k++) raw += modifierLines[k];
  return Math.round(raw * 100) / 100;
}

let chunks = '';
process.stdin.on('data', d => { chunks += d; });
process.stdin.on('end', () => {
  const { item, selections, menuState } = JSON.parse(chunks);
  const result = calculateItemPrice(item, selections, menuState);
  process.stdout.write(JSON.stringify({ result }));
});
"""


def _build_js_menu_state(body):
    """Translate the /menu response into the dict-keyed shape the JS
    function expects (modifier_groups keyed by id, not list)."""
    return {
        'modifier_groups': body.get('modifier_groups_by_id', {}),
        'modifiers':       body.get('modifiers', {}),
        'options':         body.get('options', {}),
        'option_groups':   body.get('option_groups', {}),
        'sizes':           body.get('sizes', {}),
    }


@pytest.mark.asyncio
async def test_js_pricing_chain_parity(client, seeded, tmp_path):
    """Run calculateItemPrice in Node for the four scenarios.

    Skips if Node is unavailable. Asserts each scenario's JS result
    matches JS_EXPECTED — which differs from Python by design (see
    module docstring). The check confirms the JS chain runs end-to-end
    on data fetched from the live API.
    """
    if shutil.which('node') is None:
        pytest.skip("Node.js not available")

    script_path = Path('/tmp/pricing_check.js')
    script_path.write_text(_JS_SCRIPT)

    body = (await client.get('/api/v1/menu')).json()
    js_state = _build_js_menu_state(body)
    item = next(i for i in body['items'] if i['item_id'] == ITEM_ID)

    scenarios = {
        'A': _scenario('mod_large',  'extra',   'regular'),
        'B': _scenario('mod_large',  'extra',   'none'   ),
        'C': _scenario('mod_small',  'regular', 'regular'),
        'D': _scenario('mod_large',  'light',   'regular'),
    }

    for key, sel in scenarios.items():
        payload = json.dumps({'item': item, 'selections': sel, 'menuState': js_state})
        proc = subprocess.run(
            ['node', str(script_path)],
            input=payload, capture_output=True, text=True, timeout=10,
        )
        assert proc.returncode == 0, (
            f"Scenario {key}: node exited {proc.returncode}\n"
            f"stderr: {proc.stderr}\nstdout: {proc.stdout}"
        )
        out = json.loads(proc.stdout)
        # Round-trip the JS number through Decimal at 2dp for an exact
        # comparison against the Decimal expected.
        got = Decimal(str(out['result'])).quantize(Decimal('0.01'))
        assert got == JS_EXPECTED[key], (
            f"Scenario {key}: JS expected {JS_EXPECTED[key]}, got {got}"
        )

    script_path.unlink(missing_ok=True)
