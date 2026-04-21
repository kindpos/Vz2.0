/* ============================================
   KINDpos Overseer - System Testing Section
   Hardware → System Testing

   Executes the full pytest suite in real-time
   and displays output in a retro terminal.
   Proves "Dependable" during demos.

   Nice. Dependable. Yours.
   Every system tested. Every scenario validated.
   ============================================ */

// ─── CONFIGURATION ──────────────────────────────────────
// The Overseer UI is served by the same backend that exposes the API, so
// API calls are relative — no host/port hardcoding.

// ─── STATE ──────────────────────────────────────────────
let testStream = null;       // AbortController for fetch cancellation
let testStats = {
    passed: 0,
    failed: 0,
    skipped: 0,
    startTime: null,
    endTime: null
};

// ─── SCENE REGISTRATION ─────────────────────────────────

export function registerSystemTesting(sm) {

    sm.register('system-testing', {
        type: 'detail',
        title: 'System Testing',
        parent: 'hardware-subs',

        onEnter(container) {
            container.innerHTML = `
                <div class="detail-content" style="padding: 20px; max-width: 900px;">

                    <div style="margin-bottom: 24px;">
                        <h1 style="font-family: var(--font-display); color: var(--color-gold); font-size: 28px; margin-bottom: 4px;">
                            🧪 System Test Suite
                        </h1>
                        <p style="color: rgba(var(--color-mint-rgb), 0.5); font-size: 14px;">
                            Verify KINDpos core integrity
                        </p>
                    </div>

                    <div class="test-stats-row">
                        <div class="stat-card">
                            <div class="stat-label">Last Run</div>
                            <div class="stat-value" id="last-run-time">Never</div>
                        </div>
                        <div class="stat-card">
                            <div class="stat-label">Total Tests</div>
                            <div class="stat-value" id="total-tests">—</div>
                        </div>
                        <div class="stat-card">
                            <div class="stat-label">Status</div>
                            <div class="stat-value" id="test-status">Ready</div>
                        </div>
                    </div>

                    <div class="test-controls">
                        <button id="run-tests-btn" class="primary-btn">▶ Run All Tests</button>
                        <button id="clear-output-btn" class="secondary-btn">Clear Output</button>
                    </div>

                    <div class="terminal-container">
                        <div class="terminal-bar">
                            <span class="terminal-title">Terminal Output</span>
                            <button id="stop-tests-btn" class="terminal-stop" style="display: none;">■ Stop</button>
                        </div>
                        <div class="terminal-output" id="terminal-output">
                            <div class="terminal-prompt">$ Ready to run tests...</div>
                        </div>
                    </div>

                    <div class="test-summary" id="test-summary" style="display: none;">
                        <div class="summary-title">TEST SUMMARY</div>
                        <div class="summary-stats">
                            <span class="summary-passed">✓ Passed: <span id="passed-count">0</span></span>
                            <span class="summary-failed">✗ Failed: <span id="failed-count">0</span></span>
                            <span class="summary-skipped">⚠ Skipped: <span id="skipped-count">0</span></span>
                            <span class="summary-duration">⏱ Duration: <span id="test-duration">0s</span></span>
                        </div>
                    </div>

                </div>
            `;

            // Wire up event listeners
            container.querySelector('#run-tests-btn').addEventListener('click', runTestSuite);
            container.querySelector('#clear-output-btn').addEventListener('click', clearTerminal);
            container.querySelector('#stop-tests-btn').addEventListener('click', stopTestSuite);
        },

        onExit(container) {
            // Cleanup: abort any active fetch stream to prevent memory leaks
            if (testStream) {
                testStream.abort();
                testStream = null;
            }
            container.innerHTML = '';
        }
    });
}

// ─── MAIN EXECUTION ─────────────────────────────────────

/**
 * Run the full test suite via API and stream results to the terminal.
 *
 * Flow:
 *   1. Reset state and UI
 *   2. POST to /api/v1/system/run-tests on KINDpos backend
 *   3. Read SSE stream line by line via ReadableStream
 *   4. Parse each event and route to handler
 *   5. On complete or error, finalize UI
 */
async function runTestSuite() {
    const runBtn = document.getElementById('run-tests-btn');
    const stopBtn = document.getElementById('stop-tests-btn');
    const statusEl = document.getElementById('test-status');
    const terminal = document.getElementById('terminal-output');
    const summary = document.getElementById('test-summary');

    // Reset state
    testStats = { passed: 0, failed: 0, skipped: 0, startTime: Date.now(), endTime: null };
    summary.style.display = 'none';

    // Update UI to running state
    runBtn.disabled = true;
    runBtn.textContent = '⏳ Running Tests...';
    stopBtn.style.display = 'inline-block';
    statusEl.textContent = 'Running';
    statusEl.style.color = '#FFE66D';

    // Clear previous output and show the command prompt
    terminal.innerHTML = '<div class="terminal-prompt">$ pytest backend/tests/ -v --tb=short</div>';

    // Create AbortController for cancellation support
    const controller = new AbortController();
    testStream = controller;

    try {
        const response = await fetch(`/api/v1/system/run-tests`, {
            method: 'POST',
            signal: controller.signal
        });

        if (!response.ok) {
            throw new Error(`Server responded with ${response.status}: ${response.statusText}`);
        }

        // Read the SSE stream via ReadableStream
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            // Decode the chunk and add to buffer
            buffer += decoder.decode(value, { stream: true });

            // Process complete SSE messages (delimited by double newline)
            const messages = buffer.split('\n\n');
            // Keep the last incomplete chunk in the buffer
            buffer = messages.pop();

            for (const message of messages) {
                if (!message.trim()) continue;

                // Extract data from SSE format: "data: {...}"
                const dataLine = message.split('\n').find(line => line.startsWith('data: '));
                if (!dataLine) continue;

                try {
                    const data = JSON.parse(dataLine.substring(6));
                    handleSSEEvent(data);
                } catch (parseError) {
                    console.warn('Failed to parse SSE event:', parseError);
                }
            }
        }

        // Process any remaining buffer content
        if (buffer.trim()) {
            const dataLine = buffer.split('\n').find(line => line.startsWith('data: '));
            if (dataLine) {
                try {
                    const data = JSON.parse(dataLine.substring(6));
                    handleSSEEvent(data);
                } catch (parseError) {
                    console.warn('Failed to parse final SSE event:', parseError);
                }
            }
        }

    } catch (error) {
        if (error.name === 'AbortError') {
            // User clicked stop — handled by stopTestSuite()
            return;
        }
        console.error('Test stream error:', error);
        appendTerminalLine('', 'normal');

        // Provide helpful error messages
        if (error.message.includes('Failed to fetch') || error.message.includes('NetworkError')) {
            appendTerminalLine('ERROR: Cannot reach KINDpos backend', 'failed');
            appendTerminalLine('Make sure the backend server is running.', 'failed');
        } else {
            appendTerminalLine(`ERROR: ${error.message}`, 'failed');
        }
        handleTestComplete(1);
    }
}

// ─── SSE EVENT ROUTING ──────────────────────────────────

function handleSSEEvent(data) {
    switch (data.type) {
        case 'start':
            appendTerminalLine('===== test session starts =====', 'line-header');
            break;

        case 'output':
            appendTerminalLine(data.line, data.style);
            updateStatsFromLine(data.style);
            break;

        case 'complete':
            // Use server-provided counts (authoritative source of truth)
            if (data.passed !== undefined) testStats.passed = data.passed;
            if (data.failed !== undefined) testStats.failed = data.failed;
            if (data.skipped !== undefined) testStats.skipped = data.skipped;
            handleTestComplete(data.exit_code);
            break;
    }
}

// ─── TERMINAL OUTPUT ────────────────────────────────────

function appendTerminalLine(text, style = 'normal') {
    const terminal = document.getElementById('terminal-output');
    if (!terminal) return;

    const line = document.createElement('div');

    // Map 'header' from backend to 'line-header' to avoid CSS collision
    const cssStyle = (style === 'header') ? 'line-header' : style;
    line.className = `terminal-line terminal-${cssStyle}`;
    line.textContent = text;
    terminal.appendChild(line);

    // Auto-scroll to keep latest output visible
    terminal.scrollTop = terminal.scrollHeight;
}

// ─── STATS TRACKING ─────────────────────────────────────

function updateStatsFromLine(style) {
    if (style === 'passed') {
        testStats.passed++;
    } else if (style === 'failed') {
        testStats.failed++;
    } else if (style === 'skipped') {
        testStats.skipped++;
    } else {
        return;
    }
    updateSummaryDisplay();
}

function updateSummaryDisplay() {
    const passedEl = document.getElementById('passed-count');
    const failedEl = document.getElementById('failed-count');
    const skippedEl = document.getElementById('skipped-count');
    const durationEl = document.getElementById('test-duration');

    if (passedEl) passedEl.textContent = testStats.passed;
    if (failedEl) failedEl.textContent = testStats.failed;
    if (skippedEl) skippedEl.textContent = testStats.skipped;

    if (durationEl && testStats.startTime) {
        const elapsed = ((Date.now() - testStats.startTime) / 1000).toFixed(1);
        durationEl.textContent = elapsed + 's';
    }
}

// ─── COMPLETION ─────────────────────────────────────────

function handleTestComplete(exitCode) {
    const runBtn = document.getElementById('run-tests-btn');
    const stopBtn = document.getElementById('stop-tests-btn');
    const statusEl = document.getElementById('test-status');
    const summary = document.getElementById('test-summary');
    const lastRunEl = document.getElementById('last-run-time');
    const totalEl = document.getElementById('total-tests');

    // Cleanup stream reference
    testStream = null;

    // Calculate duration
    testStats.endTime = Date.now();
    const duration = ((testStats.endTime - testStats.startTime) / 1000).toFixed(1);

    // Restore button states
    if (runBtn) {
        runBtn.disabled = false;
        runBtn.textContent = '▶ Run All Tests';
    }
    if (stopBtn) stopBtn.style.display = 'none';

    // Update status indicator
    if (statusEl) {
        if (exitCode === 0) {
            statusEl.textContent = 'All Passed ✓';
            statusEl.style.color = 'var(--color-mint)';
            appendTerminalLine('', 'normal');
            appendTerminalLine(`✓ All tests passed in ${duration}s`, 'passed');
        } else if (exitCode === 130) {
            statusEl.textContent = 'Stopped';
            statusEl.style.color = '#FFE66D';
        } else {
            statusEl.textContent = 'Failed ✗';
            statusEl.style.color = '#FF6B6B';
            appendTerminalLine('', 'normal');
            appendTerminalLine(`✗ Some tests failed (exit code ${exitCode})`, 'failed');
        }
    }

    // Update total tests count
    const total = testStats.passed + testStats.failed + testStats.skipped;
    if (totalEl && total > 0) totalEl.textContent = total;

    // Show summary panel
    if (summary) {
        summary.style.display = 'block';
        updateSummaryDisplay();
    }

    // Update last run timestamp
    if (lastRunEl) lastRunEl.textContent = new Date().toLocaleTimeString();
}

// ─── CONTROLS ───────────────────────────────────────────

function stopTestSuite() {
    if (testStream) {
        testStream.abort();
        testStream = null;
    }
    appendTerminalLine('', 'normal');
    appendTerminalLine('⚠ Tests stopped by user', 'skipped');
    handleTestComplete(130);
}

function clearTerminal() {
    const terminal = document.getElementById('terminal-output');
    if (terminal) terminal.innerHTML = '<div class="terminal-prompt">$ Ready to run tests...</div>';

    const summary = document.getElementById('test-summary');
    if (summary) summary.style.display = 'none';
}