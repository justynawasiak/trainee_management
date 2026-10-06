<?php
require_once __DIR__ . '/_auth.php';
require_once __DIR__ . '/_payload.php';

$user = require_user();
session_write_close();
if ($_SERVER['REQUEST_METHOD'] !== 'POST') json_response(405, ['ok' => false]);
require_same_origin_post();
$body = read_json_body();
if (!valid_sync_payload($body)) json_response(400, ['ok' => false, 'error' => 'bad_payload']);
if (!isset($body['baseRevision']) || !is_int($body['baseRevision']) || $body['baseRevision'] < 0) {
  json_response(428, ['ok' => false, 'error' => 'revision_required']);
}

$file = sync_file_path($user);
$lock = fopen($file . '.lock', 'c');
if ($lock === false || !flock($lock, LOCK_EX)) json_response(500, ['ok' => false, 'error' => 'lock_failed']);
$temporary = false;
$response = ['ok' => false, 'error' => 'write_failed'];
$status = 500;
try {
  $current = is_file($file) ? json_decode((string)file_get_contents($file), true) : null;
  if (is_file($file) && !is_array($current)) throw new RuntimeException('Corrupt server snapshot');
  $revision = (int)($current['revision'] ?? $current['updatedAt'] ?? 0);
  if ($body['baseRevision'] !== $revision) {
    $status = 409;
    $response = ['ok' => false, 'error' => 'revision_conflict', 'revision' => $revision];
  } else {
    unset($body['baseRevision']);
    $revision++;
    $updatedAt = time();
    $encoded = json_encode(['revision' => $revision, 'updatedAt' => $updatedAt, 'username' => $user, 'payload' => $body], JSON_UNESCAPED_UNICODE);
    if ($encoded === false) throw new RuntimeException('Encoding failed');
    $temporary = tempnam(storage_directory(), '.sync-');
    if ($temporary === false || !chmod($temporary, 0600) || file_put_contents($temporary, $encoded, LOCK_EX) !== strlen($encoded) || !rename($temporary, $file)) {
      throw new RuntimeException('Snapshot replacement failed');
    }
    $status = 200;
    $response = ['ok' => true, 'revision' => $revision, 'updatedAt' => $updatedAt];
  }
} catch (Throwable $error) {
  error_log('Klub: snapshot persistence failed');
} finally {
  if ($temporary !== false && is_file($temporary)) unlink($temporary);
  flock($lock, LOCK_UN);
  fclose($lock);
}
json_response($status, $response);
