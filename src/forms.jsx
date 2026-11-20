import React, { lazy, Suspense, useEffect, useRef, useState } from "react";
import {
  ImagePlus,
  Camera,
  Sparkles,
  AlertTriangle,
  X,
  Send,
  Search,
  CheckCircle2,
  Eye,
  EyeOff,
  MapPin,
  ChevronRight,
  Plus,
  UserRound,
  LayoutDashboard,
  ClipboardList,
  LogOut,
} from "lucide-react";
import { api, awaitingIntake, dateText, groups, navigate, roles, statuses } from "./domain";
import { Page, ErrorMsg, AdviceBox, IntakeNotice, Status, Empty } from "./ui";
const LocationPicker = lazy(() =>
  import("./maps").then((m) => ({ default: m.LocationPicker })),
);
export function Auth({ register, onAuth, next }) {
  const savedEmail = !register
    ? localStorage.getItem("pax_saved_email") || ""
    : "";
  const [busy, setBusy] = useState(false),
    [err, setErr] = useState(""),
    [visible, setVisible] = useState(false);
  async function submit(e) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const remember = form.has("remember");
    const body = { ...Object.fromEntries(form), remember };
    setBusy(true);
    setErr("");
    try {
      const user = await api(register ? "/register" : "/login", "POST", body);
      if (remember) localStorage.setItem("pax_saved_email", user.email);
      else localStorage.removeItem("pax_saved_email");
      onAuth(user);
      navigate(next || "/desk");
    } catch (ex) {
      setErr(ex.message);
    } finally {
      setBusy(false);
    }
  }
  const title = register ? "Đăng ký tài khoản" : "Đăng nhập";
  return (
    <Page title={title}>
      <form className="panel form" onSubmit={submit}>
        {next === "/new" && (
          <p className="intro">
            Đăng nhập để gửi phản ánh và nhận phản hồi từ cán bộ.
          </p>
        )}
        {register && (
          <label>
            Họ và tên
            <input name="name" autoComplete="name" maxLength={80} required />
          </label>
        )}
        <label>
          Email
          <input
            type="email"
            name="email"
            required
            maxLength={180}
            autoComplete="email"
            defaultValue={savedEmail}
          />
        </label>
        <label>
          Mật khẩu
          <span className="password">
            <input
              type={visible ? "text" : "password"}
              name="password"
              aria-label="Mật khẩu"
              minLength={register ? 8 : 1}
              maxLength={128}
              required
              autoComplete={register ? "new-password" : "current-password"}
            />
            <button
              type="button"
              className="icon-btn"
              aria-label={visible ? "Ẩn mật khẩu" : "Hiện mật khẩu"}
              onClick={() => setVisible(!visible)}
            >
              {visible ? <EyeOff size={18} /> : <Eye size={18} />}
            </button>
          </span>
          {register && <small>Tối thiểu 8 ký tự.</small>}
        </label>
        <label className="check">
          <input
            type="checkbox"
            name="remember"
            defaultChecked={Boolean(savedEmail)}
          />
          <span>Ghi nhớ đăng nhập</span>
        </label>
        <ErrorMsg msg={err} />
        <button className="btn green" disabled={busy}>
          {busy ? "Đang xử lý…" : title}
        </button>
        <p className="form-foot">
          {register ? "Đã có tài khoản? " : "Chưa có tài khoản? "}
          <a
            href={
              "#/" +
              (register ? "login" : "register") +
              (next ? "?next=" + encodeURIComponent(next) : "")
            }
          >
            {register ? "Đăng nhập" : "Đăng ký ngay"}
          </a>
        </p>
      </form>
    </Page>
  );
}
export async function readImage(file) {
  if (!["image/jpeg", "image/png", "image/webp"].includes(file.type))
    throw Error("Chọn ảnh JPG, PNG hoặc WebP.");
  if (file.size > 8 * 1024 * 1024) throw Error("Mỗi ảnh tối đa 8 MB.");
  const bitmap = await createImageBitmap(file).catch(() => {
    throw Error("Không đọc được ảnh. Vui lòng chọn lại.");
  });
  const scale = Math.min(1, 1440 / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  canvas.getContext("2d").drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  return canvas.toDataURL("image/webp", 0.82);
}

/** Extract GPS coordinates inside TP.HCM from a JPEG EXIF header if available. */
async function extractExifGps(file) {
  if (file?.type !== "image/jpeg") return null;
  try {
    const view = new DataView(await file.slice(0, 131072).arrayBuffer());
    if (view.byteLength < 12 || view.getUint16(0, false) !== 0xffd8) return null;
    let pos = 2;
    while (pos + 4 <= view.byteLength) {
      const marker = view.getUint16(pos, false);
      pos += 2;
      if (marker === 0xffe1) {
        if (view.getUint32(pos + 2, false) !== 0x45786966) break; // "Exif"
        const tiff = pos + 8;
        if (tiff + 8 > view.byteLength) return null;
        const le = view.getUint16(tiff, false) === 0x4949;
        const ifd0 = tiff + view.getUint32(tiff + 4, le);
        const entries = view.getUint16(ifd0, le);
        let gpsOffset = 0;
        for (let i = 0; i < entries; i++) {
          const entry = ifd0 + 2 + i * 12;
          if (entry + 12 <= view.byteLength && view.getUint16(entry, le) === 0x8825) {
            gpsOffset = tiff + view.getUint32(entry + 8, le);
            break;
          }
        }
        if (!gpsOffset || gpsOffset + 2 > view.byteLength) return null;
        const gpsCount = view.getUint16(gpsOffset, le);
        const readRat3 = (off) => {
          const dms = [];
          for (let j = 0; j < 3; j++) {
            const num = view.getUint32(off + j * 8, le);
            const den = view.getUint32(off + j * 8 + 4, le) || 1;
            dms.push(num / den);
          }
          return dms[0] + dms[1] / 60 + dms[2] / 3600;
        };
        let latRef = "N",
          lngRef = "E",
          lat = null,
          lng = null;
        for (let i = 0; i < gpsCount; i++) {
          const entry = gpsOffset + 2 + i * 12;
          if (entry + 12 > view.byteLength) break;
          const tag = view.getUint16(entry, le);
          if (tag === 1) latRef = String.fromCharCode(view.getUint8(entry + 8));
          else if (tag === 3) lngRef = String.fromCharCode(view.getUint8(entry + 8));
          else if (tag === 2) lat = readRat3(tiff + view.getUint32(entry + 8, le));
          else if (tag === 4) lng = readRat3(tiff + view.getUint32(entry + 8, le));
        }
        if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
        const signedLat = Number(((latRef === "S" ? -1 : 1) * lat).toFixed(6));
        const signedLng = Number(((lngRef === "W" ? -1 : 1) * lng).toFixed(6));
        if (
          signedLat >= 10.33 &&
          signedLat <= 11.18 &&
          signedLng >= 106.33 &&
          signedLng <= 107.05
        ) {
          return { lat: signedLat, lng: signedLng };
        }
        return null;
      }
      if ((marker & 0xff00) !== 0xff00 || pos + 2 > view.byteLength) break;
      pos += view.getUint16(pos, false);
    }
  } catch {
    return null;
  }
  return null;
}

function saveGuestReportRecord(record) {
  try {
    const prev = JSON.parse(localStorage.getItem("pax_guest_reports") || "[]");
    const next = [record, ...prev.filter((item) => item?.id !== record.id)].slice(0, 15);
    localStorage.setItem("pax_guest_reports", JSON.stringify(next));
  } catch {
    // Ignore storage errors
  }
}

export function NewReport({ refresh, me }) {
  const [pin, setPin] = useState(null),
    [location, setLocation] = useState("");
  const [description, setDescription] = useState("");
  const [photos, setPhotos] = useState([]),
    [analyzingPhotos, setAnalyzingPhotos] = useState(false),
    [photoAnalysis, setPhotoAnalysis] = useState(null),
    [exifHint, setExifHint] = useState(""),
    [nearbyReports, setNearbyReports] = useState([]),
    [busy, setBusy] = useState(false),
    [reading, setReading] = useState(false),
    [err, setErr] = useState("");
  const analyzeSeq = useRef(0);
  const fileInputRef = useRef(null);

  useEffect(() => {
    try {
      const raw = sessionStorage.getItem("pax_resubmit_draft");
      if (!raw) return;
      sessionStorage.removeItem("pax_resubmit_draft");
      const draft = JSON.parse(raw);
      if (draft.description) setDescription(String(draft.description));
      if (draft.location) setLocation(String(draft.location));
      if (draft.pin && Number.isFinite(draft.pin.lat) && Number.isFinite(draft.pin.lng)) {
        setPin(draft.pin);
      }
    } catch {
      // Ignore malformed draft
    }
  }, []);

  useEffect(() => {
    if (!pin) {
      setNearbyReports([]);
      return;
    }
    let live = true;
    api(`/reports/nearby?lat=${encodeURIComponent(pin.lat)}&lng=${encodeURIComponent(pin.lng)}`)
      .then((res) => {
        if (live) setNearbyReports(res?.items || []);
      })
      .catch(() => {
        if (live) setNearbyReports([]);
      });
    return () => {
      live = false;
    };
  }, [pin?.lat, pin?.lng]);

  async function analyzeNextPhotos(nextPhotos) {
    const seq = ++analyzeSeq.current;
    if (!nextPhotos.length) {
      setAnalyzingPhotos(false);
      setPhotoAnalysis(null);
      return;
    }
    setAnalyzingPhotos(true);
    try {
      const res = await api("/reports/analyze-photos", "POST", {
        photos: nextPhotos,
      });
      if (seq !== analyzeSeq.current) return;
      setPhotoAnalysis(res);
    } catch {
      if (seq === analyzeSeq.current) setPhotoAnalysis(null);
    } finally {
      if (seq === analyzeSeq.current) setAnalyzingPhotos(false);
    }
  }

  function triggerFilePicker(useCamera) {
    const input = fileInputRef.current;
    if (!input || reading || busy) return;
    if (useCamera) input.setAttribute("capture", "environment");
    else input.removeAttribute("capture");
    input.click();
    if (useCamera) {
      setTimeout(() => input.removeAttribute("capture"), 500);
    }
  }

  async function add(e) {
    const files = [...e.target.files];
    e.target.value = "";
    fileInputRef.current?.removeAttribute("capture");
    if (!files.length) return;
    setErr("");
    if (files.length + photos.length > 3) {
      setErr("Chỉ được đính kèm tối đa 3 ảnh.");
      return;
    }
    setReading(true);
    try {
      const [batch, gpsList] = await Promise.all([
        Promise.all(files.map(readImage)),
        pin ? Promise.resolve([]) : Promise.all(files.map(extractExifGps)),
      ]);
      const exifPin = gpsList.find(Boolean);
      if (!pin && exifPin) {
        setPin(exifPin);
        setExifHint("Đã tự động đặt ghim bản đồ từ tọa độ GPS của ảnh.");
      }
      const nextPhotos = [...photos, ...batch];
      setPhotos(nextPhotos);
      analyzeNextPhotos(nextPhotos);
    } catch (ex) {
      setErr(ex.message);
    } finally {
      setReading(false);
    }
  }

  function removePhoto(index) {
    const nextPhotos = photos.filter((_, j) => index !== j);
    setPhotos(nextPhotos);
    analyzeNextPhotos(nextPhotos);
  }

  async function submit(e) {
    e.preventDefault();
    if (busy || reading) return;
    const form = new FormData(e.currentTarget);
    const cleanDesc = description.trim() || String(form.get("description") || "");
    const cleanLoc = location.trim() || String(form.get("location") || "").trim();
    setErr("");
    setBusy(true);
    try {
      const r = await api("/reports", "POST", {
        description: cleanDesc,
        location: cleanLoc,
        pin,
        photos,
        public: form.has("public"),
        ai_consent: form.has("ai_consent"),
      });
      if (!me) {
        saveGuestReportRecord({
          id: r.id,
          title: cleanDesc.split(/\r?\n/)[0].slice(0, 95),
          location: cleanLoc,
          status: r.status || "received",
          created_at: new Date().toISOString(),
        });
      }
      refresh();
      navigate("/sent/" + r.id);
    } catch (ex) {
      setErr(ex.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Page title="Gửi phản ánh">
      <form className="panel form" onSubmit={submit}>
        {!me && (
          <p className="intro">
            Bạn có thể gửi với tư cách khách. Hãy lưu mã hồ sơ và dùng lại trình
            duyệt này để xem phản ánh riêng tư.
          </p>
        )}
        <div className="media-first-block">
          <div className="field-title">
            1. Ảnh hiện trường <small>({photos.length}/3)</small>
          </div>
          {photos.length > 0 && (
            <div className="previews">
              {photos.map((p, i) => (
                <div key={i}>
                  <img src={p} alt={"Ảnh đính kèm " + (i + 1)} />
                  <button
                    type="button"
                    aria-label={"Xóa ảnh " + (i + 1)}
                    onClick={() => removePhoto(i)}
                  >
                    <X size={15} />
                  </button>
                </div>
              ))}
            </div>
          )}
          {photos.length < 3 && (
            <div className="upload-grid">
              <label className="upload">
                <ImagePlus size={22} />
                <strong>
                  {reading ? "Đang đọc ảnh…" : "Chọn ảnh từ thiết bị"}
                </strong>
                <small>JPG, PNG, WebP · Tối đa 8 MB/ảnh</small>
                <input
                  ref={fileInputRef}
                  aria-label="Chọn ảnh từ thiết bị"
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  multiple
                  disabled={reading || busy}
                  onChange={add}
                />
              </label>
              <button
                type="button"
                className="upload upload-camera"
                aria-label="Chụp ảnh hiện trường"
                disabled={reading || busy}
                onClick={() => triggerFilePicker(true)}
              >
                <Camera size={22} />
                <strong>
                  {reading ? "Đang mở máy ảnh…" : "Chụp ảnh hiện trường"}
                </strong>
                <small>Mở trực tiếp camera sau trên điện thoại</small>
              </button>
            </div>
          )}
          {exifHint && (
            <p className="exif-pin-hint" role="status">
              <MapPin size={14} aria-hidden="true" />
              <span>{exifHint}</span>
            </p>
          )}
          {(analyzingPhotos || photoAnalysis) && (
            <div
              className={
                "photo-ai-card" +
                (photoAnalysis && !photoAnalysis.quality_ok ? " is-warning" : "")
              }
              aria-live="polite"
            >
              {analyzingPhotos ? (
                <div className="photo-ai-status">
                  <Sparkles size={16} aria-hidden="true" />
                  <span>Đang kiểm tra chất lượng ảnh…</span>
                </div>
              ) : (
                <>
                  <div className="photo-ai-status">
                    {photoAnalysis.quality_ok ? (
                      <CheckCircle2 size={16} aria-hidden="true" />
                    ) : (
                      <AlertTriangle size={16} aria-hidden="true" />
                    )}
                    <span>{photoAnalysis.status_text}</span>
                  </div>
                  {photoAnalysis.warnings?.length > 1 && (
                    <ul className="photo-ai-warnings">
                      {photoAnalysis.warnings.slice(1).map((w, idx) => (
                        <li key={idx}>{w}</li>
                      ))}
                    </ul>
                  )}
                </>
              )}
            </div>
          )}
        </div>
        <label>
          2. Mô tả sự việc
          <textarea
            name="description"
            placeholder="Bạn đã ghi nhận vấn đề môi trường gì?"
            rows={4}
            maxLength={3000}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            required
          />
        </label>
        <div className="location-block">
          <div className="field-title">
            3. Địa điểm &amp; bản đồ{" "}
            <small>
              (Chọn trên bản đồ hoặc tìm số nhà, tên đường tại TP.HCM)
            </small>
          </div>
          <Suspense fallback={<small>Đang mở bản đồ…</small>}>
            <LocationPicker
              pin={pin}
              setPin={setPin}
              location={location}
              setLocation={setLocation}
            />
          </Suspense>
          {nearbyReports.length > 0 && (
            <div className="nearby-duplicate-notice" role="status">
              <AlertTriangle size={16} aria-hidden="true" />
              <div>
                <strong>
                  Đã có phản ánh đang xử lý trong bán kính 50 m gần vị trí này:
                </strong>
                <ul>
                  {nearbyReports.map((item, idx) => (
                    <li key={item.id || idx}>
                      {item.id ? (
                        <a href={"#/report/" + encodeURIComponent(item.id)}>
                          {item.id} · {item.title}
                        </a>
                      ) : (
                        <span>{item.title}</span>
                      )}{" "}
                      <small>
                        ({groups[item.group] || "Môi trường"} · {statuses[item.status] || item.status} · cách ~{item.distance_m} m)
                      </small>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          )}
        </div>
        <label className="check">
          <input type="checkbox" name="public" />
          <span>
            Chia sẻ nội dung, ảnh và vị trí gần đúng trên bảng tin cộng đồng
          </span>
        </label>
        <label className="check">
          <input type="checkbox" name="ai_consent" />
          <span>
            Đồng ý cho AI hỗ trợ kiểm tra thêm khi cần thiết.{" "}
            <a href="#/privacy">Xem chi tiết</a>
          </span>
        </label>
        <ErrorMsg msg={err} />
        <button className="btn green" disabled={busy || reading}>
          <Send size={17} />
          {busy ? "Đang gửi…" : "Gửi phản ánh"}
        </button>
      </form>
    </Page>
  );
}
export function Sent({ id, me }) {
  const [r, setR] = useState(null);
  useEffect(() => {
    let active = true;
    let timer = 0;
    async function load() {
      try {
        const data = await api("/reports/" + encodeURIComponent(id));
        if (!active) return;
        setR(data);
        if (
          awaitingIntake(data) ||
          (data.ai_state === "pending" && !data.ai_group)
        ) {
          timer = window.setTimeout(load, 2500);
        }
      } catch {
        // Citizen still has the tracking code link above if polling fails
      }
    }
    load();
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [id]);
  return (
    <Page title="Gửi phản ánh thành công">
      <div className="panel success">
        <CheckCircle2 size={46} />
        <h2>Đã gửi hồ sơ</h2>
        <p>{me ? "Lưu mã hồ sơ để theo dõi quá trình xử lý." : "Lưu mã hồ sơ và dùng lại trình duyệt này để theo dõi phản ánh riêng tư."}</p>
        <strong className="code">{id}</strong>
        <a className="btn green" href={"#/report/" + id}>
          <Search size={17} />
          Theo dõi phản ánh
        </a>
      </div>
      <IntakeNotice report={r || { intake_state: "pending" }} canResubmit />
      <AdviceBox report={r} />
    </Page>
  );
}
export function ReportLookup({ me, compact = false }) {
  const [err, setErr] = useState(""),
    [busy, setBusy] = useState(false);

  async function submit(event) {
    event.preventDefault();
    const code = new FormData(event.currentTarget).get("code").trim().toUpperCase();
    if (!code) {
      setErr("Nhập mã hồ sơ để tra cứu.");
      return;
    }
    if (!/^[A-Z0-9-]{1,40}$/.test(code)) {
      setErr("Không tìm thấy hồ sơ. Kiểm tra mã và tài khoản đã gửi.");
      return;
    }
    const casePath = "/report/" + encodeURIComponent(code);
    setErr("");
    setBusy(true);
    try {
      await api("/reports/" + encodeURIComponent(code));
      navigate(casePath);
    } catch (error) {
      setErr(error.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      aria-label={compact ? "Tra cứu bằng mã hồ sơ" : undefined}
      className={compact ? "banner-lookup" : "panel form"}
      onSubmit={submit}
    >
      <label>
        Mã hồ sơ
        <input
          name="code"
          required
          placeholder="Nhập mã PX-…"
          maxLength={40}
          autoFocus={compact}
        />
      </label>
      <button className="btn green" disabled={busy}>
        {!compact && <Search size={17} aria-hidden="true" />}
        {busy ? "Đang tra cứu…" : compact ? "Tra cứu" : "Tra cứu hồ sơ"}
      </button>
      {(!compact || !me) && <small>Dùng trình duyệt đã gửi hoặc đăng nhập bằng tài khoản đã gửi để xem hồ sơ riêng tư.</small>}
      <ErrorMsg msg={err} />
    </form>
  );
}

export function Track({ me }) {
  const [reports, setReports] = useState(null),
    [guestReports, setGuestReports] = useState([]),
    [listErr, setListErr] = useState("");
  useEffect(() => {
    let live = true;
    if (!me) {
      setReports(null);
      setListErr("");
      let stored = [];
      try {
        stored = JSON.parse(localStorage.getItem("pax_guest_reports") || "[]");
      } catch {
        stored = [];
      }
      if (!Array.isArray(stored) || !stored.length) {
        setGuestReports([]);
        return;
      }
      setGuestReports(stored);
      Promise.all(
        stored.slice(0, 10).map((item) =>
          api("/reports/" + encodeURIComponent(item.id)).catch(() => item),
        ),
      ).then((resolved) => {
        if (live) setGuestReports(resolved.filter(Boolean));
      });
      return () => {
        live = false;
      };
    }
    setGuestReports([]);
    setListErr("");
    api("/reports")
      .then((rows) => {
        if (live) setReports(rows);
      })
      .catch((ex) => {
        if (live) setListErr(ex.message);
      });
    return () => {
      live = false;
    };
  }, [me?.id]);
  return (
    <Page title="Theo dõi phản ánh">
      <ReportLookup me={me} />
      <section className="panel my-reports">
        <div className="my-reports-head">
          <h2>{me ? "Hồ sơ của tôi" : "Hồ sơ đã gửi trên thiết bị này"}</h2>
          {me && (
            <a className="btn outline small" href="#/new">
              <Plus size={15} />
              Gửi phản ánh mới
            </a>
          )}
        </div>
        {!me ? (
          <>
            {guestReports.length > 0 && (
              <div className="report-list">
                {guestReports.map((r) => (
                  <a href={"#/report/" + r.id} key={r.id}>
                    <div>
                      <small>
                        {r.id} · {dateText(r.created_at)}
                      </small>
                      <h3>{r.title}</h3>
                      <p>
                        <MapPin size={14} />
                        {r.location}
                      </p>
                    </div>
                    <Status value={r.status} intakeState={r.intake_state} />
                    <ChevronRight size={18} />
                  </a>
                ))}
              </div>
            )}
            <div className="my-reports-login">
              <p className="intro">
                {guestReports.length > 0
                  ? "Đăng nhập để đồng bộ hồ sơ trên nhiều thiết bị và nhận đầy đủ lịch sử xử lý."
                  : "Đăng nhập để xem toàn bộ hồ sơ bạn đã gửi và theo dõi tiến độ xử lý."}
              </p>
              <a className="btn outline small" href="#/login?next=/track">
                Đăng nhập để xem hồ sơ của bạn
              </a>
            </div>
          </>
        ) : listErr ? (
          <ErrorMsg msg={listErr} />
        ) : !reports ? (
          <p>Đang tải hồ sơ…</p>
        ) : !reports.length ? (
          <Empty>Bạn chưa có hồ sơ phản ánh nào.</Empty>
        ) : (
          <div className="report-list">
            {reports.map((r) => (
              <a href={"#/report/" + r.id} key={r.id}>
                <div>
                  <small>
                    {r.id} · {dateText(r.created_at)}
                  </small>
                  <h3>{r.title}</h3>
                  <p>
                    <MapPin size={14} />
                    {r.location}
                  </p>
                </div>
                <Status value={r.status} intakeState={r.intake_state} />
                <ChevronRight size={18} />
              </a>
            ))}
          </div>
        )}
      </section>
    </Page>
  );
}
export function Profile({ me, onAuth, logout }) {
  const [name, setName] = useState(me.name || "");
  const [password, setPassword] = useState("");
  const [visible, setVisible] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [message, setMessage] = useState("");

  useEffect(() => {
    setName(me.name || "");
  }, [me.name]);

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setErr("");
    setMessage("");
    try {
      const payload = { name: name.trim() };
      if (password) payload.password = password;
      const updated = await api("/profile", "PATCH", payload);
      onAuth(updated);
      setPassword("");
      setMessage("Đã cập nhật thông tin cá nhân.");
    } catch (ex) {
      setErr(ex.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Page title="Thông tin cá nhân">
      <section className="panel profile-card">
        <div className="profile-summary">
          <span className="profile-avatar">
            <UserRound size={28} />
          </span>
          <div className="profile-meta">
            <div className="user-title-row">
              <h2>{me.name}</h2>
              <span className={"role-badge " + me.role}>
                {roles[me.role] || me.role}
              </span>
              <span className="badge assigned">Đang hoạt động</span>
            </div>
            <p>{me.email}</p>
          </div>
        </div>
        <div className="profile-actions">
          {me.role === "admin" && (
            <a className="btn outline small" href="#/admin">
              <LayoutDashboard size={15} /> Dashboard quản trị
            </a>
          )}
          {me.role === "staff" && (
            <a className="btn outline small" href="#/desk">
              <LayoutDashboard size={15} /> Bàn làm việc cán bộ
            </a>
          )}
          <a className="btn outline small" href="#/track">
            <ClipboardList size={15} /> Hồ sơ của tôi
          </a>
          <a className="btn outline small" href="#/new">
            <Send size={15} /> Gửi phản ánh mới
          </a>
        </div>
      </section>
      <form className="panel form" onSubmit={submit}>
        <h2>Cập nhật tài khoản</h2>
        <label>
          Họ và tên
          <input
            name="name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            maxLength={80}
            autoComplete="name"
          />
        </label>
        <div className="cols">
          <label>
            Email
            <input type="email" value={me.email} disabled readOnly />
          </label>
          <label>
            Vai trò
            <input
              type="text"
              value={roles[me.role] || me.role}
              disabled
              readOnly
            />
          </label>
        </div>
        <label>
          Mật khẩu mới
          <span className="password">
            <input
              type={visible ? "text" : "password"}
              name="password"
              aria-label="Mật khẩu mới"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              minLength={8}
              maxLength={128}
              placeholder="Để trống nếu không muốn đổi mật khẩu"
              autoComplete="new-password"
            />
            <button
              type="button"
              className="icon-btn"
              aria-label={visible ? "Ẩn mật khẩu" : "Hiện mật khẩu"}
              onClick={() => setVisible(!visible)}
            >
              {visible ? <EyeOff size={18} /> : <Eye size={18} />}
            </button>
          </span>
          <small>Tối thiểu 8 ký tự nếu đổi mật khẩu.</small>
        </label>
        <ErrorMsg msg={err} />
        {message && (
          <p className="assist-head" aria-live="polite">
            {message}
          </p>
        )}
        <div className="profile-form-actions">
          <button className="btn green" disabled={busy}>
            {busy ? "Đang lưu…" : "Lưu thay đổi"}
          </button>
          <button type="button" className="btn outline" onClick={logout}>
            <LogOut size={16} />
            Đăng xuất
          </button>
        </div>
      </form>
    </Page>
  );
}
