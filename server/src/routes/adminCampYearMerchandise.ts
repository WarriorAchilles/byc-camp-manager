import prismaClientPkg from "@prisma/client";
import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db.js";
import { campYearIdFromParams, pathParam } from "../lib/campYearParams.js";
import type { AuthedRequest } from "../middleware/auth.js";
import { requireAuth, requireRole } from "../middleware/auth.js";

const { AdminRole, MerchandiseOwnership } = prismaClientPkg;

const merchandiseBody = z.object({
  name: z.string().trim().min(1).max(200),
  description: z.string().trim().max(2_000).nullable().optional(),
  priceCents: z.number().int().nonnegative(),
  availableOptions: z.array(z.string().trim().min(1).max(100)).max(50),
  ownership: z.nativeEnum(MerchandiseOwnership),
  isActive: z.boolean().optional(),
  sortOrder: z.number().int().min(0).max(10_000).optional(),
});

const merchandisePatchBody = merchandiseBody.partial();

export const adminCampYearMerchandiseRouter = Router({ mergeParams: true });
adminCampYearMerchandiseRouter.use(requireAuth);

adminCampYearMerchandiseRouter.get(
  "/",
  requireRole(AdminRole.super_admin, AdminRole.camp_admin),
  async (req: AuthedRequest, res) => {
    const campYearId = campYearIdFromParams(req.params.campYearId, res);
    if (!campYearId) return;
    const year = await prisma.campYear.findUnique({ where: { id: campYearId }, select: { id: true } });
    if (!year) {
      res.status(404).json({ error: "Camp year not found" });
      return;
    }
    const merchandiseItems = await prisma.merchandiseItem.findMany({
      where: { campYearId },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    });
    res.json({ merchandiseItems });
  },
);

adminCampYearMerchandiseRouter.post(
  "/",
  requireRole(AdminRole.super_admin),
  async (req: AuthedRequest, res) => {
    const campYearId = campYearIdFromParams(req.params.campYearId, res);
    if (!campYearId) return;
    const parsed = merchandiseBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid request" });
      return;
    }
    const year = await prisma.campYear.findUnique({ where: { id: campYearId }, select: { id: true } });
    if (!year) {
      res.status(404).json({ error: "Camp year not found" });
      return;
    }
    const created = await prisma.merchandiseItem.create({
      data: {
        campYearId,
        ...parsed.data,
        description: parsed.data.description || null,
        availableOptions: [...new Set(parsed.data.availableOptions)],
        isActive: parsed.data.isActive ?? true,
        sortOrder: parsed.data.sortOrder ?? 0,
      },
    });
    res.status(201).json(created);
  },
);

adminCampYearMerchandiseRouter.patch(
  "/:itemId",
  requireRole(AdminRole.super_admin),
  async (req: AuthedRequest, res) => {
    const campYearId = campYearIdFromParams(req.params.campYearId, res);
    if (!campYearId) return;
    const itemId = pathParam(req.params.itemId);
    if (!itemId || !z.string().uuid().safeParse(itemId).success) {
      res.status(400).json({ error: "Invalid merchandise item id" });
      return;
    }
    const parsed = merchandisePatchBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid request" });
      return;
    }
    const existing = await prisma.merchandiseItem.findFirst({ where: { id: itemId, campYearId } });
    if (!existing) {
      res.status(404).json({ error: "Merchandise item not found" });
      return;
    }
    const updated = await prisma.merchandiseItem.update({
      where: { id: itemId },
      data: {
        ...parsed.data,
        ...(parsed.data.description !== undefined ? { description: parsed.data.description || null } : {}),
        ...(parsed.data.availableOptions !== undefined
          ? { availableOptions: [...new Set(parsed.data.availableOptions)] }
          : {}),
      },
    });
    res.json(updated);
  },
);

