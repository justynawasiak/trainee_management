<?php
require_once __DIR__ . '/_auth.php';

$u = require_user();
json_response(200, ['ok' => true, 'username' => $u, 'accountId' => account_id($u), 'legacyNamespace' => legacy_namespace_for($u)]);
