import type {
  DefaultWorkflowSummary,
  GetMyWorkbenchViewResponse,
  GetSpaceExceptionsViewResponse,
  GetSpaceOverviewViewResponse,
  PageResult,
  RecordStatus,
  Space,
  SpaceMember,
  SpaceMemberWithUser,
  SpaceOverviewStats,
  SpaceRole,
  SpaceSummary,
  SpaceExceptionsViewQuery,
  WorkbenchViewQuery,
  VersionSummary,
} from "@project-delivery/shared";

import type { Prisma } from "../../generated/prisma/client";

export type CreateSpaceInput = {
  id: string;
  adminMemberId: string;
  ownerMemberId?: string;
  organizationId: string;
  name: string;
  code: string;
  description?: string;
  ownerId?: string;
  staleThresholdDays: number;
  actorUserId: string;
};

export type CreatedSpaceWithAdmin = {
  space: Space;
  adminMembership: SpaceMember;
};

export type CreateSpaceInTransaction = (
  tx: Prisma.TransactionClient,
  created: CreatedSpaceWithAdmin,
) => Promise<void>;

export type SpaceListInput = {
  aggregateActorUserId?: string;
  page: number;
  pageSize: number;
  sortBy?: string;
  sortOrder?: "asc" | "desc";
  status?: RecordStatus;
};

export type SpaceListResult = {
  items: SpaceSummary[];
  total: number;
};

export type SpaceAccess = {
  space: Space;
  role: SpaceRole;
};

export type UpdateSpaceInput = {
  spaceId: string;
  name?: string;
  code?: string;
  description?: string | null;
  ownerId?: string | null;
  status?: RecordStatus;
  staleThresholdDays?: number;
  updatedById: string;
};

export type SpaceMemberListInput = {
  page: number;
  pageSize: number;
  role?: SpaceRole;
  sortBy?: string;
  sortOrder?: "asc" | "desc";
  status?: RecordStatus;
};

export type SpaceMemberListResult = PageResult<SpaceMemberWithUser>;

export type AddSpaceMemberInput = {
  id: string;
  organizationId: string;
  spaceId: string;
  userId: string;
  role: SpaceRole;
  createdById: string;
};

export type UpdateSpaceMemberInput = {
  memberId: string;
  spaceId: string;
  role?: SpaceRole;
  status?: RecordStatus;
  updatedById: string;
};

export type SpaceOverviewData = {
  space: Space;
  currentVersion?: VersionSummary;
  stats: SpaceOverviewStats;
  defaultWorkflows: DefaultWorkflowSummary[];
};

export type MyWorkbenchViewInput = Pick<
  WorkbenchViewQuery,
  | "assigneeId"
  | "exceptionType"
  | "page"
  | "pageSize"
  | "statusCategory"
  | "versionId"
  | "workItemType"
> & {
  actorUserId: string;
  organizationId: string;
  spaceId?: string;
};

export type SpaceOverviewViewInput = {
  actorUserId: string;
  role: SpaceRole;
  space: Space;
  versionId?: string;
};

export type SpaceExceptionsViewInput = Pick<
  SpaceExceptionsViewQuery,
  | "assigneeId"
  | "exceptionType"
  | "page"
  | "pageSize"
  | "statusCategory"
  | "versionId"
  | "workItemType"
> & {
  actorUserId: string;
  role: SpaceRole;
  space: Space;
};

export type MyWorkbenchViewResult = GetMyWorkbenchViewResponse;

export type SpaceOverviewViewResult = GetSpaceOverviewViewResponse;

export type SpaceExceptionsViewResult = GetSpaceExceptionsViewResponse;
