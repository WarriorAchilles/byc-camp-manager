import {
  deliverEmail,
  escapeHtml,
} from "./emailDelivery.js";

export type CheckInMailPayload = {
  to: string;
  camperFullName: string;
  dormLabel: string;
  checkedInAt: Date;
};

function formatCheckInInstant(checkedInAt: Date): string {
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "full",
    timeStyle: "short",
    timeZone: "UTC",
  }).format(checkedInAt);
}

/** Exposed for tests — same strings used by `sendCheckInConfirmationMail`. */
export function buildCheckInConfirmationContent(payload: CheckInMailPayload): {
  subject: string;
  text: string;
  html: string;
} {
  const when = formatCheckInInstant(payload.checkedInAt);
  const subject = `${payload.camperFullName} checked in — Believers Youth Camp`;
  const text = [
    `${payload.camperFullName} has been checked in.`,
    "",
    `Dorm assignment: ${payload.dormLabel}`,
    `Check-in date and time (UTC): ${when}`,
    "",
    "If you have questions, contact the camp office.",
  ].join("\n");
  const html = `<p><strong>${escapeHtml(payload.camperFullName)}</strong> has been checked in.</p>
<p><strong>Dorm assignment:</strong> ${escapeHtml(payload.dormLabel)}</p>
<p><strong>Check-in date and time (UTC):</strong> ${escapeHtml(when)}</p>
<p>If you have questions, contact the camp office.</p>`;
  return { subject, text, html };
}

export type SendCheckInMailResult =
  | { status: "sent" }
  | { status: "skipped_log" }
  | { status: "skipped_missing_recipient" }
  | { status: "skipped_missing_smtp_config" }
  | { status: "failed"; errorCode: string };

/** Sends check-in confirmation; never throws — callers rely on this for graceful degradation. */
export async function sendCheckInConfirmationMail(payload: CheckInMailPayload): Promise<SendCheckInMailResult> {
  const result = await deliverEmail({
    to: payload.to,
    templateKey: "check_in_confirmation",
    content: buildCheckInConfirmationContent(payload),
  });
  return result.status === "sent" ? { status: "sent" } : result;
}
