#!/usr/bin/env bash
set -euo pipefail

APP_ROOT="/opt/zhangdan"
STATE_ROOT="/var/lib/zhangdan"
CONTAINER_NAME="zhangdan"
HOST_PORT="${ZHANGDAN_HOST_PORT:-3210}"
ARCHIVE_PATH="${1:-}"

if [[ "${EUID}" -ne 0 ]]; then
  echo "Run this installer as root." >&2
  exit 1
fi

if [[ -z "${ARCHIVE_PATH}" || ! -f "${ARCHIVE_PATH}" ]]; then
  echo "Usage: sudo bash install-docker-release.sh /path/to/zhangdan-release.tar.gz" >&2
  exit 1
fi

for command_name in curl docker ss tar; do
  if ! command -v "${command_name}" >/dev/null 2>&1; then
    echo "Required command not found: ${command_name}" >&2
    exit 1
  fi
done

docker info >/dev/null

CHECKSUM_PATH="${ARCHIVE_PATH}.sha256"
if [[ ! -f "${CHECKSUM_PATH}" ]]; then
  echo "Required checksum file not found: ${CHECKSUM_PATH}" >&2
  exit 1
fi

CHECKSUM_DIR="$(cd "$(dirname "${CHECKSUM_PATH}")" && pwd)"
CHECKSUM_FILE="$(basename "${CHECKSUM_PATH}")"
if command -v sha256sum >/dev/null 2>&1; then
  (cd "${CHECKSUM_DIR}" && sha256sum -c "${CHECKSUM_FILE}")
elif command -v shasum >/dev/null 2>&1; then
  (cd "${CHECKSUM_DIR}" && shasum -a 256 -c "${CHECKSUM_FILE}")
else
  echo "Cannot verify release checksum: sha256sum or shasum is required." >&2
  exit 1
fi

EXISTING_CONTAINER="$(docker ps -aq --filter "name=^/${CONTAINER_NAME}$")"
if [[ -z "${EXISTING_CONTAINER}" ]] && ss -H -ltn "sport = :${HOST_PORT}" | grep -q .; then
  echo "Host port ${HOST_PORT} is already in use." >&2
  exit 1
fi

RELEASE_ID="$(date -u +%Y%m%dT%H%M%SZ)"
RELEASE_PATH="${APP_ROOT}/releases/${RELEASE_ID}"
IMAGE_TAG="zhangdan:${RELEASE_ID}"
PROBE_NAME="zhangdan-probe-${RELEASE_ID}"
PREVIOUS_NAME=""

install -d -m 0755 "${APP_ROOT}" "${APP_ROOT}/releases" "${RELEASE_PATH}"
install -d -o 1000 -g 1000 -m 0700 "${STATE_ROOT}"
tar -xzf "${ARCHIVE_PATH}" -C "${RELEASE_PATH}" --strip-components=1

docker build --file "${RELEASE_PATH}/deploy/tencent-cloud/Dockerfile" --tag "${IMAGE_TAG}" "${RELEASE_PATH}"

container_options=(
  --cap-drop ALL
  --init
  --pids-limit 256
  --read-only
  --security-opt no-new-privileges:true
  --tmpfs /tmp:rw,noexec,nosuid,size=64m
)

docker run --detach \
  --name "${PROBE_NAME}" \
  --tmpfs /data:rw,noexec,nosuid,size=16m,uid=1000,gid=1000,mode=0700 \
  "${container_options[@]}" \
  "${IMAGE_TAG}" >/dev/null

probe_healthy=false
for _ in $(seq 1 30); do
  if docker exec "${PROBE_NAME}" node -e 'Promise.all([fetch("http://127.0.0.1:3000/healthz"), fetch("http://127.0.0.1:3000/api/auth/status")]).then(async ([health, auth]) => { const status = await auth.json(); process.exit(health.ok && auth.ok && typeof status.setupRequired === "boolean" ? 0 : 1); }).catch(() => process.exit(1))'; then
    probe_healthy=true
    break
  fi
  sleep 1
done

if [[ "${probe_healthy}" != true ]]; then
  docker logs --tail 100 "${PROBE_NAME}" >&2 || true
  docker rm --force "${PROBE_NAME}" >/dev/null || true
  echo "Candidate image failed its internal health check; the current service was not changed." >&2
  exit 1
fi

docker rm --force "${PROBE_NAME}" >/dev/null

if [[ -n "${EXISTING_CONTAINER}" ]]; then
  PREVIOUS_NAME="zhangdan-previous-${RELEASE_ID}"
  docker stop "${CONTAINER_NAME}" >/dev/null
  docker rename "${CONTAINER_NAME}" "${PREVIOUS_NAME}"
fi

rollback() {
  docker rm --force "${CONTAINER_NAME}" >/dev/null 2>&1 || true
  if [[ -n "${PREVIOUS_NAME}" ]]; then
    docker rename "${PREVIOUS_NAME}" "${CONTAINER_NAME}"
    docker start "${CONTAINER_NAME}" >/dev/null
  fi
}

if ! docker run --detach \
  --name "${CONTAINER_NAME}" \
  --publish "127.0.0.1:${HOST_PORT}:3000" \
  --mount "type=bind,source=${STATE_ROOT},target=/data" \
  --restart unless-stopped \
  "${container_options[@]}" \
  "${IMAGE_TAG}" >/dev/null; then
  rollback
  exit 1
fi

host_healthy=false
for _ in $(seq 1 30); do
  if curl -fsS --max-time 5 "http://127.0.0.1:${HOST_PORT}/healthz" >/dev/null && \
    curl -fsS --max-time 5 "http://127.0.0.1:${HOST_PORT}/api/auth/status" >/dev/null; then
    host_healthy=true
    break
  fi
  sleep 1
done

if [[ "${host_healthy}" != true ]]; then
  docker logs --tail 100 "${CONTAINER_NAME}" >&2 || true
  rollback
  echo "Published container failed its host health check; the previous container was restored." >&2
  exit 1
fi

TEMP_LINK="${APP_ROOT}/.current-${RELEASE_ID}"
ln -s "${RELEASE_PATH}" "${TEMP_LINK}"
mv -Tf "${TEMP_LINK}" "${APP_ROOT}/current"

docker ps --filter "name=^/${CONTAINER_NAME}$"
curl -fsS "http://127.0.0.1:${HOST_PORT}/healthz"
printf '\nDeployment succeeded. The dashboard is available only at 127.0.0.1:%s.\n' "${HOST_PORT}"
