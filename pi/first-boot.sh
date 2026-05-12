#!/bin/bash
# KINDpos first-boot setup — runs once as root via kindpos-first-boot.service.
# Self-disables and removes itself on completion.

LOG_FILE=/var/log/kindpos-first-boot.log

log() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*" | tee -a "$LOG_FILE"
}

log "=== KINDpos First Boot Setup Starting ==="

log "[1/4] Creating /data..."
mkdir -p /data
chown kindpos:kindpos /data
chmod 755 /data

log "[2/4] Creating /home/kindpos/kindpos-logs..."
mkdir -p /home/kindpos/kindpos-logs
chown kindpos:kindpos /home/kindpos/kindpos-logs
chmod 755 /home/kindpos/kindpos-logs

log "[3/4] Initializing database..."
if cd /home/kindpos/Vz2.0/backend && /home/kindpos/venv/bin/python -m app.db.init >> "$LOG_FILE" 2>&1; then
    log "Database init succeeded."
else
    log "WARNING: database init failed (exit $?) — continuing anyway."
fi

log "[4/4] Disabling and removing first-boot service..."
systemctl disable kindpos-first-boot.service >> "$LOG_FILE" 2>&1 || log "WARNING: could not disable kindpos-first-boot.service"
rm -f /boot/first-boot.sh

log "=== KINDpos First Boot Setup Complete ==="
