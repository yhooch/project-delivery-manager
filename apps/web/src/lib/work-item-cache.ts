import type {
  BugSeverity,
  Priority,
  StatusCategory,
  WorkflowDefinitionStatus,
  WorkItemType,
} from "@project-delivery/shared";

export type TaskListCacheInput = {
  assigneeId?: string;
  priority?: Priority | "ALL";
  requirementId?: string;
  spaceId: string;
  statusCategory?: StatusCategory | "ALL";
  versionId?: string;
};

export type BugListCacheInput = TaskListCacheInput & {
  relatedTaskId?: string;
  severity?: BugSeverity | "ALL";
};

export type WorkflowListCacheInput = {
  spaceId: string;
  status?: WorkflowDefinitionStatus | "ALL";
};

export type WorkflowBindingListCacheInput = {
  isDefault?: boolean | "ALL";
  priority?: Priority | "ALL";
  spaceId: string;
  workItemType?: WorkItemType | "ALL";
};

export function createTaskListCacheKey(input: TaskListCacheInput) {
  return [
    "tasks",
    input.spaceId,
    input.versionId || "all-versions",
    input.requirementId || "all-requirements",
    input.assigneeId || "all-assignees",
    input.statusCategory || "all-status-categories",
    input.priority || "all-priorities",
  ].join(":");
}

export function createTaskDetailCacheKey(spaceId: string, workItemId: string) {
  return ["task-detail", spaceId, workItemId].join(":");
}

export function createTaskResourceCacheKey(spaceId: string, workItemId: string) {
  return ["task-resources", spaceId, workItemId].join(":");
}

export function createBugListCacheKey(input: BugListCacheInput) {
  return [
    "bugs",
    input.spaceId,
    input.versionId || "all-versions",
    input.requirementId || "all-requirements",
    input.relatedTaskId || "all-related-tasks",
    input.assigneeId || "all-assignees",
    input.statusCategory || "all-status-categories",
    input.priority || "all-priorities",
    input.severity || "all-severities",
  ].join(":");
}

export function createBugDetailCacheKey(spaceId: string, bugId: string) {
  return ["bug-detail", spaceId, bugId].join(":");
}

export function createBugResourceCacheKey(spaceId: string, bugId: string) {
  return ["bug-resources", spaceId, bugId].join(":");
}

export function createWorkflowListCacheKey(input: WorkflowListCacheInput) {
  return ["workflows", input.spaceId, input.status || "all-statuses"].join(":");
}

export function createWorkflowDetailCacheKey(
  spaceId: string,
  workflowId: string,
) {
  return ["workflow-detail", spaceId, workflowId].join(":");
}

export function createWorkflowVersionCacheKey(
  spaceId: string,
  workflowVersionId: string,
) {
  return ["workflow-version", spaceId, workflowVersionId].join(":");
}

export function createWorkflowBindingsCacheKey(
  input: WorkflowBindingListCacheInput,
) {
  return [
    "workflow-bindings",
    input.spaceId,
    input.workItemType || "all-work-item-types",
    input.priority || "all-priorities",
    input.isDefault === undefined ? "all-default-flags" : String(input.isDefault),
  ].join(":");
}
