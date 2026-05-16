import type {
  ListRequirementsResponse,
  Priority,
  RequirementStatus,
  SaveRequirementRequest,
} from "@project-delivery/shared";
import type { TraceVersionCascadeImpact } from "../trace/trace-version-policy";

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

export type RequirementListResult = ListRequirementsResponse;

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
  versionId?: string | null;
  cascadeVersionChange?: boolean;
  priority?: Priority;
  ownerId?: string;
  shouldUpdateOwner: boolean;
  updatedById: string;
};

export type RequirementVersionCascadeImpact = TraceVersionCascadeImpact & {
  intakeItemCount: number;
};

export type ArchiveRequirementInput = {
  requirementId: string;
  updatedById: string;
};

export type DeleteRequirementDraftInput = {
  deletedById: string;
  requirementId: string;
};
