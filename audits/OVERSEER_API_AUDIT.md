# Overseer API Audit

**Date:** 2026-05-15  
**Scope:** `overseer/src/` + `overseer/index.html`  
**Backend cross-reference:** `backend/app/api/routes/` (Python / FastAPI)

> **Architecture note:** The question referenced `server/src/main/kotlin/com/kindpos/server/routes/` — that directory does not exist. The backend is Python 3 / FastAPI. All gap analysis is against the FastAPI routes registered in `backend/app/main.py`.

---

## 1. Route Inventory

All `fetch()` / `fetchWithTimeout()` / `EventSource` API calls in non-test Overseer JS source, deduplicated by method + path pattern. Dynamically constructed paths shown as templates.

| # | File | Line(s) | Method | URL Path | Expected Response |
|---|------|---------|--------|----------|-------------------|
| 1 | `src/app.js` | 233 | GET | `/api/v1/menu/items` | Array of menu items (uses `.length`) |
| 2 | `src/app.js` | 234 | GET | `/api/v1/staff` | Array of employees (uses `.length`) |
| 3 | `src/app.js` | 273 | GET | `/api/v1/system/version` | Any 2xx (only pinged, data discarded) |
| 4 | `src/auth/auth_state.js` | 70 | POST | `/v1/auth/password-change` | 204 on success; `{detail}` on 400; 401 on bad credentials |
| 5 | `src/services/auth-client.js` | 68 | POST | `/api/v1/auth/verify-pin` | Auth token / user object |
| 6 | `src/services/config-push.js` | 14 | POST | `/api/v1/config/push` | `{}` / success ack |
| 7 | `src/data/sample-employees.js` | 20 | GET | `/api/v1/config/employees` | `Employee[]` |
| 8 | `src/data/sample-employees.js` | 21 | GET | `/api/v1/config/roles` | `Role[]` |
| 9 | `src/data/sample-payroll.js` | 37 | GET | `/api/v1/reports/labor-summary?date={YYYY-MM-DD}` | Labor summary object |
| 10 | `src/data/sample-reports.js` | 18 | GET | `/api/v1/reports/sales-summary?date={YYYY-MM-DD}` | Sales summary object |
| 11 | `src/data/sample-timedata.js` | 56 | GET | `/api/v1/servers/clocked-in` | Array of clocked-in employee IDs |
| 12 | `src/sections/display-order.js` | 33–34 | GET | `/api/v1/config/menu/categories` | `MenuCategory[]` |
| 13 | `src/sections/display-order.js` | 33–34 | GET | `/api/v1/config/menu/items` | `MenuItem[]` |
| 14 | `src/sections/floor-plan.js` | 25 | GET | `/api/v1/config/floorplan/sections` | `Section[]` |
| 15 | `src/sections/hardware.js` | 113 | GET | `/api/v1/hardware/devices` | Device array |
| 16 | `src/sections/hardware.js` | 117 | GET | `/api/v1/hardware/terminals` | Terminal config array |
| 17 | `src/sections/hardware.js` | 130 | GET | `/api/v1/hardware/routing` | Routing matrix |
| 18 | `src/sections/hardware.js` | 146 | GET | `/api/v1/hardware/license/list` | License array |
| 19 | `src/sections/hardware.js` | 200, 998 | POST | `/api/v1/hardware/test-connection` | `{ok, …}` |
| 20 | `src/sections/hardware.js` | 315, 1288, 1605 | POST | `/api/v1/hardware/devices` | Created device object |
| 21 | `src/sections/hardware.js` | 603–605 | GET (SSE) | `/api/v1/hardware/scan/stream[?ip={ip}]` | Server-Sent Events stream of device discovery events |
| 22 | `src/sections/hardware.js` | 981, 1316 | POST | `/api/v1/hardware/test-print` | `{ok}` |
| 23 | `src/sections/hardware.js` | 1023, 1656 | DELETE | `/api/v1/hardware/devices/{mac}` | 204 |
| 24 | `src/sections/hardware.js` | 1827 | DELETE | `/api/v1/hardware/license/{activation_code}` | 204 |
| 25 | `src/sections/hardware-network.js` | 82 | GET | `/api/v1/hardware/devices/health` | Health status map |
| 26 | `src/sections/hardware-network.js` | 99–101 | GET | `/api/v1/hardware/devices` | Device array |
| 27 | `src/sections/hardware-network.js` | 99–101 | GET | `/api/v1/hardware/terminals` | Terminal config array |
| 28 | `src/sections/hardware-network.js` | 99–101 | GET | `/api/v1/hardware/routing` | Routing matrix |
| 29 | `src/sections/hardware-network.js` | 276 | PUT | `/api/v1/hardware/terminals/{terminal_id}` | Updated terminal |
| 30 | `src/sections/hardware-network.js` | 1011 | GET | `/api/v1/config/menu/categories` | `MenuCategory[]` |
| 31 | `src/sections/hardware-network.js` | 1024 | GET | `/api/v1/hardware/devices/{mac}/routing` | Per-device routing |
| 32 | `src/sections/hardware-network.js` | 1055 | POST | `/api/v1/hardware/devices` | Created device |
| 33 | `src/sections/hardware-network.js` | 1087 | POST | `/api/v1/hardware/devices/{mac}/routing` | Routing result |
| 34 | `src/sections/hardware-network.js` | 1122 | DELETE | `/api/v1/hardware/devices/{mac}` | 204 |
| 35 | `src/sections/hardware-network.js` | 1150 | GET | `/api/v1/config/store` | `StoreConfigBundle` |
| 36 | `src/hardware/shared.js` | 107 | POST | `/api/v1/hardware/test-connection` | `{ok}` |
| 37 | `src/hardware/shared.js` | 170 | GET (SSE) | `/api/v1/hardware/scan/stream[?ip={ip}]` | SSE scan event stream |
| 38 | `src/hardware/shared.js` | 575 | POST | `/api/v1/hardware/devices` | Created device |
| 39 | `src/sections/home.js` | 141 | GET | `/api/v1/reports/sales-summary?date={date}` | Sales summary |
| 40 | `src/sections/home.js` | 142 | GET | `/api/v1/reports/labor-summary?date={date}` | Labor summary |
| 41 | `src/sections/kindnostic-interpreter.js` | 86 | GET | `/api/v1/entomology/snapshot` | Diagnostic snapshot |
| 42 | `src/sections/kindnostic-settings.js` | 35 | GET | `/api/v1/entomology/snapshot` | Diagnostic snapshot |
| 43 | `src/sections/kindnostic-settings.js` | 51 | GET | `/api/v1/entomology/run-probes?tier={tier}` | Probe results |
| 44 | `src/sections/kindnostic-store.js` | 18 | GET | `/api/v1/entomology/snapshot` | Diagnostic snapshot |
| 45 | `src/sections/kindnostic-store.js` | 42 | GET | `/api/v1/entomology/report.xlsx?days={n}` | Binary XLSX blob |
| 46 | `src/sections/kindnostic-survey.js` | 56 | GET | `/api/v1/entomology/run-probes?tier={tier}` | Probe results |
| 47 | `src/sections/labor-reports.js` | 50 | GET | `/api/v1/reports/labor-summary?date={date}` | Labor summary |
| 48 | `src/sections/labor-reports.js` | 62 | GET | `/api/v1/config/employees` | `Employee[]` |
| 49 | `src/sections/labor-reports.js` | 67 | GET | `/api/v1/config/roles` | `Role[]` |
| 50 | `src/sections/menu-availability.js` | 48–49 | GET | `/api/v1/config/menu/categories` | `MenuCategory[]` |
| 51 | `src/sections/menu-availability.js` | 48–49 | GET | `/api/v1/config/menu/items` | `MenuItem[]` |
| 52 | `src/sections/menu-categories.js` | 153 | GET | `/api/v1/menu` | Full `MenuState` |
| 53 | `src/sections/menu-categories.js` | 154–155 | GET | `/api/v1/config/menu/categories` | `MenuCategory[]` |
| 54 | `src/sections/menu-categories.js` | 154–155 | GET | `/api/v1/config/menu/items` | `MenuItem[]` |
| 55 | `src/sections/menu-categories.js` | 377 | GET | `/api/v1/sizes` | `Size[]` |
| 56 | `src/sections/menu-categories.js` | 378 | GET | `/api/v1/option-groups` | `OptionGroup[]` |
| 57 | `src/sections/menu-categories.js` | 741 | PATCH | `/api/v1/menu-items/{item_id}` | Updated item |
| 58 | `src/sections/menu-categories.js` | 750 | DELETE | `/api/v1/menu-items/{item_id}` | 204 |
| 59 | `src/sections/menu-categories.js` | 757 | POST | `/api/v1/menu-items/{item_id}/86` | Updated item |
| 60 | `src/sections/menu-categories.js` | 1113 | PUT | `/api/v1/menu-items/{item_id}/size-pricing/{group_id}` | `{}` |
| 61 | `src/sections/menu-categories.js` | 1327, 1357 | PUT | `/api/v1/menu-items/{item_id}/option-group-override/{group_id}` | `{}` |
| 62 | `src/sections/menu-categories.js` | 1464, 1504 | PUT | `/api/v1/menu-items/{item_id}/size-price-override/{group_id}/{size_name}` | `{}` |
| 63 | `src/sections/menu-performance.js` | 89 | GET | `/api/v1/reports/sales-summary?date={date}` | Sales summary |
| 64 | `src/sections/modifier-data.js` | 21–22 | GET | `/api/v1/menu` | Full `MenuState` |
| 65 | `src/sections/modifier-data.js` | 21–22 | GET | `/api/v1/config/menu/categories` | `MenuCategory[]` |
| 66 | `src/sections/modifier-groups.js` | 132 | GET | `/api/v1/modifiers` | `Modifier[]` |
| 67 | `src/sections/modifier-groups.js` | 153 | GET | `/api/v1/config/modifier-groups` | `ModifierGroup[]` |
| 68 | `src/sections/modifier-groups.js` | 671, 1972 | POST | `/api/v1/modifier-groups` | Created modifier group |
| 69 | `src/sections/modifier-groups.js` | 822, 921 | PATCH | `/api/v1/modifier-groups/{group_id}` | `{}` |
| 70 | `src/sections/modifier-groups.js` | 884, 2156 | POST | `/api/v1/modifier-groups/{group_id}/option-group` | `{}` |
| 71 | `src/sections/modifier-groups.js` | 1104 | DELETE | `/api/v1/modifier-groups/{group_id}/modifiers/{modifier_id}` | `{}` |
| 72 | `src/sections/modifier-groups.js` | 1147, 2224 | POST | `/api/v1/modifier-groups/{group_id}/modifiers/{modifier_id}` | `{}` |
| 73 | `src/sections/modifier-groups.js` | 1283, 1335 | PATCH | `/api/v1/modifiers/{modifier_id}` | `{}` |
| 74 | `src/sections/modifier-groups.js` | 1519 | PUT | `/api/v1/modifiers/{modifier_id}/size-pricing/{group_id}` | `{}` |
| 75 | `src/sections/modifier-groups.js` | 1659 | POST | `/api/v1/modifiers/{modifier_id}/micromods/{micromod_id}` | `{}` |
| 76 | `src/sections/modifier-groups.js` | 1777 | DELETE | `/api/v1/modifiers/{modifier_id}/micromods/{micromod_id}` | `{}` |
| 77 | `src/sections/modifier-groups.js` | 2439 | POST | `/api/v1/option-groups` | Created option group |
| 78 | `src/sections/modifier-groups.js` | 2476 | PATCH | `/api/v1/option-groups/{option_group_id}` | `{}` |
| 79 | `src/sections/modifier-groups.js` | 2485 | DELETE | `/api/v1/option-groups/{option_group_id}` | 204 |
| 80 | `src/sections/modifiers.js` | 923, 1169 | PATCH | `/api/v1/options/{option_id}` | `{}` |
| 81 | `src/sections/modifiers.js` | 1090 | POST | `/api/v1/options` | Created option |
| 82 | `src/sections/modifiers.js` | 1216–1217 | GET | `/api/v1/modifiers` | `Modifier[]` |
| 83 | `src/sections/modifiers.js` | 1216–1217 | GET | `/api/v1/options` | `Option[]` |
| 84 | `src/sections/order-settings.js` | 27 | GET | `/api/v1/config/store` | `StoreConfigBundle` |
| 85 | `src/sections/order-settings.js` | 28 | GET | `/api/v1/config/pricing` | Pricing config |
| 86 | `src/sections/payroll-attendance.js` | 844 | GET | `/api/v1/config/tipout` | `TipoutRule[]` |
| 87 | `src/sections/payroll-attendance.js` | 845 | GET | `/api/v1/config/roles` | `Role[]` |
| 88 | `src/sections/payroll-attendance.js` | 846 | GET | `/api/v1/config/menu/categories` | `MenuCategory[]` |
| 89 | `src/sections/payroll-attendance.js` | 2838 | GET | `/api/v1/config/employees` | `Employee[]` |
| 90 | `src/sections/payroll-attendance.js` | 2879 | GET | `/api/v1/reports/labor-summary?date={date}` | Labor summary (batched across multiple dates) |
| 91 | `src/sections/pricing-extensions.js` | 379–381 | GET | `/api/v1/sizes` | `Size[]` |
| 92 | `src/sections/pricing-extensions.js` | 379–381 | GET | `/api/v1/config/modifier-groups` | `ModifierGroup[]` |
| 93 | `src/sections/pricing-extensions.js` | 379–381 | GET | `/api/v1/option-groups` | `OptionGroup[]` |
| 94 | `src/sections/pricing-extensions.js` | 505 | PUT | `/api/v1/menu-items/{item_id}/size-pricing/{group_id}` | `{}` |
| 95 | `src/sections/pricing-extensions.js` | 570, 641, 701, 773 | PATCH | `/api/v1/items/{item_id}` | Updated item *(wrong path — likely should be `/menu-items/`)* |
| 96 | `src/sections/pricing-extensions.js` | 876, 904, 982 | PUT | `/api/v1/menu-items/{item_id}/option-group-override/{gid}` | `{}` |
| 97 | `src/sections/pricing-extensions.js` | 1075, 1163 | PUT | `/api/v1/menu-items/{item_id}/size-price-override/{gid}/{size_name}` | `{}` |
| 98 | `src/sections/pricing-extensions.js` | 1220 | GET | `/api/v1/config/modifier-groups` | `ModifierGroup[]` |
| 99 | `src/sections/pricing-extensions.js` | 1249, 1392 | PATCH | `/api/v1/categories/{category_id}` | `{}` *(wrong path — likely should be via `/config/push`)* |
| 100 | `src/sections/pricing-setup.js` | 73 | GET | `/api/v1/sizes` | `Size[]` |
| 101 | `src/sections/pricing-setup.js` | 419, 492 | PATCH | `/api/v1/sizes/{size_id}` | `{}` |
| 102 | `src/sections/pricing-setup.js` | 517 | POST | `/api/v1/sizes` | Created size |
| 103 | `src/sections/pricing-specials.js` | 219–226 | GET | `/api/v1/config/pricing/day-parts` | `{day_parts:[…]}` |
| 104 | `src/sections/pricing-specials.js` | 219–226 | GET | `/api/v1/config/pricing/specials` | Specials array |
| 105 | `src/sections/pricing-specials.js` | 219–226 | GET | `/api/v1/config/pricing/order-types` | Order types array |
| 106 | `src/sections/pricing-specials.js` | 219–226 | GET | `/api/v1/config/pricing/employee-discount` | Discount config |
| 107 | `src/sections/pricing-specials.js` | 219–226 | GET | `/api/v1/config/pricing/void-reasons` | `VoidReason[]` |
| 108 | `src/sections/pricing-specials.js` | 219–226 | GET | `/api/v1/config/pricing/discounts` | Discounts array |
| 109 | `src/sections/pricing-specials.js` | 634, 722 | PATCH | `/api/v1/sizes/{size_id}` | `{}` |
| 110 | `src/sections/pricing-specials.js` | 728 | POST | `/api/v1/sizes` | Created size |
| 111 | `src/sections/receipt-settings.js` | 22 | GET | `/api/v1/config/store` | `StoreConfigBundle` |
| 112 | `src/sections/reporting.js` | 66 | GET | `/api/v1/config/menu/categories` | `MenuCategory[]` |
| 113 | `src/sections/reporting.js` | 1081 | GET | `/api/v1/config/employees` | `Employee[]` |
| 114 | `src/sections/reporting.js` | 1119 | GET | `/api/v1/reports/transactions?date_from=…&date_to=…&page=1&page_size=200` | Paginated transaction list |
| 115 | `src/sections/sales-reports.js` | 106, 114, 125 | GET | `/api/v1/reports/sales-summary?date={date}` | Sales summary (called up to ×8 in parallel) |
| 116 | `src/sections/sales-reports.js` | 132 | GET | `/api/v1/config/employees` | `Employee[]` |
| 117 | `src/sections/sales-reports.js` | 134 | GET | `/api/v1/config/roles` | `Role[]` |
| 118 | `src/sections/sales-reports.js` | 139 | GET | `/api/v1/orders/day-summary` | `{checks_list:[…]}` |
| 119 | `src/sections/staff-roles.js` | 73 | GET | `/api/v1/config/roles` | `Role[]` |
| 120 | `src/sections/store-info.js` | 19 | GET | `/api/v1/config/store` | `StoreConfigBundle` |
| 121 | `src/sections/store-info.js` | 49 | POST | `/api/v1/config/store/logo` | FormData upload; `{}` |
| 122 | `src/sections/terminal-settings.js` | 32 | GET | `/api/v1/hardware/terminals` | `Terminal[]` |
| 123 | `src/sections/terminal-settings.js` | 40 | GET | `/api/v1/config/floorplan/sections` | `Section[]` |
| 124 | `src/sections/tipout-rules.js` | 50–52 | GET | `/api/v1/config/tipout` | `TipoutRule[]` |
| 125 | `src/sections/tipout-rules.js` | 50–52 | GET | `/api/v1/config/roles` | `Role[]` |
| 126 | `src/sections/tipout-rules.js` | 50–52 | GET | `/api/v1/config/menu/categories` | `MenuCategory[]` |
| 127 | `src/sections/transaction-log.js` | 47 | GET | `/api/v1/reports/transactions?date_from=…&date_to=…&page=…&page_size=50` | Paginated transactions |
| 128 | `src/sections/transaction-log.js` | 107 | GET | `/api/v1/config/employees` | `Employee[]` |

> `GET /api/v1/reports/hourly-compare?date=…` appears only in a JSDoc comment in `home.js:8` — it is **not fetched** in any live code path.

---

## 2. Static File Structure

```
overseer/
├── index.html                             SPA shell; 4 DOM layers (working/transactional/interrupt/gate) + nav sidebar
├── favicon.svg                            SVG favicon
│
├── assets/
│   ├── fonts/
│   │   ├── B612Mono-Bold.ttf              Monospace font for data display
│   │   └── ChakraPetch-Bold.ttf           Display font for headings
│   ├── images/
│   │   └── logo.jpg                       KINDpos logo asset
│   └── js/
│       ├── chart.min.js                   Chart.js v4 (vendored, offline-first)
│       └── xlsx.mini.min.js               SheetJS XLSX parser (vendored, for Excel import)
│
├── styles/
│   ├── variables.css                      CSS custom properties (palette, fonts, spacing)
│   ├── overseer-layout.css                Two-column layout: nav sidebar + main content area
│   ├── overseer-details.css               Component-level styles (cards, tables, badges, pickers)
│   └── printer-setup.css                  Printer wizard / hardware-setup specific styles
│
└── src/
    ├── app.js                             Bootstrap, nav registration, badge polling, section routing
    ├── theme-bridge.js                    Applies KINDpos token values to CSS variables at runtime
    │
    ├── auth/
    │   ├── auth_state.js                  In-memory auth state; local-first stub (login/logout are no-ops), real changePassword POST
    │   ├── login_scene.js                 Login form UI (email + password); delegates to auth_state.login()
    │   ├── login_scene.test.js            Unit tests for login scene
    │   ├── password_change_scene.js       Forced password-change form; delegates to auth_state.changePassword()
    │   └── password_change_scene.test.js  Unit tests for password change scene
    │
    ├── components/
    │   ├── confirm-dialog.js              Reusable confirm/cancel interrupt dialog
    │   ├── date-picker.js                 Calendar date-picker component
    │   ├── date-picker.test.js            Unit tests for date-picker
    │   ├── picker-modal.js                Generic multi-select item picker (modifiers, categories, etc.)
    │   ├── scene-manager.js               Five-layer DOM scene stack (working/transactional/summary/interrupt/gate)
    │   ├── scene-manager.test.js          Unit tests for scene manager
    │   └── tokens.js                      Local re-export of design tokens (alias for ui/tokens.js)
    │
    ├── data/
    │   ├── sample-employees.js            Loads employee + role data from API; shared data loader
    │   ├── sample-payroll.js              Loads labor-summary per date from API
    │   ├── sample-payroll.test.js         Unit tests for payroll data loader
    │   ├── sample-printers.js             Static sample printer data (no API call)
    │   ├── sample-reports.js              Loads sales-summary per date from API
    │   ├── sample-shifts.js               Static sample shift data (no API call)
    │   └── sample-timedata.js             Loads clocked-in employee list from API
    │
    ├── hardware/
    │   ├── device-silhouettes.js          SVG silhouette renderers for printer/terminal/reader device types
    │   └── shared.js                      Shared hardware helpers: test-connection dialog, scan EventSource wrapper, add-device flow
    │
    ├── sections/
    │   ├── configure-modifiers.js         Per-item modifier configuration UI (delegates fetch to modifier-data.js)
    │   ├── display-order.js               Drag-to-reorder UI for categories and items; writes via config/push
    │   ├── employee-events.js             Factory helpers for employee event payloads (config/push)
    │   ├── employee-events.test.js        Unit tests for employee event factories
    │   ├── employees.js                   Employee management CRUD UI; writes via config/push
    │   ├── employees.test.js              Unit tests for employee section
    │   ├── floor-plan.js                  Interactive floor-plan section editor; GET sections only
    │   ├── hardware-network.js            Network-centric hardware view: scan, register, configure routing
    │   ├── hardware.js                    Printer/reader hardware management: scan, add, test, delete, license
    │   ├── home.js                        Dashboard home: daily sales + labor KPI cards with sparklines
    │   ├── kindnostic-interpreter.js      AI-driven diagnostic interpreter; reads entomology snapshot
    │   ├── kindnostic-settings.js         KINDnostic probe runner and settings panel
    │   ├── kindnostic-store.js            KINDnostic snapshot viewer and XLSX report downloader
    │   ├── kindnostic-survey.js           Symptom-guided probe selector UI
    │   ├── labor-reports.js               Labor cost and hour reporting by employee and date range
    │   ├── labor-reports.test.js          Unit tests for labor reports
    │   ├── menu-availability.js           Per-item availability (active/inactive) toggle grid
    │   ├── menu-categories.js             Full menu editor: categories, items, pricing extensions, 86 toggle
    │   ├── menu-import.js                 Excel → menu import parser (client-side only, no direct fetch)
    │   ├── menu-performance.js            Per-item sales performance charts by date range
    │   ├── modifier-data.js               Central fetch + dedup for modifier/category data used by configure-modifiers
    │   ├── modifier-groups.js             Modifier group management: create, PATCH, size-pricing, micromods, option groups
    │   ├── modifiers.js                   Individual modifier and option CRUD
    │   ├── order-settings.js              Order behavior settings (store config + pricing)
    │   ├── payroll-attendance.js          Payroll and timeclock attendance report with tip pool calculations
    │   ├── payroll-tips.js                Tip distribution editor; writes via config/push
    │   ├── pricing-extensions.js          Per-item advanced pricing: size overrides, option-group overrides
    │   ├── pricing-setup.js               Size vocabulary management (create, edit, toggle active)
    │   ├── pricing-specials.js            Day-part, specials, order-type, void-reason, and discount configuration
    │   ├── receipt-settings.js            Receipt header/footer customization (store config read)
    │   ├── reporting.js                   Reporting hub: category color prefetch + transaction table
    │   ├── sales-reports.js               Sales analytics: daily/weekly summary, employee performance, checks
    │   ├── shift-config.js                Server shift template configuration; writes via config/push
    │   ├── staff-roles.js                 Staff role display and management
    │   ├── store-info.js                  Store name, address, logo upload, contact info
    │   ├── terminal-settings.js           Per-terminal assignment to floor sections
    │   ├── time-attendance.js             Employee time-and-attendance editor; writes via config/push
    │   ├── tipout-rules.js                Tip-out rule configuration (pool definitions)
    │   └── transaction-log.js             Filterable paginated transaction history log
    │
    ├── services/
    │   ├── auth-client.js                 Monkey-patches window.fetch to auto-attach Bearer token on /api/* paths; PIN verify
    │   ├── auth-client.test.js            Unit tests for auth client interceptor
    │   ├── config-push.js                 Batches config events and POSTs to /api/v1/config/push
    │   ├── config-push.test.js            Unit tests for config push service
    │   ├── excel-parser.js                SheetJS-based Excel workbook parser for menu import
    │   └── http.js                        fetchWithTimeout() wrapper (8 s default, AbortController)
    │
    └── ui/
        ├── charts.js                      Chart.js wrappers: sparklines, bar charts, donut charts
        ├── forms.js                       Form component library: inputs, toggles, selects, pill buttons
        ├── money.js                       Monetary display formatters (toFixed(2), currency symbols)
        ├── money.test.js                  Unit tests for money formatters
        └── tokens.js                      Design token object (T.*): colors, fonts, spacing

tests/
└── excel-parser-v3.test.js               Integration tests for the v3 Excel menu import parser
```

---

## 3. API Gaps

Each unique Overseer API call cross-referenced against existing FastAPI routes. **65 COVERED, 9 MISSING.**

### Covered

| Overseer Call | Backend Route (file) |
|---------------|----------------------|
| GET `/api/v1/menu/items` | `menu.py` — `GET /menu/items` |
| GET `/api/v1/system/version` | `system.py` — `GET /system/version` |
| POST `/api/v1/auth/verify-pin` | `auth.py` — `POST /auth/verify-pin` |
| POST `/api/v1/config/push` | `config.py` — `POST /config/push` |
| GET `/api/v1/config/employees` | `config.py` — `GET /config/employees` |
| GET `/api/v1/config/roles` | `config.py` — `GET /config/roles` |
| GET `/api/v1/config/menu/categories` | `config.py` — `GET /config/menu/categories` |
| GET `/api/v1/config/menu/items` | `config.py` — `GET /config/menu/items` |
| GET `/api/v1/config/modifier-groups` | `config.py` — `GET /config/modifier-groups` |
| GET `/api/v1/config/micromods` | `config.py` — `GET /config/micromods` |
| GET `/api/v1/config/floorplan/sections` | `config.py` — `GET /config/floorplan/sections` |
| GET `/api/v1/config/store` | `config.py` — `GET /config/store` |
| POST `/api/v1/config/store/logo` | `config.py` — `POST /config/store/logo` |
| GET `/api/v1/config/tipout` | `config.py` — `GET /config/tipout` |
| GET `/api/v1/config/pricing` | `config.py` — `GET /config/pricing` |
| GET `/api/v1/config/pricing/day-parts` | `config.py` — `GET /config/pricing/day-parts` |
| GET `/api/v1/config/pricing/specials` | `config.py` — `GET /config/pricing/specials` |
| GET `/api/v1/config/pricing/order-types` | `config.py` — `GET /config/pricing/order-types` |
| GET `/api/v1/config/pricing/employee-discount` | `config.py` — `GET /config/pricing/employee-discount` |
| GET `/api/v1/config/pricing/void-reasons` | `config.py` — `GET /config/pricing/void-reasons` |
| GET `/api/v1/config/pricing/discounts` | `config.py` — `GET /config/pricing/discounts` |
| GET `/api/v1/hardware/devices` | `hardware.py` — `GET /hardware/devices` |
| GET `/api/v1/hardware/devices/health` | `hardware.py` — `GET /hardware/devices/health` |
| POST `/api/v1/hardware/devices` | `hardware.py` — `POST /hardware/devices` |
| DELETE `/api/v1/hardware/devices/{mac}` | `hardware.py` — `DELETE /hardware/devices/{mac}` |
| GET `/api/v1/hardware/devices/{mac}/routing` | `hardware.py` — `GET /hardware/devices/{mac}/routing` |
| POST `/api/v1/hardware/devices/{mac}/routing` | `hardware.py` — `POST /hardware/devices/{mac}/routing` |
| GET `/api/v1/hardware/terminals` | `hardware.py` — `GET /hardware/terminals` |
| PUT `/api/v1/hardware/terminals/{terminal_id}` | `hardware.py` — `PUT /hardware/terminals/{terminal_id}` |
| GET `/api/v1/hardware/routing` | `hardware.py` — `GET /hardware/routing` |
| GET `/api/v1/hardware/license/list` | `hardware.py` — `GET /hardware/license/list` |
| DELETE `/api/v1/hardware/license/{code}` | `hardware.py` — `DELETE /hardware/license/{activation_code}` |
| POST `/api/v1/hardware/test-connection` | `hardware.py` — `POST /hardware/test-connection` |
| POST `/api/v1/hardware/test-print` | `hardware.py` — `POST /hardware/test-print` |
| GET `/api/v1/hardware/scan/stream` (SSE) | `hardware.py` — `GET /hardware/scan/stream` |
| GET `/api/v1/reports/sales-summary` | `reporting.py` — `GET /reports/sales-summary` |
| GET `/api/v1/reports/labor-summary` | `reporting.py` — `GET /reports/labor-summary` |
| GET `/api/v1/reports/transactions` | `reporting.py` — `GET /reports/transactions` |
| GET `/api/v1/entomology/snapshot` | `entomology.py` — `GET /entomology/snapshot` |
| GET `/api/v1/entomology/run-probes` | `entomology.py` — `GET /entomology/run-probes` |
| GET `/api/v1/entomology/report.xlsx` | `entomology.py` — `GET /entomology/report.xlsx` |
| GET `/api/v1/menu` | `menu.py` — `GET /menu` |
| GET `/api/v1/sizes` | `sizes.py` — `GET /sizes` |
| POST `/api/v1/sizes` | `sizes.py` — `POST /sizes` |
| PATCH `/api/v1/sizes/{size_id}` | `sizes.py` — `PATCH /sizes/{size_id}` |
| GET `/api/v1/modifiers` | `modifiers.py` — `GET /modifiers` |
| PUT `/api/v1/modifiers/{id}/size-pricing/{group_id}` | `modifiers.py` — `PUT /modifiers/{modifier_id}/size-pricing/{group_id}` |
| POST `/api/v1/modifiers/{id}/micromods/{micromod_id}` | `modifiers.py` — `POST /modifiers/{modifier_id}/micromods/{micromod_id}` |
| DELETE `/api/v1/modifiers/{id}/micromods/{micromod_id}` | `modifiers.py` — `DELETE /modifiers/{modifier_id}/micromods/{micromod_id}` |
| GET `/api/v1/option-groups` | `option_groups.py` — `GET /option-groups` |
| POST `/api/v1/option-groups` | `option_groups.py` — `POST /option-groups` |
| PATCH `/api/v1/option-groups/{id}` | `option_groups.py` — `PATCH /option-groups/{option_group_id}` |
| DELETE `/api/v1/option-groups/{id}` | `option_groups.py` — `DELETE /option-groups/{option_group_id}` |
| GET `/api/v1/modifier-groups` | `modifier_groups.py` — `GET /modifier-groups` |
| POST `/api/v1/modifier-groups/{id}/option-group` | `modifier_groups.py` — `POST /modifier-groups/{group_id}/option-group` |
| POST `/api/v1/modifier-groups/{id}/modifiers/{modifier_id}` | `modifier_groups.py` — `POST /modifier-groups/{group_id}/modifiers/{modifier_id}` |
| DELETE `/api/v1/modifier-groups/{id}/modifiers/{modifier_id}` | `modifier_groups.py` — `DELETE /modifier-groups/{group_id}/modifiers/{modifier_id}` |
| DELETE `/api/v1/menu-items/{item_id}` | `menu_items.py` — `DELETE /menu-items/{item_id}` |
| PUT `/api/v1/menu-items/{id}/size-pricing/{group_id}` | `menu_items.py` — `PUT /menu-items/{item_id}/size-pricing/{group_id}` |
| PUT `/api/v1/menu-items/{id}/option-group-override/{gid}` | `menu_items.py` — `PUT /menu-items/{item_id}/option-group-override/{group_id}` |
| PUT `/api/v1/menu-items/{id}/size-price-override/{gid}/{size_name}` | `menu_items.py` — `PUT /menu-items/{item_id}/size-price-override/{group_id}/{size_name}` |
| GET `/api/v1/options` | `options.py` — `GET /options` |
| POST `/api/v1/options` | `options.py` — `POST /options` |
| PATCH `/api/v1/options/{option_id}` | `options.py` — `PATCH /options/{option_id}` |
| GET `/api/v1/orders/day-summary` | `orders.py` — `GET /orders/day-summary` |
| GET `/api/v1/servers/clocked-in` | `staff.py` — `GET /servers/clocked-in` |

### Missing

| # | Overseer Call | Source | Problem |
|---|---------------|--------|---------|
| M1 | GET `/api/v1/staff` | `app.js:234` | No route at this path. Backend serves employee list at `/api/v1/servers` (staff.py `GET /servers`) or `/api/v1/config/employees`. Path must align with one of these. |
| M2 | POST `/v1/auth/password-change` | `auth_state.js:70` | Double path problem: (1) prefix is `/v1/` not `/api/v1/`; (2) no `POST /auth/password-change` handler exists anywhere in the backend. |
| M3 | POST `/api/v1/modifier-groups` | `modifier-groups.js:671, 1972` | `modifier_groups.py` has no `@router.post("")`. A backend test comment confirms: *"No direct POST endpoint for modifier groups; the production path is config/push."* Frontend expects a REST create endpoint. |
| M4 | PATCH `/api/v1/modifier-groups/{group_id}` | `modifier-groups.js:822, 921` | `modifier_groups.py` only has `PATCH /{group_id}/size-adjustments`. No bare `PATCH /{group_id}` handler for name/drives_pricing/template_id edits. |
| M5 | PATCH `/api/v1/modifiers/{modifier_id}` | `modifier-groups.js:1283, 1335` | `modifiers.py` has no `@router.patch(...)` of any kind. |
| M6 | PATCH `/api/v1/menu-items/{item_id}` | `menu-categories.js:741` | `menu_items.py` has no `@router.patch(...)`. Only PUT sub-resource routes exist. |
| M7 | POST `/api/v1/menu-items/{item_id}/86` | `menu-categories.js:757` | No `/86` route in `menu_items.py`. The 86 action exists at `POST /api/v1/config/menu/86` (config.py:453) — different path and takes item IDs in the body rather than as a path parameter. |
| M8 | PATCH `/api/v1/items/{item_id}` | `pricing-extensions.js:570, 641, 701, 773` | No `/items/` router exists. This is a path bug: `pricing-extensions.js` uses `/items/` while `menu-categories.js` correctly uses `/menu-items/`. The intended route (`PATCH /menu-items/{id}`) is also missing — see M6. |
| M9 | PATCH `/api/v1/categories/{category_id}` | `pricing-extensions.js:1249, 1392` | No `/categories/` router exists. Likely a path bug; the correct write path for category config changes is `POST /api/v1/config/push` with a category event. |

---

## 4. Overseer-Specific Endpoints

Endpoints that serve back-office/management data with no use in a POS terminal session. These would belong in a dedicated `OverseerApiRoutes` layer rather than shared terminal routes.

### 4.1 Reporting & Analytics

Aggregated data — never needed on a terminal:

- `GET /api/v1/reports/sales-summary?date={date}` — daily P&L, net, tips, checks, hourly breakdown
- `GET /api/v1/reports/labor-summary?date={date}` — timeclock hours, employee cost, tipout pool
- `GET /api/v1/reports/transactions?date_from=…&date_to=…&page=…` — full paginated transaction log
- `GET /api/v1/orders/day-summary` — per-check closed-check list (avg-check, server leaderboard)

### 4.2 Hardware & Device Management

Operator console only:

- `GET/POST /api/v1/hardware/devices` — register new printers/readers
- `DELETE /api/v1/hardware/devices/{mac}` — remove device
- `GET /api/v1/hardware/devices/health` — real-time health status map
- `GET/POST /api/v1/hardware/devices/{mac}/routing` — per-device category routing
- `GET/PUT /api/v1/hardware/terminals/{terminal_id}` — terminal display-name and section assignment
- `GET /api/v1/hardware/routing` — global routing matrix
- `GET /api/v1/hardware/scan/stream` (SSE) — network discovery scan
- `POST /api/v1/hardware/test-connection` — probe a device IP/port
- `POST /api/v1/hardware/test-print` — fire a test print job
- `GET /api/v1/hardware/license/list` — license inventory
- `DELETE /api/v1/hardware/license/{code}` — deactivate a license

### 4.3 Diagnostic System (KINDnostic / Entomology)

Management tool — not used on terminals:

- `GET /api/v1/entomology/snapshot` — current diagnostic event store
- `GET /api/v1/entomology/run-probes?tier={tier}` — trigger probe suite
- `GET /api/v1/entomology/report.xlsx?days={n}` — download diagnostic spreadsheet

### 4.4 Staff & Payroll

Back-office read paths:

- `GET /api/v1/staff` *(MISSING — wrong path)* — employee count badge
- `GET /api/v1/servers/clocked-in` — currently clocked-in employees
- `GET /api/v1/config/employees` — full employee list with all fields
- `GET /api/v1/config/tipout` — tipout pool rules
- `POST /v1/auth/password-change` *(MISSING)* — password rotation

### 4.5 Pricing & Configuration Writes

Management write paths not exposed to cashiers:

- `GET /api/v1/config/pricing/day-parts` — day-part definitions
- `GET /api/v1/config/pricing/specials` — special pricing rules
- `GET /api/v1/config/pricing/order-types` — order type configuration
- `GET /api/v1/config/pricing/employee-discount` — employee discount rules
- `GET /api/v1/config/pricing/void-reasons` — configurable void reasons
- `GET /api/v1/config/pricing/discounts` — discount catalog
- `POST /api/v1/config/store/logo` — logo upload (FormData)
- All modifier/size/option CRUD mutations: `POST /api/v1/modifier-groups`, `PATCH /api/v1/modifier-groups/{id}`, `PATCH /api/v1/modifiers/{id}`, `PATCH /api/v1/menu-items/{id}`, `POST /api/v1/menu-items/{id}/86`, etc.

### Shared with Terminal (not Overseer-specific)

These belong in general shared routes and should not be duplicated:  
`/api/v1/menu`, `/api/v1/config/menu/categories`, `/api/v1/config/menu/items`, `/api/v1/config/store`, `/api/v1/config/roles`, `/api/v1/config/push`, `/api/v1/auth/verify-pin`, `/api/v1/sizes`, `/api/v1/modifiers`, `/api/v1/options`, `/api/v1/option-groups`.

---

*OVERSEER AUDIT COMPLETE*
