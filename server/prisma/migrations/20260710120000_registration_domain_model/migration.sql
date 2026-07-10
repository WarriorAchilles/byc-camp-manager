-- Registration lifecycle and ownership enums.
CREATE TYPE "RegistrationState" AS ENUM ('pending_payment', 'confirmed', 'expired', 'cancelled');
CREATE TYPE "RegistrationPaymentMethod" AS ENUM ('stripe', 'cash');
CREATE TYPE "LegalSignatureMethod" AS ENUM ('typed', 'drawn');
CREATE TYPE "ReceiptLineType" AS ENUM ('registration', 'merchandise', 'discount');
CREATE TYPE "MerchandiseOwnership" AS ENUM ('family', 'camper');
CREATE TYPE "EmailDeliveryStatus" AS ENUM ('pending', 'sent', 'failed');

-- The posted camp-year self-check-in token remains; only staff camper scanning is removed.
ALTER TABLE "camp_years" DROP COLUMN "check_in_camper_qr_scan_enabled";

CREATE TABLE "family_registrations" (
    "id" TEXT NOT NULL,
    "camp_year_id" TEXT NOT NULL,
    "state" "RegistrationState" NOT NULL DEFAULT 'confirmed',
    "guardian_name" TEXT NOT NULL,
    "guardian_email" TEXT NOT NULL,
    "guardian_phone" TEXT NOT NULL,
    "guardian_relationship" TEXT,
    "street_address" TEXT,
    "city" TEXT,
    "state_or_province" TEXT,
    "postal_code" TEXT,
    "country" TEXT,
    "payment_method" "RegistrationPaymentMethod",
    "payment_status" "CamperPaymentStatus" NOT NULL DEFAULT 'unpaid',
    "registration_subtotal_cents" INTEGER NOT NULL DEFAULT 0,
    "merchandise_subtotal_cents" INTEGER NOT NULL DEFAULT 0,
    "discount_cents" INTEGER NOT NULL DEFAULT 0,
    "total_due_cents" INTEGER NOT NULL DEFAULT 0,
    "amount_paid_cents" INTEGER NOT NULL DEFAULT 0,
    "pricing_snapshot" JSONB,
    "agreement_version" TEXT,
    "agreement_text_snapshot" TEXT,
    "signature_method" "LegalSignatureMethod",
    "signature_data" TEXT,
    "legal_acknowledged" BOOLEAN NOT NULL DEFAULT false,
    "signed_at" TIMESTAMP(3),
    "request_ip" TEXT,
    "submitted_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "confirmed_at" TIMESTAMP(3),
    "expires_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "family_registrations_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "family_registrations_amounts_nonnegative" CHECK (
      "registration_subtotal_cents" >= 0 AND "merchandise_subtotal_cents" >= 0 AND
      "discount_cents" >= 0 AND "total_due_cents" >= 0 AND "amount_paid_cents" >= 0
    ),
    CONSTRAINT "family_registrations_totals_consistent" CHECK (
      "total_due_cents" = GREATEST("registration_subtotal_cents" + "merchandise_subtotal_cents" - "discount_cents", 0)
    ),
    CONSTRAINT "family_registrations_signature_consistent" CHECK (
      ("signed_at" IS NULL AND "signature_method" IS NULL AND "signature_data" IS NULL) OR
      ("signed_at" IS NOT NULL AND "signature_method" IS NOT NULL AND "signature_data" IS NOT NULL AND "legal_acknowledged")
    )
);

-- Preserve scalar Phase 1 family identifiers by materializing one compatible
-- family row from the oldest camper carrying each identifier.
INSERT INTO "family_registrations" (
  "id", "camp_year_id", "state", "guardian_name", "guardian_email", "guardian_phone",
  "street_address", "city", "state_or_province", "postal_code", "country",
  "payment_status", "registration_subtotal_cents", "total_due_cents", "amount_paid_cents",
  "submitted_at", "confirmed_at", "created_at", "updated_at"
)
SELECT DISTINCT ON ("family_registration_id")
  "family_registration_id", "camp_year_id", 'confirmed'::"RegistrationState",
  "guardian_name", "guardian_email", "guardian_phone", "street_address", "city",
  "state_or_province", "postal_code", "country", "payment_status",
  COALESCE("fee_due_cents", 0), COALESCE("fee_due_cents", 0), COALESCE("fee_paid_cents", 0),
  "created_at", "created_at", "created_at", CURRENT_TIMESTAMP
FROM "campers"
WHERE "family_registration_id" IS NOT NULL
ORDER BY "family_registration_id", "created_at", "id";

ALTER TABLE "campers"
  ADD COLUMN "identifies_as_christian" BOOLEAN,
  ADD COLUMN "received_holy_ghost" BOOLEAN,
  ADD COLUMN "church_name" TEXT,
  ADD COLUMN "pastor_name" TEXT,
  ADD COLUMN "t_shirt_intent" TEXT,
  ADD COLUMN "allergies" TEXT,
  ADD COLUMN "medications" TEXT,
  ADD COLUMN "special_needs" TEXT,
  DROP COLUMN "qr_token";

ALTER TABLE "workers"
  ADD COLUMN "faith_serving_response" TEXT,
  ADD COLUMN "church_name" TEXT,
  ADD COLUMN "pastor_name" TEXT,
  ADD COLUMN "pastor_phone" TEXT,
  ADD COLUMN "public_submitted_at" TIMESTAMP(3),
  ADD COLUMN "public_submission_ip" TEXT;

CREATE TABLE "registration_receipt_line_items" (
    "id" TEXT NOT NULL,
    "family_registration_id" TEXT NOT NULL,
    "line_type" "ReceiptLineType" NOT NULL,
    "description" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "unit_price_cents" INTEGER NOT NULL,
    "original_unit_price_cents" INTEGER,
    "discount_cents" INTEGER NOT NULL DEFAULT 0,
    "line_total_cents" INTEGER NOT NULL,
    "pricing_snapshot" JSONB,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "registration_receipt_line_items_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "registration_receipt_line_items_amounts_valid" CHECK (
      "quantity" > 0 AND "unit_price_cents" >= 0 AND
      ("original_unit_price_cents" IS NULL OR "original_unit_price_cents" >= 0) AND
      "discount_cents" >= 0 AND "line_total_cents" >= 0
    )
);

CREATE TABLE "merchandise_items" (
    "id" TEXT NOT NULL,
    "camp_year_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "price_cents" INTEGER NOT NULL,
    "available_options" JSONB NOT NULL,
    "ownership" "MerchandiseOwnership" NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "merchandise_items_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "merchandise_items_price_nonnegative" CHECK ("price_cents" >= 0)
);

CREATE TABLE "merchandise_order_lines" (
    "id" TEXT NOT NULL,
    "family_registration_id" TEXT NOT NULL,
    "merchandise_item_id" TEXT,
    "camper_id" TEXT,
    "ownership" "MerchandiseOwnership" NOT NULL,
    "item_name_snapshot" TEXT NOT NULL,
    "selected_options_snapshot" JSONB,
    "quantity" INTEGER NOT NULL,
    "unit_price_cents" INTEGER NOT NULL,
    "line_total_cents" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "merchandise_order_lines_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "merchandise_order_lines_amounts_valid" CHECK (
      "quantity" > 0 AND "unit_price_cents" >= 0 AND "line_total_cents" = "quantity" * "unit_price_cents"
    ),
    CONSTRAINT "merchandise_order_lines_owner_valid" CHECK (
      ("ownership" = 'family' AND "camper_id" IS NULL) OR
      ("ownership" = 'camper' AND "camper_id" IS NOT NULL)
    )
);

CREATE TABLE "email_delivery_attempts" (
    "id" TEXT NOT NULL,
    "family_registration_id" TEXT,
    "template_key" TEXT NOT NULL,
    "recipient_email" TEXT NOT NULL,
    "status" "EmailDeliveryStatus" NOT NULL DEFAULT 'pending',
    "attempt_number" INTEGER NOT NULL DEFAULT 1,
    "provider_message_id" TEXT,
    "error_code" TEXT,
    "error_message" TEXT,
    "attempted_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sent_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "email_delivery_attempts_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "email_delivery_attempts_number_positive" CHECK ("attempt_number" > 0)
);

ALTER TABLE "stripe_checkout_sessions" ADD COLUMN "family_registration_id" TEXT;

CREATE INDEX "family_registrations_camp_year_id_state_idx" ON "family_registrations"("camp_year_id", "state");
CREATE INDEX "family_registrations_camp_year_id_guardian_email_idx" ON "family_registrations"("camp_year_id", "guardian_email");
CREATE INDEX "family_registrations_payment_status_idx" ON "family_registrations"("payment_status");
CREATE INDEX "registration_receipt_line_items_family_registration_id_sort_order_idx" ON "registration_receipt_line_items"("family_registration_id", "sort_order");
CREATE INDEX "merchandise_items_camp_year_id_is_active_sort_order_idx" ON "merchandise_items"("camp_year_id", "is_active", "sort_order");
CREATE INDEX "merchandise_order_lines_family_registration_id_idx" ON "merchandise_order_lines"("family_registration_id");
CREATE INDEX "merchandise_order_lines_merchandise_item_id_idx" ON "merchandise_order_lines"("merchandise_item_id");
CREATE INDEX "merchandise_order_lines_camper_id_idx" ON "merchandise_order_lines"("camper_id");
CREATE INDEX "email_delivery_attempts_family_registration_id_status_idx" ON "email_delivery_attempts"("family_registration_id", "status");
CREATE INDEX "email_delivery_attempts_recipient_email_attempted_at_idx" ON "email_delivery_attempts"("recipient_email", "attempted_at");
CREATE INDEX "stripe_checkout_sessions_family_registration_id_idx" ON "stripe_checkout_sessions"("family_registration_id");
CREATE INDEX "stripe_checkout_sessions_payment_intent_id_idx" ON "stripe_checkout_sessions"("payment_intent_id");

ALTER TABLE "family_registrations" ADD CONSTRAINT "family_registrations_camp_year_id_fkey"
  FOREIGN KEY ("camp_year_id") REFERENCES "camp_years"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "campers" ADD CONSTRAINT "campers_family_registration_id_fkey"
  FOREIGN KEY ("family_registration_id") REFERENCES "family_registrations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "registration_receipt_line_items" ADD CONSTRAINT "registration_receipt_line_items_family_registration_id_fkey"
  FOREIGN KEY ("family_registration_id") REFERENCES "family_registrations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "merchandise_items" ADD CONSTRAINT "merchandise_items_camp_year_id_fkey"
  FOREIGN KEY ("camp_year_id") REFERENCES "camp_years"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "merchandise_order_lines" ADD CONSTRAINT "merchandise_order_lines_family_registration_id_fkey"
  FOREIGN KEY ("family_registration_id") REFERENCES "family_registrations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "merchandise_order_lines" ADD CONSTRAINT "merchandise_order_lines_merchandise_item_id_fkey"
  FOREIGN KEY ("merchandise_item_id") REFERENCES "merchandise_items"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "merchandise_order_lines" ADD CONSTRAINT "merchandise_order_lines_camper_id_fkey"
  FOREIGN KEY ("camper_id") REFERENCES "campers"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "email_delivery_attempts" ADD CONSTRAINT "email_delivery_attempts_family_registration_id_fkey"
  FOREIGN KEY ("family_registration_id") REFERENCES "family_registrations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "stripe_checkout_sessions" ADD CONSTRAINT "stripe_checkout_sessions_family_registration_id_fkey"
  FOREIGN KEY ("family_registration_id") REFERENCES "family_registrations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
