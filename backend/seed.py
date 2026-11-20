"""Provision local accounts and optionally install the shared demo cases."""
import argparse
import json
from datetime import datetime, timedelta, timezone

from .db import ROOT, connect, hash_password, initialize, save_report_photo

ACCOUNTS = {
    "admin": ("quantri@phananh.local", "Quản trị viên"),
    "staff": ("canbo@phananh.local", "Cán bộ môi trường"),
    "citizen": ("nguoidan@phananh.local", "Người dân"),
}
DEMO_PASSWORD = "Demo1234"
HCM = timezone(timedelta(hours=7))
REPORT_CODES = [
    "PX-261101A4C8E1",
    "PX-261103B7D2F4",
    "PX-261105C9E1A3",
    "PX-261107D4F6B8",
    "PX-261109E2A5C7",
    "PX-261111F8B3D9",
    "PX-261112A6C4E2",
    "PX-261114B1D9F5",
    "PX-261116C3E7A8",
    "PX-261118D5F2B6",
    "PX-261120E9A1C4",
]


def demo_cases():
    return json.loads((ROOT / "src/data.json").read_text(encoding="utf-8"))


def provision(c, settings, *, reset_demo=False):
    accounts = {}
    for role, (default_email, name) in ACCOUNTS.items():
        email = settings.get(role + "_email", default_email)
        password = DEMO_PASSWORD if reset_demo else settings.get(role + "_password")
        if password is None:
            continue
        conflict = (
            "DO UPDATE SET name=EXCLUDED.name, password_hash=EXCLUDED.password_hash, active=true WHERE users.role=EXCLUDED.role"
            if reset_demo else "DO NOTHING"
        )
        c.execute(
            "INSERT INTO users(email,name,password_hash,role) VALUES(%s,%s,%s,%s) ON CONFLICT(email) " + conflict,
            (email, name, hash_password(password), role),
        )
        row = c.execute("SELECT id,role FROM users WHERE email=%s", (email,)).fetchone()
        if row["role"] != role:
            raise ValueError(f"Demo email already belongs to a different role: {role}")
        accounts[role] = row["id"]
    if reset_demo:
        c.execute("DELETE FROM sessions WHERE user_id=ANY(%s)", (list(accounts.values()),))
    return accounts


def install_cases(c, accounts, cases):
    officer = accounts["staff"]
    # Unassigned samples outside these areas remain available for admin assignment.
    areas = sorted({geo["ward"] for i, (_, _, _, _, _, geo, _) in enumerate(cases) if i != 2})
    c.execute("UPDATE users SET areas=%s WHERE id=%s", (areas, officer))
    today = datetime.now(HCM).replace(hour=0, minute=0, second=0, microsecond=0)
    for i, (title, location, group, status, desc, geo, photo) in enumerate(cases):
        code = REPORT_CODES[i] if i < len(REPORT_CODES) else f"PX-261100000{i + 1:03X}"
        offset = round(i * (today.day - 1) / max(1, len(cases) - 1))
        created = today - timedelta(days=today.day - 1 - offset)
        row = c.execute(
            """INSERT INTO reports(id,owner,title,description,location,public,created_at,status,
               ai_group,ai_state,confirmed_group,assignee,sample_photo,pin_lat,pin_lng,ward)
               VALUES(%s,%s,%s,%s,%s,true,%s,%s,%s,'done',%s,%s,NULL,%s,%s,%s)
               ON CONFLICT DO NOTHING RETURNING id""",
            (code, accounts.get("citizen"), title, desc, location, created, status, group,
             group if status != "received" else None, officer if status != "received" else None,
             geo["lat"], geo["lng"], geo["ward"]),
        ).fetchone()
        if not row:
            continue
        photo_src = ROOT / "public" / photo.lstrip("/")
        if photo_src.is_file():
            file_path = save_report_photo(code, 0, photo_src.read_bytes())
            c.execute(
                "INSERT INTO photos(report_id,position,file_path,data) VALUES(%s,0,%s,NULL)",
                (code, file_path),
            )
        for state, note in (
            ("received", "Hệ thống đã tiếp nhận phản ánh của người dân."),
            ("processing", "Cán bộ chuyên trách đang kiểm tra và xử lý tại hiện trường."),
            ("resolved", "Đã hoàn tất xử lý và khắc phục sự cố tại hiện trường."),
        ):
            c.execute(
                "INSERT INTO history(report_id,status,note,author,created_at) VALUES(%s,%s,%s,%s,%s)",
                (code, state, note, officer if state != "received" else None, created),
            )
            if state == status:
                break


def seed(settings, with_samples=True):
    initialize()
    with connect() as c:
        accounts = provision(c, settings)
        if with_samples:
            install_cases(c, accounts, demo_cases())


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--samples", action="store_true")
    args = parser.parse_args()
    seed(json.loads((ROOT / ".runtime/local.json").read_text(encoding="utf-8-sig")), args.samples)
