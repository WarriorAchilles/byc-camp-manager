import { AdminRole, PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

/**
 * Creates the first super admin when INITIAL_SUPER_ADMIN_PASSWORD is set.
 * Email defaults to INITIAL_SUPER_ADMIN_EMAIL or the project bootstrap address for local dev.
 * In production, set both env vars explicitly; never commit real passwords.
 */
async function main(): Promise<void> {
  const rawEmail = process.env.INITIAL_SUPER_ADMIN_EMAIL?.trim();
  const email = (rawEmail && rawEmail.length > 0 ? rawEmail : "ZionEm7@gmail.com").toLowerCase();
  const plainPassword = process.env.INITIAL_SUPER_ADMIN_PASSWORD;

  if (!plainPassword || plainPassword.length < 12) {
    console.warn(
      "Skipping super admin seed: set INITIAL_SUPER_ADMIN_PASSWORD (min 12 characters) to create the first super admin.",
    );
    return;
  }

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
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (error) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });
