/* ============================================
   KINDpos Overseer — Labor Reports (Nostalgia)

   Day-scoped labor dashboard, pairs with Sales Reports.
   Period-level payroll lives in Staff → Payroll & Attendance.

   Reads:
     GET /api/v1/reports/labor-summary?date=YYYY-MM-DD
     GET /api/v1/config/employees
     GET /api/v1/config/roles

   Surfaces data the Vz1.x scene was discarding:
     - cob_percent + cob_trend (7-day COB line)
     - ot_alerts (weekly_hours ≥ 35)
     - per-employee clock_in / clock_out / tips
   ============================================ */

import { T } from '../ui/tokens.js';
import {
  buildStatCard,
  buildLineCard,
  buildCOBGauge,
  buildMiniTable,
} from '../ui/charts.js';
import { fmt, fmtPct, fmtInt } from '../ui/money.js';
import { buildDatePicker } from '../components/date-picker.js';

// ─── State ──────────────────────────────────────────────────────────
let _currentContainer = null;
let _currentDate      = todayStr();
let _abortController  = null;

// ─── Date helpers ───────────────────────────────────────────────────
function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

function prettyDate(d) {
  const dt = new Date(`${d}T00:00:00`);
  if (!Number.isFinite(dt.getTime())) return d;
  const days = ['SUN','MON','TUE','WED','THU','FRI','SAT'];
  const months = ['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'];
  return `${days[dt.getDay()]} · ${months[dt.getMonth()]} ${dt.getDate()}, ${dt.getFullYear()}`;
}

// ─── Formatters ─────────────────────────────────────────────────────
function fmtHrs(v) { return (Number(v) || 0).toFixed(2) + 'h'; }

// ─── Fetch ──────────────────────────────────────────────────────────
async function fetchJson(url, signal) {
  const res = await fetch(url, { signal });
  if (!res.ok) throw new Error(`${url} ${res.status}`);
  return res.json();
}

async function fetchLabor(date, signal) {
  try {
    return await fetchJson(`/api/v1/reports/labor-summary?date=${date}`, signal);
  } catch { return null; }
}

async function fetchEmployees(signal) {
  try { return await fetchJson('/api/v1/config/employees', signal); }
  catch { return []; }
}

async function fetchRoles(signal) {
  try { return await fetchJson('/api/v1/config/roles', signal); }
  catch { return []; }
}

// Build { [employee_id]: { isManager, roleName } } the same way sales-reports
// does so manager rows can be badged.
function buildRoleMap(employees, roles) {
  const byId = new Map();
  for (const r of (roles || [])) byId.set(r.role_id, r);
  const map = new Map();
  for (const e of (employees || [])) {
    const eRoles = (e.role_ids || []).map(id => byId.get(id)).filter(Boolean);
    const isManager = eRoles.some(r =>
      (r.permission_level || '').toLowerCase() === 'manager'
    );
    const roleName = eRoles.map(r => r.name).filter(Boolean).join(', ');
    map.set(e.employee_id, { isManager, roleName });
  }
  return map;
}

// ─── Layout ─────────────────────────────────────────────────────────
function buildLayout(container) {
  container.innerHTML = `
    <style>
      .labor-wrapper {
        padding: 30px 32px;
        color: ${T.text};
        font-family: ${T.font.body};
      }

      .labor-header {
        display: flex;
        justify-content: space-between;
        align-items: flex-end;
        margin-bottom: 24px;
        gap: 24px;
      }
      .labor-header-left { min-width: 0; }
      .labor-eyebrow {
        font-family: ${T.font.mono};
        font-size: ${T.fs.md}px;
        letter-spacing: 3px;
        color: ${T.mint};
        font-weight: 700;
        text-transform: uppercase;
        margin-bottom: 8px;
      }
      .labor-title {
        font-size: ${T.fs.hero}px;
        font-weight: 700;
        line-height: 1;
        margin-bottom: 8px;
      }
      .labor-subtitle {
        font-family: ${T.font.mono};
        font-size: ${T.fs.md}px;
        letter-spacing: 2px;
        color: ${T.textMuted};
      }
      .labor-toolbar {
        display: flex;
        gap: 10px;
        align-items: center;
        flex-shrink: 0;
      }

      .labor-regions { min-height: 400px; }
      .labor-row {
        display: grid;
        gap: 16px;
        margin-bottom: 24px;
      }
      .labor-row-hero    { grid-template-columns: repeat(4, 1fr); }
      .labor-row-cob     { grid-template-columns: 1fr 2fr; }
      .labor-row-split   { grid-template-columns: 3fr 2fr; }
      .labor-row-single  { grid-template-columns: 1fr; }

      .labor-region-loading,
      .labor-region-empty,
      .labor-region-error {
        padding: 28px 20px;
        text-align: center;
        font-family: ${T.font.mono};
        font-size: ${T.fs.sm}px;
        letter-spacing: 2px;
        color: ${T.textMuted};
        text-transform: uppercase;
        background: ${T.card};
        border-radius: ${T.r.md}px;
        min-height: 118px;
        display: flex;
        align-items: center;
        justify-content: center;
      }
      .labor-region-error { color: ${T.verm}; }

      .labor-footnote {
        margin-top: 8px;
        font-family: ${T.font.mono};
        font-size: ${T.fs.xs}px;
        letter-spacing: 1.5px;
        color: ${T.textDim};
        text-transform: uppercase;
      }
      .labor-footnote a {
        color: ${T.mint};
        text-decoration: none;
        font-weight: 700;
      }
      .labor-footnote a:hover { text-decoration: underline; }
    </style>

    <div class="labor-wrapper">
      <div class="labor-header">
        <div class="labor-header-left">
          <div class="labor-eyebrow">Reporting</div>
          <div class="labor-title">Labor</div>
          <div class="labor-subtitle" id="labor-subtitle"></div>
        </div>
        <div class="labor-toolbar" id="labor-toolbar"></div>
      </div>

      <div class="labor-regions">
        <div class="labor-row labor-row-hero" id="region-hero">
          <div class="labor-region-loading">Loading…</div>
          <div class="labor-region-loading">Loading…</div>
          <div class="labor-region-loading">Loading…</div>
          <div class="labor-region-loading">Loading…</div>
        </div>
        <div class="labor-row labor-row-cob" id="region-cob">
          <div class="labor-region-loading">Loading…</div>
          <div class="labor-region-loading">Loading…</div>
        </div>
        <div class="labor-row labor-row-split" id="region-breakdown">
          <div class="labor-region-loading">Loading…</div>
          <div class="labor-region-loading">Loading…</div>
        </div>
        <div class="labor-row labor-row-single" id="region-footer">
          <div class="labor-footnote">
            Period-level payroll, tipouts, and clock records live in
            <a href="#" id="labor-link-payroll">Staff → Payroll &amp; Attendance</a>.
          </div>
        </div>
      </div>
    </div>
  `;

  // Subtitle tracks the selected date.
  const sub = container.querySelector('#labor-subtitle');
  if (sub) sub.textContent = prettyDate(_currentDate);

  // Date picker in the toolbar.
  const toolbar = container.querySelector('#labor-toolbar');
  if (toolbar) {
    const picker = buildDatePicker({
      value: _currentDate,
      onChange: (d) => {
        _currentDate = d;
        if (_abortController) _abortController.abort();
        renderAll(container);
      },
    });
    toolbar.appendChild(picker);
  }

  // Deep-link to the staff payroll view (period scope).
  const link = container.querySelector('#labor-link-payroll');
  if (link) {
    link.addEventListener('click', (e) => {
      e.preventDefault();
      if (typeof window !== 'undefined' && typeof window.navigateTo === 'function') {
        window.navigateTo('payroll-attendance');
      } else {
        window.location.hash = '#payroll-attendance';
      }
    });
  }
}

function regionEl(container, id) {
  return container.querySelector(`#${id}`);
}

function renderRegionError(row, err, cells = 1) {
  if (!row) return;
  row.innerHTML = '';
  for (let i = 0; i < cells; i++) {
    const cell = document.createElement('div');
    cell.className = 'labor-region-error';
    cell.textContent = err && err.message ? `Error · ${err.message}` : 'Error';
    row.appendChild(cell);
  }
}

function renderRegionEmpty(row, msg, cells = 1) {
  if (!row) return;
  row.innerHTML = '';
  for (let i = 0; i < cells; i++) {
    const cell = document.createElement('div');
    cell.className = 'labor-region-empty';
    cell.textContent = msg;
    row.appendChild(cell);
  }
}

// ─── Labor KPI math ─────────────────────────────────────────────────
// Federal overtime: any weekly hours beyond 40, summed across the
// roster. Matches the per-row calc so KPI + rows stay in lockstep.
function computeOvertime(employees) {
  return (employees || []).reduce(
    (s, e) => s + Math.max(0, (Number(e.weekly_hours) || 0) - 40),
    0,
  );
}

// ─── Region: hero KPIs ──────────────────────────────────────────────
function renderHero(container, data) {
  const row = regionEl(container, 'region-hero');
  if (!row) return;
  row.innerHTML = '';

  const employees = data.employees || [];
  const totalHours = Number(data.total_hours)
    || employees.reduce((s, e) => s + (Number(e.hours) || 0), 0);
  const totalLabor = Number(data.total_labor)
    || employees.reduce((s, e) =>
      s + (Number(e.gross_pay) || (Number(e.hours) || 0) * (Number(e.hourly_rate) || 0)),
    0);
  const overtime = computeOvertime(employees);
  const netSales = Number(data.net_sales) || Number(data.total_sales) || 0;
  const laborPctFrac = netSales > 0 ? totalLabor / netSales : 0;

  row.appendChild(buildStatCard({
    label: 'Total Hours',
    accent: T.cyan,
    value: fmtHrs(totalHours),
    valueColor: T.cyan,
    sub: `${fmtInt(employees.length)} on the clock`,
  }));

  row.appendChild(buildStatCard({
    label: 'Overtime',
    accent: overtime > 0 ? T.warning : T.green,
    value: fmtHrs(overtime),
    valueColor: overtime > 0 ? T.warning : T.text,
    sub: overtime > 0 ? 'Weekly hours > 40' : 'Under 40h weekly',
  }));

  row.appendChild(buildStatCard({
    label: 'Total Labor',
    accent: T.gold,
    value: fmt(totalLabor, { dp: 0 }),
    valueColor: T.gold,
    sub: 'Regular wages today',
  }));

  const laborPctOver = laborPctFrac > 0.35;
  row.appendChild(buildStatCard({
    label: 'Labor %',
    accent: laborPctOver ? T.verm : T.mint,
    value: fmtPct(laborPctFrac).replace('%', ''),
    valueSuffix: '%',
    valueColor: laborPctOver ? T.verm : T.mint,
    sub: netSales > 0 ? `${fmt(netSales, { dp: 0 })} net sales` : 'No sales yet',
  }));
}

// ─── Region: COB gauge + 7-day trend ────────────────────────────────
function renderCob(container, data) {
  const row = regionEl(container, 'region-cob');
  if (!row) return;
  row.innerHTML = '';

  row.appendChild(buildCOBGauge({
    pct:   Number(data.cob_percent) || 0,
    labor: Number(data.total_labor) || 0,
    hours: Number(data.total_hours) || 0,
  }));

  const trend = Array.isArray(data.cob_trend) ? data.cob_trend : [];
  if (trend.length) {
    row.appendChild(buildLineCard({
      title: 'COB Trend',
      subtitle: 'Labor % of sales · last 7 days',
      accent: T.mint,
      xLabels: trend.map(t => t.day || ''),
      series: [{
        name: 'Labor %',
        values: trend.map(t => Number(t.percent) || 0),
        color: T.gold,
        markers: true,
      }],
      formatY: (n) => `${Math.round(n)}%`,
    }));
  } else {
    const cell = document.createElement('div');
    cell.className = 'labor-region-empty';
    cell.textContent = 'COB trend unavailable';
    row.appendChild(cell);
  }
}

// ─── Region: employee breakdown + OT watch ──────────────────────────
function renderBreakdown(container, data, roleMap) {
  const row = regionEl(container, 'region-breakdown');
  if (!row) return;
  row.innerHTML = '';

  const employees = data.employees || [];
  const roles = roleMap || new Map();

  // ─ Employee Breakdown ─
  row.appendChild(buildMiniTable({
    title: 'Employee Breakdown',
    subtitle: `${employees.length} on the clock · ${prettyDate(data.date || _currentDate)}`,
    accent: T.green,
    columns: [
      {
        label: 'Employee', align: 'left', width: '1.4fr',
        cell: (e) => {
          const empId = e.id || e.employee_id;
          const role = roles.get(empId);
          return {
            text: e.name || e.display_name || empId || '—',
            badge: (role && role.isManager) ? { text: 'MGR' } : null,
          };
        },
      },
      {
        label: 'In', align: 'left', width: '0.6fr',
        cell: (e) => ({
          text: e.clock_in || '—',
          color: e.clock_in ? T.text : T.textDim,
        }),
      },
      {
        label: 'Out', align: 'left', width: '0.6fr',
        cell: (e) => ({
          text: e.clock_out || 'on',
          color: e.clock_out ? T.text : T.greenUp,
          weight: e.clock_out ? 400 : 700,
        }),
      },
      {
        label: 'Today', align: 'right', width: '0.7fr',
        cell: (e) => ({
          text: fmtHrs(e.hours),
          color: T.text,
        }),
      },
      {
        label: 'OT', align: 'right', width: '0.7fr',
        cell: (e) => {
          const ot = Math.max(0, (Number(e.weekly_hours) || 0) - 40);
          return ot > 0
            ? { text: fmtHrs(ot), color: T.verm, weight: 700 }
            : { text: '—', color: T.textDim };
        },
      },
      {
        label: 'Rate', align: 'right', width: '0.7fr',
        cell: (e) => {
          const r = Number(e.hourly_rate) || 0;
          return r > 0
            ? { text: fmt(r) + '/h', color: T.textMuted }
            : { text: '—', color: T.textDim };
        },
      },
      {
        label: 'Gross', align: 'right', width: '0.9fr',
        cell: (e) => {
          const g = Number(e.gross_pay)
            || (Number(e.hours) || 0) * (Number(e.hourly_rate) || 0);
          return { text: fmt(g), color: T.gold, weight: 700 };
        },
      },
    ],
    rows: employees,
  }));

  // ─ OT Watch ─
  const otAlerts = Array.isArray(data.ot_alerts) ? data.ot_alerts : [];
  if (otAlerts.length) {
    row.appendChild(buildMiniTable({
      title: 'Overtime Watch',
      subtitle: 'Weekly hours ≥ 35',
      accent: T.warning,
      columns: [
        {
          label: 'Employee', align: 'left', width: '1.4fr',
          cell: (a) => ({ text: a.name || a.id || '—' }),
        },
        {
          label: 'Weekly', align: 'right', width: '0.8fr',
          cell: (a) => {
            const wh = Number(a.weekly_hours) || 0;
            return { text: fmtHrs(wh), color: T.text, weight: 700 };
          },
        },
        {
          label: 'Status', align: 'right', width: '0.8fr',
          cell: (a) => {
            const isCrit = (a.status || '').toLowerCase() === 'critical';
            return {
              text: isCrit ? 'OVER' : 'WARN',
              color: isCrit ? T.verm : T.warning,
              weight: 700,
            };
          },
        },
      ],
      rows: otAlerts,
    }));
  } else {
    const cell = document.createElement('div');
    cell.className = 'labor-region-empty';
    cell.textContent = 'No OT risk this week';
    row.appendChild(cell);
  }
}

// ─── Orchestration ──────────────────────────────────────────────────
async function renderAll(container) {
  const sub = container.querySelector('#labor-subtitle');
  if (sub) sub.textContent = prettyDate(_currentDate);

  // Reset region cells to loading placeholders so stale data flashes clear.
  const hero = regionEl(container, 'region-hero');
  if (hero) hero.innerHTML = '<div class="labor-region-loading">Loading…</div>'.repeat(4);
  const cob = regionEl(container, 'region-cob');
  if (cob) cob.innerHTML = '<div class="labor-region-loading">Loading…</div>'.repeat(2);
  const breakdown = regionEl(container, 'region-breakdown');
  if (breakdown) breakdown.innerHTML = '<div class="labor-region-loading">Loading…</div>'.repeat(2);

  _abortController = new AbortController();
  const signal = _abortController.signal;
  const still  = () => _currentContainer === container;

  const [data, employees, roles] = await Promise.all([
    fetchLabor(_currentDate, signal),
    fetchEmployees(signal),
    fetchRoles(signal),
  ]);

  if (!still() || signal.aborted) return;

  if (!data) {
    renderRegionEmpty(hero, 'No labor data for this date', 4);
    renderRegionEmpty(cob, 'No labor data for this date', 2);
    renderRegionEmpty(breakdown, 'No labor data for this date', 2);
    return;
  }

  const roleMap = buildRoleMap(employees, roles);
  renderHero(container, data);
  renderCob(container, data);
  renderBreakdown(container, data, roleMap);
}

// ─── Public API ─────────────────────────────────────────────────────
export function buildLaborReportsScene(container) {
  _currentContainer = container;
  _currentDate = todayStr();
  buildLayout(container);
  renderAll(container).catch(err => {
    if (err && err.name === 'AbortError') return;
    console.error('[LaborReports] Mount error:', err);
    const hero = regionEl(container, 'region-hero');
    renderRegionError(hero, err, 4);
  });
}

export function cleanupLaborReports(container) {
  if (_abortController) {
    _abortController.abort();
    _abortController = null;
  }
  if (container) container.innerHTML = '';
  _currentContainer = null;
}
