#!/bin/bash
# Permanent Ethernet watchdog: keeps KINDpos kiosk in foreground on all registered terminals.
# Runs as kindpos-watchdog.service — never exits.

BASE="/home/kindpos/Vz2.0"
LOG_FILE="$HOME/kindpos-logs/watchdog.log"
CONF="$BASE/pi/config/terminals.conf"

log() {
    local msg="[$(date '+%Y-%m-%d %H:%M:%S')] $*"
    echo "$msg"
    mkdir -p "$(dirname "$LOG_FILE")"
    echo "$msg" >> "$LOG_FILE"
    if [ -f "$LOG_FILE" ] && [ "$(stat -c%s "$LOG_FILE")" -gt 1048576 ]; then
        tail -500 "$LOG_FILE" > "${LOG_FILE}.tmp" && mv "${LOG_FILE}.tmp" "$LOG_FILE"
    fi
}

log "=== KINDpos Watchdog Started ==="

while true; do
    if [ ! -f "$CONF" ] || ! grep -q "^T-" "$CONF" 2>/dev/null; then
        log "No terminals registered yet — waiting..."
        sleep 15
        continue
    fi

    while IFS="|" read -r TERMINAL_ID MAC NAME; do
        # Skip comment and blank lines
        [[ "$TERMINAL_ID" =~ ^#.*$ || -z "$TERMINAL_ID" ]] && continue

        # Resolve MAC → IP via ARP table
        IP=$(arp -n | grep -i "$MAC" | awk '{print $1}')

        if [ -z "$IP" ]; then
            log "[$TERMINAL_ID] MAC $MAC not in ARP — running nmap sweep..."
            nmap -sn 192.168.50.0/24 -oG - > /dev/null 2>&1
            IP=$(arp -n | grep -i "$MAC" | awk '{print $1}')
        fi

        if [ -z "$IP" ]; then
            log "[$TERMINAL_ID] Not reachable — skipping"
            continue
        fi

        adb connect "${IP}:5555" > /dev/null 2>&1

        PING=$(adb -s "${IP}:5555" shell echo ping 2>/dev/null | tr -d '\r')
        if [ "$PING" != "ping" ]; then
            if adb -s "${IP}:5555" shell echo ping 2>&1 | grep -qi "unauthorized"; then
                log "[$TERMINAL_ID] ADB unauthorized at $IP — disconnecting"
                adb disconnect "${IP}:5555" > /dev/null 2>&1
            else
                log "[$TERMINAL_ID] ADB not responding at $IP"
            fi
            continue
        fi

        FOCUSED=$(adb -s "${IP}:5555" shell dumpsys window windows 2>/dev/null \
            | grep -i "mCurrentFocus" | grep -o "com.kindpos.kiosk" || true)

        if [ "$FOCUSED" != "com.kindpos.kiosk" ]; then
            log "[$TERMINAL_ID] Kiosk not in foreground — relaunching..."
            adb -s "${IP}:5555" shell am start -n com.kindpos.kiosk/.MainActivity \
                --activity-clear-top 2>/dev/null || log "[$TERMINAL_ID] ERROR: Could not relaunch kiosk"
        fi
    done < "$CONF"

    sleep 15
done
