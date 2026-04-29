import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Express } from "express";
import request from "supertest";
import { AdminRole, Gender, CamperPaymentStatus } from "@prisma/client";
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

const superEmail = "super-camp-mgmt-test@example.com";
const password = "test-password-12chars";

describe.skipIf(!integrationDbReady || !campSchemaReady)("camp management API", () => {
  let app: Express;
  let campYearId: string;
  let camperDormId: string;

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

    await prisma.adminUser.deleteMany({ where: { email: superEmail } });
    const passwordHash = await hashPassword(password);
    await prisma.adminUser.create({
      data: {
        email: superEmail,
        passwordHash,
        role: AdminRole.super_admin,
        isActive: true,
      },
    });

    const year = await prisma.campYear.create({
      data: {
        name: "Integration Camp",
        yearLabel: "2099",
        startDate: new Date("2099-07-01T12:00:00.000Z"),
        endDate: new Date("2099-07-07T12:00:00.000Z"),
        camperCapacity: 1,
      },
    });
    campYearId = year.id;

    const bracket = await prisma.ageGroupBracket.create({
      data: {
        campYearId,
        label: "Teens",
        minAge: 13,
        maxAge: 17,
        sortOrder: 1,
      },
    });

    const dorm = await prisma.dorm.create({
      data: {
        campYearId,
        name: "Test Cabin",
        purpose: "camper",
        genderDesignation: "boys",
        bedCapacity: 20,
        ageGroupBracketId: bracket.id,
      },
    });
    camperDormId = dorm.id;
  });

  afterAll(async () => {
    await prisma.camper.deleteMany({});
    await prisma.dorm.deleteMany({});
    await prisma.ageGroupBracket.deleteMany({});
    await prisma.campYear.deleteMany({});
    await prisma.adminUser.deleteMany({ where: { email: superEmail } });
    await prisma.$disconnect();
  });

  function camperPayload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    const suffix = Math.random().toString(36).slice(2, 8);
    return {
      firstName: "Cap",
      lastName: `Test${suffix}`,
      dateOfBirth: "2012-05-01",
      gender: Gender.male,
      guardianName: "Parent",
      guardianEmail: `parent-${suffix}@capacity-test.example.com`,
      guardianPhone: "5551234567",
      paymentStatus: CamperPaymentStatus.unpaid,
      dormId: camperDormId,
      ...overrides,
    };
  }

  it("returns 409 when admin entry exceeds capacity until override is confirmed", async () => {
    const admin = await prisma.adminUser.findUniqueOrThrow({ where: { email: superEmail } });
    const token = signAuthToken({ sub: admin.id, role: admin.role });

    const first = await request(app)
      .post(`/api/admin/camp-years/${campYearId}/campers`)
      .set("Authorization", `Bearer ${token}`)
      .send(camperPayload());
    expect(first.status).toBe(201);

    const blocked = await request(app)
      .post(`/api/admin/camp-years/${campYearId}/campers`)
      .set("Authorization", `Bearer ${token}`)
      .send(camperPayload());
    expect(blocked.status).toBe(409);
    expect(blocked.body.error).toBe("capacity_exceeded");

    const allowed = await request(app)
      .post(`/api/admin/camp-years/${campYearId}/campers`)
      .set("Authorization", `Bearer ${token}`)
      .send(camperPayload({ confirmCapacityOverride: true }));
    expect(allowed.status).toBe(201);
  });

  it("returns 409 for CSV-style bulk import until override is confirmed", async () => {
    await prisma.camper.deleteMany({ where: { campYearId } });

    const admin = await prisma.adminUser.findUniqueOrThrow({ where: { email: superEmail } });
    const token = signAuthToken({ sub: admin.id, role: admin.role });

    const rows = [camperPayload(), camperPayload()];
    const blocked = await request(app)
      .post(`/api/admin/camp-years/${campYearId}/campers/import`)
      .set("Authorization", `Bearer ${token}`)
      .send({ campers: rows });
    expect(blocked.status).toBe(409);
    expect(blocked.body.error).toBe("capacity_exceeded");

    const allowed = await request(app)
      .post(`/api/admin/camp-years/${campYearId}/campers/import`)
      .set("Authorization", `Bearer ${token}`)
      .send({ campers: rows, confirmCapacityOverride: true });
    expect(allowed.status).toBe(201);
    expect(allowed.body.imported).toBe(2);
  });
});
