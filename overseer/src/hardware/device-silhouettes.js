// overseer/src/hardware/device-silhouettes.js
// Pure SVG device silhouettes. No token imports — caller passes color string.
// All geometry proportional to `size`. Returns HTMLElement (<svg>).

const NS = 'http://www.w3.org/2000/svg';

function svg(size, viewBox) {
    const el = document.createElementNS(NS, 'svg');
    el.setAttribute('width', size);
    el.setAttribute('height', size);
    el.setAttribute('viewBox', viewBox || `0 0 ${size} ${size}`);
    el.setAttribute('fill', 'none');
    el.style.display = 'block';
    el.style.flexShrink = '0';
    return el;
}

function rect(x, y, w, h, rx, attrs) {
    const el = document.createElementNS(NS, 'rect');
    el.setAttribute('x', x); el.setAttribute('y', y);
    el.setAttribute('width', w); el.setAttribute('height', h);
    if (rx) el.setAttribute('rx', rx);
    Object.entries(attrs || {}).forEach(([k, v]) => el.setAttribute(k, v));
    return el;
}

function circle(cx, cy, r, attrs) {
    const el = document.createElementNS(NS, 'circle');
    el.setAttribute('cx', cx); el.setAttribute('cy', cy); el.setAttribute('r', r);
    Object.entries(attrs || {}).forEach(([k, v]) => el.setAttribute(k, v));
    return el;
}

function line(x1, y1, x2, y2, attrs) {
    const el = document.createElementNS(NS, 'line');
    el.setAttribute('x1', x1); el.setAttribute('y1', y1);
    el.setAttribute('x2', x2); el.setAttribute('y2', y2);
    Object.entries(attrs || {}).forEach(([k, v]) => el.setAttribute(k, v));
    return el;
}

// Router: wide body, two antennas, four ports along bottom, four LEDs on face
export function buildRouterSVG(color, size = 32) {
    const s = svg(size, '0 0 32 32');
    const bx = 3, by = 16, bw = 26, bh = 10;

    s.appendChild(rect(bx, by, bw, bh, 2, { fill: color, opacity: '0.2', stroke: color, 'stroke-width': '1' }));

    // Antennas
    s.appendChild(line(9, by, 7, 5, { stroke: color, 'stroke-width': '1.5', 'stroke-linecap': 'round' }));
    s.appendChild(line(23, by, 25, 5, { stroke: color, 'stroke-width': '1.5', 'stroke-linecap': 'round' }));

    // Ports (four along bottom)
    [4, 9, 14, 19].forEach(x =>
        s.appendChild(rect(x, by + bh - 3, 4, 3, 1, { fill: color, opacity: '0.55' }))
    );

    // LEDs (four on face)
    [6, 10, 14, 18].forEach((x, i) =>
        s.appendChild(circle(x, by + 4, 1.5, { fill: color, opacity: i === 0 ? '1' : '0.35' }))
    );

    return s;
}

// Printer: body rect, paper slot, paper stub, LED, two buttons
// thermal (P80): wider, lower profile  |  impact (TM-U220): narrower, taller
export function buildPrinterSVG(color, size = 32, variant = 'thermal') {
    const s = svg(size, '0 0 32 32');
    const isThermal = variant !== 'impact';
    const bw = isThermal ? 24 : 18;
    const bh = isThermal ? 10 : 14;
    const bx = (32 - bw) / 2;
    const by = isThermal ? 14 : 11;
    const stubH = isThermal ? 5 : 8;
    const paperW = Math.round(bw * 0.5);

    // Paper stub (emerges above body)
    s.appendChild(rect(bx + (bw - paperW) / 2, by - stubH, paperW, stubH, 0, { fill: color, opacity: '0.45' }));

    // Body
    s.appendChild(rect(bx, by, bw, bh, 2, { fill: color, opacity: '0.18', stroke: color, 'stroke-width': '1' }));

    // Paper slot line
    s.appendChild(line(bx + 3, by + 3, bx + bw - 3, by + 3, { stroke: color, 'stroke-width': '1', opacity: '0.7' }));

    // LED dot
    s.appendChild(circle(bx + bw - 4, by + 6, 1.5, { fill: color }));

    // Two buttons
    [bx + 4, bx + 8].forEach(x =>
        s.appendChild(rect(x, by + 6, 3, 2, 1, { fill: color, opacity: '0.65' }))
    );

    return s;
}

// Card reader: portrait body, screen, 3×3 keypad grid, card slot
export function buildCardReaderSVG(color, size = 32) {
    const s = svg(size, '0 0 32 32');
    const bx = 7, by = 3, bw = 18, bh = 26;

    // Body
    s.appendChild(rect(bx, by, bw, bh, 3, { fill: color, opacity: '0.14', stroke: color, 'stroke-width': '1' }));

    // Screen (top-third)
    s.appendChild(rect(bx + 2, by + 2, bw - 4, 7, 1, { fill: color, opacity: '0.38' }));

    // 3×3 keypad dot grid (center)
    for (let r = 0; r < 3; r++) {
        for (let c = 0; c < 3; c++) {
            s.appendChild(circle(bx + 5 + c * 4, by + 13 + r * 4, 1.5, { fill: color, opacity: '0.65' }));
        }
    }

    // Card slot (stroke only, bottom)
    s.appendChild(rect(bx + 2, by + bh - 4, bw - 4, 2, 1, { stroke: color, 'stroke-width': '1' }));

    return s;
}

// Terminal (Pi board): landscape rect, GPIO header stubs, status LED
export function buildTerminalSVG(color, size = 24) {
    const s = svg(size, '0 0 24 24');
    const bx = 3, by = 7, bw = 18, bh = 11;

    // Board body
    s.appendChild(rect(bx, by, bw, bh, 2, { fill: color, opacity: '0.18', stroke: color, 'stroke-width': '1' }));

    // GPIO header stubs (top edge)
    [6, 11].forEach(x =>
        s.appendChild(rect(x, by - 3, 4, 3, 0, { fill: color, opacity: '0.55' }))
    );

    // Status LED
    s.appendChild(circle(bx + bw - 3, by + 3, 1.5, { fill: color }));

    return s;
}
