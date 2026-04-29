-- Idempotent enum creation (dev DBs may already carry matching enums from earlier experiments)
DO $$ BEGIN CREATE TYPE "Gender" AS ENUM ('male', 'female'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE "ImportSource" AS ENUM ('online_registration', 'csv_import', 'admin_entry'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE "CamperPaymentStatus" AS ENUM ('unpaid', 'paid_stripe', 'paid_cash'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE "CheckInStatus" AS ENUM ('not_checked_in', 'checked_in'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE "DormPurpose" AS ENUM ('camper', 'worker'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE "DormGenderDesignation" AS ENUM ('boys', 'girls', 'co_ed'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- CreateTable
CREATE TABLE "camp_years" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "year_label" TEXT NOT NULL,
    "start_date" DATE NOT NULL,
    "end_date" DATE NOT NULL,
    "camper_capacity" INTEGER,
    "family_registration_opens_at" TIMESTAMP(3),
    "worker_registration_opens_at" TIMESTAMP(3),
    "fee_cutover_at" TIMESTAMP(3),
    "early_camper_fee_cents" INTEGER,
    "late_camper_fee_cents" INTEGER,
    "third_plus_camper_fee_cents" INTEGER,
    "discount_tier_notes" TEXT,
    "merchandise_placeholder_notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "camp_years_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "age_group_brackets" (
    "id" TEXT NOT NULL,
    "camp_year_id" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "min_age" INTEGER NOT NULL,
    "max_age" INTEGER NOT NULL,
    "sort_order" INTEGER NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "age_group_brackets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "dorms" (
    "id" TEXT NOT NULL,
    "camp_year_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "purpose" "DormPurpose" NOT NULL,
    "gender_designation" "DormGenderDesignation" NOT NULL,
    "bed_capacity" INTEGER NOT NULL,
    "age_group_bracket_id" TEXT,

    CONSTRAINT "dorms_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "campers" (
    "id" TEXT NOT NULL,
    "camp_year_id" TEXT NOT NULL,
    "family_registration_id" TEXT,
    "first_name" TEXT NOT NULL,
    "last_name" TEXT NOT NULL,
    "middle_name" TEXT,
    "date_of_birth" DATE NOT NULL,
    "gender" "Gender" NOT NULL,
    "street_address" TEXT,
    "city" TEXT,
    "state_or_province" TEXT,
    "postal_code" TEXT,
    "country" TEXT,
    "camper_cell_phone" TEXT,
    "guardian_name" TEXT NOT NULL,
    "guardian_email" TEXT NOT NULL,
    "guardian_phone" TEXT NOT NULL,
    "emergency_contact_name" TEXT,
    "emergency_contact_phone" TEXT,
    "medical_notes" TEXT,
    "dietary_restrictions" TEXT,
    "payment_status" "CamperPaymentStatus" NOT NULL,
    "qr_token" TEXT NOT NULL,
    "dorm_id" TEXT,
    "check_in_status" "CheckInStatus" NOT NULL DEFAULT 'not_checked_in',
    "checked_in_at" TIMESTAMP(3),
    "medical_release_signed" BOOLEAN NOT NULL DEFAULT false,
    "import_source" "ImportSource" NOT NULL,
    "archived_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "campers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workers" (
    "id" TEXT NOT NULL,
    "camp_year_id" TEXT NOT NULL,
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
    "task_preference_first" TEXT,
    "task_preference_second" TEXT,
    "task_preference_third" TEXT,
    "t_shirt_size" TEXT,
    "dorm_id" TEXT,
    "check_in_status" "CheckInStatus" NOT NULL DEFAULT 'not_checked_in',
    "checked_in_at" TIMESTAMP(3),
    "import_source" "ImportSource" NOT NULL,
    "archived_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "workers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "dorm_leaders" (
    "id" TEXT NOT NULL,
    "camp_year_id" TEXT NOT NULL,
    "first_name" TEXT NOT NULL,
    "last_name" TEXT NOT NULL,
    "gender" "Gender" NOT NULL,
    "email" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "role_label" TEXT,
    "assigned_camper_dorm_id" TEXT,
    "check_in_status" "CheckInStatus" NOT NULL DEFAULT 'not_checked_in',
    "checked_in_at" TIMESTAMP(3),
    "import_source" "ImportSource" NOT NULL,
    "archived_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "dorm_leaders_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "campers_qr_token_key" ON "campers"("qr_token");

-- CreateIndex
CREATE INDEX "age_group_brackets_camp_year_id_idx" ON "age_group_brackets"("camp_year_id");

-- CreateIndex
CREATE INDEX "dorms_camp_year_id_idx" ON "dorms"("camp_year_id");

-- CreateIndex
CREATE INDEX "campers_camp_year_id_idx" ON "campers"("camp_year_id");

-- CreateIndex
CREATE INDEX "workers_camp_year_id_idx" ON "workers"("camp_year_id");

-- CreateIndex
CREATE UNIQUE INDEX "workers_camp_year_id_email_key" ON "workers"("camp_year_id", "email");

-- CreateIndex
CREATE INDEX "dorm_leaders_camp_year_id_idx" ON "dorm_leaders"("camp_year_id");

-- AddForeignKey
ALTER TABLE "age_group_brackets" ADD CONSTRAINT "age_group_brackets_camp_year_id_fkey" FOREIGN KEY ("camp_year_id") REFERENCES "camp_years"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dorms" ADD CONSTRAINT "dorms_camp_year_id_fkey" FOREIGN KEY ("camp_year_id") REFERENCES "camp_years"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dorms" ADD CONSTRAINT "dorms_age_group_bracket_id_fkey" FOREIGN KEY ("age_group_bracket_id") REFERENCES "age_group_brackets"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "campers" ADD CONSTRAINT "campers_camp_year_id_fkey" FOREIGN KEY ("camp_year_id") REFERENCES "camp_years"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "campers" ADD CONSTRAINT "campers_dorm_id_fkey" FOREIGN KEY ("dorm_id") REFERENCES "dorms"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workers" ADD CONSTRAINT "workers_camp_year_id_fkey" FOREIGN KEY ("camp_year_id") REFERENCES "camp_years"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workers" ADD CONSTRAINT "workers_dorm_id_fkey" FOREIGN KEY ("dorm_id") REFERENCES "dorms"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dorm_leaders" ADD CONSTRAINT "dorm_leaders_camp_year_id_fkey" FOREIGN KEY ("camp_year_id") REFERENCES "camp_years"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dorm_leaders" ADD CONSTRAINT "dorm_leaders_assigned_camper_dorm_id_fkey" FOREIGN KEY ("assigned_camper_dorm_id") REFERENCES "dorms"("id") ON DELETE SET NULL ON UPDATE CASCADE;
