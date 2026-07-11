ALTER TABLE "camp_years"
  ADD COLUMN "family_registration_closes_at" TIMESTAMP(3),
  ADD COLUMN "family_registration_enabled" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "family_registration_header_content" TEXT NOT NULL DEFAULT 'Camper registration details will be posted here. Please contact the camp office with questions.',
  ADD COLUMN "family_registration_closed_message" TEXT NOT NULL DEFAULT 'Camper registration is currently closed.',
  ADD COLUMN "worker_registration_closes_at" TIMESTAMP(3),
  ADD COLUMN "worker_registration_enabled" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "worker_registration_header_content" TEXT NOT NULL DEFAULT 'Worker registration details will be posted here. Please contact the camp office with questions.',
  ADD COLUMN "worker_registration_closed_message" TEXT NOT NULL DEFAULT 'Worker registration is currently closed.';

ALTER TABLE "camp_years"
  ADD CONSTRAINT "camp_years_family_registration_window_check"
    CHECK ("family_registration_closes_at" IS NULL OR "family_registration_opens_at" IS NULL OR "family_registration_closes_at" > "family_registration_opens_at"),
  ADD CONSTRAINT "camp_years_worker_registration_window_check"
    CHECK ("worker_registration_closes_at" IS NULL OR "worker_registration_opens_at" IS NULL OR "worker_registration_closes_at" > "worker_registration_opens_at");
