/* ============================================
   KINDpos Overseer - Printer Configuration
   Hardware → Printer Configuration

   Discovers ESC/POS printers on the local network
   via SSE streaming and sends test prints to verify.
   Zero cloud dependency — pure local network.

   Nice. Dependable. Yours.
   Every printer found. Every device verified.
   ============================================ */

// ─── CONFIGURATION ──────────────────────────────────────
// The Overseer UI is served by the same backend that hosts the API, so
// API calls are relative — no host/port hardcoding.

// ─── STATE ──────────────────────────────────────────────
let scanStream = null;          // AbortController for fetch cancellation
let discoveredPrinters = [];    // Array of printer data from scan

// ─── SCENE REGISTRATION ─────────────────────────────────

export function registerPrinterConfig(sm) {

    sm.register('printer-config', {
        type: 'detail',
        title: 'Printer Configuration',
        parent: 'hardware-subs',

        onEnter(container) {
            discoveredPrinters = [];

            container.innerHTML = `
                <div class="detail-content" style="padding: 20px; max-width: 900px;">

                    <div style="margin-bottom: 24px;">
                        <h1 style="font-family: var(--font-display); color: var(--color-gold); font-size: 32px; margin-bottom: 4px;">
                            🖨️ Printer Discovery
                        </h1>
                        <p style="color: rgba(var(--color-mint-rgb), 0.5); font-size: 25px;">
                            Scan your network for ESC/POS printers
                        </p>
                    </div>

                    <div class="test-stats-row">
                        <div class="stat-card">
                            <div class="stat-label">Printers Found</div>
                            <div class="stat-value" id="printers-found">—</div>
                        </div>
                        <div class="stat-card">
                            <div class="stat-label">Scan Time</div>
                            <div class="stat-value" id="scan-duration">—</div>
                        </div>
                        <div class="stat-card">
                            <div class="stat-label">Status</div>
                            <div class="stat-value" id="scan-status">Ready</div>
                        </div>
                    </div>

                    <div class="test-controls">
                        <div style="display: flex; align-items: center; gap: 12px; flex-wrap: wrap;">
                            <label style="color: rgba(var(--color-mint-rgb), 0.7); font-family: var(--font-mono); font-size: 25px;">
                                Subnet:
                            </label>
                            <input type="text" id="subnet-input" value="10.0.0.0/24"
                                style="background: rgba(var(--color-mint-rgb), 0.08);
                                       border: 1px solid rgba(var(--color-mint-rgb), 0.2);
                                       color: var(--color-mint);
                                       font-family: var(--font-mono);
                                       font-size: 25px;
                                       padding: 8px 12px;
                                       border-radius: 6px;
                                       width: 180px;
                                       outline: none;" />
                            <button id="scan-btn" class="primary-btn">🔍 Scan Network</button>
                            <button id="stop-scan-btn" class="secondary-btn" style="display: none;">■ Stop</button>
                        </div>
                    </div>

                    <div class="terminal-container">
                        <div class="terminal-bar">
                            <span class="terminal-title">Scan Output</span>
                        </div>
                        <div class="terminal-output" id="scan-output" style="min-height: 60px; max-height: 150px;">
                            <div class="terminal-prompt">$ Ready to scan...</div>
                        </div>
                    </div>

                    <div id="printer-cards" style="margin-top: 20px; display: flex; flex-direction: column; gap: 12px;">
                    </div>

                </div>
            `;

            // Wire up event listeners
            container.querySelector('#scan-btn').addEventListener('click', startScan);
            container.querySelector('#stop-scan-btn').addEventListener('click', stopScan);
        },

        onExit(container) {
            if (scanStream) {
                scanStream.abort();
                scanStream = null;
            }
            container.innerHTML = '';
        }
    });
}

// ─── SCAN EXECUTION ─────────────────────────────────────

async function startScan() {
    const scanBtn = document.getElementById('scan-btn');
    const stopBtn = document.getElementById('stop-scan-btn');
    const statusEl = document.getElementById('scan-status');
    const output = document.getElementById('scan-output');
    const cardsEl = document.getElementById('printer-cards');
    const subnet = document.getElementById('subnet-input').value.trim();

    // Reset state
    discoveredPrinters = [];
    if (cardsEl) cardsEl.innerHTML = '';

    // Update UI to scanning state
    scanBtn.disabled = true;
    scanBtn.textContent = '⏳ Scanning...';
    stopBtn.style.display = 'inline-block';
    statusEl.textContent = 'Scanning';
    statusEl.style.color = '#FFE66D';

    output.innerHTML = `<div class="terminal-prompt">$ scan --network ${subnet} --ports 9100,515,631</div>`;

    // Create AbortController for cancellation
    const controller = new AbortController();
    scanStream = controller;

    try {
        const response = await fetch(`/api/v1/hardware/discover-printers`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ network: subnet }),
            signal: controller.signal
        });

        if (!response.ok) {
            throw new Error(`Server responded with ${response.status}: ${response.statusText}`);
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });

            const messages = buffer.split('\n\n');
            buffer = messages.pop();

            for (const message of messages) {
                if (!message.trim()) continue;

                const dataLine = message.split('\n').find(line => line.startsWith('data: '));
                if (!dataLine) continue;

                try {
                    const data = JSON.parse(dataLine.substring(6));
                    handleScanEvent(data);
                } catch (parseError) {
                    console.warn('Failed to parse SSE event:', parseError);
                }
            }
        }

        // Process any remaining buffer
        if (buffer.trim()) {
            const dataLine = buffer.split('\n').find(line => line.startsWith('data: '));
            if (dataLine) {
                try {
                    const data = JSON.parse(dataLine.substring(6));
                    handleScanEvent(data);
                } catch (parseError) {
                    console.warn('Failed to parse final SSE event:', parseError);
                }
            }
        }

    } catch (error) {
        if (error.name === 'AbortError') return;

        console.error('Scan stream error:', error);
        appendScanLine('', 'normal');

        if (error.message.includes('Failed to fetch') || error.message.includes('NetworkError')) {
            appendScanLine('ERROR: Cannot reach backend', 'failed');
            appendScanLine('Make sure the KINDpos server is running.', 'failed');
        } else {
            appendScanLine(`ERROR: ${error.message}`, 'failed');
        }
        handleScanComplete(null);
    }
}

// ─── SSE EVENT ROUTING ──────────────────────────────────

function handleScanEvent(data) {
    switch (data.type) {
        case 'scan_start':
            appendScanLine(`Scan started: ${data.network} (${data.methods.join(', ')})`, 'line-header');
            appendScanLine(`Session: ${data.scan_id}`, 'meta');
            break;

        case 'progress':
            appendScanLine(data.message, data.style === 'warning' ? 'skipped' : 'normal');
            break;

        case 'host_found':
            appendScanLine(
                `✓ FOUND: ${data.ip} — ${data.manufacturer || 'Unknown'} ` +
                `(MAC: ${data.mac}, port ${data.ports.join(',')}, ${data.response_ms}ms)`,
                'passed'
            );
            updatePrintersFound();
            break;

        case 'printer_config':
            discoveredPrinters.push(data);
            renderPrinterCard(data);
            break;

        case 'error':
            appendScanLine(`ERROR: ${data.message}`, 'failed');
            break;

        case 'scan_complete':
            handleScanComplete(data);
            break;
    }
}

// ─── TERMINAL OUTPUT ────────────────────────────────────

function appendScanLine(text, style = 'normal') {
    const output = document.getElementById('scan-output');
    if (!output) return;

    const line = document.createElement('div');
    const cssStyle = (style === 'header') ? 'line-header' : style;
    line.className = `terminal-line terminal-${cssStyle}`;
    line.textContent = text;
    output.appendChild(line);

    output.scrollTop = output.scrollHeight;
}

// ─── PRINTER CARDS ──────────────────────────────────────

function renderPrinterCard(printer) {
    const cardsEl = document.getElementById('printer-cards');
    if (!cardsEl) return;

    const meta = printer._discovery_metadata || {};
    const cardId = `printer-card-${meta.ip_address || 'unknown'}`.replace(/\./g, '-');

    const card = document.createElement('div');
    card.id = cardId;
    card.style.cssText = `
        background: rgba(var(--color-mint-rgb), 0.06);
        border: 1px solid rgba(var(--color-mint-rgb), 0.2);
        border-radius: 8px;
        padding: 16px 20px;
        transition: border-color 0.2s;
    `;

    const ip = meta.ip_address || 'Unknown';
    const mac = meta.mac_address || 'Unknown';
    const mfg = meta.manufacturer || 'Unknown Manufacturer';
    const model = meta.model || '—';
    const port = printer.connection_string ? printer.connection_string.split(':').pop() : '9100';
    const role = printer.role || 'receipt';

    card.innerHTML = `
        <div style="display: flex; justify-content: space-between; align-items: flex-start; flex-wrap: wrap; gap: 12px;">
            <div style="flex: 1; min-width: 200px;">
                <div style="font-family: var(--font-display); color: var(--color-gold); font-size: 35px; margin-bottom: 6px;">
                    🖨️ ${mfg}
                </div>
                <div style="font-family: var(--font-mono); color: rgba(var(--color-mint-rgb), 0.7); font-size: 25px; line-height: 1.8;">
                    <div><span style="color: rgba(var(--color-mint-rgb),0.4);">IP:</span>    ${ip}</div>
                    <div><span style="color: rgba(var(--color-mint-rgb),0.4);">MAC:</span>   ${mac}</div>
                    <div><span style="color: rgba(var(--color-mint-rgb),0.4);">Port:</span>  ${port}</div>
                    <div><span style="color: rgba(var(--color-mint-rgb),0.4);">Model:</span> ${model}</div>
                    <div><span style="color: rgba(var(--color-mint-rgb),0.4);">Role:</span>  ${role}</div>
                </div>
            </div>
            <div style="display: flex; flex-direction: column; gap: 8px; align-items: flex-end;">
                <button class="primary-btn test-print-btn"
                        data-ip="${ip}" data-port="${port}"
                        style="font-size: 25px; padding: 8px 16px;">
                    🖨️ Test Print
                </button>
                <div class="print-result" id="print-result-${ip.replace(/\./g, '-')}"
                     style="font-family: var(--font-mono); font-size: 25px; min-height: 18px;">
                </div>
            </div>
        </div>
    `;

    // Wire up test print button
    card.querySelector('.test-print-btn').addEventListener('click', (e) => {
        const btnIp = e.currentTarget.dataset.ip;
        const btnPort = parseInt(e.currentTarget.dataset.port);
        sendTestPrint(btnIp, btnPort, e.currentTarget);
    });

    cardsEl.appendChild(card);
}

// ─── TEST PRINT ─────────────────────────────────────────

async function sendTestPrint(ip, port, btn) {
    const resultId = `print-result-${ip.replace(/\./g, '-')}`;
    const resultEl = document.getElementById(resultId);

    // Update button state
    btn.disabled = true;
    btn.textContent = '⏳ Printing...';
    if (resultEl) {
        resultEl.textContent = '';
        resultEl.style.color = '';
    }

    try {
        const response = await fetch(`/api/v1/hardware/test-print`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ip, port })
        });

        const result = await response.json();

        if (result.success) {
            btn.textContent = '✓ Print Sent!';
            btn.style.borderColor = 'var(--color-mint)';
            if (resultEl) {
                resultEl.textContent = 'Receipt printed successfully';
                resultEl.style.color = 'var(--color-mint)';
            }
        } else {
            btn.textContent = '✗ Failed';
            btn.style.borderColor = '#FF6B6B';
            if (resultEl) {
                resultEl.textContent = result.message;
                resultEl.style.color = '#FF6B6B';
            }
        }
    } catch (error) {
        btn.textContent = '✗ Error';
        btn.style.borderColor = '#FF6B6B';
        if (resultEl) {
            resultEl.textContent = `Network error: ${error.message}`;
            resultEl.style.color = '#FF6B6B';
        }
    }

    // Reset button after 3 seconds
    setTimeout(() => {
        btn.disabled = false;
        btn.textContent = '🖨️ Test Print';
        btn.style.borderColor = '';
    }, 3000);
}

// ─── COMPLETION ─────────────────────────────────────────

function handleScanComplete(data) {
    const scanBtn = document.getElementById('scan-btn');
    const stopBtn = document.getElementById('stop-scan-btn');
    const statusEl = document.getElementById('scan-status');
    const durationEl = document.getElementById('scan-duration');

    scanStream = null;

    if (scanBtn) {
        scanBtn.disabled = false;
        scanBtn.textContent = '🔍 Scan Network';
    }
    if (stopBtn) stopBtn.style.display = 'none';

    if (data) {
        if (statusEl) {
            statusEl.textContent = data.printers_found > 0 ? 'Complete ✓' : 'No Printers';
            statusEl.style.color = data.printers_found > 0 ? 'var(--color-mint)' : '#FFE66D';
        }
        if (durationEl) durationEl.textContent = data.duration_seconds + 's';

        appendScanLine('', 'normal');
        appendScanLine(
            `Scan complete — ${data.printers_found} printer(s) found in ${data.duration_seconds}s`,
            data.printers_found > 0 ? 'passed' : 'skipped'
        );
    } else {
        if (statusEl) {
            statusEl.textContent = 'Error';
            statusEl.style.color = '#FF6B6B';
        }
    }
}

function updatePrintersFound() {
    const el = document.getElementById('printers-found');
    if (el) {
        el.textContent = discoveredPrinters.length || '...';
    }
}


// ─── CONTROLS ───────────────────────────────────────────

function stopScan() {
    if (scanStream) {
        scanStream.abort();
        scanStream = null;
    }
    appendScanLine('', 'normal');
    appendScanLine('⚠ Scan stopped by user', 'skipped');
    handleScanComplete(null);
}