/* ============================================
   KINDpos Overseer — Date Picker Component
   Single date + date range selector.
   Themed with CSS custom properties.
   ============================================ */

let _stylesInjected = false;
function injectDatePickerStyles() {
    if (_stylesInjected) return;
    _stylesInjected = true;
    const style = document.createElement('style');
    style.textContent = `
        .kp-date-input {
            background: var(--color-bg-dark) !important;
            color: var(--color-mint) !important;
            border: 1px solid rgba(var(--color-mint-rgb), 0.25) !important;
            border-radius: 4px;
            font-family: var(--font-body);
            font-size: 18px;
            padding: 5px 10px;
            cursor: pointer;
            outline: none;
            color-scheme: dark;
        }
        .kp-date-input:focus {
            border-color: var(--color-mint) !important;
            box-shadow: 0 0 0 2px rgba(var(--color-mint-rgb), 0.15);
        }
        .kp-date-input::-webkit-calendar-picker-indicator {
            filter: invert(0.8) sepia(1) hue-rotate(90deg);
            cursor: pointer;
        }
        .kp-date-btn {
            background: none; border: none;
            color: var(--color-mint);
            font-size: 18px; cursor: pointer;
            padding: 4px 8px; border-radius: 4px;
            transition: background 0.15s ease;
        }
        .kp-date-btn:hover { background: rgba(var(--color-mint-rgb), 0.12); }
        .kp-date-btn:disabled { opacity: 0.3; cursor: default; }
        .kp-date-btn:disabled:hover { background: none; }
        .kp-preset-btn {
            background: rgba(var(--color-mint-rgb), 0.08);
            border: 1px solid rgba(var(--color-mint-rgb), 0.15);
            border-radius: 4px; color: var(--color-mint);
            font-family: var(--font-body); font-size: 16px;
            padding: 3px 10px; cursor: pointer;
            transition: all 0.15s ease;
        }
        .kp-preset-btn:hover {
            background: rgba(var(--color-mint-rgb), 0.2);
            border-color: rgba(var(--color-mint-rgb), 0.4);
        }
        .kp-date-wrapper {
            display: inline-flex; align-items: center; gap: 8px;
            background: rgba(var(--color-mint-rgb), 0.04);
            border: 1px solid rgba(var(--color-mint-rgb), 0.15);
            border-radius: 6px; padding: 6px 12px;
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
    prevBtn.textContent = '\u25C0';
    prevBtn.className = 'kp-date-btn';

    const label = document.createElement('span');
    label.style.cssText = `
        font-family: var(--font-body); font-size: 20px;
        color: var(--color-gold); min-width: 160px; text-align: center;
        cursor: pointer;
    `;

    const nextBtn = document.createElement('button');
    nextBtn.textContent = '\u25B6';
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
    sep.textContent = '\u2192';
    sep.style.cssText = 'color: rgba(var(--color-mint-rgb), 0.4); font-size: 20px; padding: 0 4px;';

    const endInput = makeInput(currentEnd, fmt(new Date()), (v) => {
        currentEnd = v;
        if (currentEnd < currentStart) {
            currentStart = currentEnd;
            startInput.value = currentStart;
        }
        if (onChange) onChange({ start: currentStart, end: currentEnd });
    });

    const presets = document.createElement('div');
    presets.style.cssText = 'display: flex; gap: 4px; margin-left: 8px;';

    [{ label: '7d', days: 7 }, { label: '14d', days: 14 }, { label: '30d', days: 30 }].forEach(p => {
        const btn = document.createElement('button');
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
