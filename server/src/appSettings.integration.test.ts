import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Express } from "express";
import request from "supertest";
import { AdminRole } from "@prisma/client";
import { createApp } from "./app.js";
import { prisma } from "./db.js";
import { hashPassword } from "./lib/password.js";
import { signAuthToken } from "./lib/authToken.js";
import { SETTINGS_ROW_ID } from "./lib/activeCampYearSetting.js";

async function canQueryDatabase(): Promise<boolean> {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return true;
  } catch {
    return false;
  }
}

const integrationDbReady = await canQueryDatabase();

let campSchemaReady = false;
if (integrationDbReady) {
  try {
    await prisma.appSettings.findFirst({ take: 1 });
    campSchemaReady = true;
  } catch {
    campSchemaReady = false;
  }
}

const superEmail = "super-app-settings-test@example.com";
const campAdminEmail = "camp-app-settings-test@example.com";
const password = "test-password-12chars";

describe.skipIf(!integrationDbReady || !campSchemaReady)("app settings API", () => {
  let app: Express;
  let yearNewerId: string;
  let yearOlderId: string;

  beforeAll(() => {
    app = createApp();
  });

  beforeEach(async () => {
    await prisma.camper.deleteMany({});
    await prisma.worker.deleteMany({});
    await prisma.dormLeader.deleteMany({});
    await prisma.dorm.deleteMany({});
    await prisma.ageGroupBracket.deleteMany({});
    await prisma.campYear.deleteMany({});
    await prisma.appSettings.deleteMany({});

    await prisma.adminUser.deleteMany({ where: { email: { in: [superEmail, campAdminEmail] } } });
    const passwordHash = await hashPassword(password);
    await prisma.adminUser.create({
      data: { email: superEmail, passwordHash, role: AdminRole.super_admin, isActive: true },
    });
    await prisma.adminUser.create({
      data: { email: campAdminEmail, passwordHash, role: AdminRole.camp_admin, isActive: true },
    });

    const older = await prisma.campYear.create({
      data: {
        name: "Older",
        yearLabel: "2090",
        startDate: new Date("2090-07-01T12:00:00.000Z"),
        endDate: new Date("2090-07-07T12:00:00.000Z"),
        camperCapacity: 10,
      },
    });
    yearOlderId = older.id;

    const newer = await prisma.campYear.create({
      data: {
        name: "Newer",
        yearLabel: "2100",
        startDate: new Date("2100-07-01T12:00:00.000Z"),
        endDate: new Date("2100-07-07T12:00:00.000Z"),
        camperCapacity: 10,
      },
    });
    yearNewerId = newer.id;
  });

  afterAll(async () => {
    await prisma.appSettings.deleteMany({});
    await prisma.campYear.deleteMany({});
    await prisma.adminUser.deleteMany({ where: { email: { in: [superEmail, campAdminEmail] } } });
    await prisma.$disconnect();
  });

  async function superHeader(): Promise<string> {
    const admin = await prisma.adminUser.findUniqueOrThrow({ where: { email: superEmail } });
    return `Bearer ${signAuthToken({ sub: admin.id, role: admin.role })}`;
  }

  async function campAdminHeader(): Promise<string> {
    const admin = await prisma.adminUser.findUniqueOrThrow({ where: { email: campAdminEmail } });
    return `Bearer ${signAuthToken({ sub: admin.id, role: admin.role })}`;
  }

  it("lists null active id until set; PATCH sets staff default; camp-years echoes it", async () => {
    const header = await superHeader();
    const listBefore = await request(app).get("/api/admin/camp-years").set("Authorization", header);
    expect(listBefore.status).toBe(200);
    expect(listBefore.body.activeCampYearId).toBeNull();

    const patch = await request(app)
      .patch("/api/admin/settings")
      .set("Authorization", header)
      .send({ activeCampYearId: yearOlderId });
    expect(patch.status).toBe(200);
    expect(patch.body.activeCampYearId).toBe(yearOlderId);

    const listAfter = await request(app).get("/api/admin/camp-years").set("Authorization", header);
    expect(listAfter.status).toBe(200);
    expect(listAfter.body.activeCampYearId).toBe(yearOlderId);
  });

  it("camp_admin can read settings but not patch", async () => {
    const superH = await superHeader();
    await request(app)
      .patch("/api/admin/settings")
      .set("Authorization", superH)
      .send({ activeCampYearId: yearNewerId });

    const campH = await campAdminHeader();
    const read = await request(app).get("/api/admin/settings").set("Authorization", campH);
    expect(read.status).toBe(200);
    expect(read.body.activeCampYearId).toBe(yearNewerId);

    const forbidden = await request(app)
      .patch("/api/admin/settings")
      .set("Authorization", campH)
      .send({ activeCampYearId: yearOlderId });
    expect(forbidden.status).toBe(403);
  });

  it("rejects PATCH when camp year id is unknown", async () => {
    const header = await superHeader();
    const res = await request(app)
      .patch("/api/admin/settings")
      .set("Authorization", header)
      .send({ activeCampYearId: "00000000-0000-4000-8000-000000000001" });
    expect(res.status).toBe(400);
  });

  it("creates settings row on first PATCH when table was empty", async () => {
    await prisma.appSettings.deleteMany({});
    const header = await superHeader();
    const res = await request(app)
      .patch("/api/admin/settings")
      .set("Authorization", header)
      .send({ activeCampYearId: null });
    expect(res.status).toBe(200);
    const row = await prisma.appSettings.findUnique({ where: { id: SETTINGS_ROW_ID } });
    expect(row).not.toBeNull();
  });
});
