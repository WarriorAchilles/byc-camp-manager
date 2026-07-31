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
    await prisma.camperPhoto.findFirst({ take: 1 });
    campSchemaReady = true;
  } catch {
    campSchemaReady = false;
  }
}

const superUsername = "super-camp-mgmt-test@example.com";
const campAdminUsername = "camp-admin-camp-mgmt-test@example.com";
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

    await prisma.adminUser.deleteMany({ where: { username: { in: [superUsername, campAdminUsername] } } });
    const passwordHash = await hashPassword(password);
    await prisma.adminUser.createMany({
      data: [
        {
          username: superUsername,
          passwordHash,
          role: AdminRole.super_admin,
          isActive: true,
        },
        {
          username: campAdminUsername,
          passwordHash,
          role: AdminRole.camp_admin,
          isActive: true,
        },
      ],
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
    await prisma.adminUser.deleteMany({ where: { username: { in: [superUsername, campAdminUsername] } } });
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

  function workerPayload(): Record<string, unknown> {
    const suffix = Math.random().toString(36).slice(2, 8);
    return {
      email: `worker-${suffix}@example.com`,
      firstName: "Work",
      lastName: `Test${suffix}`,
      gender: Gender.female,
      cellPhone: "5559876543",
      streetAddress: "123 Main St",
      city: "Indianapolis",
      stateOrProvince: "IN",
      postalCode: "46201",
      country: "USA",
    };
  }

  it("allows admins to create a camper without guardian information", async () => {
    const admin = await prisma.adminUser.findUniqueOrThrow({ where: { username: superUsername } });
    const token = signAuthToken({ sub: admin.id, role: admin.role });
    const { guardianName: _guardianName, guardianEmail: _guardianEmail, guardianPhone: _guardianPhone, ...payload } =
      camperPayload();

    const created = await request(app)
      .post(`/api/admin/camp-years/${campYearId}/campers`)
      .set("Authorization", `Bearer ${token}`)
      .send(payload);

    expect(created.status).toBe(201);
    expect(created.body.guardianName).toBe("");
    expect(created.body.guardianEmail).toBe("");
    expect(created.body.guardianPhone).toBe("");
  });

  it("returns 409 when admin entry exceeds capacity until override is confirmed", async () => {
    const admin = await prisma.adminUser.findUniqueOrThrow({ where: { username: superUsername } });
    const token = signAuthToken({ sub: admin.id, role: admin.role });

    const first = await request(app)
      .post(`/api/admin/camp-years/${campYearId}/campers`)
      .set("Authorization", `Bearer ${token}`)
      .send(camperPayload({ feeDueCents: 16500 }));
    expect(first.status).toBe(201);
    expect(first.body.feeDueCents).toBe(16500);

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

    const admin = await prisma.adminUser.findUniqueOrThrow({ where: { username: superUsername } });
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

  it("allows only super admins to delete campers", async () => {
    const superAdmin = await prisma.adminUser.findUniqueOrThrow({ where: { username: superUsername } });
    const campAdmin = await prisma.adminUser.findUniqueOrThrow({ where: { username: campAdminUsername } });
    const superAdminToken = signAuthToken({ sub: superAdmin.id, role: superAdmin.role });
    const campAdminToken = signAuthToken({ sub: campAdmin.id, role: campAdmin.role });

    const created = await request(app)
      .post(`/api/admin/camp-years/${campYearId}/campers`)
      .set("Authorization", `Bearer ${superAdminToken}`)
      .send(camperPayload());
    expect(created.status).toBe(201);

    const forbidden = await request(app)
      .delete(`/api/admin/camp-years/${campYearId}/campers/${created.body.id}`)
      .set("Authorization", `Bearer ${campAdminToken}`);
    expect(forbidden.status).toBe(403);

    const deleted = await request(app)
      .delete(`/api/admin/camp-years/${campYearId}/campers/${created.body.id}`)
      .set("Authorization", `Bearer ${superAdminToken}`);
    expect(deleted.status).toBe(204);

    const camper = await prisma.camper.findUniqueOrThrow({ where: { id: created.body.id } });
    expect(camper.archivedAt).not.toBeNull();

    const listed = await request(app)
      .get(`/api/admin/camp-years/${campYearId}/campers`)
      .set("Authorization", `Bearer ${superAdminToken}`);
    expect(listed.body.campers).toHaveLength(0);
  });

  it("does not list legacy camper rows from registrations that are still awaiting payment", async () => {
    const superAdmin = await prisma.adminUser.findUniqueOrThrow({ where: { username: superUsername } });
    const token = signAuthToken({ sub: superAdmin.id, role: superAdmin.role });
    const registration = await prisma.familyRegistration.create({
      data: {
        campYearId,
        state: "pending_payment",
        guardianName: "Pending Guardian",
        guardianEmail: "pending@example.test",
        guardianPhone: "5551234567",
        expiresAt: new Date(Date.now() + 30 * 60_000),
        campers: {
          create: {
            campYearId,
            firstName: "Pending",
            lastName: "Camper",
            dateOfBirth: new Date("2012-05-01T12:00:00.000Z"),
            gender: Gender.male,
            guardianName: "Pending Guardian",
            guardianEmail: "pending@example.test",
            guardianPhone: "5551234567",
            paymentStatus: CamperPaymentStatus.unpaid,
            importSource: "online_registration",
          },
        },
      },
    });

    const listed = await request(app)
      .get(`/api/admin/camp-years/${campYearId}/campers`)
      .set("Authorization", `Bearer ${token}`);

    expect(listed.status).toBe(200);
    expect(listed.body.campers).toHaveLength(0);
    expect(await prisma.camper.count({ where: { familyRegistrationId: registration.id } })).toBe(1);
  });

  it("lets authenticated camp admins list and view private camper photos", async () => {
    const superAdmin = await prisma.adminUser.findUniqueOrThrow({ where: { username: superUsername } });
    const campAdmin = await prisma.adminUser.findUniqueOrThrow({ where: { username: campAdminUsername } });
    const created = await request(app)
      .post(`/api/admin/camp-years/${campYearId}/campers`)
      .set("Authorization", `Bearer ${signAuthToken({ sub: superAdmin.id, role: superAdmin.role })}`)
      .send(camperPayload());
    const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
    await prisma.camperPhoto.create({
      data: {
        camperId: created.body.id,
        contentType: "image/jpeg",
        data: Uint8Array.from(jpeg),
      },
    });
    const photoPath = `/api/admin/camp-years/${campYearId}/campers/${created.body.id}/photo`;

    expect((await request(app).get(photoPath)).status).toBe(401);
    const token = signAuthToken({ sub: campAdmin.id, role: campAdmin.role });
    const listed = await request(app)
      .get(`/api/admin/camp-years/${campYearId}/campers`)
      .set("Authorization", `Bearer ${token}`);
    expect(listed.body.campers[0]).toMatchObject({ id: created.body.id, hasPhoto: true });

    const photo = await request(app)
      .get(photoPath)
      .set("Authorization", `Bearer ${token}`)
      .buffer(true);
    expect(photo.status).toBe(200);
    expect(photo.headers["content-type"]).toContain("image/jpeg");
    expect(photo.headers["x-content-type-options"]).toBe("nosniff");
    expect(photo.body).toEqual(jpeg);
  });

  it("lets camp admins view the stored e-signature confirmation for a camper", async () => {
    const campAdmin = await prisma.adminUser.findUniqueOrThrow({ where: { username: campAdminUsername } });
    const registration = await prisma.familyRegistration.create({
      data: {
        campYearId,
        state: "confirmed",
        guardianName: "Jamie Guardian",
        guardianEmail: "jamie@example.test",
        guardianPhone: "5551234567",
        guardianRelationship: "Parent",
        agreementVersion: "medical-2099.1",
        agreementTextSnapshot: "Stored medical release text.\n\nCovered campers: Signed Camper, Sibling Camper",
        signatureMethod: "typed",
        signatureData: "Jamie Guardian",
        legalAcknowledged: true,
        signedAt: new Date("2099-01-15T20:30:00.000Z"),
        requestIp: "203.0.113.10",
        confirmedAt: new Date("2099-01-15T20:35:00.000Z"),
        campers: {
          create: [
            {
              campYearId,
              firstName: "Signed",
              lastName: "Camper",
              dateOfBirth: new Date("2012-05-01T12:00:00.000Z"),
              gender: Gender.male,
              guardianName: "Jamie Guardian",
              guardianEmail: "jamie@example.test",
              guardianPhone: "5551234567",
              paymentStatus: CamperPaymentStatus.paid_cash,
              medicalReleaseSigned: true,
              importSource: "online_registration",
            },
            {
              campYearId,
              firstName: "Sibling",
              lastName: "Camper",
              dateOfBirth: new Date("2014-06-02T12:00:00.000Z"),
              gender: Gender.female,
              guardianName: "Jamie Guardian",
              guardianEmail: "jamie@example.test",
              guardianPhone: "5551234567",
              paymentStatus: CamperPaymentStatus.paid_cash,
              medicalReleaseSigned: true,
              importSource: "online_registration",
            },
          ],
        },
      },
      include: { campers: { orderBy: { firstName: "asc" } } },
    });
    const camper = registration.campers.find((row) => row.firstName === "Signed");
    expect(camper).toBeDefined();
    const token = signAuthToken({ sub: campAdmin.id, role: campAdmin.role });
    const consentPath =
      `/api/admin/camp-years/${campYearId}/campers/${camper!.id}/consent`;

    expect((await request(app).get(consentPath)).status).toBe(401);

    const listed = await request(app)
      .get(`/api/admin/camp-years/${campYearId}/campers`)
      .set("Authorization", `Bearer ${token}`);
    const listedCamper = listed.body.campers.find((row: { id: string }) => row.id === camper!.id);
    expect(listedCamper).toMatchObject({ hasESignatureConfirmation: true });
    expect(listedCamper).not.toHaveProperty("signatureData");
    expect(listedCamper).not.toHaveProperty("familyRegistration");

    const response = await request(app)
      .get(consentPath)
      .set("Authorization", `Bearer ${token}`);

    expect(response.status).toBe(200);
    expect(response.body.camper).toMatchObject({
      id: camper!.id,
      firstName: "Signed",
      lastName: "Camper",
    });
    expect(response.body.campYear).toMatchObject({
      id: campYearId,
      name: "Integration Camp",
      yearLabel: "2099",
    });
    expect(response.body.consent).toMatchObject({
      registrationId: registration.id,
      signerName: "Jamie Guardian",
      signerRelationship: "Parent",
      signatureMethod: "typed",
      legalAcknowledged: true,
      requestIp: "203.0.113.10",
      agreementVersion: "medical-2099.1",
      agreementText: "Stored medical release text.\n\nCovered campers: Signed Camper, Sibling Camper",
    });
    expect(response.body.consent.coveredCampers).toHaveLength(2);
  });

  it("reports when a camper has no stored e-signature confirmation", async () => {
    const superAdmin = await prisma.adminUser.findUniqueOrThrow({ where: { username: superUsername } });
    const campAdmin = await prisma.adminUser.findUniqueOrThrow({ where: { username: campAdminUsername } });
    const created = await request(app)
      .post(`/api/admin/camp-years/${campYearId}/campers`)
      .set("Authorization", `Bearer ${signAuthToken({ sub: superAdmin.id, role: superAdmin.role })}`)
      .send(camperPayload());
    const token = signAuthToken({ sub: campAdmin.id, role: campAdmin.role });

    const listed = await request(app)
      .get(`/api/admin/camp-years/${campYearId}/campers`)
      .set("Authorization", `Bearer ${token}`);
    expect(listed.body.campers[0]).toMatchObject({
      id: created.body.id,
      hasESignatureConfirmation: false,
    });

    const response = await request(app)
      .get(`/api/admin/camp-years/${campYearId}/campers/${created.body.id}/consent`)
      .set("Authorization", `Bearer ${token}`);
    expect(response.status).toBe(404);
    expect(response.body.error).toBe(
      "No e-signature confirmation is available for this camper",
    );
  });

  it("allows only super admins to delete workers and dorm leaders", async () => {
    const superAdmin = await prisma.adminUser.findUniqueOrThrow({ where: { username: superUsername } });
    const campAdmin = await prisma.adminUser.findUniqueOrThrow({ where: { username: campAdminUsername } });
    const superAdminToken = signAuthToken({ sub: superAdmin.id, role: superAdmin.role });
    const campAdminToken = signAuthToken({ sub: campAdmin.id, role: campAdmin.role });

    const worker = await request(app)
      .post(`/api/admin/camp-years/${campYearId}/workers`)
      .set("Authorization", `Bearer ${superAdminToken}`)
      .send(workerPayload());
    expect(worker.status).toBe(201);

    const leader = await request(app)
      .post(`/api/admin/camp-years/${campYearId}/dorm-leaders`)
      .set("Authorization", `Bearer ${superAdminToken}`)
      .send({
        firstName: "Lead",
        lastName: "Test",
        gender: Gender.male,
        email: "leader-delete-test@example.com",
        phone: "5551112222",
        assignedCamperDormId: camperDormId,
      });
    expect(leader.status).toBe(201);

    for (const path of [`workers/${worker.body.id}`, `dorm-leaders/${leader.body.id}`]) {
      const forbidden = await request(app)
        .delete(`/api/admin/camp-years/${campYearId}/${path}`)
        .set("Authorization", `Bearer ${campAdminToken}`);
      expect(forbidden.status).toBe(403);

      const deleted = await request(app)
        .delete(`/api/admin/camp-years/${campYearId}/${path}`)
        .set("Authorization", `Bearer ${superAdminToken}`);
      expect(deleted.status).toBe(204);
    }

    const archivedWorker = await prisma.worker.findUniqueOrThrow({ where: { id: worker.body.id } });
    const archivedLeader = await prisma.dormLeader.findUniqueOrThrow({ where: { id: leader.body.id } });
    expect(archivedWorker.archivedAt).not.toBeNull();
    expect(archivedLeader.archivedAt).not.toBeNull();

    const [workers, leaders] = await Promise.all([
      request(app)
        .get(`/api/admin/camp-years/${campYearId}/workers`)
        .set("Authorization", `Bearer ${superAdminToken}`),
      request(app)
        .get(`/api/admin/camp-years/${campYearId}/dorm-leaders`)
        .set("Authorization", `Bearer ${superAdminToken}`),
    ]);
    expect(workers.body.workers).toHaveLength(0);
    expect(leaders.body.dormLeaders).toHaveLength(0);
  });

  it("allows only super admins to convert a worker to a dorm leader", async () => {
    const superAdmin = await prisma.adminUser.findUniqueOrThrow({ where: { username: superUsername } });
    const campAdmin = await prisma.adminUser.findUniqueOrThrow({ where: { username: campAdminUsername } });
    const superAdminToken = signAuthToken({ sub: superAdmin.id, role: superAdmin.role });
    const campAdminToken = signAuthToken({ sub: campAdmin.id, role: campAdmin.role });
    const created = await request(app)
      .post(`/api/admin/camp-years/${campYearId}/workers`)
      .set("Authorization", `Bearer ${superAdminToken}`)
      .send(workerPayload());

    const forbidden = await request(app)
      .post(`/api/admin/camp-years/${campYearId}/workers/${created.body.id}/convert-to-dorm-leader`)
      .set("Authorization", `Bearer ${campAdminToken}`);
    expect(forbidden.status).toBe(403);

    const converted = await request(app)
      .post(`/api/admin/camp-years/${campYearId}/workers/${created.body.id}/convert-to-dorm-leader`)
      .set("Authorization", `Bearer ${superAdminToken}`);
    expect(converted.status).toBe(201);
    expect(converted.body.email).toBe(created.body.email);
    expect(converted.body.phone).toBe(created.body.cellPhone);

    const worker = await prisma.worker.findUniqueOrThrow({ where: { id: created.body.id } });
    expect(worker.archivedAt).not.toBeNull();
    expect(await prisma.dormLeader.findUnique({ where: { id: converted.body.id } })).not.toBeNull();
  });

  it("converts a dorm leader to a worker with worker-specific information", async () => {
    const superAdmin = await prisma.adminUser.findUniqueOrThrow({ where: { username: superUsername } });
    const token = signAuthToken({ sub: superAdmin.id, role: superAdmin.role });
    const leader = await request(app)
      .post(`/api/admin/camp-years/${campYearId}/dorm-leaders`)
      .set("Authorization", `Bearer ${token}`)
      .send({
        firstName: "Lead",
        lastName: "Person",
        gender: Gender.female,
        email: "leader-convert@example.com",
        phone: "5552223333",
        assignedCamperDormId: camperDormId,
      });

    const converted = await request(app)
      .post(`/api/admin/camp-years/${campYearId}/dorm-leaders/${leader.body.id}/convert-to-worker`)
      .set("Authorization", `Bearer ${token}`)
      .send({
        ...workerPayload(),
        firstName: "Edited",
        lastName: "Worker",
        email: "edited-worker@example.com",
        dormId: camperDormId,
      });
    expect(converted.status).toBe(201);
    expect(converted.body.firstName).toBe("Edited");
    expect(converted.body.dormId).toBe(camperDormId);

    const archivedLeader = await prisma.dormLeader.findUniqueOrThrow({ where: { id: leader.body.id } });
    expect(archivedLeader.archivedAt).not.toBeNull();
    expect(archivedLeader.assignedCamperDormId).toBeNull();
  });

  it("allows camp admins to update the amount a camper has paid", async () => {
    const superAdmin = await prisma.adminUser.findUniqueOrThrow({ where: { username: superUsername } });
    const superAdminToken = signAuthToken({ sub: superAdmin.id, role: superAdmin.role });
    const campAdmin = await prisma.adminUser.findUniqueOrThrow({ where: { username: campAdminUsername } });
    const campAdminToken = signAuthToken({ sub: campAdmin.id, role: campAdmin.role });
    const created = await request(app)
      .post(`/api/admin/camp-years/${campYearId}/campers`)
      .set("Authorization", `Bearer ${superAdminToken}`)
      .send(camperPayload({ feeDueCents: 16500 }));
    expect(created.status).toBe(201);

    const updated = await request(app)
      .patch(`/api/admin/camp-years/${campYearId}/campers/${created.body.id}`)
      .set("Authorization", `Bearer ${campAdminToken}`)
      .send({ feePaidCents: 7500 });
    expect(updated.status).toBe(200);
    expect(updated.body.feePaidCents).toBe(7500);
    expect(updated.body.feeDueCents).toBe(16500);
  });

  it("allows camp admins to mark and unmark campers as paid", async () => {
    const superAdmin = await prisma.adminUser.findUniqueOrThrow({ where: { username: superUsername } });
    const superAdminToken = signAuthToken({ sub: superAdmin.id, role: superAdmin.role });
    const campAdmin = await prisma.adminUser.findUniqueOrThrow({ where: { username: campAdminUsername } });
    const campAdminToken = signAuthToken({ sub: campAdmin.id, role: campAdmin.role });
    const created = await request(app)
      .post(`/api/admin/camp-years/${campYearId}/campers`)
      .set("Authorization", `Bearer ${superAdminToken}`)
      .send(camperPayload({ feeDueCents: 16500, feePaidCents: 5000 }));
    expect(created.status).toBe(201);

    const markedPaid = await request(app)
      .patch(`/api/admin/camp-years/${campYearId}/campers/${created.body.id}`)
      .set("Authorization", `Bearer ${campAdminToken}`)
      .send({ paymentStatus: CamperPaymentStatus.paid_cash, feePaidCents: 5000 });
    expect(markedPaid.status).toBe(200);
    expect(markedPaid.body.paymentStatus).toBe(CamperPaymentStatus.paid_cash);
    expect(markedPaid.body.feePaidCents).toBe(16500);

    const markedUnpaid = await request(app)
      .patch(`/api/admin/camp-years/${campYearId}/campers/${created.body.id}`)
      .set("Authorization", `Bearer ${campAdminToken}`)
      .send({ paymentStatus: CamperPaymentStatus.unpaid });
    expect(markedUnpaid.status).toBe(200);
    expect(markedUnpaid.body.paymentStatus).toBe(CamperPaymentStatus.unpaid);
  });

  it("allows only super admins to delete age groups, dorms, and camp years", async () => {
    const campAdmin = await prisma.adminUser.findUniqueOrThrow({ where: { username: campAdminUsername } });
    const campAdminToken = signAuthToken({ sub: campAdmin.id, role: campAdmin.role });
    const bracket = await prisma.ageGroupBracket.findFirstOrThrow({ where: { campYearId } });

    const ageGroupDelete = await request(app)
      .delete(`/api/admin/camp-years/${campYearId}/age-group-brackets/${bracket.id}`)
      .set("Authorization", `Bearer ${campAdminToken}`);
    expect(ageGroupDelete.status).toBe(403);

    const dormDelete = await request(app)
      .delete(`/api/admin/camp-years/${campYearId}/dorms/${camperDormId}`)
      .set("Authorization", `Bearer ${campAdminToken}`);
    expect(dormDelete.status).toBe(403);

    const campYearDelete = await request(app)
      .delete(`/api/admin/camp-years/${campYearId}`)
      .set("Authorization", `Bearer ${campAdminToken}`)
      .send({ confirmationLabel: "Integration Camp (2099)" });
    expect(campYearDelete.status).toBe(403);
  });

  it("allows only super admins to disable check-in confirmation emails", async () => {
    const superAdmin = await prisma.adminUser.findUniqueOrThrow({ where: { username: superUsername } });
    const campAdmin = await prisma.adminUser.findUniqueOrThrow({ where: { username: campAdminUsername } });
    const superAdminToken = signAuthToken({ sub: superAdmin.id, role: superAdmin.role });
    const campAdminToken = signAuthToken({ sub: campAdmin.id, role: campAdmin.role });

    const forbidden = await request(app)
      .patch(`/api/admin/camp-years/${campYearId}`)
      .set("Authorization", `Bearer ${campAdminToken}`)
      .send({ checkInConfirmationEmailsEnabled: false });
    expect(forbidden.status).toBe(403);

    const updated = await request(app)
      .patch(`/api/admin/camp-years/${campYearId}`)
      .set("Authorization", `Bearer ${superAdminToken}`)
      .send({ checkInConfirmationEmailsEnabled: false });
    expect(updated.status).toBe(200);
    expect(updated.body.checkInConfirmationEmailsEnabled).toBe(false);
  });

  it("creates camp years with optional check-in features disabled by default", async () => {
    const superAdmin = await prisma.adminUser.findUniqueOrThrow({ where: { username: superUsername } });
    const superAdminToken = signAuthToken({ sub: superAdmin.id, role: superAdmin.role });

    const created = await request(app)
      .post("/api/admin/camp-years")
      .set("Authorization", `Bearer ${superAdminToken}`)
      .send({
        name: "Default Options Camp",
        yearLabel: "2100",
        startDate: "2100-07-01",
        endDate: "2100-07-07",
      });

    expect(created.status).toBe(201);
    expect(created.body).not.toHaveProperty("checkInCamperQrScanEnabled");
    expect(created.body.checkInFamilyPaymentOptionEnabled).toBe(false);
    expect(created.body.checkInConfirmationEmailsEnabled).toBe(false);
  });

  it("creates age groups without labels or a maximum age", async () => {
    const superAdmin = await prisma.adminUser.findUniqueOrThrow({ where: { username: superUsername } });
    const superAdminToken = signAuthToken({ sub: superAdmin.id, role: superAdmin.role });

    const created = await request(app)
      .post(`/api/admin/camp-years/${campYearId}/age-group-brackets`)
      .set("Authorization", `Bearer ${superAdminToken}`)
      .send({ minAge: 18, sortOrder: 2 });

    expect(created.status).toBe(201);
    expect(created.body).not.toHaveProperty("label");
    expect(created.body.minAge).toBe(18);
    expect(created.body.maxAge).toBeNull();

    const finite = await request(app)
      .patch(`/api/admin/camp-years/${campYearId}/age-group-brackets/${created.body.id}`)
      .set("Authorization", `Bearer ${superAdminToken}`)
      .send({ maxAge: 25 });
    expect(finite.status).toBe(200);
    expect(finite.body.maxAge).toBe(25);

    const openEnded = await request(app)
      .patch(`/api/admin/camp-years/${campYearId}/age-group-brackets/${created.body.id}`)
      .set("Authorization", `Bearer ${superAdminToken}`)
      .send({ maxAge: null });
    expect(openEnded.status).toBe(200);
    expect(openEnded.body.maxAge).toBeNull();
  });

  it("deletes age groups and dorms while preserving and unassigning related records", async () => {
    const superAdmin = await prisma.adminUser.findUniqueOrThrow({ where: { username: superUsername } });
    const superAdminToken = signAuthToken({ sub: superAdmin.id, role: superAdmin.role });
    const bracket = await prisma.ageGroupBracket.findFirstOrThrow({ where: { campYearId } });
    const createdCamper = await request(app)
      .post(`/api/admin/camp-years/${campYearId}/campers`)
      .set("Authorization", `Bearer ${superAdminToken}`)
      .send(camperPayload());
    expect(createdCamper.status).toBe(201);

    const ageGroupDelete = await request(app)
      .delete(`/api/admin/camp-years/${campYearId}/age-group-brackets/${bracket.id}`)
      .set("Authorization", `Bearer ${superAdminToken}`);
    expect(ageGroupDelete.status).toBe(204);
    const dormAfterAgeGroupDelete = await prisma.dorm.findUniqueOrThrow({
      where: { id: camperDormId },
    });
    expect(dormAfterAgeGroupDelete.ageGroupBracketId).toBeNull();

    const dormDelete = await request(app)
      .delete(`/api/admin/camp-years/${campYearId}/dorms/${camperDormId}`)
      .set("Authorization", `Bearer ${superAdminToken}`);
    expect(dormDelete.status).toBe(204);
    const camperAfterDormDelete = await prisma.camper.findUniqueOrThrow({
      where: { id: createdCamper.body.id },
    });
    expect(camperAfterDormDelete.dormId).toBeNull();
  });

  it("requires the exact confirmation label before deleting a camp year and its records", async () => {
    const superAdmin = await prisma.adminUser.findUniqueOrThrow({ where: { username: superUsername } });
    const superAdminToken = signAuthToken({ sub: superAdmin.id, role: superAdmin.role });
    const createdCamper = await request(app)
      .post(`/api/admin/camp-years/${campYearId}/campers`)
      .set("Authorization", `Bearer ${superAdminToken}`)
      .send(camperPayload());
    expect(createdCamper.status).toBe(201);

    const mismatchedConfirmation = await request(app)
      .delete(`/api/admin/camp-years/${campYearId}`)
      .set("Authorization", `Bearer ${superAdminToken}`)
      .send({ confirmationLabel: "2099" });
    expect(mismatchedConfirmation.status).toBe(400);
    expect(await prisma.campYear.findUnique({ where: { id: campYearId } })).not.toBeNull();

    const deleted = await request(app)
      .delete(`/api/admin/camp-years/${campYearId}`)
      .set("Authorization", `Bearer ${superAdminToken}`)
      .send({ confirmationLabel: "Integration Camp (2099)" });
    expect(deleted.status).toBe(204);
    expect(await prisma.campYear.findUnique({ where: { id: campYearId } })).toBeNull();
    expect(await prisma.camper.findUnique({ where: { id: createdCamper.body.id } })).toBeNull();
  });

  it("lets super admins manage the registration merchandise catalog while camp admins can read it", async () => {
    const [superAdmin, campAdmin] = await Promise.all([
      prisma.adminUser.findUniqueOrThrow({ where: { username: superUsername } }),
      prisma.adminUser.findUniqueOrThrow({ where: { username: campAdminUsername } }),
    ]);
    const superToken = signAuthToken({ sub: superAdmin.id, role: superAdmin.role });
    const campAdminToken = signAuthToken({ sub: campAdmin.id, role: campAdmin.role });
    const created = await request(app)
      .post(`/api/admin/camp-years/${campYearId}/merchandise`)
      .set("Authorization", `Bearer ${superToken}`)
      .send({
        name: "Camp Shirt",
        description: "Pre-order shirt",
        priceCents: 2000,
        availableOptions: ["Small", "Large"],
        ownership: "camper",
        isActive: true,
        sortOrder: 10,
      });
    expect(created.status).toBe(201);

    const listed = await request(app)
      .get(`/api/admin/camp-years/${campYearId}/merchandise`)
      .set("Authorization", `Bearer ${campAdminToken}`);
    expect(listed.status).toBe(200);
    expect(listed.body.merchandiseItems).toEqual([
      expect.objectContaining({ name: "Camp Shirt", priceCents: 2000, availableOptions: ["Small", "Large"] }),
    ]);

    const denied = await request(app)
      .patch(`/api/admin/camp-years/${campYearId}/merchandise/${created.body.id}`)
      .set("Authorization", `Bearer ${campAdminToken}`)
      .send({ isActive: false });
    expect(denied.status).toBe(403);

    const updated = await request(app)
      .patch(`/api/admin/camp-years/${campYearId}/merchandise/${created.body.id}`)
      .set("Authorization", `Bearer ${superToken}`)
      .send({ priceCents: 2250, isActive: false });
    expect(updated.status).toBe(200);
    expect(updated.body).toMatchObject({ priceCents: 2250, isActive: false });
  });
});
