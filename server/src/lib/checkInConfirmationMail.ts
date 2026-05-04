import nodemailer from "nodemailer";
import type { Transporter } from "nodemailer";

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

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

type MailEnv = {
  transport: "smtp" | "log";
  smtpHost?: string;
  smtpPort?: number;
  smtpUser?: string;
  smtpPass?: string;
  emailFrom?: string;
};

export function readMailEnvFromProcess(): MailEnv {
  const transportRaw = (process.env.EMAIL_TRANSPORT ?? "log").toLowerCase();
  const transport = transportRaw === "smtp" ? "smtp" : "log";
  const smtpPortRaw = process.env.SMTP_PORT;
  return {
    transport,
    smtpHost: process.env.SMTP_HOST?.trim() || undefined,
    smtpPort: smtpPortRaw ? Number.parseInt(smtpPortRaw, 10) : undefined,
    smtpUser: process.env.SMTP_USER?.trim() || undefined,
    smtpPass: process.env.SMTP_PASS?.trim() || undefined,
    emailFrom: process.env.EMAIL_FROM?.trim() || undefined,
  };
}

function createSmtpTransport(mail: MailEnv): Transporter | null {
  if (
    !mail.smtpHost ||
    !mail.smtpPort ||
    mail.smtpUser === undefined ||
    mail.smtpPass === undefined ||
    !mail.emailFrom
  ) {
    return null;
  }
  return nodemailer.createTransport({
    host: mail.smtpHost,
    port: mail.smtpPort,
    secure: mail.smtpPort === 465,
    auth: { user: mail.smtpUser, pass: mail.smtpPass },
  });
}

export type SendCheckInMailResult =
  | { status: "sent" }
  | { status: "skipped_log"; logLine: string }
  | { status: "skipped_missing_smtp_config" }
  | { status: "failed"; message: string };

/** Sends check-in confirmation; never throws — callers rely on this for graceful degradation. */
export async function sendCheckInConfirmationMail(payload: CheckInMailPayload): Promise<SendCheckInMailResult> {
  const mail = readMailEnvFromProcess();
  const { subject, text, html } = buildCheckInConfirmationContent(payload);

  if (mail.transport === "log") {
    const logLine = `[email log] to=${payload.to} subject=${JSON.stringify(subject)} body=${JSON.stringify(text)}`;
    console.info(logLine);
    return { status: "skipped_log", logLine };
  }

  const transport = createSmtpTransport(mail);
  if (!transport || !mail.emailFrom) {
    console.warn("[email] SMTP transport selected but host/port/user/pass/from are incomplete; skipping send");
    return { status: "skipped_missing_smtp_config" };
  }

  try {
    await transport.sendMail({
      from: mail.emailFrom,
      to: payload.to,
      subject,
      text,
      html,
    });
    return { status: "sent" };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[email] check-in confirmation send failed:", message);
    return { status: "failed", message };
  }
}
