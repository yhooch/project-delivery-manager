import type {
  BugSeverity,
  BugLifecycleFilterBucket,
  ListBugsResponse,
  Priority,
  SpaceRole,
  StatusCategory,
} from "@project-delivery/shared";

export type BugListInput = {
  actorUserId: string;
  visibility: "SPACE" | "PARTICIPANT";
  page: number;
  pageSize: number;
  sortBy?: string;
  sortOrder?: "asc" | "desc";
  type?: "BUG";
  versionId?: string;
  requirementId?: string;
  intakeItemId?: string;
  reporterId?: string;
  assigneeId?: string;
  statusCategory?: StatusCategory;
  priority?: Priority;
  severity?: BugSeverity;
  relatedTaskId?: string;
  lifecycleBucket?: BugLifecycleFilterBucket;
};

export type BugListResult = ListBugsResponse;

export type BugWorkflowSelection = {
  workflowVersionId: string;
  currentStateId: string;
  statusCategory: StatusCategory;
};

export type BugLinkedUsers = {
  versionOwnerId?: string;
  requirementOwnerId?: string;
  intakeReporterId?: string;
  intakeAssigneeId?: string;
  relatedTaskCreatorId?: string;
  relatedTaskReporterId?: string;
  relatedTaskAssigneeId?: string;
};

export type CreateBugInput = {
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
  severity: BugSeverity;
  stepsToReproduce?: string;
  expectedResult?: string;
  actualResult?: string;
  relatedTaskId?: string;
  relatedUserIds: string[];
  createdById: string;
};

export type UpdateBugInput = {
  workItemId: string;
  versionId?: string | null;
  requirementId?: string | null;
  title?: string;
  description?: string | null;
  priority?: Priority;
  assigneeId?: string | null;
  dueDate?: Date | null;
  severity?: BugSeverity;
  stepsToReproduce?: string | null;
  expectedResult?: string | null;
  actualResult?: string | null;
  fixNote?: string | null;
  regressionResult?: string | null;
  regressionById?: string | null;
  regressionAt?: Date | null;
  relatedTaskId?: string | null;
  relatedUserIds: string[];
  shouldReplaceRelatedParticipants: boolean;
  shouldReplaceAssigneeParticipants: boolean;
  assigneeChanged: boolean;
  updatedById: string;
  timelineBefore: Record<string, unknown>;
  timelineAfter: Record<string, unknown>;
};

export type ParticipantInput = {
  organizationId: string;
  spaceId: string;
  targetId: string;
  userId: string;
  relationType: "CREATOR" | "REPORTER" | "ASSIGNEE" | "RELATED";
  actorUserId: string;
};

export type AuditMetadata = {
  requestId?: string;
  ip?: string;
  userAgent?: string;
};

export type CreateAuditLogInput = AuditMetadata & {
  actionType: "ACCESS_DENIED" | "CREATE" | "UPDATE";
  actorId?: string;
  organizationId: string;
  spaceId?: string;
  targetType: "SPACE" | "WORK_ITEM";
  targetId: string;
  before?: Record<string, unknown>;
  after?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
};

export type SpaceAuditContext = {
  organizationId: string;
  spaceId: string;
};

export type BugAccess = {
  role: SpaceRole;
};
