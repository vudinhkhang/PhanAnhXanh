import { expect, test } from "@playwright/test";

test("Trang chủ hiển thị một tin nổi bật và ba tin phụ có ảnh", async ({ page }) => {
  await page.goto("/#/");
  const preview = page.getByRole("region", { name: "Tin môi trường" }).locator(".news-preview");
  await expect(preview.locator(".news-story-featured")).toHaveCount(1);
  await expect(preview.locator(".news-story-compact")).toHaveCount(3);
  const covers = preview.locator(".news-cover");
  await expect(covers).toHaveCount(4);
  for (const cover of await covers.all()) {
    await cover.scrollIntoViewIfNeeded();
    await expect.poll(() => cover.evaluate((img) => img.complete && img.naturalWidth > 0)).toBe(true);
  }
  await preview.locator(".news-story-compact").first().getByRole("link").click();
  await expect(page).toHaveURL(/#\/news\/[^/]+$/);
  await expect(page.locator(".news-article-photo img")).toBeVisible();
});

test("Mở bài tin nội bộ, đọc Markdown và quay lại danh sách", async ({ page }) => {
  await page.goto("/#/news");
  const title = "Camera giúp phát hiện đổ trộm rác ở TP.HCM";
  await page.getByRole("link", { name: title, exact: true }).click();
  await expect(page).toHaveURL(/#\/news\/camera-chong-do-trom-rac-tphcm$/);
  const reader = page.getByRole("article", { name: title });
  await expect(reader.getByRole("heading", { name: "Camera hỗ trợ xác minh ở Tân Mỹ và Tân Hưng" })).toBeVisible();
  await expect(reader.locator("strong")).toContainText("thời gian, địa điểm");
  await expect(reader.getByText("Ảnh minh họa")).toBeVisible();
  const source = reader.getByRole("link", { name: "Đọc bài gốc" });
  await expect(source).toHaveAttribute("href", /https:\/\/dantri\.com\.vn\/thoi-su\//);

  await page.reload();
  await expect(reader.getByRole("heading", { level: 1, name: title })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole("navigation", { name: "Đường dẫn bài viết" }).getByRole("link", { name: "Tin môi trường" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Tin môi trường" })).toBeVisible();
});
