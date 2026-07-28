-- Camper photos are private binary records, separate from camper rows so
-- ordinary roster queries never load or serialize image bytes.
CREATE TABLE "camper_photos" (
    "camper_id" TEXT NOT NULL,
    "content_type" TEXT NOT NULL,
    "data" BYTEA NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "camper_photos_pkey" PRIMARY KEY ("camper_id")
);

-- Uploads exist before a pending family registration is created. They are
-- claimed by submission key and materialized only after registration confirms.
CREATE TABLE "camper_photo_uploads" (
    "id" TEXT NOT NULL,
    "camp_year_id" TEXT NOT NULL,
    "family_registration_id" TEXT,
    "submission_key" TEXT NOT NULL,
    "content_type" TEXT NOT NULL,
    "data" BYTEA NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "camper_photo_uploads_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "camper_photo_uploads_submission_key_camp_year_id_idx"
    ON "camper_photo_uploads"("submission_key", "camp_year_id");
CREATE INDEX "camper_photo_uploads_family_registration_id_idx"
    ON "camper_photo_uploads"("family_registration_id");
CREATE INDEX "camper_photo_uploads_created_at_idx"
    ON "camper_photo_uploads"("created_at");

ALTER TABLE "camper_photos"
    ADD CONSTRAINT "camper_photos_camper_id_fkey"
    FOREIGN KEY ("camper_id") REFERENCES "campers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "camper_photo_uploads"
    ADD CONSTRAINT "camper_photo_uploads_camp_year_id_fkey"
    FOREIGN KEY ("camp_year_id") REFERENCES "camp_years"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "camper_photo_uploads"
    ADD CONSTRAINT "camper_photo_uploads_family_registration_id_fkey"
    FOREIGN KEY ("family_registration_id") REFERENCES "family_registrations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
