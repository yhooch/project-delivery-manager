import { describe, expect, it, vi } from "vitest";

import type { PrismaService } from "../../prisma/prisma.service";
import { PrismaIntakeRepository } from "./prisma-intake.repository";

describe("PrismaIntakeRepository", () => {
  it("creates intake item creator and reporter participants idempotently", async () => {
    const item = makeIntakeItem();
    const objectParticipantCreate = vi.fn(async () => undefined);
    const tx = {
      intakeItem: {
        create: vi.fn(async () => item),
      },
      objectParticipant: {
        create: objectParticipantCreate,
        findFirst: vi.fn(async () => undefined),
        update: vi.fn(async () => undefined),
      },
      timelineEvent: {
        create: vi.fn(async () => undefined),
      },
    };
    const prisma = {
      client: {
        $transaction: vi.fn(async (handler) => handler(tx)),
      },
    } as unknown as PrismaService;
    const repository = new PrismaIntakeRepository(prisma);

    await repository.create({
      id: item.id,
      organizationId: item.organizationId,
      reporterId: item.reporterId,
      sourceType: item.sourceType,
      spaceId: item.spaceId,
      title: item.title,
    });

    expect(objectParticipantCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        relationType: "CREATOR",
        targetId: item.id,
        targetType: "INTAKE_ITEM",
        userId: item.reporterId,
      }),
    });
    expect(objectParticipantCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        relationType: "REPORTER",
        targetId: item.id,
        targetType: "INTAKE_ITEM",
        userId: item.reporterId,
      }),
    });
  });

  it("rebuilds related work item participants after cascading an intake version", async () => {
    const oldVersionId = "01H00000000000000000000101";
    const newVersionId = "01H00000000000000000000102";
    const oldVersionOwnerId = "01H00000000000000000000103";
    const newVersionOwnerId = "01H00000000000000000000104";
    const intakeReporterId = "01H00000000000000000000105";
    const intakeAssigneeId = "01H00000000000000000000106";
    const relatedTaskReporterId = "01H00000000000000000000107";
    const actorUserId = "01H00000000000000000000108";
    const taskId = "01H00000000000000000000109";
    const bugId = "01H00000000000000000000110";
    const before = makeIntakeItem({
      assigneeId: intakeAssigneeId,
      reporterId: intakeReporterId,
      versionId: oldVersionId,
    });
    const updated = {
      ...before,
      updatedById: actorUserId,
      versionId: newVersionId,
    };
    const objectParticipantUpdateMany = vi.fn(async () => ({ count: 1 }));
    const objectParticipantCreate = vi.fn(async () => undefined);
    const tx = {
      bugDetail: {
        findMany: vi.fn(async () => [{ workItemId: bugId }]),
      },
      intakeItem: {
        findFirst: vi.fn(async () => before),
        update: vi.fn(async () => updated),
      },
      objectParticipant: {
        create: objectParticipantCreate,
        findFirst: vi.fn(async () => undefined),
        updateMany: objectParticipantUpdateMany,
      },
      timelineEvent: {
        create: vi.fn(async () => undefined),
      },
      workItem: {
        findMany: vi
          .fn()
          .mockResolvedValueOnce([{ id: taskId, type: "TASK" }])
          .mockResolvedValueOnce([
            {
              id: taskId,
              organizationId: before.organizationId,
              spaceId: before.spaceId,
              versionId: oldVersionId,
            },
            {
              id: bugId,
              organizationId: before.organizationId,
              spaceId: before.spaceId,
              versionId: oldVersionId,
            },
          ])
          .mockResolvedValueOnce([
            {
              bugDetail: null,
              id: taskId,
              intakeItem: { versionId: newVersionId },
              intakeItemId: before.id,
              requirement: null,
              requirementId: null,
            },
            {
              bugDetail: {
                relatedTask: { versionId: newVersionId },
                relatedTaskId: taskId,
              },
              id: bugId,
              intakeItem: null,
              intakeItemId: null,
              requirement: null,
              requirementId: null,
            },
          ])
          .mockResolvedValueOnce([
            {
              bugDetail: null,
              id: taskId,
              intakeItem: {
                assigneeId: intakeAssigneeId,
                reporterId: intakeReporterId,
              },
              organizationId: before.organizationId,
              requirement: null,
              spaceId: before.spaceId,
              version: { ownerId: newVersionOwnerId },
            },
            {
              bugDetail: {
                deletedAt: null,
                relatedTask: {
                  assigneeId: null,
                  createdById: oldVersionOwnerId,
                  deletedAt: null,
                  reporterId: relatedTaskReporterId,
                },
              },
              id: bugId,
              intakeItem: null,
              organizationId: before.organizationId,
              requirement: null,
              spaceId: before.spaceId,
              version: { ownerId: newVersionOwnerId },
            },
          ]),
        updateMany: vi.fn(async () => ({ count: 1 })),
      },
    };
    const prisma = {
      client: {
        $transaction: vi.fn(async (handler) => handler(tx)),
      },
    } as unknown as PrismaService;
    const repository = new PrismaIntakeRepository(prisma);

    await repository.update({
      cascadeVersionChange: true,
      intakeItemId: before.id,
      shouldUpdateAssignee: false,
      shouldUpdateSourceObject: false,
      updatedById: actorUserId,
      versionId: newVersionId,
    });

    expect(objectParticipantUpdateMany).toHaveBeenCalledWith({
      data: expect.objectContaining({
        updatedById: actorUserId,
      }),
      where: expect.objectContaining({
        relationType: "RELATED",
        targetId: taskId,
        targetType: "WORK_ITEM",
        userId: {
          notIn: [newVersionOwnerId, intakeReporterId, intakeAssigneeId],
        },
      }),
    });
    expect(objectParticipantCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        relationType: "RELATED",
        targetId: taskId,
        targetType: "WORK_ITEM",
        userId: newVersionOwnerId,
      }),
    });
    expect(objectParticipantCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        relationType: "RELATED",
        targetId: taskId,
        targetType: "WORK_ITEM",
        userId: intakeReporterId,
      }),
    });
    expect(objectParticipantCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        relationType: "RELATED",
        targetId: bugId,
        targetType: "WORK_ITEM",
        userId: relatedTaskReporterId,
      }),
    });
    expect(objectParticipantCreate).not.toHaveBeenCalledWith({
      data: expect.objectContaining({
        targetId: taskId,
        userId: oldVersionOwnerId,
      }),
    });
  });
});

function makeIntakeItem(
  overrides: {
    assigneeId?: string | null;
    reporterId?: string;
    versionId?: string | null;
  } = {},
) {
  const now = new Date("2026-05-14T12:00:00.000Z");

  return {
    acceptedAt: null,
    assigneeId: overrides.assigneeId ?? null,
    convertedAt: null,
    createdAt: now,
    description: "Intake description",
    id: "01H00000000000000000000111",
    organizationId: "01H00000000000000000000112",
    priority: null,
    reporterId: overrides.reporterId ?? "01H00000000000000000000113",
    requirementId: null,
    sourceObject: null,
    sourceType: "AD_HOC" as const,
    spaceId: "01H00000000000000000000114",
    status: "PENDING" as const,
    title: "Intake item",
    updatedAt: now,
    updatedById: null,
    versionId: overrides.versionId ?? null,
  };
}
