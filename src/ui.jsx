import React, { useEffect, useRef, useState } from "react";
import {
  Bell,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  MapPin,
  CalendarDays,
  Leaf,
  UserRound,
  LogOut,
  ClipboardList,
  Inbox,
  Clock,
  CircleCheck,
  LayoutDashboard,
  Map as MapIcon,
  Send,
  Search,
  Image as ImageIcon,
  AlertTriangle,
  ShieldAlert,
  Info,
  Phone,
  Sparkles,
} from "lucide-react";
import {
  statuses,
  groups,
  groupIcons,
  roles,
  dateText,
  intakeLabels,
  awaitingIntake,
} from "./domain";
export function Brand() {
  return (
    <a className="brand" href="#/">
      <img src="/images/logo.png" alt="" />
      <span>
        Phản Ánh <em>Xanh</em>
      </span>
    </a>
  );
}
export function Status({ value, intakeState }) {
  const label = intakeLabels[intakeState];
  return (
    <span className={"status " + (label ? intakeState : value)}>
      <i />
      {label || statuses[value]}
    </span>
  );
}
export function Group({ value, suggested = false }) {
  const Icon = groupIcons[value] || Leaf;
  return (
    <span className={"group " + value}>
      <Icon size={15} />
      {groups[value] || "Chờ phân loại"}
      {suggested && <small title="Nhóm do AI gợi ý">AI</small>}
    </span>
  );
}
export function Stats({ counts }) {
  const items = {
    total: ["Tổng phản ánh", ClipboardList],
    received: [statuses.received, Inbox],
    processing: [statuses.processing, Clock],
    resolved: [statuses.resolved, CircleCheck],
  };
  return (
    <dl className="stats" aria-label="Thống kê phản ánh">
      {Object.entries(items).map(([s, [label, Icon]]) => (
        <div className={"stat " + s} key={s}>
          <dt>{label}</dt>
          <dd>
            <Icon className="stat-icon" strokeWidth={1.5} aria-hidden="true" />
            {counts?.[s]?.toLocaleString("vi-VN") ?? "—"}
          </dd>
        </div>
      ))}
    </dl>
  );
}
export function Cards({ reports, trackRef, editorial = false }) {
  return (
    <div className="cards" ref={trackRef}>
      {reports.map((r) => (
        <a className="report-card" key={r.id} href={"#/report/" + r.id}>
          <div className="card-photo">
            {r.photos?.[0] ? (
              <img src={r.photos[0]} alt={r.title} loading="lazy" />
            ) : (
              <div className="no-photo">
                {!editorial && <ImageIcon />}
                Chưa có ảnh
              </div>
            )}
            <Status value={r.status} />
          </div>
          <div className="card-info">
            <div className="meta">
              {editorial ? (
                <span>
                  {groups[r.confirmed_group || r.ai_group] || "Chờ phân loại"}
                </span>
              ) : (
                <Group
                  value={r.confirmed_group || r.ai_group}
                  suggested={!r.confirmed_group && Boolean(r.ai_group)}
                />
              )}
              <span>
                {!editorial && <CalendarDays size={13} />}
                {dateText(r.created_at)}
              </span>
            </div>
            <h3>{r.title}</h3>
            {editorial && r.id.startsWith("PX-MAU") && (
              <small className="report-sample">Hồ sơ minh họa</small>
            )}
            <p>
              {!editorial && <MapPin size={15} />}
              {r.location}
            </p>
          </div>
        </a>
      ))}
    </div>
  );
}
export function RecentReports({ reports, loading }) {
  const track = useRef(null);
  const [resolvedOnly, setResolvedOnly] = useState(false);
  const [edges, setEdges] = useState({ start: true, end: true });
  const reportTime = (report) =>
    Date.parse((resolvedOnly && report.resolved_at) || report.created_at);
  const recent = [...reports]
    .filter((report) => !resolvedOnly || report.status === "resolved")
    .sort((a, b) => reportTime(b) - reportTime(a))
    .slice(0, 12);

  useEffect(() => {
    const element = track.current;
    function measure() {
      const start = element.scrollLeft <= 1;
      const end =
        element.scrollWidth - element.clientWidth - element.scrollLeft <= 1;
      setEdges((previous) =>
        previous.start === start && previous.end === end
          ? previous
          : { start, end },
      );
    }
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    element.addEventListener("scroll", measure, { passive: true });
    measure();
    return () => {
      observer.disconnect();
      element.removeEventListener("scroll", measure);
    };
  }, [recent.length, resolvedOnly]);

  function selectFilter(resolved) {
    if (resolvedOnly !== resolved) track.current.scrollLeft = 0;
    setResolvedOnly(resolved);
  }

  function move(direction) {
    const element = track.current;
    const [first, second] = element.children;
    if (!second) return;
    const step =
      second.getBoundingClientRect().left - first.getBoundingClientRect().left;
    element.scrollBy({
      left: direction * step,
      behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches
        ? "instant"
        : "smooth",
    });
  }

  return (
    <section className="recent" aria-labelledby="recent-title">
      <h2 className="recent-heading" id="recent-title">
        Phản ánh gần đây
      </h2>
      <div className="home-recent-filters" role="group" aria-label="Lọc phản ánh gần đây">
        <button type="button" aria-pressed={!resolvedOnly} onClick={() => selectFilter(false)}>Mới nhất</button>
        <button type="button" aria-pressed={resolvedOnly} onClick={() => selectFilter(true)}>Đã xử lý</button>
      </div>
      <div className="recent-carousel">
        {recent.length > 1 && <div
          className="recent-controls"
          role="group"
          aria-label="Điều hướng phản ánh gần đây"
        >
          <button
            type="button"
            className="icon-btn"
            aria-label="Phản ánh trước"
            disabled={edges.start}
            onClick={() => move(-1)}
          >
            <ChevronLeft size={19} />
          </button>
          <button
            type="button"
            className="icon-btn"
            aria-label="Phản ánh tiếp theo"
            disabled={edges.end}
            onClick={() => move(1)}
          >
            <ChevronRight size={19} />
          </button>
        </div>}
        <Cards reports={recent} trackRef={track} editorial />
      </div>
      {loading ? <p className="empty" role="status">Đang tải phản ánh công khai…</p> : !recent.length && (
        <Empty>{resolvedOnly ? "Chưa có phản ánh công khai đã xử lý." : "Chưa có phản ánh công khai."}</Empty>
      )}
      <div className="recent-links">
        <a className="all-link" href="#/community">
          Xem tất cả <ChevronRight size={16} />
        </a>
      </div>
    </section>
  );
}
export function Guide({ send }) {
  return (
    <Page title="Hướng dẫn gửi phản ánh">
      <div className="panel steps">
        {[
          [
            Send,
            "Gửi thông tin sự việc",
            "Mô tả vấn đề, ghi rõ địa điểm và đính kèm tối đa 3 ảnh nếu có. Bạn có thể gửi với tư cách khách và nhận mã hồ sơ ngay sau khi gửi.",
          ],
          [
            ClipboardList,
            "Tiếp nhận và xử lý",
            "AI gợi ý nhóm phản ánh. Cán bộ xác nhận nhóm, đánh giá mức ưu tiên và cập nhật tình hình xử lý.",
          ],
          [
            Search,
            "Theo dõi phản hồi",
            "Mở “Hồ sơ của tôi” hoặc nhập mã tại “Theo dõi phản ánh” để xem tiến độ và phản hồi của cán bộ.",
          ],
        ].map(([Icon, t, d], i) => (
          <article key={t}>
            <span className="guide-icon">
              <Icon />
            </span>
            <div>
              <h3>
                {i + 1}. {t}
              </h3>
              <p>{d}</p>
            </div>
          </article>
        ))}
        <button className="btn green" onClick={send}>
          <Send size={17} />
          Gửi phản ánh
        </button>
      </div>
    </Page>
  );
}
export function Page({
  title,
  children,
  wide = false,
  back = "/",
  backLabel = "Trang chủ",
}) {
  return (
    <main className={"wrap page " + (wide ? "" : "narrow")}>
      <div className="crumb">
        <a href={"#" + back}>{backLabel}</a>
        <ChevronRight size={14} />
        <span>{title}</span>
      </div>
      <h1>{title}</h1>
      {children}
    </main>
  );
}
export function ErrorMsg({ msg }) {
  return msg ? (
    <div role="alert" className="error">
      {msg}
    </div>
  ) : null;
}
export function Empty({ children }) {
  return <p className="empty">{children}</p>;
}
export function selectOptions(dictionary) {
  return Object.entries(dictionary).map(([k, v]) => (
    <option key={k} value={k}>
      {v}
    </option>
  ));
}
export function IntakeNotice({ report, canResubmit = false }) {
  if (
    !report ||
    (!awaitingIntake(report) && report.intake_state !== "rejected")
  )
    return null;
  const state = report.intake_state;
  // Historical rejections still have their original message in the timeline.
  if (state === "rejected" && !report.intake_note) return null;
  const duplicate = report.intake_reason === "duplicate";
  const photos = report.intake_photos || [];
  return (
    <section className={"panel intake-notice intake-" + state} role="status">
      <h2>{intakeLabels[state] || "Đã từ chối"}</h2>
      <p>
        {report.intake_note ||
          (state === "pending"
            ? "Hệ thống đang kiểm tra nội dung, ảnh và hồ sơ trùng."
            : "Cán bộ sẽ xem lại phản ánh này trước khi phân công.")}
      </p>
      {photos.length > 0 && <p>Ảnh cần xem lại: {photos.join(", ")}.</p>}
      {report.intake_reason === "possible_fire" && (
        <a href="tel:114">Gọi 114 nếu đám cháy đang xảy ra</a>
      )}
      {report.duplicate_of && (
        <a href={"#/report/" + encodeURIComponent(report.duplicate_of)}>
          Xem hồ sơ {report.duplicate_of}
        </a>
      )}
      {canResubmit && state === "rejected" && !duplicate && (
        <a
          href="#/new"
          onClick={() => {
            try {
              sessionStorage.setItem(
                "pax_resubmit_draft",
                JSON.stringify({
                  description: report.description || "",
                  location: report.location || "",
                  pin:
                    report.pin && !report.pin.approximate
                      ? { lat: report.pin.lat, lng: report.pin.lng }
                      : null,
                }),
              );
            } catch {
              // Ignore storage errors in restricted contexts
            }
          }}
        >
          Gửi lại phản ánh
        </a>
      )}
    </section>
  );
}

export function CancelledNotice({ report }) {
  if (report?.status !== "cancelled") return null;
  const reason = report.history?.find((h) => h.status === "cancelled")?.note;
  return (
    <section className="panel intake-notice intake-cancelled" role="status">
      <h2>Hồ sơ đã bị hủy</h2>
      {reason && <p>Lý do: {reason}</p>}
      <p>
        Hồ sơ này đã được gỡ khỏi trang chủ; chỉ người gửi, quản trị viên và cán bộ
        phụ trách mới xem được.
      </p>
    </section>
  );
}

export function AdviceBox({ report }) {
  if (!report) return null;
  if (
    awaitingIntake(report) ||
    report.status === "cancelled" ||
    (report.intake_state === "rejected" && report.intake_note)
  )
    return null;
  if (report.ai_state === "pending" && !report.ai_group) {
    return (
      <section className="panel advice-box advice-pending" role="status">
        <div className="advice-head">
          <Sparkles size={18} />
          <span>AI đang phân tích hồ sơ để đưa ra khuyến cáo an toàn...</span>
        </div>
      </section>
    );
  }
  const advice = report.advice;
  if (!advice) return null;
  const level = advice.level || "info";
  const Icon =
    level === "emergency"
      ? ShieldAlert
      : level === "warning"
        ? AlertTriangle
        : Info;
  const hotlines = advice.hotlines || [];
  const tips = advice.tips || [];
  return (
    <section
      className={"panel advice-box is-" + level}
      role={level === "emergency" ? "alert" : "status"}
    >
      <div className="advice-top">
        <div className="advice-head">
          <Icon size={20} />
          <h2>{advice.title}</h2>
        </div>
        {hotlines.length > 0 && (
          <div className="hotline-list">
            {hotlines.map((h) => (
              <a
                key={h.number}
                className="hotline-pill"
                href={"tel:" + String(h.number).replace(/\s+/g, "")}
                title={h.note || ""}
              >
                <Phone size={14} />
                <strong>{h.number}</strong>
                <span>{h.label}</span>
              </a>
            ))}
          </div>
        )}
      </div>
      {tips.length > 0 && (
        <ul className="advice-tips">
          {tips.map((tip, idx) => (
            <li key={idx}>{tip}</li>
          ))}
        </ul>
      )}
    </section>
  );
}
const NOTIF_TAGS = {
  assigned: "Tiếp nhận",
  processing: "Đang xử lý",
  resolved: "Đã xử lý",
  rejected: "Từ chối",
  cancelled: "Đã hủy",
  received: "Đã gửi",
  urgent: "Khẩn cấp",
};
export function NotificationMenu({ me, feed, isAdminPortal = false }) {
  const [open, setOpen] = useState(false);
  const boxRef = useRef(null);
  const storageKey = me ? "pax_seen_notif_" + me.id : "";
  const [seenAt, setSeenAt] = useState(() =>
    storageKey ? Number(localStorage.getItem(storageKey) || 0) : 0,
  );
  useEffect(() => {
    setSeenAt(storageKey ? Number(localStorage.getItem(storageKey) || 0) : 0);
  }, [storageKey]);
  useEffect(() => {
    if (!open) return;
    function onPointerDown(e) {
      if (boxRef.current && !boxRef.current.contains(e.target)) setOpen(false);
    }
    function onKeyDown(e) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);
  if (!me) return null;
  const items = feed?.items || [];
  const unreadCount = items.filter(
    (it) => (Date.parse(it.created_at) || 0) > seenAt,
  ).length;
  const urgentCount = feed?.urgent_count ?? 0;
  const badgeCount =
    me.role === "citizen"
      ? seenAt > 0
        ? unreadCount
        : Math.min(items.length, 9)
      : urgentCount > 0
        ? urgentCount
        : unreadCount;
  function markSeen() {
    if (!storageKey) return;
    const latest = Math.max(
      Date.now(),
      ...items.map((it) => Date.parse(it.created_at) || 0),
    );
    localStorage.setItem(storageKey, String(latest));
    setSeenAt(latest);
  }
  function toggleOpen() {
    const next = !open;
    setOpen(next);
    if (next) markSeen();
  }
  return (
    <div className="notif-menu" ref={boxRef}>
      <button
        type="button"
        className="notification-link icon-btn"
        aria-label={
          me.role === "citizen"
            ? "Thông báo của bạn, " + badgeCount + " cập nhật"
            : "Thông báo nội bộ, " + urgentCount + " hồ sơ cần xem xét sớm"
        }
        aria-expanded={open}
        onClick={toggleOpen}
      >
        <Bell size={18} />
        {badgeCount > 0 && <i>{badgeCount}</i>}
      </button>
      {open && (
        <div
          className="notif-dropdown"
          role="region"
          aria-label="Danh sách thông báo"
        >
          <div className="notif-head">
            <strong>
              {me.role === "citizen" ? "Thông báo hồ sơ của bạn" : "Thông báo"}
            </strong>
            {items.length > 0 && (
              <button type="button" onClick={markSeen}>
                Đã xem
              </button>
            )}
          </div>
          <div className="notif-list">
            {items.length === 0 ? (
              <p className="notif-empty">Chưa có thông báo mới.</p>
            ) : (
              items.map((item) => (
                <a
                  key={item.id}
                  href={"#/report/" + item.report_id}
                  className={"notif-item kind-" + (item.kind || "received")}
                  onClick={() => setOpen(false)}
                >
                  <span className="notif-tag">
                    {NOTIF_TAGS[item.kind] || "Cập nhật"}
                  </span>
                  <div>
                    <b>{item.title}</b>
                    {item.detail && <p>{item.detail}</p>}
                    {item.created_at && (
                      <small>{dateText(item.created_at)}</small>
                    )}
                  </div>
                </a>
              ))
            )}
          </div>
          <div className="notif-foot">
            {me.role === "citizen" ? (
              <a
                className="notif-all-link"
                href="#/track"
                onClick={() => setOpen(false)}
              >
                Xem tất cả hồ sơ của tôi
              </a>
            ) : (
              <a
                className="notif-all-link"
                href={
                  isAdminPortal ? "#/admin?tab=notice" : "#/desk?tab=notice"
                }
                onClick={() => setOpen(false)}
              >
                Hồ sơ cần xem sớm ({urgentCount})
              </a>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
export function UserMenu({ me, logout, isAdminPortal = false }) {
  const [open, setOpen] = useState(false);
  const boxRef = useRef(null);
  useEffect(() => {
    function onHashChange() {
      setOpen(false);
    }
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);
  useEffect(() => {
    if (!open) return;
    function onPointerDown(e) {
      if (boxRef.current && !boxRef.current.contains(e.target)) setOpen(false);
    }
    function onKeyDown(e) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);
  if (!me) return null;
  return (
    <div className="user-menu" ref={boxRef}>
      <button
        type="button"
        className="identity user-menu-trigger"
        aria-haspopup="true"
        aria-expanded={open}
        aria-label={"Tài khoản " + me.name}
        onClick={() => setOpen((v) => !v)}
      >
        <span className="user-trigger-avatar">
          <UserRound size={16} />
        </span>
        <span className="user-trigger-name">{me.name}</span>
        <ChevronDown
          size={15}
          className={"user-trigger-chevron" + (open ? " is-open" : "")}
        />
      </button>
      {open && (
        <div
          className="user-dropdown"
          role="region"
          aria-label="Menu tài khoản"
        >
          <div className="user-dropdown-head">
            <span className="user-dropdown-avatar">
              <UserRound size={20} />
            </span>
            <div className="user-dropdown-meta">
              <div className="user-dropdown-title">
                <strong>{me.name}</strong>
                <span className={"role-badge " + me.role}>
                  {roles[me.role] || me.role}
                </span>
              </div>
              <small>{me.email}</small>
            </div>
          </div>
          <div className="user-dropdown-list">
            {!isAdminPortal && me.role === "admin" && (
              <a
                href="#/admin"
                className="user-dropdown-item"
                onClick={() => setOpen(false)}
              >
                <LayoutDashboard size={16} aria-hidden="true" />
                Vào quản trị
              </a>
            )}
            {!isAdminPortal && me.role === "staff" && (
              <>
                <a
                  href="#/desk"
                  className="user-dropdown-item"
                  onClick={() => setOpen(false)}
                >
                  <LayoutDashboard size={16} aria-hidden="true" />
                  Bàn làm việc cán bộ
                </a>
                <a
                  href="#/desk?tab=map"
                  className="user-dropdown-item"
                  onClick={() => setOpen(false)}
                >
                  <MapIcon size={16} aria-hidden="true" />
                  Bản đồ khu vực
                </a>
              </>
            )}
            {!isAdminPortal && me.role === "citizen" && (
              <a
                href="#/track"
                className="user-dropdown-item"
                onClick={() => setOpen(false)}
              >
                <ClipboardList size={16} aria-hidden="true" />
                Hồ sơ của tôi
              </a>
            )}
            <a
              href="#/profile"
              className="user-dropdown-item"
              onClick={() => setOpen(false)}
            >
              <UserRound size={16} aria-hidden="true" />
              Thông tin cá nhân
            </a>
          </div>
          <div className="user-dropdown-foot">
            <button
              type="button"
              className="user-dropdown-item user-logout-btn"
              onClick={() => {
                setOpen(false);
                logout();
              }}
            >
              <LogOut size={16} />
              <span>Đăng xuất</span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
