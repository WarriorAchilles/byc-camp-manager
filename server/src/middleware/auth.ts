import type { NextFunction, Request, Response } from "express";
import type { AdminRole, AdminUser } from "@prisma/client";
import { getCookieName, verifyAuthToken } from "../lib/authToken.js";
import { prisma } from "../db.js";

export type AuthedRequest = Request & {
  adminUser?: AdminUser;
};

export async function requireAuth(
  req: AuthedRequest,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const cookieName = getCookieName();
    const rawCookie = req.cookies?.[cookieName] as string | undefined;
    const headerAuth = req.headers.authorization?.replace(/^Bearer\s+/i, "");
    const token = rawCookie ?? headerAuth;
    if (!token) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    const payload = verifyAuthToken(token);
    const adminUser = await prisma.adminUser.findUnique({
      where: { id: payload.sub },
    });
    if (!adminUser || !adminUser.isActive) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    if (adminUser.role !== payload.role) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    req.adminUser = adminUser;
    next();
  } catch {
    res.status(401).json({ error: "Unauthorized" });
  }
}

export function requireRole(...allowed: AdminRole[]) {
  return (req: AuthedRequest, res: Response, next: NextFunction): void => {
    const user = req.adminUser;
    if (!user) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    if (!allowed.includes(user.role)) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }
    next();
  };
}
