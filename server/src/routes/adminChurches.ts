import prismaClientPkg, { Prisma } from "@prisma/client";
import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db.js";
import {
  followChurchMerge,
  normalizedChurchPair,
  similarity,
} from "../lib/churchIdentity.js";
import {
  amountBalanceState,
  remainingRegistrationFeeCents,
  syncFamilyRegistrationBalance,
} from "../lib/paymentBalances.js";
import { writeOpsLog } from "../lib/opsLog.js";
import type { AuthedRequest } from "../middleware/auth.js";
import { requireAuth, requireRole } from "../middleware/auth.js";

const { AdminRole, CamperPaymentStatus, ChurchPaymentTender } = prismaClientPkg;

export const adminChurchesRouter = Router();
adminChurchesRouter.use(requireAuth);
adminChurchesRouter.use(requireRole(AdminRole.super_admin, AdminRole.camp_admin));

const uuid = z.string().uuid();
const campYearQuery = z.object({ campYearId: uuid.optional() });
const personType = z.enum(["camper", "worker", "dorm_leader"]);

function affectedJson(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

async function ensureActiveChurch(churchId: string) {
  return followChurchMerge(prisma, churchId);
}

adminChurchesRouter.get("/", async (req, res, next) => {
  const parsed = campYearQuery.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid camp year" });
    return;
  }
  const campYearId = parsed.data.campYearId;
  try {
    const churches = await prisma.church.findMany({
      where: { mergedIntoChurchId: null },
      include: {
        aliases: {
          select: { id: true, name: true, pastorName: true },
          orderBy: { createdAt: "asc" },
        },
      },
      orderBy: [{ name: "asc" }, { pastorName: "asc" }],
    });
    const [camperCounts, workerCounts, leaderCounts, paymentCounts] = await Promise.all([
      prisma.camper.groupBy({
        by: ["churchId"],
        where: { churchId: { not: null }, archivedAt: null, ...(campYearId ? { campYearId } : {}) },
        _count: { _all: true },
      }),
      prisma.worker.groupBy({
        by: ["churchId"],
        where: { churchId: { not: null }, archivedAt: null, ...(campYearId ? { campYearId } : {}) },
        _count: { _all: true },
      }),
      prisma.dormLeader.groupBy({
        by: ["churchId"],
        where: { churchId: { not: null }, archivedAt: null, ...(campYearId ? { campYearId } : {}) },
        _count: { _all: true },
      }),
      prisma.churchPayment.groupBy({
        by: ["churchId"],
        where: campYearId ? { campYearId } : {},
        _count: { _all: true },
      }),
    ]);
    const counts = (rows: typeof camperCounts) =>
      new Map(rows.map((row) => [row.churchId, row._count._all]));
    const campers = counts(camperCounts);
    const workers = counts(workerCounts);
    const leaders = counts(leaderCounts);
    const payments = counts(paymentCounts);
    res.json({
      churches: churches.map((church) => ({
        ...church,
        counts: {
          campers: campers.get(church.id) ?? 0,
          workers: workers.get(church.id) ?? 0,
          leaders: leaders.get(church.id) ?? 0,
          payments: payments.get(church.id) ?? 0,
        },
      })),
    });
  } catch (error) {
    next(error);
  }
});

adminChurchesRouter.get("/cleanup", async (req, res, next) => {
  const parsed = campYearQuery.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid camp year" });
    return;
  }
  const campYearId = parsed.data.campYearId;
  const yearWhere = campYearId ? { campYearId } : {};
  try {
    const [churches, campers, workers, leaders] = await Promise.all([
      prisma.church.findMany({
        where: { mergedIntoChurchId: null },
        select: {
          id: true,
          name: true,
          pastorName: true,
          normalizedName: true,
          normalizedPastorName: true,
          reviewedAt: true,
        },
      }),
      prisma.camper.findMany({
        where: { ...yearWhere, archivedAt: null },
        select: {
          id: true, firstName: true, lastName: true, campYearId: true,
          churchId: true, churchName: true, pastorName: true,
          church: { select: { name: true, pastorName: true } },
        },
      }),
      prisma.worker.findMany({
        where: { ...yearWhere, archivedAt: null },
        select: {
          id: true, firstName: true, lastName: true, campYearId: true,
          churchId: true, churchName: true, pastorName: true,
          church: { select: { name: true, pastorName: true } },
        },
      }),
      prisma.dormLeader.findMany({
        where: { ...yearWhere, archivedAt: null },
        select: {
          id: true, firstName: true, lastName: true, campYearId: true,
          churchId: true, churchName: true, pastorName: true,
          church: { select: { name: true, pastorName: true } },
        },
      }),
    ]);
    const people = [
      ...campers.map((row) => ({ ...row, type: "camper" as const })),
      ...workers.map((row) => ({ ...row, type: "worker" as const })),
      ...leaders.map((row) => ({ ...row, type: "dorm_leader" as const })),
    ];
    const unmapped = people.filter((person) =>
      !person.churchId && (!person.churchName?.trim() || !person.pastorName?.trim()));
    const differing = people.filter((person) =>
      person.churchId && person.church && (
        person.churchName?.trim() !== person.church.name
        || person.pastorName?.trim() !== person.church.pastorName
      ));
    const likelyDuplicates: Array<{
      sourceChurchId: string;
      targetChurchId: string;
      source: string;
      target: string;
      signals: string[];
    }> = [];
    for (let leftIndex = 0; leftIndex < churches.length; leftIndex += 1) {
      for (let rightIndex = leftIndex + 1; rightIndex < churches.length; rightIndex += 1) {
        const left = churches[leftIndex]!;
        const right = churches[rightIndex]!;
        const signals: string[] = [];
        const churchSimilarity = similarity(left.normalizedName, right.normalizedName);
        const pastorSimilarity = similarity(left.normalizedPastorName, right.normalizedPastorName);
        if (left.normalizedPastorName === right.normalizedPastorName && churchSimilarity >= 0.65) {
          signals.push("Exact pastor and similar church name");
        }
        if (left.normalizedName === right.normalizedName && left.normalizedPastorName !== right.normalizedPastorName
          && pastorSimilarity >= 0.72) {
          signals.push("Exact church name and similar pastor name");
        }
        if (churchSimilarity >= 0.78 && pastorSimilarity >= 0.78) {
          signals.push("Similar church and pastor names");
        }
        if (signals.length > 0) {
          likelyDuplicates.push({
            sourceChurchId: left.id,
            targetChurchId: right.id,
            source: `${left.name} - ${left.pastorName}`,
            target: `${right.name} - ${right.pastorName}`,
            signals: [...new Set(signals)],
          });
        }
      }
    }
    res.json({
      unmapped,
      differing,
      unreviewedChurches: churches.filter((church) => !church.reviewedAt),
      likelyDuplicates,
    });
  } catch (error) {
    next(error);
  }
});

adminChurchesRouter.get("/financial-summary", async (req, res, next) => {
  const parsed = z.object({ campYearId: uuid }).safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid camp year" });
    return;
  }
  try {
    const [payments, campers] = await Promise.all([
      prisma.churchPayment.findMany({
        where: { campYearId: parsed.data.campYearId },
        include: {
          church: { select: { id: true, name: true, pastorName: true } },
          allocations: {
            include: { camper: { select: { id: true, firstName: true, lastName: true } } },
          },
        },
        orderBy: [{ receivedDate: "asc" }, { createdAt: "asc" }],
      }),
      prisma.camper.findMany({
        where: {
          campYearId: parsed.data.campYearId,
          archivedAt: null,
          OR: [{ familyRegistrationId: null }, { familyRegistration: { state: "confirmed" } }],
        },
        select: { feeDueCents: true, feePaidCents: true },
      }),
    ]);
    const active = payments.filter((payment) => !payment.voidedAt);
    const totals = {
      checkCents: active.filter((payment) => payment.tender === ChurchPaymentTender.check)
        .reduce((sum, payment) => sum + payment.amountReceivedCents, 0),
      cashCents: active.filter((payment) => payment.tender === ChurchPaymentTender.cash)
        .reduce((sum, payment) => sum + payment.amountReceivedCents, 0),
      paymentCount: active.length,
      allocatedCents: active.reduce((sum, payment) =>
        sum + payment.allocations.reduce((allocationSum, allocation) =>
          allocationSum + allocation.appliedAmountCents, 0), 0),
      voidedCents: payments.filter((payment) => payment.voidedAt)
        .reduce((sum, payment) => sum + payment.amountReceivedCents, 0),
      outstandingRegistrationFeeCents: campers.reduce((sum, camper) =>
        sum + remainingRegistrationFeeCents(camper), 0),
    };
    res.json({
      totals,
      exportRows: payments.flatMap((payment) => payment.allocations.map((allocation) => ({
        paymentId: payment.id,
        churchId: payment.church.id,
        churchName: payment.church.name,
        pastorName: payment.church.pastorName,
        tender: payment.tender,
        receivedDate: payment.receivedDate.toISOString().slice(0, 10),
        referenceNumber: payment.referenceNumber,
        amountReceivedCents: payment.amountReceivedCents,
        camperId: allocation.camper.id,
        camperName: `${allocation.camper.firstName} ${allocation.camper.lastName}`,
        allocatedCents: allocation.appliedAmountCents,
        voidedAt: payment.voidedAt?.toISOString() ?? null,
      }))),
    });
  } catch (error) {
    next(error);
  }
});

const renameBody = z.object({
  name: z.string().trim().min(1).max(200),
  pastorName: z.string().trim().min(1).max(200),
}).strict();

adminChurchesRouter.patch("/:churchId", async (req: AuthedRequest, res, next) => {
  const parsedId = uuid.safeParse(req.params.churchId);
  const parsed = renameBody.safeParse(req.body);
  if (!parsedId.success || !parsed.success || !req.adminUser) {
    res.status(400).json({ error: "Invalid request" });
    return;
  }
  const normalized = normalizedChurchPair({
    churchName: parsed.data.name,
    pastorName: parsed.data.pastorName,
  })!;
  try {
    const result = await prisma.$transaction(async (tx) => {
      const church = await tx.church.findUnique({ where: { id: parsedId.data } });
      if (!church || church.mergedIntoChurchId) throw new Error("church_not_active");
      const canonicalConflict = await tx.church.findFirst({
        where: {
          id: { not: church.id },
          normalizedName: normalized.normalizedName,
          normalizedPastorName: normalized.normalizedPastorName,
        },
        select: { id: true },
      });
      const aliasConflict = await tx.churchAlias.findUnique({
        where: { normalizedName_normalizedPastorName: normalized },
        select: { churchId: true },
      });
      if (canonicalConflict || (aliasConflict && aliasConflict.churchId !== church.id)) {
        throw new Error("identity_conflict");
      }
      if (church.normalizedName !== normalized.normalizedName
        || church.normalizedPastorName !== normalized.normalizedPastorName) {
        await tx.churchAlias.upsert({
          where: {
            normalizedName_normalizedPastorName: {
              normalizedName: church.normalizedName,
              normalizedPastorName: church.normalizedPastorName,
            },
          },
          create: {
            churchId: church.id,
            name: church.name,
            pastorName: church.pastorName,
            normalizedName: church.normalizedName,
            normalizedPastorName: church.normalizedPastorName,
          },
          update: {},
        });
      }
      const updated = await tx.church.update({
        where: { id: church.id },
        data: { ...parsed.data, ...normalized, reviewedAt: new Date() },
      });
      await tx.churchAuditLog.create({
        data: {
          actorAdminUserId: req.adminUser!.id,
          action: "rename",
          sourceChurchId: church.id,
          targetChurchId: church.id,
          affectedRecordIds: affectedJson({ churchIds: [church.id] }),
          details: affectedJson({
            before: { name: church.name, pastorName: church.pastorName },
            after: parsed.data,
          }),
        },
      });
      return updated;
    });
    writeOpsLog("church_renamed", { actorAdminUserId: req.adminUser.id, churchId: result.id });
    res.json(result);
  } catch (error) {
    if (error instanceof Error && error.message === "church_not_active") {
      res.status(404).json({ error: "Active church not found" });
      return;
    }
    if (error instanceof Error && error.message === "identity_conflict") {
      res.status(409).json({ error: "That church and pastor identity already belongs to another church" });
      return;
    }
    next(error);
  }
});

adminChurchesRouter.delete("/:churchId", async (req: AuthedRequest, res, next) => {
  const parsedId = uuid.safeParse(req.params.churchId);
  if (!parsedId.success || !req.adminUser) {
    res.status(400).json({ error: "Invalid church id" });
    return;
  }
  try {
    const result = await prisma.$transaction(async (tx) => {
      const church = await tx.church.findUnique({
        where: { id: parsedId.data },
        select: {
          id: true,
          name: true,
          pastorName: true,
          mergedIntoChurchId: true,
          _count: {
            select: {
              campers: true,
              workers: true,
              workerRegistrationSubmissions: true,
              dormLeaders: true,
              payments: true,
              mergedChurches: true,
            },
          },
        },
      });
      if (!church || church.mergedIntoChurchId) throw new Error("church_not_active");
      if (church._count.payments > 0) throw new Error("church_has_payments");
      if (church._count.mergedChurches > 0) throw new Error("church_has_redirects");

      const affected = {
        campers: church._count.campers,
        workers: church._count.workers,
        workerRegistrationSubmissions: church._count.workerRegistrationSubmissions,
        dormLeaders: church._count.dormLeaders,
      };
      await tx.churchAuditLog.create({
        data: {
          actorAdminUserId: req.adminUser!.id,
          action: "delete",
          sourceChurchId: church.id,
          affectedRecordIds: affectedJson({ churchIds: [church.id] }),
          details: affectedJson({
            church: { name: church.name, pastorName: church.pastorName },
            unassigned: affected,
          }),
        },
      });
      await tx.churchAlias.deleteMany({ where: { churchId: church.id } });
      await tx.church.delete({ where: { id: church.id } });
      return { church, affected };
    });
    writeOpsLog("church_deleted", {
      actorAdminUserId: req.adminUser.id,
      churchId: result.church.id,
      affected: result.affected,
    });
    res.status(204).send();
  } catch (error) {
    if (error instanceof Error && error.message === "church_not_active") {
      res.status(404).json({ error: "Active church not found" });
      return;
    }
    if (error instanceof Error && error.message === "church_has_payments") {
      res.status(409).json({
        error: "Churches with payment history cannot be deleted. Merge this church instead.",
      });
      return;
    }
    if (error instanceof Error && error.message === "church_has_redirects") {
      res.status(409).json({
        error: "This church has merged church redirects and cannot be deleted.",
      });
      return;
    }
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2003") {
      res.status(409).json({
        error: "This church is still referenced by protected history and cannot be deleted.",
      });
      return;
    }
    next(error);
  }
});

const remapBody = z.object({
  churchId: uuid,
  people: z.array(z.object({ type: personType, id: uuid }).strict()).min(1).max(500),
}).strict();

adminChurchesRouter.post("/remap", async (req: AuthedRequest, res, next) => {
  const parsed = remapBody.safeParse(req.body);
  if (!parsed.success || !req.adminUser) {
    res.status(400).json({ error: "Invalid request" });
    return;
  }
  try {
    const target = await ensureActiveChurch(parsed.data.churchId);
    if (!target) {
      res.status(404).json({ error: "Church not found" });
      return;
    }
    await prisma.$transaction(async (tx) => {
      for (const person of parsed.data.people) {
        const model = person.type === "camper"
          ? tx.camper
          : person.type === "worker"
            ? tx.worker
            : tx.dormLeader;
        const updated = await (model as typeof tx.camper).updateMany({
          where: { id: person.id },
          data: { churchId: target.id },
        });
        if (updated.count !== 1) throw new Error("person_not_found");
      }
      await tx.churchAuditLog.create({
        data: {
          actorAdminUserId: req.adminUser!.id,
          action: "remap",
          targetChurchId: target.id,
          affectedRecordIds: affectedJson({ people: parsed.data.people }),
        },
      });
    });
    writeOpsLog("church_people_remapped", {
      actorAdminUserId: req.adminUser.id,
      targetChurchId: target.id,
      affectedCount: parsed.data.people.length,
    });
    res.json({ remapped: parsed.data.people.length, churchId: target.id });
  } catch (error) {
    if (error instanceof Error && error.message === "person_not_found") {
      res.status(404).json({ error: "One or more people were not found" });
      return;
    }
    next(error);
  }
});

const mergeBody = z.object({
  sourceChurchIds: z.array(uuid).min(1).max(50),
  targetChurchId: uuid,
  confirm: z.literal(true).optional(),
}).strict();

async function mergePreview(sourceChurchIds: string[], targetChurchId: string) {
  const sourceIds = [...new Set(sourceChurchIds.filter((id) => id !== targetChurchId))];
  const [target, sources, camperCounts, workerCounts, leaderCounts, payments] = await Promise.all([
    prisma.church.findUnique({ where: { id: targetChurchId }, select: { id: true, name: true, pastorName: true, mergedIntoChurchId: true } }),
    prisma.church.findMany({
      where: { id: { in: sourceIds }, mergedIntoChurchId: null },
      include: { aliases: { select: { id: true, name: true, pastorName: true } } },
    }),
    prisma.camper.groupBy({ by: ["churchId", "campYearId"], where: { churchId: { in: sourceIds } }, _count: { _all: true } }),
    prisma.worker.groupBy({ by: ["churchId", "campYearId"], where: { churchId: { in: sourceIds } }, _count: { _all: true } }),
    prisma.dormLeader.groupBy({ by: ["churchId", "campYearId"], where: { churchId: { in: sourceIds } }, _count: { _all: true } }),
    prisma.churchPayment.findMany({
      where: { churchId: { in: sourceIds } },
      select: { id: true, churchId: true, campYearId: true, amountReceivedCents: true, voidedAt: true },
    }),
  ]);
  return { target, sources, affected: { campers: camperCounts, workers: workerCounts, leaders: leaderCounts, payments } };
}

adminChurchesRouter.post("/merge/preview", async (req, res, next) => {
  const parsed = mergeBody.omit({ confirm: true }).safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request" });
    return;
  }
  try {
    const preview = await mergePreview(parsed.data.sourceChurchIds, parsed.data.targetChurchId);
    if (!preview.target || preview.target.mergedIntoChurchId
      || preview.sources.length !== new Set(parsed.data.sourceChurchIds.filter((id) => id !== parsed.data.targetChurchId)).size) {
      res.status(404).json({ error: "One or more active churches were not found" });
      return;
    }
    res.json(preview);
  } catch (error) {
    next(error);
  }
});

adminChurchesRouter.post("/merge", async (req: AuthedRequest, res, next) => {
  const parsed = mergeBody.required({ confirm: true }).safeParse(req.body);
  if (!parsed.success || !req.adminUser) {
    res.status(400).json({ error: "A confirmed merge request is required" });
    return;
  }
  const sourceIds = [...new Set(parsed.data.sourceChurchIds.filter((id) => id !== parsed.data.targetChurchId))];
  try {
    const preview = await mergePreview(sourceIds, parsed.data.targetChurchId);
    if (!preview.target || preview.target.mergedIntoChurchId || preview.sources.length !== sourceIds.length) {
      res.status(404).json({ error: "One or more active churches were not found" });
      return;
    }
    const aliasPairs = preview.sources.flatMap((source) => source.aliases.map((alias) => alias.id));
    const result = await prisma.$transaction(async (tx) => {
      const sourceAliases = await tx.churchAlias.findMany({ where: { id: { in: aliasPairs } } });
      for (const alias of sourceAliases) {
        const collision = await tx.churchAlias.findUnique({
          where: {
            normalizedName_normalizedPastorName: {
              normalizedName: alias.normalizedName,
              normalizedPastorName: alias.normalizedPastorName,
            },
          },
        });
        if (collision && !sourceIds.includes(collision.churchId) && collision.churchId !== parsed.data.targetChurchId) {
          throw new Error("alias_collision");
        }
      }
      const [camperResult, workerResult, submissionResult, leaderResult, paymentResult] = await Promise.all([
        tx.camper.updateMany({ where: { churchId: { in: sourceIds } }, data: { churchId: parsed.data.targetChurchId } }),
        tx.worker.updateMany({ where: { churchId: { in: sourceIds } }, data: { churchId: parsed.data.targetChurchId } }),
        tx.workerRegistrationSubmission.updateMany({ where: { churchId: { in: sourceIds } }, data: { churchId: parsed.data.targetChurchId } }),
        tx.dormLeader.updateMany({ where: { churchId: { in: sourceIds } }, data: { churchId: parsed.data.targetChurchId } }),
        tx.churchPayment.updateMany({ where: { churchId: { in: sourceIds } }, data: { churchId: parsed.data.targetChurchId } }),
      ]);
      await tx.churchAlias.updateMany({
        where: { churchId: { in: sourceIds } },
        data: { churchId: parsed.data.targetChurchId },
      });
      await tx.church.updateMany({
        where: { id: { in: sourceIds }, mergedIntoChurchId: null },
        data: { mergedIntoChurchId: parsed.data.targetChurchId, reviewedAt: new Date() },
      });
      await tx.church.update({ where: { id: parsed.data.targetChurchId }, data: { reviewedAt: new Date() } });
      const affected = {
        churchIds: sourceIds,
        camperCount: camperResult.count,
        workerCount: workerResult.count,
        submissionCount: submissionResult.count,
        leaderCount: leaderResult.count,
        paymentCount: paymentResult.count,
      };
      await tx.churchAuditLog.create({
        data: {
          actorAdminUserId: req.adminUser!.id,
          action: "merge",
          sourceChurchId: sourceIds[0],
          targetChurchId: parsed.data.targetChurchId,
          affectedRecordIds: affectedJson(affected),
          details: affectedJson({ sourceChurchIds: sourceIds }),
        },
      });
      return affected;
    });
    writeOpsLog("churches_merged", {
      actorAdminUserId: req.adminUser.id,
      sourceChurchIds: sourceIds,
      targetChurchId: parsed.data.targetChurchId,
    });
    res.json(result);
  } catch (error) {
    if (error instanceof Error && error.message === "alias_collision") {
      res.status(409).json({ error: "An alias belongs to another church; remap it before merging" });
      return;
    }
    next(error);
  }
});

adminChurchesRouter.get("/:churchId/details", async (req, res, next) => {
  const parsedId = uuid.safeParse(req.params.churchId);
  const parsedQuery = z.object({ campYearId: uuid }).safeParse(req.query);
  if (!parsedId.success || !parsedQuery.success) {
    res.status(400).json({ error: "Invalid request" });
    return;
  }
  try {
    const church = await ensureActiveChurch(parsedId.data);
    if (!church) {
      res.status(404).json({ error: "Church not found" });
      return;
    }
    const [campers, payments] = await Promise.all([
      prisma.camper.findMany({
        where: {
          churchId: church.id,
          campYearId: parsedQuery.data.campYearId,
          archivedAt: null,
          OR: [
            { familyRegistrationId: null },
            { familyRegistration: { state: "confirmed" } },
          ],
        },
        select: {
          id: true, firstName: true, lastName: true, guardianName: true,
          guardianEmail: true, feeDueCents: true, feePaidCents: true,
          checkInStatus: true,
          familyRegistration: {
            select: {
              id: true, guardianName: true, merchandiseSubtotalCents: true,
              amountPaidCents: true, paymentStatus: true,
            },
          },
        },
        orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
      }),
      prisma.churchPayment.findMany({
        where: { churchId: church.id, campYearId: parsedQuery.data.campYearId },
        include: {
          enteredBy: { select: { id: true, username: true } },
          voidedBy: { select: { id: true, username: true } },
          allocations: {
            include: { camper: { select: { id: true, firstName: true, lastName: true } } },
          },
        },
        orderBy: [{ receivedDate: "desc" }, { createdAt: "desc" }],
      }),
    ]);
    res.json({
      church,
      campers: campers.map((camper) => {
        const remaining = remainingRegistrationFeeCents(camper);
        const registration = camper.familyRegistration;
        const merchandisePaid = registration?.paymentStatus === CamperPaymentStatus.paid_stripe
          ? registration.merchandiseSubtotalCents
          : 0;
        return {
          ...camper,
          remainingRegistrationFeeCents: remaining,
          balanceState: amountBalanceState(camper),
          familyMerchandiseBalanceCents: registration
            ? Math.max(registration.merchandiseSubtotalCents - merchandisePaid, 0)
            : 0,
        };
      }),
      payments,
    });
  } catch (error) {
    next(error);
  }
});

const paymentBody = z.object({
  campYearId: uuid,
  tender: z.nativeEnum(ChurchPaymentTender),
  amountReceivedCents: z.number().int().positive(),
  receivedDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  referenceNumber: z.string().trim().max(100).optional().nullable(),
  notes: z.string().trim().max(4_000).optional().nullable(),
  idempotencyKey: uuid,
  allocations: z.array(z.object({
    camperId: uuid,
    appliedAmountCents: z.number().int().positive(),
  }).strict()).min(1).max(500),
}).strict().superRefine((payment, ctx) => {
  if (payment.tender === ChurchPaymentTender.check && !payment.referenceNumber?.trim()) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["referenceNumber"], message: "Check number is required" });
  }
  if (new Set(payment.allocations.map((allocation) => allocation.camperId)).size !== payment.allocations.length) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["allocations"], message: "Each camper may appear once" });
  }
  const allocated = payment.allocations.reduce((sum, allocation) => sum + allocation.appliedAmountCents, 0);
  if (allocated !== payment.amountReceivedCents) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["amountReceivedCents"], message: "The full payment must be allocated" });
  }
});

adminChurchesRouter.post("/:churchId/payments", async (req: AuthedRequest, res, next) => {
  const parsedId = uuid.safeParse(req.params.churchId);
  const parsed = paymentBody.safeParse(req.body);
  if (!parsedId.success || !parsed.success || !req.adminUser) {
    res.status(400).json({
      error: "Invalid payment",
      fields: parsed.success ? undefined : parsed.error.issues.map((issue) => ({
        path: issue.path.join("."),
        message: issue.message,
      })),
    });
    return;
  }
  try {
    const replay = await prisma.churchPayment.findUnique({
      where: { idempotencyKey: parsed.data.idempotencyKey },
      include: { allocations: true },
    });
    if (replay) {
      const same = replay.churchId === parsedId.data
        && replay.campYearId === parsed.data.campYearId
        && replay.tender === parsed.data.tender
        && replay.amountReceivedCents === parsed.data.amountReceivedCents
        && replay.allocations.length === parsed.data.allocations.length
        && parsed.data.allocations.every((allocation) => replay.allocations.some((stored) =>
          stored.camperId === allocation.camperId
          && stored.appliedAmountCents === allocation.appliedAmountCents));
      if (!same) {
        res.status(409).json({ error: "Idempotency key was already used for another payment" });
        return;
      }
      res.json({ payment: replay, replayed: true });
      return;
    }
    const church = await ensureActiveChurch(parsedId.data);
    if (!church) {
      res.status(404).json({ error: "Church not found" });
      return;
    }
    const payment = await prisma.$transaction(async (tx) => {
      const camperIds = parsed.data.allocations.map((allocation) => allocation.camperId);
      const campers = await tx.camper.findMany({
        where: {
          id: { in: camperIds },
          campYearId: parsed.data.campYearId,
          churchId: church.id,
          archivedAt: null,
          OR: [
            { familyRegistrationId: null },
            { familyRegistration: { state: "confirmed" } },
          ],
        },
        select: {
          id: true, feeDueCents: true, feePaidCents: true, familyRegistrationId: true,
        },
      });
      if (campers.length !== camperIds.length) throw new Error("invalid_camper");
      const camperById = new Map(campers.map((camper) => [camper.id, camper]));
      for (const allocation of parsed.data.allocations) {
        const camper = camperById.get(allocation.camperId)!;
        if (allocation.appliedAmountCents > remainingRegistrationFeeCents(camper)) {
          throw new Error("over_allocation");
        }
      }
      const created = await tx.churchPayment.create({
        data: {
          churchId: church.id,
          campYearId: parsed.data.campYearId,
          tender: parsed.data.tender,
          amountReceivedCents: parsed.data.amountReceivedCents,
          receivedDate: new Date(`${parsed.data.receivedDate}T12:00:00.000Z`),
          referenceNumber: parsed.data.referenceNumber || null,
          notes: parsed.data.notes || null,
          enteredByAdminUserId: req.adminUser!.id,
          idempotencyKey: parsed.data.idempotencyKey,
          allocations: { create: parsed.data.allocations },
        },
        include: { allocations: true },
      });
      const familyIds = new Set<string>();
      for (const allocation of parsed.data.allocations) {
        const camper = camperById.get(allocation.camperId)!;
        const paidAfter = (camper.feePaidCents ?? 0) + allocation.appliedAmountCents;
        const due = camper.feeDueCents ?? 0;
        await tx.camper.update({
          where: { id: camper.id },
          data: {
            feePaidCents: paidAfter,
            paymentStatus: paidAfter >= due
              ? parsed.data.tender === ChurchPaymentTender.check
                ? CamperPaymentStatus.paid_church_check
                : CamperPaymentStatus.paid_church_cash
              : undefined,
          },
        });
        if (camper.familyRegistrationId) familyIds.add(camper.familyRegistrationId);
      }
      for (const familyId of familyIds) {
        await syncFamilyRegistrationBalance(tx, familyId, parsed.data.tender);
      }
      return created;
    }, { isolationLevel: "Serializable" });
    writeOpsLog("church_payment_recorded", {
      actorAdminUserId: req.adminUser.id,
      churchId: church.id,
      campYearId: parsed.data.campYearId,
      paymentId: payment.id,
      tender: payment.tender,
      amountReceivedCents: payment.amountReceivedCents,
      allocationCount: payment.allocations.length,
    });
    res.status(201).json({ payment, replayed: false });
  } catch (error) {
    if (error instanceof Error && error.message === "invalid_camper") {
      res.status(409).json({ error: "Every allocation must reference an active confirmed camper at this church and camp year" });
      return;
    }
    if (error instanceof Error && error.message === "over_allocation") {
      res.status(409).json({ error: "An allocation exceeds the camper's remaining registration-fee balance" });
      return;
    }
    next(error);
  }
});

const voidBody = z.object({ reason: z.string().trim().min(3).max(2_000) }).strict();

adminChurchesRouter.post("/payments/:paymentId/void", async (req: AuthedRequest, res, next) => {
  const parsedId = uuid.safeParse(req.params.paymentId);
  const parsed = voidBody.safeParse(req.body);
  if (!parsedId.success || !parsed.success || !req.adminUser) {
    res.status(400).json({ error: "A payment and reversal reason are required" });
    return;
  }
  try {
    const result = await prisma.$transaction(async (tx) => {
      const payment = await tx.churchPayment.findUnique({
        where: { id: parsedId.data },
        include: { allocations: true },
      });
      if (!payment) throw new Error("payment_not_found");
      if (payment.voidedAt) return { payment, replayed: true };
      const camperIds = payment.allocations.map((allocation) => allocation.camperId);
      const laterAllocation = await tx.churchPaymentAllocation.findFirst({
        where: {
          camperId: { in: camperIds },
          createdAt: { gt: payment.createdAt },
          churchPayment: { voidedAt: null },
        },
        select: { id: true },
      });
      if (laterAllocation) throw new Error("later_allocation_conflict");
      const campers = await tx.camper.findMany({
        where: { id: { in: camperIds } },
        select: { id: true, feePaidCents: true, familyRegistrationId: true, paymentStatus: true },
      });
      const byId = new Map(campers.map((camper) => [camper.id, camper]));
      for (const allocation of payment.allocations) {
        const camper = byId.get(allocation.camperId);
        if (!camper || (camper.feePaidCents ?? 0) < allocation.appliedAmountCents) {
          throw new Error("negative_balance_conflict");
        }
      }
      const familyIds = new Set<string>();
      for (const allocation of payment.allocations) {
        const camper = byId.get(allocation.camperId)!;
        await tx.camper.update({
          where: { id: camper.id },
          data: {
            feePaidCents: (camper.feePaidCents ?? 0) - allocation.appliedAmountCents,
            paymentStatus: camper.paymentStatus === CamperPaymentStatus.paid_church_check
              || camper.paymentStatus === CamperPaymentStatus.paid_church_cash
              ? CamperPaymentStatus.unpaid
              : undefined,
          },
        });
        if (camper.familyRegistrationId) familyIds.add(camper.familyRegistrationId);
      }
      const voided = await tx.churchPayment.update({
        where: { id: payment.id },
        data: {
          voidedAt: new Date(),
          voidedByAdminUserId: req.adminUser!.id,
          voidReason: parsed.data.reason,
        },
        include: { allocations: true },
      });
      for (const familyId of familyIds) await syncFamilyRegistrationBalance(tx, familyId);
      return { payment: voided, replayed: false };
    }, { isolationLevel: "Serializable" });
    writeOpsLog("church_payment_voided", {
      actorAdminUserId: req.adminUser.id,
      paymentId: result.payment.id,
      replayed: result.replayed,
    });
    res.json(result);
  } catch (error) {
    if (error instanceof Error && error.message === "payment_not_found") {
      res.status(404).json({ error: "Payment not found" });
      return;
    }
    if (error instanceof Error && error.message === "later_allocation_conflict") {
      res.status(409).json({ error: "A later church payment depends on this balance. Void the later payment first." });
      return;
    }
    if (error instanceof Error && error.message === "negative_balance_conflict") {
      res.status(409).json({ error: "Reversal would produce a negative paid amount" });
      return;
    }
    next(error);
  }
});
