/* ============================================
   KINDpos Overseer - Test Print Utility
   Handles test print requests: single printer
   and bulk "Test All" operations.

   Wired to: POST /api/v1/hardware/test-print
   Sends real ESC/POS test receipts over TCP
   via the backend socket handler.

   "Dependable." — Know your printers work
   before the dinner rush.
   ============================================ */

export class TestPrintManager {

    constructor() {
        this.isTesting = false;
        this.testQueue = [];

        // Callbacks
        this.onTestStart = null;   // (printerId)
        this.onTestResult = null;  // (printerId, success, timestamp, message)
        this.onBulkComplete = null; // (results[])
    }

    /* ------------------------------------------
       SINGLE TEST
    ------------------------------------------ */

    async testPrinter(printer) {
        if (!printer) return;

        const printerId = printer.id;

        // Notify UI that test is starting
        if (this.onTestStart) this.onTestStart(printerId);

        try {
            const result = await this._sendTestPrint(printer);

            if (this.onTestResult) {
                this.onTestResult(
                    printerId,
                    result.success,
                    result.timestamp || new Date().toISOString(),
                    result.message
                );
            }

            return result;

        } catch (error) {
            console.error(`[TestPrint] Error testing ${printerId}:`, error);

            if (this.onTestResult) {
                this.onTestResult(
                    printerId,
                    false,
                    new Date().toISOString(),
                    error.message || 'Unknown error'
                );
            }

            return {
                success: false,
                timestamp: new Date().toISOString(),
                message: error.message || 'Unknown error'
            };
        }
    }

    /* ------------------------------------------
       BULK TEST (Test All)
    ------------------------------------------ */

    async testAll(printers) {
        const onlinePrinters = printers.filter(p => p.status === 'online');
        if (onlinePrinters.length === 0) {
            if (this.onBulkComplete) this.onBulkComplete([]);
            return [];
        }

        this.isTesting = true;
        const results = [];

        for (let i = 0; i < onlinePrinters.length; i++) {
            const printer = onlinePrinters[i];
            const result = await this.testPrinter(printer);
            results.push({
                printerId: printer.id,
                model: printer.model,
                ...result
            });

            // Brief pause between prints to avoid overwhelming
            if (i < onlinePrinters.length - 1) {
                await this._delay(500);
            }
        }

        this.isTesting = false;
        if (this.onBulkComplete) this.onBulkComplete(results);
        return results;
    }

    /* ------------------------------------------
       PRIVATE: SEND TEST PRINT (REAL BACKEND)
    ------------------------------------------ */

    async _sendTestPrint(printer) {
        if (!printer.ip_address) {
            return {
                success: false,
                message: 'No IP address configured'
            };
        }

        console.log(`[TestPrint] Sending test print to ${printer.model} (${printer.ip_address}:${printer.port || 9100})`);

        const response = await fetch('/api/v1/hardware/test-print', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                ip: printer.ip_address,
                port: printer.port || 9100
            })
        });

        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        const result = await response.json();

        if (result.success) {
            console.log(`[TestPrint] ✓ ${result.message}`);
        } else {
            console.warn(`[TestPrint] ✗ ${result.message}`);
        }

        return result;
    }

    /* ------------------------------------------
       HELPERS
    ------------------------------------------ */

    _delay(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    /* ------------------------------------------
       CLEANUP
    ------------------------------------------ */

    destroy() {
        this.isTesting = false;
        this.testQueue = [];
        this.onTestStart = null;
        this.onTestResult = null;
        this.onBulkComplete = null;
    }
}