import { existsSync } from "node:fs";
import { join } from "node:path";
import cookieParser from "cookie-parser";
import cors from "cors";
import express from "express";
import { loadEnv } from "./config/env.js";
import { adminCampYearsRouter } from "./routes/adminCampYears.js";
import { adminSettingsRouter } from "./routes/adminSettings.js";
import { adminUsersRouter } from "./routes/adminUsers.js";
import { authRouter } from "./routes/auth.js";
import { healthRouter } from "./routes/health.js";
import { publicSelfCheckInRouter } from "./routes/publicSelfCheckIn.js";
import { requireAuth } from "./middleware/auth.js";

export function createApp(): express.Express {
  const app = express();
  const env = loadEnv();

  app.use(
    cors({
      origin: env.CORS_ORIGIN ?? true,
      credentials: true,
    }),
  );
  app.use(express.json());
  app.use(cookieParser());

  app.use("/api/health", healthRouter);

  app.use("/api/auth", authRouter);

  app.use("/api/public/self-check-in", publicSelfCheckInRouter);

  app.get("/api/admin/ping", requireAuth, (_req, res) => {
    res.json({ ok: true });
  });

  app.use("/api/admin/users", adminUsersRouter);
  app.use("/api/admin/settings", adminSettingsRouter);
  app.use("/api/admin/camp-years", adminCampYearsRouter);

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
      res.sendFile(join(clientDistPath, "index.html"), (err) => {
        if (err) {
          next(err);
        }
      });
    });
  }

  return app;
}
