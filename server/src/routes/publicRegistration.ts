import prismaClientPkg, { Prisma } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { Router, type Response } from "express";
import { z } from "zod";
import { prisma } from "../db.js";
import { getActiveCampYearId } from "../lib/activeCampYearSetting.js";
import {
  agreementSnapshot,
  ADULT_LEGAL_ACKNOWLEDGMENT_TEXT,
  ADULT_MEDICAL_AGREEMENT_TEXT,
  ADULT_MEDICAL_AGREEMENT_VERSION,
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

const availabilityLimit = createPublicRateLimit({ limit: 120, windowMs: 60_000 });
const submissionLimit = createPublicRateLimit({ limit: 10, windowMs: 60_000 });
const { ImportSource, RegistrationState, WorkerRegistrationSubmissionStatus } = prismaClientPkg;

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
    ? await prisma.camper.count({
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
    })
    : 0;
  const family = flow === "family";
  const opensAt = family ? year.familyRegistrationOpensAt : year.workerRegistrationOpensAt;
  const closesAt = family ? year.familyRegistrationClosesAt : year.workerRegistrationClosesAt;
  const state = resolveRegistrationAvailability({
    flow,
    manuallyEnabled: family ? year.familyRegistrationEnabled : year.workerRegistrationEnabled,
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

        const activeCamperCount = await tx.camper.count({
          where: {
            campYearId: camp.id,
            archivedAt: null,
            OR: [
              { familyRegistrationId: null },
              { familyRegistration: { state: { in: [RegistrationState.pending_payment, RegistrationState.confirmed] } } },
            ],
          },
        });
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
        const snapshot = agreementSnapshot(
          input.campers.map((camper) => `${camper.firstName} ${camper.lastName}`),
          input.registrationType,
        );
        const camperIds = input.campers.map(() => randomUUID());
        const registration = await tx.familyRegistration.create({
          data: {
            submissionKey: input.submissionKey,
            submissionDigest: digest,
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
            agreementVersion: input.legal.agreementVersion,
            agreementTextSnapshot: snapshot,
            signatureMethod: "typed",
            signatureData: input.legal.typedName,
            legalAcknowledged: true,
            signedAt: now,
            requestIp: safeRequestIp(requestIp),
            expiresAt: new Date(now.getTime() + FAMILY_RESERVATION_MINUTES * 60_000),
            campers: {
              create: input.campers.map((camper, index) => {
                const address = camper.useFamilyAddress ? input.guardian.address : camper.address!;
                return {
                  id: camperIds[index],
                  campYearId: camp.id,
                  firstName: camper.firstName,
                  lastName: camper.lastName,
                  middleName: camper.middleName || null,
                  dateOfBirth: new Date(`${camper.dateOfBirth}T12:00:00.000Z`),
                  gender: camper.gender,
                  streetAddress: address.streetAddress,
                  city: address.city,
                  stateOrProvince: address.stateOrProvince,
                  postalCode: address.postalCode,
                  country: address.country,
                  camperCellPhone: camper.camperCellPhone || null,
                  guardianName: camper.guardianName,
                  guardianEmail: input.guardian.email,
                  guardianPhone: camper.guardianPhone,
                  identifiesAsChristian: camper.identifiesAsChristian,
                  receivedHolyGhost: camper.receivedHolyGhost,
                  churchName: camper.churchName,
                  pastorName: camper.pastorName,
                  tShirtIntent: camper.tShirtIntent,
                  medicalNotes: camper.medicalNotes || null,
                  allergies: camper.allergies || null,
                  medications: camper.medications || null,
                  dietaryRestrictions: camper.dietaryRestrictions || null,
                  emergencyContactName: camper.emergencyContactName,
                  emergencyContactPhone: camper.emergencyContactPhone,
                  specialNeeds: camper.specialNeeds || null,
                  feeDueCents: pricing.camperFees[index],
                  paymentStatus: "unpaid",
                  medicalReleaseSigned: true,
                  importSource: ImportSource.online_registration,
                };
              }),
            },
            receiptLineItems: {
              create: pricing.receiptLines.map((line) => ({
                ...line,
                pricingSnapshot: line.pricingSnapshot as Prisma.InputJsonValue,
              })),
            },
            merchandiseOrderLines: {
              create: pricing.merchandiseLines.map((line) => ({
                merchandiseItemId: line.merchandiseItemId,
                camperId: line.camperIndex === null ? null : camperIds[line.camperIndex],
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
            campers: { select: { id: true } },
            receiptLineItems: { orderBy: { sortOrder: "asc" } },
          },
        });
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
  if (parsed.data.legal.typedName.toLocaleLowerCase() !== parsed.data.guardian.fullName.toLocaleLowerCase()) {
    res.status(400).json({
      error: "validation_failed",
      fields: [{
        path: "legal.typedName",
        message: parsed.data.registrationType === "self"
          ? "Signature must match your full name"
          : "Signature must match the parent or guardian full name",
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
      camperCount: result.registration.campers.length,
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
      genders: ["male", "female"],
      stateOrProvinceOptions: STATE_PROVINCE_OPTIONS,
      tShirtSizes: CAMPER_T_SHIRT_SIZES,
      medicalAgreement: {
        version: MEDICAL_AGREEMENT_VERSION,
        text: MEDICAL_AGREEMENT_TEXT,
        acknowledgmentText: LEGAL_ACKNOWLEDGMENT_TEXT,
        signatureMethod: "typed",
      },
      adultMedicalAgreement: {
        version: ADULT_MEDICAL_AGREEMENT_VERSION,
        text: ADULT_MEDICAL_AGREEMENT_TEXT,
        acknowledgmentText: ADULT_LEGAL_ACKNOWLEDGMENT_TEXT,
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

        const worker = await tx.worker.create({
          data: workerPersistenceData(input, camp.id, now, requestIp),
          select: { id: true },
        });
        const submission = await tx.workerRegistrationSubmission.create({
          data: {
            ...submissionData,
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
