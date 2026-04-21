# Entomology — Implementation Log

Running record of configuration changes and files touched while building the PIN-gated Entomology GUI + Excel bug report. Branch: `claude/add-diagnostics-monitoring-jx4Th`.

Plan file: `/root/.claude/plans/entomology-terminal-integration-delightful-lollipop.md`.

---

## 1. Configuration

One row per config-surface change, newest at the bottom.

| When | File | Key / Setting | Old → New | Why |
|------|------|---------------|-----------|-----|
| 2026-04-21 | `entomology/IMPLEMENTATION_LOG.md` | (file) | — → created | Running log seed per user directive. |
| 2026-04-21 | `backend/requirements.txt` | `openpyxl` | (absent) → `openpyxl==3.1.2` | Excel workbook generation for the bug-report download. Pure-Python, minimal deps. |
| 2026-04-21 | `backend/app/services/entomology_report.py` | (file) | — → created | Pure workbook builder: Summary + Current Snapshot + 5 per-category sheets, grouped by event_code, severity-colored rows. Smoke-tested: 7 sheets produced; event counts correct. |
| 2026-04-21 | `backend/app/api/routes/entomology.py` | (file) | — → created | Three PIN-gated endpoints under `/api/v1/entomology`: `snapshot`, `issues?days=N`, `report.xlsx?days=N`. All `Depends(get_current_session)`. |
| 2026-04-21 | `backend/app/main.py` | lifespan + routers + static | — | Initialize `DiagnosticCollector` at `settings.database_path.replace('event_ledger.db','diagnostic_boot.db')` in lifespan (tears down on shutdown). Register `entomology.router` under `/api/v1`. Add `/entomology` redirect + `/entomology/` static mount (before the root catch-all). |
| 2026-04-21 | `backend/app/api/routes/entomology.py` | collector access | direct `get_diagnostic_collector()` call → `Depends(require_collector)` | Proper FastAPI DI so `app.dependency_overrides` works in tests. Endpoints gain a second `Depends(...)` param. |
| 2026-04-21 | `entomology/index.html` | `<link rel="icon">` | (none) → inline SVG data URI | Browser was auto-requesting `/entomology/favicon.ico` and logging a 404 in the console. Inline data URI eliminates the extra request. |
| 2026-04-21 | `backend/app/services/diagnostic_collector.py` | schema | `diagnostic_events` only → also creates `boot_results` + `boot_summary` | User's live dashboard reported `schema_version CRITICAL FAIL — Schema mismatch for: diagnostic_boot`. Kindnostic expects both tables in `diagnostic_boot.db`; when the backend boots first, the file existed with only the runtime `diagnostic_events` table. Collector now creates all three tables so the shared schema matches kindnostic's expectations regardless of boot order. |

---

## 2. Tree of Inserts

Status key: `[NEW]` = created by this feature, `[MOD]` = pre-existing file modified, `[ ]` = not yet touched.

```
entomology/                               [NEW dir]
├── IMPLEMENTATION_LOG.md                 [NEW — seed]
├── index.html                            [NEW]— Step 4
├── styles/
│   └── main.css                          [NEW]— Step 4
└── src/
    └── app.js                            [NEW]— Step 4

backend/
├── requirements.txt                      [MOD]— Step 1: +openpyxl==3.1.2
├── app/
│   ├── main.py                           [MOD]— Step 3,4: router + lifespan + static mount
│   ├── api/routes/entomology.py          [NEW]— Step 3
│   └── services/entomology_report.py     [NEW]— Step 2
└── tests/
    ├── test_entomology_routes.py         [NEW]— Step 5 (endpoints)
    └── test_entomology_excel_report.py   [NEW]— Step 5 (workbook unit). NB: renamed from test_entomology_report.py to avoid collision with the pre-existing HTML-report test.
```

---

## 3. Per-Step Landing Notes

### Step 0 — Seed (2026-04-21)
Created `entomology/` directory with `styles/` and `src/` subfolders and this log. No code yet.

### Step 1 — openpyxl (2026-04-21)
Added `openpyxl==3.1.2` under Utilities in `backend/requirements.txt`. Installed in the working env (`openpyxl 3.1.2`, `et-xmlfile 2.0.0`).

### Step 2 — Excel generator (2026-04-21)
Added `backend/app/services/entomology_report.py` with `build_bug_report_workbook(events, snapshot, date_range)` and `workbook_to_bytes(wb)`. Workbook: `Summary`, `Current Snapshot`, plus one sheet per `DiagnosticCategory` (`DEVICE Issues`, `NETWORK Issues`, `SYSTEM Issues`, `PERIPHERAL Issues`, `RECOVERY Issues`). Rows in each category sheet are grouped by `event_code` with a gold divider row between groups; severity-colored background on the severity column. Smoke-tested from shell: 7 sheets generated, row counts match synthetic events.

### Step 3 — Router + lifespan + mount (2026-04-21)
Added `backend/app/api/routes/entomology.py` with `/snapshot`, `/issues`, `/report.xlsx`, all gated by `get_current_session`. Registered the router under `/api/v1` in `main.py`. Wired a `DiagnosticCollector` singleton into the FastAPI lifespan (connects to `diagnostic_boot.db`, writes shutdown closes cleanly). Added the `/entomology` redirect and `/entomology/` static mount immediately before the root catch-all mount, matching the existing `/overseer` pattern. Verified via `python -c 'from app.main import app'` — lifespan imports clean, entomology routes enumerated.

### Step 4 — Static GUI (2026-04-21)
Added `entomology/index.html` (PIN screen + dashboard), `entomology/styles/main.css` (dark KIND palette), `entomology/src/app.js` (vanilla ES-module SPA). Flow: PIN pad → `POST /api/v1/auth/verify-pin` → token in `sessionStorage` → dashboard with three panels (Current Snapshot auto-refreshing every 15s, Recent Issues grouped by category with collapsible code-groups, bottom bar with Excel download + logout). All API calls send `Authorization: Bearer <token>`; 401 bounces to PIN screen. No build step — plain `<script type="module">`.

### Step 5 — Tests (2026-04-21)
Added `backend/tests/test_entomology_excel_report.py` (5 unit tests on `build_bug_report_workbook`: sheet set, empty-category placeholders, DEVICE-sheet grouping by event_code, Summary counts matrix, Snapshot-sheet layout) and `backend/tests/test_entomology_routes.py` (7 integration tests covering 401 unauth, snapshot shape, severity+window filtering, valid xlsx bytes round-trip, invalid `days` 422). Added `require_collector` FastAPI dep in the router so `app.dependency_overrides[deps.get_diagnostic_collector]` takes effect in tests. Full backend suite: **1004 passed, 3 skipped, 0 failed**.

### Step 6 — Live smoke (2026-04-21)
Booted `uvicorn app.main:app --port 8765`. `/health` → 200 JSON. `/entomology/` → 200 (serves index.html from the new static mount). `/api/v1/entomology/{snapshot,issues,report.xlsx}` all → 401 without bearer token — auth gate confirmed.

### Step 7 — Favicon 404 fix (2026-04-21)
User reported 404 in browser console on page load. Re-tested with uvicorn: `/entomology` now 307-redirects cleanly to `/entomology/` (earlier 404 was environmental), assets all 200. The remaining 404 was the browser auto-fetching `/entomology/favicon.ico`, which my `index.html` had not declared. Added an inline SVG data URI `<link rel="icon">` — eliminates the extra HTTP request entirely, no new asset file needed.

### Step 8 — Shared-schema fix (2026-04-21)
Live dashboard surfaced `schema_version CRITICAL FAIL — Schema mismatch for: diagnostic_boot`. Root cause: kindnostic's schema probe expects `{boot_results, boot_summary}` in `diagnostic_boot.db`, but when the backend's `DiagnosticCollector` opens that DB first it only creates `diagnostic_events`. Fixed by adding the two kindnostic tables to `DiagnosticCollector.connect()` so the shared schema is complete regardless of which component boots first. Full backend suite still green: **1004 passed, 3 skipped**.
