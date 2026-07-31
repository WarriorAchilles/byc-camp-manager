ALTER TABLE "dorms"
ADD COLUMN "camper_capacity" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "leader_capacity" INTEGER NOT NULL DEFAULT 0;

UPDATE "dorms"
SET "camper_capacity" = "bed_capacity"
WHERE "purpose" = 'camper';

UPDATE "dorms"
SET "leader_capacity" = (
  SELECT COUNT(*)::INTEGER
  FROM "dorm_leaders"
  WHERE "dorm_leaders"."assigned_camper_dorm_id" = "dorms"."id"
    AND "dorm_leaders"."archived_at" IS NULL
)
WHERE "purpose" = 'camper';
