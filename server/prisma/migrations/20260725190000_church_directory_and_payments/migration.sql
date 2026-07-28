-- Church identity is global across camp years. Submitted person fields remain
-- untouched as immutable snapshots while church_id points at canonical display.
CREATE TYPE "ChurchPaymentTender" AS ENUM ('check', 'cash');
ALTER TYPE "CamperPaymentStatus" ADD VALUE 'paid_church_check';
ALTER TYPE "CamperPaymentStatus" ADD VALUE 'paid_church_cash';

CREATE TABLE "churches" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "normalized_name" TEXT NOT NULL,
    "pastor_name" TEXT NOT NULL,
    "normalized_pastor_name" TEXT NOT NULL,
    "merged_into_church_id" TEXT,
    "reviewed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "churches_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "church_aliases" (
    "id" TEXT NOT NULL,
    "church_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "normalized_name" TEXT NOT NULL,
    "pastor_name" TEXT NOT NULL,
    "normalized_pastor_name" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "church_aliases_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "church_audit_logs" (
    "id" TEXT NOT NULL,
    "actor_admin_user_id" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "source_church_id" TEXT,
    "target_church_id" TEXT,
    "affected_record_ids" JSONB NOT NULL,
    "details" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "church_audit_logs_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "church_payments" (
    "id" TEXT NOT NULL,
    "church_id" TEXT NOT NULL,
    "camp_year_id" TEXT NOT NULL,
    "tender" "ChurchPaymentTender" NOT NULL,
    "amount_received_cents" INTEGER NOT NULL,
    "received_date" DATE NOT NULL,
    "reference_number" TEXT,
    "notes" TEXT,
    "entered_by_admin_user_id" TEXT NOT NULL,
    "idempotency_key" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "voided_at" TIMESTAMP(3),
    "voided_by_admin_user_id" TEXT,
    "void_reason" TEXT,
    CONSTRAINT "church_payments_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "church_payments_positive_amount" CHECK ("amount_received_cents" > 0),
    CONSTRAINT "church_payments_check_reference" CHECK (
      "tender" <> 'check' OR length(trim(COALESCE("reference_number", ''))) > 0
    ),
    CONSTRAINT "church_payments_void_metadata" CHECK (
      ("voided_at" IS NULL AND "voided_by_admin_user_id" IS NULL AND "void_reason" IS NULL)
      OR
      ("voided_at" IS NOT NULL AND "voided_by_admin_user_id" IS NOT NULL AND length(trim(COALESCE("void_reason", ''))) > 0)
    )
);

CREATE TABLE "church_payment_allocations" (
    "id" TEXT NOT NULL,
    "church_payment_id" TEXT NOT NULL,
    "camper_id" TEXT NOT NULL,
    "applied_amount_cents" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "church_payment_allocations_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "church_payment_allocations_positive_amount" CHECK ("applied_amount_cents" > 0)
);

ALTER TABLE "campers" ADD COLUMN "church_id" TEXT;
ALTER TABLE "workers" ADD COLUMN "church_id" TEXT;
ALTER TABLE "worker_registration_submissions" ADD COLUMN "church_id" TEXT;
ALTER TABLE "dorm_leaders" ADD COLUMN "church_id" TEXT;

CREATE UNIQUE INDEX "churches_normalized_name_normalized_pastor_name_key"
  ON "churches"("normalized_name", "normalized_pastor_name");
CREATE INDEX "churches_name_idx" ON "churches"("name");
CREATE INDEX "churches_pastor_name_idx" ON "churches"("pastor_name");
CREATE INDEX "churches_merged_into_church_id_idx" ON "churches"("merged_into_church_id");

CREATE UNIQUE INDEX "church_aliases_normalized_name_normalized_pastor_name_key"
  ON "church_aliases"("normalized_name", "normalized_pastor_name");
CREATE INDEX "church_aliases_church_id_idx" ON "church_aliases"("church_id");
CREATE INDEX "church_aliases_name_idx" ON "church_aliases"("name");

CREATE INDEX "church_audit_logs_actor_admin_user_id_created_at_idx"
  ON "church_audit_logs"("actor_admin_user_id", "created_at");
CREATE INDEX "church_audit_logs_source_church_id_idx" ON "church_audit_logs"("source_church_id");
CREATE INDEX "church_audit_logs_target_church_id_idx" ON "church_audit_logs"("target_church_id");

CREATE UNIQUE INDEX "church_payments_idempotency_key_key" ON "church_payments"("idempotency_key");
CREATE INDEX "church_payments_church_id_camp_year_id_received_date_idx"
  ON "church_payments"("church_id", "camp_year_id", "received_date");
CREATE INDEX "church_payments_camp_year_id_tender_voided_at_idx"
  ON "church_payments"("camp_year_id", "tender", "voided_at");

CREATE UNIQUE INDEX "church_payment_allocations_church_payment_id_camper_id_key"
  ON "church_payment_allocations"("church_payment_id", "camper_id");
CREATE INDEX "church_payment_allocations_camper_id_created_at_idx"
  ON "church_payment_allocations"("camper_id", "created_at");

CREATE INDEX "campers_church_id_camp_year_id_idx" ON "campers"("church_id", "camp_year_id");
CREATE INDEX "workers_church_id_camp_year_id_idx" ON "workers"("church_id", "camp_year_id");
CREATE INDEX "worker_registration_submissions_church_id_camp_year_id_idx"
  ON "worker_registration_submissions"("church_id", "camp_year_id");
CREATE INDEX "dorm_leaders_church_id_camp_year_id_idx" ON "dorm_leaders"("church_id", "camp_year_id");

ALTER TABLE "churches"
  ADD CONSTRAINT "churches_merged_into_church_id_fkey"
  FOREIGN KEY ("merged_into_church_id") REFERENCES "churches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "church_aliases"
  ADD CONSTRAINT "church_aliases_church_id_fkey"
  FOREIGN KEY ("church_id") REFERENCES "churches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "church_audit_logs"
  ADD CONSTRAINT "church_audit_logs_actor_admin_user_id_fkey"
  FOREIGN KEY ("actor_admin_user_id") REFERENCES "admin_users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "church_audit_logs"
  ADD CONSTRAINT "church_audit_logs_source_church_id_fkey"
  FOREIGN KEY ("source_church_id") REFERENCES "churches"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "church_audit_logs"
  ADD CONSTRAINT "church_audit_logs_target_church_id_fkey"
  FOREIGN KEY ("target_church_id") REFERENCES "churches"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "church_payments"
  ADD CONSTRAINT "church_payments_church_id_fkey"
  FOREIGN KEY ("church_id") REFERENCES "churches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "church_payments"
  ADD CONSTRAINT "church_payments_camp_year_id_fkey"
  FOREIGN KEY ("camp_year_id") REFERENCES "camp_years"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "church_payments"
  ADD CONSTRAINT "church_payments_entered_by_admin_user_id_fkey"
  FOREIGN KEY ("entered_by_admin_user_id") REFERENCES "admin_users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "church_payments"
  ADD CONSTRAINT "church_payments_voided_by_admin_user_id_fkey"
  FOREIGN KEY ("voided_by_admin_user_id") REFERENCES "admin_users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "church_payment_allocations"
  ADD CONSTRAINT "church_payment_allocations_church_payment_id_fkey"
  FOREIGN KEY ("church_payment_id") REFERENCES "church_payments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "church_payment_allocations"
  ADD CONSTRAINT "church_payment_allocations_camper_id_fkey"
  FOREIGN KEY ("camper_id") REFERENCES "campers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "campers"
  ADD CONSTRAINT "campers_church_id_fkey"
  FOREIGN KEY ("church_id") REFERENCES "churches"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "workers"
  ADD CONSTRAINT "workers_church_id_fkey"
  FOREIGN KEY ("church_id") REFERENCES "churches"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "worker_registration_submissions"
  ADD CONSTRAINT "worker_registration_submissions_church_id_fkey"
  FOREIGN KEY ("church_id") REFERENCES "churches"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "dorm_leaders"
  ADD CONSTRAINT "dorm_leaders_church_id_fkey"
  FOREIGN KEY ("church_id") REFERENCES "churches"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- This SQL mirror is intentionally kept beside the versioned TypeScript
-- normalizer. It is used only for the one-time exact-pair backfill.
CREATE FUNCTION byc_normalize_church_identity(value TEXT, remove_pastor_title BOOLEAN)
RETURNS TEXT
LANGUAGE plpgsql
IMMUTABLE
STRICT
AS $$
DECLARE
  result TEXT;
BEGIN
  result := lower(trim(normalize(value, NFKC)));
  IF remove_pastor_title THEN
    result := regexp_replace(
      result,
      '^[[:space:]]*(pastor|rev(erend)?|bro(ther)?)[.]?[[:space:]]+',
      '',
      'i'
    );
  END IF;
  result := regexp_replace(result, '[.''’",]', '', 'g');
  result := regexp_replace(result, '[^[:alnum:][:space:]]+', ' ', 'g');
  result := regexp_replace(result, '[[:space:]]+', ' ', 'g');
  RETURN trim(result);
END;
$$;

WITH submitted_pairs AS (
  SELECT "church_name" AS church_name, "pastor_name" AS pastor_name FROM "campers"
  UNION ALL
  SELECT "church_name", "pastor_name" FROM "workers"
  UNION ALL
  SELECT "church_name", "pastor_name" FROM "worker_registration_submissions"
  UNION ALL
  SELECT "church_name", "pastor_name" FROM "dorm_leaders"
),
normalized_pairs AS (
  SELECT
    min(trim(church_name)) AS church_name,
    min(trim(pastor_name)) AS pastor_name,
    byc_normalize_church_identity(church_name, false) AS normalized_name,
    byc_normalize_church_identity(pastor_name, true) AS normalized_pastor_name
  FROM submitted_pairs
  WHERE church_name IS NOT NULL
    AND pastor_name IS NOT NULL
    AND length(trim(church_name)) > 0
    AND length(trim(pastor_name)) > 0
  GROUP BY
    byc_normalize_church_identity(church_name, false),
    byc_normalize_church_identity(pastor_name, true)
),
valid_pairs AS (
  SELECT * FROM normalized_pairs
  WHERE length(normalized_name) > 0 AND length(normalized_pastor_name) > 0
)
INSERT INTO "churches" (
  "id", "name", "normalized_name", "pastor_name", "normalized_pastor_name", "created_at", "updated_at"
)
SELECT
  concat(
    substr(md5(length(normalized_name)::text || ':' || normalized_name || normalized_pastor_name), 1, 8), '-',
    substr(md5(length(normalized_name)::text || ':' || normalized_name || normalized_pastor_name), 9, 4), '-',
    substr(md5(length(normalized_name)::text || ':' || normalized_name || normalized_pastor_name), 13, 4), '-',
    substr(md5(length(normalized_name)::text || ':' || normalized_name || normalized_pastor_name), 17, 4), '-',
    substr(md5(length(normalized_name)::text || ':' || normalized_name || normalized_pastor_name), 21, 12)
  ),
  church_name,
  normalized_name,
  pastor_name,
  normalized_pastor_name,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM valid_pairs;

UPDATE "campers" person
SET "church_id" = church."id"
FROM "churches" church
WHERE person."church_name" IS NOT NULL
  AND person."pastor_name" IS NOT NULL
  AND church."normalized_name" = byc_normalize_church_identity(person."church_name", false)
  AND church."normalized_pastor_name" = byc_normalize_church_identity(person."pastor_name", true);

UPDATE "workers" person
SET "church_id" = church."id"
FROM "churches" church
WHERE person."church_name" IS NOT NULL
  AND person."pastor_name" IS NOT NULL
  AND church."normalized_name" = byc_normalize_church_identity(person."church_name", false)
  AND church."normalized_pastor_name" = byc_normalize_church_identity(person."pastor_name", true);

UPDATE "worker_registration_submissions" person
SET "church_id" = church."id"
FROM "churches" church
WHERE person."church_name" IS NOT NULL
  AND person."pastor_name" IS NOT NULL
  AND church."normalized_name" = byc_normalize_church_identity(person."church_name", false)
  AND church."normalized_pastor_name" = byc_normalize_church_identity(person."pastor_name", true);

UPDATE "dorm_leaders" person
SET "church_id" = church."id"
FROM "churches" church
WHERE person."church_name" IS NOT NULL
  AND person."pastor_name" IS NOT NULL
  AND church."normalized_name" = byc_normalize_church_identity(person."church_name", false)
  AND church."normalized_pastor_name" = byc_normalize_church_identity(person."pastor_name", true);

DROP FUNCTION byc_normalize_church_identity(TEXT, BOOLEAN);
