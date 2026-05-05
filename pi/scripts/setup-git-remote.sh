#!/bin/bash
# Sets up the bare git repo and post-receive deploy hook on the Pi.
# Run once as the kindpos user after the Pi is provisioned.
# Safe to run more than once (idempotent).

set -e

BARE_REPO=/home/kindpos/kindpos.git
WORK_TREE=/home/kindpos/Vz2.0
HOOK="$BARE_REPO/hooks/post-receive"

echo "=== KINDpos Git Remote Setup ==="

# 1. Create bare repo if it doesn't exist
if [ ! -d "$BARE_REPO/objects" ]; then
    echo "[1/4] Initialising bare repo at $BARE_REPO..."
    git init --bare "$BARE_REPO"
else
    echo "[1/4] Bare repo already exists — skipping init."
fi

# 2. Point HEAD at main
echo "[2/4] Setting HEAD to main..."
git --git-dir="$BARE_REPO" symbolic-ref HEAD refs/heads/main

# 3. Write post-receive hook
echo "[3/4] Writing post-receive hook..."
cat > "$HOOK" <<'EOF'
#!/bin/bash
echo "--- KINDpos Deploy ---"
git --work-tree=/home/kindpos/Vz2.0 --git-dir=/home/kindpos/kindpos.git checkout main -f
echo "Restarting service..."
sudo systemctl restart kindpos
echo "Done."
EOF

# 4. Make hook executable
echo "[4/4] Setting hook permissions..."
chmod +x "$HOOK"

# Detect wlan0 IP for the remote URL hint
PI_IP=$(ip -4 addr show wlan0 2>/dev/null | awk '/inet / {print $2}' | cut -d/ -f1)
if [ -z "$PI_IP" ]; then
    PI_IP="<PI_IP>"
fi

echo ""
echo "=== Setup complete ==="
echo ""
echo "Add the Pi as a git remote on your developer machine:"
echo ""
echo "    git remote add pi kindpos@${PI_IP}:/home/kindpos/kindpos.git"
echo ""
echo "Then deploy with:"
echo ""
echo "    git push pi main"
echo ""
