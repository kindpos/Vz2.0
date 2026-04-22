/* ============================================
   KINDpos Overseer — Employee event payload builders
   ============================================

   Pure, side-effect-free builders for the `employee.updated` and
   `employee.created` event payloads that get sent to /api/v1/config/push.

   These used to be inlined in employees.js. Split here so the wire
   contract (and the historically-important PIN-reset regression — the
   payload must send `pin: <string>`, NOT `new_pin_hash: 'SHA256_SIMULATED'`)
   can be unit-tested without mounting the whole employees scene.
*/

/**
 * Payload for a PIN reset. The ledger writer at /config/push runs the
 * `pin` field through ensure_hashed_pin; a plaintext PIN here is what
 * the backend expects.
 *
 * @param {string}  employeeId
 * @param {string}  newPIN       4–6 digit string the manager picked or
 *                                that generatePIN() returned.
 * @param {boolean} forceChange  Prompt the employee to change on next login.
 * @returns {{employee_id:string, pin:string, force_change_on_login:boolean, reset_reason:string}}
 */
export function buildPinResetPayload(employeeId, newPIN, forceChange) {
    return {
        employee_id: employeeId,
        pin: newPIN,
        force_change_on_login: !!forceChange,
        reset_reason: 'Manager-initiated reset',
    };
}

/**
 * Payload for an edit-without-reset. CRUCIAL: must NOT include `pin`.
 * The existing hashed PIN on the employee record is preserved.
 *
 * @param {{id:string, firstName:string, lastName:string, roles:Array<string>, payRate:number, status:string}} employee
 * @returns {{employee_id:string, first_name:string, last_name:string, display_name:string, role_ids:Array<string>, hourly_rate:number, active:boolean}}
 */
export function buildEmployeeUpdatePayload(employee) {
    return {
        employee_id:  employee.id,
        first_name:   employee.firstName,
        last_name:    employee.lastName,
        display_name: (employee.firstName || '') + ' ' + (employee.lastName || ''),
        role_ids:     employee.roles || [],
        hourly_rate:  employee.payRate,
        active:       employee.status === 'active',
    };
}

/**
 * Payload for create. New employees DO carry a plaintext pin which the
 * /config/push handler hashes server-side.
 *
 * @param {{id:string, firstName:string, lastName:string, roles:Array<string>, payRate:number, status:string}} employee
 * @param {string} pin
 * @returns {object}
 */
export function buildEmployeeCreatePayload(employee, pin) {
    return {
        employee_id:  employee.id,
        first_name:   employee.firstName,
        last_name:    employee.lastName,
        display_name: (employee.firstName || '') + ' ' + (employee.lastName || ''),
        role_ids:     employee.roles || [],
        hourly_rate:  employee.payRate,
        pin:          pin,
        active:       employee.status === 'active',
    };
}
