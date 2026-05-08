// Tests for overseer/src/services/config-push.js — the single egress for
// every Overseer config write (employees, tip pools, printer setup, etc.).
// Everything that calls emitEvent in a section flushes through here, so a
// regression in the wire shape or error-handling silently breaks every
// config-editing path in the app.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { pushChanges } from './config-push.js';

const jsonResponse = (body, status = 200) => {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
};

describe('overseer/src/services/config-push', () => {
  let fetchMock;
  let originalFetch;

  beforeEach(() => {
    originalFetch = window.fetch;
    fetchMock = vi.fn();
    window.fetch = fetchMock;
    // Silence the console.log/error chatter the module emits.
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    window.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('empty events → no fetch, resolves { ok: true, events_written: 0 }', async () => {
    const result = await pushChanges([]);
    expect(result).toEqual({ ok: true, events_written: 0 });
    expect(fetchMock).not.toHaveBeenCalled();

    // Also for nullish inputs.
    expect(await pushChanges(null)).toEqual({ ok: true, events_written: 0 });
    expect(await pushChanges(undefined)).toEqual({ ok: true, events_written: 0 });
  });

  it('POSTs to /api/v1/config/push with an array of {event_type, payload} entries', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ events_written: 2 }));

    const result = await pushChanges([
      { event_type: 'employee.updated', payload: { employee_id: 'e1' } },
      { event_type: 'employee.created', payload: { employee_id: 'e2', pin: '1234' } },
    ]);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/v1/config/push');
    expect(init.method).toBe('POST');
    expect(init.headers['Content-Type']).toBe('application/json');

    const body = JSON.parse(init.body);
    expect(body).toEqual([
      { event_type: 'employee.updated', payload: { employee_id: 'e1' } },
      { event_type: 'employee.created', payload: { employee_id: 'e2', pin: '1234' } },
    ]);

    expect(result).toEqual({ ok: true, events_written: 2 });
  });

  it('strips extraneous fields on events — only event_type + payload are sent', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ events_written: 1 }));

    await pushChanges([{
      event_type: 'employee.updated',
      payload: { employee_id: 'e1' },
      // These MUST NOT leak through to the backend.
      client_timestamp: 12345,
      retry_count: 2,
      id: 'local-uuid',
    }]);

    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body[0]).toEqual({
      event_type: 'employee.updated',
      payload: { employee_id: 'e1' },
    });
    expect(body[0]).not.toHaveProperty('client_timestamp');
    expect(body[0]).not.toHaveProperty('retry_count');
    expect(body[0]).not.toHaveProperty('id');
  });

  it('non-ok response → { ok: false, error: "Server responded <status>" } (no throw)', async () => {
    fetchMock.mockResolvedValueOnce(new Response('validation failed', { status: 400 }));

    const result = await pushChanges([{ event_type: 'x.y', payload: {} }]);

    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/400/);
  });

  it('network error → { ok: false, error: <message> } (no throw, callers can retry)', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('NetworkError'));

    const result = await pushChanges([{ event_type: 'x.y', payload: {} }]);

    expect(result.ok).toBe(false);
    expect(result.error).toBe('NetworkError');
  });
});
