import type { IntakeStatus, Priority } from "@project-delivery/shared";

export type IntakeItemListCacheInput = {
  priority?: Priority | "ALL";
  requirementId?: string;
  spaceId: string;
  status?: IntakeStatus | "ALL";
  versionId?: string;
};

export function createIntakeItemListCacheKey(input: IntakeItemListCacheInput) {
  return [
    "intake-items",
    input.spaceId,
    input.status || "all-statuses",
    input.versionId || "all-versions",
    input.requirementId || "all-requirements",
    input.priority || "all-priorities",
  ].join(":");
}

export function createIntakeItemDetailCacheKey(
  spaceId: string,
  intakeItemId: string,
) {
  return ["intake-item-detail", spaceId, intakeItemId].join(":");
}

export function createIntakeItemResourceCacheKey(
  spaceId: string,
  intakeItemId: string,
) {
  return ["intake-item-resources", spaceId, intakeItemId].join(":");
}

export function createIntakeRelatedWorkItemsCacheKey(
  spaceId: string,
  intakeItemId: string,
) {
  return ["intake-related-work-items", spaceId, intakeItemId].join(":");
}
