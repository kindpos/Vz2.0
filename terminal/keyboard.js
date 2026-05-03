// ═══════════════════════════════════════════════════
//  KINDpos Terminal — Keyboard STUB  (Vz2.0)
//  Temporary replacement for a proper on-screen QWERTY keyboard.
//  Public API: showKeyboard / hideKeyboard / isKeyboardVisible.
//  Uses a simple modal with a native <input> — the OS on-screen
//  keyboard (touch devices) or physical keyboard (desktop) handles
//  the actual typing.
//
//  TODO: Replace with a proper Vz2.0 on-screen QWERTY component.
// ═══════════════════════════════════════════════════

import { T } from '../common/tokens.js';
import { buildStaticCard, buildPillButton } from './theme-manager.js';

let _root = null;
let _visible = false;
let _opts = {};
let _input = null;

// ═══════════════════════════════════════════════════
//  PUBLIC API
// ═══════════════════════════════════════════════════

export function showKeyboard(opts) {
  _opts = opts || {};
  _buildIfNeeded();
  _input.value = _opts.initialValue || '';
  _input.placeholder = _opts.placeholder || '';
  if (_opts.maxLength) {
    const maxLen = typeof _opts.maxLength === 'number'
      && _opts.maxLength > 0 ? _opts.maxLength : 64;
    _input.maxLength = maxLen;
  }
  else _input.removeAttribute('maxlength');

  const host = document.getElementById('terminal') || document.body;
  if (!_root.parentNode) host.appendChild(_root);

  _visible = true;
  // Focus on the next frame so the input is actually in the DOM
  requestAnimationFrame(() => {
    _input.focus();
    _input.setSelectionRange(_input.value.length, _input.value.length);
  });
}

export function hideKeyboard() {
  if (!_visible) return;
  _visible = false;
  _opts = {};
  if (_root && _root.parentNode) _root.parentNode.removeChild(_root);
}

export function isKeyboardVisible() {
  return _visible;
}

// ═══════════════════════════════════════════════════
//  INTERNAL — build the modal once, reuse
// ═══════════════════════════════════════════════════

function _buildIfNeeded() {
  if (_root) return;

  _root = document.createElement('div');
  _root.style.cssText = [
    'position:absolute;inset:0;z-index:200;',
    'background:rgba(0,0,0,0.55);',
    'display:flex;align-items:center;justify-content:center;',
  ].join('');

  // Dismiss on backdrop tap
  _root.addEventListener('pointerup', (e) => {
    if (e.target === _root) {
      if (_opts.onDismiss) _opts.onDismiss();
      hideKeyboard();
    }
  });

  const shell = buildStaticCard({ accent: T.green });
  shell.style.display       = 'flex';
  shell.style.flexDirection = 'column';
  shell.style.gap           = '14px';
  shell.style.minWidth      = '360px';
  shell.style.maxWidth      = '480px';
  shell.style.padding       = '24px 28px 28px 32px';
  const panel = shell;

  const label = document.createElement('div');
  label.style.cssText = [
    `font-family:${T.fh};`,
    `font-size:${T.fsB2};`,
    `font-weight:${T.fwBold};`,
    `color:${T.green};`,
    'letter-spacing:0.18em;',
    'text-transform:uppercase;',
    'text-align:center;',
  ].join('');
  label.textContent = 'ENTER TEXT';
  panel.appendChild(label);

  _input = document.createElement('input');
  _input.type = 'text';
  _input.style.cssText = `${[
    'width:100%;box-sizing:border-box;',
    'padding:12px 14px;',
    `background:${T.well};`,
    `border:2px solid ${T.border};`,
    'border-radius:8px;',
    `font-family:${T.fb};`,
    `font-size:${T.fsB1};`,
    `color:${T.text};`,
    'outline:none;',
  ].join('')};font-weight:${T.fwBold};`;
  _input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      _handleDone();
    } else if (e.key === 'Escape') {
      if (_opts.onDismiss) _opts.onDismiss();
      hideKeyboard();
    } else if (_opts.onInput) {
      // defer so value reflects the new keystroke
      setTimeout(() => { _opts.onInput(_input.value); }, 0);
    }
  });
  panel.appendChild(_input);

  const btnRow = document.createElement('div');
  btnRow.style.cssText = 'display:flex;gap:12px;justify-content:space-between;';

  // Button hierarchy: CANCEL (verm destructive) + DONE (mint primary).
  const cancelBtn = buildPillButton({
    label:    'CANCEL',
    variant:  'verm',
    fontSize: T.fsB2,
    onClick:  () => {
      if (_opts.onDismiss) _opts.onDismiss();
      hideKeyboard();
    },
  });
  cancelBtn.style.flex           = '1';
  cancelBtn.style.borderRadius   = '14px';
  cancelBtn.style.display        = 'flex';
  cancelBtn.style.alignItems     = 'center';
  cancelBtn.style.justifyContent = 'center';

  const doneBtn = buildPillButton({
    label:    'DONE',
    variant:  'mint',
    fontSize: T.fsB2,
    onClick:  _handleDone,
  });
  doneBtn.style.flex           = '1';
  doneBtn.style.borderRadius   = '14px';
  doneBtn.style.display        = 'flex';
  doneBtn.style.alignItems     = 'center';
  doneBtn.style.justifyContent = 'center';

  btnRow.appendChild(cancelBtn);
  btnRow.appendChild(doneBtn);
  panel.appendChild(btnRow);

  _root.appendChild(shell);
}

function _handleDone() {
  const val = _input.value;
  if (_opts.onDone) _opts.onDone(val);
  if (_opts.dismissOnDone !== false) hideKeyboard();
}