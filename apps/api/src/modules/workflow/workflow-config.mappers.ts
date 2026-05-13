import type {
  ActionFormFieldSummary,
  WorkflowActionSummary,
  WorkflowBinding,
  WorkflowDefinition,
  WorkflowState,
  WorkflowVersion,
} from "@project-delivery/shared";

export type WorkflowDefinitionRecord = {
  id: string;
  organizationId: string;
  spaceId: string;
  code: string;
  name: string;
  description: string | null;
  status: WorkflowDefinition["status"];
};

export type WorkflowStateRecord = {
  id: string;
  workflowVersionId: string;
  code: string;
  name: string;
  category: WorkflowState["category"];
  isStart: boolean;
  isEnd: boolean;
  sortOrder: number;
};

export type ActionFormFieldRecord = {
  id: string;
  key: string;
  label: string;
  fieldType: ActionFormFieldSummary["fieldType"];
  required: boolean;
  options: string[];
  sortOrder: number;
};

export type WorkflowActionRecord = {
  id: string;
  workflowVersionId: string;
  code: string;
  name: string;
  fromStateId: string;
  toStateId: string;
  allowedSpaceRoles: WorkflowActionSummary["allowedSpaceRoles"];
  actorRelations: WorkflowActionSummary["actorRelations"];
  requiresComment: boolean;
  formFields: ActionFormFieldRecord[];
  sortOrder: number;
};

export type WorkflowVersionRecord = {
  id: string;
  workflowDefinitionId: string;
  version: number;
  status: WorkflowVersion["status"];
  publishedAt: Date | null;
  states: WorkflowStateRecord[];
  actions: WorkflowActionRecord[];
};

export type WorkflowBindingRecord = {
  id: string;
  organizationId: string;
  spaceId: string;
  workflowDefinitionId: string;
  workflowVersionId: string;
  workItemType: WorkflowBinding["workItemType"] | null;
  priority: WorkflowBinding["priority"] | null;
  isDefault: boolean;
};

export function toWorkflowDefinition(
  record: WorkflowDefinitionRecord,
): WorkflowDefinition {
  return removeUndefined({
    code: record.code,
    description: record.description ?? undefined,
    id: record.id,
    name: record.name,
    organizationId: record.organizationId,
    spaceId: record.spaceId,
    status: record.status,
  });
}

export function toWorkflowVersion(
  record: WorkflowVersionRecord,
): WorkflowVersion {
  return removeUndefined({
    actions: record.actions.map(toWorkflowActionSummary),
    id: record.id,
    publishedAt: record.publishedAt?.toISOString(),
    states: record.states.map(toWorkflowState),
    status: record.status,
    version: record.version,
    workflowId: record.workflowDefinitionId,
  });
}

export function toWorkflowState(record: WorkflowStateRecord): WorkflowState {
  return {
    category: record.category,
    code: record.code,
    id: record.id,
    isEnd: record.isEnd,
    isStart: record.isStart,
    name: record.name,
    order: record.sortOrder,
    workflowVersionId: record.workflowVersionId,
  };
}

export function toWorkflowActionSummary(
  record: WorkflowActionRecord,
): WorkflowActionSummary {
  return {
    actorRelations: record.actorRelations,
    allowedSpaceRoles: record.allowedSpaceRoles,
    code: record.code,
    formFields: record.formFields.map(toActionFormFieldSummary),
    fromStateId: record.fromStateId,
    id: record.id,
    name: record.name,
    order: record.sortOrder,
    requiresComment: record.requiresComment,
    toStateId: record.toStateId,
  };
}

export function toActionFormFieldSummary(
  record: ActionFormFieldRecord,
): ActionFormFieldSummary {
  return removeUndefined({
    fieldType: record.fieldType,
    id: record.id,
    key: record.key,
    label: record.label,
    options: record.options.length > 0 ? record.options : undefined,
    order: record.sortOrder,
    required: record.required,
  });
}

export function toWorkflowBinding(record: WorkflowBindingRecord): WorkflowBinding {
  if (!record.workItemType) {
    throw new Error("Workflow binding workItemType is required for WORK_ITEM");
  }

  return removeUndefined({
    id: record.id,
    isDefault: record.isDefault,
    organizationId: record.organizationId,
    priority: record.priority ?? undefined,
    spaceId: record.spaceId,
    workflowId: record.workflowDefinitionId,
    workflowVersionId: record.workflowVersionId,
    workItemType: record.workItemType,
  });
}

function removeUndefined<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(
    Object.entries(value).filter(([, entryValue]) => entryValue !== undefined),
  ) as T;
}
