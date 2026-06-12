import { AdminRole, PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

type SeedInitialSuperAdminOptions = {
  username?: string;
  password?: string;
  nodeEnv?: string;
};

const localDefaultUsername = "admin";

function resolveBootstrapUsername(
  rawUsername: string | undefined,
  nodeEnv: string | undefined,
): string | null {
  const trimmedUsername = rawUsername?.trim();
  if (trimmedUsername && trimmedUsername.length > 0) {
    return trimmedUsername.toLowerCase();
  }

  if (nodeEnv === "production") {
    return null;
  }

  return localDefaultUsername;
}

export async function seedInitialSuperAdmin(options: SeedInitialSuperAdminOptions = {}): Promise<void> {
  const nodeEnv = options.nodeEnv ?? process.env.NODE_ENV;
  const username = resolveBootstrapUsername(
    options.username ?? process.env.INITIAL_SUPER_ADMIN_USERNAME,
    nodeEnv,
  );
  const plainPassword = options.password ?? process.env.INITIAL_SUPER_ADMIN_PASSWORD;

  if (!plainPassword || plainPassword.length < 12) {
    console.warn(
      "Skipping super admin seed: set INITIAL_SUPER_ADMIN_PASSWORD (min 12 characters) to create the first super admin.",
    );
    return;
  }

  if (!username) {
    console.warn(
      "Skipping super admin seed: set INITIAL_SUPER_ADMIN_USERNAME when NODE_ENV=production.",
    );
    return;
  }

  const prisma = new PrismaClient();
  try {
    const existingSuperAdmin = await prisma.adminUser.findFirst({
      where: { role: AdminRole.super_admin },
    });
    if (existingSuperAdmin) {
      console.info("Super admin seed skipped: a super admin already exists.");
      return;
    }

    const passwordHash = await bcrypt.hash(plainPassword, 12);
    await prisma.adminUser.create({
      data: {
        username,
        passwordHash,
        role: AdminRole.super_admin,
        createdById: null,
        isActive: true,
      },
    });
    console.info(`Created initial super admin: ${username}`);
  } finally {
    await prisma.$disconnect();
  }
}
