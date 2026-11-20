import hashlib
import json
import os
import secrets
from pathlib import Path

import psycopg
from psycopg.rows import dict_row

ROOT = Path(__file__).resolve().parents[1]
UPLOADS_DIR = ROOT / ".runtime" / "uploads"


def _safe_upload_path(*parts: str) -> Path | None:
    """Resolve an upload path and guarantee it remains inside UPLOADS_DIR."""
    if any(not part or "/" in part or "\\" in part or ".." in part for part in parts):
        return None
    base = UPLOADS_DIR.resolve()
    target = UPLOADS_DIR.joinpath(*parts).resolve()
    return target if target.is_relative_to(base) else None


def _write_upload(path: Path, data: bytes) -> None:
    """Persist binary image bytes to disk under UPLOADS_DIR."""
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(data)


def _read_upload(path: Path | None) -> bytes | None:
    """Read image bytes from disk if the resolved path exists inside UPLOADS_DIR."""
    return path.read_bytes() if path and path.is_file() else None


def save_report_photo(report_id: str, position: int, data: bytes) -> str:
    """Save report photo WebP bytes to .runtime/uploads and return relative POSIX path."""
    target = _safe_upload_path("reports", report_id, f"{position}.webp")
    if target is None:
        raise ValueError("Invalid report photo upload path.")
    _write_upload(target, data)
    return f".runtime/uploads/reports/{report_id}/{position}.webp"


def load_photo_bytes(item: dict | None) -> bytes | None:
    """Load report photo bytes from disk path, falling back to legacy BYTEA column."""
    if not item:
        return None
    file_path = item.get("file_path")
    if file_path:
        base = UPLOADS_DIR.resolve()
        candidate = (ROOT / file_path).resolve()
        if candidate.is_relative_to(base):
            disk_bytes = _read_upload(candidate)
            if disk_bytes is not None:
                return disk_bytes
    legacy = item.get("data")
    return bytes(legacy) if legacy is not None else None


def load_report_photos(conn, report_id: str) -> list[bytes]:
    """Return ordered list of report image bytes for AI analysis/worker."""
    rows = conn.execute(
        "SELECT file_path, data FROM photos WHERE report_id=%s ORDER BY position",
        (report_id,),
    ).fetchall()
    return [blob for row in rows if (blob := load_photo_bytes(row)) is not None]


def save_history_photo(report_id: str, history_id: int, position: int, data: bytes) -> str:
    """Save evidence photo WebP bytes to .runtime/uploads and return protected API URL."""
    filename = f"history-{history_id}-{position}.webp"
    target = _safe_upload_path("reports", report_id, filename)
    if target is None:
        raise ValueError("Invalid history photo upload path.")
    _write_upload(target, data)
    return f"/api/reports/{report_id}/history/{history_id}/photos/{position}"


def load_history_photo_bytes(report_id: str, history_id: int, position: int) -> bytes | None:
    """Load evidence photo bytes from .runtime/uploads for a given history entry."""
    filename = f"history-{history_id}-{position}.webp"
    return _read_upload(_safe_upload_path("reports", report_id, filename))


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
