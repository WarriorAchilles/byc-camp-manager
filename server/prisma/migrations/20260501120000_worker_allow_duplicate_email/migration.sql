-- Allow multiple workers per camp year with the same email (shared household accounts, re-imports, etc.)
DROP INDEX IF EXISTS "workers_camp_year_id_email_key";

CREATE INDEX "workers_camp_year_id_email_idx" ON "workers"("camp_year_id", "email");
