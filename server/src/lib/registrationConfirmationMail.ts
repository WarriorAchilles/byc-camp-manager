import prismaClientPkg from "@prisma/client";
import { prisma } from "../db.js";
import {
  deliverEmail,
  escapeHtml,
  type EmailContent,
  type EmailDeliveryResult,
} from "./emailDelivery.js";
import { writeOpsLog } from "./opsLog.js";
import { LEADER_T_SHIRT_GUIDANCE } from "./leaderRegistration.js";
import { WORKER_CONFIRMATION_GUIDANCE } from "./workerRegistration.js";

const {
  EmailDeliveryStatus,
  RegistrationPaymentMethod,
  RegistrationState,
} = prismaClientPkg;

export const FAMILY_REGISTRATION_TEMPLATE_KEY = "family_registration_confirmation";
export const WORKER_REGISTRATION_TEMPLATE_KEY = "worker_registration_confirmation";
export const LEADER_REGISTRATION_TEMPLATE_KEY = "leader_registration_confirmation";

type FamilyTemplateInput = {
  campName: string;
  campStartDate: Date;
  campEndDate: Date;
  campInformation: string;
  guardianName: string;
  camperNames: string[];
  receiptLines: Array<{
    description: string;
    quantity: number;
    unitPriceCents: number;
    originalUnitPriceCents: number | null;
    discountCents: number;
    lineTotalCents: number;
  }>;
  merchandiseLines: Array<{
    itemName: string;
    selectedOptions: unknown;
    quantity: number;
    lineTotalCents: number;
  }>;
  registrationSubtotalCents: number;
  merchandiseSubtotalCents: number;
  discountCents: number;
  totalDueCents: number;
  amountPaidCents: number;
  paymentMethod: "stripe" | "cash";
};

type WorkerTemplateInput = {
  campName: string;
  campStartDate: Date;
  campEndDate: Date;
  campInformation: string;
  responses: {
    email: string;
    firstName: string;
    lastName: string;
    dateOfBirth: Date | null;
    gender: string;
    cellPhone: string;
    altPhone: string | null;
    streetAddress: string;
    city: string;
    stateOrProvince: string;
    postalCode: string;
    country: string;
    faithServingResponse: string;
    churchName: string;
    pastorName: string;
    pastorPhone: string;
    taskPreferenceFirst: string;
    taskPreferenceSecond: string;
    taskPreferenceThird: string;
    tShirtSize: string | null;
  };
};

type LeaderTemplateInput = {
  campName: string;
  campStartDate: Date;
  campEndDate: Date;
  campInformation: string;
  responses: {
    email: string;
    firstName: string;
    lastName: string;
    dateOfBirth: Date | null;
    gender: string;
    phone: string;
    altPhone: string | null;
    streetAddress: string | null;
    city: string | null;
    stateOrProvince: string | null;
    postalCode: string | null;
    country: string | null;
    maritalStatus: string | null;
    faithServingResponse: string | null;
    churchName: string | null;
    pastorName: string | null;
    pastorPhone: string | null;
    roleLabel: string | null;
    tShirtSize: string | null;
  };
};

export type RegistrationEmailDispatchResult =
  | { status: "sent" | "skipped_log" | "failed" }
  | { status: "duplicate_suppressed" | "not_eligible" | "not_found" | "not_recorded" };

function formatMoney(cents: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(cents / 100);
}

function formatDate(value: Date): string {
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "long",
    timeZone: "UTC",
  }).format(value);
}

function campDateRange(startDate: Date, endDate: Date): string {
  return `${formatDate(startDate)} through ${formatDate(endDate)}`;
}

function stripSelfCheckInUrls(value: string): string {
  return value
    .replace(/\bhttps?:\/\/[^\s<>"']*\/self-check-in\/[^\s<>"']*/gi, "[self-check-in link omitted]")
    .replace(/(^|[\s(])\/self-check-in\/[A-Za-z0-9._~!$&'()*+,;=:@%-]+/gi, "$1[self-check-in link omitted]");
}

function optionsSummary(value: unknown): string | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, optionValue]) => optionValue !== null && optionValue !== undefined)
    .map(([key, optionValue]) => `${key}: ${String(optionValue)}`);
  return entries.length > 0 ? entries.join(", ") : null;
}

function familyReceiptLineText(line: FamilyTemplateInput["receiptLines"][number]): string {
  const original =
    line.originalUnitPriceCents !== null && line.originalUnitPriceCents > line.unitPriceCents
      ? ` (regularly ${formatMoney(line.originalUnitPriceCents)} each; family discount ${formatMoney(line.discountCents)})`
      : "";
  const quantity = line.quantity > 1 ? ` × ${line.quantity}` : "";
  return `${line.description}${quantity}: ${formatMoney(line.lineTotalCents)}${original}`;
}

export function buildFamilyRegistrationConfirmationContent(
  input: FamilyTemplateInput,
): EmailContent {
  const campInformation = stripSelfCheckInUrls(input.campInformation.trim());
  const paid = input.paymentMethod === "stripe";
  const paymentText = paid
    ? `Payment received via Stripe: ${formatMoney(input.amountPaidCents)}. No registration balance is due.`
    : `PAY AT CAMP WITH CASH: Bring exactly ${formatMoney(input.totalDueCents)} to check-in.`;
  const arrival =
    "After arriving at the physical check-in location, scan the posted self-check-in QR code to begin check-in.";
  const receiptLines = input.receiptLines.map((line) => `- ${familyReceiptLineText(line)}`);
  const merchandiseLines = input.merchandiseLines.length > 0
    ? input.merchandiseLines.map((line) => {
      const options = optionsSummary(line.selectedOptions);
      return `- ${line.itemName}${options ? ` (${options})` : ""} × ${line.quantity}: ${formatMoney(line.lineTotalCents)}`;
    })
    : ["- No merchandise was ordered."];

  const text = [
    `Hello ${input.guardianName},`,
    "",
    `Your registration for ${input.campName} is confirmed.`,
    "",
    "Registered campers:",
    ...input.camperNames.map((name) => `- ${name}`),
    "",
    "Itemized pricing:",
    ...receiptLines,
    `Registration subtotal: ${formatMoney(input.registrationSubtotalCents)}`,
    ...(input.merchandiseSubtotalCents > 0
      ? [`Merchandise subtotal: ${formatMoney(input.merchandiseSubtotalCents)}`]
      : []),
    ...(input.discountCents > 0
      ? [`Discounts: -${formatMoney(input.discountCents)}`]
      : []),
    `Total: ${formatMoney(input.totalDueCents)}`,
    "",
    paymentText,
    "",
    "Merchandise summary:",
    ...merchandiseLines,
    "",
    `Camp dates: ${campDateRange(input.campStartDate, input.campEndDate)}`,
    ...(campInformation ? ["", "Camp information:", campInformation] : []),
    "",
    "Arrival and check-in:",
    arrival,
    "",
    "This email intentionally does not include a QR code or self-check-in link.",
  ].join("\n");

  const receiptHtml = input.receiptLines
    .map((line) => `<li>${escapeHtml(familyReceiptLineText(line))}</li>`)
    .join("");
  const merchandiseHtml = input.merchandiseLines.length > 0
    ? input.merchandiseLines.map((line) => {
      const options = optionsSummary(line.selectedOptions);
      const summary =
        `${line.itemName}${options ? ` (${options})` : ""} × ${line.quantity}: ${formatMoney(line.lineTotalCents)}`;
      return `<li>${escapeHtml(summary)}</li>`;
    }).join("")
    : "<li>No merchandise was ordered.</li>";
  const campInformationHtml = campInformation
    ? `<h2>Camp information</h2><p>${escapeHtml(campInformation).replace(/\r?\n/g, "<br>")}</p>`
    : "";
  const html = `<p>Hello ${escapeHtml(input.guardianName)},</p>
<p>Your registration for <strong>${escapeHtml(input.campName)}</strong> is confirmed.</p>
<h2>Registered campers</h2>
<ul>${input.camperNames.map((name) => `<li>${escapeHtml(name)}</li>`).join("")}</ul>
<h2>Itemized pricing</h2>
<ul>${receiptHtml}</ul>
<p>Registration subtotal: ${escapeHtml(formatMoney(input.registrationSubtotalCents))}<br>
${input.merchandiseSubtotalCents > 0 ? `Merchandise subtotal: ${escapeHtml(formatMoney(input.merchandiseSubtotalCents))}<br>\n` : ""}${input.discountCents > 0 ? `Discounts: -${escapeHtml(formatMoney(input.discountCents))}<br>\n` : ""}
<strong>Total: ${escapeHtml(formatMoney(input.totalDueCents))}</strong></p>
<p><strong>${escapeHtml(paymentText)}</strong></p>
<h2>Merchandise summary</h2>
<ul>${merchandiseHtml}</ul>
<p><strong>Camp dates:</strong> ${escapeHtml(campDateRange(input.campStartDate, input.campEndDate))}</p>
${campInformationHtml}
<h2>Arrival and check-in</h2>
<p>${escapeHtml(arrival)}</p>
<p><em>This email intentionally does not include a QR code or self-check-in link.</em></p>`;

  return {
    subject: `Registration confirmed — ${input.campName}`,
    text,
    html,
  };
}

function workerResponseRows(input: WorkerTemplateInput): Array<[string, string]> {
  const { responses } = input;
  return [
    ["Email", responses.email],
    ["First name", responses.firstName],
    ["Last name", responses.lastName],
    ["Date of birth", responses.dateOfBirth ? formatDate(responses.dateOfBirth) : "Not provided"],
    ["Gender", responses.gender],
    ["Cell phone", responses.cellPhone],
    ["Alternate phone", responses.altPhone ?? "Not provided"],
    ["Street address", responses.streetAddress],
    ["City", responses.city],
    ["State or province", responses.stateOrProvince],
    ["Postal code", responses.postalCode],
    ["Country", responses.country],
    ["Faith and serving response", responses.faithServingResponse],
    ["Church name", responses.churchName],
    ["Pastor name", responses.pastorName],
    ["Pastor phone", responses.pastorPhone],
    ["First task preference", responses.taskPreferenceFirst],
    ["Second task preference", responses.taskPreferenceSecond],
    ["Third task preference", responses.taskPreferenceThird],
    ["T-shirt size", responses.tShirtSize ?? "Not selected"],
  ];
}

export function buildWorkerRegistrationConfirmationContent(
  input: WorkerTemplateInput,
): EmailContent {
  const campInformation = stripSelfCheckInUrls(input.campInformation.trim());
  const rows = workerResponseRows(input);
  const text = [
    `Hello ${input.responses.firstName},`,
    "",
    `Your worker registration for ${input.campName} was received.`,
    "",
    "Copy of your submitted responses:",
    ...rows.map(([label, value]) => `${label}: ${value}`),
    "",
    "Required follow-up:",
    `Testimony and pastor recommendation: ${WORKER_CONFIRMATION_GUIDANCE.testimony}`,
    `Rules expectations: ${WORKER_CONFIRMATION_GUIDANCE.rules}`,
    "",
    `Camp dates: ${campDateRange(input.campStartDate, input.campEndDate)}`,
    ...(campInformation ? ["", "Camp information:", campInformation] : []),
    "",
    "Arrival and check-in:",
    WORKER_CONFIRMATION_GUIDANCE.arrival,
    "",
    "This email intentionally does not include a QR code or self-check-in link.",
  ].join("\n");
  const responseHtml = rows
    .map(([label, value]) => `<tr><th align="left">${escapeHtml(label)}</th><td>${escapeHtml(value)}</td></tr>`)
    .join("");
  const campInformationHtml = campInformation
    ? `<h2>Camp information</h2><p>${escapeHtml(campInformation).replace(/\r?\n/g, "<br>")}</p>`
    : "";
  const html = `<p>Hello ${escapeHtml(input.responses.firstName)},</p>
<p>Your worker registration for <strong>${escapeHtml(input.campName)}</strong> was received.</p>
<h2>Copy of your submitted responses</h2>
<table><tbody>${responseHtml}</tbody></table>
<h2>Required follow-up</h2>
<p><strong>Testimony and pastor recommendation:</strong> ${escapeHtml(WORKER_CONFIRMATION_GUIDANCE.testimony)}</p>
<p><strong>Rules expectations:</strong> ${escapeHtml(WORKER_CONFIRMATION_GUIDANCE.rules)}</p>
<p><strong>Camp dates:</strong> ${escapeHtml(campDateRange(input.campStartDate, input.campEndDate))}</p>
${campInformationHtml}
<h2>Arrival and check-in</h2>
<p>${escapeHtml(WORKER_CONFIRMATION_GUIDANCE.arrival)}</p>
<p><em>This email intentionally does not include a QR code or self-check-in link.</em></p>`;
  return {
    subject: `Worker registration received — ${input.campName}`,
    text,
    html,
  };
}

function leaderResponseRows(input: LeaderTemplateInput): Array<[string, string]> {
  const { responses } = input;
  return [
    ["Email", responses.email],
    ["First name", responses.firstName],
    ["Last name", responses.lastName],
    ["Date of birth", responses.dateOfBirth ? formatDate(responses.dateOfBirth) : "Not provided"],
    ["Gender", responses.gender],
    ["Cell phone", responses.phone],
    ["Alternate phone", responses.altPhone ?? "Not provided"],
    ["Street address", responses.streetAddress ?? "Not provided"],
    ["City", responses.city ?? "Not provided"],
    ["State or province", responses.stateOrProvince ?? "Not provided"],
    ["Postal code", responses.postalCode ?? "Not provided"],
    ["Country", responses.country ?? "Not provided"],
    ["Marital status", responses.maritalStatus ?? "Not provided"],
    ["Faith and serving response", responses.faithServingResponse ?? "Not provided"],
    ["Church name", responses.churchName ?? "Not provided"],
    ["Pastor name", responses.pastorName ?? "Not provided"],
    ["Pastor phone", responses.pastorPhone ?? "Not provided"],
    ["Preferred age group", responses.roleLabel ?? "Not provided"],
    ["T-shirt size", responses.tShirtSize ?? "Not selected"],
  ];
}

export function buildLeaderRegistrationConfirmationContent(
  input: LeaderTemplateInput,
): EmailContent {
  const campInformation = stripSelfCheckInUrls(input.campInformation.trim());
  const rows = leaderResponseRows(input);
  const arrival =
    "After arriving at the physical check-in location, scan the posted self-check-in QR code to begin check-in.";
  const text = [
    `Hello ${input.responses.firstName},`,
    "",
    `Your leader registration for ${input.campName} was received.`,
    "",
    "Copy of your submitted responses:",
    ...rows.map(([label, value]) => `${label}: ${value}`),
    "",
    `T-shirt information: ${LEADER_T_SHIRT_GUIDANCE}`,
    "",
    `Camp dates: ${campDateRange(input.campStartDate, input.campEndDate)}`,
    ...(campInformation ? ["", "Camp information:", campInformation] : []),
    "",
    "Arrival and check-in:",
    arrival,
    "",
    "This email intentionally does not include a QR code or self-check-in link.",
  ].join("\n");
  const responseHtml = rows
    .map(([label, value]) => `<tr><th align="left">${escapeHtml(label)}</th><td>${escapeHtml(value)}</td></tr>`)
    .join("");
  const campInformationHtml = campInformation
    ? `<h2>Camp information</h2><p>${escapeHtml(campInformation).replace(/\r?\n/g, "<br>")}</p>`
    : "";
  const html = `<p>Hello ${escapeHtml(input.responses.firstName)},</p>
<p>Your leader registration for <strong>${escapeHtml(input.campName)}</strong> was received.</p>
<h2>Copy of your submitted responses</h2>
<table><tbody>${responseHtml}</tbody></table>
<h2>T-shirt information</h2>
<p>${escapeHtml(LEADER_T_SHIRT_GUIDANCE)}</p>
<p><strong>Camp dates:</strong> ${escapeHtml(campDateRange(input.campStartDate, input.campEndDate))}</p>
${campInformationHtml}
<h2>Arrival and check-in</h2>
<p>${escapeHtml(arrival)}</p>
<p><em>This email intentionally does not include a QR code or self-check-in link.</em></p>`;
  return {
    subject: `Leader registration received — ${input.campName}`,
    text,
    html,
  };
}

function isUniqueConstraintError(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "P2002";
}

async function claimDelivery(input: {
  idempotencyKey: string;
  templateKey: string;
  recipientEmail: string;
  familyRegistrationId?: string;
  workerRegistrationSubmissionId?: string;
  dormLeaderId?: string;
}): Promise<{ claimed: true; attemptId: string } | { claimed: false }> {
  const existing = await prisma.emailDeliveryAttempt.findUnique({
    where: { idempotencyKey: input.idempotencyKey },
  });
  if (existing) {
    if (existing.status !== EmailDeliveryStatus.failed) return { claimed: false };
    const retry = await prisma.emailDeliveryAttempt.updateMany({
      where: { id: existing.id, status: EmailDeliveryStatus.failed },
      data: {
        status: EmailDeliveryStatus.pending,
        attemptNumber: { increment: 1 },
        providerMessageId: null,
        errorCode: null,
        errorMessage: null,
        attemptedAt: new Date(),
        sentAt: null,
      },
    });
    return retry.count === 1 ? { claimed: true, attemptId: existing.id } : { claimed: false };
  }

  try {
    const created = await prisma.emailDeliveryAttempt.create({
      data: {
        idempotencyKey: input.idempotencyKey,
        templateKey: input.templateKey,
        recipientEmail: input.recipientEmail,
        familyRegistrationId: input.familyRegistrationId,
        workerRegistrationSubmissionId: input.workerRegistrationSubmissionId,
        dormLeaderId: input.dormLeaderId,
      },
      select: { id: true },
    });
    return { claimed: true, attemptId: created.id };
  } catch (error) {
    if (isUniqueConstraintError(error)) return { claimed: false };
    throw error;
  }
}

async function recordDeliveryResult(
  attemptId: string,
  result: EmailDeliveryResult,
): Promise<RegistrationEmailDispatchResult> {
  if (result.status === "sent") {
    await prisma.emailDeliveryAttempt.update({
      where: { id: attemptId },
      data: {
        status: EmailDeliveryStatus.sent,
        providerMessageId: result.providerMessageId ?? null,
        sentAt: new Date(),
      },
    });
    return { status: "sent" };
  }
  if (result.status === "skipped_log") {
    await prisma.emailDeliveryAttempt.update({
      where: { id: attemptId },
      data: { status: EmailDeliveryStatus.skipped },
    });
    return { status: "skipped_log" };
  }

  const errorCode = result.status === "failed"
    ? result.errorCode
    : result.status;
  const errorMessage = result.status === "failed"
    ? "The email provider rejected the delivery attempt."
    : "Email delivery configuration was unavailable.";
  await prisma.emailDeliveryAttempt.update({
    where: { id: attemptId },
    data: {
      status: EmailDeliveryStatus.failed,
      errorCode,
      errorMessage,
    },
  });
  return { status: "failed" };
}

async function deliverRecorded(input: {
  idempotencyKey: string;
  templateKey: string;
  recipientEmail: string;
  content: EmailContent;
  familyRegistrationId?: string;
  workerRegistrationSubmissionId?: string;
  dormLeaderId?: string;
}): Promise<RegistrationEmailDispatchResult> {
  const claim = await claimDelivery(input);
  if (!claim.claimed) return { status: "duplicate_suppressed" };
  const deliveryResult = await deliverEmail({
    to: input.recipientEmail,
    templateKey: input.templateKey,
    content: input.content,
  });
  return recordDeliveryResult(claim.attemptId, deliveryResult);
}

export async function dispatchFamilyRegistrationConfirmation(
  familyRegistrationId: string,
): Promise<RegistrationEmailDispatchResult> {
  try {
    const registration = await prisma.familyRegistration.findUnique({
      where: { id: familyRegistrationId },
      include: {
        campYear: true,
        campers: { orderBy: { createdAt: "asc" } },
        receiptLineItems: { orderBy: { sortOrder: "asc" } },
        merchandiseOrderLines: { orderBy: { createdAt: "asc" } },
      },
    });
    if (!registration) return { status: "not_found" };
    if (
      registration.state !== RegistrationState.confirmed
      || (registration.paymentMethod !== RegistrationPaymentMethod.stripe
        && registration.paymentMethod !== RegistrationPaymentMethod.cash)
    ) {
      return { status: "not_eligible" };
    }
    const result = await deliverRecorded({
      idempotencyKey: `${FAMILY_REGISTRATION_TEMPLATE_KEY}:${registration.id}`,
      templateKey: FAMILY_REGISTRATION_TEMPLATE_KEY,
      recipientEmail: registration.guardianEmail,
      familyRegistrationId: registration.id,
      content: buildFamilyRegistrationConfirmationContent({
        campName: registration.campYear.name,
        campStartDate: registration.campYear.startDate,
        campEndDate: registration.campYear.endDate,
        campInformation: registration.campYear.familyRegistrationHeaderContent,
        guardianName: registration.guardianName,
        camperNames: registration.campers.map((camper) =>
          [camper.firstName, camper.middleName, camper.lastName].filter(Boolean).join(" ")
        ),
        receiptLines: registration.receiptLineItems,
        merchandiseLines: registration.merchandiseOrderLines.map((line) => ({
          itemName: line.itemNameSnapshot,
          selectedOptions: line.selectedOptionsSnapshot,
          quantity: line.quantity,
          lineTotalCents: line.lineTotalCents,
        })),
        registrationSubtotalCents: registration.registrationSubtotalCents,
        merchandiseSubtotalCents: registration.merchandiseSubtotalCents,
        discountCents: registration.discountCents,
        totalDueCents: registration.totalDueCents,
        amountPaidCents: registration.amountPaidCents,
        paymentMethod: registration.paymentMethod,
      }),
    });
    writeOpsLog("registration_confirmation_email", {
      familyRegistrationId: registration.id,
      campYearId: registration.campYearId,
      result: result.status,
    });
    return result;
  } catch {
    writeOpsLog("registration_confirmation_email", {
      familyRegistrationId,
      result: "not_recorded",
    });
    return { status: "not_recorded" };
  }
}

export async function dispatchWorkerRegistrationConfirmation(
  workerRegistrationSubmissionId: string,
): Promise<RegistrationEmailDispatchResult> {
  try {
    const submission = await prisma.workerRegistrationSubmission.findUnique({
      where: { id: workerRegistrationSubmissionId },
      include: { campYear: true },
    });
    if (!submission) return { status: "not_found" };
    const result = await deliverRecorded({
      idempotencyKey: `${WORKER_REGISTRATION_TEMPLATE_KEY}:${submission.id}`,
      templateKey: WORKER_REGISTRATION_TEMPLATE_KEY,
      recipientEmail: submission.email,
      workerRegistrationSubmissionId: submission.id,
      content: buildWorkerRegistrationConfirmationContent({
        campName: submission.campYear.name,
        campStartDate: submission.campYear.startDate,
        campEndDate: submission.campYear.endDate,
        campInformation: submission.campYear.workerRegistrationHeaderContent,
        responses: submission,
      }),
    });
    writeOpsLog("registration_confirmation_email", {
      workerRegistrationSubmissionId: submission.id,
      campYearId: submission.campYearId,
      result: result.status,
    });
    return result;
  } catch {
    writeOpsLog("registration_confirmation_email", {
      workerRegistrationSubmissionId,
      result: "not_recorded",
    });
    return { status: "not_recorded" };
  }
}

export async function dispatchLeaderRegistrationConfirmation(
  dormLeaderId: string,
): Promise<RegistrationEmailDispatchResult> {
  try {
    const leader = await prisma.dormLeader.findUnique({
      where: { id: dormLeaderId },
      include: { campYear: true },
    });
    if (!leader) return { status: "not_found" };
    if (!leader.publicSubmittedAt || !leader.publicSubmissionKey) {
      return { status: "not_eligible" };
    }
    const result = await deliverRecorded({
      idempotencyKey: `${LEADER_REGISTRATION_TEMPLATE_KEY}:${leader.id}`,
      templateKey: LEADER_REGISTRATION_TEMPLATE_KEY,
      recipientEmail: leader.email,
      dormLeaderId: leader.id,
      content: buildLeaderRegistrationConfirmationContent({
        campName: leader.campYear.name,
        campStartDate: leader.campYear.startDate,
        campEndDate: leader.campYear.endDate,
        campInformation: leader.campYear.leaderRegistrationHeaderContent,
        responses: leader,
      }),
    });
    writeOpsLog("registration_confirmation_email", {
      dormLeaderId: leader.id,
      campYearId: leader.campYearId,
      result: result.status,
    });
    return result;
  } catch {
    writeOpsLog("registration_confirmation_email", {
      dormLeaderId,
      result: "not_recorded",
    });
    return { status: "not_recorded" };
  }
}
