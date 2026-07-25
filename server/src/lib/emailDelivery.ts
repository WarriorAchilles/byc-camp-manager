import nodemailer from "nodemailer";
import type { Transporter } from "nodemailer";
import { writeOpsLog } from "./opsLog.js";

export type EmailContent = {
  subject: string;
  text: string;
  html: string;
};

type MailEnv = {
  transport: "smtp" | "log";
  smtpHost?: string;
  smtpPort?: number;
  smtpUser?: string;
  smtpPass?: string;
  emailFrom?: string;
};

export type EmailDeliveryResult =
  | { status: "sent"; providerMessageId?: string }
  | { status: "skipped_log" }
  | { status: "skipped_missing_recipient" }
  | { status: "skipped_missing_smtp_config" }
  | { status: "failed"; errorCode: string };

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
    !mail.smtpHost
    || !mail.smtpPort
    || mail.smtpUser === undefined
    || mail.smtpPass === undefined
    || !mail.emailFrom
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

function safeProviderErrorCode(error: unknown): string {
  if (typeof error === "object" && error !== null && "code" in error) {
    const candidate = String(error.code);
    if (/^[A-Za-z0-9_.-]{1,80}$/.test(candidate)) return candidate;
  }
  return "email_provider_error";
}

/**
 * Delivers a rendered message through the shared transport. The result and all
 * logs intentionally omit the recipient, subject, body, and provider error text.
 */
export async function deliverEmail(input: {
  to: string;
  templateKey: string;
  content: EmailContent;
}): Promise<EmailDeliveryResult> {
  if (!input.to.trim()) {
    return { status: "skipped_missing_recipient" };
  }

  const mail = readMailEnvFromProcess();
  if (mail.transport === "log") {
    writeOpsLog("email_delivery", {
      templateKey: input.templateKey,
      transport: "log",
      status: "skipped_log",
    });
    return { status: "skipped_log" };
  }

  const transport = createSmtpTransport(mail);
  if (!transport || !mail.emailFrom) {
    writeOpsLog("email_delivery", {
      templateKey: input.templateKey,
      transport: "smtp",
      status: "skipped_missing_smtp_config",
    });
    return { status: "skipped_missing_smtp_config" };
  }

  try {
    const info = await transport.sendMail({
      from: mail.emailFrom,
      to: input.to,
      subject: input.content.subject,
      text: input.content.text,
      html: input.content.html,
    });
    const providerMessageId =
      typeof info.messageId === "string" && info.messageId.trim()
        ? info.messageId.trim()
        : undefined;
    writeOpsLog("email_delivery", {
      templateKey: input.templateKey,
      transport: "smtp",
      status: "sent",
      providerMessageIdAvailable: Boolean(providerMessageId),
    });
    return { status: "sent", ...(providerMessageId ? { providerMessageId } : {}) };
  } catch (error) {
    const errorCode = safeProviderErrorCode(error);
    writeOpsLog("email_delivery", {
      templateKey: input.templateKey,
      transport: "smtp",
      status: "failed",
      errorCode,
    });
    return { status: "failed", errorCode };
  }
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
