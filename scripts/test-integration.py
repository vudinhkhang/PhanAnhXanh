"""Run browser and API checks on a new isolated local PostgreSQL database."""

import json
import os
import secrets
import shutil
import socket
import subprocess
import sys
import time
from pathlib import Path
from urllib.parse import urlsplit, urlunsplit
from urllib.request import urlopen

import psycopg
from psycopg import sql

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))


def main():
    from backend.seed import seed

    settings = json.loads(
        (ROOT / ".runtime/local.json").read_text(encoding="utf-8-sig")
    )
    name = "pax_qa_" + secrets.token_hex(6)
    address = urlsplit(settings["database_url"])

    def dsn(db):
        return urlunsplit(address._replace(path="/" + db))

    with socket.socket() as listener:
        listener.bind(("127.0.0.1", 0))
        port = listener.getsockname()[1]
    test_url = f"http://127.0.0.1:{port}"
    log_path = ROOT / ".runtime" / f"integration-{name}.log"
    with psycopg.connect(dsn("postgres"), autocommit=True) as admin:
        admin.execute(sql.SQL("CREATE DATABASE {}").format(sql.Identifier(name)))
        server = None
        try:
            os.environ["DATABASE_URL"] = dsn(name)
            os.environ.pop("DEPLOY_API_KEY", None)
            seed(settings)
            env = {
                **os.environ,
                "TEST_URL": test_url,
                "TEST_ADMIN_EMAIL": settings["admin_email"],
                "TEST_ADMIN_PASSWORD": settings["admin_password"],
            }
            with log_path.open("w", encoding="utf-8") as log:
                server = subprocess.Popen(
                    [
                        sys.executable,
                        "-m",
                        "uvicorn",
                        "backend.main:app",
                        "--host",
                        "127.0.0.1",
                        "--port",
                        str(port),
                    ],
                    cwd=ROOT,
                    stdout=log,
                    stderr=subprocess.STDOUT,
                )
                for _ in range(60):
                    if server.poll() is not None:
                        raise RuntimeError(
                            f"Test server failed to start. See {log_path}"
                        )
                    try:
                        with urlopen(test_url + "/api/session", timeout=1):
                            break
                    except OSError:
                        time.sleep(0.25)
                else:
                    raise RuntimeError("Timed out waiting for test server")
                subprocess.run(
                    [
                        shutil.which("npm.cmd") or "npm",
                        "test",
                        "--",
                        "--output",
                        str(ROOT / ".runtime" / name),
                    ],
                    env=env,
                    cwd=ROOT,
                    check=True,
                )
        finally:
            if server is not None:
                server.terminate()
                server.wait(timeout=15)
            admin.execute(
                sql.SQL("DROP DATABASE {} WITH (FORCE)").format(sql.Identifier(name))
            )


if __name__ == "__main__":
    main()
