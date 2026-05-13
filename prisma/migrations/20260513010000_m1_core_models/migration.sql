CREATE TYPE "SpaceStatus" AS ENUM ('ACTIVE', 'DISABLED');
CREATE TYPE "SpaceMemberStatus" AS ENUM ('ACTIVE', 'DISABLED');
CREATE TYPE "SpaceRole" AS ENUM ('SPACE_ADMIN', 'PM', 'DEVELOPER', 'TESTER', 'REQUIREMENT', 'MEMBER', 'VIEWER');
CREATE TYPE "VersionStatus" AS ENUM ('PLANNED', 'IN_PROGRESS', 'RELEASED', 'ARCHIVED');
CREATE TYPE "RequirementStatus" AS ENUM ('DRAFT', 'CONFIRMED', 'ARCHIVED');
CREATE TYPE "ContentFormat" AS ENUM ('TIPTAP_JSON');
CREATE TYPE "Priority" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'URGENT');
CREATE TYPE "StatusCategory" AS ENUM ('NOT_STARTED', 'IN_PROGRESS', 'WAITING', 'VERIFYING', 'DONE', 'TERMINATED');
CREATE TYPE "TargetType" AS ENUM ('SPACE', 'VERSION', 'REQUIREMENT', 'INTAKE_ITEM', 'WORK_ITEM');
CREATE TYPE "AttachmentTargetType" AS ENUM ('REQUIREMENT', 'WORK_ITEM');
CREATE TYPE "ObjectParticipantTargetType" AS ENUM ('REQUIREMENT', 'INTAKE_ITEM', 'WORK_ITEM');
CREATE TYPE "ObjectParticipantRelation" AS ENUM ('CREATOR', 'ASSIGNEE', 'REPORTER', 'COMMENTER', 'RELATED');
CREATE TYPE "WorkflowActorRelation" AS ENUM ('ASSIGNEE', 'REPORTER', 'CREATOR', 'SPACE_OWNER');
CREATE TYPE "WorkflowDefinitionStatus" AS ENUM ('DRAFT', 'ACTIVE', 'DISABLED');
CREATE TYPE "WorkflowVersionStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'DISABLED');
CREATE TYPE "WorkItemType" AS ENUM ('TASK', 'BUG');
CREATE TYPE "ActionFormFieldType" AS ENUM ('TEXT', 'TEXTAREA', 'SELECT', 'USER', 'DATE', 'NUMBER');

CREATE TABLE "spaces" (
  "id" CHAR(26) NOT NULL,
  "organization_id" CHAR(26) NOT NULL,
  "name" VARCHAR(120) NOT NULL,
  "code" VARCHAR(32) NOT NULL,
  "description" VARCHAR(2000),
  "owner_id" CHAR(26),
  "status" "SpaceStatus" NOT NULL DEFAULT 'ACTIVE',
  "stale_threshold_days" INTEGER NOT NULL DEFAULT 3,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  "created_by_id" CHAR(26),
  "updated_by_id" CHAR(26),
  "deleted_at" TIMESTAMP(3),
  CONSTRAINT "spaces_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "spaces_stale_threshold_days_check" CHECK ("stale_threshold_days" BETWEEN 1 AND 30)
);

CREATE TABLE "space_members" (
  "id" CHAR(26) NOT NULL,
  "organization_id" CHAR(26) NOT NULL,
  "space_id" CHAR(26) NOT NULL,
  "user_id" CHAR(26) NOT NULL,
  "role" "SpaceRole" NOT NULL,
  "status" "SpaceMemberStatus" NOT NULL DEFAULT 'ACTIVE',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  "created_by_id" CHAR(26),
  "updated_by_id" CHAR(26),
  "deleted_at" TIMESTAMP(3),
  CONSTRAINT "space_members_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "versions" (
  "id" CHAR(26) NOT NULL,
  "organization_id" CHAR(26) NOT NULL,
  "space_id" CHAR(26) NOT NULL,
  "name" VARCHAR(120) NOT NULL,
  "target" VARCHAR(2000),
  "description" VARCHAR(2000),
  "owner_id" CHAR(26),
  "status" "VersionStatus" NOT NULL DEFAULT 'PLANNED',
  "start_date" TIMESTAMP(3),
  "target_date" TIMESTAMP(3),
  "release_date" TIMESTAMP(3),
  "requirement_count" INTEGER NOT NULL DEFAULT 0,
  "task_count" INTEGER NOT NULL DEFAULT 0,
  "bug_count" INTEGER NOT NULL DEFAULT 0,
  "blocked_count" INTEGER NOT NULL DEFAULT 0,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  "created_by_id" CHAR(26),
  "updated_by_id" CHAR(26),
  "deleted_at" TIMESTAMP(3),
  CONSTRAINT "versions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "versions_requirement_count_check" CHECK ("requirement_count" >= 0),
  CONSTRAINT "versions_task_count_check" CHECK ("task_count" >= 0),
  CONSTRAINT "versions_bug_count_check" CHECK ("bug_count" >= 0),
  CONSTRAINT "versions_blocked_count_check" CHECK ("blocked_count" >= 0)
);

CREATE TABLE "requirements" (
  "id" CHAR(26) NOT NULL,
  "organization_id" CHAR(26) NOT NULL,
  "space_id" CHAR(26) NOT NULL,
  "version_id" CHAR(26),
  "title" VARCHAR(200) NOT NULL DEFAULT '',
  "summary" VARCHAR(2000),
  "content_json" JSONB NOT NULL DEFAULT '{}',
  "content_text" TEXT,
  "content_markdown_cache" TEXT,
  "content_format" "ContentFormat" NOT NULL DEFAULT 'TIPTAP_JSON',
  "status" "RequirementStatus" NOT NULL DEFAULT 'DRAFT',
  "priority" "Priority",
  "owner_id" CHAR(26),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  "created_by_id" CHAR(26),
  "updated_by_id" CHAR(26),
  "deleted_at" TIMESTAMP(3),
  CONSTRAINT "requirements_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "attachments" (
  "id" CHAR(26) NOT NULL,
  "organization_id" CHAR(26) NOT NULL,
  "space_id" CHAR(26) NOT NULL,
  "target_type" "AttachmentTargetType" NOT NULL,
  "target_id" CHAR(26) NOT NULL,
  "file_name" VARCHAR(500) NOT NULL,
  "file_key" VARCHAR(1000) NOT NULL,
  "mime_type" VARCHAR(255) NOT NULL,
  "size" INTEGER NOT NULL,
  "uploaded_by_id" CHAR(26),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  "created_by_id" CHAR(26),
  "updated_by_id" CHAR(26),
  "deleted_at" TIMESTAMP(3),
  CONSTRAINT "attachments_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "attachments_size_check" CHECK ("size" > 0 AND "size" <= 20971520)
);

CREATE TABLE "workflow_definitions" (
  "id" CHAR(26) NOT NULL,
  "organization_id" CHAR(26) NOT NULL,
  "space_id" CHAR(26) NOT NULL,
  "code" VARCHAR(80) NOT NULL,
  "name" VARCHAR(120) NOT NULL,
  "description" VARCHAR(2000),
  "status" "WorkflowDefinitionStatus" NOT NULL DEFAULT 'DRAFT',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  "created_by_id" CHAR(26),
  "updated_by_id" CHAR(26),
  "deleted_at" TIMESTAMP(3),
  CONSTRAINT "workflow_definitions_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "workflow_versions" (
  "id" CHAR(26) NOT NULL,
  "workflow_definition_id" CHAR(26) NOT NULL,
  "version" INTEGER NOT NULL,
  "status" "WorkflowVersionStatus" NOT NULL DEFAULT 'DRAFT',
  "published_at" TIMESTAMP(3),
  "published_by_id" CHAR(26),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  "created_by_id" CHAR(26),
  "updated_by_id" CHAR(26),
  "deleted_at" TIMESTAMP(3),
  CONSTRAINT "workflow_versions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "workflow_versions_version_check" CHECK ("version" > 0)
);

CREATE TABLE "workflow_states" (
  "id" CHAR(26) NOT NULL,
  "workflow_version_id" CHAR(26) NOT NULL,
  "code" VARCHAR(80) NOT NULL,
  "name" VARCHAR(120) NOT NULL,
  "category" "StatusCategory" NOT NULL,
  "is_start" BOOLEAN NOT NULL DEFAULT false,
  "is_end" BOOLEAN NOT NULL DEFAULT false,
  "sort_order" INTEGER NOT NULL DEFAULT 0,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  "created_by_id" CHAR(26),
  "updated_by_id" CHAR(26),
  "deleted_at" TIMESTAMP(3),
  CONSTRAINT "workflow_states_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "workflow_states_sort_order_check" CHECK ("sort_order" >= 0)
);

CREATE TABLE "workflow_actions" (
  "id" CHAR(26) NOT NULL,
  "workflow_version_id" CHAR(26) NOT NULL,
  "from_state_id" CHAR(26) NOT NULL,
  "to_state_id" CHAR(26) NOT NULL,
  "code" VARCHAR(80) NOT NULL,
  "name" VARCHAR(120) NOT NULL,
  "allowed_space_roles" "SpaceRole"[] DEFAULT ARRAY[]::"SpaceRole"[],
  "actor_relations" "WorkflowActorRelation"[] DEFAULT ARRAY[]::"WorkflowActorRelation"[],
  "requires_comment" BOOLEAN NOT NULL DEFAULT false,
  "sort_order" INTEGER NOT NULL DEFAULT 0,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  "created_by_id" CHAR(26),
  "updated_by_id" CHAR(26),
  "deleted_at" TIMESTAMP(3),
  CONSTRAINT "workflow_actions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "workflow_actions_sort_order_check" CHECK ("sort_order" >= 0)
);

CREATE TABLE "action_form_fields" (
  "id" CHAR(26) NOT NULL,
  "action_id" CHAR(26) NOT NULL,
  "key" VARCHAR(80) NOT NULL,
  "label" VARCHAR(120) NOT NULL,
  "field_type" "ActionFormFieldType" NOT NULL,
  "required" BOOLEAN NOT NULL DEFAULT false,
  "options" TEXT[] DEFAULT ARRAY[]::TEXT[],
  "sort_order" INTEGER NOT NULL DEFAULT 0,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  "created_by_id" CHAR(26),
  "updated_by_id" CHAR(26),
  "deleted_at" TIMESTAMP(3),
  CONSTRAINT "action_form_fields_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "action_form_fields_sort_order_check" CHECK ("sort_order" >= 0)
);

CREATE TABLE "workflow_bindings" (
  "id" CHAR(26) NOT NULL,
  "organization_id" CHAR(26) NOT NULL,
  "space_id" CHAR(26) NOT NULL,
  "workflow_definition_id" CHAR(26) NOT NULL,
  "workflow_version_id" CHAR(26) NOT NULL,
  "target_type" "TargetType" NOT NULL DEFAULT 'WORK_ITEM',
  "work_item_type" "WorkItemType",
  "priority" "Priority",
  "is_default" BOOLEAN NOT NULL DEFAULT false,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  "created_by_id" CHAR(26),
  "updated_by_id" CHAR(26),
  "deleted_at" TIMESTAMP(3),
  CONSTRAINT "workflow_bindings_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "object_participants" (
  "id" CHAR(26) NOT NULL,
  "organization_id" CHAR(26) NOT NULL,
  "space_id" CHAR(26) NOT NULL,
  "target_type" "ObjectParticipantTargetType" NOT NULL,
  "target_id" CHAR(26) NOT NULL,
  "user_id" CHAR(26) NOT NULL,
  "relation_type" "ObjectParticipantRelation" NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  "created_by_id" CHAR(26),
  "updated_by_id" CHAR(26),
  "deleted_at" TIMESTAMP(3),
  CONSTRAINT "object_participants_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "spaces_organization_id_idx" ON "spaces"("organization_id");
CREATE INDEX "spaces_owner_id_idx" ON "spaces"("owner_id");
CREATE INDEX "spaces_code_idx" ON "spaces"("code");
CREATE UNIQUE INDEX "spaces_organization_code_active_key" ON "spaces"("organization_id", "code") WHERE "deleted_at" IS NULL;

CREATE INDEX "space_members_organization_id_idx" ON "space_members"("organization_id");
CREATE INDEX "space_members_space_id_idx" ON "space_members"("space_id");
CREATE INDEX "space_members_user_id_idx" ON "space_members"("user_id");
CREATE UNIQUE INDEX "space_members_space_user_active_key" ON "space_members"("space_id", "user_id") WHERE "deleted_at" IS NULL;

CREATE INDEX "versions_organization_id_idx" ON "versions"("organization_id");
CREATE INDEX "versions_space_id_idx" ON "versions"("space_id");
CREATE INDEX "versions_owner_id_idx" ON "versions"("owner_id");
CREATE INDEX "versions_status_idx" ON "versions"("status");
CREATE UNIQUE INDEX "versions_space_name_active_key" ON "versions"("space_id", "name") WHERE "deleted_at" IS NULL;

CREATE INDEX "requirements_organization_id_idx" ON "requirements"("organization_id");
CREATE INDEX "requirements_space_id_idx" ON "requirements"("space_id");
CREATE INDEX "requirements_version_id_idx" ON "requirements"("version_id");
CREATE INDEX "requirements_owner_id_idx" ON "requirements"("owner_id");
CREATE INDEX "requirements_status_idx" ON "requirements"("status");

CREATE INDEX "attachments_organization_id_idx" ON "attachments"("organization_id");
CREATE INDEX "attachments_space_id_idx" ON "attachments"("space_id");
CREATE INDEX "attachments_target_type_target_id_idx" ON "attachments"("target_type", "target_id");
CREATE INDEX "attachments_uploaded_by_id_idx" ON "attachments"("uploaded_by_id");

CREATE INDEX "workflow_definitions_organization_id_idx" ON "workflow_definitions"("organization_id");
CREATE INDEX "workflow_definitions_space_id_idx" ON "workflow_definitions"("space_id");
CREATE INDEX "workflow_definitions_code_idx" ON "workflow_definitions"("code");
CREATE UNIQUE INDEX "workflow_definitions_space_code_active_key" ON "workflow_definitions"("space_id", "code") WHERE "deleted_at" IS NULL;

CREATE INDEX "workflow_versions_workflow_definition_id_idx" ON "workflow_versions"("workflow_definition_id");
CREATE INDEX "workflow_versions_status_idx" ON "workflow_versions"("status");
CREATE INDEX "workflow_versions_published_by_id_idx" ON "workflow_versions"("published_by_id");
CREATE UNIQUE INDEX "workflow_versions_definition_version_active_key" ON "workflow_versions"("workflow_definition_id", "version") WHERE "deleted_at" IS NULL;

CREATE INDEX "workflow_states_workflow_version_id_idx" ON "workflow_states"("workflow_version_id");
CREATE INDEX "workflow_states_category_idx" ON "workflow_states"("category");
CREATE UNIQUE INDEX "workflow_states_version_code_active_key" ON "workflow_states"("workflow_version_id", "code") WHERE "deleted_at" IS NULL;
CREATE UNIQUE INDEX "workflow_states_version_single_start_active_key" ON "workflow_states"("workflow_version_id") WHERE "deleted_at" IS NULL AND "is_start" = true;

CREATE INDEX "workflow_actions_workflow_version_id_idx" ON "workflow_actions"("workflow_version_id");
CREATE INDEX "workflow_actions_from_state_id_idx" ON "workflow_actions"("from_state_id");
CREATE INDEX "workflow_actions_to_state_id_idx" ON "workflow_actions"("to_state_id");
CREATE UNIQUE INDEX "workflow_actions_version_code_active_key" ON "workflow_actions"("workflow_version_id", "code") WHERE "deleted_at" IS NULL;

CREATE INDEX "action_form_fields_action_id_idx" ON "action_form_fields"("action_id");
CREATE UNIQUE INDEX "action_form_fields_action_key_active_key" ON "action_form_fields"("action_id", "key") WHERE "deleted_at" IS NULL;

CREATE INDEX "workflow_bindings_organization_id_idx" ON "workflow_bindings"("organization_id");
CREATE INDEX "workflow_bindings_space_id_idx" ON "workflow_bindings"("space_id");
CREATE INDEX "workflow_bindings_workflow_definition_id_idx" ON "workflow_bindings"("workflow_definition_id");
CREATE INDEX "workflow_bindings_workflow_version_id_idx" ON "workflow_bindings"("workflow_version_id");
CREATE INDEX "workflow_bindings_target_type_work_item_type_idx" ON "workflow_bindings"("target_type", "work_item_type");
CREATE UNIQUE INDEX "workflow_bindings_space_definition_target_work_item_active_key" ON "workflow_bindings"("space_id", "workflow_definition_id", "target_type", "work_item_type") WHERE "deleted_at" IS NULL;

CREATE INDEX "object_participants_organization_id_idx" ON "object_participants"("organization_id");
CREATE INDEX "object_participants_space_id_idx" ON "object_participants"("space_id");
CREATE INDEX "object_participants_user_id_idx" ON "object_participants"("user_id");
CREATE INDEX "object_participants_space_id_user_id_idx" ON "object_participants"("space_id", "user_id");
CREATE INDEX "object_participants_space_id_target_type_target_id_idx" ON "object_participants"("space_id", "target_type", "target_id");
CREATE UNIQUE INDEX "object_participants_space_target_user_relation_active_key" ON "object_participants"("space_id", "target_type", "target_id", "user_id", "relation_type") WHERE "deleted_at" IS NULL;

ALTER TABLE "spaces" ADD CONSTRAINT "spaces_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "spaces" ADD CONSTRAINT "spaces_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "space_members" ADD CONSTRAINT "space_members_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "space_members" ADD CONSTRAINT "space_members_space_id_fkey" FOREIGN KEY ("space_id") REFERENCES "spaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "space_members" ADD CONSTRAINT "space_members_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "versions" ADD CONSTRAINT "versions_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "versions" ADD CONSTRAINT "versions_space_id_fkey" FOREIGN KEY ("space_id") REFERENCES "spaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "versions" ADD CONSTRAINT "versions_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "requirements" ADD CONSTRAINT "requirements_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "requirements" ADD CONSTRAINT "requirements_space_id_fkey" FOREIGN KEY ("space_id") REFERENCES "spaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "requirements" ADD CONSTRAINT "requirements_version_id_fkey" FOREIGN KEY ("version_id") REFERENCES "versions"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "requirements" ADD CONSTRAINT "requirements_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "attachments" ADD CONSTRAINT "attachments_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_space_id_fkey" FOREIGN KEY ("space_id") REFERENCES "spaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_uploaded_by_id_fkey" FOREIGN KEY ("uploaded_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "workflow_definitions" ADD CONSTRAINT "workflow_definitions_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "workflow_definitions" ADD CONSTRAINT "workflow_definitions_space_id_fkey" FOREIGN KEY ("space_id") REFERENCES "spaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "workflow_versions" ADD CONSTRAINT "workflow_versions_workflow_definition_id_fkey" FOREIGN KEY ("workflow_definition_id") REFERENCES "workflow_definitions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "workflow_versions" ADD CONSTRAINT "workflow_versions_published_by_id_fkey" FOREIGN KEY ("published_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "workflow_states" ADD CONSTRAINT "workflow_states_workflow_version_id_fkey" FOREIGN KEY ("workflow_version_id") REFERENCES "workflow_versions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "workflow_actions" ADD CONSTRAINT "workflow_actions_workflow_version_id_fkey" FOREIGN KEY ("workflow_version_id") REFERENCES "workflow_versions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "workflow_actions" ADD CONSTRAINT "workflow_actions_from_state_id_fkey" FOREIGN KEY ("from_state_id") REFERENCES "workflow_states"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "workflow_actions" ADD CONSTRAINT "workflow_actions_to_state_id_fkey" FOREIGN KEY ("to_state_id") REFERENCES "workflow_states"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "action_form_fields" ADD CONSTRAINT "action_form_fields_action_id_fkey" FOREIGN KEY ("action_id") REFERENCES "workflow_actions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "workflow_bindings" ADD CONSTRAINT "workflow_bindings_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "workflow_bindings" ADD CONSTRAINT "workflow_bindings_space_id_fkey" FOREIGN KEY ("space_id") REFERENCES "spaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "workflow_bindings" ADD CONSTRAINT "workflow_bindings_workflow_definition_id_fkey" FOREIGN KEY ("workflow_definition_id") REFERENCES "workflow_definitions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "workflow_bindings" ADD CONSTRAINT "workflow_bindings_workflow_version_id_fkey" FOREIGN KEY ("workflow_version_id") REFERENCES "workflow_versions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "object_participants" ADD CONSTRAINT "object_participants_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "object_participants" ADD CONSTRAINT "object_participants_space_id_fkey" FOREIGN KEY ("space_id") REFERENCES "spaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "object_participants" ADD CONSTRAINT "object_participants_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
