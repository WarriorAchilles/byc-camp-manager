import { randomUUID } from "node:crypto";
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
import { resetEnvCacheForTests } from "./config/env.js";
import { prisma } from "./db.js";
import { hashPassword } from "./lib/password.js";
import { signAuthToken } from "./lib/authToken.js";
import {
  completeCheckoutSessionIfPaid,
  createSelfCheckInCheckoutSession,
  type StripeRuntime,
} from "./lib/stripeCheckout.js";

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

  async function authHeaderForRole(role: AdminRole): Promise<string> {
    const admin = await prisma.adminUser.create({
      data: {
        email: `${role}-${randomUUID()}@example.com`,
        passwordHash: await hashPassword(password),
        role,
        isActive: true,
      },
    });
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
    await prisma.campYear.update({
      where: { id: campYearId },
      data: { checkInConfirmationEmailsEnabled: true },
    });
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
    expect(first.body.checkInCompletedThisRequest).toBe(true);
    expect(first.body.dormAutoAssigned).toBe(false);
    expect(first.body.checkInConfirmationEmail?.status).toBe("skipped_log");
    expect(first.body.camper.checkInStatus).toBe(CheckInStatus.checked_in);
    expect(first.body.camper.checkedInAt).toBeTruthy();

    const second = await request(app)
      .post(`/api/admin/camp-years/${campYearId}/check-in/campers/${camperId}/check-in`)
      .set("Authorization", header)
      .send({});
    expect(second.status).toBe(200);
    expect(second.body.alreadyCheckedIn).toBe(true);
    expect(second.body.checkInCompletedThisRequest).toBe(false);
    expect(second.body.checkInConfirmationEmail).toBeNull();

    expect(logSpy.mock.calls.some((c) => String(c[0]).includes("guard-checkin@example.com"))).toBe(true);
  });

  it("camper check-in skips confirmation email when disabled for the camp year", async () => {
    const logSpy = vi.spyOn(console, "info").mockImplementation(() => {});
    const header = await authHeader();
    await prisma.campYear.update({
      where: { id: campYearId },
      data: { checkInConfirmationEmailsEnabled: false },
    });
    const create = await request(app)
      .post(`/api/admin/camp-years/${campYearId}/campers`)
      .set("Authorization", header)
      .send({
        firstName: "No",
        lastName: "Confirmation",
        dateOfBirth: "2012-05-01",
        gender: Gender.male,
        guardianName: "Guard",
        guardianEmail: "disabled-checkin-email@example.com",
        guardianPhone: "555",
        paymentStatus: CamperPaymentStatus.unpaid,
        dormId: camperDormId,
      });

    const checkIn = await request(app)
      .post(`/api/admin/camp-years/${campYearId}/check-in/campers/${create.body.id}/check-in`)
      .set("Authorization", header)
      .send({});

    expect(checkIn.status).toBe(200);
    expect(checkIn.body.checkInCompletedThisRequest).toBe(true);
    expect(checkIn.body.checkInConfirmationEmail).toBeNull();
    expect(logSpy.mock.calls.some((call) => String(call[0]).includes("disabled-checkin-email@example.com"))).toBe(
      false,
    );
  });

  it("auto-assigns a camper dorm at check-in when unassigned and a matching dorm is available", async () => {
    const header = await authHeader();
    const create = await request(app)
      .post(`/api/admin/camp-years/${campYearId}/campers`)
      .set("Authorization", header)
      .send({
        firstName: "Auto",
        lastName: "Placed",
        dateOfBirth: "2085-06-15",
        gender: Gender.male,
        guardianName: "G",
        guardianEmail: "auto-placed@example.com",
        guardianPhone: "555",
        paymentStatus: CamperPaymentStatus.unpaid,
      });
    expect(create.status).toBe(201);
    const camperId = create.body.id as string;
    expect(create.body.dormId).toBeNull();

    const checkIn = await request(app)
      .post(`/api/admin/camp-years/${campYearId}/check-in/campers/${camperId}/check-in`)
      .set("Authorization", header)
      .send({});
    expect(checkIn.status).toBe(200);
    expect(checkIn.body.checkInCompletedThisRequest).toBe(true);
    expect(checkIn.body.dormAutoAssigned).toBe(true);
    expect(checkIn.body.camper.dormAssignment).toBe("Camper Hall A");

    const row = await prisma.camper.findUniqueOrThrow({ where: { id: camperId } });
    expect(row.dormId).toBe(camperDormId);
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

  describe("public kiosk self check-in", () => {
    it("public meta rejects bad token shape", async () => {
      const res = await request(app).get("/api/public/self-check-in/not-hex/meta");
      expect(res.status).toBe(400);
      expect(res.body.error).toBe("invalid_token");
    });

    it("public meta returns 404 when token is not mapped to any camp year", async () => {
      const orphan = `${"fa".repeat(16)}`;
      const res = await request(app).get(`/api/public/self-check-in/${orphan}/meta`);
      expect(res.status).toBe(404);
    });

    it("admin issues token then public meta, search, check-in succeed; search exposes no guardian or qr fields", async () => {
      const header = await authHeader();
      const issue = await request(app)
        .post(`/api/admin/camp-years/${campYearId}/self-check-in/token`)
        .set("Authorization", header)
        .send({});
      expect(issue.status).toBe(200);
      const kioskToken = issue.body.token as string;
      expect(kioskToken).toMatch(/^[a-f0-9]{32}$/);

      const meta = await request(app).get(`/api/public/self-check-in/${kioskToken}/meta`);
      expect(meta.status).toBe(200);
      expect(meta.body.campYear.name).toBe("Check-In Camp");

      const create = await request(app)
        .post(`/api/admin/camp-years/${campYearId}/campers`)
        .set("Authorization", header)
        .send({
          firstName: "PublicKi",
          lastName: "OskTester",
          middleName: "Mid",
          dateOfBirth: "2085-06-15",
          gender: Gender.male,
          guardianName: "G",
          guardianEmail: "kiosk-public@example.com",
          guardianPhone: "555",
          paymentStatus: CamperPaymentStatus.unpaid,
        });
      expect(create.status).toBe(201);
      const camperId = create.body.id as string;

      const search = await request(app)
        .get(`/api/public/self-check-in/${kioskToken}/search`)
        .query({ q: "PublicKi Osk" });
      expect(search.status).toBe(200);
      expect(search.body.campers.length).toBe(1);
      const row = search.body.campers[0];
      expect(row).toMatchObject({
        id: camperId,
        firstName: "PublicKi",
        lastName: "OskTester",
        middleInitial: "M",
        checkInStatus: CheckInStatus.not_checked_in,
      });
      expect(row).not.toHaveProperty("guardianEmail");
      expect(row).not.toHaveProperty("qrToken");
      expect(row).not.toHaveProperty("paymentStatus");

      const options = await request(app)
        .get(`/api/public/self-check-in/${kioskToken}/campers/${camperId}/payment-options`);
      expect(options.status).toBe(200);
      expect(options.body.camper).toMatchObject({
        id: camperId,
        paymentStatus: CamperPaymentStatus.unpaid,
        remainingBalanceCents: 0,
        onlinePaymentAvailable: false,
      });

      const blocked = await request(app)
        .post(`/api/public/self-check-in/${kioskToken}/campers/${camperId}/check-in`)
        .send({});
      expect(blocked.status).toBe(409);
      expect(blocked.body.error).toBe("payment_required");

      const logSpy = vi.spyOn(console, "info").mockImplementation(() => {});
      const chk = await request(app)
        .post(`/api/public/self-check-in/${kioskToken}/campers/${camperId}/check-in`)
        .send({ manualPaymentAccepted: true });
      expect(chk.status).toBe(200);
      expect(chk.body.checkInCompletedThisRequest).toBe(true);
      expect(chk.body.dormAutoAssigned).toBe(true);
      expect(chk.body.camper.dormAssignment).toBe("Camper Hall A");
      expect(chk.body).not.toHaveProperty("checkInConfirmationEmail");
      expect(logSpy.mock.calls.some((call) => String(call[0]).includes("kiosk-public@example.com"))).toBe(false);

      const again = await request(app)
        .post(`/api/public/self-check-in/${kioskToken}/campers/${camperId}/check-in`)
        .send({ manualPaymentAccepted: true });
      expect(again.status).toBe(200);
      expect(again.body.alreadyCheckedIn).toBe(true);
      expect(again.body.checkInCompletedThisRequest).toBe(false);
      logSpy.mockRestore();
    });

    it("public check-in rejects unknown camper id", async () => {
      const header = await authHeader();
      await request(app)
        .post(`/api/admin/camp-years/${campYearId}/self-check-in/token`)
        .set("Authorization", header)
        .send({});
      const yearRow = await prisma.campYear.findUniqueOrThrow({ where: { id: campYearId } });
      const kioskToken = yearRow.selfCheckInToken!;
      const chk = await request(app)
        .post(`/api/public/self-check-in/${kioskToken}/campers/${randomUUID()}/check-in`)
        .send({});
      expect(chk.status).toBe(404);
    });

    it("public Stripe checkout returns service unavailable when Stripe is not configured", async () => {
      const originalStripeSecretKey = process.env.STRIPE_SECRET_KEY;
      const originalStripeWebhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
      const originalAppPublicUrl = process.env.APP_PUBLIC_URL;
      delete process.env.STRIPE_SECRET_KEY;
      delete process.env.STRIPE_WEBHOOK_SECRET;
      delete process.env.APP_PUBLIC_URL;
      resetEnvCacheForTests();

      try {
        const header = await authHeader();
        await request(app)
          .post(`/api/admin/camp-years/${campYearId}/self-check-in/token`)
          .set("Authorization", header)
          .send({});
        const yearRow = await prisma.campYear.findUniqueOrThrow({ where: { id: campYearId } });
        const kioskToken = yearRow.selfCheckInToken!;

        const create = await request(app)
          .post(`/api/admin/camp-years/${campYearId}/campers`)
          .set("Authorization", header)
          .send({
            firstName: "Stripe",
            lastName: "Ready",
            dateOfBirth: "2085-06-15",
            gender: Gender.male,
            guardianName: "G",
            guardianEmail: "stripe-ready@example.com",
            guardianPhone: "555",
            paymentStatus: CamperPaymentStatus.unpaid,
          });
        expect(create.status).toBe(201);
        const camperId = create.body.id as string;
        await prisma.camper.update({
          where: { id: camperId },
          data: { feeDueCents: 16500, feePaidCents: 5000 },
        });

        const options = await request(app)
          .get(`/api/public/self-check-in/${kioskToken}/campers/${camperId}/payment-options`);
        expect(options.status).toBe(200);
        expect(options.body.camper.onlinePaymentAvailable).toBe(true);
        expect(options.body.camper.remainingBalanceCents).toBe(11500);

        const checkout = await request(app)
          .post(`/api/public/self-check-in/${kioskToken}/campers/${camperId}/stripe-checkout`)
          .send({});
        expect(checkout.status).toBe(503);
        expect(checkout.body.error).toBe("stripe_not_configured");
      } finally {
        if (originalStripeSecretKey !== undefined) {
          process.env.STRIPE_SECRET_KEY = originalStripeSecretKey;
        }
        if (originalStripeWebhookSecret !== undefined) {
          process.env.STRIPE_WEBHOOK_SECRET = originalStripeWebhookSecret;
        }
        if (originalAppPublicUrl !== undefined) {
          process.env.APP_PUBLIC_URL = originalAppPublicUrl;
        }
        resetEnvCacheForTests();
      }
    });

    it("public Stripe checkout can include multiple selected campers", async () => {
      const logSpy = vi.spyOn(console, "info").mockImplementation(() => {});
      const header = await authHeader();
      await request(app)
        .post(`/api/admin/camp-years/${campYearId}/self-check-in/token`)
        .set("Authorization", header)
        .send({});
      const yearRow = await prisma.campYear.findUniqueOrThrow({ where: { id: campYearId } });
      const kioskToken = yearRow.selfCheckInToken!;

      const firstCreate = await request(app)
        .post(`/api/admin/camp-years/${campYearId}/campers`)
        .set("Authorization", header)
        .send({
          firstName: "Multi",
          lastName: "One",
          dateOfBirth: "2085-06-15",
          gender: Gender.male,
          guardianName: "G",
          guardianEmail: "multi-pay@example.com",
          guardianPhone: "555",
          paymentStatus: CamperPaymentStatus.unpaid,
        });
      const secondCreate = await request(app)
        .post(`/api/admin/camp-years/${campYearId}/campers`)
        .set("Authorization", header)
        .send({
          firstName: "Multi",
          lastName: "Two",
          dateOfBirth: "2085-06-15",
          gender: Gender.male,
          guardianName: "G",
          guardianEmail: "multi-pay@example.com",
          guardianPhone: "555",
          paymentStatus: CamperPaymentStatus.unpaid,
        });
      const firstCamperId = firstCreate.body.id as string;
      const secondCamperId = secondCreate.body.id as string;
      await prisma.camper.update({
        where: { id: firstCamperId },
        data: { feeDueCents: 16500, feePaidCents: 5000 },
      });
      await prisma.camper.update({
        where: { id: secondCamperId },
        data: { feeDueCents: 16500, feePaidCents: 0 },
      });

      const createSession = vi.fn().mockResolvedValue({
        id: "cs_test_multi_selected",
        url: "https://checkout.stripe.test/session",
      });
      const stripeRuntime = {
        appPublicUrl: "https://camp.example",
        webhookSecret: "whsec_test",
        stripe: {
          checkout: {
            sessions: {
              create: createSession,
            },
          },
        },
      } as unknown as StripeRuntime;

      const checkout = await createSelfCheckInCheckoutSession({
        campYearId,
        camperIds: [firstCamperId, secondCamperId],
        kioskToken,
        stripeRuntime,
      });
      expect(checkout).toMatchObject({
        ok: true,
        stripeSessionId: "cs_test_multi_selected",
        amountCents: 28000,
      });
      expect(createSession).toHaveBeenCalledWith(
        expect.objectContaining({
          mode: "payment",
          client_reference_id: expect.stringContaining(firstCamperId),
          line_items: expect.arrayContaining([
            expect.objectContaining({ price_data: expect.objectContaining({ unit_amount: 11500 }) }),
            expect.objectContaining({ price_data: expect.objectContaining({ unit_amount: 16500 }) }),
          ]),
        }),
      );

      const sessionRows = await prisma.stripeCheckoutSession.findMany({
        where: { stripeSessionId: "cs_test_multi_selected" },
      });
      expect(sessionRows.length).toBe(2);

      await prisma.campYear.update({
        where: { id: campYearId },
        data: { checkInConfirmationEmailsEnabled: false },
      });
      const completion = await completeCheckoutSessionIfPaid({
        id: "cs_test_multi_selected",
        payment_status: "paid",
      } as Parameters<typeof completeCheckoutSessionIfPaid>[0]);
      expect(completion).toMatchObject({
        completed: true,
        campYearId,
      });
      expect(completion.camperIds?.sort()).toEqual([firstCamperId, secondCamperId].sort());

      const checkedInCampers = await prisma.camper.findMany({
        where: { id: { in: [firstCamperId, secondCamperId] } },
        select: { id: true, paymentStatus: true, checkInStatus: true },
      });
      expect(checkedInCampers.every((camper) => camper.paymentStatus === CamperPaymentStatus.paid_stripe)).toBe(true);
      expect(checkedInCampers.every((camper) => camper.checkInStatus === CheckInStatus.checked_in)).toBe(true);
      expect(logSpy.mock.calls.some((call) => String(call[0]).includes("multi-pay@example.com"))).toBe(false);
    });

    it("regenerating kiosk token invalidates the previous QR URL", async () => {
      const header = await authHeader();
      const first = await request(app)
        .post(`/api/admin/camp-years/${campYearId}/self-check-in/token`)
        .set("Authorization", header)
        .send({});
      const t1 = first.body.token as string;
      const reg = await request(app)
        .post(`/api/admin/camp-years/${campYearId}/self-check-in/token/regenerate`)
        .set("Authorization", header)
        .send({});
      expect(reg.status).toBe(200);
      const t2 = reg.body.token as string;
      expect(t2).not.toBe(t1);

      const oldMeta = await request(app).get(`/api/public/self-check-in/${t1}/meta`);
      expect(oldMeta.status).toBe(404);

      const newMeta = await request(app).get(`/api/public/self-check-in/${t2}/meta`);
      expect(newMeta.status).toBe(200);
    });

    it("rejects camp admins when generating or regenerating the kiosk token", async () => {
      const campAdminHeader = await authHeaderForRole(AdminRole.camp_admin);
      const issue = await request(app)
        .post(`/api/admin/camp-years/${campYearId}/self-check-in/token`)
        .set("Authorization", campAdminHeader)
        .send({});
      expect(issue.status).toBe(403);

      const superAdminHeader = await authHeader();
      await request(app)
        .post(`/api/admin/camp-years/${campYearId}/self-check-in/token`)
        .set("Authorization", superAdminHeader)
        .send({});

      const regenerate = await request(app)
        .post(`/api/admin/camp-years/${campYearId}/self-check-in/token/regenerate`)
        .set("Authorization", campAdminHeader)
        .send({});
      expect(regenerate.status).toBe(403);
    });
  });
});
