/**
 * Ensures integration tests have required env before any module calls `loadEnv()`.
 * Override with a real `.env.test` or exported shell variables for CI.
 */
process.env.NODE_ENV = "test";
if (!process.env.DATABASE_URL) {
  process.env.DATABASE_URL =
    "postgresql://postgres:postgres@127.0.0.1:5432/byc_camp_manager";
}
if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32) {
  process.env.JWT_SECRET = "0123456789abcdef0123456789abcdef0123456789";
}
if (!process.env.EMAIL_TRANSPORT) {
  process.env.EMAIL_TRANSPORT = "log";
}
