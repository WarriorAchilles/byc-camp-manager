DROP INDEX IF EXISTS "stripe_checkout_sessions_stripe_session_id_key";

CREATE INDEX IF NOT EXISTS "stripe_checkout_sessions_stripe_session_id_idx" ON "stripe_checkout_sessions"("stripe_session_id");
