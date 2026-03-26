<?php
require_once __DIR__ . '/_auth.php';

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
  json_response(405, ['ok' => false]);
}

require_same_origin_post();
rate_check_or_429();

$body = read_json_body();
$username = trim((string)($body['username'] ?? ''));
$password = (string)($body['password'] ?? '');

if ($username === '' || $password === '') {
  json_response(400, ['ok' => false, 'error' => 'missing_credentials']);
}

// small delay to make brute-force slower
usleep(180000);

$u = verify_user($username, $password);
if ($u === null) {
  rate_record_fail();
  json_response(401, ['ok' => false, 'error' => 'invalid_credentials']);
}

session_boot();
session_regenerate_id(true);
$_SESSION['username'] = $u;

json_response(200, ['ok' => true, 'username' => $u]);
