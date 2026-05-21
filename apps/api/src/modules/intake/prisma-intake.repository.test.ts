import { describe, expect, it, vi } from "vitest";

import type { ObjectCodeAllocator } from "../object-code/object-code.allocator";
import type { PrismaService } from "../../prisma/prisma.service";
import { PrismaIntakeRepository } from "./prisma-intake.repository";

describe("PrismaIntakeRepository", () => {
  it("creates intake item creator and reporter participants idempotently", async () => {
    const item = makeIntakeItem({ sequence: 21 });
    const objectCodeAllocator = makeObjectCodeAllocator({ nextSequence: 21 });
    const objectParticipantCreate = vi.fn(async () => undefined);
    const intakeItemCreate = vi.fn(async () => item);
    const tx = {
      intakeItem: {
        create: intakeItemCreate,
      },
      objectParticipant: {
        create: objectParticipantCreate,
        findFirst: vi.fn(async () => undefined),
        update: vi.fn(async () => undefined),
      },
      tagAssignment: {
        updateMany: vi.fn(async () => ({ count: 0 })),
      },
      timelineEvent: {
        create: vi.fn(async () => undefined),
      },
    };
    const prisma = {
      client: {
        $transaction: vi.fn(async (handler) => handler(tx)),
        tagAssignment: {
          findMany: vi.fn(async () => []),
        },
      },
    } as unknown as PrismaService;
    const repository = new PrismaIntakeRepository(
      prisma,
      objectCodeAllocator,
    );

    await repository.create({
      id: item.id,
      organizationId: item.organizationId,
      reporterId: item.reporterId,
      sourceType: item.sourceType,
      spaceId: item.spaceId,
      title: item.title,
    });

    expect(objectCodeAllocator.allocateOne).toHaveBeenCalledWith(tx, {
      actorUserId: item.reporterId,
      objectType: "INTAKE_ITEM",
      organizationId: item.organizationId,
      spaceId: item.spaceId,
    });
    expect(intakeItemCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        sequence: 21,
      }),
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

  it("allocates continuous TASK sequences when converting an intake item", async () => {
    const before = makeIntakeItem({
      sequence: 9,
      status: "ACCEPTED",
    });
    const updated = {
      ...before,
      convertedAt: new Date("2026-05-14T12:10:00.000Z"),
      status: "CONVERTED" as const,
    };
    const objectCodeAllocator = makeObjectCodeAllocator({ rangeStart: 41 });
    const workItemCreate = vi.fn(async (args: { data: WorkItemCreateData }) =>
      makeWorkItem(args.data),
    );
    const tx = {
      intakeItem: {
        findFirst: vi
          .fn()
          .mockResolvedValueOnce(before)
          .mockResolvedValueOnce(updated),
        updateMany: vi.fn(async () => ({ count: 1 })),
      },
      objectParticipant: {
        create: vi.fn(async () => undefined),
        findFirst: vi.fn(async () => undefined),
        update: vi.fn(async () => undefined),
      },
      tagAssignment: {
        updateMany: vi.fn(async () => ({ count: 0 })),
      },
      timelineEvent: {
        create: vi.fn(async () => undefined),
      },
      workItem: {
        create: workItemCreate,
      },
    };
    const prisma = {
      client: {
        $transaction: vi.fn(async (handler) => handler(tx)),
        tagAssignment: {
          findMany: vi.fn(async () => []),
        },
      },
    } as unknown as PrismaService;
    const repository = new PrismaIntakeRepository(
      prisma,
      objectCodeAllocator,
    );

    const result = await repository.convertToWorkItems({
      actorUserId: before.reporterId,
      intakeItemId: before.id,
      tasks: [
        makeConvertTask({ id: "01H00000000000000000000121" }),
        makeConvertTask({ id: "01H00000000000000000000122" }),
      ],
    });

    expect(objectCodeAllocator.allocateRange).toHaveBeenCalledWith(tx, {
      actorUserId: before.reporterId,
      count: 2,
      objectType: "TASK",
      organizationId: before.organizationId,
      spaceId: before.spaceId,
    });
    expect(workItemCreate.mock.calls[0]?.[0].data.sequence).toBe(41);
    expect(workItemCreate.mock.calls[1]?.[0].data.sequence).toBe(42);
    expect(result?.workItems).toEqual([
      expect.objectContaining({
        sequence: 41,
        displayCode: "TASK-41",
      }),
      expect.objectContaining({
        sequence: 42,
        displayCode: "TASK-42",
      }),
    ]);
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
        tagAssignment: {
          findMany: vi.fn(async () => []),
        },
      },
    } as unknown as PrismaService;
    const repository = new PrismaIntakeRepository(
      prisma,
      makeObjectCodeAllocator(),
    );

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
    sequence?: number | null;
    status?: "PENDING" | "ACCEPTED" | "DEFERRED" | "REJECTED" | "CONVERTED";
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
    sequence: overrides.sequence ?? null,
    sourceObject: null,
    sourceType: "AD_HOC" as const,
    spaceId: "01H00000000000000000000114",
    status: overrides.status ?? ("PENDING" as const),
    title: "Intake item",
    updatedAt: now,
    updatedById: null,
    versionId: overrides.versionId ?? null,
  };
}

type WorkItemCreateData = ReturnType<typeof makeConvertTask> & {
  createdById: string;
  intakeItemId: string;
  lastStatusChangedAt: Date;
  organizationId: string;
  sequence: number;
  spaceId: string;
  type: "TASK";
  updatedById: string;
};

function makeConvertTask(overrides: { id: string }) {
  return {
    id: overrides.id,
    assigneeId: undefined,
    currentStateId: "01H00000000000000000000123",
    description: "Converted task",
    dueDate: undefined,
    priority: "MEDIUM" as const,
    relatedUserIds: [],
    reporterId: "01H00000000000000000000113",
    requirementId: undefined,
    statusCategory: "NOT_STARTED" as const,
    tagIds: undefined,
    title: "Converted task",
    versionId: undefined,
    workflowVersionId: "01H00000000000000000000124",
  };
}

function makeWorkItem(data: WorkItemCreateData) {
  const now = new Date("2026-05-14T12:15:00.000Z");

  return {
    id: data.id,
    organizationId: data.organizationId,
    spaceId: data.spaceId,
    sequence: data.sequence,
    versionId: data.versionId ?? null,
    requirementId: data.requirementId ?? null,
    intakeItemId: data.intakeItemId,
    type: data.type,
    title: data.title,
    description: data.description ?? null,
    priority: data.priority,
    assigneeId: data.assigneeId ?? null,
    reporterId: data.reporterId,
    workflowVersionId: data.workflowVersionId,
    currentStateId: data.currentStateId,
    statusCategory: data.statusCategory,
    dueDate: data.dueDate ?? null,
    lastStatusChangedAt: data.lastStatusChangedAt,
    lastActionAt: null,
    blockedReason: null,
    blockedAt: null,
    closedAt: null,
    createdAt: now,
    updatedAt: now,
    createdById: data.createdById,
    updatedById: data.updatedById,
    deletedAt: null,
  };
}

function makeObjectCodeAllocator(
  input: { nextSequence?: number; rangeStart?: number } = {},
) {
  const nextSequence = input.nextSequence ?? 1;
  const rangeStart = input.rangeStart ?? nextSequence;

  return {
    allocateOne: vi.fn(async () => nextSequence),
    allocateRange: vi.fn(async (_tx, rangeInput: { count: number }) => ({
      firstValue: rangeStart,
      lastValue: rangeStart + rangeInput.count - 1,
    })),
  } as unknown as ObjectCodeAllocator & {
    allocateOne: ReturnType<typeof vi.fn>;
    allocateRange: ReturnType<typeof vi.fn>;
  };
}
