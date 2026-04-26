#!/bin/bash
# One-time USB setup: installs KINDpos kiosk APK on an iMin Swan terminal.
# Triggered by kindpos-setup.service when a USB device is detected.

set -e

BASE="$HOME/kindpos"
LOG_FILE="$HOME/kindpos-logs/setup.log"
CONF="$BASE/pi/config/terminals.conf"

log() {
    local msg="[$(date '+%Y-%m-%d %H:%M:%S')] $*"
    echo "$msg"
    mkdir -p "$(dirname "$LOG_FILE")"
    echo "$msg" >> "$LOG_FILE"
    # Rotate log if over 1 MB — keep last 500 lines
    if [ -f "$LOG_FILE" ] && [ "$(stat -c%s "$LOG_FILE")" -gt 1048576 ]; then
        tail -500 "$LOG_FILE" > "${LOG_FILE}.tmp" && mv "${LOG_FILE}.tmp" "$LOG_FILE"
    fi
}

log "=== KINDpos USB Setup Starting ==="

log "Waiting for ADB device..."
adb wait-for-device || log "ERROR: adb wait-for-device failed"
sleep 3

log "Enabling Developer Options and ADB..."
adb shell settings put global development_settings_enabled 1 || log "ERROR: Could not enable development settings"
adb shell settings put global adb_enabled 1 || log "ERROR: Could not enable ADB"

log "Setting immersive fullscreen policy..."
adb shell settings put global policy_control immersive.full=* || log "ERROR: Could not set immersive mode"

log "Switching ADB to TCP mode on port 5555..."
adb tcpip 5555 || log "ERROR: Could not switch ADB to TCP"
sleep 2

log "Installing KINDpos kiosk APK..."
adb install -r "$BASE/pi/kindpos-kiosk.apk" || log "ERROR: APK install failed"

log "Setting kiosk as default launcher..."
adb shell cmd package set-home-activity com.kindpos.kiosk/.MainActivity || log "ERROR: Could not set default launcher"

log "Granting permissions..."
adb shell pm grant com.kindpos.kiosk android.permission.INTERNET || log "ERROR: Could not grant INTERNET permission"
adb shell pm grant com.kindpos.kiosk android.permission.RECEIVE_BOOT_COMPLETED || log "ERROR: Could not grant RECEIVE_BOOT_COMPLETED permission"

log "Disabling screen timeout..."
adb shell settings put system screen_off_timeout 2147483647 || log "ERROR: Could not disable screen timeout"

log "Reading Swan Ethernet MAC address..."
MAC=$(adb shell cat /sys/class/net/eth0/address | tr -d '\r\n') || log "ERROR: Could not read MAC address"
log "Detected MAC: $MAC"

if ! grep -qi "$MAC" "$CONF" 2>/dev/null; then
    COUNT=$(grep -c "^T-" "$CONF" 2>/dev/null || echo 0)
    ID=$(printf "T-%03d" $((COUNT + 1)))
    echo "$ID|$MAC|Swan-$ID" >> "$CONF"
    log "Registered $ID — MAC: $MAC"
else
    log "MAC $MAC already registered, skipping."
fi

log "Rebooting Swan into KINDpos..."
adb reboot || log "ERROR: adb reboot failed"
log "Swan rebooting into KINDpos. Unplug USB cable now."

log "=== KINDpos USB Setup Complete ==="
