import cookieParser from "cookie-parser";
import cors from "cors";
import express from "express";
import { loadEnv } from "./config/env.js";
import { adminCampYearsRouter } from "./routes/adminCampYears.js";
import { adminUsersRouter } from "./routes/adminUsers.js";
import { authRouter } from "./routes/auth.js";
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

  app.get("/api/health", (_req, res) => {
    res.json({ ok: true });
  });

  app.use("/api/auth", authRouter);

  app.get("/api/admin/ping", requireAuth, (_req, res) => {
    res.json({ ok: true });
  });

  app.use("/api/admin/users", adminUsersRouter);
  app.use("/api/admin/camp-years", adminCampYearsRouter);

  return app;
}
