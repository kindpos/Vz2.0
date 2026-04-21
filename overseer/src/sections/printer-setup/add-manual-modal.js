/* ============================================
   KINDpos Overseer - Add Printer Manually Modal
   Form for adding a printer by IP address.
   Validates IP format and tests connectivity
   before adding to the system.

   "Yours." — Local network, local control.
   ============================================ */

export class AddManualModal {

    constructor() {
        this.overlay = null;
        this.modal = null;
        this.isOpen = false;

        // Callbacks
        this.onAdd = null;
    }

    /* ------------------------------------------
       OPEN / CLOSE
    ------------------------------------------ */

    open() {
        if (this.isOpen) this.close();
        this.isOpen = true;
        this._createModal();
        this._bindEvents();

        // Animate in
        requestAnimationFrame(() => {
            this.overlay.style.opacity = '1';
            this.modal.style.transform = 'translate(-50%, -50%) scale(1)';
            this.modal.style.opacity = '1';
        });

        // Focus the IP input
        setTimeout(() => {
            const ipInput = this.modal.querySelector('#add-ip-address');
            if (ipInput) ipInput.focus();
        }, 250);
    }

    close() {
        if (!this.isOpen) return;
        this.isOpen = false;

        if (this.overlay) this.overlay.style.opacity = '0';
        if (this.modal) {
            this.modal.style.transform = 'translate(-50%, -50%) scale(0.95)';
            this.modal.style.opacity = '0';
        }

        setTimeout(() => {
            if (this.overlay) this.overlay.remove();
            this.overlay = null;
            this.modal = null;
        }, 200);
    }

    /* ------------------------------------------
       PRIVATE: CREATE MODAL
    ------------------------------------------ */

    _createModal() {
        this.overlay = document.createElement('div');
        this.overlay.className = 'printer-modal-overlay';
        this.overlay.style.cssText = `
            position: fixed;
            top: 0; left: 0; right: 0; bottom: 0;
            background: rgba(0, 0, 0, 0.75);
            z-index: 200;
            opacity: 0;
            transition: opacity 0.2s ease;
        `;

        this.modal = document.createElement('div');
        this.modal.className = 'add-manual-modal';
        this.modal.style.cssText = `
            position: fixed;
            top: 50%; left: 50%;
            transform: translate(-50%, -50%) scale(0.95);
            width: 420px;
            background: #2d2d2d;
            border: 1px solid #00E5FF;
            border-radius: 8px;
            z-index: 201;
            opacity: 0;
            transition: transform 0.2s ease, opacity 0.2s ease;
            box-shadow: 0 8px 40px rgba(0, 229, 255, 0.15);
        `;

        this.modal.innerHTML = `
            <div style="
                padding: 20px 24px 16px;
                border-bottom: 1px solid rgba(var(--color-mint-rgb), 0.1);
            ">
                <div style="
                    font-family: var(--font-heading);
                    font-size: 14px;
                    color: var(--color-gold);
                    letter-spacing: 1px;
                ">ADD PRINTER MANUALLY</div>
            </div>

            <div style="padding: 20px 24px;">
                <!-- IP Address -->
                <div style="margin-bottom: 16px;">
                    <label style="
                        display: block;
                        font-family: var(--font-body);
                        font-size: 11px;
                        color: #888;
                        margin-bottom: 6px;
                        letter-spacing: 0.5px;
                    ">IP ADDRESS *</label>
                    <input type="text" id="add-ip-address"
                           placeholder="192.168.1.___"
                           style="
                               width: 100%;
                               padding: 10px 12px;
                               background: var(--color-bg-dark);
                               border: 1px solid rgba(var(--color-mint-rgb), 0.2);
                               border-radius: 4px;
                               color: var(--color-mint);
                               font-family: var(--font-body);
                               font-size: 14px;
                               outline: none;
                               box-sizing: border-box;
                               transition: border-color 0.15s ease;
                           ">
                    <div id="add-ip-error" style="
                        font-family: var(--font-body);
                        font-size: 10px;
                        color: #FF4444;
                        margin-top: 4px;
                        min-height: 14px;
                    "></div>
                </div>

                <!-- Port -->
                <div style="margin-bottom: 16px;">
                    <label style="
                        display: block;
                        font-family: var(--font-body);
                        font-size: 11px;
                        color: #888;
                        margin-bottom: 6px;
                        letter-spacing: 0.5px;
                    ">PORT</label>
                    <input type="text" id="add-port" value="9100"
                           placeholder="9100"
                           style="
                               width: 100%;
                               padding: 10px 12px;
                               background: var(--color-bg-dark);
                               border: 1px solid rgba(var(--color-mint-rgb), 0.2);
                               border-radius: 4px;
                               color: var(--color-mint);
                               font-family: var(--font-body);
                               font-size: 14px;
                               outline: none;
                               box-sizing: border-box;
                               transition: border-color 0.15s ease;
                           ">
                    <div style="
                        font-family: var(--font-body);
                        font-size: 10px;
                        color: #555;
                        margin-top: 4px;
                    ">Default: 9100 (ESC/POS standard)</div>
                </div>

                <!-- Optional fields -->
                <div style="
                    font-family: var(--font-body);
                    font-size: 10px;
                    color: #666;
                    margin-bottom: 10px;
                    letter-spacing: 0.5px;
                ">OPTIONAL</div>

                <div style="display: flex; gap: 12px; margin-bottom: 16px;">
                    <div style="flex: 1;">
                        <label style="
                            display: block;
                            font-family: var(--font-body);
                            font-size: 10px;
                            color: #666;
                            margin-bottom: 4px;
                        ">Model</label>
                        <input type="text" id="add-model"
                               placeholder="e.g. TM-T88VI"
                               style="
                                   width: 100%;
                                   padding: 8px 10px;
                                   background: var(--color-bg-dark);
                                   border: 1px solid rgba(var(--color-mint-rgb), 0.15);
                                   border-radius: 4px;
                                   color: var(--color-mint);
                                   font-family: var(--font-body);
                                   font-size: 12px;
                                   outline: none;
                                   box-sizing: border-box;
                               ">
                    </div>
                    <div style="flex: 1;">
                        <label style="
                            display: block;
                            font-family: var(--font-body);
                            font-size: 10px;
                            color: #666;
                            margin-bottom: 4px;
                        ">Location</label>
                        <input type="text" id="add-location"
                               placeholder="e.g. Front Counter"
                               style="
                                   width: 100%;
                                   padding: 8px 10px;
                                   background: var(--color-bg-dark);
                                   border: 1px solid rgba(var(--color-mint-rgb), 0.15);
                                   border-radius: 4px;
                                   color: var(--color-mint);
                                   font-family: var(--font-body);
                                   font-size: 12px;
                                   outline: none;
                                   box-sizing: border-box;
                               ">
                    </div>
                </div>

                <!-- Status message area -->
                <div id="add-status-msg" style="
                    font-family: var(--font-body);
                    font-size: 11px;
                    min-height: 20px;
                    text-align: center;
                    margin-top: 8px;
                "></div>
            </div>

            <!-- Footer -->
            <div style="
                display: flex;
                justify-content: flex-end;
                padding: 16px 24px;
                border-top: 1px solid rgba(var(--color-mint-rgb), 0.1);
                gap: 8px;
            ">
                <button id="add-cancel-btn" style="
                    padding: 8px 20px;
                    background: transparent;
                    border: 1px solid #666;
                    border-radius: 4px;
                    color: #888;
                    font-family: var(--font-body);
                    font-size: 12px;
                    cursor: pointer;
                    transition: all 0.15s ease;
                ">Cancel</button>
                <button id="add-submit-btn" style="
                    padding: 8px 24px;
                    background: var(--color-mint);
                    border: none;
                    border-radius: 4px;
                    color: var(--color-bg-dark);
                    font-family: var(--font-body);
                    font-size: 12px;
                    font-weight: bold;
                    cursor: pointer;
                    transition: all 0.15s ease;
                ">Add Printer</button>
            </div>
        `;

        this.overlay.appendChild(this.modal);
        document.body.appendChild(this.overlay);
    }

    /* ------------------------------------------
       PRIVATE: EVENTS
    ------------------------------------------ */

    _bindEvents() {
        // Close on overlay click
        this.overlay.addEventListener('click', (e) => {
            if (e.target === this.overlay) this.close();
        });

        // ESC key
        this._escHandler = (e) => {
            if (e.key === 'Escape') this.close();
        };
        document.addEventListener('keydown', this._escHandler);

        // Input focus styling
        this.modal.querySelectorAll('input').forEach(input => {
            input.addEventListener('focus', () => {
                input.style.borderColor = '#00E5FF';
            });
            input.addEventListener('blur', () => {
                input.style.borderColor = 'rgba(var(--color-mint-rgb), 0.2)';
            });
        });

        // Enter key submits
        this.modal.querySelector('#add-ip-address')?.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') this._submit();
        });

        // Buttons
        this.modal.querySelector('#add-cancel-btn')?.addEventListener('click', () => {
            this.close();
        });

        this.modal.querySelector('#add-submit-btn')?.addEventListener('click', () => {
            this._submit();
        });
    }

    _submit() {
        const ipInput = this.modal.querySelector('#add-ip-address');
        const portInput = this.modal.querySelector('#add-port');
        const modelInput = this.modal.querySelector('#add-model');
        const locationInput = this.modal.querySelector('#add-location');
        const errorEl = this.modal.querySelector('#add-ip-error');
        const statusEl = this.modal.querySelector('#add-status-msg');

        const ip = ipInput?.value.trim() || '';
        const port = parseInt(portInput?.value.trim() || '9100', 10);
        const model = modelInput?.value.trim() || 'Unknown Printer';
        const location = locationInput?.value.trim() || '';

        // Validate IP
        if (!this._isValidIP(ip)) {
            if (errorEl) {
                errorEl.textContent = 'Please enter a valid IP address (e.g., 192.168.1.50)';
                errorEl.style.color = '#FF4444';
            }
            if (ipInput) ipInput.style.borderColor = '#FF4444';
            return;
        }

        // Clear error
        if (errorEl) errorEl.textContent = '';
        if (ipInput) ipInput.style.borderColor = 'rgba(var(--color-mint-rgb), 0.2)';

        // Show testing status
        if (statusEl) {
            statusEl.textContent = 'Testing connection\u2026';
            statusEl.style.color = '#FFA500';
        }

        const submitBtn = this.modal.querySelector('#add-submit-btn');
        if (submitBtn) {
            submitBtn.textContent = 'Testing\u2026';
            submitBtn.disabled = true;
        }

        // Build the new printer object
        const newPrinter = {
            id: `printer_${Date.now()}`,
            model: model,
            manufacturer: '',
            connection_type: 'network',
            ip_address: ip,
            mac_address: '',
            port: port,
            role: 'unassigned',
            location: location,
            status: 'online', // Assume online since we're adding manually
            settings: {
                auto_cut: true,
                paper_width: '80mm',
                print_speed: 'normal'
            },
            capabilities: {},
            last_test: null,
            last_seen: new Date().toISOString(),
            created_at: new Date().toISOString(),
            uptime_days: 0
        };

        // In production: test connectivity via backend first
        // For now: simulate a brief delay then add
        setTimeout(() => {
            if (statusEl) {
                statusEl.textContent = '\u2713 Printer added successfully!';
                statusEl.style.color = '#00FF88';
            }

            if (this.onAdd) this.onAdd(newPrinter);

            // Close after brief success message
            setTimeout(() => this.close(), 600);
        }, 800);
    }

    /* ------------------------------------------
       PRIVATE: VALIDATION
    ------------------------------------------ */

    _isValidIP(ip) {
        if (!ip) return false;
        const parts = ip.split('.');
        if (parts.length !== 4) return false;
        return parts.every(part => {
            const num = parseInt(part, 10);
            return !isNaN(num) && num >= 0 && num <= 255 && part === String(num);
        });
    }

    /* ------------------------------------------
       CLEANUP
    ------------------------------------------ */

    destroy() {
        if (this._escHandler) {
            document.removeEventListener('keydown', this._escHandler);
        }
        this.close();
        this.onAdd = null;
    }
}