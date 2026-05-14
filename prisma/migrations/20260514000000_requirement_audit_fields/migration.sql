-- Add author_id column to requirements (nullable; backfilled by application code).
ALTER TABLE "requirements" ADD COLUMN "author_id" CHAR(26);

-- Index author_id for fast lookups (mirrors owner_id pattern).
CREATE INDEX "requirements_author_id_idx" ON "requirements"("author_id");

-- Foreign key to users; SET NULL on user deletion to keep historical data.
ALTER TABLE "requirements"
  ADD CONSTRAINT "requirements_author_id_fkey"
  FOREIGN KEY ("author_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Backfill author_id from created_by_id for existing rows so the field is populated
-- with the original drafter wherever audit metadata is available.
UPDATE "requirements"
SET "author_id" = "created_by_id"
WHERE "author_id" IS NULL AND "created_by_id" IS NOT NULL;
