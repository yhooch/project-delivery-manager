CREATE TYPE "IntakeStatus" AS ENUM ('PENDING', 'ACCEPTED', 'DEFERRED', 'REJECTED', 'CONVERTED');
CREATE TYPE "IntakeSourceType" AS ENUM ('REQUIREMENT_CHANGE', 'DEFECT_PROBLEM', 'PROJECT_PLAN', 'MEETING_DECISION', 'AD_HOC', 'IMPLEMENTATION', 'OPERATIONS', 'RELEASE', 'EXTERNAL_COLLABORATION');
CREATE TYPE "CommentTargetType" AS ENUM ('REQUIREMENT', 'INTAKE_ITEM', 'WORK_ITEM');
CREATE TYPE "TimelineEventType" AS ENUM ('CREATED', 'UPDATED', 'STATUS_CHANGED', 'ACTION_EXECUTED', 'ASSIGNEE_CHANGED', 'COMMENTED', 'ATTACHMENT_ADDED', 'CLOSED', 'REOPENED');

CREATE TABLE "intake_items" (
  "id" CHAR(26) NOT NULL,
  "organization_id" CHAR(26) NOT NULL,
  "space_id" CHAR(26) NOT NULL,
  "version_id" CHAR(26),
  "requirement_id" CHAR(26),
  "title" VARCHAR(200) NOT NULL,
  "description" VARCHAR(8000),
  "source_type" "IntakeSourceType" NOT NULL,
  "source_object" JSONB,
  "reporter_id" CHAR(26) NOT NULL,
  "assignee_id" CHAR(26),
  "priority" "Priority",
  "status" "IntakeStatus" NOT NULL DEFAULT 'PENDING',
  "accepted_at" TIMESTAMP(3),
  "converted_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  "created_by_id" CHAR(26),
  "updated_by_id" CHAR(26),
  "deleted_at" TIMESTAMP(3),
  CONSTRAINT "intake_items_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "work_items" (
  "id" CHAR(26) NOT NULL,
  "organization_id" CHAR(26) NOT NULL,
  "space_id" CHAR(26) NOT NULL,
  "version_id" CHAR(26),
  "requirement_id" CHAR(26),
  "intake_item_id" CHAR(26),
  "type" "WorkItemType" NOT NULL DEFAULT 'TASK',
  "title" VARCHAR(200) NOT NULL,
  "description" VARCHAR(8000),
  "priority" "Priority" NOT NULL DEFAULT 'MEDIUM',
  "assignee_id" CHAR(26),
  "reporter_id" CHAR(26) NOT NULL,
  "workflow_version_id" CHAR(26) NOT NULL,
  "current_state_id" CHAR(26) NOT NULL,
  "status_category" "StatusCategory" NOT NULL,
  "due_date" TIMESTAMP(3),
  "last_status_changed_at" TIMESTAMP(3) NOT NULL,
  "last_action_at" TIMESTAMP(3),
  "blocked_reason" VARCHAR(1000),
  "blocked_at" TIMESTAMP(3),
  "closed_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  "created_by_id" CHAR(26),
  "updated_by_id" CHAR(26),
  "deleted_at" TIMESTAMP(3),
  CONSTRAINT "work_items_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "comments" (
  "id" CHAR(26) NOT NULL,
  "organization_id" CHAR(26) NOT NULL,
  "space_id" CHAR(26) NOT NULL,
  "target_type" "CommentTargetType" NOT NULL,
  "target_id" CHAR(26) NOT NULL,
  "author_id" CHAR(26) NOT NULL,
  "body" VARCHAR(8000) NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  "created_by_id" CHAR(26),
  "updated_by_id" CHAR(26),
  "deleted_at" TIMESTAMP(3),
  CONSTRAINT "comments_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "timeline_events" (
  "id" CHAR(26) NOT NULL,
  "organization_id" CHAR(26) NOT NULL,
  "space_id" CHAR(26) NOT NULL,
  "target_type" "TargetType" NOT NULL,
  "target_id" CHAR(26) NOT NULL,
  "event_type" "TimelineEventType" NOT NULL,
  "actor_id" CHAR(26) NOT NULL,
  "title" VARCHAR(200) NOT NULL,
  "detail" TEXT,
  "before" JSONB,
  "after" JSONB,
  "metadata" JSONB,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  "created_by_id" CHAR(26),
  "updated_by_id" CHAR(26),
  "deleted_at" TIMESTAMP(3),
  CONSTRAINT "timeline_events_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "intake_items_organization_id_idx" ON "intake_items"("organization_id");
CREATE INDEX "intake_items_space_id_idx" ON "intake_items"("space_id");
CREATE INDEX "intake_items_version_id_idx" ON "intake_items"("version_id");
CREATE INDEX "intake_items_requirement_id_idx" ON "intake_items"("requirement_id");
CREATE INDEX "intake_items_reporter_id_idx" ON "intake_items"("reporter_id");
CREATE INDEX "intake_items_assignee_id_idx" ON "intake_items"("assignee_id");
CREATE INDEX "intake_items_status_idx" ON "intake_items"("status");
CREATE INDEX "intake_items_priority_idx" ON "intake_items"("priority");
CREATE INDEX "intake_items_source_type_idx" ON "intake_items"("source_type");
CREATE INDEX "intake_items_space_id_status_idx" ON "intake_items"("space_id", "status");
CREATE INDEX "intake_items_space_id_assignee_id_idx" ON "intake_items"("space_id", "assignee_id");

CREATE INDEX "work_items_organization_id_idx" ON "work_items"("organization_id");
CREATE INDEX "work_items_space_id_idx" ON "work_items"("space_id");
CREATE INDEX "work_items_version_id_idx" ON "work_items"("version_id");
CREATE INDEX "work_items_requirement_id_idx" ON "work_items"("requirement_id");
CREATE INDEX "work_items_intake_item_id_idx" ON "work_items"("intake_item_id");
CREATE INDEX "work_items_reporter_id_idx" ON "work_items"("reporter_id");
CREATE INDEX "work_items_assignee_id_idx" ON "work_items"("assignee_id");
CREATE INDEX "work_items_workflow_version_id_idx" ON "work_items"("workflow_version_id");
CREATE INDEX "work_items_current_state_id_idx" ON "work_items"("current_state_id");
CREATE INDEX "work_items_type_idx" ON "work_items"("type");
CREATE INDEX "work_items_status_category_idx" ON "work_items"("status_category");
CREATE INDEX "work_items_priority_idx" ON "work_items"("priority");
CREATE INDEX "work_items_due_date_idx" ON "work_items"("due_date");
CREATE INDEX "work_items_last_status_changed_at_idx" ON "work_items"("last_status_changed_at");
CREATE INDEX "work_items_space_id_intake_item_id_idx" ON "work_items"("space_id", "intake_item_id");
CREATE INDEX "work_items_space_id_assignee_id_idx" ON "work_items"("space_id", "assignee_id");
CREATE INDEX "work_items_space_id_status_category_idx" ON "work_items"("space_id", "status_category");
CREATE INDEX "work_items_space_id_type_idx" ON "work_items"("space_id", "type");

CREATE INDEX "comments_organization_id_idx" ON "comments"("organization_id");
CREATE INDEX "comments_space_id_idx" ON "comments"("space_id");
CREATE INDEX "comments_author_id_idx" ON "comments"("author_id");
CREATE INDEX "comments_created_at_idx" ON "comments"("created_at");
CREATE INDEX "comments_target_type_target_id_idx" ON "comments"("target_type", "target_id");
CREATE INDEX "comments_space_id_target_type_target_id_idx" ON "comments"("space_id", "target_type", "target_id");
CREATE INDEX "comments_space_id_target_type_target_id_created_at_idx" ON "comments"("space_id", "target_type", "target_id", "created_at");
CREATE INDEX "comments_space_id_author_id_created_at_idx" ON "comments"("space_id", "author_id", "created_at");
CREATE INDEX "comments_org_space_target_created_idx" ON "comments"("organization_id", "space_id", "target_type", "target_id", "created_at");
CREATE INDEX "comments_org_author_created_idx" ON "comments"("organization_id", "author_id", "created_at");

CREATE INDEX "timeline_events_organization_id_idx" ON "timeline_events"("organization_id");
CREATE INDEX "timeline_events_space_id_idx" ON "timeline_events"("space_id");
CREATE INDEX "timeline_events_actor_id_idx" ON "timeline_events"("actor_id");
CREATE INDEX "timeline_events_created_at_idx" ON "timeline_events"("created_at");
CREATE INDEX "timeline_events_target_type_target_id_idx" ON "timeline_events"("target_type", "target_id");
CREATE INDEX "timeline_events_space_id_target_type_target_id_idx" ON "timeline_events"("space_id", "target_type", "target_id");
CREATE INDEX "timeline_events_space_id_target_type_target_id_created_at_idx" ON "timeline_events"("space_id", "target_type", "target_id", "created_at");
CREATE INDEX "timeline_events_space_id_actor_id_created_at_idx" ON "timeline_events"("space_id", "actor_id", "created_at");
CREATE INDEX "timeline_events_org_space_target_created_idx" ON "timeline_events"("organization_id", "space_id", "target_type", "target_id", "created_at");
CREATE INDEX "timeline_events_org_actor_created_idx" ON "timeline_events"("organization_id", "actor_id", "created_at");
CREATE INDEX "timeline_events_event_type_idx" ON "timeline_events"("event_type");

ALTER TABLE "intake_items" ADD CONSTRAINT "intake_items_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "intake_items" ADD CONSTRAINT "intake_items_space_id_fkey" FOREIGN KEY ("space_id") REFERENCES "spaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "intake_items" ADD CONSTRAINT "intake_items_version_id_fkey" FOREIGN KEY ("version_id") REFERENCES "versions"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "intake_items" ADD CONSTRAINT "intake_items_requirement_id_fkey" FOREIGN KEY ("requirement_id") REFERENCES "requirements"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "intake_items" ADD CONSTRAINT "intake_items_reporter_id_fkey" FOREIGN KEY ("reporter_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "intake_items" ADD CONSTRAINT "intake_items_assignee_id_fkey" FOREIGN KEY ("assignee_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "work_items" ADD CONSTRAINT "work_items_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "work_items" ADD CONSTRAINT "work_items_space_id_fkey" FOREIGN KEY ("space_id") REFERENCES "spaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "work_items" ADD CONSTRAINT "work_items_version_id_fkey" FOREIGN KEY ("version_id") REFERENCES "versions"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "work_items" ADD CONSTRAINT "work_items_requirement_id_fkey" FOREIGN KEY ("requirement_id") REFERENCES "requirements"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "work_items" ADD CONSTRAINT "work_items_intake_item_id_fkey" FOREIGN KEY ("intake_item_id") REFERENCES "intake_items"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "work_items" ADD CONSTRAINT "work_items_assignee_id_fkey" FOREIGN KEY ("assignee_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "work_items" ADD CONSTRAINT "work_items_reporter_id_fkey" FOREIGN KEY ("reporter_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "work_items" ADD CONSTRAINT "work_items_workflow_version_id_fkey" FOREIGN KEY ("workflow_version_id") REFERENCES "workflow_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "work_items" ADD CONSTRAINT "work_items_current_state_id_fkey" FOREIGN KEY ("current_state_id") REFERENCES "workflow_states"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "comments" ADD CONSTRAINT "comments_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "comments" ADD CONSTRAINT "comments_space_id_fkey" FOREIGN KEY ("space_id") REFERENCES "spaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "comments" ADD CONSTRAINT "comments_author_id_fkey" FOREIGN KEY ("author_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "timeline_events" ADD CONSTRAINT "timeline_events_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "timeline_events" ADD CONSTRAINT "timeline_events_space_id_fkey" FOREIGN KEY ("space_id") REFERENCES "spaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "timeline_events" ADD CONSTRAINT "timeline_events_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
