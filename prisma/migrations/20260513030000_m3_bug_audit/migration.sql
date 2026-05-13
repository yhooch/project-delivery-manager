CREATE TYPE "BugSeverity" AS ENUM ('BLOCKER', 'CRITICAL', 'MAJOR', 'MINOR', 'TRIVIAL');

CREATE TABLE "bug_details" (
  "work_item_id" CHAR(26) NOT NULL,
  "severity" "BugSeverity" NOT NULL,
  "steps_to_reproduce" VARCHAR(8000),
  "expected_result" VARCHAR(8000),
  "actual_result" VARCHAR(8000),
  "fix_note" VARCHAR(8000),
  "regression_result" VARCHAR(8000),
  "regression_by_id" CHAR(26),
  "regression_at" TIMESTAMP(3),
  "related_task_id" CHAR(26),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  "created_by_id" CHAR(26),
  "updated_by_id" CHAR(26),
  "deleted_at" TIMESTAMP(3),
  CONSTRAINT "bug_details_pkey" PRIMARY KEY ("work_item_id")
);

CREATE TABLE "audit_logs" (
  "id" CHAR(26) NOT NULL,
  "organization_id" CHAR(26) NOT NULL,
  "space_id" CHAR(26),
  "actor_id" CHAR(26),
  "action_type" VARCHAR(80) NOT NULL,
  "target_type" VARCHAR(80) NOT NULL,
  "target_id" CHAR(26) NOT NULL,
  "request_id" VARCHAR(128),
  "ip" VARCHAR(64),
  "user_agent" VARCHAR(500),
  "before" JSONB,
  "after" JSONB,
  "metadata" JSONB,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "bug_details_severity_idx" ON "bug_details"("severity");
CREATE INDEX "bug_details_regression_by_id_idx" ON "bug_details"("regression_by_id");
CREATE INDEX "bug_details_related_task_id_idx" ON "bug_details"("related_task_id");

CREATE INDEX "audit_logs_organization_id_idx" ON "audit_logs"("organization_id");
CREATE INDEX "audit_logs_space_id_idx" ON "audit_logs"("space_id");
CREATE INDEX "audit_logs_actor_id_idx" ON "audit_logs"("actor_id");
CREATE INDEX "audit_logs_action_type_idx" ON "audit_logs"("action_type");
CREATE INDEX "audit_logs_request_id_idx" ON "audit_logs"("request_id");
CREATE INDEX "audit_logs_created_at_idx" ON "audit_logs"("created_at");
CREATE INDEX "audit_logs_target_type_target_id_idx" ON "audit_logs"("target_type", "target_id");
CREATE INDEX "audit_logs_org_request_idx" ON "audit_logs"("organization_id", "request_id");
CREATE INDEX "audit_logs_org_space_target_created_idx" ON "audit_logs"("organization_id", "space_id", "target_type", "target_id", "created_at");

ALTER TABLE "bug_details" ADD CONSTRAINT "bug_details_work_item_id_fkey" FOREIGN KEY ("work_item_id") REFERENCES "work_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "bug_details" ADD CONSTRAINT "bug_details_regression_by_id_fkey" FOREIGN KEY ("regression_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "bug_details" ADD CONSTRAINT "bug_details_related_task_id_fkey" FOREIGN KEY ("related_task_id") REFERENCES "work_items"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_space_id_fkey" FOREIGN KEY ("space_id") REFERENCES "spaces"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
