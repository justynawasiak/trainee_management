# Trainee Management / Klub

A PHP-authenticated PWA for people, groups, attendance, payments, and statistics. PHP 7.4 or newer is required; plain static hosting is unsupported because it can expose private files and PHP source.

## Local start (WSL / Bash)

```bash
bash ./create-local-user.sh your-username
bash ./serve.sh --port 5173
```

The account tool prompts privately for a password of 12–72 bytes. No default accounts are created. The old two-argument account command remains supported, but the private prompt avoids putting a password in shell history. Both launch scripts run the authenticated PHP server and bind to loopback by default.

Open `http://localhost:5173`. Keep the same host and port to retain access to the same browser database. `--listen-all` is available for trusted development networks; production requires HTTPS.

## Private data and existing installations

Private storage defaults to `private-data/`, beside `pwa/` and outside the public web directory. Set `KLUB_DATA_DIR` to a protected absolute directory if the deployment layout differs. The PHP process needs read/write access there. Runtime files are ignored by Git.

Existing `pwa/data/users.json` and unambiguous legacy synchronization files are copied into private storage when first accessed. Originals are preserved. Accounts now use exact-username hashes for database names and synchronization files. Legacy browser databases are copied once, and migrated data is treated as unsynchronized until acknowledged by the server. Ambiguous legacy accounts require an administrator to assign the correct old data explicitly; it is never automatically shared between accounts.

Previously committed runtime files were removed from the Git index, not deleted from disk. Older Git commits still contain them. Rotate any previously shared passwords and assess whether personal data was shared before arranging repository-history cleanup.

## Checks

```bash
npm test
python3 scripts/test_backend.py
```

The first command uses Node's standard library and checks regression cases and JavaScript syntax. The second requires PHP and starts an isolated server with synthetic accounts and data. It does not read or change real accounts.

Native Chrome/IndexedDB tests use an existing Playwright installation without adding application dependencies:

```bash
PLAYWRIGHT_MODULE=/absolute/path/to/playwright/index.mjs npm run test:browser
```

To include the complete authenticated browser workflow in the isolated PHP tests, also set `KLUB_BROWSER_NODE` to an existing Node executable and `PLAYWRIGHT_MODULE` to that runtime's Playwright entry point before running `scripts/test_backend.py`. Windows Node can be invoked from WSL with an executable path under `/mnt/c/`; test credentials are generated temporarily outside the repository.

See [deployment instructions](deploy/ovh-perso-php-login/README.md) and [application behavior](pwa/README.md).
