import type { Express } from "express";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "./app.js";
import { prisma } from "./db.js";
import { SETTINGS_ROW_ID } from "./lib/activeCampYearSetting.js";
import type { LeaderSubmission } from "./lib/leaderRegistration.js";

function validLeaderSubmission(): LeaderSubmission {
  return {
    submissionKey: "32a7dafe-7b9f-47b2-9af8-0a7b8b5425d7",
    email: "leader@example.test",
    firstName: "Taylor",
    lastName: "Leader",
    dateOfBirth: "1980-01-02",
    gender: "female",
    cellPhone: "5551234567",
    altPhone: null,
    streetAddress: "1 Camp Road",
    city: "Lebanon",
    stateOrProvince: "PA",
    postalCode: "17042",
    country: "United States",
    maritalStatus: "Married",
    faithServingResponse: "Faithfully serving for twenty years.",
    churchName: "Bible Church",
    pastorName: "Pastor Example",
    pastorPhone: "5559876543",
    ageGroupPreference: "10-13",
    tShirtSize: "L",
  };
}

async function schemaIsReady(): Promise<boolean> {
  try {
    await prisma.dormLeader.findFirst({ select: { publicSubmissionKey: true } });
    return true;
  } catch {
    return false;
  }
}

const integrationReady = await schemaIsReady();

describe.skipIf(!integrationReady)("public leader registration API", () => {
  let app: Express;
  let campYearId: string;

  beforeAll(() => {
    app = createApp();
  });

  beforeEach(async () => {
    await prisma.appSettings.deleteMany({});
    await prisma.dormLeader.deleteMany({});
    await prisma.campYear.deleteMany({});

    const year = await prisma.campYear.create({
      data: {
        name: "Leader Registration Test Camp",
        yearLabel: "2099",
        startDate: new Date("2099-07-01T12:00:00Z"),
        endDate: new Date("2099-07-07T12:00:00Z"),
        leaderRegistrationEnabled: true,
      },
    });
    campYearId = year.id;
    await prisma.appSettings.create({
      data: { id: SETTINGS_ROW_ID, activeCampYearId: campYearId },
    });
    await prisma.ageGroupBracket.create({
      data: {
        campYearId,
        label: "10-13",
        minAge: 10,
        maxAge: 13,
        sortOrder: 1,
      },
    });
  });

  afterAll(async () => {
    await prisma.appSettings.deleteMany({});
    await prisma.dormLeader.deleteMany({});
    await prisma.campYear.deleteMany({});
    await prisma.$disconnect();
  });

  it("publishes leader fields and configured age group choices", async () => {
    const availability = await request(app).get("/api/public/registration/leader");
    expect(availability.status).toBe(200);
    expect(availability.body).toMatchObject({ flow: "leader", state: "open" });

    const options = await request(app).get("/api/public/registration/leader/form-options");
    expect(options.status).toBe(200);
    expect(options.body.maritalStatuses).toEqual(["Single", "Married"]);
    expect(options.body.ageGroupOptions).toEqual(["10-13"]);
  });

  it("creates an operational dorm leader with every historical CSV field", async () => {
    const input = validLeaderSubmission();
    const response = await request(app)
      .post("/api/public/registration/leader")
      .set("X-Forwarded-For", "192.0.2.60")
      .send(input);

    expect(response.status).toBe(201);
    const leader = await prisma.dormLeader.findUniqueOrThrow({
      where: { id: response.body.registrationId },
    });
    expect(leader).toMatchObject({
      campYearId,
      email: input.email,
      firstName: input.firstName,
      phone: input.cellPhone,
      altPhone: null,
      streetAddress: input.streetAddress,
      maritalStatus: input.maritalStatus,
      faithServingResponse: input.faithServingResponse,
      churchName: input.churchName,
      pastorName: input.pastorName,
      pastorPhone: input.pastorPhone,
      roleLabel: input.ageGroupPreference,
      tShirtSize: input.tShirtSize,
      importSource: "online_registration",
    });
    expect(leader.publicSubmittedAt).not.toBeNull();
    expect(leader.publicSubmissionIp).toBeTruthy();
  });

  it("replays the same submission key and blocks duplicate identities", async () => {
    const input = validLeaderSubmission();
    const first = await request(app).post("/api/public/registration/leader").send(input);
    const retry = await request(app).post("/api/public/registration/leader").send(input);
    expect(first.status).toBe(201);
    expect(retry.status).toBe(200);
    expect(retry.body.registrationId).toBe(first.body.registrationId);

    const duplicate = validLeaderSubmission();
    duplicate.submissionKey = "07ac7a37-18ac-4a1d-a83f-a80b5ae1ba42";
    const duplicateResponse = await request(app)
      .post("/api/public/registration/leader")
      .send(duplicate);
    expect(duplicateResponse.status).toBe(409);
    expect(duplicateResponse.body).toMatchObject({ error: "leader_already_registered" });
    expect(await prisma.dormLeader.count({ where: { campYearId } })).toBe(1);
  });
});
