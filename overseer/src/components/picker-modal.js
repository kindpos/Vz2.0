/**
 * picker-modal.js
 * Reusable chip-tray + picker-modal component.
 * Call initPicker() once before using buildChipTray / openPickerModal.
 *
 * Exported API:
 *   initPicker(C, { openModal, closeModal, buildPillButton, buildTextInput, buildModalFooter })
 *   buildChipTray(container, initialIds, sourceFn, opts) → stateObj
 *   openPickerModal(currentIds, sourceFn, opts, onDone)
 */

let _C = null;
let _openModal = null;
let _closeModal = null;
let _buildPillButton = null;
let _buildTextInput = null;
let _buildModalFooter = null;

export function initPicker(C, { openModal, closeModal, buildPillButton, buildTextInput, buildModalFooter }) {
    _C = C;
    _openModal = openModal;
    _closeModal = closeModal;
    _buildPillButton = buildPillButton;
    _buildTextInput = buildTextInput;
    _buildModalFooter = buildModalFooter;
}

/* ------------------------------------------
   MULTI-SELECT PICKER
   Chip tray + "+ Add" that opens a picker modal
   with three-state checks, search, and delta footer.
   Used by both Group editor (pick modifiers for group)
   and Modifier editor (pick microMODs).
------------------------------------------ */

export function buildChipTray(container, initialIds, sourceFn, opts = {}) {
    const C = _C;
    const state = { ids: [...(initialIds || [])] };
    const tray = document.createElement('div');
    tray.style.cssText = `
        display: flex; flex-wrap: wrap; gap: 6px;
        margin-bottom: 10px;
        min-height: 36px;
        padding: 8px;
        background: ${C.well};
        border-radius: 6px;
        border: 1px dashed ${C.hairline};
    `;

    function render() {
        tray.innerHTML = '';
        if (state.ids.length === 0) {
            const empty = document.createElement('div');
            empty.textContent = opts.emptyHint || 'None selected — tap + to add';
            empty.style.cssText = `
                font-family: ui-monospace, monospace;
                font-size: 11px;
                color: ${C.textDim};
                padding: 4px 6px;
                letter-spacing: 1.5px;
                text-transform: uppercase;
                font-weight: 700;
            `;
            tray.appendChild(empty);
            return;
        }
        const all = sourceFn();
        state.ids.forEach(id => {
            const modifier = all.find(a => a.id === id);
            const chip = document.createElement('span');
            chip.style.cssText = `
                display: inline-flex; align-items: center; gap: 6px;
                padding: 5px 6px 5px 10px;
                background: ${C.card};
                border: 1px solid ${opts.accent || C.green};
                border-radius: 999px;
                font-family: system-ui, sans-serif;
                font-size: 12px;
                font-weight: 600;
                color: ${C.text};
            `;
            const nameSpan = document.createElement('span');
            nameSpan.textContent = modifier ? modifier.name : id;
            chip.appendChild(nameSpan);

            if (modifier && modifier.extra) {
                const extra = document.createElement('span');
                extra.textContent = modifier.extra;
                extra.style.cssText = `color: ${C.gold}; font-family: ui-monospace, monospace; font-size: 11px;`;
                chip.appendChild(extra);
            }

            const x = document.createElement('button');
            x.type = 'button';
            x.textContent = '×';
            x.style.cssText = `
                background: transparent; border: none;
                color: ${C.textMuted}; cursor: pointer;
                font-size: 14px; line-height: 1;
                padding: 0 4px;
            `;
            x.addEventListener('click', () => {
                state.ids = state.ids.filter(i => i !== id);
                render();
                if (opts.onChange) opts.onChange(state.ids);
            });
            chip.appendChild(x);
            tray.appendChild(chip);
        });
    }

    container.appendChild(tray);

    const addBtn = _buildPillButton(opts.addLabel || '+ Add', 'secondary', () => {
        openPickerModal(state.ids, sourceFn, opts, (newIds) => {
            state.ids = newIds;
            render();
            if (opts.onChange) opts.onChange(state.ids);
        });
    }, { small: true });
    container.appendChild(addBtn);

    render();
    return state;
}

export function openPickerModal(currentIds, sourceFn, opts, onDone) {
    const C = _C;
    const excluded = opts.excludeIds ? new Set(opts.excludeIds()) : new Set();
    const all = sourceFn().filter(a => !excluded.has(a.id));

    _openModal(opts.pickerTitle || 'Pick modifiers', (body) => {
        const selected = new Set(currentIds);
        const originallySelected = new Set(currentIds);

        const searchWrap = document.createElement('div');
        searchWrap.style.cssText = 'margin-bottom: 14px;';
        const search = _buildTextInput('', { placeholder: 'Search…' });
        searchWrap.appendChild(search);
        body.appendChild(searchWrap);

        const list = document.createElement('div');
        list.style.cssText = `
            max-height: 360px;
            overflow-y: auto;
            display: flex; flex-direction: column; gap: 4px;
            margin-bottom: 14px;
        `;
        body.appendChild(list);

        function renderList() {
            list.innerHTML = '';
            const q = search.value.trim().toLowerCase();
            const filtered = q
                ? all.filter(a => a.name.toLowerCase().includes(q))
                : all;

            if (filtered.length === 0) {
                const empty = document.createElement('div');
                empty.textContent = q ? 'No matches' : 'No modifiers available';
                empty.style.cssText = `
                    font-family: ui-monospace, monospace;
                    font-size: 12px;
                    color: ${C.textDim};
                    text-align: center;
                    padding: 24px 0;
                    letter-spacing: 1.5px;
                    text-transform: uppercase;
                `;
                list.appendChild(empty);
                return;
            }

            filtered.forEach(modifier => {
                const isSelected = selected.has(modifier.id);
                const wasSelected = originallySelected.has(modifier.id);
                const row = document.createElement('button');
                row.type = 'button';
                row.style.cssText = `
                    display: flex; align-items: center; gap: 12px;
                    padding: 10px 14px;
                    background: ${isSelected && !wasSelected ? 'rgba(74,222,128,0.08)'
                                : !isSelected && wasSelected ? 'rgba(232,71,42,0.08)'
                                : C.well};
                    border: 1px solid ${isSelected && !wasSelected ? C.greenUp
                                      : !isSelected && wasSelected ? C.verm
                                      : 'transparent'};
                    border-left: 3px solid ${isSelected ? C.green : 'transparent'};
                    border-radius: 6px;
                    cursor: pointer;
                    width: 100%;
                    text-align: left;
                    font-family: system-ui, sans-serif;
                    transition: background 0.1s ease;
                `;

                const box = document.createElement('div');
                box.style.cssText = `
                    width: 18px; height: 18px;
                    border: 2px solid ${isSelected ? C.green : C.textDim};
                    border-radius: 4px;
                    display: flex; align-items: center; justify-content: center;
                    background: ${isSelected ? C.green : 'transparent'};
                    flex-shrink: 0;
                `;
                if (isSelected) {
                    const check = document.createElement('span');
                    check.textContent = '✓';
                    check.style.cssText = `color: ${C.well}; font-size: 13px; font-weight: 900;`;
                    box.appendChild(check);
                }
                row.appendChild(box);

                const name = document.createElement('span');
                name.textContent = modifier.name;
                name.style.cssText = `
                    flex: 1;
                    color: ${C.text};
                    font-size: 14px;
                    font-weight: 600;
                `;
                row.appendChild(name);

                if (modifier.extra) {
                    const extra = document.createElement('span');
                    extra.textContent = modifier.extra;
                    extra.style.cssText = `
                        color: ${C.gold};
                        font-family: ui-monospace, monospace;
                        font-size: 12px;
                    `;
                    row.appendChild(extra);
                }

                if (isSelected && !wasSelected) {
                    const badge = document.createElement('span');
                    badge.textContent = '+ NEW';
                    badge.style.cssText = `
                        font-family: ui-monospace, monospace;
                        font-size: 9px;
                        color: ${C.greenUp};
                        letter-spacing: 1.5px;
                        font-weight: 700;
                    `;
                    row.appendChild(badge);
                } else if (!isSelected && wasSelected) {
                    const badge = document.createElement('span');
                    badge.textContent = '− REMOVE';
                    badge.style.cssText = `
                        font-family: ui-monospace, monospace;
                        font-size: 9px;
                        color: ${C.verm};
                        letter-spacing: 1.5px;
                        font-weight: 700;
                    `;
                    row.appendChild(badge);
                }

                row.addEventListener('click', () => {
                    if (selected.has(modifier.id)) selected.delete(modifier.id);
                    else selected.add(modifier.id);
                    renderList();
                    renderDelta();
                });

                list.appendChild(row);
            });
        }

        const delta = document.createElement('div');
        delta.style.cssText = `
            padding: 10px 14px;
            background: ${C.well};
            border-radius: 6px;
            font-family: ui-monospace, monospace;
            font-size: 11px;
            letter-spacing: 1.5px;
            text-transform: uppercase;
            font-weight: 700;
            color: ${C.textMuted};
            margin-bottom: 14px;
        `;

        function renderDelta() {
            const added = [...selected].filter(id => !originallySelected.has(id)).length;
            const removed = [...originallySelected].filter(id => !selected.has(id)).length;
            const unchanged = [...selected].filter(id => originallySelected.has(id)).length;

            delta.innerHTML = '';

            if (added > 0) {
                const addedSpan = document.createElement('span');
                addedSpan.textContent = `+${added} added`;
                addedSpan.style.color = C.greenUp;
                delta.appendChild(addedSpan);
                delta.appendChild(document.createTextNode('  '));
            }
            if (removed > 0) {
                const removedSpan = document.createElement('span');
                removedSpan.textContent = `−${removed} removed`;
                removedSpan.style.color = C.verm;
                delta.appendChild(removedSpan);
                delta.appendChild(document.createTextNode('  '));
            }
            if (added === 0 && removed === 0) {
                const noChange = document.createElement('span');
                noChange.textContent = 'no changes';
                noChange.style.color = C.textDim;
                delta.appendChild(noChange);
                delta.appendChild(document.createTextNode('  '));
            }
            const total = document.createElement('span');
            total.textContent = `· ${unchanged + added} total`;
            total.style.color = C.textDim;
            delta.appendChild(total);
        }

        body.appendChild(delta);
        renderDelta();

        search.addEventListener('input', renderList);
        renderList();

        _buildModalFooter(body, () => {
            onDone(Array.from(selected));
            _closeModal();
        }, { saveLabel: 'Apply' });
    }, { wide: true, accent: opts.accent || _C.green });
}
