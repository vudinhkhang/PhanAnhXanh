import seeds from "./data.json";
import { hcmDay } from "./domain";
import { loadHcmAreas } from "./areas";
import { selectedArticles } from "./news-data";
const key = "pax-prototype-v3";
const dayMs = 86400000;
async function mockPassword(email, password) {
  const buffer = new TextEncoder().encode(email + "|" + password);
  const bytes = new Uint8Array(await crypto.subtle.digest("SHA-256", buffer));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}
function initial() {
  const today = hcmDay();
  const currentDay = Number(today.slice(8));
  return {
    users: [
      {
        id: 1,
        name: "Cán bộ mẫu",
        email: "canbo@demo.vn",
        role: "staff",
        password: "Demo1234",
        active: true,
        areas: [
          "Phường Chợ Quán, Thành phố Hồ Chí Minh",
          "Phường Tân Phú, Thành phố Hồ Chí Minh",
          "Phường Xuân Hoà, Thành phố Hồ Chí Minh",
          "Phường Sài Gòn, Thành phố Hồ Chí Minh",
        ],
      },
      {
        id: 2,
        name: "Quản trị mẫu",
        email: "quantri@demo.vn",
        role: "admin",
        password: "Demo1234",
        active: true,
        areas: [],
      },
      { id: 3, name: "Người dân demo", email: "nguoidan@demo.vn", role: "citizen", password: "Demo1234", active: true, areas: [] },
    ],
    reports: seeds.map(
      ([title, location, group, status, description, geo, photo], i) => {
        const day = 1 + Math.round(i * (currentDay - 1) / Math.max(1, seeds.length - 1));
        const created_at = new Date(today.slice(0, 8) + String(day).padStart(2, "0") + "T00:00:00+07:00").toISOString();
        return {
        id: "PX-MAU" + String(i + 1).padStart(3, "0"),
        title,
        pin: { lat: geo.lat, lng: geo.lng },
        ward: geo.ward,
        location,
        description,
        ai_group: group,
        ai_source: "clip",
        ai_summary: null,
        confirmed_group: status === "received" ? null : group,
        status,
        priority: "normal",
        photos: [photo],
        created_at,
        history: [{ status, note: "Trạng thái xử lý mô phỏng.", created_at }],
        public: true,
        assignee: status === "received" ? null : 1,
        owner: 3,
      }; }),
    ),
    me: null,
  };
}
const admitted = (r) =>
  r.intake_state === "passed" &&
  r.status !== "rejected" &&
  r.status !== "cancelled";
const waiting = (r) => ["pending", "review"].includes(r.intake_state);
const normalize = (value) =>
  value
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replaceAll("đ", "d")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
const staffScope = (r, user) =>
  Boolean(
    user && (r.assignee === user.id || (user.areas || []).includes(r.ward)),
  );
const staffCanHandle = (r, user) =>
  Boolean(
    user &&
      (r.assignee === user.id ||
        (r.assignee == null && (user.areas || []).includes(r.ward))),
  );
const readable = (r, user, receipts = []) =>
  Boolean(
    r &&
      ((r.public && admitted(r)) || receipts.includes(r.id) ||
        (user &&
          (user.role === "admin" ||
            (user.role === "staff" && staffScope(r, user)) ||
            user.id === r.owner))),
  );

function demoDuplicate(reports, report, group) {
  if (!group || group === "other") return;
  const address = normalize(report.location);
  return reports.find((item) => {
    if (
      item.id === report.id ||
      item.id.startsWith("PX-MAU") ||
      !admitted(item) ||
      item.status === "resolved" ||
      (item.confirmed_group || item.ai_group) !== group
    )
      return false;
    if (/^\d+\w* .+\b(phuong|xa) /.test(address) && address === normalize(item.location)) return true;
    if (!item.pin || !report.pin) return false;
    const latitude = (report.pin.lat - item.pin.lat) * 111195;
    const longitude =
      (report.pin.lng - item.pin.lng) *
      111195 *
      Math.cos((report.pin.lat * Math.PI) / 180);
    return Math.hypot(latitude, longitude) <= 30;
  });
}

function demoOutcome(reports, report, decision, group, note) {
  const duplicate =
    decision === "passed" && demoDuplicate(reports, report, group);
  report.intake_state = duplicate ? "rejected" : decision;
  report.intake_reason = duplicate ? "duplicate" : null;
  report.intake_note = duplicate
    ? "Đã có hồ sơ đang mở cùng nhóm vấn đề tại vị trí này."
    : note;
  report.duplicate_of = duplicate ? duplicate.id : null;
  report.ai_state = "done";
  if (report.intake_state === "rejected") report.status = "rejected";
  if (report.intake_note)
    report.history.unshift({
      status: report.status,
      note: report.intake_note,
      created_at: new Date().toISOString(),
    });
}

function publicReport(r) {
  const {
    ai_summary,
    ai_source,
    intake_note,
    intake_photos,
    duplicate_of,
    ...rest
  } = r;
  rest.resolved_at =
    r.status === "resolved" ? r.history.find((entry) => entry.status === "resolved")?.created_at ?? null : null;
  if (!rest.pin) return rest;
  return {
    ...rest,
    location: rest.ward || "Khu vực phản ánh",
    pin: {
      lat: Number(rest.pin.lat.toFixed(2)),
      lng: Number(rest.pin.lng.toFixed(2)),
      approximate: true,
    },
  };
}
export async function mock(path, method, data) {
  sessionStorage.removeItem("pax-prototype-v2");
  localStorage.removeItem("pax-prototype-v2");
  if (data?.password && data?.email) {
    const email = data.email.trim().toLowerCase();
    data = {
      ...data,
      email,
      password: await mockPassword(email, data.password),
    };
  }
  const state =
    JSON.parse(
      sessionStorage.getItem(key) || localStorage.getItem(key) || "null",
    ) || initial();
  state.localUpdates ??= [];
  for (const u of state.users) u.areas ||= [];
  for (const r of state.reports) {
    r.intake_state ||= r.status === "rejected" ? "rejected" : "passed";
  }
  const me = state.users.find((u) => u.id === state.me);
  const receipts = state.guestReceipts ??= [];
  const report = state.reports.find((r) => r.id === path.split("/")[2]);
  const editorial = state.editorialNews ??= [];
  let result;
  if (path === "/session") result = me || null;
  else if (path === "/community")
    result = {
      reports: state.reports
        .filter((r) => r.public && admitted(r))
        .map(publicReport),
      counts: Object.fromEntries(
        ["total", "received", "processing", "resolved"].map((s) => [
          s,
          state.reports.filter(
            (r) => admitted(r) && (s === "total" || r.status === s),
          ).length,
        ]),
      ),
    };
  else if (path === "/community/news") {
    const sampleSlugs = new Set(selectedArticles.map((article) => article.slug));
    result = {
      articles: [],
      editorial: editorial.filter((article) => article.published)
        .sort((a, b) => b.published_at.localeCompare(a.published_at))
        .map(({ content, updated_at, ...article }) => article),
      retired: editorial.filter((article) => !article.published && article.published_at && sampleSlugs.has(article.slug))
        .map((article) => article.slug),
    };
  } else if (path.startsWith("/community/news/")) {
    const article = editorial.find((item) => item.slug === path.split("/")[3] && item.published);
    if (!article) throw Error("Bài viết hiện không có trong bản tin.");
    result = { slug: article.slug, content: article.content };
  } else if (path === "/admin/news" || path.startsWith("/admin/news/")) {
    if (me?.role !== "admin") throw Error("Tài khoản chưa có quyền thực hiện thao tác này.");
    const slug = path.split("/")[3];
    const article = editorial.find((item) => item.slug === slug);
    const now = new Date().toISOString();
    if (path === "/admin/news" && method === "GET") {
      result = [...editorial].sort((a, b) => b.updated_at.localeCompare(a.updated_at));
    } else if (path === "/admin/news" && method === "POST") {
      const { replaces, ...fields } = data;
      if (replaces && !selectedArticles.some((item) => item.slug === replaces)) throw Error("Không tìm thấy bài mẫu để thay thế.");
      if (editorial.some((item) => item.slug === replaces)) throw Error("Bài viết đã có trong danh sách.");
      result = { ...fields, slug: replaces || "tin-" + crypto.randomUUID(), updated_at: now, published_at: fields.published ? now : null };
      editorial.unshift(result);
    } else if (article && (method === "PUT" || (method === "PATCH" && path.endsWith("/publication")))) {
      const { replaces, ...fields } = data;
      const publishedAt = fields.published && !article.published ? now : article.published_at;
      Object.assign(article, fields, { updated_at: now, published_at: publishedAt });
      result = article;
    } else throw Error("Không tìm thấy bài viết.");
  } else if (path === "/community/home") {
    const now = Date.now();
    const days = new Map(
      Array.from({ length: 30 }, (_, index) => [hcmDay(now - (29 - index) * dayMs), 0]),
    );
    for (const item of state.reports) {
      if (!item.public || !admitted(item)) continue;
      const day = hcmDay(item.created_at);
      if (days.has(day)) days.set(day, days.get(day) + 1);
    }
    result = {
      daily_counts: [...days].map(([day, count]) => ({ day, count })),
      local_updates: [],
    };
  } else if (path === "/admin/local-updates" || path.startsWith("/admin/local-updates/")) {
    if (me?.role !== "admin") throw Error("Tài khoản chưa có quyền thực hiện thao tác này.");
    const id = Number(path.split("/")[3]);
    const item = state.localUpdates.find((entry) => entry.id === id);
    if (path === "/admin/local-updates" && method === "GET") {
      result = state.localUpdates;
    } else if (method === "PATCH" && path.endsWith("/publication") && item) {
      item.published = data.published === true;
      result = item;
    } else if ((path === "/admin/local-updates" && method === "POST") || (method === "PUT" && item)) {
      const title = data.title?.trim();
      const summary = data.summary?.trim();
      if (!title || !summary || title.length > 120 || summary.length > 400) {
        throw Error("Kiểm tra tiêu đề và nội dung ngắn.");
      }
      if (!data.starts_on || !data.ends_on || data.ends_on < data.starts_on) {
        throw Error("Ngày kết thúc phải từ ngày bắt đầu trở đi.");
      }
      const source = URL.canParse(data.source_url) && new URL(data.source_url);
      if (!source || source.protocol !== "https:" || source.username || source.password) {
        throw Error("Dùng đường dẫn HTTPS tới nguồn thông tin.");
      }
      if (data.ward && !(await loadHcmAreas()).some((area) => area.name === data.ward)) {
        throw Error("Khu vực không thuộc TP. Hồ Chí Minh.");
      }
      const fields = {
        title, summary, ward: data.ward || null, source_url: source.href,
        starts_on: data.starts_on, ends_on: data.ends_on,
      };
      if (item) {
        Object.assign(item, fields);
        result = item;
      } else {
        result = { ...fields, id: Math.max(0, ...state.localUpdates.map((entry) => entry.id)) + 1, published: false };
        state.localUpdates.push(result);
      }
    } else {
      throw Error("Không tìm thấy thông tin địa phương.");
    }
  } else if (path === "/login") {
    result = state.users.find((u) => u.email === data.email && u.active);
    if (
      !result ||
      (result.id <= 3
        ? await mockPassword(result.email, result.password)
        : result.password) !== data.password
    )
      throw Error("Email hoặc mật khẩu chưa đúng.");
    state.me = result.id;
    state.remember = Boolean(data.remember);
  } else if (path === "/register") {
    if (state.users.some((u) => u.email === data.email))
      throw Error("Email đã được sử dụng.");
    const { remember, ...fields } = data;
    result = { ...fields, id: Date.now(), role: "citizen", active: true };
    state.users.push(result);
    state.me = result.id;
    state.remember = Boolean(remember);
  } else if (path === "/notifications")
    result = state.reports.filter(
      (r) =>
        (r.urgent || r.priority === "high") &&
        !["resolved", "rejected", "cancelled"].includes(r.status) &&
        (me?.role === "admin" || staffScope(r, me)),
    );
  else if (path === "/user-notifications") {
    const stNames = {
      received: "Đã tiếp nhận",
      processing: "Đang xử lý",
      resolved: "Đã xử lý",
      rejected: "Đã từ chối",
      cancelled: "Đã hủy",
    };
    const staffNames = new Map(state.users.map((u) => [u.id, u.name]));
    const visible = me
      ? state.reports.filter((r) =>
          me.role === "admin"
            ? true
            : me.role === "staff"
              ? staffScope(r, me)
              : r.owner === me.id,
        )
      : [];
    const urgentItems =
      me && me.role !== "citizen"
        ? visible
            .filter(
              (r) =>
                (r.urgent || r.priority === "high") &&
                !["resolved", "rejected", "cancelled"].includes(r.status),
            )
            .map((r) => ({
              id: "u:" + r.id,
              report_id: r.id,
              kind: "urgent",
              title: `[Khẩn cấp] Đơn #${r.id} cần xem xét sớm`,
              detail:
                r.title +
                " · " +
                (r.assignee
                  ? (staffNames.get(r.assignee) || "Cán bộ") + " phụ trách"
                  : "Chưa phân công cán bộ"),
              created_at: r.created_at,
            }))
        : [];
    const histItems = [];
    for (const r of visible) {
      if (r.history?.length) {
        r.history.forEach((h, idx) => {
          const note = h.note || "";
          if (note.startsWith("Đã phân công ")) {
            const officer =
              staffNames.get(r.assignee) ||
              note
                .replace("Đã phân công ", "")
                .replace(" phụ trách.", "")
                .trim() ||
              "Cán bộ";
            histItems.push({
              id: `h:${r.id}:${idx}`,
              report_id: r.id,
              kind: "assigned",
              title: `${officer} đã tiếp nhận đơn #${r.id}`,
              detail: `${r.title} — ${note}`,
              created_at: h.created_at,
            });
          } else if (h.status === "cancelled") {
            histItems.push({
              id: `h:${r.id}:${idx}`,
              report_id: r.id,
              kind: "cancelled",
              title: `Hồ sơ #${r.id} đã bị hủy`,
              detail: `${r.title} — Lý do: ${note}`,
              created_at: h.created_at,
            });
          } else if (h.status === "rejected") {
            histItems.push({
              id: `h:${r.id}:${idx}`,
              report_id: r.id,
              kind: "rejected",
              title: `Đơn #${r.id} đã bị từ chối`,
              detail: `${r.title} — ${note}`,
              created_at: h.created_at,
            });
          } else {
            const officer = staffNames.get(r.assignee) || "Cán bộ phụ trách";
            histItems.push({
              id: `h:${r.id}:${idx}`,
              report_id: r.id,
              kind: h.status,
              title: `${officer} chuyển trạng thái sang "${stNames[h.status] || h.status}" · #${r.id}`,
              detail: `${r.title} — ${note}`,
              created_at: h.created_at,
            });
          }
        });
      } else if (me?.role === "citizen") {
        histItems.push({
          id: "r:" + r.id,
          report_id: r.id,
          kind: "received",
          title: `Đã tiếp nhận đơn #${r.id}`,
          detail: `${r.title} — Đang chờ phân công cán bộ xử lý.`,
          created_at: r.created_at,
        });
      }
    }
    result = {
      urgent_count:
        me?.role === "citizen"
          ? urgentItems.length + histItems.length
          : urgentItems.length,
      items: [...urgentItems, ...histItems].slice(0, 20),
    };
  } else if (path === "/logout") {
    state.me = null;
    state.remember = false;
    localStorage.removeItem(key);
    result = {};
  } else if (path === "/profile" && method === "PATCH") {
    if (!me) throw Error("Vui lòng đăng nhập.");
    if (data?.name) me.name = data.name.trim();
    if (data?.password) {
      me.password =
        me.id <= 3
          ? data.password
          : await mockPassword(me.email, data.password);
    }
    result = {
      id: me.id,
      name: me.name,
      email: me.email,
      role: me.role,
      active: me.active,
      areas: me.areas || [],
    };
  } else if (path === "/geocode/config") {
    result = {
      goong_api_key: "",
      goong_map_key: "8K7ueiGj67N8nImjImdepvpxcImsPUqfsmhE1fNk",
    };
  } else if (path.startsWith("/geocode/reverse")) {
    result = { ward: "Phường Chợ Quán, Thành phố Hồ Chí Minh", in_hcm: true };
  } else if (path === "/admin/users" && method === "GET") {
    result = state.users.map((u) => ({
      id: u.id,
      name: u.name,
      email: u.email,
      role: u.role,
      active: u.active,
      areas: u.areas || [],
      submitted_count: state.reports.filter((r) => r.owner === u.id).length,
      rejected_count: state.reports.filter(
        (r) => r.owner === u.id && r.status === "rejected",
      ).length,
      assigned_open_count: state.reports.filter(
        (r) =>
          r.assignee === u.id &&
          !["resolved", "rejected", "cancelled"].includes(r.status),
      ).length,
      assigned_resolved_count: state.reports.filter(
        (r) => r.assignee === u.id && r.status === "resolved",
      ).length,
    }));
  } else if (path === "/admin/users" && method === "POST") {
    if (state.users.some((u) => u.email === data.email))
      throw Error("Email đã được sử dụng.");
    const role = data.role || "staff";
    result = {
      ...data,
      id: Date.now(),
      role,
      active: true,
      areas: role === "staff" ? data.areas || [] : [],
      submitted_count: 0,
      rejected_count: 0,
      assigned_open_count: 0,
      assigned_resolved_count: 0,
    };
    state.users.push(result);
  } else if (path.startsWith("/admin/users/") && method === "PATCH") {
    const uid = Number(path.split("/")[3]);
    if (
      uid === me?.id &&
      (data.active === false || (data.role && data.role !== "admin"))
    )
      throw Error(
        "Không thể tự khóa hoặc hạ quyền tài khoản quản trị đang đăng nhập.",
      );
    result = state.users.find((u) => u.id === uid);
    Object.assign(result, data);
    if (result.role !== "staff") result.areas = [];
    if (data?.password) {
      result.password =
        result.id <= 3
          ? data.password
          : await mockPassword(result.email, data.password);
    }
  } else if (path === "/staff" && method === "GET")
    result = state.users.filter((u) => u.role === "staff");
  else if (path === "/staff" && method === "POST") {
    if (state.users.some((u) => u.email === data.email))
      throw Error("Email đã được sử dụng.");
    result = {
      ...data,
      id: Date.now(),
      role: "staff",
      active: true,
      areas: data.areas || [],
    };
    state.users.push(result);
  } else if (path.startsWith("/staff/")) {
    result = state.users.find((u) => u.id === Number(path.split("/")[2]));
    Object.assign(result, data);
  } else if (path === "/reports/analyze-photos" && method === "POST") {
    const count = Array.isArray(data?.photos) ? data.photos.length : 0;
    result = {
      group: "waste",
      group_label: "Rác thải",
      urgent: false,
      confidence: 0.78,
      quality_ok: true,
      status_text: "Ảnh rõ nét · Nhận diện: Rác thải",
      warnings: [],
      suggestions: [
        "Rác thải sinh hoạt tồn đọng thành đống trên vỉa hè/lòng đường, gây mùi hôi và mất mỹ quan.",
        "Thùng rác công cộng quá tải hoặc có điểm đổ trộm rác thải bừa bãi chưa được thu gom.",
      ],
      metrics: Array.from({ length: count }, () => ({ brightness: 128, sharpness: 120 })),
    };
  } else if (path === "/reports" && method === "POST") {
    const owner = me?.id ?? null;
    const cutoff = Date.now() - 15 * 60000;
    if (state.reports.filter((r) => r.owner === owner && Date.parse(r.created_at) > cutoff).length >= (me ? 15 : 8)) {
      throw Error("Bạn đã gửi quá nhiều lần. Vui lòng thử lại sau ít phút.");
    }
    const text = normalize(data.description);
    const group =
      [
        [/ca chet|nuoc thai|nuoc kenh/, "water"],
        [/rac/, "waste"],
        [/khoi|bui/, "dust"],
        [/tieng on|karaoke/, "noise"],
        [/ngap|tac cong/, "flood"],
        [/cay/, "tree"],
        [/hoa chat|tran dau/, "hazard"],
      ].find(([pattern]) => pattern.test(text))?.[1] || null;
    const item = {
      ...data,
      title: data.description.slice(0, 85),
      id: "PX-" + crypto.randomUUID().slice(0, 8).toUpperCase(),
      owner,
      created_at: new Date().toISOString(),
      status: "received",
      ai_group: group,
      ai_source: "clip",
      confirmed_group: null,
      priority: "normal",
      ward: data.pin ? "Phường Chợ Quán, Thành phố Hồ Chí Minh" : null,
      history: [],
      assignee: null,
    };
    const compact = text.replaceAll(" ", "");
    const invalid =
      !/[a-z]/.test(compact) ||
      new Set(compact).size <= 2 ||
      /^(?:(?:test\d*|asdf\w*|qwerty\w*|xin chao|hello|dit me|du ma|vai lon|dmm?|cc|cl)\s*)+$/.test(text) ||
      /^(?:(?:https?:\/\/|www\.)\S+\s*)+$/i.test(data.description.trim());
    const decision = invalid ? "rejected" : group ? "passed" : "review";
    const note = invalid
      ? "Mô tả chưa nêu sự việc cụ thể."
      : group
        ? null
        : "Cần cán bộ kiểm tra thêm mô tả hoặc ảnh hiện trường.";
    demoOutcome(state.reports, item, decision, group, note);
    if (invalid) item.intake_reason = "desc_invalid";
    state.reports.unshift(item);
    if (!me) receipts.push(item.id);
    result = { id: item.id, status: "received", intake_state: "pending" };
  } else if (path.startsWith("/reports/nearby") && method === "GET") {
    const query = new URLSearchParams(path.split("?")[1] || "");
    const lat = Number(query.get("lat"));
    const lng = Number(query.get("lng"));
    const items = [];
    if (Number.isFinite(lat) && Number.isFinite(lng)) {
      for (const item of state.reports) {
        if (
          !admitted(item) ||
          !["received", "processing"].includes(item.status) ||
          !item.pin ||
          item.id.startsWith("PX-MAU")
        )
          continue;
        const dLat = (lat - item.pin.lat) * 111195;
        const dLng =
          (lng - item.pin.lng) * 111195 * Math.cos((lat * Math.PI) / 180);
        const dist = Math.hypot(dLat, dLng);
        if (dist <= 50) {
          const isPublic = Boolean(item.public);
          items.push({
            id: isPublic ? item.id : null,
            title: isPublic
              ? item.title
              : "Có phản ánh tương tự đang được xử lý gần vị trí này",
            group: item.confirmed_group || item.ai_group || "other",
            status: item.status,
            distance_m: Math.round(dist),
            public: isPublic,
          });
        }
      }
      items.sort((a, b) => a.distance_m - b.distance_m);
    }
    result = { items: items.slice(0, 3) };
  } else if (path === "/reports") {
    result = state.reports.filter((r) =>
      me?.role === "admin"
        ? true
        : me?.role === "staff"
          ? staffScope(r, me)
          : r.owner === me?.id,
    );
  } else if (path === "/admin/reports/bulk-assign" && method === "POST") {
    if (me?.role !== "admin")
      throw Error("Bạn không có quyền thực hiện thao tác này.");
    const officer = state.users.find(
      (u) => u.id === data.assignee && u.role === "staff" && u.active,
    );
    const ids = new Set(data.report_ids);
    if (
      !officer ||
      !ids.size ||
      ids.size > 20 ||
      ids.size !== data.report_ids.length
    ) {
      throw Error("Kiểm tra lại cán bộ và các hồ sơ đã chọn.");
    }
    const cases = state.reports.filter((r) => ids.has(r.id));
    if (
      cases.length !== ids.size ||
      cases.some(
        (r) =>
          r.assignee ||
          !admitted(r) ||
          !["received", "processing"].includes(r.status),
      )
    ) {
      throw Error("Danh sách đã thay đổi. Kiểm tra lại hồ sơ chưa phân công.");
    }
    for (const item of cases) {
      item.assignee = officer.id;
      item.history.unshift({
        status: item.status,
        note: "Đã phân công " + officer.name + " phụ trách.",
        created_at: new Date().toISOString(),
      });
    }
    result = { assigned: cases.length };
  } else if (path === "/admin/ai-briefing" && method === "POST") {
    const open = state.reports.filter(
      (r) => !["resolved", "rejected", "cancelled"].includes(r.status),
    );
    const active = state.users.filter((u) => u.role === "staff" && u.active);
    const recommended = active[0]
      ? {
          id: active[0].id,
          name: active[0].name,
          open_count: open.filter((r) => r.assignee === active[0].id).length,
        }
      : null;
    result = {
      unassigned_count: open.filter((r) => !r.assignee).length,
      urgent_count: open.filter((r) => r.urgent || r.priority === "high")
        .length,
      rejected_count: state.reports.filter((r) => r.status === "rejected")
        .length,
      resolved_rate: state.reports.length
        ? Math.round(
            (100 *
              state.reports.filter((r) => r.status === "resolved").length) /
              state.reports.length,
          )
        : 0,
      hotspots: [],
      top_group: "waste",
      recommended_staff: recommended,
      recommendations: [
        "Ưu tiên xử lý các hồ sơ khẩn cấp và các điểm ngập/rác tồn đọng tại TP. HCM.",
        recommended
          ? "Cân bằng tải: ưu tiên phân công cho " + recommended.name + "."
          : "Chưa có cán bộ đang hoạt động.",
      ],
      source: "local",
    };
  } else if (path.endsWith("/ai-assist") && method === "POST") {
    if (me?.role === "staff" && !staffCanHandle(report, me))
      throw Error("Hồ sơ chưa được phân công cho bạn hoặc nằm ngoài khu vực của bạn.");
    const g = report.confirmed_group || report.ai_group || "other";
    result = {
      confirmed_group: g,
      priority: report.urgent || report.priority === "high" ? "high" : "normal",
      unit: "UBND phường/xã & đơn vị môi trường TP.HCM",
      action_steps: [
        "Kiểm tra hiện trường tại " + (report.ward || report.location) + ".",
        "Phối hợp đơn vị chuyên trách xử lý dứt điểm và cập nhật ảnh/phản hồi.",
      ],
      draft_note:
        "Tiếp nhận hồ sơ " +
        report.id +
        " tại " +
        (report.ward || report.location) +
        ". Bộ phận phụ trách đang phối hợp kiểm tra và xử lý theo quy trình.",
      source: "local",
    };
  } else if (path.endsWith("/intake-review") && method === "POST") {
    if (
      !["admin", "staff"].includes(me?.role) ||
      (me?.role === "staff" && !staffScope(report, me)) ||
      report?.intake_state !== "review"
    )
      throw Error("Hồ sơ hiện không nằm trong hàng chờ duyệt.");
    const accepting = data.decision === "accept";
    if ((accepting && !data.group) || (!accepting && !data.note))
      throw Error("Chọn nhóm để tiếp nhận hoặc nhập lý do từ chối.");
    demoOutcome(
      state.reports,
      report,
      accepting ? "passed" : "rejected",
      data.group,
      data.note || "Cán bộ đã tiếp nhận hồ sơ sau khi kiểm tra.",
    );
    if (admitted(report)) {
      report.confirmed_group = data.group;
      if (data.assignee != null && me?.role === "admin") {
        const officer = state.users.find(
          (u) => u.id === Number(data.assignee) && u.role === "staff" && u.active,
        );
        if (officer) {
          report.assignee = officer.id;
          report.history.unshift({
            status: report.status,
            note: "Đã phân công " + officer.name + " phụ trách.",
            created_at: new Date().toISOString(),
          });
        }
      }
    }
    result = {
      intake_state: report.intake_state,
      intake_reason: report.intake_reason,
    };
  } else if (path.endsWith("/reanalyze") && method === "POST") {
    if (!(
      me?.role === "admin" ||
      (me?.role === "staff" &&
        staffScope(report, me) &&
        report?.intake_state === "review")
    ))
      throw Error("Bạn không có quyền thực hiện thao tác này.");
    report.ai_source = report.ai_consent ? "deepseek" : "clip";
    report.ai_summary =
      report.ai_summary || "Ảnh hiện trường đã được phân tích lại (demo).";
    result = report;
  } else if (path.endsWith("/claim") && method === "POST") {
    if (me?.role !== "staff")
      throw Error("Bạn không có quyền thực hiện thao tác này.");
    if (!report || waiting(report))
      throw Error("Hồ sơ chưa qua kiểm tra tiếp nhận.");
    if (!["received", "processing"].includes(report.status))
      throw Error("Hồ sơ đã đóng, không thể nhận xử lý.");
    if (report.assignee !== me.id) {
      if (!staffCanHandle(report, me))
        throw Error(
          "Hồ sơ đã có cán bộ phụ trách hoặc nằm ngoài khu vực của bạn.",
        );
      report.assignee = me.id;
      report.history.unshift({
        status: report.status,
        note: "Đã phân công " + me.name + " phụ trách.",
        created_at: new Date().toISOString(),
      });
    }
    result = { ok: true };
  } else if (
    path.endsWith("/update") ||
    path.endsWith("/assign") ||
    path.endsWith("/reopen")
  ) {
    if (!path.endsWith("/reopen") && waiting(report))
      throw Error("Hồ sơ chưa qua kiểm tra tiếp nhận.");
    if (
      !path.endsWith("/reopen") &&
      ["resolved", "rejected", "cancelled"].includes(report.status)
    )
      throw Error("Hồ sơ đã đóng. Quản trị viên có thể mở lại.");
    if (
      path.endsWith("/reopen") &&
      !["resolved", "rejected", "cancelled"].includes(report.status)
    )
      throw Error("Chỉ mở lại hồ sơ đã xử lý, đã hủy hoặc đã từ chối.");
    if (path.endsWith("/update") && me?.role === "staff") {
      if (!staffCanHandle(report, me))
        throw Error(
          "Hồ sơ chưa được phân công cho bạn hoặc nằm ngoài khu vực của bạn.",
        );
      if (report.assignee == null) report.assignee = me.id;
    }
    if (
      path.endsWith("/update") &&
      data.status !== "cancelled" &&
      !data.confirmed_group
    )
      throw Error("Vui lòng chọn nhóm xác nhận.");
    if (path.endsWith("/reopen") && report.status === "rejected") {
      Object.assign(report, {
        intake_state: "review",
        intake_note: "Quản trị viên mở lại để kiểm tra.",
        intake_reason: null,
        duplicate_of: null,
        assignee: null,
      });
    }
    const { confirmed_group: _cg, photos: updatePhotos, ...restPatch } = data;
    const patch =
      path.endsWith("/update") && !data.confirmed_group
        ? restPatch
        : { ...restPatch, confirmed_group: data.confirmed_group };
    Object.assign(report, patch);
    if (path.endsWith("/reopen")) report.status = "received";
    const evidencePhotos =
      path.endsWith("/update") &&
      data.status !== "cancelled" &&
      Array.isArray(updatePhotos)
        ? updatePhotos.slice(0, 3)
        : [];
    report.history.unshift({
      status: report.status,
      note: data.note || "Đã phân công cán bộ phụ trách.",
      photos: evidencePhotos,
      created_at: new Date().toISOString(),
    });
    result = report;
  } else if (readable(report, me, receipts)) {
    const base =
      receipts.includes(report.id) || (me && (me.role === "admin" || me.id === report.owner || (me.role === "staff" && staffScope(report, me))))
        ? report
        : publicReport(report);
    result = { ...base, advice: mockAdvice(report) };
    if (
      result.duplicate_of &&
      !readable(
        state.reports.find((r) => r.id === result.duplicate_of),
        me,
        receipts,
      )
    ) {
      delete result.duplicate_of;
    }
  } else throw Error("Không tìm thấy hồ sơ hoặc bạn chưa có quyền xem.");
  const serialized = JSON.stringify(state);
  sessionStorage.setItem(key, serialized);
  if (state.remember && state.me) localStorage.setItem(key, serialized);
  else localStorage.removeItem(key);
  return result;
}
function mockAdvice(r) {
  if (!r || (r.ai_state === "pending" && !r.ai_group && !r.confirmed_group)) {
    return null;
  }
  const group = r.confirmed_group || r.ai_group || "other";
  const text =
    `${r.title || ""} ${r.summary || ""} ${r.ai_summary || ""}`.toLowerCase();
  if (r.status === "cancelled") return null;
  if (r.status === "rejected") {
    return {
      level: "warning",
      title: "Hồ sơ ngoài phạm vi môi trường đô thị",
      hotlines: [
        {
          number: "1022",
          label: "Cổng 1022 TP.HCM",
          note: "Hỗ trợ phản ánh đô thị 24/7",
        },
      ],
      tips: [
        "Chụp rõ sự cố môi trường tại hiện trường và gửi lại hồ sơ mới nếu cần.",
      ],
    };
  }
  if (
    /(^|[^\wÀ-ỹ])(cháy|hỏa hoạn|nổ|rò rỉ gas|mùi gas|hóa chất|khí độc)([^\wÀ-ỹ]|$)/.test(
      text,
    )
  ) {
    const hotlines = [
      {
        number: "114",
        label: "PCCC & Cứu nạn",
        note: "Khẩn cấp cháy nổ, rò rỉ gas, hóa chất",
      },
    ];
    if (/(ngộ độc|khó thở|ngạt|bị thương|bỏng)/.test(text)) {
      hotlines.push({
        number: "115",
        label: "Cấp cứu Y tế",
        note: "Hỗ trợ người bị nạn",
      });
    }
    return {
      level: "emergency",
      title: "Khẩn cấp: Nguy cơ cháy nổ / hóa chất",
      hotlines,
      tips: [
        "Sơ tán khỏi vùng nguy hiểm, di chuyển ngược chiều gió.",
        "Không bật lửa hoặc đóng ngắt điện gần nơi rò rỉ gas.",
        "Nhường lối cho xe cứu hỏa 114 tiếp cận hiện trường.",
      ],
    };
  }
  if (group === "tree" || /(cây đổ|cây gãy|dây điện|cột điện)/.test(text)) {
    return {
      level:
        r.urgent || /(dây điện|đè|gãy đổ)/.test(text) ? "emergency" : "warning",
      title: "Cảnh báo cây đổ / nguy cơ sự cố điện",
      hotlines: [
        {
          number: "1022",
          label: "Cổng 1022 TP.HCM",
          note: "Điều phối xử lý cây xanh & hạ tầng",
        },
        {
          number: "1900 545454",
          label: "Điện lực TP.HCM",
          note: "Xử lý dây điện đứt, cây vướng lưới điện",
        },
        {
          number: "114",
          label: "Cứu nạn 114",
          note: "Ứng cứu khi cây đè người hoặc phương tiện",
        },
      ],
      tips: [
        "Giữ khoảng cách tối thiểu 10m nếu có dây điện sà thấp hoặc đứt rơi.",
        "Không tự ý kéo, cắt cành cây khi chưa cắt điện an toàn.",
        "Cảnh báo người đi đường tránh khu vực gốc bật rễ.",
      ],
    };
  }
  if (group === "flood") {
    return {
      level: r.urgent ? "emergency" : "warning",
      title: "Cảnh báo an toàn khu vực ngập úng",
      hotlines: [
        {
          number: "1022",
          label: "Cổng 1022 TP.HCM",
          note: "Báo ngập, tắc cống, mất nắp hố ga",
        },
        {
          number: "114",
          label: "Cứu nạn 114",
          note: "Hỗ trợ khi ngập sâu nguy hiểm",
        },
      ],
      tips: [
        "Tránh lội sát trụ điện, tủ điện và hố ga nghi mất nắp.",
        "Ngắt cầu dao tổng nếu nước tràn vào khu vực ổ điện thấp.",
        "Không cố vượt đoạn ngập sâu quá nửa bánh xe.",
      ],
    };
  }
  if (group === "noise") {
    return {
      level: "info",
      title: "Hướng dẫn xử lý tiếng ồn & vi phạm tại chỗ",
      hotlines: [
        {
          number: "113",
          label: "Cảnh sát 113",
          note: "Hỗ trợ tiếng ồn ban đêm, mất ANTT",
        },
        {
          number: "1022",
          label: "Cổng 1022 TP.HCM",
          note: "Chuyển UBND phường/xã kiểm tra",
        },
      ],
      tips: [
        "Giữ bình tĩnh và ghi nhận khung giờ diễn ra sự việc.",
        "Gọi 113 nếu vi phạm kéo dài sau 22h ảnh hưởng khu dân cư.",
        "Theo dõi tiến độ xử lý trên mã hồ sơ.",
      ],
    };
  }
  return {
    level: r.urgent || group === "hazard" ? "warning" : "info",
    title: "Lưu ý an toàn khi chờ xử lý",
    hotlines:
      group === "hazard"
        ? [
            {
              number: "114",
              label: "PCCC & Cứu nạn",
              note: "Xử lý khẩn chất thải nguy hại",
            },
            {
              number: "1022",
              label: "Cổng 1022 TP.HCM",
              note: "Điều phối thu gom xử lý",
            },
          ]
        : [
            {
              number: "1022",
              label: "Cổng 1022 TP.HCM",
              note: "Theo dõi và hỗ trợ 24/7",
            },
          ],
    tips: [
      "Giữ khoảng cách an toàn, không tự ý đốt hoặc chạm trực tiếp chất thải lạ.",
      "Cảnh báo người xung quanh nếu sự cố ảnh hưởng giao thông.",
      "Gọi ngay 114 nếu phát sinh nguy cơ cháy nổ hoặc rò rỉ hóa chất.",
    ],
  };
}
