import { describe, expect, it, vi } from "vitest";

import type { PrismaService } from "../../prisma/prisma.service";
import { PrismaRequirementRepository } from "./prisma-requirement.repository";

describe("PrismaRequirementRepository", () => {
  it("writes visible timeline events when creating, saving, and archiving requirements", async () => {
    const requirement = makeRequirement();
    const timelineEventCreate = vi.fn(async () => undefined);
    const tx = {
      objectParticipant: {
        create: vi.fn(async () => undefined),
        findFirst: vi.fn(async () => undefined),
        updateMany: vi.fn(async () => undefined),
      },
      requirement: {
        create: vi.fn(async () => requirement),
        findFirst: vi
          .fn()
          .mockResolvedValueOnce(requirement)
          .mockResolvedValueOnce({
            ...requirement,
            title: "已保存需求",
            status: "CONFIRMED",
          })
          .mockResolvedValueOnce({
            ...requirement,
            title: "已保存需求",
            status: "CONFIRMED",
          })
          .mockResolvedValueOnce({
            ...requirement,
            title: "已保存需求",
            status: "ARCHIVED",
          }),
        updateMany: vi.fn(async () => ({ count: 1 })),
      },
      timelineEvent: {
        create: timelineEventCreate,
      },
    };
    const prisma = {
      client: {
        $transaction: vi.fn(async (handler) => handler(tx)),
        attachment: {
          findMany: vi.fn(async () => []),
        },
        workItem: {
          findMany: vi.fn(async () => []),
        },
      },
    } as unknown as PrismaService;
    const repository = new PrismaRequirementRepository(prisma);

    await repository.createDraft({
      id: requirement.id,
      organizationId: requirement.organizationId,
      spaceId: requirement.spaceId,
      versionId: requirement.versionId ?? undefined,
      createdById: requirement.authorId,
    });
    await repository.save({
      requirementId: requirement.id,
      title: "已保存需求",
      contentJson: { type: "doc" },
      contentText: "需求内容",
      shouldUpdateOwner: false,
      updatedById: requirement.authorId,
    });
    await repository.archive({
      requirementId: requirement.id,
      updatedById: requirement.authorId,
    });

    expect(timelineEventCreate).toHaveBeenCalledTimes(3);
    expect(timelineEventCreate).toHaveBeenNthCalledWith(1, {
      data: expect.objectContaining({
        actorId: requirement.authorId,
        eventType: "CREATED",
        targetId: requirement.id,
        targetType: "REQUIREMENT",
        title: "创建需求草稿",
      }),
    });
    expect(timelineEventCreate).toHaveBeenNthCalledWith(2, {
      data: expect.objectContaining({
        actorId: requirement.authorId,
        eventType: "UPDATED",
        targetId: requirement.id,
        targetType: "REQUIREMENT",
        title: "保存需求",
      }),
    });
    expect(timelineEventCreate).toHaveBeenNthCalledWith(3, {
      data: expect.objectContaining({
        actorId: requirement.authorId,
        eventType: "STATUS_CHANGED",
        targetId: requirement.id,
        targetType: "REQUIREMENT",
        title: "归档需求",
      }),
    });
  });

  it("rebuilds related work item participants after cascading a requirement version", async () => {
    const oldVersionId = "01H00000000000000000000011";
    const newVersionId = "01H00000000000000000000012";
    const oldVersionOwnerId = "01H00000000000000000000013";
    const newVersionOwnerId = "01H00000000000000000000014";
    const taskId = "01H00000000000000000000015";
    const bugId = "01H00000000000000000000016";
    const actorUserId = "01H00000000000000000000017";
    const relatedTaskReporterId = "01H00000000000000000000018";
    const previous = {
      ...makeRequirement(),
      versionId: oldVersionId,
    };
    const saved = {
      ...previous,
      status: "CONFIRMED" as const,
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
        findMany: vi.fn(async () => []),
      },
      objectParticipant: {
        create: objectParticipantCreate,
        findFirst: vi.fn(async () => undefined),
        updateMany: objectParticipantUpdateMany,
      },
      requirement: {
        findFirst: vi
          .fn()
          .mockResolvedValueOnce(previous)
          .mockResolvedValueOnce(saved),
        updateMany: vi.fn(async () => ({ count: 1 })),
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
              bugDetail: null,
              id: taskId,
              intakeItem: null,
              intakeItemId: null,
              requirement: { versionId: newVersionId },
              requirementId: previous.id,
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
              intakeItem: null,
              organizationId: previous.organizationId,
              requirement: { ownerId: null },
              spaceId: previous.spaceId,
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
              organizationId: previous.organizationId,
              requirement: null,
              spaceId: previous.spaceId,
              version: { ownerId: newVersionOwnerId },
            },
          ]),
        updateMany: vi.fn(async () => ({ count: 2 })),
      },
    };
    const prisma = {
      client: {
        $transaction: vi.fn(async (handler) => handler(tx)),
        attachment: {
          findMany: vi.fn(async () => []),
        },
        workItem: {
          findMany: vi.fn(async () => []),
        },
      },
    } as unknown as PrismaService;
    const repository = new PrismaRequirementRepository(prisma);

    await repository.save({
      cascadeVersionChange: true,
      contentJson: { type: "doc" },
      contentText: "需求内容",
      requirementId: previous.id,
      shouldUpdateOwner: false,
      title: "已保存需求",
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
          notIn: [newVersionOwnerId],
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

function makeRequirement() {
  const now = new Date("2026-05-14T12:00:00.000Z");

  return {
    id: "01H00000000000000000000001",
    organizationId: "01H00000000000000000000002",
    spaceId: "01H00000000000000000000003",
    versionId: "01H00000000000000000000004",
    title: "",
    summary: null,
    contentJson: {},
    contentText: null,
    contentMarkdownCache: null,
    contentFormat: "TIPTAP_JSON" as const,
    status: "DRAFT" as const,
    priority: null,
    ownerId: null,
    authorId: "01H00000000000000000000005",
    createdAt: now,
    updatedAt: now,
  };
}
