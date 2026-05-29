DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'DocumentKind') THEN
    CREATE TYPE "DocumentKind" AS ENUM ('GENERAL', 'REQUIREMENT');
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'DocumentCodeStatus') THEN
    CREATE TYPE "DocumentCodeStatus" AS ENUM ('ASSIGNED', 'CANCELLED', 'DELETED');
  END IF;
END $$;

ALTER TYPE "ContentFormat" ADD VALUE IF NOT EXISTS 'MARKDOWN';

ALTER TYPE "DocumentStatus" ADD VALUE IF NOT EXISTS 'DRAFT' BEFORE 'ACTIVE';

ALTER TYPE "DocumentSourceType" ADD VALUE IF NOT EXISTS 'USER_CREATED' BEFORE 'UPLOAD_DOCX';
ALTER TYPE "DocumentSourceType" ADD VALUE IF NOT EXISTS 'MIGRATED_DOCUMENT' AFTER 'MCP_CREATED';
ALTER TYPE "DocumentSourceType" ADD VALUE IF NOT EXISTS 'MIGRATED_REQUIREMENT' AFTER 'MCP_CREATED';

ALTER TYPE "DocumentChangeType" ADD VALUE IF NOT EXISTS 'CONVERTED_TO_REQUIREMENT' AFTER 'DELETED';
ALTER TYPE "DocumentChangeType" ADD VALUE IF NOT EXISTS 'CANCELLED_REQUIREMENT' AFTER 'DELETED';

ALTER TABLE "documents"
  ADD COLUMN "kind" "DocumentKind" NOT NULL DEFAULT 'GENERAL',
  ADD COLUMN "summary" VARCHAR(2000),
  ADD COLUMN "content_format" "ContentFormat" NOT NULL DEFAULT 'MARKDOWN',
  ADD COLUMN "content_json" JSONB,
  ADD COLUMN "content_markdown_cache" TEXT,
  ADD COLUMN "sequence" INTEGER,
  ADD COLUMN "version_id" CHAR(26),
  ADD COLUMN "priority" "Priority",
  ADD COLUMN "owner_id" CHAR(26),
  ADD COLUMN "author_id" CHAR(26);

ALTER TABLE "documents"
  ALTER COLUMN "content_markdown" DROP NOT NULL;

ALTER TABLE "document_revisions"
  ADD COLUMN "kind" "DocumentKind" NOT NULL DEFAULT 'GENERAL',
  ADD COLUMN "summary" VARCHAR(2000),
  ADD COLUMN "content_format" "ContentFormat" NOT NULL DEFAULT 'MARKDOWN',
  ADD COLUMN "content_json" JSONB,
  ADD COLUMN "content_markdown_cache" TEXT,
  ADD COLUMN "metadata" JSONB;

ALTER TABLE "document_revisions"
  ALTER COLUMN "content_markdown" DROP NOT NULL;

CREATE TABLE "document_code_history" (
  "id" CHAR(26) NOT NULL,
  "organization_id" CHAR(26) NOT NULL,
  "space_id" CHAR(26) NOT NULL,
  "document_id" CHAR(26) NOT NULL,
  "kind" "DocumentKind" NOT NULL,
  "code_prefix" VARCHAR(16) NOT NULL DEFAULT 'REQ',
  "sequence" INTEGER NOT NULL,
  "display_code" VARCHAR(64) NOT NULL,
  "code_status" "DocumentCodeStatus" NOT NULL DEFAULT 'ASSIGNED',
  "assigned_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "status_changed_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "changed_by_id" CHAR(26) NOT NULL,
  "request_id" VARCHAR(128),
  "reason" VARCHAR(1000),
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "document_code_history_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "document_code_history_kind_check" CHECK ("kind" = 'REQUIREMENT'),
  CONSTRAINT "document_code_history_code_prefix_check" CHECK ("code_prefix" = 'REQ'),
  CONSTRAINT "document_code_history_sequence_positive_check" CHECK ("sequence" > 0),
  CONSTRAINT "document_code_history_display_code_check" CHECK ("display_code" = "code_prefix" || '-' || "sequence"::text)
);

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "work_items" wi
    JOIN "documents" d ON d."id" = wi."requirement_id"
    WHERE wi."requirement_id" IS NOT NULL
      AND (
        d."kind" <> 'REQUIREMENT'
        OR d."status" <> 'ACTIVE'
        OR d."sequence" IS NULL
        OR d."deleted_at" IS NOT NULL
      )
  ) THEN
    RAISE EXCEPTION 'work_items.requirement_id contains references to invalid requirement documents';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "intake_items" ii
    JOIN "documents" d ON d."id" = ii."requirement_id"
    WHERE ii."requirement_id" IS NOT NULL
      AND (
        d."kind" <> 'REQUIREMENT'
        OR d."status" <> 'ACTIVE'
        OR d."sequence" IS NULL
        OR d."deleted_at" IS NOT NULL
      )
  ) THEN
    RAISE EXCEPTION 'intake_items.requirement_id contains references to invalid requirement documents';
  END IF;
END $$;

UPDATE "documents"
SET "archived_at" = COALESCE("archived_at", "updated_at", "created_at", CURRENT_TIMESTAMP)
WHERE "status" = 'ARCHIVED'
  AND "archived_at" IS NULL;

UPDATE "documents"
SET "archived_at" = NULL
WHERE "status" <> 'ARCHIVED'
  AND "archived_at" IS NOT NULL;

ALTER TABLE "documents" ADD CONSTRAINT "documents_sequence_positive_check"
  CHECK ("sequence" IS NULL OR "sequence" > 0);
ALTER TABLE "documents" ADD CONSTRAINT "documents_general_sequence_null_check"
  CHECK ("kind" <> 'GENERAL' OR "sequence" IS NULL);
ALTER TABLE "documents" ADD CONSTRAINT "documents_general_requirement_fields_null_check"
  CHECK (
    "kind" = 'REQUIREMENT'
    OR (
      "sequence" IS NULL
      AND "version_id" IS NULL
      AND "priority" IS NULL
      AND "owner_id" IS NULL
    )
  );
ALTER TABLE "documents" ADD CONSTRAINT "documents_requirement_sequence_check"
  CHECK (
    "kind" <> 'REQUIREMENT'
    OR ("status" = 'DRAFT' AND "sequence" IS NULL)
    OR ("status" IN ('ACTIVE', 'ARCHIVED') AND "sequence" IS NOT NULL)
  );
ALTER TABLE "documents" ADD CONSTRAINT "documents_archived_at_status_check"
  CHECK (
    ("status" = 'ARCHIVED' AND "archived_at" IS NOT NULL)
    OR ("status" <> 'ARCHIVED' AND "archived_at" IS NULL)
  );
ALTER TABLE "documents" ADD CONSTRAINT "documents_content_payload_check"
  CHECK (
    (
      "content_format" = 'MARKDOWN'
      AND "content_markdown" IS NOT NULL
      AND "content_json" IS NULL
    )
    OR (
      "content_format" = 'TIPTAP_JSON'
      AND "content_json" IS NOT NULL
      AND "content_markdown" IS NULL
    )
  );

ALTER TABLE "document_revisions" ADD CONSTRAINT "document_revisions_content_payload_check"
  CHECK (
    (
      "content_format" = 'MARKDOWN'
      AND "content_markdown" IS NOT NULL
      AND "content_json" IS NULL
    )
    OR (
      "content_format" = 'TIPTAP_JSON'
      AND "content_json" IS NOT NULL
      AND "content_markdown" IS NULL
    )
  );

CREATE UNIQUE INDEX "documents_requirement_sequence_key"
  ON "documents"("organization_id", "space_id", "kind", "sequence")
  WHERE "kind" = 'REQUIREMENT' AND "sequence" IS NOT NULL;
CREATE INDEX "documents_kind_idx" ON "documents"("kind");
CREATE INDEX "documents_version_id_idx" ON "documents"("version_id");
CREATE INDEX "documents_owner_id_idx" ON "documents"("owner_id");
CREATE INDEX "documents_author_id_idx" ON "documents"("author_id");
CREATE INDEX "documents_space_id_kind_status_updated_at_idx"
  ON "documents"("space_id", "kind", "status", "updated_at");
CREATE INDEX "documents_space_id_kind_sequence_idx"
  ON "documents"("space_id", "kind", "sequence");

CREATE UNIQUE INDEX "document_code_history_org_space_kind_sequence_key"
  ON "document_code_history"("organization_id", "space_id", "kind", "sequence");
CREATE UNIQUE INDEX "document_code_history_org_document_kind_sequence_key"
  ON "document_code_history"("organization_id", "document_id", "kind", "sequence");
CREATE INDEX "document_code_history_organization_id_idx" ON "document_code_history"("organization_id");
CREATE INDEX "document_code_history_space_id_idx" ON "document_code_history"("space_id");
CREATE INDEX "document_code_history_document_id_idx" ON "document_code_history"("document_id");
CREATE INDEX "document_code_history_changed_by_id_idx" ON "document_code_history"("changed_by_id");
CREATE INDEX "document_code_history_code_status_idx" ON "document_code_history"("code_status");
CREATE INDEX "document_code_history_display_code_idx" ON "document_code_history"("display_code");
CREATE INDEX "document_code_history_request_id_idx" ON "document_code_history"("request_id");

ALTER TABLE "documents" ADD CONSTRAINT "documents_version_id_fkey"
  FOREIGN KEY ("version_id") REFERENCES "versions"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "documents" ADD CONSTRAINT "documents_owner_id_fkey"
  FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "documents" ADD CONSTRAINT "documents_author_id_fkey"
  FOREIGN KEY ("author_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "document_code_history" ADD CONSTRAINT "document_code_history_organization_id_fkey"
  FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "document_code_history" ADD CONSTRAINT "document_code_history_space_id_fkey"
  FOREIGN KEY ("space_id") REFERENCES "spaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "document_code_history" ADD CONSTRAINT "document_code_history_document_id_fkey"
  FOREIGN KEY ("document_id") REFERENCES "documents"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "document_code_history" ADD CONSTRAINT "document_code_history_changed_by_id_fkey"
  FOREIGN KEY ("changed_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE OR REPLACE FUNCTION "enforce_requirement_document_reference_kind"()
RETURNS trigger AS $$
DECLARE
  linked_document RECORD;
BEGIN
  IF NEW."requirement_id" IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT d."kind", d."deleted_at"
    INTO linked_document
  FROM "documents" d
  WHERE d."id" = NEW."requirement_id";

  IF FOUND
    AND (
      linked_document."kind" <> 'REQUIREMENT'
      OR linked_document."deleted_at" IS NOT NULL
    )
  THEN
    RAISE EXCEPTION '% requirement_id must reference a non-deleted REQUIREMENT document when it references documents(id)', TG_TABLE_NAME
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "work_items_requirement_document_kind_check"
  BEFORE INSERT OR UPDATE OF "requirement_id" ON "work_items"
  FOR EACH ROW
  EXECUTE FUNCTION "enforce_requirement_document_reference_kind"();

CREATE TRIGGER "intake_items_requirement_document_kind_check"
  BEFORE INSERT OR UPDATE OF "requirement_id" ON "intake_items"
  FOR EACH ROW
  EXECUTE FUNCTION "enforce_requirement_document_reference_kind"();
