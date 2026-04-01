#!/usr/bin/env bash
set -e

# ─────────────────────────────────────────────────────────────
# FloodTest Installer
# Installs Docker (if needed) and runs FloodTest via Docker Compose.
# Usage: curl -fsSL https://raw.githubusercontent.com/twolfekc/floodtest/main/install.sh | sudo bash
# ─────────────────────────────────────────────────────────────

INSTALL_DIR="/opt/floodtest"
PORT="7860"

# ── Banner ───────────────────────────────────────────────────
echo ""
echo "============================================"
echo "  FloodTest — ISP Throttle Detection Tool"
echo "============================================"
echo ""

# ── Root check ───────────────────────────────────────────────
if [ "$(id -u)" -ne 0 ]; then
  echo "ERROR: This script must be run as root (use sudo)."
  exit 1
fi

# ── Install Docker if not present ────────────────────────────
if command -v docker &>/dev/null; then
  echo "Docker is already installed: $(docker --version)"
else
  echo "Installing Docker via official convenience script..."
  curl -fsSL https://get.docker.com | sh
  echo "Docker installed successfully."
fi

# Enable and start Docker service
echo "Ensuring Docker service is enabled and running..."
systemctl enable docker
systemctl start docker

# ── Install Docker Compose plugin if not present ─────────────
if docker compose version &>/dev/null; then
  echo "Docker Compose plugin is already installed: $(docker compose version)"
else
  echo "Installing Docker Compose plugin..."
  apt-get update -qq
  apt-get install -y -qq docker-compose-plugin
  echo "Docker Compose plugin installed."
fi

# ── Create install directory ─────────────────────────────────
echo "Setting up ${INSTALL_DIR}..."
mkdir -p "${INSTALL_DIR}"

# ── Write docker-compose.yml ─────────────────────────────────
cat > "${INSTALL_DIR}/docker-compose.yml" <<'EOF'
services:
  floodtest:
    image: ghcr.io/twolfekc/floodtest:latest
    container_name: floodtest
    restart: unless-stopped
    ports:
      - "7860:7860"
    volumes:
      - floodtest-data:/data
      - /var/run/docker.sock:/var/run/docker.sock
    environment:
      - DATA_DIR=/data
      - COMPOSE_DIR=/opt/floodtest

volumes:
  floodtest-data:
EOF
echo "Wrote ${INSTALL_DIR}/docker-compose.yml"

# ── Open firewall port if ufw is active ──────────────────────
if command -v ufw &>/dev/null && ufw status | grep -q "active"; then
  echo "Opening port ${PORT} in ufw firewall..."
  ufw allow "${PORT}/tcp" >/dev/null
fi

# ── Pull and start containers ────────────────────────────────
echo "Pulling latest FloodTest image and starting container..."
cd "${INSTALL_DIR}"
docker compose pull
docker compose up -d

# ── Success message ──────────────────────────────────────────
HOSTNAME=$(hostname -f 2>/dev/null || hostname)
echo ""
echo "============================================"
echo "  FloodTest is running at http://${HOSTNAME}:${PORT}"
echo "============================================"
echo ""
echo "Configure B2 credentials through the web UI setup wizard."
echo ""
