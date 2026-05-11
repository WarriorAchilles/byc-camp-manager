-- CreateTable
CREATE TABLE "app_settings" (
    "id" TEXT NOT NULL,
    "active_camp_year_id" TEXT,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "app_settings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "app_settings_active_camp_year_id_key" ON "app_settings"("active_camp_year_id");

-- AddForeignKey
ALTER TABLE "app_settings" ADD CONSTRAINT "app_settings_active_camp_year_id_fkey" FOREIGN KEY ("active_camp_year_id") REFERENCES "camp_years"("id") ON DELETE SET NULL ON UPDATE CASCADE;

INSERT INTO "app_settings" ("id", "updated_at") VALUES ('default', CURRENT_TIMESTAMP);
