import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  Sparkles,
  Download,
  AlertTriangle,
  ExternalLink,
  LayoutDashboard,
  Users,
  BarChart3,
  ClipboardList,
  UserCog,
  KeyRound,
  Map as MapIcon,
  Inbox,
  MapPinned,
  FileText,
  Menu,
  X,
  Search,
  CircleCheck,
  Clock3,
  Shield,
  Lock,
  Repeat,
} from "lucide-react";
import {
  adminSection,
  api,
  groups,
  staffSection,
  statuses,
  roles,
  dateText,
} from "./domain";
import { Group, ErrorMsg, NotificationMenu, UserMenu } from "./ui";
import { AreaChips, AreaPicker } from "./areas";

export const PLAYBOOKS_CLIENT = {
  waste: "Công ty MTV Môi trường Đô thị TP.HCM (CITENCO) & UBND phường/xã",
  water: "Trung tâm Quản lý Hạ tầng Kỹ thuật TP.HCM & Phòng TN&MT",
  dust: "Thanh tra Sở Xây dựng & Phòng TN&MT TP.HCM",
  noise: "UBND & Công an phường/xã phụ trách địa bàn",
  flood: "Trung tâm Quản lý Hạ tầng Kỹ thuật & Công ty Thoát nước Đô thị",
  tree: "Công ty TNHH MTV Công viên Cây xanh TP.HCM",
  hazard: "Phòng Cảnh sát PCCC & CNCH (PC07) & Chi cục BVMT TP.HCM",
  other: "UBND phường/xã & Tổ quản lý trật tự đô thị",
};

const RECURRING_MEASURES = {
  waste:
    "Gắn biển cấm đổ rác, bố trí thùng thu gom và tuần tra/lắp camera khung giờ tối.",
  water:
    "Truy nguồn xả thải cố định quanh khu vực và lấy mẫu kiểm tra định kỳ.",
  dust:
    "Kiểm tra tái phạm của công trình/bãi vật liệu và xử phạt nếu thiếu che chắn.",
  noise:
    "Phối hợp Công an khu vực kiểm tra định kỳ sau 22 giờ và xử lý tái phạm.",
  flood:
    "Khảo sát nâng cấp miệng thu nước, nạo vét hố ga định kỳ trước triều cường.",
  tree:
    "Kiểm tra tổng thể hàng cây cùng tuyến để tỉa tán, chống nghiêng đồng bộ.",
  hazard:
    "Rà soát nguồn phát sinh chất thải nguy hại lân cận và kiểm soát giao thông khu vực.",
  other:
    "Giao tổ trật tự đô thị phường giám sát định kỳ để tránh lấn chiếm trở lại.",
};

function haversineMeters(a, b) {
  const toRad = (deg) => (deg * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const s1 = Math.sin(dLat / 2);
  const s2 = Math.sin(dLng / 2);
  const h =
    s1 * s1 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * s2 * s2;
  return 6371000 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

function normPlace(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replaceAll("đ", "d")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export function detectRecurringHotspots(reports, radiusM = 250) {
  const valid = [...(reports || [])]
    .filter((r) => !["rejected", "cancelled"].includes(r.status))
    .sort(
      (a, b) => Date.parse(b.created_at || 0) - Date.parse(a.created_at || 0),
    );
  const clusters = [];
  for (const r of valid) {
    const rawGroup = r.confirmed_group || r.ai_group || "other";
    const group = groups[rawGroup] ? rawGroup : "other";
    const pin =
      r.pin &&
      Number.isFinite(Number(r.pin.lat)) &&
      Number.isFinite(Number(r.pin.lng))
        ? { lat: Number(r.pin.lat), lng: Number(r.pin.lng) }
        : null;
    const ward = r.ward || "";
    const locNorm = normPlace(r.location);
    let matched = null;
    for (const c of clusters) {
      if (c.group !== group) continue;
      if (pin && c.pin) {
        if (haversineMeters(pin, c.pin) <= radiusM) {
          matched = c;
          break;
        }
      } else if (locNorm && c.locNorm && locNorm === c.locNorm) {
        matched = c;
        break;
      } else if (ward && ward === c.ward && !pin && !c.pin) {
        matched = c;
        break;
      }
    }
    if (!matched) {
      matched = {
        key: `${group}-${clusters.length}`,
        group,
        pin,
        ward,
        locNorm,
        location: r.location || ward || "Khu vực TP.HCM",
        items: [],
      };
      clusters.push(matched);
    }
    matched.items.push(r);
  }
  return clusters
    .map((c) => {
      const totalCount = c.items.length;
      const resolvedCount = c.items.filter(
        (x) => x.status === "resolved",
      ).length;
      const openCount = c.items.filter((x) =>
        ["received", "processing"].includes(x.status),
      ).length;
      if (!((resolvedCount >= 1 && totalCount >= 2) || totalCount >= 3)) {
        return null;
      }
      return {
        key: c.key,
        group: c.group,
        groupLabel: groups[c.group] || groups.other,
        ward: c.ward,
        location: c.location,
        totalCount,
        resolvedCount,
        openCount,
        items: c.items,
        statusLabel:
          resolvedCount >= 1 && openCount >= 1
            ? "Tái diễn sau xử lý"
            : "Lặp lại nhiều lần",
        measure: RECURRING_MEASURES[c.group] || RECURRING_MEASURES.other,
      };
    })
    .filter(Boolean)
    .sort(
      (a, b) =>
        Number(b.openCount > 0 && b.resolvedCount > 0) -
          Number(a.openCount > 0 && a.resolvedCount > 0) ||
        b.openCount - a.openCount ||
        b.totalCount - a.totalCount,
    )
    .slice(0, 6);
}

export function RecurringHotspotsPanel({ reports, fromRoute = "/admin" }) {
  const hotspots = useMemo(
    () => detectRecurringHotspots(reports),
    [reports],
  );
  return (
    <section
      className="work-panel"
      aria-label="Điểm nóng tái diễn"
    >
      <div className="work-panel-heading">
        <h2>Điểm nóng tái diễn ({hotspots.length})</h2>
      </div>
      <div className="work-panel-body">
        {!hotspots.length ? (
          <p className="empty">
            Chưa phát hiện điểm nóng tái diễn cùng vị trí và nhóm sự cố.
          </p>
        ) : (
          <ul className="recurring-list">
            {hotspots.map((item) => (
              <li className="recurring-item" key={item.key}>
                <div className="recurring-head">
                  <div>
                    <strong>{item.location}</strong>
                    {item.ward && item.ward !== item.location && (
                      <small>{item.ward}</small>
                    )}
                  </div>
                  <div className="report-badges">
                    <span className="badge urgent">
                      <Repeat size={12} aria-hidden="true" />
                      {item.statusLabel}
                    </span>
                    <span className="badge score">
                      {item.groupLabel} · {item.totalCount} lần
                    </span>
                  </div>
                </div>
                <p className="recurring-summary">
                  {item.openCount} hồ sơ đang mở · {item.resolvedCount} hồ sơ đã
                  xử lý trước đó
                </p>
                <p className="recurring-measure">
                  <strong>Biện pháp căn cơ:</strong> {item.measure}
                </p>
                <div className="recurring-links">
                  {item.items.slice(0, 3).map((r) => (
                    <a
                      key={r.id}
                      href={
                        "#/report/" +
                        encodeURIComponent(r.id) +
                        "?from=" +
                        encodeURIComponent(fromRoute)
                      }
                    >
                      {r.id}
                    </a>
                  ))}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

export function leastBusyStaff(staff, reports, ward) {
  const active = (staff || []).filter((u) => u.active);
  if (!active.length) return null;
  const local = ward ? active.filter((u) => u.areas?.includes(ward)) : [];
  const pool = local.length ? local : active;
  const open = (reports || []).filter(
    (r) => !["resolved", "rejected", "cancelled"].includes(r.status),
  );
  return pool
    .map((u) => ({
      ...u,
      openCount: open.filter((r) => r.assignee === u.id).length,
      totalCount: (reports || []).filter((r) => r.assignee === u.id).length,
    }))
    .sort(
      (a, b) =>
        a.openCount - b.openCount ||
        a.totalCount - b.totalCount ||
        a.name.localeCompare(b.name, "vi"),
    )[0];
}

export function urgencyScore(report, wardCounts) {
  const group = report.confirmed_group || report.ai_group || "other";
  const groupWeight = { hazard: 20, flood: 12, water: 12 };
  const nearby = Math.max(0, (wardCounts.get(report.ward) || 1) - 1);
  return Math.min(
    100,
    (report.urgent ? 40 : 0) +
      (report.priority === "high" ? 25 : 0) +
      (groupWeight[group] ?? 5) +
      (report.assignee ? 0 : 10) +
      Math.min(15, 5 * nearby),
  );
}

export function AdminReportBadges({ r, staffMap, score }) {
  const officer = r.assignee ? staffMap.get(r.assignee)?.name : null;
  return (
    <div className="report-badges">
      <Group
        value={r.confirmed_group || r.ai_group}
        suggested={!r.confirmed_group && Boolean(r.ai_group)}
      />
      {(r.urgent || r.priority === "high") &&
        !["rejected", "cancelled"].includes(r.status) && (
          <span className="badge urgent">
            <AlertTriangle size={12} /> Cần xem sớm
          </span>
        )}
      {!["rejected", "cancelled"].includes(r.status) && (
        <span className={"badge " + (officer ? "assigned" : "unassigned")}>
          {officer || "Chưa phân công"}
        </span>
      )}
      {typeof score === "number" && (
        <span className="badge score">Mức cấp thiết {score}/100</span>
      )}
    </div>
  );
}

export function AdminBriefing() {
  const [brief, setBrief] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function requestBriefing() {
    setBusy(true);
    setError("");
    try {
      setBrief(await api("/admin/ai-briefing", "POST"));
    } catch (exception) {
      setError(exception.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="work-brief-body">
      <button
        type="button"
        className="btn outline small"
        onClick={requestBriefing}
        disabled={busy}
      >
        <Sparkles size={15} aria-hidden="true" />
        {busy ? "Đang tổng hợp…" : "Xem gợi ý AI"}
      </button>
      <ErrorMsg msg={error} />
      {brief && (
        <ul>
          {brief.recommendations?.map((item, index) => (
            <li key={index}>{item}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function AdminAiStats({ reports }) {
  const deepseekCount = reports.filter(
    (r) => r.ai_source === "deepseek",
  ).length;
  const clipCount = reports.filter((r) => r.ai_source === "clip").length;
  const rejectedCount = reports.filter((r) => r.status === "rejected").length;
  const pendingCount = reports.filter((r) => r.ai_state === "pending").length;

  function downloadCsv() {
    const header = [
      "Mã hồ sơ",
      "Tiêu đề",
      "Nhóm",
      "Trạng thái",
      "Ưu tiên",
      "Khẩn cấp",
      "Nguồn AI",
      "Phường/Xã",
      "Địa điểm",
      "Ngày tạo",
    ];
    const esc = (value) => {
      const cell = String(value ?? "").replace(/[\r\n]+/g, " ");
      const safe = /^\s*[=+@-]|^[\t\r]/.test(cell) ? "'" + cell : cell;
      return '"' + safe.replaceAll('"', '""') + '"';
    };
    const rows = reports.map((r) => [
      r.id,
      r.title,
      groups[r.confirmed_group || r.ai_group] || "Chờ xác nhận",
      statuses[r.status] || r.status,
      r.priority === "high" ? "Cao" : "Thông thường",
      r.urgent ? "Có" : "Không",
      r.ai_source === "deepseek"
        ? "Chuyên sâu"
        : r.ai_source === "clip"
          ? "Tự động"
          : "",
      r.ward || "",
      r.location,
      dateText(r.created_at),
    ]);
    const csv =
      "\uFEFF" +
      [header, ...rows].map((line) => line.map(esc).join(",")).join("\r\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "phan-anh-xanh-tphcm.csv";
    link.click();
    URL.revokeObjectURL(url);
  }

  return (
    <section className="work-panel">
      <div className="work-panel-heading">
        <h2>Tổng hợp phân loại &amp; Xuất dữ liệu</h2>
        <button
          type="button"
          className="btn outline small"
          onClick={downloadCsv}
        >
          <Download size={16} /> Tải CSV
        </button>
      </div>
      <div className="work-panel-body">
        <div className="work-metrics work-metrics-4">
          <div className="work-metric">
            <span>
              <CircleCheck size={17} aria-hidden="true" />
              Tự động phân loại
            </span>
            <strong>{clipCount}</strong>
          </div>
          <div className="work-metric" data-tone="done">
            <span>
              <Sparkles size={17} aria-hidden="true" />
              Phân tích chuyên sâu
            </span>
            <strong>{deepseekCount}</strong>
          </div>
          <div className="work-metric" data-tone="urgent">
            <span>
              <AlertTriangle size={17} aria-hidden="true" />
              Đã từ chối
            </span>
            <strong>{rejectedCount}</strong>
          </div>
          <div className="work-metric" data-tone="working">
            <span>
              <Clock3 size={17} aria-hidden="true" />
              Chờ phân loại
            </span>
            <strong>{pendingCount}</strong>
          </div>
        </div>
      </div>
    </section>
  );
}

const adminLinks = [
  ["/admin", LayoutDashboard, "Tổng quan", "overview"],
  ["/admin?tab=reports", ClipboardList, "Hồ sơ", "reports"],
  ["/admin?tab=staff", UserCog, "Cán bộ", "staff"],
  ["/admin?tab=users", Users, "Tài khoản", "users"],
  ["/admin?tab=stats", BarChart3, "Thống kê", "stats"],
  ["/admin?tab=news", FileText, "Tin môi trường", "news"],
];
const staffLinks = [
  ["/desk", LayoutDashboard, "Tổng quan", "overview"],
  ["/desk?tab=map", MapIcon, "Bản đồ khu vực", "map"],
  ["/desk?tab=reports", ClipboardList, "Hồ sơ khu vực", "reports"],
  ["/desk?tab=review", Inbox, "Chờ duyệt", "review"],
  ["/desk?tab=notice", AlertTriangle, "Cần xem sớm", "notice"],
];

export function AdminShell({ me, logout, noticeFeed, hash, children }) {
  const [open, setOpen] = useState(false);
  const toggle = useRef(null);
  const sidebar = useRef(null);
  const staff = me.role === "staff";
  const links = staff ? staffLinks : adminLinks;
  const active = staff ? staffSection(hash) : adminSection(hash);
  const home = staff ? "#/desk" : "#/admin";
  const portal = staff ? "Bàn làm việc cán bộ" : "Quản trị";
  const title = hash.startsWith("/report/")
    ? "Chi tiết hồ sơ"
    : active === "profile"
      ? "Thông tin cá nhân"
      : links.find((link) => link[3] === active)[2];
  useEffect(() => {
    setOpen(false);
  }, [hash]);
  useEffect(() => {
    if (open)
      sidebar.current?.querySelector('[aria-current="page"], nav a')?.focus();
  }, [open]);

  function dismissDrawer() {
    setOpen(false);
    toggle.current?.focus();
  }

  return (
    <div
      className="admin-layout work-shell"
      onKeyDown={(event) => {
        if (event.key === "Escape" && open) dismissDrawer();
      }}
    >
      <div className="admin-main">
        <header className="admin-topbar">
          <div className="admin-topbar-title">
            <button
              type="button"
              ref={toggle}
              className="icon-btn work-menu-toggle"
              aria-label={
                staff
                  ? open
                    ? "Đóng menu cán bộ"
                    : "Mở menu cán bộ"
                  : open
                    ? "Đóng menu quản trị"
                    : "Mở menu quản trị"
              }
              aria-controls="admin-sidebar"
              aria-expanded={open}
              onClick={() => setOpen(!open)}
            >
              {open ? <X size={20} /> : <Menu size={20} />}
            </button>
            <span>{title}</span>
          </div>
          <div className="admin-topbar-actions">
            <NotificationMenu
              me={me}
              feed={noticeFeed}
              isAdminPortal={!staff}
            />
            <UserMenu me={me} logout={logout} isAdminPortal />
          </div>
        </header>
        <div id="content" className="admin-content">
          {children}
        </div>
      </div>
      {open && (
        <div
          className="work-scrim"
          aria-hidden="true"
          onClick={dismissDrawer}
        />
      )}
      <aside
        ref={sidebar}
        id="admin-sidebar"
        className={"admin-sidebar" + (open ? " is-open" : "")}
      >
        <a
          className="admin-brand"
          href={home}
          onClick={() => setOpen(false)}
        >
          <img src="/images/logo.png" alt="" />
          <span>
            <b>Phản Ánh Xanh</b>
            <small>{portal}</small>
          </span>
        </a>
        <nav
          className="admin-nav"
          aria-label={staff ? "Điều hướng cán bộ" : "Điều hướng quản trị"}
        >
          {links.map(([href, Icon, label, key]) => (
            <a
              key={key}
              href={"#" + href}
              className={active === key ? "active" : ""}
              aria-current={active === key ? "page" : undefined}
              onClick={() => setOpen(false)}
            >
              <Icon size={17} aria-hidden="true" />
              <span>{label}</span>
            </a>
          ))}
        </nav>
        <a className="admin-public-link" href="#/">
          <ExternalLink size={16} aria-hidden="true" />
          <span>Về trang chủ</span>
        </a>
      </aside>
    </div>
  );
}

export function AdminUsersTab({ currentUser, onChanged }) {
  const [users, setUsers] = useState(null);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [q, setQ] = useState("");
  const [roleFilter, setRoleFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [pwUserId, setPwUserId] = useState(null);
  const [areaUserId, setAreaUserId] = useState(null);
  const [areaDraft, setAreaDraft] = useState([]);
  const [newAreas, setNewAreas] = useState([]);
  const [newRole, setNewRole] = useState("staff");
  const [pwValue, setPwValue] = useState("");
  const [rev, setRev] = useState(0);

  useEffect(() => {
    let live = true;
    setErr("");
    api("/admin/users")
      .then((d) => {
        if (live) setUsers(d);
      })
      .catch((ex) => {
        if (live) setErr(ex.message);
      });
    return () => {
      live = false;
    };
  }, [rev]);

  const reload = () => {
    setRev((n) => n + 1);
    onChanged?.();
  };

  async function createUser(e) {
    e.preventDefault();
    const form = e.currentTarget;
    setBusy(true);
    setErr("");
    setMessage("");
    try {
      const payload = Object.fromEntries(new FormData(form));
      payload.areas = payload.role === "staff" ? newAreas : [];
      await api("/admin/users", "POST", payload);
      form.reset();
      setNewAreas([]);
      setNewRole("staff");
      setMessage("Đã tạo tài khoản mới.");
      reload();
    } catch (ex) {
      setErr(ex.message);
    } finally {
      setBusy(false);
    }
  }

  async function patchUser(u, payload, msg) {
    setBusy(true);
    setErr("");
    setMessage("");
    try {
      await api("/admin/users/" + u.id, "PATCH", payload);
      setMessage(msg);
      reload();
    } catch (ex) {
      setErr(ex.message);
    } finally {
      setBusy(false);
    }
  }

  async function savePassword(e, u) {
    e.preventDefault();
    if (!pwValue || pwValue.length < 8) return;
    await patchUser(
      u,
      { password: pwValue },
      "Đã đặt lại mật khẩu cho " + u.email + ".",
    );
    setPwUserId(null);
    setPwValue("");
  }

  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    return (users || []).filter(
      (u) =>
        (!roleFilter || u.role === roleFilter) &&
        (!statusFilter || (statusFilter === "active" ? u.active : !u.active)) &&
        (!term ||
          u.name.toLowerCase().includes(term) ||
          u.email.toLowerCase().includes(term)),
    );
  }, [users, q, roleFilter, statusFilter]);

  const counts = useMemo(() => {
    const list = users || [];
    return {
      admin: list.filter((u) => u.role === "admin").length,
      staff: list.filter((u) => u.role === "staff").length,
      citizen: list.filter((u) => u.role === "citizen").length,
      locked: list.filter((u) => !u.active).length,
    };
  }, [users]);

  return (
    <div className="admin-users-tab">
      <div className="work-metrics work-metrics-4" aria-label="Tổng quan tài khoản">
        <div className="work-metric" data-tone="done">
          <span>
            <Shield size={17} aria-hidden="true" />
            Quản trị viên
          </span>
          <strong>{counts.admin}</strong>
        </div>
        <div className="work-metric" data-tone="working">
          <span>
            <UserCog size={17} aria-hidden="true" />
            Cán bộ hiện trường
          </span>
          <strong>{counts.staff}</strong>
        </div>
        <div className="work-metric">
          <span>
            <Users size={17} aria-hidden="true" />
            Tài khoản người dân
          </span>
          <strong>{counts.citizen}</strong>
        </div>
        <div className="work-metric" data-tone="urgent">
          <span>
            <Lock size={17} aria-hidden="true" />
            Đang bị khóa
          </span>
          <strong>{counts.locked}</strong>
        </div>
      </div>

      <section className="work-panel">
        <div className="work-panel-heading">
          <h2>Tạo tài khoản &amp; Phân quyền mới</h2>
        </div>
        <div className="work-panel-body">
          <form onSubmit={createUser} className="form staff-form">
            <label>
              Họ và tên
              <input name="name" required maxLength={80} />
            </label>
            <label>
              Email
              <input type="email" name="email" required />
            </label>
            <label>
              Mật khẩu ban đầu
              <input
                type="password"
                name="password"
                required
                minLength={8}
                maxLength={128}
              />
            </label>
            <label>
              Vai trò
              <select
                name="role"
                defaultValue="staff"
                aria-label="Vai trò tài khoản mới"
                onChange={(e) => setNewRole(e.target.value)}
              >
                <option value="citizen">Người dân</option>
                <option value="staff">Cán bộ</option>
                <option value="admin">Quản trị viên</option>
              </select>
            </label>
            {newRole === "staff" && (
              <div className="field-title area-field">
                Khu vực phụ trách
                <AreaPicker value={newAreas} onChange={setNewAreas} />
              </div>
            )}
            <button disabled={busy} className="btn green">
              Tạo tài khoản
            </button>
          </form>
          <ErrorMsg msg={err} />
          {message && (
            <p className="assist-head" aria-live="polite">
              {message}
            </p>
          )}
        </div>
      </section>

      <section className="work-panel">
        <div className="work-panel-heading">
          <h2>Tài khoản ({filtered.length})</h2>
        </div>
        <div className="work-filters work-filters-3">
          <label className="work-search">
            <Search size={17} aria-hidden="true" />
            <input
              type="search"
              aria-label="Tìm người dùng"
              placeholder="Tìm theo tên hoặc email…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
          </label>
          <label>
            Vai trò
            <select
              aria-label="Lọc theo vai trò"
              value={roleFilter}
              onChange={(e) => setRoleFilter(e.target.value)}
            >
              <option value="">Tất cả vai trò</option>
              <option value="admin">Quản trị viên</option>
              <option value="staff">Cán bộ</option>
              <option value="citizen">Người dân</option>
            </select>
          </label>
          <label>
            Trạng thái
            <select
              aria-label="Lọc theo trạng thái tài khoản"
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
            >
              <option value="">Tất cả trạng thái</option>
              <option value="active">Hoạt động</option>
              <option value="locked">Tạm khóa</option>
            </select>
          </label>
        </div>

        <div className="work-panel-body">
          {!users ? (
            <p>Đang tải danh sách người dùng…</p>
          ) : !filtered.length ? (
            <p className="empty">Không có tài khoản phù hợp.</p>
          ) : (
            <div className="user-mgmt-list">
              {filtered.map((u) => {
                const isSelf = u.id === currentUser.id;
                const rejectedNote =
                  u.rejected_count > 0 ? ` · Đã từ chối: ${u.rejected_count}` : "";
                return (
                  <div className="user-row" key={u.id}>
                    <div className="user-info">
                      <div className="user-title-row">
                        <b>{u.name}</b>
                        <span className={"role-badge " + u.role}>
                          {roles[u.role] || u.role}
                        </span>
                        <span
                          className={
                            "badge " + (u.active ? "assigned" : "urgent")
                          }
                        >
                          {u.active ? "Hoạt động" : "Tạm khóa"}
                        </span>
                      </div>
                      <small>{u.email}</small>
                      <small>
                        {u.role === "citizen"
                          ? `Đã gửi: ${u.submitted_count ?? 0} hồ sơ${rejectedNote}`
                          : `Đang phụ trách: ${u.assigned_open_count ?? 0} · Đã xử lý: ${u.assigned_resolved_count ?? 0} · Đã gửi: ${u.submitted_count ?? 0}${rejectedNote}`}
                      </small>
                      {u.role === "staff" && (
                        <div className="user-areas">
                          <AreaChips areas={u.areas} />
                        </div>
                      )}
                    </div>
                    <div className="user-controls">
                      <select
                        aria-label={"Phân quyền " + u.email}
                        value={u.role}
                        disabled={busy || isSelf}
                        onChange={(e) =>
                          patchUser(
                            u,
                            { role: e.target.value },
                            `Đã đổi vai trò ${u.email} thành ${roles[e.target.value]}.`,
                          )
                        }
                      >
                        <option value="citizen">Người dân</option>
                        <option value="staff">Cán bộ</option>
                        <option value="admin">Quản trị viên</option>
                      </select>
                      {u.role === "staff" && (
                        <button
                          type="button"
                          className="btn outline small"
                          disabled={busy}
                          onClick={() => {
                            setAreaUserId(areaUserId === u.id ? null : u.id);
                            setAreaDraft(u.areas || []);
                          }}
                        >
                          <MapPinned size={14} /> Khu vực
                        </button>
                      )}
                      <button
                        type="button"
                        className="btn outline small"
                        disabled={busy}
                        onClick={() => {
                          setPwUserId(pwUserId === u.id ? null : u.id);
                          setPwValue("");
                        }}
                      >
                        <KeyRound size={14} /> Đổi mật khẩu
                      </button>
                      <button
                        type="button"
                        className="btn outline small"
                        disabled={busy || isSelf}
                        title={
                          isSelf
                            ? "Không thể tự khóa tài khoản đang đăng nhập"
                            : undefined
                        }
                        onClick={() =>
                          patchUser(
                            u,
                            { active: !u.active },
                            `${u.active ? "Đã khóa" : "Đã mở khóa"} tài khoản ${u.email}.`,
                          )
                        }
                      >
                        {u.active ? "Tạm khóa" : "Kích hoạt"}
                      </button>
                    </div>
                    {(areaUserId === u.id || pwUserId === u.id) && (
                      <div className="user-row-drawer">
                        {u.role === "staff" && areaUserId === u.id && (
                          <div className="area-editor">
                            <AreaPicker
                              value={areaDraft}
                              onChange={setAreaDraft}
                              disabled={busy}
                            />
                            <div className="area-editor-actions">
                              <button
                                type="button"
                                className="btn green small"
                                disabled={busy}
                                onClick={async () => {
                                  await patchUser(
                                    u,
                                    { areas: areaDraft },
                                    "Đã cập nhật khu vực của " + u.email + ".",
                                  );
                                  setAreaUserId(null);
                                }}
                              >
                                Lưu khu vực
                              </button>
                              <button
                                type="button"
                                className="btn outline small"
                                onClick={() => setAreaUserId(null)}
                              >
                                Hủy
                              </button>
                            </div>
                          </div>
                        )}
                        {pwUserId === u.id && (
                          <form
                            className="pw-inline-form"
                            onSubmit={(e) => savePassword(e, u)}
                          >
                            <input
                              type="password"
                              minLength={8}
                              maxLength={128}
                              required
                              placeholder="Mật khẩu mới (≥ 8 ký tự)"
                              value={pwValue}
                              onChange={(e) => setPwValue(e.target.value)}
                            />
                            <button className="btn green small" disabled={busy}>
                              Lưu
                            </button>
                            <button
                              type="button"
                              className="btn outline small"
                              onClick={() => {
                                setPwUserId(null);
                                setPwValue("");
                              }}
                            >
                              Hủy
                            </button>
                          </form>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
