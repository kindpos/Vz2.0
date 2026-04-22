# Overseer Sales Reports — Sub-Tab Drill-Downs

## Context

The Overseer back-office **Sales Reports** landing page is live on `main` (commit `54a86ad`). It renders a weekly overview with hero KPIs + WoW deltas, a weekly trend line, a COB gauge, a stacked composition area, a tender bar, a 7-day × hours heatmap, a check-size histogram, a top-items table, and a top-servers table with MGR badges — all fed from real backend data. No mocks anywhere.

Below the page header and toolbar, there's a sub-tab strip:
```
OVERVIEW · DAYPARTS · SERVERS · PAYMENTS · TIPS · VOIDS & COMPS
```

**OVERVIEW is what currently renders.** The other five tabs are decorative — plain divs with no click handlers, `cursor: default`. Your task is to wire them up as drill-down views.

## Repo

- Path: `/home/user/Vz2.0`
- Base: `main` (currently `54a86ad`)
- **Start a new feature branch** — suggest `claude/overseer-sales-subtabs`. Don't work directly on main.

## Files to read first

### Current scene
- `overseer/src/sections/sales-reports.js` — the scene. The sub-tab strip lives around lines 275–285 (`<div class="sales-subtabs">`). All five OVERVIEW region renderers and the fetch orchestration are in this file.
- `overseer/src/ui/charts.js` — DOM-built chart builders. Exported: `buildStatCard`, `buildSparkline`, `buildLineCard`, `buildCOBGauge`, `buildStackedArea`, `buildTenderBar`, `buildHeatmap`, `buildHistogram`, `buildMiniTable`. Private helpers: `buildCardShell`, `buildEyebrow`, `buildMonoLabel`, `niceMax`, `nextDefId`.
- `overseer/src/ui/money.js` — `fmt`, `fmtPct`, `fmtInt`, `fmtPP`.
- `overseer/src/ui/tokens.js` — `T` palette. Colors: `gold`, `cyan`, `mint`, `lavender`, `verm`, `greenUp`, `warning`, `text`, `textMuted`, `textDim`, `bg`, `card`, `well`.

### Reference patterns
- `overseer/src/sections/home.js` — sibling dashboard scene. Use for visual style cues (card geometry, sparkline look, eyebrow weights, palette precedent).
- `overseer/src/sections/reporting.js` — **the OLD Daily Flash scene.** Unreferenced in app.js but still on disk intentionally. Contains the `pushView` / `popView` view-stack pattern (lines 113–225) you should **reuse** for drill-downs. Also contains existing implementations of some drill-down views (`buildTipsByServer`, `buildAdjustmentsDetail`) you can crib data-access patterns from — but do NOT copy its styling (it's pre-Nostalgia).
- `overseer/src/ui/forms.js` — shared form / button / modal builders if you need input controls.
- `overseer/src/components/scene-manager.js` — do **not** touch. Sub-tabs are a view stack *within* the scene, not new scenes.

## Task

Make each sub-tab click swap the `#sales-regions` container for a drill-down view, keeping the header/toolbar/tab strip persistent. OVERVIEW is the default root view.

### Architectural recommendation

Adopt the in-scene view stack pattern from `reporting.js`:

```js
const VIEW_REGISTRY = {
  'overview':    buildOverviewView,    // existing layout (extracted)
  'dayparts':    buildDaypartsView,
  'servers':     buildServersView,
  'payments':    buildPaymentsView,
  'tips':        buildTipsView,
  'voids-comps': buildVoidsCompsView,
};

let _activeView = 'overview';

function setView(name) {
  if (!(name in VIEW_REGISTRY)) return;
  _activeView = name;
  // toggle .active on subtab divs
  // clear #sales-regions
  // call VIEW_REGISTRY[name](container) which repopulates #sales-regions
}
```

Attach a click handler to each `.sales-subtab` div that calls `setView(tabName)`. Toggle the `.active` class — the mint underline CSS is already in place.

**Don't register new scenes.** All drill-down builders live inside `sales-reports.js` (or a new sibling file in `overseer/src/sections/sales/` if size warrants splitting).

### The five tabs

| Tab | Data | Content ideas |
|---|---|---|
| **Dayparts** | `/api/v1/orders/day-summary` → `dayparts[]` (AM/PM/Late with sales + checks); per-hour from `/sales-summary` `hourly_sales[]` | Three daypart cards (AM/PM/Late) with net, covers, avg check. Hour-of-day breakdown chart. Optionally repeat hero-style cards per daypart. |
| **Servers** | `/sales-summary` `top_servers[]` (already fetched); `/config/employees` + `/config/roles` (already fetched for MGR map) | Full leaderboard beyond top-6. Columns: server, role badge, checks, covers, net, tip$, tip%. Sortable if time allows (non-blocking). |
| **Payments** | `/sales-summary` `cash_total`/`card_total`/`*_count`; `/orders/day-summary` `payments_list[]` (per-payment detail) | Tender split bar (promote existing `buildTenderBar`). Transaction table: method / amount / tip / order / time. Per-method average. |
| **Tips** | `/sales-summary` `tip_buckets[]`, `tip_avg`, `tips_collected`; per-server from `top_servers[]` | Tip distribution histogram (was removed in Gap 4 — resurrect it here where it belongs). Per-server tip% ranking. Total tips collected + tipout implication if `/tipout` or config.tipout_percent is reachable. |
| **Voids & Comps** | `/sales-summary` `voids_total`, `discounts_total`, `refunds_total`; `/orders/day-summary` `checks_list[]` filtered to `status: 'voided'`; `reporting.js:734 buildAdjustmentsDetail` has drill logic to reference | Three KPI cards (voids $ / discounts $ / refunds $). Voided checks table with time, amount, reason. Optional reason-breakdown pie/bar. |

### Constraints

- **Do not modify the OVERVIEW layout.** It's been reviewed and shipped. Extract it into `buildOverviewView(container)` unchanged; the five existing render functions (`renderHero`, `renderTrendCob`, `renderComposition`, `renderTenderHeatmap`, `renderBottomRow`) get called from it.
- **Backend is frozen.** Use only existing endpoints: `/api/v1/reports/sales-summary`, `/labor-summary`, `/orders/day-summary`, `/config/employees`, `/config/roles`. If a tab genuinely needs data that isn't there, flag it in the phase report rather than inventing mock data.
- **No new dependencies.** Follow the existing DOM-built convention. No Chart.js for SVG — inline SVG via `document.createElementNS` is the precedent.
- **Feature branch only.** Don't push to main without explicit user approval. The user will run local tests and tell you when to push.
- **Nostalgia palette discipline.** No hex hardcodes in components — route through `T.*`. Money routes through `money.js` helpers.

### Data-fetch considerations

The current OVERVIEW fetches run in parallel (`todayPromise`, `weekPromise`, `lastWeekPromise`, `laborPromise`, `daySummaryPromise`, `rolesPromise`). Most drill-downs reuse this data — don't re-fetch. Pass the resolved promises (or their cached values) into view builders.

Implementation sketch:
```js
// Cache fetched values at scene level so view switches are instant
let _cache = { today: null, week: null, daySummary: null, ... };

// In the main fetch orchestration, populate _cache as promises resolve.
// setView() reads from _cache; if the active tab needs data that's still
// loading, show a "Loading…" placeholder and re-render when it arrives.
```

View switches should be instant after first load — no re-fetching on tab click.

## Style

- Vz2.0 Nostalgia: see `home.js` and the existing OVERVIEW regions.
- Active tab: mint text + 2px mint underline (current CSS in `sales-reports.js` already does this — just toggle `.active`).
- Every card uses `buildCardShell` (mint left-border accent, 16–18px padding, `T.card` background, 10px radius).
- Tables: `buildMiniTable` with `cell: (row) => ({text, color, weight, badge?})`.
- Empty/loading/error placeholders: match `.sales-region-loading` / `.sales-region-empty` / `.sales-region-error` classes already defined.

## Verification

No frontend test suite exists. Minimum checks after building:

1. `node --check` every touched JS file.
2. `grep -nE '#[0-9a-fA-F]{3,6}' overseer/src/sections/sales-reports.js overseer/src/ui/charts.js` — should return zero hex hardcodes (except the one intentional `#1a1d21` dark-ink on the Export pill).
3. `grep -nE '\$[0-9]{3,}|[0-9]{4,}\.[0-9]' overseer/src/sections/sales-reports.js` — should return only parsing-regex literals and SVG coords, zero fabricated business values.
4. Manual browser test: load Overseer → REPORTING → Sales Reports. Click each tab in turn. Console should stay clean. Back-navigation via browser history is not required (tab state is scene-local, not URL-driven).

## Git

- Feature branch: start from `main` (`54a86ad`).
- Commits: one per tab wired, or logical groups. Body of each commit describes data sources + any deviations.
- Commit messages: `overseer: Sales Reports <tab-name> drill-down`.
- **Never push to main without explicit permission.** The user will review locally and tell you.

## Previous session context (for continuity)

This work follows an 8-phase initial build + 4-phase gap-closing pass:
- **Phases 1–8**: scene shell, hero row, trend+COB, composition, tender+heatmap, histogram+tables, integration polish. Shipped to main in commit `721f200`.
- **Gaps 1–4**: WoW deltas, MGR badges, weekly-shape regions via 7 parallel fetches, real check-size histogram. Shipped to main in commit `54a86ad`.

The user was terse and decisive throughout — preferred real data over mocks, replaced mock-data modules with live endpoints mid-build, and keeps the feature-branch → main push gated on their explicit say-so. They'll tell you when to push.
