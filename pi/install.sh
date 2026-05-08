#!/bin/bash
# KINDpos Pi Installer — provisions a fresh Pi OS Lite install.
# Usage: sudo bash pi/install.sh
# Safe to run more than once (idempotent).

set -e

SCRIPT_DIR=$(cd "$(dirname "$0")" && pwd)
BASE=$(dirname "$SCRIPT_DIR")

echo "=== KINDpos Pi Installer ==="
echo "Repo: $BASE"

# 1. System dependencies
echo "[1/7] Installing dependencies..."
apt-get update -q
apt-get install -y nginx avahi-daemon python3 python3-pip

# 2. Python dependencies
echo "[2/7] Installing Python dependencies..."
apt-get install -y python3-venv
if [ ! -d "/home/kindpos/venv" ]; then
    python3 -m venv /home/kindpos/venv
    chown -R kindpos:kindpos /home/kindpos/venv
fi
/home/kindpos/venv/bin/pip install -r "$BASE/backend/requirements.txt"

# 3. Systemd service
echo "[3/7] Installing kindpos.service..."
cp "$SCRIPT_DIR/systemd/kindpos.service" /etc/systemd/system/kindpos.service
systemctl daemon-reload
systemctl enable kindpos

# 4. nginx config
echo "[4/7] Configuring nginx..."
cp "$SCRIPT_DIR/nginx/kindpos.conf" /etc/nginx/sites-available/kindpos
rm -f /etc/nginx/sites-enabled/default
ln -sf /etc/nginx/sites-available/kindpos /etc/nginx/sites-enabled/kindpos
systemctl enable nginx

# 5. avahi-daemon (provides kindpos.local mDNS name)
echo "[5/7] Enabling avahi-daemon..."
systemctl enable avahi-daemon
systemctl start avahi-daemon

# 6. eth0 static IP (192.168.50.1/24 — direct terminal connection)
echo "[6/7] Configuring eth0 static IP..."
if ! nmcli -g ipv4.addresses connection show netplan-eth0 2>/dev/null | grep -q "192.168.50.1/24"; then
    nmcli connection modify netplan-eth0 ipv4.addresses 192.168.50.1/24 ipv4.method manual
    nmcli connection up netplan-eth0
    echo "eth0 set to 192.168.50.1/24."
else
    echo "eth0 already configured — skipping."
fi

# 7. Sudoers — allow kindpos user to restart its own service without a password
echo "[7/7] Configuring sudoers..."
SUDOERS_FILE=/etc/sudoers.d/kindpos
SUDOERS_LINE="kindpos ALL=(ALL) NOPASSWD: /bin/systemctl restart kindpos"
if [ ! -f "$SUDOERS_FILE" ] || ! grep -qF "$SUDOERS_LINE" "$SUDOERS_FILE"; then
    echo "$SUDOERS_LINE" > "$SUDOERS_FILE"
    chmod 440 "$SUDOERS_FILE"
    echo "Sudoers entry added."
else
    echo "Sudoers entry already present — skipping."
fi

echo ""
echo "KINDpos Node ready at http://kindpos.local"
