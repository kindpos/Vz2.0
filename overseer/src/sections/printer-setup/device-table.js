/* ============================================
   KINDpos Overseer - Device Table
   Tabular list of discovered/configured printers.
   Shows status, role, location, and action buttons.

   "Show your work" — the table makes
   printer state transparent and actionable.
   ============================================ */

import { ROLE_COLORS, STATUS_COLORS } from '../../data/sample-printers.js';

export class DeviceTable {

    constructor(printers) {
        this.printers = printers || [];
        this.container = null;

        // Callbacks
        this.onConfigClick = null;
        this.onTestClick = null;
    }

    /* ------------------------------------------
       RENDER
    ------------------------------------------ */

    render(container) {
        this.container = container;
        this.container.innerHTML = '';

        if (this.printers.length === 0) {
            this._renderEmptyState();
            return;
        }

        const tableWrapper = document.createElement('div');
        tableWrapper.className = 'device-table-wrapper';

        const table = document.createElement('table');
        table.className = 'device-table';

        table.innerHTML = `
            <thead>
                <tr>
                    <th></th>
                    <th>Model</th>
                    <th>Connection</th>
                    <th>IP Address</th>
                    <th>Role</th>
                    <th>Location</th>
                    <th>Status</th>
                    <th>Last Test</th>
                    <th>Actions</th>
                </tr>
            </thead>
            <tbody id="device-table-body">
                ${this.printers.map(p => this._renderRow(p)).join('')}
            </tbody>
        `;

        tableWrapper.appendChild(table);
        this.container.appendChild(tableWrapper);
        this._bindRowEvents();
    }

    /* ------------------------------------------
       UPDATE
    ------------------------------------------ */

    updatePrinters(printers) {
        this.printers = printers;
        if (this.container) this.render(this.container);
    }

    updateTestStatus(printerId, status, timestamp) {
        const btn = this.container?.querySelector(`.btn-test[data-printer-id="${printerId}"]`);
        if (!btn) return;

        if (status === 'testing') {
            btn.textContent = 'Printing\u2026';
            btn.disabled = true;
            btn.className = 'btn-small btn-test testing';
        } else if (status === 'success') {
            btn.textContent = '\u2713 Success';
            btn.disabled = true;
            btn.className = 'btn-small btn-test success';
            // Update last test in the row
            this._updateLastTest(printerId, timestamp);
            setTimeout(() => {
                btn.textContent = 'Test';
                btn.disabled = false;
                btn.className = 'btn-small btn-test';
            }, 2500);
        } else if (status === 'failed') {
            btn.textContent = '\u2717 Failed';
            btn.disabled = true;
            btn.className = 'btn-small btn-test error';
            setTimeout(() => {
                btn.textContent = 'Test';
                btn.disabled = false;
                btn.className = 'btn-small btn-test';
            }, 2500);
        }
    }

    /* ------------------------------------------
       PRIVATE: ROW RENDERING
    ------------------------------------------ */

    _renderRow(printer) {
        const roleColor = ROLE_COLORS[printer.role] || ROLE_COLORS.unassigned;
        const statusColor = STATUS_COLORS[printer.status] || STATUS_COLORS.offline;
        const statusIcon = printer.status === 'online' ? '\u25CF' : '\u25CB';
        const connType = printer.connection_type === 'network' ? '\uD83C\uDF10 Network' : '\uD83D\uDD0C USB';

        const lastTest = printer.last_test
            ? this._formatTimestamp(printer.last_test)
            : '\u2014';

        return `
            <tr data-printer-id="${printer.id}" class="printer-row">
                <td class="col-icon">\uD83D\uDDA8\uFE0F</td>
                <td class="col-model">${printer.model}</td>
                <td class="col-connection">${connType}</td>
                <td class="col-ip monospace">${printer.ip_address || 'N/A'}</td>
                <td class="col-role">
                    <span class="role-badge" style="
                        background-color: ${roleColor};
                        color: var(--color-bg-dark);
                        padding: 2px 8px;
                        border-radius: 3px;
                        font-size: 10px;
                        font-weight: bold;
                        letter-spacing: 0.5px;
                    ">
                        ${printer.role.toUpperCase()}
                    </span>
                </td>
                <td class="col-location">${printer.location || '\u2014'}</td>
                <td class="col-status">
                    <span style="color: ${statusColor};">${statusIcon}</span>
                    ${printer.status}
                </td>
                <td class="col-last-test monospace small" data-field="last-test">
                    ${lastTest}
                </td>
                <td class="col-actions">
                    <button class="btn-small btn-config" data-printer-id="${printer.id}"
                            title="Configure printer">
                        Edit
                    </button>
                    <button class="btn-small btn-test" data-printer-id="${printer.id}"
                            title="Send test print">
                        Test
                    </button>
                </td>
            </tr>
        `;
    }

    _renderEmptyState() {
        this.container.innerHTML = `
            <div class="device-table-empty">
                <div class="empty-icon">\uD83D\uDDA8\uFE0F</div>
                <div class="empty-title">No Printers Configured</div>
                <div class="empty-subtitle">
                    Use "Scan Network" to auto-discover printers,<br>
                    or "Add Manually" to enter a printer by IP address.
                </div>
            </div>
        `;
    }

    /* ------------------------------------------
       PRIVATE: EVENTS
    ------------------------------------------ */

    _bindRowEvents() {
        // Edit buttons
        this.container.querySelectorAll('.btn-config').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                if (this.onConfigClick) {
                    this.onConfigClick(btn.dataset.printerId);
                }
            });
        });

        // Test buttons
        this.container.querySelectorAll('.btn-test').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                if (this.onTestClick) {
                    this.onTestClick(btn.dataset.printerId);
                }
            });
        });

        // Row click → open config
        this.container.querySelectorAll('.printer-row').forEach(row => {
            row.addEventListener('click', () => {
                if (this.onConfigClick) {
                    this.onConfigClick(row.dataset.printerId);
                }
            });
        });
    }

    /* ------------------------------------------
       PRIVATE: HELPERS
    ------------------------------------------ */

    _formatTimestamp(isoString) {
        try {
            const date = new Date(isoString);
            return date.toLocaleString('en-US', {
                month: 'short',
                day: 'numeric',
                hour: 'numeric',
                minute: '2-digit',
                hour12: true
            });
        } catch {
            return '\u2014';
        }
    }

    _updateLastTest(printerId, timestamp) {
        const row = this.container?.querySelector(`tr[data-printer-id="${printerId}"]`);
        if (!row) return;
        const cell = row.querySelector('[data-field="last-test"]');
        if (cell && timestamp) {
            cell.textContent = this._formatTimestamp(timestamp);
        }
    }

    /* ------------------------------------------
       CLEANUP
    ------------------------------------------ */

    destroy() {
        this.onConfigClick = null;
        this.onTestClick = null;
        if (this.container) this.container.innerHTML = '';
    }
}