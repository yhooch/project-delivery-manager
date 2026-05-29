import { describe, expect, it, vi } from "vitest";

import type { ObjectCodeAllocator } from "../object-code/object-code.allocator";
import type { PrismaService } from "../../prisma/prisma.service";
import { PrismaBugRepository } from "./prisma-bug.repository";

type PrismaCallArgs = {
  where?: unknown;
};

function createRepositoryMock(
  input: {
    transactionResult?: unknown[];
    workflowVersion?: unknown;
  } = {},
) {
  const workflowBindingFindFirst = vi.fn();
  const workflowVersionFindFirst = vi.fn(
    async () => input.workflowVersion,
  );
  const workItemFindMany = vi.fn((args: PrismaCallArgs) => ({
    args,
    kind: "findMany",
  }));
  const workItemCount = vi.fn((args: PrismaCallArgs) => ({
    args,
    kind: "count",
  }));
  const workItemGroupBy = vi.fn((args: PrismaCallArgs) => ({
    args,
    kind: "groupBy",
  }));
  const transaction = vi.fn(
    async (_queries: unknown[]) => input.transactionResult ?? [[], 0, []],
  );
  const prisma = {
    client: {
      $transaction: transaction,
      workItem: {
        count: workItemCount,
        findMany: workItemFindMany,
        groupBy: workItemGroupBy,
      },
      workflowBinding: {
        findFirst: workflowBindingFindFirst,
      },
      workflowVersion: {
        findFirst: workflowVersionFindFirst,
      },
    },
  } as unknown as PrismaService;

  return {
    repository: new PrismaBugRepository(prisma, makeObjectCodeAllocator()),
    transaction,
    workItemCount,
    workItemFindMany,
    workItemGroupBy,
    workflowBindingFindFirst,
    workflowVersionFindFirst,
  };
}

describe("PrismaBugRepository", () => {
  it("resolves explicit BUG workflow versions through a workflow binding", async () => {
    const { repository, workflowBindingFindFirst, workflowVersionFindFirst } =
      createRepositoryMock({
        workflowVersion: {
          id: "01H00000000000000000000002",
          states: [
            {
              category: "VERIFYING",
              id: "01H00000000000000000000003",
            },
          ],
        },
      });

    await expect(
      repository.resolveBugWorkflow(
        "01H00000000000000000000001",
        "01H00000000000000000000002",
      ),
    ).resolves.toEqual({
      currentStateId: "01H00000000000000000000003",
      statusCategory: "VERIFYING",
      workflowVersionId: "01H00000000000000000000002",
    });
    expect(workflowVersionFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: "01H00000000000000000000002",
          workflowDefinition: expect.objectContaining({
            bindings: {
              some: expect.objectContaining({
                spaceId: "01H00000000000000000000001",
                targetType: "WORK_ITEM",
                workItemType: "BUG",
              }),
            },
            spaceId: "01H00000000000000000000001",
            status: "ACTIVE",
          }),
        }),
      }),
    );
    expect(workflowBindingFindFirst).not.toHaveBeenCalled();
  });

  it("returns status category counts without lifecycle bucket aggregation", async () => {
    const { repository, transaction, workItemGroupBy } = createRepositoryMock({
      transactionResult: [
        [],
        0,
        [
          {
            _count: { _all: 3 },
            statusCategory: "DONE",
          },
          {
            _count: { _all: 2 },
            statusCategory: "VERIFYING",
          },
        ],
      ],
    });

    const result = await repository.listBySpaceId(
      "01ARZ3NDEKTSV4RRFFQ69G5SPC",
      {
        actorUserId: "01ARZ3NDEKTSV4RRFFQ69G5USR",
        page: 1,
        pageSize: 20,
        visibility: "SPACE",
      },
    );

    expect(result.statusCategoryCounts).toEqual([
      { count: 3, statusCategory: "DONE" },
      { count: 2, statusCategory: "VERIFYING" },
    ]);
    expect(transaction.mock.calls[0]?.[0]).toHaveLength(3);
    expect(workItemGroupBy).toHaveBeenCalledTimes(1);
  });

  it("filters bugs by creator with reporter fallback for legacy rows", async () => {
    const { repository, workItemCount, workItemFindMany, workItemGroupBy } =
      createRepositoryMock();
    const creatorId = "01ARZ3NDEKTSV4RRFFQ69G5CRT";

    await repository.listBySpaceId("01ARZ3NDEKTSV4RRFFQ69G5SPC", {
      actorUserId: "01ARZ3NDEKTSV4RRFFQ69G5USR",
      createdById: creatorId,
      page: 1,
      pageSize: 20,
      visibility: "SPACE",
    });

    const expectedCreatorWhere = [
      { createdById: creatorId },
      { createdById: null, reporterId: creatorId },
    ];

    expect(workItemFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          OR: expectedCreatorWhere,
        }),
      }),
    );
    expect(workItemCount).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          OR: expectedCreatorWhere,
        }),
      }),
    );
    expect(workItemGroupBy).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          OR: expectedCreatorWhere,
          statusCategory: undefined,
        }),
      }),
    );
  });

  it("looks up linked requirements from requirement documents", async () => {
    const documentFindFirst = vi.fn(async () => ({
      ownerId: "01H00000000000000000000004",
      sequence: 12,
      status: "ACTIVE",
      versionId: "01H00000000000000000000002",
    }));
    const repository = new PrismaBugRepository(
      {
        client: {
          document: {
            findFirst: documentFindFirst,
          },
        },
      } as unknown as PrismaService,
      makeObjectCodeAllocator(),
    );

    await expect(
      repository.findRequirementInSpace(
        "01H00000000000000000000001",
        "01H00000000000000000000009",
      ),
    ).resolves.toEqual({
      requirementOwnerId: "01H00000000000000000000004",
      requirementSequence: 12,
      requirementStatus: "ACTIVE",
      requirementVersionId: "01H00000000000000000000002",
    });
    expect(documentFindFirst).toHaveBeenCalledWith({
      select: {
        ownerId: true,
        sequence: true,
        status: true,
        versionId: true,
      },
      where: {
        deletedAt: null,
        id: "01H00000000000000000000009",
        kind: "REQUIREMENT",
        spaceId: "01H00000000000000000000001",
      },
    });
  });

  it("allocates a BUG sequence while keeping bug detail keyed by work item id", async () => {
    const objectCodeAllocator = makeObjectCodeAllocator({ nextSequence: 51 });
    const workItemCreate = vi.fn(async (args: { data: BugWorkItemCreateData }) =>
      makeBugRecord(args.data),
    );
    const bugDetailCreate = vi.fn(async () => undefined);
    const bugRecord = makeBugRecord({
      id: "01H00000000000000000000010",
      createdById: "01H00000000000000000000011",
      currentStateId: "01H00000000000000000000012",
      lastStatusChangedAt: new Date("2026-05-14T12:00:00.000Z"),
      organizationId: "01H00000000000000000000013",
      priority: "HIGH",
      reporterId: "01H00000000000000000000011",
      sequence: 51,
      spaceId: "01H00000000000000000000014",
      statusCategory: "NOT_STARTED",
      title: "Sequenced bug",
      type: "BUG",
      updatedById: "01H00000000000000000000011",
      workflowVersionId: "01H00000000000000000000015",
    });
    const tx = {
      bugDetail: {
        create: bugDetailCreate,
      },
      objectParticipant: {
        create: vi.fn(async () => undefined),
        findFirst: vi.fn(async () => undefined),
      },
      tagAssignment: {
        updateMany: vi.fn(async () => ({ count: 0 })),
      },
      timelineEvent: {
        create: vi.fn(async () => undefined),
      },
      workItem: {
        create: workItemCreate,
        findFirst: vi.fn(async () => bugRecord),
      },
    };
    const repository = new PrismaBugRepository(
      {
        client: {
          $transaction: vi.fn(async (handler) => handler(tx)),
          tagAssignment: {
            findMany: vi.fn(async () => []),
          },
        },
      } as unknown as PrismaService,
      objectCodeAllocator,
    );

    const created = await repository.create({
      id: bugRecord.id,
      createdById: bugRecord.createdById,
      currentStateId: bugRecord.currentStateId,
      lastStatusChangedAt: bugRecord.lastStatusChangedAt,
      organizationId: bugRecord.organizationId,
      priority: bugRecord.priority,
      relatedUserIds: [],
      reporterId: bugRecord.reporterId,
      severity: bugRecord.bugDetail.severity,
      spaceId: bugRecord.spaceId,
      statusCategory: bugRecord.statusCategory,
      title: bugRecord.title,
      workflowVersionId: bugRecord.workflowVersionId,
    });

    expect(objectCodeAllocator.allocateOne).toHaveBeenCalledWith(tx, {
      actorUserId: bugRecord.createdById,
      objectType: "BUG",
      organizationId: bugRecord.organizationId,
      spaceId: bugRecord.spaceId,
    });
    expect(workItemCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        id: bugRecord.id,
        sequence: 51,
        type: "BUG",
      }),
    });
    expect(bugDetailCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        workItemId: bugRecord.id,
      }),
    });
    expect(created).toMatchObject({
      id: bugRecord.id,
      sequence: 51,
      displayCode: "BUG-51",
      bugDetail: {
        workItemId: bugRecord.id,
      },
    });
  });
});

type BugWorkItemCreateData = {
  assigneeId?: string;
  createdById: string;
  currentStateId: string;
  description?: string;
  dueDate?: Date;
  id: string;
  intakeItemId?: string;
  lastStatusChangedAt: Date;
  organizationId: string;
  priority: "LOW" | "MEDIUM" | "HIGH" | "URGENT";
  reporterId: string;
  requirementId?: string;
  sequence: number;
  spaceId: string;
  statusCategory:
    | "NOT_STARTED"
    | "IN_PROGRESS"
    | "WAITING"
    | "VERIFYING"
    | "DONE"
    | "TERMINATED";
  title: string;
  type: "BUG";
  updatedById: string;
  versionId?: string;
  workflowVersionId: string;
};

function makeBugRecord(data: BugWorkItemCreateData) {
  const now = new Date("2026-05-14T12:05:00.000Z");

  return {
    id: data.id,
    organizationId: data.organizationId,
    spaceId: data.spaceId,
    sequence: data.sequence,
    versionId: data.versionId ?? null,
    requirementId: data.requirementId ?? null,
    intakeItemId: data.intakeItemId ?? null,
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
    bugDetail: {
      workItemId: data.id,
      severity: "MAJOR" as const,
      stepsToReproduce: null,
      expectedResult: null,
      actualResult: null,
      fixNote: null,
      regressionResult: null,
      regressionById: null,
      regressionAt: null,
      relatedTaskId: null,
    },
  };
}

function makeObjectCodeAllocator(input: { nextSequence?: number } = {}) {
  const nextSequence = input.nextSequence ?? 1;

  return {
    allocateOne: vi.fn(async () => nextSequence),
    allocateRange: vi.fn(),
  } as unknown as ObjectCodeAllocator & {
    allocateOne: ReturnType<typeof vi.fn>;
    allocateRange: ReturnType<typeof vi.fn>;
  };
}
