import { Router } from "express";
import { prisma } from "../db.js";
import { readMailEnvFromProcess } from "../lib/emailDelivery.js";

export const healthRouter = Router();

/** Liveness: process is up (use behind load balancers). */
healthRouter.get("/", (_req, res) => {
  res.json({ ok: true, service: "byc-camp-manager-api" });
});

/** Readiness: database reachable; email configuration summarized (no SMTP probe send). */
healthRouter.get("/ready", async (_req, res) => {
  const checks: Record<string, { ok: boolean; detail?: string }> = {};

  try {
    await prisma.$queryRaw`SELECT 1`;
    checks.database = { ok: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    checks.database = { ok: false, detail: message };
  }

  const mail = readMailEnvFromProcess();
  if (mail.transport === "log") {
    checks.email = {
      ok: true,
      detail: "EMAIL_TRANSPORT=log — safe metadata is written to stdout (no outbound SMTP).",
    };
  } else {
    const smtpConfigured = Boolean(
      mail.smtpHost &&
        mail.smtpPort &&
        mail.smtpUser !== undefined &&
        mail.smtpPass !== undefined &&
        mail.emailFrom,
    );
    checks.email = {
      ok: smtpConfigured,
      detail: smtpConfigured
        ? "SMTP settings present (connectivity not verified on this endpoint)."
        : "EMAIL_TRANSPORT=smtp but SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, or EMAIL_FROM is missing.",
    };
  }

  const ok = Object.values(checks).every((c) => c.ok);
  res.status(ok ? 200 : 503).json({ ok, service: "byc-camp-manager-api", checks });
});
