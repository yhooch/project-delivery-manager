import { Logger } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";
import { ulid } from "ulid";

import type {
  PageResult,
  SpaceRole,
  WorkflowVersionStatus,
  WorkItemType,
} from "@project-delivery/shared";
import { WorkflowConfigService } from "./workflow-config.service";
import type {
  ActionFormFieldRecord,
  WorkflowActionRecord,
  WorkflowBindingRecord,
  WorkflowDefinitionRecord,
  WorkflowStateRecord,
  WorkflowVersionRecord,
} from "./workflow-config.mappers";
import type {
  AuditLogInput,
  CreateActionFormFieldInput,
  CreateDraftWorkflowVersionInput,
  CreateWorkflowActionInput,
  CreateWorkflowDefinitionInput,
  CreateWorkflowStateInput,
  PublishWorkflowVersionInput,
  UpdateActionFormFieldInput,
  UpdateWorkflowActionInput,
  UpdateWorkflowDefinitionInput,
  UpdateWorkflowStateInput,
  UpdateWorkflowVersionStatusInput,
  UpsertWorkflowBindingInput,
  WorkflowBindingListInput,
  WorkflowConfigListInput,
  WorkflowConfigRepository,
  WorkflowConfigSpace,
} from "./workflow-config.repository";

const ORGANIZATION_ID = "01H00000000000000000000000";
const SPACE_ID = "01H00000000000000000000001";
const ACTOR_ID = "01H00000000000000000000002";
const VIEWER_ID = "01H00000000000000000000003";
const WORKFLOW_ID = "01H00000000000000000000004";
const WORKFLOW_VERSION_ID = "01H00000000000000000000005";
const PENDING_STATE_ID = "01H00000000000000000000006";
const DONE_STATE_ID = "01H00000000000000000000007";
const ACTION_ID = "01H00000000000000000000008";
const FIELD_ID = "01H00000000000000000000009";
const DEFAULT_BINDING_ID = "01H0000000000000000000000A";
const REPLACEMENT_WORKFLOW_ID = "01H0000000000000000000000B";
const REPLACEMENT_VERSION_ID = "01H0000000000000000000000C";
const REPLACEMENT_BINDING_ID = "01H0000000000000000000000D";

const REQUEST_META = {
  ip: "127.0.0.1",
  requestId: "workflow-test-request",
  userAgent: "vitest",
};

describe("WorkflowConfigService", () => {
  it("copies a published workflow version into a draft with states, actions, and form fields", async () => {
    const { repository, service } = createSubject("PM", {
      versionStatus: "PUBLISHED",
    });

    const draft = await service.createVersion(
      ACTOR_ID,
      WORKFLOW_ID,
      {
        sourceWorkflowVersionId: WORKFLOW_VERSION_ID,
      },
      REQUEST_META,
    );

    expect(draft.status).toBe("DRAFT");
    expect(draft.version).toBe(2);
    expect(draft.states).toHaveLength(2);
    expect(draft.actions).toHaveLength(1);
    expect(draft.actions[0]).toMatchObject({
      code: "COMPLETE",
      formFields: [
        {
          key: "resolution",
          required: true,
        },
      ],
    });
    expect(draft.states.map((state) => state.id)).not.toContain(PENDING_STATE_ID);
    expect(repository.auditLogs.at(-1)).toMatchObject({
      actionType: "WORKFLOW_VERSION_CREATED",
      requestId: REQUEST_META.requestId,
    });
  });

  it("publishes a valid draft and writes audit log", async () => {
    const { repository, service } = createSubject("SPACE_ADMIN");

    const published = await service.publishVersion(
      ACTOR_ID,
      WORKFLOW_VERSION_ID,
      REQUEST_META,
    );

    expect(published.status).toBe("PUBLISHED");
    expect(published.publishedAt).toBeDefined();
    expect(repository.auditLogs.at(-1)).toMatchObject({
      actionType: "WORKFLOW_VERSION_PUBLISHED",
      targetId: WORKFLOW_VERSION_ID,
    });
  });

  it("returns detailed publish validation failures", async () => {
    const { repository, service } = createSubject("PM", {
      withAction: false,
      withEndState: false,
    });
    repository.states.set(PENDING_STATE_ID, {
      ...repository.states.get(PENDING_STATE_ID)!,
      isEnd: false,
    });

    await expect(
      service.publishVersion(ACTOR_ID, WORKFLOW_VERSION_ID, REQUEST_META),
    ).rejects.toMatchObject({
      code: "WORKFLOW_PUBLISH_VALIDATION_FAILED",
      details: {
        issues: expect.arrayContaining([
          expect.objectContaining({ code: "END_STATE_REQUIRED" }),
          expect.objectContaining({
            code: "NON_END_STATE_ACTION_REQUIRED",
            stateId: PENDING_STATE_ID,
          }),
        ]),
      },
    });
  });

  it("rejects direct state/action/form changes on published versions", async () => {
    const { service } = createSubject("PM", {
      versionStatus: "PUBLISHED",
    });

    await expect(
      service.createState(
        ACTOR_ID,
        WORKFLOW_VERSION_ID,
        {
          category: "IN_PROGRESS",
          code: "IN_PROGRESS",
          name: "处理中",
        },
        REQUEST_META,
      ),
    ).rejects.toMatchObject({
      code: "WORKFLOW_VERSION_ALREADY_PUBLISHED",
    });
  });

  it("rejects VIEWER in workflow action allowedSpaceRoles at service boundary", async () => {
    const { service } = createSubject("PM");
    const input = {
      code: "VIEWER_ACTION",
      name: "Viewer action",
      fromStateId: PENDING_STATE_ID,
      toStateId: DONE_STATE_ID,
      allowedSpaceRoles: ["VIEWER"],
    } as unknown as Parameters<WorkflowConfigService["createAction"]>[2];

    await expect(
      service.createAction(ACTOR_ID, WORKFLOW_VERSION_ID, input, REQUEST_META),
    ).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
      details: {
        field: "allowedSpaceRoles",
        role: "VIEWER",
      },
    });
  });

  it("writes ACCESS_DENIED audit for viewer workflow writes", async () => {
    const { repository, service } = createSubject("VIEWER", {
      actorUserId: VIEWER_ID,
    });

    await expect(
      service.createDefinition(
        VIEWER_ID,
        SPACE_ID,
        {
          code: "CUSTOM",
          name: "自定义流程",
        },
        REQUEST_META,
      ),
    ).rejects.toMatchObject({
      code: "SPACE_ACCESS_DENIED",
    });
    expect(repository.auditLogs).toEqual([
      expect.objectContaining({
        actionType: "ACCESS_DENIED",
        actorId: VIEWER_ID,
        metadata: expect.objectContaining({
          deniedOperation: "createWorkflowDefinition",
          requestId: REQUEST_META.requestId,
        }),
      }),
    ]);
  });

  it("does not block workflow writes when audit persistence fails", async () => {
    const logger = vi
      .spyOn(Logger.prototype, "error")
      .mockImplementation(() => undefined);
    const { service } = createSubject("PM", {
      failAudit: true,
    });

    const created = await service.createDefinition(
      ACTOR_ID,
      SPACE_ID,
      {
        code: "CUSTOM",
        name: "自定义流程",
      },
      REQUEST_META,
    );

    expect(created).toMatchObject({
      code: "CUSTOM",
      status: "DRAFT",
    });
    expect(logger).toHaveBeenCalledWith(
      expect.stringContaining("requestId=workflow-test-request"),
      expect.any(String),
    );
    logger.mockRestore();
  });

  it("requires a replacement default binding before disabling a default workflow version", async () => {
    const { repository, service } = createSubject("PM", {
      defaultBinding: true,
      versionStatus: "PUBLISHED",
    });

    await expect(
      service.updateVersion(
        ACTOR_ID,
        WORKFLOW_VERSION_ID,
        {
          status: "DISABLED",
        },
        REQUEST_META,
      ),
    ).rejects.toMatchObject({
      code: "CONFLICT",
      details: {
        workItemType: "TASK",
      },
    });

    seedReplacementDefault(repository);

    const disabled = await service.updateVersion(
      ACTOR_ID,
      WORKFLOW_VERSION_ID,
      {
        status: "DISABLED",
      },
      REQUEST_META,
    );

    expect(disabled.status).toBe("DISABLED");
    expect(repository.auditLogs.at(-1)).toMatchObject({
      actionType: "WORKFLOW_VERSION_DISABLED",
    });
  });
});

function createSubject(
  role: SpaceRole,
  options: {
    actorUserId?: string;
    defaultBinding?: boolean;
    failAudit?: boolean;
    versionStatus?: WorkflowVersionStatus;
    withAction?: boolean;
    withEndState?: boolean;
  } = {},
) {
  const repository = new InMemoryWorkflowConfigRepository();
  const actorUserId = options.actorUserId ?? ACTOR_ID;

  repository.failAudit = options.failAudit ?? false;
  repository.spaces.set(SPACE_ID, {
    id: SPACE_ID,
    organizationId: ORGANIZATION_ID,
  });
  repository.access.set(`${actorUserId}:${SPACE_ID}`, {
    role,
    space: repository.spaces.get(SPACE_ID)!,
  });
  seedWorkflow(repository, {
    defaultBinding: options.defaultBinding ?? false,
    versionStatus: options.versionStatus ?? "DRAFT",
    withAction: options.withAction ?? true,
    withEndState: options.withEndState ?? true,
  });

  return {
    repository,
    service: new WorkflowConfigService(repository),
  };
}

function seedWorkflow(
  repository: InMemoryWorkflowConfigRepository,
  options: {
    defaultBinding: boolean;
    versionStatus: WorkflowVersionStatus;
    withAction: boolean;
    withEndState: boolean;
  },
) {
  repository.definitions.set(WORKFLOW_ID, {
    code: "TASK_FLOW",
    description: "Task flow",
    id: WORKFLOW_ID,
    name: "任务流程",
    organizationId: ORGANIZATION_ID,
    spaceId: SPACE_ID,
    status: "ACTIVE",
  });
  repository.versions.set(WORKFLOW_VERSION_ID, {
    id: WORKFLOW_VERSION_ID,
    publishedAt: options.versionStatus === "PUBLISHED" ? new Date() : null,
    status: options.versionStatus,
    version: 1,
    workflowDefinitionId: WORKFLOW_ID,
  });
  repository.states.set(PENDING_STATE_ID, {
    category: "NOT_STARTED",
    code: "PENDING",
    id: PENDING_STATE_ID,
    isEnd: false,
    isStart: true,
    name: "待处理",
    sortOrder: 0,
    workflowVersionId: WORKFLOW_VERSION_ID,
  });

  if (options.withEndState) {
    repository.states.set(DONE_STATE_ID, {
      category: "DONE",
      code: "DONE",
      id: DONE_STATE_ID,
      isEnd: true,
      isStart: false,
      name: "已完成",
      sortOrder: 1,
      workflowVersionId: WORKFLOW_VERSION_ID,
    });
  }

  if (options.withAction) {
    repository.actions.set(ACTION_ID, {
      actorRelations: [],
      allowedSpaceRoles: ["PM", "SPACE_ADMIN"],
      code: "COMPLETE",
      fromStateId: PENDING_STATE_ID,
      id: ACTION_ID,
      name: "完成",
      requiresComment: false,
      sortOrder: 0,
      toStateId: DONE_STATE_ID,
      workflowVersionId: WORKFLOW_VERSION_ID,
    });
    repository.fields.set(FIELD_ID, {
      actionId: ACTION_ID,
      fieldType: "TEXTAREA",
      id: FIELD_ID,
      key: "resolution",
      label: "处理说明",
      options: [],
      required: true,
      sortOrder: 0,
    });
  }

  if (options.defaultBinding) {
    repository.bindings.set(DEFAULT_BINDING_ID, {
      id: DEFAULT_BINDING_ID,
      isDefault: true,
      organizationId: ORGANIZATION_ID,
      priority: null,
      spaceId: SPACE_ID,
      workflowDefinitionId: WORKFLOW_ID,
      workflowVersionId: WORKFLOW_VERSION_ID,
      workItemType: "TASK",
    });
  }
}

function seedReplacementDefault(repository: InMemoryWorkflowConfigRepository) {
  repository.definitions.set(REPLACEMENT_WORKFLOW_ID, {
    code: "TASK_FLOW_V2",
    description: "Replacement task flow",
    id: REPLACEMENT_WORKFLOW_ID,
    name: "替代任务流程",
    organizationId: ORGANIZATION_ID,
    spaceId: SPACE_ID,
    status: "ACTIVE",
  });
  repository.versions.set(REPLACEMENT_VERSION_ID, {
    id: REPLACEMENT_VERSION_ID,
    publishedAt: new Date(),
    status: "PUBLISHED",
    version: 1,
    workflowDefinitionId: REPLACEMENT_WORKFLOW_ID,
  });
  repository.bindings.set(REPLACEMENT_BINDING_ID, {
    id: REPLACEMENT_BINDING_ID,
    isDefault: true,
    organizationId: ORGANIZATION_ID,
    priority: null,
    spaceId: SPACE_ID,
    workflowDefinitionId: REPLACEMENT_WORKFLOW_ID,
    workflowVersionId: REPLACEMENT_VERSION_ID,
    workItemType: "TASK",
  });
}

type StoredVersion = Omit<WorkflowVersionRecord, "actions" | "states">;
type StoredAction = Omit<WorkflowActionRecord, "formFields">;
type StoredField = ActionFormFieldRecord & { actionId: string };

class InMemoryWorkflowConfigRepository implements WorkflowConfigRepository {
  readonly access = new Map<
    string,
    { role: SpaceRole; space: WorkflowConfigSpace }
  >();
  readonly actions = new Map<string, StoredAction>();
  readonly auditLogs: AuditLogInput[] = [];
  readonly bindings = new Map<string, WorkflowBindingRecord>();
  readonly definitions = new Map<string, WorkflowDefinitionRecord>();
  readonly fields = new Map<string, StoredField>();
  readonly spaces = new Map<string, WorkflowConfigSpace>();
  readonly states = new Map<string, WorkflowStateRecord>();
  readonly versions = new Map<string, StoredVersion>();
  failAudit = false;

  async findSpaceById(spaceId: string) {
    return this.spaces.get(spaceId);
  }

  async findSpaceAccess(actorUserId: string, spaceId: string) {
    return this.access.get(`${actorUserId}:${spaceId}`);
  }

  async listDefinitions(
    spaceId: string,
    input: WorkflowConfigListInput,
  ): Promise<PageResult<WorkflowDefinitionRecord>> {
    const items = [...this.definitions.values()].filter(
      (definition) => definition.spaceId === spaceId,
    );

    return page(items, input);
  }

  async listVersions(
    workflowId: string,
    input: WorkflowConfigListInput,
  ): Promise<PageResult<WorkflowVersionRecord>> {
    const items = [...this.versions.values()]
      .filter((version) => version.workflowDefinitionId === workflowId)
      .sort((left, right) => right.version - left.version)
      .map((version) => this.versionRecord(version.id)!);

    return page(items, input);
  }

  async createDefinition(input: CreateWorkflowDefinitionInput) {
    const definition: WorkflowDefinitionRecord = {
      code: input.code,
      description: input.description ?? null,
      id: input.id,
      name: input.name,
      organizationId: input.organizationId,
      spaceId: input.spaceId,
      status: "DRAFT",
    };

    this.definitions.set(definition.id, definition);

    return definition;
  }

  async findDefinitionById(workflowId: string) {
    return this.definitions.get(workflowId);
  }

  async updateDefinition(input: UpdateWorkflowDefinitionInput) {
    const definition = this.definitions.get(input.workflowId);

    if (!definition) {
      return undefined;
    }

    const updated: WorkflowDefinitionRecord = {
      ...definition,
      code: input.code ?? definition.code,
      description: input.description ?? definition.description,
      name: input.name ?? definition.name,
      status: input.status ?? definition.status,
    };

    this.definitions.set(updated.id, updated);

    return updated;
  }

  async createDraftVersion(input: CreateDraftWorkflowVersionInput) {
    if (!this.definitions.has(input.workflowId)) {
      return undefined;
    }

    const existingVersions = [...this.versions.values()].filter(
      (version) => version.workflowDefinitionId === input.workflowId,
    );
    const source = input.sourceWorkflowVersionId
      ? this.versionRecord(input.sourceWorkflowVersionId)
      : existingVersions
          .filter((version) => version.status === "PUBLISHED")
          .sort((left, right) => right.version - left.version)
          .map((version) => this.versionRecord(version.id))[0];

    if (input.sourceWorkflowVersionId && source?.status !== "PUBLISHED") {
      return undefined;
    }

    const id = ulid();
    const version: StoredVersion = {
      id,
      publishedAt: null,
      status: "DRAFT",
      version:
        Math.max(0, ...existingVersions.map((existing) => existing.version)) + 1,
      workflowDefinitionId: input.workflowId,
    };

    this.versions.set(id, version);

    if (source) {
      const stateIdBySourceId = new Map<string, string>();

      for (const state of source.states) {
        const copiedState = {
          ...state,
          id: ulid(),
          workflowVersionId: id,
        };

        stateIdBySourceId.set(state.id, copiedState.id);
        this.states.set(copiedState.id, copiedState);
      }

      for (const action of source.actions) {
        const copiedActionId = ulid();
        const { formFields: _formFields, ...actionWithoutFields } = action;

        this.actions.set(copiedActionId, {
          ...actionWithoutFields,
          fromStateId: stateIdBySourceId.get(action.fromStateId)!,
          id: copiedActionId,
          toStateId: stateIdBySourceId.get(action.toStateId)!,
          workflowVersionId: id,
        });

        for (const field of action.formFields) {
          const copiedFieldId = ulid();

          this.fields.set(copiedFieldId, {
            ...field,
            actionId: copiedActionId,
            id: copiedFieldId,
          });
        }
      }
    }

    return this.versionRecord(id);
  }

  async findVersionById(workflowVersionId: string) {
    return this.versionRecord(workflowVersionId);
  }

  async getVersionForValidation(workflowVersionId: string) {
    return this.versionRecord(workflowVersionId);
  }

  async updateVersionStatus(input: UpdateWorkflowVersionStatusInput) {
    const version = this.versions.get(input.workflowVersionId);

    if (!version) {
      return undefined;
    }

    this.versions.set(version.id, {
      ...version,
      status: input.status,
    });

    return this.versionRecord(version.id);
  }

  async publishVersion(input: PublishWorkflowVersionInput) {
    const version = this.versions.get(input.workflowVersionId);

    if (!version) {
      return undefined;
    }

    this.versions.set(version.id, {
      ...version,
      publishedAt: input.publishedAt,
      status: "PUBLISHED",
    });

    return this.versionRecord(version.id);
  }

  async createState(input: CreateWorkflowStateInput) {
    const state: WorkflowStateRecord = {
      category: input.category,
      code: input.code,
      id: input.id,
      isEnd: input.isEnd,
      isStart: input.isStart,
      name: input.name,
      sortOrder: input.order,
      workflowVersionId: input.workflowVersionId,
    };

    this.states.set(state.id, state);

    return state;
  }

  async findStateById(stateId: string) {
    return this.states.get(stateId);
  }

  async updateState(input: UpdateWorkflowStateInput) {
    const state = this.states.get(input.stateId);

    if (!state) {
      return undefined;
    }

    const updated = {
      ...state,
      category: input.category ?? state.category,
      code: input.code ?? state.code,
      isEnd: input.isEnd ?? state.isEnd,
      isStart: input.isStart ?? state.isStart,
      name: input.name ?? state.name,
      sortOrder: input.order ?? state.sortOrder,
    };

    this.states.set(updated.id, updated);

    return updated;
  }

  async deleteState(stateId: string, _actorUserId?: string) {
    const state = this.states.get(stateId);

    if (!state) {
      return undefined;
    }

    this.states.delete(stateId);

    return state;
  }

  async createAction(input: CreateWorkflowActionInput) {
    const action: StoredAction = {
      actorRelations: input.actorRelations,
      allowedSpaceRoles: input.allowedSpaceRoles,
      code: input.code,
      fromStateId: input.fromStateId,
      id: input.id,
      name: input.name,
      requiresComment: input.requiresComment,
      sortOrder: input.order,
      toStateId: input.toStateId,
      workflowVersionId: input.workflowVersionId,
    };

    this.actions.set(action.id, action);

    return this.actionRecord(action.id)!;
  }

  async findActionById(actionId: string) {
    return this.actionRecord(actionId);
  }

  async updateAction(input: UpdateWorkflowActionInput) {
    const action = this.actions.get(input.actionId);

    if (!action) {
      return undefined;
    }

    this.actions.set(action.id, {
      ...action,
      actorRelations: input.actorRelations ?? action.actorRelations,
      allowedSpaceRoles: input.allowedSpaceRoles ?? action.allowedSpaceRoles,
      code: input.code ?? action.code,
      fromStateId: input.fromStateId ?? action.fromStateId,
      name: input.name ?? action.name,
      requiresComment: input.requiresComment ?? action.requiresComment,
      sortOrder: input.order ?? action.sortOrder,
      toStateId: input.toStateId ?? action.toStateId,
    });

    return this.actionRecord(action.id);
  }

  async deleteAction(actionId: string, _actorUserId?: string) {
    const action = this.actionRecord(actionId);

    if (!action) {
      return undefined;
    }

    this.actions.delete(actionId);

    return action;
  }

  async createFormField(input: CreateActionFormFieldInput) {
    const field: StoredField = {
      actionId: input.actionId,
      fieldType: input.fieldType,
      id: input.id,
      key: input.key,
      label: input.label,
      options: input.options,
      required: input.required,
      sortOrder: input.order,
    };

    this.fields.set(field.id, field);

    return field;
  }

  async findFormFieldById(fieldId: string) {
    const field = this.fields.get(fieldId);

    if (!field) {
      return undefined;
    }

    const action = this.actionRecord(field.actionId);

    return action
      ? {
          ...field,
          action,
        }
      : undefined;
  }

  async updateFormField(input: UpdateActionFormFieldInput) {
    const field = this.fields.get(input.fieldId);

    if (!field) {
      return undefined;
    }

    const updated = {
      ...field,
      fieldType: input.fieldType ?? field.fieldType,
      key: input.key ?? field.key,
      label: input.label ?? field.label,
      options: input.options ?? field.options,
      required: input.required ?? field.required,
      sortOrder: input.order ?? field.sortOrder,
    };

    this.fields.set(updated.id, updated);

    return updated;
  }

  async deleteFormField(fieldId: string, _actorUserId?: string) {
    const field = this.fields.get(fieldId);

    if (!field) {
      return undefined;
    }

    this.fields.delete(fieldId);

    return field;
  }

  async listBindings(
    spaceId: string,
    input: WorkflowBindingListInput,
  ): Promise<PageResult<WorkflowBindingRecord>> {
    const items = [...this.bindings.values()].filter(
      (binding) =>
        binding.spaceId === spaceId &&
        (!input.workflowId ||
          binding.workflowDefinitionId === input.workflowId) &&
        (!input.workflowVersionId ||
          binding.workflowVersionId === input.workflowVersionId) &&
        (!input.workItemType || binding.workItemType === input.workItemType) &&
        (!input.priority || binding.priority === input.priority) &&
        (input.isDefault === undefined || binding.isDefault === input.isDefault),
    );

    return page(items, input);
  }

  async findBindingById(bindingId: string) {
    return this.bindings.get(bindingId);
  }

  async createBinding(input: UpsertWorkflowBindingInput) {
    const binding: WorkflowBindingRecord = {
      id: input.id ?? ulid(),
      isDefault: input.isDefault,
      organizationId: input.organizationId,
      priority: input.priority ?? null,
      spaceId: input.spaceId,
      workflowDefinitionId: input.workflowDefinitionId,
      workflowVersionId: input.workflowVersionId,
      workItemType: input.workItemType,
    };

    this.bindings.set(binding.id, binding);

    return binding;
  }

  async updateBinding(input: UpsertWorkflowBindingInput) {
    const existing = input.bindingId
      ? this.bindings.get(input.bindingId)
      : undefined;

    if (!existing) {
      throw new Error("Binding not found");
    }

    const updated: WorkflowBindingRecord = {
      ...existing,
      isDefault: input.isDefault,
      priority: input.priority ?? null,
      workflowDefinitionId: input.workflowDefinitionId,
      workflowVersionId: input.workflowVersionId,
      workItemType: input.workItemType,
    };

    this.bindings.set(updated.id, updated);

    return updated;
  }

  async listDefaultBindingsForDefinition(workflowId: string) {
    return [...this.bindings.values()].filter(
      (binding) => binding.isDefault && binding.workflowDefinitionId === workflowId,
    );
  }

  async listDefaultBindingsForVersion(workflowVersionId: string) {
    return [...this.bindings.values()].filter(
      (binding) =>
        binding.isDefault && binding.workflowVersionId === workflowVersionId,
    );
  }

  async hasReplacementDefaultBinding(input: {
    excludeWorkflowDefinitionId?: string;
    excludeWorkflowVersionId?: string;
    spaceId: string;
    workItemType: WorkItemType;
  }) {
    return [...this.bindings.values()].some((binding) => {
      const definition = this.definitions.get(binding.workflowDefinitionId);
      const version = this.versions.get(binding.workflowVersionId);

      return (
        binding.isDefault &&
        binding.spaceId === input.spaceId &&
        binding.workItemType === input.workItemType &&
        binding.workflowDefinitionId !== input.excludeWorkflowDefinitionId &&
        binding.workflowVersionId !== input.excludeWorkflowVersionId &&
        definition?.status === "ACTIVE" &&
        version?.status === "PUBLISHED"
      );
    });
  }

  async createAuditLog(input: AuditLogInput) {
    if (this.failAudit) {
      throw new Error("audit unavailable");
    }

    this.auditLogs.push(input);
  }

  private versionRecord(workflowVersionId: string) {
    const version = this.versions.get(workflowVersionId);

    if (!version) {
      return undefined;
    }

    return {
      ...version,
      actions: [...this.actions.values()]
        .filter((action) => action.workflowVersionId === workflowVersionId)
        .sort((left, right) => left.sortOrder - right.sortOrder)
        .map((action) => this.actionRecord(action.id)!),
      states: [...this.states.values()]
        .filter((state) => state.workflowVersionId === workflowVersionId)
        .sort((left, right) => left.sortOrder - right.sortOrder),
    };
  }

  private actionRecord(actionId: string): WorkflowActionRecord | undefined {
    const action = this.actions.get(actionId);

    if (!action) {
      return undefined;
    }

    return {
      ...action,
      formFields: [...this.fields.values()]
        .filter((field) => field.actionId === action.id)
        .sort((left, right) => left.sortOrder - right.sortOrder),
    };
  }
}

function page<T>(
  items: T[],
  input: WorkflowConfigListInput,
): PageResult<T> {
  const start = (input.page - 1) * input.pageSize;

  return {
    items: items.slice(start, start + input.pageSize),
    page: input.page,
    pageSize: input.pageSize,
    total: items.length,
  };
}
