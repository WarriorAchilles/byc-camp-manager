import prismaClientPkg, { Prisma } from "@prisma/client";
import { raw, Router, type Response } from "express";
import { z } from "zod";
import { prisma } from "../db.js";
import { getActiveCampYearId } from "../lib/activeCampYearSetting.js";
import {
  agreementSnapshot,
  camperRequiresMedicalConsent,
  FAMILY_RESERVATION_MINUTES,
  familySubmissionSchema,
  MEDICAL_AGREEMENT_TEXT,
  MEDICAL_AGREEMENT_VERSION,
  LEGAL_ACKNOWLEDGMENT_TEXT,
  safeRequestIp,
  STATE_PROVINCE_OPTIONS,
  CAMPER_T_SHIRT_SIZES,
  submissionDigest,
  type FamilySubmission,
} from "../lib/familyRegistration.js";
import {
  resolveRegistrationAvailability,
  type RegistrationFlow,
} from "../lib/registrationAvailability.js";
import { createPublicRateLimit } from "../middleware/publicRateLimit.js";
import { calculateRegistrationPricing, PricingError } from "../lib/registrationPricing.js";
import { createPendingFamilyRegistrationSnapshot } from "../lib/pendingFamilyRegistration.js";
import {
  confirmFamilyRegistrationCash,
  createFamilyRegistrationCheckoutSession,
  getStripeRuntime,
  reconcileFamilyRegistrationCheckout,
  stripeNotConfiguredError,
} from "../lib/stripeCheckout.js";
import {
  normalizedPhone,
  workerSubmissionDigest,
  workerSubmissionSchema,
  WORKER_CONFIRMATION_GUIDANCE,
  WORKER_GENDERS,
  WORKER_STATE_PROVINCE_OPTIONS,
  WORKER_TASK_GUIDANCE,
  WORKER_TASK_OPTIONS,
  WORKER_T_SHIRT_GUIDANCE,
  WORKER_T_SHIRT_SIZES,
  type WorkerSubmission,
} from "../lib/workerRegistration.js";
import {
  LEADER_GENDERS,
  LEADER_MARITAL_STATUSES,
  LEADER_STATE_PROVINCE_OPTIONS,
  LEADER_T_SHIRT_GUIDANCE,
  LEADER_T_SHIRT_SIZES,
  leaderSubmissionDigest,
  leaderSubmissionSchema,
  type LeaderSubmission,
} from "../lib/leaderRegistration.js";
import {
  dispatchLeaderRegistrationConfirmation,
  dispatchWorkerRegistrationConfirmation,
} from "../lib/registrationConfirmationMail.js";
import { resolveChurchPair, suggestChurches } from "../lib/churchIdentity.js";
import {
  CAMPER_PHOTO_MAX_BYTES,
  hasExpectedImageSignature,
  isCamperPhotoContentType,
} from "../lib/camperPhoto.js";

const availabilityLimit = createPublicRateLimit({ limit: 120, windowMs: 60_000 });
const submissionLimit = createPublicRateLimit({ limit: 10, windowMs: 60_000 });
const photoUploadLimit = createPublicRateLimit({ limit: 24, windowMs: 60_000 });
const { ImportSource, RegistrationState, WorkerRegistrationSubmissionStatus } = prismaClientPkg;

export const publicRegistrationRouter = Router();
publicRegistrationRouter.use(availabilityLimit);

publicRegistrationRouter.get("/church-suggestions", async (req, res, next) => {
  const parsed = z.string().trim().min(2).max(100).safeParse(req.query.q);
  if (!parsed.success) {
    res.status(400).json({ error: "Query must contain 2 to 100 characters" });
    return;
  }
  try {
    const churches = await suggestChurches(prisma, parsed.data, 8);
    res.setHeader("Cache-Control", "public, max-age=30");
    res.json({ churches });
  } catch (error) {
    next(error);
  }
});

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
      leaderRegistrationOpensAt: true,
      leaderRegistrationClosesAt: true,
      leaderRegistrationEnabled: true,
      leaderRegistrationHeaderContent: true,
      leaderRegistrationClosedMessage: true,
    },
  });
  if (!year) {
    res.json({ flow, state: "not_configured", serverTime: now.toISOString(), camp: null });
    return;
  }

  let activeCamperCount = 0;
  if (flow === "family") {
    const [storedCamperCount, pendingReservations] = await Promise.all([
      prisma.camper.count({
        where: {
          campYearId: year.id,
          archivedAt: null,
          OR: [
            { familyRegistrationId: null },
            { familyRegistration: { state: RegistrationState.confirmed } },
            {
              familyRegistration: {
                state: RegistrationState.pending_payment,
                OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
              },
            },
          ],
        },
      }),
      prisma.familyRegistration.aggregate({
        where: {
          campYearId: year.id,
          state: RegistrationState.pending_payment,
          OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
        },
        _sum: { pendingCamperCount: true },
      }),
    ]);
    activeCamperCount = storedCamperCount + (pendingReservations._sum.pendingCamperCount ?? 0);
  }
  const opensAt = flow === "family"
    ? year.familyRegistrationOpensAt
    : flow === "worker"
      ? year.workerRegistrationOpensAt
      : year.leaderRegistrationOpensAt;
  const closesAt = flow === "family"
    ? year.familyRegistrationClosesAt
    : flow === "worker"
      ? year.workerRegistrationClosesAt
      : year.leaderRegistrationClosesAt;
  const manuallyEnabled = flow === "family"
    ? year.familyRegistrationEnabled
    : flow === "worker"
      ? year.workerRegistrationEnabled
      : year.leaderRegistrationEnabled;
  const state = resolveRegistrationAvailability({
    flow,
    manuallyEnabled,
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
    headerContent: flow === "family"
      ? year.familyRegistrationHeaderContent
      : flow === "worker"
        ? year.workerRegistrationHeaderContent
        : year.leaderRegistrationHeaderContent,
    closedMessage: flow === "family"
      ? year.familyRegistrationClosedMessage
      : flow === "worker"
        ? year.workerRegistrationClosedMessage
        : year.leaderRegistrationClosedMessage,
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

const photoSubmissionKeySchema = z.string().uuid();

publicRegistrationRouter.post(
  "/family/photos",
  photoUploadLimit,
  raw({ type: () => true, limit: CAMPER_PHOTO_MAX_BYTES }),
  async (req, res, next) => {
    const submissionKey = photoSubmissionKeySchema.safeParse(req.query.submission_key);
    const contentType = (req.headers["content-type"] ?? "").split(";")[0]!.trim().toLowerCase();
    if (!submissionKey.success) {
      res.status(400).json({ error: "invalid_submission_key" });
      return;
    }
    if (!isCamperPhotoContentType(contentType)) {
      res.status(415).json({ error: "unsupported_photo_type" });
      return;
    }
    if (!Buffer.isBuffer(req.body) || req.body.length === 0) {
      res.status(400).json({ error: "empty_photo" });
      return;
    }
    if (!hasExpectedImageSignature(req.body, contentType)) {
      res.status(400).json({ error: "invalid_photo" });
      return;
    }

    try {
      const activeCampYearId = await getActiveCampYearId(prisma);
      const camp = activeCampYearId
        ? await prisma.campYear.findUnique({
          where: { id: activeCampYearId },
          select: {
            id: true,
            familyRegistrationEnabled: true,
            familyRegistrationOpensAt: true,
            familyRegistrationClosesAt: true,
          },
        })
        : null;
      const now = new Date();
      const availability = camp
        ? resolveRegistrationAvailability({
          flow: "family",
          manuallyEnabled: camp.familyRegistrationEnabled,
          opensAt: camp.familyRegistrationOpensAt,
          closesAt: camp.familyRegistrationClosesAt,
        }, now)
        : "not_configured";
      if (!camp || availability !== "open") {
        res.status(409).json({ error: "registration_closed" });
        return;
      }

      await prisma.camperPhotoUpload.deleteMany({
        where: {
          createdAt: { lt: new Date(now.getTime() - 24 * 60 * 60_000) },
        },
      });
      const upload = await prisma.camperPhotoUpload.create({
        data: {
          campYearId: camp.id,
          submissionKey: submissionKey.data,
          contentType,
          data: Uint8Array.from(req.body),
        },
        select: { id: true },
      });
      res.status(201).json({ photoUploadId: upload.id });
    } catch (error) {
      next(error);
    }
  },
);

function isRetryableTransactionError(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "P2034";
}

function isUniqueConstraintError(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "P2002";
}

class SubmissionError extends Error {
  constructor(public readonly status: number, public readonly code: string, public readonly details?: unknown) {
    super(code);
  }
}

export async function persistFamilySubmission(
  input: FamilySubmission,
  requestIp: string,
  now: Date,
  options: { afterCreate?: () => void } = {},
) {
  const digest = submissionDigest(input);
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await prisma.$transaction(async (tx) => {
        const existing = await tx.familyRegistration.findUnique({
          where: { submissionKey: input.submissionKey },
          select: {
            id: true,
            submissionDigest: true,
            state: true,
            expiresAt: true,
            totalDueCents: true,
            registrationSubtotalCents: true,
            merchandiseSubtotalCents: true,
            discountCents: true,
            pendingCamperCount: true,
            campers: { select: { id: true } },
            receiptLineItems: { orderBy: { sortOrder: "asc" } },
          },
        });
        if (existing) {
          if (existing.submissionDigest !== digest) {
            throw new SubmissionError(409, "submission_key_reused");
          }
          if (existing.state === RegistrationState.expired || existing.state === RegistrationState.cancelled) {
            throw new SubmissionError(410, "submission_expired");
          }
          return { registration: existing, replayed: true };
        }

        await tx.familyRegistration.updateMany({
          where: {
            state: RegistrationState.pending_payment,
            expiresAt: { lte: now },
          },
          data: { state: RegistrationState.expired },
        });

        const activeCampYearId = await getActiveCampYearId(tx);
        if (!activeCampYearId) throw new SubmissionError(409, "registration_not_configured");
        const camp = await tx.campYear.findUnique({ where: { id: activeCampYearId } });
        if (!camp) throw new SubmissionError(409, "registration_not_configured");

        const [storedCamperCount, pendingReservations] = await Promise.all([
          tx.camper.count({
            where: {
              campYearId: camp.id,
              archivedAt: null,
              OR: [
                { familyRegistrationId: null },
                {
                  familyRegistration: {
                    state: RegistrationState.pending_payment,
                    OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
                  },
                },
                { familyRegistration: { state: RegistrationState.confirmed } },
              ],
            },
          }),
          tx.familyRegistration.aggregate({
            where: {
              campYearId: camp.id,
              state: RegistrationState.pending_payment,
              OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
            },
            _sum: { pendingCamperCount: true },
          }),
        ]);
        const activeCamperCount =
          storedCamperCount + (pendingReservations._sum.pendingCamperCount ?? 0);
        const availability = resolveRegistrationAvailability({
          flow: "family",
          manuallyEnabled: camp.familyRegistrationEnabled,
          opensAt: camp.familyRegistrationOpensAt,
          closesAt: camp.familyRegistrationClosesAt,
          camperCapacity: camp.camperCapacity,
          activeCamperCount,
        }, now);
        if (availability !== "open") {
          throw new SubmissionError(409, availability === "capacity_reached" ? "capacity_reached" : "registration_closed");
        }
        if (camp.camperCapacity !== null && activeCamperCount + input.campers.length > camp.camperCapacity) {
          throw new SubmissionError(409, "capacity_reached", {
            remaining: Math.max(0, camp.camperCapacity - activeCamperCount),
          });
        }

        const photoUploadIds = input.campers
          .map((camper) => camper.photoUploadId)
          .filter((id): id is string => Boolean(id));
        if (photoUploadIds.length > 0) {
          const uploads = await tx.camperPhotoUpload.findMany({
            where: {
              id: { in: photoUploadIds },
              submissionKey: input.submissionKey,
              campYearId: camp.id,
              familyRegistrationId: null,
            },
            select: { id: true },
          });
          if (uploads.length !== photoUploadIds.length) {
            throw new SubmissionError(400, "invalid_photo_upload");
          }
        }

        const merchandiseItems = await tx.merchandiseItem.findMany({
          where: { campYearId: camp.id, id: { in: input.merchandiseSelections.map((line) => line.merchandiseItemId) } },
        });
        let pricing;
        try {
          pricing = calculateRegistrationPricing({
            camp,
            campers: input.campers,
            merchandiseSelections: input.merchandiseSelections,
            merchandiseItems,
            now,
          });
        } catch (error) {
          if (error instanceof PricingError) throw new SubmissionError(400, error.code);
          throw error;
        }
        const coveredCampers = input.registrationType === "family"
          ? input.campers.filter((camper) => camperRequiresMedicalConsent(
            camper.dateOfBirth,
            camp.startDate,
          ))
          : [];
        const legal = coveredCampers.length > 0 ? input.legal : null;
        if (coveredCampers.length > 0 && legal?.agreementVersion !== MEDICAL_AGREEMENT_VERSION) {
          throw new SubmissionError(400, "medical_consent_required");
        }
        const snapshot = legal
          ? agreementSnapshot(coveredCampers.map((camper) => `${camper.firstName} ${camper.lastName}`))
          : null;
        const registration = await tx.familyRegistration.create({
          data: {
            submissionKey: input.submissionKey,
            submissionDigest: digest,
            pendingSubmissionSnapshot: createPendingFamilyRegistrationSnapshot(
              input,
              pricing.camperFees,
            ),
            pendingCamperCount: input.campers.length,
            campYearId: camp.id,
            state: RegistrationState.pending_payment,
            guardianName: input.guardian.fullName,
            guardianEmail: input.guardian.email,
            guardianPhone: input.guardian.phone,
            guardianRelationship: input.guardian.relationship,
            streetAddress: input.guardian.address.streetAddress,
            city: input.guardian.address.city,
            stateOrProvince: input.guardian.address.stateOrProvince,
            postalCode: input.guardian.address.postalCode,
            country: input.guardian.address.country,
            registrationSubtotalCents: pricing.registrationSubtotalCents,
            merchandiseSubtotalCents: pricing.merchandiseSubtotalCents,
            discountCents: pricing.discountCents,
            totalDueCents: pricing.totalDueCents,
            pricingSnapshot: pricing.pricingSnapshot,
            agreementVersion: legal?.agreementVersion ?? null,
            agreementTextSnapshot: snapshot,
            signatureMethod: legal ? "typed" : null,
            signatureData: legal?.typedName ?? null,
            legalAcknowledged: legal !== null,
            signedAt: legal ? now : null,
            requestIp: legal ? safeRequestIp(requestIp) : null,
            expiresAt: new Date(now.getTime() + FAMILY_RESERVATION_MINUTES * 60_000),
            receiptLineItems: {
              create: pricing.receiptLines.map((line) => ({
                ...line,
                pricingSnapshot: line.pricingSnapshot as Prisma.InputJsonValue,
              })),
            },
            merchandiseOrderLines: {
              create: pricing.merchandiseLines.map((line) => ({
                merchandiseItemId: line.merchandiseItemId,
                pendingCamperIndex: line.camperIndex,
                ownership: line.ownership,
                itemNameSnapshot: line.itemNameSnapshot,
                selectedOptionsSnapshot: line.selectedOptionsSnapshot ?? Prisma.JsonNull,
                quantity: line.quantity,
                unitPriceCents: line.unitPriceCents,
                lineTotalCents: line.lineTotalCents,
              })),
            },
          },
          select: {
            id: true,
            state: true,
            expiresAt: true,
            totalDueCents: true,
            registrationSubtotalCents: true,
            merchandiseSubtotalCents: true,
            discountCents: true,
            pendingCamperCount: true,
            campers: { select: { id: true } },
            receiptLineItems: { orderBy: { sortOrder: "asc" } },
          },
        });
        if (photoUploadIds.length > 0) {
          const attached = await tx.camperPhotoUpload.updateMany({
            where: {
              id: { in: photoUploadIds },
              submissionKey: input.submissionKey,
              campYearId: camp.id,
              familyRegistrationId: null,
            },
            data: { familyRegistrationId: registration.id },
          });
          if (attached.count !== photoUploadIds.length) {
            throw new SubmissionError(409, "photo_upload_conflict");
          }
        }
        options.afterCreate?.();
        return { registration, replayed: false };
      }, { isolationLevel: "Serializable" });
    } catch (error) {
      if (isRetryableTransactionError(error) && attempt < 2) continue;
      throw error;
    }
  }
  throw new SubmissionError(409, "submission_conflict");
}

publicRegistrationRouter.post("/family", submissionLimit, async (req, res, next) => {
  const parsed = familySubmissionSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      error: "validation_failed",
      fields: parsed.error.issues.map((issue) => ({ path: issue.path.join("."), message: issue.message })),
    });
    return;
  }
  if (
    parsed.data.legal
    && parsed.data.legal.typedName.toLocaleLowerCase() !== parsed.data.guardian.fullName.toLocaleLowerCase()
  ) {
    res.status(400).json({
      error: "validation_failed",
      fields: [{
        path: "legal.typedName",
        message: "Signature must match the parent or guardian full name",
      }],
    });
    return;
  }
  try {
    const result = await persistFamilySubmission(
      parsed.data,
      req.ip || req.socket.remoteAddress || "unknown",
      new Date(),
    );
    res.status(result.replayed ? 200 : 201).json({
      registrationId: result.registration.id,
      state: result.registration.state,
      camperCount:
        result.registration.pendingCamperCount || result.registration.campers.length,
      expiresAt: "expiresAt" in result.registration ? result.registration.expiresAt : null,
      replayed: result.replayed,
      receipt: {
        registrationSubtotalCents: result.registration.registrationSubtotalCents,
        merchandiseSubtotalCents: result.registration.merchandiseSubtotalCents,
        discountCents: result.registration.discountCents,
        totalDueCents: result.registration.totalDueCents,
        lineItems: result.registration.receiptLineItems,
      },
    });
  } catch (error) {
    if (error instanceof SubmissionError) {
      res.status(error.status).json({ error: error.code, details: error.details });
      return;
    }
    next(error);
  }
});

publicRegistrationRouter.get("/family/form-options", async (_req, res, next) => {
  try {
    const activeCampYearId = await getActiveCampYearId(prisma);
    const activeCampYear = activeCampYearId
      ? await prisma.campYear.findUnique({
        where: { id: activeCampYearId },
        select: { startDate: true },
      })
      : null;
    const merchandiseItems = activeCampYearId
      ? await prisma.merchandiseItem.findMany({
        where: { campYearId: activeCampYearId, isActive: true },
        orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
        select: {
          id: true,
          name: true,
          description: true,
          priceCents: true,
          availableOptions: true,
          ownership: true,
        },
      })
      : [];
    res.setHeader("Cache-Control", "public, max-age=300");
    res.json({
      campStartDate: activeCampYear?.startDate.toISOString() ?? null,
      genders: ["male", "female"],
      stateOrProvinceOptions: STATE_PROVINCE_OPTIONS,
      tShirtSizes: CAMPER_T_SHIRT_SIZES,
      medicalAgreement: {
        version: MEDICAL_AGREEMENT_VERSION,
        text: MEDICAL_AGREEMENT_TEXT,
        acknowledgmentText: LEGAL_ACKNOWLEDGMENT_TEXT,
        signatureMethod: "typed",
      },
      merchandiseItems,
    });
  } catch (error) {
    next(error);
  }
});

const registrationIdSchema = z.string().uuid();

async function registrationReceipt(registrationId: string) {
  return prisma.familyRegistration.findUnique({
    where: { id: registrationId },
    select: {
      id: true,
      state: true,
      paymentMethod: true,
      paymentStatus: true,
      registrationSubtotalCents: true,
      merchandiseSubtotalCents: true,
      discountCents: true,
      totalDueCents: true,
      amountPaidCents: true,
      expiresAt: true,
      confirmedAt: true,
      receiptLineItems: { orderBy: { sortOrder: "asc" } },
      merchandiseOrderLines: { orderBy: { createdAt: "asc" } },
    },
  });
}

publicRegistrationRouter.get("/family/:registrationId", async (req, res, next) => {
  const parsedId = registrationIdSchema.safeParse(req.params.registrationId);
  if (!parsedId.success) {
    res.status(400).json({ error: "invalid_registration_id" });
    return;
  }
  try {
    const sessionId = typeof req.query.session_id === "string" ? req.query.session_id : null;
    if (sessionId) {
      const stripeRuntime = getStripeRuntime();
      if (stripeRuntime) {
        await reconcileFamilyRegistrationCheckout({
          stripeRuntime,
          stripeSessionId: sessionId,
          familyRegistrationId: parsedId.data,
        });
      }
    }
    const registration = await registrationReceipt(parsedId.data);
    if (!registration) {
      res.status(404).json({ error: "registration_not_found" });
      return;
    }
    res.setHeader("Cache-Control", "no-store");
    res.json({ registration });
  } catch (error) {
    next(error);
  }
});

publicRegistrationRouter.post("/family/:registrationId/pay-cash", submissionLimit, async (req, res, next) => {
  const parsedId = registrationIdSchema.safeParse(req.params.registrationId);
  if (!parsedId.success) {
    res.status(400).json({ error: "invalid_registration_id" });
    return;
  }
  try {
    const result = await confirmFamilyRegistrationCash({ familyRegistrationId: parsedId.data });
    if (!result.ok) {
      res.status(result.status).json({ error: result.error });
      return;
    }
    const registration = await registrationReceipt(parsedId.data);
    res.json({ registration });
  } catch (error) {
    next(error);
  }
});

publicRegistrationRouter.post("/family/:registrationId/stripe-checkout", submissionLimit, async (req, res, next) => {
  const parsedId = registrationIdSchema.safeParse(req.params.registrationId);
  if (!parsedId.success) {
    res.status(400).json({ error: "invalid_registration_id" });
    return;
  }
  const stripeRuntime = getStripeRuntime();
  if (!stripeRuntime) {
    res.status(503).json(stripeNotConfiguredError());
    return;
  }
  try {
    const result = await createFamilyRegistrationCheckoutSession({
      familyRegistrationId: parsedId.data,
      stripeRuntime,
    });
    if (!result.ok) {
      res.status(result.status).json({ error: result.error });
      return;
    }
    res.json(result);
  } catch (error) {
    next(error);
  }
});

publicRegistrationRouter.get("/worker", async (_req, res, next) => {
  try { await sendAvailability("worker", res); } catch (error) { next(error); }
});

function workerPersistenceData(
  input: WorkerSubmission,
  campYearId: string,
  submittedAt: Date,
  requestIp: string,
  churchId: string | null,
) {
  return {
    campYearId,
    email: input.email.toLocaleLowerCase(),
    firstName: input.firstName,
    lastName: input.lastName,
    dateOfBirth: input.dateOfBirth ? new Date(`${input.dateOfBirth}T12:00:00.000Z`) : null,
    gender: input.gender,
    cellPhone: input.cellPhone,
    altPhone: input.altPhone || null,
    streetAddress: input.streetAddress,
    city: input.city,
    stateOrProvince: input.stateOrProvince,
    postalCode: input.postalCode,
    country: input.country,
    faithServingResponse: input.faithServingResponse,
    churchName: input.churchName,
    pastorName: input.pastorName,
    churchId,
    pastorPhone: input.pastorPhone,
    taskPreferenceFirst: input.taskPreferences[0],
    taskPreferenceSecond: input.taskPreferences[1],
    taskPreferenceThird: input.taskPreferences[2],
    tShirtSize: input.tShirtSize || null,
    publicSubmittedAt: submittedAt,
    publicSubmissionIp: safeRequestIp(requestIp),
    importSource: ImportSource.online_registration,
  };
}

export async function persistWorkerSubmission(
  input: WorkerSubmission,
  requestIp: string,
  now: Date,
) {
  const digest = workerSubmissionDigest(input);
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await prisma.$transaction(async (tx) => {
        const existing = await tx.workerRegistrationSubmission.findUnique({
          where: { submissionKey: input.submissionKey },
          select: { id: true, submissionDigest: true, status: true, resolvedWorkerId: true },
        });
        if (existing) {
          if (existing.submissionDigest !== digest) {
            throw new SubmissionError(409, "submission_key_reused");
          }
          return { submission: existing, replayed: true };
        }

        const activeCampYearId = await getActiveCampYearId(tx);
        if (!activeCampYearId) throw new SubmissionError(409, "registration_not_configured");
        const camp = await tx.campYear.findUnique({ where: { id: activeCampYearId } });
        if (!camp) throw new SubmissionError(409, "registration_not_configured");
        const availability = resolveRegistrationAvailability({
          flow: "worker",
          manuallyEnabled: camp.workerRegistrationEnabled,
          opensAt: camp.workerRegistrationOpensAt,
          closesAt: camp.workerRegistrationClosesAt,
          camperCapacity: null,
          activeCamperCount: 0,
        }, now);
        if (availability !== "open") {
          throw new SubmissionError(409, "registration_closed");
        }

        const normalizedEmail = input.email.toLocaleLowerCase();
        const potentialMatches = await tx.worker.findMany({
          where: {
            campYearId: camp.id,
            archivedAt: null,
            OR: [
              { email: { equals: normalizedEmail, mode: "insensitive" } },
              {
                firstName: { equals: input.firstName, mode: "insensitive" },
                lastName: { equals: input.lastName, mode: "insensitive" },
              },
            ],
          },
          select: {
            id: true,
            email: true,
            firstName: true,
            lastName: true,
            dateOfBirth: true,
            cellPhone: true,
          },
        });
        const submittedBirthDate = input.dateOfBirth ?? null;
        const likelyMatches = potentialMatches.flatMap((worker) => {
          const emailMatch = worker.email.trim().toLocaleLowerCase() === normalizedEmail;
          const nameMatch = worker.firstName.trim().toLocaleLowerCase() === input.firstName.toLocaleLowerCase()
            && worker.lastName.trim().toLocaleLowerCase() === input.lastName.toLocaleLowerCase();
          const birthDateMatch = Boolean(
            submittedBirthDate
            && worker.dateOfBirth?.toISOString().slice(0, 10) === submittedBirthDate,
          );
          const phoneMatch = normalizedPhone(worker.cellPhone) === normalizedPhone(input.cellPhone);
          if (!emailMatch && !(nameMatch && (birthDateMatch || phoneMatch))) return [];
          return [{
            workerId: worker.id,
            matchReason: emailMatch
              ? "email"
              : birthDateMatch
                ? "name_date_of_birth"
                : "name_cell_phone",
          }];
        });

        const submissionData = {
          submissionKey: input.submissionKey,
          submissionDigest: digest,
          campYearId: camp.id,
          email: normalizedEmail,
          firstName: input.firstName,
          lastName: input.lastName,
          dateOfBirth: input.dateOfBirth ? new Date(`${input.dateOfBirth}T12:00:00.000Z`) : null,
          gender: input.gender,
          cellPhone: input.cellPhone,
          altPhone: input.altPhone || null,
          streetAddress: input.streetAddress,
          city: input.city,
          stateOrProvince: input.stateOrProvince,
          postalCode: input.postalCode,
          country: input.country,
          faithServingResponse: input.faithServingResponse,
          churchName: input.churchName,
          pastorName: input.pastorName,
          pastorPhone: input.pastorPhone,
          taskPreferenceFirst: input.taskPreferences[0],
          taskPreferenceSecond: input.taskPreferences[1],
          taskPreferenceThird: input.taskPreferences[2],
          tShirtSize: input.tShirtSize || null,
          requestIp: safeRequestIp(requestIp),
          submittedAt: now,
        };

        if (likelyMatches.length > 0) {
          const submission = await tx.workerRegistrationSubmission.create({
            data: {
              ...submissionData,
              status: WorkerRegistrationSubmissionStatus.pending_review,
              likelyMatches: {
                create: likelyMatches,
              },
            },
            select: { id: true, status: true, resolvedWorkerId: true },
          });
          return { submission, replayed: false };
        }

        const church = await resolveChurchPair(tx, {
          churchName: input.churchName,
          pastorName: input.pastorName,
          selectedChurchId: input.selectedChurchId,
          createIfMissing: true,
        });
        const worker = await tx.worker.create({
          data: workerPersistenceData(input, camp.id, now, requestIp, church?.id ?? null),
          select: { id: true },
        });
        const submission = await tx.workerRegistrationSubmission.create({
          data: {
            ...submissionData,
            churchId: church?.id ?? null,
            status: WorkerRegistrationSubmissionStatus.created,
            resolvedWorkerId: worker.id,
            resolvedAt: now,
          },
          select: { id: true, status: true, resolvedWorkerId: true },
        });
        return { submission, replayed: false };
      }, { isolationLevel: "Serializable" });
    } catch (error) {
      if (isRetryableTransactionError(error) && attempt < 2) continue;
      if (isUniqueConstraintError(error)) {
        const existing = await prisma.workerRegistrationSubmission.findUnique({
          where: { submissionKey: input.submissionKey },
          select: { id: true, submissionDigest: true, status: true, resolvedWorkerId: true },
        });
        if (existing?.submissionDigest === digest) {
          return { submission: existing, replayed: true };
        }
        throw new SubmissionError(409, "submission_key_reused");
      }
      throw error;
    }
  }
  throw new SubmissionError(409, "submission_conflict");
}

publicRegistrationRouter.get("/worker/form-options", (_req, res) => {
  res.setHeader("Cache-Control", "public, max-age=300");
  res.json({
    genders: WORKER_GENDERS,
    stateOrProvinceOptions: WORKER_STATE_PROVINCE_OPTIONS,
    taskOptions: WORKER_TASK_OPTIONS,
    tShirtSizes: WORKER_T_SHIRT_SIZES,
    taskGuidance: WORKER_TASK_GUIDANCE,
    tShirtGuidance: WORKER_T_SHIRT_GUIDANCE,
    confirmationGuidance: WORKER_CONFIRMATION_GUIDANCE,
  });
});

publicRegistrationRouter.post("/worker", submissionLimit, async (req, res, next) => {
  const parsed = workerSubmissionSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      error: "validation_failed",
      fields: parsed.error.issues.map((issue) => ({
        path: issue.path.join("."),
        message: issue.message,
      })),
    });
    return;
  }
  try {
    const result = await persistWorkerSubmission(
      parsed.data,
      req.ip || req.socket.remoteAddress || "unknown",
      new Date(),
    );
    await dispatchWorkerRegistrationConfirmation(result.submission.id);
    res.status(result.replayed ? 200 : 201).json({
      registrationId: result.submission.id,
      status: "received",
      replayed: result.replayed,
    });
  } catch (error) {
    if (error instanceof SubmissionError) {
      res.status(error.status).json({ error: error.code, details: error.details });
      return;
    }
    next(error);
  }
});

publicRegistrationRouter.get("/leader", async (_req, res, next) => {
  try { await sendAvailability("leader", res); } catch (error) { next(error); }
});

function leaderPersistenceData(
  input: LeaderSubmission,
  campYearId: string,
  submittedAt: Date,
  requestIp: string,
  churchId: string | null,
) {
  return {
    campYearId,
    email: input.email.toLocaleLowerCase(),
    firstName: input.firstName,
    lastName: input.lastName,
    dateOfBirth: new Date(`${input.dateOfBirth}T12:00:00.000Z`),
    gender: input.gender,
    phone: input.cellPhone,
    altPhone: input.altPhone || null,
    streetAddress: input.streetAddress,
    city: input.city,
    stateOrProvince: input.stateOrProvince,
    postalCode: input.postalCode,
    country: input.country,
    maritalStatus: input.maritalStatus,
    faithServingResponse: input.faithServingResponse,
    churchName: input.churchName,
    pastorName: input.pastorName,
    churchId,
    pastorPhone: input.pastorPhone,
    roleLabel: input.ageGroupPreference,
    tShirtSize: input.tShirtSize || null,
    publicSubmittedAt: submittedAt,
    publicSubmissionIp: safeRequestIp(requestIp),
    publicSubmissionKey: input.submissionKey,
    publicSubmissionDigest: leaderSubmissionDigest(input),
    importSource: ImportSource.online_registration,
  };
}

export async function persistLeaderSubmission(
  input: LeaderSubmission,
  requestIp: string,
  now: Date,
) {
  const digest = leaderSubmissionDigest(input);
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await prisma.$transaction(async (tx) => {
        const replay = await tx.dormLeader.findUnique({
          where: { publicSubmissionKey: input.submissionKey },
          select: { id: true, publicSubmissionDigest: true },
        });
        if (replay) {
          if (replay.publicSubmissionDigest !== digest) {
            throw new SubmissionError(409, "submission_key_reused");
          }
          return { leader: replay, replayed: true };
        }

        const activeCampYearId = await getActiveCampYearId(tx);
        if (!activeCampYearId) throw new SubmissionError(409, "registration_not_configured");
        const camp = await tx.campYear.findUnique({ where: { id: activeCampYearId } });
        if (!camp) throw new SubmissionError(409, "registration_not_configured");
        const availability = resolveRegistrationAvailability({
          flow: "leader",
          manuallyEnabled: camp.leaderRegistrationEnabled,
          opensAt: camp.leaderRegistrationOpensAt,
          closesAt: camp.leaderRegistrationClosesAt,
        }, now);
        if (availability !== "open") {
          throw new SubmissionError(409, "registration_closed");
        }

        const normalizedEmail = input.email.toLocaleLowerCase();
        const potentialMatches = await tx.dormLeader.findMany({
          where: {
            campYearId: camp.id,
            archivedAt: null,
            OR: [
              { email: { equals: normalizedEmail, mode: "insensitive" } },
              {
                firstName: { equals: input.firstName, mode: "insensitive" },
                lastName: { equals: input.lastName, mode: "insensitive" },
              },
            ],
          },
          select: { email: true, firstName: true, lastName: true, phone: true },
        });
        const duplicate = potentialMatches.some((leader) => {
          const emailMatch = leader.email.trim().toLocaleLowerCase() === normalizedEmail;
          const nameMatch = leader.firstName.trim().toLocaleLowerCase() === input.firstName.toLocaleLowerCase()
            && leader.lastName.trim().toLocaleLowerCase() === input.lastName.toLocaleLowerCase();
          return emailMatch || (nameMatch && normalizedPhone(leader.phone) === input.cellPhone);
        });
        if (duplicate) {
          throw new SubmissionError(409, "leader_already_registered");
        }

        const church = await resolveChurchPair(tx, {
          churchName: input.churchName,
          pastorName: input.pastorName,
          selectedChurchId: input.selectedChurchId,
          createIfMissing: true,
        });
        const leader = await tx.dormLeader.create({
          data: leaderPersistenceData(input, camp.id, now, requestIp, church?.id ?? null),
          select: { id: true, publicSubmissionDigest: true },
        });
        return { leader, replayed: false };
      }, { isolationLevel: "Serializable" });
    } catch (error) {
      if (isRetryableTransactionError(error) && attempt < 2) continue;
      if (isUniqueConstraintError(error)) {
        const replay = await prisma.dormLeader.findUnique({
          where: { publicSubmissionKey: input.submissionKey },
          select: { id: true, publicSubmissionDigest: true },
        });
        if (replay?.publicSubmissionDigest === digest) {
          return { leader: replay, replayed: true };
        }
        throw new SubmissionError(409, "submission_key_reused");
      }
      throw error;
    }
  }
  throw new SubmissionError(409, "submission_conflict");
}

publicRegistrationRouter.get("/leader/form-options", async (_req, res, next) => {
  try {
    const activeCampYearId = await getActiveCampYearId(prisma);
    const ageGroupOptions = activeCampYearId
      ? (await prisma.ageGroupBracket.findMany({
          where: { campYearId: activeCampYearId, isActive: true },
          select: { minAge: true, maxAge: true },
          orderBy: { sortOrder: "asc" },
        })).map((bracket) =>
          bracket.maxAge === null ? `${bracket.minAge}+` : `${bracket.minAge}-${bracket.maxAge}`,
        )
      : [];
    res.setHeader("Cache-Control", "no-store");
    res.json({
      genders: LEADER_GENDERS,
      stateOrProvinceOptions: LEADER_STATE_PROVINCE_OPTIONS,
      maritalStatuses: LEADER_MARITAL_STATUSES,
      ageGroupOptions,
      tShirtSizes: LEADER_T_SHIRT_SIZES,
      tShirtGuidance: LEADER_T_SHIRT_GUIDANCE,
    });
  } catch (error) {
    next(error);
  }
});

publicRegistrationRouter.post("/leader", submissionLimit, async (req, res, next) => {
  const parsed = leaderSubmissionSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      error: "validation_failed",
      fields: parsed.error.issues.map((issue) => ({
        path: issue.path.join("."),
        message: issue.message,
      })),
    });
    return;
  }
  try {
    const result = await persistLeaderSubmission(
      parsed.data,
      req.ip || req.socket.remoteAddress || "unknown",
      new Date(),
    );
    await dispatchLeaderRegistrationConfirmation(result.leader.id);
    res.status(result.replayed ? 200 : 201).json({
      registrationId: result.leader.id,
      status: "received",
      replayed: result.replayed,
    });
  } catch (error) {
    if (error instanceof SubmissionError) {
      res.status(error.status).json({ error: error.code, details: error.details });
      return;
    }
    next(error);
  }
});
