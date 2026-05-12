import { Router } from "express";
import { z } from "zod";
import { loadEnv } from "../config/env.js";
import { prisma } from "../db.js";
import { getCookieName, signAuthToken } from "../lib/authToken.js";
import { writeOpsLog } from "../lib/opsLog.js";
import { verifyPassword } from "../lib/password.js";
import type { AuthedRequest } from "../middleware/auth.js";
import { requireAuth } from "../middleware/auth.js";
export const authRouter = Router();

const loginBody = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

authRouter.post("/login", async (req, res) => {
  const parsed = loginBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request" });
    return;
  }
  const email = parsed.data.email.trim().toLowerCase();
  const user = await prisma.adminUser.findUnique({ where: { email } });
  if (!user || !user.isActive) {
    writeOpsLog("admin_login_failed", { reason: "invalid_credentials" });
    res.status(401).json({ error: "Invalid email or password" });
    return;
  }
  const valid = await verifyPassword(parsed.data.password, user.passwordHash);
  if (!valid) {
    writeOpsLog("admin_login_failed", { reason: "invalid_credentials" });
    res.status(401).json({ error: "Invalid email or password" });
    return;
  }
  writeOpsLog("admin_login_succeeded", { adminUserId: user.id, role: user.role });
  const token = signAuthToken({ sub: user.id, role: user.role });
  const env = loadEnv();
  const isProduction = env.NODE_ENV === "production";
  res.cookie(getCookieName(), token, {
    httpOnly: true,
    sameSite: "lax",
    secure: isProduction,
    maxAge: 7 * 24 * 60 * 60 * 1000,
    path: "/",
  });
  res.json({
    user: {
      id: user.id,
      email: user.email,
      role: user.role,
    },
  });
});

authRouter.post("/logout", (_req, res) => {
  res.clearCookie(getCookieName(), { path: "/" });
  res.status(204).send();
});

authRouter.get("/me", requireAuth, (req: AuthedRequest, res) => {
  const user = req.adminUser;
  if (!user) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  res.json({
    id: user.id,
    email: user.email,
    role: user.role,
    isActive: user.isActive,
  });
});
