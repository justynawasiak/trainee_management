#!/usr/bin/env bash
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
mobile_root="$(cd "$here/.." && pwd)"
repo_root="$(cd "$mobile_root/.." && pwd)"

src="$repo_root/pwa"
dst="$mobile_root/www"

if [[ ! -d "$src" ]]; then
  echo "Source not found: $src" >&2
  exit 1
fi

mkdir -p "$dst"

rm -rf "$dst"/*
cp -R "$src"/. "$dst"/

# optional: remove docs from packaged web dir
rm -f "$dst/README.md" || true

echo "Synced web assets:"
echo "  $src  ->  $dst"

