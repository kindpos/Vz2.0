import { T } from '../components/tokens.js';

let _currentContainer = null;
let _abortController = null;

function still() { return _currentContainer !== null; }

export default function mount(container) {
    if (_abortController) _abortController.abort();
    _currentContainer = container;
    _abortController = new AbortController();
    renderSkeleton(container);
    loadTransactions();
}

export function unmount() {
    if (_abortController) _abortController.abort();
    _currentContainer = null;
}

async function loadTransactions() {
    // TODO Chunk 3: fetch /api/v1/reports/transactions and render
    if (!still()) return;
    renderPlaceholder(_currentContainer);
}

function renderSkeleton(container) {
    if (!document.getElementById('tl-styles')) {
        const style = document.createElement('style');
        style.id = 'tl-styles';
        style.textContent = `
            @keyframes tl-pulse {
                0%, 100% { opacity: 0.4; }
                50%       { opacity: 0.7; }
            }
            .tl-loading { padding: 24px; }
            .tl-loading-row {
                background: ${T.well};
                border-radius: 8px;
                height: 18px;
                margin-bottom: 12px;
                animation: tl-pulse 1.4s ease-in-out infinite;
            }
        `;
        document.head.appendChild(style);
    }

    const wrap = document.createElement('div');
    wrap.className = 'tl-loading';

    [' 100%', '60%', '80%'].forEach(w => {
        const row = document.createElement('div');
        row.className = 'tl-loading-row';
        row.style.width = w.trim();
        wrap.appendChild(row);
    });

    container.innerHTML = '';
    container.appendChild(wrap);
}

function renderPlaceholder(container) {
    container.innerHTML = '';
    const div = document.createElement('div');
    div.style.cssText = `
        display: flex;
        align-items: center;
        justify-content: center;
        height: 100%;
        background: ${T.card};
        color: ${T.text};
        font-family: ${T.font.body};
    `;
    div.textContent = 'Transaction Log — coming soon';
    container.appendChild(div);
}
