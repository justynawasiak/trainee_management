"""Exercise PHP authentication and persistence using isolated synthetic storage."""
import concurrent.futures
import hashlib
import http.cookiejar
import json
import os
from pathlib import Path
import secrets
import shutil
import signal
import socket
import subprocess
import tempfile
import time
import urllib.error
import urllib.request

ROOT = Path(__file__).resolve().parents[1]
PHP = shutil.which("php")
if not PHP:
    raise SystemExit("PHP is required; run this test in WSL if needed.")


def client():
    return urllib.request.build_opener(urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))


def request(opener, base, path, body=None, headers=None):
    encoded = json.dumps(body).encode() if body is not None else None
    outgoing = urllib.request.Request(base + path, data=encoded, headers=headers or {})
    if encoded is not None:
        outgoing.add_header("Content-Type", "application/json")
    try:
        response = opener.open(outgoing, timeout=10)
    except urllib.error.HTTPError as error:
        response = error
    with response:
        return response.status, response.read()


def payload():
    return {"version": 1, "data": {
        "trainees": [{"id": "person", "firstName": "Synthetic", "lastName": "Person"}],
        "groups": [{"id": "group", "name": "Synthetic", "schedule": []}],
        "memberships": [], "attendance": [], "payments": [],
        "settings": [{"key": "pricing", "currency": "PLN", "feeBySessionsPerWeek": {"1": 120}}],
        "scopes": [], "sessionScopes": []
    }}


with tempfile.TemporaryDirectory(prefix="klub-backend-test-") as temporary:
    storage = Path(temporary) / "private"
    legacy = Path(temporary) / "legacy"
    storage.mkdir(mode=0o700)
    legacy.mkdir(mode=0o700)
    password = secrets.token_urlsafe(24)
    password_hash = subprocess.check_output(
        [PHP, "-r", "echo password_hash(stream_get_contents(STDIN), PASSWORD_BCRYPT);"], input=password.encode()
    ).decode()
    users = [{"username": username, "passwordHash": password_hash} for username in ["A-B", "A_B", "Legacy", "WriteFailure", "Browser"]]
    (legacy / "users.json").write_text(json.dumps({"version": 1, "users": users}))
    (legacy / "sync_legacy.json").write_text(json.dumps({"updatedAt": 42, "payload": payload()}))
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        port = sock.getsockname()[1]
    base = "http://127.0.0.1:" + str(port)
    environment = {**os.environ, "KLUB_DATA_DIR": str(storage), "KLUB_LEGACY_DATA_DIR": str(legacy), "PHP_CLI_SERVER_WORKERS": "4"}
    log = tempfile.TemporaryFile()
    process = subprocess.Popen(
        [PHP, "-d", "display_errors=0", "-S", "127.0.0.1:" + str(port), "-t", str(ROOT / "pwa"), str(ROOT / "pwa/router.php")],
        env=environment, stdout=log, stderr=log, start_new_session=os.name != "nt"
    )
    try:
        anonymous = client()
        for attempt in range(100):
            try:
                request(anonymous, base, "/api/me")
                break
            except urllib.error.URLError:
                time.sleep(0.05)
        else:
            raise AssertionError("PHP test server did not start")
        for path in ["/data/users.json", "/DATA/users.json", "/%64ata/users.json", "//data/users.json", "/api/_auth.php", "/api/_payload.php"]:
            status, content = request(anonymous, base, path)
            assert status in [403, 404], (path, status)
        assert request(anonymous, base, "/api/sync/pull")[0] == 401
        assert request(anonymous, base, "/api/logout")[0] == 405
        assert request(anonymous, base, "/api/login", {"username": [], "password": password})[0] == 400
        assert request(anonymous, base, "/api/login", {"username": "Legacy", "password": password}, {"Origin": "http://127.0.0.1:1"})[0] == 403
        print("PASS: private routes, authentication, method and origin validation")

        accounts = {}
        for username in ["A-B", "A_B", "Legacy", "WriteFailure"]:
            opener = client()
            assert request(opener, base, "/api/login", {"username": username, "password": password})[0] == 200
            identity = json.loads(request(opener, base, "/api/me")[1])
            assert identity["accountId"] == hashlib.sha256(username.encode()).hexdigest()
            if username in ["A-B", "A_B"]:
                assert identity["legacyNamespace"] is None
            accounts[username] = opener
        assert (storage / "users.json").is_file()
        assert (legacy / "users.json").is_file()
        status, content = request(accounts["Legacy"], base, "/api/sync/pull")
        result = json.loads(content)
        assert status == 200 and result["revision"] == 42
        assert (storage / ("sync_" + hashlib.sha256(b"Legacy").hexdigest() + ".json")).is_file()
        print("PASS: account isolation and non-destructive private-storage migration")

        opener = accounts["A-B"]
        assert request(opener, base, "/api/sync/push", payload())[0] == 428
        incomplete = {"version": 1, "data": {"trainees": []}, "baseRevision": 0}
        assert request(opener, base, "/api/sync/push", incomplete)[0] == 400
        outgoing = {**payload(), "baseRevision": 0}
        first = request(opener, base, "/api/sync/push", outgoing)
        assert first[0] == 200, first[1].decode()
        assert json.loads(first[1])["revision"] == 1
        assert request(opener, base, "/api/sync/push", outgoing)[0] == 409
        outgoing["baseRevision"] = 1
        second = request(opener, base, "/api/sync/push", outgoing)
        assert second[0] == 200 and json.loads(second[1])["revision"] == 2
        assert json.loads(request(accounts["A_B"], base, "/api/sync/pull")[1])["exists"] is False
        snapshot = json.loads(request(opener, base, "/api/sync/pull")[1])
        assert snapshot["revision"] == 2
        print("PASS: complete schemas, conditional writes, monotonic revisions, isolated snapshots")

        # Separate cookies reproduce writes from different device sessions.
        another = client()
        assert request(another, base, "/api/login", {"username": "A-B", "password": password})[0] == 200
        outgoing["baseRevision"] = 2
        with concurrent.futures.ThreadPoolExecutor(max_workers=2) as executor:
            futures = [executor.submit(request, device, base, "/api/sync/push", outgoing) for device in [opener, another]]
            statuses = sorted(future.result()[0] for future in futures)
        assert statuses == [200, 409], statuses

        destination = storage / ("sync_" + hashlib.sha256(b"WriteFailure").hexdigest() + ".json")
        destination.mkdir()
        assert request(accounts["WriteFailure"], base, "/api/sync/push", {**payload(), "baseRevision": 0})[0] == 500
        assert not list(storage.glob(".sync-*"))
        assert request(opener, base, "/api/logout", {})[0] == 200
        assert request(opener, base, "/api/me")[0] == 401
        print("PASS: concurrent devices, rename failure acknowledgement, temporary-file cleanup, logout")
        browser_node = os.environ.get("KLUB_BROWSER_NODE")
        if browser_node:
            credentials = storage / "browser-test.json"
            credentials.write_text(json.dumps({"base": base, "username": "Browser", "password": password}))
            credentials.chmod(0o600)
            script = str(ROOT / "scripts/test_full_app.mjs")
            credential_path = str(credentials)
            if browser_node.endswith(".exe"):
                script = subprocess.check_output(["wslpath", "-w", script], text=True).strip()
                credential_path = subprocess.check_output(["wslpath", "-w", credential_path], text=True).strip()
            subprocess.run([browser_node, script, credential_path, os.environ.get("PLAYWRIGHT_MODULE", "")], check=True, timeout=90)
    finally:
        if os.name == "nt":
            process.terminate()
        else:
            os.killpg(process.pid, signal.SIGTERM)
        process.wait(timeout=10)
        log.close()
