/* ============================================
   KINDpos Overseer — Date Picker Component
   Single date + date range selector, Nostalgia styling.

   Public API (unchanged from the Vz1.x version):
     buildDatePicker({ value, onChange })
     buildDateRangePicker({ start, end, onChange })

   Both return a DOM element you can append anywhere — colors,
   radii, and type scale route through ui/tokens.js so the
   look stays consistent with the rest of the port.
   ============================================ */

import { T, withAlpha } from '../ui/tokens.js';

let _stylesInjected = false;
function injectDatePickerStyles() {
    if (_stylesInjected) return;
    _stylesInjected = true;
    const style = document.createElement('style');
    style.id = 'kp-date-picker-styles';
    style.textContent = `
        .kp-date-input {
            background: ${T.well} !important;
            color: ${T.text} !important;
            border: 1px solid ${T.border} !important;
            border-radius: ${T.r.sm}px;
            font-family: ${T.font.mono};
            font-size: ${T.fs.base}px;
            letter-spacing: 0.5px;
            padding: 8px 12px;
            cursor: pointer;
            outline: none;
            color-scheme: dark;
            transition: border-color 0.15s ease, box-shadow 0.15s ease;
        }
        .kp-date-input:focus,
        .kp-date-input:hover {
            border-color: ${T.gold} !important;
        }
        .kp-date-input:focus {
            box-shadow: 0 0 0 2px ${withAlpha(T.gold, 0.18)};
        }
        /* Native calendar-icon glyph — tint neutral-light so it
           reads well on T.well regardless of accent. */
        .kp-date-input::-webkit-calendar-picker-indicator {
            filter: invert(0.65);
            cursor: pointer;
            opacity: 0.85;
        }

        .kp-date-btn {
            background: transparent;
            border: none;
            color: ${T.textMuted};
            font-size: ${T.fs.lg}px;
            cursor: pointer;
            padding: 4px 10px;
            border-radius: ${T.r.sm}px;
            transition: background 0.15s ease, color 0.15s ease;
        }
        .kp-date-btn:hover {
            background: ${withAlpha(T.text, 0.06)};
            color: ${T.text};
        }
        .kp-date-btn:disabled { opacity: 0.25; cursor: default; }
        .kp-date-btn:disabled:hover { background: transparent; color: ${T.textMuted}; }

        .kp-preset-btn {
            background: transparent;
            border: 1px solid ${T.border};
            border-radius: ${T.r.pill}px;
            color: ${T.textMuted};
            font-family: ${T.font.mono};
            font-size: ${T.fs.sm}px;
            letter-spacing: 1px;
            font-weight: 700;
            text-transform: uppercase;
            padding: 5px 12px;
            cursor: pointer;
            transition: border-color 0.15s ease, color 0.15s ease, background 0.15s ease;
        }
        .kp-preset-btn:hover {
            border-color: ${T.gold};
            color: ${T.gold};
            background: ${withAlpha(T.gold, 0.08)};
        }

        .kp-date-wrapper {
            display: inline-flex;
            align-items: center;
            gap: ${T.sp.sm}px;
            background: ${T.card};
            border: 1px solid ${T.border};
            border-radius: ${T.r.pill}px;
            padding: 6px 12px;
        }

        .kp-date-label {
            font-family: ${T.font.mono};
            font-size: ${T.fs.base}px;
            letter-spacing: 0.5px;
            color: ${T.gold};
            min-width: 160px;
            text-align: center;
            cursor: pointer;
            padding: 4px 8px;
            border-radius: ${T.r.sm}px;
            transition: background 0.15s ease;
        }
        .kp-date-label:hover { background: ${withAlpha(T.gold, 0.08)}; }

        .kp-date-sep {
            color: ${T.textDim};
            font-size: ${T.fs.lg}px;
            padding: 0 6px;
        }
    `;
    document.head.appendChild(style);
}

function fmt(date) {
    return date.toISOString().slice(0, 10);
}

function display(dateStr) {
    return new Date(dateStr + 'T12:00:00').toLocaleDateString('en-US', {
        month: 'short', day: 'numeric', year: 'numeric',
    });
}

function shiftDate(dateStr, days) {
    const d = new Date(dateStr + 'T12:00:00');
    d.setDate(d.getDate() + days);
    return fmt(d);
}

export function buildDatePicker({ value, onChange }) {
    injectDatePickerStyles();
    let current = value || fmt(new Date());

    const wrapper = document.createElement('div');
    wrapper.className = 'kp-date-wrapper';

    const prevBtn = document.createElement('button');
    prevBtn.type = 'button';
    prevBtn.textContent = '◀';
    prevBtn.className = 'kp-date-btn';

    const label = document.createElement('span');
    label.className = 'kp-date-label';

    const nextBtn = document.createElement('button');
    nextBtn.type = 'button';
    nextBtn.textContent = '▶';
    nextBtn.className = 'kp-date-btn';

    function update(newDate, fireChange = true) {
        current = newDate;
        label.textContent = display(current);
        nextBtn.disabled = current >= fmt(new Date());
        if (fireChange && onChange) onChange(current);
    }

    prevBtn.addEventListener('click', () => update(shiftDate(current, -1)));
    nextBtn.addEventListener('click', () => update(shiftDate(current, 1)));
    label.addEventListener('click', () => {
        const input = document.createElement('input');
        input.type = 'date';
        input.value = current;
        input.max = fmt(new Date());
        input.className = 'kp-date-input';
        input.addEventListener('change', () => {
            if (input.value) update(input.value);
            input.replaceWith(label);
        });
        input.addEventListener('blur', () => input.replaceWith(label));
        label.replaceWith(input);
        input.focus();
    });

    wrapper.appendChild(prevBtn);
    wrapper.appendChild(label);
    wrapper.appendChild(nextBtn);

    update(current, false);
    return wrapper;
}

export function buildDateRangePicker({ start, end, onChange }) {
    injectDatePickerStyles();
    let currentStart = start || shiftDate(fmt(new Date()), -7);
    let currentEnd = end || fmt(new Date());

    const wrapper = document.createElement('div');
    wrapper.className = 'kp-date-wrapper';

    function makeInput(val, max, onSet) {
        const input = document.createElement('input');
        input.type = 'date';
        input.value = val;
        if (max) input.max = max;
        input.className = 'kp-date-input';
        input.addEventListener('change', () => {
            if (input.value) onSet(input.value);
        });
        return input;
    }

    const startInput = makeInput(currentStart, fmt(new Date()), (v) => {
        currentStart = v;
        if (currentStart > currentEnd) {
            currentEnd = currentStart;
            endInput.value = currentEnd;
        }
        if (onChange) onChange({ start: currentStart, end: currentEnd });
    });

    const sep = document.createElement('span');
    sep.textContent = '→';
    sep.className = 'kp-date-sep';

    const endInput = makeInput(currentEnd, fmt(new Date()), (v) => {
        currentEnd = v;
        if (currentEnd < currentStart) {
            currentStart = currentEnd;
            startInput.value = currentStart;
        }
        if (onChange) onChange({ start: currentStart, end: currentEnd });
    });

    const presets = document.createElement('div');
    presets.style.cssText = `display: flex; gap: 6px; margin-left: 6px;`;

    [{ label: '7d', days: 7 }, { label: '14d', days: 14 }, { label: '30d', days: 30 }].forEach(p => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.textContent = p.label;
        btn.className = 'kp-preset-btn';
        btn.addEventListener('click', () => {
            currentEnd = fmt(new Date());
            currentStart = shiftDate(currentEnd, -p.days);
            startInput.value = currentStart;
            endInput.value = currentEnd;
            if (onChange) onChange({ start: currentStart, end: currentEnd });
        });
        presets.appendChild(btn);
    });

    wrapper.appendChild(startInput);
    wrapper.appendChild(sep);
    wrapper.appendChild(endInput);
    wrapper.appendChild(presets);

    return wrapper;
}
