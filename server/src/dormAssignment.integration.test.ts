import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Express } from "express";
import request from "supertest";
import {
  AdminRole,
  CamperPaymentStatus,
  DormGenderDesignation,
  DormPurpose,
  Gender,
  ImportSource,
} from "@prisma/client";
import { createApp } from "./app.js";
import { prisma } from "./db.js";
import { hashPassword } from "./lib/password.js";
import { signAuthToken } from "./lib/authToken.js";
import { allocateUniqueCamperQrToken } from "./lib/qrToken.js";

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

const superUsername = "super-dorm-assign-test@example.com";
const password = "test-password-12chars";

describe.skipIf(!integrationDbReady || !campSchemaReady)("dorm assignment API", () => {
  let app: Express;
  let campYearId: string;
  let camperDormId: string;
  let workerDormId: string;
  let camperId: string;
  let workerId: string;

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

    await prisma.adminUser.deleteMany({ where: { username: superUsername } });
    const passwordHash = await hashPassword(password);
    await prisma.adminUser.create({
      data: {
        username: superUsername,
        passwordHash,
        role: AdminRole.super_admin,
        isActive: true,
      },
    });

    const year = await prisma.campYear.create({
      data: {
        name: "Dorm Assign Camp",
        yearLabel: "2199",
        startDate: new Date("2199-07-01T12:00:00.000Z"),
        endDate: new Date("2199-07-07T12:00:00.000Z"),
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
        name: "Boys Teens",
        purpose: DormPurpose.camper,
        genderDesignation: DormGenderDesignation.boys,
        bedCapacity: 10,
        ageGroupBracketId: bracket.id,
      },
    });
    camperDormId = camperDorm.id;

    const workerDorm = await prisma.dorm.create({
      data: {
        campYearId,
        name: "Staff Coed",
        purpose: DormPurpose.worker,
        genderDesignation: DormGenderDesignation.co_ed,
        bedCapacity: 10,
      },
    });
    workerDormId = workerDorm.id;

    const qr = await allocateUniqueCamperQrToken(prisma);
    const camper = await prisma.camper.create({
      data: {
        campYearId,
        firstName: "Pat",
        lastName: "Camper",
        dateOfBirth: new Date("2184-06-01T00:00:00.000Z"),
        gender: Gender.male,
        guardianName: "G",
        guardianEmail: "g@example.com",
        guardianPhone: "5550000000",
        paymentStatus: CamperPaymentStatus.unpaid,
        qrToken: qr,
        importSource: "admin_entry",
        dormId: null,
      },
    });
    camperId = camper.id;

    const worker = await prisma.worker.create({
      data: {
        campYearId,
        email: `worker-${Math.random().toString(36).slice(2)}@example.com`,
        firstName: "Wanda",
        lastName: "Worker",
        gender: Gender.female,
        cellPhone: "5551111111",
        streetAddress: "1 Main",
        city: "City",
        stateOrProvince: "IN",
        postalCode: "46201",
        country: "USA",
        importSource: "admin_entry",
        dormId: null,
      },
    });
    workerId = worker.id;
  });

  afterAll(async () => {
    await prisma.camper.deleteMany({});
    await prisma.worker.deleteMany({});
    await prisma.dorm.deleteMany({});
    await prisma.ageGroupBracket.deleteMany({});
    await prisma.campYear.deleteMany({});
    await prisma.adminUser.deleteMany({ where: { username: superUsername } });
    await prisma.$disconnect();
  });

  async function authHeader(): Promise<string> {
    const admin = await prisma.adminUser.findUniqueOrThrow({ where: { username: superUsername } });
    const token = signAuthToken({ sub: admin.id, role: admin.role });
    return `Bearer ${token}`;
  }

  it("assigns a worker to a camper dorm and includes them on the board", async () => {
    const auth = await authHeader();
    const response = await request(app)
      .post(`/api/admin/camp-years/${campYearId}/dorm-assignments/assign`)
      .set("Authorization", auth)
      .send({ personKind: "worker", personId: workerId, dormId: camperDormId });
    expect(response.status).toBe(200);

    const board = await request(app)
      .get(`/api/admin/camp-years/${campYearId}/dorm-assignments/board`)
      .set("Authorization", auth);
    const camperDorm = board.body.camperDorms.find((dorm: { id: string }) => dorm.id === camperDormId);
    expect(camperDorm.workers).toHaveLength(1);
    expect(camperDorm.occupantCount).toBe(1);
  });

  it("rejects assigning a camper to a worker dorm", async () => {
    const auth = await authHeader();
    const response = await request(app)
      .post(`/api/admin/camp-years/${campYearId}/dorm-assignments/assign`)
      .set("Authorization", auth)
      .send({ personKind: "camper", personId: camperId, dormId: workerDormId });
    expect(response.status).toBe(400);
    expect(response.body.error).toContain("Campers can only");
  });

  it("auto-assigns camper and worker into compatible dorms", async () => {
    const auth = await authHeader();
    const response = await request(app)
      .post(`/api/admin/camp-years/${campYearId}/dorm-assignments/auto-assign`)
      .set("Authorization", auth)
      .send({});
    expect(response.status).toBe(200);
    expect(response.body.assignedCampers).toBe(1);
    expect(response.body.assignedWorkers).toBe(1);

    const camper = await prisma.camper.findUniqueOrThrow({ where: { id: camperId } });
    const worker = await prisma.worker.findUniqueOrThrow({ where: { id: workerId } });
    expect(camper.dormId).toBe(camperDormId);
    expect(worker.dormId).toBe(workerDormId);
  });

  it("returns roster with capacity for a camper dorm", async () => {
    await prisma.camper.update({
      where: { id: camperId },
      data: { dormId: camperDormId },
    });
    const auth = await authHeader();
    const response = await request(app)
      .get(`/api/admin/camp-years/${campYearId}/dorms/${camperDormId}/roster`)
      .set("Authorization", auth);
    expect(response.status).toBe(200);
    expect(response.body.occupantCount).toBe(1);
    expect(response.body.campers).toHaveLength(1);
    expect(response.body.dorm.bedCapacity).toBe(10);
  });

  it("includes assigned workers in a camper dorm roster and capacity", async () => {
    await prisma.worker.update({ where: { id: workerId }, data: { dormId: camperDormId } });
    const auth = await authHeader();
    const response = await request(app)
      .get(`/api/admin/camp-years/${campYearId}/dorms/${camperDormId}/roster`)
      .set("Authorization", auth);
    expect(response.status).toBe(200);
    expect(response.body.occupantCount).toBe(1);
    expect(response.body.workers).toHaveLength(1);
  });

  it("rejects camper assignment when dorm is at bed capacity", async () => {
    await prisma.dorm.update({
      where: { id: camperDormId },
      data: { bedCapacity: 1 },
    });
    const qr2 = await allocateUniqueCamperQrToken(prisma);
    const secondCamper = await prisma.camper.create({
      data: {
        campYearId,
        firstName: "Sam",
        lastName: "Second",
        dateOfBirth: new Date("2184-06-01T00:00:00.000Z"),
        gender: Gender.male,
        guardianName: "G2",
        guardianEmail: "g2@example.com",
        guardianPhone: "5550000001",
        paymentStatus: CamperPaymentStatus.unpaid,
        qrToken: qr2,
        importSource: "admin_entry",
        dormId: camperDormId,
      },
    });

    const auth = await authHeader();
    const response = await request(app)
      .post(`/api/admin/camp-years/${campYearId}/dorm-assignments/assign`)
      .set("Authorization", auth)
      .send({ personKind: "camper", personId: camperId, dormId: camperDormId });
    expect(response.status).toBe(400);
    expect(response.body.error).toContain("capacity");

    await prisma.camper.delete({ where: { id: secondCamper.id } });
  });

  it("returns warnings for permitted camper gender exception", async () => {
    await prisma.camper.update({
      where: { id: camperId },
      data: { dormId: null, gender: Gender.female },
    });
    const auth = await authHeader();
    const response = await request(app)
      .post(`/api/admin/camp-years/${campYearId}/dorm-assignments/assign`)
      .set("Authorization", auth)
      .send({ personKind: "camper", personId: camperId, dormId: camperDormId });
    expect(response.status).toBe(200);
    expect(response.body.warnings.length).toBeGreaterThan(0);

    const updated = await prisma.camper.findUniqueOrThrow({ where: { id: camperId } });
    expect(updated.dormId).toBe(camperDormId);
  });

  it("assigns a dorm leader to a camper dorm via the assignment board API", async () => {
    const leader = await prisma.dormLeader.create({
      data: {
        campYearId,
        firstName: "Lee",
        lastName: "Leader",
        gender: Gender.female,
        email: `dl-${Math.random().toString(36).slice(2)}@example.com`,
        phone: "5553334444",
        importSource: ImportSource.admin_entry,
        assignedCamperDormId: null,
      },
    });
    const auth = await authHeader();
    const response = await request(app)
      .post(`/api/admin/camp-years/${campYearId}/dorm-assignments/assign`)
      .set("Authorization", auth)
      .send({ personKind: "dorm_leader", personId: leader.id, dormId: camperDormId });
    expect(response.status).toBe(200);

    const updated = await prisma.dormLeader.findUniqueOrThrow({ where: { id: leader.id } });
    expect(updated.assignedCamperDormId).toBe(camperDormId);
  });

  it("rejects assigning a dorm leader to a worker dorm", async () => {
    const leader = await prisma.dormLeader.create({
      data: {
        campYearId,
        firstName: "Pat",
        lastName: "Lead",
        gender: Gender.male,
        email: `dl2-${Math.random().toString(36).slice(2)}@example.com`,
        phone: "5553335555",
        importSource: ImportSource.admin_entry,
        assignedCamperDormId: null,
      },
    });
    const auth = await authHeader();
    const response = await request(app)
      .post(`/api/admin/camp-years/${campYearId}/dorm-assignments/assign`)
      .set("Authorization", auth)
      .send({ personKind: "dorm_leader", personId: leader.id, dormId: workerDormId });
    expect(response.status).toBe(400);
    expect(response.body.error).toContain("Dorm leaders");
  });
});
