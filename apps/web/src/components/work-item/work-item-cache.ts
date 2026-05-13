import type { Priority, StatusCategory } from "@project-delivery/shared";

export type WorkItemListCacheInput = {
  assigneeId?: string;
  priority?: Priority | "ALL";
  requirementId?: string;
  spaceId: string;
  statusCategory?: StatusCategory | "ALL";
  versionId?: string;
};

export function createWorkItemListCacheKey(input: WorkItemListCacheInput) {
  return [
    "work-items",
    input.spaceId,
    input.versionId || "all-versions",
    input.requirementId || "all-requirements",
    input.assigneeId || "all-assignees",
    input.statusCategory || "all-status-categories",
    input.priority || "all-priorities",
  ].join(":");
}

export function createWorkItemDetailCacheKey(spaceId: string, workItemId: string) {
  return ["work-item-detail", spaceId, workItemId].join(":");
}

export function createWorkItemResourceCacheKey(
  spaceId: string,
  workItemId: string,
) {
  return ["work-item-resources", spaceId, workItemId].join(":");
}
