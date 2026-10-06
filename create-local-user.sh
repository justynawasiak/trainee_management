#!/usr/bin/env bash
set -euo pipefail
if [[ $# -lt 1 || $# -gt 2 ]]; then
  echo "Usage: $0 <username> [password] (prefer the private prompt)" >&2
  exit 2
fi
username="$1"
if [[ $# -eq 2 ]]; then
  password="$2"
else
  read -r -s -p "Password (12–72 bytes): " password
  printf '\n'
fi
root_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
command -v php >/dev/null || { echo "PHP is required." >&2; exit 1; }
printf '%s' "$password" | php "$root_dir/scripts/create_user.php" "$username"
unset password
