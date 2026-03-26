<?php
require_once __DIR__ . '/_auth.php';

$u = require_user();
$ns = sanitize_namespace($u);

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
  json_response(405, ['ok' => false]);
}

require_same_origin_post();
$body = read_json_body();
if (!is_array($body)) {
  json_response(400, ['ok' => false, 'error' => 'bad_json']);
}

// Basic validation + size limit (best-effort)
$encoded = json_encode($body, JSON_UNESCAPED_UNICODE);
if ($encoded === false) {
  json_response(400, ['ok' => false, 'error' => 'bad_payload']);
}
if (strlen($encoded) > 2 * 1024 * 1024) {
  json_response(413, ['ok' => false, 'error' => 'too_large']);
}

if (!isset($body['version']) || !isset($body['data']) || !is_array($body['data'])) {
  json_response(400, ['ok' => false, 'error' => 'bad_payload']);
}

$allowedStores = ['trainees', 'groups', 'memberships', 'attendance', 'payments', 'settings', 'scopes', 'sessionScopes'];
foreach ($allowedStores as $storeName) {
  if (isset($body['data'][$storeName]) && !is_array($body['data'][$storeName])) {
    json_response(400, ['ok' => false, 'error' => 'bad_payload']);
  }
}

$dir = dirname(__DIR__) . '/data';
if (!is_dir($dir)) {
  @mkdir($dir, 0755, true);
}

$file = $dir . '/sync_' . $ns . '.json';
$tmp = $file . '.tmp';

$updatedAt = time();
$wrapped = json_encode([
  'updatedAt' => $updatedAt,
  'username' => $u,
  'payload' => $body
], JSON_UNESCAPED_UNICODE);
if ($wrapped === false) {
  json_response(400, ['ok' => false, 'error' => 'bad_payload']);
}

$ok = @file_put_contents($tmp, $wrapped, LOCK_EX);
if ($ok === false) {
  json_response(500, ['ok' => false, 'error' => 'write_failed']);
}
@rename($tmp, $file);
@chmod($file, 0600);

json_response(200, ['ok' => true, 'updatedAt' => $updatedAt]);
