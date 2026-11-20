import React, { useEffect, useRef, useState } from "react";
import {
  AlertCircle,
  ChevronLeft,
  ChevronRight,
  CircleCheck,
  Clock3,
  Inbox,
  Search,
  UserCheck,
} from "lucide-react";
import {
  api,
  awaitingIntake,
  dateText,
  groups,
  intakeLabels,
  statuses,
} from "./domain";
import { AdminBriefing, RecurringHotspotsPanel } from "./admin";
import { Empty, ErrorMsg, selectOptions, Status } from "./ui";

const PAGE_SIZE = 20;
const initialFilters = {
  q: "",
  status: "",
  group: "",
  ward: "",
  staff: "",
  priority: "",
  sort: "",
  ai: "",
  intake: "",
};
const hasOpenStatus = (report) =>
  report.status === "received" || report.status === "processing";
const isOpen = (report) => hasOpenStatus(report) && !awaitingIntake(report);
const needsReview = (report) =>
  hasOpenStatus(report) && (report.urgent || report.priority === "high");
const canAssign = (report) => isOpen(report) && report.assignee == null;
const reportGroup = (report) => report.confirmed_group || report.ai_group || "";
const reportsRoute = "/admin?tab=reports";

function reportLink(report, from = reportsRoute) {
  return (
    "#/report/" +
    encodeURIComponent(report.id) +
    "?from=" +
    encodeURIComponent(from)
  );
}

export function AdminOverview({ reports, staff, showBriefing }) {
  const counts = new Map();
  const openReports = reports.filter(isOpen);
  for (const report of openReports) {
    counts.set(report.assignee, (counts.get(report.assignee) || 0) + 1);
  }
  const queue = [...openReports]
    .sort(
      (a, b) =>
        Number(needsReview(b)) - Number(needsReview(a)) ||
        Date.parse(a.created_at) - Date.parse(b.created_at),
    )
    .slice(0, 5);
  const metrics = [
    [
      "Chờ duyệt",
      reports.filter((report) => report.intake_state === "review").length,
      Inbox,
      "intake=review",
      "waiting",
    ],
    [
      "Chưa phân công",
      openReports.filter(canAssign).length,
      Inbox,
      "staff=unassigned",
      "waiting",
    ],
    [
      "Cần xem sớm",
      reports.filter(needsReview).length,
      AlertCircle,
      "priority=urgent",
      "urgent",
    ],
    [
      "Đang xử lý",
      reports.filter((r) => r.status === "processing").length,
      Clock3,
      "status=processing",
      "working",
    ],
    [
      "Đã xử lý",
      reports.filter((r) => r.status === "resolved").length,
      CircleCheck,
      "status=resolved",
      "done",
    ],
  ];
  const officers = staff
    .filter((officer) => officer.active)
    .sort(
      (a, b) =>
        (counts.get(b.id) || 0) - (counts.get(a.id) || 0) ||
        a.name.localeCompare(b.name, "vi"),
    );
  return (
    <>
      <div className="work-metrics" aria-label="Tình hình hồ sơ">
        {metrics.map(([label, value, Icon, filter, tone]) => (
          <a
            className="work-metric"
            data-tone={tone}
            key={label}
            href={"#" + reportsRoute + "&" + filter}
          >
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
            <h2>Hồ sơ cần xử lý</h2>
            <a href={"#" + reportsRoute}>Xem hồ sơ</a>
          </div>
          {queue.length ? (
            <ul className="work-preview">
              {queue.map((report) => (
                <li key={report.id}>
                  <a href={reportLink(report, "/admin")}>
                    <span>
                      <strong>{report.title}</strong>
                      <small>
                        {report.id} · {dateText(report.created_at)}
                      </small>
                    </span>
                    <span className="work-preview-state">
                      {needsReview(report) ? (
                        <span className="review-label">Cần xem sớm</span>
                      ) : (
                        <Status value={report.status} />
                      )}
                    </span>
                  </a>
                </li>
              ))}
            </ul>
          ) : (
            <Empty>Không có hồ sơ đang mở.</Empty>
          )}
        </section>
        <section className="work-panel">
          <div className="work-panel-heading">
            <h2>Hồ sơ theo cán bộ</h2>
            <a href="#/admin?tab=staff">Xem cán bộ</a>
          </div>
          {officers.length ? (
            <ul className="work-load">
              {officers.map((officer) => (
                <li key={officer.id}>
                  <a
                    href={
                      "#" +
                      reportsRoute +
                      "&staff=" +
                      officer.id +
                      "&priority=open"
                    }
                  >
                    <span>{officer.name}</span>
                    <b>{counts.get(officer.id) || 0}</b>
                  </a>
                </li>
              ))}
            </ul>
          ) : (
            <Empty>Chưa có cán bộ đang hoạt động.</Empty>
          )}
        </section>
      </div>
      <RecurringHotspotsPanel reports={reports} fromRoute="/admin" />
      <details
        className="work-panel work-brief"
        open={showBriefing || undefined}
      >
        <summary>Gợi ý xử lý</summary>
        <AdminBriefing />
      </details>
    </>
  );
}

function filterReports(reports, filters) {
  const term = filters.q.trim().toLocaleLowerCase("vi");
  return reports
    .filter((report) => {
      if (
        term &&
        ![report.id, report.title, report.location, report.ward]
          .join(" ")
          .toLocaleLowerCase("vi")
          .includes(term)
      )
        return false;
      if (filters.status && report.status !== filters.status) return false;
      if (filters.intake && report.intake_state !== filters.intake)
        return false;
      if (filters.group && reportGroup(report) !== filters.group) return false;
      if (filters.ward && (report.ward || "unknown") !== filters.ward)
        return false;
      if (filters.staff === "unassigned" && !canAssign(report)) return false;
      if (
        filters.staff &&
        filters.staff !== "unassigned" &&
        String(report.assignee) !== filters.staff
      )
        return false;
      if (filters.priority === "urgent" && !needsReview(report)) return false;
      if (filters.priority === "open" && !isOpen(report)) return false;
      if (
        filters.priority === "normal" &&
        (report.urgent || report.priority === "high")
      )
        return false;
      if (filters.ai === "pending" && report.ai_state !== "pending")
        return false;
      return (
        !filters.ai ||
        filters.ai === "pending" ||
        report.ai_source === filters.ai
      );
    })
    .sort(
      (a, b) =>
        (filters.sort === "priority"
          ? Number(needsReview(b)) - Number(needsReview(a))
          : 0) ||
        Date.parse(b.created_at) - Date.parse(a.created_at) ||
        a.id.localeCompare(b.id),
    );
}

function QueueSelect({ name, label, all, filters, options, onChange }) {
  return (
    <label>
      {label}
      <select
        value={filters[name]}
        onChange={(event) => onChange(name, event.target.value)}
      >
        <option value="">{all}</option>
        {selectOptions(options)}
      </select>
    </label>
  );
}

export function AdminQueue({ reports, staff, refresh, hash }) {
  const query = new URLSearchParams(hash.split("?")[1]);
  const lastRoute = useRef(hash);
  const [filters, setFilters] = useState(() =>
    Object.fromEntries(
      Object.keys(initialFilters).map((key) => [
        key,
        query.get(key) ||
          (key === "priority" && query.get("tab") === "notice" ? "urgent" : ""),
      ]),
    ),
  );
  const [page, setPage] = useState(() =>
    Math.max(1, parseInt(query.get("page"), 10) || 1),
  );
  const [selected, setSelected] = useState([]);
  const [officer, setOfficer] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const filtered = filterReports(reports, filters);
  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const currentPage = Math.min(page, pageCount);
  const visible = filtered.slice(
    (currentPage - 1) * PAGE_SIZE,
    currentPage * PAGE_SIZE,
  );
  const eligible = visible.filter(canAssign).map((report) => report.id);
  const chosen = selected.filter((id) => eligible.includes(id));
  const allChosen = eligible.length > 0 && chosen.length === eligible.length;
  const staffNames = Object.fromEntries(
    staff.map((user) => [user.id, user.name]),
  );
  const activeStaff = staff.filter((user) => user.active);
  const wards = [
    ...new Set(reports.map((report) => report.ward).filter(Boolean)),
  ].sort((a, b) => a.localeCompare(b, "vi"));
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(filters))
    if (value) params.set(key, value);
  if (currentPage > 1) params.set("page", String(currentPage));
  const route = reportsRoute + (params.size ? "&" + params : "");
  useEffect(() => {
    if ([hash, lastRoute.current].includes(location.hash.slice(1))) {
      window.history.replaceState(window.history.state, "", "#" + route);
      lastRoute.current = route;
    }
  }, [route, hash]);

  function changeFilter(name, value) {
    setFilters((previous) => ({ ...previous, [name]: value }));
    setPage(1);
    setSelected([]);
    setError("");
    setMessage("");
  }

  function changePage(value) {
    setPage(value);
    setSelected([]);
  }

  async function assignSelected(event) {
    event.preventDefault();
    if (!chosen.length || !officer || busy) return;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const result = await api("/admin/reports/bulk-assign", "POST", {
        report_ids: chosen,
        assignee: Number(officer),
      });
      setMessage("Đã phân công " + result.assigned + " hồ sơ.");
      setSelected([]);
    } catch (exception) {
      setError(exception.message);
      setSelected([]);
    } finally {
      refresh();
      setBusy(false);
    }
  }

  return (
    <section className="work-panel work-queue" aria-label="Danh sách hồ sơ">
      <fieldset className="work-filters" disabled={busy}>
        <label className="work-search" htmlFor="admin-report-search">
          <Search size={17} aria-hidden="true" />
          <input
            id="admin-report-search"
            type="search"
            aria-label="Tìm kiếm phản ánh"
            placeholder="Tìm theo mã, nội dung hoặc địa điểm"
            value={filters.q}
            onChange={(event) => changeFilter("q", event.target.value)}
          />
        </label>
        <QueueSelect
          name="status"
          label="Trạng thái"
          all="Tất cả trạng thái"
          filters={filters}
          options={statuses}
          onChange={changeFilter}
        />
        <QueueSelect
          name="intake"
          label="Kiểm tra"
          all="Tất cả kết quả"
          filters={filters}
          options={{
            ...intakeLabels,
            passed: "Đã kiểm tra",
            rejected: "Đã từ chối",
          }}
          onChange={changeFilter}
        />
        <QueueSelect
          name="group"
          label="Nhóm"
          all="Tất cả nhóm"
          filters={filters}
          options={groups}
          onChange={changeFilter}
        />
        <QueueSelect
          name="ward"
          label="Phường/xã"
          all="Tất cả khu vực"
          filters={filters}
          options={{
            ...Object.fromEntries(wards.map((ward) => [ward, ward])),
            unknown: "Chưa xác định",
          }}
          onChange={changeFilter}
        />
        <QueueSelect
          name="staff"
          label="Cán bộ"
          all="Tất cả cán bộ"
          filters={filters}
          options={{ unassigned: "Chưa phân công", ...staffNames }}
          onChange={changeFilter}
        />
        <QueueSelect
          name="priority"
          label="Ưu tiên"
          all="Tất cả mức ưu tiên"
          filters={filters}
          options={{
            urgent: "Cần xem sớm",
            normal: "Thông thường",
            open: "Hồ sơ đang mở",
          }}
          onChange={changeFilter}
        />
      </fieldset>
      <div className="work-table-tools">
        <div className="work-table-count">
          <span role="status">{filtered.length} hồ sơ</span>
          {eligible.length > 0 && (
            <label>
              <input
                type="checkbox"
                aria-label="Chọn tất cả hồ sơ chưa phân công trên trang"
                checked={allChosen}
                disabled={busy}
                onChange={() => setSelected(allChosen ? [] : eligible)}
              />
              Chọn cả trang
            </label>
          )}
        </div>
        <div>
          {Object.values(filters).some(Boolean) && (
            <button
              type="button"
              className="work-text-button"
              disabled={busy}
              onClick={() => {
                setFilters(initialFilters);
                changePage(1);
                setError("");
                setMessage("");
              }}
            >
              Bỏ bộ lọc
            </button>
          )}
          <label>
            <select
              aria-label="Sắp xếp hồ sơ"
              value={filters.sort}
              disabled={busy}
              onChange={(event) => changeFilter("sort", event.target.value)}
            >
              <option value="">Mới nhất</option>
              <option value="priority">Ưu tiên trước</option>
            </select>
          </label>
        </div>
      </div>
      <ErrorMsg msg={error} />
      {message && (
        <p className="work-feedback" role="status">
          {message}
        </p>
      )}
      {chosen.length > 0 && (
        <form className="bulk-bar" onSubmit={assignSelected}>
          <strong>Đã chọn {chosen.length}</strong>
          {activeStaff.length ? (
            <>
              <select
                aria-label="Cán bộ nhận hồ sơ"
                value={officer}
                required
                disabled={busy}
                onChange={(event) => setOfficer(event.target.value)}
              >
                <option value="">Chọn cán bộ</option>
                {activeStaff.map((user) => (
                  <option value={user.id} key={user.id}>
                    {user.name}
                  </option>
                ))}
              </select>
              <button
                type="submit"
                className="btn green small"
                disabled={busy || !officer}
              >
                <UserCheck size={16} aria-hidden="true" />
                {busy
                  ? "Đang phân công…"
                  : "Phân công " + chosen.length + " hồ sơ"}
              </button>
            </>
          ) : (
            <a href="#/admin?tab=staff">Thêm cán bộ để phân công</a>
          )}
          <button
            type="button"
            className="work-text-button"
            disabled={busy}
            onClick={() => setSelected([])}
          >
            Bỏ chọn
          </button>
        </form>
      )}
      {visible.length ? (
        <table className="work-table" role="table">
          <thead>
            <tr>
              <th scope="col" aria-label="Chọn hồ sơ" />
              <th scope="col">Hồ sơ</th>
              <th scope="col">Nhóm</th>
              <th scope="col">Trạng thái</th>
              <th scope="col">Phụ trách</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((report) => (
              <tr key={report.id}>
                <td className="work-check">
                  {canAssign(report) && (
                    <input
                      type="checkbox"
                      aria-label={"Chọn hồ sơ " + report.id}
                      checked={chosen.includes(report.id)}
                      disabled={busy}
                      onChange={() =>
                        setSelected(
                          chosen.includes(report.id)
                            ? chosen.filter((id) => id !== report.id)
                            : [...chosen, report.id],
                        )
                      }
                    />
                  )}
                </td>
                <td className="work-report">
                  <a href={reportLink(report, route)}>{report.title}</a>
                  <small>
                    {report.id} · {dateText(report.created_at)}
                  </small>
                  <small>{report.ward || report.location}</small>
                </td>
                <td className="work-group">
                  <span className="work-cell-label">Nhóm</span>
                  {groups[reportGroup(report)] || "Chờ phân loại"}
                  {!report.confirmed_group && report.ai_group && (
                    <small>Gợi ý AI</small>
                  )}
                </td>
                <td className="work-state">
                  <span className="work-cell-label">Trạng thái</span>
                  <Status
                    value={report.status}
                    intakeState={report.intake_state}
                  />
                  {needsReview(report) && (
                    <small className="review-label">Cần xem sớm</small>
                  )}
                </td>
                <td className="work-owner">
                  <span className="work-cell-label">Phụ trách</span>
                  {staffNames[report.assignee] ||
                    (report.assignee
                      ? "Cán bộ #" + report.assignee
                      : "Chưa phân công")}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <Empty>Chưa có phản ánh phù hợp.</Empty>
      )}
      {pageCount > 1 && (
        <nav className="work-pagination" aria-label="Phân trang hồ sơ">
          <button
            type="button"
            className="icon-btn"
            aria-label="Trang trước"
            disabled={busy || currentPage === 1}
            onClick={() => changePage(currentPage - 1)}
          >
            <ChevronLeft size={18} />
          </button>
          <span>
            Trang {currentPage} / {pageCount}
          </span>
          <button
            type="button"
            className="icon-btn"
            aria-label="Trang sau"
            disabled={busy || currentPage === pageCount}
            onClick={() => changePage(currentPage + 1)}
          >
            <ChevronRight size={18} />
          </button>
        </nav>
      )}
    </section>
  );
}
