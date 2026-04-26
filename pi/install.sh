#!/bin/bash
# KINDpos Pi Installer
# Run once after cloning the repo on a fresh Pi.
# Usage: cd ~/kindpos && bash pi/install.sh

set -e
BASE="$HOME/kindpos"
echo "=== KINDpos Pi Installer ==="

# 1. Install system dependencies
echo "[1/7] Installing dependencies..."
sudo apt update -q
sudo apt install -y adb nmap

# 2. Make scripts executable
echo "[2/7] Setting permissions..."
chmod +x "$BASE/pi/scripts/kindpos-setup.sh"
chmod +x "$BASE/pi/scripts/kindpos-watchdog.sh"

# 3. Create log directory
echo "[3/7] Creating log directory..."
mkdir -p "$HOME/kindpos-logs"

# 4. Configure static IP on eth0 (direct Pi → Terminal connection)
echo "[4/7] Configuring static IP on eth0..."
if ! grep -q "interface eth0" /etc/dhcpcd.conf; then
    echo "" | sudo tee -a /etc/dhcpcd.conf
    echo "interface eth0" | sudo tee -a /etc/dhcpcd.conf
    echo "static ip_address=192.168.50.1/24" | sudo tee -a /etc/dhcpcd.conf
    echo "static routers=192.168.50.1" | sudo tee -a /etc/dhcpcd.conf
    echo "Static IP configured on eth0."
else
    echo "eth0 static IP already configured, skipping."
fi

# 5. Install systemd services
echo "[5/7] Installing systemd services..."
sudo cp "$BASE/pi/systemd/kindpos-setup.service" /etc/systemd/system/
sudo cp "$BASE/pi/systemd/kindpos-watchdog.service" /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable kindpos-setup
sudo systemctl enable kindpos-watchdog

# 6. Start KINDpos backend as a service (optional — skip if already running)
echo "[6/7] Starting KINDpos backend..."
PYTHONPATH="$BASE/backend" ~/.local/bin/uvicorn app.main:app \
    --host 0.0.0.0 --port 8000 &
echo $! > "$HOME/kindpos-backend.pid"

# 7. Start watchdog
echo "[7/7] Starting watchdog..."
sudo systemctl start kindpos-watchdog

echo ""
echo "=== KINDpos Install Complete ==="
echo ""
echo "Next steps:"
echo "  1. Plug USB cable: Pi → Terminal"
echo "  2. Tap 'Allow' on the terminal screen"
echo "  3. Wait 60 seconds for terminal to reboot"
echo "  4. Unplug USB, plug CAT5: Pi → Terminal"
echo ""
echo "Backend running at: http://$(hostname -I | awk '{print $1}'):8000/terminal/"
