<?php

function send_security_headers() {
  header('X-Content-Type-Options: nosniff');
  header('Referrer-Policy: strict-origin-when-cross-origin');
  header('X-Frame-Options: DENY');
  header("Content-Security-Policy: default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'");
}

function json_response($code, $payload) {
  http_response_code($code);
  send_security_headers();
  header('Content-Type: application/json; charset=utf-8');
  header('Cache-Control: no-store');
  echo json_encode($payload, JSON_UNESCAPED_UNICODE);
  exit;
}

function read_json_body() {
  $raw = file_get_contents('php://input', false, null, 0, 2 * 1024 * 1024 + 1);
  if ($raw === false) return null;
  if (strlen($raw) > 2 * 1024 * 1024) json_response(413, ['ok' => false, 'error' => 'too_large']);
  $raw = trim($raw);
  if ($raw === '') return null;
  $json = json_decode($raw, true);
  if (!is_array($json)) return null;
  return $json;
}

function is_https() {
  if (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off') return true;
  if (!empty($_SERVER['SERVER_PORT']) && (string)$_SERVER['SERVER_PORT'] === '443') return true;
  if (getenv('KLUB_TRUST_PROXY') === '1' && ($_SERVER['HTTP_X_FORWARDED_PROTO'] ?? '') === 'https') return true;
  return false;
}

function request_host() {
  $host = (string)($_SERVER['HTTP_HOST'] ?? '');
  $host = strtolower(trim($host));
  if ($host === '') return '';
  return preg_replace('/:\d+$/', '', $host);
}

function require_same_origin_post() {
  $origin = trim((string)($_SERVER['HTTP_ORIGIN'] ?? ''));
  if ($origin === '') return;

  $parsed = parse_url($origin);
  $originHost = $parsed['host'] ?? null;
  if (!is_string($originHost) || $originHost === '') {
    json_response(403, ['ok' => false, 'error' => 'bad_origin']);
  }

  $requestHost = request_host();
  $scheme = is_https() ? 'https' : 'http';
  $originPort = $parsed['port'] ?? (($parsed['scheme'] ?? '') === 'https' ? 443 : 80);
  $requestPort = (int)(parse_url($scheme . '://' . ($_SERVER['HTTP_HOST'] ?? ''), PHP_URL_PORT) ?? ($scheme === 'https' ? 443 : 80));
  if ($requestHost === '' || strcasecmp($originHost, $requestHost) !== 0 || ($parsed['scheme'] ?? '') !== $scheme || $originPort !== $requestPort) {
    json_response(403, ['ok' => false, 'error' => 'bad_origin']);
  }
}

function storage_directory() {
  $dir = getenv('KLUB_DATA_DIR') ?: dirname(__DIR__, 2) . '/private-data';
  if (!is_dir($dir) && !mkdir($dir, 0700, true) && !is_dir($dir)) throw new RuntimeException('Private storage unavailable');
  $resolved = realpath($dir);
  $public = realpath(dirname(__DIR__));
  if ($resolved === false || $resolved === $public || strpos($resolved, $public . DIRECTORY_SEPARATOR) === 0) {
    throw new RuntimeException('Private storage must be outside the document root');
  }
  return $resolved;
}

function migrate_private_file($name, $legacyName) {
  $destination = storage_directory() . '/' . $name;
  $legacyDir = getenv('KLUB_LEGACY_DATA_DIR') ?: dirname(__DIR__) . '/data';
  $legacy = $legacyDir . '/' . $legacyName;
  if (!file_exists($destination) && is_file($legacy)) {
    $lock = fopen($destination . '.migration.lock', 'c');
    if ($lock === false || !flock($lock, LOCK_EX)) throw new RuntimeException('Migration lock unavailable');
    try {
      if (!file_exists($destination)) {
        $temporary = tempnam(storage_directory(), '.migration-');
        if ($temporary === false || !copy($legacy, $temporary) || !chmod($temporary, 0600) || !rename($temporary, $destination)) {
          if ($temporary !== false && is_file($temporary)) unlink($temporary);
          throw new RuntimeException('Storage migration failed');
        }
      }
    } finally { flock($lock, LOCK_UN); fclose($lock); }
  }
  return $destination;
}

if (PHP_SAPI !== 'cli') {
  ini_set('display_errors', '0');
  set_exception_handler(function ($error) {
    error_log('Klub: request failed');
    json_response(500, ['ok' => false, 'error' => 'server_error']);
  });
}
