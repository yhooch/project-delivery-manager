import type {
  GetVersionBoardViewResponse,
  PageResult,
  StatusCategory,
  Version,
  VersionBoardViewQuery,
  VersionStatus,
  ViewWorkItemSummary,
  WorkItemType,
} from "@project-delivery/shared";

export type VersionListInput = {
  ownerId?: string;
  page: number;
  pageSize: number;
  sortBy?: string;
  sortOrder?: "asc" | "desc";
  status?: VersionStatus;
};

export type VersionListResult = PageResult<Version>;

export type VersionBoardVisibility = "SPACE" | "PARTICIPANT";

export type VersionBoardInput = VersionBoardViewQuery & {
  actorUserId: string;
  organizationId: string;
  spaceId: string;
  versionId: string;
  staleThresholdDays: number;
  visibility: VersionBoardVisibility;
};

export type VersionBoardResult = Pick<
  GetVersionBoardViewResponse,
  "columns" | "items"
>;

export type VersionBoardWorkItemRecord = {
  id: string;
  type: WorkItemType;
  organizationId: string;
  spaceId: string;
  versionId: string | null;
  requirementId: string | null;
  intakeItemId: string | null;
  title: string;
  priority: ViewWorkItemSummary["priority"];
  assigneeId: string | null;
  reporterId: string;
  workflowVersionId: string;
  currentStateId: string;
  statusCategory: StatusCategory;
  dueDate: Date | null;
  lastStatusChangedAt: Date;
  lastActionAt: Date | null;
  blockedReason: string | null;
  blockedAt: Date | null;
  currentState: {
    code: string;
    name: string;
    category: StatusCategory;
  };
  bugDetail: {
    regressionAt: Date | null;
  } | null;
};

export type CreateVersionInput = {
  id: string;
  organizationId: string;
  spaceId: string;
  name: string;
  target?: string;
  description?: string;
  ownerId?: string;
  status?: VersionStatus;
  startDate?: Date;
  targetDate?: Date;
  releaseDate?: Date;
  createdById: string;
};

export type UpdateVersionInput = {
  versionId: string;
  name?: string;
  target?: string;
  description?: string;
  ownerId?: string;
  status?: VersionStatus;
  startDate?: Date;
  targetDate?: Date;
  releaseDate?: Date;
  updatedById: string;
};
