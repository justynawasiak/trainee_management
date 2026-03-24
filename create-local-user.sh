#!/usr/bin/env bash
set -euo pipefail

if [[ $# -lt 2 ]]; then
  echo "Usage: $0 <username> <password>" >&2
  exit 2
fi

USERNAME="$1"
PASSWORD="$2"

ROOT_DIR="$(cd "$(dirname "$0")" && pwd)"
DATA_DIR="$ROOT_DIR/pwa/data"
USERS_FILE="$DATA_DIR/users.json"

mkdir -p "$DATA_DIR"

if ! command -v php >/dev/null 2>&1; then
  echo "php not found. Install PHP or run this from a WSL distro with php." >&2
  exit 1
fi

php -r '
$file = $argv[1];
$username = trim((string)$argv[2]);
$password = (string)$argv[3];

if ($username === "" || $password === "") {
  fwrite(STDERR, "Username and password are required.\n");
  exit(1);
}

$payload = ["version" => 1, "users" => []];
if (file_exists($file)) {
  $json = json_decode((string)file_get_contents($file), true);
  if (is_array($json) && isset($json["users"]) && is_array($json["users"])) {
    $payload = $json;
  }
}

$updated = false;
foreach ($payload["users"] as &$user) {
  if ((string)($user["username"] ?? "") === $username) {
    $user["passwordHash"] = password_hash($password, PASSWORD_BCRYPT);
    $user["updatedAt"] = time();
    $updated = true;
    break;
  }
}
unset($user);

if (!$updated) {
  $payload["users"][] = [
    "username" => $username,
    "passwordHash" => password_hash($password, PASSWORD_BCRYPT),
    "createdAt" => time()
  ];
}

file_put_contents(
  $file,
  json_encode($payload, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES),
  LOCK_EX
);
' "$USERS_FILE" "$USERNAME" "$PASSWORD"

echo "Local user saved in: $USERS_FILE"

