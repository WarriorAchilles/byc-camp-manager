import jwt from "jsonwebtoken";
import type { AdminRole } from "@prisma/client";
import { loadEnv } from "../config/env.js";

export type AuthTokenPayload = {
  sub: string;
  role: AdminRole;
};

const COOKIE_NAME = "admin_session";

export function getCookieName(): string {
  return COOKIE_NAME;
}

export function signAuthToken(payload: AuthTokenPayload): string {
  const { JWT_SECRET } = loadEnv();
  return jwt.sign(payload, JWT_SECRET, { expiresIn: "7d" });
}

export function verifyAuthToken(token: string): AuthTokenPayload {
  const { JWT_SECRET } = loadEnv();
  const decoded = jwt.verify(token, JWT_SECRET);
  if (typeof decoded !== "object" || decoded === null) {
    throw new Error("Invalid token payload");
  }
  const record = decoded as Record<string, unknown>;
  if (typeof record.sub !== "string" || typeof record.role !== "string") {
    throw new Error("Invalid token shape");
  }
  if (record.role !== "super_admin" && record.role !== "camp_admin") {
    throw new Error("Invalid role in token");
  }
  return { sub: record.sub, role: record.role };
}
