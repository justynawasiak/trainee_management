<?php
require_once dirname(__DIR__) . '/pwa/api/_auth.php';

if (PHP_SAPI !== 'cli') exit(1);
$username = trim($argv[1] ?? '');
$password = rtrim((string)stream_get_contents(STDIN), "\r\n");
if ($username === '' || strlen($username) > 128 || strlen($password) < 12 || strlen($password) > 72) {
  fwrite(STDERR, "Provide a username and a password of 12–72 bytes.\n");
  exit(1);
}
$file = users_file_path();
$lock = fopen($file . '.lock', 'c');
if ($lock === false || !flock($lock, LOCK_EX)) throw new RuntimeException('Account lock unavailable');
$temporary = false;
try {
  $users = load_users();
  foreach ($users as $existing) {
    if ($existing['username'] !== $username && sanitize_namespace($existing['username']) === sanitize_namespace($username)) {
      throw new RuntimeException('Username conflicts with an existing legacy account');
    }
  }
  $row = ['username' => $username, 'passwordHash' => password_hash($password, PASSWORD_BCRYPT), 'updatedAt' => time()];
  $found = false;
  foreach ($users as &$user) if ($user['username'] === $username) { $user = array_merge($user, $row); $found = true; }
  unset($user);
  if (!$found) $users[] = array_merge($row, ['createdAt' => time()]);
  $encoded = json_encode(['version' => 1, 'users' => $users], JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE);
  $temporary = tempnam(storage_directory(), '.users-');
  if ($encoded === false || $temporary === false || !chmod($temporary, 0600) || file_put_contents($temporary, $encoded) !== strlen($encoded) || !rename($temporary, $file)) {
    throw new RuntimeException('Account save failed');
  }
} finally {
  if ($temporary !== false && is_file($temporary)) unlink($temporary);
  flock($lock, LOCK_UN); fclose($lock);
}
fwrite(STDOUT, "Account saved.\n");
