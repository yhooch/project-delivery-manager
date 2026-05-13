import type {
  ObjectParticipantRelation,
  PageResult,
  Priority,
  StatusCategory,
  WorkItem,
} from "@project-delivery/shared";

export type WorkItemListInput = {
  actorUserId: string;
  visibility: "SPACE" | "PARTICIPANT";
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

export type WorkItemListResult = PageResult<WorkItem>;

export type WorkItemWorkflowSelection = {
  workflowVersionId: string;
  currentStateId: string;
  statusCategory: StatusCategory;
};

export type WorkItemLinkedUsers = {
  versionOwnerId?: string;
  requirementOwnerId?: string;
  intakeReporterId?: string;
  intakeAssigneeId?: string;
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
  versionId?: string;
  requirementId?: string;
  title?: string;
  description?: string;
  priority?: Priority;
  assigneeId?: string;
  dueDate?: Date;
  blockedReason?: string | null;
  blockedAt?: Date | null;
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
