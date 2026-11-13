#!/usr/bin/env bash
set -euo pipefail

PORT="${NOVA_RECEIVER_PORT:-7654}"
TOKEN="${NOVA_TOKEN:-novashare-secret-2026}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"

echo "================================================================"
echo "🐧 NovaShare — Starting Linux Omarchy Receiver Daemon"
echo "================================================================"
if command -v tailscale >/dev/null 2>&1; then
  TS_IP="$(tailscale ip -4 2>/dev/null | head -n 1 || true)"
  if [ -n "${TS_IP}" ]; then
    echo "🔗 Tailscale URL : http://${TS_IP}:${PORT}"
  fi
fi

if [ -x "${ROOT_DIR}/dist/novashare-linux" ]; then
  exec "${ROOT_DIR}/dist/novashare-linux" --receiver --port "${PORT}" --token "${TOKEN}"
else
  exec bun run "${ROOT_DIR}/src/index.ts" --receiver --port "${PORT}" --token "${TOKEN}"
fi
