#!/usr/bin/env bash
set -euo pipefail
root_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# The authenticated app must never be served by a static server.
exec bash "$root_dir/serve-php.sh" "$@"
