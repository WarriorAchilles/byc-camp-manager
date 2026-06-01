import { AdminRole, PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

type SeedInitialSuperAdminOptions = {
  email?: string;
  password?: string;
  nodeEnv?: string;
};

const localDefaultEmail = "ZionEm7@gmail.com";

function resolveBootstrapEmail(rawEmail: string | undefined, nodeEnv: string | undefined): string | null {
  const trimmedEmail = rawEmail?.trim();
  if (trimmedEmail && trimmedEmail.length > 0) {
    return trimmedEmail.toLowerCase();
  }

  if (nodeEnv === "production") {
    return null;
  }

  return localDefaultEmail.toLowerCase();
}

export async function seedInitialSuperAdmin(options: SeedInitialSuperAdminOptions = {}): Promise<void> {
  const nodeEnv = options.nodeEnv ?? process.env.NODE_ENV;
  const email = resolveBootstrapEmail(options.email ?? process.env.INITIAL_SUPER_ADMIN_EMAIL, nodeEnv);
  const plainPassword = options.password ?? process.env.INITIAL_SUPER_ADMIN_PASSWORD;

  if (!plainPassword || plainPassword.length < 12) {
    console.warn(
      "Skipping super admin seed: set INITIAL_SUPER_ADMIN_PASSWORD (min 12 characters) to create the first super admin.",
    );
    return;
  }

  if (!email) {
    console.warn("Skipping super admin seed: set INITIAL_SUPER_ADMIN_EMAIL when NODE_ENV=production.");
    return;
  }

  const prisma = new PrismaClient();
  try {
    const existing = await prisma.adminUser.findUnique({ where: { email } });
    if (existing) {
      console.info(`Super admin seed skipped: user already exists for ${email}.`);
      return;
    }

    const passwordHash = await bcrypt.hash(plainPassword, 12);
    await prisma.adminUser.create({
      data: {
        email,
        passwordHash,
        role: AdminRole.super_admin,
        createdById: null,
        isActive: true,
      },
    });
    console.info(`Created initial super admin: ${email}`);
  } finally {
    await prisma.$disconnect();
  }
}
