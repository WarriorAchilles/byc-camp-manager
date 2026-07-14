ALTER TYPE "StripeCheckoutStatus" ADD VALUE IF NOT EXISTS 'failed';

CREATE TYPE "StripeCheckoutPurpose" AS ENUM ('self_check_in', 'family_registration');

ALTER TABLE "stripe_checkout_sessions"
  ADD COLUMN "purpose" "StripeCheckoutPurpose" NOT NULL DEFAULT 'self_check_in',
  ADD COLUMN "currency" TEXT NOT NULL DEFAULT 'usd',
  ALTER COLUMN "camper_id" DROP NOT NULL;

CREATE INDEX "stripe_checkout_sessions_purpose_status_idx"
  ON "stripe_checkout_sessions"("purpose", "status");
