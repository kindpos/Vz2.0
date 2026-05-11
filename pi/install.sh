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
echo "[1/8] Installing dependencies..."
apt-get update -q
apt-get install -y nginx avahi-daemon libnss-mdns python3 python3-pip python3-venv

# Set hostname so avahi advertises kindpos.local
hostnamectl set-hostname kindpos
echo "kindpos" > /etc/hostname
sed -i 's/^127\.0\.1\.1.*/127.0.1.1\tkindpos/' /etc/hosts

# Patch nsswitch.conf for mDNS (.local resolution)
sed -i 's/^hosts:.*/hosts: files mdns4_minimal [NOTFOUND=return] dns/' \
  /etc/nsswitch.conf

# 2. Python dependencies
echo "[2/8] Installing Python dependencies..."
if [ ! -d "/home/kindpos/venv" ]; then
    python3 -m venv /home/kindpos/venv
    chown -R kindpos:kindpos /home/kindpos/venv
fi
/home/kindpos/venv/bin/pip install -r "$BASE/backend/requirements.txt"

# 3. Systemd service
echo "[3/8] Installing kindpos.service..."
cp "$SCRIPT_DIR/systemd/kindpos.service" /etc/systemd/system/kindpos.service
systemctl daemon-reload
systemctl enable kindpos

# 4. nginx config
echo "[4/8] Configuring nginx..."
cp "$SCRIPT_DIR/nginx/kindpos.conf" /etc/nginx/sites-available/kindpos
rm -f /etc/nginx/sites-enabled/default
ln -sf /etc/nginx/sites-available/kindpos /etc/nginx/sites-enabled/kindpos
systemctl enable nginx

# 6. eth0 static IP (192.168.50.1/24 — direct terminal connection)
echo "[5/8] Configuring eth0 static IP..."
if ! nmcli -g ipv4.addresses connection show netplan-eth0 2>/dev/null | grep -q "192.168.50.1/24"; then
    nmcli connection modify netplan-eth0 ipv4.addresses 192.168.50.1/24 ipv4.method manual
    nmcli connection up netplan-eth0
    echo "eth0 set to 192.168.50.1/24."
else
    echo "eth0 already configured — skipping."
fi

# avahi-daemon — start after eth0 has its static IP
# so avahi registers on both wlan0 and eth0
echo "[6/8] Enabling avahi-daemon..."
systemctl enable avahi-daemon
systemctl restart avahi-daemon

# 7. First-boot overlay service — PROVISIONING_FLOW.md §4.2
echo "[7/8] Installing first-boot overlay service..."
cp "$SCRIPT_DIR/first-boot.sh" /boot/first-boot.sh
chmod +x /boot/first-boot.sh
cp "$SCRIPT_DIR/systemd/kindpos-first-boot.service" \
   /etc/systemd/system/kindpos-first-boot.service
systemctl daemon-reload
systemctl enable kindpos-first-boot
# NOTE: kindpos-overlay.tar.gz is NOT placed here.
# The image builder places it in /boot/ before the SD card ships.
# ConditionPathExists ensures this is a no-op on all subsequent boots.

# 8. Sudoers — allow kindpos user to restart its own service without a password
echo "[8/8] Configuring sudoers..."
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
