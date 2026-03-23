<?php

function json_response($code, $payload) {
  http_response_code($code);
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

