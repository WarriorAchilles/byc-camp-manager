import prismaClientPkg from "@prisma/client";
import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db.js";
import { hashPassword } from "../lib/password.js";
import type { AuthedRequest } from "../middleware/auth.js";
import { requireAuth, requireRole } from "../middleware/auth.js";

const { AdminRole } = prismaClientPkg;

export const adminUsersRouter = Router();

function routeId(value: string | string[] | undefined): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  return Array.isArray(value) ? value[0] : value;
}

adminUsersRouter.use(requireAuth);
adminUsersRouter.use(requireRole(AdminRole.super_admin));

const createBody = z.object({
  username: z.string().trim().min(1).max(100),
  password: z.string().min(12),
  role: z.nativeEnum(AdminRole),
});

adminUsersRouter.get("/", async (_req, res) => {
  const users = await prisma.adminUser.findMany({
    orderBy: { username: "asc" },
    select: {
      id: true,
      username: true,
      role: true,
      isActive: true,
      createdAt: true,
      createdById: true,
    },
  });
  res.json({ users });
});

adminUsersRouter.post("/", async (req: AuthedRequest, res) => {
  const parsed = createBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request" });
    return;
  }
  const actor = req.adminUser;
  if (!actor) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  const username = parsed.data.username.toLowerCase();
  const passwordHash = await hashPassword(parsed.data.password);
  try {
    const created = await prisma.adminUser.create({
      data: {
        username,
        passwordHash,
        role: parsed.data.role,
        createdById: actor.id,
        isActive: true,
      },
      select: {
        id: true,
        username: true,
        role: true,
        isActive: true,
        createdAt: true,
      },
    });
    res.status(201).json(created);
  } catch {
    res.status(409).json({ error: "Username already in use" });
  }
});

const patchBody = z.object({
  isActive: z.boolean(),
});

adminUsersRouter.patch("/:id", async (req: AuthedRequest, res) => {
  const parsed = patchBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request" });
    return;
  }
  const actor = req.adminUser;
  if (!actor) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  const id = routeId(req.params.id);
  if (!id) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }
  if (id === actor.id && parsed.data.isActive === false) {
    res.status(400).json({ error: "You cannot deactivate your own account" });
    return;
  }
  try {
    const updated = await prisma.adminUser.update({
      where: { id },
      data: { isActive: parsed.data.isActive },
      select: {
        id: true,
        username: true,
        role: true,
        isActive: true,
      },
    });
    res.json(updated);
  } catch {
    res.status(404).json({ error: "User not found" });
  }
});

adminUsersRouter.delete("/:id", async (req: AuthedRequest, res) => {
  const actor = req.adminUser;
  if (!actor) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  const id = routeId(req.params.id);
  if (!id) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }
  if (id === actor.id) {
    res.status(400).json({ error: "You cannot delete your own account" });
    return;
  }

  try {
    await prisma.$transaction([
      prisma.adminUser.updateMany({
        where: { createdById: id },
        data: { createdById: null },
      }),
      prisma.adminUser.delete({ where: { id } }),
    ]);
    res.status(204).send();
  } catch {
    res.status(404).json({ error: "User not found" });
  }
});

const resetPasswordBody = z.object({
  newPassword: z.string().min(12),
});

adminUsersRouter.post("/:id/reset-password", async (req, res) => {
  const parsed = resetPasswordBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request" });
    return;
  }
  const id = routeId(req.params.id);
  if (!id) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }
  const passwordHash = await hashPassword(parsed.data.newPassword);
  try {
    const updated = await prisma.adminUser.update({
      where: { id },
      data: { passwordHash },
      select: { id: true, username: true },
    });
    res.json(updated);
  } catch {
    res.status(404).json({ error: "User not found" });
  }
});
