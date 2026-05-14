import { HttpStatus, Inject, Injectable, Logger } from "@nestjs/common";
import type {
  ActionFormFieldSummary,
  PageResult,
  SpaceRole,
  StatusCategory,
  WorkflowActionSummary,
  WorkflowBinding,
  WorkflowDefinition,
  WorkflowState,
  WorkflowVersion,
  WorkItemType,
} from "@project-delivery/shared";
import {
  CreateActionFormFieldRequestSchema,
  CreateWorkflowActionRequestSchema,
  CreateWorkflowBindingRequestSchema,
  CreateWorkflowDefinitionRequestSchema,
  CreateWorkflowStateRequestSchema,
  CreateWorkflowVersionRequestSchema,
  UpdateActionFormFieldRequestSchema,
  UpdateWorkflowActionRequestSchema,
  UpdateWorkflowBindingRequestSchema,
  UpdateWorkflowDefinitionRequestSchema,
  UpdateWorkflowStateRequestSchema,
  UpdateWorkflowVersionRequestSchema,
} from "@project-delivery/shared";
import type { z } from "zod";
import { ulid } from "ulid";

import { ApiException } from "../../http/api-exception";
import type {
  ActionFormFieldRecord,
  WorkflowActionRecord,
  WorkflowBindingRecord,
  WorkflowDefinitionRecord,
  WorkflowStateRecord,
  WorkflowVersionRecord,
} from "./workflow-config.mappers";
import {
  toActionFormFieldSummary,
  toWorkflowActionSummary,
  toWorkflowBinding,
  toWorkflowDefinition,
  toWorkflowState,
  toWorkflowVersion,
} from "./workflow-config.mappers";
import {
  WORKFLOW_CONFIG_REPOSITORY,
  type AuditLogInput,
  type WorkflowConfigRepository,
  type WorkflowConfigSpace,
  type WorkflowConfigSpaceAccess,
} from "./workflow-config.repository";

export type WorkflowConfigRequestMetadata = {
  requestId?: string;
  ip?: string;
  userAgent?: string;
};

type WorkflowConfigListInput = {
  page: number;
  pageSize: number;
  sortBy?: string;
  sortOrder?: "asc" | "desc";
};

type WorkflowBindingListInput = WorkflowConfigListInput & {
  workItemType?: WorkItemType;
  priority?: WorkflowBinding["priority"];
  isDefault?: boolean;
};

type CreateActionFormFieldRequest = z.infer<
  typeof CreateActionFormFieldRequestSchema
>;
type CreateWorkflowActionRequest = z.infer<
  typeof CreateWorkflowActionRequestSchema
>;
type CreateWorkflowBindingRequest = z.infer<
  typeof CreateWorkflowBindingRequestSchema
>;
type CreateWorkflowDefinitionRequest = z.infer<
  typeof CreateWorkflowDefinitionRequestSchema
>;
type CreateWorkflowStateRequest = z.infer<typeof CreateWorkflowStateRequestSchema>;
type CreateWorkflowVersionRequest = z.infer<
  typeof CreateWorkflowVersionRequestSchema
>;
type UpdateActionFormFieldRequest = z.infer<
  typeof UpdateActionFormFieldRequestSchema
>;
type UpdateWorkflowActionRequest = z.infer<
  typeof UpdateWorkflowActionRequestSchema
>;
type UpdateWorkflowBindingRequest = z.infer<
  typeof UpdateWorkflowBindingRequestSchema
>;
type UpdateWorkflowDefinitionRequest = z.infer<
  typeof UpdateWorkflowDefinitionRequestSchema
>;
type UpdateWorkflowStateRequest = z.infer<typeof UpdateWorkflowStateRequestSchema>;
type UpdateWorkflowVersionRequest = z.infer<
  typeof UpdateWorkflowVersionRequestSchema
>;

type WorkflowWriteTarget = {
  organizationId: string;
  spaceId: string;
  targetType: string;
  targetId: string;
  operation: string;
};

type VersionWithDefinition = {
  version: WorkflowVersionRecord;
  definition: WorkflowDefinitionRecord;
};

const WORKFLOW_MANAGER_ROLES = new Set<SpaceRole>(["SPACE_ADMIN", "PM"]);
const WORKFLOW_ACTION_EXECUTOR_ROLES = new Set<SpaceRole>([
  "SPACE_ADMIN",
  "PM",
  "DEVELOPER",
  "TESTER",
  "REQUIREMENT",
  "MEMBER",
]);
const STATUS_CATEGORIES = new Set<StatusCategory>([
  "NOT_STARTED",
  "IN_PROGRESS",
  "WAITING",
  "VERIFYING",
  "DONE",
  "TERMINATED",
]);

@Injectable()
export class WorkflowConfigService {
  private readonly logger = new Logger(WorkflowConfigService.name);

  constructor(
    @Inject(WORKFLOW_CONFIG_REPOSITORY)
    private readonly workflows: WorkflowConfigRepository,
  ) {}

  async listDefinitions(
    actorUserId: string,
    spaceId: string,
    input: WorkflowConfigListInput,
  ): Promise<PageResult<WorkflowDefinition>> {
    await this.requireSpaceAccess(actorUserId, spaceId);
    const result = await this.workflows.listDefinitions(spaceId, input);

    return {
      ...result,
      items: result.items.map(toWorkflowDefinition),
    };
  }

  async listVersions(
    actorUserId: string,
    workflowId: string,
    input: WorkflowConfigListInput,
  ): Promise<PageResult<WorkflowVersion>> {
    const definition = await this.requireDefinition(workflowId);
    await this.requireSpaceAccess(actorUserId, definition.spaceId);
    const result = await this.workflows.listVersions(workflowId, input);

    return {
      ...result,
      items: result.items.map(toWorkflowVersion),
    };
  }

  async createDefinition(
    actorUserId: string,
    spaceId: string,
    input: CreateWorkflowDefinitionRequest,
    metadata: WorkflowConfigRequestMetadata,
  ): Promise<WorkflowDefinition> {
    const access = await this.requireWorkflowManagerForSpace(
      actorUserId,
      spaceId,
      {
        metadata,
        operation: "createWorkflowDefinition",
        targetId: spaceId,
        targetType: "WORKFLOW",
      },
    );
    const created = await this.workflows.createDefinition({
      actorUserId,
      code: input.code,
      description: input.description,
      id: ulid(),
      name: input.name,
      organizationId: access.space.organizationId,
      spaceId,
    });
    const dto = toWorkflowDefinition(created);

    await this.audit({
      actionType: "WORKFLOW_DEFINITION_CREATED",
      after: dto,
      actorId: actorUserId,
      metadata,
      operation: "createWorkflowDefinition",
      organizationId: created.organizationId,
      spaceId: created.spaceId,
      targetId: created.id,
      targetType: "WORKFLOW",
    });

    return dto;
  }

  async getDefinition(
    actorUserId: string,
    workflowId: string,
  ): Promise<WorkflowDefinition> {
    const definition = await this.requireDefinition(workflowId);

    await this.requireSpaceAccess(actorUserId, definition.spaceId);

    return toWorkflowDefinition(definition);
  }

  async updateDefinition(
    actorUserId: string,
    workflowId: string,
    input: UpdateWorkflowDefinitionRequest,
    metadata: WorkflowConfigRequestMetadata,
  ): Promise<WorkflowDefinition> {
    const definition = await this.requireDefinition(workflowId);

    await this.requireWorkflowManagerForTarget(actorUserId, {
      metadata,
      operation: "updateWorkflowDefinition",
      organizationId: definition.organizationId,
      spaceId: definition.spaceId,
      targetId: definition.id,
      targetType: "WORKFLOW",
    });

    if (input.status === "DISABLED" && definition.status !== "DISABLED") {
      await this.assertCanDisableDefinition(definition);
    }

    const updated = await this.workflows.updateDefinition({
      actorUserId,
      code: input.code,
      description: input.description,
      name: input.name,
      status: input.status,
      workflowId,
    });

    if (!updated) {
      throwWorkflowNotFound();
    }

    const before = toWorkflowDefinition(definition);
    const after = toWorkflowDefinition(updated);

    await this.audit({
      actionType:
        input.status === "DISABLED"
          ? "WORKFLOW_DEFINITION_DISABLED"
          : "WORKFLOW_DEFINITION_UPDATED",
      actorId: actorUserId,
      after,
      before,
      metadata,
      operation: "updateWorkflowDefinition",
      organizationId: updated.organizationId,
      spaceId: updated.spaceId,
      targetId: updated.id,
      targetType: "WORKFLOW",
    });

    return after;
  }

  async createVersion(
    actorUserId: string,
    workflowId: string,
    input: CreateWorkflowVersionRequest,
    metadata: WorkflowConfigRequestMetadata,
  ): Promise<WorkflowVersion> {
    const definition = await this.requireDefinition(workflowId);

    await this.requireWorkflowManagerForTarget(actorUserId, {
      metadata,
      operation: "createWorkflowVersion",
      organizationId: definition.organizationId,
      spaceId: definition.spaceId,
      targetId: definition.id,
      targetType: "WORKFLOW",
    });

    if (definition.status === "DISABLED") {
      throw new ApiException(
        "WORKFLOW_VERSION_INVALID",
        "Disabled workflow cannot create new draft versions",
        HttpStatus.CONFLICT,
      );
    }

    const created = await this.workflows.createDraftVersion({
      actorUserId,
      sourceWorkflowVersionId: input.sourceWorkflowVersionId,
      workflowId,
    });

    if (!created) {
      if (input.sourceWorkflowVersionId) {
        throwWorkflowVersionNotFound();
      }

      throwWorkflowNotFound();
    }

    const dto = toWorkflowVersion(created);

    await this.audit({
      actionType: "WORKFLOW_VERSION_CREATED",
      actorId: actorUserId,
      after: dto,
      metadata,
      operation: "createWorkflowVersion",
      organizationId: definition.organizationId,
      spaceId: definition.spaceId,
      targetId: created.id,
      targetType: "WORKFLOW_VERSION",
    });

    return dto;
  }

  async getVersion(
    actorUserId: string,
    workflowVersionId: string,
  ): Promise<WorkflowVersion> {
    const { definition, version } =
      await this.requireVersionWithDefinition(workflowVersionId);

    await this.requireSpaceAccess(actorUserId, definition.spaceId);

    return toWorkflowVersion(version);
  }

  async updateVersion(
    actorUserId: string,
    workflowVersionId: string,
    input: UpdateWorkflowVersionRequest,
    metadata: WorkflowConfigRequestMetadata,
  ): Promise<WorkflowVersion> {
    const { definition, version } =
      await this.requireVersionWithDefinition(workflowVersionId);

    await this.requireWorkflowManagerForTarget(actorUserId, {
      metadata,
      operation: "updateWorkflowVersion",
      organizationId: definition.organizationId,
      spaceId: definition.spaceId,
      targetId: version.id,
      targetType: "WORKFLOW_VERSION",
    });

    if (!input.status || input.status === version.status) {
      return toWorkflowVersion(version);
    }

    if (input.status === "PUBLISHED") {
      return this.publishVersion(actorUserId, workflowVersionId, metadata);
    }

    if (input.status === "DRAFT") {
      throw new ApiException(
        "WORKFLOW_VERSION_INVALID",
        "Workflow version cannot move back to DRAFT",
        HttpStatus.CONFLICT,
      );
    }

    await this.assertCanDisableVersion(version);

    const updated = await this.workflows.updateVersionStatus({
      actorUserId,
      status: "DISABLED",
      workflowVersionId,
    });

    if (!updated) {
      throwWorkflowVersionNotFound();
    }

    const before = toWorkflowVersion(version);
    const after = toWorkflowVersion(updated);

    await this.audit({
      actionType: "WORKFLOW_VERSION_DISABLED",
      actorId: actorUserId,
      after,
      before,
      metadata,
      operation: "updateWorkflowVersion",
      organizationId: definition.organizationId,
      spaceId: definition.spaceId,
      targetId: updated.id,
      targetType: "WORKFLOW_VERSION",
    });

    return after;
  }

  async publishVersion(
    actorUserId: string,
    workflowVersionId: string,
    metadata: WorkflowConfigRequestMetadata,
  ): Promise<WorkflowVersion> {
    const { definition, version } =
      await this.requireVersionWithDefinition(workflowVersionId);

    await this.requireWorkflowManagerForTarget(actorUserId, {
      metadata,
      operation: "publishWorkflowVersion",
      organizationId: definition.organizationId,
      spaceId: definition.spaceId,
      targetId: version.id,
      targetType: "WORKFLOW_VERSION",
    });

    if (version.status === "PUBLISHED") {
      throw new ApiException(
        "WORKFLOW_VERSION_ALREADY_PUBLISHED",
        "Workflow version is already published",
        HttpStatus.CONFLICT,
      );
    }

    if (version.status !== "DRAFT") {
      throw new ApiException(
        "WORKFLOW_VERSION_INVALID",
        "Only draft workflow versions can be published",
        HttpStatus.CONFLICT,
      );
    }

    const issues = validatePublish(version);

    if (issues.length > 0) {
      throw new ApiException(
        "WORKFLOW_PUBLISH_VALIDATION_FAILED",
        "Workflow publish validation failed",
        HttpStatus.BAD_REQUEST,
        {
          issues,
        },
      );
    }

    const published = await this.workflows.publishVersion({
      actorUserId,
      publishedAt: new Date(),
      workflowVersionId,
    });

    if (!published) {
      throwWorkflowVersionNotFound();
    }

    const before = toWorkflowVersion(version);
    const after = toWorkflowVersion(published);

    await this.audit({
      actionType: "WORKFLOW_VERSION_PUBLISHED",
      actorId: actorUserId,
      after,
      before,
      metadata,
      operation: "publishWorkflowVersion",
      organizationId: definition.organizationId,
      spaceId: definition.spaceId,
      targetId: published.id,
      targetType: "WORKFLOW_VERSION",
    });

    return after;
  }

  async createState(
    actorUserId: string,
    workflowVersionId: string,
    input: CreateWorkflowStateRequest,
    metadata: WorkflowConfigRequestMetadata,
  ): Promise<WorkflowState> {
    const { definition, version } = await this.requireDraftVersionForMutation(
      actorUserId,
      workflowVersionId,
      metadata,
      "createWorkflowState",
    );

    this.assertUniqueStateCode(version, input.code);

    const created = await this.workflows.createState({
      actorUserId,
      category: input.category,
      code: input.code,
      id: ulid(),
      isEnd: input.isEnd ?? false,
      isStart: input.isStart ?? false,
      name: input.name,
      order: input.order ?? version.states.length,
      workflowVersionId,
    });
    const dto = toWorkflowState(created);

    await this.audit({
      actionType: "WORKFLOW_STATE_CREATED",
      actorId: actorUserId,
      after: dto,
      metadata,
      operation: "createWorkflowState",
      organizationId: definition.organizationId,
      spaceId: definition.spaceId,
      targetId: created.id,
      targetType: "WORKFLOW_STATE",
    });

    return dto;
  }

  async updateState(
    actorUserId: string,
    stateId: string,
    input: UpdateWorkflowStateRequest,
    metadata: WorkflowConfigRequestMetadata,
  ): Promise<WorkflowState> {
    const state = await this.requireState(stateId);
    const { definition, version } = await this.requireDraftVersionForMutation(
      actorUserId,
      state.workflowVersionId,
      metadata,
      "updateWorkflowState",
    );

    if (input.code && input.code !== state.code) {
      this.assertUniqueStateCode(version, input.code, state.id);
    }

    const updated = await this.workflows.updateState({
      actorUserId,
      category: input.category,
      code: input.code,
      isEnd: input.isEnd,
      isStart: input.isStart,
      name: input.name,
      order: input.order,
      stateId,
    });

    if (!updated) {
      throwNotFound("Workflow state not found");
    }

    const before = toWorkflowState(state);
    const after = toWorkflowState(updated);

    await this.audit({
      actionType: "WORKFLOW_STATE_UPDATED",
      actorId: actorUserId,
      after,
      before,
      metadata,
      operation: "updateWorkflowState",
      organizationId: definition.organizationId,
      spaceId: definition.spaceId,
      targetId: updated.id,
      targetType: "WORKFLOW_STATE",
    });

    return after;
  }

  async deleteState(
    actorUserId: string,
    stateId: string,
    metadata: WorkflowConfigRequestMetadata,
  ): Promise<Record<string, never>> {
    const state = await this.requireState(stateId);
    const { definition } = await this.requireDraftVersionForMutation(
      actorUserId,
      state.workflowVersionId,
      metadata,
      "deleteWorkflowState",
    );
    const deleted = await this.workflows.deleteState(stateId, actorUserId);

    if (!deleted) {
      throwNotFound("Workflow state not found");
    }

    await this.audit({
      actionType: "WORKFLOW_STATE_DELETED",
      actorId: actorUserId,
      before: toWorkflowState(state),
      metadata,
      operation: "deleteWorkflowState",
      organizationId: definition.organizationId,
      spaceId: definition.spaceId,
      targetId: state.id,
      targetType: "WORKFLOW_STATE",
    });

    return {};
  }

  async createAction(
    actorUserId: string,
    workflowVersionId: string,
    input: CreateWorkflowActionRequest,
    metadata: WorkflowConfigRequestMetadata,
  ): Promise<WorkflowActionSummary> {
    const { definition, version } = await this.requireDraftVersionForMutation(
      actorUserId,
      workflowVersionId,
      metadata,
      "createWorkflowAction",
    );

    this.assertUniqueActionCode(version, input.code);
    assertStateBelongsToVersion(version, input.fromStateId, "fromStateId");
    assertStateBelongsToVersion(version, input.toStateId, "toStateId");
    assertAllowedActionSpaceRoles(input.allowedSpaceRoles);

    const created = await this.workflows.createAction({
      actorRelations: input.actorRelations ?? [],
      actorUserId,
      allowedSpaceRoles: input.allowedSpaceRoles ?? [],
      code: input.code,
      fromStateId: input.fromStateId,
      id: ulid(),
      name: input.name,
      order: input.order ?? version.actions.length,
      requiresComment: input.requiresComment ?? false,
      toStateId: input.toStateId,
      workflowVersionId,
    });
    const dto = toWorkflowActionSummary(created);

    await this.audit({
      actionType: "WORKFLOW_ACTION_CREATED",
      actorId: actorUserId,
      after: dto,
      metadata,
      operation: "createWorkflowAction",
      organizationId: definition.organizationId,
      spaceId: definition.spaceId,
      targetId: created.id,
      targetType: "WORKFLOW_ACTION",
    });

    return dto;
  }

  async updateAction(
    actorUserId: string,
    actionId: string,
    input: UpdateWorkflowActionRequest,
    metadata: WorkflowConfigRequestMetadata,
  ): Promise<WorkflowActionSummary> {
    const action = await this.requireAction(actionId);
    const { definition, version } = await this.requireDraftVersionForMutation(
      actorUserId,
      action.workflowVersionId,
      metadata,
      "updateWorkflowAction",
    );

    if (input.code && input.code !== action.code) {
      this.assertUniqueActionCode(version, input.code, action.id);
    }
    if (input.fromStateId) {
      assertStateBelongsToVersion(version, input.fromStateId, "fromStateId");
    }
    if (input.toStateId) {
      assertStateBelongsToVersion(version, input.toStateId, "toStateId");
    }
    assertAllowedActionSpaceRoles(input.allowedSpaceRoles);

    const updated = await this.workflows.updateAction({
      actionId,
      actorRelations: input.actorRelations,
      actorUserId,
      allowedSpaceRoles: input.allowedSpaceRoles,
      code: input.code,
      fromStateId: input.fromStateId,
      name: input.name,
      order: input.order,
      requiresComment: input.requiresComment,
      toStateId: input.toStateId,
    });

    if (!updated) {
      throwNotFound("Workflow action not found");
    }

    const before = toWorkflowActionSummary(action);
    const after = toWorkflowActionSummary(updated);

    await this.audit({
      actionType: "WORKFLOW_ACTION_UPDATED",
      actorId: actorUserId,
      after,
      before,
      metadata,
      operation: "updateWorkflowAction",
      organizationId: definition.organizationId,
      spaceId: definition.spaceId,
      targetId: updated.id,
      targetType: "WORKFLOW_ACTION",
    });

    return after;
  }

  async deleteAction(
    actorUserId: string,
    actionId: string,
    metadata: WorkflowConfigRequestMetadata,
  ): Promise<Record<string, never>> {
    const action = await this.requireAction(actionId);
    const { definition } = await this.requireDraftVersionForMutation(
      actorUserId,
      action.workflowVersionId,
      metadata,
      "deleteWorkflowAction",
    );
    const deleted = await this.workflows.deleteAction(actionId, actorUserId);

    if (!deleted) {
      throwNotFound("Workflow action not found");
    }

    await this.audit({
      actionType: "WORKFLOW_ACTION_DELETED",
      actorId: actorUserId,
      before: toWorkflowActionSummary(action),
      metadata,
      operation: "deleteWorkflowAction",
      organizationId: definition.organizationId,
      spaceId: definition.spaceId,
      targetId: action.id,
      targetType: "WORKFLOW_ACTION",
    });

    return {};
  }

  async createFormField(
    actorUserId: string,
    actionId: string,
    input: CreateActionFormFieldRequest,
    metadata: WorkflowConfigRequestMetadata,
  ): Promise<ActionFormFieldSummary> {
    const action = await this.requireAction(actionId);
    const { definition } = await this.requireDraftVersionForMutation(
      actorUserId,
      action.workflowVersionId,
      metadata,
      "createActionFormField",
    );

    this.assertUniqueFormFieldKey(action, input.key);

    const created = await this.workflows.createFormField({
      actionId,
      actorUserId,
      fieldType: input.fieldType,
      id: ulid(),
      key: input.key,
      label: input.label,
      options: input.options ?? [],
      order: input.order ?? action.formFields.length,
      required: input.required,
    });
    const dto = toActionFormFieldSummary(created);

    await this.audit({
      actionType: "WORKFLOW_ACTION_FIELD_CREATED",
      actorId: actorUserId,
      after: dto,
      metadata,
      operation: "createActionFormField",
      organizationId: definition.organizationId,
      spaceId: definition.spaceId,
      targetId: created.id,
      targetType: "ACTION_FORM_FIELD",
    });

    return dto;
  }

  async updateFormField(
    actorUserId: string,
    fieldId: string,
    input: UpdateActionFormFieldRequest,
    metadata: WorkflowConfigRequestMetadata,
  ): Promise<ActionFormFieldSummary> {
    const field = await this.requireFormField(fieldId);
    const { definition } = await this.requireDraftVersionForMutation(
      actorUserId,
      field.action.workflowVersionId,
      metadata,
      "updateActionFormField",
    );

    if (input.key && input.key !== field.key) {
      this.assertUniqueFormFieldKey(field.action, input.key, field.id);
    }

    const updated = await this.workflows.updateFormField({
      actorUserId,
      fieldId,
      fieldType: input.fieldType,
      key: input.key,
      label: input.label,
      options: input.options,
      order: input.order,
      required: input.required,
    });

    if (!updated) {
      throwNotFound("Action form field not found");
    }

    const before = toActionFormFieldSummary(field);
    const after = toActionFormFieldSummary(updated);

    await this.audit({
      actionType: "WORKFLOW_ACTION_FIELD_UPDATED",
      actorId: actorUserId,
      after,
      before,
      metadata,
      operation: "updateActionFormField",
      organizationId: definition.organizationId,
      spaceId: definition.spaceId,
      targetId: updated.id,
      targetType: "ACTION_FORM_FIELD",
    });

    return after;
  }

  async deleteFormField(
    actorUserId: string,
    fieldId: string,
    metadata: WorkflowConfigRequestMetadata,
  ): Promise<Record<string, never>> {
    const field = await this.requireFormField(fieldId);
    const { definition } = await this.requireDraftVersionForMutation(
      actorUserId,
      field.action.workflowVersionId,
      metadata,
      "deleteActionFormField",
    );
    const deleted = await this.workflows.deleteFormField(fieldId, actorUserId);

    if (!deleted) {
      throwNotFound("Action form field not found");
    }

    await this.audit({
      actionType: "WORKFLOW_ACTION_FIELD_DELETED",
      actorId: actorUserId,
      before: toActionFormFieldSummary(field),
      metadata,
      operation: "deleteActionFormField",
      organizationId: definition.organizationId,
      spaceId: definition.spaceId,
      targetId: field.id,
      targetType: "ACTION_FORM_FIELD",
    });

    return {};
  }

  async listBindings(
    actorUserId: string,
    spaceId: string,
    input: WorkflowBindingListInput,
  ): Promise<PageResult<WorkflowBinding>> {
    await this.requireSpaceAccess(actorUserId, spaceId);
    const result = await this.workflows.listBindings(spaceId, input);

    return {
      ...result,
      items: result.items.map(toWorkflowBinding),
    };
  }

  async createBinding(
    actorUserId: string,
    spaceId: string,
    input: CreateWorkflowBindingRequest,
    metadata: WorkflowConfigRequestMetadata,
  ): Promise<WorkflowBinding> {
    const access = await this.requireWorkflowManagerForSpace(
      actorUserId,
      spaceId,
      {
        metadata,
        operation: "createWorkflowBinding",
        targetId: spaceId,
        targetType: "WORKFLOW_BINDING",
      },
    );
    const resolved = await this.resolveBindingTarget(spaceId, {
      workflowId: input.workflowId,
      workflowVersionId: input.workflowVersionId,
    });
    const created = await this.workflows.createBinding({
      actorUserId,
      id: ulid(),
      isDefault: input.isDefault ?? false,
      organizationId: access.space.organizationId,
      priority: input.priority,
      spaceId,
      workflowDefinitionId: resolved.definition.id,
      workflowVersionId: resolved.version.id,
      workItemType: input.workItemType,
    });
    const dto = toWorkflowBinding(created);

    await this.audit({
      actionType: "WORKFLOW_BINDING_CREATED",
      actorId: actorUserId,
      after: dto,
      metadata,
      operation: "createWorkflowBinding",
      organizationId: created.organizationId,
      spaceId: created.spaceId,
      targetId: created.id,
      targetType: "WORKFLOW_BINDING",
    });

    return dto;
  }

  async updateBinding(
    actorUserId: string,
    bindingId: string,
    input: UpdateWorkflowBindingRequest,
    metadata: WorkflowConfigRequestMetadata,
  ): Promise<WorkflowBinding> {
    const existing = await this.requireBinding(bindingId);

    await this.requireWorkflowManagerForTarget(actorUserId, {
      metadata,
      operation: "updateWorkflowBinding",
      organizationId: existing.organizationId,
      spaceId: existing.spaceId,
      targetId: existing.id,
      targetType: "WORKFLOW_BINDING",
    });

    const resolved = await this.resolveBindingTarget(existing.spaceId, {
      workflowId: input.workflowId ?? existing.workflowDefinitionId,
      workflowVersionId: input.workflowVersionId ?? existing.workflowVersionId,
    });
    const nextWorkItemType = input.workItemType ?? existing.workItemType;

    if (!nextWorkItemType) {
      throw new ApiException(
        "VALIDATION_ERROR",
        "workItemType is required for WORK_ITEM workflow bindings",
        HttpStatus.BAD_REQUEST,
      );
    }

    const nextIsDefault = input.isDefault ?? existing.isDefault;

    if (existing.isDefault && !nextIsDefault) {
      await this.assertReplacementDefaultExists(existing);
    }

    const updated = await this.workflows.updateBinding({
      actorUserId,
      bindingId,
      isDefault: nextIsDefault,
      organizationId: existing.organizationId,
      priority: input.priority ?? existing.priority ?? undefined,
      spaceId: existing.spaceId,
      workflowDefinitionId: resolved.definition.id,
      workflowVersionId: resolved.version.id,
      workItemType: nextWorkItemType,
    });
    const before = toWorkflowBinding(existing);
    const after = toWorkflowBinding(updated);

    await this.audit({
      actionType: "WORKFLOW_BINDING_UPDATED",
      actorId: actorUserId,
      after,
      before,
      metadata,
      operation: "updateWorkflowBinding",
      organizationId: updated.organizationId,
      spaceId: updated.spaceId,
      targetId: updated.id,
      targetType: "WORKFLOW_BINDING",
    });

    return after;
  }

  private async requireSpaceAccess(
    actorUserId: string,
    spaceId: string,
  ): Promise<WorkflowConfigSpaceAccess> {
    const access = await this.workflows.findSpaceAccess(actorUserId, spaceId);

    if (!access) {
      throwSpaceAccessDenied();
    }

    return access;
  }

  private async requireWorkflowManagerForSpace(
    actorUserId: string,
    spaceId: string,
    input: {
      metadata: WorkflowConfigRequestMetadata;
      operation: string;
      targetType: string;
      targetId: string;
    },
  ): Promise<WorkflowConfigSpaceAccess> {
    const access = await this.workflows.findSpaceAccess(actorUserId, spaceId);

    if (access && WORKFLOW_MANAGER_ROLES.has(access.role)) {
      return access;
    }

    const space = access?.space ?? (await this.workflows.findSpaceById(spaceId));

    if (space) {
      await this.auditAccessDenied(actorUserId, space, input);
    }

    throwSpaceAccessDenied();
  }

  private async requireWorkflowManagerForTarget(
    actorUserId: string,
    target: WorkflowWriteTarget & { metadata: WorkflowConfigRequestMetadata },
  ): Promise<void> {
    const access = await this.workflows.findSpaceAccess(
      actorUserId,
      target.spaceId,
    );

    if (access && WORKFLOW_MANAGER_ROLES.has(access.role)) {
      return;
    }

    await this.audit({
      actionType: "ACCESS_DENIED",
      actorId: actorUserId,
      metadata: {
        ...target.metadata,
        deniedOperation: target.operation,
        reason: access ? "ROLE_NOT_ALLOWED" : "SPACE_MEMBER_NOT_FOUND",
        role: access?.role,
      },
      operation: target.operation,
      organizationId: target.organizationId,
      spaceId: target.spaceId,
      targetId: target.targetId,
      targetType: target.targetType,
    });

    throwSpaceAccessDenied();
  }

  private async auditAccessDenied(
    actorUserId: string,
    space: WorkflowConfigSpace,
    input: {
      metadata: WorkflowConfigRequestMetadata;
      operation: string;
      targetType: string;
      targetId: string;
    },
  ): Promise<void> {
    await this.audit({
      actionType: "ACCESS_DENIED",
      actorId: actorUserId,
      metadata: {
        ...input.metadata,
        deniedOperation: input.operation,
        reason: "SPACE_MEMBER_NOT_FOUND_OR_ROLE_NOT_ALLOWED",
      },
      operation: input.operation,
      organizationId: space.organizationId,
      spaceId: space.id,
      targetId: input.targetId,
      targetType: input.targetType,
    });
  }

  private async requireDefinition(
    workflowId: string,
  ): Promise<WorkflowDefinitionRecord> {
    const definition = await this.workflows.findDefinitionById(workflowId);

    if (!definition) {
      throwWorkflowNotFound();
    }

    return definition;
  }

  private async requireVersionWithDefinition(
    workflowVersionId: string,
  ): Promise<VersionWithDefinition> {
    const version = await this.workflows.findVersionById(workflowVersionId);

    if (!version) {
      throwWorkflowVersionNotFound();
    }

    const definition = await this.requireDefinition(version.workflowDefinitionId);

    return {
      definition,
      version,
    };
  }

  private async requireDraftVersionForMutation(
    actorUserId: string,
    workflowVersionId: string,
    metadata: WorkflowConfigRequestMetadata,
    operation: string,
  ): Promise<VersionWithDefinition> {
    const { definition, version } =
      await this.requireVersionWithDefinition(workflowVersionId);

    await this.requireWorkflowManagerForTarget(actorUserId, {
      metadata,
      operation,
      organizationId: definition.organizationId,
      spaceId: definition.spaceId,
      targetId: version.id,
      targetType: "WORKFLOW_VERSION",
    });

    assertDraftVersion(version);

    return {
      definition,
      version,
    };
  }

  private async requireState(stateId: string): Promise<WorkflowStateRecord> {
    const state = await this.workflows.findStateById(stateId);

    if (!state) {
      throwNotFound("Workflow state not found");
    }

    return state;
  }

  private async requireAction(actionId: string): Promise<WorkflowActionRecord> {
    const action = await this.workflows.findActionById(actionId);

    if (!action) {
      throwNotFound("Workflow action not found");
    }

    return action;
  }

  private async requireFormField(
    fieldId: string,
  ): Promise<ActionFormFieldRecord & { action: WorkflowActionRecord }> {
    const field = await this.workflows.findFormFieldById(fieldId);

    if (!field) {
      throwNotFound("Action form field not found");
    }

    return field;
  }

  private async requireBinding(
    bindingId: string,
  ): Promise<WorkflowBindingRecord> {
    const binding = await this.workflows.findBindingById(bindingId);

    if (!binding) {
      throwNotFound("Workflow binding not found");
    }

    return binding;
  }

  private async resolveBindingTarget(
    spaceId: string,
    input: {
      workflowId?: string;
      workflowVersionId: string;
    },
  ): Promise<VersionWithDefinition> {
    const { definition, version } = await this.requireVersionWithDefinition(
      input.workflowVersionId,
    );

    if (definition.spaceId !== spaceId) {
      throwWorkflowVersionNotFound();
    }

    if (input.workflowId && input.workflowId !== definition.id) {
      throw new ApiException(
        "VALIDATION_ERROR",
        "workflowId does not match workflowVersionId",
        HttpStatus.BAD_REQUEST,
      );
    }

    if (definition.status !== "ACTIVE") {
      throw new ApiException(
        "WORKFLOW_VERSION_INVALID",
        "Workflow definition must be active before binding",
        HttpStatus.CONFLICT,
      );
    }

    if (version.status !== "PUBLISHED") {
      throw new ApiException(
        "WORKFLOW_VERSION_INVALID",
        "Only published workflow versions can be bound",
        HttpStatus.CONFLICT,
      );
    }

    return {
      definition,
      version,
    };
  }

  private assertUniqueStateCode(
    version: WorkflowVersionRecord,
    code: string,
    ignoreStateId?: string,
  ) {
    if (
      version.states.some(
        (state) => state.code === code && state.id !== ignoreStateId,
      )
    ) {
      throw new ApiException(
        "CONFLICT",
        "Workflow state code already exists in this version",
        HttpStatus.CONFLICT,
      );
    }
  }

  private assertUniqueActionCode(
    version: WorkflowVersionRecord,
    code: string,
    ignoreActionId?: string,
  ) {
    if (
      version.actions.some(
        (action) => action.code === code && action.id !== ignoreActionId,
      )
    ) {
      throw new ApiException(
        "CONFLICT",
        "Workflow action code already exists in this version",
        HttpStatus.CONFLICT,
      );
    }
  }

  private assertUniqueFormFieldKey(
    action: WorkflowActionRecord,
    key: string,
    ignoreFieldId?: string,
  ) {
    if (
      action.formFields.some(
        (field) => field.key === key && field.id !== ignoreFieldId,
      )
    ) {
      throw new ApiException(
        "CONFLICT",
        "Action form field key already exists in this action",
        HttpStatus.CONFLICT,
      );
    }
  }

  private async assertCanDisableDefinition(
    definition: WorkflowDefinitionRecord,
  ): Promise<void> {
    const defaultBindings = await this.workflows.listDefaultBindingsForDefinition(
      definition.id,
    );

    for (const binding of defaultBindings) {
      await this.assertReplacementDefaultExists(binding, {
        excludeWorkflowDefinitionId: definition.id,
      });
    }
  }

  private async assertCanDisableVersion(
    version: WorkflowVersionRecord,
  ): Promise<void> {
    const defaultBindings = await this.workflows.listDefaultBindingsForVersion(
      version.id,
    );

    for (const binding of defaultBindings) {
      await this.assertReplacementDefaultExists(binding, {
        excludeWorkflowVersionId: version.id,
      });
    }
  }

  private async assertReplacementDefaultExists(
    binding: WorkflowBindingRecord,
    input: {
      excludeWorkflowDefinitionId?: string;
      excludeWorkflowVersionId?: string;
    } = {},
  ): Promise<void> {
    if (!binding.workItemType) {
      throw new ApiException(
        "VALIDATION_ERROR",
        "Default WORK_ITEM workflow binding must have workItemType",
        HttpStatus.BAD_REQUEST,
      );
    }

    const hasReplacement = await this.workflows.hasReplacementDefaultBinding({
      excludeWorkflowDefinitionId: input.excludeWorkflowDefinitionId,
      excludeWorkflowVersionId:
        input.excludeWorkflowVersionId ?? binding.workflowVersionId,
      spaceId: binding.spaceId,
      workItemType: binding.workItemType,
    });

    if (!hasReplacement) {
      throw new ApiException(
        "CONFLICT",
        "A replacement default workflow must be configured before disabling the current default workflow",
        HttpStatus.CONFLICT,
        {
          workItemType: binding.workItemType,
        },
      );
    }
  }

  private async audit(
    input: Omit<AuditLogInput, "id" | "ip" | "requestId" | "userAgent"> & {
      metadata: WorkflowConfigRequestMetadata & Record<string, unknown>;
      operation: string;
    },
  ): Promise<void> {
    const { metadata, operation, ...auditInput } = input;

    try {
      await this.workflows.createAuditLog({
        ...auditInput,
        id: ulid(),
        ip: metadata.ip,
        metadata: {
          ...metadata,
          operation,
          requestId: metadata.requestId,
        },
        requestId: metadata.requestId,
        userAgent: metadata.userAgent,
      });
    } catch (error) {
      this.logger.error(
        `Failed to write workflow audit log requestId=${metadata.requestId ?? "unknown"} operation=${operation}`,
        error instanceof Error ? error.stack : String(error),
      );
    }
  }
}

type PublishValidationIssue = {
  code: string;
  message: string;
  actionId?: string;
  stateId?: string;
};

function validatePublish(
  version: WorkflowVersionRecord,
): PublishValidationIssue[] {
  const issues: PublishValidationIssue[] = [];
  const statesById = new Map(version.states.map((state) => [state.id, state]));
  const startStates = version.states.filter((state) => state.isStart);
  const endStates = version.states.filter((state) => state.isEnd);

  if (startStates.length !== 1) {
    issues.push({
      code: "START_STATE_COUNT_INVALID",
      message: "Workflow version must have exactly one start state",
    });
  }

  if (endStates.length === 0) {
    issues.push({
      code: "END_STATE_REQUIRED",
      message: "Workflow version must have at least one end state",
    });
  }

  for (const state of version.states) {
    if (!STATUS_CATEGORIES.has(state.category)) {
      issues.push({
        code: "STATE_CATEGORY_REQUIRED",
        message: "Workflow state must have a system category",
        stateId: state.id,
      });
    }
  }

  for (const action of version.actions) {
    if (!statesById.has(action.fromStateId)) {
      issues.push({
        actionId: action.id,
        code: "ACTION_SOURCE_STATE_NOT_FOUND",
        message: "Workflow action source state must exist",
      });
    }

    if (!statesById.has(action.toStateId)) {
      issues.push({
        actionId: action.id,
        code: "ACTION_TARGET_STATE_NOT_FOUND",
        message: "Workflow action target state must exist",
      });
    }
  }

  const outgoingByStateId = new Map<string, WorkflowActionRecord[]>();
  const incomingByStateId = new Map<string, WorkflowActionRecord[]>();

  for (const action of version.actions) {
    pushMap(outgoingByStateId, action.fromStateId, action);
    pushMap(incomingByStateId, action.toStateId, action);
  }

  for (const state of version.states) {
    if (!state.isEnd && (outgoingByStateId.get(state.id)?.length ?? 0) === 0) {
      issues.push({
        code: "NON_END_STATE_ACTION_REQUIRED",
        message: "Non-end workflow state must have at least one outgoing action",
        stateId: state.id,
      });
    }
  }

  const reachableStateIds =
    startStates.length === 1
      ? findReachableStateIds(startStates[0].id, statesById, version.actions)
      : new Set<string>();

  for (const state of version.states) {
    const hasIncoming = (incomingByStateId.get(state.id)?.length ?? 0) > 0;
    const hasOutgoing = (outgoingByStateId.get(state.id)?.length ?? 0) > 0;

    if (startStates.length === 1 && !reachableStateIds.has(state.id)) {
      issues.push({
        code: "ISOLATED_STATE",
        message: "Workflow state must be reachable from the start state",
        stateId: state.id,
      });
      continue;
    }

    if (!state.isStart && !hasIncoming && !hasOutgoing) {
      issues.push({
        code: "ISOLATED_STATE",
        message: "Workflow state must connect to the workflow graph",
        stateId: state.id,
      });
    }
  }

  return issues;
}

function findReachableStateIds(
  startStateId: string,
  statesById: Map<string, WorkflowStateRecord>,
  actions: WorkflowActionRecord[],
): Set<string> {
  const reachable = new Set<string>([startStateId]);
  const queue = [startStateId];

  while (queue.length > 0) {
    const stateId = queue.shift();

    if (!stateId) {
      break;
    }

    for (const action of actions) {
      if (
        action.fromStateId === stateId &&
        statesById.has(action.toStateId) &&
        !reachable.has(action.toStateId)
      ) {
        reachable.add(action.toStateId);
        queue.push(action.toStateId);
      }
    }
  }

  return reachable;
}

function assertDraftVersion(version: WorkflowVersionRecord) {
  if (version.status === "DRAFT") {
    return;
  }

  throw new ApiException(
    version.status === "PUBLISHED"
      ? "WORKFLOW_VERSION_ALREADY_PUBLISHED"
      : "WORKFLOW_VERSION_INVALID",
    "Only draft workflow versions can be modified directly",
    HttpStatus.CONFLICT,
  );
}

function assertStateBelongsToVersion(
  version: WorkflowVersionRecord,
  stateId: string,
  field: "fromStateId" | "toStateId",
) {
  if (version.states.some((state) => state.id === stateId)) {
    return;
  }

  throw new ApiException(
    "VALIDATION_ERROR",
    `${field} must reference a state in the same workflow version`,
    HttpStatus.BAD_REQUEST,
    {
      field,
    },
  );
}

function assertAllowedActionSpaceRoles(
  roles: readonly SpaceRole[] | undefined,
) {
  const invalidRole = roles?.find(
    (role) => !WORKFLOW_ACTION_EXECUTOR_ROLES.has(role),
  );

  if (!invalidRole) {
    return;
  }

  throw new ApiException(
    "VALIDATION_ERROR",
    "allowedSpaceRoles cannot grant workflow actions to read-only roles",
    HttpStatus.BAD_REQUEST,
    {
      field: "allowedSpaceRoles",
      role: invalidRole,
    },
  );
}

function pushMap<TKey, TValue>(
  map: Map<TKey, TValue[]>,
  key: TKey,
  value: TValue,
) {
  const existing = map.get(key);

  if (existing) {
    existing.push(value);
    return;
  }

  map.set(key, [value]);
}

function throwWorkflowNotFound(): never {
  throw new ApiException(
    "WORKFLOW_NOT_FOUND",
    "Workflow not found",
    HttpStatus.NOT_FOUND,
  );
}

function throwWorkflowVersionNotFound(): never {
  throw new ApiException(
    "WORKFLOW_VERSION_NOT_FOUND",
    "Workflow version not found",
    HttpStatus.NOT_FOUND,
  );
}

function throwSpaceAccessDenied(): never {
  throw new ApiException(
    "SPACE_ACCESS_DENIED",
    "Space access denied",
    HttpStatus.FORBIDDEN,
  );
}

function throwNotFound(message: string): never {
  throw new ApiException("NOT_FOUND", message, HttpStatus.NOT_FOUND);
}
