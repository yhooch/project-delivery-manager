import { Inject, Injectable } from "@nestjs/common";
import { ulid } from "ulid";

import { Prisma } from "../../generated/prisma/client";
import { PrismaService } from "../../prisma/prisma.service";
import { listTagsByTargets } from "../tag/tag-assignment.helpers";
import { toWorkItem } from "../workitem/workitem.mappers";
import type {
  CreateWorkflowActionAuditLogInput,
  CreateWorkflowActionTimelineInput,
  ExecutableBugDetail,
  ExecutableWorkflowAction,
  ExecutableWorkflowActionFormField,
  ExecutableWorkflowState,
  ExecutableWorkItem,
  ReplaceWorkflowActionParticipantsInput,
  UpdateWorkflowActionStateInput,
  WorkflowActionExecutionRepository,
  WorkflowActionExecutionTransaction,
} from "./workflow-action-execution.repository";

@Injectable()
export class PrismaWorkflowActionExecutionRepository
  implements WorkflowActionExecutionRepository
{
  constructor(
    @Inject(PrismaService)
    private readonly prisma: PrismaService,
  ) {}

  async transaction<T>(
    handler: (tx: WorkflowActionExecutionTransaction) => Promise<T>,
  ): Promise<T> {
    return this.prisma.client.$transaction((tx) =>
      handler(new PrismaWorkflowActionExecutionTransaction(tx)),
    );
  }

  async createAuditLog(input: CreateWorkflowActionAuditLogInput) {
    await this.prisma.client.auditLog.create({
      data: {
        id: ulid(),
        actionType: input.actionType,
        actorId: input.actorUserId,
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

class PrismaWorkflowActionExecutionTransaction
  implements WorkflowActionExecutionTransaction
{
  constructor(private readonly tx: Prisma.TransactionClient) {}

  async findWorkItemById(workItemId: string) {
    const workItem = await this.tx.workItem.findFirst({
      include: {
        bugDetail: true,
        currentState: {
          select: {
            code: true,
            name: true,
          },
        },
      },
      where: {
        deletedAt: null,
        id: workItemId,
        type: {
          in: ["TASK", "BUG"],
        },
      },
    });

    return workItem ? toExecutableWorkItem(workItem) : undefined;
  }

  async findActionById(actionId: string) {
    const action = await this.tx.workflowAction.findFirst({
      include: {
        formFields: {
          orderBy: {
            sortOrder: "asc",
          },
          where: {
            deletedAt: null,
          },
        },
        fromState: true,
        toState: true,
      },
      where: {
        deletedAt: null,
        fromState: {
          deletedAt: null,
        },
        id: actionId,
        toState: {
          deletedAt: null,
        },
      },
    });

    return action ? toExecutableAction(action) : undefined;
  }

  async findActiveSpaceAccess(input: {
    actorUserId: string;
    organizationId: string;
    spaceId: string;
  }) {
    const member = await this.tx.spaceMember.findFirst({
      include: {
        space: {
          select: {
            ownerId: true,
          },
        },
      },
      where: {
        deletedAt: null,
        organizationId: input.organizationId,
        organization: {
          deletedAt: null,
          members: {
            some: {
              deletedAt: null,
              status: "ACTIVE",
              userId: input.actorUserId,
            },
          },
          status: "ACTIVE",
        },
        space: {
          deletedAt: null,
          status: "ACTIVE",
        },
        spaceId: input.spaceId,
        status: "ACTIVE",
        user: {
          deletedAt: null,
          status: "ACTIVE",
        },
        userId: input.actorUserId,
      },
    });

    return member
      ? {
          role: member.role,
          spaceOwnerId: member.space.ownerId ?? undefined,
        }
      : undefined;
  }

  async isActiveSpaceMember(input: {
    organizationId: string;
    spaceId: string;
    userId: string;
  }) {
    const member = await this.tx.spaceMember.findFirst({
      select: {
        id: true,
      },
      where: {
        deletedAt: null,
        organizationId: input.organizationId,
        organization: {
          deletedAt: null,
          members: {
            some: {
              deletedAt: null,
              status: "ACTIVE",
              userId: input.userId,
            },
          },
          status: "ACTIVE",
        },
        space: {
          deletedAt: null,
          status: "ACTIVE",
        },
        spaceId: input.spaceId,
        status: "ACTIVE",
        user: {
          deletedAt: null,
          status: "ACTIVE",
        },
        userId: input.userId,
      },
    });

    return Boolean(member);
  }

  async isWorkItemParticipant(input: {
    spaceId: string;
    userId: string;
    workItemId: string;
  }) {
    const participant = await this.tx.objectParticipant.findFirst({
      select: {
        id: true,
      },
      where: {
        deletedAt: null,
        spaceId: input.spaceId,
        targetId: input.workItemId,
        targetType: "WORK_ITEM",
        userId: input.userId,
      },
    });

    return Boolean(participant);
  }

  async updateWorkItemState(input: UpdateWorkflowActionStateInput) {
    const data: Prisma.WorkItemUncheckedUpdateManyInput = {
      currentStateId: input.currentStateId,
      lastActionAt: input.lastActionAt,
      lastStatusChangedAt: input.lastStatusChangedAt,
      statusCategory: input.statusCategory,
      updatedById: input.actorUserId,
    };

    if (hasOwn(input, "assigneeId")) {
      data.assigneeId = input.assigneeId;
    }
    if (hasOwn(input, "blockedAt")) {
      data.blockedAt = input.blockedAt;
    }
    if (hasOwn(input, "blockedReason")) {
      data.blockedReason = input.blockedReason;
    }
    if (hasOwn(input, "closedAt")) {
      data.closedAt = input.closedAt;
    }

    const result = await this.tx.workItem.updateMany({
      data,
      where: {
        currentStateId: input.expectedCurrentStateId,
        deletedAt: null,
        id: input.workItemId,
        type: {
          in: ["TASK", "BUG"],
        },
      },
    });

    if (result.count === 0) {
      return undefined;
    }

    if (input.bugDetailPatch) {
      const bugDetailResult = await this.tx.bugDetail.updateMany({
        data: {
          ...input.bugDetailPatch,
          updatedById: input.actorUserId,
        },
        where: {
          deletedAt: null,
          workItemId: input.workItemId,
        },
      });

      if (bugDetailResult.count === 0) {
        return undefined;
      }
    }

    const updated = await this.tx.workItem.findFirst({
      include: {
        bugDetail: true,
      },
      where: {
        deletedAt: null,
        id: input.workItemId,
        type: {
          in: ["TASK", "BUG"],
        },
      },
    });

    if (!updated) {
      return undefined;
    }

    const tagsByWorkItemId = await listTagsByTargets(this.tx, {
      organizationId: updated.organizationId,
      spaceId: updated.spaceId,
      targetIds: [updated.id],
      targetType: "WORK_ITEM",
    });

    return toExecutableWorkItem(
      updated,
      tagsByWorkItemId.get(updated.id) ?? [],
    );
  }

  async replaceAssigneeParticipants(
    input: ReplaceWorkflowActionParticipantsInput,
  ) {
    await replaceParticipants(this.tx, input);
  }

  async createTimelineEvent(input: CreateWorkflowActionTimelineInput) {
    await this.tx.timelineEvent.create({
      data: {
        id: ulid(),
        actorId: input.actorUserId,
        after: toJson(input.after),
        before: toJson(input.before),
        createdById: input.actorUserId,
        detail: input.detail,
        eventType: input.eventType,
        metadata: toJson(input.metadata),
        organizationId: input.organizationId,
        spaceId: input.spaceId,
        targetId: input.targetId,
        targetType: "WORK_ITEM",
        title: input.title,
        updatedById: input.actorUserId,
      },
    });
  }

  async listActionsForState(input: {
    fromStateId: string;
    workflowVersionId: string;
  }) {
    const actions = await this.tx.workflowAction.findMany({
      include: {
        formFields: {
          orderBy: {
            sortOrder: "asc",
          },
          where: {
            deletedAt: null,
          },
        },
        fromState: true,
        toState: true,
      },
      orderBy: {
        sortOrder: "asc",
      },
      where: {
        deletedAt: null,
        fromState: {
          deletedAt: null,
        },
        fromStateId: input.fromStateId,
        toState: {
          deletedAt: null,
        },
        workflowVersionId: input.workflowVersionId,
      },
    });

    return actions.map((action) => toExecutableAction(action));
  }
}

type PrismaWorkItemRecord = Parameters<typeof toWorkItem>[0] & {
  bugDetail?: PrismaBugDetailRecord | null;
  closedAt: Date | null;
  createdById: string | null;
  currentState?: {
    code: string;
    name: string;
  } | null;
};

type PrismaBugDetailRecord = {
  workItemId: string;
  severity: ExecutableBugDetail["severity"];
  stepsToReproduce: string | null;
  expectedResult: string | null;
  actualResult: string | null;
  fixNote: string | null;
  regressionResult: string | null;
  regressionById: string | null;
  regressionAt: Date | null;
  relatedTaskId: string | null;
};

type PrismaWorkflowStateRecord = {
  id: string;
  code: string;
  category: ExecutableWorkflowState["category"];
  isEnd: boolean;
};

type PrismaWorkflowActionRecord = {
  id: string;
  code: string;
  name: string;
  workflowVersionId: string;
  fromStateId: string;
  toStateId: string;
  fromState: PrismaWorkflowStateRecord;
  toState: PrismaWorkflowStateRecord;
  allowedSpaceRoles: ExecutableWorkflowAction["allowedSpaceRoles"];
  actorRelations: ExecutableWorkflowAction["actorRelations"];
  requiresComment: boolean;
  formFields: PrismaActionFormFieldRecord[];
  sortOrder: number;
};

type PrismaActionFormFieldRecord = {
  id: string;
  key: string;
  label: string;
  fieldType: ExecutableWorkflowActionFormField["fieldType"];
  required: boolean;
  options: string[];
  sortOrder: number;
};

function toExecutableWorkItem(
  record: PrismaWorkItemRecord,
  tags: Parameters<typeof toWorkItem>[2] = [],
): ExecutableWorkItem {
  return {
    ...toWorkItem(record, undefined, tags),
    bugDetail: record.bugDetail
      ? toExecutableBugDetail(record.bugDetail)
      : undefined,
    closedAt: record.closedAt?.toISOString(),
    createdById: record.createdById ?? undefined,
    currentState: record.currentState ?? undefined,
  };
}

function toExecutableBugDetail(
  record: PrismaBugDetailRecord,
): ExecutableBugDetail {
  return {
    actualResult: record.actualResult ?? undefined,
    expectedResult: record.expectedResult ?? undefined,
    fixNote: record.fixNote ?? undefined,
    regressionAt: record.regressionAt?.toISOString(),
    regressionById: record.regressionById ?? undefined,
    regressionResult: record.regressionResult ?? undefined,
    relatedTaskId: record.relatedTaskId ?? undefined,
    severity: record.severity,
    stepsToReproduce: record.stepsToReproduce ?? undefined,
    workItemId: record.workItemId,
  };
}

function toExecutableAction(
  record: PrismaWorkflowActionRecord,
): ExecutableWorkflowAction {
  return {
    actorRelations: record.actorRelations,
    allowedSpaceRoles: record.allowedSpaceRoles,
    code: record.code,
    formFields: record.formFields.map(toExecutableFormField),
    fromState: toExecutableState(record.fromState),
    fromStateId: record.fromStateId,
    id: record.id,
    name: record.name,
    order: record.sortOrder,
    requiresComment: record.requiresComment,
    toState: toExecutableState(record.toState),
    toStateId: record.toStateId,
    workflowVersionId: record.workflowVersionId,
  };
}

function toExecutableState(
  record: PrismaWorkflowStateRecord,
): ExecutableWorkflowState {
  return {
    category: record.category,
    code: record.code,
    id: record.id,
    isEnd: record.isEnd,
  };
}

function toExecutableFormField(
  record: PrismaActionFormFieldRecord,
): ExecutableWorkflowActionFormField {
  return {
    fieldType: record.fieldType,
    id: record.id,
    key: record.key,
    label: record.label,
    options: record.options,
    order: record.sortOrder,
    required: record.required,
  };
}

function toJson(
  value: Record<string, unknown> | undefined,
): Prisma.InputJsonObject | undefined {
  return value && Object.keys(value).length > 0
    ? (value as Prisma.InputJsonObject)
    : undefined;
}

async function replaceParticipants(
  tx: Prisma.TransactionClient,
  input: ReplaceWorkflowActionParticipantsInput,
) {
  const userIds = unique(input.userIds);
  const where: Prisma.ObjectParticipantWhereInput = {
    deletedAt: null,
    relationType: input.relationType,
    spaceId: input.spaceId,
    targetId: input.targetId,
    targetType: "WORK_ITEM",
  };

  if (userIds.length > 0) {
    where.userId = {
      notIn: userIds,
    };
  }

  await tx.objectParticipant.updateMany({
    data: {
      deletedAt: new Date(),
      updatedById: input.actorUserId,
    },
    where,
  });

  for (const userId of userIds) {
    await ensureParticipant(tx, {
      actorUserId: input.actorUserId,
      organizationId: input.organizationId,
      relationType: input.relationType,
      spaceId: input.spaceId,
      targetId: input.targetId,
      userId,
    });
  }
}

async function ensureParticipant(
  tx: Prisma.TransactionClient,
  input: {
    actorUserId: string;
    organizationId: string;
    relationType: "ASSIGNEE";
    spaceId: string;
    targetId: string;
    userId: string;
  },
) {
  const existing = await tx.objectParticipant.findFirst({
    select: {
      id: true,
    },
    where: {
      deletedAt: null,
      relationType: input.relationType,
      spaceId: input.spaceId,
      targetId: input.targetId,
      targetType: "WORK_ITEM",
      userId: input.userId,
    },
  });

  if (existing) {
    return;
  }

  await tx.objectParticipant.create({
    data: {
      id: ulid(),
      createdById: input.actorUserId,
      organizationId: input.organizationId,
      relationType: input.relationType,
      spaceId: input.spaceId,
      targetId: input.targetId,
      targetType: "WORK_ITEM",
      updatedById: input.actorUserId,
      userId: input.userId,
    },
  });
}

function unique<T>(values: T[]) {
  return Array.from(new Set(values));
}

function hasOwn<TObject extends object, TKey extends PropertyKey>(
  object: TObject,
  key: TKey,
): object is TObject & Record<TKey, unknown> {
  return Object.prototype.hasOwnProperty.call(object, key);
}
