# KINDpos Pi Network Configuration

## Interface Overview

| Interface | Role | Address |
|-----------|------|---------|
| `eth0` | Direct terminal connection | `192.168.50.1/24` (static) |
| `wlan0` | Internet uplink | DHCP from restaurant WiFi |

## eth0 — Terminal Connection

`eth0` is wired directly to the iMin Swan terminal via a CAT5 cable.
The Pi holds the static address `192.168.50.1/24`; the terminal
acquires `192.168.50.x` via the ADB-configured static setup.

Terminals are registered in `../config/terminals.conf` and reached
over this interface by the watchdog.

To apply the static IP on a fresh Pi:

```bash
sudo nmcli connection modify netplan-eth0 ipv4.addresses 192.168.50.1/24 ipv4.method manual
sudo nmcli connection up netplan-eth0
```

See `eth0-static.nmconnection` for the full connection profile.

## wlan0 — Internet Uplink

`wlan0` connects to the restaurant WiFi via DHCP. This interface
provides internet access to the Pi and is not used for terminal
communication.

## kindpos.local

Terminals load the KINDpos UI by pointing their WebView at
`http://kindpos.local` (port 80). nginx proxies this to the uvicorn
backend on `127.0.0.1:8000`. See `../nginx/kindpos.conf`.
