import { resolve } from "node:path";
import type { Express } from "express";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "./app.js";
import { prisma } from "./db.js";
import { SETTINGS_ROW_ID } from "./lib/activeCampYearSetting.js";
import { validFamilySubmission } from "./familyRegistrationTestData.js";
import { ADULT_MEDICAL_AGREEMENT_VERSION } from "./lib/familyRegistration.js";
import { persistFamilySubmission } from "./routes/publicRegistration.js";
import { confirmFamilyRegistrationCash } from "./lib/stripeCheckout.js";

async function schemaIsReady(): Promise<boolean> {
  try {
    await prisma.familyRegistration.findFirst({ select: { pendingCamperCount: true } });
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

  it("serves family form options without treating the route as a registration id", async () => {
    await selectActiveYear();
    const response = await request(app).get("/api/public/registration/family/form-options");

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      genders: ["male", "female"],
      medicalAgreement: { signatureMethod: "typed" },
      adultMedicalAgreement: { signatureMethod: "typed" },
    });
    expect(response.body.stateOrProvinceOptions).toContain("IN");
    expect(response.body.tShirtSizes).toContain("Adult M");
    expect(response.body.merchandiseItems).toEqual([]);
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

  it("keeps campers as a pending draft until pay-at-camp confirmation materializes them atomically", async () => {
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

    const pending = await prisma.familyRegistration.findUniqueOrThrow({
      where: { id: response.body.registrationId },
      include: { campers: true },
    });
    expect(pending.campers).toHaveLength(0);
    expect(pending.pendingCamperCount).toBe(2);
    expect(pending.pendingSubmissionSnapshot).not.toBeNull();
    expect(pending.signatureMethod).toBe("typed");
    expect(pending.signatureData).toBe("Jamie Guardian");
    expect(pending.signedAt).not.toBeNull();
    expect(pending.requestIp).toBeTruthy();
    expect(pending.agreementTextSnapshot).toContain("Taylor Camper, Jordan Camper");
    expect(pending.pricingSnapshot).not.toBeNull();

    expect((await confirmFamilyRegistrationCash({
      familyRegistrationId: response.body.registrationId,
    })).ok).toBe(true);
    const confirmed = await prisma.familyRegistration.findUniqueOrThrow({
      where: { id: response.body.registrationId },
      include: { campers: { orderBy: { createdAt: "asc" } } },
    });
    expect(confirmed.campers).toHaveLength(2);
    expect(confirmed.campers[0]?.streetAddress).toBe("100 Camp Road");
    expect(confirmed.campers[1]?.streetAddress).toBe("200 Other Road");
    expect(confirmed.pendingCamperCount).toBe(0);
    expect(confirmed.pendingSubmissionSnapshot).toBeNull();
    expect("qrToken" in confirmed.campers[0]!).toBe(false);
  });

  it("persists a third-camper discount without violating receipt amount constraints", async () => {
    await selectActiveYear();
    await prisma.campYear.update({
      where: { id: campYearId },
      data: {
        camperCapacity: 10,
        earlyCamperFeeCents: 10000,
        thirdPlusCamperFeeCents: 8000,
      },
    });
    const input = validFamilySubmission();
    input.campers.push(
      { ...input.campers[0]!, firstName: "Jordan" },
      { ...input.campers[0]!, firstName: "Sarah" },
    );

    const response = await request(app).post("/api/public/registration/family").send(input);

    expect(response.status).toBe(201);
    expect(response.body.receipt).toMatchObject({
      registrationSubtotalCents: 30000,
      discountCents: 2000,
      totalDueCents: 28000,
    });
    expect(response.body.receipt.lineItems).toEqual(expect.arrayContaining([
      expect.objectContaining({
        lineType: "registration",
        description: "Registration - Sarah Camper",
        unitPriceCents: 8000,
        originalUnitPriceCents: 10000,
        discountCents: 2000,
        lineTotalCents: 8000,
      }),
    ]));
  });

  it("persists an adult self-registration without requiring separate guardian details", async () => {
    await selectActiveYear();
    await prisma.campYear.update({ where: { id: campYearId }, data: { camperCapacity: 10 } });
    const input = validFamilySubmission();
    input.registrationType = "self";
    input.guardian = {
      ...input.guardian,
      fullName: "Taylor Camper",
      relationship: "Self",
    };
    input.campers[0] = {
      ...input.campers[0]!,
      dateOfBirth: "1999-05-04",
      guardianName: "Taylor Camper",
      guardianPhone: input.guardian.phone,
    };
    input.legal = {
      typedName: "Taylor Camper",
      acknowledged: true,
      agreementVersion: ADULT_MEDICAL_AGREEMENT_VERSION,
    };

    const response = await request(app).post("/api/public/registration/family").send(input);
    expect(response.status).toBe(201);

    const pending = await prisma.familyRegistration.findUniqueOrThrow({
      where: { id: response.body.registrationId },
      include: { campers: true },
    });
    expect(pending.campers).toHaveLength(0);
    expect((await confirmFamilyRegistrationCash({
      familyRegistrationId: response.body.registrationId,
    })).ok).toBe(true);
    const stored = await prisma.familyRegistration.findUniqueOrThrow({
      where: { id: response.body.registrationId },
      include: { campers: true },
    });
    expect(stored.guardianRelationship).toBe("Self");
    expect(stored.guardianName).toBe("Taylor Camper");
    expect(stored.campers[0]?.guardianName).toBe("Taylor Camper");
    expect(stored.agreementVersion).toBe(ADULT_MEDICAL_AGREEMENT_VERSION);
    expect(stored.agreementTextSnapshot).toContain("adult camper named in this registration");
    expect(stored.agreementTextSnapshot).not.toContain("parent or legal guardian");
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

  it("persists trusted merchandise totals and immutable receipt snapshots", async () => {
    await selectActiveYear();
    await prisma.campYear.update({
      where: { id: campYearId },
      data: { camperCapacity: 10, earlyCamperFeeCents: 16500, thirdPlusCamperFeeCents: 9000 },
    });
    const shirt = await prisma.merchandiseItem.create({
      data: {
        campYearId,
        name: "Original Shirt",
        priceCents: 2000,
        availableOptions: ["Small", "Large"],
        ownership: "camper",
      },
    });
    const input = validFamilySubmission();
    input.merchandiseSelections = [{
      merchandiseItemId: shirt.id,
      selectedOption: "Large",
      quantity: 2,
      camperIndex: 0,
    }];
    const spoofed = await request(app)
      .post("/api/public/registration/family")
      .send({ ...input, totalDueCents: 1, merchandiseSubtotalCents: 1 });
    expect(spoofed.status).toBe(400);
    expect(spoofed.body).toMatchObject({ error: "validation_failed" });
    const response = await request(app).post("/api/public/registration/family").send(input);
    expect(response.status).toBe(201);
    expect(response.body.receipt).toMatchObject({
      registrationSubtotalCents: 16500,
      merchandiseSubtotalCents: 4000,
      discountCents: 0,
      totalDueCents: 20500,
    });
    await prisma.merchandiseItem.update({
      where: { id: shirt.id },
      data: { name: "Renamed Shirt", priceCents: 9999, availableOptions: ["Other"] },
    });
    const stored = await prisma.familyRegistration.findUniqueOrThrow({
      where: { id: response.body.registrationId },
      include: { merchandiseOrderLines: true, receiptLineItems: true },
    });
    expect(stored.totalDueCents).toBe(20500);
    expect(stored.merchandiseOrderLines[0]).toMatchObject({
      itemNameSnapshot: "Original Shirt",
      selectedOptionsSnapshot: { option: "Large" },
      camperId: null,
      pendingCamperIndex: 0,
      quantity: 2,
      unitPriceCents: 2000,
      lineTotalCents: 4000,
    });
    expect(stored.receiptLineItems).toEqual(expect.arrayContaining([
      expect.objectContaining({ description: "Original Shirt - Large - Taylor Camper", lineTotalCents: 4000 }),
    ]));
    expect((await confirmFamilyRegistrationCash({
      familyRegistrationId: response.body.registrationId,
    })).ok).toBe(true);
    const confirmedLine = await prisma.merchandiseOrderLine.findFirstOrThrow({
      where: { familyRegistrationId: response.body.registrationId },
    });
    expect(confirmedLine.camperId).not.toBeNull();
    expect(confirmedLine.pendingCamperIndex).toBeNull();
  });

  it("rolls back the whole pending family draft when later work fails", async () => {
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
    expect(await prisma.camper.count({ where: { campYearId } })).toBe(0);
    const pending = await prisma.familyRegistration.findFirstOrThrow({
      where: { campYearId, state: "pending_payment" },
    });
    expect(pending.pendingCamperCount).toBe(1);
    expect((await confirmFamilyRegistrationCash({ familyRegistrationId: pending.id })).ok).toBe(true);
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
