import { Inject, Injectable } from "@nestjs/common";
import { ulid } from "ulid";

import { Prisma } from "../../generated/prisma/client";
import { PrismaService } from "../../prisma/prisma.service";
import { toWorkItem } from "./workitem.mappers";
import type { WorkItemRepository } from "./workitem.repository";
import type {
  CreateWorkItemInput,
  ParticipantInput,
  UpdateWorkItemInput,
  WorkItemListInput,
} from "./workitem.types";
import { testerVisibleWorkItemWhere } from "./workitem-visibility";

@Injectable()
export class PrismaWorkItemRepository implements WorkItemRepository {
  constructor(
    @Inject(PrismaService)
    private readonly prisma: PrismaService,
  ) {}

  async listBySpaceId(spaceId: string, input: WorkItemListInput) {
    const where = buildListWhere(spaceId, input);
    const countWhere = buildListWhere(spaceId, {
      ...input,
      statusCategory: undefined,
    });

    if (input.visibility === "PARTICIPANT") {
      const visibleIds = await this.listParticipantWorkItemIds(
        spaceId,
        input.actorUserId,
      );

      if (visibleIds.length === 0) {
        return {
          items: [],
          page: input.page,
          pageSize: input.pageSize,
          statusCategoryCounts: [],
          total: 0,
        };
      }

      where.id = {
        in: visibleIds,
      };
      countWhere.id = {
        in: visibleIds,
      };
    }

    if (input.visibility === "TESTER") {
      const visibleIds = await this.listParticipantWorkItemIds(
        spaceId,
        input.actorUserId,
      );
      const visibilityOr: Prisma.WorkItemWhereInput[] = [
        testerVisibleWorkItemWhere(),
      ];

      if (visibleIds.length > 0) {
        visibilityOr.push({
          id: {
            in: visibleIds,
          },
        });
      }

      where.AND = [...toArray(where.AND), { OR: visibilityOr }];
      countWhere.AND = [...toArray(countWhere.AND), { OR: visibilityOr }];
    }

    const [items, total, statusCategoryGroups] =
      await this.prisma.client.$transaction([
        this.prisma.client.workItem.findMany({
          orderBy: buildOrderBy(input),
          skip: (input.page - 1) * input.pageSize,
          take: input.pageSize,
          where,
        }),
        this.prisma.client.workItem.count({
          where,
        }),
        this.prisma.client.workItem.groupBy({
          by: ["statusCategory"],
          _count: {
            _all: true,
          },
          where: countWhere,
        }),
      ]);

    return {
      items: items.map((item) => toWorkItem(item)),
      page: input.page,
      pageSize: input.pageSize,
      statusCategoryCounts: statusCategoryGroups.map((group) => ({
        count: group._count._all,
        statusCategory: group.statusCategory,
      })),
      total,
    };
  }

  async create(input: CreateWorkItemInput) {
    const created = await this.prisma.client.$transaction(async (tx) => {
      const workItem = await tx.workItem.create({
        data: {
          id: input.id,
          assigneeId: input.assigneeId,
          createdById: input.createdById,
          currentStateId: input.currentStateId,
          description: input.description,
          dueDate: input.dueDate,
          intakeItemId: input.intakeItemId,
          lastStatusChangedAt: input.lastStatusChangedAt,
          organizationId: input.organizationId,
          priority: input.priority,
          reporterId: input.reporterId,
          requirementId: input.requirementId,
          spaceId: input.spaceId,
          statusCategory: input.statusCategory,
          title: input.title,
          type: "TASK",
          updatedById: input.createdById,
          versionId: input.versionId,
          workflowVersionId: input.workflowVersionId,
        },
      });

      await ensureParticipant(tx, {
        actorUserId: input.createdById,
        organizationId: input.organizationId,
        relationType: "CREATOR",
        spaceId: input.spaceId,
        targetId: workItem.id,
        userId: input.createdById,
      });
      await ensureParticipant(tx, {
        actorUserId: input.createdById,
        organizationId: input.organizationId,
        relationType: "REPORTER",
        spaceId: input.spaceId,
        targetId: workItem.id,
        userId: input.reporterId,
      });

      if (input.assigneeId) {
        await ensureParticipant(tx, {
          actorUserId: input.createdById,
          organizationId: input.organizationId,
          relationType: "ASSIGNEE",
          spaceId: input.spaceId,
          targetId: workItem.id,
          userId: input.assigneeId,
        });
      }

      for (const userId of unique(input.relatedUserIds)) {
        await ensureParticipant(tx, {
          actorUserId: input.createdById,
          organizationId: input.organizationId,
          relationType: "RELATED",
          spaceId: input.spaceId,
          targetId: workItem.id,
          userId,
        });
      }

      await createTimelineEvent(tx, {
        actorUserId: input.createdById,
        after: {
          assigneeId: input.assigneeId ?? null,
          currentStateId: input.currentStateId,
          dueDate: input.dueDate?.toISOString() ?? null,
          priority: input.priority,
          statusCategory: input.statusCategory,
          title: input.title,
          workflowVersionId: input.workflowVersionId,
        },
        eventType: "CREATED",
        organizationId: input.organizationId,
        spaceId: input.spaceId,
        targetId: workItem.id,
        title: "创建任务",
      });

      return workItem;
    });

    return toWorkItem(created);
  }

  async findTaskById(workItemId: string) {
    const workItem = await this.prisma.client.workItem.findFirst({
      where: {
        deletedAt: null,
        id: workItemId,
        type: "TASK",
      },
    });

    return workItem ? toWorkItem(workItem) : undefined;
  }

  async update(input: UpdateWorkItemInput) {
    const updated = await this.prisma.client.$transaction(async (tx) => {
      const data: Prisma.WorkItemUncheckedUpdateManyInput = {
        updatedById: input.updatedById,
      };

      if (input.versionId !== undefined) {
        data.versionId = input.versionId;
      }
      if (input.requirementId !== undefined) {
        data.requirementId = input.requirementId;
      }
      if (input.title !== undefined) {
        data.title = input.title;
      }
      if (input.description !== undefined) {
        data.description = input.description;
      }
      if (input.priority !== undefined) {
        data.priority = input.priority;
      }
      if (input.assigneeId !== undefined) {
        data.assigneeId = input.assigneeId;
      }
      if (input.dueDate !== undefined) {
        data.dueDate = input.dueDate;
      }

      const result = await tx.workItem.updateMany({
        data,
        where: {
          deletedAt: null,
          id: input.workItemId,
          type: "TASK",
        },
      });

      if (result.count === 0) {
        return undefined;
      }

      const workItem = await tx.workItem.findFirst({
        where: {
          deletedAt: null,
          id: input.workItemId,
          type: "TASK",
        },
      });

      if (!workItem) {
        return undefined;
      }

      if (input.shouldReplaceAssigneeParticipants) {
        await replaceParticipants(tx, {
          actorUserId: input.updatedById,
          organizationId: workItem.organizationId,
          relationType: "ASSIGNEE",
          spaceId: workItem.spaceId,
          targetId: workItem.id,
          userIds: workItem.assigneeId ? [workItem.assigneeId] : [],
        });
      }

      if (input.shouldReplaceRelatedParticipants) {
        await replaceParticipants(tx, {
          actorUserId: input.updatedById,
          organizationId: workItem.organizationId,
          relationType: "RELATED",
          spaceId: workItem.spaceId,
          targetId: workItem.id,
          userIds: input.relatedUserIds,
        });
      }

      if (Object.keys(input.timelineAfter).length > 0) {
        await createTimelineEvent(tx, {
          actorUserId: input.updatedById,
          after: input.timelineAfter,
          before: input.timelineBefore,
          eventType: "UPDATED",
          organizationId: workItem.organizationId,
          spaceId: workItem.spaceId,
          targetId: workItem.id,
          title: "更新任务",
        });
      }

      if (hasOwn(input.timelineAfter, "assigneeId")) {
        await createTimelineEvent(tx, {
          actorUserId: input.updatedById,
          after: {
            assigneeId: workItem.assigneeId ?? null,
          },
          before: {
            assigneeId: input.timelineBefore.assigneeId ?? null,
          },
          eventType: "ASSIGNEE_CHANGED",
          organizationId: workItem.organizationId,
          spaceId: workItem.spaceId,
          targetId: workItem.id,
          title: "负责人变更",
        });
      }

      return workItem;
    });

    return updated ? toWorkItem(updated) : undefined;
  }

  async isParticipant(spaceId: string, workItemId: string, userId: string) {
    const participant = await this.prisma.client.objectParticipant.findFirst({
      select: {
        id: true,
      },
      where: {
        deletedAt: null,
        spaceId,
        targetId: workItemId,
        targetType: "WORK_ITEM",
        userId,
      },
    });

    return Boolean(participant);
  }

  async isTesterVisible(spaceId: string, workItemId: string) {
    const workItem = await this.prisma.client.workItem.findFirst({
      select: {
        id: true,
      },
      where: {
        deletedAt: null,
        id: workItemId,
        spaceId,
        ...testerVisibleWorkItemWhere(),
      },
    });

    return Boolean(workItem);
  }

  async findVersionInSpace(spaceId: string, versionId: string) {
    const version = await this.prisma.client.version.findFirst({
      select: {
        ownerId: true,
      },
      where: {
        deletedAt: null,
        id: versionId,
        spaceId,
      },
    });

    return version
      ? {
          versionOwnerId: version.ownerId ?? undefined,
        }
      : undefined;
  }

  async findRequirementInSpace(spaceId: string, requirementId: string) {
    const requirement = await this.prisma.client.requirement.findFirst({
      select: {
        ownerId: true,
      },
      where: {
        deletedAt: null,
        id: requirementId,
        spaceId,
      },
    });

    return requirement
      ? {
          requirementOwnerId: requirement.ownerId ?? undefined,
        }
      : undefined;
  }

  async findIntakeItemInSpace(spaceId: string, intakeItemId: string) {
    const intakeItem = await this.prisma.client.intakeItem.findFirst({
      select: {
        assigneeId: true,
        reporterId: true,
      },
      where: {
        deletedAt: null,
        id: intakeItemId,
        spaceId,
      },
    });

    return intakeItem
      ? {
          intakeAssigneeId: intakeItem.assigneeId ?? undefined,
          intakeReporterId: intakeItem.reporterId,
        }
      : undefined;
  }

  async resolveTaskWorkflow(spaceId: string, workflowVersionId?: string) {
    const binding = await this.prisma.client.workflowBinding.findFirst({
      include: {
        workflowVersion: {
          include: {
            states: {
              orderBy: {
                sortOrder: "asc",
              },
              take: 1,
              where: {
                deletedAt: null,
                isStart: true,
              },
            },
          },
        },
      },
      orderBy: {
        createdAt: "asc",
      },
      where: {
        deletedAt: null,
        isDefault: workflowVersionId ? undefined : true,
        spaceId,
        targetType: "WORK_ITEM",
        workItemType: "TASK",
        workflowDefinition: {
          deletedAt: null,
          status: "ACTIVE",
        },
        workflowVersion: {
          deletedAt: null,
          status: "PUBLISHED",
        },
        workflowVersionId,
      },
    });
    const startState = binding?.workflowVersion.states[0];

    return binding && startState
      ? {
          currentStateId: startState.id,
          statusCategory: startState.category,
          workflowVersionId: binding.workflowVersionId,
        }
      : undefined;
  }

  private async listParticipantWorkItemIds(spaceId: string, userId: string) {
    const participants = await this.prisma.client.objectParticipant.findMany({
      select: {
        targetId: true,
      },
      where: {
        deletedAt: null,
        spaceId,
        targetType: "WORK_ITEM",
        userId,
      },
    });

    return unique(participants.map((participant) => participant.targetId));
  }
}

function buildListWhere(
  spaceId: string,
  input: WorkItemListInput,
): Prisma.WorkItemWhereInput {
  return {
    assigneeId: input.assigneeId,
    deletedAt: null,
    intakeItemId: input.intakeItemId,
    priority: input.priority,
    reporterId: input.reporterId,
    requirementId: input.requirementId,
    spaceId,
    statusCategory: input.statusCategory,
    type: "TASK",
    versionId: input.versionId,
  };
}

function buildOrderBy(
  input: WorkItemListInput,
): Prisma.WorkItemOrderByWithRelationInput[] {
  const sortOrder = input.sortOrder ?? "asc";

  switch (input.sortBy) {
    case "dueDate":
      return [{ dueDate: sortOrder }, { createdAt: "asc" }];
    case "lastStatusChangedAt":
      return [{ lastStatusChangedAt: sortOrder }, { createdAt: "asc" }];
    case "priority":
      return [{ priority: sortOrder }, { createdAt: "asc" }];
    case "title":
      return [{ title: sortOrder }, { createdAt: "asc" }];
    case "createdAt":
    default:
      return [{ createdAt: sortOrder }];
  }
}

async function ensureParticipant(
  tx: Prisma.TransactionClient,
  input: ParticipantInput,
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

async function replaceParticipants(
  tx: Prisma.TransactionClient,
  input: {
    actorUserId: string;
    organizationId: string;
    relationType: "ASSIGNEE" | "RELATED";
    spaceId: string;
    targetId: string;
    userIds: string[];
  },
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

async function createTimelineEvent(
  tx: Prisma.TransactionClient,
  input: {
    actorUserId: string;
    after?: Record<string, unknown>;
    before?: Record<string, unknown>;
    eventType: "ASSIGNEE_CHANGED" | "CREATED" | "UPDATED";
    organizationId: string;
    spaceId: string;
    targetId: string;
    title: string;
  },
) {
  await tx.timelineEvent.create({
    data: {
      id: ulid(),
      actorId: input.actorUserId,
      after: toJson(input.after),
      before: toJson(input.before),
      createdById: input.actorUserId,
      eventType: input.eventType,
      organizationId: input.organizationId,
      spaceId: input.spaceId,
      targetId: input.targetId,
      targetType: "WORK_ITEM",
      title: input.title,
      updatedById: input.actorUserId,
    },
  });
}

function toJson(value: Record<string, unknown> | undefined) {
  return value && Object.keys(value).length > 0
    ? (value as Prisma.InputJsonObject)
    : undefined;
}

function hasOwn(target: Record<string, unknown>, key: string) {
  return Object.prototype.hasOwnProperty.call(target, key);
}

function unique(values: readonly string[]) {
  return Array.from(new Set(values.filter(Boolean)));
}

function toArray<T>(value: T | T[] | undefined): T[] {
  if (!value) {
    return [];
  }

  return Array.isArray(value) ? value : [value];
}
