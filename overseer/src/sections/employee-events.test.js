// Tests for overseer/src/sections/employee-events.js — pins the shape of
// the employee.updated / employee.created payloads that get written through
// /api/v1/config/push.
//
// The PIN-reset flow is the historically-important one. Earlier code sent
// `new_pin_hash: 'SHA256_SIMULATED'` — a literal string placeholder — so the
// backend never updated the PIN hash. The employee tried the new PIN and
// failed to log in. Pinning the payload shape here means a future refactor
// can't re-introduce that regression.

import { describe, it, expect } from 'vitest';
import {
  buildPinResetPayload,
  buildEmployeeUpdatePayload,
  buildEmployeeCreatePayload,
} from './employee-events.js';

describe('overseer employee event payload builders', () => {
  describe('buildPinResetPayload', () => {
    it('sends the REAL new PIN (not a placeholder hash)', () => {
      const payload = buildPinResetPayload('e42', '4321', true);
      expect(payload.pin).toBe('4321');
      expect(payload).not.toHaveProperty('new_pin_hash');
    });

    it('includes the employee id, force flag, and a reason string', () => {
      expect(buildPinResetPayload('e1', '1234', false)).toEqual({
        employee_id: 'e1',
        pin: '1234',
        force_change_on_login: false,
        reset_reason: 'Manager-initiated reset',
      });
    });

    it('coerces truthy/falsy force-change inputs to booleans', () => {
      expect(buildPinResetPayload('e1', '1234', undefined).force_change_on_login).toBe(false);
      expect(buildPinResetPayload('e1', '1234', null).force_change_on_login).toBe(false);
      expect(buildPinResetPayload('e1', '1234', 1).force_change_on_login).toBe(true);
    });

    it('accepts both auto-generated (4-digit) and custom (up to 6-digit) PINs', () => {
      expect(buildPinResetPayload('e1', '1234', true).pin).toMatch(/^\d{4,6}$/);
      expect(buildPinResetPayload('e1', '654321', true).pin).toMatch(/^\d{4,6}$/);
    });
  });

  describe('buildEmployeeUpdatePayload (edit-without-reset)', () => {
    const EMP = {
      id: 'e7',
      firstName: 'Mel',
      lastName: 'Manager',
      roles: ['manager', 'server'],
      payRate: 18.5,
      status: 'active',
    };

    it('does NOT include `pin` — preserves the existing hashed PIN on the backend', () => {
      const payload = buildEmployeeUpdatePayload(EMP);
      expect(payload).not.toHaveProperty('pin');
    });

    it('produces the exact shape /config/push consumes', () => {
      expect(buildEmployeeUpdatePayload(EMP)).toEqual({
        employee_id:  'e7',
        first_name:   'Mel',
        last_name:    'Manager',
        display_name: 'Mel Manager',
        role_ids:     ['manager', 'server'],
        hourly_rate:  18.5,
        active:       true,
      });
    });

    it('active flips to false for any non-active status', () => {
      expect(buildEmployeeUpdatePayload({ ...EMP, status: 'inactive' }).active).toBe(false);
      expect(buildEmployeeUpdatePayload({ ...EMP, status: 'do_not_rehire' }).active).toBe(false);
    });
  });

  describe('buildEmployeeCreatePayload', () => {
    it('carries the plaintext pin (hashed server-side by /config/push)', () => {
      const payload = buildEmployeeCreatePayload(
        { id: 'e9', firstName: 'New', lastName: 'Hire', roles: ['server'], payRate: 15, status: 'active' },
        '9876',
      );
      expect(payload.pin).toBe('9876');
      expect(payload.employee_id).toBe('e9');
      expect(payload.active).toBe(true);
    });
  });
});
