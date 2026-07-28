import prismaClientPkg from "@prisma/client";
import type { Express } from "express";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "./app.js";
import { prisma } from "./db.js";
import { signAuthToken } from "./lib/authToken.js";
import { resolveChurchPair } from "./lib/churchIdentity.js";

const { AdminRole, CamperPaymentStatus, Gender, ImportSource, RegistrationState } = prismaClientPkg;

async function schemaIsReady(): Promise<boolean> {
  try {
    await prisma.churchPayment.findFirst({ select: { id: true } });
    return true;
  } catch {
    return false;
  }
}

const integrationReady = await schemaIsReady();
const TEST_USERNAME = "__phase3_test__church-admin";
const TEST_YEAR_NAME = "__phase3_test__church-payment-camp";
const TEST_CHURCH_PREFIX = "__phase3_test__";

describe.skipIf(!integrationReady)("church directory and offline payments", () => {
  let app: Express;
  let token: string;
  let adminId: string;
  let campYearId: string;
  let churchId: string;
  let familyRegistrationId: string;
  let camperOneId: string;
  let camperTwoId: string;

  async function cleanup(): Promise<void> {
    const years = await prisma.campYear.findMany({
      where: { name: TEST_YEAR_NAME },
      select: { id: true },
    });
    const yearIds = years.map((year) => year.id);
    const payments = await prisma.churchPayment.findMany({
      where: { campYearId: { in: yearIds } },
      select: { id: true },
    });
    await prisma.churchPaymentAllocation.deleteMany({
      where: { churchPaymentId: { in: payments.map((payment) => payment.id) } },
    });
    await prisma.churchPayment.deleteMany({ where: { campYearId: { in: yearIds } } });
    await prisma.churchAuditLog.deleteMany({
      where: { actor: { username: TEST_USERNAME } },
    });
    await prisma.camper.deleteMany({ where: { campYearId: { in: yearIds } } });
    await prisma.familyRegistration.deleteMany({ where: { campYearId: { in: yearIds } } });
    await prisma.workerRegistrationSubmission.deleteMany({ where: { campYearId: { in: yearIds } } });
    await prisma.worker.deleteMany({ where: { campYearId: { in: yearIds } } });
    await prisma.dormLeader.deleteMany({ where: { campYearId: { in: yearIds } } });
    await prisma.campYear.deleteMany({ where: { id: { in: yearIds } } });
    const testChurches = await prisma.church.findMany({
      where: { name: { startsWith: TEST_CHURCH_PREFIX } },
      select: { id: true },
    });
    const churchIds = testChurches.map((church) => church.id);
    await prisma.churchAlias.deleteMany({ where: { churchId: { in: churchIds } } });
    await prisma.church.updateMany({
      where: { id: { in: churchIds } },
      data: { mergedIntoChurchId: null },
    });
    await prisma.church.deleteMany({ where: { id: { in: churchIds } } });
    await prisma.adminUser.deleteMany({ where: { username: TEST_USERNAME } });
  }

  beforeAll(() => {
    app = createApp();
  });

  beforeEach(async () => {
    await cleanup();
    const admin = await prisma.adminUser.create({
      data: {
        username: TEST_USERNAME,
        passwordHash: "not-used",
        role: AdminRole.camp_admin,
      },
    });
    adminId = admin.id;
    token = signAuthToken({ sub: admin.id, role: admin.role });
    const year = await prisma.campYear.create({
      data: {
        name: TEST_YEAR_NAME,
        yearLabel: "2099",
        startDate: new Date("2099-07-01T12:00:00Z"),
        endDate: new Date("2099-07-07T12:00:00Z"),
      },
    });
    campYearId = year.id;
    const church = await resolveChurchPair(prisma, {
      churchName: `${TEST_CHURCH_PREFIX}First Baptist Church`,
      pastorName: "Pastor Jane Doe",
      createIfMissing: true,
    });
    churchId = church!.id;
    const family = await prisma.familyRegistration.create({
      data: {
        campYearId,
        state: RegistrationState.confirmed,
        guardianName: "Family Guardian",
        guardianEmail: "family@example.com",
        guardianPhone: "5551112222",
        paymentStatus: CamperPaymentStatus.unpaid,
        registrationSubtotalCents: 2000,
        merchandiseSubtotalCents: 500,
        totalDueCents: 2500,
        amountPaidCents: 0,
      },
    });
    familyRegistrationId = family.id;
    const base = {
      campYearId,
      familyRegistrationId: family.id,
      dateOfBirth: new Date("2085-01-01T12:00:00Z"),
      gender: Gender.female,
      guardianName: family.guardianName,
      guardianEmail: family.guardianEmail,
      guardianPhone: family.guardianPhone,
      churchName: `${TEST_CHURCH_PREFIX}FIRST BAPTIST CHURCH`,
      pastorName: "Rev. Jane Doe",
      churchId,
      feeDueCents: 1000,
      feePaidCents: 0,
      paymentStatus: CamperPaymentStatus.unpaid,
      importSource: ImportSource.online_registration,
    };
    const first = await prisma.camper.create({
      data: { ...base, firstName: "One", lastName: "Camper" },
    });
    const second = await prisma.camper.create({
      data: { ...base, firstName: "Two", lastName: "Camper" },
    });
    camperOneId = first.id;
    camperTwoId = second.id;
  });

  afterAll(async () => {
    await cleanup();
    await prisma.$disconnect();
  });

  it("suggests only public-safe canonical identities and resolves normalized pairs once", async () => {
    const suggestion = await request(app)
      .get("/api/public/registration/church-suggestions?q=phase3");
    expect(suggestion.status).toBe(200);
    expect(suggestion.body.churches).toEqual([
      expect.objectContaining({
        id: churchId,
        churchName: `${TEST_CHURCH_PREFIX}First Baptist Church`,
        pastorName: "Pastor Jane Doe",
      }),
    ]);
    expect(JSON.stringify(suggestion.body)).not.toContain("family@example.com");

    const resolved = await Promise.all(Array.from({ length: 4 }, () =>
      resolveChurchPair(prisma, {
        churchName: ` ${TEST_CHURCH_PREFIX}First—Baptist Church `,
        pastorName: "Reverend Jane Doe",
        createIfMissing: true,
      })));
    expect(new Set(resolved.map((church) => church?.id))).toEqual(new Set([churchId]));
    expect(await prisma.church.count({
      where: { name: { startsWith: TEST_CHURCH_PREFIX } },
    })).toBe(1);
  });

  it("lets camp admins edit churches, assign and unassign campers, and delete churches", async () => {
    const renamed = await request(app)
      .patch(`/api/admin/churches/${churchId}`)
      .set("Authorization", `Bearer ${token}`)
      .send({
        name: `${TEST_CHURCH_PREFIX}Renamed Baptist Church`,
        pastorName: "Pastor Janet Doe",
      });
    expect(renamed.status).toBe(200);
    expect(renamed.body).toMatchObject({
      name: `${TEST_CHURCH_PREFIX}Renamed Baptist Church`,
      pastorName: "Pastor Janet Doe",
    });
    expect(await prisma.churchAlias.findFirst({
      where: { churchId, name: `${TEST_CHURCH_PREFIX}First Baptist Church` },
    })).not.toBeNull();

    const temporaryChurch = await resolveChurchPair(prisma, {
      churchName: `${TEST_CHURCH_PREFIX}Temporary Church`,
      pastorName: "Pastor Temporary",
      createIfMissing: true,
    });
    const assigned = await request(app)
      .patch(`/api/admin/camp-years/${campYearId}/campers/${camperOneId}`)
      .set("Authorization", `Bearer ${token}`)
      .send({ canonicalChurchId: temporaryChurch!.id });
    expect(assigned.status).toBe(200);
    expect(assigned.body.churchId).toBe(temporaryChurch!.id);

    const unassigned = await request(app)
      .patch(`/api/admin/camp-years/${campYearId}/campers/${camperOneId}`)
      .set("Authorization", `Bearer ${token}`)
      .send({ canonicalChurchId: null });
    expect(unassigned.status).toBe(200);
    expect(unassigned.body.churchId).toBeNull();

    await prisma.camper.update({
      where: { id: camperOneId },
      data: { churchId: temporaryChurch!.id },
    });
    const deleted = await request(app)
      .delete(`/api/admin/churches/${temporaryChurch!.id}`)
      .set("Authorization", `Bearer ${token}`);
    expect(deleted.status).toBe(204);
    expect(await prisma.church.findUnique({ where: { id: temporaryChurch!.id } })).toBeNull();
    expect(await prisma.camper.findUniqueOrThrow({
      where: { id: camperOneId },
      select: { churchId: true, churchName: true, pastorName: true },
    })).toMatchObject({
      churchId: null,
      churchName: `${TEST_CHURCH_PREFIX}FIRST BAPTIST CHURCH`,
      pastorName: "Rev. Jane Doe",
    });
    expect(await prisma.churchAuditLog.count({
      where: { actorAdminUserId: adminId, action: "delete" },
    })).toBe(1);
  });

  it("records, replays, reports, and voids an allocated check without paying merchandise", async () => {
    const body = {
      campYearId,
      tender: "check",
      amountReceivedCents: 1500,
      receivedDate: "2099-06-20",
      referenceNumber: "CHK-100",
      notes: "Registration fees",
      idempotencyKey: "11111111-1111-4111-8111-111111111111",
      allocations: [
        { camperId: camperOneId, appliedAmountCents: 1000 },
        { camperId: camperTwoId, appliedAmountCents: 500 },
      ],
    };
    const first = await request(app)
      .post(`/api/admin/churches/${churchId}/payments`)
      .set("Authorization", `Bearer ${token}`)
      .send(body);
    expect(first.status).toBe(201);
    expect(first.body.replayed).toBe(false);
    const replay = await request(app)
      .post(`/api/admin/churches/${churchId}/payments`)
      .set("Authorization", `Bearer ${token}`)
      .send(body);
    expect(replay.status).toBe(200);
    expect(replay.body.replayed).toBe(true);
    expect(await prisma.churchPayment.count()).toBe(1);

    const [firstCamper, secondCamper, family] = await Promise.all([
      prisma.camper.findUniqueOrThrow({ where: { id: camperOneId } }),
      prisma.camper.findUniqueOrThrow({ where: { id: camperTwoId } }),
      prisma.familyRegistration.findUniqueOrThrow({ where: { id: familyRegistrationId } }),
    ]);
    expect(firstCamper).toMatchObject({
      feePaidCents: 1000,
      paymentStatus: CamperPaymentStatus.paid_church_check,
      checkInStatus: "not_checked_in",
    });
    expect(secondCamper).toMatchObject({
      feePaidCents: 500,
      paymentStatus: CamperPaymentStatus.unpaid,
    });
    expect(family.amountPaidCents).toBe(1500);
    expect(family.totalDueCents - family.amountPaidCents).toBe(1000);

    const report = await request(app)
      .get(`/api/admin/churches/financial-summary?campYearId=${campYearId}`)
      .set("Authorization", `Bearer ${token}`);
    expect(report.status).toBe(200);
    expect(report.body.totals).toMatchObject({
      checkCents: 1500,
      cashCents: 0,
      paymentCount: 1,
      allocatedCents: 1500,
      outstandingRegistrationFeeCents: 500,
    });
    expect(report.body.exportRows[0]).not.toHaveProperty("notes");

    const voided = await request(app)
      .post(`/api/admin/churches/payments/${first.body.payment.id}/void`)
      .set("Authorization", `Bearer ${token}`)
      .send({ reason: "Check returned" });
    expect(voided.status).toBe(200);
    const afterVoid = await prisma.familyRegistration.findUniqueOrThrow({
      where: { id: familyRegistrationId },
    });
    expect(afterVoid.amountPaidCents).toBe(0);
    expect((await prisma.camper.findUniqueOrThrow({ where: { id: camperOneId } })).feePaidCents).toBe(0);
    expect((await prisma.churchPayment.findUniqueOrThrow({
      where: { id: first.body.payment.id },
    })).voidReason).toBe("Check returned");

    const deleteWithHistory = await request(app)
      .delete(`/api/admin/churches/${churchId}`)
      .set("Authorization", `Bearer ${token}`);
    expect(deleteWithHistory.status).toBe(409);
    expect(deleteWithHistory.body.error).toContain("payment history");
  });

  it("blocks unallocated overpayments and audits transactional merges", async () => {
    const overpayment = await request(app)
      .post(`/api/admin/churches/${churchId}/payments`)
      .set("Authorization", `Bearer ${token}`)
      .send({
        campYearId,
        tender: "cash",
        amountReceivedCents: 1001,
        receivedDate: "2099-06-20",
        idempotencyKey: "22222222-2222-4222-8222-222222222222",
        allocations: [{ camperId: camperOneId, appliedAmountCents: 1000 }],
      });
    expect(overpayment.status).toBe(400);
    expect(await prisma.churchPayment.count()).toBe(0);

    const duplicate = await resolveChurchPair(prisma, {
      churchName: `${TEST_CHURCH_PREFIX}First Baptist`,
      pastorName: "Jane Doe",
      createIfMissing: true,
    });
    const preview = await request(app)
      .post("/api/admin/churches/merge/preview")
      .set("Authorization", `Bearer ${token}`)
      .send({ sourceChurchIds: [duplicate!.id], targetChurchId: churchId });
    expect(preview.status).toBe(200);
    const merge = await request(app)
      .post("/api/admin/churches/merge")
      .set("Authorization", `Bearer ${token}`)
      .send({ sourceChurchIds: [duplicate!.id], targetChurchId: churchId, confirm: true });
    expect(merge.status).toBe(200);
    expect((await prisma.church.findUniqueOrThrow({
      where: { id: duplicate!.id },
    })).mergedIntoChurchId).toBe(churchId);
    expect(await prisma.churchAuditLog.count({
      where: { actorAdminUserId: adminId, action: "merge" },
    })).toBe(1);
  });
});
