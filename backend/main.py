import base64
import hashlib
import json
import os
import secrets
from contextlib import asynccontextmanager
from io import BytesIO
from threading import Event, Thread

from fastapi import Cookie, Depends, FastAPI, HTTPException, Request, Response
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles
from PIL import Image, ImageOps, UnidentifiedImageError
from psycopg.errors import UniqueViolation
from psycopg.types.json import Jsonb

from . import admin_ai, classifier, intake, news
from .db import ROOT, check_password, connect, hash_password, initialize
from .gis import boundaries, ward_at
from .intake import notify
from .models import (
    Account,
    AdminUserCreate,
    AdminUserPatch,
    Assignment,
    BulkAssignment,
    IntakeReview,
    LocalUpdate,
    LocalUpdatePublication,
    Login,
    NewsEditorial,
    PhotoAnalysisRequest,
    ProfilePatch,
    Reopen,
    StaffCreate,
    StaffPatch,
    Submission,
    Update,
)
from .worker import run


@asynccontextmanager
async def lifespan(app):
    initialize()
    stop = Event()
    worker = Thread(target=run, args=(stop,), daemon=True)
    worker.start()
    if os.getenv("NEWS_FEEDS_ENABLED", "1") == "1":
        Thread(target=news.run, args=(stop,), name="environment-news", daemon=True).start()
    yield
    stop.set()
    worker.join(timeout=10)


app = FastAPI(title="Phản Ánh Xanh", lifespan=lifespan)


@app.exception_handler(RequestValidationError)
async def validation_error(request, exc):
    if request.url.path.startswith("/api/admin/news"):
        error = exc.errors()[0]
        message = error["msg"].removeprefix("Value error, ") if error["type"] == "value_error" else "Kiểm tra tiêu đề và thông tin bài viết."
        return JSONResponse(status_code=422, content={"detail": message})
    return JSONResponse(
        status_code=422,
        content={
            "detail": "Thông tin chưa hợp lệ. Kiểm tra các trường và tối đa 3 ảnh."
        },
    )


def db():
    with connect() as conn:
        yield conn


def digest(value):
    return hashlib.sha256(value.encode()).hexdigest()


def session(pax_session: str | None = Cookie(default=None), conn=Depends(db)):
    if not pax_session:
        return None
    return conn.execute(
        """SELECT u.id,u.name,u.email,u.role,u.active,u.areas FROM users u JOIN sessions s
        ON s.user_id=u.id WHERE s.token=%s AND s.expires_at>now() AND u.active""",
        (digest(pax_session),),
    ).fetchone()


def require(user, *roles):
    if not user:
        raise HTTPException(401, "Vui lòng đăng nhập để xem hồ sơ.")
    if roles and user["role"] not in roles:
        raise HTTPException(403, "Tài khoản chưa có quyền thực hiện thao tác này.")


def clean_areas(areas):
    known = set(boundaries()[0])
    result = []
    for area in areas or []:
        if area not in known:
            raise HTTPException(422, "Khu vực không thuộc TP. Hồ Chí Minh: " + area)
        if area not in result:
            result.append(area)
    return result


def staff_scope(user, row):
    """Staff may see cases assigned to them or located in their areas."""
    return bool(
        user["id"] == row.get("assignee") or row.get("ward") in (user.get("areas") or [])
    )


def staff_can_handle(user, row):
    """Staff may handle cases assigned to them, or unassigned cases in their areas."""
    if row.get("assignee") == user["id"]:
        return True
    return row.get("assignee") is None and row.get("ward") in (user.get("areas") or [])


def create_user(conn, data, role):
    areas = clean_areas(getattr(data, "areas", [])) if role == "staff" else []
    try:
        return conn.execute(
            """INSERT INTO users(name,email,password_hash,role,areas) VALUES(%s,%s,%s,%s,%s)
            RETURNING id,name,email,role,active,areas""",
            (data.name, data.email, hash_password(data.password), role, areas),
        ).fetchone()
    except UniqueViolation:
        raise HTTPException(409, "Email đã được sử dụng.")


def sign_in(conn, user, response, *, remember=False):
    token = secrets.token_urlsafe(32)
    conn.execute("DELETE FROM sessions WHERE expires_at<=now()")
    conn.execute(
        "INSERT INTO sessions(token,user_id,expires_at) VALUES(%s,%s,now()+make_interval(days => %s))",
        (digest(token), user["id"], 30 if remember else 1),
    )
    response.set_cookie(
        "pax_session",
        token,
        max_age=2592000 if remember else None,
        httponly=True,
        samesite="lax",
        secure=os.getenv("COOKIE_SECURE") == "1",
        path="/",
    )
    return user


@app.get("/api/session")
def current_user(user=Depends(session)):
    return user


@app.post("/api/register", status_code=201)
def register(data: Account, response: Response, conn=Depends(db)):
    return sign_in(
        conn, create_user(conn, data, "citizen"), response, remember=data.remember
    )


@app.post("/api/login")
def login(data: Login, response: Response, conn=Depends(db)):
    user = conn.execute(
        "SELECT id,name,email,role,active,areas,password_hash FROM users WHERE email=%s AND active",
        (data.email,),
    ).fetchone()
    if not user or not check_password(data.password, user.pop("password_hash")):
        raise HTTPException(401, "Email hoặc mật khẩu chưa đúng.")
    return sign_in(conn, user, response, remember=data.remember)


@app.post("/api/logout")
def logout(
    response: Response, pax_session: str | None = Cookie(default=None), conn=Depends(db)
):
    if pax_session:
        conn.execute("DELETE FROM sessions WHERE token=%s", (digest(pax_session),))
    response.delete_cookie("pax_session", path="/")
    return {"ok": True}


@app.patch("/api/profile")
def update_profile(data: ProfilePatch, user=Depends(session), conn=Depends(db)):
    require(user)
    new_name = data.name if data.name is not None else user["name"]
    if data.password is not None:
        conn.execute(
            "UPDATE users SET name=%s,password_hash=%s WHERE id=%s",
            (new_name, hash_password(data.password), user["id"]),
        )
    else:
        conn.execute(
            "UPDATE users SET name=%s WHERE id=%s",
            (new_name, user["id"]),
        )
    return conn.execute(
        "SELECT id,name,email,role,active,areas FROM users WHERE id=%s",
        (user["id"],),
    ).fetchone()


@app.get("/api/staff")
def staff(user=Depends(session), conn=Depends(db)):
    require(user, "admin", "staff")
    return conn.execute(
        "SELECT id,name,email,role,active,areas FROM users WHERE role='staff' ORDER BY name"
    ).fetchall()


@app.post("/api/staff", status_code=201)
def add_staff(data: StaffCreate, user=Depends(session), conn=Depends(db)):
    require(user, "admin")
    return create_user(conn, data, "staff")


@app.patch("/api/staff/{uid}")
def staff_active(uid: int, data: StaffPatch, user=Depends(session), conn=Depends(db)):
    require(user, "admin")
    if data.active is None and data.areas is None:
        raise HTTPException(422, "Không có thay đổi nào được gửi.")
    areas = clean_areas(data.areas) if data.areas is not None else None
    target = conn.execute(
        "SELECT active,areas FROM users WHERE id=%s AND role='staff' FOR UPDATE",
        (uid,),
    ).fetchone()
    if not target:
        raise HTTPException(404, "Không tìm thấy cán bộ.")
    active = target["active"] if data.active is None else data.active
    conn.execute(
        "UPDATE users SET active=%s,areas=%s WHERE id=%s",
        (active, target["areas"] if areas is None else areas, uid),
    )
    if not active:
        conn.execute("DELETE FROM sessions WHERE user_id=%s", (uid,))
    return {"ok": True}


USER_SELECT = """SELECT u.id, u.name, u.email, u.role, u.active, u.areas,
    (SELECT count(*) FROM reports r WHERE r.owner=u.id) AS submitted_count,
    (SELECT count(*) FROM reports r WHERE r.owner=u.id AND r.status='rejected') AS rejected_count,
    (SELECT count(*) FROM reports r WHERE r.assignee=u.id AND r.status NOT IN ('resolved','rejected','cancelled')) AS assigned_open_count,
    (SELECT count(*) FROM reports r WHERE r.assignee=u.id AND r.status='resolved') AS assigned_resolved_count
    FROM users u"""


@app.get("/api/admin/users")
def admin_users(user=Depends(session), conn=Depends(db)):
    require(user, "admin")
    return conn.execute(
        USER_SELECT
        + " ORDER BY CASE u.role WHEN 'admin' THEN 1 WHEN 'staff' THEN 2 ELSE 3 END, u.id"
    ).fetchall()


@app.post("/api/admin/users", status_code=201)
def admin_create_user(data: AdminUserCreate, user=Depends(session), conn=Depends(db)):
    require(user, "admin")
    created = create_user(conn, data, data.role)
    return conn.execute(USER_SELECT + " WHERE u.id=%s", (created["id"],)).fetchone()


@app.patch("/api/admin/users/{uid}")
def admin_patch_user(
    uid: int, data: AdminUserPatch, user=Depends(session), conn=Depends(db)
):
    require(user, "admin")
    if uid == user["id"] and (
        data.active is False or (data.role is not None and data.role != "admin")
    ):
        raise HTTPException(
            400, "Không thể tự khóa hoặc hạ quyền tài khoản quản trị đang đăng nhập."
        )
    target = conn.execute(
        "SELECT id,name,role,active,areas FROM users WHERE id=%s", (uid,)
    ).fetchone()
    if not target:
        raise HTTPException(404, "Không tìm thấy người dùng.")
    new_name = data.name if data.name is not None else target["name"]
    new_role = data.role if data.role is not None else target["role"]
    new_active = data.active if data.active is not None else target["active"]
    new_areas = (
        clean_areas(data.areas) if data.areas is not None else target["areas"]
    )
    if new_role != "staff":
        new_areas = []
    if data.password is not None:
        conn.execute(
            "UPDATE users SET name=%s,role=%s,active=%s,areas=%s,password_hash=%s WHERE id=%s",
            (
                new_name,
                new_role,
                new_active,
                new_areas,
                hash_password(data.password),
                uid,
            ),
        )
    else:
        conn.execute(
            "UPDATE users SET name=%s,role=%s,active=%s,areas=%s WHERE id=%s",
            (new_name, new_role, new_active, new_areas, uid),
        )
    if data.active is False:
        conn.execute("DELETE FROM sessions WHERE user_id=%s", (uid,))
    if new_role == "citizen":
        conn.execute(
            "UPDATE reports SET assignee=NULL WHERE assignee=%s AND status NOT IN ('resolved','rejected','cancelled')",
            (uid,),
        )
    return conn.execute(USER_SELECT + " WHERE u.id=%s", (uid,)).fetchone()


FIELDS = """r.id,r.title,r.description,r.location,r.public,r.created_at,r.status,r.ai_group,
    r.ai_state,r.intake_state,r.intake_reason,r.confirmed_group,r.urgent,r.priority,r.assignee,
    r.sample_photo,r.pin_lat,r.pin_lng,r.ward,
    ARRAY(SELECT position FROM photos p WHERE p.report_id=r.id ORDER BY position) AS positions"""
PUBLIC_REPORTS = (
    "r.public AND r.intake_state='passed' AND r.status NOT IN ('rejected','cancelled')"
)
LOCAL_TODAY = "(now() AT TIME ZONE 'Asia/Ho_Chi_Minh')::date"


def serialize(row, *, precise=False):
    lat, lng = row.pop("pin_lat"), row.pop("pin_lng")
    row["pin"] = None
    if lat is not None and lng is not None:
        if not precise:
            lat, lng = round(lat, 2), round(lng, 2)
            row["location"] = row["ward"] or "Khu vực phản ánh"
        row["pin"] = {"lat": lat, "lng": lng, "approximate": not precise}
    positions = row.pop("positions")
    sample = row.pop("sample_photo")
    row["photos"] = (
        [sample]
        if sample
        else [f"/api/reports/{row['id']}/photos/{n}" for n in positions]
    )
    return row


@app.get("/api/community")
def community(conn=Depends(db)):
    rows = conn.execute(
        f"""SELECT {FIELDS}, CASE WHEN r.status='resolved' THEN
            (SELECT max(created_at) FROM history WHERE report_id=r.id AND status='resolved')
            END AS resolved_at
            FROM reports r WHERE {PUBLIC_REPORTS} ORDER BY created_at DESC"""
    ).fetchall()
    counts = conn.execute("""SELECT count(*) AS total,
        count(*) FILTER (WHERE status='received') AS received,
        count(*) FILTER (WHERE status='processing') AS processing,
        count(*) FILTER (WHERE status='resolved') AS resolved FROM reports
        WHERE intake_state='passed' AND status NOT IN ('rejected','cancelled')""").fetchone()
    return {"reports": [serialize(row) for row in rows], "counts": counts}


@app.get("/api/community/home")
def community_home(conn=Depends(db)):
    days = conn.execute(f"""WITH calendar AS (SELECT {LOCAL_TODAY} AS today),
        totals AS (
          SELECT (r.created_at AT TIME ZONE 'Asia/Ho_Chi_Minh')::date AS day, count(*) AS count
          FROM reports r CROSS JOIN calendar
          WHERE {PUBLIC_REPORTS} AND (r.owner IS NOT NULL OR r.guest_receipt IS NOT NULL)
            AND r.created_at >= ((today-29)::timestamp AT TIME ZONE 'Asia/Ho_Chi_Minh')
            AND r.created_at < ((today+1)::timestamp AT TIME ZONE 'Asia/Ho_Chi_Minh')
          GROUP BY 1
        )
        SELECT today-offset_days AS day, COALESCE(count,0) AS count
        FROM calendar CROSS JOIN generate_series(0,29) AS offsets(offset_days)
        LEFT JOIN totals ON totals.day = today-offset_days
        ORDER BY day""").fetchall()
    return {"daily_counts": days, "local_updates": []}


@app.get("/api/community/news")
def community_news(conn=Depends(db)):
    editorial = conn.execute("""SELECT slug,title,summary,category,area,source_name,source_url,image,published_at
        FROM news_articles WHERE published ORDER BY published_at DESC, slug""").fetchall()
    retired = conn.execute("""SELECT slug FROM news_articles
        WHERE NOT published AND published_at IS NOT NULL AND slug = ANY(%s)""", (list(CURATED_NEWS),)).fetchall()
    return {"articles": news.articles(), "editorial": editorial, "retired": [row["slug"] for row in retired]}


CURATED_NEWS = {
    "camera-chong-do-trom-rac-tphcm",
    "lo-trinh-xu-ly-nuoc-thai-tphcm",
    "thu-gom-chat-thai-tang-nhon-phu",
    "khu-dan-cu-bao-ve-moi-truong",
}


@app.get("/api/community/news/{slug}")
def community_news_article(slug: str, conn=Depends(db)):
    row = conn.execute(
        "SELECT slug,content FROM news_articles WHERE slug=%s AND published", (slug,)
    ).fetchone()
    if not row:
        raise HTTPException(404, "Bài viết hiện không có trong bản tin.")
    return row


@app.get("/api/admin/news")
def list_editorial_news(user=Depends(session), conn=Depends(db)):
    require(user, "admin")
    return conn.execute("SELECT * FROM news_articles ORDER BY updated_at DESC").fetchall()


def editorial_values(data):
    return (
        data.title, data.summary, data.category, data.area, data.source_name,
        data.source_url, data.image, Jsonb(data.content.model_dump(exclude_none=True)),
        data.published, data.published,
    )


@app.post("/api/admin/news", status_code=201)
def create_editorial_news(data: NewsEditorial, user=Depends(session), conn=Depends(db)):
    require(user, "admin")
    if data.replaces and data.replaces not in CURATED_NEWS:
        raise HTTPException(422, "Không tìm thấy bài mẫu để thay thế.")
    slug = data.replaces or "tin-" + secrets.token_hex(8)
    try:
        return conn.execute("""INSERT INTO news_articles
            (slug,title,summary,category,area,source_name,source_url,image,content,published,published_at)
            VALUES(%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,CASE WHEN %s THEN now() END) RETURNING *""",
            (slug, *editorial_values(data)),
        ).fetchone()
    except UniqueViolation:
        raise HTTPException(409, "Bài viết đã có trong danh sách. Tải lại để mở phiên bản mới nhất.")


@app.put("/api/admin/news/{slug}")
def edit_editorial_news(slug: str, data: NewsEditorial, user=Depends(session), conn=Depends(db)):
    require(user, "admin")
    row = conn.execute("""UPDATE news_articles SET title=%s,summary=%s,category=%s,area=%s,
        source_name=%s,source_url=%s,image=%s,content=%s,published=%s,
        published_at=CASE WHEN %s AND NOT published THEN now() ELSE published_at END,
        updated_at=now() WHERE slug=%s RETURNING *""", (*editorial_values(data), slug)).fetchone()
    if not row:
        raise HTTPException(404, "Không tìm thấy bài viết.")
    return row


@app.patch("/api/admin/news/{slug}/publication")
def publish_editorial_news(slug: str, data: LocalUpdatePublication, user=Depends(session), conn=Depends(db)):
    require(user, "admin")
    row = conn.execute("""UPDATE news_articles SET published=%s,
        published_at=CASE WHEN %s AND NOT published THEN now() ELSE published_at END,
        updated_at=now() WHERE slug=%s RETURNING *""", (data.published, data.published, slug)).fetchone()
    if not row:
        raise HTTPException(404, "Không tìm thấy bài viết.")
    return row


def local_update_values(data):
    if data.ends_on < data.starts_on:
        raise HTTPException(422, "Ngày kết thúc phải từ ngày bắt đầu trở đi.")
    if (
        data.source_url.scheme != "https"
        or data.source_url.username is not None
        or data.source_url.password is not None
    ):
        raise HTTPException(422, "Dùng đường dẫn HTTPS tới nguồn thông tin.")
    if data.ward:
        clean_areas([data.ward])
    return (
        data.title,
        data.summary,
        data.ward or None,
        str(data.source_url),
        data.starts_on,
        data.ends_on,
    )


@app.get("/api/admin/local-updates")
def list_local_updates(user=Depends(session), conn=Depends(db)):
    require(user, "admin")
    return conn.execute(
        "SELECT * FROM local_updates ORDER BY starts_on DESC,id DESC"
    ).fetchall()


@app.post("/api/admin/local-updates", status_code=201)
def create_local_update(data: LocalUpdate, user=Depends(session), conn=Depends(db)):
    require(user, "admin")
    return conn.execute(
        """INSERT INTO local_updates(title,summary,ward,source_url,starts_on,ends_on)
           VALUES(%s,%s,%s,%s,%s,%s) RETURNING *""",
        local_update_values(data),
    ).fetchone()


@app.put("/api/admin/local-updates/{update_id}")
def edit_local_update(
    update_id: int, data: LocalUpdate, user=Depends(session), conn=Depends(db)
):
    require(user, "admin")
    row = conn.execute(
        """UPDATE local_updates SET title=%s,summary=%s,ward=%s,source_url=%s,starts_on=%s,ends_on=%s
           WHERE id=%s RETURNING *""",
        (*local_update_values(data), update_id),
    ).fetchone()
    if not row:
        raise HTTPException(404, "Không tìm thấy thông tin địa phương.")
    return row


@app.patch("/api/admin/local-updates/{update_id}/publication")
def publish_local_update(
    update_id: int,
    data: LocalUpdatePublication,
    user=Depends(session),
    conn=Depends(db),
):
    require(user, "admin")
    row = conn.execute(
        "UPDATE local_updates SET published=%s WHERE id=%s RETURNING *",
        (data.published, update_id),
    ).fetchone()
    if not row:
        raise HTTPException(404, "Không tìm thấy thông tin địa phương.")
    return row


@app.get("/api/reports")
def reports(user=Depends(session), conn=Depends(db)):
    require(user)
    citizen = user["role"] == "citizen"
    staff_user = user["role"] == "staff"
    cols = FIELDS + ("" if citizen else ",r.ai_source,r.ai_summary")
    query = (
        "SELECT "
        + cols
        + " FROM reports r"
        + (
            " WHERE owner=%s"
            if citizen
            else " WHERE (r.assignee=%s OR r.ward=ANY(%s))" if staff_user else ""
        )
        + " ORDER BY created_at DESC"
    )
    params = (
        (user["id"],)
        if citizen
        else (user["id"], user["areas"] or []) if staff_user else ()
    )
    return [
        serialize(row, precise=True) for row in conn.execute(query, params).fetchall()
    ]


def validate_photo(value):
    try:
        prefix, encoded = value.split(",", 1)
        if prefix not in (
            "data:image/webp;base64",
            "data:image/jpeg;base64",
            "data:image/png;base64",
        ):
            raise ValueError()
        binary = base64.b64decode(encoded, validate=True)
        with Image.open(BytesIO(binary)) as img:
            if (
                img.format not in ("WEBP", "PNG", "JPEG")
                or img.width * img.height > 16_000_000
            ):
                raise ValueError()
            photo = ImageOps.exif_transpose(img).convert("RGB")
            photo.thumbnail((1440, 1440))
            output = BytesIO()
            photo.save(output, format="WEBP", quality=83)
            return output.getvalue()
    except (ValueError, OSError, Image.DecompressionBombError, UnidentifiedImageError):
        raise HTTPException(422, "Ảnh không hợp lệ hoặc vượt giới hạn kích thước.")


def _goong_key() -> str:
    key = (os.getenv("GOONG_API_KEY") or "").strip()
    if key:
        return key
    try:
        cfg = json.loads((ROOT / ".runtime/local.json").read_text(encoding="utf-8-sig"))
        return str(cfg.get("goong_api_key") or "").strip()
    except Exception:
        return ""


def _goong_map_key() -> str:
    key = (os.getenv("GOONG_MAP_KEY") or "").strip()
    if key:
        return key
    try:
        cfg = json.loads((ROOT / ".runtime/local.json").read_text(encoding="utf-8-sig"))
        val = str(cfg.get("goong_map_key") or "").strip()
        if val:
            return val
    except Exception:
        pass
    return "8K7ueiGj67N8nImjImdepvpxcImsPUqfsmhE1fNk"


@app.get("/api/geocode/config")
def geocode_config():
    return {
        "goong_api_key": _goong_key(),
        "goong_map_key": _goong_map_key(),
    }


@app.get("/api/geocode/reverse")
def reverse_geocode(lat: float, lng: float):
    if not (-90 <= lat <= 90 and -180 <= lng <= 180):
        raise HTTPException(422, "Tọa độ không hợp lệ.")
    ward = ward_at(lat, lng)
    return {"ward": ward, "in_hcm": bool(ward)}


def enforce_submission_quota(conn, request, user):
    source = (f"account:{user['id']}" if user else
              "guest:" + digest(request.client.host if request.client else "unknown"))
    maximum = 15 if user else 8
    conn.execute("DELETE FROM submission_quota WHERE expires_at<=now()")
    accepted = conn.execute(
        """INSERT INTO submission_quota (source,attempts,expires_at)
           VALUES (%s,1,now()+interval '15 minutes')
           ON CONFLICT (source) DO UPDATE SET attempts=submission_quota.attempts+1
           WHERE submission_quota.attempts<%s RETURNING attempts""",
        (source, maximum),
    ).fetchone()
    if not accepted:
        raise HTTPException(429, "Bạn đã gửi quá nhiều lần. Vui lòng thử lại sau ít phút.")
    conn.commit()


@app.post("/api/reports/analyze-photos")
def analyze_photos(data: PhotoAnalysisRequest):
    pictures = [validate_photo(photo) for photo in data.photos]
    return classifier.analyze_photos_preview(pictures)


@app.post("/api/reports", status_code=201)
def submit(data: Submission, request: Request, response: Response, user=Depends(session), conn=Depends(db)):
    enforce_submission_quota(conn, request, user)
    pictures = [validate_photo(photo) for photo in data.photos]
    code = "PX-" + secrets.token_hex(6).upper()
    receipt = None if user else secrets.token_urlsafe(32)
    title = data.description.splitlines()[0][:95].strip()
    pin = data.pin
    ward = ward_at(pin.lat, pin.lng) if pin else None
    if pin and not ward:
        raise HTTPException(
            422,
            "Hiện hệ thống chỉ tiếp nhận vị trí ghim trong phạm vi TP. Hồ Chí Minh.",
        )
    conn.execute(
        """INSERT INTO reports(id,owner,guest_receipt,title,description,location,public,pin_lat,pin_lng,ward,ai_consent,intake_state)
        VALUES(%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,'pending')""",
        (
            code,
            user["id"] if user else None,
            digest(receipt) if receipt else None,
            title,
            data.description,
            data.location,
            data.public,
            pin.lat if pin else None,
            pin.lng if pin else None,
            ward,
            data.ai_consent and bool(pictures),
        ),
    )
    for position, binary in enumerate(pictures):
        conn.execute(
            "INSERT INTO photos(report_id,position,data) VALUES(%s,%s,%s)",
            (code, position, binary),
        )
    conn.commit()
    if receipt:
        response.set_cookie(
            "pax_receipt", receipt, path=f"/api/reports/{code}", max_age=180 * 86400,
            httponly=True, samesite="lax",
            secure=request.url.scheme == "https" or os.getenv("COOKIE_SECURE") == "1",
        )
    return {"id": code, "status": "received", "intake_state": "pending"}


def can_manage_case(row, user):
    if not user:
        return False
    if user["role"] == "admin":
        return True
    if user["role"] == "staff":
        return staff_scope(user, row)
    return False


def owns_case(row, user, receipt=None):
    if user and user["id"] == row["owner"]:
        return True
    stored = row.get("guest_receipt")
    return bool(stored and receipt and secrets.compare_digest(stored, digest(receipt)))


def can_view_case(row, user, receipt=None):
    return bool(
        row
        and (
            (
                row["public"]
                and row["intake_state"] == "passed"
                and row["status"] not in ("rejected", "cancelled")
            )
            or can_manage_case(row, user)
            or owns_case(row, user, receipt)
        )
    )


def authorize_case(conn, code, user, lock=False, *, receipt=None):
    row = conn.execute(
        "SELECT owner,guest_receipt,public,status,assignee,intake_state,ward FROM reports WHERE id=%s"
        + (" FOR UPDATE" if lock else ""),
        (code,),
    ).fetchone()
    if not can_view_case(row, user, receipt):
        raise HTTPException(
            404, "Không tìm thấy hồ sơ. Kiểm tra mã và tài khoản đã gửi."
        )
    return row


@app.get("/api/reports/nearby")
def nearby_reports(lat: float, lng: float, conn=Depends(db)):
    if not (-90 <= lat <= 90 and -180 <= lng <= 180):
        raise HTTPException(422, "Tọa độ không hợp lệ.")
    rows = conn.execute(
        """SELECT id,title,status,public,pin_lat,pin_lng,
                  COALESCE(confirmed_group,ai_group,'other') AS group_key
           FROM reports
           WHERE intake_state='passed'
             AND status IN ('received','processing')
             AND pin_lat IS NOT NULL AND pin_lng IS NOT NULL
             AND sample_photo IS NULL AND (owner IS NOT NULL OR guest_receipt IS NOT NULL)"""
    ).fetchall()
    origin = {"pin_lat": lat, "pin_lng": lng}
    hits = []
    for row in rows:
        dist = intake._distance(origin, row)
        if dist <= 50:
            is_public = bool(row["public"])
            hits.append(
                {
                    "id": row["id"] if is_public else None,
                    "title": (
                        row["title"]
                        if is_public
                        else "Có phản ánh tương tự đang được xử lý gần vị trí này"
                    ),
                    "group": row["group_key"],
                    "status": row["status"],
                    "distance_m": round(dist),
                    "public": is_public,
                }
            )
    hits.sort(key=lambda item: (item["distance_m"], not item["public"]))
    return {"items": hits[:3]}


@app.get("/api/reports/{code}")
def detail(code: str, response: Response, user=Depends(session), conn=Depends(db), pax_receipt: str | None = Cookie(default=None)):
    access = authorize_case(conn, code, user, receipt=pax_receipt)
    response.headers["Cache-Control"] = "private, no-store"
    precise = can_manage_case(access, user) or owns_case(access, user, pax_receipt)
    row = serialize(
        conn.execute(
            "SELECT " + FIELDS + " FROM reports r WHERE r.id=%s", (code,)
        ).fetchone(),
        precise=precise,
    )
    if precise:
        assessment = conn.execute(
            "SELECT ai_summary,ai_source,intake_note,intake_photos,duplicate_of FROM reports WHERE id=%s",
            (code,),
        ).fetchone()
        source = assessment.pop("duplicate_of")
        if source:
            original = conn.execute(
                "SELECT owner,public,status,intake_state,assignee,ward FROM reports WHERE id=%s",
                (source,),
            ).fetchone()
            if can_view_case(original, user):
                assessment["duplicate_of"] = source
        row.update(assessment)
    row["history"] = conn.execute(
        "SELECT status,note,created_at,COALESCE(photos,'[]'::jsonb) AS photos FROM history WHERE report_id=%s ORDER BY id DESC",
        (code,),
    ).fetchall()
    row["advice"] = (
        admin_ai.citizen_advice(row)
        if row["status"] != "cancelled"
        and (
            row["intake_state"] == "passed"
            or (row["status"] == "rejected" and not row.get("intake_note"))
        )
        else None
    )
    return row


@app.get("/api/reports/{code}/photos/{position}")
def photo(code: str, position: int, user=Depends(session), conn=Depends(db), pax_receipt: str | None = Cookie(default=None)):
    authorize_case(conn, code, user, receipt=pax_receipt)
    item = conn.execute(
        "SELECT data FROM photos WHERE report_id=%s AND position=%s", (code, position)
    ).fetchone()
    if not item:
        raise HTTPException(404, "Không tìm thấy ảnh.")
    return Response(
        item["data"],
        media_type="image/webp",
        headers={"Cache-Control": "private, no-store"},
    )


def event(conn, code, status, note, user, photos=None):
    conn.execute(
        "INSERT INTO history(report_id,status,note,author,photos) VALUES(%s,%s,%s,%s,%s)",
        (code, status, note, user["id"], Jsonb(photos or [])),
    )


def assignment_officer(conn, assignee):
    officer = conn.execute(
        "SELECT name FROM users WHERE id=%s AND active AND role='staff' FOR SHARE",
        (assignee,),
    ).fetchone()
    if not officer:
        raise HTTPException(422, "Cán bộ chưa có tài khoản đang hoạt động.")
    return officer["name"]


def require_admitted(row):
    if row["intake_state"] in ("pending", "review"):
        raise HTTPException(409, "Hồ sơ chưa qua kiểm tra tiếp nhận.")


def save_assignment(conn, code, status, assignee, officer_name, user):
    conn.execute("UPDATE reports SET assignee=%s WHERE id=%s", (assignee, code))
    event(
        conn,
        code,
        status,
        "Đã phân công " + officer_name + " phụ trách.",
        user,
    )


@app.post("/api/reports/{code}/assign")
def assign(code: str, data: Assignment, user=Depends(session), conn=Depends(db)):
    require(user, "admin")
    officer_name = assignment_officer(conn, data.assignee)
    row = authorize_case(conn, code, user, True)
    require_admitted(row)
    if row["status"] in ("resolved", "rejected", "cancelled"):
        raise HTTPException(409, "Mở lại hồ sơ trước khi phân công.")
    save_assignment(conn, code, row["status"], data.assignee, officer_name, user)
    return {"ok": True}


@app.post("/api/admin/reports/bulk-assign")
def bulk_assign(data: BulkAssignment, user=Depends(session), conn=Depends(db)):
    require(user, "admin")
    if len(set(data.report_ids)) != len(data.report_ids):
        raise HTTPException(422, "Danh sách có mã hồ sơ bị trùng.")
    officer_name = assignment_officer(conn, data.assignee)
    rows = conn.execute(
        "SELECT id,status,assignee,intake_state FROM reports WHERE id=ANY(%s) ORDER BY id FOR UPDATE",
        (data.report_ids,),
    ).fetchall()
    if len(rows) != len(data.report_ids) or any(
        row["assignee"] is not None
        or row["status"] not in intake.OPEN
        or row["intake_state"] != "passed"
        for row in rows
    ):
        raise HTTPException(
            409, "Danh sách đã thay đổi. Kiểm tra lại hồ sơ chưa phân công."
        )
    for row in rows:
        save_assignment(
            conn, row["id"], row["status"], data.assignee, officer_name, user
        )
    conn.commit()
    return {"assigned": len(rows)}


@app.post("/api/reports/{code}/update")
def update(code: str, data: Update, user=Depends(session), conn=Depends(db)):
    require(user, "admin", "staff")
    row = authorize_case(conn, code, user, True)
    require_admitted(row)
    if user["role"] == "staff" and not staff_can_handle(user, row):
        raise HTTPException(
            403, "Hồ sơ chưa được phân công cho bạn hoặc nằm ngoài khu vực của bạn."
        )
    if row["status"] in ("resolved", "rejected", "cancelled"):
        raise HTTPException(409, "Hồ sơ đã đóng. Quản trị viên có thể mở lại.")
    if data.status != "cancelled" and not data.confirmed_group:
        raise HTTPException(422, "Vui lòng chọn nhóm xác nhận.")
    evidence_photos = []
    if data.status != "cancelled" and data.photos:
        for photo_str in data.photos:
            binary = validate_photo(photo_str)
            evidence_photos.append(
                "data:image/webp;base64," + base64.b64encode(binary).decode("ascii")
            )
    claimant = user["id"] if user["role"] == "staff" else None
    conn.execute(
        """UPDATE reports SET status=%s,confirmed_group=COALESCE(%s,confirmed_group),priority=%s,
           assignee=COALESCE(assignee,%s) WHERE id=%s""",
        (data.status, data.confirmed_group, data.priority, claimant, code),
    )
    event(conn, code, data.status, data.note, user, photos=evidence_photos)
    if data.priority == "high" and data.status != "cancelled":
        notify(conn, code)
    return {"ok": True}


@app.post("/api/reports/{code}/claim")
def claim(code: str, user=Depends(session), conn=Depends(db)):
    require(user, "staff")
    row = authorize_case(conn, code, user, True)
    require_admitted(row)
    if row["status"] not in intake.OPEN:
        raise HTTPException(409, "Hồ sơ đã đóng, không thể nhận xử lý.")
    if row["assignee"] == user["id"]:
        return {"ok": True}
    if not staff_can_handle(user, row):
        raise HTTPException(
            403, "Hồ sơ đã có cán bộ phụ trách hoặc nằm ngoài khu vực của bạn."
        )
    save_assignment(conn, code, row["status"], user["id"], user["name"], user)
    return {"ok": True}


@app.post("/api/reports/{code}/reopen")
def reopen(code: str, data: Reopen, user=Depends(session), conn=Depends(db)):
    require(user, "admin")
    row = authorize_case(conn, code, user, True)
    if row["status"] not in ("resolved", "rejected", "cancelled"):
        raise HTTPException(409, "Chỉ mở lại hồ sơ đã xử lý, đã hủy hoặc đã từ chối.")
    if row["status"] == "rejected":
        conn.execute(
            """UPDATE reports SET status='received',intake_state='review',intake_reason=NULL,
               intake_note=%s,intake_photos='{}',duplicate_of=NULL,assignee=NULL WHERE id=%s""",
            ("Quản trị viên mở lại để kiểm tra: " + data.note, code),
        )
    else:
        conn.execute("UPDATE reports SET status='received' WHERE id=%s", (code,))
    event(conn, code, "received", "Mở lại hồ sơ. " + data.note, user)
    return {"ok": True}


@app.post("/api/reports/{code}/intake-review")
def review_intake(
    code: str, data: IntakeReview, user=Depends(session), conn=Depends(db)
):
    require(user, "admin", "staff")
    row = conn.execute(
        """SELECT id,status,intake_state,description,location,ward,pin_lat,pin_lng,
           ai_group,urgent,ai_summary,ai_source,assignee FROM reports WHERE id=%s FOR UPDATE""",
        (code,),
    ).fetchone()
    if not row or (user["role"] == "staff" and not staff_scope(user, row)):
        raise HTTPException(404, "Không tìm thấy hồ sơ.")
    if row["intake_state"] != "review":
        raise HTTPException(409, "Hồ sơ hiện không nằm trong hàng chờ duyệt.")
    accepting = data.decision == "accept"
    if (accepting and not data.group) or (not accepting and not data.note):
        raise HTTPException(422, "Chọn nhóm để tiếp nhận hoặc nhập lý do từ chối.")
    officer_name = None
    if accepting and data.assignee is not None:
        if user["role"] != "admin":
            raise HTTPException(403, "Chỉ quản trị viên mới có thể phân công cán bộ.")
        officer_name = assignment_officer(conn, data.assignee)
    result = intake.apply_result(
        conn,
        row,
        intake.Assessment(
            "passed" if accepting else "rejected",
            row["ai_group"],
            row["urgent"],
            reason=None if accepting else "manual",
            summary=row["ai_summary"],
            source=row["ai_source"],
        ),
        actor=user["id"],
        note=data.note,
        confirmed_group=data.group if accepting else None,
    )
    if result.state == "passed" and officer_name and data.assignee is not None:
        save_assignment(conn, code, row["status"], data.assignee, officer_name, user)
    conn.commit()
    return {"intake_state": result.state, "intake_reason": result.reason}


@app.post("/api/reports/{code}/ai-assist")
def ai_assist(code: str, user=Depends(session), conn=Depends(db)):
    require(user, "admin", "staff")
    access = authorize_case(conn, code, user)
    require_admitted(access)
    if user["role"] == "staff" and not staff_can_handle(user, access):
        raise HTTPException(
            403, "Hồ sơ chưa được phân công cho bạn hoặc nằm ngoài khu vực của bạn."
        )
    row = conn.execute(
        """SELECT id,title,description,location,ward,status,ai_group,confirmed_group,
        urgent,priority,ai_summary,assignee FROM reports WHERE id=%s""",
        (code,),
    ).fetchone()
    return admin_ai.assist(row)


@app.post("/api/reports/{code}/reanalyze")
def reanalyze(code: str, user=Depends(session), conn=Depends(db)):
    require(user, "admin", "staff")
    row = conn.execute(
        "SELECT id,description,sample_photo,ai_consent,intake_state,assignee,ward FROM reports WHERE id=%s FOR UPDATE",
        (code,),
    ).fetchone()
    if not row or (user["role"] == "staff" and not staff_scope(user, row)):
        raise HTTPException(404, "Không tìm thấy hồ sơ.")
    if user["role"] == "staff" and row["intake_state"] != "review":
        raise HTTPException(
            403, "Chỉ quản trị viên được phân tích lại hồ sơ ngoài hàng chờ duyệt."
        )
    pictures = [
        p["data"]
        for p in conn.execute(
            "SELECT data FROM photos WHERE report_id=%s ORDER BY position", (code,)
        ).fetchall()
    ]
    if not pictures and row["sample_photo"]:
        sample_path = ROOT / "public" / row["sample_photo"].lstrip("/")
        if sample_path.is_file():
            pictures = [sample_path.read_bytes()]
    if not pictures:
        raise HTTPException(422, "Hồ sơ chưa có ảnh để phân tích lại.")
    if row["intake_state"] == "pending":
        raise HTTPException(409, "Hồ sơ đang được kiểm tra lần đầu.")
    result = intake.assess(row["description"], pictures, row["ai_consent"])
    summary = result.summary or intake.REASONS.get(result.reason)
    if result.photo_numbers:
        summary = (
            (summary or "")
            + " Ảnh liên quan: "
            + ", ".join(map(str, result.photo_numbers))
            + "."
        )
    conn.execute(
        """UPDATE reports SET ai_group=%s,ai_state='done',ai_summary=%s,ai_source=%s
           WHERE id=%s""",
        (result.group, summary, result.source, code),
    )
    conn.commit()
    return detail(code, Response(), user, conn)


@app.post("/api/admin/ai-briefing")
def ai_briefing(user=Depends(session), conn=Depends(db)):
    require(user, "admin")
    rows = conn.execute(
        "SELECT id,title,status,ai_group,confirmed_group,urgent,priority,assignee,ward,location,pin_lat,pin_lng,created_at FROM reports"
    ).fetchall()
    officers = conn.execute(
        "SELECT id,name,email,active FROM users WHERE role='staff'"
    ).fetchall()
    return admin_ai.briefing(rows, officers)


@app.get("/api/notifications")
def notifications(user=Depends(session), conn=Depends(db)):
    require(user, "admin", "staff")
    staff_only = user["role"] == "staff"
    return conn.execute(
        """SELECT r.id,r.title,n.created_at FROM notifications n JOIN reports r ON r.id=n.report_id
        WHERE r.status NOT IN ('resolved','rejected','cancelled') AND (r.urgent OR r.priority='high')
        AND (NOT %s OR r.assignee=%s OR r.ward=ANY(%s)) ORDER BY n.created_at DESC""",
        (staff_only, user["id"], user["areas"] or []),
    ).fetchall()


STATUS_LABELS = {
    "received": "Đã tiếp nhận",
    "processing": "Đang xử lý",
    "resolved": "Đã xử lý",
    "rejected": "Đã từ chối",
    "cancelled": "Đã hủy",
}


def _actor_label(name: str | None) -> str:
    clean = (name or "").strip()
    if not clean:
        return "Cán bộ"
    low = clean.lower()
    if (
        low.startswith("cán bộ")
        or low.startswith("quản trị")
        or low.startswith("hệ thống")
    ):
        return clean
    return f"Cán bộ {clean}"


def _format_history_notification(h: dict) -> dict:
    note = h.get("note") or ""
    rid = h["report_id"]
    report_title = h["report_title"]
    if note.startswith("Đã phân công "):
        officer = (
            h.get("assignee_name")
            or note.replace("Đã phân công ", "").replace(" phụ trách.", "").strip()
            or "Cán bộ"
        )
        return {
            "id": f"h:{h['id']}",
            "report_id": rid,
            "kind": "assigned",
            "title": f"{_actor_label(officer)} đã tiếp nhận đơn #{rid}",
            "detail": f"{report_title} — {note}",
            "created_at": h["created_at"],
        }
    if h["status"] == "cancelled":
        actor = _actor_label(h.get("author_name") or h.get("assignee_name"))
        return {
            "id": f"h:{h['id']}",
            "report_id": rid,
            "kind": "cancelled",
            "title": f"Hồ sơ #{rid} đã bị hủy ({actor})",
            "detail": f"{report_title} — Lý do: {note}",
            "created_at": h["created_at"],
        }
    if h["status"] == "rejected":
        actor = (
            _actor_label(h.get("author_name")) if h.get("author_name") else "Hệ thống"
        )
        return {
            "id": f"h:{h['id']}",
            "report_id": rid,
            "kind": "rejected",
            "title": f"Hồ sơ #{rid} đã bị từ chối ({actor})",
            "detail": f"{report_title} — {note}",
            "created_at": h["created_at"],
        }
    actor = _actor_label(h.get("author_name") or h.get("assignee_name"))
    st_label = STATUS_LABELS.get(h["status"], h["status"])
    return {
        "id": f"h:{h['id']}",
        "report_id": rid,
        "kind": h["status"],
        "title": f'{actor} chuyển trạng thái sang "{st_label}" · #{rid}',
        "detail": f"{report_title} — {note}",
        "created_at": h["created_at"],
    }


@app.get("/api/user-notifications")
def user_notifications(user=Depends(session), conn=Depends(db)):
    require(user)
    if user["role"] == "citizen":
        hist_rows = conn.execute(
            """SELECT h.id, h.report_id, h.status, h.note, h.created_at,
                      r.title AS report_title, ua.name AS author_name, uas.name AS assignee_name
               FROM history h
               JOIN reports r ON r.id = h.report_id
               LEFT JOIN users ua ON ua.id = h.author
               LEFT JOIN users uas ON uas.id = r.assignee
               WHERE r.owner = %s
               ORDER BY h.id DESC LIMIT 20""",
            (user["id"],),
        ).fetchall()
        items = [_format_history_notification(h) for h in hist_rows]
        initial_rows = conn.execute(
            """SELECT r.id AS report_id, r.title AS report_title, r.created_at,
                      uas.name AS assignee_name
               FROM reports r
               LEFT JOIN users uas ON uas.id = r.assignee
               WHERE r.owner = %s
                 AND NOT EXISTS (SELECT 1 FROM history h WHERE h.report_id = r.id)
               ORDER BY r.created_at DESC LIMIT 5""",
            (user["id"],),
        ).fetchall()
        for r in initial_rows:
            items.append(
                {
                    "id": f"r:{r['report_id']}",
                    "report_id": r["report_id"],
                    "kind": "received",
                    "title": f"Đã tiếp nhận đơn #{r['report_id']}",
                    "detail": f"{r['report_title']} — Đang chờ phân công cán bộ xử lý.",
                    "created_at": r["created_at"],
                }
            )
        items.sort(key=lambda x: x["created_at"], reverse=True)
        return {"urgent_count": len(items), "items": items[:20]}

    urgent_rows = conn.execute(
        """SELECT r.id AS report_id, r.title AS report_title, n.created_at,
                  uas.name AS assignee_name
           FROM notifications n
           JOIN reports r ON r.id = n.report_id
           LEFT JOIN users uas ON uas.id = r.assignee
           WHERE r.status NOT IN ('resolved', 'rejected', 'cancelled')
             AND (r.urgent OR r.priority = 'high')
             AND (NOT %s OR r.assignee = %s OR r.ward = ANY(%s))
           ORDER BY n.created_at DESC""",
        (user["role"] == "staff", user["id"], user["areas"] or []),
    ).fetchall()
    urgent_items = [
        {
            "id": f"u:{row['report_id']}",
            "report_id": row["report_id"],
            "kind": "urgent",
            "title": f"[Khẩn cấp] Đơn #{row['report_id']} cần xem xét sớm",
            "detail": (
                f"{row['report_title']} · "
                + (
                    f"{_actor_label(row['assignee_name'])} phụ trách"
                    if row.get("assignee_name")
                    else "Chưa phân công cán bộ"
                )
            ),
            "created_at": row["created_at"],
        }
        for row in urgent_rows[:10]
    ]
    if user["role"] == "staff":
        hist_rows = conn.execute(
            """SELECT h.id, h.report_id, h.status, h.note, h.created_at,
                      r.title AS report_title, ua.name AS author_name, uas.name AS assignee_name
               FROM history h
               JOIN reports r ON r.id = h.report_id
               LEFT JOIN users ua ON ua.id = h.author
               LEFT JOIN users uas ON uas.id = r.assignee
               WHERE r.assignee = %s OR h.author = %s
               ORDER BY h.id DESC LIMIT 12""",
            (user["id"], user["id"]),
        ).fetchall()
    else:
        hist_rows = conn.execute(
            """SELECT h.id, h.report_id, h.status, h.note, h.created_at,
                      r.title AS report_title, ua.name AS author_name, uas.name AS assignee_name
               FROM history h
               JOIN reports r ON r.id = h.report_id
               LEFT JOIN users ua ON ua.id = h.author
               LEFT JOIN users uas ON uas.id = r.assignee
               ORDER BY h.id DESC LIMIT 12"""
        ).fetchall()
    history_items = [_format_history_notification(h) for h in hist_rows]
    return {
        "urgent_count": len(urgent_rows),
        "items": (urgent_items + history_items)[:20],
    }


if (ROOT / "dist/index.html").exists():
    app.mount("/", StaticFiles(directory=ROOT / "dist", html=True), name="website")
