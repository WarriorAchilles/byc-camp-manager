-- AlterTable
ALTER TABLE "camp_years" ADD COLUMN "self_check_in_token" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "camp_years_self_check_in_token_key" ON "camp_years"("self_check_in_token");
