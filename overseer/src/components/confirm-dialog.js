/**
 * confirm-dialog.js
 * Reusable confirmation modal component.
 * Call initConfirmDialog() once before using showConfirmDialog.
 *
 * Exported API:
 *   initConfirmDialog(C, { openModal, closeModal, buildPillButton })
 *   showConfirmDialog(title, message, confirmLabel, onConfirm)
 */

let _C = null;
let _openModal = null;
let _closeModal = null;
let _buildPillButton = null;

export function initConfirmDialog(C, { openModal, closeModal, buildPillButton }) {
    _C = C;
    _openModal = openModal;
    _closeModal = closeModal;
    _buildPillButton = buildPillButton;
}

export function showConfirmDialog(title, message, confirmLabel, onConfirm) {
    const C = _C;
    _openModal(title, (body) => {
        const msg = document.createElement('div');
        msg.textContent = message;
        msg.style.cssText = `
            font-family: system-ui, sans-serif;
            font-size: 14px;
            color: ${C.text};
            line-height: 1.6;
            margin-bottom: 10px;
        `;
        body.appendChild(msg);

        const footer = document.createElement('div');
        footer.style.cssText = `
            display: flex; gap: 10px; justify-content: flex-end;
            margin-top: 20px;
            padding-top: 16px;
            border-top: 1px solid ${C.hairline};
        `;
        footer.appendChild(_buildPillButton('Cancel', 'tertiary', _closeModal, { small: true }));
        footer.appendChild(_buildPillButton(confirmLabel, 'danger', () => {
            _closeModal();
            onConfirm();
        }, { small: true }));
        body.appendChild(footer);
    }, { accent: C.verm, wide: false });
}
