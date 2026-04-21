// Entomology GUI — PIN auth, snapshot + recent issues view, Excel export.
// No frameworks. Single file entry point.

const TOKEN_KEY = "entomology.token";
const NAME_KEY = "entomology.name";
const MAX_PIN_LENGTH = 6;
const SNAPSHOT_REFRESH_MS = 15000;
const CATEGORIES = ["DEVICE", "NETWORK", "SYSTEM", "PERIPHERAL", "RECOVERY"];

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));

let pinBuffer = "";
let snapshotTimer = null;

// ── Token helpers ────────────────────────────────────
function getToken() { return sessionStorage.getItem(TOKEN_KEY); }
function setToken(t, name) {
  sessionStorage.setItem(TOKEN_KEY, t);
  if (name) sessionStorage.setItem(NAME_KEY, name);
}
function clearToken() {
  sessionStorage.removeItem(TOKEN_KEY);
  sessionStorage.removeItem(NAME_KEY);
}

async function authedFetch(url, options = {}) {
  const token = getToken();
  const headers = { ...(options.headers || {}) };
  if (token) headers["Authorization"] = `Bearer ${token}`;
  const res = await fetch(url, { ...options, headers });
  if (res.status === 401) {
    clearToken();
    showPinScreen();
    throw new Error("session_expired");
  }
  return res;
}

// ── PIN screen ───────────────────────────────────────
function showPinScreen() {
  $("#dashboard").classList.add("hidden");
  $("#pin-screen").classList.remove("hidden");
  pinBuffer = "";
  renderPinDisplay();
  if (snapshotTimer) { clearInterval(snapshotTimer); snapshotTimer = null; }
}

function renderPinDisplay() {
  const el = $("#pin-display");
  el.innerHTML = "";
  for (let i = 0; i < pinBuffer.length; i++) {
    const dot = document.createElement("span");
    dot.className = "pin-dot";
    el.appendChild(dot);
  }
}

function shakePinCard() {
  const card = $(".pin-card");
  card.classList.add("pin-shake");
  setTimeout(() => card.classList.remove("pin-shake"), 400);
}

async function submitPin() {
  if (pinBuffer.length === 0) return;
  $("#pin-error").textContent = "";
  try {
    const res = await fetch("/api/v1/auth/verify-pin", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pin: pinBuffer }),
    });
    const data = await res.json();
    if (data.valid && data.token) {
      setToken(data.token, data.name);
      pinBuffer = "";
      renderPinDisplay();
      showDashboard();
    } else {
      shakePinCard();
      $("#pin-error").textContent = "Incorrect PIN.";
      pinBuffer = "";
      renderPinDisplay();
    }
  } catch (err) {
    $("#pin-error").textContent = "Network error. Try again.";
    shakePinCard();
  }
}

function wirePinPad() {
  $$(".pin-key").forEach((btn) => {
    btn.addEventListener("click", () => {
      const digit = btn.dataset.digit;
      const action = btn.dataset.action;
      if (digit && pinBuffer.length < MAX_PIN_LENGTH) {
        pinBuffer += digit;
        renderPinDisplay();
      } else if (action === "clear") {
        pinBuffer = "";
        renderPinDisplay();
        $("#pin-error").textContent = "";
      } else if (action === "submit") {
        submitPin();
      }
    });
  });

  document.addEventListener("keydown", (e) => {
    if ($("#pin-screen").classList.contains("hidden")) return;
    if (e.key >= "0" && e.key <= "9" && pinBuffer.length < MAX_PIN_LENGTH) {
      pinBuffer += e.key;
      renderPinDisplay();
    } else if (e.key === "Backspace") {
      pinBuffer = pinBuffer.slice(0, -1);
      renderPinDisplay();
    } else if (e.key === "Enter") {
      submitPin();
    } else if (e.key === "Escape") {
      pinBuffer = "";
      renderPinDisplay();
    }
  });
}

// ── Dashboard ────────────────────────────────────────
function showDashboard() {
  $("#pin-screen").classList.add("hidden");
  $("#dashboard").classList.remove("hidden");
  const name = sessionStorage.getItem(NAME_KEY);
  $("#session-name").textContent = name ? `Signed in as ${name}` : "";
  refreshSnapshot();
  refreshIssues();
  snapshotTimer = setInterval(refreshSnapshot, SNAPSHOT_REFRESH_MS);
}

async function refreshSnapshot() {
  try {
    const res = await authedFetch("/api/v1/entomology/snapshot");
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    renderMetrics(data);
    renderProbes(data.probes || []);
    $("#snapshot-updated").textContent = `Updated ${formatTime(new Date())}`;
  } catch (err) {
    if (err.message === "session_expired") return;
    console.error("snapshot error", err);
  }
}

function renderMetrics(snap) {
  const metrics = snap.system_metrics || {};
  const heartbeat = snap.heartbeat_age_seconds;
  const items = [
    { label: "Terminal", value: snap.terminal_id || "—" },
    { label: "CPU Temp", value: fmtNum(metrics.cpu_temp_c, "°C") },
    { label: "Memory", value: fmtNum(metrics.memory_used_pct, "%") },
    { label: "Disk", value: fmtNum(metrics.disk_used_pct, "%") },
    { label: "Uptime", value: fmtNum(metrics.uptime_hours, "h") },
    {
      label: "Heartbeat",
      value: heartbeat == null ? "—" : `${Math.round(heartbeat)}s ago`,
    },
  ];
  const host = $("#snapshot-metrics");
  host.innerHTML = "";
  for (const m of items) {
    const el = document.createElement("div");
    el.className = "metric";
    el.innerHTML = `<div class="metric-label">${m.label}</div><div class="metric-value">${escapeHtml(m.value)}</div>`;
    host.appendChild(el);
  }
}

function renderProbes(probes) {
  const host = $("#snapshot-probes");
  host.innerHTML = "";
  if (probes.length === 0) {
    host.innerHTML = '<div class="empty">No probes registered.</div>';
    return;
  }
  for (const p of probes) {
    const tile = document.createElement("div");
    tile.className = `probe-tile status-${p.status || "PASS"}`;
    const msg = p.message ? `<div class="probe-message">${escapeHtml(p.message)}</div>` : "";
    tile.innerHTML = `
      <div class="probe-id">${escapeHtml(p.id)}</div>
      <div class="probe-meta">${escapeHtml(p.category || "")} · ${p.duration_ms || 0}ms · <b>${escapeHtml(p.status || "")}</b></div>
      ${msg}
    `;
    host.appendChild(tile);
  }
}

async function refreshIssues() {
  const days = parseInt($("#days-select").value, 10);
  const host = $("#issues-body");
  host.innerHTML = '<div class="empty">Loading…</div>';
  try {
    const res = await authedFetch(`/api/v1/entomology/issues?days=${days}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    renderIssues(data);
  } catch (err) {
    if (err.message === "session_expired") return;
    host.innerHTML = '<div class="empty">Failed to load issues.</div>';
  }
}

function renderIssues(data) {
  const host = $("#issues-body");
  host.innerHTML = "";
  const groups = data.groups || {};
  const total = data.total || 0;

  if (total === 0) {
    host.innerHTML =
      '<div class="empty">No issues at WARNING or above in this window. Nice.</div>';
    return;
  }

  for (const cat of CATEGORIES) {
    const byCode = groups[cat] || {};
    const codes = Object.keys(byCode);
    const catCount = codes.reduce((n, c) => n + byCode[c].length, 0);
    if (catCount === 0) continue;

    const block = document.createElement("div");
    block.className = "category-block";

    const head = document.createElement("div");
    head.className = "category-head";
    head.innerHTML = `
      <span class="category-name">${cat}</span>
      <span class="category-count">${catCount}</span>
    `;
    head.addEventListener("click", () => block.classList.toggle("open"));
    block.appendChild(head);

    const list = document.createElement("div");
    list.className = "code-list";
    for (const code of codes.sort()) {
      const rows = byCode[code];
      const group = document.createElement("div");
      group.className = "code-group";
      group.innerHTML = `
        <div class="code-header">
          <span>${code}</span>
          <span class="muted">${rows.length} event(s)</span>
        </div>
      `;
      for (const ev of rows.slice(0, 20)) {
        const row = document.createElement("div");
        row.className = "event-row";
        row.innerHTML = `
          <span class="muted">${escapeHtml(formatTs(ev.timestamp))}</span>
          <span class="sev-pill sev-${ev.severity}">${ev.severity}</span>
          <span>${escapeHtml(ev.message)}</span>
        `;
        group.appendChild(row);
      }
      if (rows.length > 20) {
        const more = document.createElement("div");
        more.className = "muted";
        more.style.padding = "4px 0 0 0";
        more.textContent = `…and ${rows.length - 20} more (see bug report)`;
        group.appendChild(more);
      }
      list.appendChild(group);
    }
    block.appendChild(list);
    host.appendChild(block);
  }
}

// ── Download ─────────────────────────────────────────
async function downloadReport() {
  const days = parseInt($("#days-select").value, 10);
  const btn = $("#btn-download");
  const status = $("#download-status");
  btn.disabled = true;
  status.textContent = "Preparing…";
  try {
    const res = await authedFetch(`/api/v1/entomology/report.xlsx?days=${days}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const blob = await res.blob();
    const disposition = res.headers.get("Content-Disposition") || "";
    const match = disposition.match(/filename="?([^"]+)"?/);
    const filename = match ? match[1] : "kindpos-bug-report.xlsx";
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    status.textContent = `Saved ${filename}`;
  } catch (err) {
    if (err.message === "session_expired") return;
    console.error("download error", err);
    status.textContent = "Download failed.";
  } finally {
    btn.disabled = false;
  }
}

async function logout() {
  try {
    await authedFetch("/api/v1/auth/logout", { method: "POST" });
  } catch (_) { /* ignore */ }
  clearToken();
  showPinScreen();
}

// ── Formatting helpers ───────────────────────────────
function fmtNum(v, suffix) {
  if (v === null || v === undefined || Number.isNaN(v)) return "—";
  if (typeof v !== "number") return String(v);
  return `${v.toFixed(1)}${suffix || ""}`;
}
function formatTime(d) {
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}
function formatTs(iso) {
  try {
    const d = new Date(iso);
    return d.toLocaleString();
  } catch { return iso; }
}
function escapeHtml(s) {
  if (s === null || s === undefined) return "";
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// ── Boot ─────────────────────────────────────────────
function boot() {
  wirePinPad();
  $("#btn-download").addEventListener("click", downloadReport);
  $("#btn-logout").addEventListener("click", logout);
  $("#days-select").addEventListener("change", refreshIssues);

  if (getToken()) {
    showDashboard();
  } else {
    showPinScreen();
  }
}

boot();
