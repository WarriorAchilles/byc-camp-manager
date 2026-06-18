import { AdminRole, PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import { canonicalizeAdminUsername } from "./adminUsername.js";

type SeedInitialSuperAdminOptions = {
  username?: string;
  legacyEmail?: string;
  password?: string;
  nodeEnv?: string;
  secretJson?: string;
  env?: NodeJS.ProcessEnv;
  prisma?: PrismaClient;
};

const localDefaultUsername = "admin";

type BootstrapSecret = {
  username?: string;
  email?: string;
  password?: string;
};

function parseBootstrapSecret(rawSecretJson: string | undefined): BootstrapSecret {
  if (!rawSecretJson?.trim()) {
    return {};
  }
  try {
    const parsed = JSON.parse(rawSecretJson) as Record<string, unknown>;
    return {
      username: typeof parsed.username === "string" ? parsed.username : undefined,
      email: typeof parsed.email === "string" ? parsed.email : undefined,
      password: typeof parsed.password === "string" ? parsed.password : undefined,
    };
  } catch {
    console.warn("Ignoring INITIAL_SUPER_ADMIN_SECRET_JSON: value is not valid JSON.");
    return {};
  }
}

export function resolveBootstrapUsername(
  rawUsername: string | undefined,
  nodeEnv: string | undefined,
): string | null {
  if (rawUsername !== undefined) {
    return canonicalizeAdminUsername(rawUsername);
  }

  if (nodeEnv === "production") {
    return null;
  }

  return localDefaultUsername;
}

export function resolveBootstrapCredentials(options: SeedInitialSuperAdminOptions): {
  username: string | null;
  plainPassword: string | undefined;
} {
  const env = options.env ?? process.env;
  const nodeEnv = options.nodeEnv ?? env.NODE_ENV;
  const secret = parseBootstrapSecret(
    options.secretJson ?? env.INITIAL_SUPER_ADMIN_SECRET_JSON,
  );
  const username = resolveBootstrapUsername(
    options.username ??
      env.INITIAL_SUPER_ADMIN_USERNAME ??
      secret.username ??
      options.legacyEmail ??
      env.INITIAL_SUPER_ADMIN_EMAIL ??
      secret.email,
    nodeEnv,
  );
  const plainPassword = options.password ?? env.INITIAL_SUPER_ADMIN_PASSWORD ?? secret.password;
  return { username, plainPassword };
}

export async function seedInitialSuperAdmin(
  options: SeedInitialSuperAdminOptions = {},
): Promise<void> {
  const { username, plainPassword } = resolveBootstrapCredentials(options);

  if (!plainPassword || plainPassword.length < 12) {
    console.warn(
      "Skipping super admin seed: set INITIAL_SUPER_ADMIN_PASSWORD (min 12 characters) to create the first super admin.",
    );
    return;
  }

  if (!username) {
    console.warn(
      "Skipping super admin seed: set a valid INITIAL_SUPER_ADMIN_USERNAME when NODE_ENV=production.",
    );
    return;
  }

  const prisma = options.prisma ?? new PrismaClient();
  try {
    const existingActiveSuperAdmin = await prisma.adminUser.findFirst({
      where: { role: AdminRole.super_admin, isActive: true },
    });
    if (existingActiveSuperAdmin) {
      console.info("Super admin seed skipped: an active super admin already exists.");
      return;
    }

    const passwordHash = await bcrypt.hash(plainPassword, 12);
    await prisma.adminUser.upsert({
      where: { username },
      update: {
        passwordHash,
        role: AdminRole.super_admin,
        isActive: true,
      },
      create: {
        username,
        passwordHash,
        role: AdminRole.super_admin,
        createdById: null,
        isActive: true,
      },
    });
    console.info(`Created or reactivated initial super admin: ${username}`);
  } finally {
    if (!options.prisma) {
      await prisma.$disconnect();
    }
  }
}
