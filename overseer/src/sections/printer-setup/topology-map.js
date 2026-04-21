/* ============================================
   KINDpos Overseer - Network Topology Map
   SVG-based network visualization showing
   router/gateway and connected printers.

   This is what makes KINDpos demos pop —
   competitors show lists, we show architecture.
   ============================================ */

import { ROLE_COLORS, STATUS_COLORS } from '../../data/sample-printers.js';

export class TopologyMap {

    constructor(printers, network) {
        this.printers = printers || [];
        this.network = network || {};
        this.svg = null;
        this.tooltip = null;
        this.printerPositions = new Map(); // printerId → {x, y}

        // Layout constants
        this.mapWidth = 800;
        this.mapHeight = 380;
        this.routerX = this.mapWidth / 2;
        this.routerY = 70;
        this.arcRadius = 180;

        // Callbacks
        this.onPrinterClick = null;
    }

    /* ------------------------------------------
       RENDER
    ------------------------------------------ */

    render(svgElement) {
        this.svg = svgElement;
        this.svg.setAttribute('viewBox', `0 0 ${this.mapWidth} ${this.mapHeight}`);
        this.svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
        this.clear();

        // Draw in back-to-front order
        this._drawBackground();
        this._calculatePrinterPositions();
        this._drawConnections();
        this._drawRouter();
        this._drawPrinters();
        this._drawLegend();
        this._createTooltip();
    }

    clear() {
        if (this.svg) this.svg.innerHTML = '';
        this.printerPositions.clear();
    }

    /* ------------------------------------------
       UPDATE (without full re-render)
    ------------------------------------------ */

    updatePrinters(printers) {
        this.printers = printers;
        this.render(this.svg);
    }

    updatePrinterStatus(printerId, status) {
        const printer = this.printers.find(p => p.id === printerId);
        if (!printer) return;
        printer.status = status;

        // Update status indicator
        const node = this.svg.querySelector(`#printer-${printerId}`);
        if (node) {
            const statusDot = node.querySelector('.status-indicator');
            if (statusDot) {
                statusDot.setAttribute('fill', STATUS_COLORS[status] || STATUS_COLORS.offline);
            }
            // Update connection line color
            const line = this.svg.querySelector(`#connection-${printerId}`);
            if (line) {
                line.setAttribute('stroke', status === 'online' ? '#00E5FF' : '#444444');
                line.setAttribute('stroke-dasharray', status === 'online' ? 'none' : '5,5');
            }
        }
    }

    /* ------------------------------------------
       PRIVATE: BACKGROUND
    ------------------------------------------ */

    _drawBackground() {
        // Subtle grid pattern for depth
        const defs = this._createSVG('defs');

        const pattern = this._createSVG('pattern', {
            id: 'grid-pattern',
            width: 40, height: 40,
            patternUnits: 'userSpaceOnUse'
        });
        const gridLine1 = this._createSVG('path', {
            d: 'M 40 0 L 0 0 0 40',
            fill: 'none',
            stroke: 'rgba(var(--color-mint-rgb), 0.03)',
            'stroke-width': 1
        });
        pattern.appendChild(gridLine1);
        defs.appendChild(pattern);
        this.svg.appendChild(defs);

        // Background rect with grid
        const bg = this._createSVG('rect', {
            x: 0, y: 0,
            width: this.mapWidth,
            height: this.mapHeight,
            fill: 'var(--color-bg-dark)',
            rx: 8
        });
        this.svg.appendChild(bg);

        const gridOverlay = this._createSVG('rect', {
            x: 0, y: 0,
            width: this.mapWidth,
            height: this.mapHeight,
            fill: 'url(#grid-pattern)',
            rx: 8
        });
        this.svg.appendChild(gridOverlay);

        // Header label
        const header = this._createSVG('text', {
            x: 20, y: 24,
            fill: 'rgba(var(--color-mint-rgb), 0.4)',
            'font-family': 'var(--font-heading)',
            'font-size': 11,
            'letter-spacing': '2px'
        });
        header.textContent = 'NETWORK TOPOLOGY';
        this.svg.appendChild(header);
    }

    /* ------------------------------------------
       PRIVATE: ROUTER
    ------------------------------------------ */

    _drawRouter() {
        const g = this._createSVG('g', {
            id: 'router-node',
            transform: `translate(${this.routerX}, ${this.routerY})`
        });

        // Outer glow
        const glow = this._createSVG('rect', {
            x: -65, y: -35,
            width: 130, height: 70,
            fill: 'none',
            stroke: 'rgba(0, 229, 255, 0.15)',
            'stroke-width': 8,
            rx: 12,
            filter: 'blur(4px)'
        });
        g.appendChild(glow);

        // Main rectangle
        const rect = this._createSVG('rect', {
            x: -60, y: -30,
            width: 120, height: 60,
            fill: '#2d2d2d',
            stroke: '#00E5FF',
            'stroke-width': 2,
            rx: 8
        });
        g.appendChild(rect);

        // Router icon
        const icon = this._createSVG('text', {
            x: 0, y: -4,
            'text-anchor': 'middle',
            fill: '#00E5FF',
            'font-size': 18
        });
        icon.textContent = '\uD83C\uDF10'; // globe emoji
        g.appendChild(icon);

        // Label
        const label = this._createSVG('text', {
            x: 0, y: 14,
            'text-anchor': 'middle',
            fill: 'var(--color-mint)',
            'font-family': 'var(--font-body)',
            'font-size': 11
        });
        label.textContent = 'Router';
        g.appendChild(label);

        // IP address
        const ip = this._createSVG('text', {
            x: 0, y: 26,
            'text-anchor': 'middle',
            fill: '#888',
            'font-family': 'var(--font-body)',
            'font-size': 9
        });
        ip.textContent = this.network.gateway ? this.network.gateway.ip : '192.168.1.1';
        g.appendChild(ip);

        this.svg.appendChild(g);
    }

    /* ------------------------------------------
       PRIVATE: PRINTER LAYOUT CALCULATION
    ------------------------------------------ */

    _calculatePrinterPositions() {
        const numPrinters = this.printers.length;
        if (numPrinters === 0) return;

        if (numPrinters === 1) {
            // Single printer goes directly below router
            this.printerPositions.set(this.printers[0].id, {
                x: this.routerX,
                y: this.routerY + this.arcRadius
            });
            return;
        }

        // Arrange printers in arc below router
        const startAngle = Math.PI * 0.2;   // ~36 degrees from horizontal
        const endAngle = Math.PI * 0.8;     // ~144 degrees from horizontal

        this.printers.forEach((printer, index) => {
            const angle = startAngle + (endAngle - startAngle) * (index / (numPrinters - 1));
            const x = this.routerX + Math.cos(angle) * this.arcRadius;
            const y = this.routerY + Math.sin(angle) * this.arcRadius;
            this.printerPositions.set(printer.id, { x, y });
        });
    }

    /* ------------------------------------------
       PRIVATE: CONNECTION LINES
    ------------------------------------------ */

    _drawConnections() {
        const routerBottomY = this.routerY + 30;

        this.printers.forEach(printer => {
            const pos = this.printerPositions.get(printer.id);
            if (!pos) return;

            const isOnline = printer.status === 'online';
            const strokeColor = isOnline ? '#00E5FF' : '#444444';

            const line = this._createSVG('line', {
                id: `connection-${printer.id}`,
                x1: this.routerX,
                y1: routerBottomY,
                x2: pos.x,
                y2: pos.y - 42,
                stroke: strokeColor,
                'stroke-width': 2,
                'stroke-dasharray': isOnline ? 'none' : '5,5',
                class: 'connection-line'
            });

            this.svg.appendChild(line);
        });
    }

    /* ------------------------------------------
       PRIVATE: PRINTER NODES
    ------------------------------------------ */

    _drawPrinters() {
        if (this.printers.length === 0) {
            this._drawEmptyState();
            return;
        }

        this.printers.forEach(printer => {
            const pos = this.printerPositions.get(printer.id);
            if (!pos) return;
            this._drawPrinterNode(printer, pos.x, pos.y);
        });
    }

    _drawPrinterNode(printer, x, y) {
        const color = ROLE_COLORS[printer.role] || ROLE_COLORS.unassigned;
        const isOnline = printer.status === 'online';

        const g = this._createSVG('g', {
            id: `printer-${printer.id}`,
            class: 'printer-node',
            'data-printer-id': printer.id,
            transform: `translate(${x}, ${y})`,
            style: 'cursor: pointer;'
        });

        // Hover hit area (invisible, larger than visible node)
        const hitArea = this._createSVG('circle', {
            r: 48,
            fill: 'transparent',
            class: 'hit-area'
        });
        g.appendChild(hitArea);

        // Outer glow on hover (hidden by default)
        const hoverGlow = this._createSVG('circle', {
            r: 44,
            fill: 'none',
            stroke: color,
            'stroke-width': 6,
            opacity: 0,
            class: 'hover-glow',
            filter: 'blur(3px)'
        });
        g.appendChild(hoverGlow);

        // Main circle
        const circle = this._createSVG('circle', {
            r: 40,
            fill: '#2d2d2d',
            stroke: color,
            'stroke-width': 3,
            class: 'node-circle'
        });
        g.appendChild(circle);

        // Printer icon
        const icon = this._createSVG('text', {
            y: -12,
            'text-anchor': 'middle',
            'font-size': 20
        });
        icon.textContent = '\uD83D\uDDA8\uFE0F'; // printer emoji
        g.appendChild(icon);

        // Model name (truncated)
        const model = this._createSVG('text', {
            y: 6,
            'text-anchor': 'middle',
            fill: 'var(--color-mint)',
            'font-family': 'var(--font-body)',
            'font-size': 9
        });
        model.textContent = this._truncateModel(printer.model);
        g.appendChild(model);

        // Role label
        const role = this._createSVG('text', {
            y: 18,
            'text-anchor': 'middle',
            fill: color,
            'font-family': 'var(--font-body)',
            'font-size': 8,
            'font-weight': 'bold',
            'letter-spacing': '1px'
        });
        role.textContent = printer.role.toUpperCase();
        g.appendChild(role);

        // Short IP
        const ip = this._createSVG('text', {
            y: 30,
            'text-anchor': 'middle',
            fill: '#888',
            'font-family': 'var(--font-body)',
            'font-size': 8
        });
        ip.textContent = this._getShortIP(printer.ip_address);
        g.appendChild(ip);

        // Status indicator dot
        const statusDot = this._createSVG('circle', {
            cx: 28, cy: -28,
            r: 5,
            fill: STATUS_COLORS[printer.status] || STATUS_COLORS.offline,
            stroke: 'var(--color-bg-dark)',
            'stroke-width': 2,
            class: 'status-indicator'
        });
        g.appendChild(statusDot);

        // Interactivity
        this._addNodeInteractivity(g, printer);

        this.svg.appendChild(g);
    }

    _drawEmptyState() {
        const g = this._createSVG('g', {
            transform: `translate(${this.routerX}, ${this.routerY + 120})`
        });

        const text1 = this._createSVG('text', {
            x: 0, y: 0,
            'text-anchor': 'middle',
            fill: '#666',
            'font-family': 'var(--font-body)',
            'font-size': 14
        });
        text1.textContent = 'No printers discovered';
        g.appendChild(text1);

        const text2 = this._createSVG('text', {
            x: 0, y: 24,
            'text-anchor': 'middle',
            fill: '#555',
            'font-family': 'var(--font-body)',
            'font-size': 11
        });
        text2.textContent = 'Click "Scan Network" or "Add Manually" to get started';
        g.appendChild(text2);

        this.svg.appendChild(g);
    }

    /* ------------------------------------------
       PRIVATE: INTERACTIVITY
    ------------------------------------------ */

    _addNodeInteractivity(node, printer) {
        const hoverGlow = node.querySelector('.hover-glow');
        const circle = node.querySelector('.node-circle');

        node.addEventListener('mouseenter', (e) => {
            if (hoverGlow) hoverGlow.setAttribute('opacity', '0.3');
            if (circle) circle.setAttribute('r', '43');
            this._showTooltip(printer, e);
        });

        node.addEventListener('mouseleave', () => {
            if (hoverGlow) hoverGlow.setAttribute('opacity', '0');
            if (circle) circle.setAttribute('r', '40');
            this._hideTooltip();
        });

        node.addEventListener('mousemove', (e) => {
            this._moveTooltip(e);
        });

        node.addEventListener('click', () => {
            if (this.onPrinterClick) {
                this.onPrinterClick(printer.id);
            }
        });
    }

    /* ------------------------------------------
       PRIVATE: TOOLTIP
    ------------------------------------------ */

    _createTooltip() {
        // Create tooltip as a DOM element (not SVG) for easier styling
        if (this.tooltip) this.tooltip.remove();

        this.tooltip = document.createElement('div');
        this.tooltip.className = 'topology-tooltip';
        this.tooltip.style.cssText = `
            position: fixed;
            display: none;
            background: #2d2d2d;
            border: 1px solid #00E5FF;
            border-radius: 6px;
            padding: 12px 16px;
            color: var(--color-mint);
            font-family: var(--font-body);
            font-size: 11px;
            line-height: 1.6;
            z-index: 100;
            pointer-events: none;
            box-shadow: 0 4px 20px rgba(0, 229, 255, 0.15);
            max-width: 260px;
        `;

        // Append to the topology container's parent
        const container = this.svg.closest('.topology-section') || document.body;
        container.appendChild(this.tooltip);
    }

    _showTooltip(printer, event) {
        if (!this.tooltip) return;

        const lastTest = printer.last_test
            ? this._timeAgo(new Date(printer.last_test))
            : 'Never';

        const lastSeen = printer.last_seen
            ? this._timeAgo(new Date(printer.last_seen))
            : 'Unknown';

        const roleColor = ROLE_COLORS[printer.role] || ROLE_COLORS.unassigned;

        this.tooltip.innerHTML = `
            <div style="color: var(--color-gold); font-size: 12px; margin-bottom: 6px; font-weight: bold;">
                ${printer.model}
            </div>
            <div style="margin-bottom: 4px;">
                <span style="color: #888;">IP:</span> ${printer.ip_address}
            </div>
            <div style="margin-bottom: 4px;">
                <span style="color: #888;">MAC:</span> ${printer.mac_address}
            </div>
            <div style="margin-bottom: 4px;">
                <span style="color: #888;">Role:</span>
                <span style="color: ${roleColor};">${printer.role.toUpperCase()}</span>
            </div>
            <div style="margin-bottom: 4px;">
                <span style="color: #888;">Location:</span> ${printer.location || '—'}
            </div>
            <div style="margin-bottom: 4px;">
                <span style="color: #888;">Last Test:</span> ${lastTest}
            </div>
            <div>
                <span style="color: #888;">Last Seen:</span> ${lastSeen}
            </div>
        `;

        this.tooltip.style.display = 'block';
        this._moveTooltip(event);
    }

    _moveTooltip(event) {
        if (!this.tooltip) return;
        this.tooltip.style.left = (event.clientX + 16) + 'px';
        this.tooltip.style.top = (event.clientY - 10) + 'px';
    }

    _hideTooltip() {
        if (this.tooltip) {
            this.tooltip.style.display = 'none';
        }
    }

    /* ------------------------------------------
       PRIVATE: LEGEND
    ------------------------------------------ */

    _drawLegend() {
        const y = this.mapHeight - 28;
        const g = this._createSVG('g', {
            transform: `translate(20, ${y})`
        });

        const items = [
            { color: STATUS_COLORS.online, label: 'Online', filled: true },
            { color: STATUS_COLORS.offline, label: 'Offline', filled: true },
            { color: STATUS_COLORS.testing, label: 'Testing', filled: true }
        ];

        let xOffset = 0;
        items.forEach(item => {
            const dot = this._createSVG('circle', {
                cx: xOffset + 6, cy: 0,
                r: 4,
                fill: item.filled ? item.color : 'transparent',
                stroke: item.color,
                'stroke-width': 1.5
            });
            g.appendChild(dot);

            const label = this._createSVG('text', {
                x: xOffset + 16, y: 4,
                fill: '#888',
                'font-family': 'var(--font-body)',
                'font-size': 9
            });
            label.textContent = item.label;
            g.appendChild(label);

            xOffset += 80;
        });

        // Role color legend
        xOffset += 20;
        const rolesUsed = [...new Set(this.printers.map(p => p.role))];
        rolesUsed.forEach(role => {
            const color = ROLE_COLORS[role] || ROLE_COLORS.unassigned;
            const swatch = this._createSVG('rect', {
                x: xOffset, y: -5,
                width: 10, height: 10,
                fill: color,
                rx: 2
            });
            g.appendChild(swatch);

            const label = this._createSVG('text', {
                x: xOffset + 16, y: 4,
                fill: '#888',
                'font-family': 'var(--font-body)',
                'font-size': 9
            });
            label.textContent = role.charAt(0).toUpperCase() + role.slice(1);
            g.appendChild(label);

            xOffset += 80;
        });

        this.svg.appendChild(g);
    }

    /* ------------------------------------------
       PRIVATE: HELPERS
    ------------------------------------------ */

    _createSVG(tag, attrs = {}) {
        const el = document.createElementNS('http://www.w3.org/2000/svg', tag);
        for (const [key, val] of Object.entries(attrs)) {
            el.setAttribute(key, val);
        }
        return el;
    }

    _truncateModel(model) {
        if (!model) return 'Unknown';
        if (model.length > 12) return model.substring(0, 10) + '..';
        return model;
    }

    _getShortIP(ipAddress) {
        if (!ipAddress) return 'N/A';
        const octets = ipAddress.split('.');
        return `.${octets[2]}.${octets[3]}`;
    }

    _timeAgo(date) {
        const now = new Date();
        const diffMs = now - date;
        const diffMins = Math.floor(diffMs / 60000);
        const diffHours = Math.floor(diffMs / 3600000);
        const diffDays = Math.floor(diffMs / 86400000);

        if (diffMins < 1) return 'Just now';
        if (diffMins < 60) return `${diffMins}m ago`;
        if (diffHours < 24) return `${diffHours}h ago`;
        return `${diffDays}d ago`;
    }

    /* ------------------------------------------
       CLEANUP
    ------------------------------------------ */

    destroy() {
        if (this.tooltip) {
            this.tooltip.remove();
            this.tooltip = null;
        }
        this.clear();
        this.onPrinterClick = null;
    }
}