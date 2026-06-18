import { AdminRole, type PrismaClient } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";
import {
  resolveBootstrapCredentials,
  resolveBootstrapUsername,
  seedInitialSuperAdmin,
} from "./lib/seedInitialSuperAdmin.js";

describe("initial super admin seed credential resolution", () => {
  it("uses a non-email local default outside production", () => {
    expect(resolveBootstrapUsername(undefined, "development")).toBe("admin");
  });

  it("requires an explicit username in production", () => {
    expect(resolveBootstrapUsername(undefined, "production")).toBeNull();
  });

  it("canonicalizes configured usernames", () => {
    expect(resolveBootstrapUsername(" Camp-Admin ", "production")).toBe("camp-admin");
  });

  it("rejects usernames with whitespace or non-ascii lookalikes", () => {
    expect(resolveBootstrapUsername("camp admin", "production")).toBeNull();
    expect(resolveBootstrapUsername("adm\u0456n", "production")).toBeNull();
  });

  it("accepts legacy email-shaped bootstrap usernames for migrated admins", () => {
    expect(resolveBootstrapUsername("Admin@Example.com", "production")).toBe(
      "admin@example.com",
    );
  });

  it("reads username and password from bootstrap secret JSON", () => {
    expect(
      resolveBootstrapCredentials({
        nodeEnv: "production",
        env: {},
        secretJson: JSON.stringify({
          username: "Bootstrap-Admin",
          password: "test-password-12chars",
        }),
      }),
    ).toEqual({
      username: "bootstrap-admin",
      plainPassword: "test-password-12chars",
    });
  });

  it("falls back to legacy email in bootstrap secret JSON", () => {
    expect(
      resolveBootstrapCredentials({
        nodeEnv: "production",
        env: {},
        secretJson: JSON.stringify({
          email: "LegacyAdmin@example.com",
          password: "test-password-12chars",
        }),
      }),
    ).toEqual({
      username: "legacyadmin@example.com",
      plainPassword: "test-password-12chars",
    });
  });

  it("prefers explicit username over legacy email values", () => {
    expect(
      resolveBootstrapCredentials({
        nodeEnv: "production",
        env: {},
        username: "Bootstrap-Admin",
        legacyEmail: "legacy@example.com",
        password: "test-password-12chars",
      }),
    ).toEqual({
      username: "bootstrap-admin",
      plainPassword: "test-password-12chars",
    });
  });

  it("skips seeding when an active super admin already exists", async () => {
    const prisma = {
      adminUser: {
        findFirst: vi.fn().mockResolvedValue({ id: "existing-super-admin" }),
        upsert: vi.fn(),
      },
      $disconnect: vi.fn(),
    } as unknown as PrismaClient;

    await seedInitialSuperAdmin({
      nodeEnv: "production",
      username: "bootstrap-admin",
      password: "test-password-12chars",
      prisma,
    });

    expect(prisma.adminUser.findFirst).toHaveBeenCalledWith({
      where: { role: AdminRole.super_admin, isActive: true },
    });
    expect(prisma.adminUser.upsert).not.toHaveBeenCalled();
    expect(prisma.$disconnect).not.toHaveBeenCalled();
  });

  it("creates or reactivates the configured account when no active super admin exists", async () => {
    const prisma = {
      adminUser: {
        findFirst: vi.fn().mockResolvedValue(null),
        upsert: vi.fn().mockResolvedValue({ id: "bootstrap-super-admin" }),
      },
      $disconnect: vi.fn(),
    } as unknown as PrismaClient;

    await seedInitialSuperAdmin({
      nodeEnv: "production",
      username: "Bootstrap-Admin",
      password: "test-password-12chars",
      prisma,
    });

    expect(prisma.adminUser.upsert).toHaveBeenCalledWith({
      where: { username: "bootstrap-admin" },
      update: expect.objectContaining({
        role: AdminRole.super_admin,
        isActive: true,
      }),
      create: expect.objectContaining({
        username: "bootstrap-admin",
        role: AdminRole.super_admin,
        isActive: true,
      }),
    });
    expect(prisma.$disconnect).not.toHaveBeenCalled();
  });
});
