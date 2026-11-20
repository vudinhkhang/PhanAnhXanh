import { test, expect } from "@playwright/test";

test("Bản đồ cộng đồng giữ bộ lọc và mở hồ sơ ở vị trí gần đúng", async ({
  page,
}, testInfo) => {
  await page.goto("/#/community");
  await page.getByLabel("Lọc theo trạng thái").selectOption("processing");
  await page.getByLabel("Lọc theo nhóm").selectOption("waste");
  await page.getByRole("button", { name: "Bản đồ", exact: true }).click();
  await expect(page.locator(".map-report-list button")).toHaveCount(1);
  await page.locator(".geo-marker").click();
  await expect(page.locator(".geo-popup")).toContainText("Rác sinh hoạt tập kết");
  await expect(page.locator(".geo-popup img")).toBeVisible();
  await page.getByRole("button", { name: "Xem toàn bộ ghim" }).click();
  await page.locator(".map-report-list button").click();
  await page.locator(".geo-popup a").click();
  await expect(
    page.getByRole("region", { name: "Vị trí gần đúng" }),
  ).toBeVisible();
  await expect(page.getByRole("link", { name: "Mở chỉ đường" })).toHaveCount(0);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBeTruthy();
});

test("Chọn ghim, xử lý quyền định vị, lưu hồ sơ và mở chỉ đường", async ({
  page,
  context,
  baseURL,
}, testInfo) => {
  await context.setGeolocation({ latitude: 10.76269, longitude: 106.68251 });
  await context.grantPermissions(["geolocation"], { origin: baseURL });
  await page.goto("/#/register?next=/new");
  await page.getByLabel("Họ và tên").fill("Người thử bản đồ");
  await page
    .getByLabel("Email", { exact: true })
    .fill("gis" + Date.now() + "@example.test");
  await page.getByLabel("Mật khẩu", { exact: true }).fill("GIS-local-2026!");
  await page.getByRole("button", { name: "Đăng ký tài khoản" }).click();
  await page
    .getByLabel("Mô tả sự việc")
    .fill(
      testInfo.project.name === "mobile"
        ? "Cây xanh gãy đổ chắn ngang đường."
        : "Rác thải chất đống gần bờ kênh.",
    );
  await page
    .getByLabel("Địa điểm", { exact: true })
    .fill("Điểm lấy mẫu theo ghi nhận hiện trường");
  await expect(page.locator(".map-canvas")).toHaveCount(1);
  await page.evaluate(() =>
    Object.defineProperty(navigator.geolocation, "getCurrentPosition", {
      configurable: true,
      value: (ok, fail) => fail({ code: 1 }),
    }),
  );
  await page.getByRole("button", { name: "Dùng vị trí hiện tại" }).click();
  await expect(page.getByRole("status")).toContainText("chưa cấp quyền");
  await page
    .getByRole("textbox", { name: "Tìm phường, xã hoặc tỉnh thành" })
    .fill("cho quan");
  await page.locator(".place-results button").first().click();
  await page.locator(".map-canvas").click({ position: { x: 95, y: 150 } });
  await expect(page.locator(".pin-foot")).toContainText("Ghim đã chọn");
  await page.getByRole("button", { name: "Bỏ ghim" }).click();
  await expect(page.locator(".pin-foot")).toContainText("Chạm lên bản đồ");
  await page.getByRole("button", { name: "Ghim tại tâm bản đồ" }).click();
  await page.evaluate(() => delete navigator.geolocation.getCurrentPosition);
  await page.getByRole("button", { name: "Dùng vị trí hiện tại" }).click();
  await expect(page.locator(".pin-foot")).toContainText("10.76269, 106.68251");
  await page.locator('input[name="public"]').check();
  await page.getByRole("button", { name: "Gửi phản ánh", exact: true }).click();
  const code = await page.locator(".code").innerText();
  await page
    .getByRole("link", { name: "Theo dõi phản ánh", exact: true })
    .click();
  await expect(
    page.getByRole("link", { name: "Mở chỉ đường" }),
  ).toHaveAttribute("href", /destination=10\.76269,106\.68251/);
  await expect(page.locator(".detail .status")).toHaveText("Đã tiếp nhận");
  await page.locator(".user-menu-trigger").click();
  await page.getByRole("button", { name: "Đăng xuất" }).click();
  await expect(
    page.getByRole("link", { name: "Đăng nhập", exact: true }),
  ).toBeVisible();
  await page.goto("/#/report/" + code);
  await expect(
    page.getByRole("region", { name: "Vị trí gần đúng" }),
  ).toBeVisible();
  await expect(
    page.getByText("Điểm lấy mẫu theo ghi nhận hiện trường"),
  ).toHaveCount(0);
  if (process.env.TEST_ADMIN_PASSWORD) {
    const dto = await (await page.request.get("/api/reports/" + code)).json();
    expect(dto.pin).toEqual({ lat: 10.76, lng: 106.68, approximate: true });
    expect(dto.ward).toContain("Chợ Quán");
    expect(dto).not.toHaveProperty("pin_lat");
    await page.request.post("/api/login", {
      data: {
        email: process.env.TEST_ADMIN_EMAIL,
        password: process.env.TEST_ADMIN_PASSWORD,
      },
    });
    await page.goto("/#/desk");
    await page.reload();
    if (testInfo.project.name === "mobile") {
      await page.getByRole("button", { name: "Mở menu quản trị" }).click();
    }
    await page
      .getByRole("navigation", { name: "Điều hướng quản trị" })
      .getByRole("link", { name: "Thống kê", exact: true })
      .click();
    const stats = page.locator("section.work-panel").filter({
      has: page.getByRole("heading", { name: "Thống kê theo phường/xã" }),
    });
    await stats.getByLabel("Lọc theo trạng thái").selectOption("received");
    await stats.getByLabel("Tìm kiếm phản ánh").fill(code);
    await expect(stats.locator(".area-row")).toContainText("Chợ Quán");
    await expect(stats.locator(".area-row")).toContainText("1 hồ sơ");
    await stats.getByLabel("Lọc theo trạng thái").selectOption("resolved");
    await expect(stats.getByText("Chưa có phản ánh phù hợp.")).toBeVisible();
  }
});
