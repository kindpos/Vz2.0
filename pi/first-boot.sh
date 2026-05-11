#!/bin/bash
# KINDpos first-boot overlay application
# PROVISIONING_FLOW.md §4.2
# Runs once on first boot when kindpos-overlay.tar.gz is present
# in /boot/. Extracts per-customer overlay into /var/lib/kindpos/,
# sets ownership/permissions, removes itself and the tarball,
# then reboots. The Overseer detects first_boot_pending=true in
# accounts.db on next startup (OVERSEER_AUTH.md §4).

set -e

OVERLAY=/boot/kindpos-overlay.tar.gz
DEST=/var/lib/kindpos
LOG=/var/log/kindpos-first-boot.log

exec > >(tee -a "$LOG") 2>&1
echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] first-boot.sh starting"

if [ ! -f "$OVERLAY" ]; then
  echo "ERROR: $OVERLAY not found — aborting"
  exit 1
fi

mkdir -p "$DEST"

# Extract overlay — tarball paths are relative (var/lib/kindpos/...)
# so extract from / to land files at correct absolute paths
# PROVISIONING_FLOW.md §4.2
echo "Extracting overlay to $DEST ..."
tar -xzf "$OVERLAY" -C /

# Set ownership — kindpos user must own accounts.db for the
# Overseer process to read/write it (OVERSEER_AUTH.md §3.1)
KINDPOS_USER=kindpos
if id "$KINDPOS_USER" &>/dev/null; then
  chown -R "$KINDPOS_USER:$KINDPOS_USER" "$DEST"
  echo "Ownership set to $KINDPOS_USER"
else
  echo "WARNING: user $KINDPOS_USER not found — skipping chown"
fi

chmod 600 "$DEST/accounts.db"  2>/dev/null || true
chmod 644 "$DEST/kindpos.toml" 2>/dev/null || true

echo "Overlay applied. Contents of $DEST:"
ls -la "$DEST"

# Remove overlay tarball and this script — PROVISIONING_FLOW.md §4.2
echo "Cleaning up /boot ..."
rm -f "$OVERLAY"
rm -f /boot/first-boot.sh

echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] first-boot complete — rebooting"
systemctl reboot
