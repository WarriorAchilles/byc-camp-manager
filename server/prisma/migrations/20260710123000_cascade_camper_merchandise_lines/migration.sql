ALTER TABLE "merchandise_order_lines"
  DROP CONSTRAINT "merchandise_order_lines_camper_id_fkey";

ALTER TABLE "merchandise_order_lines"
  ADD CONSTRAINT "merchandise_order_lines_camper_id_fkey"
  FOREIGN KEY ("camper_id") REFERENCES "campers"("id") ON DELETE CASCADE ON UPDATE CASCADE;
