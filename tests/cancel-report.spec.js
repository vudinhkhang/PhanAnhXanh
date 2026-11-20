import { test, expect } from "@playwright/test";

test("Cán bộ và Admin hủy phản ánh kèm lý do, gỡ khỏi trang chủ và giới hạn quyền xem", async ({
  page,
  context,
  baseURL,
}, testInfo) => {
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const isMobile = testInfo.project.name === "mobile";
  const tag = Date.now() + (isMobile ? 1 : 0);
  const password = "Cancel-Flow-2026!";
  const senderEmail = "sender-cancel-" + tag + "@example.test";
  const bystanderEmail = "other-cancel-" + tag + "@example.test";
  const staffEmail = "staff-cancel-" + tag + "@example.test";
  const adminEmail = process.env.TEST_ADMIN_EMAIL || "quantri@demo.vn";
  const adminPass = process.env.TEST_ADMIN_PASSWORD || "Demo1234";
  const description = isMobile
    ? `Rác thải sinh hoạt chất đống bốc mùi ${tag}.`
    : `Khói bụi mù mịt từ điểm đốt rác ${tag}.`;
  const photoFile = isMobile
    ? "public/images/waste.webp"
    : "public/images/dust.webp";
  const coords = isMobile
    ? { latitude: 10.742, longitude: 106.72 }
    : { latitude: 10.758, longitude: 106.68 };
  const staffCancelReason =
    "Không thuộc thẩm quyền xử lý tại hiện trường " + tag;
  const adminCancelReason =
    "Quản trị xác nhận đóng hồ sơ do trùng kế hoạch " + tag;

  const logout = async () => {
    await page.locator(".user-menu-trigger").click();
    await page
      .locator(".user-dropdown")
      .getByRole("button", { name: "Đăng xuất", exact: true })
      .click();
    await expect(
      page.getByRole("link", { name: "Đăng nhập", exact: true }),
    ).toBeVisible();
  };

  const login = async (email, pass, expectUrl = /#\/desk/) => {
    await page.goto("/#/login");
    await page.getByLabel("Email", { exact: true }).fill(email);
    await page.getByLabel("Mật khẩu", { exact: true }).fill(pass);
    await page.getByRole("button", { name: "Đăng nhập", exact: true }).click();
    await expect(page).toHaveURL(expectUrl);
  };

  const navAdmin = async (label) => {
    if (isMobile) {
      await page.getByRole("button", { name: "Mở menu quản trị" }).click();
    }
    await page
      .getByRole("navigation", { name: "Điều hướng quản trị" })
      .getByRole("link", { name: label, exact: true })
      .click();
  };

  // 1. Người gửi A đăng ký và gửi phản ánh công khai hợp lệ
  await context.setGeolocation(coords);
  await context.grantPermissions(["geolocation"], { origin: baseURL });
  await page.goto("/#/register?next=/new");
  await page.getByLabel("Họ và tên").fill("Người gửi " + tag);
  await page.getByLabel("Email", { exact: true }).fill(senderEmail);
  await page.getByLabel("Mật khẩu", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Đăng ký tài khoản" }).click();

  await page.getByLabel("Mô tả sự việc").fill(description);
  await page
    .getByLabel("Địa điểm", { exact: true })
    .fill((isMobile ? "15 Huỳnh Tấn Phát" : "20 An Dương Vương") + " #" + tag);
  await expect(page.locator(".map-canvas")).toHaveCount(1);
  await page.getByRole("button", { name: "Dùng vị trí hiện tại" }).click();
  await expect(page.locator(".pin-foot")).toContainText("Ghim đã chọn");
  await page.getByLabel("Chọn ảnh từ thiết bị").setInputFiles(photoFile);
  await expect(page.locator(".previews img")).toHaveCount(1);
  await page.locator('input[name="public"]').check();
  await page.getByRole("button", { name: "Gửi phản ánh", exact: true }).click();

  const code = (await page.locator(".code").innerText()).trim();
  await page
    .getByRole("link", { name: "Theo dõi phản ánh", exact: true })
    .click();
  await expect(page.locator(".detail .status")).toContainText("Đã tiếp nhận", {
    timeout: 20000,
  });

  // Kiểm tra hồ sơ đang hiển thị trên trang chủ trước khi hủy
  await page.goto("/#/");
  await expect(
    page.locator(`.recent a.report-card[href="#/report/${code}"]`),
  ).toBeVisible();
  await logout();

  // 2. Admin tạo cán bộ phụ trách khu vực chứa báo cáo
  await login(adminEmail, adminPass, /#\/desk/);
  await navAdmin("Cán bộ");
  await page.getByLabel("Họ và tên").fill("Cán bộ Hủy " + tag);
  await page.getByLabel("Email", { exact: true }).fill(staffEmail);
  await page.getByLabel("Mật khẩu ban đầu").fill(password);
  const searchWard = page.getByLabel("Tìm phường/xã để thêm khu vực");
  await searchWard.fill("cho quan");
  await page
    .locator(".area-options button", { hasText: "Phường Chợ Quán" })
    .first()
    .click();
  await searchWard.fill("tan thuan");
  await page
    .locator(".area-options button", { hasText: "Phường Tân Thuận" })
    .first()
    .click();
  await page.getByRole("button", { name: "Thêm cán bộ" }).click();
  await expect(page.locator(".staff-row", { hasText: staffEmail })).toContainText(
    "Phường Chợ Quán",
  );
  await logout();

  // 3. Cán bộ đăng nhập, kiểm tra điểm hiện trên bản đồ rồi chuyển sang Đã hủy kèm lý do
  await login(staffEmail, password, /#\/desk/);
  if (isMobile) {
    await page.getByRole("button", { name: "Mở menu cán bộ" }).click();
  }
  await page
    .getByRole("navigation", { name: "Điều hướng cán bộ" })
    .getByRole("link", { name: "Bản đồ khu vực", exact: true })
    .click();
  await expect(page.locator(".staff-map .gis-sidebar")).toContainText(String(tag));

  await page.goto("/#/report/" + encodeURIComponent(code));
  await expect(page.locator(".record-actions")).toBeVisible();
  await page.getByLabel("Trạng thái").selectOption("cancelled");
  await page.getByLabel("Lý do hủy").fill(staffCancelReason);
  await page.getByRole("button", { name: "Xác nhận hủy hồ sơ" }).click();

  await expect(page.locator(".detail .status")).toContainText("Đã hủy");
  await expect(page.locator(".intake-cancelled")).toContainText(
    staffCancelReason,
  );
  await expect(page.locator(".record-history")).toContainText(
    staffCancelReason,
  );
  await expect(page.getByRole("heading", { name: "Hồ sơ đã bị hủy" })).toBeVisible();

  // Sau khi hủy, không còn trên bản đồ điểm đang tiếp nhận
  await page.goto("/#/desk?tab=map");
  await expect(page.locator(".staff-map .gis-sidebar")).toBeVisible();
  await expect(page.locator(".staff-map .gis-sidebar")).not.toContainText(String(tag));
  await logout();

  // 4. Khách chưa đăng nhập: không còn trên trang chủ và không xem được chi tiết
  await page.goto("/#/");
  await expect(
    page.locator(`.recent a.report-card[href="#/report/${code}"]`),
  ).toHaveCount(0);
  await page.goto("/#/report/" + encodeURIComponent(code));
  await expect(page.locator(".error")).toContainText("Không tìm thấy hồ sơ");
  if (process.env.TEST_ADMIN_PASSWORD) {
    const anonApi = await page.request.get("/api/reports/" + code);
    expect(anonApi.status()).toBe(404);
  }

  // 5. Người dân khác (không phải người gửi) cũng không xem được
  await page.goto("/#/register");
  await page.getByLabel("Họ và tên").fill("Người ngoài " + tag);
  await page.getByLabel("Email", { exact: true }).fill(bystanderEmail);
  await page.getByLabel("Mật khẩu", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Đăng ký tài khoản" }).click();
  await expect(page).toHaveURL(/#\/desk/);
  await expect(page.locator(".user-menu-trigger")).toBeVisible();
  await page.goto("/#/report/" + encodeURIComponent(code));
  await expect(page.locator(".error")).toContainText("Không tìm thấy hồ sơ");
  if (process.env.TEST_ADMIN_PASSWORD) {
    const otherApi = await page.request.get("/api/reports/" + code);
    expect(otherApi.status()).toBe(404);
  }
  await logout();

  // 6. Người gửi ban đầu vẫn xem được trạng thái Đã hủy và lý do hủy
  await login(senderEmail, password);
  await page.goto("/#/report/" + encodeURIComponent(code));
  await expect(page.locator(".detail .status")).toContainText("Đã hủy");
  await expect(page.locator(".intake-cancelled")).toContainText(
    staffCancelReason,
  );
  await expect(page.locator(".record-history")).toContainText(
    staffCancelReason,
  );
  await logout();

  // 7. Admin vẫn xem được, mở lại được, và tự chuyển qua Đã hủy kèm lý do mới
  await login(adminEmail, adminPass, /#\/desk/);
  await page.goto("/#/report/" + encodeURIComponent(code));
  await expect(page.locator(".detail .status")).toContainText("Đã hủy");
  await expect(page.locator(".intake-cancelled")).toContainText(
    staffCancelReason,
  );
  await page.getByLabel("Lý do mở lại").fill("Mở lại kiểm tra " + tag);
  await page.getByRole("button", { name: "Mở lại hồ sơ" }).click();
  await expect(page.locator(".detail .status")).toContainText("Đã tiếp nhận");

  await page.getByLabel("Trạng thái").selectOption("cancelled");
  await page.getByLabel("Lý do hủy").fill(adminCancelReason);
  await page.getByRole("button", { name: "Xác nhận hủy hồ sơ" }).click();
  await expect(page.locator(".detail .status")).toContainText("Đã hủy");
  await expect(page.locator(".intake-cancelled")).toContainText(
    adminCancelReason,
  );
  expect(errors).toEqual([]);
});
