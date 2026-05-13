import type {
  StatusCategory,
  ViewExceptionType,
  WorkItemType,
} from "@project-delivery/shared";

export type M4PagedViewCacheInput = {
  page?: number;
  pageSize?: number;
  sortBy?: string;
  sortOrder?: "asc" | "desc";
};

export type MyWorkbenchViewCacheInput = M4PagedViewCacheInput & {
  assigneeId?: string;
  exceptionType?: ViewExceptionType | "ALL";
  organizationId: string;
  spaceId?: string;
  statusCategory?: StatusCategory | "ALL";
  versionId?: string;
  workItemType?: WorkItemType | "ALL";
};

export type SpaceOverviewViewCacheInput = {
  organizationId?: string;
  spaceId: string;
  versionId?: string;
};

export type VersionBoardViewCacheInput = M4PagedViewCacheInput & {
  assigneeId?: string;
  organizationId?: string;
  spaceId?: string;
  statusCategory?: StatusCategory | "ALL";
  versionId: string;
  workItemType?: WorkItemType | "ALL";
};

export type SpaceExceptionsViewCacheInput = M4PagedViewCacheInput & {
  assigneeId?: string;
  exceptionType?: ViewExceptionType | "ALL";
  organizationId?: string;
  spaceId: string;
  statusCategory?: StatusCategory | "ALL";
  versionId?: string;
  workItemType?: WorkItemType | "ALL";
};

export function createMyWorkbenchViewCacheKey(
  input: MyWorkbenchViewCacheInput,
) {
  return [
    "m4-my-workbench",
    input.organizationId,
    cacheSegment(input.spaceId, "all-spaces"),
    cacheSegment(input.versionId, "all-versions"),
    cacheSegment(input.assigneeId, "all-assignees"),
    cacheSegment(input.statusCategory, "all-status-categories"),
    cacheSegment(input.workItemType, "all-work-item-types"),
    cacheSegment(input.exceptionType, "all-exception-types"),
    paginationSegment(input),
  ].join(":");
}

export function createSpaceOverviewViewCacheKey(
  input: SpaceOverviewViewCacheInput,
) {
  return [
    "m4-space-overview",
    input.spaceId,
    cacheSegment(input.organizationId, "any-organization"),
    cacheSegment(input.versionId, "all-versions"),
  ].join(":");
}

export function createVersionBoardViewCacheKey(
  input: VersionBoardViewCacheInput,
) {
  return [
    "m4-version-board",
    input.versionId,
    cacheSegment(input.organizationId, "any-organization"),
    cacheSegment(input.spaceId, "any-space"),
    cacheSegment(input.assigneeId, "all-assignees"),
    cacheSegment(input.statusCategory, "all-status-categories"),
    cacheSegment(input.workItemType, "all-work-item-types"),
    paginationSegment(input),
  ].join(":");
}

export function createSpaceExceptionsViewCacheKey(
  input: SpaceExceptionsViewCacheInput,
) {
  return [
    "m4-space-exceptions",
    input.spaceId,
    cacheSegment(input.organizationId, "any-organization"),
    cacheSegment(input.versionId, "all-versions"),
    cacheSegment(input.assigneeId, "all-assignees"),
    cacheSegment(input.statusCategory, "all-status-categories"),
    cacheSegment(input.workItemType, "all-work-item-types"),
    cacheSegment(input.exceptionType, "all-exception-types"),
    paginationSegment(input),
  ].join(":");
}

function paginationSegment(input: M4PagedViewCacheInput) {
  return [
    `page=${input.page ?? 1}`,
    `pageSize=${input.pageSize ?? 20}`,
    `sortBy=${cacheSegment(input.sortBy, "default")}`,
    `sortOrder=${cacheSegment(input.sortOrder, "default")}`,
  ].join(",");
}

function cacheSegment(
  value: string | number | undefined,
  fallback: string,
): string {
  if (value === undefined || value === "") {
    return fallback;
  }

  if (value === "ALL") {
    return fallback;
  }

  return String(value);
}
