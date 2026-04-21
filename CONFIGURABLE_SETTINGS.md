# Configurable Settings — Backlog

Running list of values currently hardcoded in the Overseer frontend
that should become operator-configurable (per-location or
company-wide) at some point. Each entry notes *where* the value
lives today, *what it controls*, and the *proposed setting shape*
so a future settings page knows exactly what to render.

The goal isn't to build these settings now — it's to make sure
nothing slips through the cracks. As new hardcoded thresholds
appear during the port, add them here.

---

## Clock Records / Attendance

### Overtime watch threshold
- **Today:** `8` hours, hardcoded in `sections/payroll-attendance.js`
  — triggers the pulsing `warning`-colored dot and the
  `OT WATCH` inline badge on the Live Dashboard.
- **Proposed setting:** `attendance.ot_watch_hours` (number, default 8).
- **Scope:** per-location. Some shops run 12-hour shifts by design.

### Overtime cap (duration cell color)
- **Today:** `durationColor(hrs)` in `data/sample-timedata.js` maps
  ≥10 h to verm. That threshold isn't configurable.
- **Proposed setting:** `attendance.ot_cap_hours` (number, default 10).
- **Scope:** per-location.

### Break compliance alert
- **Today:** California-specific rule baked into the Live Dashboard
  render — alerts when anyone has been clocked in ≥5 h without a
  meal break and isn't currently on one. The alert copy names
  California directly.
- **Proposed setting group:** `attendance.break_rule`
  - `enabled` (bool, default true)
  - `after_hours` (number, default 5) — trigger threshold
  - `meal_min_minutes` (number, default 30) — compliant break length
  - `jurisdiction_label` (string, default "California") — shown in
    the alert copy so Texas stores don't see a CA callout.
- **Scope:** per-location (labor law is geographic).

### Live Dashboard refresh interval
- **Today:** `30_000` ms (30 s) hardcoded in `startClockRefresh`.
- **Proposed setting:** `attendance.live_refresh_ms` (number, default 30000).
- **Scope:** per-terminal. Tablets on spotty wifi may want longer.

---

## Tipout Rules

### Calculation basis options
- **Today:** `TIPOUT_BASIS_OPTIONS = ['Net Sales', 'Gross Tips', 'Net Tips']`
  in `sections/payroll-attendance.js`.
- **Proposed setting:** operator-defined basis list. Some shops
  split on "gift card redemptions" or "delivery revenue".
- **Scope:** per-location, with company-wide defaults.

---

## Staff Roles

### Role identity color palette
- **Today:** 8 curated hex values in `ROLE_COLORS` inside
  `sections/staff-roles.js` — drives the role-card colorPicker.
- **Proposed setting:** `roles.palette` (string array of hex).
- **Scope:** company-wide (theme).

### Role-chip color fallback map
- **Today:** 6 hardcoded values in `ROLE_CHIP_COLORS`
  (`sections/payroll-attendance.js`) keyed by the default role
  ids (`server`, `bartender`, `cook`, `manager`, `host`, `busser`).
- **Future fix:** once the backend Role model accepts `color`,
  replace this fallback with `role.color` lookups from the fetched
  `_tipoutRoles` cache (or a shared roles-cache module).
- **Scope:** n/a once the backend side lands.

### Permission catalog
- **Today:** 7 permission keys with hardcoded labels in
  `PERMISSION_DEFS` (`sections/staff-roles.js`):
  `access_configuration`, `allow_voids`, `allow_discounts`,
  `close_checks`, `view_reports`, `edit_menu`, `reset_pins`.
- **Proposed setting:** `roles.permission_catalog` — operator-
  extensible list of `{ key, label, group }`. Lets chains add
  concept-specific permissions like `close_cash_drawer`.
- **Scope:** company-wide.

### Permission levels
- **Today:** `['Standard', 'Elevated', 'Manager']` in
  `staff-roles.js PERMISSION_LEVELS`.
- **Proposed setting:** `roles.permission_levels` (string array).
  Some shops run a flatter structure, some have a Shift Lead
  tier between Standard and Manager.
- **Scope:** company-wide.

---

## Staff List

### Default new-employee pay rate
- **Today:** `15.00` hardcoded in `showAddEditModal`'s `vals`
  default (`sections/employees.js`).
- **Proposed setting:** read from the role's
  `default_hourly_rate` once the role has been chosen; if no
  role is selected, fall back to a location-level
  `staff.default_hire_rate` (number, default 15).
- **Scope:** per-location.

### PIN length bounds
- **Today:** `4–6` digits, regex-enforced in employees.js save
  handler + PIN reset modal (`/^\d+$/` + length check).
- **Proposed setting:** `staff.pin_min_length` / `staff.pin_max_length`.
- **Scope:** company-wide (security policy).

### Default roles for new employees
- **Today:** `['server']` in the add-employee `vals`
  defaults.
- **Proposed setting:** `staff.default_role_ids` (string array).
- **Scope:** per-location.

---

## How to add entries

When you find another hardcoded knob during a port step, append
here with:

1. **Section heading** grouping by feature area.
2. **Today:** exact value + file path.
3. **Proposed setting:** dotted key + type + default.
4. **Scope:** per-location / per-terminal / company-wide.

Keep entries short. The point is a searchable map of "things we
owe the user", not a spec.
