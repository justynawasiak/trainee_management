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
  $raw = file_get_contents('php://input');
  if ($raw === false) return null;
  $raw = trim($raw);
  if ($raw === '') return null;
  $json = json_decode($raw, true);
  if (!is_array($json)) return null;
  return $json;
}

function is_https() {
  if (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off') return true;
  if (!empty($_SERVER['SERVER_PORT']) && (string)$_SERVER['SERVER_PORT'] === '443') return true;
  if (!empty($_SERVER['HTTP_X_FORWARDED_PROTO']) && $_SERVER['HTTP_X_FORWARDED_PROTO'] === 'https') return true;
  return false;
}

function request_host() {
  $host = (string)($_SERVER['HTTP_HOST'] ?? '');
  $host = strtolower(trim($host));
  if ($host === '') return '';
  return preg_replace('/:\d+$/', '', $host);
}

function is_local_runtime() {
  $host = request_host();
  if ($host === 'localhost' || $host === '127.0.0.1' || $host === '::1') return true;
  $addr = (string)($_SERVER['SERVER_ADDR'] ?? '');
  if ($addr === '127.0.0.1' || $addr === '::1') return true;
  return PHP_SAPI === 'cli-server';
}

function require_same_origin_post() {
  $origin = trim((string)($_SERVER['HTTP_ORIGIN'] ?? ''));
  if ($origin === '') return;

  $originHost = parse_url($origin, PHP_URL_HOST);
  if (!is_string($originHost) || $originHost === '') {
    json_response(403, ['ok' => false, 'error' => 'bad_origin']);
  }

  $requestHost = request_host();
  if ($requestHost === '' || strcasecmp($originHost, $requestHost) !== 0) {
    json_response(403, ['ok' => false, 'error' => 'bad_origin']);
  }
}
