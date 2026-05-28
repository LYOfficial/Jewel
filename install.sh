#!/bin/sh
# Jewel - Standalone Docker Installation (no docker-compose required)
# Usage:
#   curl -sSL https://raw.githubusercontent.com/LYOfficial/Jewel/main/install.sh | sh
#   ./install.sh              (default port 330)
#   ./install.sh 8080         (custom port)

set -e

PORT="${1:-330}"
IMAGE="jewel:latest"
CONTAINER="jewel"
DATA_VOLUME="jewel-data"
REPO="https://github.com/LYOfficial/Jewel.git"
TMPDIR="/tmp/jewel-install"

echo "==> Jewel Standalone Installer"
echo "    Port: ${PORT}"

# ---- Check Docker ----
if ! command -v docker >/dev/null 2>&1; then
  echo "Error: docker is not installed." >&2
  exit 1
fi

# ---- Stop & remove existing container ----
if docker ps -a --format '{{.Names}}' 2>/dev/null | grep -q "^${CONTAINER}$"; then
  echo "==> Stopping existing Jewel container..."
  docker stop "$CONTAINER" 2>/dev/null || true
  docker rm "$CONTAINER" 2>/dev/null || true
fi

# ---- Clone repo (or update if already cloned) ----
if [ -d "$TMPDIR/.git" ]; then
  echo "==> Updating local clone..."
  cd "$TMPDIR" && git pull --ff-only || { echo "Clone outdated, re-cloning..."; rm -rf "$TMPDIR"; git clone --depth 1 "$REPO" "$TMPDIR"; }
else
  rm -rf "$TMPDIR"
  echo "==> Cloning Jewel repository..."
  git clone --depth 1 "$REPO" "$TMPDIR"
fi

# ---- Build image ----
echo "==> Building Jewel image (this may take a few minutes)..."
docker build -t "$IMAGE" "$TMPDIR"

# ---- Create data volume ----
docker volume create "$DATA_VOLUME" 2>/dev/null || true

# ---- Get commit SHA for version tracking ----
COMMIT=$(cd "$TMPDIR" && git rev-parse HEAD 2>/dev/null || echo "unknown")

# ---- Run container ----
echo "==> Starting Jewel container..."
docker run -d \
  --name "$CONTAINER" \
  --restart unless-stopped \
  -p "${PORT}:330" \
  -v /var/run/docker.sock:/var/run/docker.sock \
  -v "${DATA_VOLUME}:/data" \
  -e NODE_ENV=production \
  -e DATA_DIR=/data \
  -e PORT=330 \
  -e "JEWEL_COMMIT=${COMMIT}" \
  "$IMAGE"

# ---- Cleanup ----
rm -rf "$TMPDIR"

echo ""
echo "==> Jewel is running at http://localhost:${PORT}"
echo "    Default login: admin / adminwithjewel"
echo "    (You will be asked to change the password on first login.)"
echo ""
echo "    Self-update is supported — Jewel will detect new versions"
echo "    and rebuild its own Docker image automatically."
