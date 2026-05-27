ALTER TYPE "TargetType" ADD VALUE IF NOT EXISTS 'DOCUMENT';
ALTER TYPE "AttachmentTargetType" ADD VALUE IF NOT EXISTS 'DOCUMENT';
ALTER TYPE "CommentTargetType" ADD VALUE IF NOT EXISTS 'DOCUMENT';
ALTER TYPE "ObjectParticipantTargetType" ADD VALUE IF NOT EXISTS 'DOCUMENT';
ALTER TYPE "TagTargetType" ADD VALUE IF NOT EXISTS 'DOCUMENT';

CREATE TYPE "DocumentSourceType" AS ENUM (
  'UPLOAD_DOCX',
  'UPLOAD_MARKDOWN',
  'PASTE_MARKDOWN',
  'PASTE_TEXT',
  'MCP_CREATED'
);

CREATE TYPE "DocumentActorType" AS ENUM ('USER', 'MCP_CLIENT');

CREATE TYPE "DocumentStatus" AS ENUM ('ACTIVE', 'ARCHIVED');

CREATE TYPE "DocumentChangeType" AS ENUM (
  'CREATED',
  'IMPORTED',
  'REIMPORTED',
  'METADATA_UPDATED',
  'CONTENT_EDITED',
  'CONTENT_APPENDED',
  'CONTENT_REPLACED',
  'ARCHIVED',
  'RESTORED',
  'DELETED'
);

CREATE TYPE "DocumentLinkTargetType" AS ENUM (
  'DOCUMENT',
  'VERSION',
  'REQUIREMENT',
  'INTAKE_ITEM',
  'WORK_ITEM'
);

CREATE TABLE "documents" (
  "id" CHAR(26) NOT NULL,
  "organization_id" CHAR(26) NOT NULL,
  "space_id" CHAR(26) NOT NULL,
  "title" VARCHAR(200) NOT NULL,
  "content_markdown" TEXT NOT NULL,
  "content_text" TEXT NOT NULL,
  "source_type" "DocumentSourceType" NOT NULL,
  "source_attachment_id" CHAR(26),
  "status" "DocumentStatus" NOT NULL DEFAULT 'ACTIVE',
  "revision" INTEGER NOT NULL DEFAULT 1,
  "created_via" "DocumentActorType" NOT NULL DEFAULT 'USER',
  "created_mcp_client_id" VARCHAR(200),
  "last_edited_by_id" CHAR(26) NOT NULL,
  "last_edited_via" "DocumentActorType" NOT NULL DEFAULT 'USER',
  "last_edited_mcp_client_id" VARCHAR(200),
  "last_edited_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "archived_at" TIMESTAMPTZ(3),
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,
  "created_by_id" CHAR(26),
  "updated_by_id" CHAR(26),
  "deleted_at" TIMESTAMPTZ(3),
  CONSTRAINT "documents_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "documents_title_not_blank_check" CHECK (btrim("title") <> ''),
  CONSTRAINT "documents_revision_positive_check" CHECK ("revision" >= 1)
);

CREATE TABLE "document_revisions" (
  "id" CHAR(26) NOT NULL,
  "organization_id" CHAR(26) NOT NULL,
  "space_id" CHAR(26) NOT NULL,
  "document_id" CHAR(26) NOT NULL,
  "revision" INTEGER NOT NULL,
  "title" VARCHAR(200) NOT NULL,
  "content_markdown" TEXT NOT NULL,
  "content_text" TEXT NOT NULL,
  "change_type" "DocumentChangeType" NOT NULL,
  "actor_type" "DocumentActorType" NOT NULL,
  "actor_user_id" CHAR(26) NOT NULL,
  "mcp_client_id" VARCHAR(200),
  "request_id" VARCHAR(128),
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "document_revisions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "document_revisions_revision_positive_check" CHECK ("revision" >= 1)
);

CREATE TABLE "document_links" (
  "id" CHAR(26) NOT NULL,
  "organization_id" CHAR(26) NOT NULL,
  "space_id" CHAR(26) NOT NULL,
  "document_id" CHAR(26) NOT NULL,
  "target_type" "DocumentLinkTargetType" NOT NULL,
  "target_id" CHAR(26) NOT NULL,
  "created_by_id" CHAR(26) NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,
  "deleted_at" TIMESTAMPTZ(3),
  CONSTRAINT "document_links_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "document_chunks" (
  "id" CHAR(26) NOT NULL,
  "organization_id" CHAR(26) NOT NULL,
  "space_id" CHAR(26) NOT NULL,
  "document_id" CHAR(26) NOT NULL,
  "revision" INTEGER NOT NULL,
  "ordinal" INTEGER NOT NULL,
  "heading_path" VARCHAR(1000),
  "content_text" TEXT NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "document_chunks_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "document_chunks_revision_positive_check" CHECK ("revision" >= 1),
  CONSTRAINT "document_chunks_ordinal_nonnegative_check" CHECK ("ordinal" >= 0)
);

CREATE INDEX "documents_organization_id_idx" ON "documents"("organization_id");
CREATE INDEX "documents_space_id_idx" ON "documents"("space_id");
CREATE INDEX "documents_status_idx" ON "documents"("status");
CREATE INDEX "documents_source_type_idx" ON "documents"("source_type");
CREATE INDEX "documents_created_by_id_idx" ON "documents"("created_by_id");
CREATE INDEX "documents_last_edited_by_id_idx" ON "documents"("last_edited_by_id");
CREATE INDEX "documents_source_attachment_id_idx" ON "documents"("source_attachment_id");
CREATE INDEX "documents_space_id_status_updated_at_idx" ON "documents"("space_id", "status", "updated_at");
CREATE INDEX "documents_space_id_deleted_at_updated_at_idx" ON "documents"("space_id", "deleted_at", "updated_at");
CREATE INDEX "documents_space_id_last_edited_at_idx" ON "documents"("space_id", "last_edited_at");
CREATE INDEX "documents_content_text_search_idx"
  ON "documents" USING GIN (to_tsvector('simple', "content_text"));

CREATE UNIQUE INDEX "document_revisions_document_revision_key"
  ON "document_revisions"("document_id", "revision");
CREATE INDEX "document_revisions_organization_id_idx" ON "document_revisions"("organization_id");
CREATE INDEX "document_revisions_space_id_idx" ON "document_revisions"("space_id");
CREATE INDEX "document_revisions_document_id_idx" ON "document_revisions"("document_id");
CREATE INDEX "document_revisions_space_id_document_id_revision_idx"
  ON "document_revisions"("space_id", "document_id", "revision");
CREATE INDEX "document_revisions_actor_user_id_idx" ON "document_revisions"("actor_user_id");
CREATE INDEX "document_revisions_created_at_idx" ON "document_revisions"("created_at");

CREATE INDEX "document_links_organization_id_idx" ON "document_links"("organization_id");
CREATE INDEX "document_links_space_id_idx" ON "document_links"("space_id");
CREATE INDEX "document_links_document_id_idx" ON "document_links"("document_id");
CREATE INDEX "document_links_target_type_target_id_idx" ON "document_links"("target_type", "target_id");
CREATE INDEX "document_links_space_id_document_id_deleted_at_idx"
  ON "document_links"("space_id", "document_id", "deleted_at");
CREATE INDEX "document_links_space_id_target_type_target_id_deleted_at_idx"
  ON "document_links"("space_id", "target_type", "target_id", "deleted_at");
CREATE UNIQUE INDEX "document_links_document_target_active_key"
  ON "document_links"("document_id", "target_type", "target_id")
  WHERE "deleted_at" IS NULL;

CREATE UNIQUE INDEX "document_chunks_document_revision_ordinal_key"
  ON "document_chunks"("document_id", "revision", "ordinal");
CREATE INDEX "document_chunks_organization_id_idx" ON "document_chunks"("organization_id");
CREATE INDEX "document_chunks_space_id_idx" ON "document_chunks"("space_id");
CREATE INDEX "document_chunks_document_id_idx" ON "document_chunks"("document_id");
CREATE INDEX "document_chunks_space_id_document_id_revision_ordinal_idx"
  ON "document_chunks"("space_id", "document_id", "revision", "ordinal");
CREATE INDEX "document_chunks_content_text_search_idx"
  ON "document_chunks" USING GIN (to_tsvector('simple', "content_text"));

ALTER TABLE "documents" ADD CONSTRAINT "documents_organization_id_fkey"
  FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "documents" ADD CONSTRAINT "documents_space_id_fkey"
  FOREIGN KEY ("space_id") REFERENCES "spaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "documents" ADD CONSTRAINT "documents_source_attachment_id_fkey"
  FOREIGN KEY ("source_attachment_id") REFERENCES "attachments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "document_revisions" ADD CONSTRAINT "document_revisions_organization_id_fkey"
  FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "document_revisions" ADD CONSTRAINT "document_revisions_space_id_fkey"
  FOREIGN KEY ("space_id") REFERENCES "spaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "document_revisions" ADD CONSTRAINT "document_revisions_document_id_fkey"
  FOREIGN KEY ("document_id") REFERENCES "documents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "document_links" ADD CONSTRAINT "document_links_organization_id_fkey"
  FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "document_links" ADD CONSTRAINT "document_links_space_id_fkey"
  FOREIGN KEY ("space_id") REFERENCES "spaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "document_links" ADD CONSTRAINT "document_links_document_id_fkey"
  FOREIGN KEY ("document_id") REFERENCES "documents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "document_chunks" ADD CONSTRAINT "document_chunks_organization_id_fkey"
  FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "document_chunks" ADD CONSTRAINT "document_chunks_space_id_fkey"
  FOREIGN KEY ("space_id") REFERENCES "spaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "document_chunks" ADD CONSTRAINT "document_chunks_document_id_fkey"
  FOREIGN KEY ("document_id") REFERENCES "documents"("id") ON DELETE CASCADE ON UPDATE CASCADE;
