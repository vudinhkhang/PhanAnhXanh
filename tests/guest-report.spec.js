import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";

test("Khách gửi và theo dõi riêng tư, hệ thống từ chối trùng và giới hạn lượt gửi", async ({ page, playwright, baseURL }, testInfo) => {
  test.skip(!process.env.TEST_ADMIN_PASSWORD || testInfo.project.name !== "desktop", "Kiểm tra quyền và chống spam với PostgreSQL");
  const outsider = await playwright.request.newContext({ baseURL });
  const secondBrowser = await playwright.request.newContext({ baseURL });
  const location = `${String(Date.now()).slice(-7)} Nguyễn Trãi, Phường Chợ Quán, TP. Hồ Chí Minh`;
  const description = "Rác thải sinh hoạt chất thành đống bên đường.";
  const endpoint = "/api/reports";
  const reportPath = (id) => endpoint + "/" + id;
  const getReport = async (request, id) => (await request.get(reportPath(id))).json();
  const photo = "data:image/png;base64," + readFileSync(new URL("../public/images/logo.png", import.meta.url)).toString("base64");
  try {
    await page.goto("/#/new");
    await page.getByLabel("Mô tả sự việc").fill(description);
    await page.getByLabel("Địa điểm", { exact: true }).fill(location);
    await page.getByRole("button", { name: "Gửi phản ánh", exact: true }).click();
    const id = await page.locator(".code").innerText();
    await page.getByRole("link", { name: "Theo dõi phản ánh" }).click();
    await expect(page.getByText(description, { exact: true }).first()).toBeVisible();
    await expect.poll(async () => (await getReport(page.request, id)).intake_state).toBe("passed");
    expect((await outsider.get(reportPath(id))).status()).toBe(404);

    const duplicate = await secondBrowser.post(endpoint, { data: { description, location } });
    expect(duplicate.status()).toBe(201);
    const duplicateId = (await duplicate.json()).id;
    await expect.poll(async () => (await getReport(secondBrowser, duplicateId)).intake_reason).toBe("duplicate");
    expect(await getReport(secondBrowser, duplicateId)).not.toHaveProperty("duplicate_of");

    const inappropriate = await page.request.post(endpoint, { data: { description: "đụ má", location, photos: [photo] } });
    expect(inappropriate.status()).toBe(201);
    const invalidId = (await inappropriate.json()).id;
    await expect.poll(async () => (await getReport(page.request, invalidId)).intake_reason).toBe("desc_invalid");
    expect((await page.request.get(reportPath(invalidId) + "/photos/0")).status()).toBe(200);
    expect((await outsider.get(reportPath(invalidId) + "/photos/0")).status()).toBe(404);
    expect((await page.request.get(reportPath(id))).status()).toBe(200);

    const attempts = await Promise.all(Array.from({ length: 6 }, () => outsider.post(endpoint, {
      data: { description, location, photos: ["invalid-image"] },
    })));
    expect(attempts.map((response) => response.status()).sort()).toEqual([422, 422, 422, 422, 422, 429]);
  } finally {
    await outsider.dispose();
    await secondBrowser.dispose();
  }
});
