CREATE UNIQUE INDEX IF NOT EXISTS "organizations_code_active_key"
  ON "organizations"("code")
  WHERE "deleted_at" IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS "spaces_organization_code_active_key"
  ON "spaces"("organization_id", "code")
  WHERE "deleted_at" IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS "organization_members_organization_user_active_key"
  ON "organization_members"("organization_id", "user_id")
  WHERE "deleted_at" IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS "space_members_space_user_active_key"
  ON "space_members"("space_id", "user_id")
  WHERE "deleted_at" IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS "object_participants_space_target_user_relation_active_key"
  ON "object_participants"(
    "space_id",
    "target_type",
    "target_id",
    "user_id",
    "relation_type"
  )
  WHERE "deleted_at" IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS "workflow_bindings_default_active_no_type_no_priority_key"
  ON "workflow_bindings"("space_id", "target_type")
  WHERE "deleted_at" IS NULL
    AND "is_default" = true
    AND "work_item_type" IS NULL
    AND "priority" IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS "workflow_bindings_default_active_no_type_priority_key"
  ON "workflow_bindings"("space_id", "target_type", "priority")
  WHERE "deleted_at" IS NULL
    AND "is_default" = true
    AND "work_item_type" IS NULL
    AND "priority" IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS "workflow_bindings_default_active_type_no_priority_key"
  ON "workflow_bindings"("space_id", "target_type", "work_item_type")
  WHERE "deleted_at" IS NULL
    AND "is_default" = true
    AND "work_item_type" IS NOT NULL
    AND "priority" IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS "workflow_bindings_default_active_type_priority_key"
  ON "workflow_bindings"("space_id", "target_type", "work_item_type", "priority")
  WHERE "deleted_at" IS NULL
    AND "is_default" = true
    AND "work_item_type" IS NOT NULL
    AND "priority" IS NOT NULL;
