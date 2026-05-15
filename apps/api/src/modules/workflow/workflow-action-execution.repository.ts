import type {
  ActionFormFieldType,
  AuditAction,
  BugDetail,
  ObjectParticipantRelation,
  SpaceRole,
  StatusCategory,
  TimelineEventType,
  WorkflowActorRelation,
  WorkItem,
} from "@project-delivery/shared";

export const WORKFLOW_ACTION_EXECUTION_REPOSITORY = Symbol(
  "WORKFLOW_ACTION_EXECUTION_REPOSITORY",
);

export type ExecutableWorkItem = WorkItem & {
  bugDetail?: ExecutableBugDetail;
  closedAt?: string;
  createdById?: string;
  currentState?: {
    code: string;
    name: string;
  };
};

export type ExecutableBugDetail = Omit<BugDetail, "regressionBy"> & {
  regressionById?: string;
};

export type ExecutableWorkflowActionFormField = {
  id: string;
  key: string;
  label: string;
  fieldType: ActionFormFieldType;
  required: boolean;
  options: string[];
  order: number;
};

export type ExecutableWorkflowState = {
  id: string;
  code: string;
  category: StatusCategory;
  isEnd: boolean;
};

export type ExecutableWorkflowAction = {
  id: string;
  code: string;
  name: string;
  workflowVersionId: string;
  fromStateId: string;
  toStateId: string;
  fromState: ExecutableWorkflowState;
  toState: ExecutableWorkflowState;
  allowedSpaceRoles: SpaceRole[];
  actorRelations: WorkflowActorRelation[];
  requiresComment: boolean;
  formFields: ExecutableWorkflowActionFormField[];
  order: number;
};

export type WorkflowActionActorSpaceAccess = {
  role: SpaceRole;
  spaceOwnerId?: string;
};

export type UpdateWorkflowActionStateInput = {
  actorUserId: string;
  assigneeId?: string | null;
  blockedAt?: Date | null;
  blockedReason?: string | null;
  bugDetailPatch?: WorkflowActionBugDetailPatch;
  closedAt?: Date | null;
  currentStateId: string;
  expectedCurrentStateId: string;
  lastActionAt: Date;
  lastStatusChangedAt: Date;
  statusCategory: StatusCategory;
  workItemId: string;
};

export type WorkflowActionBugDetailPatch = {
  fixNote?: string | null;
  regressionAt?: Date | null;
  regressionById?: string | null;
  regressionResult?: string | null;
};

export type CreateWorkflowActionTimelineInput = {
  actorUserId: string;
  after: Record<string, unknown>;
  before: Record<string, unknown>;
  detail?: string;
  eventType: TimelineEventType;
  metadata: Record<string, unknown>;
  organizationId: string;
  spaceId: string;
  targetId: string;
  title: string;
};

export type ReplaceWorkflowActionParticipantsInput = {
  actorUserId: string;
  organizationId: string;
  relationType: Extract<ObjectParticipantRelation, "ASSIGNEE">;
  spaceId: string;
  targetId: string;
  userIds: string[];
};

export type CreateWorkflowActionAuditLogInput = {
  actionType: AuditAction;
  actorUserId: string;
  after?: Record<string, unknown>;
  before?: Record<string, unknown>;
  ip?: string;
  metadata?: Record<string, unknown>;
  organizationId: string;
  requestId?: string;
  spaceId?: string;
  targetId: string;
  targetType: string;
  userAgent?: string;
};

export type WorkflowActionExecutionTransaction = {
  createTimelineEvent(input: CreateWorkflowActionTimelineInput): Promise<void>;
  findActionById(
    actionId: string,
  ): Promise<ExecutableWorkflowAction | undefined>;
  findWorkItemById(workItemId: string): Promise<ExecutableWorkItem | undefined>;
  findActiveSpaceAccess(input: {
    actorUserId: string;
    organizationId: string;
    spaceId: string;
  }): Promise<WorkflowActionActorSpaceAccess | undefined>;
  isActiveSpaceMember(input: {
    organizationId: string;
    spaceId: string;
    userId: string;
  }): Promise<boolean>;
  isWorkItemParticipant(input: {
    spaceId: string;
    userId: string;
    workItemId: string;
  }): Promise<boolean>;
  listActionsForState(input: {
    fromStateId: string;
    workflowVersionId: string;
  }): Promise<ExecutableWorkflowAction[]>;
  replaceAssigneeParticipants(
    input: ReplaceWorkflowActionParticipantsInput,
  ): Promise<void>;
  updateWorkItemState(
    input: UpdateWorkflowActionStateInput,
  ): Promise<ExecutableWorkItem | undefined>;
};

export type WorkflowActionExecutionRepository = {
  createAuditLog(input: CreateWorkflowActionAuditLogInput): Promise<void>;
  transaction<T>(
    handler: (tx: WorkflowActionExecutionTransaction) => Promise<T>,
  ): Promise<T>;
};
