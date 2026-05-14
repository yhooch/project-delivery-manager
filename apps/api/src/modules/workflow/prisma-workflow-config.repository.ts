import { Inject, Injectable } from "@nestjs/common";
import { ulid } from "ulid";

import { Prisma } from "../../generated/prisma/client";
import { PrismaService } from "../../prisma/prisma.service";
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
} from "./workflow-config.repository";

const VERSION_INCLUDE = {
  actions: {
    include: {
      formFields: {
        orderBy: {
          sortOrder: "asc" as const,
        },
        where: {
          deletedAt: null,
        },
      },
    },
    orderBy: {
      sortOrder: "asc" as const,
    },
    where: {
      deletedAt: null,
    },
  },
  states: {
    orderBy: {
      sortOrder: "asc" as const,
    },
    where: {
      deletedAt: null,
    },
  },
};

const ACTION_INCLUDE = {
  formFields: {
    orderBy: {
      sortOrder: "asc" as const,
    },
    where: {
      deletedAt: null,
    },
  },
};

@Injectable()
export class PrismaWorkflowConfigRepository
  implements WorkflowConfigRepository
{
  constructor(
    @Inject(PrismaService)
    private readonly prisma: PrismaService,
  ) {}

  async findSpaceById(spaceId: string) {
    const space = await this.prisma.client.space.findFirst({
      select: {
        id: true,
        organizationId: true,
        ownerId: true,
      },
      where: {
        deletedAt: null,
        id: spaceId,
        organization: {
          deletedAt: null,
          status: "ACTIVE",
        },
        status: "ACTIVE",
      },
    });

    return space
      ? {
          id: space.id,
          organizationId: space.organizationId,
          ownerId: space.ownerId ?? undefined,
        }
      : undefined;
  }

  async findSpaceAccess(actorUserId: string, spaceId: string) {
    const member = await this.prisma.client.spaceMember.findFirst({
      include: {
        space: {
          select: {
            id: true,
            organizationId: true,
            ownerId: true,
          },
        },
      },
      where: {
        deletedAt: null,
        spaceId,
        status: "ACTIVE",
        userId: actorUserId,
        organization: {
          deletedAt: null,
          members: {
            some: {
              deletedAt: null,
              status: "ACTIVE",
              userId: actorUserId,
            },
          },
          status: "ACTIVE",
        },
        space: {
          deletedAt: null,
          status: "ACTIVE",
        },
        user: {
          deletedAt: null,
          status: "ACTIVE",
        },
      },
    });

    return member
      ? {
          role: member.role,
          space: {
            id: member.space.id,
            organizationId: member.space.organizationId,
            ownerId: member.space.ownerId ?? undefined,
          },
        }
      : undefined;
  }

  async listDefinitions(spaceId: string, input: WorkflowConfigListInput) {
    const where = {
      deletedAt: null,
      spaceId,
    };
    const [items, total] = await this.prisma.client.$transaction([
      this.prisma.client.workflowDefinition.findMany({
        orderBy: workflowDefinitionOrderBy(input),
        skip: (input.page - 1) * input.pageSize,
        take: input.pageSize,
        where,
      }),
      this.prisma.client.workflowDefinition.count({
        where,
      }),
    ]);

    return {
      items: items.map(toDefinitionRecord),
      page: input.page,
      pageSize: input.pageSize,
      total,
    };
  }

  async listVersions(workflowId: string, input: WorkflowConfigListInput) {
    const where = {
      deletedAt: null,
      workflowId,
    };
    const [items, total] = await this.prisma.client.$transaction([
      this.prisma.client.workflowVersion.findMany({
        include: VERSION_INCLUDE,
        orderBy: { version: "desc" as const },
        skip: (input.page - 1) * input.pageSize,
        take: input.pageSize,
        where,
      }),
      this.prisma.client.workflowVersion.count({
        where,
      }),
    ]);

    return {
      items: items.map(toVersionRecord),
      page: input.page,
      pageSize: input.pageSize,
      total,
    };
  }

  async createDefinition(input: CreateWorkflowDefinitionInput) {
    const definition = await this.prisma.client.workflowDefinition.create({
      data: {
        id: input.id,
        code: input.code,
        createdById: input.actorUserId,
        description: input.description,
        name: input.name,
        organizationId: input.organizationId,
        spaceId: input.spaceId,
        status: "DRAFT",
        updatedById: input.actorUserId,
      },
    });

    return toDefinitionRecord(definition);
  }

  async findDefinitionById(workflowId: string) {
    const definition = await this.prisma.client.workflowDefinition.findFirst({
      where: {
        deletedAt: null,
        id: workflowId,
      },
    });

    return definition ? toDefinitionRecord(definition) : undefined;
  }

  async updateDefinition(input: UpdateWorkflowDefinitionInput) {
    const updated = await this.prisma.client.workflowDefinition.updateMany({
      data: removeUndefined({
        code: input.code,
        description: input.description,
        name: input.name,
        status: input.status,
        updatedById: input.actorUserId,
      }),
      where: {
        deletedAt: null,
        id: input.workflowId,
      },
    });

    if (updated.count === 0) {
      return undefined;
    }

    return this.findDefinitionById(input.workflowId);
  }

  async createDraftVersion(input: CreateDraftWorkflowVersionInput) {
    return this.prisma.client.$transaction(async (tx) => {
      const definition = await tx.workflowDefinition.findFirst({
        select: {
          id: true,
          spaceId: true,
        },
        where: {
          deletedAt: null,
          id: input.workflowId,
        },
      });

      if (!definition) {
        return undefined;
      }

      const maxVersion = await tx.workflowVersion.aggregate({
        _max: {
          version: true,
        },
        where: {
          deletedAt: null,
          workflowDefinitionId: input.workflowId,
        },
      });
      const source = await findSourceVersion(tx, input, definition.spaceId);

      if (input.sourceWorkflowVersionId && !source) {
        return undefined;
      }

      const draft = await tx.workflowVersion.create({
        data: {
          id: ulid(),
          createdById: input.actorUserId,
          status: "DRAFT",
          updatedById: input.actorUserId,
          version: (maxVersion._max.version ?? 0) + 1,
          workflowDefinitionId: input.workflowId,
        },
      });

      if (source) {
        await copyVersionContent(tx, {
          actorUserId: input.actorUserId,
          source,
          targetWorkflowVersionId: draft.id,
        });
      }

      return findVersionById(tx, draft.id);
    });
  }

  async findVersionById(workflowVersionId: string) {
    return findVersionById(this.prisma.client, workflowVersionId);
  }

  async getVersionForValidation(workflowVersionId: string) {
    return findVersionById(this.prisma.client, workflowVersionId);
  }

  async updateVersionStatus(input: UpdateWorkflowVersionStatusInput) {
    const updated = await this.prisma.client.workflowVersion.updateMany({
      data: {
        status: input.status,
        updatedById: input.actorUserId,
      },
      where: {
        deletedAt: null,
        id: input.workflowVersionId,
      },
    });

    if (updated.count === 0) {
      return undefined;
    }

    return this.findVersionById(input.workflowVersionId);
  }

  async publishVersion(input: PublishWorkflowVersionInput) {
    const updated = await this.prisma.client.$transaction(async (tx) => {
      const result = await tx.workflowVersion.updateMany({
        data: {
          publishedAt: input.publishedAt,
          publishedById: input.actorUserId,
          status: "PUBLISHED",
          updatedById: input.actorUserId,
        },
        where: {
          deletedAt: null,
          id: input.workflowVersionId,
        },
      });

      if (result.count === 0) {
        return undefined;
      }

      const version = await tx.workflowVersion.findFirst({
        select: {
          workflowDefinitionId: true,
        },
        where: {
          deletedAt: null,
          id: input.workflowVersionId,
        },
      });

      if (version) {
        await tx.workflowDefinition.updateMany({
          data: {
            status: "ACTIVE",
            updatedById: input.actorUserId,
          },
          where: {
            deletedAt: null,
            id: version.workflowDefinitionId,
          },
        });
      }

      return findVersionById(tx, input.workflowVersionId);
    });

    return updated;
  }

  async createState(input: CreateWorkflowStateInput) {
    return this.prisma.client.$transaction(async (tx) => {
      if (input.isStart) {
        await tx.workflowState.updateMany({
          data: {
            isStart: false,
            updatedById: input.actorUserId,
          },
          where: {
            deletedAt: null,
            id: {
              not: input.id,
            },
            isStart: true,
            workflowVersionId: input.workflowVersionId,
          },
        });
      }

      const state = await tx.workflowState.create({
        data: {
          id: input.id,
          category: input.category,
          code: input.code,
          createdById: input.actorUserId,
          isEnd: input.isEnd,
          isStart: input.isStart,
          name: input.name,
          sortOrder: input.order,
          updatedById: input.actorUserId,
          workflowVersionId: input.workflowVersionId,
        },
      });

      return toStateRecord(state);
    });
  }

  async findStateById(stateId: string) {
    const state = await this.prisma.client.workflowState.findFirst({
      where: {
        deletedAt: null,
        id: stateId,
      },
    });

    return state ? toStateRecord(state) : undefined;
  }

  async updateState(input: UpdateWorkflowStateInput) {
    return this.prisma.client.$transaction(async (tx) => {
      const existing = await tx.workflowState.findFirst({
        where: {
          deletedAt: null,
          id: input.stateId,
        },
      });

      if (!existing) {
        return undefined;
      }

      if (input.isStart) {
        await tx.workflowState.updateMany({
          data: {
            isStart: false,
            updatedById: input.actorUserId,
          },
          where: {
            deletedAt: null,
            id: {
              not: input.stateId,
            },
            isStart: true,
            workflowVersionId: existing.workflowVersionId,
          },
        });
      }

      const state = await tx.workflowState.update({
        data: removeUndefined({
          category: input.category,
          code: input.code,
          isEnd: input.isEnd,
          isStart: input.isStart,
          name: input.name,
          sortOrder: input.order,
          updatedById: input.actorUserId,
        }),
        where: {
          id: input.stateId,
        },
      });

      return toStateRecord(state);
    });
  }

  async deleteState(stateId: string, actorUserId: string) {
    return this.prisma.client.$transaction(async (tx) => {
      const existing = await tx.workflowState.findFirst({
        where: {
          deletedAt: null,
          id: stateId,
        },
      });

      if (!existing) {
        return undefined;
      }

      const now = new Date();
      const relatedActions = await tx.workflowAction.findMany({
        select: {
          id: true,
        },
        where: {
          deletedAt: null,
          OR: [{ fromStateId: stateId }, { toStateId: stateId }],
        },
      });

      await tx.actionFormField.updateMany({
        data: {
          deletedAt: now,
          updatedById: actorUserId,
        },
        where: {
          actionId: {
            in: relatedActions.map((action) => action.id),
          },
          deletedAt: null,
        },
      });
      await tx.workflowAction.updateMany({
        data: {
          deletedAt: now,
          updatedById: actorUserId,
        },
        where: {
          id: {
            in: relatedActions.map((action) => action.id),
          },
        },
      });
      const state = await tx.workflowState.update({
        data: {
          deletedAt: now,
          updatedById: actorUserId,
        },
        where: {
          id: stateId,
        },
      });

      return toStateRecord(state);
    });
  }

  async createAction(input: CreateWorkflowActionInput) {
    const action = await this.prisma.client.workflowAction.create({
      data: {
        id: input.id,
        actorRelations: input.actorRelations,
        allowedSpaceRoles: input.allowedSpaceRoles,
        code: input.code,
        createdById: input.actorUserId,
        fromStateId: input.fromStateId,
        name: input.name,
        requiresComment: input.requiresComment,
        sortOrder: input.order,
        toStateId: input.toStateId,
        updatedById: input.actorUserId,
        workflowVersionId: input.workflowVersionId,
      },
      include: ACTION_INCLUDE,
    });

    return toActionRecord(action);
  }

  async findActionById(actionId: string) {
    const action = await this.prisma.client.workflowAction.findFirst({
      include: ACTION_INCLUDE,
      where: {
        deletedAt: null,
        id: actionId,
      },
    });

    return action ? toActionRecord(action) : undefined;
  }

  async updateAction(input: UpdateWorkflowActionInput) {
    const updated = await this.prisma.client.workflowAction.updateMany({
      data: removeUndefined({
        actorRelations: input.actorRelations,
        allowedSpaceRoles: input.allowedSpaceRoles,
        code: input.code,
        fromStateId: input.fromStateId,
        name: input.name,
        requiresComment: input.requiresComment,
        sortOrder: input.order,
        toStateId: input.toStateId,
        updatedById: input.actorUserId,
      }),
      where: {
        deletedAt: null,
        id: input.actionId,
      },
    });

    if (updated.count === 0) {
      return undefined;
    }

    return this.findActionById(input.actionId);
  }

  async deleteAction(actionId: string, actorUserId: string) {
    return this.prisma.client.$transaction(async (tx) => {
      const existing = await tx.workflowAction.findFirst({
        include: ACTION_INCLUDE,
        where: {
          deletedAt: null,
          id: actionId,
        },
      });

      if (!existing) {
        return undefined;
      }

      const now = new Date();

      await tx.actionFormField.updateMany({
        data: {
          deletedAt: now,
          updatedById: actorUserId,
        },
        where: {
          actionId,
          deletedAt: null,
        },
      });
      await tx.workflowAction.update({
        data: {
          deletedAt: now,
          updatedById: actorUserId,
        },
        where: {
          id: actionId,
        },
      });

      return toActionRecord(existing);
    });
  }

  async createFormField(input: CreateActionFormFieldInput) {
    const field = await this.prisma.client.actionFormField.create({
      data: {
        id: input.id,
        actionId: input.actionId,
        createdById: input.actorUserId,
        fieldType: input.fieldType,
        key: input.key,
        label: input.label,
        options: input.options,
        required: input.required,
        sortOrder: input.order,
        updatedById: input.actorUserId,
      },
    });

    return toFormFieldRecord(field);
  }

  async findFormFieldById(fieldId: string) {
    const field = await this.prisma.client.actionFormField.findFirst({
      include: {
        action: {
          include: ACTION_INCLUDE,
        },
      },
      where: {
        deletedAt: null,
        id: fieldId,
      },
    });

    return field
      ? {
          ...toFormFieldRecord(field),
          action: toActionRecord(field.action),
        }
      : undefined;
  }

  async updateFormField(input: UpdateActionFormFieldInput) {
    const updated = await this.prisma.client.actionFormField.updateMany({
      data: removeUndefined({
        fieldType: input.fieldType,
        key: input.key,
        label: input.label,
        options: input.options,
        required: input.required,
        sortOrder: input.order,
        updatedById: input.actorUserId,
      }),
      where: {
        deletedAt: null,
        id: input.fieldId,
      },
    });

    if (updated.count === 0) {
      return undefined;
    }

    const field = await this.prisma.client.actionFormField.findFirst({
      where: {
        deletedAt: null,
        id: input.fieldId,
      },
    });

    return field ? toFormFieldRecord(field) : undefined;
  }

  async deleteFormField(fieldId: string, actorUserId: string) {
    const field = await this.prisma.client.actionFormField.findFirst({
      where: {
        deletedAt: null,
        id: fieldId,
      },
    });

    if (!field) {
      return undefined;
    }

    await this.prisma.client.actionFormField.update({
      data: {
        deletedAt: new Date(),
        updatedById: actorUserId,
      },
      where: {
        id: fieldId,
      },
    });

    return toFormFieldRecord(field);
  }

  async listBindings(spaceId: string, input: WorkflowBindingListInput) {
    const where: Prisma.WorkflowBindingWhereInput = {
      deletedAt: null,
      isDefault: input.isDefault,
      priority: input.priority,
      spaceId,
      targetType: "WORK_ITEM",
      workItemType: input.workItemType,
    };
    const [items, total] = await this.prisma.client.$transaction([
      this.prisma.client.workflowBinding.findMany({
        orderBy: workflowBindingOrderBy(input),
        skip: (input.page - 1) * input.pageSize,
        take: input.pageSize,
        where,
      }),
      this.prisma.client.workflowBinding.count({
        where,
      }),
    ]);

    return {
      items: items.map(toBindingRecord),
      page: input.page,
      pageSize: input.pageSize,
      total,
    };
  }

  async findBindingById(bindingId: string) {
    const binding = await this.prisma.client.workflowBinding.findFirst({
      where: {
        deletedAt: null,
        id: bindingId,
      },
    });

    return binding ? toBindingRecord(binding) : undefined;
  }

  async createBinding(input: UpsertWorkflowBindingInput) {
    return this.prisma.client.$transaction((tx) =>
      upsertBinding(tx, {
        ...input,
        bindingId: undefined,
        id: input.id ?? ulid(),
      }),
    );
  }

  async updateBinding(input: UpsertWorkflowBindingInput) {
    return this.prisma.client.$transaction((tx) => upsertBinding(tx, input));
  }

  async listDefaultBindingsForDefinition(workflowId: string) {
    const bindings = await this.prisma.client.workflowBinding.findMany({
      where: {
        deletedAt: null,
        isDefault: true,
        targetType: "WORK_ITEM",
        workflowDefinitionId: workflowId,
      },
    });

    return bindings.map(toBindingRecord);
  }

  async listDefaultBindingsForVersion(workflowVersionId: string) {
    const bindings = await this.prisma.client.workflowBinding.findMany({
      where: {
        deletedAt: null,
        isDefault: true,
        targetType: "WORK_ITEM",
        workflowVersionId,
      },
    });

    return bindings.map(toBindingRecord);
  }

  async hasReplacementDefaultBinding(input: {
    excludeWorkflowDefinitionId?: string;
    excludeWorkflowVersionId?: string;
    spaceId: string;
    workItemType: "TASK" | "BUG";
  }) {
    const binding = await this.prisma.client.workflowBinding.findFirst({
      select: {
        id: true,
      },
      where: {
        deletedAt: null,
        isDefault: true,
        spaceId: input.spaceId,
        targetType: "WORK_ITEM",
        workItemType: input.workItemType,
        workflowDefinitionId: input.excludeWorkflowDefinitionId
          ? {
              not: input.excludeWorkflowDefinitionId,
            }
          : undefined,
        workflowVersionId: input.excludeWorkflowVersionId
          ? {
              not: input.excludeWorkflowVersionId,
            }
          : undefined,
        workflowDefinition: {
          deletedAt: null,
          status: "ACTIVE",
        },
        workflowVersion: {
          deletedAt: null,
          status: "PUBLISHED",
        },
      },
    });

    return Boolean(binding);
  }

  async createAuditLog(input: AuditLogInput) {
    await this.prisma.client.auditLog.create({
      data: {
        id: input.id,
        actionType: input.actionType,
        actorId: input.actorId,
        after: toJson(input.after),
        before: toJson(input.before),
        ip: input.ip,
        metadata: toJson(input.metadata),
        organizationId: input.organizationId,
        requestId: input.requestId,
        spaceId: input.spaceId,
        targetId: input.targetId,
        targetType: input.targetType,
        userAgent: input.userAgent,
      },
    });
  }
}

type PrismaDefinitionRecord = WorkflowDefinitionRecord;
type PrismaStateRecord = Omit<WorkflowStateRecord, "sortOrder"> & {
  sortOrder: number;
};
type PrismaFormFieldRecord = Omit<ActionFormFieldRecord, "sortOrder"> & {
  sortOrder: number;
};
type PrismaActionRecord = Omit<WorkflowActionRecord, "formFields"> & {
  formFields: PrismaFormFieldRecord[];
};
type PrismaVersionRecord = Omit<WorkflowVersionRecord, "actions" | "states"> & {
  actions: PrismaActionRecord[];
  states: PrismaStateRecord[];
};
type PrismaBindingRecord = Omit<WorkflowBindingRecord, "priority"> & {
  priority: WorkflowBindingRecord["priority"] | null;
};

function toDefinitionRecord(record: PrismaDefinitionRecord): WorkflowDefinitionRecord {
  return {
    code: record.code,
    description: record.description,
    id: record.id,
    name: record.name,
    organizationId: record.organizationId,
    spaceId: record.spaceId,
    status: record.status,
  };
}

function toVersionRecord(record: PrismaVersionRecord): WorkflowVersionRecord {
  return {
    actions: record.actions.map(toActionRecord),
    id: record.id,
    publishedAt: record.publishedAt,
    states: record.states.map(toStateRecord),
    status: record.status,
    version: record.version,
    workflowDefinitionId: record.workflowDefinitionId,
  };
}

function toStateRecord(record: PrismaStateRecord): WorkflowStateRecord {
  return {
    category: record.category,
    code: record.code,
    id: record.id,
    isEnd: record.isEnd,
    isStart: record.isStart,
    name: record.name,
    sortOrder: record.sortOrder,
    workflowVersionId: record.workflowVersionId,
  };
}

function toActionRecord(record: PrismaActionRecord): WorkflowActionRecord {
  return {
    actorRelations: record.actorRelations,
    allowedSpaceRoles: record.allowedSpaceRoles,
    code: record.code,
    formFields: record.formFields.map(toFormFieldRecord),
    fromStateId: record.fromStateId,
    id: record.id,
    name: record.name,
    requiresComment: record.requiresComment,
    sortOrder: record.sortOrder,
    toStateId: record.toStateId,
    workflowVersionId: record.workflowVersionId,
  };
}

function toFormFieldRecord(record: PrismaFormFieldRecord): ActionFormFieldRecord {
  return {
    fieldType: record.fieldType,
    id: record.id,
    key: record.key,
    label: record.label,
    options: record.options,
    required: record.required,
    sortOrder: record.sortOrder,
  };
}

function toBindingRecord(record: PrismaBindingRecord): WorkflowBindingRecord {
  return {
    id: record.id,
    isDefault: record.isDefault,
    organizationId: record.organizationId,
    priority: record.priority,
    spaceId: record.spaceId,
    workflowDefinitionId: record.workflowDefinitionId,
    workflowVersionId: record.workflowVersionId,
    workItemType: record.workItemType,
  };
}

async function findVersionById(
  client: Prisma.TransactionClient | PrismaService["client"],
  workflowVersionId: string,
): Promise<WorkflowVersionRecord | undefined> {
  const version = await client.workflowVersion.findFirst({
    include: VERSION_INCLUDE,
    where: {
      deletedAt: null,
      id: workflowVersionId,
    },
  });

  return version ? toVersionRecord(version) : undefined;
}

async function findSourceVersion(
  tx: Prisma.TransactionClient,
  input: CreateDraftWorkflowVersionInput,
  targetSpaceId: string,
) {
  if (input.sourceWorkflowVersionId) {
    return tx.workflowVersion.findFirst({
      include: VERSION_INCLUDE,
      where: {
        deletedAt: null,
        id: input.sourceWorkflowVersionId,
        status: "PUBLISHED",
        workflowDefinition: {
          deletedAt: null,
          spaceId: targetSpaceId,
          status: "ACTIVE",
        },
      },
    });
  }

  return tx.workflowVersion.findFirst({
    include: VERSION_INCLUDE,
    orderBy: {
      version: "desc",
    },
    where: {
      deletedAt: null,
      status: "PUBLISHED",
      workflowDefinitionId: input.workflowId,
    },
  });
}

async function copyVersionContent(
  tx: Prisma.TransactionClient,
  input: {
    actorUserId: string;
    source: PrismaVersionRecord;
    targetWorkflowVersionId: string;
  },
) {
  const stateIdBySourceId = new Map<string, string>();

  for (const state of input.source.states) {
    const newStateId = ulid();

    stateIdBySourceId.set(state.id, newStateId);
    await tx.workflowState.create({
      data: {
        id: newStateId,
        category: state.category,
        code: state.code,
        createdById: input.actorUserId,
        isEnd: state.isEnd,
        isStart: state.isStart,
        name: state.name,
        sortOrder: state.sortOrder,
        updatedById: input.actorUserId,
        workflowVersionId: input.targetWorkflowVersionId,
      },
    });
  }

  for (const action of input.source.actions) {
    const fromStateId = stateIdBySourceId.get(action.fromStateId);
    const toStateId = stateIdBySourceId.get(action.toStateId);

    if (!fromStateId || !toStateId) {
      throw new Error("Cannot copy workflow action with missing state");
    }

    const newActionId = ulid();

    await tx.workflowAction.create({
      data: {
        id: newActionId,
        actorRelations: action.actorRelations,
        allowedSpaceRoles: action.allowedSpaceRoles,
        code: action.code,
        createdById: input.actorUserId,
        fromStateId,
        name: action.name,
        requiresComment: action.requiresComment,
        sortOrder: action.sortOrder,
        toStateId,
        updatedById: input.actorUserId,
        workflowVersionId: input.targetWorkflowVersionId,
      },
    });

    for (const field of action.formFields) {
      await tx.actionFormField.create({
        data: {
          id: ulid(),
          actionId: newActionId,
          createdById: input.actorUserId,
          fieldType: field.fieldType,
          key: field.key,
          label: field.label,
          options: field.options,
          required: field.required,
          sortOrder: field.sortOrder,
          updatedById: input.actorUserId,
        },
      });
    }
  }
}

async function upsertBinding(
  tx: Prisma.TransactionClient,
  input: UpsertWorkflowBindingInput,
): Promise<WorkflowBindingRecord> {
  if (input.isDefault) {
    await tx.workflowBinding.updateMany({
      data: {
        isDefault: false,
        updatedById: input.actorUserId,
      },
      where: {
        deletedAt: null,
        id: input.bindingId
          ? {
              not: input.bindingId,
            }
          : undefined,
        isDefault: true,
        spaceId: input.spaceId,
        targetType: "WORK_ITEM",
        workItemType: input.workItemType,
      },
    });
  }

  const data = {
    isDefault: input.isDefault,
    organizationId: input.organizationId,
    priority: input.priority ?? null,
    spaceId: input.spaceId,
    targetType: "WORK_ITEM" as const,
    workItemType: input.workItemType,
    workflowDefinitionId: input.workflowDefinitionId,
    workflowVersionId: input.workflowVersionId,
  };

  const binding = input.bindingId
    ? await tx.workflowBinding.update({
        data: {
          ...data,
          updatedById: input.actorUserId,
        },
        where: {
          id: input.bindingId,
        },
      })
    : await tx.workflowBinding.create({
        data: {
          ...data,
          id: input.id ?? ulid(),
          createdById: input.actorUserId,
          updatedById: input.actorUserId,
        },
      });

  return toBindingRecord(binding);
}

function workflowDefinitionOrderBy(
  input: WorkflowConfigListInput,
): Prisma.WorkflowDefinitionOrderByWithRelationInput {
  const order = input.sortOrder ?? "asc";

  switch (input.sortBy) {
    case "code":
      return { code: order };
    case "name":
      return { name: order };
    case "status":
      return { status: order };
    case "updatedAt":
      return { updatedAt: order };
    default:
      return { createdAt: order };
  }
}

function workflowBindingOrderBy(
  input: WorkflowConfigListInput,
): Prisma.WorkflowBindingOrderByWithRelationInput {
  const order = input.sortOrder ?? "asc";

  switch (input.sortBy) {
    case "workItemType":
      return { workItemType: order };
    case "priority":
      return { priority: order };
    case "updatedAt":
      return { updatedAt: order };
    default:
      return { createdAt: order };
  }
}

function removeUndefined<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(
    Object.entries(value).filter(([, entryValue]) => entryValue !== undefined),
  ) as T;
}

function toJson(
  value: Record<string, unknown> | undefined,
): Prisma.InputJsonObject | undefined {
  return value && Object.keys(value).length > 0
    ? (value as Prisma.InputJsonObject)
    : undefined;
}
