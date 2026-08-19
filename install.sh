#!/bin/sh
# Jewel - canonical standalone Docker installer
# Usage:
#   curl -fsSL https://raw.githubusercontent.com/LYOfficial/Jewel/main/install.sh -o install.sh
#   chmod +x install.sh
#   ./install.sh              # default port 330
#   ./install.sh 8080         # custom host port

set -eu

IMAGE="${JEWEL_IMAGE:-jewel:latest}"
CONTAINER="${JEWEL_CONTAINER:-jewel}"
DEFAULT_DATA_SOURCE="${JEWEL_DATA_SOURCE:-jewel-data}"
REPO="${JEWEL_REPOSITORY:-https://github.com/LYOfficial/Jewel.git}"
BRANCH="${JEWEL_BRANCH:-main}"
REQUESTED_PORT="${1:-${JEWEL_PORT:-}}"
ROLLBACK_CONTAINER="${CONTAINER}-rollback"
WORK_DIR="$(mktemp -d "${TMPDIR:-/tmp}/jewel-install.XXXXXX")"
CANDIDATE_IMAGE="${IMAGE}-candidate-$$"
PREVIOUS_IMAGE_ID=""
HAD_EXISTING_CONTAINER=0
SWAP_IN_PROGRESS=0

cleanup() {
  STATUS=$?
  trap - EXIT HUP INT TERM
  if [ "$SWAP_IN_PROGRESS" -eq 1 ]; then
    restore_previous_container || true
  fi
  rm -rf "$WORK_DIR"
  exit "$STATUS"
}
trap cleanup EXIT
trap 'exit 1' HUP INT TERM

require_command() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Error: $1 is not installed." >&2
    exit 1
  fi
}

container_exists() {
  docker container inspect "$1" >/dev/null 2>&1
}

read_container_env() {
  docker inspect --format '{{range .Config.Env}}{{println .}}{{end}}' "$CONTAINER" 2>/dev/null \
    | sed -n "s/^$1=//p" \
    | head -n 1
}

restore_previous_container() {
  SWAP_IN_PROGRESS=0
  echo "==> The new Jewel container did not become ready; restoring the previous container..." >&2
  docker rm -f "$CONTAINER" >/dev/null 2>&1 || true

  if [ -n "$PREVIOUS_IMAGE_ID" ]; then
    docker tag "$PREVIOUS_IMAGE_ID" "$IMAGE" >/dev/null 2>&1 || true
  else
    docker image rm "$IMAGE" >/dev/null 2>&1 || true
  fi

  if [ "$HAD_EXISTING_CONTAINER" -eq 1 ] && container_exists "$ROLLBACK_CONTAINER"; then
    docker rename "$ROLLBACK_CONTAINER" "$CONTAINER"
    docker update --restart unless-stopped "$CONTAINER" >/dev/null 2>&1 || true
    docker start "$CONTAINER" >/dev/null
    echo "==> Previous Jewel container restored." >&2
  fi
}

require_command docker
require_command git

if ! docker info >/dev/null 2>&1; then
  echo "Error: Docker is installed but the daemon is not available." >&2
  exit 1
fi

# Recover a rollback container left by an interrupted earlier installation.
if ! container_exists "$CONTAINER" && container_exists "$ROLLBACK_CONTAINER"; then
  echo "==> Recovering the previous Jewel container from an interrupted installation..."
  docker rename "$ROLLBACK_CONTAINER" "$CONTAINER"
  docker update --restart unless-stopped "$CONTAINER" >/dev/null 2>&1 || true
  docker start "$CONTAINER" >/dev/null 2>&1 || true
fi

EXISTING_DATA_SOURCE=""
EXISTING_PORT=""
EXISTING_JWT_SECRET=""
EXISTING_DOCKER_TIMEOUT=""
EXISTING_BACKUP_HELPER=""

if container_exists "$CONTAINER"; then
  HAD_EXISTING_CONTAINER=1
  EXISTING_DATA_SOURCE="$(docker inspect --format '{{range .Mounts}}{{if eq .Destination "/data"}}{{if .Name}}{{.Name}}{{else}}{{.Source}}{{end}}{{end}}{{end}}' "$CONTAINER" 2>/dev/null || true)"
  EXISTING_PORT="$(docker inspect --format '{{with (index .HostConfig.PortBindings "330/tcp")}}{{(index . 0).HostPort}}{{end}}' "$CONTAINER" 2>/dev/null || true)"
  EXISTING_JWT_SECRET="$(read_container_env JWT_SECRET || true)"
  EXISTING_DOCKER_TIMEOUT="$(read_container_env DOCKER_READ_TIMEOUT_MS || true)"
  EXISTING_BACKUP_HELPER="$(read_container_env BACKUP_HELPER_IMAGE || true)"
fi

PORT="${REQUESTED_PORT:-${EXISTING_PORT:-330}}"
case "$PORT" in
  ''|*[!0-9]*)
    echo "Error: port must be an integer between 1 and 65535." >&2
    exit 1
    ;;
esac
if [ "$PORT" -lt 1 ] || [ "$PORT" -gt 65535 ]; then
  echo "Error: port must be an integer between 1 and 65535." >&2
  exit 1
fi

DATA_SOURCE="${JEWEL_DATA_SOURCE:-${EXISTING_DATA_SOURCE:-$DEFAULT_DATA_SOURCE}}"
DOCKER_READ_TIMEOUT_VALUE="${DOCKER_READ_TIMEOUT_MS:-${EXISTING_DOCKER_TIMEOUT:-8000}}"
BACKUP_HELPER_IMAGE_VALUE="${BACKUP_HELPER_IMAGE:-${EXISTING_BACKUP_HELPER:-busybox:1.36}}"
# DaoCloud mirrors Docker Hub and is generally reachable from mainland China.
# Set JEWEL_NODE_IMAGE to override it with an internal registry if needed.
NODE_IMAGE="${JEWEL_NODE_IMAGE:-docker.m.daocloud.io/library/node:20-alpine}"
IMAGE_PULL_RETRIES="${JEWEL_IMAGE_PULL_RETRIES:-3}"

case "$IMAGE_PULL_RETRIES" in
  ''|*[!0-9]*|0)
    echo "Error: JEWEL_IMAGE_PULL_RETRIES must be a positive integer." >&2
    exit 1
    ;;
esac

pull_image_with_retry() {
  ATTEMPT=1
  while [ "$ATTEMPT" -le "$IMAGE_PULL_RETRIES" ]; do
    echo "==> Pulling base image ${NODE_IMAGE} (attempt ${ATTEMPT}/${IMAGE_PULL_RETRIES})..."
    if docker pull "$NODE_IMAGE"; then
      return 0
    fi
    if [ "$ATTEMPT" -lt "$IMAGE_PULL_RETRIES" ]; then
      WAIT_SECONDS=$((ATTEMPT * 5))
      echo "==> Base image pull failed; retrying in ${WAIT_SECONDS}s..." >&2
      sleep "$WAIT_SECONDS"
    fi
    ATTEMPT=$((ATTEMPT + 1))
  done
  return 1
}

echo "==> Jewel installer"
echo "    Repository: ${REPO} (${BRANCH})"
echo "    Port: ${PORT}"
echo "    Data source: ${DATA_SOURCE}"

echo "==> Cloning Jewel repository..."
git clone --depth 1 --branch "$BRANCH" "$REPO" "$WORK_DIR"
COMMIT="$(cd "$WORK_DIR" && git rev-parse HEAD)"

echo "==> Building candidate image (the current Jewel container is still running)..."
if ! pull_image_with_retry; then
  echo "Error: unable to pull base image ${NODE_IMAGE}. Check Docker Hub connectivity or set JEWEL_NODE_IMAGE to an accessible registry mirror." >&2
  exit 1
fi
docker build \
  --build-arg "JEWEL_COMMIT=${COMMIT}" \
  --build-arg "NODE_IMAGE=${NODE_IMAGE}" \
  -t "$CANDIDATE_IMAGE" \
  "$WORK_DIR"

case "$DATA_SOURCE" in
  /*) ;;
  *) docker volume create "$DATA_SOURCE" >/dev/null ;;
esac

JWT_SECRET_VALUE="${JWT_SECRET:-$EXISTING_JWT_SECRET}"
if [ -z "$JWT_SECRET_VALUE" ]; then
  JWT_SECRET_VALUE="$(docker run --rm "$CANDIDATE_IMAGE" node -e "process.stdout.write(require('crypto').randomBytes(48).toString('hex'))")"
fi

PREVIOUS_IMAGE_ID="$(docker image inspect --format '{{.Id}}' "$IMAGE" 2>/dev/null || true)"

# Only stop the current container after cloning and building have succeeded.
if [ "$HAD_EXISTING_CONTAINER" -eq 1 ]; then
  echo "==> Preparing the current Jewel container for rollback..."
  docker rm -f "$ROLLBACK_CONTAINER" >/dev/null 2>&1 || true
  SWAP_IN_PROGRESS=1
  docker stop "$CONTAINER" >/dev/null
  docker rename "$CONTAINER" "$ROLLBACK_CONTAINER"
else
  SWAP_IN_PROGRESS=1
fi

docker tag "$CANDIDATE_IMAGE" "$IMAGE"

echo "==> Starting the new Jewel container..."
if ! docker run -d \
  --name "$CONTAINER" \
  --restart unless-stopped \
  --label io.jewel.managed=true \
  -p "${PORT}:330" \
  -v /var/run/docker.sock:/var/run/docker.sock \
  -v "${DATA_SOURCE}:/data" \
  --pids-limit=-1 \
  --ulimit nofile=65536:65536 \
  -e NODE_ENV=production \
  -e DATA_DIR=/data \
  -e PORT=330 \
  -e "JWT_SECRET=${JWT_SECRET_VALUE}" \
  -e "DOCKER_READ_TIMEOUT_MS=${DOCKER_READ_TIMEOUT_VALUE}" \
  -e "BACKUP_HELPER_IMAGE=${BACKUP_HELPER_IMAGE_VALUE}" \
  -e "JEWEL_COMMIT=${COMMIT}" \
  "$IMAGE" >/dev/null; then
  exit 1
fi

echo "==> Waiting for Jewel to become ready..."
READY=0
ATTEMPT=0
while [ "$ATTEMPT" -lt 30 ]; do
  if docker exec "$CONTAINER" node -e "const http=require('http');const req=http.get('http://127.0.0.1:330/',res=>{res.resume();process.exit(res.statusCode<500?0:1)});req.on('error',()=>process.exit(1));req.setTimeout(1000,()=>{req.destroy();process.exit(1)})" >/dev/null 2>&1; then
    READY=1
    break
  fi
  ATTEMPT=$((ATTEMPT + 1))
  sleep 1
done

if [ "$READY" -ne 1 ]; then
  docker logs --tail 80 "$CONTAINER" >&2 2>/dev/null || true
  exit 1
fi

SWAP_IN_PROGRESS=0
if container_exists "$ROLLBACK_CONTAINER"; then
  docker rm "$ROLLBACK_CONTAINER" >/dev/null 2>&1 || true
fi
docker image rm "$CANDIDATE_IMAGE" >/dev/null 2>&1 || true

echo ""
echo "==> Jewel is running at http://localhost:${PORT}"
echo "    Default login: admin / adminwithjewel"
echo "    You will be asked to change the password on first login."
echo ""
echo "    The data source, port, and JWT secret will be preserved by future self-updates."
