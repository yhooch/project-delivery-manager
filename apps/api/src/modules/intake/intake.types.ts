import type {
  ConvertIntakeItemToWorkItemsResponse,
  CreateIntakeItemRequest,
  IntakeSourceType,
  IntakeStatus,
  ListIntakeItemsResponse,
  Priority,
  StatusCategory,
  UpdateIntakeItemRequest,
} from "@project-delivery/shared";

export type IntakeItemListInput = {
  assigneeId?: string;
  page: number;
  pageSize: number;
  priority?: Priority;
  reporterId?: string;
  requirementId?: string;
  restrictToParticipantUserId?: string;
  sortBy?: string;
  sortOrder?: "asc" | "desc";
  sourceType?: IntakeSourceType;
  status?: IntakeStatus;
  versionId?: string;
};

export type IntakeItemListResult = ListIntakeItemsResponse;

export type CreateIntakeItemInput = CreateIntakeItemRequest & {
  id: string;
  organizationId: string;
  reporterId: string;
  spaceId: string;
};

export type UpdateIntakeItemInput = UpdateIntakeItemRequest & {
  intakeItemId: string;
  shouldUpdateAssignee: boolean;
  shouldUpdateSourceObject: boolean;
  updatedById: string;
};

export type UpdateIntakeItemStatusInput = {
  actorUserId: string;
  intakeItemId: string;
  status: Extract<IntakeStatus, "ACCEPTED" | "DEFERRED" | "REJECTED">;
};

export type ConvertIntakeItemTaskInput = {
  id: string;
  versionId?: string;
  requirementId?: string;
  title: string;
  description?: string;
  priority: Priority;
  assigneeId?: string;
  reporterId: string;
  workflowVersionId: string;
  currentStateId: string;
  statusCategory: StatusCategory;
  dueDate?: Date;
  relatedUserIds: string[];
};

export type ConvertIntakeItemToWorkItemsInput = {
  actorUserId: string;
  intakeItemId: string;
  tasks: ConvertIntakeItemTaskInput[];
};

export type ConvertIntakeItemToWorkItemsResult =
  ConvertIntakeItemToWorkItemsResponse;
