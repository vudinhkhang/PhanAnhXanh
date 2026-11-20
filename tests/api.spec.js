import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";

test("AI đa phương thức, bảo mật hồ sơ và thông báo sớm", async ({
  playwright,
  baseURL,
}, testInfo) => {
  test.skip(
    !process.env.TEST_ADMIN_PASSWORD || testInfo.project.name !== "desktop",
    "Kiểm tra API trên PostgreSQL",
  );
  const citizen = await playwright.request.newContext({ baseURL }),
    other = await playwright.request.newContext({ baseURL }),
    admin = await playwright.request.newContext({ baseURL });
  const tag = Date.now(),
    password = "Testing-2026!";
  const register = async (ctx, who) =>
    expect(
      (
        await ctx.post("/api/register", {
          data: { name: who, email: who + tag + "@example.test", password },
        })
      ).status(),
    ).toBe(201);
  await register(citizen, "citizen");
  await register(other, "other");
  const photo =
    "data:image/webp;base64," +
    readFileSync("public/images/water.webp").toString("base64");
  const data = {
    description: "Cá chết hàng loạt trên kênh, nước đổi màu đen.",
    location: "Kênh kiểm thử",
    photos: [photo],
    public: false,
    pin: { lat: 10.76269, lng: 106.68251 },
  };
  expect(
    (
      await citizen.post("/api/reports", {
        data: { ...data, photos: Array(4).fill(photo) },
      })
    ).status(),
  ).toBe(422);
  expect(
    (
      await citizen.post("/api/reports", {
        data: { ...data, photos: ["not-an-image"] },
      })
    ).status(),
  ).toBe(422);
  for (const pin of [{ lat: 91, lng: 106 }, { lat: 10 }]) {
    expect(
      (await citizen.post("/api/reports", { data: { ...data, pin } })).status(),
    ).toBe(422);
  }
  const submitted = await citizen.post("/api/reports", { data });
  expect(submitted.status()).toBe(201);
  const { id, status } = await submitted.json();
  expect(status).toBe("received");
  const url = "/api/reports/" + id;
  const publicFeed = await (await other.get("/api/community")).json();
  expect(publicFeed.reports.map((r) => r.id)).not.toContain(id);
  expect((await other.get(url)).status()).toBe(404);
  expect((await other.get(url + "/photos/0")).status()).toBe(404);
  expect(
    (await citizen.post(url + "/assign", { data: { assignee: 1 } })).status(),
  ).toBe(403);
  expect((await other.get("/api/notifications")).status()).toBe(403);
  await expect
    .poll(async () => (await (await citizen.get(url)).json()).ai_group, {
      timeout: 30000,
    })
    .toBe("water");
  const report = await (await citizen.get(url)).json();
  expect(report.confirmed_group).toBeNull();
  expect(report.urgent).toBe(true);
  expect(report.ai_source).toBe("clip");
  expect(report.ai_summary).toBeNull();
  expect(report.advice).toBeTruthy();
  expect(Array.isArray(report.advice.hotlines)).toBe(true);
  expect(Array.isArray(report.advice.tips)).toBe(true);
  await admin.post("/api/login", {
    data: {
      email: process.env.TEST_ADMIN_EMAIL,
      password: process.env.TEST_ADMIN_PASSWORD,
    },
  });
  expect(
    (await (await admin.get("/api/notifications")).json()).map((n) => n.id),
  ).toContain(id);
  const officer = await (
    await admin.post("/api/staff", {
      data: {
        name: "Cán bộ thử",
        email: "staff" + tag + "@example.test",
        password,
      },
    })
  ).json();
  const staff = await playwright.request.newContext({ baseURL });
  await staff.post("/api/login", { data: { email: officer.email, password } });
  const staffCase = await (await staff.get(url)).json();
  expect(staffCase.pin).toEqual({ ...data.pin, approximate: false });
  expect(staffCase.location).toBe(data.location);
  const update = {
    status: "processing",
    confirmed_group: "other",
    priority: "normal",
    note: "Đã kiểm tra.",
  };
  expect((await staff.post(url + "/update", { data: update })).status()).toBe(
    403,
  );
  async function submitForAssignment(suffix) {
    const response = await citizen.post("/api/reports", {
      data: {
        ...data,
        pin: null,
        location: "Kênh kiểm thử " + suffix,
        photos: [],
      },
    });
    expect(response.status()).toBe(201);
    const caseId = (await response.json()).id;
    await expect
      .poll(
        async () =>
          (await (await admin.get("/api/reports/" + caseId)).json())
            .intake_state,
      )
      .toBe("passed");
    return caseId;
  }
  const secondId = await submitForAssignment("phía bắc");
  const spareId = await submitForAssignment("phía nam");
  const bulk = "/api/admin/reports/bulk-assign";
  const assignment = { report_ids: [id, secondId], assignee: officer.id };
  expect((await staff.post(bulk, { data: assignment })).status()).toBe(403);
  const attempts = await Promise.all([
    admin.post(bulk, { data: assignment }),
    admin.post(bulk, { data: { ...assignment, report_ids: [secondId, id] } }),
  ]);
  expect(attempts.map((response) => response.status()).sort()).toEqual([
    200, 409,
  ]);
  for (const reportId of assignment.report_ids) {
    const assigned = await (await admin.get("/api/reports/" + reportId)).json();
    expect(assigned.assignee).toBe(officer.id);
    expect(
      assigned.history.filter((entry) => entry.note.startsWith("Đã phân công")),
    ).toHaveLength(1);
  }
  expect(
    (
      await admin.post(bulk, {
        data: { ...assignment, report_ids: [id, spareId] },
      })
    ).status(),
  ).toBe(409);
  expect(
    (await (await admin.get("/api/reports/" + spareId)).json()).assignee,
  ).toBeNull();
  expect(
    (
      await admin.post(url + "/assign", { data: { assignee: officer.id } })
    ).status(),
  ).toBe(200);
  expect((await staff.post(url + "/update", { data: update })).status()).toBe(
    200,
  );
  const checked = await (await citizen.get(url)).json();
  expect(checked.ai_group).toBe("water");
  expect(checked.confirmed_group).toBe("other");
  expect((await citizen.post("/api/admin/ai-briefing")).status()).toBe(403);
  const briefRes = await admin.post("/api/admin/ai-briefing");
  expect(briefRes.status()).toBe(200);
  const brief = await briefRes.json();
  expect(Array.isArray(brief.recommendations)).toBe(true);
  const assistRes = await staff.post(url + "/ai-assist");
  expect(assistRes.status()).toBe(200);
  const assist = await assistRes.json();
  expect(assist.confirmed_group).toBe("other");
  expect(["normal", "high"]).toContain(assist.priority);
  expect(Array.isArray(assist.action_steps)).toBe(true);
  expect(assist.draft_note).toContain(id);
  expect((await citizen.get("/api/admin/users")).status()).toBe(403);
  const usersRes = await admin.get("/api/admin/users");
  expect(usersRes.status()).toBe(200);
  const usersList = await usersRes.json();
  expect(
    usersList.some((u) => u.submitted_count >= 1 && u.role === "citizen"),
  ).toBe(true);
  const createdUserRes = await admin.post("/api/admin/users", {
    data: {
      name: "Người dùng phân quyền",
      email: "rbac" + tag + "@example.test",
      password,
      role: "citizen",
    },
  });
  expect(createdUserRes.status()).toBe(201);
  const createdUser = await createdUserRes.json();
  expect(createdUser.role).toBe("citizen");
  const promoted = await admin.patch("/api/admin/users/" + createdUser.id, {
    data: { role: "staff" },
  });
  expect(promoted.status()).toBe(200);
  expect((await promoted.json()).role).toBe("staff");
  const promotedAdmin = await admin.patch(
    "/api/admin/users/" + createdUser.id,
    {
      data: { role: "admin", password: "NewPassword-2026!" },
    },
  );
  expect(promotedAdmin.status()).toBe(200);
  expect((await promotedAdmin.json()).role).toBe("admin");
  const adminMe = await (await admin.get("/api/session")).json();
  expect(
    (
      await admin.patch("/api/admin/users/" + adminMe.id, {
        data: { active: false },
      })
    ).status(),
  ).toBe(400);
  await admin.patch("/api/staff/" + officer.id, { data: { active: false } });
  expect((await staff.get("/api/reports")).status()).toBe(401);
  await admin.patch("/api/staff/" + officer.id, { data: { active: true } });
  expect(
    (
      await staff.post("/api/login", {
        data: { email: officer.email, password },
      })
    ).status(),
  ).toBe(200);
  await Promise.all([
    citizen.dispose(),
    other.dispose(),
    staff.dispose(),
    admin.dispose(),
  ]);
});
