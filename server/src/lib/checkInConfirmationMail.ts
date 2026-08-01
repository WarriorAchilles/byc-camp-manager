import {
  deliverEmail,
  escapeHtml,
} from "./emailDelivery.js";
import {
  renderBrandedEmail,
  renderEmailSection,
  renderNotice,
} from "./emailTemplate.js";

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
  const html = renderBrandedEmail({
    previewText: `${payload.camperFullName} has completed check-in.`,
    eyebrow: "Check-in complete",
    title: `${payload.camperFullName} is checked in`,
    bodyHtml: `<p style="margin:0 0 18px;">Hello,</p>
<p style="margin:0;">We’re glad to let you know that <strong>${escapeHtml(payload.camperFullName)}</strong> has arrived and completed camp check-in.</p>
${renderNotice(`<span style="display:block;margin-bottom:4px;font-size:12px;font-weight:700;letter-spacing:1px;text-transform:uppercase;">Dorm assignment</span><strong style="font-size:21px;line-height:1.35;">${escapeHtml(payload.dormLabel)}</strong>`, "success")}
${renderEmailSection("Check-in details", `<p style="margin:0;"><strong>Date and time (UTC)</strong><br><span style="color:#556575;">${escapeHtml(when)}</span></p>`)}
<p style="margin:22px 0 0;color:#556575;font-size:14px;">If you have questions, please contact the camp office.</p>`,
  });
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
