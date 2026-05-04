import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Express } from "express";
import request from "supertest";
import {
  AdminRole,
  CamperPaymentStatus,
  CheckInStatus,
  Gender,
  ImportSource,
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

const superEmail = "super-check-in-test@example.com";
const password = "test-password-12chars";

describe.skipIf(!integrationDbReady || !campSchemaReady)("check-in API", () => {
  let app: Express;
  let campYearId: string;
  let camperDormId: string;
  let workerDormId: string;

  beforeAll(() => {
    app = createApp();
  });

  beforeEach(async () => {
    vi.restoreAllMocks();
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
        name: "Check-In Camp",
        yearLabel: "2098",
        startDate: new Date("2098-07-01T12:00:00.000Z"),
        endDate: new Date("2098-07-07T12:00:00.000Z"),
        camperCapacity: 100,
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

    const camperDorm = await prisma.dorm.create({
      data: {
        campYearId,
        name: "Camper Hall A",
        purpose: "camper",
        genderDesignation: "boys",
        bedCapacity: 40,
        ageGroupBracketId: bracket.id,
      },
    });
    camperDormId = camperDorm.id;

    const workerDorm = await prisma.dorm.create({
      data: {
        campYearId,
        name: "Staff Bunk",
        purpose: "worker",
        genderDesignation: "co_ed",
        bedCapacity: 20,
      },
    });
    workerDormId = workerDorm.id;
  });

  afterAll(async () => {
    await prisma.camper.deleteMany({});
    await prisma.worker.deleteMany({});
    await prisma.dormLeader.deleteMany({});
    await prisma.dorm.deleteMany({});
    await prisma.ageGroupBracket.deleteMany({});
    await prisma.campYear.deleteMany({});
    await prisma.adminUser.deleteMany({ where: { email: superEmail } });
    await prisma.$disconnect();
  });

  async function authHeader(): Promise<string> {
    const admin = await prisma.adminUser.findUniqueOrThrow({ where: { email: superEmail } });
    return `Bearer ${signAuthToken({ sub: admin.id, role: admin.role })}`;
  }

  it("QR lookup rejects invalid token", async () => {
    const header = await authHeader();
    const res = await request(app)
      .get(`/api/admin/camp-years/${campYearId}/check-in/lookup/qr`)
      .set("Authorization", header)
      .query({ token: "not-valid" });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("invalid_qr_token");
  });

  it("QR lookup returns camper for valid token", async () => {
    const header = await authHeader();
    const create = await request(app)
      .post(`/api/admin/camp-years/${campYearId}/campers`)
      .set("Authorization", header)
      .send({
        firstName: "Qr",
        lastName: "Camper",
        dateOfBirth: "2011-06-01",
        gender: Gender.male,
        guardianName: "Pat",
        guardianEmail: "pat@example.com",
        guardianPhone: "5550001111",
        paymentStatus: CamperPaymentStatus.unpaid,
        dormId: camperDormId,
      });
    expect(create.status).toBe(201);
    const token = create.body.qrToken as string;

    const lookup = await request(app)
      .get(`/api/admin/camp-years/${campYearId}/check-in/lookup/qr`)
      .set("Authorization", header)
      .query({ token });
    expect(lookup.status).toBe(200);
    expect(lookup.body.camper.firstName).toBe("Qr");
    expect(lookup.body.camper.dormAssignment).toBe("Camper Hall A");
  });

  it("manual camper search finds by partial name", async () => {
    const header = await authHeader();
    await request(app)
      .post(`/api/admin/camp-years/${campYearId}/campers`)
      .set("Authorization", header)
      .send({
        firstName: "Searchy",
        lastName: "McFind",
        dateOfBirth: "2010-01-15",
        gender: Gender.female,
        guardianName: "G",
        guardianEmail: "g@example.com",
        guardianPhone: "555",
        paymentStatus: CamperPaymentStatus.unpaid,
      });

    const search = await request(app)
      .get(`/api/admin/camp-years/${campYearId}/check-in/search/campers`)
      .set("Authorization", header)
      .query({ q: "Searchy Mc" });
    expect(search.status).toBe(200);
    expect(search.body.campers.length).toBe(1);
    expect(search.body.campers[0].lastName).toBe("McFind");
  });

  it("camper check-in sends log email once; duplicate is idempotent", async () => {
    const logSpy = vi.spyOn(console, "info").mockImplementation(() => {});
    const header = await authHeader();
    const create = await request(app)
      .post(`/api/admin/camp-years/${campYearId}/campers`)
      .set("Authorization", header)
      .send({
        firstName: "Mail",
        lastName: "Test",
        dateOfBirth: "2012-05-01",
        gender: Gender.male,
        guardianName: "Guard",
        guardianEmail: "guard-checkin@example.com",
        guardianPhone: "555",
        paymentStatus: CamperPaymentStatus.unpaid,
        dormId: camperDormId,
      });
    const camperId = create.body.id as string;

    const first = await request(app)
      .post(`/api/admin/camp-years/${campYearId}/check-in/campers/${camperId}/check-in`)
      .set("Authorization", header)
      .send({});
    expect(first.status).toBe(200);
    expect(first.body.alreadyCheckedIn).toBe(false);
    expect(first.body.checkInConfirmationEmail?.status).toBe("skipped_log");
    expect(first.body.camper.checkInStatus).toBe(CheckInStatus.checked_in);
    expect(first.body.camper.checkedInAt).toBeTruthy();

    const second = await request(app)
      .post(`/api/admin/camp-years/${campYearId}/check-in/campers/${camperId}/check-in`)
      .set("Authorization", header)
      .send({});
    expect(second.status).toBe(200);
    expect(second.body.alreadyCheckedIn).toBe(true);
    expect(second.body.checkInConfirmationEmail).toBeNull();

    expect(logSpy.mock.calls.some((c) => String(c[0]).includes("guard-checkin@example.com"))).toBe(true);
  });

  it("mark paid cash for camper updates payment and dashboard unpaid count", async () => {
    const header = await authHeader();
    const create = await request(app)
      .post(`/api/admin/camp-years/${campYearId}/campers`)
      .set("Authorization", header)
      .send({
        firstName: "Cash",
        lastName: "Payer",
        dateOfBirth: "2012-05-01",
        gender: Gender.male,
        guardianName: "G",
        guardianEmail: "cash@example.com",
        guardianPhone: "555",
        paymentStatus: CamperPaymentStatus.unpaid,
      });
    const camperId = create.body.id as string;

    const before = await request(app)
      .get(`/api/admin/camp-years/${campYearId}/check-in/summary`)
      .set("Authorization", header);
    expect(before.body.unpaidCampersRemaining).toBe(1);

    await request(app)
      .post(`/api/admin/camp-years/${campYearId}/check-in/campers/${camperId}/check-in`)
      .set("Authorization", header)
      .send({ markPaidCashForCamper: true });

    const after = await request(app)
      .get(`/api/admin/camp-years/${campYearId}/check-in/summary`)
      .set("Authorization", header);
    expect(after.body.unpaidCampersRemaining).toBe(0);

    const row = await prisma.camper.findUniqueOrThrow({ where: { id: camperId } });
    expect(row.paymentStatus).toBe(CamperPaymentStatus.paid_cash);
  });

  it("mark paid cash for guardian family updates all siblings with same guardian email", async () => {
    const header = await authHeader();
    const sharedEmail = "family-pay@example.com";
    const a = await request(app)
      .post(`/api/admin/camp-years/${campYearId}/campers`)
      .set("Authorization", header)
      .send({
        firstName: "Kid",
        lastName: "One",
        dateOfBirth: "2012-05-01",
        gender: Gender.male,
        guardianName: "Parent",
        guardianEmail: sharedEmail,
        guardianPhone: "555",
        paymentStatus: CamperPaymentStatus.unpaid,
      });
    await request(app)
      .post(`/api/admin/camp-years/${campYearId}/campers`)
      .set("Authorization", header)
      .send({
        firstName: "Kid",
        lastName: "Two",
        dateOfBirth: "2014-05-01",
        gender: Gender.male,
        guardianName: "Parent",
        guardianEmail: sharedEmail,
        guardianPhone: "555",
        paymentStatus: CamperPaymentStatus.unpaid,
      });
    const camperId = a.body.id as string;

    await request(app)
      .post(`/api/admin/camp-years/${campYearId}/check-in/campers/${camperId}/check-in`)
      .set("Authorization", header)
      .send({ markPaidCashForGuardianFamily: true });

    const unpaid = await prisma.camper.count({
      where: { campYearId, guardianEmail: sharedEmail, paymentStatus: CamperPaymentStatus.unpaid },
    });
    expect(unpaid).toBe(0);
  });

  it("worker and dorm leader name search and check-in update summary", async () => {
    const header = await authHeader();
    await prisma.worker.create({
      data: {
        campYearId,
        email: "vol@example.com",
        firstName: "Wanda",
        lastName: "Worker",
        gender: Gender.female,
        cellPhone: "555",
        streetAddress: "1 St",
        city: "X",
        stateOrProvince: "Y",
        postalCode: "Z",
        country: "US",
        dormId: workerDormId,
        importSource: ImportSource.admin_entry,
      },
    });
    await prisma.dormLeader.create({
      data: {
        campYearId,
        firstName: "Dan",
        lastName: "Dormlead",
        gender: Gender.male,
        email: "dl@example.com",
        phone: "555",
        assignedCamperDormId: camperDormId,
        importSource: ImportSource.admin_entry,
      },
    });

    const wSearch = await request(app)
      .get(`/api/admin/camp-years/${campYearId}/check-in/search/workers`)
      .set("Authorization", header)
      .query({ q: "Wanda" });
    expect(wSearch.body.workers.length).toBe(1);
    const workerId = wSearch.body.workers[0].id as string;

    const dlSearch = await request(app)
      .get(`/api/admin/camp-years/${campYearId}/check-in/search/dorm-leaders`)
      .set("Authorization", header)
      .query({ q: "Dan Dorm" });
    expect(dlSearch.body.dormLeaders.length).toBe(1);
    const leaderId = dlSearch.body.dormLeaders[0].id as string;

    await request(app)
      .post(`/api/admin/camp-years/${campYearId}/check-in/workers/${workerId}/check-in`)
      .set("Authorization", header)
      .send({});
    await request(app)
      .post(`/api/admin/camp-years/${campYearId}/check-in/dorm-leaders/${leaderId}/check-in`)
      .set("Authorization", header)
      .send({});

    const summary = await request(app)
      .get(`/api/admin/camp-years/${campYearId}/check-in/summary`)
      .set("Authorization", header);
    expect(summary.body.workersCheckedIn).toBe(1);
    expect(summary.body.dormLeadersCheckedIn).toBe(1);
  });
});
