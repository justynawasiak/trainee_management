<?php
require_once __DIR__ . '/_auth.php';

$u = require_user();
$ns = sanitize_namespace($u);

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
  json_response(405, ['ok' => false]);
}

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

$dir = dirname(__DIR__) . '/data';
if (!is_dir($dir)) {
  @mkdir($dir, 0755, true);
}

$file = $dir . '/sync_' . $ns . '.json';
$tmp = $file . '.tmp';

$ok = @file_put_contents($tmp, $encoded, LOCK_EX);
if ($ok === false) {
  json_response(500, ['ok' => false, 'error' => 'write_failed']);
}
@rename($tmp, $file);

json_response(200, ['ok' => true]);
