CREATE TYPE "WorkerRegistrationSubmissionStatus" AS ENUM (
  'created',
  'pending_review',
  'linked_existing',
  'dismissed'
);

CREATE TABLE "worker_registration_submissions" (
  "id" TEXT NOT NULL,
  "submission_key" TEXT NOT NULL,
  "submission_digest" TEXT NOT NULL,
  "camp_year_id" TEXT NOT NULL,
  "status" "WorkerRegistrationSubmissionStatus" NOT NULL,
  "email" TEXT NOT NULL,
  "first_name" TEXT NOT NULL,
  "last_name" TEXT NOT NULL,
  "date_of_birth" DATE,
  "gender" "Gender" NOT NULL,
  "cell_phone" TEXT NOT NULL,
  "alt_phone" TEXT,
  "street_address" TEXT NOT NULL,
  "city" TEXT NOT NULL,
  "state_or_province" TEXT NOT NULL,
  "postal_code" TEXT NOT NULL,
  "country" TEXT NOT NULL,
  "faith_serving_response" TEXT NOT NULL,
  "church_name" TEXT NOT NULL,
  "pastor_name" TEXT NOT NULL,
  "pastor_phone" TEXT NOT NULL,
  "task_preference_first" TEXT NOT NULL,
  "task_preference_second" TEXT NOT NULL,
  "task_preference_third" TEXT NOT NULL,
  "t_shirt_size" TEXT,
  "request_ip" TEXT,
  "submitted_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "resolved_at" TIMESTAMP(3),
  "resolved_by_admin_user_id" TEXT,
  "resolved_worker_id" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "worker_registration_submissions_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "worker_registration_matches" (
  "id" TEXT NOT NULL,
  "submission_id" TEXT NOT NULL,
  "worker_id" TEXT NOT NULL,
  "match_reason" TEXT NOT NULL,
  CONSTRAINT "worker_registration_matches_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "worker_registration_submissions_submission_key_key"
  ON "worker_registration_submissions"("submission_key");
CREATE INDEX "worker_registration_submissions_camp_year_id_status_submitted_at_idx"
  ON "worker_registration_submissions"("camp_year_id", "status", "submitted_at");
CREATE INDEX "worker_registration_submissions_camp_year_id_email_idx"
  ON "worker_registration_submissions"("camp_year_id", "email");
CREATE UNIQUE INDEX "worker_registration_matches_submission_id_worker_id_key"
  ON "worker_registration_matches"("submission_id", "worker_id");
CREATE INDEX "worker_registration_matches_worker_id_idx"
  ON "worker_registration_matches"("worker_id");

ALTER TABLE "worker_registration_submissions"
  ADD CONSTRAINT "worker_registration_submissions_camp_year_id_fkey"
  FOREIGN KEY ("camp_year_id") REFERENCES "camp_years"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "worker_registration_submissions"
  ADD CONSTRAINT "worker_registration_submissions_resolved_worker_id_fkey"
  FOREIGN KEY ("resolved_worker_id") REFERENCES "workers"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "worker_registration_matches"
  ADD CONSTRAINT "worker_registration_matches_submission_id_fkey"
  FOREIGN KEY ("submission_id") REFERENCES "worker_registration_submissions"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "worker_registration_matches"
  ADD CONSTRAINT "worker_registration_matches_worker_id_fkey"
  FOREIGN KEY ("worker_id") REFERENCES "workers"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
