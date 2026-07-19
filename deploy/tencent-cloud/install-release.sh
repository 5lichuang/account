#!/usr/bin/env bash
set -euo pipefail

APP_USER="zhangdan"
APP_ROOT="/opt/zhangdan"
STATE_ROOT="/var/lib/zhangdan"
SERVICE_NAME="zhangdan.service"
ARCHIVE_PATH="${1:-}"

if [[ "${EUID}" -ne 0 ]]; then
  echo "Run this installer as root." >&2
  exit 1
fi

if [[ -z "${ARCHIVE_PATH}" || ! -f "${ARCHIVE_PATH}" ]]; then
  echo "Usage: sudo bash install-release.sh /path/to/zhangdan-release.tar.gz" >&2
  exit 1
fi

for command_name in node npm systemctl tar runuser; do
  if ! command -v "${command_name}" >/dev/null 2>&1; then
    echo "Required command not found: ${command_name}" >&2
    exit 1
  fi
done

if [[ ! -x /usr/bin/node ]]; then
  echo "A system-wide Node.js installation at /usr/bin/node is required for systemd." >&2
  exit 1
fi

CHECKSUM_PATH="${ARCHIVE_PATH}.sha256"
if [[ -f "${CHECKSUM_PATH}" ]]; then
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
fi

node -e '
  const [major, minor] = process.versions.node.split(".").map(Number);
  if (major < 22 || (major === 22 && minor < 13)) {
    console.error(`Node.js 22.13.0 or newer is required; found ${process.versions.node}`);
    process.exit(1);
  }
'

if ! id "${APP_USER}" >/dev/null 2>&1; then
  useradd --system --home-dir "${STATE_ROOT}" --create-home --shell /usr/sbin/nologin "${APP_USER}"
fi

install -d -m 0755 "${APP_ROOT}" "${APP_ROOT}/releases"
install -d -o "${APP_USER}" -g "${APP_USER}" -m 0700 "${STATE_ROOT}"

RELEASE_ID="$(date -u +%Y%m%dT%H%M%SZ)"
RELEASE_PATH="${APP_ROOT}/releases/${RELEASE_ID}"
CURRENT_LINK="${APP_ROOT}/current"
PREVIOUS_TARGET=""

if [[ -L "${CURRENT_LINK}" ]]; then
  PREVIOUS_TARGET="$(readlink -f "${CURRENT_LINK}")"
fi

mkdir -p "${RELEASE_PATH}"
tar -xzf "${ARCHIVE_PATH}" -C "${RELEASE_PATH}" --strip-components=1
chown -R "${APP_USER}:${APP_USER}" "${RELEASE_PATH}"

runuser -u "${APP_USER}" -- env HOME="${STATE_ROOT}" npm --prefix "${RELEASE_PATH}" ci --include=dev --no-audit --no-fund
runuser -u "${APP_USER}" -- env HOME="${STATE_ROOT}" npm --prefix "${RELEASE_PATH}" run build

if [[ ! -f "${RELEASE_PATH}/dist/server/index.js" ]]; then
  echo "Build did not produce dist/server/index.js" >&2
  exit 1
fi

chown -R root:root "${RELEASE_PATH}"
TEMP_LINK="${APP_ROOT}/.current-${RELEASE_ID}"
ln -s "${RELEASE_PATH}" "${TEMP_LINK}"
mv -Tf "${TEMP_LINK}" "${CURRENT_LINK}"

install -m 0644 "${RELEASE_PATH}/deploy/tencent-cloud/zhangdan.service" "/etc/systemd/system/${SERVICE_NAME}"
systemctl daemon-reload
systemctl enable "${SERVICE_NAME}"
systemctl restart "${SERVICE_NAME}"

healthy=false
for _ in $(seq 1 30); do
  if node -e 'fetch("http://127.0.0.1:3000/healthz").then((r) => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))'; then
    healthy=true
    break
  fi
  sleep 1
done

if [[ "${healthy}" != true ]]; then
  echo "Health check failed; restoring the previous release." >&2
  if [[ -n "${PREVIOUS_TARGET}" && -d "${PREVIOUS_TARGET}" ]]; then
    RESTORE_LINK="${APP_ROOT}/.restore-${RELEASE_ID}"
    ln -s "${PREVIOUS_TARGET}" "${RESTORE_LINK}"
    mv -Tf "${RESTORE_LINK}" "${CURRENT_LINK}"
    systemctl restart "${SERVICE_NAME}"
  else
    systemctl stop "${SERVICE_NAME}" || true
  fi
  journalctl -u "${SERVICE_NAME}" --no-pager -n 50 >&2 || true
  exit 1
fi

systemctl --no-pager --full status "${SERVICE_NAME}"
echo "Deployment succeeded. The application is listening only on 127.0.0.1:3000."
