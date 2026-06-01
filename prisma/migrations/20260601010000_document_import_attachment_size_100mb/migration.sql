ALTER TABLE "attachments" DROP CONSTRAINT IF EXISTS "attachments_size_check";

ALTER TABLE "attachments"
  ADD CONSTRAINT "attachments_size_check"
  CHECK ("size" > 0 AND "size" <= 104857600);
