<?php
// Router for PHP built-in server: `php -S 0.0.0.0:5173 -t pwa pwa/router.php`
// Emulates the most important .htaccess rewrites used on OVH Perso.

$path = rawurldecode(explode('?', $_SERVER['REQUEST_URI'] ?? '/', 2)[0]);
$segments = explode('/', $path);
if (strpos($path, "\0") !== false || strpos($path, '\\') !== false || in_array('..', $segments, true) || in_array('.', $segments, true)) {
  http_response_code(404);
  return true;
}
$path = '/' . implode('/', array_filter($segments, function ($segment) { return $segment !== ''; }));
$securityPath = strtolower($path);

// Block direct access to stored data.
if ($securityPath === '/data' || strncmp($securityPath, '/data/', 6) === 0 || strncmp($securityPath, '/api/_', 6) === 0) {
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
  if (substr($path, -3) === '.js') header('Cache-Control: no-cache');
  return false;
}

// Fallback: for any unknown path, still apply gate.
require __DIR__ . '/gate.php';
return true;
