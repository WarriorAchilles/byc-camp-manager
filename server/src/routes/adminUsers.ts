import { AdminRole } from "@prisma/client";
import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db.js";
import { hashPassword } from "../lib/password.js";
import type { AuthedRequest } from "../middleware/auth.js";
import { requireAuth, requireRole } from "../middleware/auth.js";
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
  email: z.string().email(),
  password: z.string().min(12),
  role: z.nativeEnum(AdminRole),
});

adminUsersRouter.get("/", async (_req, res) => {
  const users = await prisma.adminUser.findMany({
    orderBy: { email: "asc" },
    select: {
      id: true,
      email: true,
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
  const email = parsed.data.email.trim().toLowerCase();
  const passwordHash = await hashPassword(parsed.data.password);
  try {
    const created = await prisma.adminUser.create({
      data: {
        email,
        passwordHash,
        role: parsed.data.role,
        createdById: actor.id,
        isActive: true,
      },
      select: {
        id: true,
        email: true,
        role: true,
        isActive: true,
        createdAt: true,
      },
    });
    res.status(201).json(created);
  } catch {
    res.status(409).json({ error: "Email already in use" });
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
        email: true,
        role: true,
        isActive: true,
      },
    });
    res.json(updated);
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
      select: { id: true, email: true },
    });
    res.json(updated);
  } catch {
    res.status(404).json({ error: "User not found" });
  }
});
