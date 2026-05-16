import type {
  ObjectParticipantRelation,
  ListWorkItemsResponse,
  Priority,
  StatusCategory,
} from "@project-delivery/shared";

export type WorkItemListInput = {
  actorUserId: string;
  visibility: "SPACE" | "PARTICIPANT" | "TESTER";
  page: number;
  pageSize: number;
  sortBy?: string;
  sortOrder?: "asc" | "desc";
  type?: "TASK";
  versionId?: string;
  requirementId?: string;
  intakeItemId?: string;
  reporterId?: string;
  assigneeId?: string;
  statusCategory?: StatusCategory;
  priority?: Priority;
};

export type WorkItemListResult = ListWorkItemsResponse;

export type WorkItemWorkflowSelection = {
  workflowVersionId: string;
  currentStateId: string;
  statusCategory: StatusCategory;
};

export type WorkItemLinkedUsers = {
  versionOwnerId?: string;
  requirementOwnerId?: string;
  requirementVersionId?: string;
  intakeReporterId?: string;
  intakeAssigneeId?: string;
  intakeVersionId?: string;
};

export type CreateWorkItemInput = {
  id: string;
  organizationId: string;
  spaceId: string;
  versionId?: string;
  requirementId?: string;
  intakeItemId?: string;
  title: string;
  description?: string;
  priority: Priority;
  assigneeId?: string;
  reporterId: string;
  workflowVersionId: string;
  currentStateId: string;
  statusCategory: StatusCategory;
  dueDate?: Date;
  lastStatusChangedAt: Date;
  relatedUserIds: string[];
  createdById: string;
};

export type UpdateWorkItemInput = {
  workItemId: string;
  versionId?: string | null;
  requirementId?: string | null;
  intakeItemId?: string | null;
  title?: string;
  description?: string | null;
  priority?: Priority;
  assigneeId?: string | null;
  dueDate?: Date | null;
  relatedUserIds: string[];
  shouldReplaceRelatedParticipants: boolean;
  shouldReplaceAssigneeParticipants: boolean;
  updatedById: string;
  timelineBefore: Record<string, unknown>;
  timelineAfter: Record<string, unknown>;
};

export type ParticipantInput = {
  organizationId: string;
  spaceId: string;
  targetId: string;
  userId: string;
  relationType: ObjectParticipantRelation;
  actorUserId: string;
};
