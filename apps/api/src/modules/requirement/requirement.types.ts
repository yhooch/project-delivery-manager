import type {
  ListRequirementsResponse,
  DocumentStatus,
  Priority,
  RequirementContentFormat,
  RequirementStatus,
  SaveRequirementRequest,
  TagMatch,
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
  query?: string;
  sortBy?: string;
  sortOrder?: "asc" | "desc";
  status?: DocumentStatus | RequirementStatus;
  tagIds?: string;
  tagMatch?: TagMatch;
  versionId?: string;
  visibility: RequirementListVisibility;
};

export type RequirementListResult = ListRequirementsResponse;

export type CreateRequirementDraftInput = {
  id: string;
  organizationId: string;
  spaceId: string;
  contentFormat?: RequirementContentFormat;
  versionId?: string;
  createdById: string;
  tagIds?: string[];
};

type SaveRequirementBaseInput = {
  baseRevision: number;
  requirementId: string;
  title: string;
  summary?: string;
  contentText: string;
  versionId?: string | null;
  cascadeVersionChange?: boolean;
  priority?: Priority;
  ownerId?: string;
  shouldUpdateOwner: boolean;
  updatedById: string;
};

type SaveTiptapRequirementInput = {
  contentFormat: "TIPTAP_JSON";
  contentJson: NonNullable<SaveRequirementRequest["contentJson"]>;
  contentMarkdown?: never;
  contentMarkdownCache?: string;
};

type SaveMarkdownRequirementInput = {
  contentFormat: "MARKDOWN";
  contentJson?: never;
  contentMarkdown: string;
  contentMarkdownCache?: never;
};

export type SaveRequirementInput = SaveRequirementBaseInput &
  (SaveTiptapRequirementInput | SaveMarkdownRequirementInput);

export type RequirementVersionCascadeImpact = TraceVersionCascadeImpact & {
  intakeItemCount: number;
};

export type ArchiveRequirementInput = {
  baseRevision: number;
  requirementId: string;
  updatedById: string;
};

export type DeleteRequirementDraftInput = {
  deletedById: string;
  requirementId: string;
};
