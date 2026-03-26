<?php
require_once __DIR__ . '/_util.php';

function users_file_path() {
  return dirname(__DIR__) . '/data/users.json';
}

function ensure_users_dir() {
  $dir = dirname(users_file_path());
  if (!is_dir($dir)) {
    @mkdir($dir, 0755, true);
  }
}

function ensure_default_users_file() {
  if (!is_local_runtime()) return;
  ensure_users_dir();
  $file = users_file_path();
  if (file_exists($file)) return;

  $users = [];
  $defaults = [
    ['username' => 'Arek', 'password' => 'EarlGrey011'],
    ['username' => 'Justyna', 'password' => 'EarlGrey011']
  ];

  foreach ($defaults as $u) {
    $users[] = [
      'username' => $u['username'],
      'passwordHash' => password_hash($u['password'], PASSWORD_BCRYPT),
      'createdAt' => time()
    ];
  }

  $payload = json_encode(['version' => 1, 'users' => $users], JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT);
  @file_put_contents($file, $payload, LOCK_EX);
}

function load_users() {
  ensure_default_users_file();
  if (!file_exists(users_file_path())) return [];
  $raw = @file_get_contents(users_file_path());
  if ($raw === false) return [];
  $json = json_decode($raw, true);
  if (!is_array($json) || !isset($json['users']) || !is_array($json['users'])) return [];
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

function rate_key() {
  $ip = $_SERVER['REMOTE_ADDR'] ?? 'unknown';
  return substr(hash('sha256', (string)$ip), 0, 16);
}

function rate_file() {
  return rtrim(sys_get_temp_dir(), '/\\') . '/klub_login_' . rate_key() . '.json';
}

function rate_read() {
  $raw = @file_get_contents(rate_file());
  if ($raw === false) return [];
  $json = json_decode($raw, true);
  if (!is_array($json)) return [];
  return $json;
}

function rate_write($arr) {
  @file_put_contents(rate_file(), json_encode($arr), LOCK_EX);
}

function rate_check_or_429() {
  $now = time();
  $window = 15 * 60;
  $limit = 25;

  $arr = rate_read();
  $arr = array_values(array_filter($arr, function($t) use ($now, $window) {
    return is_int($t) && ($now - $t) <= $window;
  }));

  if (count($arr) >= $limit) {
    json_response(429, ['ok' => false, 'error' => 'too_many_attempts']);
  }

  // write back trimmed list
  rate_write($arr);
}

function rate_record_fail() {
  $now = time();
  $arr = rate_read();
  $arr[] = $now;
  rate_write($arr);
}
