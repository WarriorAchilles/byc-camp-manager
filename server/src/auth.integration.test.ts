import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Express } from "express";
import request from "supertest";
import { AdminRole } from "@prisma/client";
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

const superEmail = "super-auth-test@example.com";
const campEmail = "camp-auth-test@example.com";
const password = "test-password-12chars";

async function resetUsers(): Promise<void> {
  await prisma.adminUser.deleteMany({
    where: { email: { in: [superEmail, campEmail, "inactive@example.com"] } },
  });
  const superHash = await hashPassword(password);
  await prisma.adminUser.create({
    data: {
      email: superEmail,
      passwordHash: superHash,
      role: AdminRole.super_admin,
      isActive: true,
    },
  });
  await prisma.adminUser.create({
    data: {
      email: campEmail,
      passwordHash: superHash,
      role: AdminRole.camp_admin,
      isActive: true,
    },
  });
}

describe.skipIf(!integrationDbReady)("admin authentication and authorization", () => {
  let app: Express;

  beforeAll(() => {
    app = createApp();
  });

  beforeEach(async () => {
    await resetUsers();
  });

  afterAll(async () => {
    await prisma.adminUser.deleteMany({
      where: { email: { in: [superEmail, campEmail, "inactive@example.com"] } },
    });
    await prisma.$disconnect();
  });

  it("logs in successfully and returns user", async () => {
    const res = await request(app)
      .post("/api/auth/login")
      .send({ email: superEmail, password });
    expect(res.status).toBe(200);
    expect(res.body.user.email).toBe(superEmail);
    expect(res.body.user.role).toBe("super_admin");
    expect(res.headers["set-cookie"]).toBeDefined();
  });

  it("rejects wrong password", async () => {
    const res = await request(app)
      .post("/api/auth/login")
      .send({ email: superEmail, password: "wrong-password-here" });
    expect(res.status).toBe(401);
  });

  it("rejects inactive accounts", async () => {
    const inactiveHash = await hashPassword(password);
    await prisma.adminUser.create({
      data: {
        email: "inactive@example.com",
        passwordHash: inactiveHash,
        role: AdminRole.camp_admin,
        isActive: false,
      },
    });
    const res = await request(app)
      .post("/api/auth/login")
      .send({ email: "inactive@example.com", password });
    expect(res.status).toBe(401);
  });

  it("returns current user from cookie session", async () => {
    const login = await request(app)
      .post("/api/auth/login")
      .send({ email: superEmail, password });
    const setCookie = login.headers["set-cookie"];
    const cookieHeader = Array.isArray(setCookie)
      ? setCookie.join("; ")
      : setCookie;
    expect(cookieHeader).toBeDefined();
    const res = await request(app).get("/api/auth/me").set("Cookie", cookieHeader!);
    expect(res.status).toBe(200);
    expect(res.body.email).toBe(superEmail);
  });

  it("blocks camp admin from super-admin user management", async () => {
    const campUser = await prisma.adminUser.findUniqueOrThrow({
      where: { email: campEmail },
    });
    const token = signAuthToken({ sub: campUser.id, role: campUser.role });
    const res = await request(app)
      .get("/api/admin/users")
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(403);
  });

  it("rejects protected admin route without auth", async () => {
    const res = await request(app).get("/api/admin/ping");
    expect(res.status).toBe(401);
  });
});
