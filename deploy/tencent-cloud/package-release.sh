#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
OUTPUT_PATH="${1:-${ROOT_DIR}/outputs/zhangdan-release.tar.gz}"
STAGING_DIR="$(mktemp -d)"
RELEASE_DIR="${STAGING_DIR}/zhangdan"

cleanup() {
  rm -rf "${STAGING_DIR}"
}
trap cleanup EXIT

mkdir -p "${RELEASE_DIR}" "$(dirname "${OUTPUT_PATH}")"

release_items=(
  .dockerignore
  .openai
  app
  build
  db
  deploy
  docs
  drizzle
  lib
  public
  worker
  AGENTS.md
  README.md
  ROADMAP.md
  cloudflare-env.d.ts
  drizzle.config.ts
  eslint.config.mjs
  next.config.ts
  package-lock.json
  package.json
  postcss.config.mjs
  tsconfig.json
  vite.config.ts
)

for item in "${release_items[@]}"; do
  if [[ ! -e "${ROOT_DIR}/${item}" ]]; then
    echo "Missing release item: ${item}" >&2
    exit 1
  fi
  cp -R "${ROOT_DIR}/${item}" "${RELEASE_DIR}/"
done

find "${RELEASE_DIR}" -name .DS_Store -delete
COPYFILE_DISABLE=1 tar --no-xattrs -C "${STAGING_DIR}" -czf "${OUTPUT_PATH}" zhangdan

if command -v shasum >/dev/null 2>&1; then
  CHECKSUM="$(shasum -a 256 "${OUTPUT_PATH}" | cut -d ' ' -f 1)"
else
  CHECKSUM="$(sha256sum "${OUTPUT_PATH}" | cut -d ' ' -f 1)"
fi
printf '%s  %s\n' "${CHECKSUM}" "$(basename "${OUTPUT_PATH}")" > "${OUTPUT_PATH}.sha256"

echo "Release archive: ${OUTPUT_PATH}"
echo "Checksum: ${OUTPUT_PATH}.sha256"
