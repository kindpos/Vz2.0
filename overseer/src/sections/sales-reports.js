/* ============================================
   KINDpos Overseer — Sales Reports scene (v2)

   Weekly Sales landing. Replaces the previous Daily Flash
   drill-down chain (sections/reporting.js) under the same
   `sales-reports` nav id.

   Phase 1: static scaffolding only. Header, toolbar, sub-tabs,
   and an empty regions area. No charts, no data fetching,
   no interactivity on toolbar or sub-tabs.

   Style reference: sections/home.js (card geometry, left-border
   accent, mono eyebrow labels).
   ============================================ */

import { T } from '../ui/tokens.js';

// ─── Module state ────────────────────────────────────────────────────
let _currentContainer = null;

// ─── Layout ──────────────────────────────────────────────────────────
function buildLayout(container) {
  container.innerHTML = `
    <style>
      .sales-wrapper {
        padding: 30px 32px;
        color: ${T.text};
        font-family: ${T.font.body};
      }

      /* ── Header row ─────────────────────────────────────────── */
      .sales-header {
        display: flex;
        justify-content: space-between;
        align-items: flex-end;
        margin-bottom: 24px;
        gap: 24px;
      }
      .sales-header-left { min-width: 0; }
      .sales-eyebrow {
        font-family: ${T.font.mono};
        font-size: ${T.fs.md}px;
        letter-spacing: 3px;
        color: ${T.mint};
        font-weight: 700;
        text-transform: uppercase;
        margin-bottom: 8px;
      }
      .sales-title {
        font-size: ${T.fs.hero}px;
        font-weight: 700;
        line-height: 1;
        margin-bottom: 8px;
      }
      .sales-subtitle {
        font-family: ${T.font.mono};
        font-size: ${T.fs.md}px;
        letter-spacing: 2px;
        color: ${T.textMuted};
      }

      /* ── Toolbar (range picker, compare chip, export) ───────── */
      .sales-toolbar {
        display: flex;
        gap: 10px;
        align-items: center;
        flex-shrink: 0;
      }
      .sales-chip {
        display: inline-flex;
        align-items: center;
        gap: 8px;
        padding: 8px 14px;
        border-radius: ${T.r.sm}px;
        border: 1px solid var(--chip-border);
        color: var(--chip-color);
        background: transparent;
        font-family: ${T.font.mono};
        font-size: ${T.fs.sm}px;
        letter-spacing: 1.5px;
        text-transform: uppercase;
        font-weight: 700;
        white-space: nowrap;
        cursor: default;
      }
      .sales-chip-range {
        --chip-border: ${T.mint};
        --chip-color: ${T.mint};
      }
      .sales-chip-compare {
        --chip-border: ${T.lavender};
        --chip-color: ${T.lavender};
      }
      .sales-chip-caret {
        font-size: 9px;
        opacity: 0.7;
      }
      .sales-export {
        padding: 8px 18px;
        border-radius: ${T.r.pill}px;
        border: none;
        background: ${T.gold};
        color: #1a1d21;
        font-family: ${T.font.mono};
        font-size: ${T.fs.sm}px;
        letter-spacing: 1.8px;
        text-transform: uppercase;
        font-weight: 700;
        white-space: nowrap;
        cursor: default;
      }

      /* ── Sub-tab strip ──────────────────────────────────────── */
      .sales-subtabs {
        display: flex;
        gap: 0;
        border-bottom: 1px solid ${T.well};
        margin-bottom: 24px;
      }
      .sales-subtab {
        padding: 12px 20px;
        font-family: ${T.font.mono};
        font-size: ${T.fs.md}px;
        letter-spacing: 2px;
        font-weight: 700;
        text-transform: uppercase;
        color: ${T.textMuted};
        border-bottom: 2px solid transparent;
        margin-bottom: -1px;
        cursor: default;
      }
      .sales-subtab.active {
        color: ${T.mint};
        border-bottom-color: ${T.mint};
      }

      /* ── Regions placeholder (Phase 1 only) ─────────────────── */
      .sales-regions {
        min-height: 400px;
      }
      .sales-placeholder {
        font-family: ${T.font.mono};
        font-size: ${T.fs.base}px;
        letter-spacing: 2px;
        color: ${T.textDim};
        padding: 80px 20px;
        text-align: center;
        text-transform: uppercase;
      }
    </style>

    <div class="sales-wrapper">
      <div class="sales-header">
        <div class="sales-header-left">
          <div class="sales-eyebrow">Reporting</div>
          <div class="sales-title">Sales</div>
          <div class="sales-subtitle">Weekly revenue, covers, and cost-of-business at a glance</div>
        </div>
        <div class="sales-toolbar">
          <div class="sales-chip sales-chip-range" role="button" aria-disabled="true">
            <span>This week · Apr 13 – Apr 19, 2026</span>
            <span class="sales-chip-caret">▾</span>
          </div>
          <div class="sales-chip sales-chip-compare" role="button" aria-disabled="true">
            <span>vs Last week</span>
            <span class="sales-chip-caret">▾</span>
          </div>
          <button class="sales-export" type="button" aria-disabled="true">Export</button>
        </div>
      </div>

      <div class="sales-subtabs">
        <div class="sales-subtab active">Overview</div>
        <div class="sales-subtab">Dayparts</div>
        <div class="sales-subtab">Servers</div>
        <div class="sales-subtab">Payments</div>
        <div class="sales-subtab">Tips</div>
        <div class="sales-subtab">Voids &amp; Comps</div>
      </div>

      <div class="sales-regions">
        <div class="sales-placeholder">Content regions load here</div>
      </div>
    </div>
  `;
}

// ─── Public API ──────────────────────────────────────────────────────
export function buildSalesReportsScene(container) {
  _currentContainer = container;
  buildLayout(container);
}

export function cleanupSalesReports() {
  _currentContainer = null;
}
