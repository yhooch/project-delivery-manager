import { ulid } from "ulid";

import { Prisma } from "../../generated/prisma/client";

export async function syncWorkItemRelatedParticipants(
  tx: Prisma.TransactionClient,
  input: {
    actorUserId: string;
    workItemIds: string[];
  },
) {
  const workItemIds = unique(input.workItemIds);

  if (workItemIds.length === 0) {
    return;
  }

  const workItems = await tx.workItem.findMany({
    select: {
      bugDetail: {
        select: {
          deletedAt: true,
          relatedTask: {
            select: {
              assigneeId: true,
              createdById: true,
              deletedAt: true,
              reporterId: true,
            },
          },
        },
      },
      id: true,
      intakeItem: {
        select: {
          assigneeId: true,
          reporterId: true,
        },
      },
      organizationId: true,
      requirement: {
        select: {
          ownerId: true,
        },
      },
      spaceId: true,
      version: {
        select: {
          ownerId: true,
        },
      },
    },
    where: {
      deletedAt: null,
      id: {
        in: workItemIds,
      },
    },
  });

  for (const workItem of workItems) {
    const relatedTask =
      workItem.bugDetail?.deletedAt === null
        ? workItem.bugDetail.relatedTask
        : undefined;
    const relatedTaskUserIds =
      relatedTask && relatedTask.deletedAt === null
        ? [
            relatedTask.createdById,
            relatedTask.reporterId,
            relatedTask.assigneeId,
          ]
        : [];
    const userIds = unique([
      workItem.version?.ownerId,
      workItem.requirement?.ownerId,
      workItem.intakeItem?.reporterId,
      workItem.intakeItem?.assigneeId,
      ...relatedTaskUserIds,
    ]);

    await replaceWorkItemRelatedParticipants(tx, {
      actorUserId: input.actorUserId,
      organizationId: workItem.organizationId,
      spaceId: workItem.spaceId,
      targetId: workItem.id,
      userIds,
    });
  }
}

async function replaceWorkItemRelatedParticipants(
  tx: Prisma.TransactionClient,
  input: {
    actorUserId: string;
    organizationId: string;
    spaceId: string;
    targetId: string;
    userIds: string[];
  },
) {
  const where: Prisma.ObjectParticipantWhereInput = {
    deletedAt: null,
    relationType: "RELATED",
    spaceId: input.spaceId,
    targetId: input.targetId,
    targetType: "WORK_ITEM",
  };

  if (input.userIds.length > 0) {
    where.userId = {
      notIn: input.userIds,
    };
  }

  await tx.objectParticipant.updateMany({
    data: {
      deletedAt: new Date(),
      updatedById: input.actorUserId,
    },
    where,
  });

  for (const userId of input.userIds) {
    await ensureWorkItemRelatedParticipant(tx, {
      actorUserId: input.actorUserId,
      organizationId: input.organizationId,
      spaceId: input.spaceId,
      targetId: input.targetId,
      userId,
    });
  }
}

async function ensureWorkItemRelatedParticipant(
  tx: Prisma.TransactionClient,
  input: {
    actorUserId: string;
    organizationId: string;
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
      relationType: "RELATED",
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
      relationType: "RELATED",
      spaceId: input.spaceId,
      targetId: input.targetId,
      targetType: "WORK_ITEM",
      updatedById: input.actorUserId,
      userId: input.userId,
    },
  });
}

function unique(values: Array<string | null | undefined>) {
  return Array.from(new Set(values.filter(Boolean))) as string[];
}
