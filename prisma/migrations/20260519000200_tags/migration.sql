CREATE TYPE "TagTargetType" AS ENUM ('REQUIREMENT', 'INTAKE_ITEM', 'WORK_ITEM');

CREATE TABLE "tags" (
  "id" CHAR(26) NOT NULL,
  "organization_id" CHAR(26) NOT NULL,
  "space_id" CHAR(26) NOT NULL,
  "name" VARCHAR(40) NOT NULL,
  "normalized_name" VARCHAR(80) NOT NULL,
  "color_key" VARCHAR(32) NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,
  "created_by_id" CHAR(26),
  "updated_by_id" CHAR(26),
  "deleted_at" TIMESTAMPTZ(3),
  CONSTRAINT "tags_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "tags_name_not_blank_check" CHECK (btrim("name") <> ''),
  CONSTRAINT "tags_name_no_hash_check" CHECK (position('#' in "name") = 0),
  CONSTRAINT "tags_normalized_name_not_blank_check" CHECK (btrim("normalized_name") <> ''),
  CONSTRAINT "tags_normalized_name_no_hash_check" CHECK (position('#' in "normalized_name") = 0)
);

CREATE TABLE "tag_assignments" (
  "id" CHAR(26) NOT NULL,
  "organization_id" CHAR(26) NOT NULL,
  "space_id" CHAR(26) NOT NULL,
  "tag_id" CHAR(26) NOT NULL,
  "target_type" "TagTargetType" NOT NULL,
  "target_id" CHAR(26) NOT NULL,
  "assigned_by_id" CHAR(26),
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,
  "deleted_at" TIMESTAMPTZ(3),
  CONSTRAINT "tag_assignments_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "tags_organization_id_idx" ON "tags"("organization_id");
CREATE INDEX "tags_space_id_idx" ON "tags"("space_id");
CREATE INDEX "tags_normalized_name_idx" ON "tags"("normalized_name");
CREATE INDEX "tags_space_id_normalized_name_idx" ON "tags"("space_id", "normalized_name");
CREATE INDEX "tags_created_by_id_idx" ON "tags"("created_by_id");
CREATE INDEX "tags_updated_by_id_idx" ON "tags"("updated_by_id");
CREATE UNIQUE INDEX "tags_space_normalized_name_active_key"
  ON "tags"("space_id", "normalized_name")
  WHERE "deleted_at" IS NULL;

CREATE INDEX "tag_assignments_organization_id_idx" ON "tag_assignments"("organization_id");
CREATE INDEX "tag_assignments_space_id_idx" ON "tag_assignments"("space_id");
CREATE INDEX "tag_assignments_tag_id_idx" ON "tag_assignments"("tag_id");
CREATE INDEX "tag_assignments_target_type_target_id_idx" ON "tag_assignments"("target_type", "target_id");
CREATE INDEX "tag_assignments_space_id_target_type_target_id_idx" ON "tag_assignments"("space_id", "target_type", "target_id");
CREATE INDEX "tag_assignments_space_id_tag_id_idx" ON "tag_assignments"("space_id", "tag_id");
CREATE INDEX "tag_assignments_assigned_by_id_idx" ON "tag_assignments"("assigned_by_id");
CREATE UNIQUE INDEX "tag_assignments_space_target_tag_active_key"
  ON "tag_assignments"("space_id", "target_type", "target_id", "tag_id")
  WHERE "deleted_at" IS NULL;

ALTER TABLE "tags" ADD CONSTRAINT "tags_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "tags" ADD CONSTRAINT "tags_space_id_fkey" FOREIGN KEY ("space_id") REFERENCES "spaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "tags" ADD CONSTRAINT "tags_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "tags" ADD CONSTRAINT "tags_updated_by_id_fkey" FOREIGN KEY ("updated_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "tag_assignments" ADD CONSTRAINT "tag_assignments_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "tag_assignments" ADD CONSTRAINT "tag_assignments_space_id_fkey" FOREIGN KEY ("space_id") REFERENCES "spaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "tag_assignments" ADD CONSTRAINT "tag_assignments_tag_id_fkey" FOREIGN KEY ("tag_id") REFERENCES "tags"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "tag_assignments" ADD CONSTRAINT "tag_assignments_assigned_by_id_fkey" FOREIGN KEY ("assigned_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
