<?php
header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');

// When protected by Basic Auth, Apache/PHP exposes the username here.
$u = '';
if (isset($_SERVER['PHP_AUTH_USER'])) {
  $u = $_SERVER['PHP_AUTH_USER'];
} elseif (isset($_SERVER['REMOTE_USER'])) {
  $u = $_SERVER['REMOTE_USER'];
}

echo json_encode([
  'ok' => $u !== '',
  'username' => $u
], JSON_UNESCAPED_UNICODE);

