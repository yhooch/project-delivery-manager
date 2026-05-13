import type {
  ActionFormFieldType,
  PageResult,
  Priority,
  SpaceRole,
  StatusCategory,
  WorkflowActorRelation,
  WorkflowDefinitionStatus,
  WorkflowVersionStatus,
  WorkItemType,
} from "@project-delivery/shared";

import type {
  ActionFormFieldRecord,
  WorkflowActionRecord,
  WorkflowBindingRecord,
  WorkflowDefinitionRecord,
  WorkflowStateRecord,
  WorkflowVersionRecord,
} from "./workflow-config.mappers";

export const WORKFLOW_CONFIG_REPOSITORY = Symbol("WORKFLOW_CONFIG_REPOSITORY");

export type WorkflowConfigSpace = {
  id: string;
  organizationId: string;
  ownerId?: string;
};

export type WorkflowConfigSpaceAccess = {
  role: SpaceRole;
  space: WorkflowConfigSpace;
};

export type WorkflowConfigListInput = {
  page: number;
  pageSize: number;
  sortBy?: string;
  sortOrder?: "asc" | "desc";
};

export type WorkflowBindingListInput = WorkflowConfigListInput & {
  workItemType?: WorkItemType;
  priority?: Priority;
  isDefault?: boolean;
};

export type CreateWorkflowDefinitionInput = {
  id: string;
  actorUserId: string;
  organizationId: string;
  spaceId: string;
  code: string;
  name: string;
  description?: string;
};

export type UpdateWorkflowDefinitionInput = {
  workflowId: string;
  actorUserId: string;
  code?: string;
  name?: string;
  description?: string;
  status?: WorkflowDefinitionStatus;
};

export type CreateDraftWorkflowVersionInput = {
  actorUserId: string;
  sourceWorkflowVersionId?: string;
  workflowId: string;
};

export type UpdateWorkflowVersionStatusInput = {
  actorUserId: string;
  status: WorkflowVersionStatus;
  workflowVersionId: string;
};

export type PublishWorkflowVersionInput = {
  actorUserId: string;
  publishedAt: Date;
  workflowVersionId: string;
};

export type CreateWorkflowStateInput = {
  actorUserId: string;
  workflowVersionId: string;
  id: string;
  code: string;
  name: string;
  category: StatusCategory;
  isStart: boolean;
  isEnd: boolean;
  order: number;
};

export type UpdateWorkflowStateInput = {
  actorUserId: string;
  stateId: string;
  code?: string;
  name?: string;
  category?: StatusCategory;
  isStart?: boolean;
  isEnd?: boolean;
  order?: number;
};

export type CreateWorkflowActionInput = {
  actorUserId: string;
  workflowVersionId: string;
  id: string;
  code: string;
  name: string;
  fromStateId: string;
  toStateId: string;
  allowedSpaceRoles: SpaceRole[];
  actorRelations: WorkflowActorRelation[];
  requiresComment: boolean;
  order: number;
};

export type UpdateWorkflowActionInput = {
  actorUserId: string;
  actionId: string;
  code?: string;
  name?: string;
  fromStateId?: string;
  toStateId?: string;
  allowedSpaceRoles?: SpaceRole[];
  actorRelations?: WorkflowActorRelation[];
  requiresComment?: boolean;
  order?: number;
};

export type CreateActionFormFieldInput = {
  actorUserId: string;
  actionId: string;
  id: string;
  key: string;
  label: string;
  fieldType: ActionFormFieldType;
  required: boolean;
  options: string[];
  order: number;
};

export type UpdateActionFormFieldInput = {
  actorUserId: string;
  fieldId: string;
  key?: string;
  label?: string;
  fieldType?: ActionFormFieldType;
  required?: boolean;
  options?: string[];
  order?: number;
};

export type UpsertWorkflowBindingInput = {
  id?: string;
  actorUserId: string;
  bindingId?: string;
  organizationId: string;
  spaceId: string;
  workflowDefinitionId: string;
  workflowVersionId: string;
  workItemType: WorkItemType;
  priority?: Priority;
  isDefault: boolean;
};

export type AuditLogInput = {
  id: string;
  organizationId: string;
  spaceId?: string;
  actorId?: string;
  actionType: string;
  targetType: string;
  targetId: string;
  requestId?: string;
  ip?: string;
  userAgent?: string;
  before?: Record<string, unknown>;
  after?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
};

export type WorkflowConfigRepository = {
  createAction(input: CreateWorkflowActionInput): Promise<WorkflowActionRecord>;
  createAuditLog(input: AuditLogInput): Promise<void>;
  createBinding(input: UpsertWorkflowBindingInput): Promise<WorkflowBindingRecord>;
  createDefinition(
    input: CreateWorkflowDefinitionInput,
  ): Promise<WorkflowDefinitionRecord>;
  createDraftVersion(
    input: CreateDraftWorkflowVersionInput,
  ): Promise<WorkflowVersionRecord | undefined>;
  createFormField(
    input: CreateActionFormFieldInput,
  ): Promise<ActionFormFieldRecord>;
  createState(input: CreateWorkflowStateInput): Promise<WorkflowStateRecord>;
  deleteAction(
    actionId: string,
    actorUserId: string,
  ): Promise<WorkflowActionRecord | undefined>;
  deleteFormField(
    fieldId: string,
    actorUserId: string,
  ): Promise<ActionFormFieldRecord | undefined>;
  deleteState(
    stateId: string,
    actorUserId: string,
  ): Promise<WorkflowStateRecord | undefined>;
  findActionById(actionId: string): Promise<WorkflowActionRecord | undefined>;
  findBindingById(bindingId: string): Promise<WorkflowBindingRecord | undefined>;
  findDefinitionById(
    workflowId: string,
  ): Promise<WorkflowDefinitionRecord | undefined>;
  findFormFieldById(
    fieldId: string,
  ): Promise<(ActionFormFieldRecord & { action: WorkflowActionRecord }) | undefined>;
  findSpaceAccess(
    actorUserId: string,
    spaceId: string,
  ): Promise<WorkflowConfigSpaceAccess | undefined>;
  findSpaceById(spaceId: string): Promise<WorkflowConfigSpace | undefined>;
  findStateById(stateId: string): Promise<WorkflowStateRecord | undefined>;
  findVersionById(
    workflowVersionId: string,
  ): Promise<WorkflowVersionRecord | undefined>;
  getVersionForValidation(
    workflowVersionId: string,
  ): Promise<WorkflowVersionRecord | undefined>;
  hasReplacementDefaultBinding(input: {
    excludeWorkflowDefinitionId?: string;
    excludeWorkflowVersionId?: string;
    spaceId: string;
    workItemType: WorkItemType;
  }): Promise<boolean>;
  listBindings(
    spaceId: string,
    input: WorkflowBindingListInput,
  ): Promise<PageResult<WorkflowBindingRecord>>;
  listDefaultBindingsForDefinition(
    workflowId: string,
  ): Promise<WorkflowBindingRecord[]>;
  listDefaultBindingsForVersion(
    workflowVersionId: string,
  ): Promise<WorkflowBindingRecord[]>;
  listDefinitions(
    spaceId: string,
    input: WorkflowConfigListInput,
  ): Promise<PageResult<WorkflowDefinitionRecord>>;
  publishVersion(
    input: PublishWorkflowVersionInput,
  ): Promise<WorkflowVersionRecord | undefined>;
  updateAction(
    input: UpdateWorkflowActionInput,
  ): Promise<WorkflowActionRecord | undefined>;
  updateBinding(input: UpsertWorkflowBindingInput): Promise<WorkflowBindingRecord>;
  updateDefinition(
    input: UpdateWorkflowDefinitionInput,
  ): Promise<WorkflowDefinitionRecord | undefined>;
  updateFormField(
    input: UpdateActionFormFieldInput,
  ): Promise<ActionFormFieldRecord | undefined>;
  updateState(input: UpdateWorkflowStateInput): Promise<WorkflowStateRecord | undefined>;
  updateVersionStatus(
    input: UpdateWorkflowVersionStatusInput,
  ): Promise<WorkflowVersionRecord | undefined>;
};
