/* ============================================
   KINDpos Overseer — Config Push Service
   Posts event batches to /api/v1/config/push
   so changes persist to the event ledger and
   propagate to terminals.
   ============================================ */

export async function pushChanges(events) {
    if (!events || events.length === 0) return { ok: true, events_written: 0 };

    try {
        const res = await fetch('/api/v1/config/push', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(events.map(e => ({
                event_type: e.event_type,
                payload: e.payload,
            }))),
        });

        if (!res.ok) {
            const text = await res.text();
            console.error('[ConfigPush] Server error:', res.status, text);
            return { ok: false, error: `Server responded ${res.status}` };
        }

        const data = await res.json();
        console.log(`[ConfigPush] ${data.events_written} event(s) written`);
        return { ok: true, ...data };
    } catch (e) {
        console.error('[ConfigPush] Network error:', e);
        return { ok: false, error: e.message };
    }
}
