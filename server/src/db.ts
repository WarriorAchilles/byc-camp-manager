import prismaClientPkg, { type PrismaClient as PrismaClientType } from "@prisma/client";

const { PrismaClient } = prismaClientPkg;

const globalForPrisma = globalThis as unknown as { prisma: PrismaClientType | undefined };

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["error", "warn"] : ["error"],
  });

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
