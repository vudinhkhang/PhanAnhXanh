import { test, expect } from "@playwright/test";
import { mkdirSync } from "node:fs";
test("Gửi, phân công, xử lý và theo dõi phản ánh", async ({
  page,
}, testInfo) => {
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const tag = Date.now(),
    email = "resident" + tag + "@example.test",
    staff = "officer" + tag + "@example.test",
    password = "Test-local-93!";
  const adminEmail = process.env.TEST_ADMIN_EMAIL || "quantri@demo.vn",
    adminPass = process.env.TEST_ADMIN_PASSWORD || "Demo1234";
  const go = async (path) => {
    await page.goto("/#" + path);
  };
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
  const login = async (user, pass) => {
    await go("/login");
    await page.getByLabel("Email", { exact: true }).fill(user);
    await page.getByLabel("Mật khẩu", { exact: true }).fill(pass);
    await page.getByRole("button", { name: "Đăng nhập", exact: true }).click();
    await expect(page).toHaveURL(/#\/desk/);
  };
  const adminNav = async (label) => {
    if (testInfo.project.name === "mobile") {
      await page.getByRole("button", { name: "Mở menu quản trị" }).click();
    }
    await page
      .getByRole("navigation", { name: "Điều hướng quản trị" })
      .getByRole("link", { name: label, exact: true })
      .click();
  };
  const staffNav = async (label) => {
    if (testInfo.project.name === "mobile") {
      await page.getByRole("button", { name: "Mở menu cán bộ" }).click();
    }
    await page
      .getByRole("navigation", { name: "Điều hướng cán bộ" })
      .getByRole("link", { name: label, exact: true })
      .click();
  };
  await go("/");
  const recent = page.getByRole("region", { name: "Phản ánh gần đây" });
  await expect(recent.locator(".report-card").nth(5)).toBeAttached();
  const previous = recent.getByRole("button", { name: "Phản ánh trước" });
  const next = recent.getByRole("button", { name: "Phản ánh tiếp theo" });
  const scroll = () =>
    recent.locator(".cards").evaluate((track) => track.scrollLeft);
  await expect(previous).toBeDisabled();
  await next.click();
  await expect.poll(scroll).toBeGreaterThan(0);
  await previous.click();
  await expect.poll(scroll).toBe(0);
  const stats = page.locator(".stats[aria-label='Thống kê phản ánh']");
  await expect(stats.locator("dt")).toHaveText(["Tổng phản ánh", "Đã tiếp nhận", "Đang xử lý", "Đã xử lý"]);
  await expect(stats.locator("dd")).toHaveText(Array(4).fill(/^[\d.]+$/));
  await page.evaluate(() => document.fonts.ready);
  await expect(page.locator(".card-photo img").first()).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBeTruthy();
  mkdirSync(".runtime/qa", { recursive: true });
  await page.screenshot({
    path: ".runtime/qa/" + testInfo.project.name + ".png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "Gửi phản ánh" }).click();
  await expect(page.getByLabel("Mô tả sự việc")).toBeVisible();
  await go("/register?next=/new");
  await page.getByLabel("Họ và tên").fill("Người dân thử nghiệm");
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page.getByLabel("Mật khẩu", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Đăng ký tài khoản" }).click();
  const externalCheck = page.getByRole("checkbox", { name: /đồng ý.*AI/i });
  await expect(externalCheck).toBeVisible();
  await expect(externalCheck).not.toBeChecked();
  await page
    .getByLabel("Mô tả sự việc")
    .fill("Nước thải hóa chất gây cá chết hàng loạt trong kênh.");
  await page
    .getByLabel("Địa điểm", { exact: true })
    .fill("Kênh kiểm thử " + tag);
  const files = [
    "public/images/water.webp",
    "public/images/waste.webp",
    "public/images/dust.webp",
  ];
  await page.locator("input[type=file]").setInputFiles([...files, files[0]]);
  await expect(page.getByRole("alert")).toContainText("tối đa 3");
  await page.locator("input[type=file]").setInputFiles(files);
  await expect(page.locator(".previews img")).toHaveCount(3);
  await page.getByRole("button", { name: "Xóa ảnh 3" }).click();
  await page.getByRole("button", { name: "Xóa ảnh 2" }).click();
  await page.getByRole("button", { name: "Gửi phản ánh", exact: true }).click();
  const code = await page.locator(".code").innerText();
  await page
    .getByRole("link", { name: "Theo dõi phản ánh", exact: true })
    .click();
  await expect(page.locator(".detail")).toContainText(code);
  await expect(page.locator(".analysis")).toContainText("Chờ xác nhận");
  if (process.env.TEST_ADMIN_PASSWORD) {
    await expect.poll(async () => {
      const response = await page.request.get("/api/reports/" + encodeURIComponent(code));
      return (await response.json()).intake_state;
    }, { timeout: 20000 }).toBe("passed");
  }
  await logout();
  await login(adminEmail, adminPass);
  await adminNav("Cán bộ");
  await page.getByLabel("Họ và tên").fill("Cán bộ " + tag);
  await page.getByLabel("Email", { exact: true }).fill(staff);
  await page.getByLabel("Mật khẩu ban đầu").fill(password);
  await page.getByRole("button", { name: "Thêm cán bộ" }).click();
  await expect(page.getByText(staff, { exact: true })).toBeVisible();
  await adminNav("Hồ sơ");
  await page.getByLabel("Tìm kiếm phản ánh").fill(code);
  await page
    .getByRole("combobox", { name: "Trạng thái", exact: true })
    .selectOption("received");
  await page.locator(".work-table").getByRole("link").first().click();
  await page.getByRole("link", { name: "Danh sách hồ sơ" }).click();
  await expect(page.getByLabel("Tìm kiếm phản ánh")).toHaveValue(code);
  await expect(
    page.getByRole("combobox", { name: "Trạng thái", exact: true }),
  ).toHaveValue("received");
  await page.getByRole("checkbox", { name: "Chọn hồ sơ " + code }).check();
  await page
    .getByLabel("Cán bộ nhận hồ sơ")
    .selectOption({ label: "Cán bộ " + tag });
  await page.getByRole("button", { name: "Phân công 1 hồ sơ" }).click();
  await expect(
    page.getByText("Đã phân công 1 hồ sơ.", { exact: true }),
  ).toBeVisible();
  await page.locator(".work-table").getByRole("link").first().click();
  await page
    .getByLabel("Phân công cán bộ")
    .selectOption({ label: "Cán bộ " + tag });
  await expect(
    page.getByLabel("Phân công cán bộ").locator("option:checked"),
  ).toHaveText("Cán bộ " + tag);
  await expect(page.locator(".timeline")).toContainText(/phân công/i);
  await logout();
  await login(staff, password);
  await staffNav("Hồ sơ khu vực");
  await page.getByLabel("Tìm kiếm phản ánh").fill(code);
  await page.locator(".work-table").getByRole("link").first().click();
  await page.getByRole("button", { name: "Xem ảnh 1" }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.getByRole("button", { name: "Đóng ảnh" }).click();
  await page.getByLabel("Nhóm xác nhận").selectOption("water");
  await page.getByLabel("Mức ưu tiên").selectOption("high");
  await page
    .getByLabel("Trạng thái", { exact: true })
    .selectOption("processing");
  await page
    .getByLabel("Phản hồi người dân")
    .fill("Đã cử cán bộ đến lấy mẫu nước.");
  await page.getByRole("button", { name: "Lưu cập nhật" }).click();
  await expect(page.locator(".timeline")).toContainText(
    "Đã cử cán bộ đến lấy mẫu nước.",
  );
  await go("/desk");
  await staffNav("Cần xem sớm");
  await expect(page.locator(".work-table")).toContainText(code);
  await logout();
  await login(email, password);
  await go("/track");
  await page.getByLabel("Mã hồ sơ").fill(code);
  await page.getByRole("button", { name: "Tra cứu hồ sơ" }).click();
  await expect(page.locator(".timeline")).toContainText(
    "Đã cử cán bộ đến lấy mẫu nước.",
  );
  await expect(page.locator(".detail .status")).toHaveText("Đang xử lý");
  await expect(page.locator(".analysis")).toContainText("Ô nhiễm nước");
  await logout();
  await login(adminEmail, adminPass);
  await go("/report/" + code);
  await page
    .getByRole("combobox", { name: "Trạng thái", exact: true })
    .selectOption("resolved");
  await page.getByLabel("Phản hồi người dân").fill("Đã xử lý nguồn xả thải.");
  await page.getByRole("button", { name: "Lưu cập nhật" }).click();
  await expect(page.locator(".detail .status")).toHaveText("Đã xử lý");
  await page.getByLabel("Lý do mở lại").fill("Tiếp tục kiểm tra theo yêu cầu.");
  await page.getByRole("button", { name: "Mở lại hồ sơ" }).click();
  await expect(page.locator(".timeline")).toContainText("Tiếp tục kiểm tra");
  await go("/desk");
  await adminNav("Thống kê");
  await expect(
    page.getByRole("heading", { name: "Thống kê theo nhóm" }),
  ).toBeVisible();
  await adminNav("Cán bộ");
  const account = page.locator(".staff-row").filter({ hasText: staff });
  await account.getByRole("button", { name: "Tạm khóa" }).click();
  await expect(account.getByText("Tạm khóa", { exact: true })).toBeVisible();
  await account.getByRole("button", { name: "Kích hoạt" }).click();
  await expect(account.getByText("Hoạt động", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: /Thông báo nội bộ/ }).click();
  await page.getByRole("link", { name: /Hồ sơ cần xem sớm/ }).click();
  await expect(
    page.getByRole("heading", { name: "Hồ sơ", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("combobox", { name: "Ưu tiên", exact: true }),
  ).toHaveValue("urgent");
  await go("/community");
  await page.getByLabel("Lọc theo nhóm").selectOption("water");
  await expect(page.locator(".report-card").first()).toContainText(
    "Ô nhiễm nước",
  );
  await page.getByLabel("Tìm kiếm phản ánh").fill("zz-absent-zz");
  await expect(page.getByText("Chưa có phản ánh phù hợp.")).toBeVisible();
  await go("/");
  await page.locator(".user-menu-trigger").click();
  const userDropdown = page.getByRole("region", { name: "Menu tài khoản" });
  await expect(
    userDropdown.getByRole("link", { name: "Vào quản trị" }),
  ).toBeVisible();
  await expect(
    userDropdown.getByRole("link", { name: "Thông tin cá nhân" }),
  ).toBeVisible();
  await expect(
    userDropdown.getByRole("link", { name: "Hồ sơ của tôi" }),
  ).toHaveCount(0);
  await expect(
    userDropdown.getByRole("button", { name: "Đăng xuất" }),
  ).toBeVisible();
  await userDropdown.getByRole("link", { name: "Thông tin cá nhân" }).click();
  await expect(page).toHaveURL(/#\/profile/);
  await expect(
    page.getByRole("heading", { name: "Thông tin cá nhân" }),
  ).toBeVisible();
  await logout();
  if (testInfo.project.name === "mobile") {
    const headerNav = page.getByRole("navigation", { name: "Điều hướng chính" });
    await expect(headerNav).toBeVisible();
    await expect(headerNav.getByRole("link")).toHaveText([
      "Tra cứu hồ sơ", "Bảng tin", "Gửi phản ánh", "Bản đồ", "Tin môi trường",
    ]);
  }
  await page
    .getByRole("contentinfo")
    .getByRole("link", { name: "Hướng dẫn gửi phản ánh" })
    .click();
  await expect(
    page.getByRole("heading", { name: "Hướng dẫn gửi phản ánh" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Gửi phản ánh" }).click();
  await expect(page.getByLabel("Mô tả sự việc")).toBeVisible();
  await go("/login?next=/new");
  await page.getByRole("button", { name: "Hiện mật khẩu" }).click();
  await expect(page.getByLabel("Mật khẩu", { exact: true })).toHaveAttribute(
    "type",
    "text",
  );
  await page.getByRole("button", { name: "Ẩn mật khẩu" }).click();
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page.getByLabel("Mật khẩu", { exact: true }).fill("incorrect-password");
  await page.getByRole("button", { name: "Đăng nhập", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText(
    "Email hoặc mật khẩu chưa đúng",
  );
  expect(errors).toEqual([]);
});
