import { test, expect } from "@playwright/test";

test("Admin phân khu vực cho cán bộ, Staff Dashboard và Bản đồ Goong điều hướng", async ({
  page,
}, testInfo) => {
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const tag = Date.now();
  const staffEmail = "area-staff-" + tag + "@example.test";
  const password = "Staff-Area-2026!";
  const adminEmail = process.env.TEST_ADMIN_EMAIL || "quantri@demo.vn";
  const adminPass = process.env.TEST_ADMIN_PASSWORD || "Demo1234";

  const login = async (email, pass) => {
    await page.goto("/#/login");
    await page.getByLabel("Email", { exact: true }).fill(email);
    await page.getByLabel("Mật khẩu", { exact: true }).fill(pass);
    await page.getByRole("button", { name: "Đăng nhập", exact: true }).click();
    await expect(page).toHaveURL(/#\/desk/);
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
  const nav = async (role, label) => {
    if (testInfo.project.name === "mobile") {
      await page
        .getByRole("button", {
          name: role === "admin" ? "Mở menu quản trị" : "Mở menu cán bộ",
        })
        .click();
    }
    await page
      .getByRole("navigation", {
        name: role === "admin" ? "Điều hướng quản trị" : "Điều hướng cán bộ",
      })
      .getByRole("link", { name: label, exact: true })
      .click();
  };

  await login(adminEmail, adminPass);
  await nav("admin", "Cán bộ");
  await page.getByLabel("Họ và tên").fill("Cán bộ Khu Vực " + tag);
  await page.getByLabel("Email", { exact: true }).fill(staffEmail);
  await page.getByLabel("Mật khẩu ban đầu").fill(password);
  await page.getByRole("button", { name: "Thêm cán bộ" }).click();
  await expect(page.getByText(staffEmail, { exact: true })).toBeVisible();
  await logout();

  await login(staffEmail, password);
  await expect(
    page.getByRole("heading", { name: "Tổng quan", exact: true }),
  ).toBeVisible();
  await expect(page.locator(".staff-areas-bar")).toContainText(
    "Chưa phân khu vực",
  );
  await nav("staff", "Hồ sơ khu vực");
  await expect(page.getByText("0 hồ sơ", { exact: true })).toBeVisible();
  await nav("staff", "Bản đồ khu vực");
  await expect(
    page.getByRole("heading", { name: "Chưa được phân khu vực phụ trách" }),
  ).toBeVisible();
  await logout();

  await login(adminEmail, adminPass);
  await nav("admin", "Cán bộ");
  const row = page.locator(".staff-row").filter({ hasText: staffEmail });
  await row.getByRole("button", { name: "Phân khu vực" }).click();
  await row
    .getByLabel("Tìm phường/xã để thêm khu vực")
    .fill("Chợ Quán");
  await row
    .getByRole("listbox", { name: "Gợi ý phường/xã" })
    .getByRole("button", { name: "Phường Chợ Quán" })
    .click();
  await row.getByLabel("Tìm phường/xã để thêm khu vực").fill("Tân Phú");
  await row
    .getByRole("listbox", { name: "Gợi ý phường/xã" })
    .getByRole("button", { name: "Phường Tân Phú" })
    .click();
  await row.getByLabel("Tìm phường/xã để thêm khu vực").fill("Sài Gòn");
  await row
    .getByRole("listbox", { name: "Gợi ý phường/xã" })
    .getByRole("button", { name: "Phường Sài Gòn" })
    .click();
  await row.getByRole("button", { name: "Lưu khu vực" }).click();
  await expect(row).toContainText("Phường Chợ Quán");
  await expect(row).toContainText("Phường Tân Phú");
  await expect(row).toContainText("Phường Sài Gòn");
  await logout();

  await login(staffEmail, password);
  await expect(page.locator(".staff-areas-bar")).toContainText(
    "Phường Chợ Quán",
  );
  await expect(page.locator(".staff-areas-bar")).toContainText(
    "Phường Tân Phú",
  );
  await expect(page.locator(".staff-areas-bar")).toContainText(
    "Phường Sài Gòn",
  );
  await nav("staff", "Bản đồ khu vực");
  await expect(page.locator(".map-canvas")).toBeVisible();
  await expect(page.getByLabel("Lọc trạng thái bản đồ")).toHaveValue(
    "received",
  );
  await expect(page.locator(".staff-map .map-report-list")).toContainText(
    "Rác nổi tập trung trên mặt kênh",
  );
  await expect(page.locator(".staff-map .map-report-list")).toContainText(
    "Miệng thu nước bám nhiều cặn",
  );
  await expect(page.locator(".staff-map .map-report-list")).not.toContainText(
    "Bụi phát tán dọc tuyến đường",
  );
  await page.getByRole("button", { name: "Tới điểm gần nhất" }).click();
  const routePanel = page.getByRole("region", { name: "Chỉ dẫn đường đi" });
  await expect(routePanel).toBeVisible();
  if (process.env.TEST_ADMIN_PASSWORD) {
    await expect(routePanel).toContainText("Tuyến đường thực tế (Goong Direction)");
    await expect(routePanel.locator(".staff-route-steps li").first()).toBeVisible();
  }
  await expect(
    routePanel.getByRole("link", { name: "Mở Google Maps" }),
  ).toHaveAttribute("href", /google\.com\/maps\/dir\//);

  await page.getByRole("button", { name: "Lộ trình tuần tra" }).click();
  await expect(routePanel).toContainText(/Lộ trình tuần tra \(\d+ điểm\)/);
  await expect(
    page.locator(".staff-map .staff-stop-badge", { hasText: "Điểm 1" }),
  ).toBeVisible();

  if (process.env.TEST_ADMIN_PASSWORD) {
    const outRes = await page.request.post("/api/reports/PX-261105C9E1A3/update", {
      data: {
        status: "processing",
        confirmed_group: "dust",
        priority: "normal",
        note: "Thử vượt quyền khu vực",
      },
    });
    expect(outRes.status()).toBe(403);
  }

  const claimable = page
    .locator(".staff-map-item")
    .filter({ has: page.getByRole("button", { name: "Nhận xử lý" }) })
    .first();
  const claimedTitle = (await claimable.locator("b").innerText()).trim();
  await claimable.getByRole("button", { name: "Nhận xử lý" }).click();
  await expect(
    page
      .locator(".staff-map-item")
      .filter({ hasText: claimedTitle })
      .getByRole("button", { name: "Nhận xử lý" }),
  ).toHaveCount(0);
  await nav("staff", "Hồ sơ khu vực");
  await page.getByLabel("Lọc theo phạm vi").selectOption("mine");
  await expect(page.locator(".work-table")).toContainText(claimedTitle);
  expect(errors).toEqual([]);
});
