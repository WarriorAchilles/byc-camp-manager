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

const superUsername = "super-auth-test@example.com";
const campUsername = "camp-auth-test@example.com";
const password = "test-password-12chars";

async function resetUsers(): Promise<void> {
  await prisma.adminUser.deleteMany({
    where: { username: { in: [superUsername, campUsername, "inactive@example.com"] } },
  });
  const superHash = await hashPassword(password);
  await prisma.adminUser.create({
    data: {
      username: superUsername,
      passwordHash: superHash,
      role: AdminRole.super_admin,
      isActive: true,
    },
  });
  await prisma.adminUser.create({
    data: {
      username: campUsername,
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
      where: { username: { in: [superUsername, campUsername, "inactive@example.com"] } },
    });
    await prisma.$disconnect();
  });

  it("logs in successfully and returns user", async () => {
    const res = await request(app)
      .post("/api/auth/login")
      .send({ username: superUsername, password });
    expect(res.status).toBe(200);
    expect(res.body.user.username).toBe(superUsername);
    expect(res.body.user.role).toBe("super_admin");
    expect(res.headers["set-cookie"]).toBeDefined();
  });

  it("rejects wrong password", async () => {
    const res = await request(app)
      .post("/api/auth/login")
      .send({ username: superUsername, password: "wrong-password-here" });
    expect(res.status).toBe(401);
  });

  it("rejects inactive accounts", async () => {
    const inactiveHash = await hashPassword(password);
    await prisma.adminUser.create({
      data: {
        username: "inactive@example.com",
        passwordHash: inactiveHash,
        role: AdminRole.camp_admin,
        isActive: false,
      },
    });
    const res = await request(app)
      .post("/api/auth/login")
      .send({ username: "inactive@example.com", password });
    expect(res.status).toBe(401);
  });

  it("returns current user from cookie session", async () => {
    const login = await request(app)
      .post("/api/auth/login")
      .send({ username: superUsername, password });
    const setCookie = login.headers["set-cookie"];
    const cookieHeader = Array.isArray(setCookie)
      ? setCookie.join("; ")
      : setCookie;
    expect(cookieHeader).toBeDefined();
    const res = await request(app).get("/api/auth/me").set("Cookie", cookieHeader!);
    expect(res.status).toBe(200);
    expect(res.body.username).toBe(superUsername);
  });

  it("blocks camp admin from super-admin user management", async () => {
    const campUser = await prisma.adminUser.findUniqueOrThrow({
      where: { username: campUsername },
    });
    const token = signAuthToken({ sub: campUser.id, role: campUser.role });
    const res = await request(app)
      .get("/api/admin/users")
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(403);
  });

  it("allows a super admin to reset another admin password", async () => {
    const superUser = await prisma.adminUser.findUniqueOrThrow({
      where: { username: superUsername },
    });
    const campUser = await prisma.adminUser.findUniqueOrThrow({
      where: { username: campUsername },
    });
    const token = signAuthToken({ sub: superUser.id, role: superUser.role });
    const newPassword = "new-test-password-12chars";

    const resetResponse = await request(app)
      .post(`/api/admin/users/${campUser.id}/reset-password`)
      .set("Authorization", `Bearer ${token}`)
      .send({ newPassword });

    expect(resetResponse.status).toBe(200);
    expect(resetResponse.body.username).toBe(campUsername);

    const loginResponse = await request(app)
      .post("/api/auth/login")
      .send({ username: campUsername, password: newPassword });
    expect(loginResponse.status).toBe(200);
  });

  it("allows a super admin to permanently delete another admin", async () => {
    const superUser = await prisma.adminUser.findUniqueOrThrow({
      where: { username: superUsername },
    });
    const campUser = await prisma.adminUser.findUniqueOrThrow({
      where: { username: campUsername },
    });
    const createdUsername = "created-by-deleted-admin";
    await prisma.adminUser.create({
      data: {
        username: createdUsername,
        passwordHash: await hashPassword(password),
        role: AdminRole.camp_admin,
        createdById: campUser.id,
      },
    });
    const token = signAuthToken({ sub: superUser.id, role: superUser.role });

    const deleteResponse = await request(app)
      .delete(`/api/admin/users/${campUser.id}`)
      .set("Authorization", `Bearer ${token}`);

    expect(deleteResponse.status).toBe(204);
    await expect(
      prisma.adminUser.findUnique({ where: { username: campUsername } }),
    ).resolves.toBeNull();
    const createdUser = await prisma.adminUser.findUniqueOrThrow({
      where: { username: createdUsername },
    });
    expect(createdUser.createdById).toBeNull();
    await prisma.adminUser.delete({ where: { id: createdUser.id } });
  });

  it("prevents a super admin from deleting their own account", async () => {
    const superUser = await prisma.adminUser.findUniqueOrThrow({
      where: { username: superUsername },
    });
    const token = signAuthToken({ sub: superUser.id, role: superUser.role });

    const response = await request(app)
      .delete(`/api/admin/users/${superUser.id}`)
      .set("Authorization", `Bearer ${token}`);

    expect(response.status).toBe(400);
    expect(response.body.error).toBe("You cannot delete your own account");
  });

  it("rejects protected admin route without auth", async () => {
    const res = await request(app).get("/api/admin/ping");
    expect(res.status).toBe(401);
  });
});
