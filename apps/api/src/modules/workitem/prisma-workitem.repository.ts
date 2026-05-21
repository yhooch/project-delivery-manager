import { Inject, Injectable } from "@nestjs/common";
import { ulid } from "ulid";

import { Prisma } from "../../generated/prisma/client";
import { PrismaService } from "../../prisma/prisma.service";
import { ObjectCodeAllocator } from "../object-code/object-code.allocator";
import { parseObjectCode } from "../object-code/object-code.types";
import {
  findTaggedTargetIds,
  listTagsByTargets,
  replaceTagAssignmentsInTransaction,
} from "../tag/tag-assignment.helpers";
import { createTimelineEventRecord } from "../timeline/timeline-event-writer";
import { assertTraceRefsMatchVersion } from "../trace/trace-version-policy";
import { toWorkItem } from "./workitem.mappers";
import { syncWorkItemRelatedParticipants } from "./workitem-participants";
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
    @Inject(ObjectCodeAllocator)
    private readonly objectCodeAllocator: ObjectCodeAllocator,
  ) {}

  async listBySpaceId(spaceId: string, input: WorkItemListInput) {
    const where = buildListWhere(spaceId, input);
    const countWhere = buildListWhere(spaceId, {
      ...input,
      statusCategory: undefined,
    });
    const taggedTargetIds = await findTaggedTargetIds(this.prisma.client, {
      spaceId,
      tagIds: input.tagIds,
      tagMatch: input.tagMatch,
      targetType: "WORK_ITEM",
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

    applyTaggedTargetIds(where, taggedTargetIds);
    applyTaggedTargetIds(countWhere, taggedTargetIds);

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
    const tagsByWorkItemId = await listTagsByTargets(this.prisma.client, {
      organizationId: items[0]?.organizationId ?? "",
      spaceId,
      targetIds: items.map((item) => item.id),
      targetType: "WORK_ITEM",
    });

    return {
      items: items.map((item) =>
        toWorkItem(item, undefined, tagsByWorkItemId.get(item.id) ?? []),
      ),
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
      const sequence = await this.objectCodeAllocator.allocateOne(tx, {
        actorUserId: input.createdById,
        objectType: "TASK",
        organizationId: input.organizationId,
        spaceId: input.spaceId,
      });
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
          sequence,
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
        targetWorkItemType: "TASK",
        title: "创建任务",
      });

      await replaceTagAssignmentsInTransaction(tx, {
        assignedById: input.createdById,
        organizationId: input.organizationId,
        spaceId: input.spaceId,
        tagIds: input.tagIds,
        targetId: workItem.id,
        targetType: "WORK_ITEM",
      });

      return workItem;
    });

    const tagsByWorkItemId = await listTagsByTargets(this.prisma.client, {
      organizationId: created.organizationId,
      spaceId: created.spaceId,
      targetIds: [created.id],
      targetType: "WORK_ITEM",
    });

    return toWorkItem(created, undefined, tagsByWorkItemId.get(created.id) ?? []);
  }

  async findTaskById(workItemId: string) {
    const workItem = await this.prisma.client.workItem.findFirst({
      where: {
        deletedAt: null,
        id: workItemId,
        type: "TASK",
      },
    });

    if (!workItem) {
      return undefined;
    }

    const tagsByWorkItemId = await listTagsByTargets(this.prisma.client, {
      organizationId: workItem.organizationId,
      spaceId: workItem.spaceId,
      targetIds: [workItem.id],
      targetType: "WORK_ITEM",
    });

    return toWorkItem(
      workItem,
      undefined,
      tagsByWorkItemId.get(workItem.id) ?? [],
    );
  }

  async countVersionCascadeImpact(input: {
    workItemId: string;
    nextVersionId: string | null;
  }) {
    const relatedBugs = await this.prisma.client.workItem.findMany({
      select: {
        id: true,
        versionId: true,
      },
      where: {
        bugDetail: {
          is: {
            deletedAt: null,
            relatedTaskId: input.workItemId,
          },
        },
        deletedAt: null,
        type: "BUG",
      },
    });
    const relatedBugIds = relatedBugs
      .filter((bug) => bug.versionId !== input.nextVersionId)
      .map((bug) => bug.id);

    return {
      bugCount: 0,
      bugIds: [],
      relatedBugCount: relatedBugIds.length,
      relatedBugIds,
      workItemCount: relatedBugIds.length,
      workItemIds: relatedBugIds,
    };
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
      if (input.intakeItemId !== undefined) {
        data.intakeItemId = input.intakeItemId;
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

      if (
        input.cascadeVersionChange === true &&
        input.versionId !== undefined &&
        hasOwn(input.timelineAfter, "versionId")
      ) {
        await cascadeTaskTraceVersion(tx, {
          actorUserId: input.updatedById,
          nextVersionId: input.versionId,
          workItemId: input.workItemId,
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
          targetWorkItemType: "TASK",
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
          targetWorkItemType: "TASK",
          title: "负责人变更",
        });
      }

      return workItem;
    });

    if (!updated) {
      return undefined;
    }

    const tagsByWorkItemId = await listTagsByTargets(this.prisma.client, {
      organizationId: updated.organizationId,
      spaceId: updated.spaceId,
      targetIds: [updated.id],
      targetType: "WORK_ITEM",
    });

    return toWorkItem(
      updated,
      undefined,
      tagsByWorkItemId.get(updated.id) ?? [],
    );
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
        versionId: true,
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
          requirementVersionId: requirement.versionId ?? undefined,
        }
      : undefined;
  }

  async findIntakeItemInSpace(spaceId: string, intakeItemId: string) {
    const intakeItem = await this.prisma.client.intakeItem.findFirst({
      select: {
        assigneeId: true,
        reporterId: true,
        versionId: true,
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
          intakeVersionId: intakeItem.versionId ?? undefined,
        }
      : undefined;
  }

  async resolveTaskWorkflow(spaceId: string, workflowVersionId?: string) {
    if (workflowVersionId) {
      const version = await this.prisma.client.workflowVersion.findFirst({
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
        where: {
          deletedAt: null,
          id: workflowVersionId,
          status: "PUBLISHED",
          workflowDefinition: {
            bindings: {
              some: {
                deletedAt: null,
                spaceId,
                targetType: "WORK_ITEM",
                workItemType: "TASK",
              },
            },
            deletedAt: null,
            spaceId,
            status: "ACTIVE",
          },
        },
      });
      const startState = version?.states[0];

      return version && startState
        ? {
            currentStateId: startState.id,
            statusCategory: startState.category,
            workflowVersionId: version.id,
          }
        : undefined;
    }

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
  const where: Prisma.WorkItemWhereInput = {
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

  applyListQuery(where, input.query);

  return where;
}

function applyListQuery(
  where: Prisma.WorkItemWhereInput,
  query: string | undefined,
) {
  const trimmed = query?.trim();

  if (!trimmed) {
    return;
  }

  const parsed = parseObjectCode(trimmed);

  if (parsed) {
    where.AND = [
      ...toArray(where.AND),
      parsed.objectType === "TASK"
        ? { sequence: parsed.sequence }
        : { id: { in: [] } },
    ];
    return;
  }

  where.AND = [
    ...toArray(where.AND),
    {
      OR: [
        { title: { contains: trimmed, mode: "insensitive" } },
        { description: { contains: trimmed, mode: "insensitive" } },
      ],
    },
  ];
}

function applyTaggedTargetIds(
  where: Prisma.WorkItemWhereInput,
  targetIds: string[] | undefined,
) {
  if (!targetIds) {
    return;
  }

  where.AND = [
    ...toArray(where.AND),
    {
      id: {
        in: targetIds,
      },
    },
  ];
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

async function cascadeTaskTraceVersion(
  tx: Prisma.TransactionClient,
  input: {
    actorUserId: string;
    nextVersionId: string | null;
    workItemId: string;
  },
) {
  const relatedBugs = await tx.workItem.findMany({
    select: {
      id: true,
      organizationId: true,
      spaceId: true,
      versionId: true,
    },
    where: {
      bugDetail: {
        is: {
          deletedAt: null,
          relatedTaskId: input.workItemId,
        },
      },
      deletedAt: null,
      type: "BUG",
    },
  });

  if (relatedBugs.length === 0) {
    return;
  }

  const relatedBugIds = relatedBugs.map((bug) => bug.id);

  await assertNoTaskCascadeConflicts(tx, {
    nextVersionId: input.nextVersionId,
    relatedBugIds,
    workItemId: input.workItemId,
  });

  const affectedRelatedBugs = relatedBugs.filter(
    (bug) => bug.versionId !== input.nextVersionId,
  );

  if (affectedRelatedBugs.length > 0) {
    await tx.workItem.updateMany({
      data: {
        updatedById: input.actorUserId,
        versionId: input.nextVersionId,
      },
      where: {
        deletedAt: null,
        id: {
          in: affectedRelatedBugs.map((bug) => bug.id),
        },
      },
    });

    for (const bug of affectedRelatedBugs) {
      await createTraceVersionCascadeTimelineEvent(tx, {
        actorUserId: input.actorUserId,
        beforeVersionId: bug.versionId,
        nextVersionId: input.nextVersionId,
        organizationId: bug.organizationId,
        sourceTargetId: input.workItemId,
        spaceId: bug.spaceId,
        targetId: bug.id,
        targetWorkItemType: "BUG",
      });
    }
  }

  await syncWorkItemRelatedParticipants(tx, {
    actorUserId: input.actorUserId,
    workItemIds: relatedBugIds,
  });
}

async function assertNoTaskCascadeConflicts(
  tx: Prisma.TransactionClient,
  input: {
    nextVersionId: string | null;
    relatedBugIds: string[];
    workItemId: string;
  },
) {
  const affectedBugs = await tx.workItem.findMany({
    select: {
      bugDetail: {
        select: {
          relatedTask: {
            select: { versionId: true },
          },
          relatedTaskId: true,
        },
      },
      id: true,
      intakeItem: {
        select: { versionId: true },
      },
      requirement: {
        select: { versionId: true },
      },
    },
    where: {
      deletedAt: null,
      id: {
        in: input.relatedBugIds,
      },
    },
  });

  for (const bug of affectedBugs) {
    assertTraceRefsMatchVersion({
      details: {
        workItemId: bug.id,
      },
      refs: [
        { label: "requirement", versionId: bug.requirement?.versionId },
        { label: "intakeItem", versionId: bug.intakeItem?.versionId },
        {
          label: "relatedTask",
          versionId:
            bug.bugDetail?.relatedTaskId === input.workItemId
              ? input.nextVersionId
              : bug.bugDetail?.relatedTask?.versionId,
        },
      ],
      versionId: input.nextVersionId,
    });
  }
}

async function createTraceVersionCascadeTimelineEvent(
  tx: Prisma.TransactionClient,
  input: {
    actorUserId: string;
    beforeVersionId: string | null;
    nextVersionId: string | null;
    organizationId: string;
    sourceTargetId: string;
    spaceId: string;
    targetId: string;
    targetWorkItemType: "BUG";
  },
) {
  await createTimelineEventRecord(tx, {
    actorUserId: input.actorUserId,
    after: { versionId: input.nextVersionId },
    before: { versionId: input.beforeVersionId },
    eventType: "UPDATED",
    metadata: {
      operation: "TRACE_VERSION_CASCADE",
      sourceTargetId: input.sourceTargetId,
      sourceTargetType: "TASK",
    },
    organizationId: input.organizationId,
    spaceId: input.spaceId,
    targetId: input.targetId,
    targetType: "WORK_ITEM",
    targetWorkItemType: input.targetWorkItemType,
    title: "级联更新版本",
  });
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
    targetWorkItemType: "TASK";
    title: string;
  },
) {
  await createTimelineEventRecord(tx, {
    ...input,
    targetType: "WORK_ITEM",
  });
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
