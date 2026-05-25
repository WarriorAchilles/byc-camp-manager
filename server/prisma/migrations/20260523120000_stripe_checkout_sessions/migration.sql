-- CreateEnum
CREATE TYPE "StripeCheckoutStatus" AS ENUM ('pending', 'completed', 'expired');

-- CreateTable
CREATE TABLE "stripe_checkout_sessions" (
    "id" TEXT NOT NULL,
    "stripe_session_id" TEXT NOT NULL,
    "camp_year_id" TEXT NOT NULL,
    "camper_id" TEXT NOT NULL,
    "amount_cents" INTEGER NOT NULL,
    "status" "StripeCheckoutStatus" NOT NULL DEFAULT 'pending',
    "payment_intent_id" TEXT,
    "completed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "stripe_checkout_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "stripe_checkout_sessions_stripe_session_id_key" ON "stripe_checkout_sessions"("stripe_session_id");

-- CreateIndex
CREATE INDEX "stripe_checkout_sessions_camp_year_id_idx" ON "stripe_checkout_sessions"("camp_year_id");

-- CreateIndex
CREATE INDEX "stripe_checkout_sessions_camper_id_idx" ON "stripe_checkout_sessions"("camper_id");

-- AddForeignKey
ALTER TABLE "stripe_checkout_sessions" ADD CONSTRAINT "stripe_checkout_sessions_camper_id_fkey" FOREIGN KEY ("camper_id") REFERENCES "campers"("id") ON DELETE CASCADE ON UPDATE CASCADE;
