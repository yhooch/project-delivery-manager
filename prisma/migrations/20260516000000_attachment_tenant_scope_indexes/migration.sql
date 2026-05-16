CREATE INDEX "attachments_org_space_target_deleted_created_idx"
  ON "attachments" ("organization_id", "space_id", "target_type", "target_id", "deleted_at", "created_at");
