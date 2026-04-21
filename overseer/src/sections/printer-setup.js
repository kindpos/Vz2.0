/* ============================================
   KINDpos Overseer - Printer Setup Scene
   Main orchestrator for the Hardware > Printer
   Configuration detail screen.

   Navigation: Dashboard → Hardware → Printer Configuration
   Scene ID: 'printer-config'
   Parent: 'hardware-subs'

   LIVE BACKEND INTEGRATION:
   - Scan: POST /api/v1/hardware/discover-printers (SSE)
   - Test: POST /api/v1/hardware/test-print

   "Nice. Dependable. Yours."
   ============================================ */

import { SAMPLE_NETWORK, ROLE_COLORS, STATUS_COLORS } from '../data/sample-printers.js';
import { TopologyMap } from './printer-setup/topology-map.js';
import { DeviceTable } from './printer-setup/device-table.js';
import { ConfigModal } from './printer-setup/config-modal.js';
import { AddManualModal } from './printer-setup/add-manual-modal.js';
import { TestPrintManager } from './printer-setup/test-print.js';

export function registerPrinterSetup(sceneManager) {

    let printers = [];
    let network = {};
    let scanning = false;
    let statusPollInterval = null;

    let topologyMap = null;
    let deviceTable = null;
    let configModal = null;
    let addManualModal = null;
    let testPrintManager = null;

    sceneManager.register('printer-config', {
        type: 'detail',
        title: 'Printer Setup',
        parent: 'hardware-subs',

        onEnter(container) {
            printers = [];
            network = JSON.parse(JSON.stringify(SAMPLE_NETWORK));
            container.innerHTML = buildSceneHTML(printers);
            initComponents(container);
            startStatusPolling();
            console.log('[PrinterSetup] Scene activated — ready to scan');
        },

        onExit(container) {
            stopStatusPolling();
            destroyComponents();
            container.innerHTML = '';
            console.log('[PrinterSetup] Scene deactivated');
        }
    });

    /* ------------------------------------------
       SCENE HTML
    ------------------------------------------ */

    function buildSceneHTML(printerList) {
        const onlineCount = printerList.filter(p => p.status === 'online').length;
        const offlineCount = printerList.filter(p => p.status === 'offline').length;

        return `
            <div class="printer-setup-scene">
                <div class="topology-section">
                    <div class="section-header">
                        <h2>Network Topology</h2>
                        <div class="topology-actions">
                            <button id="scan-network-btn" class="btn-primary">
                                \uD83D\uDD0D Scan Network
                            </button>
                            <button id="add-manual-btn" class="btn-secondary">
                                + Add Manually
                            </button>
                        </div>
                    </div>
                    <div id="topology-map-container">
                        <svg id="topology-svg"></svg>
                    </div>
                    <div id="scan-progress-area"></div>
                </div>

                <div class="device-list-section">
                    <div class="section-header">
                        <h2>Discovered Printers</h2>
                        <div class="device-stats">
                            <span class="stat" id="stat-total">
                                Total: <strong>${printerList.length}</strong>
                            </span>
                            <span class="stat online" id="stat-online">
                                Online: <strong>${onlineCount}</strong>
                            </span>
                            <span class="stat offline" id="stat-offline">
                                Offline: <strong>${offlineCount}</strong>
                            </span>
                            <button id="test-all-btn" class="btn-test-all"
                                    ${onlineCount === 0 ? 'disabled' : ''}>
                                Test All
                            </button>
                        </div>
                    </div>
                    <div id="device-table-container"></div>
                </div>
            </div>
        `;
    }

    /* ------------------------------------------
       COMPONENT INITIALIZATION
    ------------------------------------------ */

    function initComponents(container) {
        topologyMap = new TopologyMap(printers, network);
        const svgEl = container.querySelector('#topology-svg');
        if (svgEl) {
            topologyMap.render(svgEl);
            topologyMap.onPrinterClick = openConfigModal;
        }

        deviceTable = new DeviceTable(printers);
        const tableContainer = container.querySelector('#device-table-container');
        if (tableContainer) {
            deviceTable.render(tableContainer);
            deviceTable.onConfigClick = openConfigModal;
            deviceTable.onTestClick = testSinglePrinter;
        }

        configModal = new ConfigModal();
        configModal.onSave = handlePrinterSave;
        configModal.onRemove = handlePrinterRemove;
        configModal.onTestPrint = testSinglePrinter;

        addManualModal = new AddManualModal();
        addManualModal.onAdd = handlePrinterAdd;

        testPrintManager = new TestPrintManager();
        testPrintManager.onTestStart = handleTestStart;
        testPrintManager.onTestResult = handleTestResult;
        testPrintManager.onBulkComplete = handleBulkTestComplete;

        container.querySelector('#scan-network-btn')?.addEventListener('click', scanNetwork);
        container.querySelector('#add-manual-btn')?.addEventListener('click', () => addManualModal.open());
        container.querySelector('#test-all-btn')?.addEventListener('click', testAllPrinters);
    }

    function destroyComponents() {
        if (topologyMap) { topologyMap.destroy(); topologyMap = null; }
        if (deviceTable) { deviceTable.destroy(); deviceTable = null; }
        if (configModal) { configModal.destroy(); configModal = null; }
        if (addManualModal) { addManualModal.destroy(); addManualModal = null; }
        if (testPrintManager) { testPrintManager.destroy(); testPrintManager = null; }
    }

    /* ------------------------------------------
       SCAN NETWORK (REAL BACKEND SSE)
       POST /api/v1/hardware/discover-printers
    ------------------------------------------ */

    async function scanNetwork() {
        if (scanning) return;
        scanning = true;

        const scanBtn = document.querySelector('#scan-network-btn');
        const progressArea = document.querySelector('#scan-progress-area');

        if (scanBtn) {
            scanBtn.disabled = true;
            scanBtn.textContent = 'Scanning\u2026';
        }

        if (progressArea) {
            progressArea.innerHTML = `
                <div class="scan-progress">
                    <span class="spinner"></span>
                    <span id="scan-status-text">Initiating network scan\u2026</span>
                </div>
            `;
        }

        printers = [];
        refreshDisplay();

        try {
            const response = await fetch('/api/v1/hardware/discover-printers', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({})
            });

            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }

            const reader = response.body.getReader();
            const decoder = new TextDecoder();
            let buffer = '';

            while (true) {
                const { done, value } = await reader.read();
                if (done) break;

                buffer += decoder.decode(value, { stream: true });

                const events = buffer.split('\n\n');
                buffer = events.pop();

                for (const eventStr of events) {
                    const dataLine = eventStr.trim();
                    if (!dataLine.startsWith('data: ')) continue;

                    try {
                        const event = JSON.parse(dataLine.substring(6));
                        handleScanEvent(event);
                    } catch (parseErr) {
                        console.warn('[Scan] Failed to parse SSE event:', dataLine);
                    }
                }
            }

        } catch (error) {
            console.error('[Scan] Network scan failed:', error);
            const statusText = document.querySelector('#scan-status-text');
            if (statusText) {
                statusText.textContent = `Scan failed: ${error.message}`;
                statusText.style.color = '#FF4444';
            }
        }

        scanning = false;
        if (scanBtn) {
            scanBtn.disabled = false;
            scanBtn.textContent = '\uD83D\uDD0D Scan Network';
        }
    }

    function handleScanEvent(event) {
        const statusText = document.querySelector('#scan-status-text');
        const progressArea = document.querySelector('#scan-progress-area');

        switch (event.type) {

            case 'scan_start':
                console.log(`[Scan] Started: network=${event.network}, methods=${event.methods}`);
                if (statusText) {
                    statusText.textContent = `Scanning ${event.network}\u2026`;
                }
                if (event.network) {
                    const subnet = event.network;
                    const gateway = subnet.replace(/\.\d+\/\d+$/, '.1');
                    network.gateway = { ip: gateway, mac: '', manufacturer: '' };
                    network.subnet = subnet;
                }
                break;

            case 'progress':
                console.log(`[Scan] ${event.message}`);
                if (statusText) {
                    statusText.textContent = event.message;
                }
                break;

            case 'host_found':
                console.log(`[Scan] Host found: ${event.ip} (${event.mac || 'no MAC'}) ports: ${event.ports?.join(', ')}`);
                if (statusText) {
                    statusText.textContent = `Found device at ${event.ip}\u2026`;
                }
                break;

            case 'printer_config': {
                // ============================================
                // BACKEND FIELD MAPPING
                // Backend sends:
                //   printer_id, name, printer_type, role,
                //   connection_string: "tcp://IP:PORT",
                //   location_tag, discovered_via,
                //   _discovery_metadata: { ip_address, mac_address,
                //     manufacturer, model, discovered_at, scan_id }
                // ============================================
                const meta = event._discovery_metadata || {};
                const connMatch = (event.connection_string || '').match(/tcp:\/\/([^:]+):(\d+)/);
                const ip = meta.ip_address || (connMatch ? connMatch[1] : '');
                const port = connMatch ? parseInt(connMatch[2], 10) : 9100;

                console.log(`[Scan] Printer ready: ${meta.manufacturer || 'Unknown'} at ${ip}`);

                const newPrinter = {
                    id: event.printer_id || `printer_${Date.now()}`,
                    model: meta.model || meta.manufacturer || event.name || 'Unknown Printer',
                    manufacturer: meta.manufacturer || '',
                    connection_type: 'network',
                    ip_address: ip,
                    mac_address: meta.mac_address || '',
                    port: port,
                    role: event.role || 'unassigned',
                    location: event.location_tag || '',
                    status: 'online',
                    settings: {
                        auto_cut: true,
                        paper_width: '80mm',
                        print_speed: 'normal'
                    },
                    capabilities: { printer_type: event.printer_type || 'thermal' },
                    last_test: null,
                    last_seen: meta.discovered_at || new Date().toISOString(),
                    created_at: meta.discovered_at || new Date().toISOString(),
                    uptime_days: 0,
                    hostname: '',
                    response_ms: null,
                    discovered_via: event.discovered_via || '',
                    scan_id: meta.scan_id || ''
                };

                // Deduplicate by MAC or IP
                const existingIdx = printers.findIndex(p =>
                    (newPrinter.mac_address && p.mac_address === newPrinter.mac_address) ||
                    (newPrinter.ip_address && p.ip_address === newPrinter.ip_address)
                );
                if (existingIdx >= 0) {
                    printers[existingIdx] = newPrinter;
                } else {
                    printers.push(newPrinter);
                }

                refreshDisplay();
                break;
            }

            case 'scan_complete':
                console.log(`[Scan] Complete: ${event.printers_found} printers found in ${event.duration_seconds}s`);
                if (progressArea) {
                    progressArea.innerHTML = `
                        <div class="scan-progress" style="color: #00FF88;">
                            \u2713 Scan complete. Found ${printers.length} printer${printers.length !== 1 ? 's' : ''} in ${event.duration_seconds?.toFixed(1) || '?'}s
                        </div>
                    `;
                    setTimeout(() => {
                        if (progressArea) progressArea.innerHTML = '';
                    }, 5000);
                }
                refreshDisplay();
                break;

            case 'error':
                console.error(`[Scan] Error: ${event.message}`);
                if (statusText) {
                    statusText.textContent = `Error: ${event.message}`;
                    statusText.style.color = '#FF4444';
                }
                break;

            default:
                console.log(`[Scan] Unknown event type: ${event.type}`, event);
        }
    }

    /* ------------------------------------------
       CONFIG MODAL
    ------------------------------------------ */

    function openConfigModal(printerId) {
        const printer = printers.find(p => p.id === printerId);
        if (!printer) {
            console.warn('[PrinterSetup] Printer not found:', printerId);
            return;
        }
        configModal.open(printer);
    }

    function handlePrinterSave(updatedPrinter) {
        const index = printers.findIndex(p => p.id === updatedPrinter.id);
        if (index !== -1) {
            printers[index] = { ...printers[index], ...updatedPrinter };
        }
        console.log('[PrinterSetup] Event: hardware.printer_configured', {
            printer_id: updatedPrinter.id,
            role: updatedPrinter.role,
            location: updatedPrinter.location,
            settings: updatedPrinter.settings
        });
        refreshDisplay();
    }

    function handlePrinterRemove(printerId) {
        printers = printers.filter(p => p.id !== printerId);
        console.log('[PrinterSetup] Event: hardware.printer_removed', { printer_id: printerId });
        refreshDisplay();
    }

    /* ------------------------------------------
       ADD PRINTER
    ------------------------------------------ */

    function handlePrinterAdd(newPrinter) {
        printers.push(newPrinter);
        console.log('[PrinterSetup] Event: hardware.printer_added', {
            printer_id: newPrinter.id,
            ip_address: newPrinter.ip_address,
            model: newPrinter.model
        });
        refreshDisplay();
    }

    /* ------------------------------------------
       TEST PRINT (REAL BACKEND)
    ------------------------------------------ */

    function testSinglePrinter(printerId) {
        const printer = printers.find(p => p.id === printerId);
        if (!printer || !testPrintManager) return;
        testPrintManager.testPrinter(printer);
    }

    function testAllPrinters() {
        if (!testPrintManager) return;
        const testAllBtn = document.querySelector('#test-all-btn');
        if (testAllBtn) {
            testAllBtn.disabled = true;
            testAllBtn.textContent = 'Testing\u2026';
        }
        testPrintManager.testAll(printers);
    }

    function handleTestStart(printerId) {
        if (deviceTable) deviceTable.updateTestStatus(printerId, 'testing');
    }

    function handleTestResult(printerId, success, timestamp, message) {
        const printer = printers.find(p => p.id === printerId);
        if (printer) {
            printer.last_test = timestamp;
        }
        if (deviceTable) {
            deviceTable.updateTestStatus(
                printerId,
                success ? 'success' : 'failed',
                timestamp
            );
        }
        console.log('[PrinterSetup] Event: hardware.printer_tested', {
            printer_id: printerId,
            success,
            timestamp,
            message
        });
    }

    function handleBulkTestComplete(results) {
        const testAllBtn = document.querySelector('#test-all-btn');
        if (testAllBtn) {
            const successCount = results.filter(r => r.success).length;
            testAllBtn.textContent = `\u2713 ${successCount}/${results.length} passed`;
            testAllBtn.disabled = false;
            setTimeout(() => {
                testAllBtn.textContent = 'Test All';
            }, 3000);
        }
    }

    /* ------------------------------------------
       STATUS POLLING
    ------------------------------------------ */

    function startStatusPolling() {
        statusPollInterval = setInterval(() => {
            // Future: periodic status check
        }, 30000);
    }

    function stopStatusPolling() {
        if (statusPollInterval) {
            clearInterval(statusPollInterval);
            statusPollInterval = null;
        }
    }

    /* ------------------------------------------
       DISPLAY REFRESH
    ------------------------------------------ */

    function refreshDisplay() {
        const svgEl = document.querySelector('#topology-svg');
        if (topologyMap && svgEl) {
            topologyMap.updatePrinters(printers);
        }
        if (deviceTable) {
            deviceTable.updatePrinters(printers);
            deviceTable.onConfigClick = openConfigModal;
            deviceTable.onTestClick = testSinglePrinter;
        }
        updateStats();
    }

    function updateStats() {
        const total = printers.length;
        const online = printers.filter(p => p.status === 'online').length;
        const offline = printers.filter(p => p.status === 'offline').length;

        const totalEl = document.querySelector('#stat-total');
        const onlineEl = document.querySelector('#stat-online');
        const offlineEl = document.querySelector('#stat-offline');
        const testAllBtn = document.querySelector('#test-all-btn');

        if (totalEl) totalEl.innerHTML = `Total: <strong>${total}</strong>`;
        if (onlineEl) onlineEl.innerHTML = `Online: <strong>${online}</strong>`;
        if (offlineEl) offlineEl.innerHTML = `Offline: <strong>${offline}</strong>`;
        if (testAllBtn) testAllBtn.disabled = online === 0;
    }
}