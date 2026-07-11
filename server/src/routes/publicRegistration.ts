import { Router, type Response } from "express";
import { prisma } from "../db.js";
import { getActiveCampYearId } from "../lib/activeCampYearSetting.js";
import {
  resolveRegistrationAvailability,
  type RegistrationFlow,
} from "../lib/registrationAvailability.js";
import { createPublicRateLimit } from "../middleware/publicRateLimit.js";

const availabilityLimit = createPublicRateLimit({ limit: 120, windowMs: 60_000 });

export const publicRegistrationRouter = Router();
publicRegistrationRouter.use(availabilityLimit);

async function sendAvailability(flow: RegistrationFlow, res: Response): Promise<void> {
  const now = new Date();
  const activeCampYearId = await getActiveCampYearId(prisma);
  if (!activeCampYearId) {
    res.json({ flow, state: "not_configured", serverTime: now.toISOString(), camp: null });
    return;
  }

  const year = await prisma.campYear.findUnique({
    where: { id: activeCampYearId },
    select: {
      id: true,
      name: true,
      yearLabel: true,
      startDate: true,
      endDate: true,
      camperCapacity: true,
      familyRegistrationOpensAt: true,
      familyRegistrationClosesAt: true,
      familyRegistrationEnabled: true,
      familyRegistrationHeaderContent: true,
      familyRegistrationClosedMessage: true,
      workerRegistrationOpensAt: true,
      workerRegistrationClosesAt: true,
      workerRegistrationEnabled: true,
      workerRegistrationHeaderContent: true,
      workerRegistrationClosedMessage: true,
    },
  });
  if (!year) {
    res.json({ flow, state: "not_configured", serverTime: now.toISOString(), camp: null });
    return;
  }

  const activeCamperCount = flow === "family"
    ? await prisma.camper.count({ where: { campYearId: year.id, archivedAt: null } })
    : 0;
  const family = flow === "family";
  const opensAt = family ? year.familyRegistrationOpensAt : year.workerRegistrationOpensAt;
  const closesAt = family ? year.familyRegistrationClosesAt : year.workerRegistrationClosesAt;
  const state = resolveRegistrationAvailability({
    flow,
    enabled: family ? year.familyRegistrationEnabled : year.workerRegistrationEnabled,
    opensAt,
    closesAt,
    camperCapacity: year.camperCapacity,
    activeCamperCount,
  }, now);

  res.setHeader("Cache-Control", "no-store");
  res.json({
    flow,
    state,
    serverTime: now.toISOString(),
    opensAt: opensAt?.toISOString() ?? null,
    closesAt: closesAt?.toISOString() ?? null,
    headerContent: family
      ? year.familyRegistrationHeaderContent
      : year.workerRegistrationHeaderContent,
    closedMessage: family
      ? year.familyRegistrationClosedMessage
      : year.workerRegistrationClosedMessage,
    camp: {
      id: year.id,
      name: year.name,
      yearLabel: year.yearLabel,
      startDate: year.startDate.toISOString().slice(0, 10),
      endDate: year.endDate.toISOString().slice(0, 10),
    },
  });
}

publicRegistrationRouter.get("/family", async (_req, res, next) => {
  try { await sendAvailability("family", res); } catch (error) { next(error); }
});

publicRegistrationRouter.get("/worker", async (_req, res, next) => {
  try { await sendAvailability("worker", res); } catch (error) { next(error); }
});
