#!/usr/bin/env bash
set -euo pipefail

arch="${1:-}"
arch_flag=""
pnpm_bin="pnpm"

if ! command -v "$pnpm_bin" >/dev/null 2>&1; then
  if [ -x "./node_modules/.bin/pnpm" ]; then
    pnpm_bin="./node_modules/.bin/pnpm"
  else
    echo "pnpm is required. Install dependencies or run through the workspace package scripts." >&2
    exit 127
  fi
fi

case "$arch" in
  "")
    ;;
  "x64" | "arm64" | "universal")
    arch_flag="--$arch"
    ;;
  "--x64" | "--arm64" | "--universal")
    arch_flag="$arch"
    ;;
  *)
    echo "Usage: scripts/build-macos-dmg.sh [x64|arm64|universal]" >&2
    exit 2
    ;;
esac

"$pnpm_bin" build
"$pnpm_bin" desktop:build

export CSC_IDENTITY_AUTO_DISCOVERY="${CSC_IDENTITY_AUTO_DISCOVERY:-false}"

for attempt in 1 2 3; do
  set +e
  if [ -n "$arch_flag" ]; then
    "$pnpm_bin" --filter desktop exec electron-builder --mac dmg "$arch_flag" --publish never
  else
    "$pnpm_bin" --filter desktop exec electron-builder --mac dmg --publish never
  fi
  status=$?
  set -e

  if [ "$status" -eq 0 ]; then
    exit 0
  fi

  if [ "$attempt" -eq 3 ]; then
    exit "$status"
  fi

  sleep "$((attempt * 10))"
done
