import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";

test("Sàng lọc, duyệt hồ sơ và chống trùng trong PostgreSQL", async ({
  playwright,
  browser,
  baseURL,
}, testInfo) => {
  test.skip(
    !process.env.TEST_ADMIN_PASSWORD || testInfo.project.name !== "desktop",
    "Kiểm tra API trên PostgreSQL",
  );
  const contexts = await Promise.all(
    Array.from({ length: 4 }, () => playwright.request.newContext({ baseURL })),
  );
  const [first, second, admin, staff] = contexts;
  const password = "Intake-2026-Check!";
  const stamp = Date.now();
  const detail = async (context, id) =>
    (await context.get("/api/reports/" + id)).json();
  const review = (context, id, data) =>
    context.post("/api/reports/" + id + "/intake-review", { data });
  const upload = (name) =>
    "data:image/webp;base64," +
    readFileSync("public/images/" + name + ".webp").toString("base64");
  const waste = "Rac day";
  const pin = { lat: 10.76616, lng: 106.68261 };
  const noisePin = { ...pin, lat: pin.lat + 0.001 };
  async function submit(context, fields) {
    const response = await context.post("/api/reports", {
      data: {
        description: waste,
        location: "Hẻm kiểm tra " + stamp,
        ...fields,
      },
    });
    expect(response.status()).toBe(201);
    const record = await response.json();
    expect(record.intake_state).toBe("pending");
    return record.id;
  }
  async function screened(context, id) {
    await expect
      .poll(async () => (await detail(context, id)).intake_state, {
        timeout: 20000,
      })
      .not.toBe("pending");
    return detail(context, id);
  }

  try {
    for (const [context, name] of [
      [first, "owner"],
      [second, "reporter"],
    ]) {
      expect(
        (
          await context.post("/api/register", {
            data: { name, email: name + stamp + "@example.test", password },
          })
        ).status(),
      ).toBe(201);
    }
    expect(
      (
        await admin.post("/api/login", {
          data: {
            email: process.env.TEST_ADMIN_EMAIL,
            password: process.env.TEST_ADMIN_PASSWORD,
          },
        })
      ).status(),
    ).toBe(200);
    const areas = await Promise.all([pin, noisePin].map(async ({ lat, lng }) => {
      const result = await admin.get(`/api/geocode/reverse?lat=${lat}&lng=${lng}`);
      const { ward } = await result.json();
      expect(ward).toBeTruthy();
      return ward;
    }));
    const officer = await (
      await admin.post("/api/staff", {
        data: {
          name: "Cán bộ duyệt",
          email: "intake" + stamp + "@example.test",
          password,
          areas: [...new Set(areas)],
        },
      })
    ).json();
    expect(
      (
        await staff.post("/api/login", {
          data: { email: officer.email, password },
        })
      ).status(),
    ).toBe(200);

    const invalid = await submit(first, {
      description: "aaa",
      public: true,
    });
    expect(await screened(first, invalid)).toMatchObject({
      status: "rejected",
      intake_state: "rejected",
      intake_reason: "desc_invalid",
    });
    expect((await second.get("/api/reports/" + invalid)).status()).toBe(404);
    const inbox = await (await first.get("/api/user-notifications")).json();
    expect(
      inbox.items.some(
        (item) => item.report_id === invalid && item.kind === "rejected",
      ),
    ).toBe(true);

    const fire = await submit(first, {
      description: "Chay nha o dau hem.",
      public: true,
    });
    expect(await screened(first, fire)).toMatchObject({
      intake_state: "review",
      intake_reason: "possible_fire",
      ai_group: "other",
      urgent: true,
    });
    expect(
      (await (await admin.get("/api/notifications")).json()).map((item) => item.id),
    ).toContain(fire);
    expect((await second.get("/api/reports/" + fire)).status()).toBe(404);
    const ownerPage = await browser.newPage({ storageState: await first.storageState() });
    try {
      await ownerPage.goto(baseURL + "/#/report/" + fire);
      await expect(
        ownerPage.getByRole("link", { name: "Gọi 114 nếu đám cháy đang xảy ra" }),
      ).toHaveAttribute("href", "tel:114");
    } finally {
      await ownerPage.close();
    }

    const uncertain = await submit(first, {
      description: "Tiếng ồn lớn do hát karaoke vào ban đêm.",
      pin: noisePin,
      photos: [upload("waste")],
      public: true,
    });
    expect(await screened(first, uncertain)).toMatchObject({
      status: "received",
      intake_state: "review",
    });
    expect((await second.get("/api/reports/" + uncertain)).status()).toBe(404);
    expect(
      (await second.get("/api/reports/" + uncertain + "/photos/0")).status(),
    ).toBe(404);
    expect(
      (await (await second.get("/api/community")).json()).reports.some(
        (r) => r.id === uncertain,
      ),
    ).toBe(false);
    expect(
      (
        await admin.post("/api/reports/" + uncertain + "/assign", {
          data: { assignee: officer.id },
        })
      ).status(),
    ).toBe(409);
    expect(
      (
        await admin.post("/api/admin/reports/bulk-assign", {
          data: { report_ids: [uncertain], assignee: officer.id },
        })
      ).status(),
    ).toBe(409);
    expect(
      (
        await review(second, uncertain, { decision: "accept", group: "noise" })
      ).status(),
    ).toBe(403);
    expect(
      (await review(staff, uncertain, { decision: "reject" })).status(),
    ).toBe(422);
    const desk = await browser.newContext({
      baseURL,
      storageState: await staff.storageState(),
    });
    try {
      const page = await desk.newPage();
      await page.goto("/#/desk?tab=review");
      await page.getByLabel("Tìm kiếm phản ánh").fill(uncertain);
      await page.locator(`a[href^="#/report/${uncertain}"]`).click();
      await expect(
        page.getByRole("heading", { name: "Duyệt phản ánh" }),
      ).toBeVisible();
      await page.getByLabel("Nhóm xác nhận").selectOption("noise");
      await page
        .getByRole("button", { name: "Tiếp nhận", exact: true })
        .click();
      await expect(page.locator(".detail .status")).toHaveText("Đã tiếp nhận");
    } finally {
      await desk.close();
    }
    expect(await detail(second, uncertain)).toMatchObject({
      intake_state: "passed",
      confirmed_group: "noise",
    });
    expect(
      (await second.get("/api/reports/" + uncertain + "/photos/0")).status(),
    ).toBe(200);
    expect(
      (await admin.post("/api/reports/" + uncertain + "/reanalyze")).status(),
    ).toBe(200);
    expect(await detail(first, uncertain)).toMatchObject({
      status: "received",
      intake_state: "passed",
      confirmed_group: "noise",
    });

    const discards = await submit(first, {
      description: "Cần xem tình hình ở khu vực này.",
      location: "Khu vực xét lại",
      pin,
      public: true,
    });
    expect((await screened(first, discards)).intake_state).toBe("review");
    expect(
      (
        await review(staff, discards, {
          decision: "reject",
          note: "Vui lòng mô tả cụ thể sự việc và thời điểm.",
        })
      ).status(),
    ).toBe(200);
    expect(await detail(first, discards)).toMatchObject({
      status: "rejected",
      intake_note: "Vui lòng mô tả cụ thể sự việc và thời điểm.",
    });
    expect(
      (
        await admin.post("/api/reports/" + discards + "/reopen", {
          data: { note: "Kiểm tra lại nội dung gốc." },
        })
      ).status(),
    ).toBe(200);
    expect(await detail(first, discards)).toMatchObject({
      status: "received",
      intake_state: "review",
    });

    const duplicateIds = await Promise.all([
      submit(first, { pin }),
      submit(second, { pin: { lat: pin.lat + 0.00012, lng: pin.lng } }),
    ]);
    const verdicts = await Promise.all(
      duplicateIds.map((id) => screened(admin, id)),
    );
    expect(verdicts.map((record) => record.intake_state).sort()).toEqual([
      "passed",
      "rejected",
    ]);
    const original = verdicts.find(
      (record) => record.intake_state === "passed",
    );
    const rejected = verdicts.find(
      (record) => record.intake_state === "rejected",
    );
    expect(rejected).toMatchObject({
      intake_reason: "duplicate",
      duplicate_of: original.id,
    });
    const rejectedOwner = rejected.id === duplicateIds[0] ? first : second;
    expect(await detail(rejectedOwner, rejected.id)).not.toHaveProperty(
      "duplicate_of",
    );
    expect(
      (
        await admin.post("/api/reports/" + rejected.id + "/reopen", {
          data: { note: "Xem xét lại vị trí." },
        })
      ).status(),
    ).toBe(200);
    expect(
      await (
        await review(staff, rejected.id, { decision: "accept", group: "waste" })
      ).json(),
    ).toMatchObject({ intake_state: "rejected", intake_reason: "duplicate" });
    expect(
      (
        await admin.post("/api/reports/" + original.id + "/update", {
          data: {
            status: "resolved",
            confirmed_group: "waste",
            priority: "normal",
            note: "Đã dọn rác.",
          },
        })
      ).status(),
    ).toBe(200);
    expect(
      (await screened(first, await submit(first, { pin }))).intake_state,
    ).toBe("passed");

    const address = " Quang Trung, Phường Hạnh Thông, TP. Hồ Chí Minh";
    for (const streetNumber of ["125", "127"]) {
      expect(
        (
          await screened(
            first,
            await submit(first, { location: streetNumber + address }),
          )
        ).intake_state,
      ).toBe("passed");
    }
    const sameAddress = await submit(first, {
      location: "So 125 quang trung, P. Hanh Thong, TP. HCM",
    });
    expect(await screened(first, sameAddress)).toMatchObject({
      intake_state: "rejected",
      intake_reason: "duplicate",
    });
    expect(await detail(first, sameAddress)).toHaveProperty("duplicate_of");

    const undecided = await Promise.all(
      [first, second].map((context) =>
        submit(context, {
          description: "Tiếng ồn lớn do hát karaoke vào ban đêm.",
          location: "Hẻm thử duyệt đồng thời",
          pin,
          photos: [upload("waste")],
        }),
      ),
    );
    for (const id of undecided) {
      expect((await screened(admin, id)).intake_state).toBe("review");
    }
    const simultaneous = await Promise.all(
      undecided.map((id, index) =>
        review(index ? staff : admin, id, {
          decision: "accept",
          group: "noise",
        }),
      ),
    );
    expect(simultaneous.every((reply) => reply.status() === 200)).toBe(true);
    expect(
      (await Promise.all(simultaneous.map((reply) => reply.json())))
        .map((item) => item.intake_state)
        .sort(),
    ).toEqual(["passed", "rejected"]);
  } finally {
    await Promise.all(contexts.map((context) => context.dispose()));
  }
});
