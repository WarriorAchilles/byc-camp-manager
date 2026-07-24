ALTER TABLE "camp_years"
  ADD COLUMN "leader_registration_opens_at" TIMESTAMP(3),
  ADD COLUMN "leader_registration_closes_at" TIMESTAMP(3),
  ADD COLUMN "leader_registration_enabled" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "leader_registration_header_content" TEXT NOT NULL DEFAULT 'Leader registration details will be posted here. Please contact the camp office with questions.',
  ADD COLUMN "leader_registration_closed_message" TEXT NOT NULL DEFAULT 'Leader registration is currently closed.';

ALTER TABLE "dorm_leaders"
  ADD COLUMN "date_of_birth" DATE,
  ADD COLUMN "alt_phone" TEXT,
  ADD COLUMN "street_address" TEXT,
  ADD COLUMN "city" TEXT,
  ADD COLUMN "state_or_province" TEXT,
  ADD COLUMN "postal_code" TEXT,
  ADD COLUMN "country" TEXT,
  ADD COLUMN "marital_status" TEXT,
  ADD COLUMN "faith_serving_response" TEXT,
  ADD COLUMN "church_name" TEXT,
  ADD COLUMN "pastor_name" TEXT,
  ADD COLUMN "pastor_phone" TEXT,
  ADD COLUMN "t_shirt_size" TEXT,
  ADD COLUMN "public_submitted_at" TIMESTAMP(3),
  ADD COLUMN "public_submission_ip" TEXT,
  ADD COLUMN "public_submission_key" TEXT,
  ADD COLUMN "public_submission_digest" TEXT;

CREATE UNIQUE INDEX "dorm_leaders_public_submission_key_key"
  ON "dorm_leaders"("public_submission_key");

CREATE INDEX "dorm_leaders_camp_year_id_email_idx"
  ON "dorm_leaders"("camp_year_id", "email");
