# OVH Perso deployment

## Public files

Upload the contents of `pwa/`, including its `.htaccess`, `api/`, and `data/.htaccess`. Do not upload runtime JSON files, tests, or private storage. Apache 2.4, PHP 7.4+, and `mod_rewrite` are required. Missing rewrite support fails closed instead of serving an unprotected app. Enable HTTPS before use.

## Private storage and accounts

Provide a writable directory outside the public web root. The default is `../private-data` relative to the public directory; set the trusted `KLUB_DATA_DIR` environment variable to a different protected absolute path when needed. Give the PHP account access; do not make the directory public.

No default users or passwords are created. Provision users with the account script from the repository (`./create-local-user.sh username`, which prompts for the password), or deploy an explicitly generated private `users.json`. If the web host requires an administrator-created directory, create it before provisioning. Keep account files private.

Only set `KLUB_TRUST_PROXY=1` when a trusted reverse proxy controls `X-Forwarded-Proto`. Scheme, host, and port are checked for browser POST origins.

## Existing deployment migration

Back up private files and browser data first. Existing public-directory `data/users.json` and `data/sync_<legacy-namespace>.json` files are copied to private storage when accessed; original files are retained. `KLUB_LEGACY_DATA_DIR` can identify a different migration source. Each account gets an exact-username hash and an independent sync file. Legacy namespace collisions are not auto-migrated; an administrator must identify which backup belongs to each account.

Upload the frontend and API changes together, then refresh clients. Old clients without a base revision receive a revision-required response rather than silently overwriting data. Revisions advance for every committed snapshot, including changes within the same second. Conflicts require deliberate reconciliation in Settings; exporting a backup preserves local work.

Rollback requires restoring the matching frontend/API version and backups. New hashed server snapshots and browser databases are separate from retained legacy files. Do not run old and new clients concurrently against writable shared data or copy stale legacy files over the new snapshots.

Files containing historical runtime data were removed from the source index, but prior commits may still contain them. Rotate previously shared credentials and assess repository access before deciding on history cleanup. This update does not change passwords or rewrite Git history automatically.
