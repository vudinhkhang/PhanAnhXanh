import React, {
  lazy,
  Suspense,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  AlertCircle,
  Search,
  Map as MapIcon,
  List,
  MapPin,
  CircleCheck,
  ClipboardCheck,
  Clock3,
  Inbox,
  Navigation,
  Sparkles,
  RefreshCw,
  UserCheck,
  X,
  ChevronLeft,
  ChevronRight,
  ImagePlus,
} from "lucide-react";
import {
  adminSection,
  api,
  awaitingIntake,
  communityPath,
  groups,
  isClosed,
  staffSection,
  statuses,
  priorities,
  dateText,
} from "./domain";
import { AreaChips, AreaPicker, reportAreas, shortArea } from "./areas";
import {
  Page,
  Cards,
  Status,
  Empty,
  ErrorMsg,
  selectOptions,
  Stats,
  AdviceBox,
  CancelledNotice,
  IntakeNotice,
} from "./ui";
import {
  AdminReportBadges,
  AdminAiStats,
  AdminUsersTab,
  RecurringHotspotsPanel,
  leastBusyStaff,
  urgencyScore,
  PLAYBOOKS_CLIENT,
} from "./admin";
import { AdminOverview, AdminQueue } from "./admin-work";
import { readImage } from "./forms";
const AdminNews = lazy(() => import("./admin-news"));
const CommunityMap = lazy(() =>
  import("./maps").then((m) => ({ default: m.CommunityMap })),
);
const FieldMap = lazy(() =>
  import("./maps").then((m) => ({ default: m.FieldMap })),
);
const StaffFieldMap = lazy(() =>
  import("./maps").then((m) => ({ default: m.StaffFieldMap })),
);
export function useResource(path) {
  const [data, setData] = useState(null),
    [error, setError] = useState(""),
    [revision, setRevision] = useState(0);
  useEffect(() => {
    if (!path) return;
    let live = true;
    setError("");
    api(path)
      .then((d) => {
        if (live) setData(d);
      })
      .catch((e) => {
        if (live) setError(e.message);
      });
    return () => {
      live = false;
    };
  }, [path, revision]);
  return [data, error, () => setRevision((s) => s + 1)];
}
function Filters({
  items, children, initialGroup = "", statusOptions = statuses,
  ward = "", onWardChange,
}) {
  const [group, setGroup] = useState(initialGroup),
    [status, setStatus] = useState(""),
    [q, setQ] = useState("");
  const filtered = items.filter(
    (r) =>
      (!ward || r.ward === ward) &&
      (!group || (r.confirmed_group || r.ai_group) === group) &&
      (!status || r.status === status) &&
      [r.title, r.location, r.ward, r.id]
        .join(" ")
        .toLocaleLowerCase("vi")
        .includes(q.toLocaleLowerCase("vi").trim()),
  );
  const wards = onWardChange ? reportAreas(items) : [];
  return (
    <>
      <div className="filters">
        <label className="search">
          <Search size={18} />
          <input
            aria-label="Tìm kiếm phản ánh"
            placeholder="Tìm theo địa điểm, nội dung, mã hồ sơ…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </label>
        <select
          aria-label="Lọc theo trạng thái"
          value={status}
          onChange={(e) => setStatus(e.target.value)}
        >
          <option value="">Tất cả trạng thái</option>
          {selectOptions(statusOptions)}
        </select>
        <select
          aria-label="Lọc theo nhóm"
          value={group}
          onChange={(e) => setGroup(e.target.value)}
        >
          <option value="">Tất cả nhóm</option>
          {selectOptions(groups)}
        </select>
        {onWardChange && (
          <select aria-label="Lọc theo phường/xã" value={ward} onChange={(e) => onWardChange(e.target.value)}>
            <option value="">Tất cả phường/xã</option>
            {ward && !wards.includes(ward) && <option value={ward}>{shortArea(ward)}</option>}
            {wards.map((area) => <option key={area} value={area}>{shortArea(area)}</option>)}
          </select>
        )}
      </div>
      {filtered.length ? (
        children(filtered)
      ) : (
        <Empty>Chưa có phản ánh phù hợp.</Empty>
      )}
    </>
  );
}
function PagedCards({ rows, pageSize = 12 }) {
  const [page, setPage] = useState(1);
  const pageCount = Math.max(1, Math.ceil(rows.length / pageSize));
  const current = Math.min(page, pageCount);
  useEffect(() => {
    setPage(1);
  }, [rows.length]);
  const visible = rows.slice((current - 1) * pageSize, current * pageSize);
  return (
    <>
      <Cards reports={visible} />
      {pageCount > 1 && (
        <nav className="work-pagination community-pagination" aria-label="Phân trang phản ánh">
          <button
            type="button"
            className="icon-btn"
            aria-label="Trang trước"
            disabled={current === 1}
            onClick={() => setPage(current - 1)}
          >
            <ChevronLeft size={18} />
          </button>
          <span>
            Trang {current} / {pageCount} ({rows.length} phản ánh)
          </span>
          <button
            type="button"
            className="icon-btn"
            aria-label="Trang sau"
            disabled={current === pageCount}
            onClick={() => setPage(current + 1)}
          >
            <ChevronRight size={18} />
          </button>
        </nav>
      )}
    </>
  );
}
export function Community({ reports, mapView, group = "", ward = "" }) {
  function changeView(showMap) {
    location.hash = communityPath({ mapView: showMap, group, ward });
  }
  return (
    <Page title="Phản ánh cộng đồng" wide>
      <div
        className="view-switch"
        role="group"
        aria-label="Cách hiển thị phản ánh"
      >
        <button aria-pressed={!mapView} onClick={() => changeView(false)}>
          <List size={16} />
          Danh sách
        </button>
        <button aria-pressed={mapView} onClick={() => changeView(true)}>
          <MapIcon size={16} />
          Bản đồ
        </button>
      </div>
      <Filters
        key={group}
        items={reports}
        initialGroup={group}
        ward={ward}
        onWardChange={(area) => { location.hash = communityPath({ mapView, group, ward: area }); }}
        statusOptions={{
          received: statuses.received,
          processing: statuses.processing,
          resolved: statuses.resolved,
        }}
      >
        {(rows) =>
          mapView ? (
            <Suspense fallback={<p>Đang mở bản đồ…</p>}>
              <CommunityMap reports={rows} />
            </Suspense>
          ) : (
            <PagedCards rows={rows} />
          )
        }
      </Filters>
    </Page>
  );
}
function AreaTotals({ rows }) {
  const counts = new Map();
  for (const r of rows) {
    const ward = r.ward || "Chưa xác định phường/xã";
    counts.set(ward, (counts.get(ward) || 0) + 1);
  }
  return [...counts]
    .sort(([a, n], [b, m]) => m - n || a.localeCompare(b, "vi"))
    .map(([ward, n]) => (
      <div key={ward} className="area-row">
        <span>{ward}</span>
        <b>{n} hồ sơ</b>
      </div>
    ));
}
function Staff({ reports = [] }) {
  const [users, error, refresh] = useResource("/staff"),
    [err, setErr] = useState(""),
    [busy, setBusy] = useState(false),
    [newAreas, setNewAreas] = useState([]),
    [qStaff, setQStaff] = useState(""),
    [editId, setEditId] = useState(null),
    [draft, setDraft] = useState([]);
  const coveredAreas = useMemo(() => {
    const set = new Set();
    for (const u of users || []) {
      if (!u.active) continue;
      for (const area of u.areas || []) set.add(area);
    }
    return set;
  }, [users]);
  const uncoveredWards = useMemo(() => {
    const counts = new Map();
    for (const r of reports || []) {
      if (isClosed(r) || awaitingIntake(r) || !r.ward) continue;
      if (!coveredAreas.has(r.ward)) {
        counts.set(r.ward, (counts.get(r.ward) || 0) + 1);
      }
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "vi"));
  }, [reports, coveredAreas]);
  const filteredStaff = useMemo(() => {
    const term = qStaff.trim().toLocaleLowerCase("vi");
    if (!term) return users || [];
    return (users || []).filter((u) =>
      [u.name, u.email, ...(u.areas || [])]
        .join(" ")
        .toLocaleLowerCase("vi")
        .includes(term),
    );
  }, [users, qStaff]);
  async function create(e) {
    e.preventDefault();
    const form = e.currentTarget;
    setBusy(true);
    setErr("");
    try {
      await api("/staff", "POST", {
        ...Object.fromEntries(new FormData(form)),
        areas: newAreas,
      });
      form.reset();
      setNewAreas([]);
      refresh();
    } catch (ex) {
      setErr(ex.message);
    } finally {
      setBusy(false);
    }
  }
  async function change(u, patch) {
    setBusy(true);
    setErr("");
    try {
      await api("/staff/" + u.id, "PATCH", patch);
      refresh();
      return true;
    } catch (ex) {
      setErr(ex.message);
      return false;
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="work-stack">
      <section className="work-panel">
        <div className="work-panel-heading">
          <h2>Thêm cán bộ</h2>
        </div>
        <div className="work-panel-body">
          <form onSubmit={create} className="form staff-form">
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
            <div className="field-title area-field">
              Khu vực phụ trách
              <AreaPicker value={newAreas} onChange={setNewAreas} disabled={busy} />
            </div>
            <button disabled={busy} className="btn green">
              Thêm cán bộ
            </button>
          </form>
          <ErrorMsg msg={error || err} />
        </div>
      </section>

      <section className="work-panel">
        <div className="work-panel-heading">
          <h2>Danh sách cán bộ ({filteredStaff.length})</h2>
        </div>
        <div className="work-panel-body">
          {uncoveredWards.length > 0 && (
            <div className="staff-coverage-alert" role="status">
              <strong>
                Phường/xã đang có hồ sơ mở nhưng chưa phân cán bộ phụ trách:
              </strong>
              <p>
                {uncoveredWards
                  .map(([ward, count]) => `${shortArea(ward)} (${count} hồ sơ)`)
                  .join(" · ")}
              </p>
            </div>
          )}
          <div className="staff-search-bar">
            <label className="work-search">
              <Search size={16} aria-hidden="true" />
              <input
                type="search"
                aria-label="Tìm cán bộ theo tên, email hoặc khu vực"
                placeholder="Tìm cán bộ theo tên, email hoặc phường/xã…"
                value={qStaff}
                onChange={(e) => setQStaff(e.target.value)}
              />
            </label>
          </div>
          {!users ? (
            <p role="status">Đang tải danh sách cán bộ…</p>
          ) : !filteredStaff.length ? (
            <Empty>
              {users.length ? "Không có cán bộ phù hợp từ khóa." : "Chưa có tài khoản cán bộ."}
            </Empty>
          ) : (
            <div className="staff-list">
              {filteredStaff.map((u) => {
                const openCount = reports.filter(
                  (r) => r.assignee === u.id && !isClosed(r),
                ).length;
                const resolvedCount = reports.filter(
                  (r) => r.assignee === u.id && r.status === "resolved",
                ).length;
                return (
                  <div className="staff-row" key={u.id}>
                    <div className="staff-row-main">
                      <div className="user-title-row">
                        <b>{u.name}</b>
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
                        {openCount} đang phụ trách · {resolvedCount} đã xử lý
                      </small>
                      <div className="user-areas">
                        <AreaChips areas={u.areas} />
                      </div>
                    </div>
                    <div className="staff-row-actions">
                      <button
                        type="button"
                        className="btn outline small"
                        disabled={busy}
                        onClick={() => {
                          setEditId(editId === u.id ? null : u.id);
                          setDraft(u.areas || []);
                        }}
                      >
                        Phân khu vực
                      </button>
                      <button
                        type="button"
                        className="btn outline small"
                        disabled={busy}
                        onClick={() => change(u, { active: !u.active })}
                      >
                        {u.active ? "Tạm khóa" : "Kích hoạt"}
                      </button>
                    </div>
                    {editId === u.id && (
                      <div className="staff-row-drawer area-editor">
                        <AreaPicker value={draft} onChange={setDraft} disabled={busy} />
                        <div className="area-editor-actions">
                          <button
                            type="button"
                            className="btn green small"
                            disabled={busy}
                            onClick={async () => {
                              if (await change(u, { areas: draft })) setEditId(null);
                            }}
                          >
                            Lưu khu vực
                          </button>
                          <button
                            type="button"
                            className="btn outline small"
                            onClick={() => setEditId(null)}
                          >
                            Hủy
                          </button>
                        </div>
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
function ReportStatistics({ items }) {
  const metrics = [
    ["Tổng phản ánh", items.length, ClipboardCheck, ""],
    ["Đã tiếp nhận", items.filter((r) => r.status === "received").length, Inbox, "waiting"],
    ["Đang xử lý", items.filter((r) => r.status === "processing").length, Clock3, "working"],
    ["Đã xử lý", items.filter((r) => r.status === "resolved").length, CircleCheck, "done"],
    ["Đã từ chối", items.filter((r) => r.status === "rejected").length, AlertCircle, "urgent"],
  ];
  return (
    <div className="work-stack">
      <div className="work-metrics" aria-label="Số liệu tổng hợp">
        {metrics.map(([label, value, Icon, tone]) => (
          <div className="work-metric" data-tone={tone || undefined} key={label}>
            <span>
              <Icon size={17} aria-hidden="true" />
              {label}
            </span>
            <strong>{value}</strong>
          </div>
        ))}
      </div>
      <div className="work-overview-grid work-stats-grid">
        <section className="work-panel">
          <div className="work-panel-heading">
            <h2>Thống kê theo nhóm</h2>
          </div>
          <div className="work-panel-body">
            {Object.entries({ ...groups, unknown: "Chờ cán bộ xác nhận" }).map(
              ([g, l]) => {
                const n = items.filter(
                  (r) => (r.confirmed_group || "unknown") === g,
                ).length;
                return (
                  <div className="bar-row" key={g}>
                    <span>{l}</span>
                    <progress value={n} max={items.length || 1} />
                    <b>{n}</b>
                  </div>
                );
              },
            )}
          </div>
        </section>
        <section className="work-panel">
          <div className="work-panel-heading">
            <h2>Thống kê theo phường/xã</h2>
          </div>
          <div className="work-panel-body">
            <Filters items={items}>{(rows) => <AreaTotals rows={rows} />}</Filters>
          </div>
        </section>
      </div>
      <RecurringHotspotsPanel reports={items} fromRoute="/admin?tab=stats" />
      <AdminAiStats reports={items} />
    </div>
  );
}

export function AdminDesk({ me, hash }) {
  const section = adminSection(hash);
  const isEditorial = section === "news";
  const [reports, error, refresh] = useResource(isEditorial ? null : "/reports");
  const [staff, staffError, refreshStaff] = useResource(isEditorial ? null : "/staff");
  useEffect(() => {
    if (isEditorial) return;
    const tick = () => {
      if (document.visibilityState !== "hidden") refresh();
    };
    const timer = setInterval(tick, 15000);
    document.addEventListener("visibilitychange", tick);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", tick);
    };
  }, [isEditorial]);
  const titles = {
    overview: "Tổng quan",
    reports: "Hồ sơ",
    staff: "Cán bộ",
    users: "Tài khoản",
    stats: "Thống kê",
    news: "Tin môi trường",
  };
  let content;
  if (section === "news") content = <Suspense fallback={<p role="status">Đang mở trình soạn thảo…</p>}><AdminNews /></Suspense>;
  else if (section === "users")
    content = <AdminUsersTab currentUser={me} onChanged={refreshStaff} />;
  else if (section === "staff") content = <Staff reports={reports || []} />;
  else if (!reports)
    content = error ? (
      <button type="button" className="btn outline" onClick={refresh}>
        Thử lại
      </button>
    ) : (
      <p role="status">Đang tải hồ sơ…</p>
    );
  else if (section === "stats") content = <ReportStatistics items={reports} />;
  else if (section === "reports")
    content = (
      <AdminQueue
        reports={reports}
        staff={staff || []}
        refresh={refresh}
        hash={hash}
      />
    );
  else
    content = (
      <AdminOverview
        reports={reports}
        staff={staff || []}
        showBriefing={
          new URLSearchParams(hash.split("?")[1]).get("tab") === "ai"
        }
      />
    );

  return (
    <main className="wrap work-page">
      <div className="work-heading">
        <h1>{titles[section]}</h1>
      </div>
      <ErrorMsg
        msg={
          isEditorial ? "" : error || (["reports", "overview"].includes(section) ? staffError : "")
        }
      />
      {content}
    </main>
  );
}

export function Desk({ me, hash }) {
  const [items, error, refresh] = useResource("/reports");
  const [staff] = useResource("/staff");
  const section = staffSection(hash);
  const query = new URLSearchParams(hash.split("?")[1]);
  const [scope, setScope] = useState(() => query.get("scope") || "all");
  const [wardFilter, setWardFilter] = useState(() => query.get("ward") || "");
  const [statusFilter, setStatusFilter] = useState(
    () => query.get("status") || "",
  );
  const [groupFilter, setGroupFilter] = useState("");
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);
  const [claimBusy, setClaimBusy] = useState("");
  const [claimErr, setClaimErr] = useState("");

  useEffect(() => {
    const tick = () => {
      if (document.visibilityState !== "hidden") refresh();
    };
    const timer = setInterval(tick, 15000);
    document.addEventListener("visibilitychange", tick);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", tick);
    };
  }, []);

  const myAreas = me?.areas || [];
  const staffNames = Object.fromEntries(
    (staff || []).map((user) => [user.id, user.name]),
  );
  const allReports = items || [];
  const openReports = allReports.filter(
    (report) => !awaitingIntake(report) && !isClosed(report),
  );
  const receivedArea = openReports.filter(
    (report) => report.status === "received",
  );
  const mineOpen = openReports.filter((report) => report.assignee === me.id);
  const resolved = allReports.filter((report) => report.status === "resolved");
  const wardCounts = new Map();
  for (const report of openReports) {
    if (report.ward)
      wardCounts.set(report.ward, (wardCounts.get(report.ward) || 0) + 1);
  }
  const urgent = openReports
    .filter((report) => report.urgent || report.priority === "high")
    .sort((a, b) => urgencyScore(b, wardCounts) - urgencyScore(a, wardCounts));
  const review = allReports.filter(
    (report) => report.intake_state === "review",
  );

  async function claimReport(reportId) {
    setClaimBusy(reportId);
    setClaimErr("");
    try {
      await api("/reports/" + encodeURIComponent(reportId) + "/claim", "POST");
      refresh();
    } catch (ex) {
      setClaimErr(ex.message);
    } finally {
      setClaimBusy("");
    }
  }

  const canSelfClaim = (report) =>
    report.assignee == null &&
    Boolean(report.ward && myAreas.includes(report.ward)) &&
    !awaitingIntake(report) &&
    !isClosed(report);

  const titles = {
    overview: "Tổng quan",
    map: "Bản đồ khu vực",
    reports: "Hồ sơ khu vực",
    review: "Chờ duyệt",
    notice: "Cần xem sớm",
  };

  const wardOptions = [
    ...new Set([
      ...myAreas,
      ...allReports.map((report) => report.ward).filter(Boolean),
    ]),
  ].sort((a, b) => a.localeCompare(b, "vi"));

  const baseList =
    section === "notice"
      ? urgent
      : section === "review"
        ? review
        : allReports;
  const term = q.trim().toLocaleLowerCase("vi");
  const filteredRows = baseList.filter((report) => {
    if (section === "reports") {
      if (scope === "mine" && report.assignee !== me.id) return false;
      if (scope === "unassigned" && report.assignee != null) return false;
      if (statusFilter && report.status !== statusFilter) return false;
    }
    if (wardFilter && report.ward !== wardFilter) return false;
    if (
      groupFilter &&
      (report.confirmed_group || report.ai_group) !== groupFilter
    )
      return false;
    if (
      term &&
      ![report.id, report.title, report.location, report.ward]
        .join(" ")
        .toLocaleLowerCase("vi")
        .includes(term)
    )
      return false;
    return true;
  });
  const DESK_PAGE_SIZE = 20;
  const deskPageCount = Math.max(1, Math.ceil(filteredRows.length / DESK_PAGE_SIZE));
  const deskPage = Math.min(page, deskPageCount);
  const pagedRows = filteredRows.slice(
    (deskPage - 1) * DESK_PAGE_SIZE,
    deskPage * DESK_PAGE_SIZE,
  );
  useEffect(() => {
    setPage(1);
  }, [section, scope, wardFilter, statusFilter, groupFilter, q]);

  const routeHere =
    section === "overview" ? "/desk" : "/desk?tab=" + section;
  const reportHref = (report) =>
    "#/report/" +
    encodeURIComponent(report.id) +
    "?from=" +
    encodeURIComponent(routeHere);

  let content;
  if (!items) {
    content = error ? (
      <button type="button" className="btn outline" onClick={refresh}>
        Thử lại
      </button>
    ) : (
      <p role="status">Đang tải hồ sơ…</p>
    );
  } else if (section === "map") {
    content = (
      <Suspense fallback={<p>Đang mở bản đồ…</p>}>
        <StaffFieldMap
          me={me}
          reports={items}
          initialWard={query.get("ward") || ""}
          onClaim={claimReport}
          onRefresh={refresh}
        />
      </Suspense>
    );
  } else if (section === "overview") {
    const metrics = [
      [
        "Mới tiếp nhận",
        receivedArea.length,
        MapPin,
        "#/desk?tab=map",
        "waiting",
      ],
      [
        "Đang phụ trách",
        mineOpen.length,
        Clock3,
        "#/desk?tab=reports&scope=mine",
        "working",
      ],
      [
        "Cần xem sớm",
        urgent.length,
        AlertCircle,
        "#/desk?tab=notice",
        "urgent",
      ],
      [
        "Chờ duyệt",
        review.length,
        Inbox,
        "#/desk?tab=review",
        "waiting",
      ],
      [
        "Đã xử lý",
        resolved.length,
        CircleCheck,
        "#/desk?tab=reports&status=resolved",
        "done",
      ],
    ];
    content = (
      <>
        <div className="work-metrics" aria-label="Tình hình hồ sơ khu vực">
          {metrics.map(([label, value, Icon, href, tone]) => (
            <a className="work-metric" data-tone={tone} key={label} href={href}>
              <span>
                <Icon size={17} aria-hidden="true" />
                {label}
              </span>
              <strong>{value}</strong>
            </a>
          ))}
        </div>
        <div className="work-overview-grid">
          <section className="work-panel">
            <div className="work-panel-heading">
              <h2>Hồ sơ mới tiếp nhận tại khu vực</h2>
              <a href="#/desk?tab=map">Mở bản đồ &amp; Chỉ đường</a>
            </div>
            {receivedArea.length ? (
              <ul className="work-preview">
                {receivedArea.slice(0, 5).map((report) => (
                  <li key={report.id}>
                    <div className="staff-preview-row">
                      <a href={reportHref(report)}>
                        <span>
                          <strong>{report.title}</strong>
                          <small>
                            {report.id} ·{" "}
                            {report.ward
                              ? shortArea(report.ward)
                              : report.location}
                          </small>
                        </span>
                      </a>
                      <span className="work-preview-state">
                        {canSelfClaim(report) ? (
                          <button
                            type="button"
                            className="btn outline small"
                            disabled={claimBusy === report.id}
                            onClick={() => claimReport(report.id)}
                          >
                            {claimBusy === report.id
                              ? "Đang nhận…"
                              : "Nhận xử lý"}
                          </button>
                        ) : (
                          <Status value={report.status} />
                        )}
                      </span>
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <Empty>
                {myAreas.length
                  ? "Chưa có hồ sơ mới tiếp nhận trong khu vực."
                  : "Tài khoản chưa được phân khu vực phụ trách."}
              </Empty>
            )}
          </section>
          <section className="work-panel">
            <div className="work-panel-heading">
              <h2>Phường/xã phụ trách</h2>
              <a href="#/desk?tab=reports">Xem tất cả hồ sơ</a>
            </div>
            {myAreas.length ? (
              <ul className="work-load">
                {myAreas.map((area) => {
                  const count = receivedArea.filter(
                    (r) => r.ward === area,
                  ).length;
                  return (
                    <li key={area}>
                      <a
                        href={
                          "#/desk?tab=map&ward=" + encodeURIComponent(area)
                        }
                      >
                        <span>{shortArea(area)}</span>
                        <b>{count} điểm</b>
                      </a>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <Empty>
                Chưa được quản trị viên gán phường/xã phụ trách.
              </Empty>
            )}
          </section>
        </div>
      </>
    );
  } else {
    content = (
      <section className="work-panel work-queue" aria-label="Danh sách hồ sơ">
        <div
          className={
            "work-filters " +
            (section === "reports" ? "work-filters-4" : "work-filters-2")
          }
        >
          <label className="work-search" htmlFor="staff-report-search">
            <Search size={17} aria-hidden="true" />
            <input
              id="staff-report-search"
              type="search"
              aria-label="Tìm kiếm phản ánh"
              placeholder="Tìm theo mã, nội dung hoặc địa điểm"
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
          </label>
          {section === "reports" && (
            <>
              <label>
                Phạm vi
                <select
                  aria-label="Lọc theo phạm vi"
                  value={scope}
                  onChange={(e) => setScope(e.target.value)}
                >
                  <option value="all">Tất cả hồ sơ</option>
                  <option value="mine">Được giao cho tôi</option>
                  <option value="unassigned">Chưa nhận trong khu vực</option>
                </select>
              </label>
              <label>
                Trạng thái
                <select
                  aria-label="Lọc theo trạng thái"
                  value={statusFilter}
                  onChange={(e) => setStatusFilter(e.target.value)}
                >
                  <option value="">Tất cả trạng thái</option>
                  {selectOptions(statuses)}
                </select>
              </label>
            </>
          )}
          <label>
            Phường/xã
            <select
              aria-label="Lọc theo khu vực"
              value={wardFilter}
              onChange={(e) => setWardFilter(e.target.value)}
            >
              <option value="">Tất cả khu vực</option>
              {wardOptions.map((ward) => (
                <option key={ward} value={ward}>
                  {shortArea(ward)}
                </option>
              ))}
            </select>
          </label>
          <label>
            Nhóm
            <select
              aria-label="Lọc theo nhóm"
              value={groupFilter}
              onChange={(e) => setGroupFilter(e.target.value)}
            >
              <option value="">Tất cả nhóm</option>
              {selectOptions(groups)}
            </select>
          </label>
        </div>
        <div className="work-table-tools">
          <div className="work-table-count">
            <span role="status">{filteredRows.length} hồ sơ</span>
          </div>
          {section === "reports" && (
            <a className="work-text-button" href="#/desk?tab=map">
              <Navigation size={14} aria-hidden="true" /> Xem bản đồ điều hướng
            </a>
          )}
        </div>
        {filteredRows.length ? (
          <>
          <table className="work-table" role="table">
            <thead>
              <tr>
                <th scope="col">Hồ sơ</th>
                <th scope="col">Nhóm</th>
                <th scope="col">Trạng thái</th>
                <th scope="col">Phụ trách</th>
              </tr>
            </thead>
            <tbody>
              {pagedRows.map((report) => (
                <tr key={report.id}>
                  <td className="work-report">
                    <a href={reportHref(report)}>{report.title}</a>
                    <small>
                      {report.id} · {dateText(report.created_at)}
                    </small>
                    <small>{report.ward || report.location}</small>
                  </td>
                  <td className="work-group">
                    <span className="work-cell-label">Nhóm</span>
                    {groups[report.confirmed_group || report.ai_group] ||
                      "Chờ phân loại"}
                  </td>
                  <td className="work-state">
                    <span className="work-cell-label">Trạng thái</span>
                    <Status
                      value={report.status}
                      intakeState={report.intake_state}
                    />
                    {(report.urgent || report.priority === "high") && (
                      <small className="review-label">Cần xem sớm</small>
                    )}
                  </td>
                  <td className="work-owner">
                    <span className="work-cell-label">Phụ trách</span>
                    {report.assignee ? (
                      report.assignee === me.id ? (
                        "Bạn phụ trách"
                      ) : (
                        staffNames[report.assignee] ||
                        "Cán bộ #" + report.assignee
                      )
                    ) : canSelfClaim(report) ? (
                      <button
                        type="button"
                        className="btn outline small"
                        disabled={claimBusy === report.id}
                        onClick={() => claimReport(report.id)}
                      >
                        <UserCheck size={14} aria-hidden="true" />
                        {claimBusy === report.id ? "Đang nhận…" : "Nhận xử lý"}
                      </button>
                    ) : (
                      "Chưa phân công"
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {deskPageCount > 1 && (
            <nav className="work-pagination" aria-label="Phân trang hồ sơ khu vực">
              <button
                type="button"
                className="icon-btn"
                aria-label="Trang trước"
                disabled={deskPage === 1}
                onClick={() => setPage(deskPage - 1)}
              >
                <ChevronLeft size={18} />
              </button>
              <span>
                Trang {deskPage} / {deskPageCount}
              </span>
              <button
                type="button"
                className="icon-btn"
                aria-label="Trang sau"
                disabled={deskPage === deskPageCount}
                onClick={() => setPage(deskPage + 1)}
              >
                <ChevronRight size={18} />
              </button>
            </nav>
          )}
          </>
        ) : (
          <Empty>
            {!myAreas.length && !allReports.length
              ? "Tài khoản chưa được phân khu vực phụ trách."
              : "Chưa có phản ánh phù hợp."}
          </Empty>
        )}
      </section>
    );
  }

  return (
    <main className="wrap work-page">
      <div className="work-heading">
        <h1>{titles[section]}</h1>
        <div className="staff-areas-bar">
          <span>Khu vực phụ trách:</span>
          <AreaChips areas={myAreas} empty="Chưa phân khu vực" />
        </div>
      </div>
      <ErrorMsg msg={error || claimErr} />
      {content}
    </main>
  );
}
function ReportClassification({ report: r }) {
  return (
    <>
      <div className="analysis">
        <div>
          <span>
            <Sparkles size={16} />
            Phân loại sơ bộ
          </span>
          <b>
            {groups[r.ai_group] ||
              (r.ai_state === "failed"
                ? "Chưa thể phân loại"
                : "Đang xử lý phân loại")}
          </b>
        </div>
        <div>
          <span>
            <ClipboardCheck size={16} />
            Cán bộ xác nhận
          </span>
          <b>{groups[r.confirmed_group] || "Chờ xác nhận"}</b>
        </div>
      </div>
      {r.ai_summary && (
        <p className="ai-summary">
          <Sparkles size={15} />
          <span>
            <b>Ghi nhận tự động:</b> {r.ai_summary}
          </span>
        </p>
      )}
    </>
  );
}

function Actions({ r, me, refresh }) {
  const [staff, errStaff] = useResource("/staff"),
    [allReports] = useResource(me.role === "admin" ? "/reports" : null),
    [err, setErr] = useState(""),
    [busy, setBusy] = useState(false),
    [aiBusy, setAiBusy] = useState(false),
    [assistData, setAssistData] = useState(null),
    [evidencePhotos, setEvidencePhotos] = useState([]),
    [readingPhotos, setReadingPhotos] = useState(false),
    [message, setMessage] = useState(""),
    [nextStatus, setNextStatus] = useState(r.status);
  const updateForm = useRef(null);
  const suggestedOfficer = useMemo(
    () => (me.role === "admin" ? leastBusyStaff(staff, allReports, r.ward) : null),
    [me.role, staff, allReports, r.ward],
  );
  async function addEvidence(e) {
    const files = [...e.target.files];
    e.target.value = "";
    if (!files.length) return;
    setErr("");
    if (files.length + evidencePhotos.length > 3) {
      setErr("Chỉ được đính kèm tối đa 3 ảnh minh chứng.");
      return;
    }
    setReadingPhotos(true);
    try {
      const batch = await Promise.all(files.map(readImage));
      setEvidencePhotos((prev) => [...prev, ...batch]);
    } catch (ex) {
      setErr(ex.message);
    } finally {
      setReadingPhotos(false);
    }
  }
  async function save(e, action) {
    e.preventDefault();
    let data = Object.fromEntries(new FormData(e.currentTarget));
    if (action === "assign") data.assignee = Number(data.assignee);
    if (action === "update") {
      if (!data.confirmed_group) data.confirmed_group = null;
      data.photos = data.status === "cancelled" ? [] : evidencePhotos;
    }
    setBusy(true);
    setErr("");
    setMessage("");
    try {
      await api("/reports/" + r.id + "/" + action, "POST", data);
      if (action === "update") setEvidencePhotos([]);
      refresh();
      setMessage("Đã lưu thay đổi.");
    } catch (ex) {
      setErr(ex.message);
    } finally {
      setBusy(false);
    }
  }
  async function runAiAssist() {
    setAiBusy(true);
    setErr("");
    setMessage("");
    try {
      const data = await api("/reports/" + r.id + "/ai-assist", "POST");
      setAssistData(data);
      const els = updateForm.current?.elements;
      if (els) {
        if (data.confirmed_group)
          els.confirmed_group.value = data.confirmed_group;
        if (data.priority) els.priority.value = data.priority;
        if (data.draft_note) els.note.value = data.draft_note;
      }
      setMessage("Đã điền bản nháp. Kiểm tra nội dung trước khi lưu.");
    } catch (ex) {
      setErr(ex.message);
    } finally {
      setAiBusy(false);
    }
  }
  async function runReanalyze() {
    setAiBusy(true);
    setErr("");
    setMessage("");
    try {
      await api("/reports/" + r.id + "/reanalyze", "POST");
      refresh();
      setMessage("Đã phân tích lại ảnh bằng AI.");
    } catch (ex) {
      setErr(ex.message);
    } finally {
      setAiBusy(false);
    }
  }
  async function claim() {
    setBusy(true);
    setErr("");
    setMessage("");
    try {
      await api("/reports/" + r.id + "/claim", "POST");
      refresh();
      setMessage("Đã nhận phụ trách hồ sơ.");
    } catch (ex) {
      setErr(ex.message);
    } finally {
      setBusy(false);
    }
  }
  const inArea = Boolean(r.ward && (me.areas || []).includes(r.ward));
  const canClaim =
    me.role === "staff" && r.assignee == null && inArea && !isClosed(r);
  const canEdit = me.role === "admin" || r.assignee === me.id || canClaim;
  return (
    <section className="panel record-actions">
      <div className="actions-head">
        <h2>Xử lý hồ sơ</h2>
      </div>
      <ErrorMsg msg={err || errStaff} />
      {canClaim && (
        <div className="staff-claim-banner">
          <span>
            Hồ sơ thuộc khu vực bạn phụ trách và chưa có cán bộ nhận.
          </span>
          <button
            type="button"
            className="btn outline small"
            disabled={busy || aiBusy}
            onClick={claim}
          >
            <UserCheck size={15} aria-hidden="true" />
            Nhận xử lý hồ sơ
          </button>
        </div>
      )}
      {me.role === "admin" && staff && !isClosed(r) && (
          <form className="inline-form" onSubmit={(e) => save(e, "assign")}>
            <label>
              Phân công cán bộ
              <select
                aria-label="Phân công cán bộ"
                name="assignee"
                required
                defaultValue={r.assignee || ""}
              >
                <option value="">Chọn cán bộ phụ trách</option>
                {staff
                  ?.filter((u) => u.active)
                  .map((u) => (
                    <option value={u.id} key={u.id}>
                      {u.name}
                      {r.ward && u.areas?.includes(r.ward)
                        ? " (Phụ trách khu vực này)"
                        : ""}
                    </option>
                  ))}
              </select>
              {suggestedOfficer && !r.assignee && (
                <small>
                  Có thể giao cho {suggestedOfficer.name} (
                  {suggestedOfficer.openCount} hồ sơ đang mở
                  {r.ward && suggestedOfficer.areas?.includes(r.ward)
                    ? " · phụ trách khu vực này"
                    : ""}
                  )
                </small>
              )}
            </label>
            <button disabled={busy || aiBusy} className="btn outline">
              Phân công
            </button>
          </form>
        )}
      {isClosed(r) ? (
        me.role === "admin" && (
          <form onSubmit={(e) => save(e, "reopen")} className="form">
            <label>
              Lý do mở lại
              <input name="note" required maxLength={2000} />
            </label>
            <button disabled={busy || aiBusy} className="btn outline">
              Mở lại hồ sơ
            </button>
          </form>
        )
      ) : canEdit ? (
        <form
          className="form"
          ref={updateForm}
          onSubmit={(e) => save(e, "update")}
        >
          <div className="cols">
            <label>
              Nhóm xác nhận
              <select
                aria-label="Nhóm xác nhận"
                name="confirmed_group"
                required={nextStatus !== "cancelled"}
                defaultValue={r.confirmed_group || r.ai_group || ""}
              >
                <option value="">Chọn nhóm</option>
                {selectOptions(groups)}
              </select>
            </label>
            <label>
              Mức ưu tiên
              <select
                aria-label="Mức ưu tiên"
                name="priority"
                defaultValue={r.priority}
              >
                {selectOptions(priorities)}
              </select>
            </label>
          </div>
          <label>
            Trạng thái
            <select
              aria-label="Trạng thái"
              name="status"
              value={nextStatus}
              onChange={(e) => setNextStatus(e.target.value)}
            >
              {selectOptions({
                received: statuses.received,
                processing: statuses.processing,
                resolved: statuses.resolved,
                cancelled: statuses.cancelled,
              })}
            </select>
          </label>
          <label>
            {nextStatus === "cancelled" ? "Lý do hủy" : "Phản hồi người dân"}
            <textarea
              rows={3}
              name="note"
              maxLength={2000}
              required
              placeholder={
                nextStatus === "cancelled"
                  ? "Nhập lý do hủy hồ sơ để người gửi được biết…"
                  : undefined
              }
            />
          </label>
          {nextStatus !== "cancelled" && (
            <div className="evidence-upload-field">
              <div className="field-title">
                Ảnh minh chứng xử lý <small>(Tùy chọn · {evidencePhotos.length}/3)</small>
              </div>
              {evidencePhotos.length > 0 && (
                <div className="previews">
                  {evidencePhotos.map((p, idx) => (
                    <div key={idx}>
                      <img src={p} alt={"Ảnh minh chứng " + (idx + 1)} />
                      <button
                        type="button"
                        aria-label={"Xóa ảnh minh chứng " + (idx + 1)}
                        onClick={() =>
                          setEvidencePhotos(evidencePhotos.filter((_, j) => idx !== j))
                        }
                      >
                        <X size={15} />
                      </button>
                    </div>
                  ))}
                </div>
              )}
              {evidencePhotos.length < 3 && (
                <label className="upload evidence-upload">
                  <ImagePlus size={20} />
                  <strong>
                    {readingPhotos ? "Đang đọc ảnh…" : "Đính kèm ảnh hiện trường / sau xử lý"}
                  </strong>
                  <input
                    aria-label="Đính kèm ảnh minh chứng"
                    type="file"
                    accept="image/jpeg,image/png,image/webp"
                    multiple
                    disabled={readingPhotos || busy || aiBusy}
                    onChange={addEvidence}
                  />
                </label>
              )}
            </div>
          )}
          {nextStatus === "cancelled" && (
            <small className="cancel-hint">
              Hồ sơ đã hủy sẽ bị gỡ khỏi trang chủ; chỉ người gửi, quản trị viên
              và cán bộ phụ trách mới xem được.
            </small>
          )}
          <button
            disabled={busy || aiBusy || readingPhotos}
            className={"btn " + (nextStatus === "cancelled" ? "danger" : "green")}
          >
            {nextStatus === "cancelled"
              ? "Xác nhận hủy hồ sơ"
              : "Lưu cập nhật"}
          </button>
        </form>
      ) : (
        <p>
          Chỉ cán bộ được phân công hoặc phụ trách khu vực mới có thể cập nhật
          hồ sơ này.
        </p>
      )}
      <details className="record-ai">
        <summary>Công cụ hỗ trợ xử lý</summary>
        {me.role === "admin" && <ReportClassification report={r} />}
        {me.role === "admin" && r.photos?.length > 0 && (
          <button
            type="button"
            className="btn outline small"
            disabled={busy || aiBusy}
            onClick={runReanalyze}
          >
            <RefreshCw size={15} aria-hidden="true" />
            {aiBusy ? "Đang phân tích…" : "Phân tích lại ảnh"}
          </button>
        )}
        {canEdit && !isClosed(r) && (
          <>
            <div className="ai-assist-bar">
              <button
                type="button"
                className="btn outline small"
                disabled={busy || aiBusy}
                onClick={runAiAssist}
              >
                <Sparkles size={15} />
                {aiBusy ? "Đang tạo gợi ý…" : "Soạn gợi ý phản hồi"}
              </button>
              <small>
                Đơn vị phối hợp gợi ý:{" "}
                {assistData?.unit ||
                  PLAYBOOKS_CLIENT[r.confirmed_group || r.ai_group || "other"]}
              </small>
            </div>
            {assistData && (
              <div className="ai-assist-box">
                <div className="assist-head">
                  <b>Gợi ý quy trình xử lý</b>
                </div>
                <ul>
                  {assistData.action_steps?.map((step, i) => (
                    <li key={i}>{step}</li>
                  ))}
                </ul>
              </div>
            )}
          </>
        )}
      </details>
      <p aria-live="polite">{message}</p>
    </section>
  );
}
function ReviewActions({ report, me, refresh }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const isAdmin = me?.role === "admin";
  const [staff] = useResource(isAdmin ? "/staff" : null);
  const [allReports] = useResource(isAdmin ? "/reports" : null);
  const suggestedOfficer = useMemo(
    () => (isAdmin ? leastBusyStaff(staff, allReports, report.ward) : null),
    [isAdmin, staff, allReports, report.ward],
  );
  const path = "/reports/" + encodeURIComponent(report.id);

  async function review(event) {
    event.preventDefault();
    const fields = new FormData(event.currentTarget);
    const decision = event.nativeEvent.submitter?.value || "accept";
    const group = fields.get("group") || null;
    const note = fields.get("note").trim() || null;
    const rawAssignee = fields.get("assignee");
    const assignee =
      decision === "accept" && isAdmin && rawAssignee
        ? Number(rawAssignee)
        : null;
    if ((decision === "accept" && !group) || (decision === "reject" && !note)) {
      setError(
        decision === "accept"
          ? "Chọn nhóm phản ánh trước khi tiếp nhận."
          : "Nhập lý do để người gửi biết cần sửa gì.",
      );
      return;
    }
    setBusy(true);
    setError("");
    try {
      await api(path + "/intake-review", "POST", {
        decision,
        group,
        note,
        ...(assignee != null ? { assignee } : {}),
      });
      refresh();
    } catch (exception) {
      setError(exception.message);
    } finally {
      setBusy(false);
    }
  }

  async function reanalyze() {
    setBusy(true);
    setError("");
    try {
      await api(path + "/reanalyze", "POST");
      refresh();
    } catch (exception) {
      setError(exception.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="panel record-actions">
      <h2>Duyệt phản ánh</h2>
      <ReportClassification report={report} />
      {report.photos.length > 0 && (
        <button
          type="button"
          className="btn outline small"
          onClick={reanalyze}
          disabled={busy}
        >
          <RefreshCw size={15} aria-hidden="true" /> Phân tích lại ảnh
        </button>
      )}
      <ErrorMsg msg={error} />
      <form className="form intake-review-form" onSubmit={review}>
        <label>
          Nhóm xác nhận
          <select
            name="group"
            aria-label="Nhóm xác nhận"
            defaultValue={report.confirmed_group || report.ai_group || ""}
          >
            <option value="">Chọn nhóm phản ánh</option>
            {selectOptions(groups)}
          </select>
        </label>
        <label>
          Ghi chú cho người gửi
          <textarea
            name="note"
            rows={3}
            maxLength={2000}
            placeholder="Cần lý do khi từ chối"
          />
        </label>
        {isAdmin && staff && (
          <label>
            Phân công cán bộ ngay <small>(Tùy chọn khi tiếp nhận)</small>
            <select
              name="assignee"
              aria-label="Phân công cán bộ ngay"
              defaultValue=""
            >
              <option value="">Để quản trị phân công sau</option>
              {staff
                .filter((u) => u.active)
                .map((u) => (
                  <option value={u.id} key={u.id}>
                    {u.name}
                    {report.ward && u.areas?.includes(report.ward)
                      ? " (Phụ trách khu vực này)"
                      : ""}
                  </option>
                ))}
            </select>
            {suggestedOfficer && (
              <small>
                Gợi ý: {suggestedOfficer.name} ({suggestedOfficer.openCount} hồ sơ
                đang mở
                {report.ward && suggestedOfficer.areas?.includes(report.ward)
                  ? " · đúng khu vực"
                  : ""}
                )
              </small>
            )}
          </label>
        )}
        <div className="intake-review-actions">
          <button value="accept" className="btn green" disabled={busy}>
            Tiếp nhận
          </button>
          <button value="reject" className="btn outline" disabled={busy}>
            Từ chối
          </button>
        </div>
      </form>
    </section>
  );
}

export function Detail({ id, me, from }) {
  const admin = me?.role === "admin";
  const [returnPath, returnQuery] = (from || "").split("?");
  const adminBack =
    returnPath === "/admin" &&
    (!returnQuery || new URLSearchParams(returnQuery).get("tab") === "reports")
      ? from
      : "/admin?tab=reports";
  const [r, err, refresh] = useResource("/reports/" + encodeURIComponent(id));
  const staff = me?.role === "staff";
  const staffBack =
    staff && returnPath === "/desk" ? from : "/desk?tab=reports";
  const [zoom, setZoom] = useState(null);
  const lightbox = useRef(null);
  useEffect(() => {
    if (!r || (!awaitingIntake(r) && r.ai_state !== "pending")) return;
    const t = setTimeout(refresh, 3000);
    return () => clearTimeout(t);
  }, [r]);
  useEffect(() => {
    if (zoom) lightbox.current?.showModal();
  }, [zoom]);
  const actions =
    (admin || staff) &&
    r &&
    (r.intake_state === "review" ? (
      <ReviewActions key={r.id} report={r} me={me} refresh={refresh} />
    ) : r.intake_state === "pending" ? null : (
      <Actions
        key={r.id + ":" + r.status + ":" + r.assignee}
        r={r}
        me={me}
        refresh={refresh}
      />
    ));
  return (
    <Page
      title="Chi tiết phản ánh"
      back={admin ? adminBack : staff ? staffBack : "/community"}
      backLabel={
        (admin && adminBack === "/admin") || (staff && staffBack === "/desk")
          ? "Tổng quan"
          : staff && staffBack.includes("tab=map")
            ? "Bản đồ khu vực"
            : me
              ? "Danh sách hồ sơ"
              : "Phản ánh cộng đồng"
      }
      wide={admin || staff}
    >
      <ErrorMsg msg={err} />
      {r ? (
        <div className={admin || staff ? "admin-record" : undefined}>
          <div className="record-summary">
            <div className="panel detail">
              <div className="meta">
                <span className="detail-id">
                  <b>{r.id}</b>
                  <small>· Ngày gửi {dateText(r.created_at)}</small>
                </span>
                <Status value={r.status} intakeState={r.intake_state} />
              </div>
              <h2>{r.title}</h2>
              <p className="detail-place">
                <MapPin size={17} />
                {r.location}
              </p>
              {!admin && !(staff && r.intake_state === "review") && (
                <ReportClassification report={r} />
              )}
            </div>
            <IntakeNotice report={r} canResubmit={!me || me.role === "citizen"} />
            <CancelledNotice report={r} />
            <AdviceBox report={r} />
          </div>
          <section className="panel detail-evidence">
            <h2>Hiện trường &amp; vị trí</h2>
            <p className="description">{r.description}</p>
            {r.photos.length > 0 && (
              <div className="photo-strip">
                {r.photos.map((p, i) => (
                  <button
                    key={i}
                    onClick={() => setZoom(p)}
                    aria-label={"Xem ảnh " + (i + 1)}
                    className={
                      r.intake_photos?.includes(i + 1)
                        ? "intake-photo-flag"
                        : undefined
                    }
                  >
                    <img src={p} alt={"Hiện trường " + (i + 1)} />
                  </button>
                ))}
              </div>
            )}
            {(() => {
              const afterPhotos =
                r.history?.find((h) => h.status === "resolved" && h.photos?.length)?.photos ||
                [];
              if (!r.photos?.length || !afterPhotos.length) return null;
              return (
                <div className="before-after-box">
                  <h3>Đối chiếu Trước &amp; Sau xử lý</h3>
                  <div className="before-after-grid">
                    <div>
                      <small>Trước xử lý (người dân gửi)</small>
                      <button
                        type="button"
                        onClick={() => setZoom(r.photos[0])}
                        aria-label="Phóng to ảnh trước xử lý"
                      >
                        <img src={r.photos[0]} alt="Hiện trường trước xử lý" />
                      </button>
                    </div>
                    <div>
                      <small>Sau xử lý (cán bộ cập nhật)</small>
                      <button
                        type="button"
                        onClick={() => setZoom(afterPhotos[0])}
                        aria-label="Phóng to ảnh sau xử lý"
                      >
                        <img src={afterPhotos[0]} alt="Hiện trường sau xử lý" />
                      </button>
                    </div>
                  </div>
                </div>
              );
            })()}
            <Suspense fallback={<p>Đang mở bản đồ…</p>}>
              <FieldMap report={r} />
            </Suspense>
          </section>
          {actions}
          <section className="panel record-history">
            <h2>Tiến độ và phản hồi</h2>
            <ol className="timeline">
              {r.history.map((h, i) => (
                <li key={i}>
                  <b>{statuses[h.status]}</b>
                  <small>{dateText(h.created_at)}</small>
                  <p>{h.note}</p>
                  {h.photos?.length > 0 && (
                    <div className="photo-strip timeline-photos">
                      {h.photos.map((p, idx) => (
                        <button
                          key={idx}
                          type="button"
                          onClick={() => setZoom(p)}
                          aria-label={"Xem ảnh minh chứng " + (idx + 1)}
                        >
                          <img src={p} alt={"Minh chứng " + (idx + 1)} />
                        </button>
                      ))}
                    </div>
                  )}
                </li>
              ))}
              <li>
                <b>Đã gửi hồ sơ</b>
                <small>{dateText(r.created_at)}</small>
                <p>Phản ánh đã được ghi nhận trên hệ thống.</p>
              </li>
            </ol>
          </section>
        </div>
      ) : (
        !err && <p>Đang tải hồ sơ…</p>
      )}
      {zoom && (
        <dialog
          ref={lightbox}
          className="lightbox"
          onClose={() => setZoom(null)}
          aria-label="Ảnh hiện trường"
          aria-modal="true"
          onClick={(e) => {
            if (e.target === lightbox.current) lightbox.current.close();
          }}
        >
          <button
            className="icon-btn"
            autoFocus
            aria-label="Đóng ảnh"
            onClick={() => lightbox.current.close()}
          >
            <X />
          </button>
          <img src={zoom} alt="Ảnh hiện trường phóng lớn" />
        </dialog>
      )}
    </Page>
  );
}
