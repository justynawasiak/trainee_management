#!/usr/bin/env bash
set -euo pipefail

PORT="5173"
HOST="127.0.0.1"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --port)
      PORT="${2:-5173}"
      shift 2
      ;;
    --listen-all)
      HOST="0.0.0.0"
      shift
      ;;
    *)
      echo "Usage: $0 [--port <port>] [--listen-all]" >&2
      exit 2
      ;;
  esac
done

cd "$(dirname "$0")"

if ! command -v php >/dev/null 2>&1; then
  echo "php not found. Install PHP (or run from a WSL distro with php) and try again." >&2
  exit 1
fi

echo "Serving PWA with PHP auth on http://${HOST}:${PORT} (router: pwa/router.php)"
php -S "${HOST}:${PORT}" -t pwa pwa/router.php

