import hashlib
import json
import os
import secrets
from pathlib import Path

import psycopg
from psycopg.rows import dict_row

ROOT = Path(__file__).resolve().parents[1]


def connect():
    url = os.getenv("DATABASE_URL")
    if not url:
        settings = ROOT / ".runtime" / "local.json"
        if not settings.exists():
            raise RuntimeError("Set DATABASE_URL or run scripts/start-local.ps1")
        url = json.loads(settings.read_text(encoding="utf-8-sig"))["database_url"]
    return psycopg.connect(url, row_factory=dict_row)


def initialize():
    with connect() as conn:
        conn.execute((ROOT / "backend/schema.sql").read_text(encoding="utf-8"))


def hash_password(password, salt=None):
    salt = salt or secrets.token_hex(16)
    digest = hashlib.scrypt(
        password.encode(),
        salt=bytes.fromhex(salt),
        n=2**15,
        r=8,
        p=1,
        maxmem=64 * 1024 * 1024,
    ).hex()
    return salt + "." + digest


def check_password(password, stored):
    return secrets.compare_digest(stored, hash_password(password, stored.split(".")[0]))
