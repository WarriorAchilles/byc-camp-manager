ALTER TABLE "family_registrations"
  ADD COLUMN "pending_submission_snapshot" JSONB,
  ADD COLUMN "pending_camper_count" INTEGER NOT NULL DEFAULT 0,
  ADD CONSTRAINT "family_registrations_pending_camper_count_nonnegative"
    CHECK ("pending_camper_count" >= 0);

ALTER TABLE "merchandise_order_lines"
  ADD COLUMN "pending_camper_index" INTEGER;

ALTER TABLE "merchandise_order_lines"
  DROP CONSTRAINT "merchandise_order_lines_owner_valid";

ALTER TABLE "merchandise_order_lines"
  ADD CONSTRAINT "merchandise_order_lines_owner_valid" CHECK (
    (
      "ownership" = 'family'
      AND "camper_id" IS NULL
      AND "pending_camper_index" IS NULL
    )
    OR
    (
      "ownership" = 'camper'
      AND (
        ("camper_id" IS NOT NULL AND "pending_camper_index" IS NULL)
        OR
        ("camper_id" IS NULL AND "pending_camper_index" IS NOT NULL)
      )
    )
  ),
  ADD CONSTRAINT "merchandise_order_lines_pending_camper_index_nonnegative"
    CHECK ("pending_camper_index" IS NULL OR "pending_camper_index" >= 0);
