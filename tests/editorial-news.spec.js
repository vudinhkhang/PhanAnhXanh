import { expect, test } from "@playwright/test";

test("Dán bài định dạng vào Quill, lưu nháp, xuất bản và gỡ bài", async ({ page }) => {
  const title = "Bản tin thu gom pin " + Date.now();
  await page.goto("/#/login?next=" + encodeURIComponent("/admin?tab=news"));
  await page.getByLabel("Email", { exact: true }).fill(process.env.TEST_ADMIN_EMAIL || "quantri@demo.vn");
  await page.getByLabel("Mật khẩu", { exact: true }).fill(process.env.TEST_ADMIN_PASSWORD || "Demo1234");
  await page.getByRole("button", { name: "Đăng nhập", exact: true }).click();
  await page.getByRole("button", { name: "Viết bài mới" }).click();
  await page.getByLabel("Tiêu đề", { exact: true }).fill(title);
  const editor = page.getByRole("textbox", { name: "Nội dung bài viết" });
  await editor.focus();
  await editor.evaluate((node) => {
    const clipboardData = new DataTransfer();
    clipboardData.setData("text/html", '<h2>Địa điểm thu gom</h2><p>Nhận <strong>pin đã qua sử dụng</strong> vào cuối tuần.</p><ul><li>Gói pin riêng</li></ul><p><a href="https://example.org/thu-gom">Xem lịch</a></p>');
    node.dispatchEvent(new ClipboardEvent("paste", { clipboardData, bubbles: true, cancelable: true }));
  });
  await expect(editor.getByRole("heading", { name: "Địa điểm thu gom" })).toBeVisible();
  await expect(editor.locator("strong")).toHaveText("pin đã qua sử dụng");
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(await page.evaluate(() => innerWidth));
  await page.getByRole("button", { name: "Lưu bản nháp" }).click();
  const row = page.getByRole("listitem").filter({ has: page.getByRole("heading", { name: title, exact: true }) });
  await expect(row).toContainText("Bản nháp");
  await page.goto("/#/news");
  await expect(page.getByRole("link", { name: title, exact: true })).toHaveCount(0);

  await page.goto("/#/admin?tab=news");
  await row.getByRole("button", { name: "Sửa bằng Quill" }).click();
  await expect(editor.locator("strong")).toHaveText("pin đã qua sử dụng");
  await page.getByRole("button", { name: "Đăng bài", exact: true }).click();
  await expect(row).toContainText("Đã xuất bản");
  await page.goto("/#/");
  const lead = page.locator(".news-story-featured").getByRole("link", { name: title, exact: true });
  const path = await lead.getAttribute("href");
  await lead.click();
  const article = page.getByRole("article", { name: title, exact: true });
  await expect(article.getByRole("heading", { name: "Địa điểm thu gom" })).toBeVisible();
  await expect(article.getByRole("listitem")).toHaveText("Gói pin riêng");
  await expect(article.getByRole("link", { name: "Xem lịch" })).toHaveAttribute("href", "https://example.org/thu-gom");
  await page.reload();
  await expect(article.locator("strong")).toHaveText("pin đã qua sử dụng");

  await page.goto("/#/admin?tab=news");
  await row.getByRole("button", { name: "Gỡ bài" }).click();
  await expect(row).toContainText("Bản nháp");
  await page.goto("/" + path);
  await expect(page.getByText("Bài viết hiện không có trong bản tin.")).toBeVisible();
});

test("API bảo vệ bản nháp và lưu nội dung Quill trên PostgreSQL", async ({ playwright, baseURL }, testInfo) => {
  test.skip(!process.env.TEST_ADMIN_PASSWORD || testInfo.project.name !== "desktop", "Cần PostgreSQL và tài khoản quản trị kiểm thử");
  const admin = await playwright.request.newContext({ baseURL });
  const guest = await playwright.request.newContext({ baseURL });
  const endpoint = "/api/admin/news";
  const now = Date.now();
  try {
    expect((await guest.get(endpoint)).status()).toBe(401);
    expect((await guest.post("/api/register", { data: { email: `editorial-${now}@example.test`, name: "Kiểm tra phân quyền", password: "LocalNews-test-1" } })).status()).toBe(201);
    expect((await guest.get(endpoint)).status()).toBe(403);
    expect((await admin.post("/api/login", { data: { email: process.env.TEST_ADMIN_EMAIL, password: process.env.TEST_ADMIN_PASSWORD } })).status()).toBe(200);
    const data = {
      title: "Bài kiểm tra quyền xem " + now,
      category: "water",
      area: "TP. Hồ Chí Minh",
      content: { ops: [{ insert: "Nội dung đã định dạng", attributes: { italic: true } }, { insert: "\n" }] },
    };
    const invalid = { ...data, content: { ops: [{ insert: "Liên kết\n", attributes: { link: "javascript:alert(1)" } }] } };
    expect((await admin.post(endpoint, { data: invalid })).status()).toBe(422);
    const saved = await admin.post(endpoint, { data });
    expect(saved.status()).toBe(201);
    const { slug } = await saved.json();
    const publication = endpoint + "/" + slug + "/publication";
    const reader = "/api/community/news/" + slug;
    expect((await guest.get(reader)).status()).toBe(404);
    expect((await guest.patch(publication, { data: { published: true } })).status()).toBe(403);
    expect((await admin.patch(publication, { data: { published: true } })).status()).toBe(200);
    expect((await (await guest.get(reader)).json()).content).toEqual(data.content);
    expect((await admin.patch(publication, { data: { published: false } })).status()).toBe(200);
    expect((await guest.get(reader)).status()).toBe(404);
  } finally {
    await admin.dispose();
    await guest.dispose();
  }
});
