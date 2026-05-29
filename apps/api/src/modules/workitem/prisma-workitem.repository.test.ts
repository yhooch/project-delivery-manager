import { describe, expect, it, vi } from "vitest";

vi.mock("@project-delivery/shared", async () =>
  vi.importActual("../../../../../packages/shared/src/index.ts"),
);

import type { PrismaService } from "../../prisma/prisma.service";
import type { ObjectCodeAllocator } from "../object-code/object-code.allocator";
import { PrismaWorkItemRepository } from "./prisma-workitem.repository";

const SPACE_ID = "01H00000000000000000000001";
const WORKFLOW_VERSION_ID = "01H00000000000000000000002";
const CURRENT_STATE_ID = "01H00000000000000000000003";
const ACTOR_ID = "01H00000000000000000000004";
const TAG_ID = "01H00000000000000000000005";
const SECOND_TAG_ID = "01H00000000000000000000006";
const FIRST_TAGGED_TASK_ID = "01H00000000000000000000007";
const SECOND_TAGGED_TASK_ID = "01H00000000000000000000008";

describe("PrismaWorkItemRepository", () => {
  it("resolves explicit TASK workflow versions through a workflow binding", async () => {
    const workflowBindingFindFirst = vi.fn();
    const workflowVersionFindFirst = vi.fn(async () => ({
      id: WORKFLOW_VERSION_ID,
      states: [
        {
          category: "IN_PROGRESS",
          id: CURRENT_STATE_ID,
        },
      ],
    }));
    const repository = new PrismaWorkItemRepository(
      {
        client: {
          workflowBinding: {
            findFirst: workflowBindingFindFirst,
          },
          workflowVersion: {
            findFirst: workflowVersionFindFirst,
          },
        },
      } as unknown as PrismaService,
      makeObjectCodeAllocator(),
    );

    await expect(
      repository.resolveTaskWorkflow(SPACE_ID, WORKFLOW_VERSION_ID),
    ).resolves.toEqual({
      currentStateId: CURRENT_STATE_ID,
      statusCategory: "IN_PROGRESS",
      workflowVersionId: WORKFLOW_VERSION_ID,
    });
    expect(workflowVersionFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: WORKFLOW_VERSION_ID,
          workflowDefinition: expect.objectContaining({
            bindings: {
              some: expect.objectContaining({
                spaceId: SPACE_ID,
                targetType: "WORK_ITEM",
                workItemType: "TASK",
              }),
            },
            spaceId: SPACE_ID,
            status: "ACTIVE",
          }),
        }),
      }),
    );
    expect(workflowBindingFindFirst).not.toHaveBeenCalled();
  });

  it("applies tag filters to task list and status bucket counts", async () => {
    const tagAssignmentFindMany = vi.fn(async () => [
      { tagId: TAG_ID, targetId: FIRST_TAGGED_TASK_ID },
      { tagId: SECOND_TAG_ID, targetId: FIRST_TAGGED_TASK_ID },
      { tagId: TAG_ID, targetId: SECOND_TAGGED_TASK_ID },
    ]);
    const workItemFindMany = vi.fn(async () => []);
    const workItemCount = vi.fn(async () => 0);
    const workItemGroupBy = vi.fn(async () => [
      {
        _count: { _all: 2 },
        statusCategory: "IN_PROGRESS",
      },
    ]);
    const repository = new PrismaWorkItemRepository(
      {
        client: {
          $transaction: vi.fn(async (operations) => Promise.all(operations)),
          tagAssignment: {
            findMany: tagAssignmentFindMany,
          },
          workItem: {
            count: workItemCount,
            findMany: workItemFindMany,
            groupBy: workItemGroupBy,
          },
        },
      } as unknown as PrismaService,
      makeObjectCodeAllocator(),
    );

    const result = await repository.listBySpaceId(SPACE_ID, {
      actorUserId: ACTOR_ID,
      page: 1,
      pageSize: 20,
      statusCategory: "DONE",
      tagIds: `${TAG_ID},${SECOND_TAG_ID}`,
      tagMatch: "ANY",
      visibility: "SPACE",
    });

    expect(result.statusCategoryCounts).toEqual([
      {
        count: 2,
        statusCategory: "IN_PROGRESS",
      },
    ]);
    expect(tagAssignmentFindMany).toHaveBeenCalledWith({
      select: {
        tagId: true,
        targetId: true,
      },
      where: {
        deletedAt: null,
        spaceId: SPACE_ID,
        tag: {
          deletedAt: null,
          spaceId: SPACE_ID,
        },
        tagId: {
          in: [TAG_ID, SECOND_TAG_ID],
        },
        targetType: "WORK_ITEM",
      },
    });
    expect(workItemFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          AND: [
            {
              id: {
                in: [FIRST_TAGGED_TASK_ID, SECOND_TAGGED_TASK_ID],
              },
            },
          ],
          spaceId: SPACE_ID,
          statusCategory: "DONE",
          type: "TASK",
        }),
      }),
    );
    expect(workItemCount).toHaveBeenCalledWith({
      where: expect.objectContaining({
        AND: [
          {
            id: {
              in: [FIRST_TAGGED_TASK_ID, SECOND_TAGGED_TASK_ID],
            },
          },
        ],
        statusCategory: "DONE",
      }),
    });
    expect(workItemGroupBy).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          AND: [
            {
              id: {
                in: [FIRST_TAGGED_TASK_ID, SECOND_TAGGED_TASK_ID],
              },
            },
          ],
          spaceId: SPACE_ID,
          statusCategory: undefined,
          type: "TASK",
        }),
      }),
    );
  });

  it("looks up linked requirements from requirement documents", async () => {
    const documentFindFirst = vi.fn(async () => ({
      ownerId: ACTOR_ID,
      sequence: 12,
      status: "ACTIVE",
      versionId: WORKFLOW_VERSION_ID,
    }));
    const repository = new PrismaWorkItemRepository(
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
        SPACE_ID,
        "01H00000000000000000000009",
      ),
    ).resolves.toEqual({
      requirementOwnerId: ACTOR_ID,
      requirementSequence: 12,
      requirementStatus: "ACTIVE",
      requirementVersionId: WORKFLOW_VERSION_ID,
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
        spaceId: SPACE_ID,
      },
    });
  });

  it("allocates a TASK sequence inside the create transaction", async () => {
    const objectCodeAllocator = makeObjectCodeAllocator({ nextSequence: 31 });
    const workItemCreate = vi.fn(async (args: { data: WorkItemCreateData }) =>
      makeWorkItem(args.data),
    );
    const tx = {
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
      },
    };
    const repository = new PrismaWorkItemRepository(
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
      id: "01H00000000000000000000009",
      createdById: ACTOR_ID,
      currentStateId: CURRENT_STATE_ID,
      lastStatusChangedAt: new Date("2026-05-14T12:00:00.000Z"),
      organizationId: "01H00000000000000000000010",
      priority: "MEDIUM",
      relatedUserIds: [],
      reporterId: ACTOR_ID,
      spaceId: SPACE_ID,
      statusCategory: "NOT_STARTED",
      title: "Sequenced task",
      workflowVersionId: WORKFLOW_VERSION_ID,
    });

    expect(objectCodeAllocator.allocateOne).toHaveBeenCalledWith(tx, {
      actorUserId: ACTOR_ID,
      objectType: "TASK",
      organizationId: "01H00000000000000000000010",
      spaceId: SPACE_ID,
    });
    expect(workItemCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        sequence: 31,
        type: "TASK",
      }),
    });
    expect(created).toMatchObject({
      sequence: 31,
      displayCode: "TASK-31",
    });
  });
});

type WorkItemCreateData = {
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
  type: "TASK";
  updatedById: string;
  versionId?: string;
  workflowVersionId: string;
};

function makeWorkItem(data: WorkItemCreateData) {
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
