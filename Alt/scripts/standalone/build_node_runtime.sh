#!/usr/bin/env bash
# Build portable Node.js runtime + copy app into src-tauri/resources/studio/
# Run on the TARGET platform before `corepack pnpm run tauri:build`.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
NODE_VERSION="${NODE_VERSION:-22.14.0}"
OUT_DIR="${PROJECT_ROOT}/src-tauri/resources/studio"
RUNTIME_DIR="${OUT_DIR}/runtime"
APP_DIR="${OUT_DIR}/app"

UNAME_M="$(uname -m)"
case "${UNAME_M}" in
  arm64|aarch64) NODE_ARCH="arm64" ;;
  x86_64)        NODE_ARCH="x64" ;;
  *) echo "ERROR: unsupported arch ${UNAME_M}" >&2; exit 1 ;;
esac

NODE_TAR="node-v${NODE_VERSION}-darwin-${NODE_ARCH}.tar.gz"
NODE_URL="https://nodejs.org/dist/v${NODE_VERSION}/${NODE_TAR}"

echo "==> Resetting ${OUT_DIR}"
rm -rf "${OUT_DIR}"
mkdir -p "${RUNTIME_DIR}" "${APP_DIR}"

echo "==> Downloading Node ${NODE_VERSION} (${NODE_ARCH})"
TMP_TGZ="$(mktemp -t node).tar.gz"
trap 'rm -f "${TMP_TGZ}"' EXIT
curl -fsSL "${NODE_URL}" -o "${TMP_TGZ}"
tar -xzf "${TMP_TGZ}" -C "${RUNTIME_DIR}" --strip-components=1

echo "==> Copying app sources"
# Only the Node/Remotion sidecar — never nest src-tauri/resources into itself,
# and never drag a previously built app (dist-mac/dist-win) into the bundle.
rsync -a \
  --exclude node_modules \
  --exclude out \
  --exclude dist-webapp \
  --exclude dist-mac \
  --exclude dist-win \
  --exclude src-tauri \
  --exclude uploads \
  --exclude jobs \
  --exclude .git \
  --exclude .npm-cache \
  --exclude .remotion \
  --exclude '.DS_Store' \
  --exclude 'BUILD.md' \
  --exclude '*_schaue-*.md' \
  --exclude 'Start Studio.command' \
  --exclude 'Start Studio.bat' \
  --exclude 'Build Mac App.command' \
  --exclude 'Build Windows.bat' \
  "${PROJECT_ROOT}/" "${APP_DIR}/"

# --node-linker=hoisted: a flat node_modules without symlinks.
# pnpm's default store layout does not survive Tauri's resource bundling.
# Store on the internal APFS disk — BuhoNTFS/external volumes often fail
# mid-copy with errno -70 (ESTALE) when the store lives on the same volume.
echo "==> pnpm install in bundle"
export PATH="${RUNTIME_DIR}/bin:${PATH}"
PNPM_STORE_DIR="${PNPM_STORE_DIR:-${HOME}/Library/pnpm/store}"
mkdir -p "${PNPM_STORE_DIR}"
echo "    store: ${PNPM_STORE_DIR}"
cd "${APP_DIR}"
corepack pnpm install --frozen-lockfile --node-linker=hoisted --store-dir "${PNPM_STORE_DIR}"

echo "==> Pre-cache Remotion browser + FFmpeg"
corepack pnpm exec remotion browser ensure

cat > "${OUT_DIR}/BUNDLE_INFO.txt" <<EOF
Room Flythrough Studio bundle
Node: ${NODE_VERSION} darwin-${NODE_ARCH}
Built: $(date -u +"%Y-%m-%dT%H:%M:%SZ")
EOF

echo "==> Done: ${OUT_DIR}"
