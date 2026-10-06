#!/usr/bin/env bash
set -euo pipefail

PORT="5173"
HOST="127.0.0.1"
ROOT_DIR="$(cd "$(dirname "$0")" && pwd)"

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
    --root)
      requested_root="$(cd "${2:?Provide the application root}" && pwd)"
      [[ "$requested_root" == "$ROOT_DIR/pwa" ]] || { echo "Only the authenticated pwa root is supported." >&2; exit 2; }
      shift 2
      ;;
    -h|--help)
      echo "Usage: $0 [--port <port>] [--listen-all] [--root ./pwa]"
      exit 0
      ;;
    *)
      echo "Usage: $0 [--port <port>] [--listen-all]" >&2
      exit 2
      ;;
  esac
done

[[ "$PORT" =~ ^[0-9]{1,5}$ ]] && (( 10#$PORT >= 1 && 10#$PORT <= 65535 )) || { echo "Invalid port." >&2; exit 2; }
cd "$ROOT_DIR"

if ! command -v php >/dev/null 2>&1; then
  echo "php not found. Install PHP (or run from a WSL distro with php) and try again." >&2
  exit 1
fi

echo "Serving PWA with PHP auth on http://${HOST}:${PORT} (router: pwa/router.php)"
php -S "${HOST}:${PORT}" -t pwa pwa/router.php
