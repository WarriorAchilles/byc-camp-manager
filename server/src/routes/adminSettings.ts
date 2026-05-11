import { AdminRole } from "@prisma/client";
import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db.js";
import { SETTINGS_ROW_ID } from "../lib/activeCampYearSetting.js";
import type { AuthedRequest } from "../middleware/auth.js";
import { requireAuth, requireRole } from "../middleware/auth.js";

const patchBody = z.object({
  activeCampYearId: z.string().uuid().nullable(),
});

export const adminSettingsRouter = Router();

adminSettingsRouter.use(requireAuth);

adminSettingsRouter.get(
  "/",
  requireRole(AdminRole.super_admin, AdminRole.camp_admin),
  async (_req, res) => {
    const row = await prisma.appSettings.findUnique({
      where: { id: SETTINGS_ROW_ID },
      select: { activeCampYearId: true },
    });
    res.json({ activeCampYearId: row?.activeCampYearId ?? null });
  },
);

adminSettingsRouter.patch(
  "/",
  requireRole(AdminRole.super_admin),
  async (req: AuthedRequest, res) => {
    const parsed = patchBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid request" });
      return;
    }
    const { activeCampYearId } = parsed.data;
    if (activeCampYearId !== null) {
      const year = await prisma.campYear.findUnique({
        where: { id: activeCampYearId },
        select: { id: true },
      });
      if (!year) {
        res.status(400).json({ error: "Camp year not found" });
        return;
      }
    }
    const updated = await prisma.appSettings.upsert({
      where: { id: SETTINGS_ROW_ID },
      create: { id: SETTINGS_ROW_ID, activeCampYearId },
      update: { activeCampYearId },
    });
    res.json({ activeCampYearId: updated.activeCampYearId });
  },
);
