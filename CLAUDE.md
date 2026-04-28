# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

**Backend tests (from `/backend`):**
```bash
PYTHONPATH=/home/user/Vz2.0/backend python3 -m pytest tests/ -q          # full suite (expect 1348 passed, 3 skipped)
PYTHONPATH=/home/user/Vz2.0/backend python3 -m pytest tests/test_foo.py  # single file
PYTHONPATH=/home/user/Vz2.0/backend python3 -m pytest tests/test_foo.py::test_bar  # single test
```
`asyncio_mode = auto` is set in `pytest.ini` — no `@pytest.mark.asyncio` decorator needed.

**Frontend tests (from repo root):**
```bash
npm test          # vitest run (all JS tests)
npm run test:watch
npm run lint:theme  # enforces no hardcoded hex colors outside tokens.js
```

**Run the server (from repo root):**
```bash
cd backend && uvicorn app.main:app --reload --host 127.0.0.1 --port 8000
```

## Architecture

### Backend — Event Sourcing

All state is derived from an append-only SQLite ledger (`app/core/event_ledger.py`). Routes never write derived state — they emit events, then project current state by replaying the log.

```
Route handler
  → ledger.emit(EventType.X, payload)   # append-only write
  → projection functions                 # replay → current state
  → response
```

**`app/core/events.py`** — ~182 `EventType` enum values and factory functions. Every domain action (order create, item add, payment, staff clock-in, close-day, etc.) has a factory here. Always use the factory rather than constructing raw event dicts.

**`app/core/projections.py`** — Pure functions that replay the ledger to answer "what is the current state?" (open orders, employee summaries, day totals, etc.).

**`app/core/financial_invariants.py`** — Checked at emit time when `KINDPOS_STRICT_INVARIANTS=true` (always true in tests). Any P&L drift, tender mismatch, or 2-decimal-place violation raises immediately. In backend code, **all monetary values must be `Decimal` with exactly 2 dp** — never float arithmetic on money.

**`app/api/dependencies.py`** — Four FastAPI singletons injected via `Depends()`: `get_ledger`, `get_printer_manager`, `get_diagnostic_collector`, `get_print_dispatcher`. Initialized in the `lifespan` hook in `main.py`.

### Backend — Testing Conventions

`tests/conftest.py` provides:
- `ledger` — `EventLedger` on a fresh temp DB, auto-cleaned per test
- `manager` — `PrinterManager` with 4 mock printers (receipt thermal, 2× kitchen impact, bar thermal)
- `collector` — `DiagnosticCollector`

Key env vars set by conftest (do not re-set in individual tests unless overriding):
- `KINDPOS_TAX_RATE=0.07`
- `KINDPOS_STRICT_INVARIANTS=true` — financial drift fails immediately
- `KINDPOS_AUTH_ENFORCED=false` — auth headers not required; SEC-005 diagnostics still fire

Tests call route handlers directly (not via HTTP) — pass `ledger`, `manager`, `collector` as keyword arguments matching the FastAPI `Depends()` names.

### Frontend — Scene Layer Stack

`terminal/scene-manager.js` manages five DOM layers (z-order low → high):

| Layer | z-index | Purpose |
|-------|---------|---------|
| Working | 10 | Primary scene (order-entry, reporting, etc.) |
| Transactional | 20 | Overlaid scenes that return a value (seats, column-editor) |
| Summary | 25 | Persistent left-column order panel |
| Interrupt | 30 | Blocks all input until resolved (confirm dialogs, tip-adjust) |
| Gate | 100 | Full-screen blocks (login) |

Scenes are registered with `defineScene({ name, render, unmount })` or `SceneManager.register(...)`. The `render` function receives `(container, params, state)` and **must** return a cleanup function. Transactional scenes use `SceneManager.openTransactional` / `closeTransactional`; interrupt scenes use `SceneManager.interrupt`.

### Frontend — Key Patterns

**`_alive` guard** — Every async callback (`.then`, `.catch`) that writes to the DOM or mutates scene state must check `if (!state._alive) return;` first. Scene `render()` sets `state._alive = true`; the returned cleanup sets it `false`. Callbacks that only call `showToast()` are exempt.

**`fetchWithTimeout`** — All `fetch()` calls on user-action paths must use `fetchWithTimeout(url, opts, ms)` from `./net.js` (or `../net.js`). Never use bare `fetch()` in a scene.

**`_submitting` guard** — Any button that triggers a POST/PATCH/DELETE must set `state._submitting = true` before the fetch and reset it only on failure (success typically closes the scene).

**Module-level vars** — Variables declared at the top of a scene file (outside `render()`) that hold per-session data (IDs, selections, flags) leak across remounts. Only constants and intentional caches (one-time load flags) belong at module scope.

**Monetary display** — Use `.toFixed(2)` only for display. Never accumulate floats into subtotals; the backend owns all monetary calculations.

### Frontend — Theming

`common/tokens.js` (`T`) is the single source of truth for every color, font, and spacing value. `terminal/theme-manager.js` applies tokens to DOM elements. The `npm run lint:theme` script rejects hardcoded hex values outside `tokens.js`. When adding UI, always pull from `T.*` — never inline hex strings.

### Printing

`app/printing/print_dispatcher.py` — Async queue that routes jobs to the correct printer role (receipt, kitchen, bar). `app/printing/print_queue.py` — SQLite-backed job store. `app/services/print_context_builder.py` — Renders order events into printable context dicts. Tests use `MockThermalPrinter` / `MockImpactPrinter` which record jobs without hardware.

### Diagnostics (Entomology)

`entReport({ code, source, message, ctx, level })` (frontend: `terminal/entomology-client.js`) and `DiagnosticCollector` (backend: `app/services/diagnostic_collector.py`) record structured diagnostic events. Event codes follow the pattern `UI-NNN`, `SYS-NNN`, `FIN-NNN`, `SEC-NNN`. These surface in the Entomology dashboard at `/entomology`.
