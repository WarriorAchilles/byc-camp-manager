import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Express } from "express";
import request from "supertest";
import { AdminRole, CamperPaymentStatus, Gender } from "@prisma/client";
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
    await prisma.camper.findFirst({
      take: 1,
      select: { feeDueCents: true, feePaidCents: true },
    });
    campSchemaReady = true;
  } catch {
    campSchemaReady = false;
  }
}

const superUsername = "fee-csv-super@example.com";
const campAdminUsername = "fee-csv-camp@example.com";
const password = "test-password-12chars";

describe.skipIf(!integrationDbReady || !campSchemaReady)("Camper fee CSV import API (super admin)", () => {
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
      where: { username: { in: [superUsername, campAdminUsername] } },
    });

    const passwordHash = await hashPassword(password);
    await prisma.adminUser.createMany({
      data: [
        { username: superUsername, passwordHash, role: AdminRole.super_admin, isActive: true },
        { username: campAdminUsername, passwordHash, role: AdminRole.camp_admin, isActive: true },
      ],
    });

    const year = await prisma.campYear.create({
      data: {
        name: "Fee CSV Camp",
        yearLabel: "2099",
        startDate: new Date("2099-07-01T12:00:00.000Z"),
        endDate: new Date("2099-07-07T12:00:00.000Z"),
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
      where: { username: { in: [superUsername, campAdminUsername] } },
    });
    await prisma.$disconnect();
  });

  it("returns 403 for camp_admin on fee CSV preview", async () => {
    const admin = await prisma.adminUser.findUniqueOrThrow({ where: { username: campAdminUsername } });
    const token = signAuthToken({ sub: admin.id, role: admin.role });
    const csvText = "First Name,Last Name,Fees Due,Fees Paid\nAda,Lovelace,165,165\n";
    const response = await request(app)
      .post(`/api/admin/camp-years/${campYearId}/camper-fee-csv/preview`)
      .set("Authorization", `Bearer ${token}`)
      .send({ csvText });
    expect(response.status).toBe(403);
  });

  it("commits fee update for a uniquely matched unpaid camper", async () => {
    await prisma.camper.create({
      data: {
        campYearId,
        firstName: "Ada",
        lastName: "Lovelace",
        dateOfBirth: new Date("2012-06-01T12:00:00.000Z"),
        gender: Gender.female,
        guardianName: "Parent",
        guardianEmail: "p@example.com",
        guardianPhone: "5551234567",
        paymentStatus: CamperPaymentStatus.unpaid,
        importSource: "admin_entry",
        dormId: null,
      },
    });

    const admin = await prisma.adminUser.findUniqueOrThrow({ where: { username: superUsername } });
    const token = signAuthToken({ sub: admin.id, role: admin.role });
    const csvText = "First Name,Last Name,Fees Due,Fees Paid\nAda,Lovelace,$165.00,$165.00\n";

    const preview = await request(app)
      .post(`/api/admin/camp-years/${campYearId}/camper-fee-csv/preview`)
      .set("Authorization", `Bearer ${token}`)
      .send({ csvText });
    expect(preview.status).toBe(200);
    expect(preview.body.invalidRowCount).toBe(0);

    const commit = await request(app)
      .post(`/api/admin/camp-years/${campYearId}/camper-fee-csv/commit`)
      .set("Authorization", `Bearer ${token}`)
      .send({ csvText, columnMap: preview.body.columnMap });
    expect(commit.status).toBe(200);
    expect(commit.body.updated).toBe(1);

    const updated = await prisma.camper.findFirstOrThrow({
      where: { campYearId, firstName: "Ada", lastName: "Lovelace" },
    });
    expect(updated.feeDueCents).toBe(16500);
    expect(updated.feePaidCents).toBe(16500);
    expect(updated.paymentStatus).toBe(CamperPaymentStatus.paid_cash);
  });

  it("returns a row error when no camper matches the name", async () => {
    const admin = await prisma.adminUser.findUniqueOrThrow({ where: { username: superUsername } });
    const token = signAuthToken({ sub: admin.id, role: admin.role });
    const csvText = "First Name,Last Name,Fees Due,Fees Paid\nNobody,Here,10,10\n";

    const preview = await request(app)
      .post(`/api/admin/camp-years/${campYearId}/camper-fee-csv/preview`)
      .set("Authorization", `Bearer ${token}`)
      .send({ csvText });
    expect(preview.status).toBe(200);
    expect(preview.body.invalidRowCount).toBe(1);
    expect(preview.body.previewRows[0].errors.join(" ")).toContain("No camper matches");
  });

  it("returns a row error when multiple campers share the same name", async () => {
    const base = {
      campYearId,
      firstName: "Sam",
      lastName: "Same",
      dateOfBirth: new Date("2013-01-15T12:00:00.000Z"),
      gender: Gender.male,
      guardianName: "G",
      guardianEmail: "g1@example.com",
      guardianPhone: "5551234567",
      paymentStatus: CamperPaymentStatus.unpaid,
      importSource: "admin_entry" as const,
      dormId: null,
    };
    await prisma.camper.create({ data: { ...base, guardianEmail: "g1@example.com" } });
    await prisma.camper.create({ data: { ...base, guardianEmail: "g2@example.com" } });

    const admin = await prisma.adminUser.findUniqueOrThrow({ where: { username: superUsername } });
    const token = signAuthToken({ sub: admin.id, role: admin.role });
    const csvText = "First Name,Last Name,Fees Due,Fees Paid\nSam,Same,50,50\n";

    const preview = await request(app)
      .post(`/api/admin/camp-years/${campYearId}/camper-fee-csv/preview`)
      .set("Authorization", `Bearer ${token}`)
      .send({ csvText });
    expect(preview.status).toBe(200);
    expect(preview.body.invalidRowCount).toBe(1);
    expect(preview.body.previewRows[0].errors.join(" ")).toContain("Ambiguous match");
  });

  it("does not downgrade paid_stripe when the CSV shows an underpayment", async () => {
    const camper = await prisma.camper.create({
      data: {
        campYearId,
        firstName: "Stripe",
        lastName: "Paid",
        dateOfBirth: new Date("2011-03-03T12:00:00.000Z"),
        gender: Gender.male,
        guardianName: "G",
        guardianEmail: "stripe-parent@example.com",
        guardianPhone: "5559876543",
        paymentStatus: CamperPaymentStatus.paid_stripe,
        importSource: "online_registration",
        dormId: null,
      },
    });

    const admin = await prisma.adminUser.findUniqueOrThrow({ where: { username: superUsername } });
    const token = signAuthToken({ sub: admin.id, role: admin.role });
    const csvText = "First Name,Last Name,Fees Due,Fees Paid\nStripe,Paid,180.00,50.00\n";

    const commit = await request(app)
      .post(`/api/admin/camp-years/${campYearId}/camper-fee-csv/commit`)
      .set("Authorization", `Bearer ${token}`)
      .send({ csvText });

    expect(commit.status).toBe(200);

    const updated = await prisma.camper.findUniqueOrThrow({ where: { id: camper.id } });
    expect(updated.feeDueCents).toBe(18000);
    expect(updated.feePaidCents).toBe(5000);
    expect(updated.paymentStatus).toBe(CamperPaymentStatus.paid_stripe);
  });

  it("commits only valid fee rows when skipInvalidRows is true", async () => {
    await prisma.camper.create({
      data: {
        campYearId,
        firstName: "Morgan",
        lastName: "FeeSkip",
        dateOfBirth: new Date("2014-04-04T12:00:00.000Z"),
        gender: Gender.female,
        guardianName: "G",
        guardianEmail: "morgan-fee@example.com",
        guardianPhone: "5552223333",
        paymentStatus: CamperPaymentStatus.unpaid,
        importSource: "admin_entry",
        dormId: null,
      },
    });

    const admin = await prisma.adminUser.findUniqueOrThrow({ where: { username: superUsername } });
    const token = signAuthToken({ sub: admin.id, role: admin.role });
    const csvText =
      "First Name,Last Name,Fees Due,Fees Paid\nMorgan,FeeSkip,20.00,20.00\nNobody,Here,10,10\n";

    const preview = await request(app)
      .post(`/api/admin/camp-years/${campYearId}/camper-fee-csv/preview`)
      .set("Authorization", `Bearer ${token}`)
      .send({ csvText });
    expect(preview.status).toBe(200);
    expect(preview.body.validRowCount).toBe(1);
    expect(preview.body.invalidRowCount).toBe(1);

    const blocked = await request(app)
      .post(`/api/admin/camp-years/${campYearId}/camper-fee-csv/commit`)
      .set("Authorization", `Bearer ${token}`)
      .send({ csvText, columnMap: preview.body.columnMap });
    expect(blocked.status).toBe(400);
    expect(blocked.body.error).toBe("commit_blocked_row_errors");

    const allowed = await request(app)
      .post(`/api/admin/camp-years/${campYearId}/camper-fee-csv/commit`)
      .set("Authorization", `Bearer ${token}`)
      .send({ csvText, columnMap: preview.body.columnMap, skipInvalidRows: true });
    expect(allowed.status).toBe(200);
    expect(allowed.body.updated).toBe(1);
    expect(allowed.body.skippedInvalidRows).toBe(1);

    const updated = await prisma.camper.findFirstOrThrow({
      where: { campYearId, firstName: "Morgan", lastName: "FeeSkip" },
    });
    expect(updated.feeDueCents).toBe(2000);
    expect(updated.feePaidCents).toBe(2000);
  });
});
