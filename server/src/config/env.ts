import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { config as loadDotEnv } from "dotenv";
import { z } from "zod";

// Load server/.env for `tsx`/node unless variables are already set (e.g. tests, CI).
const envDir = dirname(fileURLToPath(import.meta.url));
loadDotEnv({ path: resolve(envDir, "../../.env") });

const publicOrigin = z.string().url().superRefine((value, ctx) => {
  const url = new URL(value);
  if (url.pathname !== "/" || url.search || url.hash || url.username || url.password) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Expected an origin without path, credentials, query, or hash" });
  }
});

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  PORT: z.coerce.number().default(4000),
  DATABASE_URL: z.string().min(1),
  JWT_SECRET: z.string().min(32),
  ADMIN_PUBLIC_ORIGIN: publicOrigin.default("http://localhost:5173"),
  REGISTRATION_PUBLIC_ORIGIN: publicOrigin.default("http://registration.localhost:5173"),
  TRUST_PROXY_HOPS: z.coerce.number().int().min(0).max(10).default(0),
  STRIPE_SECRET_KEY: z.string().min(1).optional(),
  STRIPE_WEBHOOK_SECRET: z.string().min(1).optional(),
});

export type Env = z.infer<typeof envSchema>;

let cached: Env | null = null;

export function loadEnv(): Env {
  if (cached) {
    return cached;
  }
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    const message = parsed.error.flatten().fieldErrors;
    throw new Error(`Invalid environment: ${JSON.stringify(message)}`);
  }
  if (parsed.data.ADMIN_PUBLIC_ORIGIN === parsed.data.REGISTRATION_PUBLIC_ORIGIN) {
    throw new Error("Invalid environment: admin and registration public origins must be different");
  }
  if (
    parsed.data.NODE_ENV === "production" &&
    (!process.env.ADMIN_PUBLIC_ORIGIN || !process.env.REGISTRATION_PUBLIC_ORIGIN)
  ) {
    throw new Error("Invalid environment: both public origins are required in production");
  }
  cached = parsed.data;
  return parsed.data;
}

export function resetEnvCacheForTests(): void {
  if (process.env.NODE_ENV === "test") {
    cached = null;
  }
}
