import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Express } from "express";
import request from "supertest";
import { createApp } from "./app.js";
import { prisma } from "./db.js";

async function canQueryDatabase(): Promise<boolean> {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return true;
  } catch {
    return false;
  }
}

const integrationDbReady = await canQueryDatabase();

describe.skipIf(!integrationDbReady)("API health endpoints", () => {
  let app: Express;

  beforeAll(() => {
    app = createApp();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("GET /api/health returns ok", async () => {
    const res = await request(app).get("/api/health").expect(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.service).toBe("byc-camp-manager-api");
  });

  it("GET /api/health/ready returns database ok", async () => {
    const res = await request(app).get("/api/health/ready").expect(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.checks?.database?.ok).toBe(true);
    expect(res.body.checks?.email).toBeDefined();
  });
});
