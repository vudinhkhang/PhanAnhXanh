import logging

from .classifier import analyze
from .db import connect
from .intake import Assessment, apply_result, assess, notify

log = logging.getLogger(__name__)


def process_next():
    with connect() as conn:
        row = conn.execute("""SELECT id,description,ai_attempts,ai_consent,status,intake_state,
            location,ward,pin_lat,pin_lng FROM reports
            WHERE ai_state='pending' AND ai_next<=now()
            ORDER BY created_at LIMIT 1 FOR UPDATE SKIP LOCKED""").fetchone()
        if not row:
            return False
        pictures = [
            item["data"]
            for item in conn.execute(
                "SELECT data FROM photos WHERE report_id=%s ORDER BY position",
                (row["id"],),
            ).fetchall()
        ]
        if row["intake_state"] == "pending":
            try:
                assessment = assess(row["description"], pictures, row["ai_consent"])
            except Exception:
                log.exception("Cannot screen report %s", row["id"])
                assessment = Assessment("review", reason="analysis_error")
            apply_result(conn, row, assessment)
            return True
        try:
            result = analyze(row["description"], pictures, row["ai_consent"])
        except Exception:
            log.exception("Cannot classify report %s", row["id"])
            state = "failed" if row["ai_attempts"] >= 4 else "pending"
            conn.execute(
                """UPDATE reports SET ai_attempts=ai_attempts+1, ai_state=%s,
                ai_next=now()+interval '30 seconds' WHERE id=%s""",
                (state, row["id"]),
            )
            return True
        conn.execute(
            """UPDATE reports SET ai_group=%s, ai_state='done', urgent=%s,
            ai_summary=%s, ai_source=%s WHERE id=%s""",
            (
                result["group"],
                result["urgent"],
                result["summary"],
                result["source"],
                row["id"],
            ),
        )
        if result["urgent"]:
            notify(conn, row["id"])
        return True


def run(stop):
    while not stop.is_set():
        try:
            if process_next():
                continue
        except Exception:
            log.exception("Database worker unavailable")
        stop.wait(1.5)
