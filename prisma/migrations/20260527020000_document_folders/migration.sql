CREATE TABLE "document_folders" (
  "id" CHAR(26) NOT NULL,
  "organization_id" CHAR(26) NOT NULL,
  "space_id" CHAR(26) NOT NULL,
  "parent_id" CHAR(26),
  "name" VARCHAR(120) NOT NULL,
  "normalized_name" VARCHAR(160) NOT NULL,
  "sort_order" INTEGER NOT NULL DEFAULT 0,
  "depth" INTEGER NOT NULL,
  "version" INTEGER NOT NULL DEFAULT 1,
  "created_by_id" CHAR(26) NOT NULL,
  "updated_by_id" CHAR(26) NOT NULL,
  "deleted_at" TIMESTAMPTZ(3),
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "document_folders_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "document_folders_name_not_blank_check" CHECK (btrim("name") <> ''),
  CONSTRAINT "document_folders_depth_range_check" CHECK ("depth" >= 0 AND "depth" <= 6),
  CONSTRAINT "document_folders_version_positive_check" CHECK ("version" >= 1),
  CONSTRAINT "document_folders_sort_order_nonnegative_check" CHECK ("sort_order" >= 0)
);

ALTER TABLE "documents" ADD COLUMN "folder_id" CHAR(26);

CREATE INDEX "document_folders_organization_id_idx" ON "document_folders"("organization_id");
CREATE INDEX "document_folders_space_id_idx" ON "document_folders"("space_id");
CREATE INDEX "document_folders_parent_id_idx" ON "document_folders"("parent_id");
CREATE INDEX "document_folders_created_by_id_idx" ON "document_folders"("created_by_id");
CREATE INDEX "document_folders_space_id_parent_id_deleted_at_sort_order_idx"
  ON "document_folders"("space_id", "parent_id", "deleted_at", "sort_order");

CREATE UNIQUE INDEX "document_folders_root_name_active_key"
  ON "document_folders"("space_id", "normalized_name")
  WHERE "parent_id" IS NULL AND "deleted_at" IS NULL;
CREATE UNIQUE INDEX "document_folders_parent_name_active_key"
  ON "document_folders"("parent_id", "normalized_name")
  WHERE "parent_id" IS NOT NULL AND "deleted_at" IS NULL;

CREATE INDEX "documents_folder_id_idx" ON "documents"("folder_id");
CREATE INDEX "documents_space_id_folder_id_deleted_at_last_edited_at_idx"
  ON "documents"("space_id", "folder_id", "deleted_at", "last_edited_at");

ALTER TABLE "document_folders" ADD CONSTRAINT "document_folders_organization_id_fkey"
  FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "document_folders" ADD CONSTRAINT "document_folders_space_id_fkey"
  FOREIGN KEY ("space_id") REFERENCES "spaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "document_folders" ADD CONSTRAINT "document_folders_parent_id_fkey"
  FOREIGN KEY ("parent_id") REFERENCES "document_folders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "documents" ADD CONSTRAINT "documents_folder_id_fkey"
  FOREIGN KEY ("folder_id") REFERENCES "document_folders"("id") ON DELETE SET NULL ON UPDATE CASCADE;
