import { resolve } from "node:path";
import type { Express } from "express";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "./app.js";
import { prisma } from "./db.js";
import { SETTINGS_ROW_ID } from "./lib/activeCampYearSetting.js";
import { validFamilySubmission } from "./familyRegistrationTestData.js";
import { persistFamilySubmission } from "./routes/publicRegistration.js";

async function schemaIsReady(): Promise<boolean> {
  try {
    await prisma.familyRegistration.findFirst({ select: { submissionKey: true } });
    return true;
  } catch {
    return false;
  }
}

const integrationReady = await schemaIsReady();

describe.skipIf(!integrationReady)("public registration availability API", () => {
  let app: Express;
  let campYearId: string;

  beforeAll(() => { app = createApp(); });

  beforeEach(async () => {
    await prisma.appSettings.deleteMany({});
    await prisma.camper.deleteMany({});
    await prisma.campYear.deleteMany({});
    const year = await prisma.campYear.create({
      data: {
        name: "Public Test Camp",
        yearLabel: "2099",
        startDate: new Date("2099-07-01T12:00:00Z"),
        endDate: new Date("2099-07-07T12:00:00Z"),
        camperCapacity: 1,
        familyRegistrationEnabled: true,
        familyRegistrationOpensAt: new Date(Date.now() - 60_000),
        familyRegistrationClosesAt: new Date(Date.now() + 3_600_000),
        familyRegistrationHeaderContent: "Family public copy",
        familyRegistrationClosedMessage: "Families are closed.",
        workerRegistrationEnabled: false,
        workerRegistrationOpensAt: new Date(Date.now() + 3_600_000),
        workerRegistrationHeaderContent: "Worker public copy",
        workerRegistrationClosedMessage: "Workers are closed.",
      },
    });
    campYearId = year.id;
  });

  afterAll(async () => {
    await prisma.appSettings.deleteMany({});
    await prisma.camper.deleteMany({});
    await prisma.campYear.deleteMany({});
    await prisma.$disconnect();
  });

  async function selectActiveYear(): Promise<void> {
    await prisma.appSettings.create({ data: { id: SETTINGS_ROW_ID, activeCampYearId: campYearId } });
  }

  it("stays closed until the shared active camp year is selected", async () => {
    const response = await request(app).get("/api/public/registration/family");
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ state: "not_configured", camp: null });
  });

  it("returns only public-safe active-year fields and keeps flow gates separate", async () => {
    await selectActiveYear();
    const family = await request(app).get("/api/public/registration/family");
    const worker = await request(app).get("/api/public/registration/worker");
    expect(family.body).toMatchObject({
      flow: "family",
      state: "open",
      headerContent: "Family public copy",
      camp: { id: campYearId, yearLabel: "2099" },
    });
    expect(worker.body).toMatchObject({ flow: "worker", state: "scheduled" });
    expect(JSON.stringify(family.body)).not.toContain("camperCapacity");
    expect(family.headers["cache-control"]).toBe("no-store");
  });

  it("uses server time for future and elapsed windows", async () => {
    await selectActiveYear();
    await prisma.campYear.update({
      where: { id: campYearId },
      data: {
        familyRegistrationEnabled: false,
        familyRegistrationOpensAt: new Date(Date.now() + 3_600_000),
        familyRegistrationClosesAt: new Date(Date.now() + 7_200_000),
      },
    });
    expect((await request(app).get("/api/public/registration/family")).body.state).toBe("scheduled");

    await prisma.campYear.update({
      where: { id: campYearId },
      data: { familyRegistrationEnabled: true },
    });
    expect((await request(app).get("/api/public/registration/family")).body.state).toBe("open");

    await prisma.campYear.update({
      where: { id: campYearId },
      data: {
        familyRegistrationEnabled: false,
        familyRegistrationOpensAt: new Date(Date.now() - 7_200_000),
        familyRegistrationClosesAt: new Date(Date.now() - 3_600_000),
      },
    });
    expect((await request(app).get("/api/public/registration/family")).body.state).toBe("closed");
  });

  it("blocks family capacity while leaving worker availability open", async () => {
    await selectActiveYear();
    await prisma.campYear.update({ where: { id: campYearId }, data: { workerRegistrationEnabled: true } });
    await prisma.camper.create({
      data: {
        campYearId,
        firstName: "Full",
        lastName: "Capacity",
        dateOfBirth: new Date("2015-01-01T12:00:00Z"),
        gender: "female",
        guardianName: "Guardian",
        guardianEmail: "guardian@example.test",
        guardianPhone: "5555555555",
        paymentStatus: "unpaid",
        importSource: "admin_entry",
      },
    });
    expect((await request(app).get("/api/public/registration/family")).body.state).toBe("capacity_reached");
    expect((await request(app).get("/api/public/registration/worker")).body.state).toBe("open");
  });

  it("allows only configured browser origins and rejects oversized public bodies", async () => {
    const allowed = await request(app).get("/api/health").set("Origin", "http://register.example.test");
    const denied = await request(app).get("/api/health").set("Origin", "https://evil.example.test");
    expect(allowed.headers["access-control-allow-origin"]).toBe("http://register.example.test");
    expect(denied.headers["access-control-allow-origin"]).toBeUndefined();

    const oversized = await request(app)
      .post("/api/public/registration/family")
      .set("Content-Type", "application/json")
      .send({ value: "x".repeat(110_000) });
    expect(oversized.status).toBe(413);
    expect(oversized.body).toEqual({ error: "Request too large" });
  });

  it("persists one or more campers, address overrides, signature evidence, and snapshots atomically", async () => {
    await selectActiveYear();
    await prisma.campYear.update({ where: { id: campYearId }, data: { camperCapacity: 10 } });
    const input = validFamilySubmission();
    input.campers.push({
      ...input.campers[0]!,
      firstName: "Jordan",
      useFamilyAddress: false,
      address: {
        streetAddress: "200 Other Road",
        city: "Atlanta",
        stateOrProvince: "GA",
        postalCode: "30303",
        country: "United States",
      },
    });
    const response = await request(app)
      .post("/api/public/registration/family")
      .set("X-Forwarded-For", "192.0.2.20")
      .send(input);
    expect(response.status).toBe(201);

    const stored = await prisma.familyRegistration.findUniqueOrThrow({
      where: { id: response.body.registrationId },
      include: { campers: true },
    });
    expect(stored.campers).toHaveLength(2);
    expect(stored.campers[0]?.streetAddress).toBe("100 Camp Road");
    expect(stored.campers[1]?.streetAddress).toBe("200 Other Road");
    expect(stored.signatureMethod).toBe("typed");
    expect(stored.signatureData).toBe("Jamie Guardian");
    expect(stored.signedAt).not.toBeNull();
    expect(stored.requestIp).toBeTruthy();
    expect(stored.agreementTextSnapshot).toContain("Taylor Camper, Jordan Camper");
    expect(stored.pricingSnapshot).not.toBeNull();
    expect("qrToken" in stored.campers[0]!).toBe(false);
  });

  it("replays the same idempotency key without creating another family", async () => {
    await selectActiveYear();
    await prisma.campYear.update({ where: { id: campYearId }, data: { camperCapacity: 10 } });
    const input = validFamilySubmission();
    const first = await request(app).post("/api/public/registration/family").send(input);
    const retry = await request(app).post("/api/public/registration/family").send(input);
    expect(first.status).toBe(201);
    expect(retry.status).toBe(200);
    expect(retry.body.registrationId).toBe(first.body.registrationId);
    expect(retry.body.replayed).toBe(true);
    expect(await prisma.familyRegistration.count({ where: { submissionKey: input.submissionKey } })).toBe(1);
  });

  it("rolls back the whole family when work fails after nested camper creation", async () => {
    await selectActiveYear();
    await prisma.campYear.update({ where: { id: campYearId }, data: { camperCapacity: 10 } });
    const input = validFamilySubmission();
    await expect(persistFamilySubmission(input, "192.0.2.30", new Date(), {
      afterCreate: () => { throw new Error("forced later failure"); },
    })).rejects.toThrow("forced later failure");
    expect(await prisma.familyRegistration.count({ where: { submissionKey: input.submissionKey } })).toBe(0);
    expect(await prisma.camper.count({ where: { guardianEmail: input.guardian.email } })).toBe(0);
  });

  it("serializes concurrent submissions at capacity", async () => {
    await selectActiveYear();
    const first = validFamilySubmission();
    const second = validFamilySubmission();
    second.submissionKey = "785f7902-3bfb-47a2-9845-a9f6091c7153";
    second.guardian.email = "other@example.test";
    const responses = await Promise.all([
      request(app).post("/api/public/registration/family").send(first),
      request(app).post("/api/public/registration/family").send(second),
    ]);
    expect(responses.map((response) => response.status).sort()).toEqual([201, 409]);
    expect(await prisma.camper.count({ where: { campYearId } })).toBe(1);
  });
});

describe("deployed browser host isolation", () => {
  it("does not serve one browser surface on the other configured host", async () => {
    const previous = process.env.CLIENT_DIST_PATH;
    process.env.CLIENT_DIST_PATH = resolve(process.cwd(), "../client/dist");
    const app = createApp();
    const registrationAdmin = await request(app).get("/admin/login").set("Host", "register.example.test");
    const adminRegistration = await request(app).get("/register/family").set("Host", "admin.example.test");
    expect(registrationAdmin.status).toBe(404);
    expect(adminRegistration.status).toBe(404);
    if (previous === undefined) delete process.env.CLIENT_DIST_PATH;
    else process.env.CLIENT_DIST_PATH = previous;
  });
});
