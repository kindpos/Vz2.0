/* ============================================
   KINDpos Overseer - Printer Config Modal
   Full configuration interface for a single
   printer: role, location, settings, test, remove.

   "If a manager can figure it out without
   a training manual, the design works."
   ============================================ */

import { ROLE_OPTIONS, ROLE_COLORS, STATUS_COLORS } from '../../data/sample-printers.js';

export class ConfigModal {

    constructor() {
        this.overlay = null;
        this.modal = null;
        this.printer = null;
        this.isOpen = false;

        // Callbacks
        this.onSave = null;
        this.onRemove = null;
        this.onTestPrint = null;
    }

    /* ------------------------------------------
       OPEN / CLOSE
    ------------------------------------------ */

    open(printer) {
        if (this.isOpen) this.close();
        this.printer = { ...printer }; // Work on a copy
        this.isOpen = true;
        this._createModal();
        this._bindEvents();

        // Animate in
        requestAnimationFrame(() => {
            this.overlay.style.opacity = '1';
            this.modal.style.transform = 'translate(-50%, -50%) scale(1)';
            this.modal.style.opacity = '1';
        });
    }

    close() {
        if (!this.isOpen) return;
        this.isOpen = false;

        // Animate out
        if (this.overlay) this.overlay.style.opacity = '0';
        if (this.modal) {
            this.modal.style.transform = 'translate(-50%, -50%) scale(0.95)';
            this.modal.style.opacity = '0';
        }

        setTimeout(() => {
            if (this.overlay) this.overlay.remove();
            this.overlay = null;
            this.modal = null;
            this.printer = null;
        }, 200);
    }

    /* ------------------------------------------
       PRIVATE: CREATE MODAL
    ------------------------------------------ */

    _createModal() {
        // Overlay
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

        // Modal container
        this.modal = document.createElement('div');
        this.modal.className = 'printer-config-modal';
        this.modal.style.cssText = `
            position: fixed;
            top: 50%; left: 50%;
            transform: translate(-50%, -50%) scale(0.95);
            width: 480px;
            max-height: 85vh;
            overflow-y: auto;
            background: #2d2d2d;
            border: 1px solid #00E5FF;
            border-radius: 8px;
            z-index: 201;
            opacity: 0;
            transition: transform 0.2s ease, opacity 0.2s ease;
            box-shadow: 0 8px 40px rgba(0, 229, 255, 0.15);
        `;

        const statusColor = STATUS_COLORS[this.printer.status] || STATUS_COLORS.offline;
        const statusIcon = this.printer.status === 'online' ? '\u25CF' : '\u25CB';
        const currentRoleColor = ROLE_COLORS[this.printer.role] || ROLE_COLORS.unassigned;

        this.modal.innerHTML = `
            <div class="modal-header" style="
                padding: 20px 24px 16px;
                border-bottom: 1px solid rgba(var(--color-mint-rgb), 0.1);
            ">
                <div style="
                    font-family: var(--font-heading);
                    font-size: 14px;
                    color: var(--color-gold);
                    letter-spacing: 1px;
                    margin-bottom: 4px;
                ">CONFIGURE PRINTER</div>
                <div style="
                    font-family: var(--font-body);
                    font-size: 16px;
                    color: var(--color-mint);
                ">${this.printer.model}</div>
            </div>

            <div class="modal-body" style="padding: 20px 24px;">

                <!-- Connection Info (read-only) -->
                <div class="config-section" style="margin-bottom: 20px;">
                    <div class="config-row" style="display: flex; justify-content: space-between; margin-bottom: 8px;">
                        <span class="config-label">Connection:</span>
                        <span class="config-value">${this.printer.connection_type === 'network' ? 'Network' : 'USB'}</span>
                    </div>
                    <div class="config-row" style="display: flex; justify-content: space-between; margin-bottom: 8px;">
                        <span class="config-label">IP Address:</span>
                        <span class="config-value monospace">${this.printer.ip_address || 'N/A'}</span>
                    </div>
                    <div class="config-row" style="display: flex; justify-content: space-between; margin-bottom: 8px;">
                        <span class="config-label">MAC Address:</span>
                        <span class="config-value monospace">${this.printer.mac_address || 'N/A'}</span>
                    </div>
                    <div class="config-row" style="display: flex; justify-content: space-between; margin-bottom: 8px;">
                        <span class="config-label">Status:</span>
                        <span class="config-value" style="color: ${statusColor};">${statusIcon} ${this.printer.status}</span>
                    </div>
                </div>

                <div class="config-divider" style="
                    border-top: 1px solid rgba(var(--color-mint-rgb), 0.1);
                    margin: 16px 0;
                "></div>

                <!-- Role Selection -->
                <div class="config-section" style="margin-bottom: 16px;">
                    <label class="config-field-label" style="
                        display: block;
                        font-family: var(--font-body);
                        font-size: 11px;
                        color: #888;
                        margin-bottom: 6px;
                        letter-spacing: 0.5px;
                    ">ROLE</label>
                    <div class="role-selector" style="display: flex; flex-wrap: wrap; gap: 8px;">
                        ${ROLE_OPTIONS.map(opt => `
                            <button class="role-option ${this.printer.role === opt.value ? 'selected' : ''}"
                                    data-role="${opt.value}"
                                    style="
                                        padding: 6px 14px;
                                        border: 2px solid ${opt.color};
                                        border-radius: 4px;
                                        background: ${this.printer.role === opt.value ? opt.color : 'transparent'};
                                        color: ${this.printer.role === opt.value ? 'var(--color-bg-dark)' : opt.color};
                                        font-family: var(--font-body);
                                        font-size: 11px;
                                        font-weight: bold;
                                        cursor: pointer;
                                        transition: all 0.15s ease;
                                        letter-spacing: 0.5px;
                                    ">
                                ${opt.label}
                            </button>
                        `).join('')}
                    </div>
                </div>

                <!-- Location -->
                <div class="config-section" style="margin-bottom: 16px;">
                    <label class="config-field-label" style="
                        display: block;
                        font-family: var(--font-body);
                        font-size: 11px;
                        color: #888;
                        margin-bottom: 6px;
                        letter-spacing: 0.5px;
                    ">LOCATION</label>
                    <input type="text" id="config-location" value="${this.printer.location || ''}"
                           placeholder="e.g. Front Counter, Back Line, Upstairs Bar"
                           style="
                               width: 100%;
                               padding: 10px 12px;
                               background: var(--color-bg-dark);
                               border: 1px solid rgba(var(--color-mint-rgb), 0.2);
                               border-radius: 4px;
                               color: var(--color-mint);
                               font-family: var(--font-body);
                               font-size: 13px;
                               outline: none;
                               box-sizing: border-box;
                               transition: border-color 0.15s ease;
                           ">
                </div>

                <div class="config-divider" style="
                    border-top: 1px solid rgba(var(--color-mint-rgb), 0.1);
                    margin: 16px 0;
                "></div>

                <!-- Settings -->
                <div class="config-section" style="margin-bottom: 16px;">
                    <div class="config-field-label" style="
                        font-family: var(--font-body);
                        font-size: 11px;
                        color: #888;
                        margin-bottom: 10px;
                        letter-spacing: 0.5px;
                    ">SETTINGS</div>

                    <div style="display: flex; align-items: center; margin-bottom: 10px;">
                        <label style="display: flex; align-items: center; cursor: pointer; gap: 8px;">
                            <input type="checkbox" id="config-autocut"
                                   ${this.printer.settings.auto_cut ? 'checked' : ''}
                                   style="
                                       width: 16px; height: 16px;
                                       accent-color: var(--color-mint);
                                       cursor: pointer;
                                   ">
                            <span style="
                                font-family: var(--font-body);
                                font-size: 12px;
                                color: var(--color-mint);
                            ">Auto-cut paper</span>
                        </label>
                    </div>

                    <div style="display: flex; gap: 16px;">
                        <div style="flex: 1;">
                            <label style="
                                display: block;
                                font-family: var(--font-body);
                                font-size: 10px;
                                color: #666;
                                margin-bottom: 4px;
                            ">Paper Width</label>
                            <select id="config-paper-width" style="
                                width: 100%;
                                padding: 8px;
                                background: var(--color-bg-dark);
                                border: 1px solid rgba(var(--color-mint-rgb), 0.2);
                                border-radius: 4px;
                                color: var(--color-mint);
                                font-family: var(--font-body);
                                font-size: 12px;
                                cursor: pointer;
                            ">
                                <option value="58mm" ${this.printer.settings.paper_width === '58mm' ? 'selected' : ''}>58mm</option>
                                <option value="80mm" ${this.printer.settings.paper_width === '80mm' ? 'selected' : ''}>80mm</option>
                            </select>
                        </div>
                        <div style="flex: 1;">
                            <label style="
                                display: block;
                                font-family: var(--font-body);
                                font-size: 10px;
                                color: #666;
                                margin-bottom: 4px;
                            ">Print Speed</label>
                            <select id="config-print-speed" style="
                                width: 100%;
                                padding: 8px;
                                background: var(--color-bg-dark);
                                border: 1px solid rgba(var(--color-mint-rgb), 0.2);
                                border-radius: 4px;
                                color: var(--color-mint);
                                font-family: var(--font-body);
                                font-size: 12px;
                                cursor: pointer;
                            ">
                                <option value="normal" ${this.printer.settings.print_speed === 'normal' ? 'selected' : ''}>Normal</option>
                                <option value="fast" ${this.printer.settings.print_speed === 'fast' ? 'selected' : ''}>Fast</option>
                            </select>
                        </div>
                    </div>
                </div>
            </div>

            <!-- Footer Actions -->
            <div class="modal-footer" style="
                display: flex;
                justify-content: space-between;
                padding: 16px 24px;
                border-top: 1px solid rgba(var(--color-mint-rgb), 0.1);
                gap: 8px;
            ">
                <div style="display: flex; gap: 8px;">
                    <button id="config-test-btn" class="modal-btn test" style="
                        padding: 8px 16px;
                        background: transparent;
                        border: 1px solid #FFA500;
                        border-radius: 4px;
                        color: #FFA500;
                        font-family: var(--font-body);
                        font-size: 12px;
                        cursor: pointer;
                        transition: all 0.15s ease;
                    ">Test Print</button>
                    <button id="config-remove-btn" class="modal-btn remove" style="
                        padding: 8px 16px;
                        background: transparent;
                        border: 1px solid #FF4444;
                        border-radius: 4px;
                        color: #FF4444;
                        font-family: var(--font-body);
                        font-size: 12px;
                        cursor: pointer;
                        transition: all 0.15s ease;
                    ">Remove</button>
                </div>
                <div style="display: flex; gap: 8px;">
                    <button id="config-cancel-btn" class="modal-btn cancel" style="
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
                    <button id="config-save-btn" class="modal-btn save" style="
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
                    ">Save</button>
                </div>
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

        // Role selection
        this.modal.querySelectorAll('.role-option').forEach(btn => {
            btn.addEventListener('click', () => this._selectRole(btn.dataset.role));
        });

        // Location input focus styling
        const locationInput = this.modal.querySelector('#config-location');
        if (locationInput) {
            locationInput.addEventListener('focus', () => {
                locationInput.style.borderColor = '#00E5FF';
            });
            locationInput.addEventListener('blur', () => {
                locationInput.style.borderColor = 'rgba(var(--color-mint-rgb), 0.2)';
            });
        }

        // Action buttons
        this.modal.querySelector('#config-test-btn')?.addEventListener('click', () => {
            if (this.onTestPrint) this.onTestPrint(this.printer.id);
        });

        this.modal.querySelector('#config-remove-btn')?.addEventListener('click', () => {
            this._confirmRemove();
        });

        this.modal.querySelector('#config-cancel-btn')?.addEventListener('click', () => {
            this.close();
        });

        this.modal.querySelector('#config-save-btn')?.addEventListener('click', () => {
            this._save();
        });
    }

    _selectRole(role) {
        this.printer.role = role;

        // Update visual state of role buttons
        this.modal.querySelectorAll('.role-option').forEach(btn => {
            const opt = ROLE_OPTIONS.find(o => o.value === btn.dataset.role);
            if (!opt) return;

            if (btn.dataset.role === role) {
                btn.classList.add('selected');
                btn.style.background = opt.color;
                btn.style.color = 'var(--color-bg-dark)';
            } else {
                btn.classList.remove('selected');
                btn.style.background = 'transparent';
                btn.style.color = opt.color;
            }
        });
    }

    _save() {
        // Gather current values
        const location = this.modal.querySelector('#config-location')?.value.trim() || '';
        const autoCut = this.modal.querySelector('#config-autocut')?.checked ?? true;
        const paperWidth = this.modal.querySelector('#config-paper-width')?.value || '80mm';
        const printSpeed = this.modal.querySelector('#config-print-speed')?.value || 'normal';

        const updatedPrinter = {
            ...this.printer,
            location,
            settings: {
                auto_cut: autoCut,
                paper_width: paperWidth,
                print_speed: printSpeed
            }
        };

        if (this.onSave) this.onSave(updatedPrinter);
        this.close();
    }

    _confirmRemove() {
        const removeBtn = this.modal.querySelector('#config-remove-btn');
        if (!removeBtn) return;

        if (removeBtn.dataset.confirmed === 'true') {
            // Second click — actually remove
            if (this.onRemove) this.onRemove(this.printer.id);
            this.close();
        } else {
            // First click — show confirmation
            removeBtn.dataset.confirmed = 'true';
            removeBtn.textContent = 'Confirm Remove?';
            removeBtn.style.background = '#FF4444';
            removeBtn.style.color = '#fff';

            // Reset after 3 seconds if not clicked
            setTimeout(() => {
                if (removeBtn && removeBtn.dataset.confirmed === 'true') {
                    removeBtn.dataset.confirmed = 'false';
                    removeBtn.textContent = 'Remove';
                    removeBtn.style.background = 'transparent';
                    removeBtn.style.color = '#FF4444';
                }
            }, 3000);
        }
    }

    /* ------------------------------------------
       CLEANUP
    ------------------------------------------ */

    destroy() {
        if (this._escHandler) {
            document.removeEventListener('keydown', this._escHandler);
        }
        this.close();
        this.onSave = null;
        this.onRemove = null;
        this.onTestPrint = null;
    }
}