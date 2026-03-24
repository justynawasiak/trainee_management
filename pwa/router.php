<?php
// Router for PHP built-in server: `php -S 0.0.0.0:5173 -t pwa pwa/router.php`
// Emulates the most important .htaccess rewrites used on OVH Perso.

$path = parse_url($_SERVER['REQUEST_URI'] ?? '/', PHP_URL_PATH) ?? '/';

// Block direct access to stored data.
if (strncmp($path, '/data/', 6) === 0) {
  http_response_code(404);
  header('Content-Type: text/plain; charset=utf-8');
  echo "Not Found";
  return true;
}

// Friendly API routes (match deploy .htaccess).
if ($path === '/api/login') {
  require __DIR__ . '/api/login.php';
  return true;
}
if ($path === '/api/me') {
  require __DIR__ . '/api/me.php';
  return true;
}
if ($path === '/api/logout') {
  require __DIR__ . '/api/logout.php';
  return true;
}
if ($path === '/api/sync/push') {
  require __DIR__ . '/api/sync_push.php';
  return true;
}
if ($path === '/api/sync/pull') {
  require __DIR__ . '/api/sync_pull.php';
  return true;
}

// Gate "/" through session (login.html vs index.html).
if ($path === '/' || $path === '/index.html') {
  require __DIR__ . '/gate.php';
  return true;
}

// Serve existing files as-is (CSS/JS/assets).
$full = __DIR__ . $path;
if ($path !== '/' && is_file($full)) {
  return false;
}

// Fallback: for any unknown path, still apply gate.
require __DIR__ . '/gate.php';
return true;

