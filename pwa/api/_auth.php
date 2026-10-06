<?php
require_once __DIR__ . '/_util.php';

function users_file_path() {
  return migrate_private_file('users.json', 'users.json');
}

function load_users() {
  if (!file_exists(users_file_path())) return [];
  $raw = @file_get_contents(users_file_path());
  if ($raw === false) throw new RuntimeException('Account storage unavailable');
  $json = json_decode($raw, true);
  if (!is_array($json) || !isset($json['users']) || !is_array($json['users'])) throw new RuntimeException('Account storage is corrupt');
  return $json['users'];
}

function verify_user($username, $password) {
  $users = load_users();
  foreach ($users as $u) {
    if (!isset($u['username']) || !isset($u['passwordHash'])) continue;
    if ((string)$u['username'] !== (string)$username) continue;
    if (password_verify((string)$password, (string)$u['passwordHash'])) {
      return (string)$u['username'];
    }
    return null;
  }
  return null;
}

function session_boot() {
  $secure = is_https();
  ini_set('session.use_strict_mode', '1');
  ini_set('session.use_only_cookies', '1');
  if (PHP_VERSION_ID >= 70300) {
    session_set_cookie_params([
      'lifetime' => 60 * 60 * 24 * 7,
      'path' => '/',
      'secure' => $secure,
      'httponly' => true,
      'samesite' => 'Strict'
    ]);
  } else {
    // best-effort fallback for old PHP
    ini_set('session.cookie_httponly', '1');
    ini_set('session.cookie_secure', $secure ? '1' : '0');
  }
  if (session_status() !== PHP_SESSION_ACTIVE) {
    session_name('klub_sess');
    session_start();
  }
}

function current_user() {
  session_boot();
  $u = (string)($_SESSION['username'] ?? '');
  return $u === '' ? null : $u;
}

function require_user() {
  $u = current_user();
  if ($u === null) {
    json_response(401, ['ok' => false]);
  }
  return $u;
}

function sanitize_namespace($input) {
  $s = strtolower(trim((string)$input));
  $s = preg_replace('/[^a-z0-9]+/', '_', $s);
  $s = preg_replace('/^_+|_+$/', '', $s);
  return $s;
}

function account_id($username) { return hash('sha256', (string)$username); }

function legacy_namespace_for($username) {
  $namespace = sanitize_namespace($username);
  if ($namespace === '') return null;
  $matches = 0;
  foreach (load_users() as $user) {
    if (sanitize_namespace($user['username'] ?? '') === $namespace) $matches++;
  }
  return $matches === 1 ? $namespace : null;
}

function sync_file_path($username) {
  $name = 'sync_' . account_id($username) . '.json';
  $legacy = legacy_namespace_for($username);
  if ($legacy !== null) return migrate_private_file($name, 'sync_' . $legacy . '.json');
  return storage_directory() . '/' . $name;
}

function rate_key() {
  $ip = $_SERVER['REMOTE_ADDR'] ?? 'unknown';
  return substr(hash('sha256', (string)$ip), 0, 16);
}

function rate_file() {
  return storage_directory() . '/login_rate_' . rate_key() . '.json';
}

function rate_check_or_429() {
  $file = rate_file();
  $handle = fopen($file, 'c+');
  if ($handle === false || !flock($handle, LOCK_EX)) json_response(503, ['ok' => false, 'error' => 'rate_limit_unavailable']);
  chmod($file, 0600);
  $now = time();
  $attempts = json_decode((string)stream_get_contents($handle), true);
  if (!is_array($attempts)) $attempts = [];
  $attempts = array_values(array_filter($attempts, function ($timestamp) use ($now) {
    return is_int($timestamp) && $timestamp >= $now - 900;
  }));
  $limited = count($attempts) >= 25;
  if (!$limited) $attempts[] = $now;
  rewind($handle);
  $encoded = json_encode($attempts);
  $saved = ftruncate($handle, 0) && fwrite($handle, $encoded) === strlen($encoded) && fflush($handle);
  flock($handle, LOCK_UN); fclose($handle);
  if (!$saved) json_response(503, ['ok' => false, 'error' => 'rate_limit_unavailable']);
  if ($limited) json_response(429, ['ok' => false, 'error' => 'too_many_attempts']);
}
