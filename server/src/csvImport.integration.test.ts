import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Express } from "express";
import request from "supertest";
import { AdminRole } from "@prisma/client";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createApp } from "./app.js";
import { prisma } from "./db.js";
import { hashPassword } from "./lib/password.js";
import { signAuthToken } from "./lib/authToken.js";

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
    await prisma.camper.findFirst({ take: 1 });
    campSchemaReady = true;
  } catch {
    campSchemaReady = false;
  }
}

const superEmail = "csv-import-super@example.com";
const campAdminEmail = "csv-import-camp@example.com";
const password = "test-password-12chars";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "../..");
const camperDummyPath = join(repoRoot, "docs/dummy-data/BYC Camper Form - Dummy Data.csv");
const workerDummyPath = join(repoRoot, "docs/dummy-data/BYC Worker Form - Dummy Data.csv");
const leaderDummyPath = join(repoRoot, "docs/dummy-data/BYC Leader Form - Dummy Data.csv");

describe.skipIf(!integrationDbReady || !campSchemaReady)("CSV import API (super admin)", () => {
  let app: Express;
  let campYearId: string;

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
    await prisma.adminUser.deleteMany({
      where: { email: { in: [superEmail, campAdminEmail] } },
    });

    const passwordHash = await hashPassword(password);
    await prisma.adminUser.createMany({
      data: [
        { email: superEmail, passwordHash, role: AdminRole.super_admin, isActive: true },
        { email: campAdminEmail, passwordHash, role: AdminRole.camp_admin, isActive: true },
      ],
    });

    const year = await prisma.campYear.create({
      data: {
        name: "CSV Import Camp",
        yearLabel: "2098",
        startDate: new Date("2098-07-01T12:00:00.000Z"),
        endDate: new Date("2098-07-07T12:00:00.000Z"),
        camperCapacity: 500,
      },
    });
    campYearId = year.id;
  });

  afterAll(async () => {
    await prisma.camper.deleteMany({});
    await prisma.worker.deleteMany({});
    await prisma.dormLeader.deleteMany({});
    await prisma.dorm.deleteMany({});
    await prisma.ageGroupBracket.deleteMany({});
    await prisma.campYear.deleteMany({});
    await prisma.adminUser.deleteMany({
      where: { email: { in: [superEmail, campAdminEmail] } },
    });
    await prisma.$disconnect();
  });

  it("returns 403 for camp_admin on CSV preview", async () => {
    const admin = await prisma.adminUser.findUniqueOrThrow({ where: { email: campAdminEmail } });
    const token = signAuthToken({ sub: admin.id, role: admin.role });
    const csvText = "First Name,Last Name,Gender,Date of Birth,Parent Guardian Name,Email Address,Parent Phone\nX,Y,Female,2011-01-01,P,p@e.com,5551234567\n";
    const response = await request(app)
      .post(`/api/admin/camp-years/${campYearId}/csv-import/preview`)
      .set("Authorization", `Bearer ${token}`)
      .send({ kind: "camper", csvText });
    expect(response.status).toBe(403);
  });

  it("previews BYC worker dummy file without row errors", async () => {
    const admin = await prisma.adminUser.findUniqueOrThrow({ where: { email: superEmail } });
    const token = signAuthToken({ sub: admin.id, role: admin.role });
    const csvText = readFileSync(workerDummyPath, "utf8");
    const response = await request(app)
      .post(`/api/admin/camp-years/${campYearId}/csv-import/preview`)
      .set("Authorization", `Bearer ${token}`)
      .send({ kind: "worker", csvText });
    expect(response.status).toBe(200);
    expect(response.body.invalidRowCount).toBe(0);
    expect(response.body.validRowCount).toBeGreaterThan(0);
  });

  it("previews BYC leader dummy file without row errors", async () => {
    const admin = await prisma.adminUser.findUniqueOrThrow({ where: { email: superEmail } });
    const token = signAuthToken({ sub: admin.id, role: admin.role });
    const csvText = readFileSync(leaderDummyPath, "utf8");
    const response = await request(app)
      .post(`/api/admin/camp-years/${campYearId}/csv-import/preview`)
      .set("Authorization", `Bearer ${token}`)
      .send({ kind: "dorm_leader", csvText });
    expect(response.status).toBe(200);
    expect(response.body.invalidRowCount).toBe(0);
    expect(response.body.validRowCount).toBeGreaterThan(0);
  });

  it("previews BYC camper dummy file without row errors", async () => {
    const admin = await prisma.adminUser.findUniqueOrThrow({ where: { email: superEmail } });
    const token = signAuthToken({ sub: admin.id, role: admin.role });
    const csvText = readFileSync(camperDummyPath, "utf8");
    const response = await request(app)
      .post(`/api/admin/camp-years/${campYearId}/csv-import/preview`)
      .set("Authorization", `Bearer ${token}`)
      .send({ kind: "camper", csvText });
    expect(response.status).toBe(200);
    expect(response.body.invalidRowCount).toBe(0);
    expect(response.body.validRowCount).toBeGreaterThan(0);
    expect(response.body.capacity?.wouldExceed).toBe(false);
  });

  it("commits worker import when duplicate emails appear in the same batch", async () => {
    const admin = await prisma.adminUser.findUniqueOrThrow({ where: { email: superEmail } });
    const token = signAuthToken({ sub: admin.id, role: admin.role });
    const csvText = [
      "Email Address,First Name,Last Name,Gender,Cell Number,Street Address,City,State or Province,Zip code,Country (USA, CAN, etc.)",
      "dup@example.com,A,B,Male,5551234567,1 Main,X,Y,12345,USA",
      "dup@example.com,C,D,Male,5551234567,2 Oak,X,Y,12345,USA",
    ].join("\n");

    const response = await request(app)
      .post(`/api/admin/camp-years/${campYearId}/csv-import/commit`)
      .set("Authorization", `Bearer ${token}`)
      .send({ kind: "worker", csvText });

    expect(response.status).toBe(201);
    expect(response.body.imported).toBe(2);
    const workerCount = await prisma.worker.count({ where: { campYearId } });
    expect(workerCount).toBe(2);
  });

  it("commits camper import in a transaction", async () => {
    const admin = await prisma.adminUser.findUniqueOrThrow({ where: { email: superEmail } });
    const token = signAuthToken({ sub: admin.id, role: admin.role });
    const csvText = readFileSync(camperDummyPath, "utf8");
    const response = await request(app)
      .post(`/api/admin/camp-years/${campYearId}/csv-import/commit`)
      .set("Authorization", `Bearer ${token}`)
      .send({ kind: "camper", csvText });
    expect(response.status).toBe(201);
    expect(response.body.imported).toBeGreaterThan(0);
    const campers = await prisma.camper.findMany({
      where: { campYearId },
      select: { importSource: true, qrToken: true },
    });
    expect(campers.every((camper) => camper.importSource === "csv_import")).toBe(true);
    expect(campers.every((camper) => camper.qrToken.length > 0)).toBe(true);
  });
});
