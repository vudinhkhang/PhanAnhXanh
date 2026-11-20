import {
  Trash2,
  Waves,
  Wind,
  Volume2,
  CloudRain,
  TreePine,
  TriangleAlert,
  Trees,
} from "lucide-react";
export const groups = {
  waste: "Rác thải",
  water: "Ô nhiễm nước",
  dust: "Khói và bụi",
  noise: "Tiếng ồn",
  flood: "Ngập nước và tắc cống",
  tree: "Cây xanh và cảnh quan",
  hazard: "Hóa chất và chất thải nguy hại",
  other: "Vấn đề môi trường khác",
};
export const groupIcons = {
  waste: Trash2,
  water: Waves,
  dust: Wind,
  noise: Volume2,
  flood: CloudRain,
  tree: TreePine,
  hazard: TriangleAlert,
  other: Trees,
};
export const statuses = {
  received: "Đã tiếp nhận",
  processing: "Đang xử lý",
  resolved: "Đã xử lý",
  rejected: "Đã từ chối",
  cancelled: "Đã hủy",
};
export const isClosed = (report) =>
  ["resolved", "rejected", "cancelled"].includes(report?.status);
export const priorities = { normal: "Thông thường", high: "Cần xem xét sớm" };
export const intakeLabels = { pending: "Đang kiểm tra", review: "Chờ duyệt" };
export const awaitingIntake = (report) =>
  Boolean(intakeLabels[report.intake_state]);
export const roles = {
  citizen: "Người dân",
  staff: "Cán bộ",
  admin: "Quản trị viên",
};
export const dateText = (value) =>
  new Intl.DateTimeFormat("vi-VN", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(new Date(value));
const hcmCalendar = new Intl.DateTimeFormat("sv-SE", {
  timeZone: "Asia/Ho_Chi_Minh", year: "numeric", month: "2-digit", day: "2-digit",
});
export const hcmDay = (value = Date.now()) => hcmCalendar.format(new Date(value));
export const calendarDateText = (day) => day.split("-").reverse().join("/");

export function navigate(path) {
  location.hash = path;
}
export function communityPath({ mapView = false, ward = "", group = "" }) {
  const query = new URLSearchParams();
  if (mapView) query.set("view", "map");
  if (ward) query.set("ward", ward);
  if (group) query.set("group", group);
  const search = query.toString();
  return "/community" + (search ? "?" + search : "");
}
export function adminSection(hash) {
  const [path, query] = hash.split("?");
  if (path.startsWith("/report/")) return "reports";
  if (path === "/profile") return "profile";
  const tab = new URLSearchParams(query).get("tab");
  if (tab === "notice") return "reports";
  if (["reports", "staff", "users", "stats", "news"].includes(tab)) return tab;
  return "overview";
}
export function staffSection(hash) {
  const [path, query] = hash.split("?");
  if (path.startsWith("/report/")) return "reports";
  if (path === "/profile") return "profile";
  const tab = new URLSearchParams(query).get("tab");
  if (["map", "reports", "review", "notice"].includes(tab)) return tab;
  return "overview";
}
export async function api(path, method = "GET", body) {
  if (import.meta.env.MODE === "demo") {
    const { mock } = await import("./mock.js");
    return mock(path, method, body);
  }
  const response = await fetch("/api" + path, {
    method,
    headers: body ? { "Content-Type": "application/json" } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await response
    .json()
    .catch(() => ({ detail: "Chưa kết nối được máy chủ. Vui lòng thử lại." }));
  if (!response.ok)
    throw Error(
      typeof data.detail === "string"
        ? data.detail
        : "Vui lòng kiểm tra thông tin đã nhập.",
    );
  return data;
}
