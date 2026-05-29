ALTER TABLE "documents"
  DROP CONSTRAINT IF EXISTS "documents_title_not_blank_check";

ALTER TABLE "documents"
  ADD CONSTRAINT "documents_title_not_blank_check"
  CHECK (
    "status" = 'DRAFT'::"DocumentStatus"
    OR btrim("title") <> ''
  );
