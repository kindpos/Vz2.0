// Tests for terminal/scenes/login.js — pins the 429 vs "INVALID PIN" split
// (managers used to retype valid PINs thinking they were typo'd), the
// setToken-on-success flow, and the state.locked double-submit gate.
//
// `_attemptLogin` is module-local (not exported), so we drive the scene through
// its public surface: capture numpad.onSubmit via a buildNumpad mock, then
// invoke that captured callback to simulate a PIN submission. The DOM + toast +
// pill button + auth-client are mocked — this is a pin test, not a full render.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const setTokenMock  = vi.fn();
const clearTokenMock = vi.fn();
const mountWorkingMock = vi.fn();
const closeGateMock    = vi.fn();

// Capture every `defineScene` call so the test can drive the render.
const registeredScenes = [];

// Holder the numpad mock writes to so tests can grab the current `onSubmit`.
let currentNumpad = null;

vi.mock('../auth-client.js', () => ({
  setToken:   setTokenMock,
  clearToken: clearTokenMock,
}));

vi.mock('../scene-manager.js', () => ({
  defineScene: (def) => { registeredScenes.push(def); return def; },
  SceneManager: {
    mountWorking:  mountWorkingMock,
    closeGate:     closeGateMock,
    openGate:      vi.fn(),
    init:          vi.fn(),
    register:      vi.fn(),
    on:            vi.fn(),
    off:           vi.fn(),
    emit:          vi.fn(),
  },
}));

vi.mock('../theme-manager.js', () => ({
  buildPillButton:    () => document.createElement('button'),
  buildSectionLabel:  () => document.createElement('div'),
  buildDivider:       () => document.createElement('div'),
  hexToRgba:          () => 'rgba(0,0,0,0)',
}));

vi.mock('../numpad.js', () => ({
  buildNumpad: (opts) => {
    const el = document.createElement('div');
    el._opts = opts;
    el.setError = vi.fn();
    currentNumpad = el;
    return el;
  },
}));

vi.mock('../components.js', () => ({
  showToast: vi.fn(),
}));

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

// Wait for queued microtasks/macrotasks so the async `_attemptLogin` chain
// (fetch → json → setToken → onSuccess) settles before assertions.
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('terminal/scenes/login', () => {
  let fetchMock;
  let originalFetch;
  let sceneDef;
  let state;

  beforeEach(async () => {
    vi.resetModules();
    registeredScenes.length = 0;
    currentNumpad = null;
    setTokenMock.mockClear();
    clearTokenMock.mockClear();
    mountWorkingMock.mockClear();
    closeGateMock.mockClear();

    originalFetch = window.fetch;
    fetchMock = vi.fn(() => Promise.resolve(jsonResponse({})));
    window.fetch = fetchMock;

    // Importing the module triggers defineScene() once.
    await import('./login.js');
    expect(registeredScenes).toHaveLength(1);
    sceneDef = registeredScenes[0];

    // Drive render. The scene provides its own state via defineScene's state
    // option; mimic that here by deep-cloning the declared defaults.
    state = JSON.parse(JSON.stringify(sceneDef.state || {}));
    const container = document.createElement('div');
    sceneDef.render(container, {}, state);

    expect(currentNumpad).not.toBeNull();
  });

  afterEach(() => {
    window.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('429 from verify-pin → numpad shows "TOO MANY ATTEMPTS" (distinct from invalid-PIN)', async () => {
    // First call is verify-pin; after 429 no follow-up fetches fire.
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 429 }));

    currentNumpad._opts.onSubmit('1234');
    await flush();

    expect(currentNumpad.setError).toHaveBeenCalledWith('TOO MANY ATTEMPTS');
    expect(setTokenMock).not.toHaveBeenCalled();
    expect(state.locked).toBe(false);
  });

  it('200 with valid:false → numpad shows the default "INVALID PIN" message', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ valid: false }));

    currentNumpad._opts.onSubmit('0000');
    await flush();

    expect(currentNumpad.setError).toHaveBeenCalledWith('INVALID PIN');
    expect(setTokenMock).not.toHaveBeenCalled();
    expect(state.locked).toBe(false);
  });

  it('200 with valid:true → setToken is called with the full response payload', async () => {
    const authPayload = {
      valid: true,
      token: 'tok-xyz',
      employee_id: 'e42',
      name: 'Mel Manager',
      roles: ['manager'],
    };
    fetchMock
      .mockResolvedValueOnce(jsonResponse(authPayload))          // verify-pin
      .mockResolvedValue(jsonResponse({ staff: [] }));           // clocked-in lookup + any fallthrough calls

    currentNumpad._opts.onSubmit('4321');
    await flush();
    await flush(); // Let the clocked-in chain settle too, to avoid unhandled rejections.

    expect(setTokenMock).toHaveBeenCalledTimes(1);
    expect(setTokenMock).toHaveBeenCalledWith(authPayload);
  });

  it('state.locked gates double-submit: second call while first is in flight is a no-op', async () => {
    // First fetch hangs forever; the in-flight guard should prevent the second onSubmit
    // from dispatching anything, including a second fetch.
    let resolveFirst;
    fetchMock.mockImplementationOnce(() => new Promise((r) => { resolveFirst = r; }));

    currentNumpad._opts.onSubmit('1111');
    expect(state.locked).toBe(true);

    // Second submit while first is in flight — should be a hard no-op.
    currentNumpad._opts.onSubmit('2222');

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(setTokenMock).not.toHaveBeenCalled();

    // Clean up by letting the first request resolve with a non-token response.
    resolveFirst(jsonResponse({ valid: false }));
    await flush();
    expect(state.locked).toBe(false);
  });
});
