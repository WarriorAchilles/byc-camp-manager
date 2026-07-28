import { existsSync } from "node:fs";
import { join } from "node:path";
import cookieParser from "cookie-parser";
import cors from "cors";
import express from "express";
import { loadEnv } from "./config/env.js";
import { adminCampYearsRouter } from "./routes/adminCampYears.js";
import { adminChurchesRouter } from "./routes/adminChurches.js";
import { adminSettingsRouter } from "./routes/adminSettings.js";
import { adminUsersRouter } from "./routes/adminUsers.js";
import { authRouter } from "./routes/auth.js";
import { healthRouter } from "./routes/health.js";
import { publicSelfCheckInRouter } from "./routes/publicSelfCheckIn.js";
import { publicRegistrationRouter } from "./routes/publicRegistration.js";
import { stripeWebhookRouter } from "./routes/stripeWebhook.js";
import { requireAuth } from "./middleware/auth.js";

export function createApp(): express.Express {
  const app = express();
  const env = loadEnv();

  app.disable("x-powered-by");
  app.set("trust proxy", env.TRUST_PROXY_HOPS);

  const trustedOrigins = new Set([env.ADMIN_PUBLIC_ORIGIN, env.REGISTRATION_PUBLIC_ORIGIN]);

  app.use(
    cors({
      origin(origin, callback) {
        callback(null, !origin || trustedOrigins.has(origin));
      },
      credentials: true,
    }),
  );
  app.use("/api/stripe/webhook", stripeWebhookRouter);
  app.use(express.json({ limit: "100kb", strict: true }));
  app.use(cookieParser());

  app.use("/api/health", healthRouter);

  app.use("/api/auth", authRouter);

  app.use("/api/public/self-check-in", publicSelfCheckInRouter);
  app.use("/api/public/registration", publicRegistrationRouter);

  app.get("/api/admin/ping", requireAuth, (_req, res) => {
    res.json({ ok: true });
  });

  app.use("/api/admin/users", adminUsersRouter);
  app.use("/api/admin/settings", adminSettingsRouter);
  app.use("/api/admin/camp-years", adminCampYearsRouter);
  app.use("/api/admin/churches", adminChurchesRouter);

  const clientDistPath = process.env.CLIENT_DIST_PATH?.trim();
  if (clientDistPath && existsSync(clientDistPath)) {
    app.use(express.static(clientDistPath));
    app.use((req, res, next) => {
      if (req.method !== "GET" && req.method !== "HEAD") {
        next();
        return;
      }
      if (req.path.startsWith("/api")) {
        next();
        return;
      }
      const requestOrigin = `${req.protocol}://${req.get("host")}`;
      const registrationPath = req.path === "/" || req.path.startsWith("/register/");
      if (
        (requestOrigin === env.REGISTRATION_PUBLIC_ORIGIN && !registrationPath) ||
        (requestOrigin === env.ADMIN_PUBLIC_ORIGIN && req.path.startsWith("/register/")) ||
        (requestOrigin !== env.REGISTRATION_PUBLIC_ORIGIN && requestOrigin !== env.ADMIN_PUBLIC_ORIGIN)
      ) {
        res.status(404).send("Not found");
        return;
      }
      res.sendFile(join(clientDistPath, "index.html"), (err) => {
        if (err) {
          next(err);
        }
      });
    });
  }

  app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    if (typeof error === "object" && error !== null && "status" in error && error.status === 413) {
      res.status(413).json({ error: "Request too large" });
      return;
    }
    if (error instanceof SyntaxError) {
      res.status(400).json({ error: "Invalid request" });
      return;
    }
    console.error("Unhandled request error", error);
    res.status(500).json({ error: "The request could not be completed" });
  });

  return app;
}
