ALTER TABLE "admin_users"
RENAME COLUMN "email" TO "username";

ALTER INDEX "admin_users_email_key"
RENAME TO "admin_users_username_key";
