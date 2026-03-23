<?php
require_once __DIR__ . '/_auth.php';

session_boot();
$_SESSION = [];

if (ini_get('session.use_cookies')) {
  $params = session_get_cookie_params();
  setcookie(session_name(), '', time() - 3600, $params['path'] ?? '/', '', (bool)($params['secure'] ?? false), true);
}

session_destroy();
json_response(200, ['ok' => true]);

