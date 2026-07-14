ALTER TABLE "family_registrations"
  ADD COLUMN "submission_key" TEXT,
  ADD COLUMN "submission_digest" TEXT;

CREATE UNIQUE INDEX "family_registrations_submission_key_key"
  ON "family_registrations"("submission_key");

