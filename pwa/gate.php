<?php
require_once __DIR__ . '/api/_auth.php';

session_boot();
$u = (string)($_SESSION['username'] ?? '');

header('Content-Type: text/html; charset=utf-8');
header('Cache-Control: no-store');

if ($u === '') {
  readfile(__DIR__ . '/login.html');
  exit;
}

readfile(__DIR__ . '/index.html');

