// Tests for overseer/src/components/date-picker.js — covers the two
// public builders that drive date selection across the REPORTING
// section, Payroll & Attendance, and the Timeclock tab.
//
// Behaviors pinned:
//   buildDatePicker          — prev / next shift by 1 day, next disabled
//                              at today, onChange fires with the new
//                              date string, label→input swap on click,
//                              picking a date via the native input
//                              fires onChange and re-shows the label.
//   buildDateRangePicker     — start / end inputs fire onChange with
//                              { start, end }, start > end clamps end
//                              (and vice-versa), presets 7d/14d/30d
//                              set the range anchored at today.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { buildDatePicker, buildDateRangePicker } from './date-picker.js';

function fmt(d) { return d.toISOString().slice(0, 10); }
function shift(dateStr, days) {
  const d = new Date(dateStr + 'T12:00:00');
  d.setDate(d.getDate() + days);
  return fmt(d);
}

describe('overseer/src/components/date-picker > buildDatePicker', () => {
  let container;
  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
  });
  afterEach(() => { container.remove(); });

  it('renders prev / next / label in a wrapper', () => {
    const picker = buildDatePicker({ value: '2026-04-22', onChange: () => {} });
    container.appendChild(picker);
    const [prev, label, next] = picker.children;
    expect(prev.textContent).toBe('◀');
    expect(next.textContent).toBe('▶');
    expect(label.textContent).toMatch(/Apr 22, 2026/);
  });

  it('next button is disabled when current date is today', () => {
    const today = fmt(new Date());
    const picker = buildDatePicker({ value: today, onChange: () => {} });
    container.appendChild(picker);
    const next = picker.children[2];
    expect(next.disabled).toBe(true);
  });

  it('prev shifts the date back 1 day and fires onChange', () => {
    const onChange = vi.fn();
    const picker = buildDatePicker({ value: '2026-04-22', onChange });
    container.appendChild(picker);
    picker.children[0].click();                       // prev
    expect(onChange).toHaveBeenCalledWith('2026-04-21');
    expect(picker.children[1].textContent).toMatch(/Apr 21, 2026/);
  });

  it('next shifts the date forward 1 day when not at today', () => {
    const today = fmt(new Date());
    const twoDaysAgo = shift(today, -2);
    const oneDayAgo  = shift(today, -1);
    const onChange = vi.fn();
    const picker = buildDatePicker({ value: twoDaysAgo, onChange });
    container.appendChild(picker);
    picker.children[2].click();                       // next
    expect(onChange).toHaveBeenCalledWith(oneDayAgo);
    // After landing one day before today, next is still enabled.
    expect(picker.children[2].disabled).toBe(false);
    picker.children[2].click();                       // next → today
    expect(onChange).toHaveBeenLastCalledWith(today);
    expect(picker.children[2].disabled).toBe(true);   // now pinned
  });

  it('clicking the label swaps in a native date input focused at the current value', () => {
    const picker = buildDatePicker({ value: '2026-04-22', onChange: () => {} });
    container.appendChild(picker);
    const label = picker.children[1];
    label.click();
    // After click, the wrapper's middle child is now an <input type=date>
    const swapped = picker.children[1];
    expect(swapped.tagName).toBe('INPUT');
    expect(swapped.type).toBe('date');
    expect(swapped.value).toBe('2026-04-22');
  });

  it('picking a new date from the native input fires onChange and restores the label', () => {
    const onChange = vi.fn();
    const picker = buildDatePicker({ value: '2026-04-22', onChange });
    container.appendChild(picker);
    picker.children[1].click();                       // open native input
    const input = picker.children[1];
    input.value = '2026-04-15';
    input.dispatchEvent(new Event('change'));
    expect(onChange).toHaveBeenCalledWith('2026-04-15');
    // Label is back in place with the new date formatted.
    const label = picker.children[1];
    expect(label.tagName).toBe('SPAN');
    expect(label.textContent).toMatch(/Apr 15, 2026/);
  });
});

describe('overseer/src/components/date-picker > buildDateRangePicker', () => {
  let container;
  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
  });
  afterEach(() => { container.remove(); });

  it('renders two native date inputs, a separator, and 7d/14d/30d presets', () => {
    const picker = buildDateRangePicker({
      start: '2026-04-15', end: '2026-04-22', onChange: () => {},
    });
    container.appendChild(picker);
    const inputs = picker.querySelectorAll('input[type="date"]');
    expect(inputs.length).toBe(2);
    expect(inputs[0].value).toBe('2026-04-15');
    expect(inputs[1].value).toBe('2026-04-22');
    const presets = picker.querySelectorAll('button');
    expect([...presets].map(b => b.textContent)).toEqual(['7d', '14d', '30d']);
  });

  it('editing start fires onChange with both ends', () => {
    const onChange = vi.fn();
    const picker = buildDateRangePicker({
      start: '2026-04-15', end: '2026-04-22', onChange,
    });
    container.appendChild(picker);
    const [startInput, endInput] = picker.querySelectorAll('input[type="date"]');
    startInput.value = '2026-04-10';
    startInput.dispatchEvent(new Event('change'));
    expect(onChange).toHaveBeenCalledWith({ start: '2026-04-10', end: '2026-04-22' });
  });

  it('editing end fires onChange with both ends', () => {
    const onChange = vi.fn();
    const picker = buildDateRangePicker({
      start: '2026-04-15', end: '2026-04-22', onChange,
    });
    container.appendChild(picker);
    const [, endInput] = picker.querySelectorAll('input[type="date"]');
    endInput.value = '2026-04-21';
    endInput.dispatchEvent(new Event('change'));
    expect(onChange).toHaveBeenCalledWith({ start: '2026-04-15', end: '2026-04-21' });
  });

  it('auto-clamps end when start is moved past it', () => {
    const onChange = vi.fn();
    const picker = buildDateRangePicker({
      start: '2026-04-15', end: '2026-04-22', onChange,
    });
    container.appendChild(picker);
    const [startInput, endInput] = picker.querySelectorAll('input[type="date"]');
    // Admin wants a 1-day range starting 2026-04-25; the picker should
    // clamp end → start so downstream fetches don't query a negative range.
    startInput.value = '2026-04-25';
    startInput.dispatchEvent(new Event('change'));
    expect(onChange).toHaveBeenCalledWith({ start: '2026-04-25', end: '2026-04-25' });
    expect(endInput.value).toBe('2026-04-25');
  });

  it('auto-clamps start when end is moved before it', () => {
    const onChange = vi.fn();
    const picker = buildDateRangePicker({
      start: '2026-04-15', end: '2026-04-22', onChange,
    });
    container.appendChild(picker);
    const [startInput, endInput] = picker.querySelectorAll('input[type="date"]');
    endInput.value = '2026-04-10';
    endInput.dispatchEvent(new Event('change'));
    expect(onChange).toHaveBeenCalledWith({ start: '2026-04-10', end: '2026-04-10' });
    expect(startInput.value).toBe('2026-04-10');
  });

  it('presets anchor the range at today', () => {
    const onChange = vi.fn();
    const picker = buildDateRangePicker({
      start: '2026-04-15', end: '2026-04-22', onChange,
    });
    container.appendChild(picker);
    const presets = picker.querySelectorAll('button');
    const today = fmt(new Date());

    presets[0].click();                                // 7d
    expect(onChange).toHaveBeenLastCalledWith({ start: shift(today, -7),  end: today });

    presets[1].click();                                // 14d
    expect(onChange).toHaveBeenLastCalledWith({ start: shift(today, -14), end: today });

    presets[2].click();                                // 30d
    expect(onChange).toHaveBeenLastCalledWith({ start: shift(today, -30), end: today });

    // Inputs reflect the most recent (30d) press.
    const [startInput, endInput] = picker.querySelectorAll('input[type="date"]');
    expect(startInput.value).toBe(shift(today, -30));
    expect(endInput.value).toBe(today);
  });
});
