ALTER TYPE "EmailDeliveryStatus" ADD VALUE 'skipped';

ALTER TABLE "email_delivery_attempts"
ADD COLUMN "worker_registration_submission_id" TEXT,
ADD COLUMN "idempotency_key" TEXT;

CREATE UNIQUE INDEX "email_delivery_attempts_idempotency_key_key"
ON "email_delivery_attempts"("idempotency_key");

CREATE INDEX "email_delivery_attempts_worker_registration_submission_id_status_idx"
ON "email_delivery_attempts"("worker_registration_submission_id", "status");

ALTER TABLE "email_delivery_attempts"
ADD CONSTRAINT "email_delivery_attempts_worker_registration_submission_id_fkey"
FOREIGN KEY ("worker_registration_submission_id")
REFERENCES "worker_registration_submissions"("id")
ON DELETE CASCADE
ON UPDATE CASCADE;
