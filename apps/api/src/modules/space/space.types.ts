import type {
  DefaultWorkflowSummary,
  PageResult,
  RecordStatus,
  Space,
  SpaceMember,
  SpaceMemberWithUser,
  SpaceOverviewStats,
  SpaceRole,
  SpaceSummary,
  VersionSummary,
} from "@project-delivery/shared";

export type CreateSpaceInput = {
  id: string;
  adminMemberId: string;
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

export type SpaceListInput = {
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
  description?: string;
  ownerId?: string;
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
