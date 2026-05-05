import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Express } from "express";
import request from "supertest";
import {
  AdminRole,
  CamperPaymentStatus,
  CheckInStatus,
  Gender,
} from "@prisma/client";
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

const superEmail = "super-dorm-roster-report@example.com";
const campAdminEmail = "camp-admin-dorm-roster-report@example.com";
const password = "test-password-12chars";

describe.skipIf(!integrationDbReady || !campSchemaReady)("dorm roster report API", () => {
  let app: Express;
  let campYearId: string;
  let camperDormId: string;
  let bracketId: string;

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
    await prisma.adminUser.create({
      data: {
        email: superEmail,
        passwordHash,
        role: AdminRole.super_admin,
        isActive: true,
      },
    });
    await prisma.adminUser.create({
      data: {
        email: campAdminEmail,
        passwordHash,
        role: AdminRole.camp_admin,
        isActive: true,
      },
    });

    const year = await prisma.campYear.create({
      data: {
        name: "Roster Report Camp",
        yearLabel: "2097",
        startDate: new Date("2097-07-10T12:00:00.000Z"),
        endDate: new Date("2097-07-16T12:00:00.000Z"),
        camperCapacity: 100,
      },
    });
    campYearId = year.id;

    const bracket = await prisma.ageGroupBracket.create({
      data: {
        campYearId,
        label: "Youth",
        minAge: 10,
        maxAge: 14,
        sortOrder: 1,
      },
    });
    bracketId = bracket.id;

    const dorm = await prisma.dorm.create({
      data: {
        campYearId,
        name: "Pine Cabin",
        purpose: "camper",
        genderDesignation: "boys",
        bedCapacity: 24,
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
    await prisma.adminUser.deleteMany({
      where: { email: { in: [superEmail, campAdminEmail] } },
    });
    await prisma.$disconnect();
  });

  async function superAuthHeader(): Promise<string> {
    const admin = await prisma.adminUser.findUniqueOrThrow({ where: { email: superEmail } });
    return `Bearer ${signAuthToken({ sub: admin.id, role: admin.role })}`;
  }

  async function campAdminAuthHeader(): Promise<string> {
    const admin = await prisma.adminUser.findUniqueOrThrow({ where: { email: campAdminEmail } });
    return `Bearer ${signAuthToken({ sub: admin.id, role: admin.role })}`;
  }

  it("returns 401 without auth for roster", async () => {
    const res = await request(app).get(`/api/admin/camp-years/${campYearId}/dorms/${camperDormId}/roster`);
    expect(res.status).toBe(401);
  });

  it("returns camp year context, camper gender, and invalid query returns 400", async () => {
    const header = await superAuthHeader();
    const suffix = Math.random().toString(36).slice(2, 8);

    const male = await request(app)
      .post(`/api/admin/camp-years/${campYearId}/campers`)
      .set("Authorization", header)
      .send({
        firstName: "Alex",
        lastName: `Male${suffix}`,
        dateOfBirth: "2084-01-15",
        gender: Gender.male,
        guardianName: "Parent One",
        guardianEmail: `p1-${suffix}@example.com`,
        guardianPhone: "5551000001",
        medicalNotes: "Allergies: peanuts; Medication: epinephrine as needed.",
        paymentStatus: CamperPaymentStatus.unpaid,
        dormId: camperDormId,
      });
    expect(male.status).toBe(201);
    const maleId = male.body.id as string;

    await request(app)
      .post(`/api/admin/camp-years/${campYearId}/campers`)
      .set("Authorization", header)
      .send({
        firstName: "Jordan",
        lastName: `Female${suffix}`,
        dateOfBirth: "2085-06-01",
        gender: Gender.female,
        guardianName: "Parent Two",
        guardianEmail: `p2-${suffix}@example.com`,
        guardianPhone: "5551000002",
        paymentStatus: CamperPaymentStatus.unpaid,
        dormId: camperDormId,
      });

    await prisma.camper.update({
      where: { id: maleId },
      data: { checkInStatus: CheckInStatus.checked_in },
    });

    const badQuery = await request(app)
      .get(`/api/admin/camp-years/${campYearId}/dorms/${camperDormId}/roster`)
      .set("Authorization", header)
      .query({ checkInStatus: "nope" });
    expect(badQuery.status).toBe(400);

    const full = await request(app)
      .get(`/api/admin/camp-years/${campYearId}/dorms/${camperDormId}/roster`)
      .set("Authorization", header);
    expect(full.status).toBe(200);
    expect(full.body.campYear).toMatchObject({
      id: campYearId,
      name: "Roster Report Camp",
      yearLabel: "2097",
    });
    expect(full.body.occupantCount).toBe(2);
    expect(full.body.campers).toHaveLength(2);
    const genders = full.body.campers.map((c: { gender: string }) => c.gender).sort();
    expect(genders).toEqual(["female", "male"]);

    const checkedInOnly = await request(app)
      .get(`/api/admin/camp-years/${campYearId}/dorms/${camperDormId}/roster`)
      .set("Authorization", header)
      .query({ checkInStatus: "checked_in" });
    expect(checkedInOnly.status).toBe(200);
    expect(checkedInOnly.body.campers).toHaveLength(1);
    expect(checkedInOnly.body.campers[0].firstName).toBe("Alex");

    const femaleOnly = await request(app)
      .get(`/api/admin/camp-years/${campYearId}/dorms/${camperDormId}/roster`)
      .set("Authorization", header)
      .query({ gender: "female" });
    expect(femaleOnly.status).toBe(200);
    expect(femaleOnly.body.campers).toHaveLength(1);
    expect(femaleOnly.body.campers[0].lastName).toContain("Female");

    const bracketFilter = await request(app)
      .get(`/api/admin/camp-years/${campYearId}/dorms/${camperDormId}/roster`)
      .set("Authorization", header)
      .query({ ageGroupBracketId: bracketId });
    expect(bracketFilter.status).toBe(200);
    expect(bracketFilter.body.campers.length).toBeGreaterThanOrEqual(1);
  });

  it("allows camp_admin to list age group brackets for filters", async () => {
    const header = await campAdminAuthHeader();
    const res = await request(app)
      .get(`/api/admin/camp-years/${campYearId}/age-group-brackets`)
      .set("Authorization", header);
    expect(res.status).toBe(200);
    expect(res.body.ageGroupBrackets).toHaveLength(1);
    expect(res.body.ageGroupBrackets[0].label).toBe("Youth");
  });
});
