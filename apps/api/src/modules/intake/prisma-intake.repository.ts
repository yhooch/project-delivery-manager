import { Inject, Injectable } from "@nestjs/common";
import { ulid } from "ulid";

import { Prisma } from "../../generated/prisma/client";
import { PrismaService } from "../../prisma/prisma.service";
import { assertTraceRefsMatchVersion } from "../trace/trace-version-policy";
import { toWorkItem } from "../workitem/workitem.mappers";
import { toIntakeItem } from "./intake.mappers";
import type { IntakeRepository } from "./intake.repository";
import type {
  ConvertIntakeItemToWorkItemsInput,
  CreateIntakeItemInput,
  IntakeItemListInput,
  UpdateIntakeItemInput,
  UpdateIntakeItemStatusInput,
} from "./intake.types";

@Injectable()
export class PrismaIntakeRepository implements IntakeRepository {
  constructor(
    @Inject(PrismaService)
    private readonly prisma: PrismaService,
  ) {}

  async convertToWorkItems(input: ConvertIntakeItemToWorkItemsInput) {
    const converted = await this.prisma.client.$transaction(async (tx) => {
      const before = await tx.intakeItem.findFirst({
        where: {
          deletedAt: null,
          id: input.intakeItemId,
        },
      });

      if (!before || before.status !== "ACCEPTED") {
        return undefined;
      }

      const now = new Date();
      const statusUpdate = await tx.intakeItem.updateMany({
        data: {
          convertedAt: now,
          status: "CONVERTED",
          updatedById: input.actorUserId,
        },
        where: {
          deletedAt: null,
          id: before.id,
          status: "ACCEPTED",
        },
      });

      if (statusUpdate.count === 0) {
        return undefined;
      }

      const workItems = [];

      for (const task of input.tasks) {
        const workItem = await tx.workItem.create({
          data: {
            id: task.id,
            assigneeId: task.assigneeId,
            createdById: input.actorUserId,
            currentStateId: task.currentStateId,
            description: task.description,
            dueDate: task.dueDate,
            intakeItemId: before.id,
            lastStatusChangedAt: now,
            organizationId: before.organizationId,
            priority: task.priority,
            reporterId: task.reporterId,
            requirementId: task.requirementId,
            spaceId: before.spaceId,
            statusCategory: task.statusCategory,
            title: task.title,
            type: "TASK",
            updatedById: input.actorUserId,
            versionId: task.versionId,
            workflowVersionId: task.workflowVersionId,
          },
        });

        await ensureParticipant(tx, {
          actorUserId: input.actorUserId,
          organizationId: before.organizationId,
          relationType: "CREATOR",
          spaceId: before.spaceId,
          targetId: workItem.id,
          targetType: "WORK_ITEM",
          userId: input.actorUserId,
        });
        await ensureParticipant(tx, {
          actorUserId: input.actorUserId,
          organizationId: before.organizationId,
          relationType: "REPORTER",
          spaceId: before.spaceId,
          targetId: workItem.id,
          targetType: "WORK_ITEM",
          userId: task.reporterId,
        });

        if (task.assigneeId) {
          await ensureParticipant(tx, {
            actorUserId: input.actorUserId,
            organizationId: before.organizationId,
            relationType: "ASSIGNEE",
            spaceId: before.spaceId,
            targetId: workItem.id,
            targetType: "WORK_ITEM",
            userId: task.assigneeId,
          });
        }

        for (const userId of unique(task.relatedUserIds)) {
          await ensureParticipant(tx, {
            actorUserId: input.actorUserId,
            organizationId: before.organizationId,
            relationType: "RELATED",
            spaceId: before.spaceId,
            targetId: workItem.id,
            targetType: "WORK_ITEM",
            userId,
          });
        }

        await createWorkItemTimelineEvent(tx, {
          actorUserId: input.actorUserId,
          after: {
            assigneeId: task.assigneeId ?? null,
            currentStateId: task.currentStateId,
            dueDate: task.dueDate?.toISOString() ?? null,
            intakeItemId: before.id,
            priority: task.priority,
            requirementId: task.requirementId ?? null,
            statusCategory: task.statusCategory,
            title: task.title,
            versionId: task.versionId ?? null,
            workflowVersionId: task.workflowVersionId,
          },
          organizationId: before.organizationId,
          spaceId: before.spaceId,
          targetId: workItem.id,
          title: "创建任务",
        });

        workItems.push(workItem);
      }

      const updated = await tx.intakeItem.findFirst({
        where: {
          deletedAt: null,
          id: before.id,
        },
      });

      if (!updated) {
        return undefined;
      }

      await createTimelineEvent(tx, {
        actorUserId: input.actorUserId,
        after: {
          convertedAt: now.toISOString(),
          status: "CONVERTED",
        },
        before: {
          status: before.status,
        },
        eventType: "STATUS_CHANGED",
        item: updated,
        metadata: {
          workItemIds: workItems.map((workItem) => workItem.id),
        },
        title: "Intake item converted",
      });

      return {
        intakeItemId: before.id,
        workItems,
      };
    });

    return converted
      ? {
          intakeItemId: converted.intakeItemId,
          workItems: converted.workItems.map((workItem) =>
            toWorkItem(workItem),
          ),
        }
      : undefined;
  }

  async create(input: CreateIntakeItemInput) {
    const item = await this.prisma.client.$transaction(async (tx) => {
      const created = await tx.intakeItem.create({
        data: {
          id: input.id,
          assigneeId: input.assigneeId,
          description: input.description,
          organizationId: input.organizationId,
          priority: input.priority,
          reporterId: input.reporterId,
          requirementId: input.requirementId,
          sourceObject: input.sourceObject as Prisma.InputJsonValue | undefined,
          sourceType: input.sourceType,
          spaceId: input.spaceId,
          title: input.title,
          updatedById: input.reporterId,
          createdById: input.reporterId,
          versionId: input.versionId,
        },
      });

      await ensureParticipant(tx, {
        actorUserId: input.reporterId,
        organizationId: created.organizationId,
        relationType: "CREATOR",
        spaceId: created.spaceId,
        targetId: created.id,
        userId: input.reporterId,
      });
      if (input.assigneeId) {
        await ensureParticipant(tx, {
          actorUserId: input.reporterId,
          organizationId: created.organizationId,
          relationType: "ASSIGNEE",
          spaceId: created.spaceId,
          targetId: created.id,
          userId: input.assigneeId,
        });
      }
      await createTimelineEvent(tx, {
        actorUserId: input.reporterId,
        after: intakeSnapshot(created),
        eventType: "CREATED",
        item: created,
        title: "Intake item created",
      });

      return created;
    });

    return toIntakeItem(item);
  }

  async findById(intakeItemId: string) {
    const item = await this.prisma.client.intakeItem.findFirst({
      where: {
        deletedAt: null,
        id: intakeItemId,
      },
    });

    return item ? toIntakeItem(item) : undefined;
  }

  async countVersionCascadeImpact(input: {
    intakeItemId: string;
    nextVersionId: string | null;
  }) {
    const workItems = await this.prisma.client.workItem.findMany({
      select: {
        id: true,
        type: true,
        versionId: true,
      },
      where: {
        deletedAt: null,
        intakeItemId: input.intakeItemId,
      },
    });
    const taskIds = workItems
      .filter((item) => item.type === "TASK")
      .map((item) => item.id);
    const relatedBugs =
      taskIds.length > 0
        ? await this.prisma.client.workItem.findMany({
            select: {
              id: true,
              versionId: true,
            },
            where: {
              bugDetail: {
                is: {
                  deletedAt: null,
                  relatedTaskId: {
                    in: taskIds,
                  },
                },
              },
              deletedAt: null,
              type: "BUG",
            },
          })
        : [];
    const changedWorkItemIds = new Set(
      workItems
        .filter((item) => item.versionId !== input.nextVersionId)
        .map((item) => item.id),
    );
    const changedRelatedBugIds = relatedBugs
      .filter((bug) => bug.versionId !== input.nextVersionId)
      .map((bug) => bug.id);

    for (const bugId of changedRelatedBugIds) {
      changedWorkItemIds.add(bugId);
    }

    return {
      bugCount: workItems.filter(
        (item) => item.type === "BUG" && item.versionId !== input.nextVersionId,
      ).length,
      relatedBugCount: changedRelatedBugIds.length,
      workItemCount: changedWorkItemIds.size,
    };
  }

  async hasParticipant(input: {
    intakeItemId: string;
    spaceId: string;
    userId: string;
  }) {
    const participant = await this.prisma.client.objectParticipant.findFirst({
      select: {
        id: true,
      },
      where: {
        deletedAt: null,
        spaceId: input.spaceId,
        targetId: input.intakeItemId,
        targetType: "INTAKE_ITEM",
        userId: input.userId,
      },
    });

    return Boolean(participant);
  }

  async listBySpaceId(spaceId: string, input: IntakeItemListInput) {
    const participantItemIds = input.restrictToParticipantUserId
      ? await this.listParticipantItemIds(
          spaceId,
          input.restrictToParticipantUserId,
        )
      : undefined;

    if (participantItemIds?.length === 0) {
      return {
        items: [],
        page: input.page,
        pageSize: input.pageSize,
        statusCounts: [],
        total: 0,
      };
    }

    const where = buildListWhere(spaceId, input, participantItemIds);
    const countWhere = buildListWhere(
      spaceId,
      {
        ...input,
        status: undefined,
      },
      participantItemIds,
    );
    const [items, total, statusGroups] = await this.prisma.client.$transaction([
      this.prisma.client.intakeItem.findMany({
        orderBy: buildOrderBy(input),
        skip: (input.page - 1) * input.pageSize,
        take: input.pageSize,
        where,
      }),
      this.prisma.client.intakeItem.count({
        where,
      }),
      this.prisma.client.intakeItem.groupBy({
        by: ["status"],
        _count: {
          _all: true,
        },
        where: countWhere,
      }),
    ]);

    return {
      items: items.map(toIntakeItem),
      page: input.page,
      pageSize: input.pageSize,
      statusCounts: statusGroups.map((group) => ({
        count: group._count._all,
        status: group.status,
      })),
      total,
    };
  }

  async update(input: UpdateIntakeItemInput) {
    const item = await this.prisma.client.$transaction(async (tx) => {
      const before = await tx.intakeItem.findFirst({
        where: {
          deletedAt: null,
          id: input.intakeItemId,
        },
      });

      if (!before) {
        return undefined;
      }

      const updated = await tx.intakeItem.update({
        data: {
          assigneeId: input.shouldUpdateAssignee ? input.assigneeId : undefined,
          description: input.description,
          priority: input.priority,
          requirementId: input.requirementId,
          sourceObject: input.shouldUpdateSourceObject
            ? (input.sourceObject as Prisma.InputJsonValue)
            : undefined,
          sourceType: input.sourceType,
          title: input.title,
          updatedById: input.updatedById,
          versionId: input.versionId,
        },
        where: {
          id: before.id,
        },
      });

      if (input.shouldUpdateAssignee) {
        await replaceAssigneeParticipant(tx, {
          actorUserId: input.updatedById,
          assigneeId: input.assigneeId,
          item: updated,
        });
      }

      if (
        input.cascadeVersionChange === true &&
        input.versionId !== undefined &&
        before.versionId !== input.versionId
      ) {
        await cascadeIntakeTraceVersion(tx, {
          actorUserId: input.updatedById,
          intakeItemId: before.id,
          nextRequirementId: input.requirementId,
          nextVersionId: input.versionId,
        });
      }

      await createTimelineEvent(tx, {
        actorUserId: input.updatedById,
        after: intakeSnapshot(updated),
        before: intakeSnapshot(before),
        eventType: "UPDATED",
        item: updated,
        metadata: {
          changedFields: changedFields(before, updated),
        },
        title: "Intake item updated",
      });

      return updated;
    });

    return item ? toIntakeItem(item) : undefined;
  }

  async updateStatus(input: UpdateIntakeItemStatusInput) {
    const item = await this.prisma.client.$transaction(async (tx) => {
      const before = await tx.intakeItem.findFirst({
        where: {
          deletedAt: null,
          id: input.intakeItemId,
        },
      });

      if (!before) {
        return undefined;
      }

      const now = new Date();
      const updated = await tx.intakeItem.update({
        data: {
          acceptedAt: input.status === "ACCEPTED" ? now : undefined,
          status: input.status,
          updatedById: input.actorUserId,
        },
        where: {
          id: before.id,
        },
      });

      await createTimelineEvent(tx, {
        actorUserId: input.actorUserId,
        after: {
          status: updated.status,
        },
        before: {
          status: before.status,
        },
        eventType: "STATUS_CHANGED",
        item: updated,
        title: `Intake item ${input.status.toLowerCase()}`,
      });

      return updated;
    });

    return item ? toIntakeItem(item) : undefined;
  }

  private async listParticipantItemIds(spaceId: string, userId: string) {
    const participants = await this.prisma.client.objectParticipant.findMany({
      select: {
        targetId: true,
      },
      where: {
        deletedAt: null,
        spaceId,
        targetType: "INTAKE_ITEM",
        userId,
      },
    });

    return [
      ...new Set(participants.map((participant) => participant.targetId)),
    ];
  }
}

function buildListWhere(
  spaceId: string,
  input: IntakeItemListInput,
  participantItemIds: string[] | undefined,
): Prisma.IntakeItemWhereInput {
  return {
    assigneeId: input.assigneeId,
    deletedAt: null,
    id: participantItemIds
      ? {
          in: participantItemIds,
        }
      : undefined,
    priority: input.priority,
    reporterId: input.reporterId,
    requirementId: input.requirementId,
    sourceType: input.sourceType,
    spaceId,
    status: input.status,
    versionId: input.versionId,
  };
}

function buildOrderBy(
  input: IntakeItemListInput,
): Prisma.IntakeItemOrderByWithRelationInput {
  const direction = input.sortOrder ?? "asc";

  switch (input.sortBy) {
    case "priority":
      return { priority: direction };
    case "sourceType":
      return { sourceType: direction };
    case "status":
      return { status: direction };
    case "title":
      return { title: direction };
    default:
      return { createdAt: direction };
  }
}

async function replaceAssigneeParticipant(
  tx: Prisma.TransactionClient,
  input: {
    actorUserId: string;
    assigneeId: string | null | undefined;
    item: IntakeItemRecord;
  },
) {
  const where: Prisma.ObjectParticipantWhereInput = {
    deletedAt: null,
    relationType: "ASSIGNEE",
    spaceId: input.item.spaceId,
    targetId: input.item.id,
    targetType: "INTAKE_ITEM",
  };

  if (input.assigneeId) {
    where.userId = {
      not: input.assigneeId,
    };
  }

  await tx.objectParticipant.updateMany({
    data: {
      deletedAt: new Date(),
      updatedById: input.actorUserId,
    },
    where,
  });

  if (!input.assigneeId) {
    return;
  }

  await ensureParticipant(tx, {
    actorUserId: input.actorUserId,
    organizationId: input.item.organizationId,
    relationType: "ASSIGNEE",
    spaceId: input.item.spaceId,
    targetId: input.item.id,
    userId: input.assigneeId,
  });
}

async function ensureParticipant(
  tx: Prisma.TransactionClient,
  input: {
    actorUserId: string;
    organizationId: string;
    relationType: "CREATOR" | "ASSIGNEE" | "REPORTER" | "RELATED";
    spaceId: string;
    targetId: string;
    targetType?: "INTAKE_ITEM" | "WORK_ITEM";
    userId: string;
  },
) {
  const targetType = input.targetType ?? "INTAKE_ITEM";
  const active = await tx.objectParticipant.findFirst({
    select: {
      id: true,
    },
    where: {
      deletedAt: null,
      relationType: input.relationType,
      spaceId: input.spaceId,
      targetId: input.targetId,
      targetType,
      userId: input.userId,
    },
  });

  if (active) {
    return;
  }

  const deleted = await tx.objectParticipant.findFirst({
    select: {
      id: true,
    },
    where: {
      deletedAt: {
        not: null,
      },
      relationType: input.relationType,
      spaceId: input.spaceId,
      targetId: input.targetId,
      targetType,
      userId: input.userId,
    },
  });

  if (deleted) {
    await tx.objectParticipant.update({
      data: {
        deletedAt: null,
        updatedById: input.actorUserId,
      },
      where: {
        id: deleted.id,
      },
    });
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
      targetType,
      updatedById: input.actorUserId,
      userId: input.userId,
    },
  });
}

async function createTimelineEvent(
  tx: Prisma.TransactionClient,
  input: {
    actorUserId: string;
    after?: Prisma.InputJsonValue;
    before?: Prisma.InputJsonValue;
    eventType: "CREATED" | "UPDATED" | "STATUS_CHANGED";
    item: IntakeItemRecord;
    metadata?: Prisma.InputJsonValue;
    title: string;
  },
) {
  await tx.timelineEvent.create({
    data: {
      id: ulid(),
      actorId: input.actorUserId,
      after: input.after,
      before: input.before,
      createdById: input.actorUserId,
      eventType: input.eventType,
      metadata: input.metadata,
      organizationId: input.item.organizationId,
      spaceId: input.item.spaceId,
      targetId: input.item.id,
      targetType: "INTAKE_ITEM",
      title: input.title,
      updatedById: input.actorUserId,
    },
  });
}

async function createWorkItemTimelineEvent(
  tx: Prisma.TransactionClient,
  input: {
    actorUserId: string;
    after: Record<string, unknown>;
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
      createdById: input.actorUserId,
      eventType: "CREATED",
      organizationId: input.organizationId,
      spaceId: input.spaceId,
      targetId: input.targetId,
      targetType: "WORK_ITEM",
      title: input.title,
      updatedById: input.actorUserId,
    },
  });
}

async function cascadeIntakeTraceVersion(
  tx: Prisma.TransactionClient,
  input: {
    actorUserId: string;
    intakeItemId: string;
    nextRequirementId?: string | null;
    nextVersionId: string | null;
  },
) {
  const workItems = await tx.workItem.findMany({
    select: {
      id: true,
      type: true,
    },
    where: {
      deletedAt: null,
      intakeItemId: input.intakeItemId,
    },
  });
  const taskIds = workItems
    .filter((item) => item.type === "TASK")
    .map((item) => item.id);
  const relatedBugs =
    taskIds.length > 0
      ? await tx.bugDetail.findMany({
          select: { workItemId: true },
          where: {
            deletedAt: null,
            relatedTaskId: {
              in: taskIds,
            },
            workItem: {
              deletedAt: null,
              type: "BUG",
            },
          },
        })
      : [];
  const workItemIds = [
    ...new Set([
      ...workItems.map((item) => item.id),
      ...relatedBugs.map((bug) => bug.workItemId),
    ]),
  ];
  const directWorkItemIds = workItems.map((item) => item.id);
  const relatedBugIds = relatedBugs
    .map((bug) => bug.workItemId)
    .filter((bugId) => !directWorkItemIds.includes(bugId));

  if (workItemIds.length === 0) {
    return;
  }

  await assertNoIntakeCascadeConflicts(tx, {
    intakeItemId: input.intakeItemId,
    nextRequirementId: input.nextRequirementId,
    nextVersionId: input.nextVersionId,
    taskIds,
    workItemIds,
  });

  if (directWorkItemIds.length > 0) {
    await tx.workItem.updateMany({
      data: {
        requirementId: input.nextRequirementId,
        updatedById: input.actorUserId,
        versionId: input.nextVersionId,
      },
      where: {
        deletedAt: null,
        id: {
          in: directWorkItemIds,
        },
      },
    });
  }

  if (relatedBugIds.length === 0) {
    return;
  }

  await tx.workItem.updateMany({
    data: {
      updatedById: input.actorUserId,
      versionId: input.nextVersionId,
    },
    where: {
      deletedAt: null,
      id: {
        in: relatedBugIds,
      },
    },
  });
}

async function assertNoIntakeCascadeConflicts(
  tx: Prisma.TransactionClient,
  input: {
    intakeItemId: string;
    nextVersionId: string | null;
    nextRequirementId?: string | null;
    taskIds: string[];
    workItemIds: string[];
  },
) {
  const nextRequirement = input.nextRequirementId
    ? await tx.requirement.findFirst({
        select: { versionId: true },
        where: {
          deletedAt: null,
          id: input.nextRequirementId,
        },
      })
    : undefined;
  const affectedItems = await tx.workItem.findMany({
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
      intakeItemId: true,
      requirement: {
        select: { versionId: true },
      },
      requirementId: true,
    },
    where: {
      deletedAt: null,
      id: {
        in: input.workItemIds,
      },
    },
  });

  for (const item of affectedItems) {
    assertTraceRefsMatchVersion({
      details: {
        workItemId: item.id,
      },
      refs: [
        {
          label: "requirement",
          versionId:
            item.intakeItemId === input.intakeItemId &&
            input.nextRequirementId !== undefined
              ? nextRequirement?.versionId
              : item.requirement?.versionId,
        },
        {
          label: "intakeItem",
          versionId:
            item.intakeItemId === input.intakeItemId
              ? input.nextVersionId
              : item.intakeItem?.versionId,
        },
        {
          label: "relatedTask",
          versionId:
            item.bugDetail?.relatedTaskId &&
            input.taskIds.includes(item.bugDetail.relatedTaskId)
              ? input.nextVersionId
              : item.bugDetail?.relatedTask?.versionId,
        },
      ],
      versionId: input.nextVersionId,
    });
  }
}

function intakeSnapshot(item: IntakeItemRecord): Prisma.InputJsonObject {
  return {
    assigneeId: item.assigneeId,
    description: item.description,
    priority: item.priority,
    requirementId: item.requirementId,
    sourceObject: item.sourceObject as Prisma.InputJsonValue,
    sourceType: item.sourceType,
    status: item.status,
    title: item.title,
    versionId: item.versionId,
  };
}

function changedFields(before: IntakeItemRecord, after: IntakeItemRecord) {
  const fields: IntakeSnapshotField[] = [
    "assigneeId",
    "description",
    "priority",
    "requirementId",
    "sourceObject",
    "sourceType",
    "status",
    "title",
    "versionId",
  ];

  return fields.filter((field) => before[field] !== after[field]);
}

function toJson(value: Record<string, unknown> | undefined) {
  return value && Object.keys(value).length > 0
    ? (value as Prisma.InputJsonObject)
    : undefined;
}

function unique(values: readonly string[]) {
  return Array.from(new Set(values.filter(Boolean)));
}

type IntakeSnapshotField =
  | "assigneeId"
  | "description"
  | "priority"
  | "requirementId"
  | "sourceObject"
  | "sourceType"
  | "status"
  | "title"
  | "versionId";

type IntakeItemRecord =
  Awaited<
    ReturnType<Prisma.TransactionClient["intakeItem"]["findFirst"]>
  > extends infer T
    ? NonNullable<T>
    : never;
