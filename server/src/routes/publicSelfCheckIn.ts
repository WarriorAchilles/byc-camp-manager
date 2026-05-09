import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db.js";
import { camperWhereForNameTokens, nameSearchTokens } from "../lib/camperNameSearch.js";
import { runCamperCheckInInTransaction } from "../lib/camperCheckInTx.js";
import { sendCheckInConfirmationMail } from "../lib/checkInConfirmationMail.js";
import { parseSelfCheckInTokenParam } from "../lib/qrToken.js";
import { pathParam } from "../lib/campYearParams.js";

const router = Router();

function middleInitialFromName(middleName: string | null): string | null {
  const t = middleName?.trim();
  if (!t) {
    return null;
  }
  return t.charAt(0).toUpperCase();
}

router.get("/:token/meta", async (req, res) => {
  const normalized = parseSelfCheckInTokenParam(req.params.token ?? "");
  if (!normalized) {
    res.status(400).json({ error: "invalid_token" });
    return;
  }
  const year = await prisma.campYear.findUnique({
    where: { selfCheckInToken: normalized },
    select: { name: true, yearLabel: true },
  });
  if (!year) {
    res.status(404).json({ error: "camp_not_found" });
    return;
  }
  res.json({ campYear: { name: year.name, yearLabel: year.yearLabel } });
});

router.get("/:token/search", async (req, res) => {
  const normalized = parseSelfCheckInTokenParam(req.params.token ?? "");
  if (!normalized) {
    res.status(400).json({ error: "invalid_token" });
    return;
  }
  const year = await prisma.campYear.findUnique({
    where: { selfCheckInToken: normalized },
    select: { id: true },
  });
  if (!year) {
    res.status(404).json({ error: "camp_not_found" });
    return;
  }
  const query = typeof req.query.q === "string" ? req.query.q : "";
  const tokens = nameSearchTokens(query);
  if (tokens.length === 0) {
    res.status(400).json({ error: "query_required" });
    return;
  }

  const where = camperWhereForNameTokens(year.id, tokens);

  const campers = await prisma.camper.findMany({
    where,
    select: {
      id: true,
      firstName: true,
      lastName: true,
      middleName: true,
      checkInStatus: true,
    },
    orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
    take: 40,
  });

  res.json({
    campers: campers.map((camper) => ({
      id: camper.id,
      firstName: camper.firstName,
      lastName: camper.lastName,
      middleInitial: middleInitialFromName(camper.middleName),
      checkInStatus: camper.checkInStatus,
    })),
  });
});

router.post("/:token/campers/:camperId/check-in", async (req, res) => {
  const normalized = parseSelfCheckInTokenParam(req.params.token ?? "");
  if (!normalized) {
    res.status(400).json({ error: "invalid_token" });
    return;
  }
  const year = await prisma.campYear.findUnique({
    where: { selfCheckInToken: normalized },
    select: { id: true, startDate: true },
  });
  if (!year) {
    res.status(404).json({ error: "camp_not_found" });
    return;
  }

  const campYearId = year.id;
  const camperId = pathParam(req.params.camperId);
  if (!camperId || !z.string().uuid().safeParse(camperId).success) {
    res.status(400).json({ error: "Invalid camper id" });
    return;
  }

  const now = new Date();

  const txResult = await prisma.$transaction(async (tx) =>
    runCamperCheckInInTransaction(tx, {
      campYearId,
      camperId,
      campStart: year.startDate,
      now,
      payments: {},
    }),
  );

  if (!txResult) {
    res.status(404).json({ error: "Camper not found" });
    return;
  }

  const { camper: finalCamper, transitionedToCheckedIn, dormAutoAssigned } = txResult;

  if (transitionedToCheckedIn) {
    const dormLabel = finalCamper.dorm?.name ?? "unassigned";
    const fullName = [finalCamper.firstName, finalCamper.middleName, finalCamper.lastName]
      .filter(Boolean)
      .join(" ");
    await sendCheckInConfirmationMail({
      to: finalCamper.guardianEmail,
      camperFullName: fullName,
      dormLabel,
      checkedInAt: now,
    });
  }

  res.json({
    camper: {
      firstName: finalCamper.firstName,
      lastName: finalCamper.lastName,
      middleInitial: middleInitialFromName(finalCamper.middleName),
      checkInStatus: finalCamper.checkInStatus,
      dormAssignment: finalCamper.dorm?.name ?? null,
    },
    alreadyCheckedIn: !transitionedToCheckedIn,
    checkInCompletedThisRequest: transitionedToCheckedIn,
    dormAutoAssigned,
  });
});

export const publicSelfCheckInRouter = router;
