import type {
  PageResult,
  Priority,
  Requirement,
  RequirementStatus,
  SaveRequirementRequest,
} from "@project-delivery/shared";

export type RequirementListVisibility =
  | "ALL"
  | "NON_DRAFT_OR_PARTICIPANT_DRAFT"
  | "PARTICIPANT";

export type RequirementListInput = {
  actorUserId: string;
  includeDrafts?: boolean;
  ownerId?: string;
  page: number;
  pageSize: number;
  sortBy?: string;
  sortOrder?: "asc" | "desc";
  status?: RequirementStatus;
  versionId?: string;
  visibility: RequirementListVisibility;
};

export type RequirementListResult = PageResult<Requirement>;

export type CreateRequirementDraftInput = {
  id: string;
  organizationId: string;
  spaceId: string;
  versionId?: string;
  createdById: string;
};

export type SaveRequirementInput = {
  requirementId: string;
  title: string;
  summary?: string;
  contentJson: SaveRequirementRequest["contentJson"];
  contentText?: string;
  contentMarkdownCache?: string;
  versionId?: string;
  priority?: Priority;
  ownerId?: string;
  shouldUpdateOwner: boolean;
  updatedById: string;
};

export type ArchiveRequirementInput = {
  requirementId: string;
  updatedById: string;
};
