ALTER TABLE "email_delivery_attempts"
ADD COLUMN "dorm_leader_id" TEXT;

CREATE INDEX "email_delivery_attempts_dorm_leader_id_status_idx"
ON "email_delivery_attempts"("dorm_leader_id", "status");

ALTER TABLE "email_delivery_attempts"
ADD CONSTRAINT "email_delivery_attempts_dorm_leader_id_fkey"
FOREIGN KEY ("dorm_leader_id")
REFERENCES "dorm_leaders"("id")
ON DELETE CASCADE
ON UPDATE CASCADE;
