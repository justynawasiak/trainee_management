#!/usr/bin/env bash
set -euo pipefail

port="5173"
root_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
root="$root_dir/pwa"
bind="127.0.0.1"

usage() {
  cat <<'EOF'
Usage:
  ./serve.sh [--port 5173] [--root ./pwa] [--listen-all]

Options:
  --port N        Port (default: 5173)
  --root PATH     Directory to serve (default: ./pwa)
  --listen-all    Bind to 0.0.0.0 (default binds to 127.0.0.1)
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --port)
      port="${2:-}"; shift 2
      ;;
    --root)
      root="${2:-}"; shift 2
      ;;
    --listen-all)
      bind="0.0.0.0"; shift
      ;;
    -h|--help)
      usage; exit 0
      ;;
    *)
      echo "Unknown arg: $1" >&2
      usage >&2
      exit 2
      ;;
  esac
done

if [[ ! -d "$root" ]]; then
  echo "Root directory not found: $root" >&2
  exit 1
fi

if ! command -v python3 >/dev/null 2>&1; then
  echo "python3 not found. Install Python in WSL (e.g. sudo apt-get install -y python3)." >&2
  exit 1
fi

echo "Serving: $root"
echo "URL: http://localhost:$port/"
if [[ "$bind" == "0.0.0.0" ]]; then
  echo "Mode: --listen-all (bind 0.0.0.0)"
fi

cd "$root"
exec python3 -m http.server "$port" --bind "$bind"

