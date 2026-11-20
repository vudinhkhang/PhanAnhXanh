import { test, expect } from "@playwright/test";

test("Số khẩn cấp ở cuối trang chủ và hiển thị đúng ở trang Liên hệ", async ({ page }) => {
  await page.goto("/#/");
  const note = page.getByRole("note", { name: "Số điện thoại khẩn cấp" });
  await expect(page.locator(".landing-wrap > .emergency:last-child")).toBeVisible();
  const footer = page.getByRole("contentinfo");
  expect((await note.boundingBox()).y).toBeLessThan((await footer.boundingBox()).y);
  await expect(footer.getByRole("link", { name: "Góp ý về website" })).toHaveAttribute("href", "#/contact");
  const legal = footer.getByRole("navigation", { name: "Điều khoản và quyền riêng tư" });
  await expect(legal.getByRole("link", { name: "Quyền riêng tư" })).toHaveAttribute("href", "#/privacy");
  await expect(legal.getByRole("link", { name: "Điều khoản sử dụng" })).toHaveAttribute("href", "#/terms");
  await expect(note.getByRole("link", { name: "113 Công an" })).toHaveAttribute("href", "tel:113");
  await expect(note.getByRole("link", { name: "114 Cứu hỏa, cứu nạn" })).toHaveAttribute("href", "tel:114");
  await expect(note.getByRole("link", { name: "115 Cấp cứu y tế" })).toHaveAttribute("href", "tel:115");
  await expect(note.locator("a svg[aria-hidden='true']")).toHaveCount(3);
  await page.goto("/#/contact");
  await expect(note.locator("p")).toHaveCSS("display", "block");
  await expect(note.getByRole("link")).toHaveCount(3);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test("Header mở được gửi phản ánh, tra cứu hồ sơ và tin môi trường", async ({ page }) => {
  await page.goto("/#/");
  const header = page.getByRole("banner");
  const menu = header.getByRole("button", { name: "Mở menu", exact: true });
  if (await menu.isVisible()) await menu.click();
  const nav = header.getByRole("navigation", { name: "Điều hướng chính" });
  await expect(header.getByRole("link", { name: "Gửi phản ánh", exact: true })).toHaveAttribute("href", "#/new");
  await expect(nav.getByRole("link", { name: "Tin môi trường", exact: true })).toHaveAttribute("href", "#/news");
  await nav.getByRole("link", { name: "Tra cứu hồ sơ", exact: true }).click();
  await expect(page).toHaveURL(/#\/track$/);
  await expect(page.getByRole("textbox", { name: "Mã hồ sơ" })).toBeVisible();
  if (await menu.isVisible()) await menu.click();
  await header.getByRole("link", { name: "Gửi phản ánh", exact: true }).click();
  await expect(page.getByLabel("Mô tả sự việc")).toBeVisible();
});

test("Trang chủ tra cứu, lọc kết quả, mở bản đồ theo phường và đọc số liệu", async ({ page }) => {
  await page.goto("/#/");
  const recent = page.getByRole("region", { name: "Phản ánh gần đây" });
  await expect(recent.locator(".report-card").first()).toBeVisible();
  const heading = recent.getByRole("heading", { name: "Phản ánh gần đây" });
  await expect(heading).toHaveCSS("text-align", "left");
  await expect(recent.getByRole("group", { name: "Lọc phản ánh gần đây" })).toHaveCSS("justify-content", "flex-start");

  const map = page.getByRole("region", { name: "Bản đồ phản ánh", exact: true });
  const surface = map.getByRole("region", { name: "Bản đồ phản ánh cộng đồng" });
  await expect(surface).toHaveCount(0);
  const resolved = recent.getByRole("button", { name: "Đã xử lý", exact: true });
  await resolved.click();
  await expect(resolved).toHaveAttribute("aria-pressed", "true");
  await expect(recent.locator(".report-card").first()).toContainText("Đã xử lý");
  expect((await recent.locator(".report-card .status").allTextContents()).every(
    (status) => status === "Đã xử lý",
  )).toBe(true);
  await recent.getByRole("button", { name: "Mới nhất", exact: true }).click();
  const first = recent.locator(".report-card").first();
  const reportPath = await first.getAttribute("href");
  const reportCode = reportPath.split("/").pop();

  await page.getByRole("button", { name: "Tra cứu hồ sơ", exact: true }).click();
  const lookup = page.getByRole("form", { name: "Tra cứu bằng mã hồ sơ" });
  const code = lookup.getByRole("textbox", { name: "Mã hồ sơ" });
  await expect(code).toBeFocused();
  await code.fill("PX-KHONGCO");
  await lookup.getByRole("button", { name: "Tra cứu", exact: true }).click();
  await expect(lookup.getByRole("alert")).toContainText("Không tìm thấy hồ sơ");
  await code.fill("../community");
  await code.press("Enter");
  await expect(lookup.getByRole("alert")).toContainText("Không tìm thấy hồ sơ");
  await code.fill(" " + reportCode.toLowerCase() + " ");
  await code.press("Enter");
  await expect(page).toHaveURL(new RegExp(reportCode + "$"));

  await page.goto("/#/");
  await map.scrollIntoViewIfNeeded();
  await expect(surface).toBeVisible();
  const wards = map.getByRole("combobox", { name: "Phường/xã", exact: true });
  const ward = await wards.locator("option").nth(1).getAttribute("value");
  await wards.selectOption(ward);
  await map.getByRole("link", { name: "Mở bản đồ đầy đủ" }).click();
  expect(new URLSearchParams(new URL(page.url()).hash.split("?")[1]).get("ward")).toBe(ward);
  await expect(page.getByLabel("Lọc theo phường/xã")).toHaveValue(ward);
  await expect(page.getByRole("region", { name: "Bản đồ phản ánh cộng đồng" })).toBeVisible();

  await page.goto("/#/");
  const trend = page.getByRole("region", { name: "Tình hình trong 30 ngày" });
  const details = trend.getByText("Xem số liệu từng ngày");
  await details.focus();
  await page.keyboard.press("Enter");
  const rows = trend.getByRole("table", { name: "Số phản ánh theo ngày" }).getByRole("row");
  await expect(rows).toHaveCount(31);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test("Kiểm soát quyền tra cứu hồ sơ riêng và xử lý lỗi số liệu trang chủ", async ({ page, playwright, baseURL }, testInfo) => {
  test.skip(!process.env.TEST_ADMIN_PASSWORD || testInfo.project.name !== "desktop",
    "Kiểm tra quyền tra cứu trên PostgreSQL");
  const guest = await playwright.request.newContext({ baseURL });
  const citizen = await playwright.request.newContext({ baseURL });
  const stamp = Date.now();
  try {
    expect((await guest.get("/api/admin/local-updates")).status()).toBe(401);
    expect((await citizen.post("/api/register", { data: {
      name: "Người dân kiểm thử", email: "local-" + stamp + "@example.test",
      password: "Local-News-Test!",
    } })).status()).toBe(201);
    expect((await citizen.post("/api/admin/local-updates", { data: {
      title: "Thông báo kiểm thử " + stamp,
      summary: "Lịch thu gom áp dụng trong tuần.",
      ward: null,
      source_url: "https://example.com/lich-thu-gom",
      starts_on: "2026-11-20",
      ends_on: "2026-11-23",
    } })).status()).toBe(403);
    const submission = await citizen.post("/api/reports", { data: {
      description: "Rác thải sinh hoạt chất đống.",
      location: "Điểm kiểm tra hồ sơ riêng tư",
    } });
    expect(submission.status()).toBe(201);
    const { id } = await submission.json();
    const missing = await guest.get("/api/reports/PX-KHONGCO");
    const unsuspected = await guest.get("/api/reports/" + id);
    expect(unsuspected.status()).toBe(404);
    expect(await unsuspected.json()).toEqual(await missing.json());
    expect((await citizen.get("/api/reports/" + id)).status()).toBe(200);
    const ownerPage = await page.context().browser().newPage({ storageState: await citizen.storageState() });
    try {
      await ownerPage.goto(baseURL + "/#/");
      await expect(ownerPage.getByRole("region", { name: "Thông báo địa phương" })).toHaveCount(0);
      await ownerPage.getByRole("button", { name: "Tra cứu hồ sơ", exact: true }).click();
      await ownerPage.getByRole("textbox", { name: "Mã hồ sơ" }).fill(id);
      await ownerPage.getByRole("button", { name: "Tra cứu", exact: true }).click();
      await expect(ownerPage).toHaveURL(new RegExp(id + "$"));
    } finally {
      await ownerPage.close();
    }

    await page.route("**/api/community/home", (route) => route.abort(), { times: 1 });
    await page.goto("/#/");
    const trend = page.getByRole("region", { name: "Tình hình trong 30 ngày" });
    await expect(trend.getByText("Chưa tải được số liệu.")).toBeVisible();
    await expect(page.getByRole("button", { name: "Gửi phản ánh", exact: true })).toBeVisible();
    await trend.getByRole("button", { name: "Thử lại" }).click();
    await expect(trend.getByText("Xem số liệu từng ngày")).toBeVisible();
  } finally {
    await guest.dispose();
    await citizen.dispose();
  }
});
