#!/usr/bin/env bash
set -euo pipefail

out="${1:-.htpasswd}"

if ! command -v openssl >/dev/null 2>&1; then
  echo "Brak 'openssl'. Zainstaluj w WSL: sudo apt-get update && sudo apt-get install -y openssl" >&2
  exit 1
fi

u1="Arek"
u2="Justyna"

read -rsp "Hasło dla użytkownika '$u1': " p1
echo
read -rsp "Hasło dla użytkownika '$u2': " p2
echo

h1="$(printf '%s' "$p1" | openssl passwd -apr1 -stdin)"
h2="$(printf '%s' "$p2" | openssl passwd -apr1 -stdin)"

{
  printf "%s:%s\n" "$u1" "$h1"
  printf "%s:%s\n" "$u2" "$h2"
} > "$out"

echo "OK: zapisano $out"

