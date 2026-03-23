<?php
require_once __DIR__ . '/_auth.php';

$u = require_user();
$ns = sanitize_namespace($u);

$file = dirname(__DIR__) . '/data/sync_' . $ns . '.json';
header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');

if (!file_exists($file)) {
  json_response(200, ['ok' => true, 'exists' => false]);
}

$raw = @file_get_contents($file);
if ($raw === false) {
  json_response(500, ['ok' => false, 'error' => 'read_failed']);
}

$json = json_decode($raw, true);
if (!is_array($json)) {
  json_response(500, ['ok' => false, 'error' => 'corrupt']);
}

json_response(200, ['ok' => true, 'exists' => true, 'payload' => $json]);

