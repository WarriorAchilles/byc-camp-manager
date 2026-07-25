import prismaClientPkg from "@prisma/client";
import type { Express } from "express";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createApp } from "./app.js";
import { prisma } from "./db.js";
import { SETTINGS_ROW_ID } from "./lib/activeCampYearSetting.js";
import { signAuthToken } from "./lib/authToken.js";
import { validWorkerSubmission } from "./workerRegistrationTestData.js";

const { AdminRole } = prismaClientPkg;

async function schemaIsReady(): Promise<boolean> {
  try {
    await prisma.workerRegistrationSubmission.findFirst({ select: { submissionKey: true } });
    return true;
  } catch {
    return false;
  }
}

const integrationReady = await schemaIsReady();

describe.skipIf(!integrationReady)("public worker registration API", () => {
  let app: Express;
  let campYearId: string;
  let adminToken: string;

  beforeAll(() => {
    app = createApp();
  });

  beforeEach(async () => {
    await prisma.appSettings.deleteMany({});
    await prisma.emailDeliveryAttempt.deleteMany({});
    await prisma.workerRegistrationMatch.deleteMany({});
    await prisma.workerRegistrationSubmission.deleteMany({});
    await prisma.worker.deleteMany({});
    await prisma.campYear.deleteMany({});
    await prisma.adminUser.deleteMany({ where: { username: "worker-review-test-admin" } });

    const year = await prisma.campYear.create({
      data: {
        name: "Worker Registration Test Camp",
        yearLabel: "2099",
        startDate: new Date("2099-07-01T12:00:00Z"),
        endDate: new Date("2099-07-07T12:00:00Z"),
        workerRegistrationEnabled: true,
        workerRegistrationOpensAt: new Date(Date.now() - 60_000),
        workerRegistrationClosesAt: new Date(Date.now() + 3_600_000),
      },
    });
    campYearId = year.id;
    await prisma.appSettings.create({
      data: { id: SETTINGS_ROW_ID, activeCampYearId: campYearId },
    });
    const admin = await prisma.adminUser.create({
      data: {
        username: "worker-review-test-admin",
        passwordHash: "not-used-by-bearer-auth",
        role: AdminRole.camp_admin,
      },
    });
    adminToken = signAuthToken({ sub: admin.id, role: admin.role });
  });

  afterAll(async () => {
    await prisma.appSettings.deleteMany({});
    await prisma.emailDeliveryAttempt.deleteMany({});
    await prisma.workerRegistrationMatch.deleteMany({});
    await prisma.workerRegistrationSubmission.deleteMany({});
    await prisma.worker.deleteMany({});
    await prisma.campYear.deleteMany({});
    await prisma.adminUser.deleteMany({ where: { username: "worker-review-test-admin" } });
    await prisma.$disconnect();
  });

  it("publishes only the fixed worker options and informational content", async () => {
    const response = await request(app).get("/api/public/registration/worker/form-options");
    expect(response.status).toBe(200);
    expect(response.body.taskOptions).toHaveLength(10);
    expect(response.body.taskOptions[8]).toContain("pre-approval required");
    expect(response.body.tShirtSizes).toEqual([
      "Not interested", "XS", "S", "M", "L", "XL", "XXL", "XXXL or larger",
    ]);
    expect(response.body.taskGuidance).toContain("based on camp need");
    expect(response.body.confirmationGuidance.payment).toContain("do not pay camp tuition");
  });

  it("creates an operational worker with public provenance and no payment record", async () => {
    const input = validWorkerSubmission();
    const logSpy = vi.spyOn(console, "info").mockImplementation(() => undefined);
    const response = await request(app)
      .post("/api/public/registration/worker")
      .set("X-Forwarded-For", "192.0.2.55")
      .send(input);

    expect(response.status).toBe(201);
    expect(response.body).toMatchObject({ status: "received", replayed: false });
    const submission = await prisma.workerRegistrationSubmission.findUniqueOrThrow({
      where: { submissionKey: input.submissionKey },
    });
    const worker = await prisma.worker.findUniqueOrThrow({
      where: { id: submission.resolvedWorkerId! },
    });
    expect(submission.status).toBe("created");
    expect(worker).toMatchObject({
      email: input.email,
      firstName: input.firstName,
      faithServingResponse: input.faithServingResponse,
      taskPreferenceFirst: "Kitchen",
      taskPreferenceSecond: "Crafts",
      taskPreferenceThird: "Snack Bar",
      tShirtSize: "M",
      importSource: "online_registration",
    });
    expect(worker.publicSubmittedAt).not.toBeNull();
    expect(worker.publicSubmissionIp).toBeTruthy();
    expect(response.body).not.toHaveProperty("providerMessageId");
    const emailAttempt = await prisma.emailDeliveryAttempt.findUniqueOrThrow({
      where: { idempotencyKey: `worker_registration_confirmation:${submission.id}` },
    });
    expect(emailAttempt).toMatchObject({
      workerRegistrationSubmissionId: submission.id,
      familyRegistrationId: null,
      templateKey: "worker_registration_confirmation",
      status: "skipped",
      attemptNumber: 1,
      providerMessageId: null,
    });
    const emailLogs = logSpy.mock.calls.flat().join("\n");
    expect(emailLogs).not.toContain(input.email);
    expect(emailLogs).not.toContain(input.faithServingResponse);
    expect(await prisma.familyRegistration.count({ where: { campYearId } })).toBe(0);
    expect(await prisma.stripeCheckoutSession.count({ where: { campYearId } })).toBe(0);
  });

  it("replays the same idempotency key without creating another worker", async () => {
    const input = validWorkerSubmission();
    const first = await request(app).post("/api/public/registration/worker").send(input);
    const retry = await request(app).post("/api/public/registration/worker").send(input);

    expect(first.status).toBe(201);
    expect(retry.status).toBe(200);
    expect(retry.body).toMatchObject({
      registrationId: first.body.registrationId,
      replayed: true,
    });
    expect(await prisma.worker.count({ where: { campYearId } })).toBe(1);
    expect(await prisma.workerRegistrationSubmission.count({
      where: { submissionKey: input.submissionKey },
    })).toBe(1);
    expect(await prisma.emailDeliveryAttempt.count({
      where: { workerRegistrationSubmissionId: first.body.registrationId },
    })).toBe(1);
  });

  it("flags an email match for admin review without overwriting the worker", async () => {
    const existing = await prisma.worker.create({
      data: {
        campYearId,
        email: "alex.worker@example.test",
        firstName: "Existing",
        lastName: "Person",
        gender: "male",
        cellPhone: "5559990000",
        streetAddress: "Existing address",
        city: "Existing city",
        stateOrProvince: "OH",
        postalCode: "43000",
        country: "United States",
        importSource: "admin_entry",
      },
    });
    const input = validWorkerSubmission();
    input.firstName = "Different";
    input.lastName = "Identity";
    input.cellPhone = "5551119999";

    const response = await request(app).post("/api/public/registration/worker").send(input);
    expect(response.status).toBe(201);
    expect(await prisma.worker.count({ where: { campYearId } })).toBe(1);
    expect(await prisma.worker.findUnique({ where: { id: existing.id } })).toMatchObject({
      firstName: "Existing",
      lastName: "Person",
      cellPhone: "5559990000",
    });
    const submission = await prisma.workerRegistrationSubmission.findUniqueOrThrow({
      where: { submissionKey: input.submissionKey },
      include: { likelyMatches: true },
    });
    expect(submission.status).toBe("pending_review");
    expect(submission.likelyMatches).toEqual([
      expect.objectContaining({ workerId: existing.id, matchReason: "email" }),
    ]);

    const reviewList = await request(app)
      .get(`/api/admin/camp-years/${campYearId}/workers`)
      .set("Authorization", `Bearer ${adminToken}`);
    expect(reviewList.status).toBe(200);
    expect(reviewList.body.workers).toHaveLength(1);
    expect(reviewList.body.pendingRegistrationReviews).toEqual([
      expect.objectContaining({
        id: submission.id,
        firstName: "Different",
        likelyMatches: [
          expect.objectContaining({
            matchReason: "email",
            worker: expect.objectContaining({ id: existing.id }),
          }),
        ],
      }),
    ]);
  });

  it("allows an authenticated admin to resolve a review without changing the match", async () => {
    const existing = await prisma.worker.create({
      data: {
        campYearId,
        email: "alex.worker@example.test",
        firstName: "Existing",
        lastName: "Person",
        gender: "male",
        cellPhone: "5559990000",
        streetAddress: "Existing address",
        city: "Existing city",
        stateOrProvince: "OH",
        postalCode: "43000",
        country: "United States",
        importSource: "admin_entry",
      },
    });
    const input = validWorkerSubmission();
    input.firstName = "Different";
    const submitted = await request(app).post("/api/public/registration/worker").send(input);

    const resolved = await request(app)
      .post(
        `/api/admin/camp-years/${campYearId}/workers/registration-reviews/${submitted.body.registrationId}/resolve`,
      )
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ decision: "link_existing", workerId: existing.id });
    expect(resolved.status).toBe(200);
    expect(resolved.body.submission).toMatchObject({
      status: "linked_existing",
      resolvedWorkerId: existing.id,
    });
    expect(await prisma.worker.count({ where: { campYearId } })).toBe(1);
    expect(await prisma.worker.findUnique({ where: { id: existing.id } })).toMatchObject({
      firstName: "Existing",
      cellPhone: "5559990000",
    });
  });

  it("allows only one concurrent admin resolution to create a separate worker", async () => {
    await prisma.worker.create({
      data: {
        campYearId,
        email: "alex.worker@example.test",
        firstName: "Existing",
        lastName: "Person",
        gender: "male",
        cellPhone: "5559990000",
        streetAddress: "Existing address",
        city: "Existing city",
        stateOrProvince: "OH",
        postalCode: "43000",
        country: "United States",
        importSource: "admin_entry",
      },
    });
    const submitted = await request(app)
      .post("/api/public/registration/worker")
      .send(validWorkerSubmission());
    const reviewUrl =
      `/api/admin/camp-years/${campYearId}/workers/registration-reviews/${submitted.body.registrationId}/resolve`;

    const responses = await Promise.all([
      request(app)
        .post(reviewUrl)
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ decision: "create_new" }),
      request(app)
        .post(reviewUrl)
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ decision: "create_new" }),
    ]);

    expect(responses.map((response) => response.status).sort()).toEqual([200, 404]);
    expect(await prisma.worker.count({ where: { campYearId } })).toBe(2);
  });

  it("rejects duplicate task rankings and submissions after the worker gate closes", async () => {
    const duplicateTasks = validWorkerSubmission();
    duplicateTasks.taskPreferences = ["Kitchen", "Kitchen", "Crafts"];
    const invalid = await request(app).post("/api/public/registration/worker").send(duplicateTasks);
    expect(invalid.status).toBe(400);
    expect(invalid.body).toMatchObject({ error: "validation_failed" });

    await prisma.campYear.update({
      where: { id: campYearId },
      data: {
        workerRegistrationEnabled: false,
        workerRegistrationOpensAt: new Date(Date.now() - 7_200_000),
        workerRegistrationClosesAt: new Date(Date.now() - 3_600_000),
      },
    });
    const closed = await request(app).post("/api/public/registration/worker").send(validWorkerSubmission());
    expect(closed.status).toBe(409);
    expect(closed.body).toMatchObject({ error: "registration_closed" });
  });
});
