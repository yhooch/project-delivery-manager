import { HttpStatus, Inject, Injectable, Logger } from "@nestjs/common";
import type {
  ApiErrorCode,
  ExecuteActionRequest,
  PermissionSnapshot,
  TimelineEventType,
  WorkflowActionSummary,
  WorkItemDetail,
} from "@project-delivery/shared";

import { ApiException } from "../../http/api-exception";
import { toWorkItemDetail } from "../workitem/workitem.mappers";
import {
  canReadAllSpaceWorkItems,
  isTesterVisibleWorkItem,
} from "../workitem/workitem-visibility";
import type {
  CreateWorkflowActionAuditLogInput,
  ExecutableWorkflowAction,
  ExecutableWorkflowActionFormField,
  ExecutableWorkItem,
  WorkflowActionBugDetailPatch,
  WorkflowActionActorSpaceAccess,
  WorkflowActionExecutionTransaction,
} from "./workflow-action-execution.repository";
import {
  WORKFLOW_ACTION_EXECUTION_REPOSITORY,
  type WorkflowActionExecutionRepository,
} from "./workflow-action-execution.repository";

const ULID_PATTERN = /^[0-9A-HJKMNP-TV-Z]{26}$/u;
const BLOCK_ACTION_CODES = new Set(["MARK_BLOCKED"]);
const UNBLOCK_ACTION_CODES = new Set(["RESOLVE_BLOCKED"]);
const BUG_FIX_NOTE_KEYS = new Set(["fixNote", "fixSummary"]);
const BUG_REGRESSION_RESULT_KEYS = new Set([
  "regressionResult",
  "regressionConclusion",
  "failedReason",
  "reopenReason",
]);

export type WorkflowActionRequestMetadata = {
  ip?: string;
  requestId?: string;
  userAgent?: string;
};

type WorkflowActionAuditContext = {
  action?: ExecutableWorkflowAction;
  actionId: string;
  after?: Record<string, unknown>;
  before?: Record<string, unknown>;
  formValues?: Record<string, string | number>;
  organizationId: string;
  spaceId: string;
  workItemId: string;
};

@Injectable()
export class WorkflowActionExecutionService {
  private readonly logger = new Logger(WorkflowActionExecutionService.name);

  constructor(
    @Inject(WORKFLOW_ACTION_EXECUTION_REPOSITORY)
    private readonly executions: WorkflowActionExecutionRepository,
  ) {}

  async resolvePermissionSnapshot(
    actorUserId: string,
    workItemId: string,
  ): Promise<PermissionSnapshot> {
    return this.executions.transaction(async (tx) => {
      const workItem = await tx.findWorkItemById(workItemId);

      if (!workItem) {
        throw new ApiException(
          "WORK_ITEM_NOT_FOUND",
          "Work item not found",
          HttpStatus.NOT_FOUND,
        );
      }

      const access = await tx.findActiveSpaceAccess({
        actorUserId,
        organizationId: workItem.organizationId,
        spaceId: workItem.spaceId,
      });

      if (!access) {
        throw new ApiException(
          "SPACE_ACCESS_DENIED",
          "Space access denied",
          HttpStatus.FORBIDDEN,
        );
      }

      await validateWorkItemVisibility(tx, actorUserId, workItem, access);

      const availableActions = await resolveAvailableActions(
        tx,
        actorUserId,
        workItem,
        access,
      );

      return toPermissionSnapshot(access, availableActions);
    });
  }

  async executeAction(
    actorUserId: string,
    workItemId: string,
    actionId: string,
    input: ExecuteActionRequest,
    requestMetadata: WorkflowActionRequestMetadata = {},
  ): Promise<WorkItemDetail> {
    let auditContext: WorkflowActionAuditContext | undefined;

    try {
      const result = await this.executions.transaction(async (tx) => {
        const workItem = await tx.findWorkItemById(workItemId);

        if (!workItem) {
          throw new ApiException(
            "WORK_ITEM_NOT_FOUND",
            "Work item not found",
            HttpStatus.NOT_FOUND,
          );
        }

        auditContext = {
          actionId,
          before: buildAuditSnapshot(workItem),
          organizationId: workItem.organizationId,
          spaceId: workItem.spaceId,
          workItemId: workItem.id,
        };

        const access = await tx.findActiveSpaceAccess({
          actorUserId,
          organizationId: workItem.organizationId,
          spaceId: workItem.spaceId,
        });

        if (!access) {
          throw new ApiException(
            "SPACE_ACCESS_DENIED",
            "Space access denied",
            HttpStatus.FORBIDDEN,
          );
        }

        await validateWorkItemVisibility(tx, actorUserId, workItem, access);

        const action = await tx.findActionById(actionId);

        if (!action) {
          throw new ApiException(
            "WORKFLOW_ACTION_NOT_AVAILABLE",
            "Workflow action not found",
            HttpStatus.NOT_FOUND,
          );
        }

        auditContext.action = action;

        validateActionMatchesWorkItem(workItem, action);

        if (!hasActionPermission(actorUserId, workItem, action, access)) {
          throw new ApiException(
            "WORKFLOW_ACTION_PERMISSION_DENIED",
            "Workflow action is not allowed for current user",
            HttpStatus.FORBIDDEN,
          );
        }

        const comment = normalizeComment(input.comment);

        if (action.requiresComment && !comment) {
          throw new ApiException(
            "WORKFLOW_ACTION_COMMENT_REQUIRED",
            "Comment is required for this workflow action",
            HttpStatus.BAD_REQUEST,
          );
        }

        const formValues = await validateFormValues(tx, workItem, action, input);
        const now = new Date();
        const blockedPatch = buildBlockedPatch(action, formValues, now);
        const bugPatch = buildBugDetailPatch(
          workItem,
          formValues,
          actorUserId,
          now,
        );
        if (bugPatch && !workItem.bugDetail) {
          throw new ApiException(
            "VALIDATION_ERROR",
            "Bug detail not found",
            HttpStatus.BAD_REQUEST,
          );
        }
        const assigneeId =
          workItem.type === "BUG"
            ? getOptionalString(formValues.fixAssigneeId)
            : undefined;
        const assigneeChanged =
          assigneeId !== undefined && assigneeId !== (workItem.assigneeId ?? null);
        const closedPatch = buildClosedPatch(action, now);
        const before = buildTimelineBefore(workItem);
        const updated = await tx.updateWorkItemState({
          actorUserId,
          currentStateId: action.toStateId,
          expectedCurrentStateId: action.fromStateId,
          lastActionAt: now,
          lastStatusChangedAt: now,
          statusCategory: action.toState.category,
          workItemId: workItem.id,
          ...(assigneeId !== undefined ? { assigneeId } : {}),
          ...(bugPatch ? { bugDetailPatch: bugPatch } : {}),
          ...blockedPatch,
          ...closedPatch,
        });

        if (!updated) {
          throw new ApiException(
            "WORKFLOW_ACTION_STATE_CONFLICT",
            "Workflow action no longer matches the current state",
            HttpStatus.CONFLICT,
          );
        }

        if (assigneeChanged && assigneeId) {
          await tx.replaceAssigneeParticipants({
            actorUserId,
            organizationId: updated.organizationId,
            relationType: "ASSIGNEE",
            spaceId: updated.spaceId,
            targetId: updated.id,
            userIds: [assigneeId],
          });
          await tx.createTimelineEvent({
            actorUserId,
            after: {
              assigneeId,
            },
            before: {
              assigneeId: workItem.assigneeId ?? null,
            },
            eventType: "ASSIGNEE_CHANGED",
            metadata: buildTimelineMetadata(action, formValues, comment),
            organizationId: updated.organizationId,
            spaceId: updated.spaceId,
            targetId: updated.id,
            title: "变更负责人",
          });
        }

        const timelineMetadata = buildTimelineMetadata(
          action,
          formValues,
          comment,
        );
        await tx.createTimelineEvent({
          actorUserId,
          after: buildTimelineAfter(updated),
          before,
          detail: comment,
          eventType: "ACTION_EXECUTED",
          metadata: timelineMetadata,
          organizationId: updated.organizationId,
          spaceId: updated.spaceId,
          targetId: updated.id,
          title: `执行动作：${action.name}`,
        });

        const lifecycleEvent = resolveLifecycleTimelineEvent(action);

        if (lifecycleEvent) {
          await tx.createTimelineEvent({
            actorUserId,
            after: buildTimelineAfter(updated),
            before,
            detail: comment,
            eventType: lifecycleEvent,
            metadata: timelineMetadata,
            organizationId: updated.organizationId,
            spaceId: updated.spaceId,
            targetId: updated.id,
            title: lifecycleEvent === "CLOSED" ? "关闭工作项" : "重新打开工作项",
          });
        }

        const availableActions = await resolveAvailableActions(
          tx,
          actorUserId,
          updated,
          access,
        );
        const detail = toWorkItemDetail(
          updated,
          toPermissionSnapshot(access, availableActions),
        );
        const after = buildAuditSnapshot(updated);

        const successAuditContext: WorkflowActionAuditContext = {
          action,
          actionId,
          after,
          before: auditContext?.before ?? buildAuditSnapshot(workItem),
          formValues,
          organizationId: updated.organizationId,
          spaceId: updated.spaceId,
          workItemId: updated.id,
        };
        auditContext = successAuditContext;

        return {
          audit: buildAuditLogInput(
            "WORKFLOW_ACTION_EXECUTED",
            actorUserId,
            requestMetadata,
            successAuditContext,
          ),
          detail,
        };
      });

      await this.createAuditLogSafely(result.audit);

      return result.detail;
    } catch (error) {
      if (auditContext) {
        await this.createAuditLogSafely(
          buildAuditLogInput(
            resolveFailureAuditActionType(error),
            actorUserId,
            requestMetadata,
            auditContext,
            error,
          ),
        );
      }

      throw error;
    }
  }

  private async createAuditLogSafely(input: CreateWorkflowActionAuditLogInput) {
    try {
      await this.executions.createAuditLog(input);
    } catch (error) {
      const requestId = input.requestId ?? "unknown";
      const message = error instanceof Error ? error.message : String(error);

      this.logger.error(
        `Failed to write workflow action audit log requestId=${requestId}: ${message}`,
        error instanceof Error ? error.stack : undefined,
      );
    }
  }
}

function validateActionMatchesWorkItem(
  workItem: ExecutableWorkItem,
  action: ExecutableWorkflowAction,
) {
  if (action.workflowVersionId !== workItem.workflowVersionId) {
    throw new ApiException(
      "WORKFLOW_ACTION_NOT_AVAILABLE",
      "Workflow action does not belong to the work item's workflow version",
      HttpStatus.BAD_REQUEST,
    );
  }

  if (action.fromStateId !== workItem.currentStateId) {
    throw new ApiException(
      "WORKFLOW_ACTION_STATE_CONFLICT",
      "Workflow action is not available from the current state",
      HttpStatus.CONFLICT,
    );
  }
}

async function validateWorkItemVisibility(
  tx: WorkflowActionExecutionTransaction,
  actorUserId: string,
  workItem: ExecutableWorkItem,
  access: WorkflowActionActorSpaceAccess,
) {
  if (
    canReadAllSpaceWorkItems(access.role) ||
    (access.role === "TESTER" && isTesterVisibleWorkItem(workItem))
  ) {
    return;
  }

  if (
    await tx.isWorkItemParticipant({
      spaceId: workItem.spaceId,
      userId: actorUserId,
      workItemId: workItem.id,
    })
  ) {
    return;
  }

  throw new ApiException(
    "WORK_ITEM_NOT_FOUND",
    "Work item not found",
    HttpStatus.NOT_FOUND,
  );
}

async function validateFormValues(
  tx: WorkflowActionExecutionTransaction,
  workItem: ExecutableWorkItem,
  action: ExecutableWorkflowAction,
  input: ExecuteActionRequest,
): Promise<Record<string, string | number>> {
  const result: Record<string, string | number> = {};

  for (const field of action.formFields) {
    const value = input.formValues[field.key];

    if (isEmptyFormValue(value)) {
      if (field.required) {
        throw new ApiException(
          "WORKFLOW_ACTION_FORM_INVALID",
          `${field.label} is required`,
          HttpStatus.BAD_REQUEST,
          {
            field: field.key,
          },
        );
      }

      continue;
    }

    result[field.key] = await validateFieldValue(tx, workItem, field, value);
  }

  return result;
}

async function validateFieldValue(
  tx: WorkflowActionExecutionTransaction,
  workItem: ExecutableWorkItem,
  field: ExecutableWorkflowActionFormField,
  value: unknown,
): Promise<string | number> {
  switch (field.fieldType) {
    case "TEXT":
    case "TEXTAREA":
      if (typeof value !== "string") {
        throwInvalidFieldValue(field);
      }
      return value.trim();
    case "SELECT":
      if (typeof value !== "string" || !field.options.includes(value)) {
        throwInvalidFieldValue(field);
      }
      return value;
    case "USER":
      if (typeof value !== "string" || !ULID_PATTERN.test(value)) {
        throwInvalidFieldValue(field);
      }
      if (
        !(await tx.isActiveSpaceMember({
          organizationId: workItem.organizationId,
          spaceId: workItem.spaceId,
          userId: value,
        }))
      ) {
        throw new ApiException(
          "SPACE_MEMBER_INVALID",
          `${field.label} must be an active space member`,
          HttpStatus.NOT_FOUND,
          {
            field: field.key,
          },
        );
      }
      return value;
    case "DATE": {
      if (typeof value !== "string") {
        throwInvalidFieldValue(field);
      }
      const date = new Date(value);

      if (Number.isNaN(date.getTime())) {
        throwInvalidFieldValue(field);
      }
      return date.toISOString();
    }
    case "NUMBER":
      if (typeof value !== "number" || !Number.isFinite(value)) {
        throwInvalidFieldValue(field);
      }
      return value;
  }
}

function throwInvalidFieldValue(
  field: ExecutableWorkflowActionFormField,
): never {
  throw new ApiException(
    "WORKFLOW_ACTION_FORM_INVALID",
    `${field.label} has an invalid value`,
    HttpStatus.BAD_REQUEST,
    {
      field: field.key,
    },
  );
}

function isEmptyFormValue(value: unknown) {
  return (
    value === undefined ||
    value === null ||
    (typeof value === "string" && value.trim().length === 0)
  );
}

function normalizeComment(comment: string | undefined) {
  if (!comment) {
    return undefined;
  }

  const trimmed = comment.trim();

  return trimmed.length > 0 ? trimmed : undefined;
}

function buildBlockedPatch(
  action: ExecutableWorkflowAction,
  formValues: Record<string, string | number>,
  now: Date,
): {
  blockedAt?: Date | null;
  blockedReason?: string | null;
} {
  if (BLOCK_ACTION_CODES.has(action.code)) {
    const blockedReason = String(formValues.blockedReason ?? "").trim();

    if (!blockedReason) {
      throw new ApiException(
        "WORKFLOW_ACTION_FORM_INVALID",
        "blockedReason is required when marking a work item as blocked",
        HttpStatus.BAD_REQUEST,
        {
          field: "blockedReason",
        },
      );
    }

    return {
      blockedAt: now,
      blockedReason,
    };
  }

  if (UNBLOCK_ACTION_CODES.has(action.code)) {
    return {
      blockedAt: null,
      blockedReason: null,
    };
  }

  return {};
}

function buildClosedPatch(
  action: ExecutableWorkflowAction,
  now: Date,
): {
  closedAt?: Date | null;
} {
  if (isReopenAction(action)) {
    return {
      closedAt: null,
    };
  }

  if (action.toState.isEnd) {
    return {
      closedAt: now,
    };
  }

  return {};
}

function buildBugDetailPatch(
  workItem: ExecutableWorkItem,
  formValues: Record<string, string | number>,
  actorUserId: string,
  now: Date,
): WorkflowActionBugDetailPatch | undefined {
  if (workItem.type !== "BUG") {
    return undefined;
  }

  const patch: WorkflowActionBugDetailPatch = {};

  for (const key of BUG_FIX_NOTE_KEYS) {
    const value = getOptionalString(formValues[key]);

    if (value !== undefined) {
      patch.fixNote = value;
    }
  }

  for (const key of BUG_REGRESSION_RESULT_KEYS) {
    const value = getOptionalString(formValues[key]);

    if (value !== undefined) {
      patch.regressionResult = value;
      patch.regressionById = actorUserId;
      patch.regressionAt = now;
    }
  }

  const regressionById = getOptionalString(formValues.regressionBy);

  if (regressionById !== undefined) {
    patch.regressionById = regressionById;
  }

  const regressionAt = getOptionalString(formValues.regressionAt);

  if (regressionAt !== undefined) {
    patch.regressionAt = new Date(regressionAt);
  }

  return Object.keys(patch).length > 0 ? patch : undefined;
}

function getOptionalString(value: string | number | undefined) {
  return typeof value === "string" ? value : undefined;
}

function hasActionPermission(
  actorUserId: string,
  workItem: ExecutableWorkItem,
  action: ExecutableWorkflowAction,
  access: WorkflowActionActorSpaceAccess,
) {
  if (access.role === "VIEWER") {
    return false;
  }

  return (
    action.allowedSpaceRoles.includes(access.role) ||
    action.actorRelations.some((relation) => {
      switch (relation) {
        case "ASSIGNEE":
          return workItem.assigneeId === actorUserId;
        case "REPORTER":
          return workItem.reporterId === actorUserId;
        case "CREATOR":
          return workItem.createdById === actorUserId;
        case "SPACE_OWNER":
          return access.spaceOwnerId === actorUserId;
      }
    })
  );
}

async function resolveAvailableActions(
  tx: WorkflowActionExecutionTransaction,
  actorUserId: string,
  workItem: ExecutableWorkItem,
  access: WorkflowActionActorSpaceAccess,
): Promise<WorkflowActionSummary[]> {
  const actions = await tx.listActionsForState({
    fromStateId: workItem.currentStateId,
    workflowVersionId: workItem.workflowVersionId,
  });

  return actions
    .filter((action) =>
      hasActionPermission(actorUserId, workItem, action, access),
    )
    .map(toWorkflowActionSummary);
}

function toWorkflowActionSummary(
  action: ExecutableWorkflowAction,
): WorkflowActionSummary {
  return {
    actorRelations: action.actorRelations,
    allowedSpaceRoles: action.allowedSpaceRoles,
    code: action.code,
    formFields: action.formFields.map((field) => ({
      fieldType: field.fieldType,
      id: field.id,
      key: field.key,
      label: field.label,
      options: field.options.length > 0 ? field.options : undefined,
      order: field.order,
      required: field.required,
    })),
    fromStateId: action.fromStateId,
    id: action.id,
    name: action.name,
    order: action.order,
    requiresComment: action.requiresComment,
    toStateId: action.toStateId,
  };
}

function toPermissionSnapshot(
  access: WorkflowActionActorSpaceAccess,
  availableActions: WorkflowActionSummary[],
): PermissionSnapshot {
  const canWrite = access.role !== "VIEWER";

  return {
    availableActions,
    canComment: canWrite,
    canEdit: canWrite,
    canUploadAttachment: canWrite,
  };
}

function buildTimelineBefore(workItem: ExecutableWorkItem) {
  return {
    assigneeId: workItem.assigneeId ?? null,
    blockedAt: workItem.blockedAt ?? null,
    blockedReason: workItem.blockedReason ?? null,
    closedAt: workItem.closedAt ?? null,
    currentStateId: workItem.currentStateId,
    statusCategory: workItem.statusCategory,
  };
}

function buildTimelineAfter(workItem: ExecutableWorkItem) {
  return {
    assigneeId: workItem.assigneeId ?? null,
    blockedAt: workItem.blockedAt ?? null,
    blockedReason: workItem.blockedReason ?? null,
    closedAt: workItem.closedAt ?? null,
    currentStateId: workItem.currentStateId,
    statusCategory: workItem.statusCategory,
  };
}

function buildTimelineMetadata(
  action: ExecutableWorkflowAction,
  formValues: Record<string, string | number>,
  comment: string | undefined,
) {
  return removeUndefined({
    actionCode: action.code,
    actionId: action.id,
    actionName: action.name,
    comment,
    formValues,
    fromStateCode: action.fromState.code,
    fromStateId: action.fromStateId,
    lifecycleEvent: resolveLifecycleEvent(action),
    toStateCode: action.toState.code,
    toStateId: action.toStateId,
  });
}

function resolveLifecycleEvent(action: ExecutableWorkflowAction) {
  if (isReopenAction(action)) {
    return "REOPENED";
  }
  if (action.code.includes("CANCEL") || action.toState.code.includes("CANCEL")) {
    return "CANCELED";
  }
  if (action.code.includes("CLOSE") || action.toState.code.includes("CLOSE")) {
    return "CLOSED";
  }
  if (action.toState.category === "DONE" || action.toState.isEnd) {
    return "COMPLETED";
  }

  return undefined;
}

function resolveLifecycleTimelineEvent(
  action: ExecutableWorkflowAction,
): Extract<TimelineEventType, "CLOSED" | "REOPENED"> | undefined {
  if (isReopenAction(action)) {
    return "REOPENED";
  }

  if (
    action.code.includes("CLOSE") ||
    action.toState.code.includes("CLOSE") ||
    action.toState.isEnd
  ) {
    return "CLOSED";
  }

  return undefined;
}

function isReopenAction(action: ExecutableWorkflowAction) {
  return action.code.includes("REOPEN") || (
    action.fromState.isEnd && !action.toState.isEnd
  );
}

function buildAuditSnapshot(workItem: ExecutableWorkItem) {
  return removeUndefined({
    assigneeId: workItem.assigneeId ?? null,
    blockedAt: workItem.blockedAt ?? null,
    blockedReason: workItem.blockedReason ?? null,
    bugDetail: workItem.bugDetail
      ? {
          fixNote: workItem.bugDetail.fixNote ?? null,
          regressionAt: workItem.bugDetail.regressionAt ?? null,
          regressionById: workItem.bugDetail.regressionById ?? null,
          regressionResult: workItem.bugDetail.regressionResult ?? null,
        }
      : undefined,
    closedAt: workItem.closedAt ?? null,
    currentStateId: workItem.currentStateId,
    statusCategory: workItem.statusCategory,
  });
}

function buildAuditLogInput(
  actionType: string,
  actorUserId: string,
  requestMetadata: WorkflowActionRequestMetadata,
  context: WorkflowActionAuditContext,
  error?: unknown,
): CreateWorkflowActionAuditLogInput {
  return {
    actionType,
    actorUserId,
    after: context.after,
    before: context.before,
    ip: requestMetadata.ip,
    metadata: removeUndefined({
      actionCode: context.action?.code,
      actionId: context.action?.id ?? context.actionId,
      actionName: context.action?.name,
      errorCode: getApiExceptionCode(error),
      errorMessage: getErrorMessage(error),
      formValues: context.formValues,
      requestId: requestMetadata.requestId,
    }),
    organizationId: context.organizationId,
    requestId: requestMetadata.requestId,
    spaceId: context.spaceId,
    targetId: context.workItemId,
    targetType: "WORK_ITEM",
    userAgent: requestMetadata.userAgent,
  };
}

function resolveFailureAuditActionType(error: unknown) {
  const code = getApiExceptionCode(error);

  if (
    code === "FORBIDDEN" ||
    code === "SPACE_ACCESS_DENIED" ||
    code === "WORKFLOW_ACTION_PERMISSION_DENIED" ||
    code === "WORK_ITEM_NOT_FOUND"
  ) {
    return "WORKFLOW_ACTION_PERMISSION_DENIED";
  }

  return "WORKFLOW_ACTION_VALIDATION_FAILED";
}

function getApiExceptionCode(error: unknown): ApiErrorCode | undefined {
  return error instanceof ApiException ? error.code : undefined;
}

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : undefined;
}

function removeUndefined<T extends Record<string, unknown>>(value: T) {
  return Object.fromEntries(
    Object.entries(value).filter(([, entryValue]) => entryValue !== undefined),
  );
}
