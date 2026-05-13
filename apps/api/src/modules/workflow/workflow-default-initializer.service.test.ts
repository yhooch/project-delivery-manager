import { describe, expect, it } from "vitest";

import type {
  ActionFormField,
  Prisma,
  TargetType,
  WorkflowAction,
  WorkflowBinding,
  WorkflowDefinition,
  WorkflowState,
  WorkflowVersion,
  WorkItemType,
} from "../../generated/prisma/client";
import { PrismaService } from "../../prisma/prisma.service";
import { DEFAULT_WORKFLOW_TEMPLATES } from "./default-workflow.templates";
import { WorkflowDefaultBindingService } from "./workflow-default-binding.service";
import { WorkflowDefaultInitializerService } from "./workflow-default-initializer.service";
import { WorkflowDefaultTemplateCopyService } from "./workflow-default-template-copy.service";
import { WorkflowVersionPublisherService } from "./workflow-version-publisher.service";

const ORGANIZATION_ID = "01H00000000000000000000000";
const SPACE_ID = "01H00000000000000000000001";
const ACTOR_USER_ID = "01H00000000000000000000002";

describe("WorkflowDefaultInitializerService", () => {
  it("creates published default workflows, states, actions, fields, and bindings", async () => {
    const { client, service } = createSubject();

    const summaries = await service.initializeDefaultWorkflowsForSpace({
      actorUserId: ACTOR_USER_ID,
      organizationId: ORGANIZATION_ID,
      spaceId: SPACE_ID,
    });

    expect(summaries.map((summary) => summary.code)).toEqual(
      DEFAULT_WORKFLOW_TEMPLATES.map((template) => template.code),
    );
    expect(summaries).toEqual([
      expect.objectContaining({
        actionCount: 8,
        code: "DEVELOPMENT_TASK",
        isDefault: false,
        stateCount: 7,
        version: 1,
        workItemType: "TASK",
      }),
      expect.objectContaining({
        actionCount: 5,
        code: "GENERAL_TASK",
        isDefault: true,
        stateCount: 5,
        version: 1,
        workItemType: "TASK",
      }),
      expect.objectContaining({
        actionCount: 8,
        code: "BUG",
        isDefault: true,
        stateCount: 7,
        version: 1,
        workItemType: "BUG",
      }),
    ]);
    expect(client.workflowDefinitions).toHaveLength(3);
    expect(client.workflowVersions).toHaveLength(3);
    expect(client.workflowVersions.every((version) => version.status === "PUBLISHED"))
      .toBe(true);
    expect(client.workflowVersions.every((version) => version.publishedAt))
      .toBe(true);
    expect(client.workflowStates).toHaveLength(19);
    expect(client.workflowActions).toHaveLength(21);
    expect(client.actionFormFields).toHaveLength(13);
    expect(client.workflowBindings).toEqual([
      expect.objectContaining({
        isDefault: false,
        targetType: "WORK_ITEM",
        workItemType: "TASK",
        workflowDefinitionId: definitionByCode(
          client,
          "DEVELOPMENT_TASK",
        ).id,
      }),
      expect.objectContaining({
        isDefault: true,
        targetType: "WORK_ITEM",
        workItemType: "TASK",
        workflowDefinitionId: definitionByCode(client, "GENERAL_TASK").id,
      }),
      expect.objectContaining({
        isDefault: true,
        targetType: "WORK_ITEM",
        workItemType: "BUG",
        workflowDefinitionId: definitionByCode(client, "BUG").id,
      }),
    ]);

    const developmentVersion = versionByDefinitionCode(
      client,
      "DEVELOPMENT_TASK",
    );

    expect(
      statesForVersion(client, developmentVersion.id).map((state) => ({
        category: state.category,
        code: state.code,
        isEnd: state.isEnd,
        isStart: state.isStart,
      })),
    ).toEqual([
      {
        category: "NOT_STARTED",
        code: "PENDING",
        isEnd: false,
        isStart: true,
      },
      {
        category: "IN_PROGRESS",
        code: "IN_PROGRESS",
        isEnd: false,
        isStart: false,
      },
      {
        category: "WAITING",
        code: "BLOCKED",
        isEnd: false,
        isStart: false,
      },
      {
        category: "WAITING",
        code: "READY_FOR_TEST",
        isEnd: false,
        isStart: false,
      },
      {
        category: "VERIFYING",
        code: "TESTING",
        isEnd: false,
        isStart: false,
      },
      {
        category: "DONE",
        code: "DONE",
        isEnd: true,
        isStart: false,
      },
      {
        category: "TERMINATED",
        code: "CANCELED",
        isEnd: true,
        isStart: false,
      },
    ]);

    const markBlocked = actionByCode(
      client,
      developmentVersion.id,
      "MARK_BLOCKED",
    );
    expect(markBlocked.allowedSpaceRoles).toEqual(["PM", "SPACE_ADMIN"]);
    expect(markBlocked.actorRelations).toEqual(["ASSIGNEE"]);
    expect(fieldsForAction(client, markBlocked.id)).toEqual([
      expect.objectContaining({
        fieldType: "TEXTAREA",
        key: "blockedReason",
        label: "阻塞原因",
        required: true,
      }),
    ]);

    const bugVersion = versionByDefinitionCode(client, "BUG");
    const startFix = actionByCode(client, bugVersion.id, "START_FIX");
    expect(startFix.allowedSpaceRoles).toEqual([
      "DEVELOPER",
      "PM",
      "SPACE_ADMIN",
    ]);
    expect(startFix.actorRelations).toEqual(["ASSIGNEE"]);
    expect(
      fieldsForAction(
        client,
        actionByCode(client, bugVersion.id, "CONFIRM_DEFECT").id,
      ),
    ).toEqual([
      expect.objectContaining({
        fieldType: "USER",
        key: "fixAssigneeId",
        label: "修复负责人",
        required: true,
      }),
    ]);
  });

  it("is idempotent and repairs missing template-owned records", async () => {
    const { client, service } = createSubject();

    const firstSummaries = await service.initializeDefaultWorkflowsForSpace({
      actorUserId: ACTOR_USER_ID,
      organizationId: ORGANIZATION_ID,
      spaceId: SPACE_ID,
    });
    const initialCounts = client.counts();

    const secondSummaries = await service.initializeDefaultWorkflowsForSpace({
      actorUserId: ACTOR_USER_ID,
      organizationId: ORGANIZATION_ID,
      spaceId: SPACE_ID,
    });

    expect(client.counts()).toEqual(initialCounts);
    expect(secondSummaries.map((summary) => summary.workflowId)).toEqual(
      firstSummaries.map((summary) => summary.workflowId),
    );
    expect(secondSummaries.map((summary) => summary.workflowVersionId)).toEqual(
      firstSummaries.map((summary) => summary.workflowVersionId),
    );

    const developmentVersion = versionByDefinitionCode(
      client,
      "DEVELOPMENT_TASK",
    );
    const markBlocked = actionByCode(
      client,
      developmentVersion.id,
      "MARK_BLOCKED",
    );
    client.actionFormFields = client.actionFormFields.filter(
      (field) => field.actionId !== markBlocked.id,
    );
    const bugDefinition = definitionByCode(client, "BUG");
    client.workflowBindings = client.workflowBindings.filter(
      (binding) => binding.workflowDefinitionId !== bugDefinition.id,
    );

    await service.initializeDefaultWorkflowsForSpace({
      actorUserId: ACTOR_USER_ID,
      organizationId: ORGANIZATION_ID,
      spaceId: SPACE_ID,
    });

    expect(client.counts()).toEqual(initialCounts);
    expect(fieldsForAction(client, markBlocked.id)).toEqual([
      expect.objectContaining({
        key: "blockedReason",
      }),
    ]);
    expect(
      client.workflowBindings.find(
        (binding) => binding.workflowDefinitionId === bugDefinition.id,
      ),
    ).toEqual(
      expect.objectContaining({
        isDefault: true,
        workItemType: "BUG",
      }),
    );
  });
});

function createSubject(): {
  readonly client: InMemoryWorkflowPrismaClient;
  readonly service: WorkflowDefaultInitializerService;
} {
  const client = new InMemoryWorkflowPrismaClient();
  const prisma = {
    client,
  } as unknown as PrismaService;
  const publisher = new WorkflowVersionPublisherService();
  const copier = new WorkflowDefaultTemplateCopyService(publisher);
  const bindings = new WorkflowDefaultBindingService();

  return {
    client,
    service: new WorkflowDefaultInitializerService(prisma, copier, bindings),
  };
}

function definitionByCode(
  client: InMemoryWorkflowPrismaClient,
  code: string,
): WorkflowDefinition {
  const definition = client.workflowDefinitions.find((item) => item.code === code);

  if (!definition) {
    throw new Error(`Expected workflow definition ${code}`);
  }

  return definition;
}

function versionByDefinitionCode(
  client: InMemoryWorkflowPrismaClient,
  code: string,
): WorkflowVersion {
  const definition = definitionByCode(client, code);
  const version = client.workflowVersions.find(
    (item) => item.workflowDefinitionId === definition.id,
  );

  if (!version) {
    throw new Error(`Expected workflow version for ${code}`);
  }

  return version;
}

function statesForVersion(
  client: InMemoryWorkflowPrismaClient,
  workflowVersionId: string,
): WorkflowState[] {
  return client.workflowStates
    .filter((state) => state.workflowVersionId === workflowVersionId)
    .sort((left, right) => left.sortOrder - right.sortOrder);
}

function actionByCode(
  client: InMemoryWorkflowPrismaClient,
  workflowVersionId: string,
  code: string,
): WorkflowAction {
  const action = client.workflowActions.find(
    (item) => item.workflowVersionId === workflowVersionId && item.code === code,
  );

  if (!action) {
    throw new Error(`Expected workflow action ${code}`);
  }

  return action;
}

function fieldsForAction(
  client: InMemoryWorkflowPrismaClient,
  actionId: string,
): ActionFormField[] {
  return client.actionFormFields
    .filter((field) => field.actionId === actionId)
    .sort((left, right) => left.sortOrder - right.sortOrder);
}

type SpaceRecord = {
  readonly id: string;
  readonly organizationId: string;
  readonly deletedAt: Date | null;
};

type SpaceFindFirstArgs = {
  readonly where: {
    readonly deletedAt?: null;
    readonly id?: string;
    readonly organizationId?: string;
  };
};

type WorkflowDefinitionWhere = {
  readonly code?: string;
  readonly deletedAt?: null;
  readonly spaceId?: string;
};

type WorkflowDefinitionCreateData = Pick<
  WorkflowDefinition,
  | "code"
  | "description"
  | "id"
  | "name"
  | "organizationId"
  | "spaceId"
  | "status"
> &
  Partial<Pick<WorkflowDefinition, "createdById" | "updatedById">>;

type WorkflowDefinitionUpdateData = Partial<
  Pick<
    WorkflowDefinition,
    "description" | "name" | "organizationId" | "status" | "updatedById"
  >
>;

type WorkflowVersionWhere = {
  readonly deletedAt?: null;
  readonly version?: number;
  readonly workflowDefinitionId?: string;
};

type WorkflowVersionCreateData = Pick<
  WorkflowVersion,
  "id" | "status" | "version" | "workflowDefinitionId"
> &
  Partial<
    Pick<
      WorkflowVersion,
      "createdById" | "publishedAt" | "publishedById" | "updatedById"
    >
  >;

type WorkflowVersionUpdateData = Partial<
  Pick<
    WorkflowVersion,
    "publishedAt" | "publishedById" | "status" | "updatedById"
  >
>;

type StringFilter = {
  readonly not?: string;
};

type WorkflowStateWhere = {
  readonly code?: string | StringFilter;
  readonly deletedAt?: null;
  readonly isStart?: boolean;
  readonly workflowVersionId?: string;
};

type WorkflowStateCreateData = Pick<
  WorkflowState,
  | "category"
  | "code"
  | "id"
  | "isEnd"
  | "isStart"
  | "name"
  | "sortOrder"
  | "workflowVersionId"
> &
  Partial<Pick<WorkflowState, "createdById" | "updatedById">>;

type WorkflowStateUpdateData = Partial<
  Pick<
    WorkflowState,
    "category" | "isEnd" | "isStart" | "name" | "sortOrder" | "updatedById"
  >
>;

type WorkflowActionWhere = {
  readonly code?: string;
  readonly deletedAt?: null;
  readonly workflowVersionId?: string;
};

type WorkflowActionCreateData = Pick<
  WorkflowAction,
  | "actorRelations"
  | "allowedSpaceRoles"
  | "code"
  | "fromStateId"
  | "id"
  | "name"
  | "requiresComment"
  | "sortOrder"
  | "toStateId"
  | "workflowVersionId"
> &
  Partial<Pick<WorkflowAction, "createdById" | "updatedById">>;

type WorkflowActionUpdateData = Partial<
  Pick<
    WorkflowAction,
    | "actorRelations"
    | "allowedSpaceRoles"
    | "fromStateId"
    | "name"
    | "requiresComment"
    | "sortOrder"
    | "toStateId"
    | "updatedById"
  >
>;

type ActionFormFieldWhere = {
  readonly actionId?: string;
  readonly deletedAt?: null;
  readonly key?: string;
};

type ActionFormFieldCreateData = Pick<
  ActionFormField,
  | "actionId"
  | "fieldType"
  | "id"
  | "key"
  | "label"
  | "options"
  | "required"
  | "sortOrder"
> &
  Partial<Pick<ActionFormField, "createdById" | "updatedById">>;

type ActionFormFieldUpdateData = Partial<
  Pick<
    ActionFormField,
    "fieldType" | "label" | "options" | "required" | "sortOrder" | "updatedById"
  >
>;

type WorkflowBindingWhere = {
  readonly deletedAt?: null;
  readonly spaceId?: string;
  readonly targetType?: TargetType;
  readonly workItemType?: WorkItemType;
  readonly workflowDefinitionId?: string;
};

type WorkflowBindingCreateData = Pick<
  WorkflowBinding,
  | "id"
  | "isDefault"
  | "organizationId"
  | "priority"
  | "spaceId"
  | "targetType"
  | "workItemType"
  | "workflowDefinitionId"
  | "workflowVersionId"
> &
  Partial<Pick<WorkflowBinding, "createdById" | "updatedById">>;

type WorkflowBindingUpdateData = Partial<
  Pick<
    WorkflowBinding,
    | "isDefault"
    | "organizationId"
    | "priority"
    | "spaceId"
    | "targetType"
    | "updatedById"
    | "workItemType"
    | "workflowDefinitionId"
    | "workflowVersionId"
  >
>;

class InMemoryWorkflowPrismaClient {
  readonly spaces: SpaceRecord[] = [
    {
      deletedAt: null,
      id: SPACE_ID,
      organizationId: ORGANIZATION_ID,
    },
  ];

  workflowDefinitions: WorkflowDefinition[] = [];
  workflowVersions: WorkflowVersion[] = [];
  workflowStates: WorkflowState[] = [];
  workflowActions: WorkflowAction[] = [];
  actionFormFields: ActionFormField[] = [];
  workflowBindings: WorkflowBinding[] = [];

  readonly space = {
    findFirst: async (args: SpaceFindFirstArgs): Promise<SpaceRecord | null> =>
      this.spaces.find(
        (space) =>
          matchesDeletedAt(space.deletedAt, args.where.deletedAt) &&
          matchesValue(space.id, args.where.id) &&
          matchesValue(space.organizationId, args.where.organizationId),
      ) ?? null,
  };

  readonly workflowDefinition = {
    create: async (args: {
      readonly data: WorkflowDefinitionCreateData;
    }): Promise<WorkflowDefinition> => {
      const record = createWorkflowDefinitionRecord(args.data);
      this.workflowDefinitions.push(record);
      return record;
    },
    findFirst: async (args: {
      readonly where: WorkflowDefinitionWhere;
    }): Promise<WorkflowDefinition | null> =>
      this.workflowDefinitions.find((record) =>
        matchesWorkflowDefinition(record, args.where),
      ) ?? null,
    update: async (args: {
      readonly data: WorkflowDefinitionUpdateData;
      readonly where: { readonly id: string };
    }): Promise<WorkflowDefinition> =>
      updateRecord(this.workflowDefinitions, args.where.id, args.data),
  };

  readonly workflowVersion = {
    create: async (args: {
      readonly data: WorkflowVersionCreateData;
    }): Promise<WorkflowVersion> => {
      const record = createWorkflowVersionRecord(args.data);
      this.workflowVersions.push(record);
      return record;
    },
    findFirst: async (args: {
      readonly where: WorkflowVersionWhere;
    }): Promise<WorkflowVersion | null> =>
      this.workflowVersions.find((record) =>
        matchesWorkflowVersion(record, args.where),
      ) ?? null,
    update: async (args: {
      readonly data: WorkflowVersionUpdateData;
      readonly where: { readonly id: string };
    }): Promise<WorkflowVersion> =>
      updateRecord(this.workflowVersions, args.where.id, args.data),
  };

  readonly workflowState = {
    create: async (args: {
      readonly data: WorkflowStateCreateData;
    }): Promise<WorkflowState> => {
      const record = createWorkflowStateRecord(args.data);
      this.workflowStates.push(record);
      return record;
    },
    findFirst: async (args: {
      readonly where: WorkflowStateWhere;
    }): Promise<WorkflowState | null> =>
      this.workflowStates.find((record) =>
        matchesWorkflowState(record, args.where),
      ) ?? null,
    update: async (args: {
      readonly data: WorkflowStateUpdateData;
      readonly where: { readonly id: string };
    }): Promise<WorkflowState> =>
      updateRecord(this.workflowStates, args.where.id, args.data),
    updateMany: async (args: {
      readonly data: WorkflowStateUpdateData;
      readonly where: WorkflowStateWhere;
    }): Promise<{ readonly count: number }> => {
      const records = this.workflowStates.filter((record) =>
        matchesWorkflowState(record, args.where),
      );

      for (const record of records) {
        updateRecord(this.workflowStates, record.id, args.data);
      }

      return {
        count: records.length,
      };
    },
  };

  readonly workflowAction = {
    create: async (args: {
      readonly data: WorkflowActionCreateData;
    }): Promise<WorkflowAction> => {
      const record = createWorkflowActionRecord(args.data);
      this.workflowActions.push(record);
      return record;
    },
    findFirst: async (args: {
      readonly where: WorkflowActionWhere;
    }): Promise<WorkflowAction | null> =>
      this.workflowActions.find((record) =>
        matchesWorkflowAction(record, args.where),
      ) ?? null,
    update: async (args: {
      readonly data: WorkflowActionUpdateData;
      readonly where: { readonly id: string };
    }): Promise<WorkflowAction> =>
      updateRecord(this.workflowActions, args.where.id, args.data),
  };

  readonly actionFormField = {
    create: async (args: {
      readonly data: ActionFormFieldCreateData;
    }): Promise<ActionFormField> => {
      const record = createActionFormFieldRecord(args.data);
      this.actionFormFields.push(record);
      return record;
    },
    findFirst: async (args: {
      readonly where: ActionFormFieldWhere;
    }): Promise<ActionFormField | null> =>
      this.actionFormFields.find((record) =>
        matchesActionFormField(record, args.where),
      ) ?? null,
    update: async (args: {
      readonly data: ActionFormFieldUpdateData;
      readonly where: { readonly id: string };
    }): Promise<ActionFormField> =>
      updateRecord(this.actionFormFields, args.where.id, args.data),
  };

  readonly workflowBinding = {
    create: async (args: {
      readonly data: WorkflowBindingCreateData;
    }): Promise<WorkflowBinding> => {
      const record = createWorkflowBindingRecord(args.data);
      this.workflowBindings.push(record);
      return record;
    },
    findFirst: async (args: {
      readonly where: WorkflowBindingWhere;
    }): Promise<WorkflowBinding | null> =>
      this.workflowBindings.find((record) =>
        matchesWorkflowBinding(record, args.where),
      ) ?? null,
    update: async (args: {
      readonly data: WorkflowBindingUpdateData;
      readonly where: { readonly id: string };
    }): Promise<WorkflowBinding> =>
      updateRecord(this.workflowBindings, args.where.id, args.data),
  };

  async $transaction<T>(
    callback: (tx: Prisma.TransactionClient) => Promise<T>,
  ): Promise<T> {
    return callback(this as unknown as Prisma.TransactionClient);
  }

  counts(): Record<string, number> {
    return {
      actionFormFields: this.actionFormFields.length,
      workflowActions: this.workflowActions.length,
      workflowBindings: this.workflowBindings.length,
      workflowDefinitions: this.workflowDefinitions.length,
      workflowStates: this.workflowStates.length,
      workflowVersions: this.workflowVersions.length,
    };
  }
}

function createWorkflowDefinitionRecord(
  data: WorkflowDefinitionCreateData,
): WorkflowDefinition {
  return {
    code: data.code,
    createdAt: new Date(),
    createdById: data.createdById ?? null,
    deletedAt: null,
    description: data.description,
    id: data.id,
    name: data.name,
    organizationId: data.organizationId,
    spaceId: data.spaceId,
    status: data.status,
    updatedAt: new Date(),
    updatedById: data.updatedById ?? null,
  };
}

function createWorkflowVersionRecord(
  data: WorkflowVersionCreateData,
): WorkflowVersion {
  return {
    createdAt: new Date(),
    createdById: data.createdById ?? null,
    deletedAt: null,
    id: data.id,
    publishedAt: data.publishedAt ?? null,
    publishedById: data.publishedById ?? null,
    status: data.status,
    updatedAt: new Date(),
    updatedById: data.updatedById ?? null,
    version: data.version,
    workflowDefinitionId: data.workflowDefinitionId,
  };
}

function createWorkflowStateRecord(data: WorkflowStateCreateData): WorkflowState {
  return {
    category: data.category,
    code: data.code,
    createdAt: new Date(),
    createdById: data.createdById ?? null,
    deletedAt: null,
    id: data.id,
    isEnd: data.isEnd,
    isStart: data.isStart,
    name: data.name,
    sortOrder: data.sortOrder,
    updatedAt: new Date(),
    updatedById: data.updatedById ?? null,
    workflowVersionId: data.workflowVersionId,
  };
}

function createWorkflowActionRecord(
  data: WorkflowActionCreateData,
): WorkflowAction {
  return {
    actorRelations: [...data.actorRelations],
    allowedSpaceRoles: [...data.allowedSpaceRoles],
    code: data.code,
    createdAt: new Date(),
    createdById: data.createdById ?? null,
    deletedAt: null,
    fromStateId: data.fromStateId,
    id: data.id,
    name: data.name,
    requiresComment: data.requiresComment,
    sortOrder: data.sortOrder,
    toStateId: data.toStateId,
    updatedAt: new Date(),
    updatedById: data.updatedById ?? null,
    workflowVersionId: data.workflowVersionId,
  };
}

function createActionFormFieldRecord(
  data: ActionFormFieldCreateData,
): ActionFormField {
  return {
    actionId: data.actionId,
    createdAt: new Date(),
    createdById: data.createdById ?? null,
    deletedAt: null,
    fieldType: data.fieldType,
    id: data.id,
    key: data.key,
    label: data.label,
    options: [...data.options],
    required: data.required,
    sortOrder: data.sortOrder,
    updatedAt: new Date(),
    updatedById: data.updatedById ?? null,
  };
}

function createWorkflowBindingRecord(
  data: WorkflowBindingCreateData,
): WorkflowBinding {
  return {
    createdAt: new Date(),
    createdById: data.createdById ?? null,
    deletedAt: null,
    id: data.id,
    isDefault: data.isDefault,
    organizationId: data.organizationId,
    priority: data.priority,
    spaceId: data.spaceId,
    targetType: data.targetType,
    updatedAt: new Date(),
    updatedById: data.updatedById ?? null,
    workItemType: data.workItemType,
    workflowDefinitionId: data.workflowDefinitionId,
    workflowVersionId: data.workflowVersionId,
  };
}

function updateRecord<TRecord extends { readonly id: string; updatedAt: Date }>(
  records: TRecord[],
  id: string,
  data: Partial<Omit<TRecord, "id">>,
): TRecord {
  const index = records.findIndex((record) => record.id === id);

  if (index < 0) {
    throw new Error(`Record ${id} not found`);
  }

  const updated = {
    ...records[index],
    ...data,
    updatedAt: new Date(),
  } as TRecord;
  records[index] = updated;

  return updated;
}

function matchesWorkflowDefinition(
  record: WorkflowDefinition,
  where: WorkflowDefinitionWhere,
): boolean {
  return (
    matchesValue(record.code, where.code) &&
    matchesDeletedAt(record.deletedAt, where.deletedAt) &&
    matchesValue(record.spaceId, where.spaceId)
  );
}

function matchesWorkflowVersion(
  record: WorkflowVersion,
  where: WorkflowVersionWhere,
): boolean {
  return (
    matchesDeletedAt(record.deletedAt, where.deletedAt) &&
    matchesValue(record.version, where.version) &&
    matchesValue(record.workflowDefinitionId, where.workflowDefinitionId)
  );
}

function matchesWorkflowState(
  record: WorkflowState,
  where: WorkflowStateWhere,
): boolean {
  return (
    matchesStringFilter(record.code, where.code) &&
    matchesDeletedAt(record.deletedAt, where.deletedAt) &&
    matchesValue(record.isStart, where.isStart) &&
    matchesValue(record.workflowVersionId, where.workflowVersionId)
  );
}

function matchesWorkflowAction(
  record: WorkflowAction,
  where: WorkflowActionWhere,
): boolean {
  return (
    matchesValue(record.code, where.code) &&
    matchesDeletedAt(record.deletedAt, where.deletedAt) &&
    matchesValue(record.workflowVersionId, where.workflowVersionId)
  );
}

function matchesActionFormField(
  record: ActionFormField,
  where: ActionFormFieldWhere,
): boolean {
  return (
    matchesValue(record.actionId, where.actionId) &&
    matchesDeletedAt(record.deletedAt, where.deletedAt) &&
    matchesValue(record.key, where.key)
  );
}

function matchesWorkflowBinding(
  record: WorkflowBinding,
  where: WorkflowBindingWhere,
): boolean {
  return (
    matchesDeletedAt(record.deletedAt, where.deletedAt) &&
    matchesValue(record.spaceId, where.spaceId) &&
    matchesValue(record.targetType, where.targetType) &&
    matchesValue(record.workItemType, where.workItemType) &&
    matchesValue(record.workflowDefinitionId, where.workflowDefinitionId)
  );
}

function matchesStringFilter(
  value: string,
  filter: string | StringFilter | undefined,
): boolean {
  if (!filter) {
    return true;
  }

  if (typeof filter === "string") {
    return value === filter;
  }

  return filter.not === undefined || value !== filter.not;
}

function matchesDeletedAt(
  value: Date | null,
  expected: null | undefined,
): boolean {
  return expected === undefined || value === expected;
}

function matchesValue<T>(value: T, expected: T | undefined): boolean {
  return expected === undefined || value === expected;
}
